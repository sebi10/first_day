// Hydraulic servicing: the rules a real A&P would hold the puzzle to.
import { describe, expect, it } from 'vitest';
import {
  FLUIDS,
  PLACARD_NAMES,
  PRECHARGE_LIMIT,
  absTemp,
  accCapacity,
  canKind,
  emptyRun,
  generateHydraulics,
  hydPressure,
  initState,
  levelCredit,
  pedalStroke,
  prechargeAt,
  prechargeCredit,
  pumpStroke,
  scoreHydraulics,
  type HydModel,
  type HydRun,
} from '../src/puzzles/hydraulics';
import { PASS, PERFECT } from '../src/puzzles/types';

const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const tiers = [0, 1, 2, 3, 4, 5];

/** A clean job: discharged first, placard fluid to FULL, cap on, precharge set for today's temperature, brake bled. */
function clean(m: HydModel, over: Partial<HydRun> = {}): HydRun {
  const fluid = m.shelf.find((f) => m.approved.includes(f))!;
  return {
    ...emptyRun(m),
    poured: { [fluid]: m.full - (m.level0 + m.vf0) },
    level: m.full,
    vf: 0,
    precharge: m.precharge ? m.precharge.target : m.p0,
    bleedStrokes: m.bleed ? m.bleed.air.length + 1 : 0,
    airLeft: 0,
    ...over,
  };
}

describe('hydraulics model', () => {
  it('is deterministic per seed and tier', () => {
    for (const t of tiers) expect(generateHydraulics(42, t)).toEqual(generateHydraulics(42, t));
    expect(generateHydraulics(1, 4)).not.toEqual(generateHydraulics(2, 4));
  });

  it('scaffolding only at tiers 0-2; precharge from tier 3, brake bleed from tier 4, Celsius at tier 5', () => {
    for (const s of seeds) {
      expect(generateHydraulics(s, 2).teach).toBe(true);
      expect(generateHydraulics(s, 3).teach).toBe(false);
      expect(generateHydraulics(s, 2).precharge).toBeNull();
      expect(generateHydraulics(s, 3).precharge?.unit).toBe('F');
      expect(generateHydraulics(s, 5).precharge?.unit).toBe('C');
      expect(generateHydraulics(s, 3).bleed).toBeNull();
      expect(generateHydraulics(s, 4).bleed).not.toBeNull();
      // tier 5 hides one last bubble behind a clear stroke
      const air = generateHydraulics(s, 5).bleed!.air;
      expect(air[air.length - 2]).toBe(0);
      expect(air[air.length - 1]).toBeGreaterThan(0);
    }
    // tighter level band as tiers climb
    expect(generateHydraulics(1, 5).tol).toBeLessThan(generateHydraulics(1, 1).tol);
  });

  it('the placard always approves 5606; the shelf always holds an approved fluid and Skydrol as the trap', () => {
    for (const t of tiers) {
      for (const s of seeds) {
        const m = generateHydraulics(s, t);
        expect(m.approved).toContain('mil5606');
        expect(m.shelf.some((f) => m.approved.includes(f))).toBe(true);
        expect(m.shelf).toContain('skydrol');
        expect(m.shelf.some((f) => !FLUIDS[f].compatible)).toBe(true);
        expect(new Set(m.shelf).size).toBe(m.shelf.length);
      }
    }
    // only mineral / synthetic-hydrocarbon fluids share Buna-N seals
    expect(FLUIDS.mil5606.compatible && FLUIDS.mil83282.compatible).toBe(true);
    expect([FLUIDS.skydrol, FLUIDS.dot3, FLUIDS.turbine, FLUIDS.veg].every((f) => !f.compatible && f.harm.length > 0)).toBe(true);
    // from tier 4 Skydrol and 83282 both read "fire-resistant": only the spec number tells them apart
    expect(canKind('skydrol', 4)).toBe(canKind('mil83282', 4));
    expect(canKind('skydrol', 3)).toContain('phosphate ester');
  });

  it('gas law: precharge scales with absolute temperature (Rankine or Kelvin)', () => {
    expect(prechargeAt(800, 70, 100, 'F')).toBeCloseTo((800 * 559.67) / 529.67, 6);
    expect(prechargeAt(800, 70, 70, 'F')).toBe(800);
    expect(prechargeAt(900, 21, 37, 'C')).toBeCloseTo((900 * 310.15) / 294.15, 6);
    expect(absTemp(0, 'C')).toBeCloseTo(273.15);
    // the ratio is the same whichever absolute scale you use
    expect(prechargeAt(1000, 21.1111, 37.7778, 'C')).toBeCloseTo(prechargeAt(1000, 70, 100, 'F'), 1);
    for (const t of [3, 4, 5]) {
      for (const s of seeds) {
        const pc = generateHydraulics(s, t).precharge!;
        // the temperature correction always matters: copying the placard number is out of limits
        expect(Math.abs(pc.target - pc.ref)).toBeGreaterThan(PRECHARGE_LIMIT * pc.tol);
        // and the bottle as found is out of limits
        expect(Math.abs(generateHydraulics(s, t).p0 - pc.target)).toBeGreaterThan(pc.tol);
      }
    }
  });

  it('accumulator: charged it stores fluid at system pressure; pumping the brakes discharges it to zero', () => {
    for (const t of tiers) {
      for (const s of seeds) {
        const m = generateHydraulics(s, t);
        expect(hydPressure(m, m.p0, m.vf0)).toBeCloseTo(m.sysPsi, 6);
        expect(hydPressure(m, m.p0, 0)).toBe(0);
        // pressure falls with each application, then drops to 0 from the precharge
        const strokes = Math.ceil(m.vf0 / m.strokeVol - 1e-9);
        expect(strokes).toBeGreaterThanOrEqual(2);
        expect(strokes).toBeLessThanOrEqual(8);
        const last = m.vf0 - (strokes - 1) * m.strokeVol;
        expect(hydPressure(m, m.p0, last)).toBeGreaterThan(m.p0);
        expect(hydPressure(m, m.p0, m.vf0 - m.strokeVol)).toBeLessThan(m.sysPsi);
      }
    }
  });

  it('as found the glass reads low under pressure; the fluid comes back when it is discharged', () => {
    for (const t of tiers) {
      for (const s of seeds) {
        const m = generateHydraulics(s, t);
        expect(m.level0).toBeLessThan(m.full - m.tol);
        expect(m.level0 + m.vf0).toBeLessThan(m.full - m.tol); // it really does need fluid
        // topping up to FULL while pressurized overfills once the accumulator discharges
        expect(m.full + m.vf0 - m.full).toBeGreaterThan(m.tol);
        expect(levelCredit(m, m.full + m.vf0)).toBeLessThan(1);
      }
    }
  });
});

describe('hydraulics scoring', () => {
  it('a clean job is perfect at every tier', () => {
    for (const t of tiers) {
      for (const s of seeds.slice(0, 6)) {
        const m = generateHydraulics(s, t);
        const r = scoreHydraulics(m, clean(m));
        expect(r.score).toBe(1);
        expect(r.summary).toMatch(/at FULL/);
      }
    }
  });

  it('doing nothing fails; pumping the pressure off alone earns a little', () => {
    for (const t of tiers) {
      const m = generateHydraulics(3, t);
      const none = scoreHydraulics(m, emptyRun(m)).score;
      expect(none).toBeLessThan(0.25);
      const discharged = scoreHydraulics(m, { ...emptyRun(m), vf: 0 }).score;
      expect(discharged).toBeGreaterThan(none);
      expect(discharged).toBeLessThan(PASS);
    }
  });

  it('filling to FULL under pressure is an overfill and fails at the teaching tiers', () => {
    for (const s of seeds) {
      const m = generateHydraulics(s, 1);
      const r = scoreHydraulics(m, clean(m, { level: m.full + m.vf0, underPressure: m.full - m.level0 }));
      expect(r.score).toBeLessThan(PASS);
      expect(r.summary).toContain('under pressure');
      // drawing it back down to FULL afterwards recovers a pass, not a perfect
      const fixed = scoreHydraulics(m, clean(m, { underPressure: m.full - m.level0 })).score;
      expect(fixed).toBeGreaterThanOrEqual(PASS);
      expect(fixed).toBeLessThan(PERFECT);
    }
  });

  it('a reservoir nowhere near FULL is not serviced, however good the precharge and the bleed', () => {
    for (const t of tiers) {
      for (const s of seeds.slice(0, 6)) {
        const m = generateHydraulics(s, t);
        // bled and charged, then signed off with the level halfway down after the bleed
        const low = scoreHydraulics(m, clean(m, { level: m.add + 0.05 }));
        expect(low.score).toBeLessThan(PASS);
        expect(low.summary).toContain('underfilled');
        // a big overfill (it vents when the system warms) fails too
        expect(scoreHydraulics(m, clean(m, { level: m.full + m.tol + 0.1 })).score).toBeLessThan(PASS);
        // a small miss still passes
        expect(scoreHydraulics(m, clean(m, { level: m.full - m.tol - 0.03 })).score).toBeGreaterThanOrEqual(PASS);
      }
    }
  });

  it('overfill is punished harder than the same underfill', () => {
    const m = generateHydraulics(2, 3);
    for (const d of [0.02, 0.05, 0.1]) {
      expect(levelCredit(m, m.full + m.tol + d)).toBeLessThan(levelCredit(m, m.full - m.tol - d));
    }
    expect(levelCredit(m, m.full + m.tol * 0.9)).toBe(1);
  });

  it('wrong fluid is contamination: capped below a pass however good the rest', () => {
    for (const t of tiers) {
      const m = generateHydraulics(4, t);
      for (const bad of ['skydrol', 'dot3', 'turbine', 'veg'] as const) {
        const r = scoreHydraulics(m, clean(m, { contaminated: bad, poured: { mil5606: 0.1, [bad]: 0.01 } }));
        expect(r.score).toBeLessThan(PASS);
        expect(r.summary).toContain('contaminated');
      }
    }
  });

  it('83282 is fine when the placard lists it, a deviation when it does not', () => {
    const listed = [1, 2, 3, 4, 5, 6, 7, 8].map((s) => generateHydraulics(s, 3)).find((m) => m.approved.includes('mil83282'))!;
    const notListed = [1, 2, 3, 4, 5, 6, 7, 8].map((s) => generateHydraulics(s, 3)).find((m) => !m.approved.includes('mil83282'))!;
    expect(scoreHydraulics(listed, clean(listed, { poured: { mil83282: 0.2 } })).score).toBe(1);
    const dev = scoreHydraulics(notListed, clean(notListed, { poured: { mil83282: 0.2 } }));
    expect(dev.score).toBeLessThan(PERFECT);
    expect(dev.score).toBeGreaterThanOrEqual(PASS);
    expect(dev.summary).toContain('83282 not on this placard');
  });

  it('nitrogen only: shop air costs, moist air in the bottle and oxygen fail', () => {
    const m = generateHydraulics(5, 4);
    expect(scoreHydraulics(m, clean(m, { shopAir: true })).score).toBeLessThan(PERFECT);
    expect(scoreHydraulics(m, clean(m, { shopAir: true, airFrac: 0.3 })).score).toBeLessThan(PASS);
    expect(scoreHydraulics(m, clean(m, { oxygen: true })).score).toBeLessThan(PASS);
  });

  it('precharge: the placard number without the temperature correction is out of limits and fails; a near miss passes', () => {
    for (const t of [3, 4, 5]) {
      for (const s of seeds) {
        const m = generateHydraulics(s, t);
        const pc = m.precharge!;
        expect(prechargeCredit(m, pc.target + pc.tol * 0.9)).toBe(1);
        const uncorrected = scoreHydraulics(m, clean(m, { precharge: pc.ref }));
        expect(uncorrected.score).toBeLessThan(PASS);
        expect(uncorrected.summary).toContain('out of limits');
        expect(scoreHydraulics(m, clean(m, { precharge: m.p0 })).score).toBeLessThan(PASS);
        // just outside the band, inside the limit: a pass, not a perfect
        const near = scoreHydraulics(m, clean(m, { precharge: pc.target - pc.tol * 1.4 })).score;
        expect(near).toBeGreaterThanOrEqual(PASS);
        expect(near).toBeLessThan(PERFECT);
      }
    }
    // worked with hydraulic pressure on: a procedure fault even if the number ends up right
    const m = generateHydraulics(1, 3);
    expect(scoreHydraulics(m, clean(m, { n2UnderPressure: true })).score).toBeLessThan(PERFECT);
  });

  it('brake bleed: the squawk must be worked; air left, running dry and an open bleeder all cost', () => {
    for (const t of [4, 5]) {
      const m = generateHydraulics(6, t);
      const total = m.bleed!.air.reduce((a, b) => a + b, 0);
      expect(scoreHydraulics(m, clean(m, { bleedStrokes: 0, airLeft: total })).score).toBeLessThan(PASS);
      // a token stroke or two with bubbles still coming and the pedal still soft is not a bleed
      for (const s of seeds) {
        const mm = generateHydraulics(s, t);
        const air = mm.bleed!.air;
        const all = air.reduce((a, b) => a + b, 0);
        for (const strokes of [1, 2]) {
          const left = all - air.slice(0, strokes).reduce((a, b) => a + b, 0);
          const r = scoreHydraulics(mm, clean(mm, { bleedStrokes: strokes, airLeft: left }));
          expect(r.score).toBeLessThan(PASS);
          expect(r.summary).toContain('air left in the brake');
        }
        expect(scoreHydraulics(mm, clean(mm, { bleedStrokes: air.length - 1, airLeft: 2 })).score).toBeLessThan(PASS);
      }
      // the odd last bubble (tier 5 hides one behind a clear slug) is a pass, not a perfect
      const oneLeft = scoreHydraulics(m, clean(m, { airLeft: 1 })).score;
      expect(oneLeft).toBeLessThan(PERFECT);
      expect(oneLeft).toBeGreaterThanOrEqual(PASS);
      expect(scoreHydraulics(m, clean(m, { ranDry: 1 })).score).toBeLessThan(PERFECT);
      const open = scoreHydraulics(m, clean(m, { bleederOpen: true }));
      expect(open.score).toBeLessThan(PERFECT);
      expect(open.summary).toContain('bleeder left open');
    }
  });

  it('older placards: the superseded MIL-H or NATO designation, never the can spec; MIL-H-7644 is the near miss', () => {
    const styles = new Set<string>();
    for (const t of tiers) {
      for (const s of [...seeds, 13, 14, 15, 16, 17, 18, 19, 20]) {
        const m = generateHydraulics(s, t);
        styles.add(`${t}:${m.placardStyle}`);
        if (t <= 3) expect(m.placardStyle).toBe('prf');
        if (t === 4) expect(m.placardStyle).not.toBe('nato');
        const [a, b] = PLACARD_NAMES[m.placardStyle];
        expect(m.placardFluid).toBe(m.approved.length > 1 ? `${a} OR ${b}` : a);
        if (m.placardStyle !== 'prf') {
          // the decoy sits on the shelf, and no can prints the placard's designation
          expect(m.shelf).toContain('veg');
          for (const f of m.shelf) {
            expect(FLUIDS[f].spec.includes(a)).toBe(false);
            expect(FLUIDS[f].spec.includes(b)).toBe(false);
          }
          expect(m.shelf.some((f) => m.approved.includes(f))).toBe(true);
          expect(m.shelf).toContain('skydrol');
        }
      }
    }
    expect(styles).toContain('4:milh');
    expect(styles).toContain('5:nato');
    expect(styles).toContain('5:milh');
    // the history: MIL-H-5606 became MIL-PRF-5606, H-515 is 5606 and H-537 is 83282
    expect(PLACARD_NAMES.milh).toEqual(['MIL-H-5606', 'MIL-H-83282']);
    expect(PLACARD_NAMES.nato).toEqual(['NATO H-515', 'H-537']);
  });

  it('the filler cap goes back on', () => {
    const m = generateHydraulics(2, 2);
    const r = scoreHydraulics(m, clean(m, { capOn: false }));
    expect(r.score).toBeLessThan(PERFECT);
    expect(r.summary).toContain('cap left off');
  });
});

describe('hydraulics power brakes', () => {
  it('the pedal discharges the accumulator into the reservoir; at 0 psi it moves nothing', () => {
    for (const t of tiers) {
      const m = generateHydraulics(7, t);
      const s = initState(m);
      const true0 = s.res + s.vf;
      let n = 0;
      while (s.vf > 0 && n < 20) {
        expect(pedalStroke(m, s).kind).toBe('return');
        n++;
      }
      expect(s.vf).toBe(0);
      expect(s.res + s.vf).toBeCloseTo(true0, 9); // the glass now reads the true level
      const before = { ...s };
      // power brakes: no pressure, nothing flows, even with the bleeder open
      s.bleederOpen = true;
      expect(pedalStroke(m, s)).toEqual({ kind: 'idle' });
      expect(s.res).toBe(before.res);
      expect(s.bleedStrokes).toBe(0);
    }
  });

  it('the hand pump charges the accumulator up to the relief setting', () => {
    for (const t of [4, 5]) {
      for (const seed of seeds) {
        const m = generateHydraulics(seed, t);
        const s = { ...initState(m), vf: 0, res: m.full };
        let n = 0;
        let f = pumpStroke(m, s, false);
        while (f.kind === 'charge' && n < 20) {
          n++;
          f = pumpStroke(m, s, false);
        }
        expect(f.kind).toBe('relief');
        expect(n).toBeGreaterThanOrEqual(1);
        expect(s.vf).toBeCloseTo(accCapacity(m, s.p0), 9);
        expect(hydPressure(m, s.p0, s.vf)).toBeCloseTo(m.sysPsi, 6);
        // the glass drops by what went into the accumulator; nothing is lost
        expect(s.res + s.vf).toBeCloseTo(m.full, 9);
      }
    }
  });

  it('bleeding: pressure through the open bleeder flushes one slug of air at a time', () => {
    const m = generateHydraulics(3, 5);
    const air = m.bleed!.air;
    const s = { ...initState(m), vf: 0, res: 0.9 };
    s.bleederOpen = true;
    // pump with the pedal up: charges the accumulator (the brake valve is shut)
    expect(pumpStroke(m, s, false).kind).toBe('charge');
    // pedal: the accumulator pushes a slug out through the bleeder
    const f1 = pedalStroke(m, s);
    expect(f1.kind).toBe('flush');
    expect(f1.kind === 'flush' && f1.bubbles).toBe(air[0]);
    // pump with the pedal held to the floor: straight through the brake
    const res = s.res;
    const f2 = pumpStroke(m, s, true);
    expect(f2.kind === 'flush' && f2.bubbles).toBe(air[1]);
    expect(s.res).toBeCloseTo(res - m.bleed!.pumpVol, 9);
    expect(s.bleedStrokes).toBe(2);
    // closed bleeder: the pedal just returns fluid to the reservoir
    s.bleederOpen = false;
    pumpStroke(m, s, false);
    expect(pedalStroke(m, s).kind).toBe('return');
    expect(s.bleedStrokes).toBe(2);
  });

  it('a top-up to keep ahead of the bleed is not a pressurized level check', () => {
    const m = generateHydraulics(3, 4);
    const s = { ...initState(m), underPressure: 0.2, bleederOpen: true, res: 0.8 };
    pedalStroke(m, s);
    expect(s.underPressure).toBe(0);
  });

  it('pumping the reservoir down to the standpipe draws air into the brake', () => {
    const m = generateHydraulics(3, 4);
    const s = { ...initState(m), vf: 0, res: m.outlet + 0.02, bleederOpen: true };
    const left = s.airQ.reduce((a, b) => a + b, 0);
    const f = pumpStroke(m, s, true);
    expect(f.kind === 'flush' && f.air).toBe(true);
    expect(s.ranDry).toBe(1);
    expect(s.dry).toBe(true);
    expect(s.res).toBeCloseTo(m.outlet, 9);
    // more air in the line than before, less the slug that just went out
    expect(s.airQ.reduce((a, b) => a + b, 0)).toBeGreaterThan(left - m.bleed!.air[0]);
    // topped up again, the next stroke is clean
    s.res = 0.7;
    const g = pumpStroke(m, s, true);
    expect(g.kind === 'flush' && g.air).toBe(false);
    expect(s.dry).toBe(false);
    expect(s.ranDry).toBe(1);
  });
});
