// Stock and purchasing (docs/JOBFLOW.md 9, 14.2): receiving by carrier, the
// paperwork, supersession and receiving's judge; the eta rule; inventory
// position and the allocation; replenishment, bins, the carrying charge,
// commitments and the payment run; scrap and store credit; and the analyst's
// analytics on hand-built ledgers.
import { describe, expect, it } from 'vitest';
import { raiseAlert, SYMPTOMS } from '../src/sim/alerts';
import { FREIGHT, STOCK, SUPPLIERS } from '../src/sim/data';
import { apply, createIsland } from '../src/sim/engine';
import { fixTaskFor, stdPickFor } from '../src/sim/flow';
import { allItems, famOf, itemById, priceAt } from '../src/sim/items';
import { committed, payable, spendable } from '../src/sim/ledger';
import { rng } from '../src/sim/rng';
import {
  addStarter,
  auctionLot,
  available,
  binsInUse,
  binsTotal,
  carryCost,
  etaOf,
  families,
  insuranceSpare,
  invoiceContext,
  invValue,
  moveClass,
  needs,
  newReq,
  onHand,
  payRun,
  placePo,
  position,
  receive,
  replenish,
  reservedFor,
  schedFreight,
  scrapItem,
  stockFlags,
  suggestRop,
  velocity,
} from '../src/sim/stock';
import { ROLES, type Action, type Alert, type Asset, type IslandState, type Order, type WeekReport } from '../src/sim/types';

const NOW = Date.UTC(2026, 8, 26, 10);
const CARGO: Asset = { id: 'p2', kind: 'plane', model: 'cargo', name: 'Cargo C-7', health: 70, touchedWeek: 5, sinceInspection: 0 };

/** a started tier-2 island in week 5: the twin, the cargo plane, two cottages and the grid, the starter shelf, no work open */
function island(seed = 42): IslandState {
  let s = createIsland({ id: `st${seed}`, name: 'Stock Isle', now: NOW, tz: 'Europe/Paris', seed, creator: { uid: 'a', name: 'Ana', role: 'mech' } });
  s = apply(s, { t: 'join', uid: 'b', name: 'Ben', role: 'elec' }, NOW).s;
  s = apply(s, { t: 'join', uid: 'c', name: 'Cy', role: 'fin' }, NOW).s;
  for (const r of ROLES) s = apply(s, { t: 'week0Done', role: r }, NOW).s;
  s.week = 5;
  s.tier = 2;
  s.cash = 20000;
  s.assets.push({ ...CARGO });
  addStarter(s, 2);
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
function plan(s: IslandState, al: Alert, pick?: { item: string; qty: number }[]): { s: IslandState; o: Order } {
  const task = fixTaskFor(s, al)!;
  const next = ok(s, { t: 'plan', role: al.role, alert: al.id, task: task.id, pick: pick ?? stdPickFor(s, al, task), week: s.week });
  return { s: next, o: next.orders.find((o) => o.flow?.alert === al.id && o.status !== 'cancelled')! };
}
const orderOf = (s: IslandState, id: string) => s.orders.find((o) => o.id === id)!;
const said: string[] = [];
const line = (_r: unknown, _t: unknown, text: string) => void said.push(text);
const FLEW = { guest: 3, cargo: 2 };
const poOf = (s: IslandState, item: string) => s.pos!.find((p) => p.lines.some((l) => l.item === item))!;

describe('receiving (9.4)', () => {
  it('each carrier: small lines on any flight, bulk on the cargo plane (a guest hold without one), building materials on the supply boat', () => {
    const s = island();
    placePo(s, [{ item: 'AN900-10', qty: 25 }, { item: 'MIL-PRF-5606', qty: 12 }, { item: 'BLD-FTG', qty: 1 }], {}, 'fin', 0);
    expect(s.pos!.map((p) => p.carrier).sort()).toEqual(['any', 'boat', 'bulk']);
    const before = onHand(s, 'AN900-10');
    said.length = 0;
    // nothing flew: the boat still runs; the rest wait a week
    receive(s, 5, { guest: 0, cargo: 0 }, line);
    expect(poOf(s, 'BLD-FTG')).toMatchObject({ status: 'received', got: 5 });
    expect(poOf(s, 'AN900-10')).toMatchObject({ status: 'open', eta: 6 });
    expect(poOf(s, 'MIL-PRF-5606')).toMatchObject({ status: 'open', eta: 6 });
    expect(said.filter((t) => / waits a week: no (cargo )?flight carried it\. It comes week 6\.$/.test(t))).toHaveLength(2);
    // guest flights only: the small lines come, bulk waits for the cargo plane
    receive(s, 6, { guest: 3, cargo: 0 }, line);
    expect(poOf(s, 'AN900-10')).toMatchObject({ status: 'received', got: 6 });
    expect(onHand(s, 'AN900-10')).toBe(before + 25);
    expect(poOf(s, 'MIL-PRF-5606')).toMatchObject({ status: 'open', eta: 7 });
    receive(s, 7, { guest: 0, cargo: 1 }, line);
    expect(poOf(s, 'MIL-PRF-5606')).toMatchObject({ status: 'received', got: 7 });
    // no cargo plane on the island (tier 1): a guest flight's hold carries bulk
    const t = island();
    t.assets = t.assets.filter((a) => a.id !== 'p2');
    placePo(t, [{ item: 'MIL-PRF-5606', qty: 12 }], {}, 'fin', 0);
    receive(t, 5, { guest: 1, cargo: 0 }, line);
    expect(poOf(t, 'MIL-PRF-5606').status).toBe('received');
  });

  it('a PO a grounding job waits on takes the AOG boat when no flight carries it', () => {
    let s = island();
    const al = raise(s, 'M_WHEEL_CORROSION', 0, 'p2', 5);
    const r = plan(s, al);
    s = ok(r.s, { t: 'approve', orderId: r.o.id, freight: undefined, week: 5 } as Action);
    const p = s.pos!.find((x) => x.lines.some((l) => l.order === r.o.id))!;
    expect(p).toMatchObject({ freight: 'sched', eta: 5 });
    const cost = p.cost;
    said.length = 0;
    const sched = p.freightCost;
    receive(s, 5, { guest: 0, cargo: 0 }, line);
    // the boat is the island leg on top of the mainland shipment already charged
    expect(p).toMatchObject({ status: 'received', freight: 'aog', freightCost: sched + 350 });
    expect(p.cost).toBe(cost + 350);
    expect(said.some((t) => /and a job it serves grounds its asset: the AOG boat brought it \(\$350\)\.$/.test(t))).toBe(true);
    expect(orderOf(s, r.o.id).status).toBe('ready');
  });

  it('nothing flew at all: a mainland boat brings one job’s PO (safety work first) at the AOG price; the rest wait, in one line', () => {
    let s = island();
    const belt = raise(s, 'M_BELT_SQUEAL', 0, 'p1');
    const r1 = plan(s, belt);
    s = ok(r1.s, { t: 'approve', orderId: r1.o.id, week: 5 });
    const corr = raise(s, 'M_WHEEL_CORROSION', 0, 'p2', 7);
    const r2 = plan(s, corr);
    s = ok(r2.s, { t: 'approve', orderId: r2.o.id, week: 5 });
    placePo(s, [{ item: 'AN900-10', qty: 25 }], {}, 'fin', 0);
    const jobPo = (id: string) => s.pos!.find((p) => p.lines.some((l) => l.order === id))!;
    const cost = jobPo(r2.o.id).cost;
    said.length = 0;
    receive(s, 5, { guest: 0, cargo: 0 }, line);
    expect(jobPo(r2.o.id)).toMatchObject({ status: 'received', freight: 'aog', freightCost: 350 });
    expect(jobPo(r2.o.id).cost).toBe(cost + 350);
    expect(said).toContain(`Nothing flew this week: a mainland boat brought ${jobPo(r2.o.id).id} for Wheel-half corrosion and penetrant on Cargo C-7 ($350).`);
    expect(jobPo(r1.o.id)).toMatchObject({ status: 'open', eta: 6 });
    expect(said.filter((t) => / wait a week: no flight carried them\. They come week 6\.$/.test(t))).toHaveLength(1);
  });

  it('the eta rule: a lead-1 line bought this week lands at this week’s resolve, a lead-2 line the next; the broker adds a week', () => {
    const s = island();
    const lead1 = itemById('HA-B38')!;
    const lead2 = itemById('LOT-DIST')!;
    expect(lead1.lead).toBe(1);
    expect(lead2.lead).toBe(2);
    expect(etaOf(5, lead1, 'oem')).toBe(5);
    expect(etaOf(5, lead2, 'supply')).toBe(6);
    expect(etaOf(5, lead1, 'broker')).toBe(6);
    const [a] = placePo(s, [{ item: 'HA-B38', qty: 1 }], {}, 'fin', 0);
    const [b] = placePo(s, [{ item: 'LOT-DIST', qty: 1 }], {}, 'fin', 0);
    const [c] = placePo(s, [{ item: 'HA-B38', qty: 1 }], { vendor: 'broker' }, 'fin', 0);
    const [d] = placePo(s, [{ item: 'HA-B38', qty: 1 }], { freight: 'aog' }, 'fin', 0);
    expect([a.eta, b.eta, c.eta, d.eta]).toEqual([5, 6, 6, 5]);
    expect(d).toMatchObject({ freight: 'aog', freightCost: 350 });
    // a replenishment placed at the resolve (after receiving) lands at the next one
    s.inv!['AN900-10'] = { on: 0, rop: 5, max: 25 };
    const e = replenish(s, 5, line).find((p) => p.lines.some((l) => l.item === 'AN900-10'))!;
    expect(e).toMatchObject({ by: 'auto', eta: 6 });
  });

  it('paperwork: the broker’s parts wait a week about one time in four; the OEM’s consumables and the electrician’s materials never do', () => {
    const s = island();
    for (let i = 0; i < 30; i++) placePo(s, [{ item: 'AN900-10', qty: 25 }, { item: 'KR15-TR', qty: 10 }], {}, 'fin', 0);
    receive(s, 5, FLEW, line);
    expect(s.pos!.every((p) => p.status === 'received')).toBe(true);
    const t = island();
    const part = allItems().find((x) => x.trade === 'mech' && x.kind === 'part' && !x.supsdBy && x.lead === 1 && x.price < 100)!.id;
    for (let i = 0; i < 200; i++) placePo(t, [{ item: part, qty: 1 }], { vendor: 'broker' }, 'fin', 0);
    said.length = 0;
    receive(t, 6, FLEW, line);
    const held = t.pos!.filter((p) => p.status === 'held');
    expect(held.length / 200).toBeGreaterThan(0.15);
    expect(held.length / 200).toBeLessThan(0.35);
    const h = held[0];
    expect(h.hold).toBe(7);
    expect(h.lines[0].hold).toBe(SUPPLIERS.broker.doc!.part);
    expect(h.notes!.some((n) => /^held: no traceability/.test(n))).toBe(true);
    expect(said.some((x) => /^Receiving: the broker's .+ has no traceability paperwork: quarantined until the vendor sends it \(next week\)\.$/.test(x))).toBe(true);
    const on = onHand(t, part);
    receive(t, 7, { guest: 0, cargo: 0 }, line);
    expect(h).toMatchObject({ status: 'received', got: 7 });
    expect(onHand(t, part)).toBe(on + held.length);
  });

  it('supersession: INTCHG 1 and 2 ship as the new P/N (a job’s pick follows); INTCHG 3 ships as ordered', () => {
    let s = island();
    // a slow gear on the twin, planned with the old filter element's P/N
    const al = raise(s, 'M_GEAR_SLOW', 0, 'p1');
    const std = stdPickFor(s, al, fixTaskFor(s, al)!);
    expect(std.some((l) => l.item === 'DH-1940-11')).toBe(true);
    s.inv!['T-N2'] = { on: 1 };
    const r = plan(s, al, std.map((l) => (l.item === 'DH-1940-11' ? { ...l, item: 'DH-1940-10' } : l)));
    s = ok(r.s, { t: 'approve', orderId: r.o.id, week: 5 });
    placePo(s, [{ item: 'B-19413-1', qty: 6 }, { item: '066-19500', qty: 4 }], {}, 'fin', 0);
    const onOld = onHand(s, '066-19500');
    receive(s, 5, FLEW, line, () => ({ ok: true, text: '' }));
    const o = orderOf(s, r.o.id);
    expect(o.flow!.pick.some((l) => l.item === 'DH-1940-11')).toBe(true);
    expect(o.flow!.pick.some((l) => l.item === 'DH-1940-10')).toBe(false);
    expect(reservedFor(s, o.id, 'DH-1940-11')).toBe(1);
    expect(poOf(s, 'DH-1940-10').notes).toContain('shipped as DH-1940-11 (supersedes DH-1940-10, INTCHG 1)');
    expect(onHand(s, 'B-19413-3')).toBe(6);
    expect(onHand(s, 'B-19413-1')).toBe(0);
    expect(poOf(s, 'B-19413-1').notes).toContain('shipped as B-19413-3 (supersedes B-19413-1, INTCHG 2)');
    expect(onHand(s, '066-19500')).toBe(onOld + 4);
  });

  it('supersession with part of a pick already reserved: the old P/N on the shelf stays reserved, what came joins it as the new P/N', () => {
    let s = island();
    s.inv!['B-19413-1'] = { on: 2 };
    s.inv!['B-19413-3'] = { on: 0 };
    const al = raise(s, 'M_PROP_VIB', 0, 'p1');
    const r = plan(s, al, [{ item: 'B-19413-1', qty: 6, slot: 'propBolt' } as { item: string; qty: number }]);
    s = r.s;
    expect(reservedFor(s, r.o.id, 'B-19413-1')).toBe(2);
    if (orderOf(s, r.o.id).status === 'pending') s = ok(s, { t: 'approve', orderId: r.o.id, week: 5 });
    const po = s.pos!.find((p) => p.lines.some((l) => l.order === r.o.id && l.item === 'B-19413-1'))!;
    expect(po.lines.find((l) => l.item === 'B-19413-1')!.qty).toBe(4);
    receive(s, 5, FLEW, line, () => ({ ok: true, text: '' }));
    const o = orderOf(s, r.o.id);
    // 2 old bolts held + 4 new ones that came: the job is whole, and consume takes 6
    expect(o.flow!.pick.filter((l) => l.item === 'B-19413-1').reduce((n, l) => n + l.qty, 0)).toBe(2);
    expect(o.flow!.pick.filter((l) => l.item === 'B-19413-3').reduce((n, l) => n + l.qty, 0)).toBe(4);
    expect(reservedFor(s, o.id, 'B-19413-1')).toBe(2);
    expect(reservedFor(s, o.id, 'B-19413-3')).toBe(4);
    expect(o.status).toBe('ready');
    expect(po.notes).toContain('shipped as B-19413-3 (supersedes B-19413-1, INTCHG 2)');
  });

  it('against the work order: a wrong or unlisted part goes back (credit less restocking) and stops the job; displaced opens research; not effective passes', () => {
    const cases = [
      { why: 'wrong', back: true },
      { why: 'unlisted', back: true },
      { why: 'displaced', back: true },
      { why: 'noteff', back: false },
    ];
    for (const c of cases) {
      let s = island();
      const al = raise(s, 'M_BELT_SQUEAL', 0, 'p1');
      const r = plan(s, al);
      s = ok(r.s, { t: 'approve', orderId: r.o.id, week: 5 });
      const p = s.pos!.find((x) => x.lines.some((l) => l.order === r.o.id))!;
      const value = p.lines[0].qty * p.lines[0].unit;
      receive(s, 5, FLEW, line, () => ({ ok: false, why: c.why, text: `${c.why}: not this airplane's belt` }));
      const o = orderOf(s, r.o.id);
      if (c.back) {
        expect(p.lines[0], c.why).toMatchObject({ back: `${c.why}: not this airplane's belt`, got: 0 });
        expect(p.refund).toBe(Math.round((value - Math.max(STOCK.restockMin, value * STOCK.restock)) * 100) / 100);
        expect(o.status).toBe('waiting_part');
        expect(o.flow!.stop).toBe(`Sent back at receiving: ${c.why}: not this airplane's belt`);
        expect(!!o.flow!.stopResearch).toBe(c.why === 'displaced');
        expect(onHand(s, 'HA-B38')).toBe(0);
      } else {
        expect(p.lines[0].back, c.why).toBeUndefined();
        expect(o.status).toBe('ready');
        expect(reservedFor(s, o.id, 'HA-B38')).toBe(1);
      }
    }
  });

  it('the engine’s own judge at the resolve: the cargo plane’s linings bought for the twin go back', () => {
    let s = island();
    const al = raise(s, 'M_BRAKE_CHATTER', 0, 'p1');
    const std = stdPickFor(s, al, fixTaskFor(s, al)!);
    const lining = std.find((l) => itemById(l.item)?.slot === 'lining')!.item;
    const cargoLining = Object.keys(s.inv!).find((id) => itemById(id)?.slot === 'lining' && itemById(id)?.models?.includes('cargo') && !itemById(id)?.models?.includes('twin'))!;
    delete s.inv![cargoLining];
    const r = plan(s, al, std.map((l) => (l.item === lining ? { ...l, item: cargoLining } : l)));
    s = ok(r.s, { t: 'approve', orderId: r.o.id, week: 5 });
    for (const role of ROLES) s = ok(s, { t: 'endTurn', role, week: 5 });
    const o = orderOf(s, r.o.id);
    expect(o.status).toBe('waiting_part');
    expect(o.flow!.stop).toMatch(/^Sent back at receiving: /);
    const h = s.history.find((x) => x.week === 5)!;
    expect(h.lines.some((l) => /^Receiving on Twin N-12: .+\. Returned: \$[\d,]+ credited at the payment run \(\$[\d,]+ restocking\)\. Repick it\.$/.test(l.text))).toBe(true);
  });
});

describe('inventory position and the allocation (9.1, 9.3)', () => {
  it('position = on hand − reserved + on order for no job − demand not yet ordered; a reservation counts once', () => {
    let s = island();
    const item = 'AN900-10';
    s.inv![item] = { on: 25, rop: 5, max: 25 };
    expect(position(s, item)).toBe(25);
    // a job with 8 in its pick, 5 reserved: 3 on its card to buy
    s.inv!['MS20995C32'] = { on: 0 };
    s.autoSpent.mech = s.autoBudget.mech;
    const al = raise(s, 'M_BRAKE_CHATTER', 0, 'p1');
    const std = stdPickFor(s, al, fixTaskFor(s, al)!);
    const r = plan(s, al, [...std, { item, qty: 30 }]);
    s = r.s;
    expect(orderOf(s, r.o.id).status).toBe('pending');
    expect(reservedFor(s, r.o.id, item)).toBe(25);
    // 25 reserved, 5 on the card to buy: the job's 30 counted once
    expect(position(s, item)).toBe(0 - 5);
    // a PO line bought for a job is never free supply; a free one is
    placePo(s, [{ item, qty: 25, order: r.o.id }], {}, 'fin', 0);
    expect(position(s, item)).toBe(-5);
    placePo(s, [{ item, qty: 25 }], {}, 'auto', 0);
    expect(position(s, item)).toBe(20);
    // an open requisition is demand
    newReq(s, { at: 0, role: 'mech', item, qty: 3 });
    expect(position(s, item)).toBe(17);
  });

  it('a replenishment that lands fills a waiting job’s requisition: no second purchase', () => {
    let s = island();
    // the belt is on order for the job; then the tech adds two crush gaskets nobody has
    const al = raise(s, 'M_BELT_SQUEAL', 0, 'p1');
    const r = plan(s, al);
    s = ok(r.s, { t: 'approve', orderId: r.o.id, week: 5 });
    s.inv!['AN900-10'] = { on: 0, rop: 5, max: 25 };
    s = ok(s, { t: 'repick', role: 'mech', order: r.o.id, pick: [...r.o.flow!.pick, { item: 'AN900-10', qty: 2 }], week: 5 });
    const req = s.reqs!.find((q) => q.order === r.o.id && q.item === 'AN900-10')!;
    expect(req).toMatchObject({ status: 'open', qty: 2 });
    expect(orderOf(s, r.o.id).status).toBe('waiting_part');
    // the standing policy orders the line up to max, and it lands before anyone approves the requisition
    // up to max from a position of -2 (the open requisition), in whole boxes of 25
    expect(position(s, 'AN900-10')).toBe(-2);
    const rep = replenish(s, 5, line).find((p) => p.lines.some((l) => l.item === 'AN900-10'))!;
    expect(rep.lines.find((l) => l.item === 'AN900-10')).toMatchObject({ qty: 50 });
    expect(position(s, 'AN900-10')).toBe(48);
    rep.eta = 5;
    receive(s, 5, FLEW, line, () => ({ ok: true, text: '' }));
    expect(s.reqs!.find((q) => q.id === req.id)).toMatchObject({ status: 'filled', closed: 5 });
    expect(reservedFor(s, r.o.id, 'AN900-10')).toBe(2);
    expect(orderOf(s, r.o.id).status).toBe('ready');
    expect(s.pos!.filter((p) => p.lines.some((l) => l.item === 'AN900-10'))).toHaveLength(1);
    expect(replenish(s, 5, line)).toHaveLength(0);
  });

  it('stock that lands goes to safety work first, then the oldest job', () => {
    let s = island();
    const chat = raise(s, 'M_BRAKE_CHATTER', 0, 'p1');
    const lining = stdPickFor(s, chat, fixTaskFor(s, chat)!).find((l) => itemById(l.item)?.slot === 'lining')!.item;
    s.inv![lining].on = 0;
    // the chattering brakes first (not airworthiness), then a soft pedal (airworthiness): both wait for linings
    const r1 = plan(s, chat);
    s = r1.s;
    const soft = raise(s, 'M_BRAKE_SOFT', 1, 'p1', 7);
    const r2 = plan(s, soft);
    s = r2.s;
    expect(orderOf(s, r1.o.id).status).toBe('pending');
    expect(orderOf(s, r2.o.id).status).toBe('pending');
    placePo(s, [{ item: lining, qty: 4 }], {}, 'auto', 0);
    receive(s, 5, FLEW, line);
    expect(reservedFor(s, r2.o.id, lining)).toBe(4);
    expect(reservedFor(s, r1.o.id, lining)).toBe(0);
    placePo(s, [{ item: lining, qty: 4 }], {}, 'auto', 0);
    receive(s, 5, FLEW, line);
    expect(reservedFor(s, r1.o.id, lining)).toBe(4);
  });
});

describe('replenishment, bins, the carrying charge, commitments and payment (9.5-9.8)', () => {
  it('replenishment orders up to max at or under the reorder point, whole packs, and is skipped under the freeze', () => {
    const s = island();
    s.inv!['AN900-10'] = { on: 4, rop: 5, max: 30 };
    const x = itemById('AN900-10')!;
    const p = replenish(s, 5, line).find((po) => po.lines.some((l) => l.item === 'AN900-10'))!;
    expect(p.lines.find((l) => l.item === 'AN900-10')).toMatchObject({ qty: Math.ceil(26 / x.pack) * x.pack });
    expect(p).toMatchObject({ by: 'auto', freight: 'sched', status: 'open' });
    const t = island();
    t.inv!['AN900-10'] = { on: 4, rop: 5, max: 30 };
    t.cash = 1500;
    said.length = 0;
    expect(replenish(t, 5, line)).toHaveLength(0);
    expect(said.some((x2) => /^Replenishment skipped: spendable cash under \$2,000 \(\d+ lines? at their reorder point\)\.$/.test(x2))).toBe(true);
  });

  it('units back from a job always go on the shelf, even past the last bin; buys wait until it is back under', () => {
    let s = island();
    // a job holds every unit of an item no bin holds
    s.inv!['AN900-10'] = { on: 2 };
    const al = raise(s, 'M_OIL_DUE', 0, 'p1');
    const r = plan(s, al);
    s = r.s;
    expect(reservedFor(s, r.o.id, 'AN900-10')).toBe(2);
    const fresh = allItems().filter((x) => x.trade === 'mech' && x.kind === 'consumable' && !s.inv![x.id]).map((x) => x.id);
    let i = 0;
    while (binsInUse(s) < binsTotal(s)) s.inv![fresh[i++]] = { on: 1 };
    expect(binsInUse(s)).toBe(binsTotal(s));
    s = ok(s, { t: 'dropJob', role: 'mech', order: r.o.id, week: 5 });
    expect(binsInUse(s)).toBeGreaterThan(binsTotal(s));
    expect(apply(s, { t: 'buy', lines: [{ item: fresh[i], qty: 1 }], week: 5 }, ++clock).error).toMatch(/^Stores full: /);
  });

  it('the carrying charge is 0.1% of the stock’s value a week, booked at the resolve', () => {
    let s = island();
    expect(carryCost(s)).toBe(Math.round(STOCK.carry * invValue(s)));
    expect(carryCost(s)).toBeGreaterThan(0);
    for (const role of ROLES) s = ok(s, { t: 'endTurn', role, week: 5 });
    expect(s.history.at(-1)!.costs.carry).toBeGreaterThan(0);
    expect(s.ledger!.find((l) => l.w === 5)!.sp.carry).toBe(s.history.at(-1)!.costs.carry);
  });

  it('committed until paid; paid at the payment run after it lands (net 7), less what went back and what the match caught; store credit first', () => {
    const s = island();
    s.credit = 5;
    const [p] = placePo(s, [{ item: 'AN900-10', qty: 25 }], {}, 'fin', 0);
    expect(p.cost).toBeGreaterThan(10);
    expect(committed(s)).toBe(Math.round(p.cost - 5));
    expect(spendable(s)).toBe(s.cash - committed(s));
    receive(s, 5, FLEW, line);
    expect(p).toMatchObject({ status: 'received', got: 5 });
    expect(payable(s)).toBe(Math.round(p.cost));
    const cash0 = s.cash;
    payRun(s, 5, line);
    expect(p.status).toBe('received');
    expect(s.cash).toBe(cash0);
    p.caught = 10;
    const r = payRun(s, 6, line);
    expect(p).toMatchObject({ status: 'paid', paid: 6 });
    expect(r.cash).toBe(Math.round(p.cost - 10 - 5));
    expect(s.cash).toBeCloseTo(cash0 - (p.cost - 10 - 5), 2);
    expect(s.credit).toBe(0);
    expect(committed(s)).toBe(0);
    const row = s.ledger!.find((l) => l.w === s.week)!;
    expect(row.cr).toBe(5);
    // the lines to their category, the shipment's freight to freight, what the match caught off the parts
    expect(row.sp.consumables).toBeCloseTo(p.cost - p.freightCost, 2);
    expect(row.sp.freight).toBe(p.freightCost);
    expect(row.sp.parts).toBe(-10);
  });

  it('scheduled freight is per shipment: the first PO of a supplier and carrier pays it, the next one landing the same week rides free', () => {
    const s = island();
    const [a] = placePo(s, [{ item: 'AN900-10', qty: 25 }], {}, 'fin', 0);
    expect(a).toMatchObject({ freight: 'sched', eta: 5, freightCost: FREIGHT.sched.mech });
    expect(a.cost).toBe(Math.round((a.lines[0].qty * a.lines[0].unit + FREIGHT.sched.mech) * 100) / 100);
    const [b] = placePo(s, [{ item: 'MS24665-302', qty: 1 }], {}, 'fin', 0);
    expect(b.freightCost).toBe(0);
    expect(b.notes).toContain(`rides with ${a.id}'s shipment: no extra freight`);
    // another carrier (bulk rides the cargo flight) is its own shipment, and so is the electrical supplier's
    const [c] = placePo(s, [{ item: 'MIL-PRF-5606', qty: 12 }], {}, 'fin', 0);
    expect(c).toMatchObject({ carrier: 'bulk', freightCost: FREIGHT.sched.mech });
    const [d] = placePo(s, [{ item: 'KR20-TR', qty: 10 }], {}, 'fin', 0);
    expect(d.freightCost).toBe(FREIGHT.sched.elec);
    // the quote says the same before the buy
    expect(schedFreight(s, [{ item: 'AN900-10' }])).toMatchObject({ cost: 0, rides: a.id });
    expect(schedFreight(s, [{ item: 'AN900-10' }, { item: 'LOT-DIST' }]).cost).toBe(FREIGHT.sched.elec);
    // a broker's lot (its price is delivered) and the migration's POs carry none; the AOG boat is its own charge
    expect(placePo(s, [{ item: 'AN900-10', qty: 25 }], {}, 'fin', 0, { noFreight: true })[0].freightCost).toBe(0);
    expect(placePo(s, [{ item: 'LOT-DIST', qty: 1 }], { freight: 'aog' }, 'fin', 0)[0].freightCost).toBe(FREIGHT.aog);
    // a replenishment placed at the resolve lands next week: next week's buys ride with it
    const t = island();
    t.inv!['AN900-10'] = { ...t.inv!['AN900-10'], on: 0, rop: 5, max: 25 };
    const rep = replenish(t, 5, line).find((p) => p.lines.some((l) => l.item === 'AN900-10'))!;
    expect(rep).toMatchObject({ eta: 6, freightCost: FREIGHT.sched.mech });
    t.week = 6;
    expect(placePo(t, [{ item: 'MS24665-302', qty: 1 }], {}, 'fin', 0)[0].freightCost).toBe(0);
  });

  it('the three-way match: the overbilling rides on last week’s POs, and what the match finds comes off their payment', () => {
    for (const score of [1, 0.5, 0]) {
      let s = island();
      // week 5: $620 of prop bolts lands at the resolve
      const [p] = placePo(s, [{ item: 'B-19413-1', qty: 10 }], {}, 'fin', 0);
      for (const role of ROLES) s = ok(s, { t: 'endTurn', role, week: 5 });
      expect(s.week).toBe(6);
      const po = s.pos!.find((x) => x.id === p.id)!;
      expect(po).toMatchObject({ status: 'received', got: 5 });
      // week 6: the match (about 3% of the spend, plus a bad invoice now and then) is on that PO
      const task = s.orders.find((o) => o.kind === 'invoice' && o.createdWeek === 6)!;
      expect(task).toBeTruthy();
      expect(task.leak).toBeGreaterThanOrEqual(60);
      expect(po.over).toBe(task.leak);
      if (score > 0) s = ok(s, { t: 'complete', role: 'fin', orderId: task.id, score, perfect: score === 1, week: 6 });
      const cash0 = s.cash;
      for (const role of ROLES) s = ok(s, { t: 'endTurn', role, week: 6 });
      const after = s.pos!.find((x) => x.id === p.id)!;
      expect(after.status).toBe('paid');
      expect(after.caught ?? 0).toBe(Math.round(task.leak! * score));
      // what the vendor got: the PO less what the match caught (the rest of the overbilling is paid, booked to parts)
      const row = s.ledger!.find((l) => l.w === 6)!;
      expect(row.sp.parts ?? 0).toBeCloseTo(after.lines[0].qty * after.lines[0].unit + (after.over! - (after.caught ?? 0)), 2);
      // the invoice's overbilling isn't a separate leak: only the week's other hunts (skipped here) are
      const others = s.orders.filter((o) => o.role === 'fin' && o.createdWeek === 6 && o.kind !== 'invoice' && o.kind !== 'report' && o.leak).reduce((n, o) => n + (o.leak ?? 0), 0);
      expect(s.history.at(-1)!.costs.leak).toBe(others);
      expect(cash0).toBeGreaterThan(s.cash);
    }
  });

  it('scrap: a part goes back for 75% of its cost as store credit; a consumable is written off', () => {
    const s = island();
    s.inv!['HA-B38'] = { on: 2, avg: 40 };
    const a = scrapItem(s, 'HA-B38', 1);
    expect(a).toEqual({ credit: 30, loss: 10 });
    expect(s.credit).toBe(30);
    expect(onHand(s, 'HA-B38')).toBe(1);
    s.inv!['AN900-10'] = { on: 25, avg: 1.2 };
    const b = scrapItem(s, 'AN900-10', 5);
    expect(b).toEqual({ credit: 0, loss: 6 });
    expect(s.ledger!.find((l) => l.w === 5)!.loss).toBe(16);
  });
});

describe('the analyst’s analytics (14.2)', () => {
  /** an island at week 27 with 26 week reports and a ledger that used these items (units a week, oldest first) */
  function withLedger(uses: Record<string, number[]>, weeks = 26): IslandState {
    const s = island();
    s.week = weeks + 1;
    s.history = Array.from({ length: weeks }, (_, i) => ({ week: i + 1, tier: 2, revenue: 0, cashEnd: 0, costs: { fixed: 0, insurance: 0, leak: 0, incidents: 0, refunds: 0 } }) as unknown as WeekReport);
    s.ledger = Array.from({ length: weeks }, (_, i) => {
      const use: Record<string, number> = {};
      for (const [id, series] of Object.entries(uses)) if (series[i]) use[id] = series[i];
      return { w: i + 1, rev: 0, cash: 0, sp: {}, tr: {}, inv: 0, ...(Object.keys(use).length ? { use } : {}) };
    });
    for (const l of Object.values(s.inv!)) l.got = 1;
    return s;
  }
  const every = (n: number, q: number, weeks = 26) => Array.from({ length: weeks }, (_, i) => (i % n === 0 ? q : 0));

  it('velocity: a family’s use a week, its spread, the weeks used and the last one', () => {
    const s = withLedger({ 'AN900-10': every(2, 2) });
    const v = velocity(s, famOf('AN900-10'));
    expect(v.series).toHaveLength(26);
    expect(v.weeksUsed).toBe(13);
    expect(v.perWeek).toBe(1);
    expect(v.sd).toBe(1);
    expect(v.lastUsed).toBe(25);
    expect(v.onHand).toBe(onHand(s, 'AN900-10'));
  });

  it('classes: fast, steady and slow among the families used; dead with no use in 26 weeks; new under 8 weeks on the shelf; none under 8 weeks of ledger', () => {
    const s = withLedger({ 'AN900-10': every(1, 1), 'FH-G18': every(2, 4), 'MS24665-302': every(3, 1), 'MS28775-227': every(13, 1) });
    expect(moveClass(s, famOf('AN900-10'))).toBe('fast');
    expect(moveClass(s, famOf('MS28775-227'))).toBe('slow');
    const near = Object.keys(s.inv!).find((id) => itemById(id)?.slot === 'lining' && !families(s).some((f) => f.items.includes(id) && velocity(s, f.fam).weeksUsed > 0))!;
    expect(moveClass(s, famOf('SAE-J1899-50'))).toBe('dead');
    s.inv!['SAE-J1899-50'].got = 24;
    const t = { ...s };
    expect(moveClass(t, famOf('SAE-J1899-50'))).toBe('new');
    expect(near).toBeTruthy();
    expect(moveClass(withLedger({}, 6), famOf('AN900-10'))).toBeNull();
  });

  it('insurance spares: the airworthiness and hazard families of the island’s own planes and houses', () => {
    const s = island();
    expect(insuranceSpare(s, 'lining:twin')).toBe(true);
    expect(insuranceSpare(s, 'lining:float')).toBe(false);
    expect(insuranceSpare(s, 'radio')).toBe(true);
    expect(insuranceSpare(s, famOf('KG20-TR'))).toBe(true);
    expect(insuranceSpare(s, famOf('AN900-10'))).toBe(false);
    // a spa panel is install material with weeks of lead, bought for its take-off: not a spare, GFCI and all
    expect(insuranceSpare(s, famOf('SPA-60GF'))).toBe(false);
    // a relining's rivets go with the linings kept as a spare
    expect(insuranceSpare(s, famOf('105-00500'))).toBe(true);
  });

  it('suggestRop: lead × use + z × spread × √lead, and a max a pack (or two weeks’ use) over it; one job’s worth for an insurance spare', () => {
    const s = withLedger({ 'AN900-10': every(2, 2) });
    const x = itemById('AN900-10')!;
    const g = suggestRop(s, 'AN900-10');
    const L = x.lead;
    const rop = Math.ceil(1 * L + STOCK.z * 1 * Math.sqrt(L));
    expect(g.rop).toBe(rop);
    expect(g.max).toBe(rop + Math.max(x.pack > 1 && !x.cut ? x.pack : 1, Math.ceil(1 * STOCK.coverWeeks)));
    expect(g.why).toMatch(/: 26 used in 26 weeks, lead 1 week: keep \d+, order up to \d+\.$/);
    const t = withLedger({});
    const lining = Object.keys(t.inv!).find((id) => famOf(id) === 'lining:twin')!;
    const sp = suggestRop(t, lining);
    expect(sp.max).toBe(4);
    expect(sp.why).toMatch(/\(an insurance spare\)\.$/);
  });

  it('the flags: order (urgent when a job waits on it), stop for dead stock, a fast line with no min/max, bins nearly full, a held PO', () => {
    let s = withLedger({ 'AN900-10': every(1, 1) });
    delete s.inv!['AN900-10'].rop;
    delete s.inv!['AN900-10'].max;
    const flags = stockFlags(s);
    expect(flags.some((f) => f.kind === 'stop' && f.fam === famOf('SAE-J1899-50') && /^Stop stocking .+: no use in 26 weeks \(\$[\d,]+ on the shelf, a bin\)\.$/.test(f.text))).toBe(true);
    expect(flags.some((f) => f.kind === 'norop' && f.item === 'AN900-10')).toBe(true);
    // a job waits on the belt: the order flag is urgent and its act approves the card
    s = island();
    const al = raise(s, 'M_BELT_SQUEAL', 0, 'p1');
    const r = plan(s, al);
    s = r.s;
    const f = stockFlags(s).find((x) => x.item === 'HA-B38')!;
    expect(f).toMatchObject({ kind: 'order', urgent: true, act: { t: 'approve', orderId: r.o.id } });
    expect(stockFlags(s)[0].urgent).toBe(true);
    // the stores room nearly full
    const fresh = allItems().filter((x) => x.trade === 'mech' && x.kind === 'consumable' && !s.inv![x.id]).map((x) => x.id);
    let i = 0;
    while (binsInUse(s) < binsTotal(s) - 1) s.inv![fresh[i++]] = { on: 1 };
    expect(stockFlags({ ...s }).some((x) => x.kind === 'bins' && x.text === `Stores ${binsTotal(s) - 1}/${binsTotal(s)} bins: 1 free.`)).toBe(true);
  });

  it('no stop flag on a line something still wants: a forecast, an open job, a PO on its way; none on a never-used line before it is dead', () => {
    const stops = (x: IslandState) => stockFlags(x).filter((f) => f.kind === 'stop').map((f) => f.fam);
    const dead = famOf('SAE-J1899-50');
    const s = withLedger({});
    expect(stops(s)).toContain(dead);
    // a PO for the family on its way: it's still wanted
    const t = withLedger({});
    placePo(t, [{ item: 'SAE-J1899-50', qty: 1 }], {}, 'fin', 0);
    expect(stops(t)).not.toContain(dead);
    // a forecast: the family moved lately
    const u = withLedger({ 'SAE-J1899-50': [...Array(22).fill(0), 1, 1, 1, 0] });
    expect(stops(u)).not.toContain(dead);
    // never used, a min/max, 12 weeks of ledger: slow, not dead: too early to call
    const v = withLedger({}, 12);
    v.inv!['SAE-J1899-50'].rop = 1;
    expect(moveClass(v, dead)).toBe('slow');
    expect(stops(v)).not.toContain(dead);
  });

  it('needs: what nobody has planned, in plain words, no P/N', () => {
    const s = island();
    raise(s, 'M_BRAKE_SOFT', 1, 'p2', 5);
    raise(s, 'E_FLICKER', 0, 'h2', 7);
    const n = needs(s);
    expect(n).toHaveLength(2);
    expect(n[0]).toMatchObject({ trade: 'mech', asset: 'p2', due: 5, aw: true });
    expect(n[0].text).toMatch(/^Cargo C-7: .+, due wk 5 · Ana hasn't planned it$/);
    for (const x of n) expect(x.text).not.toMatch(/\d{3}-\d{4,5}|[A-Z]{2}\d{3,}/);
  });

  it('the broker’s lot is shop stock the island uses; the invoice match reads the POs received at the last resolve', () => {
    const s = withLedger({ 'AN900-10': every(1, 1), 'FH-G18': every(2, 2), 'MS24665-302': every(3, 2) });
    const lot = auctionLot(s, rng(7))!;
    expect(lot.lines.length).toBeGreaterThanOrEqual(2);
    for (const l of lot.lines) {
      const x = itemById(l.item)!;
      expect(['tool', 'lot', 'rotable']).not.toContain(x.kind);
      expect(x.trade).not.toBe('build');
      expect(priceAt(x)).toBeLessThanOrEqual(STOCK.lotMaxUnit);
    }
    // one trade's supplier: never a mix of the mechanic's and the electrician's stock
    for (let seed = 1; seed < 40; seed++) {
      const l = auctionLot(s, rng(seed));
      if (l) expect(new Set(l.lines.map((x) => itemById(x.item)!.trade)).size).toBe(1);
    }
    expect(lot.fair).toBeLessThan(lot.list);
    // nothing used and no min/max below its max: no lot
    const bare = island();
    for (const l of Object.values(bare.inv!)) {
      delete l.rop;
      delete l.max;
    }
    expect(auctionLot(bare, rng(7))).toBeNull();
    // the invoice match
    const t = island();
    expect(invoiceContext(t)).toBeUndefined();
    t.week = 4;
    placePo(t, [{ item: 'AN900-10', qty: 25 }], {}, 'fin', 0);
    receive(t, 4, FLEW, line);
    t.week = 5;
    const ctx = invoiceContext(t)!;
    expect(ctx.pos).toHaveLength(1);
    expect(ctx.pos[0].lines[0]).toMatchObject({ pn: 'AN900-10', qty: 25, got: 25 });
    expect(ctx.pos[0].vendor).toBe(SUPPLIERS.oem.name);
    expect(available(t, 'AN900-10')).toBeGreaterThanOrEqual(25);
  });
});
