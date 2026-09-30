// Island geometry: the map layout (every zone, asset and flourish has a fixed
// spot so nothing ever collides), smooth-curve helpers, a tiny oblique
// projection for buildings and a seeded scatter with exclusion zones.
import { TIERS } from '../../sim/data';
import { rng } from '../../sim/rng';
import { buildDef, openBuild } from '../../sim/staff';
import type { IslandState, Role } from '../../sim/types';

export type Pt = [number, number];
export const W = 800;
export const H = 600;
/**
 * how far the sea (and the light over it) is drawn past the scene's edges: a whole-island view in a portrait Explore,
 * or a landscape one, shows sea out to the screen's edges (review round 2: flat bands of another blue read like a
 * broken render). The sea's gradients keep the frame they had on the old 60-unit overhang (SEA_BOX), padded beyond it
 */
export const SEA_FAR = 700;
/** the old overhang's box (-60 on every side) as a gradient frame: userSpaceOnUse gradients drawn as they were on it */
export const SEA_BOX = `matrix(${W + 120} 0 0 ${H + 120} -60 -60)`;

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
// The coastline is design B's island (scaled to leave a sea margin): a long
// finger and a sheltered lagoon in the north-west (floatplane dock), the
// airfield plain on the west with the hangar and a big apron, the mountain at
// the back with the waterfall, the river down the middle to the south beach,
// the town square in the middle, cottages east of the river, the lodge on the
// north-east shoulder and the villas on the south-east headland.

export const COAST: Pt[] = [
  [72, 212], [73, 170], [85, 129], [106, 100], [126, 104], [138, 130], [150, 160], [184, 182], [230, 180], [260, 154],
  [274, 122], [294, 98], [330, 88], [357, 70], [415, 49], [488, 37], [564, 43], [626, 64], [678, 92], [721, 119],
  [750, 161], [746, 208], [725, 245], [738, 290], [756, 340], [750, 391], [775, 431], [766, 484], [726, 511], [666, 516],
  [611, 527], [554, 535], [497, 543], [440, 539], [383, 541], [326, 547], [269, 543], [212, 535], [155, 524], [110, 501],
  [75, 465], [60, 419], [64, 374], [45, 334], [53, 286], [62, 250],
];
/** beach width per coast point: a thin rim in the lagoon, broad on the south beach */
const BEACH = [
  23, 21, 19, 17, 15, 15, 15, 17, 17, 15, 15, 17, 19, 19, 17, 17, 17, 17, 19, 21, 23, 23, 19, 23, 25, 25, 27, 29, 32, 34,
  36, 36, 36, 38, 40, 42, 42, 40, 38, 32, 27, 25, 21, 23, 23, 23,
];

/** inset a clockwise (on screen) outline by a per-point distance */
export function inset(p: Pt[], d: (i: number) => number): Pt[] {
  const n = p.length;
  return p.map((q, i) => {
    const a = p[(i - 1 + n) % n], b = p[(i + 1) % n];
    const tx = b[0] - a[0], ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1;
    return [Math.round(q[0] + (-ty / l) * d(i)), Math.round(q[1] + (tx / l) * d(i))] as Pt;
  });
}

/** grass plateau: inside the beach rim, a low cliff lip shows on its south faces */
export const PLATEAU: Pt[] = inset(COAST, (i) => BEACH[i] ?? 24);

export const COAST_S = sample(COAST);
export const PLATEAU_S = sample(PLATEAU);
export const LIP = 12;

/** the lodge terrace: a raised grass shelf on the mountain's north-east shoulder */
export const TERRACE: Pt[] = [
  [578, 150], [612, 128], [664, 118], [712, 124], [738, 152], [734, 188], [712, 208], [664, 214], [614, 212], [584, 196],
];
export const TERRACE_H = 16;

/** river: waterfall pool at the mountain foot, down the middle to the south beach */
export const FALLS: Pt = [536, 142]; // top of the waterfall
export const POOL: Pt = [534, 238];
export const RIVER: Pt[] = [
  [534, 238], [522, 268], [527, 304], [513, 346], [510, 390], [516, 432], [526, 474], [527, 510], [523, 552],
];
export const RIVER_S = sample(RIVER, false, 6);
/** where the river reaches the plateau's south lip and spills over it */
export const MOUTH: Pt = [527, 504];

export const RUNWAY = { a: [112, 441] as Pt, b: [378, 427] as Pt, w: 36 };
export const RUNWAY_ANGLE = (Math.atan2(RUNWAY.b[1] - RUNWAY.a[1], RUNWAY.b[0] - RUNWAY.a[0]) * 180) / Math.PI;
export const RUNWAY_LEN = Math.hypot(RUNWAY.b[0] - RUNWAY.a[0], RUNWAY.b[1] - RUNWAY.a[1]);
export const RUNWAY_C: Pt = [(RUNWAY.a[0] + RUNWAY.b[0]) / 2, (RUNWAY.a[1] + RUNWAY.b[1]) / 2];
/** the big apron in front of the hangar, and the taxiway down to the runway */
export const APRON: Pt[] = [
  [86, 296], [336, 292], [342, 372], [94, 380],
];
export const TAXIWAY: Pt[] = [[254, 374], [292, 372], [296, 420], [252, 422]];
export const HANGAR: Pt = [142, 292]; // front-centre ground point of the hangar
export const HANGAR_PAD: Pt[] = [[92, 292], [194, 292], [198, 318], [88, 318]];
export const OFFICE: Pt = [418, 268];
export const SQUARE = { c: [420, 330] as Pt, rx: 68, ry: 33 };
export const WINDSOCK: Pt = [392, 466]; // south-east of the runway's east end, clear of the plaza

/** front-centre ground point of every asset */
export const POS: Record<string, Pt> = {
  p1: [210, 342],
  p2: [300, 340],
  p3: [222, 128],
  h1: [592, 284],
  h2: [680, 276],
  h3: [600, 384],
  h4: [690, 378],
  // the villas on the south-east headland, a lawn's width apart
  h5: [697, 454],
  h6: [594, 462],
  h7: [666, 190], // on its own terrace, its retaining wall clear of the peak's boulders
  g1: [474, 398],
  gen: [462, 478],
  hangar: HANGAR,
  office: OFFICE,
};

/** the extra cottages' plots (docs/JOBFLOW.md 15.6): in the lagoon grove, off the grid's poles (fed underground) */
export const PLOT: Record<string, Pt> = {
  h8: [262, 220],
  h9: [304, 252],
};
/** the grove's young palms still standing: a plot in use ("h8,h9": built or going up) is cleared of the palms on it */
export const groveLeft = (plots: string): Pt[] =>
  SPOT.grove.filter((g) => !plots.split(',').some((id) => PLOT[id] && Math.hypot(g[0] - PLOT[id][0], g[1] - PLOT[id][1]) < 24));

/** where each plane is worked on when it is AOG: every plane has its own spot */
export const AOG_SPOT: Record<string, Pt> = {
  p1: [162, 352], // on jacks on the apron, out of the hangar mouth (room for its bubble above)
  p2: [300, 340], // on jacks on its own stand
  p3: [222, 128], // at its mooring, cowling open, mechanic on the dock
};

/** the floatplane jetty in the lagoon (tier 4): a short stem from the beach
 *  north to a T-head landing that lies across the water (x0..x1, y0..y1);
 *  the floatplane moors against the head's north edge */
export const DOCK = { root: [192, 192] as Pt, tip: [192, 160] as Pt, head: [164, 148, 232, 160] as [number, number, number, number] };

/** dirt paths, stone once the island is paved (the paved-paths flourish) */
export type PathDef = { pts: Pt[]; tier: number; w?: number; steps?: boolean };
export const PATHS: PathDef[] = [
  // apron → square
  { pts: [[338, 332], [352, 330]], tier: 1, w: 14 },
  // square → bridge → cottage lane
  { pts: [[486, 318], [506, 306], [526, 302], [552, 300], [600, 300], [648, 298], [700, 294], [728, 290]], tier: 1 },
  // square → south beach
  { pts: [[420, 362], [422, 400], [428, 444], [434, 486], [437, 498]], tier: 1 },
  // cottage spine and the lower lane
  { pts: [[646, 298], [648, 346], [650, 398]], tier: 2 },
  { pts: [[566, 404], [610, 402], [650, 398], [700, 396], [730, 390]], tier: 2 },
  // south path → substation → lower bridge → villa headland
  { pts: [[424, 424], [470, 426], [500, 430], [518, 434], [548, 436], [580, 434], [646, 424], [688, 416]], tier: 1 },
  // apron → floatplane dock
  { pts: [[236, 292], [224, 250], [206, 216], [192, 196]], tier: 4, w: 10 },
  // dock → lighthouse on the finger
  { pts: [[190, 198], [160, 196], [128, 178], [114, 158]], tier: 4, w: 8 },
  // lane → stone steps up to the lodge terrace
  { pts: [[612, 300], [614, 270], [618, 244], [624, 218]], tier: 5, steps: true },
];

/** where the south path reaches the lip: steps go down to the beach */
export const BEACH_STEPS: Pt = [437, 499];
/** the river's mouth on the sand: from the foot of the little fall to the waterline */
export const MOUTH_WATER = 539.5;

export const BRIDGES: { at: Pt; rot: number; len: number }[] = [
  { at: [526, 302], rot: -3, len: 36 },
  { at: [518, 434], rot: 3, len: 36 },
];

export type Box = [number, number, number, number];
/** zoom boxes per role [x0, y0, x1, y1]; the view frames the box at 4:3 */
export function focusBox(role: Role, tier: number): Box {
  // tall enough that the bubbles above the top-most asset (the floatplane,
  // the lodge, the first cottage row) stay inside the view
  if (role === 'mech') return tier >= 4 ? [60, 44, 400, 472] : [64, 206, 396, 472];
  if (role === 'fin') return [320, 160, 520, 384];
  return tier >= 5 ? [430, 60, 756, 506] : tier >= 4 ? [430, 190, 756, 512] : [430, 194, 744, 500];
}
/** the zoom factor that frames a box at the map's 4:3 */
export const zoomK = (b: Box | null) => (b ? Math.min(3.2, W / Math.max(b[2] - b[0], ((b[3] - b[1]) * W) / H)) : 1);
/** the view's centre for a box, clamped to the map */
function viewCentre(b: Box, k: number): Pt {
  const hw = W / 2 / k, hh = H / 2 / k;
  return [Math.max(hw, Math.min(W - hw, (b[0] + b[2]) / 2)), Math.max(hh, Math.min(H - hh, (b[1] + b[3]) / 2))];
}
/** view transform (CSS) that frames a box, clamped to the map */
export function zoomOf(b: Box | null) {
  if (!b) return 'none';
  const k = zoomK(b);
  const [cx, cy] = viewCentre(b, k);
  return `translate(${f1(W / 2 - cx * k)}px, ${f1(H / 2 - cy * k)}px) scale(${Math.round(k * 1000) / 1000})`;
}
/** the part of the map that is on screen for a box (the whole map unzoomed) */
export function viewOf(b: Box | null): Box {
  if (!b) return [0, 0, W, H];
  const k = zoomK(b);
  const [cx, cy] = viewCentre(b, k);
  return [cx - W / 2 / k, cy - H / 2 / k, cx + W / 2 / k, cy + H / 2 / k];
}
/** a tap target of `px` CSS px in drawing units, under a zoom box, on a drawing `cssW` CSS px wide */
export const hitUnits = (px: number, cssW: number, b: Box | null) => (px * W) / (Math.max(1, cssW) * zoomK(b));

// ------------------------------------------------ the builders' site ---
// The builders' zoom (docs/JOBFLOW.md 15.5): a box around the open build's
// site, where the builders stand and the site shows its stage. A pure function
// of the state, like focusBox, so a camera can use it as a preset.

/** what a build site looks like, from the catalog model of what goes up there */
export type SiteKind = 'house' | 'villa' | 'lodge' | 'gen';
export const siteKindOf = (model: string): SiteKind | null =>
  model === 'cottage' ? 'house' : model === 'villa' ? 'villa' : model === 'lodge' ? 'lodge' : model === 'gen' ? 'gen' : null;
/** one place the builders work: a new building's plot (its front-centre ground point), or the seaplane dock (its root on the beach) */
export type WorkSite = { id: string; kind: SiteKind | 'dock'; at: Pt };
/** a site's screen extent around its ground point [x0, y0, x1, y1], as sites.tsx draws it: the dug plot, the
 *  frame, the tower crane at its tallest, the lumber, the barrier and the builders on it */
export const SITE_EXTENT: Record<WorkSite['kind'], Box> = {
  house: [-38, -80, 45, 26],
  villa: [-49, -72, 50, 24],
  lodge: [-49, -62, 52, 24],
  gen: [-28, -48, 48, 14],
  // the stakes on the stem, the piles under the T-head, the buoy, the lumber and the builders on the beach
  dock: [-42, -60, 64, 18],
};
/** the materials that go into the seaplane dock (its pilings and marine decking): a unit that draws one is worked at the dock */
const DOCK_ITEMS = ['BLD-PILE', 'BLD-MDECK'];

/**
 * Where the open build's work is: an extra cottage's plot, or the tier build's
 * new buildings. The builders work one unit at a time, so on the villas and
 * the seaplane dock (tier 4) they are at the dock for its pilings and decking
 * and at the villas for their footings and shutters. Empty with no build open.
 */
export function workSites(s: Pick<IslandState, 'builds' | 'tier'>): WorkSite[] {
  const b = openBuild(s);
  if (!b) return [];
  if (b.cottage) return PLOT[b.cottage] ? [{ id: b.cottage, kind: 'house', at: PLOT[b.cottage] }] : [];
  // G0: a renovation's site is the house itself
  if (b.reno) {
    const at = POS[b.reno] ?? PLOT[b.reno];
    return at ? [{ id: b.reno, kind: 'house', at }] : [];
  }
  const all: WorkSite[] = [];
  for (const a of TIERS[(b.tier ?? 0) - 1]?.adds ?? []) {
    const kind = a.id === 'p3' ? 'dock' : siteKindOf(a.model);
    const at = a.id === 'p3' ? DOCK.root : POS[a.id];
    if (kind && at) all.push({ id: a.id, kind, at });
  }
  const unit = buildDef(b.id)?.units[Math.max(0, Math.min(b.need - 1, Math.floor(b.done + 1e-9)))];
  const atDock = !!unit && Object.keys(unit).some((i) => DOCK_ITEMS.includes(i));
  const here = all.filter((w) => (w.kind === 'dock') === atDock);
  return here.length ? here : all;
}

/** the builders' zoom box: the open build's work sites with a margin, inside the map; null with no build open */
export function siteBox(s: Pick<IslandState, 'builds' | 'tier'>): Box | null {
  const ws = workSites(s);
  if (!ws.length) return null;
  const pad = 10;
  const b: Box = [W, H, 0, 0];
  for (const { kind, at } of ws) {
    const e = SITE_EXTENT[kind];
    b[0] = Math.min(b[0], at[0] + e[0] - pad);
    b[1] = Math.min(b[1], at[1] + e[1] - pad);
    b[2] = Math.max(b[2], at[0] + e[2] + pad);
    b[3] = Math.max(b[3], at[1] + e[3] + pad);
  }
  return [Math.max(0, b[0]), Math.max(0, b[1]), Math.min(W, b[2]), Math.min(H, b[3])];
}

/** flourish spots (growth.ts), placed clear of every asset and path */
export const SPOT = {
  garden: [[366, 290], [472, 290]] as Pt[],
  // off-grid, west of the mountain foot's boulders (they reach down to y ~221 east of x 290)
  grove: [[256, 200], [284, 205], [245, 222], [270, 227], [294, 235], [230, 236], [254, 247], [279, 251], [305, 244]] as Pt[],
  boats: [[106, 474], [132, 496]] as Pt[],
  bar: [318, 526] as Pt,
  fountain: [420, 332] as Pt,
  market: [[382, 312], [458, 312], [396, 358]] as Pt[],
  lighthouse: [112, 146] as Pt,
  boardwalk: [[176, 519], [240, 525], [300, 527], [360, 526], [416, 522]] as Pt[],
  yacht: [372, 580] as Pt,
  observatory: [498, 72] as Pt,
  statue: [420, 396] as Pt, // on its own roundel where the south path leaves the square
  benches: [[380, 382], [462, 380], [560, 318], [562, 420]] as Pt[],
  lamps: [[358, 304], [484, 306], [548, 318], [634, 318], [396, 424], [540, 452], [346, 352]] as Pt[],
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
