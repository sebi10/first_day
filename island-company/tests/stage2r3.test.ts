// Stage 2 review round 3 (docs/DECISIONS.md "2026-09-30: stage 2 review round 3"): one test per fix, on the reviewers'
// repros where they gave one.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { alertShort, findingOf, generateAlerts, liveAlerts, pairsFor, raiseAlert, siteOf, symptomText, SYMPTOMS } from '../src/sim/alerts';
import { itemById } from '../src/sim/items';
import { taskById } from '../src/sim/tasks';
import { fixTaskFor, stdPick } from '../src/sim/flow';
import { siteAnswer, siteWords } from '../src/ui/flow/steps';
import { botTurn, simulate, TEAMS, type Team } from '../src/sim/bots';
import { renoPlan, renoShort, unitLines } from '../src/sim/staff';
import { backedUp, canCheck, checkTruth, checkView, flagCheck, flagPick, openWork, raiseFlag } from '../src/sim/checks';
import { GEN_PANEL } from '../src/sim/checkdata';
import { migrate } from '../src/sim/migrate';
import { TIERS } from '../src/sim/data';
import { capOf, closingHazard, hazardOn, houseBlocker, houseRentable, renovating } from '../src/sim/econ';
import { apply, createIsland } from '../src/sim/engine';
import { hashSeed, rng } from '../src/sim/rng';
import { spendable } from '../src/sim/ledger';
import { addStarter } from '../src/sim/stock';
import { ROLES, type Action, type IslandState, type Npc } from '../src/sim/types';
import { facts, factsText, gridSchedule } from '../src/ui/inspect/facts';
import { whatsNewMapPanels } from '../src/ui/inspect/WhatsNewMap';
import { assetRef, fixtureRef } from '../src/ui/objects';
import { doingNow } from '../src/ui/staff/model';
import { endTurnChecks, pushes, quickCheckMove } from '../src/ui/select';
import { RenoNumbers } from '../src/ui/staff/Reno';
import { whatsNewUpkeepPanels } from '../src/ui/staff/WhatsNewUpkeep';
import { armObjectDouble } from '../src/ui/map/swallow';
import { TAP } from '../src/ui/map/gestures';

vi.setConfig({ testTimeout: 120000 });

const NOW = Date.UTC(2026, 8, 30, 12);
let clock = NOW;
const load = (name: string): IslandState => JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures', `${name}.json`), 'utf8'));
const ok = (s: IslandState, a: Action) => {
  const r = apply(s, a, ++clock);
  expect(r.error, JSON.stringify(a)).toBeUndefined();
  return r.s;
};
const house = (s: IslandState, id: string) => s.assets.find((a) => a.id === id && a.kind === 'house')!;

/** a fresh island at `tier`, every asset at `health`, week 6, nothing open (the reviewers' helper) */
function island(seed = 5, health = 70, tier = 3): IslandState {
  let s = createIsland({ id: `r3-${seed}`, name: 'Review Isle', now: NOW, tz: 'Europe/Paris', seed, creator: { uid: 'a', name: 'Ana', role: 'mech' } });
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

/** a live doc read and moved once on this build (G0's migration runs), as the reviewers set it up */
function firstMove(name: string): { doc: IslandState; s: IslandState } {
  const doc = load(name);
  const role = (['mech', 'elec', 'fin'] as const).find((r) => !doc.turns[r]?.ended)!;
  const r = apply(doc, { t: 'endTurn', role, week: doc.week }, doc.updatedAt + 1);
  expect(r.error).toBeUndefined();
  return { doc, s: r.s };
}

/** a preact vnode's text (the What's new panels: plain components, no hooks) */
function vtext(v: unknown): string {
  if (v == null || typeof v === 'boolean') return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(vtext).join('');
  const n = v as { type: unknown; props?: { children?: unknown } };
  if (typeof n.type === 'function') return vtext((n.type as (p: unknown) => unknown)(n.props ?? {}));
  return vtext(n.props?.children);
}

// ---------------------------------------------------------------------------

describe('Report a problem: a flag takes a slot, never adds one (play-fun major, systems minor)', () => {
  it("a trade at its open-work target is refused, with the reason on the sheet; under it the flag fills a slot the draw would have filled", () => {
    const s = island(5, 60, 2);
    const h = (id: string) => house(s, id);
    // tier 2: a target of 4. Three open: a flag fits
    for (const id of ['h1', 'h2', 'h3']) raiseAlert(s, { role: 'elec', asset: h(id), sym: 'E_DEAD_OUTLET', cause: 0 }, NOW);
    expect(openWork(s, 'elec')).toEqual({ open: 3, target: 4 });
    expect(flagCheck(s, 'fin', 'h4')).toEqual({ ok: true, to: 'elec' });
    // a no-fault alert counts as well (which alerts are real is hidden: a refusal must not tell)
    raiseAlert(s, { role: 'elec', asset: h('h4'), sym: 'E_DEAD_OUTLET', cause: -1 }, NOW);
    const full = flagCheck(s, 'fin', 'h4');
    expect(full).toEqual({ ok: false, why: "Ben's list is full (4 open): a report now would be work on top. Message Ben instead, or report it once the list is worked down." });
    expect(facts(s, assetRef(h('h4')), 'fin').report).toMatchObject({ t: 'flag', ok: false, why: full.ok ? '' : full.why });
  });

  it("a flag's no-fault write-up holds a slot until it's closed, like a quick check's wrong call: the next draw is one smaller", () => {
    const base = island(5, 100, 2);
    // three real alerts open on the electrician's list, on Cottage 3 (tier 2: a target of 4): the draw has one slot left
    for (const sym of ['E_DEAD_OUTLET', 'E_FLICKER', 'E_GFCI_TRIPS']) raiseAlert(base, { role: 'elec', asset: house(base, 'h3'), sym, cause: 0 }, NOW);
    expect(openWork(base, 'elec').open).toBe(3);
    let s = ok(base, { t: 'flag', role: 'fin', assetId: 'h1', week: base.week });
    const al = s.alerts!.at(-1)!;
    expect(al).toMatchObject({ src: 'flag', cause: -1, role: 'elec' });
    expect(openWork(s, 'elec').open).toBe(4);
    // the next draw, the houses worn by then
    const draw = (x0: IslandState) => {
      const x = structuredClone(x0);
      for (const a of x.assets) if (a.id === 'h1' || a.id === 'h2') a.health = 50;
      const n = x.alerts!.length;
      generateAlerts(x, rng(hashSeed('draw', 1)), NOW, () => {});
      return x.alerts!.slice(n).filter((a) => a.role === 'elec' && a.cause >= 0).length;
    };
    expect(draw(base)).toBe(1);
    expect(draw(s)).toBe(0);
    s = ok(s, { t: 'nff', role: 'elec', alert: al.id, week: s.week });
    expect(draw(s)).toBe(1);
  });

  it("a crew that flags every week (every seat, as What's new invites) no longer slows its island: the reviewers' loop, 10 seeds x 26 weeks", () => {
    const base = TEAMS['three friends'];
    const weekly: Team = { mech: { ...base.mech, flagWeekly: true }, elec: { ...base.elec, flagWeekly: true }, fin: { ...base.fin, flagWeekly: true } };
    const t5 = (team: Team) => {
      const out: number[] = [];
      const flags = new Set<string>();
      for (let seed = 1; seed <= 10; seed++) {
        const { final } = simulate(team, 26, seed, (s) => {
          for (const a of s.alerts ?? []) if (a.src === 'flag') flags.add(`${seed}:${a.id}`);
        });
        out.push(final.stats.tierReachedWeek[5] ?? 99);
      }
      return { reached: out.filter((w) => w <= 26).length, flags: flags.size };
    };
    const a = t5(base);
    const b = t5(weekly);
    // (before the fix: 12 of 30 islands reached tier 5 by week 26 flagging weekly, against 28 of 30 without)
    expect(b.flags).toBeGreaterThan(a.flags + 100);
    expect(b.reached).toBeGreaterThanOrEqual(a.reached - 2);
  });
});

describe("Report a problem: a hazard passed on after the electrician's turn (systems major)", () => {
  /** a real hazard flagged on a house of the island, found by seed */
  function hazardIsland(): { s: IslandState; id: string } {
    for (let seed = 1; seed <= 400; seed++) {
      const s = island(seed, 45, 3);
      const pick = flagPick(s, 'fin', house(s, 'h1'), 'elec');
      if (pick && SYMPTOMS[pick.sym].hazard && pick.cause >= 0 && !SYMPTOMS[pick.sym].causes[pick.cause].neutral) return { s, id: 'h1' };
    }
    throw new Error('no seed');
  }

  it("the receiver gets a push that says the house is shut and that it can still be made safe tonight", () => {
    const { s: s0, id } = hazardIsland();
    let s = ok(s0, { t: 'endTurn', role: 'elec', week: s0.week });
    const before = s;
    s = ok(s, { t: 'flag', role: 'fin', assetId: id, week: s.week });
    const al = s.alerts!.at(-1)!;
    expect(al.late).toBe(true);
    const p = pushes(before, s, { t: 'flag', role: 'fin', assetId: id, week: s.week });
    expect(p).toHaveLength(1);
    expect(p[0].title).toBe('Review Isle: Ben, a report');
    expect(p[0].body).toMatch(/^Cy passed on a guest's complaint at Cottage 1: .+ Cottage 1 is closed until it's made safe: you can still do it tonight\.$/);
    // a flag that shuts nothing: due week said
    const t = island(5, 60, 3);
    const t2 = ok(t, { t: 'flag', role: 'fin', assetId: 'p1', week: t.week });
    const q = pushes(t, t2, { t: 'flag', role: 'fin', assetId: 'p1', week: t.week });
    expect(q[0].body).toMatch(/ It's on your list, due week \d+\.$/);
  });

  it('not made safe by the resolve: made safe by the book, as autopilot does for an away seat, so a present electrician is never worse off', () => {
    const { s: s0, id } = hazardIsland();
    const play = (endFirst: boolean) => {
      let s = s0;
      if (endFirst) s = ok(s, { t: 'endTurn', role: 'elec', week: s.week });
      s = ok(s, { t: 'flag', role: 'fin', assetId: id, week: s.week });
      expect(closingHazard(s, id)).toBeDefined();
      for (const r of ['mech', 'fin'] as const) s = ok(s, { t: 'endTurn', role: r, week: s.week });
      if (s.week === s0.week) s = apply(s, { t: 'resolve', week: s.week }, (s.deadline ?? clock) + 1000).s;
      return s;
    };
    const ended = play(true);
    const away = play(false);
    expect(ended.week).toBe(s0.week + 1);
    // (round-3 verification: autopilot's own job flow for it, so with its parts on the shelf it's fixed at 50% before
    // rent is booked, as an away seat's would be; only made safe it rented at 75% against the away seat's 100%)
    expect(hazardOn(ended, id)).toBeUndefined();
    expect(ended.history.at(-1)!.lines.map((l) => l.text).join('\n')).toMatch(/Autopilot \(Ben\) fixed Cottage 1 by the book \(.+, at 50%\): Cy's report came after Ben's turn\./);
    const h = (x: IslandState) => x.history.at(-1)!;
    expect(h(ended).housesRentable).toBe(h(away).housesRentable);
    expect(h(ended).revenue).toBe(h(away).revenue);
    // a hazard flagged BEFORE the electrician ended the turn is theirs: never made safe for them
    let s = ok(s0, { t: 'flag', role: 'fin', assetId: id, week: s0.week });
    expect(s.alerts!.at(-1)!.late).toBeUndefined();
    for (const r of ROLES) s = ok(s, { t: 'endTurn', role: r, week: s.week });
    expect(hazardOn(s, id)?.safe).toBeUndefined();
    expect(houseRentable(s, house(s, id))).toBe(false);
  });

  it("the Report confirm says a reported shock closes the house at once", () => {
    const s = island(5, 60, 3);
    const r = facts(s, assetRef(house(s, 'h1')), 'fin').report;
    expect(r).toMatchObject({ t: 'flag', ok: true });
    expect((r as { words: string }).words).toMatch(/in a slot the week's draw would have filled.+A reported shock or burning smell closes the house at once, until Ben makes it safe\.$/);
  });
});

describe('Report a problem: never a symptom already open on the asset; every flag a week to act (play-fun minor)', () => {
  it("the reviewers' tier-2 week 10: the utility's feeder drop open on the grid, the analyst's report never raises it again, and a flag is due next week at the soonest", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const s = island(seed, 55, 2);
      s.week = 10;
      const g = s.assets.find((a) => a.kind === 'grid')!;
      raiseAlert(s, { role: 'elec', asset: g, sym: 'E_FEEDER_DROP', cause: 0 }, NOW);
      const pick = flagPick(s, 'fin', g, 'elec');
      expect(pick?.sym, `seed ${seed}`).not.toBe('E_FEEDER_DROP');
    }
    for (let seed = 1; seed <= 40; seed++) {
      let s = island(seed, 40 + (seed % 50), 2);
      s = ok(s, { t: 'flag', role: 'fin', assetId: seed % 2 ? 'g1' : 'h1', week: s.week });
      const al = s.alerts!.at(-1)!;
      expect(al.due, `seed ${seed} ${al.sym}`).toBeGreaterThanOrEqual(s.week + 1);
    }
  });
});

describe('the map: a double tap on an object zooms, its sheet never blinks (play-fun major)', () => {
  /** a window stand-in (its listeners by type, as the round-1 swallow test keeps them: Node's EventTarget never removes a capture listener), a timer run by hand */
  function fakeWindow() {
    const on = new Map<string, EventListener[]>();
    const w = {
      addEventListener: (t: string, f: EventListener) => void on.set(t, [...(on.get(t) ?? []), f]),
      removeEventListener: (t: string, f: EventListener) => void on.set(t, (on.get(t) ?? []).filter((x) => x !== f)),
    } as unknown as Window;
    let timer: (() => void) | null = null;
    const ev = (type: string, x: number, y: number, kind = 'touch') => {
      let prevented = false;
      const e = { type, clientX: x, clientY: y, pointerType: kind, stopPropagation: () => undefined, preventDefault: () => (prevented = true) } as unknown as Event;
      for (const f of [...(on.get(type) ?? [])]) f(e);
      return { defaultPrevented: prevented };
    };
    return { w, ev, later: (f: () => void) => (timer = f), fire: () => timer?.() };
  }

  it("a second tap at the same spot within the window (90-200 ms, the reviewers' taps) closes the sheet and zooms, and its click never reaches the sheet", () => {
    const f = fakeWindow();
    let doubled = 0;
    armObjectDouble({ x: 120, y: 300 }, 'touch', () => doubled++, { w: f.w, ms: TAP.dblMs, px: TAP.dblObjPx, later: f.later });
    const down = f.ev('pointerdown', 126, 304);
    expect(doubled).toBe(1);
    expect(down.defaultPrevented).toBe(true);
    // the tap's click is eaten (on a tall sheet it would press a button; on the scrim, close what the zoom closed)
    expect(f.ev('click', 126, 304).defaultPrevented).toBe(true);
    // one double only: a third tap is the player's own
    expect(f.ev('pointerdown', 126, 304).defaultPrevented).toBe(false);
    expect(doubled).toBe(1);
  });

  it('a tap elsewhere, a mouse after a touch, or a tap after the window is the player\'s own: the sheet stays open', () => {
    for (const [x, y, kind, late] of [
      [120 + TAP.dblObjPx + 5, 300, 'touch', false],
      [121, 301, 'mouse', false],
      [121, 301, 'touch', true],
    ] as const) {
      const f = fakeWindow();
      let doubled = 0;
      armObjectDouble({ x: 120, y: 300 }, 'touch', () => doubled++, { w: f.w, ms: TAP.dblMs, px: TAP.dblObjPx, later: f.later });
      if (late) f.fire();
      const down = f.ev('pointerdown', x, y, kind);
      expect(doubled).toBe(0);
      expect(down.defaultPrevented).toBe(false);
      expect(f.ev('click', x, y, kind).defaultPrevented).toBe(false);
    }
    // a mouse double-click at 1280 px: armed by a mouse tap, the second press is a mouse's
    const f = fakeWindow();
    let doubled = 0;
    armObjectDouble({ x: 600, y: 400 }, 'mouse', () => doubled++, { w: f.w, later: f.later });
    f.ev('pointerdown', 600, 400, 'mouse');
    expect(doubled).toBe(1);
  });

  it("What's new says double-tap zooms on anything, and the map's hint what a tap on the ground does", () => {
    const s = island(5, 70, 2);
    const text = whatsNewMapPanels(s, 'mech').map((p) => vtext(p.body)).join(' ');
    expect(text).toContain('Double-tap to zoom in, on anything. Tap the ground for your zone or the whole island.');
    const src = readFileSync(resolve(import.meta.dirname, '../src/ui/map/MapView.tsx'), 'utf8');
    expect(src).toContain("{verb} ground: {role ? 'zone ↔ all' : atAll ? 'zoom' : 'whole island'}");
  });
});

describe("the electrician's IR write-up: the breaker the scan read, never a random branch circuit (trades major)", () => {
  it("siteOf on every island-panel row, right call or wrong, reads the schedule's rating and conductors (the reviewers' seeds 1-39)", () => {
    const s = island(5, 70, 5);
    const want: Record<string, string> = {
      main: 'Distribution panel · Main 400 A · 2 × 250 kcmil Al',
      cfeedE: 'Distribution panel · East cottages feeder 100 A · #3 Cu',
      hangar: 'Distribution panel · Hangar 60 A · #6 Cu',
      office: 'Distribution panel · Office 30 A · #10 Cu',
      villas: 'Distribution panel · Villas feeder 125 A · #1 Cu',
      lodge: 'Distribution panel · Lodge feeder 150 A · 1/0 Cu',
    };
    for (const [id, words] of Object.entries(want))
      for (let seed = 1; seed <= 39; seed++)
        for (const cause of [-1, 0]) {
          const site = siteOf(s, { seed, sym: `K_ir:${id}`, cause, role: 'elec', assetId: 'g1' })!;
          expect(siteWords(site), `${id} seed ${seed} cause ${cause}`).toBe(words);
        }
    // the job's Materials: no KP branch breaker for a feeder's or the main's hot lug; the teaching answer says re-terminate
    const al = raiseAlert(s, { role: 'elec', asset: s.assets.find((a) => a.kind === 'grid')!, sym: 'K_ir:main', cause: 0 }, NOW);
    const task = fixTaskFor(s, al)!;
    expect(stdPick(s, s.assets.find((a) => a.kind === 'grid')!, task, siteOf(s, al), ['breaker']).some((l) => /^KP1/.test(l.item))).toBe(false);
    const b = raiseAlert(s, { role: 'elec', asset: s.assets.find((a) => a.kind === 'grid')!, sym: 'K_ir:cfeedE', cause: 0 }, NOW);
    expect(siteAnswer(s, b, fixTaskFor(s, b)!)).toBe('this breaker: East cottages feeder 100 A on #3 Cu: a hot lug is re-terminated and torqued to the listing (110.14(D)), no branch breaker in it.');
  });

  it('the transfer-switch feed and the main read as installed: 200 A at the Resort, 100 A after a transfer job, 600 A after a panel upgrade', () => {
    const s = island(5, 70, 5);
    s.tier = 4;
    s.assets.find((a) => a.kind === 'generator')!.xfer = { amps: 100, awg: '#3 Cu', load: 70, week: 5 };
    s.assets.find((a) => a.kind === 'grid')!.panel = { amps: 600, awg: '2 × 500 kcmil Al', week: 5 };
    expect(siteWords(siteOf(s, { seed: 3, sym: 'K_ir:xfer', cause: 0, role: 'elec', assetId: 'g1' }))).toBe('Distribution panel · Transfer switch feed 100 A · #3 Cu');
    expect(siteWords(siteOf(s, { seed: 3, sym: 'K_ir:main', cause: -1, role: 'elec', assetId: 'g1' }))).toBe('Distribution panel · Main 600 A · 2 × 500 kcmil Al');
    s.tier = 5;
    expect(siteWords(siteOf(s, { seed: 3, sym: 'K_ir:xfer', cause: 0, role: 'elec', assetId: 'g1' }))).toBe('Distribution panel · Transfer switch feed 200 A · 3/0 Cu');
  });

  it("a meter check's no-fault write-up reads the circuit the meter read (a bedroom's 15 A on 14 AWG, never 20 A on 12)", () => {
    const s = island(5, 70, 3);
    for (let seed = 1; seed <= 60; seed++) {
      const site = siteOf(s, { seed, sym: 'K_meter:bedroom', cause: -1, role: 'elec', assetId: 'h1' })!;
      expect({ amps: site.amps, awg: site.awg }).toEqual({ amps: 15, awg: 14 });
    }
  });
});

describe("the island panel's IR scan: the main carries what the feeders carry (trades major)", () => {
  const branchSum = (v: NonNullable<ReturnType<typeof checkView>>) => v.items.filter((i) => i.id !== 'main').reduce((n, i) => n + (i.reading?.amps ?? 0), 0);

  it("the branches together never exceed the main's peak, on every scan of four three-friends seasons (52 weeks; the reviewers: 97% of tier-5 scans broke it)", () => {
    let scans = 0;
    let tells = 0;
    for (let seed = 1; seed <= 4; seed++)
      simulate(TEAMS['three friends'], 52, seed, (s) => {
        if (!canCheck({ ...s, turns: {} }, 'elec', 'g1').ok) return;
        const v = checkView(s, 'elec', 'g1')!;
        const main = v.items.find((i) => i.id === 'main')!.reading!;
        expect(branchSum(v), `seed ${seed} week ${s.week} tier ${s.tier}`).toBeLessThanOrEqual(main.peakAmps!);
        // under the 80% line without the tell; no branch over it either
        if (checkTruth(s, 'elec', 'g1', s.week)?.item === 'main') tells++;
        else expect(main.loadPct!).toBeLessThan(80);
        // (the transfer-switch feed over its rating with the take-off open is the overload the take-off quotes)
        for (const i of v.items) if (i.id !== 'main' && !(i.id === 'xfer' && backedUp(s)?.over)) expect(i.reading!.loadPct!, i.label).toBeLessThan(80);
        scans++;
      });
    expect(scans).toBeGreaterThan(150);
    void tells;
  });

  it("a feeder carries what its houses draw: light when they're all closed (v4-e810cc5-t5-late, every house closed); the main's tell only where the feeders can carry it (tier 4+)", () => {
    const s = migrate(load('v4-e810cc5-t5-late'));
    s.turns = {};
    expect(s.assets.filter((a) => a.kind === 'house').every((h) => !houseRentable(s, h))).toBe(true);
    const v = checkView(s, 'elec', 'g1')!;
    for (const id of ['cfeedE', 'cfeedW', 'villas', 'lodge']) expect(v.items.find((i) => i.id === id)!.reading!.loadPct!, id).toBeLessThanOrEqual(8);
    expect(branchSum(v)).toBeLessThanOrEqual(v.items.find((i) => i.id === 'main')!.reading!.peakAmps!);
    // the main's tell (82-95% continuous) never at tiers 1-3: their feeder breakers can't carry that much
    for (let seed = 1; seed <= 200; seed++)
      for (const tier of [1, 2, 3]) expect(checkTruth(island(seed, 50, tier), 'elec', 'g1', 6)?.item, `seed ${seed} tier ${tier}`).not.toBe('main');
  });
});

describe('the quick checks read the power state (trades minor)', () => {
  it('a dark island: no meter check on a house with no power, no IR scan of a down grid, no scan of a set that failed its test run', () => {
    const s = migrate(load('v4-e810cc5-t2'));
    s.turns = {};
    s.tier = 3;
    const g = s.assets.find((a) => a.kind === 'grid')!;
    g.health = 30;
    expect(canCheck(s, 'elec', 'h1')).toEqual({ ok: false, why: 'Cottage 1 has no power (the grid is down): nothing to meter under load.' });
    expect(canCheck(s, 'elec', g.id)).toEqual({ ok: false, why: "The utility feed is down: nothing on the island panel is energized to scan. Scan it when it's back." });
    const t = island(5, 70, 3);
    t.assets.find((a) => a.kind === 'generator')!.health = 38.6;
    expect(canCheck(t, 'elec', 'gen')).toEqual({ ok: false, why: 'The weekly test run failed to pick up the load (the set is under 50): nothing loaded to scan.' });
    // the grid down with the set carrying the houses: they're powered, the meter reads
    t.assets.find((a) => a.kind === 'generator')!.health = 70;
    t.assets.find((a) => a.kind === 'grid')!.health = 30;
    expect(canCheck(t, 'elec', 'h1').ok).toBe(true);
  });
});

describe("the transfer switch before the Resort: rated for the backed-up load, load management on the set (trades major)", () => {
  it("the reviewers' three friends, seed 1: the take-off's words, the job's lot and reference; after the job the switch and its feed are 100 A on #3 Cu and still carry the load on the utility, the set's test run at most its 60 A", () => {
    let take: IslandState | null = null;
    let after: IslandState | null = null;
    simulate(TEAMS['three friends'], 17, 1, (s) => {
      const gen = s.assets.find((a) => a.kind === 'generator');
      if (!take && liveAlerts(s).some((a) => a.sym === 'E_TAKEOFF_XFER')) take = structuredClone(s);
      if (gen?.xfer && !after) after = structuredClone(s);
    });
    const t = take as unknown as IslandState;
    const al = liveAlerts(t).find((a) => a.sym === 'E_TAKEOFF_XFER')!;
    const load = siteOf(t, al)!.load!;
    expect(symptomText(t, al)).toBe(
      `The houses now back up ${load} A on the 60 A transfer switch and the 60 A set: fit an automatic switch rated for the backed-up load (100 A, its feed breaker and conductors to match: #3 Cu), with load management so the 60 A set carries no more than its rating (702.4(B)(2)(b)).`,
    );
    expect(itemById('LOT-XFER')!.nomen).toBe('Transfer switch lot: automatic transfer switch rated for the backed-up load, with load management for the standby set (702.4(B)(2)(b)), its feed breaker and conductors');
    expect(taskById('ref:xfer')!.summary).toMatch(/^A standby system’s transfer equipment is rated for the load it carries on the normal source, its feed breaker and conductors to match; where the set is smaller than that load, load management holds what the set carries to its capacity \(702\.4\(B\)\(2\)\(b\)\)/);
    const s = after as unknown as IslandState;
    s.turns = {};
    const gen = s.assets.find((a) => a.kind === 'generator')!;
    expect(gen.xfer).toMatchObject({ amps: 100, awg: '#3 Cu', load });
    const b = backedUp(s)!;
    expect(b.rating).toBe(100);
    expect(b.amps).toBeGreaterThanOrEqual(Math.floor(load * 0.94));
    expect(b.test).toBeLessThanOrEqual(60);
    const feed = checkView(s, 'elec', 'g1')!.items.find((i) => i.id === 'xfer')!;
    expect(feed.label).toBe('Transfer switch feed 100 A · #3 Cu');
    expect(feed.reading!.amps).toBe(b.amps);
    const g = checkView(s, 'elec', gen.id)!.items;
    expect(g.find((i) => i.id === 'xferG')!.label).toBe('Transfer switch, generator-side lugs 100 A · #3 Cu');
    expect(g.find((i) => i.id === 'genbrk')!.label).toBe('Generator main breaker 60 A · #6 Cu');
    expect(g.find((i) => i.id === 'genbrk')!.reading!.amps).toBe(b.test);
    expect(gridSchedule(s).rows.find((r) => r.label === 'Transfer switch feed')).toMatchObject({ rating: '100 A', wire: '#3 Cu' });
    expect(factsText(facts(s, assetRef(gen), 'elec'))).toContain('Automatic transfer switch 100 A on #3 Cu THWN, with load management; generator main 60 A on #6 Cu (the set: load management holds it to 60 A).');
    // its take-off never comes back: the switch is rated for the load
    expect(pairsFor('transfer', gen, false, s).some((p) => p.sym.key === 'E_TAKEOFF_XFER')).toBe(false);
  });
});

describe('the panel upgrade on record (trades minor)', () => {
  it("signed off, the island panel reads its 600 A main from then on: the schedule, the IR scan and the load trend (the reviewers' three friends, seed 7)", () => {
    const s0 = island(5, 50, 4);
    const al0 = raiseAlert(s0, { role: 'elec', asset: s0.assets.find((a) => a.kind === 'grid')!, sym: 'E_PANEL_LOAD', cause: 0 }, NOW);
    expect(findingOf(s0, al0, 3).text).toMatch(/^Peak demand 368 A on a 400 A bus/);
    let s: IslandState | null = null;
    simulate(TEAMS['three friends'], 24, 7, (x) => {
      if (!s && x.assets.find((a) => a.kind === 'grid')?.panel) s = structuredClone(x);
    });
    const t = s as unknown as IslandState;
    expect(t).not.toBeNull();
    t.turns = {};
    expect(t.assets.find((a) => a.kind === 'grid')!.panel).toMatchObject({ amps: 600, awg: '2 × 500 kcmil Al' });
    expect(gridSchedule(t).rows[0]).toMatchObject({ label: 'Main', rating: '600 A', wire: '2 × 500 kcmil Al' });
    expect(checkView(t, 'elec', 'g1')!.items[0].label).toBe('Main 600 A · 2 × 500 kcmil Al');
    const again = raiseAlert(t, { role: 'elec', asset: t.assets.find((a) => a.kind === 'grid')!, sym: 'E_PANEL_LOAD', cause: 0 }, NOW);
    expect(findingOf(t, again, 3).text).toMatch(/^Peak demand 552 A on a 600 A bus/);
  });
});

describe('the renovation case against the engine (code major, trades major)', () => {
  it("the weeks it's closed are the resolves that find it closed for the work: 1 with one builder (skill 3 or 5), 0 with two when the final passes the week it lands (the reviewers' seeds 2-5)", () => {
    const team = TEAMS['all good'];
    const crew: Team = { mech: { ...team.mech, flags: false, checks: false }, elec: { ...team.elec, flags: false, checks: false }, fin: { ...team.fin, flags: false, checks: false } };
    let matched = 0;
    for (const skills of [[3], [5], [3, 3]])
      for (const seed of [2, 3, 4, 5]) {
        let s = structuredClone(simulate(team, 30, seed).final);
        s.cash = 100000;
        for (const a of s.assets)
          if (a.kind === 'house') {
            a.health = 90;
            delete a.warrantyUntil;
            a.inspectionUntil = s.week + 20;
          }
        house(s, 'h1').health = 45;
        s.alerts = [];
        s.orders = s.orders.filter((o) => o.status === 'done');
        s.staff = [...(s.staff ?? []).filter((n) => n.role !== 'builder'), ...skills.map((skill, i) => ({ id: `nb${i}`, name: `B${i}`, role: 'builder' as const, skill: skill as Npc['skill'], wage: 260, hired: s.week - 5, start: s.week - 5 }))];
        s.builds = (s.builds ?? []).filter((b) => b.finished !== undefined);
        s = ok(s, { t: 'build', what: 'reno', asset: 'h1', week: s.week } as Action);
        const b = s.builds!.find((x) => x.reno === 'h1')!;
        for (let k = 0; k < b.need; k++) for (const l of unitLines(b, k)) ((s.inv ??= {})[l.item] ??= { on: 0 }).on += l.qty;
        // (the case as it reads with both units' materials on the shelf: round-3 verification, with two builders it says
        // 0 only then; tests/stage2r3v.test.ts has the case without them)
        const p = renoPlan(s, house(s, 'h1'));
        let closed = 0;
        for (let w = 0; w < 6; w++) {
          const week = s.week;
          for (const role of ROLES) s = botTurn(s, role, crew[role], rng(hashSeed('r3', seed, role, week)), ++clock);
          if (/^renovation/.test(houseBlocker(s, house(s, 'h1')) ?? '')) closed++;
          for (const role of ROLES) s = apply(s, { t: 'endTurn', role, week }, ++clock).s;
          if (s.week === week) s = apply(s, { t: 'resolve', week }, (s.deadline ?? clock) + 1000).s;
          const bb = s.builds!.find((x) => x.reno === 'h1')!;
          if (bb.signed !== undefined) break;
        }
        const bb = s.builds!.find((x) => x.reno === 'h1')!;
        expect(bb.signed, `skills ${skills} seed ${seed}`).toBeDefined();
        // (a builder's rework costs a week the case can't see coming)
        if (bb.rework) continue;
        expect(closed, `skills ${skills} seed ${seed}`).toBe(p.weeksClosed);
        expect(bb.signed! - bb.started).toBe(p.toFinal);
        matched++;
      }
    expect(matched).toBeGreaterThanOrEqual(10);
  });

  it("a house closed only for now (this week's red tag, a hazard, a lapsed inspection) is counted open at its health: the verdict holds (v4-e810cc5-t5, Villa East)", () => {
    const base = firstMove('v4-e810cc5-t5').s;
    const verdict = (p: ReturnType<typeof renoPlan>) => ({ payback: p.payback, rentLost: p.rentLost, closesIn: p.closesIn, rentNow: p.rentNow });
    const open = renoPlan(base, house(base, 'h5'));
    expect(open.closedFor).toBeNull();
    const tag = structuredClone(base);
    tag.tags = { ...(tag.tags ?? {}), h5: 'elec' };
    const lapsed = structuredClone(base);
    house(lapsed, 'h5').inspectionUntil = lapsed.week - 1;
    const hz = structuredClone(base);
    raiseAlert(hz, { role: 'elec', asset: house(hz, 'h5'), sym: 'E_WARM_OUTLET', cause: 0 }, NOW);
    for (const [why, s] of [
      ['red-tagged', tag],
      ['inspection lapsed', lapsed],
      ['hazard', hz],
    ] as const) {
      const p = renoPlan(s, house(s, 'h5'));
      expect(verdict(p), why).toEqual(verdict(open));
      expect(p.closedFor).toBe(why);
      expect(p.closedNow).toBeNull();
    }
    // under 40 is the one lasting closure: nothing to lose, the renovation reopens it
    const low = structuredClone(base);
    house(low, 'h5').health = 38;
    expect(renoPlan(low, house(low, 'h5'))).toMatchObject({ rentNow: 0, rentLost: 0, closesIn: 0, closedNow: 'reliability 38' });
  });
});

describe('a started renovation under the stock freeze or in receivership (code minor)', () => {
  /** the reviewers' r3reno: the Lodge's renovation with its first unit drawn, its second unit's materials nowhere */
  function started(): IslandState {
    let s = structuredClone(simulate(TEAMS['all good'], 30, 2).final);
    s.staff = [...(s.staff ?? []).filter((n) => n.role !== 'builder'), { id: 'nb1', name: 'Kai M.', role: 'builder', skill: 3, wage: 260, hired: s.week - 5, start: s.week - 5 }];
    s.builds = (s.builds ?? []).filter((b) => b.finished !== undefined);
    s.cash = 60000;
    house(s, 'h7').health = 60;
    s = ok(s, { t: 'build', what: 'reno', asset: 'h7', week: s.week } as Action);
    const b = s.builds!.find((x) => x.reno === 'h7')!;
    b.drawn = 1;
    b.done = 1;
    for (const k of Object.keys(s.inv ?? {})) if (k.startsWith('BLD-')) delete s.inv![k];
    for (const p of s.pos ?? []) p.lines = p.lines.filter((l) => !l.item.startsWith('BLD-'));
    return s;
  }

  it("its remaining materials go through the $2,000 freeze (committed work: the house is closed until they're in); anything else stays frozen", () => {
    const s = started();
    // spendable $1,900: under the freeze, over the unit's cost
    s.cash += 1900 - spendable(s);
    const b = s.builds!.find((x) => x.reno === 'h7')!;
    expect(renovating(s, 'h7')).toBe(true);
    const r = apply(s, { t: 'buy', lines: unitLines(b, 1), week: s.week }, ++clock);
    expect(r.error).toBeUndefined();
    expect(renoShort(r.s, true)).toEqual([]);
    expect(apply(s, { t: 'buy', lines: [{ item: 'KP120', qty: 1 }], week: s.week }, ++clock).error).toBe('Spendable cash under $2,000: stock orders are frozen.');
  });

  it('in receivership the receiver funds them from its allowance, into the bridge loan; autopilot buys them too', () => {
    const s = started();
    s.cash = -4000;
    s.receivership = 2;
    const b = s.builds!.find((x) => x.reno === 'h7')!;
    const loan = s.loan?.left ?? 0;
    const r = apply(s, { t: 'buy', lines: unitLines(b, 1), week: s.week }, ++clock);
    expect(r.error).toBeUndefined();
    expect(r.s.loan!.left).toBeGreaterThan(loan);
    expect(r.s.feed.at(-2)?.text ?? r.s.feed.at(-1)!.text).toMatch(/The receiver funds \$[\d,]+ .* for a started renovation's materials \(committed: the house is closed until they're in\)/);
    // the analyst away: autopilot places the order at the resolve
    const t = started();
    t.cash += 1900 - spendable(t);
    let u = t;
    for (const role of ['mech', 'elec'] as const) u = ok(u, { t: 'endTurn', role, week: u.week });
    u = apply(u, { t: 'resolve', week: u.week }, (u.deadline ?? clock) + 1000).s;
    expect((u.pos ?? []).some((p) => p.lines.some((l) => l.item.startsWith('BLD-')))).toBe(true);
  });
});

describe("the quick check's tell holds all week (code minor)", () => {
  it("the reviewers' r3race: a crewmate's flag on the same plane in the same week no longer moves the walkaround's tell; the call on what he saw lands", () => {
    let moved = 0;
    let tried = 0;
    for (let seed = 1; seed <= 40; seed++) {
      let s = island(seed, 52, 3);
      const before = checkTruth(s, 'mech', 'p1', 6);
      const view = checkView(s, 'mech', 'p1')!.items.map((i) => i.text);
      if (!before) continue;
      const f = apply(s, { t: 'flag', role: 'elec', assetId: 'p1', week: 6 }, ++clock);
      if (f.error) continue;
      tried++;
      s = f.s;
      if (JSON.stringify(checkTruth(s, 'mech', 'p1', 6)) !== JSON.stringify(before)) moved++;
      expect(checkView(s, 'mech', 'p1')!.items.map((i) => i.text), `seed ${seed}`).toEqual(view);
      s = ok(s, { t: 'check', role: 'mech', assetId: 'p1', item: before.item, week: 6 } as Action);
      const up = s.alerts!.at(-1)!;
      expect(up.src).toBe('check');
      expect(up.cause, `seed ${seed}`).toBeGreaterThanOrEqual(0);
    }
    expect(tried).toBeGreaterThan(5);
    expect(moved).toBe(0);
  });
});

describe("the analyst's and the techs' sheets (trades and systems minors)", () => {
  it("pilots sharing a plane fly what it flies between them, and its sheet names them all (v4-e810cc5-t5-late, Float F-3)", () => {
    const s = migrate(load('v4-e810cc5-t5-late'));
    const f3 = s.assets.find((a) => a.id === 'p3')!;
    const flights = (name: string) => Number(/Float F-3: (\d+) flight/.exec(doingNow(s, s.staff!.find((n) => n.name === name)!))?.[1] ?? 0);
    expect(flights('Hemi R.') + flights('Mateo D.')).toBe(capOf(s, f3));
    expect(factsText(facts(s, assetRef(f3), 'fin'))).toContain('Flown by Hemi R. (skill 3, $320 a week) and Mateo D. (skill 4, $380 a week).');
  });

  it("an AOG plane's analyst sheet says the tours lost and the sub-charter apart, and their sum (v3-bd1e1d2-restricted-mel)", () => {
    const s = migrate(load('v3-bd1e1d2-restricted-mel'));
    expect(facts(s, assetRef(s.assets.find((a) => a.id === 'p1')!), 'fin').status).toBe('AOG this week: about $1,208 of tours lost + $540 sub-charter = $1,748');
  });

  it("no Ground call on a plane already on the ground (v4-e810cc5-subcharter's AOG twin); a flying plane keeps it", () => {
    const s = migrate(load('v4-e810cc5-subcharter'));
    const f = facts(s, assetRef(s.assets.find((a) => a.id === 'p1')!), 'mech');
    expect(f.status).toMatch(/^AOG: /);
    expect(f.actions.some((a) => a.t === 'tag')).toBe(false);
    const t = island(5, 70, 2);
    expect(facts(t, assetRef(t.assets.find((a) => a.id === 'p1')!), 'mech').actions.some((a) => a.t === 'tag')).toBe(true);
  });

  it("the extra cottage's case with no builder leads with hiring one, and counts from their start (v4-e810cc5-t5-late)", () => {
    const s = migrate(load('v4-e810cc5-t5-late'));
    expect(s.staff!.some((n) => n.role === 'builder')).toBe(false);
    const c = s.assets.find((a) => a.kind === 'house' && a.model === 'cottage')!;
    expect(factsText(facts(s, assetRef(c), 'fin'))).toMatch(/No builder on the payroll: hire one first\. An extra cottage like it: \$[\d,]+, rents about \$[\d,]+ a week, pays back in about \d+ weeks, counted from when a builder starts\./);
  });

  it("the windsock's storm line: every house and the grid take the hit; it names the ones it takes under 40, with links (v4-e810cc5-t5)", () => {
    const s = migrate(load('v4-e810cc5-t5'));
    s.weather = 'storm';
    const f = facts(s, fixtureRef('windsock'), 'elec');
    expect(factsText(f)).toContain("Every house takes −6 and the grid −8 at the resolve, on top of the week's wear. Closest to closing (40): Villa West (44 → 37).");
    expect(f.actions.filter((a) => a.t === 'object').map((a) => (a as { label: string }).label)).toEqual(['Villa West']);
  });

  it('the twin walkaround stops at its empennage too (the controls, hinges, trim tab and static wicks)', () => {
    const s = island(5, 70, 2);
    expect(checkView(s, 'mech', 'p1')!.items.map((i) => i.label)).toEqual(['Nose gear', 'L main', 'L nacelle', 'Wing root', 'Empennage', 'R nacelle', 'R main']);
    expect(SYMPTOMS['K_walk:tail'].models).toContain('twin');
  });
});

describe('the words the trades read (trades minors)', () => {
  it("a relayed storm complaint names its house once", () => {
    const s = island(5, 60, 3);
    const al = raiseFlag(s, 'fin', house(s, 'h4'), 'elec', { sym: 'E_STORM_DEAD', cause: 0 }, NOW);
    expect(symptomText(s, al)).toBe("Cy passed on a guest's complaint at Cottage 4: water in the porch box after the rain.");
    s.history.push({ ...(s.history.at(-1) ?? ({} as IslandState['history'][number])), week: s.week - 1, weather: 'storm' });
    expect(symptomText(s, al)).toBe("Cy passed on a guest's complaint at Cottage 4: two rooms dead, water in the porch box.");
    const own = raiseAlert(s, { role: 'elec', asset: house(s, 'h4'), sym: 'E_STORM_DEAD', cause: 0 }, NOW);
    expect(symptomText(s, own)).toBe('After the storm at Cottage 4: two rooms dead, water in the porch box.');
  });

  it("the generator's lugs run as they should; the utility side is its open contacts, its lugs live", () => {
    expect(SYMPTOMS['K_ir:xferG'].nff![0].finding).toBe('Re-scanned during the next test run: the transfer switch, generator-side lugs run as they should for the load. Nothing to open up.');
    expect(SYMPTOMS['K_ir:genbrk'].nff![0].finding).toBe('Re-scanned during the next test run: the generator main breaker runs as it should for the load. Nothing to open up.');
    expect(GEN_PANEL.find((b) => b.id === 'xferU')!.label).toBe('Transfer switch, utility side (contacts open)');
  });

  it('a house under 40 with a hazard stays closed either way: no 75% line for the electrician or the analyst', () => {
    let s = island(5, 35, 3);
    const al = raiseAlert(s, { role: 'elec', asset: house(s, 'h1'), sym: 'E_WARM_OUTLET', cause: 0 }, NOW);
    expect(factsText(facts(s, assetRef(house(s, 'h1')), 'elec'))).toContain(`Hazard open: ${alertShort(s, al).charAt(0).toUpperCase() + alertShort(s, al).slice(1)}. The house is shut until it's made safe or fixed. It stays closed under 40 until it's brought back up.`);
    s = ok(s, { t: 'makeSafe', role: 'elec', alert: al.id, how: 'breaker' });
    expect(s.feed.at(-1)!.text).toMatch(/: it stays closed under 40 until it's brought back up\.$/);
    const elec = factsText(facts(s, assetRef(house(s, 'h1')), 'elec'));
    expect(elec).toMatch(/It stays closed under 40 until it's brought back up\./);
    expect(elec).not.toMatch(/75%/);
    expect(factsText(facts(s, assetRef(house(s, 'h1')), 'fin'))).not.toMatch(/at 75% while it is made safe/);
  });

  it("the renovation case's weeks in all, net of the weeks it's closed for the work", () => {
    const s = firstMove('v4-e810cc5-t5').s;
    const p = renoPlan(s, house(s, 'h5'));
    const text = vtext(RenoNumbers({ s, h: house(s, 'h5') }));
    const net = Math.max(0, p.gained - Math.min(p.weeksClosed, Math.max(0, p.closesIn - 1)));
    expect(text).toContain(`open about ${net} more week${net === 1 ? '' : 's'} in all than left as it is`);
    expect(text).toContain(p.weeksClosed ? `(it's closed ${p.weeksClosed} for the work)` : 'in all than left as it is:');
    expect(text).toMatch(/closed \d+ weeks?; it opens when the county's final passes, the week after the last unit \(\+1 week if it isn't passed that week\)/);
  });
});

describe('a house in or after its renovation (play-fun minor)', () => {
  it('closed for it: no red-tag call and no write-up for the electrician (nobody is in it; its final covers the electrical side)', () => {
    let s = island(5, 60, 4);
    s.staff = [...(s.staff ?? []), { id: 'nb1', name: 'Kai M.', role: 'builder', skill: 3, wage: 260, hired: 1, start: 1 }];
    s.cash = 40000;
    s = ok(s, { t: 'build', what: 'reno', asset: 'h1', week: s.week } as Action);
    s.builds!.find((b) => b.reno === 'h1')!.drawn = 1;
    const f = facts(s, assetRef(house(s, 'h1')), 'elec');
    expect(f.actions.some((a) => a.t === 'tag')).toBe(false);
    expect(f.report).toMatchObject({ t: 'own', ok: false, why: "Cottage 1 is closed for its renovation: its county final covers the electrical side." });
    expect(apply(s, { t: 'squawk', role: 'elec', assetId: 'h1', kind: 'trip', week: s.week } as Action, ++clock).error).toBe('Cottage 1 is closed for its renovation: its county final covers the electrical side.');
  });
});

describe('the week\'s quick check on Home while it\'s open (play-fun minor)', () => {
  it("Your move and End turn say the walkaround is still open, linked to the worst plane's sheet; gone once it's done", () => {
    let s = island(5, 70, 2);
    s.assets.find((a) => a.id === 'p2')!.health = 52;
    const qc = quickCheckMove(s, 'mech')!;
    expect(qc).toMatchObject({ label: 'Walkaround: one a week', sub: 'Worst: Cargo C-7 (52)', ref: { kind: 'plane', id: 'p2' } });
    expect(endTurnChecks(s, 'mech').map((c) => c.text)).toContain('Your walkaround is still open this week: the worst plane is Cargo C-7 (condition 52). An early catch plays a tier cheaper.');
    expect(quickCheckMove(s, 'elec')!.label).toBe('IR scan or meter check: one a week');
    expect(quickCheckMove(s, 'fin')).toBeNull();
    s = ok(s, { t: 'check', role: 'mech', assetId: 'p2', item: null, week: s.week } as Action);
    expect(quickCheckMove(s, 'mech')).toBeNull();
    expect(endTurnChecks(s, 'mech').some((c) => /walkaround is still open/.test(c.text))).toBe(false);
    // tier 1: the checks aren't open yet
    expect(quickCheckMove(island(5, 70, 1), 'mech')).toBeNull();
  });
});

describe("What's new: the words that drifted (play-fun minor)", () => {
  it("each seat's pages say what it can pass on and do now; the upkeep page waits for tier 3 (v4-e810cc5-early)", () => {
    const s = migrate(load('v4-e810cc5-early'));
    const text = (r: 'mech' | 'elec' | 'fin') => whatsNewMapPanels(s, r).map((p) => vtext(p.body)).join(' ');
    expect(text('elec')).toContain('A plane: an electrical check the mechanic asked of you. Or pass on what its pilot reported.');
    expect(text('fin')).toContain('A staff figure: what they cost and do; hire from the Hiring board.');
    expect(text('mech')).toContain("as what its source said (a guest's complaint, the utility's log)");
    expect(text('elec')).toContain("as what its source said (the pilot's squawk)");
    for (const r of ['elec', 'fin'] as const) expect(text(r)).not.toMatch(/walkaround write-up/);
    expect(text('mech')).toMatch(/walkaround write-up on a plane is an airworthiness item/);
    expect(s.tier).toBeLessThan(3);
    for (const r of ROLES) {
      expect(whatsNewUpkeepPanels(s, r)).toEqual([]);
      expect(text(r)).toContain('From the Harbor (tier 4): builder’s warranties on new buildings, a service upgrade and renovations.');
      expect(text(r)).toContain("It takes a slot the week's draw would have filled");
    }
    expect(text('fin')).toContain("A guest's reported shock or burning smell closes the house at once");
    // (round-3 verification: autopilot's whole job flow for it, and End turn's make-safe line for one passed on during the turn)
    expect(text('elec')).toContain("make it safe or fix it before you end your turn. One passed on after your turn you can still make safe that night; if you don't, autopilot takes it at the resolve as it would if you were away (made safe, and fixed at 50% if its parts are on the shelf).");
  });
});
