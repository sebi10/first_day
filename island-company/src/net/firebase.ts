// Firebase backend (free Spark plan): anonymous auth + one Firestore document
// per island. No Cloud Functions needed: the week is resolved by whichever
// phone notices the deadline first, inside a transaction, so it happens once.
// Loaded lazily so the local/pass-and-play build never pays for the SDK.
import type { FirebaseApp } from 'firebase/app';
import type { Firestore } from 'firebase/firestore';
import { apply, createIsland } from '../sim/engine';
import { safeTz } from '../sim/time';
import type { Action, IslandState } from '../sim/types';
import { newIslandId, type IslandStore, type SyncStatus } from './store';

type Cfg = { apiKey: string; authDomain?: string; projectId: string; appId?: string };

const CFG_KEY = 'ic.firebase.config';

export function firebaseConfig(): Cfg | null {
  const env = import.meta.env;
  if (env.VITE_FB_API_KEY && env.VITE_FB_PROJECT_ID)
    return {
      apiKey: env.VITE_FB_API_KEY,
      authDomain: env.VITE_FB_AUTH_DOMAIN || `${env.VITE_FB_PROJECT_ID}.firebaseapp.com`,
      projectId: env.VITE_FB_PROJECT_ID,
      appId: env.VITE_FB_APP_ID,
    };
  try {
    const raw = localStorage.getItem(CFG_KEY);
    if (raw) {
      const c = JSON.parse(raw) as Cfg;
      if (c.apiKey && c.projectId) return c;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Accepts the object Firebase console shows ("const firebaseConfig = {...}") */
export function saveFirebaseConfig(text: string): boolean {
  const pick = (k: string) => new RegExp(`${k}["']?\\s*:\\s*["']([^"']+)["']`).exec(text)?.[1];
  const cfg = { apiKey: pick('apiKey'), authDomain: pick('authDomain'), projectId: pick('projectId'), appId: pick('appId') };
  if (!cfg.apiKey || !cfg.projectId) return false;
  localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  return true;
}

let ready: Promise<{ app: FirebaseApp; db: Firestore; uid: string; fs: typeof import('firebase/firestore') }> | null = null;

function boot() {
  if (ready) return ready;
  ready = (async () => {
    const cfg = firebaseConfig();
    if (!cfg) throw new Error('Firebase is not configured.');
    const [{ initializeApp }, auth, fs] = await Promise.all([import('firebase/app'), import('firebase/auth'), import('firebase/firestore')]);
    const app = initializeApp(cfg);
    const emulator = import.meta.env.VITE_FB_EMULATOR; // e.g. "localhost" for local testing
    const db = fs.initializeFirestore(app, {
      localCache: emulator ? fs.memoryLocalCache() : fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
    });
    const a = auth.getAuth(app);
    if (emulator) {
      fs.connectFirestoreEmulator(db, emulator, 8080);
      auth.connectAuthEmulator(a, `http://${emulator}:9099`, { disableWarnings: true });
    }
    await auth.setPersistence(a, auth.indexedDBLocalPersistence).catch(() => {});
    const user = a.currentUser ?? (await auth.signInAnonymously(a)).user;
    return { app, db, uid: user.uid, fs };
  })();
  ready.catch(() => (ready = null));
  return ready;
}

// --- offline outbox -------------------------------------------------------
const OUTBOX = (id: string) => `ic.outbox.${id}`;
const readOutbox = (id: string): Action[] => {
  try {
    return JSON.parse(localStorage.getItem(OUTBOX(id)) ?? '[]');
  } catch {
    return [];
  }
};
const writeOutbox = (id: string, a: Action[]) => {
  try {
    localStorage.setItem(OUTBOX(id), JSON.stringify(a));
  } catch {
    /* ignore */
  }
};

const cache = new Map<string, IslandState>();
const subs = new Map<string, Set<(s: IslandState | null) => void>>();
const statusSubs = new Set<(s: SyncStatus) => void>();
let lastError: string | undefined;

function emitStatus() {
  let queued = 0;
  for (const id of subs.keys()) queued += readOutbox(id).length;
  const st = { online: navigator.onLine, queued, error: lastError };
  statusSubs.forEach((f) => f(st));
}

function publish(id: string, s: IslandState) {
  cache.set(id, s);
  try {
    localStorage.setItem(`ic.cache.${id}`, JSON.stringify(s));
  } catch {
    /* ignore */
  }
  subs.get(id)?.forEach((f) => f(s));
}

function cached(id: string): IslandState | null {
  if (cache.has(id)) return cache.get(id)!;
  try {
    const raw = localStorage.getItem(`ic.cache.${id}`);
    return raw ? (JSON.parse(raw) as IslandState) : null;
  } catch {
    return null;
  }
}

async function transact(id: string, a: Action): Promise<{ error?: string; state?: IslandState }> {
  const { db, fs } = await boot();
  const ref = fs.doc(db, 'islands', id);
  let error: string | undefined;
  let state: IslandState | undefined;
  await fs.runTransaction(db, async (tx) => {
    error = undefined;
    state = undefined;
    const snap = await tx.get(ref);
    if (!snap.exists()) {
      error = 'Island not found. Check the invite code.';
      return;
    }
    const s = JSON.parse(snap.data().json as string) as IslandState;
    const r = apply(s, a, Date.now());
    if (r.error) {
      error = r.error;
      return;
    }
    state = r.s;
    if (r.s !== s) tx.set(ref, { json: JSON.stringify(r.s), week: r.s.week, updatedAt: r.s.updatedAt, v: 1 });
  });
  return { error, state };
}

const isNetworkError = (e: unknown) =>
  !navigator.onLine || /unavailable|offline|network|failed-precondition/i.test(String((e as { code?: string })?.code ?? e));

let flushing = false;
async function flush(id: string) {
  if (flushing || !navigator.onLine) return;
  flushing = true;
  try {
    let box = readOutbox(id);
    while (box.length) {
      try {
        const r = await transact(id, box[0]);
        if (r.state) publish(id, r.state);
      } catch (e) {
        if (isNetworkError(e)) break;
      }
      box = box.slice(1); // game-rule rejections are dropped: the island moved on
      writeOutbox(id, box);
    }
  } finally {
    flushing = false;
    emitStatus();
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    for (const id of subs.keys()) void flush(id);
    emitStatus();
  });
  window.addEventListener('offline', emitStatus);
}

export const firebaseStore: IslandStore & { migrate(s: IslandState): Promise<void> } = {
  mode: 'firebase',
  async uid() {
    return (await boot()).uid;
  },
  async create({ name, role, playerName }) {
    const { db, fs, uid } = await boot();
    const id = newIslandId();
    const s = createIsland({ id, name, now: Date.now(), tz: safeTz(), creator: { uid, name: playerName, role } });
    await fs.setDoc(fs.doc(db, 'islands', id), { json: JSON.stringify(s), week: s.week, updatedAt: s.updatedAt, v: 1 });
    publish(id, s);
    return id;
  },
  /** Carry a pass-and-play island over to the server, same id, progress intact. */
  async migrate(state: IslandState) {
    const { db, fs } = await boot();
    const ref = fs.doc(db, 'islands', state.id);
    const existing = await fs.getDoc(ref);
    if (existing.exists()) throw new Error('An online island with this code already exists.');
    await fs.setDoc(ref, { json: JSON.stringify(state), week: state.week, updatedAt: Date.now(), v: 1 });
    publish(state.id, state);
  },
  async load(id) {
    const { db, fs } = await boot();
    try {
      const snap = await fs.getDoc(fs.doc(db, 'islands', id));
      if (!snap.exists()) return null;
      const s = JSON.parse(snap.data().json as string) as IslandState;
      publish(id, s);
      return s;
    } catch {
      return cached(id);
    }
  },
  subscribe(id, cb) {
    let set = subs.get(id);
    if (!set) subs.set(id, (set = new Set()));
    set.add(cb);
    const c = cached(id);
    if (c) cb(c);
    let unsub = () => {};
    let alive = true;
    void boot()
      .then(({ db, fs }) => {
        if (!alive) return;
        unsub = fs.onSnapshot(
          fs.doc(db, 'islands', id),
          (snap) => {
            if (!snap.exists()) return cb(null);
            const s = JSON.parse(snap.data().json as string) as IslandState;
            // re-apply queued offline actions on top so the UI stays optimistic
            let view = s;
            for (const a of readOutbox(id)) view = apply(view, a, Date.now()).s;
            publish(id, view);
            lastError = undefined;
            emitStatus();
          },
          (err) => {
            lastError = err.message;
            emitStatus();
          },
        );
        void flush(id);
      })
      .catch((e) => {
        lastError = String(e?.message ?? e);
        emitStatus();
      });
    return () => {
      alive = false;
      set!.delete(cb);
      unsub();
    };
  },
  async dispatch(id, a) {
    try {
      const r = await transact(id, a);
      if (r.error) return { error: r.error };
      if (r.state) publish(id, r.state);
      return {};
    } catch (e) {
      if (!isNetworkError(e)) return { error: String((e as Error)?.message ?? e) };
      // offline: validate locally, queue, show the result optimistically
      const base = cached(id);
      if (!base) return { error: 'Offline and no local copy yet.' };
      const r = apply(base, a, Date.now());
      if (r.error) return { error: r.error };
      writeOutbox(id, [...readOutbox(id), a]);
      publish(id, r.s);
      emitStatus();
      return {};
    }
  },
  status(cb) {
    statusSubs.add(cb);
    emitStatus();
    return () => statusSubs.delete(cb);
  },
};
