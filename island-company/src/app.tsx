import { useEffect, useState } from 'preact/hooks';
import { sessions } from './net/session';
import { IslandScreen } from './ui/home';
import { Toaster } from './ui/kit';
import { Start } from './ui/start';

type Route = { name: 'start'; join?: string } | { name: 'island'; id: string };

function parse(): Route {
  const h = location.hash.replace(/^#\/?/, '');
  const [a, b] = h.split('/');
  if (a === 'i' && b) return { name: 'island', id: b };
  if (a === 'join' && b) return { name: 'start', join: b };
  return { name: 'start' };
}

/** Cold start (the home-screen icon opens ./ with no hash): go straight back to the last island. */
function initial(): Route {
  const active = sessions.get().active;
  if (location.hash === '' && active && sessions.ref(active)) {
    history.replaceState(null, '', `#/i/${active}`);
    return { name: 'island', id: active };
  }
  return parse();
}

export function App() {
  const [route, setRoute] = useState<Route>(initial);
  const [, force] = useState(0);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener('hashchange', on);
    const off = sessions.subscribe(() => force((n) => n + 1));
    return () => {
      window.removeEventListener('hashchange', on);
      off();
    };
  }, []);

  // Esc closes the top sheet/overlay on desktop
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // (a sheet that closed itself on this Esc marks it handled: one Esc closes the top layer only, review round 1)
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const scrim = document.querySelector<HTMLElement>('.scrim');
      if (scrim) return scrim.click();
      // overlays (puzzle, review) mark their close/back button
      document.querySelector<HTMLElement>('.overlay [data-esc]')?.click();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  let body;
  if (route.name === 'island') {
    const ref = sessions.ref(route.id);
    if (!ref) body = <Start joinCode={route.id} />;
    else {
      if (sessions.get().active !== ref.id) sessions.setActive(ref.id);
      body = <IslandScreen key={`${ref.id}:${ref.role}`} islandRef={ref} />;
    }
  } else {
    if (sessions.get().active) sessions.setActive(null);
    body = <Start joinCode={route.join} />;
  }
  return (
    <>
      {body}
      <Toaster />
    </>
  );
}
