// Pure economic formulas shared by the engine, the UI previews and the balance sim.
import { soleGuest, symptomOf } from './alerts';
import { CATALOG_BY_KIND, DEFECT, ECON, FREIGHT, GSE, MODELS, PROJECT_COVER, REPORT, REPORT_BY_KEY, ROLE_LABEL, SUBCHARTER, TIERS } from './data';
import { charterMult, housekeepingCap, payroll, pilotCap, reviewMult } from './staff';
import type { Alert, Asset, CableBand, GseCart, IslandState, Order, Role, TurnState, Weather } from './types';

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
/** a plane waiting on a part (the open part chain): not airworthy until it's installed. A chain the job flow's research opened doesn't ground by itself (its alert does, if it is an airworthiness one) */
export const chainAog = (s: Pick<IslandState, 'chain'>, id: string) => !!s.chain && s.chain.step !== 'done' && s.chain.assetId === id && !s.chain.flow;

/**
 * The alert that grounds a plane (10): an open or planned (not signed off) airworthiness alert on it, due by `week`,
 * not placarded through it. Every plane, the only guest plane too: flying past the item's due week (or its MEL
 * interval) isn't legal. The only guest plane's guests fly in on the mainland sub-charter meanwhile (`subCharterOn`)
 */
export function alertAog(s: Pick<IslandState, 'alerts'>, planeId: string, week = (s as IslandState).week): Alert | undefined {
  return (s.alerts ?? []).find((a) => a.assetId === planeId && a.status !== 'closed' && a.kind !== 'repair' && !!symptomOf(a)?.aw && a.due <= week && !(a.mel && a.mel.until >= week));
}
/** an open or planned alert on the plane placarded INOP under the MEL (category C) through `week`: it flies on the placard */
export function melOn(s: Pick<IslandState, 'alerts'>, planeId: string, week = (s as IslandState).week): Alert | undefined {
  return (s.alerts ?? []).find((a) => a.assetId === planeId && a.status !== 'closed' && !!a.mel && a.mel.until >= week);
}
/** an open or planned hazard alert on a house (it closes the house until it's made safe or fixed) */
export function hazardOn(s: Pick<IslandState, 'alerts'>, houseId: string): Alert | undefined {
  return (s.alerts ?? []).find((a) => a.assetId === houseId && a.status !== 'closed' && !!symptomOf(a)?.hazard);
}
/** 0.75 while a made-safe hazard is open on the house, else 1 */
export const rentFactor = (s: Pick<IslandState, 'alerts'>, h: Pick<Asset, 'id'>) => (hazardOn(s, h.id)?.safe ? 0.75 : 1);

/** not airworthy: the part chain's AOG, or an airworthiness alert past due */
export const isAog = (s: IslandState, id: string) => chainAog(s, id) || !!alertAog(s, id);
/** out of service (a safety call, or AOG): no flights or guests, and nothing can fail in service */
export const outOfService = (s: IslandState, id: string) => isTagged(s, id) || isAog(s, id);
export function capOf(s: IslandState, p: Asset, weather: Weather = s.weather) {
  if (outOfService(s, p.id)) return 0;
  return planeCapacity(p, s.tier, weather);
}

// ---------------------------------------------------------------------------
// The mainland sub-charter: the only guest plane on the ground, an outside operator flies its guests

/** what the island pays the operator a flight (data.ts SUBCHARTER: the island's own cost of a guest flight x the operator's premium) */
export const SUB_FEE = round10(SUBCHARTER.ownPerFlight * SUBCHARTER.mult);

/**
 * The flights a mainland sub-charter flies for the only guest plane's guests in a week it's down: the guests who
 * need a seat (the houses that can rent and the housekeepers can turn over, less the ferry's parties), up to the
 * plane's own schedule in that weather. null: not the only guest plane (another guest plane carries its guests).
 * The operator's own crew flies it, so the island's pilots don't cap it; it sells no day tours.
 */
export function subCharterNeed(s: IslandState, planeId: string, weather: Weather = s.weather, week = s.week): { flights: number; cap: number; fee: number; usd: number } | null {
  const p = s.assets.find((a) => a.id === planeId);
  if (!p || !soleGuest(s, planeId)) return null;
  const rentable = houses(s).filter((h) => houseRentable(s, h, week)).length;
  const guests = Math.max(0, Math.min(rentable, housekeepingCap(s)) - tierDef(s.tier).ferry);
  // `cap`: what the operator could fly in on the plane's schedule in that weather (the review's empty-house lines read it)
  const cap = planeCapacity({ ...p, health: 100 }, s.tier, weather);
  const flights = Math.min(guests, cap);
  return { flights, cap, fee: SUB_FEE, usd: flights * SUB_FEE };
}

/**
 * The week's sub-charter: the only guest plane is out of service (AOG on an airworthiness alert past due, a part
 * chain's AOG, or the mechanic's safety call this week), so the operator flies the guests in. `alert`: the one that
 * grounds it, if that's why. A future week (the cards' "past week N") counts the alerts, not this week's safety call.
 */
export function subCharterOn(s: IslandState, week = s.week, weather: Weather = s.weather): { plane: Asset; alert?: Alert; flights: number; cap: number; fee: number; usd: number } | null {
  for (const p of planes(s)) {
    if (!soleGuest(s, p.id)) continue;
    const al = alertAog(s, p.id, week);
    if (!al && !chainAog(s, p.id) && !(week === s.week && isTagged(s, p.id))) return null;
    const need = subCharterNeed(s, p.id, weather, week)!;
    return { plane: p, ...(al ? { alert: al } : {}), ...need };
  }
  return null;
}

/** the first week an airworthiness alert grounds its plane: its due week, or the week after its MEL placard runs out (never before this week) */
export const groundsFrom = (s: Pick<IslandState, 'week'>, a: Pick<Alert, 'due' | 'mel'>) => Math.max(s.week, a.due, a.mel ? a.mel.until + 1 : 0);

/** "about $540 a week (2 flights at $270)": what a week of the sub-charter costs, for the cards and the MEL words */
export function subCharterWords(n: { flights: number; fee: number; usd: number }): string {
  return n.flights > 0 ? `about $${n.usd.toLocaleString('en-US')} a week (${n.flights} flight${n.flights > 1 ? 's' : ''} at $${n.fee})` : `$${n.fee} a flight (no guests booked this week)`;
}

/** the fixed cost a week: the tier's overhead plus the staff's payroll (the stubs: today's fixed cost) */
export const fixedNow = (s: IslandState) => tierDef(s.tier).overhead + payroll(s);

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

/** how far ahead the county's notice comes (E_CODE_DUE's lead): a prep inside this window is ready for the booked date */
export const INSPECTION_NOTICE = 2;

/**
 * A house's next inspection date when its code prep is signed off in week `W` (the robust tail, 2026-09-28). The
 * county inspects on the booked date, so a prep done ahead of it (the notice comes 2 weeks out) renews from that
 * date, not from the week of the prep: the certificate is 8 weeks from the inspection, as a real one runs. A lapsed
 * inspection is re-done at once (from `W`); a prep further ahead than the notice counts from `W` too, so preps can't
 * push the date out.
 */
export function renewedInspection(s: Pick<IslandState, 'assets'>, h: Pick<Asset, 'id' | 'inspectionUntil'>, W: number): number {
  const until = h.inspectionUntil ?? 0;
  const on = until >= W && until - W <= INSPECTION_NOTICE ? until : W;
  return bookInspection(s, h.id, on + ECON.houseInspectionWeeks);
}

/** how many weeks past the due date the county will book a house's inspection to find a week of its own */
export const INSPECTION_SLIP = 3;

/**
 * The week the county books a house's inspection for, from `target` (the robust tail, 2026-09-28): its inspector
 * does one of the island's houses a week, so a house whose date another house already holds goes to the next free
 * week, up to INSPECTION_SLIP weeks later (else the date as asked). Houses built together (a tier's pair) get their
 * notices a week apart instead of all at once, and an island whose houses are in step (a live doc, the inspector
 * story card's one visit) spreads out as they renew.
 */
export function bookInspection(s: Pick<IslandState, 'assets'>, id: string, target: number): number {
  const taken = new Set(s.assets.filter((a) => a.kind === 'house' && a.id !== id).map((a) => a.inspectionUntil));
  for (let w = target; w <= target + INSPECTION_SLIP; w++) if (!taken.has(w)) return w;
  return target;
}

/**
 * A flow job planned ahead of its alert's due week is on schedule, not put off (the robust tail, 2026-09-28): the
 * week's carry-over doesn't count it as a deferral, so it rolls no deferral risk until its due week has passed,
 * exactly as the alert left unplanned would (resolve step 7). Planning early never costs more than waiting.
 */
export function onSchedule(s: Pick<IslandState, 'alerts'>, o: Pick<Order, 'flow'>, week: number): boolean {
  if (!o.flow) return false;
  const al = s.alerts?.find((a) => a.id === o.flow!.alert);
  return !!al && al.due > week;
}

/**
 * The week's resolve at which autopilot does a seat's crew project part if that seat is still away (PROJECT_COVER),
 * or null when it won't: nothing of that seat's left to do, or a seat nobody has played for PROJECT_COVER.recent
 * weeks or more (then the part waits for its player, as before).
 */
export function projectCoverWeek(s: Pick<IslandState, 'project' | 'orders' | 'players'>, role: Role): number | null {
  const id = s.project?.orders[role];
  const o = id ? s.orders.find((x) => x.id === id) : undefined;
  const p = s.players[role];
  if (!o || o.status !== 'ready' || !p || p.missedStreak >= PROJECT_COVER.recent) return null;
  return o.createdWeek + PROJECT_COVER.wait;
}

export function houseRentable(s: IslandState, h: Asset, week = s.week) {
  const hz = hazardOn(s, h.id);
  return !isTagged(s, h.id) && powered(s).on && h.health >= 40 && (h.inspectionUntil ?? 0) >= week && !(hz && !hz.safe);
}

export function houseBlocker(s: IslandState, h: Asset, week = s.week): string | null {
  if (isTagged(s, h.id)) return 'red-tagged';
  if (!powered(s).on) return 'no power';
  const hz = hazardOn(s, h.id);
  if (hz && !hz.safe) return 'hazard';
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

/** Hangar jobs done this turn: the part chain's paperwork needs no hangar tools, so the grid-down cap doesn't count it. */
export const hangarJobs = (t?: Pick<TurnState, 'done' | 'paper'>) => (t?.done ?? 0) - (t?.paper ?? 0);

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
    (o.redo ? 15 : 0) +
    // a plane is down until the part chain is through
    (o.chain ? 120 : 0) +
    // the job flow: an airworthiness or hazard alert, due now (it grounds a plane or closes a house at this resolve)
    flowUrgency(s, o)
  );
}

function flowUrgency(s: IslandState, o: Order): number {
  if (!o.flow) return 0;
  const a = s.alerts?.find((x) => x.id === o.flow!.alert);
  const sym = a ? symptomOf(a) : undefined;
  if (!a || !sym) return 0;
  // only what bites at this resolve jumps the queue (a load sheet still goes before next week's work)
  return (!!sym.aw || !!sym.hazard) && a.due <= s.week ? 150 : 0;
}

/**
 * The fleet's flights this week, as the resolve flies them (step 2): each
 * plane's capacity, then the pilots' caps (D: `pilotCap`) on the guest planes
 * and on the whole fleet, taking flights off the cargo plane first so guests
 * keep flying. Returns the flights per plane.
 */
export function capFleet(s: IslandState, caps: { plane: Asset; n: number }[]): { plane: Asset; n: number }[] {
  const cap = pilotCap(s);
  const out = caps.map((c) => ({ ...c }));
  const guest = out.filter((c) => !MODELS[c.plane.model].cargo);
  let over = guest.reduce((n, c) => n + c.n, 0) - cap.guest;
  for (const c of [...guest].reverse()) {
    if (over <= 0) break;
    const cut = Math.min(c.n, over);
    c.n -= cut;
    over -= cut;
  }
  over = out.reduce((n, c) => n + c.n, 0) - cap.total;
  for (const c of [...out].sort((a, b) => Number(!!MODELS[b.plane.model].cargo) - Number(!!MODELS[a.plane.model].cargo))) {
    if (over <= 0) break;
    const cut = Math.min(c.n, over);
    c.n -= cut;
    over -= cut;
  }
  return out;
}

/** Expected revenue for the current week with no noise (analyst desk preview): the same caps as the resolve (pilots, housekeeping, reviews, tours, a made-safe house's rent). */
export function projectWeek(s: IslandState, rates = s.rates) {
  const td = tierDef(s.tier);
  const fleet = capFleet(
    s,
    planes(s).map((p) => ({ plane: p, n: capOf(s, p) })),
  );
  const pax = fleet.filter((c) => !MODELS[c.plane.model].cargo);
  const paxFlights = pax.reduce((n, c) => n + c.n, 0);
  // the only guest plane down: the mainland sub-charter flies its guests in (a cost, not revenue)
  const sub = subCharterOn(s);
  const subFlights = sub?.flights ?? 0;
  const rentable = houses(s)
    .filter((h) => houseRentable(s, h))
    .sort((a, b) => b.health - a.health);
  const booked = rentable.slice(0, Math.min(paxFlights + subFlights + td.ferry, housekeepingCap(s)));
  const occ = clamp(occupancy(s, rates.nightly) * reviewMult(s, booked.length), 0, 1);
  const rental = booked.reduce((n, h) => n + 7 * rates.nightly * (MODELS[h.model].mult ?? 1) * occ * rentFactor(s, h), 0);
  let guestNeed = Math.max(0, booked.length - td.ferry - subFlights);
  const load = charterLoad(s, rates.charter) * charterMult(s);
  let charter = 0;
  for (const c of [...pax].sort((a, b) => (MODELS[a.plane.model].mult ?? 1) - (MODELS[b.plane.model].mult ?? 1))) {
    const used = Math.min(guestNeed, c.n);
    guestNeed -= used;
    charter += (c.n - used) * rates.charter * (MODELS[c.plane.model].mult ?? 1) * load;
  }
  return {
    revenue: Math.round(rental + charter),
    rental: Math.round(rental),
    charter: Math.round(charter),
    booked: booked.length,
    rentable: rentable.length,
    spareFlights: Math.max(0, paxFlights - Math.max(0, booked.length - td.ferry - subFlights)),
    /** the mainland sub-charter this week: its flights and what the island pays for them */
    subFlights,
    subCharter: sub?.usd ?? 0,
    occ,
    load,
    budget: td.budget,
    fixed: fixedNow(s),
  };
}

/**
 * What a week with this plane down costs, as an analyst would put it on the
 * card: the guests and charters it would have flown (the week's revenue with
 * it flying, less without; the only guest plane: the day tours it would have
 * flown and the mainland sub-charter that flies its guests), or, for the cargo
 * plane, the boat the kits wait for
 * while it's down. `flights`: what it flies in a week when it's up.
 */
export function downtimeOf(s: IslandState, assetId: string): { flights: number; usd: number; cargo: boolean } {
  const p = s.assets.find((a) => a.id === assetId);
  if (!p) return { flights: 0, usd: 0, cargo: false };
  const flights = planeCapacity({ ...p, health: Math.max(p.health, 60) }, s.tier, 'clear');
  if (MODELS[p.model].cargo) {
    // the cargo plane down holds its bulk POs due this week: the AOG boat for any that carries a line for safety work, else nothing
    const safety = (orderId?: string) => {
      const o = orderId ? s.orders.find((x) => x.id === orderId) : undefined;
      const a = o?.flow ? s.alerts?.find((x) => x.id === o.flow!.alert) : undefined;
      const sym = a ? symptomOf(a) : undefined;
      return !!sym && (!!sym.aw || !!sym.hazard);
    };
    const boats = (s.pos ?? []).filter((po) => po.status === 'open' && po.carrier === 'bulk' && po.freight === 'sched' && po.eta <= s.week && po.lines.some((l) => safety(l.order))).length;
    return { flights, usd: boats * FREIGHT.aog, cargo: true };
  }
  const up = projectWeek({
    ...s,
    chain: s.chain?.assetId === assetId ? null : s.chain,
    alerts: (s.alerts ?? []).filter((a) => a.assetId !== assetId),
    tags: { ...(s.tags ?? {}), [assetId]: undefined as never },
  }).revenue;
  const down = projectWeek({ ...s, tags: { ...(s.tags ?? {}), [assetId]: 'mech' }, chain: s.chain });
  return { flights, usd: Math.max(0, up - down.revenue + down.subCharter), cargo: false };
}

// ---------------------------------------------------------------------------
// Ground power carts

/** A cart as it comes to the island: full, on the charger. */
export function newCart(c: { id: string; name: string }): GseCart {
  return { id: c.id, name: c.name, charge: 100, wear: c.id === GSE.carts[0].id ? GSE.startWear : 0, hookedTo: null, charging: true, inspected: null };
}

/**
 * The island's ground power carts: the stored ones, plus any its tier has
 * brought that aren't stored yet. An island saved before carts existed stores
 * none, and gets the default (on the charger, full) the first time it is read.
 */
export function gseCarts(s: Pick<IslandState, 'gse' | 'tier'>): GseCart[] {
  const out = s.gse ? [...s.gse] : [];
  for (const c of GSE.carts) if (c.tier <= s.tier && !out.some((x) => x.id === c.id)) out.push(newCart(c));
  return out;
}

/** What an inspection sees on a cable this worn. */
export const cableBand = (wear: number): CableBand => (wear >= GSE.pitted ? 'pitted' : wear >= GSE.cracked ? 'cracked' : 'good');

/** The open report that has this cart tagged out (its cable is cracked at the plug), if any. */
export const cableReport = (s: IslandState, cartId: string) => openReports(s).find((o) => o.report?.key === 'gpuCable' && o.report.cart === cartId);

/** The cart hooked up to this plane, if any. */
export const cartOn = (s: IslandState, assetId: string | null) => (assetId ? gseCarts(s).find((c) => c.hookedTo === assetId) : undefined);

/** The jobs that run off a ground power cart hooked up to the plane: a start, and the radio work (its ops check needs the bus powered). */
export const needsCart = (kind: string) => kind === 'gpustart' || kind === 'avionics';

/**
 * A ground power start needs a charged cart hooked up to that plane, with a
 * cable that isn't tagged out; so does avionics work (the radio's ops check
 * runs the bus on ground power, not on a battery that sags). `blocker` says
 * what is missing (the card shows it, and the engine refuses the job with it).
 */
export function gseForStart(s: IslandState, o: Pick<Order, 'kind' | 'assetId'>): { cart: GseCart | null; blocker: string | null } {
  if (!needsCart(o.kind)) return { cart: null, blocker: null };
  const plane = s.assets.find((a) => a.id === o.assetId)?.name ?? 'the plane';
  const why = o.kind === 'avionics' ? ": the radio's ops check runs the bus on ground power" : '';
  const cart = cartOn(s, o.assetId) ?? null;
  if (!cart) {
    // the only charged cart may be sitting on another plane (one that's AOG for a part isn't going anywhere): say where
    const away = startCart(s, o.assetId);
    const at = away?.hookedTo ? s.assets.find((a) => a.id === away.hookedTo) : undefined;
    const down = at ? (isAog(s, at.id) ? ', AOG for a part' : isTagged(s, at.id) ? ', grounded this week' : '') : '';
    // no cart could do it: a tagged-out one says who has it
    const out = away ? undefined : gseCarts(s).map((c) => ({ c, rep: cableReport(s, c.id) })).find((x) => x.rep);
    const note = at
      ? `: ${away!.name} is on ${at.name}${down}`
      : out
        ? `: ${out.c.name} is tagged out until ${s.players[out.rep!.role]?.name ?? ROLE_LABEL[out.rep!.role]} fixes its cable`
        : why;
    return { cart, blocker: `Hook a charged cart up to ${plane} first${note}` };
  }
  const rep = cableReport(s, cart.id);
  if (rep) return { cart, blocker: `${cart.name} is tagged out until ${s.players[rep.role]?.name ?? ROLE_LABEL[rep.role]} fixes its cable: hook up another cart` };
  if (cart.charge < GSE.minStart) return { cart, blocker: `Hook a charged cart up to ${plane} first: ${cart.name} is down to ${Math.round(cart.charge)}%` };
  return { cart, blocker: null };
}

/**
 * The cart for a start on this plane, as the mechanic would pick it: the one
 * already on it if it's charged and in service; else the best-charged one on
 * the charger or parked; else one hooked up to another plane, a plane that
 * isn't flying first (AOG for a part, or grounded: it needs its cart least).
 * Autopilot and the paper-sim bots use it, so a cart left on a grounded plane
 * never holds up the starts, and the start's card uses it to say where the
 * cart is. Null: no charged cart in service (or no plane).
 */
export function startCart(s: IslandState, assetId: string | null): GseCart | null {
  if (!assetId) return null;
  const ok = (c: GseCart) => c.charge >= GSE.minStart && !cableReport(s, c.id);
  const carts = gseCarts(s);
  const on = carts.find((c) => c.hookedTo === assetId);
  if (on && ok(on)) return on;
  const rank = (c: GseCart) => (!c.hookedTo ? 0 : outOfService(s, c.hookedTo) ? 1 : 2);
  return carts.filter((c) => ok(c) && c.hookedTo !== assetId).sort((a, b) => rank(a) - rank(b) || b.charge - a.charge)[0] ?? null;
}
