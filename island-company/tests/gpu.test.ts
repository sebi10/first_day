// Ground power start: the rules a real A&P is judged on, checked without a browser.
import { describe, expect, it } from 'vitest';
import {
  FAULT_CAP,
  UNFINISHED_CAP,
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

const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);

function run(s: GpuSim, secs: number, until?: () => boolean) {
  const dt = 1 / 30;
  for (let t = 0; t < secs; t += dt) {
    step(s, dt);
    if (until?.()) return;
  }
}

/** before start, by the book: avionics off, charging off, master per placard, cart to placard, plug fully in, cart on, read the bus */
function prep(s: GpuSim) {
  const { ac } = s.m;
  flip(s, 'avionics', false);
  flip(s, 'alt', false);
  flip(s, 'batt', ac.master === 'on');
  setCartVolts(s, ac.volts);
  if (ac.kind === 'turbine') setCartAmps(s, ac.ampMax);
  plugIn(s);
  pushPlug(s);
  setCart(s, true);
  step(s, 0.05);
  readVolts(s);
}

function start(s: GpuSim) {
  const { m } = s;
  flip(s, 'starter', true);
  if (m.ac.kind === 'piston') {
    run(s, 10, () => s.fired);
    flip(s, 'starter', false);
    step(s, 0.05);
  } else {
    run(s, 20, () => s.n1 >= m.fuelMin + 1);
    flip(s, 'fuel', true);
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
      expect(t0.ac.id).toBe('single28');
      expect(t0.init.cartV).toBe(14);
    }
    expect(generateGpu(1, 3, [], 'turbine').ac.kind).toBe('turbine');
  });

  it('every placard combination turns up, so the placard has to be read', () => {
    const seen = new Set(SEEDS.map((sd) => `${generateGpu(sd, 3).ac.volts}/${generateGpu(sd, 3).ac.master}`));
    expect(seen).toEqual(new Set(['28/on', '28/off', '14/on', '14/off']));
    // the cart is often left on the wrong range, and the turbine cart's limit is rarely right
    expect(SEEDS.some((sd) => generateGpu(sd, 3).init.cartV !== generateGpu(sd, 3).ac.volts)).toBe(true);
    for (const sd of SEEDS) {
      const m = generateGpu(sd, 5);
      const ok = m.init.cartA <= m.ac.ampMax && m.init.cartA >= m.ac.ampMax * 0.8;
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
        if (m.ac.kind === 'turbine') expect(s.peakItt).toBeLessThan(m.ittLimit);
      }
    }
  });

  it('checklist echoes the placard', () => {
    const m = generateGpu(3, 2);
    const txt = m.steps.map((x) => x.text).join(' | ');
    expect(txt).toContain(`${m.ac.volts} V`);
    expect(txt).toContain(`Battery master ${m.ac.master === 'on' ? 'ON' : 'OFF'}`);
    const tb = generateGpu(3, 4);
    expect(tb.steps.map((x) => x.text).join(' | ')).toContain(`${tb.ac.ampMax} A`);
  });
});

describe('ground power faults and slips', () => {
  const find = (pred: (m: GpuModel) => boolean, tier = 3) => {
    for (const sd of SEEDS) {
      const m = generateGpu(sd, tier);
      if (pred(m)) return m;
    }
    throw new Error('no seed');
  };

  it('28 V into a 14 V system is a fault that caps the job, however clean the rest', () => {
    const m = find((x) => x.ac.volts === 14);
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
  });

  it('14 V into a 28 V system won’t start it: caught at the voltmeter it is a slip, cranked on it is a fault', () => {
    const m = find((x) => x.ac.volts === 28);
    const caught = newSim(m);
    prep(caught);
    setCart(caught, false);
    setCartVolts(caught, 14);
    setCart(caught, true);
    expect(readVolts(caught)).toBeLessThan(15);
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
  });

  it('the output range is locked while the cart is on', () => {
    const s = newSim(generateGpu(2, 3));
    setCart(s, true);
    const v = s.cartV;
    expect(setCartVolts(s, v === 28 ? 14 : 28)).toBe(false);
    expect(s.cartV).toBe(v);
  });

  it('avionics: on at power-up is a slip, on through the start is a fault', () => {
    const m = generateGpu(5, 3);
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

  it('plugging in or unplugging with the cart live arcs the pins', () => {
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
    expect(scoreGpu(s).score).toBeCloseTo(0.6, 5);
  });

  it('a plug that stopped short does not close the relay until it is pushed home', () => {
    const m = find((x) => x.sticky);
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

  it('skipping the voltmeter, the charging system on, or riding the starter are slips', () => {
    const m = generateGpu(8, 3);
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

  it('a weak cart makes a slow, hot start: not aborted it is a fault; aborted and restarted it is a slip', () => {
    for (const tier of [4, 5]) {
      const m = turbine(3, tier);
      const hot = newSim(m);
      prep(hot);
      setCartAmps(hot, m.ac.ampMax * 0.55);
      flip(hot, 'starter', true);
      run(hot, 20, () => hot.n1 >= m.fuelMin);
      flip(hot, 'fuel', true);
      run(hot, 25);
      expect(hot.faults).toContain('hotStart');
      expect(hot.errors).toContain('lowAmps');

      const saved = newSim(m);
      prep(saved);
      setCartAmps(saved, m.ac.ampMax * 0.55);
      flip(saved, 'starter', true);
      run(saved, 20, () => saved.n1 >= m.fuelMin);
      flip(saved, 'fuel', true);
      run(saved, 10, () => saved.itt > 900);
      flip(saved, 'fuel', false); // abort, keep motoring
      expect(saved.aborts).toBe(1);
      run(saved, 6);
      expect(saved.itt).toBeLessThan(300);
      setCartAmps(saved, m.ac.ampMax);
      run(saved, 6);
      flip(saved, 'fuel', true);
      run(saved, 40, () => saved.n1 >= m.idle - 1);
      flip(saved, 'starter', false);
      run(saved, 1);
      after(saved);
      expect(saved.faults).toEqual([]);
      expect(saved.done).toBe(true);
      expect(scoreGpu(saved).score).toBeCloseTo(0.9, 5);
    }
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

  it('starting at the bottom of the placard band is still safe; over the placard is a slip', () => {
    for (const sd of SEEDS.slice(0, 10)) {
      for (const tier of [4, 5]) {
        const m = turbine(sd, tier);
        const s = newSim(m);
        prep(s);
        setCartAmps(s, Math.ceil((m.ac.ampMax * 0.8) / 50) * 50);
        start(s);
        after(s);
        expect(s.faults, `seed ${sd} tier ${tier}`).toEqual([]);
        expect(s.errors).toEqual([]);
      }
    }
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
    flip(s, 'starter', true);
    run(s, 10, () => s.n1 >= 13);
    flip(s, 'fuel', true);
    run(s, 10, () => s.n1 >= 22);
    flip(s, 'starter', false);
    run(s, 30);
    expect(s.running).toBe(false);
    expect(s.faults).toContain('hotStart');
  });
});
