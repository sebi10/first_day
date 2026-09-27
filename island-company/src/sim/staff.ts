// NPC staff: pilots, housekeepers and builders on the island's payroll
// (docs/JOBFLOW.md 15). NPCs never do mechanic, electrician or analyst work.
//
// Package A writes the constants, the hooks with their stubs, migrateStaff and
// newIslandStaff; package D implements the behaviour. With the stubs the game
// plays exactly as before the staff update: the fixed cost is the tier's
// overhead plus the standard crew's payroll (today's fixed cost), the pilots
// and housekeepers cap nothing, and new buildings start at today's health.
import type { Bot } from './bots';
import type { Rng } from './rng';
import { hashSeed } from './rng';
import type { ApplyResult } from './engine';
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
};

export const NPC_ROLES: NpcRole[] = ['pilot', 'housekeeper', 'builder'];

/** the standard crew's payroll a week: 760, 1,080, 1,080, 1,260, 1,320 */
export function standardPayroll(tier: number): number {
  const crew = STAFF.standard[Math.max(1, Math.min(5, tier)) - 1];
  return NPC_ROLES.reduce((n, r) => n + (crew[r] ?? 0) * STAFF.wage[r], 0);
}

/** a wage at a skill (the ask of a candidate, before its seeded spread) */
export const wageAt = (role: NpcRole, skill: number) => Math.round(STAFF.wage[role] * STAFF.skillWage[skill - 1]);

// ---------------------------------------------------------------------------
// Builds: the builders' site work (15.5)

export interface BuildDef {
  id: string;
  what: string;
  tier?: number;
  /** the materials each work unit draws, in order */
  units: Partial<Record<ItemId, number>>[];
}

export const BUILDS: BuildDef[] = [
  { id: 't2', tier: 2, what: 'Set cottages 3 and 4: piers, decks and trim', units: [{ 'BLD-FTG': 1 }, { 'BLD-DECK': 1, 'BLD-TIE': 1 }, { 'BLD-FLASH': 1 }] },
  { id: 't3', tier: 3, what: 'The generator house: pad, piers and roof flashing', units: [{ 'BLD-FTG': 1 }, { 'BLD-FLASH': 1 }] },
  { id: 't4', tier: 4, what: 'Set the villas and build the seaplane dock', units: [{ 'BLD-FTG': 1 }, { 'BLD-PILE': 1 }, { 'BLD-MDECK': 1, 'BLD-TIE': 1 }, { 'BLD-SHUT': 1 }] },
  { id: 't5', tier: 5, what: 'Set the Lodge: piers, decks, trim and shutters', units: [{ 'BLD-FTG': 1 }, { 'BLD-DECK': 1, 'BLD-TRIM': 1 }, { 'BLD-FLASH': 1 }, { 'BLD-SHUT': 1 }] },
];

export const COTTAGE: BuildDef = {
  id: 'cottage',
  what: 'An extra cottage: piers, deck, flashing, trim and shutters',
  units: [{ 'BLD-FTG': 1 }, { 'BLD-DECK': 1, 'BLD-TIE': 1 }, { 'BLD-FLASH': 1 }, { 'BLD-TRIM': 1 }, { 'BLD-SHUT': 1 }],
};
/** the prefab shell of an extra cottage (the mainland contractor), paid when it starts */
export const COTTAGE_SHELL = 17000;

export const buildDef = (id: string): BuildDef | undefined => (id === 'cottage' || id.startsWith('cottage') ? COTTAGE : BUILDS.find((b) => b.id === id));

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

/** A new island (createIsland): the tier-1 standard crew and the t2 build open */
export function newIslandStaff(s: IslandState): void {
  s.staff = standardCrew(s, 1, 0);
  s.hiring = null;
  const t2 = BUILDS[0];
  s.builds = [{ id: t2.id, what: t2.what, tier: t2.tier, done: 0, drawn: 0, need: t2.units.length, started: 0 }];
}

// ---------------------------------------------------------------------------
// Hooks (A writes each with its stub; D implements: docs/JOBFLOW.md 15.4)

/** [no-op] this week's hiring board (15.7) */
export function staffOpenWeek(_s: IslandState, _r: Rng, _now: number): void {}
/** [no cap] the fleet's flights a week: guest planes (pilots of skill 3+) and all */
export function pilotCap(_s: IslandState): { guest: number; total: number } {
  return { guest: Infinity, total: Infinity };
}
/** [none] the pilot who flies most of a plane's flights */
export function pilotOf(_s: IslandState, _planeId: string): Npc | undefined {
  return undefined;
}
/** [1] tours sold, by the guest planes' pilots' skill */
export function charterMult(_s: IslandState): number {
  return 1;
}
/** [1] the `tires` kind's alert weight on a plane, by its pilot's skill */
export function wearMult(_s: IslandState, _planeId: string): number {
  return 1;
}
/** [0] added to the NFF share of a plane's pilot squawks */
export function squawkNff(_s: IslandState, _planeId: string): number {
  return 0;
}
/** [no-op] each flight flown rolls its pilot's hard landing (M_HARD_LANDING for next week) */
export function staffAfterFlights(_s: IslandState, _flown: { plane: Asset; n: number }[], _r: Rng, _W: number, _line: Liner): void {}
/** [no cap] houses the housekeepers turn over a week */
export function housekeepingCap(_s: IslandState): number {
  return Infinity;
}
/** [1] occupancy, by the housekeepers' skill */
export function reviewMult(_s: IslandState): number {
  return 1;
}
/** [the standard crew's] the staff's wages a week */
export function payroll(s: IslandState): number {
  return standardPayroll(s.tier);
}
/** [1] the share of a tier's site work the builders have done (new buildings' starting health, 15.5) */
export function builtShare(_s: IslandState, _tier: number): number {
  return 1;
}
/** [no-op] the builders' week: progress, materials drawn from stock, rework */
export function buildWeek(_s: IslandState, _r: Rng, _W: number, _line: Liner): void {}
/** [refused] hire, let go, start a cottage */
export function staffAction(_s: IslandState, prev: IslandState, _a: StaffAction, _now: number): ApplyResult {
  return { s: prev, error: 'Hiring opens with the staff update.' };
}
export type StaffEffect = { does: string; need: string; money: string; net: number; payback?: number };
/** [a stub text] what a hire or a let-go does for this island (15.7) */
export function staffEffect(_s: IslandState, who: Candidate | Npc, change: 'hire' | 'letGo'): StaffEffect {
  const wage = 'ask' in who ? who.ask : who.wage;
  return { does: `${who.role} (skill ${who.skill})`, need: 'The staff update says what this does for the island.', money: `${change === 'hire' ? '' : 'saves '}$${wage} a week`, net: change === 'hire' ? -wage : wage };
}
/** [returns s] the fin bot's staff moves */
export function botStaff(s: IslandState, _bot: Bot, _r: Rng, _now: number): IslandState {
  return s;
}
/** [no-op] an absent analyst's autopilot for staff */
export function autoStaff(_s: IslandState): void {}
