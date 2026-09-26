import { describe, expect, it } from 'vitest';
import {
  cableLive,
  faultConductor,
  generateMeter,
  itemHealthy,
  narrowing,
  pointIndex,
  readVolts,
  scoreMeter,
  type Call,
  type MeterModel,
  type Reading,
} from '../src/puzzles/meter';

/** A real tech: load on, half-split the run with H–N, then prove the wire with a ground reading. */
function halfSplit(m: MeterModel): { readings: Reading[]; call: Call } {
  const readings: Reading[] = [];
  const load = m.loadable;
  const hn = (i: number): Reading => ({ a: pointIndex(m, i, 'H'), b: pointIndex(m, i, 'N'), load });
  const healthy = (i: number) => {
    const rd = hn(i);
    readings.push(rd);
    const v = readVolts(m, rd.a, rd.b, load);
    return v >= 110 && v <= 132;
  };
  // candidates exclude the switched-off outlet, which a tech recognises and skips
  const idx = m.items.map((_, i) => i).filter((i) => !m.items[i].switchedOff);
  let lo = -1; // position in idx of the last proven-good item (-1 = panel)
  let hi = idx.length - 1; // first known bad (the symptom says something is bad)
  let hiProven = false;
  while (hi - lo > 1 || !hiProven) {
    const mid = hi - lo > 1 ? Math.floor((lo + hi + 1) / 2) : hi;
    if (healthy(idx[mid])) lo = mid;
    else {
      hi = mid;
      if (hi - lo === 1) hiProven = true;
    }
    if (mid === hi && hi - lo === 1) hiProven = true;
  }
  const at = idx[hi];
  const cond = faultConductor(m.fault.kind);
  readings.push({ a: pointIndex(m, at, cond), b: pointIndex(m, at, 'G'), load });
  return { readings, call: { item: at, cond } };
}

describe('meter puzzle model', () => {
  it('is deterministic per seed', () => {
    expect(generateMeter(42, 3)).toEqual(generateMeter(42, 3));
    expect(generateMeter(42, 5)).toEqual(generateMeter(42, 5));
  });

  it('reads real split-phase voltages', () => {
    const m = generateMeter(3, 2);
    const ph = pointIndex(m, -1, 'H');
    const pn = pointIndex(m, -1, 'N');
    const pg = pointIndex(m, -1, 'G');
    expect(readVolts(m, ph, pn, false)).toBeGreaterThan(115);
    expect(readVolts(m, ph, pg, false)).toBeGreaterThan(115);
    expect(readVolts(m, pn, pg, false)).toBeLessThan(2);
    // open neutral: 0 V hot–neutral but ~120 V hot–ground past the break
    for (let s = 1; s < 200; s++) {
      const on = generateMeter(s, 2);
      if (on.fault.kind !== 'openNeutral') continue;
      const i = on.fault.at;
      const h = pointIndex(on, i, 'H');
      const n = pointIndex(on, i, 'N');
      const g = pointIndex(on, i, 'G');
      expect(readVolts(on, h, n, true)).toBeLessThan(2);
      expect(readVolts(on, h, g, true)).toBeGreaterThan(110);
      expect(readVolts(on, n, g, true)).toBeGreaterThan(110);
      break;
    }
  });

  it('MWBC lost neutral gives the odd 60/180 V split and 240 V across the legs', () => {
    const m = generateMeter(2, 5);
    expect(m.mwbc).toBe(true);
    const at = m.fault.at;
    const legs = m.items.slice(at).map((it, k) => ({ it, i: at + k }));
    const a = legs.find((x) => x.it.leg === 0 && !x.it.switchedOff)!;
    const b = legs.find((x) => x.it.leg === 1 && !x.it.switchedOff)!;
    const hn = (i: number) => readVolts(m, pointIndex(m, i, 'H'), pointIndex(m, i, 'N'), true);
    expect(hn(a.i)).toBeGreaterThan(50);
    expect(hn(a.i)).toBeLessThan(70);
    expect(hn(b.i)).toBeGreaterThan(170);
    expect(hn(b.i)).toBeLessThan(190);
    expect(readVolts(m, pointIndex(m, -1, 'H', 0), pointIndex(m, -1, 'H', 1), true)).toBeGreaterThan(235);
  });

  it('a loose connection only shows under load', () => {
    for (let s = 1; s < 300; s++) {
      const m = generateMeter(s, 3);
      if (m.fault.kind !== 'looseHot' && m.fault.kind !== 'looseNeutral') continue;
      expect(itemHealthy(m, m.fault.at, false)).toBe(true);
      expect(itemHealthy(m, m.fault.at, true)).toBe(false);
      return;
    }
    throw new Error('no loose fault generated at tier 3');
  });

  it('every generated instance is solvable: first unhealthy item is the fault, wire is identifiable', () => {
    for (let tier = 0; tier <= 5; tier++) {
      for (let seed = 1; seed <= 150; seed++) {
        const m = generateMeter(seed, tier);
        const firstBad = m.items.findIndex((it, i) => !it.switchedOff && !itemHealthy(m, i, true));
        expect(firstBad).toBe(m.fault.at);
        if (m.anomaly >= 0) {
          expect(m.anomaly).toBeLessThan(m.fault.at - 1);
          expect(itemHealthy(m, m.fault.at - 1, true)).toBe(true);
        }
        const { readings, call } = halfSplit(m);
        expect(call.item).toBe(m.fault.at);
        expect(narrowing(m, readings)).toBe(1);
        expect(scoreMeter(m, readings, [call])).toBeGreaterThanOrEqual(0.95);
      }
    }
  });

  it('a clean half-split run is perfect; wrong calls and guessing score low', () => {
    const m = generateMeter(11, 4);
    const { readings, call } = halfSplit(m);
    expect(readings.length).toBeLessThanOrEqual(m.par + 1);
    expect(scoreMeter(m, readings, [call])).toBeGreaterThanOrEqual(0.95);
    // two wrong calls, then right: still a pass at best
    const wrongs: Call[] = [0, 1, 2, 3, 4, 5, 6].filter((i) => i !== m.fault.at).slice(0, 2).map((item) => ({ item, cond: 'H' }));
    expect(scoreMeter(m, readings, [...wrongs, call])).toBeLessThan(0.65);
    // an outsider who taps the right item with no readings has guessed, not diagnosed
    expect(scoreMeter(m, [], [call])).toBeLessThan(0.3);
    // three wrong calls, no readings: botched
    const botched: Call[] = [0, 1, 2, 3, 4, 5, 6].filter((i) => i !== m.fault.at).slice(0, 3).map((item) => ({ item, cond: 'N' }));
    expect(scoreMeter(m, [], botched)).toBeLessThan(0.15);
  });

  it('right place but wrong or unproven wire costs credit', () => {
    const m = generateMeter(5, 3);
    const { readings, call } = halfSplit(m);
    const wrongWire: Call = { item: call.item, cond: call.cond === 'H' ? 'N' : 'H' };
    expect(scoreMeter(m, readings, [wrongWire])).toBeLessThan(0.9);
    expect(scoreMeter(m, readings.slice(0, -1), [call])).toBeLessThan(0.95);
  });

  it('tier scaling: longer runs, harder faults, a decoy from tier 4', () => {
    const avg = (tier: number, f: (m: MeterModel) => number) => {
      let s = 0;
      for (let seed = 1; seed <= 40; seed++) s += f(generateMeter(seed, tier));
      return s / 40;
    };
    for (let t = 1; t <= 5; t++) {
      expect(avg(t, (m) => m.items.length)).toBeGreaterThan(avg(t - 1, (m) => m.items.length));
      expect(avg(t, (m) => m.par)).toBeGreaterThanOrEqual(avg(t - 1, (m) => m.par));
    }
    expect(avg(1, (m) => (m.fault.kind === 'openHot' ? 1 : 0))).toBe(1);
    expect(avg(3, (m) => (m.fault.kind.startsWith('loose') ? 1 : 0))).toBeGreaterThan(0.3);
    expect(avg(4, (m) => (m.anomaly >= 0 ? 1 : 0))).toBe(1);
    expect(avg(5, (m) => (m.fault.kind === 'mwbcNeutral' ? 1 : 0))).toBe(1);
  });

  it('from tier 3 the model exposes no answer-revealing hints', () => {
    for (let tier = 3; tier <= 5; tier++) {
      for (let seed = 1; seed <= 30; seed++) {
        const m = generateMeter(seed, tier, ['nonContact']);
        expect(m.hints).toEqual([]);
        const keys = Object.keys(m).join(' ');
        expect(keys).not.toMatch(/answer|solution|expected|hint(?!s)/i);
        // the item names never name the fault
        for (const it of m.items) expect(it.name).not.toMatch(/fault|loose|open|bad|neutral/i);
      }
    }
    expect(generateMeter(1, 1).hints.length).toBeGreaterThan(0);
  });

  it('non-contact tester senses the cable, so it cannot pinpoint an open neutral', () => {
    for (let s = 1; s < 200; s++) {
      const m = generateMeter(s, 4);
      if (m.fault.kind !== 'openNeutral') continue;
      for (let i = 0; i < m.items.length; i++) expect(cableLive(m, i, true)).toBe(true);
      return;
    }
  });
});
