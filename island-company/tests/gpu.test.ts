// Ground power start: the rules a real A&P is judged on, checked without a browser.
import { describe, expect, it } from 'vitest';
import {
  AMP_FLOOR,
  CLEAR_SECS,
  FAULT_CAP,
  RELIGHT_WAIT,
  STARTER_DUTY,
  UNFINISHED_CAP,
  cartOut,
  flip,
  generateGpu,
  newSim,
  plugIn,
  pushPlug,
  readVolts,
  scoreGpu,
  setCart,
  setCartAmps,
  setCartVolts,
  stepDone,
  step,
  unplug,
  type GpuModel,
  type GpuSim,
} from '../src/puzzles/gpu';
import { PASS } from '../src/puzzles/types';

const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);
const DT = 1 / 30;

function run(s: GpuSim, secs: number, until?: () => boolean) {
  for (let t = 0; t < secs; t += DT) {
    step(s, DT);
    if (until?.()) return;
  }
}

/** before start, by the book: avionics off, charging off, master per placard, cart to placard, plug fully in, cart on, read the volts */
function prep(s: GpuSim, amps?: number) {
  const { ac } = s.m;
  flip(s, 'avionics', false);
  flip(s, 'alt', false);
  flip(s, 'batt', ac.master === 'on');
  setCartVolts(s, ac.volts);
  if (ac.kind === 'turbine') setCartAmps(s, amps ?? ac.ampMax);
  plugIn(s);
  pushPlug(s);
  setCart(s, true);
  step(s, 0.05);
  readVolts(s);
}

/** turbine: starter on, fuel in on the first reading at or over the minimum N1 */
function lightUp(s: GpuSim) {
  flip(s, 'starter', true);
  run(s, 40, () => s.n1 >= s.m.fuelMin);
  flip(s, 'fuel', true);
}

function start(s: GpuSim) {
  const { m } = s;
  if (m.ac.kind === 'piston') {
    flip(s, 'starter', true);
    run(s, 10, () => s.fired);
    flip(s, 'starter', false);
    step(s, 0.05);
  } else {
    lightUp(s);
    run(s, 40, () => s.n1 >= m.idle - 1);
    flip(s, 'starter', false);
    run(s, 1);
  }
}

/** after start: cart off, unplug, battery + charging on, avionics last */
function after(s: GpuSim) {
  setCart(s, false);
  unplug(s);
  flip(s, 'batt', true);
  flip(s, 'alt', true);
  flip(s, 'avionics', true);
  step(s, 0.05);
}

function clean(m: GpuModel) {
  const s = newSim(m);
  prep(s);
  start(s);
  after(s);
  return s;
}

const find = (pred: (m: GpuModel) => boolean, tier = 3) => {
  for (const sd of SEEDS) {
    const m = generateGpu(sd, tier);
    if (pred(m)) return m;
  }
  throw new Error('no seed');
};

/** the lowest current-limit setting (on the knob's 50 A detents) inside the accepted band */
const bandFloor = (m: GpuModel) => Math.ceil((m.ac.ampMax * AMP_FLOOR) / 50) * 50;

describe('ground power model', () => {
  it('is deterministic per seed and varies between seeds', () => {
    expect(generateGpu(42, 3)).toEqual(generateGpu(42, 3));
    expect(generateGpu(42, 5)).toEqual(generateGpu(42, 5));
    const many = new Set(SEEDS.map((sd) => JSON.stringify(generateGpu(sd, 3))));
    expect(many.size).toBeGreaterThan(30);
  });

  it('teaches at tiers 0-2 only; pistons to tier 3, turbines at 4-5', () => {
    for (const t of [0, 1, 2]) expect(generateGpu(1, t).checklist).toBe(true);
    for (const t of [3, 4, 5]) expect(generateGpu(1, t).checklist).toBe(false);
    expect(generateGpu(1, 1).guide).toBe(true);
    expect(generateGpu(1, 2).guide).toBe(false);
    for (const sd of SEEDS) {
      expect(generateGpu(sd, 3).ac.kind).toBe('piston');
      const tb = generateGpu(sd, 4).ac;
      expect(tb.kind).toBe('turbine');
      expect([800, 900, 1000]).toContain(tb.ampMax);
      expect(tb.volts).toBe(28);
      // the tutorial: a 28 V, master-ON single with the cart left on 14 V
      const t0 = generateGpu(sd, 0);
      expect(t0.ac.id).toBe('high28');
      expect(t0.init.cartV).toBe(14);
    }
    expect(generateGpu(1, 3, [], 'turbine').ac.kind).toBe('turbine');
  });

  it('every placard combination turns up, on singles, so the placard has to be read', () => {
    const seen = new Set(SEEDS.map((sd) => `${generateGpu(sd, 3).ac.volts}/${generateGpu(sd, 3).ac.master}`));
    expect(seen).toEqual(new Set(['28/on', '28/off', '14/on', '14/off']));
    // a single engine, one alternator, one starter: Cessna-style high wings are master ON, Piper-style low wings master OFF
    for (const sd of SEEDS) {
      const { ac } = generateGpu(sd, 3);
      expect(ac.name).toMatch(/single/);
      expect(ac.master).toBe(ac.wing === 'high' ? 'on' : 'off');
    }
    // the cart is often left on the wrong range, and the turbine cart's limit is never in the band
    expect(SEEDS.some((sd) => generateGpu(sd, 3).init.cartV !== generateGpu(sd, 3).ac.volts)).toBe(true);
    for (const sd of SEEDS) {
      const m = generateGpu(sd, 5);
      const ok = m.init.cartA <= m.ac.ampMax && m.init.cartA >= m.ac.ampMax * AMP_FLOOR;
      expect(ok).toBe(false);
    }
  });

  it('a by-the-book start is perfect at every tier, sticky plugs and turbines included', () => {
    for (const t of [0, 1, 2, 3, 4, 5]) {
      for (const sd of SEEDS.slice(0, 12)) {
        const m = generateGpu(sd, t);
        const s = clean(m);
        expect(s.errors, `tier ${t} seed ${sd}`).toEqual([]);
        expect(s.faults).toEqual([]);
        expect(s.done).toBe(true);
        expect(scoreGpu(s).score).toBe(1);
        for (const it of m.steps) expect(stepDone(s, it.id)).toBe(true);
        if (m.ac.kind === 'turbine') expect(s.peakItt).toBeLessThan(m.ittLimit - 150);
      }
    }
  });

  it('checklist echoes the placard and the right meter', () => {
    const m = generateGpu(3, 2);
    const txt = m.steps.map((x) => x.text).join(' | ');
    expect(txt).toContain(`${m.ac.volts} V`);
    expect(txt).toContain(`Battery master ${m.ac.master === 'on' ? 'ON' : 'OFF'}`);
    const tb = generateGpu(3, 4);
    expect(tb.steps.map((x) => x.text).join(' | ')).toContain(`${tb.ac.ampMax} A`);
    // Piper-style: alternator OFF and the cart's meter; Cessna-style: no alternator item, the panel voltmeter
    const piper = find((x) => x.ac.master === 'off', 2);
    expect(piper.steps.map((x) => x.id)).toContain('altOff');
    expect(piper.steps.find((x) => x.id === 'verify')!.text).toMatch(/^Cart voltmeter/);
    const cessna = find((x) => x.ac.master === 'on', 2);
    expect(cessna.steps.map((x) => x.id)).not.toContain('altOff');
    expect(cessna.steps.find((x) => x.id === 'verify')!.text).toMatch(/^Voltmeter/);
  });
});

describe('ground power faults and slips', () => {
  it('28 V into a 14 V system is a fault that caps the job, however clean the rest', () => {
    for (const master of ['on', 'off']) {
      const m = find((x) => x.ac.volts === 14 && x.ac.master === master);
      const s = newSim(m);
      prep(s);
      setCart(s, false);
      setCartVolts(s, 28);
      setCart(s, true);
      expect(s.faults).toContain('overVolt');
      setCart(s, false);
      setCartVolts(s, 14);
      setCart(s, true);
      readVolts(s);
      start(s);
      after(s);
      expect(s.done).toBe(true);
      expect(scoreGpu(s).score).toBeLessThanOrEqual(FAULT_CAP);
    }
  });

  it('14 V into a 28 V system won’t start it: caught on the meters it is a slip, cranked on it is a fault', () => {
    for (const master of ['on', 'off']) {
      const m = find((x) => x.ac.volts === 28 && x.ac.master === master);
      const caught = newSim(m);
      prep(caught);
      setCart(caught, false);
      setCartVolts(caught, 14);
      setCart(caught, true);
      step(caught, 0.05);
      expect(readVolts(caught, 'cart')).toBeLessThan(15);
      // on a master-ON ship the bus sits on the low 23 V battery, not on the 14 V cart
      if (master === 'on') expect(readVolts(caught, 'ship')).toBeCloseTo(m.ac.battV, 0);
      setCart(caught, false);
      setCartVolts(caught, 28);
      setCart(caught, true);
      readVolts(caught);
      start(caught);
      after(caught);
      expect(caught.errors).toEqual(['wrongVolts']);
      expect(scoreGpu(caught).score).toBeCloseTo(0.9, 5);

      const cranked = newSim(m);
      prep(cranked);
      setCart(cranked, false);
      setCartVolts(cranked, 14);
      setCart(cranked, true);
      readVolts(cranked);
      flip(cranked, 'starter', true);
      run(cranked, 4);
      expect(cranked.fired).toBe(false);
      expect(cranked.faults).toContain('lowVoltCrank');
    }
  });

  it('the output range is locked while the cart is on', () => {
    const s = newSim(generateGpu(2, 3));
    setCart(s, true);
    const v = s.cartV;
    expect(setCartVolts(s, v === 28 ? 14 : 28)).toBe(false);
    expect(s.cartV).toBe(v);
  });

  it('avionics: on at power-up is a slip, on through the start is a fault (when the bus is live)', () => {
    const m = find((x) => x.ac.master === 'on');
    const s = newSim(m);
    prep(s);
    setCart(s, false);
    flip(s, 'avionics', true);
    setCart(s, true);
    readVolts(s);
    expect(s.errors).toContain('avionicsPower');
    start(s);
    expect(s.faults).toContain('avionicsStart');
    after(s);
    expect(scoreGpu(s).score).toBeLessThanOrEqual(FAULT_CAP);
  });

  it('master-OFF ships: the avionics bus is dead for the start, but the master going ON under them is a slip', () => {
    const m = find((x) => x.ac.master === 'off');
    const s = newSim(m);
    prep(s);
    flip(s, 'avionics', true);
    start(s);
    expect(s.faults).toEqual([]);
    setCart(s, false);
    unplug(s);
    flip(s, 'batt', true); // avionics come alive before the alternator
    flip(s, 'alt', true);
    step(s, 0.05);
    expect(s.done).toBe(true);
    expect(s.errors).toEqual(['avionicsBeforeGen']);
  });

  it('plugging in or unplugging with the cart live arcs the pins: both ways fails the job', () => {
    const m = generateGpu(6, 3);
    const s = newSim(m);
    flip(s, 'avionics', false);
    flip(s, 'alt', false);
    flip(s, 'batt', m.ac.master === 'on');
    setCartVolts(s, m.ac.volts);
    setCart(s, true);
    plugIn(s);
    pushPlug(s);
    expect(s.errors).toContain('arcIn');
    step(s, 0.05);
    readVolts(s);
    start(s);
    unplug(s);
    expect(s.errors).toContain('arcOut');
    setCart(s, false);
    flip(s, 'batt', true);
    flip(s, 'alt', true);
    flip(s, 'avionics', true);
    step(s, 0.05);
    expect(s.done).toBe(true);
    expect(scoreGpu(s).score).toBeCloseTo(0.5, 5);
    expect(scoreGpu(s).score).toBeLessThan(PASS);
  });

  it('a plug that stopped short does not close the relay until it is pushed home', () => {
    const m = find((x) => x.sticky && x.ac.master === 'on');
    const s = newSim(m);
    flip(s, 'batt', true);
    setCartVolts(s, m.ac.volts);
    plugIn(s);
    expect(s.plug).toBe('partial');
    setCart(s, true);
    step(s, 0.05);
    expect(s.fed).toBe(false);
    pushPlug(s);
    step(s, 0.05);
    expect(s.fed).toBe(true);
    expect(readVolts(s)).toBeCloseTo(m.ac.volts, 0);
  });

  it('the battery master follows the placard', () => {
    // master-ON ships: no master, no relay, the starter just clicks
    const on = find((x) => x.ac.master === 'on');
    const a = newSim(on);
    prep(a);
    flip(a, 'batt', false);
    step(a, 0.05);
    expect(a.fed).toBe(false);
    expect(readVolts(a)).toBe(0);
    flip(a, 'starter', true);
    run(a, 3);
    expect(a.fired).toBe(false);
    expect(a.events.some((e) => e.k === 'dead')).toBe(true);
    // master-OFF ships: the relay closes on ground power alone; leaving the master on is a slip
    const off = find((x) => x.ac.master === 'off');
    const b = newSim(off);
    prep(b);
    expect(b.fed).toBe(true);
    flip(b, 'batt', true);
    start(b);
    expect(b.errors).toContain('battPlacard');
  });

  it('master-OFF ships: the panel voltmeter stays dead on ground power; the cart meter is the check', () => {
    const m = find((x) => x.ac.master === 'off');
    const s = newSim(m);
    flip(s, 'avionics', false);
    flip(s, 'alt', false);
    flip(s, 'batt', false);
    setCartVolts(s, m.ac.volts);
    plugIn(s);
    pushPlug(s);
    setCart(s, true);
    step(s, 0.05);
    expect(s.fed).toBe(true);
    expect(readVolts(s, 'ship')).toBe(0);
    expect(s.verifiedAt).toBeLessThan(s.poweredAt); // a dead needle is no check
    expect(readVolts(s, 'cart')).toBeCloseTo(m.ac.volts, 0);
    expect(stepDone(s, 'verify')).toBe(true);
    // after the start: unplugged, master ON, alternator ON: the panel comes alive on the alternator
    start(s);
    setCart(s, false);
    unplug(s);
    flip(s, 'batt', true);
    expect(readVolts(s, 'ship')).toBeCloseTo(m.ac.battV, 1);
    flip(s, 'alt', true);
    expect(readVolts(s, 'ship')).toBeGreaterThan(m.ac.volts);
    flip(s, 'avionics', true);
    step(s, 0.05);
    expect(scoreGpu(s).score).toBe(1);
  });

  it('the volts only have to be looked at: a steady bus for a moment counts, cranking at once does not', () => {
    const m = find((x) => x.ac.master === 'on');
    const looked = newSim(m);
    prep(looked);
    looked.verifiedAt = -2;
    run(looked, 2);
    expect(stepDone(looked, 'verify')).toBe(true);
    const rushed = newSim(m);
    prep(rushed);
    rushed.verifiedAt = -2;
    flip(rushed, 'starter', true);
    expect(rushed.errors).toContain('noVerify');
  });

  it('cranking on the flat battery never fires it; the voltmeter shows it', () => {
    const m = find((x) => x.ac.master === 'on');
    const s = newSim(m);
    flip(s, 'avionics', false);
    flip(s, 'alt', false);
    flip(s, 'batt', true);
    expect(readVolts(s)).toBeLessThan(m.ac.volts * 0.88);
    flip(s, 'starter', true);
    run(s, 12);
    expect(s.fired).toBe(false);
    expect(s.errors).toEqual(expect.arrayContaining(['noBus', 'longCrank']));
  });

  it('skipping the check, the alternator on (Piper-style), or riding the starter are slips', () => {
    const m = find((x) => x.ac.master === 'off');
    const s = newSim(m);
    prep(s);
    s.verifiedAt = -2; // never looked
    flip(s, 'alt', true);
    flip(s, 'starter', true);
    run(s, 10, () => s.fired);
    run(s, 2);
    flip(s, 'starter', false);
    step(s, 0.05);
    expect(s.errors).toEqual(expect.arrayContaining(['noVerify', 'genOnStart', 'starterHeld']));
  });

  it('Cessna-style ships start with the whole master ON: the alternator on is no slip', () => {
    const m = find((x) => x.ac.master === 'on');
    const s = newSim(m);
    prep(s);
    flip(s, 'alt', true);
    start(s);
    after(s);
    expect(s.errors).toEqual([]);
    expect(scoreGpu(s).score).toBe(1);
  });

  it('after start: charging on or avionics on before unplugging are slips', () => {
    const m = generateGpu(9, 3);
    const s = newSim(m);
    prep(s);
    start(s);
    flip(s, 'batt', true);
    flip(s, 'avionics', true);
    flip(s, 'alt', true);
    setCart(s, false);
    unplug(s);
    step(s, 0.05);
    expect(s.errors).toEqual(expect.arrayContaining(['avionicsEarly', 'genEarly']));
    const t = newSim(m);
    prep(t);
    start(t);
    setCart(t, false);
    unplug(t);
    flip(t, 'batt', true);
    flip(t, 'avionics', true);
    flip(t, 'alt', true);
    step(t, 0.05);
    expect(t.errors).toEqual(['avionicsBeforeGen']);
  });

  it('an unfinished job never passes', () => {
    const m = generateGpu(4, 3);
    const s = newSim(m);
    expect(scoreGpu(s).score).toBeLessThan(0.2);
    prep(s);
    start(s);
    expect(s.running).toBe(true);
    expect(scoreGpu(s).score).toBeLessThanOrEqual(UNFINISHED_CAP);
    expect(scoreGpu(s).score).toBeGreaterThan(0.4);
  });
});

describe('turbine start', () => {
  const turbine = (sd = 1, tier = 4) => generateGpu(sd, tier);
  /** a start left to run with this current limit and fuel in at exactly 12% N1 */
  const unattended = (m: GpuModel, amps: number) => {
    const s = newSim(m);
    prep(s);
    s.cartA = amps;
    lightUp(s);
    run(s, 45, () => s.n1 >= m.idle - 1 || s.faults.length > 0);
    return s;
  };

  it('the accepted band is safe with a margin, fuel in at exactly 12%; the placard setting runs cool', () => {
    for (const tier of [4, 5]) {
      for (const sd of SEEDS) {
        const m = turbine(sd, tier);
        const floor = unattended(m, bandFloor(m));
        expect(floor.faults, `seed ${sd} tier ${tier}`).toEqual([]);
        expect(floor.peakItt).toBeLessThan(m.ittLimit - 60);
        const placard = unattended(m, m.ac.ampMax);
        expect(placard.peakItt).toBeGreaterThan(780);
        expect(placard.peakItt).toBeLessThan(900);
      }
    }
  });

  it('70-80% of the placard is abort-worthy: left alone it is a hot start', () => {
    for (const tier of [4, 5]) {
      for (const sd of SEEDS.slice(0, 16)) {
        const m = turbine(sd, tier);
        for (const f of [0.7, 0.75, 0.8]) {
          const s = unattended(m, m.ac.ampMax * f);
          expect(s.faults, `seed ${sd} tier ${tier} at ${f}`).toContain('hotStart');
          expect(s.errors).toContain('lowAmps');
        }
      }
    }
  });

  it('an abort when the needle passes 1030 °C, a human reaction later, saves it', () => {
    for (const tier of [4, 5]) {
      for (const sd of SEEDS.slice(0, 16)) {
        const m = turbine(sd, tier);
        for (const f of [0.5, 0.55, 0.6, 0.7, 0.8]) {
          const s = newSim(m);
          prep(s);
          s.cartA = m.ac.ampMax * f;
          lightUp(s);
          // the ITT needle trails the gas by its 0.1 s movement
          let needle = s.itt;
          let seen = -1;
          while (s.t < 60) {
            step(s, DT);
            needle += (s.itt - needle) * (1 - Math.exp(-DT / 0.1));
            if (seen < 0 && needle >= 1030) seen = s.t;
            if (seen >= 0 && s.t - seen >= 0.3) break;
          }
          expect(seen, `seed ${sd} tier ${tier} at ${f}`).toBeGreaterThan(0);
          flip(s, 'fuel', false);
          expect(s.aborts).toBe(1);
          run(s, 4);
          expect(s.faults, `seed ${sd} tier ${tier} at ${f}`).toEqual([]);
        }
      }
    }
  });

  it('the red line may be touched for a moment: cut the fuel as it crosses and it is no hot start', () => {
    for (const tier of [4, 5]) {
      for (const sd of SEEDS.slice(0, 16)) {
        const m = turbine(sd, tier);
        for (const f of [0.55, 0.7, 0.8]) {
          const s = newSim(m);
          prep(s);
          s.cartA = m.ac.ampMax * f;
          lightUp(s);
          run(s, 40, () => s.itt > m.ittLimit);
          run(s, 0.4);
          expect(s.peakItt).toBeGreaterThan(m.ittLimit);
          flip(s, 'fuel', false);
          run(s, 3);
          expect(s.faults, `seed ${sd} tier ${tier} at ${f}`).toEqual([]);
        }
      }
    }
  });

  it('a weak cart: abort, dry-motor, rest the starter, fix the cart, restart is only the one slip', () => {
    for (const tier of [4, 5]) {
      const m = turbine(3, tier);
      const s = newSim(m);
      prep(s, m.ac.ampMax * 0.55);
      lightUp(s);
      run(s, 20, () => s.itt > 1000);
      flip(s, 'fuel', false); // abort, keep motoring
      expect(s.aborts).toBe(1);
      run(s, CLEAR_SECS + 1);
      expect(s.itt).toBeLessThan(300);
      flip(s, 'starter', false);
      setCartAmps(s, m.ac.ampMax);
      run(s, 8);
      expect(s.t - s.abortAt).toBeGreaterThan(RELIGHT_WAIT);
      start(s);
      after(s);
      expect(s.faults).toEqual([]);
      expect(s.errors).toEqual(['lowAmps']);
      expect(s.done).toBe(true);
      expect(scoreGpu(s).score).toBeCloseTo(0.9, 5);
    }
  });

  it('relighting at once into residual fuel runs rich and costs more than the weak cart did', () => {
    const m = turbine(3, 5);
    const s = newSim(m);
    prep(s, m.ac.ampMax * 0.55);
    lightUp(s);
    run(s, 20, () => s.itt > 1000);
    flip(s, 'fuel', false);
    run(s, 0.3);
    setCartAmps(s, m.ac.ampMax);
    flip(s, 'fuel', true);
    expect(s.rich).toBeGreaterThan(1.25);
    expect(s.errors).toEqual(expect.arrayContaining(['lowAmps', 'hotRelight', 'noClear', 'starterDuty']));
    run(s, 40, () => s.n1 >= m.idle - 1 || s.faults.length > 0);
    flip(s, 'starter', false);
    run(s, 1);
    after(s);
    expect(scoreGpu(s).score).toBeLessThan(PASS);
    // a cleared engine in the same starter run: no torching, but still not the rested restart
    const t = newSim(m);
    prep(t, m.ac.ampMax * 0.55);
    lightUp(t);
    run(t, 20, () => t.itt > 1000);
    flip(t, 'fuel', false);
    setCartAmps(t, m.ac.ampMax);
    run(t, CLEAR_SECS + 1);
    flip(t, 'fuel', true);
    expect(t.errors).toEqual(expect.arrayContaining(['hotRelight', 'starterDuty']));
    expect(t.errors).not.toContain('noClear');
  });

  it('a hot start aborted and cleared, with the cart put away, is a bare pass; an abort of a good start is not', () => {
    for (const tier of [4, 5]) {
      const m = turbine(3, tier);
      const s = newSim(m);
      prep(s, m.ac.ampMax * 0.6);
      lightUp(s);
      run(s, 20, () => s.itt > 1000);
      flip(s, 'fuel', false);
      run(s, CLEAR_SECS + 0.5);
      flip(s, 'starter', false);
      setCart(s, false);
      unplug(s);
      step(s, 0.05);
      expect(s.done).toBe(true);
      expect(s.stopped).toBe(true);
      expect(s.errors).toEqual(['lowAmps']);
      expect(scoreGpu(s).score).toBe(PASS);
      expect(scoreGpu(s).summary).toMatch(/aborted and cleared/);
    }
    const m = turbine(3, 4);
    const s = newSim(m);
    prep(s);
    lightUp(s);
    run(s, 2);
    flip(s, 'fuel', false);
    run(s, CLEAR_SECS + 0.5);
    flip(s, 'starter', false);
    setCart(s, false);
    unplug(s);
    step(s, 0.05);
    expect(s.stopped).toBe(true);
    expect(scoreGpu(s).score).toBeLessThan(PASS);
  });

  it('after an abort the starter keeps motoring: switching it off at once is a slip', () => {
    const m = turbine(3, 4);
    const s = newSim(m);
    prep(s, m.ac.ampMax * 0.6);
    lightUp(s);
    run(s, 20, () => s.itt > 1000);
    flip(s, 'fuel', false);
    flip(s, 'starter', false);
    expect(s.errors).toContain('noClear');
  });

  it('the starter-generator has a duty cycle', () => {
    const m = turbine(2, 4);
    const s = newSim(m);
    prep(s);
    flip(s, 'starter', true);
    run(s, STARTER_DUTY - 2);
    expect(s.errors).toEqual([]);
    run(s, 3);
    expect(s.errors).toContain('starterDuty');
  });

  it('fuel before 12% N1 runs rich and hot', () => {
    const m = turbine(2, 4);
    const s = newSim(m);
    prep(s);
    flip(s, 'starter', true);
    run(s, 10, () => s.n1 >= 7);
    flip(s, 'fuel', true);
    run(s, 20);
    expect(s.errors).toContain('earlyFuel');
    expect(s.faults).toContain('hotStart');
  });

  it('over the placard is a slip', () => {
    const m = turbine(1, 4);
    const s = newSim(m);
    prep(s);
    setCartAmps(s, m.ac.ampMax + 300);
    start(s);
    expect(s.errors).toContain('overAmps');
  });

  it('the starter carries it to idle: cut it early and the start hangs hot', () => {
    const m = turbine(5, 4);
    const s = newSim(m);
    prep(s);
    lightUp(s);
    run(s, 10, () => s.n1 >= 22);
    flip(s, 'starter', false);
    run(s, 30);
    expect(s.running).toBe(false);
    expect(s.faults).toContain('hotStart');
  });

  it('the cart meter sags under the starter and reads the cart even off the aircraft', () => {
    const m = turbine(1, 4);
    const s = newSim(m);
    setCartVolts(s, 28);
    setCart(s, true);
    expect(cartOut(s)).toBe(28);
    setCart(s, false);
    prep(s);
    flip(s, 'starter', true);
    run(s, 0.5);
    expect(cartOut(s)).toBeLessThan(27);
  });
});
