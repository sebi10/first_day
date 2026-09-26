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
  costs: { fixed: number; insurance: number; leak: number; incidents: number; refunds: number };
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
  };
  receivership: number;
  pendingBonus: number | null;
  story: StoryCard | null;
  modifiers: Modifier[];
  forecasts: Forecast[];
  feed: FeedEvent[];
  nextId: number;
  updatedAt: number;
  /** optional shared ntfy.sh topic for free push notifications */
  ntfy?: string;
}

export type Action =
  | { t: 'join'; uid: string; name: string; role: Role; reclaim?: boolean; key?: string }
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
    }
  | { t: 'approve'; orderId: string }
  | { t: 'defer'; orderId: string; reason: 'cash' | 'priority' }
  | { t: 'counter'; orderId: string }
  | { t: 'acceptCounter'; orderId: string }
  | { t: 'rejectCounter'; orderId: string }
  | { t: 'setRates'; nightly: number; charter: number }
  | { t: 'setBudget'; role: OpsRole; amount: number }
  | { t: 'setInsurance'; tier: Insurance }
  | { t: 'setNtfy'; topic: string }
  | { t: 'buyList' }
  | { t: 'endTurn'; role: Role }
  | { t: 'allocateBonus'; choice: 'reserve' | 'capex' | 'split' }
  | { t: 'story'; key: string }
  | { t: 'cosmetic'; role: Role; id: string }
  | { t: 'resolve'; week: number };
