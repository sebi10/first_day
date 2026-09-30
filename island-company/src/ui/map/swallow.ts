// The click after a map tap (docs/EXPANSION.md 5.2; stage 2 review round 1). The map handles its own taps on
// pointerup, so the click the browser sends after a tap (or after any mouse sequence) is the map's: a sheet the tap
// opened is under the finger by then, and must not get it. Armed only when a click will follow (gestures.ts `end`
// .swallow), and disarmed by the next pointerdown anywhere: a new sequence's click is the player's own. Before, every
// pinch or touch drag armed it too (they send no click), and it ate the player's next real tap anywhere for 450 ms.

type Target = Pick<Window, 'addEventListener' | 'removeEventListener'>;

/** eat the next click (capture, anywhere), unless a new pointer sequence starts first or `ms` pass */
export function armClickSwallow(w: Target = window, ms = 450, later: (f: () => void, ms: number) => unknown = (f, t) => setTimeout(f, t)): () => void {
  let on = true;
  const off = () => {
    if (!on) return;
    on = false;
    w.removeEventListener('click', eat as EventListener, true);
    w.removeEventListener('pointerdown', off, true);
  };
  const eat = (e: Event) => {
    off();
    e.stopPropagation();
    e.preventDefault();
  };
  w.addEventListener('click', eat as EventListener, true);
  w.addEventListener('pointerdown', off, true);
  later(off, ms);
  return off;
}

/**
 * The second tap of a double tap on an object (stage 2 review round 3). An object's tap opens its sheet at once (snappy),
 * so the second tap of a double tap landed on that sheet or its scrim: the sheet blinked shut and the map never zoomed
 * (on about half of an island's area at the whole-island view: every object). Armed by an object tap: the next
 * pointerdown of the same kind within `ms` and `px` of it, wherever it lands, is the map's: it's eaten (and its click)
 * and `onDouble` runs (the view closes the sheet and zooms x2 about the point). Any other pointerdown, or `ms`
 * passing, disarms it.
 */
export function armObjectDouble(
  at: { x: number; y: number },
  kind: string,
  onDouble: () => void,
  o: { w?: Target; ms?: number; px?: number; later?: (f: () => void, ms: number) => unknown } = {},
): () => void {
  const w = o.w ?? window;
  let on = true;
  const off = () => {
    if (!on) return;
    on = false;
    w.removeEventListener('pointerdown', down as EventListener, true);
  };
  const down = (e: PointerEvent) => {
    off();
    const same = (e.pointerType === 'mouse') === (kind === 'mouse');
    if (!same || Math.hypot(e.clientX - at.x, e.clientY - at.y) > (o.px ?? 30)) return;
    e.stopPropagation();
    e.preventDefault();
    // (its click would land on what the first tap opened: a button on a tall sheet, or the scrim)
    armClickSwallow(w);
    onDouble();
  };
  w.addEventListener('pointerdown', down as EventListener, true);
  (o.later ?? ((f, t) => setTimeout(f, t)))(off, o.ms ?? 300);
  return off;
}
