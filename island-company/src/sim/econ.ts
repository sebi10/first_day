// Pure economic formulas shared by the engine, the UI previews and the balance sim.
import { CATALOG_BY_KIND, DEFECT, ECON, MODELS, REPORT, REPORT_BY_KEY, ROLE_LABEL, TIERS } from './data';
import type { Asset, IslandState, Order, Role, Weather } from './types';

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const round10 = (v: number) => Math.round(v / 10) * 10;

export const tierDef = (tier: number) => TIERS[clamp(tier, 1, 5) - 1];

export function logistic(rate: number, mid: number, s: number) {
  return 1 / (1 + Math.exp((rate - mid) / s));
}

export function season(week: number, seed: number) {
  const phase = seed % ECON.seasonPeriod;
  return 1 + ECON.seasonAmp * Math.sin((2 * Math.PI * (week + phase)) / ECON.seasonPeriod);
}

export function modifierMult(s: IslandState, kind: 'demand' | 'charterDemand', week: number) {
  return s.modifiers.filter((m) => m.kind === kind && m.until >= week).reduce((acc, m) => acc * m.mult, 1);
}

/** Expected occupancy (0..1) of a cottage-class house for a nightly rate */
// Season moves what guests will pay (the logistic midpoint), so the best
// price changes week to week and the analyst has to keep reading the market.
export function occupancy(s: IslandState, rate: number, week = s.week) {
  return clamp(logistic(rate, ECON.nightlyMid * season(week, s.seed), ECON.nightlyS) * modifierMult(s, 'demand', week), 0, 1);
}

export function charterLoad(s: IslandState, rate: number, week = s.week) {
  return clamp(logistic(rate, ECON.charterMid * season(week, s.seed), ECON.charterS) * modifierMult(s, 'charterDemand', week), 0, 1);
}

/** safety calls: a grounded plane or a red-tagged house is out of service this week */
export const isTagged = (s: IslandState, id: string) => !!s.tags?.[id];
export function capOf(s: IslandState, p: Asset, weather: Weather = s.weather) {
  return isTagged(s, p.id) ? 0 : planeCapacity(p, s.tier, weather);
}

export const rateBounds = (base: number, receivership: boolean) => ({
  min: Math.round(base * ECON.rateFloor),
  max: Math.round(base * (receivership ? 1 : ECON.rateCap)),
});

export function flightsPerPlane(tier: number) {
  return ECON.flightsPerPlane + (tierDef(tier).nightFlights ? 1 : 0);
}

/** flights a plane can fly this week given airworthiness + weather */
export function planeCapacity(a: Asset, tier: number, weather: Weather) {
  const per = flightsPerPlane(tier);
  let cap = a.health >= 60 ? per : a.health >= 40 ? Math.ceil(per / 2) : 0;
  if (weather === 'wind') cap = Math.max(0, cap - 1);
  if (weather === 'storm') cap = Math.floor(cap / 2);
  return cap;
}

export const planes = (s: IslandState) => s.assets.filter((a) => a.kind === 'plane');
export const houses = (s: IslandState) => s.assets.filter((a) => a.kind === 'house');
export const grid = (s: IslandState) => s.assets.find((a) => a.kind === 'grid');
export const generator = (s: IslandState) => s.assets.find((a) => a.kind === 'generator');

export function powered(s: IslandState) {
  const g = grid(s);
  const gen = generator(s);
  const gridDown = !g || g.health < 40;
  return { gridDown, genOK: !!gen && gen.health >= 50, on: !gridDown || (!!gen && gen.health >= 50) };
}

export function houseRentable(s: IslandState, h: Asset, week = s.week) {
  return !isTagged(s, h.id) && powered(s).on && h.health >= 40 && (h.inspectionUntil ?? 0) >= week;
}

export function houseBlocker(s: IslandState, h: Asset, week = s.week): string | null {
  if (isTagged(s, h.id)) return 'red-tagged';
  if (!powered(s).on) return 'no power';
  if (h.health < 40) return `reliability ${Math.round(h.health)}`;
  if ((h.inspectionUntil ?? 0) < week) return 'inspection lapsed';
  return null;
}

export function passengerFlights(s: IslandState) {
  return planes(s)
    .filter((p) => !MODELS[p.model].cargo)
    .reduce((n, p) => n + capOf(s, p), 0);
}

export function flightsAvailable(s: IslandState) {
  return planes(s).reduce((n, p) => n + capOf(s, p), 0);
}

export function housesRentable(s: IslandState) {
  return houses(s).filter((h) => houseRentable(s, h)).length;
}

export function deferralRisk(o: Pick<Order, 'tier' | 'deferrals'>, extraWeeks = 0) {
  const d = ECON.deferral;
  const weeks = Math.max(1, o.deferrals + extraWeeks);
  return Math.min(d.cap, d.base + d.perTier * (o.tier - 1) + d.perWeek * (weeks - 1));
}

/** Rough weekly revenue for one house at the current rate (used for downstream costs) */
export function houseWeekRevenue(s: IslandState, h: Asset) {
  return 7 * s.rates.nightly * (MODELS[h.model].mult ?? 1) * occupancy(s, s.rates.nightly);
}

/** Expected USD cost of deferring an order one more week (shown next to Approve). */
export function expectedDeferralCost(s: IslandState, o: Order) {
  const p = deferralRisk(o, o.lastDeferredWeek === s.week ? 0 : 1);
  const asset = s.assets.find((a) => a.id === o.assetId);
  let downstream = 0;
  if (asset?.kind === 'plane') {
    const perFlight = MODELS[asset.model].cargo ? 250 : s.rates.charter * charterLoad(s, s.rates.charter);
    downstream = Math.min(flightsPerPlane(s.tier), 2) * perFlight;
  } else if (asset?.kind === 'house') downstream = houseWeekRevenue(s, asset);
  else if (asset?.kind === 'grid') downstream = houses(s).reduce((n, h) => n + houseWeekRevenue(s, h), 0) * 0.5;
  else if (asset) downstream = 400;
  return { p, cost: Math.round(p * (ECON.deferral.costMult * o.cost + downstream)) };
}

/** Deterministic tier for an order: catalog tier, +1 if the asset is in bad shape, +island tier drift */
export function orderTier(kind: string, a: Asset | undefined, islandTier: number) {
  const c = CATALOG_BY_KIND[kind];
  const base = c ? c.tier : 1;
  return clamp(base + (a && a.health < 50 ? 1 : 0) + Math.floor(islandTier / 2), 1, 5);
}

export function orderCost(kind: string, tier: number) {
  const c = CATALOG_BY_KIND[kind];
  return round10(c.cost * (1 + 0.2 * (tier - c.tier)));
}

/** A pass (60%) signs off an inspection, same as the puzzles' PASS. */
export const SIGNOFF = 0.6;

/** Below this an owner's job fails its own check and stays open (rework). */
export const REWORK_BELOW = 0.4;

/** Work credit keeps rising with skill: a bare pass (60%) earns 81%, a clean job 105%. */
export function workCredit(score: number) {
  return 0.45 + 0.6 * Math.min(1, Math.max(0, score));
}

export function credit(score: number, perfects: number) {
  return workCredit(score) * (1 + Math.min(15, perfects) / 100);
}

/**
 * Does a result this low send an owner's job back for rework? Trade jobs on an
 * asset and report fixes, not crew projects. Teaching tiers only: a blind
 * sign-off never reworks (hidden defects replace it), so pass `blind`.
 */
export function isRework(o: { role: string; kind: string; assetId: string | null }, score: number, blind = false) {
  if (blind || o.kind === 'project') return false;
  return (o.kind === 'report' || (o.role !== 'fin' && o.assetId !== null)) && score < REWORK_BELOW;
}

// ---------------------------------------------------------------------------
// Blind sign-off and hidden defects

/** The puzzle tier a seat plays an order at: lending a hand is expert (3+), a new player's grace plays tier 1. */
export function launchTier(s: IslandState, o: Pick<Order, 'tier'>, role: Role, assist = false) {
  const p = s.players[role];
  const grace = !assist && !!p && s.week <= p.graceUntil;
  return assist ? Math.max(3, o.tier) : grace ? 1 : o.tier;
}

/**
 * Blind sign-off: a real work order (not week 0, not practice or the weekly
 * challenge, not lend-a-hand) launched at puzzle tier 2+. The puzzle gives no
 * verdict; how good it was shows up later.
 */
export function isBlind(s: IslandState, o: Pick<Order, 'tier' | 'role'>, role: Role, assist = false) {
  return s.week >= 1 && !assist && o.role === role && launchTier(s, o, role) >= DEFECT.blindFromTier;
}

/** Chance a signed-off job leaves a latent defect, from its TRUE score. */
export function defectChance(q: number) {
  const d = DEFECT;
  if (q >= d.clean) return 0;
  if (q >= SIGNOFF) return (d.clean - q) * d.slope;
  return Math.min(1, d.botchBase + (SIGNOFF - q) * d.botchSlope);
}

export const defectSeverity = (q: number): 1 | 2 => (q < DEFECT.severeBelow ? 2 : 1);

/** Open cross-trade reports (reports the fixer hasn't done yet). */
export const openReports = (s: IslandState) => s.orders.filter((o) => o.kind === 'report' && o.status !== 'done' && o.status !== 'cancelled');

/**
 * A 'cap' report this role raised and nobody has fixed: its jobs per turn are
 * limited. `text` is the ready-made notice for the reporter's screen.
 */
export function reportCap(s: IslandState, role: Role): { order: Order; limit: number; text: string } | null {
  const o = openReports(s).find((x) => x.report?.by === role && x.report.effect === 'cap');
  if (!o) return null;
  const def = REPORT_BY_KEY[o.report!.key];
  const limit = role === 'fin' ? REPORT.capFin : REPORT.capOps;
  const fixer = s.players[o.role]?.name ?? ROLE_LABEL[o.role];
  const what = role === 'fin' ? (limit === 1 ? 'desk task' : 'desk tasks') : limit === 1 ? 'job' : 'jobs';
  return { order: o, limit, text: `${def?.notice ?? o.title}: ${limit} ${what} max until ${fixer} ${def?.fixes ?? 'fixes'} ${def?.it ?? 'it'}.` };
}

export function urgency(s: IslandState, o: Order) {
  if (o.kind === 'project') return 1000; // the crew's shared build always comes first
  const a = s.assets.find((x) => x.id === o.assetId);
  return (
    o.deferrals * 30 +
    o.tier * 10 +
    (a ? 100 - a.health : 0) +
    (o.kind === 'codeprep' || o.kind === 'inspect100' ? 40 : 0) +
    (o.squawk ? 20 : 0) +
    // a crewmate is stuck until it's fixed; a known defect is still in service
    (o.kind === 'report' ? 150 : 0) +
    (o.kind === 'repair' ? 40 : 0) +
    (o.redo ? 15 : 0)
  );
}

/** Expected revenue for the current week with no noise (analyst desk preview). */
export function projectWeek(s: IslandState, rates = s.rates) {
  const td = tierDef(s.tier);
  const pax = planes(s).filter((p) => !MODELS[p.model].cargo);
  const paxFlights = pax.reduce((n, p) => n + capOf(s, p), 0);
  const rentable = houses(s)
    .filter((h) => houseRentable(s, h))
    .sort((a, b) => b.health - a.health);
  const booked = rentable.slice(0, paxFlights + td.ferry);
  const occ = occupancy(s, rates.nightly);
  const rental = booked.reduce((n, h) => n + 7 * rates.nightly * (MODELS[h.model].mult ?? 1) * occ, 0);
  let guestNeed = Math.max(0, booked.length - td.ferry);
  const load = charterLoad(s, rates.charter);
  let charter = 0;
  for (const p of [...pax].sort((a, b) => (MODELS[a.model].mult ?? 1) - (MODELS[b.model].mult ?? 1))) {
    const n = capOf(s, p);
    const used = Math.min(guestNeed, n);
    guestNeed -= used;
    charter += (n - used) * rates.charter * (MODELS[p.model].mult ?? 1) * load;
  }
  return {
    revenue: Math.round(rental + charter),
    rental: Math.round(rental),
    charter: Math.round(charter),
    booked: booked.length,
    rentable: rentable.length,
    spareFlights: Math.max(0, paxFlights - Math.max(0, booked.length - td.ferry)),
    occ,
    load,
    budget: td.budget,
    fixed: td.fixed,
  };
}
