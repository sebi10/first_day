// Review round 1 of A0 (docs/DECISIONS.md "2026-09-29: A0 review round 1"): the late game's two new pieces.
//   - the electrician's helper: an NPC the analyst hires from the Harbor (tier 4) who does the electrician's planned
//     routine installs at the resolve (never the licensed work), and whose rounds let the electrician's list run longer.
//     Held back for the stage 1 release (STAFF.helper.enabled false, DECISIONS "2026-09-29: stage 1 release gate"):
//     these tests turn it on, and tests/releasegate.test.ts checks it's off in the build
//   - the receiver: an island in receivership that can't pay isn't locked out. The receiver funds safety-critical work
//     up to $1,500 a week (added to the bridge loan) and takes its payment only out of cash above $0
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { generateAlerts, liveAlerts, raiseAlert } from '../src/sim/alerts';
import { simulate, TEAMS } from '../src/sim/bots';
import { RECEIVER } from '../src/sim/data';
import { apply, createIsland, receiverFunds, receiverLeft, tracedTo } from '../src/sim/engine';
import { planTask, stdPickFor } from '../src/sim/flow';
import { rng } from '../src/sim/rng';
import { addStarter } from '../src/sim/stock';
import { boardNeeds, cottagePlan, helperJobs, helperWanted, nextCashGate, STAFF, staffEffect, staffOpenWeek } from '../src/sim/staff';
import { defaultTaskNo } from '../src/sim/tasks';
import { ROLES, type IslandState, type Npc, type Order, type Role } from '../src/sim/types';

// whole-season sims below: CI runners are about 1.5x slower
vi.setConfig({ testTimeout: 30000 });

const NOW = Date.UTC(2026, 8, 26, 10);

function started(): IslandState {
  let s = createIsland({ id: 'lf', name: 'Late Isle', now: NOW, tz: 'Europe/Paris', seed: 7, creator: { uid: 'a', name: 'Ana', role: 'mech' } });
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

const helper = (s: IslandState, skill: Npc['skill'] = 3): Npc => {
  const n: Npc = { id: `n${s.nextId++}`, name: 'Lina M.', role: 'helper', skill, wage: 280, hired: s.week, start: s.week };
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

const asset = (s: IslandState, id: string) => s.assets.find((a) => a.id === id)!;

describe("the electrician's helper (from tier 4)", () => {
  // (off in the release: the helper's code and tests stay, run with it on)
  beforeAll(() => {
    STAFF.helper.enabled = true;
  });
  afterAll(() => {
    STAFF.helper.enabled = false;
  });

  it('the board offers one only from tier 4, when the electrician has 6 alerts open and no helper; the hire is refused before tier 4', () => {
    for (const tier of [3, 4]) {
      const s = at(tier);
      for (let i = 0; i < 6; i++) raiseAlert(s, { role: 'elec', asset: asset(s, i % 2 ? 'h1' : 'h2'), kind: i % 2 ? 'trip' : 'flicker' }, NOW);
      expect(helperWanted(s), `tier ${tier}`).toBe(tier >= 4);
      expect(boardNeeds(s).includes('helper'), `tier ${tier}`).toBe(tier >= 4);
      staffOpenWeek(s, rng(1), NOW);
      expect(s.hiring!.cands.some((c) => c.role === 'helper'), `tier ${tier}`).toBe(tier >= 4);
      // below tier 4 no candidate is ever one; a forged one is refused
      if (tier < 4) {
        s.hiring!.cands.push({ id: 'cx', name: 'X', role: 'helper', skill: 3, ask: 280, start: s.week });
        expect(apply(s, { t: 'hire', cand: 'cx', week: s.week }, NOW).error).toMatch(/Harbor/);
      } else {
        const c = s.hiring!.cands.find((x) => x.role === 'helper')!;
        const r = apply(s, { t: 'hire', cand: c.id, week: s.week }, NOW);
        expect(r.error).toBeUndefined();
        expect(r.s.staff!.some((n) => n.role === 'helper')).toBe(true);
        expect(helperWanted(r.s)).toBe(false);
      }
    }
  });

  it('before tier 4 the hiring board draws exactly as before (no helper in the pool)', () => {
    for (let w = 5; w < 40; w++) {
      const s = at(3);
      s.week = w;
      staffOpenWeek(s, rng(1), NOW);
      expect(s.hiring!.cands.every((c) => c.role !== 'helper')).toBe(true);
    }
  });

  it('at the resolve a skill-3 helper does 2 of the ready routine device swaps, the most urgent first, at 60%, and never the licensed work or a diagnosis', () => {
    let s = at(4);
    s.weather = 'clear';
    const n = helper(s, 3);
    const g = s.assets.find((a) => a.kind === 'grid')!;
    asset(s, 'h1').health = 50;
    asset(s, 'h2').health = 70;
    const low = job(s, { kind: 'trip', assetId: 'h1', title: 'Trace dead outlets' });
    job(s, { kind: 'gfci', assetId: 'h2', title: 'GFCI in wet rooms', gain: 10 });
    // a diagnosis is the electrician's (the release gate: by task, not by catalog kind)
    const flick = job(s, { kind: 'flicker', assetId: 'h2', title: 'Diagnose flickering lights', puzzle: 'meter' });
    // the licensed work: code prep, the grid's feed, a repair
    const prep = job(s, { kind: 'codeprep', assetId: 'h1', title: 'Code inspection prep', puzzle: 'panel', gain: 6 });
    const feeder = job(s, { kind: 'feeder', assetId: g.id, title: 'Find and re-splice the cottage feeder', gain: 16 });
    const repair = job(s, { kind: 'repair', assetId: 'h2', title: 'Re-terminate the backstab' });
    const before = { h1: asset(s, 'h1').health, h2: asset(s, 'h2').health };
    // the electrician plays nothing this week (ends the turn), so the helper takes what's ready
    s = endWeek(s);
    const done = s.orders.filter((o) => o.result?.npc === n.name);
    expect(done.length).toBe(STAFF.helper.jobs[2]);
    // the most urgent first: the house at 50
    expect(done.some((o) => o.id === low.id)).toBe(true);
    for (const o of done) {
      expect(o.result).toMatchObject({ score: 0.6, by: 'elec', auto: true, npc: 'Lina M.' });
      expect(STAFF.helper.tasks).toContain(o.flow ? o.flow.task : defaultTaskNo(o.kind));
    }
    for (const o of [prep, feeder, repair, flick]) expect(s.orders.find((x) => x.id === o.id)!.status, o.kind).toBe('ready');
    // the gain landed at the helper's score (then the week's decay)
    expect(asset(s, 'h1').health).toBeGreaterThan(before.h1);
    expect(s.history[s.history.length - 1].lines.some((l) => /Lina M\. \(electrician's helper\) did Trace dead outlets on Cottage 1, as Ben planned \(60%\)/.test(l.text))).toBe(true);
    // and the island log says what the helper put in (the release gate: the review's nine lines could hide it)
    expect(s.feed.some((f) => /The electrician's helper put in 2 of Ben's planned jobs/.test(f.text))).toBe(true);
  });

  it("a hazard's fix is never the helper's, made safe or not: the electrician puts what they made safe back in service (the release gate)", () => {
    for (const safe of [false, true]) {
      let s = at(4);
      helper(s, 3);
      const h = asset(s, 'h1');
      const al = raiseAlert(s, { role: 'elec', asset: h, sym: 'E_WARM_OUTLET', cause: 0, due: s.week + 1 }, NOW);
      if (safe) al.safe = { how: 'breaker', week: s.week, by: 'Ben' };
      const o = job(s, { kind: al.kind, assetId: h.id, title: 'Receptacle repair' });
      o.flow = { alert: al.id, task: 'ref:outlet', pick: [], bench: [], tools: [], bom: 0, wired: true } as unknown as NonNullable<Order['flow']>;
      al.status = 'job';
      al.order = o.id;
      s = endWeek(s);
      expect(s.orders.find((x) => x.id === o.id)!.result?.npc, `safe ${safe}`).toBeUndefined();
    }
  });

  it("the plan is the electrician's: a wrong task the helper puts in as planned surfaces later, traced to the electrician", () => {
    let s = at(4);
    helper(s, 3);
    addStarter(s, 4);
    // dead outlets from a loose receptacle (the fix is ref:outlet); the electrician plans the GFCI swap instead
    const al = raiseAlert(s, { role: 'elec', asset: asset(s, 'h1'), sym: 'E_DEAD_OUTLET', cause: 0 }, NOW);
    const task = planTask(s, al, 'ref:gfci')!;
    expect(task).toBeDefined();
    const r = apply(s, { t: 'plan', role: 'elec', alert: al.id, task: task.id, pick: stdPickFor(s, al, task), week: s.week }, NOW);
    expect(r.error).toBeUndefined();
    s = r.s;
    let o = s.orders.find((x) => x.flow?.alert === al.id)!;
    if (o.status === 'pending') s = apply(s, { t: 'approve', orderId: o.id, week: s.week }, NOW).s;
    o = s.orders.find((x) => x.id === o.id)!;
    expect(o.status).toBe('ready');
    s = endWeek(s);
    expect(s.orders.find((x) => x.id === o.id)!.result?.npc).toBe('Lina M.');
    const d = (s.defects ?? []).find((x) => x.variant === 'task');
    // traced to the electrician's plan, and naming who put it in (the release gate)
    expect(d).toMatchObject({ by: 'elec', name: 'Ben', npc: 'Lina M.' });
    expect(tracedTo(d!)).toMatch(/Ben planned and Lina M\. \(helper\) put in under Ben's licence in week 20$/);
  });

  it("the helper's rounds let the electrician's list run longer: the target and the week's slots grow by the helper's jobs", () => {
    const count = (withHelper: boolean) => {
      const s = at(4);
      for (const h of s.assets.filter((a) => a.kind === 'house')) h.health = 60;
      if (withHelper) helper(s, 3);
      // five open already: the target (5 from tier 3) is met without a helper
      for (let i = 0; i < 5; i++) raiseAlert(s, { role: 'elec', asset: asset(s, i % 2 ? 'h1' : 'h2'), kind: i % 2 ? 'trip' : 'flicker' }, NOW);
      const before = liveAlerts(s).filter((a) => a.role === 'elec').length;
      generateAlerts(s, rng(3), NOW, () => {});
      return liveAlerts(s).filter((a) => a.role === 'elec' && a.cause >= 0).length - before;
    };
    expect(helperJobs({ staff: [], tier: 4, week: 20 })).toBe(0);
    expect(count(false)).toBe(0);
    expect(count(true)).toBeGreaterThan(0);
    expect(count(true)).toBeLessThanOrEqual(STAFF.helper.jobs[2]);
  });

  it("the hiring card says what the helper does, what stays the electrician's, and the money in the analyst's terms", () => {
    const s = at(4);
    for (let i = 0; i < 6; i++) raiseAlert(s, { role: 'elec', asset: asset(s, 'h1'), kind: 'trip' }, NOW);
    const e = staffEffect(s, { id: 'c1', name: 'Lina M.', role: 'helper', skill: 3, ask: 280, start: s.week }, 'hire');
    expect(e.does).toBe("does 2 planned routine jobs of Ben's a week, at 60%");
    expect(e.need).toMatch(/Ben has 6 alerts open/);
    expect(e.need).toMatch(/receptacles, GFCIs, 3-way switches and the generator's circuit test/);
    expect(e.need).toMatch(/the diagnosis, a hazard's fix, code prep, the grid's feed and repairs stay Ben's/);
    // the money as a break-even against a cottage's expected rent (the release gate: not a fully booked week's)
    expect(e.money).toMatch(/^\$280 a week · (breaks even if it keeps a cottage open 1 week in \d+ \(a cottage rents about \$[\d,]+ a week\)|more than a cottage rents \(about \$[\d,]+ a week\))$/);
  });

  it('the bots hire one only once the Resort’s cash gate is covered (payroll before it only delays the tier), and solo or absent teams never do', () => {
    let first: IslandState | undefined;
    simulate(TEAMS['three friends'], 40, 1, (x) => {
      if (!first && x.staff?.some((n) => n.role === 'helper')) first = structuredClone(x);
    });
    expect(first).toBeDefined();
    const hired = first!.staff!.find((n) => n.role === 'helper')!;
    expect(first!.tier).toBeGreaterThanOrEqual(4);
    // hired at the Resort, or at the Harbor with the Resort's $60,000 in hand
    if (first!.tier === 4) expect(nextCashGate(first!)).toBe(60_000);
    expect(hired.skill).toBeGreaterThanOrEqual(2);
    for (const team of ['solo elec', 'elec absent', 'nobody']) {
      const { final } = simulate(TEAMS[team], 30, 2);
      expect(final.staff!.some((n) => n.role === 'helper'), team).toBe(false);
    }
  });

  it("an extra cottage's plan counts its upkeep and says how full the electrician's list is", () => {
    const s = at(4);
    s.stats.tierReachedWeek[4] = 15;
    for (let i = 0; i < 7; i++) raiseAlert(s, { role: 'elec', asset: asset(s, 'h1'), kind: 'trip' }, NOW);
    const p = cottagePlan(s);
    expect(p.open).toBe(7);
    // (3 decay at 80, 1 wear) x the house jobs' price per health point, rounded to $10
    expect(p.upkeep).toBeGreaterThan(40);
    expect(p.upkeep).toBeLessThan(200);
  });
});

describe('the receiver (in receivership, cash below $0)', () => {
  /** in receivership, cash below zero, the bridge loan running */
  function broke(): IslandState {
    const s = at(4);
    s.cash = -5000;
    s.receivership = 2;
    s.loan = { left: 10_000, weekly: 1_000 };
    return s;
  }

  it('safety-critical work is approved: the receiver advances the shortfall into the bridge loan, up to $1,500 a week', () => {
    const s = broke();
    asset(s, 'h1').health = 30;
    const prep = job(s, { kind: 'codeprep', assetId: 'h1', title: 'Code inspection prep', status: 'pending', cost: 400 });
    expect(receiverLeft(s)).toBe(RECEIVER.allowance);
    expect(receiverFunds(s, 400, true, s.cash)).toBe(400);
    const r = apply(s, { t: 'approve', orderId: prep.id }, NOW);
    expect(r.error).toBeUndefined();
    // the receiver paid for it: the cash is where it was, the loan owes the advance plus 15%
    expect(r.s.cash).toBe(-5000);
    expect(r.s.loan).toMatchObject({ left: 10_000 + Math.round(400 * 1.15), adv: { week: s.week, usd: 400 } });
    expect(receiverLeft(r.s)).toBe(RECEIVER.allowance - 400);
    // past the week's allowance it waits, and says why
    const big = job(r.s, { kind: 'codeprep', assetId: 'h2', title: 'Code inspection prep', status: 'pending', cost: 1200 });
    expect(apply(r.s, { t: 'approve', orderId: big.id }, NOW).error).toBe("Not enough cash, and the receiver's repair allowance has $1,100 left this week ($1,200 card).");
    // work that isn't safety-critical: the receiver doesn't fund it, and says so
    asset(r.s, 'h2').health = 90;
    const nice = job(r.s, { kind: 'hottub', assetId: 'h2', title: 'Run conduit to the hot tub', status: 'pending', cost: 460, gain: 16 });
    expect(apply(r.s, { t: 'approve', orderId: nice.id }, NOW).error).toMatch(/Cash under \$2,000: only safety-critical work|receiver funds only safety-critical work/);
  });

  it('outside receivership nothing changes: below $0 is "Not enough cash."', () => {
    const s = at(4);
    s.cash = -500;
    asset(s, 'h1').health = 30;
    const prep = job(s, { kind: 'codeprep', assetId: 'h1', status: 'pending', cost: 150 });
    expect(receiverFunds(s, 150, true, s.cash)).toBeNull();
    expect(apply(s, { t: 'approve', orderId: prep.id }, NOW).error).toBe('Not enough cash.');
  });

  it('the allowance renews each week', () => {
    const s = broke();
    s.loan!.adv = { week: s.week, usd: RECEIVER.allowance };
    expect(receiverLeft(s)).toBe(0);
    s.week += 1;
    expect(receiverLeft(s)).toBe(RECEIVER.allowance);
  });

  it('the receiver takes its payment only out of cash above $0, and the crew is told the way out', () => {
    let s = broke();
    const left = s.loan!.left;
    s = endWeek(s);
    const h = s.history[s.history.length - 1];
    // the week's revenue at tier 4 with two cottages doesn't cover the fixed costs: nothing was above $0 to pay from
    expect(h.cashEnd).toBeLessThan(0);
    expect(s.loan!.left).toBe(left);
    expect(h.lines.some((l) => l.role === 'fin' && /comes only out of cash above \$0/.test(l.text))).toBe(true);
    // in plain numbers (the release gate): the week's revenue against overhead and payroll, the fee, what's owed
    expect(h.lines.some((l) => l.role === 'all' && /^Receivership, cash −\$[\d,]+: revenue \$[\d,]+ this week against \$[\d,]+ of overhead and payroll\. .*15% fee; \$[\d,]+ owed/.test(l.text))).toBe(true);
    expect(h.lines.some((l) => /The way out is revenue/.test(l.text))).toBe(false);
    // out of receivership the payment is taken in full, as before
    let t = at(4);
    t.loan = { left: 5_000, weekly: 500 };
    t = endWeek(t);
    expect(t.loan!.left).toBe(4_500);
  });
});

