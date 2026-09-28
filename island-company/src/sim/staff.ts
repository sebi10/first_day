// NPC staff: pilots, housekeepers and builders on the island's payroll
// (docs/JOBFLOW.md 15). NPCs never do mechanic, electrician or analyst work:
// they fly the planes, turn the houses over between guests and do the site
// work for new buildings. The analyst decides who is on the payroll (hire, let
// go, and how skilled: a better hire costs more and does more).
//
// Stored: the staff, this week's hiring board and the builds. Everything that
// follows from them (who flies which plane, the caps, the payroll, the effect
// statements) is derived here. With the standard crew for the tier, all at
// skill 3, the island plays exactly as before the staff update: the pilots fly
// every scheduled flight, housekeeping turns over every booking, and the
// builders finish each tier's site work before the crew project brings the tier.
//
// Randomness: the hiring board, the hard landings and the builders' rework each
// draw from their own stream (hashSeed(seed, 'hire' | 'landing' | 'build', W)),
// never from the week's, so a staff change moves only what it touches.
import { raiseAlert, soleGuest } from './alerts';
import type { Bot } from './bots';
import { ECON, MODELS, STOCK } from './data';
import { capFleet, capOf, clamp, flightsPerPlane, houseRentable, planes, projectWeek, round10, tierDef } from './econ';
import { apply, type ApplyResult } from './engine';
import { itemById, priceAt } from './items';
import { book, spendable } from './ledger';
import { nextTierProgress } from './progression';
import type { Rng } from './rng';
import { hashSeed, rng } from './rng';
import { available, onOrderFree, placePo, takeStock } from './stock';
import type { Asset, Build, Candidate, IslandState, ItemId, Liner, Npc, NpcRole, StaffAction } from './types';

export const STAFF = {
  /** weekly cost to the company at skill 3 */
  wage: { pilot: 320, housekeeper: 180, builder: 260 } as Record<NpcRole, number>,
  /** x wage, skill 1..5 */
  skillWage: [0.7, 0.85, 1, 1.2, 1.45],
  severanceWeeks: 2,
  /** flights a pilot flies a week */
  duty: 6,
  /** skill 1-2 fly the cargo runs only (company policy) */
  guestMinSkill: 3,
  /** charter load x (1 + charter x (mean skill of the guest planes' pilots - 3)) */
  charter: 0.04,
  /** the `tires` kind's alert weight on the planes a pilot flies, skill 1..5 */
  wear: [1.3, 1.15, 1, 0.9, 0.8],
  /** per flight; never on the only guest plane */
  hardLanding: [0.008, 0.005, 0.003, 0.002, 0.001],
  /** health a hard landing takes */
  hardLandingHit: 2,
  /** added to the NFF share of their pilot squawks */
  squawkNff: [0.1, 0.05, 0, 0, 0],
  /** houses a housekeeper turns over a week */
  turnovers: [2, 3, 4, 5, 6],
  /** occupancy x (1 + review x (mean housekeeper skill - 3)), clamped 0.95..1.05 */
  review: 0.025,
  /** builder work units a week */
  output: [0.6, 0.8, 1, 1.25, 1.5],
  /** a builder-week fails the inspector's check */
  rework: [0.2, 0.12, 0.06, 0.03, 0.01],
  maxStaff: 10,
  /** the standard crew by tier, all skill 3 */
  standard: [
    { pilot: 1, housekeeper: 1, builder: 1 },
    { pilot: 2, housekeeper: 1, builder: 1 },
    { pilot: 2, housekeeper: 1, builder: 1 },
    { pilot: 2, housekeeper: 2, builder: 1 },
    { pilot: 3, housekeeper: 2 },
  ] as Partial<Record<NpcRole, number>>[],
  /** the hiring board: candidates a week (4 from tier 3), role weights for the open slots, skill weights 1..5 */
  board: 3,
  boardT3: 4,
  roleWeight: { pilot: 3, housekeeper: 3, builder: 2 } as Record<NpcRole, number>,
  skillWeight: [25, 30, 25, 15, 5],
};

/**
 * Test switches (the game never sets them, docs/JOBFLOW.md 21.4). `stubs` puts
 * every hook back to package A's stub (the game as it played before the staff
 * update); `hardLandings: false` turns the pilots' hard landings off.
 */
export const STAFF_TEST = { stubs: false, hardLandings: true };

export const NPC_ROLES: NpcRole[] = ['pilot', 'housekeeper', 'builder'];
export const ROLE_NAME: Record<NpcRole, string> = { pilot: 'Pilot', housekeeper: 'Housekeeper', builder: 'Builder' };

/** the standard crew's payroll a week: 760, 1,080, 1,080, 1,260, 1,320 */
export function standardPayroll(tier: number): number {
  const crew = STAFF.standard[Math.max(1, Math.min(5, tier)) - 1];
  return NPC_ROLES.reduce((n, r) => n + (crew[r] ?? 0) * STAFF.wage[r], 0);
}

/** the standard crew's head count for a role at a tier */
export const standardCount = (tier: number, role: NpcRole) => STAFF.standard[Math.max(1, Math.min(5, tier)) - 1][role] ?? 0;

/** a wage at a skill (the ask of a candidate, before its seeded spread) */
export const wageAt = (role: NpcRole, skill: number) => Math.round(STAFF.wage[role] * STAFF.skillWage[skill - 1]);

// ---------------------------------------------------------------------------
// Builds: the builders' site work (15.5)

export interface BuildDef {
  id: string;
  what: string;
  tier?: number;
  /** what the review and the desk call the site ("the villas and the seaplane dock") */
  site?: string;
  /** the materials each work unit draws, in order */
  units: Partial<Record<ItemId, number>>[];
}

export const BUILDS: BuildDef[] = [
  { id: 't2', tier: 2, site: 'cottages 3 and 4', what: 'Set cottages 3 and 4: piers, decks and trim', units: [{ 'BLD-FTG': 1 }, { 'BLD-DECK': 1, 'BLD-TIE': 1 }, { 'BLD-FLASH': 1 }] },
  { id: 't3', tier: 3, site: 'the generator house', what: 'The generator house: pad, piers and roof flashing', units: [{ 'BLD-FTG': 1 }, { 'BLD-FLASH': 1 }] },
  { id: 't4', tier: 4, site: 'the villas and the seaplane dock', what: 'Set the villas and build the seaplane dock', units: [{ 'BLD-FTG': 1 }, { 'BLD-PILE': 1 }, { 'BLD-MDECK': 1, 'BLD-TIE': 1 }, { 'BLD-SHUT': 1 }] },
  { id: 't5', tier: 5, site: 'the Lodge', what: 'Set the Lodge: piers, decks, trim and shutters', units: [{ 'BLD-FTG': 1 }, { 'BLD-DECK': 1, 'BLD-TRIM': 1 }, { 'BLD-FLASH': 1 }, { 'BLD-SHUT': 1 }] },
];

export const COTTAGE: BuildDef = {
  id: 'cottage',
  site: 'the new cottage',
  what: 'An extra cottage: piers, deck, flashing, trim and shutters',
  units: [{ 'BLD-FTG': 1 }, { 'BLD-DECK': 1, 'BLD-TIE': 1 }, { 'BLD-FLASH': 1 }, { 'BLD-TRIM': 1 }, { 'BLD-SHUT': 1 }],
};
/** the prefab shell of an extra cottage (the mainland contractor), paid when it starts */
export const COTTAGE_SHELL = 17000;
/** the extra cottages' plots (the island art draws them in the lagoon grove) and their names */
export const COTTAGE_PLOTS: { id: string; name: string }[] = [
  { id: 'h8', name: 'Cottage 5' },
  { id: 'h9', name: 'Cottage 6' },
];

export const buildDef = (id: string): BuildDef | undefined => (id === 'cottage' || id.startsWith('cottage') ? COTTAGE : BUILDS.find((b) => b.id === id));

/** what a build's site is called ("the villas and the seaplane dock", "Cottage 5") */
export function buildSite(b: Pick<Build, 'id' | 'cottage'>): string {
  if (b.cottage) return COTTAGE_PLOTS.find((p) => p.id === b.cottage)?.name ?? 'the new cottage';
  return buildDef(b.id)?.site ?? 'the site';
}

/** the build the builders work on: the next tier's first, then the cottages the analyst queued */
export function openBuild(s: Pick<IslandState, 'builds' | 'tier'>): Build | undefined {
  const open = (s.builds ?? []).filter((b) => b.finished === undefined && !(b.tier !== undefined && b.tier <= s.tier));
  return open.find((b) => b.tier !== undefined) ?? open.find((b) => b.cottage !== undefined) ?? open[0];
}

/** the materials of a build's unit k */
export function unitLines(b: Pick<Build, 'id'>, k: number): { item: ItemId; qty: number }[] {
  const u = buildDef(b.id)?.units[k];
  return u ? Object.entries(u).map(([item, qty]) => ({ item, qty: qty ?? 0 })) : [];
}

/** a build's next unit whose materials haven't left stock yet, and what of it is short (neither free on the shelf nor on order) */
export function nextUnit(s: IslandState, b: Build): { k: number; lines: { item: ItemId; qty: number; free: number; coming: number; eta?: number; short: number }[] } | null {
  const k = b.drawn ?? 0;
  if (k >= b.need) return null;
  const lines = unitLines(b, k).map((l) => {
    const free = available(s, l.item);
    const o = onOrderFree(s, l.item);
    return { ...l, free, coming: o.qty, ...(o.eta !== undefined ? { eta: o.eta } : {}), short: Math.max(0, l.qty - free - o.qty) };
  });
  return { k, lines };
}

/** the share of a tier's site work the builders had done (new buildings' starting health: 60 + 30 x quality - 15 x (1 - share)) */
export function builtShare(s: IslandState, tier: number): number {
  if (STAFF_TEST.stubs) return 1;
  const b = (s.builds ?? []).find((x) => x.tier === tier);
  if (!b || b.need <= 0) return 1;
  return clamp(b.done / b.need, 0, 1);
}

/**
 * The builds as they should be: a tier that arrived before its site work was
 * done closes that build where it stood (its buildings are up), and when no
 * tier build is open the next tier's opens. Idempotent.
 */
export function tidyBuilds(s: IslandState, W: number, line?: Liner): void {
  if (!s.builds) return;
  for (const b of s.builds) {
    if (b.finished !== undefined || b.tier === undefined || b.tier > s.tier) continue;
    b.finished = W;
    if (b.done < b.need) {
      const lower = Math.round(15 * (1 - clamp(b.done / b.need, 0, 1)));
      const text = `Tier ${b.tier} arrived with ${buildSite(b)}'s site work ${fmtUnits(b.done)} of ${b.need} done: the new buildings started ${lower} lower.`;
      if (line) line('fin', 'bad', text);
      else feed(s, 'fin', 'bad', text);
    }
  }
  if (s.builds.some((b) => b.tier !== undefined && b.finished === undefined)) return;
  const last = Math.max(s.tier, ...s.builds.filter((b) => b.tier !== undefined).map((b) => b.tier!));
  const next = BUILDS.find((d) => (d.tier ?? 0) > last);
  if (next) s.builds.push({ id: next.id, what: next.what, tier: next.tier, done: 0, drawn: 0, need: next.units.length, started: W });
}

const fmtUnits = (n: number) => (Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1));

// ---------------------------------------------------------------------------
// People

const NAMES = [
  'Marta K.', 'Keanu P.', 'Aroha T.', 'Joaquín R.', 'Lina M.', 'Dev S.', 'Noor A.', 'Tomasi F.', 'Ines B.', 'Kalani W.',
  'Ravi N.', 'Sione L.', 'Mele V.', 'Oskar H.', 'Priya D.', 'Hemi R.', 'Luz C.', 'Anders J.', 'Moana E.', 'Farid Q.',
  'Yuki O.', 'Tavita S.', 'Ruth G.', 'Kai M.', 'Zanele N.', 'Emeka U.', 'Leilani H.', 'Bruno F.', 'Ana P.', 'Wiremu T.',
  'Siosaia K.', 'Nadia R.', 'Paulo V.', 'Grace L.', 'Ikaika B.', 'Soraya M.', 'Teuila A.', 'Mateo D.', 'Hana W.', 'Olu E.',
  'Rangi P.', 'Elena S.', 'Tomás G.', 'Lagi F.', 'Malia C.', 'Ari N.', 'Kiri H.', 'Samir B.', 'Noa T.', 'Ofa L.',
  'Ivy R.', 'Manu K.', 'Rosa E.', 'Lupe M.', 'Kekoa J.', 'Asha V.', 'Finn O.', 'Taini W.', 'Luis A.', 'Mere D.',
];

/** a name for a new NPC from the island's seed, unique among the staff and this week's candidates */
export function npcName(s: IslandState, id: string): string {
  const taken = new Set([...(s.staff ?? []).map((n) => n.name), ...(s.hiring?.cands ?? []).map((c) => c.name)]);
  const start = hashSeed(s.seed, 'npc', id) % NAMES.length;
  for (let i = 0; i < NAMES.length; i++) {
    const n = NAMES[(start + i) % NAMES.length];
    if (!taken.has(n)) return n;
  }
  return NAMES[start];
}

/** the standard crew for a tier, all skill 3, hired and started this week (names from the seed) */
function standardCrew(s: IslandState, tier: number, week: number): Npc[] {
  const crew = STAFF.standard[Math.max(1, Math.min(5, tier)) - 1];
  const out: Npc[] = [];
  s.staff = out;
  for (const role of NPC_ROLES) {
    for (let i = 0; i < (crew[role] ?? 0); i++) {
      const id = `n${s.nextId++}`;
      const npc: Npc = { id, name: npcName(s, id), role, skill: 3, wage: STAFF.wage[role], hired: week, start: week };
      out.push(npc);
    }
  }
  return out;
}

/**
 * An old island (migrate): the standard crew for its tier, skill 3, standard
 * wages, started this week; the builds for tiers up to tier + 1 are finished
 * (so an open crew project finishes exactly as it would have), and the build
 * for tier + 2 (up to 5) is open with nothing done. No board until the next
 * week opens. Idempotent: an island that has staff keeps them.
 */
export function migrateStaff(s: IslandState): void {
  if (s.staff) return;
  const W = Math.max(0, s.week);
  s.staff = standardCrew(s, s.tier, W);
  s.hiring = null;
  const builds: Build[] = [];
  for (const b of BUILDS) {
    const t = b.tier ?? 0;
    if (t <= s.tier + 1) builds.push({ id: b.id, what: b.what, tier: t, done: b.units.length, drawn: b.units.length, need: b.units.length, started: W, finished: W });
    else if (t === s.tier + 2) builds.push({ id: b.id, what: b.what, tier: t, done: 0, drawn: 0, need: b.units.length, started: W });
  }
  s.builds = builds;
}

/**
 * A new island (createIsland): the tier-1 standard crew and the t2 build open,
 * with its lots on the shelf (the yard sent the first site's materials with
 * the prefab cottages: the builders start in week 1, and the analyst buys from
 * the next build on).
 */
export function newIslandStaff(s: IslandState): void {
  s.staff = standardCrew(s, 1, 0);
  s.hiring = null;
  const t2 = BUILDS[0];
  s.builds = [{ id: t2.id, what: t2.what, tier: t2.tier, done: 0, drawn: 0, need: t2.units.length, started: 0 }];
  s.inv ??= {};
  for (const u of t2.units)
    for (const [id, q] of Object.entries(u)) {
      const x = itemById(id);
      if (!x || !q) continue;
      const l = (s.inv[id] ??= { on: 0 });
      l.avg = priceAt(x);
      l.on += q;
    }
}

const idNum = (id: string) => Number(id.replace(/\D/g, '')) || 0;
const bestFirst = (a: Npc, b: Npc) => b.skill - a.skill || idNum(a.id) - idNum(b.id);

/** the staff as the hooks read them: the stored crew, or (an island never migrated) the standard crew for its tier */
export function crewOf(s: Pick<IslandState, 'staff' | 'tier'>): Npc[] {
  if (s.staff) return s.staff;
  const std = STAFF.standard[Math.max(1, Math.min(5, s.tier)) - 1];
  return NPC_ROLES.flatMap((role) => Array.from({ length: std[role] ?? 0 }, (_, i): Npc => ({ id: `std-${role}-${i}`, name: '', role, skill: 3, wage: STAFF.wage[role], hired: 0, start: 0 })));
}

/** the staff at work at a week's resolve (skill 4-5 hires start the week after they're hired) */
export const working = (s: Pick<IslandState, 'staff' | 'tier' | 'week'>, W = s.week): Npc[] => crewOf(s).filter((n) => n.start <= W);

// ---------------------------------------------------------------------------
// Pilots

export type PilotSeat = { npc: Npc; n: number };

/**
 * Who flies what, on the schedule: the guest planes first, best pilot first (a
 * fresher one of the same skill takes the next plane); then the cargo runs,
 * the green pilots first (they fly nothing else), then whoever has the most
 * duty left. A pilot flies at most `STAFF.duty` flights a week.
 */
export function pilotSeats(s: IslandState): Map<string, PilotSeat[]> {
  const per = flightsPerPlane(s.tier);
  const ps = planes(s);
  const pilots = working(s)
    .filter((n) => n.role === 'pilot')
    .sort(bestFirst);
  const left = new Map(pilots.map((n) => [n.id, STAFF.duty] as const));
  const duty = (n: Npc) => left.get(n.id) ?? 0;
  const out = new Map<string, PilotSeat[]>();
  const fly = (planeId: string, cands: Npc[]) => {
    let need = per;
    const seats: PilotSeat[] = [];
    for (const n of cands) {
      if (need <= 0) break;
      const k = Math.min(need, duty(n));
      if (k <= 0) continue;
      seats.push({ npc: n, n: k });
      left.set(n.id, duty(n) - k);
      need -= k;
    }
    out.set(planeId, seats);
  };
  const guestOk = (n: Npc) => n.skill >= STAFF.guestMinSkill;
  for (const p of ps.filter((x) => !MODELS[x.model]?.cargo)) fly(p.id, pilots.filter(guestOk).sort((a, b) => b.skill - a.skill || duty(b) - duty(a) || idNum(a.id) - idNum(b.id)));
  for (const p of ps.filter((x) => MODELS[x.model]?.cargo))
    fly(p.id, [...pilots].sort((a, b) => Number(guestOk(a)) - Number(guestOk(b)) || duty(b) - duty(a) || b.skill - a.skill || idNum(a.id) - idNum(b.id)));
  return out;
}

/**
 * The week a tier arrives, the mainland contractor commissions it: a ferry
 * pilot flies its new plane and the contractor's cleaners turn over its new
 * houses (the standard crew's increase for the tier, at skill 3). From the
 * next week the island's own staff do, and the hiring board opens with them.
 */
export function commissioning(s: Pick<IslandState, 'tier' | 'week' | 'stats'>, role: NpcRole): number {
  if (s.tier <= 1 || s.stats?.tierReachedWeek?.[s.tier] !== s.week) return 0;
  return Math.max(0, standardCount(s.tier, role) - standardCount(s.tier - 1, role));
}

/** the fleet's flights a week: the guest planes (pilots of skill 3+) and all */
export function pilotCap(s: IslandState): { guest: number; total: number } {
  if (STAFF_TEST.stubs) return { guest: Infinity, total: Infinity };
  const ps = working(s).filter((n) => n.role === 'pilot');
  const ferry = commissioning(s, 'pilot') * STAFF.duty;
  return { guest: ps.filter((n) => n.skill >= STAFF.guestMinSkill).length * STAFF.duty + ferry, total: ps.length * STAFF.duty + ferry };
}

/** the pilot who flies most of a plane's flights */
export function pilotOf(s: IslandState, planeId: string): Npc | undefined {
  if (STAFF_TEST.stubs) return undefined;
  const seats = pilotSeats(s).get(planeId) ?? [];
  return [...seats].sort((a, b) => b.n - a.n)[0]?.npc;
}

/** tours sold, by the guest planes' pilots' skill (weighted by the flights they fly) */
export function charterMult(s: IslandState): number {
  if (STAFF_TEST.stubs) return 1;
  let sum = 0;
  let n = 0;
  const seats = pilotSeats(s);
  for (const p of planes(s)) {
    if (MODELS[p.model]?.cargo) continue;
    for (const x of seats.get(p.id) ?? []) {
      sum += x.npc.skill * x.n;
      n += x.n;
    }
  }
  return n ? 1 + STAFF.charter * (sum / n - 3) : 1;
}

/** the `tires` kind's alert weight on a plane, by its pilot's skill */
export function wearMult(s: IslandState, planeId: string): number {
  const p = pilotOf(s, planeId);
  return p ? (STAFF.wear[p.skill - 1] ?? 1) : 1;
}

/** added to the NFF share of a plane's pilot squawks (a green pilot writes up more that isn't there) */
export function squawkNff(s: IslandState, planeId: string): number {
  const p = pilotOf(s, planeId);
  return p ? (STAFF.squawkNff[p.skill - 1] ?? 0) : 0;
}

/**
 * Each flight flown rolls its pilot's hard-landing chance (never on the only
 * guest plane): a hard landing takes `hardLandingHit` from the plane and
 * raises M_HARD_LANDING for next week (it takes a slot of next week's work).
 */
export function staffAfterFlights(s: IslandState, flown: { plane: Asset; n: number }[], _r: Rng, W: number, line: Liner): void {
  if (STAFF_TEST.stubs || !STAFF_TEST.hardLandings || !s.staff) return;
  const r = rng(hashSeed(s.seed, 'landing', W));
  const seats = pilotSeats(s);
  for (const { plane, n } of flown) {
    if (n <= 0 || soleGuest(s, plane.id)) continue;
    const order = (seats.get(plane.id) ?? []).flatMap((x) => Array.from({ length: x.n }, () => x.npc));
    if (!order.length) continue;
    for (let i = 0; i < n; i++) {
      const pilot = order[Math.min(i, order.length - 1)];
      if (!r.chance(STAFF.hardLanding[pilot.skill - 1] ?? 0)) continue;
      if ((s.alerts ?? []).some((a) => a.assetId === plane.id && a.sym === 'M_HARD_LANDING' && a.status !== 'closed')) break;
      plane.health = Math.max(0, plane.health - STAFF.hardLandingHit);
      // the damage it finds: a cut tire, working rivets at the wing root, or nothing (5.2: tires 2, spar 1, no fault 2)
      const cause = r.weighted([0, 1, -1], (c) => (c === 0 ? 2 : c === 1 ? 1 : 2)) ?? -1;
      raiseAlert(s, { role: 'mech', asset: plane, sym: 'M_HARD_LANDING', src: 'landing', cause, week: W + 1, due: W + 1, who: pilot.name }, 0);
      line('mech', 'bad', `Hard landing: ${pilot.name} on ${plane.name} (−${STAFF.hardLandingHit}). Inspect the gear, the tires and the wing root before it flies next week.`);
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Housekeepers

/** houses the housekeepers turn over a week (no housekeeper: nothing is booked) */
export function housekeepingCap(s: IslandState): number {
  if (STAFF_TEST.stubs) return Infinity;
  return (
    working(s)
      .filter((n) => n.role === 'housekeeper')
      .reduce((t, n) => t + (STAFF.turnovers[n.skill - 1] ?? 0), 0) +
    commissioning(s, 'housekeeper') * STAFF.turnovers[2]
  );
}

/**
 * occupancy, by the skill of the housekeepers who turn the bookings over (reviews): the best first, each taking up
 * to their turnovers, the contractor's cleaners (a tier's first week) at skill 3. A spare who turns nothing over
 * moves no review. `booked`: the week's bookings (none: every housekeeper at capacity)
 */
export function reviewMult(s: IslandState, booked?: number): number {
  if (STAFF_TEST.stubs) return 1;
  const hk = working(s)
    .filter((n) => n.role === 'housekeeper')
    .map((n) => ({ skill: n.skill as number, t: STAFF.turnovers[n.skill - 1] ?? 0 }));
  const contractor = commissioning(s, 'housekeeper');
  for (let i = 0; i < contractor; i++) hk.push({ skill: 3, t: STAFF.turnovers[2] });
  if (!hk.length) return 1;
  hk.sort((a, b) => b.skill - a.skill);
  let left = booked ?? Infinity;
  let sum = 0;
  let n = 0;
  for (const h of hk) {
    if (left <= 0) break;
    const k = Math.min(left, h.t);
    sum += h.skill * k;
    n += k;
    left -= k;
  }
  if (n <= 0) return 1;
  return clamp(1 + STAFF.review * (sum / n - 3), 0.95, 1.05);
}

// ---------------------------------------------------------------------------
// Payroll

/** the staff's wages a week (the ones whose start week has come) */
export function payroll(s: IslandState): number {
  if (STAFF_TEST.stubs || !s.staff) return standardPayroll(s.tier);
  return s.staff.filter((n) => n.start <= s.week).reduce((t, n) => t + n.wage, 0);
}

/** what letting someone go costs now: two weeks' wages (nothing for a hire withdrawn the week it was made) */
export const severanceOf = (s: Pick<IslandState, 'week'>, n: Npc) => (n.hired === s.week ? 0 : STAFF.severanceWeeks * n.wage);

// ---------------------------------------------------------------------------
// The builders' week (resolve step 11c)

/** what the inspector fails, by the unit's main material */
const REWORK: Record<string, string> = {
  'BLD-FTG': 'the pier footings: the anchor bolts are out of line',
  'BLD-DECK': 'the deck framing: redo the connections',
  'BLD-FLASH': 'the roof flashing: the laps run uphill',
  'BLD-TRIM': 'the trim: the caulk joints are open',
  'BLD-SHUT': 'the storm shutters: the fasteners miss the framing',
  'BLD-PILE': 'the pilings: two are out of plumb',
  'BLD-MDECK': 'the dock stringers: redo the connections',
};

/**
 * The builders' week: each builder at work adds `output[skill - 1]` units to
 * the open build. Before work starts on a unit, its materials leave stock all
 * at once (all or nothing); if any is short, work stops at the unit boundary
 * (an idle week). A builder-week the inspector fails is lost, and draws one
 * more box of ties. A finished build opens the next one (a cottage joins the
 * island).
 */
export function buildWeek(s: IslandState, _r: Rng, W: number, line: Liner): void {
  if (STAFF_TEST.stubs || !s.staff || !s.builds) return;
  tidyBuilds(s, W, line);
  const b = openBuild(s);
  if (!b) return;
  const def = buildDef(b.id);
  if (!def) return;
  const crew = working(s)
    .filter((n) => n.role === 'builder')
    .sort(bestFirst);
  if (!crew.length) return;
  const r = rng(hashSeed(s.seed, 'build', W));
  let out = 0;
  const site = buildSite(b);
  for (const n of crew) {
    if (r.chance(STAFF.rework[n.skill - 1] ?? 0)) {
      b.rework = (b.rework ?? 0) + 1;
      const k = Math.min(Math.floor(b.done), b.need - 1);
      const main = unitLines(b, k)[0]?.item ?? 'BLD-DECK';
      const tie = takeStock(s, [{ item: 'BLD-TIE', qty: 1 }], `build:${b.id}`);
      line('fin', 'bad', `The inspector failed ${n.name}'s work on ${REWORK[main] ?? 'the site work: redo it'}. A week lost on ${site}${tie ? ' (a box of ties drawn)' : ''}.`);
      continue;
    }
    out += STAFF.output[n.skill - 1] ?? 0;
  }
  let left = out;
  let waiting: { item: ItemId; qty: number }[] = [];
  while (left > 1e-9 && b.done < b.need - 1e-9) {
    const k = Math.floor(b.done + 1e-9);
    if ((b.drawn ?? 0) <= k) {
      const lines = unitLines(b, k);
      if (!takeStock(s, lines, `build:${b.id}`)) {
        waiting = lines.filter((l) => available(s, l.item) < l.qty);
        break;
      }
      b.drawn = k + 1;
    }
    const step = Math.min(k + 1 - b.done, left);
    b.done = Math.round((b.done + step) * 1000) / 1000;
    left -= step;
  }
  if (waiting.length && left > 1e-9) {
    b.idle = (b.idle ?? 0) + 1;
    const coming = waiting.every((l) => onOrderFree(s, l.item).qty >= l.qty);
    const what = waiting
      .map((l) => {
        const o = onOrderFree(s, l.item);
        return `${l.qty} × ${l.item} (${o.qty ? `on the supply boat, week ${o.eta}` : 'not ordered'})`;
      })
      .join(', ');
    const verb = left >= out - 1e-9 ? 'idle' : 'stopped';
    // a build two tiers ahead may wait on purpose (the cash for the next tier comes first): said once, calmly
    if (!coming && b.tier !== undefined && b.tier > s.tier + 1) {
      if ((b.idle ?? 0) === 1) line('fin', 'info', `Builders ${verb}: the site work on ${site} (tier ${b.tier}) waits for materials. Buy them on the desk (Staff) when the cash allows.`);
    } else line('fin', coming ? 'info' : 'bad', `Builders ${verb} on ${site}: waiting on ${what}.${coming ? '' : ' Buy it on the desk (Staff).'}`);
  }
  if (b.done >= b.need - 1e-9) {
    b.done = b.need;
    b.finished = W;
    if (b.cottage) {
      const plot = COTTAGE_PLOTS.find((p) => p.id === b.cottage);
      if (plot && !s.assets.some((a) => a.id === plot.id))
        s.assets.push({ id: plot.id, kind: 'house', model: 'cottage', name: plot.name, health: 80, touchedWeek: W, inspectionUntil: W + ECON.houseInspectionWeeks });
      line('all', 'good', `${plot?.name ?? 'The new cottage'} is finished: it takes guests from next week.`);
    } else line('all', 'good', `The site work on ${site} is done: ${b.tier ? `they open with tier ${b.tier} in good shape` : 'finished'}.`);
    tidyBuilds(s, W, line);
  }
}

// ---------------------------------------------------------------------------
// The hiring board (week open) and the analyst's moves

/** the roles this island needs first, in order: below the standard crew, flights or bookings lost, an open build with no builder */
export function boardNeeds(s: IslandState): NpcRole[] {
  const out: NpcRole[] = [];
  const add = (r: NpcRole) => !out.includes(r) && out.push(r);
  const crew = crewOf(s);
  const build = openBuild(s);
  for (const r of NPC_ROLES) {
    if (r === 'builder' && !build) continue;
    if (crew.filter((n) => n.role === r).length < standardCount(s.tier, r)) add(r);
  }
  const lost = capacityLost(s);
  if (lost.flights > 0) add('pilot');
  if (lost.houses > 0) add('housekeeper');
  if (build && !crew.some((n) => n.role === 'builder')) add('builder');
  return out;
}

/**
 * What the crew can't cover this week, on the schedule as it stands: guest and
 * cargo flights the pilots can't fly, and houses guests would take that no
 * housekeeper turns over.
 */
export function capacityLost(s: IslandState): { flights: number; houses: number } {
  const fleet = planes(s).map((p) => ({ plane: p, n: capOf(s, p) }));
  const all = fleet.reduce((t, c) => t + c.n, 0);
  const capped = capFleet(s, fleet);
  const flights = all - capped.reduce((t, c) => t + c.n, 0);
  const pax = capped.filter((c) => !MODELS[c.plane.model]?.cargo).reduce((t, c) => t + c.n, 0);
  const rentable = s.assets.filter((a) => a.kind === 'house' && houseRentable(s, a)).length;
  const want = Math.min(rentable, pax + tierDef(s.tier).ferry);
  return { flights, houses: Math.max(0, want - housekeepingCap(s)) };
}

/**
 * This week's hiring board (week open): 3 candidates (4 from tier 3), the
 * first ones covering the island's needs (at a skill that fills the need: a
 * pilot 3+, for the guest planes; anyone else 2+), the rest drawn by role
 * weight. Skill 1-5 at 25/30/25/15/5 %; the ask is the wage at that skill,
 * give or take; skill 4-5 start the week after (they give notice).
 */
export function staffOpenWeek(s: IslandState, _r: Rng, now: number): void {
  if (STAFF_TEST.stubs || !s.staff) return;
  const W = s.week;
  s.builds ??= [];
  tidyBuilds(s, W);
  void now;
  const r = rng(hashSeed(s.seed, 'hire', W));
  const n = s.tier >= 3 ? STAFF.boardT3 : STAFF.board;
  const needs = boardNeeds(s).slice(0, n);
  const roles = [...needs];
  while (roles.length < n) roles.push(r.weighted(NPC_ROLES, (x) => STAFF.roleWeight[x]) ?? 'pilot');
  s.hiring = { week: W, cands: [] };
  roles.forEach((role, i) => {
    // a candidate for a need can fill it: a pilot for the guest planes (skill 3+), anyone else skill 2+
    const min = i < needs.length ? (role === 'pilot' ? STAFF.guestMinSkill : 2) : 1;
    const skill = (r.weighted([1, 2, 3, 4, 5] as const, (k) => (k >= min ? STAFF.skillWeight[k - 1] : 0)) ?? 3) as Npc['skill'];
    const ask = round10(STAFF.wage[role] * STAFF.skillWage[skill - 1] * r.range(0.95, 1.1));
    const id = `c${W}-${i + 1}`;
    s.hiring!.cands.push({ id, name: npcName(s, id), role, skill, ask, start: skill >= 4 ? W + 1 : W });
  });
}

function feed(s: IslandState, role: 'fin' | 'all', tone: 'good' | 'bad' | 'info', text: string, now = s.updatedAt) {
  const id = (s.feed[s.feed.length - 1]?.id ?? 0) + 1;
  s.feed.push({ id, week: s.week, role, tone, text, at: now });
  if (s.feed.length > 60) s.feed.splice(0, s.feed.length - 60);
}

const usd = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** a candidate joins the payroll (the hire action, and autopilot) */
function hireNow(s: IslandState, c: Candidate, now: number): Npc {
  const npc: Npc = { id: `n${s.nextId++}`, name: c.name, role: c.role, skill: c.skill, wage: c.ask, hired: s.week, start: c.start };
  (s.staff ??= []).push(npc);
  if (s.hiring) s.hiring.cands = s.hiring.cands.filter((x) => x.id !== c.id);
  const when = c.start > s.week ? `starts week ${c.start}` : 'starts this week';
  feed(s, 'fin', 'good', `${c.name} joins as ${ROLE_NAME[c.role].toLowerCase()} (skill ${c.skill}, ${usd(c.ask)} a week): ${when}.`, now);
  return npc;
}

/** the extra cottages' plots still free (a plot holds a queued, building or finished cottage) */
export function freePlots(s: IslandState): { id: string; name: string }[] {
  const taken = new Set([...(s.builds ?? []).map((b) => b.cottage).filter(Boolean), ...s.assets.map((a) => a.id)]);
  return COTTAGE_PLOTS.filter((p) => !taken.has(p.id));
}

/** hire, let go, start a cottage (docs/JOBFLOW.md 15.9; the analyst's, no turn lock) */
export function staffAction(s: IslandState, prev: IslandState, a: StaffAction, now: number): ApplyResult {
  const fail = (error: string): ApplyResult => ({ s: prev, error });
  if (STAFF_TEST.stubs) return fail('Hiring opens with the staff update.');
  const W = s.week;
  switch (a.t) {
    case 'hire': {
      const c = s.hiring?.week === W ? s.hiring.cands.find((x) => x.id === a.cand) : undefined;
      if (!c) return fail('That candidate took another job.');
      if ((s.staff ?? []).length >= STAFF.maxStaff) return fail('No room on the island for more staff.');
      if (s.receivership > 0) return fail('In receivership: no new hires.');
      hireNow(s, c, now);
      return { s };
    }
    case 'letGo': {
      const n = s.staff?.find((x) => x.id === a.npc);
      if (!n) return fail('They have already left.');
      const sev = severanceOf(s, n);
      if (sev > 0 && spendable(s) < sev) return fail(`Not enough cash for the severance (${usd(sev)}).`);
      if (sev > 0) {
        s.cash -= sev;
        book(s, 'payroll', sev, { trade: 'fin' });
      }
      s.staff = s.staff!.filter((x) => x.id !== n.id);
      feed(s, 'fin', 'info', sev ? `${n.name} (${ROLE_NAME[n.role].toLowerCase()}) left the island: ${usd(sev)} severance.` : `${n.name}'s hire was withdrawn before the start: no severance.`, now);
      return { s };
    }
    case 'build': {
      if (a.what !== 'cottage') return fail('Nothing to build.');
      if (s.tier < 3) return fail('Extra cottages open at tier 3.');
      if (!COTTAGE_PLOTS.length) return fail('No plot is ready for another cottage.');
      const plot = freePlots(s)[0];
      if (!plot) return fail('Two extra cottages is all the island has room for.');
      if (s.receivership > 0) return fail('In receivership: no new building.');
      if (spendable(s) < COTTAGE_SHELL) return fail(`Not enough cash for the shell (${usd(COTTAGE_SHELL)}).`);
      s.cash -= COTTAGE_SHELL;
      book(s, 'building', COTTAGE_SHELL, { trade: 'build' });
      (s.builds ??= []).push({ id: `cottage-${plot.id}`, what: `${plot.name}: piers, deck, flashing, trim and shutters`, cottage: plot.id, done: 0, drawn: 0, need: COTTAGE.units.length, started: W });
      const ahead = openBuild(s);
      feed(
        s,
        'fin',
        'good',
        `${plot.name} ordered: the prefab shell (${usd(COTTAGE_SHELL)}) comes from the mainland; ${ahead?.cottage === plot.id ? 'the builders start on its site work' : `the builders start on it after ${buildSite(ahead!)}`}.`,
        now,
      );
      return { s };
    }
  }
}

// ---------------------------------------------------------------------------
// What a hire or a let-go does for this island (15.7)

export type StaffEffect = { does: string; need: string; money: string; net: number; payback?: number };

/** the flights the fleet flies this week with this crew (as the resolve would fly them) */
function flightsWith(s: IslandState): number {
  return capFleet(
    s,
    planes(s).map((p) => ({ plane: p, n: capOf(s, p) })),
  ).reduce((t, c) => t + c.n, 0);
}

/** the flights these pilots could fly on the tier's full schedule (every plane in service) */
function fullFlights(s: IslandState, crew: Npc[]): number {
  const per = flightsPerPlane(s.tier);
  const ps = planes(s);
  const guestSched = ps.filter((p) => !MODELS[p.model]?.cargo).length * per;
  const cargoSched = ps.filter((p) => MODELS[p.model]?.cargo).length * per;
  const pilots = crew.filter((n) => n.role === 'pilot');
  const guest = Math.min(guestSched, pilots.filter((n) => n.skill >= STAFF.guestMinSkill).length * STAFF.duty);
  return guest + Math.min(cargoSched, pilots.length * STAFF.duty - guest);
}

/** the week a build would finish with these builders, each from the week they start (ignoring materials and rework): null = never */
export function buildEta(s: IslandState, crew: Npc[], b = openBuild(s)): number | null {
  if (!b) return null;
  const builders = crew.filter((n) => n.role === 'builder');
  if (!builders.length) return null;
  let done = b.done;
  for (let w = s.week; w < s.week + 104; w++) {
    done += builders.filter((n) => n.start <= w).reduce((t, n) => t + (STAFF.output[n.skill - 1] ?? 0), 0);
    if (done >= b.need - 1e-9) return w;
  }
  return null;
}

/** the hard landings a pilot would have, about once in N weeks (null: they'd only fly the only guest plane, or nothing) */
function landingEvery(s: IslandState, npc: Npc, crew: Npc[]): number | null {
  const seats = pilotSeats({ ...s, staff: crew });
  let flights = 0;
  for (const [planeId, xs] of seats) {
    if (soleGuest(s, planeId)) continue;
    for (const x of xs) if (x.npc.id === npc.id) flights += x.n;
  }
  const p = (STAFF.hardLanding[npc.skill - 1] ?? 0) * flights;
  return p > 0 ? Math.round(1 / p) : null;
}

/**
 * What a hire or a let-go does against this island's need, in its own numbers
 * and then in money, from projectWeek with and without the person (so the
 * statement is what the week's resolve would do): the flights they add, the
 * houses they turn over, the tours and reviews their skill moves, the site work
 * they speed up, and the net a week after their wage.
 */
export function staffEffect(s: IslandState, who: Candidate | Npc, change: 'hire' | 'letGo'): StaffEffect {
  const cand = 'ask' in who;
  const wage = cand ? who.ask : who.wage;
  if (STAFF_TEST.stubs)
    return { does: `${who.role} (skill ${who.skill})`, need: 'The staff update says what this does for the island.', money: `${change === 'hire' ? '' : 'saves '}$${wage} a week`, net: change === 'hire' ? -wage : wage };
  const W = s.week;
  const me: Npc = cand ? { id: who.id, name: who.name, role: who.role, skill: who.skill, wage, hired: W, start: W } : { ...who, start: Math.min(who.start, W) };
  const base = crewOf(s).filter((n) => n.id !== me.id);
  const withMe = [...base, me];
  // the week a tier arrives the contractor's ferry pilot and cleaners cover the new crew places: say what the
  // change does from next week, when they've gone
  const later = commissioning(s, me.role) > 0;
  const next: IslandState = later ? { ...s, stats: { ...s.stats, tierReachedWeek: { ...s.stats.tierReachedWeek, [s.tier]: W - 1 } } } : s;
  const A = { ...next, staff: withMe };
  const B = { ...next, staff: base };
  const pa = projectWeek(A);
  const pb = projectWeek(B);
  const dRev = pa.revenue - pb.revenue;
  const dFlights = flightsWith(A) - flightsWith(B);
  const dBooked = pa.booked - pb.booked;
  const hire = change === 'hire';
  const sign = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '');
  let does = '';
  const need: string[] = [];
  if (me.role === 'pilot') {
    const guest = me.skill >= STAFF.guestMinSkill;
    does = `flies ${STAFF.duty} a week · ${guest ? 'guest planes OK' : 'cargo runs only'}`;
    const hasCargo = planes(s).some((p) => MODELS[p.model]?.cargo);
    if (dFlights > 0) need.push(`${hire ? '+' : '−'}${plural(dFlights, 'flight')} a week (~${usd(Math.abs(dRev))} of guests and tours${dBooked ? `, ${plural(dBooked, 'house')} ${hire ? 'more' : 'fewer'} booked` : ''})`);
    else if (!guest && !hasCargo) need.push('you have no cargo plane: nothing for them to fly');
    else if (dRev !== 0) need.push(`tours ${sign(hire ? dRev : -dRev)}${Math.abs(Math.round(((charterMult(A) - charterMult(B)) / charterMult(B)) * 100))}% (~${usd(Math.abs(dRev))} a week)`);
    else {
      // a plane out of service this week hides a gap the full schedule would show
      const full = fullFlights(s, withMe) - fullFlights(s, base);
      if (full > 0) need.push(hire ? `every flight this week has a pilot; on the full schedule +${plural(full, 'flight')} a week` : `the others cover this week's flights; on the full schedule −${plural(full, 'flight')} a week`);
      else need.push(hire ? 'every flight already has a pilot: a spare' : 'the others cover every flight');
    }
    const every = landingEvery(s, me, withMe);
    if (every && hire && dFlights > 0) need.push(`a hard landing about once in ${every} weeks`);
  } else if (me.role === 'housekeeper') {
    const t = STAFF.turnovers[me.skill - 1] ?? 0;
    does = `turns over ${plural(t, 'house')} a week`;
    if (dBooked > 0) need.push(hire ? `+${plural(dBooked, 'house')} booked (~${usd(dRev)} a week)` : `${plural(dBooked, 'house')} would sit empty (−${usd(dRev)} a week)`);
    else need.push(hire ? 'every booking already has a turnover: a spare' : 'the others turn over every booking');
    // a housekeeper's skill moves the reviews (occupancy) whether or not they add a turnover
    if (dBooked <= 0 && dRev !== 0) need.push(`reviews ${(hire ? dRev : -dRev) > 0 ? 'up' : 'down'}: ${sign(hire ? dRev : -dRev)}${usd(Math.abs(dRev))} a week`);
  } else {
    const o = STAFF.output[me.skill - 1] ?? 0;
    does = `${fmtUnits(o)} unit${o === 1 ? '' : 's'} of site work a week`;
    const b = openBuild(s);
    if (!b) need.push(s.tier >= 3 && freePlots(s).length ? 'no site work open: start a cottage to use them' : 'no site work open');
    else {
      // (a skill 4-5 candidate starts next week: the site work counts them from then)
      const real = cand ? [...base, { ...me, start: who.start }] : withMe;
      const withEta = buildEta(s, real, b);
      const withoutEta = buildEta(s, base, b);
      const site = buildSite(b);
      if (hire)
        need.push(!withoutEta ? `${site} done wk ${withEta} (nobody on it now)` : withEta === withoutEta ? `${site} done wk ${withEta} either way: no sooner with them` : `${site} done wk ${withEta} instead of wk ${withoutEta}`);
      else need.push(!withoutEta ? `the site work on ${site} stops` : withEta === withoutEta ? `${site} still done wk ${withEta}` : `${site} done wk ${withoutEta} instead of wk ${withEta}`);
      // the crew project for the build's tier is under way: the tier can come at this week's resolve, and its new
      // buildings start 15 x the share of site work not done lower (docs/JOBFLOW.md 15.5)
      if (b.tier !== undefined && s.project?.tier === b.tier) {
        const share = (crew: Npc[]) => clamp((b.done + crew.filter((n) => n.role === 'builder' && n.start <= W).reduce((t, n) => t + (STAFF.output[n.skill - 1] ?? 0), 0)) / b.need, 0, 1);
        const d = Math.round(15 * (share(real) - share(base)));
        if (d > 0) need.push(`if tier ${b.tier} comes this week, its new buildings start ${d} ${hire ? 'higher' : 'lower'}`);
      }
    }
  }
  const sev = hire ? 0 : severanceOf(s, who as Npc);
  const net = hire ? dRev - wage : wage - dRev;
  let money: string;
  let payback: number | undefined;
  // (a hire that adds no revenue this week, a builder or a spare, says so rather than repeating its wage as the net)
  if (hire) money = dRev === 0 ? `${usd(wage)} a week · no new income` : `${usd(wage)} a week · net about ${net >= 0 ? '+' : '−'}${usd(Math.abs(net))} a week`;
  else {
    const save = wage - dRev;
    if (save > 0 && sev > 0) payback = Math.ceil(sev / save);
    money =
      save > 0
        ? `saves ${usd(save)} a week${sev ? ` after ${usd(sev)} severance: pays back in ${plural(payback!, 'week')}` : ' (no severance: hired this week)'}`
        : `costs ${usd(-save)} a week in lost revenue${sev ? `, plus ${usd(sev)} severance` : ''}`;
  }
  return { does, need: `${later && me.role !== 'builder' ? 'from next week: ' : ''}${need.join(' · ')}`, money, net, ...(payback !== undefined ? { payback } : {}) };
}

/**
 * An extra cottage: what it costs (the shell and its site work at list), what
 * it would rent in a normal week (every plane flying, no house closed) at this
 * week's rates, averaged over the last 8 weeks' season (one week with two planes
 * down says nothing about a building that stands for years), whether it needs
 * another housekeeper to turn it over, and the weeks it takes to pay back (net
 * of that wage).
 */
export function cottagePlan(s: IslandState): { plot: { id: string; name: string } | null; cost: number; rent: number; housekeeper: boolean; payback: number | null } {
  const plot = freePlots(s)[0] ?? null;
  const cost = COTTAGE_SHELL + valueOf(COTTAGE.units.flatMap((u) => Object.entries(u).map(([item, qty]) => ({ item, qty: qty ?? 0 }))));
  if (!plot) return { plot, cost, rent: 0, housekeeper: false, payback: null };
  const extra: Asset = { id: plot.id, kind: 'house', model: 'cottage', name: plot.name, health: 80, touchedWeek: s.week, inspectionUntil: s.week + ECON.houseInspectionWeeks };
  // a normal week: nothing grounded or closed for an alert, no safety tag, no plane chain-grounded
  const normal = (x: IslandState, w: number): IslandState => ({ ...x, week: w, alerts: [], chain: null, tags: {} });
  const weeks = Array.from({ length: 8 }, (_, i) => s.week - i).filter((w) => w >= 1);
  if (!weeks.length) weeks.push(Math.max(1, s.week));
  const avg = (x: IslandState) => weeks.reduce((n, w) => n + projectWeek(normal(x, w)).revenue, 0) / weeks.length;
  const withIt = { ...s, assets: [...s.assets, extra] };
  const now = avg(s);
  let rent = Math.round(avg(withIt) - now);
  let housekeeper = false;
  if (rent <= 0) {
    // every turnover is taken: it rents once another housekeeper is on the payroll
    const hk: Npc = { id: 'plan-hk', name: '', role: 'housekeeper', skill: 3, wage: STAFF.wage.housekeeper, hired: s.week, start: s.week };
    const more = Math.round(avg({ ...withIt, staff: [...crewOf(s), hk] }) - now);
    if (more > 0) {
      rent = more;
      housekeeper = true;
    }
  }
  const net = rent - (housekeeper ? STAFF.wage.housekeeper : 0);
  return { plot, cost, rent: Math.max(0, rent), housekeeper, payback: net > 0 ? Math.ceil(cost / net) : null };
}

// ---------------------------------------------------------------------------
// Bots (15.12)

/** last week's review said flights or bookings were lost to the crew */
function lostLastWeek(s: IslandState): { pilot: boolean; housekeeper: boolean } {
  const lines = s.history[s.history.length - 1]?.lines ?? [];
  return { pilot: lines.some((l) => /the pilots fly/.test(l.text)), housekeeper: lines.some((l) => /housekeeping turns over/.test(l.text)) };
}

const valueOf = (lines: { item: ItemId; qty: number }[]) => lines.reduce((t, l) => t + (itemById(l.item) ? priceAt(itemById(l.item)!) * l.qty : 0), 0);

/** the cash the next tier asks for (0: none; tier 3's $18,000 and tier 5's $60,000), from the tier checklist */
export function nextCashGate(s: IslandState): number {
  const item = nextTierProgress(s)?.items.find((i) => /^Cash /.test(i.label));
  const m = item && /\/ \$([\d,]+)/.exec(item.label);
  return m ? Number(m[1].replace(/,/g, '')) : 0;
}

/** the best candidate for a role: one who starts now, then the highest skill, then the lowest ask */
const bestCand = (cands: Candidate[]) => [...cands].sort((a, b) => a.start - b.start || b.skill - a.skill || a.ask - b.ask)[0];

/** the open build's next units' materials that are neither on the shelf nor on order */
export function buildShort(s: IslandState, units: number): { item: ItemId; qty: number }[] {
  const b = openBuild(s);
  if (!b) return [];
  const from = b.drawn ?? 0;
  const need = new Map<ItemId, number>();
  for (let k = from; k < Math.min(b.need, from + units); k++) for (const l of unitLines(b, k)) need.set(l.item, (need.get(l.item) ?? 0) + l.qty);
  const out: { item: ItemId; qty: number }[] = [];
  for (const [item, q] of need) {
    const short = q - available(s, item) - onOrderFree(s, item).qty;
    if (short > 0) out.push({ item, qty: short });
  }
  return out;
}

/**
 * The fin bot keeps the standard crew for the tier (the balance run's neutral
 * point): it hires for a role below the standard count (its pilots all fly
 * guests), or one that lost capacity last week, the best candidate (starting
 * now, then the most skilled) of skill 3+ for pilots (2+ for the others)
 * asking at most 1.25 x the skill-3 wage; it lets the builder go at
 * tier 5 once no site work is open; and it buys the open build's next two
 * units' materials: the next tier's site work at once, a build two tiers
 * ahead (all of it) once the next tier's crew project is under way (its cash
 * gate passed: tier 3's $18,000 comes first) or while the cash stays over
 * that gate after the buy; one further ahead waits. The naive analyst over-hires skill 4+
 * while payroll is under 1.8 x standard, and in a crunch (spendable under
 * $4,000) lets the dearest hire above the standard crew go, severance and all.
 */
export function botStaff(s: IslandState, bot: Bot, _r: Rng, now: number): IslandState {
  if (STAFF_TEST.stubs || !s.staff || s.week < 1) return s;
  const step = (a: Parameters<typeof apply>[1]) => {
    const r = apply(s, a, now);
    if (!r.error) s = r.s;
    return !r.error;
  };
  const W = s.week;
  if (bot.naive) {
    const std = standardPayroll(s.tier);
    if (spendable(s) < 4000) {
      // a crunch: the dearest hire above the standard crew goes (severance and all)
      const extra = s.staff.filter((n) => s.staff!.filter((x) => x.role === n.role).length > standardCount(s.tier, n.role));
      const dear = extra.sort((a, b) => b.wage - a.wage || idNum(b.id) - idNum(a.id))[0];
      if (dear) step({ t: 'letGo', npc: dear.id, week: W });
      return s;
    }
    // (a skill 4-5 hire starts next week: count every wage on the list, started or not)
    const wages = () => s.staff!.reduce((t, n) => t + n.wage, 0);
    for (const c of [...(s.hiring?.week === W ? s.hiring.cands : [])]) {
      if (c.skill < 4 || wages() + c.ask > 1.8 * std) continue;
      step({ t: 'hire', cand: c.id, week: W });
    }
    return s;
  }
  // the builder goes at tier 5 once there's no site work (the standard crew has none there)
  if (s.tier >= 5 && !openBuild(s)) for (const n of s.staff.filter((x) => x.role === 'builder')) step({ t: 'letGo', npc: n.id, week: W });
  const lost = lostLastWeek(s);
  for (const role of NPC_ROLES) {
    // the standard crew's pilots all fly guests: a green cargo pilot doesn't count toward it
    const have = s.staff.filter((n) => n.role === role && (role !== 'pilot' || n.skill >= STAFF.guestMinSkill)).length;
    const below = have < standardCount(s.tier, role) && (role !== 'builder' || !!openBuild(s));
    const short = (role === 'pilot' && lost.pilot) || (role === 'housekeeper' && lost.housekeeper) || (role === 'builder' && have === 0 && !!openBuild(s) && s.tier >= 5);
    if (!below && !short) continue;
    const min = role === 'pilot' ? STAFF.guestMinSkill : 2;
    const c = bestCand((s.hiring?.week === W ? s.hiring.cands : []).filter((x) => x.role === role && x.skill >= min && x.ask <= 1.25 * STAFF.wage[role]));
    if (c) step({ t: 'hire', cand: c.id, week: W });
  }
  // the builders' materials, once a builder is on the payroll: the next tier's site work (or a cottage) two units
  // at a time; a build two tiers ahead waits for the next tier's crew project (its cash gate passed: tier 3's
  // $18,000 comes first), and then all of it is bought, so it's done before its tier comes
  // A site two tiers ahead is bought whole once the next tier's crew project is under way, or before that while the
  // cash stays over the next tier's cash gate after the buy (tier 3's $18,000); three tiers ahead (the builders ran
  // ahead) it waits. (Buying ahead of a tier with no cash gate, or the Lodge's materials all at once at tier 3, costs
  // the tier-5 gate more than the late site work costs the new buildings: see DECISIONS.md, Staff.)
  const b = openBuild(s);
  if (b && s.staff.some((n) => n.role === 'builder')) {
    const ahead = b.tier !== undefined && b.tier > s.tier + 1;
    const lines = buildShort(s, ahead ? b.need : 2);
    const gate = ahead && b.tier === s.tier + 2 && s.project?.tier !== s.tier + 1 ? nextCashGate(s) : 0;
    const go = !ahead || (b.tier === s.tier + 2 && (s.project?.tier === s.tier + 1 || (gate > 0 && spendable(s) - valueOf(lines) >= gate + ECON.freezeBelow + 500)));
    if (go && lines.length && spendable(s) >= ECON.freezeBelow + 500) step({ t: 'buy', lines, week: W });
  }
  return s;
}

/**
 * An absent analyst's autopilot: an empty place in the standard crew gets the
 * best candidate of skill 2+ (pilots for the guest planes 3+); the next tier's
 * next build unit is bought within the autopilot's cap. It never lets anyone go.
 */
export function autoStaff(s: IslandState): void {
  if (STAFF_TEST.stubs || !s.staff) return;
  const W = s.week;
  for (const role of NPC_ROLES) {
    if (role === 'builder' && !openBuild(s)) continue;
    if (s.staff.filter((n) => n.role === role && (role !== 'pilot' || n.skill >= STAFF.guestMinSkill)).length >= standardCount(s.tier, role)) continue;
    if (s.staff.length >= STAFF.maxStaff || s.receivership > 0) break;
    const min = role === 'pilot' ? STAFF.guestMinSkill : 2;
    const c = bestCand((s.hiring?.week === W ? s.hiring.cands : []).filter((x) => x.role === role && x.skill >= min));
    if (c) hireNow(s, c, s.updatedAt);
  }
  // the next tier's site work (a build further ahead, or a cottage, is a person's call)
  const b = openBuild(s);
  if (!b || b.tier === undefined || b.tier > s.tier + 1 || !s.staff.some((n) => n.role === 'builder')) return;
  const lines = buildShort(s, 1);
  const value = valueOf(lines);
  if (lines.length && value <= STOCK.autopilotCap && spendable(s) - value >= ECON.freezeBelow) placePo(s, lines, {}, 'auto', s.updatedAt);
}
