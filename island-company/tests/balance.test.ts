import { describe, expect, it } from 'vitest';
import {
  AFT,
  ARM,
  ENVELOPE,
  NOSE,
  STATIONS,
  evaluateLoad,
  fwdLimit,
  generateBalance,
  scoreBalance,
  solveBalance,
} from '../src/puzzles/balance';

const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1);
const loadedCount = (plan: number[]) => plan.filter((s) => s >= 0).length;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('weight & balance model', () => {
  it('is deterministic per seed', () => {
    expect(generateBalance(42, 3)).toEqual(generateBalance(42, 3));
    expect(generateBalance(42, 5)).toEqual(generateBalance(42, 5));
    expect(generateBalance(42, 3)).not.toEqual(generateBalance(43, 3));
  });

  it('CG is total moment / total weight (moment = weight × arm), fuel included', () => {
    const m = generateBalance(5, 1);
    const place = m.best.plan;
    let w = m.empty.kg + m.pilot.kg + m.fuel.kg;
    let mo = m.empty.kg * m.empty.arm + m.pilot.kg * ARM.front + m.fuel.kg * ARM.fuel;
    m.items.forEach((it, i) => {
      if (place[i] >= 0) {
        w += it.kg;
        mo += it.kg * STATIONS[place[i]].arm;
      }
    });
    const e = evaluateLoad(m, place);
    expect(e.w).toBeCloseTo(w, 6);
    expect(e.cg).toBeCloseTo(mo / w, 6);
  });

  it('the envelope narrows at higher weights', () => {
    expect(fwdLimit(1800)).toBeLessThan(fwdLimit(2200));
    expect(fwdLimit(2200)).toBeLessThan(fwdLimit(ENVELOPE.maxW));
  });

  it('every generated instance is solvable, and the solver plan is legal', () => {
    for (let t = 0; t <= 5; t++) {
      for (const s of SEEDS) {
        const m = generateBalance(s, t);
        const e = evaluateLoad(m, m.best.plan);
        expect(e.legal, `tier ${t} seed ${s}`).toBe(true);
        // guests are never left behind; only can-wait freight may be
        m.items.forEach((it, i) => {
          if (!it.optional) expect(m.best.plan[i]).toBeGreaterThanOrEqual(0);
        });
        // the plan respects station kinds
        m.items.forEach((it, i) => {
          const st = m.best.plan[i];
          if (st >= 0) expect(STATIONS[st].kind === 'seat').toBe(it.kind === 'pax');
        });
      }
    }
  });

  it('a clean, centred loading with one move per item scores perfect', () => {
    for (let t = 0; t <= 5; t++) {
      for (const s of SEEDS.slice(0, 10)) {
        const m = generateBalance(s, t);
        const score = scoreBalance(m, m.best.plan, loadedCount(m.best.plan), 0);
        expect(score, `tier ${t} seed ${s}`).toBeGreaterThanOrEqual(0.95);
      }
    }
  });

  it('a tail-heavy loading is illegal and scores low; an empty ramp scores lowest', () => {
    for (const t of [1, 3, 5]) {
      const m = generateBalance(11, t);
      let rear = 0;
      const tailHeavy = m.items.map((it) => (it.kind === 'pax' ? [4, 5, 2, 3, 1][rear++] : AFT));
      const e = evaluateLoad(m, tailHeavy);
      expect(e.legal).toBe(false);
      expect(scoreBalance(m, tailHeavy, m.items.length, 0, false)).toBeLessThan(0.6);
      const empty = m.items.map(() => -1);
      expect(scoreBalance(m, empty, 0, 0, false)).toBeLessThan(scoreBalance(m, tailHeavy, m.items.length, 0, false));
    }
  });

  it('bay weight limits are enforced', () => {
    const m = generateBalance(3, 2);
    const allNose = m.items.map((it, i) => (it.kind === 'pax' ? m.best.plan[i] : NOSE));
    const e = evaluateLoad(m, allNose);
    const cargoKg = m.items.filter((it) => it.kind !== 'pax').reduce((a, it) => a + it.kg, 0);
    if (cargoKg > STATIONS[NOSE].limit) {
      expect(e.bayOver).toBeGreaterThan(0);
      expect(e.legal).toBe(false);
    }
  });

  it('extra moves, refusals and a CG on the limit cost points, but a legal load still passes', () => {
    const m = generateBalance(8, 4);
    const n = loadedCount(m.best.plan);
    const clean = scoreBalance(m, m.best.plan, n, 0);
    const fiddly = scoreBalance(m, m.best.plan, n + 4, 0);
    const refused = scoreBalance(m, m.best.plan, n, 2);
    expect(fiddly).toBeLessThan(clean);
    expect(fiddly).toBeLessThan(0.95);
    expect(refused).toBeLessThan(0.95);
    expect(scoreBalance(m, m.best.plan, n + 30, 5)).toBeGreaterThanOrEqual(0.6);
  });

  it('leaving can-wait freight behind is only free when it has to stay', () => {
    let checked = 0;
    for (const s of SEEDS) {
      const m = generateBalance(s, 3);
      if (m.best.offload !== 0) continue;
      const opt = m.items.findIndex((it) => it.optional);
      if (opt < 0) continue;
      const plan = m.best.plan.slice();
      plan[opt] = -1;
      if (!evaluateLoad(m, plan).legal) continue;
      expect(scoreBalance(m, plan, loadedCount(plan), 0)).toBeLessThan(scoreBalance(m, m.best.plan, loadedCount(m.best.plan), 0));
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
    // and at tiers 3-5 some loads genuinely require leaving freight behind
    for (const t of [3, 4, 5]) expect(SEEDS.some((s) => generateBalance(s, t).best.offload > 0)).toBe(true);
  });

  it('tier 5 checks the landing CG too (fuel burn moves the CG aft)', () => {
    for (const s of SEEDS.slice(0, 10)) {
      const m = generateBalance(s, 5);
      expect(m.fuel.burn).toBeGreaterThan(0);
      expect(m.landingTraps).toBeGreaterThan(0);
      const e = evaluateLoad(m, m.best.plan);
      expect(e.cgL).toBeGreaterThan(e.cg); // fuel sits forward of the CG
    }
    expect(generateBalance(1, 4).fuel.burn).toBe(0);
  });

  it('tier scaling makes it harder: more items, fewer legal loadings, less CG margin', () => {
    const stats = [0, 1, 2, 3, 4, 5].map((t) => {
      const ms = SEEDS.map((s) => generateBalance(s, t));
      return {
        items: mean(ms.map((m) => m.items.length)),
        legal: mean(ms.map((m) => m.legalFrac)),
        margin: mean(ms.map((m) => m.best.margin)),
      };
    });
    for (let t = 1; t <= 5; t++) {
      expect(stats[t].items).toBeGreaterThanOrEqual(stats[t - 1].items);
      expect(stats[t].legal).toBeLessThan(stats[t - 1].legal);
    }
    expect(stats[5].margin).toBeLessThan(stats[1].margin);
    expect(stats[0].legal).toBeGreaterThan(0.9); // tutorial is forgiving
  });

  it('solver agrees with the stored best', () => {
    const m = generateBalance(21, 5);
    const s = solveBalance(m)!;
    expect(s.best.offload).toBe(m.best.offload);
    expect(s.best.margin).toBeCloseTo(m.best.margin, 9);
  });
});
