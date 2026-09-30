// The island engine: a pure, deterministic reducer. Every client (and the
// balance sim) runs the same code, so any phone can resolve a week and get
// byte-identical results from the same inputs + seed.
import {
  ALERTS,
  CATALOG,
  CATALOG_BY_KIND,
  CHAIN,
  CABLE_BAND,
  CABLE_REPORT,
  DEFECT,
  defectRule,
  defectVariant,
  ECON,
  FIN_TASKS,
  FLOAT_AUCTION,
  FREIGHT,
  GOAL,
  GSE,
  incidentText,
  inspects,
  INSPECTS,
  INSURANCE,
  MODELS,
  PROJECTS,
  PROJECT_COVER,
  REPORT,
  REPORT_BY_KEY,
  RECEIVER,
  REPORTS,
  ROLE_LABEL,
  STOCK,
  STORIES,
  STORM_HIT,
  SUPPLIERS,
  TIERS,
  WARRANTY,
  type ReportDef,
} from './data';
import {
  alertFlags,
  alertShort,
  alertTier,
  breakerOf,
  causeOf,
  findingOf,
  fixesOf,
  flagSource,
  generateAlerts,
  liveAlerts,
  needsOf,
  pruneAlerts,
  raiseAlert,
  siteOf,
  symptomOf,
  symptomText,
} from './alerts';
import { acOf, assignSlots, bomValue, cardOf, earlyLess, earlyTier, fillOf, fixTaskFor, installCheck, judgeElecPick, judgeSlot, laborCost, planTask, realFault, repairLabor, stdPick } from './flow';
import { canCheck, checkDid, checkReviewLines, checkView, flagCheck, flagPick, raiseCheckWriteUp, raiseFlag } from './checks';
import { CHECK_ROWS } from './checkdata';
import { itemById, priceAt } from './items';
import { book, bookAog, bookFill, bookWait, closeLedger, spendable } from './ledger';
import { migrate, retireOldSwitch } from './migrate';
import {
  addStarter,
  allOnHand,
  allocate,
  auctionLot,
  available,
  binFree,
  binsInUse,
  binsTotal,
  cardBuyLines,
  carryCost,
  consume,
  dueJob,
  forgetDerived,
  invoiceContext,
  isSafetyJob,
  jobLines,
  jobReady,
  lateSafe,
  needsNewBin,
  newReq,
  payRun,
  placePo,
  prunePurchasing,
  receive,
  release,
  replenish,
  reserve,
  restockFeeOf,
  schedFreight,
  scrapItem,
  takeSoft,
  uncovered,
  urgentJob,
  urgentReq,
  vendorFor,
} from './stock';
import { builtShare, buildWeek, charterMult, helperOn, housekeepingCap, newIslandStaff, payroll, pilotCap, renoSignoff, reviewMult, STAFF, staffAction, staffAfterFlights, staffOpenWeek, autoStaff, working } from './staff';
import { benchFor, defaultTask, defaultTaskNo, fixedFor, laborMin, plannable, taskById, taskOn, tasksFor, type Task } from './tasks';
import {
  aStreakAfter,
  goalMet,
  goalWindow,
  atResort,
  pausedWeek,
  alertAog,
  cableBand,
  cableReport,
  capFleet,
  capOf,
  chainAog,
  charterLoad,
  clamp,
  fixedNow,
  hazardOn,
  isAog,
  melOn,
  rentFactor,
  subCharterNeed,
  subCharterOn,
  subCharterWords,
  isTagged,
  outOfService,
  renovating,
  renoAwaitingFinal,
  closingHazard,
  isBlind,
  isRework,
  SIGNOFF,
  credit,
  workCredit,
  defectChance,
  defectSeverity,
  deferralRisk,
  openReports,
  reportCap,
  grid,
  gseCarts,
  gseForStart,
  downtimeOf,
  hangarJobs,
  needsCart,
  startCart,
  houseBlocker,
  houseRentable,
  houses,
  bookInspection,
  decayOf,
  gridFirstAlert,
  gridFirstJob,
  storyEffect,
  houseWearOf,
  inspectionWeeks,
  onSchedule,
  projectCoverWeek,
  renewedInspection,
  occupancy,
  orderCost,
  orderTier,
  planeCapacity,
  flightsPerPlane,
  planes,
  powered,
  rateBounds,
  round10,
  season,
  tierDef,
  urgency,
} from './econ';
import { levelOf, orderXp, tierUnlocked } from './progression';
import {
  BENCH_TAGS,
  benchJob,
  chainAtaOf,
  chainFind,
  chainMove,
  engineeringFee,
  isAre,
  isChainStep,
  islandAircraft,
  itemName,
  judgePart,
  needsFreight,
  nomenOf,
  openChain,
  partPrice,
  plantedOn,
  plantFor,
  restockFee,
  rightPn,
} from './chain';
import { planeModel, type AnyAta, type Ata } from './aircraft';
import { hashSeed, rng, type Rng } from './rng';
import { nextDeadline } from './time';
import {
  ROLES,
  type Action,
  type Alert,
  type Asset,
  type BuyChoice,
  type CableBand,
  type Defect,
  type FeedEvent,
  type GseCart,
  type Grade,
  type Incident,
  type IslandState,
  type ItemId,
  type JobFlow,
  type Liner,
  type NpcRole,
  type OpsRole,
  type Order,
  type PartChain,
  type PickLine,
  type Player,
  type ReportLine,
  type Requisition,
  type Role,
  type TurnState,
  type WeekReport,
} from './types';

export type ApplyResult = { s: IslandState; error?: string };

/**
 * The engine version this build writes. An island a newer build has written is
 * never written by an older one (it would drop or undo what it doesn't know
 * about): apply() refuses and asks for a reload. Bump it with any change to
 * what the island doc means; firestore.rules keeps builds from before this
 * existed out (they write v:1).
 */
export const ENGINE_VERSION = 5;

const OPS: OpsRole[] = ['mech', 'elec'];

// ---------------------------------------------------------------------------
// Creation

export function createIsland(o: {
  id: string;
  name: string;
  now: number;
  tz: string;
  seed?: number;
  creator: { uid: string; name: string; role: Role };
}): IslandState {
  const seed = o.seed ?? hashSeed(o.id, o.now);
  const s: IslandState = {
    v: 1,
    id: o.id,
    name: o.name,
    createdAt: o.now,
    creatorTz: o.tz,
    resolveHour: 20,
    seed,
    week: 0,
    deadline: null,
    tier: 1,
    cash: ECON.startCash,
    openCash: ECON.startCash,
    // the generic kits are retired: the starter shelf replaces them (19.3)
    parts: { stock: 0, inTransit: 0 },
    rates: { nightly: ECON.baseNightly, charter: ECON.baseCharter },
    insurance: 'standard',
    autoBudget: { mech: ECON.defaultAutoBudget, elec: ECON.defaultAutoBudget },
    autoSpent: { mech: 0, elec: 0 },
    assets: [],
    orders: [],
    players: {},
    turns: {},
    coversUsed: {},
    weather: 'clear',
    history: [],
    stats: {
      weeksBPlus: 0,
      streakBPlus: 0,
      perfectWeeks: 0,
      negCashStreak: 0,
      recentIncidents: [],
      totalWeeks: 0,
      tierReachedWeek: { 1: 0 },
    },
    receivership: 0,
    pendingBonus: null,
    story: null,
    modifiers: [],
    forecasts: [],
    feed: [],
    nextId: 1,
    updatedAt: o.now,
  };
  addTierAssets(s, 1, 0);
  s.gse = gseCarts(s);
  // the job flow (docs/JOBFLOW.md): the starter shelf and tools, purchasing, the ledger, the standard NPC crew
  s.inv = {};
  addStarter(s, 1);
  s.credit = 0;
  s.pos = [];
  s.reqs = [];
  s.eas = [];
  s.alerts = [];
  s.ledger = [];
  s.flowSince = 1;
  newIslandStaff(s);
  s.players[o.creator.role] = newPlayer(o.creator.uid, o.creator.name, o.creator.role, 0);
  s.players[o.creator.role]!.seatKey = seatKey(s, o.creator.role, o.creator.uid);
  feed(s, 'all', 'info', `${o.name} founded. Three seats, one island.`, o.now);
  return s;
}

export const seatHas = (p: Player, uid: string) => p.uid === uid || !!p.devices?.includes(uid);

/** Which seat does this device hold? */
export function seatOf(s: IslandState, uid: string): Role | null {
  for (const r of ROLES) {
    const p = s.players[r];
    if (p && seatHas(p, uid)) return r;
  }
  return null;
}

function seatKey(s: IslandState, role: Role, uid: string) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let h = hashSeed(s.seed, 'seat', role, uid);
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += alphabet[h % alphabet.length];
    h = Math.floor(h / alphabet.length) ^ hashSeed(h, i);
    h >>>= 0;
  }
  return out;
}

function newPlayer(uid: string, name: string, role: Role, xp: number, graceUntil = 0): Player {
  return {
    uid,
    name: name.slice(0, 20) || 'Player',
    role,
    xp,
    perfects: 0,
    week0Done: false,
    missedStreak: 0,
    cosmetic: role === 'mech' ? 'm0' : role === 'elec' ? 'e0' : 'f0',
    graceUntil,
    covers: 0,
  };
}

function startProject(s: IslandState) {
  const tier = s.tier + 1;
  const def = PROJECTS[tier];
  if (!def) return;
  const orders: Partial<Record<Role, string>> = {};
  for (const role of ROLES) {
    const j = def.jobs[role];
    const o = newOrder(s, { role, kind: 'project', assetId: null, title: j.title, puzzle: j.puzzle, tier: clamp(Math.max(3, s.tier + 1), 1, 5), cost: 0, parts: 0, gain: 0, status: 'ready' });
    orders[role] = o.id;
  }
  s.project = { tier, title: def.title, orders };
  feed(s, 'all', 'good', `The island qualifies for tier ${tier}. Crew project: ${def.title}. One job each.`, s.updatedAt);
}

/**
 * An away seat's crew project part, at the resolve (step 1): once it has waited PROJECT_COVER.wait weeks and the seat
 * has missed every resolve of that wait (projectCoverWeek), autopilot does it by the book at 50%, for a seat played in
 * the last PROJECT_COVER.recent weeks. The tier arrives at step 16. The floatplane auction (the analyst's tier-4 part)
 * is bought at the fair price, as a human winner pays the bid: when that would take spendable cash under the freeze
 * line, it waits, and the review says why (fix round 1).
 */
function coverProject(s: IslandState, role: Role, line: (role: ReportLine['role'], tone: ReportLine['tone'], text: string) => void) {
  // (at step 1, before this week's miss is counted: "played in the last 4 weeks" is a streak under 4 so far)
  const from = projectCoverWeek(s, role);
  const p = s.players[role];
  if (from === null || s.week < from || !p) return;
  const o = s.orders.find((x) => x.id === s.project!.orders[role])!;
  const away = p.missedStreak + 1;
  let paid = '';
  if (o.puzzle === 'auction') {
    const fair = FLOAT_AUCTION.fair;
    if (spendable(s) - fair < ECON.freezeBelow) {
      line('all', 'bad', `${p.name} was away ${away} weeks running, but autopilot can't buy the floatplane at the fair price (${usd(fair)}) without taking spendable cash under ${usd(ECON.freezeBelow)}: ${o.title} waits.`);
      return;
    }
    s.cash -= fair;
    book(s, 'building', fair, { trade: 'fin' });
    paid = `, won at the fair price, ${usd(fair)}`;
  }
  o.status = 'done';
  o.result = { score: PROJECT_COVER.score, perfect: false, credit: PROJECT_COVER.score, by: role, week: s.week, auto: true };
  line('all', 'info', `${p.name} was away ${away} weeks running: autopilot did ${p.name}'s part of the crew project by the book, at ${Math.round(PROJECT_COVER.score * 100)}%: ${o.title}${paid}.`);
}

function finishProjectIfDone(s: IslandState, now: number) {
  const p = s.project;
  if (!p) return;
  const parts = ROLES.map((r) => s.orders.find((o) => o.id === p.orders[r]));
  if (!parts.every((o) => o?.status === 'done')) return;
  const quality = parts.reduce((n, o) => n + (o!.result?.score ?? 0), 0) / parts.length;
  // a new tier can bring a ground power cart with it (the second one at tier 3)
  const had = new Set(gseCarts(s).map((c) => c.id));
  s.tier = p.tier;
  s.stats.tierReachedWeek[p.tier] = s.week;
  // the builders set how good the new buildings are (15.5); planes and the grid keep today's health
  const base = 60 + 30 * quality;
  const built = Math.round(base - 15 * (1 - builtShare(s, p.tier)));
  addTierAssets(s, p.tier, s.week, Math.round(base), built);
  // the service upgrade (WARRANTY.service): the Harbor's new transformer and feeder, the Resort's bigger standby set,
  // installed with the tier: at the new buildings' health (if it was below), under the builder's warranty
  const up = p.tier === 4 && WARRANTY.service.grid ? 'grid' : p.tier === 5 && WARRANTY.service.gen ? 'generator' : null;
  const svc = up ? s.assets.find((x) => x.kind === up) : undefined;
  if (svc) {
    svc.health = Math.max(svc.health, built);
    svc.touchedWeek = Math.max(svc.touchedWeek, s.week);
    svc.warrantyUntil = s.week + WARRANTY.weeks;
    if (up === 'generator') retireOldSwitch(s, svc);
  }
  // the new tier's spares come with it (19.3)
  addStarter(s, p.tier);
  s.project = null;
  feed(s, 'all', 'good', `Tier ${p.tier} unlocked: ${tierDef(p.tier).name}! Built together at ${Math.round(quality * 100)}% quality.`, now);
  s.gse = gseCarts(s);
  for (const c of s.gse) if (!had.has(c.id)) feed(s, 'mech', 'good', `${c.name} arrived for the hangar: on the charger, full.`, now);
}

function addTierAssets(s: IslandState, tier: number, week: number, health = 80, built = health) {
  const fresh = week === 0;
  for (const a of TIERS[tier - 1].adds) {
    if (s.assets.some((x) => x.id === a.id)) continue;
    const kind = MODELS[a.model].kind;
    s.assets.push({
      id: a.id,
      kind,
      model: a.model,
      name: a.name,
      health: fresh ? ECON.startHealth : kind === 'house' || kind === 'generator' ? built : health,
      touchedWeek: week,
      // the county books each house a week of its own (a tier's pair gets its notices a week apart)
      ...(kind === 'house' ? { inspectionUntil: bookInspection(s, a.id, week + inspectionWeeks(s.tier)) } : {}),
      // G0: new construction from WARRANTY.fromTier comes with its builder's warranty
      ...(!fresh && tier >= WARRANTY.fromTier && (kind === 'house' || kind === 'generator') ? { warrantyUntil: week + WARRANTY.weeks } : {}),
      ...(kind === 'plane' ? { sinceInspection: 4 } : {}),
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers

function feed(s: IslandState, role: FeedEvent['role'], tone: FeedEvent['tone'], text: string, now: number) {
  const id = (s.feed[s.feed.length - 1]?.id ?? 0) + 1;
  s.feed.push({ id, week: s.week, role, tone, text, at: now });
  if (s.feed.length > 60) s.feed.splice(0, s.feed.length - 60);
}

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const assetOf = (s: IslandState, o: Order) => s.assets.find((a) => a.id === o.assetId);
const open = (o: Order) => o.status !== 'done' && o.status !== 'cancelled';

function newOrder(s: IslandState, fields: Omit<Order, 'id' | 'createdWeek' | 'deferrals' | 'lastDeferredWeek' | 'seed'>): Order {
  const id = `o${s.nextId++}`;
  const o: Order = {
    ...fields,
    id,
    createdWeek: s.week,
    deferrals: 0,
    lastDeferredWeek: null,
    seed: hashSeed(s.seed, id),
  };
  s.orders.push(o);
  return o;
}

/** a legacy card approved (no flow): its cost leaves the bank; the kits are retired, so it is ready (a part chain's card moves the chain on) */
function markApproved(s: IslandState, o: Order, auto: boolean) {
  s.cash -= o.cost;
  if (o.cost) book(s, o.chain?.step === 'fee' ? 'eng' : o.chain?.step === 'buy' ? 'parts' : 'labor', o.cost, { trade: o.role === 'fin' ? 'fin' : o.role, asset: o.assetId });
  o.approvedWeek = s.week;
  o.autoApproved = auto;
  o.pushedBack = false;
  o.counter = undefined;
  o.parts = 0;
  o.status = 'ready';
}

function gainXp(s: IslandState, role: Role, xp: number) {
  const p = s.players[role];
  if (!p) return;
  const before = levelOf(p.xp);
  p.xp += xp;
  const after = levelOf(p.xp);
  if (after > before) feed(s, role, 'good', `${p.name} reached level ${after}.`, s.updatedAt);
}

export function canResolve(s: IslandState, now: number) {
  if (s.week < 1) return false;
  const allIn = ROLES.every((r) => s.turns[r]?.ended);
  return allIn || (s.deadline !== null && now >= s.deadline);
}

// ---------------------------------------------------------------------------
// Reducer

/**
 * A deep copy of plain data (the island doc is JSON: objects, arrays, primitives). About four times
 * faster than structuredClone on a full island, and every move clones one (the paper sim makes
 * thousands a season). Keys holding undefined are kept, as structuredClone keeps them.
 */
export function cloneState<T>(v: T): T {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) {
    const n = v.length;
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = cloneState(v[i]);
    return out as T;
  }
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v as object)) out[k] = cloneState((v as Record<string, unknown>)[k]);
  return out as T;
}

export function apply(prev: IslandState, a: Action, now: number): ApplyResult {
  const r = applyMove(prev, a, now);
  // a move can read the memoized analytics part way and then change the island: whoever reads the result recomputes them
  if (r.s !== prev) forgetDerived(r.s);
  return r;
}

function applyMove(prev: IslandState, a: Action, now: number): ApplyResult {
  const fail = (error: string): ApplyResult => ({ s: prev, error });
  // written by a newer build: this one would lose what it doesn't know about
  if ((prev.engine ?? 0) > ENGINE_VERSION) return fail('This island was saved by a newer version of Island Company. Reload the app to keep playing.');
  const s = cloneState(prev);
  // an island saved before the job flow gets its stock, its jobs and its crew (idempotent)
  migrate(s);
  s.updatedAt = now;
  s.engine = ENGINE_VERSION;
  // an older build (or a second device) may have cancelled a chain step's order or moved its job: put back what's missing
  const chain = openChain(s);
  if (chain) healChain(s, chain, now);
  // a move made in an earlier week (queued offline, or a puzzle still open at the deadline)
  if (a.t !== 'resolve' && 'week' in a && typeof a.week === 'number' && a.week !== s.week) {
    // the part chain's paperwork and checks wait for a person: they are still open in the new week
    const o = a.t === 'complete' ? s.orders.find((x) => x.id === a.orderId) : undefined;
    if (o && isChainStep(o) && o.status === 'ready') {
      const what = o.chain!.step === 'lookup' ? 'IPC lookup' : o.chain!.step === 'research' ? 'logbook research' : 'circuit check';
      return fail(`Week ${a.week} closed before that synced. The ${what} is still waiting in week ${s.week} (autopilot doesn't do it): hand it in again.`);
    }
    return fail(`Week ${a.week} closed before that synced; autopilot covered what was left. You're in week ${s.week} now.`);
  }

  switch (a.t) {
    case 'join': {
      const cur = s.players[a.role];
      if (cur && seatHas(cur, a.uid)) return { s: prev };
      if (Object.values(s.players).some((p) => p && p.role !== a.role && seatHas(p, a.uid)))
        return fail('You already hold another seat on this island.');
      if (cur && cur.uid.startsWith('pp-')) {
        // a pass-and-play seat moved online: first claimer takes it, progress intact
        cur.uid = a.uid;
        cur.name = a.name.slice(0, 20) || cur.name;
        cur.seatKey = seatKey(s, a.role, a.uid);
        feed(s, a.role, 'info', `${cur.name} claimed the ${a.role === 'mech' ? 'mechanic' : a.role === 'elec' ? 'electrician' : 'analyst'} seat.`, now);
      } else if (cur && a.reclaim) {
        if (cur.seatKey && a.key?.toLowerCase() !== cur.seatKey) return fail('That seat code does not match.');
        cur.devices = [...new Set([...(cur.devices ?? []), a.uid])].slice(-4);
        feed(s, a.role, 'info', `${cur.name} linked another device.`, now);
      } else if (cur && !a.takeover) {
        return fail(`${cur.name} already holds this seat. Ask them for the seat code to link this device.`);
      } else if (cur) {
        const inherited = Math.round(cur.xp * 0.6);
        s.players[a.role] = { ...newPlayer(a.uid, a.name, a.role, inherited, s.week + 2), week0Done: false };
        feed(s, a.role, 'info', `${a.name} took over as ${a.role === 'mech' ? 'mechanic' : a.role === 'elec' ? 'electrician' : 'analyst'}.`, now);
      } else {
        s.players[a.role] = newPlayer(a.uid, a.name, a.role, 0, s.week > 0 ? s.week + 2 : 0);
        feed(s, a.role, 'info', `${a.name} joined.`, now);
      }
      const p = s.players[a.role]!;
      p.seatKey ??= seatKey(s, a.role, p.uid);
      return { s };
    }
    case 'rename': {
      const p = s.players[a.role];
      if (!p) return fail('No such player.');
      p.name = a.name.slice(0, 20) || p.name;
      return { s };
    }
    case 'cosmetic': {
      const p = s.players[a.role];
      if (!p) return fail('No such player.');
      p.cosmetic = a.id;
      return { s };
    }
    case 'week0Done': {
      const p = s.players[a.role];
      if (!p) return fail('Join first.');
      p.week0Done = true;
      feed(s, a.role, 'good', `${p.name} finished week 0.`, now);
      const all = ROLES.every((r) => s.players[r]?.week0Done);
      if (s.week === 0 && all) openWeek(s, now);
      return { s };
    }
    case 'complete':
      return complete(s, prev, a, now);
    case 'approve': {
      const o = s.orders.find((x) => x.id === a.orderId);
      if (!o || o.status !== 'pending') return fail('That card is no longer waiting.');
      if (o.flow) return approveFlowCard(s, prev, o, a.buy, now);
      const urgent = isEmergency(s, o);
      // a part chain's part: the AOG boat goes on the PO when it takes one
      const cost = chainCardCost(s, o, a.ship);
      if (s.cash < ECON.freezeBelow && !urgent) return fail(`Cash under ${usd(ECON.freezeBelow)}: only safety-critical work can be approved.`);
      const adv = receiverFunds(s, cost, urgent, s.cash);
      if (s.cash - cost < 0 && adv === null) return fail(noCash(s, cost, urgent, s.cash));
      if (s.receivership > 0 && o.cost > 800 && !urgent) return fail('Receivership: the receiver blocks spend over $800 except safety-critical work.');
      if (adv) receiverAdvance(s, adv, o.title, now);
      markApproved(s, o, false);
      gainXp(s, 'fin', 10);
      feed(s, 'fin', 'good', `Approved ${o.title} (${cost === o.cost ? usd(o.cost) : `${usd(o.cost)} + ${usd(cost - o.cost)} AOG boat`}).`, now);
      chainApproved(s, o, now, a.ship);
      return { s };
    }
    case 'defer': {
      const o = s.orders.find((x) => x.id === a.orderId);
      if (!o || o.status !== 'pending') return fail('That card is no longer waiting.');
      if (o.lastDeferredWeek === s.week) return fail('Already deferred this week.');
      o.deferrals += 1;
      o.lastDeferredWeek = s.week;
      o.deferReason = a.reason;
      o.pushedBack = false;
      gainXp(s, 'fin', 10);
      feed(s, 'fin', 'info', `Deferred ${o.title} (${a.reason}).`, now);
      return { s };
    }
    case 'counter': {
      const o = s.orders.find((x) => x.id === a.orderId);
      if (!o || o.status !== 'pending') return fail('That card is no longer waiting.');
      if (o.pushedBack) return fail('Already countered once: approve or defer.');
      if (o.flow) return fail('MEL, make-safe or a cheaper pick is the cheaper fix: approve or defer.');
      // a part is a part and engineering's fee is its fee: nothing cheaper to offer
      if (o.chain) return fail('An AOG part or an engineering fee has no cheaper fix: approve or defer.');
      o.status = 'countered';
      o.counter = { cost: round10(o.cost * 0.6), gain: Math.round(o.gain * 0.55) };
      gainXp(s, 'fin', 10);
      feed(s, 'fin', 'info', `Counter-offer on ${o.title}: ${usd(o.counter.cost)} cheaper fix.`, now);
      return { s };
    }
    case 'acceptCounter': {
      const o = s.orders.find((x) => x.id === a.orderId);
      if (!o || o.status !== 'countered' || !o.counter) return fail('No counter-offer waiting.');
      if ((s.cash < ECON.freezeBelow && !isEmergency(s, o)) || s.cash - o.counter.cost < 0) return fail('Cash is frozen right now.');
      o.cost = o.counter.cost;
      o.gain = o.counter.gain;
      o.title = `${o.title} (patch)`;
      markApproved(s, o, false);
      feed(s, o.role, 'good', `Accepted the cheaper fix on ${o.title}.`, now);
      return { s };
    }
    case 'rejectCounter': {
      const o = s.orders.find((x) => x.id === a.orderId);
      if (!o || o.status !== 'countered') return fail('No counter-offer waiting.');
      o.status = 'pending';
      o.counter = undefined;
      o.pushedBack = true;
      feed(s, o.role, 'info', `Pushed back on the cheap fix for ${o.title}.`, now);
      return { s };
    }
    case 'setRates': {
      const rb = rateBounds(ECON.baseNightly, s.receivership > 0);
      const cb = rateBounds(ECON.baseCharter, s.receivership > 0);
      s.rates = {
        nightly: clamp(Math.round(a.nightly / 5) * 5, rb.min, rb.max),
        charter: clamp(Math.round(a.charter / 10) * 10, cb.min, cb.max),
      };
      return { s };
    }
    case 'setBudget': {
      s.autoBudget[a.role] = clamp(Math.round(a.amount / 50) * 50, 0, s.receivership > 0 ? 300 : budgetCap(s));
      return { s };
    }
    case 'setInsurance': {
      s.insurance = a.tier;
      return { s };
    }
    case 'setNtfy': {
      s.ntfy = a.topic.trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || undefined;
      return { s };
    }
    case 'buyList':
      return fail('Parts kits are gone: buy real items from the stock planner.');
    case 'endTurn': {
      if (s.week < 1) return fail('The week has not started yet.');
      const t = (s.turns[a.role] ??= { ended: false, endedAt: null, done: 0 });
      if (t.ended) return { s: prev };
      // the electrician's helper takes only what was ready when the electrician ended the turn (the release gate):
      // stamped before the turn counts as ended (helperMay reads the stamp once it has)
      if (a.role === 'elec' && helperOn(s) && working(s).some((n) => n.role === 'helper')) {
        const ready = s.orders.filter((o) => helperMay(s, o)).map((o) => o.id);
        if (ready.length) t.ready = ready;
      }
      t.ended = true;
      t.endedAt = now;
      const p = s.players[a.role];
      feed(s, a.role, 'info', `${p?.name ?? a.role} ended their turn.`, now);
      if (ROLES.every((r) => s.turns[r]?.ended)) resolveWeek(s, now);
      return { s };
    }
    case 'allocateBonus': {
      const b = s.pendingBonus;
      if (!b) return fail('No bonus to allocate.');
      if (a.choice === 'reserve') s.cash += b;
      if (a.choice === 'capex') for (const x of s.assets) x.health = Math.min(100, x.health + 8);
      if (a.choice === 'split') for (const r of ROLES) gainXp(s, r, 150);
      s.pendingBonus = null;
      const what = { reserve: `${usd(b)} to reserve`, capex: 'capex: +8 health on every asset', split: '+150 XP each' }[a.choice];
      feed(s, 'fin', 'good', `A-grade bonus: ${what}.`, now);
      return { s };
    }
    case 'story':
      return story(s, prev, a.key, a.role, now);
    case 'tag': {
      // safety calls: an A&P can ground a plane, an electrician can red-tag a house or the grid
      const asset = s.assets.find((x) => x.id === a.assetId);
      if (!asset) return fail('No such asset.');
      const allowed = (a.role === 'mech' && asset.kind === 'plane') || (a.role === 'elec' && (asset.kind === 'house' || asset.kind === 'generator'));
      if (!allowed) return fail(a.role === 'fin' ? 'Only the trades can ground or red-tag.' : 'Not your call: that asset belongs to the other trade.');
      if (s.turns[a.role]?.ended) return fail('Your turn is over for this week.');
      s.tags = { ...(s.tags ?? {}) };
      const who = s.players[a.role]?.name ?? a.role;
      if (a.on) {
        s.tags[asset.id] = a.role;
        feed(s, a.role, 'bad', `${who} ${asset.kind === 'plane' ? 'grounded' : 'red-tagged'} ${asset.name} this week (safety call).`, now);
      } else {
        delete s.tags[asset.id];
        feed(s, a.role, 'info', `${who} returned ${asset.name} to service.`, now);
      }
      return { s };
    }
    case 'squawk': {
      // the trade writes up what an asset needs; the analyst decides whether it's worth the money
      if (a.role === 'fin') return fail('Only the trades write up squawks.');
      if (s.week < 1) return fail('The week has not started yet.');
      if (s.turns[a.role]?.ended) return fail('Your turn is over for this week.');
      if (s.squawked?.[a.role] === s.week) return fail('One write-up per week.');
      const asset = s.assets.find((x) => x.id === a.assetId);
      if (!asset) return fail('No such asset.');
      const c = squawkable(a.role, asset).find((x) => x.kind === a.kind);
      if (!c) return fail("That job doesn't apply to this asset.");
      if (s.orders.some((o) => open(o) && o.kind === c.kind && o.assetId === asset.id)) return fail('That job is already open.');
      if (liveAlerts(s).some((x) => x.assetId === asset.id && x.sym === `W_${c.kind}`)) return fail('That job is already open.');
      const who = s.players[a.role]?.name ?? a.role;
      // a write-up is an alert with its kind's task filled in: the tech confirms it, finds the parts, and it goes to the analyst like any plan
      raiseAlert(s, { role: a.role, asset, sym: `W_${c.kind}`, cause: 0, src: 'finding', due: s.week + 2, who }, now);
      s.squawked = { ...(s.squawked ?? {}), [a.role]: s.week };
      feed(s, a.role, 'info', `${who} wrote up ${c.title.toLowerCase()} on ${asset.name}: it's on the alert list.`, now);
      return { s };
    }
    case 'gse':
      return gseMove(s, prev, a, now);
    case 'post': {
      // the crew board is chat, not a move: any seat, any time, even after ending a turn
      const p = s.players[a.role];
      if (!p) return fail('Join first.');
      const text = a.text.trim().slice(0, BOARD.maxLength);
      if (!text) return fail('Write something first.');
      if (a.to !== undefined) {
        if (a.to === a.role) return fail("That's you.");
        if (!s.players[a.to]) return fail('Nobody holds that seat yet.');
      }
      const id = s.boardNextId ?? 1;
      s.boardNextId = id + 1;
      (s.board ??= []).push({ id, role: a.role, name: p.name, text, at: now, week: s.week, ...(a.to ? { to: a.to } : {}) });
      const unpinned = s.board.filter((x) => !x.pinned);
      if (unpinned.length > BOARD.keep) {
        const drop = new Set(unpinned.slice(0, unpinned.length - BOARD.keep).map((x) => x.id));
        s.board = s.board.filter((x) => !drop.has(x.id));
      }
      return { s };
    }
    case 'pin': {
      if (!s.players[a.role]) return fail('Join first.');
      const post = s.board?.find((x) => x.id === a.id);
      if (!post) return fail('That message is gone.');
      if (post.to) return fail('Direct messages cannot be pinned.');
      if (a.on && !post.pinned && s.board!.filter((x) => x.pinned).length >= BOARD.maxPins) return fail(`Up to ${BOARD.maxPins} pinned notes. Unpin one first.`);
      if (a.on) post.pinned = true;
      else delete post.pinned;
      return { s };
    }
    case 'unpost': {
      const post = s.board?.find((x) => x.id === a.id);
      if (!post) return fail('That message is gone.');
      if (post.role !== a.role) return fail('Only the author can delete a message.');
      s.board = s.board!.filter((x) => x.id !== a.id);
      return { s };
    }
    case 'practice': {
      const p = s.players[a.role];
      if (!p) return fail('Join first.');
      const key = `${a.puzzle}:${a.tier}`;
      if (!s.challenge || s.challenge.week !== s.week) s.challenge = { week: s.week, scores: {} };
      const row = (s.challenge.scores[key] ??= {});
      row[a.role] = Math.max(row[a.role] ?? 0, clamp(a.score, 0, 1));
      p.best = { ...(p.best ?? {}), [a.puzzle]: Math.max(p.best?.[a.puzzle] ?? 0, clamp(a.score, 0, 1)) };
      return { s };
    }
    case 'resolve': {
      if (a.week !== s.week) return { s: prev }; // someone else already resolved it
      if (!canResolve(s, now)) return fail('Not time yet.');
      resolveWeek(s, now);
      return { s };
    }
    case 'plan':
    case 'nff':
    case 'mel':
    case 'melExtend':
    case 'makeSafe':
    case 'askBench':
    case 'repick':
    case 'dropJob':
    case 'request':
    case 'cancelReq':
    case 'approveReq':
    case 'deferReq':
    case 'buy':
    case 'setStock':
    case 'scrap':
    case 'nudge':
    case 'setStanding':
      return flowAction(s, prev, a, now);
    case 'hire':
    case 'letGo':
    case 'build':
      return staffAction(s, prev, a, now);
    // stage 2 (docs/EXPANSION.md 7): the quick check and Report a problem
    case 'check':
      return checkMove(s, prev, a, now);
    case 'flag':
      return flagMove(s, prev, a, now);
  }
}

// ---------------------------------------------------------------------------
// Stage 2 (docs/EXPANSION.md 6.4, 6.5, 7): the quick check and Report a problem. Their effects happen at the move,
// never at the resolve (the resolve only writes this week's lines, step 17b). The logic is checks.ts's.

function checkMove(s: IslandState, prev: IslandState, a: Extract<Action, { t: 'check' }>, now: number): ApplyResult {
  const fail = (error: string): ApplyResult => ({ s: prev, error });
  const can = canCheck(s, a.role, a.assetId);
  if (!can.ok) return fail(can.why);
  const view = checkView(s, a.role, a.assetId)!;
  if (a.item !== null && !view.items.some((i) => i.id === a.item)) return fail("That isn't on this check.");
  const asset = s.assets.find((x) => x.id === a.assetId)!;
  const who = nameOf(s, a.role);
  s.checked = { ...(s.checked ?? {}), [a.role]: s.week };
  // blind: the words never say whether the call was right
  if (a.item === null) {
    feed(s, a.role, 'info', `${who} ${checkDid(view.kind, asset)}: all ${view.kind === 'walkaround' ? 'serviceable' : 'normal'}.`, now);
    return { s };
  }
  const al = raiseCheckWriteUp(s, a.role, asset, view.kind, a.item, who, now);
  feed(s, a.role, 'info', `${who} ${checkDid(view.kind, asset)} and wrote up the ${CHECK_ROWS[al.sym]?.word ?? a.item}: it's on the alert list.`, now);
  return { s };
}

function flagMove(s: IslandState, prev: IslandState, a: Extract<Action, { t: 'flag' }>, now: number): ApplyResult {
  const fail = (error: string): ApplyResult => ({ s: prev, error });
  const f = flagCheck(s, a.role, a.assetId);
  if (!f.ok) return fail(f.why);
  const asset = s.assets.find((x) => x.id === a.assetId)!;
  const pick = flagPick(s, a.role, asset, f.to);
  if (!pick) return fail('Nothing there anyone could report.');
  s.flagged = { ...(s.flagged ?? {}), [a.role]: s.week };
  const al = raiseFlag(s, a.role, asset, f.to, pick, now);
  // both seats read what went on the list in the flagger's name, and whose words it passes on (review round 1)
  const said = `${nameOf(s, a.role)} passed on ${flagSource(s, al)} to ${nameOf(s, f.to)}: ${alertShort(s, al)}.`;
  feed(s, f.to, 'info', said, now);
  feed(s, a.role, 'info', said, now);
  return { s };
}

/** Crew board limits: long enough for a plan, small enough for one Firestore document. */
export const BOARD = { maxLength: 500, keep: 150, maxPins: 5 };

/** Jobs a trade may write up on an asset: real work on something it looks after (not paperwork). */
export function squawkable(role: Role, asset: Asset) {
  return CATALOG.filter((c) => c.role === role && c.targets.includes(asset.model) && c.gain > 0);
}

/** Safety-critical work stays approvable through a cash freeze: an asset under 60, an inspection sign-off, or a known defect's repair. */
export function isEmergency(s: IslandState, o: Order) {
  // a part chain grounds its plane: the part and the engineering fee are safety work
  if (o.kind === 'inspect100' || o.kind === 'codeprep' || o.kind === 'repair' || o.chain) return true;
  // a job whose alert grounds a plane (the only guest plane too: its guests go on the sub-charter) or closes a house (this week or next)
  if (o.flow && (urgentJob(s, o) || urgentJob(s, o, s.week + 1))) return true;
  const a = s.assets.find((x) => x.id === o.assetId);
  return !!a && a.health < 60;
}

/** what's left of the receiver's repair allowance this week (0 outside receivership) */
export function receiverLeft(s: IslandState): number {
  if (s.receivership <= 0) return 0;
  const used = s.loan?.adv?.week === s.week ? s.loan.adv.usd : 0;
  return Math.max(0, RECEIVER.allowance - used);
}

/**
 * The receiver funds safety-critical work the island can't pay for (review round 1): in receivership, `urgent`, and
 * the shortfall (the cost less what's spendable above $0) within this week's allowance. Returns the shortfall it
 * would advance, or null.
 */
export function receiverFunds(s: IslandState, cost: number, urgent: boolean, have = spendable(s)): number | null {
  if (s.receivership <= 0 || !urgent || have - cost >= 0) return null;
  const short = Math.ceil(cost - Math.max(0, have));
  return short <= receiverLeft(s) ? short : null;
}

/** what an advance of `amount` adds to the bridge loan: the advance plus the receiver's fee (RECEIVER.rate) */
export const receiverOwed = (amount: number) => Math.round(amount * (1 + RECEIVER.rate));

/** the receiver's line on a card it would fund: "The receiver funds $190 → +$218 on the bridge loan (15% fee)" */
export const receiverWords = (amount: number) => `The receiver funds ${usd(amount)} → +${usd(receiverOwed(amount))} on the bridge loan (${Math.round(RECEIVER.rate * 100)}% fee)`;

/**
 * The receiver advances `usd` into cash: added to the bridge loan (at RECEIVER.rate) and to this week's allowance
 * used. The loan's term stays 10 weeks (the release gate): its weekly payment grows with it instead of the term
 * stretching unsaid, and the feed says the fee and where the loan stands
 */
function receiverAdvance(s: IslandState, amount: number, what: string, now: number) {
  const W = s.week;
  const loan = (s.loan ??= { left: 0, weekly: 0 });
  loan.adv = { week: W, usd: (loan.adv?.week === W ? loan.adv.usd : 0) + amount };
  loan.left += receiverOwed(amount);
  loan.weekly = Math.max(loan.weekly, Math.ceil(loan.left / 10));
  s.cash += amount;
  feed(
    s,
    'fin',
    'info',
    `${receiverWords(amount)} for ${what} (safety-critical): the loan is ${usd(loan.left)} at ${usd(loan.weekly)}/week. ${usd(receiverLeft(s))} of the week's ${usd(RECEIVER.allowance)} allowance left.`,
    now,
  );
}

/** "Not enough cash", and in receivership what the receiver would fund instead */
function noCash(s: IslandState, cost: number, urgent: boolean, have = spendable(s)): string {
  if (s.receivership <= 0) return 'Not enough cash.';
  if (!urgent) return 'Not enough cash: the receiver funds only safety-critical work while cash is below $0.';
  // a card whose shortfall is over the whole week's allowance can't be funded at all (the release gate: say so)
  if (cost - Math.max(0, have) > RECEIVER.allowance)
    return `Not enough cash, and the receiver funds at most ${usd(RECEIVER.allowance)} a week: a ${usd(cost)} card can't be funded in receivership.`;
  return `Not enough cash, and the receiver's repair allowance has ${usd(receiverLeft(s))} left this week (${usd(cost)} card).`;
}

/** petty-cash ceiling for auto-approvals: at most one week's fixed cost per role */
export const budgetCap = (s: IslandState) => Math.min(3000, fixedNow(s));

export function listPrice(s: IslandState) {
  return round10(((ECON.partMarket.low + ECON.partMarket.high) / 2) * ECON.listPremium * (1 + 0.1 * (s.tier - 1)));
}
const hasCargo = (s: IslandState) => s.assets.some((a) => a.model === 'cargo');

function complete(s: IslandState, prev: IslandState, a: Extract<Action, { t: 'complete' }>, now: number): ApplyResult {
  const fail = (error: string): ApplyResult => ({ s: prev, error });
  if (s.week < 1) return fail('The week has not started yet.');
  const o = s.orders.find((x) => x.id === a.orderId);
  // a job the part chain holds says what it waits on
  const holds = o?.status === 'waiting_part' && o.chain?.step === 'job' ? chainOf(s, o) : null;
  if (holds) return fail(`Waiting on the part chain: ${chainMove(s, holds).text}.`);
  if (!o || o.status !== 'ready') return fail('That order is not ready.');
  const turn = (s.turns[a.role] ??= { ended: false, endedAt: null, done: 0 });
  if (turn.ended) return fail('Your turn is over for this week.');
  const player = s.players[a.role];
  if (!player) return fail('Join first.');
  // a ground power start (and avionics work: the radio's ops check) needs a charged cart hooked up
  // to that plane (lending a hand too: it's the same cart)
  const gpu = gseForStart(s, o);
  if (gpu.blocker) return fail(`${gpu.blocker}.`);
  // the start happened whatever came of it: the cart gave up its charge and its cable some wear
  const cableBefore = gpu.cart && o.kind === 'gpustart' ? useCart(s, gpu.cart, o, a.data) : 0;
  // the radio work ran the bus off the cart: a little charge, and a plug-in's worth of wear
  if (gpu.cart && o.kind !== 'gpustart') {
    gpu.cart.charge = Math.max(0, gpu.cart.charge - GSE.avionicsDrain);
    gpu.cart.wear = Math.min(100, gpu.cart.wear + GSE.busWear);
  }

  // Lend a hand: anyone may try another trade's job once a week, at expert
  // difficulty. Real trade knowledge is the gate: no tools come with you, and
  // anything under a pass (60%) is a botch that damages the asset and leaves
  // the job open for its owner.
  let covered = false;
  if (o.role !== a.role) {
    if (!a.cover) return fail('Not your trade. Use Lend a hand.');
    if ((s.coversUsed[a.role] ?? 0) >= 1) return fail('You already lent a hand this week.');
    if (o.kind === 'project') return fail('Crew project: each trade does its own part.');
    // the trade that raised a report can't sign off its own fix: another trade has to
    if (o.report?.by === a.role) return fail(`It's your report: ${s.players[o.role]?.name ?? ROLE_LABEL[o.role]} has to fix this one.`);
    if (o.deferrals < 1) return fail('Lend a hand is for jobs that have already waited a week.');
    s.coversUsed[a.role] = (s.coversUsed[a.role] ?? 0) + 1;
    player.covers += 1;
    covered = true;
    if (a.score < 0.6) {
      // the chain's paperwork and the electrician's check are done on paper or with a meter: a botch damages nothing
      const asset = isChainStep(o) ? undefined : assetOf(s, o);
      if (asset) {
        asset.health = clamp(asset.health - 6, 0, 100);
        asset.touchedWeek = s.week;
      }
      turn.done += 1;
      feed(s, o.role, 'bad', `${player.name} tried ${o.title}${asset ? ` on ${asset.name}` : ''} outside their trade: ${Math.round(a.score * 100)}%, botched${asset ? ` (${asset.name} −6)` : ''}. Still open.`, now);
      return { s };
    }
  }
  // the grid is down: hangar tools offline, one hangar job (the part chain's paperwork needs no tools)
  if (a.role === 'mech' && !covered && powered(s).gridDown && hangarJobs(turn) >= 1 && !isChainStep(o))
    return fail('Grid down: hangar tools offline, 1 order max.');
  // a crewmate's unfixed problem slows this seat down (the hangar lights are out)
  const cap = covered ? null : reportCap(s, a.role);
  if (cap && turn.done >= cap.limit) return fail(cap.text);

  // the crew project's floatplane auction (fix round 1): outbid, nothing is bought and the part stays open, and the next
  // floatplane comes up at next week's auction (a new sale: a new seed). A bid lost this week can't be run again
  if (o.kind === 'project' && o.puzzle === 'auction') {
    if (o.rebid === s.week) return fail('Outbid this week: the next floatplane comes up at next week’s auction.');
    if (!(Number(a.data?.kits ?? 0) > 0)) {
      o.rebid = s.week;
      o.seed = hashSeed(o.seed, 'rebid', s.week);
      turn.done += 1;
      feed(s, 'fin', 'info', `${player.name} was outbid for the floatplane: ${o.title} stays open for next week's auction.`, now);
      return { s };
    }
  }

  // the job flow: the box is opened at the start. A part that doesn't fit, a short slot or a missing tool stops the work
  // (not an error: nothing is signed off, nothing leaves stock, and the tech repicks)
  if (o.flow && !o.flow.wired) {
    const stop = installCheck(s, o);
    if (stop) {
      o.flow.stop = stop.stop;
      if (stop.research) o.flow.stopResearch = true;
      o.status = 'waiting_part';
      const at = assetOf(s, o);
      feed(s, o.role, 'bad', `Work stopped at the install${at ? ` on ${at.name}` : ''}: ${stop.stop}`, now);
      return { s };
    }
  }

  // Blind sign-off (a real job at puzzle tier 2+): no verdict now. The true
  // score still drives everything; how good it was shows up later.
  const blind = !covered && isBlind(s, o, a.role);

  // the part chain's paperwork (IPC lookup, logbook research): what it hands in moves the chain on
  if (o.chain && o.chain.step !== 'job') return chainStep(s, o, a, player.name, covered, blind, turn, now);
  // the electrician's check on a flow alert (the unit, or its wiring?)
  if (o.bench) return flowBenchStep(s, o, a, player.name, covered, blind, turn, now);

  // Rework (teaching tiers only): a job that fails its own check isn't signed
  // off. It stays open with a fresh fault (new seed), so the retry is a new
  // job, not a replay. Blind jobs never rework: hidden defects replace it.
  if (!covered && isRework(o, a.score, blind)) {
    o.seed = hashSeed(o.seed, `rework${s.week}`);
    turn.done += 1;
    const asset = assetOf(s, o);
    feed(s, o.role, 'bad', `${player.name}: ${o.title}${asset ? ` on ${asset.name}` : ''} didn't pass its check (${Math.round(a.score * 100)}%). Rework: still open.`, now);
    return { s };
  }

  // The flow's bench alert whose fault is the wiring, and nobody asked the electrician: the new unit makes no difference
  const flowAlert = o.flow ? alertOf(s, o) : undefined;
  if (flowAlert && o.flow && !o.flow.wired && benchFault(flowAlert) === 'wiring' && flowAlert.bench?.call !== 'wiring' && unitJob(s, flowAlert, o)) {
    missedWiringFlow(s, o, flowAlert, player.name, turn, now);
    return { s };
  }

  // The part chain: the job finds a part gone, missing or damaged. It can't be
  // finished without it, so nothing is signed off: the plane is grounded and
  // the IPC lookup starts. (The roll never looks at the score.)
  if (!covered && chainWouldOpen(s, o, a.role)) {
    openPartChain(s, o, player.name, now);
    turn.done += 1;
    gainXp(s, a.role, blindXpFloor(o.tier));
    return { s };
  }
  // the part is here and on: this is the job itself, under its own title again
  const chain = o.chain?.step === 'job' ? chainOf(s, o) : null;
  // (a job the chain still holds is never finished early: an older build could have made it 'ready')
  if (chain && chain.step !== 'install') return fail(`Waiting on the part chain: ${chainMove(s, chain).text}.`);
  const installing = !!chain;
  // the electrician called the unit, but the fault is in the wiring: the new one makes no difference
  if (chain && chain.bench?.fault === 'wiring' && chain.bench.call === 'unit' && !chain.wired) {
    missedWiring(s, chain, o, player.name, turn, now);
    return { s };
  }
  if (installing) o.title = chain!.title;

  const cr = covered ? credit(a.score, 0) : credit(a.score, player.perfects);
  // Blind: a fixed stand-in lands now (health, XP), the same whatever the score.
  // The true credit, a perfect run's bonus and its week without decay settle
  // silently when the week resolves (settleBlind), so nothing on screen moves
  // by how well it went the moment it's handed in.
  const landed = blind ? credit(DEFECT.provisional, player.perfects) : cr;
  o.status = 'done';
  o.result = {
    score: a.score,
    perfect: a.perfect,
    credit: cr,
    by: a.role,
    week: s.week,
    covered,
    ...(blind ? { blind: true, provisional: landed } : { summary: a.summary }),
  };
  turn.done += 1;
  if (a.perfect && !covered && !blind && player.perfects < 15) player.perfects += 1;
  // a blind sign-off's score stays hidden: a new personal best would give it away
  if (!blind) player.best = { ...(player.best ?? {}), [o.puzzle]: Math.max(player.best?.[o.puzzle] ?? 0, clamp(a.score, 0, 1)) };
  gainXp(s, a.role, blind ? blindXpFloor(o.tier) : Math.round(orderXp(o.tier, cr, a.perfect) * (covered ? 0.5 : 1)));

  const asset = assetOf(s, o);
  // a renovation's final (G0): the house back to RENO.health with it, then the final's own work on top (renoSignoff)
  const signedNow = blind || a.score >= SIGNOFF;
  if (asset && o.kind === 'codeprep' && signedNow) renoSignoff(s, asset, s.week);
  if (asset && o.gain > 0) {
    asset.health = clamp(asset.health + o.gain * landed, 0, 100);
    // a perfect job holds: that asset skips next week's decay too (blind: settled at resolve)
    asset.touchedWeek = Math.max(asset.touchedWeek, s.week + (a.perfect && !covered && !blind ? 1 : 0));
    // sign-off is pass/fail: a pass renews the inspection whatever the credit.
    // A blind sign-off is in the logbook whatever it missed (what it missed is a hidden defect).
    const signed = blind || a.score >= SIGNOFF;
    if (o.kind === 'inspect100' && signed) asset.sinceInspection = 0;
    if (o.kind === 'codeprep' && signed) asset.inspectionUntil = renewedInspection(s, asset, s.week);
  }

  if (o.kind === 'report') {
    closeReport(s, o, a.role, player.name, a.score, now);
  } else if (o.kind === 'project') {
    // the floatplane auction is real capex: the winning deposit leaves the bank (in the ledger as the tier's build)
    if (o.puzzle === 'auction' && Number(a.data?.kits ?? 0) > 0) {
      const spent = Math.max(0, Math.round(Number(a.data?.spent ?? 0)));
      s.cash -= spent;
      book(s, 'building', spent, { trade: 'fin' });
    }
    feed(s, o.role, blind ? 'info' : 'good', blind ? `${player.name} signed off their part: ${o.title}.` : `${player.name} finished their part: ${o.title} (${Math.round(a.score * 100)}%).`, now);
    finishProjectIfDone(s, now);
  } else if (o.kind === 'auction') {
    // a win places the lot on a broker PO at what was bid (each line at its share), paid at the payment run after it lands
    const won = Math.max(0, Math.floor(Number(a.data?.kits ?? 0))) > 0 && !!o.lot;
    const spent = Math.max(0, Math.round(Number(a.data?.spent ?? 0)));
    if (won && o.lot) {
      // (the lot ships as one consignment from the broker, or the online house for the electrician's: its price is delivered)
      const vendor = itemById(o.lot.lines[0]?.item ?? '')?.trade === 'elec' ? 'online' : 'broker';
      const pos = placePo(s, o.lot.lines, { vendor }, 'fin', now, { noFreight: true });
      // each line at its share of what was bid (the POs come to exactly the bid)
      const total = pos.reduce((n, p) => n + p.lines.reduce((m, l) => m + l.unit * l.qty, 0), 0) || 1;
      for (const p of pos) {
        for (const l of p.lines) l.unit = Math.round(((spent * (l.unit * l.qty)) / total / l.qty) * 100) / 100;
        p.cost = Math.round(p.lines.reduce((n, l) => n + l.unit * l.qty, 0) * 100) / 100;
      }
      feed(s, 'fin', 'good', `Won the broker's lot for ${usd(spent)} (${o.lot.lines.length} lines, ${usd(o.lot.list)} at list): ${pos.map((p) => p.id).join(', ')}.`, now);
    } else feed(s, 'fin', 'info', 'Walked away from the auction.', now);
  } else if (o.kind === 'forecast') {
    const pts = Array.isArray(a.data?.points) ? (a.data!.points as number[]).slice(0, 4).map(Number) : [];
    if (pts.length === 4) s.forecasts.push({ week: s.week, points: pts, actual: [] });
  } else if (o.role === 'fin') {
    // blind: what it recovered shows in the week's review, not now
    feed(s, 'fin', blind ? 'info' : 'good', blind ? `${o.title} filed.` : `${o.title}: found ${usd((o.leak ?? 0) * a.score)}.`, now);
  } else {
    const by = covered ? `${player.name} (lending a hand)` : player.name;
    if (blind) feed(s, o.role, 'info', `${by} signed off ${o.title}${asset ? ` on ${asset.name}` : ''}.`, now);
    else feed(s, o.role, a.perfect ? 'good' : 'info', `${by} finished ${o.title}${asset ? ` on ${asset.name}` : ''}${a.perfect ? ' — perfect' : ''}.`, now);
  }

  // the job flow: what was pulled leaves stock, the alert closes, and a wrong task or part is there whatever the score
  let sure = false;
  if (o.flow) {
    if (!o.flow.wired) consume(s, o.id, asset?.id ?? null);
    const al = alertOf(s, o);
    if (al && al.status !== 'closed') closeAlert(s, al, o.flow.wired ? 'wired' : 'fixed');
    sure = flowSureDefect(s, o, al, a.role, player.name, a.score);
  }
  // hidden consequences: a passed inspection finds what an earlier job left; this job may leave something
  if (asset && INSPECTS[o.kind] && a.score >= DEFECT.detectAt) detectDefects(s, o, asset, player.name, now);
  if (defectable(o) && !sure) rollDefect(s, o, a.role, player.name, a.score, defectVariant(o.puzzle, a.data));
  // a start through pitted plug contacts can arc into the plane's receptacle, however well it was done
  if (gpu.cart && asset && o.kind === 'gpustart') cableArc(s, o, asset, a.role, player.name, cableBefore);
  if (o.repair) spawnRedo(s, o, now);
  if (installing) closeChain(s, o, player.name, now);
  return { s };
}

// ---------------------------------------------------------------------------
// The job flow (docs/JOBFLOW.md 7, 8): alerts planned into jobs, stock,
// purchasing, MEL and make-safe, the electrician's check at the airplane

type FlowAct = Extract<
  Action,
  { t: 'plan' | 'nff' | 'mel' | 'melExtend' | 'makeSafe' | 'askBench' | 'repick' | 'dropJob' | 'request' | 'cancelReq' | 'approveReq' | 'deferReq' | 'buy' | 'setStock' | 'scrap' | 'nudge' | 'setStanding' }
>;
const TECH_MOVES = new Set(['plan', 'nff', 'mel', 'makeSafe', 'askBench', 'repick', 'dropJob', 'request']);

const alertById = (s: IslandState, id: string) => s.alerts?.find((x) => x.id === id);
const alertOf = (s: IslandState, o: Order) => (o.flow ? alertById(s, o.flow.alert) : undefined);
const nameOf = (s: IslandState, r: Role) => s.players[r]?.name ?? ROLE_LABEL[r];

function flowAction(s: IslandState, prev: IslandState, a: FlowAct, now: number): ApplyResult {
  const fail = (error: string): ApplyResult => ({ s: prev, error });
  if (a.t === 'setStanding') {
    s.standing = clamp(Math.round(a.amount / 50) * 50, 0, 5000);
    return { s };
  }
  if (s.week < 1) return fail('The week has not started yet.');
  if ('role' in a && a.role && TECH_MOVES.has(a.t) && s.turns[a.role]?.ended) return fail('Your turn is over for this week.');
  const W = s.week;
  switch (a.t) {
    case 'plan': {
      const al = alertById(s, a.alert);
      if (!al || al.status !== 'open') return fail('That alert is not open.');
      if (al.role !== a.role) return fail('Not your trade.');
      const r = planAlert(s, al, a.task, a.pick, now, a.research, nameOf(s, a.role));
      return typeof r === 'string' ? fail(r) : { s };
    }
    case 'nff': {
      const al = alertById(s, a.alert);
      if (!al || al.status !== 'open') return fail('That alert is not open.');
      if (al.role !== a.role) return fail('Not your trade.');
      if (al.repair || al.src === 'due' || al.src === 'ad' || al.src === 'code' || al.src === 'takeoff' || symptomOf(al)?.writeUp) return fail("There's a known task for this one.");
      // a finding that shows the fault can't be closed as nothing: only what reads "could not duplicate" can (an
      // intermittent that hides at tier 3+ reads that way too, and comes back: 5.5)
      if (!findingOf(s, al, alertTier(s, al, al.role)).nff) return fail('The finding shows the fault: fix it, placard it or make it safe.');
      closeAlert(s, al, 'nff');
      const asset = s.assets.find((x) => x.id === al.assetId);
      // a real fault closed as nothing: it comes back (hidden)
      if (al.cause >= 0 && al.kind !== 'nff') plantComeback(s, al, 'nff', nameOf(s, a.role), a.role);
      feed(s, a.role, 'info', `${nameOf(s, a.role)} closed ${shortText(s, al)} on ${asset?.name ?? 'the asset'}: no fault found.`, now);
      return { s };
    }
    case 'mel': {
      const al = alertById(s, a.alert);
      const asset = al ? s.assets.find((x) => x.id === al.assetId) : undefined;
      if (!al || al.status === 'closed' || !asset) return fail('That alert is not open.');
      if (a.role !== 'mech' || al.role !== 'mech' || asset.kind !== 'plane') return fail('Not your trade.');
      const o = al.order ? s.orders.find((x) => x.id === al.order) : undefined;
      if (o?.status === 'done') return fail('That job is done.');
      if (alertFlags(s, al).mel !== 'C') return fail(`No MEL relief for that on ${asset.name}.`);
      if (al.mel) return fail('It is already placarded.');
      // the placard covers the item through its due week's resolve (a placard put on early isn't spent before it's needed)
      al.mel = { until: Math.max(W, al.due), by: nameOf(s, 'mech') };
      feed(
        s,
        'mech',
        'info',
        `${nameOf(s, 'mech')} placarded ${shortText(s, al)} INOP on ${asset.name} (MEL category C): it flies on it ${al.mel.until > W ? `through week ${al.mel.until}` : 'this week'}.`,
        now,
      );
      return { s };
    }
    case 'melExtend': {
      const al = alertById(s, a.alert);
      if (!al?.mel || al.status === 'closed') return fail('That item is not placarded.');
      if (al.mel.ext) return fail('The MEL allows one extension.');
      // the placard covers the resolve of the week it went on; the one extension can still be given the week after
      // (before that week's flights), not later
      if (al.mel.until < W - 1) return fail('That placard has run out.');
      const asset = s.assets.find((x) => x.id === al.assetId);
      const plane = asset?.name ?? 'the plane';
      if (a.role === 'mech') {
        // the extension is the maintenance side's call (the Director of Maintenance under the operator's MEL
        // extension authority): the mechanic asks for it, and the analyst approves what the downtime and the fix cost
        if (s.turns.mech?.ended) return fail('Your turn is over for this week.');
        if (al.mel.ask) return fail(`Already asked: ${nameOf(s, 'fin')} approves it.`);
        al.mel.ask = { week: W, by: nameOf(s, 'mech') };
        feed(s, 'fin', 'info', `${nameOf(s, 'mech')} asks for the one MEL C extension on ${plane} (${shortText(s, al)}): ${nameOf(s, 'fin')}'s approval.`, now);
        return { s };
      }
      if (a.role !== undefined && a.role !== 'fin') return fail('Not your call.');
      if (!al.mel.ask) return fail(`${nameOf(s, 'mech')} asks for the extension first (the maintenance side's call).`);
      al.mel.until = Math.max(al.mel.until, W - 1) + 1;
      al.mel.ext = true;
      feed(s, 'fin', 'info', `${nameOf(s, 'fin')} approved ${al.mel.ask.by}'s MEL C extension on ${plane} for ${shortText(s, al)}: it flies on the placard to week ${al.mel.until}.`, now);
      return { s };
    }
    case 'makeSafe': {
      const al = alertById(s, a.alert);
      const asset = al ? s.assets.find((x) => x.id === al.assetId) : undefined;
      if (!al || al.status === 'closed' || !asset) return fail('That alert is not open.');
      if (a.role !== 'elec' || al.role !== 'elec') return fail('Not your trade.');
      if (!alertFlags(s, al).hazard) return fail('Nothing there to make safe.');
      if (al.safe) return fail('It is already made safe.');
      const o = al.order ? s.orders.find((x) => x.id === al.order) : undefined;
      if (o?.status === 'done') return fail('That job is done.');
      al.safe = { how: a.how, week: W, by: nameOf(s, 'elec') };
      // a blank-off draws a blank plate when one is on the shelf (not required)
      if (a.how === 'blankoff' && available(s, 'PLATE-BLANK') > 0) {
        reserve(s, `safe:${al.id}`, [{ item: 'PLATE-BLANK', qty: 1 }]);
        consume(s, `safe:${al.id}`, asset.id);
      }
      // a branch breaker doesn't isolate a service-neutral fault: it is still there (hidden)
      if (a.how === 'breaker' && causeOf(al)?.neutral) plantIsolation(s, al, nameOf(s, 'elec'));
      feed(s, 'elec', 'info', `${nameOf(s, 'elec')} made ${asset.name} safe (${a.how === 'breaker' ? `${breakerOf(siteOf(s, al))} off and tagged` : 'a blank-off'}): it rents at 75% until the fix.`, now);
      return { s };
    }
    case 'askBench': {
      const al = alertById(s, a.alert);
      if (!al || al.status === 'closed') return fail('That alert is not open.');
      if (a.role !== 'mech' || al.role !== 'mech') return fail('Not your trade.');
      if (!alertFlags(s, al).bench) return fail('Nothing on that one for the electrician to meter.');
      if (al.bench?.call) return fail('The circuit has been checked.');
      if (al.bench?.order && open(s.orders.find((x) => x.id === al.bench!.order)!)) return fail('The check is already asked for.');
      const b = flowBenchOrder(s, al, false);
      al.bench = { ...(al.bench ?? {}), order: b.id };
      feed(s, 'all', 'info', `${nameOf(s, 'mech')} asked ${nameOf(s, 'elec')} to meter the circuit on ${s.assets.find((x) => x.id === al.assetId)?.name ?? 'the plane'}: the unit, or its wiring?`, now);
      return { s };
    }
    case 'repick': {
      const o = s.orders.find((x) => x.id === a.order);
      if (!o?.flow || o.status === 'done' || o.status === 'cancelled') return fail('That job is not open.');
      if (o.role !== a.role) return fail('Not your trade.');
      const al = alertOf(s, o);
      if (!al) return fail('That job has no alert.');
      const task = planTask(s, al, o.flow.task);
      if (!task) return fail('That task is gone.');
      const asset = s.assets.find((x) => x.id === o.assetId)!;
      const pick = checkPick(s, asset, task, a.pick);
      if (typeof pick === 'string') return fail(pick);
      if (a.research && !researchSlotOf(s, al, task)) return fail('Research is for a part in the IPC.');
      release(s, o.id);
      cancelReqsOf(s, o.id);
      untiePos(s, o.id);
      o.flow.pick = pick;
      delete o.flow.stop;
      delete o.flow.stopResearch;
      o.flow.bom = bomValue(jobLines(o));
      reserve(s, o.id, jobLines(o));
      if (isSafetyJob(s, o)) for (const sh of jobLines(o)) takeSoft(s, o.id, sh.item, sh.qty - (s.inv?.[sh.item]?.res?.[o.id] ?? 0));
      if (o.approvedWeek !== undefined) {
        // an approved job keeps its labour paid: its new shortfall goes to the analyst as requisitions
        for (const l of uncovered(s, o)) {
          const q = newReq(s, { at: now, role: o.role as OpsRole, item: l.item, qty: l.qty, order: o.id, why: `${o.title} on ${asset.name}` });
          (o.flow.reqs ??= []).push(q.id);
        }
        o.status = jobReady(s, o) ? 'ready' : 'waiting_part';
      }
      if (a.research) openResearch(s, o, al, task, nameOf(s, a.role), now);
      for (const x of allocate(s)) partsIn(s, x, now);
      feed(s, a.role, 'info', `${nameOf(s, a.role)} repicked ${o.title} on ${asset.name}.`, now);
      return { s };
    }
    case 'dropJob': {
      const o = s.orders.find((x) => x.id === a.order);
      if (!o?.flow || o.status === 'done' || o.status === 'cancelled') return fail('That job is not open.');
      if (o.role !== a.role) return fail('Not your trade.');
      release(s, o.id);
      cancelReqsOf(s, o.id);
      untiePos(s, o.id);
      // a job never started gives its labour back: dropping a wrong task to plan the right one doesn't pay twice
      // (a part already bought for it lands as free stock)
      const refund = o.approvedWeek !== undefined && !o.result ? o.cost : 0;
      if (refund > 0) {
        s.cash += refund;
        book(s, 'labor', -refund, { trade: o.role as OpsRole, asset: o.assetId });
        if (o.autoApproved && o.approvedWeek === W) s.autoSpent[o.role as OpsRole] = Math.max(0, (s.autoSpent[o.role as OpsRole] ?? 0) - refund);
      }
      o.status = 'cancelled';
      const al = alertOf(s, o);
      if (al && al.status === 'job') {
        al.status = 'open';
        delete al.order;
      }
      for (const x of allocate(s)) partsIn(s, x, now);
      feed(s, a.role, 'info', `${nameOf(s, a.role)} dropped ${o.title}: the alert is open again${refund ? ` (the ${usd(refund)} of labour comes back: it was never started)` : ''}.`, now);
      return { s };
    }
    case 'request': {
      const x = itemById(a.item);
      if (!x) return fail(`Unknown item ${a.item}.`);
      if (x.trade !== a.role) return fail('Not your trade.');
      const max = x.kind === 'tool' ? 1 : 50;
      const cap = x.cut ? STOCK.maxQty : max;
      if (!(a.qty >= 1 && a.qty <= cap)) return fail(x.kind === 'tool' ? 'One of a tool.' : `Ask for 1 to ${max}.`);
      // a repeat request for the same line folds into the open one; a trade keeps at most STOCK.maxReqs open (the doc stays bounded)
      const same = (s.reqs ?? []).find((r) => r.status === 'open' && !r.order && r.role === a.role && r.item === a.item);
      if (same) {
        if (x.kind === 'tool') return fail(`Already asked: ${nameOf(s, 'fin')} decides on it.`);
        same.qty = Math.min(cap, same.qty + Math.round(a.qty));
        same.at = now;
        if (a.why) same.why = a.why.slice(0, 120);
        feed(s, a.role, 'info', `${nameOf(s, a.role)} asked for ${a.qty} more × ${x.pn}: ${same.qty} in all, the analyst's call.`, now);
        return { s };
      }
      if ((s.reqs ?? []).filter((r) => r.status === 'open' && !r.order && r.role === a.role).length >= STOCK.maxReqs)
        return fail(`${STOCK.maxReqs} requests are already waiting on ${nameOf(s, 'fin')}: cancel one, or wait for the desk.`);
      newReq(s, { at: now, role: a.role, item: a.item, qty: Math.round(a.qty), ...(a.why ? { why: a.why.slice(0, 120) } : {}) });
      feed(s, a.role, 'info', `${nameOf(s, a.role)} asked for ${a.qty} × ${x.pn} ${x.nomen.split(',')[0].toLowerCase()}: the analyst's call.`, now);
      return { s };
    }
    case 'cancelReq': {
      const r = s.reqs?.find((x) => x.id === a.req);
      if (!r || r.status !== 'open') return fail('That request is not open.');
      if (a.role !== r.role && a.role !== 'fin') return fail('Only who asked, or the analyst.');
      r.status = 'cancelled';
      r.closed = W;
      for (const x of allocate(s)) partsIn(s, x, now);
      return { s };
    }
    case 'approveReq': {
      const reqs = a.reqs.map((id) => s.reqs?.find((x) => x.id === id));
      if (!reqs.length || reqs.some((r) => !r || r.status !== 'open')) return fail('That request is no longer waiting.');
      const lineFreight = a.buy?.freight === 'aog' ? FREIGHT.aog : schedFreight(s, reqs.map((r) => ({ item: r!.item, vendor: itemById(r!.item) ? vendorFor(itemById(r!.item)!, a.buy) : undefined }))).cost;
      const cost = reqs.reduce((n, r) => n + reqCost(r!, a.buy), 0) + lineFreight;
      // a stock request (no job) takes a bin like any stock buy
      const fresh = [...new Set(reqs.filter((r) => !r!.order).map((r) => r!.item))].filter((id) => needsNewBin(s, id));
      if (fresh.length && binsInUse(s) + fresh.length > binsTotal(s)) return fail(`Stores full: ${binsInUse(s)} of ${binsTotal(s)} bins. Use up, scrap or return a line first.`);
      const urgent = reqs.some((r) => urgentReq(s, r!));
      // the cash rules go by the safety-critical requests' share of a batch, not the batch (the release gate: one urgent
      // part in a batch waved plain stock requests past the $2,000 freeze, had the receiver fund them, or waved them past
      // its $800 block). The rest has to pass on its own: a tool a job needs, the cash above $0, the block
      const rest = reqs.filter((r) => !urgentReq(s, r!));
      const tool = rest.every((r) => itemById(r!.item)?.kind === 'tool' && r!.order);
      const urgentShare = urgent && rest.length ? reqsCost(s, reqs.filter((r) => urgentReq(s, r!)) as Requisition[], a.buy) : cost;
      const plain = urgent ? Math.max(0, cost - urgentShare) : cost;
      const alone = `The receiver funds only the safety-critical requests: approve those on their own; the rest (${usd(plain)}) waits for cash above $0.`;
      if (spendable(s) < ECON.freezeBelow && rest.length && !tool)
        return fail(urgent && s.receivership > 0 ? alone : `Spendable cash under ${usd(ECON.freezeBelow)}: only safety-critical work can be approved${urgent ? ': approve the safety-critical requests on their own' : ''}.`);
      const adv = receiverFunds(s, cost, urgent);
      if (s.receivership > 0 && urgent && plain > 0 && spendable(s) - cost < 0 && plain > Math.max(0, spendable(s))) return fail(alone);
      if (spendable(s) - cost < 0 && adv === null) return fail(noCash(s, cost, urgent));
      if (s.receivership > 0 && plain > 800) return fail('Receivership: the receiver blocks spend over $800 except safety-critical work.');
      if (adv) receiverAdvance(s, adv, `the parts for ${reqs.length > 1 ? `${reqs.length} requests` : 'a request'}`, now);
      const pos = placePo(
        s,
        reqs.map((r) => ({ item: r!.item, qty: r!.qty, req: r!.id, ...(r!.order ? { order: r!.order } : {}) })),
        a.buy ?? {},
        'fin',
        now,
      );
      for (const r of reqs) {
        r!.status = 'ordered';
        r!.po = pos.find((p) => p.lines.some((l) => l.req === r!.id))?.id;
      }
      gainXp(s, 'fin', 10);
      feed(s, 'fin', 'good', `Approved ${reqs.length} request${reqs.length > 1 ? 's' : ''} (${usd(cost)}): ${pos.map((p) => p.id).join(', ')}.`, now);
      return { s };
    }
    case 'deferReq': {
      const r = s.reqs?.find((x) => x.id === a.req);
      if (!r || r.status !== 'open') return fail('That request is no longer waiting.');
      if (r.deferredWeek === W) return fail('Already deferred this week.');
      r.deferredWeek = W;
      gainXp(s, 'fin', 10);
      return { s };
    }
    case 'buy': {
      if (!a.lines.length || a.lines.length > STOCK.maxLines) return fail(`A buy is 1 to ${STOCK.maxLines} lines.`);
      for (const l of a.lines) {
        const x = itemById(l.item);
        if (!x) return fail(`Unknown item ${l.item}.`);
        if (!(l.qty >= 1 && l.qty <= STOCK.maxQty)) return fail(`Buy 1 to ${STOCK.maxQty} of an item.`);
      }
      if (spendable(s) < ECON.freezeBelow) return fail(`Spendable cash under ${usd(ECON.freezeBelow)}: stock orders are frozen.`);
      const cost =
        a.lines.reduce((n, l) => n + reqCost({ item: l.item, qty: l.qty }, a.buy), 0) +
        (a.buy?.freight === 'aog' ? FREIGHT.aog : schedFreight(s, a.lines.map((l) => ({ item: l.item, vendor: vendorFor(itemById(l.item)!, a.buy) }))).cost);
      if (spendable(s) - cost < 0) return fail('Not enough cash.');
      const fresh = [...new Set(a.lines.map((l) => l.item))].filter((id) => needsNewBin(s, id));
      if (fresh.length && binsInUse(s) + fresh.length > binsTotal(s))
        return fail(`Stores full: ${binsInUse(s)} of ${binsTotal(s)} bins. Use up, scrap or return a line first.`);
      const pos = placePo(s, a.lines, a.buy ?? {}, 'fin', now);
      feed(s, 'fin', 'info', `${nameOf(s, 'fin')} ordered stock: ${pos.map((p) => `${p.id} ${usd(p.cost)}`).join(', ')}.`, now);
      for (const x of allocate(s)) partsIn(s, x, now);
      return { s };
    }
    case 'setStock': {
      const x = itemById(a.item);
      if (!x) return fail(`Unknown item ${a.item}.`);
      if (x.kind === 'tool' || x.trade === 'build') return fail('Tools and building materials take no min/max.');
      if (a.rop === null || a.max === null) {
        if (a.rop !== null || a.max !== null) return fail('Set both, or clear both.');
        const l = s.inv?.[a.item];
        if (l) {
          delete l.rop;
          delete l.max;
          if (l.on <= 0 && !l.res) delete s.inv![a.item];
        }
        return { s };
      }
      if (!(a.rop >= 0 && a.rop < a.max && a.max <= STOCK.maxQty)) return fail(`The min is 0 or more, under the max, and the max ${STOCK.maxQty} or less.`);
      if (needsNewBin(s, a.item) && !binFree(s)) return fail(`Stores full: ${binsInUse(s)} of ${binsTotal(s)} bins. Use up, scrap or return a line first.`);
      const l = ((s.inv ??= {})[a.item] ??= { on: 0 });
      l.rop = Math.round(a.rop);
      l.max = Math.round(a.max);
      return { s };
    }
    case 'scrap': {
      const x = itemById(a.item);
      if (!x) return fail(`Unknown item ${a.item}.`);
      if (!(a.qty >= 1 && a.qty <= available(s, a.item))) return fail(`Only ${available(s, a.item)} free to scrap.`);
      const r = scrapItem(s, a.item, a.qty);
      feed(s, 'fin', 'info', r.credit ? `${nameOf(s, 'fin')} returned ${a.qty} × ${x.pn}: ${usd(r.credit)} store credit (${usd(r.loss)} lost).` : `${nameOf(s, 'fin')} wrote off ${a.qty} × ${x.pn} (${usd(r.loss)}).`, now);
      for (const o of allocate(s)) partsIn(s, o, now);
      return { s };
    }
    case 'nudge': {
      const al = alertById(s, a.alert);
      if (!al || al.status !== 'open') return fail('That alert is not open.');
      if (al.nudged === W) return fail('Already nudged this week.');
      al.nudged = W;
      const asset = s.assets.find((x) => x.id === al.assetId);
      feed(s, al.role, 'info', `${nameOf(s, 'fin')}: ${asset?.name ?? 'the asset'}'s ${shortText(s, al)} is due week ${al.due}. Plan it so the parts come in time.`, now);
      return { s };
    }
  }
}

/** the alert's symptom in a few words ("brake pedal soft") */
const shortText = (s: IslandState, al: Alert): string => alertShort(s, al);

/** close an alert (fixed, no fault, the wiring, dropped) */
function closeAlert(s: IslandState, al: Alert, how: 'fixed' | 'nff' | 'wired' | 'dropped') {
  al.status = 'closed';
  al.closed = { week: s.week, how };
  // a neutral fault fixed: the breaker's hidden miss goes with it
  if (how === 'fixed' || how === 'wired') s.defects = (s.defects ?? []).filter((d) => !(d.puzzle === 'elec' && d.variant === 'isolation' && d.alert?.alert === al.id));
}

/** validate a pick against the task: items of the trade, 0-10 lines, 1-500 units; a rare job carries its pre-filled line */
function checkPick(s: IslandState, asset: Asset, task: Task, pick: PickLine[]): PickLine[] | string {
  if (task.fixed) {
    const fixed = fixedFor(task, asset);
    if (!pick.length) return fixed.map((l) => ({ ...l }));
    const same = pick.length === fixed.length && fixed.every((f) => pick.some((l) => l.item === f.item && l.qty === f.qty));
    return same ? fixed.map((l) => ({ ...l })) : 'That job carries its pre-filled line.';
  }
  if (pick.length > 10) return 'A pick is 10 lines at most.';
  const out: PickLine[] = [];
  for (const l of pick) {
    const x = itemById(l.item);
    if (!x) return `Unknown item ${l.item}.`;
    if (x.trade !== task.trade || x.kind === 'tool') return `${x.pn} isn't ${task.trade === 'mech' ? 'a mechanic' : 'an electrician'}'s part.`;
    if (!(l.qty >= 1 && l.qty <= STOCK.maxQty)) return `Quantities are 1 to ${STOCK.maxQty}.`;
    out.push({ item: l.item, qty: Math.round(l.qty), ...(l.slot && task.main.some((m) => m.slot === l.slot) ? { slot: l.slot } : {}) });
  }
  void s;
  return out;
}

/** the IPC slot the research branch would be about (a plane task's slot on an assembly an alteration can replace) */
function researchSlotOf(s: IslandState, al: Alert, task: Task): { slot: string; ata: Ata; tag: string } | null {
  const asset = s.assets.find((x) => x.id === al.assetId);
  if (!asset || asset.kind !== 'plane' || task.trade !== 'mech') return null;
  const needs = needsOf(s, al);
  const cands = task.main.filter((m) => m.ata && m.tag && m.ata !== '79-20');
  const m = cands.find((x) => needs.includes(x.slot)) ?? cands[0];
  return m ? { slot: m.slot, ata: m.ata as Ata, tag: m.tag! } : null;
}

/**
 * A plan (7, 8.1): the job for the alert with the chosen task and pick, the
 * stock it reserves (a safety plan takes soft reservations from other cards),
 * the card's price, and the work budget: everything on hand is approved at
 * once by the trade (safety work past the budget); anything to buy is a card
 * for the analyst. `research`: the part chain's research branch for the
 * task's IPC slot. Returns the job, or why not.
 */
function planAlert(s: IslandState, al: Alert, taskId: string, rawPick: PickLine[], now: number, research: boolean | undefined, who: string): Order | string {
  const asset = s.assets.find((x) => x.id === al.assetId);
  if (!asset) return 'That asset is gone.';
  const task = planTask(s, al, taskId);
  if (al.repair) {
    if (!task || task.id !== `repair:${al.id}`) return 'A repair goes by its own task.';
  } else {
    if (!task || !tasksFor(s, asset, al.role).some((t) => t.id === task.id)) return `That task isn't in the manual set for ${asset.name}.`;
    if (!plannable(task)) return "That's reference only: pick the task that does the work.";
  }
  // G0 (review round 1): the county won't pass a renovation's final with a hazard open on the house: make it safe first
  if (task.kind === 'codeprep' && renoAwaitingFinal(s, asset.id) && closingHazard(s, asset.id)) return `The final won't pass with a hazard open on ${asset.name}: make it safe or fix it first.`;
  const picked = checkPick(s, asset, task, rawPick);
  if (typeof picked === 'string') return picked;
  const rs = research ? researchSlotOf(s, al, task) : null;
  if (research && !rs) return 'Research is for a part in the IPC.';
  // the researched slot's part comes through the chain, not the shelf
  const pick = rs ? picked.filter((l) => l.slot !== rs.slot && itemById(l.item)?.slot !== rs.tag) : picked;
  const ac = acOf(s, asset);
  const site = siteOf(s, al);
  const flow: JobFlow = { alert: al.id, task: task.id, pick, bench: benchFor(task, ac, asset), tools: [...task.tools], bom: 0 };
  let o: Order;
  if (al.repair) {
    const d = al.repair.defect;
    o = addRepair(s, d, al.repair.via, { foundBy: al.repair.foundBy, foundIn: al.repair.foundIn, incident: al.repair.incident });
    o.cost = repairLabor(s, { cost: d.cost, puzzle: d.puzzle, role: d.role, orderKind: d.rule ?? d.orderKind, variant: d.variant, job: d.job });
    o.parts = 0;
  } else {
    const kind = task.kind!;
    const c = CATALOG_BY_KIND[kind];
    o = newOrder(s, {
      role: al.role,
      kind,
      assetId: asset.id,
      title: task.short,
      puzzle: c.puzzle,
      // stage 2 (docs/EXPANSION.md 6.4): found early by a quick check, the job plays one order tier easier (never under
      // 1), and a blind job stays blind (review round 1: flow.ts earlyTier)
      tier: earlyTier(orderTier(kind, asset, s.tier), earlyLess(al)),
      // (and prices one tier lower: caught early, it's less work)
      cost: laborCost(s, kind, task, asset, site, needsOf(s, al), earlyLess(al)),
      parts: 0,
      gain: c.gain,
      status: 'pending',
      job: task.job ?? kind,
    });
  }
  o.flow = flow;
  o.at = now;
  al.status = 'job';
  al.order = o.id;
  const lines = jobLines(o);
  const short = reserve(s, o.id, lines);
  if (isSafetyJob(s, o)) for (const sh of short) takeSoft(s, o.id, sh.item, sh.short);
  flow.bom = Math.round(bomValue(lines) * 100) / 100;
  if (!allOnHand(s, o)) flow.short = true;
  const [f, p] = fillOf(s, o);
  bookFill(s, f, p);
  if (rs) openResearch(s, o, al, task, who, now);
  // everything on hand: the trade approves it on its work budget (safety work past it)
  if (workBudgetOk(s, o)) approveFlow(s, o, true, {}, 'auto', now);
  const where = asset.name;
  if (o.status === 'pending') {
    const card = cardOf(s, o);
    feed(s, o.role, 'info', `${who} sent ${o.title} on ${where} to ${nameOf(s, 'fin')}: ${usd(card.total)} (${card.toBuy.length + card.tools.length ? `parts ${usd(card.total - card.labour)}, ` : ''}labour ${usd(card.labour)}).`, now);
  } else if (o.status === 'ready') feed(s, o.role, 'good', `${who} planned ${o.title} on ${where}: everything on the shelf, ready now.`, now);
  else feed(s, o.role, 'info', `${who} planned ${o.title} on ${where}.`, now);
  return o;
}

/** the work budget (8.4): every line and tool on hand, the labour inside the trade's budget or safety work, and the cash for it */
function workBudgetOk(s: IslandState, o: Order): boolean {
  if (!o.flow || o.status !== 'pending') return false;
  if (!allOnHand(s, o)) return false;
  const role = o.role as OpsRole;
  const safety = isSafetyJob(s, o);
  const lab = o.cost;
  if (!(s.autoSpent[role] + lab <= s.autoBudget[role] || safety)) return false;
  if (spendable(s) - lab < (safety ? 0 : ECON.freezeBelow)) return false;
  if (s.receivership > 0 && lab > 300 && !safety) return false;
  return true;
}

/**
 * Approve a flow card (the analyst, the work budget, the standing approval,
 * autopilot): the labour leaves the bank now, the lines to buy go on POs
 * (committed, paid at the payment run after they land), soft reservations
 * become hard. The job waits for its parts or is ready.
 */
function approveFlow(s: IslandState, o: Order, auto: boolean, buy: BuyChoice, by: Role | 'auto', now: number) {
  const role = o.role as OpsRole;
  const lines = cardBuyLines(s, o);
  s.cash -= o.cost;
  if (auto) s.autoSpent[role] = (s.autoSpent[role] ?? 0) + o.cost;
  book(s, 'labor', o.cost, { trade: role, asset: o.assetId });
  o.approvedWeek = s.week;
  o.autoApproved = auto;
  o.pushedBack = false;
  delete o.counter;
  if (lines.length) placePo(s, lines.map((l) => ({ item: l.item, qty: l.qty, order: o.id })), buy, by, now);
  o.status = jobReady(s, o) ? 'ready' : 'waiting_part';
}

function approveFlowCard(s: IslandState, prev: IslandState, o: Order, buy: BuyChoice | undefined, now: number): ApplyResult {
  const fail = (error: string): ApplyResult => ({ s: prev, error });
  const card = cardOf(s, o, buy);
  const freight = buy?.freight ?? card.freight.pick;
  const cost = cardOf(s, o, { ...(buy ?? {}), freight }).total;
  const urgent = isEmergency(s, o);
  if (spendable(s) < ECON.freezeBelow && !urgent) return fail(`Cash under ${usd(ECON.freezeBelow)}: only safety-critical work can be approved.`);
  const adv = receiverFunds(s, cost, urgent);
  if (spendable(s) - cost < 0 && adv === null) return fail(noCash(s, cost, urgent));
  if (s.receivership > 0 && cost > 800 && !urgent) return fail('Receivership: the receiver blocks spend over $800 except safety-critical work.');
  if (adv) receiverAdvance(s, adv, o.title, now);
  approveFlow(s, o, false, { ...(buy ?? {}), freight }, 'fin', now);
  gainXp(s, 'fin', 10);
  feed(s, 'fin', 'good', `Approved ${o.title} (${usd(cost)}${freight === 'aog' && card.freight.aog ? ', on the AOG boat' : ''}).`, now);
  return { s };
}

/** the value of a requisition line at a supplier (whole packs) */
/** what a set of requisitions costs on one approval: the lines at the supplier plus their freight */
function reqsCost(s: IslandState, reqs: Requisition[], buy?: BuyChoice): number {
  const freight = buy?.freight === 'aog' ? FREIGHT.aog : schedFreight(s, reqs.map((r) => ({ item: r.item, vendor: itemById(r.item) ? vendorFor(itemById(r.item)!, buy) : undefined }))).cost;
  return reqs.reduce((n, r) => n + reqCost(r, buy), 0) + freight;
}

function reqCost(r: { item: ItemId; qty: number }, buy?: BuyChoice): number {
  const x = itemById(r.item);
  if (!x) return 0;
  const vendor = buy?.vendor && SUPPLIERS[buy.vendor].trade === x.trade ? buy.vendor : undefined;
  const packs = x.cut || x.pack <= 1 ? r.qty : Math.ceil(r.qty / x.pack) * x.pack;
  return priceAt(x, vendor) * packs;
}

/** cancel a job's requisitions nobody has ordered (ordered lines arrive into stock, untied) */
function cancelReqsOf(s: IslandState, order: string) {
  for (const r of s.reqs ?? []) {
    if (r.order !== order) continue;
    if (r.status === 'open') {
      r.status = 'cancelled';
      r.closed = s.week;
    } else if (r.status === 'ordered') delete r.order;
  }
}

/** a job's PO lines not received yet land as free stock */
function untiePos(s: IslandState, order: string) {
  for (const p of s.pos ?? []) for (const l of p.lines) if (l.order === order && l.got === undefined) delete l.order;
}

/** the allocation made a job ready: say so */
function partsIn(s: IslandState, o: Order, now: number) {
  const asset = s.assets.find((a) => a.id === o.assetId);
  feed(s, o.role, 'good', `Parts for ${o.title}${asset ? ` on ${asset.name}` : ''} are in: ${nameOf(s, o.role)}, your move.`, now);
}

/**
 * The part chain's research branch from the flow (13): the chain opens at
 * research for this job and the task's IPC slot (it doesn't ground the plane
 * by itself), or the job queues behind the open chain.
 */
function openResearch(s: IslandState, o: Order, al: Alert, task: Task, who: string, now: number) {
  const rs = researchSlotOf(s, al, task);
  const asset = s.assets.find((x) => x.id === o.assetId);
  if (!rs || !asset || !o.flow) return;
  o.flow.research = true;
  o.flow.researchSlot = rs.slot;
  if (openChain(s)) {
    o.flow.queued = true;
    feed(s, 'mech', 'info', `${who}: the ${itemName(rs.tag, asset.model)} on ${asset.name} isn't in the IPC. Research waits for the open part chain to close.`, now);
    return;
  }
  delete o.flow.queued;
  const c: PartChain = {
    id: `c${s.nextId++}`,
    orderId: o.id,
    assetId: asset.id,
    title: o.title,
    ata: rs.ata,
    tag: rs.tag,
    item: itemName(rs.tag, asset.model),
    how: 'damaged',
    found: symptomText(s, al),
    by: who,
    week: s.week,
    step: 'research',
    returns: 0,
    rejects: 0,
    spent: 0,
    aogWeeks: 0,
    flow: true,
  };
  s.chain = c;
  o.chain = { id: c.id, step: 'job' };
  if (o.status === 'ready') o.status = 'waiting_part';
  researchStep(s, c, now);
  feed(s, 'mech', 'info', `${who}: the ${c.item} on ${asset.name} isn't in the IPC. Next: research its logbooks for the alteration.`, now);
}

/** a queued research opens when no chain is open (every resolve and every chain close) */
function openQueuedResearch(s: IslandState, now: number) {
  if (openChain(s)) return;
  const o = s.orders.find((x) => x.flow?.queued && open(x));
  if (!o) return;
  const al = alertOf(s, o);
  const task = al ? planTask(s, al, o.flow!.task) : undefined;
  if (!al || !task) {
    delete o.flow!.queued;
    return;
  }
  openResearch(s, o, al, task, nameOf(s, 'mech'), now);
}

/** the electrician's check at the airplane for a flow alert (5.4): a meter job on the unit's circuit */
function flowBenchOrder(s: IslandState, al: Alert, again: boolean): Order {
  const asset = s.assets.find((x) => x.id === al.assetId)!;
  const radio = al.sym.startsWith('M_COM');
  const tag = radio ? 'radio' : 'generator';
  const item = itemName(tag, asset.model);
  return newOrder(s, {
    role: 'elec',
    kind: 'bench',
    assetId: asset.id,
    title: radio ? `Meter the com radio's power and ground on ${asset.name}${again ? ' again' : ''}` : `Meter the ${item} field circuit on ${asset.name}${again ? ' again' : ''}`,
    puzzle: 'meter',
    tier: clamp(1 + Math.floor(s.tier / 2), 1, 5),
    cost: 0,
    parts: 0,
    gain: 0,
    status: 'ready',
    job: benchJob(tag, asset.model),
    bench: al.id,
    approvedWeek: s.week,
    autoApproved: true,
  });
}

/** the electrician's check handed in (a flow alert's bench order): what it says moves the alert on (right or wrong shows later) */
function flowBenchStep(s: IslandState, o: Order, a: Extract<Action, { t: 'complete' }>, name: string, covered: boolean, blind: boolean, turn: TurnState, now: number): ApplyResult {
  const al = o.bench ? alertById(s, o.bench) : undefined;
  const data = (a.data?.chain ?? {}) as { call?: string; fixed?: boolean; where?: string };
  turn.done += 1;
  // teaching tiers show the verdict: a check that failed its own test isn't sent on
  if (!blind && !covered && a.score < SIGNOFF && al) {
    o.seed = hashSeed(o.seed, `rework${s.week}`);
    feed(s, o.role, 'bad', `${name}: ${o.title} didn't pass its check (${Math.round(a.score * 100)}%). Still open.`, now);
    return { s };
  }
  const cr = credit(a.score, 0);
  o.status = 'done';
  o.result = { score: a.score, perfect: a.perfect, credit: cr, by: a.role, week: s.week, covered, ...(blind ? { blind: true, provisional: DEFECT.provisional } : { summary: a.summary }) };
  gainXp(s, a.role, blind ? blindXpFloor(o.tier) : Math.round(orderXp(o.tier, cr, a.perfect) * (covered ? 0.5 : 1)));
  if (al && al.status !== 'closed') flowBenchDone(s, al, data, name, now);
  return { s };
}

/** the job replaces the unit (a unit cause's fix): the one that makes no difference when the fault is the wiring */
function unitJob(s: IslandState, al: Alert, o: Order): boolean {
  const sym = symptomOf(al);
  const asset = s.assets.find((x) => x.id === al.assetId);
  if (!sym || !asset || !o.flow) return false;
  return sym.causes.some((c) => c.kind !== 'wiring' && !!c.fix && taskOn(c.fix, asset)?.id === o.flow!.task);
}

/** the fault the check really finds: the wiring cause, or the unit */
export const benchFault = (al: Pick<Alert, 'sym' | 'cause'>): 'unit' | 'wiring' => (causeOf(al)?.kind === 'wiring' ? 'wiring' : 'unit');

/**
 * The electrician's check is in (a flow alert). "The unit": the mechanic plans
 * the part as usual; on a wiring fault that call's consequence is the missed
 * wiring at the install (the new unit makes no difference, the check runs
 * again), as the part chain's check has it: nothing hidden is planted. "The
 * wiring", fixed at the airplane: no part; the mechanic still signs the
 * airplane back into service (14 CFR 43.3, 43.7): the alert's job (or a new
 * one) becomes the return-to-service step, ready at the task's labour floor.
 * Called on a unit that is really dead, the dead unit goes back into service
 * (a sure defect).
 */
function flowBenchDone(s: IslandState, al: Alert, data: { call?: string; fixed?: boolean; where?: string }, name: string, now: number) {
  const b = (al.bench ??= {});
  const asset = s.assets.find((x) => x.id === al.assetId)!;
  const fault = benchFault(al);
  const call: 'unit' | 'wiring' = b.again || data.call === 'wiring' ? 'wiring' : 'unit';
  b.call = call;
  b.by = name;
  b.week = s.week;
  const radio = al.sym.startsWith('M_COM');
  const item = itemName(radio ? 'radio' : 'generator', asset.model);
  const mech = nameOf(s, 'mech');
  if (call === 'unit') {
    feed(s, 'all', 'info', `${name} metered the ${item} circuit on ${asset.name}: the wiring checks good, it's the ${item}.`, now);
    return;
  }
  const right = fault === 'wiring' && (!!b.again || !!data.fixed);
  // the return-to-service step: the alert's job, or a new one with the unit's task and no lines
  let job = al.order ? s.orders.find((x) => x.id === al.order && open(x)) : undefined;
  if (job?.flow) {
    release(s, job.id);
    cancelReqsOf(s, job.id);
    untiePos(s, job.id);
    job.flow.wired = true;
    job.flow.pick = [];
    job.flow.bench = [];
    job.flow.tools = [];
    delete job.flow.stop;
    delete job.flow.stopResearch;
  } else {
    const kind = symptomOf(al)?.causes.find((c) => c.kind !== 'wiring')?.kind ?? (radio ? 'avionics' : 'alternator');
    const task = defaultTask(kind, asset);
    const c = CATALOG_BY_KIND[kind];
    job = newOrder(s, {
      role: 'mech',
      kind,
      assetId: asset.id,
      title: task?.short ?? c.title,
      puzzle: c.puzzle,
      tier: orderTier(kind, asset, s.tier),
      cost: task ? laborMin(task) : LABOR_FLOOR,
      parts: 0,
      gain: c.gain,
      status: 'pending',
      job: task?.job ?? kind,
      at: now,
      flow: { alert: al.id, task: task?.id ?? `amm:${planeModel(asset.model)}:24-30-01`, pick: [], bench: [], tools: [], bom: 0, wired: true },
    });
    al.status = 'job';
    al.order = job.id;
  }
  const title = job.title.replace(/^Finish /, '').replace(/: the fault was in the wiring.*$/, '');
  job.title = `Finish ${title}: the fault was in the wiring (inspect the splice per AC 43.13-1B, ops check, sign off)`;
  if (job.approvedWeek === undefined) {
    const task = job.flow?.task ? taskById(job.flow.task) : undefined;
    job.cost = task ? laborMin(task) : LABOR_FLOOR;
    approveFlow(s, job, true, {}, 'auto', now);
  }
  job.status = 'ready';
  if (!right) benchMiss(s, al, asset, name, 'wiring', radio);
  feed(s, 'all', 'good', `${name} metered the ${item} circuit on ${asset.name} and fixed the fault in the wiring: no part needed. ${mech}, finish the job and sign it back into service.`, now);
}
const LABOR_FLOOR = 50;

/** a wrong circuit-check call: the dead unit back in service, or the break still in the wiring (today's meter rules) */
function benchMiss(s: IslandState, al: Alert, asset: Asset, name: string, call: 'unit' | 'wiring', radio: boolean) {
  const r = rng(hashSeed(al.seed, 'bench-miss', s.week));
  const variant = call === 'wiring' ? (radio ? 'radio' : 'unit') : 'wiring';
  (s.defects ??= []).push({
    id: `d${s.nextId++}`,
    orderKind: 'bench',
    job: radio ? 'avionics' : 'alternator',
    log: `${itemName(radio ? 'radio' : 'generator', asset.model)} circuit check`,
    puzzle: 'meter',
    variant,
    title: `Meter the ${itemName(radio ? 'radio' : 'generator', asset.model)} circuit`,
    assetId: asset.id,
    role: 'mech',
    by: 'elec',
    name,
    week: s.week,
    dueWeek: s.week + r.int(1, 2),
    severity: 1,
    cost: radio ? 950 : 760,
    tier: clamp(1 + Math.floor(s.tier / 2), 1, 5),
    gain: 0,
    redo: false,
  });
}

/**
 * Skipping the electrician's check when the fault is the wiring (5.4): the
 * unit goes on, the ground run still shows no output, and the job doesn't sign
 * off. A unit bought for it goes back (credit less restocking); a pulled one
 * goes back on the shelf. The electrician's check opens; the job waits.
 */
function missedWiringFlow(s: IslandState, o: Order, al: Alert, name: string, turn: TurnState, now: number) {
  const asset = s.assets.find((x) => x.id === o.assetId)!;
  let credited = 0;
  for (const p of s.pos ?? [])
    for (const l of p.lines) {
      if (l.order !== o.id || !l.got || l.back) continue;
      const x = itemById(l.as ?? l.item);
      if (!x || (x.kind !== 'rotable' && x.kind !== 'part')) continue;
      const id = l.as ?? l.item;
      const line = s.inv?.[id];
      if (!line) continue;
      const q = Math.min(line.res?.[o.id] ?? 0, l.qty);
      if (q <= 0) continue;
      line.on -= q;
      line.res![o.id] -= q;
      const value = q * l.unit;
      const fee = restockFeeOf(value);
      credited += value - fee;
      s.credit = Math.round(((s.credit ?? 0) + value - fee) * 100) / 100;
    }
  release(s, o.id);
  turn.done += 1;
  gainXp(s, 'mech', blindXpFloor(o.tier));
  o.status = 'waiting_part';
  const elec = nameOf(s, 'elec');
  o.flow!.stop = `Still no output with the new unit: waiting on ${elec}'s circuit check`;
  const b = flowBenchOrder(s, al, true);
  // (no `call` key at all: a key set to undefined keeps its place in memory but not through JSON, and the doc must stringify the same either way)
  const { call: _called, ...bench } = al.bench ?? {};
  al.bench = { ...bench, order: b.id, again: true };
  feed(
    s,
    'all',
    'bad',
    `${name} put the new unit on ${asset.name}: ground run, still no output. The removed unit tests good on the bench, so it's the wiring.${credited ? ` The unit bought goes back: ${usd(credited)} store credit.` : ''} ${elec}, meter the circuit.`,
    now,
  );
}

/** a hidden comeback (5.5, 11.1): a wrong task or an NFF close on a real fault re-raises the alert later */
function plantComeback(s: IslandState, al: Alert, variant: 'task' | 'nff', name: string, by: Role, o?: Order, severity: 1 | 2 = 1) {
  const r = rng(hashSeed(al.seed, 'again', s.week, variant));
  const asset = s.assets.find((x) => x.id === al.assetId);
  (s.defects ??= []).push({
    id: `d${s.nextId++}`,
    orderKind: o?.kind ?? al.kind,
    job: al.kind,
    log: o ? (CATALOG_BY_KIND[o.kind]?.log ?? o.title.toLowerCase()) : 'no-fault-found close',
    puzzle: 'flow',
    variant,
    alert: { sym: al.sym, kind: al.kind, alert: al.id, cause: al.cause },
    words: { symptom: shortText(s, al) },
    title: o?.title ?? `No fault found: ${shortText(s, al)}`,
    assetId: asset?.id ?? null,
    role: al.role,
    by,
    name,
    week: s.week,
    dueWeek: s.week + r.int(ALERTS.againMin, ALERTS.againMax),
    severity,
    cost: o?.cost ?? 0,
    tier: o?.tier ?? 1,
    gain: 0,
    redo: false,
    ...(o?.flow ? { task: o.flow.task } : {}),
  });
}

/** make-safe at a branch breaker on a service-neutral fault: it isn't isolated (10) */
function plantIsolation(s: IslandState, al: Alert, name: string) {
  const r = rng(hashSeed(al.seed, 'isolation', s.week));
  const site = siteOf(s, al);
  (s.defects ??= []).push({
    id: `d${s.nextId++}`,
    orderKind: al.kind,
    job: al.kind,
    log: 'make-safe at a branch breaker',
    puzzle: 'elec',
    variant: 'isolation',
    alert: { sym: al.sym, kind: al.kind, alert: al.id, cause: al.cause },
    words: { room: site?.room ?? 'bath' },
    title: 'Make safe: circuit off and tagged',
    assetId: al.assetId,
    role: 'elec',
    by: 'elec',
    name,
    week: s.week,
    dueWeek: s.week + r.int(1, 2),
    severity: 1,
    cost: 300,
    tier: 1,
    gain: 0,
    redo: false,
  });
}

/** re-raise an alert that wasn't fixed: the same fault, written up again (or found at an inspection), due next week */
function reraise(s: IslandState, d: Defect, src: 'again' | 'finding', now: number): Alert | undefined {
  const asset = s.assets.find((x) => x.id === d.assetId);
  if (!asset || !d.alert) return undefined;
  const sym = symptomOf({ sym: d.alert.sym });
  if (!sym) return undefined;
  const cause = d.alert.cause ?? Math.max(0, sym.causes.findIndex((c) => c.kind === d.alert!.kind));
  // still open (made safe at the wrong breaker): it is due now, and no longer safe
  const live = liveAlerts(s).find((x) => x.id === d.alert!.alert);
  if (live) {
    live.due = Math.min(live.due, s.week + 1);
    delete live.safe;
    return live;
  }
  return raiseAlert(s, { role: sym.role, asset, sym: sym.key, cause, src, due: s.week + 1, again: d.week, week: s.week + 1 }, now);
}

/**
 * The sure defects at a flow job's sign-off (11), first one only: the wrong
 * task (the fault is still there), a part that isn't effective for this
 * airplane, an ICA part with no engineering authorization, then the
 * electrician's code misses. Returns whether one was planted (it replaces the
 * quality roll's defect).
 */
function flowSureDefect(s: IslandState, o: Order, al: Alert | undefined, by: Role, name: string, score: number): boolean {
  if (!o.flow || o.flow.wired || !al) return false;
  const asset = s.assets.find((x) => x.id === o.assetId);
  if (!asset) return false;
  const severity = defectSeverity(score);
  const task = planTask(s, al, o.flow.task);
  if (!task) return false;
  // 11.1 wrong task: the fault is still there (a repair's task is its own)
  if (!al.repair && realFault(al) && !fixesOf(s, al).includes(task.id)) {
    plantComeback(s, al, 'task', name, by, o, severity);
    return true;
  }
  const base = { orderKind: o.kind, job: o.repair ? (o.repair.defect.job ?? o.repair.defect.orderKind) : o.kind, log: CATALOG_BY_KIND[o.kind]?.log, title: o.title, assetId: asset.id, role: o.role, by, name, week: s.week, severity, cost: o.cost, tier: o.tier, gain: o.gain, task: task.id };
  const due = () => s.week + rng(hashSeed(o.seed, 'sure', s.week)).int(DEFECT.dueMin, DEFECT.dueMax[severity - 1]);
  if (task.trade === 'mech' && asset.kind === 'plane') {
    const { slots } = assignSlots(task, o.flow.pick, null, acOf(s, asset));
    for (const m of task.main) {
      if (!m.ata || !m.tag) continue;
      for (const l of slots.get(m.slot) ?? []) {
        const c = judgeSlot(s, asset, m.ata as AnyAta, m.tag, l.item);
        if (!c.ok && c.why === 'noteff') {
          (s.defects ??= []).push({ ...base, id: `d${s.nextId++}`, puzzle: 'ipc', variant: 'noteff', dueWeek: due(), redo: false });
          return true;
        }
        if (c.ok && c.unapproved) {
          (s.defects ??= []).push({ ...base, id: `d${s.nextId++}`, orderKind: 'chain', job: 'records', puzzle: 'ipc', variant: 'unapproved', dueWeek: due(), redo: false });
          return true;
        }
      }
    }
  } else if (task.trade === 'elec') {
    const site = siteOf(s, al);
    const v = judgeElecPick(task, site, o.flow.pick);
    if ('ok' in v && !v.ok) {
      const what = v.variant === 'undersized' ? v.text.replace(/ on a \d+ A.*$/, '') : '';
      (s.defects ??= []).push({ ...base, id: `d${s.nextId++}`, puzzle: 'elec', variant: v.variant, words: { room: roomWord(site?.deviceRoom ?? site?.room), what: what || 'circuit' }, dueWeek: due(), redo: false });
      return true;
    }
  }
  return false;
}

const roomWord = (r?: string) => (r ? ({ bath: 'bathroom', living: 'living room', outdoor: 'porch', spa: 'spa pad', gen: 'generator house', dock: 'fuel dock' } as Record<string, string>)[r] ?? r : 'room');

/** a rule's incident words with the flow's own blanks ({symptom}, {room}, {what}) */
const flowWords = (text: string, d: Defect) => text.replace(/\{(symptom|room|what)\}/g, (_, k: string) => d.words?.[k] ?? k);

// ---------------------------------------------------------------------------
// Ground power carts

/** The island's carts, stored (an older island gets its default the first time a move touches them). */
function ensureGse(s: IslandState): GseCart[] {
  s.gse = gseCarts(s);
  return s.gse;
}

/** The mechanic's moves with a cart: charger on/off, hook up / unhook, inspect the cable. */
function gseMove(s: IslandState, prev: IslandState, a: Extract<Action, { t: 'gse' }>, now: number): ApplyResult {
  const fail = (error: string): ApplyResult => ({ s: prev, error });
  if (a.role !== 'mech') return fail('The ground power carts are the mechanic’s to move.');
  if (s.week < 1) return fail('The week has not started yet.');
  if (s.turns.mech?.ended) return fail('Your turn is over for this week.');
  const carts = ensureGse(s);
  const c = carts.find((x) => x.id === a.cart);
  if (!c) return fail('No such cart.');
  const who = s.players.mech?.name ?? ROLE_LABEL.mech;
  const planeOf = (id: string | null | undefined) => s.assets.find((x) => x.id === id && x.kind === 'plane');
  switch (a.op) {
    case 'charge': {
      if (c.charging) return { s: prev };
      const from = planeOf(c.hookedTo);
      c.hookedTo = null;
      c.charging = true;
      feed(s, 'mech', 'info', `${who} ${from ? `unhooked ${c.name} from ${from.name} and plugged it in` : `plugged ${c.name} in`} on the hangar charger.`, now);
      return { s };
    }
    case 'unplug': {
      if (!c.charging) return { s: prev };
      c.charging = false;
      feed(s, 'mech', 'info', `${who} unplugged ${c.name} from the charger.`, now);
      return { s };
    }
    case 'hook': {
      const p = planeOf(a.assetId);
      if (!p) return fail('Pick a plane to hook it up to.');
      if (c.hookedTo === p.id) return { s: prev };
      const other = carts.find((x) => x.id !== c.id && x.hookedTo === p.id);
      if (other) return fail(`${other.name} is already hooked up to ${p.name}.`);
      const rep = cableReport(s, c.id);
      if (rep) return fail(`${c.name} is tagged out: ${CABLE_REPORT[rep.report?.band ?? 'cracked'].tag}. ${s.players[rep.role]?.name ?? ROLE_LABEL[rep.role]} has to fix it first.`);
      // off the charger (you can't tow it plugged in), and onto the plane's external power receptacle
      const was = c.charging ? ' off the charger' : c.hookedTo ? ` from ${planeOf(c.hookedTo)?.name ?? 'the other plane'}` : '';
      c.charging = false;
      c.hookedTo = p.id;
      feed(s, 'mech', 'info', `${who} towed ${c.name}${was} and hooked it up to ${p.name} (${Math.round(c.charge)}% charge).`, now);
      return { s };
    }
    case 'unhook': {
      const p = planeOf(c.hookedTo);
      if (!c.hookedTo) return { s: prev };
      c.hookedTo = null;
      feed(s, 'mech', 'info', `${who} unhooked ${c.name}${p ? ` from ${p.name}` : ''} and parked it.`, now);
      return { s };
    }
    case 'inspect': {
      // once a week; and a cable re-terminated this week is left to settle (the next week's look is what counts)
      if (c.inspected?.week === s.week)
        return fail(c.inspected.fixed ? `${c.name}'s cable was re-terminated this week: look it over next week.` : `${c.name}'s cable was already inspected this week.`);
      if (cableReport(s, c.id)) return fail(`${c.name} is already tagged out for its cable.`);
      const band = cableBand(c.wear);
      // the mechanic's call on the plug end (serviceable, or tag it out); without one, the band as it is
      const call = a.call ?? (band === 'good' ? 'ok' : 'tag');
      if (call === 'ok') {
        // called serviceable: it stays in service as it is (a worn one wears on, and a start through
        // pitted contacts can arc into a plane's receptacle later)
        c.inspected = { week: s.week, band: 'good', by: who };
        feed(s, 'mech', 'info', `${who} inspected ${c.name}'s cable and plug: serviceable.`, now);
        return { s };
      }
      c.inspected = { week: s.week, band, by: who };
      feed(s, 'mech', 'bad', `${who} tagged ${c.name} out at the inspection: ${band === 'good' ? CABLE_REPORT.good.said.replace(/^the GPU cart /, 'its ') : CABLE_BAND[band]}.`, now);
      // a fix that is about to come back is the same trouble: it comes back now, found at the inspection
      const pending = (s.defects ?? []).find((d) => d.report?.key === 'gpuCable' && d.report.cart === c.id);
      if (pending) {
        s.defects = s.defects!.filter((d) => d !== pending);
        openCableReport(s, c, now, band, pending.week);
      } else openCableReport(s, c, now, band);
      return { s };
    }
  }
}

/**
 * A start on a cart: it gives up charge (a turbine takes more), and its cable
 * some wear (more if the plug went in or came out live). Returns the wear it
 * had before. The plane decides the airframe: the cargo single is the turbine,
 * the others are pistons (the puzzle draws the same one).
 */
function useCart(s: IslandState, c: GseCart, o: Order, data?: Record<string, unknown>) {
  const before = c.wear;
  const errors = Array.isArray(data?.errors) ? (data!.errors as unknown[]) : [];
  const arced = data?.defect === 'arc' || errors.includes('arcIn') || errors.includes('arcOut');
  const model = s.assets.find((a) => a.id === o.assetId)?.model;
  const turbine = model ? model === 'cargo' : data?.ac === 'turbine';
  c.charge = Math.max(0, c.charge - (turbine ? GSE.drain.turbine : GSE.drain.piston));
  c.wear = Math.min(100, c.wear + GSE.wear + (arced ? GSE.arcWear : 0));
  return before;
}

/**
 * A start through pitted, burnt plug pins can arc into the plane's external
 * power receptacle. Nothing shows at the time: the receptacle's pins are
 * pitted, and it surfaces later as the 'gpu:arc' incident (a burnt receptacle,
 * or a melted plug), traced to the start on the worn cable. Seeded from the order.
 */
function cableArc(s: IslandState, o: Order, asset: Asset, by: Role, name: string, wear: number) {
  if (wear < GSE.pitted) return;
  // one defect per sign-off: a start that already left one (a live plug) has done its damage
  if ((s.defects ?? []).some((d) => d.assetId === asset.id && d.week === s.week && d.title === o.title && d.puzzle === 'gpu')) return;
  const r = rng(hashSeed(o.seed, 'cable', s.week));
  if (!r.chance((wear - GSE.arcFrom) / GSE.arcSpan)) return;
  const severity: 1 | 2 = wear >= GSE.arcSevere ? 2 : 1;
  (s.defects ??= []).push({
    id: `d${s.nextId++}`,
    orderKind: o.kind,
    job: jobOf(o),
    log: 'ground power start on a worn cart cable',
    puzzle: 'gpu',
    variant: 'arc',
    title: o.title,
    assetId: asset.id,
    role: 'mech',
    by,
    name,
    week: s.week,
    dueWeek: s.week + r.int(DEFECT.dueMin, DEFECT.dueMax[severity - 1]),
    severity,
    cost: o.redo?.cost ?? o.cost,
    tier: o.tier,
    gain: o.gain,
    // the start itself was fine: replacing the receptacle closes it
    redo: false,
  });
}

/** The electrician's card for a cart's worn cable (cracked insulation, or pitted contacts): the cart is tagged out until it's fixed. */
function openCableReport(s: IslandState, c: GseCart, now: number, band: CableBand, again?: number) {
  const def = REPORT_BY_KEY.gpuCable;
  if (!def) return;
  openReport(s, def, now, again, c.id, band);
}

/** Resolve: carts on the charger charge if the hangar has power (a small electricity bill); the rest self-discharge. */
function chargeCarts(s: IslandState, on: boolean, line: (role: ReportLine['role'], tone: ReportLine['tone'], text: string) => void) {
  let cost = 0;
  for (const c of ensureGse(s)) {
    if (!c.charging) {
      c.charge = Math.max(0, c.charge - GSE.idleDrain);
      continue;
    }
    const gain = Math.min(GSE.chargePerWeek, 100 - c.charge);
    if (gain <= 0) continue;
    if (!on) {
      line('mech', 'bad', `No hangar power: ${c.name} sat on a dead charger (${Math.round(c.charge)}%).`);
      continue;
    }
    const bill = Math.round(gain * GSE.powerPerPoint);
    c.charge = Math.round(c.charge + gain);
    cost += bill;
    line('mech', 'info', `${c.name} charged to ${c.charge}% on the hangar charger (${usd(bill)} of power).`);
  }
  return cost;
}

// ---------------------------------------------------------------------------
// Hidden defects, repairs and redos

/** Trade jobs on an asset can leave a hidden defect (not crew-project parts, not desk work). */
const defectable = (o: Order) => o.role !== 'fin' && o.kind !== 'project' && o.kind !== 'report' && o.assetId !== null && !(o.chain && o.chain.step !== 'job');

/** The catalog kind a job's work belongs to: a repair counts as the job it corrects (a redo already has that kind). */
const jobOf = (o: Order): string => (o.repair ? (o.repair.defect.job ?? o.repair.defect.orderKind) : o.kind);

/** "prop bolt re-torque", "alternator replacement redo", "patched prop bolt re-torque"; none for a repair (its title is an instruction) */
function logOf(o: Order): string | undefined {
  const base = CATALOG_BY_KIND[o.kind]?.log;
  if (!base || o.kind === 'repair') return undefined;
  if (o.redo) return `${base} redo`;
  if (/ \(patch\)$/.test(o.title)) return `patched ${base}`;
  return base;
}

/**
 * "the prop bolt re-torque Ana signed off in week 5". A repair's title is an
 * instruction, so it is quoted: "the repair “Re-torque the prop bolts” Ana
 * signed off in week 6". Anything else without a noun form is quoted too.
 */
export function tracedTo(d: Pick<Defect, 'orderKind' | 'title' | 'name' | 'week' | 'log' | 'npc'>) {
  // the electrician's helper put it in to the electrician's plan: the trace names both (the release gate)
  if (d.npc) return `the ${d.log ?? `“${d.title}”`} ${d.name} planned and ${d.npc} (helper) put in under ${d.name}'s licence in week ${d.week}`;
  if (d.orderKind === 'repair') return `the repair “${d.title}” ${d.name} signed off in week ${d.week}`;
  if (d.log) return `the ${d.log} ${d.name} signed off in week ${d.week}`;
  return `“${d.title}”, signed off by ${d.name} in week ${d.week}`;
}

/**
 * On sign-off: roll (from the order seed, deterministic) for a latent defect
 * from the TRUE score. `variant` is what the puzzle says went wrong (a hot
 * start, the wrong fluid): the defect is that failure, not the job's default.
 */
function rollDefect(s: IslandState, o: Order, by: Role, name: string, q: number, variant?: string) {
  const r = rng(hashSeed(o.seed, 'defect', s.week));
  const rule = defectRule(o.puzzle, o.role, o.kind, variant);
  // a sure rule (the other effectivity's manual value) is there whatever the rest of the job was like
  if (!rule.sure && !r.chance(defectChance(q))) return;
  const severity = defectSeverity(q);
  (s.defects ??= []).push({
    id: `d${s.nextId++}`,
    orderKind: o.kind,
    job: jobOf(o),
    log: logOf(o),
    puzzle: o.puzzle,
    ...(variant ? { variant } : {}),
    title: o.title,
    assetId: o.assetId,
    role: o.role,
    by,
    name,
    week: s.week,
    // a severe defect comes due sooner
    dueWeek: s.week + r.int(DEFECT.dueMin, DEFECT.dueMax[severity - 1]),
    severity,
    cost: o.redo?.cost ?? o.cost,
    tier: o.tier,
    gain: o.gain,
    // a repair's own defect gets another repair; the original's redo is already on its way
    redo: rule.redo !== false && o.kind !== 'repair',
  });
}

/** The corrective job for a defect: same trade and asset, a different puzzle, pending the analyst. */
function addRepair(s: IslandState, d: Defect, via: 'inspection' | 'incident', o: { foundBy?: string; foundIn?: string; incident?: string } = {}) {
  const rule = defectRule(d.puzzle, d.role, d.orderKind, d.variant);
  const fix = rule.fix;
  return newOrder(s, {
    role: d.role,
    kind: 'repair',
    assetId: d.assetId,
    title: fix.title,
    puzzle: fix.puzzle,
    tier: d.tier,
    cost: round10(Math.max(d.cost, DEFECT.minBase) * (fix.cost ?? DEFECT.repairCost)),
    parts: fix.parts ?? 0,
    // a small gain; after a failure the repair also puts back part of what the failure took
    gain:
      Math.max(DEFECT.repairMinGain, Math.round(d.gain * DEFECT.repairGain)) +
      (via === 'incident' ? Math.round(DEFECT.healthHit[d.severity - 1] * DEFECT.repairRestores) : 0),
    status: 'pending',
    // the puzzle shows the part the repair is about (the prop, the wheel, the alternator bracket)
    job: fix.job ?? d.job ?? d.orderKind,
    repair: { defect: d, via, problem: rule.found, ...o },
  });
}

/**
 * A passed inspection finds the latent defects its trade left on this asset in
 * an earlier week, in the work it looks at (INSPECTS scope): no incident, a
 * repair instead.
 */
function detectDefects(s: IslandState, o: Order, asset: Asset, name: string, now: number) {
  const found = (s.defects ?? []).filter(
    (d) => !d.report && d.assetId === asset.id && d.role === o.role && d.week < s.week && inspects(o.kind, d.job ?? d.orderKind),
  );
  if (!found.length) return;
  const ids = new Set(found.map((d) => d.id));
  s.defects = s.defects!.filter((d) => !ids.has(d.id));
  const what = INSPECTS[o.kind].name;
  const out = asset.kind === 'plane' ? 'Not airworthy until it’s repaired' : 'Not safe until it’s repaired';
  for (const d of found) {
    const rule = defectRule(d.puzzle, d.role, d.rule ?? d.orderKind, d.variant);
    // the job flow's wrong task: the fault is still there, written up as found (no repair: the fix is the right task)
    if (d.puzzle === 'flow' || (d.puzzle === 'elec' && d.variant === 'isolation')) {
      reraise(s, d, 'finding', now);
      feed(s, o.role, 'good', `${name}'s ${what} on ${asset.name} found ${flowWords(rule.found, d)}, left from week ${d.week}: it's on the alert list again.`, now);
      continue;
    }
    const al = raiseAlert(s, { role: d.role === 'elec' ? 'elec' : 'mech', asset, repair: { defect: d, via: 'inspection', problem: rule.found, foundBy: name, foundIn: what }, src: 'finding', due: s.week }, now);
    feed(s, o.role, 'good', `${name}'s ${what} on ${asset.name} found ${rule.found}, left from week ${d.week}. Repair written up: ${rule.fix.title}. ${out}.`, now);
    void al;
  }
}

/** Repair done: the original job has to be done again (free, already paid). */
function spawnRedo(s: IslandState, o: Order, now: number) {
  const d = o.repair!.defect;
  if (!d.redo || !d.assetId) return;
  const base = d.title.replace(/ \((redo|patch)\)$/, '');
  const asset = s.assets.find((a) => a.id === d.assetId);
  const redo = { week: d.week, by: d.by, name: d.name, cost: d.cost };
  // the same job already open on this asset becomes the redo: never two copies of one job
  let r = s.orders.find((x) => open(x) && x.kind === d.orderKind && x.assetId === d.assetId && !x.redo && !x.repair && !x.report && !x.chain);
  if (r) {
    r.title = `${base} (redo)`;
    r.redo = redo;
    if (r.status === 'pending' || r.status === 'countered') {
      // not paid yet: now it doesn't need to be
      r.cost = 0;
      r.parts = 0;
      r.counter = undefined;
      r.pushedBack = false;
      r.status = 'ready';
      r.approvedWeek = s.week;
      r.autoApproved = true;
    }
  } else {
    r = newOrder(s, {
      role: d.role,
      kind: d.orderKind,
      assetId: d.assetId,
      title: `${base} (redo)`,
      puzzle: d.puzzle as Order['puzzle'],
      tier: d.tier,
      cost: 0,
      parts: 0,
      gain: Math.max(1, Math.round(d.gain * DEFECT.redoGain)),
      status: 'ready',
      // already paid for: it's the trade's to do, never the analyst's to answer for
      approvedWeek: s.week,
      autoApproved: true,
      redo,
    });
  }
  feed(s, d.role, 'info', `Repair signed off${asset ? ` on ${asset.name}` : ''}. Now the original job: ${r.title}.`, now);
}

/** Blind sign-offs settle silently as the week resolves: the true credit replaces the stand-in (health, XP, a perfect run's bonus and its week without decay). */
function settleBlind(s: IslandState) {
  for (const o of s.orders) {
    const r = o.result;
    if (!r?.blind || r.provisional === undefined) continue;
    const pc = r.provisional;
    delete r.provisional;
    const asset = assetOf(s, o);
    if (asset && o.gain > 0) {
      asset.health = clamp(asset.health + o.gain * (r.credit - pc), 0, 100);
      if (r.perfect) asset.touchedWeek = Math.max(asset.touchedWeek, r.week + 1);
    }
    const p = s.players[r.by];
    if (!p) continue;
    if (r.perfect && p.perfects < 15) p.perfects += 1;
    gainXp(s, r.by, orderXp(o.tier, r.credit, r.perfect) - blindXpFloor(o.tier));
  }
}

/** XP at a blind sign-off: what any sign-off earns (the floor of the credit curve). The rest comes when the week resolves, so XP never goes down and a level-up is never taken back. */
const blindXpFloor = (tier: number) => orderXp(tier, workCredit(0), false);

// ---------------------------------------------------------------------------
// Part chain: manual → IPC → logbooks → engineering approval → install
// (helpers and the rules of what's right: src/sim/chain.ts)

/** Would this sign-off find a part it can't finish without? Seeded from the order and the week, never the score. */
export function chainWouldOpen(s: IslandState, o: Order, role: Role): boolean {
  if (s.week < CHAIN.fromWeek || s.tier < CHAIN.minTier) return false;
  if (o.role !== 'mech' || role !== 'mech' || o.chain || o.repair || o.redo || o.report || o.kind === 'project') return false;
  // the job flow's Parts step is the IPC lookup: no random chain on flow jobs (CHAIN.flowChance)
  if (o.flow && !rng(hashSeed(o.seed, 'flow-chain', s.week)).chance(CHAIN.flowChance)) return false;
  const ata = chainAtaOf(o.kind);
  if (!ata) return false;
  const asset = s.assets.find((a) => a.id === o.assetId);
  if (asset?.kind !== 'plane') return false;
  // the island's only guest plane keeps its spares on the shelf: grounding it would stop every guest
  // (tiers 1-3 the twin; from tier 4 the floatplane shares the guests, and parts are ordered as needed)
  if (soleGuestPlane(s, asset)) return false;
  // a new player's grace weeks are for learning the jobs
  const p = s.players[role];
  if (p && s.week <= p.graceUntil) return false;
  // one at a time, and a breather after one closes
  if (openChain(s)) return false;
  if (s.chain?.closedWeek !== undefined && s.week < s.chain.closedWeek + CHAIN.rest) return false;
  // an altered plane's trouble is mostly on the altered assembly (its ICA parts wear, and nobody stocks them)
  const plant = plantFor(s.seed, asset.id, asset.model).plant;
  const chance = !plant ? CHAIN.chance : plant === ata ? CHAIN.plantedChance : CHAIN.chance * CHAIN.offPlant;
  return rng(hashSeed(o.seed, 'chain', s.week)).chance(chance);
}

/** a hire giving notice in that role: the review says when they start instead of asking for one */
function hireComing(s: IslandState, role: NpcRole, W: number): string | null {
  const n = (s.staff ?? []).filter((x) => x.role === role && x.start > W).sort((a, b) => a.start - b.start)[0];
  return n ? `${n.name} starts week ${n.start}.` : null;
}

/** the only plane that brings guests (grounding it would empty every house) */
const soleGuestPlane = (s: IslandState, asset: Asset) =>
  !MODELS[asset.model].cargo && !s.assets.some((a) => a.kind === 'plane' && a.id !== asset.id && !MODELS[a.model].cargo);
const chainOf = (s: IslandState, o: Order): PartChain | null => (o.chain && s.chain?.id === o.chain.id && s.chain.step !== 'done' ? s.chain : null);
const nameOfRole = (s: IslandState, r: Role) => s.players[r]?.name ?? ROLE_LABEL[r];
/** the part is looked up, but the electrician hasn't said yet whether the unit is really bad */
const waitsOnBench = (c: PartChain) => !!c.bench && !c.bench.call;

/** the order for a chain step: paperwork for the mechanic (ready), or a card for the analyst (pending) */
function chainOrder(s: IslandState, c: PartChain, step: 'lookup' | 'research' | 'buy' | 'fee', title: string, now: number, cost = 0) {
  const job = s.orders.find((x) => x.id === c.orderId);
  const paper = step === 'lookup' || step === 'research';
  const o = newOrder(s, {
    role: 'mech',
    kind: step === 'lookup' ? 'ipc' : step === 'research' ? 'logbook' : step === 'buy' ? 'part' : 'eng',
    assetId: c.assetId,
    title,
    puzzle: step === 'research' ? 'logbook' : 'ipc',
    tier: job?.tier ?? clamp(1 + Math.floor(s.tier / 2), 1, 5),
    cost,
    parts: 0,
    gain: 0,
    status: paper ? 'ready' : 'pending',
    // the scenario the puzzle picks its assembly by: the job that found it
    job: job?.kind,
    chain: { id: c.id, step },
    ...(paper ? { approvedWeek: s.week, autoApproved: true } : {}),
  });
  c.step = step;
  c.stepId = o.id;
  c.stepAt = now;
  return o;
}

function lookupStep(s: IslandState, c: PartChain, now: number) {
  const asset = s.assets.find((a) => a.id === c.assetId)!;
  const ac = islandAircraft(s.seed, asset);
  return chainOrder(s, c, 'lookup', `Look up the ${c.item} in the IPC: ${ac.registration} S/N ${ac.serial}`, now);
}

function researchStep(s: IslandState, c: PartChain, now: number) {
  const asset = s.assets.find((a) => a.id === c.assetId)!;
  const ac = islandAircraft(s.seed, asset);
  return chainOrder(s, c, 'research', `Research the ${c.item} in ${ac.registration}'s logbooks`, now);
}

function buyStep(s: IslandState, c: PartChain, pn: string, src: NonNullable<PartChain['src']>, now: number) {
  const asset = s.assets.find((a) => a.id === c.assetId)!;
  const ac = islandAircraft(s.seed, asset);
  c.pn = pn;
  c.src = src;
  const price = partPrice(s.tier, ac, c.ata as Ata, c.tag, pn);
  return chainOrder(s, c, 'buy', `Buy ${pn} ${nomenOf(ac, c.ata as Ata, pn)} for ${ac.registration}`, now, price);
}

function feeStep(s: IslandState, c: PartChain, now: number) {
  const asset = s.assets.find((a) => a.id === c.assetId)!;
  const ac = islandAircraft(s.seed, asset);
  return chainOrder(s, c, 'fee', `Engineering review: ${c.item} for ${ac.registration}`, now, engineeringFee(s.tier));
}

/** The electrician's check at the airplane: the unit, or its wiring? (a meter job on that plane's circuit) */
function benchOrder(s: IslandState, c: PartChain, again = false) {
  const asset = s.assets.find((a) => a.id === c.assetId)!;
  const radio = c.tag === 'radio';
  return newOrder(s, {
    role: 'elec',
    kind: 'bench',
    assetId: c.assetId,
    title: radio
      ? `Meter the com radio's power and ground on ${asset.name}${again ? ' again' : ''}`
      : `Meter the ${c.item} field circuit on ${asset.name}${again ? ' again' : ''}`,
    puzzle: 'meter',
    tier: clamp(1 + Math.floor(s.tier / 2), 1, 5),
    cost: 0,
    parts: 0,
    gain: 0,
    status: 'ready',
    job: benchJob(c.tag, asset.model),
    chain: { id: c.id, step: 'bench' },
    approvedWeek: s.week,
    autoApproved: true,
  });
}

/** A job found a part: it stops, the plane is grounded, and the IPC lookup is the mechanic's next job. */
function openPartChain(s: IslandState, o: Order, name: string, now: number) {
  const asset = s.assets.find((a) => a.id === o.assetId)!;
  const ac = islandAircraft(s.seed, asset);
  const ata = chainAtaOf(o.kind)!;
  const f = chainFind(ac, ata, rng(hashSeed(o.seed, 'chain-find', s.week)));
  const c: PartChain = {
    id: `c${s.nextId++}`,
    orderId: o.id,
    assetId: asset.id,
    title: o.title,
    ata,
    tag: f.tag,
    item: f.item,
    how: f.how,
    found: f.found,
    by: name,
    week: s.week,
    step: 'lookup',
    returns: 0,
    rejects: 0,
    spent: 0,
    aogWeeks: 0,
  };
  s.chain = c;
  o.status = 'waiting_part';
  o.chain = { id: c.id, step: 'job' };
  // an electrical unit is checked at the airplane before one is bought: is it the unit, or its wiring?
  let elec = '';
  if (BENCH_TAGS.has(f.tag)) {
    const fault: 'unit' | 'wiring' = rng(hashSeed(o.seed, 'bench', s.week)).chance(CHAIN.wiringShare) ? 'wiring' : 'unit';
    c.bench = { id: benchOrder(s, c).id, fault };
    elec = ` ${nameOfRole(s, 'elec')} meters its circuit at the airplane before one is bought.`;
  }
  lookupStep(s, c, now);
  feed(s, 'mech', 'bad', `${name} stopped ${o.title} on ${asset.name}: ${f.found} ${asset.name} is grounded until it's fixed. Next: look it up in the IPC.${elec}`, now);
}

/** The lookup, the research or the electrician's check is handed in: what it says moves the chain on (right or wrong shows later). */
function chainStep(
  s: IslandState,
  o: Order,
  a: Extract<Action, { t: 'complete' }>,
  name: string,
  covered: boolean,
  blind: boolean,
  turn: TurnState,
  now: number,
): ApplyResult {
  const c = chainOf(s, o);
  const step = o.chain!.step as 'lookup' | 'research' | 'bench';
  const data = (a.data?.chain ?? {}) as { outcome?: string; pn?: string; route?: string | null; verdict?: string; reason?: string; cite?: string; call?: string; fixed?: boolean; where?: string };
  turn.done += 1;
  // paperwork needs no hangar tools (the grid-down cap doesn't count it)
  if (step !== 'bench') turn.paper = (turn.paper ?? 0) + 1;
  // teaching tiers show the verdict: a lookup or research that failed its own check isn't sent on
  if (!blind && !covered && a.score < SIGNOFF && c) {
    o.seed = hashSeed(o.seed, `rework${s.week}`);
    feed(s, o.role, 'bad', `${name}: ${o.title} didn't pass its check (${Math.round(a.score * 100)}%). Still open.`, now);
    return { s };
  }
  const cr = credit(a.score, 0);
  o.status = 'done';
  // blind: the XP floor now, the rest when the week resolves (settleBlind); the order has no gain, so no health moves
  o.result = { score: a.score, perfect: a.perfect, credit: cr, by: a.role, week: s.week, covered, ...(blind ? { blind: true, provisional: DEFECT.provisional } : { summary: a.summary }) };
  gainXp(s, a.role, blind ? blindXpFloor(o.tier) : Math.round(orderXp(o.tier, cr, a.perfect) * (covered ? 0.5 : 1)));
  if (!c) return { s };
  if (step === 'bench') {
    benchDone(s, c, data, name, now);
    return { s };
  }
  delete c.back;
  const asset = s.assets.find((x) => x.id === c.assetId)!;
  const ac = islandAircraft(s.seed, asset);
  const fin = nameOfRole(s, 'fin');
  const elec = nameOfRole(s, 'elec');
  // the part is known; if the electrician hasn't checked the unit yet, it's bought once they have
  const ready = (then: () => string) => {
    if (!waitsOnBench(c)) return then();
    c.step = 'check';
    delete c.stepId;
    return `It's bought once ${elec} has metered the circuit and says the ${c.item} ${isAre(c.item)} really bad.`;
  };
  if (step === 'lookup') {
    if (data.outcome === 'pn' && data.pn) {
      c.pn = String(data.pn);
      c.src = 'ipc';
      const next = ready(() => `Waiting on ${fin} to approve the part (${usd(buyStep(s, c, c.pn!, 'ipc', now).cost)}).`);
      feed(s, 'mech', 'info', `${name} looked up the ${c.item} for ${asset.name}: ordered P/N ${c.pn}. ${next}`, now);
    } else if (data.outcome === 'notipc') {
      researchStep(s, c, now);
      feed(s, 'mech', 'info', `${name}: the ${c.item} on ${asset.name} isn't in the IPC. Next: research ${ac.registration}'s logbooks for how it got there.`, now);
    } else {
      // nothing ordered: the lookup is still to do
      lookupStep(s, c, now);
      feed(s, 'mech', 'bad', `${name} ran out of time on the IPC lookup: nothing ordered. ${asset.name} stays down.`, now);
    }
    return { s };
  }
  // research: a request to engineering, or a logbook entry that puts the part on without one
  const route = data.route ?? null;
  if (route === 'eng' || route === 'new') {
    const ok = data.verdict === 'approved' || data.verdict === 'costly';
    c.request = { ok, reason: String(data.reason ?? (ok ? '' : 'Request incomplete.')), ...(data.cite ? { cite: String(data.cite) } : {}), ...(data.verdict === 'costly' ? { costly: true } : {}) };
    if (data.pn) c.pn = String(data.pn);
    const next = ready(() => `Waiting on ${fin} to approve the review fee (${usd(feeStep(s, c, now).cost)}).`);
    feed(s, 'mech', 'info', `${name} wrote engineering a request for the ${c.item} on ${ac.registration}. ${next}`, now);
  } else if ((route === 'ipc' || route === 'pma') && data.pn) {
    c.pn = String(data.pn);
    c.src = 'entry';
    const next = ready(() => `Waiting on ${fin} (${usd(buyStep(s, c, c.pn!, 'entry', now).cost)}).`);
    feed(s, 'mech', 'info', `${name} researched the ${c.item} on ${ac.registration}: ordering P/N ${c.pn} to go on with a logbook entry. ${next}`, now);
  } else {
    researchStep(s, c, now);
    feed(s, 'mech', 'bad', `${name}'s research on ${ac.registration} was never handed in: still to do.`, now);
  }
  return { s };
}

/**
 * The electrician's check is in. "The unit": the part is bought (if the lookup
 * already has it, now). "The wiring": the fault is fixed at the airplane, no
 * part needed, and the mechanic finishes the job. What the check really found
 * shows later: a good unit bought (the new one makes no difference at the
 * install), or a dead one left in service (an incident).
 */
function benchDone(s: IslandState, c: PartChain, data: { call?: string; fixed?: boolean; where?: string }, name: string, now: number) {
  const b = c.bench;
  if (!b) return;
  const asset = s.assets.find((x) => x.id === c.assetId)!;
  const mech = nameOfRole(s, 'mech');
  const where = data.where ? ` at the ${data.where.charAt(0).toLowerCase()}${data.where.slice(1)}` : '';
  // the second check (the new unit made no difference): with the unit ruled out, it's the wiring
  const call: 'unit' | 'wiring' = b.again || data.call === 'wiring' ? 'wiring' : 'unit';
  b.call = call;
  b.by = name;
  b.week = s.week;
  if (call === 'unit') {
    feed(s, 'all', 'info', `${name} metered the ${c.item} circuit on ${asset.name}: the wiring checks good, it's the ${c.item}.${c.step === 'check' ? ' The part can be bought.' : ''}`, now);
    if (c.step === 'check') {
      if (c.request) feeStep(s, c, now);
      else if (c.pn && c.src) buyStep(s, c, c.pn, c.src, now);
      else lookupStep(s, c, now);
    }
    return;
  }
  // the wiring: fixed where the check found it. No part: whatever step the chain was on is cancelled
  const right = b.fault === 'wiring' && (b.again || !!data.fixed);
  const step = c.stepId ? s.orders.find((o) => o.id === c.stepId) : undefined;
  if (step && open(step) && step.status !== 'waiting_part') step.status = 'cancelled';
  c.wired = true;
  c.step = 'install';
  delete c.stepId;
  delete c.request;
  const job = s.orders.find((o) => o.id === c.orderId);
  if (job) {
    job.status = 'ready';
    job.title = `Finish ${c.title}: the fault was in the wiring`;
  }
  // a wrong call: the plane goes back to service with a dead unit (or with the break in its wiring still there,
  // when the check fixed the wrong spot), and the flight it fails on says so
  if (!right) {
    const r = rng(hashSeed(c.id, 'bench-miss', s.week));
    const dead = b.fault === 'unit';
    (s.defects ??= []).push({
      id: `d${s.nextId++}`,
      orderKind: 'bench',
      job: c.tag === 'radio' ? 'avionics' : 'alternator',
      log: `${c.item} circuit check`,
      puzzle: 'meter',
      variant: dead ? (c.tag === 'radio' ? 'radio' : 'unit') : 'wiring',
      title: `Meter the ${c.item} circuit`,
      assetId: asset.id,
      // the airplane's trade owns the repair (a new unit, or the wire spliced); the electrician signed the check off
      role: 'mech',
      by: 'elec',
      name,
      week: s.week,
      dueWeek: s.week + r.int(1, 2),
      severity: 1,
      cost: partPrice(s.tier, islandAircraft(s.seed, asset), c.ata as Ata, c.tag, rightPn(islandAircraft(s.seed, asset), c.ata as Ata, c.tag)),
      tier: clamp(1 + Math.floor(s.tier / 2), 1, 5),
      gain: 0,
      redo: false,
    });
  }
  feed(s, 'all', 'good', `${name} metered the ${c.item} circuit on ${asset.name} and fixed the fault${where}: no part needed. ${mech}, finish ${c.title}.`, now);
}

/** The analyst approved a chain card: the part goes on the next delivery, or engineering gets the request. */
function chainApproved(s: IslandState, o: Order, now: number, ship?: 'boat' | 'flight') {
  const c = chainOf(s, o);
  if (!c || c.stepId !== o.id) return;
  c.spent += o.cost;
  const asset = s.assets.find((x) => x.id === c.assetId);
  if (o.chain!.step === 'buy') {
    o.status = 'waiting_part';
    c.step = 'transit';
    c.price = o.cost;
    // the plane that would carry it is the one that's down: the AOG boat (on the PO), or next week's guest flight
    if (needsFreight(s, c)) {
      c.freight = ship ?? 'boat';
      if (c.freight === 'boat') {
        s.cash -= ECON.boatKit;
        c.spent += ECON.boatKit;
      } else c.ship = s.week + 1;
    }
    const how =
      c.freight === 'boat'
        ? `the AOG boat brings it when the week resolves (${usd(ECON.boatKit)})`
        : c.freight === 'flight'
          ? "it rides next week's guest flight (no boat, one more week down)"
          : 'it rides the next cargo flight';
    feed(s, 'all', 'info', `The ${c.item} for ${asset?.name ?? 'the plane'} ${isAre(c.item)} on order: ${how}.`, now);
  } else if (o.chain!.step === 'fee') {
    o.status = 'waiting_part';
    c.step = 'review';
    c.due = s.week;
    feed(s, 'all', 'info', `Engineering has the request for the ${c.item} on ${asset?.name ?? 'the plane'}: the answer comes when the week resolves.`, now);
  }
}

/** What a chain card costs on approval: the part (or the fee), plus the AOG boat when it takes one. */
export function chainCardCost(s: IslandState, o: Order, ship?: 'boat' | 'flight'): number {
  const c = chainOf(s, o);
  if (!c || c.stepId !== o.id || o.chain?.step !== 'buy' || !needsFreight(s, c)) return o.cost;
  return o.cost + ((ship ?? 'boat') === 'boat' ? ECON.boatKit : 0);
}

/**
 * At the install: the electrician called the unit, but the fault is in the
 * wiring. The new unit goes on, and the ground run shows no output still: the
 * removed unit tests good on the bench, the one bought goes back (a credit,
 * less restocking), and the electrician meters the circuit again. The job waits.
 */
function missedWiring(s: IslandState, c: PartChain, o: Order, name: string, turn: TurnState, now: number) {
  const asset = s.assets.find((x) => x.id === c.assetId)!;
  const price = c.price ?? partPrice(s.tier, islandAircraft(s.seed, asset), c.ata as Ata, c.tag, c.pn ?? '');
  const fee = restockFee(price);
  s.cash += price - fee;
  c.spent -= price - fee;
  c.returns += 1;
  turn.done += 1;
  gainXp(s, 'mech', blindXpFloor(o.tier));
  o.status = 'waiting_part';
  o.title = c.title;
  // (no `call` key at all: an undefined one keeps its place in memory but not through JSON)
  const { call: _called, ...bench } = c.bench!;
  c.bench = { ...bench, again: true, id: benchOrder(s, c, true).id };
  c.step = 'check';
  delete c.stepId;
  const elec = nameOfRole(s, 'elec');
  c.back = `The new ${c.item} made no difference: the fault is in the wiring.`;
  feed(
    s,
    'all',
    'bad',
    `${name} installed ${c.pn} on ${asset.name}: ground run, still no output. The removed ${c.item} tests good on the bench, so it's the wiring. ${c.pn} goes back: ${usd(price - fee)} credited (${usd(fee)} restocking). ${elec}, meter the circuit again.`,
    now,
  );
}

/** The part is on (or the wiring fixed) and the job signed off: the plane is back in service. */
function closeChain(s: IslandState, o: Order, name: string, now: number) {
  const c = chainOf(s, o);
  if (!c) return;
  o.title = c.title;
  const asset = s.assets.find((x) => x.id === c.assetId)!;
  const ac = islandAircraft(s.seed, asset);
  const p = plantedOn(ac, c.ata);
  // an STC holder's part put on with a logbook entry: the right part, no engineering authorization.
  // Nothing breaks; the records are wrong, and the company's records audit or the next full inspection finds it.
  if (!c.wired && c.src === 'entry' && p && c.pn === p.neededPn) {
    const r = rng(hashSeed(o.seed, 'unapproved', s.week));
    (s.defects ??= []).push({
      id: `d${s.nextId++}`,
      orderKind: 'chain',
      job: 'records',
      log: `${c.item} installation on a logbook entry`,
      // the part chain's paperwork put it on (rule 'ipc:unapproved'; its repair is the logbook research)
      puzzle: 'ipc',
      variant: 'unapproved',
      title: `Install ${c.pn}`,
      assetId: asset.id,
      role: 'mech',
      by: o.result?.by ?? 'mech',
      name,
      week: s.week,
      dueWeek: s.week + r.int(DEFECT.dueMin, DEFECT.dueMax[0]),
      severity: 1,
      cost: partPrice(s.tier, ac, c.ata as Ata, c.tag, c.pn),
      tier: o.tier,
      gain: 0,
      redo: false,
    });
  }
  const weeks = c.aogWeeks;
  const sat = weeks > 0 ? `${asset.name} sat ${weeks} week${weeks > 1 ? 's' : ''} for ${c.item}` : `${asset.name} was back the same week after ${c.item}`;
  const how = c.wired
    ? `no part needed, ${c.bench?.by ?? 'the electrician'}'s check found the fault in the wiring${c.returns ? ` (after a new ${c.item} made no difference and went back)` : ''}`
    : c.src === 'eng'
      ? `${c.cite ?? 'the alteration'} found in the logbooks, engineering approved week ${c.approvedWeek}${c.rejects ? ` (after ${c.rejects} request${c.rejects > 1 ? 's' : ''} came back)` : ''}`
      : c.src === 'entry'
        ? `P/N ${c.pn} put on with a logbook entry`
        : `P/N ${c.pn} from the IPC${c.returns ? `, after ${c.returns} wrong part${c.returns > 1 ? 's' : ''} went back` : ''}`;
  const down = c.downtime ? `, and about ${usd(c.downtime)} of downtime` : '';
  c.story = `${sat}: ${how}. ${usd(c.spent)} in parts, fees and freight${down}.`;
  c.step = 'done';
  c.closedWeek = s.week;
  delete c.stepId;
  // engineering approved the ICA part for this airplane: the EA is on file, and the IPC search shows it as a normal row from now on
  if (!c.wired && c.src === 'eng' && c.pn && !(s.eas ?? []).some((e) => e.assetId === c.assetId && e.pn === c.pn)) {
    (s.eas ??= []).push({ assetId: c.assetId, ata: c.ata, tag: c.tag, pn: c.pn, ea: `EA 26-${String(100 + (hashSeed(s.seed, c.id, c.pn, 'ea') % 800)).padStart(3, '0')}`, week: s.week });
  }
  // a flow job's research is done: the job goes back to its lines (the chain's part is on)
  if (o.flow) {
    delete o.flow.research;
    delete o.flow.researchSlot;
  }
  feed(s, 'all', 'good', `${name} ${c.wired ? `finished ${c.title}` : `put the ${c.item} on ${asset.name} and signed off ${c.title}`}: back in service. ${c.story}`, now);
}

/**
 * The chain's own orders, as the engine left them: an older build (or two
 * devices at once) can cancel a step's order or sign its job off early. Put back
 * what's missing, so a grounded plane never waits on an order nobody can see.
 * Returns what it fixed, for tests.
 */
function healChain(s: IslandState, c: PartChain, now: number): string[] {
  const fixed: string[] = [];
  const job = s.orders.find((o) => o.id === c.orderId);
  if (!job || job.status === 'cancelled') {
    // the job itself is gone: nothing to put the part on, so the chain ends here
    c.step = 'done';
    c.closedWeek = s.week;
    delete c.stepId;
    c.story = `${c.title} was closed without the ${c.item}.`;
    return ['job'];
  }
  if (job.status === 'done') return fixed;
  // the job waits for the part until the chain is at the install (a flow card nobody has approved stays a card)
  const card = !!job.flow && (job.status === 'pending' || job.status === 'countered');
  if (c.step !== 'install' && job.status !== 'waiting_part' && !card) {
    job.status = 'waiting_part';
    fixed.push('job');
  }
  if (c.step === 'install' && job.status !== 'ready' && !card && (!job.flow || jobReady(s, job))) {
    job.status = 'ready';
    fixed.push('job');
  }
  const step = c.stepId ? s.orders.find((o) => o.id === c.stepId) : undefined;
  const alive = (o: Order | undefined, want: Order['status'][]) => !!o && want.includes(o.status);
  switch (c.step) {
    case 'lookup':
      if (!alive(step, ['ready'])) {
        lookupStep(s, c, now);
        fixed.push('lookup');
      }
      break;
    case 'research':
      if (!alive(step, ['ready'])) {
        researchStep(s, c, now);
        fixed.push('research');
      }
      break;
    case 'buy':
    case 'fee': {
      if (alive(step, ['pending', 'countered'])) break;
      if (step && step.approvedWeek !== undefined && step.status !== 'cancelled') {
        // paid for (an older build approved it without moving the chain on): move it on, as an approval here would
        const was = c.step;
        chainApproved(s, step, now);
        fixed.push(`${was}:paid`);
        break;
      }
      if (c.step === 'buy' && c.pn && c.src) buyStep(s, c, c.pn, c.src, now);
      else if (c.step === 'fee') feeStep(s, c, now);
      else lookupStep(s, c, now);
      fixed.push(c.step);
      break;
    }
    case 'check':
      // waiting on the electrician: the check's order has to be there
      if (c.bench && !c.bench.call && !s.orders.some((o) => o.id === c.bench!.id && o.status === 'ready')) {
        c.bench.id = benchOrder(s, c, !!c.bench.again).id;
        fixed.push('bench');
      }
      break;
  }
  // an electrical unit's check still to do, beside the lookup or the research
  if (c.bench && !c.bench.call && c.step !== 'check' && !s.orders.some((o) => o.id === c.bench!.id && o.status === 'ready')) {
    c.bench.id = benchOrder(s, c, !!c.bench.again).id;
    fixed.push('bench');
  }
  return fixed;
}

/** Test hook: heal the open chain as openWeek does. */
export function healOpenChain(s: IslandState, now: number): string[] {
  const c = openChain(s);
  return c ? healChain(s, c, now) : [];
}

/**
 * Week resolution, after the carry-over: the part that arrived goes through
 * receiving (its paperwork, then the P/N: a wrong one goes back for a credit),
 * and engineering answers a request it has had for the week. `arrived`: the
 * part came in this week.
 */
function resolveChain(s: IslandState, W: number, arrived: boolean, now: number, line: (role: ReportLine['role'], tone: ReportLine['tone'], text: string) => void) {
  const c = openChain(s);
  if (!c) return;
  const asset = s.assets.find((x) => x.id === c.assetId);
  if (!asset) {
    s.chain = null;
    return;
  }
  const ac = islandAircraft(s.seed, asset);
  const mech = nameOfRole(s, 'mech');
  const step = c.stepId ? s.orders.find((o) => o.id === c.stepId) : undefined;
  const released = c.step === 'transit' && c.hold !== undefined && c.hold <= W;
  if (c.step === 'transit' && c.pn && (arrived || released)) {
    // receiving: the paperwork first. Now and then a part comes without its 8130-3 (or with a S/N that doesn't
    // match it): no tag, no install. It sits in quarantine until the vendor sends the documents
    if (!released && rng(hashSeed(c.id, 'paperwork', c.pn, c.returns)).chance(CHAIN.noPaperwork)) {
      c.hold = W + 1;
      const sn = BENCH_TAGS.has(c.tag) && rng(hashSeed(c.id, 'sn', c.pn)).chance(0.5);
      line(
        'mech',
        'bad',
        `Receiving on ${asset.name}: P/N ${c.pn} came ${sn ? 'with an 8130-3 whose S/N doesn’t match the unit’s data plate' : 'without its 8130-3'}. No tag, no install: it's in quarantine until the vendor sends the paperwork (next week).`,
      );
      return;
    }
    delete c.hold;
    const chk = judgePart(ac, c.ata as Ata, c.tag, c.pn);
    if (step) step.status = 'done';
    const nomen = nomenOf(ac, c.ata as Ata, c.pn).toLowerCase();
    if (chk.ok) {
      const job = s.orders.find((o) => o.id === c.orderId);
      c.step = 'install';
      if (job) {
        if (job.status !== 'pending') job.status = job.flow && !jobReady(s, job) ? 'waiting_part' : 'ready';
        job.title = `Install ${c.pn}, then finish ${c.title}`;
      }
      c.step = 'install';
      delete c.stepId;
      line('mech', 'good', `Receiving on ${asset.name}: P/N ${c.pn} (${nomen}), ${released ? "the vendor's 8130-3 came" : '8130-3 in the box'}, matches the PO. ${mech}, install it and finish ${c.title}.`);
    } else {
      // it goes back: the price credited, less the restocking fee (the freight is spent)
      const price = c.price ?? step?.cost ?? partPrice(s.tier, ac, c.ata as Ata, c.tag, c.pn);
      const fee = restockFee(price);
      s.cash += price - fee;
      c.spent -= price - fee;
      c.returns += 1;
      // a part the IPC doesn't list for this airplane: the records say what goes on, not the book
      const research = chk.why === 'displaced' || c.src !== 'ipc';
      line('mech', 'bad', `Receiving on ${asset.name}: ${chk.text}. Returned: ${usd(price - fee)} credited (${usd(fee)} restocking). ${mech}, ${research ? 'research the records for the part that goes on it' : 'look it up again'}.`);
      c.back = `Sent back at receiving: ${chk.text}.`;
      delete c.price;
      delete c.freight;
      delete c.ship;
      if (research) researchStep(s, c, now);
      else lookupStep(s, c, now);
    }
  } else if (c.step === 'review' && (c.due ?? W) <= W) {
    if (step) step.status = 'done';
    const req = c.request;
    if (req?.ok && plantedOn(ac, c.ata)) {
      const p = plantedOn(ac, c.ata)!;
      c.approvedWeek = W;
      c.cite = req.cite ?? p.ref;
      const b = buyStep(s, c, p.neededPn, 'eng', now);
      line('mech', 'good', `Engineering approved ${p.neededPn} for ${ac.registration} on ${c.cite}${req.costly ? ' (the approved data was on file after all)' : ''}: EA issued. ${nameOfRole(s, 'fin')}: approve the part (${usd(b.cost)}).`);
    } else {
      c.rejects += 1;
      const reason = req?.reason || 'the request does not hold up.';
      c.back = `Engineering returned the request: ${reason}`;
      // the part was in the IPC all along: back to the book; otherwise back to the logbooks
      if (!plantedOn(ac, c.ata)) {
        line('mech', 'bad', `Engineering returned the request for ${ac.registration}: ${reason} ${mech}, back to the IPC.`);
        lookupStep(s, c, now);
      } else {
        line('mech', 'bad', `Engineering returned the request for ${ac.registration}: ${reason} ${mech}, research it again.`);
        researchStep(s, c, now);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Cross-trade reports

/** Open a report: the fixer's card (ready, no approval; the small cost is paid now). `cart`: the ground power cart it tags out, `band` what's wrong with its cable. */
function openReport(s: IslandState, def: ReportDef, now: number, again?: number, cart?: string, band?: CableBand) {
  // a cart's cable: its words follow what's wrong with it (a fix that came back on its own: the plug end is burnt again)
  const cband: CableBand | undefined = cart ? (band ?? (again ? 'pitted' : 'cracked')) : undefined;
  const words = cband ? CABLE_REPORT[cband] : undefined;
  const amount = def.effect === 'leak' ? round10((def.amount ?? 0) * (1 + REPORT.leakPerTier * (s.tier - 1))) : 0;
  const tier = def.fixer === 'fin' ? finTier(s) : clamp(1 + Math.floor(s.tier / 2), 1, 5);
  // a leak that came back was never really stopped: the weeks it only looked fixed are owed too
  const owed = again && def.effect === 'leak' ? amount * Math.max(0, s.week - again) : 0;
  const o = newOrder(s, {
    role: def.fixer,
    kind: 'report',
    assetId: null,
    title: again ? `${words?.title ?? def.title} (again)` : (words?.title ?? def.title),
    puzzle: def.puzzle,
    tier,
    cost: def.cost,
    parts: 0,
    gain: 0,
    status: 'ready',
    // the analyst's puzzle scales its numbers to what's at stake
    ...(def.fixer === 'fin' ? { leak: amount } : {}),
    ...(def.job ? { job: def.job } : {}),
    report: {
      key: def.key,
      by: def.by,
      effect: def.effect,
      amount,
      ...(again ? { again } : {}),
      ...(owed ? { owed } : {}),
      ...(cart ? { cart, band: cband } : {}),
    },
  });
  const c = cart ? s.gse?.find((x) => x.id === cart) : undefined;
  // a cable fix that didn't hold, come back on its own: the plug end is burnt again (found at an inspection: as it is)
  if (c && again && !band) c.wear = Math.max(c.wear, GSE.autoReport - 5);
  if (o.cost > 0) {
    s.cash -= o.cost;
    o.approvedWeek = s.week;
    o.autoApproved = true;
  }
  const who = s.players[def.by]?.name ?? ROLE_LABEL[def.by];
  const fixer = s.players[def.fixer]?.name ?? ROLE_LABEL[def.fixer];
  const fix = def.fixer === 'fin' ? "correction from week %w didn't stick" : "fix from week %w didn't hold";
  feed(
    s,
    def.fixer,
    'bad',
    again
      ? `${who}: ${words?.back ?? def.back}${c ? ` (${c.name})` : ''}. The ${fix.replace('%w', String(again))}.${owed ? ` It cost ${usd(owed)} while it looked fixed.` : ''} ${fixer}, it's back on your list.`
      : `${who} reports: ${words?.said ?? def.said}${c ? ` (${c.name}, tagged out)` : ''}. ${fixer}, it's yours.`,
    now,
  );
  return o;
}

/** A report fix: the reporter is back to normal. A botched (or sloppy) fix comes back 1-2 weeks later. */
function closeReport(s: IslandState, o: Order, by: Role, name: string, q: number, now: number) {
  const rep = o.report!;
  // a new plug on the cart: whatever an earlier fix on it left to come back is gone with the old end
  if (rep.cart) s.defects = (s.defects ?? []).filter((d) => !(d.report?.key === rep.key && d.report.cart === rep.cart));
  const r = rng(hashSeed(o.seed, 'again', s.week));
  const chance = q < SIGNOFF ? 1 : defectChance(q);
  if (r.chance(chance)) {
    (s.defects ??= []).push({
      id: `d${s.nextId++}`,
      orderKind: 'report',
      puzzle: o.puzzle,
      title: o.title,
      assetId: null,
      role: o.role,
      by,
      name,
      week: s.week,
      dueWeek: s.week + r.int(REPORT.againMin, REPORT.againMax),
      severity: 1,
      cost: o.cost,
      tier: o.tier,
      gain: 0,
      redo: false,
      report: { key: rep.key, by: rep.by, effect: rep.effect, amount: rep.amount, ...(rep.cart ? { cart: rep.cart } : {}) },
    });
  }
  // a new plug on a cut-back cable: the wear goes with the old end. A sloppy one looks like any new plug (the
  // botch shows when it comes back, and the comeback burns the plug end again), it just wears in sooner
  const cart = rep.cart ? s.gse?.find((x) => x.id === rep.cart) : undefined;
  if (cart) {
    cart.wear = q >= DEFECT.clean ? 0 : Math.round(clamp((DEFECT.clean - q) * 120, 0, GSE.cracked - 1));
    cart.inspected = { week: s.week, band: 'good', by: name, fixed: true };
  }
  const who = s.players[rep.by]?.name ?? ROLE_LABEL[rep.by];
  feed(
    s,
    o.role,
    'info',
    `${name} closed out ${who}'s report: ${o.title}.${rep.effect === 'cap' ? ` ${who} is back to full speed.` : cart ? ` ${cart.name} is back in service.` : ''}`,
    now,
  );
}

/** Week open: fixes that didn't hold come back, then maybe a new report (from week 3). */
function generateReports(s: IslandState, now: number) {
  const W = s.week;
  const due = (s.defects ?? []).filter((d) => d.report && d.dueWeek <= W);
  if (due.length) {
    s.defects = s.defects!.filter((d) => !due.includes(d));
    for (const d of due) {
      const def = REPORT_BY_KEY[d.report!.key];
      if (!def) continue;
      // a cart re-terminated since (or tagged out again already): that fix's comeback went with its plug
      const cart = d.report!.cart ? s.gse?.find((x) => x.id === d.report!.cart) : undefined;
      if (cart && ((cart.inspected?.fixed && cart.inspected.week > d.week) || cableReport(s, cart.id))) continue;
      openReport(s, def, now, d.week, d.report!.cart);
    }
  }
  // a cable this far gone can't be missed: the mechanic tags the cart out and writes it up
  for (const c of s.gse ?? []) {
    if (c.wear < GSE.autoReport || cableReport(s, c.id)) continue;
    if ((s.defects ?? []).some((d) => d.report?.cart === c.id)) continue;
    openCableReport(s, c, now, cableBand(c.wear));
  }
  if (W < REPORT.fromWeek) return;
  const r = rng(hashSeed(s.seed, 'report', W));
  if (!r.chance(REPORT.chance)) return;
  const open = openReports(s);
  // fixes that are about to come back count as open: they're the same problem
  const coming = (s.defects ?? []).filter((d) => d.report);
  if (open.length + coming.length >= REPORT.maxOpen) return;
  // never two for the same fixer
  const busy = new Set<Role>([...open.map((o) => o.role), ...coming.map((d) => d.role)]);
  const cands = REPORTS.filter((d) => !d.auto && !busy.has(d.fixer) && !!s.players[d.by] && !!s.players[d.fixer] && s.tier >= (d.minTier ?? 1));
  if (!cands.length) return;
  openReport(s, r.pick(cands), now);
}

function story(s: IslandState, prev: IslandState, key: string, role: Role, now: number): ApplyResult {
  const card = s.story;
  if (!card || card.chosen) return { s: prev, error: 'No story card waiting.' };
  if (!card.options.some((o) => o.key === key)) return { s: prev, error: 'Not an option.' };
  // crew vote: two of three decide; if all three split, the most-voted (else the safe option) wins
  card.votes = { ...(card.votes ?? {}), [role]: key };
  const tally = new Map<string, number>();
  for (const v of Object.values(card.votes)) if (v) tally.set(v, (tally.get(v) ?? 0) + 1);
  const top = [...tally.entries()].sort((x, y) => y[1] - x[1])[0];
  const voters = Object.keys(card.votes).length;
  if (!(top[1] >= 2 || voters >= 3)) {
    feed(s, role, 'info', `${s.players[role]?.name ?? role} voted on “${card.title}”. Waiting for a second vote.`, now);
    return { s };
  }
  return decideStory(s, top[1] >= 2 ? top[0] : card.options[card.options.length - 1].key, now);
}

function decideStory(s: IslandState, key: string, now: number): ApplyResult {
  const card = s.story!;
  const W = s.week;
  card.chosen = key;
  switch (`${card.id}:${key}`) {
    case 'blogger:host':
      s.cash -= 900;
      s.modifiers.push({ kind: 'demand', mult: 1.15, until: W + 4, label: 'Blogger feature' });
      break;
    case 'inspector:book': {
      s.cash -= 400;
      // one visit inspects every house this week, and the county books each renewal a week of its own from 8 weeks out
      // (fix round 1: every notice coming back in the same week was the code-prep pile-up the calendar removed)
      const hs = houses(s);
      for (const h of hs) h.inspectionUntil = 0;
      for (const h of hs) h.inspectionUntil = bookInspection(s, h.id, W + inspectionWeeks(s.tier));
      break;
    }
    case 'rival:ads':
      s.cash -= 600;
      break;
    case 'rival:ignore':
      s.modifiers.push({ kind: 'charterDemand', mult: 0.8, until: W + 3, label: 'Rival price war' });
      break;
    case 'shutters:buy':
      s.cash -= 1200;
      s.modifiers.push({ kind: 'stormShield', mult: 0.5, until: W + 8, label: 'Storm shutters' });
      break;
    case 'surplus:buy': {
      // a broker lot of the shop's own consumables, about $1,000 at list, for $600 (a PO, paid at the payment run after it lands)
      const cons = Object.keys(s.inv ?? {})
        .map((id) => itemById(id))
        .filter((x): x is NonNullable<typeof x> => !!x && x.kind === 'consumable' && x.trade === 'mech')
        .sort((a, b) => (a.id < b.id ? -1 : 1));
      const lines: { item: ItemId; qty: number }[] = [];
      let list = 0;
      for (const x of cons) {
        if (list >= 1000) break;
        lines.push({ item: x.id, qty: x.pack });
        list += x.price;
      }
      if (lines.length) {
        const pos = placePo(s, lines, { vendor: 'broker' }, 'fin', now);
        const total = pos.reduce((n, p) => n + p.lines.reduce((m, l) => m + l.unit * l.qty, 0), 0) || 1;
        for (const p of pos) {
          for (const l of p.lines) l.unit = Math.round(((600 * l.unit) / total) * 100) / 100;
          p.cost = Math.round(p.lines.reduce((m, l) => m + l.unit * l.qty, 0) * 100) / 100;
        }
      }
      break;
    }
    case 'wedding:yes':
      // they want EVERY house next week: an unrentable one costs you $1,000
      s.modifiers.push({ kind: 'demand', mult: 1.4, until: W + 1, label: 'Wedding party' });
      break;
  }
  const opt = card.options.find((o) => o.key === key);
  feed(s, 'all', 'info', `${card.title}: ${opt?.label ?? key}.`, now);
  return { s };
}

// ---------------------------------------------------------------------------
// Week lifecycle

function openWeek(s: IslandState, now: number) {
  s.week += 1;
  const W = s.week;
  const r = rng(hashSeed(s.seed, 'open', W));
  const td = tierDef(s.tier);
  s.weather = td.storms
    ? (r.weighted(['clear', 'wind', 'storm'] as const, (w) => ({ clear: 55, wind: 25, storm: 20 })[w]) ?? 'clear')
    : r.chance(0.3)
      ? 'wind'
      : 'clear';
  s.turns = { mech: { ended: false, endedAt: null, done: 0 }, elec: { ended: false, endedAt: null, done: 0 }, fin: { ended: false, endedAt: null, done: 0 } };
  s.coversUsed = {};
  s.autoSpent = { mech: 0, elec: 0 };
  s.openCash = s.cash;
  s.modifiers = s.modifiers.filter((m) => m.until >= W);
  s.tags = {};
  if (s.story?.chosen) s.story = null;
  else if (s.story && s.story.week < W - 1) {
    // undecided for two weeks: take the safe option
    decideStory(s, s.story.options[s.story.options.length - 1].key, now);
    s.story = null;
  }

  // stock goes to the jobs that wait for it, then the week's work: alerts (load sheets and ground power starts stay direct orders)
  for (const o of allocate(s)) partsIn(s, o, now);
  generateAlerts(s, r, now, (kind, asset) => addOps(s, kind, asset));
  generateFinTasks(s, r);
  generateReports(s, now);
  autoApprove(s, now);
  // the part chain's orders as they should be (an older build may have cancelled a step's order)
  const ch = openChain(s);
  if (ch) healChain(s, ch, now);
  openQueuedResearch(s, now);
  rollWeakBattery(s, now);
  staffOpenWeek(s, r, now);

  s.deadline = nextDeadline(now, s.creatorTz, s.resolveHour);
  const wx = s.weather === 'clear' ? 'Clear skies' : s.weather === 'wind' ? 'Wind: flight risk up' : 'Storm: the electrician’s week';
  feed(s, 'all', s.weather === 'clear' ? 'info' : 'bad', `Week ${W} opens. ${wx}.`, now);
}

function addOps(s: IslandState, kind: string, asset: Asset) {
  const c = CATALOG_BY_KIND[kind];
  const tier = orderTier(kind, asset, s.tier);
  return newOrder(s, {
    role: c.role,
    kind,
    assetId: asset.id,
    title: c.title,
    puzzle: c.puzzle,
    tier,
    cost: orderCost(kind, tier),
    parts: c.parts,
    gain: c.gain,
    // paperwork (no cost) never needs an approval card
    status: c.cost === 0 ? 'ready' : 'pending',
  });
}

/** Analyst difficulty climbs with the island: tier, plus one step every 10 weeks */
export const finTier = (s: IslandState) => clamp(s.tier + Math.floor(s.week / 20), 1, 5);

function generateFinTasks(s: IslandState, r: Rng) {
  const W = s.week;
  const t = finTier(s);
  const fin = (kind: keyof typeof FIN_TASKS, leak?: number) =>
    newOrder(s, { role: 'fin', kind, assetId: null, title: FIN_TASKS[kind].title, puzzle: FIN_TASKS[kind].puzzle, tier: t, cost: 0, parts: 0, gain: 0, status: 'ready', leak });
  // the weekly close alternates: variance hunt on odd weeks, bank rec on even weeks
  const leak = round10(r.range(300, 700) * (1 + 0.3 * (s.tier - 1)));
  fin(W % 2 === 0 ? 'reconcile' : 'close', leak);
  // the three-way match: the POs received at the last resolve (their real lines), else last week's approvals. The
  // vendors' invoices overbill about 3% of it (AP error rates run 1-3%), and now and then one invoice is plain wrong
  // (a seeded bad invoice, about every 2-3 weeks). On real POs the overbilling sits on them: it is paid at this
  // week's payment run unless the match catches it
  const inv = invoiceContext(s);
  const poSpend = inv ? inv.pos.reduce((n, p) => n + p.lines.reduce((m, l) => m + l.qty * l.unit, 0) + p.freight, 0) : 0;
  const lastWeekSpend = poSpend || (s.history.length ? spendIn(s, W - 1) : 0);
  if (lastWeekSpend >= 500) {
    const bad = rng(hashSeed(s.seed, 'bad-invoice', W));
    const leak = round10(Math.max(60, 0.03 * lastWeekSpend) + (bad.chance(0.4) ? bad.range(100, 240) : 0));
    fin('invoice', leak);
    if (poSpend > 0) {
      const pos = (s.pos ?? []).filter((p) => inv!.pos.some((x) => x.id === p.id));
      let left = leak;
      pos.forEach((p, i) => {
        const share = i === pos.length - 1 ? left : Math.round((leak * (p.cost - p.freightCost)) / Math.max(1, poSpend - inv!.pos.reduce((n, x) => n + x.freight, 0)));
        p.over = Math.max(0, Math.min(left, share));
        left -= p.over;
      });
    }
  }
  // the parts auction: a broker's lot of what the island uses, at most every 2 weeks
  const lastAuction = Math.max(-9, ...s.orders.filter((o) => o.kind === 'auction').map((o) => o.createdWeek));
  if (W - lastAuction >= 2) {
    const lot = auctionLot(s, rng(hashSeed(s.seed, 'lot', W)));
    if (lot) fin('auction').lot = lot;
  }
  if (W % 2 === 1 && W >= 3) fin('forecast');
}

function spendIn(s: IslandState, week: number) {
  return s.orders.filter((o) => o.approvedWeek === week).reduce((n, o) => n + o.cost, 0);
}

function autoApprove(s: IslandState, now: number) {
  for (const role of OPS) {
    const pend = s.orders
      // a part chain's cards are the analyst's call, never petty cash
      .filter((o) => o.role === role && o.status === 'pending' && !o.pushedBack && !o.chain)
      .sort((a, b) => urgency(s, b) - urgency(s, a));
    for (const o of pend) {
      // a flow card whose lines are all on the shelf now (the allocation filled it): the trade's work budget (8.4)
      if (o.flow) {
        if (workBudgetOk(s, o)) approveFlow(s, o, true, {}, 'auto', now);
        continue;
      }
      if (s.cash < ECON.freezeBelow) break;
      if (s.receivership > 0 && o.cost > 300) continue;
      // auto-approval is petty cash for routine work: parts-free, tier ≤ 2, ≤ $150 per tier
      const routine = o.parts === 0 && o.tier <= 2 && o.cost <= 150 * o.tier;
      if (routine && s.autoSpent[role] + o.cost <= s.autoBudget[role] && s.cash - o.cost >= ECON.freezeBelow) {
        s.autoSpent[role] += o.cost;
        markApproved(s, o, true);
      }
    }
  }
}

/** Missed turn: the role runs itself at 50% (never a punishment screen). */
function autoRun(s: IslandState, role: Role) {
  const now = s.updatedAt;
  const auto = `Autopilot (${s.players[role]?.name ?? ROLE_LABEL[role]})`;
  if (role === 'fin') {
    const pend = s.orders
      .filter((o) => o.role !== 'fin' && o.status === 'pending')
      .sort((a, b) => urgency(s, b) - urgency(s, a));
    let n = 0;
    for (const o of pend) {
      if (o.flow) {
        // a job whose alert grounds a plane or closes a house (or whose placard runs out): whenever spendable covers it, default freight
        const card = cardOf(s, o);
        const urgent = dueJob(s, o);
        // (in receivership the receiver funds safety-critical work the island can't pay for, review round 1)
        const adv = receiverFunds(s, card.total, isEmergency(s, o));
        if ((urgent && spendable(s) - card.total >= 0) || adv !== null) {
          if (adv) receiverAdvance(s, adv, o.title, now);
          approveFlow(s, o, true, { freight: card.freight.pick }, 'auto', now);
          continue;
        }
        if (n < 2 && spendable(s) - card.total >= ECON.autopilotFloor && s.receivership === 0) {
          approveFlow(s, o, true, { freight: card.freight.pick }, 'auto', now);
          n++;
          continue;
        }
        // a card that has waited three weeks fails more often than not: it goes through while spendable stays above the freeze
        // (a tool or a lot makes a card dear, and an empty seat shouldn't let the island rot for want of one)
        if (o.deferrals >= 3 && spendable(s) - card.total >= ECON.freezeBelow && s.receivership === 0) approveFlow(s, o, true, { freight: card.freight.pick }, 'auto', now);
        continue;
      }
      if (n >= 2) continue;
      // a grounded plane's part (or its engineering fee) goes through whenever the cash is there (the part on the AOG boat);
      // in receivership the receiver funds safety-critical work the island can't pay for
      const adv = receiverFunds(s, o.chain ? chainCardCost(s, o, 'boat') : o.cost, isEmergency(s, o), s.cash);
      if ((s.cash - o.cost >= ECON.autopilotFloor && s.receivership === 0) || (o.chain && s.cash - chainCardCost(s, o, 'boat') >= 0) || adv !== null) {
        if (adv) receiverAdvance(s, adv, o.title, now);
        markApproved(s, o, true);
        chainApproved(s, o, s.updatedAt, 'boat');
        n++;
      }
    }
    // the one MEL extension the mechanic asked for: approved (the plane keeps flying on the placard a week)
    for (const al of liveAlerts(s).filter((x) => x.mel?.ask && !x.mel.ext && x.mel.until >= s.week - 1)) {
      al.mel!.until = Math.max(al.mel!.until, s.week - 1) + 1;
      al.mel!.ext = true;
    }
    // requisitions: a grounding job's whenever the cash is there; the rest within the autopilot's weekly cap
    let cap = STOCK.autopilotCap;
    const reqs = (s.reqs ?? [])
      .filter((r) => r.status === 'open')
      .sort((a, b) => Number(!!b.order && urgentJob(s, s.orders.find((o) => o.id === b.order))) - Number(!!a.order && urgentJob(s, s.orders.find((o) => o.id === a.order))));
    for (const r of reqs) {
      const cost = reqCost(r);
      const urgent = !!r.order && urgentJob(s, s.orders.find((o) => o.id === r.order));
      const adv = receiverFunds(s, cost, urgent);
      if (spendable(s) - cost < (urgent ? 0 : ECON.freezeBelow) && adv === null) continue;
      if (!urgent && cost > cap) continue;
      if (adv) receiverAdvance(s, adv, 'the parts for a request', now);
      if (!urgent) cap -= cost;
      const [po] = placePo(s, [{ item: r.item, qty: r.qty, req: r.id, ...(r.order ? { order: r.order } : {}) }], {}, 'auto', now);
      r.status = 'ordered';
      r.po = po?.id;
    }
    autoStaff(s);
    const close = s.orders.find((o) => (o.kind === 'close' || o.kind === 'reconcile') && o.status === 'ready' && o.createdWeek === s.week);
    if (close) {
      close.status = 'done';
      close.result = { score: 0.5, perfect: false, credit: 0.5, by: 'fin', week: s.week, auto: true };
    }
    // a crewmate's cap report gets a 50% patch too (it won't hold). A money leak waits for a person:
    // autopilot can't renegotiate a vendor, so it keeps costing until someone does
    const report = s.orders.find((o) => o.role === 'fin' && o.kind === 'report' && o.status === 'ready' && o.report?.effect === 'cap');
    if (report) {
      report.status = 'done';
      report.result = { score: 0.5, perfect: false, credit: 0.5, by: 'fin', week: s.week, auto: true };
      closeReport(s, report, 'fin', auto, 0.5, s.updatedAt);
    }
    return;
  }
  const ops = role as OpsRole;
  // the job flow (18.3): hazards made safe, MEL items placarded, the alerts that ground or close planned by the book
  for (const al of liveAlerts(s).filter((x) => x.role === ops && x.status !== 'closed')) {
    const asset = s.assets.find((x) => x.id === al.assetId);
    if (!asset) continue;
    // stage 2 (review round 1): a quick-check write-up or a crewmate's flag with nothing wrong, come due: a closer look by
    // the book closes it as no fault found. Before, autopilot left every no-fault alert open, so a wrong walkaround call
    // or a flag grounded the plane from its due week until the mechanic was back (pillar 2: nobody waits helplessly).
    // Only at the resolve before it's due (as autopilot plans what comes due, below): until then it's the seat's to close
    if (al.status === 'open' && (al.src === 'check' || al.src === 'flag') && al.cause < 0 && !al.repair && al.due <= s.week + 1) {
      closeAlert(s, al, 'nff');
      feed(s, ops, 'info', `${auto} closed ${shortText(s, al)} on ${asset.name}: no fault found.`, now);
      continue;
    }
    const f = alertFlags(s, al);
    const task = al.repair ? planTask(s, al, `repair:${al.id}`) : fixTaskFor(s, al);
    const needsBuy = !!task && stdPick(s, asset, task, siteOf(s, al), needsOf(s, al)).some((l) => available(s, l.item) < l.qty);
    if (ops === 'elec' && f.hazard && !al.safe && al.status !== 'closed') {
      // autopilot keeps to the manual: a service-neutral fault stays closed (a branch breaker doesn't isolate it)
      if (!causeOf(al)?.neutral) al.safe = { how: 'breaker', week: s.week, by: auto };
    }
    // placarded when it can't be fixed this week: a part to buy, or the electrician's check still to come
    if (ops === 'mech' && f.mel === 'C' && !al.mel && (needsBuy || (f.bench && !al.bench?.call))) al.mel = { until: Math.max(s.week, al.due), by: auto };
    // a placard running out with the fix not ready: the one extension, asked of the analyst
    if (ops === 'mech' && al.mel && !al.mel.ext && !al.mel.ask && al.mel.until <= s.week && al.mel.until >= s.week - 1) {
      const job = al.order ? s.orders.find((x) => x.id === al.order) : undefined;
      if (!job || job.status !== 'ready') al.mel.ask = { week: s.week, by: auto };
    }
    if (ops === 'mech' && f.bench && !al.bench?.call && !(al.bench?.order && open(s.orders.find((x) => x.id === al.bench!.order)!))) {
      const b = flowBenchOrder(s, al, false);
      al.bench = { ...(al.bench ?? {}), order: b.id };
      continue;
    }
    if (al.status !== 'open' || !task) continue;
    // autopilot keeps to the manual: what grounds a plane or closes a house, and whatever else comes due now or next
    // week (the seat's work doesn't pile up past due while it's away), and an asset in critical shape
    const grounds = asset.kind === 'plane' ? f.aw && al.due <= s.week + 1 : f.hazard;
    // (A0 e: the grid's feed at real risk at tier 4+ is must-do work, for autopilot too)
    const critical = asset.health < 45 || gridFirstAlert(s, al);
    const dueSoon = al.due <= s.week + 1;
    if (!(grounds || critical || dueSoon) || (!realFault(al) && !al.repair)) continue;
    const pick = task.fixed ? [] : stdPick(s, asset, task, siteOf(s, al), needsOf(s, al));
    planAlert(s, al, task.id, pick, now, false, auto);
  }
  const ready = s.orders
    // crew projects wait for the crew; a part chain's IPC lookup and logbook research wait for a person
    .filter((o) => o.role === role && o.status === 'ready' && o.kind !== 'project' && !(o.chain && o.chain.step !== 'job'))
    .sort((a, b) => urgency(s, b) - urgency(s, a));
  // the electrician's check on a chain: autopilot doesn't meter an airplane. The mechanic goes by the
  // symptom (the unit), so the plane never waits on an empty seat; a wiring fault shows up at the install
  const ch = openChain(s);
  if (role === 'elec' && ch?.bench && !ch.bench.call) {
    const b = s.orders.find((o) => o.id === ch.bench!.id);
    if (b && open(b)) {
      b.status = 'done';
      b.result = { score: 0.5, perfect: false, credit: 0.5, by: role, week: s.week, auto: true };
    }
    benchDone(s, ch, { call: 'unit' }, auto, s.updatedAt);
  }
  // the same for a flow alert's check: autopilot calls the unit (today's rule)
  if (role === 'elec') {
    for (const b of s.orders.filter((o) => o.bench && o.status === 'ready')) {
      const al = alertById(s, b.bench!);
      b.status = 'done';
      b.result = { score: 0.5, perfect: false, credit: 0.5, by: role, week: s.week, auto: true };
      if (al && al.status !== 'closed') flowBenchDone(s, al, { call: 'unit' }, auto, now);
    }
  }
  // two jobs at 50%, plus a quick patch on a crewmate's cap report or a tagged-out cart's cable (it won't hold; a leak waits for a person).
  // A ground power start needs a charged cart when its turn comes (an earlier start may have used it up): autopilot
  // tows one over (off the charger, or off a plane that isn't flying), and puts it back on the charger after. No cart, no start
  const report = ready.find((o) => o.kind === 'report' && (o.report?.effect === 'cap' || o.report?.effect === 'gse'));
  let jobs = 0;
  for (const o of [...ready.filter((x) => x.kind !== 'report' && !x.bench), ...(report ? [report] : [])]) {
    if (o.kind !== 'report' && jobs >= 2) continue;
    if (o.status !== 'ready') continue;
    const cart = needsCart(o.kind) ? autoCart(s, o) : null;
    if (needsCart(o.kind) && !cart) continue;
    // a job the part chain holds: the new unit made no difference (the fault is the wiring), and the electrician looks again
    const held = o.chain?.step === 'job' ? chainOf(s, o) : null;
    if (held && held.bench?.fault === 'wiring' && held.bench.call === 'unit' && !held.wired) {
      jobs++;
      missedWiring(s, held, o, auto, s.turns[role] ?? { ended: false, endedAt: null, done: 0 }, s.updatedAt);
      continue;
    }
    // the job flow: the box is opened (a wrong pick stops it), and a unit on a wiring fault makes no difference
    if (o.flow && !o.flow.wired) {
      const stop = installCheck(s, o);
      if (stop) {
        o.flow.stop = stop.stop;
        if (stop.research) o.flow.stopResearch = true;
        o.status = 'waiting_part';
        continue;
      }
      const al = alertOf(s, o);
      if (al && benchFault(al) === 'wiring' && al.bench?.call !== 'wiring' && unitJob(s, al, o)) {
        jobs++;
        missedWiringFlow(s, o, al, auto, s.turns[role] ?? { ended: false, endedAt: null, done: 0 }, now);
        continue;
      }
    }
    if (o.kind !== 'report') jobs++;
    const wear = cart && o.kind === 'gpustart' ? useCart(s, cart, o) : 0;
    if (cart && o.kind !== 'gpustart') {
      cart.charge = Math.max(0, cart.charge - GSE.avionicsDrain);
      cart.wear = Math.min(100, cart.wear + GSE.busWear);
    }
    o.status = 'done';
    // an inspection autopilot covers is signed at the pass mark (SIGNOFF): by the book, a bare pass, which renews it at
    // any tier as a human's pass would (fix round 1: at a teaching tier a human's 50% fails the sign-off, and autopilot's
    // 50% passing it made being away better than a poor attempt). Its other jobs stay at 50%
    const sc = o.kind === 'codeprep' || o.kind === 'inspect100' ? SIGNOFF : 0.5;
    o.result = { score: sc, perfect: false, credit: sc, by: role, week: s.week, auto: true };
    const asset = assetOf(s, o);
    if (cart && asset) {
      // the manual is kept, but a worn cable is a worn cable
      if (o.kind === 'gpustart') cableArc(s, o, asset, role, auto, wear);
      cart.hookedTo = null;
      cart.charging = true;
    }
    if (asset) {
      // (a renovation's final: back to RENO.health, then the job's own points on top, as a person's sign-off)
      if (o.kind === 'codeprep') renoSignoff(s, asset, s.week);
      asset.health = clamp(asset.health + o.gain * sc, 0, 100);
      // (a perfect blind sign-off settled at this resolve keeps its no-decay week, as complete() keeps it: the max)
      asset.touchedWeek = Math.max(asset.touchedWeek, s.week);
      // by the book: the inspection it prepared passes and the 100-hour is in the logbook, as a blind sign-off's is.
      // Before, a covered code prep closed its notice without renewing, so the notice came straight back and the house lapsed
      if (o.kind === 'codeprep') asset.inspectionUntil = renewedInspection(s, asset, s.week);
      if (o.kind === 'inspect100') asset.sinceInspection = 0;
    }
    // the job flow: what was pulled leaves stock and the alert closes (autopilot keeps to the manual: no hidden defects)
    if (o.flow) {
      if (!o.flow.wired) consume(s, o.id, asset?.id ?? null);
      const al = alertOf(s, o);
      if (al && al.status !== 'closed') closeAlert(s, al, o.flow.wired ? 'wired' : 'fixed');
    }
    // autopilot keeps to the manual (no hidden defects), but a 50% patch on a crewmate's report won't hold
    if (o.kind === 'report') closeReport(s, o, role, auto, 0.5, s.updatedAt);
    // a repair still needs its redo
    if (o.repair) spawnRedo(s, o, s.updatedAt);
    // the part is here: autopilot puts it on and finishes the job
    if (o.chain) closeChain(s, o, auto, s.updatedAt);
  }
  // a weak battery on the flight line: autopilot hooks a charged cart up to that plane for its first start
  if (role === 'mech') hookForFlightDay(s);
}

/**
 * Resolve step 1c (review round 1): each electrician's helper on the payroll does up to STAFF.helper.jobs of the
 * electrician's ready routine jobs, the most urgent first, at STAFF.helper.score: by the book (no hidden defect), as
 * autopilot's. The release gate (2026-09-29) narrowed it: only the routine device swaps and the generator's circuit test
 * (STAFF.helper.tasks, by task, not by catalog kind), never a hazard's fix (the electrician puts what they made safe back
 * in service), only a job that was ready when the electrician ended the turn (a card approved after that, at the resolve
 * included, waits for them), and never in a week the electrician is on autopilot (nobody supervises). Never the licensed
 * work: the diagnosis, code prep, the grid's feed, a repair or its redo, a part chain's, a crew project's or a report.
 * Off for stage 1 (STAFF.helper.enabled).
 */
/** a ready job the electrician's helper may do (STAFF.helper.tasks; never the licensed work, never a hazard's fix) */
function helperMay(s: IslandState, o: Order): boolean {
  if (o.role !== 'elec' || o.status !== 'ready' || o.repair || o.redo || o.chain || o.bench || o.report) return false;
  const no = o.flow ? o.flow.task : defaultTaskNo(o.kind);
  if (!no || !STAFF.helper.tasks.includes(no)) return false;
  const al = o.flow ? alertOf(s, o) : undefined;
  if (al && alertFlags(s, al).hazard) return false;
  // the electrician ended the turn: only what was ready then (a card approved later waits for them)
  const t = s.turns.elec;
  return !t?.ended || !!t.ready?.includes(o.id);
}

/**
 * The jobs each helper would take at this resolve if nobody else does them (the resolve's order: the most skilled
 * helper first, the most urgent job first): by helper id. The chip on Your move and each helper's line on the Staff desk.
 */
export function helperQueues(s: IslandState): Map<string, Order[]> {
  const out = new Map<string, Order[]>();
  if (!helperOn(s)) return out;
  const jobs = s.orders.filter((o) => helperMay(s, o)).sort((a, b) => urgency(s, b) - urgency(s, a));
  let k = 0;
  for (const n of working(s)
    .filter((x) => x.role === 'helper')
    .sort((a, b) => b.skill - a.skill)) {
    const take = STAFF.helper.jobs[n.skill - 1] ?? 1;
    out.set(n.id, jobs.slice(k, k + take));
    k += take;
  }
  return out;
}

/** every job the helpers would take at this resolve, most urgent first */
export const helperQueue = (s: IslandState): Order[] => [...helperQueues(s).values()].flat();

function helperWeek(s: IslandState, line: Liner, elecAway: boolean, now: number) {
  const helpers = working(s).filter((n) => n.role === 'helper');
  if (!helpers.length || !helperOn(s)) return;
  // a helper works under the electrician's licence: a week the electrician is on autopilot, nobody supervises them
  if (elecAway) {
    line('elec', 'info', `${helpers.map((n) => n.name).join(' and ')} (electrician's ${helpers.length > 1 ? 'helpers' : 'helper'}) did nothing this week: ${nameOfRole(s, 'elec')} was away, and a helper works only under the electrician's supervision.`);
    return;
  }
  const theirs = (o: Order) => helperMay(s, o);
  const did: string[] = [];
  for (const n of [...helpers].sort((a, b) => b.skill - a.skill)) {
    const sc = STAFF.helper.score[n.skill - 1] ?? 0.5;
    let left = STAFF.helper.jobs[n.skill - 1] ?? 1;
    const jobs = s.orders.filter(theirs).sort((a, b) => urgency(s, b) - urgency(s, a));
    for (const o of jobs) {
      if (left <= 0) break;
      // the box is opened as it was planned: a wrong pick stops the job for the electrician, as it would stop theirs
      if (o.flow && !o.flow.wired) {
        const stop = installCheck(s, o);
        if (stop) {
          o.flow.stop = stop.stop;
          if (stop.research) o.flow.stopResearch = true;
          o.status = 'waiting_part';
          left--;
          line('elec', 'bad', `${n.name} (electrician's helper) opened up ${o.title}: ${stop.stop}. It's back with ${nameOfRole(s, 'elec')}.`);
          continue;
        }
      }
      left--;
      o.status = 'done';
      o.result = { score: sc, perfect: false, credit: sc, by: 'elec', week: s.week, auto: true, npc: n.name };
      const asset = assetOf(s, o);
      if (asset) {
        asset.health = clamp(asset.health + o.gain * sc, 0, 100);
        // (a perfect blind sign-off earlier in this resolve keeps its no-decay week: complete() takes the max too)
        asset.touchedWeek = Math.max(asset.touchedWeek, s.week);
      }
      if (o.flow) {
        const al = alertOf(s, o);
        // the plan is the electrician's: a wrong task or a pick that installs but isn't right (an undersized wire, no
        // protection the room needs) goes in as planned and surfaces later, traced to them (pillar 3) and naming who put
        // it in. The helper's own work is by the book: no quality roll's defect, as autopilot's
        const k = (s.defects ?? []).length;
        flowSureDefect(s, o, al, 'elec', nameOfRole(s, 'elec'), sc);
        for (const d of (s.defects ?? []).slice(k)) d.npc = n.name;
        if (!o.flow.wired) consume(s, o.id, asset?.id ?? null);
        if (al && al.status !== 'closed') closeAlert(s, al, o.flow.wired ? 'wired' : 'fixed');
      }
      did.push(`${o.title}${asset ? ` (${asset.name})` : ''}`);
      line('elec', 'good', `${n.name} (electrician's helper) did ${o.title}${asset ? ` on ${asset.name}` : ''}, as ${nameOfRole(s, 'elec')} planned (${Math.round(sc * 100)}%).`);
    }
  }
  // the island log says it too (review, release gate: after the resolve nothing the electrician looks at said so)
  if (did.length)
    feed(s, 'elec', 'info', `The electrician's ${helpers.length > 1 ? 'helpers' : 'helper'} put in ${did.length === 1 ? 'one' : did.length} of ${nameOfRole(s, 'elec')}'s planned jobs: ${did.join(', ')}.`, now);
}

/**
 * A flight day on a weak battery: tow the best charged cart over to that plane
 * (autopilot). A cart left on a plane from an earlier week goes back on the
 * charger first: autopilot covers the obvious.
 */
export function hookForFlightDay(s: IslandState) {
  const wb = s.weakBattery?.week === s.week ? s.weakBattery : null;
  for (const c of ensureGse(s)) {
    if (c.hookedTo && c.hookedTo !== wb?.assetId) {
      c.hookedTo = null;
      c.charging = true;
    }
  }
  if (!wb) return;
  const pick = startCart(s, wb.assetId);
  if (!pick || pick.hookedTo === wb.assetId) return;
  const carts = ensureGse(s);
  const c = carts.find((x) => x.id === pick.id)!;
  const on = carts.find((x) => x.hookedTo === wb.assetId);
  if (on && on !== c) {
    on.hookedTo = null;
    on.charging = true;
  }
  c.charging = false;
  c.hookedTo = wb.assetId;
}

/**
 * Autopilot tows the cart for a start over (startCart: the one on that plane,
 * else a free one, else one off a plane that isn't flying, like one AOG for a
 * part): off the charger, and a flat or tagged-out one on that plane goes back
 * on the charger. Null: no charged cart in service, so no start.
 */
function autoCart(s: IslandState, o: Order): GseCart | null {
  const pick = startCart(s, o.assetId);
  if (!pick) return null;
  const carts = ensureGse(s);
  const c = carts.find((x) => x.id === pick.id)!;
  const on = carts.find((x) => x.hookedTo === o.assetId);
  if (on && on !== c) {
    on.hookedTo = null;
    on.charging = true;
  }
  c.charging = false;
  c.hookedTo = o.assetId;
  return c;
}

/**
 * Resolve: a part chain's card that came in after the analyst had ended the
 * turn (the mechanic handed the lookup in later) goes through on the standing
 * AOG approval when the cash covers it, and the review says so. A card the
 * analyst saw and deferred waits, as any deferral does.
 */
function leftoverChainCard(s: IslandState, line: (role: ReportLine['role'], tone: ReportLine['tone'], text: string) => void) {
  const c = openChain(s);
  const t = s.turns.fin;
  if (!c || (c.step !== 'buy' && c.step !== 'fee') || !c.stepId || !t?.ended || t.endedAt === null || (c.stepAt ?? 0) <= t.endedAt) return;
  const o = s.orders.find((x) => x.id === c.stepId);
  if (!o || o.status !== 'pending' || o.lastDeferredWeek === s.week) return;
  const cost = chainCardCost(s, o, 'boat');
  if (s.cash - cost < 0) return;
  const asset = s.assets.find((a) => a.id === c.assetId);
  markApproved(s, o, true);
  chainApproved(s, o, s.updatedAt, 'boat');
  line(
    'fin',
    'info',
    `${nameOfRole(s, 'fin')} had ended the turn when the ${o.chain!.step === 'buy' ? 'part' : 'engineering fee'} for ${asset?.name ?? 'the plane'} came in: it went through on the standing AOG approval (${usd(cost)}).`,
  );
}

/**
 * Resolve step 1b (8.5): the analyst ended the turn, and flow cards and
 * requisitions came in after it. Each goes through, most urgent first, with the
 * card's default freight, up to the standing limit and while spendable cash
 * stays above the freeze (safety work: above zero). A card whose alert grounds
 * a plane or closes a house this week or next
 * goes through whatever the limit (`lateSafe`, cash floor $0). The rest waits,
 * and the review says why.
 */
function standingApprovals(s: IslandState, line: Liner, now: number) {
  const t = s.turns.fin;
  if (!t?.ended || t.endedAt === null) return;
  const endedAt = t.endedAt;
  let limit = s.standing ?? (s.autoBudget.mech ?? 0) + (s.autoBudget.elec ?? 0);
  const fin = nameOfRole(s, 'fin');
  const cards = s.orders
    .filter((o) => o.flow && o.status === 'pending' && (o.at ?? 0) > endedAt && o.lastDeferredWeek !== s.week)
    // the grid's feed at real risk (A0 e) goes through like safety work due now: every house hangs off it (review round 1)
    .sort((a, b) => Number(lateSafe(s, b) || gridFirstJob(s, b)) - Number(lateSafe(s, a) || gridFirstJob(s, a)) || Number(isSafetyJob(s, b)) - Number(isSafetyJob(s, a)) || (alertOf(s, a)?.due ?? 99) - (alertOf(s, b)?.due ?? 99));
  for (const o of cards) {
    const card = cardOf(s, o);
    const cost = card.total;
    const first = gridFirstJob(s, o);
    const safety = isSafetyJob(s, o) || first;
    const soon = lateSafe(s, o) || first;
    // what waits says why on the board: both seats see it (the tech was told it might go through tonight)
    const over = !soon && cost > limit;
    // in receivership the receiver funds safety-critical work the island can't pay for (its weekly allowance)
    const adv = over ? null : receiverFunds(s, cost, isEmergency(s, o) || first);
    if (over || (spendable(s) - cost < (safety ? 0 : ECON.freezeBelow) && adv === null)) {
      const asset = assetOf(s, o);
      line('fin', 'info', `${fin} had ended the turn when ${nameOfRole(s, o.role)}'s card for ${o.title}${asset ? ` on ${asset.name}` : ''} came in (${usd(cost)}): ${over ? `over the standing limit (${usd(limit)} left)` : safety ? 'there isn’t the cash for it' : 'spendable cash is under the freeze'}, so it waits for ${fin}.`);
      continue;
    }
    if (adv) receiverAdvance(s, adv, o.title, now);
    approveFlow(s, o, false, { freight: card.freight.pick }, 'auto', now);
    if (!soon) limit -= cost;
    const asset = assetOf(s, o);
    const eta = card.freight.pick === 'aog' ? 'on the AOG boat, here tonight' : card.freight.sched.eta <= s.week ? 'next flight, here tonight' : `here week ${card.freight.sched.eta}`;
    line(
      'fin',
      'info',
      `${fin} had ended the turn when ${nameOfRole(s, o.role)}'s card for ${o.title}${asset ? ` on ${asset.name}` : ''} came in: it went through on the standing approval (${usd(cost)}${card.toBuy.length + card.tools.length ? `, ${eta}` : ''})${soon ? `: safety work due this week or next goes through whatever the limit` : ''}.`,
    );
  }
  const reqs = (s.reqs ?? []).filter((r) => r.status === 'open' && r.at > endedAt && r.deferredWeek !== s.week);
  for (const r of reqs) {
    // the line and its shipment's freight (none when it rides a PO already on its way)
    const cost = reqCost(r) + schedFreight(s, [{ item: r.item }]).cost;
    const job = r.order ? s.orders.find((o) => o.id === r.order) : undefined;
    const urgent = lateSafe(s, job);
    const x = itemById(r.item);
    const why =
      !urgent && cost > limit
        ? `over the standing limit (${usd(limit)} left)`
        : spendable(s) - cost < (urgent ? 0 : ECON.freezeBelow)
          ? 'spendable cash is under the freeze'
          : !r.order && needsNewBin(s, r.item) && !binFree(s)
            ? `the stores are full (${binsInUse(s)} of ${binsTotal(s)} bins)`
            : null;
    if (why) {
      line('fin', 'info', `${fin} had ended the turn when ${nameOfRole(s, r.role)}'s request for ${r.qty} × ${x?.pn ?? r.item} came in (${usd(cost)}): ${why}, so it waits for ${fin}.`);
      continue;
    }
    const [po] = placePo(s, [{ item: r.item, qty: r.qty, req: r.id, ...(r.order ? { order: r.order } : {}) }], {}, 'auto', now);
    r.status = 'ordered';
    r.po = po?.id;
    if (!urgent) limit -= cost;
    line('fin', 'info', `${fin} had ended the turn when ${nameOfRole(s, r.role)}'s request for ${r.qty} × ${x?.pn ?? r.item} came in: it went through on the standing approval (${usd(cost)}).`);
  }
}

/** why a plane is AOG on an alert this week (the balance run's split): nobody planned it, the card waits, the stock wasn't there, or the carrier */
function aogCause(s: IslandState, al: Alert, W: number): 'stock' | 'approval' | 'plan' | 'carrier' {
  const o = al.order ? s.orders.find((x) => x.id === al.order) : undefined;
  if (!o || !open(o) || o.status === 'ready') return 'plan';
  if (o.status === 'pending' || o.status === 'countered') return 'approval';
  const late = (s.pos ?? []).some((p) => (p.status === 'open' || p.status === 'held') && p.lines.some((l) => l.order === o.id) && p.week < W && p.eta < W);
  return late ? 'carrier' : 'stock';
}

/** what an unplanned alert's fix would have cost in labour (its deferral incident is 3x this) */
function unplannedLabour(s: IslandState, al: Alert, asset: Asset, kind: string, tier: number): number {
  if (al.repair) {
    const d = al.repair.defect;
    return repairLabor(s, { cost: d.cost, puzzle: d.puzzle, role: d.role, orderKind: d.rule ?? d.orderKind, variant: d.variant, job: d.job });
  }
  const task = fixTaskFor(s, al) ?? defaultTask(kind, asset);
  if (task?.kind) return laborCost(s, task.kind, task, asset, siteOf(s, al), needsOf(s, al), earlyLess(al));
  return CATALOG_BY_KIND[kind] ? orderCost(kind, tier) : DEFECT.minBase;
}

/**
 * A flight day on a weak battery: the pilot starts the plane on the cart hooked
 * up to it (the drain and the wear of a start, and through pitted contacts the
 * chance of an arc into the receptacle). No charged cart in service on it: the
 * first flight is lost. Returns the flights lost.
 */
function flightDayStart(s: IslandState, p: Asset, line: (role: ReportLine['role'], tone: ReportLine['tone'], text: string) => void): number {
  const cart = ensureGse(s).find((c) => c.hookedTo === p.id);
  const tagged = !!cart && !!cableReport(s, cart.id);
  if (!cart || tagged || cart.charge < GSE.minStart) {
    const why = !cart ? 'no cart was hooked up to it' : tagged ? `${cart.name} on it is tagged out` : `${cart.name} on it was down to ${Math.round(cart.charge)}%`;
    line('mech', 'bad', `${p.name}'s battery was weak and ${why}: its first flight was lost.`);
    return 1;
  }
  const before = cart.wear;
  cart.charge = Math.max(0, cart.charge - (p.model === 'cargo' ? GSE.drain.turbine : GSE.drain.piston));
  cart.wear = Math.min(100, cart.wear + GSE.wear);
  line('mech', 'info', `${p.name}'s weak battery: the pilot started it on ${cart.name} (${Math.round(cart.charge)}% left on the cart).`);
  const tier = orderTier('gpustart', p, s.tier);
  const start: Order = {
    id: `fd${s.week}`,
    role: 'mech',
    kind: 'gpustart',
    assetId: p.id,
    title: 'Ground power start on the flight line',
    puzzle: 'gpu',
    tier,
    cost: orderCost('gpustart', tier),
    parts: 0,
    gain: 0,
    createdWeek: s.week,
    deferrals: 0,
    lastDeferredWeek: null,
    status: 'done',
    seed: hashSeed(s.seed, 'flight-day', s.week),
  };
  // the mechanic hooked the worn cable up to it
  cableArc(s, start, p, 'mech', nameOfRole(s, 'mech'), before);
  return 0;
}

/** Week open: now and then a plane's battery is weak for its first start of the week (a cart has to be hooked up to it). */
function rollWeakBattery(s: IslandState, now: number) {
  const W = s.week;
  s.weakBattery = null;
  if (W < GSE.weakFrom) return;
  const r = rng(hashSeed(s.seed, 'weak-battery', W));
  if (!r.chance(GSE.weakChance)) return;
  // a plane that will fly this week (not down for a part, not worn out)
  const cands = planes(s).filter((p) => !isAog(s, p.id) && p.health >= 40);
  if (!cands.length) return;
  const p = r.pick(cands);
  s.weakBattery = { assetId: p.id, week: W };
  feed(s, 'mech', 'info', `${p.name}'s battery is weak this week: its first start is on ground power. Hook a charged cart up to it before the week resolves, or it loses a flight.`, now);
}

const GRADE_VALUE: Record<Grade, number> = { A: 4, B: 3, C: 2, D: 1 };
const letter = (v: number): Grade => (v >= 3.5 ? 'A' : v >= 2.5 ? 'B' : v >= 1.5 ? 'C' : 'D');
const worst = (a: Grade, b: Grade): Grade => (GRADE_VALUE[a] <= GRADE_VALUE[b] ? a : b);

export function resolveWeek(s: IslandState, now: number) {
  const W = s.week;
  const seed = hashSeed(s.seed, 'resolve', W);
  const r = rng(seed);
  const td = tierDef(s.tier);
  const lines: ReportLine[] = [];
  const incidents: Incident[] = [];
  let nearMisses = 0;
  const line = (role: ReportLine['role'], tone: ReportLine['tone'], text: string) => lines.push({ role, tone, text });

  // 0. blind sign-offs settle: the true result replaces the stand-in, before anything flies or books
  settleBlind(s);

  // 1. missed turns auto-run at 50%
  const autoRunRoles: Role[] = [];
  for (const role of ROLES) {
    const p = s.players[role];
    if (!s.turns[role]?.ended) {
      autoRun(s, role);
      coverProject(s, role, line);
      autoRunRoles.push(role);
      if (p) p.missedStreak += 1;
      line(role, 'info', `${p?.name ?? role} was covered by autopilot (50%).`);
    } else if (p) p.missedStreak = 0;
  }
  // 1b. a part chain's card that came in after the analyst had ended the turn goes through on the standing
  // AOG approval (cash permitting): a plane shouldn't sit a week longer only because of the order the crew played in.
  // The job flow's cards and requisitions do the same, up to the standing limit (8.5)
  leftoverChainCard(s, line);
  standingApprovals(s, line, now);
  // 1c. the electrician's helper (review round 1, from tier 4; off for stage 1) does the planned routine installs nobody got to
  helperWeek(s, line, autoRunRoles.includes('elec'), now);

  // 2. flights
  let passenger = 0;
  let cargoFlights = 0;
  let flown = 0;
  let scheduled = 0;
  const perPlane = flightsPerPlane(s.tier);
  const guestSlots: { plane: Asset; n: number }[] = [];
  const fleet: { plane: Asset; n: number }[] = [];
  // the only guest plane on the ground (past due on an airworthiness item, or the mechanic's safety call): a mainland
  // sub-charter flies the island's guests in on its own plane and crew, the flights the guests need, paid at step 11
  const sub = subCharterOn(s, W, s.weather);
  const subFlights = sub?.flights ?? 0;
  // whose side the fee lands on in the Money tab: why the plane is down (the analyst's approval, stock or carrier; the
  // mechanic's plan, part chain or safety call), read now, before receiving readies anything
  const subCause = sub?.alert ? aogCause(s, sub.alert, W) : null;
  const subTrade: 'mech' | 'fin' = subCause && subCause !== 'plan' ? 'fin' : 'mech';
  for (const p of planes(s)) {
    const grounded = isTagged(s, p.id);
    // waiting on a part (the part chain), or an airworthiness alert past due: not airworthy, no flights. Its flights
    // were cancelled when it went down, so they're off the schedule (the on-time grade judges the fleet that could fly)
    const chainDown = !grounded && chainAog(s, p.id);
    const alertDown = !grounded && !chainDown ? alertAog(s, p.id) : undefined;
    const aog = chainDown || !!alertDown;
    // on-time is judged against what the weather allows, not against a clear sky. A plane AOG is off the schedule, but
    // not the only guest plane when the sub-charter flies its guests: its schedule is the island's guest service, and
    // the island's own flights on it are what the on-time grade reads (0 of 4, the sub-charter's aren't the island's)
    // (its schedule in this week's weather: the flights an AOG line calls cancelled are the ones the on-time grade counts)
    const sched = planeCapacity({ ...p, health: 100 }, s.tier, s.weather);
    if (!aog || sub?.plane.id === p.id) scheduled += sched;
    const healthCap = grounded || aog ? 0 : planeCapacity(p, s.tier, 'clear');
    let cap = capOf(s, p);
    // a flight day on a weak battery: the first start is on the cart hooked up to it, or the first flight is lost
    if (cap > 0 && s.weakBattery?.week === W && s.weakBattery.assetId === p.id) cap -= flightDayStart(s, p, line);
    if (grounded) line('mech', 'info', `${p.name} grounded by the mechanic this week (safety call).`);
    else if (chainDown) line('mech', 'bad', `${p.name} AOG: grounded until the ${s.chain!.item} ${isAre(s.chain!.item)} ${s.chain!.wired ? 'fixed' : 'on'} (${sched} flight${sched !== 1 ? 's' : ''} cancelled).`);
    else if (alertDown) {
      const ran = alertDown.mel && alertDown.mel.until < W;
      line(
        'mech',
        'bad',
        ran
          ? `${p.name}'s MEL C for ${shortText(s, alertDown)} ran out in week ${alertDown.mel!.until}: grounded until it's fixed (${sched} flight${sched !== 1 ? 's' : ''} cancelled).`
          : `${p.name} AOG: ${shortText(s, alertDown)} (due week ${alertDown.due}, not fixed): ${sched} flight${sched !== 1 ? 's' : ''} cancelled.`,
      );
      bookAog(s, aogCause(s, alertDown, W));
    } else if (healthCap < perPlane)
      line('mech', 'bad', `${perPlane - healthCap} flight${perPlane - healthCap > 1 ? 's' : ''} lost on ${p.name}: airworthiness ${Math.round(p.health)}`);
    if (cap < healthCap) line('all', 'info', `${healthCap - cap} flight${healthCap - cap > 1 ? 's' : ''} lost on ${p.name}: ${s.weather}`);
    if (cap === 0 && healthCap === 0 && !grounded && !aog) line('mech', 'bad', `${p.name} is AOG (aircraft on ground).`);
    fleet.push({ plane: p, n: cap });
  }
  if (sub && subFlights > 0)
    line('all', 'bad', `${sub.plane.name} stayed on the ground: a mainland sub-charter flew the guests in (${subFlights} flight${subFlights > 1 ? 's' : ''} at ${usd(sub.fee)}, ${usd(sub.usd)}).`);
  // the pilots fly what their duty allows (D: pilotCap), cargo runs cut first so guests keep flying
  const capped = capFleet(s, fleet);
  const lostToPilots = fleet.reduce((n, c) => n + c.n, 0) - capped.reduce((n, c) => n + c.n, 0);
  if (lostToPilots > 0) line('fin', 'bad', `${lostToPilots} flight${lostToPilots > 1 ? 's' : ''} lost: the pilots fly ${pilotCap(s).total} a week. ${hireComing(s, 'pilot', W) ?? 'Hire a pilot?'}`);
  for (const { plane: p, n: cap } of capped) {
    for (let i = 0; i < cap; i++) {
      if (p.health < 60 && r.chance(ECON.nearMissPerFlight)) {
        nearMisses++;
        line('mech', 'bad', `Near-miss on ${p.name}: rough engine on climb-out.`);
      }
    }
    // flying on an MEL C placard: the board says so (the placard's last week, and what comes after it). Past it the plane
    // is grounded; the only guest plane's guests then fly in on the mainland sub-charter
    const ml = cap > 0 ? melOn(s, p.id, W) : undefined;
    if (ml) {
      const after = soleGuestPlane(s, p) ? subCharterNeed(s, p.id, 'clear', ml.mel!.until + 1) : null;
      const subWords = after ? `: a mainland sub-charter flies the guests at ${subCharterWords(after)}` : '';
      const placard = `${p.name} flew with ${shortText(s, ml)} placarded INOP (MEL C, to week ${ml.mel!.until}${ml.mel!.ext ? ', extended' : ''}`;
      // the review is read next week: in the placard's last week, say what happens from then, not "by then"
      line('mech', 'info', ml.mel!.until > W ? `${placard}). Fix it by then, or it is grounded${subWords}.` : `${placard}: its last week). From week ${W + 1} it stays on the ground until it's fixed${subWords}.`);
    }
    flown += cap;
    if (MODELS[p.model].cargo) cargoFlights += cap;
    else {
      passenger += cap;
      guestSlots.push({ plane: p, n: cap });
    }
    p.sinceInspection = (p.sinceInspection ?? 0) + cap;
    if ((p.sinceInspection ?? 0) > ECON.planeInspectionFlights + 2) {
      p.health -= 6;
      line('mech', 'bad', `${p.name}: 100-hr inspection overdue (−6).`);
    }
    p.health -= cap * ECON.flightWear;
  }

  staffAfterFlights(s, capped, r, W, line);

  // 3. receiving (9.4): the POs due this week whose carrier ran, the AOG boat's, and held ones released; then the allocation.
  // The part chain's own part keeps its rules: on the AOG boat (paid on the PO), in a guest flight's hold from the week it
  // ships (freight 'flight'), or on a cargo flight (it rides first). Nothing carried it: a boat, at a price
  // the sub-charter's flights come from the mainland too: a box rides in the hold as it would on a guest flight
  const guestFlights = passenger + subFlights;
  const carry = hasCargo(s) ? cargoFlights * ECON.partsPerCargoFlight : guestFlights;
  const ch = openChain(s);
  const due = !!ch && ch.step === 'transit' && ch.hold === undefined && (ch.freight !== 'flight' || (ch.ship ?? 0) <= W);
  const aogBoat = due && ch!.freight === 'boat';
  let chainPart = aogBoat;
  if (due && !aogBoat && (ch!.freight === 'flight' ? guestFlights > 0 : carry > 0)) chainPart = true;
  const onPlane = ch ? (s.assets.find((a) => a.id === ch.assetId)?.name ?? 'the plane') : '';
  if (aogBoat) line('mech', 'info', `The AOG boat brought the ${ch!.item} for ${onPlane}.`);
  else if (due && !chainPart) {
    // nothing carried it: a mainland boat brings the AOG part, at a price
    s.cash -= ECON.boatKit;
    ch!.spent += ECON.boatKit;
    book(s, 'freight', ECON.boatKit, { trade: 'mech', asset: ch!.assetId });
    chainPart = true;
    const carrier = ch!.freight === 'flight' ? 'guest' : hasCargo(s) ? 'cargo' : 'guest';
    line('mech', 'bad', `No ${carrier} flights carried the part: a mainland boat brought the ${ch!.item} (${usd(ECON.boatKit)}).`);
  }
  const receivedBefore = (s.pos ?? []).filter((p) => p.got === W).length;
  const readied = receive(s, W, { guest: guestFlights, cargo: cargoFlights }, line, (o, ata, tag, pn) => {
    const asset = s.assets.find((a) => a.id === o.assetId)!;
    return judgeSlot(s, asset, ata, tag, pn);
  });
  const delivered = (s.pos ?? []).filter((p) => p.got === W).length - receivedBefore;
  for (const o of readied) {
    line(o.role, 'good', `Parts for ${o.title}${assetOf(s, o) ? ` on ${assetOf(s, o)!.name}` : ''} are in: ${nameOfRole(s, o.role)}, your move.`);
    // waiting on parts isn't a deferral (8.2): its clock runs again from next week, when the tech can do it
    o.lastDeferredWeek = W;
  }
  // a part the IPC doesn't list for an altered assembly came back at receiving: the research branch opens
  for (const o of s.orders.filter((x) => x.flow?.stopResearch && !x.flow.research && open(x))) {
    const al = alertOf(s, o);
    const task = al ? planTask(s, al, o.flow!.task) : undefined;
    if (!al || !task) continue;
    delete o.flow!.stop;
    delete o.flow!.stopResearch;
    openResearch(s, o, al, task, nameOfRole(s, 'mech'), now);
  }

  // 4. power
  const pw = powered(s);
  const g = grid(s);
  if (pw.gridDown) line('elec', 'bad', `Grid down (reliability ${Math.round(g?.health ?? 0)}): ${pw.genOK ? 'generator carried the houses' : 'houses dark, hangar tools offline'}.`);
  // the ground power carts charge in the hangar while it has power (grid up, or the generator carrying)
  const powerCost = chargeCarts(s, pw.on, line);

  // 5. houses + guests
  const hs = houses(s);
  const rentable = hs.filter((h) => houseRentable(s, h, W)).sort((a, b) => b.health - a.health);
  for (const h of hs) {
    const why = houseBlocker(s, h, W);
    const hz = why === 'hazard' ? hazardOn(s, h.id) : undefined;
    if (hz) line('elec', 'bad', `${h.name} closed: ${shortText(s, hz)} (make it safe or fix it).`);
    else if (why && pw.on) line('elec', 'bad', `${h.name} unrentable: ${why}.`);
  }
  const ferry = td.ferry;
  const arrivals = passenger + subFlights + ferry;
  // the seats that could have come in: the sub-charter flies only the guests the housekeepers can take, so its
  // schedule (not its flights) is what the empty-house lines weigh
  const seats = passenger + (sub?.cap ?? 0) + ferry;
  // the housekeepers turn over what they can (D: housekeepingCap)
  const turnovers = housekeepingCap(s);
  const booked = rentable.slice(0, Math.min(arrivals, turnovers));
  if (Math.min(rentable.length, seats) > turnovers) {
    const empty = Math.min(rentable.length, seats) - turnovers;
    line('fin', 'bad', `${empty} house${empty > 1 ? 's' : ''} empty: housekeeping turns over ${turnovers} a week. ${hireComing(s, 'housekeeper', W) ?? 'Hire a housekeeper?'}`);
  }
  if (rentable.length > seats) {
    const clearSky =
      planes(s)
        .filter((p) => !MODELS[p.model].cargo)
        .reduce((n, p) => n + capOf(s, p, 'clear'), 0) + (sub ? subCharterNeed(s, sub.plane.id, 'clear', W)!.cap : 0);
    const weatherOnly = rentable.length <= clearSky + ferry;
    line(
      weatherOnly ? 'all' : 'mech',
      weatherOnly ? 'info' : 'bad',
      `${rentable.length - seats} house${rentable.length - seats > 1 ? 's' : ''} empty: only ${passenger} guest flights${sub ? ` + ${subFlights} sub-charter` : ''}${ferry ? ` + ${ferry} ferry` : ''}${weatherOnly ? ` (${s.weather})` : ''}.`,
    );
  }
  // the wedding wanted every house
  if (s.modifiers.some((m) => m.label === 'Wedding party' && m.until === W)) {
    const short = hs.length - rentable.length;
    if (short > 0) {
      s.cash -= 1000 * short;
      line('elec', 'bad', `Wedding party: ${short} house${short > 1 ? 's' : ''} not ready, −$${(1000 * short).toLocaleString('en-US')}.`);
    }
  }
  const occ = clamp(occupancy(s, s.rates.nightly, W) * reviewMult(s, booked.length), 0, 1);
  let rental = 0;
  let refunds = 0;
  const bookedRevenue = new Map<string, number>();
  for (const h of booked) {
    // a house made safe (a circuit off and tagged, a blank-off) rents at 75% until the fix
    const factor = rentFactor(s, h);
    if (factor < 1) line('elec', 'info', `${h.name} rented at ${Math.round(factor * 100)}%: ${hazardOn(s, h.id)?.safe?.how === 'blankoff' ? 'a blank-off is on' : 'a circuit is off and tagged'} until the fix.`);
    const rev = 7 * s.rates.nightly * (MODELS[h.model].mult ?? 1) * occ * factor * r.range(0.92, 1.08);
    rental += rev;
    bookedRevenue.set(h.id, rev);
    if (h.health < 60 && r.chance(ECON.outageChance)) {
      refunds += rev * 0.5;
      nearMisses++;
      line('elec', 'bad', `Outage at ${h.name}: guests refunded half (${usd(rev * 0.5)}).`);
    }
    h.health -= houseWearOf(s);
  }
  for (const h of hs) {
    // red-tagged = de-energised: no fire; a house closed for its renovation has nobody in it and nothing in service
    // (review round 1: a worn house the analyst had just paid to renovate caught fire under the builders)
    if (isTagged(s, h.id) || renovating(s, h.id)) continue;
    if (W >= 3 && h.health < 30 && r.chance(ECON.fireChance)) {
      const cost = 1500 + 500 * s.tier;
      incidents.push({ kind: 'fire', role: 'elec', assetId: h.id, title: `Electrical fire at ${h.name}`, cost });
      h.health -= 15;
      line('elec', 'bad', `Electrical fire at ${h.name} (reliability under 30).`);
    }
  }

  // 6. charter: spare passenger flights sell day tours (twin first to guests)
  let guestNeed = Math.max(0, booked.length - ferry - subFlights);
  let charter = 0;
  const load = charterLoad(s, s.rates.charter, W) * charterMult(s);
  for (const slot of guestSlots.sort((a, b) => (MODELS[a.plane.model].mult ?? 1) - (MODELS[b.plane.model].mult ?? 1))) {
    const used = Math.min(guestNeed, slot.n);
    guestNeed -= used;
    const spare = slot.n - used;
    // no signed load sheet, no charter: half the tours stay on the ramp
    const sheet = s.orders.find((o) => o.kind === 'wb' && o.assetId === slot.plane.id && o.result?.week === W);
    const dispatch = sheet ? 0.5 + 0.5 * Math.min(1, sheet.result!.credit) : 0.5;
    if (spare > 0 && !sheet) line('mech', 'bad', `No load sheet for ${slot.plane.name}: half its charters stayed on the ramp.`);
    charter += spare * s.rates.charter * (MODELS[slot.plane.model].mult ?? 1) * load * dispatch * r.range(0.9, 1.1);
  }

  // 7. deferral risk: orders carried from an earlier week roll now
  for (const o of s.orders) {
    if (W < 3) break; // week-0 promise: nothing can fail until week 3
    if (!open(o) || o.role === 'fin' || o.gain === 0 || o.deferrals < 1 || (o.lastDeferredWeek ?? W) >= W) continue;
    if (o.assetId && outOfService(s, o.assetId)) continue; // out of service (grounded, red-tagged, AOG for a part): it can't fail in service
    if (o.status === 'waiting_part') continue; // approved and waiting on logistics: not a deferral
    const p = deferralRisk(o);
    if (r.chance(p)) {
      const asset = assetOf(s, o);
      // a redo is free to do but not free to fail: it costs what the original job did
      const cost = ECON.deferral.costMult * (o.redo?.cost ?? o.cost);
      incidents.push({ kind: 'deferral', role: o.role, assetId: o.assetId, title: `${o.title}${asset ? ` on ${asset.name}` : ''}`, cost });
      if (asset) {
        asset.health -= ECON.deferral.healthHit;
        const rev = bookedRevenue.get(asset.id);
        if (rev) {
          refunds += rev * 0.5;
          line('elec', 'bad', `Guests at ${asset.name} refunded half after the incident.`);
        }
      }
      // a redo is already paid for: carrying it is the trade's call, not the analyst's
      const who: ReportLine['role'] = o.redo || (o.deferReason === 'open' && o.approvedWeek !== undefined) ? o.role : 'fin';
      line(who, 'bad', `Incident: ${o.title}${asset ? ` on ${asset.name}` : ''} (carried ${o.deferrals} wk, ${Math.round(p * 100)}% risk).`);
    }
  }

  // 7. (the job flow) an alert nobody planned, past its due week, rolls the deferral risk a carried order would (5.5):
  // 3 x the labour of its true kind, on its trade. An airworthiness alert on a plane doesn't roll: it grounds the plane instead
  for (const al of liveAlerts(s)) {
    if (W < 3) break;
    if (al.status !== 'open' || al.due >= W || al.cause < 0 || al.kind === 'nff') continue;
    const asset = s.assets.find((x) => x.id === al.assetId);
    if (!asset || outOfService(s, asset.id)) continue;
    if (asset.kind === 'plane' && alertFlags(s, al).aw) continue;
    const kind = al.kind === 'wiring' ? (symptomOf(al)?.causes.find((c) => c.kind !== 'wiring')?.kind ?? 'avionics') : al.kind;
    const tier = al.repair ? al.repair.defect.tier : orderTier(kind, asset, s.tier);
    const p = deferralRisk({ tier, deferrals: W - al.due });
    if (!r.chance(p)) continue;
    const labour = unplannedLabour(s, al, asset, kind, tier);
    const cost = ECON.deferral.costMult * labour;
    const what = shortText(s, al);
    incidents.push({ kind: 'deferral', role: al.role, assetId: asset.id, title: `${what.charAt(0).toUpperCase()}${what.slice(1)} on ${asset.name}`, cost });
    asset.health -= ECON.deferral.healthHit;
    const rev = bookedRevenue.get(asset.id);
    if (rev) {
      refunds += rev * 0.5;
      line('elec', 'bad', `Guests at ${asset.name} refunded half after the incident.`);
    }
    line(al.role, 'bad', `Incident: ${what} on ${asset.name} (nobody planned it, ${W - al.due} wk past due, ${Math.round(p * 100)}% risk).`);
  }

  // 7b. hidden defects surface: a job signed off badly fails in service, and the review traces it. The job flow's own
  // (a wrong task, an NFF close, a make-safe that didn't isolate) bring the fault back instead of a repair
  const surfaced: { d: Defect; inc: Incident }[] = [];
  const back: Defect[] = [];
  if (s.defects?.length) {
    const keep: Defect[] = [];
    for (const d of s.defects) {
      if (d.report || d.dueWeek > W) {
        keep.push(d);
        continue;
      }
      const asset = s.assets.find((a) => a.id === d.assetId);
      if (!asset) continue;
      // out of service can't fail in service (it waits a week), and nothing fails before week 3
      if (outOfService(s, asset.id) || W < 3) {
        d.dueWeek = Math.max(W + 1, 3);
        keep.push(d);
        continue;
      }
      // an NFF close on a real fault: written up again, no incident
      if (d.puzzle === 'flow' && d.variant === 'nff') {
        back.push(d);
        continue;
      }
      const rule = defectRule(d.puzzle, d.role, d.rule ?? d.orderKind, d.variant);
      const sev = d.severity - 1;
      const cost = round10(Math.max(d.cost, DEFECT.minBase) * DEFECT.incidentMult[d.puzzle === 'flow' ? 0 : sev]);
      const what = flowWords(incidentText(rule, d.puzzle === 'flow' ? 1 : d.severity, asset.name), d);
      const traced = tracedTo(d);
      const inc: Incident = { kind: 'defect', role: d.role, assetId: asset.id, title: what, cost, from: { title: d.title, name: d.name, week: d.week, traced, redo: d.redo } };
      incidents.push(inc);
      asset.health -= DEFECT.healthHit[d.puzzle === 'flow' ? 0 : sev];
      line(d.role, 'bad', `${what}. Traced to ${traced}.`);
      const rev = bookedRevenue.get(asset.id);
      if (rev) {
        refunds += rev * 0.5;
        line('elec', 'bad', `Guests at ${asset.name} refunded half after the incident.`);
      }
      if (d.puzzle === 'flow' || (d.puzzle === 'elec' && d.variant === 'isolation')) back.push(d);
      else surfaced.push({ d, inc });
    }
    s.defects = keep;
  }
  // a defect an inspection found, not yet repaired and still in service: a near-miss (ground it or red-tag it)
  const known = new Set<string>();
  for (const o of s.orders) {
    if (o.kind !== 'repair' || !open(o) || o.repair?.via !== 'inspection' || !o.assetId || known.has(o.assetId) || outOfService(s, o.assetId)) continue;
    const asset = assetOf(s, o);
    if (!asset) continue;
    known.add(asset.id);
    nearMisses++;
    line(o.role, 'bad', `${asset.name} ${asset.kind === 'plane' ? 'flew' : 'stayed in service'} with a known defect (${o.repair.problem}): a near-miss on the safety grade.`);
  }
  for (const al of liveAlerts(s)) {
    if (al.repair?.via !== 'inspection' || known.has(al.assetId) || outOfService(s, al.assetId) || al.order) continue;
    const asset = s.assets.find((x) => x.id === al.assetId);
    if (!asset) continue;
    known.add(asset.id);
    nearMisses++;
    line(al.role, 'bad', `${asset.name} ${asset.kind === 'plane' ? 'flew' : 'stayed in service'} with a known defect (${al.repair.problem}): a near-miss on the safety grade.`);
  }
  // this week's inspection finds: caught before they failed
  for (const o of s.orders) {
    const rp = o.repair;
    if (rp?.via !== 'inspection' || o.createdWeek !== W || o.flow) continue;
    const asset = assetOf(s, o);
    line(o.role, 'good', `${rp.foundBy}'s ${rp.foundIn}${asset ? ` on ${asset.name}` : ''} found ${rp.problem}, left from week ${rp.defect.week}: caught before it failed.`);
  }
  for (const al of s.alerts ?? []) {
    // (planned and done at once by autopilot or a crewmate, it was still caught)
    const rp = al.repair;
    if (rp?.via !== 'inspection' || al.week !== W) continue;
    const asset = s.assets.find((x) => x.id === al.assetId);
    line(al.role, 'good', `${rp.foundBy}'s ${rp.foundIn}${asset ? ` on ${asset.name}` : ''} found ${rp.problem}, left from week ${rp.defect.week}: caught before it failed.`);
  }

  // 8. carry-over
  let waiting = 0;
  for (const o of s.orders) {
    if (!open(o)) continue;
    if (o.kind === 'project') continue; // crew projects wait for the crew
    if (o.flow && o.status === 'waiting_part') waiting++;
    if ((o.role === 'fin' || o.gain === 0) && o.kind !== 'report' && !o.chain && !o.bench && !o.flow) {
      o.status = 'cancelled'; // desk tasks and load sheets are for this week only
      continue;
    }
    // a flow job waiting on its parts isn't being put off: logistics, not a deferral (its clock starts when it's ready).
    // Nor is one planned ahead of its alert's due week: it's on schedule, and its clock starts at the due week, as an
    // unplanned alert's does (step 7), so planning early never costs more than leaving the alert open
    if (o.lastDeferredWeek !== W && !(o.flow && o.status === 'waiting_part') && !onSchedule(s, o, W)) {
      o.deferrals += 1;
      o.lastDeferredWeek = W;
      o.deferReason = 'open';
    }
    if (o.status === 'countered') {
      o.status = 'pending';
      o.counter = undefined;
    }
  }
  // prune old closed orders
  const projectIds = new Set(Object.values(s.project?.orders ?? {}));
  s.orders = s.orders.filter((o) => open(o) || projectIds.has(o.id) || (o.result?.week ?? o.createdWeek) >= W - 1);
  bookWait(s, waiting);
  // a surfaced defect goes to its trade as a repair alert (planned like any alert), after the carry-over so it starts fresh
  for (const { d, inc } of surfaced) {
    const asset = s.assets.find((a) => a.id === d.assetId);
    if (!asset || d.role === 'fin') continue;
    const rule = defectRule(d.puzzle, d.role, d.rule ?? d.orderKind, d.variant);
    inc.from!.repairId = raiseAlert(s, { role: d.role, asset, repair: { defect: d, via: 'incident', problem: rule.found, incident: inc.title }, src: 'again', due: W + 1, week: W + 1 }, now).id;
  }
  // the job flow's comebacks: the same fault, written up again, due next week
  for (const d of back) reraise(s, d, 'again', now);
  pruneAlerts(s);
  prunePurchasing(s, W);
  // the part chain: another week on the ground (and what that cost), then receiving and engineering's answer (new steps start fresh too)
  if (ch && !ch.flow) {
    ch.aogWeeks += 1;
    ch.downtime = (ch.downtime ?? 0) + downtimeOf(s, ch.assetId).usd;
  }
  resolveChain(s, W, chainPart, now, line);
  if (s.chain?.step === 'done' && s.chain.closedWeek === W && s.chain.story) line('all', 'good', `Back in service: ${s.chain.story}`);
  openQueuedResearch(s, now);

  // 9. decay + storm
  const shield = s.modifiers.some((m) => m.kind === 'stormShield' && m.until >= W) ? 0.5 : 1;
  // A0 (from tier 4): a maintained asset wears slower, and a house dark all week (grid down, no generator) not at all
  for (const a of s.assets) {
    // (G0: a house closed for its renovation doesn't decay; the builders are on it)
    if (a.touchedWeek < W && !renovating(s, a.id)) a.health -= decayOf(s, a, !pw.on);
    if (s.weather === 'storm') {
      if (a.kind === 'house') a.health -= STORM_HIT.house * shield;
      if (a.kind === 'grid') a.health -= STORM_HIT.grid * shield;
    }
    a.health = clamp(Math.round(a.health * 10) / 10, 0, 100);
  }
  if (s.weather === 'storm') line('elec', 'bad', `Storm damage: houses −${STORM_HIT.house * shield}, grid −${STORM_HIT.grid * shield}.`);
  // weather claims: roof, dock and hangar-door damage that no maintenance prevents (this is what insurance is for)
  let weatherCost = 0;
  if (W < 3) weatherCost = 0;
  else if (s.weather === 'storm' && r.chance(0.6)) weatherCost = Math.round((1500 + 1000 * Math.max(0, s.tier - 2)) * shield);
  else if (s.weather === 'wind' && s.tier >= 2 && r.chance(0.15)) weatherCost = 600 + 200 * s.tier;

  // 10. analyst money hunts: close / bank rec / invoice match recover a hidden leak. The three-way match on real POs
  // withholds what it found from those POs' payment (their `over` is paid at step 11's payment run, less `caught`)
  let leak = 0;
  let found = 0;
  let foundCash = 0;
  for (const t of s.orders.filter((o) => o.role === 'fin' && o.kind !== 'report' && o.leak && o.createdWeek === W)) {
    const got = t.result ? (t.leak ?? 0) * t.result.score : 0;
    const onPos = t.kind === 'invoice' ? (s.pos ?? []).filter((p) => p.status === 'received' && (p.over ?? 0) > 0 && p.got === W - 1) : [];
    if (onPos.length) {
      const over = onPos.reduce((n, p) => n + (p.over ?? 0), 0);
      let left = Math.round(got);
      onPos.forEach((p, i) => {
        const c = i === onPos.length - 1 ? left : Math.round((got * (p.over ?? 0)) / Math.max(1, over));
        p.caught = Math.max(0, Math.min(p.over ?? 0, c, left));
        left -= p.caught;
      });
    } else {
      leak += t.leak ?? 0;
      foundCash += got;
    }
    found += got;
    const what = t.kind === 'invoice' ? 'vendor overbilling' : t.kind === 'reconcile' ? 'unreconciled cash' : 'budget leakage';
    line('fin', got >= (t.leak ?? 0) * 0.95 ? 'good' : 'bad', got > 0 ? `${t.title}: recovered ${usd(got)} of ${usd(t.leak ?? 0)} ${what}.` : `${t.title} skipped: ${usd(t.leak ?? 0)} ${what} lost.`);
  }
  const leakCost = Math.round(leak - foundCash);

  // 10b. open cross-trade reports: a leak costs cash every week; a cap slowed the reporter down
  let reportLeak = 0;
  for (const o of openReports(s)) {
    const rep = o.report!;
    const who = s.players[rep.by]?.name ?? ROLE_LABEL[rep.by];
    if (rep.effect === 'leak') {
      // a leak that came back also owes the weeks it only looked fixed (the overbilling was never reversed)
      const owed = rep.owed ?? 0;
      reportLeak += rep.amount + owed;
      line(
        o.role,
        'bad',
        `${o.title}: ${usd(rep.amount)} lost this week${owed ? `, plus ${usd(owed)} for the weeks it only looked fixed` : ''} (${rep.again ? 'back' : 'reported'} week ${o.createdWeek}).`,
      );
      delete rep.owed;
    } else if (rep.effect === 'gse') {
      const c = s.gse?.find((x) => x.id === rep.cart);
      line(o.role, 'bad', `${o.title}: still open, so ${c?.name ?? 'the GPU cart'} stayed tagged out (no ground power starts on it).`);
    } else {
      const lim = rep.by === 'fin' ? REPORT.capFin : REPORT.capOps;
      line(o.role, 'bad', `${o.title}: still open, so ${who} was held to ${lim} ${rep.by === 'fin' ? 'desk task' + (lim > 1 ? 's' : '') : 'jobs'}.`);
    }
  }

  // 11. cash: the tier's overhead and the staff's payroll (together today's fixed cost with the standard crew), the carrying
  // charge on stock, and the payment run for what was received at an earlier resolve (net 7)
  const revenue = Math.round(rental + charter - refunds);
  const overhead = td.overhead;
  const pay = payroll(s);
  const fixed = overhead + pay;
  const carried = carryCost(s);
  const paid = payRun(s, W, line);
  book(s, 'overhead', overhead, { trade: 'fin' });
  book(s, 'payroll', pay, { trade: 'fin' });
  if (carried) book(s, 'carry', carried, { trade: 'fin' });
  // the mainland sub-charter's flights this week, on the plane it stood in for, and on the side of the business that
  // kept it down (step 2: the analyst's approval, stock or carrier; else the mechanic's plan, chain or safety call)
  const subCost = sub ? sub.usd : 0;
  if (subCost) book(s, 'subcharter', subCost, { trade: subTrade, asset: sub!.plane.id });
  const premium = Math.round(INSURANCE[s.insurance].premium * (1 + 0.25 * (s.tier - 1)));
  const grossIncidents = incidents.reduce((n, i) => n + i.cost, 0) + weatherCost;
  const netIncidents = Math.round(grossIncidents * (1 - INSURANCE[s.insurance].cover));
  if (weatherCost) line('all', 'bad', `${s.weather === 'storm' ? 'Storm' : 'Wind'} claim: ${usd(weatherCost)} of roof and dock damage.`);
  if (grossIncidents) line('fin', 'info', `Claims ${usd(grossIncidents)}, insurance paid ${usd(grossIncidents - netIncidents)}.`);
  const cashStart = s.openCash;
  const beforeLoan = Math.round(s.cash + revenue - fixed - premium - leakCost - reportLeak - netIncidents - powerCost - carried - subCost);
  // the receiver's advances this week (the release gate: a financing inflow in the week's walk, with a bridge loan below)
  let financing = s.loan?.adv?.week === W ? s.loan.adv.usd : 0;
  // in receivership the receiver takes its payment only out of cash above $0 (review round 1): the loan never digs the hole deeper
  const loanDue = s.loan ? Math.min(s.loan.left, s.loan.weekly) : 0;
  const loanPay = s.receivership > 0 && RECEIVER.standstill ? Math.max(0, Math.min(loanDue, beforeLoan)) : loanDue;
  if (s.receivership > 0 && loanPay < loanDue) line('fin', 'info', `The receiver took ${usd(loanPay)} of the week's ${usd(loanDue)} loan payment: it comes only out of cash above $0 while the island is in receivership.`);
  s.cash = beforeLoan - loanPay;
  if (s.loan) {
    s.loan.left -= loanPay;
    if (s.loan.left <= 0) {
      s.loan = null;
      line('fin', 'good', 'Bridge loan repaid in full.');
    }
  }
  // 11b. replenishment (the analyst's standing policy: it runs whoever played), then the allocation
  replenish(s, W, line, now);
  for (const o of allocate(s)) line(o.role, 'good', `Parts for ${o.title}${assetOf(s, o) ? ` on ${assetOf(s, o)!.name}` : ''} are in: ${nameOfRole(s, o.role)}, your move.`);
  // 11c. the builders' week (D)
  buildWeek(s, r, W, line);

  // 12. forecasts
  for (const f of s.forecasts) {
    if (f.paid !== undefined) continue;
    if (W > f.week && W <= f.week + 4) f.actual.push(s.cash);
    if (f.actual.length === 4) {
      const err = f.points.reduce((n, p, i) => n + Math.abs(p - f.actual[i]) / Math.max(5000, Math.abs(f.actual[i])), 0) / 4;
      const bonus = err <= 0.1 ? Math.round((800 + 6000 * (0.1 - err)) * (1 + 0.25 * (s.tier - 1))) : 0;
      f.paid = bonus;
      s.cash += bonus;
      line('fin', bonus ? 'good' : 'info', bonus ? `Forecast from week ${f.week} landed within ${Math.round(err * 100)}%: +${usd(bonus)}.` : `Forecast from week ${f.week} missed by ${Math.round(err * 100)}%.`);
    }
  }
  s.forecasts = s.forecasts.filter((f) => f.paid === undefined || f.week >= W - 6);

  // 13. grade
  const budget = td.budget;
  const revPct = revenue / budget;
  const gRev: Grade = revPct >= 1 ? 'A' : revPct >= 0.85 ? 'B' : revPct >= 0.7 ? 'C' : 'D';
  const flPct = scheduled ? flown / scheduled : 1;
  const gFl: Grade = flPct >= 1 ? 'A' : flPct >= 0.75 ? 'B' : flPct >= 0.5 ? 'C' : 'D';
  const gSafe: Grade = incidents.length === 0 ? (nearMisses === 0 ? 'A' : 'B') : incidents.length === 1 ? 'C' : 'D';
  const weighted = 0.4 * GRADE_VALUE[gRev] + 0.3 * GRADE_VALUE[gFl] + 0.3 * GRADE_VALUE[gSafe];
  let grade = letter(weighted);
  if (s.receivership > 0) grade = worst(grade, 'C');
  if (W === 1 && GRADE_VALUE[grade] < 3) grade = 'B'; // first week: guaranteed B or better
  const perfectWeek = gRev === 'A' && gFl === 'A' && gSafe === 'A';

  // 14. stats + receivership
  // Autopilot weeks never lose progress, but they don't count toward unlocks
  // or the credits: nobody wins alone.
  const fullTeam = autoRunRoles.length === 0;
  // the week was played in receivership (set at the resolve before; this one may end it): the week's report says so
  const playedInRecv = s.receivership > 0;
  const st = s.stats;
  st.totalWeeks += 1;
  if (GRADE_VALUE[grade] >= 3 && fullTeam) {
    st.weeksBPlus += 1;
    st.streakBPlus += 1;
  } else st.streakBPlus = 0;
  if (perfectWeek && fullTeam) st.perfectWeeks += 1;
  // the credits' streak (A0 f, review round 1): only weeks played at the Resort count; an autopilot week graded A
  // pauses it (and says so), a lower grade ends it; the credits land on a full-crew week
  st.aStreak = aStreakAfter(s, W, grade, fullTeam);
  // a streak carried from an older engine ends like any other: from then on only the Resort's weeks count
  if (!st.aStreak && st.aCarry !== undefined) delete st.aCarry;
  if (GOAL.rule === 'quarter') {
    // the credits (G0, one data switch): the Resort's two months on plan, read from the week reports (goalWindow), Resort
    // weeks only, landing on a full-crew week
    const win = goalWindow(s, { week: W, grade, revenue, budget, autoRun: autoRunRoles, ...(playedInRecv ? { rcv: true } : {}) });
    if (!s.creditsWeek && pausedWeek(s, { week: W, grade, autoRun: autoRunRoles, rcv: playedInRecv || undefined }))
      line(
        'all',
        'info',
        `A week on plan with autopilot covering ${autoRunRoles.map((r) => nameOfRole(s, r)).join(' and ')} doesn't count toward the two months on plan: ${win.length} of ${GOAL.weeks} weeks counted.`,
      );
    if (atResort(s, W) && fullTeam && !playedInRecv && goalMet(win) && !s.creditsWeek) {
      s.creditsWeek = W;
      line('all', 'good', `Two months on plan at the Resort: ${GOAL.need} of ${GOAL.weeks} weeks at ${GOAL.minGrade} or better, revenue at ${Math.round(GOAL.revShare * 100)}% of budget or more. You beat Island Company!`);
    }
  } else {
    if (!s.creditsWeek && pausedWeek(s, { week: W, grade, autoRun: autoRunRoles }))
      line(
        'all',
        'info',
        `An A with autopilot covering ${autoRunRoles.map((r) => nameOfRole(s, r)).join(' and ')} doesn't count toward the eight${st.aStreak ? `: the streak holds at ${st.aStreak}/8` : ''}.`,
      );
    if (atResort(s, W) && fullTeam && (st.aStreak ?? 0) >= 8 && !s.creditsWeek) {
      s.creditsWeek = W;
      line('all', 'good', 'Eight full-crew A weeks at the Resort, none below A. You beat Island Company!');
    }
  }
  st.recentIncidents = [...st.recentIncidents, incidents.length].slice(-4);
  st.negCashStreak = s.cash < 0 ? st.negCashStreak + 1 : 0;
  if (s.receivership > 0) {
    s.receivership -= 1;
    if (s.receivership === 0 && s.cash < 0) s.receivership = 1;
    if (s.receivership === 0) line('fin', 'good', 'Out of receivership.');
    // insolvent: say so to the whole crew in plain numbers (review round 1: silent weeks at $0 locked everyone out;
    // the release gate: the week's burn against the allowance and the loan, not a promise of a way out)
    else if (s.cash < 0)
      line(
        'all',
        'bad',
        `Receivership, cash −${usd(-s.cash)}: revenue ${usd(revenue)} this week against ${usd(fixed)} of overhead and payroll. The receiver funds safety-critical work up to ${usd(RECEIVER.allowance)} a week onto the bridge loan (${Math.round(RECEIVER.rate * 100)}% fee; ${s.loan ? `${usd(s.loan.left)} owed` : 'nothing owed'}) and takes its payment only out of cash above $0. It ends when cash is back above $0.`,
      );
  } else if (st.negCashStreak >= 2) {
    s.receivership = 3;
    line('fin', 'bad', 'Cash below zero 2 weeks running: the island enters receivership (3 weeks).');
    // the receiver's bridge loan: clears the deficit plus two weeks of running costs, repaid at 15% over 10 weeks. A
    // second receivership gets one too, on top of what's still owed (the release gate: with a balance left it used to
    // start below $0 with only the weekly allowance)
    const amount = Math.round((Math.max(0, -s.cash) + 2 * fixedNow(s) + 3000) / 100) * 100;
    const owed = s.loan?.left ?? 0;
    s.cash += amount;
    financing += amount;
    if (!s.loan) s.loan = { left: Math.round(amount * 1.15), weekly: Math.round((amount * 1.15) / 10) };
    else {
      s.loan.left += Math.round(amount * 1.15);
      s.loan.weekly = Math.max(s.loan.weekly, Math.ceil(s.loan.left / 10));
    }
    line('fin', 'info', `The receiver advanced a ${usd(amount)} bridge loan${owed ? ` on top of the ${usd(owed)} still owed` : ''}: ${usd(s.loan.weekly)}/week for 10 weeks.`);
  }

  // 15. XP for the grade, A bonus
  const gradeXp = grade === 'A' ? 100 : grade === 'B' ? 50 : 0;
  if (gradeXp) for (const role of ROLES) gainXp(s, role, gradeXp);
  if (s.pendingBonus) {
    // nobody allocated last week's bonus: bank it rather than lose it
    s.cash += s.pendingBonus;
    line('fin', 'info', `Unallocated A-grade bonus: ${usd(s.pendingBonus)} went to reserve.`);
  }
  s.pendingBonus = grade === 'A' ? Math.round(ECON.aGradeBonus * revenue) : null;

  // 16. tier up: qualifying opens a crew project; the tier arrives when all three finish their part
  const tierUp = Number(Object.entries(st.tierReachedWeek).find(([t, w]) => w === W && Number(t) > 1)?.[0]) || undefined;
  finishProjectIfDone(s, now);
  if (tierUnlocked(s) && !s.project) startProject(s);
  if (s.project) line('all', 'info', `Crew project open: ${s.project.title}.`);

  // 17. story card every 3-week B+ streak
  if (st.streakBPlus >= 3 && st.streakBPlus % 3 === 0 && !s.story) {
    const def = STORIES[hashSeed(s.seed, 'story', W) % STORIES.length];
    s.story = { id: def.id, week: W + 1, title: def.title, body: def.body, options: def.options.map((o) => ({ ...o, effect: storyEffect(s, def.id, o) })) };
  }

  // 17b. stage 2 (docs/EXPANSION.md 6.4, 6.5): this week's quick-check write-ups and flags, in the review. Blind: a line
  // never says whether a call was right (nothing is written for a week with none)
  for (const l of checkReviewLines(s, W)) line(l.role, l.tone, l.text);

  // 18. MVP lines
  const doneThisWeek = (role: Role) => s.orders.filter((o) => o.result?.week === W && o.result.by === role && !o.result.auto);
  // blind sign-offs never show a score, not even here
  const best = (role: Role) => doneThisWeek(role).filter((o) => !o.result!.blind).sort((a, b) => (b.result!.score ?? 0) - (a.result!.score ?? 0))[0];
  const signedOff = (role: Role) => {
    const n = doneThisWeek(role).filter((o) => o.result!.blind).length;
    return n ? ` · ${n} signed off` : '';
  };
  const bm = best('mech');
  const be = best('elec');
  const mvp: Record<Role, string> = {
    mech: `${flown}/${scheduled} flights${subFlights ? ` (+${subFlights} sub-charter)` : ''}${bm ? ` · best: ${bm.title} ${Math.round(bm.result!.score * 100)}%` : ''}${signedOff('mech')}`,
    elec: `${booked.length}/${hs.length} houses booked${be ? ` · best: ${be.title} ${Math.round(be.result!.score * 100)}%` : ''}${signedOff('elec')}`,
    fin: `Cash ${s.cash - cashStart >= 0 ? '+' : '−'}${usd(Math.abs(s.cash - cashStart))}${found ? ` · recovered ${usd(found)}` : ''}`,
  };

  const report: WeekReport = {
    week: W,
    tier: tierUp ? tierUp - 1 : s.tier,
    grade,
    components: { revenue: gRev, flights: gFl, safety: gSafe },
    weighted,
    revenue,
    budget,
    flightsFlown: flown,
    flightsScheduled: scheduled,
    incidents,
    nearMisses,
    cashStart,
    cashEnd: s.cash,
    costs: {
      fixed,
      insurance: premium,
      leak: leakCost,
      incidents: netIncidents,
      refunds: Math.round(refunds),
      loan: loanPay || undefined,
      reports: reportLeak || undefined,
      power: powerCost || undefined,
      overhead,
      payroll: pay,
      carry: carried || undefined,
      freight: paid.freight || undefined,
      labor: Math.round(s.ledger?.find((x) => x.w === W)?.sp.labor ?? 0) || undefined,
      parts: paid.parts || undefined,
      subCharter: subCost || undefined,
      financing: financing || undefined,
    },
    housesBooked: booked.length,
    housesRentable: rentable.length,
    partsDelivered: delivered,
    weather: s.weather,
    seed,
    lines,
    mvp,
    autoRun: autoRunRoles,
    tierUp,
    ...(playedInRecv ? { rcv: true as const } : {}),
  };
  s.history.push(report);
  // the week reports keep as many weeks as the ledger (every screen reads 12 at most): the doc budget (2.8)
  if (s.history.length > STOCK.ledgerWeeks) s.history.splice(0, s.history.length - STOCK.ledgerWeeks);
  feed(s, 'all', GRADE_VALUE[grade] >= 3 ? 'good' : 'bad', `Week ${W} resolved: ${grade}. Revenue ${usd(revenue)}, ${flown}/${scheduled} flights, ${incidents.length} incident${incidents.length === 1 ? '' : 's'}.`, now);

  // 19. the ledger's week closes (revenue, cash, inventory value), trimmed to 26 weeks
  closeLedger(s, W, revenue);
  openWeek(s, now);
}

// ---------------------------------------------------------------------------
// Forecast context for the analyst's puzzle

export function forecastContext(s: IslandState) {
  const hist = s.history.slice(-5).map((h) => h.cashEnd);
  const cashHistory = [...hist, s.cash].slice(-6);
  const nets = s.history.slice(-3).map((h) => h.cashEnd - h.cashStart);
  const td = tierDef(s.tier);
  const baseline = nets.length ? nets.reduce((a, b) => a + b, 0) / nets.length : td.budget * 0.85 - fixedNow(s) - 1400;
  const pending = s.orders.filter((o) => o.status === 'pending').reduce((n, o) => n + o.cost, 0);
  const projection: number[] = [];
  let c = s.cash;
  for (let i = 1; i <= 4; i++) {
    const seasonal = season(s.week + i, s.seed) / season(s.week, s.seed);
    c += baseline * seasonal - (i === 1 ? pending * 0.5 : 0);
    projection.push(Math.round(c / 10) * 10);
  }
  const hints: string[] = [];
  // the only guest plane down: the sub-charter is a weekly cost until it's back (fix round 1: the forecast says so)
  const sub = subCharterOn(s);
  if (sub && sub.usd > 0) hints.push(`Sub-charter −${usd(sub.usd)}/wk while ${sub.plane.name} is down`);
  if (pending) hints.push(`Pending approvals ${usd(pending)}`);
  const next = season(s.week + 2, s.seed) - season(s.week, s.seed);
  hints.push(next > 0.03 ? 'Season: bookings rising' : next < -0.03 ? 'Season: bookings easing' : 'Season: flat');
  if (tierDef(s.tier).storms) hints.push('Storm season: 1 in 5 weeks');
  return { cashHistory, projection, hints };
}
