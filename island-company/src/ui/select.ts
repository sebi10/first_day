// UI-side derived data: who is blocking whom, what to launch for an order.
import type { PuzzleId, PuzzleSite } from '../puzzles/types';
import { alertFlags, alertShort, causeOf, liveAlerts, siteOf, soleGuest } from '../sim/alerts';
import { benchMove, chainMove, islandAircraft, manualCard, openChain } from '../sim/chain';
import { externalPower } from '../sim/aircraft';
import { CABLE_REPORT, ECON, FLOAT_AUCTION, GSE, LATE, MODELS, REPORT_BY_KEY, ROLE_LABEL } from '../sim/data';
import { chainWouldOpen, forecastContext, listPrice } from '../sim/engine';
import { alertAog, cartOn, flightsAvailable, flightsPerPlane, gridFirstAlert, groundsFrom, gseCarts, hazardOn, houses, housesRentable, isBlind, isRework, lateGame, launchTier, needsCart, openReports, planes, powered, reopenBeforeGrid, reportCap, subCharterNeed, subCharterOn } from '../sim/econ';
import { cardOf, flowStage } from '../sim/flow';
import { itemById, priceAt } from '../sim/items';
import { toolsFor } from '../sim/progression';
import { hashSeed } from '../sim/rng';
import { invoiceContext, reqValue, stockFlags, urgentJob } from '../sim/stock';
import { spendable } from '../sim/ledger';
import { taskById } from '../sim/tasks';
import { ROLES, type Action, type Alert, type Asset, type IslandState, type OpsRole, type Order, type PartChain, type Role } from '../sim/types';
import type { PuzzleLaunch } from './puzzlehost';
import { flagCheck } from '../sim/checks';
import { downtimeOf, houseRentable, houseWeekRevenue, rentFactor, tierDef } from '../sim/econ';
import { invValue, runway } from '../sim/ledger';
import { binsInUse, binsTotal, carryCost } from '../sim/stock';
import { INSURANCE, REPORTS } from '../sim/data';
import type { ObjectKind, ObjectRef, StationId } from './objects';

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
  if (s.cash < 0 && s.receivership > 0) out.push({ from: 'fin', to: 'mech', text: 'cash below $0: the receiver funds only safety-critical work, up to $1,500 a week' });
  else if (s.cash < 0) out.push({ from: 'fin', to: 'mech', text: 'cash below $0: nothing gets approved until cash comes in' });
  else if (s.cash < ECON.freezeBelow) out.push({ from: 'fin', to: 'mech', text: 'cash under $2,000: only safety-critical work gets approved' });
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
const upperFirstWord = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** scheduled freight on a card in words: a shipment of its own, or riding one already on its way (3.6) */
export function shipWords(f: { cost: number; rides?: string; shipments?: number }): string | undefined {
  if (f.cost > 0) return (f.shipments ?? 1) > 1 ? `+${usdWords(f.cost)} freight: ${f.shipments} shipments of its own (one per supplier and carrier)` : `+${usdWords(f.cost)} freight: its own shipment`;
  return f.rides ? `rides with ${f.rides}'s shipment: no extra freight` : undefined;
}
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

/** does this chain ground its plane: every legacy chain does; a flow-opened one only when the job's alert grounds it */
export function chainGrounds(s: IslandState, c: PartChain): boolean {
  if (!c.flow) return true;
  const al = chainAlert(s, c);
  return !!al && alertAog(s, c.assetId)?.id === al.id;
}

/** the job flow's alert behind a chain it opened (the research branch) */
function chainAlert(s: IslandState, c: PartChain): Alert | undefined {
  const job = s.orders.find((o) => o.id === c.orderId);
  return job?.flow ? s.alerts?.find((a) => a.id === job.flow!.alert) : undefined;
}

/**
 * What the chain's plane does meanwhile, from the state (13): "Cargo C-7 is AOG" only when it's grounded (the only
 * guest plane too); a placard "flies on its MEL placard to wk 6"; otherwise it "flies meanwhile"
 */
export function chainTag(s: IslandState, c: PartChain): string {
  const name = s.assets.find((a) => a.id === c.assetId)?.name ?? 'the plane';
  if (chainGrounds(s, c)) return `${name} is AOG`;
  const al = chainAlert(s, c);
  if (al?.mel && al.mel.until >= s.week) return `${name} flies on its MEL placard to wk ${al.mel.until}`;
  return `${name} flies meanwhile`;
}

/** the chain's step a tech opens from the job, the banner, the Dock and Your move: the lookup, the logbooks, the circuit check */
export function chainStepOrder(s: IslandState, c: PartChain | null = openChain(s)): { order: string; who: Role; label: string } | null {
  if (!c?.stepId) return null;
  const m = chainMove(s, c);
  const o = s.orders.find((x) => x.id === c.stepId);
  if (!m.who || !o || o.status === 'done' || o.status === 'cancelled' || o.role !== m.who) return null;
  const label = c.step === 'lookup' ? 'Open the IPC ▸' : c.step === 'research' ? 'Open the logbooks ▸' : c.step === 'check' ? 'Meter the circuit ▸' : c.step === 'install' ? 'Open the job ▸' : null;
  return label ? { order: o.id, who: m.who, label } : null;
}

/** a chain step in a word or two, for a chip ("Seb: logbooks") */
const CHAIN_SHORT: Partial<Record<PartChain['step'], string>> = { lookup: 'IPC', research: 'logbooks', check: 'meter it', buy: 'approve the part', fee: 'approve the fee', install: 'install' };

export function crossMoves(s: IslandState): CrossMove[] {
  const out: CrossMove[] = [];
  const ch = openChain(s);
  if (ch) {
    const asset = s.assets.find((a) => a.id === ch.assetId);
    // "look up the brake linings in the IPC (Cargo C-7 is AOG)", "research the com radio in … (Twin N-12 flies meanwhile)"
    const tag = chainTag(s, ch);
    const grounds = chainGrounds(s, ch);
    const add = (m: ReturnType<typeof chainMove>, key: string) => {
      // the analyst waits on the mechanic's paperwork (nothing to buy yet); the mechanic on the analyst and on the electrician's check
      const waits: Role | null = m.who === 'fin' ? 'mech' : m.who === 'mech' ? 'fin' : m.who === 'elec' ? 'mech' : null;
      const text = m.text.endsWith(')') ? `${m.text.slice(0, -1)}; ${tag})` : `${m.text} (${tag})`;
      if (m.who && waits && s.players[m.who] && s.players[waits]) out.push({ key, kind: 'chain', who: m.who, waits, text, what: `${asset?.name ?? 'A plane'}${grounds ? ' AOG' : ''}: ${ch.item}`, short: m.short });
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
        return { who: m.who, chip: m.who ? `${nameOf(s, m.who)}: ${CHAIN_SHORT[ch.step] ?? m.short}` : m.chip, text: m.text };
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

/** what an alert does to its asset now, in words (the grounded plane, its guests on the sub-charter if it's the only guest plane; the closed house) */
function bites(s: IslandState, o: Order): string | null {
  if (!urgentJob(s, o)) return null;
  const asset = s.assets.find((x) => x.id === o.assetId);
  if (!asset) return null;
  if (asset.kind === 'plane') return `${asset.name} is AOG${soleGuest(s, asset.id) ? ' (its guests on the sub-charter)' : ''}`;
  return `${asset.name} is closed`;
}

/**
 * What an airworthiness alert does to its plane past due, in words: "is AOG", and for the only guest plane "is
 * grounded and a mainland sub-charter flies the guests (about $540 a week)" (a week of it on a clear sky)
 */
export function groundWords(s: IslandState, a: Alert): string {
  const sub = subCharterNeed(s, a.assetId, 'clear', groundsFrom(s, a));
  return sub ? `is grounded and a mainland sub-charter flies the guests (${sub.flights > 0 ? `about ${usdWords(sub.usd)} a week` : `${usdWords(sub.fee)} a flight`})` : 'is AOG';
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
/** A0 (e) grid first: the alert is on the island grid's feed while the grid is at real risk at tier 4+ (every house hangs off it) */
const onGridFirst = (s: IslandState, a: Alert) => gridFirstAlert(s, a);
/** (e, review round 1) a code notice on a house whose inspection has lapsed, while the grid holds at 48+: it reopens the house at this resolve, so it goes before grid first */
const reopensFirst = (s: IslandState, a: Alert) => a.src === 'code' && reopenBeforeGrid(s, s.assets.find((x) => x.id === a.assetId));
const rank = (s: IslandState, a: Alert) => {
  const f = alertFlags(s, a);
  return f.hazard ? 0 : f.aw ? 1 : reopensFirst(s, a) ? 1.25 : onGridFirst(s, a) ? 1.5 : 2;
};

/**
 * the tech's "Your move" rows: new alerts, ready jobs, stopped jobs; due now first, then hazards and airworthiness, then
 * by due week. From tier 4 the grid's feed at real risk counts as due now and ranks after hazards and airworthiness, so
 * it goes before a code prep (A0 e: grid first; the Dock's button is the first row), unless the prep reopens a closed
 * house at this resolve and the grid holds at 48 or more
 */
export function yourMoves(s: IslandState, role: OpsRole): { alert: Alert; order?: Order }[] {
  const rows: { alert: Alert; order?: Order }[] = [];
  for (const a of liveAlerts(s)) {
    if (a.role !== role || a.status === 'closed') continue;
    const m = flowMove(s, a);
    if (m.who !== role) continue;
    const o = a.order ? s.orders.find((x) => x.id === a.order) : undefined;
    rows.push({ alert: a, order: o && o.status !== 'cancelled' ? o : undefined });
  }
  const now = (a: Alert) => a.due <= s.week || onGridFirst(s, a);
  return rows.sort((x, y) => Number(now(y.alert)) - Number(now(x.alert)) || rank(s, x.alert) - rank(s, y.alert) || x.alert.due - y.alert.due || (x.alert.id < y.alert.id ? -1 : 1));
}

/**
 * The ticks on an asset's health bar (review round 1: the rules had no marks in the game): the grid's 40 (under it the
 * grid is down) at every tier; from tier 4 every asset's 70 (at or above it, 3 a week of wear, not 5), the grid's 55
 * (under it, and at risk, grid first) and the generator's 50 (under it, it can't carry the houses)
 */
export function healthMarks(s: IslandState, a: Pick<Asset, 'kind'>): { at: number; title: string }[] {
  const out: { at: number; title: string }[] = [];
  const late = lateGame(s);
  if (late) out.push({ at: LATE.healthyDecay.at, title: `At ${LATE.healthyDecay.at} or better it wears ${LATE.healthyDecay.decay} a week untouched, not ${ECON.decay}` });
  if (a.kind === 'grid') {
    if (late && LATE.gridFirst) out.push({ at: LATE.gridFirst, title: `Under ${LATE.gridFirst}, at risk: grid first` });
    out.push({ at: 40, title: 'Under 40 the grid is down' });
  }
  if (late && a.kind === 'generator') out.push({ at: 50, title: "Under 50 it can't carry the houses" });
  return out;
}

/** `object`: an object's inspect sheet (stage 2, docs/EXPANSION.md 2.5; home.tsx opens it) */
export type DockTarget = { alert: string } | { order: string } | { desk: 'approvals' | 'stock' } | { object: ObjectRef };

/**
 * This week's work that earns the week's money but isn't an alert (16): the charter load sheet (no sheet, half a
 * plane's charters stay on the ramp) and a ground power start on a weak battery (no cart on it, its first flight is
 * lost). Your move, the Dock and End turn show it with what skipping it costs.
 */
export function revenueMoves(s: IslandState, role: Role): { order: Order; label: string; cost: string }[] {
  if (role !== 'mech') return [];
  const out: { order: Order; label: string; cost: string }[] = [];
  for (const o of s.orders) {
    if (o.role !== role || o.status !== 'ready' || (o.kind !== 'wb' && o.kind !== 'gpustart')) continue;
    const name = assetName(s, o.assetId) ?? 'the plane';
    if (o.kind === 'wb') out.push({ order: o, label: `Load sheet · ${name}`, cost: `No load sheet: half of ${name}'s charters stay on the ramp.` });
    else out.push({ order: o, label: `Ground power start · ${name}`, cost: `${name}'s battery is weak: without a charged cart on it, its first flight is lost.` });
  }
  return out.sort((a, b) => Number(a.order.kind === 'wb') - Number(b.order.kind === 'wb'));
}

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
  // a job over this turn's limit (a trade's per-turn cap) isn't offered as Start: the next row that can go is
  const rows = yourMoves(s, role as OpsRole).filter((x) => !(x.order?.status === 'ready' && capNow(s, role)?.full));
  const row = rows[0];
  // the week's revenue work comes before a row that isn't due yet: a load sheet or a ground power start this week
  const rev = revenueMoves(s, role)[0];
  if (rev && (!row || row.alert.due > s.week)) return { label: `${rev.label} ▸`, target: { order: rev.order.id } };
  if (!row) return null;
  const where = assetName(s, row.alert.assetId);
  // the research branch: the chain's step is the move (the IPC, the logbooks), straight to it
  if (flowStage(s, row.alert) === 'research') {
    const step = chainStepOrder(s);
    if (step && step.who === role) return { label: `${step.label.replace(' ▸', '')}${where ? ` · ${where}` : ''} ▸`, target: { order: step.order } };
  }
  if (row.order?.status === 'ready') return { label: `Start: ${row.order.title}${where ? ` · ${where}` : ''} ▸`, target: { order: row.order.id } };
  return { label: `Next: ${alertShort(s, row.alert)}${where ? ` · ${where}` : ''} ▸`, target: { alert: row.alert.id } };
}

/** the End-turn confirm's flow lines (16); home adds today's ready jobs, owed moves and carts */
/** the mechanic can still ask for the one MEL extension: placarded, not extended or asked yet, its placard runs out at this resolve or ran out at the last one (the engine's melExtend window) */
export const canAskMel = (s: IslandState, a: Alert) => a.role === 'mech' && !!a.mel && !a.mel.ext && !a.mel.ask && a.mel.until <= s.week && a.mel.until >= s.week - 1 && a.status !== 'closed';

/** a line on the End turn sheet; `melAsk`: the alert whose one MEL extension the mechanic can ask for from the line */
export type EndCheck = { text: string; urgent: boolean; standing?: boolean; melAsk?: string };

export function endTurnChecks(s: IslandState, role: Role): EndCheck[] {
  const out: EndCheck[] = [];
  if (role === 'fin') {
    const cards = s.orders.filter((o) => o.flow && o.status === 'pending' && o.lastDeferredWeek !== s.week);
    const reqs = (s.reqs ?? []).filter((r) => r.status === 'open' && r.deferredWeek !== s.week);
    const limit = standingLimit(s);
    if (cards.length + reqs.length > 0) {
      const who = [...new Set([...cards.map((o) => o.role), ...reqs.map((r) => r.role)])].map((r) => nameOf(s, r)).join(', ');
      out.push({
        text: `${waitWords(cards.length, reqs.length)} ${cards.length + reqs.length > 1 ? 'wait' : 'waits'} on you (${who}). After you end your turn, anything that comes in goes through tonight up to your standing limit (${usdWords(limit)}); the rest waits for next week.`,
        urgent: cards.some((o) => urgentJob(s, o)),
      });
    }
    // the techs play after you: their cards come in late (8.5). Safety work due this week or next goes through
    // anyway; the rest over the limit waits a week
    const later = (['mech', 'elec'] as const).filter((r) => s.players[r] && !s.turns[r]?.ended).map((r) => nameOf(s, r));
    if (later.length)
      out.push({
        text: `${later.join(' and ')} ${later.length > 1 ? "haven't" : "hasn't"} played yet: a card over ${usdWords(limit)} that isn't safety work due this week or next will wait a week. Raise the limit if you'd rather it went through.`,
        urgent: false,
        standing: true,
      });
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
      else if (f.aw && asset?.kind === 'plane' && !(a.mel && a.mel.until >= s.week)) {
        const bite = groundWords(s, a);
        const fin = nameOf(s, 'fin');
        // what the MEL still allows: a placard (category C), the one extension, or only the fix (a safety call grounds
        // it too, so it's no way out: fix round 1)
        const text = !a.mel
          ? f.mel === 'C'
            ? `Fix it or placard it (MEL C) this week, or from this resolve ${name} ${bite}: ${alertShort(s, a)}.`
            : `Fix it this week (no MEL relief), or from this resolve ${name} ${bite}: ${alertShort(s, a)}.`
          : a.mel.ext || a.mel.until < s.week - 1
            ? `The MEL placard has run out: fix it this week, or ${name} ${bite}: ${alertShort(s, a)}.`
            : a.mel.ask
              ? `${fin} hasn't authorized the MEL extension yet: fix it, or ${name} ${bite} unless ${fin} does: ${alertShort(s, a)}.`
              : `The MEL placard ran out: ask ${fin} to authorize the one-time extension, or fix it, or ${name} ${bite}: ${alertShort(s, a)}.`;
        out.push({ text, urgent: true, ...(canAskMel(s, a) ? { melAsk: a.id } : {}) });
      }
      // a placard running out at this resolve with the fix not ready: the one extension is the mechanic's to ask for
      if (a.mel && a.mel.until === s.week && !a.mel.ext && !a.mel.ask && o?.status !== 'ready')
        out.push({ text: `${name}'s MEL placard runs out at this resolve: fix it, or ask ${nameOf(s, 'fin')} to authorize the one-time extension.`, urgent: false, ...(canAskMel(s, a) ? { melAsk: a.id } : {}) });
      continue;
    }
    if (a.status === 'open') out.push({ text: `Plan it now so the parts come in time: ${alertShort(s, a)} on ${name} (due wk ${a.due}).`, urgent: a.due <= s.week + 1 });
  }
  // the week's revenue work, by what skipping it costs (a weak battery's start: home's cart line says it)
  for (const m of revenueMoves(s, role).filter((x) => x.order.kind === 'wb')) out.push({ text: m.cost, urgent: true });
  return out.sort((x, y) => Number(y.urgent) - Number(x.urgent));
}

/** the standing limit a week: late cards and requisitions approved at the resolve (8.5); absent, the work budgets' sum */
export const standingLimit = (s: IslandState) => s.standing ?? (s.autoBudget.mech ?? 0) + (s.autoBudget.elec ?? 0);

/**
 * A card that comes in after the analyst ended the turn (8.5), in the tech's words: the standing approval takes it
 * tonight when it fits the limit (and the cash), or it waits for the analyst. null while the analyst's turn is open.
 */
export function standingWords(s: IslandState, total: number, safety = false, lateSafe = false, grid = false): string | null {
  if (!s.turns.fin?.ended) return null;
  const fin = nameOf(s, 'fin');
  const limit = standingLimit(s);
  // safety work due this week or next goes through whatever the limit, cash permitting (the floor is $0)
  if (lateSafe)
    return spendable(s) - total < 0
      ? `${fin} has ended the turn, and there isn't the cash for it: it waits for ${fin}'s approval.`
      : `${fin} has ended the turn: it goes through tonight on the standing approval whatever the limit (${grid ? 'the grid first' : 'safety work due this week or next'}).`;
  if (total > limit) return `${fin} has ended the turn, and it's over the standing limit (${usdWords(limit)}): it waits for ${fin}'s approval.`;
  if (spendable(s) - total < (safety ? 0 : ECON.freezeBelow)) return `${fin} has ended the turn, and spendable cash is under the freeze: it waits for ${fin}'s approval.`;
  return `${fin} has ended the turn: it goes through tonight on the standing approval (up to ${usdWords(limit)}) unless deferred.`;
}

/**
 * The standing approval takes this alert's late card whatever the limit (8.5, the engine's lateSafe): it grounds its
 * plane (the only guest plane too) or closes its house at this week's resolve or next week's
 */
export function lateSafeAlert(s: IslandState, a: Alert): boolean {
  const asset = s.assets.find((x) => x.id === a.assetId);
  if (!asset) return false;
  // the grid's feed at real risk goes through like safety work due now (A0 e, review round 1: the engine's standing approval)
  if (gridFirstAlert(s, a)) return true;
  if (asset.kind === 'plane') return [s.week, s.week + 1].some((w) => alertAog(s, asset.id, w)?.id === a.id);
  if (asset.kind === 'house') {
    const h = hazardOn(s, asset.id);
    return h?.id === a.id && !h.safe;
  }
  return false;
}

/** open a job-flow target: B's ops panel and C's desk listen for it */
export function openTarget(t: DockTarget): void {
  if (typeof window === 'undefined') return;
  // the desk is a chunk of its own (lazy.tsx): a desk tab asked for before it has loaded opens once it has
  deskAsked = 'desk' in t ? t.desk : null;
  window.dispatchEvent(new CustomEvent('ic:open', { detail: t }));
}
let deskAsked: Extract<DockTarget, { desk: unknown }>['desk'] | null = null;
/** the desk tab asked for (by the Dock's Next) before the desk was on screen, once */
export function takeDeskAsked() {
  const d = deskAsked;
  deskAsked = null;
  return d;
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
    const aog = c ? ` ${chainGrounds(after, c) ? `${after.assets.find((x) => x.id === c.assetId)?.name ?? 'A plane'} AOG` : upperFirstWord(chainTag(after, c))}: ${chainMove(after, c).chip}.` : '';
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
    // grounded only when it is (a flow-opened chain's plane may fly on its placard, or meanwhile)
    const grounds = chainGrounds(after, ca);
    const state = grounds ? `${plane} is grounded for ${ca.item}` : `${upperFirstWord(chainTag(after, ca))}; the job waits for ${ca.item}`;
    push(`${after.name}: ${plane}${grounds ? ' AOG' : ''}`, who ? `${state}. ${who}, your move: ${m.text}.` : `${state}: ${m.text}.`);
  } else if (cb && !ca && after.chain?.step === 'done' && after.chain.story) push(`${after.name}: back in service`, after.chain.story);
  // the electrician's check came up beside it (a new chain on an electrical unit, or the new unit made no difference)
  const ba = ca ? benchMove(after, ca) : null;
  if (ca && ba && (!cb || cb.id !== ca.id || !benchMove(before, cb))) {
    const plane = after.assets.find((x) => x.id === ca.assetId)?.name ?? 'A plane';
    const grounds = chainGrounds(after, ca);
    push(`${after.name}: ${plane}${grounds ? ' AOG' : ''}`, `${grounds ? `${plane} is grounded for ${ca.item}` : upperFirstWord(chainTag(after, ca))}. ${name('elec')}, your move: ${ba.text}`);
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
    /** the mainland sub-charter's flights this week (the only guest plane down) */
    subFlights: subCharterOn(s)?.flights ?? 0,
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

/** a house room as the puzzles label it (a panel, a pad or the generator house has no room of its own) */
const PUZZLE_ROOM: Partial<Record<string, string>> = { bath: 'Bathroom', kitchen: 'Kitchen', bedroom: 'Bedroom', living: 'Living room', laundry: 'Laundry', outdoor: 'Porch', hall: 'Hall' };

/**
 * The alert's circuit for an electrician's flow job (the trace and the meter build their scenario from it): the
 * room and the breaker; one receptacle on an individual circuit; a warm plate (a live high-resistance joint, not
 * a dead run); a loose neutral (a flicker: it shows under load)
 */
export function puzzleSite(s: IslandState, o: Order): PuzzleSite | undefined {
  if (!o.flow || o.role !== 'elec') return undefined;
  const al = s.alerts?.find((x) => x.id === o.flow!.alert);
  const site = al ? siteOf(s, al) : null;
  if (!al || !site) return undefined;
  const room = PUZZLE_ROOM[site.deviceRoom ?? site.room];
  const warm = al.sym === 'E_WARM_OUTLET' || al.sym === 'E_SWITCH_WARM' || al.sym === 'E_APPLIANCE';
  const neutral = !!causeOf(al)?.neutral || al.sym === 'E_FLICKER';
  return {
    ...(room ? { room } : {}),
    amps: site.amps,
    ...(site.single ? { single: true, ...(site.appliance ? { appliance: site.appliance } : {}) } : {}),
    ...(al.sym === 'E_SWITCH_WARM' ? { device: 'switch' as const } : {}),
    fault: warm ? 'warm' : neutral ? 'neutral' : 'dead',
  };
}

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
    // floatplane deposit: same auction, bigger stakes (outbid, the part stays open for next week's sale)
    context.market = { low: FLOAT_AUCTION.low, high: FLOAT_AUCTION.high, fair: FLOAT_AUCTION.fair, cap: Math.min(FLOAT_AUCTION.cap, Math.max(0, s.cash - ECON.freezeBelow)) };
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
  // the electrician's puzzles play the alert's own circuit: its room, its breaker, its complaint
  const site = puzzleSite(s, o);
  if (site) context.site = site;
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
              : o.kind === 'project' && o.puzzle === 'auction'
                ? 'Won: the deposit leaves the bank, and how good the buy was shows in what the crew project builds. Outbid: nothing is bought, and the next floatplane comes up at next week’s auction.'
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

// ---------------------------------------------------------------------------
// Stage 2 (docs/EXPANSION.md 6.2, 6.3, 14.3): the selectors the inspect sheets read. Home only; never hidden state
// (no alert cause, no defect, never a quick check's truth).

/**
 * An asset's money: `revenue` is the week it carries this week, projected (a house's booking at the nightly rate; a
 * plane's guests and tours, what a week on the ground would lose; the island doc keeps no per-asset revenue history).
 * `parts` + `labour` is exact: everything booked on the asset over the last `weeks` ledger weeks (this one included);
 * the split between them is estimated from each week's island-wide labour share (the ledger keeps one sum per asset).
 */
export function assetPnl(s: IslandState, assetId: string, weeks: number): { revenue: number; parts: number; labour: number; lease?: number; hull?: number; fuel?: number } {
  const a = s.assets.find((x) => x.id === assetId);
  if (!a) return { revenue: 0, parts: 0, labour: 0 };
  let revenue = 0;
  if (a.kind === 'house') revenue = houseRentable(s, a) ? houseWeekRevenue(s, a) * rentFactor(s, a) : 0;
  else if (a.kind === 'plane' && !MODELS[a.model]?.cargo) revenue = downtimeOf(s, a.id).usd;
  let parts = 0;
  let labour = 0;
  for (const row of s.ledger ?? []) {
    if (row.w <= s.week - Math.max(1, weeks) || row.w > s.week) continue;
    const spent = row.as?.[assetId] ?? 0;
    if (!spent) continue;
    const lab = row.sp.labor ?? 0;
    const share = lab + (row.usedV ?? 0) > 0 ? lab / (lab + (row.usedV ?? 0)) : 1;
    labour += spent * share;
    parts += spent * (1 - share);
  }
  return { revenue: Math.round(revenue), parts: Math.round(parts), labour: Math.round(labour) };
}

/** the open alerts on an asset, by trade (any stage: a new one, a job not signed off yet) */
export function openAlertsOn(s: IslandState, assetId: string): { mech: number; elec: number } {
  const out = { mech: 0, elec: 0 };
  for (const a of liveAlerts(s)) if (a.assetId === assetId) out[a.role]++;
  return out;
}

/** Report a problem on an asset (6.5): whether this seat can flag it now, and to whom (the words when it can't) */
export function flaggable(s: IslandState, role: Role, assetId: string): { ok: true; to: OpsRole } | { ok: false; why: string } {
  return flagCheck(s, role, assetId);
}

/** the reports about a fixture (6.3, 6.5): hangar trouble, the office's outlets */
const FIXTURE_REPORTS: Partial<Record<ObjectKind, string[]>> = {
  hangar: ['hangarLights', 'compressor', 'charger', 'hangarGpu', 'gpuCable'],
  office: ['officeOutlets'],
  fuel: ['avgas'],
  dock: [],
};

/** a fixture's facts for a seat (6.3): what it shows, in the seat's words. Home only in stage 2 (a station's: none yet) */
export function fixtureFacts(s: IslandState, kind: ObjectKind, st: StationId, role: Role): { lines: string[] } {
  if (st !== 'home') return { lines: [] };
  const lines: string[] = [];
  const reports = openReports(s).filter((o) => (FIXTURE_REPORTS[kind] ?? []).includes(o.report!.key));
  const reportLine = (o: Order) => {
    const def = REPORTS.find((d) => d.key === o.report!.key);
    const fixer = nameOf(s, o.role);
    const effect = o.report!.effect === 'leak' ? `costs $${o.report!.amount.toLocaleString('en-US')} a week` : o.report!.effect === 'gse' ? 'a cart tagged out' : `holds ${nameOf(s, o.report!.by)} to fewer jobs a turn`;
    return `Open: ${def?.notice ?? o.title} (${o.role === role ? 'yours to fix' : `${fixer}'s to fix`}): ${effect}.`;
  };
  const W = s.history[s.history.length - 1];
  switch (kind) {
    case 'hangar': {
      const pw = powered(s);
      const carts = gseCarts(s);
      if (role !== 'fin') lines.push(pw.gridDown ? `Hangar tools offline: the grid is down${role === 'mech' ? ' (one hangar job this turn)' : ''}.` : 'Hangar power on.');
      if (role === 'mech') lines.push(`${carts.filter((c) => c.charging).length} of ${carts.length} ground power cart${carts.length > 1 ? 's' : ''} on the charger.`);
      if (role === 'elec') lines.push("The GPU charger circuit: the charger outside the classified area, GFCI on the tool receptacles (NEC 513).");
      if (role === 'fin') {
        lines.push(`Stock $${Math.round(invValue(s)).toLocaleString('en-US')} in ${binsInUse(s)} of ${binsTotal(s)} bins; carrying it costs $${carryCost(s).toLocaleString('en-US')} a week.`);
        const receiving = (s.pos ?? []).filter((p) => p.status === 'open' || p.status === 'held').length;
        if (receiving) lines.push(`${receiving} purchase order${receiving > 1 ? 's' : ''} on the way to receiving.`);
        if (W?.costs.power) lines.push(`Charging the carts cost $${Math.round(W.costs.power).toLocaleString('en-US')} last week.`);
      } else lines.push(`Stores: ${binsInUse(s)} of ${binsTotal(s)} bins used.`);
      break;
    }
    case 'office': {
      if (role === 'fin') {
        const rw = runway(s);
        lines.push(`Cash $${Math.round(s.cash).toLocaleString('en-US')}; spendable covers ${rw.weeks} weeks of the fixed costs ($${rw.weekly.toLocaleString('en-US')} a week).`);
      } else lines.push(`${nameOf(s, 'fin')}'s office.`);
      break;
    }
    case 'runway': {
      const night = tierDef(s.tier).nightFlights;
      lines.push(night ? 'Night flights on: a flight more a plane a week while the edge lights are lit.' : 'Day flights only: night flights come with the Resort (tier 5).');
      if (role === 'elec') lines.push(night ? 'The edge lights are on the island grid (the runway edge lights breaker).' : 'No edge lights yet.');
      if (W && role !== 'elec') {
        const lost = W.flightsScheduled - W.flightsFlown;
        lines.push(`Last week: ${W.flightsFlown} of ${W.flightsScheduled} flights flown${lost > 0 ? `, ${lost} lost` : ''}.`);
      }
      break;
    }
    case 'fuel': {
      if (role === 'mech') lines.push('Sumped this morning: no water.');
      if (role === 'elec') {
        const dock = liveAlerts(s).filter((a) => a.role === 'elec' && (a.sym === 'E_DOCK_TRIP' || a.sym === 'E_TAKEOFF_DOCK')).length;
        lines.push(dock ? `${dock} open alert${dock > 1 ? 's' : ''} on the fuel-dock run.` : 'The fuel-dock pumps: on the fuel dock breaker, nothing open.');
      }
      if (role === 'fin') lines.push('Fuel is in the charter price: an avgas rise that the rates never follow is a money leak.');
      break;
    }
    case 'dock': {
      const ch = s.chain;
      if (role === 'mech' && ch && ch.freight === 'boat' && ch.step !== 'done') lines.push(`The AOG boat is bringing the ${ch.item}.`);
      if (role === 'fin') {
        lines.push(tierDef(s.tier).ferry ? `The ferry brings ${tierDef(s.tier).ferry} guest parties a week.` : 'No ferry yet: it starts at tier 3.');
        const boat = (s.pos ?? []).filter((p) => (p.status === 'open' || p.status === 'held') && p.carrier === 'boat').length;
        if (boat) lines.push(`${boat} purchase order${boat > 1 ? 's' : ''} of building materials on the supply boat.`);
      }
      if (!lines.length) lines.push(tierDef(s.tier).ferry ? 'The ferry and the supply boat tie up here.' : 'The supply boat ties up here.');
      break;
    }
    case 'windsock': {
      lines.push(s.weather === 'clear' ? 'This week: clear skies.' : s.weather === 'wind' ? 'This week: wind, the flights at risk.' : 'This week: a storm, the electrician’s week.');
      if (role === 'elec' && W?.weather === 'storm') lines.push('Last week’s storm: houses −6, grid −8.');
      if (role === 'fin') lines.push(`Insurance: ${INSURANCE[s.insurance].label} (covers ${Math.round(INSURANCE[s.insurance].cover * 100)}% of a claim).`);
      break;
    }
    default:
      break;
  }
  for (const o of reports) lines.push(reportLine(o));
  return { lines };
}
