// The golden digests (docs/EXPANSION.md 13.1 and 11.5): 26 weeks of the paper-sim crews on this build, recorded
// after A0 ("a Resort that holds", stage 1). Later stages (the free map and the objects, then the airline) must leave
// home byte-identical when their new features go unused: with no station opened and no quick check or flag made,
// these runs produce the same JSON, week by week, as the build that recorded them.
//
// A digest changes only when the game's rules or content change on purpose. When that is the change you meant
// (a balance pass, a new job), re-record with `GOLDEN=print npx vitest run tests/golden.test.ts` and say why in
// docs/DECISIONS.md. When it isn't, something you built leaks into home play: find it.
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { simulate, TEAMS } from '../src/sim/bots';

// 26-week sims: CI runners are about 1.5x slower
vi.setConfig({ testTimeout: 30000 });

const RUNS: [team: string, seed: number][] = [
  ['three friends', 1],
  ['three friends', 2],
  ['three friends', 3],
  ['all average', 1],
];

/** sha-256 (first 16 hex) of the whole run as JSON: the week-by-week table and the island doc at week 26 */
function digest(team: string, seed: number): string {
  const { weeks, final } = simulate(TEAMS[team], 26, seed);
  return createHash('sha256').update(JSON.stringify({ weeks, final })).digest('hex').slice(0, 16);
}

/** recorded on branch `gaps` after A0 (2026-09-29) */
const GOLDEN: Record<string, string> = {
  'three friends/1': 'f57d2673d04e9c02',
  'three friends/2': '6481f5e78860a47a',
  'three friends/3': '8af11afd891dcd20',
  'all average/1': 'ad8e2b5e096194ae',
};

describe('golden digests: home plays byte-identical (26 weeks, the paper-sim crews)', () => {
  for (const [team, seed] of RUNS) {
    it(`${team}, seed ${seed}`, () => {
      const d = digest(team, seed);
      if (process.env.GOLDEN === 'print') console.log(`  '${team}/${seed}': '${d}',`);
      expect(d).toBe(GOLDEN[`${team}/${seed}`]);
    });
  }

  it('the digest sees a one-dollar change anywhere in the run', () => {
    const { weeks, final } = simulate(TEAMS['all average'], 3, 1);
    const a = createHash('sha256').update(JSON.stringify({ weeks, final })).digest('hex');
    final.cash += 1;
    const b = createHash('sha256').update(JSON.stringify({ weeks, final })).digest('hex');
    expect(a).not.toBe(b);
  });
});
