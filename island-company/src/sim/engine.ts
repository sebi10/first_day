// The island engine: a pure, deterministic reducer. Every client (and the
// balance sim) runs the same code, so any phone can resolve a week and get
// byte-identical results from the same inputs + seed.
import { CATALOG, CATALOG_BY_KIND, ECON, FIN_TASKS, INSURANCE, MODELS, STORIES, TIERS } from './data';
import {
  charterLoad,
  clamp,
  credit,
  deferralRisk,
  grid,
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
import { isMentor, levelOf, orderXp, tierUnlocked } from './progression';
import { hashSeed, rng, type Rng } from './rng';
import { nextDeadline } from './time';
import {
  ROLES,
  type Action,
  type Asset,
  type FeedEvent,
  type Grade,
  type Incident,
  type IslandState,
  type OpsRole,
  type Order,
  type Player,
  type ReportLine,
  type Role,
  type WeekReport,
} from './types';

export type ApplyResult = { s: IslandState; error?: string };

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

function addTierAssets(s: IslandState, tier: number, week: number) {
  const fresh = week === 0;
  for (const a of TIERS[tier - 1].adds) {
    if (s.assets.some((x) => x.id === a.id)) continue;
    const kind = MODELS[a.model].kind;
    s.assets.push({
      id: a.id,
      kind,
      model: a.model,
      name: a.name,
      health: fresh ? ECON.startHealth : 80,
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
  const s = structuredClone(prev);
  s.updatedAt = now;
  const fail = (error: string): ApplyResult => ({ s: prev, error });

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
      if (s.cash < ECON.freezeBelow) return fail(`Cash under ${usd(ECON.freezeBelow)}: approvals are frozen.`);
      if (s.cash - o.cost < 0) return fail('Not enough cash.');
      if (s.receivership > 0 && o.cost > 800) return fail('Receivership: the receiver blocks spend over $800.');
      markApproved(s, o, false);
      gainXp(s, 'fin', 10);
      feed(s, 'fin', 'good', `Approved ${o.title} (${usd(o.cost)}).`, now);
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
      o.status = 'countered';
      o.counter = { cost: round10(o.cost * 0.6), gain: Math.round(o.gain * 0.55) };
      gainXp(s, 'fin', 10);
      feed(s, 'fin', 'info', `Counter-offer on ${o.title}: ${usd(o.counter.cost)} cheaper fix.`, now);
      return { s };
    }
    case 'acceptCounter': {
      const o = s.orders.find((x) => x.id === a.orderId);
      if (!o || o.status !== 'countered' || !o.counter) return fail('No counter-offer waiting.');
      if (s.cash < ECON.freezeBelow || s.cash - o.counter.cost < 0) return fail('Cash is frozen right now.');
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
      s.autoBudget[a.role] = clamp(Math.round(a.amount / 50) * 50, 0, s.receivership > 0 ? 300 : 3000);
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
      return story(s, prev, a.key, now);
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
  }
}

export function listPrice(s: IslandState) {
  return round10(((ECON.partMarket.low + ECON.partMarket.high) / 2) * ECON.listPremium * (1 + 0.1 * (s.tier - 1)));
}
const hasCargo = (s: IslandState) => s.assets.some((a) => a.model === 'cargo');

function complete(s: IslandState, prev: IslandState, a: Extract<Action, { t: 'complete' }>, now: number): ApplyResult {
  const fail = (error: string): ApplyResult => ({ s: prev, error });
  if (s.week < 1) return fail('The week has not started yet.');
  const o = s.orders.find((x) => x.id === a.orderId);
  if (!o || o.status !== 'ready') return fail('That order is not ready.');
  const turn = (s.turns[a.role] ??= { ended: false, endedAt: null, done: 0 });
  if (turn.ended) return fail('Your turn is over for this week.');
  const player = s.players[a.role];
  if (!player) return fail('Join first.');

  // Lend a hand: anyone may try another trade's job once a week (mentors twice).
  // Real trade knowledge is the gate: no tools come with you, and a botched
  // attempt (<40%) damages the asset and leaves the job open for its owner.
  let covered = false;
  if (o.role !== a.role) {
    if (!a.cover) return fail('Not your trade. Use Lend a hand.');
    const allowance = isMentor(player) ? 2 : 1;
    if ((s.coversUsed[a.role] ?? 0) >= allowance) return fail(allowance === 1 ? 'You already lent a hand this week.' : 'Two assists per week, even for a mentor.');
    s.coversUsed[a.role] = (s.coversUsed[a.role] ?? 0) + 1;
    player.covers += 1;
    covered = true;
    if (a.score < 0.4) {
      const asset = assetOf(s, o);
      if (asset) {
        asset.health = clamp(asset.health - 6, 0, 100);
        asset.touchedWeek = s.week;
      }
      turn.done += 1;
      feed(s, o.role, 'bad', `${player.name} tried ${o.title}${asset ? ` on ${asset.name}` : ''} outside their trade: ${Math.round(a.score * 100)}%, botched${asset ? ` (${asset.name} −6)` : ''}. Still open.`, now);
      return { s };
    }
  }
  if (a.role === 'mech' && !covered && powered(s).gridDown && turn.done >= 1)
    return fail('Grid down: hangar tools offline, 1 order max.');

  const cr = covered ? credit(a.score, 0) : credit(a.score, player.perfects);
  o.status = 'done';
  o.result = { score: a.score, perfect: a.perfect, credit: cr, by: a.role, week: s.week, covered, summary: a.summary };
  turn.done += 1;
  if (a.perfect && !covered && player.perfects < 15) player.perfects += 1;
  player.best = { ...(player.best ?? {}), [o.puzzle]: Math.max(player.best?.[o.puzzle] ?? 0, clamp(a.score, 0, 1)) };
  gainXp(s, a.role, Math.round(orderXp(o.tier, cr, a.perfect) * (covered ? 0.5 : 1)));

  const asset = assetOf(s, o);
  if (asset) {
    asset.health = clamp(asset.health + o.gain * cr, 0, 100);
    asset.touchedWeek = s.week;
    if (o.kind === 'inspect100' && cr >= 1) asset.sinceInspection = 0;
    if (o.kind === 'codeprep' && cr >= 1) asset.inspectionUntil = s.week + ECON.houseInspectionWeeks;
  }

  if (o.kind === 'auction') {
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
    feed(s, 'fin', 'good', `${o.title}: found ${usd((o.leak ?? 0) * a.score)}.`, now);
  } else {
    const by = covered ? `${player.name} (lending a hand)` : player.name;
    feed(s, o.role, a.perfect ? 'good' : 'info', `${by} finished ${o.title}${asset ? ` on ${asset.name}` : ''}${a.perfect ? ' — perfect' : ''}.`, now);
  }
  return { s };
}

function story(s: IslandState, prev: IslandState, key: string, now: number): ApplyResult {
  const card = s.story;
  if (!card || card.chosen) return { s: prev, error: 'No story card waiting.' };
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
      s.modifiers.push({ kind: 'demand', mult: 1.4, until: W, label: 'Wedding party' });
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
  if (s.story?.chosen) s.story = null;

  generateOpsOrders(s, r);
  generateFinTasks(s, r);
  autoApprove(s);

  s.deadline = nextDeadline(now, s.creatorTz, s.resolveHour);
  const wx = s.weather === 'clear' ? 'Clear skies' : s.weather === 'wind' ? 'Wind: flight risk up' : 'Storm: the electrician’s week';
  feed(s, 'all', s.weather === 'clear' ? 'info' : 'bad', `Week ${W} opens. ${wx}.`, now);
}

function generateOpsOrders(s: IslandState, r: Rng) {
  const W = s.week;
  for (const role of OPS) {
    const openOrders = s.orders.filter((o) => o.role === role && open(o));
    const target = s.tier >= 3 ? 5 : 4;
    let openCount = openOrders.length;
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
    // must-do orders (inspections) jump the queue, capped at 6 open per role
    for (const m of cands.filter((c) => c.w >= 100)) {
      if (openCount >= 6) break;
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
  newOrder(s, {
    role: c.role,
    kind,
    assetId: asset.id,
    title: c.title,
    puzzle: c.puzzle,
    tier,
    cost: orderCost(kind, tier),
    parts: c.parts,
    gain: c.gain,
    status: 'pending',
  });
}

/** Analyst difficulty climbs with the island: tier, plus one step every 10 weeks */
export const finTier = (s: IslandState) => clamp(s.tier + Math.floor(s.week / 10), 1, 5);

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
      .filter((o) => o.role === role && o.status === 'pending' && !o.pushedBack)
      .sort((a, b) => urgency(s, b) - urgency(s, a));
    for (const o of pend) {
      if (s.cash < ECON.freezeBelow) break;
      if (s.receivership > 0 && o.cost > 300) continue;
      if (s.autoSpent[role] + o.cost <= s.autoBudget[role] && s.cash - o.cost >= ECON.freezeBelow) {
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
      if (s.cash - o.cost >= ECON.autopilotFloor && s.receivership === 0) {
        markApproved(s, o, true);
        n++;
      }
    }
    const close = s.orders.find((o) => (o.kind === 'close' || o.kind === 'reconcile') && o.status === 'ready' && o.createdWeek === s.week);
    if (close) {
      close.status = 'done';
      close.result = { score: 0.5, perfect: false, credit: 0.5, by: 'fin', week: s.week, auto: true };
    }
    return;
  }
  const ready = s.orders
    .filter((o) => o.role === role && o.status === 'ready')
    .sort((a, b) => urgency(s, b) - urgency(s, a))
    .slice(0, 2);
  for (const o of ready) {
    o.status = 'done';
    o.result = { score: 0.5, perfect: false, credit: 0.5, by: role, week: s.week, auto: true };
    const asset = assetOf(s, o);
    if (asset) {
      asset.health = clamp(asset.health + o.gain * 0.5, 0, 100);
      asset.touchedWeek = s.week;
    }
  }
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

  // 2. flights
  let passenger = 0;
  let cargoFlights = 0;
  let flown = 0;
  let scheduled = 0;
  const perPlane = flightsPerPlane(s.tier);
  const guestSlots: { plane: Asset; n: number }[] = [];
  for (const p of planes(s)) {
    scheduled += perPlane;
    const healthCap = planeCapacity(p, s.tier, 'clear');
    const cap = planeCapacity(p, s.tier, s.weather);
    if (healthCap < perPlane)
      line('mech', 'bad', `${perPlane - healthCap} flight${perPlane - healthCap > 1 ? 's' : ''} lost on ${p.name}: airworthiness ${Math.round(p.health)}`);
    if (cap < healthCap) line('all', 'info', `${healthCap - cap} flight${healthCap - cap > 1 ? 's' : ''} lost on ${p.name}: ${s.weather}`);
    if (cap === 0 && healthCap === 0) line('mech', 'bad', `${p.name} is AOG (aircraft on ground).`);
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
  const carry = hasCargo(s) ? cargoFlights * ECON.partsPerCargoFlight : passenger;
  const delivered = Math.min(s.parts.inTransit, carry);
  s.parts.inTransit -= delivered;
  s.parts.stock += delivered;
  if (delivered) line('mech', 'good', `${delivered} parts kit${delivered > 1 ? 's' : ''} delivered.`);
  if (s.parts.inTransit > 0 && carry === 0) line('mech', 'bad', `${s.parts.inTransit} kit(s) stuck on the mainland: no ${hasCargo(s) ? 'cargo' : 'guest'} flights.`);
  const waiting = s.orders.filter((o) => o.status === 'waiting_part').sort((a, b) => urgency(s, b) - urgency(s, a));
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
  if (rentable.length > arrivals)
    line('mech', 'bad', `${rentable.length - arrivals} house${rentable.length - arrivals > 1 ? 's' : ''} empty: only ${passenger} guest flights${ferry ? ` + ${ferry} ferry` : ''}.`);
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
    if (h.health < 30 && r.chance(ECON.fireChance)) {
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
    charter += spare * s.rates.charter * (MODELS[slot.plane.model].mult ?? 1) * load * r.range(0.9, 1.1);
  }

  // 7. deferral risk: orders carried from an earlier week roll now
  for (const o of s.orders) {
    if (!open(o) || o.role === 'fin' || o.deferrals < 1 || (o.lastDeferredWeek ?? W) >= W) continue;
    const p = deferralRisk(o);
    if (r.chance(p)) {
      const asset = assetOf(s, o);
      const cost = ECON.deferral.costMult * o.cost;
      incidents.push({ kind: 'deferral', role: o.role, assetId: o.assetId, title: `${o.title}${asset ? ` on ${asset.name}` : ''}`, cost });
      if (asset) {
        asset.health -= ECON.deferral.healthHit;
        const rev = bookedRevenue.get(asset.id);
        if (rev) {
          refunds += rev * 0.5;
          line('elec', 'bad', `Guests at ${asset.name} refunded half after the incident.`);
        }
      }
      const who: ReportLine['role'] =
        o.status === 'waiting_part' ? 'all' : o.deferReason === 'open' && o.approvedWeek !== undefined ? o.role : 'fin';
      line(who, 'bad', `Incident: ${o.title}${asset ? ` on ${asset.name}` : ''} (carried ${o.deferrals} wk, ${Math.round(p * 100)}% risk).`);
    }
  }

  // 8. carry-over
  for (const o of s.orders) {
    if (!open(o)) continue;
    if (o.role === 'fin') {
      o.status = 'cancelled';
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
  s.orders = s.orders.filter((o) => open(o) || (o.result?.week ?? o.createdWeek) >= W - 1);

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

  // 10. analyst money hunts: close / bank rec / invoice match recover a hidden leak
  let leak = 0;
  let found = 0;
  for (const t of s.orders.filter((o) => o.role === 'fin' && o.leak && o.createdWeek === W)) {
    const got = t.result ? (t.leak ?? 0) * t.result.score : 0;
    leak += t.leak ?? 0;
    found += got;
    const what = t.kind === 'invoice' ? 'vendor overbilling' : t.kind === 'reconcile' ? 'unreconciled cash' : 'budget leakage';
    line('fin', got >= (t.leak ?? 0) * 0.95 ? 'good' : 'bad', got > 0 ? `${t.title}: recovered ${usd(got)} of ${usd(t.leak ?? 0)} ${what}.` : `${t.title} skipped: ${usd(t.leak ?? 0)} ${what} lost.`);
  }
  const leakCost = Math.round(leak - found);

  // 11. cash
  const revenue = Math.round(rental + charter - refunds);
  const fixed = td.fixed;
  const premium = Math.round(INSURANCE[s.insurance].premium * (1 + 0.25 * (s.tier - 1)));
  const grossIncidents = incidents.reduce((n, i) => n + i.cost, 0);
  const netIncidents = Math.round(grossIncidents * (1 - INSURANCE[s.insurance].cover));
  if (grossIncidents) line('fin', 'info', `Incidents ${usd(grossIncidents)}, insurance paid ${usd(grossIncidents - netIncidents)}.`);
  const cashStart = s.openCash;
  s.cash = Math.round(s.cash + revenue - fixed - premium - leakCost - netIncidents);

  // 12. forecasts
  for (const f of s.forecasts) {
    if (f.paid !== undefined) continue;
    if (W > f.week && W <= f.week + 4) f.actual.push(s.cash);
    if (f.actual.length === 4) {
      const err = f.points.reduce((n, p, i) => n + Math.abs(p - f.actual[i]) / Math.max(5000, Math.abs(f.actual[i])), 0) / 4;
      const bonus = err <= 0.1 ? Math.round((400 + 4000 * (0.1 - err)) * (1 + 0.25 * (s.tier - 1))) : 0;
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
  }

  // 15. XP for the grade, A bonus
  const gradeXp = grade === 'A' ? 100 : grade === 'B' ? 50 : 0;
  if (gradeXp) for (const role of ROLES) gainXp(s, role, gradeXp);
  s.pendingBonus = grade === 'A' ? Math.round(ECON.aGradeBonus * revenue) : null;

  // 16. tier up
  let tierUp: number | undefined;
  if (tierUnlocked(s)) {
    s.tier += 1;
    tierUp = s.tier;
    st.tierReachedWeek[s.tier] = W;
    addTierAssets(s, s.tier, W);
    line('all', 'good', `Tier ${s.tier} unlocked: ${tierDef(s.tier).name}!`);
  }

  // 17. story card every 3-week B+ streak
  if (st.streakBPlus >= 3 && st.streakBPlus % 3 === 0 && !s.story) {
    const def = STORIES[hashSeed(s.seed, 'story', W) % STORIES.length];
    s.story = { id: def.id, week: W + 1, title: def.title, body: def.body, options: def.options.map((o) => ({ ...o })) };
  }

  // 18. MVP lines
  const doneThisWeek = (role: Role) => s.orders.filter((o) => o.result?.week === W && o.result.by === role && !o.result.auto);
  const best = (role: Role) => doneThisWeek(role).sort((a, b) => (b.result!.score ?? 0) - (a.result!.score ?? 0))[0];
  const bm = best('mech');
  const be = best('elec');
  const mvp: Record<Role, string> = {
    mech: `${flown}/${scheduled} flights${bm ? ` · best: ${bm.title} ${Math.round(bm.result!.score * 100)}%` : ''}`,
    elec: `${booked.length}/${hs.length} houses booked${be ? ` · best: ${be.title} ${Math.round(be.result!.score * 100)}%` : ''}`,
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
    costs: { fixed, insurance: premium, leak: leakCost, incidents: netIncidents, refunds: Math.round(refunds) },
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
