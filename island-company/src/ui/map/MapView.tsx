// The map (docs/EXPANSION.md 5, 6.1, 9.1): the island as a free camera.
//
// - Inline (Home's top card): tap an object for its sheet; tap empty ground to
//   toggle all <-> my zone (after 250 ms, so a double tap can zoom instead);
//   two fingers pinch and pan, one finger always scrolls the page; a mouse
//   drags, Ctrl/Cmd + wheel zooms. Controls: + - (all) (Explore), preset chips.
// - Explore: the same map, full screen: one finger pans, pinch zooms, a plain
//   wheel zooms. Closing keeps where you were.
// - Keyboard: arrows pan, + - zoom, 0 all, M my zone, S the build site,
//   Enter lists the objects in view.
//
// It never re-renders while a gesture moves the map (controller.ts moves the
// drawing with a CSS transform), and commits the camera once at the end.
import { render } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { IslandState, Role } from '../../sim/types';
import { fx } from '../feedback';
import { Island, phaseOf, type IslandProbe, type Phase } from '../island';
import { focusBox, siteBox, type Pt } from '../island/geo';
import { assetRef, fixtureRef, HOME, OBJECT_LABEL, type ObjectRef } from '../objects';
import { settings } from '../settings';
import { allCam, camForBox, coverCam, frameOf, HOME_SCENE, limitsFor, nearCam, panCam, pxPerUnit, toScene, touchActionFor, viewRect, zoomAt, type Cam, type MapMode, type Size } from './camera';
import { MapController } from './controller';
import { fingersOn, TAP, type PointerKind } from './gestures';
import { bubbleSpot, hitTest, hotspots, inView, type Hotspot } from './hotspots';
import { LAYOUTS } from './layouts';
import { armClickSwallow } from './swallow';
import './map.css';

export type Preset = 'zone' | 'site' | 'all';
export const PRESETS: Preset[] = ['zone', 'site', 'all'];
const PRESET_LABEL: Record<Preset, string> = { zone: 'My zone', site: 'Build site', all: 'All' };

export type MapProps = {
  s: IslandState;
  role: Role | null;
  /** an object on the map was tapped: its sheet (home.tsx: the inspect sheet; a cart goes to onCart) */
  onObject: (r: ObjectRef) => void;
  /** a ground power cart was tapped: the GSE sheet on it */
  onCart: (cartId: string) => void;
  /** the preset to open on: 'zone' | 'site' | 'all' (default: the one last used on this island and seat, else all) */
  initial?: string;
  /** go to a preset from outside the map (Home's builders' line: the build site); the map moves when `n` changes */
  go?: { preset: string; n: number };
  /** the light of the hour (the island lab pins it; default: the device's clock) */
  phase?: Phase;
  /** reduced motion (default: the setting) */
  reduceMotion?: boolean;
};

const lsGet = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode: remembered for this visit only */
  }
};
const isPreset = (v: unknown): v is Preset => v === 'zone' || v === 'site' || v === 'all';
const pointerKind = (t: string): PointerKind => (t === 'mouse' ? 'mouse' : t === 'pen' ? 'pen' : 'touch');
const fine = () => typeof matchMedia !== 'undefined' && matchMedia('(hover: hover) and (pointer: fine)').matches;

/**
 * The map's shell: a slot in the page. The map itself lives in a root of its own (`host`), so Explore can lift the
 * very same instance over the whole screen (out of every stacking context) and put it back, with its camera, its
 * drawing and its state intact: one scene, never two (5.1).
 */
export function MapView(p: MapProps) {
  const slot = useRef<HTMLDivElement>(null);
  const host = useMemo(() => (typeof document !== 'undefined' ? document.createElement('div') : null), []);
  useLayoutEffect(() => {
    if (!host || !slot.current) return;
    if (!host.parentNode) slot.current.appendChild(host);
    render(<MapBody {...p} host={host} slot={slot.current} />, host);
  });
  useLayoutEffect(
    () => () => {
      if (!host) return;
      render(null, host);
      host.remove();
    },
    [],
  );
  return <div ref={slot} class="map-slot" />;
}

function MapBody(p: MapProps & { host: HTMLElement; slot: HTMLElement }) {
  const { s, role } = p;
  const reduce = p.reduceMotion ?? settings.get().reduceMotion;
  const phase = p.phase ?? phaseOf();
  const [explore, setExplore] = useState(false);
  const mode: MapMode = explore ? 'explore' : 'inline';
  const vpEl = useRef<HTMLDivElement>(null);
  const stageEl = useRef<HTMLDivElement>(null);
  const exploreBtn = useRef<HTMLButtonElement>(null);
  const firstItem = useRef<HTMLButtonElement>(null);
  const [vp, setVp] = useState<Size | null>(null);
  const [cam, setCam] = useState<Cam | null>(null);
  const probe = useRef<IslandProbe | null>(null);
  const [chooser, setChooser] = useState<{ at: Pt; items: [Hotspot, Hotspot] } | null>(null);
  const [list, setList] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const single = useRef(0);
  const rect = useRef<{ left: number; top: number }>({ left: 0, top: 0 });
  /** two fingers were down in this touch sequence: every move of it is the map's */
  const multiSeen = useRef(false);

  // the latest values, for the controller and the DOM listeners (they're made once)
  const cur = useRef({ s, role, vp, mode, reduce, phase, p });
  cur.current = { s, role, vp, mode, reduce, phase, p };
  const size = () => cur.current.vp ?? { w: 800, h: 600 };
  const lim = () => limitsFor(cur.current.mode, size());
  const storeKey = `ic.map.v1.${s.id}.${role ?? '-'}`;

  /** a preset's camera for this viewport (5.3): the seat's zone, the builders' site, the whole island */
  const presetCam = (id: Preset, v: Size = size()): Cam => {
    const l = limitsFor(cur.current.mode, v);
    const { s: st, role: r } = cur.current;
    if (id === 'zone' && r) return camForBox(focusBox(r, st.tier), v, HOME_SCENE, l);
    if (id === 'site') {
      const b = siteBox(st);
      if (b) return camForBox(b, v, HOME_SCENE, l);
    }
    // (the whole island: on a portrait phone in Explore the sea is drawn out to the screen's edges, review round 2)
    return allCam(v, HOME_SCENE, l);
  };

  const ctl = useMemo(
    () =>
      new MapController(
        {
          vp: size,
          sc: HOME_SCENE,
          lim,
          mode: () => cur.current.mode,
          dpr: () => (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1),
          reduce: () => cur.current.reduce,
          stage: () => stageEl.current,
          surface: () => vpEl.current,
          commit: (c) => setCam({ ...c }),
          tap: (at, double, kind) => onTap(at, double, kind),
          begin: () => {
            // a new touch cancels the single-tap action waiting on empty ground (a double tap is coming)
            if (single.current) clearTimeout(single.current);
            single.current = 0;
            setChooser(null);
          },
          settled: (how, c, kind) => {
            if (how === 'gesture' && kind !== 'mouse' && cur.current.mode === 'inline' && c.k > 1.01) hintOnce('touch', 'Two fingers to move the map · ⤢ to explore');
          },
          // the click the browser sends after a tap (or a mouse sequence) is ours: the map handled it. Swallowed wherever
          // it lands (a sheet the tap opened is under the finger by then); a pinch or a touch drag sends none
          swallow: () => armClickSwallow(),
          raf: (f) => requestAnimationFrame(f),
          caf: (id) => cancelAnimationFrame(id),
          later: (f, ms) => window.setTimeout(f, ms),
          cancelLater: (id) => clearTimeout(id),
        },
        allCam(HOME_SCENE),
      ),
    [],
  );
  // unmount: the controller, and the single-tap and hint timers (they'd act on a map that's gone)
  useEffect(
    () => () => {
      ctl.dispose();
      clearTimeout(single.current);
      clearTimeout(hintT.current);
    },
    [],
  );

  // ---- the viewport's size: measured before the first paint, then followed
  useLayoutEffect(() => {
    const el = vpEl.current;
    if (!el) return;
    const read = () => {
      const w = el.clientWidth, h = el.clientHeight;
      if (w > 0 && h > 0) setVp((o) => (o && Math.abs(o.w - w) < 0.5 && Math.abs(o.h - h) < 0.5 ? o : { w, h }));
    };
    read();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(read) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (!vp) return;
    if (!cam) {
      const kept = lsGet(storeKey);
      const first = isPreset(p.initial) ? p.initial : isPreset(kept) ? kept : 'all';
      const c = presetCam(first === 'site' && !siteBox(s) ? 'all' : first, vp);
      ctl.init(c);
      setCam(c);
    } else {
      ctl.resized();
      // Explore just opened on a portrait phone at the whole island: fill the screen (review round 1)
      if (coverOnOpen.current && cur.current.mode === 'explore') {
        coverOnOpen.current = false;
        const c = ctl.cam.k <= 1.001 ? coverCam(vp, HOME_SCENE, lim()) : null;
        if (c) ctl.go(c, false);
      }
    }
  }, [vp?.w, vp?.h]);
  // the camera was committed: the drawing shows it now, so put the stage back (same frame, before paint)
  useLayoutEffect(() => {
    if (cam) ctl.afterCommit();
  }, [cam]);

  // ---- Home's builders' line: jump to the build site
  useEffect(() => {
    if (p.go && isPreset(p.go.preset)) goPreset(p.go.preset);
  }, [p.go?.n]);

  // ---- Explore: lift the host over the page (the slot keeps its height), and put it back
  const wasExplore = useRef(false);
  const coverOnOpen = useRef(false);
  useLayoutEffect(() => {
    const { host, slot } = p;
    const root = document.documentElement;
    if (explore) {
      coverOnOpen.current = true;
      slot.style.minHeight = `${slot.offsetHeight}px`;
      document.body.appendChild(host);
      root.classList.add('map-exploring');
      vpEl.current?.focus({ preventScroll: true });
    } else if (wasExplore.current) {
      slot.appendChild(host);
      slot.style.minHeight = '';
      root.classList.remove('map-exploring');
      exploreBtn.current?.focus({ preventScroll: true });
    }
    wasExplore.current = explore;
  }, [explore]);
  useEffect(() => () => document.documentElement.classList.remove('map-exploring'), []);
  // a move that leaves the map (a sheet's alert or job, the desk, Stores, a message) closes Explore, so what it opens is
  // on top (review round 1: the job sheet opened under Explore, the screen only dimmed, and the desk's links did
  // nothing). An object's own sheet (openTarget({ object })) opens over Explore as before
  useEffect(() => {
    if (!explore) return;
    const leave = () => setExplore(false);
    const onOpen = (e: Event) => {
      const t = (e as CustomEvent<Record<string, unknown> | null>).detail;
      if (t && !('object' in t)) leave();
    };
    const onFlow = (e: Event) => {
      const t = (e as CustomEvent<{ stores?: boolean; start?: boolean } | null>).detail;
      if (t?.stores || t?.start) leave();
    };
    window.addEventListener('ic:open', onOpen);
    window.addEventListener('ic:dm', leave);
    window.addEventListener('ic:flow', onFlow);
    return () => {
      window.removeEventListener('ic:open', onOpen);
      window.removeEventListener('ic:dm', leave);
      window.removeEventListener('ic:flow', onFlow);
    };
  }, [explore]);

  // ---- listeners the map needs non-passive: the wheel, two-finger touches, the click after a tap or a drag
  useEffect(() => {
    const el = vpEl.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as Element)?.closest?.('.map-ui')) return;
      const zoom = cur.current.mode === 'explore' || e.ctrlKey || e.metaKey;
      if (!zoom) {
        if (fine()) hintOnce('wheel', 'Ctrl + scroll to zoom');
        return; // a plain wheel scrolls the page
      }
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
      // a trackpad pinch arrives as a ctrl-wheel of small steps
      ctl.wheel([e.clientX - r.left, e.clientY - r.top], dy, e.ctrlKey && Math.abs(dy) < 50);
    };
    // inline, two fingers belong to the map (the page mustn't scroll or zoom under them); one finger scrolls
    // (the fingers on the map: a thumb resting elsewhere on the screen doesn't make one finger here a pinch)
    const onTouch = (e: TouchEvent) => {
      if (fingersOn(e.touches, el) >= 2) multiSeen.current = true;
      // (the finger left from a pinch keeps panning the map until it lifts)
      if (e.cancelable && multiSeen.current) e.preventDefault();
    };
    const onEnd = (e: TouchEvent) => {
      if (fingersOn(e.touches, el) === 0) multiSeen.current = false;
    };
    const onGesture = (e: Event) => e.preventDefault(); // iOS Safari's page pinch-zoom
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onTouch, { passive: false });
    el.addEventListener('touchmove', onTouch, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    el.addEventListener('gesturestart', onGesture);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouch);
      el.removeEventListener('touchmove', onTouch);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
      el.removeEventListener('gesturestart', onGesture);
    };
  }, []);

  // ---- hints, once per device
  const hintT = useRef(0);
  function hintOnce(key: string, text: string) {
    const k = `ic.map.hint.${key}`;
    if (lsGet(k)) return;
    lsSet(k, '1');
    setHint(text);
    clearTimeout(hintT.current);
    hintT.current = window.setTimeout(() => setHint(null), 4200);
  }

  // ---- what's where: the registry, plus the bubbles as the island placed them (kept until the next drawing)
  const spotCache = useRef<{ probe: IslandProbe | null; s: IslandState; phase: Phase; out: Hotspot[] } | null>(null);
  function spots(): Hotspot[] {
    const { s: st, phase: ph } = cur.current;
    const c = spotCache.current;
    if (c && c.probe === probe.current && c.s === st && c.phase === ph) return c.out;
    const out = hotspots(st, HOME, LAYOUTS.home, { phase: ph });
    for (const b of probe.current?.bubbles ?? []) {
      const a = st.assets.find((x) => x.id === b.owner);
      const ref: ObjectRef | null = a ? assetRef(a) : b.owner === 'office' ? fixtureRef('office') : null;
      if (ref) out.push(bubbleSpot(ref, a?.name ?? OBJECT_LABEL[ref.kind], b.r));
    }
    spotCache.current = { probe: probe.current, s: st, phase: ph, out };
    return out;
  }

  // ---- a mouse over the map: the pointer and a name tag over what a click would open (written to the DOM, no render)
  const tipEl = useRef<HTMLDivElement>(null);
  const hovered = useRef('');
  const tipW = useRef(0);
  const hover = (e: PointerEvent | null) => {
    const el = vpEl.current, tip = tipEl.current, v = cur.current.vp;
    if (!el || !tip || !v) return;
    let label = '';
    let at: Pt = [0, 0];
    if (e && e.pointerType === 'mouse' && !ctl.g.active && !ctl.flying) {
      const r = el.getBoundingClientRect();
      at = [e.clientX - r.left, e.clientY - r.top];
      const res = hitTest(spots(), toScene(ctl.cam, at, v), pxPerUnit(ctl.cam, v), ctl.cam.k >= lim().kMax - 1e-3);
      if ('hit' in res) label = res.hit.label;
    }
    el.style.cursor = label ? 'pointer' : '';
    if (label !== hovered.current) {
      hovered.current = label;
      tip.textContent = label;
      tip.style.display = label ? '' : 'none';
      tipW.current = label ? tip.offsetWidth : 0;
    }
    // beside the pointer, flipped to its left near the right edge, above it near the bottom
    const x = at[0] + 14 + tipW.current > v.w - 6 ? at[0] - 10 - tipW.current : at[0] + 14;
    const y = at[1] + 44 > v.h ? at[1] - 30 : at[1] + 18;
    if (label) tip.style.transform = `translate(${Math.round(Math.max(4, x))}px, ${Math.round(y)}px)`;
  };

  function goPreset(id: Preset, animate = true) {
    lsSet(storeKey, id);
    ctl.go(presetCam(id), animate);
  }
  function open(r: ObjectRef) {
    fx.tap();
    setChooser(null);
    if (r.kind === 'cart') return cur.current.p.onCart(r.id);
    // a builder or a build site: its sheet, with the site framed behind it (gap-zoom's builders' tap)
    if (r.kind === 'site' && siteBox(cur.current.s) && !nearCam(ctl.cam, presetCam('site'))) goPreset('site');
    cur.current.p.onObject(r);
  }
  function onTap(at: Pt, double: boolean, kind: PointerKind) {
    const v = cur.current.vp;
    if (!v) return;
    const c = ctl.cam;
    const l = lim();
    const atMax = c.k >= l.kMax - 1e-3;
    const res = hitTest(spots(), toScene(c, at, v), pxPerUnit(c, v), atMax);
    if ('hit' in res) return open(res.hit.ref);
    if ('zoom' in res) {
      fx.tap();
      return ctl.go(zoomAt(c, at, 2, v, HOME_SCENE, l));
    }
    if ('choose' in res) {
      fx.tap();
      return setChooser({ at, items: res.choose });
    }
    // empty ground: a double tap zooms x2 about the point (back out at the most zoom); a single tap toggles all <-> my zone
    if (double) {
      fx.tap();
      if (kind !== 'mouse' && cur.current.mode === 'inline' && !atMax) hintOnce('touch', 'Two fingers to move the map · ⤢ to explore');
      return ctl.go(atMax ? presetCam('all') : zoomAt(c, at, 2, v, HOME_SCENE, l));
    }
    single.current = window.setTimeout(() => {
      single.current = 0;
      ctl.g.forgetTap();
      fx.tap();
      goPreset(ctl.cam.k <= 1.001 && cur.current.role ? 'zone' : 'all');
    }, TAP.singleDelayMs);
  }

  // ---- pointers
  const pin = (e: PointerEvent) => ({ id: e.pointerId, kind: pointerKind(e.pointerType), x: e.clientX - rect.current.left, y: e.clientY - rect.current.top, t: e.timeStamp });
  const onDown = (e: PointerEvent) => {
    if ((e.target as Element)?.closest?.('.map-ui')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const r = vpEl.current!.getBoundingClientRect();
    if (!ctl.g.active) rect.current = { left: r.left, top: r.top };
    try {
      vpEl.current!.setPointerCapture(e.pointerId);
    } catch {
      /* a synthetic pointer */
    }
    ctl.down(pin(e));
  };
  const onMove = (e: PointerEvent) => {
    if (ctl.g.active) {
      hover(null);
      ctl.move(pin(e));
    } else if (e.pointerType === 'mouse') hover(e);
  };
  const onUp = (e: PointerEvent) => {
    if (!ctl.g.active) return;
    // (the controller arms the click swallower when a click will follow: deps.swallow)
    ctl.up(pin(e));
  };
  const onCancel = (e: PointerEvent) => ctl.g.active && ctl.cancel(pin(e));

  // ---- keyboard (the map is role=application: its keys are its own)
  const onKey = (e: KeyboardEvent) => {
    if (e.target !== vpEl.current || !cam || !vp) return;
    const c = ctl.cam;
    const l = lim();
    const centre: Pt = [vp.w / 2, vp.h / 2];
    const step = 60 * pxPerUnit(c, vp);
    let handled = true;
    switch (e.key) {
      case 'ArrowLeft':
        ctl.go(panCam(c, step, 0, vp, HOME_SCENE, l), false);
        break;
      case 'ArrowRight':
        ctl.go(panCam(c, -step, 0, vp, HOME_SCENE, l), false);
        break;
      case 'ArrowUp':
        ctl.go(panCam(c, 0, step, vp, HOME_SCENE, l), false);
        break;
      case 'ArrowDown':
        ctl.go(panCam(c, 0, -step, vp, HOME_SCENE, l), false);
        break;
      case '+':
      case '=':
        ctl.go(zoomAt(c, centre, 1.5, vp, HOME_SCENE, l));
        break;
      case '-':
      case '_':
        ctl.go(zoomAt(c, centre, 1 / 1.5, vp, HOME_SCENE, l));
        break;
      case '0':
        goPreset('all');
        break;
      case 'm':
      case 'M':
        if (role) goPreset('zone');
        break;
      case 's':
      case 'S':
        if (siteBox(s)) goPreset('site');
        break;
      case 'Enter':
        setList(true);
        break;
      case 'Escape':
        if (chooser) setChooser(null);
        else handled = false; // Explore's close (app.tsx: Esc clicks [data-esc])
        break;
      default:
        handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  useEffect(() => {
    if (list) firstItem.current?.focus();
  }, [list]);
  const closeList = () => {
    setList(false);
    vpEl.current?.focus({ preventScroll: true });
  };
  const onListKey = (e: KeyboardEvent) => {
    const items = [...((e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('.map-list-item') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') closeList();
    else if (e.key === 'ArrowDown') items[Math.min(items.length - 1, i + 1)]?.focus();
    else if (e.key === 'ArrowUp') items[Math.max(0, i - 1)]?.focus();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  // ---- render
  const frame = cam && vp ? frameOf(cam, vp, HOME_SCENE, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1) : null;
  const site = siteBox(s);
  const chips = PRESETS.filter((id) => (id === 'zone' ? !!role : id === 'site' ? !!site : true));
  const on = (id: Preset) => !!cam && !!vp && nearCam(cam, presetCam(id));
  const atAll = !cam || cam.k <= 1.001;
  const verb = fine() ? 'click' : 'tap';
  const weather = s.weather === 'clear' ? '☀' : s.weather === 'wind' ? '〰 wind' : '⛈ storm';
  const zoomBtns = (
    <>
      {/* (map-zoom: hidden inline on a narrow touch phone, where two fingers zoom and the All chip is the whole island:
          review round 2, four buttons covered 60% of a 360 px map's top edge and a bubble under them) */}
      <button class="map-btn map-zoom" aria-label="Zoom in" onClick={() => vp && ctl.go(zoomAt(ctl.cam, [vp.w / 2, vp.h / 2], 1.5, vp, HOME_SCENE, lim()))}>
        +
      </button>
      <button class="map-btn map-zoom" aria-label="Zoom out" onClick={() => vp && ctl.go(zoomAt(ctl.cam, [vp.w / 2, vp.h / 2], 1 / 1.5, vp, HOME_SCENE, lim()))}>
        −
      </button>
      <button class="map-btn map-zoom" aria-label="The whole island" onClick={() => goPreset('all')}>
        ⌖
      </button>
    </>
  );
  const chipRow = chips.length > 1 && (
    <div class="map-ui map-chips" role="group" aria-label="Map views">
      {chips.map((id) => (
        <button key={id} class="map-chip" aria-pressed={on(id)} onClick={() => (fx.tap(), goPreset(id))}>
          {PRESET_LABEL[id]}
        </button>
      ))}
    </div>
  );
  const listItems = list && cam && vp ? inView(spots(), viewRect(cam, vp)) : [];
  return (
    <div
      class={explore ? `overlay map map-explore${reduce ? ' reduce-motion' : ''}` : 'map'}
      role={explore ? 'dialog' : undefined}
      aria-label={explore ? 'Explore the island' : undefined}
    >
      {explore && (
        <div class="map-ui map-top">
          {chipRow || <span class="grow" />}
          <button class="map-btn map-close" aria-label="Close the map" data-esc onClick={() => (fx.tap(), setExplore(false))}>
            ✕
          </button>
        </div>
      )}
      <div
        key="vp"
        ref={vpEl}
        class={`map-vp${explore ? '' : ' island-wrap'}`}
        style={{ touchAction: touchActionFor(mode) }}
        tabIndex={0}
        role="application"
        aria-roledescription="map"
        aria-label={`Island map. Arrows move, plus and minus zoom, 0 the whole island${role ? ', M your zone' : ''}${site ? ', S the build site' : ''}, Enter lists what's in view.`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
        onPointerLeave={() => hover(null)}
        onKeyDown={onKey}
      >
        <div class="map-ui map-tip" ref={tipEl} style={{ display: 'none' }} aria-hidden="true" />
        <div class="map-stage" ref={stageEl}>
          {frame && <Island s={s} frame={frame} probe={probe} reduceMotion={reduce} phase={phase} onCart={(id) => open({ kind: 'cart', id, st: HOME })} />}
        </div>
        <div class={`map-ui map-ctl${explore ? ' map-ctl-x' : ''}`}>
          {zoomBtns}
          {!explore && (
            <button ref={exploreBtn} class="map-btn" aria-label="Explore full screen" onClick={() => (fx.tap(), setChooser(null), setExplore(true))}>
              ⤢
            </button>
          )}
        </div>
        {hint ? (
          <span class="island-hint map-hint">{hint}</span>
        ) : (
          !explore && (
            <span class="island-hint">
              {weather} · {verb} anything · ground: {atAll ? (role ? 'your zone' : 'zoom') : 'whole island'}
            </span>
          )
        )}
        {chooser && vp && (
          <div class="map-ui map-choose" style={{ left: `${Math.max(8, Math.min(vp.w - 208, chooser.at[0] - 100))}px`, top: `${Math.max(8, Math.min(vp.h - 150, chooser.at[1] + 14))}px` }}>
            {chooser.items.map((h) => (
              <button key={`${h.ref.kind}:${h.ref.id}`} class="map-list-item" onClick={() => open(h.ref)}>
                {h.label}
                <span>{OBJECT_LABEL[h.ref.kind]}</span>
              </button>
            ))}
          </div>
        )}
        {list && (
          <div class="map-ui map-list" role="dialog" aria-label="Objects on the map" onKeyDown={onListKey}>
            <div class="map-list-head">
              <b>Objects on the map</b>
              <button class="map-btn" aria-label="Close the list" onClick={closeList}>
                ✕
              </button>
            </div>
            {listItems.map((h, i) => (
              <button
                key={`${h.ref.kind}:${h.ref.id}`}
                ref={i === 0 ? firstItem : undefined}
                class="map-list-item"
                onClick={() => {
                  setList(false);
                  open(h.ref);
                }}
              >
                {h.label}
                <span>{OBJECT_LABEL[h.ref.kind]}</span>
              </button>
            ))}
            {!listItems.length && <span class="muted">Nothing here: zoom out.</span>}
          </div>
        )}
      </div>
      {!explore && chipRow}
    </div>
  );
}
