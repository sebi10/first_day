// Mechanic · Crack hunt. Fluorescent penetrant inspection in a dark booth.
// The whole part sits under the UV-A lamp. ONE TAP circles an indication (the
// ring snaps to the nearest one), tap it again to clear it; a tap on bare
// metal is a false call.
//
// Under UV a fatigue crack is a fine, tight line with only a slight meander,
// and so is a tool mark, a scribe line, a strand of lint or a thread of excess
// penetrant caught in a radius. From tier 3 every one of them is drawn the same
// way, so shape tells you nothing. An inspector sorts them by:
//  - location: a crack starts at a stress riser (a fastener-hole wall, a fillet
//    radius, a free edge); a scratch out in open metal is not a crack;
//  - orientation against the load: on a spar cap a crack at a hole runs across
//    the spar (chordwise); a line running spanwise past a hole is a tool or
//    scribe mark. On a wheel half, bolt-hole and bore cracks run radially and
//    radius cracks run round the wheel; a mark running round past a bolt hole
//    is a tool mark;
//  - bleed-back: Swab the part (solvent-dampened swab, then a light re-dust of
//    developer). A crack holds penetrant and bleeds back within a second or
//    two; residue (a penetrant thread in a radius, lint, developer specks,
//    excess penetrant at an edge) is gone for good. A tool mark is a groove:
//    it bleeds back just like a crack, so at a hole only orientation decides it.
// Two non-linear indications round it out: penetrant trapped in a fastener
// bore bleeds out all round the hole with no linear tail (and re-bleeds), and
// porosity in a cast wheel is rounded, not linear.
// Tiers 0–2 print the rules and keep cracks bright; from tier 3 cracks are
// tight and faint, decoys are just as bright and nothing is printed.
// Non-aqueous developer (tool id 'borescope') makes bleed-back faster and
// brighter; the UV floodlamp ('uvPlus') makes every indication brighter.
import { rng, type Rng } from '../sim/rng';
import { C, FONT, clamp, ease, fitLabel, label, loop, pointer, roundRect, settle, stage } from './kit';
import { result, type PuzzleDef, type PuzzleResult } from './types';

type P = { x: number; y: number };
export type Kind = 'crack' | 'toolmark' | 'trapped' | 'lint' | 'scratch' | 'bleedout' | 'porosity' | 'specks' | 'smear';
export type Riser = 'hole' | 'fillet' | 'edge';
/** how an indication is drawn: everything a player can see about its shape */
export type Style = 'line' | 'scratch' | 'dots' | 'wash' | 'halo';
/** pts: a polyline (dots: the dot centres; halo: a ring round the hole), in frame units: x 0..aspect, y 0..1 */
export type Indication = { kind: Kind; pts: P[]; glow: number; riser?: Riser };
export type Hole = { x: number; y: number; r: number };
export type CrackModel = {
  part: 'spar' | 'hub';
  name: string;
  /** frame width / height; coordinates run x 0..aspect, y 0..1 */
  aspect: number;
  holes: Hole[];
  /** fillet radii and free edges as polylines (stress risers) */
  fillets: P[][];
  edges: P[][];
  indications: Indication[];
  cracks: number;
  /** seconds after a swab before penetrant starts to bleed back out of a flaw */
  bleedDelay: number;
  /** bleed-back time constant, seconds */
  bleedTau: number;
  /** UV-A at the part, µW/cm² (a raw reading) */
  uv: number;
  developer: 'dry' | 'non-aqueous';
  teach: boolean;
  hints: string[];
};

// ---------------------------------------------------------------- geometry

const TAU = Math.PI * 2;

function circle(cx: number, cy: number, r: number, n = 72): P[] {
  const pts: P[] = [];
  for (let i = 0; i <= n; i++) pts.push({ x: cx + Math.cos((i / n) * TAU) * r, y: cy + Math.sin((i / n) * TAU) * r });
  return pts;
}

function segDist(p: P, a: P, b: P) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** distance from p to a polyline */
export function distToLine(p: P, pts: P[]) {
  if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y);
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) best = Math.min(best, segDist(p, pts[i - 1], pts[i]));
  return best;
}

const isDots = (k: Kind) => k === 'porosity' || k === 'specks';

/** distance from p to an indication (dots are separate points, the rest are lines) */
export function distToInd(p: P, ind: Indication) {
  if (isDots(ind.kind)) return Math.min(...ind.pts.map((q) => Math.hypot(p.x - q.x, p.y - q.y)));
  return distToLine(p, ind.pts);
}

/** how far p is from the nearest stress riser (hole wall, fillet radius, free edge) */
export function riserDist(m: Pick<CrackModel, 'holes' | 'fillets' | 'edges'>, p: P) {
  let d = Infinity;
  for (const h of m.holes) d = Math.min(d, Math.abs(Math.hypot(p.x - h.x, p.y - h.y) - h.r));
  for (const f of [...m.fillets, ...m.edges]) d = Math.min(d, distToLine(p, f));
  return d;
}

/** densify a polyline so distance checks between shapes are fair */
function dense(pts: P[], step = 0.01): P[] {
  if (pts.length < 2) return pts;
  const out: P[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 1; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return out;
}

const body = (ind: Indication) => (isDots(ind.kind) ? ind.pts : dense(ind.pts));

function gap(a: Indication, b: Indication) {
  let best = Infinity;
  for (const q of body(a)) best = Math.min(best, distToInd(q, b));
  return best;
}

type Geom = Pick<CrackModel, 'part' | 'aspect' | 'holes' | 'fillets' | 'edges'> & {
  onMetal(p: P, margin?: number): boolean;
  /** riserDist, worked out from the geometry (the same answer, much faster) */
  riser(p: P): number;
  /** the wheel centre (hub only) */
  c: P;
};

// Wing spar / deck beam, standing on end so it fills a portrait phone: a cap
// (flange) down each side with a row of fastener holes, a web between them with
// two flanged lightening holes. The spar carries load along its length (up/down),
// so fatigue cracks at holes and edges run across it, left/right (chordwise).
// Cracks along the cap-to-web radius run spanwise: stress-corrosion cracking in
// the extrusion, not fatigue.
const SPAR = { A: 0.6, e: 0.025, cap: 0.14 };
function sparGeom(): Geom {
  const { A, e, cap } = SPAR;
  const holes: Hole[] = [];
  for (let i = 0; i < 7; i++) {
    const y = 0.07 + i * 0.143;
    holes.push({ x: e + cap / 2, y, r: 0.016 }, { x: A - e - cap / 2, y, r: 0.016 });
  }
  holes.push({ x: A / 2, y: 0.28, r: 0.075 }, { x: A / 2, y: 0.72, r: 0.075 });
  const line = (x: number) => [
    { x, y: 0 },
    { x, y: 1 },
  ];
  return {
    part: 'spar',
    aspect: A,
    holes,
    fillets: [line(e + cap), line(A - e - cap)],
    edges: [line(e), line(A - e)],
    c: { x: A / 2, y: 0.5 },
    riser: (p) => {
      let d = Math.min(Math.abs(p.x - e), Math.abs(p.x - (A - e)), Math.abs(p.x - (e + cap)), Math.abs(p.x - (A - e - cap)));
      for (const h of holes) d = Math.min(d, Math.abs(Math.hypot(p.x - h.x, p.y - h.y) - h.r));
      return d;
    },
    onMetal: (p, mg = 0.004) =>
      p.x > e + mg && p.x < A - e - mg && p.y > 0.015 && p.y < 0.985 && holes.every((h) => Math.hypot(p.x - h.x, p.y - h.y) > h.r + mg),
  };
}

// Wheel half, face on: rim flange edge, bead seat radius, web with the tie-bolt
// circle, hub fillet, bearing bore. Bolt-hole and bore cracks run radially;
// radius cracks run round the wheel.
const HUB = { rim: 0.48, bead: 0.4, bolt: 0.3, fillet: 0.2, bore: 0.12 };
function hubGeom(): Geom {
  const c = { x: 0.5, y: 0.5 };
  const holes: Hole[] = [{ x: c.x, y: c.y, r: HUB.bore }];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + Math.PI / 8;
    holes.push({ x: c.x + Math.cos(a) * HUB.bolt, y: c.y + Math.sin(a) * HUB.bolt, r: 0.022 });
  }
  return {
    part: 'hub',
    aspect: 1,
    holes,
    fillets: [circle(c.x, c.y, HUB.bead), circle(c.x, c.y, HUB.fillet)],
    edges: [circle(c.x, c.y, HUB.rim)],
    c,
    riser: (p) => {
      const r = Math.hypot(p.x - c.x, p.y - c.y);
      let d = Math.min(Math.abs(r - HUB.rim), Math.abs(r - HUB.bead), Math.abs(r - HUB.fillet));
      for (const h of holes) d = Math.min(d, Math.abs(Math.hypot(p.x - h.x, p.y - h.y) - h.r));
      return d;
    },
    onMetal: (p, mg = 0.004) => {
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      return d > HUB.bore + mg && d < HUB.rim - mg && holes.every((h) => Math.hypot(p.x - h.x, p.y - h.y) > h.r + mg);
    },
  };
}

// ---------------------------------------------------------------- shapes

/** a fine, tight line with a slight meander: a crack under UV, and everything that mimics one */
function fine(r: Rng, from: P, angle: number, len: number, steps = 9): P[] {
  const pts: P[] = [from];
  let a = angle + r.range(-0.12, 0.12);
  let cur = from;
  for (let i = 0; i < steps; i++) {
    a = angle + clamp((a - angle) * 0.6 + r.range(-0.17, 0.17), -0.26, 0.26);
    const l = (len / steps) * r.range(0.8, 1.2);
    cur = { x: cur.x + Math.cos(a) * l, y: cur.y + Math.sin(a) * l };
    pts.push(cur);
  }
  return pts;
}

/** small offsets across a radius line: a slight, irregular meander */
function wander(r: Rng, steps: number): { t: number; d: number }[] {
  const out = [{ t: 0, d: r.range(-0.002, 0.002) }];
  let t = 0;
  let d = out[0].d;
  const w = Array.from({ length: steps }, () => r.range(0.7, 1.3));
  const sum = w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < steps; i++) {
    t += w[i] / sum;
    d = clamp(d * 0.5 + r.range(-0.0035, 0.0035), -0.0045, 0.0045);
    out.push({ t, d });
  }
  return out;
}

function alongLine(r: Rng, x: number, y0: number, dir: number, len: number, steps = 9): P[] {
  return wander(r, steps).map(({ t, d }) => ({ x: x + d, y: y0 + dir * len * t }));
}

function alongArc(r: Rng, c: P, rad: number, a0: number, len: number, steps = 9): P[] {
  const dir = r.chance(0.5) ? 1 : -1;
  return wander(r, steps).map(({ t, d }) => {
    const a = a0 + dir * (len / rad) * t;
    return { x: c.x + Math.cos(a) * (rad + d), y: c.y + Math.sin(a) * (rad + d) };
  });
}

/** a line along a fillet radius (a radius crack, or anything lying in the radius) */
function inRadius(r: Rng, g: Geom, len: number): P[] {
  if (g.part === 'spar') return alongLine(r, r.pick(g.fillets)[0].x, r.range(0.06, 0.94), r.chance(0.5) ? 1 : -1, len);
  const rad = r.chance(0.6) ? HUB.bead : HUB.fillet;
  return alongArc(r, g.c, rad, r.range(0, TAU), len);
}

const small = (g: Geom) => g.holes.filter((h) => h.r < 0.05);

/**
 * A line that starts at a riser and runs the way a crack there runs. `kind` is
 * 'crack', or 'lint' for a fibre that happens to lie exactly like one.
 */
function crackAt(r: Rng, g: Geom, riser: Riser, len: number, kind: 'crack' | 'lint' = 'crack'): Indication {
  const spar = g.part === 'spar';
  if (riser === 'hole') {
    const h = r.pick(g.holes);
    let a: number;
    if (spar) a = (r.chance(0.5) ? 0 : Math.PI) + r.range(-0.25, 0.25); // chordwise
    else if (h.r > 0.05) a = r.range(0, TAU); // bearing bore: radial, any clock position
    else a = Math.atan2(h.y - g.c.y, h.x - g.c.x) + (r.chance(0.5) ? 0 : Math.PI) + r.range(-0.25, 0.25); // radial
    const start = { x: h.x + Math.cos(a) * (h.r + 0.002), y: h.y + Math.sin(a) * (h.r + 0.002) };
    return { kind, riser, pts: fine(r, start, a, len), glow: 1 };
  }
  if (riser === 'fillet') return { kind, riser, pts: inRadius(r, g, len * 1.2), glow: 1 };
  // free edge: the crack runs in from the edge
  if (spar) {
    const left = r.chance(0.5);
    const start = { x: left ? SPAR.e + 0.001 : SPAR.A - SPAR.e - 0.001, y: r.range(0.05, 0.95) };
    return { kind, riser, pts: fine(r, start, (left ? 0 : Math.PI) + r.range(-0.25, 0.25), len * 0.8), glow: 1 };
  }
  const a = r.range(0, TAU);
  const start = { x: g.c.x + Math.cos(a) * (HUB.rim - 0.001), y: g.c.y + Math.sin(a) * (HUB.rim - 0.001) };
  return { kind, riser, pts: fine(r, start, a + Math.PI + r.range(-0.25, 0.25), len * 0.8), glow: 1 };
}

/**
 * A tool or scribe mark that grazes a fastener hole: spanwise past it on a spar,
 * round the wheel past a bolt hole. It passes the hole; it never runs out of it.
 */
function toolmarkAt(r: Rng, g: Geom): Indication {
  const h = r.pick(small(g));
  const off = h.r + r.range(0.003, 0.007);
  let side: number; // where on the hole wall it passes
  if (g.part === 'spar') side = r.chance(0.5) ? 0 : Math.PI;
  else side = Math.atan2(h.y - g.c.y, h.x - g.c.x) + (r.chance(0.5) ? 0 : Math.PI);
  const at = { x: h.x + Math.cos(side) * off, y: h.y + Math.sin(side) * off };
  const dir = side + Math.PI / 2 + r.range(-0.08, 0.08) + (r.chance(0.5) ? Math.PI : 0);
  // the ends stay well clear of the hole, so nothing about it starts at the wall
  const reach = Math.sqrt((h.r + 0.017) ** 2 - h.r ** 2);
  const before = reach + r.range(0, 0.01);
  const after = reach + r.range(0, 0.01);
  const start = { x: at.x - Math.cos(dir) * before, y: at.y - Math.sin(dir) * before };
  return { kind: 'toolmark', riser: 'hole', pts: fine(r, start, dir, before + after), glow: 1 };
}

/** penetrant trapped in a fastener bore, bleeding out all round the hole: no linear tail */
function bleedoutAt(r: Rng, g: Geom): Indication {
  const h = r.pick(small(g));
  return { kind: 'bleedout', riser: 'hole', pts: circle(h.x, h.y, h.r + 0.007, 36), glow: 1 };
}

function somewhere(r: Rng, g: Geom): P {
  for (let i = 0; i < 200; i++) {
    const p = { x: r.range(0, g.aspect), y: r.range(0, 1) };
    if (g.onMetal(p, 0.03)) return p;
  }
  return g.part === 'spar' ? { x: SPAR.A / 2, y: 0.5 } : { x: 0.5, y: 0.5 + HUB.bolt };
}

function dotsAt(r: Rng, g: Geom, kind: 'porosity' | 'specks'): Indication {
  const p = somewhere(r, g);
  const n = kind === 'porosity' ? r.int(5, 8) : r.int(7, 10);
  const spread = kind === 'porosity' ? 0.028 : 0.032;
  const pts: P[] = [];
  for (let i = 0; i < n; i++) {
    const a = r.range(0, TAU);
    const d = r.range(0.004, spread);
    pts.push({ x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d });
  }
  return { kind, pts, glow: 1 };
}

function scratchAt(r: Rng, g: Geom, tier: number, relax: boolean): Indication {
  const spar = g.part === 'spar';
  const p = somewhere(r, g);
  if (tier <= 2) {
    const l = (spar ? r.range(0.09, 0.13) : r.range(0.08, 0.12)) * (relax ? 0.7 : 1);
    // while teaching: a dead-straight tool mark (machining runs along a spar)
    const a = spar ? Math.PI / 2 + r.range(-0.2, 0.2) : r.range(0, Math.PI);
    return {
      kind: 'scratch',
      pts: [
        { x: p.x - (Math.cos(a) * l) / 2, y: p.y - (Math.sin(a) * l) / 2 },
        { x: p.x + (Math.cos(a) * l) / 2, y: p.y + (Math.sin(a) * l) / 2 },
      ],
      glow: 1,
    };
  }
  // from tier 3 it is as long as a crack and drawn like one: only where it sits gives it away
  const l = (spar ? r.range(0.06, 0.085) : r.range(0.075, 0.1)) * (relax ? 0.8 : 1);
  const a = r.range(0, TAU);
  return { kind: 'scratch', pts: fine(r, { x: p.x - (Math.cos(a) * l) / 2, y: p.y - (Math.sin(a) * l) / 2 }, a, l), glow: 1 };
}

/** excess penetrant left along a free edge (poor removal): a broad soft wash */
function smearAt(r: Rng, g: Geom): Indication {
  if (g.part === 'spar') {
    const x = r.chance(0.5) ? SPAR.e + 0.016 : SPAR.A - SPAR.e - 0.016;
    const y0 = r.range(0.04, 0.8);
    const l = r.range(0.1, 0.16);
    const pts: P[] = [];
    for (let k = 0; k <= 8; k++) pts.push({ x: x + r.range(-0.0015, 0.0015), y: y0 + (l * k) / 8 });
    return { kind: 'smear', pts, glow: 1 };
  }
  const rad = HUB.rim - 0.026;
  const a0 = r.range(0, TAU);
  const l = r.range(0.13, 0.2);
  const pts: P[] = [];
  for (let k = 0; k <= 10; k++) {
    const a = a0 + (l / rad) * (k / 10);
    const rr = rad + r.range(-0.0015, 0.0015);
    pts.push({ x: g.c.x + Math.cos(a) * rr, y: g.c.y + Math.sin(a) * rr });
  }
  return { kind: 'smear', pts, glow: 1 };
}

function fits(g: Geom, ind: Indication, placed: Indication[], sep: number, relax: boolean) {
  const b = body(ind);
  // cracks (and lint lying like one) start on the riser itself: edge cracks start on the edge
  const skip = ind.kind === 'crack' || ind.kind === 'lint' ? 2 : 0;
  const margin = ind.kind === 'smear' || ind.kind === 'toolmark' ? 0.002 : ind.kind === 'bleedout' ? 0.003 : 0.006;
  if (!b.slice(skip).every((q) => g.onMetal(q, margin))) return false;
  if (ind.kind === 'scratch' || isDots(ind.kind)) {
    // out in open metal: well clear of every riser, so where it sits reads plainly
    const clear = relax ? 0.026 : 0.035;
    if (b.some((q) => g.riser(q) < clear)) return false;
  }
  if (ind.kind === 'toolmark') {
    // grazes its hole, and neither end sits on any riser
    const ends = [ind.pts[0], ind.pts[ind.pts.length - 1]];
    if (ends.some((q) => g.riser(q) < 0.015)) return false;
    if (Math.min(...b.map((q) => g.riser(q))) > 0.01) return false;
  }
  const bb = bbox(ind.pts);
  return placed.every((o) => {
    // most pairs are nowhere near each other: skip the exact check
    const ob = bbox(o.pts);
    if (bb.x0 - ob.x1 > sep || ob.x0 - bb.x1 > sep || bb.y0 - ob.y1 > sep || ob.y0 - bb.y1 > sep) return true;
    return gap(ind, o) > sep && gap(o, ind) > sep;
  });
}

function bbox(pts: P[]) {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const q of pts) {
    x0 = Math.min(x0, q.x);
    x1 = Math.max(x1, q.x);
    y0 = Math.min(y0, q.y);
    y1 = Math.max(y1, q.y);
  }
  return { x0, x1, y0, y1 };
}

// ---------------------------------------------------------------- model

type Slot = Exclude<Kind, 'crack' | 'porosity' | 'specks'> | 'dots';
const PLAN: { cracks: number; decoys: Slot[] }[] = [
  { cracks: 1, decoys: ['smear'] },
  { cracks: 2, decoys: ['smear', 'scratch'] },
  { cracks: 2, decoys: ['smear', 'scratch', 'dots'] },
  // from tier 3 the line decoys that only knowledge sorts: tool marks at holes
  // (orientation), penetrant in a radius (bleed-back), lint lying like a crack (bleed-back)
  { cracks: 3, decoys: ['toolmark', 'toolmark', 'trapped', 'bleedout', 'smear', 'scratch', 'dots'] },
  { cracks: 3, decoys: ['toolmark', 'toolmark', 'trapped', 'lint', 'bleedout', 'smear', 'scratch', 'dots'] },
  { cracks: 4, decoys: ['toolmark', 'toolmark', 'trapped', 'lint', 'bleedout', 'smear', 'scratch', 'dots'] },
];

/** what a tier puts on a part: the crack count and the decoys (porosity on a cast wheel, developer specks on a spar) */
export function crackPlan(part: CrackModel['part'], tier: number): { cracks: number; decoys: Exclude<Kind, 'crack'>[] } {
  const p = PLAN[clamp(Math.round(tier), 0, 5)];
  return { cracks: p.cracks, decoys: p.decoys.map((d) => (d === 'dots' ? (part === 'hub' ? 'porosity' : 'specks') : d)) };
}

function make(r: Rng, g: Geom, kind: Kind, T: number, relax: boolean): Indication {
  const lenBase = ((g.part === 'spar' ? 0.08 : 0.1) - T * 0.004) * r.range(0.9, 1.2) * (relax ? 0.8 : 1);
  switch (kind) {
    case 'crack': {
      const riser: Riser = T <= 1 ? (r.chance(0.7) ? 'hole' : 'edge') : (r.weighted(['hole', 'fillet', 'edge'] as const, (x) => (x === 'hole' ? 2 : 1)) ?? 'hole');
      return crackAt(r, g, riser, lenBase);
    }
    case 'lint':
      // a fibre lying in a radius or running in from an edge, just where a crack
      // would be: only a swab tells. (Never at a hole: there, a line running out
      // the way a crack runs is always a crack.)
      return crackAt(r, g, r.chance(0.5) ? 'fillet' : 'edge', lenBase, 'lint');
    case 'trapped':
      return { kind, riser: 'fillet', pts: inRadius(r, g, lenBase * 1.2), glow: 1 };
    case 'toolmark':
      return toolmarkAt(r, g);
    case 'bleedout':
      return bleedoutAt(r, g);
    case 'scratch':
      return scratchAt(r, g, T, relax);
    case 'porosity':
    case 'specks':
      return dotsAt(r, g, kind);
    case 'smear':
      return smearAt(r, g);
  }
}

// the most constrained first: riser shapes, then edge residue, then open metal
const ORDER: Kind[] = ['crack', 'toolmark', 'bleedout', 'trapped', 'lint', 'smear', 'scratch', 'porosity', 'specks'];

export function generateCrack(seed: number, tier: number, tools: string[] = [], job?: string): CrackModel {
  const r = rng(seed);
  const T = clamp(Math.round(tier), 0, 5);
  const coin = r.chance(0.5);
  // the job decides the part: spar inspections look at a spar, the wheel-half check at a wheel
  const part: CrackModel['part'] = job === 'spar' || job === 'project' ? 'spar' : job === 'corrosion' ? 'hub' : coin ? 'spar' : 'hub';
  const name = part === 'hub' ? 'Wheel half' : job === 'project' ? 'Aluminium deck beam' : 'Wing spar';
  const g = part === 'spar' ? sparGeom() : hubGeom();
  const sep = part === 'spar' ? 0.07 : 0.085;
  const nad = tools.includes('borescope');
  const uvPlus = tools.includes('uvPlus');

  const plan = crackPlan(part, T);
  const want: Kind[] = [...Array<Kind>(plan.cracks).fill('crack'), ...plan.decoys].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  // lay the whole plan out; if one piece won't fit, start the layout again
  let best: Indication[] = [];
  for (let attempt = 0; attempt < 16 && best.length < want.length; attempt++) {
    const placed: Indication[] = [];
    for (const kind of want) {
      for (let tries = 0; tries < 60; tries++) {
        const relax = tries >= 30;
        const ind = make(r, g, kind, T, relax);
        if (fits(g, ind, placed, sep, relax)) {
          placed.push(ind);
          break;
        }
      }
    }
    if (placed.length > best.length) best = placed;
  }
  const placed = best;

  // brightness: cracks are bright while teaching, tight and faint from tier 3.
  // Decoys are a touch dimmer while teaching; from tier 3 every line glows like
  // a crack does and the rest are at least as bright, so brightness tells you nothing
  const bright = (T <= 2 ? 1 : [0.62, 0.56, 0.5][T - 3]) * (uvPlus ? 1.3 : 1) * (nad ? 1.12 : 1);
  const lineLike = (k: Kind) => k === 'crack' || k === 'toolmark' || k === 'trapped' || k === 'lint' || k === 'scratch';
  for (const ind of placed) {
    const own = ind.kind === 'crack' ? (T <= 2 ? r.range(0.92, 1) : r.range(0.82, 1)) : T <= 2 ? r.range(0.62, 0.72) : lineLike(ind.kind) ? r.range(0.82, 1) : r.range(0.9, 1.08);
    ind.glow = clamp(T <= 2 && ind.kind !== 'crack' ? own * (uvPlus ? 1.3 : 1) : bright * own, 0.2, 1);
  }

  const hints =
    T > 2
      ? []
      : [
          'Tap Swab: a crack bleeds back, residue doesn’t.',
          'Cracks start at a hole, a radius or an edge.',
          part === 'spar' ? 'Spar: a crack at a hole runs across the spar.' : 'Wheel: cracks run out from holes, and round radii.',
          ...(T >= 1 ? ['A scratch out in open metal isn’t a crack.'] : []),
          ...(T >= 2 ? [part === 'hub' ? 'Round dots are porosity: not a crack.' : 'Developer specks swab off: not a crack.'] : []),
        ];

  return {
    part,
    name,
    aspect: g.aspect,
    holes: g.holes,
    fillets: g.fillets,
    edges: g.edges,
    indications: r.shuffle(placed),
    cracks: placed.filter((i) => i.kind === 'crack').length,
    bleedDelay: nad ? 0.2 : 0.45,
    bleedTau: (nad ? 0.35 : 0.7) * (T >= 4 ? 1.2 : 1),
    uv: uvPlus ? 2600 : 1200,
    developer: nad ? 'non-aqueous' : 'dry',
    teach: T <= 2,
    hints,
  };
}

/** how an indication is drawn. From tier 3 every linear indication looks the same. */
export function styleOf(m: Pick<CrackModel, 'teach'>, ind: Pick<Indication, 'kind'>): Style {
  if (isDots(ind.kind)) return 'dots';
  if (ind.kind === 'smear') return 'wash';
  if (ind.kind === 'bleedout') return 'halo';
  if (ind.kind === 'scratch' && m.teach) return 'scratch';
  return 'line';
}

/**
 * What the booth shows for one indication.
 * since: seconds since the surface was last cleared (for an unswabbed part, since it was developed);
 * swabbed: how many swabs have gone over it.
 * glow 0..1 is brightness, spread 0..1 is how far the penetrant has bled sideways.
 */
export function surface(m: Pick<CrackModel, 'bleedDelay' | 'bleedTau'>, ind: Indication, since: number, swabbed: number) {
  const k = ind.kind;
  if (swabbed === 0) {
    // as developed: everything shows. Anything holding liquid penetrant (a flaw,
    // a groove, a thread of excess, a soaked fibre) keeps bleeding into the developer.
    if (k === 'smear' || k === 'specks') return { glow: ind.glow, spread: 0 };
    return { glow: ind.glow * (0.72 + 0.28 * (1 - Math.exp(-since / 2.5))), spread: clamp(0.25 + since / 8, 0, 0.75) };
  }
  const t = since - m.bleedDelay;
  if (t <= 0) return { glow: 0, spread: 0 };
  const back = 1 - Math.exp(-t / m.bleedTau);
  // a flaw holds a reservoir of penetrant: it bleeds back, a little weaker each swab
  const drain = Math.max(0.6, Math.pow(0.88, swabbed - 1));
  // so does a tool mark: a groove holds penetrant and bleeds back just like a
  // crack, so at a fastener hole it is the orientation that gives it away
  if (k === 'crack' || k === 'toolmark' || k === 'porosity' || k === 'bleedout') return { glow: ind.glow * back * drain, spread: clamp(t / 3, 0, 1) };
  // a shallow scratch holds a trace: it comes back faint and crisp
  if (k === 'scratch') return { glow: ind.glow * 0.28 * back, spread: 0 };
  // residue (excess penetrant, lint, developer specks) was only ever on the surface
  return { glow: 0, spread: 0 };
}

/** the indication nearest p within maxD (only those `can` allows), or -1 */
export function nearest(m: CrackModel, p: P, maxD: number, can: (i: number) => boolean = () => true) {
  let best = -1;
  let bd = maxD;
  m.indications.forEach((ind, i) => {
    if (!can(i)) return;
    const d = distToInd(p, ind);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

/** what one false call costs: a quarter, and always less than a missed crack */
export const falseCallCost = (cracks: number) => Math.min(0.25, 0.9 / Math.max(1, cracks));

/** tagged: indication indices circled; bare: calls on bare metal */
export function scoreCrack(m: CrackModel, tagged: number[], bare = 0) {
  let found = 0;
  let wrong = 0;
  for (const i of new Set(tagged)) {
    if (m.indications[i]?.kind === 'crack') found++;
    else wrong++;
  }
  const falseCalls = wrong + bare;
  const score = Math.round(clamp(found / Math.max(1, m.cracks) - falseCallCost(m.cracks) * falseCalls, 0, 1) * 1000) / 1000;
  return { score, found, falseCalls, missed: m.cracks - found };
}

// ---------------------------------------------------------------- puzzle

const GLOW = '201,245,74'; // fluorescent yellow-green
const CORE = '236,255,170';
const SNAP_PX = 28;
const VISIBLE = 0.08;
/** an indication you saw a moment ago can still be circled while it bleeds back */
const GRACE = 1.5;
const SWAB_DUR = 0.6;

type Rect = { x: number; y: number; w: number; h: number };
const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

export const crack: PuzzleDef = {
  id: 'crack',
  role: 'mech',
  title: 'Crack hunt',
  gesture: 'Tap to circle + swab',
  howTo: 'Tap each crack to circle it. Swab to see what bleeds back.',
  term: 'Penetrant inspection: dye in a crack glows under UV and bleeds back after a swab.',
  seconds: (tier) => 50 + tier * 10,
  mount(host, p) {
    const m = generateCrack(p.seed, p.tier, p.tools, p.context?.job);
    const st = stage(host.el);
    const { ctx } = st;
    const n = m.indications.length;
    let clock = 0;
    // the part came out of the developer a moment before the booth light came on
    const clearAt = new Array<number>(n).fill(-1.2);
    const pending = new Array<number | null>(n).fill(null);
    const swabCount = new Array<number>(n).fill(0);
    const seenAt = new Array<number>(n).fill(-99);
    const looks = m.indications.map(() => ({ glow: 0, spread: 0 }));
    let swabStart = -99;
    let swabs = 0;
    const tagged = new Map<number, number>(); // indication -> clock when circled
    const bare: { x: number; y: number; t: number }[] = [];
    const gone: { x: number; y: number; r: number; t: number }[] = [];
    const ripples: { x: number; y: number; t: number }[] = [];
    let finished = false;
    let revealT = 0;
    // fresh developer dusted on after a swab (cosmetic)
    const dr = rng((p.seed ^ 0x5eed) >>> 0);
    const dust = Array.from({ length: 150 }, () => ({ x: dr.next() * m.aspect, y: dr.next(), r: dr.range(0.5, 1.3) }));

    const geo = () => {
      const w = st.w;
      const h = st.h;
      const top = 40;
      const btnH = 52;
      const btnY = h - btnH - 14;
      const infoY = btnY - 20;
      const bottom = infoY - 16;
      const availW = w - 16;
      const availH = Math.max(80, bottom - top);
      const s = Math.min(availW / m.aspect, availH);
      const pw = s * m.aspect;
      const ph = s;
      const x = (w - pw) / 2;
      // sit low: the thumb reaches the part more easily near the buttons
      const y = top + (availH - ph) * 0.62;
      const gapX = 12;
      // the thumb row: full width on a phone, capped and centred on a wide screen
      const rowW = Math.min(w - 32, 440);
      const rowX = (w - rowW) / 2;
      const swabW = Math.round((rowW - gapX) * 0.42);
      return {
        w,
        h,
        x,
        y,
        s,
        pw,
        ph,
        btnY,
        btnH,
        infoY,
        swabBtn: { x: rowX, y: btnY, w: swabW, h: btnH },
        signBtn: { x: rowX + swabW + gapX, y: btnY, w: rowW - swabW - gapX, h: btnH },
      };
    };
    type G = ReturnType<typeof geo>;
    const X = (g: G, x: number) => g.x + x * g.s;
    const Y = (g: G, y: number) => g.y + y * g.s;
    const toN = (g: G, x: number, y: number): P => ({ x: (x - g.x) / g.s, y: (y - g.y) / g.s });
    const inRect = (pt: { x: number; y: number }, b: Rect, pad = 4) => pt.x >= b.x - pad && pt.x <= b.x + b.w + pad && pt.y >= b.y - pad && pt.y <= b.y + b.h + pad;
    const geom = m.part === 'spar' ? sparGeom() : hubGeom();
    const onMetal = (q: P) => geom.onMetal(q, 0);

    const plural = (k: number, w: string) => `${k} ${w}${k === 1 ? '' : 's'}`;
    const status = () => host.status([`${tagged.size} circled`, ...(bare.length ? [`${bare.length} on bare metal`] : []), plural(swabs, 'swab')].join(' · '));
    status();

    const swabbing = () => clock - swabStart < SWAB_DUR;
    function swab() {
      if (finished || swabbing()) return;
      swabs++;
      swabStart = clock;
      const dur = p.reducedMotion ? 0 : SWAB_DUR;
      m.indications.forEach((ind, i) => {
        const y0 = Math.min(...ind.pts.map((q) => q.y));
        pending[i] = clock + dur * clamp((y0 + 0.05) / 1.1, 0, 1);
      });
      host.fx.swipe();
      host.fx.tap();
      status();
    }

    // what a tap can snap to: anything you can see, anything already circled, and
    // anything you saw a moment ago (it may be mid-swab, about to bleed back)
    const canSnap = (k: number) => tagged.has(k) || clock - seenAt[k] < GRACE;

    function tapPart(g: G, x: number, y: number) {
      const q = toN(g, x, y);
      const R = SNAP_PX / g.s;
      ripples.push({ x, y, t: clock });
      // the nearest bare-metal '?' mark within reach
      let bi = -1;
      let bd = R * 0.9;
      bare.forEach((b, k) => {
        const d = Math.hypot(b.x - q.x, b.y - q.y);
        if (d < bd) {
          bd = d;
          bi = k;
        }
      });
      const i = nearest(m, q, R, canSnap);
      const di = i >= 0 ? distToInd(q, m.indications[i]) : Infinity;
      if (i >= 0 && !tagged.has(i)) {
        // circle it; a '?' dropped here before it bled back becomes this ring
        if (bi >= 0) {
          const b = bare.splice(bi, 1)[0];
          gone.push({ x: X(g, b.x), y: Y(g, b.y), r: 13, t: clock });
        }
        tagged.set(i, clock);
        host.fx.snap();
      } else if (bi >= 0 && bd <= di) {
        const b = bare.splice(bi, 1)[0];
        gone.push({ x: X(g, b.x), y: Y(g, b.y), r: 13, t: clock });
        host.fx.tap();
      } else if (i >= 0) {
        tagged.delete(i);
        const ring = ringOf(g, i);
        gone.push({ x: ring.cx, y: ring.cy, r: ring.r, t: clock });
        host.fx.tap();
      } else if (onMetal(q)) {
        bare.push({ x: q.x, y: q.y, t: clock });
        host.fx.bad();
      } else host.fx.tap();
      status();
    }

    const offPtr = pointer(st.canvas, {
      down(pt) {
        if (finished || host.paused()) return;
        const g = geo();
        if (inRect(pt, g.swabBtn)) return swab();
        if (inRect(pt, g.signBtn)) return signOff();
        if (pt.y > g.btnY - 10) return;
        tapPart(g, pt.x, pt.y);
      },
    });

    // the part itself never changes: paint it once per size
    let layer: HTMLCanvasElement | null = null;
    let layerKey = '';
    function partLayer(g: G) {
      const key = `${g.w}x${g.h}`;
      if (layer && layerKey === key) return layer;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      layer = layer ?? document.createElement('canvas');
      layer.width = Math.max(1, Math.round(g.w * dpr));
      layer.height = Math.max(1, Math.round(g.h * dpr));
      const c = layer.getContext('2d')!;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawPart(c, g);
      layerKey = key;
      return layer;
    }

    function drawPart(c: CanvasRenderingContext2D, g: G) {
      c.fillStyle = '#0a0f13';
      c.fillRect(0, 0, g.w, g.h);
      // UV-A floodlamp overhead: the booth has a violet cast
      const uv = c.createRadialGradient(g.w / 2, g.y - 40, 10, g.w / 2, g.y + g.ph * 0.4, Math.max(g.w, g.ph));
      uv.addColorStop(0, 'rgba(126,96,255,.16)');
      uv.addColorStop(1, 'rgba(126,96,255,0)');
      c.fillStyle = uv;
      c.fillRect(0, 0, g.w, g.h);
      const hole = (h: Hole, lip: string, lipW: number) => {
        c.fillStyle = lip;
        c.beginPath();
        c.arc(X(g, h.x), Y(g, h.y), h.r * g.s + lipW, 0, TAU);
        c.fill();
        c.fillStyle = '#04070a';
        c.beginPath();
        c.arc(X(g, h.x), Y(g, h.y), h.r * g.s, 0, TAU);
        c.fill();
        c.strokeStyle = 'rgba(160,180,210,.22)';
        c.lineWidth = 1;
        c.stroke();
      };
      if (m.part === 'spar') {
        const { A, e, cap } = SPAR;
        c.save();
        roundRect(c, X(g, e), g.y, (A - 2 * e) * g.s, g.ph, 10);
        c.clip();
        // web
        const web = c.createLinearGradient(X(g, e + cap), 0, X(g, A - e - cap), 0);
        web.addColorStop(0, '#161e27');
        web.addColorStop(0.5, '#1c2530');
        web.addColorStop(1, '#161e27');
        c.fillStyle = web;
        c.fillRect(X(g, e), g.y, (A - 2 * e) * g.s, g.ph);
        // machining marks run along the spar
        c.strokeStyle = 'rgba(190,200,255,.028)';
        c.lineWidth = 1;
        for (let i = 0; i < 26; i++) {
          const x = X(g, e + cap + ((A - 2 * e - 2 * cap) * (i + 0.5)) / 26);
          c.beginPath();
          c.moveTo(x, g.y);
          c.lineTo(x, g.y + g.ph);
          c.stroke();
        }
        // caps, with a soft fillet radius where each meets the web
        for (const x0 of [e, A - e - cap]) {
          const cg = c.createLinearGradient(X(g, x0), 0, X(g, x0 + cap), 0);
          cg.addColorStop(0, '#222c38');
          cg.addColorStop(0.5, '#2a3542');
          cg.addColorStop(1, '#222c38');
          c.fillStyle = cg;
          c.fillRect(X(g, x0), g.y, cap * g.s, g.ph);
        }
        for (const f of m.fillets) {
          const x = X(g, f[0].x);
          const fg = c.createLinearGradient(x - 7, 0, x + 7, 0);
          fg.addColorStop(0, 'rgba(0,0,0,0)');
          fg.addColorStop(0.45, 'rgba(0,0,0,.35)');
          fg.addColorStop(0.55, 'rgba(200,210,255,.08)');
          fg.addColorStop(1, 'rgba(0,0,0,0)');
          c.fillStyle = fg;
          c.fillRect(x - 7, g.y, 14, g.ph);
        }
        c.restore();
        // free edges catch the light
        c.strokeStyle = 'rgba(200,210,255,.14)';
        c.lineWidth = 1.5;
        roundRect(c, X(g, e), g.y, (A - 2 * e) * g.s, g.ph, 10);
        c.stroke();
        for (const h of m.holes) hole(h, h.r > 0.05 ? '#2c3846' : '#303b48', h.r > 0.05 ? 0.014 * g.s : 3);
      } else {
        const cx = X(g, 0.5);
        const cy = Y(g, 0.5);
        const ring = (r0: number, r1: number, a: string, b: string) => {
          const rg = c.createRadialGradient(cx - g.s * 0.08, cy - g.s * 0.1, r0 * g.s, cx, cy, r1 * g.s);
          rg.addColorStop(0, a);
          rg.addColorStop(1, b);
          c.fillStyle = rg;
          c.beginPath();
          c.arc(cx, cy, r1 * g.s, 0, TAU);
          c.arc(cx, cy, r0 * g.s, 0, TAU, true);
          c.fill();
        };
        ring(HUB.bead + 0.04, HUB.rim, '#2f3b49', '#27313d'); // rim flange
        ring(HUB.bead, HUB.bead + 0.04, '#252f3b', '#212a35'); // bead seat
        ring(HUB.fillet, HUB.bead, '#1d2630', '#171f28'); // web
        ring(HUB.bore, HUB.fillet, '#2b3643', '#232d39'); // hub boss
        // fillet radii: a shadowed curve where the web meets bead seat and boss
        for (const rad of [HUB.bead, HUB.fillet]) {
          c.strokeStyle = 'rgba(0,0,0,.4)';
          c.lineWidth = 4;
          c.beginPath();
          c.arc(cx, cy, rad * g.s, 0, TAU);
          c.stroke();
          c.strokeStyle = 'rgba(200,210,255,.08)';
          c.lineWidth = 1.5;
          c.beginPath();
          c.arc(cx, cy, rad * g.s + 2, 0, TAU);
          c.stroke();
        }
        c.strokeStyle = 'rgba(200,210,255,.16)';
        c.lineWidth = 1.5;
        c.beginPath();
        c.arc(cx, cy, HUB.rim * g.s, 0, TAU);
        c.stroke();
        for (const h of m.holes) hole(h, h.r > 0.05 ? '#1c242d' : '#35414e', h.r > 0.05 ? 3 : 0.012 * g.s);
      }
    }

    function ringOf(g: G, i: number) {
      const pts = m.indications[i].pts;
      const xs = pts.map((q) => X(g, q.x));
      const ys = pts.map((q) => Y(g, q.y));
      const x0 = Math.min(...xs);
      const x1 = Math.max(...xs);
      const y0 = Math.min(...ys);
      const y1 = Math.max(...ys);
      return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, r: Math.max(20, Math.hypot(x1 - x0, y1 - y0) / 2 + 9) };
    }

    const stop = loop((_t, dt) => {
      if (!host.paused()) clock += dt;
      for (let i = 0; i < n; i++) {
        const at = pending[i];
        if (at !== null && clock >= at) {
          clearAt[i] = at;
          swabCount[i]++;
          pending[i] = null;
        }
        looks[i] = finished ? surface(m, m.indications[i], 6, 0) : surface(m, m.indications[i], clock - clearAt[i], swabCount[i]);
        if (looks[i].glow >= VISIBLE) seenAt[i] = clock;
      }
      draw();
    });

    function path(g: G, pts: P[], smooth = false) {
      ctx.beginPath();
      pts.forEach((q, k) => {
        const x = X(g, q.x);
        const y = Y(g, q.y);
        if (!k) ctx.moveTo(x, y);
        else if (smooth && k < pts.length - 1) {
          const nx = X(g, pts[k + 1].x);
          const ny = Y(g, pts[k + 1].y);
          ctx.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
        } else ctx.lineTo(x, y);
      });
    }

    function drawIndication(g: G, i: number) {
      const ind = m.indications[i];
      const { glow, spread } = looks[i];
      if (glow < 0.02) return;
      const a = clamp(glow, 0, 1);
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowColor = `rgba(${GLOW},1)`;
      const style = styleOf(m, ind);
      if (style === 'line') {
        // bleed-out halo, then the tight line itself
        path(g, ind.pts);
        ctx.strokeStyle = `rgba(${GLOW},${0.3 * a})`;
        ctx.lineWidth = 2.5 + spread * 9;
        ctx.shadowBlur = 6 + spread * 12;
        ctx.stroke();
        ctx.strokeStyle = `rgba(${CORE},${a})`;
        ctx.lineWidth = 1.3 + spread * 1.3;
        ctx.shadowBlur = 4;
        ctx.stroke();
      } else if (style === 'scratch') {
        path(g, ind.pts);
        ctx.strokeStyle = `rgba(${GLOW},${0.12 * a})`;
        ctx.lineWidth = 3.5;
        ctx.stroke();
        ctx.strokeStyle = `rgba(${CORE},${a})`;
        ctx.lineWidth = 1.2;
        ctx.shadowBlur = 2;
        ctx.stroke();
      } else if (style === 'dots') {
        const poro = ind.kind === 'porosity';
        for (const q of ind.pts) {
          const x = X(g, q.x);
          const y = Y(g, q.y);
          ctx.fillStyle = `rgba(${GLOW},${(poro ? 0.3 : 0.18) * a})`;
          ctx.shadowBlur = poro ? 5 + spread * 8 : 3;
          ctx.beginPath();
          ctx.arc(x, y, poro ? 2.8 + spread * 3.4 : 2.2, 0, TAU);
          ctx.fill();
          ctx.fillStyle = `rgba(${CORE},${a})`;
          ctx.shadowBlur = 3;
          ctx.beginPath();
          ctx.arc(x, y, poro ? 1.7 + spread : 1.1, 0, TAU);
          ctx.fill();
        }
      } else if (style === 'wash') {
        // a broad, soft wash with no sharp line in it
        path(g, ind.pts, true);
        ctx.strokeStyle = `rgba(${GLOW},${0.14 * a})`;
        ctx.lineWidth = 20;
        ctx.shadowBlur = 18;
        ctx.stroke();
        ctx.strokeStyle = `rgba(${GLOW},${0.2 * a})`;
        ctx.lineWidth = 11;
        ctx.shadowBlur = 12;
        ctx.stroke();
        ctx.strokeStyle = `rgba(${GLOW},${0.16 * a})`;
        ctx.lineWidth = 5;
        ctx.shadowBlur = 8;
        ctx.stroke();
      } else {
        // penetrant bleeding out of a fastener bore: a diffuse glow all round the hole
        const cx = ind.pts.reduce((s, q) => s + q.x, 0) / ind.pts.length;
        const cy = ind.pts.reduce((s, q) => s + q.y, 0) / ind.pts.length;
        const rr = Math.hypot(ind.pts[0].x - cx, ind.pts[0].y - cy) * g.s;
        ctx.beginPath();
        ctx.arc(X(g, cx), Y(g, cy), rr - 2, 0, TAU);
        ctx.strokeStyle = `rgba(${GLOW},${0.26 * a})`;
        ctx.lineWidth = 5 + spread * 7;
        ctx.shadowBlur = 10 + spread * 10;
        ctx.stroke();
        ctx.strokeStyle = `rgba(${CORE},${0.55 * a})`;
        ctx.lineWidth = 1.6;
        ctx.shadowBlur = 5;
        ctx.stroke();
      }
      ctx.restore();
    }

    function button(b: Rect, text: string, primary: boolean, on: boolean) {
      roundRect(ctx, b.x, b.y, b.w, b.h, b.h / 2);
      ctx.fillStyle = primary ? (on ? C.sea : 'rgba(255,255,255,.14)') : on ? 'rgba(143,184,222,.16)' : 'rgba(143,184,222,.07)';
      ctx.fill();
      if (!primary) {
        ctx.strokeStyle = on ? C.fin : 'rgba(143,184,222,.35)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      label(ctx, text, b.x + b.w / 2, b.y + b.h / 2 + 1, { size: 16, weight: 800, color: on ? C.white : 'rgba(255,255,255,.6)' });
    }

    function drawSwab(g: G) {
      // solvent swab: a damp swab passes down the part, then a light re-dust of developer settles
      const wt = clock - swabStart;
      if (finished || wt < 0 || wt >= SWAB_DUR + 1.1 || p.reducedMotion) return;
      const band = -0.05 + 1.1 * clamp(wt / SWAB_DUR, 0, 1);
      const by = Y(g, band);
      const fade = wt < SWAB_DUR ? 1 : 1 - (wt - SWAB_DUR) / 1.1;
      const sheen = ctx.createLinearGradient(0, by - g.ph * 0.5, 0, by);
      sheen.addColorStop(0, 'rgba(180,200,255,0)');
      sheen.addColorStop(1, `rgba(180,200,255,${0.08 * fade})`);
      ctx.fillStyle = sheen;
      ctx.fillRect(g.x, g.y, g.pw, by - g.y);
      // developer: a fine white dusting behind the swab
      ctx.fillStyle = `rgba(240,242,255,${0.34 * fade})`;
      for (const d of dust) {
        if (d.y > band) continue;
        ctx.fillRect(X(g, d.x), Y(g, d.y), d.r, d.r);
      }
      if (wt < SWAB_DUR) {
        const sw = ctx.createLinearGradient(0, by - 26, 0, by + 4);
        sw.addColorStop(0, 'rgba(251,245,233,0)');
        sw.addColorStop(0.8, 'rgba(251,245,233,.32)');
        sw.addColorStop(1, 'rgba(251,245,233,0)');
        ctx.fillStyle = sw;
        ctx.fillRect(g.x, by - 26, g.pw, 30);
      }
    }

    function draw() {
      const g = geo();
      ctx.drawImage(partLayer(g), 0, 0, g.w, g.h);
      ctx.save();
      if (m.part === 'spar') roundRect(ctx, X(g, SPAR.e), g.y, (SPAR.A - 2 * SPAR.e) * g.s, g.ph, 10);
      else {
        ctx.beginPath();
        ctx.arc(X(g, 0.5), Y(g, 0.5), HUB.rim * g.s + 1, 0, TAU);
      }
      ctx.clip();
      drawSwab(g);
      for (let i = 0; i < n; i++) drawIndication(g, i);
      ctx.restore();

      // grease-pencil rings: yours while working, judged after sign-off
      const now = clock;
      tagged.forEach((t0, i) => {
        const ring = ringOf(g, i);
        const k = p.reducedMotion ? 1 : ease.outBack(clamp((now - t0) / 0.22, 0, 1));
        const rr = ring.r * (1.35 - 0.35 * k);
        const isCrack = m.indications[i].kind === 'crack';
        ctx.globalAlpha = clamp((now - t0) / 0.12, 0, 1);
        ctx.strokeStyle = finished ? (isCrack ? C.palm : C.rust) : C.fin;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(ring.cx, ring.cy, rr, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
      });
      for (const b of bare) {
        const x = X(g, b.x);
        const y = Y(g, b.y);
        const k = p.reducedMotion ? 1 : ease.outBack(clamp((now - b.t) / 0.2, 0, 1));
        ctx.strokeStyle = finished ? C.rust : C.fin;
        ctx.lineWidth = 2.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(x, y, 13 * k, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        label(ctx, '?', x, y + 1, { size: 13, weight: 800, color: finished ? C.rust : C.fin });
      }
      for (let k = gone.length - 1; k >= 0; k--) {
        const f = gone[k];
        const u = (now - f.t) / 0.2;
        if (u >= 1) {
          gone.splice(k, 1);
          continue;
        }
        ctx.globalAlpha = 1 - u;
        ctx.strokeStyle = C.fin;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r * (1 - 0.3 * u), 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      for (let k = ripples.length - 1; k >= 0; k--) {
        const f = ripples[k];
        const u = (now - f.t) / 0.3;
        if (u >= 1 || p.reducedMotion) {
          ripples.splice(k, 1);
          continue;
        }
        ctx.globalAlpha = 0.5 * (1 - u);
        ctx.strokeStyle = C.paper;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(f.x, f.y, 6 + u * SNAP_PX, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      if (finished) drawReveal(g);

      // header
      const who = p.context?.assetName ? `${p.context.assetName} · ${m.name.toLowerCase()}` : m.name;
      fitLabel(ctx, who, 16, 20, g.w - 160, { size: 14, weight: 800, color: C.paper, align: 'left' });
      const uvText = `UV-A ${m.uv} µW/cm²`;
      label(ctx, uvText, g.w - 16, 20, { size: 11, weight: 700, color: 'rgba(251,245,233,.7)', align: 'right' });
      const uvW = ctx.measureText(uvText).width;
      ctx.fillStyle = 'rgba(150,120,255,.95)';
      ctx.shadowColor = 'rgba(126,96,255,1)';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(g.w - 16 - uvW - 9, 20, 4, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;

      // one line of info over the thumb zone
      let info = '';
      const hs = m.hints;
      if (finished) info = '';
      else if (!tagged.size && !bare.length && !swabs && clock < 5) info = 'Tap an indication to circle it, tap again to clear';
      else if (m.teach) {
        // until the first swab, every other hint is the nudge to swab
        const k = Math.floor(clock / 4.5);
        info = !swabs && k % 2 === 0 ? hs[0] : hs[1 + (Math.floor(swabs ? k : k / 2) % (hs.length - 1))];
      }
      else if (swabbing()) info = 'Swabbing + re-developing…';
      else if (swabs) info = `Swabbed + re-developed ${Math.min(99, clock - swabStart - SWAB_DUR).toFixed(1)} s ago · ${m.developer} developer`;
      else info = `As developed · ${m.developer} developer`;
      if (info) fitLabel(ctx, info, g.w / 2, g.infoY, g.w - 32, { size: 12.5, weight: 700, color: m.teach ? C.fin : 'rgba(251,245,233,.62)' });

      button(g.swabBtn, swabbing() && !finished ? 'Swabbing…' : 'Swab', false, !finished && !swabbing());
      button(g.signBtn, finished ? 'Signed off' : 'Sign off', true, !finished);
    }

    // ---- the reveal after sign-off: what you missed, and what each decoy really was
    const nameOf = (ind: Indication): string => {
      const spar = m.part === 'spar';
      switch (ind.kind) {
        case 'crack':
          return spar && ind.riser === 'fillet' ? 'stress-corrosion crack' : 'crack';
        case 'toolmark':
          return spar ? 'tool mark: spanwise' : 'tool mark: runs round';
        case 'trapped':
          return 'excess penetrant: swabs off';
        case 'lint':
          return 'lint: swabs off';
        case 'scratch':
          return 'scratch: open metal';
        case 'bleedout':
          return 'bleed-out from the bore';
        case 'porosity':
          return 'porosity: not a crack';
        case 'specks':
          return 'developer specks';
        case 'smear':
          return 'excess penetrant';
      }
    };
    type Tag = { x: number; y: number; w: number; text: string; col: string; to: P | null };
    let revealKey = '';
    let tags: Tag[] = [];
    let badges: { x: number; y: number; glyph: string; col: string }[] = [];
    function layoutReveal(g: G) {
      const key = `${g.w}x${g.h}`;
      if (key === revealKey) return;
      revealKey = key;
      tags = [];
      badges = [];
      const box = (i: number) => {
        const xs = m.indications[i].pts.map((q) => X(g, q.x));
        const ys = m.indications[i].pts.map((q) => Y(g, q.y));
        const b = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
        return { ...b, cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2 };
      };
      // what a label must not cover: badges, '?' marks and labels already placed;
      // and, if it can help it, any indication
      const taken: { r: Rect; wgt: number; own?: number }[] = [];
      tagged.forEach((_, i) => {
        const ring = ringOf(g, i);
        const isCrack = m.indications[i].kind === 'crack';
        const b = { x: ring.cx + ring.r * 0.72, y: ring.cy - ring.r * 0.72, glyph: isCrack ? '✓' : '✗', col: isCrack ? C.palm : C.rust };
        badges.push(b);
        taken.push({ r: { x: b.x - 11, y: b.y - 11, w: 22, h: 22 }, wgt: 1 });
      });
      for (const b of bare) taken.push({ r: { x: X(g, b.x) - 14, y: Y(g, b.y) - 14, w: 28, h: 28 }, wgt: 1 });
      m.indications.forEach((_, i) => {
        const b = box(i);
        taken.push({ r: { x: b.x0 - 3, y: b.y0 - 3, w: b.x1 - b.x0 + 6, h: b.y1 - b.y0 + 6 }, wgt: 0.4, own: i });
      });
      ctx.font = `800 11px ${FONT}`;
      const lo = g.y + 10;
      const hi = Math.min(g.y + g.ph, g.infoY - 12) - 10;
      // missed cracks get the best spots, then wrong calls, then the rest
      const rank = (i: number) => {
        const crack = m.indications[i].kind === 'crack';
        return crack && !tagged.has(i) ? 0 : !crack && tagged.has(i) ? 1 : 2;
      };
      const order = m.indications.map((_, i) => i).sort((a, b) => rank(a) - rank(b));
      for (const i of order) {
        const ind = m.indications[i];
        const on = tagged.has(i);
        let text = '';
        let col: string = C.paper;
        if (ind.kind === 'crack') {
          if (!on) {
            text = nameOf(ind) === 'crack' ? 'missed crack' : 'missed SCC crack';
            col = C.rust;
          } else if (nameOf(ind) !== 'crack') {
            text = nameOf(ind);
            col = C.palm;
          }
        } else {
          text = nameOf(ind);
          col = on ? C.rust : C.paper;
        }
        if (!text) continue;
        const b = box(i);
        const w = ctx.measureText(text).width + 14;
        const hw = w / 2;
        // right under it, over it, beside it, then a step further out
        const cands: [number, number][] = [
          [b.cx, b.y1 + 13],
          [b.cx, b.y0 - 13],
          [b.x1 + hw + 6, b.cy],
          [b.x0 - hw - 6, b.cy],
          [b.x1 + hw * 0.5, b.y1 + 13],
          [b.x0 - hw * 0.5, b.y1 + 13],
          [b.x1 + hw * 0.5, b.y0 - 13],
          [b.x0 - hw * 0.5, b.y0 - 13],
          [b.cx, b.y1 + 34],
          [b.cx, b.y0 - 34],
          [b.cx, b.y1 + 55],
          [b.cx, b.y0 - 55],
        ];
        let best: Tag | null = null;
        let bestO = Infinity;
        for (const [cx, cy] of cands) {
          const x = clamp(cx, 6 + hw, g.w - 6 - hw);
          const y = clamp(cy, lo, hi);
          const rect = { x: x - hw - 2, y: y - 10, w: w + 4, h: 20 };
          const o = taken.reduce((s, t) => (t.own === i ? s : s + overlap(rect, t.r) * t.wgt), 0);
          if (o < bestO - 1e-6) {
            bestO = o;
            best = { x, y, w, text, col, to: null };
          }
          if (o === 0) break;
        }
        if (!best) continue;
        // a short leader to the indication when the label had to move away from it
        let near: P = { x: b.cx, y: b.cy };
        let nd = Infinity;
        for (const q of dense(ind.pts, 0.004)) {
          const d = Math.hypot(X(g, q.x) - best.x, Y(g, q.y) - best.y);
          if (d < nd) [nd, near] = [d, { x: X(g, q.x), y: Y(g, q.y) }];
        }
        const ex = clamp(near.x, best.x - hw, best.x + hw);
        const ey = clamp(near.y, best.y - 9, best.y + 9);
        if (Math.hypot(near.x - ex, near.y - ey) > 16) best.to = near;
        tags.push(best);
        taken.push({ r: { x: best.x - hw - 2, y: best.y - 10, w: w + 4, h: 20 }, wgt: 1 });
      }
    }

    function drawReveal(g: G) {
      layoutReveal(g);
      const u = clamp((clock - revealT) / 0.35, 0, 1);
      ctx.globalAlpha = u;
      m.indications.forEach((ind, i) => {
        if (ind.kind !== 'crack' || tagged.has(i)) return;
        const ring = ringOf(g, i);
        ctx.strokeStyle = C.rust;
        ctx.lineWidth = 2.5;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.arc(ring.cx, ring.cy, ring.r, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      });
      for (const t of tags) {
        if (!t.to) continue;
        const ex = clamp(t.to.x, t.x - t.w / 2 + 9, t.x + t.w / 2 - 9);
        const ey = t.to.y < t.y ? t.y - 9 : t.y + 9;
        ctx.strokeStyle = t.col;
        ctx.globalAlpha = 0.7 * u;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(t.to.x, t.to.y);
        ctx.stroke();
        ctx.fillStyle = t.col;
        ctx.beginPath();
        ctx.arc(t.to.x, t.to.y, 2, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = u;
      for (const t of tags) {
        roundRect(ctx, t.x - t.w / 2, t.y - 9, t.w, 18, 9);
        ctx.fillStyle = 'rgba(8,12,15,.86)';
        ctx.fill();
        label(ctx, t.text, t.x, t.y + 0.5, { size: 11, weight: 800, color: t.col });
      }
      ctx.globalAlpha = 1;
      for (const b of badges) {
        ctx.fillStyle = b.col;
        ctx.beginPath();
        ctx.arc(b.x, b.y, 10, 0, TAU);
        ctx.fill();
        label(ctx, b.glyph, b.x, b.y + 1, { size: 12, weight: 900, color: C.white });
      }
    }

    function makeResult(): PuzzleResult {
      const r = scoreCrack(m, [...tagged.keys()], bare.length);
      // porosity is a real finding, just not a crack: say so rather than "false call"
      const poro = [...tagged.keys()].filter((i) => m.indications[i].kind === 'porosity').length;
      const wrong = r.falseCalls - poro;
      const parts = [`${r.found}/${m.cracks} cracks`];
      if (wrong) parts.push(plural(wrong, 'false call'));
      if (poro) parts.push('porosity: not a crack');
      parts.push(plural(swabs, 'swab'));
      return result(r.score, parts.join(', '), { found: r.found, cracks: m.cracks, falseCalls: r.falseCalls, swabs });
    }

    function signOff() {
      if (finished) return;
      finished = true;
      revealT = clock;
      const res = makeResult();
      if (res.perfect) host.fx.flourish();
      else host.fx.good();
      settle(host, res, res.perfect ? 1400 : 1900);
    }

    return {
      timeUp() {
        finished = true;
        revealT = clock;
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
