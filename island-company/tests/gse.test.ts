// Ground power carts: the mechanic charges them, hooks them up for a start and
// inspects their cables. Wear stays hidden until an inspection (or until it is
// too far gone to miss), and a start through pitted pins surfaces later as an
// incident, never as a verdict at sign-off.
import { describe, expect, it, vi } from 'vitest';
import { cartOut, crankPower, flip, generateGpu, newSim, plugIn, pushPlug, setCart as cartSwitch, setCartVolts, step as gpuStep } from '../src/puzzles/gpu';
import { generateHydraulics } from '../src/puzzles/hydraulics';
import { generateMeter } from '../src/puzzles/meter';
import { generateVariance } from '../src/puzzles/variance';
import { generateWireup } from '../src/puzzles/wireup';
import { simulate, TEAMS } from '../src/sim/bots';
import { CABLE_BAND, CABLE_REPORT, DEFECT_RULES, GSE, REPORTS, REPORT_BY_KEY, incidentText } from '../src/sim/data';
import { cableBand, cableReport, gseCarts, gseForStart } from '../src/sim/econ';
import { apply, createIsland } from '../src/sim/engine';
import { repairTask } from '../src/sim/flow';
import { hashSeed } from '../src/sim/rng';
import type { GseCart, IslandState, Order, Role } from '../src/sim/types';

// whole seasons of the paper sim: give a loaded CI box room (see tests/ipc.test.ts)
vi.setConfig({ testTimeout: 30000 });

const NOW = Date.UTC(2026, 8, 26, 10);

function started(): IslandState {
  let s = createIsland({ id: 'gse', name: 'Ground Power Isle', now: NOW, tz: 'Europe/Paris', seed: 11, creator: { uid: 'a', name: 'Ana', role: 'mech' } });
  s = apply(s, { t: 'join', uid: 'b', name: 'Ben', role: 'elec' }, NOW).s;
  s = apply(s, { t: 'join', uid: 'c', name: 'Cy', role: 'fin' }, NOW).s;
  for (const r of ['mech', 'elec', 'fin'] as Role[]) s = apply(s, { t: 'week0Done', role: r }, NOW).s;
  return s;
}

/** a started island at week `w` with the cargo plane (the turbine single); `float`: the amphibian too (a piston single) */
function withCargo(w = 4, float = false): IslandState {
  const s = started();
  s.week = w;
  s.assets.push({ id: 'p2', kind: 'plane', model: 'cargo', name: 'Cargo C-7', health: 80, touchedWeek: 0, sinceInspection: 2 });
  if (float) s.assets.push({ id: 'p3', kind: 'plane', model: 'float', name: 'Float F-3', health: 80, touchedWeek: 0, sinceInspection: 2 });
  return s;
}

let seq = 0;
function addOrder(s: IslandState, f: Partial<Order> & Pick<Order, 'role' | 'kind' | 'puzzle'>): Order {
  seq++;
  const o: Order = {
    id: `g${seq}`,
    assetId: null,
    title: f.kind,
    tier: 2,
    cost: 0,
    parts: 0,
    gain: 0,
    createdWeek: s.week,
    deferrals: 0,
    lastDeferredWeek: null,
    status: 'ready',
    seed: hashSeed('gse-order', seq),
    ...f,
  };
  s.orders.push(o);
  return o;
}
const startJob = (s: IslandState, tier = 2, assetId = 'p2') =>
  addOrder(s, { role: 'mech', kind: 'gpustart', puzzle: 'gpu', assetId, tier, cost: 120, gain: 8, title: 'Ground power start: weak battery' });

const gse = (s: IslandState, op: 'charge' | 'unplug' | 'hook' | 'unhook' | 'inspect', cart = 'gpu1', assetId?: string, role: Role = 'mech', call?: 'ok' | 'tag') =>
  apply(s, { t: 'gse', role, cart, op, ...(assetId ? { assetId } : {}), ...(call ? { call } : {}) }, NOW);
const complete = (s: IslandState, role: Role, o: Order, score: number, data?: Record<string, unknown>) =>
  apply(s, { t: 'complete', role, orderId: o.id, score, perfect: score >= 0.95, data }, NOW);
const resolve = (s: IslandState) => apply(s, { t: 'resolve', week: s.week }, s.deadline! + 1).s;
const cart = (s: IslandState, id = 'gpu1') => gseCarts(s).find((c) => c.id === id)!;
const setCart = (s: IslandState, id: string, patch: Partial<GseCart>) => {
  s.gse = gseCarts(s).map((c) => (c.id === id ? { ...c, ...patch } : c));
  return s;
};

describe('ground power carts: state', () => {
  it('a new island has one cart: full, on the charger, some wear on its second-hand cable', () => {
    const s = started();
    expect(s.gse).toEqual([{ id: 'gpu1', name: 'GPU cart 1', charge: 100, wear: GSE.startWear, hookedTo: null, charging: true, inspected: null }]);
  });

  it('an island saved before carts existed loads with the default, plays, and stores it on the next resolve', () => {
    const old = started();
    delete old.gse;
    const json = JSON.parse(JSON.stringify(old)) as IslandState;
    expect(json.gse).toBeUndefined();
    expect(gseCarts(json)).toHaveLength(1);
    expect(cart(json)).toMatchObject({ charge: 100, charging: true, hookedTo: null });
    // ordinary moves don't touch it
    const t = json.orders.find((o) => o.role === 'fin' && o.status === 'ready')!;
    const r1 = complete(json, 'fin', t, 0.9);
    expect(r1.error).toBeUndefined();
    expect(r1.s.gse).toBeUndefined();
    // a resolve writes the default in
    const r2 = resolve(r1.s);
    expect(r2.gse).toHaveLength(1);
    // an old tier-3 island gets both carts
    const t3 = { ...json, tier: 3 };
    expect(gseCarts(t3).map((c) => c.id)).toEqual(['gpu1', 'gpu2']);
  });

  it('the second cart arrives with tier 3', () => {
    let s = started();
    s.project = { tier: 3, title: 'Village', orders: {} };
    for (const role of ['mech', 'elec', 'fin'] as Role[]) {
      const o = addOrder(s, { role, kind: 'project', puzzle: 'torque', tier: 3 });
      s.project.orders[role] = o.id;
    }
    s.tier = 2;
    for (const role of ['mech', 'elec', 'fin'] as Role[]) s = complete(s, role, s.orders.find((o) => o.id === s.project!.orders[role])!, 0.9).s;
    expect(s.tier).toBe(3);
    expect(s.gse!.map((c) => c.id)).toEqual(['gpu1', 'gpu2']);
    expect(s.feed.some((f) => f.text === 'GPU cart 2 arrived for the hangar: on the charger, full.')).toBe(true);
  });
});

describe('ground power carts: the mechanic moves them', () => {
  it('only the mechanic; on the charger or hooked to a plane, never both; one cart per plane', () => {
    let s = withCargo();
    expect(gse(s, 'hook', 'gpu1', 'p2', 'elec').error).toMatch(/mechanic/);
    s = gse(s, 'hook', 'gpu1', 'p2').s;
    expect(cart(s)).toMatchObject({ hookedTo: 'p2', charging: false });
    expect(s.feed.at(-1)!.text).toBe('Ana towed GPU cart 1 off the charger and hooked it up to Cargo C-7 (100% charge).');
    // plugging it in takes it off the plane
    s = gse(s, 'charge').s;
    expect(cart(s)).toMatchObject({ hookedTo: null, charging: true });
    expect(s.feed.at(-1)!.text).toBe('Ana unhooked GPU cart 1 from Cargo C-7 and plugged it in on the hangar charger.');
    s = gse(s, 'unplug').s;
    expect(cart(s)).toMatchObject({ hookedTo: null, charging: false });
    s = gse(s, 'hook', 'gpu1', 'p2').s;
    s = gse(s, 'unhook').s;
    expect(cart(s)).toMatchObject({ hookedTo: null, charging: false });
    // only planes, and one cart on a plane
    expect(gse(s, 'hook', 'gpu1', 'h1').error).toBe('Pick a plane to hook it up to.');
    s.tier = 3;
    s = gse(s, 'hook', 'gpu1', 'p2').s;
    expect(gse(s, 'hook', 'gpu2', 'p2').error).toBe('GPU cart 1 is already hooked up to Cargo C-7.');
  });

  it('cart moves are week-stamped: one queued offline across a deadline is refused', () => {
    const s = withCargo();
    const r = apply(s, { t: 'gse', role: 'mech', cart: 'gpu1', op: 'hook', assetId: 'p2', week: s.week - 1 }, NOW);
    expect(r.error).toMatch(/closed before that synced/);
    const t = { ...s, turns: { ...s.turns, mech: { ended: true, endedAt: NOW, done: 0 } } };
    expect(gse(t, 'inspect').error).toBe('Your turn is over for this week.');
  });

  it('an inspection is the mechanic\u2019s call on the plug end, once a week; tagged out, it is written up for the electrician in the words of what is wrong', () => {
    let s = withCargo();
    expect(cableBand(0)).toBe('good');
    expect(cableBand(GSE.cracked)).toBe('cracked');
    expect(cableBand(GSE.pitted)).toBe('pitted');
    s = gse(s, 'inspect').s;
    expect(cart(s).inspected).toEqual({ week: s.week, band: 'good', by: 'Ana' });
    expect(s.feed.at(-1)!.text).toBe("Ana inspected GPU cart 1's cable and plug: serviceable.");
    expect(gse(s, 'inspect').error).toMatch(/already inspected this week/);
    s.week += 1;
    setCart(s, 'gpu1', { wear: 50 });
    s = gse(s, 'inspect', 'gpu1', undefined, 'mech', 'tag').s;
    expect(cart(s).inspected!.band).toBe('cracked');
    const rep = cableReport(s, 'gpu1')!;
    expect(rep).toMatchObject({ role: 'elec', kind: 'report', puzzle: 'wireup', job: 'gpuCable', status: 'ready', cost: REPORT_BY_KEY.gpuCable.cost, title: CABLE_REPORT.cracked.title });
    expect(rep.report).toMatchObject({ key: 'gpuCable', by: 'mech', effect: 'gse', cart: 'gpu1', band: 'cracked' });
    expect(s.feed.at(-2)!.text).toBe(`Ana tagged GPU cart 1 out at the inspection: ${CABLE_BAND.cracked}.`);
    expect(s.feed.at(-1)!.text).toBe("Ana reports: the GPU cart cable insulation is cracked at the plug (GPU cart 1, tagged out). Ben, it's yours.");
    // tagged out: it can't be hooked up
    expect(gse(s, 'hook', 'gpu1', 'p2').error).toMatch(/tagged out: its cable insulation is cracked at the plug\. Ben has to fix it first/);
    // pitted contacts say so, in the report's title, the feed and the tag
    const p = withCargo();
    setCart(p, 'gpu1', { wear: 80 });
    const q = gse(p, 'inspect', 'gpu1', undefined, 'mech', 'tag').s;
    expect(cableReport(q, 'gpu1')!.title).toBe('GPU cart plug contacts pitted and burnt: new plug');
    expect(q.feed.at(-1)!.text).toBe("Ana reports: the GPU cart plug contacts are pitted and burnt (GPU cart 1, tagged out). Ben, it's yours.");
    expect(gse(q, 'hook', 'gpu1', 'p2').error).toMatch(/tagged out: its plug contacts are pitted and burnt/);
  });

  it('a worn cable called serviceable stays in service (the card says what the mechanic called); a good one tagged out goes to the electrician anyway', () => {
    const s = withCargo();
    setCart(s, 'gpu1', { wear: 80 });
    const ok = gse(s, 'inspect', 'gpu1', undefined, 'mech', 'ok').s;
    expect(cableReport(ok, 'gpu1')).toBeUndefined();
    expect(cart(ok)).toMatchObject({ wear: 80, inspected: { band: 'good' } });
    expect(ok.feed.at(-1)!.text).toBe("Ana inspected GPU cart 1's cable and plug: serviceable.");
    // nothing on screen says it was wrong: the arc into a plane's receptacle comes later (see below)
    expect(ok.feed.some((f) => /pitted|burnt|wrong/i.test(f.text))).toBe(false);
    const good = gse(withCargo(), 'inspect', 'gpu1', undefined, 'mech', 'tag').s;
    expect(cableReport(good, 'gpu1')!.title).toBe(CABLE_REPORT.good.title);
  });
});

describe('ground power start: needs a charged cart hooked to that plane', () => {
  it('no cart, a flat cart, a tagged-out cart: the start is refused with what is missing', () => {
    let s = withCargo();
    const o = startJob(s);
    expect(gseForStart(s, o).blocker).toBe('Hook a charged cart up to Cargo C-7 first');
    expect(complete(s, 'mech', o, 0.9).error).toBe('Hook a charged cart up to Cargo C-7 first.');
    s = gse(s, 'hook', 'gpu1', 'p2').s;
    setCart(s, 'gpu1', { charge: 20 });
    expect(complete(s, 'mech', o, 0.9).error).toBe('Hook a charged cart up to Cargo C-7 first: GPU cart 1 is down to 20%.');
    setCart(s, 'gpu1', { charge: 80 });
    // other jobs never need one
    const tires = addOrder(s, { role: 'mech', kind: 'tires', puzzle: 'torque', assetId: 'p2', tier: 1, cost: 320, gain: 10 });
    expect(gseForStart(s, tires).blocker).toBeNull();
    expect(complete(s, 'mech', o, 0.9).error).toBeUndefined();
  });

  it('a start uses charge by the plane (the cargo single is the turbine) and wears the cable (more after a live plug)', () => {
    // the amphibian is a piston single, whatever the order's tier or what the puzzle says
    let s = gse(withCargo(4, true), 'hook', 'gpu1', 'p3').s;
    const a = complete(s, 'mech', startJob(s, 4, 'p3'), 0.9, { errors: [], ac: 'turbine' }).s;
    expect(cart(a)).toMatchObject({ charge: 100 - GSE.drain.piston, wear: GSE.startWear + GSE.wear });
    // the cargo single is the turbine at every tier
    s = gse(withCargo(), 'hook', 'gpu1', 'p2').s;
    const b = complete(s, 'mech', startJob(s, 2), 0.9, { errors: ['arcIn'], ac: 'piston' }).s;
    expect(cart(b)).toMatchObject({ charge: 100 - GSE.drain.turbine, wear: GSE.startWear + GSE.wear + GSE.arcWear });
    // no puzzle data (autopilot, the paper sim): the plane still decides
    s = gse(withCargo(), 'hook', 'gpu1', 'p2').s;
    expect(cart(complete(s, 'mech', startJob(s, 1), 0.9).s).charge).toBe(100 - GSE.drain.turbine);
    // the start drained it whatever came of it (a teaching-tier rework still used the cart)
    s = gse(withCargo(4, true), 'hook', 'gpu1', 'p3').s;
    const rework = complete(s, 'mech', startJob(s, 1, 'p3'), 0.2).s;
    expect(rework.orders.find((x) => x.kind === 'gpustart')!.status).toBe('ready');
    expect(cart(rework).charge).toBe(100 - GSE.drain.piston);
  });

  it('the cart charges on the hangar charger when the week resolves (a small power bill); off it, it slowly runs down', () => {
    let s = withCargo(1);
    s.deadline = NOW;
    setCart(s, 'gpu1', { charge: 30 });
    const r = resolve(structuredClone(s));
    expect(cart(r).charge).toBe(90);
    const h = r.history.at(-1)!;
    expect(h.costs.power).toBe(Math.round(60 * GSE.powerPerPoint));
    expect(h.lines.some((l) => l.text === `GPU cart 1 charged to 90% on the hangar charger ($${Math.round(60 * GSE.powerPerPoint)} of power).`)).toBe(true);
    // the bill is in the week's cash
    const idle = structuredClone(s);
    setCart(idle, 'gpu1', { charge: 100 });
    expect(resolve(idle).cash - r.cash).toBe(h.costs.power);
    // no hangar power (grid down, no generator): no charge
    const dark = structuredClone(s);
    dark.assets.find((a) => a.kind === 'grid')!.health = 20;
    const d = resolve(dark);
    expect(cart(d).charge).toBe(30);
    expect(d.history.at(-1)!.lines.some((l) => /No hangar power: GPU cart 1 sat on a dead charger/.test(l.text))).toBe(true);
    // unplugged: it runs down
    const off = structuredClone(s);
    setCart(off, 'gpu1', { charging: false, charge: 50 });
    expect(cart(resolve(off)).charge).toBe(50 - GSE.idleDrain);
  });
});

describe('the ground power puzzle gets the cart as it was left', () => {
  /** a piston start set up by the book on a cart at this charge: its volts at rest and while cranking */
  const crank = (charge: number) => {
    const m = generateGpu(5, 2, [], 'piston', charge);
    const s = newSim(m);
    setCartVolts(s, m.ac.volts);
    flip(s, 'avionics', false);
    flip(s, 'batt', m.ac.master === 'on');
    plugIn(s);
    pushPlug(s);
    cartSwitch(s, true);
    gpuStep(s, 0.3);
    const rest = cartOut(s);
    flip(s, 'starter', true);
    gpuStep(s, 0.2);
    return { volts: m.ac.volts, rest, load: cartOut(s), power: crankPower(s) };
  };

  it('a full cart holds its setting; a run-down one rests a little low and sags hard under the start load', () => {
    const full = crank(100);
    const low = crank(30);
    expect(full.rest).toBeCloseTo(full.volts - 0.1, 5);
    expect(low.rest).toBeLessThan(full.rest);
    const sagFull = full.rest - full.load;
    const sagLow = low.rest - low.load;
    expect(sagFull).toBeGreaterThan(0);
    // visibly: more than twice as far, a volt or more on a 28 V cart
    expect(sagLow).toBeGreaterThan(2 * sagFull);
    expect(low.power).toBeLessThan(full.power);
    // enough to start (the engine refuses a start under GSE.minStart)
    expect(crank(GSE.minStart).power).toBeGreaterThanOrEqual(0.6);
  });
});

describe('cable wear: hidden until inspected, and it shows up later', () => {
  it('a cable too far gone is written up at the week open without an inspection: the cart is tagged out, no starts on it', () => {
    let s = withCargo(4);
    s.deadline = NOW;
    setCart(s, 'gpu1', { wear: GSE.autoReport, hookedTo: 'p2', charging: false });
    s = resolve(s);
    const rep = cableReport(s, 'gpu1')!;
    expect(rep.report).toMatchObject({ key: 'gpuCable', effect: 'gse', cart: 'gpu1', by: 'mech' });
    const o = startJob(s);
    expect(complete(s, 'mech', o, 0.9).error).toMatch(/GPU cart 1 is tagged out until Ben fixes its cable/);
    // still open at the next resolve (the electrician played, but left it): a review line says so
    const r = resolve(apply(s, { t: 'endTurn', role: 'elec' }, NOW).s);
    expect(r.history.at(-1)!.lines.some((l) => /stayed tagged out \(no ground power starts on it\)/.test(l.text))).toBe(true);
  });

  it('the electrician fixes it on the wire-up puzzle (a new plug): wear reset, the cart back in service', () => {
    let s = withCargo(4);
    setCart(s, 'gpu1', { wear: 75 });
    s = gse(s, 'inspect').s;
    const rep = cableReport(s, 'gpu1')!;
    expect(generateWireup(rep.seed, rep.tier, [], rep.job).device).toBe('gpuplug');
    s = complete(s, 'elec', rep, 0.95).s;
    expect(cableReport(s, 'gpu1')).toBeUndefined();
    expect(cart(s)).toMatchObject({ wear: 0, inspected: { band: 'good', by: 'Ben', fixed: true } });
    expect(s.feed.at(-1)!.text).toBe("Ben closed out Ana's report: GPU cart plug contacts pitted and burnt: new plug. GPU cart 1 is back in service.");
    s = gse(s, 'hook', 'gpu1', 'p2').s;
    expect(complete(s, 'mech', startJob(s), 0.9).error).toBeUndefined();
  });

  it('a sloppy fix looks like any new plug until it comes back; a re-inspection waits a week; a clean fix clears the comeback for good', () => {
    let s = withCargo(4);
    s.deadline = NOW;
    setCart(s, 'gpu1', { wear: 75 });
    s = gse(s, 'inspect').s;
    // under a pass: it will come back (a teaching-tier fix under 40% isn't signed off at all)
    s = complete(s, 'elec', cableReport(s, 'gpu1')!, 0.5).s;
    expect(cart(s).wear).toBeLessThan(GSE.cracked);
    expect(s.defects!.filter((d) => d.report?.cart === 'gpu1')).toHaveLength(1);
    // the week it was re-terminated, it's left to settle
    expect(gse(s, 'inspect').error).toBe("GPU cart 1's cable was re-terminated this week: look it over next week.");
    // the next week the mechanic doesn't like it and tags it: the fix that was going to come back comes back now
    s = resolve(s);
    s = gse(s, 'inspect', 'gpu1', undefined, 'mech', 'tag').s;
    const back = cableReport(s, 'gpu1')!;
    expect(back.report).toMatchObject({ again: 4, cart: 'gpu1' });
    expect((s.defects ?? []).some((d) => d.report?.cart === 'gpu1')).toBe(false);
    // a clean fix: nothing of the old one is left to come back
    s = complete(s, 'elec', back, 0.95).s;
    expect(cart(s).wear).toBe(0);
    expect((s.defects ?? []).some((d) => d.report?.cart === 'gpu1')).toBe(false);
    for (let i = 0; i < 3; i++) {
      s = resolve(s);
      expect(cableReport(s, 'gpu1')).toBeUndefined();
    }
    expect(cart(s).wear).toBeLessThan(GSE.cracked);
  });

  it('a clean fix after a sloppy one: the old comeback never fires on the new plug', () => {
    let s = withCargo(4);
    s.deadline = NOW;
    setCart(s, 'gpu1', { wear: 75 });
    s = gse(s, 'inspect').s;
    s = complete(s, 'elec', cableReport(s, 'gpu1')!, 0.5).s;
    // a second report on the same cart (too far gone to miss, say) fixed cleanly before the first comeback is due
    const d = s.defects!.find((x) => x.report?.cart === 'gpu1')!;
    d.dueWeek = s.week + 2;
    setCart(s, 'gpu1', { wear: GSE.autoReport });
    s.defects = s.defects!.filter((x) => x !== d);
    s = resolve(s);
    s.defects = [...(s.defects ?? []), d];
    const rep = cableReport(s, 'gpu1')!;
    s = complete(s, 'elec', rep, 0.95).s;
    expect((s.defects ?? []).some((x) => x.report?.cart === 'gpu1')).toBe(false);
    for (let i = 0; i < 3; i++) s = resolve(s);
    expect(s.orders.some((o) => o.report?.cart === 'gpu1' && o.report.again)).toBe(false);
  });

  it('a botched fix comes back, and the plug end is burnt again', () => {
    let s = withCargo(4);
    s.deadline = NOW;
    setCart(s, 'gpu1', { wear: 75 });
    s = gse(s, 'inspect').s;
    // under a pass (not under 40%: a teaching-tier fix that bad isn't signed off at all)
    s = complete(s, 'elec', cableReport(s, 'gpu1')!, 0.5).s;
    expect(cableReport(s, 'gpu1')).toBeUndefined();
    expect(cart(s).wear).toBeLessThan(GSE.pitted);
    for (let i = 0; i < 3 && !cableReport(s, 'gpu1'); i++) s = resolve(s);
    const back = cableReport(s, 'gpu1')!;
    expect(back.report).toMatchObject({ again: 4, cart: 'gpu1' });
    expect(cart(s).wear).toBeGreaterThanOrEqual(GSE.pitted);
  });

  it('a start through pitted pins can arc into the receptacle: nothing shows at sign-off, a gpu:arc incident later, traced to it', () => {
    // find an order seed whose cable roll arcs at wear 95
    let s!: IslandState;
    let o!: Order;
    for (let k = 0; k < 40; k++) {
      s = gse(withCargo(4), 'hook', 'gpu1', 'p2').s;
      setCart(s, 'gpu1', { wear: 95 });
      o = startJob(s);
      const r = complete(s, 'mech', o, 0.95).s;
      if (r.defects?.some((d) => d.log === 'ground power start on a worn cart cable')) {
        s = r;
        break;
      }
    }
    const d = s.defects!.find((x) => x.log === 'ground power start on a worn cart cable')!;
    expect(d).toMatchObject({ puzzle: 'gpu', variant: 'arc', assetId: 'p2', role: 'mech', severity: 2, redo: false });
    // no immediate sign: the feed only says it was signed off
    expect(s.feed.at(-1)!.text).toBe('Ana signed off Ground power start: weak battery on Cargo C-7.');
    expect(s.feed.some((f) => /arc|receptacle|pitted/i.test(f.text))).toBe(false);
    s.deadline = NOW;
    d.dueWeek = s.week;
    const h0 = s.assets.find((a) => a.id === 'p2')!.health;
    s = resolve(s);
    const inc = s.history.at(-1)!.incidents.find((i) => i.kind === 'defect')!;
    expect(inc.title).toBe(incidentText(DEFECT_RULES['gpu:arc'], 2, 'Cargo C-7'));
    expect(inc.from!.traced).toBe('the ground power start on a worn cart cable Ana signed off in week 4');
    expect(s.assets.find((a) => a.id === 'p2')!.health).toBeLessThan(h0);
    // the repair is an alert (planned like any): its job is the receptacle's teardown
    const al = s.alerts!.find((x) => x.repair?.defect.id === d.id)!;
    expect(al).toMatchObject({ role: 'mech', assetId: 'p2', kind: 'repair', src: 'again' });
    const task = repairTask(s, al)!;
    s.week = al.week;
    const planned = apply(s, { t: 'plan', role: 'mech', alert: al.id, task: task.id, pick: [], week: s.week }, NOW);
    expect(planned.error).toBeUndefined();
    const rep = planned.s.orders.find((x) => x.flow?.alert === al.id)!;
    expect(rep).toMatchObject({ kind: 'repair', puzzle: 'teardown', job: 'receptacle' });
  });

  it('arcs follow the wear: a good or cracked cable never arcs; pitted ones do, more the worse they are', () => {
    const rate = (wear: number) => {
      let n = 0;
      for (let k = 0; k < 300; k++) {
        const s = gse(withCargo(4), 'hook', 'gpu1', 'p2').s;
        setCart(s, 'gpu1', { wear });
        const r = complete(s, 'mech', startJob(s), 0.95).s;
        if (r.defects?.some((d) => d.variant === 'arc')) n++;
      }
      return n / 300;
    };
    expect(rate(20)).toBe(0);
    expect(rate(GSE.pitted - 1)).toBe(0);
    const p70 = rate(GSE.pitted);
    const p95 = rate(95);
    expect(p70).toBeGreaterThan(0.08);
    expect(p70).toBeLessThan(0.28);
    expect(p95).toBeGreaterThan(0.45);
  });
});

describe('ground power: the rest of the island', () => {
  it('avionics work needs a charged cart hooked up: the radio\u2019s ops check runs the bus on ground power', () => {
    const base = withCargo(4);
    const job = (s: IslandState) => addOrder(s, { role: 'mech', kind: 'avionics', puzzle: 'teardown', assetId: 'p2', tier: 1, cost: 640, gain: 14 });
    const plain = structuredClone(base);
    const refused = complete(plain, 'mech', job(plain), 0.9);
    expect(refused.error).toMatch(/Hook a charged cart up to Cargo C-7 first: the radio's ops check runs the bus on ground power/);
    const hooked = gse(structuredClone(base), 'hook', 'gpu1', 'p2').s;
    const wear = cart(hooked).wear;
    const b = complete(hooked, 'mech', job(hooked), 0.9).s;
    // a little charge, and a plug-in's worth of wear (no start: no start's drain)
    expect(cart(b).charge).toBe(100 - GSE.avionicsDrain);
    expect(cart(b).wear).toBe(wear + GSE.busWear);
  });

  it("autopilot tows a charged cart over for a start, and puts it back on the charger", () => {
    let s = withCargo(4);
    s.deadline = NOW;
    const o = startJob(s);
    s.orders = s.orders.filter((x) => x.role !== 'mech' || x.id === o.id);
    s = resolve(s);
    const done = s.orders.find((x) => x.id === o.id);
    expect(done?.result).toMatchObject({ auto: true, score: 0.5 });
    // back on the charger after the start, and charged again when the week resolved
    expect(cart(s)).toMatchObject({ hookedTo: null, charging: true });
  });

  it('bots tow the cart, put it back on the charger, inspect the cable; the sim stays deterministic', () => {
    let starts = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { final } = simulate(TEAMS['three friends'], 26, seed, (s) => {
        starts += s.orders.filter((o) => o.kind === 'gpustart' && o.result?.week === s.week - 1).length;
        // never left hooked up after a start, never both on the charger and on a plane
        for (const c of s.gse ?? []) expect(c.charging && c.hookedTo).toBeFalsy();
      });
      expect(final.gse!.some((c) => c.inspected)).toBe(true);
      expect(final.gse!.every((c) => c.charge >= 0 && c.charge <= 100 && c.wear >= 0 && c.wear <= 100)).toBe(true);
    }
    expect(starts).toBeGreaterThan(0);
    const a = simulate(TEAMS['three friends'], 20, 3).final;
    expect(JSON.stringify(simulate(TEAMS['three friends'], 20, 3).final)).toBe(JSON.stringify(a));
  });
});

describe('flight days on a weak battery: the cart chore most weeks', () => {
  /** an island at week `w` whose week-open rolled a weak battery (the roll is seeded: search the island seeds) */
  function weakWeek(model: 'cargo' | 'twin' = 'cargo') {
    for (let seed = 1; seed < 400; seed++) {
      let s = createIsland({ id: `wb${seed}`, name: 'Weak Isle', now: NOW, tz: 'Europe/Paris', seed, creator: { uid: 'a', name: 'Ana', role: 'mech' } });
      s = apply(s, { t: 'join', uid: 'b', name: 'Ben', role: 'elec' }, NOW).s;
      s = apply(s, { t: 'join', uid: 'c', name: 'Cy', role: 'fin' }, NOW).s;
      for (const r of ['mech', 'elec', 'fin'] as Role[]) s = apply(s, { t: 'week0Done', role: r }, NOW).s;
      s.assets.push({ id: 'p2', kind: 'plane', model: 'cargo', name: 'Cargo C-7', health: 90, touchedWeek: 0, sinceInspection: 0 });
      s.week = GSE.weakFrom;
      s.deadline = NOW;
      // resolve the week before: its week-open rolls this one's weak battery
      s.week = GSE.weakFrom - 1;
      const x = resolve(s);
      if (x.weakBattery?.week === x.week && x.assets.find((a) => a.id === x.weakBattery!.assetId)?.model === model) {
        // the week's alerts aside (an airworthiness one due now would restrict the twin): the battery is what's on trial
        x.alerts = [];
        return x;
      }
    }
    throw new Error('no weak battery');
  }
  const flights = (s: IslandState, name: string) => s.history.at(-1)!.lines.map((l) => l.text).filter((l) => l.includes(name));

  it('the week opens with a weak battery on a plane that will fly, and says so to the mechanic', () => {
    const s = weakWeek();
    expect(s.weakBattery).toEqual({ assetId: 'p2', week: s.week });
    expect(s.feed.some((f) => f.role === 'mech' && /Cargo C-7's battery is weak this week: its first start is on ground power\. Hook a charged cart up to it before the week resolves, or it loses a flight\./.test(f.text))).toBe(true);
    // not every week: about GSE.weakChance of them
    let n = 0;
    for (let w = GSE.weakFrom; w < GSE.weakFrom + 200; w++) {
      const x = { ...s, week: w - 1, weakBattery: null, deadline: NOW };
      if (resolve(x).weakBattery) n++;
    }
    expect(n / 200).toBeGreaterThan(GSE.weakChance - 0.15);
    expect(n / 200).toBeLessThan(GSE.weakChance + 0.15);
  });

  it('a charged cart hooked up to it: the pilot starts on it (a start\'s drain by the plane, and its wear); no job slot used', () => {
    let s = weakWeek('cargo');
    s = gse(s, 'hook', 'gpu1', 'p2').s;
    const wear = cart(s).wear;
    // everyone ends the turn (no autopilot jobs on the cart)
    let x = s;
    for (const r of ['mech', 'elec', 'fin'] as Role[]) x = apply(x, { t: 'endTurn', role: r, week: x.week }, NOW).s;
    expect(flights(x, 'Cargo C-7').some((l) => /Cargo C-7's weak battery: the pilot started it on GPU cart 1 \(\d+% left on the cart\)\./.test(l))).toBe(true);
    // the turbine's drain (off the charger all week: its idle drain too), and a start's wear
    expect(cart(x).charge).toBe(100 - GSE.drain.turbine - GSE.idleDrain);
    expect(cart(x).wear).toBe(wear + GSE.wear);
    expect(x.turns.mech?.done ?? 0).toBe(0);
    expect(x.history.at(-1)!.flightsFlown).toBe(x.history.at(-1)!.flightsScheduled);
  });

  it('no cart on it (or a flat or tagged-out one): its first flight is lost', () => {
    const s = weakWeek('cargo');
    s.deadline = NOW;
    // everyone played and ended the turn: no autopilot to tow a cart over
    let x = s;
    for (const r of ['mech', 'elec', 'fin'] as Role[]) x = apply(x, { t: 'endTurn', role: r, week: x.week }, NOW).s;
    expect(flights(x, 'Cargo C-7')).toContain("Cargo C-7's battery was weak and no cart was hooked up to it: its first flight was lost.");
    const h = x.history.at(-1)!;
    expect(h.flightsFlown).toBe(h.flightsScheduled - 1);
    // a flat one
    let y = gse(s, 'hook', 'gpu1', 'p2').s;
    y = setCart(y, 'gpu1', { charge: GSE.minStart - 5 });
    for (const r of ['mech', 'elec', 'fin'] as Role[]) y = apply(y, { t: 'endTurn', role: r, week: y.week }, NOW).s;
    expect(flights(y, 'Cargo C-7').some((l) => /GPU cart 1 on it was down to 25%: its first flight was lost/.test(l))).toBe(true);
  });

  it("autopilot covers an empty mechanic's seat: the best charged cart goes on the plane, the others back on the charger", () => {
    const s = weakWeek('cargo');
    s.deadline = NOW;
    const x = resolve(s);
    expect(flights(x, 'Cargo C-7').some((l) => /the pilot started it on GPU cart 1/.test(l))).toBe(true);
    // the cart stays on the plane it started (the mechanic puts it back next week, or autopilot does)
    expect(cart(x).hookedTo).toBe('p2');
    const y = resolve({ ...x, deadline: NOW, weakBattery: null });
    expect(cart(y).hookedTo).toBeNull();
    expect(cart(y).charging).toBe(true);
  });

  it('the paper-sim mechanic hooks a cart up for the flight day and puts it back after; flights are rarely lost to it', () => {
    let weak = 0;
    let lost = 0;
    for (let seed = 1; seed <= 6; seed++) {
      simulate(TEAMS['all average'], 26, seed, (s) => {
        const h = s.history.at(-1)!;
        for (const l of h.lines) {
          if (/weak battery: the pilot started it on/.test(l.text)) weak++;
          if (/battery was weak and/.test(l.text)) lost++;
        }
      });
    }
    expect(weak).toBeGreaterThan(20);
    expect(lost / (weak + lost)).toBeLessThan(0.25);
  });
});

describe('cross-trade reports for hydraulics and ground power', () => {
  const NEW = ['boom', 'van', 'gpuCable', 'hangarGpu', 'gpuBilling'];

  it('in the new set every trade both reports and fixes', () => {
    const rows = REPORTS.filter((r) => NEW.includes(r.key));
    expect(rows).toHaveLength(NEW.length);
    for (const role of ['mech', 'elec', 'fin'] as Role[]) {
      expect(rows.some((r) => r.by === role), `${role} reports`).toBe(true);
      expect(rows.some((r) => r.fixer === role), `${role} fixes`).toBe(true);
    }
    // the van's wobbling wheel is still there (a torque job), next to its soft pedal (a hydraulic one)
    expect(REPORT_BY_KEY.vanWheel.puzzle).toBe('torque');
    expect(REPORT_BY_KEY.van).toMatchObject({ by: 'fin', fixer: 'mech', puzzle: 'hydraulics', job: 'van' });
    expect(REPORT_BY_KEY.boom).toMatchObject({ by: 'elec', fixer: 'mech', puzzle: 'hydraulics', job: 'boom' });
  });

  it('the cable report is raised by wear, never drawn at random', () => {
    expect(REPORT_BY_KEY.gpuCable).toMatchObject({ auto: true, effect: 'gse', puzzle: 'wireup', job: 'gpuCable' });
    let s = started();
    s.deadline = NOW;
    const seen = new Set<string>();
    for (let w = 0; w < 30; w++) {
      s = resolve(s);
      for (const o of s.orders) if (o.report) seen.add(o.report.key);
    }
    expect(seen.size).toBeGreaterThan(1);
    expect(seen.has('gpuCable')).toBe(false);
  });

  it("each report's job is a real scenario in its puzzle", () => {
    expect(generateHydraulics(1, 2, [], 'boom').system).toBe('boom');
    expect(generateHydraulics(1, 2, [], 'van').system).toBe('van');
    expect(generateWireup(1, 2, [], 'gpuCable').device).toBe('gpuplug');
    const m = generateMeter(1, 2, [], 'hangar');
    expect(m.items.at(-1)!.name).toBe('28 V supply outlet');
    expect(m.fault.at).toBeLessThanOrEqual(m.items.length - 1);
    const v = generateVariance(1, 2, [], 500, 'gpu');
    expect(v.drivers.some((i) => /Ground power/.test(v.lines[i].name))).toBe(true);
  });
});
