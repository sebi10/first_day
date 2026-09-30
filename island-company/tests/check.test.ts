// Quick checks (docs/EXPANSION.md 6.4, 7, 13.1 stage 2): one a week per tech from
// tier 2; they read the wear that is coming, never s.defects; a right call raises
// that kind's alert early (one order tier easier and cheaper, a week more lead); a
// wrong call is a no-fault write-up that holds a slot until it's closed on site;
// right and wrong look alike until Investigate; the words are blind.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { alertShort, findingOf, generateAlerts, raiseAlert, symptomText, SYMPTOMS } from '../src/sim/alerts';
import { CHECK_ROWS, GEN_PANEL, GFCI_OK, GFCI_TELL, HOME_PANEL, IR, METER, WALK_BENIGN, WALK_SCOPE, WALK_ZONES } from '../src/sim/checkdata';
import { CHECK, canCheck, checkKindFor, checkTruth, checkView, openWork, wearFromOf, type CheckKind } from '../src/sim/checks';
import { CATALOG_BY_KIND, DEFECT } from '../src/sim/data';
import { apply, createIsland } from '../src/sim/engine';
import { earlyTier, fixTaskFor, laborCost, stdPickFor } from '../src/sim/flow';
import { hashSeed, rng } from '../src/sim/rng';
import { addStarter } from '../src/sim/stock';
import { ROLES, type Asset, type Defect, type IslandState, type OpsRole } from '../src/sim/types';

vi.setConfig({ testTimeout: 30000 });

const NOW = Date.UTC(2026, 8, 28, 10);
let clock = NOW;

/** a tier-2 island in week 5, every seat held, every asset at `health`, no work open */
function island(seed = 11, health = 70, tier = 2): IslandState {
  let s = createIsland({ id: `ck${seed}`, name: 'Check Isle', now: NOW, tz: 'Europe/Paris', seed, creator: { uid: 'a', name: 'Ana', role: 'mech' } });
  s = apply(s, { t: 'join', uid: 'b', name: 'Ben', role: 'elec' }, NOW).s;
  s = apply(s, { t: 'join', uid: 'c', name: 'Cy', role: 'fin' }, NOW).s;
  for (const r of ROLES) s = apply(s, { t: 'week0Done', role: r }, NOW).s;
  s.week = 5;
  s.tier = tier;
  s.cash = 20000;
  if (tier >= 2 && !s.assets.some((a) => a.id === 'p2'))
    s.assets.push({ id: 'p2', kind: 'plane', model: 'cargo', name: 'Cargo C-7', health, touchedWeek: 0, sinceInspection: 0 }, { id: 'h3', kind: 'house', model: 'cottage', name: 'Cottage 3', health, touchedWeek: 0, inspectionUntil: 40 });
  if (tier >= 3) s.assets.push({ id: 'gen', kind: 'generator', model: 'gen', name: 'Generator house', health, touchedWeek: 0 });
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
const ok = (s: IslandState, a: Parameters<typeof apply>[1]) => {
  const r = apply(s, a, ++clock);
  expect(r.error, JSON.stringify(a)).toBeUndefined();
  return r.s;
};
const roleFor = (a: Asset): OpsRole => (a.kind === 'plane' ? 'mech' : 'elec');

/** an island (seed) and asset whose check shows its tell this week */
function withTell(assetId: string, role: OpsRole, health = 70, tier = 2): { s: IslandState; item: string; kind: string } {
  for (let seed = 1; seed < 400; seed++) {
    const s = island(seed, health, tier);
    const t = checkTruth(s, role, assetId, s.week);
    if (t) return { s, ...t };
  }
  throw new Error('no tell in 400 seeds');
}

describe('who checks what, when (6.4, 7)', () => {
  it('the mechanic walks around planes and the generator; the electrician IR-scans the grid and the generator, and meter-checks houses', () => {
    const s = island(3, 70, 3);
    const kind = (role: OpsRole, id: string) => checkKindFor(s, role, s.assets.find((a) => a.id === id)!);
    expect(kind('mech', 'p1')).toBe('walkaround');
    expect(kind('mech', 'gen')).toBe('walkaround');
    expect(kind('mech', 'h1')).toBeNull();
    expect(kind('elec', 'g1')).toBe('ir');
    expect(kind('elec', 'gen')).toBe('ir');
    expect(kind('elec', 'h1')).toBe('meter');
    expect(kind('elec', 'p1')).toBeNull();
  });

  it('from tier 2, one a week per tech, on its own turn; never the analyst', () => {
    const t1 = island(3, 70, 1);
    expect(canCheck(t1, 'mech', 'p1')).toMatchObject({ ok: false, why: `Quick checks open at tier ${CHECK.fromTier}.` });
    expect(CHECK.fromTier).toBe(DEFECT.blindFromTier);
    expect(apply(t1, { t: 'check', role: 'mech', assetId: 'p1', item: null, week: t1.week }, ++clock).error).toMatch(/tier 2/);
    let s = island(3);
    expect(canCheck(s, 'mech', 'p1')).toEqual({ ok: true });
    s = ok(s, { t: 'check', role: 'mech', assetId: 'p1', item: null, week: s.week });
    expect(s.checked).toEqual({ mech: 5 });
    expect(apply(s, { t: 'check', role: 'mech', assetId: 'p2', item: null, week: s.week }, ++clock).error).toMatch(/One quick check a week/);
    // the electrician's is separate
    s = ok(s, { t: 'check', role: 'elec', assetId: 'h1', item: null, week: s.week });
    expect(s.checked).toEqual({ mech: 5, elec: 5 });
    // the analyst never checks; a turn ended can't
    expect(apply(s, { t: 'check', role: 'fin' as OpsRole, assetId: 'p1', item: null, week: s.week }, ++clock).error).toBeDefined();
    let e = island(4);
    e = ok(e, { t: 'endTurn', role: 'elec', week: e.week });
    expect(apply(e, { t: 'check', role: 'elec', assetId: 'h1', item: null, week: e.week }, ++clock).error).toMatch(/turn is over/);
    // not the other trade's asset, not an item off the check
    expect(apply(island(4), { t: 'check', role: 'mech', assetId: 'h1', item: null, week: 5 }, ++clock).error).toBeDefined();
    expect(apply(island(4), { t: 'check', role: 'mech', assetId: 'p1', item: 'kitchen1', week: 5 }, ++clock).error).toMatch(/isn't on this check/);
    // week-bound: a check queued offline across a deadline is refused
    expect(apply(island(4), { t: 'check', role: 'mech', assetId: 'p1', item: null, week: 4 }, ++clock).error).toMatch(/closed before that synced/);
  });

  it('"All serviceable" raises nothing, and says so blind', () => {
    let s = island(5);
    const before = s.alerts!.length;
    s = ok(s, { t: 'check', role: 'mech', assetId: 'p1', item: null, week: s.week });
    expect(s.alerts!.length).toBe(before);
    expect(s.feed.at(-1)!.text).toBe('Ana walked around Twin N-12: all serviceable.');
  });

  it('the grid and the generator read as things mid-sentence: "IR-scanned the island grid", "walked around the generator house"', () => {
    let s = island(5, 70, 3);
    s = ok(s, { t: 'check', role: 'elec', assetId: 'g1', item: null, week: s.week });
    expect(s.feed.at(-1)!.text).toBe('Ben IR-scanned the island grid: all normal.');
    s = ok(s, { t: 'check', role: 'mech', assetId: 'gen', item: null, week: s.week });
    expect(s.feed.at(-1)!.text).toBe('Ana walked around the generator house: all serviceable.');
  });
});

describe('the check data a working electrician reads (6.4, the integrator’s realism pass)', () => {
  // NEC Table 310.16, 75 °C column (the terminations' rating): copper and aluminium ampacities
  const CU: Record<string, number> = { '#14': 20, '#12': 25, '#10': 35, '#8': 50, '#6': 65, '#4': 85, '#3': 100, '#2': 115, '#1': 130, '1/0': 150, '2/0': 175, '3/0': 200, '4/0': 230 };
  const AL: Record<string, number> = { '250 kcmil': 205, '300 kcmil': 230, '350 kcmil': 250, '500 kcmil': 310, '600 kcmil': 340, '750 kcmil': 385 };
  const ampacity = (awg: string): number => {
    const par = /^(\d+) × (.+)$/.exec(awg);
    if (par) return Number(par[1]) * ampacity(par[2]);
    const m = /^(.+) (Cu|Al)$/.exec(awg)!;
    return (m[2] === 'Cu' ? CU : AL)[m[1]];
  };
  it('every breaker on the panels is on a conductor rated for it at 75 °C: the 400 A main on two sets of 250 kcmil Al, not one 500 kcmil', () => {
    for (const b of [...HOME_PANEL, ...GEN_PANEL]) {
      const a = ampacity(b.awg);
      expect(a, `${b.label} ${b.awg}`).toBeGreaterThan(0);
      expect(a, `${b.label}: ${b.amps} A on ${b.awg} (${a} A)`).toBeGreaterThanOrEqual(b.amps);
    }
    expect(HOME_PANEL.find((b) => b.id === 'main')).toMatchObject({ amps: 400, awg: '2 × 250 kcmil Al' });
  });
  it("the generator's main breaker is no bigger than the transfer switch it feeds", () => {
    const sw = GEN_PANEL.filter((b) => b.id.startsWith('xfer'));
    const brk = GEN_PANEL.find((b) => b.id === 'genbrk')!;
    for (const x of sw) expect(brk.amps, x.label).toBeLessThanOrEqual(x.amps);
  });
});

describe('what a check shows: the wear coming, never s.defects (6.4)', () => {
  it('a state with hidden defects and one without give identical views, for every check on every asset', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const s = island(seed, 64, 3);
      const d = structuredClone(s);
      d.defects = s.assets.map(
        (a, i): Defect => ({ id: `d${i}`, orderKind: a.kind === 'plane' ? 'tires' : 'trip', puzzle: a.kind === 'plane' ? 'torque' : 'trace', title: 'x', assetId: a.id, role: roleFor(a), by: roleFor(a), name: 'Ana', week: 4, dueWeek: 6, severity: 2, cost: 300, tier: 2, gain: 10, redo: true }),
      );
      for (const a of s.assets)
        for (const role of ['mech', 'elec'] as OpsRole[]) {
          expect(JSON.stringify(checkView(d, role, a.id))).toBe(JSON.stringify(checkView(s, role, a.id)));
          expect(checkTruth(d, role, a.id, 5)).toEqual(checkTruth(s, role, a.id, 5));
        }
    }
  });

  it('every item of the check in one view: the whole walkaround, every breaker, every circuit and the service', () => {
    const s = island(7, 70, 5);
    s.assets.push({ id: 'p3', kind: 'plane', model: 'float', name: 'Float F-3', health: 70, touchedWeek: 0, sinceInspection: 0 }, { id: 'h5', kind: 'house', model: 'villa', name: 'Villa East', health: 70, touchedWeek: 0, inspectionUntil: 40 });
    expect(checkView(s, 'mech', 'p1')!.items.map((i) => i.id)).toEqual(WALK_ZONES.twin.map((z) => z.id));
    expect(checkView(s, 'mech', 'p2')!.items.map((i) => i.id)).toEqual(WALK_ZONES.cargo.map((z) => z.id));
    expect(checkView(s, 'mech', 'p3')!.items.map((i) => i.id)).toEqual(WALK_ZONES.float.map((z) => z.id));
    expect(checkView(s, 'mech', 'gen')!.items.map((i) => i.id)).toEqual(['mounts', 'belt', 'exhaust', 'enclosure']);
    // the tier-5 panel: the main and nine branches
    expect(checkView(s, 'elec', 'g1')!.items).toHaveLength(10);
    // a cottage's seven circuits and the service; a villa adds the laundry and a second bedroom
    expect(checkView(s, 'elec', 'h1')!.items.map((i) => i.id)).toEqual(['kitchen1', 'kitchen2', 'bath', 'bedroom', 'living', 'hall', 'porch', 'service']);
    expect(checkView(s, 'elec', 'h5')!.items).toHaveLength(10);
    // every item's write-up row exists
    for (const a of s.assets)
      for (const role of ['mech', 'elec'] as OpsRole[]) {
        const v = checkView(s, role, a.id);
        for (const i of v?.items ?? []) expect(SYMPTOMS[`K_${v!.kind === 'walkaround' ? 'walk' : v!.kind}:${i.id}`], `${a.id} ${i.id}`).toBeDefined();
      }
  });

  it('the tell shows only for an in-scope kind with weight now and nothing of it open on the asset', () => {
    const scope: Record<CheckKind, string[]> = { walkaround: ['tires', 'hydraulics', 'corrosion', 'spar', 'oil', 'cylinder', 'genService'], ir: ['xfmr', 'panelUp', 'transfer'], meter: ['trip', 'gfci', 'flicker'] };
    let seen = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const h = 40 + (seed % 55);
      const s = island(seed, h, 3);
      for (const a of s.assets) {
        const role = a.kind === 'generator' ? (seed % 2 ? 'mech' : 'elec') : roleFor(a);
        const t = checkTruth(s, role, a.id, s.week);
        if (!t) continue;
        seen++;
        expect(scope[checkKindFor(s, role, a)!]).toContain(t.kind);
        expect(CATALOG_BY_KIND[t.kind].weight(a, s.week)).toBeGreaterThan(0);
      }
    }
    expect(seen).toBeGreaterThan(100);
    // a plane at 99 has nothing coming: no tell, whatever the seed
    for (let seed = 1; seed <= 40; seed++) expect(checkTruth(island(seed, 99), 'mech', 'p1', 5)).toBeNull();
    // the kind already open on the asset (its job planned) shows no tell
    const { s, kind } = withTell('p1', 'mech');
    s.orders.push({ id: 'o999', role: 'mech', kind, assetId: 'p1', title: 'x', puzzle: 'torque', tier: 2, cost: 1, parts: 0, gain: 1, createdWeek: 5, deferrals: 0, lastDeferredWeek: null, status: 'ready', seed: 1 });
    expect(checkTruth(s, 'mech', 'p1', 5)?.kind).not.toBe(kind);
  });

  it('its chance grows with the wear depth: faint just under the threshold, CHECK.detect well under it', () => {
    const rate = (health: number) => {
      let n = 0;
      for (let seed = 1; seed <= 300; seed++) {
        const s = island(seed, health);
        // the cargo plane's walkaround sees tires (under 96) and the wheel half (under 86)
        s.assets = s.assets.filter((a) => a.id !== 'p1');
        if (checkTruth(s, 'mech', 'p2', 5)) n++;
      }
      return n / 300;
    };
    const faint = rate(95);
    const deep = rate(60);
    expect(faint).toBeLessThan(deep);
    expect(faint).toBeGreaterThan(0.05);
    expect(faint).toBeLessThan(CHECK.detect * CHECK.minShow + 0.08);
    expect(Math.abs(deep - CHECK.detect)).toBeLessThan(0.08);
    // the thresholds are the catalog's
    expect(wearFromOf('tires')).toBe(96);
    expect(wearFromOf('corrosion')).toBe(86);
    expect(wearFromOf('panelUp')).toBe(66);
  });

  it('the engine’s oil and cylinder show only as a late tell, 10 points or more under their threshold', () => {
    let late = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const s = island(seed, 88);
      const t = checkTruth(s, 'mech', 'p1', 5);
      expect(t?.kind === 'oil' || t?.kind === 'cylinder').toBe(false);
      const deep = island(seed, 50);
      const u = checkTruth(deep, 'mech', 'p1', 5);
      if (u?.kind === 'oil' || u?.kind === 'cylinder') late++;
    }
    expect(late).toBeGreaterThan(0);
  });

  it('the pools: three or more phrasings for every tell and every zone, and a tell reads like a benign sign', () => {
    for (const [kind, sc] of Object.entries(WALK_SCOPE)) for (const t of sc.tells) expect(t.texts.length, kind).toBeGreaterThanOrEqual(3);
    for (const [zone, pool] of Object.entries(WALK_BENIGN)) expect(pool.length, zone).toBeGreaterThanOrEqual(3);
    expect(GFCI_OK.length).toBeGreaterThanOrEqual(3);
    expect(GFCI_TELL.length).toBeGreaterThanOrEqual(3);
    // the words change week to week for the same zone
    const texts = new Set<string>();
    for (let w = 3; w < 15; w++) {
      const s = island(9);
      s.week = w;
      texts.add(checkView(s, 'mech', 'p1')!.items.find((i) => i.id === 'lmain')!.text);
    }
    expect(texts.size).toBeGreaterThanOrEqual(3);
    // a tell's text comes from its kind's pool
    const { s, item, kind } = withTell('p1', 'mech');
    const text = checkView(s, 'mech', 'p1')!.items.find((i) => i.id === item)!.text;
    expect(WALK_SCOPE[kind].tells.flatMap((t) => t.texts)).toContain(text);
  });

  it('the IR scan reads heat against load: the tell 10-20 °C over at 40-70% load, the look-alike warm but right for its load at 70-79% (under the 80% line), too light under 40%, the edge lights off by day, raw temperatures that overlap', () => {
    const tells: number[] = [];
    const distractors: number[] = [];
    const exp = (pct: number) => IR.riseFull * (pct / 100) ** 2;
    for (let seed = 1; seed <= 400; seed++) {
      const s = island(seed, 80, seed % 2 ? 4 : 5);
      const v = checkView(s, 'elec', 'g1')!;
      expect(v.ppe).toBe('Dead front off: arc-rated PPE per NFPA 70E.');
      expect(v.help.join(' ')).toMatch(/NFPA 70B: scan at 40% of the rated load or more\. A reading under 40% is marked too light to judge\./);
      expect(v.help.join(' ')).toMatch(/NETA/);
      // (review round 1: 215.3 is the feeder rule; the main is read against the service's)
      expect(v.help.join(' ')).toMatch(/NEC 230\.42\(A\)/);
      expect(v.help.join(' ')).not.toMatch(/215\.3/);
      const t = checkTruth(s, 'elec', 'g1', 5);
      for (const i of v.items) {
        const r = i.reading!;
        if (i.id === 'main') continue;
        // no branch reads over the 80% line: a pro applying the help's own rule has nothing to write up but heat
        expect(r.loadPct!, i.label).toBeLessThan(80);
        if (i.id === 'edge') {
          // a night load in an afternoon scan: off, too light to judge, never the tell
          expect(r.loadPct).toBeLessThanOrEqual(3);
          expect(r.tooLight).toBe(true);
          expect(t?.item).not.toBe('edge');
          continue;
        }
        if (r.loadPct! < IR.tooLight) {
          expect(r.tooLight).toBe(true);
          expect(i.text).toMatch(/too light to judge/);
          expect(t?.item).not.toBe(i.id);
        } else expect(r.tooLight).toBeUndefined();
        if (t?.item === i.id) {
          expect(r.loadPct).toBeGreaterThanOrEqual(40);
          expect(r.loadPct).toBeLessThanOrEqual(70);
          expect(r.riseC! - exp(r.loadPct!)).toBeGreaterThanOrEqual(9.9);
          expect(r.riseC! - exp(r.loadPct!)).toBeLessThanOrEqual(20.1);
          tells.push(r.riseC!);
        } else {
          // every other branch reads what its load predicts, the look-alike too (warm: 10-13 °C at 70-79%)
          expect(Math.abs(r.riseC! - exp(r.loadPct!))).toBeLessThanOrEqual(3.1);
          if (r.loadPct! >= 70 && r.riseC! >= 10) distractors.push(r.riseC!);
        }
      }
    }
    expect(tells.length).toBeGreaterThan(20);
    expect(distractors.length).toBeGreaterThan(100);
    // the raw temperatures overlap: some tells read cooler than some look-alikes
    expect(Math.min(...tells)).toBeLessThan(Math.max(...distractors));
  });

  it("the generator house's three loaded terminations carry one current: healthy, they read within about 2 °C; the tell stands 10-20 °C over (review round 1)", () => {
    let healthy = 0;
    let told = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const s = island(seed, 60, 3);
      for (const W of [5, 6, 7]) {
        const v = checkView(s, 'elec', 'gen', W)!;
        const loaded = v.items.filter((i) => i.id !== 'xferU');
        const t = checkTruth(s, 'elec', 'gen', W);
        const ok = loaded.filter((i) => i.id !== t?.item).map((i) => i.reading!.riseC!);
        expect(Math.max(...ok) - Math.min(...ok), `seed ${seed} week ${W}`).toBeLessThanOrEqual(2 * (IR.genEach + 0.05));
        healthy++;
        if (t) {
          const hot = loaded.find((i) => i.id === t.item)!.reading!.riseC!;
          expect(hot - Math.max(...ok)).toBeGreaterThanOrEqual(10 - 2 * IR.genEach - 0.1);
          told++;
        }
      }
    }
    expect(healthy).toBe(900);
    expect(told).toBeGreaterThan(20);
  });

  it("the panel's main is read for its load: 82-95% continuous is the upgrade's tell", () => {
    let found = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const s = island(seed, 60, 3);
      const t = checkTruth(s, 'elec', 'g1', 5);
      const main = checkView(s, 'elec', 'g1')!.items.find((i) => i.id === 'main')!;
      if (t?.item === 'main') {
        found++;
        expect(t.kind).toBe('panelUp');
        expect(main.reading!.loadPct).toBeGreaterThanOrEqual(82);
      } else expect(main.reading!.loadPct).toBeLessThanOrEqual(70);
    }
    expect(found).toBeGreaterThan(0);
  });

  it('the meter check: volts under a 12 A load and each run’s length; the tell a 5-9 V drop on a short run, the long porch run normal for its length', () => {
    let tells = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const s = island(seed, 80);
      const v = checkView(s, 'elec', 'h1')!;
      const t = checkTruth(s, 'elec', 'h1', 5);
      const service = v.items.find((i) => i.id === 'service')!;
      for (const i of v.items) {
        if (i.id === 'service') continue;
        expect(i.reading!.amps).toBe(12);
        expect(i.label).toMatch(/\(\d+ ft\)$/);
        // the porch's long run reads a 4.5-6 V drop: normal for 120-150 ft of 12 AWG, the check's look-alike
        if (i.id === 'porch' && t?.item !== 'porch') {
          expect(i.reading!.runFt).toBeGreaterThanOrEqual(120);
          const drop = (2 * i.reading!.runFt! * 12 * METER.ohms[12]) / 1000;
          expect(drop).toBeGreaterThanOrEqual(4.5);
          expect(drop).toBeLessThanOrEqual(6);
        }
        if (t?.item === i.id && t.kind === 'trip') {
          tells++;
          expect(i.reading!.runFt).toBeLessThan(50);
        }
      }
      if (t?.item === 'service') expect(service.text).toMatch(/L1 1(0[4-9]|10)\.\d V · L2 13[0-6]\.\d V/);
      else expect(service.text).toMatch(/L1 1(1[89]|2\d)\.\d V · L2 1(1[89]|2\d)\.\d V/);
    }
    expect(tells).toBeGreaterThan(20);
  });
});

describe('the call (6.4)', () => {
  it('a right call raises that kind’s alert now: early, one order tier easier (a blind job stays blind) and a tier cheaper, due its lead + 1', () => {
    const { s: s0, item, kind } = withTell('p1', 'mech');
    const s = ok(s0, { t: 'check', role: 'mech', assetId: 'p1', item, week: s0.week });
    const al = s.alerts!.at(-1)!;
    expect(al).toMatchObject({ role: 'mech', assetId: 'p1', src: 'check', kind, early: true, status: 'open', who: 'Ana' });
    expect(al.cause).toBeGreaterThanOrEqual(0);
    expect(al.due).toBeGreaterThanOrEqual(s.week + 2);
    expect(al.due).toBeLessThanOrEqual(s.week + 3);
    // its job: one tier easier than the same job not found early (never out of the blind tiers: review round 1), and
    // priced a tier lower
    const task = fixTaskFor(s, al)!;
    const planned = ok(s, { t: 'plan', role: 'mech', alert: al.id, task: task.id, pick: stdPickFor(s, al, task), week: s.week });
    const o = planned.orders.find((x) => x.flow?.alert === al.id)!;
    const normalTier = Math.max(1, CATALOG_BY_KIND[kind].tier + Math.floor(s.tier / 2) + (s.assets[0].health < 50 ? 1 : 0));
    expect(o.tier).toBe(earlyTier(normalTier, 1));
    expect(o.cost).toBeLessThanOrEqual(laborCost(s, kind, task, s.assets.find((a) => a.id === 'p1')!, null, null));
    // the review line at the resolve: blind
    expect(s.feed.at(-1)!.text).toMatch(/^Ana walked around Twin N-12 and wrote up the .+: it's on the alert list\.$/);
  });

  it('a wrong call is a no-fault write-up of the same row a right call raises: the words match until Investigate', () => {
    const { s: s0, item } = withTell('p1', 'mech');
    const wrong = WALK_ZONES.twin.map((z) => z.id).find((z) => z !== item)!;
    const right = ok(s0, { t: 'check', role: 'mech', assetId: 'p1', item, week: 5 });
    const miss = ok(s0, { t: 'check', role: 'mech', assetId: 'p1', item: wrong, week: 5 });
    const a = right.alerts!.at(-1)!;
    const b = miss.alerts!.at(-1)!;
    expect(b).toMatchObject({ src: 'check', cause: -1, kind: 'nff', status: 'open' });
    expect(b.early).toBeUndefined();
    // the same shape of words: "Written up at Ana's walkaround: the R main."
    expect(symptomText(right, a)).toMatch(/^Written up at Ana's walkaround: the .+\.$/);
    expect(symptomText(miss, b)).toMatch(/^Written up at Ana's walkaround: the .+\.$/);
    expect(alertShort(miss, b)).toMatch(/^the .+ \(Ana's walkaround\)$/);
    // Investigate tells them apart: a real finding, or nothing out of limits (closable as no fault found, on site)
    expect(findingOf(right, a, 3).nff).toBe(false);
    expect(findingOf(miss, b, 3)).toMatchObject({ nff: true });
    expect(apply(right, { t: 'nff', role: 'mech', alert: a.id, week: 5 }, ++clock).error).toMatch(/finding shows the fault/);
    const closed = ok(miss, { t: 'nff', role: 'mech', alert: b.id, week: 5 });
    expect(closed.alerts!.find((x) => x.id === b.id)!.status).toBe('closed');
  });

  it('a wrong call holds one of the trade’s slots until it is closed: the week’s draw is one smaller', () => {
    const base = island(21, 80);
    // two real alerts open already: the draw has 2 slots left under the target of 4 (tier 2)
    for (const id of ['h1', 'h3']) raiseAlert(base, { role: 'elec', asset: base.assets.find((a) => a.id === id)!, sym: 'E_DEAD_OUTLET', cause: 0 }, NOW);
    const wrongItem = checkView(base, 'elec', 'h1')!.items.map((i) => i.id).find((i) => i !== checkTruth(base, 'elec', 'h1', 5)?.item)!;
    const withUp = ok(base, { t: 'check', role: 'elec', assetId: 'h1', item: wrongItem, week: 5 });
    expect(openWork(withUp, 'elec').open).toBe(openWork(base, 'elec').open + 1);
    // the same draw on both: the one with the write-up open raises one fewer
    const draw = (s: IslandState) => {
      const x = structuredClone(s);
      const n = x.alerts!.length;
      generateAlerts(x, rng(hashSeed('draw', 1)), NOW, () => {});
      return x.alerts!.slice(n).filter((a) => a.role === 'elec' && a.cause >= 0).length;
    };
    expect(draw(withUp)).toBe(draw(base) - 1);
    // closed on site (no fault found), the slot is free again
    const up = withUp.alerts!.at(-1)!;
    const closed = ok(withUp, { t: 'nff', role: 'elec', alert: up.id, week: 5 });
    expect(openWork(closed, 'elec').open).toBe(openWork(base, 'elec').open);
  });

  it("the week's review writes each write-up, never whether it was right", () => {
    const { s: s0, item } = withTell('h1', 'elec', 80);
    let s = ok(s0, { t: 'check', role: 'elec', assetId: 'h1', item, week: 5 });
    for (const r of ROLES) if (!s.turns[r]?.ended) s = ok(s, { t: 'endTurn', role: r, week: 5 });
    const lines = s.history.at(-1)!.lines.map((l) => l.text);
    const line = lines.find((l) => /meter-checked/.test(l))!;
    expect(line).toMatch(/^Ben meter-checked Cottage 1 and wrote up the .+ circuit\.$|^Ben meter-checked Cottage 1 and wrote up the service legs\.$/);
    expect(line).not.toMatch(/right|wrong|found|early/i);
  });

  it('every write-up row is well formed: its causes fix a kind in scope, and it is never drawn by the week’s slots', () => {
    for (const [key, row] of Object.entries(CHECK_ROWS)) {
      const sym = SYMPTOMS[key];
      expect(sym.auto, key).toBe(true);
      expect(sym.src).toBe('check');
      expect(sym.nff?.length).toBeGreaterThan(0);
      expect(row.word.length).toBeGreaterThan(3);
      for (const c of sym.causes) expect(c.fix, `${key} ${c.kind}`).toBeTruthy();
    }
  });
});

describe('the import guard: UI code never imports checkTruth (13.1)', () => {
  it('no file under src/ui mentions it', () => {
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
    const ui = walk(resolve(import.meta.dirname, '../src/ui')).filter((f) => /\.(ts|tsx)$/.test(f));
    expect(ui.length).toBeGreaterThan(20);
    for (const f of ui) expect(readFileSync(f, 'utf8').includes('checkTruth'), f).toBe(false);
  });
});
