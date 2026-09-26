// Mechanic · Safety wire. Lock-wire a row of drilled bolt heads so any
// loosening pulls the wire tight: swipe the wire through each head's hole so it
// leaves on the tightening (clockwise) side, twist each span to the right
// twists-per-inch, then twist a short pigtail and bend it back so it can't snag.
import { hashSeed, rng, type Rng } from '../sim/rng';
import { C, FONT, backdrop, clamp, ease, label, lerp, loop, pointer, roundRect, settle, shade, stage } from './kit';
import { result, type PuzzleDef, type PuzzleResult } from './types';

// ---------------------------------------------------------------------------
// Model (plate coordinates in inches, x right, y down: the view from above the heads)
// ---------------------------------------------------------------------------

/** hole: drilled-hole axis angle (radians); z: boss height in inches */
export type WireBolt = { x: number; y: number; z: number; hole: number };

export type WireModel = {
  tier: number;
  bolts: WireBolt[];
  /** twisted-span length between bolt i and i+1, inches (3D, so bosses count) */
  spans: number[];
  /** acceptable twists per inch */
  band: [number, number];
  /** above this the wire snaps */
  snapTpi: number;
  /** pigtail twist count band, and where it snaps */
  pigtail: [number, number];
  pigSnap: number;
  /** tier 5 double-twist method: loop the second strand around every head */
  wrap: boolean;
  /**
   * Teaching aids, tiers 0-2 only. From tier 3 the player wires it from trade
   * knowledge (AC 43.13-1B: the wire must be in tension if the part tends to
   * loosen; a right-hand bolt tightens clockwise; pigtail 1/4-1/2 in, 3-6 twists).
   * The correct side is never stored: it is derived from geometry when judging.
   */
  aids: {
    /** ↻ tightening arrows printed around each head */
    arrows: boolean;
    /** after repeated misses, a ghost stroke shows which way to swipe */
    ghost: boolean;
    /** instructions spell out the rule ("so the wire pulls clockwise") and the pigtail count */
    spelled: boolean;
  };
  /** where the free wire end starts */
  start: { x: number; y: number };
  plate: { w: number; h: number };
};

/** plate size (inches) by bolt count: fewer bolts, closer view */
export const PLATES: Record<number, { w: number; h: number }> = { 2: { w: 3.4, h: 2.2 }, 3: { w: 4.0, h: 2.6 }, 4: { w: 4.4, h: 2.8 } };
/** one full circle of the thumb on the pliers pad = this many twists */
export const TWISTS_PER_REV = 3;

const TIERS = {
  n: [2, 2, 3, 3, 4, 4],
  band: [
    [6, 11],
    [8, 10],
    [8, 10],
    [8.5, 10],
    [9, 10.5],
    [9, 10],
  ] as [number, number][],
  /** overtwist margin above the band before the wire snaps (tpi) */
  over: [5, 3, 2.6, 2.3, 2, 1.7],
  /** pigtail twists: AC 43.13-1B practice is 1/4-1/2 in, 3-6 twists (the tutorial is looser) */
  pig: [
    [3, 8],
    [3, 6],
    [3, 6],
    [3, 6],
    [3, 6],
    [3, 6],
  ] as [number, number][],
  /** how square to its neighbours a hole must sit (|sin|), so the right side is unambiguous */
  minSin: [0.9, 0.82, 0.6, 0.5, 0.5, 0.5],
};

const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;

/**
 * Which way the wire must pass through bolt i so it pulls the head clockwise.
 * Exit end E = c + R·u pulling toward the next bolt gives torque R·(u × d_next);
 * the entry end pulled toward the previous bolt gives −R·(u × d_prev). Clockwise
 * on screen (y down) is positive. Returns 0 when the two neighbours disagree
 * (the hole would need re-aligning, as a mechanic would by torquing within range).
 */
export function tighteningDir(bolts: WireBolt[], i: number): number {
  const b = bolts[i];
  const ux = Math.cos(b.hole);
  const uy = Math.sin(b.hole);
  let out = 0;
  let inn = 0;
  if (i + 1 < bolts.length) out = Math.sign(cross(ux, uy, bolts[i + 1].x - b.x, bolts[i + 1].y - b.y));
  if (i > 0) inn = -Math.sign(cross(ux, uy, bolts[i - 1].x - b.x, bolts[i - 1].y - b.y));
  if (out && inn && out !== inn) return 0;
  return out || inn;
}

/** Torque sign on bolt i if threaded in direction s (+1 tightens, -1 loosens). */
export function threadTorque(bolts: WireBolt[], i: number, s: number): number {
  const d = tighteningDir(bolts, i);
  return d === 0 ? 0 : d === s ? 1 : -1;
}

function holeClear(bolts: WireBolt[], i: number, minSin: number): boolean {
  const b = bolts[i];
  const ux = Math.cos(b.hole);
  const uy = Math.sin(b.hole);
  for (const j of [i - 1, i + 1]) {
    if (j < 0 || j >= bolts.length) continue;
    const dx = bolts[j].x - b.x;
    const dy = bolts[j].y - b.y;
    if (Math.abs(cross(ux, uy, dx, dy)) / Math.hypot(dx, dy) < minSin) return false;
  }
  return tighteningDir(bolts, i) !== 0;
}

function layout(r: Rng, t: number, n: number): WireBolt[] {
  const out: WireBolt[] = [];
  const PLATE = PLATES[n];
  if (t === 3 || t === 4) {
    // staggered around a flange: alternating rows, bosses at different heights
    const dx = n === 3 ? 1.3 : 1.05;
    const x0 = (PLATE.w - dx * (n - 1)) / 2;
    const upFirst = r.chance(0.5);
    for (let i = 0; i < n; i++) {
      const high = i % 2 === 0 === upFirst;
      out.push({
        x: x0 + i * dx + r.range(-0.08, 0.08),
        y: PLATE.h * (high ? 0.3 : 0.7) + r.range(-0.1, 0.1),
        z: r.pick([0, 0.2, 0.4]),
        hole: 0,
      });
    }
    return out;
  }
  const dx = n === 2 ? 1.55 : n === 3 ? 1.3 : 1.1;
  const x0 = (PLATE.w - dx * (n - 1)) / 2;
  const jitter = t >= 2 ? 0.2 : 0.05;
  for (let i = 0; i < n; i++) {
    out.push({
      x: x0 + i * dx + r.range(-0.06, 0.06),
      y: PLATE.h * 0.48 + r.range(-jitter, jitter),
      z: t >= 5 ? r.pick([0, 0.15, 0.3, 0.45]) : 0,
      hole: 0,
    });
  }
  return out;
}

export function generateWire(seed: number, tier: number, _tools: string[] = []): WireModel {
  const t = clamp(Math.round(tier), 0, 5);
  const r = rng(hashSeed('safetywire', seed, t));
  const n = TIERS.n[t];
  const bolts = layout(r, t, n);
  // from tier 2 the run may start at either end, so "enter low, leave high" can't be memorised
  if (t >= 2 && r.chance(0.5)) bolts.reverse();
  const PLATE = PLATES[n];
  const minSin = TIERS.minSin[t];
  for (let i = 0; i < n; i++) {
    // mean row direction at this bolt, so early tiers get holes square to the row
    const a = bolts[Math.max(0, i - 1)];
    const b = bolts[Math.min(n - 1, i + 1)];
    const rowAng = Math.atan2(b.y - a.y, b.x - a.x);
    let ok = false;
    for (let k = 0; k < 300 && !ok; k++) {
      bolts[i].hole = t <= 1 ? rowAng + Math.PI / 2 + r.range(-0.35, 0.35) : r.range(0, Math.PI);
      ok = holeClear(bolts, i, minSin);
    }
    if (!ok) {
      // square to the bisector of the two neighbours always works
      bolts[i].hole = rowAng + Math.PI / 2;
    }
  }
  const spans: number[] = [];
  for (let i = 0; i + 1 < n; i++) {
    const a = bolts[i];
    const b = bolts[i + 1];
    spans.push(Math.round(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) * 100) / 100);
  }
  const band = TIERS.band[t];
  const pig = TIERS.pig[t];
  // the free wire end starts beside bolt 1, clear of every boss, preferring the
  // far side of the row; which side is random so its position gives nothing away
  const d0x = bolts[1].x - bolts[0].x;
  const d0y = bolts[1].y - bolts[0].y;
  const away = Math.atan2(-d0y, -d0x);
  const side = r.chance(0.5) ? 1 : -1;
  let start = { x: bolts[0].x, y: clamp(bolts[0].y + 0.8, 0.3, PLATE.h - 0.3) };
  let bestClear = -1;
  for (const rad of [0.85, 0.7]) {
    for (let k = 0; k < 12; k++) {
      const a = away + side * (0.55 + (k % 2 ? -1 : 1) * Math.ceil(k / 2) * 0.35);
      const p = { x: bolts[0].x + Math.cos(a) * rad, y: bolts[0].y + Math.sin(a) * rad };
      if (p.x < 0.25 || p.x > PLATE.w - 0.25 || p.y < 0.3 || p.y > PLATE.h - 0.3) continue;
      const clear = Math.min(...bolts.map((o) => Math.hypot(p.x - o.x, p.y - o.y)));
      if (clear >= 0.62) {
        start = p;
        bestClear = clear;
        break;
      }
      if (clear > bestClear) {
        bestClear = clear;
        start = p;
      }
    }
    if (bestClear >= 0.62) break;
  }
  return {
    tier: t,
    bolts,
    spans,
    band: [band[0], band[1]],
    snapTpi: band[1] + TIERS.over[t],
    pigtail: [pig[0], pig[1]],
    pigSnap: pig[1] + 4,
    wrap: t >= 5,
    aids: { arrows: t <= 2, ghost: t <= 2, spelled: t <= 2 },
    start,
    plate: { ...PLATE },
  };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export type WireRun = {
  /** bolts threaded on the tightening side (wrong-way threads are pulled out, never kept) */
  threaded: number;
  /** tier 5: heads wrapped clockwise */
  wraps: number;
  /** final twist count per span (undefined = not twisted yet) */
  twists: (number | undefined)[];
  pigtail: number;
  bent: boolean;
  /** threads or wraps that pulled the loosening way (a knowledge error) */
  wrongWay: number;
  /** strands over-twisted until they snapped (a hands error) */
  snaps: number;
};

/** per wrong-way thread/wrap: gentle while teaching, stiff from tier 3 so guessing fails */
export function wrongWayPenalty(tier: number): number {
  return tier <= 0 ? 0.03 : tier <= 2 ? 0.1 : 0.25;
}

/** 1 in band; under-twisted (loose, can vibrate) or over-twisted (fatigued) caps at 0.55. */
export function tpiScore(tpi: number, band: [number, number]): number {
  const [lo, hi] = band;
  if (tpi >= lo && tpi <= hi) return 1;
  if (tpi < lo) return 0.55 * Math.pow(clamp(tpi / lo, 0, 1), 2);
  return Math.max(0.25, 0.55 - ((tpi - hi) / hi) * 2);
}

export function pigScore(count: number, band: [number, number], bent: boolean): number {
  if (count <= 0) return 0;
  const [lo, hi] = band;
  const q = count >= lo && count <= hi ? 1 : count < lo ? 0.5 * (count / lo) : 0.5;
  // a pigtail left sticking out is a snag hazard: an inspection write-up
  return q * (bent ? 1 : 0.3);
}

/**
 * Weighted checklist: 1 per correct thread, 1 per wrap (tier 5), 2 per span ×
 * twist quality, 1.5 for the pigtail × quality × bent-back; normalised, then
 * minus wrongWayPenalty(tier) per wrong-way thread/wrap (0.03 / 0.1 / 0.25 from
 * tier 3) and 0.07 per snapped strand (0.03 in the tutorial).
 */
export function scoreWire(m: WireModel, run: WireRun): number {
  const n = m.bolts.length;
  const max = n + (m.wrap ? n : 0) + 2 * (n - 1) + 1.5;
  let got = Math.min(run.threaded, n) + (m.wrap ? Math.min(run.wraps, n) : 0);
  for (let i = 0; i < n - 1; i++) {
    const tw = run.twists[i];
    if (tw != null && tw > 0) got += 2 * tpiScore(tw / m.spans[i], m.band);
  }
  got += 1.5 * pigScore(run.pigtail, m.pigtail, run.bent);
  const pen = wrongWayPenalty(m.tier) * run.wrongWay + (m.tier === 0 ? 0.03 : 0.07) * run.snaps;
  return clamp(got / max - pen, 0, 1);
}

function summarize(m: WireModel, run: WireRun): string {
  const n = m.bolts.length;
  const inBand = run.twists.filter((tw, i) => tw != null && tpiScore(tw / m.spans[i], m.band) === 1).length;
  const parts = [`${Math.min(run.threaded, n)}/${n} bolts wired`, `${inBand}/${n - 1} spans in band`];
  if (run.bent) parts.push(pigScore(run.pigtail, m.pigtail, true) === 1 ? 'pigtail good' : 'pigtail off count');
  if (run.wrongWay) parts.push(`${run.wrongWay} wrong-way`);
  if (run.snaps) parts.push(`${run.snaps} snapped`);
  return parts.join(', ');
}

// ---------------------------------------------------------------------------
// Puzzle
// ---------------------------------------------------------------------------

type Phase = 'thread' | 'wrap' | 'twist' | 'pigtail' | 'bend' | 'done';
type P2 = { x: number; y: number };

export const safetywire: PuzzleDef = {
  id: 'safetywire',
  role: 'mech',
  title: 'Safety wire',
  gesture: 'Drag wire + circle to twist',
  howTo: 'Thread the wire through each bolt, twist it, finish with a pigtail.',
  term: 'Safety wire: stainless wire twisted through drilled bolt heads so they can’t work loose.',
  seconds: (tier) => 60 + clamp(tier, 0, 5) * 12,
  mount(host, p) {
    const m = generateWire(p.seed, p.tier, p.tools);
    const n = m.bolts.length;
    const live = p.tools.includes('wirePliers') || m.tier === 0;
    const st = stage(host.el);
    const { ctx } = st;
    const run: WireRun = { threaded: 0, wraps: 0, twists: new Array(n - 1).fill(undefined), pigtail: 0, bent: false, wrongWay: 0, snaps: 0 };
    // the right side for each bolt, from geometry; never part of the model
    const answer = (k: number) => tighteningDir(m.bolts, k);
    const teach = m.aids.spelled;
    const sides: number[] = new Array(n).fill(0); // threading direction used per bolt
    let phase: Phase = 'thread';
    let cur = 0; // bolt (thread/wrap) or span (twist) index
    let twists = 0; // live count for the current span / pigtail
    let measured = false; // gauge shows the count only after a lift (unless pliers)
    let padAngle = 0;
    let finished = false;
    let flourishT = -1;
    let clock = 0; // pause-aware animation clock, seconds
    let wrongTries = 0; // on the current bolt
    let lastTick = 0;
    let tipPx: P2 | null = null; // resting tip, px (null = derive from phase)
    type TipDrag = { id: number; start: P2; at: P2; prev: P2; enter: P2 | null };
    let tipDrag: TipDrag | null = null;
    let twisting: { id: number; lastA: number } | null = null;
    let wrapping: { id: number; lastA: number; acc: number } | null = null;
    let wrong: { bolt: number; s: number; t0: number; back: P2 } | null = null;
    let snapped: { at: number; span: number } | null = null;
    const hint = { text: '', until: 0 };

    // ---- layout -------------------------------------------------------------
    const geo = () => {
      const w = st.w;
      const h = st.h;
      const headH = 52;
      const padR = clamp(Math.min(w * 0.25, h * 0.14), 58, 96);
      const padY = h - padR - 22;
      const room = padY - padR - 18 - headH; // plate + gauge + progress
      const ppi = Math.min((w - 24) / m.plate.w, (room - 118) / m.plate.h);
      const pw = m.plate.w * ppi;
      const ph = m.plate.h * ppi;
      const spare = Math.max(0, room - ph - 118);
      const plate = { x: (w - pw) / 2, y: headH + 4 + spare * 0.12, w: pw, h: ph, ppi };
      const R = clamp(ppi * 0.28, 22, 32);
      const gauge = { x0: 30, x1: w - 30, y: plate.y + ph + 46 };
      const progY = gauge.y + 46 + spare * 0.3;
      return { w, h, headH, plate, R, padR, padX: w / 2, padY, gauge, progY };
    };
    type Geo = ReturnType<typeof geo>;
    const bp = (g: Geo, i: number): P2 => ({ x: g.plate.x + m.bolts[i].x * g.plate.ppi, y: g.plate.y + m.bolts[i].y * g.plate.ppi });
    const axis = (i: number, s = 1): P2 => ({ x: Math.cos(m.bolts[i].hole) * s, y: Math.sin(m.bolts[i].hole) * s });
    const holeEnd = (g: Geo, i: number, s: number): P2 => {
      const c = bp(g, i);
      const u = axis(i, s);
      return { x: c.x + u.x * g.R, y: c.y + u.y * g.R };
    };
    /** where a twisted span stops, just short of the next head */
    const spanEnd = (g: Geo, k: number): P2 => {
      const c = bp(g, k);
      const a = bp(g, k - 1);
      const d = Math.hypot(a.x - c.x, a.y - c.y);
      return { x: c.x + ((a.x - c.x) / d) * (g.R + 17), y: c.y + ((a.y - c.y) / d) * (g.R + 17) };
    };
    const startPx = (g: Geo): P2 => ({ x: g.plate.x + m.start.x * g.plate.ppi, y: g.plate.y + m.start.y * g.plate.ppi });
    /** resting spot of the free wire end for the current phase */
    const tipHome = (g: Geo): P2 | null => {
      if (phase === 'thread') return cur === 0 ? startPx(g) : spanEnd(g, cur);
      if (phase === 'twist') return spanEnd(g, cur + 1);
      if (phase === 'pigtail' || phase === 'bend') return pigEnd(g);
      return null;
    };
    const pigBase = (g: Geo) => holeEnd(g, n - 1, sides[n - 1] || 1);
    const pigLen = (g: Geo, count: number) => (0.16 + 0.05 * Math.min(count, m.pigSnap)) * g.plate.ppi;
    /** the pigtail leaves the hole end, swung round if needed so its whole length stays on the plate */
    const pigDir = (g: Geo): P2 => {
      const b = pigBase(g);
      const u = axis(n - 1, sides[n - 1] || 1);
      const L = pigLen(g, m.pigSnap) + 26;
      const P = g.plate;
      for (const rot of [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8, Math.PI]) {
        const c = Math.cos(rot);
        const sn = Math.sin(rot);
        const d = { x: u.x * c - u.y * sn, y: u.x * sn + u.y * c };
        const ex = b.x + d.x * L;
        const ey = b.y + d.y * L;
        if (ex > P.x + 14 && ex < P.x + P.w - 14 && ey > P.y + 14 && ey < P.y + P.h - 14) return d;
      }
      return u;
    };
    const pigEnd = (g: Geo): P2 => {
      const b = pigBase(g);
      const u = pigDir(g);
      const L = pigLen(g, twists) + 10;
      return { x: b.x + u.x * L, y: b.y + u.y * L };
    };
    const tipNow = (g: Geo): P2 | null => (tipDrag ? tipDrag.at : tipPx ?? tipHome(g));

    // ---- flow ---------------------------------------------------------------
    const stepText = (): [string, string] => {
      const [lo, hi] = m.band;
      if (phase === 'thread')
        return [
          `Thread bolt ${cur + 1} of ${n}`,
          teach ? 'Swipe the wire through so it leaves on the ↻ side' : 'Swipe the wire end through the drilled hole',
        ];
      if (phase === 'wrap') return [`Wrap bolt ${cur + 1}`, 'Loop the second strand around the head'];
      if (phase === 'twist')
        return [`Twist span ${cur + 1} · ${m.spans[cur].toFixed(2)} in`, `${lo}–${hi} twists per inch, then route to bolt ${cur + 2}`];
      if (phase === 'pigtail') return ['Pigtail', teach ? `${m.pigtail[0]}–${m.pigtail[1]} twists, then bend the end back` : 'Twist a pigtail, then finish the end'];
      if (phase === 'bend' && !teach) return ['Finish the pigtail', 'Drag the end where it belongs'];
      if (phase === 'bend') return ['Bend it back', 'Tuck the pigtail against the head so it can’t snag'];
      return ['Wired', 'Every bolt pulls the wire tight if it tries to loosen'];
    };
    const updateStatus = () => {
      if (phase === 'thread') host.status(`Bolt ${cur + 1} of ${n} · thread${teach ? ' on the tightening side' : ''}`);
      else if (phase === 'wrap') host.status(`Bolt ${cur + 1} of ${n} · wrap`);
      else if (phase === 'twist') host.status(`Span ${cur + 1} of ${n - 1} · ${m.band[0]}–${m.band[1]} twists/in · ${m.spans[cur].toFixed(2)} in`);
      else if (phase === 'pigtail' || phase === 'bend')
        host.status(teach ? `Pigtail · ${m.pigtail[0]}–${m.pigtail[1]} twists, bend back` : 'Pigtail');
    };
    updateStatus();

    const afterBolt = (k: number) => {
      twists = 0;
      measured = false;
      tipPx = null;
      if (k < n - 1) {
        phase = 'twist';
        cur = k;
      } else {
        phase = 'pigtail';
        cur = k;
      }
      updateStatus();
    };

    const threadBolt = (k: number, s: number, back: P2) => {
      tipDrag = null;
      if (answer(k) !== s) {
        run.wrongWay++;
        wrongTries++;
        host.fx.bad();
        wrong = { bolt: k, s, t0: clock, back };
        host.status(`Wrong side: bolt ${k + 1} would back out`);
        say(teach ? 'Wrong side: that pull unscrews the bolt. Use the other end' : 'Wrong side: that pull would unscrew the bolt', 2.2);
        return;
      }
      sides[k] = s;
      run.threaded = k + 1;
      wrongTries = 0;
      host.fx.snap();
      if (m.wrap) {
        phase = 'wrap';
        cur = k;
        tipPx = null;
        updateStatus();
      } else afterBolt(k);
    };

    const finish = () => {
      if (finished) return;
      finished = true;
      phase = 'done';
      tipDrag = twisting = wrapping = null;
      const res = result(scoreWire(m, run), summarize(m, run), dataOf());
      if (res.perfect) {
        flourishT = clock;
        host.fx.flourish();
      } else host.fx.good();
      host.status(summarize(m, run));
      settle(host, res, res.perfect ? 800 : 350);
    };

    const dataOf = () => ({ wrongWay: run.wrongWay, snaps: run.snaps, twists: run.twists.slice(), pigtail: run.pigtail });

    const say = (text: string, secs = 1.6) => {
      hint.text = text;
      hint.until = clock + secs;
    };

    // ---- input --------------------------------------------------------------
    const angleAbout = (c: P2, x: number, y: number) => Math.atan2(y - c.y, x - c.x);
    const wrapDelta = (a: number, b: number) => {
      let d = a - b;
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      return d;
    };

    /** segment a→b against circle (c, r): entry/exit points along the segment */
    const segCircle = (a: P2, b: P2, c: P2, r: number): number[] => {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const fx = a.x - c.x;
      const fy = a.y - c.y;
      const A = dx * dx + dy * dy;
      if (A < 1e-9) return [];
      const B = 2 * (fx * dx + fy * dy);
      const Cc = fx * fx + fy * fy - r * r;
      const disc = B * B - 4 * A * Cc;
      if (disc < 0) return [];
      const sq = Math.sqrt(disc);
      return [(-B - sq) / (2 * A), (-B + sq) / (2 * A)].filter((t) => t >= 0 && t <= 1);
    };

    const tryCrossing = (g: Geo, d: TipDrag, a: P2, b: P2) => {
      if (phase !== 'thread') return;
      const k = cur;
      const c = bp(g, k);
      const r = g.R + 3;
      const ina = Math.hypot(a.x - c.x, a.y - c.y) < r;
      const inb = Math.hypot(b.x - c.x, b.y - c.y) < r;
      const ts = segCircle(a, b, c, r);
      const at = (t: number): P2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      let exit: P2 | null = null;
      if (!ina && inb) d.enter = ts.length ? at(ts[0]) : b;
      else if (ina && !inb) exit = ts.length ? at(ts[ts.length - 1]) : a;
      else if (!ina && !inb && ts.length === 2) {
        d.enter = at(ts[0]);
        exit = at(ts[1]);
      }
      if (!exit || !d.enter) return;
      const u = axis(k);
      const vx = exit.x - d.enter.x;
      const vy = exit.y - d.enter.y;
      const proj = vx * u.x + vy * u.y;
      d.enter = null;
      if (Math.abs(proj) >= g.R * 1.05 && Math.abs(proj) >= 0.62 * Math.hypot(vx, vy)) {
        threadBolt(k, Math.sign(proj), d.start);
      } else {
        host.fx.tick();
        say('That’s solid metal. Swipe along the drilled hole');
      }
    };

    const offPtr = pointer(st.canvas, {
      down(pt) {
        if (finished || host.paused() || wrong || tipDrag || twisting || wrapping) return;
        const g = geo();
        // leave the pigtail as it is (finishing without bending it back is allowed, and scored)
        if (phase === 'pigtail' && twists >= 0.5) {
          const b = doneBtn(g);
          if (pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h) {
            run.pigtail = twists;
            finish();
            return;
          }
        }
        // pliers pad
        if ((phase === 'twist' || phase === 'pigtail') && Math.hypot(pt.x - g.padX, pt.y - g.padY) < g.padR * 1.25) {
          if (snapped && clock - snapped.at < 0.7) return;
          twisting = { id: pt.id, lastA: angleAbout({ x: g.padX, y: g.padY }, pt.x, pt.y) };
          return;
        }
        // wrap the second strand around the head
        if (phase === 'wrap') {
          const c = bp(g, cur);
          const d = Math.hypot(pt.x - c.x, pt.y - c.y);
          if (d > g.R * 0.45 && d < g.R + 80) {
            wrapping = { id: pt.id, lastA: angleAbout(c, pt.x, pt.y), acc: 0 };
            return;
          }
        }
        // the free wire end
        const tip = tipNow(g);
        if (tip && Math.hypot(pt.x - tip.x, pt.y - tip.y) < 34) {
          if (phase === 'twist' && twists < 0.5) {
            host.fx.bad();
            say('Twist the strands first: circle the pliers pad ↻');
            return;
          }
          if (phase === 'pigtail' && twists < 0.5) {
            host.fx.bad();
            say('Twist a short pigtail first');
            return;
          }
          if (phase === 'twist') {
            run.twists[cur] = twists;
            if (!measured) measured = true;
            phase = 'thread';
            cur = cur + 1;
            updateStatus();
          } else if (phase === 'pigtail') {
            run.pigtail = twists;
            phase = 'bend';
            updateStatus();
          }
          if (phase !== 'thread' && phase !== 'bend') return;
          tipDrag = { id: pt.id, start: { ...tip }, at: { ...tip }, prev: { ...tip }, enter: null };
          host.fx.tap();
          return;
        }
        if (phase === 'twist' || phase === 'pigtail') say('Circle the pliers pad to twist ↻', 1.2);
        else if (phase === 'thread') say('Drag the wire end (the ring) through the hole', 1.2);
      },
      move(pt) {
        if (finished || host.paused()) return;
        const g = geo();
        if (twisting && twisting.id === pt.id) {
          const a = angleAbout({ x: g.padX, y: g.padY }, pt.x, pt.y);
          const d = wrapDelta(a, twisting.lastA);
          twisting.lastA = a;
          if (d <= 0) return; // pliers only spin one way
          padAngle += d;
          const before = twists;
          twists += (d / (Math.PI * 2)) * TWISTS_PER_REV;
          if (Math.floor(twists) !== Math.floor(before) && clock - lastTick > 0.02) {
            host.fx.tick();
            lastTick = clock;
          }
          const isPig = phase === 'pigtail';
          const val = isPig ? twists : twists / m.spans[cur];
          const [lo, hi] = isPig ? m.pigtail : m.band;
          const bv = isPig ? before : before / m.spans[cur];
          // band cues only where the band is on the work card (spans), or while teaching
          const cue = !isPig || teach;
          if (live && cue && val >= lo && bv < lo) host.fx.snap();
          if (val > (isPig ? m.pigSnap : m.snapTpi)) {
            // over-twisted past the breaking point: the strand snaps, redo this span
            run.snaps++;
            host.fx.fault();
            snapped = { at: clock, span: isPig ? -1 : cur };
            twists = 0;
            measured = false;
            twisting = null;
            host.status(isPig ? 'Pigtail snapped: twist it again' : `Span ${cur + 1} snapped: rewire it`);
            say('Over-twisted: the wire snapped. Twist this span again', 2.2);
            return;
          }
          if (live && cue && val > hi && bv <= hi) host.fx.bad();
          measured = false;
          return;
        }
        if (wrapping && wrapping.id === pt.id) {
          const c = bp(g, cur);
          const a = angleAbout(c, pt.x, pt.y);
          wrapping.acc += wrapDelta(a, wrapping.lastA);
          wrapping.lastA = a;
          if (Math.abs(wrapping.acc) >= Math.PI * 1.25) {
            const cw = wrapping.acc > 0;
            wrapping = null;
            if (cw) {
              run.wraps = cur + 1;
              host.fx.snap();
              afterBolt(cur);
            } else {
              run.wrongWay++;
              host.fx.bad();
              wrong = { bolt: cur, s: 0, t0: clock, back: bp(g, cur) };
              host.status(`Wrapped the loosening way: bolt ${cur + 1} would back out`);
              say('That loop pulls the loosening way', 2.2);
            }
          }
          return;
        }
        if (tipDrag && tipDrag.id === pt.id) {
          const at = { x: clamp(pt.x, 6, g.w - 6), y: clamp(pt.y, 6, g.h - 6) };
          const d = tipDrag;
          d.prev = d.at;
          d.at = at;
          if (phase === 'thread') tryCrossing(g, d, d.prev, at);
          else if (phase === 'bend') {
            const c = bp(g, n - 1);
            const base = pigBase(g);
            const far = Math.hypot(at.x - base.x, at.y - base.y) > 8;
            if (far && Math.hypot(at.x - c.x, at.y - c.y) < g.R + 6) {
              run.bent = true;
              tipDrag = null;
              host.fx.snap();
              finish();
            }
          }
        }
      },
      up(pt) {
        if (twisting && twisting.id === pt.id) {
          twisting = null;
          if (finished) return;
          measured = true;
          const isPig = phase === 'pigtail';
          const val = isPig ? twists : twists / m.spans[cur];
          const [lo, hi] = isPig ? m.pigtail : m.band;
          if (isPig && !teach) host.fx.tick();
          else if (val >= lo && val <= hi) host.fx.snap();
          else if (val > hi) host.fx.bad();
          return;
        }
        if (wrapping && wrapping.id === pt.id) {
          wrapping = null;
          return;
        }
        if (tipDrag && tipDrag.id === pt.id) {
          const g = geo();
          const d = tipDrag;
          tipDrag = null;
          if (finished) return;
          if (phase === 'bend') {
            // not tucked far enough: the pigtail springs back, keep twisting if you like
            phase = 'pigtail';
            twists = run.pigtail;
            tipPx = null;
            updateStatus();
            return;
          }
          // rest where released, but never inside a head
          let rest = { ...d.at };
          for (let i = 0; i < n; i++) {
            const c = bp(g, i);
            const dd = Math.hypot(rest.x - c.x, rest.y - c.y);
            if (dd < g.R + 14) {
              const k = (g.R + 16) / Math.max(1, dd);
              rest = { x: c.x + (rest.x - c.x) * k, y: c.y + (rest.y - c.y) * k };
            }
          }
          tipPx = rest;
        }
      },
    });

    // ---- frame --------------------------------------------------------------
    const stop = loop((_t, dt) => {
      if (!host.paused()) clock += dt;
      if (wrong && clock - wrong.t0 > (p.reducedMotion ? 0.6 : 0.9)) {
        // pull the wire back out (or unwind the wrap) and let them try again
        const back = wrong.back;
        const wasWrap = wrong.s === 0;
        wrong = null;
        if (!wasWrap) tipPx = back;
        updateStatus();
      }
      draw(geo());
    });

    // ---- drawing ------------------------------------------------------------
    const WIRE = shade(C.ink, 0.12);
    const WIRE_HI = shade(C.ink, 0.72);
    const UNDER = 'rgba(251,245,233,0.6)'; // paper halo so the wire reads on bare metal

    /** stroke a path with a paper halo underneath so wire reads on bare metal */
    function ink(path: () => void, color: string, width: number, halo = true) {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (halo) {
        ctx.strokeStyle = UNDER;
        ctx.lineWidth = width + 2.4;
        ctx.beginPath();
        path();
        ctx.stroke();
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      path();
      ctx.stroke();
    }

    function strand(pts: P2[], color: string, width: number, halo = true) {
      if (pts.length < 2) return;
      ink(
        () => {
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        },
        color,
        width,
        halo,
      );
    }

    /** the short untwisted run from a span end to a hole end, going round the boss rather than over the head */
    function around(g: Geo, k: number, from: P2, s: number) {
      const c = bp(g, k);
      const to = holeEnd(g, k, s);
      const a0 = Math.atan2(from.y - c.y, from.x - c.x);
      const a1 = Math.atan2(to.y - c.y, to.x - c.x);
      let d = a1 - a0;
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      const r = g.R + 5;
      const pts: P2[] = [from];
      const steps = Math.max(2, Math.ceil(Math.abs(d) / 0.2));
      for (let i = 0; i <= steps; i++) {
        const a = a0 + (d * i) / steps;
        pts.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
      }
      pts.push(to);
      strand(pts, WIRE, 2.4);
    }

    /** a twisted span: rope-like, ridge density = twists, loose strands when under-twisted */
    function twisted(a: P2, b: P2, count: number, tpiRatio: number, color = WIRE, broken = false) {
      const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const ux = (b.x - a.x) / L;
      const uy = (b.y - a.y) / L;
      const nx = -uy;
      const ny = ux;
      const amp = lerp(4.4, 2.2, clamp(tpiRatio, 0, 1));
      const N = Math.max(24, Math.ceil(count * 12));
      if (broken) {
        strand([a, { x: a.x + ux * L * 0.44, y: a.y + uy * L * 0.44 }], color, 2.4);
        strand([{ x: a.x + ux * L * 0.56, y: a.y + uy * L * 0.56 }, b], color, 2.4);
        return;
      }
      ctx.globalAlpha = 0.9;
      strand([a, b], UNDER, amp * 2 + 2.4, false);
      ctx.globalAlpha = 1;
      for (const sgn of [1, -1]) {
        const pts: P2[] = [];
        for (let i = 0; i <= N; i++) {
          const t = i / N;
          const o = sgn * amp * Math.sin(Math.PI * 2 * count * t) * Math.min(1, t * 8, (1 - t) * 8);
          pts.push({ x: a.x + ux * L * t + nx * o, y: a.y + uy * L * t + ny * o });
        }
        strand(pts, color, 2.2, false);
      }
      // ridges: one short diagonal per half twist
      if (count >= 1 && !broken) {
        ctx.strokeStyle = WIRE_HI;
        ctx.lineWidth = 1.1;
        const ridges = Math.floor(count * 2);
        for (let i = 1; i < ridges; i++) {
          const t = i / (count * 2);
          if (t >= 0.97) break;
          const cx = a.x + ux * L * t;
          const cy = a.y + uy * L * t;
          ctx.beginPath();
          ctx.moveTo(cx + nx * amp - ux * 1.6, cy + ny * amp - uy * 1.6);
          ctx.lineTo(cx - nx * amp + ux * 1.6, cy - ny * amp + uy * 1.6);
          ctx.stroke();
        }
      }
    }

    function arrowArc(c: P2, r: number, a0: number, sweep: number, color: string, width = 2.2) {
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, a0, a0 + sweep, sweep < 0);
      ctx.stroke();
      const ae = a0 + sweep;
      const ex = c.x + Math.cos(ae) * r;
      const ey = c.y + Math.sin(ae) * r;
      const dir = Math.sign(sweep);
      const tx = -Math.sin(ae) * dir;
      const ty = Math.cos(ae) * dir;
      const nx = Math.cos(ae);
      const ny = Math.sin(ae);
      ctx.beginPath();
      ctx.moveTo(ex + tx * 7, ey + ty * 7);
      ctx.lineTo(ex - tx * 1 + nx * 4.5, ey - ty * 1 + ny * 4.5);
      ctx.lineTo(ex - tx * 1 - nx * 4.5, ey - ty * 1 - ny * 4.5);
      ctx.closePath();
      ctx.fill();
    }

    function draw(g: Geo) {
      backdrop(ctx, g.w, g.h);
      const now = clock;
      const gleam = flourishT >= 0 ? clamp((now - flourishT) / 0.8, 0, 1) : 0;
      const P = g.plate;

      // header
      const [title, sub] = stepText();
      label(ctx, title, 16, 18, { size: 16, weight: 800, align: 'left' });
      const showHint = hint.until > now;
      const subTxt = showHint ? hint.text : sub;
      ctx.font = `600 12px ${FONT}`;
      const fit = Math.min(12, (12 * (g.w - 28)) / Math.max(1, ctx.measureText(subTxt).width));
      label(ctx, subTxt, 16, 38, { size: fit, weight: 600, color: showHint ? C.seaDeep : C.inkSoft, align: 'left' });

      // plate
      const pg = ctx.createLinearGradient(P.x, P.y, P.x + P.w, P.y + P.h);
      pg.addColorStop(0, shade(C.ink, 0.8));
      pg.addColorStop(1, shade(C.ink, 0.66));
      ctx.fillStyle = pg;
      roundRect(ctx, P.x, P.y, P.w, P.h, 14);
      ctx.fill();
      ctx.strokeStyle = shade(C.ink, 0.5);
      ctx.lineWidth = 1;
      ctx.stroke();
      // machining marks
      ctx.strokeStyle = shade(C.ink, 0.74);
      ctx.lineWidth = 1;
      for (let i = 1; i < 7; i++) {
        ctx.beginPath();
        ctx.moveTo(P.x + 10, P.y + (P.h * i) / 7);
        ctx.lineTo(P.x + P.w - 10, P.y + (P.h * i) / 7 + 3);
        ctx.stroke();
      }
      // 1-inch scale bar
      const sx = P.x + P.w - 14 - P.ppi;
      const sy = P.y + P.h - 12;
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(sx, sy - 4);
      ctx.lineTo(sx, sy);
      ctx.lineTo(sx + P.ppi, sy);
      ctx.lineTo(sx + P.ppi, sy - 4);
      for (let q = 1; q < 4; q++) {
        ctx.moveTo(sx + (P.ppi * q) / 4, sy);
        ctx.lineTo(sx + (P.ppi * q) / 4, sy - 2.5);
      }
      ctx.stroke();
      label(ctx, '1 in', sx + P.ppi / 2, sy - 9, { size: 10, weight: 700, color: C.ink });

      // wire coil (the spool end) until bolt 1 is threaded
      const coil = { x: m.start.x < m.plate.w / 2 ? P.x + 16 : P.x + P.w - 16, y: P.y + P.h - 16 };
      if (run.threaded === 0) {
        ctx.strokeStyle = WIRE;
        ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.arc(coil.x + i * 1.5, coil.y - i, 9 - i * 1.5, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // bosses + heads
      for (let i = 0; i < n; i++) drawBolt(g, i, now);

      // spans (finished and in-progress)
      for (let k = 0; k < n - 1; k++) {
        if (run.threaded <= k) break;
        const a = holeEnd(g, k, sides[k]);
        const b = spanEnd(g, k + 1);
        const active = phase === 'twist' && cur === k;
        const count = active ? twists : run.twists[k] ?? 0;
        if (!active && run.twists[k] == null) continue;
        const isSnap = snapped && snapped.span === k && now - snapped.at < 0.7;
        const tpi = count / m.spans[k];
        const over = run.twists[k] != null && tpi > m.band[1];
        twisted(a, b, count, tpi / m.band[0], isSnap || over ? C.rust : WIRE, !!isSnap);
        if (run.threaded > k + 1) around(g, k + 1, b, -sides[k + 1]);
      }
      // the double-twist loop around each threaded head
      for (let i = 0; i < run.threaded; i++) {
        const done = !m.wrap || run.wraps > i;
        const c = bp(g, i);
        const a0 = Math.atan2(-axis(i, sides[i]).y, -axis(i, sides[i]).x);
        let sweep = done ? Math.PI : 0;
        if (!done && wrapping && cur === i) sweep = clamp(wrapping.acc, -Math.PI * 1.25, Math.PI * 1.25) * (Math.PI / (Math.PI * 1.25));
        // through-hole strand
        strand([holeEnd(g, i, -sides[i]), holeEnd(g, i, sides[i])], WIRE, 2.4);
        if (sweep !== 0) ink(() => ctx.arc(c.x, c.y, g.R + 4, a0, a0 + sweep, sweep < 0), sweep < 0 ? C.rust : WIRE, 2.4);
      }

      // wrong-way thread: rust wire through the hole, head starts backing out
      if (wrong) {
        const k = wrong.bolt;
        const c = bp(g, k);
        const f = clamp((now - wrong.t0) / 0.9, 0, 1);
        if (wrong.s !== 0) strand([holeEnd(g, k, -wrong.s), holeEnd(g, k, wrong.s)], C.rust, 2.4);
        const pull = holeEnd(g, k, wrong.s || 1);
        if (wrong.s !== 0) {
          const e2 = k + 1 < n ? bp(g, k + 1) : k > 0 ? bp(g, k - 1) : pull;
          const dd = Math.hypot(e2.x - pull.x, e2.y - pull.y) || 1;
          strand([pull, { x: pull.x + ((e2.x - pull.x) / dd) * 26, y: pull.y + ((e2.y - pull.y) / dd) * 26 }], C.rust, 2.4);
        }
        ctx.globalAlpha = 0.5 + 0.5 * Math.sin(f * Math.PI);
        arrowArc(c, g.R + 13, -Math.PI * 0.2, -Math.PI * 1.1, C.rust, 2.6);
        ctx.globalAlpha = 1;
        const ly = m.bolts[k].z === 0 && c.y - g.R - 30 > P.y + 8 ? c.y - g.R - 30 : c.y + g.R + 28;
        label(ctx, 'backs out ↺', c.x, ly, { size: 11, weight: 800, color: C.rust });
      }

      // pigtail
      if (phase === 'pigtail' || phase === 'bend' || (phase === 'done' && run.pigtail > 0)) {
        const base = pigBase(g);
        const u = pigDir(g);
        const count = phase === 'pigtail' ? twists : run.pigtail;
        const L = pigLen(g, count);
        const isSnap = snapped && snapped.span === -1 && now - snapped.at < 0.7;
        if (run.bent) {
          // curled back against the head
          const c = bp(g, n - 1);
          const side = { x: -u.y, y: u.x };
          const tipx = c.x + side.x * (g.R + 7) + u.x * 4;
          const tipy = c.y + side.y * (g.R + 7) + u.y * 4;
          ink(() => {
            ctx.moveTo(base.x, base.y);
            ctx.quadraticCurveTo(base.x + u.x * L * 0.8, base.y + u.y * L * 0.8, tipx, tipy);
          }, WIRE, 3.6);
        } else if (phase === 'bend' && tipDrag) {
          const t = tipDrag.at;
          ink(() => {
            ctx.moveTo(base.x, base.y);
            ctx.quadraticCurveTo(base.x + u.x * L * 0.7, base.y + u.y * L * 0.7, t.x, t.y);
          }, WIRE, 3.6);
        } else {
          const end = { x: base.x + u.x * (L + 10), y: base.y + u.y * (L + 10) };
          const tpiLike = count / Math.max(0.1, (L + 10) / P.ppi);
          twisted(base, end, count, tpiLike / 8, isSnap ? C.rust : WIRE, !!isSnap);
        }
      }

      // free wire end + drag
      const tip = tipNow(g);
      if (tip && !wrong && (phase === 'thread' || phase === 'twist' || phase === 'pigtail' || phase === 'bend') && !run.bent) {
        const anchor = phase === 'thread' ? (cur === 0 ? coil : spanEnd(g, cur)) : null;
        if (anchor && phase === 'thread' && (tip.x !== anchor.x || tip.y !== anchor.y)) {
          const mx = (anchor.x + tip.x) / 2;
          const my = (anchor.y + tip.y) / 2 + 10;
          ink(() => {
            ctx.moveTo(anchor.x, anchor.y);
            ctx.quadraticCurveTo(mx, my, tip.x, tip.y);
          }, WIRE, 2.2);
        }
        const ready = phase === 'thread' || phase === 'bend' || twists >= 0.5;
        const pulse = p.reducedMotion || tipDrag ? 0 : 0.5 + 0.5 * Math.sin(now * 5);
        ctx.fillStyle = ready ? C.mech : shade(C.mech, 0.5);
        ctx.strokeStyle = C.ink;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(tip.x, tip.y, 10 + (ready ? pulse * 2 : 0), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = C.ink;
        ctx.beginPath();
        ctx.arc(tip.x, tip.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      // tutorial / repeated-miss ghost: which way to swipe
      if (m.aids.ghost && phase === 'thread' && !wrong && !tipDrag && (m.tier === 0 || wrongTries >= 2)) {
        const s = answer(cur);
        const a = holeEnd(g, cur, -s);
        const b = holeEnd(g, cur, s);
        const u = axis(cur, s);
        ctx.globalAlpha = p.reducedMotion ? 0.7 : 0.55 + 0.25 * Math.sin(now * 4);
        ctx.strokeStyle = C.sea;
        ctx.lineWidth = 3;
        ctx.setLineDash([6, 5]);
        ctx.beginPath();
        ctx.moveTo(a.x - u.x * 22, a.y - u.y * 22);
        ctx.lineTo(b.x + u.x * 18, b.y + u.y * 18);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = C.sea;
        const hx = b.x + u.x * 24;
        const hy = b.y + u.y * 24;
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(hx - u.x * 10 - u.y * 6, hy - u.y * 10 + u.x * 6);
        ctx.lineTo(hx - u.x * 10 + u.y * 6, hy - u.y * 10 - u.x * 6);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      drawGauge(g);
      if (phase === 'pigtail' && twists >= 0.5) {
        const b = doneBtn(g);
        ctx.fillStyle = C.sea;
        roundRect(ctx, b.x, b.y, b.w, b.h, b.h / 2);
        ctx.fill();
        label(ctx, 'Done', b.x + b.w / 2, b.y + b.h / 2 + 1, { size: 15, weight: 700, color: C.white });
      } else drawProgress(g);
      drawPad(g);

      if (gleam > 0 && gleam < 1 && !p.reducedMotion) {
        ctx.globalAlpha = 0.35 * (1 - ease.outCubic(gleam));
        ctx.fillStyle = C.white;
        ctx.fillRect(0, 0, g.w, g.h);
        ctx.globalAlpha = 1;
      }
    }

    function drawBolt(g: Geo, i: number, now: number) {
      const b = m.bolts[i];
      const c = bp(g, i);
      const R = g.R;
      // boss: taller bosses cast longer shadows
      const sh = 2 + b.z * 12;
      ctx.fillStyle = 'rgba(31,42,48,0.18)';
      ctx.beginPath();
      ctx.arc(c.x + sh * 0.6, c.y + sh, R + 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = shade(C.ink, 0.72 + b.z * 0.2);
      ctx.beginPath();
      ctx.arc(c.x, c.y, R + 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = shade(C.ink, 0.5);
      ctx.lineWidth = 1;
      ctx.stroke();
      if (b.z > 0) label(ctx, `boss +${b.z.toFixed(2).replace(/^0/, '')}″`, c.x, c.y - R - 15, { size: 9, weight: 700, color: C.inkSoft });
      // head (backs out a few degrees when threaded the wrong way)
      let rot = m.bolts[i].hole;
      if (wrong && wrong.bolt === i && !p.reducedMotion) rot -= 0.22 * Math.sin(clamp((now - wrong.t0) / 0.9, 0, 1) * Math.PI);
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(rot);
      const hg = ctx.createRadialGradient(-R * 0.3, -R * 0.3, 2, 0, 0, R * 1.1);
      hg.addColorStop(0, shade(C.ink, 0.86));
      hg.addColorStop(1, shade(C.ink, 0.5));
      ctx.fillStyle = hg;
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
        const rr = R / Math.cos(Math.PI / 6);
        ctx.lineTo(Math.cos(a) * rr * 0.93, Math.sin(a) * rr * 0.93);
      }
      ctx.closePath();
      ctx.fill();
      const target = (phase === 'thread' || phase === 'wrap') && cur === i && !wrong;
      ctx.strokeStyle = target ? C.sea : shade(C.ink, 0.25);
      ctx.lineWidth = target ? 2.5 : 1.2;
      ctx.stroke();
      // drilled hole: a channel across the flats, dark holes at both ends
      ctx.strokeStyle = shade(C.ink, 0.35);
      ctx.lineWidth = 3;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(-R * 0.72, 0);
      ctx.lineTo(R * 0.72, 0);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = C.ink;
      for (const sgn of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(sgn * R * 0.8, 0, 2.6, 4.2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      // tightening arrow printed on early tiers
      if (m.aids.arrows && run.threaded <= i) {
        ctx.globalAlpha = 0.85;
        arrowArc(c, R + 17, -Math.PI * 0.95, Math.PI * 0.55, C.palm, 2);
        ctx.globalAlpha = 1;
      }
      label(ctx, String(i + 1), c.x - R - 10, c.y + R + 6, { size: 11, weight: 800, color: C.ink });
      if (flourishT >= 0) {
        const gl = p.reducedMotion ? 0 : clamp((now - flourishT) / 0.8, 0, 1);
        ctx.strokeStyle = C.palm;
        ctx.globalAlpha = 1 - gl;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(c.x, c.y, R + 10 + gl * 14, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    function drawGauge(g: Geo) {
      const G = g.gauge;
      const isPig = phase === 'pigtail' || phase === 'bend' || (phase === 'done' && run.pigtail > 0);
      const active = phase === 'twist' || phase === 'pigtail';
      const k = phase === 'twist' ? cur : Math.max(0, Math.min(n - 2, run.threaded - 2));
      const [lo, hi] = isPig ? m.pigtail : m.band;
      const snapAt = isPig ? m.pigSnap : m.snapTpi;
      const max = snapAt + 1;
      const count = active ? twists : isPig ? run.pigtail : (run.twists[k] ?? 0);
      const val = isPig ? count : count / m.spans[k];
      const show = live || measured || !active;
      const x = (v: number) => G.x0 + (clamp(v, 0, max) / max) * (G.x1 - G.x0);
      ctx.globalAlpha = active || phase === 'done' ? 1 : 0.55;
      // title row
      label(ctx, isPig ? 'Pigtail twists' : `Twists per inch · span ${k + 1} = ${m.spans[k].toFixed(2)} in`, G.x0, G.y - 26, {
        size: 11,
        weight: 700,
        color: C.inkSoft,
        align: 'left',
      });
      const readout = show && (active || count > 0) ? (isPig ? `${Math.floor(val)}` : `${val.toFixed(1)} /in`) : isPig ? '—' : '— /in';
      // from tier 3 the pigtail count is trade knowledge: no band on the gauge
      const banded = !isPig || teach;
      const out = banded && show && (val > hi || (!active && val < lo && count > 0));
      label(ctx, readout, G.x1, G.y - 26, { size: 15, weight: 800, color: out && val > hi ? C.rust : C.ink, align: 'right' });
      // bar
      ctx.fillStyle = shade(C.sandDeep, -0.04);
      roundRect(ctx, G.x0, G.y - 6, G.x1 - G.x0, 12, 6);
      ctx.fill();
      if (banded) {
        ctx.fillStyle = C.palm;
        roundRect(ctx, x(lo), G.y - 6, x(hi) - x(lo), 12, 3);
        ctx.fill();
        ctx.strokeStyle = C.rust;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x(hi) + 2, G.y);
        ctx.lineTo(x(snapAt), G.y);
        ctx.stroke();
        ctx.fillStyle = C.rust;
        ctx.beginPath();
        ctx.arc(x(snapAt), G.y, 3.5, 0, Math.PI * 2);
        ctx.fill();
        label(ctx, String(lo), x(lo), G.y + 16, { size: 10, weight: 700, color: C.palmDark });
        label(ctx, String(hi), x(hi), G.y + 16, { size: 10, weight: 700, color: C.palmDark });
        label(ctx, 'snaps', x(snapAt), G.y + 16, { size: 9, weight: 700, color: C.rust });
      } else {
        // plain count scale
        ctx.strokeStyle = shade(C.ink, 0.45);
        ctx.lineWidth = 1;
        for (let v = 1; v < max; v++) {
          ctx.beginPath();
          ctx.moveTo(x(v), G.y - 4);
          ctx.lineTo(x(v), G.y + 4);
          ctx.stroke();
          if (v % 2 === 0) label(ctx, String(v), x(v), G.y + 16, { size: 10, weight: 700, color: C.inkSoft });
        }
      }
      // needle
      if (show && (count > 0 || active)) {
        const nx = x(val);
        ctx.fillStyle = C.ink;
        ctx.beginPath();
        ctx.moveTo(nx, G.y - 3);
        ctx.lineTo(nx - 6, G.y - 13);
        ctx.lineTo(nx + 6, G.y - 13);
        ctx.closePath();
        ctx.fill();
      }
      // raw twist count (what you'd count by hand)
      if (active) {
        const txt = `${Math.floor(twists)} twist${Math.floor(twists) === 1 ? '' : 's'}${show ? '' : ' · lift to measure'}`;
        label(ctx, txt, (G.x0 + G.x1) / 2, G.y + 30, { size: 12, weight: 700, color: C.ink });
      }
      ctx.globalAlpha = 1;
    }

    function doneBtn(g: Geo) {
      return { x: g.w / 2 - 60, y: g.progY - 22, w: 120, h: 44 };
    }

    function drawProgress(g: Geo) {
      // one dot per real step: thread (and wrap) each bolt, twist each span, pigtail, bend
      const steps: { done: boolean; now: boolean; bad: boolean }[] = [];
      for (let i = 0; i < n; i++) {
        steps.push({ done: run.threaded > i, now: phase === 'thread' && cur === i, bad: false });
        if (m.wrap) steps.push({ done: run.wraps > i, now: phase === 'wrap' && cur === i, bad: false });
        if (i < n - 1) {
          const tw = run.twists[i];
          steps.push({
            done: tw != null,
            now: phase === 'twist' && cur === i,
            bad: tw != null && tpiScore(tw / m.spans[i], m.band) < 1,
          });
        }
      }
      steps.push({ done: phase === 'bend' || run.bent, now: phase === 'pigtail', bad: false });
      steps.push({ done: run.bent, now: phase === 'bend', bad: false });
      const gap = Math.min(22, (g.w - 60) / steps.length);
      const x0 = g.w / 2 - (gap * (steps.length - 1)) / 2;
      steps.forEach((s, i) => {
        ctx.fillStyle = s.done ? (s.bad ? C.mech : C.palm) : s.now ? C.sea : shade(C.sandDeep, -0.08);
        ctx.beginPath();
        ctx.arc(x0 + i * gap, g.progY, s.now ? 6 : 4.5, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    function drawPad(g: Geo) {
      const active = phase === 'twist' || phase === 'pigtail';
      ctx.save();
      ctx.translate(g.padX, g.padY);
      ctx.globalAlpha = active ? 1 : 0.45;
      const dg = ctx.createRadialGradient(-g.padR * 0.3, -g.padR * 0.3, 4, 0, 0, g.padR);
      dg.addColorStop(0, shade(C.mech, 0.35));
      dg.addColorStop(1, shade(C.mech, -0.2));
      ctx.fillStyle = dg;
      ctx.beginPath();
      ctx.arc(0, 0, g.padR, 0, Math.PI * 2);
      ctx.fill();
      ctx.rotate(padAngle);
      ctx.strokeStyle = shade(C.mech, -0.35);
      ctx.lineWidth = 2;
      for (let k = 0; k < 36; k++) {
        const a = (k / 36) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * g.padR * 0.86, Math.sin(a) * g.padR * 0.86);
        ctx.lineTo(Math.cos(a) * g.padR, Math.sin(a) * g.padR);
        ctx.stroke();
      }
      ctx.fillStyle = C.ink;
      ctx.beginPath();
      ctx.arc(0, -g.padR * 0.64, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.globalAlpha = 1;
      const msg = active
        ? twisting
          ? ''
          : 'circle to twist ↻'
        : phase === 'wrap'
          ? 'circle the head'
          : phase === 'done'
            ? ''
            : 'pliers';
      if (msg) label(ctx, msg, g.padX, g.padY, { size: 13, weight: 700, color: C.ink });
    }

    return {
      timeUp(): PuzzleResult {
        finished = true;
        tipDrag = twisting = wrapping = null;
        // an in-progress twist counts as far as it got
        if (phase === 'twist' && twists > 0) run.twists[cur] = twists;
        if (phase === 'pigtail' && twists > 0) run.pigtail = twists;
        phase = 'done';
        return result(scoreWire(m, run), summarize(m, run), dataOf());
      },
      destroy() {
        stop();
        offPtr();
        st.destroy();
      },
    };
  },
};
