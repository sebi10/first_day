import type { PuzzleId } from '../puzzles/types';

export type Role = 'mech' | 'elec' | 'fin';
export const ROLES: Role[] = ['mech', 'elec', 'fin'];
export type OpsRole = 'mech' | 'elec';

export type AssetKind = 'plane' | 'house' | 'grid' | 'generator';
export type Weather = 'clear' | 'wind' | 'storm';
export type Grade = 'A' | 'B' | 'C' | 'D';
export type Insurance = 'none' | 'standard' | 'premium';

export interface Asset {
  id: string;
  kind: AssetKind;
  /** catalog key: twin | cargo | float | cottage | villa | lodge | panel | gen */
  model: string;
  name: string;
  /** airworthiness (planes) or reliability (houses, grid, generator), 0..100 */
  health: number;
  /** last week an order was completed on it (decay skips touched assets) */
  touchedWeek: number;
  /** houses: inspection valid through this week */
  inspectionUntil?: number;
  /** planes: flights since last 100-hr inspection */
  sinceInspection?: number;
}

export type OrderStatus = 'pending' | 'countered' | 'approved' | 'waiting_part' | 'ready' | 'done' | 'cancelled';

export interface OrderResult {
  score: number;
  perfect: boolean;
  /** fraction of the order's gain that landed */
  credit: number;
  by: Role;
  week: number;
  auto?: boolean;
  covered?: boolean;
  summary?: string;
  /** blind sign-off (a real job at puzzle tier 2+): the UI shows "Signed off", never the score; the engine still uses it */
  blind?: boolean;
  /**
   * blind: the credit that landed on the asset at sign-off (a fixed stand-in,
   * and XP gets the floor, so nothing gives the score away). The true `credit`
   * settles silently when the week resolves; then this is removed.
   */
  provisional?: number;
}

/** A cross-trade report: one trade's problem that another trade has to fix. */
export interface ReportInfo {
  /** REPORTS key in data.ts (title, notice, puzzle) */
  key: string;
  /** who raised it (the trade that suffers while it is open) */
  by: Role;
  /**
   * cap: the reporter works at reduced capacity; leak: cash lost every resolved
   * week; gse: a ground power cart is tagged out (no GPU starts on it) until fixed
   */
  effect: 'cap' | 'leak' | 'gse';
  /** leak: USD lost per resolved week while open (0 for a cap) */
  amount: number;
  /** a fix that didn't hold: the week of the fix that failed */
  again?: number;
  /** leak that came back: what it cost while it only looked fixed (charged with the next resolved week) */
  owed?: number;
  /** effect 'gse': the ground power cart it is about (GseCart.id) */
  cart?: string;
}

/** What a look at a ground power cart's cable and plug shows (GSE bands in data.ts). */
export type CableBand = 'good' | 'cracked' | 'pitted';

/**
 * A ground power cart (GPU): a battery cart the mechanic charges in the hangar,
 * tows to a plane and hooks up for a start. It is on its charger or powering a
 * plane, never both. Its cable wear is hidden: only an inspection shows it.
 */
export interface GseCart {
  id: string;
  name: string;
  /** state of charge, 0..100 */
  charge: number;
  /** cable and plug wear, 0..100 (hidden; an inspection shows its band) */
  wear: number;
  /** the plane it is hooked up to, or null */
  hookedTo: string | null;
  /** plugged in on the hangar charger */
  charging: boolean;
  /** the last look at the cable: the mechanic's inspection, or the electrician's re-termination (`fixed`) */
  inspected?: { week: number; band: CableBand; by: string; fixed?: boolean } | null;
}

/**
 * A hidden defect left by a signed-off job. Lives in s.defects, never shown
 * until it is found by an inspection or surfaces as an incident.
 */
export interface Defect {
  id: string;
  /** kind of the job that left it (a catalog kind, 'repair', or 'report') */
  orderKind: string;
  /** the catalog kind of the work it belongs to (a repair or redo counts as the job it corrects): what an inspection's scope checks */
  job?: string;
  /** the job as a noun ("prop bolt re-torque", "alternator replacement redo") for the review's "traced to" line */
  log?: string;
  puzzle: PuzzleId;
  /** what went wrong, when the puzzle reported it and a rule exists for it ('hot' for a hot start): picks the `<puzzle>:<variant>` rule */
  variant?: string;
  /** that job's title, as it appeared on the card */
  title: string;
  /** null for a report fix that won't hold (it reopens instead of causing an incident) */
  assetId: string | null;
  /** the trade that owns the job (gets the repair; its inspections find it) */
  role: Role;
  /** the seat that signed it off (differs from `role` after a lend-a-hand) */
  by: Role;
  /** who signed it off */
  name: string;
  /** week it was signed off */
  week: number;
  /** resolveWeek of this week surfaces it (a tagged asset waits a week) */
  dueWeek: number;
  severity: 1 | 2;
  /** the job's cost, tier and gain: the incident and the repair scale from them, the redo repeats them */
  cost: number;
  tier: number;
  gain: number;
  /** after the repair, the original job is done again */
  redo: boolean;
  /** report comebacks: which report reopens */
  report?: ReportInfo;
}

/** Corrective job for a defect that was found or surfaced. */
export interface RepairInfo {
  defect: Defect;
  /** how it came to light */
  via: 'inspection' | 'incident';
  /** what is wrong, e.g. "fasteners below torque, with fretting at the joint" */
  problem: string;
  /** via 'incident': what happened, as the review told it */
  incident?: string;
  /** inspection finds: who found it, and on which job */
  foundBy?: string;
  foundIn?: string;
}

export interface Order {
  id: string;
  role: Role;
  kind: string;
  assetId: string | null;
  title: string;
  puzzle: PuzzleId;
  tier: number;
  cost: number;
  parts: number;
  gain: number;
  createdWeek: number;
  /** weeks this order has been carried unfinished */
  deferrals: number;
  lastDeferredWeek: number | null;
  deferReason?: 'cash' | 'priority' | 'counter' | 'open';
  status: OrderStatus;
  /** analyst's cheaper-fix offer awaiting the owner */
  counter?: { cost: number; gain: number };
  /** owner rejected the counter: analyst must approve or defer */
  pushedBack?: boolean;
  /** written up by the trade (a squawk), not generated: the name of who raised it */
  squawk?: string;
  approvedWeek?: number;
  autoApproved?: boolean;
  seed: number;
  /** analyst tasks: extra numbers for the puzzle context */
  leak?: number;
  /** the puzzle's scenario when the kind doesn't say it (a repair's assembly, a report's device); defaults to `kind` */
  job?: string;
  result?: OrderResult;
  /** kind 'report': a crewmate's problem this trade has to fix */
  report?: ReportInfo;
  /** kind 'repair': corrects a hidden defect; completing it spawns the redo */
  repair?: RepairInfo;
  /** the original job done again after its repair (cost 0, already paid): the sign-off it replaces, and what it cost then */
  redo?: { week: number; by: Role; name: string; cost: number };
}

export interface Player {
  /** first device; more devices (laptop + phone) live in `devices` */
  uid: string;
  devices?: string[];
  /** short code that lets another device join this seat (phone ↔ computer) */
  seatKey?: string;
  name: string;
  role: Role;
  xp: number;
  /** perfect puzzles, each +1% credit, capped at +15% */
  perfects: number;
  week0Done: boolean;
  missedStreak: number;
  /** cosmetic ids equipped */
  cosmetic: string;
  /** week the player's tier-1 difficulty grace ends */
  graceUntil: number;
  covers: number; // lifetime covers
  /** personal best score per puzzle (0..1), any tier, from jobs or the weekly challenge */
  best?: Partial<Record<PuzzleId, number>>;
}

export interface TurnState {
  ended: boolean;
  endedAt: number | null;
  /** orders completed this week */
  done: number;
  coveredBy?: Role;
}

export interface Incident {
  kind: 'deferral' | 'fire' | 'flight' | 'defect';
  role: Role;
  assetId: string | null;
  title: string;
  cost: number;
  /** kind 'defect': the signed-off job it was traced to */
  from?: {
    title: string;
    name: string;
    week: number;
    /** "the prop bolt re-torque Ana signed off in week 5" */
    traced?: string;
    /** the repair order it created, and whether the original job is redone after it */
    repairId?: string;
    redo?: boolean;
  };
}

export interface ReportLine {
  role: Role | 'all';
  tone: 'good' | 'bad' | 'info';
  text: string;
}

/** A message on the crew board: persistent, shared by every device on the island. */
export interface BoardPost {
  id: number;
  role: Role;
  /** author's name when posted */
  name: string;
  text: string;
  at: number;
  week: number;
  pinned?: boolean;
  /** a direct message: only this seat and the author see it in the game */
  to?: Role;
}

export interface WeekReport {
  week: number;
  tier: number;
  grade: Grade;
  components: { revenue: Grade; flights: Grade; safety: Grade };
  weighted: number;
  revenue: number;
  budget: number;
  flightsFlown: number;
  flightsScheduled: number;
  incidents: Incident[];
  nearMisses: number;
  cashStart: number;
  cashEnd: number;
  costs: { fixed: number; insurance: number; leak: number; incidents: number; refunds: number; loan?: number; /** open 'leak' reports */ reports?: number; /** charging the ground power carts */ power?: number };
  housesBooked: number;
  housesRentable: number;
  partsDelivered: number;
  weather: Weather;
  seed: number;
  lines: ReportLine[];
  mvp: Record<Role, string>;
  autoRun: Role[];
  tierUp?: number;
}

export interface FeedEvent {
  id: number;
  week: number;
  role: Role | 'all';
  tone: 'good' | 'bad' | 'info';
  text: string;
  at: number;
}

export interface Forecast {
  week: number; // week the forecast was made (end-of-week cash of week+1..week+4)
  points: number[];
  actual: number[];
  paid?: number;
}

export interface Modifier {
  kind: 'demand' | 'charterDemand' | 'stormShield';
  mult: number;
  until: number; // inclusive week
  label: string;
}

export interface StoryCard {
  id: string;
  week: number;
  title: string;
  body: string;
  options: { key: string; label: string; effect: string }[];
  chosen?: string;
  /** crew vote: decided when two agree (or all three have voted) */
  votes?: Partial<Record<Role, string>>;
}

export interface IslandState {
  v: 1;
  id: string;
  name: string;
  createdAt: number;
  creatorTz: string;
  resolveHour: number;
  seed: number;
  /** current open week; 0 = onboarding (solo week 0 per player) */
  week: number;
  deadline: number | null;
  tier: number;
  cash: number;
  /** cash when the current week opened (for the review) */
  openCash: number;
  parts: { stock: number; inTransit: number };
  rates: { nightly: number; charter: number };
  insurance: Insurance;
  autoBudget: Record<OpsRole, number>;
  autoSpent: Record<OpsRole, number>;
  assets: Asset[];
  orders: Order[];
  players: Partial<Record<Role, Player>>;
  turns: Partial<Record<Role, TurnState>>;
  /** covers used this week, by covering role */
  coversUsed: Partial<Record<Role, number>>;
  /** week of each trade's last write-up (one squawk per trade per week) */
  squawked?: Partial<Record<Role, number>>;
  weather: Weather;
  history: WeekReport[];
  stats: {
    weeksBPlus: number;
    streakBPlus: number;
    perfectWeeks: number;
    negCashStreak: number;
    /** incidents per week, last 4 resolved weeks */
    recentIncidents: number[];
    totalWeeks: number;
    tierReachedWeek: Record<number, number>;
    /** consecutive full-team A weeks (endgame: 8 at the Resort) */
    aStreak?: number;
  };
  /** week the crew beat the game (8 straight A weeks at tier 5) */
  creditsWeek?: number;
  /** weekly crew challenge: same seed for everyone, bragging rights only */
  challenge?: { week: number; scores: Record<string, Partial<Record<Role, number>>> };
  receivership: number;
  /** receiver's bridge loan: taken once on entering receivership, repaid weekly */
  loan?: { left: number; weekly: number } | null;
  pendingBonus: number | null;
  story: StoryCard | null;
  modifiers: Modifier[];
  forecasts: Forecast[];
  feed: FeedEvent[];
  nextId: number;
  updatedAt: number;
  /** optional shared ntfy.sh topic for free push notifications */
  ntfy?: string;
  /** safety calls for this week: assetId → role that grounded / red-tagged it */
  tags?: Record<string, Role>;
  /** the crew board: messages and pinned notes (latest 150 plus every pin) */
  board?: BoardPost[];
  boardNextId?: number;
  /** the crew project that builds the next tier: one job per trade */
  project?: { tier: number; title: string; orders: Partial<Record<Role, string>> } | null;
  /** hidden defects from signed-off jobs (never shown until found or surfaced; resolved ones are removed) */
  defects?: Defect[];
  /** ground power carts (older islands: none stored yet, read through gseCarts() for the default) */
  gse?: GseCart[];
}

/** moves that belong to one week: stamped at dispatch, stale ones are rejected */
export const WEEK_BOUND = ['complete', 'approve', 'defer', 'counter', 'acceptCounter', 'rejectCounter', 'buyList', 'endTurn', 'tag', 'squawk', 'gse'] as const;

/** What the mechanic can do with a ground power cart. */
export type GseOp = 'charge' | 'unplug' | 'hook' | 'unhook' | 'inspect';

export type Action =
  | { t: 'join'; uid: string; name: string; role: Role; reclaim?: boolean; key?: string; /** replace an absent player (explicit, confirmed in the UI) */ takeover?: boolean }
  | { t: 'rename'; role: Role; name: string }
  | { t: 'week0Done'; role: Role }
  | {
      t: 'complete';
      role: Role;
      orderId: string;
      score: number;
      perfect: boolean;
      summary?: string;
      data?: Record<string, unknown>;
      cover?: boolean;
      /** the week this move was made in; a move queued offline across a deadline is rejected */
      week?: number;
    }
  | { t: 'approve'; orderId: string; week?: number }
  | { t: 'defer'; orderId: string; reason: 'cash' | 'priority'; week?: number }
  | { t: 'counter'; orderId: string; week?: number }
  | { t: 'acceptCounter'; orderId: string; week?: number }
  | { t: 'rejectCounter'; orderId: string; week?: number }
  | { t: 'setRates'; nightly: number; charter: number }
  | { t: 'setBudget'; role: OpsRole; amount: number }
  | { t: 'setInsurance'; tier: Insurance }
  | { t: 'setNtfy'; topic: string }
  | { t: 'buyList'; week?: number }
  | { t: 'endTurn'; role: Role; week?: number }
  | { t: 'allocateBonus'; choice: 'reserve' | 'capex' | 'split' }
  | { t: 'story'; key: string; role: Role }
  | { t: 'tag'; role: Role; assetId: string; on: boolean; week?: number }
  | { t: 'squawk'; role: Role; assetId: string; kind: string; week?: number }
  /** a ground power cart: on the charger, off it, hooked up to a plane (`assetId`), unhooked, or its cable inspected */
  | { t: 'gse'; role: Role; cart: string; op: GseOp; assetId?: string; week?: number }
  | { t: 'post'; role: Role; text: string; to?: Role }
  | { t: 'pin'; role: Role; id: number; on: boolean }
  | { t: 'unpost'; role: Role; id: number }
  | { t: 'cosmetic'; role: Role; id: string }
  | { t: 'practice'; role: Role; puzzle: PuzzleId; tier: number; score: number }
  | { t: 'resolve'; week: number };
