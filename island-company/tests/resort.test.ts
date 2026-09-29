// A0, "a Resort that holds" (docs/EXPANSION.md 11.2, docs/DECISIONS.md "2026-09-29: A0"): the late game's upkeep
// rules from tier 4 (data LATE), one lever at a time, then in whole seasons:
//   (e) grid first: the grid's feed at real risk (under 55, and the generator can't carry the houses or a week's decay
//       and a storm would take it under 40) is a must-do that ranks above code prep (the bots, autopilot, the Dock),
//       unless the prep reopens a closed house at this resolve and the grid holds at 48+ (review round 1)
//   (g) the spiral breaker, a dark house not decaying: dropped in review round 1 (the knob stays, off)
//   (a) code inspections every 13 weeks
//   (b) a booked week wears a house 1, not 2
//   (c) a maintained asset (70+) decays 3 a week, not 5, planes and home assets alike
//   (d) no "+1 alert tier under 50" (tested, not kept: no measurable effect)
//   (f) the credits' A streak pauses on an autopilot week graded A (it still doesn't count); only weeks played at
//       the Resort count (review round 1: a Harbor streak paid out the week the Resort arrived)
// Tiers 1-3 play exactly as before.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { alertTier, generateAlerts, liveAlerts, raiseAlert } from '../src/sim/alerts';
import { botTurn, simulate, TEAMS } from '../src/sim/bots';
import { ALERTS, ECON, GOAL, LATE } from '../src/sim/data';
import { aStreakAfter, atResort, bookInspection, creditsStreak, decayOf, FEED_KINDS, gridFirst, gridFirstAlert, gridFirstJob, houseWearOf, inspectionWeeks, renewedInspection, urgency } from '../src/sim/econ';
import { apply, createIsland } from '../src/sim/engine';
import { hashSeed, rng } from '../src/sim/rng';
import { flagsOf } from '../src/ui/flow/words';
import { dockNext, yourMoves } from '../src/ui/select';
import { STAFF } from '../src/sim/staff';
import { ROLES, type Asset, type IslandState, type Order, type Role } from '../src/sim/types';

// whole-season sims below (52 weeks): CI runners are about 1.5x slower, and the three longest get 120 s each
vi.setConfig({ testTimeout: 30000 });

const NOW = Date.UTC(2026, 8, 26, 10);
const load = (name: string): IslandState => JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures', `${name}.json`), 'utf8'));

function started(): IslandState {
  let s = createIsland({ id: 'a0', name: 'Resort Isle', now: NOW, tz: 'Europe/Paris', seed: 42, creator: { uid: 'a', name: 'Ana', role: 'mech' } });
  s = apply(s, { t: 'join', uid: 'b', name: 'Ben', role: 'elec' }, NOW).s;
  s = apply(s, { t: 'join', uid: 'c', name: 'Cy', role: 'fin' }, NOW).s;
  for (const r of ROLES) s = apply(s, { t: 'week0Done', role: r }, NOW).s;
  return s;
}

/** an island in week `week` at `tier`, past the teaching weeks and everyone's grace */
function at(tier: number, week = 12): IslandState {
  const s = started();
  s.tier = tier;
  s.week = week;
  for (const r of ROLES) s.players[r]!.graceUntil = 0;
  return s;
}

/** a legacy (pre-flow) job on an asset, ready to play */
function job(s: IslandState, over: Partial<Order>): Order {
  const o: Order = {
    id: `t${s.nextId++}`,
    role: 'elec',
    kind: 'codeprep',
    assetId: 'h1',
    title: 'Code inspection prep',
    puzzle: 'panel',
    tier: 1,
    cost: 150,
    parts: 0,
    gain: 6,
    createdWeek: s.week,
    deferrals: 0,
    lastDeferredWeek: null,
    status: 'ready',
    seed: 77,
    ...over,
  };
  s.orders.push(o);
  return o;
}

/** end the given seats' turns and resolve the week (at the deadline, so an empty seat runs on autopilot) */
function endWeek(s: IslandState, seats: Role[] = [...ROLES]): IslandState {
  const W = s.week;
  let x = s;
  for (const r of seats) if (!x.turns[r]?.ended) x = apply(x, { t: 'endTurn', role: r, week: W }, NOW).s;
  if (x.week === W) x = apply(x, { t: 'resolve', week: W }, (x.deadline ?? NOW) + 1000).s;
  expect(x.week).toBe(W + 1);
  return x;
}

const asset = (s: IslandState, id: string) => s.assets.find((a) => a.id === id)!;
const grid = (s: IslandState) => s.assets.find((a) => a.kind === 'grid')!;

describe('A0 levers, one at a time (from tier 4; tiers 1-3 as before)', () => {
  it('(a) the county inspects every 8 weeks before tier 4 and every 13 from tier 4; the certificate still runs from the booked date', () => {
    expect(inspectionWeeks(1)).toBe(ECON.houseInspectionWeeks);
    expect(inspectionWeeks(3)).toBe(8);
    expect(inspectionWeeks(4)).toBe(LATE.inspectionWeeks);
    expect(inspectionWeeks(5)).toBe(13);
    const W = 30;
    const s4 = { tier: 4, assets: [] as Asset[] };
    const s3 = { tier: 3, assets: [] as Asset[] };
    expect(renewedInspection(s4, { id: 'h1', inspectionUntil: W + 2 }, W)).toBe(W + 2 + 13);
    expect(renewedInspection(s4, { id: 'h1', inspectionUntil: W - 3 }, W)).toBe(W + 13);
    expect(renewedInspection(s3, { id: 'h1', inspectionUntil: W + 2 }, W)).toBe(W + 2 + 8);
  });

  it('(a) a code prep signed off at tier 4 books the next inspection 13 weeks after the booked date; at tier 3, 8', () => {
    for (const [tier, weeks] of [
      [3, 8],
      [4, 13],
    ] as const) {
      let s = at(tier);
      const W = s.week;
      asset(s, 'h1').inspectionUntil = W + 2;
      const o = job(s, { assetId: 'h1' });
      s = apply(s, { t: 'complete', role: 'elec', orderId: o.id, score: 0.9, perfect: false, week: W }, NOW).s;
      expect(asset(s, 'h1').inspectionUntil, `tier ${tier}`).toBe(bookInspection(s, 'h1', W + 2 + weeks));
    }
  });

  it('(a) the villas that come with tier 4 get their first notices 13 weeks out, a week of their own each', () => {
    let tier4 = 0;
    let s: IslandState | undefined;
    simulate(TEAMS['three friends'], 20, 1, (x) => {
      if (!tier4 && x.tier === 4) {
        tier4 = x.stats.tierReachedWeek[4]!;
        s = structuredClone(x);
      }
    });
    expect(s).toBeDefined();
    const due = ['h5', 'h6'].map((id) => asset(s!, id).inspectionUntil!);
    for (const d of due) {
      expect(d).toBeGreaterThanOrEqual(tier4 + 13 - 2);
      expect(d).toBeLessThanOrEqual(tier4 + 13 + 3);
    }
    expect(due[0]).not.toBe(due[1]);
  });

  it('(b) a booked week wears a house 2 before tier 4 and 1 from tier 4', () => {
    expect(houseWearOf({ tier: 3 })).toBe(ECON.houseWear);
    expect(houseWearOf({ tier: 3 })).toBe(2);
    expect(houseWearOf({ tier: 4 })).toBe(1);
    expect(houseWearOf({ tier: 5 })).toBe(LATE.houseWear);
  });

  it('(c) from tier 4 a maintained asset (70 or more) loses 3 a week untouched, planes and home assets alike; under 70, and before tier 4, 5', () => {
    for (const kind of ['plane', 'house', 'grid', 'generator'] as const) {
      expect(decayOf({ tier: 4 }, { kind, health: 70 }), kind).toBe(LATE.healthyDecay.decay);
      expect(decayOf({ tier: 5 }, { kind, health: 95 }), kind).toBe(3);
      expect(decayOf({ tier: 4 }, { kind, health: 69.9 }), kind).toBe(ECON.decay);
      expect(decayOf({ tier: 3 }, { kind, health: 95 }), kind).toBe(5);
    }
  });

  it('(c) in the resolve: an untouched plane at 80 loses 3 at tier 4 and 5 at tier 3 (a clear week, nothing on it)', () => {
    for (const [tier, loss] of [
      [3, 5],
      [4, 3],
    ] as const) {
      let s = at(tier);
      s.weather = 'clear';
      s.orders = [];
      s.alerts = [];
      // parked: tagged out, so it flies nothing and wears only by the week's decay
      s = apply(s, { t: 'tag', role: 'mech', assetId: 'p1', on: true }, NOW).s;
      asset(s, 'p1').health = 80;
      asset(s, 'p1').touchedWeek = s.week - 1;
      s = endWeek(s);
      expect(asset(s, 'p1').health, `tier ${tier}`).toBe(80 - loss);
    }
  });

  it('(g, dropped in review round 1) a house dark all week decays like any other: a house with no power rots faster, not slower; the knob would stop it', () => {
    expect(LATE.darkNoDecay).toBe(false);
    expect(decayOf({ tier: 4 }, { kind: 'house', health: 50 }, true)).toBe(5);
    expect(decayOf({ tier: 4 }, { kind: 'house', health: 90 }, true)).toBe(3);
    LATE.darkNoDecay = true;
    try {
      expect(decayOf({ tier: 4 }, { kind: 'house', health: 50 }, true)).toBe(0);
      expect(decayOf({ tier: 4 }, { kind: 'plane', health: 50 }, true)).toBe(5);
      expect(decayOf({ tier: 3 }, { kind: 'house', health: 50 }, true)).toBe(5);
    } finally {
      LATE.darkNoDecay = false;
    }
    // in the resolve: a grid-down week at tier 4, the houses dark (no generator to carry them), and they decay
    let s = at(4);
    s.weather = 'clear';
    s.orders = [];
    s.alerts = [];
    grid(s).health = 20;
    const gen = s.assets.find((a) => a.kind === 'generator');
    if (gen) gen.health = 20;
    for (const h of s.assets.filter((a) => a.kind === 'house')) {
      h.health = 55;
      h.touchedWeek = s.week - 1;
    }
    s = endWeek(s, ['mech', 'fin']);
    const untouched = s.assets.filter((a) => a.kind === 'house' && a.touchedWeek < s.week - 1);
    expect(untouched.length).toBeGreaterThan(0);
    for (const h of untouched) expect(h.health, h.id).toBe(55 - ECON.decay);
  });

  it('(d, tested and not kept) an asset under 50 still raises its alert a tier at every island tier; the knob would stop it from tier 4', () => {
    const cases = (bump: boolean) =>
      [
        [3, 60, 2],
        [3, 40, 3],
        [4, 60, 3],
        [4, 40, bump ? 4 : 3],
        [5, 40, bump ? 4 : 3],
      ] as const;
    expect(LATE.lowHealthTierBump).toBe(true);
    for (const bump of [true, false]) {
      LATE.lowHealthTierBump = bump;
      try {
        for (const [tier, hp, want] of cases(bump)) {
          const s = at(tier);
          expect(s.week).toBeGreaterThanOrEqual((s.flowSince ?? 1) + ALERTS.teachWeeks);
          asset(s, 'h1').health = hp;
          expect(alertTier(s, { assetId: 'h1' }, 'elec'), `bump ${bump}, tier ${tier} at ${hp}`).toBe(want);
        }
      } finally {
        LATE.lowHealthTierBump = true;
      }
    }
  });

  it('(e) grid first: the grid under 55 at tier 4 outranks code prep (the bots, autopilot and the Dock sort by urgency); at tier 3 it does not', () => {
    for (const tier of [3, 4]) {
      const s = at(tier);
      grid(s).health = 50;
      asset(s, 'h1').health = 40;
      // the house's certificate is current (its prep doesn't reopen it at this resolve)
      asset(s, 'h1').inspectionUntil = s.week + 1;
      const feeder = job(s, { kind: 'feeder', assetId: grid(s).id, title: 'Find and re-splice the cottage feeder', puzzle: 'trace', tier: 2, gain: 16 });
      const prep = job(s, { kind: 'codeprep', assetId: 'h1', deferrals: 2 });
      expect(gridFirst(s), `tier ${tier}`).toBe(tier >= 4);
      const first = [feeder, prep].sort((a, b) => urgency(s, b) - urgency(s, a))[0];
      expect(first.kind, `tier ${tier}`).toBe(tier >= 4 ? 'feeder' : 'codeprep');
    }
    // 55 and over it's ordinary work again
    const s = at(4);
    grid(s).health = 55;
    expect(gridFirst(s)).toBe(false);
  });

  it('(e, review round 1) grid first only at real risk: a grid at 53 the generator carries is ordinary work; with the generator under 50, or at 52, it goes first', () => {
    const s = at(4);
    const gen: Asset = { id: 'gen', kind: 'generator', model: 'gen', name: 'Generator house', health: 66, touchedWeek: s.week };
    s.assets.push(gen);
    grid(s).health = 53;
    // 53 - 5 (decay) - 8 (a storm) = 40: not under 40 by the next resolve, and the generator carries every house anyway
    expect(gridFirst(s)).toBe(false);
    grid(s).health = 52;
    expect(gridFirst(s)).toBe(true);
    grid(s).health = 54;
    gen.health = 45;
    expect(gridFirst(s)).toBe(true);
  });

  it("(e, review round 1) grid first is the island feed: a fuel-dock alert on the grid gets no chip, no urgency bonus and no place ahead", () => {
    const s = at(4);
    s.orders = [];
    s.alerts = [];
    grid(s).health = 45;
    const dock = raiseAlert(s, { role: 'elec', asset: grid(s), sym: 'E_DOCK_TRIP', due: s.week + 1 }, NOW);
    const feed = raiseAlert(s, { role: 'elec', asset: grid(s), sym: 'E_FEEDER_DROP', due: s.week + 1 }, NOW);
    expect(gridFirstAlert(s, feed)).toBe(true);
    expect(gridFirstAlert(s, dock)).toBe(false);
    expect(flagsOf(s, feed).some((f) => f.text === 'grid first')).toBe(true);
    expect(flagsOf(s, dock).some((f) => f.text === 'grid first')).toBe(false);
    const run = job(s, { kind: 'dockrun', assetId: grid(s).id, title: 'Conduit run to the fuel dock', puzzle: 'conduit', tier: 3, gain: 18 });
    const splice = job(s, { kind: 'feeder', assetId: grid(s).id, title: 'Find and re-splice the cottage feeder', puzzle: 'trace', tier: 3, gain: 16 });
    expect(gridFirstJob(s, run)).toBe(false);
    expect(gridFirstJob(s, splice)).toBe(true);
    expect(urgency(s, splice) - urgency(s, run)).toBe(LATE.gridFirstUrgency);
  });

  it('(e, review round 1) a code prep that reopens a lapsed house goes before grid first while the grid holds at 48+; under 48 the grid goes first', () => {
    for (const [hp, want] of [
      [50, 'codeprep'],
      [45, 'feeder'],
    ] as const) {
      const s = at(4);
      s.orders = [];
      s.alerts = [];
      grid(s).health = hp;
      // the house's inspection lapsed last week: it's closed at this resolve without the prep
      asset(s, 'h1').inspectionUntil = s.week - 1;
      const feeder = job(s, { kind: 'feeder', assetId: grid(s).id, title: 'Find and re-splice the cottage feeder', puzzle: 'trace', tier: 3, gain: 16 });
      const prep = job(s, { kind: 'codeprep', assetId: 'h1' });
      expect(gridFirst(s), `grid ${hp}`).toBe(true);
      expect([feeder, prep].sort((a, b) => urgency(s, b) - urgency(s, a))[0].kind, `grid ${hp}`).toBe(want);
      // and on the Dock
      const notice = raiseAlert(s, { role: 'elec', asset: asset(s, 'h1'), sym: 'E_CODE_DUE', due: s.week - 1 }, NOW);
      const fa = raiseAlert(s, { role: 'elec', asset: grid(s), sym: 'E_FEEDER_DROP', due: s.week + 1 }, NOW);
      s.orders = [];
      expect(yourMoves(s, 'elec')[0].alert.id, `grid ${hp}`).toBe(want === 'codeprep' ? notice.id : fa.id);
    }
  });

  it("(e) grid first: at tier 4 the grid under 55 gets a job even when the electrician's list is full; at tier 3 it waits", () => {
    for (const tier of [3, 4]) {
      const s = at(tier);
      s.orders = [];
      s.alerts = [];
      grid(s).health = 52;
      // six open alerts on the houses: the list is past its target, no routine slot this week
      for (let i = 0; i < 6; i++) raiseAlert(s, { role: 'elec', asset: asset(s, i % 2 ? 'h1' : 'h2'), kind: i % 2 ? 'trip' : 'flicker' }, NOW);
      generateAlerts(s, rng(7), NOW, () => {});
      const onGrid = liveAlerts(s).filter((a) => a.assetId === grid(s).id);
      expect(onGrid.length, `tier ${tier}`).toBe(tier >= 4 ? 1 : 0);
      // the island feed, not the fuel dock's run (review round 1)
      for (const a of onGrid) expect(FEED_KINDS.has(a.kind), a.sym).toBe(true);
    }
  });

  it("(e) grid first: the electrician's autopilot takes the grid's alert under 55 at tier 4 though it isn't due yet; at tier 3 it leaves it", () => {
    for (const tier of [3, 4]) {
      let s = at(tier);
      s.orders = [];
      s.alerts = [];
      grid(s).health = 50;
      const al = raiseAlert(s, { role: 'elec', asset: grid(s), kind: 'feeder', due: s.week + 3 }, NOW);
      s = endWeek(s, ['mech', 'fin']);
      const planned = s.orders.some((o) => o.flow?.alert === al.id);
      expect(planned, `tier ${tier}`).toBe(tier >= 4);
    }
  });

  it("(e) grid first on the Dock: at tier 4 the grid's alert under 55 comes before a code notice due this week; at tier 3 the notice comes first", () => {
    for (const tier of [3, 4]) {
      const s = at(tier);
      s.orders = [];
      s.alerts = [];
      grid(s).health = 50;
      // due this week, the certificate still current (a lapsed one reopens a house and goes first: the test above)
      asset(s, 'h1').inspectionUntil = s.week;
      const prep = raiseAlert(s, { role: 'elec', asset: asset(s, 'h1'), sym: 'E_CODE_DUE', due: s.week }, NOW);
      const feeder = raiseAlert(s, { role: 'elec', asset: grid(s), kind: 'feeder', due: s.week + 2 }, NOW);
      const first = yourMoves(s, 'elec')[0].alert.id;
      expect(first, `tier ${tier}`).toBe(tier >= 4 ? feeder.id : prep.id);
      expect(dockNext(s, 'elec')!.label, `tier ${tier}`).toContain(tier >= 4 ? grid(s).name : asset(s, 'h1').name);
    }
  });

  it('(f) the credits streak: only weeks played at the Resort count; a full-crew A adds one, an autopilot A holds it, below A ends it', () => {
    // the Resort arrived in week 20: week 20 was played at the Harbor, week 21 on is the Resort
    const st = (tier: number, aStreak: number, t5 = 20) => ({ tier, stats: { aStreak, tierReachedWeek: tier >= 5 ? { 5: t5 } : {} } as unknown as IslandState['stats'] });
    expect(aStreakAfter(st(5, 7), 30, 'A', true)).toBe(8);
    expect(aStreakAfter(st(5, 7), 30, 'A', false)).toBe(7);
    expect(aStreakAfter(st(5, 7), 30, 'B', false)).toBe(0);
    expect(aStreakAfter(st(5, 7), 30, 'B', true)).toBe(0);
    // no streak before the Resort: a Harbor A doesn't count, full crew or not
    expect(aStreakAfter(st(4, 3), 18, 'A', true)).toBe(0);
    expect(aStreakAfter(st(4, 3), 18, 'A', false)).toBe(0);
    expect(aStreakAfter(st(3, 3), 12, 'A', true)).toBe(0);
    // the week the Resort arrives was played at the Harbor: it doesn't count either
    expect(atResort(st(5, 0), 20)).toBe(false);
    expect(aStreakAfter(st(5, 9), 20, 'A', true)).toBe(0);
    expect(atResort(st(5, 0), 21)).toBe(true);
    expect(aStreakAfter(st(5, 0), 21, 'A', true)).toBe(1);
    // a stored streak longer than the Resort weeks (never written by v4) is read as the Resort weeks it can hold
    expect(creditsStreak(st(5, 9), 23)).toBe(2);
    expect(aStreakAfter(st(5, 9), 23, 'A', true)).toBe(3);
    // the release gate: a live doc's streak from an older build (Harbor weeks in it) is carried (stats.aCarry, stamped by
    // migrate): it counts in full, a full-crew A at the Resort adds one (9 → 10: the credits), and a week below A ends it
    const carried = (tier: number, aStreak: number, t5 = 20) => {
      const x = st(tier, aStreak, t5);
      x.stats.aCarry = aStreak;
      return x;
    };
    expect(creditsStreak(carried(5, 9), 23)).toBe(9);
    expect(aStreakAfter(carried(5, 9), 23, 'A', true)).toBe(10);
    expect(aStreakAfter(carried(5, 9), 23, 'A', false)).toBe(9);
    expect(aStreakAfter(carried(5, 9), 23, 'B', true)).toBe(0);
    // at the Harbor a carried streak holds on an A (new Harbor weeks don't add), and ends below A
    expect(aStreakAfter(carried(4, 8), 18, 'A', true)).toBe(8);
    expect(aStreakAfter(carried(4, 8), 18, 'C', true)).toBe(0);
  });

  it('(f, review round 1) a 9-week Harbor streak, and the Resort arriving mid-week on an autopilot week graded A: no credits (seeds 1-12)', () => {
    let graded = 0;
    for (let seed = 1; seed <= 12; seed++) {
      // an all-good island at the Harbor with the Resort's crew project just open
      let open: IslandState | undefined;
      simulate(TEAMS['all good'], 30, seed, (x) => {
        if (!open && x.project?.tier === 5) open = structuredClone(x);
      });
      if (!open) continue;
      let s = open;
      const W = s.week;
      const now = (s.deadline ?? NOW) - 3600_000;
      s.stats.aStreak = 9;
      // everyone's part done this week, the mechanic's last: the Resort arrives mid-week, before the resolve
      for (const role of ['fin', 'elec', 'mech'] as const) {
        const id = s.project!.orders[role]!;
        const r = apply(s, { t: 'complete', role, orderId: id, score: 0.9, perfect: false, week: W, ...(role === 'fin' ? { data: { kits: 1, spent: 4800 } } : {}) }, now);
        expect(r.error, `seed ${seed} ${role}`).toBeUndefined();
        s = r.s;
      }
      expect(s.tier, `seed ${seed}`).toBe(5);
      expect(s.stats.tierReachedWeek[5]).toBe(W);
      // the mechanic and the analyst play the week; the electrician misses the evening (autopilot)
      for (const role of ['mech', 'fin'] as const) {
        s = botTurn(s, role, TEAMS['all good'][role], rng(hashSeed('arrive', seed, role)), now);
        s = apply(s, { t: 'endTurn', role, week: W }, now).s;
      }
      s = apply(s, { t: 'resolve', week: W }, (s.deadline ?? NOW) + 1000).s;
      const h = s.history[s.history.length - 1];
      expect(h.autoRun).toContain('elec');
      if (h.grade === 'A') graded++;
      expect(s.creditsWeek, `seed ${seed}`).toBeUndefined();
      expect(s.stats.aStreak, `seed ${seed}`).toBe(0);
      expect(h.lines.some((l) => /You beat Island Company/.test(l.text))).toBe(false);
    }
    // the case the review found: arrival weeks graded A (on the old rule every one of them paid out)
    expect(graded).toBeGreaterThan(0);
  });
});

describe('A0 in whole seasons', () => {
  it('no role can win alone in the long game either: solo, absent and nobody teams stay at tier 1 through 52 weeks (seeds 1-3)', () => {
    for (const seed of [1, 2, 3]) {
      for (const team of ['solo mech', 'solo elec', 'solo fin', 'nobody', 'mech absent', 'elec absent', 'fin absent']) {
        const { final } = simulate(TEAMS[team], 52, seed);
        expect(final.tier, `${team} seed ${seed}`).toBe(1);
        expect(final.creditsWeek, `${team} seed ${seed}`).toBeUndefined();
      }
    }
  }, 120_000);

  it("the credits come only after 8 full-crew A weeks played at the Resort, none below A between them, and never on an autopilot week (all good seed 4 was the review's repro)", () => {
    // (the default goal, GOAL.rule 'streak'; the G0 synthesis's 'quarter' goal is tests/goal.test.ts)
    expect(GOAL.rule).toBe('streak');
    let paused = 0;
    let credits = 0;
    for (const [team, seeds] of [
      ['all good', [1, 2, 3, 4, 5]],
      ['three friends', [1, 4]],
      // (seeds 5 and 7: an A week with a seat on autopilot at the Resort while a streak runs, so the pause is seen)
      ['all average', [2, 5, 7]],
    ] as const) {
      for (const seed of seeds) {
        let run = 0;
        let prev = 0;
        const { final } = simulate(TEAMS[team], 52, seed, (s) => {
          const h = s.history[s.history.length - 1];
          const t5 = s.stats.tierReachedWeek[5];
          const resort = t5 !== undefined && h.week > t5;
          const streak = s.stats.aStreak ?? 0;
          if (!resort) expect(streak, `${team} ${seed} wk ${h.week}`).toBe(0);
          else if (h.grade !== 'A') run = 0;
          else if (!h.autoRun.length) run++;
          else if (streak > 0) {
            // an autopilot A at the Resort holds the streak, and says so
            expect(streak).toBe(prev);
            expect(h.lines.some((l) => /doesn't count toward the eight: the streak holds/.test(l.text))).toBe(true);
            paused++;
          }
          if (resort && !s.creditsWeek) expect(streak, `${team} ${seed} wk ${h.week}`).toBe(run);
          prev = streak;
        });
        if (final.creditsWeek) {
          credits++;
          const t5 = final.stats.tierReachedWeek[5]!;
          expect(final.creditsWeek - t5, `${team} seed ${seed}`).toBeGreaterThanOrEqual(8);
        }
      }
    }
    // the all-good crew still beats the game, honestly (all 5 of these seasons on this build), and the pause is seen
    expect(credits).toBeGreaterThan(0);
    expect(paused).toBeGreaterThan(0);
  }, 180_000);

  it('the long-game guard, release build (the helper held back; 52 weeks, seeds 1-10, weeks 24-52): A0 delays the slide, and the houses show it', () => {
    // The stage 1 release gate (DECISIONS "2026-09-29: stage 1 release gate") holds the electrician's helper back
    // (STAFF.helper.enabled false: an NPC doing the electrician's hands-on work is the owner's call), so the long game
    // is A0's alone again. Measured on these seeds: three friends 6 of 10 games below $0, 25 weeks, 76 dead weeks, the
    // median house at health 4 at week 52 and 0 of 7 rentable; all average 2, 3, 20, health 11, 0 of 7, cash $183k.
    // The guard pins that with room for noise, so a regression shows; the next test is the helper's own guard.
    expect(STAFF.helper.enabled).toBe(false);
    const tf = longGuard('three friends');
    expect(tf.games).toBeLessThanOrEqual(7);
    expect(tf.neg).toBeLessThanOrEqual(35);
    expect(tf.dead).toBeLessThanOrEqual(95);
    const av = longGuard('all average');
    expect(av.games).toBeLessThanOrEqual(3);
    expect(av.neg).toBeLessThanOrEqual(8);
    expect(av.dead).toBeLessThanOrEqual(28);
    expect(av.cash52).toBeGreaterThan(120_000);
  }, 120_000);

  it("the long-game guard with the helper on (the owner's call; 52 weeks, seeds 1-10, weeks 24-52): the cash holds, and the houses show the helper's scope", () => {
    // docs/EXPANSION.md 11.1 T1 asks for a median of 0 weeks below $0, at most 3 of 30 games ever below $0, median dead
    // weeks ≤ 2 and the credits in half of the three friends' games by week 45. On these seeds, weeks 24-52:
    //   before A0 (258d0d2): three friends 10 of 10 games below $0, 127 weeks, 192 dead weeks; all average 10, 103, 180
    //   A0 (e4908db):        three friends 6 of 10, 24, 49; all average 2 of 10, 4, 21 (and the houses at 0-10 by week 52)
    //   review round 1:      three friends 0 of 10, 0, 4; all average 0, 0, 0; median houses rentable at week 52 7 of 7
    //                        and 7 of 7, median house health at week 52 about 48 and 70
    //   release gate:        the helper narrowed to the routine device swaps (no diagnosis-led job: flicker, water
    //                        heater, bonding, spa feed, storm rewire), no hazard, only what was ready when the electrician
    //                        ended the turn, never in a week they're away: three friends 2 of 10, 8, 18, houses about 19
    //                        at week 52 with 2 of 7 rentable; all average 0, 0, 0, about 49, 6 of 7. The narrower scope is
    //                        what costs the houses (the old kinds with the other rules: 1, 1, 1, about 40, 5 of 7)
    // The guard keeps room for noise, and reads the houses at week 52 too (review round 1: a lever that regresses shows
    // in the houses weeks before it shows in the cash).
    STAFF.helper.enabled = true;
    let tf: ReturnType<typeof longGuard>;
    let av: ReturnType<typeof longGuard>;
    try {
      tf = longGuard('three friends');
      av = longGuard('all average');
    } finally {
      STAFF.helper.enabled = false;
    }
    expect(tf.games).toBeLessThanOrEqual(3);
    expect(tf.neg).toBeLessThanOrEqual(12);
    expect(tf.dead).toBeLessThanOrEqual(25);
    // the hold line: the median game keeps some of its 7 houses rentable at week 52
    expect(tf.rent52).toBeGreaterThanOrEqual(1);
    expect(tf.hp52).toBeGreaterThanOrEqual(12);
    expect(av.games).toBeLessThanOrEqual(2);
    expect(av.neg).toBeLessThanOrEqual(6);
    expect(av.dead).toBeLessThanOrEqual(12);
    expect(av.cash52).toBeGreaterThan(150_000);
    expect(av.rent52).toBeGreaterThanOrEqual(5);
    expect(av.hp52).toBeGreaterThanOrEqual(40);
  }, 240_000);

  it('a live tier-4 doc (bd1e1d2, engine 3) plays on under A0: its 8-week notices stand, its next renewal books 13 weeks, and it resolves 12 more weeks', () => {
    const doc = load('v3-bd1e1d2-late');
    expect(doc.engine).toBe(3);
    expect(doc.tier).toBe(4);
    const W = doc.week;
    // the county's notices the old build booked (8 weeks out) stand: nothing on the doc is rewritten
    const houses = doc.assets.filter((a) => a.kind === 'house');
    for (const h of houses) expect(h.inspectionUntil!, h.id).toBeLessThanOrEqual(W + 8 + 3);
    let s = structuredClone(doc);
    const h = [...houses].filter((x) => x.inspectionUntil! >= W).sort((a, b) => a.inspectionUntil! - b.inspectionUntil!)[0];
    const until = h.inspectionUntil!;
    const o = job(s, { assetId: h.id });
    s = apply(s, { t: 'complete', role: 'elec', orderId: o.id, score: 0.9, perfect: false, week: W }, NOW).s;
    const on = until - W <= 2 ? until : W;
    expect(asset(s, h.id).inspectionUntil).toBe(bookInspection(s, h.id, on + 13));
    // and it plays on: the electrician away (autopilot on the grid-first and code-prep rules), twelve resolves
    for (let w = 0; w < 12; w++) {
      s = endWeek(s, ['mech', 'fin']);
      expect(Number.isFinite(s.cash)).toBe(true);
      for (const a of s.assets) expect(a.health >= 0 && a.health <= 100, a.id).toBe(true);
    }
    expect(s.week).toBe(W + 12);
  });
});

/** the long-game guard's run (weeks 24-52 of 52, seeds 1-10): games and weeks below $0, dead weeks, and the medians at week 52 */
function longGuard(team: string) {
  let games = 0;
  let neg = 0;
  let dead = 0;
  const cash: number[] = [];
  const hp: number[] = [];
  const rent: number[] = [];
  for (let seed = 1; seed <= 10; seed++) {
    const { weeks } = simulate(TEAMS[team], 52, seed, (s) => {
      if (s.week - 1 !== 52) return;
      const hs = s.assets.filter((a) => a.kind === 'house');
      hp.push(hs.reduce((t, h) => t + h.health, 0) / hs.length);
      rent.push(s.history[s.history.length - 1].housesRentable);
    });
    const late = weeks.filter((w) => w.week >= 24);
    const n = late.filter((w) => w.cash < 0).length;
    if (n) games++;
    neg += n;
    dead += late.filter((w) => w.revenue < 2000).length;
    cash.push(weeks[51].cash);
  }
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[5];
  return { games, neg, dead, cash52: median(cash), hp52: median(hp), rent52: median(rent) };
}
