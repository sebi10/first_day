// The inspect sheet's facts (docs/EXPANSION.md 6.2, 6.3): what each seat sees on
// an object and the moves it can make there, as plain data. `facts(s, ref, role)`
// is pure (no DOM, no writes) and the sheets render it (InspectSheet.tsx and the
// per-kind files beside it); tests/inspect.test.ts runs it over every object kind
// and seat.
//
// Each seat reads what it cares about:
// - the mechanic: airworthiness, the next inspection, MEL placards, the plane's own
//   logbook, the carts, the hangar's power and reports;
// - the electrician: reliability, rentable or why not, the panel schedule, the
//   breakers, the transfer switch, hazards and tags;
// - the analyst: the money: what an object earns this week, what it cost over 13
//   weeks, what is waiting on her, and her own moves (approve, the nightly rate, hire).
//
// It only reads what the seat could see anyway: an asset's health, its visible
// alerts in their own words, the ledger and the catalog. Never an alert's hidden
// cause or its early flag, a hidden defect, a cart cable's hidden wear, or a quick
// check's truth (the sim's own; UI code never imports it).
import { alertShort, flagSource, liveAlerts, nameMid, soleGuest } from '../../sim/alerts';
import { externalPower, fmtDate, planeModel } from '../../sim/aircraft';
import { islandAircraft } from '../../sim/chain';
import { genPanel, HOME_PANEL, HOUSE_CIRCUITS } from '../../sim/checkdata';
import { canCheck, CHECK, checkKindFor, type CheckKind } from '../../sim/checks';
import { ECON, INSURANCE, MODELS, RENO, REPORTS, ROLE_LABEL } from '../../sim/data';
import {
  alertAog,
  cableReport,
  cartOn,
  chainAog,
  downtimeOf,
  flightsPerPlane,
  genUpgraded,
  gseCarts,
  hazardOn,
  houseBlocker,
  houseRentable,
  houseWeekRevenue,
  isAog,
  isTagged,
  occupancy,
  openReports,
  planeCapacity,
  powered,
  projectWeek,
  rateBounds,
  rentFactor,
  startCart,
  subCharterOn,
  tierDef,
} from '../../sim/econ';
import { runway, spendable } from '../../sim/ledger';
import { buildSite, COTTAGE_SHELL, cottagePlan, crewOf, housekeepingCap, openBuild, pilotOf, renoCost, severanceOf, STAFF, staffEffect } from '../../sim/staff';
import type { Alert, Asset, Candidate, IslandState, Npc, OpsRole, Order, Role } from '../../sim/types';
import { cableWords, cartWhere, weakBatteryNow } from '../gse';
import { moveChip } from '../flow/words';
import { FIXTURE_NAME, HOME, OBJECT_LABEL, type ObjectKind, type ObjectRef, type StationId } from '../objects';
import { cardVM, flowQueue } from '../purchasing/model';
import { assetPnl, fixtureFacts, flaggable, openAlertsOn } from '../select';
import { buildLine, doingNow, renoStatus, ROLE_WORD, warrantyLine } from '../staff/model';

// ---------------------------------------------------------------------------
// The shape

export type Tone = 'rust' | 'palm' | 'sea' | 'amber' | '';
/** a line of the seat's section; `tone` colours it (a closed house, a grid down) */
export type Line = { text: string; tone?: Tone };

/** a move the sheet offers. Every one is an existing move, a deep link into an existing flow, or the quick check */
export type Act =
  /** the seat's quick check (6.4): the walkaround, the IR scan or the meter check; `why` when it can't be made now */
  | { t: 'check'; kind: CheckKind; label: string; ok: boolean; why?: string }
  /** open an alert's job sheet (the job flow: Investigate, the manual, the IPC, stock) */
  | { t: 'alert'; alert: string; label: string; sub: string }
  /** open an order (a bench check asked of the electrician, a report job, a project job) */
  | { t: 'order'; order: string; label: string; sub: string }
  /** the safety call: ground a plane / red-tag a house or the generator this week (ops.tsx SafetyCall) */
  | { t: 'tag'; assetId: string; on: boolean; word: string; sub?: boolean; ok: boolean; text: string }
  /** write it up (the squawk: ops.tsx WriteUp), one a week */
  | { t: 'writeUp'; assetId: string; ok: boolean; why?: string }
  /** the ground power sheet, on a cart (null: every cart) */
  | { t: 'gse'; cart: string | null; label: string }
  /** the tech's read-only Stores */
  | { t: 'stores'; label: string }
  /** the analyst's desk tab, and a section of it (`at`: 'pricing' on Money, 'hiring' and 'site-work' on Staff) */
  | { t: 'desk'; desk: 'approvals' | 'stock' | 'money' | 'staff'; label: string; at?: string; sub?: string }
  /** approve a flow card on this asset, inline (the analyst) */
  | { t: 'approve'; order: string; label: string; usd: number; sub: string }
  /** the island's nightly rate, stepped inline (the analyst): ±step, with this week's projected effect */
  | { t: 'rates'; nightly: number; charter: number; step: number; min: number; max: number; revenue: number; down: number; up: number; ok: boolean; why?: string }
  /** hire the board's candidate for this role (+1 confirm) */
  | { t: 'hire'; cand: string; name: string; role: string; skill: number; ask: number; start: number; does: string; need: string; money: string; net: number; ok: boolean; why?: string }
  /** let a crew member go (+1 confirm) */
  | { t: 'letGo'; npc: string; name: string; severance: number; need: string; money: string; ok: boolean; why?: string }
  /** buy the build's next unit of materials (the yard, on the supply boat) */
  | { t: 'buy'; lines: { item: string; qty: number }[]; usd: number; label: string }
  /** start an extra cottage (+1 confirm) */
  | { t: 'build'; label: string; usd: number; text: string; ok: boolean; why?: string }
  /** the crew board DM to a seat, with a message started (crewboard.tsx openDm) */
  | { t: 'dm'; to: Role; label: string; prefill: string }
  /** G0: renovate this house (the analyst's capex, from tier 4): the case, then confirm (staff/Reno.tsx RenoCard) */
  | { t: 'reno'; assetId: string };

/** the seat's own record blocks: drawn by the per-kind files */
export type Block =
  | { t: 'plate'; reg: string; text: string; placard: string; manual: string }
  | { t: 'log'; season: { week: number; text: string; by: string }[]; entries: { id: string; date: string; book: string; text: string; ref: string; meter: string; sig: string }[] }
  | { t: 'schedule'; title: string; rows: { label: string; rating: string; wire: string; note: string }[]; foot?: string }
  | { t: 'person'; name: string; role: string; skill: number; doing: string; wage?: number }
  | { t: 'project'; title: string; rows: { who: string; role: Role; job: string; state: string; mine: boolean }[] }
  | { t: 'carts'; rows: { id: string; name: string; charge: number; where: string; cable: string; tagged: boolean }[] }
  | { t: 'stats'; items: { label: string; value: string; tone?: Tone }[] };

/** Report a problem (6.5): a flag on another trade's asset, your own trade's write-up, or a DM about a fixture */
export type Report =
  | { t: 'flag'; assetId: string; to: OpsRole; toName: string; head: string; ok: true; words: string; dms: Act[]; said?: string }
  | { t: 'flag'; assetId: string; to: OpsRole | null; toName: string; head: string; ok: false; why: string; dms: Act[]; said?: string }
  | { t: 'own'; head: string; assetId: string; ok: boolean; why?: string }
  | { t: 'dm'; head: string; dms: Act[] };

export type Facts = {
  /** "Twin N-12", "Hangar" */
  name: string;
  /** "6-seat piston twin · N412IC · Stage 2 Isle" */
  where: string;
  /** one status line in the seat's words */
  status: string;
  tone?: Tone;
  /** assets: its health bar */
  health?: { value: number; label: string };
  /** assets: open alerts by trade */
  alerts?: { mech: number; elec: number };
  /** the seat's section (read) */
  lines: Line[];
  blocks: Block[];
  /** the seat's moves (the primary one is apart) */
  actions: Act[];
  /** one primary action per seat (6.2): the quick check for a tech, the object's own money move for the analyst */
  primary: Act | null;
  report: Report | null;
  /** the ref points at nothing on this island (a stale tap) */
  missing?: boolean;
};

// ---------------------------------------------------------------------------
// Words

const nameOf = (s: IslandState, r: Role) => s.players[r]?.name ?? ROLE_LABEL[r];
const money = (n: number) => {
  const v = Math.round(n);
  return `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US')}`;
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const cap1 = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const short = (s: IslandState, a: Alert) => cap1(alertShort(s, a));
const TRADE: Record<OpsRole, string> = { mech: 'mechanic', elec: 'electrician' };
/** the island's name as a station ("home" is the island itself in stage 2) */
const stationName = (s: IslandState, st: StationId) => (st === HOME ? s.name : st);
const openOrder = (o: Order) => o.status !== 'done' && o.status !== 'cancelled';

/** an order's state in a few words, as the job flow says it */
function orderState(s: IslandState, o: Order): string {
  switch (o.status) {
    case 'pending':
      return `a card with ${nameOf(s, 'fin')}`;
    case 'countered':
      return `${nameOf(s, 'fin')} offered a patch`;
    case 'approved':
    case 'waiting_part':
      return 'waiting on parts';
    case 'ready':
      return 'ready to start';
    case 'done':
      return 'signed off';
    default:
      return 'dropped';
  }
}

/** a live alert as a row: its words, and whose move it is (the job flow's chip) */
function alertAct(s: IslandState, a: Alert, role: Role): Act {
  return { t: 'alert', alert: a.id, label: short(s, a), sub: moveChip(s, a, role).chip };
}

/** the open reports whose trouble is this thing's, in words: "Hangar lights out (Ben's to fix): holds Ana to fewer jobs a turn" */
function reportWords(s: IslandState, o: Order, role: Role): string {
  const def = REPORTS.find((d) => d.key === o.report!.key);
  const fixer = o.role === role ? 'yours to fix' : `${nameOf(s, o.role)}'s to fix`;
  const effect =
    o.report!.effect === 'leak' ? `costs ${money(o.report!.amount)} a week` : o.report!.effect === 'gse' ? 'a cart tagged out' : `holds ${nameOf(s, o.report!.by)} to fewer jobs a turn`;
  return `Open: ${def?.notice ?? o.title} (${fixer}): ${effect}.`;
}

/** the DMs from a seat to the other two, each started "About the hangar: " */
function dmsFrom(s: IslandState, role: Role, about: string, to: Role[] = (['mech', 'elec', 'fin'] as Role[]).filter((r) => r !== role)): Act[] {
  return to.filter((r) => r !== role && s.players[r]).map((r) => ({ t: 'dm', to: r, label: `Message ${nameOf(s, r)}`, prefill: `About ${about}: ` }));
}

const dmOne = (s: IslandState, to: Role, about: string): Act => ({ t: 'dm', to, label: `Message ${nameOf(s, to)}`, prefill: `About ${about}: ` });

/**
 * the quick check this seat can make on the asset, as the primary act (null: none of this seat's). Before the checks
 * open (tier 1, most live islands) there's no disabled footer: one line in the sheet says when they come (review round 1)
 */
function checkAct(s: IslandState, role: Role, a: Asset, lines?: Line[]): Act | null {
  if (role === 'fin') return null;
  const kind = checkKindFor(s, role, a);
  if (!kind) return null;
  if (s.tier < CHECK.fromTier) {
    lines?.push({ text: `${kind === 'walkaround' ? 'The walkaround' : kind === 'ir' ? 'The IR scan' : 'The meter check'} (one quick check a week) opens at tier ${CHECK.fromTier}.` });
    return null;
  }
  const c = canCheck(s, role, a.id);
  const label = kind === 'walkaround' ? 'Walkaround' : kind === 'ir' ? 'IR scan' : 'Meter check';
  return c.ok ? { t: 'check', kind, label, ok: true } : { t: 'check', kind, label, ok: false, why: c.why };
}

function writeUpAct(s: IslandState, role: Role, a: Asset): Act {
  const turn = s.turns[role];
  if (s.week < 1) return { t: 'writeUp', assetId: a.id, ok: false, why: 'The week has not started yet.' };
  if (turn?.ended) return { t: 'writeUp', assetId: a.id, ok: false, why: 'Your turn is over for this week.' };
  if (s.squawked?.[role] === s.week) return { t: 'writeUp', assetId: a.id, ok: false, why: 'One write-up a week: yours is done.' };
  return { t: 'writeUp', assetId: a.id, ok: true };
}

function tagAct(s: IslandState, role: Role, a: Asset, word: string): Act {
  const on = isTagged(s, a.id);
  const ok = s.week >= 1 && !s.turns[role]?.ended;
  const sub = a.kind === 'plane' && soleGuest(s, a.id);
  const text = on
    ? `${word === 'Ground' ? 'Grounded' : 'Red-tagged'} this week by ${nameOf(s, s.tags![a.id]!)}: nothing can fail in service.`
    : a.kind === 'plane'
      ? `Safety call: ground it this week. No flights${sub ? ' (a mainland sub-charter flies its guests, at a price)' : ''}, and nothing can fail in service.`
      : `Safety call: red-tag it this week. ${a.kind === 'house' ? 'No guests' : 'It carries nothing'}, and nothing can fail in service.`;
  return { t: 'tag', assetId: a.id, on, word, sub, ok, text };
}

/** what this seat passed on this week, in its words (review round 1: the reporter never saw what went on the list in their name) */
function saidThisWeek(s: IslandState, role: Role): string | undefined {
  const mine = (s.alerts ?? []).find((x) => x.src === 'flag' && x.week === s.week && (x.by ? x.by === role : x.who === nameOf(s, role)));
  return mine ? `This week you passed on ${flagSource(s, mine)} to ${nameOf(s, mine.role)}: ${alertShort(s, mine)}.` : undefined;
}

/** Report a problem on an asset (6.5): a flag for its trade, or this seat's own write-up */
function assetReport(s: IslandState, role: Role, a: Asset): Report | null {
  const own = a.kind === 'plane' ? 'mech' : a.kind === 'generator' ? 'both' : 'elec';
  if (role !== 'fin' && (own === role || own === 'both')) {
    const w = writeUpAct(s, role, a) as Extract<Act, { t: 'writeUp' }>;
    return { t: 'own', head: own === 'both' ? "It's both techs': write it up" : 'Your trade: write it up', assetId: a.id, ok: w.ok, why: w.why };
  }
  const f = flaggable(s, role, a.id);
  if (f.ok) {
    const n = nameOf(s, f.to);
    return {
      t: 'flag',
      assetId: a.id,
      to: f.to,
      toName: n,
      head: `Tell ${n} about ${nameMid(a)}`,
      ok: true,
      // true of every flag, a real fault or none (a no-fault one still costs a close), and it says nothing of which;
      // it passes on its source's words, never the flagger's own (review round 1)
      words: `Passes on what ${a.kind === 'plane' ? 'the pilot wrote up' : a.kind === 'house' ? 'a guest reported' : 'the logs show'} about ${nameMid(a)}: one alert on ${n}'s list, from you, until ${n} closes it. You'll see what it said.`,
      dms: [dmOne(s, f.to, nameMid(a))],
    };
  }
  const said = saidThisWeek(s, role);
  // who it would go to: the asset's trade (the generator, for the analyst: either tech; message the one it names)
  const to: OpsRole | null = own === 'both' ? null : own;
  const toName = to ? nameOf(s, to) : 'the techs';
  const about = nameMid(a);
  return { t: 'flag', assetId: a.id, to, toName, head: `Tell ${toName} about ${about}`, ok: false, why: f.why, dms: to ? [dmOne(s, to, about)] : dmsFrom(s, role, about, ['mech', 'elec']), ...(said ? { said } : {}) };
}

// ---------------------------------------------------------------------------
// Planes

/** the next inspection in the words of the due alert (flights, and about 8.3 h each): "100-hr in about 40 h (5 flights), about 2 weeks" */
export function inspectionWords(s: IslandState, p: Asset): string {
  const cargo = planeModel(p.model) === 'cargo';
  const word = cargo ? 'Phase inspection' : '100-hr inspection';
  const since = p.sinceInspection ?? 0;
  const toGo = Math.max(0, ECON.planeInspectionFlights - since);
  if (toGo === 0) return `${word}: due now (${plural(since, 'flight')} since the last one)`;
  const hours = Math.max(5, Math.round((toGo * 8.3) / 5) * 5);
  const per = flightsPerPlane(s.tier);
  const weeks = per ? Math.max(1, Math.ceil(toGo / per)) : null;
  return `${word} in about ${hours} h (${plural(toGo, 'flight')})${weeks ? `, about ${plural(weeks, 'week')} of flying` : ''}`;
}

function planeFacts(s: IslandState, p: Asset, role: Role): Facts {
  const ac = islandAircraft(s.seed, p);
  const aogAl = alertAog(s, p.id);
  const chain = chainAog(s, p.id);
  const aog = isAog(s, p.id);
  const tagged = isTagged(s, p.id);
  const flying = aog || tagged ? 0 : planeCapacity(p, s.tier, s.weather);
  const cargo = !!MODELS[p.model]?.cargo;
  const live = liveAlerts(s).filter((x) => x.assetId === p.id);
  const mel = live.filter((x) => x.mel && x.mel.until >= s.week);
  const sub = subCharterOn(s);
  const subbed = sub?.plane.id === p.id;
  const lines: Line[] = [];
  const blocks: Block[] = [];
  const actions: Act[] = [];
  let primary: Act | null = null;
  let status: string;
  let tone: Tone = '';

  if (role === 'mech') {
    status = aog
      ? chain && !aogAl
        ? 'AOG: waiting on its part (the part chain)'
        : `AOG: ${aogAl ? alertShort(s, aogAl) : 'an airworthiness item'} is past due`
      : tagged
        ? `Grounded this week (${nameOf(s, s.tags![p.id]!)}'s safety call)`
        : `Flying: ${plural(flying, 'flight')} this week${mel.length ? ` · ${plural(mel.length, 'MEL placard')}` : ''}`;
    tone = aog || tagged ? 'rust' : '';
    lines.push({ text: inspectionWords(s, p) });
    for (const m of mel) lines.push({ text: `MEL (C): ${alertShort(s, m)}: placarded INOP to week ${m.mel!.until}.`, tone: 'sea' });
    if (subbed) lines.push({ text: `Its guests fly in on a mainland sub-charter ($${sub!.fee} a flight) until it's back in service.`, tone: 'rust' });
    const cart = cartOn(s, p.id);
    const wb = weakBatteryNow(s);
    if (cart) lines.push({ text: `${cart.name} hooked up (${Math.round(cart.charge)}%).` });
    if (wb && wb.name === p.name) lines.push({ text: wb.ready ? 'Weak battery this week: a charged cart is on it for the first start.' : 'Weak battery this week: hook a charged cart up to it before the resolve, or its first flight is lost.', tone: wb.ready ? '' : 'rust' });
    lines.push({ text: 'Based at home: worked in the hangar.' });
    const ext = externalPower(ac);
    blocks.push({ t: 'plate', reg: ac.registration, text: `${ac.designation} · S/N ${ac.serial} · ${ac.year}`, placard: ext.placard, manual: ext.manual });
    blocks.push({ t: 'log', season: seasonLog(s, p), entries: [...ac.log].reverse().slice(0, 6).map((e) => ({ id: e.id, date: fmtDate(e.date), book: e.pos ? `${e.book} (${e.pos})` : e.book, text: e.text, ref: e.ref, meter: `${ac.meter} ${e.tach.toFixed(1)} · TT ${e.tt.toFixed(1)}`, sig: e.signature })) });
    for (const x of live.filter((x) => x.role === 'mech')) actions.push(alertAct(s, x, role));
    primary = checkAct(s, role, p, lines);
    actions.push(tagAct(s, role, p, 'Ground'));
    actions.push({ t: 'gse', cart: cart?.id ?? startCart(s, p.id)?.id ?? null, label: cart ? `Ground power: ${cart.name}` : 'Ground power' });
  } else if (role === 'elec') {
    status = aog || tagged ? 'On the ground this week' : 'Flying this week';
    const bench = live.filter((x) => x.bench?.order && s.orders.some((o) => o.id === x.bench!.order && o.role === 'elec' && openOrder(o)));
    for (const x of bench) {
      const o = s.orders.find((y) => y.id === x.bench!.order)!;
      actions.push({ t: 'order', order: o.id, label: `Meter it: ${alertShort(s, x)}`, sub: `asked by ${nameOf(s, 'mech')} · ${orderState(s, o)}` });
    }
    if (!bench.length) lines.push({ text: `No electrical check asked of you on it. ${nameOf(s, 'mech')} asks for one from the job sheet when a fault could be the wiring.` });
    lines.push({ text: aog || tagged ? 'Parked by the hangar.' : 'On the line by the hangar between flights.' });
  } else {
    const dt = downtimeOf(s, p.id);
    const pnl = assetPnl(s, p.id, 13);
    status = aog ? (cargo ? 'AOG this week' : `AOG this week: about ${money(dt.usd)} of guests and tours lost`) : tagged ? 'Grounded this week (a safety call)' : `Flies ${plural(flying, 'flight')} this week`;
    tone = aog || tagged ? 'rust' : '';
    if (cargo) lines.push({ text: `The cargo runs: it brings the bulk freight in.${dt.usd > 0 ? ` A week down holds ${money(dt.usd)} of AOG boats for safety parts.` : ''}` });
    else lines.push({ text: `This week about ${money(pnl.revenue)} of guests and tours ride on it (what a week on the ground would lose).` });
    if (subbed) lines.push({ text: `Down: the mainland sub-charter flies its guests (${sub!.flights} × $${sub!.fee} = ${money(sub!.usd)} this week).`, tone: 'rust' });
    lines.push({ text: repairsLine(pnl) });
    lines.push({ text: 'Owned outright: no lease, no deposit held.' });
    const pilot = pilotOf(s, p.id);
    lines.push({ text: pilot ? `Flown by ${pilot.name || 'a contract pilot'} (skill ${pilot.skill}, ${money(pilot.wage)} a week).` : 'No pilot on it this week.' });
    const cards = flowQueue(s).filter((o) => o.assetId === p.id);
    for (const o of cards) {
      const vm = cardVM(s, o);
      actions.push({ t: 'approve', order: o.id, label: `Approve ${o.title} · ${money(vm.total)}`, usd: vm.total, sub: `for ${vm.who}${vm.toBuy.length + vm.tools.length ? ` · ${plural(vm.toBuy.length + vm.tools.length, 'line')} to buy` : ' · parts on the shelf'}` });
    }
    const other = s.orders.filter((o) => o.assetId === p.id && o.status === 'pending' && !o.flow).length;
    primary = actions.shift() ?? null;
    if (!primary) lines.push({ text: 'Nothing on it waits on you.' });
    if (other) actions.push({ t: 'desk', desk: 'approvals', label: `${plural(other, 'other card')} on it: Approvals` });
  }
  return {
    name: p.name,
    where: `${MODELS[p.model]?.label ?? 'Plane'} · ${ac.registration} · ${stationName(s, HOME)}`,
    status,
    tone,
    // (review round 1: airworthiness is yes or no; the bar is the airframe's condition)
    health: { value: p.health, label: 'Condition' },
    alerts: openAlertsOn(s, p.id),
    lines,
    blocks,
    actions,
    primary,
    report: assetReport(s, role, p),
  };
}

/** the repair spend over 13 weeks: parts and labour split by the island's labour share of each week (an estimate: "about") */
const repairsLine = (pnl: { parts: number; labour: number }) =>
  pnl.parts + pnl.labour > 0 ? `Repairs over 13 weeks: ${money(pnl.parts + pnl.labour)} (about ${money(pnl.parts)} parts, ${money(pnl.labour)} labour).` : 'No repair spend on it in 13 weeks.';

/** a house's renovation as capex, apart from its repairs (review round 1): the package paid at the order and the materials at list */
function capexLine(s: IslandState, h: Asset): string | null {
  const b = (s.builds ?? []).filter((x) => x.reno === h.id).sort((x, y) => y.started - x.started)[0];
  if (!b) return null;
  const c = renoCost(h);
  return `Capex, not repairs: its renovation ordered in week ${b.started}, ${money(c.pkg)} package + ${money(c.materials)} materials at list.`;
}

/** the island's jobs that are no maintenance record: the charter load sheet is the pilot's, a ground power start an operation */
const NOT_LOGGED = new Set(['wb', 'gpustart']);

/** this season's sign-offs on the plane (the island's own work, newest first): the title, the week, who. Never a score */
function seasonLog(s: IslandState, p: Asset): { week: number; text: string; by: string }[] {
  return s.orders
    .filter((o) => o.assetId === p.id && o.status === 'done' && o.result && !o.result.auto && o.role === 'mech' && !NOT_LOGGED.has(o.kind))
    .sort((a, b) => b.result!.week - a.result!.week)
    .slice(0, 4)
    .map((o) => ({ week: o.result!.week, text: o.title, by: nameOf(s, o.result!.by) }));
}

// ---------------------------------------------------------------------------
// Houses

/** this week's booked houses, as projectWeek books them: the healthiest rentable ones first, up to the week's arrivals */
function bookedIds(s: IslandState): Set<string> {
  const n = projectWeek(s).booked;
  return new Set(
    s.assets
      .filter((h) => h.kind === 'house' && houseRentable(s, h))
      .sort((a, b) => b.health - a.health)
      .slice(0, n)
      .map((h) => h.id),
  );
}

/** a room's protection as the code asks it (NEC 2023 210.8, 210.12, 406.9) */
function protectionOf(room: string, gfci: boolean): string {
  const afci = ['kitchen', 'laundry', 'bedroom', 'living', 'hall'].includes(room);
  if (room === 'outdoor') return 'GFCI · WR, in-use cover';
  if (gfci && afci) return 'GFCI + AFCI (dual function)';
  if (gfci) return 'GFCI';
  return afci ? 'AFCI' : '';
}

/** the house's panel schedule, derived from its model's rooms (the meter check reads the same circuits); `spaOpen`: its hot-tub circuit's take-off is still open (not wired yet) */
export function houseSchedule(h: Pick<Asset, 'model'>, spaOpen = false): Extract<Block, { t: 'schedule' }> {
  const rows = HOUSE_CIRCUITS.filter((c) => !c.models || c.models.includes(h.model)).map((c) => ({ label: c.label, rating: `${c.amps} A`, wire: `${c.awg} AWG Cu`, note: protectionOf(c.room, c.gfci) }));
  rows.push(spaOpen ? { label: 'Spa (hot tub)', rating: '—', wire: '—', note: 'not wired yet: its take-off is on your list' } : { label: 'Spa (hot tub)', rating: '60 A', wire: '6 AWG Cu', note: 'GFCI (680.44) · disconnect in sight' });
  return { t: 'schedule', title: 'Panel schedule', rows, foot: 'Receptacle circuits as built; the fixed appliances are on their own breakers.' };
}

function houseFacts(s: IslandState, h: Asset, role: Role): Facts {
  const why = houseBlocker(s, h);
  const booked = bookedIds(s).has(h.id);
  const hz = hazardOn(s, h.id);
  const live = liveAlerts(s).filter((x) => x.assetId === h.id);
  const lines: Line[] = [];
  const blocks: Block[] = [];
  const actions: Act[] = [];
  let primary: Act | null = null;
  let status: string;
  let tone: Tone = '';
  const mult = MODELS[h.model]?.mult ?? 1;
  if (role === 'elec') {
    status = why ? `Closed: ${why}` : `Rentable · inspection to week ${h.inspectionUntil ?? 0}`;
    tone = why ? 'rust' : '';
    lines.push({ text: `Inspection valid to week ${h.inspectionUntil ?? 0}${(h.inspectionUntil ?? 0) < s.week ? ': lapsed, the house is closed until it passes' : ''}.`, tone: (h.inspectionUntil ?? 0) < s.week ? 'rust' : '' });
    if (hz) lines.push({ text: hz.safe ? `Made safe by ${hz.safe.by} in week ${hz.safe.week} (${hz.safe.how === 'breaker' ? 'the circuit off and tagged' : 'blanked off'}): ${short(s, hz)}. It rents at 75% until the fix.` : `Hazard open: ${short(s, hz)}. The house is shut until it's made safe or fixed.`, tone: hz.safe ? 'palm' : 'rust' });
    if (isTagged(s, h.id)) lines.push({ text: `Red-tagged this week (${nameOf(s, s.tags![h.id]!)}'s safety call).`, tone: 'rust' });
    const complaints = live.filter((x) => x.role === 'elec');
    if (!complaints.length) lines.push({ text: 'No open complaints on it.' });
    for (const x of complaints) actions.push(alertAct(s, x, role));
    blocks.push(houseSchedule(h, live.some((x) => x.sym === 'E_TAKEOFF_SPA')));
    primary = checkAct(s, role, h, lines);
    actions.push(tagAct(s, role, h, 'Red-tag'));
  } else if (role === 'mech') {
    const guestPlanes = s.assets.filter((p) => p.kind === 'plane' && !MODELS[p.model]?.cargo && !isAog(s, p.id) && !isTagged(s, p.id)).map((p) => p.name);
    status = why ? `Closed this week: ${why}` : booked ? 'Booked this week' : 'Empty this week';
    tone = why ? 'rust' : '';
    lines.push({
      text: why
        ? `No guests while it's closed (${why}).`
        : booked
          ? `Its guests fly in on ${guestPlanes.length ? guestPlanes.join(' or ') : 'the mainland sub-charter'}${tierDef(s.tier).ferry ? ' or come on the ferry' : ''}.`
          : 'No booking this week: more flights bring more guests.',
    });
  } else {
    const nightly = s.rates.nightly;
    const pnl = assetPnl(s, h.id, 13);
    const occ = occupancy(s, nightly);
    status = why ? `Closed this week (${why}): no rent` : booked ? `Booked this week · about ${money(pnl.revenue)}` : 'Empty this week';
    tone = why ? 'rust' : '';
    lines.push({ text: mult !== 1 ? `${money(nightly * mult)} a night: the island's ${money(nightly)} × ${mult} for a ${(MODELS[h.model]?.label ?? 'house').toLowerCase()}${rentFactor(s, h) < 1 ? ', at 75% while it is made safe' : ''}.` : `${money(nightly)} a night (the island's nightly rate)${rentFactor(s, h) < 1 ? ', at 75% while it is made safe' : ''}.` });
    lines.push({ text: `At this rate ${Math.round(occ * 100)}% of its nights fill: a booked week brings about ${money(houseWeekRevenue(s, h) * rentFactor(s, h))}.` });
    lines.push({ text: repairsLine(pnl) });
    const capex = capexLine(s, h);
    if (capex) lines.push({ text: capex });
    const hk = housekeepingCap(s);
    const proj = projectWeek(s);
    if (Number.isFinite(hk)) lines.push({ text: `Housekeeping turns over ${plural(hk, 'house')} a week; ${proj.booked} of ${proj.rentable} rentable houses are booked.` });
    if (h.model === 'cottage' && s.tier >= 3) {
      const plan = cottagePlan(s);
      if (plan.plot) lines.push({ text: plan.payback ? `An extra cottage like it: ${money(plan.cost)}, rents about ${money(plan.rent)} a week, pays back in about ${plural(plan.payback, 'week')}.` : `An extra cottage like it: ${money(plan.cost)}; at this week's bookings it would sit empty.` });
    }
    primary = ratesAct(s);
    // the rest of pricing (the charter rate, the season, the rate's effect on occupancy) is on the desk's Money tab
    actions.push({ t: 'desk', desk: 'money', label: 'Pricing', sub: 'The desk’s Money tab: the demand curve and the charter rate', at: 'pricing' });
    // G0: the analyst's renovation, from the Harbor (a house at 75 or below; its state once one is on the list)
    if (s.tier >= RENO.fromTier) actions.push({ t: 'reno', assetId: h.id });
  }
  // G0, every seat: where its renovation stands, and its builder's warranty
  const reno = renoStatus(s, h, role);
  if (reno) lines.push({ text: reno.text, tone: reno.tone });
  const wl = warrantyLine(s, h);
  if (wl) lines.push({ text: wl.text, tone: wl.tone });
  return {
    name: h.name,
    where: `${MODELS[h.model]?.label ?? 'House'} · ${stationName(s, HOME)}`,
    status,
    tone,
    health: { value: h.health, label: 'Reliability' },
    alerts: openAlertsOn(s, h.id),
    lines,
    blocks,
    actions,
    primary,
    report: assetReport(s, role, h),
  };
}

/** the nightly-rate stepper (the island's nightly, ±$10), with this week's projected revenue either way */
export function ratesAct(s: IslandState): Act {
  const rb = rateBounds(ECON.baseNightly, s.receivership > 0);
  const step = 10;
  const n = s.rates.nightly;
  const at = (v: number) => projectWeek(s, { nightly: Math.max(rb.min, Math.min(rb.max, v)), charter: s.rates.charter }).revenue;
  const revenue = at(n);
  const ended = !!s.turns.fin?.ended;
  return { t: 'rates', nightly: n, charter: s.rates.charter, step, min: rb.min, max: rb.max, revenue, down: at(n - step) - revenue, up: at(n + step) - revenue, ok: !ended, ...(ended ? { why: 'Your turn is over: rates change next week.' } : {}) };
}

// ---------------------------------------------------------------------------
// The grid and the generator

/** the island panel's breaker schedule at this tier (the IR scan reads the same breakers) */
export function gridSchedule(s: IslandState): Extract<Block, { t: 'schedule' }> {
  const feeds: Record<string, string> = {
    main: 'the service',
    cfeedE: 'cottages 1–2',
    cfeedW: 'cottages 3–4',
    hangar: 'hangar lights, compressor, chargers',
    office: 'the office',
    dock: 'the fuel-dock pumps',
    xfer: 'the transfer switch',
    villas: 'the villas',
    lodge: 'the lodge',
    edge: 'the runway edge lights',
  };
  return { t: 'schedule', title: 'Breaker schedule', rows: HOME_PANEL.filter((b) => b.from <= Math.max(1, s.tier)).map((b) => ({ label: b.label, rating: `${b.amps} A`, wire: b.awg, note: feeds[b.id] ?? '' })) };
}

/** the rent that rides on the grid: this week's bookings (a grid-down week with no generator closes every house) */
const rentAtRisk = (s: IslandState): number => projectWeek(s).rental;

function gridFacts(s: IslandState, g: Asset, role: Role): Facts {
  const pw = powered(s);
  const gen = s.assets.find((a) => a.kind === 'generator');
  const live = liveAlerts(s).filter((x) => x.assetId === g.id);
  const lines: Line[] = [];
  const blocks: Block[] = [];
  const actions: Act[] = [];
  let primary: Act | null = null;
  let status: string;
  const tone: Tone = pw.gridDown ? 'rust' : '';
  const houses = s.assets.filter((a) => a.kind === 'house').length;
  if (role === 'elec') {
    status = pw.gridDown ? (pw.genOK ? 'Down: the generator is carrying the island' : gen ? "Down, and the generator can't pick it up: the island is dark" : 'Down: the island is dark (no generator yet)') : 'Live: the island is on the utility';
    lines.push({ text: `Feeds ${plural(houses, 'house')}, the hangar, the office${s.tier >= 5 ? ', the fuel dock and the runway edge lights' : ' and the fuel dock'}.` });
    lines.push({ text: !gen ? 'No backup generator yet: it comes with tier 3.' : pw.genOK ? (pw.gridDown ? 'The generator is carrying the backed-up load.' : 'The generator stands by: the transfer switch is on the utility.') : 'The generator is unreliable (under 50): it would not pick up the load.', tone: gen && !pw.genOK ? 'rust' : '' });
    for (const x of live.filter((x) => x.role === 'elec')) actions.push(alertAct(s, x, role));
    if (!live.some((x) => x.role === 'elec')) lines.push({ text: 'No open alerts on it.' });
    blocks.push(gridSchedule(s));
    primary = checkAct(s, role, g, lines);
  } else if (role === 'mech') {
    status = pw.gridDown ? 'Down: hangar tools offline' : 'Live: hangar tools on';
    lines.push({ text: pw.gridDown ? 'Grid down: hangar tools offline, 1 hangar job this week (the part chain’s paperwork still goes through).' : 'Hangar power on: the tools, the compressor and the cart chargers.', tone: pw.gridDown ? 'rust' : '' });
    if (pw.gridDown) lines.push({ text: pw.genOK ? 'The generator keeps the lights and the chargers on.' : 'The cart chargers are dead until the grid or the generator is back.' });
  } else {
    const risk = rentAtRisk(s);
    const pnl = assetPnl(s, g.id, 13);
    status = pw.gridDown ? (pw.on ? 'Down: the generator is carrying it' : 'Down: the houses are dark') : `Live · ${money(risk)} of rent rides on it this week`;
    lines.push({ text: `A grid-down week closes every house unless the generator carries it: about ${money(risk)} of rent this week.` });
    lines.push({ text: !gen ? 'No generator yet to carry it (tier 3).' : pw.genOK ? 'The generator would carry it.' : 'The generator is unreliable: it would not.', tone: gen && !pw.genOK ? 'rust' : '' });
    lines.push({ text: repairsLine(pnl) });
    for (const o of openReports(s).filter((o) => o.report!.key === 'utilityAutopay')) lines.push({ text: reportWords(s, o, role), tone: 'rust' });
  }
  // G0: the Harbor's service upgrade (a new pad-mount transformer and feeder) under its warranty
  const wl = role === 'mech' ? null : warrantyLine(s, g);
  if (wl) lines.push({ text: wl.text, tone: wl.tone });
  return {
    name: g.name,
    where: `${MODELS[g.model]?.label ?? 'Grid'} · ${stationName(s, HOME)}`,
    status,
    tone,
    health: { value: g.health, label: 'Reliability' },
    alerts: openAlertsOn(s, g.id),
    lines,
    blocks,
    actions,
    primary,
    report: assetReport(s, role, g),
  };
}

/** the generator as installed (the electrician's): its transfer switch and main from the generator house's schedule (after the Resort's upgrade: G0) */
function genInstalled(s: IslandState): string {
  const up = genUpgraded(s);
  const panel = genPanel(up);
  const x = panel.find((b) => b.id === 'xferG');
  const m = panel.find((b) => b.id === 'genbrk');
  return `${up ? 'Automatic transfer switch' : 'Transfer switch'} ${x?.amps ?? 60} A on ${x?.awg ?? '#6 Cu'} THWN; generator main ${m?.amps ?? 60} A on ${m?.awg ?? '#6 Cu'}${up ? ' (the Resort’s upgrade)' : ''}.`;
}
/** the belly tank as the set's plate reads it: 36 gal of diesel, about 0.95 gal an hour at the backed-up load (about 40 A at 240 V) */
const GEN_FUEL = { tank: 36, burn: 0.95 };

function genFacts(s: IslandState, g: Asset, role: Role): Facts {
  const pw = powered(s);
  const live = liveAlerts(s).filter((x) => x.assetId === g.id);
  const lines: Line[] = [];
  const blocks: Block[] = [];
  const actions: Act[] = [];
  let primary: Act | null = null;
  let status: string;
  let tone: Tone = '';
  const fan = openReports(s).filter((o) => o.report!.key === 'genFan');
  if (role === 'mech') {
    const mine = live.filter((x) => x.role === 'mech');
    status = `Its engine: ${mine.length ? plural(mine.length, 'open alert') : fan.length ? 'the fan report open' : 'nothing open'}`;
    tone = g.health < 50 || mine.length || fan.length ? 'rust' : '';
    for (const o of fan) lines.push({ text: reportWords(s, o, role), tone: 'rust' });
    for (const x of mine) actions.push(alertAct(s, x, role));
    lines.push({ text: `The transfer switch and the weekly test run are ${nameOf(s, 'elec')}'s.` });
    primary = checkAct(s, role, g, lines);
  } else if (role === 'elec') {
    status = pw.gridDown ? (pw.genOK ? 'Carrying the island' : "Unreliable: it can't carry the load") : pw.genOK ? 'Standing by' : "Unreliable (under 50): it won't pick up the load";
    tone = pw.genOK ? '' : 'rust';
    lines.push({ text: genInstalled(s) });
    lines.push({ text: `Fuel: the ${GEN_FUEL.tank} gal belly tank topped up after each test run, about ${Math.round(GEN_FUEL.tank / GEN_FUEL.burn)} h at the backed-up load.` });
    for (const x of live.filter((x) => x.role === 'elec')) actions.push(alertAct(s, x, role));
    if (!live.some((x) => x.role === 'elec')) lines.push({ text: 'The weekly test: nothing open on it.' });
    primary = checkAct(s, role, g, lines);
    actions.push(tagAct(s, role, g, 'Red-tag'));
  } else {
    const risk = rentAtRisk(s);
    const pnl = assetPnl(s, g.id, 13);
    status = pw.genOK ? `Protects about ${money(risk)} of rent on a grid-down week` : 'Unreliable: it would not carry a grid-down week';
    tone = pw.genOK ? '' : 'rust';
    lines.push({ text: `A grid-down week with it working keeps about ${money(risk)} of rent coming in.` });
    lines.push({ text: repairsLine(pnl) });
    for (const o of fan) lines.push({ text: reportWords(s, o, role), tone: 'rust' });
  }
  // G0: the Resort's bigger standby set and transfer switch (or a new generator house from the Harbor on) under its warranty
  const wl = warrantyLine(s, g);
  if (wl) lines.push({ text: wl.text, tone: wl.tone });
  return {
    name: g.name,
    where: `${MODELS[g.model]?.label ?? 'Generator'} · ${stationName(s, HOME)}`,
    status,
    tone,
    health: { value: g.health, label: 'Reliability' },
    alerts: openAlertsOn(s, g.id),
    lines,
    blocks,
    actions,
    primary,
    report: assetReport(s, role, g),
  };
}

// ---------------------------------------------------------------------------
// Fixtures: the hangar, the office, the runway, fuel, the E-stop, the dock, the windsock, a terminal

/** the report keys whose trouble is a fixture's (select.ts's fixtureFacts reads the same) */
const FIXTURE_REPORTS: Partial<Record<ObjectKind, string[]>> = {
  hangar: ['hangarLights', 'compressor', 'charger', 'hangarGpu', 'gpuCable'],
  office: ['officeOutlets'],
  fuel: ['avgas'],
};
/** "About the hangar: " */
const ABOUT: Partial<Record<ObjectKind, string>> = {
  hangar: 'the hangar',
  office: 'the office',
  runway: 'the runway',
  fuel: 'the fuel dock',
  estop: 'the fuel E-stop',
  dock: 'the dock',
  windsock: 'the weather',
  terminal: 'the terminal',
};

function fixtureFactsFor(s: IslandState, ref: ObjectRef, role: Role): Facts {
  const kind = ref.kind;
  const lines: Line[] = fixtureFacts(s, kind, ref.st, role).lines.map((text) => ({ text, tone: text.startsWith('Open:') ? ('rust' as Tone) : ('' as Tone) }));
  const blocks: Block[] = [];
  const actions: Act[] = [];
  let primary: Act | null = null;
  const reports = openReports(s).filter((o) => (FIXTURE_REPORTS[kind] ?? []).includes(o.report!.key));
  // the report jobs are open to their fixer (the job) and to the techs (its status); the analyst's desk shows hers
  if (role !== 'fin') for (const o of reports) actions.push({ t: 'order', order: o.id, label: o.role === role ? o.title : `${o.title}: its status`, sub: o.role === role ? `yours · ${orderState(s, o)}` : `${nameOf(s, o.role)}'s · ${orderState(s, o)}` });
  let status = '';
  if (kind === 'hangar') {
    const pw = powered(s);
    status = pw.gridDown ? (pw.on ? 'Grid down: on the generator, tools offline' : 'Dark: grid down, no generator') : reports.length ? `${plural(reports.length, 'report')} open on it` : 'No reports open';
    if (role === 'mech') {
      const inside = s.assets.filter((p) => p.kind === 'plane' && (isAog(s, p.id) || isTagged(s, p.id))).map((p) => p.name);
      lines.push({ text: inside.length ? `In the hangar: ${inside.join(', ')} (on the ground).` : 'The hangar floor is clear: every plane is on the line.' });
      blocks.push({ t: 'carts', rows: gseCarts(s).map((c) => ({ id: c.id, name: c.name, charge: Math.round(c.charge), where: cartWhere(s, c), cable: cableWords(c), tagged: !!cableReport(s, c.id) })) });
      primary = { t: 'gse', cart: null, label: 'Ground power ▸' };
      actions.push({ t: 'stores', label: 'Stores' });
    }
    if (role === 'elec') actions.push({ t: 'stores', label: 'Stores' });
    if (role === 'fin') primary = { t: 'desk', desk: 'stock', label: 'Stock ▸' };
  } else if (kind === 'office') {
    status = `${nameOf(s, 'fin')}'s office${reports.length ? `: ${plural(reports.length, 'report')} open` : ''}`;
    if (role === 'fin') {
      // the stats block says the cash and the runway: the select line saying them again goes
      lines.splice(0, lines.length, ...lines.filter((l) => !l.text.startsWith('Cash ')));
      const proj = projectWeek(s);
      const rw = runway(s);
      const sp = spendable(s);
      blocks.push({ t: 'stats', items: [{ label: 'Cash', value: money(s.cash), tone: s.cash < ECON.freezeBelow ? 'rust' : '' }, { label: 'Spendable', value: money(sp), tone: sp < ECON.freezeBelow ? 'rust' : '' }, { label: 'Runway', value: `${rw.weeks} wk` }] });
      // one fixed-cost figure (review round 1): the runway's, with the loan's payments said on their own
      const loan = s.loan?.weekly ?? 0;
      status = `This week: about ${money(proj.revenue)} in, ${money(rw.weekly)} of fixed costs out`;
      lines.unshift({ text: `Runway: spendable covers ${rw.weeks} weeks of the fixed costs (${money(rw.weekly)} a week: overhead, payroll, insurance${loan ? `, and ${money(loan)} of loan payments` : ''}).` });
      primary = { t: 'desk', desk: 'approvals', label: 'Desk ▸' };
    }
  } else if (kind === 'runway' || kind === 'fuel' || kind === 'estop' || kind === 'dock' || kind === 'terminal') {
    // the first thing it says is its status line; the rest are its lines
    const first = lines.findIndex((l) => !l.text.startsWith('Open:'));
    status = first >= 0 ? lines.splice(first, 1)[0].text.replace(/\.$/, '') : reports.length ? plural(reports.length, 'report') + ' open' : OBJECT_LABEL[kind];
  } else if (kind === 'windsock') {
    // the weather in the seat's terms (select's line says the weather itself: it goes)
    const W = { clear: 'Clear skies', wind: 'Wind', storm: 'A storm' }[s.weather];
    status =
      role === 'elec'
        ? s.weather === 'storm'
          ? `${W} this week: the houses and the grid take it at the resolve`
          : `${W} this week`
        : s.weather === 'clear'
          ? `${W}: a full week of flying`
          : s.weather === 'wind'
            ? `${W}: a flight less a plane this week`
            : `${W}: half the flights this week`;
    lines.splice(0, lines.length, ...lines.filter((l) => !l.text.startsWith('This week:')));
    if (role === 'fin') {
      const inc = s.history.reduce((n, h) => n + h.incidents.length, 0);
      const paid = s.history.reduce((n, h) => n + (h.costs.incidents ?? 0), 0);
      lines.push({ text: `This season: ${plural(inc, 'incident')}, ${money(paid)} paid after the cover (${INSURANCE[s.insurance].label}).` });
    }
  } else status = OBJECT_LABEL[kind];
  if (!lines.length) lines.push({ text: ref.st === HOME ? 'Nothing to report here.' : 'Not on this island.' });
  const about = ABOUT[kind] ?? OBJECT_LABEL[kind].toLowerCase();
  return {
    name: FIXTURE_NAME[kind] ?? OBJECT_LABEL[kind],
    where: stationName(s, ref.st),
    status,
    tone: reports.length || status.startsWith('Dark') ? 'rust' : '',
    lines,
    blocks,
    actions,
    primary,
    report: { t: 'dm', head: reports.length || kind === 'windsock' ? 'Tell the crew' : `Something wrong with ${about}?`, dms: dmsFrom(s, role, about) },
  };
}

// ---------------------------------------------------------------------------
// Carts, staff figures and build sites

function cartFacts(s: IslandState, ref: ObjectRef, role: Role): Facts {
  const c = gseCarts(s).find((x) => x.id === ref.id);
  if (!c) return missing(s, ref);
  const rep = cableReport(s, c.id);
  const lines: Line[] = [{ text: `${cartWhere(s, c)} · ${Math.round(c.charge)}% charge.` }, { text: `${cableWords(c)}.` }];
  const actions: Act[] = [];
  if (rep) {
    lines.push({ text: `Tagged out: a new plug is ${rep.role === role ? 'yours to fit' : `${nameOf(s, rep.role)}'s to fit`}.`, tone: 'rust' });
    if (role !== 'fin') actions.push({ t: 'order', order: rep.id, label: rep.role === role ? rep.title : `${rep.title}: its status`, sub: orderState(s, rep) });
  }
  return {
    name: c.name,
    where: `${OBJECT_LABEL.cart} · ${stationName(s, ref.st)}`,
    status: cartWhere(s, c),
    tone: rep ? 'rust' : '',
    lines,
    blocks: [],
    actions,
    primary: role === 'mech' ? { t: 'gse', cart: c.id, label: 'Ground power ▸' } : null,
    report: role === 'mech' ? null : { t: 'dm', head: `The carts are ${nameOf(s, 'mech')}'s`, dms: dmsFrom(s, role, c.name, ['mech']) },
  };
}

/** the npc a staff figure is (its id), or the first of that role (a figure that names its role) */
function npcOf(s: IslandState, id: string): Npc | undefined {
  const crew = crewOf(s);
  return crew.find((n) => n.id === id) ?? crew.find((n) => n.role === id);
}

function staffFacts(s: IslandState, ref: ObjectRef, role: Role): Facts {
  const n = npcOf(s, ref.id);
  if (!n) return missing(s, ref);
  const name = n.name || `The ${ROLE_WORD[n.role].toLowerCase()}`;
  const lines: Line[] = [];
  const actions: Act[] = [];
  let primary: Act | null = null;
  const blocks: Block[] = [{ t: 'person', name, role: ROLE_WORD[n.role], skill: n.skill, doing: doingNow(s, n), ...(role === 'fin' ? { wage: n.wage } : {}) }];
  if (role === 'fin') {
    if (n.id.startsWith('std-')) lines.push({ text: `One of the standard crew for tier ${s.tier}: on the contract, not a hire of yours.` });
    const board = s.hiring?.week === s.week ? s.hiring.cands.filter((c) => c.role === n.role) : [];
    const best = board.map((c) => ({ c, e: staffEffect(s, c, 'hire') })).sort((a, b) => b.e.net - a.e.net)[0];
    // a solid Hire only when the hire pays (review round 1: a spare at "$210 a week · no new income" was the big button)
    if (best && best.e.net > 0) primary = hireAct(s, best.c, best.e);
    else if (best) lines.push({ text: `Another ${ROLE_WORD[n.role].toLowerCase()} wouldn't pay for their wage this week (${best.e.money}): this week's candidates are on the Hiring board.` });
    else lines.push({ text: `No ${ROLE_WORD[n.role].toLowerCase()} on this week's hiring board.` });
    if (!n.id.startsWith('std-') && s.staff?.some((x) => x.id === n.id)) actions.push(letGoAct(s, n));
    actions.push({ t: 'desk', desk: 'staff', label: 'Hiring board', sub: 'The desk’s Staff tab: every candidate this week', at: 'hiring' });
  } else {
    lines.push({ text: `On the island's payroll: ${nameOf(s, 'fin')} hires and lets go.` });
  }
  return {
    name,
    where: `${ROLE_WORD[n.role]} · ${stationName(s, ref.st)}`,
    status: `${ROLE_WORD[n.role]} · skill ${n.skill}`,
    lines,
    blocks,
    actions,
    primary,
    report: role === 'fin' ? null : { t: 'dm', head: `The staff are ${nameOf(s, 'fin')}'s to hire`, dms: dmsFrom(s, role, name, ['fin']) },
  };
}

function hireAct(s: IslandState, c: Candidate, e: ReturnType<typeof staffEffect>): Act {
  // as the engine takes a hire (staff.ts staffAction): the board stays open after End turn, like the cards
  const full = (s.staff ?? []).length >= STAFF.maxStaff;
  const ok = s.receivership === 0 && !full;
  return {
    t: 'hire',
    cand: c.id,
    name: c.name,
    role: ROLE_WORD[c.role],
    skill: c.skill,
    ask: c.ask,
    start: c.start,
    does: e.does,
    need: e.need,
    money: e.money,
    net: e.net,
    ok,
    ...(ok ? {} : { why: s.receivership > 0 ? 'In receivership: no new hires until it ends.' : 'No room on the island for more staff.' }),
  };
}

function letGoAct(s: IslandState, n: Npc): Act {
  const e = staffEffect(s, n, 'letGo');
  const sev = severanceOf(s, n);
  const short = sev > 0 && spendable(s) < sev;
  return { t: 'letGo', npc: n.id, name: n.name, severance: sev, need: e.need, money: e.money, ok: !short, ...(short ? { why: `Not enough spendable cash for the severance (${money(sev)}).` } : {}) };
}

function siteFacts(s: IslandState, ref: ObjectRef, role: Role): Facts {
  const open = openBuild(s);
  const asked = ref.id === 'project' ? undefined : (s.builds ?? []).find((x) => x.id === ref.id);
  // a finished build's site is the building now; any other ref is the open build's site
  const built = asked && asked.finished !== undefined ? asked : undefined;
  // the site of a build waiting its turn (the next tier's, while the builders finish another) is that build's
  const b = built ?? asked ?? open;
  const elsewhere = !!b && !!open && b.id !== open.id;
  const bl = buildLine(s, role);
  const lines: Line[] = [];
  const blocks: Block[] = [];
  const actions: Act[] = [];
  let primary: Act | null = null;
  if (built) lines.push({ text: `Built by the builders: it joined the island in week ${built.finished}.` });
  if (bl) lines.push({ text: built || elsewhere ? `Now: ${bl.text}` : bl.text, tone: bl.tone === 'wait' ? 'amber' : '' });
  else if (!built && !b) lines.push({ text: crewOf(s).some((n) => n.role === 'builder') ? 'The builders have nothing on site this week.' : 'No builders on the payroll.' });
  const p = s.project;
  if (p) {
    const rows = (['mech', 'elec', 'fin'] as Role[])
      .filter((r) => p.orders[r])
      .map((r) => {
        const o = s.orders.find((x) => x.id === p.orders[r]);
        return { who: nameOf(s, r), role: r, job: o?.title ?? 'a job', state: o ? orderState(s, o) : 'done', mine: r === role };
      });
    blocks.push({ t: 'project', title: p.title, rows });
    const mine = p.orders[role] ? s.orders.find((x) => x.id === p.orders[role]) : undefined;
    if (mine && role !== 'fin' && mine.status === 'ready') actions.push({ t: 'order', order: mine.id, label: `Your project job: ${mine.title}`, sub: orderState(s, mine) });
  }
  if (role === 'fin') {
    if (bl?.buy?.lines.length) primary = { t: 'buy', lines: bl.buy.lines, usd: bl.buy.cost, label: `Buy the next unit's materials · ${money(bl.buy.cost)}` };
    if (s.tier >= 3) {
      const plan = cottagePlan(s);
      if (plan.plot) {
        const short = spendable(s) < COTTAGE_SHELL;
        const ok = !short && s.receivership === 0;
        const act: Act = {
          t: 'build',
          label: `Start ${plan.plot.name} · ${money(COTTAGE_SHELL)}`,
          usd: COTTAGE_SHELL,
          text: plan.payback ? `An extra cottage: ${money(plan.cost)} in all, rents about ${money(plan.rent)} a week, pays back in about ${plural(plan.payback, 'week')}.` : `An extra cottage: ${money(plan.cost)} in all; at this week's bookings it would sit empty.`,
          ok,
          ...(ok ? {} : { why: s.receivership > 0 ? 'In receivership: no new builds.' : `Needs ${money(COTTAGE_SHELL)} of spendable cash.` }),
        };
        if (primary) actions.push(act);
        else primary = act;
      }
    }
    actions.push({ t: 'desk', desk: 'staff', label: 'Site work', sub: 'The desk’s Staff tab: the builders and what they need', at: 'site-work' });
  }
  return {
    name: b ? cap1(buildSite(b, s)) : OBJECT_LABEL.site,
    where: `${OBJECT_LABEL.site} · ${stationName(s, ref.st)}`,
    status: built ? `Finished in week ${built.finished}` : b ? `${Math.floor(b.done + 1e-9)} of ${plural(b.need, 'unit')} done${b.tier ? ` (for tier ${b.tier})` : ''}` : 'No site work open',
    tone: !built && !elsewhere && bl?.tone === 'wait' ? 'amber' : '',
    lines,
    blocks,
    actions,
    primary,
    report: role === 'fin' ? null : { t: 'dm', head: `The builders are ${nameOf(s, 'fin')}'s`, dms: dmsFrom(s, role, b ? buildSite(b, s) : 'the build site', ['fin']) },
  };
}

function missing(s: IslandState, ref: ObjectRef): Facts {
  return { name: OBJECT_LABEL[ref.kind], where: stationName(s, ref.st), status: "It isn't there any more.", lines: [], blocks: [], actions: [], primary: null, report: null, missing: true };
}

// ---------------------------------------------------------------------------
// The one entry point

/**
 * What `role` sees on the object `ref` and can do there (6.3). Home only in stage 2: a station's objects and the
 * region's station and route refs are stage 3's (D's sheets take them).
 */
export function facts(s: IslandState, ref: ObjectRef, role: Role): Facts {
  switch (ref.kind) {
    case 'plane':
    case 'house':
    case 'grid':
    case 'generator': {
      const a = s.assets.find((x) => x.id === ref.id);
      if (!a || a.kind !== ref.kind) return missing(s, ref);
      if (a.kind === 'plane') return planeFacts(s, a, role);
      if (a.kind === 'house') return houseFacts(s, a, role);
      if (a.kind === 'grid') return gridFacts(s, a, role);
      return genFacts(s, a, role);
    }
    case 'cart':
      return cartFacts(s, ref, role);
    case 'staff':
      return staffFacts(s, ref, role);
    case 'site':
      return siteFacts(s, ref, role);
    case 'station':
    case 'route':
      return { ...missing(s, ref), status: 'The airline comes after the Resort.' };
    default:
      return fixtureFactsFor(s, ref, role);
  }
}

/** every line and block text of the facts (the tests' hidden-state sweep reads it) */
export function factsText(f: Facts): string {
  const out: string[] = [f.name, f.where, f.status, ...f.lines.map((l) => l.text)];
  for (const b of f.blocks) out.push(JSON.stringify(b));
  for (const a of [...f.actions, ...(f.primary ? [f.primary] : [])]) out.push(JSON.stringify(a));
  if (f.report) out.push(JSON.stringify(f.report));
  return out.join('\n');
}

export { TRADE };
