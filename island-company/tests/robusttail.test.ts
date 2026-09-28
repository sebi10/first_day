// The robust sweep's tail (docs/DECISIONS.md "2026-09-28: the robust tail"), one lever at a time:
//   1. code inspections on the county's calendar: the certificate runs 8 weeks from the inspection date, not from
//      the week of the prep, and the county books each house a week of its own
//   2. a flow job planned ahead of its alert's due week is on schedule: no deferral, so no deferral risk, until it's due
//   3. a crew project part that has waited two weeks on a seat that's away is done by autopilot at 50%
//   4. autopilot's covered code prep and 100-hour inspection pass (by the book), as a blind sign-off's do
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { raiseAlert } from '../src/sim/alerts';
import { botTurn, simulate, TEAMS } from '../src/sim/bots';
import { ECON, PROJECT_COVER } from '../src/sim/data';
import { bookInspection, INSPECTION_SLIP, onSchedule, projectCoverWeek, renewedInspection } from '../src/sim/econ';
import { apply, createIsland } from '../src/sim/engine';
import { planTask, stdPick } from '../src/sim/flow';
import { hashSeed, rng } from '../src/sim/rng';
import { ROLES, type IslandState, type Order, type Role } from '../src/sim/types';

// whole-season sims below: CI runners are about 1.5x slower
vi.setConfig({ testTimeout: 30000 });

const NOW = Date.UTC(2026, 8, 26, 10);
const load = (name: string): IslandState => JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures', `${name}.json`), 'utf8'));

function started(): IslandState {
  let s = createIsland({ id: 'tail', name: 'Tail Isle', now: NOW, tz: 'Europe/Paris', seed: 42, creator: { uid: 'a', name: 'Ana', role: 'mech' } });
  s = apply(s, { t: 'join', uid: 'b', name: 'Ben', role: 'elec' }, NOW).s;
  s = apply(s, { t: 'join', uid: 'c', name: 'Cy', role: 'fin' }, NOW).s;
  for (const r of ROLES) s = apply(s, { t: 'week0Done', role: r }, NOW).s;
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

const house = (s: IslandState, id: string) => s.assets.find((a) => a.id === id)!;
const orderOf = (s: IslandState, id: string) => s.orders.find((o) => o.id === id)!;

describe('1. code inspections on the county calendar', () => {
  it('a new island: the county books its two cottages a week apart', () => {
    const s = started();
    expect(house(s, 'h1').inspectionUntil).toBe(ECON.houseInspectionWeeks);
    expect(house(s, 'h2').inspectionUntil).toBe(ECON.houseInspectionWeeks + 1);
  });

  it('the certificate runs from the booked date: a prep inside the notice renews from that date; a lapsed or early one from now', () => {
    const s = started();
    const W = 10;
    // (no other house on these weeks)
    for (const h of s.assets) if (h.kind === 'house') h.inspectionUntil = 40;
    const h1 = house(s, 'h1');
    expect(renewedInspection(s, { id: 'h1', inspectionUntil: W + 2 }, W)).toBe(W + 2 + 8);
    expect(renewedInspection(s, { id: 'h1', inspectionUntil: W }, W)).toBe(W + 8);
    // lapsed: re-inspected at once
    expect(renewedInspection(s, { id: 'h1', inspectionUntil: W - 3 }, W)).toBe(W + 8);
    // further ahead than the notice: counts from now (preps can't push the date out)
    expect(renewedInspection(s, { id: 'h1', inspectionUntil: W + 6 }, W)).toBe(W + 8);
    void h1;
  });

  it('one house a week: a taken week slips to the next free one, up to INSPECTION_SLIP weeks, else the date as asked', () => {
    const s = started();
    const hs = s.assets.filter((a) => a.kind === 'house');
    hs[0].inspectionUntil = 20;
    hs[1].inspectionUntil = 21;
    expect(bookInspection(s, 'hX', 20)).toBe(22);
    expect(bookInspection(s, 'hX', 22)).toBe(22);
    // its own date doesn't block it
    expect(bookInspection(s, hs[0].id, 20)).toBe(20);
    // every week taken for the next INSPECTION_SLIP weeks: the date as asked
    const busy = { assets: Array.from({ length: INSPECTION_SLIP + 1 }, (_, i) => ({ ...hs[0], id: `b${i}`, inspectionUntil: 30 + i })) };
    expect(bookInspection(busy, 'hX', 30)).toBe(30);
  });

  it('the engine: a code prep signed off two weeks ahead of the inspection renews from the inspection date', () => {
    let s = started();
    const W = s.week;
    house(s, 'h1').inspectionUntil = W + 2;
    house(s, 'h2').inspectionUntil = 30;
    const o = job(s, {});
    const r = apply(s, { t: 'complete', role: 'elec', orderId: o.id, score: 0.9, perfect: false, week: W }, NOW);
    expect(r.error).toBeUndefined();
    s = r.s;
    // before: W + 8 (a prep two weeks early cut the certificate to six weeks)
    expect(house(s, 'h1').inspectionUntil).toBe(W + 2 + ECON.houseInspectionWeeks);
  });

  it('houses in step (an old doc) spread out as their preps renew: one inspection a week', () => {
    let s = started();
    const W = s.week;
    // tier 2's four cottages, all due the same week, as the live build left them
    s.assets.push({ ...house(s, 'h1'), id: 'h3', name: 'Cottage 3' }, { ...house(s, 'h1'), id: 'h4', name: 'Cottage 4' });
    for (const h of s.assets) if (h.kind === 'house') h.inspectionUntil = W + 2;
    for (const id of ['h1', 'h2', 'h3', 'h4']) {
      const o = job(s, { assetId: id });
      s = apply(s, { t: 'complete', role: 'elec', orderId: o.id, score: 0.9, perfect: false, week: W }, NOW).s;
    }
    const dates = ['h1', 'h2', 'h3', 'h4'].map((id) => house(s, id).inspectionUntil!);
    expect(dates).toEqual([W + 10, W + 11, W + 12, W + 13]);
  });

  it('a live doc whose houses share dates plays on, and its renewals book separate weeks', () => {
    // the live build (bd1e1d2) left the tier-4 island's six houses in three pairs
    let s = load('v3-bd1e1d2-chain');
    const before = s.assets.filter((a) => a.kind === 'house').map((a) => a.inspectionUntil);
    expect(new Set(before).size).toBe(3);
    const team = TEAMS['three friends'];
    // the paper-sim crew plays six weeks on this build: every house's prep comes due and is signed off once
    for (let w = 0; w < 6; w++) {
      const W = s.week;
      const now = (s.deadline ?? NOW) - 3600_000;
      for (const role of ROLES) {
        if (s.turns[role]?.ended) continue;
        s = botTurn(s, role, team[role], rng(hashSeed('tail', role, W)), now);
        s = apply(s, { t: 'endTurn', role, week: W }, now).s;
      }
      if (s.week === W) s = apply(s, { t: 'resolve', week: W }, (s.deadline ?? NOW) + 1000).s;
      expect(s.week).toBe(W + 1);
    }
    // every house renewed once, each on a week of its own
    const after = s.assets.filter((a) => a.kind === 'house').map((a) => a.inspectionUntil!);
    after.forEach((d, i) => expect(d, `house ${i + 1}`).toBeGreaterThan(before[i]!));
    expect(new Set(after).size).toBe(after.length);
  });
});

describe('2. a job planned ahead of its due week is on schedule', () => {
  /** the hall 3-way works from one end (due in 2 weeks), planned with the book's task and pick */
  function planned(): { s: IslandState; o: Order; due: number } {
    const s = started();
    const h1 = house(s, 'h1');
    const al = raiseAlert(s, { role: 'elec', asset: h1, sym: 'E_THREEWAY', cause: 0, due: s.week + 2 }, NOW);
    const task = planTask(s, al, 'ref:3way')!;
    const r = apply(s, { t: 'plan', role: 'elec', alert: al.id, task: task.id, pick: stdPick(s, h1, task), week: s.week }, NOW);
    expect(r.error).toBeUndefined();
    const o = r.s.orders.find((x) => x.flow?.alert === al.id)!;
    return { s: r.s, o, due: al.due };
  }

  it('its weeks before the due week are not deferrals; from the due week on they are, as an unplanned alert rolls from then', () => {
    let { s, o, due } = planned();
    expect(onSchedule(s, o, s.week)).toBe(true);
    while (s.week < due) {
      s = endWeek(s);
      expect(orderOf(s, o.id).deferrals, `week ${s.week}`).toBe(0);
    }
    // the due week passes with the job still open: now it's carried, and it rolls at the next resolve
    expect(onSchedule(s, orderOf(s, o.id), s.week)).toBe(false);
    s = endWeek(s);
    expect(orderOf(s, o.id).deferrals).toBe(1);
    expect(orderOf(s, o.id).lastDeferredWeek).toBe(due);
  });

  it('a non-flow job and an unplanned alert are unchanged', () => {
    let s = started();
    const o = job(s, { kind: 'trip', title: 'Trace dead outlets', puzzle: 'trace', gain: 12 });
    expect(onSchedule(s, o, s.week)).toBe(false);
    s = endWeek(s);
    expect(orderOf(s, o.id).deferrals).toBe(1);
  });
});

describe('3. a crew project part waits two weeks for a seat that is away, then autopilot does it at 50%', () => {
  /** qualify for tier 2 and open the project; the mechanic and the analyst do their parts at 0.9 */
  function opened(): IslandState {
    let s = started();
    s.stats.weeksBPlus = 4;
    s = endWeek(s);
    expect(s.project?.tier).toBe(2);
    const ids = s.project!.orders;
    for (const r of ['mech', 'fin'] as Role[]) s = apply(s, { t: 'complete', role: r, orderId: ids[r]!, score: 0.9, perfect: false, week: s.week }, NOW).s;
    return s;
  }

  it('the electrician away two weeks: the first week it waits, at the second resolve autopilot does it and the tier arrives', () => {
    let s = opened();
    const id = s.project!.orders.elec!;
    const from = orderOf(s, id).createdWeek + PROJECT_COVER.wait;
    expect(projectCoverWeek(s, 'elec')).toBe(from);
    // week one away: it waits (the project isn't lost)
    s = endWeek(s, ['mech', 'fin']);
    expect(s.tier).toBe(1);
    expect(orderOf(s, id).status).toBe('ready');
    expect(s.week).toBe(from);
    // week two away: autopilot does it by the book at 50%
    s = endWeek(s, ['mech', 'fin']);
    expect(orderOf(s, id).result).toMatchObject({ score: PROJECT_COVER.score, auto: true });
    expect(s.tier).toBe(2);
    expect(s.stats.tierReachedWeek[2]).toBe(from);
    // the quality cost: the new tier's buildings start at 60 + 30 x the parts' average
    const q = (0.9 + 0.9 + PROJECT_COVER.score) / 3;
    expect(s.assets.find((a) => a.model === 'cargo')!.health).toBe(Math.round(60 + 30 * q));
    expect(s.history.at(-1)!.lines.some((l) => /Ben was still away: autopilot did Ben's part of the crew project by the book, at 50%/.test(l.text))).toBe(true);
  });

  it('a seat that comes back does its own part: autopilot never does it early', () => {
    let s = opened();
    const id = s.project!.orders.elec!;
    s = endWeek(s, ['mech', 'fin']);
    s = apply(s, { t: 'complete', role: 'elec', orderId: id, score: 0.95, perfect: true, week: s.week }, NOW).s;
    expect(s.tier).toBe(2);
    expect(orderOf(s, id).result?.auto).toBeUndefined();
  });

  it('a seat nobody has played for four weeks is not covered: the part waits for its player', () => {
    let s = opened();
    const id = s.project!.orders.elec!;
    s.players.elec!.missedStreak = PROJECT_COVER.recent;
    expect(projectCoverWeek(s, 'elec')).toBeNull();
    s = endWeek(s, ['mech', 'fin']);
    s = endWeek(s, ['mech', 'fin']);
    s = endWeek(s, ['mech', 'fin']);
    expect(orderOf(s, id).status).toBe('ready');
    expect(s.tier).toBe(1);
  });

  it('a live doc: the tier-4 project the mechanic still owes (opened in week 15) is covered at week 17 if Ana is still away', () => {
    let s = load('v3-bd1e1d2-restricted-mel');
    const id = s.project!.orders.mech!;
    expect(orderOf(s, id).status).toBe('ready');
    expect(projectCoverWeek(s, 'mech')).toBe(17);
    // the doc was saved past its deadline: the next open resolves week 16 (Ana away), and it waits
    s = endWeek(s, []);
    expect(s.week).toBe(17);
    expect(orderOf(s, id).status).toBe('ready');
    s = endWeek(s, ['elec', 'fin']);
    expect(orderOf(s, id).result).toMatchObject({ auto: true, score: PROJECT_COVER.score });
    expect(s.tier).toBe(4);
  });

  it('no role can win alone: the absent teams stay at tier 1 too (seeds 1-6)', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      for (const team of ['mech absent', 'elec absent', 'fin absent']) {
        expect(simulate(TEAMS[team], 26, seed).final.tier, `${team} seed ${seed}`).toBe(1);
      }
    }
  });
});

describe('4. autopilot keeps to the manual: its covered inspections pass', () => {
  it('a covered code prep renews the house (it used to close the notice and let the house lapse)', () => {
    let s = started();
    const W = s.week;
    s.alerts = [];
    s.orders = s.orders.filter((o) => o.role !== 'elec');
    house(s, 'h1').inspectionUntil = W + 2;
    const o = job(s, {});
    s = endWeek(s, ['mech', 'fin']);
    expect(orderOf(s, o.id).result).toMatchObject({ auto: true });
    expect(house(s, 'h1').inspectionUntil).toBe(bookInspection(s, 'h1', W + 2 + ECON.houseInspectionWeeks));
    expect(house(s, 'h1').inspectionUntil).toBeGreaterThan(W + 2);
  });

  it('a covered 100-hour inspection is in the logbook: the plane starts its next 100 hours', () => {
    let s = started();
    const W = s.week;
    s.alerts = [];
    s.orders = s.orders.filter((o) => o.role !== 'mech');
    const twin = s.assets.find((a) => a.model === 'twin')!;
    twin.sinceInspection = ECON.planeInspectionFlights - 1;
    const o = job(s, { role: 'mech', kind: 'inspect100', assetId: twin.id, title: '100-hr inspection', puzzle: 'crack', cost: 290, gain: 10 });
    s = endWeek(s, ['elec', 'fin']);
    expect(orderOf(s, o.id).result).toMatchObject({ auto: true });
    // this week's flights only
    expect(s.assets.find((a) => a.id === twin.id)!.sinceInspection).toBeLessThanOrEqual(5);
    void W;
  });
});
