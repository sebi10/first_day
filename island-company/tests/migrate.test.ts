// The v2 -> v3 migration (docs/JOBFLOW.md 19.2) on island docs the base engine
// (6c0c426) wrote with its own bots (scripts/fixtures-v2.ts, three friends).
// The first doc that matched each state, by the seed of `simulate` and the week:
//
//   v2-6c0c426-early          seed 5,  week 4   tier 1, start of the week, 3 kits in stock
//   v2-6c0c426-kits           seed 58, week 19  tier 4, mid-week, 2 kits in transit, 2 orders waiting on kits
//   v2-6c0c426-countered      seed 1,  week 2   tier 1, a countered order that carries a kit
//   v2-6c0c426-repair         seed 1,  week 12  tier 3, a pending repair with parts
//   v2-6c0c426-chain-transit  seed 4,  week 24  tier 5, an open chain with its part in transit (the plane AOG)
//   v2-6c0c426-chain-review   seed 4,  week 23  tier 5, an open chain waiting on engineering's answer
//   v2-6c0c426-midweek        seed 1,  week 9   tier 3, the mechanic ended, the electrician one job in, the analyst not started
//   v2-6c0c426-late           seed 1,  week 22  tier 4, storm season
//
// The v3 docs the live job-flow build wrote (bd1e1d2, scripts/fixtures-v3.ts) need no migration on the v4
// build: see the last describe here, and tests/skew.test.ts for how they play.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { botTurn, TEAMS } from '../src/sim/bots';
import { islandAircraft, openChain } from '../src/sim/chain';
import { kitValue, STOCK } from '../src/sim/data';
import { ENGINE_VERSION, apply } from '../src/sim/engine';
import { expectLiveMigration, liveMigrated, oldSetWork } from './livedocs';
import { cardOf, flowStage } from '../src/sim/flow';
import { committed } from '../src/sim/ledger';
import { migrate } from '../src/sim/migrate';
import { hashSeed, rng } from '../src/sim/rng';
import { families, flowWeeks, jobLines, moveClass, reservedFor, stockFlags, velocity } from '../src/sim/stock';
import { ROLES, type IslandState, type Order } from '../src/sim/types';
import { blocks, crossMoves, dockNext, endTurnChecks, flowMoves, launchFor, openOrders, teamNumbers, yourMoves } from '../src/ui/select';

vi.setConfig({ testTimeout: 30000 });

const FIXTURES = ['early', 'kits', 'countered', 'repair', 'chain-transit', 'chain-review', 'midweek', 'late'].map((n) => `v2-6c0c426-${n}`);
const load = (name: string): IslandState => JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures', `${name}.json`), 'utf8'));
const open = (o: Order) => o.status !== 'done' && o.status !== 'cancelled';
const clone = (s: IslandState): IslandState => JSON.parse(JSON.stringify(s));

/** every selector a screen runs on the island */
function selectors(s: IslandState) {
  blocks(s);
  crossMoves(s);
  flowMoves(s);
  teamNumbers(s);
  stockFlags(s);
  for (const role of ROLES) {
    dockNext(s, role);
    endTurnChecks(s, role);
    if (role !== 'fin') yourMoves(s, role);
    for (const o of openOrders(s, role)) if (o.status === 'ready') launchFor(s, o, role);
  }
  for (const o of s.orders) if (o.flow && o.status === 'pending') expect(cardOf(s, o).total).toBeGreaterThanOrEqual(0);
  for (const a of s.alerts ?? []) flowStage(s, a);
  for (const a of s.assets) if (a.kind === 'plane') expect(islandAircraft(s.seed, a).registration).toMatch(/^N\d/);
}

/** the rest of the week on this build (the seats that haven't ended play as the paper sim's crew), then the resolve */
function week(s: IslandState, salt: string, json: boolean) {
  const team = TEAMS['three friends'];
  const now = s.deadline ?? s.updatedAt;
  const W = s.week;
  let x = s;
  for (const role of ROLES) {
    if (x.turns[role]?.ended) continue;
    x = botTurn(x, role, team[role], rng(hashSeed('migrate', salt, role, W)), now - 3600_000);
    if (json) x = clone(x);
    x = apply(x, { t: 'endTurn', role, week: W }, now - 3600_000).s;
    if (json) x = clone(x);
  }
  if (x.week === W) x = apply(x, { t: 'resolve', week: W }, now + 1000).s;
  expect(x.week).toBe(W + 1);
  return x;
}

describe('the v2 docs the base engine wrote', () => {
  for (const name of FIXTURES) {
    it(`${name}: migrates once, keeps the cash and every order, turns the kits into credit, and plays ten weeks the same in memory and through JSON`, () => {
      const doc = load(name);
      expect(doc.engine).toBe(2);
      const kits = (doc.parts?.stock ?? 0) + (doc.parts?.inTransit ?? 0);
      const m = migrate(clone(doc));
      // idempotent, field by field
      expect(JSON.stringify(migrate(clone(m)))).toBe(JSON.stringify(m));
      // the money: cash as it was, the kits as store credit at the vendors
      expect(m.cash).toBe(doc.cash);
      expect(m.credit).toBe(kits * kitValue(doc.tier));
      expect(m.parts).toEqual({ stock: 0, inTransit: 0 });
      expect(committed(m)).toBe(Math.max(0, Math.round((m.pos ?? []).reduce((n, p) => n + p.cost, 0) - (m.credit ?? 0))));
      // no order lost, none waiting on kits
      for (const o of doc.orders.filter(open)) {
        const after = m.orders.find((x) => x.id === o.id);
        expect(after, o.id).toBeTruthy();
        expect(open(after!), o.id).toBe(true);
      }
      expect(m.orders.filter((o) => open(o) && o.parts > 0)).toEqual([]);
      // the new fields
      expect(m.alerts!.every((a) => a.status === 'job')).toBe(true);
      expect(m.flowSince).toBe(doc.week);
      expect(m.staff!.length).toBeGreaterThan(0);
      expect(m.ledger!.length).toBe(Math.min(STOCK.ledgerWeeks - 1, doc.history.length));
      expect(m.reqs).toEqual([]);
      expect(m.eas).toEqual([]);
      // a mid-week doc keeps its turns
      expect(m.turns).toEqual(doc.turns);
      selectors(m);
      // ten weeks of the crew on this build: the doc it writes is v3, the same through JSON
      let a = clone(doc);
      let b = clone(doc);
      for (let w = 0; w < 10; w++) {
        a = week(a, name, false);
        b = week(b, name, true);
        selectors(a);
        expect(a.engine).toBe(ENGINE_VERSION);
        expect(Number.isFinite(a.cash)).toBe(true);
      }
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
      expect(JSON.stringify(a).length).toBeLessThan(150_000);
    });
  }
});

describe('the item analytics on a migrated island (14.5)', () => {
  it('count the job flow’s weeks only: no class for 8 weeks, no dead stock and no stop for 25, and the stop text counts flow weeks', () => {
    const doc = load('v2-6c0c426-late');
    let s = migrate(clone(doc));
    const since = s.flowSince!;
    expect(since).toBe(doc.week);
    // the backfilled rows stay for the cash and revenue charts; the item analytics skip them
    expect(s.ledger!.some((r) => r.w < since)).toBe(true);
    expect(flowWeeks(s)).toBe(0);
    for (const f of families(s)) {
      expect(moveClass(s, f.fam), f.fam).toBeNull();
      expect(velocity(s, f.fam).series.length).toBeLessThanOrEqual(1);
    }
    expect(stockFlags(s).filter((f) => f.kind === 'stop')).toEqual([]);
    let classed = false;
    for (let w = 0; w < 27; w++) {
      s = week(s, 'analytics', false);
      const n = flowWeeks(s);
      expect(n).toBe(Math.min(STOCK.ledgerWeeks - 1, s.week - since));
      const classes = families(s).map((f) => moveClass(s, f.fam));
      if (n < 8) expect(classes.every((c) => c === null)).toBe(true);
      else classed ||= classes.some((c) => c !== null);
      if (n < STOCK.ledgerWeeks - 1) expect(classes.includes('dead')).toBe(false);
      for (const f of stockFlags(s).filter((x) => x.kind === 'stop')) {
        const m = /no use in (\d+) weeks?/.exec(f.text);
        if (m) expect(Number(m[1]), f.text).toBeLessThanOrEqual(n + 1);
        if (n < STOCK.ledgerWeeks - 1) expect(f.text).not.toMatch(/no use in/);
      }
    }
    expect(classed).toBe(true);
  });
});

describe('what the migration does to the orders', () => {
  it('an approved order waiting on kits becomes a flow job: what the shelf has is reserved, the rest lands on an automatic PO at this week’s resolve', () => {
    const doc = load('v2-6c0c426-kits');
    const waiting = doc.orders.filter((o) => o.status === 'waiting_part' && o.parts > 0 && !o.chain);
    expect(waiting.length).toBeGreaterThanOrEqual(2);
    const m = migrate(clone(doc));
    for (const w of waiting) {
      const o = m.orders.find((x) => x.id === w.id)!;
      expect(o.flow, o.id).toBeTruthy();
      expect(['ready', 'waiting_part']).toContain(o.status);
      expect(o.approvedWeek).toBe(w.approvedWeek);
      const al = m.alerts!.find((a) => a.id === o.flow!.alert)!;
      expect(al).toMatchObject({ status: 'job', order: o.id, src: 'finding' });
      // every line is on the shelf for it, or on an automatic PO due this week
      for (const l of jobLines(o)) {
        const onPo = (m.pos ?? []).filter((p) => p.by === 'auto' && p.eta === doc.week).reduce((n, p) => n + p.lines.filter((x) => x.order === o.id && x.item === l.item).reduce((k, x) => k + x.qty, 0), 0);
        expect(reservedFor(m, o.id, l.item) + onPo, `${o.id} ${l.item}`).toBeGreaterThanOrEqual(l.qty);
      }
    }
    // the rest of the week and its resolve: the POs land, the jobs are ready for next week
    const after = week(clone(doc), 'kits', false);
    for (const w of waiting) {
      const o = after.orders.find((x) => x.id === w.id)!;
      expect(['ready', 'done']).toContain(o.status);
    }
    const auto = (after.pos ?? []).filter((p) => p.by === 'auto' && p.week === doc.week && p.lines.some((l) => waiting.some((w) => w.id === l.order)));
    for (const p of auto) expect(['received', 'paid']).toContain(p.status);
  });

  it('a countered card that carries a kit becomes a pending flow card, re-priced, its counter gone', () => {
    const doc = load('v2-6c0c426-countered');
    const c = doc.orders.find((o) => o.status === 'countered' && o.parts > 0)!;
    const m = migrate(clone(doc));
    const o = m.orders.find((x) => x.id === c.id)!;
    expect(o).toMatchObject({ status: 'pending', parts: 0, pushedBack: false });
    expect(o.counter).toBeUndefined();
    expect(o.flow).toBeTruthy();
    const card = cardOf(m, o);
    expect(card.labour).toBe(o.cost);
    expect(card.total).toBeGreaterThan(0);
    // the analyst approves it on this build
    const r = apply(m, { t: 'approve', orderId: o.id, week: m.week }, (m.updatedAt ?? 0) + 1000);
    expect(r.error).toBeUndefined();
  });

  it('a pending repair with parts becomes a flow card carrying its RPR line', () => {
    const doc = load('v2-6c0c426-repair');
    const rp = doc.orders.find((o) => o.kind === 'repair' && o.status === 'pending' && o.parts > 0)!;
    const m = migrate(clone(doc));
    const o = m.orders.find((x) => x.id === rp.id)!;
    expect(o).toMatchObject({ status: 'pending', parts: 0, kind: 'repair' });
    expect(o.flow!.pick.some((l) => l.item.startsWith('RPR-'))).toBe(true);
    const al = m.alerts!.find((a) => a.id === o.flow!.alert)!;
    expect(al).toMatchObject({ sym: 'R_REPAIR', kind: 'repair', status: 'job' });
  });

  it('open part chains run to the end on this build', () => {
    for (const name of ['v2-6c0c426-chain-transit', 'v2-6c0c426-chain-review']) {
      const doc = load(name);
      expect(openChain(doc)).toBeTruthy();
      let s = clone(doc);
      for (let w = 0; w < 8 && openChain(s); w++) s = week(s, name, false);
      expect(openChain(s), name).toBeFalsy();
    }
  });

  it('the mid-week doc: the seats still playing finish their turns', () => {
    const doc = load('v2-6c0c426-midweek');
    expect(doc.turns.mech?.ended).toBe(true);
    const W = doc.week;
    let s = clone(doc);
    const now = s.updatedAt + 60_000;
    const elec = s.orders.find((o) => o.role === 'elec' && o.status === 'ready' && o.kind !== 'project');
    if (elec) {
      const r = apply(s, { t: 'complete', role: 'elec', orderId: elec.id, score: 0.9, perfect: false, week: W }, now);
      expect(r.error).toBeUndefined();
      s = r.s;
    }
    for (const role of ['elec', 'fin'] as const) s = apply(s, { t: 'endTurn', role, week: W }, now).s;
    expect(s.week).toBe(W + 1);
    expect(s.engine).toBe(ENGINE_VERSION);
    expect(s.history.at(-1)!.week).toBe(W);
  });
});

describe('the v3 docs the live job-flow build wrote (bd1e1d2): the v4 build reads them as they are', () => {
  const V3 = ['early', 'late', 'midweek', 'mel', 'chain', 'makesafe', 'build', 'feeder', 'restricted-t1', 'restricted-t2', 'restricted-mel'].map((n) => `v3-bd1e1d2-${n}`);
  it("migrate() changes nothing on any of them but the one-time stamps (v4's, and at tier 4-5 G0's upkeep migration), so the app's read path (useIsland: engine below this build's → migrate a copy) shows the doc as written", () => {
    for (const name of V3) {
      const doc = load(name);
      expect(doc.engine, name).toBe(3);
      expect((doc.engine ?? 0) < ENGINE_VERSION).toBe(true);
      // the release gate (DECISIONS "2026-09-29: stage 1 release gate"): the week v4 takes over, and the credits streak
      // the old rule earned, carried; G0 (v5): at the Harbor or the Resort, the builder's warranty dated from the
      // buildings and the service upgrade, once; nothing else (tests/livedocs.ts spells it out)
      expectLiveMigration(doc, migrate(clone(doc)), name);
      // and it's stamped once: a second read changes nothing
      expect(JSON.stringify(migrate(migrate(clone(doc)))), name).toBe(JSON.stringify(migrate(clone(doc))));
      selectors(doc);
    }
  });

  it('a v2 doc goes straight to engine 5 on its first move, migrated once', () => {
    const doc = load('v2-6c0c426-midweek');
    const r = apply(doc, { t: 'rename', role: 'fin', name: doc.players.fin!.name }, doc.updatedAt + 1000);
    expect(r.error).toBeUndefined();
    expect(r.s.engine).toBe(ENGINE_VERSION);
    expect(ENGINE_VERSION).toBe(5);
    expect(JSON.stringify(migrate(clone(r.s)))).toBe(JSON.stringify(r.s));
  });
});

// ---------------------------------------------------------------------------
// The v5 gate (stage 2 + G0): a live island opened on this build straight from v3 (not opened since the v4 release), or
// from v4 (the live stage 1 build, e810cc5, scripts/fixtures-v4.ts)

const all = (prefix: string) =>
  readdirSync(resolve(import.meta.dirname, 'fixtures'))
    .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''));
const G0_LINE = /^This update brings the Harbor’s new pad-mount transformer and feeder/;

describe('v3 → v5 in one read: a doc the job-flow build wrote (bd1e1d2), not opened since the v4 release', () => {
  const V3_ALL = all('v3-bd1e1d2-');
  it('there are the job flow’s docs and the late ones (a streak at the Harbor and the Resort, the credits one A away, an autopilot A, receivership)', () => {
    expect(V3_ALL.length).toBeGreaterThanOrEqual(16);
    for (const n of ['t4-streak-high', 't5-harbor-streak', 'credits-next-t5', 't5-auto-a', 'rcv-neg']) expect(V3_ALL).toContain(`v3-bd1e1d2-${n}`);
  });

  for (const name of V3_ALL)
    it(`${name}: one read stamps v4's carry and G0's upkeep together, the first write is engine 5, nothing is lost, and neither runs again`, () => {
      const doc = load(name);
      expect(doc.engine).toBe(3);
      const m = migrate(clone(doc));
      expectLiveMigration(doc, m, name);
      // v4's one-time stamp: the week v4 takes over, the streak the old rule earned carried in full
      expect(m.stats.v4From).toBe(doc.week);
      expect(m.stats.aCarry).toBe((doc.stats.aStreak ?? 0) > 0 ? doc.stats.aStreak : undefined);
      // G0's, at the Harbor or the Resort: the stamp and one feed line
      expect(m.stats.g0From).toBe(doc.tier >= 4 ? doc.week : undefined);
      expect(m.feed.filter((e) => G0_LINE.test(e.text))).toHaveLength(doc.tier >= 4 ? 1 : 0);
      // the first write on this build: engine 5 (never a v4 doc on the way), the money, the work, the streak as they were
      // (review round 2: at the Resort, less the old standby set's retired work: its jobs cancelled, their unstarted
      // labour back, as liveMigrated has it)
      const r = apply(doc, { t: 'rename', role: 'fin', name: doc.players.fin!.name }, doc.updatedAt + 1000);
      expect(r.error).toBeUndefined();
      const s = r.s;
      const want = liveMigrated(doc);
      expect(s.engine).toBe(5);
      expect(s.cash).toBe(want.cash);
      expect(s.credit ?? 0).toBe(doc.credit ?? 0);
      expect(s.loan).toEqual(doc.loan);
      expect(s.creditsWeek).toBe(doc.creditsWeek);
      expect(s.stats.aStreak ?? 0).toBe(doc.stats.aStreak ?? 0);
      expect([s.stats.v4From, s.stats.aCarry, s.stats.g0From]).toEqual([m.stats.v4From, m.stats.aCarry, m.stats.g0From]);
      expect(s.orders.map((o) => `${o.id}:${o.status}`)).toEqual(want.orders.map((o) => `${o.id}:${o.status}`));
      expect(s.orders.filter((o, i) => o.status !== doc.orders[i].status).every((o) => o.status === 'cancelled' && o.assetId === 'gen' && oldSetWork(doc))).toBe(true);
      expect(s.feed.filter((e) => G0_LINE.test(e.text))).toHaveLength(doc.tier >= 4 ? 1 : 0);
      // stamped once: reads and writes after it change nothing more
      expect(JSON.stringify(migrate(clone(s)))).toBe(JSON.stringify(s));
      let a = s;
      for (let w = 0; w < 3; w++) {
        a = week(a, name, false);
        expect(a.stats.v4From).toBe(doc.week);
        expect(a.stats.g0From).toBe(m.stats.g0From);
        expect(JSON.stringify(migrate(clone(a)))).toBe(JSON.stringify(a));
        // a carried streak holds until a week below A ends it (and the carry with it)
        if (a.stats.aCarry !== undefined) expect([a.stats.aCarry, (a.stats.aStreak ?? 0) > 0]).toEqual([doc.stats.aStreak, true]);
      }
    });
});

describe('v4 → v5: the docs the live stage 1 build wrote (e810cc5)', () => {
  const V4_ALL = all('v4-e810cc5-');
  it('this build reads them with G0’s one-time migration only (at tier 4-5), and keeps what v4 stamped (the carried streak, the credits)', () => {
    expect(V4_ALL.length).toBeGreaterThanOrEqual(15);
    for (const name of V4_ALL) {
      const doc = load(name);
      expect(doc.engine, name).toBe(4);
      const m = migrate(clone(doc));
      expectLiveMigration(doc, m, name);
      expect(JSON.stringify(migrate(clone(m))), name).toBe(JSON.stringify(m));
      expect(m.stats.v4From, name).toBe(doc.stats.v4From);
      expect(m.stats.aCarry, name).toBe(doc.stats.aCarry);
      expect(m.stats.aStreak, name).toBe(doc.stats.aStreak);
      expect(m.creditsWeek, name).toBe(doc.creditsWeek);
      expect(m.stats.g0From, name).toBe(doc.tier >= 4 ? doc.week : undefined);
      selectors(m);
    }
    // the carried ones are there: a v3 island opened on v4 and played on (the Harbor, the Resort, past the credits)
    const carried = V4_ALL.map(load).filter((d) => d.stats.aCarry !== undefined);
    expect(carried.map((d) => d.tier).sort()).toEqual([4, 5, 5, 5]);
    expect(carried.some((d) => d.creditsWeek !== undefined)).toBe(true);
  });
});
