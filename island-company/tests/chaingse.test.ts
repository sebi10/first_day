// The part chain and the ground power carts together. A plane that is AOG for
// a part can still need a ground power start, a cart can be left on it, and a
// crewmate's report can tag the other cart out: none of that may hold the chain
// up, and the chain may never hold up the starts. Reports and chain steps are
// the same kind of "whose move is it" on every surface.
import { describe, expect, it, vi } from 'vitest';
import { botTurn, simulate, TEAMS } from '../src/sim/bots';
import { chainAtaOf, islandAircraft, openChain, plantFor, rightPn } from '../src/sim/chain';
import { CABLE_REPORT, CHAIN, GSE, REPORT_BY_KEY } from '../src/sim/data';
import { gseCarts, gseForStart, isAog, startCart } from '../src/sim/econ';
import { apply, chainWouldOpen, createIsland } from '../src/sim/engine';
import { hashSeed, rng } from '../src/sim/rng';
import { ROLES, type Asset, type GseCart, type IslandState, type Order, type Role } from '../src/sim/types';
import { blocks, crossMoves, owedBy, pushes } from '../src/ui/select';

// whole seasons of the paper sim: give a loaded CI box room (see tests/ipc.test.ts)
vi.setConfig({ testTimeout: 30000 });

const NOW = Date.UTC(2026, 8, 26, 10);
const CARGO: Asset = { id: 'p2', kind: 'plane', model: 'cargo', name: 'Cargo C-7', health: 70, touchedWeek: 5, sinceInspection: 0 };
const FLOAT: Asset = { id: 'p3', kind: 'plane', model: 'float', name: 'Float F-3', health: 70, touchedWeek: 5, sinceInspection: 0 };

/** a cargo plane without an alteration on its wheels and brakes: the IPC lookup finds the part */
const CLEAN = Array.from({ length: 400 }, (_, i) => i + 1).find((seed) => !plantFor(seed, 'p2', 'cargo').plant)!;

/** a started island in week 5 at `tier`, with the cargo plane (and the floatplane from tier 4) and an empty order book */
function island(tier = 2, seed = CLEAN): IslandState {
  let s = createIsland({ id: `cg${seed}`, name: 'Hangar Isle', now: NOW, tz: 'Europe/Paris', seed, creator: { uid: 'a', name: 'Ana', role: 'mech' } });
  s = apply(s, { t: 'join', uid: 'b', name: 'Ben', role: 'elec' }, NOW).s;
  s = apply(s, { t: 'join', uid: 'c', name: 'Cy', role: 'fin' }, NOW).s;
  for (const r of ROLES) s = apply(s, { t: 'week0Done', role: r }, NOW).s;
  s.week = 5;
  s.tier = tier;
  s.cash = 20000;
  s.assets.push({ ...CARGO });
  if (tier >= 4) s.assets.push({ ...FLOAT });
  s.orders = [];
  s.gse = gseCarts(s);
  return s;
}

let seq = 0;
function order(s: IslandState, f: Partial<Order> & Pick<Order, 'kind' | 'puzzle'>): Order {
  const o: Order = {
    id: `x${++seq}`,
    role: 'mech',
    assetId: 'p2',
    title: f.kind,
    tier: 2,
    cost: 120,
    parts: 0,
    gain: 8,
    createdWeek: s.week,
    deferrals: 0,
    lastDeferredWeek: null,
    status: 'ready',
    seed: hashSeed('cg-order', seq),
    ...f,
  };
  s.orders.push(o);
  return o;
}
const startJob = (s: IslandState, assetId = 'p2') => order(s, { kind: 'gpustart', puzzle: 'gpu', assetId, title: 'Ground power start: weak battery' });

/** a ready tire-and-brake job on the cargo plane whose sign-off finds a part (the roll is seeded: search for one) */
function jobThatFinds(s: IslandState): Order {
  const o = order(s, { kind: 'tires', puzzle: 'torque', title: 'Tire and brake', cost: 320, gain: 10 });
  for (let i = 0; i < 500; i++) {
    o.seed = hashSeed('cg-find', seq, i);
    if (chainWouldOpen(s, o, 'mech')) return o;
  }
  throw new Error('no seed opens a chain');
}

const ok = (r: { s: IslandState; error?: string }) => {
  expect(r.error).toBeUndefined();
  return r.s;
};
const complete = (s: IslandState, o: Pick<Order, 'id'>, data?: Record<string, unknown>) => ok(apply(s, { t: 'complete', role: 'mech', orderId: o.id, score: 0.9, perfect: false, data, week: s.week }, NOW));
const gse = (s: IslandState, op: 'charge' | 'hook' | 'unhook' | 'inspect', cart: string, assetId?: string) => apply(s, { t: 'gse', role: 'mech', cart, op, ...(assetId ? { assetId } : {}), week: s.week }, NOW);
const approve = (s: IslandState, id: string) => ok(apply(s, { t: 'approve', orderId: id, week: s.week }, NOW));
const endAll = (s: IslandState, skip: Role[] = []) => {
  let x = s;
  for (const r of ROLES) if (!skip.includes(r)) x = apply(x, { t: 'endTurn', role: r, week: x.week }, NOW).s;
  if (x.week === s.week) x = apply(x, { t: 'resolve', week: x.week }, x.deadline! + 1).s;
  expect(x.week).toBe(s.week + 1);
  return x;
};
const stepOf = (s: IslandState) => s.orders.find((o) => o.id === s.chain!.stepId)!;
const cart = (s: IslandState, id = 'gpu1') => gseCarts(s).find((c) => c.id === id)!;
const setCart = (s: IslandState, id: string, patch: Partial<GseCart>) => {
  s.gse = gseCarts(s).map((c) => (c.id === id ? { ...c, ...patch } : c));
  return s;
};
/** tag a cart out: its cable report open on the electrician's list */
const tagOut = (s: IslandState, id: string) => {
  setCart(s, id, { wear: GSE.cracked + 5 });
  return ok(gse(s, 'inspect', id));
};

describe('a chain on a plane that also needs a ground power start', () => {
  it('a ground power start never opens a chain, and no chain step needs a cart', () => {
    expect(chainAtaOf('gpustart')).toBeUndefined();
    expect(Object.keys(CHAIN.kinds)).not.toContain('gpustart');
    let s = island();
    const job = jobThatFinds(s);
    s = complete(s, job);
    // the lookup, the buy card and the install are paperwork, money and the job itself: never a start
    expect(gseForStart(s, stepOf(s)).blocker).toBeNull();
    expect(gseForStart(s, s.orders.find((o) => o.id === job.id)!).blocker).toBeNull();
  });

  it('resolves end to end with a start on the same plane, the cart hooked up to it the whole time', () => {
    let s = island();
    const job = jobThatFinds(s);
    const start = startJob(s);
    s = complete(s, job);
    expect(isAog(s, 'p2')).toBe(true);
    // the mechanic can still tow a cart to the grounded plane and start it (an engine run on the ground)
    s = ok(gse(s, 'hook', 'gpu1', 'p2'));
    expect(gseForStart(s, start).blocker).toBeNull();
    s = complete(s, start);
    expect(s.orders.find((o) => o.id === start.id)!.status).toBe('done');
    // Cargo C-7 is the turbine: a turbine start draws the cart down harder than a piston one
    expect(cart(s)).toMatchObject({ hookedTo: 'p2', charging: false, charge: 100 - GSE.drain.turbine });
    // the chain goes on regardless: IPC lookup, the analyst's purchase, delivery, install
    const ac = islandAircraft(s.seed, CARGO);
    s = complete(s, stepOf(s), { chain: { outcome: 'pn', pn: rightPn(ac, '32-40', s.chain!.tag) } });
    expect(s.chain!.step).toBe('buy');
    s = approve(s, stepOf(s).id);
    expect(s.chain!.step).toBe('transit');
    s = endAll(s);
    expect(s.chain!.step).toBe('install');
    // the cart is still on the grounded plane: off the charger, it lost a little charge, and the install doesn't care
    expect(cart(s)).toMatchObject({ hookedTo: 'p2', charging: false, charge: 100 - GSE.drain.turbine - GSE.idleDrain });
    s = complete(s, s.orders.find((o) => o.id === job.id)!);
    expect(s.chain!.step).toBe('done');
    expect(isAog(s, 'p2')).toBe(false);
    // back on the charger when the mechanic wants it
    s = ok(gse(s, 'charge', 'gpu1'));
    expect(cart(s)).toMatchObject({ hookedTo: null, charging: true });
  });

  it('with the only cart tagged out by a crewmate report, the chain still closes; the start waits for the electrician, not the part', () => {
    let s = island();
    const job = jobThatFinds(s);
    const start = startJob(s);
    s = complete(s, job);
    s = tagOut(s, 'gpu1');
    const rep = s.orders.find((o) => o.report?.key === 'gpuCable')!;
    expect(rep).toMatchObject({ role: 'elec', status: 'ready' });
    expect(gseForStart(s, start).blocker).toBe('Hook a charged cart up to Cargo C-7 first: GPU cart 1 is tagged out until Ben fixes its cable');
    expect(gse(s, 'hook', 'gpu1', 'p2').error).toMatch(/tagged out/);
    // the chain runs through without a cart
    const ac = islandAircraft(s.seed, CARGO);
    s = complete(s, stepOf(s), { chain: { outcome: 'pn', pn: rightPn(ac, '32-40', s.chain!.tag) } });
    s = approve(s, stepOf(s).id);
    s = endAll(s);
    s = complete(s, s.orders.find((o) => o.id === job.id)!);
    expect(openChain(s)).toBeNull();
    // the electrician's fix puts the cart back in service, and the start goes
    s = ok(apply(s, { t: 'complete', role: 'elec', orderId: rep.id, score: 0.9, perfect: false, week: s.week }, NOW));
    s = ok(gse(s, 'hook', 'gpu1', 'p2'));
    s = complete(s, start);
    expect(s.orders.find((o) => o.id === start.id)!.status).toBe('done');
  });
});

describe('a cart left on a plane that is AOG for a part', () => {
  /** tier 4: the floatplane needs a start; cart 1 was left on the cargo plane, now AOG; cart 2 is tagged out */
  function stranded() {
    let s = island(4);
    const job = jobThatFinds(s);
    s = ok(gse(s, 'hook', 'gpu1', 'p2'));
    s = complete(s, job);
    expect(isAog(s, 'p2')).toBe(true);
    s = tagOut(s, 'gpu2');
    const start = startJob(s, 'p3');
    return { s, start };
  }

  it('says where the cart is, and the mechanic tows it straight over', () => {
    const { s, start } = stranded();
    expect(gseForStart(s, start).blocker).toBe('Hook a charged cart up to Float F-3 first: GPU cart 1 is on Cargo C-7, AOG for a part');
    expect(startCart(s, 'p3')?.id).toBe('gpu1');
    const t = ok(gse(s, 'hook', 'gpu1', 'p3'));
    expect(cart(t)).toMatchObject({ hookedTo: 'p3' });
    expect(t.feed.at(-1)!.text).toMatch(/towed GPU cart 1 from Cargo C-7 and hooked it up to Float F-3/);
    expect(complete(t, start).orders.find((o) => o.id === start.id)!.status).toBe('done');
  });

  it('autopilot tows it over for the start (a stranded cart never holds the starts up)', () => {
    const { s, start } = stranded();
    s.orders = s.orders.filter((o) => o.role !== 'mech' || o.id === start.id || o.chain);
    // the mechanic misses the week: autopilot does the start (the chain's IPC lookup waits for a person)
    const t = endAll(s, ['mech']);
    expect(t.orders.find((o) => o.id === start.id)!.result).toMatchObject({ auto: true });
    expect(cart(t)).toMatchObject({ hookedTo: null, charging: true });
    expect(openChain(t)?.step).toBe('lookup');
  });

  it('the bots tow it over too', () => {
    const { s, start } = stranded();
    const t = botTurn(s, 'mech', TEAMS['all good'].mech, rng(1), NOW);
    expect(t.orders.find((o) => o.id === start.id)!.status).toBe('done');
    expect(cart(t)).toMatchObject({ hookedTo: null, charging: true });
  });

  it('a cart on a plane grounded by a safety call is free to tow too, and the card says where it is', () => {
    let s = island(4);
    s = ok(gse(s, 'hook', 'gpu1', 'p2'));
    s = tagOut(s, 'gpu2');
    s = ok(apply(s, { t: 'tag', role: 'mech', assetId: 'p2', on: true, week: s.week }, NOW));
    const start = startJob(s, 'p3');
    expect(gseForStart(s, start).blocker).toBe('Hook a charged cart up to Float F-3 first: GPU cart 1 is on Cargo C-7, grounded this week');
    expect(startCart(s, 'p3')?.id).toBe('gpu1');
    // a start is always on a plane: no plane, no cart
    expect(startCart(s, null)).toBeNull();
  });
});

describe('autopilot and the bots never start without a charged cart', () => {
  /** tier 4: both singles need a turbine start; cart 1 has one start in it (60%), cart 2 is tagged out; an oil change waits too */
  function oneCharge() {
    const s = island(4);
    setCart(s, 'gpu1', { charge: 60 });
    const t = tagOut(s, 'gpu2');
    t.orders = t.orders.filter((o) => o.role !== 'mech');
    // the mechanic's alerts aside: a job planned from one would take the slots these tests are about
    t.alerts = (t.alerts ?? []).filter((a) => a.role !== 'mech');
    const a = order(t, { kind: 'gpustart', puzzle: 'gpu', assetId: 'p2', tier: 4, title: 'Ground power start: weak battery' });
    const b = order(t, { kind: 'gpustart', puzzle: 'gpu', assetId: 'p3', tier: 4, title: 'Ground power start: weak battery' });
    const oil = order(t, { kind: 'oil', puzzle: 'safetywire', assetId: 'p3', tier: 1, title: 'Oil change + safety wire', gain: 9, cost: 190 });
    return { s: t, a, b, oil };
  }

  it('autopilot does the start the charge allows, and another job instead of the second', () => {
    const { s, a, b, oil } = oneCharge();
    const t = endAll(s, ['mech']);
    const st = (id: string) => t.orders.find((o) => o.id === id)!;
    expect(st(a.id).result).toMatchObject({ auto: true });
    // the second start waits for a charged cart: never "done" on a flat one
    expect(st(b.id).status).toBe('ready');
    expect(st(b.id).result).toBeUndefined();
    expect(st(oil.id).result).toMatchObject({ auto: true });
    // cart 1 gave one turbine start, went back on the charger, and charged when the week resolved
    expect(cart(t)).toMatchObject({ hookedTo: null, charging: true, charge: Math.min(100, 60 - GSE.drain.turbine + GSE.chargePerWeek) });
  });

  it('a bot mechanic does the same: the slot goes to the next job', () => {
    const { s, a, b, oil } = oneCharge();
    const t = botTurn(s, 'mech', { ...TEAMS['all good'].mech, perTurn: 2 }, rng(3), NOW);
    const st = (id: string) => t.orders.find((o) => o.id === id)!;
    expect(st(a.id).status).toBe('done');
    expect(st(b.id).status).toBe('ready');
    expect(st(oil.id).status).toBe('done');
    expect(cart(t)).toMatchObject({ hookedTo: null, charging: true, charge: 60 - GSE.drain.turbine });
  });
});

describe('the paper-sim bots play both', () => {
  it('from a set-up island: a chain on the cargo plane with a start on it and a tagged-out cart closes, and the start is done', () => {
    let s = island();
    const job = jobThatFinds(s);
    s = complete(s, job);
    const start = startJob(s);
    s = tagOut(s, 'gpu1');
    s.deadline = NOW;
    const team = TEAMS['three friends'];
    for (let w = 0; w < 8 && (openChain(s) || s.orders.find((o) => o.id === start.id)?.status !== 'done'); w++) {
      const week = s.week;
      for (const role of ROLES) s = apply(botTurn(s, role, team[role], rng(hashSeed('cg-bot', role, week)), NOW), { t: 'endTurn', role, week }, NOW).s;
      if (s.week === week) s = apply(s, { t: 'resolve', week }, s.deadline! + 1).s;
    }
    expect(openChain(s)).toBeNull();
    expect(s.chain!.step).toBe('done');
    expect(s.orders.find((o) => o.id === start.id)?.status ?? 'done').toBe('done');
    for (const c of s.gse!) expect(c.charging && c.hookedTo).toBeFalsy();
  });

  it('over whole seasons: every chain closes within a few weeks, starts happen on grounded planes too, no cart is left hooked up but for flight day', () => {
    let chains = 0;
    let startsAog = 0;
    for (const team of ['three friends', 'all average']) {
      for (let seed = 1; seed <= 8; seed++) {
        const open = new Map<string, number>();
        let prev: IslandState | null = null;
        simulate(TEAMS[team], 26, seed, (s) => {
          const c = openChain(s);
          if (c) {
            if (!open.has(c.id)) chains++;
            open.set(c.id, c.week);
            // nobody's move is lost: a chain moves on within a few weeks
            expect(s.week - c.week, `${team} seed ${seed}: ${c.item} open since week ${c.week}`).toBeLessThanOrEqual(6);
          }
          for (const o of s.orders) if (o.kind === 'gpustart' && o.result?.week === s.week - 1 && prev && isAog(prev, o.assetId!)) startsAog++;
          // the only cart left on a plane at the week's end is the one the weak-battery plane started on, on flight day
          // (the mechanic, or autopilot for an empty seat, puts the others back on the charger)
          for (const x of s.gse ?? []) if (x.hookedTo) expect(x.hookedTo, `${team} seed ${seed} week ${s.week}`).toBe(prev?.weakBattery?.assetId);
          prev = s;
        });
      }
    }
    expect(chains).toBeGreaterThan(4);
    expect(startsAog).toBeGreaterThan(0);
  });
});

describe('whose move is it: reports and chain steps count the same way', () => {
  it('the chain moves between the mechanic and the analyst, and a report between its fixer and its reporter', () => {
    let s = island();
    const job = jobThatFinds(s);
    s = complete(s, job);
    s = tagOut(s, 'gpu1');
    // the mechanic looks it up; the analyst waits to buy it. The electrician fixes the cart; the mechanic waits
    let moves = crossMoves(s);
    expect(moves.map((m) => [m.kind, m.who, m.waits])).toEqual([
      ['chain', 'mech', 'fin'],
      ['report', 'elec', 'mech'],
    ]);
    expect(moves[0].text).toMatch(/^look up the .* in the IPC \(Cargo C-7 is AOG\)$/);
    expect(moves[1].text).toBe(`${REPORT_BY_KEY.gpuCable.said} (GPU cart 1 tagged out)`);
    // the same list is on the crew strip and the waiting / blocking cards
    const bl = blocks(s).filter((b) => b.kind);
    expect(bl.map((b) => [b.from, b.to, b.kind])).toEqual([
      ['mech', 'fin', 'chain'],
      ['elec', 'mech', 'report'],
    ]);
    // the lookup is handed in: now it's the analyst's card, and the mechanic waits (never also counted as a plain approval)
    const ac = islandAircraft(s.seed, CARGO);
    const was = moves[0].key;
    s = complete(s, stepOf(s), { chain: { outcome: 'pn', pn: rightPn(ac, '32-40', s.chain!.tag) } });
    moves = crossMoves(s);
    expect(moves[0]).toMatchObject({ kind: 'chain', who: 'fin', waits: 'mech' });
    // a new move, a new key (a push goes out for it); the report's move is the same one as before
    expect(moves[0].key).not.toBe(was);
    expect(blocks(s).filter((b) => b.from === 'fin' && b.to === 'mech' && /approval/.test(b.text))).toEqual([]);
    // on the way (engineering or the delivery): nobody's move, nothing counted
    s = approve(s, stepOf(s).id);
    expect(crossMoves(s).map((m) => m.kind)).toEqual(['report']);
  });

  it('the end-turn check and the pushes name a report and a chain step the same way: whose move it is now', () => {
    let s = island();
    const job = jobThatFinds(s);
    // the job finds a part: the plane is down, and it's the mechanic's move (the analyst waits for the P/N)
    let before = s;
    s = complete(s, job);
    const lookup = pushes(before, s, { t: 'complete', role: 'mech', orderId: job.id, score: 0.9, perfect: false });
    expect(lookup).toContainEqual({ title: 'Hangar Isle: Cargo C-7 AOG', body: expect.stringMatching(/^Cargo C-7 is grounded for brake linings\. Ana, your move: look up the brake linings in the IPC\.$/) });
    // the mechanic writes a cart's cable up at an inspection: the electrician's move, pushed at once
    before = s;
    setCart(s, 'gpu1', { wear: GSE.cracked + 5 });
    s = ok(gse(s, 'inspect', 'gpu1'));
    expect(pushes(before, s, { t: 'gse', role: 'mech', cart: 'gpu1', op: 'inspect' })).toEqual([
      { title: 'Hangar Isle: Ana reports', body: `${REPORT_BY_KEY.gpuCable.said.charAt(0).toUpperCase()}${REPORT_BY_KEY.gpuCable.said.slice(1)}. Ben, your move.` },
    ]);
    // each seat's end-turn check names what it owes; the analyst owes nothing yet
    expect(owedBy(s, 'mech').map((m) => m.kind)).toEqual(['chain']);
    expect(owedBy(s, 'elec').map((m) => [m.kind, m.waits])).toEqual([['report', 'mech']]);
    expect(owedBy(s, 'fin')).toEqual([]);
    // the lookup is handed in: the analyst's move, pushed with the name
    const ac = islandAircraft(s.seed, CARGO);
    before = s;
    const step = stepOf(s);
    s = complete(s, step, { chain: { outcome: 'pn', pn: rightPn(ac, '32-40', s.chain!.tag) } });
    expect(pushes(before, s, { t: 'complete', role: 'mech', orderId: step.id, score: 0.9, perfect: false })).toEqual([
      { title: 'Hangar Isle: Cargo C-7 AOG', body: expect.stringMatching(/^Cargo C-7 is grounded for brake linings\. Cy, your move: approve the part \(.+\)\.$/) },
    ]);
    expect(owedBy(s, 'fin').map((m) => [m.kind, m.waits])).toEqual([['chain', 'mech']]);
    expect(owedBy(s, 'mech')).toEqual([]);
    // the electrician closes the report out: the mechanic hears it
    const rep = s.orders.find((o) => o.report?.key === 'gpuCable')!;
    before = s;
    s = ok(apply(s, { t: 'complete', role: 'elec', orderId: rep.id, score: 0.9, perfect: false, week: s.week }, NOW));
    expect(pushes(before, s, { t: 'complete', role: 'elec', orderId: rep.id, score: 0.9, perfect: false })).toEqual([
      { title: 'Hangar Isle: report fixed', body: `Ben closed out Ana's report: ${REPORT_BY_KEY.gpuCable.said}.` },
    ]);
    expect(owedBy(s, 'elec')).toEqual([]);
  });

  it('an island saved before either feature reads the same way: no carts or chain stored, nothing waiting, nothing thrown', () => {
    const old = island(4);
    delete old.gse;
    delete old.chain;
    delete old.defects;
    const json = JSON.parse(JSON.stringify(old)) as IslandState;
    expect(crossMoves(json)).toEqual([]);
    expect(owedBy(json, 'mech')).toEqual([]);
    expect(blocks(json).filter((b) => b.kind)).toEqual([]);
    // the default cart is on the charger: the one a start would take
    expect(startCart(json, 'p3')?.id).toBe('gpu1');
    const start = startJob(json, 'p3');
    expect(gseForStart(json, start).blocker).toBe('Hook a charged cart up to Float F-3 first');
    // a week resolves and pushes as before; autopilot does the start off the default cart and stores the carts
    const t = endAll(json, ['mech']);
    expect(t.orders.find((o) => o.id === start.id)!.result).toMatchObject({ auto: true });
    expect(t.gse?.map((c) => c.id)).toEqual(['gpu1', 'gpu2']);
    expect(pushes(json, t, { t: 'endTurn', role: 'fin' })[0].title).toBe('Hangar Isle: week 5 resolved');
  });

  it('a report raised when the week opens rides the week-resolved push, next to the grounded plane', () => {
    let s = island();
    const job = jobThatFinds(s);
    s = complete(s, job);
    // a botched cable fix from last week comes back when this week resolves (its hidden defect is due)
    setCart(s, 'gpu1', { wear: GSE.cracked + 5 });
    s = ok(gse(s, 'inspect', 'gpu1'));
    s = ok(apply(s, { t: 'complete', role: 'elec', orderId: s.orders.find((o) => o.report?.key === 'gpuCable')!.id, score: 0.3, perfect: false, week: s.week }, NOW));
    s.defects!.find((d) => d.report?.key === 'gpuCable')!.dueWeek = s.week + 1;
    const before = s;
    s = endAll(s);
    const [p] = pushes(before, s, { t: 'endTurn', role: 'fin' });
    expect(p.title).toBe('Hangar Isle: week 5 resolved');
    expect(p.body).toMatch(/ Cargo C-7 AOG: Waiting on Ana: IPC lookup\./);
    // a botched fix that comes back has burnt the plug end: the push says so in those words
    expect(p.body).toMatch(new RegExp(` Ana reports ${CABLE_REPORT.pitted.said}: Ben's move\\.( |$)`));
  });
});
