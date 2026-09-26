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

export function App() {
  const [route, setRoute] = useState<Route>(parse);
  const [, force] = useState(0);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener('hashchange', on);
    const off = sessions.subscribe(() => force((n) => n + 1));
    // reopen the last island on cold start
    if (route.name === 'start' && !route.join && sessions.get().active) location.hash = `#/i/${sessions.get().active}`;
    return () => {
      window.removeEventListener('hashchange', on);
      off();
    };
  }, []);

  // Esc closes the top sheet/overlay on desktop
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const scrim = document.querySelector<HTMLElement>('.scrim');
      if (scrim) scrim.click();
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
