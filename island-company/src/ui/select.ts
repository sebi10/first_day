// UI-side derived data: who is blocking whom, what to launch for an order.
import type { PuzzleId } from '../puzzles/types';
import { aircraftOf, type Aircraft } from '../sim/aircraft';
import { ECON, MODELS, REPORT_BY_KEY, ROLE_LABEL } from '../sim/data';
import { forecastContext, listPrice } from '../sim/engine';
import { flightsAvailable, flightsPerPlane, houses, housesRentable, isBlind, isRework, launchTier, openReports, planes, powered, reportCap } from '../sim/econ';
import { toolsFor } from '../sim/progression';
import { hashSeed } from '../sim/rng';
import type { Asset, IslandState, Order, Role } from '../sim/types';
import type { PuzzleLaunch } from './puzzlehost';

export type Block = { from: Role; to: Role; text: string };

export function blocks(s: IslandState): Block[] {
  const out: Block[] = [];
  const pending = s.orders.filter((o) => o.status === 'pending' && o.role !== 'fin' && o.lastDeferredWeek !== s.week);
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
  // a crewmate's report: the fixer holds the reporter up until it's fixed
  for (const o of openReports(s)) {
    const rep = o.report!;
    if (rep.by === o.role || !s.players[rep.by]) continue;
    out.push({ from: o.role, to: rep.by, text: `${reportSaid(o)}${rep.effect === 'cap' ? ` (${capWords(rep.by)})` : ` (−\u2060$${rep.amount.toLocaleString('en-US')}/wk)`}` });
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

/**
 * The island's own airplane: identity, logbooks, IPC and AMM, derived from the
 * island seed and the asset (never stored in the island doc). Building one
 * writes years of logbooks, so each is built once and kept.
 */
const fleet = new Map<string, Aircraft>();
export function islandAircraft(seed: number, asset: Pick<Asset, 'id' | 'model'>): Aircraft {
  const key = `${seed}|${asset.id}|${asset.model}`;
  let ac = fleet.get(key);
  if (!ac) {
    // a device only ever sees a few islands: a small cap keeps a long session bounded
    if (fleet.size >= 12) fleet.clear();
    fleet.set(key, (ac = aircraftOf(seed, asset.id, asset.model)));
  }
  return ac;
}

export function launchFor(s: IslandState, o: Order, role: Role, assist = false): PuzzleLaunch {
  const p = s.players[role];
  const grace = !assist && p && s.week <= p.graceUntil;
  const asset = s.assets.find((a) => a.id === o.assetId);
  // lending a hand always plays at expert level: real trade knowledge is the gate
  const tier = launchTier(s, o, role, assist);
  // a real job at tier 2+: no verdict now, it shows up later
  const blind = isBlind(s, o, role, assist);
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
          later: asset
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
