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
  /** done by an NPC (the electrician's helper): their name */
  npc?: string;
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
  /** effect 'gse': what is wrong with the cable, as reported (its words: CABLE_REPORT); older reports: cracked */
  band?: CableBand;
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
  /** the puzzle of the job that left it; 'flow' and 'elec' for the job flow's own mistakes (rule keys like `flow:task`, `elec:nogfci`) */
  puzzle: PuzzleId | 'flow' | 'elec';
  /** a wrong-task or NFF defect remembers the fault it left: the alert it re-raises (docs/JOBFLOW.md 11.1), with its cause */
  alert?: { sym: string; kind: string; alert: string; cause?: number };
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
  /** DEFECT_RULES_BY_KIND key when it isn't the job's kind (a job-flow task's own words: 'wh', 'bond') */
  rule?: string;
  /** words for the rule's blanks beyond the asset ({symptom}, {room}, {what}), fixed at sign-off */
  words?: Record<string, string>;
  /** the job flow's task that left it (an `ipc:noteff` repair carries its effective part) */
  task?: string;
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

/** Where a part chain stands (see src/sim/chain.ts). 'check': the part is looked up, and waits on the electrician's check before it's bought. */
export type ChainStep = 'lookup' | 'research' | 'check' | 'buy' | 'fee' | 'review' | 'transit' | 'install' | 'done';

/**
 * The part chain: a job on a plane found a part gone, missing or damaged. The
 * job is blocked and the plane is not airworthy until the part is installed.
 * The mechanic looks it up in the IPC (and, if it isn't there, researches the
 * logbooks for the alteration that put it on), the analyst buys it (and pays
 * engineering to review the approval), it rides the normal delivery, and the
 * mechanic installs it and finishes the job. At most one on the island.
 * Wrong answers are never flagged at once: they come back at receiving, from
 * engineering a week later, or as a hidden defect.
 */
export interface PartChain {
  id: string;
  /** the job it stopped (blocked until the part is installed; then it is the install step) */
  orderId: string;
  assetId: string;
  /** that job's title */
  title: string;
  /** IPC chapter-section and the IPC tag of the part (see src/sim/aircraft.ts) */
  ata: string;
  tag: string;
  /** "brake linings", as the mechanic says it */
  item: string;
  how: 'gone' | 'missing' | 'damaged';
  /** what the job found, as the squawk on the lookup reads (what is on the airplane) */
  found?: string;
  /** who found it, and when */
  by: string;
  week: number;
  step: ChainStep;
  /** the order that carries the current step (lookup, research, buy, fee) */
  stepId?: string;
  /** the P/N on order, in transit, or waiting to go on */
  pn?: string;
  /** where that P/N came from: the IPC lookup, engineering's authorization (EA), or a logbook entry that skipped engineering */
  src?: 'ipc' | 'eng' | 'entry';
  /** the request the research sent to engineering: what it cites and (hidden until the answer) whether it holds */
  request?: { cite?: string; ok: boolean; reason: string; costly?: boolean };
  /** engineering answers when this week resolves */
  due?: number;
  /** engineering approved the part in this week, on this approval */
  approvedWeek?: number;
  cite?: string;
  /** why the chain is back at a lookup or research: the part that went back, or engineering's reason (cleared when that step is handed in) */
  back?: string;
  /** wrong parts sent back, requests engineering returned */
  returns: number;
  rejects: number;
  /** parts, fees, restocking and the boat */
  spent: number;
  /** resolved weeks the plane sat grounded */
  aogWeeks: number;
  /** step 'done': the week the part went on */
  closedWeek?: number;
  /** step 'done': the story, for that week's review */
  story?: string;
  /** the part's price on the purchase order (what a return credits back, less restocking) */
  price?: number;
  /** how the part travels when the plane that would carry it is the one down: the AOG boat (on the PO), or next week's guest flight */
  freight?: 'boat' | 'flight';
  /** freight 'flight': the week whose resolve it rides in on */
  ship?: number;
  /** receiving quarantine: the part came without its paperwork; the vendor's documents arrive when this week resolves */
  hold?: number;
  /** when the current step's card appeared (a card that came after the analyst ended the turn goes through at resolve) */
  stepAt?: number;
  /** what the downtime has cost so far (USD, the weekly estimate at each resolve while grounded) */
  downtime?: number;
  /**
   * An electrical unit (the com radio, the alternator or starter-generator): the
   * electrician's check at the airplane, under the A&P's supervision (14 CFR
   * 43.3(d)), before one is bought. `fault` is what is really wrong (hidden);
   * `call` what the check said. A wrong call shows up later: a good unit bought
   * (at the install), or a dead one left in service (as an incident).
   */
  bench?: { id: string; fault: 'unit' | 'wiring'; call?: 'unit' | 'wiring'; by?: string; week?: number; again?: boolean };
  /** the bench found the wiring at fault: fixed, no part needed */
  wired?: boolean;
  /**
   * Opened from the job flow's research branch (a `plan` or `repick` with research, or a displaced
   * part at receiving or the install): it doesn't ground the plane by itself (the alert does, if it
   * is an airworthiness one). Older chains: none.
   */
  flow?: boolean;
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
  /** part chain: the job it stopped ('job'), or one of its steps ('bench': the electrician's check at the airplane) */
  chain?: { id: string; step: 'job' | 'lookup' | 'research' | 'buy' | 'fee' | 'bench' };
  /** the job flow (docs/JOBFLOW.md 2.4): the alert it came from, the task, the lines. Legacy orders: none */
  flow?: JobFlow;
  /** ms: the `now` of the action that created it (a card that came after the analyst ended the turn goes through on the standing approval) */
  at?: number;
  /** an electrician's bench order for a plane's electrical unit: the alert it checks */
  bench?: string;
  /** the parts auction's lot (the analyst's desk task): what a win places on a broker PO */
  lot?: { lines: { item: ItemId; qty: number }[]; fair: number; list: number };
  /** the crew project's floatplane auction lost in this week (fix round 1): the part stays open, the next floatplane comes up at next week's auction. Older docs: none */
  rebid?: number;
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
  /** of those, the part chain's paperwork (it needs no hangar tools: the grid-down cap doesn't count it) */
  paper?: number;
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
  costs: {
    /** overhead + payroll (old renderers read this) */
    fixed: number;
    insurance: number;
    leak: number;
    incidents: number;
    refunds: number;
    loan?: number;
    /** open 'leak' reports */
    reports?: number;
    /** charging the ground power carts */
    power?: number;
    /** the tier's overhead (leases, utilities, property insurance, admin, licences) */
    overhead?: number;
    /** the NPC staff's wages */
    payroll?: number;
    /** the stores carrying charge (storage and insurance on stock) */
    carry?: number;
    /** freight paid at the payment run (the AOG boat on POs) */
    freight?: number;
    /** labour on job-flow cards approved this week */
    labor?: number;
    /** purchase orders paid at the payment run (parts, consumables, materials, tools, building), freight excluded */
    parts?: number;
    /** the mainland sub-charter that flew the guests while the only guest plane was on the ground */
    subCharter?: number;
  };
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
  /**
   * The engine version that last wrote this island (ENGINE_VERSION in engine.ts).
   * An older build refuses to write it (it would drop or corrupt what it doesn't
   * know about) and asks for a reload. Older islands: none.
   */
  engine?: number;
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
  /** RETIRED (the generic parts kits): migrate() turns them into store credit. Kept for old readers */
  parts?: { stock: number; inTransit: number };
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
  /** week the crew beat the game (8 full-crew A weeks played at tier 5, none below A) */
  creditsWeek?: number;
  /** weekly crew challenge: same seed for everyone, bragging rights only */
  challenge?: { week: number; scores: Record<string, Partial<Record<Role, number>>> };
  receivership: number;
  /**
   * receiver's bridge loan: taken once on entering receivership, repaid weekly. `adv`: what the receiver advanced this
   * week under its repair allowance (review round 1: safety-critical work while cash is below $0), added to `left`
   */
  loan?: { left: number; weekly: number; adv?: { week: number; usd: number } } | null;
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
  /** the part chain, open or the last one closed (step 'done'); older islands have none */
  chain?: PartChain | null;
  /** ground power carts (older islands: none stored yet, read through gseCarts() for the default) */
  gse?: GseCart[];
  /**
   * A flight day with a weak battery: this plane's first start of the week is on
   * ground power. A charged cart hooked up to it when the week resolves starts it;
   * otherwise its first flight is lost. Older islands: none.
   */
  weakBattery?: { assetId: string; week: number } | null;

  // --- the job flow, purchasing, finance tracking and NPC staff (docs/JOBFLOW.md; all optional: old islands read as noted) ---
  /** open alerts, and closed ones for ALERTS.keep weeks (hard cap 40). Old islands: [] */
  alerts?: Alert[];
  /** stock lines by item (sparse). Old islands: migrated to the starter stock */
  inv?: Record<ItemId, StockLine>;
  /** purchase orders: open, held, received and unpaid, and closed ones for STOCK.keepWeeks */
  pos?: PurchaseOrder[];
  /** requisitions: open ones, and closed ones for STOCK.keepWeeks */
  reqs?: Requisition[];
  /** engineering authorizations the research branch has issued (an ICA part approved for one airplane) */
  eas?: EaRecord[];
  /** vendor store credit, USD (migrated kits, returns and scrap): applied at the payment runs */
  credit?: number;
  /** the standing limit: late cards and requisitions approved at the resolve, a week. Absent: the two work budgets' sum */
  standing?: number;
  /** finance tracking: the last 26 weeks (sparse) */
  ledger?: WeekLedger[];
  /** NPC staff on the island's payroll (pilots, housekeepers, builders) */
  staff?: Npc[];
  /** this week's hiring board */
  hiring?: { week: number; cands: Candidate[] } | null;
  /** the builders' site work: open and finished builds */
  builds?: Build[];
  /** the week the job flow started on this island (teaching weeks follow it). Old islands: the migration week */
  flowSince?: number;
}

/** moves that belong to one week: stamped at dispatch, stale ones are rejected */
export const WEEK_BOUND = [
  'complete',
  'approve',
  'defer',
  'counter',
  'acceptCounter',
  'rejectCounter',
  'buyList',
  'endTurn',
  'tag',
  'squawk',
  'gse',
  // the job flow (docs/JOBFLOW.md 7): every flow and purchasing move but setStanding
  'plan',
  'nff',
  'mel',
  'melExtend',
  'makeSafe',
  'askBench',
  'repick',
  'dropJob',
  'request',
  'cancelReq',
  'approveReq',
  'deferReq',
  'buy',
  'setStock',
  'scrap',
  'nudge',
  // NPC staff (15.9)
  'hire',
  'letGo',
  'build',
] as const;

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
  /** `ship`: a part chain's part, when the plane that would carry it is down: the AOG boat now, or next week's guest flight */
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
  /**
   * a ground power cart: on the charger, off it, hooked up to a plane (`assetId`), unhooked, or its
   * cable inspected (`call`: the mechanic's call on the plug end, serviceable or tag it out; none: the band as it is)
   */
  | { t: 'gse'; role: Role; cart: string; op: GseOp; assetId?: string; call?: 'ok' | 'tag'; week?: number }
  | { t: 'post'; role: Role; text: string; to?: Role }
  | { t: 'pin'; role: Role; id: number; on: boolean }
  | { t: 'unpost'; role: Role; id: number }
  | { t: 'cosmetic'; role: Role; id: string }
  | { t: 'practice'; role: Role; puzzle: PuzzleId; tier: number; score: number }
  | { t: 'resolve'; week: number }
  // --- the job flow (docs/JOBFLOW.md 7) ---
  /** the tech's plan for an alert: the task found in the manual / reference, and the lines picked (a rare job's pre-filled line counts as a pick) */
  | { t: 'plan'; role: OpsRole; alert: string; task: TaskId; pick: PickLine[]; research?: boolean; week?: number }
  /** no fault found: close the alert */
  | { t: 'nff'; role: OpsRole; alert: string; week?: number }
  /** placard the item INOP under the company MEL (category C): the plane flies on it at this week's resolve */
  | { t: 'mel'; role: 'mech'; alert: string; week?: number }
  /**
   * the one extension of an MEL placard: the mechanic asks for it (`role: 'mech'`, the maintenance side's call under
   * the operator's extension authority), the analyst approves it (`role: 'fin'`, or none: older clients)
   */
  | { t: 'melExtend'; alert: string; role?: Role; week?: number }
  /** make a hazard safe: breaker off and tagged, or a blank-off */
  | { t: 'makeSafe'; role: 'elec'; alert: string; how: 'breaker' | 'blankoff'; week?: number }
  /** ask the electrician to meter a plane's electrical unit and its circuit */
  | { t: 'askBench'; role: 'mech'; alert: string; week?: number }
  /** a new pick for a flow job (after a stop, or a change of mind); `research`: send the job to the part chain's research */
  | { t: 'repick'; role: OpsRole; order: string; pick: PickLine[]; research?: boolean; week?: number }
  /** drop a flow job: its alert goes back to open */
  | { t: 'dropJob'; role: OpsRole; order: string; week?: number }
  /** a stock or tool requisition (no job): the analyst's call */
  | { t: 'request'; role: OpsRole; item: ItemId; qty: number; why?: string; week?: number }
  | { t: 'cancelReq'; role: Role; req: string; week?: number }
  /** extended for flow cards: the supplier and freight for the lines to buy */
  | { t: 'approve'; orderId: string; week?: number; ship?: 'boat' | 'flight'; buy?: BuyChoice }
  | { t: 'approveReq'; reqs: string[]; buy?: BuyChoice; week?: number }
  | { t: 'deferReq'; req: string; week?: number }
  /** a stock purchase order */
  | { t: 'buy'; lines: { item: ItemId; qty: number }[]; buy?: BuyChoice; week?: number }
  /** min / max (reorder point and order-up-to level) for an item; both null clears them */
  | { t: 'setStock'; item: ItemId; rop: number | null; max: number | null; week?: number }
  /** return stock to the vendor (75% credit) or write off a consumable */
  | { t: 'scrap'; item: ItemId; qty: number; week?: number }
  /** remind a trade about an alert nobody has planned */
  | { t: 'nudge'; alert: string; week?: number }
  /** the standing limit a week (late cards approved at the resolve) */
  | { t: 'setStanding'; amount: number }
  // --- NPC staff (package D implements; 15.9) ---
  | StaffAction;

// ---------------------------------------------------------------------------
// The job flow, purchasing, finance tracking and NPC staff (docs/JOBFLOW.md).
// Package A writes every type here up front; the UI packages code against them.

/** an item's P/N or catalog number, unique across the whole catalog */
export type ItemId = string;
export type ItemKind = 'part' | 'consumable' | 'rotable' | 'material' | 'lot' | 'tool';
export type ItemTrade = 'mech' | 'elec' | 'build';
/** chapter browse in the supply catalog and the stock planner */
export type ItemCat =
  | 'wheels' | 'brakes' | 'tires' | 'prop' | 'hydraulic' | 'avionics' | 'dcpower' | 'engine' | 'airframe' | 'hardware' | 'fluids' | 'generator' | 'repair' // mech
  | 'wire' | 'cable' | 'breakers' | 'devices' | 'boxes' | 'conduit' | 'connectors' | 'grounding' | 'equipment' | 'lots' | 'tools' // elec
  | 'site'; // build

export interface ElecSpec {
  amps?: number;
  poles?: 1 | 2;
  awg?: number;
  conductors?: number;
  /** a DF device is both */
  gfci?: boolean;
  afci?: boolean;
  df?: boolean;
  gfpe?: boolean;
  /** where the protection sits */
  form?: 'receptacle' | 'breaker' | 'panel';
  tr?: boolean;
  wr?: boolean;
  inUse?: boolean;
  single?: boolean;
  /** box, cubic inches (314.16) */
  volume?: number;
  /** wiring method (334, 340, 310) */
  method?: 'nm' | 'uf' | 'thwn' | 'bare';
  raceway?: 'emt' | 'pvc40' | 'pvc80' | 'lfnc';
  /** raceway trade size */
  size?: '1/2' | '3/4' | '1';
  /** EMT connectors (358.42) */
  fitting?: 'setscrew' | 'raintight';
  /** splice listed for direct burial (300.5(E), 110.14(B)) */
  burial?: boolean;
  /** what the device is, for the pick judge's slot categories */
  device?: 'receptacle' | 'switch3' | 'switch1' | 'switch4' | 'cover' | 'plate' | 'box' | 'element' | 'relay' | 'spa' | 'splice' | 'clamp' | 'rod' | 'connector';
}

export interface Item {
  /** = pn */
  id: ItemId;
  pn: string;
  /** as the IPC or the catalog prints it */
  nomen: string;
  trade: ItemTrade;
  kind: ItemKind;
  cat: ItemCat;
  /** the family (14.2): 'tire:twin', 'lining:cargo', 'oilFilter:float', 'gfci20', 'thwn6', 'BLD-DECK' */
  fam: string;
  unit: 'ea' | 'use' | 'ft' | 'qt' | 'gal' | 'set' | 'lot';
  /** units per purchase pack (a spool of safety wire is 25 uses; #6 THWN-2 is a 500 ft spool, cut to length) */
  pack: number;
  /** 'spool' | 'roll' | 'case' | 'box' | 'bag' | 'bundle' | 'stick' | 'kit' | 'lot' */
  packName?: string;
  /** sold cut to length: buy any number of units, not whole packs (wire by the foot) */
  cut?: boolean;
  /** USD per pack at list, flat (list prices don't rise with the island tier); a unit costs price / pack */
  price: number;
  /** weeks by scheduled freight, >= 1 (1 = this week's carrier) */
  lead: number;
  /** rides the cargo plane (from tier 2), not a guest flight's hold: cases, coils, bundles, rotables, wheel assemblies */
  bulk?: boolean;
  /** as the IPC prints it (mech) */
  supsdBy?: { pn: string; code: 1 | 2 | 3 };
  /** mech: planes whose IPC lists it; undefined = shop-wide */
  models?: ('twin' | 'cargo' | 'float')[];
  /** an STC / field-approval (ICA) part: the holder */
  ica?: string;
  /** an FAA-PMA replacement: its eligibility text */
  pma?: string;
  /** electrical */
  spec?: ElecSpec;
  /** NEC basis (electrical items and tools) */
  nec?: string[];
  /** search keywords and synonyms */
  tags: string[];
  /** mech: the IPC tag (slot) it fills and the figure it is in (the first one, for a P/N in several) */
  slot?: string;
  ata?: string;
}

/** one line of a pick: `slot` names the task's main slot it fills (optional: the engine infers it) */
export type PickLine = { item: ItemId; qty: number; slot?: string };

export interface StockLine {
  /** units on hand, reserved ones included */
  on: number;
  /** orderId -> units reserved for that job (soft while the job's card is pending: 9.2) */
  res?: Record<string, number>;
  /** reorder point on inventory position (9.1); rop/max absent = not auto-replenished */
  rop?: number;
  /** order-up-to level */
  max?: number;
  /** moving-average unit cost, for valuation */
  avg?: number;
  /** week the line was first received (the 'new' class) */
  got?: number;
}

/** purchasing suppliers (not aircraft.ts VENDORS, which are the makers' CAGE codes) */
export type SupplierId = 'oem' | 'broker' | 'supply' | 'online' | 'yard' | 'barge';
export type Freight = 'sched' | 'aog';
export type BuyChoice = { vendor?: SupplierId; freight?: Freight };

export interface PoLine {
  item: ItemId;
  qty: number;
  /** USD per unit */
  unit: number;
  /** the job it is bought for */
  order?: string;
  /** the requisition it fills */
  req?: string;
  /** held at receiving: the document missing */
  hold?: string;
  /** units received (a held line: 0 until released) */
  got?: number;
  /** sent back at receiving: why (credited at the payment run, less restocking) */
  back?: string;
  /** shipped under supersession as this P/N */
  as?: ItemId;
}

export interface PurchaseOrder {
  /** 'po12' */
  id: string;
  /** placed (committed) */
  week: number;
  vendor: SupplierId;
  freight: Freight;
  /** the week whose resolve delivers it */
  eta: number;
  lines: PoLine[];
  /** lines + freight: committed when placed, paid at the payment run after receipt (9.7) */
  cost: number;
  freightCost: number;
  /** 'auto': work budget, standing approval, replenishment, autopilot, migration */
  by: Role | 'auto';
  status: 'open' | 'held' | 'received' | 'paid' | 'returned';
  /** receiving quarantine: released at this week's resolve */
  hold?: number;
  /** week received */
  got?: number;
  /** week paid */
  paid?: number;
  /** USD the vendor's invoice overbilled on it (the three-way match's week: it is paid unless the match catches it) */
  over?: number;
  /** USD the three-way match withheld (the overbilling it found) */
  caught?: number;
  /** credited back at the payment run: lines sent back at receiving, less restocking */
  refund?: number;
  /** receiving: "shipped as TR-155-02 (supersedes TR-155-01, INTCHG 2)", "held: no 8130-3 with the exchange unit" */
  notes?: string[];
  /** the carrier class: small lines on any flight, bulk on the cargo plane, building materials on the supply boat */
  carrier?: 'any' | 'bulk' | 'boat';
}

export interface Requisition {
  /** 'rq7' */
  id: string;
  week: number;
  /** ms, the `now` of the action (standing approvals, 8.5) */
  at: number;
  /** who asked */
  role: OpsRole;
  item: ItemId;
  qty: number;
  /** the job it is for; none = a stock or tool request */
  order?: string;
  status: 'open' | 'ordered' | 'filled' | 'cancelled';
  po?: string;
  /** stock requests: the tech's note ("L/H tire at 2/32 on Twin N-12") */
  why?: string;
  deferredWeek?: number;
  /** week it was filled or cancelled (closed ones are kept STOCK.keepWeeks) */
  closed?: number;
}

export interface EaRecord {
  assetId: string;
  ata: string;
  tag: string;
  pn: string;
  ea: string;
  week: number;
}

export type AlertSrc =
  | 'squawk' | 'trend' | 'wear' | 'due' | 'ad' | 'finding' | 'again' | 'landing' // mech
  | 'guest' | 'utility' | 'code' | 'takeoff'; // elec (plus 'finding', 'again')

export interface Alert {
  /** 'a31' */
  id: string;
  role: OpsRole;
  assetId: string;
  /** SYMPTOMS key (src/sim/alerts.ts); the text, the finding and the site derive from it and `seed` */
  sym: string;
  src: AlertSrc;
  /** raised */
  week: number;
  /** from this week's resolve an unfixed fault bites (== week: it bites now) */
  due: number;
  seed: number;
  /** HIDDEN: the catalog kind that fixes it; 'nff' = nothing wrong; 'wiring' = the electrician's fix (5.4); 'repair' */
  kind: string;
  /** HIDDEN: the cause's index in the symptom (its finding and what it needs derive from it); -1 for an NFF cause */
  cause: number;
  /** HIDDEN: a real fault whose Investigate shows the NFF finding (tier 3+ intermittents, 5.1) */
  looksNff?: boolean;
  status: 'open' | 'job' | 'closed';
  /** the job planned from it */
  order?: string;
  /** placarded INOP under the company MEL (category C, 10); `ask`: the mechanic asked for the one extension (the analyst approves it) */
  mel?: { until: number; by: string; ext?: boolean; ask?: { week: number; by: string } };
  safe?: { how: 'breaker' | 'blankoff'; week: number; by: string };
  bench?: { order?: string; call?: 'unit' | 'wiring'; by?: string; week?: number; again?: boolean };
  /** kind 'repair': the defect and how it came to light (today's RepairInfo) */
  repair?: RepairInfo;
  /** re-raised: the week of the sign-off or NFF close that didn't fix it */
  again?: number;
  /** the pilot who wrote it up or landed hard (from staff) */
  who?: string;
  /** the week the analyst last nudged the trade about it */
  nudged?: number;
  closed?: { week: number; how: 'fixed' | 'nff' | 'wired' | 'dropped' };
  /** prefilled alerts (due, AD, code, take-off, write-ups): the task the Manual step opens with */
  task?: TaskId;
  /** the only guest plane's early-sign wording was raised (5.6) */
  sole?: boolean;
}

/** the resolve's review-line writer, shared with the staff hooks */
export type Liner = (role: ReportLine['role'], tone: ReportLine['tone'], text: string) => void;

/** 'amm:twin:32-40-02', 'afm:float:4', 'gsm:2-4', 'ref:gfci' */
export type TaskId = string;

export interface JobFlow {
  /** the alert it came from */
  alert: string;
  /** the task card chosen in the Manual / Reference step */
  task: TaskId;
  /** what the tech chose (a rare job's pre-filled line counts as a pick) */
  pick: PickLine[];
  /** what the task draws on its own: consumables */
  bench: { item: ItemId; qty: number }[];
  /** the task's shop tools (owned or requisitioned; never consumed) */
  tools: ItemId[];
  /** requisitions for an approved job's new shortfall (a pending card's shortfall lives on the card: 8.6) */
  reqs?: string[];
  /** the part chain's research branch holds this job (not in the IPC) */
  research?: boolean;
  /** research waits for the open chain to close */
  queued?: boolean;
  /** value of pick + bench at plan time (USD) */
  bom: number;
  /** the job stopped at receiving or the install: why ("P/N 066-19500 doesn't fit: …") */
  stop?: string;
  /** the stop sends the job to the research branch (a displaced part) */
  stopResearch?: boolean;
  /** the fault was in the wiring (the electrician's check): the return-to-service step, no lines */
  wired?: boolean;
  /** the IPC slot the research branch is about */
  researchSlot?: string;
  /** a line or a tool was missing when it was planned (the AOG-by-cause count: 'stock') */
  short?: boolean;
}

export type SpendCat = 'parts' | 'consumables' | 'rotables' | 'materials' | 'tools' | 'building' | 'freight' | 'labor' | 'carry' | 'payroll' | 'overhead' | 'eng' | 'subcharter';

export interface WeekLedger {
  w: number;
  /** revenue, net of refunds */
  rev: number;
  /** cash at week end */
  cash: number;
  /** cash out by category (POs at payment, 9.7) */
  sp: Partial<Record<SpendCat, number>>;
  /** cash out by trade */
  tr: Partial<Record<'mech' | 'elec' | 'build' | 'fin', number>>;
  /** parts consumed + labour, by asset (sparse) */
  as?: Record<string, number>;
  /** units consumed (sparse: only items that moved) */
  use?: Record<ItemId, number>;
  /** value consumed at average cost (stock used) */
  usedV?: number;
  /** value received into stock (stock built) */
  rcvV?: number;
  /** inventory value at week end (moving-average cost) */
  inv: number;
  /** written off: scrapped consumables, the 25% lost on a return (value, non-cash) */
  loss?: number;
  /** main-slot value covered from stock at plan / main-slot value planned */
  fill?: [number, number];
  /** job-weeks spent waiting on parts */
  wait?: number;
  /** store credit used at payment */
  cr?: number;
  /** plane-weeks AOG on an alert, by cause (20.5) */
  aog?: Partial<Record<'stock' | 'approval' | 'plan' | 'carrier', number>>;
}

/** 'helper': the electrician's helper (review round 1, from tier 4): does the electrician's planned routine installs */
export type NpcRole = 'pilot' | 'housekeeper' | 'builder' | 'helper';
export interface Npc {
  id: string;
  name: string;
  role: NpcRole;
  skill: 1 | 2 | 3 | 4 | 5;
  wage: number;
  hired: number;
  start: number;
}
export interface Candidate {
  id: string;
  name: string;
  role: NpcRole;
  skill: 1 | 2 | 3 | 4 | 5;
  ask: number;
  start: number;
}
/** `done`: work units done (fractional); `drawn`: units whose materials have left stock; `need`: units (BUILDS, 15.5) */
export interface Build {
  id: string;
  what: string;
  tier?: number;
  cottage?: string;
  done: number;
  drawn?: number;
  need: number;
  started: number;
  finished?: number;
  rework?: number;
  idle?: number;
}

export type StaffAction = { t: 'hire'; cand: string; week?: number } | { t: 'letGo'; npc: string; week?: number } | { t: 'build'; what: 'cottage'; week?: number };

/** An electrical job's site (derived from the alert's seed: src/sim/alerts.ts siteOf) */
export interface ElecSite {
  room: 'bath' | 'kitchen' | 'bedroom' | 'living' | 'laundry' | 'outdoor' | 'hall' | 'panel' | 'spa' | 'dock' | 'gen';
  /** where the device the fix replaces sits, when it isn't the complaint's room (default: room) */
  deviceRoom?: ElecSite['room'];
  /** the circuit's breaker as it is */
  amps: 15 | 20 | 30 | 50 | 60 | 100;
  /** its conductors as they are */
  awg: 14 | 12 | 10 | 8 | 6 | 3;
  /** an individual branch circuit with a single receptacle (a microwave, a window unit) */
  single?: boolean;
  /** protection already there upstream (the device is on a GFCI's LOAD side; an AFCI breaker) */
  upstream?: 'gfci' | 'afci' | 'df';
  wet?: boolean;
  run?: 'nm' | 'buried' | 'exposed';
  feet?: number;
  /** transfer: the backed-up load, amps */
  load?: number;
  /** the appliance on a `single` circuit: 'microwave' | 'window unit' */
  appliance?: string;
  /** the load the circuit feeds, when it isn't the room's own (the water heater behind a bathroom's tingle) */
  what?: string;
  /** a 2-pole breaker (a 240 V load) */
  poles?: 1 | 2;
}
