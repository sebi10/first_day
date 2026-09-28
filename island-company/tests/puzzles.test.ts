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
import { distToPoly, faultSeg, generateTrace, isFaultMark, megWords, pickedSplice, scoreTrace, trace } from '../src/puzzles/trace';
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
  it('cracks start at hole walls; circling each crack is perfect; circling decoys is not', () => {
    for (const s of seeds) {
      const m = generateCrack(s, 4);
      const idx = (k: 'crack' | 'decoy') => m.indications.map((ind, i) => ((ind.kind === 'crack') === (k === 'crack') ? i : -1)).filter((i) => i >= 0);
      for (const i of idx('crack')) {
        const c = m.indications[i];
        if (c.riser === 'hole') expect(Math.min(...m.holes.map((h) => Math.abs(Math.hypot(h.x - c.pts[0].x, h.y - c.pts[0].y) - h.r)))).toBeLessThan(0.01);
      }
      expect(scoreCrack(m, idx('crack')).score).toBe(1);
      expect(scoreCrack(m, idx('decoy')).score).toBe(0);
    }
  });
  it('harder with tier; decoys look as bright as cracks from tier 3', () => {
    expect(generateCrack(1, 5).cracks).toBeGreaterThan(generateCrack(1, 1).cracks);
    expect(generateCrack(1, 5).indications.length).toBeGreaterThan(generateCrack(1, 1).indications.length);
    const glow = (m: ReturnType<typeof generateCrack>, crack: boolean) => Math.max(...m.indications.filter((i) => (i.kind === 'crack') === crack).map((i) => i.glow));
    const t2 = generateCrack(1, 2);
    expect(glow(t2, false)).toBeLessThan(glow(t2, true));
    const t3 = generateCrack(1, 3);
    expect(glow(t3, false)).toBeGreaterThanOrEqual(glow(t3, true) * 0.85);
    expect(glow(t3, true)).toBeLessThan(glow(t2, true));
    expect(t3.teach).toBe(false);
  });
});

describe('engine teardown', () => {
  it('follows the real removal order and reinstalls in reverse', () => {
    // the catalog's assemblies, plus the ones repairs and crewmates' reports open
    for (const job of ['alternator', 'cylinder', 'avionics', 'wheel', 'wheelhalf', 'prop', 'exhaust', 'sparcap', 'genmount', 'fan', 'trencher', 'brake', 'receptacle']) {
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
    for (const job of ['alternator', 'cylinder', 'avionics', 'prop', 'wheel', 'fan', 'brake', 'receptacle']) {
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
  it("from the alert's site: the named room and its breaker, one receptacle on an individual circuit, and a warm plate is the hot joint on a live run", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const hall = generateTrace(seed, 3, [], undefined, { room: 'Living room', amps: 15, fault: 'dead' });
      expect(hall.symptom).toMatch(/^Living room is dead/);
      expect(hall.chain.slice(1).every((i) => hall.devices[i].name.startsWith('Living room '))).toBe(true);
      expect(hall.amps).toBe(15);
      expect(hall.devices[0].name).toBe('Breaker 15 A');
      const single = generateTrace(seed, 4, [], undefined, { room: 'Bedroom', amps: 20, single: true, appliance: 'window unit', fault: 'dead' });
      expect(single.chain).toHaveLength(2);
      expect(single.devices).toHaveLength(2);
      expect(single.symptom).toBe("The window unit's outlet is dead");
      expect(isFaultMark(single, single.devices[1].pos)).toBe(true);
      const warm = generateTrace(seed, 4, [], undefined, { room: 'Hall', amps: 20, device: 'switch', fault: 'warm' });
      expect(warm.warm).toBe(true);
      expect(warm.devices.every((d) => d.live)).toBe(true);
      const hot = warm.devices[warm.chain[warm.faultAfter]];
      expect(hot.kind).toBe('switch');
      expect(warm.symptom).toBe(`A ${hot.name.toLowerCase()} plate is warm`);
      expect(warm.temps![hot.id]).toBeGreaterThanOrEqual(130);
      expect(Math.max(...warm.temps!.filter((_, i) => i !== hot.id))).toBeLessThan(100);
      expect(isFaultMark(warm, hot.pos)).toBe(true);
      for (const id of warm.chain.slice(1)) if (id !== hot.id) expect(isFaultMark(warm, warm.devices[id].pos)).toBe(false);
      expect(scoreTrace(warm, { wrongMarks: 0, correct: true, tests: warm.optimalTests, tracedFrac: 1 })).toBe(1);
      // the appliance's own plug running warm: the one receptacle
      const plug = generateTrace(seed, 4, [], undefined, { room: 'Kitchen', amps: 20, single: true, appliance: 'microwave', fault: 'warm' });
      expect(plug.symptom).toBe("The microwave's plug runs warm");
      expect(isFaultMark(plug, plug.devices[1].pos)).toBe(true);
    }
    // no site: the stock scenario (a 20 A circuit)
    expect(generateTrace(2, 3).amps).toBe(20);
    expect(generateTrace(2, 3).warm).toBeUndefined();
  });
});

describe('circuit trace: the underground feeder (its own scene, never a room)', () => {
  const tiers = [0, 1, 2, 3, 4, 5];
  const mid = (pts: { x: number; y: number }[]) => {
    // halfway along a polyline
    const len = pts.slice(1).map((q, i) => Math.hypot(q.x - pts[i].x, q.y - pts[i].y));
    let d = len.reduce((a, b) => a + b, 0) / 2;
    for (let i = 0; i < len.length; i++) {
      if (d <= len[i]) return { x: pts[i].x + ((pts[i + 1].x - pts[i].x) * d) / len[i], y: pts[i].y + ((pts[i + 1].y - pts[i].y) * d) / len[i] };
      d -= len[i];
    }
    return pts[pts.length - 1];
  };

  it('is deterministic, and it is a yard: hand holes and the cottages, no outlet, switch or room', () => {
    for (const t of tiers)
      for (const seed of seeds) {
        const m = generateTrace(seed, t, [], 'feeder', { amps: 100, fault: 'dead' });
        expect(generateTrace(seed, t, [], 'feeder', { amps: 100, fault: 'dead' })).toEqual(m);
        expect(m.feeder).toBeDefined();
        expect(m.warm).toBeUndefined();
        expect(m.devices.some((d) => d.kind === 'outlet' || d.kind === 'switch')).toBe(false);
        for (const d of m.devices) expect(d.name, d.name).not.toMatch(/Kitchen|Bath|Bedroom|Porch|Living room|Deck|outlet/);
        expect(m.symptom).toBe('Feeder to the east cottages: 0.4 MΩ');
        expect(m.devices[0].name).toBe('Feeder breaker 100 A');
        // the run: the panel, the hand holes in order, the cottages at the end
        expect(m.chain.slice(1, -1).map((i) => m.devices[i].name)).toEqual(m.chain.slice(1, -1).map((_, k) => `HH${k + 1}`));
        expect(m.devices[m.chain[m.chain.length - 1]].kind).toBe('cottages');
      }
    // the room's scene is untouched: no job, no feeder
    expect(generateTrace(2, 3).feeder).toBeUndefined();
    expect(generateTrace(2, 3, [], 'hangar').feeder).toBeUndefined();
  });

  it('the megger reads good (hundreds of MΩ or more, less the more cable it takes in) up to the failed splice, and the failed splice from it on', () => {
    for (const t of tiers)
      for (const seed of seeds) {
        const m = generateTrace(seed, t, [], 'feeder');
        const f = m.feeder!;
        expect(f.megohms[0]).toBe(f.fault);
        const good = m.chain.slice(1, m.faultAfter + 1).map((i) => f.megohms[i]);
        const bad = m.chain.slice(m.faultAfter + 1).map((i) => f.megohms[i]);
        expect(good.length).toBeGreaterThanOrEqual(1);
        expect(bad.length).toBeGreaterThanOrEqual(1);
        for (const v of good) expect(v).toBeGreaterThanOrEqual(300);
        for (let k = 1; k < good.length; k++) expect(good[k]).toBeLessThan(good[k - 1]);
        for (const v of bad) expect(v).toBe(0.4);
        for (const i of m.chain.slice(1)) expect(m.devices[i].live).toBe(f.megohms[i] >= 300);
        // the tap and the other circuit are their own runs: good
        for (const d of m.devices.filter((x) => !m.chain.includes(x.id))) expect(f.megohms[d.id]).toBeGreaterThanOrEqual(300);
        // re-spliced, the whole run reads good from the panel
        expect(f.whole).toBeGreaterThanOrEqual(300);
      }
    expect(megWords(0.4)).toBe('0.4');
    expect(megWords(1240)).toBe('1,240');
  });

  it('dig the section between the last good hand hole and the first bad: not a hand hole, not another section, not the other circuit', () => {
    for (const t of tiers)
      for (const seed of seeds) {
        const m = generateTrace(seed, t, [], 'feeder');
        const seg = faultSeg(m);
        expect(seg.from).toBe(m.chain[m.faultAfter]);
        expect(isFaultMark(m, mid(seg.pts))).toBe(true);
        // the splices in the hand holes at either end are good
        expect(isFaultMark(m, m.devices[seg.from].pos)).toBe(false);
        expect(isFaultMark(m, m.devices[seg.to].pos)).toBe(false);
        // (where another run crosses the failed section, a dig there does open the failed section)
        for (const s of m.segs) if (s !== seg && distToPoly(mid(s.pts), seg.pts) > 0.06) expect(isFaultMark(m, mid(s.pts)), `${s.from}-${s.to}`).toBe(false);
        expect(scoreTrace(m, { wrongMarks: 0, correct: true, tests: m.optimalTests, tracedFrac: 1 })).toBe(1);
      }
  });

  it('teaching tiers show the readings; the run gets longer and busier with the tier', () => {
    expect(generateTrace(1, 2, [], 'feeder').showStates).toBe(true);
    expect(generateTrace(1, 3, [], 'feeder').showStates).toBe(false);
    const holes = (t: number) => generateTrace(4, t, [], 'feeder').devices.filter((d) => d.kind === 'handhole').length;
    expect(holes(1)).toBeLessThan(holes(3));
    expect(holes(3)).toBeLessThan(holes(5));
    expect(generateTrace(4, 2, [], 'feeder').devices.some((d) => d.name === 'Splice pedestal')).toBe(false);
    expect(generateTrace(4, 3, [], 'feeder').devices.some((d) => d.name === 'Splice pedestal')).toBe(true);
    expect(generateTrace(4, 3, [], 'feeder').segs.some((s) => s.circuit === 2)).toBe(false);
    expect(generateTrace(4, 4, [], 'feeder').segs.some((s) => s.circuit === 2)).toBe(true);
    // the alert's breaker
    expect(generateTrace(4, 3, [], 'feeder', { amps: 125, fault: 'dead' }).amps).toBe(125);
  });

  it('its own name, first-encounter card and term; a little more time for the close-out', () => {
    expect(trace.titleFor?.({ job: 'feeder' })).toBe('Underground feeder');
    expect(trace.howToFor?.({ job: 'feeder' })).toMatch(/megger/);
    expect(trace.howToFor!({ job: 'feeder' })!.split(' ').length).toBeLessThanOrEqual(12);
    expect(trace.termFor?.({ job: 'feeder' })!.split(' ').length).toBeLessThanOrEqual(15);
    for (const c of [undefined, {}, { job: 'hangar' }, { job: 'trip' }]) {
      expect(trace.titleFor?.(c)).toBeUndefined();
      expect(trace.howToFor?.(c)).toBeUndefined();
      expect(trace.termFor?.(c)).toBeUndefined();
    }
    expect(trace.seconds(3, { job: 'feeder' })).toBe(trace.seconds(3) + 10);
    // the close-out names the kits the job flow picked (display only)
    expect(pickedSplice([{ pn: 'DBS-2', nomen: 'Direct-burial splice kit', qty: 4, slot: 'splice', spec: { device: 'splice', burial: true } }])).toBe('DBS-2 × 4');
    expect(pickedSplice([{ pn: 'KR20-TR', nomen: 'Receptacle', qty: 1 }])).toBeNull();
    expect(pickedSplice(undefined)).toBeNull();
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
