// Taps vs drags vs pinches on the map (docs/EXPANSION.md 5.2): a pure
// classifier over pointer events, so the rules are testable without a DOM.
//
// - a pointer that moves more than 8 CSS px from where it went down is a drag (a mouse: 4 px)
// - two pointers are a pinch
// - up within 500 ms without a drag is a tap
// - two taps within 300 ms and 24 px are a double tap
// - a drag, a pinch or a tap swallows the click that follows (the map handles its own taps)
// - inline, a one-finger touch drag is left to the page: it never pans the map (the page scrolls)
//
// It says what the camera should do relative to a base: `base` means "take the
// camera as it is now", then each `live` describes the gesture since that base.
import type { Pt } from '../island/geo';
import type { MapMode } from './camera';

export const TAP = {
  /** CSS px a touch (or pen) may wander and still be a tap */
  dragTouch: 8,
  /** CSS px a mouse may wander */
  dragMouse: 4,
  /** a press longer than this is not a tap */
  maxMs: 500,
  /** two taps this close in time (the first's up to the second's down) are a double tap */
  dblMs: 300,
  /** ... and this close on screen */
  dblPx: 24,
  /** a tap on empty ground acts after this, so a double tap can cancel it (5.1) */
  singleDelayMs: 250,
};

export type PointerKind = 'touch' | 'mouse' | 'pen';
export type PIn = { id: number; kind: PointerKind; x: number; y: number; t: number };

export type Live = { kind: 'pan'; from: Pt; to: Pt } | { kind: 'pinch'; a0: Pt; b0: Pt; a: Pt; b: Pt };
export type GOut =
  /** the first pointer of a new sequence went down */
  | { t: 'begin'; kind: PointerKind }
  /** the pointers changed mid-gesture: take the camera as it is now as the base of what follows */
  | { t: 'base' }
  /** move the camera: the gesture since the last base */
  | { t: 'live'; live: Live }
  | { t: 'tap'; at: Pt; double: boolean; kind: PointerKind }
  /** every pointer is up (or the browser took them): commit if the camera moved; swallow the click that follows */
  | { t: 'end'; moved: boolean; swallow: boolean };

type Track = { kind: PointerKind; down: Pt; t0: number; at: Pt; anchor: Pt };

export class Classifier {
  private pts = new Map<number, Track>();
  /** some pointer passed its drag threshold, or two were down */
  private dragged = false;
  /** two pointers were down at some point in this sequence */
  private multi = false;
  /** a live move was emitted in this sequence (the camera may have moved) */
  private moved = false;
  private lastTap: { at: Pt; t: number; kind: PointerKind } | null = null;

  constructor(private mode: () => MapMode) {}

  /** a single pointer pans: in Explore, with a mouse, or a finger left over from a pinch; never a lone finger inline */
  private pans(kind: PointerKind) {
    return this.mode() === 'explore' || kind === 'mouse' || this.multi;
  }
  private rebase() {
    for (const p of this.pts.values()) p.anchor = p.at;
  }
  private liveOut(): GOut[] {
    const ps = [...this.pts.values()];
    if (ps.length >= 2) {
      this.moved = true;
      return [{ t: 'live', live: { kind: 'pinch', a0: ps[0].anchor, b0: ps[1].anchor, a: ps[0].at, b: ps[1].at } }];
    }
    if (ps.length === 1 && this.dragged && this.pans(ps[0].kind)) {
      this.moved = true;
      return [{ t: 'live', live: { kind: 'pan', from: ps[0].anchor, to: ps[0].at } }];
    }
    return [];
  }

  /** is a sequence under way (a pointer down)? */
  get active() {
    return this.pts.size > 0;
  }
  /** has this sequence become more than a tap (a drag or a pinch)? */
  get gesturing() {
    return this.dragged;
  }
  /** drop the last tap, so the next one can't be the second of a double (the first's single action already ran) */
  forgetTap() {
    this.lastTap = null;
  }

  down(p: PIn): GOut[] {
    const out: GOut[] = [];
    if (this.pts.size === 0) {
      this.dragged = false;
      this.multi = false;
      this.moved = false;
      out.push({ t: 'begin', kind: p.kind });
    }
    // a third finger, or a mouse joining a touch: ignored
    if (this.pts.size >= 2 || (this.pts.size === 1 && (p.kind === 'mouse' || [...this.pts.values()][0].kind === 'mouse'))) return out;
    this.pts.set(p.id, { kind: p.kind, down: [p.x, p.y], t0: p.t, at: [p.x, p.y], anchor: [p.x, p.y] });
    if (this.pts.size === 2) {
      this.multi = true;
      this.dragged = true;
      this.rebase();
      out.push({ t: 'base' });
    }
    return out;
  }

  move(p: PIn): GOut[] {
    const tr = this.pts.get(p.id);
    if (!tr) return [];
    tr.at = [p.x, p.y];
    if (!this.dragged) {
      const lim = tr.kind === 'mouse' ? TAP.dragMouse : TAP.dragTouch;
      if (Math.hypot(p.x - tr.down[0], p.y - tr.down[1]) <= lim) return [];
      this.dragged = true;
      // the content follows the finger from where it went down (the anchor is the down point)
    }
    return this.liveOut();
  }

  up(p: PIn): GOut[] {
    const tr = this.pts.get(p.id);
    if (!tr) return [];
    tr.at = [p.x, p.y];
    const out: GOut[] = [];
    // the last move before the lift still counts
    if (this.dragged) out.push(...this.liveOut());
    this.pts.delete(p.id);
    if (this.pts.size === 1) {
      // a pinch lost a finger: the other one carries on panning from here
      this.rebase();
      out.push({ t: 'base' });
      return out;
    }
    if (this.pts.size > 0) return out;
    let tapped = false;
    if (!this.dragged && !this.multi && p.t - tr.t0 <= TAP.maxMs) {
      const l = this.lastTap;
      const double = !!l && l.kind === tr.kind && tr.t0 - l.t <= TAP.dblMs && Math.hypot(tr.down[0] - l.at[0], tr.down[1] - l.at[1]) <= TAP.dblPx;
      out.push({ t: 'tap', at: tr.down, double, kind: tr.kind });
      this.lastTap = double ? null : { at: tr.down, t: p.t, kind: tr.kind };
      tapped = true;
    } else this.lastTap = null;
    out.push({ t: 'end', moved: this.moved, swallow: tapped || this.dragged || this.multi || p.t - tr.t0 > TAP.maxMs });
    return out;
  }

  /** the browser took the pointer (inline: the page scrolled) or it was lost */
  cancel(p: PIn): GOut[] {
    if (!this.pts.has(p.id)) return [];
    this.pts.delete(p.id);
    this.lastTap = null;
    if (this.pts.size === 1) {
      this.rebase();
      return [{ t: 'base' }];
    }
    if (this.pts.size > 0) return [];
    return [{ t: 'end', moved: this.moved, swallow: true }];
  }
}
