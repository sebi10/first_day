// The analyst's desk as data (docs/JOBFLOW.md 14.3, 17.3): approval cards,
// the requisition queue, the stock planner's rows, flags and needs, an item's
// sheet, receiving, and the Money tab's numbers. Pure: every function reads the
// island and A's selectors and returns plain words and numbers, so the screens
// stay thin and tests/purchasing.test.ts can pin them. Nothing here is stored,
// and nothing names an effectivity (0.2 rule 7): a family's numbers are the
// family's, a need has no P/N.
import { alertFlags, liveAlerts, soleGuest, symptomText } from '../../sim/alerts';
import { DEFAULT_SUPPLIER, FREIGHT, MODELS, ROLE_LABEL, STOCK, SUPPLIERS } from '../../sim/data';
import { expectedDeferralCost, fixedNow, outOfService, projectWeek, tierDef, urgency } from '../../sim/econ';
import { cardOf, repairTask, type Card } from '../../sim/flow';
import { allItems, buyUnits, famOf, itemById, priceAt } from '../../sim/items';
import { assetSpend, capitalCost, cashInStock, committed, fillRate, payable, poOwed, runway, spendable, spendSeries, stockBuiltUsed, tradeSpend, waitWeeks, type OutCat } from '../../sim/ledger';
import { search, supplyIndex } from '../../sim/search';
import { payroll, STAFF, NPC_ROLES } from '../../sim/staff';
import {
  aogOk,
  available,
  binsInUse,
  binsTotal,
  carrierOf,
  etaOf,
  families,
  flowRows,
  flowWeeks,
  insuranceSpare,
  invValue,
  jobLines,
  knownDemand,
  moveClass,
  needs,
  needsNewBin,
  onHand,
  position,
  reqValue,
  reservedFor,
  reservedOf,
  schedFreight,
  stockFlags,
  suggestRop,
  unitCost,
  urgentJob,
  velocity,
  type Family,
  type MoveClass,
  type StockFlag,
} from '../../sim/stock';
import { taskById } from '../../sim/tasks';
import { shipWords } from '../select';
import type { Action, Alert, BuyChoice, Freight, IslandState, Item, ItemId, ItemTrade, NpcRole, OpsRole, Order, PurchaseOrder, Requisition, Role, SupplierId } from '../../sim/types';

// ---------------------------------------------------------------------------
// Words

/** "$1,234" (a minus sign for negatives), as kit.tsx prints money */
export const usd = (n: number) => {
  const v = Math.round(n);
  const s = `$${Math.abs(v).toLocaleString('en-US')}`;
  return v < 0 ? `−${s}` : s;
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const cents = (v: number) => Math.round(v * 100) / 100;
const nameOf = (s: IslandState, r: Role) => s.players[r]?.name ?? ROLE_LABEL[r];
const assetName = (s: IslandState, id: string | null | undefined) => s.assets.find((a) => a.id === id)?.name ?? '';

/**
 * A family or item label short enough for one line on a phone: the first clause of
 * the catalog's nomenclature ("Duplex receptacle 15 A"), the next one too when the
 * first is a bare noun ("Breaker, 1-pole 15 A (KP)"), the generator's parts by what
 * they are ("Generator fuel filter").
 */
export function shortLabel(label: string): string {
  // a lot is named for what it's for ("Fuel dock run lot"), not its first line
  const lot = /^(.{3,40}? lot): /.exec(label);
  if (lot) return lot[1].charAt(0).toUpperCase() + lot[1].slice(1);
  const parts = label.replace(/^Standby generator \([^)]*\): /i, 'Generator ').split(', ');
  let t = parts[0];
  // a bare noun takes the next clause; a size or rating comes along ("Safety wire, 0.032 in", "Pin, cotter, 1/16 x 3/4 in"),
  // a remark in brackets or the pack size ("1 qt") doesn't
  const rating = (p: string) => /\d/.test(p) && !/[()]/.test(p) && !/^\d+(\.\d+)? ?(qt|gal|lb|oz)$/.test(p);
  for (const p of parts.slice(1)) {
    if (!(t.length < 12 || rating(p)) || `${t}, ${p}`.length > 44) break;
    t = `${t}, ${p}`;
  }
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * The electrical families by category and rating, as the spec names them ("GFCI receptacles 20 A",
 * "AFCI protection 15 A", "THWN-2 #6"). A family holds the right device and its near-miss side by
 * side, so it is named for what they have in common, never for either one.
 */
export const FAM_LABEL: Record<string, string> = {
  afci15: 'AFCI protection 15 A',
  afci20: 'AFCI protection 20 A',
  df15: 'Dual-function protection 15 A',
  df20: 'Dual-function protection 20 A',
  gfci15: 'GFCI receptacles 15 A',
  gfci20: 'GFCI receptacles 20 A',
  gfciBrk20: 'GFCI breakers 20 A',
  recep15: 'Duplex receptacles 15 A',
  recep20: 'Duplex receptacles 20 A',
  recepWr20: 'Weather-resistant receptacles 20 A',
  single15: 'Single receptacles 15 A',
  single20: 'Single receptacles 20 A',
  brk15: 'Breakers 15 A',
  brk20: 'Breakers 20 A',
  brk2p: 'Breakers, 2-pole',
  box1g: 'Boxes, 1-gang',
  box2g: 'Boxes, 2-gang',
  box4sq: 'Boxes, 4 in square',
  boxWp: 'Boxes, weatherproof',
  wpcover: 'Weatherproof covers',
  emt12: 'EMT 1/2 in',
  emt34: 'EMT 3/4 in',
  emtConn: 'EMT connectors',
  pvc1: 'PVC conduit 1 in',
  groundClamp: 'Ground clamps',
  groundRod: 'Ground rods',
  splice: 'Feeder splices',
  spaPanel: 'Spa panels',
  bare6: 'Bare copper #6',
  thwn3: 'THWN-2 #3',
  thwn6: 'THWN-2 #6',
  thwn8: 'THWN-2 #8',
  thwn10: 'THWN-2 #10',
  thwn12: 'THWN-2 #12',
  'nm10-2': 'NM-B 10/2',
  'nm12-2': 'NM-B 12/2',
  'nm12-3': 'NM-B 12/3',
  'nm14-2': 'NM-B 14/2',
  'nm14-3': 'NM-B 14/3',
  'uf12-2': 'UF-B 12/2',
  switch1: 'Switches, single-pole',
  switch3: 'Switches, 3-way',
  switch4: 'Switches, 4-way',
  relay: 'Transfer panel relays',
  whElement: 'Water heater elements',
};

/** a family's name on the desk */
export const famName = (fam: string, label: string) => FAM_LABEL[fam] ?? shortLabel(label);

/** a name mid-sentence: "water heater element, 4,500 W 240 V" (an acronym or a P/N keeps its case) */
export const lowerFirst = (t: string) => (/^[A-Z][a-z]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t);

/** "a, b and c" */
export const listWords = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** "25 uses", "12 qt", "61 ft", "4" */
export function qtyWords(x: Item | undefined, qty: number): string {
  if (!x) return String(qty);
  const u = x.unit === 'use' || x.unit === 'lot' ? (qty === 1 ? x.unit : `${x.unit}s`) : x.unit === 'ea' ? '' : x.unit;
  return u ? `${qty} ${u}` : String(qty);
}

/** an item in a few words: its P/N and the first clause of its name */
export const itemWords = (x: Item | undefined, id: ItemId) => (x ? `${x.pn} ${lowerFirst(shortLabel(x.nomen))}` : id);

/** when a delivery lands, said the way the desk says it */
export function etaWords(s: IslandState, eta: number): string {
  return eta <= s.week ? 'here tonight' : eta === s.week + 1 ? 'here next week' : `here wk ${eta}`;
}

/** how a scheduled line travels: the carrier class a PO rides (3.6) */
export function carrierWords(s: IslandState, carrier: PurchaseOrder['carrier'], freight: Freight): string {
  if (freight === 'aog') return 'AOG boat';
  if (carrier === 'boat') return 'supply boat';
  if (carrier === 'bulk') return s.assets.some((a) => a.kind === 'plane' && MODELS[a.model]?.cargo) ? 'cargo flight' : 'a guest flight';
  return 'next flight';
}

/**
 * A PO due this week whose carrier can't fly: the plane it rides is out of service (the cargo
 * plane for bulk, else any plane). At the resolve it slips a week, unless its job grounds an
 * asset: then the AOG boat brings it (receiving's rule).
 */
export function carrierDown(s: IslandState, p: Pick<PurchaseOrder, 'carrier' | 'freight' | 'eta'>): string | null {
  if (p.freight === 'aog' || p.carrier === 'boat' || p.eta > s.week) return null;
  const planes = s.assets.filter((a) => a.kind === 'plane');
  const cargo = planes.filter((a) => MODELS[a.model]?.cargo);
  const rides = p.carrier === 'bulk' && cargo.length ? cargo : planes;
  if (!rides.length || rides.some((a) => !outOfService(s, a.id))) return null;
  return rides.length === 1 ? `${rides[0].name} is down` : 'no plane is flying';
}

/** a supplier as the analyst compares them: price, lead, paperwork, the AOG boat */
export function supplierNote(v: SupplierId): string {
  const d = SUPPLIERS[v];
  const off = Math.round((1 - (d.mult.parts ?? d.mult.rest)) * 100);
  const offCons = Math.round((1 - (d.mult.consumables ?? d.mult.rest)) * 100);
  const bits: string[] = [];
  if (off > 0) bits.push(offCons !== off ? `−${off}% parts, −${offCons}% consumables` : `−${off}%`);
  else bits.push('list price');
  if (d.leadAdd) bits.push(`+${plural(d.leadAdd, 'week')}`);
  const held = Math.max(d.paper?.part ?? 0, d.paper?.rotable ?? 0);
  if (held >= 0.2) bits.push(`1 in ${Math.round(1 / held)} held for traceability`);
  if (!d.aog) bits.push('no AOG boat');
  return bits.join(' · ');
}

/** each trade's two suppliers: the default and the cheaper one */
export const SUPPLIER_PAIR: Record<ItemTrade, [SupplierId, SupplierId]> = { mech: ['oem', 'broker'], elec: ['supply', 'online'], build: ['yard', 'barge'] };

// ---------------------------------------------------------------------------
// Approvals: flow cards (8.6, 17.3)

export type Tone = 'rust' | 'sea' | 'palm' | 'ink' | 'amber' | '';
export type ChipVM = { text: string; tone: Tone };
export type LineVM = { item: ItemId; pn: string; nomen: string; qty: number; qtyText: string; value: number };
export type BuyLineVM = LineVM & { unit: number; supplier: SupplierId; eta: number; etaText: string; tool?: boolean };
/** a freight choice in words; `ship`: the scheduled shipment's charge in words ("+$35 freight: its own shipment") */
export { shipWords };

export type FreightVM = { eta: number; text: string; out: string; cost?: number; ship?: string };
export type CardVM = {
  id: string;
  title: string;
  role: OpsRole;
  who: string;
  asset: string;
  symptom: string;
  task: string;
  tier: number;
  fromStock: LineVM[];
  fromStockValue: number;
  toBuy: BuyLineVM[];
  tools: BuyLineVM[];
  labour: number;
  buyTotal: number;
  total: number;
  freight: { pick: Freight; sched: FreightVM; aog?: FreightVM };
  vendor: SupplierId;
  vendors: { v: SupplierId; label: string; note: string }[];
  chips: ChipVM[];
  budget: string;
  /** waiting a week costs about this (the deferral risk, and a grounded plane's or a closed house's week) */
  waitCost: number;
  /** came after the analyst ended the turn: what happens to it tonight */
  late?: string;
  /** an MEL placard on its alert: whether the mechanic has asked for the one extension, and whether the analyst can approve it */
  mel?: { alert: string; until: number; ext: boolean; asked: boolean; askedBy?: string; canExtend: boolean; /** the week the extension runs to */ to: number };
};

/** the flow cards waiting on the analyst this week: pending, not deferred this week, most urgent first */
export function flowQueue(s: IslandState): Order[] {
  return s.orders.filter((o) => !!o.flow && o.status === 'pending' && o.lastDeferredWeek !== s.week).sort((a, b) => urgency(s, b) - urgency(s, a) || (a.id < b.id ? -1 : 1));
}

/** today's cards (no job flow: legacy orders and the part chain's), as the old swipe stack took them */
export function legacyQueue(s: IslandState): Order[] {
  return s.orders.filter((o) => o.status === 'pending' && o.role !== 'fin' && !o.flow && o.lastDeferredWeek !== s.week).sort((a, b) => urgency(s, b) - urgency(s, a));
}

const alertOfOrder = (s: IslandState, o: Order): Alert | undefined => (o.flow ? s.alerts?.find((a) => a.id === o.flow!.alert) : undefined);

/** the standing limit a week: late cards and requisitions approved at the resolve (8.5) */
export const standingLimit = (s: IslandState) => s.standing ?? (s.autoBudget.mech ?? 0) + (s.autoBudget.elec ?? 0);

/** the card came in after the analyst ended the turn: the standing approval takes it tonight, or it waits */
export function lateWords(s: IslandState, at: number | undefined, total: number): string | undefined {
  const t = s.turns.fin;
  if (!t?.ended || t.endedAt === null || (at ?? 0) <= t.endedAt) return undefined;
  const limit = standingLimit(s);
  return total <= limit
    ? `Came after you ended your turn: it goes through tonight on your standing approval (${usd(limit)}) unless you defer it.`
    : `Came after you ended your turn, over your standing limit (${usd(limit)}): it waits for you.`;
}

/** what the asset does while the fix waits: AOG, restricted (the only guest plane), closed, or at 75% (made safe) */
function outState(s: IslandState, a: Alert | undefined): { word: string; share: number } | null {
  if (!a) return null;
  const asset = s.assets.find((x) => x.id === a.assetId);
  const f = alertFlags(s, a);
  if (asset?.kind === 'plane' && f.aw) return soleGuest(s, asset.id) ? { word: 'flies restricted', share: 0.5 } : { word: 'AOG', share: 1 };
  if (asset?.kind === 'house' && f.hazard) return a.safe ? { word: 'rents at 75%', share: 0.25 } : { word: 'closed', share: 1 };
  return null;
}

/** resolves out, in words: 1 is this week's */
const outWords = (n: number) => (n <= 1 ? 'this week' : n === 2 ? 'this week and next' : `${n} weeks`);


function freightVM(s: IslandState, card: Card, a: Alert | undefined, eta: number, outWeeks: number, aogCost?: number): FreightVM {
  const st = outState(s, a);
  const asset = s.assets.find((x) => x.id === a?.assetId);
  const week = card.downtime?.usd ?? 0;
  const out = st && outWeeks > 0 ? `${asset?.name ?? 'It'} ${st.word} ${outWords(outWeeks)}${week > 0 ? ` (~${usd(week * st.share * outWeeks)} of guests)` : ''}` : '';
  if (aogCost !== undefined) return { eta, text: `AOG boat +${usd(aogCost)}: ${etaWords(s, eta)}`, out, cost: aogCost };
  const f = card.freight.sched;
  const ship = shipWords(f);
  return { eta, text: `Scheduled${f.cost > 0 ? ` +${usd(f.cost)}` : ''}: ${etaWords(s, eta)}`, out, cost: f.cost, ...(ship ? { ship } : {}) };
}

/** the task a card names: "32-40-01 Main wheel, tire and tube" (a repair: its fix) */
function taskWords(s: IslandState, o: Order, a: Alert | undefined): string {
  const id = o.flow?.task ?? '';
  if (id.startsWith('repair:') && a) return repairTask(s, a)?.title ?? o.title;
  const t = taskById(id);
  if (!t) return o.title;
  return t.book === 'REF' ? `${t.no} ${t.title}` : t.book === 'GSM' ? `GSM ${t.no} ${t.title}` : `${t.no} ${t.title}`;
}

/** the approval card for a flow job (A's cardOf, in words): the lines, the supplier and freight choice, the chips */
export function cardVM(s: IslandState, o: Order, buy?: BuyChoice): CardVM {
  const card = cardOf(s, o, buy);
  const a = alertOfOrder(s, o);
  const role: OpsRole = o.role === 'elec' ? 'elec' : 'mech';
  const line = (id: ItemId, qty: number, value: number): LineVM => {
    const x = itemById(id);
    return { item: id, pn: x?.pn ?? id, nomen: x ? shortLabel(x.nomen) : id, qty, qtyText: qtyWords(x, qty), value: Math.round(value) };
  };
  const fromStock = card.fromStock.map((l) => line(l.item, l.qty, l.value));
  // a line due tonight whose carrier plane is down slips a week (or the boat brings it, for a job that grounds its asset)
  const downOf = (id: ItemId, eta: number) => {
    const x = itemById(id);
    return x ? carrierDown(s, { carrier: carrierOf(x), freight: 'sched', eta }) : null;
  };
  const toBuy: BuyLineVM[] = card.toBuy.map((l) => {
    const slip = card.freight.pick !== 'aog' ? downOf(l.item, l.eta) : null;
    return { ...line(l.item, l.qty, l.qty * l.unit), unit: l.unit, supplier: l.supplier, eta: l.eta, etaText: slip ? `slips a week: ${slip}` : etaWords(s, l.eta) };
  });
  // the scheduled choice in words, whichever freight is picked
  const down = card.toBuy.map((l) => downOf(l.item, card.freight.sched.eta)).find((d) => !!d) ?? null;
  const W = s.week;
  const tools: BuyLineVM[] = card.tools.map((t) => {
    const x = itemById(t.item);
    const v = x ? (buy?.vendor && SUPPLIERS[buy.vendor].trade === x.trade ? buy.vendor : DEFAULT_SUPPLIER[x.trade]) : 'oem';
    const eta = x ? etaOf(W, x, v) : W;
    return { ...line(t.item, 1, t.price), unit: t.price, supplier: v, eta, etaText: etaWords(s, eta), tool: true };
  });
  const buyTotal = Math.round(toBuy.reduce((n, l) => n + l.qty * l.unit, 0) + tools.reduce((n, t) => n + t.value, 0));
  const chips: ChipVM[] = [];
  if (card.aog) chips.push({ text: 'AOG', tone: 'rust' });
  if (card.restricted) chips.push({ text: 'Restricted', tone: 'rust' });
  if (card.shut) chips.push({ text: 'House closed', tone: 'rust' });
  if (a) chips.push(a.due <= W ? { text: 'Due now', tone: 'rust' } : { text: `Due wk ${a.due}`, tone: '' });
  if (card.mel) chips.push(card.mel.until >= W ? { text: `MEL to wk ${card.mel.until}${card.mel.ext ? ' (extended)' : ''}`, tone: 'ink' } : { text: `MEL ran out wk ${card.mel.until}`, tone: 'rust' });
  const st = outState(s, a);
  const exp = expectedDeferralCost(s, o).cost;
  const bite = card.aog || card.restricted || card.shut ? Math.round((card.downtime?.usd ?? 0) * (st?.share ?? 1)) : 0;
  const waitCost = exp + bite;
  if (waitCost > 0) chips.push({ text: `Waiting a week ≈ ${usd(waitCost)}`, tone: waitCost > card.total ? 'amber' : '' });
  const trade = role === 'mech' ? 'Mech' : 'Elec';
  const [def, alt] = SUPPLIER_PAIR[role];
  const vendor = buy?.vendor && SUPPLIERS[buy.vendor].trade === role ? buy.vendor : def;
  return {
    id: o.id,
    title: o.title,
    role,
    who: nameOf(s, role),
    asset: assetName(s, o.assetId),
    symptom: a ? symptomText(s, a) : '',
    task: taskWords(s, o, a),
    tier: o.tier,
    fromStock,
    fromStockValue: Math.round(fromStock.reduce((n, l) => n + l.value, 0)),
    toBuy,
    tools,
    labour: card.labour,
    buyTotal,
    total: card.total,
    freight: {
      pick: card.freight.pick,
      sched: down
        ? { ...freightVM(s, card, a, card.freight.sched.eta, card.freight.sched.outWeeks), text: `Scheduled${card.freight.sched.cost > 0 ? ` +${usd(card.freight.sched.cost)}` : ''}: ${down}, so it slips a week` }
        : freightVM(s, card, a, card.freight.sched.eta, card.freight.sched.outWeeks),
      // the boat only when it's faster: a lead-1 line already rides tonight's flight (unless its plane is down)
      ...(card.freight.aog && (card.freight.aog.eta < card.freight.sched.eta || card.freight.pick === 'aog' || down) ? { aog: freightVM(s, card, a, card.freight.aog.eta, card.freight.aog.outWeeks, card.freight.aog.cost) } : {}),
    },
    vendor,
    vendors: [def, alt].map((v) => ({ v, label: SUPPLIERS[v].short, note: supplierNote(v) })),
    chips,
    budget: `${trade} work budget this week: ${usd(card.budget.spent)} of ${usd(card.budget.of)}`,
    waitCost,
    ...(lateWords(s, o.at, card.total) ? { late: lateWords(s, o.at, card.total) } : {}),
    ...(a?.mel
      ? { mel: { alert: a.id, until: a.mel.until, ext: !!a.mel.ext, asked: !!a.mel.ask, ...(a.mel.ask ? { askedBy: a.mel.ask.by } : {}), canExtend: melExtendable(a.mel, W), to: Math.max(a.mel.until, W - 1) + 1 } }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Requisitions (17.3 ReqQueue): standalone requests and approved jobs' new shortfalls

export type ReqVM = {
  id: string;
  role: OpsRole;
  who: string;
  item: ItemId;
  pn: string;
  nomen: string;
  qty: number;
  qtyText: string;
  value: number;
  tool: boolean;
  why?: string;
  /** the job it's for ("Tire and tube on Twin N-12") */
  job?: string;
  urgent: boolean;
  late?: string;
  /** weeks it has waited */
  age: number;
  vendor: SupplierId;
  carrier: 'any' | 'bulk' | 'boat';
};
export type ReqGroupVM = { key: string; vendor: SupplierId; vendorName: string; carrier: 'any' | 'bulk' | 'boat'; carrierText: string; reqs: ReqVM[]; total: number };

/** open requisitions not deferred this week, urgent first, then the oldest */
export function reqQueue(s: IslandState): ReqVM[] {
  const out: ReqVM[] = [];
  for (const r of s.reqs ?? []) {
    if (r.status !== 'open' || r.deferredWeek === s.week) continue;
    const x = itemById(r.item);
    const o = r.order ? s.orders.find((y) => y.id === r.order) : undefined;
    const value = reqValue(r);
    out.push({
      id: r.id,
      role: r.role,
      who: nameOf(s, r.role),
      item: r.item,
      pn: x?.pn ?? r.item,
      nomen: x ? shortLabel(x.nomen) : r.item,
      qty: r.qty,
      qtyText: qtyWords(x, x ? buyUnits(x, r.qty) : r.qty),
      value,
      tool: x?.kind === 'tool',
      ...(r.why ? { why: r.why } : {}),
      ...(o ? { job: `${o.title}${o.assetId ? ` on ${assetName(s, o.assetId)}` : ''}` } : {}),
      urgent: !!o && urgentJob(s, o),
      ...(lateWords(s, r.at, value) ? { late: lateWords(s, r.at, value) } : {}),
      age: Math.max(0, s.week - r.week),
      vendor: x ? DEFAULT_SUPPLIER[x.trade] : 'oem',
      carrier: x ? carrierOf(x) : 'any',
    });
  }
  return out.sort((a, b) => Number(b.urgent) - Number(a.urgent) || b.age - a.age || (a.id < b.id ? -1 : 1));
}

/** the queue grouped the way it will be ordered: one PO per supplier and carrier */
export function reqGroups(s: IslandState, reqs: ReqVM[] = reqQueue(s)): ReqGroupVM[] {
  const by = new Map<string, ReqGroupVM>();
  for (const r of reqs) {
    const key = `${r.vendor}|${r.carrier}`;
    const g = by.get(key) ?? by.set(key, { key, vendor: r.vendor, vendorName: SUPPLIERS[r.vendor].name, carrier: r.carrier, carrierText: carrierWords(s, r.carrier, 'sched'), reqs: [], total: 0 }).get(key)!;
    g.reqs.push(r);
    g.total += r.value;
  }
  return [...by.values()];
}

/** the analyst's choice for a batch of requisitions: each trade's cheaper supplier, and the AOG boat */
export type ReqChoice = { cheaper: boolean; aog: boolean };

/** a batch at the chosen suppliers and freight: what it comes to, in how many POs, and whether the boat can take it */
export function reqQuote(s: IslandState, ids: string[], c: ReqChoice): { total: number; parts: number; freight: number; pos: number; aogOk: boolean; lines: number } {
  const groups = new Set<string>();
  const sched: { item: ItemId; vendor: SupplierId }[] = [];
  let parts = 0;
  let faster = false;
  let lines = 0;
  for (const id of ids) {
    const r = s.reqs?.find((x) => x.id === id);
    const x = r ? itemById(r.item) : undefined;
    if (!r || !x) continue;
    lines++;
    const v = reqVendor(x, c);
    const boat = boatHelps(s, x, v);
    if (boat) faster = true;
    const f: Freight = c.aog && boat ? 'aog' : 'sched';
    groups.add(`${v}|${carrierOf(x)}|${f}`);
    if (f === 'sched') sched.push({ item: x.id, vendor: v });
    parts += priceAt(x, v) * buyUnits(x, r.qty);
  }
  const aogGroups = [...groups].filter((g) => g.endsWith('|aog')).length;
  // scheduled lines: one shipment's charge per supplier and carrier not already on its way this week (3.6)
  const schedLines = sched.length ? schedFreight(s, sched).cost : 0;
  const freight = aogGroups * FREIGHT.aog + schedLines;
  return { total: Math.round(parts + freight), parts: Math.round(parts), freight, pos: groups.size, aogOk: faster, lines };
}

const reqVendor = (x: Item, c: ReqChoice): SupplierId => (c.cheaper ? SUPPLIER_PAIR[x.trade][1] : SUPPLIER_PAIR[x.trade][0]);

/** the AOG boat for a line: this supplier ships on it, and the week's carrier wouldn't land it tonight anyway */
const boatHelps = (s: IslandState, x: Item, v: SupplierId) => aogOk(x, v) && etaOf(s.week, x, v) > s.week;

/** the moves a batch approval dispatches: one approveReq per trade (each trade's supplier is its own) */
export function reqActions(s: IslandState, ids: string[], c: ReqChoice): Action[] {
  const byTrade = new Map<ItemTrade, string[]>();
  for (const id of ids) {
    const r = s.reqs?.find((x) => x.id === id);
    const x = r ? itemById(r.item) : undefined;
    if (!r || !x) continue;
    (byTrade.get(x.trade) ?? byTrade.set(x.trade, []).get(x.trade)!).push(id);
  }
  // the boat takes only the lines it gets here sooner: the rest ride the week's carrier (no $350 for nothing)
  return [...byTrade.entries()].flatMap(([trade, reqs]) => {
    const vendor = c.cheaper ? SUPPLIER_PAIR[trade][1] : SUPPLIER_PAIR[trade][0];
    const boat = c.aog ? reqs.filter((id) => boatHelps(s, itemById(s.reqs!.find((r) => r.id === id)!.item)!, vendor)) : [];
    const rest = reqs.filter((id) => !boat.includes(id));
    return [
      ...(boat.length ? [{ t: 'approveReq', reqs: boat, buy: { vendor, freight: 'aog' } } as Action] : []),
      ...(rest.length ? [{ t: 'approveReq', reqs: rest, buy: { vendor, freight: 'sched' } } as Action] : []),
    ];
  });
}

// ---------------------------------------------------------------------------
// The stock planner (17.3): families, their velocity and class, the items

export type PlannerFilter = 'all' | 'flags' | 'fast' | 'steady' | 'slow' | 'dead' | 'parts' | 'consumables' | 'mech' | 'elec' | 'build' | 'tools';
export const FILTERS: { v: PlannerFilter; label: string }[] = [
  { v: 'all', label: 'All' },
  { v: 'flags', label: 'Flags' },
  { v: 'fast', label: 'Fast' },
  { v: 'steady', label: 'Steady' },
  { v: 'slow', label: 'Slow' },
  { v: 'dead', label: 'Dead' },
  { v: 'parts', label: 'Parts' },
  { v: 'consumables', label: 'Consumables' },
  { v: 'mech', label: 'Mech' },
  { v: 'elec', label: 'Elec' },
  { v: 'build', label: 'Build' },
  { v: 'tools', label: 'Tools' },
];

export type Abc = 'A' | 'B' | 'C';
export type ItemRowVM = {
  id: ItemId;
  pn: string;
  nomen: string;
  trade: ItemTrade;
  onHand: number;
  reserved: number;
  free: number;
  onOrder: number;
  eta?: number;
  rop?: number;
  max?: number;
  /** holds a stores bin */
  bin: boolean;
  avg: number;
  value: number;
  /** supersession the book prints with an INTCHG 1 or 2: reorders ship as the new P/N */
  supsd?: string;
  /** first received */
  since?: number;
  tool?: boolean;
  /** tools: owned, on order, asked for, or not owned (and who needs it) */
  status?: string;
};
export type FamRowVM = {
  fam: string;
  label: string;
  trade: ItemTrade;
  group: Family['group'];
  cls: MoveClass | null;
  abc: Abc | null;
  spare: boolean;
  series: number[];
  onHand: number;
  free: number;
  onOrder: number;
  eta?: number;
  /** "here tonight", "here next week", "here wk 14" */
  etaText?: string;
  value: number;
  valueMoved: number;
  used: number;
  lastUsed: number | null;
  sinceText: string;
  turns: number | null;
  /** days the free stock lasts at the family's rate (null: no use) */
  days: number | null;
  /** expected use over the next 4 weeks (the family's rate) plus known demand */
  forecast: number;
  known: number;
  flags: StockFlag['kind'][];
  urgent: boolean;
  items: ItemRowVM[];
};

/** every item's open or held PO lines not received yet (a job's or free), and when the first lands */
function onOrderAll(s: IslandState, item: ItemId): { qty: number; eta?: number } {
  let qty = 0;
  let eta: number | undefined;
  for (const p of s.pos ?? []) {
    if (p.status !== 'open' && p.status !== 'held') continue;
    for (const l of p.lines) {
      if ((l.as ?? l.item) !== item || l.got !== undefined || l.back) continue;
      qty += l.qty;
      const at = p.status === 'held' ? (p.hold ?? p.eta) : p.eta;
      eta = eta === undefined ? at : Math.min(eta, at);
    }
  }
  return eta === undefined ? { qty } : { qty, eta };
}

const binless = (x: Item | undefined) => !x || x.kind === 'tool' || x.trade === 'build';

export function itemRow(s: IslandState, id: ItemId): ItemRowVM {
  const x = itemById(id);
  const l = s.inv?.[id];
  const on = onHand(s, id);
  const res = reservedOf(s, id);
  const ord = onOrderAll(s, id);
  const supsd = x?.supsdBy && x.supsdBy.code !== 3 && itemById(x.supsdBy.pn) ? `Reorders ship as ${x.supsdBy.pn} (INTCHG ${x.supsdBy.code})` : undefined;
  const avg = unitCost(s, id);
  return {
    id,
    pn: x?.pn ?? id,
    nomen: x?.nomen ?? id,
    trade: x?.trade ?? 'mech',
    onHand: on,
    reserved: res,
    free: Math.max(0, on - res),
    onOrder: ord.qty,
    ...(ord.eta !== undefined ? { eta: ord.eta } : {}),
    ...(l?.rop !== undefined ? { rop: l.rop } : {}),
    ...(l?.max !== undefined ? { max: l.max } : {}),
    bin: !binless(x) && (on - res > 0 || l?.rop !== undefined || l?.max !== undefined),
    avg: cents(avg),
    value: Math.round(on * avg),
    ...(supsd ? { supsd } : {}),
    ...(l?.got !== undefined ? { since: l.got } : {}),
    ...(x?.kind === 'tool' ? { tool: true } : {}),
  };
}

/** ABC by value moved over the ledger's weeks: A the families that make the first 80%, B the next 15%, C the rest (unused: none) */
export function abcClasses(s: IslandState): Map<string, Abc> {
  const moved = families(s)
    .map((f) => ({ fam: f.fam, v: velocity(s, f.fam).valueMoved }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v || (a.fam < b.fam ? -1 : 1));
  const total = moved.reduce((n, x) => n + x.v, 0);
  const out = new Map<string, Abc>();
  let run = 0;
  for (const m of moved) {
    // a family is A while the running share before it is under 80%: the top family is always A
    out.set(m.fam, run < 0.8 * total ? 'A' : run < 0.95 * total ? 'B' : 'C');
    run += m.v;
  }
  return out;
}

/** units of one P/N used over the job flow's weeks on the ledger (a migrated island's backfilled rows carry none) */
export const itemUsed = (s: IslandState, id: ItemId) => flowRows(s).reduce((n, r) => n + (r.use?.[id] ?? 0), 0);

/** "last used 3 wk ago", "used this week", "no use yet" (counted in the job flow's weeks: 14.5) */
export function sinceWords(s: IslandState, last: number | null): string {
  if (last === null) {
    const n = flowWeeks(s);
    return n ? `no use in ${n} wk` : 'no use yet';
  }
  const ago = s.week - last;
  return ago <= 0 ? 'used this week' : ago === 1 ? 'used last week' : `last used ${ago} wk ago`;
}

function familyRow(s: IslandState, f: Family, abc: Map<string, Abc>, flagKinds: Map<string, { kinds: StockFlag['kind'][]; urgent: boolean }>): FamRowVM {
  const v = velocity(s, f.fam);
  const items = f.items.map((id) => itemRow(s, id));
  const free = items.reduce((n, i) => n + i.free, 0);
  const onOrder = items.reduce((n, i) => n + i.onOrder, 0);
  const etas = items.map((i) => i.eta).filter((e): e is number => e !== undefined);
  const known = f.items.reduce((n, id) => n + knownDemand(s, id).filter((d) => d.week <= s.week + 3).reduce((m, d) => m + d.qty, 0), 0);
  const fl = flagKinds.get(f.fam);
  return {
    fam: f.fam,
    label: famName(f.fam, f.label),
    trade: f.trade,
    group: f.group,
    cls: moveClass(s, f.fam),
    abc: abc.get(f.fam) ?? null,
    spare: insuranceSpare(s, f.fam),
    series: v.series,
    onHand: v.onHand,
    free,
    onOrder,
    ...(etas.length ? { eta: Math.min(...etas), etaText: etaWords(s, Math.min(...etas)) } : {}),
    value: v.value,
    valueMoved: v.valueMoved,
    used: v.series.reduce((a, b) => a + b, 0),
    lastUsed: v.lastUsed,
    sinceText: sinceWords(s, v.lastUsed),
    turns: v.turns,
    days: v.perWeek > 0 ? Math.round((free / v.perWeek) * 7) : null,
    forecast: Math.round(v.perWeek * 4 + known),
    known,
    flags: fl?.kinds ?? [],
    urgent: !!fl?.urgent,
    items,
  };
}

/** the planner's family rows for a filter: flagged first (urgent on top), then by value moved, then value on the shelf */
export function plannerRows(s: IslandState, filter: PlannerFilter = 'all'): FamRowVM[] {
  const abc = abcClasses(s);
  const flagKinds = new Map<string, { kinds: StockFlag['kind'][]; urgent: boolean }>();
  const flagged = new Map<string, Set<ItemId>>();
  for (const f of stockFlags(s)) {
    const fam = f.fam ?? (f.item ? famOf(f.item) : undefined);
    if (!fam) continue;
    const e = flagKinds.get(fam) ?? flagKinds.set(fam, { kinds: [], urgent: false }).get(fam)!;
    if (!e.kinds.includes(f.kind)) e.kinds.push(f.kind);
    e.urgent ||= f.urgent;
    if (f.item) (flagged.get(fam) ?? flagged.set(fam, new Set()).get(fam)!).add(f.item);
  }
  const rows = families(s).map((f) => familyRow(s, f, abc, flagKinds));
  // an item a flag names that isn't a stocked family yet (a job waits on it, a take-off's tool): its own row
  for (const [fam, ids] of flagged) {
    if (rows.some((r) => r.fam === fam)) continue;
    const x = itemById([...ids][0]);
    if (!x || x.kind === 'tool') continue;
    rows.push(familyRow(s, { fam, label: x.nomen, trade: x.trade, group: x.kind === 'consumable' ? 'consumables' : x.trade === 'mech' ? 'parts' : 'materials', items: [...ids] }, abc, flagKinds));
  }
  const keep = (r: FamRowVM) => {
    switch (filter) {
      case 'all':
        return true;
      case 'flags':
        return r.flags.length > 0;
      case 'fast':
      case 'steady':
      case 'slow':
      case 'dead':
        return r.cls === filter;
      case 'parts':
        return r.group !== 'consumables';
      case 'consumables':
        return r.group === 'consumables';
      case 'mech':
      case 'elec':
      case 'build':
        return r.trade === filter;
      case 'tools':
        return false;
    }
  };
  return rows
    .filter(keep)
    .sort((a, b) => Number(b.urgent) - Number(a.urgent) || Number(b.flags.length > 0) - Number(a.flags.length > 0) || b.valueMoved - a.valueMoved || b.value - a.value || (a.label < b.label ? -1 : 1));
}

/** the shop's tools: owned (on the tool board), on order, asked for, or not owned (and the take-off that needs one) */
export function toolRows(s: IslandState): ItemRowVM[] {
  const trades = new Set<ItemTrade>(['mech', 'elec']);
  return allItems()
    .filter((x) => x.kind === 'tool' && trades.has(x.trade))
    .map((x) => {
      const row = itemRow(s, x.id);
      const req = (s.reqs ?? []).find((r) => r.item === x.id && r.status === 'open');
      const need = knownDemand(s, x.id)[0];
      const status =
        row.onHand >= 1
          ? 'owned'
          : row.onOrder > 0
            ? `on order, ${etaWords(s, row.eta ?? s.week)}`
            : req
              ? `${nameOf(s, req.role)} asked for it`
              : need
                ? `not owned: ${need.why} needs it`
                : 'not owned';
      return { ...row, status };
    })
    .sort((a, b) => Number(a.onHand >= 1) - Number(b.onHand >= 1) || (a.trade < b.trade ? -1 : a.trade > b.trade ? 1 : a.pn < b.pn ? -1 : 1));
}

/** the planner's filter input: the supply catalog (A's search) for the trades in view, stocked or not */
export function catalogHits(s: IslandState, q: string, filter: PlannerFilter = 'all', limit = 20): ItemRowVM[] {
  const trades: ItemTrade[] = filter === 'mech' || filter === 'elec' || filter === 'build' ? [filter] : ['mech', 'elec', 'build'];
  const all = trades.flatMap((t) => search(supplyIndex(t), q, { limit }));
  all.sort((a, b) => b.score - a.score || a.doc.order - b.doc.order);
  // a partial match ranks below full ones (A's search); keep the ones near the best
  const best = all[0]?.score ?? 0;
  const hits = all.filter((h) => h.score >= best * 0.5);
  const seen = new Set<ItemId>();
  const out: ItemRowVM[] = [];
  for (const h of hits) {
    const id = h.doc.ref.item;
    if (!id || seen.has(id)) continue;
    const x = itemById(id);
    if (!x || (filter === 'tools' && x.kind !== 'tool')) continue;
    seen.add(id);
    out.push(itemRow(s, id));
    if (out.length >= limit) break;
  }
  return out;
}

/** the stores in one line: bins, the value on the shelf, POs on the way */
export function storesLine(s: IslandState): { bins: number; total: number; value: number; open: number; onOrder: number } {
  const open = (s.pos ?? []).filter((p) => p.status === 'open' || p.status === 'held');
  const onOrder = Math.round(open.reduce((n, p) => n + p.lines.filter((l) => l.got === undefined && !l.back).reduce((m, l) => m + l.qty * l.unit, 0), 0));
  return { bins: binsInUse(s), total: binsTotal(s), value: Math.round(invValue(s)), open: open.length, onOrder };
}

// ---------------------------------------------------------------------------
// Flags (14.2) with their one-tap actions

export type FlagVM = {
  key: string;
  kind: StockFlag['kind'];
  text: string;
  urgent: boolean;
  fam?: string;
  item?: ItemId;
  /** a one-tap action: the engine moves it dispatches */
  act?: { label: string; acts: Action[]; done: string };
  /** or where it takes the analyst */
  go?: { label: string; item?: ItemId; fam?: string; filter?: PlannerFilter; receiving?: boolean };
};

export function flagsVM(s: IslandState): FlagVM[] {
  // one flag a job: a card short of four P/Ns is one card to approve, not four flags
  const all = stockFlags(s);
  const byJob = new Map<string, ItemId[]>();
  for (const f of all) if (f.kind === 'order' && f.act?.t === 'approve' && f.item) byJob.set(f.act.orderId, [...(byJob.get(f.act.orderId) ?? []), f.item]);
  const seen = new Set<string>();
  const flags = all.filter((f) => {
    if (f.kind !== 'order' || f.act?.t !== 'approve') return true;
    if (seen.has(f.act.orderId)) return false;
    seen.add(f.act.orderId);
    return true;
  });
  return flags.map((f, i) => {
    const base = { key: `${f.kind}:${f.item ?? f.fam ?? i}`, kind: f.kind, text: f.text, urgent: f.urgent, ...(f.fam ? { fam: f.fam } : {}), ...(f.item ? { item: f.item } : {}) };
    switch (f.kind) {
      case 'order': {
        const a = f.act;
        if (a?.t === 'approveReq') {
          const r = s.reqs?.find((x) => x.id === a.reqs[0]);
          return { ...base, act: { label: r ? `Approve ${nameOf(s, r.role)}'s request` : 'Approve the request', acts: [a], done: r ? `Approved ${nameOf(s, r.role)}'s request` : 'Approved the request' } };
        }
        if (a?.t === 'approve') {
          const o = s.orders.find((x) => x.id === a.orderId);
          const pns = (byJob.get(a.orderId) ?? []).map((id) => itemById(id)?.pn ?? id);
          const text = o && pns.length > 1 ? `${nameOf(s, o.role)}'s job waits on ${listWords(pns)}: ${o.title}` : base.text;
          return { ...base, text, act: { label: o ? `Approve ${nameOf(s, o.role)}'s card` : 'Approve the card', acts: [a], done: o ? `Approved ${o.title}` : 'Approved the card' } };
        }
        if (a?.t === 'buy') {
          const q = a.lines[0]?.qty ?? 1;
          const x = f.item ? itemById(f.item) : undefined;
          const qty = x ? qtyWords(x, buyUnits(x, q)) : String(q);
          return { ...base, act: { label: `Order ${qty}`, acts: [a], done: `Ordered ${qty} of ${x?.pn ?? f.item}` } };
        }
        return { ...base, go: { label: 'Open', ...(f.item ? { item: f.item } : {}) } };
      }
      case 'stop': {
        const fam = families(s).find((x) => x.fam === f.fam);
        // the family by its desk name, and its use in the ledger's own words (the island may be younger than the ledger)
        const v = fam ? velocity(s, fam.fam) : null;
        const text = fam && v ? `Stop stocking ${famName(fam.fam, fam.label)}: ${sinceWords(s, v.lastUsed)}, ${moveClass(s, fam.fam) === 'dead' ? 'dead stock' : 'a slow mover'} (${usd(v.value)} on the shelf, a bin).` : f.text;
        const minmax = (fam?.items ?? []).filter((id) => s.inv?.[id]?.rop !== undefined);
        if (minmax.length) return { ...base, text, act: { label: 'Stop reordering', acts: minmax.map((id) => ({ t: 'setStock', item: id, rop: null, max: null }) as Action), done: `Stopped reordering ${fam ? famName(fam.fam, fam.label) : 'it'}: what's left gets used up` } };
        const first = (fam?.items ?? []).find((id) => available(s, id) > 0);
        return { ...base, text, go: { label: 'Return it', ...(first ? { item: first } : {}), ...(f.fam ? { fam: f.fam } : {}) } };
      }
      case 'norop': {
        if (!f.item) return base;
        const sg = suggestRop(s, f.item);
        // the family moves fast, but this P/N may not be the one that moved: look before stocking it
        if (sg.max <= sg.rop || itemUsed(s, f.item) === 0) return { ...base, go: { label: 'Set min/max', item: f.item } };
        return { ...base, act: { label: `Use ${sg.rop} / ${sg.max}`, acts: [{ t: 'setStock', item: f.item, rop: sg.rop, max: sg.max }], done: `${itemById(f.item)?.pn ?? f.item}: min ${sg.rop}, max ${sg.max}` } };
      }
      case 'bins':
        return { ...base, go: { label: 'Free a bin', filter: 'dead' } };
      case 'held':
        return { ...base, go: { label: 'Receiving', receiving: true } };
    }
  });
}

/** the analyst can approve the one MEL extension: the mechanic asked for it (the maintenance side's call), and the placard is still live or ran out last week */
export const melExtendable = (m: NonNullable<Alert['mel']>, W: number) => !m.ext && !!m.ask && m.until >= W - 1;

/** where an MEL placard stands: it covers the resolve of its last week; the one extension can come a week late */
export function melWords(W: number, until: number, canExtend: boolean): string {
  if (until > W) return `placarded to wk ${until}`;
  if (until === W) return 'runs out at this week’s resolve';
  if (until === W - 1 && canExtend) return 'ran out last week: the plane is grounded at this resolve unless the extension goes through';
  return `ran out wk ${until}`;
}

// ---------------------------------------------------------------------------
// Needs (14.2): open alerts nobody has planned (no P/N), the jobs waiting on parts, MEL placards

export type NeedVM = { alert: string; trade: OpsRole; who: string; text: string; due: number; dueText: string; aw: boolean; nudged: boolean; soon: boolean; scheduled: boolean };
export type WaitVM = { order: string; title: string; asset: string; who: string; lines: { pn: string; nomen: string; qty: string; state: string; tone: Tone }[] };
export type PlacardVM = { alert: string; text: string; until: number; ext: boolean; asked: boolean; askedBy?: string; canExtend: boolean; runsOut: boolean; when: string };

export function needsVM(s: IslandState): { unplanned: NeedVM[]; waiting: WaitVM[]; placards: PlacardVM[] } {
  const W = s.week;
  const unplanned = needs(s).map((n) => ({
    alert: n.alert,
    trade: n.trade,
    who: nameOf(s, n.trade),
    text: n.text,
    due: n.due,
    dueText: n.due <= W ? 'due now' : `due wk ${n.due}`,
    aw: n.aw,
    nudged: n.nudged === W,
    soon: n.due <= W + 1,
    scheduled: !!n.scheduled,
  }));
  const waiting: WaitVM[] = [];
  for (const o of s.orders) {
    if (!o.flow || o.flow.wired || o.approvedWeek === undefined || o.status !== 'waiting_part') continue;
    const lines = jobLines(o).map((l) => {
      const x = itemById(l.item);
      const res = reservedFor(s, o.id, l.item);
      const ords = (s.pos ?? []).flatMap((p) => (p.status === 'open' || p.status === 'held' ? p.lines.filter((pl) => pl.order === o.id && (pl.as ?? pl.item) === l.item && pl.got === undefined && !pl.back).map(() => p) : []));
      const req = (s.reqs ?? []).find((r) => r.order === o.id && r.item === l.item && r.status === 'open');
      const held = ords.find((p) => p.status === 'held');
      const state: { state: string; tone: Tone } =
        res >= l.qty
          ? { state: 'on the shelf', tone: 'palm' }
          : held
            ? { state: `held: paperwork, wk ${held.hold ?? W + 1}`, tone: 'ink' }
            : ords.length
              ? carrierDown(s, ords[0])
                ? { state: `on ${ords[0].id}: slips a week (${carrierDown(s, ords[0])})`, tone: 'amber' }
                : { state: `on ${ords[0].id}, ${etaWords(s, Math.min(...ords.map((p) => p.eta)))}`, tone: 'sea' }
              : req
                ? { state: 'asked of you', tone: 'rust' }
                : { state: res > 0 ? `${res} of ${l.qty} on the shelf` : 'not ordered', tone: 'rust' };
      return { pn: x?.pn ?? l.item, nomen: x ? shortLabel(x.nomen) : l.item, qty: qtyWords(x, l.qty), ...state };
    });
    for (const t of o.flow.tools) {
      if (onHand(s, t) >= 1) continue;
      const x = itemById(t);
      const coming = onOrderAll(s, t);
      lines.push({ pn: x?.pn ?? t, nomen: x ? shortLabel(x.nomen) : t, qty: 'tool', state: coming.qty ? `on order, ${etaWords(s, coming.eta ?? W)}` : 'not owned', tone: coming.qty ? 'sea' : 'rust' });
    }
    waiting.push({ order: o.id, title: o.title, asset: assetName(s, o.assetId), who: nameOf(s, o.role), lines });
  }
  const placards: PlacardVM[] = liveAlerts(s)
    .filter((a) => !!a.mel)
    .map((a) => ({
      alert: a.id,
      text: `${assetName(s, a.assetId)}: ${symptomText(s, a).replace(/^Written up (again|by [^:]+): /i, '')}`,
      until: a.mel!.until,
      ext: !!a.mel!.ext,
      asked: !!a.mel!.ask,
      ...(a.mel!.ask ? { askedBy: a.mel!.ask.by } : {}),
      canExtend: melExtendable(a.mel!, W),
      runsOut: a.mel!.until <= W,
      when: melWords(W, a.mel!.until, !a.mel!.ext && !!a.mel!.ask),
    }))
    .sort((a, b) => a.until - b.until);
  return { unplanned, waiting, placards };
}

// ---------------------------------------------------------------------------
// An item's sheet: its family's chart, the numbers, the suggestion, known demand

export type ItemVM = ItemRowVM & {
  kind: Item['kind'];
  famLabel: string;
  fam: string;
  cls: MoveClass | null;
  abc: Abc | null;
  spare: boolean;
  series: number[];
  /** the ledger's week numbers the series covers */
  weeks: number[];
  position: number;
  lead: number;
  leadText: string;
  known: { week: number; qty: number; why: string }[];
  suggest: { rop: number; max: number; why: string };
  forecast: string;
  turns: number | null;
  days: number | null;
  carry: number;
  capital: number;
  pack: number;
  packName?: string;
  cut: boolean;
  unit: Item['unit'];
  newBin: boolean;
  binsFree: number;
  returnable: boolean;
  /** what one free unit returned to the vendor credits, and loses */
  credit: number;
  loss: number;
  minmaxOk: boolean;
};

export function itemVM(s: IslandState, id: ItemId): ItemVM | null {
  const x = itemById(id);
  if (!x) return null;
  const row = itemRow(s, id);
  const fam = famOf(id);
  const v = velocity(s, fam);
  const L = x.lead + SUPPLIERS[DEFAULT_SUPPLIER[x.trade]].leadAdd;
  const known = knownDemand(s, id);
  const soon = known.filter((d) => d.week <= s.week + 3).reduce((n, d) => n + d.qty, 0);
  const expected = Math.round(v.perWeek * 4 * 10) / 10;
  const forecast =
    x.kind === 'tool'
      ? known.length
        ? `${known[0].why} needs it`
        : 'bought once, kept'
      : `Next 4 weeks: ~${Math.round(expected + soon)} (${v.perWeek > 0 ? `${expected} at the family's rate` : 'no use yet'}${soon ? ` + ${soon} known` : ''})`;
  const famRow = families(s).find((f) => f.fam === fam);
  const returnable = x.kind !== 'consumable';
  return {
    ...row,
    kind: x.kind,
    fam,
    famLabel: famName(fam, famRow?.label ?? x.nomen),
    cls: x.kind === 'tool' ? null : moveClass(s, fam),
    abc: abcClasses(s).get(fam) ?? null,
    spare: insuranceSpare(s, fam),
    series: v.series,
    weeks: flowRows(s).map((r) => r.w),
    position: position(s, id),
    lead: L,
    leadText: `${plural(L, 'week')} by scheduled freight (${SUPPLIERS[DEFAULT_SUPPLIER[x.trade]].short})`,
    known,
    suggest: suggestRop(s, id),
    forecast,
    turns: v.turns,
    days: v.perWeek > 0 ? Math.round((row.free / v.perWeek) * 7) : null,
    carry: cents(row.value * STOCK.carry),
    capital: cents(row.value * STOCK.capital),
    pack: x.pack,
    ...(x.packName ? { packName: x.packName } : {}),
    cut: !!x.cut,
    unit: x.unit,
    newBin: needsNewBin(s, id),
    binsFree: Math.max(0, binsTotal(s) - binsInUse(s)),
    returnable,
    credit: returnable ? cents(row.avg * STOCK.returnCredit) : 0,
    loss: returnable ? cents(row.avg * (1 - STOCK.returnCredit)) : row.avg,
    minmaxOk: x.kind !== 'tool' && x.trade !== 'build',
  };
}

// ---------------------------------------------------------------------------
// A stock buy (BuySheet): quantities in whole packs, the supplier and freight, what it costs and when it lands

export type BuyQuote = {
  units: number;
  packs: number;
  value: number;
  freight: number;
  total: number;
  vendor: SupplierId;
  eta: number;
  etaText: string;
  aogOk: boolean;
  /** the scheduled freight in words: its own shipment, or riding one on its way */
  ship?: string;
  /** what stops it: the freeze, cash, a full stores room */
  block?: string;
};

export function buyQuote(s: IslandState, id: ItemId, qty: number, buy: BuyChoice = {}): BuyQuote {
  const x = itemById(id);
  if (!x) return { units: 0, packs: 0, value: 0, freight: 0, total: 0, vendor: 'oem', eta: s.week, etaText: '', aogOk: false, block: 'Unknown item.' };
  const vendor = buy.vendor && SUPPLIERS[buy.vendor].trade === x.trade ? buy.vendor : DEFAULT_SUPPLIER[x.trade];
  const units = buyUnits(x, Math.max(1, qty));
  const packs = x.cut || x.pack <= 1 ? units : units / x.pack;
  const value = cents(priceAt(x, vendor) * units);
  // the boat is offered only when it's faster: a line the week's carrier lands tonight doesn't need it
  const sched = etaOf(s.week, x, vendor);
  const ok = aogOk(x, vendor) && sched > s.week;
  const aog = buy.freight === 'aog' && ok;
  // scheduled freight is per shipment: its own, or none when it rides one already on its way this week (3.6)
  const ship = aog ? undefined : schedFreight(s, [{ item: id, vendor }]);
  const freight = aog ? FREIGHT.aog : (ship?.cost ?? 0);
  const eta = aog ? s.week : sched;
  const total = Math.round(value + freight);
  const sp = spendable(s);
  const block =
    sp < 2000
      ? `Spendable cash under ${usd(2000)}: stock orders are frozen.`
      : sp - total < 0
        ? 'Not enough cash.'
        : needsNewBin(s, id) && binsInUse(s) + 1 > binsTotal(s)
          ? `Stores full: ${binsInUse(s)} of ${binsTotal(s)} bins. Use up, scrap or return a line first.`
          : units > STOCK.maxQty
            ? `Buy 1 to ${STOCK.maxQty} of an item.`
            : undefined;
  const shipText = ship ? shipWords(ship) : undefined;
  return { units, packs, value, freight, total, vendor, eta, etaText: etaWords(s, eta), aogOk: ok, ...(shipText ? { ship: shipText } : {}), ...(block ? { block } : {}) };
}

// ---------------------------------------------------------------------------
// Receiving (9.4, 9.7): held paperwork, what's on the way, packing slips, payables

export type PoVM = {
  id: string;
  vendor: SupplierId;
  vendorName: string;
  vendorShort: string;
  status: PurchaseOrder['status'];
  statusText: string;
  way: string;
  eta: number;
  cost: number;
  owed: number;
  by: string;
  lines: { pn: string; nomen: string; qty: string; note?: string }[];
  notes: string[];
  /** exchange rotables: the core goes back in the unit's box (no deposit in v1) */
  cores: string[];
  jobs: string[];
  capex: number;
};

function poVM(s: IslandState, p: PurchaseOrder): PoVM {
  const W = s.week;
  const way = carrierWords(s, p.carrier, p.freight);
  const statusText =
    p.status === 'held'
      ? `held at receiving, released wk ${p.hold ?? W + 1}`
      : p.status === 'open'
        ? carrierDown(s, p)
          ? `${way}: ${carrierDown(s, p)}, so it slips to wk ${W + 1} unless it's flying by the resolve`
          : `${way}, ${etaWords(s, p.eta)}`
        : p.status === 'received'
          ? `received wk ${p.got ?? W}: paid at the next payment run`
          : p.status === 'paid'
            ? `paid wk ${p.paid ?? W}`
            : 'returned';
  const jobs = [...new Set(p.lines.filter((l) => l.order).map((l) => l.order!))].map((id) => {
    const o = s.orders.find((x) => x.id === id);
    return o ? `${o.title}${o.assetId ? ` on ${assetName(s, o.assetId)}` : ''}` : id;
  });
  const cores: string[] = [];
  let capex = 0;
  const lines = p.lines.map((l) => {
    const x = itemById(l.as ?? l.item);
    if (x?.kind === 'rotable') cores.push(`${x.pn}: an exchange unit. The old unit goes back in its box as the core: no deposit, nothing to chase.`);
    if (x?.kind === 'tool') capex += l.qty * l.unit;
    const note = l.back ? `sent back: ${l.back}` : l.hold ? `held: no ${l.hold}` : l.as && l.as !== l.item ? `shipped as ${l.as}` : l.got !== undefined && l.got < l.qty ? `${l.got} of ${l.qty} came` : undefined;
    return { pn: x?.pn ?? l.item, nomen: x ? shortLabel(x.nomen) : l.item, qty: qtyWords(x, l.qty), ...(note ? { note } : {}) };
  });
  return {
    id: p.id,
    vendor: p.vendor,
    vendorName: SUPPLIERS[p.vendor].name,
    vendorShort: SUPPLIERS[p.vendor].short,
    status: p.status,
    statusText,
    way,
    eta: p.eta,
    cost: Math.round(p.cost),
    owed: Math.round(poOwed(p)),
    by: p.by === 'auto' ? 'standing policy' : nameOf(s, p.by),
    lines,
    notes: p.notes ?? [],
    cores,
    jobs,
    capex: Math.round(capex),
  };
}

export function receivingVM(s: IslandState): { held: PoVM[]; open: PoVM[]; payable: PoVM[]; paid: PoVM[]; payableTotal: number; committed: number; credit: number } {
  const byId = (a: PurchaseOrder, b: PurchaseOrder) => Number(a.id.replace(/\D/g, '')) - Number(b.id.replace(/\D/g, ''));
  const pos = [...(s.pos ?? [])].sort(byId);
  return {
    held: pos.filter((p) => p.status === 'held').map((p) => poVM(s, p)),
    open: pos.filter((p) => p.status === 'open').sort((a, b) => a.eta - b.eta || byId(a, b)).map((p) => poVM(s, p)),
    payable: pos.filter((p) => p.status === 'received').map((p) => poVM(s, p)),
    paid: pos.filter((p) => p.status === 'paid').reverse().map((p) => poVM(s, p)),
    payableTotal: payable(s),
    committed: committed(s),
    credit: Math.round(s.credit ?? 0),
  };
}

/** a held PO in the review's words: "po14: the exchange alternator waits for its 8130-3, released week 9" */
export function heldWords(p: PoVM): string {
  const doc = p.notes.find((n) => n.startsWith('held: no '));
  const m = doc ? /^held: no (.+) with (\S+)$/.exec(doc) : null;
  const x = m ? itemById(m[2]) : undefined;
  return m ? `${p.id}: the ${x ? lowerFirst(shortLabel(x.nomen)) : m[2]} waits for ${m[1]}, ${p.statusText.replace('held at receiving, ', '')}` : `${p.id}: ${p.statusText}`;
}

// ---------------------------------------------------------------------------
// Money (14.3): the cash card, where it went, the stock card, budgets, overhead and payroll

/** the four groups the weekly chart stacks: the fixed costs as context, the jobs and stock, capex, the rest */
export type SpendGroup = 'jobs' | 'capex' | 'other' | 'fixed';
export const GROUPS: { k: SpendGroup; label: string; of: OutCat[] }[] = [
  { k: 'jobs', label: 'Jobs and stock', of: ['parts', 'labor', 'freight', 'carry'] },
  { k: 'capex', label: 'Capex (tools, building)', of: ['tools', 'building'] },
  { k: 'other', label: 'Insurance, incidents, other', of: ['insurance', 'incidents', 'other'] },
  { k: 'fixed', label: 'Overhead and payroll', of: ['overhead', 'payroll'] },
];
export const OUT_LABEL: Record<OutCat, string> = {
  parts: 'Parts and stock',
  labor: 'Shop charges (overtime, call-outs, outside help)',
  freight: 'Freight',
  carry: 'Carrying',
  payroll: 'Payroll',
  overhead: 'Overhead',
  tools: 'Tools (capex)',
  building: 'Building (capex)',
  insurance: 'Insurance',
  incidents: 'Incidents',
  other: 'Other',
};

export type WeekVM = { w: number; rev: number; budget?: number; out: number; groups: Record<SpendGroup, number>; cats: Record<OutCat, number>; cash: number };

export function weeksVM(s: IslandState, weeks = 12): WeekVM[] {
  return spendSeries(s, weeks).map((r) => {
    const groups = { jobs: 0, capex: 0, other: 0, fixed: 0 } as Record<SpendGroup, number>;
    for (const g of GROUPS) groups[g.k] = g.of.reduce((n, c) => n + (r.out[c] ?? 0), 0);
    const h = s.history.find((x) => x.week === r.w);
    return { w: r.w, rev: r.rev, ...(h ? { budget: h.budget } : {}), out: Object.values(r.out).reduce((a, b) => a + b, 0), groups, cats: r.out, cash: r.cash };
  });
}

/** the tier's overhead in lines (14.3): leases, utilities, property insurance, admin, licences and fees */
export const OVERHEAD_SPLIT: { label: string; share: number }[] = [
  { label: 'Leases', share: 0.35 },
  { label: 'Utilities', share: 0.25 },
  { label: 'Property insurance', share: 0.15 },
  { label: 'Admin', share: 0.15 },
  { label: 'Licences and fees', share: 0.1 },
];

const ROLE_WORD: Record<NpcRole, [string, string]> = { pilot: ['pilot', 'pilots'], housekeeper: ['housekeeper', 'housekeepers'], builder: ['builder', 'builders'] };

/** whole dollars that add up to the total: each share rounded down, the dollars left go to the largest remainders */
export function splitWhole(total: number, shares: number[]): number[] {
  const raw = shares.map((f) => total * f);
  const out = raw.map((x) => Math.floor(x));
  let left = Math.round(total) - out.reduce((a, b) => a + b, 0);
  const order = raw.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (let k = 0; left > 0 && order.length; k = (k + 1) % order.length, left--) out[order[k].i]++;
  return out;
}

/**
 * The payroll's lines: the staff at work by role, and whatever the week's payroll charges beyond
 * them. Before the staff update the charge is the tier's standard crew whoever is on the list,
 * so an open post of that crew is paid for; after it, a hire starting or a let-go's notice.
 */
export function payrollLines(s: IslandState): { lines: { label: string; usd: number }[]; total: number } {
  const staff = (s.staff ?? []).filter((n) => n.start <= s.week);
  const lines = NPC_ROLES.map((r) => {
    const of = staff.filter((n) => n.role === r);
    return of.length ? { label: plural(of.length, ROLE_WORD[r][0], ROLE_WORD[r][1]), usd: of.reduce((n, x) => n + x.wage, 0) } : null;
  }).filter((x): x is { label: string; usd: number } => !!x);
  const total = payroll(s);
  const rest = total - lines.reduce((n, l) => n + l.usd, 0);
  if (rest !== 0) {
    const std = STAFF.standard[Math.max(1, Math.min(5, s.tier)) - 1];
    const open = NPC_ROLES.map((r) => ({ r, n: Math.max(0, (std[r] ?? 0) - staff.filter((x) => x.role === r).length) })).filter((x) => x.n > 0);
    const openUsd = open.reduce((n, x) => n + x.n * STAFF.wage[x.r], 0);
    const label =
      rest > 0 && rest === openUsd
        ? `Open post${open.reduce((n, x) => n + x.n, 0) > 1 ? 's' : ''} of the standard crew (${open.map((x) => plural(x.n, ROLE_WORD[x.r][0], ROLE_WORD[x.r][1])).join(', ')})`
        : rest > 0
          ? 'Hires starting, notice pay'
          : 'Not charged this week';
    lines.push({ label, usd: rest });
  }
  return { lines, total };
}

/** a week as the charts' readouts say it */
export const wkWords = (week: number, w: number) => (w === week - 1 ? `Wk ${w} (last week)` : w === week ? `Wk ${w} (so far)` : `Wk ${w}`);

export type MoneyVM = {
  week: number;
  cash: number;
  spendable: number;
  committed: number;
  payable: number;
  credit: number;
  weeks: WeekVM[];
  runway: { weekly: number; weeks: number; loan: boolean };
  budgets: { role: OpsRole; spent: number; of: number }[];
  forecast: number;
  budgetNow: number;
  where: { weeks: number; groups: { k: SpendGroup; label: string; usd: number }[]; cats: { k: OutCat; label: string; usd: number }[]; capex: number; opex: number; trades: { k: 'mech' | 'elec' | 'build' | 'fin'; label: string; usd: number }[]; assets: { name: string; usd: number }[] };
  stock: {
    inv: number;
    builtUsed: { w: number; built: number; used: number }[];
    /** the island's own cash in the shelf: stock at cost less what the vendors are still owed for it (their credit) */
    tiedUp: number;
    /** open POs: committed, not yet paid (and not yet on the shelf) */
    committed: number;
    capital: number;
    fill: number | null;
    waits: number;
    bins: number;
    binsTotal: number;
    fast: { parts: FamRowVM[]; consumables: FamRowVM[] };
    slow: { parts: FamRowVM[]; consumables: FamRowVM[] };
  };
  overhead: { lines: { label: string; usd: number }[]; total: number };
  payroll: { lines: { label: string; usd: number }[]; total: number };
  fixed: number;
};

export function moneyVM(s: IslandState, whereWeeks = 4): MoneyVM {
  const weeks = weeksVM(s, 12);
  const recent = weeks.slice(-whereWeeks);
  const groups = GROUPS.map((g) => ({ k: g.k, label: g.label, usd: Math.round(recent.reduce((n, w) => n + w.groups[g.k], 0)) }));
  const cats = (Object.keys(OUT_LABEL) as OutCat[]).map((k) => ({ k, label: OUT_LABEL[k], usd: Math.round(recent.reduce((n, w) => n + (w.cats[k] ?? 0), 0)) })).filter((c) => c.usd !== 0).sort((a, b) => b.usd - a.usd);
  const capex = groups.find((g) => g.k === 'capex')!.usd;
  const opex = groups.reduce((n, g) => n + g.usd, 0) - capex;
  const ts = tradeSpend(s, whereWeeks);
  const trades = (['mech', 'elec', 'build', 'fin'] as const).map((k) => ({ k, label: k === 'fin' ? 'Office (overhead, payroll, carrying)' : k === 'build' ? 'Builders' : ROLE_LABEL[k], usd: ts[k] }));
  const assets = assetSpend(s, 13)
    .slice(0, 3)
    .map((a) => ({ name: a.asset.startsWith('build:') ? `Builders' site work` : assetName(s, a.asset) || a.asset, usd: a.usd }));
  const rows = plannerRows(s, 'all');
  const top = (g: 'parts' | 'consumables', cls: MoveClass[]) =>
    rows
      .filter((r) => (g === 'consumables' ? r.group === 'consumables' : r.group !== 'consumables') && r.cls !== null && cls.includes(r.cls))
      .sort((a, b) => (cls.includes('fast') ? b.valueMoved - a.valueMoved : b.value - a.value))
      .slice(0, 3);
  const inv = Math.round(invValue(s));
  const td = tierDef(s.tier);
  const proj = projectWeek(s);
  return {
    week: s.week,
    cash: Math.round(s.cash),
    spendable: Math.round(spendable(s)),
    committed: committed(s),
    payable: payable(s),
    credit: Math.round(s.credit ?? 0),
    weeks,
    runway: { ...runway(s), loan: !!s.loan },
    budgets: (['mech', 'elec'] as const).map((role) => ({ role, spent: s.autoSpent[role] ?? 0, of: s.autoBudget[role] ?? 0 })),
    forecast: proj.revenue,
    budgetNow: proj.budget,
    where: { weeks: recent.length, groups, cats, capex, opex, trades, assets },
    stock: {
      inv,
      builtUsed: stockBuiltUsed(s, 12),
      tiedUp: cashInStock(s),
      committed: committed(s),
      capital: capitalCost(s),
      fill: fillRate(s, 8),
      waits: waitWeeks(s, 8),
      bins: binsInUse(s),
      binsTotal: binsTotal(s),
      fast: { parts: top('parts', ['fast']), consumables: top('consumables', ['fast']) },
      slow: { parts: top('parts', ['slow', 'dead']), consumables: top('consumables', ['slow', 'dead']) },
    },
    overhead: { lines: splitWhole(td.overhead, OVERHEAD_SPLIT.map((l) => l.share)).map((usd, i) => ({ label: OVERHEAD_SPLIT[i].label, usd })), total: td.overhead },
    payroll: payrollLines(s),
    fixed: fixedNow(s),
  };
}

// ---------------------------------------------------------------------------
// The desk's tabs: counts and dots (17.3)

/** open roles below the standard crew for the tier (a builder only while a build is open) */
export function openRoles(s: IslandState): number {
  const std = STAFF.standard[Math.max(1, Math.min(5, s.tier)) - 1];
  const building = (s.builds ?? []).some((b) => b.finished === undefined);
  let n = 0;
  for (const r of NPC_ROLES) {
    if (r === 'builder' && !building) continue;
    const have = (s.staff ?? []).filter((x) => x.role === r).length;
    n += Math.max(0, (std[r] ?? 0) - have);
  }
  return n;
}

export type DeskTab = 'approvals' | 'stock' | 'money' | 'staff';

export function deskCounts(s: IslandState): { approvals: number; stockDot: boolean; staff: number; desk: number } {
  const approvals = flowQueue(s).length + reqQueue(s).length + legacyQueue(s).length;
  const urgentFlags = stockFlags(s).some((f) => f.urgent);
  const soonNeeds = needs(s).some((n) => n.due <= s.week + 1);
  const desk = s.orders.filter((o) => o.role === 'fin' && o.status === 'ready').length;
  return { approvals, stockDot: urgentFlags || soonNeeds, staff: openRoles(s), desk };
}

/** the tab the desk opens on: Approvals when something waits, else Stock */
export function openingTab(s: IslandState): DeskTab {
  const c = deskCounts(s);
  return c.approvals + c.desk > 0 ? 'approvals' : 'stock';
}

// ---------------------------------------------------------------------------
// The desk tasks, fed real items (17.3): the auction's lot, the invoice match's POs

export function deskTaskLine(s: IslandState, o: Order): string | null {
  if (o.kind === 'auction' && o.lot) {
    const lines = o.lot.lines.map((l) => `${l.qty} × ${itemById(l.item)?.pn ?? l.item}`);
    return `Broker lot: ${lines.join(', ')} · ${usd(o.lot.list)} at list`;
  }
  if (o.kind === 'invoice') {
    const pos = (s.pos ?? []).filter((p) => p.status === 'received' && p.got === s.week - 1);
    if (pos.length) return `${pos.map((p) => p.id).join(', ')} came in last week (${usd(pos.reduce((n, p) => n + p.cost, 0))}): match before the payment run`;
  }
  return null;
}

/** requisitions, for tests and the flags: the Requisition behind a ReqVM */
export const reqOf = (s: IslandState, id: string): Requisition | undefined => s.reqs?.find((r) => r.id === id);
