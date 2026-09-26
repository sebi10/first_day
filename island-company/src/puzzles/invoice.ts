// Finance · Three-way match. Accounts payable: before a vendor invoice is paid
// it must agree with the purchase order (what we agreed to buy, at what price)
// and the receiving report (what actually came off the cargo flight). Swipe
// right to pay, left to hold — and say why by tapping the line that is wrong.
// Real rules: a small price variance inside tolerance is fine; a partial
// delivery billed for what arrived is fine; "2/10 net 30" means 2% off if paid
// within 10 days — worth taking when cash allows.
import { rng, type Rng } from '../sim/rng';
import { C, FONT, backdrop, clamp, ease, loop, pointer, roundRect, shade, stage } from './kit';
import { result, type PuzzleContext, type PuzzleDef, type PuzzleResult } from './types';

export type InvIssue = 'qty' | 'price' | 'dupe' | 'freight' | 'tax';
export type InvScenario =
  | 'clean'
  | 'partial' // part of the order arrived and was billed as such → pay (tier 2+)
  | 'tolerance' // unit price a touch over PO, inside tolerance → pay (tier 2+)
  | 'freightOk' // freight billed, and the PO allowed it → pay (tier 4+)
  | 'discount' // 2/10 net 30, inside the window, cash allows → pay early (tier 3+)
  | 'discountLate' // 2/10 net 30 but the window has closed → plain pay (tier 5)
  | 'discountCash' // inside the window but it would dip cash below the floor → plain pay (tier 4)
  | InvIssue;

/** Row ids a player can tap: -1 invoice number, 0..n-1 line items, then freight and tax. */
export const ROW_NUM = -1;
export const ROW_FREIGHT = 90;
export const ROW_TAX = 91;

export type InvLine = {
  item: string;
  poQty: number;
  poPrice: number;
  /** receiving report: what came off the cargo flight */
  rcvd: number;
  /** invoiced */
  qty: number;
  price: number;
};

export type InvCard = {
  scenario: InvScenario;
  vendor: string;
  number: string;
  po: string;
  /** invoice date, day of month */
  day: number;
  /** "2/10 net 30" instead of "Net 30" */
  discountTerms: boolean;
  lines: InvLine[];
  /** freight the PO allows (null = not on PO) */
  freightPo: number | null;
  freight: number;
  /** rate printed on the invoice */
  taxRate: number;
  tax: number;
  total: number;
  /** vendor history strip: the last invoice we paid them */
  last: { number: string; amount: number; day: number; po: string };
  issue: { kind: InvIssue; row: number } | null;
  /** $ protected by holding (bad) or saved by taking the discount */
  atStake: number;
  discount: number;
  windowOpen: boolean;
};

export type InvModel = {
  tier: number;
  month: string;
  today: number;
  cash: number;
  /** keep at least this much cash on hand */
  floor: number;
  taxRate: number;
  tolPct: number;
  tolAbs: number;
  cards: InvCard[];
  /** Σ atStake — the money a clean run protects, ≈ context.leak */
  money: number;
  /** PO shows unit price and the tolerance band: teaching tiers, or the poLookup tool */
  band: boolean;
  /** the discount toggle counts down the 10-day window (teaching tiers only) */
  showWindow: boolean;
  /** tiers 0–2 teach: band printed, window countdown, agreed tax rate on the PO */
  teach: boolean;
};

export type InvDecision = { action: 'pay' | 'early' | 'hold'; row?: number };

export type InvVerdict = {
  credit: number;
  right: boolean;
  wrong: boolean;
  saved: number;
  lost: number;
  /** cash after this decision */
  cash: number;
  msg: string;
};

const MONTH = 'Sep';
const MINUS = '−';

type Vendor = { name: string; code: string; items: [string, number, number][] };
const VENDORS: Vendor[] = [
  { name: 'Harbor Supply', code: 'HS', items: [['Prop gaskets', 14, 26], ['Brake pads', 48, 82], ['Hydraulic hose', 28, 64], ['O-ring kit', 12, 24]] },
  { name: 'Aero Parts Co', code: 'AP', items: [['Spark plugs', 18, 34], ['Oil filters', 22, 42], ['Main tyre', 180, 260], ['Pump seal', 40, 76]] },
  { name: 'Reef Linen', code: 'RL', items: [['Bath towels', 9, 16], ['Sheet sets', 38, 62], ['Beach towels', 12, 21], ['Pillows', 14, 26]] },
  { name: 'Island Hardware', code: 'IH', items: [['Deck screws', 11, 19], ['Exterior paint', 34, 52], ['Door hinges', 6, 12], ['Shade cloth', 45, 90]] },
  { name: 'Coral Electric', code: 'CE', items: [['Floodlight', 45, 85], ['20A breaker', 12, 24], ['Cable 50 m', 60, 110], ['Outdoor socket', 16, 30]] },
  { name: 'Lagoon Foods', code: 'LF', items: [['Welcome basket', 18, 32], ['Coffee 1 kg', 16, 28], ['Water (case)', 6, 11]] },
];

const WEIGHT: Record<InvIssue, number> = { dupe: 1.6, qty: 1.2, price: 0.9, freight: 0.6, tax: 0.35 };
const ISSUES: InvIssue[] = ['qty', 'price', 'dupe', 'freight', 'tax'];
const isIssue = (s: InvScenario): s is InvIssue => (ISSUES as string[]).includes(s);

const r2 = (v: number) => Math.round(v * 100) / 100;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function money(v: number, o: { sign?: boolean; dollar?: boolean; cents?: boolean } = {}): string {
  const a = Math.abs(v);
  const fixed = o.cents === false ? String(Math.round(a)) : a.toFixed(2);
  const [int, dec] = fixed.split('.');
  const body = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (dec ? '.' + dec : '');
  const sign = v <= -0.005 ? MINUS : o.sign && v >= 0.005 ? '+' : '';
  return `${sign}${o.dollar === false ? '' : '$'}${body}`;
}
const pct = (r: number) => `${+(r * 100).toFixed(1)}%`;

/** The most a line may run over PO and still be paid: 2% of the line or $10, whichever is more. */
export function allowedOver(m: Pick<InvModel, 'tolPct' | 'tolAbs'>, l: InvLine): number {
  return Math.max(m.tolAbs, m.tolPct * l.poPrice * l.qty);
}
export function lineInTolerance(m: Pick<InvModel, 'tolPct' | 'tolAbs'>, l: InvLine): boolean {
  return (l.price - l.poPrice) * l.qty <= allowedOver(m, l) + 0.005;
}
/** poLookup: highest unit price that still passes. */
export function bandMax(m: Pick<InvModel, 'tolPct' | 'tolAbs'>, l: InvLine): number {
  return l.poPrice + Math.floor((allowedOver(m, l) / l.qty) * 100 + 1e-6) / 100;
}
export const subtotal = (c: InvCard) => r2(sum(c.lines.map((l) => l.qty * l.price)));
export const payNow = (c: InvCard) => r2(c.total - c.discount);

/** What an auditor would find on this card from the numbers alone (duplicates need the history strip). */
export function detectIssue(m: InvModel, c: InvCard): InvIssue | null {
  if (c.lines.some((l) => l.qty > l.rcvd)) return 'qty';
  if (c.lines.some((l) => !lineInTolerance(m, l))) return 'price';
  if (c.freight > 0 && c.freightPo !== c.freight) return 'freight';
  if (Math.abs(c.taxRate - m.taxRate) > 1e-9 || Math.abs(c.tax - r2(m.taxRate * subtotal(c))) > 0.005) return 'tax';
  if (c.last.po === c.po && Math.abs(c.last.amount - c.total) < 0.005) return 'dupe';
  return null;
}

function planFor(r: Rng, t: number): InvScenario[] {
  const bad = (pool: InvIssue[], n: number) => r.shuffle([...pool]).slice(0, n);
  switch (t) {
    case 0:
      return ['clean', 'qty'];
    case 1:
      return ['clean', 'freight', r.pick(['qty', 'price'] as const)];
    case 2:
      return [r.pick(['clean', 'tolerance'] as const), 'partial', ...bad(['qty', 'price', 'freight'], 2)];
    case 3:
      return ['discount', r.pick(['tolerance', 'partial'] as const), ...bad(['tax', 'dupe'], 1), ...bad(['qty', 'price', 'freight'], 2)];
    case 4:
      return ['discount', 'discountCash', 'freightOk', 'tolerance', 'dupe', ...bad(['price', 'tax', 'qty'], 2)];
    default:
      return ['discount', 'discountLate', 'partial', 'tolerance', 'dupe', 'tax', ...bad(['price', 'qty', 'freight'], 2)];
  }
}

function unitPrice(r: Rng, lo: number, hi: number): number {
  return r2(Math.floor(r.range(lo, hi)) + r.pick([0, 0.5, 0.95, 0.25, 0.75]));
}

function buildCard(r: Rng, t: number, sc: InvScenario, v: Vendor, share: number, today: number, m: InvModel): InvCard {
  const n = t <= 0 ? 1 : t <= 2 ? r.int(1, 2) : t === 3 ? 2 : r.int(2, 3);
  const lines: InvLine[] = r
    .shuffle([...v.items])
    .slice(0, n)
    .map(([item, lo, hi]) => {
      const q = r.int(2, t <= 1 ? 6 : 10);
      const p = unitPrice(r, lo, hi);
      return { item, poQty: q, poPrice: p, rcvd: q, qty: q, price: p };
    });
  const num = r.int(1100, 4899);
  const poNum = r.int(140, 480);
  const c: InvCard = {
    scenario: sc,
    vendor: v.name,
    number: `${v.code}-${num}`,
    po: `PO-${poNum}`,
    day: today - r.int(3, 18),
    discountTerms: false,
    lines,
    freightPo: null,
    freight: 0,
    taxRate: m.taxRate,
    tax: 0,
    total: 0,
    last: { number: `${v.code}-${num - r.int(4, 60)}`, amount: 0, day: 1, po: `PO-${poNum - r.int(3, 30)}` },
    issue: null,
    atStake: 0,
    discount: 0,
    windowOpen: false,
  };
  c.last.day = clamp(c.day - r.int(2, 9), 1, today - 1);
  c.last.amount = r2(r.range(90, 900));
  // tier 4+: other invoices on the same PO are normal (split shipments) — only amount + number tell a duplicate
  if (t >= 4 && !isIssue(sc) && r.chance(0.4)) c.last.po = c.po;
  const pickLine = () => r.int(0, lines.length - 1);
  const bigLine = () => lines.reduce((bi, l, i) => (l.poPrice * l.poQty > lines[bi].poPrice * lines[bi].poQty ? i : bi), 0);

  switch (sc) {
    case 'partial': {
      const L = lines[pickLine()];
      if (L.poQty < 4) L.poQty = r.int(4, 8);
      L.rcvd = L.qty = L.poQty - r.int(1, L.poQty - 2);
      if (t >= 5) c.last.po = c.po; // an earlier invoice on this PO: legit, the amounts differ
      break;
    }
    case 'tolerance': {
      const L = lines[pickLine()];
      const over = allowedOver(m, L) * (t >= 5 ? r.range(0.7, 0.92) : r.range(0.3, 0.75));
      L.price = r2(L.poPrice + Math.max(0.01, Math.floor((over / L.qty) * 100) / 100));
      break;
    }
    case 'freightOk':
      c.freightPo = c.freight = r.pick([25, 35, 45, 60, 85]);
      break;
    case 'discount':
    case 'discountCash':
      c.discountTerms = true;
      c.day = today - r.int(1, 8);
      c.windowOpen = true;
      break;
    case 'discountLate':
      c.discountTerms = true;
      c.day = today - r.int(12, 19);
      break;
    case 'qty': {
      const j = bigLine();
      const L = lines[j];
      let short = t >= 4 ? r.int(1, 2) : clamp(Math.round(share / L.poPrice), 1, 8);
      if (t === 0) short = Math.max(short, Math.ceil(L.poQty / 2));
      if (L.poQty - short < 1) L.poQty = short + r.int(1, 3);
      L.qty = L.poQty;
      L.rcvd = L.poQty - short;
      c.issue = { kind: 'qty', row: j };
      c.atStake = r2(short * L.price);
      break;
    }
    case 'price': {
      const j = bigLine();
      const L = lines[j];
      const allow = allowedOver(m, L);
      let over = t >= 4 ? allow * r.range(1.15, 1.5) : Math.max(share, allow * r.range(1.6, 2.4));
      over = Math.max(Math.min(over, 0.45 * L.poPrice * L.qty), allow * 1.15); // keep the unit price believable
      let d = Math.ceil((over / L.qty) * 100) / 100;
      while (d * L.qty <= allow + 0.005) d = r2(d + 0.01);
      L.price = r2(L.poPrice + d);
      c.issue = { kind: 'price', row: j };
      c.atStake = r2(d * L.qty);
      break;
    }
    case 'freight':
      c.freight = clamp(Math.round(share / 5) * 5, 25, 240);
      c.issue = { kind: 'freight', row: ROW_FREIGHT };
      c.atStake = c.freight;
      break;
    case 'dupe': {
      // size the resent invoice to its share of the money at stake
      const L = lines[0];
      const others = sum(lines.slice(1).map((l) => l.qty * l.price));
      const q = clamp(Math.round((share / (1 + m.taxRate) - others) / L.price), 1, 24);
      L.poQty = L.rcvd = L.qty = q;
      c.day = today - r.int(8, 16);
      c.issue = { kind: 'dupe', row: ROW_NUM };
      break;
    }
    default:
      break;
  }

  retotal(c, m);
  const sub = subtotal(c);
  const fair = r2(m.taxRate * sub);
  if (sc === 'tax') {
    if (t >= 5) c.tax = r2(fair + r.range(4, 16)); // right rate, wrong sum
    else {
      c.taxRate = r.pick([0.08, 0.1, 0.075]);
      c.tax = r2(c.taxRate * sub);
    }
    c.issue = { kind: 'tax', row: ROW_TAX };
    c.atStake = r2(c.tax - fair);
    c.total = r2(sub + c.freight + c.tax);
  }
  if (sc === 'dupe') {
    const original = c.number;
    // tier 5: resent with a "fixed" number — same PO, same amount
    if (t >= 5) c.number = r.pick([`${original}A`, `${original}-1`, `${v.code}-0${num}`, `${v.code}${num}`]);
    c.last = { number: original, amount: c.total, day: clamp(c.day + r.int(2, 5), 1, today - 1), po: c.po };
    c.atStake = c.total;
  }
  if (c.discountTerms) c.discount = r2(0.02 * c.total);
  if (sc === 'discount') c.atStake = c.discount;
  return c;
}

/** Recompute tax (at the fair rate), total and discount after the lines change. */
function retotal(c: InvCard, m: InvModel) {
  c.tax = r2(m.taxRate * subtotal(c));
  c.total = r2(subtotal(c) + c.freight + c.tax);
  c.discount = c.discountTerms ? r2(0.02 * c.total) : 0;
}

/** Nudge the flexible bad invoices, one at a time, until the batch puts ≈ leak at stake. */
function rebalance(m: InvModel, leak: number) {
  const staked = () => sum(m.cards.map((c) => c.atStake));
  for (const k of ['dupe', 'qty', 'freight', 'price'] as InvIssue[]) {
    const c = m.cards.find((x) => x.issue?.kind === k);
    const gap = leak - staked();
    if (!c || !c.issue || Math.abs(gap) <= leak * 0.08) continue;
    const target = Math.max(0, c.atStake + gap);
    if (k === 'dupe') {
      const want = Math.max(60, target);
      const f = want / c.total;
      for (const l of c.lines) l.poQty = l.rcvd = l.qty = Math.max(1, Math.round(l.qty * f));
      const cheap = c.lines.reduce((x, y) => (y.price < x.price ? y : x));
      const miss = want / (1 + m.taxRate) - subtotal(c);
      cheap.poQty = cheap.rcvd = cheap.qty = Math.max(1, cheap.qty + Math.round(miss / cheap.price));
      retotal(c, m);
      c.last.amount = c.atStake = c.total;
    } else if (k === 'qty' && m.tier < 4) {
      const l = c.lines[c.issue.row];
      const short = clamp(Math.round(target / l.price), 1, 30);
      l.poQty = l.qty = l.rcvd + short;
      retotal(c, m);
      c.atStake = r2(short * l.price);
    } else if (k === 'freight') {
      c.freight = clamp(Math.round(target / 5) * 5, 20, Math.max(300, leak * 0.5));
      retotal(c, m);
      c.atStake = c.freight;
    } else if (k === 'price' && m.tier < 4) {
      const l = c.lines[c.issue.row];
      const q = clamp(Math.ceil(target / (0.45 * l.poPrice)), l.qty, 40);
      l.poQty = l.rcvd = l.qty = q;
      const allow = allowedOver(m, l);
      let d = Math.ceil((Math.max(target, allow * 1.15) / q) * 100) / 100;
      d = Math.min(d, Math.max(r2(0.45 * l.poPrice), Math.ceil(((allow * 1.15) / q) * 100) / 100));
      while (d * q <= allow + 0.005) d = r2(d + 0.01);
      l.price = r2(l.poPrice + d);
      retotal(c, m);
      c.atStake = r2(d * q);
    }
  }
}

export function generateInvoice(seed: number, tier: number, tools: string[] = [], context?: PuzzleContext): InvModel {
  const t = clamp(Math.round(tier), 0, 5);
  const r = rng(seed);
  const leak = clamp(Math.round(context?.leak ?? 500), 60, 100000);
  const plan = planFor(r, t);
  const today = r.int(20, 27);
  const m: InvModel = {
    tier: t,
    month: MONTH,
    today,
    cash: 0,
    floor: 1500,
    taxRate: 0.05,
    tolPct: 0.02,
    tolAbs: 10,
    cards: [],
    money: 0,
    band: t <= 2 || tools.includes('poLookup'),
    showWindow: t <= 2,
    teach: t <= 2,
  };
  const pool = r.shuffle([...VENDORS]);
  const badW = sum(plan.filter(isIssue).map((k) => WEIGHT[k]));
  const top = (v: Vendor) => Math.max(...v.items.map((it) => it[2]));
  const cards = plan.map((sc) => {
    const share = isIssue(sc) ? (leak * WEIGHT[sc]) / badW : 0;
    // a short-shipment can only put real money at stake on a pricey part
    const fits = sc === 'qty' && t < 4 ? pool.filter((v) => top(v) * 5 >= share) : [];
    const v = sc === 'qty' && t < 4 ? fits[0] ?? pool.reduce((x, y) => (top(y) > top(x) ? y : x)) : pool[0];
    pool.splice(pool.indexOf(v), 1);
    if (!pool.length) pool.push(...r.shuffle([...VENDORS]));
    return buildCard(r, t, sc, v, share, today, m);
  });
  if (t > 0) r.shuffle(cards); // the tutorial teaches pay first, then hold
  // a cash-limited discount must come after the ones you can afford
  const lim = cards.findIndex((c) => c.scenario === 'discountCash');
  const ok = cards.findIndex((c) => c.scenario === 'discount');
  if (lim >= 0 && ok > lim) [cards[lim], cards[ok]] = [cards[ok], cards[lim]];
  const early = sum(cards.filter((c) => c.scenario === 'discount').map(payNow));
  const tight = cards.find((c) => c.scenario === 'discountCash');
  const slack = tight ? payNow(tight) * r.range(0.3, 0.7) : r.range(250, 900);
  m.cash = r2(m.floor + early + slack);
  m.cards = cards;
  rebalance(m, leak);
  m.money = r2(sum(cards.map((c) => c.atStake)));
  return m;
}

export function canTakeDiscount(m: InvModel, c: InvCard, cash: number): boolean {
  return c.discount > 0 && c.windowOpen && !c.issue && cash - payNow(c) >= m.floor - 0.005;
}

/** Plain-language reason, as it would go on the dispute note to the vendor. */
export function issueText(m: InvModel, c: InvCard): string {
  if (!c.issue) return '';
  switch (c.issue.kind) {
    case 'qty': {
      const l = c.lines[c.issue.row];
      return `billed ${l.qty} ${l.item.toLowerCase()}, ${l.rcvd} arrived`;
    }
    case 'price': {
      const l = c.lines[c.issue.row];
      return `${money(l.price)} vs PO ${money(l.poPrice)}, over tolerance`;
    }
    case 'dupe':
      return `duplicate of #${c.last.number}, already paid`;
    case 'freight':
      return `freight ${money(c.freight)} not on the PO`;
    case 'tax':
      return Math.abs(c.taxRate - m.taxRate) > 1e-9
        ? `tax at ${pct(c.taxRate)}, island rate is ${pct(m.taxRate)}`
        : `tax should be ${money(r2(m.taxRate * subtotal(c)))}`;
  }
}

function okText(c: InvCard): string {
  switch (c.scenario) {
    case 'partial':
      return 'partial delivery billed as received';
    case 'tolerance':
      return 'price variance inside tolerance';
    case 'freightOk':
      return 'freight is on the PO';
    default:
      return 'PO, receipt and invoice agree';
  }
}

export function judgeInvoice(m: InvModel, c: InvCard, d: InvDecision, cash: number): InvVerdict {
  const v = (o: Partial<InvVerdict> & { credit: number; msg: string }): InvVerdict => ({
    right: false,
    wrong: false,
    saved: 0,
    lost: 0,
    cash,
    ...o,
  });
  if (c.issue) {
    const why = issueText(m, c);
    if (d.action === 'hold') {
      if (d.row === c.issue.row) return v({ credit: 1, right: true, saved: c.atStake, msg: `Held ✓ ${why}` });
      return v({ credit: 0.4, wrong: true, saved: c.atStake, msg: `Right to hold — but ${why}` });
    }
    const spent = d.action === 'early' && c.discount > 0 && c.windowOpen ? payNow(c) : 0;
    return v({ credit: m.tier === 0 ? 0.3 : 0, wrong: true, lost: c.atStake, cash: r2(cash - spent), msg: `Should hold: ${why}` });
  }
  if (d.action === 'hold') return v({ credit: m.tier === 0 ? 0.5 : 0.1, wrong: true, msg: `Nothing wrong: ${okText(c)}` });
  if (d.action === 'early' && c.discount > 0) {
    if (canTakeDiscount(m, c, cash))
      return v({ credit: 1, right: true, saved: c.discount, cash: r2(cash - payNow(c)), msg: `Paid early ✓ saved ${money(c.discount)}` });
    if (!c.windowOpen)
      return v({ credit: 0.5, wrong: true, msg: `2% window closed on ${Math.min(30, c.day + 10)} ${m.month}` });
    return v({ credit: 0.5, wrong: true, cash: r2(cash - payNow(c)), msg: `Cash dips below the ${money(m.floor, { cents: false })} floor` });
  }
  if (canTakeDiscount(m, c, cash)) return v({ credit: 0.5, msg: `Paid — missed 2% (${money(c.discount)})` });
  return v({ credit: 1, right: true, msg: `Paid ✓ ${money(c.total)}` });
}

export type InvPlay = { score: number; found: number; wrong: number; decided: number; saved: number; verdicts: (InvVerdict | null)[] };

export function playInvoice(m: InvModel, ds: (InvDecision | undefined)[]): InvPlay {
  let cash = m.cash;
  const verdicts = m.cards.map((c, i) => {
    const d = ds[i];
    if (!d) return null;
    const v = judgeInvoice(m, c, d, cash);
    cash = v.cash;
    return v;
  });
  const got = verdicts.filter((v): v is InvVerdict => !!v);
  return {
    score: clamp(sum(got.map((v) => v.credit)) / m.cards.length, 0, 1),
    found: got.filter((v) => v.right).length,
    wrong: got.filter((v) => v.wrong).length,
    decided: got.length,
    saved: r2(sum(got.map((v) => v.saved))),
    verdicts,
  };
}

export function scoreInvoice(m: InvModel, ds: (InvDecision | undefined)[]): number {
  return playInvoice(m, ds).score;
}

/** A clean run: hold the bad ones with the right reason, take every discount cash allows. */
export function solveInvoice(m: InvModel): InvDecision[] {
  let cash = m.cash;
  return m.cards.map((c) => {
    if (c.issue) return { action: 'hold', row: c.issue.row };
    if (canTakeDiscount(m, c, cash)) {
      cash -= payNow(c);
      return { action: 'early' };
    }
    return { action: 'pay' };
  });
}

export function summarizeInvoice(m: InvModel, ds: (InvDecision | undefined)[]): string {
  const p = playInvoice(m, ds);
  const n = m.cards.length;
  const prot = money(p.saved, { cents: false });
  const w = p.wrong ? `, ${p.wrong} wrong` : '';
  if (p.decided < n) return `${p.decided}/${n} handled, ${p.found} right${w}`;
  if (p.found === n) return `All ${n} invoices right, ${prot} protected`;
  return `${p.found}/${n} invoices right, ${prot} protected${w}`;
}

function invResult(m: InvModel, ds: (InvDecision | undefined)[]): PuzzleResult {
  const p = playInvoice(m, ds);
  return result(p.score, summarizeInvoice(m, ds), { found: p.found, total: m.cards.length, wrong: p.wrong });
}

// ---------------------------------------------------------------- drawing helpers

type Rect = { x: number; y: number; w: number; h: number };
const inRect = (r: Rect, x: number, y: number, slop = 0) =>
  x >= r.x - slop && x <= r.x + r.w + slop && y >= r.y - slop && y <= r.y + r.h + slop;
const isDigit = (ch: string) => ch >= '0' && ch <= '9';

/** Canvas has no tabular-nums: lay digits out on a fixed advance so columns never jitter. */
function tnum(
  ctx: CanvasRenderingContext2D,
  str: string,
  x: number,
  y: number,
  o: { size?: number; weight?: number; color?: string; align?: 'left' | 'right' | 'center' } = {},
): number {
  ctx.font = `${o.weight ?? 700} ${o.size ?? 14}px ${FONT}`;
  ctx.fillStyle = o.color ?? C.ink;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const dw = ctx.measureText('0').width;
  const chars = [...str];
  const ws = chars.map((ch) => (isDigit(ch) ? dw : ctx.measureText(ch).width));
  const total = sum(ws);
  let cx = o.align === 'right' ? x - total : o.align === 'center' ? x - total / 2 : x;
  chars.forEach((ch, i) => {
    ctx.fillText(ch, cx + (isDigit(ch) ? (dw - ctx.measureText(ch).width) / 2 : 0), y);
    cx += ws[i];
  });
  return total;
}

function text(
  ctx: CanvasRenderingContext2D,
  str: string,
  x: number,
  y: number,
  o: { size?: number; weight?: number; color?: string; align?: CanvasTextAlign; max?: number } = {},
) {
  ctx.font = `${o.weight ?? 600} ${o.size ?? 13}px ${FONT}`;
  ctx.fillStyle = o.color ?? C.ink;
  ctx.textAlign = o.align ?? 'left';
  ctx.textBaseline = 'middle';
  let s = str;
  if (o.max && ctx.measureText(s).width > o.max) {
    while (s.length > 1 && ctx.measureText(s + '…').width > o.max) s = s.slice(0, -1);
    s = s.trimEnd() + '…';
  }
  ctx.fillText(s, x, y);
}

function stampMark(ctx: CanvasRenderingContext2D, word: string, x: number, y: number, color: string, t: number, size: number, still: boolean, rot = -0.14) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  const sc = still ? 1 : 1 + 0.6 * (1 - ease.outCubic(clamp(t, 0, 1)));
  ctx.scale(sc, sc);
  ctx.globalAlpha *= still ? 0.92 : clamp(t * 2.5, 0, 1) * 0.92;
  ctx.font = `900 ${size}px ${FONT}`;
  const tw = ctx.measureText(word).width;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2.5, size / 9);
  roundRect(ctx, -tw / 2 - size * 0.4, -size * 0.8, tw + size * 0.8, size * 1.6, 8);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(word, 0, 2);
  ctx.restore();
}

// ---------------------------------------------------------------- puzzle

type Row = { id: number; y: number; h: number };
type CardLay = { h: number; rows: Row[]; headH: number; histY: number; colY: number; totalY: number; toggle: Row | null };

export const invoice: PuzzleDef = {
  id: 'invoice',
  role: 'fin',
  title: 'Three-way match',
  gesture: 'Swipe cards',
  howTo: 'All three agree? Swipe right. If not, tap the problem, swipe left.',
  term: 'Three-way match: pay only what was ordered, received and billed at the agreed price.',
  seconds: (tier) => clamp(60 + tier * 12, 60, 120),
  mount(host, p) {
    const m = generateInvoice(p.seed, p.tier, p.tools, p.context);
    const n = m.cards.length;
    const st = stage(host.el);
    const { ctx } = st;
    const still = p.reducedMotion;
    const decisions: (InvDecision | undefined)[] = [];
    const verdicts: (InvVerdict | null)[] = [];
    let cash = m.cash;
    let idx = 0;
    let flagRow: number | null = null;
    let holdMode = false;
    let early = false;
    let dx = 0;
    let drag: { pid: number; sx: number; sy: number; x: number; lastX: number; lastT: number; vx: number; moved: boolean; onCard: boolean } | null =
      null;
    let press: 'pay' | 'hold' | null = null;
    const flying: { card: number; dir: 1 | -1; fromX: number; t0: number; word: string; color: string; flag: number | null; early: boolean }[] = [];
    let enterT = 0;
    let finished = false;
    let final: PuzzleResult | null = null;
    let doneTimer: ReturnType<typeof setTimeout> | null = null;
    let finishTimer: ReturnType<typeof setTimeout> | null = null;
    const soundTimers = new Set<ReturnType<typeof setTimeout>>();
    let flourishT = -1;
    let rowFlash: { row: number; t0: number } | null = null;
    const tutorial = ['All three agree? Swipe right to pay', 'Rcvd ≠ billed: tap that line, then swipe left'];
    let toast: { str: string; t0: number; color: string; hold?: boolean } | null =
      m.tier === 0 ? { str: tutorial[0], t0: 0, color: C.ink, hold: true } : null;

    const card = () => m.cards[idx];

    const cardLay = (c: InvCard, avail: number): CardLay => {
      const natural = 50 + 26 + 20 + c.lines.length * 50 + (c.freight > 0 || c.freightPo ? 40 : 0) + 40 + 44 + (c.discountTerms ? 56 : 0) + 8;
      const k = clamp(avail / natural, 0.86, 1);
      const rowH = Math.round(50 * k);
      const subH = Math.round(40 * k);
      const headH = 50;
      const histY = headH;
      const colY = histY + 26;
      let y = colY + 20;
      const rows: Row[] = [{ id: ROW_NUM, y: 0, h: headH }];
      c.lines.forEach((_, i) => {
        rows.push({ id: i, y, h: rowH });
        y += rowH;
      });
      if (c.freight > 0 || c.freightPo) {
        rows.push({ id: ROW_FREIGHT, y, h: subH });
        y += subH;
      }
      rows.push({ id: ROW_TAX, y, h: subH });
      y += subH;
      const totalY = y;
      y += Math.round(44 * k);
      let toggle: Row | null = null;
      if (c.discountTerms) {
        toggle = { id: -2, y, h: 56 };
        y += 56;
      }
      return { h: y + 8, rows, headH, histY, colY, totalY, toggle };
    };

    const lay = () => {
      const w = st.w;
      const h = st.h;
      const pad = 12;
      const cw = Math.min(w - pad * 2, 440);
      const x0 = (w - cw) / 2;
      const headY = 8;
      const toastY = 76;
      const btnH = 58;
      const btnY = h - pad - btnH;
      const top = 96;
      const bottom = btnY - 14;
      const c = idx < n ? card() : m.cards[n - 1];
      const cl = cardLay(c, bottom - top);
      const cy = Math.max(top, bottom - cl.h);
      const bw = (cw - 10) / 2;
      return {
        w,
        h,
        x0,
        cw,
        headY,
        toastY,
        top,
        bottom,
        cl,
        card: { x: x0, y: cy, w: cw, h: cl.h } as Rect,
        hold: { x: x0, y: btnY, w: bw, h: btnH } as Rect,
        pay: { x: x0 + bw + 10, y: btnY, w: bw, h: btnH } as Rect,
      };
    };
    type Lay = ReturnType<typeof lay>;

    const status = () => {
      const pl = playInvoice(m, decisions);
      host.status(
        idx < n
          ? `Invoice ${idx + 1} of ${n} · ${money(pl.saved, { cents: false })} protected`
          : `${n} of ${n} done · ${money(pl.saved, { cents: false })} protected`,
      );
    };
    status();

    const later = (fn: () => void, ms: number) => {
      const id = setTimeout(() => {
        soundTimers.delete(id);
        fn();
      }, ms);
      soundTimers.add(id);
    };

    const finish = () => {
      if (finished) return;
      finished = true;
      const res = invResult(m, decisions);
      final = res;
      if (res.perfect) {
        flourishT = performance.now();
        host.fx.flourish();
      } else host.fx.good();
      toast = { str: res.summary, t0: performance.now(), color: res.perfect ? C.palmDark : C.ink, hold: true };
      doneTimer = setTimeout(() => {
        doneTimer = null;
        host.done(res);
      }, res.perfect ? 850 : 350);
    };

    const commit = (action: InvDecision['action'], row?: number) => {
      if (finished || idx >= n) return;
      const c = card();
      const d: InvDecision = action === 'hold' ? { action, row } : { action };
      const v = judgeInvoice(m, c, d, cash);
      cash = v.cash;
      decisions[idx] = d;
      verdicts[idx] = v;
      const now = performance.now();
      host.fx.swipe();
      later(() => (v.wrong ? host.fx.bad() : host.fx.good()), 110);
      toast = { str: v.msg, t0: now, color: v.wrong ? C.rust : v.right ? C.palmDark : C.ink };
      const dir: 1 | -1 = action === 'hold' ? -1 : 1;
      if (!still)
        flying.push({
          card: idx,
          dir,
          fromX: dx,
          t0: now,
          word: action === 'hold' ? 'HELD' : 'PAID',
          color: action === 'hold' ? C.rust : C.palmDark,
          flag: action === 'hold' ? (row ?? null) : null,
          early: action === 'early',
        });
      idx++;
      dx = 0;
      flagRow = null;
      holdMode = false;
      early = false;
      enterT = now;
      if (m.tier === 0 && idx < n && tutorial[idx]) toast = { str: `${v.msg} · next: ${tutorial[idx]}`, t0: now, color: toast.color };
      status();
      if (idx >= n) finishTimer = setTimeout(() => ((finishTimer = null), finish()), still ? 150 : 320);
    };

    const tryHold = () => {
      if (flagRow !== null) {
        commit('hold', flagRow);
        return;
      }
      holdMode = true;
      host.fx.tap();
      toast = { str: 'Hold — tap the line that’s wrong', t0: performance.now(), color: C.rust, hold: true };
    };

    const rowAt = (g: Lay, x: number, y: number): number | null => {
      const r = g.card;
      if (!inRect(r, x, y)) return null;
      const ly = y - r.y;
      const { cl } = g;
      if (cl.toggle && ly >= cl.toggle.y && ly <= cl.toggle.y + cl.toggle.h) return -2;
      for (const row of cl.rows) {
        if (row.id === ROW_NUM) {
          if (ly <= row.h && x > r.x + r.w * 0.5) return ROW_NUM;
          continue;
        }
        if (ly >= row.y && ly < row.y + row.h) return row.id;
      }
      return null;
    };

    const tapCard = (g: Lay, x: number, y: number) => {
      const row = rowAt(g, x, y);
      if (row === null) return;
      if (row === -2) {
        early = !early;
        host.fx.tick();
        return;
      }
      if (holdMode) {
        rowFlash = { row, t0: performance.now() };
        commit('hold', row);
        return;
      }
      flagRow = flagRow === row ? null : row;
      rowFlash = flagRow === null ? null : { row, t0: performance.now() };
      host.fx.pencil();
    };

    const offPtr = pointer(st.canvas, {
      down(pt) {
        if (finished || host.paused() || drag || idx >= n) return;
        const g = lay();
        if (inRect(g.pay, pt.x, pt.y, 4)) {
          press = 'pay';
          return;
        }
        if (inRect(g.hold, pt.x, pt.y, 4)) {
          press = 'hold';
          return;
        }
        drag = { pid: pt.id, sx: pt.x, sy: pt.y, x: pt.x, lastX: pt.x, lastT: performance.now(), vx: 0, moved: false, onCard: inRect(g.card, pt.x, pt.y) };
      },
      move(pt) {
        if (!drag || drag.pid !== pt.id) return;
        if (finished || host.paused()) {
          drag = null;
          dx = 0;
          return;
        }
        const now = performance.now();
        const dt = Math.max(1, now - drag.lastT);
        drag.vx = drag.vx * 0.6 + ((pt.x - drag.lastX) / dt) * 0.4;
        drag.lastX = pt.x;
        drag.lastT = now;
        drag.x = pt.x;
        if (!drag.moved && Math.abs(pt.x - drag.sx) > 10) drag.moved = true;
        if (drag.moved) dx = pt.x - drag.sx;
      },
      up(pt) {
        const g = lay();
        if (press) {
          const which = press;
          press = null;
          if (finished || host.paused() || idx >= n) return;
          if (which === 'pay' && inRect(g.pay, pt.x, pt.y, 10)) commit(early ? 'early' : 'pay');
          if (which === 'hold' && inRect(g.hold, pt.x, pt.y, 10)) tryHold();
          return;
        }
        if (!drag || drag.pid !== pt.id) return;
        const d = drag;
        drag = null;
        if (finished || host.paused() || idx >= n) {
          dx = 0;
          return;
        }
        if (!d.moved) {
          if (d.onCard) tapCard(g, pt.x, pt.y);
          return;
        }
        const thr = g.cw * 0.28;
        if (dx > thr || (dx > 40 && d.vx > 0.5)) commit(early ? 'early' : 'pay');
        else if (dx < -thr || (dx < -40 && d.vx < -0.5)) {
          if (flagRow !== null) commit('hold', flagRow);
          else {
            tryHold();
            if (still) dx = 0;
          }
        } else if (still) dx = 0;
      },
    });

    const stop = loop((_t, dt) => {
      if (!drag && dx !== 0) {
        dx *= Math.exp(-dt / 0.06);
        if (Math.abs(dx) < 0.5) dx = 0;
      }
      draw(lay(), performance.now());
    });

    function drawHeader(g: Lay) {
      const y = g.headY;
      const x = g.x0;
      const w = g.cw;
      text(ctx, 'Cash', x, y + 14, { size: 11, weight: 700, color: C.inkSoft });
      const low = cash < m.floor;
      const cw = tnum(ctx, money(cash), x + 34, y + 14, { size: 17, weight: 800, color: low ? C.rust : C.ink });
      text(ctx, `keep ≥ ${money(m.floor, { cents: false })}`, x + 42 + cw, y + 14.5, { size: 11, weight: 600, color: C.inkSoft });
      text(ctx, `Today ${m.today} ${m.month}`, x + w, y + 14, { size: 12, weight: 700, color: C.ink, align: 'right' });
      text(ctx, `Tolerance 2% or $10 · tax ${pct(m.taxRate)}`, x, y + 40, { size: 11, weight: 600, color: C.inkSoft });
      // progress dots
      const r = 5;
      const gap = 14;
      let dx0 = x + w - (n - 1) * gap - r;
      for (let i = 0; i < n; i++) {
        const v = verdicts[i];
        ctx.beginPath();
        ctx.arc(dx0, y + 40, r, 0, Math.PI * 2);
        if (v) {
          ctx.fillStyle = v.wrong ? C.rust : v.right ? C.palm : C.sandDeep;
          ctx.fill();
        } else {
          ctx.lineWidth = i === idx ? 2.5 : 1.5;
          ctx.strokeStyle = i === idx ? C.sea : shade(C.sand, -0.25);
          ctx.stroke();
        }
        dx0 += gap;
      }
    }

    function drawToast(g: Lay, now: number) {
      if (!toast) return;
      const age = (now - toast.t0) / 1000;
      if (!toast.hold && age > 2.6) {
        toast = null;
        return;
      }
      ctx.globalAlpha = toast.hold ? 1 : clamp((2.6 - age) / 0.4, 0, 1);
      ctx.font = `700 12.5px ${FONT}`;
      const tw = Math.min(g.cw, ctx.measureText(toast.str).width + 26);
      ctx.fillStyle = toast.color === C.rust ? shade(C.rust, 0.86) : toast.color === C.palmDark ? shade(C.palm, 0.8) : shade(C.fin, 0.7);
      roundRect(ctx, g.w / 2 - tw / 2, g.toastY - 14, tw, 28, 14);
      ctx.fill();
      text(ctx, toast.str, g.w / 2, g.toastY, { size: 12.5, weight: 700, color: toast.color, align: 'center', max: g.cw - 22 });
      ctx.globalAlpha = 1;
    }

    /** Draw one invoice card with its origin at the card's top-left. */
    function drawCard(c: InvCard, r: Rect, cl: CardLay, now: number, o: { live: boolean; flag: number | null; early: boolean; tilt: number }) {
      const W = r.w;
      ctx.save();
      ctx.shadowColor = 'rgba(31,42,48,0.2)';
      ctx.shadowBlur = o.live ? 18 : 8;
      ctx.shadowOffsetY = o.live ? 8 : 3;
      ctx.fillStyle = C.paper;
      roundRect(ctx, 0, 0, W, r.h, 16);
      ctx.fill();
      ctx.restore();
      ctx.save();
      roundRect(ctx, 0, 0, W, r.h, 16);
      ctx.clip();
      // letterhead band in the role tint
      ctx.fillStyle = shade(C.fin, 0.45);
      ctx.fillRect(0, 0, W, cl.headH);
      ctx.fillStyle = shade(C.sand, 0.2);
      ctx.fillRect(0, cl.histY, W, 26);
      ctx.restore();
      const ip = 14;
      text(ctx, c.vendor, ip, 18, { size: 15, weight: 800, max: W * 0.55 });
      text(ctx, `${c.po} · dated ${c.day} ${m.month} · ${c.discountTerms ? '2/10 net 30' : 'Net 30'}`, ip, 37, {
        size: 11,
        weight: 650,
        color: shade(C.ink, 0.25),
        max: W - ip * 2,
      });
      // invoice number pill (tap target for duplicates)
      ctx.font = `800 12.5px ${FONT}`;
      const numStr = `INV #${c.number}`;
      const pw = ctx.measureText(numStr).width + 18;
      const pr: Rect = { x: W - ip - pw, y: 6, w: pw, h: 22 };
      ctx.fillStyle = C.paper;
      roundRect(ctx, pr.x, pr.y, pr.w, pr.h, 11);
      ctx.fill();
      tnum(ctx, numStr, pr.x + pr.w / 2, pr.y + 11.5, { size: 12.5, weight: 800, align: 'center' });
      // vendor history
      text(ctx, 'Last paid', ip, cl.histY + 13, { size: 10.5, weight: 800, color: C.inkSoft });
      tnum(ctx, `#${c.last.number} · ${money(c.last.amount)} · ${c.last.po} · ${c.last.day} ${m.month}`, ip + 58, cl.histY + 13, {
        size: 10.5,
        weight: 650,
        color: C.inkSoft,
      });
      // column heads
      const xPO = W * 0.44;
      const xRc = W * 0.595;
      const xInv = W - ip;
      const hy = cl.colY + 10;
      text(ctx, 'ITEM', ip, hy, { size: 9.5, weight: 800, color: C.inkSoft });
      text(ctx, 'PO', xPO, hy, { size: 9.5, weight: 800, color: C.inkSoft, align: 'center' });
      text(ctx, 'RCVD', xRc, hy, { size: 9.5, weight: 800, color: C.inkSoft, align: 'center' });
      text(ctx, 'INVOICE', xInv, hy, { size: 9.5, weight: 800, color: C.inkSoft, align: 'right' });
      const rule = (y: number) => {
        ctx.strokeStyle = shade(C.fin, 0.55);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(ip, y);
        ctx.lineTo(W - ip, y);
        ctx.stroke();
      };
      for (const row of cl.rows) {
        if (row.id === ROW_NUM) continue;
        const y = row.y;
        const mid = y + row.h / 2;
        rule(y);
        if (row.id >= 0 && row.id < c.lines.length) {
          const l = c.lines[row.id];
          text(ctx, l.item, ip, mid, { size: 13, weight: 750, max: xPO - 40 - ip });
          if (m.band) {
            tnum(ctx, `${l.poQty} × ${money(l.poPrice, { dollar: false })}`, xPO, mid - 8, { size: 12, weight: 750, align: 'center' });
            tnum(ctx, `≤ ${money(bandMax(m, l), { dollar: false })}`, xPO, mid + 9, { size: 10.5, weight: 750, color: C.sea, align: 'center' });
          } else {
            tnum(ctx, String(l.poQty), xPO, mid - 8, { size: 14, weight: 800, align: 'center' });
            tnum(ctx, money(l.poQty * l.poPrice), xPO, mid + 9, { size: 10.5, weight: 650, color: C.inkSoft, align: 'center' });
          }
          tnum(ctx, String(l.rcvd), xRc, mid, { size: 16, weight: 800, align: 'center' });
          tnum(ctx, `${l.qty} × ${money(l.price, { dollar: false })}`, xInv, mid - 8, { size: 12, weight: 700, color: shade(C.ink, 0.15), align: 'right' });
          tnum(ctx, money(r2(l.qty * l.price)), xInv, mid + 9, { size: 13, weight: 800, align: 'right' });
        } else if (row.id === ROW_FREIGHT) {
          text(ctx, 'Freight', ip, mid, { size: 13, weight: 700 });
          tnum(ctx, c.freightPo ? money(c.freightPo) : '—', xPO, mid, { size: 12, weight: 700, color: c.freightPo ? C.ink : C.inkSoft, align: 'center' });
          tnum(ctx, money(c.freight), xInv, mid, { size: 13, weight: 800, align: 'right' });
        } else if (row.id === ROW_TAX) {
          text(ctx, `Tax ${pct(c.taxRate)}`, ip, mid, { size: 13, weight: 700 });
          if (m.teach) text(ctx, pct(m.taxRate), xPO, mid, { size: 12, weight: 700, color: C.inkSoft, align: 'center' });
          tnum(ctx, money(c.tax), xInv, mid, { size: 13, weight: 800, align: 'right' });
        }
      }
      // total
      rule(cl.totalY);
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(xInv - 90, cl.totalY + 3);
      ctx.lineTo(xInv, cl.totalY + 3);
      ctx.stroke();
      const ty = cl.totalY + 22;
      text(ctx, 'Total due', ip, ty, { size: 13.5, weight: 800 });
      tnum(ctx, money(c.total), xInv, ty, { size: 16, weight: 800, align: 'right' });
      // early-payment toggle
      if (cl.toggle) {
        const t = cl.toggle;
        const on = o.early;
        ctx.fillStyle = on ? shade(C.palm, 0.78) : shade(C.sand, 0.3);
        roundRect(ctx, 8, t.y + 4, W - 16, t.h - 8, 12);
        ctx.fill();
        text(ctx, 'Pay early −2%', ip + 4, t.y + 20, { size: 13, weight: 800, color: on ? C.palmDark : C.ink });
        const days = c.day + 10 - m.today;
        const win = m.showWindow ? (days >= 0 ? ` · ${days === 0 ? 'last day' : `${days} day${days > 1 ? 's' : ''} left`}` : ' · window closed') : '';
        tnum(ctx, `save ${money(c.discount)} · pay ${money(payNow(c))} now${win}`, ip + 4, t.y + 38, {
          size: 10.5,
          weight: 650,
          color: C.inkSoft,
        });
        // switch
        const sw = { x: W - ip - 46, y: t.y + t.h / 2 - 13, w: 46, h: 26 };
        ctx.fillStyle = on ? C.palm : shade(C.sand, -0.2);
        roundRect(ctx, sw.x, sw.y, sw.w, sw.h, 13);
        ctx.fill();
        ctx.fillStyle = C.white;
        ctx.beginPath();
        ctx.arc(on ? sw.x + sw.w - 13 : sw.x + 13, sw.y + 13, 10, 0, Math.PI * 2);
        ctx.fill();
      }
      // flagged row / hold mode affordances
      const ringRow = (id: number, color: string, lw: number, dash: number[] = []) => {
        let rr: Rect | null = null;
        if (id === ROW_NUM) rr = { x: pr.x - 4, y: pr.y - 3, w: pr.w + 8, h: pr.h + 6 };
        else {
          const row = cl.rows.find((q) => q.id === id);
          if (row) rr = { x: 6, y: row.y + 2, w: W - 12, h: row.h - 4 };
        }
        if (!rr) return;
        ctx.save();
        ctx.setLineDash(dash);
        ctx.strokeStyle = color;
        ctx.lineWidth = lw;
        roundRect(ctx, rr.x, rr.y, rr.w, rr.h, 10);
        ctx.stroke();
        ctx.restore();
      };
      if (o.live && holdMode) {
        const pulse = still ? 0.8 : 0.55 + 0.35 * Math.sin(now / 160);
        ctx.globalAlpha = pulse;
        for (const row of cl.rows) ringRow(row.id, C.sea, 1.5, [5, 4]);
        ctx.globalAlpha = 1;
      }
      if (o.flag !== null) {
        ringRow(o.flag, C.rust, 2.5);
        const row = cl.rows.find((q) => q.id === o.flag);
        if (row && o.flag !== ROW_NUM) {
          ctx.fillStyle = C.rust;
          ctx.beginPath();
          ctx.arc(4, row.y + row.h / 2, 9, 0, Math.PI * 2);
          ctx.fill();
          text(ctx, '?', 4, row.y + row.h / 2 + 0.5, { size: 12, weight: 900, color: C.white, align: 'center' });
        }
      }
      if (o.live && rowFlash && now - rowFlash.t0 < 300 && !still) {
        ctx.globalAlpha = 1 - (now - rowFlash.t0) / 300;
        ringRow(rowFlash.row, C.rust, 5);
        ctx.globalAlpha = 1;
      }
      // swipe intent stamps
      if (o.tilt !== 0) {
        const a = clamp(Math.abs(o.tilt) / (W * 0.28), 0, 1);
        ctx.globalAlpha = a;
        if (o.tilt > 0) stampMark(ctx, o.early ? 'PAY −2%' : 'PAY', W * 0.3, cl.colY + 40, C.palmDark, 1, 24, true, -0.2);
        else stampMark(ctx, 'HOLD', W * 0.7, cl.colY + 40, C.rust, 1, 24, true, 0.2);
        ctx.globalAlpha = 1;
      }
    }

    /** The payment run building up: the batch list AP sends to the bank. Newest nearest the card. */
    function drawRun(g: Lay) {
      const bottom = g.card.y - 14;
      const top = g.top + 4;
      const rowH = 30;
      const titleH = 26;
      const fit = Math.floor((bottom - top - titleH - 10) / rowH);
      if (fit < 1) return;
      const shown = Math.min(fit, Math.max(1, idx), 6);
      const ph = titleH + shown * rowH + 8;
      const y0 = bottom - ph;
      const x = g.x0;
      const w = g.cw;
      ctx.fillStyle = shade(C.paper, 0.2);
      ctx.globalAlpha = 0.85;
      roundRect(ctx, x, y0, w, ph, 14);
      ctx.fill();
      ctx.globalAlpha = 1;
      const pl = playInvoice(m, decisions);
      text(ctx, 'PAYMENT RUN', x + 14, y0 + 15, { size: 10.5, weight: 800, color: shade(C.fin, -0.45) });
      tnum(ctx, `${idx} of ${n} · ${money(pl.saved)} protected`, x + w - 14, y0 + 15, { size: 10.5, weight: 700, color: C.inkSoft, align: 'right' });
      if (!idx) {
        text(ctx, 'Swipe right to pay · left to hold', x + w / 2, y0 + titleH + rowH / 2, { size: 12, weight: 650, color: C.inkSoft, align: 'center' });
        return;
      }
      const from = Math.max(0, idx - shown);
      for (let i = from; i < idx; i++) {
        const c = m.cards[i];
        const d = decisions[i]!;
        const v = verdicts[i]!;
        const ry = y0 + titleH + (i - from) * rowH + rowH / 2;
        ctx.strokeStyle = shade(C.fin, 0.6);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 12, ry - rowH / 2);
        ctx.lineTo(x + w - 12, ry - rowH / 2);
        ctx.stroke();
        ctx.fillStyle = v.wrong ? C.rust : v.right ? C.palm : C.sandDeep;
        ctx.beginPath();
        ctx.arc(x + 22, ry, 8, 0, Math.PI * 2);
        ctx.fill();
        text(ctx, v.wrong ? '✕' : v.right ? '✓' : '·', x + 22, ry + 0.5, { size: 10, weight: 900, color: C.white, align: 'center' });
        text(ctx, c.vendor, x + 38, ry, { size: 12, weight: 700, max: w * 0.36 });
        const what =
          d.action === 'hold' ? 'held' : d.action === 'early' && c.discount > 0 ? 'paid −2%' : 'paid';
        const amt = d.action === 'hold' ? money(c.total) : d.action === 'early' && c.discount > 0 ? money(payNow(c)) : money(c.total);
        text(ctx, what, x + w * 0.62, ry, { size: 11.5, weight: 700, color: d.action === 'hold' ? C.rust : C.palmDark, align: 'right' });
        tnum(ctx, amt, x + w - 14, ry, { size: 12, weight: 800, color: d.action === 'hold' ? C.inkSoft : C.ink, align: 'right' });
      }
    }

    function drawButtons(g: Lay) {
      const c = idx < n ? card() : null;
      const hr = g.hold;
      const pr = g.pay;
      const sq = (r: Rect, down: boolean) => (down ? { x: r.x + 2, y: r.y + 2, w: r.w - 4, h: r.h - 4 } : r);
      ctx.globalAlpha = idx < n && !finished ? 1 : 0.35;
      const h1 = sq(hr, press === 'hold');
      ctx.fillStyle = C.paper;
      roundRect(ctx, h1.x, h1.y, h1.w, h1.h, 16);
      ctx.fill();
      ctx.strokeStyle = C.rust;
      ctx.lineWidth = 2;
      roundRect(ctx, h1.x + 1, h1.y + 1, h1.w - 2, h1.h - 2, 15);
      ctx.stroke();
      text(ctx, '← Hold', h1.x + h1.w / 2, h1.y + h1.h / 2 - (flagRow !== null ? 7 : 0), { size: 16, weight: 800, color: C.rust, align: 'center' });
      if (flagRow !== null) text(ctx, 'flagged line', h1.x + h1.w / 2, h1.y + h1.h / 2 + 12, { size: 10.5, weight: 700, color: C.rust, align: 'center' });
      const p1 = sq(pr, press === 'pay');
      ctx.fillStyle = C.palm;
      roundRect(ctx, p1.x, p1.y, p1.w, p1.h, 16);
      ctx.fill();
      const payLabel = c && early ? 'Pay now −2% →' : 'Pay →';
      text(ctx, payLabel, p1.x + p1.w / 2, p1.y + p1.h / 2, { size: 16, weight: 800, color: C.white, align: 'center' });
      ctx.globalAlpha = 1;
    }

    function draw(g: Lay, now: number) {
      backdrop(ctx, g.w, g.h);
      drawHeader(g);
      drawToast(g, now);
      if (flourishT < 0) drawRun(g);
      const r = g.card;
      // the stack still to come
      const left = n - idx - 1;
      for (let k = Math.min(2, left); k >= 1; k--) {
        ctx.fillStyle = shade(C.paper, -0.03 * k);
        ctx.globalAlpha = 0.9;
        roundRect(ctx, r.x + 10 * k, r.y + 7 * k, r.w - 20 * k, r.h, 16);
        ctx.fill();
        ctx.strokeStyle = shade(C.sand, -0.12);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (idx < n) {
        const c = card();
        const enter = still ? 1 : ease.outCubic(clamp((now - enterT) / 180, 0, 1));
        const tilt = still ? 0 : dx / (g.cw * 4);
        ctx.save();
        ctx.translate(r.x + r.w / 2 + dx, r.y + r.h / 2 + (1 - enter) * 10);
        ctx.rotate(tilt);
        const sc = 0.96 + 0.04 * enter;
        ctx.scale(sc, sc);
        ctx.translate(-r.w / 2, -r.h / 2);
        drawCard(c, r, g.cl, now, { live: true, flag: flagRow, early, tilt: dx });
        ctx.restore();
      }
      // cards on their way out
      for (let i = flying.length - 1; i >= 0; i--) {
        const f = flying[i];
        const u = (now - f.t0) / 260;
        if (u >= 1) {
          flying.splice(i, 1);
          continue;
        }
        const c = m.cards[f.card];
        const cl = cardLay(c, g.bottom - g.top);
        const x = f.fromX + (g.w + 40) * f.dir * ease.outCubic(u);
        ctx.save();
        ctx.translate(r.x + r.w / 2 + x, r.y + cl.h / 2 - 10 * u);
        ctx.rotate(f.dir * (0.08 + 0.25 * u));
        ctx.translate(-r.w / 2, -cl.h / 2);
        drawCard(c, { ...r, h: cl.h }, cl, now, { live: false, flag: f.flag, early: f.early, tilt: 0 });
        stampMark(ctx, f.word, r.w / 2, cl.colY + 60, f.color, clamp(u * 3, 0, 1), 30, false, f.dir > 0 ? -0.2 : 0.2);
        ctx.restore();
      }
      drawButtons(g);
      if (idx >= n && flourishT < 0 && !flying.length) {
        text(ctx, 'Batch done', g.w / 2, (g.top + g.bottom) / 2, { size: 16, weight: 800, color: C.inkSoft, align: 'center' });
      }
      if (flourishT > 0) {
        const u = (now - flourishT) / 280;
        stampMark(ctx, 'PAID', g.w / 2, (g.top + g.bottom) / 2, C.palmDark, u, clamp(g.w / 7, 40, 64), still);
        text(ctx, `${money(playInvoice(m, decisions).saved)} protected`, g.w / 2, (g.top + g.bottom) / 2 + 70, {
          size: 14,
          weight: 800,
          color: C.palmDark,
          align: 'center',
        });
        if (!still && u < 3) {
          ctx.globalAlpha = 0.3 * (1 - clamp(u / 3, 0, 1));
          ctx.fillStyle = C.white;
          ctx.fillRect(0, 0, g.w, g.h);
          ctx.globalAlpha = 1;
        }
      }
    }

    return {
      timeUp(): PuzzleResult {
        if (doneTimer) clearTimeout(doneTimer);
        if (finishTimer) clearTimeout(finishTimer);
        doneTimer = finishTimer = null;
        finished = true;
        drag = null;
        press = null;
        if (!final) final = invResult(m, decisions);
        return final;
      },
      destroy() {
        if (doneTimer) clearTimeout(doneTimer);
        if (finishTimer) clearTimeout(finishTimer);
        soundTimers.forEach((id) => clearTimeout(id));
        doneTimer = finishTimer = null;
        finished = true;
        stop();
        offPtr();
        st.destroy();
      },
    };
  },
};
