// The camera's driver (docs/EXPANSION.md 5.5, 5.6): pointer and wheel input in,
// a CSS transform on the stage per animation frame out, and ONE commit (a
// Preact render at the new camera) when a gesture ends. No render happens
// while a finger is down: the drawing on screen is moved as a picture, which
// the compositor does without repainting the scene.
//
// Flights (a preset, the buttons, a double tap) animate the stage's transform
// with today's 0.45 s ease, picking the order of draw and fly so the ground is
// drawn all the way (camera.ts planFlight). Reduced motion jumps.
import type { Pt } from '../island/geo';
import { allCam, clampCam, FLIGHT_EASE, FLIGHT_MS, panCam, pinchCam, planFlight, relCss, sameCam, zoomAt, type Cam, type Limits, type MapMode, type Size } from './camera';
import { Classifier, type GOut, type PIn, type PointerKind } from './gestures';

type Styled = { style: { transform: string; transition: string } };
type Classed = { classList: { add(c: string): void; remove(c: string): void } };

export type CommitHow = 'gesture' | 'flight' | 'jump';

export type MapDeps = {
  vp(): Size;
  sc: Size;
  lim(): Limits;
  mode(): MapMode;
  dpr(): number;
  reduce(): boolean;
  /** the element moved by the transform (the stage around the <svg>) */
  stage(): (Styled & Partial<{ getBoundingClientRect(): unknown }>) | null;
  /** the element that gets `.gesturing` (the ambient motion pauses under it) */
  surface(): Classed | null;
  /** draw the scene at this camera (one Preact render); the view calls afterCommit() once the DOM shows it */
  commit(c: Cam, how: CommitHow): void;
  /** a tap (not a drag): the view hit-tests it */
  tap(at: Pt, double: boolean, kind: PointerKind): void;
  /** a new pointer sequence began (the view cancels a pending single-tap action) */
  begin?(kind: PointerKind): void;
  /** a gesture ended (after its commit, or with nothing to commit) */
  settled?(how: 'gesture' | 'wheel', cam: Cam, kind: PointerKind): void;
  /** the browser will send a click after this sequence (a tap, a mouse): it's the map's, eat it */
  swallow?(): void;
  raf(f: () => void): number;
  caf(id: number): void;
  later(f: () => void, ms: number): number;
  cancelLater(id: number): void;
};

type Pending = { kind: 'reset' } | { kind: 'flip'; from: Cam } | { kind: 'via'; from: Cam; to: Cam };

export class MapController {
  /** the camera the scene is drawn at */
  cam: Cam;
  /** where the gesture has it now (on screen via the stage's transform) */
  live: Cam;
  private base: Cam;
  readonly g: Classifier;
  private frame = 0;
  private pending: Pending | null = null;
  private flight: { to: Cam; timer: number; land: boolean } | null = null;
  private wheelTimer = 0;
  private wheeling = false;
  /** a flight asked for while a commit waits for its render: flown once it's drawn */
  private queued: { to: Cam; animate: boolean } | null = null;
  private kind: PointerKind = 'touch';
  /** commits made (a test counts renders by it) */
  commits = 0;

  constructor(
    private d: MapDeps,
    cam: Cam,
  ) {
    this.cam = cam;
    this.live = cam;
    this.base = cam;
    this.g = new Classifier(() => d.mode());
  }

  /** the first camera (the view measured its viewport): nothing is drawn yet, so nothing to commit */
  init(c: Cam) {
    this.cam = this.live = this.base = c;
  }

  private clamp(c: Cam) {
    return clampCam(c, this.d.vp(), this.d.sc, this.d.lim());
  }
  private write(transform: string, transition = 'none') {
    const st = this.d.stage();
    if (!st) return;
    st.style.transition = transition;
    st.style.transform = transform;
  }
  private schedule() {
    if (this.frame) return;
    this.frame = this.d.raf(() => {
      this.frame = 0;
      this.write(relCss(this.cam, this.live, this.d.vp(), this.d.sc));
    });
  }
  private doCommit(c: Cam, how: CommitHow, pending: Pending) {
    this.cam = c;
    this.live = c;
    this.pending = pending;
    this.commits++;
    this.d.commit(c, how);
  }

  /** the view drew the committed camera: put the stage where it belongs for it (same frame, before paint) */
  afterCommit() {
    const p = this.pending;
    this.pending = null;
    const st = this.d.stage();
    const vp = this.d.vp();
    if (!p || p.kind === 'reset' || !st) {
      this.write('');
      if (!this.g.active && !this.wheeling) this.d.surface()?.classList.remove('gesturing');
      const q = this.queued;
      this.queued = null;
      if (q) this.go(q.to, q.animate);
      return;
    }
    // start where the eye is (the old view), then fly
    this.write(relCss(this.cam, p.from, vp, this.d.sc));
    st.getBoundingClientRect?.();
    const to = p.kind === 'via' ? p.to : this.cam;
    this.write(relCss(this.cam, to, vp, this.d.sc), `transform ${FLIGHT_MS}ms ${FLIGHT_EASE}`);
    this.live = to;
    this.flight = { to, land: p.kind === 'via', timer: this.d.later(() => this.land(), FLIGHT_MS + 30) };
    const q = this.queued;
    this.queued = null;
    if (q) this.go(q.to, q.animate);
  }

  /** a flight reached its end: draw where it landed (a forward or via flight), or just drop the transition */
  private land() {
    const f = this.flight;
    if (!f) return;
    this.d.cancelLater(f.timer);
    this.flight = null;
    if (f.land || !sameCam(f.to, this.cam)) this.doCommit(f.to, 'flight', { kind: 'reset' });
    else this.write('');
  }

  /** is a flight on screen? */
  get flying() {
    return !!this.flight;
  }

  /** fly (or jump) to a camera */
  go(target: Cam, animate = true) {
    const to = this.clamp(target);
    if (this.flight) this.land();
    if (this.g.active) return;
    if (this.pending) {
      this.queued = { to, animate };
      return;
    }
    if (sameCam(to, this.cam) && sameCam(this.live, this.cam)) return;
    if (!animate || this.d.reduce()) return this.doCommit(to, 'jump', { kind: 'reset' });
    const vp = this.d.vp();
    const plan = planFlight(this.cam, to, vp, this.d.sc, this.d.dpr());
    if (plan === 'forward') {
      this.write(relCss(this.cam, to, vp, this.d.sc), `transform ${FLIGHT_MS}ms ${FLIGHT_EASE}`);
      this.live = to;
      this.flight = { to, land: true, timer: this.d.later(() => this.land(), FLIGHT_MS + 30) };
    } else if (plan === 'flip') this.doCommit(to, 'flight', { kind: 'flip', from: this.cam });
    else this.doCommit(allCam(vp, this.d.sc, this.d.lim()), 'flight', { kind: 'via', from: this.cam, to });
  }

  /** the viewport changed size (a rotation, Explore): keep the camera, clamped to the new shape */
  resized() {
    if (this.flight) this.land();
    const c = this.clamp(this.cam);
    if (!sameCam(c, this.cam)) this.doCommit(c, 'jump', { kind: 'reset' });
  }

  // ---- pointers
  private run(outs: GOut[]) {
    const vp = this.d.vp();
    for (const o of outs) {
      if (o.t === 'begin') {
        this.kind = o.kind;
        if (this.flight) this.land();
        this.base = this.live = this.cam;
        this.d.begin?.(o.kind);
      } else if (o.t === 'base') {
        this.base = this.live;
        this.d.surface()?.classList.add('gesturing');
      } else if (o.t === 'live') {
        this.d.surface()?.classList.add('gesturing');
        const lv = o.live;
        this.live =
          lv.kind === 'pan'
            ? panCam(this.base, lv.to[0] - lv.from[0], lv.to[1] - lv.from[1], vp, this.d.sc, this.d.lim())
            : pinchCam(this.base, lv.a0, lv.b0, lv.a, lv.b, vp, this.d.sc, this.d.lim());
        this.schedule();
      } else if (o.t === 'tap') this.d.tap(o.at, o.double, o.kind);
      else if (o.t === 'end') {
        if (o.swallow) this.d.swallow?.();
        if (this.frame) {
          this.d.caf(this.frame);
          this.frame = 0;
        }
        if (o.moved && !sameCam(this.live, this.cam)) this.doCommit(this.live, 'gesture', { kind: 'reset' });
        else {
          this.live = this.cam;
          this.write('');
          this.d.surface()?.classList.remove('gesturing');
        }
        if (o.moved) this.d.settled?.('gesture', this.cam, this.kind);
      }
    }
  }
  down(p: PIn) {
    this.run(this.g.down(p));
  }
  move(p: PIn) {
    this.run(this.g.move(p));
  }
  up(p: PIn) {
    this.run(this.g.up(p));
  }
  cancel(p: PIn) {
    this.run(this.g.cancel(p));
  }

  // ---- wheel: zoom about the cursor; commits 180 ms after the last event
  wheel(at: Pt, dy: number, pinch: boolean) {
    if (this.g.active) return;
    if (this.flight) this.land();
    if (!this.wheeling) {
      this.wheeling = true;
      this.live = this.cam;
      this.d.surface()?.classList.add('gesturing');
    }
    const f = Math.exp(-dy * (pinch ? 0.01 : 0.0015));
    this.live = zoomAt(this.live, at, f, this.d.vp(), this.d.sc, this.d.lim());
    this.schedule();
    this.d.cancelLater(this.wheelTimer);
    this.wheelTimer = this.d.later(() => {
      this.wheeling = false;
      if (this.frame) {
        this.d.caf(this.frame);
        this.frame = 0;
      }
      if (!sameCam(this.live, this.cam)) this.doCommit(this.live, 'gesture', { kind: 'reset' });
      else {
        this.write('');
        this.d.surface()?.classList.remove('gesturing');
      }
      this.d.settled?.('wheel', this.cam, 'mouse');
    }, 180);
  }

  /** stop everything (unmount) */
  dispose() {
    if (this.frame) this.d.caf(this.frame);
    if (this.flight) this.d.cancelLater(this.flight.timer);
    this.d.cancelLater(this.wheelTimer);
    this.flight = null;
    this.frame = 0;
  }
}
