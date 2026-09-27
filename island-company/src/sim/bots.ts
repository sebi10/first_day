// Scripted players for the paper sim (scripts/balance.ts) and tests.
// They call the same reducer as real phones, so balance numbers are real.
import { botChainData, islandAircraft, needsFreight, openChain } from './chain';
import { ECON, GSE, TIERS } from './data';
import { apply, createIsland, forecastContext } from './engine';
import { cableBand, charterLoad, downtimeOf, expectedDeferralCost, gseCarts, logistic, needsCart, occupancy, startCart, urgency } from './econ';
import { hashSeed, rng, type Rng } from './rng';
import { ROLES, type Action, type GseCart, type IslandState, type Order, type Role } from './types';

export type Bot = {
  skill: number;
  absent?: boolean;
  naive?: boolean;
  perTurn?: number;
  miss?: number;
  /** skill lost per island tier as jobs get harder */
  tierDrop?: number;
  /** absences come in streaks (holidays, busy weeks), not independent rolls */
  streak?: boolean;
};
export type Team = Record<Role, Bot>;

const good: Bot = { skill: 0.88 };
export const TEAMS: Record<string, Team> = {
  'all good': { mech: good, elec: good, fin: good },
  'all average': { mech: { skill: 0.72, perTurn: 3, miss: 0.1 }, elec: { skill: 0.72, perTurn: 3, miss: 0.1 }, fin: { skill: 0.72, miss: 0.1 } },
  'naive analyst': { mech: good, elec: good, fin: { skill: 0.8, naive: true } },
  // closest to three real friends: harder jobs cost skill, absences come in runs
  'three friends': {
    mech: { skill: 0.82, tierDrop: 0.05, perTurn: 3, miss: 0.08, streak: true },
    elec: { skill: 0.82, tierDrop: 0.05, perTurn: 3, miss: 0.08, streak: true },
    fin: { skill: 0.82, tierDrop: 0.04, miss: 0.08, streak: true },
  },
  'mech absent': { mech: { skill: 0, absent: true }, elec: good, fin: good },
  'elec absent': { mech: good, elec: { skill: 0, absent: true }, fin: good },
  'fin absent': { mech: good, elec: good, fin: { skill: 0, absent: true } },
  'solo mech': { mech: good, elec: { skill: 0, absent: true }, fin: { skill: 0, absent: true } },
  'solo elec': { mech: { skill: 0, absent: true }, elec: good, fin: { skill: 0, absent: true } },
  'solo fin': { mech: { skill: 0, absent: true }, elec: { skill: 0, absent: true }, fin: good },
  'nobody': { mech: { skill: 0, absent: true }, elec: { skill: 0, absent: true }, fin: { skill: 0, absent: true } },
};

function step(s: IslandState, a: Action, now: number) {
  return apply(s, a, now).s;
}

function score(r: Rng, skill: number) {
  const v = Math.min(1, Math.max(0, skill + r.range(-0.15, 0.15)));
  return v >= 0.95 ? 1 : v;
}

/** Revenue-maximising rate by grid search over the logistic demand curve */
export function bestRates(s: IslandState) {
  let bestN = ECON.baseNightly;
  let bestV = -1;
  for (let n = ECON.baseNightly * ECON.rateFloor; n <= ECON.baseNightly * ECON.rateCap; n += 5) {
    const v = n * occupancy(s, n);
    if (v > bestV) {
      bestV = v;
      bestN = n;
    }
  }
  let bestC = ECON.baseCharter;
  let bestCV = -1;
  for (let c = ECON.baseCharter * ECON.rateFloor; c <= ECON.baseCharter * ECON.rateCap; c += 10) {
    const v = c * charterLoad(s, c);
    if (v > bestCV) {
      bestCV = v;
      bestC = c;
    }
  }
  return { nightly: bestN, charter: bestC };
}

/** The cart a bot would use for a start: as the mechanic picks it (econ startCart). */
const botCart = (s: IslandState, o: Order): GseCart | null => startCart(s, o.assetId);

function playOps(s: IslandState, role: 'mech' | 'elec', bot: Bot, r: Rng, now: number) {
  // the crew backs the analyst's story call (bots agree; people may not)
  if (s.story && !s.story.chosen) s = step(s, { t: 'story', key: s.story.options[s.cash > 12000 ? 0 : 1].key, role }, now);
  for (const o of s.orders.filter((x) => x.role === role && x.status === 'countered')) s = step(s, { t: 'acceptCounter', orderId: o.id }, now);
  const skill0 = bot.skill - (bot.tierDrop ?? 0) * (s.tier - 1);
  if (role === 'mech') {
    // last week's flight-day cart comes back off the plane and onto the charger
    for (const c of gseCarts(s)) if (c.hookedTo) s = step(s, { t: 'gse', role, cart: c.id, op: 'charge' }, now);
    // the ground power cables get a look about once a month. A plug end well inside its band is an easy call
    // (a clean boot, or burnt pins); near the edge of cracked it is right by skill
    for (const c of gseCarts(s)) {
      if (c.inspected && s.week - c.inspected.week < 4) continue;
      const worn = cableBand(c.wear) !== 'good';
      const clear = Math.abs(c.wear - GSE.cracked) >= 10;
      const right = r.chance(clear ? 0.97 : Math.min(0.97, Math.max(0.2, 0.25 + 0.7 * skill0)));
      s = step(s, { t: 'gse', role, cart: c.id, op: 'inspect', call: worn === right ? 'tag' : 'ok' }, now);
    }
  }
  const ready = s.orders.filter((o) => o.role === role && o.status === 'ready').sort((a, b) => urgency(s, b) - urgency(s, a));
  const skill = bot.skill - (bot.tierDrop ?? 0) * (s.tier - 1);
  // a crewmate's report is a favour done on top of the usual jobs (people make time when a friend is stuck);
  // repairs and redos are real jobs and take a slot. A ground power start with no charged cart to hand when
  // its turn comes (an earlier start may have used it up) waits, and the slot goes to the next job.
  const play = (o: (typeof ready)[number]): boolean => {
    // tow a charged cart over for a start or radio work (off the charger, or off a plane that isn't flying;
    // a flat or tagged-out one on that plane goes back on the charger first), and put it back on the charger after
    const cart = needsCart(o.kind) ? botCart(s, o) : null;
    if (needsCart(o.kind) && !cart) return false;
    if (cart && cart.hookedTo !== o.assetId) {
      const on = gseCarts(s).find((c) => c.hookedTo === o.assetId);
      if (on) s = step(s, { t: 'gse', role, cart: on.id, op: 'charge' }, now);
      s = step(s, { t: 'gse', role, cart: cart.id, op: 'hook', assetId: o.assetId! }, now);
    }
    const sc = score(r, skill);
    s = step(s, { t: 'complete', role, orderId: o.id, score: sc, perfect: sc >= 0.95, data: chainData(s, o, skill, r) }, now);
    if (cart) s = step(s, { t: 'gse', role, cart: cart.id, op: 'charge' }, now);
    return true;
  };
  for (const o of ready) if (o.kind === 'report') play(o);
  let jobs = 0;
  for (const o of ready) if (o.kind !== 'report' && jobs < (bot.perTurn ?? 4) && play(o)) jobs++;
  // a job that found a part: the IPC lookup comes straight after it, if there's a slot left (the plane is down)
  let extra = Math.max(1, (bot.perTurn ?? 4) - jobs);
  for (let guard = 0; guard < 3 && extra > 0; guard++) {
    const c = openChain(s);
    const o = c?.stepId ? s.orders.find((x) => x.id === c.stepId && x.role === role && x.status === 'ready') : undefined;
    // the electrician's check on an electrical unit
    const b = !o && c?.bench && !c.bench.call ? s.orders.find((x) => x.id === c.bench!.id && x.role === role && x.status === 'ready') : undefined;
    if (!o && !b) break;
    play((o ?? b)!);
    extra--;
  }
  // a flight day on a weak battery: a charged cart goes on that plane before the turn ends
  if (role === 'mech') s = hookFlightDay(s, now);
  return s;
}

/** The weak-battery plane gets the best charged cart hooked up to it (off the charger, or off a plane that isn't flying). */
function hookFlightDay(s: IslandState, now: number): IslandState {
  const wb = s.weakBattery;
  if (!wb || wb.week !== s.week) return s;
  const pick = startCart(s, wb.assetId);
  if (!pick || pick.hookedTo === wb.assetId) return s;
  const on = gseCarts(s).find((c) => c.hookedTo === wb.assetId);
  if (on) s = step(s, { t: 'gse', role: 'mech', cart: on.id, op: 'charge' }, now);
  return step(s, { t: 'gse', role: 'mech', cart: pick.id, op: 'hook', assetId: wb.assetId }, now);
}

/** A part chain's lookup, research or circuit check: what the bot hands in, by its skill (src/sim/chain.ts). */
function chainData(s: IslandState, o: IslandState['orders'][number], skill: number, r: Rng): Record<string, unknown> | undefined {
  const c = openChain(s);
  if (!c || !o.chain || c.id !== o.chain.id || (o.chain.step !== 'lookup' && o.chain.step !== 'research' && o.chain.step !== 'bench')) return undefined;
  const asset = s.assets.find((a) => a.id === c.assetId);
  if (!asset) return undefined;
  return botChainData(islandAircraft(s.seed, asset), c, o.chain.step, skill, r);
}

function playFin(s: IslandState, bot: Bot, r: Rng, now: number) {
  if (!bot.naive) s = step(s, { t: 'setRates', ...bestRates(s) }, now);
  if (s.pendingBonus) s = step(s, { t: 'allocateBonus', choice: 'reserve' }, now);
  if (s.story && !s.story.chosen) s = step(s, { t: 'story', key: s.story.options[s.cash > 12000 ? 0 : 1].key, role: 'fin' }, now);

  const reserve = 1500 + TIERS[s.tier - 1].fixed;
  const pend = s.orders.filter((o) => o.status === 'pending').sort((a, b) => urgency(s, b) - urgency(s, a));
  for (const o of pend) {
    if (bot.naive) {
      s = step(s, { t: 'approve', orderId: o.id }, now);
      continue;
    }
    const asset = s.assets.find((a) => a.id === o.assetId);
    const exp = expectedDeferralCost(s, o).cost;
    // a known defect's repair is safety work: the defect is still in service
    // so is a part for a plane that's down, and engineering's fee to get it approved
    const critical = (asset && asset.health < 70) || o.kind === 'inspect100' || o.kind === 'codeprep' || o.kind === 'repair' || !!o.chain || o.deferrals >= 2;
    const worth = exp >= o.cost * 0.6 || critical;
    // like a person would: cheap safety-critical work gets approved even when cash is tight
    const cheapCritical = critical && o.cost <= 600 && s.cash - o.cost >= ECON.freezeBelow;
    // the part for a grounded plane is what gets the revenue back: find the money. Its freight, when the plane
    // that would carry it is the one down: the AOG boat if a week of downtime costs more than the boat, else the guest flight
    const c = o.chain ? openChain(s) : null;
    const freight = !!c && o.chain!.step === 'buy' && needsFreight(s, c);
    const ship: 'boat' | 'flight' | undefined = freight ? (downtimeOf(s, c!.assetId).usd > ECON.boatKit ? 'boat' : 'flight') : undefined;
    const aog = !!o.chain && s.cash - o.cost - (ship === 'boat' ? ECON.boatKit : 0) >= 0;
    if ((worth && s.cash - o.cost >= reserve) || cheapCritical || aog) s = step(s, { t: 'approve', orderId: o.id, ...(ship ? { ship } : {}) }, now);
    else if (o.lastDeferredWeek !== s.week) s = step(s, { t: 'defer', orderId: o.id, reason: s.cash - o.cost < reserve ? 'cash' : 'priority' }, now);
  }
  const skill = bot.skill - (bot.tierDrop ?? 0) * (s.tier - 1);
  // a crewmate's report first (it costs them every week), then the biggest money hunt
  // (when a report caps the desk, only the first one gets done)
  const tasks = s.orders
    .filter((x) => x.role === 'fin' && x.status === 'ready')
    .sort((a, b) => Number(b.kind === 'report') - Number(a.kind === 'report') || (b.leak ?? 0) - (a.leak ?? 0));
  for (const o of tasks) {
    const sc = score(r, skill);
    if (o.kind === 'auction') {
      const fair = (ECON.partMarket.low + ECON.partMarket.high) / 2;
      const win = sc > 0.5;
      s = step(s, { t: 'complete', role: 'fin', orderId: o.id, score: sc, perfect: sc >= 0.95, data: { kits: win ? 1 : 0, spent: win ? Math.round(fair * (1.15 - sc * 0.25)) : 0 } }, now);
    } else if (o.kind === 'forecast') {
      const ctx = forecastContext(s);
      const pts = ctx.projection.map((p) => Math.round(p * (1 + r.range(-0.1, 0.1) * (1 - sc))));
      s = step(s, { t: 'complete', role: 'fin', orderId: o.id, score: sc, perfect: sc >= 0.95, data: { points: pts } }, now);
    } else s = step(s, { t: 'complete', role: 'fin', orderId: o.id, score: sc, perfect: sc >= 0.95 }, now);
  }
  if (s.parts.stock + s.parts.inTransit < 2 && s.cash > reserve + 600) s = step(s, { t: 'buyList' }, now);
  return s;
}

/** One seat's turn as a bot plays it: the sim's week loop, and tests that start from an island they set up. */
export function botTurn(s: IslandState, role: Role, bot: Bot, r: Rng, now: number) {
  return role === 'fin' ? playFin(s, bot, r, now) : playOps(s, role, bot, r, now);
}

export type SimWeek = {
  week: number;
  tier: number;
  grade: string;
  revenue: number;
  cash: number;
  incidents: number;
  /** of which: hidden defects that surfaced */
  defects: number;
  flights: string;
  houses: string;
};

/** `salt` re-rolls the crew's weeks (who shows up, how each job goes) for robustness checks; '' is the standard run. */
export function simulate(team: Team, weeks: number, seed: number, trace?: (s: IslandState) => void, salt = '') {
  let now = Date.UTC(2026, 8, 1, 12);
  let s = createIsland({ id: `sim-${seed}`, name: 'Sim Island', now, tz: 'Europe/Paris', seed: hashSeed('sim', seed), creator: { uid: 'u-mech', name: 'M', role: 'mech' } });
  s = step(s, { t: 'join', uid: 'u-elec', name: 'E', role: 'elec' }, now);
  s = step(s, { t: 'join', uid: 'u-fin', name: 'F', role: 'fin' }, now);
  for (const role of ROLES) s = step(s, { t: 'week0Done', role }, now);
  // Who shows up (and in what order) has its own stream, and each seat's week of
  // play has its own stream too: a rule that adds or removes a job shifts only
  // that seat's week, never the whole run's absences, so before/after balance
  // runs compare the same crew weeks.
  const away = rng(hashSeed('bots-away', seed, salt));
  const awayLast: Record<Role, boolean> = { mech: false, elec: false, fin: false };
  const out: SimWeek[] = [];
  let minCash = s.cash;
  for (let w = 0; w < weeks; w++) {
    const week = s.week;
    const order = away.shuffle([...ROLES]);
    for (const role of order) {
      const bot = team[role];
      const missed = bot.absent || (bot.miss ? away.chance(bot.streak && awayLast[role] ? 0.5 : bot.miss) : false);
      awayLast[role] = !!missed;
      if (missed) continue;
      s = botTurn(s, role, bot, rng(hashSeed('bots', seed, salt, role, week)), now);
      s = step(s, { t: 'endTurn', role }, now);
    }
    if (s.week === week) {
      now = (s.deadline ?? now) + 1000;
      s = step(s, { t: 'resolve', week }, now);
    } else now += 86400_000;
    const h = s.history[s.history.length - 1];
    trace?.(s);
    minCash = Math.min(minCash, h.cashEnd);
    out.push({
      week: h.week,
      tier: h.tier,
      grade: h.grade,
      revenue: h.revenue,
      cash: h.cashEnd,
      incidents: h.incidents.length,
      defects: h.incidents.filter((i) => i.kind === 'defect').length,
      flights: `${h.flightsFlown}/${h.flightsScheduled}`,
      houses: `${h.housesBooked}/${h.housesRentable}`,
    });
  }
  return { weeks: out, final: s, minCash };
}

export { logistic };
