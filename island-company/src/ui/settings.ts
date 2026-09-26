// Per-device settings. Browser storage is fine here: these are per-viewer
// conveniences, never shared game state.
export type Settings = {
  haptics: boolean;
  sound: boolean;
  reduceMotion: boolean;
  leftHanded: boolean;
  timerBoost: boolean; // +50% puzzle time, no score penalty
  ntfyTopic: string; // optional free push via ntfy.sh
};

const KEY = 'ic.settings.v1';
const DEFAULTS: Settings = {
  haptics: true,
  sound: true,
  reduceMotion:
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  leftHanded: false,
  timerBoost: false,
  ntfyTopic: '',
};

let current: Settings = load();
const subs = new Set<(s: Settings) => void>();

function load(): Settings {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export const settings = {
  get: () => current,
  set(patch: Partial<Settings>) {
    current = { ...current, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(current));
    } catch {
      /* private mode: keep in memory */
    }
    subs.forEach((f) => f(current));
  },
  subscribe(f: (s: Settings) => void) {
    subs.add(f);
    return () => subs.delete(f);
  },
};
