// A0, "a Resort that holds" (docs/EXPANSION.md 11.2, docs/DECISIONS.md "2026-09-29: A0"): the late game's upkeep
// rules from tier 4 (data LATE), one lever at a time, then in whole seasons:
//   (e) grid first: the grid under 55 is a must-do that ranks above code prep (the bots, autopilot, the Dock)
//   (g) the spiral breaker: a house dark all week (grid down, no generator) doesn't decay
//   (a) code inspections every 13 weeks
//   (b) a booked week wears a house 1, not 2
//   (c) a maintained asset (70+) decays 3 a week, not 5, planes and home assets alike
//   (d) no "+1 alert tier under 50" (tested, not kept: no measurable effect)
//   (f) the credits' A streak pauses on an autopilot week graded A (it still doesn't count)
// Tiers 1-3 play exactly as before.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { alertTier, generateAlerts, liveAlerts, raiseAlert } from '../src/sim/alerts';
import { simulate, TEAMS } from '../src/sim/bots';
import { ALERTS, ECON, LATE } from '../src/sim/data';
import { aStreakAfter, bookInspection, decayOf, gridFirst, houseWearOf, inspectionWeeks, renewedInspection, urgency } from '../src/sim/econ';
import { apply, createIsland } from '../src/sim/engine';
import { rng } from '../src/sim/rng';
import { dockNext, yourMoves } from '../src/ui/select';
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

  it('(g) a house dark all week (grid down, no generator to carry it) loses nothing to decay from tier 4; before tier 4 it still decays', () => {
    expect(decayOf({ tier: 4 }, { kind: 'house', health: 50 }, true)).toBe(0);
    expect(decayOf({ tier: 4 }, { kind: 'house', health: 90 }, true)).toBe(0);
    expect(decayOf({ tier: 4 }, { kind: 'plane', health: 50 }, true)).toBe(5);
    expect(decayOf({ tier: 3 }, { kind: 'house', health: 50 }, true)).toBe(5);
    for (const [tier, loss] of [
      [3, 5],
      [4, 0],
    ] as const) {
      let s = at(tier);
      s.weather = 'clear';
      s.orders = [];
      s.alerts = [];
      grid(s).health = 20;
      for (const h of s.assets.filter((a) => a.kind === 'house')) {
        h.health = 55;
        h.touchedWeek = s.week - 1;
      }
      s = endWeek(s, ['mech', 'fin']);
      // (the electrician's autopilot may work one house: the other one shows the rule)
      const untouched = s.assets.filter((a) => a.kind === 'house' && a.touchedWeek < s.week - 1);
      expect(untouched.length, `tier ${tier}`).toBeGreaterThan(0);
      for (const h of untouched) expect(h.health, `tier ${tier} ${h.id}`).toBe(55 - loss);
    }
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
      const prep = raiseAlert(s, { role: 'elec', asset: asset(s, 'h1'), sym: 'E_CODE_DUE', due: s.week }, NOW);
      const feeder = raiseAlert(s, { role: 'elec', asset: grid(s), kind: 'feeder', due: s.week + 2 }, NOW);
      const first = yourMoves(s, 'elec')[0].alert.id;
      expect(first, `tier ${tier}`).toBe(tier >= 4 ? feeder.id : prep.id);
      expect(dockNext(s, 'elec')!.label, `tier ${tier}`).toContain(tier >= 4 ? grid(s).name : asset(s, 'h1').name);
    }
  });

  it('(f) the credits streak: a full-crew A adds one; below A ends it; an autopilot A ends it before tier 4 and pauses it from tier 4', () => {
    const st = (tier: number, aStreak: number) => ({ tier, stats: { aStreak } as IslandState['stats'] });
    expect(aStreakAfter(st(5, 7), 'A', true)).toBe(8);
    expect(aStreakAfter(st(5, 7), 'A', false)).toBe(7);
    expect(aStreakAfter(st(4, 3), 'A', false)).toBe(3);
    expect(aStreakAfter(st(5, 7), 'B', false)).toBe(0);
    expect(aStreakAfter(st(5, 7), 'B', true)).toBe(0);
    expect(aStreakAfter(st(3, 3), 'A', false)).toBe(0);
    expect(aStreakAfter(st(3, 3), 'A', true)).toBe(4);
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

  it("the A streak's pause never lets an autopilot week count: the streak never grows on an autopilot week, and the credits never land on one", () => {
    let paused = 0;
    // (the crews with absences: all good never misses a week)
    for (const team of ['three friends', 'all average']) {
      for (const seed of [1, 2, 3]) {
        let prev = 0;
        const auto = new Set<number>();
        const { final } = simulate(TEAMS[team], 52, seed, (s) => {
          const h = s.history[s.history.length - 1];
          const streak = s.stats.aStreak ?? 0;
          const covered = h.lines?.some((l) => / was covered by autopilot/.test(l.text));
          if (covered) {
            auto.add(h.week);
            expect(streak, `${team} seed ${seed} week ${h.week}`).toBeLessThanOrEqual(prev);
            if (streak > 0 && streak === prev) paused++;
          } else expect(streak, `${team} seed ${seed} week ${h.week}`).toBeLessThanOrEqual(prev + 1);
          if (h.grade !== 'A') expect(streak).toBe(0);
          prev = streak;
        });
        if (final.creditsWeek) expect(auto.has(final.creditsWeek), `${team} seed ${seed}`).toBe(false);
      }
    }
    // the pause happens in these seasons (an A week with a seat on autopilot, late in the game)
    expect(paused).toBeGreaterThan(0);
  }, 120_000);

  it('the long-game guard (52 weeks, seeds 1-10, weeks 24-52): the Resort holds far better than before A0', () => {
    // docs/EXPANSION.md 11.1 T1 asks for more (a median of 0 weeks below $0, at most 3 of 30 games ever below $0,
    // median dead weeks ≤ 2, the credits in half of the three friends' games by week 45): A0 doesn't reach all of it
    // (docs/DECISIONS.md 2026-09-29). This guards what it reached, with room for noise. Before A0, on these seeds:
    // three friends 10 of 10 games below $0, 127 weeks below $0, 192 dead weeks; all average 10 of 10, 103, 180.
    // A0: three friends 6 of 10, 24, 49; all average 2 of 10, 4, 21.
    const run = (team: string) => {
      let games = 0;
      let neg = 0;
      let dead = 0;
      const cash: number[] = [];
      for (let seed = 1; seed <= 10; seed++) {
        const { weeks } = simulate(TEAMS[team], 52, seed);
        const late = weeks.filter((w) => w.week >= 24);
        const n = late.filter((w) => w.cash < 0).length;
        if (n) games++;
        neg += n;
        dead += late.filter((w) => w.revenue < 2000).length;
        cash.push(weeks[51].cash);
      }
      return { games, neg, dead, cash52: [...cash].sort((a, b) => a - b)[5] };
    };
    const tf = run('three friends');
    expect(tf.neg).toBeLessThanOrEqual(45);
    expect(tf.dead).toBeLessThanOrEqual(90);
    expect(tf.games).toBeLessThanOrEqual(9);
    const av = run('all average');
    expect(av.games).toBeLessThanOrEqual(3);
    expect(av.neg).toBeLessThanOrEqual(8);
    expect(av.dead).toBeLessThanOrEqual(30);
    expect(av.cash52).toBeGreaterThan(100_000);
  }, 120_000);

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
