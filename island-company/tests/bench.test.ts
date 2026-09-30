// The electrician's move in the part chain: on an electrical unit (the com radio,
// the alternator or the starter-generator) the circuit is metered at the airplane
// before a unit is bought. The unit, or its wiring? A wrong call shows later: a
// good unit bought (the new one makes no difference at the install), a dead one
// left in service, or a break still in the wiring.
import { describe, expect, it } from 'vitest';
import { benchCall, generateMeter, itemHealthy } from '../src/puzzles/meter';
import { chainMove, chainSteps, plantFor, restockFee, rightPn, islandAircraft } from '../src/sim/chain';
import { CHAIN, ECON, defectRule } from '../src/sim/data';
import { apply, chainWouldOpen, createIsland } from '../src/sim/engine';
import { hashSeed } from '../src/sim/rng';
import { ROLES, type Asset, type IslandState, type Order } from '../src/sim/types';
import { crossMoves, launchFor } from '../src/ui/select';

const NOW = Date.UTC(2026, 8, 26, 10);
const CARGO: Asset = { id: 'p2', kind: 'plane', model: 'cargo', name: 'Cargo C-7', health: 70, touchedWeek: 5, sinceInspection: 0 };
/** an island whose cargo plane carries no alteration (its radio and starter-generator are the IPC's) */
const CLEAN = Array.from({ length: 400 }, (_, i) => i + 1).find((seed) => !plantFor(seed, 'p2', 'cargo').plant)!;

function island(seed = CLEAN): IslandState {
  let s = createIsland({ id: `b${seed}`, name: 'Bench Isle', now: NOW, tz: 'Europe/Paris', seed, creator: { uid: 'a', name: 'Ana', role: 'mech' } });
  s = apply(s, { t: 'join', uid: 'b', name: 'Ben', role: 'elec' }, NOW).s;
  s = apply(s, { t: 'join', uid: 'c', name: 'Cy', role: 'fin' }, NOW).s;
  for (const r of ROLES) s = apply(s, { t: 'week0Done', role: r }, NOW).s;
  s.week = 5;
  s.tier = 2;
  s.cash = 20000;
  s.assets.push({ ...CARGO });
  s.orders = [];
  return s;
}

let seq = 0;
/** a chain opened by a job on the cargo plane (the radio: 'avionics', the starter-generator: 'alternator'), with this fault behind it */
function opened(kind: 'avionics' | 'alternator', fault: 'unit' | 'wiring') {
  for (let tries = 0; tries < 400; tries++) {
    const s = island();
    const o: Order = {
      id: `j${++seq}`,
      role: 'mech',
      kind,
      assetId: 'p2',
      title: kind === 'avionics' ? 'Swap the com radio' : 'Replace the starter-generator brushes',
      puzzle: 'torque',
      tier: 2,
      cost: 640,
      parts: 0,
      gain: 10,
      createdWeek: s.week,
      deferrals: 0,
      lastDeferredWeek: null,
      status: 'ready',
      seed: hashSeed('bench-find', seq, tries),
    };
    s.orders.push(o);
    if (!chainWouldOpen(s, o, 'mech')) continue;
    // avionics work runs the bus off a cart: hook the island's cart up to the plane first
    const hooked = kind === 'avionics' ? apply(s, { t: 'gse', role: 'mech', cart: 'gpu1', op: 'hook', assetId: 'p2' }, NOW).s : s;
    const r = apply(hooked, { t: 'complete', role: 'mech', orderId: o.id, score: 0.9, perfect: false, week: hooked.week }, NOW);
    expect(r.error).toBeUndefined();
    if (r.s.chain?.bench?.fault === fault) return { s: r.s, job: o.id };
  }
  throw new Error('no seed gives that fault');
}

const done = (s: IslandState, role: 'mech' | 'elec', id: string, data?: Record<string, unknown>, score = 0.9) => {
  const r = apply(s, { t: 'complete', role, orderId: id, score, perfect: false, data, week: s.week }, NOW);
  expect(r.error).toBeUndefined();
  return r.s;
};
const approve = (s: IslandState, id: string, ship?: 'boat' | 'flight') => {
  const r = apply(s, { t: 'approve', orderId: id, week: s.week, ...(ship ? { ship } : {}) }, NOW);
  expect(r.error).toBeUndefined();
  return r.s;
};
const endAll = (s: IslandState) => {
  let x = s;
  for (const r of ROLES) x = apply(x, { t: 'endTurn', role: r, week: x.week }, NOW).s;
  expect(x.week).toBe(s.week + 1);
  return x;
};
const stepOrder = (s: IslandState) => s.orders.find((o) => o.id === s.chain!.stepId)!;
const benchOrder = (s: IslandState) => s.orders.find((o) => o.id === s.chain!.bench!.id)!;
const lookup = (s: IslandState) => {
  const ac = islandAircraft(s.seed, CARGO);
  return done(s, 'mech', stepOrder(s).id, { chain: { outcome: 'pn', pn: rightPn(ac, s.chain!.ata as '23-10', s.chain!.tag) } });
};

describe("the electrician's check on an electrical unit", () => {
  it('opens beside the IPC lookup: a meter job on that plane, in the stepper and in whose-move', () => {
    const { s } = opened('avionics', 'unit');
    const c = s.chain!;
    expect(c.tag).toBe('radio');
    const b = benchOrder(s);
    expect(b).toMatchObject({ role: 'elec', kind: 'bench', puzzle: 'meter', job: 'comPower', status: 'ready', cost: 0, gain: 0, chain: { id: c.id, step: 'bench' } });
    expect(b.title).toMatch(/Meter the com radio's power and ground on Cargo C-7/);
    // the lookup is still the mechanic's: two moves at once, one per seat
    expect(stepOrder(s)).toMatchObject({ role: 'mech', status: 'ready', chain: { step: 'lookup' } });
    expect(chainSteps(c).map((x) => x.label)).toEqual(['Found', 'IPC', 'Check', 'Buy', 'Delivery', 'Install']);
    const moves = crossMoves(s).filter((m) => m.kind === 'chain');
    expect(moves.map((m) => [m.who, m.waits])).toEqual([
      ['mech', 'fin'],
      ['elec', 'mech'],
    ]);
    // the meter gets the plane's circuit, and the fault the chain rolled
    const l = launchFor(s, b, 'elec');
    expect(l.context?.job).toBe('comPower');
    expect(l.context?.bench).toEqual({ fault: 'unit' });
    // the starter-generator's is its field circuit
    expect(benchOrder(opened('alternator', 'wiring').s).job).toBe('sgField');
  });

  it("the unit, called right: the part waits for the call, then the analyst's card comes", () => {
    let { s } = opened('alternator', 'unit');
    s = lookup(s);
    // the lookup is in, but nothing is bought until the electrician says the unit is really bad
    expect(s.chain!.step).toBe('check');
    expect(s.orders.some((o) => o.chain?.step === 'buy')).toBe(false);
    expect(chainMove(s, s.chain!)).toMatchObject({ who: 'elec' });
    s = done(s, 'elec', benchOrder(s).id, { chain: { call: 'unit', fixed: true } });
    expect(s.chain!.bench).toMatchObject({ call: 'unit', by: 'Ben', week: 5 });
    expect(s.chain!.step).toBe('buy');
    expect(stepOrder(s)).toMatchObject({ role: 'mech', kind: 'part', status: 'pending' });
    expect(s.feed.some((f) => /Ben metered the starter-generator circuit on Cargo C-7: the wiring checks good/.test(f.text))).toBe(true);
  });

  it('the wiring, called and fixed: no part, the lookup is dropped, the mechanic finishes the job and the plane flies', () => {
    let { s, job } = opened('avionics', 'wiring');
    const cash = s.cash;
    s = done(s, 'elec', benchOrder(s).id, { chain: { call: 'wiring', fixed: true, where: 'Radio circuit breaker' } });
    expect(s.chain).toMatchObject({ wired: true, step: 'install' });
    expect(s.orders.filter((o) => o.chain?.step === 'lookup').every((o) => o.status === 'cancelled')).toBe(true);
    const j = s.orders.find((o) => o.id === job)!;
    expect(j.status).toBe('ready');
    expect(j.title).toMatch(/^Finish Swap the com radio: the fault was in the wiring/);
    expect(chainSteps(s.chain!).map((x) => x.label)).toEqual(['Found', 'IPC', 'Check', 'Finish']);
    s = done(s, 'mech', job);
    expect(s.chain!.step).toBe('done');
    expect(s.chain!.story).toMatch(/no part needed, Ben's check found the fault in the wiring/);
    // nothing bought, nothing hidden
    expect(s.cash).toBe(cash);
    expect((s.defects ?? []).filter((d) => d.orderKind === 'bench')).toEqual([]);
  });

  it('a good unit bought (called the unit, the fault is the wiring): no difference at the install, a credit, and the electrician meters again', () => {
    let { s, job } = opened('alternator', 'wiring');
    s = done(s, 'elec', benchOrder(s).id, { chain: { call: 'unit', fixed: false } });
    s = lookup(s);
    const buy = stepOrder(s);
    const price = buy.cost;
    s = approve(s, buy.id);
    s = endAll(s);
    expect(s.chain!.step).toBe('install');
    const cash = s.cash;
    const spent = s.chain!.spent;
    s = done(s, 'mech', job);
    // the ground run shows no output still: the part goes back (price less restocking), the job waits on a second check
    const fee = restockFee(price);
    expect(s.cash).toBe(cash + price - fee);
    expect(s.chain).toMatchObject({ step: 'check', returns: 1, spent: spent - (price - fee), bench: { again: true } });
    expect(s.orders.find((o) => o.id === job)!.status).toBe('waiting_part');
    expect(s.feed.at(-1)!.text).toMatch(new RegExp(`goes back: \\$${(price - fee).toLocaleString('en-US')} credited \\(\\$${fee} restocking\\)\\. Ben, meter the circuit again`));
    const again = benchOrder(s);
    expect(again).toMatchObject({ role: 'elec', status: 'ready' });
    expect(again.title).toMatch(/ again$/);
    // with the unit ruled out it is the wiring, whatever the second check says
    expect(launchFor(s, again, 'elec').context?.bench).toEqual({ fault: 'wiring' });
    s = done(s, 'elec', again.id, { chain: { call: 'wiring', fixed: true } });
    expect(s.chain).toMatchObject({ wired: true, step: 'install' });
    s = done(s, 'mech', job);
    expect(s.chain!.step).toBe('done');
    expect(s.chain!.story).toMatch(/after a new starter-generator made no difference and went back/);
    expect((s.defects ?? []).filter((d) => d.orderKind === 'bench')).toEqual([]);
  });

  it('a dead unit left in service (called the wiring): a sure hidden defect, and the airplane trade replaces the unit', () => {
    let { s, job } = opened('avionics', 'unit');
    s = done(s, 'elec', benchOrder(s).id, { chain: { call: 'wiring', fixed: false, where: 'Radio circuit breaker' } });
    s = done(s, 'mech', job);
    expect(s.chain!.step).toBe('done');
    const d = (s.defects ?? []).find((x) => x.orderKind === 'bench')!;
    expect(d).toMatchObject({ puzzle: 'meter', variant: 'radio', role: 'mech', by: 'elec', job: 'avionics', assetId: 'p2' });
    expect(defectRule(d.puzzle, d.role, d.orderKind, d.variant).fix).toMatchObject({ puzzle: 'teardown', title: 'Replace the dead com radio' });
    expect(d.dueWeek).toBeGreaterThan(s.week);
  });

  it('the break still in the wiring (the check fixed the wrong spot): it comes back in service, and the A&P splices the wire', () => {
    let { s, job } = opened('alternator', 'wiring');
    s = done(s, 'elec', benchOrder(s).id, { chain: { call: 'wiring', fixed: false, where: 'Field terminal' } });
    s = done(s, 'mech', job);
    const d = (s.defects ?? []).find((x) => x.orderKind === 'bench')!;
    expect(d).toMatchObject({ variant: 'wiring', role: 'mech', by: 'elec', job: 'alternator' });
    const rule = defectRule(d.puzzle, d.role, d.orderKind, d.variant);
    expect(rule.found).toMatch(/the circuit check fixed the wrong spot/);
    expect(rule.fix).toMatchObject({ puzzle: 'teardown' });
    expect(rule.fix.title).toMatch(/AC 43\.13-1B/);
  });

  it("autopilot covers an empty electrician's seat by the symptom (the unit): the plane never waits on it", () => {
    let { s } = opened('alternator', 'wiring');
    s = lookup(s);
    expect(s.chain!.step).toBe('check');
    // everyone ends the turn but the electrician, who never played: the week resolves, autopilot calls the unit
    for (const r of ['mech', 'fin'] as const) s = apply(s, { t: 'endTurn', role: r, week: s.week }, NOW).s;
    s = apply(s, { t: 'resolve', week: s.week }, s.deadline! + 1).s;
    expect(s.chain!.bench).toMatchObject({ call: 'unit' });
    expect(s.chain!.bench!.by).toMatch(/^Autopilot/);
    // the card came in after the analyst had ended the turn: it went through on the standing AOG approval, and the boat brought it
    expect(s.chain!.step).toBe('install');
    expect(s.history.at(-1)!.lines.some((l) => /had ended the turn when the part for Cargo C-7 came in: it went through on the standing AOG approval/.test(l.text))).toBe(true);
  });
});

describe('the meter on an airplane circuit (28 V DC)', () => {
  it("reads the unit's own supply at the airplane: the fault is the unit, or a break on the way to it", () => {
    for (let seed = 1; seed <= 40; seed++) {
      for (const job of ['comPower', 'altField', 'sgField']) {
        const unit = generateMeter(seed, 2, [], job, { fault: 'unit' });
        const last = unit.items.length - 1;
        expect(unit.items[last].kind).toBe('unit');
        expect(unit.fault).toMatchObject({ kind: 'unit', at: last });
        // everything up to the unit has its supply: the unit itself is what's dead
        for (let i = 0; i < last; i++) expect(itemHealthy(unit, i)).toBe(true);
        expect(benchCall(unit, [{ item: last, cond: 'H' }])).toEqual({ call: 'unit', fixed: true });
        const wiring = generateMeter(seed, 2, [], job, { fault: 'wiring' });
        expect(wiring.fault.at).toBeGreaterThan(0);
        expect(wiring.fault.at).toBeLessThan(wiring.items.length - 1);
        expect(itemHealthy(wiring, wiring.items.length - 1)).toBe(false);
        const at = wiring.fault.at;
        expect(benchCall(wiring, [{ item: at, cond: 'H' }])).toMatchObject({ call: 'wiring', fixed: true, where: wiring.items[at].name });
        // called at the unit: a good unit gets bought
        expect(benchCall(wiring, [{ item: wiring.items.length - 1, cond: 'H' }])).toEqual({ call: 'unit', fixed: false });
        // called at a spot that isn't the break: the wrong spot gets fixed
        const other = at === 1 ? 2 : 1;
        if (other < wiring.items.length - 1) expect(benchCall(wiring, [{ item: other, cond: 'H' }])).toMatchObject({ call: 'wiring', fixed: false });
      }
    }
  });

  it('is tuned in one place', () => {
    expect(CHAIN.wiringShare).toBeGreaterThan(0.15);
    expect(CHAIN.wiringShare).toBeLessThan(0.5);
    expect(ECON.boatKit).toBeGreaterThan(0);
  });
});
