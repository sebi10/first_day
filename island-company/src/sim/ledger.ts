// Finance tracking (docs/JOBFLOW.md 14.1): the weekly aggregates the analyst's
// charts read, stored in a bounded ledger (26 weeks, sparse), and the series
// derived from them and the week reports. Nothing item-level is kept beyond
// the units each item moved in a week.
import { INSURANCE, STOCK, TIERS } from './data';
import { itemById, priceAt } from './items';
import { payroll } from './staff';
import type { IslandState, ItemId, PurchaseOrder, SpendCat, WeekLedger } from './types';

const cents = (v: number) => Math.round(v * 100) / 100;

/** this week's row, created on first use (rows stay sorted by week) */
export function ledgerRow(s: IslandState, W = s.week): WeekLedger {
  const L = (s.ledger ??= []);
  let row = L.find((x) => x.w === W);
  if (!row) {
    row = { w: W, rev: 0, cash: s.cash, sp: {}, tr: {}, inv: 0 };
    L.push(row);
    L.sort((a, b) => a.w - b.w);
  }
  return row;
}

/** cash out (or back, negative) by category, with the trade and the asset it was for */
export function book(s: IslandState, cat: SpendCat, usd: number, o: { trade?: 'mech' | 'elec' | 'build' | 'fin'; asset?: string | null } = {}): void {
  if (!usd) return;
  const row = ledgerRow(s);
  row.sp[cat] = cents((row.sp[cat] ?? 0) + usd);
  if (o.trade) row.tr[o.trade] = cents((row.tr[o.trade] ?? 0) + usd);
  if (o.asset) {
    row.as ??= {};
    row.as[o.asset] = cents((row.as[o.asset] ?? 0) + usd);
  }
}

/** units consumed at a sign-off (or drawn by the builders), at average cost */
export function bookUse(s: IslandState, item: ItemId, qty: number, value: number, asset: string | null): void {
  if (qty <= 0) return;
  const row = ledgerRow(s);
  row.use ??= {};
  row.use[item] = (row.use[item] ?? 0) + qty;
  row.usedV = cents((row.usedV ?? 0) + value);
  if (asset) {
    row.as ??= {};
    row.as[asset] = cents((row.as[asset] ?? 0) + value);
  }
}

/** value received into stock (stock built) */
export function bookRcv(s: IslandState, value: number): void {
  if (!value) return;
  const row = ledgerRow(s);
  row.rcvV = cents((row.rcvV ?? 0) + value);
}

/** written off: scrapped consumables, the share a return doesn't credit */
export function bookLoss(s: IslandState, usd: number): void {
  if (!usd) return;
  const row = ledgerRow(s);
  row.loss = cents((row.loss ?? 0) + usd);
}

/** a plan's main-slot value covered from stock / its main-slot value */
export function bookFill(s: IslandState, filled: number, planned: number): void {
  if (planned <= 0) return;
  const row = ledgerRow(s);
  const [f, p] = row.fill ?? [0, 0];
  row.fill = [cents(f + filled), cents(p + planned)];
}

/** a plane-week AOG on an alert, by why */
export function bookAog(s: IslandState, cause: 'stock' | 'approval' | 'plan' | 'carrier'): void {
  const row = ledgerRow(s);
  row.aog ??= {};
  row.aog[cause] = (row.aog[cause] ?? 0) + 1;
}

/** job-weeks waiting on parts */
export function bookWait(s: IslandState, n: number): void {
  if (!n) return;
  const row = ledgerRow(s);
  row.wait = (row.wait ?? 0) + n;
}

/** store credit used at a payment run */
export function bookCredit(s: IslandState, usd: number): void {
  if (!usd) return;
  const row = ledgerRow(s);
  row.cr = cents((row.cr ?? 0) + usd);
}

/** inventory value at moving-average cost (a line never received, at list) */
export function invValue(s: Pick<IslandState, 'inv'>): number {
  let v = 0;
  for (const [id, l] of Object.entries(s.inv ?? {})) {
    if (!l.on) continue;
    const x = itemById(id);
    v += l.on * (l.avg ?? (x ? priceAt(x) : 0));
  }
  return cents(v);
}

/** resolve step 19: the week's revenue, cash and inventory value. The ledger holds STOCK.ledgerWeeks rows: the week in progress and the ones before it */
export function closeLedger(s: IslandState, W: number, revenue: number): void {
  const row = ledgerRow(s, W);
  row.rev = Math.round(revenue);
  row.cash = Math.round(s.cash);
  row.inv = Math.round(invValue(s));
  s.ledger = (s.ledger ?? []).filter((x) => x.w > W + 1 - STOCK.ledgerWeeks);
}

// ---------------------------------------------------------------------------
// Series (14.2): pure reads of the ledger and the week reports

export type OutCat = 'parts' | 'labor' | 'freight' | 'carry' | 'payroll' | 'overhead' | 'tools' | 'building' | 'insurance' | 'incidents' | 'other';
const OUT: Record<SpendCat, OutCat> = {
  parts: 'parts',
  consumables: 'parts',
  rotables: 'parts',
  materials: 'parts',
  tools: 'tools',
  building: 'building',
  freight: 'freight',
  labor: 'labor',
  carry: 'carry',
  payroll: 'payroll',
  overhead: 'overhead',
  eng: 'other',
};
const zeroOut = (): Record<OutCat, number> => ({ parts: 0, labor: 0, freight: 0, carry: 0, payroll: 0, overhead: 0, tools: 0, building: 0, insurance: 0, incidents: 0, other: 0 });

/** revenue and cash out by category, the last `weeks` weeks (ledger rows merged with the week reports) */
export function spendSeries(s: IslandState, weeks = 12): { w: number; rev: number; out: Record<OutCat, number>; cash: number }[] {
  const last = s.history.length ? s.history[s.history.length - 1].week : s.week - 1;
  const out: { w: number; rev: number; out: Record<OutCat, number>; cash: number }[] = [];
  for (let w = Math.max(1, last - weeks + 1); w <= last; w++) {
    const row = s.ledger?.find((x) => x.w === w);
    const h = s.history.find((x) => x.week === w);
    const o = zeroOut();
    if (row) for (const [k, v] of Object.entries(row.sp)) o[OUT[k as SpendCat]] += v ?? 0;
    if (h) {
      o.insurance += h.costs.insurance;
      o.incidents += h.costs.incidents;
      o.other += (h.costs.leak ?? 0) + (h.costs.reports ?? 0) + (h.costs.loan ?? 0) + (h.costs.power ?? 0);
      // an old week (before the ledger): its fixed cost is overhead + payroll
      if (!row) {
        const std = payrollAt(h.tier);
        o.overhead += h.costs.fixed - std;
        o.payroll += std;
      }
    }
    for (const k of Object.keys(o) as OutCat[]) o[k] = Math.round(o[k]);
    out.push({ w, rev: row?.rev ?? h?.revenue ?? 0, out: o, cash: row?.cash ?? h?.cashEnd ?? s.cash });
  }
  return out;
}

const payrollAt = (tier: number) => {
  const t = TIERS[Math.max(1, Math.min(5, tier)) - 1];
  return t.fixed - t.overhead;
};

/** cash out by trade, the last `weeks` weeks */
export function tradeSpend(s: IslandState, weeks = 4): Record<'mech' | 'elec' | 'build' | 'fin', number> {
  const out = { mech: 0, elec: 0, build: 0, fin: 0 };
  for (const row of lastRows(s, weeks)) for (const [k, v] of Object.entries(row.tr)) out[k as keyof typeof out] += v ?? 0;
  for (const k of Object.keys(out) as (keyof typeof out)[]) out[k] = Math.round(out[k]);
  return out;
}

/** parts consumed + labour by asset, the last `weeks` weeks, largest first */
export function assetSpend(s: IslandState, weeks = 13): { asset: string; usd: number }[] {
  const m = new Map<string, number>();
  for (const row of lastRows(s, weeks)) for (const [a, v] of Object.entries(row.as ?? {})) m.set(a, (m.get(a) ?? 0) + v);
  return [...m.entries()].map(([asset, usd]) => ({ asset, usd: Math.round(usd) })).sort((a, b) => b.usd - a.usd || (a.asset < b.asset ? -1 : 1));
}

/** stock built (received) vs used (consumed), by week */
export function stockBuiltUsed(s: IslandState, weeks = 12): { w: number; built: number; used: number }[] {
  return lastRows(s, weeks).map((r) => ({ w: r.w, built: Math.round(r.rcvV ?? 0), used: Math.round(r.usedV ?? 0) }));
}

/** main-slot value covered from stock at plan time / planned, the last `weeks` weeks (null: nothing planned) */
export function fillRate(s: IslandState, weeks = 8): number | null {
  let f = 0;
  let p = 0;
  for (const r of lastRows(s, weeks)) {
    f += r.fill?.[0] ?? 0;
    p += r.fill?.[1] ?? 0;
  }
  return p > 0 ? f / p : null;
}

/** job-weeks waiting on parts, the last `weeks` weeks */
export function waitWeeks(s: IslandState, weeks = 8): number {
  return lastRows(s, weeks).reduce((n, r) => n + (r.wait ?? 0), 0);
}

// ---------------------------------------------------------------------------
// Commitments and payables (9.7): what every "can we afford it" check reads

/** what a PO still owes the vendor: its cost and what the invoice overbilled, less what was sent back and what the match caught (nothing once paid) */
export function poOwed(p: PurchaseOrder): number {
  if (p.status === 'paid') return 0;
  return Math.max(0, p.cost + (p.over ?? 0) - (p.refund ?? 0) - (p.caught ?? 0));
}

/** cash still owed on open, held and received-unpaid POs, after the store credit that will pay them */
export function committed(s: Pick<IslandState, 'pos' | 'credit'>): number {
  const owed = (s.pos ?? []).reduce((n, p) => n + poOwed(p), 0);
  return Math.max(0, Math.round(owed - (s.credit ?? 0)));
}

/** the POs received and not yet paid: the next resolve's payment run */
export function payable(s: Pick<IslandState, 'pos'>): number {
  return Math.round((s.pos ?? []).filter((p) => p.status === 'received').reduce((n, p) => n + poOwed(p), 0));
}

/** cash less what's committed: every approval, buy and budget check reads it (the bank balance still decides receivership) */
export const spendable = (s: Pick<IslandState, 'cash' | 'pos' | 'credit'>) => s.cash - committed(s);

/** the fixed weekly outgoings (overhead + payroll + the insurance premium + the loan), and the weeks of it spendable cash covers */
export function runway(s: IslandState): { weekly: number; weeks: number } {
  const t = TIERS[Math.max(1, Math.min(5, s.tier)) - 1];
  const premium = Math.round(INSURANCE[s.insurance].premium * (1 + 0.25 * (s.tier - 1)));
  const weekly = t.overhead + payroll(s) + premium + (s.loan?.weekly ?? 0);
  return { weekly, weeks: weekly > 0 ? Math.max(0, Math.round((spendable(s) / weekly) * 10) / 10) : 0 };
}

/** cash tied up in stock: the stock's value less what the vendors are still owed for what came in (they finance it until the payment run) */
export const cashInStock = (s: IslandState) => Math.max(0, Math.round(invValue(s) - payable(s)));

/** the cost of the cash tied up in stock, a week (shown, never charged). Open POs aren't cash out yet: they're committed, not paid */
export function capitalCost(s: IslandState): number {
  return Math.round(cashInStock(s) * STOCK.capital);
}

/** the ledger's last `weeks` rows before this week's */
function lastRows(s: IslandState, weeks: number): WeekLedger[] {
  const L = s.ledger ?? [];
  const last = s.history.length ? s.history[s.history.length - 1].week : s.week - 1;
  return L.filter((r) => r.w <= last && r.w > last - weeks);
}
