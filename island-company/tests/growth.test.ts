import { describe, expect, it } from 'vitest';
import { simulate, TEAMS } from '../src/sim/bots';
import { apply, createIsland } from '../src/sim/engine';
import { developmentOf } from '../src/sim/growth';
import type { IslandState, Role } from '../src/sim/types';

const NOW = Date.UTC(2026, 8, 26, 10);
function started(): IslandState {
  let s = createIsland({ id: 'g', name: 'Growth', now: NOW, tz: 'Europe/Paris', seed: 3, creator: { uid: 'a', name: 'Ana', role: 'mech' } });
  s = apply(s, { t: 'join', uid: 'b', name: 'Ben', role: 'elec' }, NOW).s;
  s = apply(s, { t: 'join', uid: 'c', name: 'Cy', role: 'fin' }, NOW).s;
  for (const r of ['mech', 'elec', 'fin'] as Role[]) s = apply(s, { t: 'week0Done', role: r }, NOW).s;
  return s;
}

describe('the island develops as you play', () => {
  it('a brand-new island has nothing extra yet', () => {
    const d = developmentOf(started());
    expect(d.flourishes).toEqual([]);
    expect(d.construction).toBeNull();
    expect(d.justBuilt).toBeNull();
  });

  it('small things arrive between tiers, in order', () => {
    const s = started();
    s.stats.totalWeeks = 5;
    s.stats.weeksBPlus = 3;
    expect(developmentOf(s).flourishes).toEqual(['garden', 'benches', 'palm-grove']);
    s.stats.perfectWeeks = 2;
    s.stats.totalWeeks = 12;
    expect(developmentOf(s).flourishes).not.toContain('beach-bar'); // needs tier 2
    expect(developmentOf(s).flourishes).toContain('fountain');
    expect(developmentOf(s).flourishes).toContain('market');
  });

  it('the crew project shows as construction, one stage per finished part', () => {
    let s = started();
    s.stats.weeksBPlus = 4;
    s = apply(s, { t: 'resolve', week: s.week }, s.deadline! + 1).s;
    expect(developmentOf(s).construction).toMatchObject({ tier: 2, stage: 0 });
    const ids = s.project!.orders;
    s = apply(s, { t: 'complete', role: 'mech', orderId: ids.mech!, score: 0.9, perfect: false }, NOW).s;
    expect(developmentOf(s).construction).toMatchObject({ stage: 1, parts: { mech: true, elec: false, fin: false } });
    s = apply(s, { t: 'complete', role: 'elec', orderId: ids.elec!, score: 0.9, perfect: false }, NOW).s;
    s = apply(s, { t: 'complete', role: 'fin', orderId: ids.fin!, score: 0.9, perfect: false }, NOW).s;
    const d = developmentOf(s);
    expect(s.tier).toBe(2);
    expect(d.construction).toBeNull();
    expect(d.justBuilt).toBe(2);
  });

  it('a real season grows the island steadily (paper sim)', () => {
    const { final } = simulate(TEAMS['three friends'], 26, 1);
    const d = developmentOf(final);
    expect(d.flourishes.length).toBeGreaterThanOrEqual(8);
    expect(d.prosperity).toBeGreaterThan(0);
    expect(d.care).toBeGreaterThan(0.3);
  });
});
