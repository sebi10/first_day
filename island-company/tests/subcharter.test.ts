// The only guest plane past due (docs/DECISIONS.md 2026-09-28): it's grounded
// like any plane (AOG until the fix; flying past the item's due week or its MEL
// interval isn't legal), and a mainland sub-charter flies the island's guests
// in, so the houses stay booked. The island pays the operator per flight
// (SUB_FEE, over its own cost of a flight), only for the guests who need a seat:
// the review says so, the ledger books it, the cards and the MEL words say it
// before it happens. Nobody has to act for it.
//
// tests/fixtures/v3-bd1e1d2-restricted-*.json are docs the live build (engine 3,
// bd1e1d2: the job flow) wrote mid-week with the twin flying restricted (the old
// rule): the mechanic hasn't played, the electrician and the analyst have ended
// their turns. They have to load, finish the week and play on here.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { raiseAlert, soleGuest, SYMPTOMS } from '../src/sim/alerts';
import { botTurn, simulate, TEAMS } from '../src/sim/bots';
import { SUBCHARTER } from '../src/sim/data';
import { alertAog, capOf, downtimeOf, isAog, projectWeek, SUB_FEE, subCharterNeed, subCharterOn } from '../src/sim/econ';
import { apply, createIsland, ENGINE_VERSION } from '../src/sim/engine';
import { cardOf, fixTaskFor, stdPickFor } from '../src/sim/flow';
import { spendSeries } from '../src/sim/ledger';
import { hashSeed, rng } from '../src/sim/rng';
import { addStarter } from '../src/sim/stock';
import { ROLES, type Action, type Alert, type Asset, type IslandState } from '../src/sim/types';
import { costLines } from '../src/ui/board';
import { cardVM, carrierDown, needsVM } from '../src/ui/purchasing/model';
import { allItems } from '../src/sim/items';
import { blocks, crossMoves, endTurnChecks, launchFor, openOrders, teamNumbers, yourMoves } from '../src/ui/select';
import { flagsOf } from '../src/ui/flow/words';

// whole-season runs: CI runners are about 1.5x slower
vi.setConfig({ testTimeout: 30000 });

const NOW = Date.UTC(2026, 8, 26, 10);
const CARGO: Asset = { id: 'p2', kind: 'plane', model: 'cargo', name: 'Cargo C-7', health: 80, touchedWeek: 5, sinceInspection: 0 };

/** a started island in week 5 at `tier` (tier 2: the cargo plane and cottages 3 and 4 too), the starter shelf, no work open */
function island(tier = 1, seed = 42): IslandState {
  let s = createIsland({ id: `sc${seed}`, name: 'Charter Isle', now: NOW, tz: 'Europe/Paris', seed, creator: { uid: 'a', name: 'Ana', role: 'mech' } });
  s = apply(s, { t: 'join', uid: 'b', name: 'Ben', role: 'elec' }, NOW).s;
  s = apply(s, { t: 'join', uid: 'c', name: 'Cy', role: 'fin' }, NOW).s;
  for (const r of ROLES) s = apply(s, { t: 'week0Done', role: r }, NOW).s;
  s.week = 5;
  s.tier = tier;
  s.cash = 20000;
  s.weather = 'clear';
  s.modifiers = [];
  for (const a of s.assets) {
    a.health = 90;
    if (a.kind === 'house') a.inspectionUntil = 30;
  }
  if (tier >= 2) {
    s.assets.push({ ...CARGO });
    for (const [id, name] of [['h3', 'Cottage 3'], ['h4', 'Cottage 4']]) s.assets.push({ id, kind: 'house', model: 'cottage', name, health: 90, touchedWeek: 5, inspectionUntil: 30 });
  }
  addStarter(s, tier);
  s.orders = [];
  s.alerts = [];
  return s;
}

let clock = NOW;
function ok(s: IslandState, a: Action): IslandState {
  const r = apply(s, a, ++clock);
  expect(r.error, JSON.stringify(a)).toBeUndefined();
  return r.s;
}
const raise = (s: IslandState, sym: string, cause: number, assetId: string, due?: number): Alert =>
  raiseAlert(s, { role: SYMPTOMS[sym].role, asset: s.assets.find((a) => a.id === assetId)!, sym, cause, ...(due !== undefined ? { due } : {}) }, clock);
/** everyone ends the turn: the week resolves */
function endWeek(s: IslandState): IslandState {
  for (const r of ROLES) if (!s.turns[r]?.ended) s = ok(s, { t: 'endTurn', role: r, week: s.week });
  return s;
}
/** keep only these alerts (the week open raises new ones; a test watches its own) */
const only = (s: IslandState, ...ids: string[]) => {
  s.alerts = s.alerts!.filter((a) => ids.includes(a.id));
  return s;
};
const report = (s: IslandState, week: number) => s.history.find((h) => h.week === week)!;
const says = (s: IslandState, week: number, re: RegExp) => report(s, week).lines.some((l) => re.test(l.text));
const SUB_LINE = /^Twin N-12 stayed on the ground: a mainland sub-charter flew the guests in \((\d) flights? at \$([\d,]+), \$([\d,]+)\)\.$/;

describe('the only guest plane past due: grounded, a mainland sub-charter flies the guests', () => {
  it('the fee: the island’s own cost of a flight times the operator’s premium', () => {
    expect(SUB_FEE).toBe(Math.round((SUBCHARTER.ownPerFlight * SUBCHARTER.mult) / 10) * 10);
    // a premium over the island's own flying, within a Part 135 charter's band over an owner's cost
    expect(SUBCHARTER.mult).toBeGreaterThanOrEqual(1.3);
    expect(SUBCHARTER.mult).toBeLessThanOrEqual(1.8);
  });

  it('tier 1: the twin is AOG, no flight and no near-miss on it; the sub-charter books both cottages; the cost lands in the review and the ledger', () => {
    let s = island(1);
    const al = raise(s, 'M_BRAKE_SOFT', 1, 'p1', 5);
    expect(soleGuest(s, 'p1')).toBe(true);
    expect(alertAog(s, 'p1')?.id).toBe(al.id);
    expect(isAog(s, 'p1')).toBe(true);
    expect(capOf(s, s.assets.find((a) => a.id === 'p1')!)).toBe(0);
    expect(subCharterOn(s)).toMatchObject({ plane: { id: 'p1' }, alert: { id: al.id }, flights: 2, cap: 4, fee: SUB_FEE, usd: 2 * SUB_FEE });
    // the analyst's forecast sees it: both houses booked, no day tours, the fee as a cost
    const proj = projectWeek(s);
    expect(proj).toMatchObject({ booked: 2, subFlights: 2, subCharter: 2 * SUB_FEE, charter: 0 });
    s = only(endWeek(s), al.id);
    const h = report(s, 5);
    expect(h.flightsFlown).toBe(0);
    // the twin's schedule stays on the books: the island flew none of its 4 (the sub-charter's aren't the island's)
    expect(h.flightsScheduled).toBe(4);
    expect(h.components.flights).toBe('D');
    expect(h.housesBooked).toBe(2);
    expect(h.nearMisses).toBe(0);
    expect(says(s, 5, /^Twin N-12 AOG: .+ \(due week 5, not fixed\): 4 flights cancelled\.$/)).toBe(true);
    const m = report(s, 5).lines.map((l) => SUB_LINE.exec(l.text)).find((x) => !!x)!;
    expect(m.slice(1).map((x) => Number(x.replace(/,/g, '')))).toEqual([2, SUB_FEE, 2 * SUB_FEE]);
    expect(says(s, 5, / flew \d of \d with |near-miss|restricted/)).toBe(false);
    expect(h.mvp.mech).toMatch(/^0\/4 flights \(\+2 sub-charter\)/);
    // the cost: the review's line, the ledger's category and trade, the money tab's series
    expect(h.costs.subCharter).toBe(2 * SUB_FEE);
    expect(costLines(h)).toContainEqual(['Mainland sub-charter', 2 * SUB_FEE]);
    const row = s.ledger!.find((r) => r.w === 5)!;
    expect(row.sp.subcharter).toBe(2 * SUB_FEE);
    expect(row.tr.mech).toBeGreaterThanOrEqual(2 * SUB_FEE);
    expect(spendSeries(s).find((x) => x.w === 5)!.out.subcharter).toBe(2 * SUB_FEE);
  });

  it('the fee is cash out: the same week with the twin fixed ends richer by the fee, less the day tours it flies', () => {
    const base = island(1);
    const al = raise(base, 'M_TIRE_PRESSURE', 0, 'p1', 5);
    const down = only(endWeek(structuredClone(base)), al.id);
    const up = structuredClone(base);
    up.alerts = [];
    const flying = only(endWeek(up));
    const d = report(down, 5);
    const f = report(flying, 5);
    // the same bookings (the sub-charter fills both cottages), the tours lost, the fee paid
    expect(d.housesBooked).toBe(f.housesBooked);
    expect(f.revenue - d.revenue).toBeGreaterThan(0);
    expect(f.cashEnd - d.cashEnd).toBe(f.revenue - d.revenue + 2 * SUB_FEE);
  });

  it('its flights carry the POs a guest flight would: a box due tonight lands, and the desk says so first', () => {
    let s = island(1);
    const al = raise(s, 'M_TIRE_PRESSURE', 0, 'p1', 5);
    const item = allItems().find((x) => x.trade === 'mech' && x.kind === 'consumable')!;
    s.pos = [...(s.pos ?? []), { id: 'po900', week: 5, vendor: 'oem', freight: 'sched', eta: 5, cost: 40, freightCost: 0, by: 'fin', status: 'open', carrier: 'any', lines: [{ item: item.id, qty: 1, unit: 40 }] } as never];
    expect(carrierDown(s, { carrier: 'any', freight: 'sched', eta: 5 })).toBeNull();
    s = only(endWeek(s), al.id);
    expect(s.pos!.find((p) => p.id === 'po900')!.status).not.toBe('open');
    expect(says(s, 5, /po900.*waits a week|Nothing flew this week/)).toBe(false);
  });

  it('the week after the fix it flies its own guests again: no sub-charter, no fee', () => {
    let s = island(1);
    const al = raise(s, 'M_TIRE_PRESSURE', 0, 'p1', 5);
    s = only(endWeek(s), al.id);
    expect(report(s, 5).costs.subCharter).toBe(2 * SUB_FEE);
    // week 6: the fix from the shelf, signed off before the resolve
    const task = fixTaskFor(s, al)!;
    s = ok(s, { t: 'plan', role: 'mech', alert: al.id, task: task.id, pick: stdPickFor(s, al, task), week: 6 });
    let o = s.orders.find((x) => x.flow?.alert === al.id && x.status !== 'cancelled')!;
    if (o.status === 'pending') s = ok(s, { t: 'approve', orderId: o.id, week: 6 });
    o = s.orders.find((x) => x.id === o.id)!;
    expect(o.status).toBe('ready');
    s = ok(s, { t: 'complete', role: 'mech', orderId: o.id, score: 0.95, perfect: false, week: 6 });
    expect(alertAog(s, 'p1')).toBeUndefined();
    expect(subCharterOn(s)).toBeNull();
    s = only(endWeek(s));
    const h = report(s, 6);
    expect(h.flightsFlown).toBe(4);
    expect(h.costs.subCharter).toBeUndefined();
    expect(says(s, 6, /sub-charter/)).toBe(false);
  });

  it('tier 2: the cargo plane keeps flying, the sub-charter flies all four cottages’ guests (no empty house for the twin)', () => {
    let s = island(2);
    const al = raise(s, 'M_OIL_LEAK', 0, 'p1', 5);
    expect(subCharterOn(s)).toMatchObject({ flights: 4, usd: 4 * SUB_FEE });
    s = only(endWeek(s), al.id);
    const h = report(s, 5);
    expect(h.housesBooked).toBe(4);
    expect(h.flightsFlown).toBe(4); // the cargo plane's
    expect(h.flightsScheduled).toBe(8); // its 4 and the twin's 4
    expect(h.costs.subCharter).toBe(4 * SUB_FEE);
    expect(says(s, 5, /houses? empty/)).toBe(false);
  });

  it('tier 3: the ferry brings two parties, the sub-charter the rest; a storm halves what it can fly', () => {
    let s = island(2);
    s.tier = 3;
    raise(s, 'M_OIL_LEAK', 0, 'p1', 5);
    expect(subCharterOn(s)).toMatchObject({ flights: 2, cap: 4 });
    s.weather = 'storm';
    // 4 cottages, 2 on the ferry: the storm leaves the operator 2 flights, still enough
    expect(subCharterOn(s)).toMatchObject({ flights: 2, cap: 2 });
    s.tier = 2;
    expect(subCharterOn(s)).toMatchObject({ flights: 2, cap: 2 });
  });

  it('never more flights than the housekeepers can turn over, and none with no house to rent', () => {
    let s = island(2);
    raise(s, 'M_OIL_LEAK', 0, 'p1', 5);
    s.staff = (s.staff ?? []).filter((n) => n.role !== 'housekeeper');
    s.staff.push({ id: 'hk1', name: 'Kay', role: 'housekeeper', skill: 1, wage: 130, hired: 1, start: 1 });
    // a skill-1 housekeeper turns over 2 a week
    expect(subCharterOn(s)?.flights).toBe(2);
    s = only(endWeek(s), s.alerts![0].id);
    expect(report(s, 5).housesBooked).toBe(2);
    expect(says(s, 5, /^2 houses empty: housekeeping turns over 2 a week\./)).toBe(true);
    expect(says(s, 5, /guest flights/)).toBe(false);
    // the grid down and the generator gone: no house can rent, so nothing to fly
    let t = island(1);
    raise(t, 'M_OIL_LEAK', 0, 'p1', 5);
    t.assets.find((a) => a.kind === 'grid')!.health = 20;
    expect(subCharterOn(t)).toMatchObject({ flights: 0, usd: 0 });
    t = only(endWeek(t), t.alerts![0].id);
    expect(report(t, 5).costs.subCharter).toBeUndefined();
    expect(says(t, 5, /sub-charter flew/)).toBe(false);
  });

  it('tier 4: the float shares the guests, so the twin is grounded with no sub-charter (as any plane)', () => {
    let s = island(2);
    s.tier = 4;
    s.assets.push({ id: 'p3', kind: 'plane', model: 'float', name: 'Float F-3', health: 90, touchedWeek: 5, sinceInspection: 0 });
    const al = raise(s, 'M_OIL_LEAK', 0, 'p1', 5);
    expect(soleGuest(s, 'p1')).toBe(false);
    expect(alertAog(s, 'p1')?.id).toBe(al.id);
    expect(subCharterOn(s)).toBeNull();
    expect(subCharterNeed(s, 'p1')).toBeNull();
    s = only(endWeek(s), al.id);
    expect(report(s, 5).costs.subCharter).toBeUndefined();
  });

  it('the safety call grounds it too: the sub-charter flies the guests that week', () => {
    let s = island(1);
    s = ok(s, { t: 'tag', role: 'mech', assetId: 'p1', on: true });
    expect(subCharterOn(s)).toMatchObject({ flights: 2 });
    expect(subCharterOn(s)!.alert).toBeUndefined();
    // a future week's doesn't count this week's call
    expect(subCharterOn(s, 6)).toBeNull();
    s = only(endWeek(s));
    expect(report(s, 5)).toMatchObject({ flightsFlown: 0, housesBooked: 2, costs: { subCharter: 2 * SUB_FEE } });
  });

  it('an MEL C placard: it flies to the placard’s last week, the review says what comes after, then it’s grounded and sub-chartered', () => {
    let s = island(1);
    const com = raise(s, 'M_COM_DEAD', 0, 'p1');
    s = ok(s, { t: 'mel', role: 'mech', alert: com.id, week: 5 });
    expect(alertAog(s, 'p1')).toBeUndefined();
    expect(subCharterOn(s)).toBeNull();
    s = only(endWeek(s), com.id);
    expect(says(s, 5, new RegExp(`^Twin N-12 flew with .+ placarded INOP \\(MEL C, to week 5\\)\\. Fix it by then, or it is grounded: a mainland sub-charter flies the guests at about \\$${(2 * SUB_FEE).toLocaleString('en-US')} a week \\(2 flights at \\$${SUB_FEE}\\)\\.$`))).toBe(true);
    expect(report(s, 5).costs.subCharter).toBeUndefined();
    s = only(endWeek(s), com.id);
    expect(says(s, 6, /^Twin N-12's MEL C for .+ ran out in week 5: grounded until it's fixed \(4 flights cancelled\)\.$/)).toBe(true);
    expect(report(s, 6)).toMatchObject({ housesBooked: 2, nearMisses: 0, costs: { subCharter: 2 * SUB_FEE } });
  });

  it('the cards say it before it happens: the analyst’s card, the needs list, the flags, the mechanic’s moves', () => {
    let s = island(1);
    const al = raise(s, 'M_TIRE_PRESSURE', 0, 'p1', 7);
    // week 5: two weeks before it's due, nothing grounds it yet
    expect(alertAog(s, 'p1')).toBeUndefined();
    const needs = needsVM(s).unplanned.find((n) => n.alert === al.id)!;
    expect(needs.sub).toBe(`from wk 7: the guests go on a mainland sub-charter, about $${(2 * SUB_FEE).toLocaleString('en-US')} a week`);
    // a plan with a part to buy: a card for the analyst, "From wk 7: sub-charter ~$540/wk"
    const task = fixTaskFor(s, al)!;
    const pick = stdPickFor(s, al, task);
    for (const l of pick) delete s.inv![l.item];
    s = ok(s, { t: 'plan', role: 'mech', alert: al.id, task: task.id, pick, week: 5 });
    const o = s.orders.find((x) => x.flow?.alert === al.id && x.status !== 'cancelled')!;
    expect(o.status).toBe('pending');
    const card = cardOf(s, o);
    expect(card.aog).toBe(false);
    expect(card.sub).toEqual({ flights: 2, fee: SUB_FEE, usd: 2 * SUB_FEE });
    expect(cardVM(s, o).chips.map((c) => c.text)).toContain(`From wk 7: sub-charter ~$${(2 * SUB_FEE).toLocaleString('en-US')}/wk`);
    // due now: AOG and on the sub-charter, and waiting a week counts the fee and the lost tours
    s.week = 7;
    const due = cardOf(s, o);
    expect(due.aog).toBe(true);
    expect(due.downtime!.usd).toBeGreaterThanOrEqual(2 * SUB_FEE);
    expect(downtimeOf(s, 'p1').usd).toBe(due.downtime!.usd);
    const chips = cardVM(s, o).chips.map((c) => c.text);
    expect(chips).toContain('AOG');
    expect(chips).toContain(`Sub-charter ~$${(2 * SUB_FEE).toLocaleString('en-US')}/wk`);
    expect(flagsOf(s, s.alerts!.find((a) => a.id === al.id)!).map((f) => f.text)).toEqual(expect.arrayContaining(['AOG', 'sub-charter']));
    // the mechanic's End turn says what past due does (no "restricted")
    const moves = endTurnChecks(s, 'mech').map((m) => m.text);
    expect(moves.some((m) => /Twin N-12 is grounded and a mainland sub-charter flies the guests \(about \$[\d,]+ a week\)/.test(m))).toBe(true);
    expect(moves.some((m) => /restricted/.test(m))).toBe(false);
  });
});

describe('the pillar: grounding the only guest plane never empties every house', () => {
  it('an absent mechanic’s island: every week the twin sits grounded, the sub-charter books the rentable houses, and cash holds', () => {
    let weeks = 0;
    for (const seed of [0, 1, 2]) {
      const trace = (s: IslandState) => {
        const h = s.history[s.history.length - 1];
        if (!h.lines.some((l) => SUB_LINE.test(l.text))) return;
        weeks++;
        expect(h.housesBooked).toBeGreaterThan(0);
        expect(h.lines.some((l) => / flew \d of \d with /.test(l.text))).toBe(false);
      };
      const r = simulate(TEAMS['mech absent'], 26, seed, trace);
      expect(r.final.tier).toBe(1);
      expect(r.weeks.filter((w) => w.cash < 0).length).toBeLessThanOrEqual(2);
    }
    // it happens a lot with nobody fixing the twin (the case the old rule flew restricted for weeks)
    expect(weeks).toBeGreaterThan(20);
  });
});

describe('island docs written by the live build (bd1e1d2) with the twin flying restricted', () => {
  const load = (name: string): IslandState => JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures', `${name}.json`), 'utf8'));
  /** every selector a screen runs on the island */
  function selectors(s: IslandState) {
    blocks(s);
    crossMoves(s);
    teamNumbers(s);
    projectWeek(s);
    for (const role of ROLES) {
      endTurnChecks(s, role);
      if (role !== 'fin') yourMoves(s, role);
      for (const o of openOrders(s, role)) {
        if (o.status === 'ready') launchFor(s, o, role);
        if (o.flow && o.status === 'pending') cardVM(s, o);
      }
    }
    needsVM(s);
    for (const a of s.alerts ?? []) flagsOf(s, a);
  }
  /** the seats still playing finish the week on this build (the paper-sim crew), then the resolve */
  function week(s: IslandState, salt: string, json: boolean) {
    const team = TEAMS['three friends'];
    const now = s.deadline ?? s.updatedAt;
    const W = s.week;
    let x = s;
    for (const role of ROLES) {
      if (x.turns[role]?.ended) continue;
      x = botTurn(x, role, team[role], rng(hashSeed('live', salt, role, W)), now - 3600_000);
      if (json) x = JSON.parse(JSON.stringify(x));
      x = apply(x, { t: 'endTurn', role, week: W }, now - 3600_000).s;
      if (json) x = JSON.parse(JSON.stringify(x));
    }
    if (x.week === W) x = apply(x, { t: 'resolve', week: W }, now + 1000).s;
    expect(x.week).toBe(W + 1);
    return x;
  }
  for (const name of ['v3-bd1e1d2-restricted-t1', 'v3-bd1e1d2-restricted-t2', 'v3-bd1e1d2-restricted-mel']) {
    it(`${name}: loads mid-week, the twin is grounded with its guests on the sub-charter, and it plays six more weeks the same in memory and through JSON`, () => {
      const doc = load(name);
      expect(doc.engine).toBe(3);
      expect(doc.turns.mech?.ended).toBeFalsy();
      const p = doc.assets.find((a) => a.kind === 'plane' && soleGuest(doc, a.id))!;
      // it was flying restricted: here it's AOG on the same alert, and the sub-charter is on
      const al = alertAog(doc, p.id)!;
      expect(al).toBeTruthy();
      expect(subCharterOn(doc)?.plane.id).toBe(p.id);
      selectors(doc);
      // the mechanic plays (the bot crew) and the week resolves on this build
      let a = week(structuredClone(doc), name, false);
      let b = week(JSON.parse(JSON.stringify(doc)) as IslandState, name, true);
      const h = a.history[a.history.length - 1];
      expect(h.week).toBe(doc.week);
      expect(h.lines.some((l) => / flew \d of \d with /.test(l.text))).toBe(false);
      // the mechanic may have fixed it this week; if not, the twin stayed on the ground and the sub-charter flew
      if (h.lines.some((l) => l.text.startsWith(`${p.name} AOG:`) || l.text.startsWith(`${p.name}'s MEL C`))) expect(h.lines.some((l) => SUB_LINE.test(l.text)) || h.housesRentable === 0).toBe(true);
      expect(Number.isFinite(a.cash)).toBe(true);
      for (let w = 0; w < 6; w++) {
        a = week(a, name, false);
        b = week(b, name, true);
        selectors(a);
        expect(Number.isFinite(a.cash)).toBe(true);
        expect(a.engine).toBe(ENGINE_VERSION);
      }
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    });
  }

  it('the tier-1 doc: finished with the mechanic away, the resolve grounds the twin and the sub-charter flies both cottages', () => {
    const doc = load('v3-bd1e1d2-restricted-t1');
    let s = structuredClone(doc);
    const W = s.week;
    const rentable = projectWeek(s).rentable;
    expect(subCharterOn(s)).toMatchObject({ flights: Math.min(rentable, 2) });
    s = apply(s, { t: 'resolve', week: W }, (s.deadline ?? s.updatedAt) + 1000).s;
    const h = s.history[s.history.length - 1];
    expect(h.week).toBe(W);
    expect(h.flightsFlown).toBe(0);
    expect(h.housesBooked).toBe(Math.min(rentable, 2));
    expect(h.costs.subCharter).toBe(Math.min(rentable, 2) * SUB_FEE);
    expect(h.lines.some((l) => SUB_LINE.test(l.text))).toBe(true);
    // the autopilot covered the mechanic: a known-defect near-miss can still happen, but none from flying the twin
    expect(h.lines.some((l) => /Near-miss on Twin N-12|flew \d of \d/.test(l.text))).toBe(false);
  });
});

