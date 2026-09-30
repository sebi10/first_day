// The map camera (docs/EXPANSION.md 5, 13.2): the math (clamps, zoom about a
// point, the pinch midpoint, the presets equal to today's zooms, contain-fit
// in a portrait Explore, the raster region), the tap/drag/pinch classifier,
// touch-action, and the controller: no render until a gesture ends, then one.
import { describe, expect, it } from 'vitest';
import { rng } from '../src/sim/rng';
import { BUILDS, COTTAGE, COTTAGE_PLOTS } from '../src/sim/staff';
import { ROLES, type Build } from '../src/sim/types';
import { focusBox, H, siteBox, W, zoomOf, type Box, type Pt } from '../src/ui/island/geo';
import {
  allCam, base, camForBox, camTransform, clampCam, frameOf, HOME_SCENE, K_MAX, K_MAX_PHONE_EXPLORE, limitsFor, panCam, pinchCam, planFlight, pxPerUnit, RASTER_BUDGET, relTransform,
  SEA_OVERHANG, toScene, toScreen, touchActionFor, viewRect, zoomAt, type Cam, type Size,
} from '../src/ui/map/camera';
import { MapController, type MapDeps } from '../src/ui/map/controller';
import { Classifier, TAP, type GOut, type PIn } from '../src/ui/map/gestures';

const INLINE: Size = { w: 358, h: 268.5 }; // the phone card (4:3)
const INLINE_DESK: Size = { w: 600, h: 450 };
const EXPLORE_PHONE: Size = { w: 390, h: 724 }; // full screen under the chips
const EXPLORE_DESK: Size = { w: 1280, h: 760 };
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

describe('camera math', () => {
  it('clamps k to its limits and keeps the view on the scene (centred where the scene fits)', () => {
    const r = rng(7);
    for (const vp of [INLINE, INLINE_DESK, EXPLORE_PHONE, EXPLORE_DESK]) {
      const lim = limitsFor(vp === EXPLORE_PHONE || vp === EXPLORE_DESK ? 'explore' : 'inline', vp);
      for (let i = 0; i < 300; i++) {
        const c = clampCam({ x: r.range(-400, 1200), y: r.range(-300, 900), k: r.range(0.2, 9) }, vp, HOME_SCENE, lim);
        expect(c.k).toBeGreaterThanOrEqual(lim.kMin);
        expect(c.k).toBeLessThanOrEqual(lim.kMax);
        const v = viewRect(c, vp);
        // on each axis the view is inside the scene, or (a letterbox) centred on it
        for (const [lo, hi, size] of [[v[0], v[2], W], [v[1], v[3], H]] as const) {
          if (hi - lo <= size + 1e-6) {
            expect(lo).toBeGreaterThanOrEqual(-1e-6);
            expect(hi).toBeLessThanOrEqual(size + 1e-6);
          } else expect(near((lo + hi) / 2, size / 2)).toBe(true);
        }
      }
    }
    // the limits: 3.2 inline and on desktop, 4 in Explore on a phone
    expect(limitsFor('inline', INLINE).kMax).toBe(K_MAX);
    expect(limitsFor('explore', EXPLORE_PHONE).kMax).toBe(K_MAX_PHONE_EXPLORE);
    expect(limitsFor('explore', { w: 844, h: 390 }).kMax).toBe(K_MAX_PHONE_EXPLORE);
    expect(limitsFor('explore', EXPLORE_DESK).kMax).toBe(K_MAX);
    expect(limitsFor('inline', INLINE).kMin).toBe(1);
  });

  it('zoomAt keeps the point under the finger (and pans with it)', () => {
    const r = rng(11);
    let checked = 0;
    for (const vp of [INLINE, EXPLORE_PHONE, EXPLORE_DESK]) {
      const lim = limitsFor('explore', vp);
      for (let i = 0; i < 300; i++) {
        const c0 = clampCam({ x: r.range(250, 550), y: r.range(200, 400), k: r.range(1.4, 3) }, vp, HOME_SCENE, lim);
        const at: Pt = [vp.w * r.range(0.2, 0.8), vp.h * r.range(0.2, 0.8)];
        const f = r.range(0.8, 1.3);
        const c1 = zoomAt(c0, at, f, vp, HOME_SCENE, lim);
        const p = toScene(c0, at, vp);
        const back = toScreen(c1, p, vp);
        // where the scene's edge doesn't stop it, the point stays exactly under the finger
        const v = viewRect(c1, vp);
        const free = v[0] > 1e-6 && v[1] > 1e-6 && v[2] < W - 1e-6 && v[3] < H - 1e-6 && near(c1.k, c0.k * f);
        if (!free) continue;
        checked++;
        expect(Math.hypot(back[0] - at[0], back[1] - at[1])).toBeLessThan(1e-6);
      }
    }
    expect(checked).toBeGreaterThan(200);
    // a pan moves the scene with the finger
    const c = { x: 400, y: 300, k: 2 };
    const moved = panCam(c, 30, -12, INLINE);
    const s = pxPerUnit(c, INLINE);
    expect(near(moved.x, 400 - 30 / s)).toBe(true);
    expect(near(moved.y, 300 + 12 / s)).toBe(true);
  });

  it('the pinch: zoom by the spread about the midpoint, and pan with the midpoint', () => {
    const r = rng(5);
    const vp = INLINE_DESK;
    const lim = limitsFor('explore', vp);
    let checked = 0;
    for (let i = 0; i < 300; i++) {
      const c0: Cam = clampCam({ x: r.range(330, 470), y: r.range(260, 340), k: r.range(1.8, 2.4) }, vp, HOME_SCENE, lim);
      const m0: Pt = [r.range(250, 350), r.range(180, 270)];
      const d0 = r.range(60, 160);
      const a0: Pt = [m0[0] - d0 / 2, m0[1]], b0: Pt = [m0[0] + d0 / 2, m0[1]];
      const f = r.range(0.9, 1.3);
      const m1: Pt = [m0[0] + r.range(-20, 20), m0[1] + r.range(-20, 20)];
      const a: Pt = [m1[0], m1[1] - (d0 * f) / 2], b: Pt = [m1[0], m1[1] + (d0 * f) / 2]; // turned 90°: only the spread counts
      const c1 = pinchCam(c0, a0, b0, a, b, vp, HOME_SCENE, lim);
      expect(near(c1.k, c0.k * f, 1e-9)).toBe(true);
      const p = toScene(c0, m0, vp);
      const q = toScreen(c1, p, vp);
      const v = viewRect(c1, vp);
      if (!(v[0] > 1e-6 && v[1] > 1e-6 && v[2] < W - 1e-6 && v[3] < H - 1e-6)) continue;
      checked++;
      expect(Math.hypot(q[0] - m1[0], q[1] - m1[1])).toBeLessThan(1e-6);
    }
    expect(checked).toBeGreaterThan(150);
  });

  it("the presets are today's zooms: camForBox(focusBox) and camForBox(siteBox) equal geo.tsx zoomOf in the inline 4:3 map", () => {
    const boxes: Box[] = [];
    for (const role of ROLES) for (let tier = 1; tier <= 5; tier++) boxes.push(focusBox(role, tier));
    const open = (id: string, tier: number | undefined, done: number, need: number, cottage?: string): Build => ({ id, what: id, ...(tier !== undefined ? { tier } : {}), ...(cottage ? { cottage } : {}), done, drawn: Math.ceil(done), need, started: 1 });
    for (const d of BUILDS) for (let k = 0; k < d.units.length * 2; k++) for (const tier of [d.tier! - 1, Math.max(1, d.tier! - 2)]) boxes.push(siteBox({ tier, builds: [open(d.id, d.tier, k / 2, d.units.length)] })!);
    for (const p of COTTAGE_PLOTS) for (let k = 0; k < COTTAGE.units.length; k++) boxes.push(siteBox({ tier: 3, builds: [open(`cottage-${p.id}`, undefined, k, COTTAGE.units.length, p.id)] })!);
    expect(boxes.every(Boolean)).toBe(true);
    expect(boxes.length).toBeGreaterThan(60);
    for (const b of boxes) {
      for (const vp of [HOME_SCENE, INLINE, INLINE_DESK]) expect(camTransform(camForBox(b, vp)), JSON.stringify(b)).toBe(zoomOf(b));
    }
    // and the whole island is today's no zoom
    expect(camTransform(camForBox(null, INLINE))).toBe(zoomOf(null));
  });

  it('contain-fit: k = 1 shows the whole scene, a portrait Explore letterboxes it, and a preset box is contained', () => {
    const all = allCam(EXPLORE_PHONE);
    const v = viewRect(all, EXPLORE_PHONE);
    expect(near(v[0], 0) && near(v[2], W)).toBe(true);
    expect(v[1]).toBeLessThan(0);
    expect(v[3]).toBeGreaterThan(H);
    expect(near(base(EXPLORE_PHONE), EXPLORE_PHONE.w / W)).toBe(true);
    for (const vp of [EXPLORE_PHONE, EXPLORE_DESK, INLINE]) {
      const lim = limitsFor('explore', vp);
      for (const role of ROLES)
        for (let tier = 1; tier <= 5; tier++) {
          const b = focusBox(role, tier);
          const c = camForBox(b, vp, HOME_SCENE, lim);
          const cv = viewRect(c, vp);
          // contained, unless the view had to stay on the scene (then it still shows the box's middle)
          const mid: Pt = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
          expect(cv[2] - cv[0]).toBeGreaterThanOrEqual(Math.min(b[2] - b[0], W) - 1e-6);
          expect(cv[3] - cv[1]).toBeGreaterThanOrEqual(Math.min(b[3] - b[1], H) - 1e-6);
          expect(mid[0] >= cv[0] && mid[0] <= cv[2] && mid[1] >= cv[1] && mid[1] <= cv[3]).toBe(true);
          expect(c.k).toBeLessThanOrEqual(K_MAX + 1e-9);
        }
    }
  });

  it('the stage transform maps a drawing made for one camera onto another (screen_to = t + r * screen_from)', () => {
    const r = rng(3);
    for (let i = 0; i < 200; i++) {
      const vp = i % 2 ? INLINE : EXPLORE_PHONE;
      const a = clampCam({ x: r.range(0, W), y: r.range(0, H), k: r.range(1, 3.2) }, vp);
      const b = clampCam({ x: r.range(0, W), y: r.range(0, H), k: r.range(1, 3.2) }, vp);
      const { tx, ty, r: k } = relTransform(a, b, vp);
      const p: Pt = [r.range(0, W), r.range(0, H)];
      const s0 = toScreen(a, p, vp), s1 = toScreen(b, p, vp);
      expect(Math.hypot(tx + k * s0[0] - s1[0], ty + k * s0[1] - s1[1])).toBeLessThan(1e-6);
    }
  });

  it('the raster region: the whole scene on a phone card at every zoom; else the view plus a margin, within the budget', () => {
    for (const k of [1, 1.5, 2.26, 3.2]) {
      const f = frameOf(clampCam({ x: 400, y: 300, k }, INLINE), INLINE, HOME_SCENE, 2);
      expect(f.region).toEqual([0, 0, W, H]);
    }
    const r = rng(9);
    for (let i = 0; i < 300; i++) {
      const vp = [INLINE, INLINE_DESK, EXPLORE_PHONE, EXPLORE_DESK][i % 4];
      const dpr = i % 3 === 0 ? 1 : 2;
      const lim = limitsFor(i % 4 >= 2 ? 'explore' : 'inline', vp);
      const c = clampCam({ x: r.range(0, W), y: r.range(0, H), k: r.range(1, lim.kMax) }, vp, HOME_SCENE, lim);
      const f = frameOf(c, vp, HOME_SCENE, dpr);
      const o = SEA_OVERHANG;
      expect(f.region[0]).toBeGreaterThanOrEqual(-o);
      expect(f.region[1]).toBeGreaterThanOrEqual(-o);
      expect(f.region[2]).toBeLessThanOrEqual(W + o);
      expect(f.region[3]).toBeLessThanOrEqual(H + o);
      // it covers everything on screen that the scene has
      const v = f.view;
      expect(f.region[0]).toBeLessThanOrEqual(Math.max(0, v[0]) + 1e-6);
      expect(f.region[1]).toBeLessThanOrEqual(Math.max(0, v[1]) + 1e-6);
      expect(f.region[2]).toBeGreaterThanOrEqual(Math.min(W, v[2]) - 1e-6);
      expect(f.region[3]).toBeGreaterThanOrEqual(Math.min(H, v[3]) - 1e-6);
      // within the budget (1 px of rounding a side), unless the view alone is bigger
      const px = (f.region[2] - f.region[0]) * (f.region[3] - f.region[1]) * f.S * f.S * dpr * dpr;
      const cap = Math.max(RASTER_BUDGET, 2.5 * vp.w * vp.h * dpr * dpr);
      const onScreen = (Math.min(W, v[2]) - Math.max(0, v[0]) + 2) * (Math.min(H, v[3]) - Math.max(0, v[1]) + 2) * f.S * f.S * dpr * dpr;
      expect(px).toBeLessThanOrEqual(Math.max(cap, onScreen) * 1.02 + (2 * (f.region[2] - f.region[0] + f.region[3] - f.region[1]) + 4) * f.S * f.S * dpr * dpr);
    }
  });

  it('a flight draws the ground all the way: forward when the drawing covers the new view, flip when the new one covers the old, else via the whole island', () => {
    // the phone card: the whole scene is always drawn, so every flight is forward
    expect(planFlight(allCam(INLINE), camForBox(focusBox('elec', 3), INLINE), INLINE, HOME_SCENE, 2)).toBe('forward');
    expect(planFlight(camForBox(focusBox('elec', 3), INLINE), allCam(INLINE), INLINE, HOME_SCENE, 2)).toBe('forward');
    // Explore on a phone, close up: zoom out is a flip, a jump across the island goes via the whole island
    const lim = limitsFor('explore', EXPLORE_PHONE);
    const west = clampCam({ x: 120, y: 300, k: 4 }, EXPLORE_PHONE, HOME_SCENE, lim);
    const east = clampCam({ x: 700, y: 300, k: 4 }, EXPLORE_PHONE, HOME_SCENE, lim);
    expect(planFlight(west, allCam(EXPLORE_PHONE, HOME_SCENE, lim), EXPLORE_PHONE, HOME_SCENE, 2)).toBe('flip');
    expect(planFlight(allCam(EXPLORE_PHONE, HOME_SCENE, lim), west, EXPLORE_PHONE, HOME_SCENE, 2)).toBe('forward');
    expect(planFlight(west, east, EXPLORE_PHONE, HOME_SCENE, 2)).toBe('via');
  });

  it('touch-action: inline, one finger always scrolls the page (pan-y), at every zoom; Explore takes every gesture', () => {
    // the surface's style comes from the mode alone (MapView), never from the camera: pan-y at k = 1 and at k = 3.2
    for (const k of [1, 3.2]) expect([k, touchActionFor('inline')]).toEqual([k, 'pan-y']);
    expect(touchActionFor('explore')).toBe('none');
  });
});

// ---------------------------------------------------------------- the classifier
const P = (id: number, x: number, y: number, t: number, kind: PIn['kind'] = 'touch'): PIn => ({ id, kind, x, y, t });
const kinds = (o: GOut[]) => o.map((x) => x.t);
function run(c: Classifier, steps: [('down' | 'move' | 'up' | 'cancel'), PIn][]) {
  const out: GOut[] = [];
  for (const [f, p] of steps) out.push(...c[f](p));
  return out;
}

describe('taps vs drags vs pinches', () => {
  const inline = () => new Classifier(() => 'inline');
  const explore = () => new Classifier(() => 'explore');

  it('a tap: up within 500 ms, moved no more than 8 px (a mouse: 4 px)', () => {
    let o = run(inline(), [['down', P(1, 100, 100, 0)], ['move', P(1, 106, 104, 50)], ['up', P(1, 107, 104, 400)]]);
    expect(o.find((x) => x.t === 'tap')).toMatchObject({ t: 'tap', at: [100, 100], double: false });
    expect(o.at(-1)).toMatchObject({ t: 'end', moved: false, swallow: true });
    // too long: a press, not a tap
    o = run(inline(), [['down', P(1, 100, 100, 0)], ['up', P(1, 100, 100, TAP.maxMs + 1)]]);
    expect(kinds(o)).not.toContain('tap');
    // 9 px: a drag
    o = run(inline(), [['down', P(1, 100, 100, 0)], ['move', P(1, 109, 100, 50)], ['up', P(1, 109, 100, 100)]]);
    expect(kinds(o)).not.toContain('tap');
    // (review round 1) a touch drag sends no click: nothing to swallow (it used to eat the next real tap)
    expect(o.at(-1)).toMatchObject({ t: 'end', swallow: false });
    // a mouse drags from 5 px, and taps up to 4
    o = run(inline(), [['down', P(1, 100, 100, 0, 'mouse')], ['move', P(1, 105, 100, 50, 'mouse')], ['up', P(1, 105, 100, 100, 'mouse')]]);
    expect(kinds(o)).not.toContain('tap');
    o = run(inline(), [['down', P(1, 100, 100, 0, 'mouse')], ['move', P(1, 104, 100, 50, 'mouse')], ['up', P(1, 104, 100, 100, 'mouse')]]);
    expect(kinds(o)).toContain('tap');
  });

  it('inline, a one-finger touch drag never pans (the page scrolls); in Explore, and with a mouse, it pans', () => {
    const drag = (c: Classifier, kind: PIn['kind'] = 'touch') => run(c, [['down', P(1, 100, 100, 0, kind)], ['move', P(1, 100, 140, 30, kind)], ['move', P(1, 60, 180, 60, kind)], ['up', P(1, 60, 180, 90, kind)]]);
    let o = drag(inline());
    expect(o.filter((x) => x.t === 'live')).toEqual([]);
    expect(o.at(-1)).toMatchObject({ t: 'end', moved: false, swallow: false });
    o = drag(explore());
    const lives = o.filter((x): x is Extract<GOut, { t: 'live' }> => x.t === 'live');
    expect(lives.length).toBeGreaterThan(0);
    expect(lives.at(-1)!.live).toEqual({ kind: 'pan', from: [100, 100], to: [60, 180] });
    expect(o.at(-1)).toMatchObject({ t: 'end', moved: true });
    o = drag(inline(), 'mouse');
    expect(o.some((x) => x.t === 'live')).toBe(true);
  });

  it('two pointers are a pinch (inline too), and the finger left over pans on', () => {
    const c = inline();
    const o = run(c, [
      ['down', P(1, 100, 100, 0)],
      ['down', P(2, 200, 100, 20)],
      ['move', P(2, 260, 100, 40)],
      ['up', P(1, 100, 100, 60)],
      ['move', P(2, 280, 120, 80)],
      ['up', P(2, 280, 120, 100)],
    ]);
    expect(kinds(o)).toEqual(['begin', 'base', 'live', 'live', 'base', 'live', 'live', 'end']);
    const lives = o.filter((x): x is Extract<GOut, { t: 'live' }> => x.t === 'live');
    expect(lives[0].live).toEqual({ kind: 'pinch', a0: [100, 100], b0: [200, 100], a: [100, 100], b: [260, 100] });
    expect(lives[2].live).toEqual({ kind: 'pan', from: [260, 100], to: [280, 120] });
    // (a pinch sends no click: nothing swallowed, review round 1)
    expect(o.at(-1)).toMatchObject({ t: 'end', moved: true, swallow: false });
    expect(kinds(o)).not.toContain('tap');
  });

  it('a double tap: the second within 300 ms and 24 px of the first; forgetTap drops it', () => {
    const c = inline();
    let o = run(c, [['down', P(1, 100, 100, 0)], ['up', P(1, 100, 100, 60)], ['down', P(1, 110, 108, 60 + TAP.dblMs)], ['up', P(1, 110, 108, 60 + TAP.dblMs + 50)]]);
    expect(o.filter((x) => x.t === 'tap').map((x) => (x as { double: boolean }).double)).toEqual([false, true]);
    // too slow, or too far
    o = run(inline(), [['down', P(1, 100, 100, 0)], ['up', P(1, 100, 100, 60)], ['down', P(1, 100, 100, 61 + TAP.dblMs)], ['up', P(1, 100, 100, 400)]]);
    expect(o.filter((x) => x.t === 'tap').map((x) => (x as { double: boolean }).double)).toEqual([false, false]);
    o = run(inline(), [['down', P(1, 100, 100, 0)], ['up', P(1, 100, 100, 60)], ['down', P(1, 125, 100, 100)], ['up', P(1, 125, 100, 150)]]);
    expect(o.filter((x) => x.t === 'tap').map((x) => (x as { double: boolean }).double)).toEqual([false, false]);
    // the first tap's single action ran: the next tap is a new one
    const d = inline();
    run(d, [['down', P(1, 100, 100, 0)], ['up', P(1, 100, 100, 60)]]);
    d.forgetTap();
    o = run(d, [['down', P(1, 100, 100, 200)], ['up', P(1, 100, 100, 250)]]);
    expect(o.find((x) => x.t === 'tap')).toMatchObject({ double: false });
    // a mouse double-click is a double tap too
    o = run(inline(), [['down', P(1, 50, 50, 0, 'mouse')], ['up', P(1, 50, 50, 40, 'mouse')], ['down', P(1, 51, 50, 120, 'mouse')], ['up', P(1, 51, 50, 160, 'mouse')]]);
    expect(o.filter((x) => x.t === 'tap').map((x) => (x as { double: boolean }).double)).toEqual([false, true]);
  });

  it('the browser taking the pointer (the page scrolled) ends the gesture with no tap', () => {
    const o = run(inline(), [['down', P(1, 100, 100, 0)], ['move', P(1, 100, 130, 20)], ['cancel', P(1, 100, 130, 30)]]);
    expect(kinds(o)).toEqual(['begin', 'end']);
    expect(o.at(-1)).toMatchObject({ moved: false, swallow: false });
  });
});

// ---------------------------------------------------------------- the controller
function harness(mode: 'inline' | 'explore' = 'inline', vp: Size = INLINE, reduce = false) {
  let frames: (() => void)[] = [];
  let timers: { f: () => void; at: number; id: number }[] = [];
  let now = 0;
  let id = 0;
  const stage = { style: { transform: '', transition: '' }, getBoundingClientRect: () => ({}) };
  const classes = new Set<string>();
  const surface = { classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) } };
  const log = { commits: [] as Cam[], taps: [] as { at: Pt; double: boolean }[], writes: [] as string[] };
  const deps: MapDeps = {
    vp: () => vp,
    sc: HOME_SCENE,
    lim: () => limitsFor(mode, vp),
    mode: () => mode,
    dpr: () => 2,
    reduce: () => reduce,
    stage: () => stage,
    surface: () => surface,
    commit: (c) => log.commits.push(c),
    tap: (at, double) => log.taps.push({ at, double }),
    raf: (f) => (frames.push(f), ++id),
    caf: () => (frames = []),
    later: (f, ms) => (timers.push({ f, at: now + ms, id: ++id }), id),
    cancelLater: (i) => (timers = timers.filter((t) => t.id !== i)),
  };
  const ctl = new MapController(deps, allCam(vp));
  const origWrite = stage.style;
  const flush = () => {
    const fs = frames;
    frames = [];
    fs.forEach((f) => f());
    log.writes.push(origWrite.transform);
  };
  const tick = (ms: number) => {
    now += ms;
    const due = timers.filter((t) => t.at <= now);
    timers = timers.filter((t) => t.at > now);
    due.forEach((t) => t.f());
  };
  return { ctl, stage, classes, log, flush, tick };
}

describe('the controller: transform-only gestures, one commit at the end', () => {
  it('a scripted pinch renders nothing until pointer-up, then once', () => {
    const h = harness();
    const { ctl, log } = h;
    ctl.down(P(1, 150, 130, 0));
    ctl.down(P(2, 210, 130, 10));
    for (let i = 1; i <= 30; i++) {
      ctl.move(P(1, 150 - i * 2, 130, 10 + i * 16));
      ctl.move(P(2, 210 + i * 2, 130, 10 + i * 16));
      h.flush();
      expect(log.commits.length).toBe(0);
    }
    // every frame moved the drawing as a picture, and the ambient motion held still
    expect(h.stage.style.transform).toMatch(/^translate3d\(.+\) scale\(3\)$/);
    expect(h.classes.has('gesturing')).toBe(true);
    ctl.up(P(1, 90, 130, 600));
    expect(log.commits.length).toBe(0);
    ctl.up(P(2, 270, 130, 610));
    expect(log.commits.length).toBe(1);
    // the fingers spread from 60 to 180 px: three times closer
    expect(log.commits[0].k).toBeCloseTo(3, 6);
    // the view drew it: the stage is back to identity and the motion resumes
    ctl.afterCommit();
    expect(h.stage.style.transform).toBe('');
    expect(h.classes.has('gesturing')).toBe(false);
    expect(ctl.commits).toBe(1);
  });

  it('a tap reaches the view and commits nothing; a drag that pans commits once', () => {
    const h = harness('explore', EXPLORE_PHONE);
    h.ctl.down(P(1, 100, 100, 0));
    h.ctl.up(P(1, 102, 101, 80));
    expect(h.log.taps).toEqual([{ at: [100, 100], double: false }]);
    expect(h.log.commits.length).toBe(0);
    h.ctl.go(camForBox(focusBox('mech', 2), EXPLORE_PHONE, HOME_SCENE, limitsFor('explore', EXPLORE_PHONE)), false);
    h.ctl.afterCommit();
    const before = h.log.commits.length;
    h.ctl.down(P(1, 200, 300, 1000));
    for (let i = 1; i <= 10; i++) {
      h.ctl.move(P(1, 200 - i * 10, 300, 1000 + i * 16));
      h.flush();
    }
    expect(h.log.commits.length).toBe(before);
    h.ctl.up(P(1, 100, 300, 1200));
    expect(h.log.commits.length).toBe(before + 1);
  });

  it('the wheel zooms about the cursor and commits once, 180 ms after the last step', () => {
    const h = harness('inline', INLINE_DESK);
    for (let i = 0; i < 5; i++) {
      h.ctl.wheel([450, 225], -100, false);
      h.flush();
      h.tick(40);
    }
    expect(h.log.commits.length).toBe(0);
    h.tick(200);
    expect(h.log.commits.length).toBe(1);
    const c = h.log.commits[0];
    expect(c.k).toBeGreaterThan(1.5);
    // the point under the cursor stayed under it
    const p0 = toScene(allCam(INLINE_DESK), [450, 225], INLINE_DESK);
    const q = toScreen(c, p0, INLINE_DESK);
    expect(Math.hypot(q[0] - 450, q[1] - 225)).toBeLessThan(1e-6);
  });

  it('a preset flies (forward: the old drawing flies, then one commit), and reduced motion jumps', () => {
    const h = harness();
    const to = camForBox(focusBox('elec', 3), INLINE);
    h.ctl.go(to);
    expect(h.stage.style.transition).toMatch(/transform 450ms/);
    expect(h.stage.style.transform).toMatch(/translate3d/);
    expect(h.log.commits.length).toBe(0);
    h.tick(500);
    expect(h.log.commits).toEqual([to]);
    h.ctl.afterCommit();
    expect(h.stage.style.transform).toBe('');
    expect(h.stage.style.transition).toBe('none');
    const r = harness('inline', INLINE, true);
    r.ctl.go(to);
    expect(r.log.commits).toEqual([to]);
    expect(r.stage.style.transition).not.toMatch(/450ms/);
  });

  it('a flip draws the new camera first and flies in from the old view; a via flight draws the whole island, flies, then draws the end', () => {
    const lim = limitsFor('explore', EXPLORE_PHONE);
    const west = clampCam({ x: 120, y: 300, k: 4 }, EXPLORE_PHONE, HOME_SCENE, lim);
    const east = clampCam({ x: 700, y: 300, k: 4 }, EXPLORE_PHONE, HOME_SCENE, lim);
    const h = harness('explore', EXPLORE_PHONE);
    h.ctl.go(west, false);
    h.ctl.afterCommit();
    h.ctl.go(allCam(EXPLORE_PHONE, HOME_SCENE, lim));
    expect(h.log.commits.at(-1)!.k).toBe(1); // flip: the new camera is drawn at once
    h.ctl.afterCommit();
    expect(h.stage.style.transition).toMatch(/450ms/);
    expect(h.stage.style.transform).toBe(''); // flying to identity, from the old view
    h.tick(500);
    h.ctl.go(west, false);
    h.ctl.afterCommit();
    const n = h.log.commits.length;
    h.ctl.go(east);
    expect(h.log.commits.length).toBe(n + 1);
    expect(h.log.commits.at(-1)!.k).toBe(1); // via: the whole island first
    h.ctl.afterCommit();
    expect(h.stage.style.transform).toMatch(/translate3d/);
    h.tick(500);
    expect(h.log.commits.at(-1)).toEqual(east);
  });
});
