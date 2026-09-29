// The golden digests (docs/EXPANSION.md 13.1 and 11.5): the paper-sim crews on this build, recorded after A0 ("a
// Resort that holds", stage 1) and its review round 1. Later stages (the free map and the objects, then the airline)
// must leave home byte-identical when their new features go unused: with no station opened and no quick check or flag
// made, these runs produce the same bytes, week by week, as the build that recorded them.
//
// Each digest reads every week's island doc after the resolve (so the credits' streak, the stats and every asset's
// health count, not only the week's summary row), the week-by-week table and the final doc. Four runs are 26 weeks;
// four are 52, because tier 5 comes around weeks 21-23 and the network (stage 3) opens two tiers later: 26 weeks
// would cover almost none of the time stage 3 changes (review round 1).
//
// A digest changes only when the game's rules or content change on purpose. When that is the change you meant
// (a balance pass, a new job), re-record with `GOLDEN=print npx vitest run tests/golden.test.ts` and say why in
// docs/DECISIONS.md. When it isn't, something you built leaks into home play: find it.
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { simulate, TEAMS } from '../src/sim/bots';
import { LATE, RECEIVER } from '../src/sim/data';
import { STAFF } from '../src/sim/staff';

// 26- and 52-week sims: CI runners are about 1.5x slower
vi.setConfig({ testTimeout: 60000 });

const RUNS: [team: string, seed: number, weeks: number][] = [
  ['three friends', 1, 26],
  ['three friends', 2, 26],
  ['three friends', 3, 26],
  ['all average', 1, 26],
  ['three friends', 1, 52],
  ['all average', 1, 52],
  ['mistakes', 1, 52],
  // (seed 6: a receivership below $0, a grid-down week and a lapsed-house prep against grid first come up in its 52
  // weeks; seed 1 has an autopilot A at the Resort mid-streak)
  ['mistakes', 6, 52],
];
const key = (team: string, seed: number, weeks: number) => `${team}/${seed}${weeks === 26 ? '' : `/${weeks}`}`;

/** sha-256 (first 16 hex) of the run: every week's doc after its resolve, then the week-by-week table and the final doc */
function digest(team: string, seed: number, weeks: number): string {
  const h = createHash('sha256');
  const { weeks: rows, final } = simulate(TEAMS[team], weeks, seed, (s) => h.update(JSON.stringify(s)));
  h.update(JSON.stringify({ weeks: rows, final }));
  return h.digest('hex').slice(0, 16);
}

/** recorded on branch `gaps` after A0's review round 1 (2026-09-29) */
const GOLDEN: Record<string, string> = {
  'three friends/1': 'cc9a6aa8e8fba3c8',
  'three friends/2': '0f0a613898ab2fb9',
  'three friends/3': '8a69be2862b7bfda',
  'all average/1': '484b906166d6eb52',
  'three friends/1/52': 'd8b2b905df1e0b9a',
  'all average/1/52': 'a4e2259887c7c2b4',
  'mistakes/1/52': '68a2031f75e45211',
  'mistakes/6/52': '58cc0b3bfd028e0c',
};

describe('golden digests: home plays byte-identical (the paper-sim crews, 26 and 52 weeks)', () => {
  for (const [team, seed, weeks] of RUNS) {
    it(`${team}, seed ${seed}, ${weeks} weeks`, () => {
      const d = digest(team, seed, weeks);
      if (process.env.GOLDEN === 'print') console.log(`  '${key(team, seed, weeks)}': '${d}',`);
      expect(d).toBe(GOLDEN[key(team, seed, weeks)]);
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

// Review round 1: the digests were blind to half of A0's levers. Every late-game knob, flipped, must change at least
// one digest (the 52-week runs first: that's where the late game plays). A knob no digest sees is a lever that can
// regress unnoticed.
type Knob = { name: string; flip(): () => void };
const set = <T extends object, K extends keyof T>(o: T, k: K, v: T[K]) => () => {
  const was = o[k];
  o[k] = v;
  return () => {
    o[k] = was;
  };
};
const KNOBS: Knob[] = [
  { name: 'LATE.gridFirst off', flip: set(LATE, 'gridFirst', 0) },
  { name: 'LATE.gridAtRisk off', flip: set(LATE, 'gridAtRisk', false) },
  { name: 'LATE.gridFirstUrgency 0', flip: set(LATE, 'gridFirstUrgency', 0) },
  { name: 'LATE.gridHold off', flip: set(LATE, 'gridHold', 999) },
  { name: 'LATE.darkNoDecay on', flip: set(LATE, 'darkNoDecay', true) },
  { name: 'LATE.inspectionWeeks 8', flip: set(LATE, 'inspectionWeeks', 8) },
  { name: 'LATE.houseWear 2', flip: set(LATE, 'houseWear', 2) },
  { name: 'LATE.healthyDecay 5', flip: set(LATE, 'healthyDecay', { at: 70, decay: 5 }) },
  { name: 'LATE.lowHealthTierBump off', flip: set(LATE, 'lowHealthTierBump', false) },
  { name: 'LATE.streakPause off', flip: set(LATE, 'streakPause', false) },
  { name: "STAFF.helper never (the electrician's helper)", flip: set(STAFF.helper, 'fromTier', 99) },
  { name: 'RECEIVER.allowance 0', flip: set(RECEIVER, 'allowance', 0) },
  { name: 'RECEIVER.standstill off', flip: set(RECEIVER, 'standstill', false) },
];

describe('every late-game knob is seen by a digest (review round 1)', () => {
  const order = [...RUNS].sort((a, b) => b[2] - a[2]);
  for (const k of KNOBS) {
    it(k.name, () => {
      const undo = k.flip();
      try {
        const changed = order.find(([team, seed, weeks]) => digest(team, seed, weeks) !== GOLDEN[key(team, seed, weeks)]);
        expect(changed, `${k.name}: no digest changed`).toBeDefined();
      } finally {
        undo();
      }
    });
  }
});
