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
  result?: OrderResult;
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
  kind: 'deferral' | 'fire' | 'flight';
  role: Role;
  assetId: string | null;
  title: string;
  cost: number;
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
  costs: { fixed: number; insurance: number; leak: number; incidents: number; refunds: number; loan?: number };
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
}

/** moves that belong to one week: stamped at dispatch, stale ones are rejected */
export const WEEK_BOUND = ['complete', 'approve', 'defer', 'counter', 'acceptCounter', 'rejectCounter', 'buyList', 'endTurn', 'tag', 'squawk'] as const;

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
  | { t: 'post'; role: Role; text: string; to?: Role }
  | { t: 'pin'; role: Role; id: number; on: boolean }
  | { t: 'unpost'; role: Role; id: number }
  | { t: 'cosmetic'; role: Role; id: string }
  | { t: 'practice'; role: Role; puzzle: PuzzleId; tier: number; score: number }
  | { t: 'resolve'; week: number };
