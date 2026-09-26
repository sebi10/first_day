// Crack hunt (fluorescent penetrant): one-tap circling, and the three things a
// real inspector sorts indications by: where a line starts, which way it runs
// against the load, and whether it bleeds back after a swab.
import { describe, expect, it } from 'vitest';
import {
  crackPlan,
  distToInd,
  distToLine,
  falseCallCost,
  generateCrack,
  nearest,
  riserDist,
  scoreCrack,
  styleOf,
  surface,
  type CrackModel,
  type Indication,
} from '../src/puzzles/crack';
import { PASS, PERFECT } from '../src/puzzles/types';

type P = { x: number; y: number };
const SEEDS = Array.from({ length: 24 }, (_, i) => i + 1);
const JOBS = ['spar', 'corrosion'] as const;
const idxOf = (m: CrackModel, pred: (k: string) => boolean) => m.indications.map((ind, i) => (pred(ind.kind) ? i : -1)).filter((i) => i >= 0);

// ---- how players might read the booth (written from what is drawn, never from `kind`)
const AT = 0.012; // "sits on a riser"
const unit = (a: P, b: P) => {
  const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
};
/** the riser nearest p and the way a crack runs from it, or null if p isn't on one */
function crackRunsFrom(m: CrackModel, p: P): ((d: P) => boolean) | null {
  let best = Infinity;
  let kind = '';
  for (const h of m.holes) {
    const d = Math.abs(Math.hypot(p.x - h.x, p.y - h.y) - h.r);
    if (d < best) [best, kind] = [d, 'hole'];
  }
  for (const f of m.fillets) {
    const d = distToLine(p, f);
    if (d < best) [best, kind] = [d, 'fillet'];
  }
  for (const f of m.edges) {
    const d = distToLine(p, f);
    if (d < best) [best, kind] = [d, 'edge'];
  }
  if (best > AT) return null;
  const cos = Math.cos(0.6);
  if (m.part === 'spar') {
    // the spar carries load along its length: hole and edge cracks run across it
    // (chordwise); radius cracks (stress corrosion) run along the radius
    if (kind === 'fillet') return (d) => Math.abs(d.y) > cos;
    return (d) => Math.abs(d.x) > cos;
  }
  // wheel: radius cracks run round the wheel; bolt-hole, bore and rim cracks run radially
  const rad = unit({ x: 0.5, y: 0.5 }, p);
  if (kind === 'fillet') return (d) => Math.abs(d.x * rad.y - d.y * rad.x) > cos;
  return (d) => Math.abs(d.x * rad.x + d.y * rad.y) > cos;
}
const linear = (m: CrackModel, ind: Indication) => ['line', 'scratch'].includes(styleOf(m, ind));
const atRiser = (m: CrackModel, ind: Indication) => ind.pts.some((q) => riserDist(m, q) < AT);
const oriented = (m: CrackModel, ind: Indication) => {
  const a = ind.pts[0];
  const b = ind.pts[ind.pts.length - 1];
  return [
    [a, b],
    [b, a],
  ].some(([s, e]) => crackRunsFrom(m, s)?.(unit(s, e)) ?? false);
};
/** swab, wait 2.5 s: is it back at half its developed brightness? */
const bleedsBack = (m: CrackModel, ind: Indication) => surface(m, ind, 2.5, 1).glow >= 0.5 * surface(m, ind, 3, 0).glow;
function signChanges(pts: P[]) {
  let n = 0;
  let prev = 0;
  for (let i = 2; i < pts.length; i++) {
    const [a, b, c] = [pts[i - 2], pts[i - 1], pts[i]];
    let d = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x);
    d = Math.atan2(Math.sin(d), Math.cos(d));
    if (prev && Math.sign(d) !== Math.sign(prev)) n++;
    prev = d;
  }
  return n;
}
const RULES: Record<string, (m: CrackModel, ind: Indication) => boolean> = {
  // shape only: no trade knowledge, no swab
  everyLine: (m, i) => linear(m, i),
  kinked: (m, i) => linear(m, i) && signChanges(i.pts) >= 3,
  notStraight: (m, i) => linear(m, i) && i.pts.length > 2,
  // one or two tells, not all three
  atARiser: (m, i) => linear(m, i) && atRiser(m, i),
  riserAndOrientationNoSwab: (m, i) => linear(m, i) && oriented(m, i),
  swabOnly: (m, i) => linear(m, i) && bleedsBack(m, i),
  swabAndRiser: (m, i) => linear(m, i) && atRiser(m, i) && bleedsBack(m, i),
  // the inspector: starts at a riser, runs the way a crack runs there, bleeds back
  knowledge: (m, i) => linear(m, i) && oriented(m, i) && bleedsBack(m, i),
};
const cache = new Map<string, CrackModel>();
function gen(s: number, tier: number, tools: string[], job: string) {
  const key = `${s}|${tier}|${tools}|${job}`;
  if (!cache.has(key)) cache.set(key, generateCrack(s, tier, tools, job));
  return cache.get(key)!;
}
function play(rule: string, tier: number, job: string, seeds: number[], tools: string[] = []) {
  return seeds.map((s) => {
    const m = gen(s, tier, tools, job);
    return scoreCrack(
      m,
      m.indications.map((ind, i) => (RULES[rule](m, ind) ? i : -1)).filter((i) => i >= 0),
    ).score;
  });
}
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const MANY = Array.from({ length: 120 }, (_, i) => i + 1);

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
      // the lodge job: penetrant on an aluminium beam (not a wooden or steel one)
      expect(generateCrack(s, 4, [], 'project').name).toBe('Aluminium deck beam');
    }
    const parts = new Set(SEEDS.map((s) => generateCrack(s, 1, [], 'inspect100').part));
    expect(parts).toEqual(new Set(['spar', 'hub']));
  });

  it('every tier lays out its whole plan, on both parts, every seed', () => {
    const sorted = (xs: string[]) => [...xs].sort().join(',');
    for (let tier = 0; tier <= 5; tier++) {
      for (const job of JOBS) {
        for (let s = 1; s <= 200; s++) {
          const m = generateCrack(s, tier, [], job);
          const plan = crackPlan(m.part, tier);
          expect(m.cracks, `seed ${s} tier ${tier} ${job}`).toBe(plan.cracks);
          expect(sorted(m.indications.filter((i) => i.kind !== 'crack').map((i) => i.kind)), `seed ${s} tier ${tier} ${job}`).toBe(sorted(plan.decoys));
        }
      }
    }
    expect(crackPlan('hub', 2).decoys).toContain('porosity');
    expect(crackPlan('spar', 2).decoys).toContain('specks');
    expect(crackPlan('spar', 5).decoys).not.toContain('porosity');
    expect([0, 1, 2, 3, 4, 5].map((t) => crackPlan('spar', t).cracks)).toEqual([1, 2, 2, 3, 3, 4]);
  });

  it('where things sit: cracks start at a riser, tool marks graze a hole, open-metal marks stay clear', () => {
    for (const s of SEEDS) {
      for (const tier of [0, 2, 3, 5]) {
        for (const job of JOBS) {
          const m = generateCrack(s, tier, [], job);
          const tag = `seed ${s} tier ${tier} ${job}`;
          for (const ind of m.indications) {
            const d = ind.pts.map((q) => riserDist(m, q));
            if (ind.kind === 'crack') expect(riserDist(m, ind.pts[0]), tag).toBeLessThan(0.008);
            if (ind.kind === 'scratch' || ind.kind === 'porosity' || ind.kind === 'specks') expect(Math.min(...d), tag).toBeGreaterThan(0.02);
            if (ind.kind === 'toolmark') {
              // passes a fastener hole, never starts or ends at any riser
              expect(Math.min(...d), tag).toBeLessThan(AT);
              expect(d[0], tag).toBeGreaterThan(AT);
              expect(d[d.length - 1], tag).toBeGreaterThan(AT);
            }
            if (ind.kind === 'trapped') for (const q of ind.pts) expect(Math.min(...m.fillets.map((f) => distToLine(q, f))), tag).toBeLessThan(0.008);
            if (ind.kind === 'bleedout') {
              const cx = ind.pts.reduce((a, q) => a + q.x, 0) / ind.pts.length;
              const cy = ind.pts.reduce((a, q) => a + q.y, 0) / ind.pts.length;
              expect(m.holes.some((h) => h.r < 0.05 && Math.hypot(h.x - cx, h.y - cy) < 0.002), tag).toBe(true);
            }
            if (ind.kind === 'lint') {
              // lies like a crack in a radius or at an edge, never at a hole
              expect(Math.min(d[0], d[d.length - 1]), tag).toBeLessThan(AT);
              expect(ind.riser, tag).not.toBe('hole');
            }
          }
        }
      }
    }
  });

  it('while teaching, scratches are dead straight and dots are clusters, not lines', () => {
    for (const s of SEEDS) {
      for (const job of JOBS) {
        const m = generateCrack(s, 2, [], job);
        for (const ind of m.indications) {
          if (ind.kind === 'scratch') {
            expect(ind.pts.length).toBe(2);
            expect(styleOf(m, ind)).toBe('scratch');
          }
          if (ind.kind === 'porosity' || ind.kind === 'specks') {
            const xs = ind.pts.map((q) => q.x);
            const ys = ind.pts.map((q) => q.y);
            expect(Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))).toBeLessThan(0.07);
            expect(ind.pts.length).toBeGreaterThanOrEqual(5);
            expect(styleOf(m, ind)).toBe('dots');
          }
        }
        // porosity is a cast-wheel thing; a spar gets developer specks instead
        expect(m.indications.some((i) => i.kind === (m.part === 'hub' ? 'specks' : 'porosity'))).toBe(false);
      }
    }
  });

  it('indications are far enough apart that one tap can only mean one of them', () => {
    for (const s of SEEDS) {
      for (const job of JOBS) {
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

  it('decoys by tier: residue first, then scratches and dots, knowledge decoys from tier 3', () => {
    const kinds = (tier: number) => new Set(SEEDS.flatMap((s) => generateCrack(s, tier).indications.map((i) => i.kind)));
    expect(kinds(0)).toEqual(new Set(['crack', 'smear']));
    expect(kinds(1)).toEqual(new Set(['crack', 'smear', 'scratch']));
    expect(kinds(2).has('porosity') || kinds(2).has('specks')).toBe(true);
    for (const k of ['toolmark', 'trapped', 'bleedout'] as const) {
      expect(kinds(2).has(k)).toBe(false);
      expect(kinds(3).has(k)).toBe(true);
    }
    expect(kinds(3).has('lint')).toBe(false);
    expect(kinds(4).has('lint')).toBe(true);
    const count = (tier: number) => avg(SEEDS.map((s) => generateCrack(s, tier).indications.length));
    for (let t = 1; t <= 5; t++) expect(count(t)).toBeGreaterThan(count(t - 1));
  });
});

describe('from tier 3 only trade knowledge sorts the lines', () => {
  it('every linear indication is drawn the same way; shape alone scores below PASS', () => {
    for (const tier of [3, 4, 5]) {
      for (const job of JOBS) {
        for (const s of SEEDS) {
          const m = generateCrack(s, tier, [], job);
          for (const ind of m.indications) {
            if (['crack', 'toolmark', 'trapped', 'lint', 'scratch'].includes(ind.kind)) expect(styleOf(m, ind)).toBe('line');
          }
        }
        for (const rule of ['everyLine', 'kinked', 'notStraight']) {
          const scores = play(rule, tier, job, MANY);
          expect(avg(scores), `${rule} tier ${tier} ${job}`).toBeLessThan(PASS);
          expect(Math.max(...scores), `${rule} tier ${tier} ${job}`).toBeLessThan(PERFECT);
          expect(scores.filter((x) => x >= PASS).length, `${rule} tier ${tier} ${job}`).toBeLessThanOrEqual(MANY.length * 0.05);
        }
      }
    }
  });

  it('the inspector’s rule (riser + orientation + bleeds back) is perfect on every seed, every tier', () => {
    for (let tier = 0; tier <= 5; tier++) {
      for (const job of JOBS) {
        for (const tools of [[], ['borescope', 'uvPlus']]) {
          const scores = play('knowledge', tier, job, MANY, tools);
          expect(Math.min(...scores), `tier ${tier} ${job} ${tools}`).toBe(1);
        }
      }
    }
  });

  it('half the knowledge is not enough: skip the swab, or skip the orientation, and it shows', () => {
    for (const job of JOBS) {
      // tier 3: knowing where cracks run passes without a swab, but is never perfect
      expect(Math.max(...play('riserAndOrientationNoSwab', 3, job, MANY))).toBeLessThan(PERFECT);
      for (const tier of [4, 5]) expect(avg(play('riserAndOrientationNoSwab', tier, job, MANY)), `tier ${tier}`).toBeLessThan(PASS);
      for (const tier of [3, 4, 5]) {
        // swabbing without knowing which way cracks run circles the tool marks too
        expect(avg(play('swabOnly', tier, job, MANY)), `swab tier ${tier}`).toBeLessThan(PASS);
        expect(avg(play('swabAndRiser', tier, job, MANY)), `swab+riser tier ${tier}`).toBeLessThan(PASS);
        expect(avg(play('atARiser', tier, job, MANY)), `riser tier ${tier}`).toBeLessThan(PASS);
      }
    }
  });

  it('brightness tells you nothing: lines glow alike, the rest at least as bright', () => {
    for (const tier of [3, 4, 5]) {
      const crackGlow: number[] = [];
      const lineGlow: number[] = [];
      for (const s of MANY) {
        const m = generateCrack(s, tier);
        for (const ind of m.indications) {
          if (ind.kind === 'crack') crackGlow.push(ind.glow);
          else if (styleOf(m, ind) === 'line') lineGlow.push(ind.glow);
        }
        const crackMax = Math.max(...m.indications.filter((i) => i.kind === 'crack').map((i) => i.glow));
        for (const d of m.indications.filter((i) => styleOf(m, i) !== 'line')) expect(d.glow).toBeGreaterThanOrEqual(crackMax * 0.85 - 1e-9);
      }
      expect(Math.abs(avg(lineGlow) - avg(crackGlow)) / avg(crackGlow)).toBeLessThan(0.04);
    }
  });
});

describe('bleed-back after a swab', () => {
  const pick = (m: CrackModel, kind: string) => m.indications.find((i) => i.kind === kind)!;

  it('a crack bleeds back within 1-2 s and keeps spreading; residue never comes back', () => {
    for (const tier of [1, 3, 5]) {
      const m = generateCrack(5, tier);
      const c = pick(m, 'crack');
      const smear = pick(m, 'smear');
      expect(surface(m, c, 0.2, 1).glow).toBe(0); // just swabbed: clean
      expect(surface(m, c, 2, 1).glow).toBeGreaterThan(0.7 * c.glow);
      expect(surface(m, c, 4, 1).spread).toBeGreaterThan(surface(m, c, 1.5, 1).spread);
      for (const t of [0.5, 1, 2, 5, 30]) expect(surface(m, smear, t, 1).glow).toBe(0);
      // before any swab the residue glows as brightly as anything else
      expect(surface(m, smear, 1, 0).glow).toBe(smear.glow);
    }
  });

  it('residue that looks like a crack (penetrant in a radius, lint, specks) is gone after a swab', () => {
    const m = generateCrack(9, 5, [], 'spar');
    for (const kind of ['trapped', 'lint', 'specks']) {
      const ind = pick(m, kind);
      expect(surface(m, ind, 3, 0).glow).toBeGreaterThan(0.5 * ind.glow);
      for (const t of [0.5, 1, 2, 5]) expect(surface(m, ind, t, 1).glow).toBe(0);
    }
  });

  it('a tool mark is a groove: it bleeds back just like a crack, so only its orientation gives it away', () => {
    for (const s of SEEDS) {
      const m = generateCrack(s, 4);
      const c = pick(m, 'crack');
      const tm = pick(m, 'toolmark');
      for (const t of [0.3, 1, 2, 5]) {
        for (const w of [0, 1, 3]) {
          expect(surface(m, tm, t, w).glow / tm.glow).toBeCloseTo(surface(m, c, t, w).glow / c.glow, 6);
          expect(surface(m, tm, t, w).spread).toBeCloseTo(surface(m, c, t, w).spread, 6);
        }
      }
    }
  });

  it('a scratch comes back faint and crisp; porosity and a bore bleed-out bleed back like the voids they are', () => {
    const m = generateCrack(9, 3, [], 'corrosion');
    const sc = pick(m, 'scratch');
    const c = pick(m, 'crack');
    for (const t of [1, 2, 5]) {
      expect(surface(m, sc, t, 1).spread).toBe(0);
      expect(surface(m, sc, t, 1).glow).toBeLessThan(0.35 * sc.glow);
      expect(surface(m, sc, t, 1).glow).toBeLessThan(surface(m, c, t, 1).glow);
    }
    for (const kind of ['porosity', 'bleedout']) {
      const ind = pick(m, kind);
      expect(surface(m, ind, 2, 1).glow).toBeGreaterThan(0.6 * ind.glow);
    }
  });

  it('each swab drains the flaw a little', () => {
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
    // only what you can see (or already circled, or saw a moment ago) can be snapped to
    const i = nearest(m, m.indications[0].pts[0], 0.05);
    expect(i).toBe(0);
    expect(nearest(m, m.indications[0].pts[0], 0.05, (k) => k !== i)).toBe(-1);
  });

  it('scoring: every crack and nothing else is perfect; a false call costs a quarter, a miss more', () => {
    for (const s of SEEDS) {
      for (const tier of [1, 3, 5]) {
        const m = generateCrack(s, tier);
        const cracks = idxOf(m, (k) => k === 'crack');
        const decoys = idxOf(m, (k) => k !== 'crack');
        expect(scoreCrack(m, cracks).score).toBe(1);
        expect(scoreCrack(m, [...cracks, ...cracks]).score).toBe(1); // a double tap counts once
        expect(scoreCrack(m, [...cracks, decoys[0]]).score).toBeCloseTo(1 - falseCallCost(m.cracks));
        expect(scoreCrack(m, cracks, 1).falseCalls).toBe(1);
        expect(scoreCrack(m, cracks.slice(1)).missed).toBe(1);
        expect(scoreCrack(m, cracks.slice(1)).score).toBeLessThan(scoreCrack(m, [...cracks, decoys[0]]).score);
        expect(scoreCrack(m, decoys).score).toBe(0);
        expect(scoreCrack(m, []).score).toBe(0);
      }
    }
    expect(falseCallCost(3)).toBe(0.25);
  });

  it('circling everything fails from tier 1 (the tutorial still passes)', () => {
    for (const job of JOBS) {
      for (const s of SEEDS) {
        const all = (m: CrackModel) => m.indications.map((_, i) => i);
        const t0 = generateCrack(s, 0, [], job);
        expect(scoreCrack(t0, all(t0)).score).toBeGreaterThanOrEqual(PASS);
        for (let tier = 1; tier <= 5; tier++) {
          const m = generateCrack(s, tier, [], job);
          expect(scoreCrack(m, all(m)).score, `seed ${s} tier ${tier}`).toBeLessThan(PASS);
        }
      }
    }
  });

  it('tiers 0-2 teach the real rules; from tier 3 the model exposes no answer-revealing hints', () => {
    for (const t of [0, 1, 2]) {
      for (const job of JOBS) {
        const m = generateCrack(4, t, [], job);
        expect(m.teach).toBe(true);
        expect(m.hints.length).toBeGreaterThan(0);
        const all = m.hints.join(' ');
        expect(all).toMatch(/bleed/i);
        expect(all).toMatch(/hole/i);
        // no shape shortcut: real cracks under UV are fine lines, not lightning bolts
        expect(all).not.toMatch(/jagged|zig/i);
      }
    }
    for (const t of [3, 4, 5]) {
      for (const s of SEEDS.slice(0, 12)) {
        for (const tools of [[], ['borescope', 'uvPlus']]) {
          const m = generateCrack(s, t, tools);
          expect(m.teach).toBe(false);
          expect(m.hints).toEqual([]);
          expect(Object.keys(m).join(' ')).not.toMatch(/answer|solution|expected|hint(?!s)|dim/i);
        }
      }
    }
  });
});
