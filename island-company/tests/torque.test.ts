import { describe, expect, it } from 'vitest';
import { boltScore, generateTorque, scoreTorque, starSequence } from '../src/puzzles/torque';

describe('torque puzzle model', () => {
  it('star sequence visits every bolt once and pairs opposites', () => {
    for (const n of [4, 6, 8]) {
      const s = starSequence(n, 1);
      expect(new Set(s).size).toBe(n);
      for (let i = 0; i < n; i += 2) expect((s[i + 1] - s[i] + n) % n).toBe(n / 2);
    }
  });
  it('is deterministic per seed', () => {
    expect(generateTorque(42, 3)).toEqual(generateTorque(42, 3));
  });
  it('perfect run scores 1, sloppy run scores low', () => {
    const m = generateTorque(7, 4);
    expect(scoreTorque(m, new Array(m.bolts).fill(m.target), 0)).toBe(1);
    const sloppy = scoreTorque(m, new Array(m.bolts).fill(m.target * 1.5), 2);
    expect(sloppy).toBeLessThan(0.3);
  });
  it('under-torque gets partial credit, overshoot is punished harder', () => {
    expect(boltScore(40, 50, 0.1)).toBeGreaterThan(boltScore(60, 50, 0.1));
  });
});
