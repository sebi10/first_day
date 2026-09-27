// UI-side derived data: who is blocking whom, what to launch for an order.
import type { PuzzleId } from '../puzzles/types';
import { alertFlags, alertShort, liveAlerts, soleGuest } from '../sim/alerts';
import { benchMove, chainMove, islandAircraft, manualCard, openChain } from '../sim/chain';
import { externalPower } from '../sim/aircraft';
import { CABLE_REPORT, ECON, GSE, MODELS, REPORT_BY_KEY, ROLE_LABEL } from '../sim/data';
import { chainWouldOpen, forecastContext, listPrice } from '../sim/engine';
import { cartOn, flightsAvailable, flightsPerPlane, gseCarts, houses, housesRentable, isBlind, isRework, launchTier, needsCart, openReports, planes, powered, reportCap } from '../sim/econ';
import { cardOf, flowStage } from '../sim/flow';
import { itemById, priceAt } from '../sim/items';
import { toolsFor } from '../sim/progression';
import { hashSeed } from '../sim/rng';
import { invoiceContext, reqValue, stockFlags, urgentJob } from '../sim/stock';
import { spendable } from '../sim/ledger';
import { taskById } from '../sim/tasks';
import { ROLES, type Action, type Alert, type IslandState, type OpsRole, type Order, type Role } from '../sim/types';
import type { PuzzleLaunch } from './puzzlehost';

/** `kind`: a cross-trade move (a crewmate's report, or the part chain), as crossMoves() lists them */
export type Block = { from: Role; to: Role; text: string; kind?: CrossMove['kind'] };

export function blocks(s: IslandState): Block[] {
  const out: Block[] = [];
  // legacy cards (no job flow): today's count. Flow cards and requisitions come in with the cross-trade moves below
  const pending = s.orders.filter((o) => o.status === 'pending' && o.role !== 'fin' && o.lastDeferredWeek !== s.week && !o.chain && !o.flow);
  const byRole = (r: Role) => pending.filter((o) => o.role === r).length;
  for (const r of ['mech', 'elec'] as Role[])
    if (byRole(r)) out.push({ from: 'fin', to: r, text: `${byRole(r)} approval${byRole(r) > 1 ? 's' : ''} waiting` });
  const countered = s.orders.filter((o) => o.status === 'countered');
  for (const o of countered) out.push({ from: o.role, to: 'fin', text: `counter-offer on ${o.title}` });
  const passengerCap = planes(s)
    .filter((p) => !MODELS[p.model].cargo)
    .reduce((n, p) => n + (p.health >= 40 ? 1 : 0), 0);
  if (passengerCap === 0) out.push({ from: 'mech', to: 'elec', text: 'no guest flights: houses stay empty' });
  const cargo = planes(s).find((p) => MODELS[p.model].cargo);
  const stuck = (s.pos ?? []).filter((p) => (p.status === 'open' || p.status === 'held') && p.carrier === 'bulk' && p.eta <= s.week).length;
  if (cargo && cargo.health < 40 && stuck > 0) out.push({ from: 'mech', to: 'elec', text: `cargo plane grounded: ${stuck} PO${stuck > 1 ? 's' : ''} waiting for a flight` });
  if (powered(s).gridDown) out.push({ from: 'elec', to: 'mech', text: 'grid down: hangar tools offline' });
  if (houses(s).length && housesRentable(s) === 0) out.push({ from: 'elec', to: 'fin', text: 'no rentable houses: no revenue' });
  if (s.cash < ECON.freezeBelow) out.push({ from: 'fin', to: 'mech', text: 'cash under $2,000: only safety-critical work gets approved' });
  // cross-trade moves: a crewmate's report, the part chain and the job flow, counted the same way. The flow's
  // cards and requisitions are one line per pair of seats (16); a grounded plane or a closed house gets its own
  const tally = new Map<string, { from: Role; to: Role; cards: number; reqs: number; usd: number }>();
  for (const m of crossMoves(s)) {
    if (m.kind === 'flow' && (m.key.startsWith('flow:card:') || m.key.startsWith('flow:req:'))) {
      const k = `${m.who}>${m.waits}`;
      const t = tally.get(k) ?? tally.set(k, { from: m.who, to: m.waits, cards: 0, reqs: 0, usd: 0 }).get(k)!;
      if (m.key.startsWith('flow:card:')) t.cards++;
      else t.reqs++;
      t.usd += m.usd ?? 0;
      continue;
    }
    out.push({ from: m.who, to: m.waits, text: m.text, kind: m.kind });
  }
  for (const t of tally.values()) out.push({ from: t.from, to: t.to, text: `${waitWords(t.cards, t.reqs)} waiting (${usdWords(t.usd)})`, kind: 'flow' });
  return out;
}

const usdWords = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
/** "2 cards and 1 requisition" */
function waitWords(cards: number, reqs: number): string {
  const c = cards ? `${cards} card${cards > 1 ? 's' : ''}` : '';
  const r = reqs ? `${reqs} requisition${reqs > 1 ? 's' : ''}` : '';
  return [c, r].filter(Boolean).join(' and ');
}

/**
 * What one seat is waiting on another for across trades, in one list: an open
 * cross-trade report (the fixer's move; the reporter waits) and the part chain
 * (whoever's move it is; the seat that moves next waits: the analyst buys what
 * the mechanic's lookup ordered, the mechanic installs what the analyst
 * bought, and the plane earns nothing until it's on). The crew strip, the
 * waiting / blocking cards, the end-turn check and the pushes all read this,
 * so a report and a chain step count toward "whose move is it" the same way.
 * `key` changes when the move does (a push goes out for a new one).
 */
export type CrossMove = {
  key: string;
  kind: 'report' | 'chain' | 'flow';
  who: Role;
  waits: Role;
  text: string;
  /** "the hangar work lights are dead" / "Cargo C-7 AOG: brake linings" */
  what: string;
  /** the move in a few words */
  short: string;
  /** a flow card or requisition: what it comes to */
  usd?: number;
};

export function crossMoves(s: IslandState): CrossMove[] {
  const out: CrossMove[] = [];
  const ch = openChain(s);
  if (ch) {
    const asset = s.assets.find((a) => a.id === ch.assetId);
    // "look up the brake linings in the IPC (Cargo C-7 is AOG)", "approve the part (066-22500, $310; Cargo C-7 is AOG)"
    const aog = `${asset?.name ?? 'a plane'} is AOG`;
    const add = (m: ReturnType<typeof chainMove>, key: string) => {
      // the analyst waits on the mechanic's paperwork (nothing to buy yet); the mechanic on the analyst and on the electrician's check
      const waits: Role | null = m.who === 'fin' ? 'mech' : m.who === 'mech' ? 'fin' : m.who === 'elec' ? 'mech' : null;
      const text = m.text.endsWith(')') ? `${m.text.slice(0, -1)}; ${aog})` : `${m.text} (${aog})`;
      if (m.who && waits && s.players[m.who] && s.players[waits]) out.push({ key, kind: 'chain', who: m.who, waits, text, what: `${asset?.name ?? 'A plane'} AOG: ${ch.item}`, short: m.short });
    };
    add(chainMove(s, ch), `chain:${ch.id}:${ch.step}:${ch.stepId ?? ''}`);
    // the electrician's check on an electrical unit runs beside the lookup and the research
    const b = benchMove(s, ch);
    if (b) add(b, `chain:${ch.id}:bench:${ch.bench!.id}`);
  }
  for (const o of openReports(s)) {
    const rep = o.report!;
    if (rep.by === o.role || !s.players[rep.by] || !s.players[o.role]) continue;
    const effect = rep.effect === 'cap' ? ` (${capWords(rep.by)})` : rep.effect === 'gse' ? ` (${gseCarts(s).find((c) => c.id === rep.cart)?.name ?? 'a GPU cart'} tagged out)` : ` (−\u2060$${rep.amount.toLocaleString('en-US')}/wk)`;
    out.push({ key: `report:${o.id}`, kind: 'report', who: o.role, waits: rep.by, text: `${reportSaid(o)}${effect}`, what: reportSaid(o), short: 'fix the report' });
  }
  out.push(...flowMoves(s));
  return out;
}

// ---------------------------------------------------------------------------
// The job flow's moves (docs/JOBFLOW.md 16)

const nameOf = (s: IslandState, r: Role) => s.players[r]?.name ?? ROLE_LABEL[r];
const assetName = (s: IslandState, id: string | null | undefined) => s.assets.find((x) => x.id === id)?.name;

/** what the electrician meters for a bench alert */
const BENCH_WHAT: Record<string, string> = { M_COM_DEAD: 'com 1', M_LOW_VOLTS: 'the alternator circuit', M_GEN_OFF: 'the starter-generator circuit' };

/** one alert's next move: the inbox chip and the stepper's "next" line (16) */
export function flowMove(s: IslandState, a: Alert): { who: Role | null; chip: string; text: string } {
  const where = assetName(s, a.assetId) ? ` on ${assetName(s, a.assetId)}` : '';
  const o = a.order ? s.orders.find((x) => x.id === a.order) : undefined;
  switch (flowStage(s, a)) {
    case 'new':
      return { who: a.role, chip: a.due <= s.week ? 'Due now' : 'Your move', text: `find the fix for ${alertShort(s, a)}${where}` };
    case 'bench':
      return { who: 'elec', chip: `${nameOf(s, 'elec')}: meter it`, text: `meter ${BENCH_WHAT[a.sym] ?? 'the circuit'}${where}` };
    case 'approval':
      return { who: 'fin', chip: `${nameOf(s, 'fin')}: approve`, text: `approve ${o?.title ?? 'the card'}${where} (${usdWords(o ? cardOf(s, o).total : 0)})` };
    case 'parts': {
      if (o?.flow?.stop) return { who: a.role, chip: 'Repick', text: `repick: ${o.flow.stop}` };
      const reqs = (s.reqs ?? []).filter((r) => r.order === o?.id && r.status === 'open');
      if (reqs.length) {
        const usd = reqs.reduce((n, r) => n + reqValue(r), 0);
        return { who: 'fin', chip: `${nameOf(s, 'fin')}: buy`, text: `buy ${reqs.length} line${reqs.length > 1 ? 's' : ''} for ${o?.title ?? 'the job'} (${usdWords(usd)})` };
      }
      // everything is ordered: when it comes (the first line still out)
      const lines = (s.pos ?? []).flatMap((p) => (p.status === 'open' || p.status === 'held' ? p.lines.filter((l) => l.order === o?.id && l.got === undefined && !l.back).map((l) => ({ p, l })) : []));
      const held = lines.find((x) => x.p.status === 'held' || x.l.hold);
      if (held) return { who: null, chip: 'Held: paperwork', text: `the ${itemById(held.l.item)?.nomen.split(',')[0].toLowerCase() ?? held.l.item} waits for its paperwork (week ${held.p.hold ?? s.week + 1})` };
      const tool = lines.find((x) => itemById(x.l.item)?.kind === 'tool');
      if (tool && lines.length === 1) return { who: null, chip: 'Tool on order', text: `the ${itemById(tool.l.item)?.nomen.split(',')[0].toLowerCase() ?? tool.l.item} comes week ${tool.p.eta}` };
      const first = lines.sort((x, y) => x.p.eta - y.p.eta)[0];
      if (first) return { who: null, chip: `Parts wk ${first.p.eta}`, text: `the ${itemById(first.l.item)?.nomen.split(',')[0].toLowerCase() ?? first.l.item} comes week ${first.p.eta}${first.p.eta <= s.week ? ' (next flight)' : ''}` };
      return { who: null, chip: 'Parts', text: `waiting on parts for ${o?.title ?? 'the job'}` };
    }
    case 'research': {
      const ch = openChain(s);
      if (ch && o?.chain && ch.id === o.chain.id) {
        const m = chainMove(s, ch);
        return { who: m.who, chip: m.chip, text: m.text };
      }
      return { who: null, chip: 'Research queued', text: 'the research opens when the part chain in progress closes' };
    }
    case 'ready':
      return { who: a.role, chip: 'Ready', text: `do ${o?.title ?? 'the job'}${where}` };
    case 'done':
      return { who: null, chip: 'Done', text: '' };
    default:
      return { who: null, chip: 'Closed', text: '' };
  }
}

/** what an alert does to its asset now, in words (the grounded plane, the restricted one, the closed house) */
function bites(s: IslandState, o: Order): string | null {
  if (!urgentJob(s, o)) return null;
  const asset = s.assets.find((x) => x.id === o.assetId);
  if (!asset) return null;
  if (asset.kind === 'plane') return soleGuest(s, asset.id) ? `${asset.name} flies restricted` : `${asset.name} is AOG`;
  return `${asset.name} is closed`;
}

/** the job flow's cross-trade moves (inside crossMoves), when both seats are held */
export function flowMoves(s: IslandState): CrossMove[] {
  const out: CrossMove[] = [];
  const held = (a: Role, b: Role) => !!s.players[a] && !!s.players[b];
  for (const o of s.orders) {
    if (!o.flow || o.status === 'done' || o.status === 'cancelled') continue;
    const where = assetName(s, o.assetId) ? ` on ${assetName(s, o.assetId)}` : '';
    if (o.status === 'pending' && o.lastDeferredWeek !== s.week && held('fin', o.role)) {
      const total = cardOf(s, o).total;
      out.push({ key: `flow:card:${o.id}`, kind: 'flow', who: 'fin', waits: o.role, text: `approve ${o.title}${where} (${usdWords(total)})`, what: `${o.title}${where}`, short: 'approve the card', usd: total });
    }
    if (o.status === 'ready' && held(o.role, 'fin')) {
      const b = bites(s, o);
      if (b) out.push({ key: `flow:aog:${o.id}`, kind: 'flow', who: o.role, waits: 'fin', text: `${b}: do ${o.title}`, what: b, short: 'do the job' });
    }
  }
  for (const r of s.reqs ?? []) {
    if (r.status !== 'open' || r.deferredWeek === s.week || !held('fin', r.role)) continue;
    const x = itemById(r.item);
    const usd = reqValue(r);
    out.push({ key: `flow:req:${r.id}`, kind: 'flow', who: 'fin', waits: r.role, text: `buy ${r.qty} × ${x?.pn ?? r.item} (${usdWords(usd)})`, what: `${r.qty} × ${x?.pn ?? r.item}`, short: 'buy it', usd });
  }
  for (const a of liveAlerts(s)) {
    if (!a.bench?.order || a.bench.call || !held('elec', 'mech')) continue;
    const b = s.orders.find((x) => x.id === a.bench!.order);
    if (!b || b.status === 'done' || b.status === 'cancelled') continue;
    const plane = assetName(s, a.assetId) ?? 'the plane';
    out.push({ key: `flow:bench:${a.id}`, kind: 'flow', who: 'elec', waits: 'mech', text: `meter ${BENCH_WHAT[a.sym] ?? 'the circuit'} on ${plane}`, what: `${plane}: ${alertShort(s, a)}`, short: 'meter it' });
  }
  return out;
}

/** this trade's open alerts due this week with no job signed off (due now first, then hazards and airworthiness) */
export function dueNow(s: IslandState, role: OpsRole): Alert[] {
  return liveAlerts(s)
    .filter((a) => a.role === role && a.status !== 'closed' && a.due <= s.week)
    .filter((a) => {
      const o = a.order ? s.orders.find((x) => x.id === a.order) : undefined;
      return !o || o.status !== 'done';
    })
    .sort((a, b) => a.due - b.due || rank(s, a) - rank(s, b));
}
const rank = (s: IslandState, a: Alert) => {
  const f = alertFlags(s, a);
  return f.hazard ? 0 : f.aw ? 1 : 2;
};

/** the tech's "Your move" rows: new alerts, ready jobs, stopped jobs; due now first, then hazards and airworthiness, then by due week */
export function yourMoves(s: IslandState, role: OpsRole): { alert: Alert; order?: Order }[] {
  const rows: { alert: Alert; order?: Order }[] = [];
  for (const a of liveAlerts(s)) {
    if (a.role !== role || a.status === 'closed') continue;
    const m = flowMove(s, a);
    if (m.who !== role) continue;
    const o = a.order ? s.orders.find((x) => x.id === a.order) : undefined;
    rows.push({ alert: a, order: o && o.status !== 'cancelled' ? o : undefined });
  }
  return rows.sort((x, y) => Number(y.alert.due <= s.week) - Number(x.alert.due <= s.week) || rank(s, x.alert) - rank(s, y.alert) || x.alert.due - y.alert.due || (x.alert.id < y.alert.id ? -1 : 1));
}

export type DockTarget = { alert: string } | { order: string } | { desk: 'approvals' | 'stock' };

/** the Dock's primary button (16): a tech's first Your move row (a ready job opens its start); the analyst's cards and requisitions */
export function dockNext(s: IslandState, role: Role): { label: string; target: DockTarget } | null {
  if (s.turns[role]?.ended) return null;
  if (role === 'fin') {
    const cards = s.orders.filter((o) => o.flow && o.status === 'pending' && o.lastDeferredWeek !== s.week).length;
    const reqs = (s.reqs ?? []).filter((r) => r.status === 'open' && r.deferredWeek !== s.week).length;
    // short enough for the Dock on a phone ("Review 1 card · 1 requisition" was cut at 390 px): the desk and the
    // End-turn check say what they are
    if (cards + reqs > 0) return { label: `${cards + reqs} to approve ▸`, target: { desk: 'approvals' } };
    const urgent = stockFlags(s).filter((f) => f.urgent).length;
    if (urgent > 0) return { label: `Stock: ${urgent} urgent ▸`, target: { desk: 'stock' } };
    return null;
  }
  const row = yourMoves(s, role as OpsRole)[0];
  if (!row) return null;
  const where = assetName(s, row.alert.assetId);
  if (row.order?.status === 'ready') return { label: `Start: ${row.order.title}${where ? ` · ${where}` : ''} ▸`, target: { order: row.order.id } };
  return { label: `Next: ${alertShort(s, row.alert)}${where ? ` · ${where}` : ''} ▸`, target: { alert: row.alert.id } };
}

/** the End-turn confirm's flow lines (16); home adds today's ready jobs, owed moves and carts */
export function endTurnChecks(s: IslandState, role: Role): { text: string; urgent: boolean }[] {
  const out: { text: string; urgent: boolean }[] = [];
  if (role === 'fin') {
    const cards = s.orders.filter((o) => o.flow && o.status === 'pending' && o.lastDeferredWeek !== s.week);
    const reqs = (s.reqs ?? []).filter((r) => r.status === 'open' && r.deferredWeek !== s.week);
    if (cards.length + reqs.length > 0) {
      const who = [...new Set([...cards.map((o) => o.role), ...reqs.map((r) => r.role)])].map((r) => nameOf(s, r)).join(', ');
      const limit = s.standing ?? (s.autoBudget.mech ?? 0) + (s.autoBudget.elec ?? 0);
      out.push({
        text: `${waitWords(cards.length, reqs.length)} ${cards.length + reqs.length > 1 ? 'wait' : 'waits'} on you (${who}). After you end your turn, anything that comes in goes through tonight up to your standing limit (${usdWords(limit)}); the rest waits for next week.`,
        urgent: cards.some((o) => urgentJob(s, o)),
      });
    }
    return out;
  }
  const trade = role as OpsRole;
  for (const a of liveAlerts(s)) {
    if (a.role !== trade || a.status === 'closed') continue;
    const asset = s.assets.find((x) => x.id === a.assetId);
    const name = asset?.name ?? 'the asset';
    const f = alertFlags(s, a);
    const o = a.order ? s.orders.find((x) => x.id === a.order) : undefined;
    const signed = o?.status === 'done';
    if (a.due <= s.week && !signed && (f.aw || f.hazard)) {
      if (f.hazard && !a.safe) out.push({ text: `Make it safe or fix it, or ${name} stays closed: ${alertShort(s, a)}.`, urgent: true });
      else if (f.aw && asset?.kind === 'plane' && !(a.mel && a.mel.until >= s.week))
        out.push({ text: `Fix it or placard it this week, or ${name} ${soleGuest(s, asset.id) ? 'flies restricted' : 'is AOG'}: ${alertShort(s, a)}.`, urgent: true });
      continue;
    }
    if (a.status === 'open') out.push({ text: `Plan it now so the parts come in time: ${alertShort(s, a)} on ${name} (due wk ${a.due}).`, urgent: a.due <= s.week + 1 });
  }
  return out.sort((x, y) => Number(y.urgent) - Number(x.urgent));
}

/** the standing limit a week: late cards and requisitions approved at the resolve (8.5); absent, the work budgets' sum */
export const standingLimit = (s: IslandState) => s.standing ?? (s.autoBudget.mech ?? 0) + (s.autoBudget.elec ?? 0);

/**
 * A card that comes in after the analyst ended the turn (8.5), in the tech's words: the standing approval takes it
 * tonight when it fits the limit (and the cash), or it waits for the analyst. null while the analyst's turn is open.
 */
export function standingWords(s: IslandState, total: number, safety = false): string | null {
  if (!s.turns.fin?.ended) return null;
  const fin = nameOf(s, 'fin');
  const limit = standingLimit(s);
  if (total > limit) return `${fin} has ended the turn, and it's over the standing limit (${usdWords(limit)}): it waits for ${fin}'s approval.`;
  if (spendable(s) - total < (safety ? 0 : ECON.freezeBelow)) return `${fin} has ended the turn, and spendable cash is under the freeze: it waits for ${fin}'s approval.`;
  return `${fin} has ended the turn: it goes through tonight on the standing approval (up to ${usdWords(limit)}) unless deferred.`;
}

/** open a job-flow target: B's ops panel and C's desk listen for it */
export function openTarget(t: DockTarget): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('ic:open', { detail: t }));
}

/** The cross-trade moves that are this seat's to make: a crewmate is waiting on each (the end-turn check names them). */
export const owedBy = (s: IslandState, r: Role) => crossMoves(s).filter((m) => m.who === r);

/**
 * The crew's pushes (ntfy) for a move that just landed: a week resolved, a
 * crewmate's report raised or closed out, the part chain moving on to someone's
 * move, a turn ended, a board post, a counter-offer. Reports and chain steps are
 * told the same way: whose move it is now, by name.
 */
export function pushes(before: IslandState, after: IslandState, a: Action): { title: string; body: string }[] {
  const out: { title: string; body: string }[] = [];
  const push = (title: string, body: string) => out.push({ title, body });
  const name = (r: Role) => after.players[r]?.name ?? ROLE_LABEL[r];
  // cross-trade moves (a crewmate's report, a part chain step) count the same way: a new one is someone's move
  const was = crossMoves(before);
  const had = new Set(was.map((m) => m.key));
  const moves = crossMoves(after);
  const fresh = moves.filter((m) => !had.has(m.key) && m.kind === 'report');
  if (after.week > before.week && after.history.length) {
    const h = after.history[after.history.length - 1];
    const c = openChain(after);
    const aog = c ? ` ${after.assets.find((x) => x.id === c.assetId)?.name ?? 'A plane'} AOG: ${chainMove(after, c).chip}.` : '';
    const reps = fresh.map((m) => ` ${name(m.waits)} reports ${m.what}: ${name(m.who)}'s move.`).join('');
    // the job flow: parts that came in, and what bites this week
    const inLines = h.lines.map((l) => /^Parts for (.+?) are in: (.+?), your move\.$/.exec(l.text)).filter((m): m is RegExpExecArray => !!m);
    const partsIn = inLines.length ? ` Parts in: ${inLines.map((m) => `${m[1]} (${m[2]})`).join(', ')}.` : '';
    const due = (['mech', 'elec'] as OpsRole[]).flatMap((r) => dueNow(after, r).filter((a) => a.status === 'open' || a.status === 'job')).filter((a) => {
      const f = alertFlags(after, a);
      return f.aw || f.hazard;
    });
    const dueWords = due.length
      ? ` Due now: ${due
          .slice(0, 3)
          .map((a) => `${alertShort(after, a)} on ${after.assets.find((x) => x.id === a.assetId)?.name ?? 'an asset'}`)
          .join('; ')} (fix it or ${due.some((a) => alertFlags(after, a).hazard) ? 'make it safe' : 'placard it'} this week).`
      : '';
    push(`${after.name}: week ${h.week} resolved`, `Grade ${h.grade}. Revenue $${h.revenue.toLocaleString('en-US')}, ${h.flightsFlown}/${h.flightsScheduled} flights, ${h.incidents.length} incidents.${aog}${reps}${partsIn}${dueWords}`);
    return out;
  }
  // the job flow: a new card or requisition goes to the analyst, a bench ask to the electrician, a nudge to the trade
  if (a.t === 'plan' || a.t === 'repick') {
    const o = after.orders.find((x) => x.flow && x.status === 'pending' && (a.t === 'plan' ? x.flow.alert === a.alert : x.id === a.order) && !before.orders.some((y) => y.id === x.id && y.status === 'pending'));
    if (o) {
      const card = cardOf(after, o);
      const parts = card.total - card.labour;
      const where = after.assets.find((x) => x.id === o.assetId)?.name;
      const late = after.turns.fin?.ended
        ? card.total <= standingLimit(after)
          ? ' It goes through tonight on your standing approval unless you defer it.'
          : ` It's over your standing limit (${usdWords(standingLimit(after))}): it waits for you.`
        : '';
      push(`${after.name}: a card for ${name('fin')}`, `${name(o.role)} sent ${o.title}${where ? ` on ${where}` : ''}: ${usdWords(card.total)} (${parts > 0 ? `parts ${usdWords(parts)}, ` : ''}labour ${usdWords(card.labour)}).${late}`);
    }
  }
  if (a.t === 'request') {
    const x = itemById(a.item);
    push(`${after.name}: a request for ${name('fin')}`, `${name(a.role)} asks for ${a.qty} × ${x?.pn ?? a.item} (${usdWords(reqValue({ item: a.item, qty: a.qty }))}).`);
  }
  if (a.t === 'askBench') {
    const al = after.alerts?.find((x) => x.id === a.alert);
    const plane = al ? after.assets.find((x) => x.id === al.assetId)?.name : undefined;
    if (al) push(`${after.name}: ${name('elec')}, meter it`, `${name('mech')} asks you to meter ${BENCH_WHAT[al.sym] ?? 'the circuit'} on ${plane ?? 'the plane'}: the unit, or its wiring?`);
  }
  if (a.t === 'nudge') {
    const al = after.alerts?.find((x) => x.id === a.alert);
    const where = al ? after.assets.find((x) => x.id === al.assetId)?.name : undefined;
    if (al) push(`${after.name}: ${name(al.role)}, plan it`, `${name('fin')}: ${where ?? 'the asset'}'s ${alertShort(after, al)} is due week ${al.due}. Plan it so the parts come in time.`);
  }
  // a report raised mid-week (a cart's cable written up at an inspection), or one closed out: tell the other trade
  for (const m of fresh) push(`${after.name}: ${name(m.waits)} reports`, `${m.what.charAt(0).toUpperCase() + m.what.slice(1)}. ${name(m.who)}, your move.`);
  const now = new Set(moves.map((m) => m.key));
  // whoever signed the fix off (the third trade may have lent a hand)
  const closer = (m: CrossMove) => name(a.t === 'complete' ? a.role : m.who);
  for (const m of was) if (m.kind === 'report' && !now.has(m.key)) push(`${after.name}: report fixed`, `${closer(m)} closed out ${name(m.waits)}'s report: ${m.what}.`);
  // the part chain moved on to someone else's move: tell them
  const cb = openChain(before);
  const ca = openChain(after);
  if (ca && (!cb || cb.id !== ca.id || cb.step !== ca.step)) {
    const m = chainMove(after, ca);
    const plane = after.assets.find((x) => x.id === ca.assetId)?.name ?? 'A plane';
    const who = m.who ? name(m.who) : null;
    push(`${after.name}: ${plane} AOG`, who ? `${plane} is grounded for ${ca.item}. ${who}, your move: ${m.text}.` : `${plane} is grounded for ${ca.item}: ${m.text}.`);
  } else if (cb && !ca && after.chain?.step === 'done' && after.chain.story) push(`${after.name}: back in service`, after.chain.story);
  // the electrician's check came up beside it (a new chain on an electrical unit, or the new unit made no difference)
  const ba = ca ? benchMove(after, ca) : null;
  if (ca && ba && (!cb || cb.id !== ca.id || !benchMove(before, cb))) {
    const plane = after.assets.find((x) => x.id === ca.assetId)?.name ?? 'A plane';
    push(`${after.name}: ${plane} AOG`, `${plane} is grounded for ${ca.item}. ${name('elec')}, your move: ${ba.text}`);
  }
  if (a.t === 'endTurn') {
    const waiting = ROLES.filter((r) => !after.turns[r]?.ended).map(name);
    if (waiting.length) push(after.name, `${name(a.role)} ended their turn. Waiting on ${waiting.join(' and ')}.`);
  }
  if (a.t === 'post') {
    // the ntfy topic is shared by the crew: a DM push names who it's for, never what it says
    if (a.to) push(after.name, `${name(a.role)} sent ${name(a.to)} a direct message.`);
    else push(`${name(a.role)} on the ${after.name} crew board`, a.text.trim().slice(0, 180));
  }
  if (a.t === 'counter') {
    const o = after.orders.find((x) => x.id === a.orderId);
    if (o) push(after.name, `${name(o.role)}: the analyst offered a cheaper fix on ${o.title}.`);
  }
  return out;
}

/** "the hangar work lights are dead": what the reporter said, for mid-sentence use */
export function reportSaid(o: Order) {
  // a cart's cable: in the words of what's wrong with it (cracked insulation, or burnt contacts)
  if (o.report?.key === 'gpuCable' && o.report.band) return CABLE_REPORT[o.report.band].said;
  const def = o.report ? REPORT_BY_KEY[o.report.key] : undefined;
  return def?.said ?? o.title.replace(/ \(again\)$/, '');
}

/** "2 jobs max" / "1 desk task max" */
export function capWords(by: Role) {
  return by === 'fin' ? '1 desk task max' : '2 jobs max';
}

/** A report cap this seat is under, and whether this turn has used it up (lend-a-hand is never capped). */
export function capNow(s: IslandState, role: Role) {
  const cap = reportCap(s, role);
  if (!cap) return null;
  const done = s.turns[role]?.done ?? 0;
  return { ...cap, done, full: done >= cap.limit };
}

export function teamNumbers(s: IslandState) {
  const approved = s.orders.filter((o) => o.approvedWeek === s.week && o.role !== 'fin').reduce((n, o) => n + o.cost, 0);
  return {
    flights: flightsAvailable(s),
    flightsMax: planes(s).length * flightsPerPlane(s.tier),
    houses: housesRentable(s),
    housesMax: houses(s).length,
    budget: approved,
  };
}

export const openOrders = (s: IslandState, role: Role) =>
  s.orders
    .filter((o) => o.role === role && o.status !== 'cancelled' && (o.status !== 'done' || o.result?.week === s.week))
    .sort((a, b) => statusRank(a) - statusRank(b) || b.tier - a.tier);

function statusRank(o: Order) {
  return { countered: 0, ready: 1, waiting_part: 2, pending: 3, approved: 3, done: 5, cancelled: 6 }[o.status];
}

/** the mechanic puzzles that read the airplane's own records (PuzzleContext.aircraft) */
const READS_AIRCRAFT: ReadonlySet<PuzzleId> = new Set<PuzzleId>(['ipc', 'logbook']);

/** the island's own airplane (src/sim/chain.ts): derived from the seed, with its alteration, built once per device */
export { islandAircraft };

/** puzzles that work to the task card's numbers (both effectivities printed; the mechanic matches S/N and SB status) */
const CARD_DRIVEN: ReadonlySet<PuzzleId> = new Set<PuzzleId>(['torque', 'hydraulics']);

export function launchFor(s: IslandState, o: Order, role: Role, assist = false): PuzzleLaunch {
  const p = s.players[role];
  const grace = !assist && p && s.week <= p.graceUntil;
  const asset = s.assets.find((a) => a.id === o.assetId);
  // lending a hand always plays at expert level: real trade knowledge is the gate
  const tier = launchTier(s, o, role, assist);
  // a real job at tier 2+: no verdict now, it shows up later
  const blind = isBlind(s, o, role, assist);
  // the part chain: this sign-off will find a part it can't finish without (seeded, never by the score)
  const stops = !assist && chainWouldOpen(s, o, role);
  const reporter = o.report ? (s.players[o.report.by]?.name ?? ROLE_LABEL[o.report.by]) : null;
  const reward = asset ? `up to +${Math.round(o.gain * (1 + Math.min(15, p?.perfects ?? 0) / 100))} on ${asset.name}` : o.leak ? `up to ${`$${o.leak}`} recovered` : undefined;
  // a repair or a report names the assembly / part / device it's about; otherwise the kind says it.
  // job: the crack hunt picks the part by it (spar, wheel half, deck beam); the ground
  // power start ('gpustart') runs a piston single through tier 3 and a turbine single
  // from tier 4. assetName: the hydraulic servicing placard names the aircraft.
  const context: PuzzleLaunch['context'] = { assetName: asset?.name, leak: o.leak, job: o.job ?? o.kind };
  if (o.kind === 'project' && o.puzzle === 'auction') {
    // floatplane deposit: same auction, bigger stakes
    context.market = { low: 3000, high: 7000, fair: 4800, cap: Math.min(5600, Math.max(0, s.cash - ECON.freezeBelow)) };
  } else if (o.kind === 'auction' && o.lot) {
    // the broker's real lot (17.3): fair is the lot at the broker's price x 0.85; the bid is capped at 92% of the lot
    // at list, and never below the freeze line (the auction puzzle's lotMarket reads it as it is)
    const fair = Math.max(20, o.lot.fair);
    const low = Math.round(fair * 0.6);
    const cap = Math.max(0, Math.min(Math.round(o.lot.list * 0.92), Math.round(spendable(s) - ECON.freezeBelow)));
    context.market = { low, high: Math.round(Math.max(fair * 1.3, cap * 1.08, low + 60)), fair, cap };
  } else if (o.kind === 'auction') {
    const { low, high } = ECON.partMarket;
    const f = 1 + 0.1 * (s.tier - 1);
    const fair = Math.round(((low + high) / 2) * f);
    context.market = { low: Math.round(low * f), high: Math.round(high * f), fair, cap: Math.min(Math.round(listPrice(s) * 0.92), Math.max(0, s.cash - ECON.freezeBelow)) };
  }
  if (o.puzzle === 'forecast') Object.assign(context, forecastContext(s));
  // paperwork on a plane: the island's own airplane (twin / cargo / float), its records as they are
  if (asset?.kind === 'plane' && READS_AIRCRAFT.has(o.puzzle)) context.aircraft = islandAircraft(s.seed, asset);
  // the part chain's lookup and research: this part, as the job found it (and which job, who, when)
  const ch = openChain(s);
  if (ch && o.chain && o.chain.id === ch.id && (o.chain.step === 'lookup' || o.chain.step === 'research'))
    context.chain = { step: o.chain.step, tag: ch.tag, item: ch.item, found: ch.found ?? '', from: ch.title, by: ch.by, week: ch.week };
  // the chain's circuit check on the airplane: what is really wrong (the meter's readings follow it)
  if (ch && o.chain && o.chain.id === ch.id && o.chain.step === 'bench' && ch.bench) context.bench = { fault: ch.bench.again ? 'wiring' : ch.bench.fault };
  // the job flow's check on an alert's unit: the alert's cause says (the wiring cause, or the unit)
  if (o.bench) {
    const al = s.alerts?.find((x) => x.id === o.bench);
    if (al) context.bench = { fault: al.bench?.again || al.kind === 'wiring' ? 'wiring' : 'unit' };
  }
  // the job flow: the lines the tech chose (display only), and the chosen task's card
  if (o.flow && !o.flow.wired) {
    context.pick = o.flow.pick.map((l) => {
      const x = itemById(l.item);
      return { pn: x?.pn ?? l.item, nomen: x?.nomen ?? l.item, qty: l.qty, ...(l.slot ? { slot: l.slot } : {}), ...(x?.spec ? { spec: x.spec } : {}) };
    });
    const t = taskById(o.flow.task);
    if (t?.job) context.job = t.job;
  }
  // the analyst's desk: the auction's real lot, the invoice match's real POs
  if (o.kind === 'auction' && o.lot) {
    context.lot = {
      fair: o.lot.fair,
      list: o.lot.list,
      lines: o.lot.lines.map((l) => {
        const x = itemById(l.item);
        // at list: the catalog's unit price (its price is the pack's) times the units in the lot
        return { pn: x?.pn ?? l.item, nomen: x?.nomen ?? l.item, qty: l.qty, list: Math.round((x ? priceAt(x) : 0) * l.qty) };
      }),
    };
  }
  if (o.puzzle === 'invoice') {
    const inv = invoiceContext(s);
    if (inv) context.invoice = inv;
  }
  // the manual: torque and servicing values come from the plane's own task card (marked while the game teaches)
  if (asset?.kind === 'plane' && o.role === 'mech' && CARD_DRIVEN.has(o.puzzle)) {
    const card = manualCard(islandAircraft(s.seed, asset), o.job ?? o.kind, o.puzzle, tier <= 2);
    if (card) context.card = card;
  }
  // a ground power start runs off the cart hooked up to that plane, as charged as it is, on that
  // plane's own airframe and placard (the cargo single is the turbine; the amphibian sits on its floats)
  const cart = o.puzzle === 'gpu' ? cartOn(s, o.assetId) : undefined;
  if (cart) context.cart = { name: cart.name, charge: cart.charge };
  if (o.puzzle === 'gpu' && asset?.kind === 'plane') {
    const ac = islandAircraft(s.seed, asset);
    const ep = externalPower(ac);
    context.job = ep.turbine ? 'gpuTurbine' : 'gpuPiston';
    context.plane = { name: asset.name, reg: ac.registration, designation: ac.designation, turbine: ep.turbine, floats: ep.floats, ampMax: ep.ampMax, wing: ep.wing, battery: ep.battery };
  }
  // a start (or radio work) leaves its cart on the plane, off the charger: say so on the result
  const hooked = needsCart(o.kind) && asset ? cartOn(s, asset.id) : undefined;
  const drain = o.kind === 'gpustart' ? (asset?.model === 'cargo' ? GSE.drain.turbine : GSE.drain.piston) : GSE.avionicsDrain;
  const after = hooked && asset && !assist ? `${hooked.name} is still on ${asset.name} (${Math.round(Math.max(0, hooked.charge - drain))}%): plug it back in on the charger.` : undefined;
  return {
    puzzle: o.puzzle,
    seed: hashSeed(o.seed, role),
    tier,
    ...(after ? { after } : {}),
    tools: p && !assist ? toolsFor(role, p.xp) : [],
    title: assist ? `Lending a hand · ${o.title}` : o.title,
    expert: assist,
    subtitle: asset?.name ?? (reporter ? `${reporter}'s report` : grace ? 'new-crew difficulty' : assist ? 'outside your trade' : undefined),
    context,
    reward,
    rework: !assist && isRework(o, 0, blind),
    blind,
    signoff: blind
      ? {
          by: p?.name ?? ROLE_LABEL[role],
          week: s.week,
          ...signoffWords(o, role),
          ...(stops ? { header: 'Work stopped', stamp: 'Part needed', stopped: true } : {}),
          later: stops
            ? `The job found a part it can't be finished without: ${asset?.name ?? 'the plane'} is grounded until it's on. Next: look it up in the IPC.`
            : o.chain?.step === 'lookup'
              ? 'What you ordered shows when it arrives; a part sent for research, when engineering answers.'
              : o.chain?.step === 'research'
                ? 'Engineering answers when the week resolves (after the analyst approves the review fee).'
                : o.chain?.step === 'bench'
                  ? 'Your call shows when the plane runs: a unit bought that makes no difference, or one left in service that still doesn’t work.'
                  : asset
            ? `How good it was shows up later: in ${asset.name}'s health, an inspection, or an incident.`
            : o.report
              ? `How good it was shows up later: if the fix doesn't hold, ${reporter} will be back.`
              : o.kind === 'project'
                ? 'How good it was shows up later: in what the crew project builds.'
                : 'How good it was shows up later: in the week’s numbers.',
        }
      : undefined,
  };
}

/** How each trade closes a job: an A&P's logbook entry, an electrician's work order, the analyst's file. */
function signoffWords(o: Order, role: Role): { header: string; stamp: string } {
  if (o.chain?.step === 'bench') return { header: 'Circuit check', stamp: 'Handed in' };
  if (role === 'fin') return { header: 'Filed', stamp: o.report ? 'Corrected' : 'Posted' };
  if (role === 'elec') return { header: 'Work order closed', stamp: o.kind === 'codeprep' ? 'Ready for inspection' : 'Work complete' };
  const kind = o.repair?.defect.job ?? o.kind;
  if (kind === 'wb' || o.kind === 'wb') return { header: 'Load sheet', stamp: 'Released' };
  if (o.kind === 'inspect100' || o.kind === 'corrosion' || o.kind === 'spar') return { header: 'Logbook entry', stamp: 'Airworthy' };
  if (o.report || o.kind === 'project') return { header: 'Shop log', stamp: 'Work complete' };
  // the part chain's paperwork
  if (o.chain?.step === 'lookup') return { header: 'IPC lookup', stamp: 'Handed in' };
  if (o.chain?.step === 'research') return { header: 'Logbook research', stamp: 'Handed in' };
  // a ground power start is line work, not maintenance: no logbook entry, no return to service
  if (o.kind === 'gpustart') return { header: 'Line log', stamp: 'Work complete' };
  return { header: 'Logbook entry', stamp: 'Return to service' };
}

export type MateStatus = 'done' | 'playing' | 'waiting' | 'empty' | 'week0';
export function mateStatus(s: IslandState, r: Role): MateStatus {
  const p = s.players[r];
  if (!p) return 'empty';
  if (s.week === 0) return p.week0Done ? 'done' : 'week0';
  const t = s.turns[r];
  if (t?.ended) return 'done';
  if (t && t.done > 0) return 'playing';
  return 'waiting';
}

export const roleName = (r: Role) => ROLE_LABEL[r];

export function assetLine(s: IslandState, id: string | null) {
  return s.assets.find((a) => a.id === id)?.name ?? '';
}
