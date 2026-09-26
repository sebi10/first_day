// Pure economic formulas shared by the engine, the UI previews and the balance sim.
import { CATALOG_BY_KIND, ECON, MODELS, TIERS } from './data';
import type { Asset, IslandState, Order, Weather } from './types';

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

export function credit(score: number, perfects: number) {
  return Math.min(1, score / 0.6) * (1 + Math.min(15, perfects) / 100);
}

export function urgency(s: IslandState, o: Order) {
  const a = s.assets.find((x) => x.id === o.assetId);
  return o.deferrals * 30 + o.tier * 10 + (a ? 100 - a.health : 0) + (o.kind === 'codeprep' || o.kind === 'inspect100' ? 40 : 0);
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
