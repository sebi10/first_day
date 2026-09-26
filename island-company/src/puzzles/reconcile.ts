// Finance · Bank reconciliation. The month-end close: tick every bank statement
// line against the island's cash book. What is left over is either a timing
// difference (deposit in transit, cheque not yet cashed → adjusts the bank side)
// or something the books never saw (fees, interest, a direct debit, a vendor
// paid twice → an adjusting entry in the books). Errors hide in pairs that
// almost match: swapped digits leave a difference that divides by 9, a Stripe
// payout lands net of card fees, a euro booking converts at the bank's rate.
// Done when adjusted bank == adjusted books.
import { rng, type Rng } from '../sim/rng';
import { C, FONT, backdrop, clamp, ease, loop, pointer, roundRect, shade, stage } from './kit';
import { result, type PuzzleContext, type PuzzleDef, type PuzzleResult } from './types';

export type RecKind =
  | 'pair' // same transaction on both sides, same amount
  | 'transpose' // same transaction, two digits swapped when it was keyed into the books (tier 2+)
  | 'split' // one Stripe payout = several cottage bookings (tier 3+)
  | 'net' // a split payout that lands net of card fees (tier 5)
  | 'fx' // euro booking; the bank converted at its own rate (tier 5)
  | 'dupe' // vendor paid twice: two bank debits, one book entry (tier 4+)
  | 'fee'
  | 'interest'
  | 'debit' // bank only → adjusting entry in the books
  | 'transit'
  | 'outstanding'; // books only → timing, clears next month

export type RecSide = 'bank' | 'book';
export type RecBin = 'timing' | 'adjust';

export type RecLine = {
  id: number;
  side: RecSide;
  text: string;
  /** day of the month */
  day: number;
  /** signed dollars: + money in, − money out */
  amount: number;
  item: number;
};

export type RecItem = { kind: RecKind; bank: number[]; book: number[] };

export type RecModel = {
  tier: number;
  month: string;
  cutoff: number;
  opening: number;
  /** closing balance per bank statement */
  bankEnd: number;
  /** closing balance per cash book */
  bookEnd: number;
  lines: RecLine[];
  items: RecItem[];
  /** display order (statement order: by date) */
  bankOrder: number[];
  bookOrder: number[];
  /** Σ |adjustments to the books| — the money the rec explains, ≈ context.leak */
  money: number;
  /** show the "÷ 9" transposition hint next to the difference */
  nineHint: boolean;
  /** exact-amount 1:1 matches pre-highlighted (autoMatch tool, tutorial) — [bank, book] */
  suggest: [number, number][];
  /** score lost per wrong pairing */
  penalty: number;
};

export type RecState = {
  cleared: boolean[];
  how: (RecBin | 'pair' | null)[];
  itemDone: boolean[];
  /** Σ timing items posted against the bank balance */
  bankAdj: number;
  /** Σ adjusting entries posted to the books */
  bookAdj: number;
  wrong: number;
};

export type RecAction = { t: 'pair'; a: number; b: number } | { t: 'bin'; line: number; bin: RecBin };

export type RecOutcome = {
  result: 'ok' | 'wrong' | 'ignored';
  cleared: number[];
  item: number;
  /** the whole item is resolved by this move */
  done: boolean;
  bankAdj: number;
  bookAdj: number;
  /** what the analyst would write next to it */
  note: string;
  /** after a wrong move: where the dragged line should have gone */
  hint?: { line?: number; bin?: RecBin };
};

const MONTH = 'Sep';
const CUTOFF = 30;
const MINUS = '−';

// 0 = tutorial. Line counts: 4, 6, 8, 11, 12, 14.
const PLAN: RecKind[][] = [
  ['pair', 'debit', 'transit'],
  ['pair', 'pair', 'debit', 'outstanding'],
  ['pair', 'pair', 'transpose', 'fee', 'transit'],
  ['pair', 'split', 'transpose', 'fee', 'debit', 'outstanding'],
  ['split', 'transpose', 'dupe', 'fee', 'outstanding', 'transit'],
  ['net', 'fx', 'transpose', 'dupe', 'interest', 'outstanding', 'transit'],
];

type Flavour = { bank: string; book: string; lo: number; hi: number; sign: 1 | -1; round?: boolean };

// Bank descriptors are terse; the books say what it was for. Matching them is the job.
const PAIRS: Flavour[] = [
  { bank: 'Fuel dock', book: 'Avgas — fuel dock', lo: 160, hi: 620, sign: -1 },
  { bank: 'Guest deposit', book: 'Deposit — Cottage {c}', lo: 150, hi: 600, sign: 1, round: true },
  { bank: 'Stripe — Cottage {c}', book: 'Cottage {c} booking', lo: 220, hi: 980, sign: 1, round: true },
  { bank: 'Palm Air cargo', book: 'Cargo flight — parts', lo: 90, hi: 420, sign: -1 },
  { bank: 'Reef Laundry', book: 'Linen service', lo: 60, hi: 260, sign: -1 },
  { bank: 'Cheque {q}', book: 'Chq {q} — Glass Co', lo: 90, hi: 540, sign: -1 },
  { bank: 'Charter — N-12', book: 'Charter income N-12', lo: 420, hi: 1500, sign: 1, round: true },
];
const TRANSPOSE: { bank: string; book: string; sign: 1 | -1 }[] = [
  { bank: 'Harbor Supply', book: 'Harbor Supply parts', sign: -1 },
  { bank: 'Hangar rent', book: 'Hangar rent — Sep', sign: -1 },
  { bank: 'Charter — N-7', book: 'Charter income N-7', sign: 1 },
  { bank: 'Aero Parts Co', book: 'Parts — Aero Parts', sign: -1 },
];
const DUPES = [
  { bank: 'Coral Electric', book: 'Coral Elec. — wiring' },
  { bank: 'Island Hardware', book: 'Paint — Island Hdw' },
  { bank: 'Sun Propane', book: 'Sun Propane refill' },
];
const FEES = ['Account fee', 'Wire fee', 'Card terminal fee'];
const DEBITS = ['Island Power autopay', 'Insurance autopay', 'Bounced guest cheque'];
const PAYEES = ['Plumber', 'Pool co.', 'Carpenter'];

export const r2 = (v: number) => Math.round(v * 100) / 100;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** $1,280.00 · −$37.40 · +540.00 */
export function money(v: number, o: { sign?: boolean; dollar?: boolean; cents?: boolean } = {}): string {
  const a = Math.abs(v);
  const fixed = o.cents === false ? String(Math.round(a)) : a.toFixed(2);
  const [int, dec] = fixed.split('.');
  const body = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (dec ? '.' + dec : '');
  const sign = v <= -0.005 ? MINUS : o.sign && v >= 0.005 ? '+' : '';
  return `${sign}${o.dollar === false ? '' : '$'}${body}`;
}

/** Choose which digits get swapped so the transposition difference (9 · place · k) ≈ share. */
function pickSwap(share: number): { p: number; k: number } {
  let best = { p: 10, k: 1 };
  let err = Infinity;
  for (const p of [10, 1, 100]) {
    for (let k = 1; k <= 8; k++) {
      const e = Math.abs(9 * p * k - share);
      if (e < err - 1e-9) {
        err = e;
        best = { p, k };
      }
    }
  }
  return best;
}

/** [true amount, amount with two adjacent digits swapped]; they differ by exactly 9·p·k. */
export function swapAmount(r: Rng, p: number, k: number): [number, number] {
  const i = p === 1 ? 0 : p === 10 ? 1 : 2; // lower digit of the swapped pair
  const d = [r.int(0, 9), r.int(0, 9), r.int(0, 9), r.int(1, 2)]; // units, tens, hundreds, thousands
  let len = 4;
  if (i === 0) {
    len = 3;
    d[3] = 0;
    d[2] = r.int(1, 9);
  }
  const lead = i + 1 === len - 1; // swapping into the leading digit: neither may be 0
  const lo = r.int(lead ? 1 : 0, 9 - k);
  const [hi, low] = r.chance(0.5) ? [lo, lo + k] : [lo + k, lo];
  d[i + 1] = hi;
  d[i] = low;
  const val = (ds: number[]) => ds.reduce((s, v, j) => s + v * 10 ** j, 0);
  const cents = r.int(0, 99) / 100;
  const sw = [...d];
  [sw[i], sw[i + 1]] = [sw[i + 1], sw[i]];
  return [r2(val(d) + cents), r2(val(sw) + cents)];
}

export function generateReconcile(seed: number, tier: number, tools: string[] = [], context?: PuzzleContext): RecModel {
  const t = clamp(Math.round(tier), 0, 5);
  const r = rng(seed);
  const plan = PLAN[t];
  const has = (k: RecKind) => plan.includes(k);
  const leak = clamp(Math.round(context?.leak ?? 500), 60, 100000);

  const lines: RecLine[] = [];
  const items: RecItem[] = [];
  const used = new Set<number>();
  const key = (v: number) => Math.round(Math.abs(v) * 100);
  const free = (v: number) => !used.has(key(v));
  const take = (v: number) => {
    used.add(key(v));
    return v;
  };
  const roll = (lo: number, hi: number, round = false): number => {
    for (let k = 0; k < 80; k++) {
      const v = round ? r.int(Math.ceil(lo / 5), Math.floor(hi / 5)) * 5 : r2(r.range(lo, hi));
      if (free(v)) return take(v);
    }
    let v = r2(r.range(lo, hi));
    while (!free(v)) v = r2(v + 0.07);
    return take(v);
  };
  const unique = (v: number) => {
    let x = r2(v);
    while (!free(x)) x = r2(x + 0.07);
    return take(x);
  };
  const cottages = r.shuffle([1, 2, 3, 4, 5, 6]);
  let ci = 0;
  const cottage = () => cottages[ci++ % cottages.length];
  let chq = r.int(1031, 1068);
  const fill = (s: string, c: number, q: number) => s.replace('{c}', String(c)).replace('{q}', String(q));

  // Fixed-size items first, so the flexible ones can make the money add up to the leak.
  const feeAmt = r2(r.range(8, 32));
  const intAmt = r2(r.range(2.5, 16));
  const netG = has('net') ? [0, 1, 2].map(() => roll(180, 520, true)) : [];
  const netFees = netG.map((g) => r2(g * 0.029 + 0.3)); // card processor: 2.9% + 30¢ a charge
  const eur = r.int(6, 14) * 100;
  const bookRate = r.pick([1.08, 1.09, 1.1, 1.11, 1.12]);
  const fxBook = r2(eur * bookRate);
  const fxBank = r2(eur * (bookRate - r.range(0.006, 0.02)));
  let small = 0;
  if (has('fee')) small += feeAmt;
  if (has('interest')) small += intAmt;
  if (has('net')) small += sum(netFees);
  if (has('fx')) small += Math.abs(fxBank - fxBook);
  let rest = Math.max(leak * 0.3, leak - small);
  const flexOthers = (has('debit') ? 1 : 0) + (has('dupe') ? 1 : 0);
  let swap = { p: 10, k: 1 };
  if (has('transpose')) {
    swap = pickSwap(flexOthers ? rest * r.range(0.4, 0.6) : rest);
    rest = Math.max(flexOthers ? leak * 0.12 : 0, rest - 9 * swap.p * swap.k);
  }
  const flexEach = flexOthers ? Math.max(24, rest / flexOthers) : 0;

  const pairPool = r.shuffle([...PAIRS]);
  const trPool = r.shuffle([...TRANSPOSE]);
  const addItem = (kind: RecKind) => {
    items.push({ kind, bank: [], book: [] });
    return items.length - 1;
  };
  const addLine = (item: number, side: RecSide, text: string, day: number, amount: number) => {
    const id = lines.length;
    lines.push({ id, side, text, day: clamp(day, 1, CUTOFF), amount: r2(amount), item });
    items[item][side].push(id);
    return id;
  };
  let bookings: number[] = [];

  for (const kind of plan) {
    const it = addItem(kind);
    switch (kind) {
      case 'pair': {
        const f = pairPool.pop()!;
        const c = cottage();
        const q = chq++;
        const v = roll(f.lo, f.hi, f.round) * f.sign;
        const d = r.int(3, 27);
        addLine(it, 'bank', fill(f.bank, c, q), d, v);
        addLine(it, 'book', fill(f.book, c, q), d - r.int(0, 2), v);
        break;
      }
      case 'transpose': {
        const f = trPool.pop()!;
        let truth = 0;
        let typo = 0;
        for (let k = 0; k < 40; k++) {
          [truth, typo] = swapAmount(r, swap.p, swap.k);
          if (free(truth) && free(typo)) break;
        }
        take(truth);
        take(typo);
        const d = r.int(3, 27);
        addLine(it, 'bank', f.bank, d, truth * f.sign);
        addLine(it, 'book', f.book, d - r.int(0, 2), typo * f.sign);
        break;
      }
      case 'split':
      case 'net': {
        const gross = kind === 'net' ? netG : [0, 1, 2].map(() => roll(180, 520, true));
        bookings = gross;
        const fees = kind === 'net' ? netFees : [0, 0, 0];
        const payout = unique(sum(gross) - sum(fees));
        const d = r.int(8, 24);
        addLine(it, 'bank', 'Stripe payout (3)', d, payout);
        gross.forEach((g, i) => addLine(it, 'book', `Cottage ${cottage()} booking`, d - 3 + i, g));
        break;
      }
      case 'fx': {
        const d = r.int(6, 26);
        addLine(it, 'bank', 'Wire in — EUR guest', d, unique(fxBank));
        addLine(it, 'book', `Cottage ${cottage()} — €${money(eur, { dollar: false, cents: false })}`, d - 2, unique(fxBook));
        break;
      }
      case 'dupe': {
        const f = r.pick(DUPES);
        const v = -unique(flexEach);
        const d = r.int(4, 22);
        addLine(it, 'bank', f.bank, d, v);
        addLine(it, 'bank', f.bank, d + r.int(1, 3), v);
        addLine(it, 'book', f.book, d, v);
        break;
      }
      case 'fee':
        addLine(it, 'bank', r.pick(FEES), CUTOFF, -unique(feeAmt));
        break;
      case 'interest':
        addLine(it, 'bank', 'Interest', CUTOFF, unique(intAmt));
        break;
      case 'debit':
        addLine(it, 'bank', r.pick(DEBITS), r.int(2, 28), -unique(flexEach));
        break;
      case 'transit': {
        // tier 4+: same amount as one of the payout's bookings — only the date gives it away
        if (bookings.length) addLine(it, 'book', `Cottage ${cottage()} booking`, CUTOFF, r.pick(bookings));
        else addLine(it, 'book', `Deposit — Cottage ${cottage()}`, CUTOFF, roll(150, 650, true));
        break;
      }
      case 'outstanding':
        addLine(it, 'book', `Chq ${chq++} — ${r.pick(PAYEES)}`, r.int(25, 29), -roll(80, 640));
        break;
    }
  }

  const opening = r2(r.int(60, 140) * 100 + r.int(0, 99) / 100);
  const total = (side: RecSide) => sum(lines.filter((l) => l.side === side).map((l) => l.amount));
  const order = (side: RecSide) =>
    r.shuffle(lines.filter((l) => l.side === side).map((l) => l.id)).sort((a, b) => lines[a].day - lines[b].day);

  const m: RecModel = {
    tier: t,
    month: MONTH,
    cutoff: CUTOFF,
    opening,
    bankEnd: r2(opening + total('bank')),
    bookEnd: r2(opening + total('book')),
    lines,
    items,
    bankOrder: order('bank'),
    bookOrder: order('book'),
    money: 0,
    nineHint: t === 2 || t === 3,
    suggest: [],
    penalty: t === 0 ? 0.03 : 0.06,
  };
  m.money = r2(sum(items.map((it) => Math.abs(bookEffect(m, it)))));
  if (t === 0 || tools.includes('autoMatch')) m.suggest = exactMatches(m);
  return m;
}

/** What resolving the item posts to the books (0 for clean pairs and timing items). */
function bookEffect(m: RecModel, it: RecItem): number {
  const amt = (ids: number[]) => sum(ids.map((id) => m.lines[id].amount));
  switch (it.kind) {
    case 'fee':
    case 'interest':
    case 'debit':
      return amt(it.bank);
    case 'dupe':
      return m.lines[it.bank[1]].amount;
    case 'transpose':
    case 'fx':
    case 'split':
    case 'net':
      return r2(amt(it.bank) - amt(it.book));
    default:
      return 0;
  }
}

/** Unique exact-amount 1:1 matches — what bank-feed auto-match would tick. */
export function exactMatches(m: RecModel): [number, number][] {
  const out: [number, number][] = [];
  const bank = m.lines.filter((l) => l.side === 'bank');
  const book = m.lines.filter((l) => l.side === 'book');
  for (const b of bank) {
    const same = (l: RecLine) => Math.abs(l.amount - b.amount) < 0.005;
    const k = book.filter(same);
    if (k.length === 1 && bank.filter(same).length === 1) out.push([b.id, k[0].id]);
  }
  return out;
}

export function newRecState(m: RecModel): RecState {
  return {
    cleared: m.lines.map(() => false),
    how: m.lines.map(() => null),
    itemDone: m.items.map(() => false),
    bankAdj: 0,
    bookAdj: 0,
    wrong: 0,
  };
}

/** The bin a line belongs in right now, or null when it must be paired. */
export function binFor(m: RecModel, s: RecState, id: number): RecBin | null {
  const L = m.lines[id];
  const it = m.items[L.item];
  switch (it.kind) {
    case 'fee':
    case 'interest':
    case 'debit':
      return 'adjust';
    case 'transit':
    case 'outstanding':
      return 'timing';
    case 'dupe':
      // one of the two identical debits is the real payment, the other is the refund claim
      return L.side === 'bank' && !it.bank.some((b) => s.how[b] === 'adjust') ? 'adjust' : null;
    default:
      return null;
  }
}

function targetFor(m: RecModel, s: RecState, id: number): { line?: number; bin?: RecBin } {
  const L = m.lines[id];
  const it = m.items[L.item];
  const other = (L.side === 'bank' ? it.book : it.bank).find((o) => !s.cleared[o]);
  if (other !== undefined && it.kind !== 'dupe') return { line: other };
  const bin = binFor(m, s, id);
  if (bin) return { bin };
  return other !== undefined ? { line: other } : {};
}

function noteFor(m: RecModel, kind: RecKind, adj: number, text: string): string {
  const e = money(adj, { sign: true });
  switch (kind) {
    case 'transpose':
      return `Swapped digits → correct books ${e}`;
    case 'fx':
      return `FX difference → adjust books ${e}`;
    case 'net':
      return `Card fees netted → adjust books ${e}`;
    case 'split':
      return 'Payout ticked to 3 bookings';
    case 'dupe':
      return `Paid twice → refund claim ${money(-adj)}`;
    case 'fee':
      return `Bank fee → book it ${e}`;
    case 'interest':
      return `Interest earned → book it ${e}`;
    case 'debit':
      return `${text.startsWith('Bounced') ? 'Bounced cheque' : 'Autopay'} → book it ${e}`;
    case 'transit':
      return `Deposit in transit → adds to bank ${e}`;
    case 'outstanding':
      return `Uncleared cheque → comes off bank ${e}`;
    default:
      return m.tier === 0 ? 'Ticked — same on both sides' : '';
  }
}

export function applyRec(m: RecModel, s: RecState, act: RecAction): RecOutcome {
  const none = (res: 'wrong' | 'ignored', hint?: RecOutcome['hint']): RecOutcome => ({
    result: res,
    cleared: [],
    item: -1,
    done: false,
    bankAdj: 0,
    bookAdj: 0,
    note: '',
    hint,
  });
  if (act.t === 'bin') {
    const L = m.lines[act.line];
    if (!L || s.cleared[L.id]) return none('ignored');
    if (binFor(m, s, L.id) !== act.bin) {
      s.wrong++;
      return none('wrong', targetFor(m, s, L.id));
    }
    s.cleared[L.id] = true;
    s.how[L.id] = act.bin;
    const it = m.items[L.item];
    const bankAdj = act.bin === 'timing' ? L.amount : 0;
    const bookAdj = act.bin === 'adjust' ? L.amount : 0;
    s.bankAdj = r2(s.bankAdj + bankAdj);
    s.bookAdj = r2(s.bookAdj + bookAdj);
    const done = [...it.bank, ...it.book].every((id) => s.cleared[id]);
    if (done) s.itemDone[L.item] = true;
    return {
      result: 'ok',
      cleared: [L.id],
      item: L.item,
      done,
      bankAdj,
      bookAdj,
      note: noteFor(m, it.kind, act.bin === 'timing' ? bankAdj : bookAdj, L.text),
    };
  }
  let a = m.lines[act.a];
  let b = m.lines[act.b];
  if (!a || !b || a.side === b.side) return none('ignored');
  if (a.side === 'book') [a, b] = [b, a];
  if (s.cleared[a.id] || s.cleared[b.id]) return none('ignored');
  const it = m.items[a.item];
  const pairable = ['pair', 'transpose', 'fx', 'split', 'net', 'dupe'].includes(it.kind);
  if (a.item !== b.item || !pairable) {
    s.wrong++;
    return none('wrong', targetFor(m, s, act.a));
  }
  const cleared: number[] = [];
  const tick = (id: number) => {
    s.cleared[id] = true;
    s.how[id] = 'pair';
    cleared.push(id);
  };
  let bookAdj = 0;
  let done = false;
  if (it.kind === 'split' || it.kind === 'net') {
    tick(b.id);
    if (it.book.every((id) => s.cleared[id])) {
      tick(a.id);
      done = true;
      bookAdj = r2(a.amount - sum(it.book.map((id) => m.lines[id].amount)));
    }
  } else {
    tick(a.id);
    tick(b.id);
    bookAdj = r2(a.amount - b.amount); // 0 for a clean pair; the correcting entry otherwise
    done = [...it.bank, ...it.book].every((id) => s.cleared[id]);
  }
  if (done) s.itemDone[a.item] = true;
  s.bookAdj = r2(s.bookAdj + bookAdj);
  const note = it.kind === 'dupe' || (!done && it.kind !== 'pair') ? '' : noteFor(m, it.kind, bookAdj, a.text);
  return { result: 'ok', cleared, item: a.item, done, bankAdj: 0, bookAdj, note };
}

/** adjusted bank − adjusted books */
export function recDiff(m: RecModel, s: RecState): number {
  return r2(m.bankEnd + s.bankAdj - (m.bookEnd + s.bookAdj));
}

/** Items resolved, with partial credit for a half-ticked payout or duplicate. */
export function recProgress(m: RecModel, s: RecState): number {
  return m.items.reduce((acc, it, i) => {
    if (s.itemDone[i]) return acc + 1;
    const ids = [...it.bank, ...it.book];
    const c = ids.filter((id) => s.cleared[id]).length;
    return acc + (ids.length > 2 ? (0.8 * c) / ids.length : 0);
  }, 0);
}

export function scoreReconcile(m: RecModel, s: RecState): number {
  return clamp(recProgress(m, s) / m.items.length - m.penalty * s.wrong, 0, 1);
}

/** A clean run: the moves a careful analyst makes. */
export function solveReconcile(m: RecModel): RecAction[] {
  const acts: RecAction[] = [];
  for (const it of m.items) {
    switch (it.kind) {
      case 'pair':
      case 'transpose':
      case 'fx':
        acts.push({ t: 'pair', a: it.bank[0], b: it.book[0] });
        break;
      case 'split':
      case 'net':
        for (const k of it.book) acts.push({ t: 'pair', a: it.bank[0], b: k });
        break;
      case 'dupe':
        acts.push({ t: 'pair', a: it.bank[0], b: it.book[0] }, { t: 'bin', line: it.bank[1], bin: 'adjust' });
        break;
      case 'fee':
      case 'interest':
      case 'debit':
        acts.push({ t: 'bin', line: it.bank[0], bin: 'adjust' });
        break;
      case 'transit':
      case 'outstanding':
        acts.push({ t: 'bin', line: it.book[0], bin: 'timing' });
        break;
    }
  }
  return acts;
}

export function summarizeReconcile(m: RecModel, s: RecState): string {
  const found = s.itemDone.filter(Boolean).length;
  const w = s.wrong ? `${s.wrong} wrong pair${s.wrong > 1 ? 's' : ''}` : 'no wrong pairs';
  if (found === m.items.length) return `Reconciled to $0.00, ${money(m.money, { cents: false })} found, ${w}`;
  return `Difference ${money(Math.abs(recDiff(m, s)))} left, ${found}/${m.items.length} items, ${w}`;
}

function recResult(m: RecModel, s: RecState): PuzzleResult {
  return result(scoreReconcile(m, s), summarizeReconcile(m, s), {
    found: s.itemDone.filter(Boolean).length,
    total: m.items.length,
    wrong: s.wrong,
  });
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
    const off = isDigit(ch) ? (dw - ctx.measureText(ch).width) / 2 : 0;
    ctx.fillText(ch, cx + off, y);
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

function stampMark(
  ctx: CanvasRenderingContext2D,
  word: string,
  x: number,
  y: number,
  color: string,
  t: number,
  size: number,
  still: boolean,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.14);
  const sc = still ? 1 : 1 + 0.6 * (1 - ease.outCubic(clamp(t, 0, 1)));
  ctx.scale(sc, sc);
  ctx.globalAlpha = still ? 0.92 : clamp(t * 2.5, 0, 1) * 0.92;
  ctx.font = `900 ${size}px ${FONT}`;
  const tw = ctx.measureText(word).width;
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  roundRect(ctx, -tw / 2 - 16, -size * 0.8, tw + 32, size * 1.6, 8);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  roundRect(ctx, -tw / 2 - 10, -size * 0.8 + 6, tw + 20, size * 1.6 - 12, 5);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(word, 0, 2);
  ctx.restore();
}

// ---------------------------------------------------------------- puzzle

type Target = { kind: 'chip'; id: number } | { kind: 'bin'; bin: RecBin };

export const reconcile: PuzzleDef = {
  id: 'reconcile',
  role: 'fin',
  title: 'Bank reconciliation',
  gesture: 'Drag to pair',
  howTo: 'Drag bank lines onto their book match. Leftovers: Timing or Adjust.',
  term: 'Bank rec: explain every gap between the bank statement and your books.',
  seconds: (tier) => clamp(60 + tier * 12, 60, 120),
  mount(host, p) {
    const m = generateReconcile(p.seed, p.tier, p.tools, p.context);
    const s = newRecState(m);
    const st = stage(host.el);
    const { ctx } = st;
    const still = p.reducedMotion;
    const suggestNo = new Map<number, number>();
    m.suggest.forEach(([a, b], i) => {
      suggestNo.set(a, i + 1);
      suggestNo.set(b, i + 1);
    });
    const tagOf = new Map<number, string>(); // item → pair letter once ticked
    let letters = 0;

    let finished = false;
    let final: PuzzleResult | null = null;
    let doneTimer: ReturnType<typeof setTimeout> | null = null;
    let flourishT = -1;
    let selected = -1;
    let drag: { pid: number; id: number; sx: number; sy: number; x: number; y: number; gx: number; gy: number; moved: boolean } | null =
      null;
    let hover: Target | null = null;
    let ret: { id: number; x: number; y: number; t0: number } | null = null;
    const flashes = new Map<string, { t0: number; color: string }>();
    const pulses = new Map<number, number>();
    const links: { a: number; b: number; t0: number }[] = [];
    const floats: { str: string; col: 0 | 1; t0: number }[] = [];
    let toast: { str: string; t0: number; color: string; hold?: boolean } | null =
      m.tier === 0 ? { str: 'Drag a bank line onto the same entry in your books', t0: 0, color: C.ink, hold: true } : null;
    let hint: { line?: number; bin?: RecBin; until: number } | null = null;
    let shownBank = m.bankEnd;
    let shownBook = m.bookEnd;
    let binCount = { timing: 0, adjust: 0 };
    let binSum = { timing: 0, adjust: 0 };

    const lay = () => {
      const w = st.w;
      const h = st.h;
      const pad = 12;
      const cw = Math.min(w - pad * 2, 520);
      const x0 = (w - cw) / 2;
      const gap = 8;
      const colW = (cw - gap) / 2;
      const rb = Math.ceil(m.bankOrder.length / 2);
      const rk = Math.ceil(m.bookOrder.length / 2);
      const headH = clamp(h * 0.11, 62, 84);
      const binH = clamp(h * 0.095, 58, 72);
      const labH = 22;
      const binsY = h - pad - binH;
      const room = binsY - 14 - (pad + headH + 34) - labH * 2 - 10;
      const rowH = clamp(room / (rb + rk), 52, 70);
      const chipH = rowH - 7;
      const bookY = binsY - 14 - rk * rowH;
      const bankY = bookY - labH - 12 - rb * rowH;
      const chip: Rect[] = [];
      m.bankOrder.forEach((id, i) => {
        chip[id] = { x: x0 + (i % 2) * (colW + gap), y: bankY + Math.floor(i / 2) * rowH, w: colW, h: chipH };
      });
      m.bookOrder.forEach((id, i) => {
        chip[id] = { x: x0 + (i % 2) * (colW + gap), y: bookY + Math.floor(i / 2) * rowH, w: colW, h: chipH };
      });
      const head: Rect = { x: x0, y: pad, w: cw, h: headH };
      const bankLab = bankY - labH / 2 - 3;
      return {
        w,
        h,
        x0,
        cw,
        head,
        bankLab,
        bookLab: bookY - labH / 2 - 3,
        toastY: (head.y + head.h + bankLab - labH / 2) / 2,
        chip,
        timing: { x: x0, y: binsY, w: colW, h: binH } as Rect,
        adjust: { x: x0 + colW + gap, y: binsY, w: colW, h: binH } as Rect,
      };
    };
    type Lay = ReturnType<typeof lay>;

    const cleared = () => s.cleared.filter(Boolean).length;
    const status = () => {
      const d = recDiff(m, s);
      host.status(`Difference ${money(Math.abs(d))} · ${cleared()} of ${m.lines.length} cleared`);
    };
    status();

    const flash = (key: string, color: string) => flashes.set(key, { t0: performance.now(), color });

    const makeResult = () => recResult(m, s);

    const finish = () => {
      if (finished) return;
      finished = true;
      drag = null;
      hover = null;
      selected = -1;
      const res = makeResult();
      final = res;
      shownBank = m.bankEnd + s.bankAdj;
      shownBook = m.bookEnd + s.bookAdj;
      if (res.perfect) {
        flourishT = performance.now();
        host.fx.flourish();
      } else host.fx.good();
      toast = { str: res.perfect ? 'Adjusted bank = adjusted books' : res.summary, t0: performance.now(), color: C.palmDark, hold: true };
      doneTimer = setTimeout(() => {
        doneTimer = null;
        host.done(res);
      }, res.perfect ? 850 : 350);
    };

    const act = (a: RecAction): RecOutcome => {
      const out = applyRec(m, s, a);
      const now = performance.now();
      const dragged = a.t === 'pair' ? a.a : a.line;
      if (out.result === 'ignored') {
        host.fx.tap();
        return out;
      }
      if (out.result === 'wrong') {
        host.fx.bad();
        flash(`l${dragged}`, C.rust);
        if (a.t === 'pair') flash(`l${a.b}`, C.rust);
        else flash(`b${a.bin}`, C.rust);
        const why =
          a.t === 'pair'
            ? m.lines[a.a].side === m.lines[a.b].side
              ? 'Same side'
              : 'Not the same transaction'
            : m.tier <= 2
              ? binFor(m, s, a.line) === null
                ? 'This one has a match on the other side'
                : a.bin === 'timing'
                  ? 'Only the bank has it: book an adjustment'
                  : 'Only your books have it: a timing difference'
              : a.bin === 'timing'
                ? 'Not a timing difference'
                : 'Not an adjusting item';
        toast = { str: why, t0: now, color: C.rust };
        if (m.tier === 0 || m.tier === 1) hint = { ...out.hint, until: now + 1400 };
        status();
        return out;
      }
      // correct
      host.fx.snap();
      if (toast?.hold) toast = null;
      const it = m.items[out.item];
      for (const id of out.cleared) {
        pulses.set(id, now);
        flash(`l${id}`, C.palm);
      }
      if (a.t === 'pair') {
        if (!tagOf.has(out.item)) tagOf.set(out.item, String.fromCharCode(65 + (letters++ % 26)));
        const bankId = m.lines[a.a].side === 'bank' ? a.a : a.b;
        const bookId = bankId === a.a ? a.b : a.a;
        links.push({ a: bankId, b: bookId, t0: now });
        pulses.set(bankId, now);
      } else {
        binCount = { ...binCount, [a.bin]: binCount[a.bin] + 1 };
        binSum = { ...binSum, [a.bin]: r2(binSum[a.bin] + m.lines[a.line].amount) };
        flash(`b${a.bin}`, C.palm);
      }
      if (a.t === 'pair' && Math.abs(out.bookAdj) >= 0.005) {
        binCount = { ...binCount, adjust: binCount.adjust + 1 };
        binSum = { ...binSum, adjust: r2(binSum.adjust + out.bookAdj) };
        flash('badjust', C.palm);
      }
      if (Math.abs(out.bankAdj) >= 0.005) floats.push({ str: money(out.bankAdj, { sign: true, dollar: false }), col: 0, t0: now });
      if (Math.abs(out.bookAdj) >= 0.005) floats.push({ str: money(out.bookAdj, { sign: true, dollar: false }), col: 1, t0: now });
      if (out.note) toast = { str: out.note, t0: now, color: C.ink };
      if (it && out.done && s.itemDone.every(Boolean)) finish();
      else status();
      return out;
    };

    const targetAt = (x: number, y: number, id: number): Target | null => {
      const g = lay();
      if (inRect(g.timing, x, y, 8)) return { kind: 'bin', bin: 'timing' };
      if (inRect(g.adjust, x, y, 8)) return { kind: 'bin', bin: 'adjust' };
      const side = m.lines[id].side;
      for (const L of m.lines) {
        if (L.side === side || s.cleared[L.id]) continue;
        if (inRect(g.chip[L.id], x, y, 4)) return { kind: 'chip', id: L.id };
      }
      return null;
    };
    const chipAt = (x: number, y: number) => {
      const g = lay();
      for (const L of m.lines) if (!s.cleared[L.id] && inRect(g.chip[L.id], x, y, 3)) return L.id;
      return -1;
    };

    const drop = (id: number, tgt: Target | null): boolean => {
      if (!tgt) return false;
      const out =
        tgt.kind === 'bin' ? act({ t: 'bin', line: id, bin: tgt.bin }) : act({ t: 'pair', a: id, b: tgt.id });
      return out.result === 'ok';
    };

    const tapChip = (id: number) => {
      if (selected < 0 || selected === id || s.cleared[selected]) {
        selected = selected === id ? -1 : id;
        host.fx.tap();
        return;
      }
      if (m.lines[selected].side === m.lines[id].side) {
        selected = id;
        host.fx.tap();
        return;
      }
      const keep = selected;
      const out = act({ t: 'pair', a: selected, b: id });
      // a payout stays picked up while you tick its bookings
      selected = out.result === 'ok' && !s.cleared[keep] ? keep : -1;
    };

    const offPtr = pointer(st.canvas, {
      down(pt) {
        if (finished || host.paused() || drag) return;
        const id = chipAt(pt.x, pt.y);
        if (id >= 0) {
          const r = lay().chip[id];
          drag = { pid: pt.id, id, sx: pt.x, sy: pt.y, x: pt.x, y: pt.y, gx: pt.x - r.x, gy: pt.y - r.y, moved: false };
          return;
        }
        const g = lay();
        const bin: RecBin | null = inRect(g.timing, pt.x, pt.y) ? 'timing' : inRect(g.adjust, pt.x, pt.y) ? 'adjust' : null;
        if (bin && selected >= 0) {
          const sel = selected;
          selected = -1;
          act({ t: 'bin', line: sel, bin });
          return;
        }
        if (bin) {
          host.fx.tap();
          toast = { str: 'Pick up a line first, then drop it here', t0: performance.now(), color: C.ink };
          return;
        }
        selected = -1;
      },
      move(pt) {
        if (!drag || drag.pid !== pt.id) return;
        if (finished || host.paused()) {
          drag = null;
          hover = null;
          return;
        }
        drag.x = pt.x;
        drag.y = pt.y;
        if (!drag.moved && Math.hypot(pt.x - drag.sx, pt.y - drag.sy) > 8) {
          drag.moved = true;
          selected = -1;
          host.fx.tap();
        }
        if (drag.moved) hover = targetAt(pt.x, pt.y, drag.id);
      },
      up(pt) {
        if (!drag || drag.pid !== pt.id) return;
        const d = drag;
        drag = null;
        hover = null;
        if (finished || host.paused()) return;
        if (!d.moved) {
          tapChip(d.id);
          return;
        }
        if (!drop(d.id, targetAt(pt.x, pt.y, d.id)) && !s.cleared[d.id] && !still)
          ret = { id: d.id, x: d.x - d.gx, y: d.y - d.gy, t0: performance.now() };
      },
    });

    const stop = loop((_t, dt) => {
      const k = still ? 1 : 1 - Math.exp(-dt / 0.09);
      const tb = m.bankEnd + s.bankAdj;
      const tk = m.bookEnd + s.bookAdj;
      shownBank += (tb - shownBank) * k;
      shownBook += (tk - shownBook) * k;
      if (Math.abs(tb - shownBank) < 0.005) shownBank = tb;
      if (Math.abs(tk - shownBook) < 0.005) shownBook = tk;
      draw(lay(), performance.now());
    });

    function drawHeader(g: Lay, now: number) {
      const { x, y, w, h } = g.head;
      ctx.save();
      ctx.shadowColor = 'rgba(31,42,48,0.12)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 3;
      ctx.fillStyle = C.paper;
      roundRect(ctx, x, y, w, h, 14);
      ctx.fill();
      ctx.restore();
      // ledger ruling
      ctx.strokeStyle = shade(C.fin, 0.55);
      ctx.lineWidth = 1;
      for (let ly = y + h * 0.42; ly < y + h - 4; ly += 11) {
        ctx.beginPath();
        ctx.moveTo(x + 10, ly);
        ctx.lineTo(x + w - 10, ly);
        ctx.stroke();
      }
      const cw = w / 3;
      ctx.strokeStyle = shade(C.sand, -0.15);
      for (let i = 1; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(x + cw * i, y + 10);
        ctx.lineTo(x + cw * i, y + h - 10);
        ctx.stroke();
      }
      const diff = recDiff(m, s);
      const shownDiff = r2(shownBank - shownBook);
      const ok = Math.abs(diff) < 0.005;
      const ly = y + h * 0.25;
      const vy = y + h * 0.56;
      const sy = y + h * 0.83;
      text(ctx, 'Bank (adj.)', x + cw * 0.5, ly, { size: 11, weight: 700, color: C.inkSoft, align: 'center' });
      text(ctx, 'Books (adj.)', x + cw * 1.5, ly, { size: 11, weight: 700, color: C.inkSoft, align: 'center' });
      text(ctx, 'Difference', x + cw * 2.5, ly, { size: 11, weight: 700, color: C.inkSoft, align: 'center' });
      const vs = clamp(w / 24, 13, 17);
      tnum(ctx, money(shownBank), x + cw * 0.5, vy, { size: vs, weight: 800, align: 'center' });
      tnum(ctx, money(shownBook), x + cw * 1.5, vy, { size: vs, weight: 800, align: 'center' });
      tnum(ctx, ok ? '$0.00' : money(shownDiff, { sign: true }), x + cw * 2.5, vy, {
        size: vs + 1,
        weight: 800,
        align: 'center',
        color: ok ? C.palmDark : C.rust,
      });
      const cents = Math.round(Math.abs(diff) * 100);
      if (ok) text(ctx, 'reconciled ✓', x + cw * 2.5, sy, { size: 10.5, weight: 700, color: C.palm, align: 'center' });
      else if (m.nineHint && cents % 900 === 0)
        text(ctx, '÷ 9 → swapped digits?', x + cw * 2.5, sy, { size: 10, weight: 800, color: C.sea, align: 'center' });
      // the sub-line shows the raw closing balance; a fresh adjustment briefly takes its place
      const sub = (col: 0 | 1, base: string) => {
        const f = [...floats].reverse().find((o) => o.col === col && now - o.t0 < 1300);
        const cx = x + cw * (col + 0.5);
        if (!f) return text(ctx, base, cx, sy, { size: 10, weight: 600, color: C.inkSoft, align: 'center' });
        const u = (now - f.t0) / 1300;
        const pop = still ? 1 : 1 + 0.25 * (1 - ease.outCubic(clamp(u * 4, 0, 1)));
        ctx.save();
        ctx.translate(cx, sy);
        ctx.scale(pop, pop);
        ctx.globalAlpha = clamp((1 - u) * 4, 0, 1);
        tnum(ctx, f.str, 0, 0, { size: 11.5, weight: 800, color: C.seaDeep, align: 'center' });
        ctx.restore();
      };
      sub(0, `stmt ${money(m.bankEnd)}`);
      sub(1, `book ${money(m.bookEnd)}`);
      while (floats.length && now - floats[0].t0 > 1300) floats.shift();
    }

    function drawToast(g: Lay, now: number) {
      if (!toast) return;
      const age = (now - toast.t0) / 1000;
      if (!toast.hold && age > 2.2) {
        toast = null;
        return;
      }
      const a = toast.hold ? 1 : clamp((2.2 - age) / 0.4, 0, 1);
      ctx.globalAlpha = a;
      ctx.font = `700 12.5px ${FONT}`;
      const tw = Math.min(g.cw, ctx.measureText(toast.str).width + 24);
      ctx.fillStyle = toast.color === C.rust ? shade(C.rust, 0.86) : shade(C.fin, 0.7);
      roundRect(ctx, g.w / 2 - tw / 2, g.toastY - 13, tw, 26, 13);
      ctx.fill();
      text(ctx, toast.str, g.w / 2, g.toastY, { size: 12.5, weight: 700, color: toast.color, align: 'center', max: g.cw - 20 });
      ctx.globalAlpha = 1;
    }

    function drawSection(y: number, g: Lay, name: string, right: string, color: string) {
      ctx.fillStyle = color;
      roundRect(ctx, g.x0, y - 6, 4, 12, 2);
      ctx.fill();
      text(ctx, name, g.x0 + 10, y, { size: 11, weight: 800, color: shade(color, -0.35) });
      text(ctx, right, g.x0 + g.cw, y, { size: 11, weight: 600, color: C.inkSoft, align: 'right' });
    }

    function drawChip(id: number, r: Rect, now: number, o: { lifted?: boolean; target?: boolean } = {}) {
      const L = m.lines[id];
      const done = s.cleared[id];
      const bank = L.side === 'bank';
      const it = m.items[L.item];
      const pt = pulses.get(id);
      let sc = 1;
      if (pt !== undefined && !still) {
        const u = (now - pt) / 240;
        if (u < 1) sc = 1 + 0.07 * Math.sin(u * Math.PI);
        else pulses.delete(id);
      }
      if (o.lifted) sc = 1.05;
      ctx.save();
      ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
      ctx.scale(sc, sc);
      ctx.translate(-r.w / 2, -r.h / 2);
      if (done) ctx.globalAlpha = 0.5;
      if (!done) {
        ctx.save();
        ctx.shadowColor = o.lifted ? 'rgba(31,42,48,0.28)' : 'rgba(31,42,48,0.13)';
        ctx.shadowBlur = o.lifted ? 16 : 5;
        ctx.shadowOffsetY = o.lifted ? 8 : 2;
        ctx.fillStyle = bank ? C.white : C.paper;
        roundRect(ctx, 0, 0, r.w, r.h, 10);
        ctx.fill();
        ctx.restore();
      } else {
        ctx.fillStyle = shade(C.sand, 0.35);
        roundRect(ctx, 0, 0, r.w, r.h, 10);
        ctx.fill();
      }
      if (o.target) {
        ctx.fillStyle = shade(C.sea, 0.85);
        roundRect(ctx, 0, 0, r.w, r.h, 10);
        ctx.fill();
      }
      // side stripe
      ctx.save();
      roundRect(ctx, 0, 0, r.w, r.h, 10);
      ctx.clip();
      ctx.fillStyle = bank ? C.sea : C.fin;
      ctx.fillRect(0, 0, 5, r.h);
      ctx.restore();
      const badge = !done ? suggestNo.get(id) : undefined;
      const ty = r.h * 0.31;
      const by = r.h * 0.72;
      text(ctx, L.text, 13, ty, { size: 12, weight: 650, color: C.ink, max: r.w - 20 - (done && s.how[id] !== 'pair' ? 44 : badge || done ? 20 : 0) });
      // bottom row: date or what is left to tick on a payout
      const split = (it.kind === 'split' || it.kind === 'net') && bank && !done;
      const ticked = split ? it.book.filter((k) => s.cleared[k]) : [];
      if (split && ticked.length) {
        const left = r2(L.amount - sum(ticked.map((k) => m.lines[k].amount)));
        tnum(ctx, `left ${money(left, { dollar: false })}`, 13, by, { size: 10.5, weight: 700, color: C.sea });
      } else text(ctx, `${L.day} ${m.month}`, 13, by, { size: 10.5, weight: 600, color: C.inkSoft });
      const amt = money(L.amount, { sign: true, dollar: false });
      tnum(ctx, amt, r.w - 10, by, { size: 13.5, weight: 800, color: L.amount > 0 ? C.palmDark : C.ink, align: 'right' });
      if (badge) {
        ctx.fillStyle = C.sea;
        ctx.beginPath();
        ctx.arc(r.w - 13, 12, 8, 0, Math.PI * 2);
        ctx.fill();
        text(ctx, String(badge), r.w - 13, 12.5, { size: 10, weight: 800, color: C.white, align: 'center' });
      }
      ctx.globalAlpha = 1;
      if (done) {
        const how = s.how[id];
        if (how === 'pair') {
          ctx.fillStyle = C.palm;
          ctx.beginPath();
          ctx.arc(r.w - 13, 12, 8.5, 0, Math.PI * 2);
          ctx.fill();
          text(ctx, tagOf.get(L.item) ?? '✓', r.w - 13, 12.5, { size: 10, weight: 800, color: C.white, align: 'center' });
        } else {
          const word = how === 'timing' ? 'timing' : 'adjust';
          ctx.fillStyle = how === 'timing' ? C.seaLight : shade(C.fin, -0.25);
          roundRect(ctx, r.w - 48, 4, 42, 16, 8);
          ctx.fill();
          text(ctx, word, r.w - 27, 12.5, { size: 9.5, weight: 800, color: C.white, align: 'center' });
        }
      }
      if (split && ticked.length) {
        ctx.fillStyle = shade(C.sea, 0.7);
        ctx.fillRect(10, r.h - 5, r.w - 20, 2.5);
        ctx.fillStyle = C.sea;
        ctx.fillRect(10, r.h - 5, ((r.w - 20) * ticked.length) / it.book.length, 2.5);
      }
      // outlines: selection, drop target, hint, flash
      const outline = (color: string, lw: number, alpha = 1) => {
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color;
        ctx.lineWidth = lw;
        roundRect(ctx, 0, 0, r.w, r.h, 10);
        ctx.stroke();
        ctx.globalAlpha = 1;
      };
      if (selected === id) outline(C.sea, 2.5);
      if (o.target) outline(C.sea, 3);
      if (hint?.line === id && now < hint.until) outline(C.sea, 3, 0.5 + 0.5 * Math.sin(now / 90));
      const f = flashes.get(`l${id}`);
      if (f) {
        const u = (now - f.t0) / 450;
        if (u < 1) outline(f.color, 3, 1 - u);
        else flashes.delete(`l${id}`);
      }
      ctx.restore();
    }

    function drawBin(g: Lay, bin: RecBin, now: number) {
      const r = bin === 'timing' ? g.timing : g.adjust;
      const tint = bin === 'timing' ? C.seaLight : C.fin;
      const isHover = hover?.kind === 'bin' && hover.bin === bin;
      ctx.fillStyle = shade(tint, isHover ? 0.55 : 0.78);
      roundRect(ctx, r.x, r.y, r.w, r.h, 14);
      ctx.fill();
      ctx.save();
      ctx.setLineDash(isHover ? [] : [6, 5]);
      ctx.strokeStyle = shade(tint, -0.25);
      ctx.lineWidth = isHover ? 3 : 1.5;
      roundRect(ctx, r.x + 1, r.y + 1, r.w - 2, r.h - 2, 13);
      ctx.stroke();
      ctx.restore();
      if (hint?.bin === bin && now < hint.until) {
        ctx.globalAlpha = 0.5 + 0.5 * Math.sin(now / 90);
        ctx.strokeStyle = C.sea;
        ctx.lineWidth = 3;
        roundRect(ctx, r.x, r.y, r.w, r.h, 14);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      const f = flashes.get(`b${bin}`);
      if (f) {
        const u = (now - f.t0) / 450;
        if (u < 1) {
          ctx.globalAlpha = 1 - u;
          ctx.strokeStyle = f.color;
          ctx.lineWidth = 3;
          roundRect(ctx, r.x, r.y, r.w, r.h, 14);
          ctx.stroke();
          ctx.globalAlpha = 1;
        } else flashes.delete(`b${bin}`);
      }
      const title = bin === 'timing' ? 'Timing' : 'Adjust';
      const sub = bin === 'timing' ? 'in transit · uncleared chq' : 'fees · interest · errors';
      text(ctx, binCount[bin] ? `${title} · ${binCount[bin]}` : title, r.x + 14, r.y + r.h * 0.33, {
        size: 15,
        weight: 800,
        color: shade(tint, -0.5),
      });
      text(ctx, sub, r.x + 14, r.y + r.h * 0.68, { size: 10.5, weight: 600, color: C.inkSoft, max: r.w - 24 });
      const n = binCount[bin];
      if (n) {
        tnum(ctx, money(binSum[bin], { sign: true, dollar: false }), r.x + r.w - 12, r.y + r.h * 0.33, {
          size: 12,
          weight: 800,
          color: shade(tint, -0.5),
          align: 'right',
        });
      }
    }

    function draw(g: Lay, now: number) {
      backdrop(ctx, g.w, g.h);
      drawHeader(g, now);
      drawToast(g, now);
      drawSection(g.bankLab, g, 'BANK STATEMENT', `to ${m.cutoff} ${m.month}`, C.sea);
      drawSection(g.bookLab, g, 'CASH BOOK', 'your ledger', shade(C.fin, -0.2));
      // tick links
      for (let i = links.length - 1; i >= 0; i--) {
        const l = links[i];
        const u = (now - l.t0) / 600;
        if (u >= 1) {
          links.splice(i, 1);
          continue;
        }
        const a = g.chip[l.a];
        const b = g.chip[l.b];
        ctx.globalAlpha = 1 - u;
        ctx.strokeStyle = C.palm;
        ctx.lineWidth = 3;
        ctx.setLineDash([2, 6]);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(a.x + a.w / 2, a.y + a.h / 2);
        ctx.lineTo(b.x + b.w / 2, b.y + b.h / 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
      const retU = ret ? (now - ret.t0) / 180 : 1;
      if (ret && retU >= 1) ret = null;
      for (const L of m.lines) {
        if (drag?.moved && drag.id === L.id) {
          // ghost slot
          const r = g.chip[L.id];
          ctx.strokeStyle = shade(C.sand, -0.2);
          ctx.setLineDash([5, 5]);
          ctx.lineWidth = 1.5;
          roundRect(ctx, r.x, r.y, r.w, r.h, 10);
          ctx.stroke();
          ctx.setLineDash([]);
          continue;
        }
        if (ret?.id === L.id) continue;
        drawChip(L.id, g.chip[L.id], now, { target: hover?.kind === 'chip' && hover.id === L.id });
      }
      drawBin(g, 'timing', now);
      drawBin(g, 'adjust', now);
      if (ret) {
        const r = g.chip[ret.id];
        const e = ease.outCubic(clamp(retU, 0, 1));
        drawChip(ret.id, { ...r, x: ret.x + (r.x - ret.x) * e, y: ret.y + (r.y - ret.y) * e }, now);
      }
      if (drag?.moved) {
        const r = g.chip[drag.id];
        drawChip(drag.id, { ...r, x: drag.x - drag.gx, y: drag.y - drag.gy }, now, { lifted: true });
        // live difference against the hovered line: the analyst's scratch calculation
        if (hover?.kind === 'chip') {
          const a = m.lines[drag.id].amount;
          const b = m.lines[hover.id].amount;
          const d = r2(Math.abs(a - b));
          if (d >= 0.005) {
            const str = `Δ ${money(d, { dollar: false })}`;
            ctx.font = `800 12px ${FONT}`;
            const tw = ctx.measureText(str).width + 16;
            const bx = clamp(drag.x - tw / 2, 4, g.w - tw - 4);
            const by = drag.y - drag.gy - 30;
            ctx.fillStyle = C.ink;
            roundRect(ctx, bx, by, tw, 22, 11);
            ctx.fill();
            tnum(ctx, str, bx + tw / 2, by + 11.5, { size: 12, weight: 800, color: C.white, align: 'center' });
          }
        }
      }
      if (flourishT > 0) {
        const u = (now - flourishT) / 280;
        const midY = (g.bankLab + g.timing.y) / 2;
        stampMark(ctx, 'RECONCILED', g.w / 2, midY, C.palmDark, u, clamp(g.w / 11, 24, 38), still);
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
        if (doneTimer) {
          clearTimeout(doneTimer);
          doneTimer = null;
        }
        finished = true;
        drag = null;
        hover = null;
        if (!final) final = makeResult();
        return final;
      },
      destroy() {
        if (doneTimer) clearTimeout(doneTimer);
        doneTimer = null;
        finished = true;
        stop();
        offPtr();
        st.destroy();
      },
    };
  },
};
