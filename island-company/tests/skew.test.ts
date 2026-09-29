// Live islands and version skew.
//
// tests/fixtures/live-79f806b-*.json are island docs written by the live build
// (79f806b, before the part chain and the carts): a start-of-week doc at tier 1,
// one at tier 3, and a mid-week one (the mechanic has played and ended the turn,
// the electrician is part way, the analyst hasn't started). This build has to
// load them and play on.
//
// tests/fixtures/skew-79f806b-*.json replay the skew: a doc this build wrote with
// an open part chain, then moved on by the live engine (a tab or a phone app
// opened before the deploy). Its resolve cancels the chain's step orders and makes
// the stopped job ready; its approval of the part card makes the order ready with
// the chain still at the buy. Either way, the next move on this build heals it.
// The doc version (src/net/firebase.ts, firestore.rules) keeps old tabs from
// writing at all; the engine version keeps this build from writing over a newer one.
//
// tests/fixtures/v3-bd1e1d2-*.json are docs the live job-flow build wrote
// (bd1e1d2: ENGINE_VERSION 3, DOC_VERSION 3), with its own bots
// (scripts/fixtures-v3.ts, run in a worktree of bd1e1d2; the first doc that
// matched each state):
//
//   v3-bd1e1d2-early     three friends, seed 1, week 4   tier 1, start of the week, alerts open, the starter crew
//   v3-bd1e1d2-late      three friends, seed 1, week 20  tier 4, start of the week, 6 staff, 74 stock lines, 21 POs
//   v3-bd1e1d2-midweek   mistakes,      seed 1, week 5   tier 1, the mechanic ended, the electrician part way, the
//                                                        analyst not started: an open requisition, a card waiting
//   v3-bd1e1d2-mel       three friends, seed 2, week 3   tier 1, the only guest plane on an MEL placard that runs
//                                                        out at this week's resolve
//   v3-bd1e1d2-chain     mistakes,      seed 2, week 20  tier 4, mid-week, an open part chain (at the fee), saved
//                                                        10 minutes past its deadline (the next open resolves it)
//   v3-bd1e1d2-makesafe  three friends, seed 1, week 7   tier 2, mid-week, a shower tingle made safe at the breaker
//   v3-bd1e1d2-build     three friends, seed 1, week 6   tier 2, the builders half way through the generator house
//   v3-bd1e1d2-feeder    three friends, seed 1, week 1   tier 1, mid-week, the feeder job's card waiting on approval
//
// This build (engine 4, doc v4: the only guest plane grounded past due, the
// mainland sub-charter, the feeder scene, the builders' zoom) has to load,
// render and resolve every one of them. The v3-bd1e1d2-restricted-* docs (the
// twin flying restricted) are in tests/subcharter.test.ts.
//
// tests/fixtures/v4-e810cc5-*.json are docs the live stage 1 build wrote (e810cc5: ENGINE_VERSION 4, DOC_VERSION 4),
// with its own engine and bots (scripts/fixtures-v4.ts, run in a worktree of e810cc5; the first doc that matched each
// state). This build (stage 2: engine 5, doc v5) has to load, render and resolve every one of them: the last section.
//
//   v4-e810cc5-early         three friends, seed 1, week 4    tier 1, start of the week, alerts open, the starter crew
//   v4-e810cc5-midweek       mistakes,      seed 1, week 5    tier 1, the mechanic ended, the analyst not started: an
//                                                             open requisition, two of the electrician's cards waiting
//   v4-e810cc5-chain         mistakes,      seed 1, week 28   tier 3, mid-week, an open part chain (at the fee)
//   v4-e810cc5-feeder        three friends, seed 1, week 2    tier 1, the electrician ended, the feeder job approved
//                                                             and waiting on its part
//   v4-e810cc5-subcharter    three friends, seed 1, week 2    tier 1, the only guest plane grounded past due (the gear
//                                                             write-up): the mainland sub-charter flies its guests
//   v4-e810cc5-rcv           three friends, seed 2, week 37   tier 4, in receivership (3 weeks) with the receiver's
//                                                             bridge loan ($36,110 left at $3,611 a week)
//   v4-e810cc5-t4-carry      v3 t4-streak-high on e810cc5, week 18: tier 4, the carried streak (aCarry 8) held
//   v4-e810cc5-t5-carry      v3 credits-next-t5 on e810cc5 (all average), week 26: tier 5, aStreak 7 carried (an
//                            autopilot A paused it), one full-crew A from the credits
//   v4-e810cc5-t5-carry-mid  the same mid-week (the mechanic ended)
//   v4-e810cc5-credits       v3 credits-next-t5 on e810cc5 (all good), week 26: the credits rolled in week 25 on the
//                            carried streak (creditsWeek 25, aCarry 7)
//   v4-e810cc5-t2, -t4, -t4-mid, -t5, -t5-late: G0's (tests/g0.test.ts has what they are)
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { trace } from '../src/puzzles/trace';
import { soleGuest } from '../src/sim/alerts';
import { botTurn, TEAMS } from '../src/sim/bots';
import { islandAircraft, openChain } from '../src/sim/chain';
import { alertAog, aStreakAfter, creditsStreak, downtimeOf, melOn, projectWeek, rentFactor, SUB_FEE, subCharterOn } from '../src/sim/econ';
import { ENGINE_VERSION, apply, healOpenChain } from '../src/sim/engine';
import { cardOf, flowStage } from '../src/sim/flow';
import { migrate } from '../src/sim/migrate';
import { expectLiveMigration } from './livedocs';
import { rng, hashSeed } from '../src/sim/rng';
import { stockFlags } from '../src/sim/stock';
import { ROLES, type IslandState, type Order } from '../src/sim/types';
import { costLines } from '../src/ui/board';
import { flagsOf } from '../src/ui/flow/words';
import { siteBox, H, W } from '../src/ui/island/geo';
import { cardVM, needsVM } from '../src/ui/purchasing/model';
import { blocks, crossMoves, dockNext, endTurnChecks, flowMoves, launchFor, openOrders, pushes, teamNumbers, yourMoves } from '../src/ui/select';
import { buildLine, buildRows, doingNow } from '../src/ui/staff/model';
import { canCheck, checkView } from '../src/sim/checks';
import { assetRef, FIXTURE_KINDS, HOME } from '../src/ui/objects';
import { assetPnl, fixtureFacts, flaggable, inspectLabel, openAlertsOn } from '../src/ui/select';
import { receiverLeft } from '../src/sim/engine';
import { committed, spendable } from '../src/sim/ledger';
import { families, moveClass, velocity } from '../src/sim/stock';
import { G0_ENGINE } from '../src/sim/migrate';
import { harborLines } from '../src/ui/harbor';
import { facts, factsText } from '../src/ui/inspect/facts';
import { whatsNewMapPanels } from '../src/ui/inspect/WhatsNewMap';
import { hotspots, refKey } from '../src/ui/map/hotspots';
import { LAYOUTS } from '../src/ui/map/layouts';
import { deskCounts, deskTaskLine, flowQueue, legacyQueue, openingTab, reqQueue } from '../src/ui/purchasing/model';
import { whatsNewUpkeepPanels } from '../src/ui/staff/WhatsNewUpkeep';

// ten-week runs on each fixture: CI runners are about 1.5x slower
vi.setConfig({ testTimeout: 30000 });

const load = (name: string): IslandState => JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures', `${name}.json`), 'utf8'));
const LIVE = ['live-79f806b-early', 'live-79f806b-late', 'live-79f806b-midweek'];

/** every selector a screen runs on the island */
function selectors(s: IslandState) {
  blocks(s);
  crossMoves(s);
  teamNumbers(s);
  for (const role of ROLES) for (const o of openOrders(s, role)) if (o.status === 'ready') launchFor(s, o, role);
  for (const a of s.assets) if (a.kind === 'plane') expect(islandAircraft(s.seed, a).registration).toMatch(/^N\d/);
}

/** a week of the paper-sim crew on this build, then the resolve */
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

describe('island docs written by the live build (79f806b)', () => {
  for (const name of LIVE) {
    it(`${name}: loads, runs every selector, and plays ten more weeks the same way in memory and through JSON`, () => {
      const doc = load(name);
      expect(doc.chain).toBeUndefined();
      expect(doc.gse).toBeUndefined();
      expect(doc.engine).toBeUndefined();
      selectors(doc);
      let a = doc;
      let b = JSON.parse(JSON.stringify(doc)) as IslandState;
      for (let w = 0; w < 10; w++) {
        a = week(a, name, false);
        b = week(b, name, true);
        selectors(a);
        expect(Number.isFinite(a.cash)).toBe(true);
        expect(a.engine).toBe(ENGINE_VERSION);
      }
      // the round trip through the doc changes nothing
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
      // the new systems came up on the old island: the carts, and the planes' own records
      expect(a.gse?.length).toBeGreaterThan(0);
    });
  }

  it('the mid-week doc: the seats that are still playing finish their turns on this build', () => {
    let s = load('live-79f806b-midweek');
    expect(s.turns.mech?.ended).toBe(true);
    const W = s.week;
    const now = s.updatedAt + 60_000;
    const elec = s.orders.find((o) => o.role === 'elec' && o.status === 'ready')!;
    let r = apply(s, { t: 'complete', role: 'elec', orderId: elec.id, score: 0.9, perfect: false, week: W }, now);
    expect(r.error).toBeUndefined();
    s = r.s;
    const fin = s.orders.find((o) => o.role === 'fin' && o.status === 'ready')!;
    r = apply(s, { t: 'complete', role: 'fin', orderId: fin.id, score: 0.8, perfect: false, week: W }, now);
    expect(r.error).toBeUndefined();
    s = r.s;
    for (const role of ['elec', 'fin'] as const) s = apply(s, { t: 'endTurn', role, week: W }, now).s;
    expect(s.week).toBe(W + 1);
    expect(s.history.at(-1)!.week).toBe(W);
  });
});

describe('version skew: the live engine moved a chain doc on, and this build heals it', () => {
  for (const kind of ['tires', 'corrosion']) {
    it(`its resolve cancelled the IPC lookup and made the stopped ${kind} job ready: the next move puts the lookup back and the job back on hold`, () => {
      const doc = load(`skew-79f806b-resolved-${kind}`);
      const c = doc.chain!;
      expect(c.step).toBe('lookup');
      expect(doc.orders.find((o) => o.id === c.stepId)!.status).toBe('cancelled');
      expect(doc.orders.find((o) => o.id === c.orderId)!.status).toBe('ready');
      // any move heals it first: here the mechanic tries to finish the job, which the part still holds
      const r = apply(doc, { t: 'complete', role: 'mech', orderId: c.orderId, score: 0.9, perfect: false, week: doc.week }, doc.updatedAt + 1000);
      expect(r.error).toMatch(/^Waiting on the part chain/);
      const s = apply(doc, { t: 'endTurn', role: 'elec', week: doc.week }, doc.updatedAt + 1000).s;
      const h = openChain(s)!;
      const look = s.orders.find((o) => o.id === h.stepId)!;
      expect(look).toMatchObject({ kind: 'ipc', status: 'ready', role: 'mech', chain: { id: h.id, step: 'lookup' } });
      expect(s.orders.find((o) => o.id === h.orderId)!.status).toBe('waiting_part');
      // and somebody has the move again
      expect(crossMoves(s).some((m) => m.kind === 'chain' && m.who === 'mech')).toBe(true);
      // healing twice changes nothing
      const again = structuredClone(s);
      expect(healOpenChain(again, s.updatedAt)).toEqual([]);
      expect(again).toEqual(s);
    });
  }

  it('its approval made the part order ready with the chain still at the buy: the next move sends the part on its way, paid once', () => {
    const doc = load('skew-79f806b-approved');
    const c = doc.chain!;
    const card = doc.orders.find((o) => o.id === c.stepId)!;
    expect(c.step).toBe('buy');
    expect(card.status).toBe('ready');
    // the live engine took the part's price at its approval
    expect(doc.cash).toBe(20000 - card.cost);
    const s = apply(doc, { t: 'endTurn', role: 'elec', week: doc.week }, doc.updatedAt + 1000).s;
    expect(s.chain!.step).toBe('transit');
    expect(s.orders.find((o) => o.id === card.id)!.status).toBe('waiting_part');
    // the boat (the cargo plane is the one that's down) is the only new charge
    expect(s.cash).toBe(doc.cash - 350);
    let x = s;
    for (const role of ROLES) x = apply(x, { t: 'endTurn', role, week: x.week }, x.updatedAt).s;
    expect(x.chain!.step).toBe('install');
  });

  it('an island saved by a newer engine is refused, never written over', () => {
    const doc = load('live-79f806b-late');
    const newer = { ...doc, engine: ENGINE_VERSION + 1 };
    const r = apply(newer, { t: 'endTurn', role: 'mech', week: doc.week }, doc.updatedAt + 1000);
    expect(r.error).toMatch(/saved by a newer version of Island Company\. Reload/);
    expect(r.s).toBe(newer);
    // this build stamps its own version on everything it writes
    expect(apply(doc, { t: 'endTurn', role: 'mech', week: doc.week }, doc.updatedAt + 1000).s.engine).toBe(ENGINE_VERSION);
  });

  it('pushes and notifications work across the heal (no crash on a chain the old engine left half-done)', () => {
    const doc = load('skew-79f806b-resolved-tires');
    const after = apply(doc, { t: 'endTurn', role: 'fin', week: doc.week }, doc.updatedAt + 1000).s;
    expect(() => pushes(doc, after, { t: 'endTurn', role: 'fin', week: doc.week })).not.toThrow();
  });
});

describe('a chain step handed in after its week closed', () => {
  it('says the step is still waiting in the new week (autopilot never does the paperwork)', () => {
    const doc = load('skew-79f806b-resolved-tires');
    const s = apply(doc, { t: 'endTurn', role: 'elec', week: doc.week }, doc.updatedAt + 1000).s;
    const look = s.orders.find((o) => o.id === s.chain!.stepId) as Order;
    const r = apply(s, { t: 'complete', role: 'mech', orderId: look.id, score: 0.9, perfect: false, data: { chain: { outcome: 'notipc' } }, week: s.week - 1 }, s.updatedAt + 1000);
    expect(r.error).toBe(`Week ${s.week - 1} closed before that synced. The IPC lookup is still waiting in week ${s.week} (autopilot doesn't do it): hand it in again.`);
  });
});

describe('the job flow’s version gate (docs/JOBFLOW.md 19.1)', () => {
  it('the engine, the doc and the rules are all at 5 (stage 2 and G0; see the v4 gate below)', () => {
    expect(ENGINE_VERSION).toBe(5);
    const net = readFileSync(resolve(import.meta.dirname, '..', 'src', 'net', 'firebase.ts'), 'utf8');
    expect(net).toMatch(/const DOC_VERSION = 5;/);
    const rules = readFileSync(resolve(import.meta.dirname, '..', 'firestore.rules'), 'utf8');
    expect(rules).toMatch(/request\.resource\.data\.v == 5;/);
    expect(rules).not.toMatch(/data\.v == [1234]\b/);
  });

  it('the live and skew docs migrate on their first move: kits become store credit, the stock, the crew and the ledger come up', () => {
    for (const name of [...LIVE, 'skew-79f806b-approved', 'skew-79f806b-resolved-corrosion', 'skew-79f806b-resolved-tires']) {
      const doc = load(name);
      const kits = (doc.parts?.stock ?? 0) + (doc.parts?.inTransit ?? 0);
      const r = apply(doc, { t: 'rename', role: 'mech', name: doc.players.mech!.name }, doc.updatedAt + 1000);
      expect(r.error, name).toBeUndefined();
      const s = r.s;
      expect(s.engine).toBe(ENGINE_VERSION);
      // (a skew doc's first move also heals its chain, which may pay for the part it had approved)
      if (!doc.chain) expect(s.cash).toBe(doc.cash);
      expect(s.parts).toEqual({ stock: 0, inTransit: 0 });
      expect((s.credit ?? 0) > 0 || kits === 0).toBe(true);
      expect(Object.keys(s.inv ?? {}).length).toBeGreaterThan(20);
      expect(s.staff?.length).toBeGreaterThan(0);
      expect(s.alerts).toBeTruthy();
      expect(s.flowSince).toBe(doc.week);
      expect(s.orders.filter((o) => o.status !== 'done' && o.status !== 'cancelled' && o.parts > 0)).toEqual([]);
      selectors(s);
    }
  });
});

// ---------------------------------------------------------------------------
// The v4 gate: docs the live job-flow build (bd1e1d2, engine 3) wrote

const V3 = ['early', 'late', 'midweek', 'mel', 'chain', 'makesafe', 'build', 'feeder'].map((n) => `v3-bd1e1d2-${n}`);
const live = (o: Order) => o.status !== 'done' && o.status !== 'cancelled';

/** every selector the screens run on an island today: Home, the tech panels, the desk, the cards, the staff, the review */
function screens(s: IslandState) {
  selectors(s);
  flowMoves(s);
  stockFlags(s);
  needsVM(s);
  projectWeek(s);
  subCharterOn(s);
  const box = siteBox(s);
  if (box) expect(box[0] >= 0 && box[1] >= 0 && box[2] <= W && box[3] <= H && box[2] > box[0] && box[3] > box[1]).toBe(true);
  buildLine(s);
  for (const b of s.builds ?? []) buildRows(s, b);
  for (const n of s.staff ?? []) expect(typeof doingNow(s, n)).toBe('string');
  for (const role of ROLES) {
    dockNext(s, role);
    endTurnChecks(s, role);
    if (role !== 'fin') yourMoves(s, role);
  }
  for (const o of s.orders)
    if (o.flow && o.status === 'pending') {
      expect(cardOf(s, o).total).toBeGreaterThanOrEqual(0);
      cardVM(s, o);
    }
  for (const a of s.alerts ?? []) {
    flowStage(s, a);
    flagsOf(s, a);
  }
  // stage 2 (docs/EXPANSION.md 10.3): the inspect sheets' selectors, home only
  for (const a of s.assets) {
    openAlertsOn(s, a.id);
    assetPnl(s, a.id, 13);
    for (const role of ROLES) {
      flaggable(s, role, a.id);
      if (role !== 'fin') {
        canCheck(s, role, a.id);
        checkView(s, role, a.id);
      }
    }
  }
  for (const k of FIXTURE_KINDS) for (const role of ROLES) fixtureFacts(s, k, HOME, role);
  for (const a of s.assets) if (a.kind === 'plane') expect(Number.isFinite(downtimeOf(s, a.id).usd)).toBe(true);
  for (const h of s.history.slice(-3)) for (const [, usd] of costLines(h)) expect(Number.isFinite(usd)).toBe(true);
}

describe('island docs written by the live job-flow build (bd1e1d2, engine 3)', () => {
  for (const name of V3) {
    it(`${name}: loads and renders, needs no migration, keeps its cash and every open order through the week's resolve on this build, and plays ten more weeks the same in memory and through JSON`, () => {
      const doc = load(name);
      expect(doc.engine).toBe(3);
      screens(doc);
      // nothing to migrate: the live build wrote every job-flow field already (only the one-time v4 stamp: the week v4
      // takes over and a credits streak the old rule earned, carried; the release gate. And at tier 4-5 G0's one-time
      // upkeep migration: the builder's warranty dated from the buildings, the service upgrade; tests/livedocs.ts)
      expectLiveMigration(doc, migrate(structuredClone(doc)));
      // the first move on this build stamps its version and leaves the money and the work as they were
      const r = apply(doc, { t: 'rename', role: 'mech', name: doc.players.mech!.name }, doc.updatedAt + 1000);
      expect(r.error).toBeUndefined();
      expect(r.s.engine).toBe(ENGINE_VERSION);
      expect(r.s.cash).toBe(doc.cash);
      expect(r.s.orders.map((o) => `${o.id}:${o.status}`)).toEqual(doc.orders.map((o) => `${o.id}:${o.status}`));
      expect(r.s.alerts).toEqual(doc.alerts);
      // stage 2's fields are written only when first used (docs/EXPANSION.md 0.2 rule 2)
      expect(r.s.checked).toBeUndefined();
      expect(r.s.flagged).toBeUndefined();
      // the seats still playing finish the week (the paper-sim crew) and it resolves here
      let a = week(structuredClone(doc), name, false);
      let b = week(JSON.parse(JSON.stringify(doc)) as IslandState, name, true);
      const h = a.history[a.history.length - 1];
      expect(h.week).toBe(doc.week);
      expect(h.cashStart).toBe(doc.openCash);
      expect(Number.isFinite(h.cashEnd)).toBe(true);
      // no open order is lost (the resolve may finish or cancel one, never drop it)
      for (const o of doc.orders.filter(live)) expect(a.orders.some((x) => x.id === o.id), o.id).toBe(true);
      screens(a);
      for (let w = 0; w < 10; w++) {
        a = week(a, name, false);
        b = week(b, name, true);
        screens(a);
        expect(Number.isFinite(a.cash)).toBe(true);
        expect(a.engine).toBe(ENGINE_VERSION);
        // each week's review starts from the cash the week before ended with
        const [prev, last] = a.history.slice(-2);
        expect(last.cashStart).toBe(prev.cashEnd);
      }
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
      expect(JSON.stringify(a).length).toBeLessThan(200_000);
    });
  }

  it("the MEL doc: the only guest plane flies on its placard this week; unfixed and not extended, it's grounded from next week and the sub-charter flies its guests", () => {
    const doc = load('v3-bd1e1d2-mel');
    const al = doc.alerts!.find((a) => a.mel && a.status !== 'closed' && soleGuest(doc, a.assetId))!;
    expect(al.mel!.until).toBe(doc.week);
    const p = doc.assets.find((a) => a.id === al.assetId)!;
    // this week: on the placard, flying
    expect(melOn(doc, p.id)).toBeTruthy();
    expect(alertAog(doc, p.id)).toBeUndefined();
    expect(subCharterOn(doc)).toBeNull();
    // nobody fixes it this week (every seat ends the turn): the placard runs out at the resolve
    let s = doc;
    const t = doc.updatedAt + 1000;
    for (const role of ROLES) if (!s.turns[role]?.ended) s = apply(s, { t: 'endTurn', role, week: doc.week }, t).s;
    expect(s.week).toBe(doc.week + 1);
    expect(s.alerts!.find((a) => a.id === al.id)!.status).not.toBe('closed');
    expect(alertAog(s, p.id)?.id).toBe(al.id);
    const sub = subCharterOn(s)!;
    expect(sub.plane.id).toBe(p.id);
    expect(sub.alert?.id).toBe(al.id);
    // and the week after: the operator flew the guests, the review books it, the twin flew nothing
    const W = s.week;
    for (const role of ROLES) s = apply(s, { t: 'endTurn', role, week: W }, (s.deadline ?? s.updatedAt) - 1000).s;
    const h = s.history[s.history.length - 1];
    expect(h.week).toBe(W);
    expect(h.flightsFlown).toBe(0);
    expect(h.costs.subCharter).toBe(sub.flights * SUB_FEE);
    expect(h.housesBooked).toBeGreaterThanOrEqual(sub.flights);
    expect(h.lines.some((l) => /mainland sub-charter flew the guests/.test(l.text))).toBe(sub.flights > 0);
  });

  it('the feeder doc: the analyst approves the waiting feeder card on this build and the job plays the underground feeder scene, not the bedroom trace', () => {
    const doc = load('v3-bd1e1d2-feeder');
    const card = doc.orders.find((o) => o.role === 'elec' && o.job === 'feeder' && o.status === 'pending')!;
    expect(card.puzzle).toBe('trace');
    let s = apply(doc, { t: 'approve', orderId: card.id, week: doc.week }, doc.updatedAt + 1000).s;
    // parts not on the shelf land on a PO: play weeks until the job is ready
    for (let w = 0; w < 3 && s.orders.find((o) => o.id === card.id)!.status !== 'ready'; w++) {
      const W = s.week;
      for (const role of ROLES) if (!s.turns[role]?.ended) s = apply(s, { t: 'endTurn', role, week: W }, (s.deadline ?? s.updatedAt) - 1000).s;
    }
    const o = s.orders.find((x) => x.id === card.id)!;
    expect(o.status).toBe('ready');
    const L = launchFor(s, o, 'elec');
    expect(L.puzzle).toBe('trace');
    expect(L.context?.job).toBe('feeder');
    expect(trace.titleFor?.(L.context)).toBe('Underground feeder');
  });

  it("the build doc: the builders' site has its own zoom box on Home", () => {
    const doc = load('v3-bd1e1d2-build');
    expect(siteBox(doc)).not.toBeNull();
    expect(buildLine(doc)).not.toBeNull();
  });

  it("the mid-week doc: the analyst approves the open requisition and the tech's waiting card on this build, then the week resolves", () => {
    const doc = load('v3-bd1e1d2-midweek');
    const q = doc.reqs!.find((x) => x.status === 'open')!;
    const card = doc.orders.find((o) => o.status === 'pending' && o.role !== 'fin' && o.flow)!;
    let t = doc.updatedAt + 1000;
    let r = apply(doc, { t: 'approveReq', reqs: [q.id], week: doc.week }, ++t);
    expect(r.error).toBeUndefined();
    expect(r.s.reqs!.find((x) => x.id === q.id)!.status).not.toBe('open');
    r = apply(r.s, { t: 'approve', orderId: card.id, week: doc.week }, ++t);
    expect(r.error).toBeUndefined();
    expect(['ready', 'waiting_part']).toContain(r.s.orders.find((o) => o.id === card.id)!.status);
    let s = r.s;
    for (const role of ROLES) if (!s.turns[role]?.ended) s = apply(s, { t: 'endTurn', role, week: doc.week }, ++t).s;
    expect(s.week).toBe(doc.week + 1);
    screens(s);
  });

  it('the chain doc: the open part chain runs to the end on this build', () => {
    const doc = load('v3-bd1e1d2-chain');
    expect(openChain(doc)).toBeTruthy();
    let s = structuredClone(doc);
    for (let w = 0; w < 8 && openChain(s); w++) s = week(s, 'chain', false);
    expect(openChain(s)).toBeFalsy();
  });

  it("the make-safe doc: the house made safe at the breaker rents at 75% on this build until the fix", () => {
    const doc = load('v3-bd1e1d2-makesafe');
    const al = doc.alerts!.find((a) => a.safe && a.status !== 'closed')!;
    const house = doc.assets.find((a) => a.id === al.assetId)!;
    expect(rentFactor(doc, house)).toBe(0.75);
    screens(doc);
  });

  it('reverse skew: every doc this build writes is engine 5, and an engine older than the doc (the live v3 one) refuses to write it', () => {
    for (const name of V3) {
      const doc = load(name);
      const r4 = apply(doc, { t: 'rename', role: 'elec', name: doc.players.elec!.name }, doc.updatedAt + 1000);
      expect(r4.error, name).toBeUndefined();
      const v4 = r4.s;
      expect(v4.engine, name).toBe(5);
      // bd1e1d2's apply() opens with the same guard as this one, `(prev.engine ?? 0) > ENGINE_VERSION`, at 3:
      // a doc one version ahead of the engine is refused whole, and the tab reloads (useIsland's ic:stale)
      expect(v4.engine! > 3).toBe(true);
      const ahead = { ...v4, engine: ENGINE_VERSION + 1 };
      for (const role of ROLES) {
        const r = apply(ahead, { t: 'endTurn', role, week: v4.week }, v4.updatedAt + 1000);
        expect(r.error, `${name} ${role}`).toMatch(/saved by a newer version of Island Company\. Reload/);
        expect(r.s).toBe(ahead);
      }
      expect(apply(ahead, { t: 'resolve', week: v4.week }, (v4.deadline ?? v4.updatedAt) + 1000).s).toBe(ahead);
    }
  });
});

// ---------------------------------------------------------------------------
// The v5 gate (stage 2 + G0): docs the live stage 1 build (e810cc5, engine 4) wrote

const V4 = ['early', 'midweek', 'chain', 'feeder', 'subcharter', 'rcv', 't4-carry', 't5-carry', 't5-carry-mid', 'credits', 't2', 't4', 't4-mid', 't5', 't5-late'].map((n) => `v4-e810cc5-${n}`);

/** the analyst's desk: the tabs' counts, the queues, the money, the receiver, the Harbor sheet */
function desk(s: IslandState) {
  const c = deskCounts(s);
  expect(Number.isFinite(c.approvals + c.staff + c.desk)).toBe(true);
  openingTab(s);
  for (const o of [...flowQueue(s), ...legacyQueue(s)]) deskTaskLine(s, o);
  reqQueue(s);
  expect(Number.isFinite(spendable(s) + committed(s) + receiverLeft(s))).toBe(true);
  for (const f of families(s)) {
    moveClass(s, f.fam);
    velocity(s, f.fam);
  }
  for (const l of harborLines(s)) expect(l.body.length).toBeGreaterThan(0);
}

/** the map's hotspots (day and night) and, for each, the inspect sheet every seat opens from it */
function mapAndSheets(s: IslandState) {
  const day = hotspots(s, HOME, LAYOUTS.home, { phase: 'day' });
  hotspots(s, HOME, LAYOUTS.home, { phase: 'night' });
  const keys = new Set(day.map((h) => refKey(h.ref)));
  for (const a of s.assets) expect(keys.has(refKey(assetRef(a))), a.id).toBe(true);
  for (const h of day)
    for (const role of ROLES) {
      const f = facts(s, h.ref, role);
      expect(f.name.length, `${refKey(h.ref)} as ${role}`).toBeGreaterThan(1);
      expect(f.status.length).toBeGreaterThan(1);
      expect(factsText(f)).not.toMatch(/undefined|NaN/);
    }
  for (const h of day) expect(inspectLabel(s, h.ref)).toBe(facts(s, h.ref, 'fin').name);
  for (const role of ROLES) {
    whatsNewMapPanels(s, role);
    whatsNewUpkeepPanels(s, role);
  }
}

/** everything a seat can open on the island: Home, the tech panels, the desk, the map and every object's sheet */
function all(s: IslandState) {
  screens(s);
  desk(s);
  mapAndSheets(s);
}

const streakOf = (s: IslandState) => ({ aStreak: s.stats.aStreak ?? 0, aCarry: s.stats.aCarry, v4From: s.stats.v4From, creditsWeek: s.creditsWeek });

describe('island docs written by the live stage 1 build (e810cc5, engine 4)', () => {
  for (const name of V4) {
    it(`${name}: loads and renders (Home, the desk, the map, every sheet for every seat), keeps its cash, orders, streak and credits on this build's first move, and plays ten more weeks the same in memory and through JSON`, () => {
      const doc = load(name);
      expect(doc.engine).toBe(4);
      // as written, and as the app shows it (useIsland: an engine below this build's → migrate a copy)
      all(doc);
      const shown = migrate(structuredClone(doc));
      all(shown);
      // what the migration does: at tier 4-5 G0's one-time upkeep migration, else nothing (tests/livedocs.ts)
      expectLiveMigration(doc, shown, name);
      expect(JSON.stringify(migrate(structuredClone(shown))), name).toBe(JSON.stringify(shown));
      // the first move on this build: engine 5, the money, the work and the streak as they were
      const r = apply(doc, { t: 'rename', role: 'mech', name: doc.players.mech!.name }, doc.updatedAt + 1000);
      expect(r.error).toBeUndefined();
      const s = r.s;
      expect(s.engine).toBe(ENGINE_VERSION);
      expect(s.cash).toBe(doc.cash);
      expect(s.openCash).toBe(doc.openCash);
      expect(s.credit ?? 0).toBe(doc.credit ?? 0);
      expect(s.loan).toEqual(doc.loan);
      expect(s.receivership).toBe(doc.receivership);
      expect(s.orders.map((o) => `${o.id}:${o.status}`)).toEqual(doc.orders.map((o) => `${o.id}:${o.status}`));
      expect(s.alerts).toEqual(doc.alerts);
      expect(s.reqs).toEqual(doc.reqs);
      expect(s.pos).toEqual(doc.pos);
      expect(s.chain).toEqual(doc.chain);
      expect(s.turns).toEqual(doc.turns);
      expect(streakOf(s)).toEqual(streakOf(doc));
      expect(s.stats.g0From).toBe(doc.tier >= 4 ? doc.week : undefined);
      // stage 2's fields are written only when first used (docs/EXPANSION.md 0.2 rule 2)
      expect(s.checked).toBeUndefined();
      expect(s.flagged).toBeUndefined();
      all(s);
      // the seats still playing finish the week (the paper-sim crew) and it resolves here
      let a = week(structuredClone(doc), name, false);
      let b = week(JSON.parse(JSON.stringify(doc)) as IslandState, name, true);
      const h = a.history[a.history.length - 1];
      expect(h.week).toBe(doc.week);
      expect(h.cashStart).toBe(doc.openCash);
      expect(Number.isFinite(h.cashEnd)).toBe(true);
      for (const o of doc.orders.filter(live)) expect(a.orders.some((x) => x.id === o.id), o.id).toBe(true);
      all(a);
      const g0From = a.stats.g0From;
      expect(g0From).toBe(doc.tier >= 4 ? doc.week : undefined);
      for (let w = 0; w < 10; w++) {
        const before = a;
        a = week(a, name, false);
        b = week(b, name, true);
        all(a);
        expect(Number.isFinite(a.cash)).toBe(true);
        expect(a.engine).toBe(ENGINE_VERSION);
        const [prev, last] = a.history.slice(-2);
        expect(last.cashStart).toBe(prev.cashEnd);
        // G0 ran once, on the first read: never again on a doc this build wrote (a Harbor reached here gets it with the tier)
        expect(a.stats.g0From).toBe(g0From);
        expect(JSON.stringify(migrate(structuredClone(a)))).toBe(JSON.stringify(a));
        // the credits stay rolled; a carried streak ends only on a week below A, and takes the carry with it
        if (before.creditsWeek) expect(a.creditsWeek).toBe(before.creditsWeek);
        if (last.grade !== 'A') expect(a.stats.aStreak ?? 0).toBe(0);
        if (a.stats.aCarry !== undefined) {
          expect(a.stats.aCarry).toBe(doc.stats.aCarry);
          expect(a.stats.aStreak ?? 0).toBeGreaterThan(0);
        }
        if (before.stats.aCarry !== undefined && last.grade === 'A') expect(a.stats.aStreak ?? 0).toBeGreaterThanOrEqual(before.stats.aStreak ?? 0);
        expect(a.stats.v4From).toBe(doc.stats.v4From);
      }
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
      expect(JSON.stringify(a).length).toBeLessThan(200_000);
    });
  }

  it('the carried streaks as e810cc5 left them: held at the Harbor, one full-crew A from the credits at the Resort, the credits already rolled', () => {
    const t4 = load('v4-e810cc5-t4-carry');
    expect([t4.tier, t4.stats.aStreak, t4.stats.aCarry, t4.stats.v4From, t4.week]).toEqual([4, 8, 8, 17, 18]);
    const t5 = load('v4-e810cc5-t5-carry');
    expect([t5.tier, t5.stats.aStreak, t5.stats.aCarry, t5.stats.v4From, t5.week, t5.creditsWeek]).toEqual([5, 7, 7, 25, 26, undefined]);
    // e810cc5 held it on an autopilot A in week 25 (the pause), and said so
    const w25 = t5.history.find((r) => r.week === 25)!;
    expect(w25.grade).toBe('A');
    expect(w25.autoRun?.length).toBeGreaterThan(0);
    const cr = load('v4-e810cc5-credits');
    expect([cr.creditsWeek, cr.stats.aCarry, cr.stats.v4From]).toEqual([25, 7, 25]);
    // this build reads them the same: the Board's count, the Harbor sheet's words
    for (const doc of [t4, t5]) {
      const m = migrate(structuredClone(doc));
      expect(creditsStreak(m, m.week)).toBe(doc.stats.aStreak);
      expect(harborLines(m).find((l) => l.title === 'The credits')!.body).toMatch(new RegExp(`Your streak from before this update counts: ${doc.stats.aStreak}/8`));
    }
    // and resolves the same: at the Harbor an A holds the 8 (a lower grade ends it); at the Resort the next full-crew A is the credits
    const m4 = migrate(structuredClone(t4));
    expect([aStreakAfter(m4, 18, 'A', true), aStreakAfter(m4, 18, 'A', false), aStreakAfter(m4, 18, 'B', true)]).toEqual([8, 8, 0]);
    const m5 = migrate(structuredClone(t5));
    expect([aStreakAfter(m5, 26, 'A', true), aStreakAfter(m5, 26, 'A', false), aStreakAfter(m5, 26, 'B', true)]).toEqual([8, 7, 0]);
  });

  it('the Resort doc one A from the credits: its next full-crew A week, resolved on this build, rolls them on the carried streak', () => {
    const doc = load('v4-e810cc5-t5-carry');
    const s = week(structuredClone(doc), 'carry-credits', false);
    const h = s.history[s.history.length - 1];
    expect([h.week, h.grade, h.autoRun]).toEqual([26, 'A', []]);
    expect([s.creditsWeek, s.stats.aStreak, s.stats.aCarry]).toEqual([26, 8, 7]);
    expect(h.lines.some((l) => /Eight full-crew A weeks at the Resort/.test(l.text))).toBe(true);
    // and the credits stay rolled whatever comes after (the week below A ends the streak and the carry, not the credits)
    let x = s;
    for (let i = 0; i < 3; i++) x = week(x, `after-credits-${i}`, false);
    expect(x.creditsWeek).toBe(26);
  });

  it('the mid-week doc: the analyst approves the open requisition and both waiting cards on this build, then the week resolves', () => {
    const doc = load('v4-e810cc5-midweek');
    expect(doc.turns.mech?.ended).toBe(true);
    const q = doc.reqs!.find((x) => x.status === 'open')!;
    const cards = doc.orders.filter((o) => o.status === 'pending' && o.role !== 'fin' && o.flow);
    expect(cards.length).toBeGreaterThan(0);
    let t = doc.updatedAt + 1000;
    let r = apply(doc, { t: 'approveReq', reqs: [q.id], week: doc.week }, ++t);
    expect(r.error).toBeUndefined();
    expect(r.s.reqs!.find((x) => x.id === q.id)!.status).not.toBe('open');
    let s = r.s;
    for (const card of cards) {
      r = apply(s, { t: 'approve', orderId: card.id, week: doc.week }, ++t);
      expect(r.error, card.id).toBeUndefined();
      expect(['ready', 'waiting_part']).toContain(r.s.orders.find((o) => o.id === card.id)!.status);
      s = r.s;
    }
    for (const role of ROLES) if (!s.turns[role]?.ended) s = apply(s, { t: 'endTurn', role, week: doc.week }, ++t).s;
    expect(s.week).toBe(doc.week + 1);
    expect(s.history.at(-1)!.cashStart).toBe(doc.openCash);
    all(s);
  });

  it('the chain doc: the open part chain runs to the end on this build', () => {
    const doc = load('v4-e810cc5-chain');
    expect(openChain(doc)?.step).toBe('fee');
    let s = structuredClone(doc);
    for (let w = 0; w < 8 && openChain(s); w++) s = week(s, 'chain', false);
    expect(openChain(s)).toBeFalsy();
    expect(s.orders.find((o) => o.id === doc.chain!.orderId)!.status).not.toBe('cancelled');
  });

  it('the feeder doc: the approved feeder job gets its part and plays the underground feeder scene on this build', () => {
    const doc = load('v4-e810cc5-feeder');
    const job = doc.orders.find((o) => o.role === 'elec' && o.job === 'feeder' && o.status === 'waiting_part')!;
    let s = doc;
    for (let w = 0; w < 3 && s.orders.find((o) => o.id === job.id)!.status !== 'ready'; w++) {
      const W = s.week;
      for (const role of ROLES) if (!s.turns[role]?.ended) s = apply(s, { t: 'endTurn', role, week: W }, (s.deadline ?? s.updatedAt) - 1000).s;
    }
    const o = s.orders.find((x) => x.id === job.id)!;
    expect(o.status).toBe('ready');
    const L = launchFor(s, o, 'elec');
    expect(L.context?.job).toBe('feeder');
    expect(trace.titleFor?.(L.context)).toBe('Underground feeder');
  });

  it("the sub-charter doc: the only guest plane is grounded past due, and this build's resolve flies its guests on the sub-charter and books it", () => {
    const doc = load('v4-e810cc5-subcharter');
    const sub = subCharterOn(doc)!;
    expect(sub).not.toBeNull();
    expect(soleGuest(doc, sub.plane.id)).toBe(true);
    expect(alertAog(doc, sub.plane.id)?.id).toBe(sub.alert!.id);
    let s = doc;
    const t = doc.updatedAt + 1000;
    for (const role of ROLES) if (!s.turns[role]?.ended) s = apply(s, { t: 'endTurn', role, week: doc.week }, t).s;
    expect(s.week).toBe(doc.week + 1);
    const h = s.history[s.history.length - 1];
    expect(h.week).toBe(doc.week);
    expect(h.costs.subCharter).toBe(sub.flights * SUB_FEE);
    expect(h.lines.some((l) => /mainland sub-charter flew the guests/.test(l.text))).toBe(sub.flights > 0);
  });

  it("the receivership doc: the receiver's loan and the count carry over, and this build's resolve takes the week's payment off it", () => {
    const doc = load('v4-e810cc5-rcv');
    expect(doc.receivership).toBe(3);
    const loan = doc.loan!;
    expect(loan.left).toBeGreaterThan(0);
    let s = doc;
    const t = doc.updatedAt + 1000;
    for (const role of ROLES) if (!s.turns[role]?.ended) s = apply(s, { t: 'endTurn', role, week: doc.week }, t).s;
    const h = s.history[s.history.length - 1];
    expect(h.week).toBe(doc.week);
    const paid = h.costs.loan ?? 0;
    expect(paid).toBeGreaterThan(0);
    expect(paid).toBeLessThanOrEqual(loan.weekly);
    expect(s.loan!.left).toBe(loan.left - paid);
    expect(s.receivership).toBe(s.cash < 0 ? Math.max(1, doc.receivership - 1) : doc.receivership - 1);
    all(s);
  });

  it('reverse skew: every doc this build writes from them is engine 5, and an engine older than the doc (the live v4 one) refuses to write it', () => {
    expect(G0_ENGINE).toBe(ENGINE_VERSION);
    // e810cc5's apply() opens with the same guard as this one, `(prev.engine ?? 0) > ENGINE_VERSION`, at 4
    // (scripts/reverse-skew.ts runs e810cc5's own reducer on these: every move refused, the doc untouched)
    const src = readFileSync(resolve(import.meta.dirname, '..', 'src', 'sim', 'engine.ts'), 'utf8');
    expect(src).toMatch(/if \(\(prev\.engine \?\? 0\) > ENGINE_VERSION\) return fail\('This island was saved by a newer version of Island Company\. Reload the app to keep playing\.'\);/);
    for (const name of V4) {
      const doc = load(name);
      const r5 = apply(doc, { t: 'rename', role: 'elec', name: doc.players.elec!.name }, doc.updatedAt + 1000);
      expect(r5.error, name).toBeUndefined();
      const v5 = r5.s;
      expect(v5.engine, name).toBe(5);
      expect(v5.engine! > 4).toBe(true);
      const ahead = { ...v5, engine: ENGINE_VERSION + 1 };
      for (const role of ROLES) {
        const r = apply(ahead, { t: 'endTurn', role, week: v5.week }, v5.updatedAt + 1000);
        expect(r.error, `${name} ${role}`).toMatch(/saved by a newer version of Island Company\. Reload/);
        expect(r.s).toBe(ahead);
      }
      expect(apply(ahead, { t: 'resolve', week: v5.week }, (v5.deadline ?? v5.updatedAt) + 1000).s).toBe(ahead);
    }
  });
});
