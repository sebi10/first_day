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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { botTurn, TEAMS } from '../src/sim/bots';
import { islandAircraft, openChain } from '../src/sim/chain';
import { ENGINE_VERSION, apply, healOpenChain } from '../src/sim/engine';
import { rng, hashSeed } from '../src/sim/rng';
import { ROLES, type IslandState, type Order } from '../src/sim/types';
import { blocks, crossMoves, launchFor, openOrders, pushes, teamNumbers } from '../src/ui/select';

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
  it('the engine, the doc and the rules are all at 3', () => {
    expect(ENGINE_VERSION).toBe(3);
    const net = readFileSync(resolve(import.meta.dirname, '..', 'src', 'net', 'firebase.ts'), 'utf8');
    expect(net).toMatch(/const DOC_VERSION = 3;/);
    const rules = readFileSync(resolve(import.meta.dirname, '..', 'firestore.rules'), 'utf8');
    expect(rules).toMatch(/request\.resource\.data\.v == 3/);
    expect(rules).not.toMatch(/data\.v == 2/);
  });

  it('the live and skew docs migrate on their first move: kits become store credit, the stock, the crew and the ledger come up', () => {
    for (const name of [...LIVE, 'skew-79f806b-approved', 'skew-79f806b-resolved-corrosion', 'skew-79f806b-resolved-tires']) {
      const doc = load(name);
      const kits = (doc.parts?.stock ?? 0) + (doc.parts?.inTransit ?? 0);
      const r = apply(doc, { t: 'rename', role: 'mech', name: doc.players.mech!.name }, doc.updatedAt + 1000);
      expect(r.error, name).toBeUndefined();
      const s = r.s;
      expect(s.engine).toBe(3);
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
