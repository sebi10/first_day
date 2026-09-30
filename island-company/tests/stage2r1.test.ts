// Stage 2 review round 1 (docs/DECISIONS.md "2026-09-30: stage 2 review round 1"): one test per fix the round made
// in the engine and the words, on the review's own repros where it gave one.
//   - the quick checks: an early catch stays blind; a no-fault check or flag write-up closed by autopilot once due
//   - Report a problem: relayed in its source's words, a flagged hazard's week of grace, the no-fault pool, the
//     analyst never locked out, nothing on a house closed for its renovation
//   - G0: the renovation's case (rent at stake, its open life, the builder, a hazard, the warranty), capex apart from
//     repairs, no fire / guest complaint / meter check on a renovating house, 85 at the final whatever the storm, the
//     warranty kept, the final held by an open hazard, autopilot buying a villa's materials past its cap; the Resort's
//     200 A transfer switch
//   - the IR scan and the meter check's physics; the walkaround's words; the sheets' words; the map's click swallow and
//     cover camera; What's new's order
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { alertShort, liveAlerts, raiseAlert, symptomText, SYMPTOMS } from '../src/sim/alerts';
import { genPanel, GEN_UPGRADE, WALK_BENIGN, WALK_BENIGN_TURBINE, WALK_SCOPE, WALK_ZONES } from '../src/sim/checkdata';
import { canCheck, checkTruth, checkView, flagCheck, flagPick, FLAG } from '../src/sim/checks';
import { DEFECT, RENO, STOCK, TIERS } from '../src/sim/data';
import { alertAog, closingHazard, genUpgraded, houseBlocker, houseRentable, isBlind, renoAwaitingFinal, renovating } from '../src/sim/econ';
import { apply, createIsland } from '../src/sim/engine';
import { earlyTier, fixTaskFor, stdPick } from '../src/sim/flow';
import { needsOf, siteOf } from '../src/sim/alerts';
import { migrate } from '../src/sim/migrate';
import { itemById, priceAt } from '../src/sim/items';
import { buildShort, renoPlan, renoSignoff } from '../src/sim/staff';
import { addStarter } from '../src/sim/stock';
import { ROLES, type Action, type IslandState } from '../src/sim/types';
import { facts, factsText } from '../src/ui/inspect/facts';
import { coverCam, HOME_SCENE, limitsFor } from '../src/ui/map/camera';
import { hotspots } from '../src/ui/map/hotspots';
import { armClickSwallow } from '../src/ui/map/swallow';
import { assetRef, FIXTURE_NAME, fixtureRef, HOME } from '../src/ui/objects';
import { assetPnl, launchFor } from '../src/ui/select';
import { buildLine, doingNow, renoStatus, warrantyLine } from '../src/ui/staff/model';
import { whatsNewUpkeepPanels } from '../src/ui/staff/WhatsNewUpkeep';

vi.setConfig({ testTimeout: 60000 });

const NOW = Date.UTC(2026, 8, 30, 12);
let clock = NOW;
const load = (name: string): IslandState => JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures', `${name}.json`), 'utf8'));
const ok = (s: IslandState, a: Action) => {
  const r = apply(s, a, ++clock);
  expect(r.error, JSON.stringify(a)).toBeUndefined();
  return r.s;
};
const house = (s: IslandState, id: string) => s.assets.find((a) => a.id === id && a.kind === 'house')!;
const valueOf = (lines: { item: string; qty: number }[]) => lines.reduce((t, l) => t + (itemById(l.item as never) ? priceAt(itemById(l.item as never)!) * l.qty : 0), 0);

/** a fresh island at `tier`, every asset at `health`, week 6 (the reviewers' helper) */
function island(seed = 5, health = 70, tier = 3): IslandState {
  let s = createIsland({ id: `r1-${seed}`, name: 'Review Isle', now: NOW, tz: 'Europe/Paris', seed, creator: { uid: 'a', name: 'Ana', role: 'mech' } });
  s = apply(s, { t: 'join', uid: 'b', name: 'Ben', role: 'elec' }, NOW).s;
  s = apply(s, { t: 'join', uid: 'c', name: 'Cy', role: 'fin' }, NOW).s;
  for (const r of ROLES) s = apply(s, { t: 'week0Done', role: r }, NOW).s;
  s.week = 6;
  s.tier = tier;
  s.cash = 20000;
  for (const t of TIERS.slice(1, tier))
    for (const a of t.adds)
      if (!s.assets.some((x) => x.id === a.id))
        s.assets.push({ id: a.id, kind: a.model === 'gen' ? 'generator' : ['twin', 'cargo', 'float'].includes(a.model) ? 'plane' : a.model === 'panel' ? 'grid' : 'house', model: a.model, name: a.name, health, touchedWeek: 0 });
  addStarter(s, tier);
  for (const a of s.assets) {
    a.health = health;
    if (a.kind === 'house') a.inspectionUntil = 40;
    if (a.kind === 'plane') a.sinceInspection = 0;
  }
  s.orders = [];
  s.alerts = [];
  for (const p of Object.values(s.players)) if (p) p.graceUntil = 0;
  return s;
}

/** the live tier-5 fixture (week 27) read and moved once on this build (G0's migration), as the reviewers set it up */
function resort(): IslandState {
  let s = load('v4-e810cc5-t5');
  s = apply(s, { t: 'endTurn', role: 'mech', week: s.week }, s.updatedAt + 1).s;
  return s;
}

/** every seat that hasn't ends its turn, then the resolve (`away`: seats that never end theirs: autopilot) */
function resolveWeek(s: IslandState, away: string[] = []): IslandState {
  const W = s.week;
  for (const r of ROLES) if (!away.includes(r) && !s.turns[r]?.ended) s = apply(s, { t: 'endTurn', role: r, week: W }, s.updatedAt + 1).s;
  if (s.week === W) s = apply(s, { t: 'resolve', week: W }, (s.deadline ?? s.updatedAt) + 1000).s;
  expect(s.week).toBe(W + 1);
  return s;
}

// ---------------------------------------------------------------------------

describe('the quick checks: an early catch stays blind (pillar 3)', () => {
  it('the floor: one tier easier, never out of the blind tiers', () => {
    expect(DEFECT.blindFromTier).toBe(2);
    expect(earlyTier(1, 1)).toBe(1);
    expect(earlyTier(2, 1)).toBe(2);
    expect(earlyTier(3, 1)).toBe(2);
    expect(earlyTier(4, 1)).toBe(3);
    expect(earlyTier(3, 0)).toBe(3);
  });

  it("a right walkaround call on a tire at island tier 3: the job plans blind at tier 2, launches blind, and still costs a tier less", () => {
    let shown = 0;
    for (let seed = 1; seed <= 200 && !shown; seed++)
      for (const health of [90, 85]) {
        let s = island(seed, health, 3);
        const p = s.assets.find((a) => a.kind === 'plane' && a.model !== 'float')!;
        const t = checkTruth(s, 'mech', p.id, s.week);
        if (!t || t.kind !== 'tires') continue;
        const plain = structuredClone(s);
        s = ok(s, { t: 'check', role: 'mech', assetId: p.id, item: t.item, week: s.week });
        const al = s.alerts!.find((a) => a.src === 'check')!;
        expect(al.early).toBe(true);
        const task = fixTaskFor(s, al)!;
        const asset = s.assets.find((a) => a.id === p.id)!;
        s = ok(s, { t: 'plan', role: 'mech', alert: al.id, task: task.id, pick: stdPick(s, asset, task, siteOf(s, al), needsOf(s, al)), week: s.week } as Action);
        const o = s.orders.find((x) => x.assetId === p.id && x.kind === 'tires')!;
        expect(o.tier).toBe(2);
        expect(isBlind(s, o, 'mech')).toBe(true);
        expect(launchFor(s, o, 'mech').blind).toBe(true);
        // the same alert without the early mark plans at tier 2 too, and costs more
        const same = structuredClone(al);
        delete same.early;
        same.id = 'a999';
        plain.alerts = [same];
        const q = ok(plain, { t: 'plan', role: 'mech', alert: 'a999', task: task.id, pick: stdPick(plain, asset, task, siteOf(plain, same), needsOf(plain, same)), week: plain.week } as Action);
        const o2 = q.orders.find((x) => x.assetId === p.id && x.kind === 'tires')!;
        expect(o2.tier).toBe(2);
        expect(o.cost).toBeLessThanOrEqual(o2.cost);
        shown++;
        break;
      }
    expect(shown).toBe(1);
  });
});

describe('autopilot closes a no-fault check or flag write-up once it is due (pillar 2)', () => {
  it('a wrong walkaround call on a sound twin, the mechanic away: closed as no fault found at its due week, never grounded', () => {
    let s = island(11, 100, 3);
    const p = s.assets.find((a) => a.kind === 'plane')!;
    expect(checkTruth(s, 'mech', p.id, s.week)).toBeNull();
    const item = checkView(s, 'mech', p.id)!.items[0].id;
    s = ok(s, { t: 'check', role: 'mech', assetId: p.id, item, week: s.week });
    const al = s.alerts!.find((a) => a.src === 'check')!;
    expect(al.cause).toBe(-1);
    for (let i = 0; i < 4; i++) {
      s = resolveWeek(s, ['mech']);
      // (the week's own draws can ground it: stage 1's no-fault trend alerts still wait for the mechanic)
      expect(alertAog(s, p.id)?.id, `after week ${s.week - 1}`).not.toBe(al.id);
    }
    const a2 = s.alerts!.find((a) => a.id === al.id)!;
    expect(a2.closed).toMatchObject({ how: 'nff' });
    // (at the resolve before it's due, as autopilot plans what comes due)
    expect(a2.closed!.week).toBe(al.due - 1);
    expect(s.feed.some((f) => f.role === 'mech' && /^Autopilot \(Ana\) closed .* no fault found\.$/.test(f.text))).toBe(true);
  });

  it("before it's due, it's the seat's to close: autopilot leaves it", () => {
    let s = island(11, 100, 3);
    const p = s.assets.find((a) => a.kind === 'plane')!;
    s = ok(s, { t: 'check', role: 'mech', assetId: p.id, item: checkView(s, 'mech', p.id)!.items[0].id, week: s.week });
    const al = s.alerts!.find((a) => a.src === 'check')!;
    // (raised due in 2 or 3 weeks: the first resolve leaves it when it's 3 out)
    if (al.due > s.week + 2) {
      s = resolveWeek(s, ['mech']);
      expect(s.alerts!.find((a) => a.id === al.id)!.status).toBe('open');
    } else expect(al.due).toBe(s.week + 2);
  });
});

describe('Report a problem: relayed, never in the flagger’s words', () => {
  it("a house: a guest's complaint, passed on; the feed says what went on the list (once: review round 2)", () => {
    let s = island(8, 70, 3);
    s = ok(s, { t: 'flag', role: 'mech', assetId: 'h2', week: s.week });
    const a = s.alerts!.find((x) => x.src === 'flag')!;
    expect(a).toMatchObject({ role: 'elec', by: 'mech', who: 'Ana' });
    expect(symptomText(s, a)).toMatch(/^Ana passed on a guest's complaint at Cottage 2: /);
    const said = `Ana passed on a guest's complaint at Cottage 2 to Ben: ${alertShort(s, a)}.`;
    expect(s.feed.filter((f) => f.text === said).map((f) => f.role)).toEqual(['mech']);
    // the reporter's sheet says it
    expect(factsText(facts(s, assetRef(house(s, 'h1')), 'mech'))).toContain(`This week you passed on a guest's complaint at Cottage 2 to Ben: ${alertShort(s, a)}.`);
  });

  it('the grid: the logs, never a meter reading only a tech could take', () => {
    for (let seed = 1; seed <= 150; seed++) {
      const s = island(seed, 40 + (seed % 60), 3);
      const g = s.assets.find((a) => a.kind === 'grid')!;
      const f = flagCheck(s, 'fin', g.id);
      if (!f.ok) continue;
      const pick = flagPick(s, 'fin', g, f.to);
      expect(pick).not.toBeNull();
      expect(FLAG.neverSym).not.toContain(pick!.sym);
    }
  });

  it('a flag never raises a no-fault hazard, and a flagged real hazard closes the house at once; the electrician can make it safe after the turn (review round 2)', () => {
    // healthy houses: nothing coming, and no hazard in the no-fault pool
    for (let seed = 1; seed <= 200; seed++) {
      const s = island(seed, 100, 3);
      const h = house(s, 'h1');
      const pick = flagPick(s, 'fin', h, 'elec');
      if (pick && pick.cause < 0) expect(SYMPTOMS[pick.sym].hazard, `seed ${seed} ${pick.sym}`).toBeFalsy();
    }
    // a real hazard, flagged after the electrician's turn: the house closes at once, like any hazard (review round 2:
    // round 1's week of grace kept a reported shock rented); its due week is the next, and the electrician can still
    // make it safe that night
    let found = 0;
    for (let seed = 1; seed <= 300 && !found; seed++) {
      let s = island(seed, 45, 3);
      const h = house(s, 'h1');
      const pick = flagPick(s, 'fin', h, 'elec');
      if (!pick || !SYMPTOMS[pick.sym].hazard || pick.cause < 0) continue;
      found++;
      s = ok(s, { t: 'endTurn', role: 'elec', week: s.week });
      s = ok(s, { t: 'flag', role: 'fin', assetId: h.id, week: s.week });
      const al = s.alerts!.find((a) => a.src === 'flag')!;
      expect(al.due).toBe(s.week + FLAG.awLead);
      expect(closingHazard(s, h.id)?.id).toBe(al.id);
      expect(houseBlocker(s, house(s, h.id))).toBe('hazard');
      expect(houseRentable(s, house(s, h.id))).toBe(false);
      // unmade safe by the resolve: made safe by the book, as autopilot would for an away seat (review round 3: a
      // present electrician was worse off than an absent one)
      const W = s.week;
      const t = resolveWeek(structuredClone(s));
      const rep = t.history.find((r) => r.week === W)!;
      expect(rep.lines.some((l) => new RegExp(`${h.name} closed: .*make it safe`).test(l.text))).toBe(false);
      expect(rep.lines.some((l) => new RegExp(`made ${h.name} safe by the book`).test(l.text))).toBe(true);
      // made safe after the turn: it rents at 75% that night
      s = ok(s, { t: 'makeSafe', role: 'elec', alert: al.id, how: 'breaker' });
      expect(houseRentable(s, house(s, h.id))).toBe(true);
    }
    expect(found).toBe(1);
  });

  it('nothing to flag, check or complain about on a house closed for its renovation', () => {
    let s = resort();
    s.builds = [...(s.builds ?? []), { id: `reno-villa-h6-${s.week - 1}`, what: 'Renovate', reno: 'h6', done: 1, drawn: 1, need: 2, started: s.week - 1 }];
    expect(renovating(s, 'h6')).toBe(true);
    expect(flagCheck(s, 'fin', 'h6')).toEqual({ ok: false, why: "Villa West is closed for its renovation: nobody's in it to report anything." });
    expect(canCheck(s, 'elec', 'h6')).toEqual({ ok: false, why: 'Villa West is closed for its renovation: nothing in service to meter until its final.' });
    // the week's no-fault extra never lands on it (the reviewers' repro: 10 of 60 before)
    let hits = 0;
    for (let seed = 1; seed <= 60; seed++) {
      let t = structuredClone(s);
      t.seed = seed;
      for (const a of t.assets) a.health = 95;
      house(t, 'h6').health = 25;
      t.staff = (t.staff ?? []).filter((n) => n.role !== 'builder');
      t = resolveWeek(t);
      if ((t.alerts ?? []).some((a) => a.assetId === 'h6' && a.week === t.week && SYMPTOMS[a.sym]?.src === 'guest')) hits++;
    }
    expect(hits).toBe(0);
  });
});

describe('G0: renovations', () => {
  it('a house closed for its renovation never catches fire (the reviewers: 7 of 60 resolves before)', () => {
    let fires = 0;
    for (let seed = 1; seed <= 60; seed++) {
      let s = resort();
      s.seed = seed;
      house(s, 'h6').health = 25;
      s.builds = [...(s.builds ?? []), { id: `reno-villa-h6-${s.week - 1}`, what: 'Renovate', reno: 'h6', done: 1, drawn: 1, need: 2, started: s.week - 1 }];
      s.staff = [];
      const W = s.week;
      s = resolveWeek(s);
      if (s.history.find((r) => r.week === W)!.incidents.some((i) => i.kind === 'fire' && i.assetId === 'h6')) fires++;
    }
    expect(fires).toBe(0);
  });

  it('autopilot buys an ordered villa renovation’s next unit past its $800 cap: the house reopens while the analyst is away', () => {
    let s = resort();
    s.cash = 60000;
    const W0 = s.week;
    s.staff = [...(s.staff ?? []), { id: 'nb1', name: 'Kai M.', role: 'builder', skill: 3, wage: 260, hired: W0 - 5, start: W0 - 5 }];
    s.builds = [...(s.builds ?? []), { id: `reno-villa-h5-${W0 - 1}`, what: 'Renovate Villa East', reno: 'h5', done: 1, drawn: 1, need: 2, started: W0 - 1 }];
    for (const k of ['BLD-DECK', 'BLD-SHUT']) if (s.inv) delete s.inv[k];
    expect(valueOf(buildShort(s, 1))).toBeGreaterThan(STOCK.autopilotCap);
    for (let i = 0; i < 5 && !renoAwaitingFinal(s, 'h5') && s.builds!.find((b) => b.reno === 'h5')?.signed === undefined; i++) s = resolveWeek(s, ['fin']);
    const b = s.builds!.find((x) => x.reno === 'h5')!;
    expect(b.finished).toBeDefined();
  });

  it('it opens at 85 when the final is signed, whatever a storm did while it waited, and keeps a longer builder’s warranty', () => {
    const s = resort();
    const h = house(s, 'h7');
    h.health = 60;
    h.warrantyUntil = s.week + 21;
    s.builds = [...(s.builds ?? []), { id: `reno-lodge-h7-${s.week - 3}`, what: 'Renovate', reno: 'h7', done: 3, drawn: 3, need: 3, started: s.week - 3, finished: s.week - 1 }];
    renoSignoff(s, h, s.week);
    expect(h.health).toBe(RENO.health);
    expect(h.warrantyUntil).toBe(s.week + 21);
    const t = resort();
    const h6 = house(t, 'h6');
    h6.health = 30;
    delete h6.warrantyUntil;
    t.builds = [...(t.builds ?? []), { id: `reno-villa-h6-${t.week - 3}`, what: 'Renovate', reno: 'h6', done: 2, drawn: 2, need: 2, started: t.week - 3, finished: t.week - 1 }];
    t.weather = 'storm';
    const u = resolveWeek(t);
    expect(house(u, 'h6').health).toBeLessThan(RENO.health);
    renoSignoff(u, house(u, 'h6'), u.week);
    expect(house(u, 'h6').health).toBe(RENO.health);
    expect(house(u, 'h6').warrantyUntil).toBe(u.week + RENO.warranty);
    // the builders finishing doesn't raise it: the 85 comes with the final (the electrician's trim-out)
    let v = resort();
    v.cash = 60000;
    house(v, 'h2').health = 50;
    v.staff = [...(v.staff ?? []), { id: 'nb1', name: 'Kai M.', role: 'builder', skill: 5, wage: 400, hired: v.week - 5, start: v.week - 5 }];
    v.builds = [...(v.builds ?? []), { id: `reno-cottage-h2-${v.week - 1}`, what: 'Renovate', reno: 'h2', done: 1, drawn: 1, need: 2, started: v.week - 1 }];
    v = resolveWeek(v);
    const b = v.builds!.find((x) => x.reno === 'h2')!;
    if (b.finished !== undefined && b.signed === undefined) expect(house(v, 'h2').health).toBeLessThan(RENO.health);
  });

  it("the final won't plan with a hazard open on the house; made safe, it will", () => {
    let s = resort();
    const h = house(s, 'h3');
    s.builds = [...(s.builds ?? []), { id: `reno-cottage-h3-${s.week - 3}`, what: 'Renovate', reno: 'h3', done: 2, drawn: 2, need: 2, started: s.week - 3, finished: s.week - 1 }];
    const hz = raiseAlert(s, { role: 'elec', asset: h, sym: 'E_SHOWER_TINGLE', cause: 0 }, NOW);
    hz.due = s.week;
    raiseAlert(s, { role: 'elec', asset: h, sym: 'E_RENO_FINAL', due: s.week, week: s.week }, NOW);
    const fin = liveAlerts(s).find((a) => a.sym === 'E_RENO_FINAL')!;
    const task = fixTaskFor(s, fin)!;
    const r = apply(s, { t: 'plan', role: 'elec', alert: fin.id, task: task.id, pick: [], week: s.week } as Action, ++clock);
    expect(r.error).toBe("The final won't pass with a hazard open on Cottage 3: make it safe or fix it first.");
    expect(renoStatus(s, h, 'fin')!.text).toMatch(/once the hazard on it is made safe/);
    s = ok(s, { t: 'makeSafe', role: 'elec', alert: hz.id, how: 'breaker', week: s.week } as Action);
    expect(apply(s, { t: 'plan', role: 'elec', alert: fin.id, task: task.id, pick: [], week: s.week } as Action, ++clock).error).toBeUndefined();
  });

  it("capex isn't repairs: ordering a renovation leaves the house's 13-week repairs as they were, and the analyst's sheet says the capex apart", () => {
    const s = resort();
    const before = assetPnl(s, 'h6', 13);
    s.staff = [...(s.staff ?? []), { id: 'nb1', name: 'Kai M.', role: 'builder', skill: 3, wage: 260, hired: s.week - 5, start: s.week - 5 }];
    const t = ok(s, { t: 'build', what: 'reno', asset: 'h6', week: s.week } as Action);
    const after = assetPnl(t, 'h6', 13);
    expect({ parts: after.parts, labour: after.labour }).toEqual({ parts: before.parts, labour: before.labour });
    const text = factsText(facts(t, assetRef(house(t, 'h6')), 'fin'));
    expect(text).toContain(`Capex, not repairs: its renovation ordered in week ${t.week}, $12,000 package + $1,700 materials at list.`);
    expect(text).toMatch(/Repairs over 13 weeks: \$[\d,]+ \(about \$[\d,]+ parts, \$[\d,]+ labour\)\./);
  });

  it('the case: a house closed now (under 40) counts the rent the renovation brings back, and the payback holds over its renovated life', () => {
    const s = resort();
    s.staff = [...(s.staff ?? []), { id: 'nb1', name: 'Kai M.', role: 'builder', skill: 3, wage: 260, hired: s.week - 5, start: s.week - 5 }];
    const h = house(s, 'h6');
    h.health = 39;
    const low = renoPlan(s, h);
    expect(houseRentable(s, h)).toBe(false);
    expect(low.rentNow).toBe(0);
    expect(low.rentLost).toBe(0);
    expect(low.closedNow).toBe('reliability 39');
    expect(low.rent).toBeGreaterThan(0);
    expect(low.closesIn).toBe(0);
    expect(low.gained).toBe(low.life);
    if (low.gain >= low.total) expect(low.payback).toBe(low.toFinal + Math.ceil(low.total / low.rent));
    // at 41 it's open: the rent it earns now is lost only for the weeks it would have been open
    h.health = 41;
    const open = renoPlan(s, h);
    expect(open.rentNow).toBeGreaterThanOrEqual(0);
    expect(open.rentLost).toBe(open.rentNow * Math.min(open.weeksClosed, Math.max(0, open.closesIn - 1)));
    // the renovated house wears too: its open life is finite, and a payback is only claimed when the rent gained covers it
    expect(open.life).toBeGreaterThan(RENO.warranty);
    expect(open.life).toBeLessThan(52);
    for (const p of [low, open]) if (p.payback === null) expect(p.gain).toBeLessThan(p.total + p.rentLost);
  });

  it('the case with no builder on the payroll: planned with one skill-3 builder, counted from their start, and the sheet leads with hiring one', () => {
    const s = resort();
    s.staff = (s.staff ?? []).filter((n) => n.role !== 'builder');
    const p = renoPlan(s, house(s, 'h6'));
    expect(p.planned).toBe(true);
    expect(p.weeksClosed).toBe(1);
    // ordered anyway: every seat reads that it waits for a builder
    const t = ok(s, { t: 'build', what: 'reno', asset: 'h6', week: s.week } as Action);
    expect(renoStatus(t, house(t, 'h6'), 'fin')!.text).toMatch(/waiting for a builder \(none on the payroll: hire one on the Staff desk\)/);
    expect(renoStatus(t, house(t, 'h6'), 'mech')!.text).toMatch(/waiting for a builder \(none on the payroll\)/);
    // a house closed now reads closed meanwhile, not "it stays open"
    house(t, 'h6').health = 0;
    expect(renoStatus(t, house(t, 'h6'), 'elec')!.text).toMatch(/Closed meanwhile \(reliability 0\)\./);
  });

  it('the case says a longer builder’s warranty is kept, and an open hazard holds the final', () => {
    const s = resort();
    const h = house(s, 'h7');
    h.warrantyUntil = s.week + 21;
    expect(renoPlan(s, h).warrantyUntil).toBe(s.week + 21);
    const hz = raiseAlert(s, { role: 'elec', asset: h, sym: 'E_SHOWER_TINGLE', cause: 0 }, NOW);
    hz.due = s.week;
    expect(renoPlan(s, h).hazard).toBe(true);
  });
});

describe("G0: the Resort's 200 A transfer switch", () => {
  it('the generator house reads 200 A on 3/0 Cu from tier 5, 60 A on #6 before; the IR scan reads amps against it', () => {
    const s = island(5, 70, 5);
    const gen = s.assets.find((a) => a.kind === 'generator')!;
    expect(genUpgraded(s)).toBe(true);
    expect(genPanel(true).find((b) => b.id === 'xferG')).toMatchObject({ amps: GEN_UPGRADE.amps, awg: '3/0 Cu' });
    const v = checkView(s, 'elec', gen.id)!;
    for (const i of v.items.filter((x) => x.id !== 'xferU')) {
      expect(i.label).toMatch(/200 A · 3\/0 Cu$/);
      expect(Math.abs(i.reading!.amps! - (i.reading!.loadPct! / 100) * 200)).toBeLessThanOrEqual(1);
    }
    expect(factsText(facts(s, assetRef(gen), 'elec'))).toContain('Automatic transfer switch 200 A on 3/0 Cu THWN; generator main 200 A on 3/0 Cu');
    const t = island(5, 70, 4);
    expect(genUpgraded(t)).toBe(false);
    expect(factsText(facts(t, assetRef(t.assets.find((a) => a.kind === 'generator')!), 'elec'))).toContain('Transfer switch 60 A on #6 Cu THWN');
  });

  it('after the upgrade nothing replaces the new switch under its warranty; after it, a worn switch can be replaced like for like, but the 60 A take-off never comes back (a tier-4 generator gets both)', () => {
    const run = (tier: number, warrantyUntil?: number) => {
      let s = island(9, 60, tier);
      const kinds: string[] = [];
      for (let i = 0; i < 40; i++) {
        // (a fresh list each week, so the draw's slots are open: every other asset sound)
        s.alerts = [];
        s.orders = s.orders.filter((o) => o.status === 'done');
        for (const a of s.assets) a.health = a.kind === 'generator' ? 50 : 97;
        const gen = s.assets.find((a) => a.kind === 'generator')!;
        if (warrantyUntil === undefined) delete gen.warrantyUntil;
        else gen.warrantyUntil = warrantyUntil;
        s = resolveWeek(s);
        for (const a of s.alerts ?? []) if (a.assetId === 'gen') kinds.push(`${a.sym}:${a.kind}`);
      }
      return kinds;
    };
    // under its warranty: no transfer job at all (a failed transfer in the weekly test can still be its relay: genTest)
    const warm = run(5, 999);
    expect(warm.length).toBeGreaterThan(5);
    expect(warm.filter((k) => k.startsWith('E_TAKEOFF_XFER') || k.endsWith(':transfer'))).toEqual([]);
    // out of its warranty: a worn switch's own fault (like for like: the job's lot is a 200 A switch), never the take-off
    const old = run(5);
    expect(old.filter((k) => k.startsWith('E_TAKEOFF_XFER'))).toEqual([]);
    expect(old.some((k) => k.endsWith(':transfer'))).toBe(true);
    const t4 = run(4);
    expect(t4.some((k) => k.endsWith(':transfer'))).toBe(true);
    // the quick check's tell reads the same weights: no transfer tell on the upgraded switch under its warranty
    const s = island(9, 50, 5);
    s.assets.find((a) => a.kind === 'generator')!.warrantyUntil = 999;
    for (let W = 1; W <= 60; W++) expect(checkTruth(s, 'elec', 'gen', W)).toBeNull();
  });

  it("the migration of a live tier-5 island closes the open alerts about the old 60 A switch, and says so", () => {
    const doc = load('v4-e810cc5-t5');
    const gen = doc.assets.find((a) => a.kind === 'generator')!;
    doc.alerts = [...(doc.alerts ?? []), { id: 'a9990', role: 'elec', assetId: gen.id, sym: 'E_TAKEOFF_XFER', src: 'takeoff', week: doc.week, due: doc.week + 2, seed: 7, kind: 'transfer', cause: 0, status: 'open' }];
    const s = migrate(doc);
    expect(s.alerts!.find((a) => a.id === 'a9990')!.closed).toEqual({ week: doc.week, how: 'dropped' });
    // (review round 2: the old set's work retired, jobs and all; said once)
    expect(s.feed.filter((f) => /^The Resort’s new standby set and its 200 A automatic transfer switch are in: the work on the old set is dropped \(/.test(f.text))).toHaveLength(1);
    // the grid's and the generator's warranty lines: storms and incidents, not guests; the switch named
    const g = s.assets.find((a) => a.kind === 'generator')!;
    expect(warrantyLine(s, g)!.text).toMatch(/^The standby set and its 200 A automatic transfer switch are under warranty to week \d+: .* Storms and incidents still hit it\.$/);
    expect(warrantyLine(s, s.assets.find((a) => a.kind === 'grid')!)!.text).not.toMatch(/Guests/);
  });
});

describe('the meter check: a loose service neutral sags every loaded circuit', () => {
  it('with the service tell showing, each circuit reads its run’s drop plus the loaded leg’s sag', () => {
    let found = 0;
    for (let seed = 1; seed <= 400 && found < 5; seed++) {
      const s = island(seed, 55, 3);
      for (const h of s.assets.filter((a) => a.kind === 'house')) {
        const t = checkTruth(s, 'elec', h.id, s.week);
        if (t?.item !== 'service') continue;
        const v = checkView(s, 'elec', h.id)!;
        const svc = v.items.find((i) => i.id === 'service')!;
        const l1 = svc.reading!.volts!;
        // every circuit under its own 12 A load sits below the loaded leg's volts less its run's drop, give or take
        for (const i of v.items.filter((x) => x.id !== 'service')) expect(i.reading!.volts!).toBeLessThan(l1 + 1);
        found++;
      }
    }
    expect(found).toBeGreaterThan(0);
  });
});

describe('the walkaround’s words', () => {
  it('no wear pin on these brakes (the lining is measured); the Caravan’s cowl reads a turbine’s; the twin’s zone 4 is its wing root', () => {
    const all = [...Object.values(WALK_SCOPE).flatMap((x) => x.tells.flatMap((t) => t.texts)), ...Object.values(WALK_BENIGN).flat()];
    expect(all.filter((t) => /wear pin/i.test(t))).toEqual([]);
    expect(WALK_BENIGN_TURBINE.cowl!.some((t) => /cowl flap|sump/.test(t))).toBe(false);
    expect(WALK_ZONES.twin.find((z) => z.id === 'root')!.label).toBe('Wing root');
    // the generator's belt: nothing squeals on a set that's shut down and locked out
    expect(WALK_BENIGN.belt.some((t) => /^The belt squeals/.test(t))).toBe(false);
    for (let seed = 1; seed <= 40; seed++) {
      const s = island(seed, 95, 3);
      const cargo = s.assets.find((a) => a.kind === 'plane' && a.model === 'cargo');
      if (!cargo) continue;
      const cowl = checkView(s, 'mech', cargo.id)!.items.find((i) => i.id === 'cowl')!;
      expect(WALK_BENIGN_TURBINE.cowl).toContain(cowl.text);
    }
  });

  it("the wheels' benign lines read like their tells: a lining measured, a shoulder worn, a film on the caliper", () => {
    expect(WALK_BENIGN.lmain.some((t) => /^Linings about/.test(t))).toBe(true);
    expect(WALK_SCOPE.tires.tells[1].texts.some((t) => /^Linings about/.test(t))).toBe(true);
    expect(WALK_BENIGN.lmain.some((t) => /outboard shoulder/.test(t))).toBe(true);
    expect(WALK_BENIGN.lmain.some((t) => /film of red dye on the caliper/.test(t))).toBe(true);
  });
});

describe('the sheets’ words', () => {
  it("a plane's bar is its condition; a pilot flies what the plane flies this week; the fuel dock has one name", () => {
    const s = island(5, 70, 3);
    s.weather = 'wind';
    const p = s.assets.find((a) => a.id === 'p1')!;
    expect(facts(s, assetRef(p), 'mech').health!.label).toBe('Condition');
    const pilot = (s.staff ?? []).find((n) => n.role === 'pilot')!;
    const line = doingNow(s, pilot);
    expect(line).toMatch(/^flies (Twin N-12|Cargo C-7): \d+ flights?( · (Twin N-12|Cargo C-7): \d+ flights?)? this week$/);
    const spot = hotspots(s, HOME).find((h) => h.ref.kind === 'fuel')!;
    expect(spot.label).toBe(FIXTURE_NAME.fuel);
    expect(facts(s, fixtureRef('fuel'), 'mech').name).toBe(FIXTURE_NAME.fuel);
  });

  it("the office: one line for the techs; the analyst's figures, 'fixed' as everywhere else (review round 2)", () => {
    const s = island(5, 70, 3);
    const mech = facts(s, fixtureRef('office'), 'mech');
    expect(mech.status).toBe("Cy's office");
    expect(mech.lines.map((l) => l.text)).not.toContain("Cy's office.");
    const fin = facts(s, fixtureRef('office'), 'fin');
    expect(fin.status).toMatch(/^This week: about \$[\d,]+ in, \$[\d,]+ out$/);
    expect(fin.lines[0].text).toMatch(/^Out a week: \$[\d,]+ fixed \(overhead and payroll\) \+ \$[\d,]+ insurance = \$[\d,]+\. Spendable covers [\d.]+ weeks of it\.$/);
  });

  it("the builders' line: the analyst's move is hers; a tech reads whose it is", () => {
    const s = resort();
    s.staff = (s.staff ?? []).filter((n) => n.role !== 'builder');
    s.builds = [...(s.builds ?? []), { id: `reno-villa-h6-${s.week}`, what: 'Renovate', reno: 'h6', done: 0, drawn: 0, need: 2, started: s.week }];
    expect(buildLine(s, 'mech')!.text).toMatch(/Cy hires one on the desk\.$/);
    expect(buildLine(s, 'fin')!.text).toMatch(/Hire one on the desk\.$/);
  });

  it("the house's panel schedule: the spa only once its circuit is in", () => {
    const s = island(5, 70, 3);
    const h = house(s, 'h1');
    raiseAlert(s, { role: 'elec', asset: h, sym: 'E_TAKEOFF_SPA' }, NOW);
    const spa = (f: ReturnType<typeof facts>) => (f.blocks.find((b) => b.t === 'schedule') as { rows: { label: string; note: string }[] }).rows.find((r) => r.label === 'Spa (hot tub)')!;
    expect(spa(facts(s, assetRef(h), 'elec')).note).toMatch(/not wired yet/);
    // (review round 2: no spa circuit on record, no spa row; once one is in, its own breaker and wire)
    expect(spa(facts(s, assetRef(house(s, 'h2')), 'elec'))).toBeUndefined();
    house(s, 'h2').spa = { amps: 50, awg: 8, week: 3 };
    expect(spa(facts(s, assetRef(house(s, 'h2')), 'elec'))).toMatchObject({ label: 'Spa (hot tub)', note: expect.stringMatching(/GFCI \(680\.44\)/) });
    expect((facts(s, assetRef(house(s, 'h2')), 'elec').blocks.find((b) => b.t === 'schedule') as { rows: { label: string; rating: string; wire: string }[] }).rows.find((r) => r.label === 'Spa (hot tub)')).toMatchObject({ rating: '50 A', wire: '8 AWG Cu' });
  });

  it("What's new's upkeep panel says 'yours' to the analyst", () => {
    const s = migrate(load('v4-e810cc5-t5'));
    const body = (role: 'fin' | 'mech') => JSON.stringify(whatsNewUpkeepPanels(s, role)[0].body);
    expect(body('fin')).toContain('yours');
    expect(body('mech')).not.toContain('yours');
  });
});

describe('the map', () => {
  it('the click after a tap is eaten; a new pointer sequence disarms it first (a pinch or a drag sends no click)', () => {
    const on = new Map<string, EventListener[]>();
    const w = {
      addEventListener: (t: string, f: EventListener) => void on.set(t, [...(on.get(t) ?? []), f]),
      removeEventListener: (t: string, f: EventListener) => void on.set(t, (on.get(t) ?? []).filter((x) => x !== f)),
    } as unknown as Window;
    const fire = (t: string) => {
      let stopped = false;
      const e = { stopPropagation: () => (stopped = true), preventDefault: () => undefined } as unknown as Event;
      for (const f of [...(on.get(t) ?? [])]) f(e);
      return stopped;
    };
    const never = () => undefined;
    // a tap: its click is eaten, once
    armClickSwallow(w, 450, never);
    expect(fire('click')).toBe(true);
    expect(fire('click')).toBe(false);
    // armed, then the player's next tap starts: its click goes through (the reviewers' pinch, then ⌖ 200 ms later)
    armClickSwallow(w, 450, never);
    fire('pointerdown');
    expect(fire('click')).toBe(false);
    expect(on.get('click')).toEqual([]);
    expect(on.get('pointerdown')).toEqual([]);
  });

  it('Explore on a portrait phone opens filling the screen; a landscape viewport keeps the contain fit', () => {
    const phone = { w: 390, h: 760 };
    const c = coverCam(phone, HOME_SCENE, limitsFor('explore', phone))!;
    expect(c.k).toBeGreaterThan(1.5);
    // the scene fills the viewport's height
    const s = Math.min(phone.w / HOME_SCENE.w, phone.h / HOME_SCENE.h) * c.k;
    expect(HOME_SCENE.h * s).toBeGreaterThanOrEqual(phone.h - 1);
    expect(coverCam({ w: 1280, h: 760 }, HOME_SCENE, limitsFor('explore', { w: 1280, h: 760 }))).toBeNull();
  });
});

describe("What's new: one at a time", () => {
  it("the stage-2 sheet waits for the job flow's for a tech, and the desk's for the analyst, on an island migrated from v2", async () => {
    const { flowNewPending } = await import('../src/ui/whatsnew');
    const mem = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) });
    const s = { ...island(5, 70, 2), flowSince: 4 } as IslandState;
    expect(flowNewPending(s, 'fin')).toBe(true);
    expect(flowNewPending(s, 'mech')).toBe(true);
    mem.set(`ic.whatsnew.jobflow.fin.${s.id}`, '1');
    mem.set(`ic.jf.new.${s.id}.mech`, '1');
    expect(flowNewPending(s, 'fin')).toBe(false);
    expect(flowNewPending(s, 'mech')).toBe(false);
    // an island that started with the job flow: nothing to wait for
    expect(flowNewPending({ ...s, flowSince: 1 }, 'elec')).toBe(false);
    vi.unstubAllGlobals();
  });
});
