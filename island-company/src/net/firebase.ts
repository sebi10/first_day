// Firebase backend (free Spark plan): anonymous auth + one Firestore document
// per island. No Cloud Functions needed: the week is resolved by whichever
// phone notices the deadline first, inside a transaction, so it happens once.
// Loaded lazily so the local/pass-and-play build never pays for the SDK.
import type { FirebaseApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import { apply, createIsland } from '../sim/engine';
import { safeTz } from '../sim/time';
import type { Action, IslandState } from '../sim/types';
import { newIslandId, type IslandStore, type SyncStatus } from './store';

type Cfg = { apiKey: string; authDomain?: string; projectId: string; appId?: string };

const CFG_KEY = 'ic.firebase.config';

/** True when the deploy baked the project config in: players never need the setup screen. */
export const configBakedIn = () => !!(import.meta.env.VITE_FB_API_KEY && import.meta.env.VITE_FB_PROJECT_ID);

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

type Boot = {
  app: FirebaseApp;
  db: Firestore;
  fs: typeof import('firebase/firestore');
  auth: Auth;
  authApi: typeof import('firebase/auth');
};
let ready: Promise<Boot> | null = null;
let currentUid: string | null = null;
const uidSubs = new Set<(uid: string) => void>();
const setUid = (uid: string) => {
  if (uid === currentUid) return;
  currentUid = uid;
  uidSubs.forEach((f) => f(uid));
};

function boot() {
  if (ready) return ready;
  ready = (async () => {
    const cfg = firebaseConfig();
    if (!cfg) throw new Error('Firebase is not configured.');
    const [{ initializeApp }, authApi, fs] = await Promise.all([import('firebase/app'), import('firebase/auth'), import('firebase/firestore')]);
    const app = initializeApp(cfg);
    const emulator = import.meta.env.VITE_FB_EMULATOR; // e.g. "localhost" for local testing
    const db = fs.initializeFirestore(app, {
      localCache: emulator ? fs.memoryLocalCache() : fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
    });
    const auth = authApi.getAuth(app);
    if (emulator) {
      fs.connectFirestoreEmulator(db, emulator, 8080);
      authApi.connectAuthEmulator(auth, `http://${emulator}:9099`, { disableWarnings: true });
    }
    await authApi.setPersistence(auth, authApi.indexedDBLocalPersistence).catch(() => {});
    // restore the saved session before deciding whether to sign in
    await auth.authStateReady();
    const b: Boot = { app, db, fs, auth, authApi };
    // Stay signed in. If the session disappears (the account was deleted in the
    // console, the browser cleared storage, the token was revoked), sign in again;
    // the device then relinks to its seat with the seat code.
    authApi.onAuthStateChanged(auth, (u) => {
      if (u) setUid(u.uid);
      else void ensureUser(b).catch(() => {});
    });
    await ensureUser(b);
    return b;
  })();
  ready.catch(() => (ready = null));
  return ready;
}

let signingIn: Promise<void> | null = null;
/** One sign-in at a time: concurrent callers share it, so a device never makes two accounts. */
async function ensureUser(b: Boot) {
  if (b.auth.currentUser) return setUid(b.auth.currentUser.uid);
  signingIn ??= b.authApi
    .signInAnonymously(b.auth)
    .then((c) => setUid(c.user.uid))
    .finally(() => (signingIn = null));
  await signingIn;
}

const isPermissionError = (e: unknown) =>
  /permission-denied|insufficient permissions/i.test(`${(e as { code?: string })?.code ?? ''} ${(e as Error)?.message ?? e}`);

/**
 * Run a server call with a live session. "Permission denied" from these rules
 * almost always means the session died (deleted account, expired token), so
 * refresh or sign in again and retry once before giving up.
 */
async function withSession<T>(fn: (b: Boot) => Promise<T>): Promise<T> {
  const b = await boot();
  await ensureUser(b);
  try {
    return await fn(b);
  } catch (e) {
    if (!isPermissionError(e)) throw e;
    await b.auth.currentUser?.getIdToken(true).catch(() => {}); // a dead account signs out here
    await ensureUser(b);
    return fn(b);
  }
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

/**
 * The island document's format version. firestore.rules accepts writes of this
 * version only, and the rules and the hosting deploy together: a tab still
 * running an older build gets permission-denied (and reloads, see flush) instead
 * of writing with an older engine. Raise it with the rules when an old engine
 * would corrupt a new island (v2: the part chain and the ground power carts).
 */
const DOC_VERSION = 2;

/** a write refused by the rules: this build is older than the island's (or the rules'); reload to the new one */
const isStaleClient = (e: unknown) => /permission-denied/i.test(String((e as { code?: string })?.code ?? e));

async function transact(id: string, a: Action): Promise<{ error?: string; state?: IslandState }> {
  let error: string | undefined;
  let state: IslandState | undefined;
  await withSession(async ({ db, fs }) => {
   const ref = fs.doc(db, 'islands', id);
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
    if (r.s !== s) tx.set(ref, { json: JSON.stringify(r.s), week: r.s.week, updatedAt: r.s.updatedAt, v: DOC_VERSION });
   });
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
    const dropped: string[] = [];
    while (box.length) {
      try {
        const r = await transact(id, box[0]);
        if (r.state) publish(id, r.state);
        if (r.error) dropped.push(r.error);
      } catch (e) {
        if (isNetworkError(e)) break;
        // the rules want a newer build: keep the move queued and reload to it
        if (isStaleClient(e)) {
          window.dispatchEvent(new CustomEvent('ic:stale'));
          break;
        }
        dropped.push(String((e as Error)?.message ?? e));
      }
      box = box.slice(1); // game-rule rejections are dropped (the island moved on), but the player hears about it
      writeOutbox(id, box);
    }
    if (dropped.length) window.dispatchEvent(new CustomEvent('ic:dropped', { detail: { id, errors: dropped } }));
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
    await ensureUser(await boot());
    return currentUid!;
  },
  onUid(cb) {
    uidSubs.add(cb);
    if (currentUid) cb(currentUid);
    return () => uidSubs.delete(cb);
  },
  async create({ name, role, playerName }) {
    const id = newIslandId();
    const s = await withSession(async ({ db, fs }) => {
      const s = createIsland({ id, name, now: Date.now(), tz: safeTz(), creator: { uid: currentUid!, name: playerName, role } });
      await fs.setDoc(fs.doc(db, 'islands', id), { json: JSON.stringify(s), week: s.week, updatedAt: s.updatedAt, v: DOC_VERSION });
      return s;
    });
    publish(id, s);
    return id;
  },
  /** Carry a pass-and-play island over to the server, same id, progress intact. */
  async migrate(state: IslandState) {
    await withSession(async ({ db, fs }) => {
      const ref = fs.doc(db, 'islands', state.id);
      const existing = await fs.getDoc(ref);
      if (existing.exists()) throw new Error('An online island with this code already exists.');
      await fs.setDoc(ref, { json: JSON.stringify(state), week: state.week, updatedAt: Date.now(), v: DOC_VERSION });
    });
    publish(state.id, state);
  },
  async load(id) {
    try {
      const snap = await withSession(({ db, fs }) => fs.getDoc(fs.doc(db, 'islands', id)));
      if (!snap.exists()) return null;
      const s = JSON.parse(snap.data().json as string) as IslandState;
      publish(id, s);
      return s;
    } catch (e) {
      if (isNetworkError(e)) return cached(id);
      throw e;
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
    let retries = 0;
    const listen = () =>
     void boot()
      .then(async (b) => {
        await ensureUser(b);
        const { db, fs } = b;
        if (!alive) return;
        unsub = fs.onSnapshot(
          fs.doc(db, 'islands', id),
          (snap) => {
            retries = 0;
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
            // a dead session ends the listener: sign in again and listen again (a few tries)
            if (isPermissionError(err) && retries++ < 3 && alive) {
              void b.auth.currentUser?.getIdToken(true).catch(() => {}).then(() => ensureUser(b)).then(() => setTimeout(listen, 800 * retries));
              return;
            }
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
    listen();
    return () => {
      alive = false;
      set!.delete(cb);
      unsub();
    };
  },
  async dispatch(id, a) {
    // offline: validate locally, queue, show the result optimistically
    const queue = (from = cached(id)) => {
      const base = from;
      if (!base) return { error: 'Offline and no local copy yet.' };
      const r = apply(base, a, Date.now());
      if (r.error) return { error: r.error };
      writeOutbox(id, [...readOutbox(id), a]);
      publish(id, r.s);
      emitStatus();
      return {};
    };
    // known offline: don't wait seconds for a transaction to time out
    if (!navigator.onLine) return queue();
    // online: show the move now (same reducer), the server confirms or corrects a round trip later
    const base = cached(id);
    if (base) {
      const local = apply(base, a, Date.now());
      if (local.error) return { error: local.error };
      if (local.s !== base) publish(id, local.s);
    }
    try {
      const r = await transact(id, a);
      if (r.error) {
        void firebaseStore.load(id); // roll back to the server's truth
        return { error: r.error };
      }
      if (r.state) publish(id, r.state);
      return {};
    } catch (e) {
      if (!isNetworkError(e)) {
        void firebaseStore.load(id);
        return { error: String((e as Error)?.message ?? e) };
      }
      return queue(base); // queue on top of the pre-move state, not the optimistic one
    }
  },
  status(cb) {
    statusSubs.add(cb);
    emitStatus();
    return () => statusSubs.delete(cb);
  },
};
