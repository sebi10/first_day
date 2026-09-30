import '@fontsource-variable/manrope';
import { render } from 'preact';
import { App } from './app';
import './styles.css';

render(<App />, document.getElementById('app')!);

// Offline + installable. The service worker is generated at build time.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  // A new version took over (the worker skips waiting and claims open pages): reload, so an
  // open tab or an installed phone app never keeps playing the old engine on a newer island.
  // Not on the first install (nothing old is running then).
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

// The server refused a write from this build (the rules want a newer one), or the island was saved by a
// newer engine: reload to the new version, at most once a minute (never a loop if something else is wrong).
window.addEventListener('ic:stale', () => {
  try {
    const last = Number(sessionStorage.getItem('ic.staleReload') ?? 0);
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem('ic.staleReload', String(Date.now()));
  } catch {
    /* no storage: still reload once */
  }
  location.reload();
});
