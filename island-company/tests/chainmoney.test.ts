// The part chain's money and its rules at the edges: the freight on the PO (the
// AOG boat now, or next week's guest flight), what the downtime costs, a part
// quarantined at receiving for its paperwork, a card that came in after the
// analyst ended the turn, and paperwork that no grid outage, botch or blind
// sign-off should get wrong.
import { describe, expect, it } from 'vitest';
import { islandAircraft, plantFor, rightPn } from '../src/sim/chain';
import { CHAIN, DEFECT, ECON } from '../src/sim/data';
import { downtimeOf } from '../src/sim/econ';
import { apply, chainCardCost, chainWouldOpen, createIsland } from '../src/sim/engine';
import { hashSeed } from '../src/sim/rng';
import { ROLES, type Asset, type IslandState, type Order } from '../src/sim/types';

const NOW = Date.UTC(2026, 8, 26, 10);
const CARGO: Asset = { id: 'p2', kind: 'plane', model: 'cargo', name: 'Cargo C-7', health: 70, touchedWeek: 5, sinceInspection: 0 };
const CLEAN = Array.from({ length: 400 }, (_, i) => i + 1).find((seed) => !plantFor(seed, 'p2', 'cargo').plant)!;

function island(seed = CLEAN): IslandState {
  let s = createIsland({ id: `m${seed}`, name: 'Money Isle', now: NOW, tz: 'Europe/Paris', seed, creator: { uid: 'a', name: 'Ana', role: 'mech' } });
  s = apply(s, { t: 'join', uid: 'b', name: 'Ben', role: 'elec' }, NOW).s;
  s = apply(s, { t: 'join', uid: 'c', name: 'Cy', role: 'fin' }, NOW).s;
  for (const r of ROLES) s = apply(s, { t: 'week0Done', role: r }, NOW).s;
  s.week = 5;
  s.tier = 2;
  s.cash = 20000;
  s.assets.push({ ...CARGO });
  s.orders = [];
  return s;
}

let seq = 0;
function jobThatFinds(s: IslandState, kind = 'tires'): Order {
  const o: Order = { id: `t${++seq}`, role: 'mech', kind, assetId: 'p2', title: 'Tire and brake', puzzle: 'torque', tier: 2, cost: 320, parts: 0, gain: 10, createdWeek: s.week, deferrals: 0, lastDeferredWeek: null, status: 'ready', seed: 0 };
  s.orders.push(o);
  for (let i = 0; i < 500; i++) {
    o.seed = hashSeed('money', seq, i);
    if (chainWouldOpen(s, o, 'mech')) return o;
  }
  throw new Error('no seed opens a chain');
}
const ok = (r: { s: IslandState; error?: string }) => {
  expect(r.error).toBeUndefined();
  return r.s;
};
const complete = (s: IslandState, o: Pick<Order, 'id'>, data?: Record<string, unknown>, score = 0.9, role: 'mech' | 'elec' | 'fin' = 'mech', cover = false) =>
  apply(s, { t: 'complete', role, orderId: o.id, score, perfect: false, data, week: s.week, ...(cover ? { cover: true } : {}) }, NOW);
const endAll = (s: IslandState) => {
  let x = s;
  for (const r of ROLES) x = apply(x, { t: 'endTurn', role: r, week: x.week }, NOW).s;
  expect(x.week).toBe(s.week + 1);
  return x;
};
const step = (s: IslandState) => s.orders.find((o) => o.id === s.chain!.stepId)!;
const lines = (s: IslandState) => s.history.at(-1)!.lines.map((l) => l.text);
/** a chain on the cargo plane with its part card up (the IPC's P/N) */
function carded() {
  let s = island();
  const job = jobThatFinds(s);
  s = ok(complete(s, job));
  const ac = islandAircraft(s.seed, CARGO);
  s = ok(complete(s, step(s), { chain: { outcome: 'pn', pn: rightPn(ac, '32-40', s.chain!.tag) } }));
  expect(s.chain!.step).toBe('buy');
  return { s, job: job.id };
}

describe('the freight is on the PO, and the analyst chooses it', () => {
  it('the cargo plane is the one down: the card costs the part plus the AOG boat, or the part alone on next week\'s guest flight', () => {
    const { s } = carded();
    const card = step(s);
    expect(chainCardCost(s, card, 'boat')).toBe(card.cost + ECON.boatKit);
    expect(chainCardCost(s, card, 'flight')).toBe(card.cost);
    // what the downtime costs, for the card: the cargo plane carries no guests, so its week down costs the
    // kits it would have flown in (each one comes by boat instead)
    const d = downtimeOf(s, 'p2');
    expect(d).toMatchObject({ flights: 4, usd: 0, cargo: true });
    expect(downtimeOf({ ...s, parts: { ...s.parts, inTransit: 2 } }, 'p2').usd).toBe(ECON.boatKit);
    // a guest plane's week down is the revenue it would have flown
    const g = downtimeOf(s, 'p1');
    expect(g.cargo).toBe(false);
    expect(g.usd).toBeGreaterThan(0);
  });

  it('the AOG boat: paid at the approval, the part here when the week resolves', () => {
    const { s: s0 } = carded();
    const card = step(s0);
    const s = ok(apply(s0, { t: 'approve', orderId: card.id, week: s0.week, ship: 'boat' }, NOW));
    expect(s.cash).toBe(s0.cash - card.cost - ECON.boatKit);
    expect(s.chain).toMatchObject({ step: 'transit', freight: 'boat', price: card.cost, spent: card.cost + ECON.boatKit });
    expect(s.feed.at(-1)!.text).toMatch(/the AOG boat brings it when the week resolves \(\$350\)/);
    const x = endAll(s);
    expect(x.chain!.step).toBe('install');
    expect(lines(x).some((l) => /^The AOG boat brought the brake linings for Cargo C-7/.test(l))).toBe(true);
    // nothing else charged for it
    expect(lines(x).some((l) => /mainland boat/.test(l))).toBe(false);
  });

  it("the guest flight: no boat, one more week down, and it rides the week after's guest flight", () => {
    const { s: s0 } = carded();
    const card = step(s0);
    const s = ok(apply(s0, { t: 'approve', orderId: card.id, week: s0.week, ship: 'flight' }, NOW));
    expect(s.cash).toBe(s0.cash - card.cost);
    expect(s.chain).toMatchObject({ step: 'transit', freight: 'flight', ship: s0.week + 1, spent: card.cost });
    expect(s.feed.at(-1)!.text).toMatch(/rides next week's guest flight/);
    let x = endAll(s);
    expect(x.chain!.step).toBe('transit');
    x = endAll(x);
    expect(x.chain!.step).toBe('install');
    expect(x.chain!.spent).toBe(card.cost);
  });

  it('a card that came in after the analyst ended the turn goes through at the resolve, on the standing AOG approval (the boat)', () => {
    let s = island();
    const job = jobThatFinds(s);
    s = ok(complete(s, job));
    s = ok(apply(s, { t: 'endTurn', role: 'fin', week: s.week }, NOW));
    const ac = islandAircraft(s.seed, CARGO);
    s = ok(apply(s, { t: 'complete', role: 'mech', orderId: step(s).id, score: 0.9, perfect: false, data: { chain: { outcome: 'pn', pn: rightPn(ac, '32-40', s.chain!.tag) } }, week: s.week }, NOW + 60_000));
    const card = step(s);
    const cash = s.cash;
    for (const r of ['mech', 'elec'] as const) s = apply(s, { t: 'endTurn', role: r, week: s.week }, NOW + 120_000).s;
    expect(s.chain!.step).toBe('install');
    expect(lines(s).some((l) => l === `Cy had ended the turn when the part for Cargo C-7 came in: it went through on the standing AOG approval ($${(card.cost + ECON.boatKit).toLocaleString('en-US')}).`)).toBe(true);
    expect(s.history.at(-1)!.cashEnd).toBeLessThan(cash);
  });

  it('a card the analyst deferred waits (a deferral is a decision)', () => {
    const { s: s0 } = carded();
    const card = step(s0);
    let s = ok(apply(s0, { t: 'defer', orderId: card.id, reason: 'cash', week: s0.week }, NOW));
    s = endAll(s);
    expect(s.chain!.step).toBe('buy');
    expect(lines(s).some((l) => /standing AOG approval/.test(l))).toBe(false);
  });
});

describe('receiving: no tag, no install', () => {
  it('a part that comes without its 8130-3 sits a week in quarantine, then goes on when the vendor sends the paperwork', () => {
    const was = CHAIN.noPaperwork;
    CHAIN.noPaperwork = 1;
    try {
      const { s: s0 } = carded();
      const card = step(s0);
      let s = ok(apply(s0, { t: 'approve', orderId: card.id, week: s0.week, ship: 'boat' }, NOW));
      s = endAll(s);
      expect(s.chain!.step).toBe('transit');
      expect(s.chain!.hold).toBe(s.week);
      expect(lines(s).some((l) => /^Receiving on Cargo C-7: P\/N \S+ came without its 8130-3\. No tag, no install: it's in quarantine until the vendor sends the paperwork \(next week\)\.$/.test(l))).toBe(true);
      s = endAll(s);
      expect(s.chain!.step).toBe('install');
      expect(s.chain!.hold).toBeUndefined();
      expect(lines(s).some((l) => /the vendor's 8130-3 came, matches the PO/.test(l))).toBe(true);
      // paid once: no second boat for the paperwork
      expect(s.chain!.spent).toBe(card.cost + ECON.boatKit);
    } finally {
      CHAIN.noPaperwork = was;
    }
  });

  it('the usual part: the receiving line reads its paperwork', () => {
    const was = CHAIN.noPaperwork;
    CHAIN.noPaperwork = 0;
    try {
      const { s: s0 } = carded();
      let s = ok(apply(s0, { t: 'approve', orderId: step(s0).id, week: s0.week, ship: 'boat' }, NOW));
      s = endAll(s);
      expect(lines(s).some((l) => /^Receiving on Cargo C-7: P\/N \S+ \(.+\), 8130-3 in the box, matches the PO\. Ana, install it and finish Tire and brake\.$/.test(l))).toBe(true);
    } finally {
      CHAIN.noPaperwork = was;
    }
  });
});

describe("the chain's paperwork at the edges", () => {
  it('a grid outage caps hangar jobs, not the IPC lookup (paperwork needs no hangar tools)', () => {
    let s = island();
    const job = jobThatFinds(s);
    // the grid goes down (and no generator carries the hangar)
    const g = s.assets.find((a) => a.kind === 'grid')!;
    g.health = 5;
    s.assets = s.assets.filter((a) => a.kind !== 'generator');
    // the job that finds the part is the turn's one hangar job
    s = ok(complete(s, job));
    const other: Order = { id: 'other', role: 'mech', kind: 'oil', assetId: 'p1', title: 'Oil change', puzzle: 'torque', tier: 1, cost: 120, parts: 0, gain: 5, createdWeek: 5, deferrals: 0, lastDeferredWeek: null, status: 'ready', seed: 99 };
    s.orders.push(other);
    expect(complete(s, other).error).toBe('Grid down: hangar tools offline, 1 order max.');
    // the lookup and the research are paperwork: they go through
    s = ok(complete(s, step(s), { chain: { outcome: 'notipc' } }));
    expect(s.chain!.step).toBe('research');
    s = ok(complete(s, step(s), { chain: { route: 'eng', verdict: 'returned', reason: 'Entry cited does not support the request.' } }));
    expect(s.chain!.step).toBe('fee');
    expect(s.turns.mech).toMatchObject({ done: 3, paper: 2 });
    // and the cap still stands for the hangar
    expect(complete(s, other).error).toBe('Grid down: hangar tools offline, 1 order max.');
  });

  it("a botched lend-a-hand on the chain's paperwork damages nothing (it's paper)", () => {
    let s = island();
    const job = jobThatFinds(s);
    s = ok(complete(s, job));
    const look = step(s);
    look.deferrals = 1;
    const health = s.assets.find((a) => a.id === 'p2')!.health;
    s = ok(complete(s, look, { chain: { outcome: 'notipc' } }, 0.3, 'elec', true));
    expect(s.assets.find((a) => a.id === 'p2')!.health).toBe(health);
    expect(s.feed.at(-1)!.text).toMatch(/^Ben tried Look up the brake linings in the IPC: .*: 30%, botched\. Still open\.$/);
    expect(step(s).status).toBe('ready');
  });

  it('a blind lookup gets its provisional XP settled when the week resolves, like any blind sign-off', () => {
    let s = island();
    s.tier = 3;
    const job = jobThatFinds(s);
    s = ok(complete(s, job));
    const look = step(s);
    look.tier = 3;
    const ac = islandAircraft(s.seed, CARGO);
    s = ok(complete(s, look, { chain: { outcome: 'pn', pn: rightPn(ac, '32-40', s.chain!.tag) } }, 1));
    const r = s.orders.find((o) => o.id === look.id)!.result!;
    expect(r).toMatchObject({ blind: true, provisional: DEFECT.provisional });
    const before = s.players.mech!.xp;
    s = endAll(s);
    // the rest of the XP comes at the resolve; the order has no gain, so no asset health moves
    expect(s.players.mech!.xp).toBeGreaterThan(before);
  });
});

describe('how often the chain goes to the logbooks', () => {
  it('an altered plane\'s trouble is mostly on its altered assembly: about 35-50% of the chains are "not in the IPC"', () => {
    let chains = 0;
    let research = 0;
    for (let seed = 1; seed <= 600; seed++) {
      const s = island(seed);
      const o: Order = { id: `x${seed}`, role: 'mech', kind: 'tires', assetId: 'p2', title: 'Job', puzzle: 'torque', tier: 2, cost: 300, parts: 0, gain: 10, createdWeek: 5, deferrals: 0, lastDeferredWeek: null, status: 'ready', seed: 0 };
      // one job per catalog ATA on the cargo plane, as a season would bring them
      for (const kind of ['tires', 'prop', 'avionics', 'alternator']) {
        o.kind = kind;
        o.seed = hashSeed('share', seed, kind);
        if (!chainWouldOpen(s, o, 'mech')) continue;
        chains++;
        const p = plantFor(seed, 'p2', 'cargo');
        const ata = CHAIN.kinds[kind];
        if (p.plant === ata && p.via !== 'pma') research++;
      }
    }
    expect(chains).toBeGreaterThan(200);
    expect(research / chains).toBeGreaterThan(0.33);
    expect(research / chains).toBeLessThan(0.55);
  });
});
