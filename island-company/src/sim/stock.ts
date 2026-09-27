// Stock and purchasing (docs/JOBFLOW.md 9): on hand and reserved, one
// inventory-position formula, the allocation that gives arriving stock to the
// job that waits for it, purchase orders (committed when placed, received at
// the resolve on their carrier, paid at the next payment run), replenishment,
// stores bins, and the analyst's analytics (families, velocity, flags, needs).
// Every function reads or writes the island passed in; nothing here is random
// except where a seeded stream is passed.
import { planeModel, rowFor, ipcFor, type AnyAta } from './aircraft';
import { alertFlags, alertShort, liveAlerts, symptomOf } from './alerts';
import { islandAircraft } from './chain';
import { DEFAULT_SUPPLIER, ECON, FREIGHT, MODELS, STARTER, STOCK, SUPPLIERS, TIERS, type StarterLine } from './data';
import { alertAog, flightsPerPlane, hazardOn, restrictedBy, tierDef } from './econ';
import { allItems, buyUnits, famOf, itemById, priceAt, sells } from './items';
import { book, bookCredit, bookLoss, bookRcv, bookUse, committed, invValue, payable, poOwed, spendable } from './ledger';
import type { Rng } from './rng';
import { hashSeed, rng } from './rng';
import { buildDef } from './staff';
import { benchFor, taskById } from './tasks';
import type { Action, Alert, BuyChoice, IslandState, Item, ItemId, ItemTrade, Liner, OpsRole, Order, PoLine, PurchaseOrder, Requisition, SpendCat, StockLine, SupplierId } from './types';

export { committed, invValue, payable, poOwed, spendable };

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const cents = (v: number) => Math.round(v * 100) / 100;
const idNum = (id: string) => Number(id.replace(/\D/g, '')) || 0;

// ---------------------------------------------------------------------------
// On hand, reserved, available

export const onHand = (s: Pick<IslandState, 'inv'>, item: ItemId) => s.inv?.[item]?.on ?? 0;
export const reservedOf = (s: Pick<IslandState, 'inv'>, item: ItemId) => Object.values(s.inv?.[item]?.res ?? {}).reduce((n, v) => n + v, 0);
/** on hand less every reservation (soft ones count as reserved) */
export const available = (s: Pick<IslandState, 'inv'>, item: ItemId) => Math.max(0, onHand(s, item) - reservedOf(s, item));
/** a shop tool the company owns (tools are never reserved or consumed) */
export const owned = (s: Pick<IslandState, 'inv'>, tool: ItemId) => onHand(s, tool) >= 1;
/** units reserved for one job */
export const reservedFor = (s: Pick<IslandState, 'inv'>, order: string, item: ItemId) => s.inv?.[item]?.res?.[order] ?? 0;

function lineOf(s: IslandState, item: ItemId): StockLine {
  s.inv ??= {};
  return (s.inv[item] ??= { on: 0 });
}

/** a line with nothing on hand, nothing reserved and no min/max goes (the stock is sparse) */
function tidy(s: IslandState, item: ItemId) {
  const l = s.inv?.[item];
  if (!l) return;
  if (l.res && !Object.keys(l.res).length) delete l.res;
  if (l.on <= 0 && !l.res && l.rop === undefined && l.max === undefined) delete s.inv![item];
}

/** unit cost for valuation: the moving average, else list */
export const unitCost = (s: Pick<IslandState, 'inv'>, item: ItemId) => {
  const l = s.inv?.[item];
  if (l?.avg !== undefined) return l.avg;
  const x = itemById(item);
  return x ? priceAt(x) : 0;
};

// ---------------------------------------------------------------------------
// A job's lines

/** a flow job's pick and bench lines, merged by item (tools apart) */
export function jobLines(o: Pick<Order, 'flow'>): { item: ItemId; qty: number }[] {
  const out: { item: ItemId; qty: number }[] = [];
  if (!o.flow || o.flow.wired) return out;
  for (const l of [...o.flow.pick, ...o.flow.bench]) {
    const at = out.find((x) => x.item === l.item);
    if (at) at.qty += l.qty;
    else out.push({ item: l.item, qty: l.qty });
  }
  return out;
}

/** a flow job's lines not reserved yet */
export function jobShort(s: IslandState, o: Order): { item: ItemId; qty: number }[] {
  return jobLines(o)
    .map((l) => ({ item: l.item, qty: l.qty - reservedFor(s, o.id, l.item) }))
    .filter((l) => l.qty > 0);
}

/** a flow job's tools the company doesn't own */
export const toolsMissing = (s: IslandState, o: Order): ItemId[] => (o.flow && !o.flow.wired ? o.flow.tools.filter((t) => !owned(s, t)) : []);

/** a tool already coming: on an open or held PO line (for any job, or free), or on an open requisition. One goes on the board for every job */
export function toolComing(s: IslandState, tool: ItemId): boolean {
  for (const p of s.pos ?? []) {
    if (p.status !== 'open' && p.status !== 'held') continue;
    if (p.lines.some((l) => (l.as ?? l.item) === tool && l.got === undefined && !l.back)) return true;
  }
  return (s.reqs ?? []).some((r) => r.item === tool && r.status === 'open');
}

/** the tools a job would have to buy: not owned and not already coming */
export const toolsToBuy = (s: IslandState, o: Order): ItemId[] => toolsMissing(s, o).filter((t) => !toolComing(s, t));

/** units of an item on open or held POs bought for this job (not received yet) */
export function onOrderFor(s: IslandState, order: string, item: ItemId): number {
  let n = 0;
  for (const p of s.pos ?? []) {
    if (p.status !== 'open' && p.status !== 'held') continue;
    for (const l of p.lines) if (l.order === order && (l.as ?? l.item) === item && l.got === undefined && !l.back) n += l.qty;
  }
  return n;
}

/** units an approved job has asked the analyst for (open requisitions tied to it) */
const reqOpenFor = (s: IslandState, order: string, item: ItemId) =>
  (s.reqs ?? []).filter((r) => r.order === order && r.item === item && r.status === 'open').reduce((n, r) => n + r.qty, 0);

/**
 * A pending card's lines to buy (8.6: its shortfall lives only on the card):
 * each line not reserved, and each tool not owned. Nothing is on order for a
 * card nobody has approved.
 */
export function cardBuyLines(s: IslandState, o: Order): { item: ItemId; qty: number; tool?: boolean }[] {
  if (!o.flow) return [];
  return [...jobShort(s, o), ...toolsToBuy(s, o).map((t) => ({ item: t, qty: 1, tool: true }))];
}

/** an approved job's shortfall nobody has covered: not reserved, not on order for it, not requested */
export function uncovered(s: IslandState, o: Order): { item: ItemId; qty: number; tool?: boolean }[] {
  if (!o.flow) return [];
  const out: { item: ItemId; qty: number; tool?: boolean }[] = [];
  for (const l of jobShort(s, o)) {
    const q = l.qty - onOrderFor(s, o.id, l.item) - reqOpenFor(s, o.id, l.item);
    if (q > 0) out.push({ item: l.item, qty: q });
  }
  for (const t of toolsToBuy(s, o)) out.push({ item: t, qty: 1, tool: true });
  return out;
}

/** every line reserved and every tool owned */
export const allOnHand = (s: IslandState, o: Order) => jobShort(s, o).length === 0 && toolsMissing(s, o).length === 0;

// ---------------------------------------------------------------------------
// Inventory position (9.1)

/** open and held PO lines not tied to a job, and when the first lands */
export function onOrderFree(s: IslandState, item: ItemId): { qty: number; eta?: number } {
  let qty = 0;
  let eta: number | undefined;
  for (const p of s.pos ?? []) {
    if (p.status !== 'open' && p.status !== 'held') continue;
    for (const l of p.lines) {
      if ((l.as ?? l.item) !== item || l.order || l.got !== undefined || l.back) continue;
      qty += l.qty;
      const at = p.status === 'held' ? (p.hold ?? p.eta) : p.eta;
      eta = eta === undefined ? at : Math.min(eta, at);
    }
  }
  return eta === undefined ? { qty } : { qty, eta };
}

/** demand nobody has ordered yet: open requisitions and pending cards' lines to buy */
export function openDemand(s: IslandState, item: ItemId): number {
  let n = 0;
  for (const r of s.reqs ?? []) if (r.status === 'open' && r.item === item) n += r.qty;
  for (const o of s.orders) if (o.flow && o.status === 'pending') for (const l of cardBuyLines(s, o)) if (l.item === item) n += l.qty;
  return n;
}

/** IP = on hand − reserved + on order not tied to a job − open demand not yet ordered */
export function position(s: IslandState, item: ItemId): number {
  return onHand(s, item) - reservedOf(s, item) + onOrderFree(s, item).qty - openDemand(s, item);
}

// ---------------------------------------------------------------------------
// Reservations (9.2) and allocation (9.3)

/** reserve what's available for a job, first come, first served: what's still short */
export function reserve(s: IslandState, order: string, lines: { item: ItemId; qty: number }[]): { item: ItemId; short: number }[] {
  const out: { item: ItemId; short: number }[] = [];
  for (const l of lines) {
    const x = itemById(l.item);
    if (x?.kind === 'tool') continue;
    const have = reservedFor(s, order, l.item);
    const want = l.qty - have;
    if (want <= 0) continue;
    const take = Math.min(available(s, l.item), want);
    if (take > 0) {
      const line = lineOf(s, l.item);
      line.res ??= {};
      line.res[order] = have + take;
    }
    if (want - take > 0) out.push({ item: l.item, short: want - take });
  }
  return out;
}

/** a safety plan takes soft reservations from pending cards that aren't safety work (their lines go back on their list to buy) */
export function takeSoft(s: IslandState, order: string, item: ItemId, qty: number): number {
  const line = s.inv?.[item];
  if (!line?.res || qty <= 0) return 0;
  let got = 0;
  const donors = Object.keys(line.res)
    .map((id) => s.orders.find((o) => o.id === id))
    .filter((o): o is Order => !!o && o.id !== order && o.status === 'pending' && !!o.flow && !isSafetyJob(s, o))
    .sort((a, b) => idNum(b.id) - idNum(a.id));
  for (const d of donors) {
    if (got >= qty) break;
    const take = Math.min(line.res[d.id], qty - got);
    line.res[d.id] -= take;
    if (line.res[d.id] <= 0) delete line.res[d.id];
    got += take;
  }
  if (got > 0) line.res[order] = (line.res[order] ?? 0) + got;
  return got;
}

/** release every unit reserved for a job (they stay on the shelf) */
export function release(s: IslandState, order: string): void {
  for (const [id, l] of Object.entries(s.inv ?? {})) {
    if (!l.res?.[order]) continue;
    delete l.res[order];
    tidy(s, id);
  }
}

/** the job's alert is airworthiness on a plane or a hazard: safety work (first in the allocation, past the work budget) */
export function isSafetyJob(s: IslandState, o: Order): boolean {
  // an inspection or a code-inspection prep keeps the plane flying and the house rentable: safety work, as today's freeze rule has it
  if (o.kind === 'inspect100' || o.kind === 'codeprep') return true;
  const a = o.flow ? s.alerts?.find((x) => x.id === o.flow!.alert) : undefined;
  if (!a) return o.kind === 'repair';
  const f = alertFlags(s, a);
  return f.aw || f.hazard || a.kind === 'repair';
}

/** an approved flow job with every line reserved, its tools owned, nothing stopping it and no chain holding it */
export function jobReady(s: IslandState, o: Order): boolean {
  if (!o.flow || o.approvedWeek === undefined) return false;
  if (o.flow.stop || o.flow.queued) return false;
  if (o.chain?.step === 'job' && s.chain?.id === o.chain.id && s.chain.step !== 'done' && s.chain.step !== 'install') return false;
  if ((s.pos ?? []).some((p) => p.status === 'held' && p.lines.some((l) => l.order === o.id && l.hold))) return false;
  return allOnHand(s, o);
}

/**
 * Stock goes to the job that waits for it: jobs with a shortfall, safety work
 * first, then the oldest, each gets the available units of what it's short
 * (hard for approved jobs, soft for pending cards). A requisition the stock
 * fills is `filled` (a PO line already ordered for it becomes free stock). An
 * approved job with everything reserved and its tools owned becomes ready:
 * returned, for the feed.
 */
export function allocate(s: IslandState): Order[] {
  const ready: Order[] = [];
  const jobs = s.orders
    .filter((o) => o.flow && !o.flow.wired && (o.status === 'pending' || o.status === 'waiting_part' || o.status === 'ready'))
    .sort((a, b) => Number(isSafetyJob(s, b)) - Number(isSafetyJob(s, a)) || a.createdWeek - b.createdWeek || idNum(a.id) - idNum(b.id));
  for (const o of jobs) {
    const short = jobShort(s, o);
    if (short.length) reserve(s, o.id, jobLines(o));
    // requisitions for this job that stock now covers
    for (const r of s.reqs ?? []) {
      if (r.order !== o.id || (r.status !== 'open' && r.status !== 'ordered')) continue;
      const x = itemById(r.item);
      const covered = x?.kind === 'tool' ? owned(s, r.item) : !jobShort(s, o).some((l) => l.item === r.item);
      if (!covered) continue;
      r.status = 'filled';
      r.closed = s.week;
      // what was ordered for it lands as free stock
      for (const p of s.pos ?? []) for (const l of p.lines) if (l.req === r.id && l.got === undefined) delete l.order;
    }
    if (o.status === 'waiting_part' && jobReady(s, o)) {
      o.status = 'ready';
      ready.push(o);
    }
  }
  return ready;
}

/** at a sign-off: the job's reserved units leave stock (value at average cost, booked); returns the value */
export function consume(s: IslandState, order: string, asset: string | null): number {
  let v = 0;
  for (const [id, l] of Object.entries(s.inv ?? {})) {
    const q = l.res?.[order];
    if (!q) continue;
    const unit = unitCost(s, id);
    l.on = Math.max(0, l.on - q);
    delete l.res![order];
    v += q * unit;
    bookUse(s, id, q, q * unit, asset);
    tidy(s, id);
  }
  return cents(v);
}

/** builders (D) draw a work unit's materials: all or nothing, booked as use against `key` ('build:t4') */
export function takeStock(s: IslandState, lines: { item: ItemId; qty: number }[], key: string): boolean {
  if (lines.some((l) => available(s, l.item) < l.qty)) return false;
  for (const l of lines) {
    const line = lineOf(s, l.item);
    const unit = unitCost(s, l.item);
    line.on -= l.qty;
    bookUse(s, l.item, l.qty, l.qty * unit, key);
    tidy(s, l.item);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Purchase orders

/** the supplier a line goes to: the chosen one if it sells the item, else the item's trade's default */
export function vendorFor(x: Item, buy?: BuyChoice): SupplierId {
  return buy?.vendor && sells(buy.vendor, x) ? buy.vendor : DEFAULT_SUPPLIER[x.trade];
}

/** which carrier brings it: building materials the supply boat, bulk lines the cargo plane (a guest hold at tier 1), the rest any flight */
export const carrierOf = (x: Item): 'any' | 'bulk' | 'boat' => (x.trade === 'build' ? 'boat' : x.bulk ? 'bulk' : 'any');

/** the week whose resolve delivers a line bought this week by scheduled freight (a lead-1 line rides this week's carrier) */
export const etaOf = (W: number, x: Item, vendor: SupplierId) => W + x.lead + SUPPLIERS[vendor].leadAdd - 1;

/** can this buy go on the AOG boat (the OEM distributor or the supply house; never building materials) */
export const aogOk = (x: Item, vendor: SupplierId) => SUPPLIERS[vendor].aog && x.trade !== 'build';

export type BuyLine = { item: ItemId; qty: number; order?: string; req?: string };

/**
 * Place a buy: one PO per supplier x carrier class, committed now (nothing
 * leaves the bank until the payment run after it lands). Quantities round up
 * to whole packs (cut-to-length items: any quantity).
 */
export function placePo(s: IslandState, lines: BuyLine[], buy: BuyChoice, by: PurchaseOrder['by'], _now: number): PurchaseOrder[] {
  const W = s.week;
  const groups = new Map<string, { vendor: SupplierId; carrier: 'any' | 'bulk' | 'boat'; freight: 'sched' | 'aog'; lines: PoLine[]; eta: number }>();
  for (const l of lines) {
    const x = itemById(l.item);
    if (!x || l.qty <= 0) continue;
    const vendor = vendorFor(x, buy);
    const carrier = carrierOf(x);
    const freight = buy.freight === 'aog' && aogOk(x, vendor) ? 'aog' : 'sched';
    const key = `${vendor}|${carrier}|${freight}`;
    const g = groups.get(key) ?? groups.set(key, { vendor, carrier, freight, lines: [], eta: freight === 'aog' ? W : W }).get(key)!;
    const qty = buyUnits(x, l.qty);
    g.lines.push({ item: l.item, qty, unit: cents(priceAt(x, vendor)), ...(l.order ? { order: l.order } : {}), ...(l.req ? { req: l.req } : {}) });
    if (freight === 'sched') g.eta = Math.max(g.eta, etaOf(W, x, vendor));
  }
  const out: PurchaseOrder[] = [];
  for (const g of groups.values()) {
    const freightCost = g.freight === 'aog' ? FREIGHT.aog : 0;
    const cost = cents(g.lines.reduce((n, l) => n + l.qty * l.unit, 0) + freightCost);
    const p: PurchaseOrder = { id: `po${s.nextId++}`, week: W, vendor: g.vendor, freight: g.freight, eta: g.eta, lines: g.lines, cost, freightCost, by, status: 'open', carrier: g.carrier };
    (s.pos ??= []).push(p);
    out.push(p);
  }
  return out;
}

/** a PO line for a job whose alert grounds a plane, restricts the only guest plane or closes a house now */
export function urgentJob(s: IslandState, o: Order | undefined, week = s.week): boolean {
  if (!o?.flow) return false;
  const a = s.alerts?.find((x) => x.id === o.flow!.alert);
  if (!a) return false;
  const asset = s.assets.find((x) => x.id === a.assetId);
  if (!asset) return false;
  if (asset.kind === 'plane') return alertAog(s, asset.id, week)?.id === a.id || restrictedBy(s, asset.id, week)?.id === a.id;
  if (asset.kind === 'house') {
    const h = hazardOn(s, asset.id);
    return h?.id === a.id && !h.safe;
  }
  return false;
}

const poUrgent = (s: IslandState, p: PurchaseOrder, week: number) => p.lines.some((l) => l.order && urgentJob(s, s.orders.find((o) => o.id === l.order), week));

/** the restocking fee for a line sent back */
export const restockFeeOf = (value: number) => Math.round(Math.max(STOCK.restockMin, value * STOCK.restock));

/** the task slot a job's line fills on its airplane (receiving checks the P/N against it) */
function slotOfLine(o: Order, item: ItemId): { ata: AnyAta; tag: string } | null {
  const task = o.flow ? taskById(o.flow.task) : undefined;
  if (!task) return null;
  const x = itemById(item);
  // the line's own slot, else the slot whose tag the item fills
  const pl = o.flow!.pick.find((l) => l.item === item);
  const named = pl?.slot ? task.main.find((m) => m.slot === pl.slot) : undefined;
  const m = named?.ata && named.tag ? named : task.main.find((mm) => mm.ata && mm.tag && x?.slot === mm.tag);
  return m?.ata && m.tag ? { ata: m.ata, tag: m.tag } : null;
}

/**
 * Receiving (resolve step 3): every PO due this week whose carrier ran (or
 * that came on the AOG boat), and every held PO released this week. The
 * paperwork by line type, then supersession (codes 1 and 2 ship as the new
 * P/N), then a job's line against the work order (receiving's judge for that
 * airplane: a wrong or displaced part goes back), then into stock (average
 * cost, a job's lines reserved to it, requisitions filled). A PO its carrier
 * didn't bring slips a week, unless a grounding job waits on it: then the AOG
 * boat brings it (freight). Then the allocation runs.
 */
export function receive(s: IslandState, W: number, flew: { guest: number; cargo: number }, line: Liner, judge?: (o: Order, ata: AnyAta, tag: string, pn: string) => { ok: boolean; why?: string; text: string }): Order[] {
  const cargoPlane = s.assets.some((a) => a.kind === 'plane' && MODELS[a.model]?.cargo);
  const pos = [...(s.pos ?? [])].sort((a, b) => idNum(a.id) - idNum(b.id));
  for (const p of pos) {
    let released = false;
    if (p.status === 'held') {
      if ((p.hold ?? W + 1) > W) continue;
      released = true;
    } else if (p.status !== 'open' || p.eta > W) continue;
    if (!released) {
      const carried =
        p.freight === 'aog' || p.carrier === 'boat' || (p.carrier === 'bulk' ? (cargoPlane ? flew.cargo > 0 : flew.guest > 0) : flew.guest + flew.cargo > 0);
      if (!carried) {
        const aogVendor = SUPPLIERS[p.vendor].aog && p.carrier !== 'boat';
        if (aogVendor && poUrgent(s, p, W)) {
          p.freight = 'aog';
          p.freightCost += FREIGHT.aog;
          p.cost = cents(p.cost + FREIGHT.aog);
          line('fin', 'bad', `No ${p.carrier === 'bulk' && cargoPlane ? 'cargo' : ''}${p.carrier === 'bulk' && cargoPlane ? ' ' : ''}flight carried ${p.id}, and a job it serves grounds its asset: the AOG boat brought it (${usd(FREIGHT.aog)}).`);
        } else {
          p.eta = W + 1;
          line('fin', 'info', `${p.id} (${SUPPLIERS[p.vendor].short}) waits a week: no ${p.carrier === 'bulk' && cargoPlane ? 'cargo flight' : 'flight'} carried it. It comes week ${W + 1}.`);
          continue;
        }
      }
    }
    receivePo(s, p, W, released, line, judge);
  }
  return allocate(s);
}

function receivePo(s: IslandState, p: PurchaseOrder, W: number, released: boolean, line: Liner, judge?: (o: Order, ata: AnyAta, tag: string, pn: string) => { ok: boolean; why?: string; text: string }) {
  const sup = SUPPLIERS[p.vendor];
  let held = 0;
  p.lines.forEach((l, i) => {
    if (l.got !== undefined || l.back) return;
    const x = itemById(l.item);
    if (!x) {
      l.got = 0;
      return;
    }
    // 1. paperwork (a released line's documents came)
    if (released) {
      if (!l.hold) return;
      delete l.hold;
    } else if (sup.paper && (x.kind === 'part' || x.kind === 'rotable') && x.trade === 'mech') {
      const chance = x.kind === 'rotable' ? (sup.paper.rotable ?? 0) : (sup.paper.part ?? 0);
      if (rng(hashSeed(s.seed, 'paper', p.id, i)).chance(chance)) {
        const doc = x.kind === 'rotable' ? sup.doc!.rotable : sup.doc!.part;
        l.hold = doc;
        held++;
        const what = p.vendor === 'broker' ? `the broker's ${x.nomen.toLowerCase()} has no traceability paperwork` : `the ${x.nomen.toLowerCase()} on ${p.id} came without ${doc}`;
        line('mech', 'bad', `Receiving: ${what}: quarantined until the vendor sends it (next week).`);
        (p.notes ??= []).push(`held: no ${doc} with ${x.pn}`);
        return;
      }
    }
    // 2. supersession: an INTCHG 1 or 2 part ships as the new P/N
    let id = l.item;
    if (x.supsdBy && x.supsdBy.code !== 3 && itemById(x.supsdBy.pn)) {
      id = x.supsdBy.pn;
      l.as = id;
      (p.notes ??= []).push(`shipped as ${id} (supersedes ${l.item}, INTCHG ${x.supsdBy.code})`);
      const o = l.order ? s.orders.find((oo) => oo.id === l.order) : undefined;
      if (o?.flow) {
        o.flow.pick = o.flow.pick.map((pl) => (pl.item === l.item ? { ...pl, item: id } : pl));
        o.flow.bench = o.flow.bench.map((pl) => (pl.item === l.item ? { ...pl, item: id } : pl));
      }
    }
    // 3. a job's part against its work order
    const o = l.order ? s.orders.find((oo) => oo.id === l.order) : undefined;
    const asset = o?.assetId ? s.assets.find((a) => a.id === o.assetId) : undefined;
    if (o?.flow && judge && asset?.kind === 'plane' && x.trade === 'mech') {
      const slot = slotOfLine(o, id);
      if (slot) {
        const c = judge(o, slot.ata, slot.tag, id);
        if (!c.ok && (c.why === 'wrong' || c.why === 'unlisted' || c.why === 'displaced')) {
          const value = l.qty * l.unit;
          const fee = restockFeeOf(value);
          l.back = c.text;
          l.got = 0;
          p.refund = cents((p.refund ?? 0) + value - fee);
          if (o.status !== 'done' && o.status !== 'cancelled') {
            o.flow.stop = `Sent back at receiving: ${c.text}`;
            if (c.why === 'displaced') o.flow.stopResearch = true;
            if (o.status === 'ready') o.status = 'waiting_part';
          }
          line('mech', 'bad', `Receiving on ${asset.name}: ${c.text}. Returned: ${usd(value - fee)} credited at the payment run (${usd(fee)} restocking).${c.why === 'displaced' ? ' Research the records for the part that goes on it.' : ' Repick it.'}`);
          return;
        }
      }
    }
    // 4. into stock
    const sl = lineOf(s, id);
    const value = l.qty * l.unit;
    const before = sl.on;
    const avgBefore = sl.avg ?? l.unit;
    sl.on = before + l.qty;
    sl.avg = cents((avgBefore * before + value) / Math.max(1, sl.on));
    sl.got ??= W;
    l.got = l.qty;
    bookRcv(s, value);
    if (o?.flow && o.status !== 'done' && o.status !== 'cancelled' && x.kind !== 'tool') reserve(s, o.id, jobLines(o).filter((jl) => jl.item === id));
    if (l.req) {
      const r = s.reqs?.find((rr) => rr.id === l.req);
      if (r && r.status === 'ordered') {
        r.status = 'filled';
        r.closed = W;
      }
    }
  });
  if (held > 0 || p.lines.some((l) => l.hold)) {
    p.status = 'held';
    p.hold = W + 1;
  } else {
    p.status = 'received';
    p.got = W;
    delete p.hold;
  }
}

/** the ledger category a line's money goes to */
export function spendCat(x: Item | undefined): SpendCat {
  if (!x) return 'parts';
  if (x.trade === 'build') return 'building';
  if (x.kind === 'tool') return 'tools';
  if (x.kind === 'consumable') return 'consumables';
  if (x.kind === 'rotable') return 'rotables';
  if (x.kind === 'material' || x.kind === 'lot') return 'materials';
  return 'parts';
}

/**
 * The payment run (resolve step 11: net 7): every PO received at an earlier
 * resolve is paid, less what was sent back and what the match caught, store
 * credit first. Booked by line category at the value paid (credit shown as
 * `cr`). Returns the cash paid, and of it the parts (lines) and the freight.
 */
export function payRun(s: IslandState, W: number, line: Liner): { cash: number; parts: number; freight: number } {
  let cash = 0;
  let parts = 0;
  let freight = 0;
  for (const p of s.pos ?? []) {
    if (p.status !== 'received' || (p.got ?? W) >= W) continue;
    const owed = poOwed(p);
    const cr = Math.min(s.credit ?? 0, owed);
    if (cr > 0) {
      s.credit = cents((s.credit ?? 0) - cr);
      bookCredit(s, cr);
    }
    s.cash = cents(s.cash - (owed - cr));
    cash += owed - cr;
    // what the lines cost (a line sent back: its restocking fee), then the freight
    let linesPaid = 0;
    for (const l of p.lines) {
      const x = itemById(l.as ?? l.item);
      const value = l.back ? restockFeeOf(l.qty * l.unit) : l.qty * l.unit;
      linesPaid += value;
      book(s, spendCat(x), value, { trade: x?.trade === 'build' ? 'build' : (x?.trade ?? 'mech') });
    }
    if (p.freightCost) book(s, 'freight', p.freightCost, { trade: tradeOfPo(p) });
    // the match's catch comes off (booked against the lines)
    if (p.caught) book(s, 'parts', -p.caught, { trade: tradeOfPo(p) });
    parts += linesPaid - (p.caught ?? 0);
    freight += p.freightCost;
    p.status = 'paid';
    p.paid = W;
  }
  if (cash > 0) line('fin', 'info', `Payment run: ${usd(cash)} to the vendors for what came in last week${(s.credit ?? 0) > 0 ? ` (store credit left ${usd(s.credit ?? 0)})` : ''}.`);
  return { cash: Math.round(cash), parts: Math.round(parts), freight: Math.round(freight) };
}

const tradeOfPo = (p: PurchaseOrder): ItemTrade => SUPPLIERS[p.vendor].trade;

/** closed POs and requisitions go after STOCK.keepWeeks */
export function prunePurchasing(s: IslandState, W: number) {
  if (s.pos) s.pos = s.pos.filter((p) => p.status !== 'paid' || (p.paid ?? W) > W - STOCK.keepWeeks);
  if (s.reqs) s.reqs = s.reqs.filter((r) => (r.status !== 'filled' && r.status !== 'cancelled') || (r.closed ?? W) > W - STOCK.keepWeeks);
}

/**
 * Replenishment (resolve step 11b): every line with a min/max at or under its
 * reorder point on inventory position is ordered up to max, whole packs, from
 * its default supplier, scheduled. Skipped under the freeze. It only refills
 * lines that hold a bin (never tools or building materials).
 */
export function replenish(s: IslandState, W: number, line: Liner, now = 0): PurchaseOrder[] {
  const want: BuyLine[] = [];
  for (const [id, l] of Object.entries(s.inv ?? {})) {
    if (l.rop === undefined || l.max === undefined) continue;
    const x = itemById(id);
    if (!x || x.kind === 'tool' || x.trade === 'build') continue;
    const ip = position(s, id);
    if (ip > l.rop) continue;
    const q = l.max - ip;
    if (q > 0) want.push({ item: id, qty: buyUnits(x, q) });
  }
  if (!want.length) return [];
  if (spendable(s) < ECON.freezeBelow) {
    line('fin', 'bad', `Replenishment skipped: spendable cash under ${usd(ECON.freezeBelow)} (${want.length} line${want.length > 1 ? 's' : ''} at their reorder point).`);
    return [];
  }
  const pos = placePo(s, want, {}, 'auto', now);
  const total = pos.reduce((n, p) => n + p.cost, 0);
  line('fin', 'info', `Replenishment: ${want.length} line${want.length > 1 ? 's' : ''} ordered up to max (${usd(total)}, ${pos.map((p) => p.id).join(', ')}).`);
  void W;
  return pos;
}

// ---------------------------------------------------------------------------
// Bins (9.6), carrying charge

const binless = (x: Item | undefined) => !x || x.kind === 'tool' || x.trade === 'build';

/** stores bins in use: lines holding free units or a min/max, and new lines on open stock POs */
export function binsInUse(s: IslandState): number {
  return binItems(s).size;
}

function binItems(s: IslandState): Set<ItemId> {
  const ids = new Set<ItemId>();
  for (const [id, l] of Object.entries(s.inv ?? {})) {
    if (binless(itemById(id))) continue;
    if (l.on - reservedOf(s, id) > 0 || l.rop !== undefined || l.max !== undefined) ids.add(id);
  }
  for (const p of s.pos ?? []) {
    if (p.status !== 'open' && p.status !== 'held') continue;
    for (const l of p.lines) if (!l.order && l.got === undefined && !l.back && !binless(itemById(l.as ?? l.item))) ids.add(l.as ?? l.item);
  }
  return ids;
}

export const binsTotal = (s: Pick<IslandState, 'tier'>) => tierDef(s.tier).bins;
/** does stocking this item take a bin it doesn't hold yet */
export const needsNewBin = (s: IslandState, item: ItemId) => !binless(itemById(item)) && !binItems(s).has(item);
/** a new bin is free */
export const binFree = (s: IslandState) => binsInUse(s) < binsTotal(s);

/** the carrying charge a week: storage and insurance on the stock's value */
export const carryCost = (s: IslandState) => Math.round(STOCK.carry * invValue(s));

/** open PO lines not received, at their price */
export function onOrderValue(s: IslandState): number {
  let v = 0;
  for (const p of s.pos ?? []) {
    if (p.status !== 'open' && p.status !== 'held') continue;
    for (const l of p.lines) if (l.got === undefined && !l.back) v += l.qty * l.unit;
  }
  return Math.round(v);
}

// ---------------------------------------------------------------------------
// Scrap (9.8)

/** return free units to the vendor (75% of average cost as store credit, the rest a loss) or write a consumable off */
export function scrapItem(s: IslandState, item: ItemId, qty: number): { credit: number; loss: number } {
  const x = itemById(item);
  const unit = unitCost(s, item);
  const line = lineOf(s, item);
  line.on -= qty;
  const value = unit * qty;
  const returnable = !!x && x.kind !== 'consumable';
  const credit = returnable ? cents(value * STOCK.returnCredit) : 0;
  const loss = cents(value - credit);
  if (credit) s.credit = cents((s.credit ?? 0) + credit);
  bookLoss(s, loss);
  tidy(s, item);
  return { credit, loss };
}

// ---------------------------------------------------------------------------
// Starter stock (19.3)

/** the item a starter line puts on this island's shelf (a plane line: the airplane's effective P/N, or the near-miss beside it) */
export function starterItem(s: IslandState, l: StarterLine): ItemId | undefined {
  if (l.item) return l.item;
  if (!l.plane) return undefined;
  const asset = s.assets.find((a) => a.kind === 'plane' && planeModel(a.model) === l.plane!.model);
  if (!asset) return undefined;
  const ac = islandAircraft(s.seed, asset);
  const fig = ipcFor(ac, l.plane.ata as AnyAta);
  const row = rowFor(fig, l.plane.tag);
  if (!row) return undefined;
  if (!l.plane.other) return itemById(row.pn) ? row.pn : undefined;
  // the near-miss: another procurable P/N of the same slot (the other SB state's, or the other block's)
  const other = fig.rows.find((r) => r.tag === l.plane!.tag && r.pn !== row.pn && !r.np && !r.alt && itemById(r.pn));
  return other?.pn;
}

/** put a tier's starter lines on the shelf (on hand added, min/max set where the table has them; at list cost) */
export function addStarter(s: IslandState, tier: number): number {
  let value = 0;
  for (const l of STARTER[tier] ?? []) {
    const id = starterItem(s, l);
    const x = id ? itemById(id) : undefined;
    if (!id || !x) continue;
    const line = lineOf(s, id);
    const unit = priceAt(x);
    line.avg = cents(((line.avg ?? unit) * line.on + unit * l.qty) / Math.max(1, line.on + l.qty));
    line.on += l.qty;
    line.got ??= s.week;
    if (l.rop !== undefined) line.rop = l.rop;
    if (l.max !== undefined) line.max = l.max;
    value += unit * l.qty;
  }
  return Math.round(value);
}

// ---------------------------------------------------------------------------
// Analytics (14.2): families, velocity, classes, flags, needs

export type Family = { fam: string; label: string; trade: ItemTrade; group: 'parts' | 'consumables' | 'materials'; items: ItemId[] };
export type Velocity = {
  fam: string;
  series: number[];
  weeksUsed: number;
  perWeek: number;
  sd: number;
  valueMoved: number;
  lastUsed: number | null;
  onHand: number;
  value: number;
  turns: number | null;
};
export type MoveClass = 'fast' | 'steady' | 'slow' | 'dead' | 'new';
export type StockFlag = { item?: ItemId; fam?: string; kind: 'order' | 'stop' | 'norop' | 'bins' | 'held'; text: string; urgent: boolean; act?: Action };

const TAG_LABEL: Record<string, string> = {
  tire: 'Main tires',
  tube: 'Main tubes',
  lining: 'Brake linings',
  disc: 'Brake discs',
  wheel: 'Wheel assemblies',
  filter: 'Hydraulic filter elements',
  radio: 'Com radios',
  generator: 'Alternators / starter-generators',
  belt: 'Alternator belts',
  oilFilter: 'Oil filters',
  propBolt: 'Prop bolts',
  connector: 'Radio connector kits',
  lockScrew: 'Radio cam-lock screws',
};
const MODEL_LABEL: Record<string, string> = { twin: 'twin', cargo: 'cargo', float: 'float' };

function famLabel(fam: string, x: Item): string {
  const [tag, model] = fam.split(':');
  if (x.trade === 'mech' && x.slot && (model || fam === x.slot)) return `${TAG_LABEL[tag] ?? x.nomen.split(',')[0].toLowerCase().replace(/^./, (c) => c.toUpperCase())}${model ? ` (${MODEL_LABEL[model] ?? model})` : ''}`;
  return x.nomen;
}

const memo = new WeakMap<IslandState, Map<string, unknown>>();
function cached<T>(s: IslandState, key: string, f: () => T): T {
  let m = memo.get(s);
  if (!m) memo.set(s, (m = new Map()));
  if (m.has(key)) return m.get(key) as T;
  const v = f();
  m.set(key, v);
  return v;
}

/** families with stock, use, open POs or known demand on this island (tools have no class) */
export function families(s: IslandState): Family[] {
  return cached(s, 'families', () => {
    const ids = new Set<ItemId>();
    for (const [id, l] of Object.entries(s.inv ?? {})) if (l.on > 0 || l.rop !== undefined) ids.add(id);
    for (const r of s.ledger ?? []) for (const id of Object.keys(r.use ?? {})) ids.add(id);
    for (const p of s.pos ?? []) if (p.status === 'open' || p.status === 'held') for (const l of p.lines) ids.add(l.as ?? l.item);
    const by = new Map<string, Family>();
    for (const id of [...ids].sort()) {
      const x = itemById(id);
      if (!x || x.kind === 'tool') continue;
      const fam = famOf(id);
      const f = by.get(fam) ?? by.set(fam, { fam, label: famLabel(fam, x), trade: x.trade, group: x.kind === 'consumable' ? 'consumables' : x.trade === 'mech' ? 'parts' : 'materials', items: [] }).get(fam)!;
      f.items.push(id);
    }
    return [...by.values()];
  });
}

const famItems = (s: IslandState, fam: string) => families(s).find((f) => f.fam === fam)?.items ?? allItems().filter((x) => x.fam === fam).map((x) => x.id);

/** a family's use over the ledger's weeks (oldest first, at most 26) */
export function velocity(s: IslandState, fam: string): Velocity {
  return cached(s, `vel:${fam}`, () => {
    const items = new Set(famItems(s, fam));
    const rows = [...(s.ledger ?? [])].sort((a, b) => a.w - b.w).slice(-STOCK.ledgerWeeks);
    const series = rows.map((r) => [...items].reduce((n, id) => n + (r.use?.[id] ?? 0), 0));
    const weeksUsed = series.filter((v) => v > 0).length;
    const n = series.length || 1;
    const perWeek = series.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(series.reduce((a, v) => a + (v - perWeek) ** 2, 0) / n);
    let valueMoved = 0;
    rows.forEach((r) => {
      for (const id of items) if (r.use?.[id]) valueMoved += r.use[id] * unitCost(s, id);
    });
    let lastUsed: number | null = null;
    rows.forEach((r, i) => {
      if (series[i] > 0) lastUsed = r.w;
    });
    let onHandN = 0;
    let value = 0;
    for (const id of items) {
      const on = onHand(s, id);
      onHandN += on;
      value += on * unitCost(s, id);
    }
    const turns = value > 0 ? Math.round(((52 * (valueMoved / n)) / value) * 10) / 10 : null;
    return { fam, series, weeksUsed, perWeek, sd, valueMoved: Math.round(valueMoved), lastUsed, onHand: onHandN, value: Math.round(value), turns };
  });
}

/** fast / steady / slow among the families used, dead (on hand, no use in 26 weeks), new (first received under 8 weeks ago); null under 8 weeks of ledger */
export function moveClass(s: IslandState, fam: string): MoveClass | null {
  const weeks = (s.ledger ?? []).length;
  if (weeks < 8) return null;
  return cached(s, `class:${fam}`, () => {
    const v = velocity(s, fam);
    if (v.weeksUsed === 0) {
      const first = Math.min(...famItems(s, fam).map((id) => s.inv?.[id]?.got ?? Infinity));
      if (Number.isFinite(first) && s.week - first < 8) return 'new';
      if (v.onHand > 0 && weeks >= STOCK.ledgerWeeks) return 'dead';
      return 'slow';
    }
    const used = families(s)
      .map((f) => velocity(s, f.fam))
      .filter((x) => x.weeksUsed > 0)
      .sort((a, b) => b.weeksUsed - a.weeksUsed || b.valueMoved - a.valueMoved || (a.fam < b.fam ? -1 : 1));
    const i = used.findIndex((x) => x.fam === fam);
    const third = used.length / 3;
    return i < third ? 'fast' : i >= used.length - third ? 'slow' : 'steady';
  });
}

/** airworthiness and hazard causes need these families on the island's own models and houses: never flagged to stop, one job's worth kept */
export function insuranceSpare(s: IslandState, fam: string): boolean {
  const [tag, model] = fam.split(':');
  const planes = new Set(s.assets.filter((a) => a.kind === 'plane').map((a) => planeModel(a.model)));
  if (['tire', 'tube', 'lining', 'filter', 'generator'].includes(tag)) return !!model && planes.has(model as never);
  if (fam === 'radio') return planes.size > 0;
  const x = allItems().find((i) => i.fam === fam);
  if (!x || x.trade !== 'elec') return false;
  const sp = x.spec ?? {};
  return !!(sp.gfci || sp.afci || sp.df) && s.assets.some((a) => a.kind === 'house');
}

/** one job's worth of an insurance spare */
const jobWorth = (fam: string) => (fam.startsWith('lining') ? 4 : 1);

/** demand nobody has covered yet that needs no diagnosis: inspections coming due, the open build's next units, a take-off's tools */
export function knownDemand(s: IslandState, item: ItemId): { week: number; qty: number; why: string }[] {
  const out: { week: number; qty: number; why: string }[] = [];
  for (const p of s.assets.filter((a) => a.kind === 'plane')) {
    // a plane within two weeks of its 100-hour at its flights a week
    const per = flightsPerPlane(s.tier);
    const toGo = ECON.planeInspectionFlights - 2 - (p.sinceInspection ?? 0);
    if (toGo > 2 * per) continue;
    if (s.orders.some((o) => o.assetId === p.id && o.kind === 'inspect100' && o.status !== 'cancelled' && o.status !== 'done')) continue;
    const task = taskById(`amm:${planeModel(p.model)}:${planeModel(p.model) === 'cargo' ? '05-20-02' : '05-20-01'}`);
    if (!task) continue;
    for (const b of benchFor(task, islandAircraft(s.seed, p), p)) if (b.item === item) out.push({ week: s.week + Math.max(0, Math.ceil(toGo / per) - 1), qty: b.qty, why: `${p.name}'s 100-hour` });
  }
  for (const h of s.assets.filter((a) => a.kind === 'house')) {
    if ((h.inspectionUntil ?? 0) - s.week > 2 || item !== 'LABELS') continue;
    out.push({ week: h.inspectionUntil ?? s.week, qty: 1, why: `${h.name}'s code inspection` });
  }
  // the open build's next two units (building materials)
  const b = (s.builds ?? []).find((x) => x.finished === undefined);
  const def = b ? buildDef(b.id) : undefined;
  if (b && def) {
    const from = Math.floor(b.drawn ?? 0);
    def.units.slice(from, from + 2).forEach((u, k) => {
      const q = u[item];
      if (q) out.push({ week: s.week + k, qty: q, why: `the builders: ${b.what}` });
    });
  }
  for (const a of liveAlerts(s)) {
    if (a.status !== 'open' || a.src !== 'takeoff' || !a.task) continue;
    const t = taskById(a.task);
    if (t?.tools.includes(item) && !owned(s, item)) out.push({ week: a.due, qty: 1, why: `the take-off on ${s.assets.find((x) => x.id === a.assetId)?.name ?? 'site'}` });
  }
  return out;
}

/** the open alerts nobody has planned: no P/N, no effectivity (14.2) */
export function needs(s: IslandState): { alert: string; trade: OpsRole; asset: string; text: string; due: number; aw: boolean; nudged?: number }[] {
  return liveAlerts(s)
    .filter((a) => a.status === 'open')
    .map((a) => {
      const asset = s.assets.find((x) => x.id === a.assetId);
      const f = alertFlags(s, a);
      const tech = s.players[a.role]?.name ?? (a.role === 'mech' ? 'the mechanic' : 'the electrician');
      const what = symptomOf(a) ? shortSymptom(s, a) : 'an alert';
      return {
        alert: a.id,
        trade: a.role,
        asset: a.assetId,
        text: `${asset?.name ?? 'Asset'}: ${what}, due wk ${a.due} · ${tech} hasn't planned it`,
        due: a.due,
        aw: f.aw || f.hazard,
        ...(a.nudged !== undefined ? { nudged: a.nudged } : {}),
      };
    })
    .sort((x, y) => x.due - y.due || Number(y.aw) - Number(x.aw));
}

/** the symptom in a few words for the analyst (no P/N): the first clause, lower case */
export function shortSymptom(s: IslandState, a: Alert): string {
  return alertShort(s, a);
}

/** a reorder point and order-up-to level from the family's use (plane parts) or the item's (consumables, materials) */
export function suggestRop(s: IslandState, item: ItemId): { rop: number; max: number; why: string } {
  const x = itemById(item);
  if (!x) return { rop: 0, max: 0, why: '' };
  const fam = famOf(item);
  const v = velocity(s, fam);
  const L = x.lead + SUPPLIERS[DEFAULT_SUPPLIER[x.trade]].leadAdd;
  let rop = Math.ceil(v.perWeek * L + STOCK.z * v.sd * Math.sqrt(L));
  let max = rop + Math.max(x.pack > 1 && !x.cut ? x.pack : 1, Math.ceil(v.perWeek * STOCK.coverWeeks));
  const spare = insuranceSpare(s, fam);
  if (spare) {
    max = Math.max(max, jobWorth(fam));
    rop = Math.max(rop, 0);
  }
  const used = v.series.reduce((a, b) => a + b, 0);
  const label = families(s).find((f) => f.fam === fam)?.label ?? x.nomen;
  const why = `${label}: ${used} used in ${v.series.length} week${v.series.length === 1 ? '' : 's'}, lead ${L} week${L > 1 ? 's' : ''}: keep ${rop}, order up to ${max}${spare ? ' (an insurance spare)' : ''}.`;
  return { rop, max, why };
}

/** the planner's flags: urgent first */
export function stockFlags(s: IslandState): StockFlag[] {
  return cached(s, 'flags', () => {
    const out: StockFlag[] = [];
    const W = s.week;
    // order: IP less the known demand within the lead is under the reorder point (no ROP: under 0)
    const seen = new Set<ItemId>();
    const cands = new Set<ItemId>([...Object.keys(s.inv ?? {}), ...(s.reqs ?? []).filter((r) => r.status === 'open').map((r) => r.item)]);
    for (const o of s.orders) if (o.flow && o.approvedWeek !== undefined && o.status === 'waiting_part') for (const l of uncovered(s, o)) cands.add(l.item);
    for (const id of cands) {
      const x = itemById(id);
      if (!x || seen.has(id)) continue;
      seen.add(id);
      const l = s.inv?.[id];
      const L = x.lead + SUPPLIERS[DEFAULT_SUPPLIER[x.trade]].leadAdd;
      const known = knownDemand(s, id).filter((d) => d.week <= W + L).reduce((n, d) => n + d.qty, 0);
      const ip = position(s, id) - known;
      const rop = l?.rop;
      if (!(rop !== undefined ? ip < rop : ip < 0)) continue;
      // a job waiting on it: its requisition (or card) is the one-tap action
      const waiting = s.orders.find((o) => o.flow && o.status !== 'done' && o.status !== 'cancelled' && jobShort(s, o).some((jl) => jl.item === id));
      const req = (s.reqs ?? []).find((r) => r.item === id && r.status === 'open');
      const act: Action | undefined = req
        ? { t: 'approveReq', reqs: [req.id] }
        : waiting?.status === 'pending'
          ? { t: 'approve', orderId: waiting.id }
          : { t: 'buy', lines: [{ item: id, qty: Math.max(1, (l?.max ?? Math.max(1, -ip)) - Math.max(0, ip)) }] };
      const who = waiting ? s.players[waiting.role]?.name : undefined;
      out.push({
        item: id,
        fam: x.fam,
        kind: 'order',
        urgent: !!waiting,
        text: waiting ? `${who ?? 'A tech'}'s job waits on ${x.pn}: ${waiting.title}` : `${x.pn} is at its reorder point (${Math.max(0, Math.round(ip))} on position, reorder at ${rop ?? 0})`,
        ...(act ? { act } : {}),
      });
    }
    // stop: dead, or slow with a min/max and no known demand for 8 weeks, and not an insurance spare
    for (const f of families(s)) {
      const c = moveClass(s, f.fam);
      if (c !== 'dead' && c !== 'slow') continue;
      if (insuranceSpare(s, f.fam)) continue;
      const v = velocity(s, f.fam);
      if (v.onHand <= 0) continue;
      const minmax = f.items.some((id) => s.inv?.[id]?.rop !== undefined);
      if (c === 'slow' && !minmax) continue;
      if (f.items.some((id) => knownDemand(s, id).length)) continue;
      const last = v.lastUsed === null ? 'no use in 26 weeks' : `last used week ${v.lastUsed}`;
      out.push({ fam: f.fam, kind: 'stop', urgent: false, text: `Stop stocking ${f.label}: ${last} (${usd(v.value)} on the shelf, a bin).` });
    }
    // norop: a fast family's item with no reorder point
    for (const f of families(s)) {
      if (moveClass(s, f.fam) !== 'fast') continue;
      for (const id of f.items) if (s.inv?.[id] && s.inv[id].rop === undefined) out.push({ item: id, fam: f.fam, kind: 'norop', urgent: false, text: `${itemById(id)?.pn ?? id} moves fast and has no min/max.` });
    }
    const free = binsTotal(s) - binsInUse(s);
    if (free < 3) out.push({ kind: 'bins', urgent: free <= 0, text: `Stores ${binsInUse(s)}/${binsTotal(s)} bins: ${free <= 0 ? 'full' : `${free} free`}.` });
    for (const p of s.pos ?? []) if (p.status === 'held') out.push({ kind: 'held', urgent: false, text: `${p.id}: ${p.notes?.find((n) => n.startsWith('held')) ?? 'held at receiving'}, released week ${p.hold ?? W + 1}.` });
    return out.sort((a, b) => Number(b.urgent) - Number(a.urgent));
  });
}

// ---------------------------------------------------------------------------
// The analyst's desk puzzles, fed real items (17.3)

/** a broker's lot of items the island uses and hasn't stocked to max: 2-4 lines */
export function auctionLot(s: IslandState, r: Rng): { lines: { item: ItemId; qty: number }[]; fair: number; list: number } | null {
  const used = families(s)
    .map((f) => ({ f, v: velocity(s, f.fam) }))
    .filter((x) => x.v.weeksUsed > 0 || x.f.items.some((id) => (s.inv?.[id]?.rop ?? -1) >= 0));
  const cands: ItemId[] = [];
  const usedIds = new Set<ItemId>();
  for (const r of s.ledger ?? []) for (const [id, q] of Object.entries(r.use ?? {})) if ((q ?? 0) > 0) usedIds.add(id);
  for (const { f } of used)
    for (const id of f.items) {
      const x = itemById(id);
      const l = s.inv?.[id];
      // a broker's lot is shop stock: consumables, materials and small parts the island itself draws (never a lot, a rotable, a tool or a building material)
      if (!x || x.kind === 'tool' || x.kind === 'lot' || x.kind === 'rotable' || x.trade === 'build' || priceAt(x) > STOCK.lotMaxUnit) continue;
      if (!usedIds.has(id) && l?.rop === undefined) continue;
      if (l?.max !== undefined && onHand(s, id) >= l.max) continue;
      cands.push(id);
    }
  if (cands.length < 2) return null;
  const pick = r.shuffle([...new Set(cands)]).slice(0, 2 + r.int(0, Math.min(2, cands.length - 2)));
  const lines = pick.map((id) => {
    const x = itemById(id)!;
    return { item: id, qty: x.cut ? x.pack : Math.max(1, x.pack) };
  });
  const list = lines.reduce((n, l) => n + priceAt(itemById(l.item)!) * l.qty, 0);
  const broker = lines.reduce((n, l) => {
    const x = itemById(l.item)!;
    return n + priceAt(x, x.trade === 'mech' ? 'broker' : 'online') * l.qty;
  }, 0);
  return { lines, fair: Math.round(broker * 0.85), list: Math.round(list) };
}

export type InvoiceContext = {
  pos: { id: string; vendor: string; freight: number; lines: { pn: string; nomen: string; qty: number; unit: number; got: number }[] }[];
};

/** the POs received at the last resolve and not paid yet: the three-way match's real lines */
export function invoiceContext(s: IslandState): InvoiceContext | undefined {
  const W = s.week;
  const pos = (s.pos ?? []).filter((p) => p.status === 'received' && p.got === W - 1);
  if (!pos.length) return undefined;
  return {
    pos: pos.map((p) => ({
      id: p.id,
      vendor: SUPPLIERS[p.vendor].name,
      freight: p.freightCost,
      lines: p.lines.map((l) => {
        const x = itemById(l.as ?? l.item);
        return { pn: x?.pn ?? l.item, nomen: x?.nomen ?? l.item, qty: l.qty, unit: l.unit, got: l.got ?? 0 };
      }),
    })),
  };
}

// ---------------------------------------------------------------------------
// Requisitions

export function newReq(s: IslandState, r: Omit<Requisition, 'id' | 'week' | 'status'>): Requisition {
  const q: Requisition = { id: `rq${s.nextId++}`, week: s.week, status: 'open', ...r };
  (s.reqs ??= []).push(q);
  return q;
}

/** the value of a requisition at its default supplier's price (the analyst's queue) */
export function reqValue(r: Pick<Requisition, 'item' | 'qty'>): number {
  const x = itemById(r.item);
  if (!x) return 0;
  return Math.round(priceAt(x, DEFAULT_SUPPLIER[x.trade]) * buyUnits(x, r.qty));
}

/** a line on a buy: its value at a supplier (whole packs) */
export function buyValue(item: ItemId, qty: number, vendor?: SupplierId): number {
  const x = itemById(item);
  if (!x) return 0;
  return cents(priceAt(x, vendor ?? DEFAULT_SUPPLIER[x.trade]) * buyUnits(x, qty));
}

export const TIERS_BINS = TIERS.map((t) => t.bins);
