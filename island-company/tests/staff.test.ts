// NPC staff (docs/JOBFLOW.md 15, package D): pilots, housekeepers and builders
// on the island's payroll. The standard crew reproduces the game as it played
// before the staff update; hiring better, worse, more or fewer moves the
// numbers from there, and every hire says what it does for this island.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { simulate, TEAMS } from '../src/sim/bots';
import { MODELS, TIERS } from '../src/sim/data';
import { capFleet, capOf, fixedNow, planes, projectWeek } from '../src/sim/econ';
import { apply, cloneState, createIsland, resolveWeek } from '../src/sim/engine';
import { migrate } from '../src/sim/migrate';
import { rng } from '../src/sim/rng';
import {
  BUILDS,
  COTTAGE,
  COTTAGE_SHELL,
  NPC_ROLES,
  STAFF,
  STAFF_TEST,
  boardNeeds,
  botStaff,
  buildWeek,
  builtShare,
  charterMult,
  commissioning,
  cottagePlan,
  housekeepingCap,
  openBuild,
  payroll,
  pilotCap,
  pilotOf,
  pilotSeats,
  reviewMult,
  squawkNff,
  staffAfterFlights,
  staffEffect,
  standardCount,
  standardPayroll,
  wearMult,
} from '../src/sim/staff';
import { available } from '../src/sim/stock';
import { buildLine } from '../src/ui/staff/model';
import { ROLES, type Asset, type Candidate, type IslandState, type Npc, type NpcRole, type ReportLine, type Role } from '../src/sim/types';

vi.setConfig({ testTimeout: 30000 });
afterEach(() => {
  STAFF_TEST.stubs = false;
  STAFF_TEST.hardLandings = true;
});

const NOW = Date.UTC(2026, 8, 26, 10);
function started(seed = 9): IslandState {
  let s = createIsland({ id: 'npc', name: 'Staff Isle', now: NOW, tz: 'UTC', seed, creator: { uid: 'a', name: 'Ana', role: 'mech' } });
  s = apply(s, { t: 'join', uid: 'b', name: 'Ben', role: 'elec' }, NOW).s;
  s = apply(s, { t: 'join', uid: 'c', name: 'Cy', role: 'fin' }, NOW).s;
  for (const r of ROLES) s = apply(s, { t: 'week0Done', role: r }, NOW).s;
  return s;
}

/** an island at a tier, with that tier's assets (health 85) and the standard crew for it */
function atTier(tier: number, seed = 9): IslandState {
  const s = started(seed);
  for (let t = 2; t <= tier; t++)
    for (const a of TIERS[t - 1].adds) {
      const kind = MODELS[a.model].kind;
      s.assets.push({ id: a.id, kind, model: a.model, name: a.name, health: 85, touchedWeek: 0, ...(kind === 'house' ? { inspectionUntil: 30 } : {}), ...(kind === 'plane' ? { sinceInspection: 2 } : {}) });
    }
  s.tier = tier;
  s.weather = 'clear';
  for (const a of s.assets) a.health = 85;
  s.staff = crew(s, tier);
  s.builds = BUILDS.map((b) => ({ id: b.id, what: b.what, tier: b.tier, done: b.units.length, drawn: b.units.length, need: b.units.length, started: 0, finished: 0 }));
  return s;
}

let seq = 0;
const npc = (role: NpcRole, skill: Npc['skill'] = 3, over: Partial<Npc> = {}): Npc => ({ id: `n${900 + ++seq}`, name: `T${seq}.`, role, skill, wage: Math.round(STAFF.wage[role] * STAFF.skillWage[skill - 1]), hired: 0, start: 0, ...over });
/** the standard crew for a tier, all skill 3 */
const crew = (_s: IslandState, tier: number): Npc[] => NPC_ROLES.flatMap((r) => Array.from({ length: standardCount(tier, r) }, () => npc(r)));
const cand = (s: IslandState, role: NpcRole, skill: Candidate['skill'], ask?: number): Candidate => {
  const c: Candidate = { id: `c${s.week}-${++seq}`, name: `C${seq}.`, role, skill, ask: ask ?? Math.round(STAFF.wage[role] * STAFF.skillWage[skill - 1]), start: skill >= 4 ? s.week + 1 : s.week };
  s.hiring = { week: s.week, cands: [...(s.hiring?.week === s.week ? s.hiring.cands : []), c] };
  return c;
};
const lines = () => {
  const out: ReportLine[] = [];
  return { out, line: (role: ReportLine['role'], tone: ReportLine['tone'], text: string) => out.push({ role, tone, text }) };
};
const fleetFlights = (s: IslandState) => capFleet(s, planes(s).map((p) => ({ plane: p, n: capOf(s, p) }))).reduce((t, c) => t + c.n, 0);

describe('the standard crew reproduces the game before the staff update', () => {
  it('its payroll plus the overhead is the tier’s fixed cost, and it flies, turns over and books exactly as the stubs', () => {
    for (let tier = 1; tier <= 5; tier++) {
      const s = atTier(tier);
      expect(payroll(s), `tier ${tier}`).toBe(standardPayroll(tier));
      expect(fixedNow(s)).toBe(TIERS[tier - 1].fixed);
      const d = projectWeek(s);
      STAFF_TEST.stubs = true;
      const st = projectWeek(s);
      const stubFlights = fleetFlights(s);
      STAFF_TEST.stubs = false;
      expect(d).toEqual(st);
      expect(fleetFlights(s)).toBe(stubFlights);
      expect(charterMult(s)).toBe(1);
      expect(reviewMult(s)).toBe(1);
      for (const p of planes(s)) {
        expect(wearMult(s, p.id)).toBe(1);
        expect(squawkNff(s, p.id)).toBe(0);
        expect(pilotOf(s, p.id)?.role).toBe('pilot');
      }
    }
  });

  it('with hard landings off, every week of a season resolves the same with the standard crew as with the stubs', () => {
    STAFF_TEST.hardLandings = false;
    // a season on the stubs; at each week, the same island resolved both ways
    STAFF_TEST.stubs = true;
    const snaps: IslandState[] = [];
    simulate(TEAMS['three friends'], 24, 5, (s) => snaps.push(cloneState(s)));
    STAFF_TEST.stubs = false;
    let compared = 0;
    for (const snap of snaps.filter((_, i) => i % 3 === 0)) {
      const run = (stub: boolean) => {
        STAFF_TEST.stubs = stub;
        const s = cloneState(snap);
        s.staff = crew(s, s.tier);
        for (const r of ROLES) s.turns[r] = { ended: true, endedAt: NOW, done: 0 };
        resolveWeek(s, NOW);
        STAFF_TEST.stubs = false;
        const h = s.history.at(-1)!;
        return { revenue: h.revenue, flown: h.flightsFlown, scheduled: h.flightsScheduled, booked: h.housesBooked, rentable: h.housesRentable, fixed: h.costs.fixed, payroll: h.costs.payroll, cash: h.cashEnd };
      };
      expect(run(false), `week ${snap.week}`).toEqual(run(true));
      compared++;
    }
    expect(compared).toBeGreaterThanOrEqual(7);
  });

  it('the week a tier arrives, the contractor commissions it: nothing is lost before the analyst can hire', () => {
    const s = atTier(4);
    s.staff = crew(s, 3); // one housekeeper short for the villas
    s.stats.tierReachedWeek[4] = s.week;
    expect(commissioning(s, 'housekeeper')).toBe(1);
    expect(housekeepingCap(s)).toBe(8);
    expect(projectWeek(s).booked).toBe(6);
    s.stats.tierReachedWeek[4] = s.week - 1;
    expect(housekeepingCap(s)).toBe(4);
    expect(projectWeek(s).booked).toBe(4);
  });
});

describe('pilots', () => {
  it('each flies 6 a week; skill 1–2 fly the cargo runs only; the cargo plane’s flights go first', () => {
    const s = atTier(2);
    s.staff = [npc('pilot', 3), npc('housekeeper')];
    expect(pilotCap(s)).toEqual({ guest: 6, total: 6 });
    // twin 4 + cargo 4: the twin flies all four, the cargo plane two
    const flights = capFleet(s, planes(s).map((p) => ({ plane: p, n: capOf(s, p) })));
    expect(flights.map((c) => [c.plane.model, c.n])).toEqual([['twin', 4], ['cargo', 2]]);
    // a green pilot flies cargo only: the twin needs a skill-3 pilot
    s.staff = [npc('pilot', 2), npc('housekeeper')];
    expect(pilotCap(s)).toEqual({ guest: 0, total: 6 });
    expect(capFleet(s, planes(s).map((p) => ({ plane: p, n: capOf(s, p) }))).map((c) => c.n)).toEqual([0, 4]);
    expect(pilotOf(s, 'p1')).toBeUndefined();
    expect(pilotOf(s, 'p2')?.skill).toBe(2);
    // no pilot: nothing flies
    s.staff = [npc('housekeeper')];
    expect(pilotCap(s)).toEqual({ guest: 0, total: 0 });
  });

  it('the best pilot takes the guest planes; tours, wear and write-ups follow the pilot', () => {
    const s = atTier(4);
    const ace = npc('pilot', 5);
    const green = npc('pilot', 1);
    s.staff = [npc('pilot', 3), ace, green, npc('housekeeper'), npc('housekeeper')];
    const seats = pilotSeats(s);
    expect(seats.get('p1')![0].npc.id).toBe(ace.id);
    expect(pilotOf(s, 'p2')!.id).toBe(green.id);
    // the guest planes' pilots: the ace's 4 on the twin plus a split float, weighted by flights
    expect(charterMult(s)).toBeGreaterThan(1);
    expect(wearMult(s, 'p1')).toBe(STAFF.wear[4]);
    expect(wearMult(s, 'p2')).toBe(STAFF.wear[0]);
    expect(squawkNff(s, 'p2')).toBe(STAFF.squawkNff[0]);
    expect(squawkNff(s, 'p1')).toBe(0);
    // a skill-5 pair sells 8% more tours
    s.staff = [npc('pilot', 5), npc('pilot', 5), npc('pilot', 5), npc('housekeeper'), npc('housekeeper')];
    expect(charterMult(s)).toBeCloseTo(1.08);
  });

  it('a hard landing: −2 on the plane, M_HARD_LANDING for next week in the pilot’s name, never on the only guest plane', () => {
    const W = 6;
    const hit = (s: IslandState, planeId: string) => {
      const { out, line } = lines();
      const plane = s.assets.find((a) => a.id === planeId)!;
      // a pilot who always lands hard
      const old = [...STAFF.hardLanding];
      STAFF.hardLanding.fill(1);
      try {
        staffAfterFlights(s, [{ plane, n: 4 }], rng(1), W, line);
      } finally {
        STAFF.hardLanding.splice(0, 5, ...old);
      }
      return out;
    };
    const t1 = atTier(1);
    expect(hit(t1, 'p1')).toEqual([]);
    expect(t1.alerts!.some((a) => a.sym === 'M_HARD_LANDING')).toBe(false);
    const s = atTier(2);
    const before = s.assets.find((a) => a.id === 'p2')!.health;
    const out = hit(s, 'p2');
    const a = s.alerts!.find((x) => x.sym === 'M_HARD_LANDING')!;
    expect(a).toMatchObject({ assetId: 'p2', week: W + 1, due: W + 1, src: 'landing', who: pilotOf(s, 'p2')!.name });
    expect(s.assets.find((x) => x.id === 'p2')!.health).toBe(before - STAFF.hardLandingHit);
    expect(out[0].text).toMatch(/^Hard landing: .+ on Cargo C-7 \(−2\)/);
    // one a week per plane, and not while one is open
    expect(hit(s, 'p2')).toEqual([]);
    // the test switch turns them off
    STAFF_TEST.hardLandings = false;
    const q = atTier(2);
    expect(hit(q, 'p2')).toEqual([]);
  });
});

describe('housekeepers', () => {
  it('bookings are capped by turnovers; reviews follow their skill', () => {
    const s = atTier(4);
    s.staff = [npc('pilot'), npc('pilot'), npc('housekeeper', 1)];
    expect(housekeepingCap(s)).toBe(2);
    expect(projectWeek(s).booked).toBe(2);
    expect(reviewMult(s)).toBeCloseTo(0.95);
    s.staff = [npc('pilot'), npc('pilot'), npc('housekeeper', 5), npc('housekeeper', 5)];
    expect(housekeepingCap(s)).toBe(12);
    expect(reviewMult(s)).toBeCloseTo(1.05);
    // no housekeeper: nothing is booked
    s.staff = [npc('pilot'), npc('pilot')];
    expect(projectWeek(s).booked).toBe(0);
  });
});

describe('the analyst’s moves', () => {
  it('hire: on this week’s board, room on the island, not in receivership; the candidate joins at their ask', () => {
    let s = started();
    const c = cand(s, 'pilot', 4, 400);
    expect(apply(s, { t: 'hire', cand: 'nobody', week: s.week }, NOW).error).toBe('That candidate took another job.');
    const broke = cloneState(s);
    broke.receivership = 2;
    expect(apply(broke, { t: 'hire', cand: c.id, week: s.week }, NOW).error).toBe('In receivership: no new hires.');
    const full = cloneState(s);
    full.staff = Array.from({ length: STAFF.maxStaff }, () => npc('builder'));
    expect(apply(full, { t: 'hire', cand: c.id, week: s.week }, NOW).error).toBe('No room on the island for more staff.');
    expect(apply(s, { t: 'hire', cand: c.id, week: s.week - 1 }, NOW).error).toMatch(/closed before that synced/);
    const before = payroll(s);
    s = apply(s, { t: 'hire', cand: c.id, week: s.week }, NOW).s;
    const n = s.staff!.find((x) => x.name === c.name)!;
    expect(n).toMatchObject({ role: 'pilot', skill: 4, wage: 400, hired: s.week, start: s.week + 1 });
    expect(n.id).toMatch(/^n\d+$/);
    expect(s.hiring!.cands.some((x) => x.id === c.id)).toBe(false);
    // skill 4-5 give notice: paid and at work from next week
    expect(payroll(s)).toBe(before);
    expect(apply(s, { t: 'hire', cand: c.id, week: s.week }, NOW).error).toBe('That candidate took another job.');
  });

  it('let go: two weeks’ severance now (none for a hire withdrawn the week it was made), cash permitting', () => {
    let s = started();
    const b = s.staff!.find((n) => n.role === 'builder')!;
    const poor = cloneState(s);
    poor.cash = 100;
    expect(apply(poor, { t: 'letGo', npc: b.id, week: s.week }, NOW).error).toBe(`Not enough cash for the severance ($${(2 * b.wage).toLocaleString('en-US')}).`);
    expect(apply(s, { t: 'letGo', npc: 'n999', week: s.week }, NOW).error).toBe('They have already left.');
    const cash = s.cash;
    s = apply(s, { t: 'letGo', npc: b.id, week: s.week }, NOW).s;
    expect(s.cash).toBe(cash - 2 * b.wage);
    expect(s.staff!.some((n) => n.id === b.id)).toBe(false);
    expect(s.ledger!.find((r) => r.w === s.week)!.sp.payroll).toBe(2 * b.wage);
    // a hire withdrawn the same week costs nothing
    const c = cand(s, 'housekeeper', 3);
    s = apply(s, { t: 'hire', cand: c.id, week: s.week }, NOW).s;
    const h = s.staff!.find((n) => n.name === c.name)!;
    const cash2 = s.cash;
    s = apply(s, { t: 'letGo', npc: h.id, week: s.week }, NOW).s;
    expect(s.cash).toBe(cash2);
  });

  it('payroll is booked at the resolve: what the crew at work earns this week', () => {
    let s = started();
    const c = cand(s, 'pilot', 3, 330);
    s = apply(s, { t: 'hire', cand: c.id, week: s.week }, NOW).s;
    const W = s.week;
    s = apply(s, { t: 'resolve', week: W }, s.deadline! + 1).s;
    const h = s.history.find((x) => x.week === W)!;
    expect(h.costs.payroll).toBe(standardPayroll(1) + 330);
    expect(h.costs.fixed).toBe(TIERS[0].overhead + standardPayroll(1) + 330);
  });

  it('a cottage: tier 3, a free plot (two at most), the shell’s cash; it queues behind the tier’s site work', () => {
    let s = atTier(2);
    expect(apply(s, { t: 'build', what: 'cottage', week: s.week }, NOW).error).toBe('Extra cottages open at tier 3.');
    s = atTier(3);
    s.cash = 5000;
    expect(apply(s, { t: 'build', what: 'cottage', week: s.week }, NOW).error).toBe(`Not enough cash for the shell ($${COTTAGE_SHELL.toLocaleString('en-US')}).`);
    s.cash = 60000;
    s.builds = s.builds!.map((b) => (b.id === 't4' ? { ...b, done: 0, drawn: 0, finished: undefined } : b));
    s = apply(s, { t: 'build', what: 'cottage', week: s.week }, NOW).s;
    expect(s.cash).toBe(60000 - COTTAGE_SHELL);
    expect(s.builds!.at(-1)).toMatchObject({ cottage: 'h8', done: 0, need: COTTAGE.units.length });
    // the tier's own site work comes first
    expect(openBuild(s)!.id).toBe('t4');
    s = apply(s, { t: 'build', what: 'cottage', week: s.week }, NOW).s;
    expect(s.builds!.at(-1)!.cottage).toBe('h9');
    expect(apply(s, { t: 'build', what: 'cottage', week: s.week }, NOW).error).toBe('Two extra cottages is all the island has room for.');
    const r = cloneState(s);
    r.receivership = 1;
    r.builds = r.builds!.filter((b) => !b.cottage);
    expect(apply(r, { t: 'build', what: 'cottage', week: s.week }, NOW).error).toBe('In receivership: no new building.');
  });

  it('staff moves are the analyst’s and aren’t locked by End turn', () => {
    let s = started();
    s = apply(s, { t: 'endTurn', role: 'fin' }, NOW).s;
    const c = cand(s, 'builder', 2);
    expect(apply(s, { t: 'hire', cand: c.id, week: s.week }, NOW).error).toBeUndefined();
  });
});

describe('builders and the site work', () => {
  it('a new island’s crew starts on cottages 3 and 4 in week 1: its lots came with the island', () => {
    const s = started();
    expect(openBuild(s)!.id).toBe('t2');
    for (const [id, q] of Object.entries(BUILDS[0].units.reduce((m, u) => ({ ...m, ...u }), {}))) expect(available(s, id), id).toBe(q);
    const r = apply(s, { t: 'resolve', week: s.week }, s.deadline! + 1).s;
    expect(r.builds!.find((b) => b.id === 't2')).toMatchObject({ done: 1, drawn: 1 });
    expect(available(r, 'BLD-FTG')).toBe(0);
  });

  it('a unit’s materials leave stock all at once before its work starts; short, the builders wait (idle)', () => {
    const s = atTier(1);
    s.builds = [{ id: 't2', what: BUILDS[0].what, tier: 2, done: 0, drawn: 0, need: 3, started: 0 }];
    s.inv = {};
    s.staff = [npc('pilot'), npc('housekeeper'), npc('builder', 5)];
    const { out, line } = lines();
    buildWeek(s, rng(1), s.week, line);
    expect(s.builds[0]).toMatchObject({ done: 0, drawn: 0, idle: 1 });
    expect(out.at(-1)!.text).toBe('Builders idle on cottages 3 and 4: waiting on 1 × BLD-FTG (not ordered). Buy it on the desk (Staff).');
    // materials on the shelf: a skill-5 builder does 1.5 units, drawing unit 1's lots at its start
    s.inv = { 'BLD-FTG': { on: 1 }, 'BLD-DECK': { on: 1 }, 'BLD-TIE': { on: 1 } };
    buildWeek(s, rng(1), s.week + 1, line);
    expect(s.builds[0]).toMatchObject({ done: 1.5, drawn: 2 });
    expect(available(s, 'BLD-DECK')).toBe(0);
    // unit 2's flashing is short: work stops at the boundary, never past what was drawn
    buildWeek(s, rng(1), s.week + 2, line);
    expect(s.builds[0].done).toBe(2);
    expect(out.at(-1)!.text).toMatch(/^Builders stopped on cottages 3 and 4/);
  });

  it('rework loses the builder-week and draws a box of ties; a finished build opens the next', () => {
    const s = atTier(1);
    s.builds = [{ id: 't2', what: BUILDS[0].what, tier: 2, done: 2, drawn: 3, need: 3, started: 0 }];
    s.inv = { 'BLD-TIE': { on: 2 } };
    const { out, line } = lines();
    const old = [...STAFF.rework];
    STAFF.rework.fill(1);
    try {
      buildWeek(s, rng(1), s.week, line);
    } finally {
      STAFF.rework.splice(0, 5, ...old);
    }
    expect(s.builds[0]).toMatchObject({ done: 2, rework: 1 });
    expect(available(s, 'BLD-TIE')).toBe(1);
    expect(out[0].text).toMatch(/^The inspector failed .+’s work on|^The inspector failed .+'s work on/);
    buildWeek(s, rng(1), s.week + 1, line);
    expect(s.builds[0]).toMatchObject({ done: 3, finished: s.week + 1 });
    expect(s.builds.map((b) => b.id)).toEqual(['t2', 't3']);
    expect(out.at(-1)!.text).toBe('The site work on cottages 3 and 4 is done: they open with tier 2 in good shape.');
  });

  it('new buildings start at 60 + 30 × quality − 15 × (1 − the site work done); a tier that arrives early closes its build', () => {
    let s = started();
    s.builds = [{ id: 't2', what: BUILDS[0].what, tier: 2, done: 1.5, drawn: 2, need: 3, started: 0 }];
    s.staff = s.staff!.filter((n) => n.role !== 'builder');
    expect(builtShare(s, 2)).toBe(0.5);
    s.stats.weeksBPlus = 4;
    s = apply(s, { t: 'resolve', week: s.week }, s.deadline! + 1).s;
    const ids = s.project!.orders;
    for (const r of ROLES as Role[]) s = apply(s, { t: 'complete', role: r, orderId: ids[r]!, score: 0.9, perfect: false }, NOW).s;
    expect(s.tier).toBe(2);
    const base = 60 + 30 * 0.9;
    for (const id of ['h3', 'h4']) expect(s.assets.find((a) => a.id === id)!.health).toBe(Math.round(base - 7.5));
    expect(s.assets.find((a) => a.id === 'p2')!.health).toBe(Math.round(base));
    // the next week opens: the t2 build closes where it stood, t3 opens, and the analyst is told
    s = apply(s, { t: 'resolve', week: s.week }, s.deadline! + 1).s;
    expect(s.builds!.find((b) => b.id === 't2')).toMatchObject({ done: 1.5 });
    expect(s.builds!.find((b) => b.id === 't2')!.finished).toBeDefined();
    expect(openBuild(s)!.id).toBe('t3');
    expect(s.history.at(-1)!.lines.some((l) => /Tier 2 arrived with cottages 3 and 4's site work 1\.5 of 3 done: the new buildings started 8 lower\./.test(l.text))).toBe(true);
    // with the site work done it is exactly today's health
    expect(builtShare(started(), 5)).toBe(1);
  });

  it('a finished cottage joins the island: health 80, inspected for 8 weeks, and it rents like the others', () => {
    const s = atTier(3);
    s.builds!.push({ id: 'cottage-h8', what: 'Cottage 5', cottage: 'h8', done: 4, drawn: 5, need: 5, started: 0 });
    s.staff = crew(s, 3);
    const { line } = lines();
    const before = projectWeek(s).revenue;
    // the plan says it needs a housekeeper's turnover: the standard crew turns over the four houses it has
    const plan = cottagePlan(s);
    // (the queued Cottage 5 holds its plot: the next one would be Cottage 6)
    expect(plan).toMatchObject({ plot: { id: 'h9', name: 'Cottage 6' }, cost: COTTAGE_SHELL + 1090, housekeeper: true });
    expect(plan.rent).toBeGreaterThan(0);
    expect(plan.payback).toBe(Math.ceil(plan.cost / (plan.rent - STAFF.wage.housekeeper)));
    buildWeek(s, rng(1), s.week, line);
    const h8 = s.assets.find((a) => a.id === 'h8')!;
    expect(h8).toMatchObject({ kind: 'house', model: 'cottage', name: 'Cottage 5', health: 80, inspectionUntil: s.week + 8 });
    // it rents once someone turns it over
    expect(projectWeek(s).revenue).toBe(before);
    s.staff.push(npc('housekeeper'));
    expect(projectWeek(s).revenue).toBeGreaterThan(before);
    expect(cottagePlan(s)).toMatchObject({ plot: { id: 'h9' }, housekeeper: false });
  });
});

describe('the hiring board', () => {
  it('drawn at every week open: 3 candidates (4 from tier 3), needs first, deterministic, names unique', () => {
    const s = started();
    expect(s.hiring!.week).toBe(s.week);
    expect(s.hiring!.cands).toHaveLength(3);
    const again = started();
    expect(again.hiring).toEqual(s.hiring);
    const names = [...s.staff!.map((n) => n.name), ...s.hiring!.cands.map((c) => c.name)];
    expect(new Set(names).size).toBe(names.length);
    for (const c of s.hiring!.cands) {
      expect(c.ask).toBe(Math.round(c.ask / 10) * 10);
      expect(c.ask / (STAFF.wage[c.role] * STAFF.skillWage[c.skill - 1])).toBeGreaterThanOrEqual(0.93);
      expect(c.start).toBe(c.skill >= 4 ? s.week + 1 : s.week);
    }
    // tier 3: four; a tier short a pilot and a housekeeper gets both first, able to do the job
    const t = atTier(4);
    t.staff = [npc('pilot'), npc('housekeeper')];
    t.stats.tierReachedWeek[4] = 0;
    for (const x of ROLES) t.turns[x] = { ended: true, endedAt: NOW, done: 0 };
    expect(boardNeeds(t)).toEqual(['pilot', 'housekeeper']);
    const r = apply(t, { t: 'resolve', week: t.week }, t.deadline! + 1).s;
    expect(r.hiring!.cands).toHaveLength(4);
    expect(r.hiring!.cands.slice(0, 2).map((c) => c.role)).toEqual(['pilot', 'housekeeper']);
    expect(r.hiring!.cands[0].skill).toBeGreaterThanOrEqual(3);
    expect(r.hiring!.cands[1].skill).toBeGreaterThanOrEqual(2);
  });
});

describe('what a hire or a let-go does (the effect statements)', () => {
  it('every role’s net matches projectWeek with and without the person, less the wage', () => {
    const s = atTier(4);
    s.staff = [npc('pilot'), npc('housekeeper'), npc('builder')];
    s.builds!.find((b) => b.id === 't5')!.finished = undefined;
    s.builds!.find((b) => b.id === 't5')!.done = 1;
    s.tier = 4;
    for (const [role, skill] of [['pilot', 3], ['pilot', 1], ['pilot', 5], ['housekeeper', 2], ['housekeeper', 4], ['builder', 4]] as [NpcRole, Candidate['skill']][]) {
      const c = cand(s, role, skill);
      const e = staffEffect(s, c, 'hire');
      const withMe = projectWeek({ ...s, staff: [...s.staff!, { id: c.id, name: c.name, role, skill, wage: c.ask, hired: s.week, start: s.week }] }).revenue;
      const without = projectWeek(s).revenue;
      expect(e.net, `${role} ${skill}`).toBe(withMe - without - c.ask);
      // a hire that adds no revenue (the builder, with the Lodge's site work) says so instead of a net
      expect(e.money).toMatch(new RegExp(`^\\$${c.ask} a week · (net about [+−]\\$|no new income$)`));
    }
    // a second pilot wins back flights; a green one flies cargo only
    expect(staffEffect(s, cand(s, 'pilot', 3), 'hire').need).toMatch(/^\+\d+ flights a week \(~\$[\d,]+ of guests and tours/);
    expect(staffEffect(s, cand(s, 'pilot', 2), 'hire').does).toBe('flies 6 a week · cargo runs only');
    expect(staffEffect(s, cand(s, 'housekeeper', 3), 'hire').need).toMatch(/^\+\d+ houses booked \(~\$[\d,]+ a week\)/);
    expect(staffEffect(s, cand(s, 'builder', 3), 'hire').need).toMatch(/^the Lodge done wk (\d+) instead of wk (\d+)$/);
    expect(staffEffect(s, cand(s, 'builder', 3), 'hire').money).toMatch(/ · no new income$/);
    // a second builder who wouldn't bring the finish week forward says so
    const one = { ...s, builds: s.builds!.map((b) => (b.id === 't5' ? { ...b, done: 3.5 } : b)) };
    expect(staffEffect(one, cand(one, 'builder', 3), 'hire').need).toMatch(/^the Lodge done wk \d+ either way: no sooner with them$/);
    // a skill 4-5 builder gives notice: the site work counts them from next week
    const late = cand(s, 'builder', 5);
    const lodge = s.builds!.find((b) => b.id === 't5')!;
    expect(late.start).toBe(s.week + 1);
    const eta = (extra: Npc[]) => {
      let done = lodge.done;
      for (let w = s.week; ; w++) {
        done += [...s.staff!.filter((n) => n.role === 'builder'), ...extra].filter((n) => n.start <= w).reduce((t, n) => t + STAFF.output[n.skill - 1], 0);
        if (done >= lodge.need) return w;
      }
    };
    expect(staffEffect(s, late, 'hire').need).toBe(`the Lodge done wk ${eta([{ ...npc('builder', 5), start: s.week + 1 }])} instead of wk ${eta([])}`);
    // with tier 5's crew project under way the tier can come this week: the start health the hire buys says so
    const racing = { ...s, project: { tier: 5, title: 'Resort', orders: {} } } as IslandState;
    expect(staffEffect(racing, cand(racing, 'builder', 3), 'hire').need).toMatch(/ · if tier 5 comes this week, its new buildings start 4 higher$/);
    expect(staffEffect(racing, late, 'hire').need).not.toMatch(/comes this week/);
    // letting the only housekeeper go empties the houses
    const hk = s.staff!.find((n) => n.role === 'housekeeper')!;
    const go = staffEffect(s, hk, 'letGo');
    expect(go.need).toMatch(/houses would sit empty/);
    expect(go.net).toBe(hk.wage - (projectWeek(s).revenue - projectWeek({ ...s, staff: s.staff!.filter((n) => n.id !== hk.id) }).revenue));
    // a spare builder at tier 5 with no site work: saves the wage, pays back the severance
    const t5 = atTier(5);
    const b = npc('builder');
    t5.staff = [...t5.staff!, b];
    const e = staffEffect(t5, b, 'letGo');
    expect(e.net).toBe(b.wage);
    expect(e.payback).toBe(2);
    expect(e.money).toBe(`saves $${b.wage} a week after $${2 * b.wage} severance: pays back in 2 weeks`);
  });
});

describe('old islands and new islands', () => {
  it('a new island has the tier-1 crew at skill 3 and the first build open; an old one gets its tier’s crew and builds', () => {
    const s = started();
    expect(s.staff!.map((n) => n.role).sort()).toEqual(['builder', 'housekeeper', 'pilot']);
    expect(s.staff!.every((n) => n.skill === 3 && n.wage === STAFF.wage[n.role])).toBe(true);
    const old = { ...cloneState(started()), tier: 4 } as IslandState;
    delete old.staff;
    delete old.builds;
    delete old.hiring;
    // before the migration the hooks read the standard crew for the tier
    expect(payroll(old)).toBe(standardPayroll(4));
    expect(pilotCap(old)).toEqual({ guest: 12, total: 12 });
    const m = migrate(old);
    expect(m.staff!.length).toBe(5);
    expect(m.builds!.every((b) => b.finished !== undefined)).toBe(true);
    expect(m.hiring).toBeNull();
    expect(migrate(cloneState(m))).toEqual(m);
    // its first week open draws a board, and the doc round-trips through JSON
    const r = apply(m, { t: 'resolve', week: m.week }, (m.deadline ?? NOW) + 1).s;
    expect(r.hiring!.week).toBe(r.week);
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });
});

describe('bots', () => {
  it('the fin bot keeps the standard crew: it hires for a role below it, and lets the builder go at tier 5', () => {
    let s = atTier(2);
    s.staff = [npc('pilot'), npc('housekeeper'), npc('builder')];
    s.hiring = { week: s.week, cands: [] };
    const c = cand(s, 'pilot', 3, 320);
    cand(s, 'pilot', 5, 470);
    s = botStaff(s, TEAMS['three friends'].fin, rng(1), NOW);
    expect(s.staff!.some((n) => n.name === c.name)).toBe(true);
    expect(s.staff!.filter((n) => n.role === 'pilot')).toHaveLength(2);
    let t5 = atTier(5);
    t5.staff = [...t5.staff!, npc('builder')];
    t5 = botStaff(t5, TEAMS['three friends'].fin, rng(1), NOW);
    expect(t5.staff!.some((n) => n.role === 'builder')).toBe(false);
  });

  it('the builders’ materials: the next tier’s site work two units at a time; one two tiers ahead waits for the next tier’s crew project; further ahead waits', () => {
    const at = (tier: number, open: string, project?: number, cash = 19000) => {
      const s = atTier(tier);
      s.cash = cash;
      s.hiring = { week: s.week, cands: [] };
      const d = BUILDS.find((b) => b.id === open)!;
      s.builds = BUILDS.filter((b) => b.tier! < d.tier!).map((b) => ({ id: b.id, what: b.what, tier: b.tier, done: b.units.length, drawn: b.units.length, need: b.units.length, started: 0, finished: 0 }));
      s.builds.push({ id: d.id, what: d.what, tier: d.tier, done: 0, drawn: 0, need: d.units.length, started: s.week });
      if (!s.staff!.some((n) => n.role === 'builder')) s.staff!.push(npc('builder'));
      if (project) s.project = { tier: project, title: 'x', orders: {} } as IslandState['project'];
      for (const k of Object.keys(s.inv ?? {})) if (k.startsWith('BLD-')) delete s.inv![k]; // (the first site's lots came with the island)
      const pos = (s.pos ?? []).length;
      const after = botStaff(s, TEAMS['three friends'].fin, rng(1), NOW);
      return (after.pos ?? []).slice(pos).flatMap((p) => p.lines.map((l) => `${l.qty}×${l.item}`)).sort();
    };
    // the next tier's: two units (t3: its footings and flashing)
    expect(at(2, 't3')).toEqual(['1×BLD-FLASH', '1×BLD-FTG']);
    // two tiers ahead: nothing until the next tier's crew project, then all of it; or while the cash stays over the
    // next tier's gate (tier 3: $18,000) after the buy
    expect(at(2, 't4')).toEqual([]);
    expect(at(2, 't4', 3)).toHaveLength(5);
    expect(at(2, 't4', undefined, 30000)).toHaveLength(5);
    // three tiers ahead (the builders ran ahead): it waits, crew project or not
    expect(at(1, 't4', 2)).toEqual([]);
  });

  it('Home’s builders line offers the one-tap buy for the next tier’s site work, not for one that can wait', () => {
    const line = (tier: number, open: string, project?: number) => {
      const s = atTier(tier);
      const d = BUILDS.find((b) => b.id === open)!;
      s.builds = [{ id: d.id, what: d.what, tier: d.tier, done: 0, drawn: 0, need: d.units.length, started: s.week }];
      if (project) s.project = { tier: project, title: 'x', orders: {} } as IslandState['project'];
      for (const k of Object.keys(s.inv ?? {})) if (k.startsWith('BLD-')) delete s.inv![k];
      return buildLine(s)!;
    };
    expect(line(2, 't3').buy?.lines.length).toBeGreaterThan(0);
    expect(line(2, 't3').text).toMatch(/^Builders: 0 of 2 units on the generator house · next 1 × pier footings: not ordered$/);
    expect(line(2, 't4').buy).toBeUndefined();
    expect(line(2, 't4').text).toMatch(/\(for tier 4\) · next 1 × pier footings: not ordered\. Buy it on the desk when the cash allows\.$/);
    expect(line(2, 't4', 3).buy?.lines.length).toBeGreaterThan(0);
  });

  it('the naive analyst over-hires skill 4+ and cuts the dearest extra in a crunch', () => {
    let s = atTier(2);
    s.cash = 30000;
    s.hiring = { week: s.week, cands: [] };
    cand(s, 'pilot', 4);
    cand(s, 'housekeeper', 5);
    cand(s, 'builder', 2);
    s = botStaff(s, TEAMS['naive analyst'].fin, rng(1), NOW);
    expect(s.staff!.length).toBe(crew(s, 2).length + 2);
    s.cash = 1000;
    const n = s.staff!.length;
    s = botStaff(s, TEAMS['naive analyst'].fin, rng(1), NOW);
    expect(s.staff!.length).toBe(n - 1);
  });

  it('a season: the three friends keep payroll near the standard crew’s, and no solo player leaves tier 1', () => {
    const { final } = simulate(TEAMS['three friends'], 26, 2);
    expect(payroll(final) / standardPayroll(final.tier)).toBeGreaterThan(0.85);
    expect(payroll(final) / standardPayroll(final.tier)).toBeLessThan(1.15);
    for (const team of ['solo fin', 'fin absent']) expect(simulate(TEAMS[team], 26, 3).final.tier, team).toBe(1);
  });

  it('with hard landings on, the three friends reach tier 5 within a week of the stubs (mean, seeds 1-20)', () => {
    const mean = (stub: boolean) => {
      STAFF_TEST.stubs = stub;
      const w = Array.from({ length: 20 }, (_, i) => simulate(TEAMS['three friends'], 26, i + 1).final.stats.tierReachedWeek[5] ?? 27);
      STAFF_TEST.stubs = false;
      return w.reduce((a, b) => a + b, 0) / w.length;
    };
    const d = mean(false);
    expect(Math.abs(d - mean(true))).toBeLessThanOrEqual(1);
  });
});

// keep the imports honest (asset type used by helpers)
void ({} as Asset);
