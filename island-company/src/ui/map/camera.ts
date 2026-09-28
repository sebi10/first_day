// The map camera (docs/EXPANSION.md 5.5): pure math, no DOM.
//
// A camera is { x, y, k } in the scene's units: the view's centre, and the zoom
// (k = 1: the whole scene contained in the viewport). Screen points are CSS px
// from the viewport's top-left. A scene point p is on screen at
//   vp/2 + S * (p - (x, y)),   S = base(vp) * k   (CSS px per scene unit)
// so the centre of the camera is the centre of the viewport, whatever its
// shape: the 4:3 inline map, or a portrait Explore that letterboxes the scene.
//
// The scene is drawn once per committed camera (island.tsx), over a raster
// region around the view (frameOf), and gestures move the drawing with a CSS
// transform only (relTransform) until they end.
import { H, W, type Box, type Pt } from '../island/geo';

export type Cam = { x: number; y: number; k: number };
export type Size = { w: number; h: number };
export type Limits = { kMin: number; kMax: number };
/** the inline map or Explore (5.1) */
export type MapMode = 'inline' | 'explore';
/** what the camera looks at: a station's scene, or the region map (stage 3: 1000 x 700) */
export type SceneKind = 'scene' | 'region';

/** the home scene (the island's viewBox) */
export const HOME_SCENE: Size = { w: W, h: H };
/** the region map (stage 3, 5.4) */
export const REGION_SCENE: Size = { w: 1000, h: 700 };

/** the most a preset or the inline map zooms (geo.tsx zoomK's cap) */
export const K_MAX = 3.2;
/** Explore on a phone goes a little closer (5.5) */
export const K_MAX_PHONE_EXPLORE = 4;
/** a phone: the viewport's short side is under this many CSS px */
const PHONE = 600;
/** preset changes, double-tap and the buttons fly for this long (today's zoom ease) */
export const FLIGHT_MS = 450;
export const FLIGHT_EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const f1 = (n: number) => Math.round(n * 10) / 10;

/** the zoom limits for a mode and viewport; `region` (stage 3) may pinch out to 0.8 in Explore */
export function limitsFor(mode: MapMode, vp: Size): Limits {
  return { kMin: 1, kMax: mode === 'explore' && Math.min(vp.w, vp.h) < PHONE ? K_MAX_PHONE_EXPLORE : K_MAX };
}
const INLINE: Limits = { kMin: 1, kMax: K_MAX };

/** CSS px per scene unit at k = 1: the whole scene contained ("contain" fit) */
export const base = (vp: Size, sc: Size = HOME_SCENE) => Math.min(vp.w / sc.w, vp.h / sc.h);
/** CSS px per scene unit at this camera */
export const pxPerUnit = (c: Cam, vp: Size, sc: Size = HOME_SCENE) => base(vp, sc) * c.k;

/** the part of the scene on screen [x0, y0, x1, y1] (it may overhang the scene where a portrait Explore letterboxes) */
export function viewRect(c: Cam, vp: Size, sc: Size = HOME_SCENE): Box {
  const s = pxPerUnit(c, vp, sc);
  const hw = vp.w / (2 * s), hh = vp.h / (2 * s);
  return [c.x - hw, c.y - hh, c.x + hw, c.y + hh];
}

/** the camera with k in its limits and the view inside the scene (centred on an axis where the scene fits) */
export function clampCam(c: Cam, vp: Size, sc: Size = HOME_SCENE, lim: Limits = INLINE): Cam {
  const k = clamp(Number.isFinite(c.k) ? c.k : 1, lim.kMin, lim.kMax);
  const s = base(vp, sc) * k;
  const hw = vp.w / (2 * s), hh = vp.h / (2 * s);
  const x = hw >= sc.w / 2 ? sc.w / 2 : clamp(Number.isFinite(c.x) ? c.x : sc.w / 2, hw, sc.w - hw);
  const y = hh >= sc.h / 2 ? sc.h / 2 : clamp(Number.isFinite(c.y) ? c.y : sc.h / 2, hh, sc.h - hh);
  return { x, y, k };
}

/** the whole scene */
export const allCam = (vp: Size, sc: Size = HOME_SCENE, lim: Limits = INLINE): Cam => clampCam({ x: sc.w / 2, y: sc.h / 2, k: 1 }, vp, sc, lim);

/**
 * The camera that frames a box (a preset: the seat's zone, the build site): the most zoom that shows all of it,
 * capped, centred on it and clamped. In the inline 4:3 map it is exactly geo.tsx zoomOf's view (5.5).
 */
export function camForBox(b: Box | null, vp: Size = HOME_SCENE, sc: Size = HOME_SCENE, lim: Limits = INLINE): Cam {
  if (!b) return allCam(vp, sc, lim);
  const s0 = base(vp, sc);
  const bw = Math.max(1, b[2] - b[0]), bh = Math.max(1, b[3] - b[1]);
  const k = Math.min(K_MAX, lim.kMax, vp.w / (s0 * bw), vp.h / (s0 * bh));
  return clampCam({ x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2, k: Math.max(lim.kMin, k) }, vp, sc, lim);
}

/** the camera as geo.tsx zoomOf writes it on the zoom <g> of a scene-sized drawing (the lab and old callers) */
export function camTransform(c: Cam, sc: Size = HOME_SCENE): string {
  if (Math.abs(c.k - 1) < 1e-9 && Math.abs(c.x - sc.w / 2) < 1e-9 && Math.abs(c.y - sc.h / 2) < 1e-9) return 'none';
  return `translate(${f1(sc.w / 2 - c.x * c.k)}px, ${f1(sc.h / 2 - c.y * c.k)}px) scale(${Math.round(c.k * 1000) / 1000})`;
}

/** screen point (CSS px in the viewport) → scene point */
export function toScene(c: Cam, p: Pt, vp: Size, sc: Size = HOME_SCENE): Pt {
  const s = pxPerUnit(c, vp, sc);
  return [c.x + (p[0] - vp.w / 2) / s, c.y + (p[1] - vp.h / 2) / s];
}
/** scene point → screen point */
export function toScreen(c: Cam, p: Pt, vp: Size, sc: Size = HOME_SCENE): Pt {
  const s = pxPerUnit(c, vp, sc);
  return [vp.w / 2 + (p[0] - c.x) * s, vp.h / 2 + (p[1] - c.y) * s];
}

/** the camera that puts scene point `p` under screen point `at` at zoom k (unclamped) */
function pin(p: Pt, at: Pt, k: number, vp: Size, sc: Size): Cam {
  const s = base(vp, sc) * k;
  return { x: p[0] - (at[0] - vp.w / 2) / s, y: p[1] - (at[1] - vp.h / 2) / s, k };
}

/** zoom by `f` about a screen point: what is under it stays under it (unless the edge of the scene stops it) */
export function zoomAt(c: Cam, at: Pt, f: number, vp: Size, sc: Size = HOME_SCENE, lim: Limits = INLINE): Cam {
  const k = clamp(c.k * f, lim.kMin, lim.kMax);
  return clampCam(pin(toScene(c, at, vp, sc), at, k, vp, sc), vp, sc, lim);
}

/** drag the map by (dx, dy) CSS px */
export function panCam(c: Cam, dx: number, dy: number, vp: Size, sc: Size = HOME_SCENE, lim: Limits = INLINE): Cam {
  const s = pxPerUnit(c, vp, sc);
  return clampCam({ x: c.x - dx / s, y: c.y - dy / s, k: c.k }, vp, sc, lim);
}

export const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
export const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/**
 * Two fingers moved from (a0, b0) to (a, b): zoom by the change in their spread, about their midpoint, and pan with
 * the midpoint, so the point that was under the fingers stays under them (5.2).
 */
export function pinchCam(c0: Cam, a0: Pt, b0: Pt, a: Pt, b: Pt, vp: Size, sc: Size = HOME_SCENE, lim: Limits = INLINE): Cam {
  const d0 = Math.max(1, dist(a0, b0));
  const k = clamp((c0.k * dist(a, b)) / d0, lim.kMin, lim.kMax);
  return clampCam(pin(toScene(c0, mid(a0, b0), vp, sc), mid(a, b), k, vp, sc), vp, sc, lim);
}

/**
 * The CSS transform (origin at the viewport's top-left) that makes a drawing made for camera `from` look like camera
 * `to`: screen_to = t + r * screen_from.
 */
export function relTransform(from: Cam, to: Cam, vp: Size, sc: Size = HOME_SCENE): { tx: number; ty: number; r: number } {
  const r = to.k / from.k;
  const s1 = pxPerUnit(to, vp, sc);
  return { tx: (vp.w / 2) * (1 - r) + s1 * (from.x - to.x), ty: (vp.h / 2) * (1 - r) + s1 * (from.y - to.y), r };
}
export function relCss(from: Cam, to: Cam, vp: Size, sc: Size = HOME_SCENE): string {
  if (sameCam(from, to)) return '';
  const { tx, ty, r } = relTransform(from, to, vp, sc);
  return `translate3d(${Math.round(tx * 100) / 100}px, ${Math.round(ty * 100) / 100}px, 0) scale(${Math.round(r * 10000) / 10000})`;
}

export const sameCam = (a: Cam, b: Cam, eps = 1e-3) => Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps && Math.abs(a.k - b.k) < eps * 0.1;
/** a camera close enough to a preset's to light its chip */
export const nearCam = (a: Cam, b: Cam) => Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1 && Math.abs(a.k - b.k) < 0.01;

const inter = (a: Box, b: Box): Box => [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
const within = (outer: Box, inner: Box, eps = 0.5) => inner[0] >= outer[0] - eps && inner[1] >= outer[1] - eps && inner[2] <= outer[2] + eps && inner[3] <= outer[3] + eps;

/** device px that one committed drawing may cover: the scene is drawn over the view plus a margin, within this */
export const RASTER_BUDGET = 4_000_000;

export type Frame = {
  cam: Cam;
  /** the visible rect (scene units) */
  view: Box;
  /** the part of the scene drawn (scene units): the whole scene when it fits the budget, else the view plus a margin */
  region: Box;
  /** CSS px per scene unit */
  S: number;
};

/**
 * What one committed camera draws (5.6): the region of the scene the drawing covers, so a pinch out or a pan shows
 * real ground right up to its edges. The whole scene when it fits in the raster budget (the inline map on a phone,
 * at every zoom); else the view grown on every side as far as the budget allows (Explore, close up).
 */
/** how far the scene's own sea is drawn past its edges (terrain.tsx: the sea rect overhangs by 60) */
export const SEA_OVERHANG = 60;

export function frameOf(c: Cam, vp: Size, sc: Size = HOME_SCENE, dpr = 1, budget = RASTER_BUDGET): Frame {
  const S = pxPerUnit(c, vp, sc);
  const view = viewRect(c, vp, sc);
  // the scene, plus its drawn sea on an axis where a letterboxed view overhangs it (a portrait Explore)
  const o = SEA_OVERHANG;
  const e = 0.5;
  const scene: Box = [view[0] < -e ? -o : 0, view[1] < -e ? -o : 0, view[2] > sc.w + e ? sc.w + o : sc.w, view[3] > sc.h + e ? sc.h + o : sc.h];
  const px = (b: Box) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]) * S * S * dpr * dpr;
  const cap = Math.max(budget, 2.5 * vp.w * vp.h * dpr * dpr);
  const vis = inter(view, scene);
  const grow = (t: number): Box => {
    const mx = t * (vis[2] - vis[0]), my = t * (vis[3] - vis[1]);
    return inter([vis[0] - mx, vis[1] - my, vis[2] + mx, vis[3] + my], scene);
  };
  let region: Box;
  if (px(scene) <= cap) region = scene;
  else {
    let lo = 0, hi = 1.5;
    for (let i = 0; i < 14; i++) {
      const t = (lo + hi) / 2;
      if (px(grow(t)) <= cap) lo = t;
      else hi = t;
    }
    region = grow(lo);
  }
  // whole scene units, so a drawing's edge never lands between two device pixels of ground
  region = [Math.floor(region[0]), Math.floor(region[1]), Math.ceil(region[2]), Math.ceil(region[3])];
  return { cam: c, view, region: inter(region, scene), S };
}

/**
 * How a preset change animates (5.5), so the ground is drawn all the way through the flight:
 * - `forward`: the drawing on screen flies to the new view (it covers it), then the new camera is drawn
 * - `flip`: the new camera is drawn first (it covers the old view) and flies in from the old view
 * - `via`: neither covers the other (two distant zooms): draw the whole scene, fly across it, then draw the new view
 */
export type Flight = 'forward' | 'flip' | 'via';
export function planFlight(from: Cam, to: Cam, vp: Size, sc: Size = HOME_SCENE, dpr = 1): Flight {
  const scene: Box = [0, 0, sc.w, sc.h];
  const a = frameOf(from, vp, sc, dpr), b = frameOf(to, vp, sc, dpr);
  if (within(a.region, inter(b.view, scene))) return 'forward';
  if (within(b.region, inter(a.view, scene))) return 'flip';
  return 'via';
}

/** what `touch-action` the map's surface takes (5.1): inline, one finger always scrolls the page, at every zoom */
export const touchActionFor = (mode: MapMode) => (mode === 'explore' ? 'none' : 'pan-y');
