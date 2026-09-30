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
