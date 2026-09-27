// The island engine: a pure, deterministic reducer. Every client (and the
// balance sim) runs the same code, so any phone can resolve a week and get
// byte-identical results from the same inputs + seed.
import {
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
  GSE,
  incidentText,
  inspects,
  INSPECTS,
  INSURANCE,
  MODELS,
  PROJECTS,
  REPORT,
  REPORT_BY_KEY,
  REPORTS,
  ROLE_LABEL,
  STORIES,
  TIERS,
  type ReportDef,
} from './data';
import {
  cableBand,
  cableReport,
  capOf,
  charterLoad,
  clamp,
  isAog,
  isTagged,
  outOfService,
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
import type { Ata } from './aircraft';
import { hashSeed, rng, type Rng } from './rng';
import { nextDeadline } from './time';
import {
  ROLES,
  type Action,
  type Asset,
  type CableBand,
  type Defect,
  type FeedEvent,
  type GseCart,
  type Grade,
  type Incident,
  type IslandState,
  type OpsRole,
  type Order,
  type PartChain,
  type Player,
  type ReportLine,
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
export const ENGINE_VERSION = 2;

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
    parts: { stock: ECON.startParts, inTransit: 0 },
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
  addTierAssets(s, p.tier, s.week, Math.round(60 + 30 * quality));
  s.project = null;
  feed(s, 'all', 'good', `Tier ${p.tier} unlocked: ${tierDef(p.tier).name}! Built together at ${Math.round(quality * 100)}% quality.`, now);
  s.gse = gseCarts(s);
  for (const c of s.gse) if (!had.has(c.id)) feed(s, 'mech', 'good', `${c.name} arrived for the hangar: on the charger, full.`, now);
}

function addTierAssets(s: IslandState, tier: number, week: number, health = 80) {
  const fresh = week === 0;
  for (const a of TIERS[tier - 1].adds) {
    if (s.assets.some((x) => x.id === a.id)) continue;
    const kind = MODELS[a.model].kind;
    s.assets.push({
      id: a.id,
      kind,
      model: a.model,
      name: a.name,
      health: fresh ? ECON.startHealth : health,
      touchedWeek: week,
      ...(kind === 'house' ? { inspectionUntil: week + ECON.houseInspectionWeeks } : {}),
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

function markApproved(s: IslandState, o: Order, auto: boolean) {
  s.cash -= o.cost;
  o.approvedWeek = s.week;
  o.autoApproved = auto;
  o.pushedBack = false;
  o.counter = undefined;
  if (o.parts > 0) {
    if (s.parts.stock >= o.parts) {
      s.parts.stock -= o.parts;
      o.status = 'ready';
    } else o.status = 'waiting_part';
  } else o.status = 'ready';
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

export function apply(prev: IslandState, a: Action, now: number): ApplyResult {
  const fail = (error: string): ApplyResult => ({ s: prev, error });
  // written by a newer build: this one would lose what it doesn't know about
  if ((prev.engine ?? 0) > ENGINE_VERSION) return fail('This island was saved by a newer version of Island Company. Reload the app to keep playing.');
  const s = structuredClone(prev);
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
      const urgent = isEmergency(s, o);
      // a part chain's part: the AOG boat goes on the PO when it takes one
      const cost = chainCardCost(s, o, a.ship);
      if (s.cash < ECON.freezeBelow && !urgent) return fail(`Cash under ${usd(ECON.freezeBelow)}: only safety-critical work can be approved.`);
      if (s.cash - cost < 0) return fail('Not enough cash.');
      if (s.receivership > 0 && o.cost > 800 && !urgent) return fail('Receivership: the receiver blocks spend over $800 except safety-critical work.');
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
    case 'buyList': {
      const room = ECON.maxParts - s.parts.stock - s.parts.inTransit;
      if (room <= 0) return fail(`Parts capped at ${ECON.maxParts} (stock + in transit).`);
      const price = listPrice(s);
      if (s.cash < ECON.freezeBelow || s.cash - price < 0) return fail('Cash is frozen right now.');
      s.cash -= price;
      s.parts.inTransit += 1;
      feed(s, 'fin', 'info', `Bought a kit at list (${usd(price)}). Rides the next ${hasCargo(s) ? 'cargo' : 'guest'} flight.`, now);
      return { s };
    }
    case 'endTurn': {
      if (s.week < 1) return fail('The week has not started yet.');
      const t = (s.turns[a.role] ??= { ended: false, endedAt: null, done: 0 });
      if (t.ended) return { s: prev };
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
      const who = s.players[a.role]?.name ?? a.role;
      const o = addOps(s, c.kind, asset);
      o.squawk = who;
      s.squawked = { ...(s.squawked ?? {}), [a.role]: s.week };
      feed(s, a.role, 'info', `${who} wrote up ${o.title} on ${asset.name}${o.status === 'pending' ? ` (${usd(o.cost)}, waiting on the analyst)` : ''}.`, now);
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
    default:
      return fail('That move comes with the job flow update.');
  }
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
  const a = s.assets.find((x) => x.id === o.assetId);
  return !!a && a.health < 60;
}

/** petty-cash ceiling for auto-approvals: at most one week's fixed cost per role */
export const budgetCap = (s: IslandState) => Math.min(3000, tierDef(s.tier).fixed);

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

  // Blind sign-off (a real job at puzzle tier 2+): no verdict now. The true
  // score still drives everything; how good it was shows up later.
  const blind = !covered && isBlind(s, o, a.role);

  // the part chain's paperwork (IPC lookup, logbook research): what it hands in moves the chain on
  if (o.chain && o.chain.step !== 'job') return chainStep(s, o, a, player.name, covered, blind, turn, now);

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
  if (asset && o.gain > 0) {
    asset.health = clamp(asset.health + o.gain * landed, 0, 100);
    // a perfect job holds: that asset skips next week's decay too (blind: settled at resolve)
    asset.touchedWeek = Math.max(asset.touchedWeek, s.week + (a.perfect && !covered && !blind ? 1 : 0));
    // sign-off is pass/fail: a pass renews the inspection whatever the credit.
    // A blind sign-off is in the logbook whatever it missed (what it missed is a hidden defect).
    const signed = blind || a.score >= SIGNOFF;
    if (o.kind === 'inspect100' && signed) asset.sinceInspection = 0;
    if (o.kind === 'codeprep' && signed) asset.inspectionUntil = s.week + ECON.houseInspectionWeeks;
  }

  if (o.kind === 'report') {
    closeReport(s, o, a.role, player.name, a.score, now);
  } else if (o.kind === 'project') {
    // the floatplane auction is real capex: the winning deposit leaves the bank
    if (o.puzzle === 'auction' && Number(a.data?.kits ?? 0) > 0) s.cash -= Math.max(0, Number(a.data?.spent ?? 0));
    feed(s, o.role, blind ? 'info' : 'good', blind ? `${player.name} signed off their part: ${o.title}.` : `${player.name} finished their part: ${o.title} (${Math.round(a.score * 100)}%).`, now);
    finishProjectIfDone(s, now);
  } else if (o.kind === 'auction') {
    const room = Math.max(0, ECON.maxParts - s.parts.stock - s.parts.inTransit);
    const kitsWon = Math.max(0, Math.floor(Number(a.data?.kits ?? 0)));
    const spent = Math.max(0, Number(a.data?.spent ?? 0));
    const kits = Math.min(kitsWon, room);
    const paid = kitsWon > 0 ? Math.round((spent * kits) / kitsWon) : 0;
    s.parts.inTransit += kits;
    s.cash -= paid;
    feed(s, 'fin', kits ? 'good' : 'info', kits ? `Won ${kits} kit${kits > 1 ? 's' : ''} for ${usd(paid)}.` : 'Walked away from the auction.', now);
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

  // hidden consequences: a passed inspection finds what an earlier job left; this job may leave something
  if (asset && INSPECTS[o.kind] && a.score >= DEFECT.detectAt) detectDefects(s, o, asset, player.name, now);
  if (defectable(o)) rollDefect(s, o, a.role, player.name, a.score, defectVariant(o.puzzle, a.data));
  // a start through pitted plug contacts can arc into the plane's receptacle, however well it was done
  if (gpu.cart && asset && o.kind === 'gpustart') cableArc(s, o, asset, a.role, player.name, cableBefore);
  if (o.repair) spawnRedo(s, o, now);
  if (installing) closeChain(s, o, player.name, now);
  return { s };
}

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
export function tracedTo(d: Pick<Defect, 'orderKind' | 'title' | 'name' | 'week' | 'log'>) {
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
    const rep = addRepair(s, d, 'inspection', { foundBy: name, foundIn: what });
    feed(s, o.role, 'good', `${name}'s ${what} on ${asset.name} found ${rep.repair!.problem}, left from week ${d.week}. Repair written up: ${rep.title}. ${out}.`, now);
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
  c.bench = { ...c.bench!, call: undefined, again: true, id: benchOrder(s, c, true).id };
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
  // the job waits for the part until the chain is at the install
  if (c.step !== 'install' && job.status !== 'waiting_part') {
    job.status = 'waiting_part';
    fixed.push('job');
  }
  if (c.step === 'install' && job.status !== 'ready') {
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
      if (job) {
        job.status = 'ready';
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
    case 'inspector:book':
      s.cash -= 400;
      for (const h of houses(s)) h.inspectionUntil = W + ECON.houseInspectionWeeks;
      break;
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
      const add = Math.min(3, ECON.maxParts - s.parts.stock - s.parts.inTransit);
      s.cash -= 600;
      s.parts.stock += Math.max(0, add);
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

  generateOpsOrders(s, r);
  generateFinTasks(s, r);
  generateReports(s, now);
  autoApprove(s);
  // the part chain's orders as they should be (an older build may have cancelled a step's order)
  const ch = openChain(s);
  if (ch) healChain(s, ch, now);
  rollWeakBattery(s, now);

  s.deadline = nextDeadline(now, s.creatorTz, s.resolveHour);
  const wx = s.weather === 'clear' ? 'Clear skies' : s.weather === 'wind' ? 'Wind: flight risk up' : 'Storm: the electrician’s week';
  feed(s, 'all', s.weather === 'clear' ? 'info' : 'bad', `Week ${W} opens. ${wx}.`, now);
}

const kitOf = (kind: string) => CATALOG.find((c) => c.kind === kind)?.parts ?? 0;

function generateOpsOrders(s: IslandState, r: Rng) {
  const W = s.week;
  for (const role of OPS) {
    const openOrders = s.orders.filter((o) => o.role === role && open(o));
    // jobs stuck waiting for a kit don't count: the trade always has something it can do by hand
    const workable = openOrders.filter((o) => o.status !== 'waiting_part');
    const target = s.tier >= 3 ? 5 : 4;
    let openCount = workable.length;
    let slots = Math.max(0, Math.min(3, target - openCount));
    const cands: { kind: string; asset: Asset; w: number }[] = [];
    for (const asset of s.assets) {
      for (const c of CATALOG) {
        if (c.role !== role || !c.targets.includes(asset.model)) continue;
        if (openOrders.some((o) => o.kind === c.kind && o.assetId === asset.id)) continue;
        const w = c.weight(asset, W);
        if (w > 0) cands.push({ kind: c.kind, asset, w });
      }
    }
    // an asset in critical shape with nothing open on it always gets a job (the grid can't wait behind paperwork)
    for (const asset of s.assets) {
      if (asset.health >= 45 || workable.some((o) => o.assetId === asset.id)) continue;
      // prefer a fix that needs no kit when parts are stuck
      const fix = cands
        .filter((c) => c.asset.id === asset.id && c.w < 100)
        .sort((a, b) => kitOf(a.kind) - kitOf(b.kind) || b.w - a.w)[0];
      if (fix) fix.w = 100;
    }
    // must-do orders (inspections, critical repairs) jump the queue, capped at 8 open per role
    for (const m of cands.filter((c) => c.w >= 100)) {
      if (openCount >= 8) break;
      addOps(s, m.kind, m.asset);
      openCount++;
      slots = Math.max(0, slots - 1);
      cands.splice(cands.indexOf(m), 1);
    }
    while (slots > 0 && cands.length && openCount < 6) {
      const pick = r.weighted(cands, (c) => c.w * (1 + (100 - c.asset.health) / 40));
      if (!pick) break;
      addOps(s, pick.kind, pick.asset);
      openCount++;
      // spread work across assets: other jobs on the same asset get less likely
      cands.splice(cands.indexOf(pick), 1);
      for (const c of cands) if (c.asset.id === pick.asset.id) c.w *= 0.4;
      slots--;
    }
  }
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
  const lastWeekSpend = s.history.length ? spendIn(s, W - 1) : 0;
  if (lastWeekSpend >= 500) fin('invoice', round10(0.08 * lastWeekSpend + r.range(80, 220)));
  const room = ECON.maxParts - s.parts.stock - s.parts.inTransit;
  if (room > 0 && s.parts.stock + s.parts.inTransit < 4) fin('auction');
  if (W % 2 === 1 && W >= 3) fin('forecast');
}

function spendIn(s: IslandState, week: number) {
  return s.orders.filter((o) => o.approvedWeek === week).reduce((n, o) => n + o.cost, 0);
}

function autoApprove(s: IslandState) {
  for (const role of OPS) {
    const pend = s.orders
      // a part chain's cards are the analyst's call, never petty cash
      .filter((o) => o.role === role && o.status === 'pending' && !o.pushedBack && !o.chain)
      .sort((a, b) => urgency(s, b) - urgency(s, a));
    for (const o of pend) {
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
  if (role === 'fin') {
    const pend = s.orders
      .filter((o) => o.role !== 'fin' && o.status === 'pending')
      .sort((a, b) => urgency(s, b) - urgency(s, a));
    let n = 0;
    for (const o of pend) {
      if (n >= 2) break;
      // a grounded plane's part (or its engineering fee) goes through whenever the cash is there (the part on the AOG boat)
      if ((s.cash - o.cost >= ECON.autopilotFloor && s.receivership === 0) || (o.chain && s.cash - chainCardCost(s, o, 'boat') >= 0)) {
        markApproved(s, o, true);
        chainApproved(s, o, s.updatedAt, 'boat');
        n++;
      }
    }
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
      closeReport(s, report, 'fin', `Autopilot (${s.players.fin?.name ?? ROLE_LABEL.fin})`, 0.5, s.updatedAt);
    }
    return;
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
    benchDone(s, ch, { call: 'unit' }, `Autopilot (${s.players[role]?.name ?? ROLE_LABEL[role]})`, s.updatedAt);
  }
  // two jobs at 50%, plus a quick patch on a crewmate's cap report or a tagged-out cart's cable (it won't hold; a leak waits for a person).
  // A ground power start needs a charged cart when its turn comes (an earlier start may have used it up): autopilot
  // tows one over (off the charger, or off a plane that isn't flying), and puts it back on the charger after. No cart, no start
  const report = ready.find((o) => o.kind === 'report' && (o.report?.effect === 'cap' || o.report?.effect === 'gse'));
  let jobs = 0;
  for (const o of [...ready.filter((x) => x.kind !== 'report'), ...(report ? [report] : [])]) {
    if (o.kind !== 'report' && jobs >= 2) continue;
    const cart = needsCart(o.kind) ? autoCart(s, o) : null;
    if (needsCart(o.kind) && !cart) continue;
    // a job the part chain holds: the new unit made no difference (the fault is the wiring), and the electrician looks again
    const held = o.chain?.step === 'job' ? chainOf(s, o) : null;
    if (held && held.bench?.fault === 'wiring' && held.bench.call === 'unit' && !held.wired) {
      jobs++;
      missedWiring(s, held, o, `Autopilot (${s.players[role]?.name ?? ROLE_LABEL[role]})`, s.turns[role] ?? { ended: false, endedAt: null, done: 0 }, s.updatedAt);
      continue;
    }
    if (o.kind !== 'report') jobs++;
    const wear = cart && o.kind === 'gpustart' ? useCart(s, cart, o) : 0;
    if (cart && o.kind !== 'gpustart') {
      cart.charge = Math.max(0, cart.charge - GSE.avionicsDrain);
      cart.wear = Math.min(100, cart.wear + GSE.busWear);
    }
    o.status = 'done';
    o.result = { score: 0.5, perfect: false, credit: 0.5, by: role, week: s.week, auto: true };
    const asset = assetOf(s, o);
    if (cart && asset) {
      // the manual is kept, but a worn cable is a worn cable
      if (o.kind === 'gpustart') cableArc(s, o, asset, role, `Autopilot (${s.players[role]?.name ?? ROLE_LABEL[role]})`, wear);
      cart.hookedTo = null;
      cart.charging = true;
    }
    if (asset) {
      asset.health = clamp(asset.health + o.gain * 0.5, 0, 100);
      asset.touchedWeek = s.week;
    }
    // autopilot keeps to the manual (no hidden defects), but a 50% patch on a crewmate's report won't hold
    if (o.kind === 'report') closeReport(s, o, role, `Autopilot (${s.players[role]?.name ?? ROLE_LABEL[role]})`, 0.5, s.updatedAt);
    // a repair still needs its redo
    if (o.repair) spawnRedo(s, o, s.updatedAt);
    // the part is here: autopilot puts it on and finishes the job
    if (o.chain) closeChain(s, o, `Autopilot (${s.players[role]?.name ?? ROLE_LABEL[role]})`, s.updatedAt);
  }
  // a weak battery on the flight line: autopilot hooks a charged cart up to that plane for its first start
  if (role === 'mech') hookForFlightDay(s);
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
      autoRunRoles.push(role);
      if (p) p.missedStreak += 1;
      line(role, 'info', `${p?.name ?? role} was covered by autopilot (50%).`);
    } else if (p) p.missedStreak = 0;
  }
  // 1b. a part chain's card that came in after the analyst had ended the turn goes through on the standing
  // AOG approval (cash permitting): a plane shouldn't sit a week longer only because of the order the crew played in
  leftoverChainCard(s, line);

  // 2. flights
  let passenger = 0;
  let cargoFlights = 0;
  let flown = 0;
  let scheduled = 0;
  const perPlane = flightsPerPlane(s.tier);
  const guestSlots: { plane: Asset; n: number }[] = [];
  for (const p of planes(s)) {
    const grounded = isTagged(s, p.id);
    // waiting on a part (the part chain): not airworthy, no flights. Its flights were cancelled when it went
    // down, so they're off the schedule (the on-time grade judges the fleet that could fly)
    const aog = !grounded && isAog(s, p.id);
    // on-time is judged against what the weather allows, not against a clear sky
    if (!aog) scheduled += planeCapacity({ ...p, health: 100 }, s.tier, s.weather);
    const healthCap = grounded || aog ? 0 : planeCapacity(p, s.tier, 'clear');
    let cap = capOf(s, p);
    // a flight day on a weak battery: the first start is on the cart hooked up to it, or the first flight is lost
    if (cap > 0 && s.weakBattery?.week === W && s.weakBattery.assetId === p.id) cap -= flightDayStart(s, p, line);
    if (grounded) line('mech', 'info', `${p.name} grounded by the mechanic this week (safety call).`);
    else if (aog) line('mech', 'bad', `${p.name} AOG: grounded until the ${s.chain!.item} ${isAre(s.chain!.item)} ${s.chain!.wired ? 'fixed' : 'on'} (${perPlane} flight${perPlane > 1 ? 's' : ''} cancelled).`);
    else if (healthCap < perPlane)
      line('mech', 'bad', `${perPlane - healthCap} flight${perPlane - healthCap > 1 ? 's' : ''} lost on ${p.name}: airworthiness ${Math.round(p.health)}`);
    if (cap < healthCap) line('all', 'info', `${healthCap - cap} flight${healthCap - cap > 1 ? 's' : ''} lost on ${p.name}: ${s.weather}`);
    if (cap === 0 && healthCap === 0 && !grounded && !aog) line('mech', 'bad', `${p.name} is AOG (aircraft on ground).`);
    for (let i = 0; i < cap; i++) {
      if (p.health < 60 && r.chance(ECON.nearMissPerFlight)) {
        nearMisses++;
        line('mech', 'bad', `Near-miss on ${p.name}: rough engine on climb-out.`);
      }
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

  // 3. parts delivery (tier 1: guest flights carry 1 kit in the hold)
  const flew = hasCargo(s) ? cargoFlights * ECON.partsPerCargoFlight : passenger;
  let carry = flew;
  // a part chain's AOG part: on the AOG boat (paid on the PO), in a guest flight's hold from the week it
  // ships (freight 'flight'), or on a cargo flight (it rides first). Nothing carried it: a boat, at a price
  const ch = openChain(s);
  const due = !!ch && ch.step === 'transit' && ch.hold === undefined && (ch.freight !== 'flight' || (ch.ship ?? 0) <= W);
  const aogBoat = due && ch!.freight === 'boat';
  let chainPart = aogBoat;
  if (due && !aogBoat && (ch!.freight === 'flight' ? passenger > 0 : carry > 0)) {
    chainPart = true;
    if (ch!.freight !== 'flight') carry -= 1;
  }
  const delivered = Math.min(s.parts.inTransit, carry);
  s.parts.inTransit -= delivered;
  s.parts.stock += delivered;
  if (delivered) line('mech', 'good', `${delivered} parts kit${delivered > 1 ? 's' : ''} delivered.`);
  const onPlane = ch ? (s.assets.find((a) => a.id === ch.assetId)?.name ?? 'the plane') : '';
  if (aogBoat) {
    // the AOG boat brings the most urgent kit too, when nothing flew one in
    const kit = s.parts.inTransit > 0 && flew === 0;
    if (kit) {
      s.parts.inTransit -= 1;
      s.parts.stock += 1;
    }
    line('mech', 'info', `The AOG boat brought the ${ch!.item} for ${onPlane}${kit ? ', and 1 kit' : ''}.`);
  } else if ((s.parts.inTransit > 0 && flew === 0) || (due && !chainPart)) {
    // nothing carried them: a mainland boat brings the AOG part and the most urgent kit, at a price
    const kit = s.parts.inTransit > 0 && flew === 0;
    const part = due && !chainPart;
    if (kit) {
      s.parts.inTransit -= 1;
      s.parts.stock += 1;
    }
    s.cash -= ECON.boatKit;
    if (part) {
      ch!.spent += ECON.boatKit;
      chainPart = true;
    }
    const what = [part ? `the ${ch!.item}` : '', kit ? '1 kit' : ''].filter(Boolean).join(' and ');
    const carrier = part && ch!.freight === 'flight' ? 'guest' : hasCargo(s) ? 'cargo' : 'guest';
    line('mech', 'bad', `No ${carrier} flights carried ${part && !kit ? 'the part' : 'parts'}: a mainland boat brought ${what} (${usd(ECON.boatKit)}).`);
  }
  // (a part chain waits for its own part, not a kit from stock)
  const waiting = s.orders.filter((o) => o.status === 'waiting_part' && !o.chain).sort((a, b) => urgency(s, b) - urgency(s, a));
  for (const o of waiting) {
    if (s.parts.stock >= o.parts) {
      s.parts.stock -= o.parts;
      o.status = 'ready';
    }
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
    if (why && pw.on) line('elec', 'bad', `${h.name} unrentable: ${why}.`);
  }
  const ferry = td.ferry;
  const arrivals = passenger + ferry;
  const booked = rentable.slice(0, arrivals);
  if (rentable.length > arrivals) {
    const clearSky = planes(s)
      .filter((p) => !MODELS[p.model].cargo)
      .reduce((n, p) => n + capOf(s, p, 'clear'), 0);
    const weatherOnly = rentable.length <= clearSky + ferry;
    line(
      weatherOnly ? 'all' : 'mech',
      weatherOnly ? 'info' : 'bad',
      `${rentable.length - arrivals} house${rentable.length - arrivals > 1 ? 's' : ''} empty: only ${passenger} guest flights${ferry ? ` + ${ferry} ferry` : ''}${weatherOnly ? ` (${s.weather})` : ''}.`,
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
  const occ = occupancy(s, s.rates.nightly, W);
  let rental = 0;
  let refunds = 0;
  const bookedRevenue = new Map<string, number>();
  for (const h of booked) {
    const rev = 7 * s.rates.nightly * (MODELS[h.model].mult ?? 1) * occ * r.range(0.92, 1.08);
    rental += rev;
    bookedRevenue.set(h.id, rev);
    if (h.health < 60 && r.chance(ECON.outageChance)) {
      refunds += rev * 0.5;
      nearMisses++;
      line('elec', 'bad', `Outage at ${h.name}: guests refunded half (${usd(rev * 0.5)}).`);
    }
    h.health -= ECON.houseWear;
  }
  for (const h of hs) {
    if (isTagged(s, h.id)) continue; // red-tagged = de-energised: no fire
    if (W >= 3 && h.health < 30 && r.chance(ECON.fireChance)) {
      const cost = 1500 + 500 * s.tier;
      incidents.push({ kind: 'fire', role: 'elec', assetId: h.id, title: `Electrical fire at ${h.name}`, cost });
      h.health -= 15;
      line('elec', 'bad', `Electrical fire at ${h.name} (reliability under 30).`);
    }
  }

  // 6. charter: spare passenger flights sell day tours (twin first to guests)
  let guestNeed = Math.max(0, booked.length - ferry);
  let charter = 0;
  const load = charterLoad(s, s.rates.charter, W);
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

  // 7b. hidden defects surface: a job signed off badly fails in service, and the review traces it
  const surfaced: { d: Defect; inc: Incident }[] = [];
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
      const rule = defectRule(d.puzzle, d.role, d.orderKind, d.variant);
      const sev = d.severity - 1;
      const cost = round10(Math.max(d.cost, DEFECT.minBase) * DEFECT.incidentMult[sev]);
      const what = incidentText(rule, d.severity, asset.name);
      const traced = tracedTo(d);
      const inc: Incident = { kind: 'defect', role: d.role, assetId: asset.id, title: what, cost, from: { title: d.title, name: d.name, week: d.week, traced, redo: d.redo } };
      incidents.push(inc);
      asset.health -= DEFECT.healthHit[sev];
      line(d.role, 'bad', `${what}. Traced to ${traced}.`);
      const rev = bookedRevenue.get(asset.id);
      if (rev) {
        refunds += rev * 0.5;
        line('elec', 'bad', `Guests at ${asset.name} refunded half after the incident.`);
      }
      surfaced.push({ d, inc });
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
  // this week's inspection finds: caught before they failed
  for (const o of s.orders) {
    const rp = o.repair;
    if (rp?.via !== 'inspection' || o.createdWeek !== W) continue;
    const asset = assetOf(s, o);
    line(o.role, 'good', `${rp.foundBy}'s ${rp.foundIn}${asset ? ` on ${asset.name}` : ''} found ${rp.problem}, left from week ${rp.defect.week}: caught before it failed.`);
  }

  // 8. carry-over
  for (const o of s.orders) {
    if (!open(o)) continue;
    if (o.kind === 'project') continue; // crew projects wait for the crew
    if ((o.role === 'fin' || o.gain === 0) && o.kind !== 'report' && !o.chain) {
      o.status = 'cancelled'; // desk tasks and load sheets are for this week only
      continue;
    }
    if (o.lastDeferredWeek !== W) {
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
  // a surfaced defect goes to its trade as a repair (pending the analyst), after the carry-over so it starts fresh
  for (const { d, inc } of surfaced) inc.from!.repairId = addRepair(s, d, 'incident', { incident: inc.title }).id;
  // the part chain: another week on the ground (and what that cost), then receiving and engineering's answer (new steps start fresh too)
  if (ch) {
    ch.aogWeeks += 1;
    ch.downtime = (ch.downtime ?? 0) + downtimeOf(s, ch.assetId).usd;
  }
  resolveChain(s, W, chainPart, now, line);
  if (s.chain?.step === 'done' && s.chain.closedWeek === W && s.chain.story) line('all', 'good', `Back in service: ${s.chain.story}`);

  // 9. decay + storm
  const shield = s.modifiers.some((m) => m.kind === 'stormShield' && m.until >= W) ? 0.5 : 1;
  for (const a of s.assets) {
    if (a.touchedWeek < W) a.health -= ECON.decay;
    if (s.weather === 'storm') {
      if (a.kind === 'house') a.health -= 6 * shield;
      if (a.kind === 'grid') a.health -= 8 * shield;
    }
    a.health = clamp(Math.round(a.health * 10) / 10, 0, 100);
  }
  if (s.weather === 'storm') line('elec', 'bad', `Storm damage: houses −${6 * shield}, grid −${8 * shield}.`);
  // weather claims: roof, dock and hangar-door damage that no maintenance prevents (this is what insurance is for)
  let weatherCost = 0;
  if (W < 3) weatherCost = 0;
  else if (s.weather === 'storm' && r.chance(0.6)) weatherCost = Math.round((1500 + 1000 * Math.max(0, s.tier - 2)) * shield);
  else if (s.weather === 'wind' && s.tier >= 2 && r.chance(0.15)) weatherCost = 600 + 200 * s.tier;

  // 10. analyst money hunts: close / bank rec / invoice match recover a hidden leak
  let leak = 0;
  let found = 0;
  for (const t of s.orders.filter((o) => o.role === 'fin' && o.kind !== 'report' && o.leak && o.createdWeek === W)) {
    const got = t.result ? (t.leak ?? 0) * t.result.score : 0;
    leak += t.leak ?? 0;
    found += got;
    const what = t.kind === 'invoice' ? 'vendor overbilling' : t.kind === 'reconcile' ? 'unreconciled cash' : 'budget leakage';
    line('fin', got >= (t.leak ?? 0) * 0.95 ? 'good' : 'bad', got > 0 ? `${t.title}: recovered ${usd(got)} of ${usd(t.leak ?? 0)} ${what}.` : `${t.title} skipped: ${usd(t.leak ?? 0)} ${what} lost.`);
  }
  const leakCost = Math.round(leak - found);

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

  // 11. cash
  const revenue = Math.round(rental + charter - refunds);
  const fixed = td.fixed;
  const premium = Math.round(INSURANCE[s.insurance].premium * (1 + 0.25 * (s.tier - 1)));
  const grossIncidents = incidents.reduce((n, i) => n + i.cost, 0) + weatherCost;
  const netIncidents = Math.round(grossIncidents * (1 - INSURANCE[s.insurance].cover));
  if (weatherCost) line('all', 'bad', `${s.weather === 'storm' ? 'Storm' : 'Wind'} claim: ${usd(weatherCost)} of roof and dock damage.`);
  if (grossIncidents) line('fin', 'info', `Claims ${usd(grossIncidents)}, insurance paid ${usd(grossIncidents - netIncidents)}.`);
  const cashStart = s.openCash;
  const loanPay = s.loan ? Math.min(s.loan.left, s.loan.weekly) : 0;
  s.cash = Math.round(s.cash + revenue - fixed - premium - leakCost - reportLeak - netIncidents - loanPay - powerCost);
  if (s.loan) {
    s.loan.left -= loanPay;
    if (s.loan.left <= 0) {
      s.loan = null;
      line('fin', 'good', 'Bridge loan repaid in full.');
    }
  }

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
  // and they reset the streak: nobody wins alone.
  const fullTeam = autoRunRoles.length === 0;
  const st = s.stats;
  st.totalWeeks += 1;
  if (GRADE_VALUE[grade] >= 3 && fullTeam) {
    st.weeksBPlus += 1;
    st.streakBPlus += 1;
  } else st.streakBPlus = 0;
  if (perfectWeek && fullTeam) st.perfectWeeks += 1;
  st.aStreak = grade === 'A' && fullTeam ? (st.aStreak ?? 0) + 1 : 0;
  if (s.tier === 5 && (st.aStreak ?? 0) >= 8 && !s.creditsWeek) {
    s.creditsWeek = W;
    line('all', 'good', 'Eight straight A weeks at the Resort. You beat Island Company!');
  }
  st.recentIncidents = [...st.recentIncidents, incidents.length].slice(-4);
  st.negCashStreak = s.cash < 0 ? st.negCashStreak + 1 : 0;
  if (s.receivership > 0) {
    s.receivership -= 1;
    if (s.receivership === 0 && s.cash < 0) s.receivership = 1;
    if (s.receivership === 0) line('fin', 'good', 'Out of receivership.');
  } else if (st.negCashStreak >= 2) {
    s.receivership = 3;
    line('fin', 'bad', 'Cash below zero 2 weeks running: the island enters receivership (3 weeks).');
    if (!s.loan) {
      // the receiver's bridge loan: clears the deficit plus two weeks of running costs, repaid at 15% over 10 weeks
      const amount = Math.round((Math.max(0, -s.cash) + 2 * fixed + 3000) / 100) * 100;
      s.cash += amount;
      s.loan = { left: Math.round(amount * 1.15), weekly: Math.round((amount * 1.15) / 10) };
      line('fin', 'info', `The receiver advanced a ${usd(amount)} bridge loan: ${usd(s.loan.weekly)}/week for 10 weeks.`);
    }
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
    s.story = { id: def.id, week: W + 1, title: def.title, body: def.body, options: def.options.map((o) => ({ ...o })) };
  }

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
    mech: `${flown}/${scheduled} flights${bm ? ` · best: ${bm.title} ${Math.round(bm.result!.score * 100)}%` : ''}${signedOff('mech')}`,
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
    costs: { fixed, insurance: premium, leak: leakCost, incidents: netIncidents, refunds: Math.round(refunds), loan: loanPay || undefined, reports: reportLeak || undefined, power: powerCost || undefined },
    housesBooked: booked.length,
    housesRentable: rentable.length,
    partsDelivered: delivered,
    weather: s.weather,
    seed,
    lines,
    mvp,
    autoRun: autoRunRoles,
    tierUp,
  };
  s.history.push(report);
  if (s.history.length > 40) s.history.splice(0, s.history.length - 40);
  feed(s, 'all', GRADE_VALUE[grade] >= 3 ? 'good' : 'bad', `Week ${W} resolved: ${grade}. Revenue ${usd(revenue)}, ${flown}/${scheduled} flights, ${incidents.length} incident${incidents.length === 1 ? '' : 's'}.`, now);

  openWeek(s, now);
}

// ---------------------------------------------------------------------------
// Forecast context for the analyst's puzzle

export function forecastContext(s: IslandState) {
  const hist = s.history.slice(-5).map((h) => h.cashEnd);
  const cashHistory = [...hist, s.cash].slice(-6);
  const nets = s.history.slice(-3).map((h) => h.cashEnd - h.cashStart);
  const td = tierDef(s.tier);
  const baseline = nets.length ? nets.reduce((a, b) => a + b, 0) / nets.length : td.budget * 0.85 - td.fixed - 1400;
  const pending = s.orders.filter((o) => o.status === 'pending').reduce((n, o) => n + o.cost, 0);
  const projection: number[] = [];
  let c = s.cash;
  for (let i = 1; i <= 4; i++) {
    const seasonal = season(s.week + i, s.seed) / season(s.week, s.seed);
    c += baseline * seasonal - (i === 1 ? pending * 0.5 : 0);
    projection.push(Math.round(c / 10) * 10);
  }
  const hints: string[] = [];
  if (pending) hints.push(`Pending approvals ${usd(pending)}`);
  const next = season(s.week + 2, s.seed) - season(s.week, s.seed);
  hints.push(next > 0.03 ? 'Season: bookings rising' : next < -0.03 ? 'Season: bookings easing' : 'Season: flat');
  if (tierDef(s.tier).storms) hints.push('Storm season: 1 in 5 weeks');
  return { cashHistory, projection, hints };
}
