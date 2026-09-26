import { COSMETICS, MAX_LEVEL, TIERS, TOOLS, xpForLevel } from './data';
import type { IslandState, Player, Role } from './types';

export function levelOf(xp: number): number {
  let L = 1;
  while (L < MAX_LEVEL && xp >= xpForLevel(L + 1)) L++;
  return L;
}

export function levelProgress(xp: number) {
  const L = levelOf(xp);
  if (L >= MAX_LEVEL) return { level: L, into: 1, need: 1, pct: 1 };
  const a = xpForLevel(L);
  const b = xpForLevel(L + 1);
  return { level: L, into: xp - a, need: b - a, pct: (xp - a) / (b - a) };
}

export const toolsFor = (role: Role, xp: number) => TOOLS[role].filter((t) => levelOf(xp) >= t.level).map((t) => t.id);
export const cosmeticsFor = (role: Role, xp: number) => COSMETICS[role].filter((c) => levelOf(xp) >= c.level);

/** 100 XP per tier-1 order, +50 per tier; perfect +25%; scaled by credit */
export function orderXp(tier: number, credit: number, perfect: boolean) {
  return Math.round((100 + 50 * (tier - 1)) * Math.min(1, credit) * (perfect ? 1.25 : 1));
}

export const isMentor = (p: Player | undefined) => !!p && levelOf(p.xp) >= 30;

/** What the next tier needs, as a short checklist for the UI */
export function nextTierProgress(s: IslandState): { name: string; items: { label: string; ok: boolean }[] } | null {
  if (s.tier >= 5) return null;
  const next = TIERS[s.tier];
  const st = s.stats;
  const recentClean = st.recentIncidents.length >= 4 && st.recentIncidents.every((n) => n === 0);
  switch (s.tier + 1) {
    case 2:
      return { name: next.name, items: [{ label: `Weeks graded B+ ${Math.min(st.weeksBPlus, 4)}/4`, ok: st.weeksBPlus >= 4 }] };
    case 3:
      return {
        name: next.name,
        items: [
          { label: `Cash $${Math.round(s.cash).toLocaleString('en-US')} / $25,000`, ok: s.cash >= 25000 },
          { label: `Clean weeks ${cleanStreak(st.recentIncidents)}/4`, ok: recentClean },
        ],
      };
    case 4:
      return {
        name: next.name,
        items: [
          { label: `Weeks ${Math.min(st.totalWeeks, 12)}/12`, ok: st.totalWeeks >= 12 },
          { label: `Perfect weeks ${Math.min(st.perfectWeeks, 2)}/2`, ok: st.perfectWeeks >= 2 },
        ],
      };
    case 5:
      return {
        name: next.name,
        items: [
          { label: `Weeks ${Math.min(st.totalWeeks, 24)}/24`, ok: st.totalWeeks >= 24 },
          { label: `Cash $${Math.round(s.cash).toLocaleString('en-US')} / $100,000`, ok: s.cash >= 100000 },
        ],
      };
  }
  return null;
}

function cleanStreak(recent: number[]) {
  let n = 0;
  for (let i = recent.length - 1; i >= 0 && recent[i] === 0; i--) n++;
  return Math.min(4, n);
}

export function tierUnlocked(s: IslandState): boolean {
  const p = nextTierProgress(s);
  return !!p && p.items.every((i) => i.ok);
}
