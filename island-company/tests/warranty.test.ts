// G0, the upkeep structure (the builder's warranty, with the service upgrade): new construction from the Harbor
// wears slowly (data WARRANTY), the Harbor's new service and the Resort's standby set come under the same warranty, and
// the analyst buys renovations (data RENO): the builders renovate a worn house, it closes while they work, and it
// opens when the electrician signs off its final.
import { describe, expect, it, vi } from 'vitest';
import { simulate, TEAMS } from '../src/sim/bots';
import { ECON, LATE, RENO, WARRANTY } from '../src/sim/data';
import { decayOf, houseRentable, renovating, urgency } from '../src/sim/econ';
import { apply } from '../src/sim/engine';
import { renoCost } from '../src/sim/staff';
import type { IslandState } from '../src/sim/types';

vi.setConfig({ testTimeout: 30000 });

const NOW = Date.UTC(2026, 8, 30, 10);

describe('the builder’s warranty', () => {
  it('a building under its warranty decays WARRANTY.decay a week; out of it, as before', () => {
    expect(decayOf({ tier: 5, week: 30 }, { kind: 'house', health: 90, warrantyUntil: 30 })).toBe(WARRANTY.decay);
    expect(decayOf({ tier: 3, week: 12 }, { kind: 'generator', health: 50, warrantyUntil: 20 })).toBe(WARRANTY.decay);
    expect(decayOf({ tier: 5, week: 31 }, { kind: 'house', health: 90, warrantyUntil: 30 })).toBe(LATE.healthyDecay.decay);
    expect(decayOf({ tier: 4, week: 31 }, { kind: 'house', health: 50, warrantyUntil: 30 })).toBe(ECON.decay);
    expect(decayOf({ tier: 3, week: 31 }, { kind: 'house', health: 90 })).toBe(ECON.decay);
    // (a house dark all week decays as any other: A0's (g) was dropped in its review round 1)
    expect(decayOf({ tier: 4, week: 20 }, { kind: 'house', health: 90, warrantyUntil: 30 }, true)).toBe(WARRANTY.decay);
  });

  it('a tier’s new buildings come with it (from WARRANTY.fromTier), the grid with the Harbor’s service upgrade and the generator with the Resort’s; the planes never', () => {
    const { final: s } = simulate(TEAMS['all good'], 22, 1);
    expect(s.tier).toBeGreaterThanOrEqual(4);
    const reached = s.stats.tierReachedWeek;
    for (const a of s.assets) {
      const add = [2, 3, 4, 5].find((t) => reached[t] !== undefined && ({ 2: ['h3', 'h4', 'p2'], 3: ['gen'], 4: ['p3', 'h5', 'h6'], 5: ['h7'] } as Record<number, string[]>)[t].includes(a.id));
      const building = a.kind === 'house' || a.kind === 'generator';
      // (a renovated house carries its renovation's shorter warranty instead)
      const renovated = (s.builds ?? []).some((b) => b.reno === a.id && b.signed !== undefined);
      if (renovated) continue;
      // the service upgrade: the grid at the Harbor, the generator at the Resort (a later one replaces an earlier warranty)
      const svc = a.kind === 'grid' && WARRANTY.service.grid ? 4 : a.kind === 'generator' && WARRANTY.service.gen && reached[5] !== undefined ? 5 : undefined;
      if (svc !== undefined && reached[svc] !== undefined) expect(a.warrantyUntil, a.id).toBe(reached[svc]! + WARRANTY.weeks);
      else if (building && add !== undefined && add >= WARRANTY.fromTier) expect(a.warrantyUntil, a.id).toBe(reached[add]! + WARRANTY.weeks);
      else expect(a.warrantyUntil, a.id).toBeUndefined();
    }
  });
});

describe('renovations', () => {
  /** a Resort from the sim, with cash, a builder and a worn cottage out of its warranty */
  function resort(): IslandState {
    const s = simulate(TEAMS['all good'], 30, 2).final;
    expect(s.tier).toBe(5);
    s.cash = 100_000;
    const h = s.assets.find((a) => a.id === 'h1')!;
    h.health = 45;
    delete h.warrantyUntil;
    s.builds = (s.builds ?? []).filter((b) => !b.reno);
    return s;
  }

  it('the analyst orders one: the package is paid, the build queued; refused below tier 4, on a house in good shape, twice, or without the cash', () => {
    const s = resort();
    const cash = s.cash;
    const r = apply(s, { t: 'build', what: 'reno', asset: 'h1', week: s.week }, NOW);
    expect(r.error).toBeUndefined();
    expect(r.s.cash).toBe(cash - renoCost({ model: 'cottage' }).pkg);
    const b = r.s.builds!.find((x) => x.reno === 'h1')!;
    expect(b.need).toBe(RENO.units.length);
    // it isn't closed until the builders start
    expect(renovating(r.s, 'h1')).toBe(false);
    expect(apply(r.s, { t: 'build', what: 'reno', asset: 'h1', week: s.week }, NOW).error).toMatch(/already/);
    const fine = resort();
    fine.assets.find((a) => a.id === 'h2')!.health = RENO.maxHealth + 1;
    expect(apply(fine, { t: 'build', what: 'reno', asset: 'h2', week: fine.week }, NOW).error).toMatch(/good shape/);
    const poor = resort();
    poor.cash = 1000;
    expect(apply(poor, { t: 'build', what: 'reno', asset: 'h1', week: poor.week }, NOW).error).toMatch(/Not enough cash/);
    const early = resort();
    early.tier = RENO.fromTier - 1;
    expect(apply(early, { t: 'build', what: 'reno', asset: 'h1', week: early.week }, NOW).error).toMatch(/open at tier/);
  });

  it('in play: the house closes while the builders work, its final is the electrician’s (urgent), and it opens under the renovation’s warranty', () => {
    let signed = 0;
    let closedWeeks = 0;
    for (const seed of [1, 2, 3]) {
      const seen = new Set<string>();
      simulate(TEAMS['three friends'], 45, seed, (s) => {
        const W = s.week - 1;
        for (const b of s.builds ?? []) {
          if (!b.reno) continue;
          const h = s.assets.find((a) => a.id === b.reno)!;
          if (renovating(s, h.id)) {
            closedWeeks++;
            expect(houseRentable(s, h)).toBe(false);
          }
          // the builders are done: the final is on the electrician's list, above an ordinary job
          if (b.finished !== undefined && b.signed === undefined) {
            const al = (s.alerts ?? []).find((a) => a.assetId === h.id && a.status !== 'closed' && a.kind === 'codeprep');
            expect(al, `${seed}: ${h.id}'s final`).toBeDefined();
            const o = al?.order ? s.orders.find((x) => x.id === al.order) : undefined;
            if (o) expect(urgency(s, o)).toBeGreaterThanOrEqual(RENO.finalUrgency);
          }
          if (b.signed === W && !seen.has(b.id)) {
            seen.add(b.id);
            signed++;
            expect(h.warrantyUntil).toBe(W + RENO.warranty);
            expect(h.health).toBeGreaterThanOrEqual(RENO.health - 10);
            expect(h.inspectionUntil!).toBeGreaterThan(W);
            expect(renovating(s, h.id)).toBe(false);
          }
        }
      });
    }
    expect(signed).toBeGreaterThan(0);
    expect(closedWeeks).toBeGreaterThan(0);
  });

  it('nobody wins alone: solo, absent and nobody crews stay at tier 1 through 64 weeks, renovate nothing and never reach the credits', () => {
    for (const name of ['solo mech', 'solo elec', 'solo fin', 'nobody', 'mech absent', 'elec absent', 'fin absent']) {
      const { final } = simulate(TEAMS[name], 64, 1);
      expect(final.tier, name).toBe(1);
      expect(final.creditsWeek, name).toBeUndefined();
      expect((final.builds ?? []).some((b) => b.reno), name).toBe(false);
    }
  }, 120_000);
});
