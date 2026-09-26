// Island geometry: the map layout (every zone, asset and flourish has a fixed
// spot so nothing ever collides), smooth-curve helpers, a tiny oblique
// projection for buildings and a seeded scatter with exclusion zones.
import { rng } from '../../sim/rng';
import type { Role } from '../../sim/types';

export type Pt = [number, number];
export const W = 800;
export const H = 600;

const f1 = (n: number) => Math.round(n * 10) / 10;
export const pt = (p: Pt) => `${f1(p[0])} ${f1(p[1])}`;
export const poly = (p: Pt[]) => p.map((q) => `${f1(q[0])},${f1(q[1])}`).join(' ');
export const lin = (p: Pt[], close = false) => 'M' + p.map(pt).join('L') + (close ? 'Z' : '');

/** Catmull-Rom through the points as cubic Béziers (closed or open). */
export function curve(p: Pt[], closed = true, t = 1): string {
  const n = p.length;
  const at = (i: number) => (closed ? p[(i + n) % n] : p[Math.max(0, Math.min(n - 1, i))]);
  let d = `M${pt(p[0])}`;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const c1: Pt = [p1[0] + ((p2[0] - p0[0]) * t) / 6, p1[1] + ((p2[1] - p0[1]) * t) / 6];
    const c2: Pt = [p2[0] - ((p3[0] - p1[0]) * t) / 6, p2[1] - ((p3[1] - p1[1]) * t) / 6];
    d += `C${pt(c1)} ${pt(c2)} ${pt(p2)}`;
  }
  return closed ? d + 'Z' : d;
}

/** The same curve as a dense polyline, for hit tests. */
export function sample(p: Pt[], closed = true, steps = 8): Pt[] {
  const n = p.length;
  const at = (i: number) => (closed ? p[(i + n) % n] : p[Math.max(0, Math.min(n - 1, i))]);
  const out: Pt[] = [];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    for (let k = 0; k < steps; k++) {
      const t = k / steps, u = 1 - t;
      out.push([
        u * u * u * p1[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p2[0],
        u * u * u * p1[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p2[1],
      ]);
    }
  }
  if (!closed) out.push(p[n - 1]);
  return out;
}

export function inPoly([x, y]: Pt, pl: Pt[]) {
  let inside = false;
  for (let i = 0, j = pl.length - 1; i < pl.length; j = i++) {
    const [xi, yi] = pl[i], [xj, yj] = pl[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segDist([px, py]: Pt, [ax, ay]: Pt, [bx, by]: Pt) {
  const dx = bx - ax, dy = by - ay;
  const l = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
export function lineDist(p: Pt, line: Pt[]) {
  let d = Infinity;
  for (let i = 0; i < line.length - 1; i++) d = Math.min(d, segDist(p, line[i], line[i + 1]));
  return d;
}
/** Distance from p to a closed polygon's edge. */
export const edgeDist = (p: Pt, pl: Pt[]) => lineDist(p, [...pl, pl[0]]);

/** A point along a polyline at fraction t (by length). */
export function along(line: Pt[], t: number): Pt {
  const lens = line.slice(1).map((q, i) => Math.hypot(q[0] - line[i][0], q[1] - line[i][1]));
  let d = t * lens.reduce((a, b) => a + b, 0);
  for (let i = 0; i < lens.length; i++) {
    if (d <= lens[i]) {
      const k = d / (lens[i] || 1);
      return [line[i][0] + (line[i + 1][0] - line[i][0]) * k, line[i][1] + (line[i + 1][1] - line[i][1]) * k];
    }
    d -= lens[i];
  }
  return line[line.length - 1];
}

// ---------------------------------------------------------------- layout ---
// 800 x 600 map, light from the upper left, shadows fall down-right.
// Mountain at the back (north-east), airfield on the north-west plain, the
// town square in the middle, cottages east of the river, a sheltered bay in
// the south for the floatplane, beaches for the leisure flourishes.

export const COAST: Pt[] = [
  [26, 352], [44, 318], [60, 284], [56, 240], [56, 196], [74, 150], [114, 120], [176, 102], [246, 90], [316, 80],
  [392, 70], [468, 56], [556, 46], [640, 56], [704, 86], [738, 130], [734, 176], [760, 210], [786, 262], [784, 318],
  [762, 362], [730, 394], [708, 434], [666, 472], [606, 492], [548, 494], [508, 480], [482, 458], [452, 450], [420, 458],
  [398, 478], [366, 502], [300, 516], [230, 520], [162, 510], [108, 488], [76, 456], [62, 418], [44, 388],
];

/** grass plateau: inside the beach rim, a low cliff lip shows on its south faces */
export const PLATEAU: Pt[] = [
  [50, 350], [66, 318], [80, 284], [76, 240], [78, 198], [96, 164], [130, 138], [186, 122], [250, 110], [318, 100],
  [392, 90], [468, 78], [556, 70], [636, 80], [690, 106], [712, 138], [708, 178], [732, 214], [758, 262], [756, 312],
  [736, 346], [706, 374], [684, 414], [646, 444], [598, 460], [552, 462], [520, 450], [496, 430], [454, 420], [416, 424],
  [388, 440], [356, 452], [298, 458], [232, 458], [172, 452], [130, 438], [102, 414], [86, 390], [66, 376],
];

export const COAST_S = sample(COAST);
export const PLATEAU_S = sample(PLATEAU);
export const LIP = 12;

/** the lodge terrace, a raised rock shelf on the mountain's south-east shoulder */
export const TERRACE: Pt[] = [
  [590, 176], [636, 160], [690, 164], [712, 190], [700, 222], [660, 234], [612, 230], [588, 206],
];
export const TERRACE_H = 16;

/** river: waterfall pool at the mountain foot, down through town into the bay */
export const RIVER: Pt[] = [
  [520, 212], [512, 244], [494, 276], [484, 312], [480, 350], [474, 388], [468, 418], [466, 446], [466, 470],
];
export const RIVER_S = sample(RIVER, false, 6);
export const FALLS: Pt = [522, 150]; // top of the waterfall

export const RUNWAY = { a: [108, 196] as Pt, b: [398, 152] as Pt, w: 36 };
export const RUNWAY_ANGLE = (Math.atan2(RUNWAY.b[1] - RUNWAY.a[1], RUNWAY.b[0] - RUNWAY.a[0]) * 180) / Math.PI;
export const RUNWAY_LEN = Math.hypot(RUNWAY.b[0] - RUNWAY.a[0], RUNWAY.b[1] - RUNWAY.a[1]);
export const RUNWAY_C: Pt = [(RUNWAY.a[0] + RUNWAY.b[0]) / 2, (RUNWAY.a[1] + RUNWAY.b[1]) / 2];
export const APRON: Pt[] = [
  [174, 214], [352, 188], [360, 242], [196, 268], [176, 266],
];
export const HANGAR: Pt = [122, 282]; // front-centre ground point of the hangar
export const HANGAR_PAD: Pt[] = [[66, 282], [178, 282], [184, 316], [60, 316]];
export const OFFICE: Pt = [360, 322];
export const SQUARE = { c: [360, 356] as Pt, rx: 64, ry: 34 };

/** front-centre ground point of every asset */
export const POS: Record<string, Pt> = {
  p1: [238, 238],
  p2: [310, 222],
  p3: [474, 508],
  h1: [556, 318],
  h2: [634, 300],
  h3: [572, 392],
  h4: [650, 376],
  h5: [712, 250],
  h6: [716, 334],
  h7: [650, 212],
  g1: [526, 276],
  gen: [524, 420],
  hangar: HANGAR,
  office: OFFICE,
  aog: [120, 300],
};

/** where the floatplane dock goes (tier 4) */
export const DOCK = { root: [392, 466] as Pt, tip: [446, 500] as Pt };

/** dirt paths, stone once the island is paved (tier 3) */
export type PathDef = { pts: Pt[]; tier: number; w?: number; steps?: boolean };
export const PATHS: PathDef[] = [
  // apron → square
  { pts: [[300, 256], [318, 280], [340, 300], [350, 326]], tier: 1 },
  // hangar pad → apron edge (service road)
  { pts: [[180, 300], [216, 290], [250, 272]], tier: 1, w: 9 },
  // square → bridge → cottage lane
  { pts: [[410, 348], [446, 350], [480, 350], [512, 344], [548, 334], [596, 318], [640, 310], [680, 300]], tier: 1 },
  // lane → t2 cottages
  { pts: [[548, 334], [566, 360], [590, 384]], tier: 2 },
  { pts: [[640, 310], [650, 340], [662, 370]], tier: 2 },
  // lane → villas on the headland
  { pts: [[680, 300], [702, 282], [712, 262]], tier: 4 },
  { pts: [[680, 300], [700, 318], [712, 334]], tier: 4 },
  // lane → steps up to the lodge terrace
  { pts: [[596, 318], [606, 284], [626, 252], [640, 226]], tier: 5, steps: true },
  // square → dock on the bay
  { pts: [[356, 388], [366, 414], [382, 440], [394, 462]], tier: 4 },
  // square → west lawn → beach
  { pts: [[304, 372], [270, 400], [238, 428], [216, 452]], tier: 1 },
  // cottages → generator
  { pts: [[512, 344], [514, 376], [518, 402]], tier: 3 },
  // hangar pad → lighthouse
  { pts: [[66, 306], [52, 328]], tier: 4, w: 8 },
];

export const BRIDGES: { at: Pt; rot: number; len: number }[] = [
  { at: [480, 350], rot: 0, len: 34 },
  { at: [468, 432], rot: 90, len: 26 },
];

export const FOCUS: Record<Role, { x: number; y: number; k: number }> = {
  mech: { x: 232, y: 222, k: 2.2 },
  elec: { x: 606, y: 292, k: 1.8 },
  fin: { x: 360, y: 330, k: 3.1 },
};

/** view transform (CSS) that frames a focus zone, clamped to the map */
export function zoomOf(z: { x: number; y: number; k: number } | null) {
  if (!z) return 'none';
  const hw = W / 2 / z.k, hh = H / 2 / z.k;
  const cx = Math.max(hw, Math.min(W - hw, z.x));
  const cy = Math.max(hh, Math.min(H - hh, z.y));
  return `translate(${f1(W / 2 - cx * z.k)}px, ${f1(H / 2 - cy * z.k)}px) scale(${z.k})`;
}

/** flourish spots (growth.ts), placed clear of every asset and path */
export const SPOT = {
  garden: [[322, 330], [398, 330]] as Pt[],
  grove: [[200, 322], [226, 318], [252, 314], [192, 344], [218, 340], [244, 336], [184, 366], [210, 362], [236, 358]] as Pt[],
  boats: [[108, 452], [132, 470]] as Pt[],
  bar: [262, 480] as Pt,
  fountain: [360, 360] as Pt,
  market: [[312, 360], [406, 362], [330, 384]] as Pt[],
  lighthouse: [44, 338] as Pt,
  boardwalk: [[150, 500], [220, 505], [300, 500], [352, 488]] as Pt[],
  yacht: [362, 548] as Pt,
  observatory: [566, 58] as Pt,
  statue: [392, 386] as Pt,
  benches: [[430, 338], [334, 404], [586, 330], [272, 392]] as Pt[],
  pond: [150, 384] as Pt,
  lamps: [[424, 358], [500, 340], [556, 322], [620, 314], [374, 424], [290, 386], [330, 292]] as Pt[],
};

// -------------------------------------------------- oblique projection ---
// Buildings are built from boxes and roofs in local 3D (x east, y up, z north)
// and projected: screen x = x + A z, screen y = -y - B z. Fronts face the
// viewer undistorted, east sides show as a slim parallelogram.
export const A = 0.34;
export const B = 0.5;
export type V3 = [number, number, number];
export const P = ([x, y, z]: V3): Pt => [x + A * z, -y - B * z];
export const face = (vs: V3[]) => lin(vs.map(P), true);

// ----------------------------------------------------- seeded scatter ---
export type Zone = { c: Pt; r: number } | { line: Pt[]; r: number } | { poly: Pt[]; pad: number };
export function clear(p: Pt, zones: Zone[]) {
  for (const z of zones) {
    if ('c' in z) {
      if (Math.hypot(p[0] - z.c[0], p[1] - z.c[1]) < z.r) return false;
    } else if ('line' in z) {
      if (lineDist(p, z.line) < z.r) return false;
    } else if (inPoly(p, z.poly) || edgeDist(p, z.poly) < z.pad) return false;
  }
  return true;
}

/** n points inside `region`, clear of `zones` and at least `gap` apart. Deterministic. */
export function scatter(seed: number, n: number, region: (p: Pt) => boolean, zones: Zone[], gap: number, box: [number, number, number, number] = [0, 0, W, H]): Pt[] {
  const r = rng(seed);
  const out: Pt[] = [];
  for (let tries = 0; tries < n * 40 && out.length < n; tries++) {
    const p: Pt = [r.range(box[0], box[2]), r.range(box[1], box[3])];
    if (!region(p) || !clear(p, zones)) continue;
    if (out.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < gap)) continue;
    out.push(p);
  }
  return out;
}
