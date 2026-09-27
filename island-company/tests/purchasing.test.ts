// The analyst's desk (docs/JOBFLOW.md 17.3, 21.3): the pure view model in
// src/ui/purchasing/model.ts (the approval card's lines and freight from A's
// cardOf, requisitions grouped by supplier and carrier, the planner's rows by
// family with their classes and flags, needs with no P/N, an item's sheet and a
// buy, receiving, the Money tab's numbers from a hand-built ledger), and the
// desk puzzles fed real items (the auction reads a lot, the three-way match
// reads the island's unpaid POs).
import { describe, expect, it, vi } from 'vitest';
import { detectIssue, generateInvoice, playInvoice, solveInvoice } from '../src/puzzles/invoice';
import { generateAuction, lotLine, lotMarket } from '../src/puzzles/auction';
import { raiseAlert, SYMPTOMS } from '../src/sim/alerts';
import { FREIGHT, STOCK } from '../src/sim/data';
import { apply, createIsland } from '../src/sim/engine';
import { cardOf, fixTaskFor, stdPickFor } from '../src/sim/flow';
import { allItems, itemById, priceAt } from '../src/sim/items';
import { committed } from '../src/sim/ledger';
import { addStarter, binsInUse, binsTotal, invoiceContext, invValue, newReq, placePo, receive } from '../src/sim/stock';
import { botTurn, simulate, TEAMS } from '../src/sim/bots';
import { rng } from '../src/sim/rng';
import {
  abcClasses,
  buyQuote,
  cardVM,
  deskCounts,
  famName,
  flagsVM,
  flowQueue,
  heldWords,
  itemVM,
  legacyQueue,
  moneyVM,
  needsVM,
  openingTab,
  plannerRows,
  receivingVM,
  reqActions,
  reqGroups,
  reqQueue,
  reqQuote,
  shortLabel,
  toolRows,
  catalogHits,
  deskTaskLine,
  carrierDown,
  melWords,
  payrollLines,
  splitWhole,
} from '../src/ui/purchasing/model';
import { ROLES, type Action, type Alert, type Asset, type IslandState, type Order, type WeekLedger, type WeekReport } from '../src/sim/types';

vi.setConfig({ testTimeout: 30000 });

const NOW = Date.UTC(2026, 8, 26, 10);
const CARGO: Asset = { id: 'p2', kind: 'plane', model: 'cargo', name: 'Cargo C-7', health: 70, touchedWeek: 5, sinceInspection: 0 };

/** a started tier-2 island in week 5: the twin, the cargo plane, two cottages and the grid, the starter shelf, no work open */
function island(seed = 42): IslandState {
  let s = createIsland({ id: `pu${seed}`, name: 'Desk Isle', now: NOW, tz: 'Europe/Paris', seed, creator: { uid: 'a', name: 'Ana', role: 'mech' } });
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
/** a plan whose main lines are not on the shelf: a card with lines to buy */
function cardFor(s: IslandState, sym: string, cause: number, assetId: string, due?: number): { s: IslandState; o: Order } {
  const al = raise(s, sym, cause, assetId, due);
  const task = fixTaskFor(s, al)!;
  const pick = stdPickFor(s, al, task);
  for (const l of pick) delete s.inv![l.item];
  return plan(s, al, pick);
}

describe('approval cards (8.6, 17.3)', () => {
  it('a card lists what comes from stock, what to buy at which supplier and when, the labour, and cardOf’s total', () => {
    const r = cardFor(island(), 'M_TIRE_WORN', 0, 'p1');
    const s = r.s;
    expect(r.o.status).toBe('pending');
    const c = cardVM(s, r.o);
    const card = cardOf(s, r.o);
    expect(c.total).toBe(card.total);
    expect(c.labour).toBe(r.o.cost);
    expect(c.toBuy.map((l) => l.item).sort()).toEqual(card.toBuy.map((l) => l.item).sort());
    expect(c.toBuy.length).toBeGreaterThan(0);
    // the tire and tube ride tonight's flight from the OEM (lead 1)
    for (const l of c.toBuy) expect(l).toMatchObject({ supplier: 'oem', etaText: 'here tonight' });
    // the task's bench lines come off the shelf: grease and a cotter pin
    expect(c.fromStock.map((l) => l.pn)).toEqual(expect.arrayContaining(['MIL-PRF-81322', 'MS24665-302']));
    expect(c.task).toMatch(/^32-40-01 /);
    expect(c.symptom).toMatch(/main tire/i);
    expect(c.who).toBe('Ana');
    expect(c.vendors.map((v) => v.v)).toEqual(['oem', 'broker']);
    expect(c.vendors[1].note).toMatch(/−20% parts.*\+1 week.*1 in 4 held for traceability.*no AOG boat/);
    // a lead-1 line already rides tonight: the boat isn't offered
    expect(c.freight.aog).toBeUndefined();
    expect(c.budget).toBe('Mech work budget this week: $0 of $500');
    // the broker: cheaper, a week later, and no boat
    const b = cardVM(s, r.o, { vendor: 'broker' });
    expect(b.vendor).toBe('broker');
    expect(b.buyTotal).toBeLessThan(c.buyTotal);
    for (const l of b.toBuy) expect(l).toMatchObject({ supplier: 'broker', eta: 6, etaText: 'here next week' });
    expect(b.freight.aog).toBeUndefined();
  });

  it('a lead-2 line: the AOG boat is offered, here tonight for $350, and the total follows the choice', () => {
    const r = cardFor(island(), 'E_PANEL_LOAD', 0, 'g1');
    const s = r.s;
    const c = cardVM(s, r.o);
    expect(c.toBuy.map((l) => l.pn)).toContain('LOT-DIST');
    expect(c.freight.sched).toMatchObject({ eta: 6, text: 'Scheduled: here next week' });
    expect(c.freight.aog).toMatchObject({ eta: 5, cost: FREIGHT.aog, text: 'AOG boat +$350: here tonight' });
    expect(c.freight.pick).toBe('sched');
    const boat = cardVM(s, r.o, { freight: 'aog' });
    expect(boat.total).toBe(c.total + FREIGHT.aog);
    // approving it with the boat puts it on a PO that lands at this week's resolve
    const t = ok(s, { t: 'approve', orderId: r.o.id, buy: { freight: 'aog' }, week: 5 });
    const po = t.pos!.find((p) => p.lines.some((l) => l.order === r.o.id))!;
    expect(po).toMatchObject({ freight: 'aog', eta: 5, freightCost: FREIGHT.aog });
  });

  it('chips: AOG and due now on a grounded cargo plane, what waiting a week costs, an MEL placard the analyst can extend once', () => {
    let s = island();
    const r = cardFor(s, 'M_BRAKE_SOFT', 1, 'p2', 5);
    s = r.s;
    const c = cardVM(s, r.o);
    expect(c.chips.map((x) => x.text)).toEqual(expect.arrayContaining(['AOG', 'Due now']));
    expect(c.chips.find((x) => x.text === 'AOG')!.tone).toBe('rust');
    expect(c.waitCost).toBeGreaterThan(0);
    expect(c.chips.some((x) => /^Waiting a week ≈ \$[\d,]+$/.test(x.text))).toBe(true);
    // a dead com on the cargo plane: placarded under the MEL, the card shows it, and the analyst may extend it once
    const com = raise(s, 'M_COM_DEAD', 0, 'p2', 5);
    s = ok(s, { t: 'mel', role: 'mech', alert: com.id, week: 5 });
    const task = fixTaskFor(s, com)!;
    const pick = stdPickFor(s, com, task);
    for (const l of pick) delete s.inv![l.item];
    s = ok(s, { t: 'plan', role: 'mech', alert: com.id, task: task.id, pick, week: 5 });
    const o = s.orders.find((x) => x.flow?.alert === com.id)!;
    const m = cardVM(s, o);
    expect(m.chips.map((x) => x.text)).toContain('MEL to wk 5');
    expect(m.mel).toMatchObject({ until: 5, ext: false, canExtend: true });
    s = ok(s, { t: 'melExtend', alert: com.id, week: 5 });
    expect(cardVM(s, o).mel).toMatchObject({ until: 6, ext: true, canExtend: false });
    expect(cardVM(s, o).chips.map((x) => x.text)).toContain('MEL to wk 6 (extended)');
  });

  it('a card that came after the analyst ended the turn: it goes through tonight on the standing approval, or waits when it’s over the limit', () => {
    let s = island();
    s = ok(s, { t: 'endTurn', role: 'fin', week: 5 });
    const r = cardFor(s, 'M_TIRE_WORN', 0, 'p1');
    s = r.s;
    expect(cardVM(s, r.o).late).toBe('Came after you ended your turn: it goes through tonight on your standing approval ($1,000) unless you defer it.');
    s = ok(s, { t: 'setStanding', amount: 0 });
    expect(cardVM(s, r.o).late).toBe('Came after you ended your turn, over your standing limit ($0): it waits for you.');
    // and it's still approvable: no End-turn lock on a flow card
    expect(flowQueue(s).map((o) => o.id)).toContain(r.o.id);
    s = ok(s, { t: 'approve', orderId: r.o.id, week: 5 });
    expect(s.orders.find((o) => o.id === r.o.id)!.status).not.toBe('pending');
  });

  it('the queues: flow cards most urgent first, deferred ones gone for the week, legacy cards apart', () => {
    let s = island();
    const a = cardFor(s, 'M_BELT_SQUEAL', 0, 'p1');
    s = a.s;
    const b = cardFor(s, 'M_BRAKE_SOFT', 1, 'p2', 5);
    s = b.s;
    expect(flowQueue(s).map((o) => o.id)).toEqual([b.o.id, a.o.id]);
    s = ok(s, { t: 'defer', orderId: b.o.id, reason: 'priority', week: 5 });
    expect(flowQueue(s).map((o) => o.id)).toEqual([a.o.id]);
    expect(legacyQueue(s)).toEqual([]);
  });
});

describe('requisitions (17.3 ReqQueue)', () => {
  it('grouped by supplier and carrier; a batch quote adds the AOG boat per PO; each trade dispatches its own approveReq', () => {
    let s = island();
    newReq(s, { at: clock, role: 'mech', item: 'T-N2', qty: 1, why: 'the accumulator job needs it' });
    newReq(s, { at: clock, role: 'mech', item: 'MIL-PRF-5606', qty: 12 });
    newReq(s, { at: clock, role: 'elec', item: 'KR20-TR', qty: 10 });
    const q = reqQueue(s);
    expect(q).toHaveLength(3);
    expect(q.find((r) => r.item === 'T-N2')).toMatchObject({ tool: true, who: 'Ana', why: 'the accumulator job needs it', value: 480 });
    const g = reqGroups(s, q);
    expect(g.map((x) => `${x.vendor}|${x.carrier}`).sort()).toEqual(['oem|any', 'oem|bulk', 'supply|any']);
    const ids = q.map((r) => r.id);
    const sched = reqQuote(s, ids, { cheaper: false, aog: false });
    expect(sched).toMatchObject({ freight: 0, pos: 3, lines: 3 });
    expect(sched.total).toBe(480 + 216 + 42);
    // every line here lands tonight on the week's carrier: the boat would buy nothing
    expect(reqQuote(s, ids, { cheaper: false, aog: true })).toMatchObject({ freight: 0, pos: 3, aogOk: false });
    // a lead-2 lot is two weeks out: the boat takes it (and only it), $350 for its PO
    newReq(s, { at: clock, role: 'elec', item: 'LOT-DIST', qty: 1 });
    const all = reqQueue(s).map((r) => r.id);
    const boat = reqQuote(s, all, { cheaper: false, aog: true });
    expect(boat).toMatchObject({ freight: FREIGHT.aog, pos: 4, aogOk: true });
    const split = reqActions(s, all, { cheaper: false, aog: true }) as Extract<Action, { t: 'approveReq' }>[];
    expect(split.map((a) => `${a.buy?.vendor}:${a.buy?.freight}:${a.reqs.length}`).sort()).toEqual(['oem:sched:2', 'supply:aog:1', 'supply:sched:1']);
    s = ok(s, { t: 'deferReq', req: all[3], week: 5 });
    // the cheaper suppliers: the broker for the mechanic's, the online store for the electrician's, never on the boat
    const cheap = reqQuote(s, ids, { cheaper: true, aog: true });
    expect(cheap.freight).toBe(0);
    expect(cheap.aogOk).toBe(false);
    expect(cheap.total).toBeLessThan(sched.total);
    const acts = reqActions(s, ids, { cheaper: true, aog: false });
    expect(acts).toHaveLength(2);
    for (const a of acts) s = ok(s, { ...a, week: 5 } as Action);
    expect(s.reqs!.filter((r) => ids.includes(r.id)).every((r) => r.status === 'ordered')).toBe(true);
    const vendors = new Set(s.pos!.filter((p) => p.lines.some((l) => l.req)).map((p) => p.vendor));
    expect([...vendors].sort()).toEqual(['broker', 'online']);
  });

  it('a request that came after the analyst ended the turn says so; a deferred one leaves the queue for the week', () => {
    let s = island();
    s = ok(s, { t: 'endTurn', role: 'fin', week: 5 });
    s = ok(s, { t: 'request', role: 'elec', item: 'KG20-TR', qty: 2, week: 5 });
    const [r] = reqQueue(s);
    expect(r.late).toMatch(/^Came after you ended your turn: it goes through tonight/);
    s = ok(s, { t: 'deferReq', req: r.id, week: 5 });
    expect(reqQueue(s)).toEqual([]);
  });
});

/** a ledger of `weeks` closed weeks (1..weeks) with the given item use per week, and matching week reports */
function withLedger(s: IslandState, weeks: number, use: (w: number) => Record<string, number>, sp: (w: number) => WeekLedger['sp'] = () => ({})): IslandState {
  s.week = weeks + 1;
  s.ledger = [];
  s.history = [];
  for (let w = 1; w <= weeks; w++) {
    s.ledger.push({ w, rev: 5000, cash: 20000, sp: sp(w), tr: {}, inv: 2000, use: use(w) });
    s.history.push({ week: w, tier: s.tier, budget: 5900, revenue: 5000, cashEnd: 20000, costs: { fixed: 2150, insurance: 150, leak: 0, incidents: 0, refunds: 0 } } as unknown as WeekReport);
  }
  return s;
}

describe('the stock planner (17.3)', () => {
  it('family rows: velocity, classes and ABC by value moved; filters by class, trade and group; flagged families first', () => {
    const s = withLedger(island(), 12, (w) => ({
      // the oil and its gaskets move most weeks, the linings twice, the breakers once
      'SAE-J1899-2050': 12,
      'AN900-10': 1,
      ...(w % 5 === 0 ? { '066-19500': 4 } : {}),
      ...(w === 3 ? { KP115: 1 } : {}),
    }));
    const rows = plannerRows(s);
    const oil = rows.find((r) => r.items.some((i) => i.id === 'SAE-J1899-2050'))!;
    expect(oil).toMatchObject({ cls: 'fast', abc: 'A', used: 144 });
    expect(oil.series).toHaveLength(12);
    expect(oil.label).toBe('Aviation piston oil, SAE J1899 20W-50');
    expect(oil.turns).not.toBeNull();
    expect(oil.days).toBeGreaterThan(0);
    const brk = rows.find((r) => r.fam === 'brk15')!;
    expect(brk).toMatchObject({ label: 'Breakers 15 A', cls: 'slow', lastUsed: 3, sinceText: 'last used 10 wk ago' });
    // the classes and ABC come from the same ledger
    const abc = abcClasses(s);
    expect(abc.get(oil.fam)).toBe('A');
    expect(plannerRows(s, 'fast').every((r) => r.cls === 'fast')).toBe(true);
    expect(plannerRows(s, 'elec').every((r) => r.trade === 'elec')).toBe(true);
    expect(plannerRows(s, 'consumables').every((r) => r.group === 'consumables')).toBe(true);
    expect(plannerRows(s, 'parts').every((r) => r.group !== 'consumables')).toBe(true);
    const flagged = rows.findIndex((r) => r.flags.length > 0);
    const plain = rows.findIndex((r) => r.flags.length === 0);
    if (flagged >= 0 && plain >= 0) expect(flagged).toBeLessThan(plain);
    // a family is named for what its P/Ns share, never for one of them (the right device and its near-miss side by side)
    expect(famName('recep15', 'Duplex receptacle 15 A, commercial grade, not tamper-resistant')).toBe('Duplex receptacles 15 A');
    expect(famName('wpcover', 'Cover, weatherproof flip-lid (not in-use)')).toBe('Weatherproof covers');
    expect(shortLabel('Safety wire, 0.032 in, CRES (1 lb spool)')).toBe('Safety wire, 0.032 in');
    expect(shortLabel('Pin, cotter, 1/16 x 3/4 in')).toBe('Pin, cotter, 1/16 x 3/4 in');
    expect(shortLabel('Standby generator (Harborline 60 kW diesel): fuel filter')).toBe('Generator fuel filter');
  });

  it('flags carry their one-tap action: a job waiting on a request approves that request; a slow family with a min/max stops reordering', () => {
    let s = withLedger(island(), 12, (w) => ({ 'SAE-J1899-2050': 12, 'AN900-10': 1, 'MS20995C32': 1, ...(w === 1 ? { 'BOX-OW1': 1 } : {}) }));
    s = ok(s, { t: 'request', role: 'elec', item: 'KP120GF', qty: 1, why: 'a bath circuit', week: s.week });
    const f = flagsVM(s);
    const order = f.find((x) => x.kind === 'order' && x.item === 'KP120GF')!;
    expect(order.act).toMatchObject({ label: "Approve Ben's request" });
    expect(order.act!.acts[0]).toMatchObject({ t: 'approveReq' });
    s = ok(s, { ...order.act!.acts[0], week: s.week } as Action);
    expect(s.reqs![0].status).toBe('ordered');
    const stop = flagsVM(s).find((x) => x.kind === 'stop' && x.fam === 'box1g')!;
    expect(stop.text).toMatch(/^Stop stocking Boxes, 1-gang: /);
    expect(stop.act!.label).toBe('Stop reordering');
    for (const a of stop.act!.acts) s = ok(s, { ...a, week: s.week } as Action);
    expect(s.inv!['BOX-OW1'].rop).toBeUndefined();
  });

  it('nothing on the analyst’s screens names an effectivity, and a need carries no P/N (0.2 rule 7)', () => {
    // a tier-3 island well into the game, mid-week: cards, needs, stock and POs on the desk
    const r = simulate(TEAMS['three friends'], 14, 5);
    let s = r.final;
    s = botTurn(s, 'mech', TEAMS['all good'].mech, rng(1), NOW);
    s = botTurn(s, 'elec', TEAMS['all good'].elec, rng(2), NOW);
    const text: string[] = [];
    for (const o of flowQueue(s)) {
      const c = cardVM(s, o);
      text.push(c.title, c.task, ...c.chips.map((x) => x.text), c.freight.sched.out, ...c.toBuy.map((l) => l.nomen), ...c.fromStock.map((l) => l.nomen));
    }
    for (const row of plannerRows(s)) text.push(row.label, ...row.items.map((i) => `${i.nomen} ${i.supsd ?? ''}`));
    for (const f of flagsVM(s)) text.push(f.text);
    const n = needsVM(s);
    for (const x of [...n.unplanned, ...n.waiting.map((w) => ({ text: `${w.title} ${w.lines.map((l) => l.state).join(' ')}` })), ...n.placards]) text.push(x.text);
    const bad = /\bEFF\b|this airplane|S\/N|\bPRE SB\b|\bPOST SB\b|effective for|not effective/i;
    expect(text.filter((t) => bad.test(t))).toEqual([]);
    const pns = new Set(allItems().filter((x) => x.pn.length >= 6).map((x) => x.pn));
    for (const u of n.unplanned) for (const pn of pns) expect(u.text.includes(pn), `${u.text} names ${pn}`).toBe(false);
  });

  it('needs: unplanned alerts by due week with a nudge; the jobs waiting on parts line by line; placards the analyst can extend', () => {
    let s = island();
    const al = raise(s, 'M_TIRE_WORN', 0, 'p2', 6);
    let n = needsVM(s);
    expect(n.unplanned).toHaveLength(1);
    expect(n.unplanned[0]).toMatchObject({ alert: al.id, trade: 'mech', who: 'Ana', due: 6, dueText: 'due wk 6', nudged: false, soon: true });
    expect(n.unplanned[0].text).toMatch(/^Cargo C-7: .+, due wk 6 · Ana hasn't planned it$/);
    s = ok(s, { t: 'nudge', alert: al.id, week: 5 });
    expect(needsVM(s).unplanned[0].nudged).toBe(true);
    // approve a card whose tire is on order: the job waits, its line on the PO
    const r = cardFor(s, 'M_BELT_SQUEAL', 0, 'p1');
    s = ok(r.s, { t: 'approve', orderId: r.o.id, buy: { vendor: 'broker' }, week: 5 });
    n = needsVM(s);
    const w = n.waiting.find((x) => x.order === r.o.id)!;
    expect(w.lines.find((l) => l.pn === 'HA-B38')!.state).toMatch(/^on po\d+, here next week$/);
  });

  it('an item’s sheet: position, lead, known demand and the suggestion; tools on the board', () => {
    const s = withLedger(island(), 10, () => ({ 'AN900-10': 1 }));
    const it = itemVM(s, 'AN900-10')!;
    expect(it).toMatchObject({ pn: 'AN900-10', lead: 1, pack: 25, minmaxOk: true, returnable: false });
    expect(it.leadText).toBe('1 week by scheduled freight (OEM)');
    expect(it.suggest.rop).toBeGreaterThanOrEqual(1);
    expect(it.forecast).toMatch(/^Next 4 weeks: ~\d+/);
    expect(it.position).toBe(it.onHand - it.reserved);
    const tools = toolRows(s);
    expect(tools.find((t) => t.id === 'T-N2')!.status).toBe('not owned');
    expect(tools.find((t) => t.id === 'T-TW-IN')!.status).toBe('owned');
    // the planner's filter input searches the supply catalog, stocked or not
    expect(catalogHits(s, 'gfci 20').map((i) => i.id)).toEqual(expect.arrayContaining(['KG20-TR', 'KP120GF']));
  });

  it('a buy: whole packs, the boat priced per PO, blocked by the freeze and a full stores room', () => {
    const s = island();
    const q = buyQuote(s, 'AN900-10', 3, {});
    expect(q).toMatchObject({ units: 25, packs: 1, vendor: 'oem', eta: 5, etaText: 'here tonight', freight: 0, aogOk: false });
    expect(q.value).toBe(Math.round(priceAt(itemById('AN900-10')!) * 25 * 100) / 100);
    // the boat only where it's faster: LOT-DIST is two weeks out by the week's carrier
    expect(buyQuote(s, 'LOT-DIST', 1).aogOk).toBe(true);
    const boat = buyQuote(s, 'LOT-DIST', 1, { freight: 'aog' });
    expect(boat).toMatchObject({ eta: 5, freight: FREIGHT.aog, total: 1400 + FREIGHT.aog });
    expect(buyQuote(s, 'AN900-10', 3, { freight: 'aog' })).toMatchObject({ freight: 0, eta: 5 });
    const cheap = buyQuote(s, 'KR20-TR', 10, { vendor: 'online', freight: 'aog' });
    expect(cheap).toMatchObject({ vendor: 'online', freight: 0, aogOk: false, eta: 6 });
    // every bin taken: a new line can't come in
    const fill = allItems().filter((x) => x.trade === 'elec' && x.kind !== 'tool' && !s.inv![x.id]);
    let i = 0;
    while (binsInUse(s) < binsTotal(s)) s.inv![fill[i++].id] = { on: 1 };
    const fresh = fill[i].id;
    expect(buyQuote(s, fresh, 1).block).toMatch(/^Stores full: \d+ of \d+ bins\./);
    s.cash = 1500;
    expect(buyQuote(s, 'AN900-10', 25).block).toBe('Spendable cash under $2,000: stock orders are frozen.');
  });
});

describe('receiving and the Money tab (14.3, 9.4, 9.7)', () => {
  it('receiving: held paperwork in words, exchange units’ cores, the jobs a PO serves, payables at the next run', () => {
    let s = island();
    const r = cardFor(s, 'M_COM_DEAD', 0, 'p2', 7);
    s = ok(r.s, { t: 'approve', orderId: r.o.id, week: 5 });
    const po = s.pos!.find((p) => p.lines.some((l) => l.order === r.o.id))!;
    // the exchange radio came without its 8130-3
    po.status = 'held';
    po.hold = 6;
    po.lines[0].hold = "an FAA 8130-3 matching the unit's data plate";
    po.notes = [`held: no an FAA 8130-3 matching the unit's data plate with ${po.lines[0].item}`];
    placePo(s, [{ item: 'AN900-10', qty: 25 }], {}, 'fin', 0);
    receive(s, 5, { guest: 2, cargo: 1 }, () => {});
    const v = receivingVM(s);
    expect(v.held).toHaveLength(1);
    expect(heldWords(v.held[0])).toMatch(new RegExp(`^${po.id}: the .+ waits for an FAA 8130-3 matching the unit's data plate, released wk 6$`));
    expect(v.held[0].cores[0]).toMatch(/: an exchange unit\. The old unit goes back in its box as the core/);
    expect(v.held[0].jobs[0]).toMatch(/ on Cargo C-7$/);
    expect(v.payable.map((p) => p.lines[0].pn)).toContain('AN900-10');
    expect(v.payableTotal).toBe(Math.round(priceAt(itemById('AN900-10')!) * 25));
    expect(v.committed).toBe(committed(s));
  });

  it('the Money cards from a hand-built ledger: where it went by group and trade, capex vs opex, the top assets, the stock card', () => {
    const s = withLedger(
      island(),
      6,
      (w): Record<string, number> => (w === 6 ? { 'AN900-10': 2 } : {}),
      (w) => ({ overhead: 1070, payroll: 1080, labor: 300 * w, parts: 100, tools: w === 5 ? 480 : 0, freight: w === 6 ? 350 : 0, carry: 5 }),
    );
    for (const row of s.ledger!) {
      row.tr = { mech: 300 * row.w, elec: 100, fin: 2155 };
      row.as = { p1: 200, h1: 100 * row.w };
    }
    const m = moneyVM(s, 4);
    expect(m.weeks).toHaveLength(6);
    expect(m.weeks[5]).toMatchObject({ w: 6, rev: 5000, budget: 5900 });
    const g = Object.fromEntries(m.where.groups.map((x) => [x.k, x.usd]));
    // weeks 3-6: labour 900+1200+1500+1800, parts 4 × 100, freight 350, carrying 4 × 5
    expect(g.jobs).toBe(5400 + 400 + 350 + 20);
    expect(g.capex).toBe(480);
    expect(g.fixed).toBe(4 * (1070 + 1080));
    expect(m.where.capex).toBe(480);
    expect(m.where.opex).toBe(m.where.groups.reduce((n, x) => n + x.usd, 0) - 480);
    expect(m.where.trades.find((t) => t.k === 'mech')!.usd).toBe(5400);
    expect(m.where.assets[0]).toMatchObject({ name: 'Cottage 1' });
    expect(m.stock.inv).toBe(Math.round(invValue(s)));
    expect(m.stock.tiedUp).toBe(m.stock.inv + committed(s));
    // the lines add up to the totals, to the dollar
    expect(m.overhead.lines.reduce((n, l) => n + l.usd, 0)).toBe(m.overhead.total);
    expect(m.payroll.total).toBeGreaterThan(0);
    expect(m.payroll.lines.reduce((n, l) => n + l.usd, 0)).toBe(m.payroll.total);
    expect(m.budgets.map((b) => b.role)).toEqual(['mech', 'elec']);
  });

  it('whole dollars that add up; the payroll names an open post of the standard crew the week charges for', () => {
    expect(splitWhole(1070, [0.35, 0.25, 0.15, 0.15, 0.1])).toEqual([375, 268, 160, 160, 107]);
    expect(splitWhole(1070, [0.35, 0.25, 0.15, 0.15, 0.1]).reduce((a, b) => a + b, 0)).toBe(1070);
    // a new island hires the tier-1 crew (a pilot, a housekeeper, a builder); at tier 2 the standard crew has two pilots,
    // and until the staff update the week charges the standard crew's payroll whoever is on the list
    const s = island();
    expect(s.staff!.map((n) => n.role).sort()).toEqual(['builder', 'housekeeper', 'pilot']);
    const pay = payrollLines(s);
    expect(pay.lines.map((l) => l.label)).toEqual(['1 pilot', '1 housekeeper', '1 builder', 'Open post of the standard crew (1 pilot)']);
    expect(pay.lines.at(-1)!.usd).toBe(320);
    expect(pay.lines.reduce((n, l) => n + l.usd, 0)).toBe(pay.total);
  });

  it('a PO due tonight on a grounded cargo plane slips a week, and the desk says so; MEL placards in words', () => {
    let s = island();
    s = cardFor(s, 'M_BRAKE_SOFT', 1, 'p2', 5).s;
    const item = allItems().find((x) => x.trade === 'mech' && x.kind === 'consumable')!;
    s.pos!.push({ id: 'po900', week: 5, vendor: 'oem', freight: 'sched', eta: 5, cost: 40, freightCost: 0, by: 'fin', status: 'open', carrier: 'bulk', lines: [{ item: item.id, qty: 1, unit: 40 }] } as never);
    const po = receivingVM(s).open.find((p) => p.id === 'po900')!;
    expect(po.statusText).toBe('cargo flight: Cargo C-7 is down, so it slips to wk 6 unless it’s flying by the resolve'.replace('’', "'"));
    // the boat and the guest carrier aren't held by the cargo plane
    expect(carrierDown(s, { carrier: 'any', freight: 'sched', eta: 5 })).toBeNull();
    expect(carrierDown(s, { carrier: 'bulk', freight: 'aog', eta: 5 })).toBeNull();
    // a card whose lines are due tonight with no plane flying: the scheduled choice says it slips, and the boat is offered
    const r = cardFor(island(), 'M_TIRE_WORN', 0, 'p1');
    const t = r.s;
    t.tags = { p1: 'mech', p2: 'mech' };
    const c = cardVM(t, r.o);
    expect(c.freight.sched.text).toBe('Scheduled: no plane is flying, so it slips a week');
    expect(c.freight.aog).toBeDefined();
    for (const l of c.toBuy) expect(l.etaText).toBe('slips a week: no plane is flying');
    const boat = cardVM(t, r.o, { freight: 'aog' });
    for (const l of boat.toBuy) expect(l.etaText).toBe('here tonight');
    expect(boat.freight.sched.text).toBe('Scheduled: no plane is flying, so it slips a week');
    expect(melWords(12, 13, true)).toBe('placarded to wk 13');
    expect(melWords(12, 12, true)).toBe('runs out at this week’s resolve');
    expect(melWords(12, 11, true)).toBe('ran out last week: the plane is grounded at this resolve unless you extend it');
    expect(melWords(12, 11, false)).toBe('ran out wk 11');
  });

  it('a card short of several P/Ns is one flag with one approval, naming them all', () => {
    const r = cardFor(island(), 'M_TIRE_WORN', 0, 'p1');
    const jobFlags = flagsVM(r.s).filter((f) => f.kind === 'order' && f.act?.acts[0].t === 'approve');
    expect(jobFlags).toHaveLength(1);
    const pns = cardVM(r.s, r.o).toBuy.map((l) => l.pn);
    if (pns.length > 1) expect(jobFlags[0].text).toBe(`Ana's job waits on ${pns.slice(0, -1).join(', ')} and ${pns.at(-1)}: ${r.o.title}`);
    expect(jobFlags[0].act!.done).toBe(`Approved ${r.o.title}`);
  });

  it('the desk opens on Approvals when something waits, else on Stock; counts and dots', () => {
    let s = island();
    s.orders = [];
    expect(openingTab(s)).toBe('stock');
    const r = cardFor(s, 'M_TIRE_WORN', 0, 'p1');
    s = r.s;
    const c = deskCounts(s);
    expect(c.approvals).toBe(1);
    expect(openingTab(s)).toBe('approvals');
  });
});

describe('the desk puzzles on real items (17.3)', () => {
  const kit = { low: 220, high: 460, fair: 340, cap: 423 };
  const lot = {
    lines: [
      { pn: 'AN900-10', nomen: 'Gasket, crush (oil drain plug)', qty: 25, list: 15 },
      { pn: 'MS28775-227', nomen: 'O-ring, brake piston', qty: 10, list: 22 },
      { pn: 'KR15-TR', nomen: 'Duplex receptacle 15 A (5-15R), tamper-resistant', qty: 10, list: 28 },
    ],
    fair: 44,
    list: 65,
  };

  it('the auction bids on the broker’s lot: its fair value, a range around it, a cap of 92% of the lot at list', () => {
    const mk = lotMarket(lot, kit);
    expect(mk.fair).toBe(44);
    expect(mk.low).toBe(Math.round(44 * 0.6));
    expect(mk.cap).toBe(Math.round(65 * 0.92));
    expect(mk.high).toBeGreaterThan(mk.cap);
    const m = generateAuction(9, 5, [], kit, lot);
    expect(m).toMatchObject({ fair: 44, cap: mk.cap, lot: { list: 65 } });
    // a real lot is one PO: one lot at every tier
    expect(m.lots).toHaveLength(1);
    expect(generateAuction(9, 5, [], kit).lots).toHaveLength(2);
    // lines in the packs they come in, each at list from the catalog's unit price
    const pack = itemById('AN900-10')!;
    expect(lotLine(lot.lines[0])).toBe(`AN900-10 gasket · a ${pack.packName ?? 'pack'} of ${pack.pack}`);
    expect(lotLine({ pn: 'KR15-TR', nomen: 'Duplex receptacle 15 A (5-15R), tamper-resistant', qty: 3 })).toMatch(/^(3 × KR15-TR duplex receptacle 15 A \(5-15R\)|KR15-TR duplex receptacle 15 A \(5-15R\) · )/);
    expect(m.lot!.lines.map((l) => l.list)).toEqual(lot.lines.map((l) => Math.round(priceAt(itemById(l.pn)!) * l.qty)));
    // tight cash: today's market carries the cash side of the cap (under 1.2 × its fair), and it caps the lot too
    expect(lotMarket(lot, { ...kit, cap: 30 }).cap).toBe(30);
    // a market passed for the lot itself is used as it is
    expect(lotMarket(lot, { low: 20, high: 80, fair: 44, cap: 50 })).toEqual({ low: 20, high: 80, fair: 44, cap: 50 });
  });

  it('the three-way match runs on the island’s own unpaid POs: their P/Ns, quantities, prices and freight, no sales tax, and a clean run finds every issue', () => {
    const s = island();
    // the OEM's four lines (one PO of three and a line, so two invoices), the supply house's receptacles, a lot on the AOG boat
    const placed = [
      ...placePo(s, [{ item: 'AN900-10', qty: 25 }, { item: 'MS28775-227', qty: 10 }, { item: 'MIL-PRF-81322', qty: 10 }, { item: 'MS24665-302', qty: 100 }, { item: 'KR20-TR', qty: 10 }], {}, 'fin', 0),
      ...placePo(s, [{ item: 'LOT-DIST', qty: 1 }], { freight: 'aog' }, 'fin', 0),
    ];
    receive(s, 5, { guest: 2, cargo: 1 }, () => {});
    s.week = 6;
    const ctx = invoiceContext(s)!;
    expect(ctx.pos.map((p) => p.id).sort()).toEqual(placed.map((p) => p.id).sort());
    for (const t of [0, 1, 2, 3, 4, 5]) {
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const m = generateInvoice(seed, t, [], { leak: 240, invoice: ctx });
        expect(m.real).toBe(true);
        expect(m.taxRate).toBe(0);
        const real = m.cards.filter((c) => c.real);
        // every PO is in the batch (the four-line PO as two invoices)
        expect(new Set(real.map((c) => c.po.split(' ')[0]))).toEqual(new Set(placed.map((p) => p.id)));
        expect(real.some((c) => c.po.endsWith('(2/2)'))).toBe(true);
        for (const c of real) {
          const po = ctx.pos.find((p) => p.id === c.po.split(' ')[0])!;
          for (const l of c.lines) {
            const src = po.lines.find((x) => x.pn === l.item)!;
            expect(l).toMatchObject({ poQty: src.qty, poPrice: Math.round(src.unit * 100) / 100, rcvd: src.got });
            expect(l.sub).toBeTruthy();
          }
          expect(c.tax).toBe(0);
          if (po.freight > 0 && !c.po.includes('(2/')) expect(c.freightPo).toBe(po.freight);
          // a real invoice never carries a duplicate or a tax error
          expect(c.issue?.kind === 'dupe' || c.issue?.kind === 'tax').toBe(false);
        }
        // the numbers alone find each card's issue, and a clean run gets full marks
        for (const c of m.cards) expect(detectIssue(m, c), `${t}/${seed} ${c.scenario}`).toBe(c.issue?.kind ?? null);
        expect(playInvoice(m, solveInvoice(m)).score).toBe(1);
        if (t === 0) expect(m.cards[0].issue).toBeNull();
      }
    }
  });

  it('the desk task lines name the lot and the POs', () => {
    let s = island();
    placePo(s, [{ item: 'AN900-10', qty: 25 }], {}, 'fin', 0);
    receive(s, 5, { guest: 2, cargo: 1 }, () => {});
    s.week = 6;
    s = { ...s, orders: [...s.orders, { id: 'o1', role: 'fin', kind: 'invoice', assetId: null, title: 'Three-way match', puzzle: 'invoice', tier: 2, cost: 0, parts: 0, gain: 0, createdWeek: 6, deferrals: 0, lastDeferredWeek: null, status: 'ready', seed: 1 }] };
    expect(deskTaskLine(s, s.orders[s.orders.length - 1])).toMatch(/^po\d+ came in last week \(\$15\): match before the payment run$/);
    const auc: Order = { ...s.orders[s.orders.length - 1], id: 'o2', kind: 'auction', puzzle: 'auction', lot: { lines: [{ item: 'AN900-10', qty: 25 }], fair: 11, list: 15 } };
    expect(deskTaskLine(s, auc)).toBe('Broker lot: 25 × AN900-10 · $15 at list');
    expect(STOCK.keepWeeks).toBeGreaterThan(0);
  });
});
