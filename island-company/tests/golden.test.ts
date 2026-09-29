// The golden digests (docs/EXPANSION.md 13.1 and 11.5): the paper-sim crews on this build, recorded after A0 ("a
// Resort that holds", stage 1) and its review round 1. Later stages (the free map and the objects, then the airline)
// must leave home byte-identical when their new features go unused: with no station opened and no quick check or flag
// made, these runs produce the same bytes, week by week, as the build that recorded them.
//
// Each digest reads every week's island doc after the resolve (so the credits' streak, the stats and every asset's
// health count, not only the week's summary row), the week-by-week table and the final doc. Four runs are 26 weeks;
// five are 52, because tier 5 comes around weeks 21-23 and the network (stage 3) opens two tiers later: 26 weeks
// would cover almost none of the time stage 3 changes (review round 1).
//
// Stage 2 (the free map, the objects, quick checks and Report a problem) runs these crews with checks and flags off
// (`baseCrew`, tests/crews.ts): the bots' checks and flags have their own rng streams, so with them off a run must be
// byte for byte stage 1's (e810cc5), nothing stage 2 is written to any week's doc, and migrate() adds nothing.
//
// A digest changes only when the game's rules or content change on purpose. When that is the change you meant
// (a balance pass, a new job), re-record with `GOLDEN=print npx vitest run tests/golden.test.ts` and say why in
// docs/DECISIONS.md. When it isn't, something you built leaks into home play: find it.
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { simulate, TEAMS } from '../src/sim/bots';
import { LATE, RECEIVER } from '../src/sim/data';
import { cloneState } from '../src/sim/engine';
import { migrate } from '../src/sim/migrate';
import { STAFF } from '../src/sim/staff';
import type { IslandState } from '../src/sim/types';
import { baseCrew } from './crews';

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
  // weeks)
  ['mistakes', 6, 52],
  // (autopilot A weeks at the Resort, weeks 28 and 29: the streak's pause. Added at the release gate: with the helper
  // held back no other run has one, and the pause's knob went unseen)
  ['all average', 4, 52],
];
const key = (team: string, seed: number, weeks: number) => `${team}/${seed}${weeks === 26 ? '' : `/${weeks}`}`;

/** nothing stage 2 is written to a doc no check or flag touched (EXPANSION 0.2 rule 2, 10.2) */
const stage2Free = (s: IslandState) =>
  s.checked === undefined && s.flagged === undefined && !(s.alerts ?? []).some((a) => a.src === 'check' || a.src === 'flag' || a.early);

/**
 * sha-256 (first 16 hex) of the run: every week's doc after its resolve, then the week-by-week table and the final
 * doc. The crews play with quick checks and flags off (stage 2 unused); `leaks` counts the weeks a doc carried a
 * stage-2 field anyway.
 */
function run(team: string, seed: number, weeks: number): { d: string; leaks: number; final: IslandState } {
  const h = createHash('sha256');
  let leaks = 0;
  const { weeks: rows, final } = simulate(baseCrew(TEAMS[team]), weeks, seed, (s) => {
    if (!stage2Free(s)) leaks++;
    h.update(JSON.stringify(s));
  });
  h.update(JSON.stringify({ weeks: rows, final }));
  return { d: h.digest('hex').slice(0, 16), leaks, final };
}
const digest = (team: string, seed: number, weeks: number) => run(team, seed, weeks).d;

/**
 * recorded on branch `gaps` at the stage 1 release gate (2026-09-29): the electrician's helper held back (the hiring
 * board's draw from tier 4 no longer deals one, and the bots never hire one), the helper narrowed, grid first's
 * must-do no longer masked by an open dock job, the receiver's loan and lines. With the helper turned on, three friends
 * 2 and 3 and all average 1 (26 weeks) reproduce A0 review round 1's digests byte for byte: the draw is all that moved
 * them. The other five hire a helper by week 26 or 52 (DECISIONS "2026-09-29: stage 1 release gate").
 */
const GOLDEN: Record<string, string> = {
  'three friends/1': '071e528f29483b3d',
  'three friends/2': '43b9c878f6f837bc',
  'three friends/3': 'a0ec170f630d1a13',
  'all average/1': '937e3050847406e4',
  'three friends/1/52': 'ab9b41004c895af5',
  'all average/1/52': '48b2a3225eb43677',
  'mistakes/1/52': '4c3d13c0ec4bb2b7',
  'mistakes/6/52': 'e6495f91e0d3f02e',
  'all average/4/52': '2f13f83531354526',
};

describe('golden digests: home plays byte-identical (the paper-sim crews, 26 and 52 weeks)', () => {
  for (const [team, seed, weeks] of RUNS) {
    it(`${team}, seed ${seed}, ${weeks} weeks`, () => {
      const { d, leaks, final } = run(team, seed, weeks);
      if (process.env.GOLDEN === 'print') console.log(`  '${key(team, seed, weeks)}': '${d}',`);
      expect(d).toBe(GOLDEN[key(team, seed, weeks)]);
      // stage 2 unused: no week's doc carries its fields, and migrate() adds nothing
      expect(leaks).toBe(0);
      expect(JSON.stringify(migrate(cloneState(final)))).toBe(JSON.stringify(final));
    });
  }

  it('the crews with checks and flags on (the default) really do play differently: the identity above is not vacuous', () => {
    const { final } = simulate(TEAMS['three friends'], 26, 1);
    const h = createHash('sha256');
    expect(final.checked).toBeDefined();
    expect(h.update(JSON.stringify(final)).digest('hex')).not.toBe(createHash('sha256').update(JSON.stringify(run('three friends', 1, 26).final)).digest('hex'));
  });

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
  // (held back for stage 1: the knob turns it on, and a digest must see it; the release gate)
  { name: "STAFF.helper on (the electrician's helper, held back)", flip: set(STAFF.helper, 'enabled', true) },
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
