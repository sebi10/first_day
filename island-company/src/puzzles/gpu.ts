// Mechanic · Ground power start. Start an aircraft off a ground power cart
// (GPU) the way the flight manual says: read the external-power placard, set
// the cart to match, avionics master OFF, battery master as placarded, plug in
// fully seated, cart ON, check the volts, start; then cart OFF, unplug,
// alternator ON, avionics ON. A turbine (tiers 4-5) also needs the cart's
// current limit set to the placard, fuel in at 12% N1 and an eye on ITT: a weak,
// slow start runs hot and must be aborted with the fuel lever, dry-motored to
// clear it, and the starter rested before a second try.
// Tiers 0-2 print the checklist; from tier 3 it is done from memory, as on the ramp.
// Blind sign-off (a real job from tier 2, params.blind): no verdict while you
// work or when it ends. Slips and faults are scored, never called out: no
// "Plugged in live" or "Fault: hot start" line, no ticked-off checklist (the
// card lists the items), no green flash when the plug seats, no summary and no
// flourish at the end. What the ramp shows stays: sparks and pitted pins from a
// live plug, smoke from behind the panel, the ITT needle climbing (and the
// gauge's exceedance warning), torching at the exhaust, the starter's click.
import { hashSeed, rng } from '../sim/rng';
import { C, FONT, backdrop, clamp, ease, fitLabel, label, lerp, loop, markInput, pointer, roundRect, settle, shade, stage, tnum } from './kit';
import { PASS, result, type PuzzleDef, type PuzzleResult } from './types';

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export type GpuKind = 'piston' | 'turbine';

export type GpuAircraft = {
  id: 'high28' | 'low14' | 'low28' | 'high14' | 'turbine';
  name: string;
  kind: GpuKind;
  /** high wing (Cessna-style: the master closes the external power relay) or low wing (Piper-style: start with the master OFF) */
  wing: 'high' | 'low';
  /** external power placard: system voltage the cart must deliver */
  volts: 14 | 28;
  /** placard: battery master ON (it closes the external power relay) or OFF during a ground power start */
  master: 'on' | 'off';
  /** turbine placard: maximum start current, amps (0 = not placarded) */
  ampMax: number;
  /** the ship's (low) battery at rest, volts */
  battV: number;
  /** charging-system switch label */
  gen: 'ALT' | 'GEN';
  /** an amphibian: it sits on its float wheels on the ramp */
  floats?: boolean;
};

/**
 * The island's own plane, as its external power placard reads (launchFor hands
 * it over): the start is on this airframe, whatever the order's tier. The tier
 * only sets the checklist, the hints and the clock.
 */
export type GpuPlane = { name: string; reg: string; designation: string; turbine: boolean; floats: boolean; ampMax: number; wing: 'high' | 'low'; battery: 'on' | 'off' };

// Pistons cover every placard combination, so the placard has to be read.
// High-wing (Cessna-style) ships need the battery master ON to pull in the
// external power relay, and their POH starts with the whole master (BAT and ALT)
// ON. Low-wing (Piper-style) ships feed ground power to the battery side of the
// master contactor: BATT OFF and ALT OFF for the start, so the panel bus (and its
// voltmeter) stays dead until the master goes ON after the cart is unplugged.
// Newer ships are 28 V, older ones 14 V.
const PISTONS: GpuAircraft[] = [
  { id: 'high28', name: 'High-wing single', kind: 'piston', wing: 'high', volts: 28, master: 'on', ampMax: 0, battV: 23.2, gen: 'ALT' },
  { id: 'low14', name: 'Low-wing single', kind: 'piston', wing: 'low', volts: 14, master: 'off', ampMax: 0, battV: 11.6, gen: 'ALT' },
  { id: 'low28', name: 'Low-wing single', kind: 'piston', wing: 'low', volts: 28, master: 'off', ampMax: 0, battV: 23.0, gen: 'ALT' },
  { id: 'high14', name: 'High-wing single', kind: 'piston', wing: 'high', volts: 14, master: 'on', ampMax: 0, battV: 11.5, gen: 'ALT' },
];

/** the charging system has to be OFF for the start: Piper-style POHs and the turbine (a Cessna-style master starts with ALT and BAT ON) */
export const altOffForStart = (ac: GpuAircraft) => ac.kind === 'turbine' || ac.master === 'off';
/** the panel voltmeter is on the main bus: live on ground power only with the battery master ON */
export const shipMeterLive = (ac: GpuAircraft) => ac.master === 'on';

export type StepId = 'avOff' | 'batt' | 'altOff' | 'cartV' | 'cartA' | 'plug' | 'cartOn' | 'verify' | 'start' | 'cartOff' | 'unplug' | 'altOn' | 'avOn';

/** turbine: the cart's current limit is right from this share of the placard up to the placard */
export const AMP_FLOOR = 0.9;
/** turbine: the ITT red line may be touched for a moment in a start, not held (the AFM's 1090 °C for a couple of seconds) */
export const ITT_HOLD = 1;
/** turbine: past this the start is a hot start at once */
export const ITT_INSTANT = 1150;
/** the ITT only climbs this fast (°C/s) once it is past 900 °C, so a watching mechanic has time to abort */
const ITT_RISE_CAP = 110;
/** turbine starter-generator duty: this many seconds running, then it has to rest (the AFM's 30 s on, 60 s off, with the rest shortened for the game) */
export const STARTER_DUTY = 30;
const DUTY_COOL = 3;
/** after an abort, the starter has to be OFF this long before the next try */
export const STARTER_REST = 5;
/** after an abort: seconds of dry motoring that clear the residual fuel */
export const CLEAR_SECS = 4;
/** after an abort: a relight sooner than this, or with ITT above RELIGHT_ITT, lights into residual fuel */
export const RELIGHT_WAIT = 12;
export const RELIGHT_ITT = 200;
/** seconds with the bus steady on the cart before the needle has been seen (a tap reads it at once) */
export const LOOK_SECS = 1.5;

export type GpuModel = {
  tier: number;
  ac: GpuAircraft;
  /** tiers 0-2: the AFM checklist is printed */
  checklist: boolean;
  /** tiers 0-1: the control for the current step is ringed */
  guide: boolean;
  /** how the last crew left the cockpit and the cart */
  init: { batt: boolean; alt: boolean; avionics: boolean; cartV: 14 | 28; cartA: number };
  /** the plug stops short of fully seated on the first push (a stiff receptacle) */
  sticky: boolean;
  /** piston: seconds of good cranking before it fires */
  crankNeed: number;
  /** turbine: fuel on to light-off, seconds */
  lightDelay: number;
  /** turbine: ITT severity (tier 5 runs hotter and faster) */
  heat: number;
  /** outside air, °C */
  ambient: number;
  /** turbine: ITT start limit, °C (the red line) */
  ittLimit: number;
  /** turbine: minimum N1 for fuel introduction, % */
  fuelMin: number;
  /** turbine: ground idle N1, % */
  idle: number;
  /** tool gpuMeter: digital volts/amps readout on the cart */
  meter: boolean;
  /**
   * the battery cart's state of charge, 0..1 (the island's cart, 1 in the lab).
   * A low cart rests a little below its setting and sags hard under the start
   * load (its internal resistance climbs as it runs down), so it cranks slower.
   */
  charge: number;
  steps: { id: StepId; text: string }[];
};

/** current-limit knob range, amps */
export const AMP_KNOB = { min: 0, max: 1600, detent: 50 } as const;

export function generateGpu(seed: number, tier: number, tools: string[] = [], kind?: GpuKind, charge = 100, plane?: GpuPlane): GpuModel {
  const t = clamp(Math.round(tier), 0, 5);
  const r = rng(hashSeed('gpu', seed, t));
  const k: GpuKind = plane ? (plane.turbine ? 'turbine' : 'piston') : (kind ?? (t >= 4 ? 'turbine' : 'piston'));
  let ac: GpuAircraft;
  const named = plane ? `${plane.name} · ${plane.reg} ${plane.designation}` : undefined;
  if (k === 'turbine') {
    const amp = r.pick([800, 900, 1000]);
    ac = { id: 'turbine', name: named ?? 'Turbine cargo single', kind: 'turbine', wing: 'high', volts: 28, master: 'on', ampMax: plane?.ampMax || amp, battV: 23.4, gen: 'GEN' };
  } else if (plane) {
    // the island's piston plane, by its own placard (the IC-185F amphibian: high wing, 28 V, battery master ON)
    r.next();
    const master = plane.battery;
    ac = { id: plane.wing === 'high' ? 'high28' : 'low28', name: named!, kind: 'piston', wing: plane.wing, volts: 28, master, ampMax: 0, battV: 23.2, gen: 'ALT', ...(plane.floats ? { floats: true } : {}) };
  } else {
    // the tutorial is the common 28 V, master-ON single; tier 1 adds the 14 V single
    const pool = t === 0 ? PISTONS.slice(0, 1) : t === 1 ? PISTONS.slice(0, 2) : PISTONS;
    ac = { ...r.pick(pool) };
  }
  const wrongV: 14 | 28 = ac.volts === 28 ? 14 : 28;
  let cartA: number;
  if (ac.kind === 'turbine') {
    // last used to charge a piston battery (far too low) or on a bigger turbine (over this placard)
    cartA = r.chance(0.65) ? r.int(6, 11) * 50 : ac.ampMax + r.int(3, 9) * 50;
  } else cartA = r.int(8, 18) * 50;
  const init = {
    batt: t === 0 ? false : r.chance(0.5),
    alt: t === 0 ? false : r.chance(t >= 3 ? 0.55 : 0.35),
    avionics: t === 0 ? true : r.chance(t >= 3 ? 0.85 : 0.7),
    cartV: t === 0 ? wrongV : r.chance(0.6) ? wrongV : ac.volts,
    cartA,
  };
  const m: GpuModel = {
    tier: t,
    ac,
    checklist: t <= 2,
    guide: t <= 1,
    init,
    sticky: t === 0 ? false : r.chance([0, 0.3, 0.5, 0.5, 0.45, 0.6][t]),
    crankNeed: Math.round(r.range(1.1, 2.1) * 10) / 10,
    lightDelay: Math.round(r.range(0.9, 1.4) * 10) / 10,
    heat: t >= 5 ? 1.03 : 1,
    ambient: t >= 5 ? 34 : 28,
    ittLimit: 1090,
    fuelMin: 12,
    idle: 52,
    meter: tools.includes('gpuMeter'),
    charge: clamp(charge / 100, 0, 1),
    steps: [],
  };
  m.steps = checklistFor(m);
  return m;
}

function checklistFor(m: GpuModel): { id: StepId; text: string }[] {
  const { ac } = m;
  const tb = ac.kind === 'turbine';
  const s: { id: StepId; text: string }[] = [
    { id: 'avOff', text: 'Avionics master OFF' },
    { id: 'batt', text: `Battery master ${ac.master === 'on' ? 'ON' : 'OFF'} (placard)` },
  ];
  if (altOffForStart(ac)) s.push({ id: 'altOff', text: tb ? 'Generator OFF' : 'Alternator OFF' });
  s.push({ id: 'cartV', text: `Cart output ${ac.volts} V (placard)` });
  if (tb) s.push({ id: 'cartA', text: `Current limit at ${ac.ampMax} A, not over` });
  s.push(
    { id: 'plug', text: 'Plug in, push until fully seated' },
    { id: 'cartOn', text: 'Cart ON' },
    { id: 'verify', text: shipMeterLive(ac) ? `Voltmeter: ${ac.volts} V on the bus` : `Cart voltmeter: ${ac.volts} V out` },
    {
      id: 'start',
      text: tb ? `Starter ON, fuel at ${m.fuelMin}% N1, starter OFF at idle` : 'Hold START, let go when it fires',
    },
    { id: 'cartOff', text: 'Cart OFF' },
    { id: 'unplug', text: 'Unplug, cable back on the cart' },
    { id: 'altOn', text: ac.master === 'off' ? `Battery master ON, ${tb ? 'generator' : 'alternator'} ON` : `${tb ? 'Generator' : 'Alternator'} ON` },
    { id: 'avOn', text: 'Avionics master ON' },
  );
  return s;
}

// ---------------------------------------------------------------------------
// Procedure simulation (pure: the puzzle UI only turns gestures into these calls)
// ---------------------------------------------------------------------------

export type ErrId =
  | 'arcIn'
  | 'arcOut'
  | 'avionicsPower'
  | 'wrongVolts'
  | 'noVerify'
  | 'battPlacard'
  | 'genOnStart'
  | 'noBus'
  | 'starterHeld'
  | 'longCrank'
  | 'overAmps'
  | 'lowAmps'
  | 'earlyFuel'
  | 'noClear'
  | 'hotRelight'
  | 'starterDuty'
  | 'starterLong'
  | 'genEarly'
  | 'avionicsEarly'
  | 'avionicsBeforeGen';

export type FaultId = 'overVolt' | 'lowVoltCrank' | 'avionicsStart' | 'hotStart';

/** point deductions for procedure slips (each counted once) */
export const ERRORS: Record<ErrId, { pen: number; text: string }> = {
  // arcing pits the receptacle pins: both ways and the job fails
  arcIn: { pen: 0.25, text: 'plugged in live' },
  arcOut: { pen: 0.25, text: 'unplugged live' },
  avionicsPower: { pen: 0.15, text: 'avionics on at power-up' },
  wrongVolts: { pen: 0.1, text: 'cart on the wrong voltage' },
  noVerify: { pen: 0.05, text: 'volts not checked' },
  battPlacard: { pen: 0.1, text: 'battery master against placard' },
  genOnStart: { pen: 0.1, text: 'charging system on for the start' },
  noBus: { pen: 0.05, text: 'cranked on the flat battery' },
  starterHeld: { pen: 0.1, text: 'starter held after it fired' },
  longCrank: { pen: 0.1, text: 'starter past its duty limit' },
  overAmps: { pen: 0.2, text: 'current over the placard' },
  lowAmps: { pen: 0.1, text: 'current limit set low' },
  earlyFuel: { pen: 0.1, text: 'fuel in below 12% N1' },
  noClear: { pen: 0.1, text: 'no dry-motoring run after the abort' },
  hotRelight: { pen: 0.2, text: 'relit into residual fuel' },
  starterDuty: { pen: 0.1, text: 'starter over its duty cycle' },
  starterLong: { pen: 0.05, text: 'starter left on at idle' },
  genEarly: { pen: 0.1, text: 'charging on before unplugging' },
  avionicsEarly: { pen: 0.1, text: 'avionics on before unplugging' },
  avionicsBeforeGen: { pen: 0.05, text: 'avionics on before the alternator' },
};

/** damage: any one caps the job below a pass */
export const FAULTS: Record<FaultId, string> = {
  overVolt: '28 V into a 14 V system',
  lowVoltCrank: 'cranked on 14 V: starter stalled',
  avionicsStart: 'avionics on during the start',
  hotStart: 'hot start: ITT over the limit',
};
export const FAULT_CAP = 0.35;
/** an unfinished job (engine not started, or after-start not done) never passes */
export const UNFINISHED_CAP = 0.55;

export type GpuEvent =
  | { k: 'power' }
  | { k: 'arc' }
  | { k: 'locked' }
  | { k: 'stuck' }
  | { k: 'seated' }
  | { k: 'crank' }
  | { k: 'dead' }
  | { k: 'fire' }
  | { k: 'light' }
  | { k: 'abort' }
  | { k: 'cleared' }
  | { k: 'run' }
  | { k: 'finish' }
  | { k: 'err'; id: ErrId }
  | { k: 'fault'; id: FaultId };

export type Plug = 'stowed' | 'partial' | 'seated';

export type GpuSim = {
  m: GpuModel;
  t: number;
  batt: boolean;
  alt: boolean;
  avionics: boolean;
  /** piston: START held; turbine: STARTER switch */
  starter: boolean;
  /** turbine: condition lever at LOW IDLE */
  fuel: boolean;
  cartOn: boolean;
  cartV: 14 | 28;
  cartA: number;
  plug: Plug;
  plugIns: number;
  /** external power relay closed: the ship is on the cart */
  fed: boolean;
  /** the main bus (battery master ON) is on the cart */
  busOnCart: boolean;
  poweredAt: number;
  verifiedAt: number;
  /** true panel-bus voltage and cart output current (the UI lags its needles behind these) */
  busV: number;
  amps: number;
  // piston
  rpm: number;
  crankT: number;
  crankRun: number;
  fired: boolean;
  heldAfter: number;
  // turbine
  n1: number;
  itt: number;
  peakItt: number;
  /** seconds the ITT has spent over the red line */
  ittOver: number;
  lit: boolean;
  fuelAt: number;
  /** fuel for the air: >1 runs hot (fuel below the minimum N1, or a relight into residual fuel) */
  rich: number;
  idleT: number;
  /** starter-generator heat, seconds of running (cools while it rests) */
  duty: number;
  aborts: number;
  abortAt: number;
  /** highest ITT seen up to the last abort */
  abortPeak: number;
  /** dry motoring (starter on, fuel off) since the last abort, seconds */
  clearT: number;
  /** residual fuel in the engine after an abort, 0..1 (dry motoring blows it out) */
  wet: number;
  /** seconds the starter has been off since the last abort */
  restT: number;
  running: boolean;
  everRunning: boolean;
  /** turbine: the start was aborted, cleared and the cart put away without a second try */
  stopped: boolean;
  errors: ErrId[];
  faults: FaultId[];
  events: GpuEvent[];
  done: boolean;
};

export function newSim(m: GpuModel): GpuSim {
  const s: GpuSim = {
    m,
    t: 0,
    batt: m.init.batt,
    alt: m.init.alt,
    avionics: m.init.avionics,
    starter: false,
    fuel: false,
    cartOn: false,
    cartV: m.init.cartV,
    cartA: m.init.cartA,
    plug: 'stowed',
    plugIns: 0,
    fed: false,
    busOnCart: false,
    poweredAt: -1,
    verifiedAt: -2,
    busV: 0,
    amps: 0,
    rpm: 0,
    crankT: 0,
    crankRun: 0,
    fired: false,
    heldAfter: 0,
    n1: 0,
    itt: m.ambient,
    peakItt: m.ambient,
    ittOver: 0,
    lit: false,
    fuelAt: -1,
    rich: 1,
    idleT: 0,
    duty: 0,
    aborts: 0,
    abortAt: -1,
    abortPeak: 0,
    clearT: 0,
    wet: 0,
    restT: 0,
    running: false,
    everRunning: false,
    stopped: false,
    errors: [],
    faults: [],
    events: [],
    done: false,
  };
  s.busV = trueBus(s);
  return s;
}

const ev = (s: GpuSim, e: GpuEvent) => s.events.push(e);
function err(s: GpuSim, id: ErrId) {
  if (s.errors.includes(id)) return;
  s.errors.push(id);
  ev(s, { k: 'err', id });
}
function fault(s: GpuSim, id: FaultId) {
  if (s.faults.includes(id)) return;
  s.faults.push(id);
  ev(s, { k: 'fault', id });
}

/** the external power relay closes on a fully seated plug from a live cart (and the battery master, where placarded) */
function feedNow(s: GpuSim) {
  return s.plug === 'seated' && s.cartOn && (s.m.ac.master === 'off' || s.batt);
}

function updateFeed(s: GpuSim) {
  const f = feedNow(s);
  if (f && !s.fed) {
    s.fed = true;
    s.poweredAt = s.t;
    const need = s.m.ac.volts;
    // 28 V on a 14 V ship cooks the battery side even with the master off
    if (s.cartV > need) fault(s, 'overVolt');
    else if (s.cartV < need) err(s, 'wrongVolts');
    ev(s, { k: 'power' });
    // power arriving with the starter already engaged: the start begins now
    if (s.starter && !s.running && !(s.m.ac.kind === 'piston' && s.fired)) crankChecks(s);
  } else if (!f) s.fed = false;
  // the relay's transient reaches the avionics only through a live main bus
  const onCart = s.fed && s.batt;
  if (onCart && !s.busOnCart && s.avionics && !s.everRunning) err(s, 'avionicsPower');
  s.busOnCart = onCart;
  s.busV = trueBus(s);
}

/** a low battery cart delivers less: full from half charge up, down to 0.8 when flat */
export const chargeFactor = (m: GpuModel) => (m.charge >= 0.5 ? 1 : 0.8 + 0.4 * m.charge);

/** starter power available, 0..~1.3 (1 = the cart at the placard setting) */
export function crankPower(s: GpuSim): number {
  const { ac } = s.m;
  if (s.fed) {
    const vf = (s.cartV === ac.volts ? 1 : s.cartV > ac.volts ? 1.2 : 0.3) * chargeFactor(s.m);
    if (ac.kind === 'turbine') return vf * clamp(s.cartA / ac.ampMax, 0, 1.3);
    return vf * clamp(s.cartA / 250, 0.3, 1);
  }
  if (s.batt) return ac.kind === 'turbine' ? 0.15 : 0.25; // the low ship's battery
  return 0;
}

const cranking = (s: GpuSim) => s.starter && !(s.m.ac.kind === 'piston' && s.fired);

/** the cart's resting output: its setting, a little under it as the battery runs down */
export const cartRest = (s: GpuSim) => s.cartV * (0.955 + 0.045 * s.m.charge);

/**
 * the cart's own output voltmeter: its terminal volts, sagging under the
 * starter's load. A run-down battery's internal resistance climbs, so it sags
 * several times as far (more on a 28 V cart, whose cells are in longer
 * strings), never below two thirds of its rest voltage.
 */
export function cartOut(s: GpuSim): number {
  if (!s.cartOn) return 0;
  const rest = cartRest(s);
  if (!s.fed) return rest;
  const weak = 1 + 4 * (1 - s.m.charge) * (s.cartV / 14);
  const sag = cranking(s) ? Math.min(rest * 0.35, clamp(s.amps / 1000, 0, 1.2) * 2.6 * weak) : 0;
  return rest - sag - (s.running ? 0 : 0.1);
}

/** the panel voltmeter reads the main bus: dead with the battery master OFF, else the strongest source on it */
function trueBus(s: GpuSim): number {
  const { ac } = s.m;
  if (!s.batt) return 0;
  const charging = s.running && s.alt ? ac.volts + 0.3 : 0;
  // a low battery sags hard under the starter
  const batt = ac.battV * (cranking(s) && !s.fed ? 0.62 : cranking(s) ? 0.75 : 1);
  return Math.max(charging, batt, s.fed ? cartOut(s) : 0);
}

/** the start attempt begins (START pressed / STARTER switch on): the checks a mechanic is judged on */
function crankChecks(s: GpuSim) {
  const { ac } = s.m;
  const p = crankPower(s);
  if (p <= 0) {
    ev(s, { k: 'dead' });
    return;
  }
  if (s.running) {
    err(s, 'starterHeld');
    return;
  }
  ev(s, { k: 'crank' });
  if (s.alt && altOffForStart(ac)) err(s, 'genOnStart');
  if (ac.master === 'off' && s.batt) err(s, 'battPlacard');
  if (!s.fed) err(s, 'noBus');
  else {
    if (s.verifiedAt < s.poweredAt) err(s, 'noVerify');
    if (s.cartV < ac.volts) fault(s, 'lowVoltCrank');
    if (ac.kind === 'turbine' && s.cartA > ac.ampMax) err(s, 'overAmps');
  }
}

export type Switch = 'batt' | 'alt' | 'avionics' | 'starter' | 'fuel';

/** flip a cockpit control; for a piston, starter=true is START pressed and false is released */
export function flip(s: GpuSim, sw: Switch, on?: boolean) {
  if (s.done) return;
  const v = on ?? !s[sw];
  if (s[sw] === v) return;
  const { ac } = s.m;
  const tb = ac.kind === 'turbine';
  if (sw === 'alt' && v && s.everRunning && s.plug !== 'stowed') err(s, 'genEarly');
  // after the start the avionics come alive with their own master, or with the battery master under them
  if (v && s.everRunning && ((sw === 'avionics' && s.batt) || (sw === 'batt' && s.avionics))) {
    if (s.plug !== 'stowed') err(s, 'avionicsEarly');
    else if (!s.alt) err(s, 'avionicsBeforeGen');
  }
  s[sw] = v;
  if (sw === 'batt') updateFeed(s);
  if (sw === 'starter') {
    if (v) {
      s.crankRun = 0;
      crankChecks(s);
    } else {
      if (!tb && !s.fired) s.crankT *= 0.5;
      // after an abort the starter keeps motoring until the engine is cleared
      if (tb && s.aborts > 0 && !s.everRunning && !s.lit && s.clearT < CLEAR_SECS) err(s, 'noClear');
    }
  }
  if (sw === 'fuel' && tb) {
    if (v) {
      if (!s.running) {
        if (s.aborts > 0) {
          // residual fuel in a hot engine: a second hot start, or torching
          if (s.t - s.abortAt < RELIGHT_WAIT || s.itt > RELIGHT_ITT) err(s, 'hotRelight');
          if (s.clearT < CLEAR_SECS) err(s, 'noClear');
          // straight back in without resting the starter-generator
          if (s.restT < STARTER_REST) err(s, 'starterDuty');
        }
        if (s.n1 < s.m.fuelMin) err(s, 'earlyFuel');
        // a weak cart only bites once there is fire to feed: that is when it counts
        if (s.fed && s.cartA < ac.ampMax * AMP_FLOOR) err(s, 'lowAmps');
      }
      s.fuelAt = s.t;
      s.rich = 1 + clamp(s.m.fuelMin - s.n1, 0, 12) * 0.06 + 0.35 * s.wet;
    } else if (s.lit && !s.running) {
      s.aborts++;
      s.abortAt = s.t;
      s.abortPeak = Math.max(s.abortPeak, s.peakItt);
      s.clearT = 0;
      s.wet = 1;
      s.restT = 0;
      s.lit = false; // the fire goes out with the fuel
      ev(s, { k: 'abort' });
    }
  }
  s.busV = trueBus(s);
}

/** cart output selector; the cart's interlock won't switch range under power */
export function setCartVolts(s: GpuSim, v: 14 | 28): boolean {
  if (s.cartOn) {
    ev(s, { k: 'locked' });
    return false;
  }
  s.cartV = v;
  return true;
}

export function setCartAmps(s: GpuSim, a: number) {
  s.cartA = clamp(Math.round(a / AMP_KNOB.detent) * AMP_KNOB.detent, AMP_KNOB.min, AMP_KNOB.max);
}

export function setCart(s: GpuSim, on: boolean) {
  if (s.done || s.cartOn === on) return;
  s.cartOn = on;
  updateFeed(s);
}

/** the plug meets the receptacle */
export function plugIn(s: GpuSim) {
  if (s.done || s.plug !== 'stowed') return;
  if (s.cartOn) {
    err(s, 'arcIn');
    ev(s, { k: 'arc' });
  }
  s.plugIns++;
  if (s.m.sticky && s.plugIns === 1) {
    s.plug = 'partial';
    ev(s, { k: 'stuck' });
  } else {
    s.plug = 'seated';
    ev(s, { k: 'seated' });
  }
  updateFeed(s);
}

/** push a partly seated plug home */
export function pushPlug(s: GpuSim) {
  if (s.done || s.plug !== 'partial') return;
  s.plug = 'seated';
  ev(s, { k: 'seated' });
  updateFeed(s);
}

export function unplug(s: GpuSim) {
  if (s.done || s.plug === 'stowed') return;
  if (s.cartOn) {
    err(s, 'arcOut');
    ev(s, { k: 'arc' });
  }
  s.plug = 'stowed';
  updateFeed(s);
}

export type Meter = 'ship' | 'cart';

/** tap a voltmeter to read it: the panel one (the main bus) or the cart's output. Read on ground power before the start, it is the check */
export function readVolts(s: GpuSim, meter: Meter = shipMeterLive(s.m.ac) ? 'ship' : 'cart'): number {
  const v = meter === 'ship' ? s.busV : cartOut(s);
  if (s.fed && !s.everRunning && (meter === 'cart' || s.batt)) s.verifiedAt = s.t;
  return v;
}

const smooth = (x: number) => {
  const u = clamp(x, 0, 1);
  return u * u * (3 - 2 * u);
};

/**
 * ITT the combustion would settle at for this N1 (low airflow = hot). The fuel
 * control schedules fuel for a normal acceleration, so less starter assist than
 * the placard (a weak cart, or the starter cut early) leaves fuel over for heat.
 */
export function ittTarget(m: GpuModel, n1: number, rich = 1, assist = 1): number {
  return Math.min(1900, m.heat * rich * (520 + 820 * Math.exp(-(n1 - 12) / 10)) * (1 + 0.9 * clamp(1 - assist, 0, 1)));
}

export function step(s: GpuSim, dt: number) {
  if (s.done || dt <= 0) return;
  const m = s.m;
  s.t += dt;
  updateFeed(s);
  const p = crankPower(s);
  // the needle has been in view long enough to be read
  if (s.fed && !s.everRunning && s.verifiedAt < s.poweredAt && s.t - s.poweredAt >= LOOK_SECS && !cranking(s)) s.verifiedAt = s.t;
  if (m.ac.kind === 'piston') {
    const crank = s.starter && p > 0;
    if (crank && !s.fired) {
      if (s.avionics && s.batt) fault(s, 'avionicsStart');
      s.crankRun += dt;
      if (s.crankRun > 10) err(s, 'longCrank');
      if (p >= 0.6) {
        s.crankT += dt * Math.min(p, 1.2);
        if (s.crankT >= m.crankNeed) {
          s.fired = true;
          ev(s, { k: 'fire' });
        }
      }
    }
    if (s.fired) {
      if (s.starter) {
        s.heldAfter += dt;
        if (s.heldAfter > 1.2) err(s, 'starterHeld');
      } else if (!s.running) {
        s.running = s.everRunning = true;
        ev(s, { k: 'run' });
      }
    }
    const target = s.fired ? 1000 : crank ? 240 * Math.min(p, 1.1) : 0;
    s.rpm += (target - s.rpm) * (1 - Math.exp(-dt / (s.fired ? 0.35 : 0.25)));
    s.amps = s.fed ? (crank && !s.fired ? Math.min(s.cartA, 210) : 18) : 0;
  } else {
    const a = s.starter ? Math.min(p, 1.3) : 0;
    if (s.starter && s.avionics && s.batt && p > 0) fault(s, 'avionicsStart');
    // starter-generator duty cycle
    if (s.starter && p > 0) {
      s.duty += dt;
      if (s.duty > STARTER_DUTY) err(s, 'starterDuty');
    } else {
      s.duty = Math.max(0, s.duty - dt * DUTY_COOL);
      if (s.aborts > 0) s.restT += dt;
    }
    if (s.fuel && !s.lit && s.starter && s.n1 >= 6 && s.t - s.fuelAt >= m.lightDelay) {
      s.lit = true;
      ev(s, { k: 'light' });
    }
    if (!s.fuel) s.lit = false;
    const S = 6 * a * Math.max(0, 1 - s.n1 / 65);
    // combustion alone only sustains itself above ~30% N1: the starter has to carry it to idle
    const F = s.lit ? 12.5 * smooth((s.n1 - 9) / 40) : 0;
    let dn = S + F - 0.22 * s.n1;
    if (s.lit && s.n1 > m.idle - 1) dn = (m.idle + (s.starter ? 1 : 0) - s.n1) * 2;
    s.n1 = Math.max(0, s.n1 + dn * dt);
    if (s.lit && s.n1 < 5) s.lit = false; // flamed out
    // after an abort: airflow blows the residual fuel out, a stopped engine only drains it slowly
    if (!s.fuel && s.wet > 0) s.wet *= Math.exp(-dt / (s.n1 > 6 ? 2.5 : 20));
    if (s.aborts > 0 && !s.fuel && s.starter && s.n1 > 6 && !s.everRunning) {
      const before = s.clearT;
      s.clearT += dt;
      if (before < CLEAR_SECS && s.clearT >= CLEAR_SECS) ev(s, { k: 'cleared' });
    }
    const tgt = s.lit ? ittTarget(m, s.n1, s.rich, s.running ? 1 : a) : m.ambient + 10;
    const tau = tgt > s.itt ? 1.8 / m.heat : s.n1 > 8 ? 2.2 : 8;
    let d = (tgt - s.itt) * (1 - Math.exp(-dt / tau));
    if (d > 0 && s.itt > 900) d = Math.min(d, ITT_RISE_CAP * dt);
    s.itt += d;
    s.peakItt = Math.max(s.peakItt, s.itt);
    if (s.lit && s.itt > m.ittLimit) s.ittOver += dt;
    if (s.lit && (s.itt > ITT_INSTANT || s.ittOver > ITT_HOLD)) fault(s, 'hotStart');
    const atIdle = s.lit && s.n1 >= m.idle - 2;
    if (atIdle && s.starter) {
      s.idleT += dt;
      if (s.idleT > 6) err(s, 'starterLong');
    }
    if (atIdle && !s.starter && !s.running) {
      s.running = s.everRunning = true;
      ev(s, { k: 'run' });
    }
    if (s.running && !s.lit) s.running = false; // shut down
    s.amps = s.fed ? (s.starter ? Math.min(s.cartA, 1500 * Math.max(0.04, 1 - s.n1 / 60)) : 30) : 0;
  }
  s.busV = trueBus(s);
  if (isComplete(s)) {
    s.done = true;
    ev(s, { k: 'finish' });
  } else if (isSafeStop(s)) {
    s.done = s.stopped = true;
    ev(s, { k: 'finish' });
  }
}

export function isComplete(s: GpuSim): boolean {
  const tb = s.m.ac.kind === 'turbine';
  return s.running && s.plug === 'stowed' && !s.cartOn && s.alt && s.batt && s.avionics && !s.starter && (!tb || s.fuel);
}

/** turbine: a start aborted, dry-motored clear, starter off and the cart put away. A job ended safely, not a start */
export function isSafeStop(s: GpuSim): boolean {
  return (
    s.m.ac.kind === 'turbine' &&
    s.aborts > 0 &&
    !s.everRunning &&
    !s.fuel &&
    !s.lit &&
    !s.starter &&
    s.clearT >= CLEAR_SECS &&
    !s.cartOn &&
    s.plug === 'stowed'
  );
}

/** the abort was the right call: the start was running hot, or was set up to */
export function abortWarranted(s: GpuSim): boolean {
  return s.abortPeak >= 1000 || s.errors.includes('lowAmps') || s.errors.includes('earlyFuel') || s.errors.includes('hotRelight');
}

/** checklist tick for one item, from the live state (before the start) or the after-start state */
export function stepDone(s: GpuSim, id: StepId): boolean {
  const pre = !s.everRunning;
  const { ac } = s.m;
  switch (id) {
    case 'avOff':
      return !pre || !s.avionics;
    case 'batt':
      return !pre || s.batt === (ac.master === 'on');
    case 'altOff':
      return !pre || !s.alt;
    case 'cartV':
      return !pre || s.cartV === ac.volts;
    case 'cartA':
      return !pre || (s.cartA <= ac.ampMax && s.cartA >= ac.ampMax * AMP_FLOOR);
    case 'plug':
      return !pre || s.plug === 'seated';
    case 'cartOn':
      return !pre || s.cartOn;
    case 'verify':
      return !pre || (s.fed && s.verifiedAt >= s.poweredAt);
    case 'start':
      return s.everRunning;
    case 'cartOff':
      return s.everRunning && !s.cartOn;
    case 'unplug':
      return s.everRunning && s.plug === 'stowed';
    case 'altOn':
      return s.everRunning && s.alt && s.batt;
    case 'avOn':
      return s.everRunning && s.avionics;
  }
}

/** partial credit for an unfinished job, 0..UNFINISHED_CAP */
export function progressOf(s: GpuSim): number {
  const { ac } = s.m;
  let p = 0;
  if (s.everRunning || !s.avionics) p += 0.05;
  if (s.everRunning || s.cartV === ac.volts) p += 0.1;
  if (s.everRunning || s.plug === 'seated') p += 0.05;
  if (s.poweredAt >= 0) p += 0.05;
  if (s.verifiedAt >= s.poweredAt && s.poweredAt >= 0) p += 0.05;
  if (s.everRunning) p += 0.2;
  if (s.everRunning && !s.cartOn) p += 0.02;
  if (s.everRunning && s.plug === 'stowed') p += 0.03;
  return Math.min(UNFINISHED_CAP, p);
}

export function scoreGpu(s: GpuSim): { score: number; summary: string } {
  const pen = s.errors.reduce((n, id) => n + ERRORS[id].pen, 0);
  let v = 1 - pen;
  if (s.faults.length) v = Math.min(v, FAULT_CAP - 0.1 * (s.faults.length - 1));
  // a hot start aborted and cleared, with the cart put away, is a safe call: a bare pass
  if (s.stopped) v = Math.min(v, abortWarranted(s) ? PASS : progressOf(s));
  else if (!s.done) v = Math.min(v, progressOf(s));
  return { score: clamp(v, 0, 1), summary: summarize(s) };
}

function summarize(s: GpuSim): string {
  const head = s.faults.length
    ? `Fault: ${FAULTS[s.faults[0]]}`
    : s.stopped
      ? abortWarranted(s)
        ? s.errors.includes('lowAmps')
          ? 'Hot start aborted and cleared: cart too weak'
          : 'Hot start aborted and cleared'
        : 'Aborted a normal start'
      : s.done
        ? s.errors.length
          ? 'Started'
          : 'By the book: clean start'
        : s.everRunning
          ? 'Running, after-start not done'
          : 'Engine not started';
  // the head already says the cart was too weak
  const errs = head.endsWith('cart too weak') ? s.errors.filter((id) => id !== 'lowAmps') : s.errors;
  const slips = errs.slice(0, s.faults.length ? 1 : 2).map((id) => ERRORS[id].text);
  const more = errs.length - slips.length;
  return [head, ...slips, ...(more > 0 ? [`${more} more slip${more > 1 ? 's' : ''}`] : [])].join(', ');
}

// ---------------------------------------------------------------------------
// Puzzle
// ---------------------------------------------------------------------------

type P2 = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };
type Ctl = 'batt' | 'alt' | 'avionics' | 'starter' | 'fuel';
type Target = Ctl | 'volts' | 'amps' | 'cartSw' | 'plug' | 'voltmeter' | 'cartMeter';

const METAL = '#c9cfd2';
const CABLE = '#23292c';
const PANEL = '#263035';
const FACE = '#12181b';
const LAMP = '#F4D35E';

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
/** slips you'd notice on the ramp without a checklist (sparks, a grinding starter) */
const LOUD: ErrId[] = ['arcIn', 'arcOut', 'starterHeld', 'longCrank'];

export const gpu: PuzzleDef = {
  id: 'gpu',
  role: 'mech',
  title: 'Ground power start',
  gesture: 'Flip switches, drag the plug',
  howTo: 'Read the placard, set the cart, plug in, check the volts, start, unplug.',
  term: 'GPU: a ground power cart that starts the aircraft instead of its weak battery. Tap a meter for a close reading.',
  // a turbine start (abort, dry motoring, a second try) gets more time than a piston one at any tier
  seconds: (tier, ctx) => {
    const turbine = ctx?.plane ? ctx.plane.turbine : ctx?.job === 'gpuTurbine' || (ctx?.job !== 'gpuPiston' && tier >= 4);
    return turbine ? 110 + Math.max(0, tier - 4) * 10 : 70 + clamp(tier, 0, 3) * 8;
  },
  mount(host, p) {
    const job = p.context?.job;
    const kind: GpuKind | undefined = job === 'gpuTurbine' ? 'turbine' : job === 'gpuPiston' ? 'piston' : undefined;
    // the island's cart, as it was left: a run-down one sags under the start; the island's plane, by its placard
    const m = generateGpu(p.seed, p.tier, p.tools, kind, p.context?.cart?.charge ?? 100, p.context?.plane);
    const { ac } = m;
    const tb = ac.kind === 'turbine';
    const high = ac.wing === 'high';
    const s = newSim(m);
    const st = stage(host.el);
    const { ctx } = st;
    const teach = m.checklist;
    const blind = !!p.blind;
    // blind: the printed checklist stays, but nothing ticks itself off (a ticked item is a verdict)
    const ticks = teach && !blind;
    const guide = m.guide && !blind;
    const rm = p.reducedMotion;

    let finished = false;
    let flourishT = -1;
    let clock = 0;
    // needles lag the truth like real movements
    const nd = { v: s.busV, vv: 0, rpm: 0, n1: 0, itt: s.itt, amps: 0, cv: 0 };
    const lever: Record<Ctl | 'cart', number> = { batt: +s.batt, alt: +s.alt, avionics: +s.avionics, starter: 0, fuel: 0, cart: 0 };
    let sel = s.cartV === 28 ? 1 : 0; // output selector position, animated
    let propA = 0.3;
    let reading: { text: string; until: number; at: 'ship' | 'cart' } | null = null;
    let wiggleT = -9;
    let cartTapT = -9;
    let seatedT = -9;
    let listOpen = false;
    const toast = { text: '', until: 0, bad: false, key: '' };
    type Drag =
      | { kind: 'plug'; id: number; from: 'stowed' | 'in'; sx: number; sy: number; x: number; y: number; ox: number; oy: number; moved: boolean }
      | { kind: 'amps'; id: number; lastA: number; raw: number }
      | { kind: 'fuel'; id: number; sy: number; moved: boolean };
    let drag: Drag | null = null;
    /** the finger holding a piston's START button (kept apart from drags so a second finger can't strand it) */
    let startId: number | null = null;
    let plugBack: { from: P2; t0: number } | null = null;
    let arcT = -9;
    let pitted = false; // an arc pits the receptacle pins for good
    let smokeUntil = -1; // wisps from behind the panel after an electrical fault
    let smokeAt: P2 = { x: 0, y: 0 };
    let fireT = -9;
    const sparks: { x: number; y: number; vx: number; vy: number; life: number }[] = [];
    const puffs: { x: number; y: number; r: number; vx: number; vy: number; life: number; max: number; dark: boolean }[] = [];
    let lastStatus = '';
    let crankTick = 0;
    let frameDt = 0;
    const cable = { x: 0, y: 0, vx: 0, vy: 0, init: false };

    // ---- layout -------------------------------------------------------------
    const geo = () => {
      const w = st.w;
      const h = st.h;
      const head = 50;
      const ck: Rect = { x: 8, y: head + 2, w: w - 16, h: clamp(h * 0.245, 146, 196) };
      const cartH = clamp(h * 0.29, 186, 236);
      const cart: Rect = { x: 12, y: h - cartH - 6, w: w - 24, h: cartH };
      const rampTop = ck.y + ck.h + 4;
      const rampH = cart.y - rampTop;
      // cockpit: gauges on top, switches below
      const gr = clamp(ck.h * 0.2, 27, 38);
      const gy = ck.y + 10 + gr;
      const gxs = (tb ? [0.19, 0.5, 0.81] : [0.3, 0.7]).map((f) => ck.x + ck.w * f);
      const sy = gy + gr + (ck.y + ck.h - (gy + gr)) * 0.54;
      const ids: Ctl[] = tb ? ['batt', 'alt', 'avionics', 'starter', 'fuel'] : ['batt', 'alt', 'avionics', 'starter'];
      const fr = tb ? [0.1, 0.29, 0.48, 0.69, 0.89] : [0.13, 0.35, 0.57, 0.83];
      const ctl = {} as Record<Ctl, P2>;
      ids.forEach((id, i) => (ctl[id] = { x: ck.x + ck.w * fr[i], y: sy }));
      // aircraft, nose left. The placard callout sits in the sky over the cabin
      // (and the high wing), so on a short ramp the aircraft shrinks to leave it room
      const PL_MIN = 46;
      const rise = 0.26 + (high ? 0.17 : 0); // cabin roof (and wing) above the fuselage top, × fh
      const maxGround = cart.y - 46; // wheels stay clear of the plug parked on top of the cart
      const skyTop = rampTop + 6 + PL_MIN + 5;
      const fh = clamp(Math.min(rampH * 0.33, (maxGround - 14 - skyTop) / (1 + rise)), 40, 92);
      let fy = Math.max(rampTop + rampH * 0.47, skyTop + fh * (0.5 + rise));
      let legs = clamp(rampH * 0.17, 14, 40);
      if (fy + fh / 2 + legs > maxGround) {
        legs = Math.max(12, maxGround - fy - fh / 2);
        fy = Math.min(fy, maxGround - legs - fh / 2);
      }
      const recF = tb ? 0.45 : 0.34;
      const rec: P2 = { x: w * recF, y: fy + fh * 0.1 };
      const groundY = fy + fh / 2 + legs;
      const horizon = fy - fh * 0.12;
      const plW = Math.min(168, w - 24 - w * 0.5);
      const plH = clamp(fy - fh / 2 - fh * rise - 5 - (rampTop + 6), 36, 62);
      const placard: Rect = { x: w - 12 - plW, y: rampTop + 6, w: plW, h: plH };
      // cart
      const panel: Rect = { x: cart.x + 12, y: cart.y + 34, w: cart.w - 24, h: cart.h - 58 };
      const kr = clamp(panel.h * 0.2, 24, 34);
      // below the meter strip, with room for the knob's scale numbers
      const ky = Math.max(panel.y + 30 + (panel.h - 30) * 0.52, panel.y + 30 + kr + 21);
      const volts: P2 = { x: panel.x + panel.w * 0.17, y: ky };
      const amps: P2 = { x: panel.x + panel.w * 0.5, y: ky };
      const cartSw: P2 = { x: panel.x + panel.w * 0.84, y: ky + 4 };
      const outlet: P2 = { x: cart.x + 22, y: cart.y + 12 };
      const holster: P2 = { x: cart.x + 70, y: cart.y - 18 };
      // the cart's own edgewise meters, top row of its panel: output volts, then amps
      const mw = Math.min(118, (panel.w - 56) * 0.44);
      const vMeter: Rect = { x: panel.x + 10, y: panel.y + 8, w: mw, h: 20 };
      const aMeter: Rect = { x: vMeter.x + mw + 8, y: panel.y + 8, w: Math.min(150, panel.w - 56 - mw - 8), h: 20 };
      return { w, h, head, ck, gr, gy, gxs, ctl, ids, cart, rampTop, rampH, fh, fy, rec, groundY, horizon, placard, panel, kr, volts, amps, cartSw, outlet, holster, vMeter, aMeter };
    };
    type Geo = ReturnType<typeof geo>;
    const voltmeterAt = (g: Geo): P2 => ({ x: tb ? g.gxs[2] : g.gxs[0], y: g.gy });

    /** a plug in the hand rides above the thumb (the grab offset eases there over the first 40 px) */
    const inHand = (d: { x: number; y: number; sx: number; sy: number; ox: number; oy: number }): P2 => {
      const k = clamp(Math.hypot(d.x - d.sx, d.y - d.sy) / 40, 0, 1);
      return { x: d.x + lerp(d.ox, 0, k), y: d.y + lerp(d.oy, -34, k) };
    };
    /** where the plug is drawn right now */
    const plugPos = (g: Geo): P2 => {
      if (drag && drag.kind === 'plug' && drag.moved && s.plug === 'stowed') return inHand(drag);
      if (s.plug !== 'stowed') return s.plug === 'partial' ? { x: g.rec.x + 3, y: g.rec.y + 5 } : g.rec;
      if (plugBack) {
        const k = ease.outCubic(clamp((clock - plugBack.t0) / 0.35, 0, 1));
        if (k >= 1) plugBack = null;
        else return { x: lerp(plugBack.from.x, g.holster.x, k), y: lerp(plugBack.from.y, g.holster.y, k) };
      }
      return g.holster;
    };

    // ---- feedback -----------------------------------------------------------
    const say = (text: string, bad = false, secs = 2.4, key = '') => {
      toast.text = text;
      toast.bad = bad;
      toast.until = clock + secs;
      toast.key = key;
    };
    const burst = (x: number, y: number, n = 16) => {
      if (rm) return;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = 60 + Math.random() * 140;
        sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, life: 0.35 + Math.random() * 0.3 });
      }
    };
    const puff = (x: number, y: number, dark: boolean, n = 5, spread = 1) => {
      for (let i = 0; i < n; i++)
        puffs.push({
          x: x + (Math.random() - 0.5) * 8 * spread,
          y: y + (Math.random() - 0.5) * 6,
          r: 5 + Math.random() * 5,
          vx: 16 + Math.random() * 20,
          vy: -10 - Math.random() * 16,
          life: 0,
          max: 1 + Math.random() * 0.7,
          dark,
        });
    };
    const faultText: Record<FaultId, string> = {
      overVolt: 'Fault: 28 V into a 14 V ship. Bus over-volted',
      lowVoltCrank: 'Fault: starter stalls on 14 V',
      avionicsStart: 'Fault: avionics on through the start',
      hotStart: 'Fault: hot start. ITT over the red line',
    };

    function drain(g: Geo) {
      while (s.events.length) {
        const e = s.events.shift()!;
        switch (e.k) {
          case 'power':
            host.fx.thunk();
            break;
          case 'arc':
            (blind ? host.fx.snap : host.fx.fault)();
            arcT = clock;
            burst(g.rec.x, g.rec.y, 22);
            break;
          case 'locked':
            (blind ? host.fx.tap : host.fx.bad)();
            say('Range switch is locked while the output is ON', !blind);
            break;
          case 'stuck':
            host.fx.tick();
            if (ticks) say('Not fully seated: push it home', false, 2.4, 'stuck');
            break;
          case 'seated':
            host.fx.thunk();
            seatedT = clock;
            // it is home now: don't leave the push-it-home note up over the next item
            if (toast.key === 'stuck') toast.until = clock;
            break;
          case 'crank':
            host.fx.snap();
            break;
          case 'dead':
            (blind ? host.fx.tap : host.fx.bad)();
            say(ticks ? 'Nothing: no power on the bus' : 'Click. Nothing turns', !blind);
            break;
          case 'fire':
            (blind ? host.fx.thunk : host.fx.good)();
            fireT = clock;
            puff(g.w * (tb ? 0.36 : 0.22), g.fy + g.fh * 0.36, true, 7);
            break;
          case 'light':
            host.fx.thunk();
            fireT = clock;
            break;
          case 'abort':
            host.fx.tap();
            say(ticks ? 'Fuel cut off: keep motoring to clear it' : 'Fuel cut off');
            break;
          case 'cleared':
            if (ticks) {
              host.fx.tick();
              say('Cleared. Starter OFF and let it rest');
            }
            break;
          case 'run':
            (blind ? host.fx.tap : host.fx.good)();
            say(ticks ? 'Running. Now the after-start items' : 'Engine running');
            break;
          case 'err':
            // teaching tiers call out every slip; from tier 3 only what you'd see or hear on the ramp.
            // Blind: none (the sparks and the pitted pins still show)
            if (!blind && (teach || LOUD.includes(e.id))) {
              host.fx.bad();
              say(cap(ERRORS[e.id].text), true);
            }
            if (e.id === 'arcIn' || e.id === 'arcOut') pitted = true;
            break;
          case 'fault': {
            // blind: no call-out; the smoke, the needle and the flames are what you get
            if (!blind) {
              host.fx.fault();
              say(faultText[e.id], true, 3.2);
            }
            if (e.id === 'overVolt' || e.id === 'avionicsStart') {
              // smoke from behind the panel: the radio stack, or the whole bus
              smokeAt = e.id === 'avionicsStart' ? { x: g.ctl.avionics.x, y: g.ctl.avionics.y - 26 } : { x: g.w / 2, y: g.ck.y + g.ck.h * 0.62 };
              puff(smokeAt.x, smokeAt.y, true, 8, 2);
              smokeUntil = clock + 2.5;
            }
            break;
          }
          case 'finish':
            finish();
            break;
        }
      }
    }

    // ---- flow ---------------------------------------------------------------
    const curStep = () => m.steps.find((x) => !stepDone(s, x.id));
    const stepTarget = (): Target | null => {
      const c = curStep();
      if (!c) return null;
      switch (c.id) {
        case 'avOff':
        case 'avOn':
          return 'avionics';
        case 'batt':
          return 'batt';
        case 'altOff':
          return 'alt';
        case 'altOn':
          return s.batt ? 'alt' : 'batt';
        case 'cartV':
          return 'volts';
        case 'cartA':
          return 'amps';
        case 'plug':
        case 'unplug':
          return 'plug';
        case 'cartOn':
        case 'cartOff':
          return 'cartSw';
        case 'verify':
          return shipMeterLive(ac) ? 'voltmeter' : 'cartMeter';
        case 'start':
          if (!tb) return 'starter';
          if (!s.starter && !s.lit) return 'starter';
          if (!s.fuel) return s.n1 >= m.fuelMin ? 'fuel' : null;
          return s.n1 >= m.idle - 2 ? 'starter' : null;
      }
    };
    const updateStatus = () => {
      const txt = s.stopped
        ? 'Start aborted'
        : s.done
          ? 'Done'
          : s.everRunning
            ? 'Engine running · after-start'
            : s.starter || s.lit
              ? 'Starting'
              : s.aborts
                ? 'Aborted · before a restart'
                : `${ac.name} · before start`;
      if (txt !== lastStatus) {
        lastStatus = txt;
        host.status(txt);
      }
    };

    function finish() {
      if (finished) return;
      finished = true;
      drag = null;
      const sc = scoreGpu(s);
      const res = result(sc.score, sc.summary, dataOf());
      // blind: one neutral close-out and no summary line, the same time whatever the result
      if (blind) {
        host.fx.tap();
        settle(host, res, 600);
        return;
      }
      if (res.perfect) {
        flourishT = clock;
        host.fx.flourish();
      } else host.fx.good();
      host.status(res.summary);
      settle(host, res, res.perfect ? 900 : 400);
    }
    const dataOf = () => ({
      // which airframe it was (a turbine start takes more out of the cart)
      ac: ac.kind,
      errors: s.errors.slice(),
      faults: s.faults.slice(),
      aborts: s.aborts,
      stopped: s.stopped,
      peakItt: Math.round(s.peakItt),
      // what went wrong, for the hidden defect it leaves (DEFECT_RULES 'gpu:hot', 'gpu:arc')
      ...(s.faults.includes('hotStart') || s.errors.includes('hotRelight')
        ? { defect: 'hot' }
        : s.errors.includes('arcIn') || s.errors.includes('arcOut')
          ? { defect: 'arc' }
          : {}),
    });

    // ---- input --------------------------------------------------------------
    const near = (a: P2, x: number, y: number, r: number) => Math.hypot(a.x - x, a.y - y) <= r;
    const knobAngle = (a: number) => Math.PI * 0.75 + (a / AMP_KNOB.max) * Math.PI * 1.5;

    const offPtr = pointer(st.canvas, {
      down(pt) {
        if (finished || host.paused()) return;
        const g = geo();
        if (listOpen) {
          listOpen = false;
          host.fx.tap();
          return;
        }
        // checklist card
        if (teach && pt.y < g.head && pt.x > g.w - 78) {
          listOpen = true;
          host.fx.tap();
          return;
        }
        // cockpit controls
        for (const id of g.ids) {
          const c = g.ctl[id];
          if (Math.abs(pt.x - c.x) < 30 && Math.abs(pt.y - c.y) < 34) {
            if (id === 'starter' && !tb) {
              if (startId === null) {
                startId = pt.id;
                flip(s, 'starter', true);
              }
            } else if (id === 'fuel') {
              drag = { kind: 'fuel', id: pt.id, sy: pt.y, moved: false };
            } else {
              flip(s, id);
              host.fx.snap();
            }
            return;
          }
        }
        const vm = voltmeterAt(g);
        if (near(vm, pt.x, pt.y, g.gr + 6)) {
          const v = readVolts(s, 'ship');
          reading = { text: `${v.toFixed(1)} V`, until: clock + 2.6, at: 'ship' };
          wiggleT = clock;
          host.fx.tick();
          // a Piper-style ship on ground power: the panel bus is dead until the master goes ON
          if (ticks && s.fed && !s.batt && !s.everRunning) say('Master OFF: panel is dead. Read the cart meter');
          return;
        }
        // the cart's output voltmeter (a 44 px band around the 20 px meter)
        const cm = g.vMeter;
        if (pt.x > cm.x - 6 && pt.x < cm.x + cm.w + 6 && pt.y > cm.y - 12 && pt.y < cm.y + cm.h + 12) {
          const v = readVolts(s, 'cart');
          reading = { text: `${v.toFixed(1)} V`, until: clock + 2.6, at: 'cart' };
          cartTapT = clock;
          host.fx.tick();
          return;
        }
        // plug: in the receptacle or on the cart
        const pp = plugPos(g);
        if (near(pp, pt.x, pt.y, 34)) {
          drag = { kind: 'plug', id: pt.id, from: s.plug === 'stowed' ? 'stowed' : 'in', sx: pt.x, sy: pt.y, x: pt.x, y: pt.y, ox: pp.x - pt.x, oy: pp.y - pt.y, moved: false };
          plugBack = null;
          return;
        }
        // cart
        if (near(g.volts, pt.x, pt.y, g.kr + 20)) {
          const next: 14 | 28 = s.cartV === 28 ? 14 : 28;
          if (setCartVolts(s, next)) host.fx.snap();
          return;
        }
        if (near(g.amps, pt.x, pt.y, g.kr + 22)) {
          drag = { kind: 'amps', id: pt.id, lastA: Math.atan2(pt.y - g.amps.y, pt.x - g.amps.x), raw: s.cartA };
          return;
        }
        if (Math.abs(pt.x - g.cartSw.x) < 36 && Math.abs(pt.y - g.cartSw.y) < 40) {
          setCart(s, !s.cartOn);
          host.fx.thunk();
          return;
        }
      },
      move(pt) {
        if (!drag || drag.id !== pt.id || finished || host.paused()) return;
        const g = geo();
        if (drag.kind === 'plug') {
          drag.x = pt.x;
          drag.y = pt.y;
          if (!drag.moved && Math.hypot(pt.x - drag.sx, pt.y - drag.sy) > (drag.from === 'in' ? 20 : 8)) {
            drag.moved = true;
            if (drag.from === 'in') {
              unplug(s);
              host.fx.tap();
            }
          }
        } else if (drag.kind === 'amps') {
          const a = Math.atan2(pt.y - g.amps.y, pt.x - g.amps.x);
          let d = a - drag.lastA;
          if (d > Math.PI) d -= Math.PI * 2;
          if (d < -Math.PI) d += Math.PI * 2;
          drag.lastA = a;
          drag.raw = clamp(drag.raw + (d / (Math.PI * 1.5)) * AMP_KNOB.max, AMP_KNOB.min, AMP_KNOB.max);
          const before = s.cartA;
          setCartAmps(s, drag.raw);
          if (s.cartA !== before) host.fx.tick();
        } else if (drag.kind === 'fuel') {
          if (Math.abs(pt.y - drag.sy) > 14 && !drag.moved) {
            drag.moved = true;
            flip(s, 'fuel', pt.y < drag.sy);
            host.fx.snap();
          }
        }
      },
      up(pt) {
        if (startId === pt.id) {
          startId = null;
          flip(s, 'starter', false);
          return;
        }
        if (!drag || drag.id !== pt.id) return;
        const d = drag;
        drag = null;
        if (finished) return;
        const g = geo();
        if (d.kind === 'fuel') {
          if (!d.moved) {
            flip(s, 'fuel');
            host.fx.snap();
          }
        } else if (d.kind === 'plug') {
          if (!d.moved) {
            if (s.plug === 'partial') pushPlug(s);
            else if (s.plug === 'seated') {
              host.fx.tick();
              seatedT = clock;
            } else if (teach) say('Drag the plug up to the receptacle');
            return;
          }
          const at = inHand(d);
          if (s.plug === 'stowed' && near(g.rec, at.x, at.y, 46)) plugIn(s);
          else if (s.plug === 'stowed') {
            plugBack = { from: at, t0: clock };
            host.fx.tap();
          }
        }
      },
    });

    // ---- loop ---------------------------------------------------------------
    const spring = (cur: number, target: number, dt: number, tau: number) => (rm ? target : cur + (target - cur) * (1 - Math.exp(-dt / tau)));
    const stop = loop((_t, dt) => {
      const g = geo();
      const live = !host.paused() && !finished;
      if (live) {
        clock += dt;
        step(s, dt);
      }
      drain(g);
      // keep the frame rate up while things move on their own (starts, needles settling)
      if (s.starter || (s.lit && !s.running) || Math.abs(nd.itt - s.itt) > 3 || Math.abs(nd.n1 - s.n1) > 0.3 || Math.abs(nd.rpm - s.rpm) > 5 || Math.abs(nd.cv - cartOut(s)) > 0.2) markInput();
      // needles
      if (rm) nd.v = s.busV;
      else {
        // light spring with a touch of overshoot
        nd.vv += ((s.busV - nd.v) * 60 - nd.vv * 11) * dt;
        nd.v += nd.vv * dt;
      }
      nd.rpm = spring(nd.rpm, s.rpm, dt, 0.18);
      nd.n1 = spring(nd.n1, s.n1, dt, 0.25);
      // a fast needle: the abort call is made off it
      nd.itt = spring(nd.itt, s.itt, dt, 0.1);
      nd.amps = spring(nd.amps, s.amps, dt, 0.2);
      nd.cv = spring(nd.cv, cartOut(s), dt, 0.12);
      for (const id of Object.keys(lever) as (Ctl | 'cart')[]) {
        const on = id === 'cart' ? s.cartOn : s[id];
        lever[id] = spring(lever[id], on ? 1 : 0, dt, 0.045);
      }
      sel = spring(sel, s.cartV === 28 ? 1 : 0, dt, 0.06);
      // prop
      const spin = tb ? (s.n1 / 52) * 30 : (s.rpm / 1000) * 34;
      propA += spin * dt;
      // the starter's rhythm: compression strokes on a piston, a rising whine on a turbine
      const cranking = !tb ? s.starter && !s.fired && s.rpm > 40 : s.starter && s.fed && s.n1 < m.idle - 2;
      if (cranking && live) {
        crankTick += dt * (!tb ? s.rpm / 60 : 2 + s.n1 / 12);
        if (crankTick > 1) {
          crankTick = 0;
          host.fx.tick();
        }
      }
      if (!tb && s.running && Math.random() < dt * 2.5) puff(g.w * 0.22, g.fy + g.fh * 0.36, false, 1);
      if (clock < smokeUntil && Math.random() < dt * 8) puff(smokeAt.x + (Math.random() - 0.5) * 30, smokeAt.y, true, 1, 1);
      for (const sp of sparks) {
        sp.life -= dt;
        sp.x += sp.vx * dt;
        sp.y += sp.vy * dt;
        sp.vy += 420 * dt;
      }
      for (let i = sparks.length - 1; i >= 0; i--) if (sparks[i].life <= 0) sparks.splice(i, 1);
      for (const pf of puffs) {
        pf.life += dt;
        pf.x += pf.vx * dt;
        pf.y += pf.vy * dt;
        pf.r += 14 * dt;
      }
      for (let i = puffs.length - 1; i >= 0; i--) if (puffs[i].life >= puffs[i].max) puffs.splice(i, 1);
      updateStatus();
      frameDt = dt;
      draw(g);
    });

    // ---- drawing ------------------------------------------------------------
    function gaugeDial(
      c: P2,
      r: number,
      o: {
        max: number;
        val: number;
        step: number;
        major: number;
        /** on a small dial, label only every nth major tick */
        smallEvery?: number;
        fmt?: (v: number) => string;
        /** title under the pivot; a small dial takes the short form */
        title: string;
        short?: string;
        red?: number;
        green?: [number, number];
        /** 1: warning (blinks), 2: over the limit (blinks fast) */
        flash?: number;
      },
    ) {
      const small = r < 34;
      const a0 = Math.PI * 0.75;
      const sweep = Math.PI * 1.5;
      // a needle can swing a hair past full scale onto its stop pin
      const toA = (v: number) => a0 + (clamp(v, 0, o.max * 1.04) / o.max) * sweep;
      ctx.fillStyle = '#3a454a';
      ctx.beginPath();
      ctx.arc(c.x, c.y, r + 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = FACE;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.fill();
      if (o.green) {
        ctx.strokeStyle = C.palm;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(c.x, c.y, r - 4, toA(o.green[0]), toA(o.green[1]));
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(251,245,233,.85)';
      for (let v = 0; v <= o.max + 1e-6; v += o.step) {
        const a = toA(v);
        const major = Math.abs(v / o.major - Math.round(v / o.major)) < 1e-6;
        ctx.lineWidth = major ? 1.8 : 1;
        ctx.beginPath();
        ctx.moveTo(c.x + Math.cos(a) * (r - (major ? 8 : 5)), c.y + Math.sin(a) * (r - (major ? 8 : 5)));
        ctx.lineTo(c.x + Math.cos(a) * (r - 1.5), c.y + Math.sin(a) * (r - 1.5));
        ctx.stroke();
        // no 0 (the needle rests on it); a small dial numbers fewer ticks and leaves the top end (by the title) bare too
        const every = o.major * (small ? (o.smallEvery ?? 1) : 1);
        const bare = v < 1e-6 || (small && v > o.max - 1e-6);
        if (major && Math.abs(v / every - Math.round(v / every)) < 1e-6 && !bare) {
          const lr = r - (small ? 13 : 16);
          label(ctx, o.fmt ? o.fmt(v) : String(v), c.x + Math.cos(a) * lr, c.y + Math.sin(a) * lr, { size: small ? 8 : 9, weight: 700, color: 'rgba(251,245,233,.8)' });
        }
      }
      if (o.red != null) {
        const a = toA(o.red);
        ctx.strokeStyle = C.rust;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(c.x + Math.cos(a) * (r - 11), c.y + Math.sin(a) * (r - 11));
        ctx.lineTo(c.x + Math.cos(a) * (r - 1), c.y + Math.sin(a) * (r - 1));
        ctx.stroke();
      }
      // title (with its unit) below the scale ends, clear of the numbers and the needle's rest
      // the long title if it fits the gap between the scale ends, else the short one
      const tw = r * 1.5;
      const tsize = small ? 7.5 : 9;
      ctx.font = `900 ${Math.min(tsize, 8)}px ${FONT}`;
      const title = o.short && ctx.measureText(o.title).width > tw ? o.short : o.title;
      fitLabel(ctx, title, c.x, c.y + r * 0.7, tw, { size: tsize, weight: 900, color: 'rgba(251,245,233,.75)' });
      const a = toA(o.val);
      const hot = !!o.flash && Math.floor(clock * (o.flash > 1 ? 8 : 4)) % 2 === 0;
      if (o.flash) {
        // a warning glow round the bezel
        ctx.strokeStyle = C.rust;
        ctx.globalAlpha = hot ? 0.9 : 0.35;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(c.x, c.y, r + 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = hot ? C.rust : C.mech;
      ctx.lineWidth = 2.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(c.x - Math.cos(a) * r * 0.14, c.y - Math.sin(a) * r * 0.14);
      ctx.lineTo(c.x + Math.cos(a) * r * 0.84, c.y + Math.sin(a) * r * 0.84);
      ctx.stroke();
      ctx.fillStyle = '#56646b';
      ctx.beginPath();
      ctx.arc(c.x, c.y, 4, 0, Math.PI * 2);
      ctx.fill();
      // glass glint
      ctx.strokeStyle = 'rgba(255,255,255,.1)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r - 3, Math.PI * 1.1, Math.PI * 1.45);
      ctx.stroke();
    }

    /** a panel toggle; pos 0 = down/off, 1 = up/on; flips through the middle in perspective */
    function toggle(c: P2, pos: number, name: string, up: string, down: string, size = 1) {
      const ink = 'rgba(251,245,233,.92)';
      const soft = 'rgba(251,245,233,.5)';
      const fs = Math.min(1.15, size);
      label(ctx, name, c.x, c.y - 33 * size, { size: 10 * fs, weight: 800, color: ink });
      // position markings beside the bat, as engraved on a panel
      label(ctx, up, c.x + 12 * size, c.y - 15 * size, { size: 8 * fs, weight: 800, color: pos > 0.5 ? ink : soft, align: 'left' });
      label(ctx, down, c.x + 12 * size, c.y + 15 * size, { size: 8 * fs, weight: 800, color: pos < 0.5 ? ink : soft, align: 'left' });
      // nut
      ctx.fillStyle = '#7f8b90';
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
        ctx.lineTo(c.x + Math.cos(a) * 8 * size, c.y + Math.sin(a) * 8 * size);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#3b464b';
      ctx.beginPath();
      ctx.arc(c.x, c.y, 4.5 * size, 0, Math.PI * 2);
      ctx.fill();
      // bat lever
      const k = pos * 2 - 1; // -1 down .. 1 up
      const len = (4 + 12 * Math.abs(k)) * size;
      const tip = { x: c.x, y: c.y - Math.sign(k || 1) * len };
      ctx.strokeStyle = '#d7dcdf';
      ctx.lineCap = 'round';
      ctx.lineWidth = 5 * size;
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
      const bg = ctx.createRadialGradient(tip.x - 2, tip.y - 2, 1, tip.x, tip.y, 6 * size);
      bg.addColorStop(0, '#ffffff');
      bg.addColorStop(1, '#8e999e');
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, (4 + 2 * Math.abs(k)) * size, 0, Math.PI * 2);
      ctx.fill();
    }

    function ring(c: P2, r: number) {
      const k = 0.5 + 0.5 * Math.sin(clock * 5);
      ctx.strokeStyle = C.seaLight;
      ctx.globalAlpha = 0.55 + 0.45 * k;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r + 3 * k, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    function ringRect(R: Rect) {
      const k = 0.5 + 0.5 * Math.sin(clock * 5);
      ctx.strokeStyle = C.seaLight;
      ctx.globalAlpha = 0.55 + 0.45 * k;
      ctx.lineWidth = 3;
      roundRect(ctx, R.x - 4 - 2 * k, R.y - 4 - 2 * k, R.w + 8 + 4 * k, R.h + 8 + 4 * k, 8);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    /** an edgewise panel meter on the cart: scale numbers along the top, unit at the right; digital with the meter tool */
    function edgewise(R: Rect, unit: string, max: number, minor: number, major: number, val: number, digital: string | null) {
      roundRect(ctx, R.x, R.y, R.w, R.h, 4);
      if (digital != null) {
        ctx.fillStyle = '#9fb59a';
        ctx.fill();
        tnum(ctx, digital, R.x + R.w / 2, R.y + R.h / 2 + 1, { size: 12, weight: 800, color: '#1d2a1a', align: 'center' });
        return;
      }
      ctx.fillStyle = '#efe8d6';
      ctx.fill();
      const x0 = R.x + 6;
      const sw = R.w - 22;
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 1;
      for (let v = 0; v <= max + 1e-6; v += minor) {
        const x = x0 + (v / max) * sw;
        const big = Math.abs(v / major - Math.round(v / major)) < 1e-6;
        ctx.beginPath();
        ctx.moveTo(x, R.y + R.h - 2);
        ctx.lineTo(x, R.y + R.h - (big ? 8 : 5));
        ctx.stroke();
        if (big && v > 0 && v < max - 1e-6) label(ctx, String(v), x, R.y + 7, { size: 7, weight: 800, color: C.inkSoft });
      }
      label(ctx, unit, R.x + R.w - 8, R.y + R.h / 2, { size: 9, weight: 900, color: C.inkSoft });
      const nx = x0 + (clamp(val, 0, max * 1.02) / max) * sw;
      ctx.strokeStyle = C.rust;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(nx, R.y + 2);
      ctx.lineTo(nx, R.y + R.h - 2);
      ctx.stroke();
    }

    function drawCockpit(g: Geo) {
      const { ck } = g;
      roundRect(ctx, ck.x, ck.y, ck.w, ck.h, 16);
      ctx.fillStyle = PANEL;
      ctx.fill();
      // glareshield lip
      roundRect(ctx, ck.x, ck.y, ck.w, 8, 6);
      ctx.fillStyle = '#1b2327';
      ctx.fill();
      const vm = voltmeterAt(g);
      const tapped = clock - wiggleT < 0.6 && !rm ? Math.sin((clock - wiggleT) * 40) * (0.6 - (clock - wiggleT)) * 1.6 : 0;
      const green: [number, number] | undefined = teach ? (ac.volts === 28 ? [27, 29] : [13.3, 14.7]) : undefined;
      if (tb) {
        // the needle warns from 1000 °C, well before the red line
        const warn = nd.itt > m.ittLimit ? 2 : nd.itt >= 1000 && s.lit ? 1 : 0;
        gaugeDial({ x: g.gxs[0], y: g.gy }, g.gr, { max: 1200, val: nd.itt, step: 100, major: 400, fmt: (v) => String(v / 100), title: 'ITT °C ×100', short: 'ITT ×100', red: m.ittLimit, flash: warn });
        gaugeDial({ x: g.gxs[1], y: g.gy }, g.gr, { max: 110, val: nd.n1, step: 10, major: 20, smallEvery: 2, fmt: (v) => String(v), title: 'N1 %' });
      } else {
        gaugeDial({ x: g.gxs[1], y: g.gy }, g.gr, { max: 3000, val: nd.rpm, step: 250, major: 1000, fmt: (v) => String(v / 100), title: 'RPM ×100' });
      }
      // the ship's own voltmeter: 0-16 V on a 14 V system, 0-32 V on a 28 V one (28 V into a 14 V ship pegs it)
      const v14 = ac.volts === 14;
      gaugeDial(vm, g.gr, { max: v14 ? 16 : 32, val: nd.v + tapped * (v14 ? 0.5 : 1), step: v14 ? 1 : 2, major: v14 ? 4 : 8, title: 'VOLTS', green });
      if (reading && reading.at === 'ship' && clock < reading.until) {
        const bw = 58;
        const by = vm.y - g.gr - 2;
        roundRect(ctx, vm.x - bw / 2, by - 9, bw, 20, 10);
        ctx.fillStyle = C.sea;
        ctx.fill();
        tnum(ctx, reading.text, vm.x, by + 1, { size: 12, weight: 800, color: C.white, align: 'center' });
      }
      // switches
      toggle(g.ctl.batt, lever.batt, 'BATT', 'ON', 'OFF');
      toggle(g.ctl.alt, lever.alt, ac.gen, 'ON', 'OFF');
      toggle(g.ctl.avionics, lever.avionics, 'AVIONICS', 'ON', 'OFF');
      if (tb) {
        toggle(g.ctl.starter, lever.starter, 'STARTER', 'START', 'OFF');
        drawFuelLever(g.ctl.fuel, lever.fuel);
      } else {
        const c = g.ctl.starter;
        const down = s.starter ? 2 : 0;
        label(ctx, 'START', c.x, c.y - 33, { size: 10, weight: 800, color: 'rgba(251,245,233,.92)' });
        ctx.fillStyle = '#12181b';
        ctx.beginPath();
        ctx.arc(c.x, c.y + 3, 21, 0, Math.PI * 2);
        ctx.fill();
        const bg = ctx.createRadialGradient(c.x - 6, c.y - 6 + down, 2, c.x, c.y + down, 19);
        bg.addColorStop(0, s.starter ? '#e6ebed' : '#f4f6f7');
        bg.addColorStop(1, s.starter ? '#7f8b90' : '#a9b3b7');
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.arc(c.x, c.y + down, 18, 0, Math.PI * 2);
        ctx.fill();
        label(ctx, 'PUSH', c.x, c.y + down, { size: 9, weight: 900, color: C.ink });
        if (teach) label(ctx, 'hold', c.x, c.y + 30, { size: 8, weight: 800, color: 'rgba(251,245,233,.55)' });
      }
      if (guide && !finished) {
        const t = stepTarget();
        if (t === 'voltmeter') ring(vm, g.gr + 5);
        else if (t && t in g.ctl) ring(g.ctl[t as Ctl], 24);
      }
    }

    function drawFuelLever(c: P2, pos: number) {
      label(ctx, 'FUEL', c.x, c.y - 33, { size: 10, weight: 800, color: 'rgba(251,245,233,.92)' });
      label(ctx, 'LO IDLE', c.x, c.y - 21, { size: 8, weight: 800, color: pos > 0.5 ? C.paper : 'rgba(251,245,233,.5)' });
      label(ctx, 'CUTOFF', c.x, c.y + 26, { size: 8, weight: 800, color: pos < 0.5 ? C.paper : 'rgba(251,245,233,.5)' });
      roundRect(ctx, c.x - 4, c.y - 12, 8, 30, 4);
      ctx.fillStyle = '#0e1315';
      ctx.fill();
      const ky = lerp(c.y + 12, c.y - 8, pos);
      roundRect(ctx, c.x - 13, ky - 7, 26, 14, 5);
      ctx.fillStyle = '#e8e2d2';
      ctx.fill();
      ctx.strokeStyle = '#8e999e';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#9aa5a9';
      ctx.fillRect(c.x - 9, ky - 1, 18, 2);
    }

    function drawRamp(g: Geo) {
      const top = g.rampTop;
      // sky, sea, apron
      const sky = ctx.createLinearGradient(0, top, 0, g.horizon);
      sky.addColorStop(0, '#e9f1ef');
      sky.addColorStop(1, '#fbf5e9');
      ctx.fillStyle = sky;
      ctx.fillRect(0, top, g.w, g.horizon - top);
      ctx.fillStyle = C.seaLight;
      ctx.globalAlpha = 0.55;
      ctx.fillRect(0, g.horizon - 7, g.w, 7);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#6fa06f';
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.ellipse(g.w * 0.86, g.horizon - 6, 60, 7, 0, Math.PI, 0);
      ctx.fill();
      ctx.globalAlpha = 1;
      const ap = ctx.createLinearGradient(0, g.horizon, 0, g.h);
      ap.addColorStop(0, '#d8d3c6');
      ap.addColorStop(1, '#c4bfb2');
      ctx.fillStyle = ap;
      ctx.fillRect(0, g.horizon, g.w, g.h - g.horizon);
      // taxi line
      ctx.strokeStyle = 'rgba(244,211,94,.8)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, g.groundY + 10);
      ctx.lineTo(g.w, g.groundY + 4);
      ctx.stroke();
      drawAircraft(g);
    }

    function wheel(x: number, y: number, r: number) {
      ctx.fillStyle = '#2b3236';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#9aa5a9';
      ctx.beginPath();
      ctx.arc(x, y, r * 0.42, 0, Math.PI * 2);
      ctx.fill();
    }

    function prop(c: P2, len: number, blades: number) {
      const fast = tb ? s.n1 > 20 : s.rpm > 500;
      if (fast && !rm) {
        ctx.fillStyle = 'rgba(31,42,48,.12)';
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, 5, len, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = fast ? 'rgba(31,42,48,.25)' : '#2b3236';
      ctx.lineCap = 'round';
      ctx.lineWidth = 6;
      for (let b = 0; b < blades; b++) {
        const a = propA + (b / blades) * Math.PI * 2;
        const dy = Math.cos(a) * len;
        ctx.beginPath();
        ctx.moveTo(c.x + Math.sin(a) * 3, c.y);
        ctx.lineTo(c.x + Math.sin(a) * 4, c.y + dy);
        ctx.stroke();
      }
      ctx.fillStyle = '#dcd2bd';
      ctx.beginPath();
      ctx.ellipse(c.x + 4, c.y, 9, 11, 0, Math.PI * 0.5, Math.PI * 1.5);
      ctx.fill();
    }

    function drawAircraft(g: Geo) {
      // a running engine shakes the airframe a little; the catch shakes it more
      const kick = clamp(1 - (clock - fireT) / 0.4, 0, 1);
      const amp = rm ? 0 : kick * 2.2 + (s.running || s.lit ? (tb ? 0.25 : 0.6) : s.starter && s.rpm > 30 ? 0.35 : 0);
      ctx.save();
      if (amp > 0) ctx.translate(Math.sin(clock * 83) * amp, Math.cos(clock * 67) * amp * 0.6);
      drawAirframe(g);
      ctx.restore();
    }

    function drawAirframe(g: Geo) {
      const { fy, fh, w } = g;
      const top = fy - fh / 2;
      const bot = fy + fh / 2;
      const noseX = tb ? 26 : 30;
      const skin = '#f7f4ec';
      const fw0 = w * (tb ? 0.5 : 0.42); // firewall: where the cabin starts
      // wing root, seen side-on as an airfoil: on the cabin roof (high wing) or under the cabin (low wing)
      const chord = fh * 1.5;
      const wx = high ? fw0 + fh * 0.95 : fw0 - fh * 0.08;
      const wt = fh * (high ? 0.2 : 0.17);
      const roof = top - fh * 0.26;
      const wingPath = (x0: number, base: number, up: boolean) => {
        ctx.beginPath();
        if (up) {
          // flat-ish underside on the roof, cambered top
          ctx.moveTo(x0, base);
          ctx.quadraticCurveTo(x0 - wt * 0.35, base - wt * 0.75, x0 + chord * 0.22, base - wt);
          ctx.quadraticCurveTo(x0 + chord * 0.6, base - wt * 0.95, x0 + chord, base - wt * 0.12);
          ctx.lineTo(x0 + chord, base + 1);
        } else {
          ctx.moveTo(x0, base);
          ctx.quadraticCurveTo(x0, base - wt * 0.9, x0 + chord * 0.3, base - wt);
          ctx.lineTo(x0 + chord, base - wt * 0.25);
          ctx.lineTo(x0 + chord, base + wt * 0.12);
          ctx.quadraticCurveTo(x0 + chord * 0.2, base + wt * 0.4, x0, base);
        }
        ctx.closePath();
      };
      // shadow
      ctx.fillStyle = 'rgba(31,42,48,.1)';
      ctx.beginPath();
      ctx.ellipse(w * 0.6, g.groundY + 2, w * 0.42, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      // gear legs + wheels (a low wing hangs its mains from the wing); an amphibian stands on its float wheels
      if (ac.floats) drawFloat(g, noseX, bot);
      else {
        const nwX = w * (tb ? 0.2 : 0.18);
        const mwX = high ? w * 0.74 : wx + chord * 0.55;
        const wr = clamp(fh * 0.17, 8, 14);
        ctx.strokeStyle = '#56646b';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(nwX, bot - 4);
        ctx.lineTo(nwX, g.groundY - wr);
        ctx.moveTo(mwX, bot - 4);
        ctx.lineTo(mwX + 10, g.groundY - wr);
        ctx.stroke();
        wheel(nwX, g.groundY - wr, wr);
        wheel(mwX + 10, g.groundY - wr, wr * 1.15);
      }
      // fuselage
      ctx.fillStyle = skin;
      ctx.beginPath();
      ctx.moveTo(noseX, fy - fh * 0.18);
      ctx.quadraticCurveTo(noseX + 2, top + fh * 0.08, noseX + 26, top + fh * 0.06);
      ctx.lineTo(fw0, top + fh * 0.04);
      ctx.quadraticCurveTo(fw0 + fh * 0.5, top - fh * 0.22, fw0 + fh * 1.1, roof);
      ctx.lineTo(w + 10, roof);
      ctx.lineTo(w + 10, bot);
      ctx.lineTo(noseX + 30, bot);
      ctx.quadraticCurveTo(noseX, bot - 2, noseX, fy + fh * 0.2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(31,42,48,.35)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      // cheat line
      ctx.fillStyle = C.sea;
      ctx.fillRect(fw0, fy + fh * 0.28, w - fw0, fh * 0.07);
      ctx.fillStyle = C.mech;
      ctx.fillRect(fw0, fy + fh * 0.37, w - fw0, fh * 0.03);
      // windows
      ctx.fillStyle = '#3d5560';
      const wy = top - fh * 0.16;
      const wh = fh * 0.3;
      for (const f of tb ? [0.66, 0.8, 0.94] : [0.6, 0.75, 0.9]) {
        roundRect(ctx, w * f - fh * 0.2, wy + 2, fh * 0.34, wh, 5);
        ctx.fill();
      }
      // cowling panel lines (firewall + cowl split) and the nose air inlet
      ctx.strokeStyle = 'rgba(31,42,48,.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(fw0, top + 4);
      ctx.lineTo(fw0, bot - 2);
      ctx.moveTo(noseX + 22, fy - fh * 0.04);
      ctx.lineTo(fw0, fy - fh * 0.04);
      ctx.stroke();
      ctx.fillStyle = '#2b3236';
      roundRect(ctx, noseX + 4, fy + fh * 0.16, tb ? 22 : 16, 9, 4.5);
      ctx.fill();
      // rivet rows
      ctx.fillStyle = 'rgba(31,42,48,.22)';
      for (let x = noseX + 30; x < fw0 - 4; x += 9) {
        ctx.beginPath();
        ctx.arc(x, fy - fh * 0.04 - 3, 0.9, 0, Math.PI * 2);
        ctx.fill();
      }
      // the wing
      const wg = ctx.createLinearGradient(0, high ? roof - wt : bot - wt, 0, high ? roof : bot + wt * 0.4);
      wg.addColorStop(0, '#fbf9f3');
      wg.addColorStop(1, '#ddd7c8');
      ctx.fillStyle = wg;
      if (high) {
        wingPath(wx, roof, true);
        ctx.fill();
        ctx.strokeStyle = 'rgba(31,42,48,.35)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        // the wing's shadow on the roof
        ctx.fillStyle = 'rgba(31,42,48,.12)';
        ctx.fillRect(wx + 2, roof + 1, chord - 4, 3);
        // lift strut: lower fuselage up to the wing
        ctx.strokeStyle = '#b9b3a4';
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(wx + chord * 0.5, bot - fh * 0.08);
        ctx.lineTo(wx + chord * 0.3, roof + 2);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(31,42,48,.25)';
        ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        // the root hangs below the belly line, as on a low wing seen from the side
        const wb = bot + wt * 0.3;
        wingPath(wx, wb, false);
        ctx.fill();
        ctx.strokeStyle = 'rgba(31,42,48,.35)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        // walkway on the wing root
        ctx.fillStyle = 'rgba(31,42,48,.18)';
        ctx.beginPath();
        ctx.moveTo(wx + chord * 0.3, wb - wt * 0.98);
        ctx.lineTo(wx + chord * 0.62, wb - wt * 0.7);
        ctx.lineTo(wx + chord * 0.62, wb - wt * 0.5);
        ctx.lineTo(wx + chord * 0.3, wb - wt * 0.78);
        ctx.fill();
      }
      prop({ x: noseX - 4, y: fy - fh * 0.02 }, fh * (tb ? 0.8 : 0.72), tb ? 3 : 2);
      if (tb) {
        // exhaust stack on the side of the nose, with heat or flame
        const ex = w * 0.34;
        const ey = fy - fh * 0.2;
        ctx.strokeStyle = '#56646b';
        ctx.lineWidth = 11;
        ctx.lineCap = 'butt';
        ctx.beginPath();
        ctx.moveTo(ex - 10, ey + 16);
        ctx.quadraticCurveTo(ex - 6, ey + 2, ex + 2, ey - 2);
        ctx.stroke();
        ctx.lineCap = 'round';
        ctx.fillStyle = '#12181b';
        ctx.beginPath();
        ctx.ellipse(ex + 2, ey - 2, 4, 6.5, -0.5, 0, Math.PI * 2);
        ctx.fill();
        if (s.lit) {
          // torching: too much fuel for the air (fuel in early, a relight into residual
          // fuel) flames at light-off; any start flames once it runs toward the red line
          const sinceLight = s.t - s.fuelAt - m.lightDelay;
          const wet = s.running ? 0 : clamp((s.rich - 1) * 3.5, 0, 1.4) * clamp(1 - sinceLight / 6, 0.25, 1);
          const hot = Math.max(wet, clamp((nd.itt - 1000) / 110, 0, 1.4));
          if (hot > 0.05) {
            const fl = (0.6 + 0.4 * Math.sin(clock * 30)) * hot * 1.4;
            ctx.fillStyle = C.rust;
            ctx.globalAlpha = 0.85;
            ctx.beginPath();
            ctx.moveTo(ex - 5, ey - 3);
            ctx.quadraticCurveTo(ex + 20 * fl, ey - 30 * fl - 6, ex + 34 * fl + 4, ey - 12);
            ctx.quadraticCurveTo(ex + 14, ey + 2, ex + 5, ey + 3);
            ctx.fill();
            ctx.fillStyle = C.mech;
            ctx.beginPath();
            ctx.moveTo(ex - 3, ey - 2);
            ctx.quadraticCurveTo(ex + 10 * fl, ey - 16 * fl - 3, ex + 18 * fl + 2, ey - 8);
            ctx.quadraticCurveTo(ex + 8, ey + 1, ex + 3, ey + 2);
            ctx.fill();
            ctx.globalAlpha = 1;
          }
          if (!rm) {
            // heat shimmer
            ctx.strokeStyle = 'rgba(86,100,107,.35)';
            ctx.lineWidth = 1.5;
            for (let k = 0; k < 3; k++) {
              const ph = (clock * 1.6 + k / 3) % 1;
              ctx.beginPath();
              for (let i = 0; i <= 10; i++) {
                const t = i / 10;
                const x = ex + 4 + t * 50 * (0.4 + ph);
                const y = ey - 8 - t * 26 * (0.4 + ph) + Math.sin(t * 9 + clock * 12 + k) * 2.5;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
              }
              ctx.stroke();
            }
          }
        } else if (s.wet > 0.25 && s.n1 > 8 && !rm) {
          // dry motoring blows the residual fuel out as white vapour
          ctx.fillStyle = `rgba(150,158,162,${0.55 * clamp(s.wet, 0, 1)})`;
          for (let k = 0; k < 3; k++) {
            const ph = (clock * 1.4 + k / 3) % 1;
            ctx.beginPath();
            ctx.arc(ex + 6 + ph * 34, ey - 6 - ph * 18, 4 + ph * 9, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      } else {
        // exhaust pipe under the cowling
        const ex = w * 0.22;
        ctx.strokeStyle = '#56646b';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(ex - 6, bot - 4);
        ctx.lineTo(ex, bot + 6);
        ctx.stroke();
      }
      // external power receptacle: open door + three pins
      const r = g.rec;
      // access door swung up on its hinge
      ctx.fillStyle = '#e6e0d2';
      ctx.beginPath();
      ctx.moveTo(r.x - 23, r.y - 19);
      ctx.lineTo(r.x + 23, r.y - 19);
      ctx.lineTo(r.x + 27, r.y - 31);
      ctx.lineTo(r.x - 19, r.y - 31);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(31,42,48,.4)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = 'rgba(31,42,48,.12)';
      ctx.fillRect(r.x - 21, r.y - 22, 44, 3);
      roundRect(ctx, r.x - 24, r.y - 19, 48, 38, 6);
      ctx.fillStyle = '#b9c1c4';
      ctx.fill();
      roundRect(ctx, r.x - 21, r.y - 16, 42, 32, 5);
      ctx.fillStyle = '#1b2226';
      ctx.fill();
      ctx.fillStyle = METAL;
      ctx.beginPath();
      ctx.arc(r.x - 9, r.y - 4, 4.5, 0, Math.PI * 2);
      ctx.arc(r.x + 9, r.y - 4, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(r.x, r.y + 9, 2.6, 0, Math.PI * 2);
      ctx.fill();
      if (pitted) {
        // arc damage: burnt, pitted main pins
        ctx.fillStyle = '#5a4034';
        for (const [x, y] of [
          [r.x - 10, r.y - 5],
          [r.x - 7, r.y - 2],
          [r.x + 8, r.y - 6],
          [r.x + 11, r.y - 3],
        ]) {
          ctx.beginPath();
          ctx.arc(x, y, 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.strokeStyle = 'rgba(40,30,25,.55)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(r.x - 9, r.y - 4, 6.5, 0, Math.PI * 2);
        ctx.moveTo(r.x + 15.5, r.y - 4);
        ctx.arc(r.x + 9, r.y - 4, 6.5, 0, Math.PI * 2);
        ctx.stroke();
      }
      // tiny placard plate beside it, then the magnified callout in the sky
      const tag = { x: r.x + 26, y: r.y - 8, w: 16, h: 12 };
      roundRect(ctx, tag.x, tag.y, tag.w, tag.h, 2);
      ctx.fillStyle = '#b9c1c4';
      ctx.fill();
      drawPlacard(g, tag);
    }

    /**
     * The amphibian's near float, seen from the side: an upswept bow, the long
     * forebody, the step, the afterbody rising to the stern; struts up to the
     * fuselage, and its retractable wheels down for the ramp (a nose wheel near
     * the bow, a main wheel just aft of the step).
     */
    function drawFloat(g: Geo, noseX: number, bot: number) {
      const { w } = g;
      const legs = g.groundY - bot;
      const wr = clamp(legs * 0.2, 4, 8);
      const keel = g.groundY - wr * 1.6;
      const deck = bot + Math.max(4, legs * 0.22);
      const h = Math.max(6, keel - deck);
      const x0 = noseX + 2;
      const x1 = w * 0.95;
      const step = x0 + (x1 - x0) * 0.5;
      ctx.lineCap = 'round';
      // struts from the fuselage down to the float
      ctx.strokeStyle = '#b9b3a4';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      for (const f of [0.3, 0.6]) {
        ctx.moveTo(w * f, bot - 2);
        ctx.lineTo(w * f + 6, deck + 1);
      }
      ctx.stroke();
      // the wheels, down, on short legs out of the keel
      const nx = x0 + h * 1.7;
      const mx = step + 10;
      ctx.strokeStyle = '#56646b';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(nx, keel - 2);
      ctx.lineTo(nx, g.groundY - wr);
      ctx.moveTo(mx - 2, keel - 2);
      ctx.lineTo(mx, g.groundY - wr);
      ctx.stroke();
      wheel(nx, g.groundY - wr, wr);
      wheel(mx, g.groundY - wr, wr * 1.1);
      // the float
      ctx.beginPath();
      ctx.moveTo(x0, deck + h * 0.12);
      ctx.quadraticCurveTo(x0 + h * 0.4, deck - h * 0.08, x0 + h * 1.4, deck);
      ctx.lineTo(x1 - h * 0.8, deck + h * 0.04);
      ctx.quadraticCurveTo(x1, deck + h * 0.08, x1, deck + h * 0.34);
      ctx.lineTo(step + 3, keel - h * 0.18);
      ctx.lineTo(step, keel - h * 0.18);
      ctx.lineTo(step, keel);
      ctx.lineTo(x0 + h * 1.3, keel);
      ctx.quadraticCurveTo(x0 + h * 0.15, keel, x0, deck + h * 0.12);
      ctx.closePath();
      const fg = ctx.createLinearGradient(0, deck, 0, keel);
      fg.addColorStop(0, '#f4f0e6');
      fg.addColorStop(1, '#d6cfbd');
      ctx.fillStyle = fg;
      ctx.fill();
      ctx.strokeStyle = 'rgba(31,42,48,.4)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      // a painted stripe along the forebody, and the step's shadow
      ctx.fillStyle = 'rgba(46,124,147,.6)';
      ctx.fillRect(x0 + h * 1.3, deck + h * 0.42, step - x0 - h * 1.3, Math.max(1.5, h * 0.12));
      ctx.fillStyle = 'rgba(31,42,48,.18)';
      ctx.fillRect(step - 1, keel - h * 0.18, 3, h * 0.18);
    }

    function drawPlacard(g: Geo, tag: Rect) {
      const P = g.placard;
      ctx.strokeStyle = 'rgba(31,42,48,.35)';
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(tag.x + tag.w, tag.y);
      ctx.lineTo(P.x + 10, P.y + P.h);
      ctx.stroke();
      ctx.setLineDash([]);
      const pg = ctx.createLinearGradient(P.x, P.y, P.x + P.w, P.y + P.h);
      pg.addColorStop(0, '#e4e8ea');
      pg.addColorStop(1, '#b7bfc3');
      roundRect(ctx, P.x, P.y, P.w, P.h, 6);
      ctx.fillStyle = pg;
      ctx.fill();
      ctx.strokeStyle = '#7f8b90';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#7f8b90';
      for (const [x, y] of [
        [P.x + 5, P.y + 5],
        [P.x + P.w - 5, P.y + 5],
        [P.x + 5, P.y + P.h - 5],
        [P.x + P.w - 5, P.y + P.h - 5],
      ]) {
        ctx.beginPath();
        ctx.arc(x, y, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
      const batt = tb ? 'BATTERY SWITCH ON' : `BATTERY MASTER ${ac.master === 'on' ? 'ON' : 'OFF'}`;
      const main = tb ? `${ac.volts} V DC · ${ac.ampMax} A MAX` : `${ac.volts} VOLTS DC`;
      // a short ramp gets the two-line plate
      const lines: [string, number, number][] =
        P.h >= 44
          ? [
              ['EXTERNAL POWER', 9, 800],
              [main, tb ? 13 : 15, 900],
              [batt, 9, 800],
            ]
          : [
              [tb ? main : `EXT POWER ${main}`, 12, 900],
              [batt, 9, 800],
            ];
      const gap = P.h / (lines.length + 0.3);
      lines.forEach(([t, size, weight], i) => fitLabel(ctx, t, P.x + P.w / 2, P.y + P.h / 2 + (i - (lines.length - 1) / 2) * gap, P.w - 14, { size, weight, color: C.ink }));
    }

    function drawCart(g: Geo) {
      // the cart shudders when the starter loads it up
      const hum = rm || !s.cartOn ? 0 : s.amps > 100 ? 0.9 : 0.2;
      ctx.save();
      if (hum) ctx.translate(Math.sin(clock * 97) * hum, Math.cos(clock * 71) * hum * 0.5);
      drawCartBody(g);
      ctx.restore();
    }

    function drawCartBody(g: Geo) {
      const c = g.cart;
      // wheels
      wheel(c.x + 30, c.y + c.h - 2, 12);
      wheel(c.x + c.w - 30, c.y + c.h - 2, 12);
      const body = ctx.createLinearGradient(0, c.y, 0, c.y + c.h);
      body.addColorStop(0, shade(C.mech, 0.12));
      body.addColorStop(1, shade(C.mech, -0.12));
      roundRect(ctx, c.x, c.y, c.w, c.h - 10, 14);
      ctx.fillStyle = body;
      ctx.fill();
      ctx.strokeStyle = shade(C.mech, -0.35);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // louvres
      ctx.strokeStyle = shade(C.mech, -0.22);
      ctx.lineWidth = 2;
      for (let i = 0; i < 5; i++) {
        const x = c.x + c.w - 30 - i * 9;
        ctx.beginPath();
        ctx.moveTo(x, c.y + 8);
        ctx.lineTo(x, c.y + 24);
        ctx.stroke();
      }
      label(ctx, 'GROUND POWER', c.x + 110, c.y + 17, { size: 11, weight: 900, color: shade(C.mech, -0.55), align: 'left' });
      // the battery's state of charge, as the cart's LED bar shows it: right-aligned before the
      // louvres, the percentage dropped first when the cart is narrow
      const right = c.x + c.w - 74;
      const titleEnd = c.x + 208;
      const withText = right - 30 - 38 > titleEnd;
      const bx = withText ? right - 30 - 38 : right - 36;
      if (bx > titleEnd) {
        const lit = Math.max(1, Math.round(m.charge * 5));
        // the cart's own LEDs (not the game's verdict colours)
        const tone = m.charge < 0.3 ? '#FF5A3C' : m.charge < 0.6 ? '#FFB02E' : '#5BE07A';
        roundRect(ctx, bx - 2, c.y + 9, 36, 14, 3);
        ctx.fillStyle = PANEL;
        ctx.fill();
        for (let i = 0; i < 5; i++) {
          ctx.fillStyle = i < lit ? tone : 'rgba(251,245,233,.18)';
          ctx.fillRect(bx + 1 + i * 6.4, c.y + 12, 4.6, 8);
        }
        if (withText) tnum(ctx, `${Math.round(m.charge * 100)}%`, right, c.y + 17, { size: 10, weight: 900, color: shade(C.mech, -0.55), align: 'right' });
      }
      // control panel
      const P = g.panel;
      roundRect(ctx, P.x, P.y, P.w, P.h, 10);
      ctx.fillStyle = PANEL;
      ctx.fill();
      // output voltmeter and ammeter (edgewise), or the digital meter; lamp at the end of the row
      const vTap = clock - cartTapT < 0.6 && !rm ? Math.sin((clock - cartTapT) * 40) * (0.6 - (clock - cartTapT)) * 1.2 : 0;
      edgewise(g.vMeter, 'V', 40, 2, 10, nd.cv + vTap, m.meter ? `${cartOut(s).toFixed(1)} V` : null);
      edgewise(g.aMeter, 'A', 1500, 100, 500, nd.amps, m.meter ? `${Math.round(s.amps)} A` : null);
      if (reading && reading.at === 'cart' && clock < reading.until) {
        const R = g.vMeter;
        roundRect(ctx, R.x + R.w / 2 - 30, R.y, 60, R.h, 10);
        ctx.fillStyle = C.sea;
        ctx.fill();
        tnum(ctx, reading.text, R.x + R.w / 2, R.y + R.h / 2 + 1, { size: 12, weight: 800, color: C.white, align: 'center' });
      }
      // output lamp
      const lampP = { x: P.x + P.w - 18, y: g.vMeter.y + g.vMeter.h / 2 };
      if (s.cartOn) {
        const gl = ctx.createRadialGradient(lampP.x, lampP.y, 1, lampP.x, lampP.y, 16);
        gl.addColorStop(0, 'rgba(244,211,94,.7)');
        gl.addColorStop(1, 'rgba(244,211,94,0)');
        ctx.fillStyle = gl;
        ctx.beginPath();
        ctx.arc(lampP.x, lampP.y, 16, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = s.cartOn ? LAMP : '#5b5a4c';
      ctx.beginPath();
      ctx.arc(lampP.x, lampP.y, 6.5, 0, Math.PI * 2);
      ctx.fill();
      // output selector (chicken-head)
      const V = g.volts;
      const kr = g.kr;
      const aOf = (k: number) => lerp(-Math.PI * 0.75, -Math.PI * 0.25, k);
      for (const [k, t] of [
        [0, '14'],
        [1, '28'],
      ] as [number, string][]) {
        const a = aOf(k);
        const on = (s.cartV === 28 ? 1 : 0) === k;
        ctx.strokeStyle = on ? C.paper : 'rgba(251,245,233,.45)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(V.x + Math.cos(a) * (kr + 2), V.y + Math.sin(a) * (kr + 2));
        ctx.lineTo(V.x + Math.cos(a) * (kr + 7), V.y + Math.sin(a) * (kr + 7));
        ctx.stroke();
        label(ctx, t, V.x + Math.cos(a) * (kr + 17), V.y + Math.sin(a) * (kr + 15), { size: 13, weight: 900, color: on ? C.paper : 'rgba(251,245,233,.5)' });
      }
      ctx.fillStyle = '#12181b';
      ctx.beginPath();
      ctx.arc(V.x, V.y, kr, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.translate(V.x, V.y);
      ctx.rotate(aOf(sel) + Math.PI / 2);
      roundRect(ctx, -8, -kr + 2, 16, kr * 2 - 4, 8);
      ctx.fillStyle = '#3b464b';
      ctx.fill();
      ctx.fillStyle = C.paper;
      ctx.beginPath();
      ctx.moveTo(0, -kr + 4);
      ctx.lineTo(4, -kr + 14);
      ctx.lineTo(-4, -kr + 14);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      label(ctx, 'OUTPUT V', V.x, V.y + kr + 13, { size: 9, weight: 900, color: 'rgba(251,245,233,.75)' });
      // current limit knob with its scale
      const A = g.amps;
      const ar = kr + 2;
      ctx.strokeStyle = 'rgba(251,245,233,.6)';
      for (let v = 0; v <= AMP_KNOB.max; v += 100) {
        const a = knobAngle(v);
        const major = v % 400 === 0;
        ctx.lineWidth = major ? 1.8 : 1;
        ctx.beginPath();
        ctx.moveTo(A.x + Math.cos(a) * (ar + 3), A.y + Math.sin(a) * (ar + 3));
        ctx.lineTo(A.x + Math.cos(a) * (ar + (major ? 9 : 6)), A.y + Math.sin(a) * (ar + (major ? 9 : 6)));
        ctx.stroke();
        if (major) label(ctx, String(v), A.x + Math.cos(a) * (ar + 19), A.y + Math.sin(a) * (ar + 17), { size: 9, weight: 800, color: 'rgba(251,245,233,.8)' });
      }
      ctx.save();
      ctx.translate(A.x, A.y);
      ctx.rotate(knobAngle(s.cartA));
      const kg = ctx.createRadialGradient(-ar * 0.3, -ar * 0.3, 2, 0, 0, ar);
      kg.addColorStop(0, '#4d585d');
      kg.addColorStop(1, '#161c1f');
      ctx.fillStyle = kg;
      ctx.beginPath();
      ctx.arc(0, 0, ar, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#0b0f11';
      ctx.lineWidth = 2;
      for (let k = 0; k < 28; k++) {
        const a = (k / 28) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * ar * 0.84, Math.sin(a) * ar * 0.84);
        ctx.lineTo(Math.cos(a) * ar, Math.sin(a) * ar);
        ctx.stroke();
      }
      ctx.strokeStyle = C.paper;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(ar * 0.2, 0);
      ctx.lineTo(ar * 0.8, 0);
      ctx.stroke();
      ctx.restore();
      label(ctx, 'LIMIT A', A.x, A.y + ar + 13, { size: 9, weight: 900, color: 'rgba(251,245,233,.75)' });
      if (drag && drag.kind === 'amps') {
        roundRect(ctx, A.x - 30, A.y - 9, 60, 18, 9);
        ctx.fillStyle = 'rgba(18,24,27,.85)';
        ctx.fill();
        tnum(ctx, `${s.cartA} A`, A.x, A.y + 1, { size: 11, weight: 800, color: C.paper, align: 'center' });
      }
      // output switch
      toggle(g.cartSw, lever.cart, 'OUTPUT', 'ON', 'OFF', 1.25);
      if (guide && !finished) {
        const t = stepTarget();
        if (t === 'cartMeter') ringRect(g.vMeter);
        if (t === 'volts') ring(V, kr + 6);
        if (t === 'amps') ring(A, ar + 6);
        if (t === 'cartSw') ring(g.cartSw, 30);
      }
    }

    function drawPlugAndCable(g: Geo) {
      const pp = plugPos(g);
      const inAc = s.plug !== 'stowed';
      const o = g.outlet;
      // cable: a heavy sagging run from the cart outlet to the back of the plug
      const end = inAc ? { x: pp.x, y: pp.y + 14 } : { x: pp.x, y: pp.y + 20 };
      const d = Math.hypot(end.x - o.x, end.y - o.y);
      const sag = inAc || (drag && drag.kind === 'plug') ? clamp(90 - d * 0.25, 18, 70) : 26;
      const tgt = { x: (o.x + end.x) / 2 - 14, y: Math.max(o.y, end.y) + sag };
      // the heavy cable swings a little behind the plug
      if (!cable.init || rm) {
        cable.x = tgt.x;
        cable.y = tgt.y;
        cable.init = true;
      } else {
        const dt = Math.min(frameDt, 0.05);
        cable.vx += ((tgt.x - cable.x) * 70 - cable.vx * 7) * dt;
        cable.vy += ((tgt.y - cable.y) * 70 - cable.vy * 7) * dt;
        cable.x += cable.vx * dt;
        cable.y += cable.vy * dt;
      }
      const mid = { x: cable.x, y: cable.y };
      const path = () => {
        ctx.beginPath();
        ctx.moveTo(o.x, o.y);
        ctx.quadraticCurveTo(mid.x, mid.y, end.x, end.y);
      };
      ctx.lineCap = 'round';
      ctx.strokeStyle = CABLE;
      ctx.lineWidth = 9;
      path();
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.14)';
      ctx.lineWidth = 2;
      path();
      ctx.stroke();
      // outlet gland
      ctx.fillStyle = '#3b464b';
      ctx.beginPath();
      ctx.arc(o.x, o.y, 8, 0, Math.PI * 2);
      ctx.fill();
      if (inAc) {
        // end-on: the plug's back face over the receptacle
        const partial = s.plug === 'partial';
        ctx.save();
        ctx.translate(pp.x, pp.y);
        if (partial) ctx.rotate(0.16);
        const pw = partial ? 42 : 38;
        const ph = partial ? 34 : 30;
        if (partial) {
          // the gap: pins showing between plug and skin
          ctx.fillStyle = 'rgba(0,0,0,.35)';
          roundRect(ctx, -pw / 2 - 3, -ph / 2 - 3, pw + 6, ph + 6, 7);
          ctx.fill();
        }
        roundRect(ctx, -pw / 2, -ph / 2, pw, ph, 6);
        const pg = ctx.createLinearGradient(0, -ph / 2, 0, ph / 2);
        pg.addColorStop(0, '#4b555a');
        pg.addColorStop(1, '#1b2226');
        ctx.fillStyle = pg;
        ctx.fill();
        ctx.strokeStyle = partial ? 'rgba(251,245,233,.35)' : 'rgba(0,0,0,.5)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.fillStyle = '#2b3236';
        ctx.beginPath();
        ctx.arc(0, 4, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        const seatedFlash = !blind && clock - seatedT < 0.5 && s.plug === 'seated';
        if (seatedFlash) {
          ctx.strokeStyle = C.palm;
          ctx.lineWidth = 3;
          ctx.globalAlpha = 1 - (clock - seatedT) / 0.5;
          roundRect(ctx, pp.x - 24, pp.y - 20, 48, 40, 8);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        if (partial && ticks) {
          roundRect(ctx, pp.x - 38, pp.y + 22, 76, 18, 9);
          ctx.fillStyle = C.paper;
          ctx.fill();
          label(ctx, 'not seated', pp.x, pp.y + 31, { size: 11, weight: 800, color: C.rust });
        }
      } else {
        // side view on the holster (or in the hand): pins up
        const x = pp.x;
        const y = pp.y;
        ctx.fillStyle = METAL;
        ctx.fillRect(x - 11, y - 25, 6, 8);
        ctx.fillRect(x + 5, y - 25, 6, 8);
        ctx.fillRect(x - 2, y - 22, 4, 5);
        roundRect(ctx, x - 16, y - 18, 32, 40, 6);
        const pg = ctx.createLinearGradient(x - 16, 0, x + 16, 0);
        pg.addColorStop(0, '#1b2226');
        pg.addColorStop(0.5, '#4b555a');
        pg.addColorStop(1, '#1b2226');
        ctx.fillStyle = pg;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.12)';
        ctx.lineWidth = 1;
        for (let i = 0; i < 4; i++) {
          ctx.beginPath();
          ctx.moveTo(x - 12, y - 4 + i * 5);
          ctx.lineTo(x + 12, y - 4 + i * 5);
          ctx.stroke();
        }
        if (drag && drag.kind === 'plug' && drag.moved && near(g.rec, pp.x, pp.y, 46)) {
          ctx.strokeStyle = C.seaLight;
          ctx.lineWidth = 3;
          roundRect(ctx, g.rec.x - 26, g.rec.y - 21, 52, 42, 8);
          ctx.stroke();
        }
      }
      // the holster cup on the cart's top edge
      const hx = g.holster.x;
      const hy = g.cart.y;
      roundRect(ctx, hx - 21, hy - 12, 42, 14, 5);
      ctx.fillStyle = '#3b464b';
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.12)';
      ctx.fillRect(hx - 17, hy - 10, 34, 2);
      if (guide && !finished && stepTarget() === 'plug') ring(pp, 30);
    }

    function drawHeader(g: Geo) {
      const showToast = toast.until > clock;
      if (ticks) {
        const cur = curStep();
        const idx = cur ? m.steps.indexOf(cur) + 1 : m.steps.length;
        const head = `CHECKLIST ${idx}/${m.steps.length}`;
        label(ctx, head, 14, 14, { size: 10, weight: 900, color: C.inkSoft, align: 'left' });
        const x0 = 14 + ctx.measureText(head).width + 10;
        // progress ticks
        const n = m.steps.length;
        const dw = Math.min(10, (g.w - 84 - x0) / n);
        for (let i = 0; i < n; i++) {
          const ok = stepDone(s, m.steps[i].id);
          ctx.fillStyle = ok ? C.palm : i === idx - 1 ? C.seaLight : 'rgba(31,42,48,.18)';
          roundRect(ctx, x0 + i * dw, 10, dw - 3, 8, 3);
          ctx.fill();
        }
        roundRect(ctx, g.w - 72, 6, 62, 36, 12);
        ctx.fillStyle = 'rgba(31,42,48,.08)';
        ctx.fill();
        label(ctx, 'list ☰', g.w - 41, 24, { size: 12, weight: 800, color: C.seaDeep });
        const txt = showToast ? toast.text : cur ? cur.text : 'All items done';
        fitLabel(ctx, txt, 14, 36, g.w - 96, { size: 15, weight: 800, color: showToast ? (toast.bad ? C.rust : C.seaDeep) : C.ink, align: 'left' });
      } else {
        // blind with the printed checklist: the card is there (list ☰), it just doesn't tick
        const room = teach ? g.w - 96 : g.w - 28;
        if (teach) {
          roundRect(ctx, g.w - 72, 6, 62, 36, 12);
          ctx.fillStyle = 'rgba(31,42,48,.08)';
          ctx.fill();
          label(ctx, 'list ☰', g.w - 41, 24, { size: 12, weight: 800, color: C.seaDeep });
        }
        fitLabel(ctx, tb && !p.context?.plane ? 'Turbine start on ground power' : `${ac.name}: ground power start`, 14, 16, room, { size: 15, weight: 800, align: 'left' });
        const sub = showToast ? toast.text : s.everRunning ? 'Running. Finish the job' : teach ? 'Checklist on the card: list ☰' : 'No checklist on the ramp: from memory';
        fitLabel(ctx, sub, 14, 37, room, { size: 12, weight: showToast ? 800 : 600, color: showToast ? (toast.bad ? C.rust : C.seaDeep) : C.inkSoft, align: 'left' });
      }
    }

    function drawList(g: Geo) {
      const x = 14;
      const y = g.head + 4;
      const w = g.w - 28;
      const rowH = 27;
      const h = m.steps.length * rowH + 66;
      ctx.fillStyle = 'rgba(31,42,48,.35)';
      ctx.fillRect(0, 0, g.w, g.h);
      roundRect(ctx, x, y, w, h, 16);
      ctx.fillStyle = C.paper;
      ctx.fill();
      label(ctx, `External power start · ${ac.name}`, x + 16, y + 20, { size: 13, weight: 900, align: 'left' });
      const cur = ticks ? curStep() : undefined;
      m.steps.forEach((it, i) => {
        const ry = y + 44 + i * rowH;
        const ok = ticks && stepDone(s, it.id);
        const isCur = cur && cur.id === it.id;
        if (isCur) {
          roundRect(ctx, x + 8, ry - 2, w - 16, rowH - 2, 8);
          ctx.fillStyle = 'rgba(46,124,147,.12)';
          ctx.fill();
        }
        label(ctx, ok ? '✓' : String(i + 1), x + 26, ry + rowH / 2 - 3, { size: 12, weight: 900, color: ok ? C.palm : C.inkSoft });
        fitLabel(ctx, it.text, x + 44, ry + rowH / 2 - 3, w - 60, { size: 13, weight: isCur ? 800 : 600, color: ok ? C.inkSoft : C.ink, align: 'left' });
      });
      label(ctx, 'tap anywhere to close', g.w / 2, y + h - 14, { size: 11, weight: 700, color: C.inkSoft });
    }

    function draw(g: Geo) {
      backdrop(ctx, g.w, g.h);
      drawRamp(g);
      drawCart(g);
      drawPlugAndCable(g);
      drawCockpit(g);
      drawHeader(g);
      // arc flash + sparks
      if (clock - arcT < 0.25) {
        ctx.fillStyle = `rgba(255,255,255,${0.6 * (1 - (clock - arcT) / 0.25)})`;
        ctx.beginPath();
        ctx.arc(g.rec.x, g.rec.y, 40, 0, Math.PI * 2);
        ctx.fill();
      }
      for (const sp of sparks) {
        ctx.strokeStyle = sp.life > 0.25 ? LAMP : C.mech;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y);
        ctx.lineTo(sp.x - sp.vx * 0.02, sp.y - sp.vy * 0.02);
        ctx.stroke();
      }
      for (const pf of puffs) {
        const k = pf.life / pf.max;
        ctx.fillStyle = pf.dark ? `rgba(60,66,70,${0.45 * (1 - k)})` : `rgba(120,126,130,${0.22 * (1 - k)})`;
        ctx.beginPath();
        ctx.arc(pf.x, pf.y, pf.r, 0, Math.PI * 2);
        ctx.fill();
      }
      if (listOpen) drawList(g);
      if (flourishT >= 0) {
        const k = clamp((clock - flourishT) / 0.8, 0, 1);
        if (k < 1) {
          ctx.globalAlpha = 0.3 * (1 - ease.outCubic(k));
          ctx.fillStyle = C.white;
          ctx.fillRect(0, 0, g.w, g.h);
          ctx.globalAlpha = 1;
        }
      }
    }

    return {
      timeUp(): PuzzleResult {
        finished = true;
        const sc = scoreGpu(s);
        return result(sc.score, sc.summary, dataOf());
      },
      destroy() {
        stop();
        offPtr();
        st.destroy();
      },
    };
  },
};
