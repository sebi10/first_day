// A seat's own screens, fetched the first time they're shown: the analyst's desk,
// the techs' job sheet and week 0 are chunks of their own, so a phone downloads
// the UI of the seat it plays (the service worker still precaches every chunk:
// offline play is unchanged). A chunk that fails to load (after a deploy the
// old file is gone) reloads the page to the new build, at most once a minute
// (main.tsx, 'ic:stale').
import type { ComponentType, JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';

export type Lazy<P> = ((props: P) => JSX.Element | null) & {
  /** fetch it now (the seat is on screen): the first open is then instant */
  preload(): void;
};

export function lazy<P extends object>(load: () => Promise<ComponentType<P>>, fallback?: () => JSX.Element): Lazy<P> {
  let done: ComponentType<P> | null = null;
  let pending: Promise<ComponentType<P>> | null = null;
  const get = () =>
    (pending ??= load().then(
      (c) => (done = c),
      (e: unknown) => {
        pending = null;
        if (typeof window !== 'undefined') window.dispatchEvent(new Event('ic:stale'));
        throw e;
      },
    ));
  const L = (props: P) => {
    const [C, setC] = useState<ComponentType<P> | null>(() => done);
    useEffect(() => {
      if (C) return;
      let on = true;
      get().then(
        (c) => on && setC(() => c),
        () => {},
      );
      return () => {
        on = false;
      };
    }, []);
    return C ? <C {...props} /> : fallback ? fallback() : null;
  };
  L.preload = () => void get().catch(() => {});
  return L;
}

/** idle time after the first paint (a phone's first seconds go to the island) */
export const whenIdle = (f: () => void) => {
  if (typeof window === 'undefined') return;
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (ric) ric(f, { timeout: 2000 });
  else setTimeout(f, 300);
};
