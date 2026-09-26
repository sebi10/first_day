// Mechanic · Ground power start. Start an aircraft off a ground power cart
// (GPU) the way the flight manual says: read the external-power placard, set
// the cart to match, avionics master OFF, battery master as placarded, plug in
// fully seated, cart ON, check the bus on the voltmeter, start; then cart OFF,
// unplug, alternator ON, avionics ON. A turbine (tiers 4-5) also needs the
// cart's current limit set to the placard, fuel in at 12% N1 and an eye on ITT:
// a weak, slow start runs hot and must be aborted with the fuel lever.
// Tiers 0-2 print the checklist; from tier 3 it is done from memory, as on the ramp.
import { hashSeed, rng } from '../sim/rng';
import { C, backdrop, clamp, ease, fitLabel, label, lerp, loop, markInput, pointer, roundRect, settle, shade, stage, tnum } from './kit';
import { result, type PuzzleDef, type PuzzleResult } from './types';

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export type GpuKind = 'piston' | 'turbine';

export type GpuAircraft = {
  id: 'single28' | 'single14' | 'twin28' | 'twin14' | 'turbine';
  name: string;
  kind: GpuKind;
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
};

// Pistons cover every placard combination, so the placard has to be read:
// Cessna-style ships need the master ON to pull in the external power relay,
// Piper-style ships start on ground power with the master OFF.
const PISTONS: GpuAircraft[] = [
  { id: 'single28', name: 'Piston single', kind: 'piston', volts: 28, master: 'on', ampMax: 0, battV: 23.2, gen: 'ALT' },
  { id: 'single14', name: 'Piston single', kind: 'piston', volts: 14, master: 'off', ampMax: 0, battV: 11.6, gen: 'ALT' },
  { id: 'twin28', name: 'Piston twin', kind: 'piston', volts: 28, master: 'off', ampMax: 0, battV: 23.0, gen: 'ALT' },
  { id: 'twin14', name: 'Piston twin', kind: 'piston', volts: 14, master: 'on', ampMax: 0, battV: 11.5, gen: 'ALT' },
];

export type StepId = 'avOff' | 'batt' | 'altOff' | 'cartV' | 'cartA' | 'plug' | 'cartOn' | 'verify' | 'start' | 'cartOff' | 'unplug' | 'altOn' | 'avOn';

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
  steps: { id: StepId; text: string }[];
};

/** current-limit knob range, amps */
export const AMP_KNOB = { min: 0, max: 1600, detent: 50 } as const;

export function generateGpu(seed: number, tier: number, tools: string[] = [], kind?: GpuKind): GpuModel {
  const t = clamp(Math.round(tier), 0, 5);
  const r = rng(hashSeed('gpu', seed, t));
  const k: GpuKind = kind ?? (t >= 4 ? 'turbine' : 'piston');
  let ac: GpuAircraft;
  if (k === 'turbine') {
    ac = { id: 'turbine', name: 'Turbine cargo single', kind: 'turbine', volts: 28, master: 'on', ampMax: r.pick([800, 900, 1000]), battV: 23.4, gen: 'GEN' };
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
    { id: 'altOff', text: tb ? 'Generator OFF' : 'Alternator OFF' },
    { id: 'cartV', text: `Cart output ${ac.volts} V (placard)` },
  ];
  if (tb) s.push({ id: 'cartA', text: `Current limit at ${ac.ampMax} A, not over` });
  s.push(
    { id: 'plug', text: 'Plug in, push until fully seated' },
    { id: 'cartOn', text: 'Cart ON' },
    { id: 'verify', text: `Tap the voltmeter: ${ac.volts} V on the bus` },
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
  | 'starterLong'
  | 'genEarly'
  | 'avionicsEarly'
  | 'avionicsBeforeGen';

export type FaultId = 'overVolt' | 'lowVoltCrank' | 'avionicsStart' | 'hotStart';

/** point deductions for procedure slips (each counted once) */
export const ERRORS: Record<ErrId, { pen: number; text: string }> = {
  arcIn: { pen: 0.2, text: 'plugged in live' },
  arcOut: { pen: 0.2, text: 'unplugged live' },
  avionicsPower: { pen: 0.15, text: 'avionics on at power-up' },
  wrongVolts: { pen: 0.1, text: 'cart on the wrong voltage' },
  noVerify: { pen: 0.05, text: 'bus voltage not checked' },
  battPlacard: { pen: 0.1, text: 'battery master against placard' },
  genOnStart: { pen: 0.1, text: 'charging system on for the start' },
  noBus: { pen: 0.05, text: 'cranked on the flat battery' },
  starterHeld: { pen: 0.1, text: 'starter held after it fired' },
  longCrank: { pen: 0.1, text: 'starter past its duty limit' },
  overAmps: { pen: 0.2, text: 'current over the placard' },
  lowAmps: { pen: 0.1, text: 'current limit set low' },
  earlyFuel: { pen: 0.1, text: 'fuel in below 12% N1' },
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
  /** external power relay closed: the bus is on the cart */
  fed: boolean;
  poweredAt: number;
  verifiedAt: number;
  /** true bus voltage and cart output current (the UI lags its needles behind these) */
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
  lit: boolean;
  fuelAt: number;
  /** fuel brought in below the minimum N1 is too much fuel for the air: the start runs rich (hot) */
  rich: number;
  idleT: number;
  aborts: number;
  running: boolean;
  everRunning: boolean;
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
    lit: false,
    fuelAt: -1,
    rich: 1,
    idleT: 0,
    aborts: 0,
    running: false,
    everRunning: false,
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
    if (s.cartV > need) fault(s, 'overVolt');
    else if (s.cartV < need) err(s, 'wrongVolts');
    if (s.avionics) err(s, 'avionicsPower');
    ev(s, { k: 'power' });
    // power arriving with the starter already engaged: the start begins now
    if (s.starter && !s.running && !(s.m.ac.kind === 'piston' && s.fired)) crankChecks(s);
  } else if (!f) s.fed = false;
  s.busV = trueBus(s);
}

/** starter power available, 0..~1.3 (1 = the cart at the placard setting) */
export function crankPower(s: GpuSim): number {
  const { ac } = s.m;
  if (s.fed) {
    const vf = s.cartV === ac.volts ? 1 : s.cartV > ac.volts ? 1.2 : 0.3;
    if (ac.kind === 'turbine') return vf * clamp(s.cartA / ac.ampMax, 0, 1.3);
    return vf * clamp(s.cartA / 250, 0.3, 1);
  }
  if (s.batt) return ac.kind === 'turbine' ? 0.15 : 0.25; // the low ship's battery
  return 0;
}

function trueBus(s: GpuSim): number {
  const { ac } = s.m;
  const cranking = s.starter && !(ac.kind === 'piston' && s.fired);
  if (s.fed) return s.cartV - (cranking ? clamp(s.amps / 1000, 0, 1.2) * 2.6 : 0) - (s.running ? 0 : 0.1);
  if (s.running && s.alt && s.batt) return ac.volts + 0.3;
  if (s.batt) return ac.battV * (cranking ? 0.62 : 1);
  return 0;
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
  if (s.alt) err(s, 'genOnStart');
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
  if (sw === 'alt' && v && s.everRunning) {
    if (s.plug !== 'stowed') err(s, 'genEarly');
  }
  if (sw === 'avionics' && v && s.everRunning) {
    if (s.plug !== 'stowed') err(s, 'avionicsEarly');
    else if (!s.alt) err(s, 'avionicsBeforeGen');
  }
  s[sw] = v;
  if (sw === 'batt') updateFeed(s);
  if (sw === 'starter') {
    if (v) {
      s.crankRun = 0;
      crankChecks(s);
    } else if (ac.kind === 'piston' && !s.fired) s.crankT *= 0.5;
  }
  if (sw === 'fuel' && ac.kind === 'turbine') {
    if (v) {
      s.fuelAt = s.t;
      s.rich = 1 + clamp(s.m.fuelMin - s.n1, 0, 12) * 0.06;
      if (!s.running && s.n1 < s.m.fuelMin) err(s, 'earlyFuel');
      // a weak cart only bites once there is fire to feed: that is when it counts
      if (!s.running && s.fed && s.cartA < ac.ampMax * 0.8) err(s, 'lowAmps');
    } else if (s.lit && !s.running) {
      s.aborts++;
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

/** tap the voltmeter: a reading taken while the bus is on the cart counts as the check */
export function readVolts(s: GpuSim): number {
  if (s.fed && !s.everRunning) s.verifiedAt = s.t;
  return s.busV;
}

const smooth = (x: number) => {
  const u = clamp(x, 0, 1);
  return u * u * (3 - 2 * u);
};

/** ITT the combustion would settle at for this N1 (low airflow = hot) */
export function ittTarget(m: GpuModel, n1: number, rich = 1): number {
  return Math.min(1900, m.heat * rich * (600 + 900 * Math.exp(-(n1 - 12) / 10)));
}

export function step(s: GpuSim, dt: number) {
  if (s.done || dt <= 0) return;
  const m = s.m;
  s.t += dt;
  updateFeed(s);
  const p = crankPower(s);
  if (m.ac.kind === 'piston') {
    const cranking = s.starter && p > 0;
    if (cranking && !s.fired) {
      if (s.avionics) fault(s, 'avionicsStart');
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
    const target = s.fired ? 1000 : cranking ? 240 * Math.min(p, 1.1) : 0;
    s.rpm += (target - s.rpm) * (1 - Math.exp(-dt / (s.fired ? 0.35 : 0.25)));
    s.amps = s.fed ? (cranking && !s.fired ? Math.min(s.cartA, 210) : 18) : 0;
  } else {
    const a = s.starter ? Math.min(p, 1.3) : 0;
    if (s.starter && s.avionics && p > 0) fault(s, 'avionicsStart');
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
    const tgt = s.lit ? ittTarget(m, s.n1, s.rich) : m.ambient + 10;
    const tau = tgt > s.itt ? 1.8 / m.heat : s.n1 > 8 ? 2.2 : 6;
    s.itt += (tgt - s.itt) * (1 - Math.exp(-dt / tau));
    s.peakItt = Math.max(s.peakItt, s.itt);
    if (s.lit && s.itt > m.ittLimit) fault(s, 'hotStart');
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
  }
}

export function isComplete(s: GpuSim): boolean {
  const tb = s.m.ac.kind === 'turbine';
  return s.running && s.plug === 'stowed' && !s.cartOn && s.alt && s.batt && s.avionics && !s.starter && (!tb || s.fuel);
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
      return !pre || (s.cartA <= ac.ampMax && s.cartA >= ac.ampMax * 0.8);
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
  if (!s.done) v = Math.min(v, progressOf(s));
  return { score: clamp(v, 0, 1), summary: summarize(s) };
}

function summarize(s: GpuSim): string {
  const head = s.faults.length
    ? `Fault: ${FAULTS[s.faults[0]]}`
    : s.done
      ? s.errors.length
        ? 'Started'
        : 'By the book: clean start'
      : s.everRunning
        ? 'Running, after-start not done'
        : 'Engine not started';
  const slips = s.errors.slice(0, s.faults.length ? 1 : 2).map((id) => ERRORS[id].text);
  const more = s.errors.length - slips.length;
  return [head, ...slips, ...(more > 0 ? [`${more} more slip${more > 1 ? 's' : ''}`] : [])].join(', ');
}

// ---------------------------------------------------------------------------
// Puzzle
// ---------------------------------------------------------------------------

type P2 = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };
type Ctl = 'batt' | 'alt' | 'avionics' | 'starter' | 'fuel';
type Target = Ctl | 'volts' | 'amps' | 'cartSw' | 'plug' | 'voltmeter';

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
  howTo: 'Read the placard, set the cart, plug in, start, unplug.',
  term: 'GPU: a ground power cart that starts the aircraft instead of its weak battery.',
  seconds: (tier) => (tier >= 4 ? 110 + (tier - 4) * 10 : 70 + clamp(tier, 0, 3) * 8),
  mount(host, p) {
    const job = p.context?.job;
    const kind: GpuKind | undefined = job === 'gpuTurbine' ? 'turbine' : job === 'gpuPiston' ? 'piston' : undefined;
    const m = generateGpu(p.seed, p.tier, p.tools, kind);
    const { ac } = m;
    const tb = ac.kind === 'turbine';
    const twin = ac.id.startsWith('twin');
    const s = newSim(m);
    const st = stage(host.el);
    const { ctx } = st;
    const teach = m.checklist;
    const rm = p.reducedMotion;

    let finished = false;
    let flourishT = -1;
    let clock = 0;
    // needles lag the truth like real movements
    const nd = { v: s.busV, vv: 0, rpm: 0, n1: 0, itt: s.itt, amps: 0 };
    const lever: Record<Ctl | 'cart', number> = { batt: +s.batt, alt: +s.alt, avionics: +s.avionics, starter: 0, fuel: 0, cart: 0 };
    let sel = s.cartV === 28 ? 1 : 0; // output selector position, animated
    let propA = 0.3;
    let reading: { text: string; until: number } | null = null;
    let wiggleT = -9;
    let seatedT = -9;
    let listOpen = false;
    const toast = { text: '', until: 0, bad: false };
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
      // aircraft, nose left
      const fh = clamp(rampH * 0.33, 46, 92);
      let fy = rampTop + rampH * 0.47;
      // wheels stay clear of the plug parked on top of the cart
      const maxGround = cart.y - 46;
      let legs = clamp(rampH * 0.17, 14, 40);
      if (fy + fh / 2 + legs > maxGround) {
        legs = Math.max(12, maxGround - fy - fh / 2);
        fy = Math.min(fy, maxGround - legs - fh / 2);
      }
      const recF = tb ? 0.45 : twin ? 0.25 : 0.34;
      const rec: P2 = { x: w * recF, y: fy + fh * 0.1 };
      const groundY = fy + fh / 2 + legs;
      const horizon = fy - fh * 0.12;
      const plW = Math.min(168, w - 24 - w * 0.5);
      const plH = clamp(fy - fh / 2 - rampTop - 12, 42, 62);
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
      return { w, h, head, ck, gr, gy, gxs, ctl, ids, cart, rampTop, rampH, fh, fy, rec, groundY, horizon, placard, panel, kr, volts, amps, cartSw, outlet, holster };
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
    const say = (text: string, bad = false, secs = 2.4) => {
      toast.text = text;
      toast.bad = bad;
      toast.until = clock + secs;
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
            host.fx.fault();
            arcT = clock;
            burst(g.rec.x, g.rec.y, 22);
            break;
          case 'locked':
            host.fx.bad();
            say('Range switch is locked while the output is ON', true);
            break;
          case 'stuck':
            host.fx.tick();
            if (teach) say('Not fully seated: push it home');
            break;
          case 'seated':
            host.fx.thunk();
            seatedT = clock;
            break;
          case 'crank':
            host.fx.snap();
            break;
          case 'dead':
            host.fx.bad();
            say(teach ? 'Nothing: no power on the bus' : 'Click. Nothing turns', true);
            break;
          case 'fire':
            host.fx.good();
            fireT = clock;
            puff(g.w * (tb ? 0.36 : twin ? 0.62 : 0.22), g.fy + g.fh * 0.36, true, 7);
            break;
          case 'light':
            host.fx.thunk();
            fireT = clock;
            break;
          case 'abort':
            host.fx.tap();
            say(teach ? 'Fuel cut off: keep motoring to cool it' : 'Fuel cut off');
            break;
          case 'run':
            host.fx.good();
            say(teach ? 'Running. Now the after-start items' : 'Engine running');
            break;
          case 'err':
            // teaching tiers call out every slip; from tier 3 only what you'd see or hear on the ramp
            if (teach || LOUD.includes(e.id)) {
              host.fx.bad();
              say(cap(ERRORS[e.id].text), true);
            }
            if (e.id === 'arcIn' || e.id === 'arcOut') pitted = true;
            break;
          case 'fault': {
            host.fx.fault();
            say(faultText[e.id], true, 3.2);
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
          return 'voltmeter';
        case 'start':
          if (!tb) return 'starter';
          if (!s.starter && !s.lit) return 'starter';
          if (!s.fuel) return s.n1 >= m.fuelMin ? 'fuel' : null;
          return s.n1 >= m.idle - 2 ? 'starter' : null;
      }
    };
    const updateStatus = () => {
      const txt = s.done ? 'Done' : s.everRunning ? 'Engine running · after-start' : s.starter || s.lit ? 'Starting' : `${ac.name} · before start`;
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
      if (res.perfect) {
        flourishT = clock;
        host.fx.flourish();
      } else host.fx.good();
      host.status(res.summary);
      settle(host, res, res.perfect ? 900 : 400);
    }
    const dataOf = () => ({ errors: s.errors.slice(), faults: s.faults.slice(), aborts: s.aborts, peakItt: Math.round(s.peakItt) });

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
          const v = readVolts(s);
          reading = { text: `${v.toFixed(1)} V`, until: clock + 2.6 };
          wiggleT = clock;
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
      if (s.starter || (s.lit && !s.running) || Math.abs(nd.itt - s.itt) > 3 || Math.abs(nd.n1 - s.n1) > 0.3 || Math.abs(nd.rpm - s.rpm) > 5) markInput();
      // needles
      if (rm) nd.v = s.busV;
      else {
        // light spring with a touch of overshoot
        nd.vv += ((s.busV - nd.v) * 60 - nd.vv * 11) * dt;
        nd.v += nd.vv * dt;
      }
      nd.rpm = spring(nd.rpm, s.rpm, dt, 0.18);
      nd.n1 = spring(nd.n1, s.n1, dt, 0.25);
      nd.itt = spring(nd.itt, s.itt, dt, 0.3);
      nd.amps = spring(nd.amps, s.amps, dt, 0.2);
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
      if (!tb && s.running && Math.random() < dt * 2.5) puff(g.w * (twin ? 0.62 : 0.22), g.fy + g.fh * 0.36, false, 1);
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
        title: string;
        unit: string;
        red?: number;
        green?: [number, number];
        flash?: boolean;
      },
    ) {
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
        if (major && (r >= 34 || Math.abs(v / (o.major * (o.smallEvery ?? 1)) - Math.round(v / (o.major * (o.smallEvery ?? 1)))) < 1e-6)) {
          const lr = r - 16;
          label(ctx, o.fmt ? o.fmt(v) : String(v), c.x + Math.cos(a) * lr, c.y + Math.sin(a) * lr, { size: r >= 34 ? 9 : 8, weight: 700, color: 'rgba(251,245,233,.8)' });
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
      // title below the scale ends, unit tucked under the top of the scale
      label(ctx, o.title, c.x, c.y + r * 0.7, { size: r >= 34 ? 9 : 8, weight: 900, color: 'rgba(251,245,233,.75)' });
      if (o.unit && r >= 34) label(ctx, o.unit, c.x, c.y - r * 0.3, { size: 7, weight: 700, color: 'rgba(251,245,233,.5)' });
      const a = toA(o.val);
      const hot = o.flash && Math.floor(clock * 6) % 2 === 0;
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
        gaugeDial({ x: g.gxs[0], y: g.gy }, g.gr, { max: 1200, val: nd.itt, step: 100, major: 400, fmt: (v) => String(v / 100), title: 'ITT °C', unit: '×100', red: m.ittLimit, flash: s.itt > m.ittLimit });
        gaugeDial({ x: g.gxs[1], y: g.gy }, g.gr, { max: 110, val: nd.n1, step: 10, major: 20, smallEvery: 2, fmt: (v) => String(v), title: 'N1 %', unit: '' });
      } else {
        gaugeDial({ x: g.gxs[1], y: g.gy }, g.gr, { max: 3000, val: nd.rpm, step: 250, major: 1000, fmt: (v) => String(v / 100), title: 'RPM', unit: '×100' });
      }
      // the ship's own voltmeter: 0-16 V on a 14 V system, 0-32 V on a 28 V one (28 V into a 14 V ship pegs it)
      const v14 = ac.volts === 14;
      gaugeDial(vm, g.gr, { max: v14 ? 16 : 32, val: nd.v + tapped * (v14 ? 0.5 : 1), step: v14 ? 1 : 2, major: v14 ? 4 : 8, smallEvery: 2, title: 'VOLTS', unit: 'DC', green });
      if (reading && clock < reading.until) {
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
      if (m.guide && !finished) {
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
      const noseX = tb ? 26 : twin ? 12 : 30;
      const skin = '#f7f4ec';
      // shadow
      ctx.fillStyle = 'rgba(31,42,48,.1)';
      ctx.beginPath();
      ctx.ellipse(w * 0.6, g.groundY + 2, w * 0.42, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      // gear legs + wheels
      const nwX = w * (tb ? 0.2 : twin ? 0.16 : 0.18);
      const mwX = w * (twin ? 0.74 : 0.74);
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
      // fuselage
      ctx.fillStyle = skin;
      ctx.beginPath();
      if (twin) {
        ctx.moveTo(noseX, fy + fh * 0.12);
        ctx.quadraticCurveTo(noseX + 4, top + fh * 0.2, noseX + fh * 0.9, top + fh * 0.18);
        ctx.lineTo(w * 0.33, top + fh * 0.12);
        ctx.quadraticCurveTo(w * 0.4, top - fh * 0.1, w * 0.47, top - fh * 0.12);
        ctx.lineTo(w + 10, top - fh * 0.12);
        ctx.lineTo(w + 10, bot);
        ctx.lineTo(noseX + fh * 0.6, bot);
        ctx.quadraticCurveTo(noseX, bot - fh * 0.05, noseX, fy + fh * 0.12);
      } else {
        const fw0 = w * (tb ? 0.5 : 0.42);
        ctx.moveTo(noseX, fy - fh * 0.18);
        ctx.quadraticCurveTo(noseX + 2, top + fh * 0.08, noseX + 26, top + fh * 0.06);
        ctx.lineTo(fw0, top + fh * 0.04);
        ctx.quadraticCurveTo(fw0 + fh * 0.5, top - fh * 0.22, fw0 + fh * 1.1, top - fh * 0.26);
        ctx.lineTo(w + 10, top - fh * 0.26);
        ctx.lineTo(w + 10, bot);
        ctx.lineTo(noseX + 30, bot);
        ctx.quadraticCurveTo(noseX, bot - 2, noseX, fy + fh * 0.2);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(31,42,48,.35)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      // cheat line
      const cx0 = twin ? w * 0.3 : w * (tb ? 0.5 : 0.42);
      ctx.fillStyle = C.sea;
      ctx.fillRect(cx0, fy + fh * 0.28, w - cx0, fh * 0.07);
      ctx.fillStyle = C.mech;
      ctx.fillRect(cx0, fy + fh * 0.37, w - cx0, fh * 0.03);
      // windows
      ctx.fillStyle = '#3d5560';
      const wy = top - fh * (twin ? 0.04 : 0.16);
      const wh = fh * 0.3;
      const ws = twin ? [0.5, 0.64, 0.78, 0.92] : tb ? [0.66, 0.8, 0.94] : [0.6, 0.75, 0.9];
      for (const f of ws) {
        roundRect(ctx, w * f - fh * 0.2, wy + 2, fh * 0.34, wh, 5);
        ctx.fill();
      }
      // cowling panel lines (firewall + cowl split) and the nose air inlet
      const fw = twin ? w * 0.36 : w * (tb ? 0.5 : 0.42);
      ctx.strokeStyle = 'rgba(31,42,48,.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(fw, top + 4);
      ctx.lineTo(fw, bot - 2);
      if (!twin) {
        ctx.moveTo(noseX + 22, fy - fh * 0.04);
        ctx.lineTo(fw, fy - fh * 0.04);
      }
      ctx.stroke();
      if (!twin) {
        ctx.fillStyle = '#2b3236';
        roundRect(ctx, noseX + 4, fy + fh * 0.16, tb ? 22 : 16, 9, 4.5);
        ctx.fill();
        // rivet rows
        ctx.fillStyle = 'rgba(31,42,48,.22)';
        for (let x = noseX + 30; x < fw - 4; x += 9) {
          ctx.beginPath();
          ctx.arc(x, fy - fh * 0.04 - 3, 0.9, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // engine: exhaust + prop
      if (twin) {
        // near-side nacelle on the wing
        const nx = w * 0.6;
        const ny = fy + fh * 0.12;
        const nh = fh * 0.46;
        // low wing, seen end-on at the root: an airfoil under the nacelle
        const wy = bot - fh * 0.1;
        ctx.fillStyle = '#e1dccf';
        ctx.beginPath();
        ctx.moveTo(w * 0.5, wy);
        ctx.quadraticCurveTo(w * 0.5, wy - fh * 0.13, w * 0.58, wy - fh * 0.14);
        ctx.lineTo(w + 10, wy - fh * 0.08);
        ctx.lineTo(w + 10, wy + fh * 0.03);
        ctx.quadraticCurveTo(w * 0.56, wy + fh * 0.05, w * 0.5, wy);
        ctx.fill();
        ctx.strokeStyle = 'rgba(31,42,48,.3)';
        ctx.lineWidth = 1;
        ctx.stroke();
        const ng = ctx.createLinearGradient(0, ny - nh / 2, 0, ny + nh / 2);
        ng.addColorStop(0, '#fbf9f3');
        ng.addColorStop(1, '#d9d3c4');
        ctx.fillStyle = ng;
        ctx.beginPath();
        ctx.moveTo(nx + nh * 0.4, ny - nh / 2);
        ctx.lineTo(w + 10, ny - nh * 0.42);
        ctx.lineTo(w + 10, ny + nh * 0.42);
        ctx.lineTo(nx + nh * 0.4, ny + nh / 2);
        ctx.quadraticCurveTo(nx - nh * 0.12, ny + nh / 2, nx - nh * 0.12, ny);
        ctx.quadraticCurveTo(nx - nh * 0.12, ny - nh / 2, nx + nh * 0.4, ny - nh / 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(31,42,48,.35)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.fillStyle = '#2b3236';
        roundRect(ctx, nx + 2, ny + nh * 0.18, 14, 7, 3.5);
        ctx.fill();
        prop({ x: nx - nh * 0.16, y: ny }, fh * 0.6, 3);
      } else {
        prop({ x: noseX - 4, y: fy - fh * 0.02 }, fh * (tb ? 0.8 : 0.72), tb ? 3 : 2);
      }
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
          const hot = clamp((nd.itt - 850) / 250, 0, 1.4);
          if (hot > 0) {
            // torching
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
        }
      } else {
        // exhaust pipe under the cowling
        const ex = w * (twin ? 0.62 : 0.22);
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
      const lines: [string, number, number][] = tb
        ? [
            ['EXTERNAL POWER', 9, 800],
            [`${ac.volts} V DC · ${ac.ampMax} A MAX`, 13, 900],
            ['BATTERY SWITCH ON', 9, 800],
          ]
        : [
            ['EXTERNAL POWER', 9, 800],
            [`${ac.volts} VOLTS DC`, 15, 900],
            [`BATTERY MASTER ${ac.master === 'on' ? 'ON' : 'OFF'}`, 9, 800],
          ];
      const gap = P.h / 3.3;
      lines.forEach(([t, size, weight], i) => fitLabel(ctx, t, P.x + P.w / 2, P.y + P.h / 2 + (i - 1) * gap, P.w - 14, { size, weight, color: C.ink }));
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
      // control panel
      const P = g.panel;
      roundRect(ctx, P.x, P.y, P.w, P.h, 10);
      ctx.fillStyle = PANEL;
      ctx.fill();
      // output ammeter (edgewise) + lamp, top row
      const am: Rect = { x: P.x + 10, y: P.y + 8, w: Math.min(150, P.w * 0.44), h: 20 };
      roundRect(ctx, am.x, am.y, am.w, am.h, 4);
      ctx.fillStyle = '#efe8d6';
      ctx.fill();
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 1;
      for (let v = 0; v <= 1500; v += 250) {
        const x = am.x + 6 + (v / 1500) * (am.w - 12);
        ctx.beginPath();
        ctx.moveTo(x, am.y + am.h - 3);
        ctx.lineTo(x, am.y + am.h - (v % 500 === 0 ? 9 : 6));
        ctx.stroke();
      }
      label(ctx, 'DC AMPS', am.x + 30, am.y + 7, { size: 7, weight: 900, color: C.inkSoft });
      const nx = am.x + 6 + (clamp(nd.amps, 0, 1500) / 1500) * (am.w - 12);
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(nx, am.y + 2);
      ctx.lineTo(nx, am.y + am.h - 2);
      ctx.stroke();
      if (m.meter) {
        const lx = am.x + am.w + 8;
        const lw = P.x + P.w - 40 - lx;
        if (lw > 60) {
          roundRect(ctx, lx, am.y, lw, am.h, 4);
          ctx.fillStyle = '#9fb59a';
          ctx.fill();
          const vOut = s.cartOn ? (s.fed ? s.busV : s.cartV) : 0;
          tnum(ctx, `${vOut.toFixed(1)}V ${Math.round(s.amps)}A`, lx + lw / 2, am.y + am.h / 2 + 1, { size: 11, weight: 800, color: '#1d2a1a', align: 'center' });
        }
      }
      // output lamp
      const lampP = { x: P.x + P.w - 18, y: am.y + am.h / 2 };
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
      if (m.guide && !finished) {
        const t = stepTarget();
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
        const seatedFlash = clock - seatedT < 0.5 && s.plug === 'seated';
        if (seatedFlash) {
          ctx.strokeStyle = C.palm;
          ctx.lineWidth = 3;
          ctx.globalAlpha = 1 - (clock - seatedT) / 0.5;
          roundRect(ctx, pp.x - 24, pp.y - 20, 48, 40, 8);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        if (partial && teach) {
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
      if (m.guide && !finished && stepTarget() === 'plug') ring(pp, 30);
    }

    function drawHeader(g: Geo) {
      const showToast = toast.until > clock;
      if (teach) {
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
        label(ctx, tb ? 'Turbine start on ground power' : `${ac.name}: ground power start`, 14, 16, { size: 15, weight: 800, align: 'left' });
        const sub = showToast ? toast.text : s.everRunning ? 'Running. Finish the job' : 'No checklist on the ramp: from memory';
        fitLabel(ctx, sub, 14, 37, g.w - 28, { size: 12, weight: showToast ? 800 : 600, color: showToast ? (toast.bad ? C.rust : C.seaDeep) : C.inkSoft, align: 'left' });
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
      const cur = curStep();
      m.steps.forEach((it, i) => {
        const ry = y + 44 + i * rowH;
        const ok = stepDone(s, it.id);
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
