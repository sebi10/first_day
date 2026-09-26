// Every tunable number lives here so balance passes touch one file.
// scripts/balance.ts re-runs the paper sim against these values.
import type { PuzzleId } from '../puzzles/types';
import type { Asset, Insurance, OpsRole, Role } from './types';

export const ECON = {
  startCash: 8000,
  startParts: 3,
  maxParts: 6,
  /** cash below this freezes every approval (spec) */
  freezeBelow: 2000,
  /** autopilot analyst keeps at least this much cash */
  autopilotFloor: 4000,
  baseNightly: 200,
  baseCharter: 500,
  /** rate cap: 2x base (anti-exploit), floor 0.5x */
  rateCap: 2,
  rateFloor: 0.5,
  /** logistic demand: occupancy = 1 / (1 + e^((rate - mid) / s)) */
  nightlyMid: 360,
  nightlyS: 60,
  charterMid: 850,
  charterS: 150,
  seasonAmp: 0.12,
  seasonPeriod: 13,
  partMarket: { low: 220, high: 460 },
  listPremium: 1.35,
  flightsPerPlane: 4,
  partsPerCargoFlight: 3,
  decay: 5,
  /** health of assets on day one; low enough that neglect bites by week 3 */
  startHealth: 72,
  flightWear: 1,
  houseWear: 2,
  houseInspectionWeeks: 8,
  planeInspectionFlights: 12,
  nearMissPerFlight: 0.1,
  outageChance: 0.25,
  fireChance: 0.15,
  deferral: { base: 0.1, perTier: 0.1, perWeek: 0.1, cap: 0.6, costMult: 3, healthHit: 25 },
  defaultAutoBudget: 500,
  aGradeBonus: 0.1,
};

export const INSURANCE: Record<Insurance, { label: string; premium: number; cover: number }> = {
  none: { label: 'None', premium: 0, cover: 0 },
  standard: { label: 'Standard', premium: 150, cover: 0.5 },
  premium: { label: 'Premium', premium: 320, cover: 0.8 },
};

export type AssetModel = {
  kind: Asset['kind'];
  label: string;
  /** houses: revenue multiple of the nightly rate; planes: charter multiple */
  mult?: number;
  cargo?: boolean;
};

export const MODELS: Record<string, AssetModel> = {
  twin: { kind: 'plane', label: '6-seat piston twin', mult: 1 },
  cargo: { kind: 'plane', label: 'Cargo single', cargo: true },
  float: { kind: 'plane', label: 'Floatplane', mult: 1.6 },
  cottage: { kind: 'house', label: 'Cottage', mult: 1 },
  villa: { kind: 'house', label: 'Premium villa', mult: 2.4 },
  lodge: { kind: 'house', label: 'Lodge', mult: 3.6 },
  panel: { kind: 'grid', label: 'Panel + transformer' },
  gen: { kind: 'generator', label: 'Backup generator' },
};

export type TierDef = {
  n: number;
  name: string;
  fixed: number;
  /** weekly revenue budget for the board grade */
  budget: number;
  adds: { id: string; model: string; name: string }[];
  storms: boolean;
  nightFlights: boolean;
  /** guest parties per week that arrive by boat (tier 3 ferry days) */
  ferry: number;
  unlock: string;
};

export const TIERS: TierDef[] = [
  {
    n: 1,
    name: 'Airstrip',
    fixed: 1500,
    budget: 3900,
    adds: [
      { id: 'p1', model: 'twin', name: 'Twin N-12' },
      { id: 'h1', model: 'cottage', name: 'Cottage 1' },
      { id: 'h2', model: 'cottage', name: 'Cottage 2' },
      { id: 'g1', model: 'panel', name: 'Island grid' },
    ],
    storms: false,
    nightFlights: false,
    ferry: 0,
    unlock: 'Start',
  },
  {
    n: 2,
    name: 'Outpost',
    fixed: 2300,
    budget: 5900,
    adds: [
      { id: 'p2', model: 'cargo', name: 'Cargo C-7' },
      { id: 'h3', model: 'cottage', name: 'Cottage 3' },
      { id: 'h4', model: 'cottage', name: 'Cottage 4' },
    ],
    storms: false,
    nightFlights: false,
    ferry: 0,
    unlock: '4 weeks graded B or better',
  },
  {
    n: 3,
    name: 'Village',
    fixed: 3000,
    budget: 6900,
    adds: [{ id: 'gen', model: 'gen', name: 'Generator house' }],
    storms: true,
    nightFlights: false,
    ferry: 2,
    unlock: 'Cash ≥ $18,000 and 0 incidents over 4 weeks',
  },
  {
    n: 4,
    name: 'Harbor',
    fixed: 7000,
    budget: 16000,
    adds: [
      { id: 'p3', model: 'float', name: 'Float F-3' },
      { id: 'h5', model: 'villa', name: 'Villa East' },
      { id: 'h6', model: 'villa', name: 'Villa West' },
    ],
    storms: true,
    nightFlights: false,
    ferry: 2,
    unlock: '15 weeks total, tier 3, 2 perfect weeks',
  },
  {
    n: 5,
    name: 'Resort',
    fixed: 9500,
    budget: 22000,
    adds: [{ id: 'h7', model: 'lodge', name: 'The Lodge' }],
    storms: true,
    nightFlights: true,
    ferry: 2,
    unlock: '20 weeks total, cash ≥ $60,000',
  },
];

export type CatalogEntry = {
  kind: string;
  role: OpsRole;
  title: string;
  puzzle: PuzzleId;
  tier: number;
  cost: number;
  parts: number;
  gain: number;
  /** which asset models it applies to */
  targets: string[];
  /** 0 = not eligible now */
  weight(a: Asset, week: number): number;
};

const below = (h: number, w: number) => (a: Asset) => (a.health < h ? w : 0);

export const CATALOG: CatalogEntry[] = [
  // Mechanic — planes
  {
    kind: 'inspect100', role: 'mech', title: '100-hr inspection', puzzle: 'crack', tier: 1, cost: 180, parts: 0, gain: 10,
    targets: ['twin', 'cargo', 'float'],
    weight: (a) => ((a.sinceInspection ?? 0) >= ECON.planeInspectionFlights - 2 ? 100 : 0),
  },
  { kind: 'tires', role: 'mech', title: 'Tire and brake', puzzle: 'torque', tier: 1, cost: 320, parts: 1, gain: 10, targets: ['twin', 'cargo', 'float'], weight: below(96, 3) },
  { kind: 'prop', role: 'mech', title: 'Prop bolt re-torque', puzzle: 'torque', tier: 2, cost: 280, parts: 0, gain: 12, targets: ['twin', 'cargo', 'float'], weight: below(90, 3) },
  { kind: 'corrosion', role: 'mech', title: 'Wheel-half penetrant check', puzzle: 'crack', tier: 2, cost: 520, parts: 0, gain: 16, targets: ['twin', 'cargo', 'float'], weight: below(86, 4) },
  { kind: 'avionics', role: 'mech', title: 'Swap the com radio', puzzle: 'teardown', tier: 2, cost: 640, parts: 1, gain: 14, targets: ['twin', 'cargo', 'float'], weight: below(92, 2) },
  { kind: 'alternator', role: 'mech', title: 'Replace alternator', puzzle: 'teardown', tier: 2, cost: 820, parts: 1, gain: 18, targets: ['twin', 'cargo', 'float'], weight: below(80, 4) },
  { kind: 'cylinder', role: 'mech', title: 'Engine cylinder swap', puzzle: 'teardown', tier: 3, cost: 1700, parts: 1, gain: 28, targets: ['twin', 'cargo', 'float'], weight: below(65, 8) },
  { kind: 'spar', role: 'mech', title: 'Wing spar inspection', puzzle: 'crack', tier: 3, cost: 880, parts: 0, gain: 22, targets: ['twin', 'cargo', 'float'], weight: below(60, 8) },
  // paperwork, not a repair: no health gain, but no load sheet means half the charters stay on the ramp
  { kind: 'wb', role: 'mech', title: 'Charter load sheet', puzzle: 'balance', tier: 1, cost: 0, parts: 0, gain: 0, targets: ['twin', 'float'], weight: () => 100 },
  { kind: 'wire', role: 'mech', title: 'Safety-wire prop bolts', puzzle: 'safetywire', tier: 2, cost: 150, parts: 0, gain: 11, targets: ['twin', 'cargo', 'float'], weight: below(94, 3) },
  { kind: 'oil', role: 'mech', title: 'Oil change + safety wire', puzzle: 'safetywire', tier: 1, cost: 190, parts: 0, gain: 9, targets: ['twin', 'cargo', 'float'], weight: below(97, 2) },
  // Electrician — houses
  { kind: 'trip', role: 'elec', title: 'Trace dead outlets', puzzle: 'trace', tier: 1, cost: 120, parts: 0, gain: 12, targets: ['cottage', 'villa', 'lodge'], weight: below(95, 4) },
  { kind: 'gfci', role: 'elec', title: 'GFCI in wet rooms', puzzle: 'wireup', tier: 1, cost: 210, parts: 0, gain: 10, targets: ['cottage', 'villa', 'lodge'], weight: below(92, 3) },
  { kind: 'switch3', role: 'elec', title: 'Rewire a 3-way switch', puzzle: 'wireup', tier: 2, cost: 290, parts: 0, gain: 12, targets: ['cottage', 'villa', 'lodge'], weight: below(88, 2) },
  {
    kind: 'codeprep', role: 'elec', title: 'Code inspection prep', puzzle: 'panel', tier: 1, cost: 150, parts: 0, gain: 6,
    targets: ['cottage', 'villa', 'lodge'],
    weight: (a, week) => ((a.inspectionUntil ?? 0) - week <= 2 ? 100 : 0),
  },
  { kind: 'storm', role: 'elec', title: 'Storm rewire', puzzle: 'trace', tier: 3, cost: 880, parts: 1, gain: 24, targets: ['cottage', 'villa', 'lodge'], weight: below(60, 8) },
  { kind: 'flicker', role: 'elec', title: 'Diagnose flickering lights', puzzle: 'meter', tier: 1, cost: 90, parts: 0, gain: 12, targets: ['cottage', 'villa', 'lodge'], weight: below(94, 4) },
  { kind: 'hottub', role: 'elec', title: 'Run conduit to the hot tub', puzzle: 'conduit', tier: 2, cost: 460, parts: 1, gain: 16, targets: ['cottage', 'villa', 'lodge'], weight: below(86, 2) },
  // Electrician — grid + generator
  { kind: 'feeder', role: 'elec', title: 'Trace a dead cottage feeder', puzzle: 'trace', tier: 2, cost: 420, parts: 0, gain: 16, targets: ['panel'], weight: below(90, 4) },
  { kind: 'panelUp', role: 'elec', title: 'Panel upgrade', puzzle: 'panel', tier: 3, cost: 2100, parts: 1, gain: 30, targets: ['panel'], weight: below(66, 8) },
  { kind: 'genService', role: 'mech', title: 'Generator engine service', puzzle: 'torque', tier: 2, cost: 380, parts: 0, gain: 15, targets: ['gen'], weight: below(90, 3) },
  { kind: 'transfer', role: 'elec', title: 'Generator transfer panel', puzzle: 'panel', tier: 3, cost: 1150, parts: 1, gain: 22, targets: ['gen'], weight: below(78, 4) },
  { kind: 'xfmr', role: 'elec', title: 'Diagnose a dead circuit at the panel', puzzle: 'meter', tier: 2, cost: 200, parts: 0, gain: 14, targets: ['panel'], weight: below(88, 3) },
  { kind: 'dockrun', role: 'elec', title: 'Conduit run to the fuel dock', puzzle: 'conduit', tier: 3, cost: 520, parts: 1, gain: 18, targets: ['panel'], weight: below(80, 2) },
  { kind: 'genTest', role: 'elec', title: 'Test generator-backed circuits', puzzle: 'meter', tier: 2, cost: 160, parts: 0, gain: 12, targets: ['gen'], weight: below(94, 3) },
];

export const CATALOG_BY_KIND = Object.fromEntries(CATALOG.map((c) => [c.kind, c]));

export const FIN_TASKS = {
  close: { title: 'Weekly close', puzzle: 'variance' as PuzzleId, tier: 1 },
  auction: { title: 'Parts auction', puzzle: 'auction' as PuzzleId, tier: 1 },
  forecast: { title: '4-week cash forecast', puzzle: 'forecast' as PuzzleId, tier: 1 },
  reconcile: { title: 'Bank reconciliation', puzzle: 'reconcile' as PuzzleId, tier: 1 },
  invoice: { title: 'Three-way match: vendor invoices', puzzle: 'invoice' as PuzzleId, tier: 1 },
};

export type Tool = { id: string; level: number; name: string; puzzle: PuzzleId; effect: string };

export const TOOLS: Record<Role, Tool[]> = {
  mech: [
    { id: 'clickWrench', level: 3, name: 'Click-type wrench', puzzle: 'torque', effect: 'Clicks when a bolt enters the band' },
    { id: 'borescope', level: 6, name: 'Non-aqueous developer', puzzle: 'crack', effect: 'Indications bleed out faster and linger' },
    { id: 'partsTray', level: 9, name: 'Numbered parts tray', puzzle: 'teardown', effect: 'Removed parts keep their order number' },
    { id: 'gaugeDamper', level: 12, name: 'Gauge damper', puzzle: 'torque', effect: 'Halves torque needle lag' },
    { id: 'uvPlus', level: 15, name: 'UV floodlamp', puzzle: 'crack', effect: 'Wider lamp beam' },
    { id: 'cgComputer', level: 18, name: 'Station moment card', puzzle: 'balance', effect: 'Moment per station shown while you drag' },
    { id: 'wirePliers', level: 21, name: 'Safety-wire pliers', puzzle: 'safetywire', effect: 'Live twists-per-inch readout' },
  ],
  elec: [
    { id: 'clampMeter', level: 12, name: 'Clamp meter', puzzle: 'panel', effect: 'Live amps per phase while dragging' },
    { id: 'toneTracer', level: 6, name: 'Tone tracer', puzzle: 'trace', effect: 'Steady tone while you follow a cable' },
    { id: 'labelMaker', level: 9, name: 'Headlamp', puzzle: 'wireup', effect: 'Read the markings stamped on the device' },
    { id: 'fishTape', level: 3, name: 'Circuit tracer receiver', puzzle: 'trace', effect: 'Junction-box branches readable' },
    { id: 'torqueScrewdriver', level: 15, name: 'Stripper with gauge', puzzle: 'wireup', effect: 'Live strip-length readout' },
    { id: 'nonContact', level: 18, name: 'Non-contact tester', puzzle: 'meter', effect: 'Glows near live conductors' },
    { id: 'bender', level: 21, name: 'Bender with printed table', puzzle: 'conduit', effect: 'Multiplier and shrink table on the shoe' },
  ],
  fin: [
    { id: 'driverTree', level: 3, name: 'Driver tree', puzzle: 'variance', effect: 'Lines grouped by driver' },
    { id: 'marketScanner', level: 6, name: 'Market scanner', puzzle: 'auction', effect: "Shows rival buyers' appetite" },
    { id: 'seasonality', level: 9, name: 'Seasonality overlay', puzzle: 'forecast', effect: 'Seasonal band on the chart' },
    { id: 'pivot', level: 12, name: 'Pivot sort', puzzle: 'variance', effect: 'Sort by absolute variance' },
    { id: 'bidMemory', level: 15, name: 'Bid memory', puzzle: 'auction', effect: "Shows rivals' last raises" },
    { id: 'autoMatch', level: 18, name: 'Auto-match rules', puzzle: 'reconcile', effect: 'Exact 1:1 matches pre-highlighted' },
    { id: 'poLookup', level: 21, name: 'PO lookup', puzzle: 'invoice', effect: 'PO lines show unit prices' },
  ],
};

export type Cosmetic = { id: string; level: number; name: string; color: string };

export const COSMETICS: Record<Role, Cosmetic[]> = {
  mech: [
    { id: 'm0', level: 1, name: 'Classic tan hangar', color: '#E0A458' },
    { id: 'm1', level: 5, name: 'Sea-stripe hangar', color: '#2E7C93' },
    { id: 'm2', level: 10, name: 'Palm-green hangar', color: '#4E8A5A' },
    { id: 'm3', level: 15, name: 'Ink hangar', color: '#34444C' },
    { id: 'm4', level: 20, name: 'Lavender hangar', color: '#9C8FC7' },
    { id: 'm5', level: 25, name: 'Gold hangar', color: '#D9B44A' },
  ],
  elec: [
    { id: 'e0', level: 1, name: 'Sand trim', color: '#E6D0A6' },
    { id: 'e1', level: 5, name: 'Sea shutters', color: '#2E7C93' },
    { id: 'e2', level: 10, name: 'Palm doors', color: '#4E8A5A' },
    { id: 'e3', level: 15, name: 'Sky trim', color: '#8FB8DE' },
    { id: 'e4', level: 20, name: 'Lavender trim', color: '#9C8FC7' },
    { id: 'e5', level: 25, name: 'Sunflower trim', color: '#F4D35E' },
  ],
  fin: [
    { id: 'f0', level: 1, name: 'Plain office', color: '#8FB8DE' },
    { id: 'f1', level: 5, name: 'Office plants', color: '#4E8A5A' },
    { id: 'f2', level: 10, name: 'Sea awning', color: '#2E7C93' },
    { id: 'f3', level: 15, name: 'Tan awning', color: '#E0A458' },
    { id: 'f4', level: 20, name: 'Lavender awning', color: '#9C8FC7' },
    { id: 'f5', level: 25, name: 'Gold awning', color: '#D9B44A' },
  ],
};

export const MAX_LEVEL = 30;
/** cumulative XP needed to reach level L (L >= 1) */
export const xpForLevel = (L: number) => 250 * (L - 1) + 8 * (L - 1) ** 2;

export const STORIES = [
  {
    id: 'blogger',
    title: 'A travel blogger writes in',
    body: 'Free week in a cottage for a feature. Big audience.',
    options: [
      { key: 'host', label: 'Host them', effect: '−$900 now, +15% bookings for 4 weeks' },
      { key: 'pass', label: 'Politely pass', effect: 'Nothing changes' },
    ],
  },
  {
    id: 'inspector',
    title: 'County inspector in town',
    body: 'She can do every house this week if you pay the call-out.',
    options: [
      { key: 'book', label: 'Book her', effect: '−$400, all inspections renewed 8 weeks' },
      { key: 'wait', label: 'Wait', effect: 'Nothing changes' },
    ],
  },
  {
    id: 'rival',
    title: 'Rival charter undercuts you',
    body: 'Harbor Hops is selling day tours at half price.',
    options: [
      { key: 'ads', label: 'Run ads', effect: '−$600, charter demand holds' },
      { key: 'ignore', label: 'Ignore them', effect: '−20% charter demand for 3 weeks' },
    ],
  },
  {
    id: 'shutters',
    title: 'Storm shutters on sale',
    body: 'Mainland shop clearing stock before the season.',
    options: [
      { key: 'buy', label: 'Buy shutters', effect: '−$1,200, storm damage halved for 8 weeks' },
      { key: 'skip', label: 'Skip', effect: 'Nothing changes' },
    ],
  },
  {
    id: 'surplus',
    title: 'Closing-down parts sale',
    body: 'Three generic kits, cash only, today.',
    options: [
      { key: 'buy', label: 'Buy 3 kits', effect: '−$600, +3 kits in stock (max 6)' },
      { key: 'pass', label: 'Pass', effect: 'Nothing changes' },
    ],
  },
  {
    id: 'wedding',
    title: 'A wedding party asks',
    body: 'Every house next week, and they love the island.',
    options: [
      { key: 'yes', label: 'Say yes', effect: '+40% bookings next week' },
      { key: 'no', label: 'Decline', effect: 'Nothing changes' },
    ],
  },
] as const;

/** Each new tier is built together: one real job per trade. */
export const PROJECTS: Record<number, { title: string; jobs: Record<Role, { title: string; puzzle: PuzzleId }> }> = {
  2: {
    title: 'Commission the cargo plane and cottages 3–4',
    jobs: {
      mech: { title: 'First cargo load sheet', puzzle: 'balance' },
      elec: { title: 'Put cottages 3–4 on the panel', puzzle: 'panel' },
      fin: { title: 'Pay the builders (three-way match)', puzzle: 'invoice' },
    },
  },
  3: {
    title: 'Build the generator house and ferry dock',
    jobs: {
      mech: { title: 'Torque the generator mounts', puzzle: 'torque' },
      elec: { title: 'Commission the generator circuits', puzzle: 'meter' },
      fin: { title: 'Finance plan: 4-week cash forecast', puzzle: 'forecast' },
    },
  },
  4: {
    title: 'Bring in the floatplane and the villas',
    jobs: {
      mech: { title: 'Safety-wire the float fittings', puzzle: 'safetywire' },
      elec: { title: 'Run conduit to the villas', puzzle: 'conduit' },
      fin: { title: 'Win the floatplane at auction', puzzle: 'auction' },
    },
  },
  5: {
    title: 'Open the Lodge',
    jobs: {
      mech: { title: 'Acceptance inspection: lodge deck beams', puzzle: 'crack' },
      elec: { title: 'Wire the lodge GFCIs', puzzle: 'wireup' },
      fin: { title: 'Opening budget review', puzzle: 'variance' },
    },
  },
};

export const ROLE_LABEL: Record<Role, string> = { mech: 'Mechanic', elec: 'Electrician', fin: 'Analyst' };
export const ROLE_LONG: Record<Role, string> = {
  mech: 'A&P mechanic',
  elec: 'Residential electrician',
  fin: 'FP&A analyst',
};
