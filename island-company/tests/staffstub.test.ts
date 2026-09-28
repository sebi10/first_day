// The NPC staff hooks with their stubs (docs/JOBFLOW.md 15.4, package A): the
// game plays exactly as before the staff update. The standard crew's payroll
// plus the tier's overhead is today's fixed cost; the pilots and housekeepers
// cap nothing; charter, reviews and wear are unchanged; new buildings start at
// today's health; and the staff moves wait for package D. Package D's hooks
// replaced the stubs: STAFF_TEST.stubs puts them back for this file (each test
// file runs in its own module context, so the switch never leaks).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { simulate, TEAMS } from '../src/sim/bots';
import { MODELS, TIERS } from '../src/sim/data';
import { capFleet, fixedNow } from '../src/sim/econ';
import { apply, createIsland } from '../src/sim/engine';
import { migrate } from '../src/sim/migrate';
import {
  BUILDS,
  NPC_ROLES,
  STAFF,
  STAFF_TEST,
  builtShare,
  charterMult,
  housekeepingCap,
  payroll,
  pilotCap,
  pilotOf,
  reviewMult,
  squawkNff,
  standardPayroll,
  staffEffect,
  wageAt,
  wearMult,
} from '../src/sim/staff';
import { ROLES, type Asset, type IslandState } from '../src/sim/types';

vi.setConfig({ testTimeout: 30000 });
beforeAll(() => void (STAFF_TEST.stubs = true));
afterAll(() => void (STAFF_TEST.stubs = false));

const NOW = Date.UTC(2026, 8, 26, 10);
function started(): IslandState {
  let s = createIsland({ id: 'st', name: 'Staff Isle', now: NOW, tz: 'UTC', seed: 9, creator: { uid: 'a', name: 'Ana', role: 'mech' } });
  s = apply(s, { t: 'join', uid: 'b', name: 'Ben', role: 'elec' }, NOW).s;
  s = apply(s, { t: 'join', uid: 'c', name: 'Cy', role: 'fin' }, NOW).s;
  for (const r of ROLES) s = apply(s, { t: 'week0Done', role: r }, NOW).s;
  return s;
}

describe('the staff stubs', () => {
  it('the standard crew’s payroll plus the overhead is the tier’s fixed cost, at every tier', () => {
    expect(TIERS.map((_, i) => standardPayroll(i + 1))).toEqual([760, 1080, 1080, 1260, 1320]);
    for (let tier = 1; tier <= 5; tier++) {
      const t = TIERS[tier - 1];
      expect(t.overhead + standardPayroll(tier), `tier ${tier}`).toBe(t.fixed);
      const s = { ...started(), tier };
      expect(payroll(s)).toBe(standardPayroll(tier));
      expect(fixedNow(s)).toBe(t.fixed);
    }
    for (const r of NPC_ROLES) expect(wageAt(r, 3)).toBe(STAFF.wage[r]);
  });

  it('every hook is neutral: no caps, no multipliers, today’s building health', () => {
    const s = started();
    const twin = s.assets.find((a) => a.kind === 'plane')!;
    expect(pilotCap(s)).toEqual({ guest: Infinity, total: Infinity });
    expect(pilotOf(s, twin.id)).toBeUndefined();
    expect(housekeepingCap(s)).toBe(Infinity);
    expect(charterMult(s)).toBe(1);
    expect(reviewMult(s)).toBe(1);
    expect(wearMult(s, twin.id)).toBe(1);
    expect(squawkNff(s, twin.id)).toBe(0);
    for (let t = 2; t <= 5; t++) expect(builtShare(s, t)).toBe(1);
    const caps = [{ plane: twin, n: 4 }, { plane: { ...twin, id: 'p2', model: 'cargo' } as Asset, n: 4 }];
    expect(capFleet(s, caps)).toEqual(caps);
    const e = staffEffect(s, s.staff![0], 'letGo');
    expect(e.net).toBe(s.staff![0].wage);
    expect(apply(s, { t: 'hire', cand: 'x', week: s.week }, NOW).error).toBe('Hiring opens with the staff update.');
  });

  it('a new island has the tier-1 crew at skill 3 and the first build open; an old one gets the crew for its tier', () => {
    const s = started();
    expect(s.staff!.map((n) => n.role).sort()).toEqual(['builder', 'housekeeper', 'pilot']);
    expect(s.staff!.every((n) => n.skill === 3 && n.wage === STAFF.wage[n.role])).toBe(true);
    expect(new Set(s.staff!.map((n) => n.name)).size).toBe(s.staff!.length);
    expect(s.builds).toEqual([expect.objectContaining({ id: 't2', done: 0, need: BUILDS[0].units.length })]);
    const old = { ...started(), tier: 3 } as IslandState;
    delete old.staff;
    delete old.builds;
    const m = migrate(old);
    const crew = STAFF.standard[2];
    for (const r of NPC_ROLES) expect(m.staff!.filter((n) => n.role === r).length).toBe(crew[r] ?? 0);
    // the builds for tiers up to 4 finished, tier 5's open with nothing done
    expect(m.builds!.filter((b) => b.finished !== undefined).map((b) => b.id)).toEqual(['t2', 't3', 't4']);
    expect(m.builds!.find((b) => b.id === 't5')).toMatchObject({ done: 0, drawn: 0 });
  });

  it('a season on the stubs: every week’s fixed cost is the tier’s, nothing lost to pilots or housekeeping, no hard landings', () => {
    const seen = new Set<number>();
    let weeks = 0;
    simulate(TEAMS['three friends'], 26, 3, (s) => {
      const h = s.history.at(-1)!;
      if (seen.has(h.week)) return;
      seen.add(h.week);
      weeks++;
      // (the week a tier is reached is reported at the old tier, and costs the new one)
      const tier = h.tierUp ?? h.tier;
      expect(h.costs.fixed, `week ${h.week}`).toBe(TIERS[tier - 1].fixed);
      expect(h.costs.payroll).toBe(standardPayroll(tier));
      expect(h.costs.overhead).toBe(TIERS[tier - 1].overhead);
      expect(h.lines.some((l) => /the pilots fly|housekeeping turns over/.test(l.text))).toBe(false);
      expect((s.alerts ?? []).some((a) => a.sym === 'M_HARD_LANDING')).toBe(false);
      // new buildings came in at today's health (60 + 30 x the project's quality), the planes too
      for (const a of s.assets) if (a.touchedWeek === h.week && MODELS[a.model]) expect(a.health).toBeLessThanOrEqual(100);
    });
    expect(weeks).toBe(26);
  });
});
