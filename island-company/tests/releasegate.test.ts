// The stage 1 release gate (docs/DECISIONS.md "2026-09-29: stage 1 release gate"): the three reviews of branch `gaps`
// (db306aa) before v4 ships, each fix with its test.
//   - live islands keep what they earned: the credits' A streak an older engine counted (Harbor weeks in it) is carried
//     (stats.aCarry), and the Board rings a paused A only on weeks v4 resolved (stats.v4From)
//   - grid first at real risk: an open fuel-dock job or a dock card on the grid no longer switches the feed must-do off
//   - the receiver: funds only a batch's safety-critical share, says its 15% fee, keeps the loan a 10-week loan, gives a
//     second receivership its bridge loan, and says the week in plain numbers
//   - the electrician's helper: held back (STAFF.helper.enabled false: the owner's call). Enabled (these tests turn it
//     on), it puts in only the routine device swaps, only what was ready when the electrician ended the turn, never in a
//     week the electrician is away, never a hazard's fix; it is named on the trace, the closed job and the review
//
// tests/fixtures/v3-bd1e1d2-{credits-next-t5,t5-harbor-streak,t4-streak-high,t5-auto-a,rcv-neg}.json are docs the live
// build (bd1e1d2, engine 3) wrote with its own bots (scripts/fixtures-v3-late.ts, run in a worktree of bd1e1d2: it only
// dispatches moves).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { generateAlerts, liveAlerts, raiseAlert } from '../src/sim/alerts';
import { botTurn, simulate, TEAMS } from '../src/sim/bots';
import { RECEIVER } from '../src/sim/data';
import { aStreakAfter, atResort, carriedStreak, creditsStreak, FEED_KINDS, gridFirst, gridFirstAlert, houseWeekRevenue, onV4, pausedWeek } from '../src/sim/econ';
import { apply, createIsland, helperQueues, receiverLeft, receiverWords, tracedTo } from '../src/sim/engine';
import { planTask, stdPickFor } from '../src/sim/flow';
import { migrate } from '../src/sim/migrate';
import { hashSeed, rng } from '../src/sim/rng';
import { boardNeeds, boardRoles, cottageRent, helperJobs, helperWanted, STAFF, staffEffect, staffOpenWeek } from '../src/sim/staff';
import { addStarter } from '../src/sim/stock';
import { ROLES, type IslandState, type Npc, type Order, type Role } from '../src/sim/types';
import { flagsOf } from '../src/ui/flow/words';
import { harborLines } from '../src/ui/harbor';
import { cardVM, reqActions } from '../src/ui/purchasing/model';
import { yourMoves } from '../src/ui/select';
import { doingNow } from '../src/ui/staff/model';

// whole-season sims below: CI runners are about 1.5x slower
vi.setConfig({ testTimeout: 60000 });

const NOW = Date.UTC(2026, 8, 29, 10);
const load = (name: string): IslandState => JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures', `${name}.json`), 'utf8'));

function started(): IslandState {
  let s = createIsland({ id: 'rg', name: 'Gate Isle', now: NOW, tz: 'Europe/Paris', seed: 7, creator: { uid: 'a', name: 'Ana', role: 'mech' } });
  s = apply(s, { t: 'join', uid: 'b', name: 'Ben', role: 'elec' }, NOW).s;
  s = apply(s, { t: 'join', uid: 'c', name: 'Cy', role: 'fin' }, NOW).s;
  for (const r of ROLES) s = apply(s, { t: 'week0Done', role: r }, NOW).s;
  return s;
}

/** an island in week 20 at `tier` (past the teaching weeks and everyone's grace), cash to spare, no work open */
function at(tier: number): IslandState {
  const s = started();
  s.tier = tier;
  s.week = 20;
  s.cash = 50_000;
  for (const r of ROLES) s.players[r]!.graceUntil = 0;
  s.orders = [];
  s.alerts = [];
  for (const h of s.assets.filter((a) => a.kind === 'house')) h.inspectionUntil = s.week + 6;
  return s;
}

const helper = (s: IslandState, skill: Npc['skill'] = 3, name = 'Lina M.'): Npc => {
  const n: Npc = { id: `n${s.nextId++}`, name, role: 'helper', skill, wage: 280, hired: s.week, start: s.week };
  (s.staff ??= []).push(n);
  return n;
};

/** a legacy (pre-flow) job on an asset, ready to play */
function job(s: IslandState, over: Partial<Order>): Order {
  const o: Order = {
    id: `t${s.nextId++}`,
    role: 'elec',
    kind: 'trip',
    assetId: 'h1',
    title: 'Trace dead outlets',
    puzzle: 'trace',
    tier: 2,
    cost: 120,
    parts: 0,
    gain: 12,
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

function endWeek(s: IslandState, seats: Role[] = [...ROLES]): IslandState {
  const W = s.week;
  let x = s;
  for (const r of seats) if (!x.turns[r]?.ended) x = apply(x, { t: 'endTurn', role: r, week: W }, NOW).s;
  if (x.week === W) x = apply(x, { t: 'resolve', week: W }, (x.deadline ?? NOW) + 1000).s;
  expect(x.week).toBe(W + 1);
  return x;
}

/** a live doc played on one week by a crew's own bots, every seat, then the resolve (as the paper sim plays) */
function playWeek(doc: IslandState, team: string): IslandState {
  let s = doc;
  const W = s.week;
  const now = (s.deadline ?? NOW) - 3600_000;
  for (const role of ROLES) {
    if (s.week !== W) break;
    s = botTurn(s, role, TEAMS[team][role], rng(hashSeed('gate', s.id, role, W)), now);
    s = apply(s, { t: 'endTurn', role, week: W }, now).s;
  }
  if (s.week === W) s = apply(s, { t: 'resolve', week: W }, (s.deadline ?? now) + 1000).s;
  expect(s.week).toBe(W + 1);
  return s;
}

const asset = (s: IslandState, id: string) => s.assets.find((a) => a.id === id)!;
const lastLines = (s: IslandState) => s.history[s.history.length - 1].lines;

describe("live islands keep the credits' streak they earned (the live-docs review's blocker)", () => {
  it('a tier-5 doc one full-crew A from the credits on the live rules (7: 4 Harbor weeks + 3 Resort weeks) keeps 7, and the next full-crew A is the credits', () => {
    const doc = load('v3-bd1e1d2-credits-next-t5');
    expect(doc.engine).toBe(3);
    expect(doc.stats.aStreak).toBe(7);
    expect(doc.stats.tierReachedWeek[5]).toBe(21);
    const m = migrate(structuredClone(doc));
    // stamped once, on the first v4 read: the week v4 takes over and the streak the old rule had earned
    expect(m.stats).toMatchObject({ aCarry: 7, v4From: 25 });
    expect(carriedStreak(m)).toBe(true);
    // the first write on this build stores the same stamp (apply migrates before it stamps its engine), once
    const w = apply(doc, { t: 'rename', role: 'mech', name: doc.players.mech!.name }, doc.updatedAt + 1000);
    expect(w.error).toBeUndefined();
    expect(w.s.engine).toBe(5);
    expect(w.s.stats).toMatchObject({ aStreak: 7, aCarry: 7, v4From: 25 });
    expect(migrate(structuredClone(w.s)).stats).toMatchObject({ aCarry: 7, v4From: 25 });
    // the Board reads 7/8 (on db306aa: 3/8, the Resort weeks only)
    expect(creditsStreak(m, 25)).toBe(7);
    expect(aStreakAfter(m, 25, 'A', true)).toBe(8);
    // and played on: the live crew's bots grade week 25 A with the full crew (the live build pays the credits there)
    const s = playWeek(m, 'all good');
    const h = s.history[s.history.length - 1];
    expect(h.week).toBe(25);
    expect(h.grade).toBe('A');
    expect(h.autoRun).toEqual([]);
    expect(s.creditsWeek).toBe(25);
    expect(h.lines.some((l) => /Eight full-crew A weeks at the Resort/.test(l.text))).toBe(true);
  });

  it("a doc that reached the Resort a week ago with a 6-week Harbor streak shows 6/8, says it's carried, and its next A adds one", () => {
    const doc = load('v3-bd1e1d2-t5-harbor-streak');
    expect([doc.engine, doc.tier, doc.stats.aStreak, doc.stats.tierReachedWeek[5], doc.week]).toEqual([3, 5, 6, 24, 25]);
    const m = migrate(structuredClone(doc));
    // the Endgame card read 0/8 on db306aa
    expect(creditsStreak(m, m.week)).toBe(6);
    expect(harborLines(m).find((l) => l.title === 'The credits')!.body).toMatch(/Your streak from before this update counts: 6\/8\. Once it ends, only Resort weeks count\.$/);
    expect(aStreakAfter(m, 25, 'A', true)).toBe(7);
    expect(aStreakAfter(m, 25, 'A', false)).toBe(6);
    // a week below A ends it and the carry with it: from then on only the Resort's weeks count
    let s = structuredClone(m);
    s.receivership = 1; // (the receiver caps the grade at C)
    s.cash = Math.max(s.cash, 20_000);
    s = endWeek(s);
    expect(s.stats.aStreak).toBe(0);
    expect(s.stats.aCarry).toBeUndefined();
    expect(carriedStreak(s)).toBe(false);
    expect(harborLines(s).find((l) => l.title === 'The credits')!.body).not.toMatch(/before this update/);
  });

  it('a tier-4 doc with an 8-week streak keeps it at the Harbor (an A holds it) and pays the credits on its first full-crew A at the Resort', () => {
    const doc = load('v3-bd1e1d2-t4-streak-high');
    expect([doc.engine, doc.tier, doc.stats.aStreak, doc.week]).toEqual([3, 4, 8, 17]);
    const m = migrate(structuredClone(doc));
    expect(m.stats.aCarry).toBe(8);
    // on db306aa the first v4 resolve set it to 0
    expect(aStreakAfter(m, 17, 'A', true)).toBe(8);
    expect(aStreakAfter(m, 17, 'A', false)).toBe(8);
    expect(aStreakAfter(m, 17, 'B', true)).toBe(0);
    let s = playWeek(m, 'all good');
    const h = s.history[s.history.length - 1];
    expect(s.stats.aStreak).toBe(h.grade === 'A' ? 8 : 0);
    if (h.grade === 'A') expect(s.stats.aCarry).toBe(8);
    // the Resort arrives (the week it arrives was played at the Harbor: it holds); the next full-crew A is the ninth
    s = structuredClone(m);
    s.tier = 5;
    s.stats.tierReachedWeek[5] = 17;
    expect(atResort(s, 17)).toBe(false);
    expect(aStreakAfter(s, 17, 'A', true)).toBe(8);
    expect(atResort(s, 18)).toBe(true);
    expect(aStreakAfter(s, 18, 'A', true)).toBeGreaterThanOrEqual(8);
  });

  it('a new island never carries: the stamp is only for a doc an older engine wrote last', () => {
    const s = started();
    s.week = 30;
    s.stats.aStreak = 5;
    migrate(s);
    expect(s.engine).toBe(5);
    expect(s.stats.aCarry).toBeUndefined();
    expect(s.stats.v4From).toBeUndefined();
    // and the same simulate crews' docs never get it (the golden digests read every week's doc)
    const { final } = simulate(TEAMS['all good'], 30, 1);
    expect(final.stats.aCarry).toBeUndefined();
    expect(final.stats.v4From).toBeUndefined();
  });

  it('the Board rings a paused A only on weeks v4 resolved: the live engine reset the streak on an autopilot A', () => {
    const doc = load('v3-bd1e1d2-t5-auto-a');
    const m = migrate(structuredClone(doc));
    expect(m.stats.v4From).toBe(24);
    const wk23 = m.history.find((r) => r.week === 23)!;
    expect(wk23).toMatchObject({ grade: 'A' });
    expect(wk23.autoRun.length).toBeGreaterThan(0);
    expect(atResort(m, 23)).toBe(true);
    // on db306aa week 23 was ringed with "the week held the streak instead of counting" (the live engine had reset it)
    expect(pausedWeek(m, wk23)).toBe(false);
    expect(onV4(m, 23)).toBe(false);
    expect(pausedWeek(m, { ...wk23, week: 24 })).toBe(true);
    // (a v3 credits week keeps the v3 card's words: onV4 is what the Review reads)
    expect(onV4(m, 24)).toBe(true);
  });
});

describe('grid first at real risk (the correctness review: an open dock job masked it)', () => {
  it("an open fuel-dock take-off on the grid doesn't switch grid first off: the feed must-do still comes, with its chip, at the top of Your move", () => {
    const run = (dock: boolean) => {
      const s = at(4);
      const g = s.assets.find((a) => a.kind === 'grid')!;
      g.health = 50;
      let gen = s.assets.find((a) => a.kind === 'generator');
      if (!gen) s.assets.push((gen = { id: 'gen', kind: 'generator', model: 'gen', name: 'Generator house', health: 45, touchedWeek: s.week }));
      gen.health = 45;
      expect(gridFirst(s)).toBe(true);
      // the electrician's list is full (the random slots are 0): only a must-do gets through
      for (let i = 0; i < 5; i++) raiseAlert(s, { role: 'elec', asset: asset(s, i % 2 ? 'h1' : 'h2'), kind: i % 2 ? 'trip' : 'flicker', due: s.week + 3 }, NOW);
      if (dock) raiseAlert(s, { role: 'elec', asset: g, sym: 'E_TAKEOFF_DOCK', due: s.week + 3 }, NOW);
      generateAlerts(s, rng(7), NOW, () => {});
      const onGrid = liveAlerts(s).filter((a) => a.assetId === g.id);
      return { feed: onGrid.filter((a) => FEED_KINDS.has(a.kind)).length, chip: onGrid.some((a) => gridFirstAlert(s, a)), top: s.assets.find((a) => a.id === yourMoves(s, 'elec')[0]?.alert.assetId)?.kind };
    };
    expect(run(false)).toEqual({ feed: 1, chip: true, top: 'grid' });
    // on db306aa: { feed: 0, chip: false, top: 'house' }
    expect(run(true)).toEqual({ feed: 1, chip: true, top: 'grid' });
  });

  it('under 45 too: an open dock take-off on the grid in critical shape still lets the feed must-do through, with its chip', () => {
    // the release QA: on 14e5811 the rule held at 54/50/46/45 and failed at 44/42/40/35
    for (const hp of [44, 40, 35]) {
      const s = at(4);
      const g = s.assets.find((a) => a.kind === 'grid')!;
      g.health = hp;
      let gen = s.assets.find((a) => a.kind === 'generator');
      if (!gen) s.assets.push((gen = { id: 'gen', kind: 'generator', model: 'gen', name: 'Generator house', health: 45, touchedWeek: s.week }));
      gen.health = 45;
      expect(gridFirst(s)).toBe(true);
      for (let i = 0; i < 5; i++) raiseAlert(s, { role: 'elec', asset: asset(s, i % 2 ? 'h1' : 'h2'), kind: i % 2 ? 'trip' : 'flicker', due: s.week + 3 }, NOW);
      raiseAlert(s, { role: 'elec', asset: g, sym: 'E_TAKEOFF_DOCK', due: s.week + 3 }, NOW);
      generateAlerts(s, rng(7), NOW, () => {});
      const onGrid = liveAlerts(s).filter((a) => a.assetId === g.id);
      expect({ hp, feed: onGrid.filter((a) => FEED_KINDS.has(a.kind)).length, chip: onGrid.some((a) => gridFirstAlert(s, a)) }).toEqual({ hp, feed: 1, chip: true });
    }
  });

  it('a feed alert already open still counts as something open: no second feed job', () => {
    const s = at(4);
    const g = s.assets.find((a) => a.kind === 'grid')!;
    g.health = 50;
    let gen = s.assets.find((a) => a.kind === 'generator');
    if (!gen) s.assets.push((gen = { id: 'gen', kind: 'generator', model: 'gen', name: 'Generator house', health: 45, touchedWeek: s.week }));
    gen.health = 45;
    // (the list full, as above: only a must-do gets through)
    for (let i = 0; i < 4; i++) raiseAlert(s, { role: 'elec', asset: asset(s, i % 2 ? 'h1' : 'h2'), kind: i % 2 ? 'trip' : 'flicker', due: s.week + 3 }, NOW);
    const open = raiseAlert(s, { role: 'elec', asset: g, sym: 'E_FEEDER_DROP', cause: 0, due: s.week + 2 }, NOW);
    expect(gridFirstAlert(s, open)).toBe(true);
    generateAlerts(s, rng(7), NOW, () => {});
    expect(liveAlerts(s).filter((a) => a.assetId === g.id && FEED_KINDS.has(a.kind)).length).toBe(1);
  });
});

describe('the receiver (the correctness and pillars reviews)', () => {
  function broke(): IslandState {
    const s = at(4);
    s.cash = -5000;
    s.receivership = 2;
    s.loan = { left: 10_000, weekly: 1_000 };
    return s;
  }

  it("funds only a batch's safety-critical share: a plain stock request bundled with an urgent part is refused, and the desk sends the urgent ones on their own", () => {
    const s = broke();
    const h = asset(s, 'h1');
    const al = raiseAlert(s, { role: 'elec', asset: h, sym: 'E_WARM_OUTLET', cause: 0, due: s.week + 1 }, NOW);
    const o = job(s, { kind: al.kind, assetId: h.id, title: 'Receptacle repair', status: 'waiting_part' });
    o.flow = { alert: al.id, task: 'ref:outlet', pick: [], bench: [], tools: [], bom: 0 } as unknown as NonNullable<Order['flow']>;
    al.status = 'job';
    al.order = o.id;
    s.reqs = [
      { id: 'rq1', week: s.week, at: NOW, role: 'elec', item: 'RPR-outlet', qty: 1, order: o.id, status: 'open' },
      { id: 'rq2', week: s.week, at: NOW, role: 'elec', item: 'DBS-2', qty: 20, status: 'open', why: 'restock' },
    ];
    expect(apply(s, { t: 'approveReq', role: 'fin', reqs: ['rq2'], week: s.week } as never, NOW).error).toBeTruthy();
    // on db306aa the bundle went through and the receiver advanced $1,265 for both
    const both = apply(s, { t: 'approveReq', role: 'fin', reqs: ['rq1', 'rq2'], week: s.week } as never, NOW);
    expect(both.error).toMatch(/^The receiver funds only the safety-critical requests/);
    const one = apply(s, { t: 'approveReq', role: 'fin', reqs: ['rq1'], week: s.week } as never, NOW);
    expect(one.error).toBeUndefined();
    expect(one.s.loan!.adv!.usd).toBeLessThan(900);
    // the analyst's batch approval splits them in receivership and under the freeze (and not with cash to spare)
    const acts = reqActions(s, ['rq1', 'rq2'], { cheaper: false, aog: false });
    expect(acts.map((a) => (a as { reqs: string[] }).reqs)).toEqual([['rq1'], ['rq2']]);
    // the same batch under the $2,000 freeze outside receivership: the urgent part passes on its own, the stock waits
    s.receivership = 0;
    s.loan = null;
    s.cash = 1_500;
    expect(apply(s, { t: 'approveReq', role: 'fin', reqs: ['rq1', 'rq2'], week: s.week } as never, NOW).error).toBe(
      'Spendable cash under $2,000: only safety-critical work can be approved: approve the safety-critical requests on their own.',
    );
    expect(apply(s, { t: 'approveReq', role: 'fin', reqs: ['rq1'], week: s.week } as never, NOW).error).toBeUndefined();
    expect(reqActions(s, ['rq1', 'rq2'], { cheaper: false, aog: false }).length).toBe(2);
    s.cash = 50_000;
    expect(reqActions(s, ['rq1', 'rq2'], { cheaper: false, aog: false }).length).toBe(1);
  });

  it('says its 15% fee on the card and in the feed, and keeps the loan a 10-week loan: the weekly payment grows with each advance', () => {
    expect(receiverWords(190)).toBe('The receiver funds $190 → +$218 on the bridge loan (15% fee)');
    const s = broke();
    asset(s, 'h1').health = 30;
    const prep = job(s, { kind: 'codeprep', assetId: 'h1', title: 'Code inspection prep', status: 'pending', cost: 1500 });
    const r = apply(s, { t: 'approve', orderId: prep.id }, NOW);
    expect(r.error).toBeUndefined();
    expect(r.s.loan).toMatchObject({ left: 11_725, weekly: 1_173 });
    expect(r.s.feed.find((f) => f.text.startsWith('The receiver funds'))?.text).toMatch(/^The receiver funds \$1,500 → \+\$1,725 on the bridge loan \(15% fee\) for Code inspection prep \(safety-critical\): the loan is \$11,725 at \$1,173\/week\./);
    // a first advance on no loan sets a 10-week payment, not a tiny one it keeps
    const t = broke();
    t.loan = null;
    asset(t, 'h1').health = 30;
    const p2 = job(t, { kind: 'codeprep', assetId: 'h1', status: 'pending', cost: 400 });
    expect(apply(t, { t: 'approve', orderId: p2.id }, NOW).s.loan).toMatchObject({ left: 460, weekly: 46 });
  });

  it('the approval card says what the receiver funds and adds to the loan', () => {
    const s = at(4);
    addStarter(s, 4);
    s.autoBudget.elec = 0;
    // (safety-critical to the receiver: the house under 60)
    asset(s, 'h1').health = 40;
    const al = raiseAlert(s, { role: 'elec', asset: asset(s, 'h1'), sym: 'E_DEAD_OUTLET', cause: 0 }, NOW);
    const task = planTask(s, al, 'ref:outlet')!;
    const r = apply(s, { t: 'plan', role: 'elec', alert: al.id, task: task.id, pick: stdPickFor(s, al, task), week: s.week }, NOW);
    expect(r.error).toBeUndefined();
    const x = r.s;
    const o = x.orders.find((y) => y.flow?.alert === al.id)!;
    expect(o.status).toBe('pending');
    expect(cardVM(x, o).recv).toBeUndefined();
    x.cash = -5000;
    x.receivership = 2;
    x.loan = { left: 10_000, weekly: 1_000 };
    const total = cardVM(x, o).total;
    expect(cardVM(x, o).recv).toBe(`${receiverWords(total)}.`);
  });

  it("says a card over the week's whole allowance can't be funded", () => {
    const s = broke();
    asset(s, 'h1').health = 30;
    const big = job(s, { kind: 'codeprep', assetId: 'h1', title: 'Transfer switch upgrade', status: 'pending', cost: 2055 });
    expect(apply(s, { t: 'approve', orderId: big.id }, NOW).error).toBe("Not enough cash, and the receiver funds at most $1,500 a week: a $2,055 card can't be funded in receivership.");
  });

  it("books the receiver's money as financing in the week's review", () => {
    let s = broke();
    asset(s, 'h1').health = 30;
    const prep = job(s, { kind: 'codeprep', assetId: 'h1', status: 'pending', cost: 400 });
    s = apply(s, { t: 'approve', orderId: prep.id }, NOW).s;
    s = endWeek(s);
    expect(s.history[s.history.length - 1].costs.financing).toBe(400);
  });

  it('a second receivership gets its bridge loan too, on top of what is still owed (it used to start below $0 on the allowance alone)', () => {
    let s = at(4);
    s.cash = -8000;
    s.stats.negCashStreak = 1;
    s.loan = { left: 9_972, weekly: 900 };
    s = endWeek(s);
    expect(s.receivership).toBe(3);
    const line = lastLines(s).find((l) => /bridge loan on top of the/.test(l.text));
    expect(line?.text).toMatch(/^The receiver advanced a \$[\d,]+ bridge loan on top of the \$9,072 still owed: \$[\d,]+\/week for 10 weeks\.$/);
    expect(s.cash).toBeGreaterThan(0);
    expect(s.loan!.left).toBeGreaterThan(9_072);
    expect(s.loan!.weekly).toBeGreaterThanOrEqual(Math.ceil(s.loan!.left / 10));
    expect(s.history[s.history.length - 1].costs.financing).toBeGreaterThan(8000);
  });

  it('a live island in receivership below $0 (bd1e1d2) plays on: the plain-numbers line every week, the loan never stretched past 10 weeks by an advance', () => {
    let s = migrate(structuredClone(load('v3-bd1e1d2-rcv-neg')));
    expect(s.receivership).toBeGreaterThan(0);
    expect(s.cash).toBeLessThan(0);
    for (let w = 0; w < 4; w++) {
      const before = s.loan ? { ...s.loan } : null;
      s = playWeek(s, 'three friends');
      if (s.receivership > 0 && s.cash < 0) expect(lastLines(s).some((l) => /^Receivership, cash −\$[\d,]+: revenue \$[\d,]+ this week against \$[\d,]+ of overhead and payroll/.test(l.text))).toBe(true);
      expect(lastLines(s).some((l) => /The way out is revenue/.test(l.text))).toBe(false);
      if (before && s.loan && s.loan.left > before.left) expect(s.loan.weekly).toBeGreaterThanOrEqual(Math.ceil(s.loan.left / 10) - Math.ceil(s.loan.left / 10 / 10));
      expect(Number.isFinite(s.cash)).toBe(true);
    }
    // no helper card on its board (held back; and in receivership the board wouldn't deal one it can't hire)
    expect((s.hiring?.cands ?? []).some((c) => c.role === 'helper')).toBe(false);
  });
});

describe("the electrician's helper is held back for stage 1 (the pillars review's blocker)", () => {
  it('off: never on the board, a hire is refused, no work at the resolve, no alert-flow bonus, the Harbor sheet and the bots leave it out', () => {
    expect(STAFF.helper.enabled).toBe(false);
    let s = at(4);
    for (let i = 0; i < 6; i++) raiseAlert(s, { role: 'elec', asset: asset(s, i % 2 ? 'h1' : 'h2'), kind: i % 2 ? 'trip' : 'flicker' }, NOW);
    expect(helperWanted(s)).toBe(false);
    expect(boardRoles(s)).not.toContain('helper');
    expect(boardNeeds(s)).not.toContain('helper');
    for (let w = 20; w < 40; w++) {
      const x = structuredClone(s);
      x.week = w;
      staffOpenWeek(x, rng(w), NOW);
      expect(x.hiring!.cands.every((c) => c.role !== 'helper'), `week ${w}`).toBe(true);
    }
    s.hiring = { week: s.week, cands: [{ id: 'cx', name: 'X', role: 'helper', skill: 3, ask: 280, start: s.week }] } as IslandState['hiring'];
    expect(apply(s, { t: 'hire', cand: 'cx', week: s.week }, NOW).error).toBe("The electrician's helper isn't in this release.");
    // a helper on the payroll anyway (none can be) does nothing and adds no work
    helper(s, 3);
    expect(helperJobs(s)).toBe(0);
    const o = job(s, { kind: 'trip', assetId: 'h1' });
    s = endWeek(s);
    expect(s.orders.find((x) => x.id === o.id)!.result?.npc).toBeUndefined();
    expect(harborLines(s).some((l) => /helper/i.test(l.title + l.body))).toBe(false);
    // the bots never hire one (with it on, three friends seed 1 hires one by week 40: tests/latefix.test.ts)
    let hired = false;
    simulate(TEAMS['three friends'], 40, 1, (x) => {
      if (x.staff?.some((n) => n.role === 'helper')) hired = true;
    });
    expect(hired).toBe(false);
  });
});

describe("the electrician's helper, enabled (the pillars review's majors; the code stays for the owner's call)", () => {
  beforeAll(() => {
    STAFF.helper.enabled = true;
  });
  afterAll(() => {
    STAFF.helper.enabled = false;
  });

  it("R1: the helper's job on a house keeps the electrician's perfect blind sign-off's no-decay week (W+1)", () => {
    const run = (withHelperJob: boolean) => {
      let s = at(4);
      s.weather = 'clear';
      helper(s, 3);
      const W = s.week;
      job(s, { kind: 'gfci', title: 'GFCI in wet rooms', status: 'done', result: { score: 1, perfect: true, credit: 1.1, by: 'elec', week: W, blind: true, provisional: 0.7 } });
      if (withHelperJob) job(s, { kind: 'trip', title: 'Trace dead outlets', status: 'ready' });
      s = endWeek(s);
      if (withHelperJob) expect(s.orders.some((o) => o.result?.npc)).toBe(true);
      return { touched: asset(s, 'h1').touchedWeek, W };
    };
    const without = run(false);
    expect(without.touched).toBe(without.W + 1);
    // on db306aa: W (the helper's `touchedWeek = s.week` overwrote it)
    const withJob = run(true);
    expect(withJob.touched).toBe(withJob.W + 1);
  });

  it("only what was ready when the electrician ended the turn: a card approved after that waits for them", () => {
    const run = (approveFirst: boolean) => {
      let s = at(4);
      helper(s, 3);
      const o = job(s, { kind: 'trip', status: 'pending' });
      if (approveFirst) s = apply(s, { t: 'approve', orderId: o.id }, NOW).s;
      s = apply(s, { t: 'endTurn', role: 'elec', week: s.week }, NOW).s;
      if (!approveFirst) {
        const r = apply(s, { t: 'approve', orderId: o.id }, NOW);
        expect(r.error).toBeUndefined();
        s = r.s;
        expect(s.orders.find((x) => x.id === o.id)!.status).toBe('ready');
      }
      s = endWeek(s);
      return s.orders.find((x) => x.id === o.id)!;
    };
    expect(run(true).result?.npc).toBe('Lina M.');
    const late = run(false);
    expect(late.result?.npc).toBeUndefined();
    expect(late.status).toBe('ready');
  });

  it("never in a week the electrician is away (nobody supervises), and it says so", () => {
    let s = at(4);
    helper(s, 3);
    job(s, { kind: 'trip', assetId: 'h1' });
    job(s, { kind: 'gfci', assetId: 'h2', title: 'GFCI in wet rooms' });
    s = endWeek(s, ['mech', 'fin']);
    expect(s.orders.some((o) => o.result?.npc)).toBe(false);
    expect(lastLines(s).some((l) => l.role === 'elec' && /Lina M\. \(electrician's helper\) did nothing this week: Ben was away/.test(l.text))).toBe(true);
  });

  it('by task, not by catalog kind: the routine device swaps only, never a diagnosis-led job (flicker, water heater, spa feed, storm rewire)', () => {
    let s = at(4);
    helper(s, 5);
    const no = [
      job(s, { kind: 'flicker', assetId: 'h1', title: 'Diagnose flickering lights', puzzle: 'meter' }),
      job(s, { kind: 'hottub', assetId: 'h1', title: 'Run conduit to the hot tub' }),
      job(s, { kind: 'storm', assetId: 'h2', title: 'Storm rewire' }),
    ];
    const wh = job(s, { kind: 'flicker', assetId: 'h2', title: 'Water heater repair' });
    wh.flow = { alert: 'none', task: 'ref:wh', pick: [], bench: [], tools: [], bom: 0, wired: true } as unknown as NonNullable<Order['flow']>;
    const yes = job(s, { kind: 'switch3', assetId: 'h2', title: '3-way switch repair' });
    expect(STAFF.helper.tasks).toEqual(['ref:outlet', 'ref:gfci', 'ref:3way', 'ref:gentest']);
    s = endWeek(s);
    for (const o of [...no, wh]) expect(s.orders.find((x) => x.id === o.id)!.result?.npc, o.title).toBeUndefined();
    expect(s.orders.find((x) => x.id === yes.id)!.result?.npc).toBe('Lina M.');
    expect(lastLines(s).some((l) => /diagnosis/i.test(l.text) && /helper/.test(l.text))).toBe(false);
  });

  it("each helper's 'tonight' is their own share, in the resolve's order; the chip on the job says who and how", () => {
    const s = at(4);
    const lina = helper(s, 3, 'Lina M.');
    const rangi = helper(s, 1, 'Rangi P.');
    for (const [i, h] of ['h1', 'h1', 'h2', 'h2'].entries()) job(s, { kind: 'trip', assetId: h, title: `Receptacle repair ${i}` });
    const q = helperQueues(s);
    expect(q.get(lina.id)!.length).toBe(2);
    expect(q.get(rangi.id)!.length).toBe(1);
    const mine = doingNow(s, lina);
    const theirs = doingNow(s, rangi);
    for (const o of q.get(rangi.id)!) expect(mine).not.toContain(o.title);
    for (const o of q.get(lina.id)!) expect(theirs).not.toContain(o.title);
    // a flow job in the queue: its chip explains itself on the open job
    const t = at(4);
    helper(t, 3);
    addStarter(t, 4);
    const al = raiseAlert(t, { role: 'elec', asset: asset(t, 'h1'), sym: 'E_DEAD_OUTLET', cause: 0 }, NOW);
    const task = planTask(t, al, 'ref:outlet')!;
    let x = apply(t, { t: 'plan', role: 'elec', alert: al.id, task: task.id, pick: stdPickFor(t, al, task), week: t.week }, NOW).s;
    const o = x.orders.find((y) => y.flow?.alert === al.id)!;
    if (o.status === 'pending') x = apply(x, { t: 'approve', orderId: o.id, week: x.week }, NOW).s;
    const chip = flagsOf(x, x.alerts!.find((a) => a.id === al.id)!).find((f) => f.text === 'helper tonight');
    expect(chip?.why).toMatch(/^Lina M\. \(electrician's helper\) puts this in at tonight's resolve as Ben planned it, unless Ben does it first\. It goes in under Ben's licence/);
  });

  it('a wrong plan the helper put in is traced to both: the electrician who planned it and the helper who put it in', () => {
    expect(tracedTo({ orderKind: 'gfci', title: 'GFCI replacement', name: 'Ben', week: 20, log: 'wet-room GFCI install', npc: 'Lina M.' })).toBe(
      "the wet-room GFCI install Ben planned and Lina M. (helper) put in under Ben's licence in week 20",
    );
    expect(tracedTo({ orderKind: 'gfci', title: 'GFCI replacement', name: 'Ben', week: 20, log: 'wet-room GFCI install' })).toBe('the wet-room GFCI install Ben signed off in week 20');
  });

  it("the hiring card gives the board's actual rule, and its money as a break-even against a cottage's expected rent", () => {
    // no helper, a short list and the houses holding: why not, by the first helper's rule
    const quiet = at(4);
    for (const h of quiet.assets.filter((a) => a.kind === 'house')) h.health = 80;
    const cand = { id: 'c1', name: 'Rangi P.', role: 'helper' as const, skill: 3 as const, ask: 290, start: quiet.week };
    expect(staffEffect(quiet, cand, 'hire').money).toBe('$290 a week · not needed yet: 0 of 6 alerts open and the houses at 80 (the first helps at 6 open or under 65)');
    // one on the payroll, the houses at 60: the second helper's rule, not "the list is short"
    const one = at(4);
    for (const h of one.assets.filter((a) => a.kind === 'house')) h.health = 60;
    for (let i = 0; i < 6; i++) raiseAlert(one, { role: 'elec', asset: asset(one, 'h1'), kind: 'trip' }, NOW);
    helper(one, 2);
    const e1 = staffEffect(one, cand, 'hire');
    expect(e1.money).toBe('$290 a week · not needed yet: the houses average 60: a second helps under 55');
    expect(e1.need).toMatch(/^1 helper already, the houses average 60: /);
    expect(e1.need).not.toMatch(/list is short/);
    // wanted: the money is a break-even against the 8-week, occupancy-weighted rent (the extra cottage's figure),
    // not a fully booked week's; the card sorts at its break-even, not at +$1,400
    const busy = at(4);
    for (let i = 0; i < 6; i++) raiseAlert(busy, { role: 'elec', asset: asset(busy, 'h1'), kind: 'trip' }, NOW);
    const e = staffEffect(busy, cand, 'hire');
    const rent = cottageRent(busy);
    const full = Math.max(...busy.assets.filter((a) => a.kind === 'house' && a.model === 'cottage').map((h) => houseWeekRevenue(busy, h)));
    expect(rent).toBeLessThan(full);
    expect(e.money).toContain(`a cottage rents about $${rent.toLocaleString('en-US')} a week`);
    expect(e.net).toBeLessThanOrEqual(0);
    // in receivership no card: it can't be hired there
    busy.receivership = 2;
    expect(helperWanted(busy)).toBe(false);
    expect(staffEffect(busy, cand, 'hire').money).toBe('$290 a week · not needed yet: in receivership, no new hires');
  });

  it('the review pins what the helper did (the resolve lines and the island log), and the closed job names them', () => {
    let s = at(4);
    helper(s, 3);
    const o = job(s, { kind: 'trip', assetId: 'h1' });
    s = endWeek(s);
    const done = s.orders.find((x) => x.id === o.id)!;
    expect(done.result).toMatchObject({ npc: 'Lina M.', week: 20 });
    expect(lastLines(s).filter((l) => l.role === 'elec' && /\(electrician's helpers?\)/.test(l.text)).length).toBe(1);
    expect(s.feed.some((f) => f.text === "The electrician's helper put in one of Ben's planned jobs: Trace dead outlets (Cottage 1).")).toBe(true);
  });
});

describe('the receiver and the helper', () => {
  it('in receivership the board wants no helper (it would deal a card that cannot be hired)', () => {
    STAFF.helper.enabled = true;
    try {
      const s = at(4);
      for (let i = 0; i < 6; i++) raiseAlert(s, { role: 'elec', asset: asset(s, 'h1'), kind: 'trip' }, NOW);
      expect(helperWanted(s)).toBe(true);
      s.receivership = 2;
      s.cash = -2000;
      expect(helperWanted(s)).toBe(false);
      expect(receiverLeft(s)).toBe(RECEIVER.allowance);
    } finally {
      STAFF.helper.enabled = false;
    }
  });
});
