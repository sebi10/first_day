// Report a problem (docs/EXPANSION.md 6.5, 7, 13.1 stage 2): from week 3, one flag
// a week per seat and one received per trade, never on your own trade's asset (the
// generator is both techs': neither flags it). It raises a write-up alert for the
// trade that owns the asset, in the flagger's name, drawn only from what a
// layperson could see; a healthy asset gives a no-fault write-up that takes no slot
// but costs a close. A flag never gives a load sheet, a 100-hr or code prep.
import { describe, expect, it, vi } from 'vitest';
import { alertShort, SYMPTOMS, symptomText } from '../src/sim/alerts';
import { FLAG, flagCheck, flagPick, openWork } from '../src/sim/checks';
import { REPORT } from '../src/sim/data';
import { alertAog } from '../src/sim/econ';
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

  it("the analyst's flag on the generator goes by what she can see, never by what's coming on it", () => {
    // the same sheet (no alert on it) whatever the hidden wear: the receiver doesn't move with the health or the causes
    const seen = new Set<string>();
    for (const health of [20, 45, 60, 80, 100]) {
      const s = island(5, health);
      const g = flaggable(s, 'fin', 'gen');
      expect(g.ok).toBe(true);
      seen.add((g as { to: string }).to);
    }
    expect([...seen]).toEqual(['mech']);
    // an open alert on it is on the sheet: the tech who has it gets the flag, whatever its hidden cause
    for (const cause of [0, -1]) {
      const s = island(5, 60);
      s.alerts = [{ id: 'a1', role: 'elec', assetId: 'gen', sym: 'E_GEN_TEST', src: 'utility', week: 6, due: 8, seed: 1, kind: cause < 0 ? 'nff' : 'genTest', cause, status: 'open' }];
      expect(flaggable(s, 'fin', 'gen')).toEqual({ ok: true, to: 'elec' });
      s.alerts.push({ ...s.alerts[0], id: 'a2', role: 'mech', kind: 'genService' });
      expect(flaggable(s, 'fin', 'gen')).toEqual({ ok: true, to: 'mech' });
    }
    // a tech-to-tech flag on a plane leaves the mechanic's analyst side free: the generator still goes to him (review
    // round 2: it read the any-flag cap and sent it to the electrician)
    let s = island(5, 60);
    s = ok(s, { t: 'flag', role: 'elec', assetId: 'p1', week: s.week });
    expect(flaggable(s, 'fin', 'gen')).toEqual({ ok: true, to: 'mech' });
  });

  it("each trade receives one flag a week from the techs and one from the analyst: a tech-to-tech flag never locks the analyst out (review round 1)", () => {
    let s = island();
    s = ok(s, { t: 'flag', role: 'mech', assetId: 'h1', week: s.week });
    s = ok(s, { t: 'flag', role: 'elec', assetId: 'p1', week: s.week });
    // each tech has flagged the other: the analyst can still report on a house and on a plane
    expect(flaggable(s, 'fin', 'h2')).toEqual({ ok: true, to: 'elec' });
    expect(flaggable(s, 'fin', 'p1')).toEqual({ ok: true, to: 'mech' });
    // the analyst's flag first: the mechanic can still report a house to the electrician
    let t = island();
    t = ok(t, { t: 'flag', role: 'fin', assetId: 'h1', week: t.week });
    expect(flaggable(t, 'mech', 'h2')).toEqual({ ok: true, to: 'elec' });
    // one a week each: the analyst's is used
    expect(flaggable(t, 'fin', 'p1')).toEqual({ ok: false, why: 'One report a week: yours is used. Message them instead.' });
    // next week it's open again
    t.week = 7;
    expect(flaggable(t, 'fin', 'p1')).toEqual({ ok: true, to: 'mech' });
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
    // (review round 1) the flagger passes on the pilot's squawk, in the pilot's name: never their own words
    const pilot = a.via!;
    expect(pilot).toBeTruthy();
    expect(a.by).toBe('fin');
    expect(symptomText(s, a)).toMatch(new RegExp(`^Cy passed on a squawk from ${pilot} \\(the pilot\\) on Twin N-12: `));
    expect(openWork(s, 'mech').open).toBe(before + 1);
    // what went on the list, said once in the island's feed (review round 2: written for both seats it showed twice)
    const said = `Cy passed on a squawk from ${pilot} (the pilot) on Twin N-12 to Ana: ${alertShort(s, a)}.`;
    expect(s.feed.filter((f) => f.text === said).map((f) => f.role)).toEqual(['fin']);
  });

  it('a flagged airworthiness squawk gives the mechanic a week: it never grounds the plane the week it is flagged', () => {
    let tried = 0;
    for (let seed = 1; seed <= 60; seed++) {
      let s = island(seed, 40 + (seed % 40));
      s = ok(s, { t: 'flag', role: 'fin', assetId: 'p1', week: s.week });
      const a = s.alerts!.at(-1)!;
      if (!SYMPTOMS[a.sym].aw) continue;
      tried++;
      expect(a.due, `seed ${seed}: ${a.sym}`).toBeGreaterThanOrEqual(s.week + 1);
      expect(alertAog(s, 'p1'), `seed ${seed}`).toBeUndefined();
      // and it grounds the plane from its due week if nobody acts on it
      expect(alertAog(s, 'p1', a.due)).toBeDefined();
    }
    expect(tried).toBeGreaterThan(5);
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
    expect(symptomText(s, a)).toMatch(/^Cy passed on a guest's complaint at Cottage 2: /);
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
    const pilot = s.alerts!.find((a) => a.src === 'flag')!.via;
    const line = s.history.at(-1)!.lines.find((l) => l.text === `Cy passed on a squawk from ${pilot} (the pilot) on Twin N-12 to Ana.`);
    // (review round 1: tagged by the flagger's seat, not the receiver's)
    expect(line?.role).toBe('fin');
  });
});
