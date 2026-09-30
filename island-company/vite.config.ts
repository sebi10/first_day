import { createHash } from 'node:crypto';
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
      // Precache only what every player needs offline. Left out (cached on first use instead):
      // the puzzle lab (dev tool), the Firebase SDK (online islands only) and the
      // non-Latin font subsets (the browser fetches them only if that script appears).
      const skip = (f: string) =>
        f.endsWith('.map') || f === 'lab.html' || f.startsWith('assets/lab-') || /firebase|index\.esm/i.test(f) || /(cyrillic|greek|vietnamese)/.test(f);
      const files = Object.keys(bundle).filter((f) => !skip(f));
      const statics = ['./', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/icon.svg'];
      // same files → same cache name: a deploy that changes nothing re-downloads nothing
      const version = createHash('sha1').update(JSON.stringify(files.sort())).digest('hex').slice(0, 10);
      const sw = `// generated at build time
const CACHE = 'island-${version}';
const PRECACHE = ${JSON.stringify([...statics, ...files.map((f) => './' + f)])};
self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const c = await caches.open(CACHE);
      await Promise.all(
        PRECACHE.map(async (u) => {
          // hashed assets never change: reuse the copy from the previous version
          const old = u.includes('/assets/') ? await caches.match(u, { ignoreVary: true }) : null;
          if (old) return c.put(u, old);
          const res = await fetch(u, { cache: 'reload' });
          if (!res.ok) throw new Error('precache ' + u);
          return c.put(u, res);
        }),
      );
      await self.skipWaiting();
    })(),
  );
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
    // fresh page if the network answers within 1.5 s, else the cached app (flaky Wi-Fi shouldn't cost 4 s)
    e.respondWith(
      (async () => {
        const cached = (await caches.match('./index.html', { ignoreVary: true })) || (await caches.match('./', { ignoreVary: true }));
        const net = fetch(req);
        if (!cached) return net;
        return Promise.race([net.then((r) => (r.ok ? r : cached)).catch(() => cached), new Promise((r) => setTimeout(() => r(cached), 1500))]);
      })(),
    );
    return;
  }
  e.respondWith(
    caches.match(req, { ignoreVary: true }).then(
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
