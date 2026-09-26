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
  /** a kit shipped by boat when no plane could carry it */
  boatKit: 350,
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
  /** the job as a noun, for "traced to the <log> Ana signed off in week 5" */
  log: string;
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
    kind: 'inspect100', log: '100-hr inspection', role: 'mech', title: '100-hr inspection', puzzle: 'crack', tier: 1, cost: 180, parts: 0, gain: 10,
    targets: ['twin', 'cargo', 'float'],
    weight: (a) => ((a.sinceInspection ?? 0) >= ECON.planeInspectionFlights - 2 ? 100 : 0),
  },
  { kind: 'tires', log: 'tire and brake job', role: 'mech', title: 'Tire and brake', puzzle: 'torque', tier: 1, cost: 320, parts: 1, gain: 10, targets: ['twin', 'cargo', 'float'], weight: below(96, 3) },
  { kind: 'prop', log: 'prop bolt re-torque', role: 'mech', title: 'Prop bolt re-torque', puzzle: 'torque', tier: 2, cost: 280, parts: 0, gain: 12, targets: ['twin', 'cargo', 'float'], weight: below(90, 3) },
  { kind: 'corrosion', log: 'wheel-half penetrant check', role: 'mech', title: 'Wheel-half penetrant check', puzzle: 'crack', tier: 2, cost: 520, parts: 0, gain: 16, targets: ['twin', 'cargo', 'float'], weight: below(86, 4) },
  { kind: 'avionics', log: 'com radio swap', role: 'mech', title: 'Swap the com radio', puzzle: 'teardown', tier: 2, cost: 640, parts: 1, gain: 14, targets: ['twin', 'cargo', 'float'], weight: below(92, 2) },
  { kind: 'alternator', log: 'alternator replacement', role: 'mech', title: 'Replace alternator', puzzle: 'teardown', tier: 2, cost: 820, parts: 1, gain: 18, targets: ['twin', 'cargo', 'float'], weight: below(80, 4) },
  { kind: 'cylinder', log: 'cylinder swap', role: 'mech', title: 'Engine cylinder swap', puzzle: 'teardown', tier: 3, cost: 1700, parts: 1, gain: 28, targets: ['twin', 'cargo', 'float'], weight: below(65, 8) },
  { kind: 'spar', log: 'wing spar inspection', role: 'mech', title: 'Wing spar inspection', puzzle: 'crack', tier: 3, cost: 880, parts: 0, gain: 22, targets: ['twin', 'cargo', 'float'], weight: below(60, 8) },
  // paperwork, not a repair: no health gain, but no load sheet means half the charters stay on the ramp
  { kind: 'wb', log: 'charter load sheet', role: 'mech', title: 'Charter load sheet', puzzle: 'balance', tier: 1, cost: 0, parts: 0, gain: 0, targets: ['twin', 'float'], weight: () => 100 },
  { kind: 'wire', log: 'prop bolt safety wiring', role: 'mech', title: 'Safety-wire prop bolts', puzzle: 'safetywire', tier: 2, cost: 150, parts: 0, gain: 11, targets: ['twin', 'cargo', 'float'], weight: below(94, 3) },
  { kind: 'oil', log: 'oil change', role: 'mech', title: 'Oil change + safety wire', puzzle: 'safetywire', tier: 1, cost: 190, parts: 0, gain: 9, targets: ['twin', 'cargo', 'float'], weight: below(97, 2) },
  // power brakes and an accumulator: the twin's brake-and-gear system and the amphibian floats' gear system
  { kind: 'hydraulics', log: 'brake hydraulic servicing', role: 'mech', title: 'Service the brake hydraulics', puzzle: 'hydraulics', tier: 2, cost: 260, parts: 0, gain: 13, targets: ['twin', 'float'], weight: below(94, 4) },
  // the singles only (the puzzle's airframes): a piston single through order tier 3, a turbine single from tier 4
  { kind: 'gpustart', log: 'ground power start', role: 'mech', title: 'Ground power start: weak battery', puzzle: 'gpu', tier: 2, cost: 120, parts: 0, gain: 8, targets: ['cargo', 'float'], weight: below(96, 4) },
  // Electrician — houses
  { kind: 'trip', log: 'dead-outlet trace', role: 'elec', title: 'Trace dead outlets', puzzle: 'trace', tier: 1, cost: 120, parts: 0, gain: 12, targets: ['cottage', 'villa', 'lodge'], weight: below(95, 4) },
  { kind: 'gfci', log: 'wet-room GFCI install', role: 'elec', title: 'GFCI in wet rooms', puzzle: 'wireup', tier: 1, cost: 210, parts: 0, gain: 10, targets: ['cottage', 'villa', 'lodge'], weight: below(92, 3) },
  { kind: 'switch3', log: '3-way switch rewire', role: 'elec', title: 'Rewire a 3-way switch', puzzle: 'wireup', tier: 2, cost: 290, parts: 0, gain: 12, targets: ['cottage', 'villa', 'lodge'], weight: below(88, 2) },
  {
    kind: 'codeprep', log: 'code inspection prep', role: 'elec', title: 'Code inspection prep', puzzle: 'panel', tier: 1, cost: 150, parts: 0, gain: 6,
    targets: ['cottage', 'villa', 'lodge'],
    weight: (a, week) => ((a.inspectionUntil ?? 0) - week <= 2 ? 100 : 0),
  },
  { kind: 'storm', log: 'storm rewire', role: 'elec', title: 'Storm rewire', puzzle: 'trace', tier: 3, cost: 880, parts: 1, gain: 24, targets: ['cottage', 'villa', 'lodge'], weight: below(60, 8) },
  { kind: 'flicker', log: 'flicker diagnosis', role: 'elec', title: 'Diagnose flickering lights', puzzle: 'meter', tier: 1, cost: 90, parts: 0, gain: 12, targets: ['cottage', 'villa', 'lodge'], weight: below(94, 4) },
  { kind: 'hottub', log: 'hot-tub conduit run', role: 'elec', title: 'Run conduit to the hot tub', puzzle: 'conduit', tier: 2, cost: 460, parts: 1, gain: 16, targets: ['cottage', 'villa', 'lodge'], weight: below(86, 2) },
  // Electrician — grid + generator
  { kind: 'feeder', log: 'feeder trace', role: 'elec', title: 'Trace a dead cottage feeder', puzzle: 'trace', tier: 2, cost: 420, parts: 0, gain: 16, targets: ['panel'], weight: below(90, 4) },
  { kind: 'panelUp', log: 'panel upgrade', role: 'elec', title: 'Panel upgrade', puzzle: 'panel', tier: 3, cost: 2100, parts: 1, gain: 30, targets: ['panel'], weight: below(66, 8) },
  { kind: 'genService', log: 'generator engine service', role: 'mech', title: 'Generator engine service', puzzle: 'torque', tier: 2, cost: 380, parts: 0, gain: 15, targets: ['gen'], weight: below(90, 3) },
  { kind: 'transfer', log: 'transfer panel install', role: 'elec', title: 'Generator transfer panel', puzzle: 'panel', tier: 3, cost: 1150, parts: 1, gain: 22, targets: ['gen'], weight: below(78, 4) },
  { kind: 'xfmr', log: 'dead-circuit diagnosis', role: 'elec', title: 'Diagnose a dead circuit at the panel', puzzle: 'meter', tier: 2, cost: 200, parts: 0, gain: 14, targets: ['panel'], weight: below(88, 3) },
  { kind: 'dockrun', log: 'fuel-dock conduit run', role: 'elec', title: 'Conduit run to the fuel dock', puzzle: 'conduit', tier: 3, cost: 520, parts: 1, gain: 18, targets: ['panel'], weight: below(80, 2) },
  { kind: 'genTest', log: 'generator circuit test', role: 'elec', title: 'Test generator-backed circuits', puzzle: 'meter', tier: 2, cost: 160, parts: 0, gain: 12, targets: ['gen'], weight: below(94, 3) },
];

export const CATALOG_BY_KIND = Object.fromEntries(CATALOG.map((c) => [c.kind, c]));

export const FIN_TASKS = {
  close: { title: 'Weekly close', puzzle: 'variance' as PuzzleId, tier: 1 },
  auction: { title: 'Parts auction', puzzle: 'auction' as PuzzleId, tier: 1 },
  forecast: { title: '4-week cash forecast', puzzle: 'forecast' as PuzzleId, tier: 1 },
  reconcile: { title: 'Bank reconciliation', puzzle: 'reconcile' as PuzzleId, tier: 1 },
  invoice: { title: 'Three-way match: vendor invoices', puzzle: 'invoice' as PuzzleId, tier: 1 },
};

// ---------------------------------------------------------------------------
// Consequences: blind sign-off, hidden defects, repairs, cross-trade reports.

/**
 * Blind sign-off and hidden defects. From puzzle tier 2 a real job gives no
 * verdict: how good it was shows up later, in the asset's health, an
 * inspection, or an incident. Tuned against the paper sim (docs/DECISIONS.md,
 * "Consequences"); the spec's starting values are noted where they moved.
 */
export const DEFECT = {
  /** launch tier from which a real job is signed off blind (tiers 0-1 keep teaching feedback) */
  blindFromTier: 2,
  /**
   * A blind sign-off lands a fixed provisional result at once (health, XP), as
   * if it scored this; the true result settles silently when the week resolves,
   * so nothing on screen gives the score away the moment it's handed in.
   */
  provisional: 0.75,
  /** at or above this true score a job leaves nothing behind */
  clean: 0.85,
  /** 0.6 ≤ q < 0.85: chance = (0.85 − q) × slope, so a bare pass is 5% (spec 0.4 → 10%) */
  slope: 0.2,
  /** q < 0.6 (a botch): 10% + 1.8 per point under 0.6, capped at 100% (spec, unchanged) */
  botchBase: 0.1,
  botchSlope: 1.8,
  /** under this, the defect is severe (severity 2) */
  severeBelow: 0.4,
  /** weeks until it surfaces: severity 1 → 1..4 (spec 1..3: more time for an inspection to catch it), severity 2 → 1..2 */
  dueMin: 1,
  dueMax: [4, 2] as const,
  /** incident cost = the original job's cost × this, severity 1 / 2 (spec 1.5 / 3) */
  incidentMult: [1.2, 2.5] as const,
  /** asset health lost when it surfaces, severity 1 / 2 */
  healthHit: [12, 25] as const,
  /** jobs with no price tag (load sheets) still cost at least this much to put right */
  minBase: 300,
  /** repair cost = this × the original's (spec ~0.8; a rule can override); gain = 0.4 × the original's gain, at least 4 */
  repairCost: 0.6,
  repairGain: 0.4,
  repairMinGain: 4,
  /** after an incident, the repair also restores this share of the health the failure took (the failed part is replaced) */
  repairRestores: 0.5,
  /**
   * The redo is free (already paid) and restores this share of the original's
   * gain. Half, not all: the botched sign-off already landed part of it, so a
   * caught defect doesn't end up health-positive against doing it right.
   */
  redoGain: 0.5,
  /** an inspection needs at least a pass to find anything */
  detectAt: 0.6,
};

/** What a hidden defect looks like, and the reasonable repair for it. */
export type DefectRule = {
  /**
   * What happened, by severity: [a write-up or callback, a failure]. `{a}` is
   * the asset's name. The review adds "Traced to …".
   */
  incident: readonly [string, string];
  /** inspection find: "Ana's 100-hr inspection found <found> on Twin N-12, left from week N" */
  found: string;
  /**
   * The corrective job, on a different puzzle from the original. `job` picks
   * the puzzle's scenario (the assembly, part or device it shows); `cost`
   * overrides DEFECT.repairCost for repairs that are bigger than the job.
   */
  fix: { puzzle: PuzzleId; title: string; parts?: number; job?: string; cost?: number };
  /** redo the original afterwards (default true; paperwork that is redone every week anyway says false) */
  redo?: boolean;
};

/**
 * Keyed by the ORIGINAL job's puzzle (a plain string, so a branch that adds a
 * puzzle only adds its row). DEFECT_RULES_BY_KIND overrides a row for one work
 * order kind, where the part matters (a missed spar crack is not a missed
 * wheel-hub crack). Unknown puzzles fall back to DEFECT_FALLBACK for their trade.
 */
export const DEFECT_RULES: Record<string, DefectRule> = {
  torque: {
    incident: ['Fasteners on {a} found loose at the postflight walkaround', 'Fasteners on {a} backed off in service'],
    found: 'fasteners below torque, with fretting at the joint',
    fix: { puzzle: 'teardown', title: 'Replace the loose fasteners and check the holes for elongation', job: 'wheel' },
  },
  crack: {
    incident: ['A crack the last inspection of {a} missed was found growing', 'A crack the last inspection of {a} missed let go'],
    found: 'a crack the last inspection missed',
    fix: { puzzle: 'teardown', title: 'Remove the cracked part and fit a serviceable one', parts: 1 },
  },
  safetywire: {
    incident: ['Hardware on {a} found backing off: its safety wire pulls the wrong way', 'Safety wire on {a} was pulling the wrong way and the hardware backed off'],
    found: 'safety wire pulling in the loosening direction',
    fix: { puzzle: 'torque', title: 'Re-torque the loosened hardware' },
  },
  teardown: {
    incident: ['A part fitted wrong on {a} came loose in service', 'A part fitted wrong on {a} failed in service'],
    found: 'a misassembled installation',
    fix: { puzzle: 'crack', title: 'Inspect the mount and surrounding structure for damage', job: 'mount' },
  },
  balance: {
    incident: ['Pilot wrote up a heavy landing on {a}: the load sheet had the CG near the aft limit', 'Hard landing on {a} with an out-of-limits load: gear overstressed'],
    found: 'hard-landing damage from an out-of-limits load',
    fix: { puzzle: 'crack', title: 'Hard-landing inspection of the gear', job: 'gear' },
    redo: false,
  },
  // a missed diagnosis leaves damage: repair it first, then do the diagnosis again
  trace: {
    incident: ['Callback from {a}: an outlet is warm and smells burnt', 'A loose backstab at {a} arced and scorched the outlet'],
    found: 'a loose backstab at the last live outlet',
    fix: { puzzle: 'wireup', title: 'Replace the scorched outlet and move it off the backstab', job: 'outlet' },
  },
  panel: {
    incident: ['Callback from {a}: a bedroom circuit smells hot, its breaker oversized for the wire', 'An oversized breaker at {a} let the branch wire overheat: scorched insulation in the wall'],
    found: 'a breaker oversized for its wire',
    fix: { puzzle: 'wireup', title: 'Replace the scorched run and land it on the right-size breaker', parts: 1, job: 'outlet' },
  },
  wireup: {
    incident: ['Callback from {a}: a device is warm, a terminal is loose', 'A loose terminal at {a} overheated and scorched the box'],
    found: 'a loose terminal',
    fix: { puzzle: 'meter', title: 'Locate the loose terminal' },
  },
  meter: {
    incident: ['Callback from {a}: the lights are still flickering', 'A loose neutral at {a} let go: the lights surged and fried a guest’s TV'],
    found: 'a loose neutral the diagnosis missed',
    fix: { puzzle: 'wireup', title: 'Replace the scorched device and re-terminate the neutral', job: 'outlet' },
  },
  // make it safe and find the fault first; the redo re-bends the run and pulls new conductors
  conduit: {
    incident: ['The GFCI on a run at {a} keeps tripping: a conductor nicked in a kinked run', 'A nicked conductor in a kinked run at {a} faulted to ground: circuit dead'],
    found: 'a kinked conduit run with a nicked conductor',
    fix: { puzzle: 'meter', title: 'Find where the run is faulted to ground' },
  },
  // Brake hydraulic servicing. A bleed left with air in the line (or the level
  // or precharge off) leaves a soft brake; the brake comes apart for new piston
  // O-rings and a flushed line, then the service is done again.
  hydraulics: {
    incident: [
      'Pilot wrote up a soft, spongy brake pedal on {a} after the hydraulic service',
      'Brakes on {a} faded on the landing roll, air still in the line from the hydraulic service: it ran off the end of the strip',
    ],
    found: 'air left in a brake line after the hydraulic service',
    fix: { puzzle: 'teardown', title: 'Pull the brake, replace the piston O-rings and flush the line', parts: 1, job: 'brake' },
  },
  // variant (the puzzle reports it): the wrong fluid went in. Buna-N seals swell and weep.
  'hydraulics:fluid': {
    incident: [
      'Fluid weeping at a brake caliper on {a}: the seals are swelling from the wrong hydraulic fluid',
      'A swollen brake seal on {a} let go on the landing roll: one brake gone, it slid off onto the grass',
    ],
    found: 'the wrong fluid in the brake system, its seals swelling',
    fix: { puzzle: 'teardown', title: 'Drain and flush the hydraulic system, replace every seal the wrong fluid reached', parts: 1, job: 'brake', cost: 1.5 },
  },
  // Ground power start. A sloppy start (avionics on at power-up, 28 V into a
  // 14 V ship) spikes the avionics bus; the radio comes out, then the start is
  // done again by the book.
  gpu: {
    incident: [
      'Pilot wrote up a dead com radio on {a} after the ground power start: a spike reached the avionics',
      'The radios on {a} failed on departure: the ground power start had spiked the avionics bus',
    ],
    found: 'avionics damaged by a spike on the ground power start',
    fix: { puzzle: 'teardown', title: 'Replace the spike-damaged com radio and check the bus', parts: 1, job: 'avionics' },
  },
  // variant: the plug went in or came out with the cart live. The arc pits the pins.
  'gpu:arc': {
    incident: [
      'Pilot wrote up the external power receptacle on {a}: burnt, pitted pins and the plug runs hot',
      'The arced external power receptacle on {a} overheated on the next start: melted plug, scorched wiring behind it',
    ],
    found: 'arced, pitted pins in the external power receptacle',
    fix: { puzzle: 'teardown', title: 'Replace the arced external power receptacle and check the relay contacts', parts: 1, job: 'receptacle' },
  },
  // variant (turbine): a hot start nobody wrote up. The hot section comes out
  // for a borescope and the CT disk goes through the penetrant booth.
  'gpu:hot': {
    incident: [
      'Engine trend check on {a} flagged the ITT exceedance from its ground power start: hot-section borescope written up',
      '{a} lost power on climb-out: turbine blades burnt in a hot start nobody wrote up, precautionary landing',
    ],
    found: 'hot-start damage in the turbine hot section',
    fix: { puzzle: 'crack', title: 'Hot-section inspection: borescope the vanes and blades, penetrant on the CT disk', parts: 1, job: 'hotsection', cost: 3 },
  },
};

/** Per work-order kind: checked before the puzzle row. A repair's own defect uses the puzzle row. */
export const DEFECT_RULES_BY_KIND: Record<string, DefectRule> = {
  // mechanic
  tires: {
    incident: ['Wheel through-bolts on {a} found loose at the walkaround', 'Wheel through-bolts on {a} backed off on the landing roll and flat-spotted the tire'],
    found: 'wheel through-bolts below torque, with fretting at the joint',
    fix: { puzzle: 'teardown', title: 'Replace the wheel through-bolts and check the holes for elongation', job: 'wheel' },
  },
  prop: {
    incident: ['Pilot wrote up a vibration on {a}: prop bolts found loose', 'Prop bolts on {a} backed off in flight: heavy vibration, precautionary landing'],
    found: 'prop bolts below torque, with fretting on the flange',
    fix: { puzzle: 'teardown', title: 'Pull the prop, replace the bolts, inspect the flange for fretting', job: 'prop' },
  },
  genService: {
    incident: ['{a}: the generator shook on its weekly run, mount bolts found loose', '{a}: the generator mount bolts backed off and it walked on its pad'],
    found: 'generator mount bolts below torque',
    fix: { puzzle: 'teardown', title: 'Replace the mount bolts and the worn isolators', job: 'genmount' },
  },
  inspect100: {
    incident: ['Pilot wrote up an exhaust smell in the {a} cabin: a cracked exhaust riser the 100-hr missed', 'CO detector went off in flight on {a}: a cracked exhaust riser the 100-hr missed'],
    found: 'a cracked exhaust riser the last 100-hr missed',
    fix: { puzzle: 'teardown', title: 'Replace the cracked exhaust riser', parts: 1, job: 'exhaust' },
  },
  corrosion: {
    incident: ['{a} lost tire pressure overnight: a wheel-half crack the penetrant check missed', 'A wheel half on {a} cracked through on landing and blew the tire'],
    found: 'a wheel-half crack the penetrant check missed',
    fix: { puzzle: 'teardown', title: 'Replace the wheel half and tire', parts: 1, job: 'wheelhalf' },
  },
  spar: {
    incident: [
      'Pilot reported smoking rivets at the {a} wing root: the spar-cap crack the inspection missed has grown',
      'The spar-cap crack the inspection missed on {a} has grown past limits: the wing root is working in flight',
    ],
    found: 'a spar-cap crack the last inspection missed',
    fix: { puzzle: 'teardown', title: 'Spar-cap doubler repair per the SRM', parts: 1, job: 'sparcap', cost: 1.2 },
  },
  wire: {
    incident: ['Pilot wrote up a vibration on {a}: prop bolts backing off, their safety wire pulls the wrong way', 'Prop bolts on {a} backed off in flight, the safety wire pulling the wrong way: precautionary landing'],
    found: 'prop bolt safety wire pulling in the loosening direction',
    fix: { puzzle: 'torque', title: 'Re-torque the prop bolts' },
  },
  oil: {
    incident: ['Oil on the belly of {a} after one flight: the drain plug is backing off', 'Oil pressure dropped in flight on {a}: the drain plug backed off, precautionary landing'],
    found: 'a drain plug wired in the loosening direction',
    fix: { puzzle: 'torque', title: 'Re-torque the sump and filter adapter bolts' },
  },
  alternator: {
    incident: ['Pilot wrote up a low-voltage light on {a}: the alternator belt was never tensioned', 'The alternator on {a} came off its bracket in flight: electrical failure, precautionary landing'],
    found: 'an alternator belt left untensioned',
    fix: { puzzle: 'crack', title: 'Inspect the alternator bracket for cracks', job: 'bracket' },
  },
  cylinder: {
    incident: ['Oil weeping at a cylinder base on {a}: the base nuts were never torqued in sequence', 'Cylinder base nuts on {a} let go: engine roughness, precautionary landing'],
    found: 'cylinder base nuts out of sequence, with fretting at the flange',
    fix: { puzzle: 'crack', title: 'Check the case and through-bolts for fretting', job: 'case' },
  },
  avionics: {
    incident: ['Pilot wrote up an intermittent com radio on {a}: it isn’t latched in its tray', 'The com radio on {a} dropped out on approach: lost comms'],
    found: 'a com radio not latched in its tray',
    fix: { puzzle: 'crack', title: 'Inspect the radio tray and connector pins', job: 'tray' },
  },
  // electrician
  storm: {
    incident: ['Callback from {a}: one room is still dead after the storm rewire', 'A storm-damaged splice at {a} arced in the wall: scorched box, guests moved'],
    found: 'a storm-damaged splice left in a junction box',
    fix: { puzzle: 'wireup', title: 'Replace the scorched box and re-splice the storm run', job: 'outlet' },
  },
  feeder: {
    incident: ['Two cottages flicker when the {a} feeder is loaded: a loose splice', 'A loose splice on the {a} feeder arced and dropped two cottages'],
    found: 'a loose wire-nut splice in the feeder junction box',
    fix: { puzzle: 'wireup', title: 'Replace the burnt splice on the feeder', job: 'outlet' },
  },
  transfer: {
    incident: ['{a}: the transfer panel tripped under load in a test, a breaker oversized for its wire', '{a}: the transfer panel overheated in a real outage, scorched conductors and houses dark'],
    found: 'a transfer-panel breaker oversized for its wire',
    fix: { puzzle: 'wireup', title: 'Replace the scorched conductors and land them on the right-size breaker', parts: 1, job: 'outlet' },
  },
  gfci: {
    incident: ['Callback from {a}: the bathroom GFCI trips at random', 'A loose terminal on the {a} bathroom GFCI overheated: scorched box, room closed'],
    found: 'a loose terminal on the GFCI',
    fix: { puzzle: 'meter', title: 'Find the loose terminal on the GFCI circuit' },
  },
  switch3: {
    incident: ['Callback from {a}: the hall lights only work from one end', 'A loose traveler at {a} arced in the switch box: scorched box, hall dark'],
    found: 'a traveler on the wrong terminal',
    fix: { puzzle: 'meter', title: 'Find the miswired traveler' },
  },
  xfmr: {
    incident: ['Callback: the dead circuit on {a} dropped out again', 'A loose lug on {a} arced and dropped a feeder'],
    found: 'a loose lug the diagnosis missed',
    fix: { puzzle: 'wireup', title: 'Replace the scorched lug and re-terminate the circuit', job: 'outlet' },
  },
  genTest: {
    incident: ['{a}: a backed-up circuit failed to pick up in the weekly test', '{a}: a backed-up circuit dropped out in a real outage, houses dark'],
    found: 'a backed-up circuit that won’t pick up',
    fix: { puzzle: 'wireup', title: 'Re-terminate the generator circuit', job: 'outlet' },
  },
  hottub: {
    incident: ['The hot-tub GFCI at {a} keeps tripping: a conductor nicked in a kinked run', 'The hot-tub run at {a} faulted to ground: tub closed'],
    found: 'a kinked hot-tub run with a nicked conductor',
    fix: { puzzle: 'meter', title: 'Find where the hot-tub run is faulted to ground' },
  },
  dockrun: {
    incident: ['The fuel-dock GFCI keeps tripping: a conductor nicked in a kinked run from {a}', 'The fuel-dock run from {a} faulted to ground: pumps down'],
    found: 'a kinked fuel-dock run with a nicked conductor',
    fix: { puzzle: 'meter', title: 'Find where the fuel-dock run is faulted to ground' },
  },
};

/** For a puzzle with no row yet (new puzzles land from other branches): a sensible default per trade. */
export const DEFECT_FALLBACK: Record<OpsRole, DefectRule> = {
  mech: {
    incident: ['Work signed off unfinished on {a} came loose in service', 'Work signed off unfinished on {a} failed in service'],
    found: 'work that was signed off unfinished',
    fix: { puzzle: 'teardown', title: 'Rework the job' },
  },
  elec: {
    incident: ['Callback from {a}: a fault the last job left behind', 'A fault the last job at {a} left behind tripped the circuit'],
    found: 'a fault the last job left behind',
    fix: { puzzle: 'meter', title: 'Find the fault the last job left' },
  },
};

/**
 * The rule for a defect: what went wrong first, when the puzzle reported it
 * (`<puzzle>:<variant>`, e.g. 'gpu:hot' for a hot start), then its job kind (a
 * repair's own defect has kind 'repair' and uses its puzzle's row), then its
 * puzzle, then the trade default.
 */
export function defectRule(puzzle: string, role: Role, kind?: string, variant?: string): DefectRule {
  return (
    (variant ? DEFECT_RULES[`${puzzle}:${variant}`] : undefined) ??
    (kind ? DEFECT_RULES_BY_KIND[kind] : undefined) ??
    DEFECT_RULES[puzzle] ??
    DEFECT_FALLBACK[role === 'elec' ? 'elec' : 'mech']
  );
}

/** The failure mode a puzzle reports in its result (`data.defect`), kept only when a rule exists for it. */
export function defectVariant(puzzle: string, data?: Record<string, unknown>): string | undefined {
  const v = data?.defect;
  return typeof v === 'string' && DEFECT_RULES[`${puzzle}:${v}`] ? v : undefined;
}

/** "Pilot wrote up a vibration on Twin N-12: …" */
export const incidentText = (rule: DefectRule, severity: 1 | 2, asset: string) => rule.incident[severity - 1].split('{a}').join(asset);

/**
 * Inspection-type jobs. A pass finds the latent defects its own trade left on
 * the same asset in an earlier week (the chance to fix it before it fails),
 * but only in the work it actually looks at: `scope` lists the job kinds it
 * can find ('all' for a full inspection). A repair or redo counts as the kind
 * of the job it corrects.
 */
export const INSPECTS: Record<string, { name: string; scope: readonly string[] | 'all' }> = {
  inspect100: { name: '100-hr inspection', scope: 'all' },
  // the wheel and brake come off for it: a weeping caliper or a soft pedal on reassembly shows
  corrosion: { name: 'wheel-half penetrant check', scope: ['tires', 'corrosion', 'hydraulics'] },
  spar: { name: 'wing spar inspection', scope: ['spar', 'wb'] },
  // an oil change includes the engine-compartment look and a filter check for metal
  oil: { name: 'oil change and engine look-over', scope: ['oil', 'prop', 'wire', 'cylinder', 'alternator'] },
  codeprep: { name: 'code inspection prep', scope: 'all' },
  // tracing and metering a house's circuits opens the boxes a bad splice hides in
  trip: { name: 'outlet trace', scope: ['trip', 'gfci', 'switch3', 'storm'] },
  flicker: { name: 'flicker diagnosis', scope: ['flicker', 'trip', 'gfci', 'switch3', 'storm'] },
  genTest: { name: 'generator circuit test', scope: ['transfer', 'genTest'] },
  xfmr: { name: 'panel diagnosis', scope: ['xfmr', 'feeder', 'panelUp', 'dockrun'] },
};

export const inspects = (inspection: string, job: string) => {
  const s = INSPECTS[inspection]?.scope;
  return s === 'all' || !!s?.includes(job);
};

/** Cross-trade reports: one trade's problem that another trade has to fix. All three trades report and fix. */
export const REPORT = {
  fromWeek: 3,
  /** chance per week of a new report (spec ~0.4; 0.3 keeps the tier-4 economy off its knife-edge) */
  chance: 0.3,
  /** at most this many open at once (counting fixes that are about to come back), and never two for the same fixer */
  maxOpen: 2,
  /** a 'cap' report limits the reporter to this many jobs per turn (the analyst: desk tasks) */
  capOps: 2,
  capFin: 1,
  /** a fix that doesn't hold comes back after 1..2 weeks */
  againMin: 1,
  againMax: 2,
  /** leak amounts grow with the island tier */
  leakPerTier: 0.3,
};

export type ReportDef = {
  key: string;
  by: Role;
  fixer: Role;
  /** the fixer's card */
  title: string;
  /** feed: "<reporter> reports: <said>. <fixer>, it's yours." */
  said: string;
  /** feed when a fix didn't hold: "<reporter>: <back>. The fix from week N didn't hold." */
  back: string;
  puzzle: PuzzleId;
  /** the puzzle's scenario (teardown assembly, crack part, wire-up device) */
  job?: string;
  effect: 'cap' | 'leak';
  /** leak: USD per resolved week at tier 1 */
  amount?: number;
  /** out of pocket for the fix (paid at once, no approval) */
  cost: number;
  /** the reporter's notice: "<notice>: 2 jobs max until <fixer> <fixes> <it>" */
  notice: string;
  it?: 'it' | 'them';
  /** "fixes" (default), "clears", "sorts out" */
  fixes?: string;
  /** only once the island has this tier (the generator exists from tier 3) */
  minTier?: number;
};

/**
 * Data-driven: a branch that adds a puzzle adds its reports here. The
 * hydraulics and ground power puzzles model aircraft systems only (a light
 * twin's power brakes, a single on a GPU cart), so they bring no crewmate
 * reports yet: a van's soft brakes or a bucket truck's boom need their own
 * scenario in the puzzle first. Leaks are causes that really recur week after
 * week, not one-off errors.
 */
export const REPORTS: ReportDef[] = [
  // the mechanic reports
  { key: 'hangarLights', by: 'mech', fixer: 'elec', title: 'Hangar work lights are dead', said: 'the hangar work lights are dead', back: 'the hangar work lights are out again', puzzle: 'trace', job: 'hangar', effect: 'cap', cost: 60, notice: 'Hangar lights out', it: 'them' },
  { key: 'compressor', by: 'mech', fixer: 'elec', title: 'Hangar compressor keeps tripping its breaker', said: 'the hangar compressor keeps tripping its breaker', back: 'the hangar compressor is tripping its breaker again', puzzle: 'meter', job: 'shop', effect: 'cap', cost: 40, notice: 'No shop air' },
  { key: 'charger', by: 'mech', fixer: 'elec', title: 'Aircraft battery charger keeps tripping the hangar GFCI', said: 'the aircraft battery charger keeps tripping the hangar GFCI', back: 'the battery charger is tripping the GFCI again', puzzle: 'meter', job: 'shop', effect: 'cap', cost: 30, notice: 'No battery charging' },
  { key: 'vendorPrice', by: 'mech', fixer: 'fin', title: 'Parts vendor is billing list price, not our contract price', said: 'the parts vendor is billing list price, not our contract price', back: 'the parts vendor is still billing list price', puzzle: 'invoice', effect: 'leak', amount: 240, cost: 0, notice: 'Parts billed at list' },
  { key: 'avgas', by: 'mech', fixer: 'fin', title: 'Avgas went up $1.20/gal and charter prices never moved', said: 'avgas went up $1.20 a gallon and charter prices never moved', back: 'charter pricing still hasn’t caught up with avgas', puzzle: 'variance', effect: 'leak', amount: 200, cost: 0, notice: 'Charters priced on old fuel' },
  { key: 'creditHold', by: 'mech', fixer: 'fin', title: 'Parts vendor put us on credit hold', said: 'the parts vendor put us on credit hold', back: 'the parts vendor put us back on credit hold', puzzle: 'reconcile', effect: 'cap', cost: 0, notice: 'Parts on credit hold', fixes: 'clears' },
  // the electrician reports
  { key: 'genFan', by: 'elec', fixer: 'mech', title: 'Generator radiator fan bearing is screaming', said: 'the generator radiator fan bearing is screaming', back: 'the generator radiator fan is screaming again', puzzle: 'teardown', job: 'fan', effect: 'cap', cost: 110, notice: 'Generator fan failing', minTier: 3 },
  { key: 'trencher', by: 'elec', fixer: 'mech', title: 'Trencher drive belt snapped', said: 'the trencher drive belt snapped', back: 'the trencher belt let go again', puzzle: 'teardown', job: 'trencher', effect: 'cap', cost: 80, notice: 'Trencher down' },
  { key: 'ladderRack', by: 'elec', fixer: 'mech', title: 'Work truck ladder rack is cracked at the welds', said: 'the work truck ladder rack is cracked at the welds', back: 'the ladder rack weld has cracked again', puzzle: 'crack', job: 'ladder', effect: 'cap', cost: 50, notice: 'Ladder rack unsafe' },
  { key: 'utilityAutopay', by: 'elec', fixer: 'fin', title: 'Utility autopay is drafting more than the bills', said: 'the utility autopay is drafting more than the bills', back: 'the utility autopay is still drafting more than the bills', puzzle: 'reconcile', effect: 'leak', amount: 200, cost: 0, notice: 'Utility overdrafting' },
  { key: 'autoShip', by: 'elec', fixer: 'fin', title: 'Supply house auto-ship keeps billing wire we cancelled', said: 'the supply house auto-ship keeps billing wire we cancelled', back: 'the supply house is still billing the cancelled wire', puzzle: 'invoice', effect: 'leak', amount: 180, cost: 0, notice: 'Cancelled wire still billed' },
  { key: 'copper', by: 'elec', fixer: 'fin', title: 'Copper jumped 20%: fixed-price house jobs are underwater', said: 'copper jumped 20% and the fixed-price house jobs are underwater', back: 'house jobs are still priced on last year’s copper', puzzle: 'variance', effect: 'leak', amount: 220, cost: 0, notice: 'Jobs priced on old copper' },
  // the analyst reports
  { key: 'officeOutlets', by: 'fin', fixer: 'elec', title: 'Office outlets go dead and come back when the printer runs', said: 'the office outlets go dead and come back whenever the printer runs', back: 'the office outlets are dropping out again', puzzle: 'meter', job: 'office', effect: 'cap', cost: 50, notice: 'Office power keeps dropping' },
  // a fault the torque puzzle really fixes (a soft brake pedal would be hydraulic, once that puzzle has a vehicle scenario)
  { key: 'vanWheel', by: 'fin', fixer: 'mech', title: 'Company van wheel is wobbling: lug nuts loose', said: 'the company van wheel is wobbling and the lug nuts are loose', back: 'the van wheel is wobbling again', puzzle: 'torque', effect: 'leak', amount: 160, cost: 60, notice: 'Van off the road' },
];

export const REPORT_BY_KEY: Record<string, ReportDef> = Object.fromEntries(REPORTS.map((r) => [r.key, r]));

export type Tool = { id: string; level: number; name: string; puzzle: PuzzleId; effect: string };

export const TOOLS: Record<Role, Tool[]> = {
  mech: [
    { id: 'clickWrench', level: 3, name: 'Click-type wrench', puzzle: 'torque', effect: 'Clicks when a bolt enters the band' },
    { id: 'borescope', level: 6, name: 'Non-aqueous developer', puzzle: 'crack', effect: 'Swabbed cracks bleed back sooner and brighter' },
    { id: 'partsTray', level: 9, name: 'Numbered parts tray', puzzle: 'teardown', effect: 'Removed parts keep their order number' },
    { id: 'gaugeDamper', level: 12, name: 'Gauge damper', puzzle: 'torque', effect: 'Halves torque needle lag' },
    { id: 'uvPlus', level: 15, name: 'UV floodlamp', puzzle: 'crack', effect: 'Stronger UV: every indication glows brighter' },
    { id: 'cgComputer', level: 18, name: 'Station moment card', puzzle: 'balance', effect: 'Moment per station shown while you drag' },
    { id: 'wirePliers', level: 21, name: 'Safety-wire pliers', puzzle: 'safetywire', effect: 'Live twists-per-inch readout' },
    { id: 'sightLight', level: 24, name: 'Sight-glass loupe', puzzle: 'hydraulics', effect: 'Magnified view of the level at the FULL mark' },
    { id: 'gpuMeter', level: 27, name: 'Digital cart meter', puzzle: 'gpu', effect: 'Cart volts and amps read out in digits' },
    { id: 'chargingKit', level: 30, name: 'Nitrogen charging kit', puzzle: 'hydraulics', effect: 'Fine metering valve: the precharge rises slower' },
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
      mech: { title: 'Acceptance inspection: aluminium deck beams', puzzle: 'crack' },
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
