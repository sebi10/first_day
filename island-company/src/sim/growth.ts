// How far the island has developed, derived purely from game state so every
// device draws the same island. Tiers are the big jumps; these are the small
// ones in between, earned by playing well together week after week, plus the
// crew project visibly under construction while the next tier is being built.
import { ROLES, type IslandState, type Role } from './types';

/** Things the island gains between tiers. Each one is drawn by the island view. */
export const FLOURISHES = {
  garden: 'Flower beds by the office (2 weeks played)',
  benches: 'Benches and lamps along the paths (3 weeks graded B or better)',
  'palm-grove': 'A newly planted palm grove (5 weeks played)',
  'fishing-boats': 'Fishing boats pulled up on the beach (tier 2)',
  'beach-bar': 'A beach bar with umbrellas (tier 2, 8 weeks played, and 6 B+ weeks or strong recent revenue)',
  'paved-paths': 'Dirt paths paved with stone (tier 3)',
  fountain: 'A fountain in the square (2 perfect weeks, 10 weeks played)',
  market: 'Market stalls in the square (12 weeks played)',
  lighthouse: 'A lighthouse on the headland (tier 4)',
  boardwalk: 'A boardwalk along the beach (tier 4, 18 weeks played)',
  yacht: 'A visiting yacht in the bay while revenue is strong (tier 4)',
  observatory: 'A stargazing dome on the peak (26 weeks played)',
  bunting: 'Festive flags across the square (3 A weeks in a row, while it lasts)',
  statue: 'A statue of the three of you (beat the game)',
} as const;
export type Flourish = keyof typeof FLOURISHES;

/** Crew project under way: the next tier's build sites become a construction site. */
export type Construction = {
  tier: number;
  /** which trades have finished their part */
  parts: Record<Role, boolean>;
  /** 0 stakes and lumber · 1 foundations poured · 2 frames up, scaffolding · 3 all parts done (the tier arrives) */
  stage: 0 | 1 | 2 | 3;
};

export type Development = {
  flourishes: Flourish[];
  construction: Construction | null;
  /** 0..1, recent revenue against budget: guests on the beach, boats, busy square */
  prosperity: number;
  /** 0..1, average asset health: fresh paint vs weathered */
  care: number;
  /** a tier that arrived this week or last: ribbons and flags on the new buildings */
  justBuilt: number | null;
  /** last week graded A: confetti, flags */
  celebration: boolean;
};

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export function prosperityOf(s: IslandState) {
  const recent = s.history.slice(-3).filter((h) => h.budget > 0);
  if (!recent.length) return 0.5;
  return clamp01(recent.reduce((n, h) => n + Math.min(1.2, h.revenue / h.budget), 0) / recent.length / 1.2);
}

export function developmentOf(s: IslandState): Development {
  const st = s.stats;
  const weeks = st.totalWeeks;
  const prosperity = prosperityOf(s);
  const f: Flourish[] = [];
  if (weeks >= 2) f.push('garden');
  if (st.weeksBPlus >= 3) f.push('benches');
  if (weeks >= 5) f.push('palm-grove');
  if (s.tier >= 2) f.push('fishing-boats');
  if (s.tier >= 2 && weeks >= 8 && (st.weeksBPlus >= 6 || prosperity >= 0.8)) f.push('beach-bar');
  if (s.tier >= 3) f.push('paved-paths');
  if (st.perfectWeeks >= 2 && weeks >= 10) f.push('fountain');
  if (weeks >= 12) f.push('market');
  if (s.tier >= 4) f.push('lighthouse');
  if (s.tier >= 4 && weeks >= 18) f.push('boardwalk');
  if (s.tier >= 4 && prosperity >= 0.85) f.push('yacht');
  if (weeks >= 26) f.push('observatory');
  if ((st.aStreak ?? 0) >= 3) f.push('bunting');
  if (s.creditsWeek) f.push('statue');

  let construction: Construction | null = null;
  if (s.project) {
    const parts = Object.fromEntries(
      ROLES.map((r) => [r, s.orders.some((o) => o.id === s.project!.orders[r] && o.status === 'done')]),
    ) as Record<Role, boolean>;
    const done = ROLES.filter((r) => parts[r]).length as 0 | 1 | 2 | 3;
    construction = { tier: s.project.tier, parts, stage: done };
  }

  const care = s.assets.length ? clamp01(s.assets.reduce((n, a) => n + a.health, 0) / s.assets.length / 100) : 1;
  const reached = st.tierReachedWeek[s.tier];
  const justBuilt = s.tier > 1 && reached !== undefined && reached >= s.week - 1 ? s.tier : null;
  const celebration = s.history[s.history.length - 1]?.grade === 'A';
  return { flourishes: f, construction, prosperity, care, justBuilt, celebration };
}
