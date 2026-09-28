// Report a problem (docs/EXPANSION.md 6.5, 7, 13.1 stage 2): from week 3, one flag
// a week per seat and one received per trade, never on your own trade's asset (the
// generator is both techs': neither flags it). It raises a write-up alert for the
// trade that owns the asset, in the flagger's name, drawn only from what a
// layperson could see; a healthy asset gives a no-fault write-up that takes no slot
// but costs a close. A flag never gives a load sheet, a 100-hr or code prep.
import { describe, expect, it, vi } from 'vitest';
import { SYMPTOMS, symptomText } from '../src/sim/alerts';
import { FLAG, flagCheck, flagPick, openWork } from '../src/sim/checks';
import { REPORT } from '../src/sim/data';
import { apply, createIsland } from '../src/sim/engine';
import { addStarter } from '../src/sim/stock';
import { ROLES, type IslandState } from '../src/sim/types';
import { flaggable } from '../src/ui/select';

vi.setConfig({ testTimeout: 30000 });

const NOW = Date.UTC(2026, 8, 28, 12);
let clock = NOW;

function island(seed = 5, health = 70, tier = 3): IslandState {
  let s = createIsland({ id: `fl${seed}`, name: 'Flag Isle', now: NOW, tz: 'Europe/Paris', seed, creator: { uid: 'a', name: 'Ana', role: 'mech' } });
  s = apply(s, { t: 'join', uid: 'b', name: 'Ben', role: 'elec' }, NOW).s;
  s = apply(s, { t: 'join', uid: 'c', name: 'Cy', role: 'fin' }, NOW).s;
  for (const r of ROLES) s = apply(s, { t: 'week0Done', role: r }, NOW).s;
  s.week = 6;
  s.tier = tier;
  s.cash = 20000;
  s.assets.push({ id: 'gen', kind: 'generator', model: 'gen', name: 'Generator house', health, touchedWeek: 0 });
  addStarter(s, tier);
  for (const a of s.assets) {
    a.health = health;
    if (a.kind === 'house') a.inspectionUntil = 40;
    if (a.kind === 'plane') a.sinceInspection = 0;
  }
  s.orders = [];
  s.alerts = [];
  return s;
}
const ok = (s: IslandState, a: Parameters<typeof apply>[1]) => {
  const r = apply(s, a, ++clock);
  expect(r.error, JSON.stringify(a)).toBeUndefined();
  return r.s;
};
const err = (s: IslandState, a: Parameters<typeof apply>[1]) => apply(s, a, ++clock).error;

describe('who can flag what (6.5)', () => {
  it('from week 3, one a week per seat, on a turn still open', () => {
    const early = island();
    early.week = REPORT.fromWeek - 1;
    expect(REPORT.fromWeek).toBe(3);
    expect(err(early, { t: 'flag', role: 'fin', assetId: 'p1', week: early.week })).toBe('Report a problem opens in week 3.');
    let s = island();
    s = ok(s, { t: 'flag', role: 'fin', assetId: 'p1', week: s.week });
    expect(s.flagged).toEqual({ fin: 6 });
    expect(err(s, { t: 'flag', role: 'fin', assetId: 'h1', week: s.week })).toMatch(/One report a week/);
    let e = island();
    e = ok(e, { t: 'endTurn', role: 'fin', week: e.week });
    expect(err(e, { t: 'flag', role: 'fin', assetId: 'p1', week: e.week })).toMatch(/turn is over/);
    expect(err(island(), { t: 'flag', role: 'fin', assetId: 'p1', week: 5 })).toMatch(/closed before that synced/);
  });

  it("never on your own trade's asset; the generator is both techs' (the analyst's flag goes to one of them)", () => {
    const s = island();
    expect(flaggable(s, 'mech', 'p1')).toMatchObject({ ok: false, why: "It's your trade's: write it up instead." });
    expect(flaggable(s, 'elec', 'h1')).toMatchObject({ ok: false });
    expect(flaggable(s, 'elec', 'g1')).toMatchObject({ ok: false });
    expect(flaggable(s, 'mech', 'gen')).toMatchObject({ ok: false, why: "The generator is both techs': write it up instead." });
    expect(flaggable(s, 'elec', 'gen')).toMatchObject({ ok: false });
    expect(flaggable(s, 'mech', 'h1')).toEqual({ ok: true, to: 'elec' });
    expect(flaggable(s, 'elec', 'p1')).toEqual({ ok: true, to: 'mech' });
    expect(flaggable(s, 'fin', 'p1')).toEqual({ ok: true, to: 'mech' });
    expect(flaggable(s, 'fin', 'h1')).toEqual({ ok: true, to: 'elec' });
    const g = flaggable(s, 'fin', 'gen');
    expect(g.ok).toBe(true);
    expect(['mech', 'elec']).toContain((g as { to: string }).to);
    expect(flaggable(s, 'fin', 'nope')).toMatchObject({ ok: false, why: 'No such asset.' });
  });

  it('each trade receives one flag a week: the second flagger is told to message instead', () => {
    let s = island();
    s = ok(s, { t: 'flag', role: 'fin', assetId: 'h1', week: s.week });
    expect(flaggable(s, 'mech', 'h2')).toEqual({ ok: false, why: 'Ben already has a flag this week: message Ben instead.' });
    // the other trade can still receive one
    expect(flaggable(s, 'elec', 'p1')).toEqual({ ok: true, to: 'mech' });
    // next week it's open again
    s.week = 7;
    expect(flaggable(s, 'mech', 'h2')).toEqual({ ok: true, to: 'elec' });
  });
});

describe('what a flag raises (6.5)', () => {
  it('a twin at 70: a real alert for the mechanic, a pilot-visible symptom, in the flagger’s name; it counts in his open work', () => {
    let s = island(5, 70);
    const before = openWork(s, 'mech').open;
    s = ok(s, { t: 'flag', role: 'fin', assetId: 'p1', week: s.week });
    const a = s.alerts!.at(-1)!;
    expect(a).toMatchObject({ role: 'mech', assetId: 'p1', src: 'flag', who: 'Cy', status: 'open' });
    expect(a.cause).toBeGreaterThanOrEqual(0);
    expect(SYMPTOMS[a.sym].src).toBe('squawk');
    expect(symptomText(s, a)).toMatch(/^Flagged by Cy on Twin N-12: /);
    expect(openWork(s, 'mech').open).toBe(before + 1);
    expect(s.feed.at(-1)!.text).toBe("Cy flagged Twin N-12 for Ana: it's on the alert list.");
  });

  it('a healthy twin: a no-fault write-up that takes no slot, and costs the mechanic a close', () => {
    let s = island(5, 100);
    const before = openWork(s, 'mech').open;
    s = ok(s, { t: 'flag', role: 'elec', assetId: 'p1', week: s.week });
    const a = s.alerts!.at(-1)!;
    expect(a).toMatchObject({ role: 'mech', src: 'flag', cause: -1, kind: 'nff', who: 'Ben' });
    expect(openWork(s, 'mech').open).toBe(before);
    const closed = ok(s, { t: 'nff', role: 'mech', alert: a.id, week: s.week });
    expect(closed.alerts!.find((x) => x.id === a.id)!.closed?.how).toBe('nff');
  });

  it("a guest's words lose their \"Guest at …:\" in a crewmate's flag", () => {
    let s = island(8, 70);
    s = ok(s, { t: 'flag', role: 'fin', assetId: 'h2', week: s.week });
    const a = s.alerts!.at(-1)!;
    expect(symptomText(s, a)).toMatch(/^Flagged by Cy on Cottage 2: /);
    expect(symptomText(s, a)).not.toMatch(/Guest at/);
  });

  it('a flag never gives a load sheet, a 100-hr or code prep, and only what a layperson could see', () => {
    for (let seed = 1; seed <= 80; seed++) {
      const s = island(seed, 30 + (seed % 70), 3);
      for (const p of s.assets) if (p.kind === 'plane') p.sinceInspection = 11;
      for (const h of s.assets) if (h.kind === 'house') h.inspectionUntil = s.week + 1;
      for (const role of ['fin', 'mech', 'elec'] as const)
        for (const a of s.assets) {
          const f = flagCheck(s, role, a.id);
          if (!f.ok) continue;
          const pick = flagPick(s, role, a, f.to)!;
          expect(pick, `${seed} ${role} ${a.id}`).not.toBeNull();
          const sym = SYMPTOMS[pick.sym];
          expect(FLAG.srcs).toContain(sym.src);
          expect(sym.role).toBe(f.to);
          expect(sym.auto).toBeFalsy();
          const kind = pick.cause >= 0 ? sym.causes[pick.cause].kind : 'nff';
          expect(FLAG.never).not.toContain(kind);
        }
    }
  });

  it('the review names each flag, blind', () => {
    let s = island(5, 70);
    s = ok(s, { t: 'flag', role: 'fin', assetId: 'p1', week: s.week });
    for (const r of ROLES) if (!s.turns[r]?.ended) s = ok(s, { t: 'endTurn', role: r, week: 6 });
    expect(s.history.at(-1)!.lines.map((l) => l.text)).toContain('Cy flagged Twin N-12 for Ana.');
  });
});
