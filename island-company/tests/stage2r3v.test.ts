// Stage 2 round-3 verification (docs/DECISIONS.md "2026-09-30: stage 2 round-3 verification"): the review of the round-3
// fix itself. One test per finding, on the reviewers' repros where they gave one.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { liveAlerts, pairsFor, raiseAlert, siteOf, slotKind, soleGuest, SYMPTOMS } from '../src/sim/alerts';
import { botTurn, simulate, TEAMS, type Team } from '../src/sim/bots';
import { IR } from '../src/sim/checkdata';
import { checkTruth, checkView, flagCheck, flagPick, flagTo, homeSchedule, openWork, raiseFlag } from '../src/sim/checks';
import { TIERS } from '../src/sim/data';
import { closingHazard, houseRentable, renovating } from '../src/sim/econ';
import { apply, createIsland } from '../src/sim/engine';
import { fixTaskFor, stdPickFor } from '../src/sim/flow';
import { migrate } from '../src/sim/migrate';
import { generateMeter } from '../src/puzzles/meter';
import { renoPlan, unitLines } from '../src/sim/staff';
import { addStarter } from '../src/sim/stock';
import { hashSeed, rng } from '../src/sim/rng';
import { ROLES, type Action, type IslandState, type Npc, type Order } from '../src/sim/types';
import { dockNext, endTurnChecks, puzzleSite, yourMoves } from '../src/ui/select';
import { RenoNumbers } from '../src/ui/staff/Reno';

vi.setConfig({ testTimeout: 120000 });

const NOW = Date.UTC(2026, 8, 30, 12);
let clock = NOW;
const load = (name: string): IslandState => JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures', `${name}.json`), 'utf8'));
const ok = (s: IslandState, a: Action) => {
  const r = apply(s, a, ++clock);
  expect(r.error, JSON.stringify(a)).toBeUndefined();
  return r.s;
};
/** a live doc, migrated, every seat's turn open (as at the start of a week) */
const live = (name: string) => {
  const s = migrate(load(name));
  for (const r of ROLES) if (s.turns[r]) s.turns[r]!.ended = false;
  clock = Math.max(clock, s.updatedAt);
  return s;
};
const asset = (s: IslandState, id: string) => s.assets.find((a) => a.id === id)!;
const expRise = (pct: number) => IR.riseFull * (pct / 100) ** 2;

/** a fresh island at `tier` with the tier's assets, every asset at `health`, week 6, nothing open (the reviewers' helper) */
function island(seed = 5, health = 70, tier = 3): IslandState {
  let s = createIsland({ id: `r3v-${seed}`, name: 'Review Isle', now: NOW, tz: 'Europe/Paris', seed, creator: { uid: 'a', name: 'Ana', role: 'mech' } });
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

// ---------------------------------------------------------------------------

describe("the generator's IR scan after a transfer job: each termination read against its own rating (fixes major)", () => {
  it("the reviewers' three friends, seed 1, week 17: the help says the 100 A switch and the 60 A main differ, and every row reads right for its own load", () => {
    const s = simulate(TEAMS['three friends'], 17, 1).final;
    const gen = s.assets.find((a) => a.kind === 'generator')!;
    expect(gen.xfer).toMatchObject({ amps: 100 });
    const v = checkView(s, 'elec', gen.id)!;
    // the old line: "carry the same current, so compare them: healthy, they read within a degree or two"
    expect(v.help.join(' ')).not.toMatch(/so compare them/);
    expect(v.help[0]).toMatch(/each read against its own rating\. Where the ratings match, healthy, they read within a degree or two\.$/);
    expect(v.help[1]).toBe("After the transfer job the switch is 100 A and the set's main still 60 A: the same current is a bigger share of the main's rating, so it runs warmer than the lugs, right for its load. Compare the switch's generator side with its load side; judge the main by its own load, never against the lugs.");
    const row = (id: string) => v.items.find((i) => i.id === id)!.reading!;
    expect(row('genbrk').loadPct! - row('xferG').loadPct!).toBeGreaterThan(20);
    // (the help's rule holds on this and every no-tell scan after the job, below)
    expect(checkTruth(s, 'elec', gen.id, s.week)).toBeNull();
    expect(row('genbrk').riseC! - row('xferG').riseC!).toBeGreaterThan(4);
  });

  it('on every no-tell scan after a transfer job: each loaded row within 1.8 °C of what its own load predicts, the two switch sides within 1.6 °C of each other; the line only when the ratings differ', () => {
    let scans = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const s = island(seed, 70, 4);
      const gen = s.assets.find((a) => a.kind === 'generator')!;
      const plain = checkView(s, 'elec', gen.id)!;
      expect(plain.help.some((l) => /After the transfer job/.test(l))).toBe(false);
      gen.xfer = { amps: 100, awg: '#3 Cu', load: 70, week: 3 };
      for (let W = 6; W < 12; W++) {
        s.week = W;
        if (checkTruth(s, 'elec', gen.id, W)) continue;
        const v = checkView(s, 'elec', gen.id)!;
        expect(v.help[1]).toMatch(/^After the transfer job the switch is 100 A and the set's main still 60 A/);
        for (const i of v.items) if (i.id !== 'xferU') expect(Math.abs(i.reading!.riseC! - expRise(i.reading!.loadPct!)), `${seed}/${W} ${i.id}`).toBeLessThanOrEqual(IR.genShared + IR.genEach + 0.11);
        const r = (id: string) => v.items.find((i) => i.id === id)!.reading!.riseC!;
        expect(Math.abs(r('xferG') - r('xferL'))).toBeLessThanOrEqual(2 * IR.genEach + 0.11);
        scans++;
      }
    }
    expect(scans).toBeGreaterThan(200);
  });
});

describe("Report a problem: a hazard passed on after the electrician's turn gets autopilot's whole job flow (fixes major)", () => {
  it("the reviewers' repro on the live early doc: ended plus a late flag earns what away plus the flag earns ($3,170), the house fixed by the book at 50%", () => {
    const run = (mode: 'ended' | 'away' | 'none') => {
      let s = live('v4-e810cc5-early');
      // (Ana's list 3 of 4, so the flag fits: a59 closed, as the reviewers did)
      const a59 = s.alerts!.find((x) => x.id === 'a59')!;
      a59.status = 'closed';
      a59.closed = { week: s.week, how: 'nff' };
      s = ok(s, { t: 'endTurn', role: 'mech', week: s.week });
      if (mode === 'ended') s = ok(s, { t: 'endTurn', role: 'elec', week: s.week });
      if (mode !== 'none') {
        s = ok(s, { t: 'flag', role: 'fin', assetId: 'h2', week: s.week });
        const al = s.alerts!.at(-1)!;
        // (the reviewers' pick was cause 0, a receptacle; the flag no longer draws the electrician's own tell's kind on the
        // house this week, so it's the same guest complaint's GFCI cause)
        expect(al.sym).toBe('E_WARM_OUTLET');
        expect(al.cause).toBeGreaterThanOrEqual(0);
        expect(!!al.late).toBe(mode === 'ended');
      }
      const W = s.week;
      s = ok(s, { t: 'endTurn', role: 'fin', week: W });
      if (s.week === W) s = apply(s, { t: 'resolve', week: W }, (s.deadline ?? clock) + 1000).s;
      return s.history.find((h) => h.week === W)!;
    };
    const ended = run('ended');
    const away = run('away');
    expect(ended.revenue).toBe(3170);
    expect(away.revenue).toBe(3170);
    expect(run('none').revenue).toBe(3170);
    expect(ended.lines.some((l) => /^Autopilot \(Ana\) fixed Cottage 2 by the book \(.+, at 50%\): Cy's report came after Ana's turn\.$/.test(l.text))).toBe(true);
  });

  it('40 real hazard flags on fresh tier-3 islands at health 45: ended plus a late flag never earns less than away plus the flag (the reviewers: 8 of 40 on fd3d125, 28 of 40 on 30d8b19)', () => {
    let n = 0;
    for (let seed = 1; seed <= 600 && n < 40; seed++)
      for (const id of ['h1', 'h2', 'h3', 'h4']) {
        if (n >= 40) break;
        const s0 = island(seed, 45, 3);
        const pick = flagPick(s0, 'fin', asset(s0, id), 'elec');
        if (!pick || !SYMPTOMS[pick.sym].hazard || pick.cause < 0) continue;
        n++;
        const run = (ended: boolean) => {
          let s = structuredClone(s0);
          s = ok(s, { t: 'endTurn', role: 'mech', week: s.week });
          if (ended) s = ok(s, { t: 'endTurn', role: 'elec', week: s.week });
          s = ok(s, { t: 'flag', role: 'fin', assetId: id, week: s.week });
          const W = s.week;
          s = ok(s, { t: 'endTurn', role: 'fin', week: W });
          if (s.week === W) s = apply(s, { t: 'resolve', week: W }, (s.deadline ?? clock) + 1000).s;
          return s.history.find((h) => h.week === W)!;
        };
        const e = run(true);
        const a = run(false);
        expect(e.revenue, `seed ${seed} ${id} ${pick.sym}`).toBeGreaterThanOrEqual(a.revenue);
        expect(e.housesRentable).toBe(a.housesRentable);
      }
    expect(n).toBe(40);
  });

  it("a service-neutral hazard stays closed (a breaker doesn't isolate it), and the line says so; a hazard the electrician made safe after the turn still gets its fix planned", () => {
    // the neutral one: made safe never, planned by the book
    let found = false;
    for (let seed = 1; seed <= 800 && !found; seed++) {
      const s0 = island(seed, 45, 3);
      const pick = flagPick(s0, 'fin', asset(s0, 'h1'), 'elec');
      if (!pick || !SYMPTOMS[pick.sym].hazard || pick.cause < 0 || !SYMPTOMS[pick.sym].causes[pick.cause].neutral) continue;
      found = true;
      let s = ok(s0, { t: 'endTurn', role: 'elec', week: s0.week });
      s = ok(s, { t: 'flag', role: 'fin', assetId: 'h1', week: s.week });
      const al = s.alerts!.at(-1)!;
      for (const r of ['mech', 'fin'] as const) s = ok(s, { t: 'endTurn', role: r, week: s.week });
      const rep = s.history.at(-1)!;
      const after = s.alerts!.find((x) => x.id === al.id)!;
      if (after.status !== 'closed') {
        expect(after.safe).toBeUndefined();
        expect(rep.lines.some((l) => /^Cottage 1 stays closed: Cy's report came after Ben's turn, and a service-neutral fault isn't isolated by a breaker\./.test(l.text))).toBe(true);
      } else expect(rep.lines.some((l) => /fixed Cottage 1 by the book/.test(l.text))).toBe(true);
    }
    expect(found).toBe(true);
    // made safe by the electrician after the turn: autopilot plans the fix (and signs it off with its parts on the shelf)
    for (let seed = 1; seed <= 400; seed++) {
      const s0 = island(seed, 45, 3);
      const pick = flagPick(s0, 'fin', asset(s0, 'h1'), 'elec');
      if (!pick || !SYMPTOMS[pick.sym].hazard || pick.cause < 0 || SYMPTOMS[pick.sym].causes[pick.cause].neutral) continue;
      let s = ok(s0, { t: 'endTurn', role: 'elec', week: s0.week });
      s = ok(s, { t: 'flag', role: 'fin', assetId: 'h1', week: s.week });
      const al = s.alerts!.at(-1)!;
      s = ok(s, { t: 'makeSafe', role: 'elec', alert: al.id, how: 'breaker' });
      for (const r of ['mech', 'fin'] as const) s = ok(s, { t: 'endTurn', role: r, week: s.week });
      const after = s.alerts!.find((x) => x.id === al.id)!;
      expect(after.status === 'closed' || !!after.order).toBe(true);
      return;
    }
    throw new Error('no seed');
  });
});

describe("Report a problem while the electrician's turn is open: the End turn sheet says the house is shut (phone major)", () => {
  it("a crewmate's report raises a hazard due next week: the house is shut now, Your move and the Dock lead with it, and End turn says make it safe", () => {
    for (let seed = 1; seed <= 400; seed++) {
      const s0 = island(seed, 45, 3);
      const pick = flagPick(s0, 'mech', asset(s0, 'h1'), 'elec');
      if (!pick || !SYMPTOMS[pick.sym].hazard || pick.cause < 0) continue;
      // something else on the electrician's list, due sooner, that isn't a hazard
      raiseAlert(s0, { role: 'elec', asset: asset(s0, 'g1'), kind: 'xfmr', due: s0.week }, NOW);
      const s = ok(s0, { t: 'flag', role: 'mech', assetId: 'h1', week: s0.week });
      const al = s.alerts!.at(-1)!;
      expect(al.due).toBe(s.week + 1);
      expect(al.late).toBeUndefined();
      expect(closingHazard(s, 'h1')?.id).toBe(al.id);
      const lines = endTurnChecks(s, 'elec');
      const line = lines.find((l) => l.text.startsWith('Make it safe or fix it, or Cottage 1 stays closed: '));
      expect(line?.urgent).toBe(true);
      // it leads the sheet: the one line that costs this week's rent
      expect(lines[0]).toBe(line);
      expect(lines.some((l) => l.text.startsWith('Plan it now so the parts come in time: ') && l.text.includes('on Cottage 1'))).toBe(false);
      expect(yourMoves(s, 'elec')[0].alert.id).toBe(al.id);
      expect(dockNext(s, 'elec')?.target).toEqual({ alert: al.id });
      // made safe: the line goes (and the house rents at 75%)
      const t = ok(s, { t: 'makeSafe', role: 'elec', alert: al.id, how: 'breaker', week: s.week });
      expect(endTurnChecks(t, 'elec').some((l) => l.text.startsWith('Make it safe or fix it, or Cottage 1'))).toBe(false);
      expect(houseRentable(t, asset(t, 'h1'))).toBe(true);
      return;
    }
    throw new Error('no seed');
  });
});

describe('Quick check + Report a problem: never two real alerts of one kind on one asset (code major)', () => {
  it("the reviewers' R1 (v4-e810cc5-t5-carry-mid): Seb flags Twin N-12, then Ana's right call on the walkaround's tell: one live oil alert, one job", () => {
    let s = live('v4-e810cc5-t5-carry-mid');
    const W = s.week;
    const tell = checkTruth(s, 'mech', 'p1', W)!;
    expect(tell).toEqual({ item: 'lnac', kind: 'oil' });
    s = ok(s, { t: 'flag', role: 'fin', assetId: 'p1', week: W });
    const flag = s.alerts!.at(-1)!;
    // the flag never draws the kind the receiver's own check shows this week while it's still to make
    expect(slotKind(flag)).not.toBe('oil');
    // and the tell holds (round 3)
    expect(checkTruth(s, 'mech', 'p1', W)).toEqual(tell);
    s = ok(s, { t: 'check', role: 'mech', assetId: 'p1', item: tell.item, week: W } as Action);
    const same = liveAlerts(s).filter((x) => x.assetId === 'p1' && slotKind(x) === 'oil');
    expect(same).toHaveLength(1);
    expect(same[0]).toMatchObject({ src: 'check', early: true });
    expect(same[0].cause).toBeGreaterThanOrEqual(0);
  });

  it("the safety net: a flag already raised the tell's kind (the tell moved mid-week onto it): the right call finds it on the list, marks it early and lands as no fault", () => {
    let s = live('v4-e810cc5-t5-carry-mid');
    const W = s.week;
    const p1 = asset(s, 'p1');
    const tell = checkTruth(s, 'mech', 'p1', W)!;
    const pair = pairsFor(tell.kind, p1, soleGuest(s, 'p1'), s).find((p) => p.sym.src === 'squawk' || p.sym.src === 'guest')!;
    const flag = raiseFlag(s, 'fin', p1, 'mech', { sym: pair.sym.key, cause: pair.cause }, ++clock);
    s.flagged = { fin: W };
    s = ok(s, { t: 'check', role: 'mech', assetId: 'p1', item: tell.item, week: W } as Action);
    const same = liveAlerts(s).filter((x) => x.assetId === 'p1' && slotKind(x) === tell.kind && x.cause >= 0);
    expect(same.map((x) => x.id)).toEqual([flag.id]);
    expect(s.alerts!.find((x) => x.id === flag.id)!.early).toBe(true);
    expect(s.alerts!.at(-1)).toMatchObject({ src: 'check', cause: -1 });
  });

  it("the reviewers' in-play count: a crew flagging every week (and three friends) raises no same-week real flag and check of one kind on one asset in 30 games (7 of 30 on fd3d125)", () => {
    const t = TEAMS['three friends'];
    const weekly: Team = { mech: { ...t.mech, flagWeekly: true }, elec: { ...t.elec, flagWeekly: true }, fin: { ...t.fin, flagWeekly: true } };
    for (const team of [t, weekly]) {
      let dups = 0;
      for (let seed = 1; seed <= 30; seed++)
        simulate(team, 26, seed, (s: IslandState) => {
          const by = new Map<string, Set<string>>();
          for (const a of s.alerts ?? []) {
            if (a.cause < 0 || (a.src !== 'flag' && a.src !== 'check')) continue;
            const k = `${a.assetId}|${slotKind(a)}|${a.week}`;
            (by.get(k) ?? by.set(k, new Set()).get(k)!).add(a.src);
          }
          for (const v of by.values()) if (v.size > 1) dups++;
        });
      expect(dups).toBe(0);
    }
  });
});

describe("an IR write-up of an island-panel breaker never plays a receptacle run on it (code major)", () => {
  it("every branch on the tier-5 schedule, right call: the job reads the breaker, its meter never draws a 15/20 A receptacle on a breaker over 20 A (the reviewers' R2 on v4-e810cc5-t2 too)", () => {
    for (const name of ['v4-e810cc5-t2', 'v4-e810cc5-t5']) {
      const s = live(name);
      const grid = s.assets.find((a) => a.kind === 'grid')!;
      for (const b of homeSchedule(s).filter((x) => x.id !== 'main')) {
        const al = raiseAlert(s, { role: 'elec', asset: grid, sym: `K_ir:${b.id}`, cause: 0, src: 'check', due: s.week + 2, who: 'Ben' }, NOW);
        const site = siteOf(s, al)!;
        expect(site.cond).toBe(b.awg);
        expect(site.amps).toBe(b.amps);
        const task = fixTaskFor(s, al)!;
        expect(task.kind).toBe('xfmr');
        const o = { id: 'o-probe', role: 'elec', flow: { alert: al.id, task: task.id, pick: stdPickFor(s, al, task), bench: null, tools: [], bom: 0 }, job: 'xfmr', seed: hashSeed(name, b.id) } as unknown as Order;
        expect(puzzleSite(s, o)).toBeUndefined();
        for (const tier of [1, 2, 3, 4, 5]) {
          const m = generateMeter(o.seed, tier, [], 'xfmr', undefined, puzzleSite(s, o));
          expect(m.items.some((i) => i.kind === 'recep') && (m.amps ?? 20) > 20, `${name} ${b.id} t${tier}`).toBe(false);
        }
      }
    }
    // a house's branch circuit still plays its own (the meter check's write-up: the circuit the meter read)
    const s = live('v4-e810cc5-t2');
    const h = s.assets.find((a) => a.kind === 'house')!;
    const al = raiseAlert(s, { role: 'elec', asset: h, sym: 'K_meter:kitchen', cause: 0, src: 'check', due: s.week + 2, who: 'Ben' }, NOW);
    const task = fixTaskFor(s, al);
    if (task) {
      const o = { id: 'o-probe2', role: 'elec', flow: { alert: al.id, task: task.id, pick: [], bench: null, tools: [], bom: 0 }, job: task.job ?? task.kind, seed: 7 } as unknown as Order;
      expect(puzzleSite(s, o)?.amps).toBe(siteOf(s, al)!.amps);
    }
  });
});

describe("the IR main tell: the main's continuous is what its branches carry (code major)", () => {
  const sumOf = (v: NonNullable<ReturnType<typeof checkView>>) => v.items.filter((i) => i.id !== 'main').reduce((n, i) => n + (i.reading?.amps ?? 0), 0);

  it("the reviewers' R3: v4-e810cc5-chain (tier 3) after a transfer job has no main tell; v4-e810cc5-t4 at grid 60, week 19 reads its continuous under its branches' sum", () => {
    const c = live('v4-e810cc5-chain');
    c.assets.find((a) => a.kind === 'generator')!.xfer = { amps: 100, awg: '#3 Cu', week: c.week - 1 };
    const cg = c.assets.find((a) => a.kind === 'grid')!;
    cg.health = 60;
    c.week = 37;
    expect(checkTruth(c, 'elec', cg.id, 37)?.item).not.toBe('main');
    const s = live('v4-e810cc5-t4');
    const grid = s.assets.find((a) => a.kind === 'grid')!;
    grid.health = 60;
    s.week = 19;
    expect(checkTruth(s, 'elec', grid.id, 19)).toMatchObject({ item: 'main' });
    const v = checkView(s, 'elec', grid.id)!;
    const main = v.items.find((i) => i.id === 'main')!.reading!;
    const sum = sumOf(v);
    expect(main.loadPct).toBeGreaterThanOrEqual(IR.panelUp[0]);
    expect(main.amps!).toBeLessThanOrEqual(sum);
    expect(main.amps!).toBeGreaterThanOrEqual(Math.floor(IR.contOfSum[0] * sum) - 1);
    expect(main.peakAmps!).toBeGreaterThanOrEqual(sum);
  });

  it('the sweep (tiers 3-5 x plain, a transfer job, its load on record, two houses closed x 100 seeds x 2 healths x 6 weeks): every main tell reads 82-95% continuous, under its branches and at least 97% of them, never at tier 3; no other scan at 80%', () => {
    let tells = 0;
    for (const tier of [3, 4, 5])
      for (const variant of ['plain', 'xfer', 'xferload', 'closed'])
        for (let seed = 1; seed <= 100; seed++)
          for (const health of [50, 60]) {
            const s = island(seed, health, tier);
            const gen = s.assets.find((a) => a.kind === 'generator');
            if (variant === 'xfer' && gen) gen.xfer = { amps: 100, awg: '#3 Cu', week: 1 };
            if (variant === 'xferload' && gen) gen.xfer = { amps: 100, awg: '#3 Cu', load: 72, week: 1 };
            if (variant === 'closed') for (const id of ['h1', 'h2']) asset(s, id).health = 30;
            const grid = s.assets.find((a) => a.kind === 'grid')!;
            for (let W = 6; W < 12; W++) {
              s.week = W;
              const t = checkTruth(s, 'elec', grid.id, W);
              const v = checkView(s, 'elec', grid.id)!;
              const main = v.items.find((i) => i.id === 'main')!.reading!;
              const sum = sumOf(v);
              const where = `t${tier} ${variant} s${seed} h${health} W${W}`;
              if (t?.item === 'main') {
                tells++;
                expect(tier, where).toBeGreaterThanOrEqual(4);
                expect(main.loadPct!, where).toBeGreaterThanOrEqual(IR.panelUp[0]);
                expect(main.loadPct!, where).toBeLessThanOrEqual(IR.panelUp[1]);
                expect(main.amps!, where).toBeLessThanOrEqual(sum);
                expect(main.amps!, where).toBeGreaterThanOrEqual(Math.floor(IR.contOfSum[0] * sum) - 1);
                expect(main.peakAmps!, where).toBeGreaterThanOrEqual(sum);
                // a feeder whose houses are all closed stays at its trickle when the rest run up
                if (variant === 'closed') expect(v.items.find((i) => i.id === 'cfeedE')!.reading!.loadPct!, where).toBeLessThanOrEqual(8);
              } else expect(main.loadPct!, where).toBeLessThan(80);
              for (const i of v.items) if (i.id !== 'main' && i.id !== t?.item && i.id !== 'xfer') expect(i.reading!.loadPct!, `${where} ${i.id}`).toBeLessThan(80);
            }
          }
    expect(tells).toBeGreaterThan(500);
  });
});

describe('the renovation case with two builders (phone minors)', () => {
  it("the reviewers' v4-e810cc5-t5 with two skill-3 builders: Villa East's case counts the week the second unit waits for its materials, and never fewer weeks than the resolves find", () => {
    const two = (): IslandState => {
      const d = load('v4-e810cc5-t5');
      const b = (id: string, name: string): Npc => ({ id, name, role: 'builder', skill: 3, wage: 380, hired: 20, start: 20 });
      d.staff = [...(d.staff ?? []), b('nb1', 'Rua K.'), b('nb2', 'Tomas L.')];
      return migrate(d);
    };
    const T = TEAMS['three friends'];
    for (const id of ['h5', 'h6', 'h2', 'h7']) {
      let s = two();
      const p = renoPlan(s, asset(s, id));
      expect(p.out).toBe(2);
      expect(p.weeksClosed, id).toBe(1);
      expect(p.waitsOnMaterials).toBe(true);
      expect(p.toFinal).toBe(2);
      let now = s.updatedAt + 1;
      s = apply(s, { t: 'build', what: 'reno', asset: id, week: s.week } as Action, now).s;
      let closed = 0;
      for (let w = 0; w < 8; w++) {
        const Wk = s.week;
        for (const role of ROLES) {
          s = botTurn(s, role, { ...T[role], miss: 0 }, rng(hashSeed('rn2', role, Wk)), now);
          if (role !== 'fin') s = apply(s, { t: 'endTurn', role, week: Wk }, now).s;
        }
        // (the resolve that finds it closed for the work: its rent isn't booked)
        if (renovating(s, id)) closed++;
        const e = apply(s, { t: 'endTurn', role: 'fin', week: Wk }, now);
        if (!e.error) s = e.s;
        if (s.week === Wk) s = apply(s, { t: 'resolve', week: Wk }, (s.deadline ?? now) + 1000).s;
        now = (s.deadline ?? now) - 86400000;
      }
      const b = s.builds!.find((x) => x.reno === id)!;
      expect(b.signed, id).toBeDefined();
      if (!b.rework) expect(closed, id).toBeLessThanOrEqual(p.weeksClosed);
    }
    // both units' materials on the shelf: no full week, and the words say why
    const s = two();
    const b = { id: `reno-${asset(s, 'h5').model}-h5-${s.week}` };
    for (let k = 0; k < 2; k++) for (const l of unitLines(b, k)) ((s.inv ??= {})[l.item] ??= { on: 0 }).on += l.qty;
    const p = renoPlan(s, asset(s, 'h5'));
    expect(p).toMatchObject({ weeksClosed: 0, waitsOnMaterials: false, toFinal: 1 });
    expect(vtext(RenoNumbers({ s, h: asset(s, 'h5') }))).toContain("not closed a full week: both units' materials are on the shelf");
    expect(vtext(RenoNumbers({ s: two(), h: asset(two(), 'h5') }))).toContain("closed up to 1 week (none if both units' materials are in when they start: they draw a unit's all at once, so buy both together)");
  });

  it("the net weeks and the gross rent say which weeks the dollars are: '$21,632 of rent (8 weeks at $2,704)' (v4-e810cc5-t5, Villa East)", () => {
    const s = live('v4-e810cc5-t5');
    const h = asset(s, 'h5');
    const p = renoPlan(s, h);
    const text = vtext(RenoNumbers({ s, h }));
    expect(p.gain).toBe(p.gained * p.rent);
    const usd = (n: number) => `$${n.toLocaleString('en-US')}`;
    expect(text).toContain(`about ${usd(p.gain)} of rent (${p.gained} week${p.gained === 1 ? '' : 's'} at ${usd(p.rent)}) in the weeks it would otherwise have been closed`);
  });
});

describe('Report a problem on the generator: to the tech with room on the list (phone minor)', () => {
  it('both techs have the generator on their list, the mechanic\'s is full: the analyst\'s report goes to the electrician; with room on both it stays the mechanic\'s', () => {
    const s = island(5, 60, 3);
    const gen = s.assets.find((a) => a.kind === 'generator')!;
    raiseAlert(s, { role: 'mech', asset: gen, kind: 'genService', due: s.week + 3 }, NOW);
    raiseAlert(s, { role: 'elec', asset: gen, kind: 'genTest', due: s.week + 3 }, NOW);
    expect(flagTo(s, gen)).toBe('mech');
    const p = s.assets.filter((a) => a.kind === 'plane');
    while (openWork(s, 'mech').open < openWork(s, 'mech').target) raiseAlert(s, { role: 'mech', asset: p[openWork(s, 'mech').open % p.length], kind: 'tires', due: s.week + 3 }, NOW);
    expect(openWork(s, 'elec').open).toBeLessThan(openWork(s, 'elec').target);
    expect(flagTo(s, gen)).toBe('elec');
    expect(flagCheck(s, 'fin', gen.id)).toEqual({ ok: true, to: 'elec' });
  });
});

/** a preact vnode's text (plain components, no hooks) */
function vtext(v: unknown): string {
  if (v == null || typeof v === 'boolean') return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(vtext).join('');
  const n = v as { type: unknown; props?: { children?: unknown } };
  if (typeof n.type === 'function') return vtext((n.type as (p: unknown) => unknown)(n.props ?? {}));
  return vtext(n.props?.children);
}
