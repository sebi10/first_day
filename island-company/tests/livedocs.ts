// Test helper: what migrate() does to a doc an older live build wrote, spelled out by hand (not by calling the code it
// checks), for the skew and migrate tests' "nothing else changes" claims.
//   - v4 (the stage 1 release gate): on a doc an engine below 4 wrote, the week v4 takes over and the credits streak
//     the old rule earned, carried
//   - v5 (G0, the upkeep structure): on a doc an engine below 5 wrote at tier 4-5, once: the builder's warranty dated
//     from when its Harbor and Resort buildings (and the builders' extra cottages from the Harbor on) went up, where it
//     still runs; the grid (and at tier 5 the generator) raised to at least 80 under a warranty from this week; one
//     feed line saying so; the stamp stats.g0From
import { expect } from 'vitest';
import type { IslandState } from '../src/sim/types';

const WEEKS = 26;
const ADDS: Record<number, string[]> = { 4: ['h5', 'h6'], 5: ['h7'] };

export function liveMigrated(doc: IslandState): IslandState {
  const want = structuredClone(doc);
  const W = doc.week;
  if ((doc.engine ?? 0) < 4 && W > 0) {
    want.stats.v4From = W;
    if ((doc.stats.aStreak ?? 0) > 0) want.stats.aCarry = doc.stats.aStreak;
  }
  if ((doc.engine ?? 0) < 5 && W > 0 && doc.tier >= 4) {
    want.stats.g0From = W;
    const reached = doc.stats.tierReachedWeek;
    for (const t of [4, 5]) {
      const at = reached[t];
      if (at === undefined || t > doc.tier || at + WEEKS < W) continue;
      for (const id of ADDS[t]) {
        const a = want.assets.find((x) => x.id === id);
        if (a) a.warrantyUntil = at + WEEKS;
      }
    }
    for (const b of doc.builds ?? []) {
      if (!b.cottage || b.finished === undefined || reached[4] === undefined || b.finished < reached[4] || b.finished + WEEKS < W) continue;
      const a = want.assets.find((x) => x.id === b.cottage);
      if (a) a.warrantyUntil = b.finished + WEEKS;
    }
    for (const a of want.assets)
      if (a.kind === 'grid' || (a.kind === 'generator' && doc.tier >= 5)) {
        a.health = Math.max(a.health, 80);
        a.warrantyUntil = W + WEEKS;
      }
  }
  return want;
}

/** migrate()'s result is liveMigrated(doc) plus, on a G0-migrated doc, one feed line naming the service upgrade */
export function expectLiveMigration(doc: IslandState, got: IslandState, name = doc.id): void {
  const want = liveMigrated(doc);
  if (want.stats.g0From !== undefined) {
    const added = got.feed.filter((e) => !doc.feed.some((d) => d.id === e.id));
    expect(added, name).toHaveLength(1);
    expect(added[0].text, name).toMatch(new RegExp(`^This update brings the Harbor’s new pad-mount transformer and feeder${doc.tier >= 5 ? ' and the Resort’s bigger standby set and transfer switch' : ''}: in at 80 or better, under the builder’s warranty to week ${doc.week + WEEKS}\\.$`));
    want.feed = [...doc.feed, added[0]].slice(-60);
  }
  expect(JSON.stringify(got), name).toBe(JSON.stringify(want));
}
