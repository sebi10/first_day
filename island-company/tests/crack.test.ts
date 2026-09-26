// Crack hunt (fluorescent penetrant): one-tap circling, and the bleed-back
// physics that let a real inspector sort cracks from surface residue.
import { describe, expect, it } from 'vitest';
import { distToInd, generateCrack, nearest, riserDist, scoreCrack, surface, type CrackModel } from '../src/puzzles/crack';

const SEEDS = Array.from({ length: 24 }, (_, i) => i + 1);
const idxOf = (m: CrackModel, pred: (k: string) => boolean) => m.indications.map((ind, i) => (pred(ind.kind) ? i : -1)).filter((i) => i >= 0);

describe('crack hunt model', () => {
  it('is deterministic per seed, tier, tools and job', () => {
    expect(generateCrack(42, 3, ['borescope'], 'spar')).toEqual(generateCrack(42, 3, ['borescope'], 'spar'));
    expect(generateCrack(42, 3)).not.toEqual(generateCrack(43, 3));
  });

  it('the job picks the part; other jobs get either', () => {
    for (const s of SEEDS.slice(0, 8)) {
      expect(generateCrack(s, 3, [], 'spar').part).toBe('spar');
      expect(generateCrack(s, 2, [], 'corrosion').part).toBe('hub');
      expect(generateCrack(s, 2, [], 'corrosion').name).toBe('Wheel half');
      expect(generateCrack(s, 4, [], 'project').name).toBe('Deck beam');
    }
    const parts = new Set(SEEDS.map((s) => generateCrack(s, 1, [], 'inspect100').part));
    expect(parts).toEqual(new Set(['spar', 'hub']));
  });

  it('every crack starts at a stress riser; scratches, porosity and lint never do', () => {
    for (const s of SEEDS) {
      for (const tier of [0, 2, 3, 5]) {
        for (const job of ['spar', 'corrosion']) {
          const m = generateCrack(s, tier, [], job);
          expect(m.cracks).toBe([1, 2, 2, 3, 3, 4][tier]);
          for (const ind of m.indications) {
            if (ind.kind === 'crack') expect(riserDist(m, ind.pts[0]), `seed ${s} tier ${tier} ${job}`).toBeLessThan(0.015);
            if (ind.kind === 'scratch' || ind.kind === 'porosity' || ind.kind === 'lint') {
              for (const q of ind.pts) expect(riserDist(m, q)).toBeGreaterThan(0.01);
            }
          }
        }
      }
    }
  });

  it('shapes carry the tells: scratches are dead straight, lint curls, porosity is round dots', () => {
    for (const s of SEEDS) {
      const m = generateCrack(s, 5);
      for (const ind of m.indications) {
        if (ind.kind === 'scratch') expect(ind.pts.length).toBe(2);
        if (ind.kind === 'lint') {
          // total turning along the fibre: it curls (a C or an S), where a scratch never turns
          let turn = 0;
          for (let i = 2; i < ind.pts.length; i++) {
            const [p0, p1, p2] = [ind.pts[i - 2], ind.pts[i - 1], ind.pts[i]];
            let d = Math.atan2(p2.y - p1.y, p2.x - p1.x) - Math.atan2(p1.y - p0.y, p1.x - p0.x);
            d = Math.atan2(Math.sin(d), Math.cos(d));
            turn += Math.abs(d);
          }
          expect(turn).toBeGreaterThan(1.2);
        }
        if (ind.kind === 'porosity') {
          const xs = ind.pts.map((q) => q.x);
          const ys = ind.pts.map((q) => q.y);
          // a cluster, not a line: about as wide as it is long
          const w = Math.max(...xs) - Math.min(...xs);
          const h = Math.max(...ys) - Math.min(...ys);
          expect(Math.max(w, h)).toBeLessThan(0.065);
          expect(ind.pts.length).toBeGreaterThanOrEqual(5);
        }
      }
    }
  });

  it('indications are far enough apart that one tap can only mean one of them', () => {
    for (const s of SEEDS) {
      for (const job of ['spar', 'corrosion']) {
        const m = generateCrack(s, 5, [], job);
        const sep = m.part === 'spar' ? 0.07 : 0.085;
        m.indications.forEach((a, i) =>
          m.indications.forEach((b, j) => {
            if (i >= j) return;
            for (const q of a.pts) expect(distToInd(q, b)).toBeGreaterThan(sep * 0.9);
          }),
        );
      }
    }
  });

  it('decoys by tier: residue first, then scratches and porosity, lint from tier 4', () => {
    const kinds = (tier: number) => new Set(SEEDS.flatMap((s) => generateCrack(s, tier).indications.map((i) => i.kind)));
    expect(kinds(0)).toEqual(new Set(['crack', 'smear']));
    expect(kinds(1)).toEqual(new Set(['crack', 'smear', 'scratch']));
    expect(kinds(2).has('porosity')).toBe(true);
    expect(kinds(3).has('lint')).toBe(false);
    expect(kinds(4).has('lint')).toBe(true);
    const avg = (tier: number) => SEEDS.reduce((n, s) => n + generateCrack(s, tier).indications.length, 0) / SEEDS.length;
    for (let t = 1; t <= 5; t++) expect(avg(t)).toBeGreaterThan(avg(t - 1));
  });
});

describe('bleed-back after a solvent wipe', () => {
  const pick = (m: CrackModel, kind: string) => m.indications.find((i) => i.kind === kind)!;

  it('a crack bleeds back within 1-2 s and keeps spreading; residue never comes back', () => {
    for (const tier of [1, 3, 5]) {
      const m = generateCrack(5, tier);
      const c = pick(m, 'crack');
      const smear = pick(m, 'smear');
      expect(surface(m, c, 0.2, 1).glow).toBe(0); // just wiped: clean
      expect(surface(m, c, 2, 1).glow).toBeGreaterThan(0.7 * c.glow);
      expect(surface(m, c, 4, 1).spread).toBeGreaterThan(surface(m, c, 1.5, 1).spread);
      for (const t of [0.5, 1, 2, 5, 30]) expect(surface(m, smear, t, 1).glow).toBe(0);
      // before any wipe the residue glows as brightly as anything else
      expect(surface(m, smear, 1, 0).glow).toBe(smear.glow);
    }
  });

  it('a scratch comes back faint and crisp; porosity bleeds back like the void it is', () => {
    const m = generateCrack(9, 3);
    const sc = pick(m, 'scratch');
    const po = pick(m, 'porosity');
    const c = pick(m, 'crack');
    for (const t of [1, 2, 5]) {
      expect(surface(m, sc, t, 1).spread).toBe(0);
      expect(surface(m, sc, t, 1).glow).toBeLessThan(0.35 * sc.glow);
      expect(surface(m, sc, t, 1).glow).toBeLessThan(surface(m, c, t, 1).glow);
    }
    expect(surface(m, po, 2, 1).glow).toBeGreaterThan(0.6 * po.glow);
  });

  it('each wipe drains the flaw a little', () => {
    const m = generateCrack(3, 2);
    const c = pick(m, 'crack');
    expect(surface(m, c, 3, 3).glow).toBeLessThan(surface(m, c, 3, 1).glow);
    expect(surface(m, c, 3, 9).glow).toBeGreaterThan(0.5 * surface(m, c, 3, 1).glow);
  });

  it('non-aqueous developer bleeds back faster and brighter; the floodlamp brightens everything', () => {
    const base = generateCrack(7, 4);
    const nad = generateCrack(7, 4, ['borescope']);
    const cb = pick(base, 'crack');
    const cn = pick(nad, 'crack');
    expect(nad.bleedDelay).toBeLessThan(base.bleedDelay);
    expect(surface(nad, cn, 0.8, 1).glow).toBeGreaterThan(surface(base, cb, 0.8, 1).glow * 1.3);
    expect(nad.developer).toBe('non-aqueous');
    const uv = generateCrack(7, 4, ['uvPlus']);
    uv.indications.forEach((ind, i) => expect(ind.glow).toBeGreaterThan(base.indications[i].glow));
    expect(uv.uv).toBeGreaterThan(base.uv);
  });
});

describe('one-tap circling', () => {
  it('a tap snaps to the nearest indication within reach, bare metal gets nothing', () => {
    const m = generateCrack(11, 3);
    m.indications.forEach((ind, i) => {
      const q = ind.pts[Math.floor(ind.pts.length / 2)];
      expect(nearest(m, { x: q.x + 0.03, y: q.y }, 0.05)).toBe(i);
    });
    // a spot far from everything
    let far = { x: 0, y: 0 };
    let best = 0;
    for (let x = 0.05; x < m.aspect; x += 0.02)
      for (let y = 0.05; y < 1; y += 0.02) {
        const d = Math.min(...m.indications.map((ind) => distToInd({ x, y }, ind)));
        if (d > best) [best, far] = [d, { x, y }];
      }
    expect(nearest(m, far, 0.05)).toBe(-1);
    // only what you can see (or already circled) can be snapped to
    const i = nearest(m, m.indications[0].pts[0], 0.05);
    expect(i).toBe(0);
    expect(nearest(m, m.indications[0].pts[0], 0.05, (k) => k !== i)).toBe(-1);
  });

  it('scoring: every crack and nothing else is perfect; misses cost more than false calls', () => {
    for (const s of SEEDS) {
      const m = generateCrack(s, 5);
      const cracks = idxOf(m, (k) => k === 'crack');
      const decoys = idxOf(m, (k) => k !== 'crack');
      expect(scoreCrack(m, cracks).score).toBe(1);
      expect(scoreCrack(m, [...cracks, ...cracks]).score).toBe(1); // a double tap counts once
      expect(scoreCrack(m, [...cracks, decoys[0]]).score).toBeCloseTo(0.8);
      expect(scoreCrack(m, cracks, 1).falseCalls).toBe(1);
      expect(scoreCrack(m, cracks.slice(1)).missed).toBe(1);
      expect(scoreCrack(m, cracks.slice(1)).score).toBeLessThan(scoreCrack(m, [...cracks, decoys[0]]).score);
      expect(scoreCrack(m, decoys).score).toBe(0);
      expect(scoreCrack(m, []).score).toBe(0);
    }
  });

  it('tiers 0-2 teach; from tier 3 the model exposes no answer-revealing hints', () => {
    for (const t of [0, 1, 2]) {
      const m = generateCrack(4, t);
      expect(m.teach).toBe(true);
      expect(m.hints.length).toBeGreaterThan(0);
      expect(m.hints.join(' ')).toMatch(/bleed/i);
    }
    for (const t of [3, 4, 5]) {
      for (const s of SEEDS.slice(0, 12)) {
        for (const tools of [[], ['borescope', 'uvPlus']]) {
          const m = generateCrack(s, t, tools);
          expect(m.teach).toBe(false);
          expect(m.hints).toEqual([]);
          expect(Object.keys(m).join(' ')).not.toMatch(/answer|solution|expected|hint(?!s)|dim/i);
          // decoys glow as bright as the cracks, so brightness alone tells you nothing
          const crackMax = Math.max(...m.indications.filter((i) => i.kind === 'crack').map((i) => i.glow));
          for (const d of m.indications.filter((i) => i.kind !== 'crack')) expect(d.glow).toBeGreaterThanOrEqual(crackMax * 0.85 - 1e-9);
        }
      }
    }
  });
});
