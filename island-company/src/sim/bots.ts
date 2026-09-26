// Scripted players for the paper sim (scripts/balance.ts) and tests.
// They call the same reducer as real phones, so balance numbers are real.
import { ECON, TIERS } from './data';
import { apply, createIsland, forecastContext } from './engine';
import { charterLoad, expectedDeferralCost, logistic, occupancy, urgency } from './econ';
import { hashSeed, rng, type Rng } from './rng';
import { ROLES, type Action, type IslandState, type Role } from './types';

export type Bot = { skill: number; absent?: boolean; naive?: boolean; perTurn?: number; miss?: number };
export type Team = Record<Role, Bot>;

const good: Bot = { skill: 0.88 };
export const TEAMS: Record<string, Team> = {
  'all good': { mech: good, elec: good, fin: good },
  'all average': { mech: { skill: 0.72, perTurn: 3, miss: 0.1 }, elec: { skill: 0.72, perTurn: 3, miss: 0.1 }, fin: { skill: 0.72, miss: 0.1 } },
  'naive analyst': { mech: good, elec: good, fin: { skill: 0.8, naive: true } },
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

function playOps(s: IslandState, role: 'mech' | 'elec', bot: Bot, r: Rng, now: number) {
  for (const o of s.orders.filter((x) => x.role === role && x.status === 'countered')) s = step(s, { t: 'acceptCounter', orderId: o.id }, now);
  const ready = s.orders.filter((o) => o.role === role && o.status === 'ready').sort((a, b) => urgency(s, b) - urgency(s, a));
  for (const o of ready.slice(0, bot.perTurn ?? 4)) {
    const sc = score(r, bot.skill);
    s = step(s, { t: 'complete', role, orderId: o.id, score: sc, perfect: sc >= 0.95 }, now);
  }
  return s;
}

function playFin(s: IslandState, bot: Bot, r: Rng, now: number) {
  if (!bot.naive) s = step(s, { t: 'setRates', ...bestRates(s) }, now);
  if (s.pendingBonus) s = step(s, { t: 'allocateBonus', choice: 'reserve' }, now);
  if (s.story && !s.story.chosen) s = step(s, { t: 'story', key: s.story.options[s.cash > 12000 ? 0 : 1].key }, now);

  const reserve = 1500 + TIERS[s.tier - 1].fixed;
  const pend = s.orders.filter((o) => o.status === 'pending').sort((a, b) => urgency(s, b) - urgency(s, a));
  for (const o of pend) {
    if (bot.naive) {
      s = step(s, { t: 'approve', orderId: o.id }, now);
      continue;
    }
    const asset = s.assets.find((a) => a.id === o.assetId);
    const exp = expectedDeferralCost(s, o).cost;
    const critical = (asset && asset.health < 70) || o.kind === 'inspect100' || o.kind === 'codeprep' || o.deferrals >= 2;
    const worth = exp >= o.cost * 0.6 || critical;
    if (worth && s.cash - o.cost >= reserve) s = step(s, { t: 'approve', orderId: o.id }, now);
    else if (o.lastDeferredWeek !== s.week) s = step(s, { t: 'defer', orderId: o.id, reason: s.cash - o.cost < reserve ? 'cash' : 'priority' }, now);
  }
  for (const o of s.orders.filter((x) => x.role === 'fin' && x.status === 'ready')) {
    const sc = score(r, bot.skill);
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

export type SimWeek = {
  week: number;
  tier: number;
  grade: string;
  revenue: number;
  cash: number;
  incidents: number;
  flights: string;
  houses: string;
};

export function simulate(team: Team, weeks: number, seed: number) {
  let now = Date.UTC(2026, 8, 1, 12);
  let s = createIsland({ id: `sim-${seed}`, name: 'Sim Island', now, tz: 'Europe/Paris', seed: hashSeed('sim', seed), creator: { uid: 'u-mech', name: 'M', role: 'mech' } });
  s = step(s, { t: 'join', uid: 'u-elec', name: 'E', role: 'elec' }, now);
  s = step(s, { t: 'join', uid: 'u-fin', name: 'F', role: 'fin' }, now);
  for (const role of ROLES) s = step(s, { t: 'week0Done', role }, now);
  const r = rng(hashSeed('bots', seed));
  const out: SimWeek[] = [];
  let minCash = s.cash;
  for (let w = 0; w < weeks; w++) {
    const week = s.week;
    const order = r.shuffle([...ROLES]);
    for (const role of order) {
      const bot = team[role];
      if (bot.absent || (bot.miss && r.chance(bot.miss))) continue;
      if (role === 'fin') s = playFin(s, bot, r, now);
      else s = playOps(s, role, bot, r, now);
      s = step(s, { t: 'endTurn', role }, now);
    }
    if (s.week === week) {
      now = (s.deadline ?? now) + 1000;
      s = step(s, { t: 'resolve', week }, now);
    } else now += 86400_000;
    const h = s.history[s.history.length - 1];
    minCash = Math.min(minCash, h.cashEnd);
    out.push({
      week: h.week,
      tier: h.tier,
      grade: h.grade,
      revenue: h.revenue,
      cash: h.cashEnd,
      incidents: h.incidents.length,
      flights: `${h.flightsFlown}/${h.flightsScheduled}`,
      houses: `${h.housesBooked}/${h.housesRentable}`,
    });
  }
  return { weeks: out, final: s, minCash };
}

export { logistic };
