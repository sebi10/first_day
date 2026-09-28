// The job flow's circuit check on a plane (docs/JOBFLOW.md 5.4): a bench
// symptom (com dead, alternator or starter-generator off) is the unit or its
// wiring. The electrician meters it. A wrong "it's the unit" call on a wiring
// fault shows at the install (the new unit makes no difference, the check runs
// again): nothing hidden is planted, and once the wiring is fixed and the plane
// is signed back into service nothing comes back. The same with the electrician
// away (autopilot calls the unit first). And wiring faults really do occur in
// play: the generator raises them, and the paper-sim crews meet them.
import { describe, expect, it, vi } from 'vitest';
import { raiseAlert, SYMPTOMS } from '../src/sim/alerts';
import { simulate, TEAMS } from '../src/sim/bots';
import { apply, createIsland } from '../src/sim/engine';
import { fixTaskFor, planTask, stdPickFor } from '../src/sim/flow';
import { addStarter } from '../src/sim/stock';
import { ROLES, type Action, type Alert, type Asset, type IslandState, type Order, type Role } from '../src/sim/types';

vi.setConfig({ testTimeout: 30000 });

const NOW = Date.UTC(2026, 8, 26, 10);
const CARGO: Asset = { id: 'p2', kind: 'plane', model: 'cargo', name: 'Cargo C-7', health: 70, touchedWeek: 5, sinceInspection: 0 };

function island(seed = 42): IslandState {
  let s = createIsland({ id: `fb${seed}`, name: 'Bench Flow Isle', now: NOW, tz: 'Europe/Paris', seed, creator: { uid: 'a', name: 'Ana', role: 'mech' } });
  s = apply(s, { t: 'join', uid: 'b', name: 'Ben', role: 'elec' }, NOW).s;
  s = apply(s, { t: 'join', uid: 'c', name: 'Cy', role: 'fin' }, NOW).s;
  for (const r of ROLES) s = apply(s, { t: 'week0Done', role: r }, NOW).s;
  s.week = 5;
  s.tier = 2;
  s.cash = 20000;
  s.assets.push({ ...CARGO });
  addStarter(s, 2);
  s.orders = [];
  s.alerts = [];
  return s;
}

let clock = NOW;
function ok(s: IslandState, a: Action): IslandState {
  const r = apply(s, a, ++clock);
  expect(r.error, JSON.stringify(a)).toBeUndefined();
  return r.s;
}
const alertOf = (s: IslandState, id: string) => s.alerts!.find((a) => a.id === id)!;
const orderOf = (s: IslandState, id: string) => s.orders.find((o) => o.id === id)!;
/** the bench order open on an alert */
const benchOf = (s: IslandState, al: Alert) => s.orders.find((o) => o.bench === al.id && o.status === 'ready');

/** the week resolves with these seats played (the rest on autopilot); only this alert stays on the island */
function resolve(s: IslandState, played: Role[], keep: string): IslandState {
  const week = s.week;
  for (const r of played) if (!s.turns[r]?.ended) s = ok(s, { t: 'endTurn', role: r, week });
  if (s.week === week) s = apply(s, { t: 'resolve', week }, s.deadline! + 1).s;
  expect(s.week).toBe(week + 1);
  // the week's new alerts go: this test follows one fault
  s.alerts = s.alerts!.filter((a) => a.id === keep);
  return s;
}

/** the radio P/N the cargo plane takes (a unit cause's right pick) */
function radioPick(s: IslandState) {
  const unit = raiseAlert(s, { role: 'mech', asset: s.assets.find((a) => a.id === 'p2')!, sym: 'M_COM_DEAD', cause: 0 }, clock);
  const task = fixTaskFor(s, unit)!;
  const pick = stdPickFor(s, unit, task);
  s.alerts = s.alerts!.filter((a) => a.id !== unit.id);
  expect(pick.some((l) => l.slot === 'radio')).toBe(true);
  return { task: task.id, pick };
}

/** avionics work runs the bus off a cart: a charged cart hooked up to the cargo plane */
function hookCart(s: IslandState): IslandState {
  const cart = s.gse?.find((c) => c.id === 'gpu1');
  expect(cart).toBeTruthy();
  cart!.charge = 100;
  if (cart!.hookedTo === 'p2') return s;
  return ok(s, { t: 'gse', role: 'mech', cart: 'gpu1', op: 'hook', assetId: 'p2', week: s.week });
}

/** the mechanic plans the radio swap on the alert (the unit, as the check said), and it is approved and started */
function swapRadio(s: IslandState, al: Alert): { s: IslandState; o: Order } {
  const { task, pick } = radioPick(s);
  expect(planTask(s, al, task)).toBeTruthy();
  for (const l of pick) s.inv![l.item] = { ...(s.inv![l.item] ?? { on: 0 }), on: Math.max(s.inv![l.item]?.on ?? 0, l.qty) };
  s = ok(s, { t: 'plan', role: 'mech', alert: al.id, task, pick, week: s.week });
  let o = s.orders.find((x) => x.flow?.alert === al.id && x.status !== 'cancelled')!;
  if (o.status === 'pending') s = ok(s, { t: 'approve', orderId: o.id, week: s.week });
  o = orderOf(s, o.id);
  expect(o.status).toBe('ready');
  return { s, o };
}

/** nothing comes back for this alert: no hidden defect from the check, no repair alert, no incident naming the check */
function nothingComesBack(s: IslandState) {
  expect((s.defects ?? []).filter((d) => d.puzzle === 'meter' || d.orderKind === 'bench')).toEqual([]);
  expect((s.alerts ?? []).some((a) => a.repair && a.assetId === 'p2')).toBe(false);
  for (const h of s.history) {
    expect(h.incidents.some((i) => /circuit check|wrong spot/i.test(JSON.stringify(i)))).toBe(false);
    expect(h.lines.some((l) => /circuit check fixed the wrong spot|Traced to .*circuit check/.test(l.text))).toBe(false);
  }
}

describe("the job flow's circuit check on a wiring fault (5.4)", () => {
  it("called 'the unit' by the electrician: the install stops, the second check fixes the wiring, the plane goes back into service, and nothing comes back", () => {
    let s = island();
    const com = raiseAlert(s, { role: 'mech', asset: s.assets.find((a) => a.id === 'p2')!, sym: 'M_COM_DEAD', cause: 1 }, clock);
    expect(com.kind).toBe('wiring');
    s = ok(s, { t: 'askBench', role: 'mech', alert: com.id, week: 5 });
    const b1 = benchOf(s, com)!;
    s = ok(s, { t: 'complete', role: 'elec', orderId: b1.id, score: 0.9, perfect: false, data: { chain: { call: 'unit' } }, week: 5 });
    expect(alertOf(s, com.id).bench).toMatchObject({ call: 'unit', by: 'Ben' });
    // the wrong call plants nothing: the install is where it shows
    expect(s.defects ?? []).toEqual([]);
    const r = swapRadio(s, alertOf(s, com.id));
    s = ok(hookCart(r.s), { t: 'complete', role: 'mech', orderId: r.o.id, score: 0.9, perfect: false, week: 5 });
    expect(orderOf(s, r.o.id)).toMatchObject({ status: 'waiting_part' });
    expect(orderOf(s, r.o.id).flow!.stop).toMatch(/^Still no output with the new unit: waiting on Ben's circuit check$/);
    expect(alertOf(s, com.id).bench).toMatchObject({ again: true });
    // the second check: it's the wiring, fixed at the airplane; the job becomes the return to service
    const b2 = benchOf(s, com)!;
    expect(b2.title).toMatch(/ again$/);
    s = ok(s, { t: 'complete', role: 'elec', orderId: b2.id, score: 0.9, perfect: false, data: { chain: { call: 'wiring', fixed: true } }, week: 5 });
    const job = orderOf(s, r.o.id);
    expect(job).toMatchObject({ status: 'ready' });
    expect(job.flow!.wired).toBe(true);
    expect(job.title).toMatch(/^Finish .+: the fault was in the wiring/);
    s = ok(hookCart(s), { t: 'complete', role: 'mech', orderId: job.id, score: 0.9, perfect: false, week: 5 });
    expect(alertOf(s, com.id).status).toBe('closed');
    nothingComesBack(s);
    for (let i = 0; i < 4; i++) {
      s = resolve(s, ['mech', 'elec', 'fin'], com.id);
      nothingComesBack(s);
    }
  });

  it("the electrician away: autopilot calls the unit, the install stops, autopilot's second check finds the wiring, and nothing comes back", () => {
    let s = island();
    const com = raiseAlert(s, { role: 'mech', asset: s.assets.find((a) => a.id === 'p2')!, sym: 'M_COM_DEAD', cause: 1 }, clock);
    s = ok(s, { t: 'askBench', role: 'mech', alert: com.id, week: 5 });
    // week 5: the electrician's seat is empty; autopilot meters it at the resolve and calls the unit
    s = resolve(s, ['mech', 'fin'], com.id);
    expect(alertOf(s, com.id).bench).toMatchObject({ call: 'unit' });
    expect(s.defects ?? []).toEqual([]);
    // week 6: the mechanic swaps the radio; the ground run shows no difference; the check opens again
    const r = swapRadio(s, alertOf(s, com.id));
    s = ok(hookCart(r.s), { t: 'complete', role: 'mech', orderId: r.o.id, score: 0.9, perfect: false, week: r.s.week });
    expect(orderOf(s, r.o.id).status).toBe('waiting_part');
    expect(benchOf(s, com)).toBeTruthy();
    s = resolve(s, ['mech', 'fin'], com.id);
    // autopilot's second check: the wiring, fixed; the return-to-service job is ready
    const job = orderOf(s, r.o.id);
    expect(job).toMatchObject({ status: 'ready' });
    expect(job.flow!.wired).toBe(true);
    s = ok(hookCart(s), { t: 'complete', role: 'mech', orderId: job.id, score: 0.9, perfect: false, week: s.week });
    expect(alertOf(s, com.id).status).toBe('closed');
    nothingComesBack(s);
    for (let i = 0; i < 4; i++) {
      s = resolve(s, ['mech', 'fin'], com.id);
      nothingComesBack(s);
    }
  });

  it("the mechanic away: autopilot placards the item (MEL C) while the electrician's check is pending, so the plane keeps flying", () => {
    let s = island();
    const com = raiseAlert(s, { role: 'mech', asset: s.assets.find((a) => a.id === 'p1')!, sym: 'M_COM_DEAD', cause: 1, due: 5 }, clock);
    s = resolve(s, ['elec', 'fin'], com.id);
    const al = alertOf(s, com.id);
    expect(al.bench?.order).toBeTruthy();
    expect(al.mel).toMatchObject({ until: 5 });
    expect(al.mel!.by).toMatch(/^Autopilot/);
  });

  it("called 'the wiring' on a dead unit: the dead unit goes back into service (a sure hidden defect)", () => {
    let s = island();
    const com = raiseAlert(s, { role: 'mech', asset: s.assets.find((a) => a.id === 'p2')!, sym: 'M_COM_DEAD', cause: 0 }, clock);
    s = ok(s, { t: 'askBench', role: 'mech', alert: com.id, week: 5 });
    s = ok(s, { t: 'complete', role: 'elec', orderId: benchOf(s, com)!.id, score: 0.9, perfect: false, data: { chain: { call: 'wiring', fixed: false, where: 'Harness splice' } }, week: 5 });
    expect((s.defects ?? []).filter((d) => d.puzzle === 'meter')).toHaveLength(1);
  });
});

describe('wiring faults in play', () => {
  it('the paper-sim crews meet wiring faults on the bench symptoms (the generator raises them)', () => {
    let wiring = 0;
    let bench = 0;
    const seen = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      simulate(TEAMS['three friends'], 26, seed, (s) => {
        for (const a of s.alerts ?? []) {
          const key = `${seed}:${a.id}`;
          if (seen.has(key) || !SYMPTOMS[a.sym]?.bench) continue;
          seen.add(key);
          bench++;
          if (a.kind === 'wiring') wiring++;
        }
      });
    }
    expect(bench).toBeGreaterThan(12);
    expect(wiring).toBeGreaterThan(1);
    // about the spec's shares (3 in 10, 1 in 5, 1 in 4): well inside 5-50% over a small sample
    expect(wiring / bench).toBeGreaterThan(0.05);
    expect(wiring / bench).toBeLessThan(0.5);
  });
});
