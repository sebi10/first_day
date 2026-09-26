// Consequences: blind sign-off, hidden defects → incidents, repair → redo,
// and cross-trade reports. The engine hides the verdict from the player but
// never from itself: the true score drives everything that happens later.
import { afterEach, describe, expect, it } from 'vitest';
import { simulate, TEAMS } from '../src/sim/bots';
import { CATALOG, DEFECT, DEFECT_RULES, DEFECT_RULES_BY_KIND, defectRule, incidentText, INSPECTS, REPORT, REPORTS } from '../src/sim/data';
import { defectChance, defectSeverity, isBlind, isRework, launchTier, reportCap, round10 } from '../src/sim/econ';
import { apply, createIsland } from '../src/sim/engine';
import { hashSeed } from '../src/sim/rng';
import type { Defect, IslandState, Order, ReportInfo, Role } from '../src/sim/types';

const NOW = Date.UTC(2026, 8, 26, 10);

function started(): IslandState {
  let s = createIsland({ id: 'cq', name: 'Consequence Isle', now: NOW, tz: 'Europe/Paris', seed: 7, creator: { uid: 'a', name: 'Ana', role: 'mech' } });
  s = apply(s, { t: 'join', uid: 'b', name: 'Ben', role: 'elec' }, NOW).s;
  s = apply(s, { t: 'join', uid: 'c', name: 'Cy', role: 'fin' }, NOW).s;
  for (const r of ['mech', 'elec', 'fin'] as Role[]) s = apply(s, { t: 'week0Done', role: r }, NOW).s;
  return s;
}

/** a started island moved to week `w` (nothing generated in between; enough for rule tests) */
function atWeek(w: number): IslandState {
  const s = started();
  s.week = w;
  return s;
}

let seq = 0;
/** a hand-made order (ready unless told otherwise) */
function addOrder(s: IslandState, f: Partial<Order> & Pick<Order, 'role' | 'kind' | 'puzzle'>): Order {
  seq++;
  const o: Order = {
    id: `t${seq}`,
    assetId: null,
    title: f.kind,
    tier: 1,
    cost: 0,
    parts: 0,
    gain: 0,
    createdWeek: s.week,
    deferrals: 0,
    lastDeferredWeek: null,
    status: 'ready',
    seed: hashSeed('test-order', seq),
    ...f,
  };
  s.orders.push(o);
  return o;
}

function plant(s: IslandState, d: Partial<Defect> = {}): Defect {
  const def: Defect = {
    id: `dt${++seq}`,
    orderKind: 'prop',
    job: 'prop',
    log: 'prop bolt re-torque',
    puzzle: 'torque',
    title: 'Prop bolt re-torque',
    assetId: 'p1',
    role: 'mech',
    by: 'mech',
    name: 'Ana',
    week: s.week - 1,
    dueWeek: s.week + 2,
    severity: 1,
    cost: 280,
    tier: 2,
    gain: 12,
    redo: true,
    ...d,
  };
  (s.defects ??= []).push(def);
  return def;
}

function reportOrder(s: IslandState, key: string, extra: Partial<Order> = {}): Order {
  const def = REPORTS.find((r) => r.key === key)!;
  const report: ReportInfo = { key, by: def.by, effect: def.effect, amount: def.effect === 'leak' ? def.amount ?? 0 : 0 };
  return addOrder(s, { role: def.fixer, kind: 'report', puzzle: def.puzzle, title: def.title, report, ...extra });
}

const complete = (s: IslandState, role: Role, o: Order, score: number) => apply(s, { t: 'complete', role, orderId: o.id, score, perfect: score >= 0.95, summary: '5/6 bolts in band' }, NOW);
const complete2 = (s: IslandState, role: Role, o: Order, score: number, cover: boolean) => apply(s, { t: 'complete', role, orderId: o.id, score, perfect: score >= 0.95, cover }, NOW);
const resolve = (s: IslandState) => apply(s, { t: 'resolve', week: s.week }, s.deadline! + 1).s;
const lastReport = (s: IslandState) => s.history[s.history.length - 1];

describe('blind sign-off', () => {
  it('a real job at puzzle tier 2+ is blind; teaching tiers, lend-a-hand and new-crew grace are not', () => {
    const s = started();
    expect(isBlind(s, { tier: 2, role: 'mech' }, 'mech')).toBe(true);
    expect(isBlind(s, { tier: 1, role: 'mech' }, 'mech')).toBe(false);
    expect(isBlind(s, { tier: 3, role: 'mech' }, 'elec', true)).toBe(false); // lend a hand keeps its explicit verdict
    expect(isBlind(s, { tier: 3, role: 'mech' }, 'elec')).toBe(false); // not their order
    s.players.mech!.graceUntil = 5; // a new player plays tier 1 for a while
    expect(launchTier(s, { tier: 3 }, 'mech')).toBe(1);
    expect(isBlind(s, { tier: 3, role: 'mech' }, 'mech')).toBe(false);
    const w0 = createIsland({ id: 'w0', name: 'W0', now: NOW, tz: 'UTC', creator: { uid: 'a', name: 'Ana', role: 'mech' } });
    expect(isBlind(w0, { tier: 3, role: 'mech' }, 'mech')).toBe(false); // week 0
  });

  it('a blind job under 40% is signed off (no rework); the result keeps the true score but no verdict text', () => {
    const s = started();
    const o = addOrder(s, { role: 'mech', kind: 'prop', puzzle: 'torque', assetId: 'p1', tier: 2, cost: 280, gain: 12, title: 'Prop bolt re-torque' });
    const r = complete(s, 'mech', o, 0.3);
    expect(r.error).toBeUndefined();
    const done = r.s.orders.find((x) => x.id === o.id)!;
    expect(done.status).toBe('done');
    expect(done.result).toMatchObject({ score: 0.3, blind: true });
    expect(done.result!.summary).toBeUndefined();
    const line = r.s.feed[r.s.feed.length - 1].text;
    expect(line).toMatch(/signed off Prop bolt re-torque/);
    expect(line).not.toMatch(/%|perfect/);
    // the same job at a teaching tier still goes back for rework
    const t1 = addOrder(s, { role: 'mech', kind: 'prop', puzzle: 'torque', assetId: 'p1', tier: 1, cost: 280, gain: 12 });
    const r1 = complete(s, 'mech', t1, 0.3);
    expect(r1.s.orders.find((x) => x.id === t1.id)!.status).toBe('ready');
    expect(isRework(t1, 0.3, true)).toBe(false);
    expect(isRework(t1, 0.3, false)).toBe(true);
  });

  it('a blind inspection is in the logbook whatever it missed', () => {
    const s = started();
    s.assets.find((a) => a.id === 'p1')!.sinceInspection = 11;
    const o = addOrder(s, { role: 'mech', kind: 'inspect100', puzzle: 'crack', assetId: 'p1', tier: 2, cost: 180, gain: 10 });
    const r = complete(s, 'mech', o, 0.45);
    expect(r.s.assets.find((a) => a.id === 'p1')!.sinceInspection).toBe(0);
  });

  it('the review never shows a blind score, not even in the MVP line', () => {
    let s = started();
    const o = addOrder(s, { role: 'mech', kind: 'prop', puzzle: 'torque', assetId: 'p1', tier: 2, cost: 280, gain: 12, title: 'Prop bolt re-torque' });
    s = complete(s, 'mech', o, 0.91).s;
    s = resolve(s);
    expect(lastReport(s).mvp.mech).not.toMatch(/Prop bolt re-torque \d+%/);
    expect(lastReport(s).mvp.mech).toMatch(/1 signed off/);
  });

  it("a blind job's health and XP don't move with its score until the week resolves", () => {
    const signOff = (q: number) => {
      const s = started();
      s.assets.find((a) => a.id === 'p1')!.health = 60;
      const o = addOrder(s, { role: 'mech', kind: 'corrosion', puzzle: 'crack', assetId: 'p1', tier: 3, cost: 520, gain: 16 });
      return complete(s, 'mech', o, q).s;
    };
    const hp = (x: IslandState) => x.assets.find((a) => a.id === 'p1')!.health;
    const bad = signOff(0.2);
    const good = signOff(1);
    // at hand-in: the same stand-in whatever the score (no immediate verdict in the numbers)
    expect(hp(bad)).toBe(hp(good));
    expect(bad.players.mech!.xp).toBe(good.players.mech!.xp);
    expect(good.players.mech!.perfects).toBe(0);
    expect(good.orders.find((o) => o.result)!.result!.provisional).toBeDefined();
    // the week resolves: the true result lands before anything flies (same week otherwise)
    const rb = resolve(bad);
    const rg = resolve(good);
    expect(hp(rg) - hp(rb)).toBeCloseTo(16 * (1.05 - 0.57), 1);
    expect(rg.players.mech!.xp).toBeGreaterThan(rb.players.mech!.xp);
    expect(rg.players.mech!.perfects).toBe(1);
    expect(rg.orders.find((o) => o.result?.blind)?.result?.provisional).toBeUndefined();
  });

  it('a teaching-tier job still shows its result at once', () => {
    const s = started();
    s.assets.find((a) => a.id === 'p1')!.health = 60;
    const o = addOrder(s, { role: 'mech', kind: 'tires', puzzle: 'torque', assetId: 'p1', tier: 1, cost: 320, gain: 10 });
    const r = complete(s, 'mech', o, 1).s;
    expect(r.assets.find((a) => a.id === 'p1')!.health).toBeCloseTo(60 + 10 * 1.05);
    expect(r.players.mech!.perfects).toBe(1);
  });

  it('a blind sign-off never sets a personal best (a new best would give the score away)', () => {
    const s = started();
    const before = s.players.mech!.best?.torque;
    const o = addOrder(s, { role: 'mech', kind: 'prop', puzzle: 'torque', assetId: 'p1', tier: 2, cost: 280, gain: 12 });
    const r = complete(s, 'mech', o, 0.97);
    expect(r.s.players.mech!.best?.torque).toBe(before);
    const t1 = addOrder(s, { role: 'mech', kind: 'prop', puzzle: 'torque', assetId: 'p1', tier: 1, cost: 280, gain: 12 });
    expect(complete(s, 'mech', t1, 0.97).s.players.mech!.best?.torque).toBe(0.97);
  });
});

describe('hidden defects', () => {
  it('probability curve: none from 85%, up to 10% at a pass, steep below it, severe under 40%', () => {
    expect(defectChance(1)).toBe(0);
    expect(defectChance(0.85)).toBe(0);
    expect(defectChance(0.7)).toBeCloseTo((0.85 - 0.7) * DEFECT.slope);
    expect(defectChance(0.6)).toBeCloseTo(0.25 * DEFECT.slope);
    expect(defectChance(0.5)).toBeCloseTo(DEFECT.botchBase + 0.1 * DEFECT.botchSlope);
    expect(defectChance(0)).toBe(1);
    for (let q = 0; q < 1; q += 0.05) expect(defectChance(q + 0.05)).toBeLessThanOrEqual(defectChance(q) + 1e-12);
    expect(defectSeverity(0.39)).toBe(2);
    expect(defectSeverity(0.4)).toBe(1);
  });

  it('the roll is deterministic (seeded from the order) and follows the curve', () => {
    const s = started();
    const o = addOrder(s, { role: 'mech', kind: 'prop', puzzle: 'torque', assetId: 'p1', tier: 2, cost: 280, gain: 12 });
    const a = complete(s, 'mech', o, 0).s;
    const b = complete(s, 'mech', o, 0).s;
    expect(JSON.stringify(a.defects)).toBe(JSON.stringify(b.defects));
    expect(a.defects).toHaveLength(1);
    const d = a.defects![0];
    expect(d).toMatchObject({ orderKind: 'prop', puzzle: 'torque', assetId: 'p1', role: 'mech', by: 'mech', name: 'Ana', week: 1, severity: 2, cost: 280, redo: true });
    expect(d.dueWeek).toBeGreaterThanOrEqual(2);
    expect(d.dueWeek).toBeLessThanOrEqual(1 + DEFECT.dueMax[1]); // severe comes due sooner
    expect(complete(s, 'mech', o, 0.9).s.defects ?? []).toHaveLength(0);
    // frequency over many orders matches defectChance
    for (const q of [0.5, 0.7]) {
      let n = 0;
      const N = 400;
      for (let i = 0; i < N; i++) {
        const t = started();
        const oo = addOrder(t, { role: 'elec', kind: 'trip', puzzle: 'trace', assetId: 'h1', tier: 2, cost: 120, gain: 12 });
        if (complete(t, 'elec', oo, q).s.defects?.length) n++;
      }
      expect(n / N, `q=${q}`).toBeGreaterThan(defectChance(q) * 0.6);
      expect(n / N, `q=${q}`).toBeLessThan(defectChance(q) * 1.4 + 0.01);
    }
  });

  it('desk tasks, crew projects and reports never leave asset defects', () => {
    const s = started();
    const close = s.orders.find((o) => o.role === 'fin' && (o.kind === 'close' || o.kind === 'reconcile'))!;
    expect(complete(s, 'fin', close, 0).s.defects ?? []).toHaveLength(0);
    const proj = addOrder(s, { role: 'mech', kind: 'project', puzzle: 'balance', tier: 3 });
    expect(complete(s, 'mech', proj, 0).s.defects ?? []).toHaveLength(0);
  });

  it('a passed inspection on the same asset finds it: no incident, a repair on a different puzzle instead', () => {
    const s = atWeek(4);
    const d = plant(s, { week: 3, dueWeek: 7 });
    const insp = addOrder(s, { role: 'mech', kind: 'inspect100', puzzle: 'crack', assetId: 'p1', tier: 2, cost: 180, gain: 10, title: '100-hr inspection' });
    // too sloppy to find anything (and it may leave its own miss behind)
    expect(complete(s, 'mech', insp, 0.5).s.defects!.some((x) => x.id === d.id)).toBe(true);
    const r = complete(s, 'mech', insp, 0.9).s;
    expect(r.defects).toHaveLength(0);
    const rep = r.orders.find((o) => o.kind === 'repair')!;
    expect(rep).toMatchObject({
      role: 'mech',
      assetId: 'p1',
      status: 'pending',
      title: 'Pull the prop, replace the bolts, inspect the flange for fretting',
      puzzle: 'teardown',
      // the teardown shows the propeller, not a random assembly
      job: 'prop',
      cost: round10(Math.max(280, DEFECT.minBase) * DEFECT.repairCost),
    });
    expect(rep.puzzle).not.toBe(d.puzzle);
    expect(rep.repair).toMatchObject({ via: 'inspection', foundBy: 'Ana', foundIn: '100-hr inspection', problem: 'prop bolts below torque, with fretting on the flange' });
    expect(r.feed.some((f) => /Ana's 100-hr inspection on Twin N-12 found prop bolts below torque, with fretting on the flange, left from week 3\..*Not airworthy until it’s repaired/.test(f.text))).toBe(true);
    // the review says so too, and nothing surfaces
    const after = resolve(r);
    expect(lastReport(after).lines.some((l) => /caught before it failed/.test(l.text))).toBe(true);
    expect(lastReport(after).incidents.filter((i) => i.kind === 'defect')).toHaveLength(0);
  });

  it("an inspection only finds its own trade's defects on that asset, from an earlier week", () => {
    const s = atWeek(4);
    plant(s, { week: 4 }); // signed off this week: too fresh to find
    plant(s, { assetId: 'p2' }); // another asset
    plant(s, { assetId: 'p1', role: 'elec', by: 'elec' }); // another trade
    const insp = addOrder(s, { role: 'mech', kind: 'inspect100', puzzle: 'crack', assetId: 'p1', tier: 2, cost: 180, gain: 10 });
    expect(complete(s, 'mech', insp, 0.9).s.defects).toHaveLength(3);
  });

  it('a defect due this week surfaces as a traced incident, then a repair; a grounded plane waits a week', () => {
    const base = atWeek(4);
    const control = resolve(structuredClone(base));
    const s = structuredClone(base);
    plant(s, { week: 2, dueWeek: 4, name: 'Ana' });
    const r = resolve(s);
    const rep = lastReport(r);
    const inc = rep.incidents.find((i) => i.kind === 'defect')!;
    expect(inc).toMatchObject({ role: 'mech', assetId: 'p1', cost: round10(Math.max(280, DEFECT.minBase) * DEFECT.incidentMult[0]), from: { title: 'Prop bolt re-torque', name: 'Ana', week: 2 } });
    const what = incidentText(DEFECT_RULES_BY_KIND.prop, 1, 'Twin N-12');
    expect(what).toBe('Pilot wrote up a vibration on Twin N-12: prop bolts found loose');
    expect(inc.title).toBe(what);
    expect(inc.from!.traced).toBe('the prop bolt re-torque Ana signed off in week 2');
    expect(rep.lines.some((l) => l.text === `${what}. Traced to the prop bolt re-torque Ana signed off in week 2.`)).toBe(true);
    // health took the hit (same week otherwise), insurance paid its share, safety grade counts it
    const hp = (x: IslandState) => x.assets.find((a) => a.id === 'p1')!.health;
    expect(hp(control) - hp(r)).toBeCloseTo(DEFECT.healthHit[0]);
    expect(rep.costs.incidents - lastReport(control).costs.incidents).toBe(Math.round(inc.cost * 0.5));
    expect(rep.components.safety).not.toBe('A');
    expect(r.defects).toHaveLength(0);
    const repair = r.orders.find((o) => o.kind === 'repair')!;
    expect(repair.repair!.via).toBe('incident');
    expect(repair.repair!.incident).toBe(what);
    expect(inc.from!.repairId).toBe(repair.id);
    expect(inc.from!.redo).toBe(true);
    expect(repair.gain).toBeGreaterThanOrEqual(DEFECT.repairMinGain);
    // a severe one reads as a failure, not a write-up
    const sev = structuredClone(base);
    plant(sev, { week: 2, dueWeek: 4, severity: 2 });
    const r2 = lastReport(resolve(sev)).incidents.find((i) => i.kind === 'defect')!;
    expect(r2.title).toBe('Prop bolts on Twin N-12 backed off in flight: heavy vibration, precautionary landing');

    const g = structuredClone(base);
    plant(g, { week: 2, dueWeek: 4 });
    g.tags = { p1: 'mech' };
    const waited = resolve(g);
    expect(lastReport(waited).incidents.filter((i) => i.kind === 'defect')).toHaveLength(0);
    expect(waited.defects).toHaveLength(1);
    expect(waited.defects![0].dueWeek).toBe(5);
  });

  it('nothing fails before week 3: an early defect waits', () => {
    const s = atWeek(2);
    plant(s, { week: 1, dueWeek: 2 });
    const r = resolve(s);
    expect(lastReport(r).incidents.filter((i) => i.kind === 'defect')).toHaveLength(0);
    expect(r.defects![0].dueWeek).toBe(3);
  });

  it('unknown puzzles (from other branches) fall back to a sensible repair', () => {
    expect(defectRule('hydraulics', 'mech').fix.puzzle).toBe('teardown');
    expect(defectRule('gpu', 'elec').fix.puzzle).toBe('meter');
    expect(defectRule('hydraulics', 'mech', 'bucketBoom')).toBe(defectRule('hydraulics', 'mech'));
    // every repair is a different puzzle from the job it corrects
    for (const [p, rule] of Object.entries(DEFECT_RULES)) expect(rule.fix.puzzle, p).not.toBe(p);
    for (const c of CATALOG) expect(defectRule(c.puzzle, c.role, c.kind).fix.puzzle, c.kind).not.toBe(c.puzzle);
    // per-kind wording where the part matters, and a [write-up, failure] pair everywhere
    expect(defectRule('crack', 'mech', 'spar').fix).toMatchObject({ title: 'Spar-cap doubler repair per the SRM', parts: 1 });
    expect(defectRule('crack', 'mech', 'corrosion').fix.parts).toBe(1);
    for (const rule of [...Object.values(DEFECT_RULES), ...Object.values(DEFECT_RULES_BY_KIND)]) {
      expect(rule.incident).toHaveLength(2);
      for (const t of rule.incident) expect(t, t).toContain('{a}');
    }
  });

  it('every catalog job has a noun form, so the trace reads as a sentence', () => {
    for (const c of CATALOG) {
      expect(c.log, c.kind).toBeTruthy();
      expect(c.log, c.kind).toBe(c.log.toLowerCase().replace('gfci', 'GFCI'));
    }
  });

  it("an inspection finds only what it looks at: a wheel-half check doesn't find loose prop bolts", () => {
    const s = atWeek(4);
    plant(s, { week: 3, dueWeek: 7 }); // prop bolts on p1
    const pen = addOrder(s, { role: 'mech', kind: 'corrosion', puzzle: 'crack', assetId: 'p1', tier: 2, cost: 520, gain: 16 });
    expect(complete(s, 'mech', pen, 0.9).s.defects).toHaveLength(1);
    const oil = addOrder(s, { role: 'mech', kind: 'oil', puzzle: 'safetywire', assetId: 'p1', tier: 2, cost: 190, gain: 9 });
    expect(complete(s, 'mech', oil, 0.9).s.defects).toHaveLength(0); // the engine look-over sees the prop
    expect(INSPECTS.inspect100.scope).toBe('all');
    // a repair's defect counts as the job it corrects
    const t = atWeek(4);
    plant(t, { orderKind: 'repair', job: 'tires', puzzle: 'teardown', title: 'Replace the wheel through-bolts and check the holes for elongation', redo: false, log: undefined });
    const pen2 = addOrder(t, { role: 'mech', kind: 'corrosion', puzzle: 'crack', assetId: 'p1', tier: 2, cost: 520, gain: 16 });
    const found = complete(t, 'mech', pen2, 0.9).s;
    expect(found.defects).toHaveLength(0);
    expect(found.feed.some((f) => /wheel-half penetrant check on Twin N-12 found a misassembled installation/.test(f.text))).toBe(true);
  });

  it('a known defect left in service is a near-miss; grounded, it is not', () => {
    const s = atWeek(4);
    plant(s, { week: 3, dueWeek: 9 });
    const insp = addOrder(s, { role: 'mech', kind: 'inspect100', puzzle: 'crack', assetId: 'p1', tier: 2, cost: 180, gain: 10 });
    const r = complete(s, 'mech', insp, 0.9).s;
    const flew = lastReport(resolve(structuredClone(r)));
    expect(flew.nearMisses).toBeGreaterThanOrEqual(1);
    expect(flew.lines.some((l) => /Twin N-12 flew with a known defect/.test(l.text))).toBe(true);
    const g = apply(structuredClone(r), { t: 'tag', role: 'mech', assetId: 'p1', on: true }, NOW).s;
    expect(lastReport(resolve(g)).lines.some((l) => /known defect/.test(l.text))).toBe(false);
  });

  it('the traced-to line reads as English for every kind of job', () => {
    const s = atWeek(4);
    plant(s, { orderKind: 'alternator', job: 'alternator', log: 'alternator replacement', puzzle: 'teardown', title: 'Replace alternator', week: 2, dueWeek: 4 });
    const t = lastReport(resolve(s)).lines.find((l) => /Traced to/.test(l.text))!.text;
    expect(t).toMatch(/Traced to the alternator replacement Ana signed off in week 2\.$/);
    const u = atWeek(4);
    plant(u, { orderKind: 'repair', job: 'prop', log: undefined, puzzle: 'teardown', title: 'Pull the prop, replace the bolts, inspect the flange for fretting', week: 2, dueWeek: 4, redo: false });
    expect(lastReport(resolve(u)).lines.find((l) => /Traced to/.test(l.text))!.text).toMatch(/Traced to the repair “Pull the prop, replace the bolts, inspect the flange for fretting” Ana signed off in week 2\.$/);
  });
});

describe('repair, then the original task', () => {
  function withRepair() {
    const s = atWeek(4);
    plant(s, { week: 3, dueWeek: 7 });
    const insp = addOrder(s, { role: 'mech', kind: 'inspect100', puzzle: 'crack', assetId: 'p1', tier: 2, cost: 180, gain: 10 });
    let r = complete(s, 'mech', insp, 0.9).s;
    const rep = r.orders.find((o) => o.kind === 'repair')!;
    r = apply(r, { t: 'approve', orderId: rep.id }, NOW).s;
    return { s: r, rep: r.orders.find((o) => o.id === rep.id)! };
  }

  it('the analyst approves the repair; finishing it spawns the redo (ready, already paid)', () => {
    const { s, rep } = withRepair();
    expect(rep.status).toBe('ready');
    const r = complete(s, 'mech', rep, 0.9).s;
    const redo = r.orders.find((o) => o.redo)!;
    expect(redo).toMatchObject({ role: 'mech', kind: 'prop', assetId: 'p1', title: 'Prop bolt re-torque (redo)', puzzle: 'torque', cost: 0, status: 'ready', tier: 2 });
    expect(redo.redo).toMatchObject({ week: 3, name: 'Ana', cost: 280 });
    expect(redo.gain).toBe(Math.round(12 * DEFECT.redoGain));
  });

  it('the redo is already paid and the trade owns it: a slip is never pinned on the analyst', () => {
    const { s, rep } = withRepair();
    const r = complete(s, 'mech', rep, 0.9).s;
    const redo = r.orders.find((o) => o.redo)!;
    expect(redo).toMatchObject({ approvedWeek: 4, autoApproved: true });
  });

  it('a redo never duplicates the same job already open on that asset: that one becomes the redo', () => {
    const { s, rep } = withRepair();
    const open = addOrder(s, { role: 'mech', kind: 'prop', puzzle: 'torque', assetId: 'p1', tier: 2, cost: 280, gain: 12, status: 'pending', title: 'Prop bolt re-torque' });
    const r = complete(s, 'mech', rep, 0.9).s;
    const props = r.orders.filter((o) => o.kind === 'prop' && o.assetId === 'p1' && o.status !== 'done');
    expect(props).toHaveLength(1);
    expect(props[0]).toMatchObject({ id: open.id, title: 'Prop bolt re-torque (redo)', cost: 0, status: 'ready', redo: { week: 3 } });
  });

  it('a botched redo leaves a defect again, and the chain continues', () => {
    const { s, rep } = withRepair();
    let r = complete(s, 'mech', rep, 0.95).s;
    const redo = r.orders.find((o) => o.redo)!;
    r = complete(r, 'mech', redo, 0).s;
    const d = r.defects!.find((x) => x.orderKind === 'prop')!;
    expect(d).toMatchObject({ title: 'Prop bolt re-torque (redo)', cost: 280, redo: true, severity: 2 });
  });

  it("a botched repair leaves its own defect (another repair, no second redo); the original's redo still comes", () => {
    const { s, rep } = withRepair();
    const r = complete(s, 'mech', rep, 0).s;
    expect(r.orders.some((o) => o.redo)).toBe(true);
    const d = r.defects!.find((x) => x.orderKind === 'repair')!;
    expect(d).toMatchObject({ puzzle: 'teardown', redo: false });
  });

  it('a load sheet is redone every week anyway: its repair has no redo', () => {
    const s = atWeek(4);
    plant(s, { orderKind: 'wb', puzzle: 'balance', title: 'Charter load sheet', cost: 0, gain: 0, redo: false, dueWeek: 4 });
    const r = resolve(s);
    const inc = lastReport(r).incidents.find((i) => i.kind === 'defect')!;
    expect(inc.cost).toBe(round10(DEFECT.minBase * DEFECT.incidentMult[0]));
    const rep = r.orders.find((o) => o.kind === 'repair')!;
    expect(rep.title).toBe('Hard-landing inspection of the gear');
    expect(rep.puzzle).toBe('crack');
  });
});

describe('cross-trade reports', () => {
  const saved = { ...REPORT };
  afterEach(() => Object.assign(REPORT, saved));

  it('from week 3 a report appears for the fixer: ready, small cost paid, never two for one fixer, at most two open', () => {
    REPORT.chance = 1;
    let s = started();
    s = resolve(s); // opens week 2: too early
    expect(s.orders.filter((o) => o.kind === 'report')).toHaveLength(0);
    s = resolve(s); // opens week 3
    const reps = s.orders.filter((o) => o.kind === 'report' && o.status === 'ready');
    expect(reps).toHaveLength(1);
    const o = reps[0];
    const def = REPORTS.find((r) => r.key === o.report!.key)!;
    expect(o).toMatchObject({ role: def.fixer, assetId: null, puzzle: def.puzzle, gain: 0, cost: def.cost });
    expect(o.report!.by).toBe(def.by);
    if (def.cost) expect(o.autoApproved).toBe(true);
    const names: Record<Role, string> = { mech: 'Ana', elec: 'Ben', fin: 'Cy' };
    expect(s.feed.some((f) => f.text === `${names[def.by]} reports: ${def.said}. ${names[def.fixer]}, it's yours.`)).toBe(true);
    // nobody fixes anything for a few weeks
    for (let i = 0; i < 4; i++) s = resolve(s);
    const open = s.orders.filter((x) => x.kind === 'report' && x.status !== 'done' && x.status !== 'cancelled');
    expect(open.length).toBeLessThanOrEqual(REPORT.maxOpen);
    expect(new Set(open.map((x) => x.role)).size).toBe(open.length);
  });

  it('a cap report holds the reporter to 2 jobs until the fixer fixes it', () => {
    let s = started();
    const rep = reportOrder(s, 'hangarLights');
    expect(reportCap(s, 'mech')!.text).toBe('Hangar lights out: 2 jobs max until Ben fixes them.');
    const jobs = [0, 1, 2].map(() => addOrder(s, { role: 'mech', kind: 'tires', puzzle: 'torque', assetId: 'p1', tier: 1, cost: 320, gain: 10 }));
    s = complete(s, 'mech', jobs[0], 0.9).s;
    s = complete(s, 'mech', jobs[1], 0.9).s;
    expect(complete(s, 'mech', jobs[2], 0.9).error).toBe('Hangar lights out: 2 jobs max until Ben fixes them.');
    s = complete(s, 'elec', rep, 0.95).s;
    expect(reportCap(s, 'mech')).toBeNull();
    expect(complete(s, 'mech', jobs[2], 0.9).error).toBeUndefined();
  });

  it("the analyst's cap is one desk task", () => {
    let s = started();
    reportOrder(s, 'officeOutlets');
    const tasks = s.orders.filter((o) => o.role === 'fin' && o.status === 'ready');
    expect(tasks.length).toBeGreaterThanOrEqual(2);
    s = complete(s, 'fin', tasks[0], 0.9).s;
    expect(complete(s, 'fin', tasks[1], 0.9).error).toMatch(/1 desk task max until Ben fixes it/);
  });

  it('a leak report costs cash every resolved week while open, with a review line', () => {
    // the analyst plays (ends the turn) but leaves the report: autopilot would patch it
    const finPlays = (x: IslandState) => apply(x, { t: 'endTurn', role: 'fin' }, NOW).s;
    const s = finPlays(started());
    const control = resolve(structuredClone(s));
    reportOrder(s, 'vendorPrice');
    const r = resolve(s);
    expect(control.cash - r.cash).toBe(240);
    expect(lastReport(r).costs.reports).toBe(240);
    expect(lastReport(r).lines.some((l) => /Parts vendor is billing list price, not our contract price: \$240 lost this week/.test(l.text))).toBe(true);
    // still open: it survives the carry-over (desk tasks don't) and charges again
    const again = resolve(finPlays(r));
    expect(again.orders.some((o) => o.kind === 'report' && o.status === 'ready')).toBe(true);
    expect(lastReport(again).costs.reports).toBe(240);
  });

  it("the analyst's autopilot patches a cap report at 50%, but a money leak waits for a person", () => {
    const s = started();
    const cap = reportOrder(s, 'creditHold');
    const r = resolve(s);
    expect(r.orders.find((o) => o.id === cap.id)!.result).toMatchObject({ auto: true, score: 0.5 });
    const reopened = r.orders.some((x) => x.kind === 'report' && x.status === 'ready' && x.report?.key === 'creditHold');
    expect(reopened || !!r.defects?.some((d) => d.report?.key === 'creditHold')).toBe(true);
    const t = started();
    const leak = reportOrder(t, 'utilityAutopay');
    const r2 = resolve(t);
    expect(r2.orders.find((o) => o.id === leak.id)!.status).toBe('ready');
    expect(lastReport(r2).costs.reports).toBe(200);
  });

  it('a leak fix that comes back also charges the weeks it only looked fixed', () => {
    let s = started();
    const rep = reportOrder(s, 'vendorPrice', { tier: 2 });
    s = complete(s, 'fin', rep, 0.2).s; // blind botch: it will come back
    const due = s.defects!.find((d) => d.report)!.dueWeek;
    let back: Order | undefined;
    let charged = 0;
    for (let i = 0; i < 4 && !back; i++) {
      s = resolve(s);
      charged += lastReport(s).costs.reports ?? 0;
      back = s.orders.find((o) => o.kind === 'report' && o.status === 'ready' && o.report?.again === 1);
    }
    expect(charged).toBe(0); // it looked fixed
    expect(back!.report!.owed).toBe(240 * (due - 1));
    expect(s.feed.some((f) => /still billing list price\. The correction from week 1 didn't stick\. It cost \$\d+ while it looked fixed/.test(f.text))).toBe(true);
    const next = resolve(apply(s, { t: 'endTurn', role: 'fin' }, NOW).s);
    expect(lastReport(next).costs.reports).toBe(240 + 240 * (due - 1));
    expect(lastReport(next).lines.some((l) => /for the weeks it only looked fixed/.test(l.text))).toBe(true);
  });

  it("the reporter can't lend a hand on their own report; the third trade can", () => {
    let s = started();
    const rep = reportOrder(s, 'hangarLights', { deferrals: 1 });
    expect(complete2(s, 'mech', rep, 0.9, true).error).toMatch(/your report: Ben has to fix this one/);
    s = complete2(s, 'fin', rep, 0.9, true).s;
    expect(s.orders.find((o) => o.id === rep.id)!.status).toBe('done');
  });

  it('comebacks count toward the open-report limit', () => {
    REPORT.chance = 1;
    const s = atWeek(5);
    reportOrder(s, 'hangarLights');
    plant(s, { orderKind: 'report', assetId: null, role: 'fin', report: { key: 'vendorPrice', by: 'mech', effect: 'leak', amount: 240 }, dueWeek: 9 });
    const r = resolve(s);
    expect(r.orders.filter((o) => o.kind === 'report' && o.status !== 'done' && o.status !== 'cancelled')).toHaveLength(1);
  });

  it('a blind botched fix comes back 1-2 weeks later; a teaching-tier botch stays open for rework', () => {
    let s = started();
    const rep = reportOrder(s, 'hangarLights', { tier: 2 });
    s = complete(s, 'elec', rep, 0.3).s;
    expect(s.orders.find((o) => o.id === rep.id)!.status).toBe('done');
    expect(reportCap(s, 'mech')).toBeNull();
    expect(s.defects!.find((d) => d.report)!.dueWeek).toBeLessThanOrEqual(1 + REPORT.againMax);
    let back: Order | undefined;
    for (let i = 0; i < 3 && !back; i++) {
      s = resolve(s);
      back = s.orders.find((o) => o.kind === 'report' && o.status === 'ready' && o.report?.again === 1);
    }
    expect(back).toMatchObject({ role: 'elec', title: 'Hangar work lights are dead (again)', report: { key: 'hangarLights', by: 'mech', effect: 'cap', again: 1 } });
    expect(s.defects!.some((d) => d.report)).toBe(false);
    expect(s.feed.some((f) => /Ana: the hangar work lights are out again\. The fix from week 1 didn't hold\. Ben, it's back on your list/.test(f.text))).toBe(true);

    const t = started();
    const t1 = reportOrder(t, 'hangarLights', { tier: 1 });
    const r = complete(t, 'elec', t1, 0.3).s;
    expect(r.orders.find((o) => o.id === t1.id)!.status).toBe('ready');
    // a clean fix holds
    const u = started();
    const ok = reportOrder(u, 'hangarLights', { tier: 2 });
    expect(complete(u, 'elec', ok, 0.95).s.defects ?? []).toHaveLength(0);
  });

  it("autopilot patches a missed fixer's report at 50%, and it comes back", () => {
    const s = started();
    const rep = reportOrder(s, 'trencher');
    const r = resolve(s); // nobody played: everyone on autopilot
    const o = r.orders.find((x) => x.id === rep.id)!;
    expect(o.status).toBe('done');
    expect(o.result!.auto).toBe(true);
    // it comes back: already reopened at this week's open, or due next week
    const reopened = r.orders.some((x) => x.kind === 'report' && x.status === 'ready' && x.report?.key === 'trencher' && x.report.again === 1);
    expect(reopened || !!r.defects?.some((d) => d.report?.key === 'trencher')).toBe(true);
  });

  it('the report table is data-driven and every trade both reports and fixes', () => {
    for (const role of ['mech', 'elec', 'fin'] as Role[]) {
      expect(REPORTS.some((r) => r.by === role)).toBe(true);
      expect(REPORTS.some((r) => r.fixer === role)).toBe(true);
    }
    for (const r of REPORTS) {
      expect(r.by).not.toBe(r.fixer);
      expect(r.cost).toBeLessThanOrEqual(150);
      if (r.effect === 'leak') expect(r.amount).toBeGreaterThan(0);
    }
  });
});

describe('paper sim with consequences', () => {
  it('bots handle reports, repairs and redos; state stays small; runs are deterministic', () => {
    let reports = 0;
    let repairs = 0;
    let redos = 0;
    let maxBytes = 0;
    const { final } = simulate(TEAMS['three friends'], 26, 4, (s) => {
      reports += s.orders.filter((o) => o.kind === 'report' && o.createdWeek === s.week - 1).length;
      repairs += s.orders.filter((o) => o.kind === 'repair' && o.result?.week === s.week - 1).length;
      redos += s.orders.filter((o) => o.redo && o.result?.week === s.week - 1).length;
      maxBytes = Math.max(maxBytes, JSON.stringify(s).length);
    });
    expect(reports + repairs + redos).toBeGreaterThan(0);
    expect(maxBytes).toBeLessThan(300_000); // one Firestore document is capped at ~1 MB
    expect((final.defects ?? []).length).toBeLessThan(10);
    const again = simulate(TEAMS['three friends'], 26, 4).final;
    expect(JSON.stringify(again)).toBe(JSON.stringify(final));
  });

  it('three friends keep cash positive every week and get to the late game (tier 4+, tier 5 on most seeds)', () => {
    const tiers: number[] = [];
    for (const seed of [1, 2, 3, 4, 5]) {
      const { final, minCash } = simulate(TEAMS['three friends'], 26, seed);
      expect(minCash, `seed ${seed}`).toBeGreaterThanOrEqual(0);
      expect(final.tier, `seed ${seed}`).toBeGreaterThanOrEqual(4);
      tiers.push(final.tier);
    }
    expect(tiers.filter((t) => t === 5).length).toBeGreaterThanOrEqual(3);
  });
});
