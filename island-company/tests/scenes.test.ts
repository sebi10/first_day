// The scenes and the map in a DOM (docs/EXPANSION.md 5.6, 5.7, 13.2): the
// beaten scenes render under the 1,500-node budget with the camera and the
// hotspots in (they add no SVG nodes: the controls are HTML, the hit-test is
// JS), Explore mounts no second scene, and a scripted pinch through the real
// map renders nothing until the fingers lift, then once.
//
// Preact renders into a small DOM made here (enough of one for Preact and the
// map: nodes, attributes, style, classList, events that bubble).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MODELS, TIERS } from '../src/sim/data';
import { gseCarts } from '../src/sim/econ';
import { apply, createIsland } from '../src/sim/engine';
import type { IslandState, WeekReport } from '../src/sim/types';
import { LAYOUTS } from '../src/ui/map/layouts';
import { POS } from '../src/ui/island/geo';

vi.setConfig({ testTimeout: 30000 });

// ---------------------------------------------------------------- a small DOM
type Listener = { f: (e: Ev) => void; capture: boolean };
type Ev = { type: string; target: El; currentTarget: El | null; stopped: boolean; defaultPrevented: boolean; stopPropagation(): void; preventDefault(): void; [k: string]: unknown };
class Nd {
  nodeType = 1;
  parentNode: El | null = null;
  childNodes: Nd[] = [];
  get firstChild() {
    return this.childNodes[0] ?? null;
  }
  get nextSibling(): Nd | null {
    const p = this.parentNode;
    if (!p) return null;
    return p.childNodes[p.childNodes.indexOf(this) + 1] ?? null;
  }
  get parentElement() {
    return this.parentNode;
  }
  insertBefore<T extends Nd>(n: T, ref: Nd | null): T {
    n.parentNode?.removeChild(n);
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(n);
    else this.childNodes.splice(i, 0, n);
    n.parentNode = this as unknown as El;
    return n;
  }
  appendChild<T extends Nd>(n: T): T {
    return this.insertBefore(n, null);
  }
  append(...ns: Nd[]) {
    for (const n of ns) this.appendChild(n);
  }
  removeChild<T extends Nd>(n: T): T {
    const i = this.childNodes.indexOf(n);
    if (i >= 0) this.childNodes.splice(i, 1);
    n.parentNode = null;
    return n;
  }
  remove() {
    this.parentNode?.removeChild(this);
  }
  contains(n: Nd | null): boolean {
    for (let e: Nd | null = n; e; e = e.parentNode) if (e === this) return true;
    return false;
  }
}
class Tx extends Nd {
  nodeType = 3;
  constructor(public data: string) {
    super();
  }
  get textContent() {
    return this.data;
  }
}
const EVENT_PROPS = ['onclick', 'onpointerdown', 'onpointermove', 'onpointerup', 'onpointercancel', 'onkeydown', 'onwheel', 'ontouchstart', 'ontouchmove', 'onfocus', 'onblur', 'oninput', 'onchange'];
class El extends Nd {
  attrs = new Map<string, string>();
  listeners = new Map<string, Listener[]>();
  style: Record<string, string> & { setProperty(k: string, v: string): void; cssText: string } = Object.assign(Object.create(null), {
    cssText: '',
    setProperty(this: Record<string, string>, k: string, v: string) {
      this[k] = v;
    },
  });
  constructor(
    public localName: string,
    public namespaceURI: string,
  ) {
    super();
  }
  get tagName() {
    return this.localName.toUpperCase();
  }
  get attributes() {
    return [...this.attrs].map(([name, value]) => ({ name, value }));
  }
  setAttribute(k: string, v: unknown) {
    this.attrs.set(k, String(v));
  }
  getAttribute(k: string) {
    return this.attrs.get(k) ?? null;
  }
  removeAttribute(k: string) {
    this.attrs.delete(k);
  }
  hasAttribute(k: string) {
    return this.attrs.has(k);
  }
  get className() {
    return this.attrs.get('class') ?? '';
  }
  set className(v: string) {
    this.attrs.set('class', v);
  }
  get classList() {
    const get = () => new Set(this.className.split(/\s+/).filter(Boolean));
    const put = (s: Set<string>) => this.setAttribute('class', [...s].join(' '));
    return {
      contains: (c: string) => get().has(c),
      add: (...cs: string[]) => put(new Set([...get(), ...cs])),
      remove: (...cs: string[]) => {
        const s = get();
        cs.forEach((c) => s.delete(c));
        put(s);
      },
      toggle: (c: string, on?: boolean) => {
        const s = get();
        if (on ?? !s.has(c)) s.add(c);
        else s.delete(c);
        put(s);
      },
    };
  }
  get textContent(): string {
    return this.childNodes.map((c) => (c instanceof Tx ? c.data : (c as El).textContent)).join('');
  }
  /** every element below (depth first) */
  all(): El[] {
    const out: El[] = [];
    const walk = (e: El) => {
      for (const c of e.childNodes) if (c instanceof El) (out.push(c), walk(c));
    };
    walk(this);
    return out;
  }
  /** the simple selectors the app and these tests use: `.a.b`, `tag`, `tag.a`, `[attr="v"]` combined */
  matches(sel: string): boolean {
    return sel.split(',').some((one) => {
      const m = /^([a-z]*)((?:\.[\w-]+)*)((?:\[[\w-]+(?:="[^"]*")?\])*)$/.exec(one.trim());
      if (!m) return false;
      if (m[1] && m[1] !== this.localName) return false;
      const cls = m[2].split('.').filter(Boolean);
      if (!cls.every((c) => this.classList.contains(c))) return false;
      for (const a of m[3].match(/\[[^\]]+\]/g) ?? []) {
        const [, k, v] = /\[([\w-]+)(?:="([^"]*)")?\]/.exec(a)!;
        if (v === undefined ? !this.attrs.has(k) : this.attrs.get(k) !== v) return false;
      }
      return true;
    });
  }
  closest(sel: string): El | null {
    for (let e: El | null = this; e; e = e.parentNode) if (e.matches?.(sel)) return e;
    return null;
  }
  querySelectorAll(sel: string) {
    return this.all().filter((e) => e.matches(sel));
  }
  querySelector(sel: string) {
    return this.querySelectorAll(sel)[0] ?? null;
  }
  addEventListener(t: string, f: (e: Ev) => void, o?: boolean | { capture?: boolean }) {
    const capture = typeof o === 'boolean' ? o : !!o?.capture;
    (this.listeners.get(t) ?? this.listeners.set(t, []).get(t)!).push({ f, capture });
  }
  removeEventListener(t: string, f: (e: Ev) => void, o?: boolean | { capture?: boolean }) {
    const capture = typeof o === 'boolean' ? o : !!o?.capture;
    this.listeners.set(
      t,
      (this.listeners.get(t) ?? []).filter((l) => l.f !== f || l.capture !== capture),
    );
  }
  /** capture from the root, then bubble back up */
  dispatch(type: string, init: Record<string, unknown> = {}): Ev {
    const ev: Ev = {
      type,
      target: this,
      currentTarget: null,
      stopped: false,
      defaultPrevented: false,
      stopPropagation() {
        ev.stopped = true;
      },
      preventDefault() {
        ev.defaultPrevented = true;
      },
      timeStamp: performance.now(),
      ...init,
    };
    const path: El[] = [];
    for (let e: El | null = this; e; e = e.parentNode) path.push(e);
    const fire = (e: El, capture: boolean) => {
      ev.currentTarget = e;
      for (const l of [...(e.listeners.get(type) ?? [])]) if (l.capture === capture || e === this) l.f.call(e, ev);
    };
    for (const e of [...path].reverse()) {
      if (ev.stopped) break;
      if (e !== this) fire(e, true);
    }
    if (!ev.stopped) fire(this, false);
    for (const e of path.slice(1)) {
      if (ev.stopped) break;
      fire(e, false);
    }
    return ev;
  }
  click() {
    return this.dispatch('click');
  }
  get clientWidth() {
    return this.classList.contains('map-vp') ? 358 : 0;
  }
  get clientHeight() {
    return this.classList.contains('map-vp') ? 268.5 : 0;
  }
  get offsetHeight() {
    return this.classList.contains('map-slot') ? 320 : 0;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, x: 0, y: 0, width: this.clientWidth, height: this.clientHeight, right: this.clientWidth, bottom: this.clientHeight };
  }
  focus() {
    doc.activeElement = this;
  }
  blur() {}
  setPointerCapture() {}
  releasePointerCapture() {}
  pauseAnimations() {}
  unpauseAnimations() {}
}
for (const p of EVENT_PROPS) Object.defineProperty(El.prototype, p, { value: null, writable: true });

const HTML = 'http://www.w3.org/1999/xhtml';
const docEl = new El('html', HTML);
const body = docEl.appendChild(new El('body', HTML));
const doc = {
  documentElement: docEl,
  body,
  activeElement: null as El | null,
  hidden: false,
  createElement: (t: string) => new El(t, HTML),
  createElementNS: (ns: string, t: string) => new El(t, ns),
  createTextNode: (t: string) => new Tx(String(t)),
  querySelectorAll: (s: string) => docEl.querySelectorAll(s),
  querySelector: (s: string) => docEl.querySelector(s),
  addEventListener: () => {},
  removeEventListener: () => {},
};
const win = new El('window', HTML);
let frames: (() => void)[] = [];
const flushFrames = () => {
  const fs = frames;
  frames = [];
  fs.forEach((f) => f());
};

// ---------------------------------------------------------------- the scenes (as src/islandlab.tsx builds them)
const NOW = Date.UTC(2026, 8, 26, 10);
function build(tier: number, weather: IslandState['weather'] = 'clear') {
  let s = createIsland({ id: 'lab', name: 'Frigate Bay', now: NOW, tz: 'Europe/Paris', seed: 7, creator: { uid: 'a', name: 'Seb', role: 'mech' } });
  s = apply(s, { t: 'join', uid: 'b', name: 'Mia', role: 'elec' }, NOW).s;
  s = apply(s, { t: 'join', uid: 'c', name: 'Ravi', role: 'fin' }, NOW).s;
  for (let t = 2; t <= tier; t++)
    for (const a of TIERS[t - 1].adds) {
      const kind = MODELS[a.model].kind;
      s.assets.push({ id: a.id, kind, model: a.model, name: a.name, health: 82, touchedWeek: 0, ...(kind === 'house' ? { inspectionUntil: 8 } : {}), ...(kind === 'plane' ? { sinceInspection: 4 } : {}) });
    }
  s.tier = tier;
  s.weather = weather;
  for (const a of s.assets) a.health = Math.max(a.health, 80);
  return s;
}
/** the beaten island (islandlab `beaten`, and `beaten-storm-night` with a storm and both carts out) */
function beaten(storm = false) {
  const s = build(5, storm ? 'storm' : 'clear');
  const weeks = 30;
  s.week = weeks + 1;
  s.stats.totalWeeks = weeks;
  s.stats.weeksBPlus = 26;
  s.stats.perfectWeeks = 6;
  for (const a of s.assets) if (a.kind === 'house') a.inspectionUntil = s.week + 6;
  s.history = [0, 1, 2].map((i) => ({ week: weeks - 2 + i, tier: 5, grade: 'A', revenue: Math.round(22000 * 1.1), budget: 22000 }) as unknown as WeekReport);
  for (let t = 2; t <= 5; t++) s.stats.tierReachedWeek[t] = [0, 0, 6, 10, 16, 21][t];
  s.stats.aStreak = 8;
  s.creditsWeek = s.week - 1;
  if (storm) s.gse = gseCarts(s).map((c, i) => (i === 0 ? { ...c, hookedTo: 'p2', charging: false, charge: 70 } : { ...c, charging: true, charge: 20 }));
  return s;
}

let preact: typeof import('preact');
let act: (typeof import('preact/test-utils'))['act'];
let Island: (typeof import('../src/ui/island'))['Island'];
let MapView: (typeof import('../src/ui/map/MapView'))['MapView'];
let cam: typeof import('../src/ui/map/camera');

beforeAll(async () => {
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', win);
  vi.stubGlobal('requestAnimationFrame', (f: () => void) => (frames.push(f), frames.length));
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal('devicePixelRatio', 2);
  Object.assign(win, { setTimeout, clearTimeout, setInterval, clearInterval });
  preact = await import('preact');
  act = (await import('preact/test-utils')).act;
  Island = (await import('../src/ui/island')).Island;
  MapView = (await import('../src/ui/map/MapView')).MapView;
  cam = await import('../src/ui/map/camera');
});
afterAll(() => vi.unstubAllGlobals());

/** every SVG element under a root (the node budget counts `svg *`) */
const svgNodes = (root: El) => root.querySelectorAll('svg').reduce((n, svg) => n + svg.all().length, 0);
function mount(vnode: unknown) {
  const host = body.appendChild(new El('div', HTML));
  act(() => preact.render(vnode as preact.VNode, host as unknown as Element));
  return {
    host,
    unmount: () => {
      act(() => preact.render(null, host as unknown as Element));
      host.remove();
    },
  };
}

describe('the scenes, rendered', () => {
  it('the beaten scenes stay within 1,500 SVG nodes, with the camera and the hotspots in', () => {
    for (const storm of [false, true]) {
      const s = beaten(storm);
      const plain = mount(preact.h(Island, { s, phase: 'night', reduceMotion: false, onCart: () => {} }));
      const n = svgNodes(plain.host);
      plain.unmount();
      expect(n, storm ? 'beaten-storm-night' : 'beaten').toBeLessThanOrEqual(1500);
      expect(n).toBeGreaterThan(900);
      // under the map's camera, zoomed in or not: the same drawing (the weather is one group more)
      for (const k of [1, 3.2]) {
        const c = cam.clampCam({ x: 420, y: 330, k }, { w: 358, h: 268.5 });
        const frame = cam.frameOf(c, { w: 358, h: 268.5 }, cam.HOME_SCENE, 2);
        const m = mount(preact.h(Island, { s, frame, phase: 'night', reduceMotion: false, onCart: () => {} }));
        const nm = svgNodes(m.host);
        m.unmount();
        expect(nm).toBeLessThanOrEqual(n + (storm ? 1 : 0));
        expect(nm).toBeLessThanOrEqual(1500);
      }
      // the whole map: its controls and chips are HTML, so no more SVG than the island's own
      const map = mount(preact.h(MapView, { s, role: 'mech', phase: 'night', reduceMotion: false, onObject: () => {}, onCart: () => {} }));
      act(() => {});
      expect(map.host.querySelectorAll('svg').length).toBe(1);
      expect(svgNodes(map.host)).toBeLessThanOrEqual(n + (storm ? 1 : 0));
      map.unmount();
    }
  });

  it('Explore lifts the same map over the page: one scene in the DOM, before, during and after', () => {
    const s = beaten();
    const opened: string[] = [];
    const m = mount(preact.h(MapView, { s, role: 'elec', phase: 'day', reduceMotion: true, onObject: (r: { id: string }) => opened.push(r.id), onCart: () => {} }));
    act(() => {});
    const scenes = () => docEl.querySelectorAll('svg.island-svg');
    expect(scenes().length).toBe(1);
    const first = scenes()[0];
    const btn = docEl.querySelector('button[aria-label="Explore full screen"]')!;
    act(() => void btn.click());
    act(() => {});
    expect(scenes().length).toBe(1);
    // the same drawing (not a second instance), now in an overlay at the page's root
    expect(scenes()[0]).toBe(first);
    const overlay = docEl.querySelector('.overlay.map-explore')!;
    expect(overlay).toBeTruthy();
    expect(overlay.contains(first)).toBe(true);
    expect(m.host.contains(first)).toBe(false);
    expect(docEl.classList.contains('map-exploring')).toBe(true);
    // the inline slot keeps its height while the map is out
    expect(m.host.querySelector('.map-slot')!.style.minHeight).toBe('320px');
    act(() => void docEl.querySelector('button[data-esc]')!.click());
    act(() => {});
    expect(scenes().length).toBe(1);
    expect(scenes()[0]).toBe(first);
    expect(m.host.contains(first)).toBe(true);
    expect(docEl.classList.contains('map-exploring')).toBe(false);
    m.unmount();
    expect(scenes().length).toBe(0);
  });

  it('a scripted pinch through the real map renders nothing until the fingers lift, then once', () => {
    const s = beaten();
    let renders = 0;
    const was = preact.options.diffed;
    preact.options.diffed = (v) => {
      if (v.type === Island) renders++;
      was?.(v);
    };
    const m = mount(preact.h(MapView, { s, role: 'mech', phase: 'day', reduceMotion: false, onObject: () => {}, onCart: () => {} }));
    act(() => {});
    const vp = m.host.querySelector('.map-vp')!;
    const stage = m.host.querySelector('.map-stage')!;
    expect(vp.style.touchAction).toBe('pan-y');
    const svg = () => m.host.querySelector('svg.island-svg')!;
    const k0 = svg().style.width;
    const before = renders;
    const pt = (id: number, x: number, y: number) => ({ pointerId: id, pointerType: 'touch', clientX: x, clientY: y, button: 0 });
    act(() => {
      svg().dispatch('pointerdown', pt(1, 150, 130));
      svg().dispatch('pointerdown', pt(2, 210, 130));
    });
    for (let i = 1; i <= 20; i++)
      act(() => {
        vp.dispatch('pointermove', pt(1, 150 - i * 2, 130));
        vp.dispatch('pointermove', pt(2, 210 + i * 2, 130));
        flushFrames();
      });
    expect(renders - before).toBe(0);
    expect(stage.style.transform).toMatch(/^translate3d\(.+\) scale\(/);
    expect(vp.classList.contains('gesturing')).toBe(true);
    // inline, the page never scrolls at any zoom: pan-y stays
    expect(vp.style.touchAction).toBe('pan-y');
    act(() => {
      vp.dispatch('pointerup', pt(1, 110, 130));
      vp.dispatch('pointerup', pt(2, 250, 130));
    });
    act(() => {});
    expect(renders - before).toBe(1);
    // drawn at the new zoom, the stage back to identity, the motion resumed
    expect(svg().style.width).not.toBe(k0);
    expect(stage.style.transform).toBe('');
    expect(vp.classList.contains('gesturing')).toBe(false);
    expect(vp.style.touchAction).toBe('pan-y');
    m.unmount();
    preact.options.diffed = was;
  });
});

describe('the scene layouts', () => {
  it("home's layout is geo.tsx's drawing", () => {
    const home = LAYOUTS.home;
    expect([home.w, home.h]).toEqual([800, 600]);
    expect(home.pos).toBe(POS);
    for (const k of ['hangar', 'office', 'fuel', 'windsock', 'dock'] as const) {
      expect(home.fixtures[k], k).toBeTruthy();
      expect(home.fixtureFoot[k], k).toBeTruthy();
    }
  });

  it('the island lab has every scene the node budget is checked on, and island-shots checks them', () => {
    const lab = readFileSync(resolve(__dirname, '../src/islandlab.tsx'), 'utf8');
    const shots = readFileSync(resolve(__dirname, '../scripts/island-shots.mjs'), 'utf8');
    const listed = /const BUDGET = \[([^\]]*)\]/.exec(shots)?.[1].match(/'([\w-]+)'/g)?.map((x) => x.slice(1, -1)) ?? [];
    expect(listed).toEqual(expect.arrayContaining(['beaten', 'beaten-storm-night']));
    for (const id of ['beaten', 'beaten-storm-night']) expect(lab).toContain(`id: '${id}'`);
  });
});
