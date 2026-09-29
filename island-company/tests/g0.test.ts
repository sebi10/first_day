// G0, "the Resort holds for 64 weeks" (stage 2, v5; DECISIONS 2026-09-30): what tests/warranty.test.ts (the builder's
// warranty, the service upgrade, the renovation's basics) doesn't cover.
//   - renovations: the cooldown (one per house every 26 weeks), the cycle in play (queued, closed, the electrician's
//     permit final, reopened under its warranty), a live code notice doubling as the final, autopilot buying an
//     ordered renovation's materials and never ordering one
//   - the bots: the fin bot's policy (RENO_BOT: trigger 55, at most 2 open, $20,000 kept, the tier-5 cash gate first
//     unless the house is under 40) and the naive analyst's (the cheapest house at 75 or below while cash is over $15,000)
//   - the credits' goal, one data switch (GOAL.rule): 'streak' the default; 'quarter' computed from the week reports,
//     so a live island's Resort weeks count at once
//   - the one-time migration of docs an older engine wrote (engine < 5) at tier 4-5, from docs e810cc5 wrote
//     (scripts/fixtures-v4.ts)
//   - the words every seat reads (the house's sheet, the electrician's flags, What's new)
//   - nobody wins alone over 64 weeks, under either goal
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { liveAlerts, raiseAlert } from '../src/sim/alerts';
import { botTurn, simulate, TEAMS } from '../src/sim/bots';
import { GOAL, RENO, RENO_BOT, WARRANTY } from '../src/sim/data';
import { goalCount, goalMet, goalWindow, houseRentable, onPlan, pausedWeek, renoAwaitingFinal, renovating, urgency, type GoalWeek } from '../src/sim/econ';
import { apply, ENGINE_VERSION } from '../src/sim/engine';
import { spendable } from '../src/sim/ledger';
import { G0_ENGINE, migrate } from '../src/sim/migrate';
import { hashSeed, rng } from '../src/sim/rng';
import { autoStaff, botStaff, renoAgainFrom, renoCost, renoFinals, renoPlan } from '../src/sim/staff';
import { ROLES, type Asset, type Build, type IslandState, type Npc, type WeekReport } from '../src/sim/types';
import { flagsOf } from '../src/ui/flow/words';
import { harborLines } from '../src/ui/harbor';
import { facts, factsText } from '../src/ui/inspect/facts';
import { assetRef } from '../src/ui/objects';
import { renoStatus, warrantyLine } from '../src/ui/staff/model';
import { whatsNewUpkeepPanels } from '../src/ui/staff/WhatsNewUpkeep';
import { expectLiveMigration } from './livedocs';

vi.setConfig({ testTimeout: 60000 });

const NOW = Date.UTC(2026, 8, 30, 10);
const load = (name: string): IslandState => JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures', `${name}.json`), 'utf8'));
const clone = <T>(x: T): T => structuredClone(x);
const house = (s: IslandState, id: string) => s.assets.find((a) => a.id === id && a.kind === 'house')!;
const setRule = (rule: typeof GOAL.rule) => {
  const was = GOAL.rule;
  GOAL.rule = rule;
  onTestFinished(() => void (GOAL.rule = was));
};

/** a crew's own bots play one week, every seat, then the resolve (as the paper sim plays) */
function playWeek(doc: IslandState, team: string): IslandState {
  let s = doc;
  const W = s.week;
  const now = (s.deadline ?? NOW) - 3600_000;
  for (const role of ROLES) {
    if (s.week !== W) break;
    s = botTurn(s, role, TEAMS[team][role], rng(hashSeed('g0', s.id, role, W)), now);
    s = apply(s, { t: 'endTurn', role, week: W }, now).s;
  }
  if (s.week === W) s = apply(s, { t: 'resolve', week: W }, (s.deadline ?? now) + 1000).s;
  expect(s.week).toBe(W + 1);
  return s;
}

const builder = (s: IslandState): Npc => ({ id: `n${s.nextId++}`, name: 'Kai M.', role: 'builder', skill: 3, wage: 260, hired: s.week - 5, start: s.week - 5 });

/** a Resort from the sim, cash to spare, one builder, every house healthy and out of warranty but h1 (45), no renovation on the list */
function resort(seed = 2): IslandState {
  const s = simulate(TEAMS['all good'], 30, seed).final;
  expect(s.tier).toBe(5);
  s.cash = 100_000;
  for (const h of s.assets.filter((a) => a.kind === 'house')) {
    h.health = h.id === 'h1' ? 45 : 90;
    delete h.warrantyUntil;
  }
  s.builds = (s.builds ?? []).filter((b) => !b.reno);
  s.staff = [...(s.staff ?? []).filter((n) => n.role !== 'builder'), builder(s)];
  return s;
}
const renos = (s: IslandState) => (s.builds ?? []).filter((b) => b.reno);
const order = (s: IslandState, id: string) => apply(s, { t: 'build', what: 'reno', asset: id, week: s.week }, NOW);

// ---------------------------------------------------------------------------

describe('renovations: the rules', () => {
  it('one renovation per house every 26 weeks, counted from the week it was ordered; the reason names the week it opens again', () => {
    const s0 = resort();
    const W = s0.week;
    const r = order(s0, 'h1');
    expect(r.error).toBeUndefined();
    expect(renoAgainFrom(r.s, 'h1')).toBe(W + RENO.cooldown);
    // the builders finished it and the final was signed; the house is worn again 10 weeks later
    const s = clone(r.s);
    const b = s.builds!.find((x) => x.reno === 'h1')!;
    Object.assign(b, { drawn: b.need, done: b.need, finished: W + 2, signed: W + 3 });
    s.week = W + 10;
    house(s, 'h1').health = 50;
    expect(order(s, 'h1').error).toBe(`Cottage 1 was renovated recently: one renovation per house every ${RENO.cooldown} weeks (again from week ${W + RENO.cooldown}).`);
    // (the signed renovation stays on the list until its cooldown ends, so the rule can read it)
    s.week = W + RENO.cooldown - 1;
    expect(order(s, 'h1').error).toMatch(/renovated recently/);
    s.week = W + RENO.cooldown;
    expect(order(s, 'h1').error).toBeUndefined();
    // another house isn't held by it
    s.week = W + 10;
    house(s, 'h2').health = 60;
    expect(order(s, 'h2').error).toBeUndefined();
  });

  it('refused below tier 4, on a house above 75, twice, in receivership and without the cash for the package; the package is paid at the order', () => {
    const s = resort();
    const r = order(s, 'h1');
    expect(r.s.cash).toBe(s.cash - renoCost({ model: 'cottage' }).pkg);
    expect(renoCost({ model: 'villa' })).toEqual({ pkg: 12_000, materials: 1_700 });
    expect(renoCost({ model: 'lodge' })).toEqual({ pkg: 16_000, materials: 2_550 });
    expect(order(r.s, 'h1').error).toMatch(/already on the list/);
    const fine = resort();
    house(fine, 'h2').health = RENO.maxHealth + 0.5;
    expect(order(fine, 'h2').error).toMatch(/good shape .*75 or below/);
    house(fine, 'h2').health = RENO.maxHealth;
    expect(order(fine, 'h2').error).toBeUndefined();
    const broke = resort();
    broke.receivership = 2;
    expect(order(broke, 'h1').error).toMatch(/receivership/);
    const poor = resort();
    poor.cash = 1000;
    expect(order(poor, 'h1').error).toMatch(/Not enough cash for the renovation package \(\$6,000\)/);
    const early = resort();
    early.tier = 3;
    expect(order(early, 'h1').error).toMatch(/open at tier 4/);
  });

  it("the case on the card: the package, the materials, weeks closed at the builders' output, rent lost, when it would close left alone, and the payback", () => {
    const s = resort();
    const p = renoPlan(s, house(s, 'h1'));
    expect(p.pkg).toBe(6000);
    expect(p.materials).toBe(850);
    expect(p.total).toBe(6850);
    // one skill-3 builder: 1 unit a week, 2 units, then the final's week
    expect(p.out).toBe(1);
    expect(p.weeksClosed).toBe(3);
    expect(p.rent).toBeGreaterThan(0);
    expect(p.rentLost).toBe(houseRentable(s, house(s, 'h1')) ? p.rent * 3 : 0);
    expect(p.restore).toBe(40);
    expect(p.payback).toBe(Math.max(p.closesIn, 3) + Math.ceil((p.total + p.rentLost) / p.rent));
    expect(p.blocker).toBeNull();
    // no builder: it can still be ordered (it waits for one), but nobody can say how long it's closed
    const none = resort();
    none.staff = none.staff!.filter((n) => n.role !== 'builder');
    expect(renoPlan(none, house(none, 'h1')).weeksClosed).toBeNull();
  });
});

describe('renovations in play', () => {
  it("ordered, it stays open until the builders start; closed while they work (no decay); the electrician's permit final (urgent, flagged 'house closed'); it opens at 85 under a 13-week warranty", () => {
    let s = order(resort(), 'h1').s;
    // (the materials come on the boat: the fin bot buys them)
    expect(renovating(s, 'h1')).toBe(false);
    const seen = { closed: 0, final: 0, signed: -1, health: [] as number[] };
    for (let i = 0; i < 10 && seen.signed < 0; i++) {
      const W = s.week;
      const was = house(s, 'h1').health;
      const closedAtStart = renovating(s, 'h1');
      if (closedAtStart) {
        seen.closed++;
        expect(houseRentable(s, house(s, 'h1'))).toBe(false);
      }
      const fin = renoAwaitingFinal(s, 'h1');
      if (fin) {
        seen.final++;
        const al = liveAlerts(s).find((a) => a.assetId === 'h1' && a.src === 'code');
        expect(al, `week ${W}: the final is on the list`).toBeDefined();
        expect(al!.role).toBe('elec');
        expect(flagsOf(s, al!).some((f) => f.text === 'house closed')).toBe(true);
        const o = al!.order ? s.orders.find((x) => x.id === al!.order) : undefined;
        if (o) expect(urgency(s, o)).toBeGreaterThanOrEqual(RENO.finalUrgency);
      }
      s = playWeek(s, 'all good');
      const b = s.builds!.find((x) => x.reno === 'h1');
      // a closed week: nobody's in it, so it doesn't decay (a storm still hits it)
      if (closedAtStart && renovating(s, 'h1') && b?.finished === undefined && s.history.at(-1)!.weather !== 'storm') expect(house(s, 'h1').health).toBeGreaterThanOrEqual(was);
      if (b?.signed !== undefined) seen.signed = b.signed;
    }
    expect(seen.closed).toBeGreaterThan(0);
    expect(seen.final).toBeGreaterThan(0);
    expect(seen.signed).toBeGreaterThan(0);
    const h = house(s, 'h1');
    expect(h.warrantyUntil).toBe(seen.signed + RENO.warranty);
    expect(h.health).toBeGreaterThanOrEqual(RENO.health - 8);
    expect(renovating(s, 'h1')).toBe(false);
    expect(h.inspectionUntil!).toBeGreaterThanOrEqual(s.week);
    expect(s.feed.some((f) => /Cottage 1 passed its final: open again, the renovation's warranty runs to week/.test(f.text))).toBe(true);
  });

  it("a code notice already open on the house is the final (the county does both on one visit): no second alert, and its sign-off opens the house", () => {
    let s = order(resort(3), 'h1').s;
    const b = s.builds!.find((x) => x.reno === 'h1')!;
    // the builders are done this week
    Object.assign(b, { drawn: b.need, done: b.need, finished: s.week });
    const notice = raiseAlert(s, { role: 'elec', asset: house(s, 'h1'), sym: 'E_CODE_DUE', due: s.week + 2, week: s.week }, NOW);
    expect(notice).toBeDefined();
    renoFinals(s, s.week + 1);
    const codes = () => liveAlerts(s).filter((a) => a.assetId === 'h1' && a.src === 'code');
    expect(codes().map((a) => a.sym)).toEqual(['E_CODE_DUE']);
    expect(flagsOf(s, codes()[0]).some((f) => f.text === 'house closed')).toBe(true);
    for (let i = 0; i < 6 && renoAwaitingFinal(s, 'h1'); i++) s = playWeek(s, 'all good');
    expect(renoAwaitingFinal(s, 'h1')).toBeUndefined();
    expect(s.builds!.find((x) => x.reno === 'h1')!.signed).toBeDefined();
    // without a notice open, the final is raised on its own, due the week after
    const t = order(resort(3), 'h1').s;
    Object.assign(t.builds!.find((x) => x.reno === 'h1')!, { drawn: 2, done: 2, finished: t.week });
    renoFinals(t, t.week + 1);
    const fin = liveAlerts(t).filter((a) => a.assetId === 'h1' && a.src === 'code');
    expect(fin.map((a) => [a.sym, a.role, a.due])).toEqual([['E_RENO_FINAL', 'elec', t.week + 1]]);
  });

  it('autopilot buys an ordered renovation’s materials (it’s committed), but never orders one', () => {
    const s = order(resort(), 'h1').s;
    for (const k of Object.keys(s.inv ?? {})) if (k.startsWith('BLD-')) delete s.inv![k];
    s.pos = (s.pos ?? []).filter((p) => !p.lines.some((l) => l.item.startsWith('BLD-')));
    const pos = s.pos.length;
    autoStaff(s);
    const bought = s.pos.slice(pos).flatMap((p) => p.lines.map((l) => l.item)).sort();
    expect(bought).toEqual(['BLD-FLASH', 'BLD-TRIM']);
    // worn houses, no renovation ordered: autopilot adds none
    const worn = resort();
    for (const h of worn.assets.filter((a) => a.kind === 'house')) h.health = 30;
    autoStaff(worn);
    expect(renos(worn)).toHaveLength(0);
  });
});

describe('the bots’ renovation policies', () => {
  const fin = TEAMS['three friends'].fin;
  const naive = TEAMS['naive analyst'].fin;
  const run = (s: IslandState, bot = fin) => botStaff(s, bot, rng(1), NOW);
  /** spendable cash set to exactly `v` */
  const spend = (s: IslandState, v: number) => {
    s.cash += v - spendable(s);
    return s;
  };

  it('the fin bot: a house under 55, out of its warranty, when the cash after it stays over $20,000', () => {
    expect(RENO_BOT).toMatchObject({ trigger: 55, maxOpen: 2, keep: 20_000, gateUnder: 40, naiveOver: 15_000 });
    const s = resort();
    house(s, 'h1').health = 50;
    expect(renos(run(clone(s))).map((b) => b.reno)).toEqual(['h1']);
    const ok = clone(s);
    house(ok, 'h1').health = 56;
    expect(renos(run(ok))).toHaveLength(0);
    const warranted = clone(s);
    house(warranted, 'h1').warrantyUntil = warranted.week + 3;
    expect(renos(run(warranted))).toHaveLength(0);
    const tight = spend(clone(s), 6850 + 19_000);
    expect(renos(run(tight))).toHaveLength(0);
    const enough = spend(clone(s), 6850 + 20_000 + 2000);
    expect(renos(run(enough))).toHaveLength(1);
  });

  it('the fin bot: at most 2 the builders haven’t finished; the most rent at stake first; never on cooldown', () => {
    const s = resort();
    for (const id of ['h1', 'h2', 'h5']) house(s, id).health = 40;
    // the villa (x2 rent) before the cottages
    const one = run(clone(s));
    expect(renos(one).map((b) => b.reno)).toEqual(['h5']);
    const two = run(run(clone(s)));
    expect(renos(two)).toHaveLength(2);
    expect(renos(run(two))).toHaveLength(2);
    // a house renovated 10 weeks ago isn't picked, whatever its health
    const cool = clone(s);
    house(cool, 'h2').health = 90;
    house(cool, 'h5').health = 90;
    cool.builds!.push({ id: `reno-cottage-h1-${cool.week - 10}`, what: 'Renovate Cottage 1', reno: 'h1', done: 2, drawn: 2, need: 2, started: cool.week - 10, finished: cool.week - 8, signed: cool.week - 7 } as Build);
    expect(renos(run(cool)).filter((b) => b.signed === undefined)).toHaveLength(0);
  });

  it('the fin bot at the Harbor: the Resort’s cash gate first, unless the house is closing (under 40)', () => {
    // (a Harbor doc: the tier-5 gate on the checklist)
    const s = simulate(TEAMS['all good'], 30, 1).final;
    s.tier = 4;
    delete s.stats.tierReachedWeek[5];
    s.assets = s.assets.filter((a) => a.id !== 'h7');
    s.project = null;
    for (const h of s.assets.filter((a) => a.kind === 'house')) {
      h.health = 90;
      delete h.warrantyUntil;
    }
    s.builds = (s.builds ?? []).filter((b) => !b.reno);
    s.staff = [...(s.staff ?? []).filter((n) => n.role !== 'builder'), builder(s)];
    spend(s, 50_000);
    house(s, 'h1').health = 50;
    expect(renos(run(clone(s)))).toHaveLength(0);
    house(s, 'h1').health = 35;
    expect(renos(run(clone(s))).map((b) => b.reno)).toEqual(['h1']);
  });

  it('the naive analyst: the cheapest house at 75 or below while spendable is over $15,000, warranty or not, up to 2 on the list', () => {
    const s = resort();
    house(s, 'h1').health = 90;
    house(s, 'h5').health = 60;
    house(s, 'h3').health = 74;
    house(s, 'h3').warrantyUntil = s.week + 5;
    // the cottage (cheapest package) before the villa, even under its warranty
    const a = run(spend(clone(s), 40_000), naive);
    expect(renos(a).map((b) => b.reno)).toEqual(['h3']);
    const b2 = run(run(spend(clone(s), 60_000), naive), naive);
    expect(renos(b2).map((b) => b.reno).sort()).toEqual(['h3', 'h5']);
    expect(renos(run(clone(b2), naive))).toHaveLength(2);
    expect(renos(run(spend(clone(s), 14_000), naive))).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe("the credits' goal: one data switch", () => {
  const rep = (week: number, grade: WeekReport['grade'], rev: number, auto = false, rcv = false): GoalWeek => ({ week, grade, revenue: rev, budget: 1000, autoRun: auto ? ['elec'] : [], ...(rcv ? { rcv: true as const } : {}) });
  const isle = (history: GoalWeek[], t5 = 20) => ({ tier: 5, stats: { tierReachedWeek: { 1: 0, 5: t5 } }, history }) as unknown as IslandState;

  it("'streak' (8 full-crew A weeks at the Resort) is the default; 'quarter' is two months on plan: 8 counted Resort weeks, 6 at B or better, revenue at 85% of budget", () => {
    expect(GOAL).toEqual({ rule: 'streak', weeks: 8, need: 6, minGrade: 'B', revShare: 0.85 });
    expect(['A', 'B', 'C', 'D'].map((g) => onPlan(g as WeekReport['grade']))).toEqual([true, true, false, false]);
  });

  it('the window from the week reports: Harbor weeks never count, a full-crew week joins, an autopilot week on plan pauses, one below plan joins as a miss, receivership clears it, and it keeps the last 8', () => {
    // weeks 15-20 at the Harbor (the Resort arrived at week 20's resolve: week 20 was played at the Harbor)
    const harbor = [15, 16, 17, 18, 19, 20].map((w) => rep(w, 'A', 1200));
    expect(goalWindow(isle(harbor))).toEqual([]);
    const s = isle([...harbor, rep(21, 'A', 900), rep(22, 'B', 900, true), rep(23, 'C', 700, true), rep(24, 'A', 1000)]);
    expect(goalWindow(s).map((h) => h.week)).toEqual([21, 23, 24]);
    expect(pausedWeek(s, rep(22, 'B', 900, true) as WeekReport)).toBe(false); // (the default rule: only an autopilot A)
    const q = [21, 22, 23, 24, 25, 26, 27, 28, 29].map((w) => rep(w, w === 22 || w === 25 ? 'C' : 'A', 900));
    expect(goalWindow(isle(q)).map((h) => h.week)).toEqual([22, 23, 24, 25, 26, 27, 28, 29]);
    expect(goalCount(goalWindow(isle(q)))).toMatchObject({ weeks: 8, onPlan: 6, revenue: 7200, budget: 8000 });
    expect(goalMet(goalWindow(isle(q)))).toBe(true);
    // revenue under 85% of budget over the period: not met, however good the grades
    expect(goalMet(goalWindow(isle(q.map((h) => ({ ...h, revenue: 840 })))))).toBe(false);
    // one more miss keeps 6 of 8 (week 22's C left the window); two more: 5 of 8
    expect(goalMet(goalWindow(isle([...q, rep(30, 'D', 900)])))).toBe(true);
    expect(goalMet(goalWindow(isle([...q, rep(30, 'D', 900), rep(31, 'C', 900)])))).toBe(false);
    // a week in receivership clears it: 8 more counted weeks from then
    const r = isle([...q, rep(30, 'C', 900, false, true), ...[31, 32, 33].map((w) => rep(w, 'A', 900))]);
    expect(goalWindow(r).map((h) => h.week)).toEqual([31, 32, 33]);
    // the week being resolved (its report isn't in the history yet)
    expect(goalWindow(isle(q.slice(0, 7)), rep(28, 'A', 900)).map((h) => h.week)).toEqual([21, 22, 23, 24, 25, 26, 27, 28]);
  });

  it("'quarter' in whole seasons: the credits land on the first full-crew Resort week the window (recomputed here from the reports) is met, never on an autopilot week; autopilot weeks on plan are said and ringed", () => {
    setRule('quarter');
    let credits = 0;
    let paused = 0;
    for (const [team, seeds] of [
      ['all good', [1, 2]],
      ['three friends', [1, 2, 3, 4]],
      ['all average', [2, 5]],
    ] as const) {
      for (const seed of seeds) {
        let mine: GoalWeek[] = [];
        let first: number | undefined;
        const { final } = simulate(TEAMS[team], 52, seed, (s) => {
          const h = s.history[s.history.length - 1];
          const t5 = s.stats.tierReachedWeek[5];
          const resort = t5 !== undefined && h.week > t5;
          const ok = h.grade === 'A' || h.grade === 'B';
          if (!resort || h.rcv) mine = [];
          else if (h.autoRun.length && ok) {
            paused++;
            expect(pausedWeek(s, h)).toBe(true);
            if (!s.creditsWeek) expect(h.lines.some((l) => /doesn't count toward the two months on plan/.test(l.text))).toBe(true);
          } else mine = [...mine, h].slice(-GOAL.weeks);
          expect(goalWindow(s).map((x) => x.week), `${team} ${seed} wk ${h.week}`).toEqual(mine.map((x) => x.week));
          const met = mine.length === 8 && mine.filter((x) => x.grade === 'A' || x.grade === 'B').length >= 6 && mine.reduce((n, x) => n + x.revenue, 0) >= 0.85 * mine.reduce((n, x) => n + x.budget, 0);
          if (first === undefined && met && !h.autoRun.length && resort && !h.rcv) first = h.week;
        });
        expect(final.creditsWeek, `${team} ${seed}`).toBe(first);
        if (final.creditsWeek) {
          credits++;
          const h = final.history.find((x) => x.week === final.creditsWeek);
          if (h) expect(h.autoRun).toHaveLength(0);
          expect(final.creditsWeek - final.stats.tierReachedWeek[5]!).toBeGreaterThanOrEqual(GOAL.weeks);
        }
      }
    }
    expect(credits).toBeGreaterThan(0);
    expect(paused).toBeGreaterThan(0);
  }, 120_000);

  it("switched on for a live island, its Resort weeks count at once (computed from the reports it already has); the Endgame words follow the rule", () => {
    const doc = load('v4-e810cc5-t5');
    // (all average seed 1 on e810cc5: the Resort since week 22, weeks 23-26 A A B A at 88-120% of budget)
    const m = migrate(clone(doc));
    setRule('quarter');
    expect(goalWindow(m).map((h) => h.week)).toEqual([23, 24, 25, 26]);
    expect(harborLines(m).find((l) => l.title === 'The credits')!.body).toMatch(/^Two months on plan at the Resort/);
    let s = m;
    for (let i = 0; i < 10 && !s.creditsWeek; i++) s = playWeek(s, 'all good');
    expect(s.creditsWeek).toBeDefined();
    // 8 counted weeks, 4 of them played before v5
    expect(s.creditsWeek! - 22).toBeGreaterThanOrEqual(8);
    GOAL.rule = 'streak';
    expect(harborLines(m).find((l) => l.title === 'The credits')!.body).toMatch(/^Eight full-crew A weeks at the Resort/);
  });
});

// ---------------------------------------------------------------------------

describe('live islands: the one-time G0 migration (docs an older engine wrote, at tier 4-5)', () => {
  const V4 = ['t2', 't4', 't4-mid', 't5', 't5-late'].map((n) => `v4-e810cc5-${n}`);

  it('e810cc5 docs: engine 4; at tier 4-5 the warranty dated from their buildings (only what still runs) and the service upgrade; tier 2 untouched; stamped, so a second read changes nothing', () => {
    expect(G0_ENGINE).toBe(ENGINE_VERSION);
    for (const name of V4) {
      const doc = load(name);
      expect(doc.engine, name).toBe(4);
      const m = migrate(clone(doc));
      expectLiveMigration(doc, m, name);
      expect(JSON.stringify(migrate(clone(m))), name).toBe(JSON.stringify(m));
      if (doc.tier < 4) expect(JSON.stringify(m), name).toBe(JSON.stringify(doc));
      else expect(m.stats.g0From, name).toBe(doc.week);
    }
    // fair, no gift: the Harbor 3 weeks old keeps 23 weeks of its villas' warranty; 27 weeks on, none; the Resort's Lodge its own
    const t4 = migrate(load('v4-e810cc5-t4'));
    expect([house(t4, 'h5').warrantyUntil, house(t4, 'h6').warrantyUntil, house(t4, 'h1').warrantyUntil]).toEqual([16 + 26, 16 + 26, undefined]);
    expect(t4.assets.find((a) => a.kind === 'grid')!).toMatchObject({ health: 80, warrantyUntil: 19 + 26 });
    expect(t4.assets.find((a) => a.kind === 'generator')!.warrantyUntil).toBeUndefined();
    const late = migrate(load('v4-e810cc5-t5-late'));
    expect([house(late, 'h5').warrantyUntil, house(late, 'h6').warrantyUntil, house(late, 'h7').warrantyUntil]).toEqual([undefined, undefined, 22 + 26]);
    expect(late.assets.find((a) => a.kind === 'grid')!).toMatchObject({ health: 80, warrantyUntil: 43 + 26 });
    expect(late.assets.find((a) => a.kind === 'generator')!.warrantyUntil).toBe(43 + 26);
    expect(late.assets.find((a) => a.kind === 'generator')!.health).toBeGreaterThanOrEqual(80);
    // the houses keep their health: the upgrade is the service, not the buildings
    expect(late.assets.filter((a) => a.kind === 'house').map((a) => Math.round(a.health))).toEqual(load('v4-e810cc5-t5-late').assets.filter((a) => a.kind === 'house').map((a) => Math.round(a.health)));
  });

  it('only for a doc an older engine wrote: its first move on this build stores it once (engine 5), and a doc engine 5 wrote is never migrated again', () => {
    for (const name of V4) {
      const doc = load(name);
      const r = apply(doc, { t: 'rename', role: 'mech', name: doc.players.mech!.name }, doc.updatedAt + 1000);
      expect(r.error, name).toBeUndefined();
      expect(r.s.engine).toBe(5);
      expect(r.s.cash, name).toBe(doc.cash);
      expect(r.s.orders.map((o) => `${o.id}:${o.status}`)).toEqual(doc.orders.map((o) => `${o.id}:${o.status}`));
      expect(r.s.stats.aStreak).toBe(doc.stats.aStreak);
      expect(r.s.stats.g0From).toBe(doc.tier >= 4 ? doc.week : undefined);
      // a doc engine 5 wrote, its grid worn again and the stamp gone: nothing runs
      const again = clone(r.s);
      delete again.stats.g0From;
      for (const a of again.assets) if (a.kind === 'grid') a.health = 30;
      expect(JSON.stringify(migrate(clone(again)))).toBe(JSON.stringify(again));
    }
    // and a new island never gets it, however far it plays (the golden digests read every week's doc)
    simulate(TEAMS['all good'], 30, 1, (s) => expect(s.stats.g0From).toBeUndefined());
  });

  it('migrated docs play on: ten weeks the same in memory and through JSON; the Resort doc’s grid holds under its warranty', () => {
    for (const name of ['v4-e810cc5-t4-mid', 'v4-e810cc5-t5-late']) {
      let a = migrate(load(name));
      let b = JSON.parse(JSON.stringify(a)) as IslandState;
      for (let i = 0; i < 10; i++) {
        a = playWeek(a, 'three friends');
        b = JSON.parse(JSON.stringify(playWeek(b, 'three friends')));
      }
      expect(JSON.stringify(a), name).toBe(JSON.stringify(b));
      expect(a.stats.g0From).toBeDefined();
    }
  });

  it("What's new says what the island got: the upgrade's numbers on a migrated doc, 'when its Harbor goes up' below tier 4, nothing on a new island's first week", () => {
    const text = (s: IslandState, role: 'mech' | 'elec' | 'fin') => JSON.stringify(whatsNewUpkeepPanels(s, role).map((p) => p.body));
    const late = migrate(load('v4-e810cc5-t5-late'));
    expect(text(late, 'fin')).toMatch(/Your island got it with this update/);
    expect(text(late, 'fin')).toMatch(/under warranty to week /);
    expect(text(late, 'elec')).toMatch(/permit final/);
    expect(text(migrate(load('v4-e810cc5-t2')), 'mech')).toMatch(/Your island gets it when its Harbor goes up/);
    const fresh = load('v4-e810cc5-t2');
    fresh.week = 1;
    expect(whatsNewUpkeepPanels(fresh, 'fin')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('what every seat reads', () => {
  it("the house's sheet: the warranty to week N for every seat, the renovation's state, and the analyst's Renovate", () => {
    const s = order(resort(), 'h1').s;
    const h7 = house(s, 'h7');
    h7.warrantyUntil = s.week + 9;
    for (const role of ROLES) {
      const f = facts(s, assetRef(h7), role);
      expect(factsText(f), role).toContain(`Builder's warranty to week ${s.week + 9}`);
      const f1 = factsText(facts(s, assetRef(house(s, 'h1')), role));
      expect(f1, role).toContain(`Renovation ordered in week ${s.week}`);
    }
    expect(facts(s, assetRef(house(s, 'h2')), 'fin').actions.some((a) => a.t === 'reno')).toBe(true);
    expect(facts(s, assetRef(house(s, 'h2')), 'elec').actions.some((a) => a.t === 'reno')).toBe(false);
    // the builders on it, then done: the electrician is told it's his final
    const b = s.builds!.find((x) => x.reno === 'h1')!;
    b.drawn = 1;
    expect(renoStatus(s, house(s, 'h1'), 'fin')!.text).toMatch(/^Closed for its renovation: the builders are on it/);
    Object.assign(b, { drawn: 2, done: 2, finished: s.week });
    expect(renoStatus(s, house(s, 'h1'), 'elec')!.text).toMatch(/until you sign off the permit final/);
    expect(renoStatus(s, house(s, 'h1'), 'mech')!.text).toMatch(/until E signs off the permit final/);
    // the grid's service upgrade, on the electrician's and the analyst's grid sheets
    const g = s.assets.find((a) => a.kind === 'grid')! as Asset;
    g.warrantyUntil = s.week + 4;
    expect(warrantyLine(s, g)!.text).toMatch(/^The new transformer and feeder are under warranty to week/);
    expect(factsText(facts(s, assetRef(g), 'elec'))).toContain('The new transformer and feeder are under warranty');
    // an ended warranty is said for a while, then dropped
    g.warrantyUntil = s.week - 3;
    expect(warrantyLine(s, g)!.text).toMatch(/ended in week/);
    g.warrantyUntil = s.week - 30;
    expect(warrantyLine(s, g)).toBeNull();
    // the late game's sheet says the new rules
    const lines = harborLines(s).map((l) => l.title);
    expect(lines).toContain('New buildings last');
    expect(lines).toContain('Renovations');
    expect(WARRANTY.fromTier).toBe(4);
  });
});

describe('nobody wins alone over 64 weeks, under either goal', () => {
  for (const rule of ['streak', 'quarter'] as const)
    it(`GOAL.rule '${rule}': solo, absent and nobody crews stay at tier 1, renovate nothing and never reach the credits`, () => {
      setRule(rule);
      for (const name of ['solo mech', 'solo elec', 'solo fin', 'nobody', 'mech absent', 'elec absent', 'fin absent']) {
        const { final } = simulate(TEAMS[name], 64, 1);
        expect(final.tier, name).toBe(1);
        expect(final.creditsWeek, name).toBeUndefined();
        expect(renos(final), name).toHaveLength(0);
      }
    }, 120_000);
});

describe('the long-game guard (G0: 64 weeks, seeds 1-10, weeks 24-64)', () => {
  it('three friends and all average hold: no game below $0 or in receivership (1 allowed for noise), and the median house at week 64 above the closing line', () => {
    // Measured on this build (the default goal): three friends 0 games below $0, 0 receiverships, the median house 57
    // at week 64 (on e810cc5, stage 1: 18 of 30 games below $0 in weeks 24-52 and 0 of 7 houses rentable at week 52);
    // all average 0, 0 and 70. The guard pins it with room for noise, so a regression shows.
    for (const [team, floor] of [
      ['three friends', 50],
      ['all average', 60],
    ] as const) {
      let games = 0;
      let recv = 0;
      const h64: number[] = [];
      for (let seed = 1; seed <= 10; seed++) {
        let entered = false;
        const { weeks } = simulate(TEAMS[team], 64, seed, (s) => {
          if (s.receivership > 0) entered = true;
          if (s.week - 1 === 64) {
            const hs = s.assets.filter((a) => a.kind === 'house');
            h64.push(hs.reduce((n, a) => n + a.health, 0) / hs.length);
          }
        });
        if (weeks.some((w) => w.week >= 24 && w.cash < 0)) games++;
        if (entered) recv++;
      }
      expect(games, team).toBeLessThanOrEqual(1);
      expect(recv, team).toBeLessThanOrEqual(1);
      expect([...h64].sort((a, b) => a - b)[5], team).toBeGreaterThanOrEqual(floor);
    }
  }, 180_000);
});
