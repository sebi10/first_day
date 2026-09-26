// Mechanic · Hydraulic servicing. Service a light twin's brake-and-gear hydraulic
// system the way the maintenance manual has it: read the servicing placard, pump
// the brakes until the accumulator is discharged (under pressure the accumulator
// holds fluid, so the sight gauge reads low), pour the placarded fluid to the FULL
// mark and refit the cap. From tier 3 the accumulator's nitrogen precharge must be
// set for the ramp temperature (gas pressure scales with absolute temperature),
// and from tier 4 a spongy brake has to be bled without running the reservoir dry.
// Tiers 0-2 explain the placard and number the steps; from tier 3 only the
// placard, the cans and the gauges are on screen.
//
// Blind sign-off (a real job from tier 2, params.blind): no verdict while you
// work or when you sign. The wrong can pours like any other (its colour shows
// in the glass, nothing stops you), oxygen charges like nitrogen, no shakes, no
// "Not this system!" or "At FULL", no ticked-off steps (the work card just shows
// the procedure), no green ring at 0 psi and no flourish. What the system
// itself shows stays: the gauges, the level in the sight glass, fluid spilling
// over, a soft pedal, bubbles in the bleed hose.
//
// The brakes are POWER brakes (Twin Otter, Aero Commander): the pedal only
// meters accumulator pressure through a brake valve. Each application uses some
// accumulator fluid, which returns to the reservoir, so pumping the pedal
// discharges the accumulator. With the accumulator discharged the pedal moves
// nothing. Bleed pressure comes from the hand pump: with the pedal up it charges
// the accumulator (press the pedal to push that through the open bleeder), with
// the pedal held down it pumps straight through the brake. Either way the bleed
// empties the reservoir and can leave the accumulator charged, so afterwards you
// pump the brakes down again and recheck the level before sign-off.
import { hashSeed, rng } from '../sim/rng';
import { C, FONT, backdrop, clamp, ease, fitLabel, label, loop, markInput, pointer, roundRect, settle, shade, stage } from './kit';
import { result, type ManualCard, type PuzzleDef, type PuzzleResult } from './types';

// ---------------------------------------------------------------------------
// Fluids. MIL-PRF-5606 (red, mineral base) is the light-aircraft norm and runs on
// Buna-N (nitrile) seals; MIL-PRF-83282 is a compatible synthetic hydrocarbon the
// placard may allow. Phosphate ester (Skydrol, purple) is for transport category
// and destroys Buna-N; glycol brake fluid, turbine oil and the old vegetable-base
// fluid don't belong in a 5606 system either.
// ---------------------------------------------------------------------------

export type FluidId = 'mil5606' | 'mil83282' | 'skydrol' | 'dot3' | 'turbine' | 'veg';

export type Fluid = {
  id: FluidId;
  /** the specification printed on the can */
  spec: string;
  /** teaching tiers: short name and what it is */
  name: string;
  plain: string;
  /** the fluid's dye colour */
  color: string;
  /** safe with Buna-N seals / miscible with 5606 */
  compatible: boolean;
  /** what it does to a 5606 system */
  harm: string;
};

export const FLUIDS: Record<FluidId, Fluid> = {
  mil5606: { id: 'mil5606', spec: 'MIL-PRF-5606H', name: 'MIL-PRF-5606', plain: 'red · mineral base', color: '#B8233A', compatible: true, harm: '' },
  mil83282: { id: 'mil83282', spec: 'MIL-PRF-83282D', name: 'MIL-PRF-83282', plain: 'red · only if placarded', color: '#A9213F', compatible: true, harm: '' },
  skydrol: {
    id: 'skydrol',
    spec: 'SAE AS1241 TYPE IV',
    name: 'Skydrol',
    plain: 'purple · airliners only',
    color: '#7B4FA6',
    compatible: false,
    harm: 'Phosphate ester destroys Buna-N seals',
  },
  dot3: { id: 'dot3', spec: 'DOT 3 · FMVSS 116', name: 'DOT 3', plain: 'car brake fluid', color: '#D6B66E', compatible: false, harm: 'Glycol brake fluid won’t mix with 5606' },
  turbine: { id: 'turbine', spec: 'MIL-PRF-23699', name: 'Turbine oil', plain: 'jet engine oil', color: '#C68A2C', compatible: false, harm: 'Ester engine oil swells Buna-N seals' },
  veg: { id: 'veg', spec: 'MIL-H-7644', name: 'MIL-H-7644', plain: 'blue · vegetable base', color: '#3E6DB3', compatible: false, harm: 'Vegetable-base fluid gums up a 5606 system' },
};

/** The second line printed on a can from tier 3. From tier 4 the fire-resistant fluids read alike: only the spec tells them apart. */
export function canKind(id: FluidId, tier: number): string {
  switch (id) {
    case 'mil5606':
      return 'Hydraulic fluid · petroleum base';
    case 'mil83282':
      return tier >= 4 ? 'Fire-resistant hydraulic fluid' : 'Hydraulic fluid · synthetic hydrocarbon';
    case 'skydrol':
      return tier >= 4 ? 'Fire-resistant hydraulic fluid' : 'Hydraulic fluid · phosphate ester';
    case 'dot3':
      return 'Brake fluid · glycol ether';
    case 'turbine':
      return 'Turbine engine oil';
    case 'veg':
      return 'Hydraulic fluid · vegetable base';
  }
}

// ---------------------------------------------------------------------------
// Model. Fluid volumes are in sight-glass heights (0 = bottom of the glass,
// 1 = top), so the level on screen and the numbers in the rules are the same.
// ---------------------------------------------------------------------------

export type Precharge = {
  /** placard: precharge `ref` psi at `refTemp` */
  ref: number;
  refTemp: number;
  unit: 'F' | 'C';
  /** ramp (accumulator) temperature today */
  ramp: number;
  /** what the gauge should read today, psi */
  target: number;
  tol: number;
  /** card-driven: today's targets for the task card's other effectivity lines (the wrong S/N block's value) */
  others?: number[];
};

/** Card-driven servicing: the task card's lines, both effectivities as printed (tiers 0-2 mark this airplane's). */
export type HydCard = {
  task: string;
  plate: string;
  marked: boolean;
  sbs: string[];
  fluid: { eff?: string; effText?: string; fluids: FluidId[]; applies: boolean }[];
  precharge: { eff?: string; effText?: string; psi: number; refTemp: number; applies: boolean }[];
};

const FLUID_OF: Record<string, FluidId> = { 'MIL-PRF-5606': 'mil5606', 'MIL-PRF-83282': 'mil83282' };

export type HydModel = {
  tier: number;
  teach: boolean;
  /** fluids the servicing placard approves (5606 always, 83282 when listed) */
  approved: FluidId[];
  shelf: FluidId[];
  full: number;
  add: number;
  /** below this a stroke draws air instead of fluid */
  outlet: number;
  /** above this the reservoir vents overboard */
  overflow: number;
  /** +/- band around FULL that counts as "at FULL" */
  tol: number;
  /** the level the sight gauge shows as found (system pressurized) */
  level0: number;
  /** accumulator total volume */
  accVol: number;
  /** system pressure when the accumulator is charged */
  sysPsi: number;
  /** nitrogen charge as found, psi at ramp temperature (hydraulic side at zero) */
  p0: number;
  /** fluid held in the accumulator as found */
  vf0: number;
  /** accumulator fluid one brake application uses */
  strokeVol: number;
  /** glass heights per second at full tilt */
  maxPour: number;
  /** time constant of the funnel draining into the reservoir, s */
  funnelLag: number;
  precharge: Precharge | null;
  /** heat of compression shown on the gas gauge per psi added (tier 4+) */
  heat: number;
  /**
   * tier 4+: bubbles carried out by each slug of fluid pushed through the open
   * bleeder, in order; the fluid one bleed slug takes, and one hand-pump stroke
   */
  bleed: { air: number[]; slugVol: number; pumpVol: number } | null;
  /** the fluid line on the servicing placard, as that aircraft carries it */
  placardFluid: string;
  /** tier 4+: older aircraft carry the superseded MIL-H or the NATO designation */
  placardStyle: PlacardStyle;
  /** card-driven (a job on an island plane): the fluid and the precharge come from its AMM task card */
  card?: HydCard;
};

export type PlacardStyle = 'prf' | 'milh' | 'nato';

/**
 * How a placard names the approved fluids. MIL-H-5606 / MIL-H-83282 were
 * superseded by MIL-PRF-5606 / MIL-PRF-83282 (same fluids); NATO codes H-515 and
 * H-537 are the same two. The cans on the shelf always print MIL-PRF.
 */
export const PLACARD_NAMES: Record<PlacardStyle, [string, string]> = {
  prf: ['MIL-PRF-5606', 'MIL-PRF-83282'],
  milh: ['MIL-H-5606', 'MIL-H-83282'],
  nato: ['NATO H-515', 'H-537'],
};

export const absTemp = (t: number, unit: 'F' | 'C') => (unit === 'F' ? t + 459.67 : t + 273.15);

/** Gas law at constant volume: precharge scales with absolute temperature (Rankine or Kelvin). */
export function prechargeAt(ref: number, refTemp: number, temp: number, unit: 'F' | 'C'): number {
  return (ref * absTemp(temp, unit)) / absTemp(refTemp, unit);
}

/** Hydraulic pressure with `vf` of fluid in an accumulator charged to `p0` (Boyle; zero once it is empty). */
export function hydPressure(m: HydModel, p0: number, vf: number): number {
  return vf > 1e-6 ? (p0 * m.accVol) / (m.accVol - vf) : 0;
}

export function generateHydraulics(seed: number, tier: number, _tools: string[] = [], manual?: ManualCard): HydModel {
  const t = clamp(Math.round(tier), 0, 5);
  const r = rng(hashSeed('hydraulics', seed, t));
  const teach = t <= 2;
  // card-driven: the approved fluids are the task card's line for this airplane's SB status
  const card: HydCard | undefined =
    manual && (manual.fluid || manual.precharge)
      ? {
          task: manual.task,
          plate: `${manual.reg} · S/N ${manual.serial}`,
          marked: manual.marked,
          sbs: manual.sbs,
          fluid: (manual.fluid?.lines ?? []).map((l) => ({ ...l, fluids: l.fluids.map((f) => FLUID_OF[f]).filter(Boolean) })),
          precharge: (manual.precharge?.lines ?? []).map((l) => ({ ...l })),
        }
      : undefined;
  const cardFluids = card?.fluid.find((l) => l.applies)?.fluids;
  const allow83282 = cardFluids ? cardFluids.includes('mil83282') : t >= 2 && r.chance(0.5);
  const approved: FluidId[] = allow83282 ? ['mil5606', 'mil83282'] : ['mil5606'];
  let shelf: FluidId[];
  if (t <= 1) shelf = ['mil5606', 'skydrol', 'dot3'];
  else if (t === 2) shelf = ['mil5606', 'mil83282', 'skydrol', 'dot3'];
  else if (t === 3) shelf = ['mil5606', 'mil83282', 'skydrol', 'turbine'];
  else {
    const others = r.shuffle<FluidId>(['turbine', 'veg', 'dot3']);
    // sometimes only the placarded substitute is in stock: you have to know 83282 is the one
    shelf = allow83282 && r.chance(0.5) ? ['mil83282', 'skydrol', others[0], others[1]] : ['mil5606', 'mil83282', 'skydrol', others[0]];
  }
  if (t > 0) r.shuffle(shelf);

  const sysPsi = t <= 2 ? 1500 : r.pick([1500, 1650, 1800]);
  let precharge: Precharge | null = null;
  let p0 = 800;
  const cardPc = card?.precharge.find((l) => l.applies);
  if (t >= 3) {
    // the task card prints psi at 70°F
    const unit: 'F' | 'C' = t >= 5 && !cardPc ? 'C' : 'F';
    const ref = cardPc ? (r.pick([750, 800, 900, 1000]), cardPc.psi) : r.pick([750, 800, 900, 1000]);
    const refTemp = cardPc ? cardPc.refTemp : unit === 'F' ? 70 : 21;
    // a hot island ramp: the correction is always well over the tolerance, so
    // copying the placard number is out of limits
    const ramp = unit === 'F' ? r.int(95, 106) : r.int(32, 40);
    const target = prechargeAt(ref, refTemp, ramp, unit);
    const ptol = [20, 20, 20, 20, 15, 12][t];
    precharge = { ref, refTemp, unit, ramp, target, tol: ptol };
    if (card) precharge.others = card.precharge.filter((l) => !l.applies).map((l) => prechargeAt(l.psi, l.refTemp, ramp, unit));
    // leaked down or overcharged, well outside the band
    const off = r.range(70, 170) * (r.chance(0.5) ? 1 : -1);
    p0 = clamp(Math.round((target + off) / 5) * 5, 350, Math.round(sysPsi * 0.78));
  }
  const accVol = 0.26;
  const vf0 = accVol * (1 - p0 / sysPsi);
  const full = 0.72;
  const tol = [0.07, 0.06, 0.05, 0.045, 0.04, 0.035][t];
  const trueLevel = full - r.range(0.15, 0.26);

  let bleed: HydModel['bleed'] = null;
  if (t >= 4) {
    const air = t === 4 ? [4, 3, 2, 2, 1, 1] : [4, 3, 3, 2, 2, 1, 1];
    if (r.chance(0.5)) air.splice(r.int(1, 3), 0, 2);
    // tier 5: one last bubble after the first clear slug; run a few clear ones before closing
    if (t >= 5) air.push(0, 1);
    // a full bleed takes about as much fluid as the reservoir holds: keep it topped up
    bleed = { air, slugVol: 0.06, pumpVol: 0.06 };
  }

  // Older aircraft carry the superseded designation. Then the vegetable-base
  // MIL-H-7644 on the shelf is the near miss, and the cans' MIL-PRF numbers are
  // the right ones only if you know the history.
  // (the task card prints the MIL-PRF numbers)
  const placardStyle: PlacardStyle = card ? 'prf' : t >= 5 ? r.pick<PlacardStyle>(['prf', 'milh', 'nato']) : t === 4 ? r.pick<PlacardStyle>(['prf', 'milh']) : 'prf';
  if (placardStyle !== 'prf' && !shelf.includes('veg')) {
    const k = shelf.findIndex((f) => f === 'turbine' || f === 'dot3');
    shelf[k] = 'veg';
  }
  const names = PLACARD_NAMES[placardStyle];
  const placardFluid = allow83282 ? `${names[0]} OR ${names[1]}` : names[0];

  return {
    tier: t,
    teach,
    approved,
    shelf,
    full,
    add: 0.36,
    outlet: 0.06,
    overflow: 1.04,
    tol,
    level0: trueLevel - vf0,
    accVol,
    sysPsi,
    p0,
    vf0,
    strokeVol: accVol * 0.085,
    maxPour: 0.09,
    funnelLag: [0.1, 0.18, 0.25, 0.32, 0.36, 0.4][t],
    precharge,
    heat: t >= 5 ? 0.14 : t >= 4 ? 0.1 : 0,
    bleed,
    placardFluid,
    placardStyle,
    ...(card ? { card } : {}),
  };
}

/** card-driven: the precharge left at the other S/N block's value (in its limits, out of this airplane's) */
export function prechargeOther(m: HydModel, psi: number): boolean {
  const pc = m.precharge;
  if (!pc?.others?.length) return false;
  const lim = PRECHARGE_LIMIT * pc.tol;
  return Math.abs(psi - pc.target) > lim && pc.others.some((o) => Math.abs(psi - o) <= lim);
}

// ---------------------------------------------------------------------------
// The live system: what the pedal, the hand pump and the bleeder do. Pure, so
// the tests can pump it without a browser.
// ---------------------------------------------------------------------------

export type HydState = {
  /** reservoir level as the sight glass shows it */
  res: number;
  /** fluid stored in the accumulator */
  vf: number;
  /** settled nitrogen charge, psi at ramp temperature */
  p0: number;
  bleederOpen: boolean;
  /** bubbles each coming slug still carries out of the brake line */
  airQ: number[];
  bleedStrokes: number;
  ranDry: number;
  /** the hand pump is sucking at the standpipe */
  dry: boolean;
  /** fluid poured while the accumulator held fluid (a top-up during a bleed is forgiven by the next slug) */
  underPressure: number;
};

export function initState(m: HydModel): HydState {
  return {
    res: m.level0,
    vf: m.vf0,
    p0: m.p0,
    bleederOpen: false,
    airQ: m.bleed ? [...m.bleed.air] : [],
    bleedStrokes: 0,
    ranDry: 0,
    dry: false,
    underPressure: 0,
  };
}

/** Fluid the accumulator holds at system pressure (the relief valve setting). */
export function accCapacity(m: HydModel, p0: number): number {
  return Math.max(0, m.accVol * (1 - p0 / m.sysPsi));
}

export type Flow =
  /** nothing moved: no pressure behind the brake valve */
  | { kind: 'idle' }
  /** a brake application: accumulator fluid through the brake and back to the reservoir */
  | { kind: 'return'; dv: number; zero: boolean }
  /** fluid out through the open bleeder; a weak dribble flushes nothing */
  | { kind: 'flush'; dv: number; bubbles: number; air: boolean; weak: boolean; zero: boolean }
  /** hand pump into the accumulator */
  | { kind: 'charge'; dv: number; air: boolean }
  /** accumulator already at system pressure: the relief valve cracks */
  | { kind: 'relief' };

function flush(m: HydModel, s: HydState, dv: number, air: boolean, zero: boolean): Flow {
  const weak = !air && dv < m.bleed!.slugVol * 0.35;
  let bubbles = 0;
  if (!weak) {
    s.bleedStrokes++;
    bubbles = s.airQ.length ? s.airQ.shift()! : 0;
    // topping up to keep ahead of the bleed is part of the job, not a level check
    s.underPressure = 0;
  }
  return { kind: 'flush', dv, bubbles, air, weak, zero };
}

/** One press of the brake pedal (power brakes: it only meters accumulator pressure). */
export function pedalStroke(m: HydModel, s: HydState): Flow {
  if (s.vf <= 1e-6) return { kind: 'idle' };
  if (m.bleed && s.bleederOpen) {
    const dv = Math.min(s.vf, m.bleed.slugVol);
    s.vf -= dv;
    if (s.vf < 1e-6) s.vf = 0;
    return flush(m, s, dv, false, s.vf === 0);
  }
  const dv = Math.min(s.vf, m.strokeVol);
  s.vf -= dv;
  if (s.vf < 1e-6) s.vf = 0;
  s.res += dv;
  return { kind: 'return', dv, zero: s.vf === 0 };
}

/**
 * One stroke of the hand pump, drawing from the reservoir. With the pedal held
 * down and the bleeder open the path is open and it pushes straight out the
 * bleeder; otherwise it charges the accumulator up to the relief setting.
 */
export function pumpStroke(m: HydModel, s: HydState, pedalDown: boolean): Flow {
  if (!m.bleed) return { kind: 'idle' };
  if (s.dry && s.res > m.outlet + m.bleed.pumpVol) s.dry = false;
  const through = s.bleederOpen && pedalDown;
  const want = through ? m.bleed.pumpVol : Math.min(m.bleed.pumpVol, accCapacity(m, s.p0) - s.vf);
  if (want < 1e-4) return { kind: 'relief' };
  const take = Math.min(want, Math.max(0, s.res - m.outlet));
  s.res -= take;
  let air = false;
  if (take < want - 1e-6) {
    // sucked the reservoir down to the standpipe: air into the pump and on to the brake
    air = true;
    s.airQ.unshift(...(s.dry ? [2] : [3, 2, 2]));
    if (!s.dry) s.ranDry++;
    s.dry = true;
  }
  if (through) return flush(m, s, take, air, false);
  s.vf += take;
  return { kind: 'charge', dv: take, air };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export type HydRun = {
  /** volume poured, per fluid */
  poured: Partial<Record<FluidId, number>>;
  /** an incompatible fluid reached the reservoir */
  contaminated: FluidId | null;
  /** volume poured while the accumulator still held fluid (system pressurized) */
  underPressure: number;
  /** reservoir level with the system discharged: what it really holds */
  level: number;
  capOn: boolean;
  /** fluid still in the accumulator at sign-off (0 = discharged) */
  vf: number;
  /** settled nitrogen charge at ramp temperature */
  precharge: number;
  /** nitrogen valve worked while the hydraulic side was still pressurized */
  n2UnderPressure: boolean;
  /** opened shop air into the charging hose */
  shopAir: boolean;
  /** share of the gas charge that is shop air */
  airFrac: number;
  oxygen: boolean;
  bleedStrokes: number;
  /** bubbles still in the brake line */
  airLeft: number;
  ranDry: number;
  bleederOpen: boolean;
  /** tier 0: incompatible cans picked (blocked) */
  wrongPicks: number;
};

export function emptyRun(m: HydModel): HydRun {
  return {
    poured: {},
    contaminated: null,
    underPressure: 0,
    level: m.level0 + m.vf0,
    capOn: true,
    vf: m.vf0,
    precharge: m.p0,
    n2UnderPressure: false,
    shopAir: false,
    airFrac: 0,
    oxygen: false,
    bleedStrokes: 0,
    airLeft: m.bleed ? m.bleed.air.reduce((a, b) => a + b, 0) : 0,
    ranDry: 0,
    bleederOpen: false,
    wrongPicks: 0,
  };
}

/** 1 at FULL; underfill tapers, overfill (it spills when the system warms) drops harder. */
export function levelCredit(m: HydModel, level: number): number {
  const err = level - m.full;
  if (Math.abs(err) <= m.tol) return 1;
  if (err < 0) return 0.85 * clamp(1 - (-err - m.tol) / 0.14, 0, 1);
  return clamp(0.75 - (err - m.tol) / 0.1, 0, 1);
}

export function prechargeCredit(m: HydModel, psi: number): number {
  const pc = m.precharge;
  if (!pc) return 1;
  const err = Math.abs(psi - pc.target);
  if (err <= pc.tol) return 1;
  return clamp(0.6 * (1 - (err - pc.tol) / (3 * pc.tol)), 0, 1);
}

/** A precharge this far off is out of limits: not airworthy, so not a pass (a near miss still passes). */
export const PRECHARGE_LIMIT = 1.5;

/** Air still in the brake line that a mechanic would not sign off (the odd last bubble is a pass, not a perfect). */
export function unbled(m: HydModel, r: Pick<HydRun, 'bleedStrokes' | 'airLeft'>): boolean {
  return !!m.bleed && (r.bleedStrokes === 0 || r.airLeft > 1);
}

export function bleedCredit(m: HydModel, r: HydRun): number {
  if (!m.bleed) return 1;
  if (r.bleedStrokes === 0) return 0;
  const total = m.bleed.air.reduce((a, b) => a + b, 0);
  let c = r.airLeft <= 0 ? 1 : 0.6 * clamp(1 - r.airLeft / total, 0, 1);
  c -= 0.25 * r.ranDry;
  if (r.bleederOpen) c *= 0.3;
  return clamp(c, 0, 1);
}

export function weights(tier: number) {
  if (tier <= 2) return { level: 0.55, depress: 0.25, cap: 0.2, pre: 0, bleed: 0 };
  if (tier === 3) return { level: 0.38, depress: 0.16, cap: 0.14, pre: 0.32, bleed: 0 };
  return { level: 0.28, depress: 0.12, cap: 0.1, pre: 0.25, bleed: 0.25 };
}

export function scoreHydraulics(m: HydModel, r: HydRun): { score: number; summary: string; notes: string[] } {
  const w = weights(m.tier);
  const total = Object.values(r.poured).reduce((a, b) => a + (b ?? 0), 0);
  const serviced = total > 0.005;
  const lc = levelCredit(m, r.level);
  // the fluid was added with the system discharged (or, before any pour, it is discharged)
  const depress = serviced ? clamp(1 - r.underPressure / 0.06, 0, 1) : r.vf <= 1e-6 ? 1 : 0;
  const cap = r.capOn && serviced ? 1 : 0;
  const pc = prechargeCredit(m, r.precharge);
  const bc = bleedCredit(m, r);
  let s = w.level * lc + w.depress * depress + w.cap * cap + w.pre * pc + w.bleed * bc;

  const unapproved = (r.poured.mil83282 ?? 0) > 0.005 && !m.approved.includes('mil83282');
  if (unapproved) s -= 0.12;
  if (r.shopAir) s -= 0.2;
  if (r.n2UnderPressure && m.precharge) s -= 0.08;
  s -= Math.min(0.18, 0.06 * r.wrongPicks);
  // airworthiness items: a precharge out of limits (e.g. the placard number
  // copied without the temperature correction), or a spongy brake signed off
  // with air still in the line, is not a pass
  const pcOut = !!m.precharge && Math.abs(r.precharge - m.precharge.target) > PRECHARGE_LIMIT * m.precharge.tol;
  const notBled = unbled(m, r);
  // and a reservoir nowhere near FULL is not serviced, however well the rest went
  const levelOut = lc === 0;
  if (pcOut || notBled || levelOut) s = Math.min(s, 0.55);
  if (r.airFrac > 0.05) s = Math.min(s, 0.5);
  if (r.oxygen) s = Math.min(s, 0.2);
  if (r.contaminated) s = Math.min(s, 0.3);
  s = clamp(s, 0, 1);

  // the result card line: worst faults first, then what went right, three items at most
  const faults: [number, string][] = [];
  const goods: string[] = [];
  const fault = (sev: number, text: string) => faults.push([sev, text]);
  if (r.contaminated) fault(100, `${FLUIDS[r.contaminated].name} in a 5606 system: contaminated`);
  if (r.oxygen) fault(100, 'oxygen in the accumulator: fire hazard');
  const live = !r.contaminated && !r.oxygen;
  const err = r.level - m.full;
  if (live) {
    const main = (Object.entries(r.poured) as [FluidId, number][]).sort((x, y) => y[1] - x[1])[0]?.[0];
    if (Math.abs(err) <= m.tol) goods.push(main ? `${FLUIDS[main].name} at FULL` : 'level at FULL');
    else if (err > 0) fault(70, r.underPressure > 0.02 ? 'overfilled: topped up under pressure' : 'overfilled');
    else fault(60, serviced ? 'underfilled' : 'not serviced');
    if (m.precharge) {
      const p = Math.round(r.precharge);
      if (pc === 1) goods.push(`precharge ${p} psi`);
      else fault(pcOut ? 80 : 40, `precharge ${p} psi, wanted ${Math.round(m.precharge.target)}${pcOut ? ' (out of limits)' : ''}`);
    }
    if (m.bleed) {
      if (r.bleedStrokes === 0) fault(80, 'brake not bled');
      else if (r.airLeft > 0) fault(notBled ? 80 : 45, 'air left in the brake');
      else goods.push('brake bled firm');
      if (r.ranDry) fault(60, 'reservoir ran dry');
      if (r.bleederOpen) fault(55, 'bleeder left open');
    }
    if (serviced && !r.capOn) fault(50, 'filler cap left off');
  }
  if (r.airFrac > 0.05) fault(90, 'moist air in the accumulator');
  if (r.shopAir) fault(50, 'shop air is not nitrogen');
  if (unapproved) fault(40, '83282 not on this placard');
  if (r.n2UnderPressure && m.precharge) fault(30, 'precharge worked under pressure');
  if (r.wrongPicks) fault(20, `${r.wrongPicks} wrong can`);
  const notes = [...faults.sort((a, b) => b[0] - a[0]).map((f) => f[1]), ...goods];
  return { score: s, summary: notes.slice(0, 3).join(', '), notes };
}

// ---------------------------------------------------------------------------
// Puzzle
// ---------------------------------------------------------------------------

type Scene = 'res' | 'acc' | 'brake';
type Gas = 'n2' | 'air' | 'o2';
type R = { x: number; y: number; w: number; h: number };
type Grip = { kind: 'pedal' | 'pump' | 'syringe' | 'charge' | 'vent' } | { kind: 'can'; x0: number; y0: number; t0: number; base: number; moved: boolean };

const GASES: { id: Gas; name: string; sub: string; body: string; shoulder: string }[] = [
  { id: 'n2', name: 'NITROGEN', sub: 'N₂ · 2,200 psi', body: '#5d6a70', shoulder: '#1F2A30' },
  { id: 'air', name: 'SHOP AIR', sub: '150 psi', body: '#E0A458', shoulder: '#b98237' },
  { id: 'o2', name: 'OXYGEN', sub: 'O₂ · 1,850 psi', body: '#3f7d4e', shoulder: '#2f5f3b' },
];
const LABEL_TINTS = ['#e9dfc8', '#d7e0e3', '#e6d0a6', '#dde3d6'];
const SCENE_NAME: Record<Scene, string> = { res: 'Reservoir', acc: 'Accum.', brake: 'Brake' };

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const inR = (x: number, y: number, r: R, pad = 0) => x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad;
const TILT = (110 * Math.PI) / 180;

export const hydraulics: PuzzleDef = {
  id: 'hydraulics',
  role: 'mech',
  title: 'Hydraulic servicing',
  gesture: 'Press, tilt to pour, hold valves',
  howTo: 'Pump the pressure off, then pour the placard fluid to FULL.',
  term: 'Accumulator: nitrogen-charged tank that stores hydraulic pressure. Discharge it before checking fluid.',
  seconds: (tier) => 70 + clamp(tier, 0, 5) * 12,
  mount(host, p) {
    const m = generateHydraulics(p.seed, p.tier, p.tools, p.context?.card);
    const blind = !!p.blind;
    // the step banner ticks itself off (a verdict on the level): blind, it is a static work card
    const tracker = m.teach && !blind;
    const loupe = p.tools.includes('sightLight');
    const fineValve = p.tools.includes('chargingKit');
    const st = stage(host.el);
    const { ctx } = st;
    const scenes: Scene[] = ['res'];
    if (m.precharge) scenes.push('acc');
    if (m.bleed) scenes.push('brake');
    let scene: Scene = 'res';
    const aircraft = p.context?.assetName ?? 'Light twin';

    // --- physical state ---
    // reservoir level, accumulator fluid, gas charge, bleeder and brake-line air
    const sys = initState(m);
    let heat = 0; // transient on the gas gauge (heat of compression)
    let gasAir = 0; // part of p0 that came from shop air
    let capOn = true;
    let funnel = 0;
    let funnelFluid: FluidId | null = null;
    const poured: Partial<Record<FluidId, number>> = {};
    let spilled = 0;
    let held = -1; // shelf index of the can in hand
    let tilt = 0; // 0..1 of TILT
    let pedal = 0; // 0 up .. 1 floor
    let pedalPress = false;
    let pedalArmed = true;
    let pump = 0; // hand-pump lever, 0 up .. 1 down
    let pumpPress = false;
    let pumpArmed = true;
    let reliefT = -9;
    const slugs: { t: number; bubbles: number; air: boolean; weak: boolean }[] = [];
    let jar = 0.3;
    let hose: Gas | null = null;
    let hoseT = -9;
    let holdT = 0;
    let n2UnderPressure = false;
    let shopAir = false;
    let oxygen = false;
    let contaminated: FluidId | null = null;
    let wrongPicks = 0;
    let finished = false;
    let flourishT = -1;
    let clock = 0;
    let returnT = -9; // last time fluid came back from the accumulator (bubbles in the glass)
    let zeroT = -9;
    let fullDing = false;
    let glugT = 0; // next pour / hiss click
    const shakes = new Map<string, number>();
    let toast: { text: string; t: number; alert: boolean } | null = null;
    const grips = new Map<number, Grip>();
    let hydShown = hydPressure(m, sys.p0, sys.vf);
    let gasShown = hydShown || sys.p0;
    let lastStatus = '';

    const hydPsi = () => hydPressure(m, sys.p0, sys.vf);
    const gasPsi = () => Math.max(0, (sys.vf > 1e-6 ? hydPsi() : sys.p0) + heat);
    const holding = (k: Grip['kind']) => {
      for (const g of grips.values()) if (g.kind === k) return true;
      return false;
    };
    const shake = (key: string) => {
      if (!blind) shakes.set(key, clock);
    };
    /** a "that didn't work" buzz; blind, every refusal is a plain tap */
    const nope = () => (blind ? host.fx.tap : host.fx.bad)();
    const shakeX = (key: string) => {
      const t0 = shakes.get(key);
      if (t0 === undefined || clock - t0 > 0.35) return 0;
      return Math.sin((clock - t0) * 60) * 5 * (1 - (clock - t0) / 0.35);
    };
    const say = (text: string, alert = false) => (toast = { text, t: clock, alert });
    const approvedName = m.approved.length > 1 ? '5606 or 83282' : 'MIL-PRF-5606';
    const levelOk = () => Math.abs(sys.res + sys.vf - m.full) <= m.tol;

    // --- teaching steps (tiers 0-2) ---
    const steps = () => [
      { text: 'Pump the brakes to 0 psi', done: sys.vf <= 0 },
      { text: 'Take the filler cap off', done: !capOn || (levelOk() && sys.vf <= 0) },
      {
        text: sys.vf <= 0 && sys.res > m.full + m.tol ? 'Too full: syringe it down to FULL' : `Pour ${approvedName} up to FULL`,
        done: levelOk() && sys.vf <= 0,
      },
      { text: 'Refit the filler cap', done: levelOk() && sys.vf <= 0 && capOn },
      { text: 'Sign off', done: false },
    ];
    const curStep = () => steps().findIndex((s) => !s.done);

    const status = () => {
      let s: string;
      if (tracker) {
        const k = curStep();
        s = `Step ${k + 1}/5 · ${steps()[k].text}`;
      } else s = `Hyd ${fmt(hydPsi())} psi`;
      if (s !== lastStatus) {
        lastStatus = s;
        host.status(s);
      }
    };
    status();

    // --- geometry (everything scales with the stage) ---
    const geo = () => {
      const w = st.w;
      const h = st.h;
      const pad = 12;
      // card-driven: a line per fluid and precharge effectivity, plus the records line when the SB decides
      const cardRows = m.card ? m.card.fluid.length + (m.precharge ? m.card.precharge.length : 0) + (m.bleed ? 1 : 0) : 0;
      const extra = m.card ? cardRows : m.teach ? 1 : 1 + (m.precharge ? 1 : 0) + (m.bleed ? 1 : 0);
      const headH = Math.max(88, 46 + 17 * extra);
      const head: R = { x: pad, y: 8, w: w - pad * 2 - 100, h: headH };
      const gauge = { cx: w - pad - 46, cy: 8 + headH / 2, r: 40 };
      const bar: R = { x: pad, y: h - 58, w: w - pad * 2, h: 48 };
      const top = head.y + head.h + 10;
      const shelfH = clamp((bar.y - 10 - top) * 0.27, 112, 150);
      const shelf: R = { x: pad, y: bar.y - 10 - shelfH, w: w - pad * 2, h: shelfH };
      const work: R = { x: pad, y: top, w: w - pad * 2, h: shelf.y - 10 - top };
      return { w, h, pad, head, gauge, bar, shelf, work };
    };
    type G = ReturnType<typeof geo>;

    const resGeo = (g: G) => {
      const wk = g.work;
      const band = m.teach ? (wk.h < 300 ? 30 : 34) : 0; // step banner
      const cx = wk.x + wk.w * 0.47;
      // the tank and its sight glass get the height first (a ~120 px glass on a
      // 560 px stage); the can in hand rests beside the funnel, so it needs little
      const canRoom = clamp((wk.h - band) * 0.35 - 20, 68, 112);
      const tankTop = wk.y + band + canRoom;
      const tank: R = { x: cx - 48, y: tankTop, w: 96, h: Math.max(90, wk.y + wk.h - tankTop - 4) };
      const glass: R = { x: cx - 13, y: tank.y + 22, w: 26, h: tank.h - 40 };
      const fx = cx - 20;
      const neck: R = { x: fx - 14, y: tank.y - 14, w: 28, h: 14 };
      // the can in hand hangs from its spout just right of the funnel and tips about it
      const spout = { x: cx + 30, y: neck.y - 46 };
      const canBox: R = { x: spout.x - 9, y: spout.y - 5, w: 56, h: 82 };
      const capRest = { x: tank.x - 30, y: tank.y + 26 };
      const ph = clamp(wk.h * 0.34, 104, 136);
      const pedalR: R = { x: wk.x + wk.w - 74, y: Math.min(tank.y + tank.h * 0.35, wk.y + wk.h - ph), w: 70, h: ph };
      const syringe: R = { x: wk.x + 4, y: wk.y + band + 4, w: 76, h: 56 };
      const banner: R = { x: wk.x, y: wk.y, w: wk.w, h: band - 6 };
      const loupeC = { x: wk.x + 40, y: glass.y + glass.h * (1 - m.full), r: 32 };
      return { cx, tank, glass, fx, neck, spout, canBox, capRest, pedalR, syringe, banner, loupeC };
    };

    const shelfSlots = (g: G) => {
      const n = m.shelf.length;
      const gap = 8;
      const cw = Math.min(88, (g.shelf.w - 16 - gap * (n - 1)) / n);
      const total = cw * n + gap * (n - 1);
      const x0 = g.shelf.x + (g.shelf.w - total) / 2;
      const ch = g.shelf.h - 38;
      return m.shelf.map((_, i) => ({ x: x0 + i * (cw + gap), y: g.shelf.y + 30, w: cw, h: ch }) as R);
    };

    const accGeo = (g: G) => {
      const wk = g.work;
      const thermo: R = { x: wk.x, y: wk.y + 2, w: 118, h: clamp(wk.h * 0.34, 96, 128) };
      const r = Math.min(92, (wk.w - 130) / 2 - 6, wk.h * 0.25);
      const gc = { cx: wk.x + 130 + (wk.w - 130) / 2, cy: wk.y + r + 8, r };
      const accTop = gc.cy + r + 26;
      const acc: R = { x: gc.cx - 32, y: accTop, w: 64, h: Math.max(70, Math.min(150, wk.y + wk.h - accTop - 4)) };
      const valve = { x: acc.x - 12, y: acc.y + 22 };
      const room = wk.y + wk.h - (thermo.y + thermo.h);
      // charge wheel and vent knob stacked under the thermometer, or side by side
      // when the stage is short, their captions clear of the supply caption
      const stacked = room >= 60 + 3.6 * 30;
      const cr = stacked ? clamp((room - 60) / 3.6, 30, 42) : clamp((room - 40) / 2, 24, 32);
      const charge = { x: wk.x + (stacked ? 59 : 40), y: thermo.y + thermo.h + 14 + cr, r: cr };
      const vent = stacked ? { x: wk.x + 59, y: charge.y + cr + 22 + cr * 0.8, r: cr * 0.8 } : { x: wk.x + 140, y: charge.y + cr * 0.2, r: cr * 0.8 };
      const n = GASES.length;
      const bw = Math.min(104, (g.shelf.w - 24) / n);
      const bottles = GASES.map((_, i) => ({ x: g.shelf.x + (g.shelf.w - bw * n - 12 * (n - 1)) / 2 + i * (bw + 12), y: g.shelf.y + 26, w: bw, h: g.shelf.h - 30 }) as R);
      return { thermo, gc, acc, valve, charge, vent, bottles };
    };

    const brakeGeo = (g: G) => {
      const top = g.work.y;
      const bottom = g.bar.y - 10;
      const ph = clamp((bottom - top) * 0.3, 110, 150);
      const pedalR: R = { x: g.pad + 4, y: bottom - ph - 6, w: 70, h: ph };
      // the glass ends above the pedal's caption
      const glass: R = { x: g.pad + 16, y: top + 30, w: 22, h: Math.min(250, (bottom - top) * 0.5, pedalR.y - 36 - (top + 30)) };
      const wr = Math.min(100, g.w * 0.26, (bottom - top) * 0.21);
      const wheel = { cx: g.w * 0.56, cy: top + wr + 22, r: wr };
      const ca = -0.62;
      const cal = { x: wheel.cx + Math.cos(ca) * wr * 0.66, y: wheel.cy + Math.sin(ca) * wr * 0.66, a: ca + Math.PI / 2 };
      const bleeder = { x: cal.x + Math.cos(ca) * 22, y: cal.y + Math.sin(ca) * 22 };
      const wrench: R = { x: bleeder.x - 26, y: bleeder.y - 34, w: 92, h: 60 };
      const jh = clamp((bottom - top) * 0.22, 90, 128);
      const jar: R = { x: g.w - g.pad - 96, y: bottom - jh - 6, w: 88, h: jh };
      // the hand pump between the pedal and the jar
      const px0 = pedalR.x + pedalR.w + 14;
      const pw = Math.min(130, jar.x - 14 - px0);
      const pumpR: R = { x: px0 + (jar.x - 14 - px0 - pw) / 2, y: bottom - ph * 0.85 - 6, w: pw, h: ph * 0.85 };
      return { glass, wheel, cal, bleeder, wrench, jar, pedalR, pumpR };
    };

    const barButtons = (g: G) => {
      const sign: R = scenes.length === 1 ? { x: g.w / 2 - 100, y: g.bar.y, w: 200, h: g.bar.h } : { x: g.bar.x + g.bar.w - 104, y: g.bar.y, w: 104, h: g.bar.h };
      const tabs: { scene: Scene; r: R }[] = [];
      if (scenes.length > 1) {
        const tw = (g.bar.w - 104 - 8 - 6 * (scenes.length - 1)) / scenes.length;
        scenes.forEach((s, i) => tabs.push({ scene: s, r: { x: g.bar.x + i * (tw + 6), y: g.bar.y, w: tw, h: g.bar.h } }));
      }
      return { sign, tabs };
    };

    // --- actions ---
    function pick(i: number) {
      if (held === i) return;
      const f = m.shelf[i];
      if (m.tier === 0 && !FLUIDS[f].compatible) {
        // the tutorial stops you before the can is even open
        wrongPicks++;
        shake(`can${i}`);
        host.fx.bad();
        say(`${FLUIDS[f].name}: ${FLUIDS[f].plain}. Wrong system.`, true);
        return;
      }
      held = i;
      tilt = 0;
      host.fx.tap();
      if (m.teach && !blind) {
        if (!FLUIDS[f].compatible) say(`${FLUIDS[f].name}: ${FLUIDS[f].plain}. Not this system!`, true);
        else if (!m.approved.includes(f)) say('83282: only if the placard lists it', true);
      }
    }

    /** what the player sees and hears for one pedal or hand-pump stroke */
    function show(f: Flow) {
      switch (f.kind) {
        case 'idle':
          host.fx.tick();
          break;
        case 'relief':
          reliefT = clock;
          host.fx.tick();
          break;
        case 'return':
          returnT = clock;
          if (f.zero) {
            zeroT = clock;
            host.fx.thunk();
          } else host.fx.tick();
          break;
        case 'charge':
          if (f.air && !blind) host.fx.fault();
          else host.fx.tick();
          break;
        case 'flush':
          slugs.push({ t: clock, bubbles: f.bubbles, air: f.air, weak: f.weak });
          jar = Math.min(0.9, jar + f.dv * 0.6);
          // blind: the bubbles in the hose say it, not the sound
          if (blind) host.fx.tick();
          else if (f.air) host.fx.fault();
          else if (f.weak) host.fx.tick();
          else host.fx.snap();
          if (f.zero) zeroT = clock;
          break;
      }
      status();
    }
    const stroke = () => show(pedalStroke(m, sys));
    // the path through the brake is open only while the pedal is held to the floor
    const pumpOnce = () => show(pumpStroke(m, sys, holding('pedal') && pedal > 0.8));

    function addGas(dpGauge: number, kind: 'n2' | 'air') {
      const dp0 = sys.vf > 1e-6 ? (dpGauge * (m.accVol - sys.vf)) / m.accVol : dpGauge;
      sys.p0 += dp0;
      if (kind === 'air') gasAir += dp0;
      heat += dpGauge * m.heat;
    }
    function ventGas(dpGauge: number) {
      const dp0 = Math.min(sys.p0, sys.vf > 1e-6 ? (dpGauge * (m.accVol - sys.vf)) / m.accVol : dpGauge);
      if (sys.p0 > 0) gasAir -= gasAir * (dp0 / sys.p0);
      sys.p0 -= dp0;
      heat -= dpGauge * m.heat * 0.8;
    }

    function contaminate(f: FluidId) {
      if (finished || contaminated) return;
      contaminated = f;
      // blind: it pours like any other can. The colour in the glass is all there is to see
      if (blind) return;
      host.fx.fault();
      say(`${FLUIDS[f].name} in a 5606 system`, true);
      finishWith(1800);
    }

    const run = (): HydRun => ({
      poured: { ...poured },
      contaminated,
      underPressure: sys.underPressure,
      level: sys.res + sys.vf + funnel,
      capOn,
      vf: sys.vf,
      precharge: sys.p0,
      n2UnderPressure,
      shopAir,
      airFrac: sys.p0 > 1 ? gasAir / sys.p0 : 0,
      oxygen,
      bleedStrokes: sys.bleedStrokes,
      airLeft: sys.airQ.reduce((a, b) => a + b, 0),
      ranDry: sys.ranDry,
      bleederOpen: sys.bleederOpen,
      wrongPicks,
    });
    const makeResult = (): PuzzleResult => {
      const s = scoreHydraulics(m, run());
      return result(s.score, s.summary, {
        level: +(sys.res + sys.vf + funnel).toFixed(3),
        full: m.full,
        psi: Math.round(sys.p0),
        target: m.precharge ? Math.round(m.precharge.target) : undefined,
        spilled: +spilled.toFixed(3),
        // what went wrong, for the hidden defect it leaves (DEFECT_RULES 'hydraulics:fluid' / 'hydraulics:eff')
        ...(contaminated ? { defect: 'fluid' } : prechargeOther(m, sys.p0) ? { defect: 'eff' } : {}),
      });
    };
    function finishWith(ms?: number) {
      if (finished) return;
      finished = true;
      grips.clear();
      const r = makeResult();
      // blind: one neutral close-out, the same time whatever the result
      if (blind) host.fx.tap();
      else if (r.perfect) {
        flourishT = clock;
        host.fx.flourish();
      } else if (r.score >= 0.6) host.fx.good();
      settle(host, r, blind ? 600 : (ms ?? (r.perfect ? 900 : 450)));
    }

    // --- input ---
    function hit(x: number, y: number): Grip | null {
      const g = geo();
      const bb = barButtons(g);
      if (inR(x, y, bb.sign, 4)) {
        host.fx.tap();
        finishWith();
        return null;
      }
      for (const t of bb.tabs) {
        if (inR(x, y, t.r, 3)) {
          if (scene !== t.scene) {
            scene = t.scene;
            grips.clear(); // nothing keeps pouring or hissing on a screen you can't see
            host.fx.tap();
            status();
          }
          return null;
        }
      }
      if (scene === 'res') {
        const rg = resGeo(g);
        if (inR(x, y, rg.pedalR, 10)) return pressPedal();
        // the can in hand (drag to tilt, tap to put back)
        if (held >= 0 && inR(x, y, rg.canBox, 8)) return { kind: 'can', x0: x, y0: y, t0: performance.now(), base: tilt, moved: false };
        // filler cap: on the neck, or resting on the tank
        const onNeck = Math.abs(x - (rg.neck.x + rg.neck.w / 2)) < 26 && y > rg.neck.y - 34 && y < rg.neck.y + 26;
        const onRest = !capOn && Math.hypot(x - rg.capRest.x, y - rg.capRest.y) < 28;
        if (onNeck || onRest) {
          if (!capOn && funnel > 0.002) {
            // the funnel is still draining: the cap goes on after it has run through
            shake('cap');
            nope();
            if (m.teach && !blind) say('Let the funnel drain first');
            return null;
          }
          if (!capOn && funnel > 0) {
            // the last drops
            sys.res += funnel;
            if (funnelFluid) poured[funnelFluid] = (poured[funnelFluid] ?? 0) + funnel;
            if (sys.vf > 1e-6) sys.underPressure += funnel;
            funnel = 0;
          }
          capOn = !capOn;
          host.fx.snap();
          status();
          return null;
        }
        if (inR(x, y, rg.syringe, 6)) {
          if (capOn) {
            shake('cap');
            nope();
            return null;
          }
          host.fx.tap();
          return { kind: 'syringe' };
        }
        const slots = shelfSlots(g);
        for (let i = 0; i < slots.length; i++) {
          if (inR(x, y, slots[i], 4)) {
            pick(i);
            return null;
          }
        }
      } else if (scene === 'acc') {
        const ag = accGeo(g);
        if (Math.hypot(x - ag.charge.x, y - ag.charge.y) < ag.charge.r + 10) {
          holdT = 0;
          if (!hose) {
            shake('charge');
            nope();
            say('No charging hose connected');
            return null;
          }
          if (hose === 'o2' && blind) {
            // blind: the valve opens like any other; oxygen goes into the bottle, nothing says so
            oxygen = true;
          } else if (hose === 'o2') {
            oxygen = true;
            host.fx.fault();
            say('Oxygen + hydraulic oil: explosion hazard', true);
            finishWith(1800);
            return null;
          }
          if (sys.vf > 1e-6) n2UnderPressure = true;
          if (hose === 'air') shopAir = true;
          host.fx.tap();
          return { kind: 'charge' };
        }
        if (Math.hypot(x - ag.vent.x, y - ag.vent.y) < ag.vent.r + 10) {
          holdT = 0;
          if (sys.vf > 1e-6) n2UnderPressure = true;
          host.fx.tap();
          return { kind: 'vent' };
        }
        for (let i = 0; i < ag.bottles.length; i++) {
          if (inR(x, y, ag.bottles[i], 4)) {
            const id = GASES[i].id;
            hose = hose === id ? null : id;
            hoseT = clock;
            host.fx.snap();
            return null;
          }
        }
      } else if (scene === 'brake') {
        const bg = brakeGeo(g);
        if (inR(x, y, bg.pedalR, 8)) return pressPedal();
        if (inR(x, y, bg.pumpR, 6)) {
          if (pump < 0.5) pumpArmed = true;
          pumpPress = true;
          return { kind: 'pump' };
        }
        if (inR(x, y, bg.wrench, 6) || Math.hypot(x - bg.bleeder.x, y - bg.bleeder.y) < 34) {
          sys.bleederOpen = !sys.bleederOpen;
          host.fx.snap();
          return null;
        }
      }
      return null;
    }
    function pressPedal(): Grip {
      if (pedal < 0.5) pedalArmed = true;
      pedalPress = true;
      return { kind: 'pedal' };
    }

    const offPtr = pointer(st.canvas, {
      down(pt) {
        if (finished || host.paused()) return;
        const gr = hit(pt.x, pt.y);
        if (gr) grips.set(pt.id, gr);
      },
      move(pt) {
        const gr = grips.get(pt.id);
        if (!gr || finished || host.paused()) return;
        if (gr.kind === 'can') {
          const dx = gr.x0 - pt.x;
          const dy = pt.y - gr.y0;
          if (Math.hypot(dx, dy) > 6) gr.moved = true;
          let t = clamp(gr.base + dx / 120 + dy / 260, 0, 1);
          if (capOn && t > 0.36) {
            // the cap is on: the can won't pour
            if (tilt <= 0.36) {
              shake('cap');
              nope();
              if (m.teach && !blind) say('Take the filler cap off first');
            }
            t = 0.36;
          }
          tilt = t;
        }
      },
      up(pt) {
        const gr = grips.get(pt.id);
        grips.delete(pt.id);
        if (!gr || finished) return;
        if (gr.kind === 'can' && !gr.moved && performance.now() - gr.t0 < 350) {
          held = -1; // back on the shelf
          tilt = 0;
          host.fx.tap();
        }
      },
    });

    // --- simulation ---
    function step(dt: number) {
      // pedal
      const pedalHeld = holding('pedal');
      if (pedalPress || pedalHeld) {
        pedal = Math.min(1, pedal + dt * 7);
        if (pedal >= 1) {
          if (pedalArmed) {
            pedalArmed = false;
            stroke();
          }
          if (!pedalHeld) pedalPress = false;
        }
      } else pedal = Math.max(0, pedal - dt * 5);
      if (pedal < 0.35) pedalArmed = true;

      // hand pump: one stroke per press, at the bottom of the lever's travel
      const pumpHeld = holding('pump');
      if (pumpPress || pumpHeld) {
        pump = Math.min(1, pump + dt * 7);
        if (pump >= 1) {
          if (pumpArmed) {
            pumpArmed = false;
            pumpOnce();
          }
          if (!pumpHeld) pumpPress = false;
        }
      } else pump = Math.max(0, pump - dt * 5);
      if (pump < 0.35) pumpArmed = true;

      // the can rights itself when let go
      const canGrip = [...grips.values()].some((g) => g.kind === 'can');
      if (!canGrip && tilt > 0) tilt = Math.max(0, tilt - dt * 3.5);
      if (held >= 0 && !capOn) {
        const k = clamp((tilt - 0.4) / 0.5, 0, 1);
        if (k > 0) {
          funnel += m.maxPour * Math.pow(k, 1.4) * dt;
          funnelFluid = m.shelf[held];
          if (clock > glugT) {
            host.fx.tick();
            glugT = clock + 0.28 - 0.12 * k;
          }
        }
      }
      if (funnel > 0 && funnelFluid) {
        let d = funnel * (1 - Math.exp(-dt / m.funnelLag));
        if (funnel - d < 1e-4) d = funnel;
        funnel -= d;
        sys.res += d;
        poured[funnelFluid] = (poured[funnelFluid] ?? 0) + d;
        if (sys.vf > 1e-6) sys.underPressure += d;
        if (!FLUIDS[funnelFluid].compatible && (poured[funnelFluid] ?? 0) > 0.002) contaminate(funnelFluid);
      }
      if (holding('syringe') && !capOn) sys.res = Math.max(0, sys.res - 0.06 * dt);
      if (sys.res > m.overflow) {
        spilled += sys.res - m.overflow;
        sys.res = m.overflow;
      }
      if (sys.dry && sys.res > m.outlet + (m.bleed?.pumpVol ?? 0)) sys.dry = false;
      // teaching ding when the level reaches FULL (discharged)
      if (tracker) {
        const ok = sys.vf <= 0 && levelOk();
        if (ok && !fullDing) {
          host.fx.snap();
          say('At FULL');
        }
        fullDing = ok;
      }

      // nitrogen
      if (holding('charge') || holding('vent')) holdT += dt;
      if (holding('charge') && hose) {
        // (oxygen only ever gets this far blind: a dry, high-pressure bottle fills like nitrogen)
        if (hose === 'n2' || hose === 'o2') addGas((fineValve ? Math.min(55, 8 + 40 * holdT) : Math.min(90, 18 + 70 * holdT)) * dt, 'n2');
        else if (hose === 'air') {
          const gp = gasPsi() - heat;
          if (gp < 150) addGas(Math.min(40, 150 - gp) * dt, 'air');
        }
      }
      if (holding('vent')) ventGas(Math.min(80, 15 + 55 * holdT) * dt);
      if ((holding('charge') && hose) || holding('vent') || holding('syringe')) {
        if (clock > glugT) {
          host.fx.tick();
          glugT = clock + 0.16;
        }
      }
      heat *= Math.exp(-dt / 2.2);
      if (Math.abs(heat) < 0.05) heat = 0;
      for (let i = slugs.length - 1; i >= 0; i--) if (clock - slugs[i].t > 2) slugs.splice(i, 1);
      status();
    }

    const stop = loop((_t, dt) => {
      const live = !finished && !host.paused();
      if (live) {
        clock += dt;
        step(dt);
      } else if (finished) clock += dt;
      // keep full frame rate while anything is moving
      if (grips.size || funnel > 0 || pedal > 0 || pump > 0 || tilt > 0 || Math.abs(heat) > 0.3 || slugs.length) markInput();
      const hp = hydPsi();
      const gp = gasPsi();
      hydShown += (hp - hydShown) * (1 - Math.exp(-dt / 0.12));
      gasShown += (gp - gasShown) * (1 - Math.exp(-dt / 0.12));
      if (p.reducedMotion) {
        hydShown = hp;
        gasShown = gp;
      }
      draw();
    });

    // --- drawing ---
    function draw() {
      const g = geo();
      backdrop(ctx, g.w, g.h);
      drawPlacard(g);
      drawHydGauge(g);
      if (scene === 'res') drawResScene(g);
      else if (scene === 'acc') drawAccScene(g);
      else drawBrakeScene(g);
      drawBar(g);
      if (toast && clock - toast.t < 2.2 && (blind || (!contaminated && !oxygen))) {
        const a = clamp((2.2 - (clock - toast.t)) / 0.4, 0, 1);
        ctx.globalAlpha = a;
        ctx.font = `800 13px ${FONT}`;
        const tw = Math.min(g.w - 40, ctx.measureText(toast.text).width + 28);
        const ty = g.work.y + (m.teach && scene === 'res' ? 34 : 4);
        roundRect(ctx, g.w / 2 - tw / 2, ty, tw, 30, 15);
        ctx.fillStyle = toast.alert ? C.rust : C.ink;
        ctx.fill();
        fitLabel(ctx, toast.text, g.w / 2, ty + 15, tw - 20, { size: 13, weight: 800, color: C.white });
        ctx.globalAlpha = 1;
      }
      if (flourishT >= 0) {
        const t = clamp((clock - flourishT) / 0.8, 0, 1);
        if (t < 1) {
          ctx.globalAlpha = 0.35 * (1 - ease.outCubic(t));
          ctx.fillStyle = C.white;
          ctx.fillRect(0, 0, g.w, g.h);
          ctx.globalAlpha = 1;
        }
      }
      if ((contaminated || oxygen) && !blind) {
        ctx.fillStyle = 'rgba(31,42,48,.55)';
        ctx.fillRect(0, 0, g.w, g.h);
        roundRect(ctx, 24, g.h * 0.36, g.w - 48, 104, 16);
        ctx.fillStyle = C.rust;
        ctx.fill();
        label(ctx, contaminated ? 'CONTAMINATED' : 'STOP: OXYGEN', g.w / 2, g.h * 0.36 + 32, { size: 20, weight: 900, color: C.white });
        const why = contaminated ? FLUIDS[contaminated].harm : 'Oxygen with hydraulic oil can explode';
        fitLabel(ctx, why, g.w / 2, g.h * 0.36 + 62, g.w - 80, { size: 13, weight: 700, color: C.white });
        fitLabel(ctx, contaminated ? 'Drain, flush, replace the seals.' : 'Charge accumulators with dry nitrogen only.', g.w / 2, g.h * 0.36 + 82, g.w - 80, {
          size: 12,
          weight: 600,
          color: C.white,
        });
      }
    }

    function drawPlacard(g: G) {
      const r = g.head;
      const grd = ctx.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h);
      grd.addColorStop(0, '#e9ecee');
      grd.addColorStop(1, '#c9cfd2');
      roundRect(ctx, r.x, r.y, r.w, r.h, 8);
      ctx.fillStyle = grd;
      ctx.fill();
      ctx.strokeStyle = 'rgba(31,42,48,.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
      for (const [x, y] of [
        [r.x + 6, r.y + 6],
        [r.x + r.w - 6, r.y + 6],
        [r.x + 6, r.y + r.h - 6],
        [r.x + r.w - 6, r.y + r.h - 6],
      ]) {
        ctx.fillStyle = '#9aa4a8';
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      const x = r.x + 12;
      const mw = r.w - 22;
      if (m.card) return drawCardLines(r, x, mw);
      fitLabel(ctx, `${aircraft.toUpperCase()} · HYDRAULIC SERVICE`, x, r.y + 15, mw, { size: 9.5, weight: 800, color: C.inkSoft, align: 'left' });
      fitLabel(ctx, `FLUID  ${m.placardFluid}`, x, r.y + 33, mw, { size: 13, weight: 900, color: C.ink, align: 'left' });
      let y = r.y + 52;
      if (m.teach) {
        const txt = m.approved.length > 1 ? 'Either red fluid is fine · never Skydrol (purple)' : 'Red mineral-base fluid · never Skydrol (purple)';
        roundRect(ctx, x - 4, y - 9, mw + 6, 20, 10);
        ctx.fillStyle = C.sea;
        ctx.fill();
        fitLabel(ctx, txt, x + 4, y + 1, mw - 8, { size: 10.5, weight: 800, color: C.white, align: 'left' });
        y += 19;
        fitLabel(ctx, 'SERVICE DEPRESSURIZED · FILL TO FULL', x, y + 2, mw, { size: 10, weight: 800, color: C.ink, align: 'left' });
      } else {
        // the condition the FULL mark is read at, as real placards state it (not a hint:
        // you still have to know how to discharge it and why the glass reads low)
        fitLabel(ctx, 'FILL TO FULL · HYD PRESS 0, ACCUM DISCHARGED', x, y, mw, { size: 10.5, weight: 800, color: C.ink, align: 'left' });
        y += 17;
        if (m.precharge) {
          const pc = m.precharge;
          fitLabel(ctx, `ACCUMULATOR N₂ ${fmt(pc.ref)} PSI @ ${pc.refTemp}°${pc.unit}`, x, y, mw, { size: 10.5, weight: 800, color: C.ink, align: 'left' });
          y += 17;
        }
        if (m.bleed) fitLabel(ctx, 'SQUAWK: LH BRAKE SOFT, SPONGY', x, y, mw, { size: 10.5, weight: 900, color: C.rust, align: 'left' });
      }
    }

    /**
     * Card-driven: the AMM task card's servicing values, both effectivities as
     * printed. Tiers 0-2 mark this airplane's line; from tier 3 the S/N on the
     * plate and the SB list decide, and that's the mechanic's to read.
     */
    function drawCardLines(r: R, x: number, mw: number) {
      const cd = m.card!;
      fitLabel(ctx, `${cd.task} · ${cd.plate}`, x, r.y + 14, mw, { size: 10, weight: 900, color: C.ink, align: 'left' });
      fitLabel(ctx, cd.sbs.length ? `SBs on record: ${cd.sbs.join(', ')}` : 'SBs on record: none', x, r.y + 28, mw, { size: 9, weight: 700, color: C.inkSoft, align: 'left' });
      let y = r.y + 45;
      const row = (applies: boolean, text: string) => {
        const mark = cd.marked && applies;
        ctx.globalAlpha = cd.marked && !applies ? 0.45 : 1;
        fitLabel(ctx, `${mark ? '▶ ' : ''}${text}`, x, y, mw, { size: 10.5, weight: mark ? 900 : 800, color: mark ? C.seaDeep : C.ink, align: 'left' });
        ctx.globalAlpha = 1;
        y += 17;
      };
      // the placard's shorthand for the manual's lines: "S/N 310R0001–310R0759", "5606 or 83282"
      const short = (x = '') => x.replace(/ THRU /, '–').replace(/ AND ON$/, ' and on');
      for (const l of cd.fluid) row(l.applies, `FLUID ${l.eff ?? ''} · ${short(l.effText)}: ${l.fluids.map((f) => FLUIDS[f].name.replace(/^MIL-PRF-/, '')).join(' or ')}${l.fluids.length === 1 ? ' only' : ''}`);
      if (m.precharge) for (const l of cd.precharge) row(l.applies, `N₂ ${l.eff ?? ''} · ${short(l.effText)}: ${fmt(l.psi)} PSI @ ${l.refTemp}°F`);
      if (m.bleed) fitLabel(ctx, 'SQUAWK: LH BRAKE SOFT, SPONGY', x, y, mw, { size: 10.5, weight: 900, color: C.rust, align: 'left' });
    }

    function dial(cx: number, cy: number, r: number, v: number, max: number, o: { major: number; minor: number; face?: string; lbl?: (n: number) => string }) {
      const a0 = Math.PI * 0.75;
      const a1 = Math.PI * 2.25;
      const toA = (n: number) => a0 + (clamp(n, 0, max) / max) * (a1 - a0);
      ctx.fillStyle = shade(C.ink, 0.2);
      ctx.beginPath();
      ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = o.face ?? C.paper;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = C.ink;
      for (let n = 0; n <= max + 0.1; n += o.minor) {
        const a = toA(n);
        const maj = Math.abs(n / o.major - Math.round(n / o.major)) < 1e-6;
        ctx.lineWidth = maj ? 2 : 1;
        const r0 = r * (maj ? 0.78 : 0.86);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        ctx.lineTo(cx + Math.cos(a) * r * 0.95, cy + Math.sin(a) * r * 0.95);
        ctx.stroke();
        if (maj && o.lbl && o.lbl(n)) {
          const rl = r * 0.6;
          label(ctx, o.lbl(n), cx + Math.cos(a) * rl, cy + Math.sin(a) * rl, { size: Math.max(8, r * 0.14), weight: 800, color: C.inkSoft });
        }
      }
      const na = toA(v);
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = Math.max(2, r * 0.05);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - Math.cos(na) * r * 0.12, cy - Math.sin(na) * r * 0.12);
      ctx.lineTo(cx + Math.cos(na) * r * 0.88, cy + Math.sin(na) * r * 0.88);
      ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.fillStyle = C.ink;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(4, r * 0.08), 0, Math.PI * 2);
      ctx.fill();
    }

    function drawHydGauge(g: G) {
      const { cx, cy, r } = g.gauge;
      dial(cx, cy, r, hydShown, 2000, { major: 500, minor: 100 });
      label(ctx, 'HYD PSI', cx, cy - r * 0.4, { size: 8.5, weight: 900, color: C.inkSoft });
      label(ctx, fmt(hydShown), cx, cy + r * 0.62, { size: 12, weight: 900, color: C.ink });
      if (clock - zeroT < 0.5 && !blind) {
        ctx.strokeStyle = C.palm;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, r + 6 + (clock - zeroT) * 16, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    function glassY(r: R, level: number) {
      return r.y + r.h * (1 - level);
    }

    /** a sight glass with fluid; marks drawn by the caller */
    function drawGlass(r: R, level: number, color: string, bubbles: boolean, top?: { amount: number; color: string }) {
      ctx.save();
      roundRect(ctx, r.x, r.y, r.w, r.h, r.w / 2);
      ctx.fillStyle = '#eef4f5';
      ctx.fill();
      ctx.clip();
      const y = glassY(r, clamp(level, -0.1, 1.2));
      const fg = ctx.createLinearGradient(r.x, 0, r.x + r.w, 0);
      fg.addColorStop(0, shade(color, -0.25));
      fg.addColorStop(0.45, shade(color, 0.12));
      fg.addColorStop(1, shade(color, -0.3));
      ctx.fillStyle = fg;
      const wob = funnel > 0.002 ? Math.sin(clock * 18) * 1.5 : 0;
      ctx.beginPath();
      ctx.moveTo(r.x, y + 3 + wob);
      ctx.quadraticCurveTo(r.x + r.w / 2, y - 2 - wob, r.x + r.w, y + 3 + wob);
      ctx.lineTo(r.x + r.w, r.y + r.h);
      ctx.lineTo(r.x, r.y + r.h);
      ctx.closePath();
      ctx.fill();
      if (top && top.amount > 0) {
        // a foreign fluid floating on top, swirling into the red
        const y2 = glassY(r, level - top.amount);
        ctx.fillStyle = top.color;
        ctx.beginPath();
        ctx.moveTo(r.x, y + 3 + wob);
        ctx.quadraticCurveTo(r.x + r.w / 2, y - 2 - wob, r.x + r.w, y + 3 + wob);
        ctx.lineTo(r.x + r.w, y2 + 4);
        ctx.quadraticCurveTo(r.x + r.w * 0.7, y2 + 10 + Math.sin(clock * 3) * 4, r.x + r.w * 0.4, y2 + 2);
        ctx.quadraticCurveTo(r.x + r.w * 0.2, y2 - 3, r.x, y2 + 6);
        ctx.closePath();
        ctx.fill();
      }
      if (bubbles && clock - returnT < 1.2) {
        const k = clock - returnT;
        ctx.fillStyle = 'rgba(255,255,255,.75)';
        for (let i = 0; i < 6; i++) {
          const by = r.y + r.h - ((k * 140 + i * 23) % Math.max(10, r.y + r.h - y));
          ctx.beginPath();
          ctx.arc(r.x + r.w * (0.3 + 0.4 * ((i * 37) % 10) / 10), by, 1.6 + (i % 3), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.fillStyle = 'rgba(255,255,255,.45)';
      ctx.fillRect(r.x + r.w * 0.22, r.y, r.w * 0.14, r.h);
      ctx.restore();
      roundRect(ctx, r.x, r.y, r.w, r.h, r.w / 2);
      ctx.strokeStyle = 'rgba(31,42,48,.6)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    function marks(r: R, side: 'right' | 'left', size = 10) {
      if (m.bleed) {
        // the pump's standpipe: below this line a stroke draws air
        const y = glassY(r, m.outlet);
        ctx.strokeStyle = 'rgba(31,42,48,.35)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(r.x + 2, y);
        ctx.lineTo(r.x + r.w - 2, y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      for (const [lv, name] of [
        [m.full, 'FULL'],
        [m.add, 'ADD'],
      ] as const) {
        const y = glassY(r, lv);
        ctx.strokeStyle = C.ink;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(r.x - 4, y);
        ctx.lineTo(r.x + r.w + 4, y);
        ctx.stroke();
        if (side === 'right') label(ctx, name, r.x + r.w + 7, y, { size, weight: 900, color: C.ink, align: 'left' });
        else label(ctx, name, r.x - 7, y, { size, weight: 900, color: C.ink, align: 'right' });
      }
    }

    const fluidColor = () => FLUIDS.mil5606.color;

    function drawResScene(g: G) {
      const rg = resGeo(g);
      const { tank, glass } = rg;
      const wk = g.work;
      if (m.teach) drawBanner(rg.banner);

      // plumbing to the pump and brakes
      ctx.strokeStyle = '#7f8b90';
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(tank.x + 26, tank.y + tank.h - 2);
      ctx.lineTo(tank.x + 26, wk.y + wk.h + 4);
      ctx.stroke();
      // return line from the brake valve
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(tank.x + tank.w - 4, rg.pedalR.y + 4);
      ctx.lineTo(rg.pedalR.x, rg.pedalR.y + 4);
      ctx.stroke();
      ctx.lineCap = 'butt';

      // tank
      const tg = ctx.createLinearGradient(tank.x, 0, tank.x + tank.w, 0);
      tg.addColorStop(0, '#8e999e');
      tg.addColorStop(0.35, '#e3e7e9');
      tg.addColorStop(1, '#87939a');
      roundRect(ctx, tank.x, tank.y, tank.w, tank.h, 16);
      ctx.fillStyle = tg;
      ctx.fill();
      ctx.strokeStyle = 'rgba(31,42,48,.45)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // strap bands
      ctx.fillStyle = 'rgba(31,42,48,.14)';
      ctx.fillRect(tank.x, tank.y + 10, tank.w, 5);
      ctx.fillRect(tank.x, tank.y + tank.h - 15, tank.w, 5);
      // glass window
      roundRect(ctx, glass.x - 6, glass.y - 7, glass.w + 12, glass.h + 14, 10);
      ctx.fillStyle = '#34444c';
      ctx.fill();
      drawGlass(glass, sys.res, fluidColor(), true, contaminated ? { amount: poured[contaminated] ?? 0, color: FLUIDS[contaminated].color } : undefined);
      marks(glass, 'right');
      if (m.teach && !blind && sys.vf > 0) {
        label(ctx, 'reads low', tank.x - 6, glassY(glass, sys.res), { size: 10.5, weight: 800, color: C.sea, align: 'right' });
        label(ctx, 'under pressure', tank.x - 6, glassY(glass, sys.res) + 13, { size: 10.5, weight: 800, color: C.sea, align: 'right' });
      }
      if (m.tier <= 1 && !blind && sys.vf <= 0 && levelOk()) label(ctx, '✓', glass.x - 14, glassY(glass, m.full), { size: 16, weight: 900, color: C.palm });

      // neck, funnel, cap
      const nk = rg.neck;
      ctx.fillStyle = '#9aa4a8';
      ctx.fillRect(nk.x, nk.y, nk.w, nk.h + 2);
      ctx.strokeStyle = 'rgba(31,42,48,.4)';
      ctx.strokeRect(nk.x, nk.y, nk.w, nk.h + 2);
      if (!capOn) {
        // funnel
        const fy = nk.y - 30;
        ctx.beginPath();
        ctx.moveTo(rg.fx - 26, fy);
        ctx.lineTo(rg.fx + 26, fy);
        ctx.lineTo(rg.fx + 7, nk.y + 2);
        ctx.lineTo(rg.fx - 7, nk.y + 2);
        ctx.closePath();
        ctx.fillStyle = 'rgba(224,164,88,.55)';
        ctx.fill();
        ctx.strokeStyle = shade(C.mech, -0.35);
        ctx.lineWidth = 1.5;
        ctx.stroke();
        if (funnel > 0.0005) {
          const k = clamp(funnel / 0.05, 0.1, 1);
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(rg.fx - 26, fy);
          ctx.lineTo(rg.fx + 26, fy);
          ctx.lineTo(rg.fx + 7, nk.y + 2);
          ctx.lineTo(rg.fx - 7, nk.y + 2);
          ctx.closePath();
          ctx.clip();
          ctx.fillStyle = funnelFluid ? FLUIDS[funnelFluid].color : fluidColor();
          ctx.fillRect(rg.fx - 30, nk.y + 2 - 32 * k, 60, 32 * k);
          ctx.restore();
        }
      }
      const capAt = capOn ? { x: nk.x + nk.w / 2 + shakeX('cap'), y: nk.y - 7 } : { x: rg.capRest.x + shakeX('cap'), y: rg.capRest.y };
      roundRect(ctx, capAt.x - 18, capAt.y - 9, 36, 18, 5);
      ctx.fillStyle = C.ink;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.35)';
      ctx.lineWidth = 1;
      for (let i = -14; i <= 14; i += 4) {
        ctx.beginPath();
        ctx.moveTo(capAt.x + i, capAt.y - 7);
        ctx.lineTo(capAt.x + i, capAt.y + 7);
        ctx.stroke();
      }
      if (m.tier === 0) {
        const k = curStep();
        if (k === 1 || k === 3) pulse(nk.x + nk.w / 2, nk.y - 7, 26);
      }
      // spill trail
      if (spilled > 0.001) {
        ctx.fillStyle = shade(fluidColor(), 0.1);
        ctx.globalAlpha = 0.8;
        ctx.fillRect(nk.x + nk.w - 4, nk.y, 4, tank.h * 0.6);
        ctx.beginPath();
        ctx.ellipse(nk.x + nk.w + 6, tank.y + tank.h + 2, 16 + spilled * 120, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // pedal
      drawPedal(rg.pedalR);
      if (m.tier === 0 && curStep() === 0) pulse(rg.pedalR.x + rg.pedalR.w / 2, rg.pedalR.y + rg.pedalR.h * 0.62, 40);

      // syringe (draws off an overfill)
      drawSyringe(rg.syringe);

      // loupe tool around FULL
      if (loupe) {
        const L = rg.loupeC;
        ctx.strokeStyle = 'rgba(31,42,48,.35)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(L.x + L.r, L.y);
        ctx.lineTo(glass.x - 6, L.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.save();
        ctx.beginPath();
        ctx.arc(L.x, L.y, L.r, 0, Math.PI * 2);
        ctx.fillStyle = '#34444c';
        ctx.fill();
        ctx.clip();
        const z = 3;
        const fy = glassY(glass, m.full);
        ctx.translate(L.x, L.y);
        ctx.scale(z, z);
        ctx.translate(-(glass.x + glass.w / 2), -fy);
        drawGlass(glass, sys.res, fluidColor(), false);
        ctx.strokeStyle = C.ink;
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(glass.x - 4, fy);
        ctx.lineTo(glass.x + glass.w + 4, fy);
        ctx.stroke();
        ctx.restore();
        ctx.strokeStyle = C.ink;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(L.x, L.y, L.r, 0, Math.PI * 2);
        ctx.stroke();
        label(ctx, 'FULL', L.x, L.y + L.r + 10, { size: 9, weight: 900, color: C.inkSoft });
      }

      // shelf
      drawShelf(g);

      // the can in hand, over everything
      if (held >= 0) drawHeldCan(rg);
    }

    function pulse(x: number, y: number, r: number) {
      const k = (clock * 1.4) % 1;
      ctx.strokeStyle = C.sea;
      ctx.globalAlpha = 1 - k;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, r * (0.7 + 0.5 * k), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    /** blind: the procedure as printed on the work card (step 3 never turns into "Too full") */
    const card = () => ['Pump the brakes to 0 psi', 'Take the filler cap off', `Pour ${approvedName} up to FULL`, 'Refit the filler cap', 'Sign off'];
    function drawBanner(r: R) {
      // blind: nothing ticks itself off; the card steps through the procedure on its own
      const st = tracker ? steps() : card().map((text) => ({ text, done: false }));
      // (the first frame's dt can be a hair negative: never index with a negative step)
      const k = tracker ? st.findIndex((s) => !s.done) : Math.floor(Math.max(0, clock) / 3.5) % st.length;
      roundRect(ctx, r.x, r.y, r.w, r.h, r.h / 2);
      ctx.fillStyle = 'rgba(46,124,147,.12)';
      ctx.fill();
      for (let i = 0; i < 5; i++) {
        const cx = r.x + 16 + i * 17;
        ctx.fillStyle = st[i].done ? C.palm : i === k ? C.sea : 'rgba(31,42,48,.18)';
        ctx.beginPath();
        ctx.arc(cx, r.y + r.h / 2, 6.5, 0, Math.PI * 2);
        ctx.fill();
        label(ctx, st[i].done ? '✓' : String(i + 1), cx, r.y + r.h / 2 + 0.5, { size: 8.5, weight: 900, color: C.white });
      }
      fitLabel(ctx, st[k].text, r.x + 104, r.y + r.h / 2 + 0.5, r.w - 112, { size: 12.5, weight: 800, color: C.seaDeep, align: 'left' });
    }

    function drawPedal(r: R) {
      // Power brakes: the pedal works a brake valve, no master cylinder. Travel:
      // open bleeder = to the floor; air in the line = soft; otherwise firm.
      const soft = m.bleed && sys.airQ.reduce((a, b) => a + b, 0) > 0;
      const depth = sys.bleederOpen ? 1 : soft ? 0.8 : 0.45;
      const d = ease.inOutCubic(pedal) * depth * r.h * 0.26;
      label(ctx, 'BRAKE', r.x + r.w / 2, r.y - 14, { size: 10, weight: 900, color: C.inkSoft });
      // arm from a pivot above
      ctx.strokeStyle = '#56646b';
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(r.x + r.w / 2, r.y + 4);
      ctx.lineTo(r.x + r.w / 2, r.y + r.h * 0.38 + d);
      ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.fillStyle = C.ink;
      ctx.beginPath();
      ctx.arc(r.x + r.w / 2, r.y + 4, 6, 0, Math.PI * 2);
      ctx.fill();
      // pad
      const py = r.y + r.h * 0.38 + d;
      roundRect(ctx, r.x, py, r.w, r.h * 0.36, 10);
      ctx.fillStyle = '#3b464b';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.18)';
      ctx.lineWidth = 2;
      for (let i = 1; i < 5; i++) {
        const yy = py + (r.h * 0.36 * i) / 5;
        ctx.beginPath();
        ctx.moveTo(r.x + 10, yy);
        ctx.lineTo(r.x + r.w - 10, yy);
        ctx.stroke();
      }
      if (pedal === 0 && !finished) label(ctx, 'press', r.x + r.w / 2, py + r.h * 0.18, { size: 11, weight: 800, color: C.paper });
    }

    function drawHandPump(r: R) {
      label(ctx, 'HAND PUMP', r.x + r.w / 2, r.y - 12, { size: 10, weight: 900, color: C.inkSoft });
      // pump body on a base plate
      const bx = r.x + 10;
      const bw = 28;
      const by = r.y + r.h * 0.4;
      const bb = r.y + r.h - 4;
      ctx.fillStyle = shade(C.ink, 0.25);
      ctx.fillRect(r.x, bb - 6, 48, 8);
      const gr = ctx.createLinearGradient(bx, 0, bx + bw, 0);
      gr.addColorStop(0, '#7f8b90');
      gr.addColorStop(0.4, '#dfe4e6');
      gr.addColorStop(1, '#7a868b');
      roundRect(ctx, bx, by, bw, bb - by - 4, 6);
      ctx.fillStyle = gr;
      ctx.fill();
      ctx.strokeStyle = 'rgba(31,42,48,.45)';
      ctx.lineWidth = 1;
      ctx.stroke();
      // lever: pivots on the body, handle out to the right
      const pv = { x: bx + bw / 2, y: by - 6 };
      const th = ((-14 + 32 * ease.inOutCubic(pump)) * Math.PI) / 180;
      const L = r.w - 30;
      const gx = pv.x + Math.cos(th) * L;
      const gy = pv.y + Math.sin(th) * L;
      // piston rod into the body
      const rx = pv.x + Math.cos(th) * 16;
      const ry = pv.y + Math.sin(th) * 16;
      ctx.strokeStyle = '#b9c1c4';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(rx, ry);
      ctx.lineTo(rx, by + 10);
      ctx.stroke();
      ctx.strokeStyle = '#56646b';
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(pv.x - 8 * Math.cos(th), pv.y - 8 * Math.sin(th));
      ctx.lineTo(gx, gy);
      ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.fillStyle = C.ink;
      ctx.beginPath();
      ctx.arc(pv.x, pv.y, 5, 0, Math.PI * 2);
      ctx.fill();
      // rubber grip
      ctx.save();
      ctx.translate(gx, gy);
      ctx.rotate(th);
      roundRect(ctx, -26, -11, 40, 22, 11);
      ctx.fillStyle = '#3b464b';
      ctx.fill();
      ctx.restore();
      if (pump === 0 && !finished) label(ctx, 'press', gx - 6, gy + 24, { size: 11, weight: 800, color: C.inkSoft });
      // relief valve cracking: a puff at the body
      const k = (clock - reliefT) / 0.6;
      if (k >= 0 && k < 1) {
        ctx.strokeStyle = `rgba(86,100,107,${0.7 * (1 - k)})`;
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.arc(bx + bw + 6 + k * 14, by + 14 + i * 6, 3 + k * 5, -0.8, 0.8);
          ctx.stroke();
        }
      }
    }

    function drawSyringe(r: R) {
      const on = holding('syringe');
      const cy = r.y + r.h / 2 - 6;
      // barrel
      roundRect(ctx, r.x + 8, cy - 8, 44, 16, 4);
      ctx.fillStyle = 'rgba(255,255,255,.8)';
      ctx.fill();
      ctx.strokeStyle = C.inkSoft;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      const fillW = on ? 12 + ((clock * 20) % 30) : 6;
      ctx.fillStyle = fluidColor();
      ctx.fillRect(r.x + 9, cy - 6, fillW, 12);
      // needle + plunger
      ctx.strokeStyle = C.inkSoft;
      ctx.beginPath();
      ctx.moveTo(r.x + 8, cy);
      ctx.lineTo(r.x - 2, cy);
      ctx.moveTo(r.x + 52, cy);
      ctx.lineTo(r.x + 64 + (on ? 6 : 0), cy);
      ctx.moveTo(r.x + 64 + (on ? 6 : 0), cy - 7);
      ctx.lineTo(r.x + 64 + (on ? 6 : 0), cy + 7);
      ctx.stroke();
      label(ctx, 'syringe · hold', r.x + r.w / 2 - 2, r.y + r.h - 6, { size: 9.5, weight: 800, color: C.inkSoft });
    }

    function drawCan(f: FluidId, i: number, w: number, h: number, o: { bare?: boolean } = {}) {
      // origin: bottom-left of the can
      const fl = FLUIDS[f];
      const body = ctx.createLinearGradient(0, 0, w, 0);
      body.addColorStop(0, '#9aa4a8');
      body.addColorStop(0.35, '#eef1f2');
      body.addColorStop(1, '#8e999e');
      roundRect(ctx, 0, -h, w, h, 6);
      ctx.fillStyle = body;
      ctx.fill();
      ctx.strokeStyle = 'rgba(31,42,48,.45)';
      ctx.lineWidth = 1;
      ctx.stroke();
      // spout cap at the top-left
      ctx.fillStyle = '#56646b';
      ctx.fillRect(3, -h - 5, 12, 6);
      // label band
      const by = -h * 0.8;
      const bh = h * 0.62;
      ctx.fillStyle = m.teach ? shade(fl.color, 0.72) : LABEL_TINTS[i % LABEL_TINTS.length];
      ctx.fillRect(1, by, w - 2, bh);
      if (m.teach) {
        ctx.fillStyle = fl.color;
        ctx.fillRect(1, by, w - 2, 7);
      }
      if (o.bare) return;
      // the printed label: spec in bold, then what it is (the narrow can in hand shows the spec only)
      type Ln = { t: string; size: number; weight: number; color: string };
      const lines: Ln[] = [];
      const wide = w >= 60;
      const head = m.teach ? (wide ? [fl.name] : splitSpec(fl.name)) : splitSpec(fl.spec);
      for (const t of head) if (t) lines.push({ t, size: m.teach ? 11.5 : 10.5, weight: 900, color: C.ink });
      if (wide) {
        const sub = m.teach ? [fl.plain] : canKind(f, m.tier).split(' · ');
        const size = m.teach ? 9 : 8.5;
        const wrapped = sub.flatMap((seg) => wrapN(seg, w - 6, size, 700, 2)).slice(0, 3);
        for (const t of wrapped) lines.push({ t, size, weight: m.teach ? 800 : 700, color: C.inkSoft });
      }
      const room = bh - (m.teach ? 9 : 4);
      const natural = lines.reduce((a, l) => a + l.size + 3, 0);
      // short cans (small phones) squeeze the lines rather than spill off the label
      const k = Math.min(1, room / natural);
      const lh = (l: Ln) => (l.size + 3) * k;
      let y = by + (bh - natural * k) / 2 + (m.teach ? 3.5 : 0);
      for (const l of lines) {
        fitLabel(ctx, l.t, w / 2, y + lh(l) / 2, w - 6, { size: Math.max(7.5, l.size * (0.4 + 0.6 * k)), weight: l.weight, color: l.color });
        y += lh(l);
      }
    }
    /** greedy word wrap into at most n lines (the last one takes the rest) */
    function wrapN(text: string, maxW: number, size: number, weight: number, n: number): string[] {
      ctx.font = `${weight} ${size}px ${FONT}`;
      const words = text.split(' ');
      const out: string[] = [];
      let cur = '';
      for (let k = 0; k < words.length; k++) {
        const next = cur ? `${cur} ${words[k]}` : words[k];
        if (!cur || ctx.measureText(next).width <= maxW) cur = next;
        else {
          out.push(cur);
          if (out.length === n - 1) {
            out.push(words.slice(k).join(' '));
            return out;
          }
          cur = words[k];
        }
      }
      if (cur) out.push(cur);
      return out;
    }
    /** two lines for a spec that won't fit on a narrow can */
    function splitSpec(s: string): [string, string?] {
      if (s.startsWith('MIL-')) {
        const k = s.lastIndexOf('-');
        return [s.slice(0, k + 1), s.slice(k + 1)];
      }
      const parts = s.split(' · ');
      if (parts.length > 1) return [parts[0], parts[1]];
      const w = s.split(' ');
      if (w.length > 2) return [w.slice(0, 2).join(' '), w.slice(2).join(' ')];
      return [s];
    }

    function drawShelf(g: G) {
      const s = g.shelf;
      const slots = shelfSlots(g);
      // plank
      ctx.fillStyle = shade(C.sandDeep, -0.12);
      ctx.fillRect(s.x, s.y + s.h - 8, s.w, 8);
      const holdTxt =
        held >= 0
          ? m.teach
            ? `In hand: ${FLUIDS[m.shelf[held]].name} · drag it left to pour`
            : `In hand: ${FLUIDS[m.shelf[held]].spec} · ${canKind(m.shelf[held], m.tier)}`
          : m.teach
            ? 'Fluid shelf · tap a can to pick it up'
            : 'Fluid shelf';
      fitLabel(ctx, holdTxt, s.x + 2, s.y + 12, s.w - 4, { size: 11.5, weight: 800, color: C.inkSoft, align: 'left' });
      slots.forEach((r, i) => {
        if (i === held) {
          roundRect(ctx, r.x + 4, r.y + 4, r.w - 8, r.h - 8, 8);
          ctx.setLineDash([5, 5]);
          ctx.strokeStyle = 'rgba(31,42,48,.3)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.setLineDash([]);
          return;
        }
        ctx.save();
        ctx.translate(r.x + shakeX(`can${i}`), r.y + r.h - 2);
        drawCan(m.shelf[i], i, r.w, r.h - 8);
        ctx.restore();
        if (m.tier === 0 && curStep() === 2 && held < 0 && m.approved.includes(m.shelf[i])) pulse(r.x + r.w / 2, r.y + r.h / 2, 30);
      });
    }

    function drawHeldCan(rg: ReturnType<typeof resGeo>) {
      const f = m.shelf[held];
      const a = -tilt * TILT;
      const cw = 56;
      const ch = 72;
      const sp = rg.spout;
      // the can tips about its spout, so the stream always starts over the funnel
      ctx.save();
      ctx.translate(sp.x, sp.y);
      ctx.rotate(a);
      ctx.translate(-9, ch + 5);
      ctx.fillStyle = 'rgba(31,42,48,.12)';
      ctx.fillRect(4, -2, cw, 6);
      drawCan(f, held, cw, ch, { bare: tilt > 0.12 });
      ctx.restore();
      if (!capOn && tilt > 0.4) {
        const k = clamp((tilt - 0.4) / 0.5, 0, 1);
        const tx = rg.fx + 4;
        const ty = rg.neck.y - 28;
        ctx.strokeStyle = FLUIDS[f].color;
        ctx.lineWidth = 2 + 5 * k;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(sp.x - 2, sp.y + 1);
        ctx.quadraticCurveTo(sp.x - 26 - 8 * k, sp.y - 4, tx, ty);
        ctx.stroke();
        ctx.lineCap = 'butt';
        ctx.fillStyle = FLUIDS[f].color;
        for (let i = 0; i < 3; i++) {
          const q = (clock * 3 + i / 3) % 1;
          ctx.beginPath();
          ctx.arc(tx + Math.sin(i * 2.1 + clock * 9) * 6, ty + 2 + q * 8, 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (tilt === 0 && !finished) {
        label(ctx, '← tilt', sp.x - 9 + cw + 6, sp.y + 40, { size: 11, weight: 800, color: C.inkSoft, align: 'left' });
      }
    }

    function drawAccScene(g: G) {
      const ag = accGeo(g);
      const pc = m.precharge!;
      // ramp thermometer
      const t = ag.thermo;
      roundRect(ctx, t.x, t.y, t.w, t.h, 12);
      ctx.fillStyle = C.paper;
      ctx.fill();
      ctx.strokeStyle = 'rgba(31,42,48,.15)';
      ctx.stroke();
      label(ctx, 'RAMP TEMP', t.x + 12, t.y + 16, { size: 10, weight: 900, color: C.inkSoft, align: 'left' });
      const tx = t.x + 22;
      const ty0 = t.y + 30;
      const ty1 = t.y + t.h - 22;
      roundRect(ctx, tx - 5, ty0, 10, ty1 - ty0, 5);
      ctx.fillStyle = '#eef4f5';
      ctx.fill();
      ctx.strokeStyle = C.inkSoft;
      ctx.stroke();
      const frac = pc.unit === 'F' ? (pc.ramp - 40) / 80 : (pc.ramp - 5) / 45;
      ctx.fillStyle = '#c0392b';
      ctx.fillRect(tx - 2.5, ty1 - (ty1 - ty0) * frac, 5, (ty1 - ty0) * frac);
      ctx.beginPath();
      ctx.arc(tx, ty1 + 6, 8, 0, Math.PI * 2);
      ctx.fill();
      label(ctx, `${pc.ramp}°${pc.unit}`, t.x + t.w / 2 + 14, t.y + t.h / 2 + 4, { size: 24, weight: 900, color: C.ink });

      // accumulator (a steel bottle; you can't see inside)
      const a = ag.acc;
      const bg = ctx.createLinearGradient(a.x, 0, a.x + a.w, 0);
      bg.addColorStop(0, '#6f7c82');
      bg.addColorStop(0.4, '#cfd6d9');
      bg.addColorStop(1, '#6a777d');
      roundRect(ctx, a.x, a.y, a.w, a.h, a.w / 2);
      ctx.fillStyle = bg;
      ctx.fill();
      ctx.strokeStyle = 'rgba(31,42,48,.5)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      label(ctx, 'ACCUM', a.x + a.w / 2, a.y + a.h * 0.55, { size: 10, weight: 900, color: C.ink });
      label(ctx, 'N₂', a.x + a.w / 2, a.y + a.h * 0.55 + 14, { size: 10, weight: 900, color: C.ink });
      // hydraulic line out the bottom
      ctx.strokeStyle = '#7f8b90';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(a.x + a.w / 2, a.y + a.h);
      ctx.lineTo(a.x + a.w / 2, Math.min(g.shelf.y - 4, a.y + a.h + 24));
      ctx.stroke();
      // stem up to the gauge
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(ag.gc.cx, a.y);
      ctx.lineTo(ag.gc.cx, ag.gc.cy + ag.gc.r);
      ctx.stroke();
      // charging valve
      const v = ag.valve;
      ctx.fillStyle = '#b8903f';
      ctx.fillRect(v.x - 8, v.y - 6, 16, 12);
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 1;
      ctx.strokeRect(v.x - 8, v.y - 6, 16, 12);

      // gas gauge (digital readout on the charging kit)
      const gc = ag.gc;
      // no 1,000 numeral: precharges are worked around there, under the needle (the readout gives the number)
      dial(gc.cx, gc.cy, gc.r, gasShown, 2000, { major: 500, minor: 50, lbl: (n) => (n === 1000 ? '' : fmt(n)) });
      label(ctx, 'N₂ PSI', gc.cx, gc.cy + gc.r * 0.26, { size: Math.max(9, gc.r * 0.12), weight: 900, color: C.inkSoft });
      const lw = gc.r * 0.78;
      roundRect(ctx, gc.cx - lw / 2, gc.cy + gc.r * 0.5, lw, gc.r * 0.32, 5);
      ctx.fillStyle = '#233036';
      ctx.fill();
      label(ctx, fmt(gasShown), gc.cx, gc.cy + gc.r * 0.66, { size: Math.max(14, gc.r * 0.23), weight: 900, color: '#bfe6d0' });

      // hose from the bottle to the valve
      if (hose) {
        const bi = GASES.findIndex((x) => x.id === hose);
        const b = ag.bottles[bi];
        const k = clamp((clock - hoseT) / 0.35, 0, 1);
        const sx = b.x + b.w / 2;
        const sy = b.y + 8;
        const ex = sx + (v.x - 8 - sx) * ease.outCubic(k);
        const ey = sy + (v.y - sy) * ease.outCubic(k);
        ctx.strokeStyle = hose === 'air' ? '#d9a63a' : '#2b3438';
        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.bezierCurveTo(sx, sy - 60, ex - 50, ey + 10, ex, ey);
        ctx.stroke();
        ctx.lineCap = 'butt';
      }
      // hiss while a valve is open
      if ((holding('charge') && hose) || holding('vent')) {
        ctx.strokeStyle = 'rgba(86,100,107,.6)';
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 5; i++) {
          const q = (clock * 2.5 + i / 5) % 1;
          const x0 = v.x - 10 - q * 30;
          ctx.beginPath();
          ctx.moveTo(x0, v.y - 12 - i * 3);
          ctx.lineTo(x0 - 8, v.y - 14 - i * 3);
          ctx.stroke();
        }
      }

      // charge handwheel + vent knob
      const ch = ag.charge;
      const on = holding('charge');
      ctx.save();
      ctx.translate(ch.x + shakeX('charge'), ch.y);
      ctx.rotate(on ? -holdT * 3 : 0);
      ctx.fillStyle = on ? C.sea : C.seaDeep;
      ctx.beginPath();
      ctx.arc(0, 0, ch.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = C.paper;
      ctx.beginPath();
      ctx.arc(0, 0, ch.r * 0.72, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = on ? C.sea : C.seaDeep;
      ctx.lineWidth = 6;
      for (let k = 0; k < 3; k++) {
        const aa = (k / 3) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(aa) * ch.r * 0.72, Math.sin(aa) * ch.r * 0.72);
        ctx.stroke();
      }
      ctx.fillStyle = C.ink;
      ctx.beginPath();
      ctx.arc(0, 0, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      label(ctx, 'CHARGE · hold', ch.x, ch.y + ch.r + 11, { size: 10, weight: 900, color: C.ink });

      const vt = ag.vent;
      const von = holding('vent');
      ctx.fillStyle = von ? C.inkSoft : C.ink;
      ctx.beginPath();
      ctx.arc(vt.x, vt.y, vt.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = shade(C.ink, 0.3);
      ctx.beginPath();
      ctx.arc(vt.x, vt.y, vt.r * 0.45, 0, Math.PI * 2);
      ctx.fill();
      label(ctx, 'VENT', vt.x, vt.y, { size: 10, weight: 900, color: C.paper });
      label(ctx, 'VENT · hold', vt.x, vt.y + vt.r + 11, { size: 10, weight: 900, color: C.ink });

      // gas sources
      const s = g.shelf;
      ctx.fillStyle = shade(C.sandDeep, -0.12);
      ctx.fillRect(s.x, s.y + s.h - 6, s.w, 6);
      if (!hose)
        fitLabel(ctx, 'Charging hose · tap a supply to connect', s.x + 2, s.y + 10, s.w - 4, {
        size: 11.5,
        weight: 800,
        color: C.inkSoft,
        align: 'left',
      });
      ag.bottles.forEach((b, i) => drawBottle(GASES[i], b, hose === GASES[i].id));
    }

    function drawBottle(gs: (typeof GASES)[number], r: R, on: boolean) {
      const cx = r.x + r.w / 2;
      const bw = Math.min(46, r.w * 0.5);
      const top = r.y + 18;
      const bot = r.y + r.h - 8;
      if (gs.id === 'air') {
        // a coiled shop-air hose on a wall reel
        ctx.strokeStyle = gs.body;
        ctx.lineWidth = 5;
        for (let k = 0; k < 3; k++) {
          ctx.beginPath();
          ctx.ellipse(cx, (top + bot) / 2 + 6, bw * 0.55 - k * 5, (bot - top) * 0.3 - k * 4, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.fillStyle = '#9aa4a8';
        ctx.fillRect(cx - 5, top - 10, 10, 16);
      } else {
        roundRect(ctx, cx - bw / 2, top, bw, bot - top, bw / 2.4);
        const gr = ctx.createLinearGradient(cx - bw / 2, 0, cx + bw / 2, 0);
        gr.addColorStop(0, shade(gs.body, -0.25));
        gr.addColorStop(0.4, shade(gs.body, 0.25));
        gr.addColorStop(1, shade(gs.body, -0.3));
        ctx.fillStyle = gr;
        ctx.fill();
        ctx.save();
        roundRect(ctx, cx - bw / 2, top, bw, bot - top, bw / 2.4);
        ctx.clip();
        ctx.fillStyle = gs.shoulder;
        ctx.fillRect(cx - bw / 2, top, bw, 16);
        ctx.restore();
        ctx.fillStyle = '#9aa4a8';
        ctx.fillRect(cx - 6, top - 12, 12, 14);
      }
      if (on) {
        roundRect(ctx, r.x + 2, r.y + 2, r.w - 4, r.h - 4, 10);
        ctx.strokeStyle = C.sea;
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      roundRect(ctx, cx - r.w / 2 + 4, (top + bot) / 2 - 4, r.w - 8, 34, 6);
      ctx.fillStyle = 'rgba(251,245,233,.92)';
      ctx.fill();
      fitLabel(ctx, gs.name, cx, (top + bot) / 2 + 6, r.w - 14, { size: 11, weight: 900, color: C.ink });
      fitLabel(ctx, gs.sub, cx, (top + bot) / 2 + 21, r.w - 14, { size: 9, weight: 800, color: C.inkSoft });
    }

    function drawBrakeScene(g: G) {
      const bg = brakeGeo(g);
      // reservoir glass (same reservoir, seen from the wheel well)
      const gl = bg.glass;
      label(ctx, 'RESERVOIR', gl.x - 4, gl.y - 14, { size: 9.5, weight: 900, color: C.inkSoft, align: 'left' });
      roundRect(ctx, gl.x - 5, gl.y - 6, gl.w + 10, gl.h + 12, 9);
      ctx.fillStyle = '#34444c';
      ctx.fill();
      drawGlass(gl, sys.res, fluidColor(), true);
      marks(gl, 'right', 9.5);
      if (sys.dry && !blind) label(ctx, 'dry!', gl.x + gl.w + 8, gl.y + gl.h - 8, { size: 12, weight: 900, color: C.rust, align: 'left' });

      // wheel and disc brake
      const wh = bg.wheel;
      ctx.fillStyle = '#2b3438';
      ctx.beginPath();
      ctx.arc(wh.cx, wh.cy, wh.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#c9cfd2';
      ctx.beginPath();
      ctx.arc(wh.cx, wh.cy, wh.r * 0.62, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#8e999e';
      ctx.lineWidth = wh.r * 0.12;
      ctx.beginPath();
      ctx.arc(wh.cx, wh.cy, wh.r * 0.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#7f8b90';
      for (let k = 0; k < 6; k++) {
        const aa = (k / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(wh.cx + Math.cos(aa) * wh.r * 0.26, wh.cy + Math.sin(aa) * wh.r * 0.26, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      // caliper
      const cal = bg.cal;
      ctx.save();
      ctx.translate(cal.x, cal.y);
      ctx.rotate(cal.a);
      roundRect(ctx, -26, -18, 52, 36, 8);
      ctx.fillStyle = '#b9a071';
      ctx.fill();
      ctx.strokeStyle = 'rgba(31,42,48,.5)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
      // brake line in
      ctx.strokeStyle = '#7f8b90';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(cal.x - 20, cal.y + 12);
      ctx.quadraticCurveTo(wh.cx - wh.r * 0.2, wh.cy - wh.r * 1.2, gl.x + gl.w + 30, gl.y + 12);
      ctx.stroke();

      // clear hose from the bleeder to the jar (end submerged, so no air comes back)
      const b = bg.bleeder;
      const jr = bg.jar;
      const hx = jr.x + jr.w * 0.62;
      const hy = jr.y + jr.h * 0.86;
      const c1 = { x: b.x + 56, y: b.y + 16 };
      const c2 = { x: hx + 24, y: jr.y - 90 };
      const at = (s: number) => {
        const u = 1 - s;
        return {
          x: u * u * u * b.x + 3 * u * u * s * c1.x + 3 * u * s * s * c2.x + s * s * s * hx,
          y: u * u * u * b.y + 3 * u * u * s * c1.y + 3 * u * s * s * c2.y + s * s * s * hy,
        };
      };
      // jar
      ctx.fillStyle = 'rgba(238,244,245,.9)';
      roundRect(ctx, jr.x, jr.y, jr.w, jr.h, 10);
      ctx.fill();
      ctx.save();
      roundRect(ctx, jr.x, jr.y, jr.w, jr.h, 10);
      ctx.clip();
      ctx.fillStyle = shade(fluidColor(), 0.15);
      ctx.fillRect(jr.x, jr.y + jr.h * (1 - jar), jr.w, jr.h * jar);
      ctx.restore();
      roundRect(ctx, jr.x, jr.y, jr.w, jr.h, 10);
      ctx.strokeStyle = 'rgba(31,42,48,.5)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = C.inkSoft;
      ctx.fillRect(jr.x - 4, jr.y - 4, jr.w + 8, 7);
      // hose body
      const hoseFilled = sys.bleedStrokes > 0;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(31,42,48,.35)';
      ctx.lineWidth = 15;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, hx, hy);
      ctx.stroke();
      ctx.strokeStyle = hoseFilled ? shade(fluidColor(), 0.25) : '#eef4f5';
      ctx.lineWidth = 11;
      ctx.stroke();
      ctx.lineCap = 'butt';
      // bubbles moving down the hose on each stroke
      for (const sl of slugs) {
        const k = (clock - sl.t) / 1.3;
        if (k > 1.1) continue;
        // the slug of fresh fluid running down the hose (a dribble barely moves)
        const reach = sl.weak ? 0.3 : 1;
        if (k < reach) {
          ctx.strokeStyle = shade(fluidColor(), -0.12);
          ctx.lineWidth = sl.weak ? 5 : 8;
          ctx.lineCap = 'round';
          ctx.beginPath();
          for (let j = 0; j <= 8; j++) {
            const q = at(clamp(k - 0.16 + (j / 8) * 0.16, 0, 1));
            if (j === 0) ctx.moveTo(q.x, q.y);
            else ctx.lineTo(q.x, q.y);
          }
          ctx.stroke();
          ctx.lineCap = 'butt';
        }
        const n = sl.bubbles;
        for (let i = 0; i < n; i++) {
          const s = k - i * 0.08;
          if (s < 0 || s > 1) continue;
          const q = at(s);
          ctx.fillStyle = 'rgba(255,255,255,.95)';
          ctx.strokeStyle = 'rgba(31,42,48,.4)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(q.x + ((i % 2) - 0.5) * 2, q.y, sl.air ? 5 : 3.4 + (i % 2), 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
        // bubbles surfacing in the jar
        if (n && k > 0.95 && k < 1.1) {
          for (let i = 0; i < Math.min(n, 5); i++) {
            ctx.fillStyle = 'rgba(255,255,255,.9)';
            ctx.beginPath();
            ctx.arc(hx - 10 + i * 6, jr.y + jr.h * (1 - jar) + 3 - (k - 0.95) * 60, 2.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      // bleeder screw + wrench
      ctx.fillStyle = '#9aa4a8';
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const aa = (k / 6) * Math.PI * 2;
        ctx.lineTo(b.x + Math.cos(aa) * 7, b.y + Math.sin(aa) * 7);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(sys.bleederOpen ? -0.55 : 0);
      ctx.fillStyle = C.mech;
      roundRect(ctx, 6, -7, 56, 14, 7);
      ctx.fill();
      ctx.strokeStyle = shade(C.mech, -0.4);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 11, 0, Math.PI * 2);
      ctx.lineWidth = 5;
      ctx.strokeStyle = C.mech;
      ctx.stroke();
      ctx.restore();
      const lx = wh.cx - wh.r * 0.2;
      const ly = wh.cy + wh.r + 20;
      label(ctx, sys.bleederOpen ? 'Bleeder OPEN' : 'Bleeder closed', lx, ly, { size: 12.5, weight: 900, color: sys.bleederOpen ? C.seaDeep : C.inkSoft, align: 'center' });
      label(ctx, 'tap the wrench', lx, ly + 16, { size: 10, weight: 700, color: C.inkSoft, align: 'center' });

      drawPedal(bg.pedalR);
      drawHandPump(bg.pumpR);
    }

    function drawBar(g: G) {
      const bb = barButtons(g);
      // one shared size, so the tabs read alike
      let size = 12.5;
      ctx.font = `800 12.5px ${FONT}`;
      for (const t of bb.tabs) size = Math.min(size, (12.5 * (t.r.w - 12)) / ctx.measureText(SCENE_NAME[t.scene]).width);
      size = Math.max(9, size);
      for (const t of bb.tabs) {
        const on = t.scene === scene;
        roundRect(ctx, t.r.x, t.r.y, t.r.w, t.r.h, 12);
        ctx.fillStyle = on ? C.ink : C.paper;
        ctx.fill();
        if (!on) {
          ctx.strokeStyle = 'rgba(31,42,48,.18)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        fitLabel(ctx, SCENE_NAME[t.scene], t.r.x + t.r.w / 2, t.r.y + t.r.h / 2, t.r.w - 10, { size, weight: 800, color: on ? C.white : C.ink });
      }
      const s = bb.sign;
      roundRect(ctx, s.x, s.y, s.w, s.h, s.h / 2);
      ctx.fillStyle = C.sea;
      ctx.fill();
      label(ctx, 'Sign off', s.x + s.w / 2, s.y + s.h / 2, { size: 15, weight: 800, color: C.white });
      if (m.tier === 0 && curStep() === 4) pulse(s.x + s.w / 2, s.y + s.h / 2, 60);
    }

    return {
      timeUp(): PuzzleResult {
        finished = true;
        grips.clear();
        return makeResult();
      },
      destroy() {
        stop();
        offPtr();
        st.destroy();
      },
    };
  },
};
