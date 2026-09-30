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
// (`baseCrew`, tests/crews.ts): the bots' checks and flags have their own rng streams, so with them off a run was byte
// for byte stage 1's (e810cc5), nothing stage 2 is written to any week's doc, and migrate() adds nothing. G0 (stage 2's
// upkeep structure: the warranty, the service upgrade, renovations) changes tier 4+ play on purpose, so the digests
// were re-recorded with it; its knobs are in the list below, and each one moves a digest.
//
// A digest changes only when the game's rules or content change on purpose. When that is the change you meant
// (a balance pass, a new job), re-record with `GOLDEN=print npx vitest run tests/golden.test.ts` and say why in
// docs/DECISIONS.md. When it isn't, something you built leaks into home play: find it.
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { simulate, TEAMS } from '../src/sim/bots';
import { GOAL, LATE, RECEIVER, RENO, RENO_BOT, WARRANTY } from '../src/sim/data';
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
  // (G0: with the upkeep structure the runs above reach a grid at real risk or a receivership less often: mistakes seed
  // 10 brings grid first's at-risk test into play, and the nobody crew's receivership the receiver's terms)
  ['mistakes', 10, 52],
  ['nobody', 1, 26],
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
 * Re-recorded for stage 2 review round 2 (2026-09-30; DECISIONS "stage 2 review round 2"), all eleven, for what the round
 * changed on purpose. Checked run by run against the round-1 build's docs with the words mapped back and the new field
 * dropped: identical but for these. (1) A house's spa circuit on record (`Asset.spa`, written when a hot-tub job is signed
 * off: every run has one), and a later hot-tub take-off on that house re-runs that circuit at its own amps and wire (its
 * parts, its labour). (2) The Resort's upgrade retires the old standby set's unfinished work (mistakes 6 and 10: a ready
 * or waiting job cancelled, its labour back). (3) Words the docs store: a panel breaker or lug repair (not a dead
 * circuit's), "a tingle at the shower valve" (not "guest at Cottage 1 felt a tingle"), a renovation waiting on its
 * county final, the electrician's final prep. The checks' and flags' fixes don't move a digest (these crews play with
 * both off), nor do the flagged hazard's (flags off).
 *
 * Re-recorded for stage 2 review round 1 (2026-09-30; DECISIONS "stage 2 review round 1"): G0's play at tier 4+ on
 * purpose, the seven runs that reach the Harbor's renovations or the Resort (the three 26-week three-friends runs and
 * the nobody crew are unchanged): the Resort's 200 A transfer switch retires the take-off to upsize the old one for good,
 * and a replacement while its warranty runs (and closes the open alerts about the old one), a renovation's package is capex off the house's repair ledger, a house closed for its
 * renovation never catches fire or draws a guest's no-fault complaint, its 85 lands at the final (then the final's own
 * points), a longer builder's warranty is kept, the final waits on an open hazard, and autopilot buys an ordered
 * renovation's materials past its cap. The checks' and flags' fixes don't move a digest (these crews play with both off).
 *
 * Re-recorded for G0 (stage 2, v5, 2026-09-30; DECISIONS "G0: the Resort holds"), which changes tier 4+ play on
 * purpose: new construction from the Harbor under the builder's warranty, the service upgrade with tiers 4 and 5, the
 * fin bot's renovations (and the builder it keeps at the Resort for them), and every week's report saying whether it was
 * played in receivership (`rcv`, which is why the nobody crew's digest moved too). The credits' default rule is
 * unchanged ('streak'). Before that: recorded on branch `gaps` at the stage 1 release gate (2026-09-29), the
 * electrician's helper held back.
 */
const GOLDEN: Record<string, string> = {
  'three friends/1': 'b085d876cbac70bb',
  'three friends/2': '385eb139c7e2c98a',
  'three friends/3': '9c7c180130a50095',
  'all average/1': '847d24fb23646aa9',
  'three friends/1/52': 'cc9ad033761ddef0',
  'all average/1/52': '257fff5ea79e9c1a',
  'mistakes/1/52': '8a9ef04a84f31864',
  'mistakes/6/52': 'e20e001da75acf50',
  'all average/4/52': '8fba0028910e203c',
  'mistakes/10/52': '86e0a5504ae01c21',
  'nobody/1': 'aae7feb694b3f26a',
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
  // (G0: LATE.gridHold and LATE.darkNoDecay are dormant with the upkeep structure: no run of 60 three-friends and
  // mistakes seasons, 52 weeks each, has a lapsed house's prep against a grid at risk or a dark house at tier 4+.
  // They stay as knobs; no digest can see them)
  { name: 'LATE.inspectionWeeks 8', flip: set(LATE, 'inspectionWeeks', 8) },
  { name: 'LATE.houseWear 2', flip: set(LATE, 'houseWear', 2) },
  { name: 'LATE.healthyDecay 5', flip: set(LATE, 'healthyDecay', { at: 70, decay: 5 }) },
  { name: 'LATE.lowHealthTierBump off', flip: set(LATE, 'lowHealthTierBump', false) },
  { name: 'LATE.streakPause off', flip: set(LATE, 'streakPause', false) },
  // (held back for stage 1: the knob turns it on, and a digest must see it; the release gate)
  { name: "STAFF.helper on (the electrician's helper, held back)", flip: set(STAFF.helper, 'enabled', true) },
  { name: 'RECEIVER.allowance 0', flip: set(RECEIVER, 'allowance', 0) },
  { name: 'RECEIVER.standstill off', flip: set(RECEIVER, 'standstill', false) },
  // G0 (stage 2's upkeep structure)
  { name: 'WARRANTY off (no builder’s warranty on new construction)', flip: set(WARRANTY, 'fromTier', 99) },
  { name: 'WARRANTY.service off (no service upgrade)', flip: set(WARRANTY, 'service', { grid: false, gen: false }) },
  { name: 'RENO_BOT.trigger 0 (the fin bot renovates nothing)', flip: set(RENO_BOT, 'trigger', 0) },
  { name: "GOAL.rule quarter (the G0 synthesis's credits: two months on plan at the Resort)", flip: set(GOAL, 'rule', 'quarter') },
  { name: 'RENO.cooldown 0 (a house can be renovated again at once)', flip: set(RENO, 'cooldown', 0) },
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
