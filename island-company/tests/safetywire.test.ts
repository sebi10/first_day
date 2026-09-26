import { describe, expect, it } from 'vitest';
import {
  generateWire,
  pigScore,
  scoreWire,
  threadTorque,
  tighteningDir,
  tpiScore,
  wrongWayPenalty,
  type WireBolt,
  type WireModel,
  type WireRun,
} from '../src/puzzles/safetywire';

const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);
const mid = (b: [number, number]) => (b[0] + b[1]) / 2;

/** a clean job: every hole on the tightening side, every span mid-band, pigtail bent back */
function cleanRun(m: WireModel): WireRun {
  const n = m.bolts.length;
  return {
    threaded: n,
    wraps: m.wrap ? n : 0,
    twists: m.spans.map((L) => mid(m.band) * L),
    pigtail: mid(m.pigtail),
    bent: true,
    wrongWay: 0,
    snaps: 0,
  };
}

/** torque on bolt i from the wire, threaded in direction s (screen coords, y down: + = clockwise) */
function wireTorque(bolts: WireBolt[], i: number, s: number): number {
  const b = bolts[i];
  const R = 0.25;
  const ux = Math.cos(b.hole) * s;
  const uy = Math.sin(b.hole) * s;
  let t = 0;
  if (i + 1 < bolts.length) {
    // exit end pulled toward the next bolt
    const ex = b.x + ux * R;
    const ey = b.y + uy * R;
    t += (ex - b.x) * (bolts[i + 1].y - ey) - (ey - b.y) * (bolts[i + 1].x - ex);
  }
  if (i > 0) {
    // entry end pulled toward the previous bolt
    const ex = b.x - ux * R;
    const ey = b.y - uy * R;
    t += (ex - b.x) * (bolts[i - 1].y - ey) - (ey - b.y) * (bolts[i - 1].x - ex);
  }
  return t;
}

describe('safety wire model', () => {
  it('is deterministic per seed', () => {
    expect(generateWire(42, 3)).toEqual(generateWire(42, 3));
    expect(generateWire(42, 5)).toEqual(generateWire(42, 5));
    expect(generateWire(42, 4)).not.toEqual(generateWire(43, 4));
  });

  it('tightening side = the wire pulls the head clockwise (right-hand threads)', () => {
    // two bolts in a row, holes drilled vertically: the wire must leave the top of
    // bolt 1 heading right, and enter the bottom of bolt 2 (the classic figure)
    const bolts: WireBolt[] = [
      { x: 0, y: 0, z: 0, hole: Math.PI / 2 },
      { x: 1.5, y: 0, z: 0, hole: Math.PI / 2 },
    ];
    // hole angle π/2 points down the screen; s = -1 means the wire exits upward
    expect(tighteningDir(bolts, 0)).toBe(-1);
    expect(tighteningDir(bolts, 1)).toBe(-1);
    expect(threadTorque(bolts, 0, -1)).toBe(1);
    expect(threadTorque(bolts, 0, 1)).toBe(-1);
    expect(wireTorque(bolts, 0, -1)).toBeGreaterThan(0);
    expect(wireTorque(bolts, 0, 1)).toBeLessThan(0);
  });

  it('every generated instance is solvable: each bolt has exactly one clearly-tightening side', () => {
    for (let t = 0; t <= 5; t++) {
      for (const s of SEEDS) {
        const m = generateWire(s, t);
        expect(m.spans.length).toBe(m.bolts.length - 1);
        m.spans.forEach((L) => expect(L).toBeGreaterThan(0.8));
        m.bolts.forEach((_, i) => {
          const d = tighteningDir(m.bolts, i);
          expect(d === 1 || d === -1, `tier ${t} seed ${s} bolt ${i}`).toBe(true);
          // the right side really pulls clockwise on every neighbour span, the other side really loosens
          expect(wireTorque(m.bolts, i, d)).toBeGreaterThan(0);
          expect(wireTorque(m.bolts, i, -d)).toBeLessThan(0);
        });
        // the twist band is reachable before the snap point
        expect(m.snapTpi).toBeGreaterThan(m.band[1]);
        expect(m.pigSnap).toBeGreaterThan(m.pigtail[1]);
        // bolts sit on the plate
        m.bolts.forEach((b) => {
          expect(b.x).toBeGreaterThan(0.2);
          expect(b.x).toBeLessThan(m.plate.w - 0.2);
          expect(b.y).toBeGreaterThan(0.2);
          expect(b.y).toBeLessThan(m.plate.h - 0.2);
        });
      }
    }
  });

  it('a clean job scores perfect', () => {
    for (let t = 0; t <= 5; t++) {
      for (const s of SEEDS.slice(0, 10)) {
        const m = generateWire(s, t);
        expect(scoreWire(m, cleanRun(m)), `tier ${t} seed ${s}`).toBeGreaterThanOrEqual(0.95);
      }
    }
  });

  it('a sloppy job scores low: loose spans, no pigtail, wrong-way threads', () => {
    for (const t of [1, 3, 5]) {
      const m = generateWire(9, t);
      const run = cleanRun(m);
      run.twists = m.spans.map((L) => m.band[0] * 0.5 * L);
      run.pigtail = 0;
      run.bent = false;
      run.wrongWay = 2;
      expect(scoreWire(m, run)).toBeLessThan(0.6);
    }
  });

  it('twist quality: in band is full credit, loose or over-twisted is capped', () => {
    expect(tpiScore(9, [8, 10])).toBe(1);
    expect(tpiScore(7.9, [8, 10])).toBeLessThanOrEqual(0.55);
    expect(tpiScore(11, [8, 10])).toBeLessThanOrEqual(0.55);
    // one span off band is enough to lose "perfect", even on the longest job
    const m = generateWire(3, 5);
    const run = cleanRun(m);
    run.twists[1] = m.band[0] * 0.97 * m.spans[1];
    expect(scoreWire(m, run)).toBeLessThan(0.95);
    expect(scoreWire(m, run)).toBeGreaterThan(0.6);
  });

  it('a pigtail left sticking out is marked down', () => {
    expect(pigScore(4, [3, 6], true)).toBe(1);
    expect(pigScore(4, [3, 6], false)).toBeLessThan(0.5);
    const m = generateWire(2, 3);
    const run = cleanRun(m);
    run.bent = false;
    expect(scoreWire(m, run)).toBeLessThan(0.95);
  });

  it('one snapped strand or one wrong-way thread costs "perfect"; wrong-way costs more from tier 3', () => {
    for (let t = 1; t <= 5; t++) {
      const m = generateWire(5, t);
      const snap = { ...cleanRun(m), snaps: 1 };
      const wrong = { ...cleanRun(m), wrongWay: 1 };
      expect(scoreWire(m, snap)).toBeLessThan(0.95);
      expect(scoreWire(m, wrong)).toBeLessThan(0.95);
      // an expert's single slip still passes
      expect(scoreWire(m, wrong)).toBeGreaterThanOrEqual(0.6);
      if (t >= 3) expect(scoreWire(m, wrong)).toBeLessThan(scoreWire(m, snap));
    }
    expect(wrongWayPenalty(3)).toBeGreaterThan(wrongWayPenalty(2));
  });

  it('from tier 3 a coin-flip guesser mostly fails (each thread/wrap is a 50/50 without the knowledge)', () => {
    const passRate = (m: WireModel) => {
      const choices = m.bolts.length + (m.wrap ? m.bolts.length : 0);
      let pass = 0;
      // wrong k of `choices` first tries, then the other side (binomial, p = 1/2)
      for (let k = 0; k <= choices; k++) {
        let c = 1;
        for (let j = 0; j < k; j++) c = (c * (choices - j)) / (j + 1);
        if (scoreWire(m, { ...cleanRun(m), wrongWay: k }) >= 0.6) pass += c / 2 ** choices;
      }
      return pass;
    };
    expect(passRate(generateWire(1, 3))).toBeLessThanOrEqual(0.5);
    expect(passRate(generateWire(1, 4))).toBeLessThan(0.35);
    expect(passRate(generateWire(1, 5))).toBeLessThan(0.05);
    // while teaching (arrows printed) mistakes are cheap
    expect(passRate(generateWire(1, 1))).toBe(1);
  });

  it('tiers 0-2 teach; from tier 3 the model exposes no answer-revealing hint fields', () => {
    for (const t of [0, 1, 2]) expect(generateWire(7, t).aids).toEqual({ arrows: true, ghost: true, spelled: true });
    for (const t of [3, 4, 5]) {
      for (const s of SEEDS.slice(0, 10)) {
        for (const tools of [[], ['wirePliers']]) {
          const m = generateWire(s, t, tools);
          expect(Object.values(m.aids).some(Boolean), `tier ${t} seed ${s}`).toBe(false);
          // the correct side per bolt is never stored in the model; it is derived when judging
          expect(Object.keys(m)).not.toContain('dir');
          expect(JSON.stringify(m)).not.toMatch(/"(dir|answer|hint|solution|correct)/i);
        }
      }
    }
  });

  it('time-up gives partial credit for what is done', () => {
    const m = generateWire(4, 3);
    const half: WireRun = { threaded: 2, wraps: 0, twists: [mid(m.band) * m.spans[0], undefined], pigtail: 0, bent: false, wrongWay: 0, snaps: 0 };
    const sc = scoreWire(m, half);
    expect(sc).toBeGreaterThan(0.2);
    expect(sc).toBeLessThan(0.6);
    expect(scoreWire(m, { threaded: 0, wraps: 0, twists: [undefined, undefined], pigtail: 0, bent: false, wrongWay: 0, snaps: 0 })).toBe(0);
  });

  it('tier scaling makes it harder: more bolts, tighter band, less snap margin, double-twist at tier 5', () => {
    const ms = [0, 1, 2, 3, 4, 5].map((t) => generateWire(11, t));
    for (let t = 1; t <= 5; t++) {
      expect(ms[t].bolts.length).toBeGreaterThanOrEqual(ms[t - 1].bolts.length);
      const w = (m: WireModel) => m.band[1] - m.band[0];
      expect(w(ms[t])).toBeLessThanOrEqual(w(ms[t - 1]));
      expect(ms[t].snapTpi - ms[t].band[1]).toBeLessThanOrEqual(ms[t - 1].snapTpi - ms[t - 1].band[1]);
    }
    expect(ms[1].bolts.length).toBe(2);
    expect(ms[5].bolts.length).toBe(4);
    expect(ms[5].wrap).toBe(true);
    expect(ms[4].wrap).toBe(false);
    // tier 3+ bolts sit on bosses at different heights, so spans are longer than they look
    const tall = SEEDS.slice(0, 20).some((s) => new Set(generateWire(s, 3).bolts.map((b) => b.z)).size > 1);
    expect(tall).toBe(true);
    // pigtail practice stays 3-6 twists outside the tutorial (AC 43.13-1B)
    for (let t = 1; t <= 5; t++) expect(ms[t].pigtail).toEqual([3, 6]);
  });
});
