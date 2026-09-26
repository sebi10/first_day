// Model tests for the core 8 puzzles: deterministic, a clean run is perfect,
// a botched run is botched, tiers get harder, and from tier 3 the teaching
// scaffolding is gone (real trade knowledge is the gate).
import { describe, expect, it } from 'vitest';
import { generateAuction, lotScore, scoreAuction } from '../src/puzzles/auction';
import { generateCrack, scoreCrack } from '../src/puzzles/crack';
import { generateForecast, scoreForecast } from '../src/puzzles/forecast';
import { AMPACITY, generatePanel, legOf, scorePanel, type Placement } from '../src/puzzles/panel';
import { generateTeardown, installable, mustRemove, removable, scoreTeardown, scoreTeardownRun } from '../src/puzzles/teardown';
import { SIGNOFF } from '../src/sim/econ';
import { generateTrace, isFaultMark, scoreTrace } from '../src/puzzles/trace';
import { generateVariance, scoreVariance } from '../src/puzzles/variance';
import { generateWireup, scoreWireup, type Landing } from '../src/puzzles/wireup';

const seeds = [1, 2, 3, 4, 5, 6, 7, 8];

describe('variance find', () => {
  it('is deterministic and the drivers explain the miss', () => {
    expect(generateVariance(9, 3, [], 540)).toEqual(generateVariance(9, 3, [], 540));
    for (const s of seeds) {
      const m = generateVariance(s, 4, [], 600);
      const driverSum = m.drivers.reduce((n, i) => n + m.lines[i].actual - m.lines[i].budget, 0);
      expect(Math.abs(driverSum - 600)).toBeLessThanOrEqual(40);
      // reclass pair is equal and opposite and nets to zero
      const rc = m.lines.filter((l) => l.kind === 'reclass');
      if (rc.length === 2) expect(rc[0].actual - rc[0].budget + rc[1].actual - rc[1].budget).toBe(0);
      // the red herring is immaterial in dollars
      const h = m.lines.find((l) => l.kind === 'herring');
      if (h) expect(h.actual - h.budget).toBeLessThanOrEqual(60);
    }
  });
  it('perfect = exact driver set; picking the herring or reclass costs', () => {
    const m = generateVariance(3, 4, [], 540);
    expect(scoreVariance(m, m.drivers, m.drivers.length).score).toBe(1);
    const decoys = m.lines.map((l, i) => (l.kind !== 'driver' && l.kind !== 'normal' ? i : -1)).filter((i) => i >= 0);
    expect(scoreVariance(m, decoys, decoys.length).score).toBeLessThan(0.3);
  });
  it('teaching columns only at tiers 0–2', () => {
    expect(generateVariance(1, 2).showVariance).toBe(true);
    expect(generateVariance(1, 3).showVariance).toBe(false);
  });
});

describe('parts auction', () => {
  it('winning under value and walking from an overpriced lot both score top marks', () => {
    const m = generateAuction(4, 3);
    expect(lotScore(m, true, m.fair - 40)).toBeGreaterThanOrEqual(0.95);
    expect(lotScore(m, false, m.fair + 30)).toBe(1);
    expect(lotScore(m, true, m.cap + 30)).toBeLessThan(0.2);
    expect(lotScore(m, false, m.fair - 60)).toBeLessThan(0.5);
    expect(scoreAuction(m, [])).toBe(0);
  });
  it('fair value marker only at teaching tiers; tier 5 runs two lots; faster clock', () => {
    expect(generateAuction(1, 2).showFair).toBe(true);
    expect(generateAuction(1, 3).showFair).toBe(false);
    expect(generateAuction(1, 5).lots.length).toBe(2);
    expect(generateAuction(1, 5).tickMs).toBeLessThan(generateAuction(1, 1).tickMs);
  });
});

describe('cash forecast', () => {
  it('matching the model is perfect, a flat guess on a rising island is not', () => {
    const ctx = { cashHistory: [8000, 9000, 10000, 11000], projection: [12500, 14000, 15500, 17000] };
    const m = generateForecast(1, 3, [], ctx);
    expect(scoreForecast(m, m.projection)).toBe(1);
    expect(scoreForecast(m, [11000, 11000, 11000, 11000])).toBeLessThan(0.7);
    expect(m.showGuide).toBe(false);
    expect(generateForecast(1, 2, [], ctx).showGuide).toBe(true);
  });
  it('axis bounds contain the answer without being centred on it', () => {
    const m = generateForecast(1, 4, [], { cashHistory: [5000, 5200], projection: [9000, 12000, 15000, 18000] });
    expect(m.yMax).toBeGreaterThan(18000);
    expect(m.yMin).toBeLessThan(5200);
  });
});

describe('crack hunt', () => {
  it('cracks start at holes; tagging each crack is perfect; tagging scratches is not', () => {
    for (const s of seeds) {
      const m = generateCrack(s, 4);
      const cracks = m.indications.filter((i) => i.kind === 'crack');
      for (const c of cracks) expect(Math.min(...m.holes.map((h) => Math.hypot(h.x - c.pts[0].x, h.y - c.pts[0].y)))).toBeLessThan(0.04);
      const tags = cracks.map((c) => c.pts[2]);
      expect(scoreCrack(m, tags, m.allowedSweeps).score).toBe(1);
      const scratches = m.indications.filter((i) => i.kind === 'scratch').map((sc) => sc.pts[0]);
      expect(scoreCrack(m, scratches, m.allowedSweeps).score).toBeLessThanOrEqual(0.1);
    }
  });
  it('harder with tier; decoys look real from tier 3', () => {
    expect(generateCrack(1, 5).cracks).toBeGreaterThan(generateCrack(1, 1).cracks);
    expect(generateCrack(1, 5).battery).toBeLessThan(generateCrack(1, 1).battery);
    expect(generateCrack(1, 2).decoyDim).toBeLessThan(1);
    expect(generateCrack(1, 3).decoyDim).toBe(1);
    expect(generateCrack(1, 3).teach).toBe(false);
  });
});

describe('engine teardown', () => {
  it('follows the real removal order and reinstalls in reverse', () => {
    // the catalog's assemblies, plus the ones repairs and crewmates' reports open
    for (const job of ['alternator', 'cylinder', 'avionics', 'wheel', 'wheelhalf', 'prop', 'exhaust', 'sparcap', 'genmount', 'fan', 'trencher']) {
      for (const tier of [1, 3, 5]) {
        const m = generateTeardown(2, tier, [], job);
        const removed = new Set<string>();
        for (const id of m.order) {
          expect(removable(m, id, removed)).toBe(true);
          removed.add(id);
        }
        expect(removed.size).toBe(m.parts.length);
        const installed = new Set<string>();
        for (const id of [...m.order].reverse()) {
          expect(installable(m, id, installed)).toBe(true);
          installed.add(id);
        }
        expect(mustRemove(m).size).toBeGreaterThan(0);
      }
    }
    // real procedure: cylinder base nuts only after everything on the head
    const cyl = generateTeardown(1, 3, [], 'cylinder');
    expect(removable(cyl, 'nuts', new Set(['cowl']))).toBe(false);
    // avionics: master off before anything else
    const av = generateTeardown(1, 1, [], 'avionics');
    expect(av.order[0]).toBe('master');
  });
  it('a repair opens the assembly it is about, with the failed part in it', () => {
    expect(generateTeardown(1, 2, [], 'prop').title).toBe('Propeller (flange bolts)');
    expect(generateTeardown(1, 2, [], 'prop').faults).toEqual(['bolts']);
    expect(generateTeardown(1, 2, [], 'wheelhalf').faults).toEqual(['wheel']);
    expect(generateTeardown(1, 2, [], 'genmount').faults).toEqual(['bolts', 'iso']);
  });
  it('handed in untouched is not a pass (it used to score 60%)', () => {
    for (const job of ['alternator', 'cylinder', 'avionics', 'prop', 'wheel', 'fan']) {
      for (const tier of [1, 2, 3, 5]) {
        const m = generateTeardown(3, tier, [], job);
        const all = new Set(m.parts.map((p) => p.id));
        const untouched = scoreTeardownRun(m, { removed: new Set(), installed: all, forced: 0, wrongInstall: 0, replaced: [], goodReplaced: 0 });
        expect(untouched.score, `${job} t${tier}`).toBeLessThan(SIGNOFF);
        expect(untouched.reinstalled).toBe(false);
        // the real job, done right, is still perfect
        const done = scoreTeardownRun(m, { removed: new Set(m.order), installed: all, forced: 0, wrongInstall: 0, replaced: m.faults, goodReplaced: 0 });
        expect(done.score).toBe(1);
      }
    }
  });
  it('perfect only when every fault is replaced cleanly', () => {
    const m = generateTeardown(1, 5, [], 'cylinder');
    expect(m.faults.length).toBe(2);
    expect(scoreTeardown(m, { forced: 0, wrongInstall: 0, replaced: m.faults, goodReplaced: 0, reinstalled: true })).toBe(1);
    expect(scoreTeardown(m, { forced: 3, wrongInstall: 2, replaced: [], goodReplaced: 1, reinstalled: true })).toBeLessThan(0.1);
    expect(generateTeardown(1, 3).numbered).toBe(false);
    expect(generateTeardown(1, 3).tagged).toBe(false);
  });
});

describe('panel load', () => {
  it('always solvable: greedy balance fits under the limit with correct breakers', () => {
    for (const s of seeds) {
      for (const tier of [1, 3, 5]) {
        const m = generatePanel(s, tier);
        // place: 240 V first in column 0 from the top, then 120 V greedily by leg
        const placed: Placement[] = [];
        const taken = new Set<string>();
        let row = 0;
        for (const c of m.circuits.filter((x) => x.volts === 240)) {
          placed.push({ circuit: c.id, col: 0, row, breaker: c.breaker });
          taken.add(`0:${row}`);
          taken.add(`0:${row + 1}`);
          row += 2;
        }
        let l1 = 0;
        let l2 = 0;
        for (const c of m.circuits.filter((x) => x.volts === 120).sort((a, b) => b.amps - a.amps)) {
          const want = l1 <= l2 ? 1 : 2;
          let spot: [number, number] | null = null;
          for (let col = 0; col < 2 && !spot; col++) for (let r = 0; r < m.rows && !spot; r++) if (!taken.has(`${col}:${r}`) && legOf(r) === want) spot = [col, r];
          expect(spot).not.toBeNull();
          taken.add(`${spot![0]}:${spot![1]}`);
          placed.push({ circuit: c.id, col: spot![0], row: spot![1], breaker: c.breaker });
          if (want === 1) l1 += c.amps;
          else l2 += c.amps;
        }
        const r = scorePanel(m, placed);
        expect(r.over).toBe(0);
        expect(r.score).toBeGreaterThanOrEqual(0.95);
      }
    }
  });
  it('oversizing a breaker for its wire is punished (fire risk)', () => {
    const m = generatePanel(3, 3);
    const c = m.circuits.find((x) => x.awg === 14 || x.awg === 12)!;
    const r = scorePanel(m, [{ circuit: c.id, col: 0, row: 0, breaker: AMPACITY[c.awg] + 10 }]);
    expect(r.oversize).toBe(1);
    expect(generatePanel(1, 2).sizing).toBe(false);
    expect(generatePanel(1, 3).sizing).toBe(true);
    expect(generatePanel(1, 4).wattsOnly).toBe(true);
  });
});

describe('circuit trace', () => {
  it('the open is between the last live and first dead device', () => {
    for (const s of seeds) {
      const m = generateTrace(s, 4);
      const lastLive = m.devices[m.chain[m.faultAfter]];
      const firstDead = m.devices[m.chain[m.faultAfter + 1]];
      expect(lastLive.live).toBe(true);
      expect(firstDead.live).toBe(false);
      expect(isFaultMark(m, lastLive.pos)).toBe(true);
      const far = m.devices[m.chain[m.chain.length - 1]];
      if (m.chain.length - 1 > m.faultAfter + 1) expect(isFaultMark(m, far.pos)).toBe(false);
    }
  });
  it('scores first-try calls and punishes guessing', () => {
    const m = generateTrace(2, 3);
    expect(scoreTrace(m, { wrongMarks: 0, correct: true, tests: m.optimalTests, tracedFrac: 1 })).toBe(1);
    expect(scoreTrace(m, { wrongMarks: 3, correct: true, tests: 9, tracedFrac: 1 })).toBeLessThan(0.2);
    expect(generateTrace(1, 2).showStates).toBe(true);
    expect(generateTrace(1, 3).showStates).toBe(false);
  });
});

describe('wire-up', () => {
  const clean = (m: ReturnType<typeof generateWireup>): Landing[] => {
    const used = new Set<string>();
    return m.wires.map((w) => {
      const term = w.target.find((t) => !used.has(t) || m.terms.find((x) => x.id === t)!.multi)!;
      used.add(term);
      return { wire: w.id, term, strip: 0.75, cw: true };
    });
  };
  it('code-correct terminations are perfect at every tier', () => {
    for (const tier of [0, 1, 2, 3, 4, 5]) {
      for (const s of seeds.slice(0, 3)) {
        const m = generateWireup(s, tier);
        expect(scoreWireup(m, clean(m)).score).toBeGreaterThanOrEqual(0.95);
      }
    }
  });
  it('reversed polarity, exposed copper and ccw hooks are botches', () => {
    const m = generateWireup(1, 1);
    const bad: Landing[] = m.wires.map((w) => ({
      wire: w.id,
      term: w.color === 'black' ? 's1' : w.color === 'white' ? 'b1' : 'g',
      strip: 1.3,
      cw: false,
    }));
    expect(scoreWireup(m, bad).score).toBeLessThan(0.3);
    // GFCI: line and load swapped is wrong even if colours match
    const g = generateWireup(3, 4);
    const swapped: Landing[] = g.wires.map((w) => ({
      wire: w.id,
      term: w.target[0] === 'lh' ? 'dh' : w.target[0] === 'ln' ? 'dn' : w.target[0] === 'dh' ? 'lh' : w.target[0] === 'dn' ? 'ln' : 'g',
      strip: 0.75,
      cw: true,
    }));
    expect(scoreWireup(g, swapped).score).toBeLessThan(0.5);
    expect(generateWireup(1, 2).labels).toBe(true);
    expect(generateWireup(1, 3).labels).toBe(false);
    // the headlamp reads only real stamped markings (LINE/LOAD, COMMON), never HOT/NEU
    expect(generateWireup(1, 3, ['labelMaker']).labels).toBe(false);
    expect(generateWireup(1, 3, ['labelMaker']).stamps).toBe(true);
    expect(generateWireup(1, 3).stripReadout).toBe(false);
    expect(generateWireup(1, 3, ['torqueScrewdriver']).stripReadout).toBe(true);
    // the job picks the device
    expect(generateWireup(1, 1, [], 'gfci').device).toBe('gfci');
    expect(generateWireup(1, 2, [], 'switch3').device).toBe('switch3');
  });
});
