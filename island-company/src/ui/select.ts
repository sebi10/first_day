// UI-side derived data: who is blocking whom, what to launch for an order.
import type { PuzzleId } from '../puzzles/types';
import { chainMove, islandAircraft, manualCard, openChain } from '../sim/chain';
import { ECON, MODELS, REPORT_BY_KEY, ROLE_LABEL } from '../sim/data';
import { chainWouldOpen, forecastContext, listPrice } from '../sim/engine';
import { cartOn, flightsAvailable, flightsPerPlane, gseCarts, houses, housesRentable, isBlind, isRework, launchTier, openReports, planes, powered, reportCap } from '../sim/econ';
import { toolsFor } from '../sim/progression';
import { hashSeed } from '../sim/rng';
import { ROLES, type Action, type IslandState, type Order, type Role } from '../sim/types';
import type { PuzzleLaunch } from './puzzlehost';

/** `kind`: a cross-trade move (a crewmate's report, or the part chain), as crossMoves() lists them */
export type Block = { from: Role; to: Role; text: string; kind?: CrossMove['kind'] };

export function blocks(s: IslandState): Block[] {
  const out: Block[] = [];
  const pending = s.orders.filter((o) => o.status === 'pending' && o.role !== 'fin' && o.lastDeferredWeek !== s.week && !o.chain);
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
  if (cargo && cargo.health < 40 && s.parts.inTransit > 0) out.push({ from: 'mech', to: 'elec', text: 'cargo plane grounded: parts stuck' });
  if (powered(s).gridDown) out.push({ from: 'elec', to: 'mech', text: 'grid down: hangar tools offline' });
  if (houses(s).length && housesRentable(s) === 0) out.push({ from: 'elec', to: 'fin', text: 'no rentable houses: no revenue' });
  if (s.cash < ECON.freezeBelow) out.push({ from: 'fin', to: 'mech', text: 'cash under $2,000: only safety-critical work gets approved' });
  // cross-trade moves: a crewmate's report and the part chain, counted the same way
  for (const m of crossMoves(s)) out.push({ from: m.who, to: m.waits, text: m.text, kind: m.kind });
  return out;
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
export type CrossMove = { key: string; kind: 'report' | 'chain'; who: Role; waits: Role; text: string; /** "the hangar work lights are dead" / "Cargo C-7 AOG: brake linings" */ what: string; /** the move in a few words */ short: string };

export function crossMoves(s: IslandState): CrossMove[] {
  const out: CrossMove[] = [];
  const ch = openChain(s);
  if (ch) {
    const m = chainMove(s, ch);
    const asset = s.assets.find((a) => a.id === ch.assetId);
    const waits: Role | null = m.who === 'fin' ? 'mech' : m.who === 'mech' ? 'fin' : null;
    // "look up the brake linings in the IPC (Cargo C-7 is AOG)", "approve the part (066-22500, $310; Cargo C-7 is AOG)"
    const aog = `${asset?.name ?? 'a plane'} is AOG`;
    const text = m.text.endsWith(')') ? `${m.text.slice(0, -1)}; ${aog})` : `${m.text} (${aog})`;
    if (m.who && waits && s.players[m.who] && s.players[waits])
      out.push({ key: `chain:${ch.id}:${ch.step}:${ch.stepId ?? ''}`, kind: 'chain', who: m.who, waits, text, what: `${asset?.name ?? 'A plane'} AOG: ${ch.item}`, short: m.short });
  }
  for (const o of openReports(s)) {
    const rep = o.report!;
    if (rep.by === o.role || !s.players[rep.by] || !s.players[o.role]) continue;
    const effect = rep.effect === 'cap' ? ` (${capWords(rep.by)})` : rep.effect === 'gse' ? ` (${gseCarts(s).find((c) => c.id === rep.cart)?.name ?? 'a GPU cart'} tagged out)` : ` (−\u2060$${rep.amount.toLocaleString('en-US')}/wk)`;
    out.push({ key: `report:${o.id}`, kind: 'report', who: o.role, waits: rep.by, text: `${reportSaid(o)}${effect}`, what: reportSaid(o), short: 'fix the report' });
  }
  return out;
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
    push(`${after.name}: week ${h.week} resolved`, `Grade ${h.grade}. Revenue $${h.revenue.toLocaleString('en-US')}, ${h.flightsFlown}/${h.flightsScheduled} flights, ${h.incidents.length} incidents.${aog}${reps}`);
    return out;
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
  } else if (o.kind === 'auction') {
    const { low, high } = ECON.partMarket;
    const f = 1 + 0.1 * (s.tier - 1);
    const fair = Math.round(((low + high) / 2) * f);
    context.market = { low: Math.round(low * f), high: Math.round(high * f), fair, cap: Math.min(Math.round(listPrice(s) * 0.92), Math.max(0, s.cash - ECON.freezeBelow)) };
  }
  if (o.puzzle === 'forecast') Object.assign(context, forecastContext(s));
  // paperwork on a plane: the island's own airplane (twin / cargo / float), its records as they are
  if (asset?.kind === 'plane' && READS_AIRCRAFT.has(o.puzzle)) context.aircraft = islandAircraft(s.seed, asset);
  // the part chain's lookup and research: this part, as the job found it
  const ch = openChain(s);
  if (ch && o.chain && o.chain.id === ch.id && (o.chain.step === 'lookup' || o.chain.step === 'research'))
    context.chain = { step: o.chain.step, tag: ch.tag, item: ch.item, found: ch.found ?? '' };
  // the manual: torque and servicing values come from the plane's own task card (marked while the game teaches)
  if (asset?.kind === 'plane' && o.role === 'mech' && CARD_DRIVEN.has(o.puzzle)) {
    const card = manualCard(islandAircraft(s.seed, asset), o.job ?? o.kind, o.puzzle, tier <= 2);
    if (card) context.card = card;
  }
  // a ground power start runs off the cart hooked up to that plane, as charged as it is
  const cart = o.puzzle === 'gpu' ? cartOn(s, o.assetId) : undefined;
  if (cart) context.cart = { name: cart.name, charge: cart.charge };
  return {
    puzzle: o.puzzle,
    seed: hashSeed(o.seed, role),
    tier,
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
