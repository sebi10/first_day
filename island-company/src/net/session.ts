// Which islands this device knows about, and which seat it plays.
import type { Role } from '../sim/types';
import type { IslandStore, Mode } from './store';
import { localStore } from './local';
import { firebaseStore, firebaseConfig } from './firebase';

export type IslandRef = {
  id: string;
  name: string;
  mode: Mode;
  /** seat this device plays; pass-and-play switches between all three */
  role: Role;
  passAndPlay?: boolean;
  lastSeenFeed?: number;
  /** newest crew-board message each seat on this device has seen (pass-and-play has three) */
  lastSeenBoard?: Partial<Record<Role, number>>;
  lastSeenReview?: number;
};

const KEY = 'ic.session.v1';

type Session = { islands: IslandRef[]; active: string | null; playerName: string };

function load(): Session {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { islands: [], active: null, playerName: '', ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { islands: [], active: null, playerName: '' };
}

let session = load();
const subs = new Set<() => void>();

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    /* ignore */
  }
  subs.forEach((f) => f());
}

export const sessions = {
  get: () => session,
  subscribe(f: () => void) {
    subs.add(f);
    return () => subs.delete(f);
  },
  upsert(ref: IslandRef) {
    const i = session.islands.findIndex((x) => x.id === ref.id);
    if (i >= 0) session.islands[i] = { ...session.islands[i], ...ref };
    else session.islands.unshift(ref);
    session.active = ref.id;
    save();
  },
  patch(id: string, p: Partial<IslandRef>) {
    const i = session.islands.findIndex((x) => x.id === id);
    if (i < 0) return;
    session.islands[i] = { ...session.islands[i], ...p };
    save();
  },
  remove(id: string) {
    session.islands = session.islands.filter((x) => x.id !== id);
    if (session.active === id) session.active = null;
    save();
  },
  setActive(id: string | null) {
    session.active = id;
    save();
  },
  setName(name: string) {
    session.playerName = name;
    save();
  },
  ref(id: string) {
    return session.islands.find((x) => x.id === id);
  },
};

export const onlineAvailable = () => !!firebaseConfig();
export const storeFor = (mode: Mode): IslandStore => (mode === 'firebase' ? firebaseStore : localStore);
