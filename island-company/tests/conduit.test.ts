import { describe, expect, it } from 'vitest';
import {
  TABLE,
  TAKE_UP,
  bendPath,
  fitChecks,
  generateConduit,
  scoreConduit,
  solveConduit,
  type Bend,
} from '../src/puzzles/conduit';

describe('conduit puzzle model', () => {
  it('is deterministic per seed', () => {
    expect(generateConduit(42, 3)).toEqual(generateConduit(42, 3));
    expect(generateConduit(42, 5, ['bender'])).toEqual(generateConduit(42, 5, ['bender']));
  });

  it('uses real ½-in EMT field numbers', () => {
    expect(TAKE_UP).toBe(5);
    expect(TABLE[30].mult).toBe(2);
    expect(TABLE[30].shrink).toBe(0.25);
    expect(TABLE[22.5].mult).toBe(2.6);
    expect(TABLE[45].mult).toBeCloseTo(1.414, 3);
    expect(TABLE[10].mult).toBe(6);
    // the multipliers are cosecants, the shrink is csc − cot (to field rounding)
    for (const a of [22.5, 30, 45, 60]) {
      const r = (a * Math.PI) / 180;
      expect(TABLE[a].mult).toBeCloseTo(1 / Math.sin(r), 1);
      expect(Math.abs(TABLE[a].shrink - (1 / Math.sin(r) - 1 / Math.tan(r)))).toBeLessThan(0.08);
    }
  });

  it('a stub marked at height − take-up stands exactly that tall', () => {
    const m = generateConduit(9, 1);
    const { corners } = bendPath(m, [{ at: m.stub - TAKE_UP, angle: 90, dir: 1 }]);
    expect(corners[0].y).toBeCloseTo(0, 6);
    expect(corners[0].heading).toBeCloseTo(0, 6);
  });

  it('every generated instance is solvable with the field table (snapped to ¼ in)', () => {
    for (let tier = 0; tier <= 5; tier++) {
      for (let seed = 1; seed <= 200; seed++) {
        const m = generateConduit(seed, tier);
        const angle = tier === 5 ? 30 : tier === 2 ? 45 : 30;
        const plan = solveConduit(m, angle);
        expect(plan.length).toBe(m.minBends);
        for (const b of plan) expect(b.at).toBeGreaterThanOrEqual(0);
        const f = fitChecks(m, plan);
        expect(f.checks.every((c) => c.ok)).toBe(true);
        expect(f.over).toBe(false);
        expect(scoreConduit(m, [plan])).toBeGreaterThanOrEqual(0.95);
      }
    }
  });

  it('a botched stick scores as botched; a near miss is a pass but not perfect', () => {
    const m = generateConduit(4, 3);
    const good = solveConduit(m, 30);
    expect(scoreConduit(m, [good])).toBe(1);
    // outsider: marks eyeballed from the wall dimensions, no take-up, no multiplier, no shrink
    const naive: Bend[] = [
      { at: m.stub, angle: 90, dir: 1 },
      { at: m.stub + m.x1 - m.rise, angle: 30, dir: 1 },
      { at: m.stub + m.x1, angle: 30, dir: -1 },
    ];
    expect(scoreConduit(m, [naive])).toBeLessThan(0.45);
    // one bend the wrong way (didn't roll the pipe for the second bend of the offset)
    const dogleg = good.map((b, i) => (i === 2 ? { ...b, dir: 1 as const } : b));
    expect(scoreConduit(m, [dogleg])).toBeLessThan(0.6);
    // near miss: second offset mark ¾ in long
    const near = good.map((b, i) => (i === 2 ? { ...b, at: b.at + 0.75 } : b));
    const s = scoreConduit(m, [near]);
    expect(s).toBeGreaterThanOrEqual(0.6);
    expect(s).toBeLessThan(0.95);
    // a second stick can pass but never be perfect
    expect(scoreConduit(m, [naive, good])).toBeLessThan(0.95);
    expect(scoreConduit(m, [naive, good])).toBeGreaterThanOrEqual(0.6);
    // nothing bent
    expect(scoreConduit(m, [])).toBeLessThan(0.1);
  });

  it('enforces the 360° rule and punishes extra bends', () => {
    const m = generateConduit(6, 5);
    expect(m.existing).toBe(90);
    const steep = solveConduit(m, 60); // 90 existing + 90 stub + 4 × 60 = 420°
    const f = fitChecks(m, steep);
    expect(f.degrees).toBe(420);
    expect(f.over).toBe(true);
    expect(scoreConduit(m, [steep])).toBeLessThan(0.75);
    const ok45 = fitChecks(m, solveConduit(m, 45));
    expect(ok45.degrees).toBe(360);
    expect(ok45.over).toBe(false);
    const extra = [...solveConduit(m, 30), { at: 110, angle: 10, dir: 1 as const }];
    expect(fitChecks(m, extra).extra).toBe(1);
    expect(scoreConduit(m, [extra])).toBeLessThan(0.95);
  });

  it('the saddle hugs the obstacle: 3-point centre shrink matters', () => {
    const m = generateConduit(12, 4);
    expect(m.job).toBe('stubSaddle3');
    const plan = solveConduit(m);
    expect(scoreConduit(m, [plan])).toBeGreaterThanOrEqual(0.95);
    // forgot the 3/16 in per inch centre shrink and the spread: centre lands off the pipe
    const noShrink = plan.map((b) => ({ ...b, at: b.at - m.rise * (3 / 16) - 1.5 }));
    expect(scoreConduit(m, [noShrink])).toBeLessThan(0.95);
  });

  it('tiers scale: more bends, tighter tolerance, the 360° budget tightens', () => {
    const at = (t: number) => generateConduit(1, t);
    for (let t = 1; t <= 5; t++) {
      expect(at(t).minBends).toBeGreaterThanOrEqual(at(t - 1).minBends);
      expect(at(t).tol).toBeLessThanOrEqual(at(t - 1).tol);
    }
    expect(at(1).job).toBe('stub');
    expect(at(2).job).toBe('offset');
    expect(at(3).job).toBe('stubOffset');
    expect(at(4).job).toBe('stubSaddle3');
    expect(at(5).job).toBe('stubSaddle4');
    expect(at(5).tol).toBe(0.25);
  });

  it('from tier 3 the model exposes no answer-revealing hints (table only with the bender)', () => {
    for (let tier = 3; tier <= 5; tier++) {
      for (let seed = 1; seed <= 30; seed++) {
        const m = generateConduit(seed, tier);
        expect(m.hints).toEqual([]);
        expect(m.table).toBeNull();
        expect(Object.keys(m).join(' ')).not.toMatch(/answer|solution|marks|expected/i);
        // the bender tool adds the field table (a convenience), still no hints
        const b = generateConduit(seed, tier, ['bender']);
        expect(b.table).not.toBeNull();
        expect(b.hints).toEqual([]);
      }
    }
    expect(generateConduit(1, 2).table).not.toBeNull();
    expect(generateConduit(1, 1).hints.length).toBeGreaterThan(0);
  });
});
