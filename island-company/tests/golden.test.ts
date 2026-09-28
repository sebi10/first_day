// The golden identity (docs/EXPANSION.md 0.2 rule 2, 11.5.1, 13.1): with no
// quick check and no flag ever used, this build plays tiers 1-5 byte for byte as
// the base build did. The digests below are sha256 of JSON.stringify of the island
// after 26 weeks, recorded on the base commit (258d0d2, branch `gaps`) in a
// throwaway worktree of it, with that build's own bots. Stage 1 (A0) is allowed to
// change play from tier 4: whoever merges it re-records them (the same script:
// simulate(TEAMS[team], 26, seed) on the merged base, then this file's hashes).
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { simulate, TEAMS } from '../src/sim/bots';
import { migrate } from '../src/sim/migrate';
import { cloneState } from '../src/sim/engine';
import { baseCrew } from './crews';

vi.setConfig({ testTimeout: 30000 });

/** recorded on 258d0d2 */
const GOLDEN: Record<string, string> = {
  'three friends:1': 'e59dc761f6ff261922d90ff5c4852e294c6abf1cd73456ba3439b4dca385827b',
  'three friends:2': '668bbb56847845f7c8d8caa68ebdae2342759a180c7903bba8907e5efb5f7fbe',
  'three friends:3': '81be3f1733f072d235588cd1f3268fda9407abdfbaa4c853d0659e8bb89865ac',
  'all average:1': 'a643ac84dac8d73be5d21ff13642bc85ec946340d6365088c0398ae64d305317',
};

const digest = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');

describe('the golden identity: no quick checks, no flags', () => {
  for (const [key, want] of Object.entries(GOLDEN)) {
    const [team, seed] = key.split(':');
    it(`${team}, seed ${seed}: 26 weeks give the base build's digest, and nothing stage 2 is written`, () => {
      const { final } = simulate(baseCrew(TEAMS[team]), 26, Number(seed));
      expect(digest(final)).toBe(want);
      // new fields are written only when first used (0.2 rule 2)
      expect(final.checked).toBeUndefined();
      expect(final.flagged).toBeUndefined();
      expect((final.alerts ?? []).some((a) => a.src === 'check' || a.src === 'flag' || a.early)).toBe(false);
      // migrate() adds nothing (10.2)
      expect(JSON.stringify(migrate(cloneState(final)))).toBe(JSON.stringify(final));
    });
  }

  it('the crews with checks and flags on (the default) really do play differently: the proof above is not vacuous', () => {
    const { final } = simulate(TEAMS['three friends'], 26, 1);
    expect(digest(final)).not.toBe(GOLDEN['three friends:1']);
    expect(final.checked).toBeDefined();
  });
});
