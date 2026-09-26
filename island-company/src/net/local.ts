// Local backend: the island lives in this browser's storage. Used for
// pass-and-play (three friends, one phone) and as the offline demo.
import { apply, createIsland } from '../sim/engine';
import { safeTz } from '../sim/time';
import { ROLES, type IslandState } from '../sim/types';
import { newIslandId, PP_UID, type IslandStore, type SyncStatus } from './store';

const KEY = (id: string) => `ic.local.${id}`;
const listeners = new Map<string, Set<(s: IslandState | null) => void>>();
const memory = new Map<string, IslandState>();

function read(id: string): IslandState | null {
  if (memory.has(id)) return memory.get(id)!;
  try {
    const raw = localStorage.getItem(KEY(id));
    if (!raw) return null;
    const s = JSON.parse(raw) as IslandState;
    memory.set(id, s);
    return s;
  } catch {
    return null;
  }
}

function write(s: IslandState) {
  memory.set(s.id, s);
  try {
    localStorage.setItem(KEY(s.id), JSON.stringify(s));
  } catch {
    /* storage full / private mode: memory only */
  }
  listeners.get(s.id)?.forEach((f) => f(s));
}

if (typeof window !== 'undefined') {
  // another tab of the same browser changed the island
  window.addEventListener('storage', (e) => {
    if (!e.key?.startsWith('ic.local.') || !e.newValue) return;
    const s = JSON.parse(e.newValue) as IslandState;
    memory.set(s.id, s);
    listeners.get(s.id)?.forEach((f) => f(s));
  });
}

export const localStore: IslandStore = {
  mode: 'local',
  async uid() {
    return 'local-device';
  },
  async create({ name, role, playerName, passAndPlay }) {
    const id = newIslandId();
    const now = Date.now();
    let s = createIsland({ id, name, now, tz: safeTz(), creator: { uid: passAndPlay ? PP_UID[role] : 'local-device', name: playerName, role } });
    if (passAndPlay) {
      for (const r of ROLES) {
        if (r === role) continue;
        s = apply(s, { t: 'join', uid: PP_UID[r], name: r === 'mech' ? 'Mechanic' : r === 'elec' ? 'Electrician' : 'Analyst', role: r }, now).s;
      }
    }
    write(s);
    return id;
  },
  async load(id) {
    return read(id);
  },
  subscribe(id, cb) {
    let set = listeners.get(id);
    if (!set) listeners.set(id, (set = new Set()));
    set.add(cb);
    cb(read(id));
    return () => set!.delete(cb);
  },
  async dispatch(id, a) {
    const s = read(id);
    if (!s) return { error: 'Island not found on this device.' };
    const r = apply(s, a, Date.now());
    if (r.error) return { error: r.error };
    if (r.s !== s) write(r.s);
    return {};
  },
  status(cb: (s: SyncStatus) => void) {
    cb({ online: true, queued: 0 });
    return () => {};
  },
};

export function deleteLocal(id: string) {
  memory.delete(id);
  try {
    localStorage.removeItem(KEY(id));
  } catch {
    /* ignore */
  }
}
