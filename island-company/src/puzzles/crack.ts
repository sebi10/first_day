// Mechanic · Crack hunt. Fluorescent penetrant inspection in a dark booth.
// The whole part sits under the UV-A lamp. ONE TAP circles an indication (the
// ring snaps to the nearest one), tap it again to clear it; a tap on bare
// metal is a false call. The skill is reading indications like an inspector:
//  - relevant: cracks start at stress risers (fastener holes, fillet radii,
//    free edges), run jagged, and BLEED: the line fattens as the developer
//    draws penetrant out, and after a solvent wipe it bleeds back in a second
//    or two (a little weaker each time, the flaw is running dry);
//  - non-relevant: scratches (straight, crisp, shallow: faint after a wipe and
//    they never spread), porosity/pitting (rounded dots, not a line), and
//    surface residue (excess-penetrant smears at edges, lint) that a wipe
//    takes away for good.
// Tiers 0–2 print those rules and keep cracks bright; from tier 3 cracks are
// tight and faint, decoys are just as bright and nothing is printed.
// Non-aqueous developer (tool id 'borescope') makes bleed-back faster and
// brighter; the UV floodlamp ('uvPlus') makes every indication brighter.
import { rng, type Rng } from '../sim/rng';
import { C, FONT, clamp, ease, fitLabel, label, loop, pointer, roundRect, settle, stage } from './kit';
import { result, type PuzzleDef, type PuzzleResult } from './types';

type P = { x: number; y: number };
export type Kind = 'crack' | 'scratch' | 'porosity' | 'smear' | 'lint';
export type Riser = 'hole' | 'fillet' | 'edge';
/** pts: a polyline (porosity: the dot centres), in frame units: x 0..aspect, y 0..1 */
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
  /** seconds after a wipe before penetrant starts to bleed back out of a flaw */
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

/** distance from p to an indication (porosity is a set of dots, the rest are lines) */
export function distToInd(p: P, ind: Indication) {
  if (ind.kind === 'porosity') return Math.min(...ind.pts.map((q) => Math.hypot(p.x - q.x, p.y - q.y)));
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

function gap(a: Indication, b: Indication) {
  const da = a.kind === 'porosity' ? a.pts : dense(a.pts);
  let best = Infinity;
  for (const q of da) best = Math.min(best, distToInd(q, b));
  return best;
}

type Geom = Pick<CrackModel, 'part' | 'aspect' | 'holes' | 'fillets' | 'edges'> & {
  onMetal(p: P, margin?: number): boolean;
  /** the wheel centre (hub only) */
  c: P;
};

// Wing spar / deck beam, standing on end so it fills a portrait phone: a cap
// (flange) down each side with a row of fastener holes, a web between them with
// two flanged lightening holes. The spar carries load along its length (up/down),
// so fatigue cracks run across it, left/right.
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
    onMetal: (p, mg = 0.004) =>
      p.x > e + mg && p.x < A - e - mg && p.y > 0.015 && p.y < 0.985 && holes.every((h) => Math.hypot(p.x - h.x, p.y - h.y) > h.r + mg),
  };
}

// Wheel half, face on: rim flange edge, bead seat radius, web with the tie-bolt
// circle, hub fillet, bearing bore.
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
    onMetal: (p, mg = 0.004) => {
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      return d > HUB.bore + mg && d < HUB.rim - mg && holes.every((h) => Math.hypot(p.x - h.x, p.y - h.y) > h.r + mg);
    },
  };
}

// ---------------------------------------------------------------- shapes

/** a fatigue crack: short jagged steps that wander but keep their heading */
function jag(r: Rng, from: P, angle: number, len: number, steps = 11): P[] {
  const pts: P[] = [from];
  let a = angle;
  let cur = from;
  let side = r.chance(0.5) ? 1 : -1;
  for (let i = 0; i < steps; i++) {
    // zig or zag: each step kinks away from the last, the path keeps its heading
    side = r.chance(0.75) ? -side : side;
    const kink = side * r.range(0.25, 0.8);
    a = angle + clamp(kink + r.range(-0.25, 0.25) + (a - angle) * 0.3, -0.75, 0.75);
    const l = (len / steps) * r.range(0.6, 1.4);
    cur = { x: cur.x + Math.cos(a) * l, y: cur.y + Math.sin(a) * l };
    pts.push(cur);
  }
  return pts;
}

/** a crack that follows a fillet radius: along the line, zig-zagging across it */
/** offsets across a radius line: rough and irregular, never a regular saw-tooth */
function wander(r: Rng, steps: number): { t: number; d: number }[] {
  const out = [{ t: 0, d: 0 }];
  let t = 0;
  let d = 0;
  const w = Array.from({ length: steps }, () => r.range(0.5, 1.5));
  const sum = w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < steps; i++) {
    t += w[i] / sum;
    d = clamp(d * 0.4 + r.range(-0.006, 0.006), -0.007, 0.007);
    out.push({ t, d });
  }
  return out;
}

function alongLine(r: Rng, x: number, y0: number, dir: number, len: number, steps = 10): P[] {
  return wander(r, steps).map(({ t, d }) => ({ x: x + d, y: y0 + dir * len * t }));
}

function alongArc(r: Rng, c: P, rad: number, a0: number, len: number, steps = 10): P[] {
  return wander(r, steps).map(({ t, d }) => {
    const a = a0 + (len / rad) * t;
    return { x: c.x + Math.cos(a) * (rad + d), y: c.y + Math.sin(a) * (rad + d) };
  });
}

function crackAt(r: Rng, g: Geom, riser: Riser, len: number): Indication {
  const spar = g.part === 'spar';
  if (riser === 'hole') {
    const h = r.pick(g.holes);
    let a: number;
    if (spar) a = (r.chance(0.5) ? 0 : Math.PI) + r.range(-0.3, 0.3);
    else if (h.r > 0.05) a = r.range(0, TAU); // bearing bore: radial, any clock position
    else a = Math.atan2(h.y - g.c.y, h.x - g.c.x) + (r.chance(0.5) ? 0 : Math.PI) + r.range(-0.3, 0.3);
    const start = { x: h.x + Math.cos(a) * (h.r + 0.002), y: h.y + Math.sin(a) * (h.r + 0.002) };
    return { kind: 'crack', riser, pts: jag(r, start, a, len), glow: 1 };
  }
  if (riser === 'fillet') {
    if (spar) {
      const f = r.pick(g.fillets);
      return { kind: 'crack', riser, pts: alongLine(r, f[0].x, r.range(0.06, 0.94), r.chance(0.5) ? 1 : -1, len * 1.2), glow: 1 };
    }
    const rad = r.chance(0.6) ? HUB.bead : HUB.fillet;
    return { kind: 'crack', riser, pts: alongArc(r, g.c, rad, r.range(0, TAU), len * 1.2), glow: 1 };
  }
  // free edge: the crack runs in from the edge
  if (spar) {
    const left = r.chance(0.5);
    const start = { x: left ? SPAR.e + 0.001 : SPAR.A - SPAR.e - 0.001, y: r.range(0.05, 0.95) };
    return { kind: 'crack', riser, pts: jag(r, start, (left ? 0 : Math.PI) + r.range(-0.3, 0.3), len * 0.8), glow: 1 };
  }
  const a = r.range(0, TAU);
  const start = { x: g.c.x + Math.cos(a) * (HUB.rim - 0.002), y: g.c.y + Math.sin(a) * (HUB.rim - 0.002) };
  return { kind: 'crack', riser, pts: jag(r, start, a + Math.PI + r.range(-0.3, 0.3), len * 0.8), glow: 1 };
}

function somewhere(r: Rng, g: Geom): P {
  for (let i = 0; i < 200; i++) {
    const p = { x: r.range(0, g.aspect), y: r.range(0, 1) };
    if (g.onMetal(p, 0.03)) return p;
  }
  return g.part === 'spar' ? { x: SPAR.A / 2, y: 0.5 } : { x: 0.5, y: 0.5 + HUB.bolt };
}

function decoyAt(r: Rng, g: Geom, kind: Exclude<Kind, 'crack'>, tier: number): Indication {
  const spar = g.part === 'spar';
  if (kind === 'scratch') {
    // a tool mark: machining runs along the spar; tire tools gouge a wheel any which way
    const p = somewhere(r, g);
    const a = spar && tier <= 2 ? Math.PI / 2 + r.range(-0.2, 0.2) : r.range(0, Math.PI);
    const l = (spar ? r.range(0.09, 0.14) : r.range(0.1, 0.15)) / 2;
    return {
      kind,
      pts: [
        { x: p.x - Math.cos(a) * l, y: p.y - Math.sin(a) * l },
        { x: p.x + Math.cos(a) * l, y: p.y + Math.sin(a) * l },
      ],
      glow: 1,
    };
  }
  if (kind === 'porosity') {
    const p = somewhere(r, g);
    const n = r.int(5, 8);
    const pts: P[] = [];
    for (let i = 0; i < n; i++) {
      const a = r.range(0, TAU);
      const d = r.range(0.004, spar ? 0.026 : 0.03);
      pts.push({ x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d });
    }
    return { kind, pts, glow: 1 };
  }
  if (kind === 'smear') {
    // excess penetrant left along an edge or in a radius (poor removal)
    const atFillet = tier >= 3 && r.chance(0.4);
    if (spar) {
      const x = atFillet ? r.pick(g.fillets)[0].x + r.range(-0.004, 0.004) : r.chance(0.5) ? SPAR.e + 0.016 : SPAR.A - SPAR.e - 0.016;
      const y0 = r.range(0.04, 0.8);
      const l = r.range(0.1, 0.16);
      const pts: P[] = [];
      for (let k = 0; k <= 8; k++) pts.push({ x: x + r.range(-0.0015, 0.0015), y: y0 + (l * k) / 8 });
      return { kind, pts, glow: 1 };
    }
    const rad = atFillet ? HUB.fillet + 0.014 : HUB.rim - 0.026;
    const a0 = r.range(0, TAU);
    const l = r.range(0.13, 0.2);
    const pts: P[] = [];
    for (let k = 0; k <= 10; k++) {
      const a = a0 + (l / rad) * (k / 10);
      const rr = rad + r.range(-0.0015, 0.0015);
      pts.push({ x: g.c.x + Math.cos(a) * rr, y: g.c.y + Math.sin(a) * rr });
    }
    return { kind, pts, glow: 1 };
  }
  // lint: a soft, smoothly curling fibre
  const p = somewhere(r, g);
  let a = r.range(0, TAU);
  // a fibre always curls, sometimes into an S
  let k = (r.chance(0.5) ? 1 : -1) * r.range(18, 30);
  const flip = r.chance(0.5);
  const l = r.range(0.08, 0.12);
  const pts: P[] = [p];
  let cur = p;
  for (let i = 0; i < 8; i++) {
    if (flip && i === 4) k = -k;
    a += (k * l) / 8;
    cur = { x: cur.x + (Math.cos(a) * l) / 8, y: cur.y + (Math.sin(a) * l) / 8 };
    pts.push(cur);
  }
  return { kind, pts, glow: 1 };
}

function fits(g: Geom, ind: Indication, placed: Indication[], sep: number, tier: number) {
  const body = ind.kind === 'porosity' ? ind.pts : dense(ind.pts);
  // cracks start on the riser itself (edge cracks start on the edge)
  const skip = ind.kind === 'crack' ? 2 : 0;
  if (!body.slice(skip).every((q) => g.onMetal(q, ind.kind === 'smear' ? 0.002 : 0.006))) return false;
  if (ind.kind !== 'crack' && ind.kind !== 'smear') {
    // decoys stay off the risers; while teaching, well clear of them
    const clear = tier <= 2 ? 0.035 : 0.012;
    if (body.some((q) => riserDist(g, q) < clear)) return false;
  }
  return placed.every((o) => gap(ind, o) > sep && gap(o, ind) > sep);
}

// ---------------------------------------------------------------- model

export function generateCrack(seed: number, tier: number, tools: string[] = [], job?: string): CrackModel {
  const r = rng(seed);
  const T = clamp(Math.round(tier), 0, 5);
  const coin = r.chance(0.5);
  // the job decides the part: spar inspections look at a spar, the wheel-half check at a wheel
  const part: CrackModel['part'] = job === 'spar' || job === 'project' ? 'spar' : job === 'corrosion' ? 'hub' : coin ? 'spar' : 'hub';
  const name = part === 'hub' ? 'Wheel half' : job === 'project' ? 'Deck beam' : 'Wing spar';
  const g = part === 'spar' ? sparGeom() : hubGeom();
  const sep = part === 'spar' ? 0.07 : 0.085;
  const nad = tools.includes('borescope');
  const uvPlus = tools.includes('uvPlus');

  const nCracks = [1, 2, 2, 3, 3, 4][T];
  const decoys: Exclude<Kind, 'crack'>[] =
    T === 0
      ? ['smear']
      : T === 1
        ? ['smear', 'scratch']
        : T === 2
          ? ['smear', 'scratch', 'porosity']
          : T === 3
            ? ['smear', 'scratch', 'porosity', r.pick(['scratch', 'smear'] as const)]
            : T === 4
              ? ['smear', 'scratch', 'porosity', 'lint', r.pick(['scratch', 'smear', 'porosity'] as const)]
              : ['smear', 'smear', 'scratch', 'porosity', 'lint', r.pick(['scratch', 'lint'] as const)];

  const lenBase = (part === 'spar' ? 0.08 : 0.1) - T * 0.004;
  const placed: Indication[] = [];
  let cracks = 0;
  for (let k = 0; k < nCracks; k++) {
    for (let tries = 0; tries < 80; tries++) {
      const riser: Riser = T <= 1 ? (r.chance(0.7) ? 'hole' : 'edge') : (r.weighted(['hole', 'fillet', 'edge'] as const, (x) => (x === 'hole' ? 2 : 1)) ?? 'hole');
      const ind = crackAt(r, g, riser, lenBase * r.range(0.9, 1.2));
      if (fits(g, ind, placed, sep, T)) {
        placed.push(ind);
        cracks++;
        break;
      }
    }
  }
  for (const kind of decoys) {
    for (let tries = 0; tries < 80; tries++) {
      const ind = decoyAt(r, g, kind, T);
      if (fits(g, ind, placed, sep, T)) {
        placed.push(ind);
        break;
      }
    }
  }

  // brightness: cracks are bright while teaching, tight and faint from tier 3;
  // decoys are a touch dimmer while teaching and just as bright from tier 3
  const bright = (T <= 2 ? 1 : [0.62, 0.56, 0.5][T - 3]) * (uvPlus ? 1.3 : 1) * (nad ? 1.12 : 1);
  for (const ind of placed) {
    const own = ind.kind === 'crack' ? (T <= 2 ? r.range(0.92, 1) : r.range(0.82, 1)) : T <= 2 ? r.range(0.62, 0.72) : r.range(0.9, 1.08);
    ind.glow = clamp(T <= 2 && ind.kind !== 'crack' ? own * (uvPlus ? 1.3 : 1) : bright * own, 0.2, 1);
  }

  const hints =
    T > 2
      ? []
      : [
          'Tap Wipe: a crack bleeds back, residue doesn’t.',
          'Cracks start at holes, radii and edges, and run jagged.',
          ...(T >= 1 ? ['Scratches are straight and crisp. Cracks spread.'] : []),
          ...(T >= 2 ? ['Round dots are porosity, not a crack.'] : []),
        ];

  return {
    part,
    name,
    aspect: g.aspect,
    holes: g.holes,
    fillets: g.fillets,
    edges: g.edges,
    indications: r.shuffle(placed),
    cracks,
    bleedDelay: nad ? 0.2 : 0.45,
    bleedTau: (nad ? 0.35 : 0.7) * (T >= 4 ? 1.2 : 1),
    uv: uvPlus ? 2600 : 1200,
    developer: nad ? 'non-aqueous' : 'dry',
    teach: T <= 2,
    hints,
  };
}

/**
 * What the booth shows for one indication.
 * since: seconds since the surface was last cleared (for an unwiped part, since it was developed);
 * wipes: how many solvent wipes have gone over it.
 * glow 0..1 is brightness, spread 0..1 is how far the penetrant has bled sideways.
 */
export function surface(m: Pick<CrackModel, 'bleedDelay' | 'bleedTau'>, ind: Indication, since: number, wipes: number) {
  const flaw = ind.kind === 'crack' || ind.kind === 'porosity';
  if (wipes === 0) {
    // as developed: everything shows; real flaws keep bleeding out
    if (flaw) return { glow: ind.glow * (0.72 + 0.28 * (1 - Math.exp(-since / 2.5))), spread: clamp(0.3 + since / 6, 0, 1) };
    return { glow: ind.glow, spread: 0 };
  }
  const t = since - m.bleedDelay;
  if (t <= 0) return { glow: 0, spread: 0 };
  const back = 1 - Math.exp(-t / m.bleedTau);
  // a flaw holds a reservoir of penetrant: it bleeds back, a little weaker each wipe
  if (flaw) return { glow: ind.glow * back * Math.max(0.6, Math.pow(0.88, wipes - 1)), spread: clamp(t / 3, 0, 1) };
  // a shallow scratch holds a trace: it comes back faint and crisp, never spreads
  if (ind.kind === 'scratch') return { glow: ind.glow * 0.28 * back, spread: 0 };
  // smears and lint were only ever on the surface
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

/** tagged: indication indices circled; bare: calls on bare metal */
export function scoreCrack(m: CrackModel, tagged: number[], bare = 0) {
  let found = 0;
  let wrong = 0;
  for (const i of new Set(tagged)) {
    if (m.indications[i]?.kind === 'crack') found++;
    else wrong++;
  }
  const falseCalls = wrong + bare;
  const score = clamp(found / Math.max(1, m.cracks) - 0.2 * falseCalls, 0, 1);
  return { score, found, falseCalls, missed: m.cracks - found };
}

// ---------------------------------------------------------------- puzzle

const GLOW = '201,245,74'; // fluorescent yellow-green
const CORE = '236,255,170';
const SNAP_PX = 28;
const VISIBLE = 0.08;
const WIPE_DUR = 0.6;
const KIND_NAME: Record<Kind, string> = { crack: 'crack', scratch: 'scratch', porosity: 'porosity', smear: 'excess penetrant', lint: 'lint' };

export const crack: PuzzleDef = {
  id: 'crack',
  role: 'mech',
  title: 'Crack hunt',
  gesture: 'Tap to circle + wipe',
  howTo: 'Tap each crack to circle it. Wipe to see what bleeds back.',
  term: 'Penetrant inspection: dye in a crack glows under UV and bleeds back after a wipe.',
  seconds: (tier) => 50 + tier * 10,
  mount(host, p) {
    const m = generateCrack(p.seed, p.tier, p.tools, p.context?.job);
    const st = stage(host.el);
    const { ctx } = st;
    const n = m.indications.length;
    const pits = m.part === 'spar' ? 'pitting' : 'porosity';
    let clock = 0;
    // the part came out of the developer a moment before the booth light came on
    const clearAt = new Array<number>(n).fill(-1.2);
    const pending = new Array<number | null>(n).fill(null);
    const wiped = new Array<number>(n).fill(0);
    const looks = m.indications.map(() => ({ glow: 0, spread: 0 }));
    let wipeStart = -99;
    let wipes = 0;
    const tagged = new Map<number, number>(); // indication -> clock when circled
    const bare: { x: number; y: number; t: number }[] = [];
    const gone: { x: number; y: number; r: number; t: number }[] = [];
    const ripples: { x: number; y: number; t: number }[] = [];
    let finished = false;
    let revealT = 0;

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
      const wipeW = Math.round((rowW - gapX) * 0.42);
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
        wipeBtn: { x: rowX, y: btnY, w: wipeW, h: btnH },
        signBtn: { x: rowX + wipeW + gapX, y: btnY, w: rowW - wipeW - gapX, h: btnH },
      };
    };
    type G = ReturnType<typeof geo>;
    const X = (g: G, x: number) => g.x + x * g.s;
    const Y = (g: G, y: number) => g.y + y * g.s;
    const toN = (g: G, x: number, y: number): P => ({ x: (x - g.x) / g.s, y: (y - g.y) / g.s });
    const inRect = (pt: { x: number; y: number }, b: { x: number; y: number; w: number; h: number }, pad = 4) =>
      pt.x >= b.x - pad && pt.x <= b.x + b.w + pad && pt.y >= b.y - pad && pt.y <= b.y + b.h + pad;
    const geom = m.part === 'spar' ? sparGeom() : hubGeom();
    const onMetal = (q: P) => geom.onMetal(q, 0);

    const calls = () => tagged.size + bare.length;
    const status = () => host.status(`${calls()} circled · ${wipes} wipe${wipes === 1 ? '' : 's'}`);
    status();

    const wiping = () => clock - wipeStart < WIPE_DUR;
    function wipe() {
      if (finished || wiping()) return;
      wipes++;
      wipeStart = clock;
      const dur = p.reducedMotion ? 0 : WIPE_DUR;
      m.indications.forEach((ind, i) => {
        const y0 = Math.min(...ind.pts.map((q) => q.y));
        pending[i] = clock + dur * clamp((y0 + 0.05) / 1.1, 0, 1);
      });
      host.fx.swipe();
      host.fx.tap();
      status();
    }

    function tapPart(g: G, x: number, y: number) {
      const q = toN(g, x, y);
      const R = SNAP_PX / g.s;
      ripples.push({ x, y, t: clock });
      // a false-call mark you just put down is cleared by tapping it again
      let bi = -1;
      let bd = R * 0.9;
      bare.forEach((b, k) => {
        const d = Math.hypot(b.x - q.x, b.y - q.y);
        if (d < bd) {
          bd = d;
          bi = k;
        }
      });
      // snap to the nearest indication you can see (or one already circled)
      const i = nearest(m, q, R, (k) => tagged.has(k) || looks[k].glow >= VISIBLE);
      const di = i >= 0 ? distToInd(q, m.indications[i]) : Infinity;
      if (bi >= 0 && bd <= di) {
        const b = bare.splice(bi, 1)[0];
        gone.push({ x: b.x, y: b.y, r: 12, t: clock });
        host.fx.tap();
      } else if (i >= 0) {
        if (tagged.has(i)) {
          tagged.delete(i);
          const ring = ringOf(g, i);
          gone.push({ x: ring.cx, y: ring.cy, r: ring.r, t: clock });
          host.fx.tap();
        } else {
          tagged.set(i, clock);
          host.fx.snap();
        }
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
        if (inRect(pt, g.wipeBtn)) return wipe();
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
          wiped[i]++;
          pending[i] = null;
        }
        looks[i] = finished ? surface(m, m.indications[i], 6, 0) : surface(m, m.indications[i], clock - clearAt[i], wiped[i]);
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
      if (ind.kind === 'crack') {
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
      } else if (ind.kind === 'scratch') {
        path(g, ind.pts);
        ctx.strokeStyle = `rgba(${GLOW},${0.12 * a})`;
        ctx.lineWidth = 3.5;
        ctx.stroke();
        ctx.strokeStyle = `rgba(${CORE},${a})`;
        ctx.lineWidth = 1.2;
        ctx.shadowBlur = 2;
        ctx.stroke();
      } else if (ind.kind === 'porosity') {
        for (const q of ind.pts) {
          const x = X(g, q.x);
          const y = Y(g, q.y);
          ctx.fillStyle = `rgba(${GLOW},${0.3 * a})`;
          ctx.shadowBlur = 5 + spread * 8;
          ctx.beginPath();
          ctx.arc(x, y, 2.8 + spread * 3.4, 0, TAU);
          ctx.fill();
          ctx.fillStyle = `rgba(${CORE},${a})`;
          ctx.shadowBlur = 3;
          ctx.beginPath();
          ctx.arc(x, y, 1.7 + spread * 1, 0, TAU);
          ctx.fill();
        }
      } else if (ind.kind === 'smear') {
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
        path(g, ind.pts, true);
        ctx.strokeStyle = `rgba(${CORE},${a})`;
        ctx.lineWidth = 1.1;
        ctx.shadowBlur = 4;
        ctx.stroke();
      }
      ctx.restore();
    }

    function button(b: { x: number; y: number; w: number; h: number }, text: string, primary: boolean, on: boolean) {
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
      // solvent wipe: a damp swab sweeps down the part, leaving a brief wet sheen
      const wt = clock - wipeStart;
      if (!finished && wt >= 0 && wt < WIPE_DUR + 0.9 && !p.reducedMotion) {
        const band = -0.05 + 1.1 * clamp(wt / WIPE_DUR, 0, 1);
        const by = Y(g, band);
        const fade = wt < WIPE_DUR ? 1 : 1 - (wt - WIPE_DUR) / 0.9;
        const sheen = ctx.createLinearGradient(0, by - g.ph * 0.5, 0, by);
        sheen.addColorStop(0, 'rgba(180,200,255,0)');
        sheen.addColorStop(1, `rgba(180,200,255,${0.1 * fade})`);
        ctx.fillStyle = sheen;
        ctx.fillRect(g.x, g.y, g.pw, by - g.y);
        if (wt < WIPE_DUR) {
          const sw = ctx.createLinearGradient(0, by - 26, 0, by + 4);
          sw.addColorStop(0, 'rgba(251,245,233,0)');
          sw.addColorStop(0.8, 'rgba(251,245,233,.32)');
          sw.addColorStop(1, 'rgba(251,245,233,0)');
          ctx.fillStyle = sw;
          ctx.fillRect(g.x, by - 26, g.pw, 30);
        }
      }
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
        if (finished) badge(ring.cx + ring.r * 0.72, ring.cy - ring.r * 0.72, isCrack ? '✓' : '✗', isCrack ? C.palm : C.rust);
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

      if (finished) {
        // what you missed, and what each decoy really was
        const u = clamp((clock - revealT) / 0.35, 0, 1);
        ctx.globalAlpha = u;
        m.indications.forEach((ind, i) => {
          const ring = ringOf(g, i);
          if (ind.kind === 'crack' && !tagged.has(i)) {
            ctx.strokeStyle = C.rust;
            ctx.lineWidth = 2.5;
            ctx.setLineDash([5, 4]);
            ctx.beginPath();
            ctx.arc(ring.cx, ring.cy, ring.r, 0, TAU);
            ctx.stroke();
            ctx.setLineDash([]);
            tagText(g, ring.cx, ring.cy + ring.r + 11, 'missed crack', C.rust);
          } else if (ind.kind !== 'crack') {
            tagText(g, ring.cx, ring.cy + (tagged.has(i) ? ring.r + 11 : ring.r - 2), ind.kind === 'porosity' ? pits : KIND_NAME[ind.kind], tagged.has(i) ? C.rust : C.paper);
          }
        });
        ctx.globalAlpha = 1;
      }

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
      else if (!calls() && !wipes && clock < 5) info = 'Tap an indication to circle it, tap again to clear';
      else if (m.teach) info = !wipes ? hs[0] : hs[1 + (Math.floor(clock / 4.5) % (hs.length - 1))];
      else if (wiping()) info = 'Solvent wipe…';
      else if (wipes) info = `Wiped ${Math.min(99, clock - wipeStart - WIPE_DUR).toFixed(1)} s ago · ${m.developer} developer`;
      else info = `As developed · ${m.developer} developer`;
      if (info) fitLabel(ctx, info, g.w / 2, g.infoY, g.w - 32, { size: 12.5, weight: 700, color: m.teach ? C.fin : 'rgba(251,245,233,.62)' });

      button(g.wipeBtn, wiping() && !finished ? 'Wiping…' : 'Wipe', false, !finished && !wiping());
      button(g.signBtn, finished ? 'Signed off' : 'Sign off', true, !finished);
    }

    function badge(x: number, y: number, glyph: string, col: string) {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, TAU);
      ctx.fill();
      label(ctx, glyph, x, y + 1, { size: 12, weight: 900, color: C.white });
    }

    function tagText(g: G, x: number, y: number, text: string, col: string) {
      ctx.font = `800 11px ${FONT}`;
      const tw = ctx.measureText(text).width + 14;
      const cx = clamp(x, 6 + tw / 2, g.w - 6 - tw / 2);
      const cy = clamp(y, g.y + 10, g.y + g.ph - 10);
      roundRect(ctx, cx - tw / 2, cy - 9, tw, 18, 9);
      ctx.fillStyle = 'rgba(8,12,15,.82)';
      ctx.fill();
      label(ctx, text, cx, cy + 0.5, { size: 11, weight: 800, color: col });
    }

    function makeResult(): PuzzleResult {
      const r = scoreCrack(m, [...tagged.keys()], bare.length);
      const parts = [`${r.found}/${m.cracks} cracks`];
      if (r.falseCalls) parts.push(`${r.falseCalls} false call${r.falseCalls > 1 ? 's' : ''}`);
      parts.push(`${wipes} wipe${wipes === 1 ? '' : 's'}`);
      return result(r.score, parts.join(', '), { found: r.found, cracks: m.cracks, falseCalls: r.falseCalls, wipes });
    }

    function signOff() {
      if (finished) return;
      finished = true;
      revealT = clock;
      const res = makeResult();
      if (res.perfect) host.fx.flourish();
      else host.fx.good();
      settle(host, res, res.perfect ? 1100 : 1500);
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
