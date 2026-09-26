import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const __dirname = import.meta.dirname;

/** Writes dist/sw.js with a precache list of every built file (offline-first). */
function serviceWorker(): Plugin {
  let outDir = 'dist';
  return {
    name: 'island-sw',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    writeBundle(_, bundle) {
      // the puzzle lab is a dev tool: keep it out of the offline cache
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map') && f !== 'lab.html' && !f.startsWith('assets/lab-'));
      const statics = ['./', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/icon.svg'];
      const version = Date.now().toString(36);
      const sw = `// generated at build time
const CACHE = 'island-${version}';
const PRECACHE = ${JSON.stringify([...statics, ...files.map((f) => './' + f)])};
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return; // Firestore, ntfy: network only
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('./index.html').then((r) => r || caches.match('./'))));
    return;
  }
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
`;
      writeFileSync(resolve(outDir, 'sw.js'), sw);
    },
  };
}

export default defineConfig({
  base: './',
  // lets a second dev server (e.g. wired to the Firebase emulators) run side by side
  cacheDir: process.env.VITE_CACHE_DIR ?? 'node_modules/.vite',
  plugins: [serviceWorker()],
  build: {
    target: 'es2022',
    // Firestore is ~550 kB but lazy-loaded only in online mode
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        lab: resolve(__dirname, 'lab.html'),
      },
    },
  },
  server: { port: 5173, strictPort: true },
  // one pre-bundle for preact + hooks so there is never a second copy of preact
  optimizeDeps: { include: ['preact', 'preact/hooks', 'preact/jsx-runtime', 'preact/jsx-dev-runtime'] },
});
