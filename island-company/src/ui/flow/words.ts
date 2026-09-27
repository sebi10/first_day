// Small shared reads for the job-flow screens: the source icon, the flags a
// row shows beside its stage, the whose-move chip, an asset's name with its
// registration. Pure (no DOM).
import { alertFlags, alertShort } from '../../sim/alerts';
import { islandAircraft } from '../../sim/chain';
import { ROLE_LABEL } from '../../sim/data';
import { alertAog, hazardOn, restrictedBy } from '../../sim/econ';
import { flowStage, type FlowStage } from '../../sim/flow';
import type { Alert, AlertSrc, Asset, IslandState, Role } from '../../sim/types';
import { flowMove } from '../select';

/** the icon (kit.tsx) for where an alert came from */
export const SRC_ICON: Record<AlertSrc, string> = {
  squawk: 'squawk',
  trend: 'trend',
  wear: 'wear',
  due: 'calendar',
  ad: 'calendar',
  finding: 'wrench',
  again: 'alert',
  landing: 'plane',
  guest: 'guest',
  utility: 'meter',
  code: 'board',
  takeoff: 'takeoff',
};

/** "Pilot squawk", "Guest complaint": the source in words (the row's aria label and the sheet's header) */
export const SRC_WORDS: Record<AlertSrc, string> = {
  squawk: 'Pilot squawk',
  trend: 'Trend',
  wear: 'Wear limit',
  due: 'Due item',
  ad: 'Airworthiness directive',
  finding: 'Finding',
  again: 'Written up again',
  landing: 'Hard landing',
  guest: 'Guest complaint',
  utility: 'Utility reading',
  code: 'Code notice',
  takeoff: 'Install take-off',
};

export type Flag = { text: string; tone?: 'rust' | 'sea' | 'palm' | 'ink' };

/** the flags beside an alert's stage: due, MEL, made safe, AOG, restricted, the house shut */
export function flagsOf(s: IslandState, a: Alert): Flag[] {
  const out: Flag[] = [];
  if (a.status === 'closed') return out;
  const o = a.order ? s.orders.find((x) => x.id === a.order) : undefined;
  const done = o?.status === 'done';
  if (!done) out.push(a.due <= s.week ? { text: 'due now', tone: 'rust' } : { text: `due wk ${a.due}` });
  if (a.mel && a.mel.until >= s.week) out.push({ text: `MEL C to wk ${a.mel.until}`, tone: 'sea' });
  else if (a.mel) out.push({ text: 'MEL ran out', tone: 'rust' });
  if (a.safe) out.push({ text: 'SAFE', tone: 'palm' });
  const asset = s.assets.find((x) => x.id === a.assetId);
  if (asset?.kind === 'plane') {
    if (alertAog(s, asset.id)?.id === a.id) out.push({ text: 'AOG', tone: 'rust' });
    if (restrictedBy(s, asset.id)?.id === a.id) out.push({ text: 'RESTRICTED', tone: 'rust' });
  }
  if (asset?.kind === 'house') {
    const hz = hazardOn(s, asset.id);
    if (hz?.id === a.id && !hz.safe) out.push({ text: 'SHUT', tone: 'rust' });
  }
  const f = alertFlags(s, a);
  if (f.hazard && !a.safe && !out.some((x) => x.text === 'SHUT')) out.push({ text: 'hazard', tone: 'rust' });
  return out;
}

/** the whose-move chip on a row: the tech's own move reads dark, a crewmate's in their colour */
export function moveChip(s: IslandState, a: Alert, me: Role): { chip: string; who: Role | null; mine: boolean; stage: FlowStage; text: string } {
  const m = flowMove(s, a);
  const stage = flowStage(s, a);
  return { chip: m.chip, who: m.who, mine: m.who === me, stage, text: m.text };
}

/** "Twin N-12 · N412IC" for a plane, the house's or the grid's name otherwise */
export function assetTitle(s: IslandState, asset: Asset | undefined): string {
  if (!asset) return 'Unknown asset';
  if (asset.kind !== 'plane') return asset.name;
  const ac = islandAircraft(s.seed, asset);
  return `${asset.name} · ${ac.registration}`;
}

export const nameOf = (s: IslandState, r: Role) => s.players[r]?.name ?? ROLE_LABEL[r];

/** the alert in a few words, capitalised: "Brake pedal soft" */
export const shortOf = (s: IslandState, a: Alert) => {
  const t = alertShort(s, a);
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** sessionStorage, every access guarded (private windows, blocked storage) */
export const session = {
  get<T>(key: string): T | null {
    try {
      const raw = sessionStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
  set(key: string, v: unknown) {
    try {
      sessionStorage.setItem(key, JSON.stringify(v));
    } catch {
      /* no storage: the draft lives in memory until the sheet closes */
    }
  },
  del(key: string) {
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

/** localStorage for per-viewer conveniences (a folded list, a sheet seen once), every access guarded */
export const local = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, v: string) {
    try {
      localStorage.setItem(key, v);
    } catch {
      /* ignore */
    }
  },
};

/** when a bought line lands, as a tech reads it (a PO's eta is the week whose resolve delivers it) */
export const landsWords = (week: number, eta: number) => (eta <= week ? 'lands tonight' : eta === week + 1 ? 'lands next week' : `lands wk ${eta}`);

/** the draft's key: per island and alert */
export const draftKey = (islandId: string, alertId: string) => `jf:${islandId}:${alertId}`;
