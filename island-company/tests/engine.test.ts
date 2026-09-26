import { describe, expect, it } from 'vitest';
import { simulate, TEAMS } from '../src/sim/bots';
import { ECON } from '../src/sim/data';
import { credit, expectedDeferralCost, deferralRisk, planeCapacity } from '../src/sim/econ';
import { apply, canResolve, createIsland } from '../src/sim/engine';
import { nextDeadline } from '../src/sim/time';
import type { IslandState, Role } from '../src/sim/types';

const NOW = Date.UTC(2026, 8, 26, 10);

function fresh(): IslandState {
  let s = createIsland({ id: 'test', name: 'Test Isle', now: NOW, tz: 'Europe/Paris', seed: 42, creator: { uid: 'a', name: 'Ana', role: 'mech' } });
  s = apply(s, { t: 'join', uid: 'b', name: 'Ben', role: 'elec' }, NOW).s;
  s = apply(s, { t: 'join', uid: 'c', name: 'Cy', role: 'fin' }, NOW).s;
  return s;
}

function started(): IslandState {
  let s = fresh();
  for (const r of ['mech', 'elec', 'fin'] as Role[]) s = apply(s, { t: 'week0Done', role: r }, NOW).s;
  return s;
}

describe('island lifecycle', () => {
  it('week 1 opens only when all three finish week 0', () => {
    let s = fresh();
    s = apply(s, { t: 'week0Done', role: 'mech' }, NOW).s;
    s = apply(s, { t: 'week0Done', role: 'elec' }, NOW).s;
    expect(s.week).toBe(0);
    s = apply(s, { t: 'week0Done', role: 'fin' }, NOW).s;
    expect(s.week).toBe(1);
    expect(s.deadline).toBeGreaterThan(NOW + 12 * 3600_000 - 1);
    expect(s.orders.filter((o) => o.role === 'mech').length).toBeGreaterThanOrEqual(3);
    expect(s.orders.some((o) => o.role === 'fin')).toBe(true);
  });

  it('a seat cannot be double-held and reclaim keeps XP', () => {
    let s = started();
    expect(apply(s, { t: 'join', uid: 'a', name: 'Ana', role: 'elec' }, NOW).error).toBeTruthy();
    s.players.mech!.xp = 1000;
    s = apply(s, { t: 'join', uid: 'a2', name: 'Ana', role: 'mech', reclaim: true, key: s.players.mech!.seatKey }, NOW).s;
    expect(s.players.mech!.devices).toContain('a2');
    expect(s.players.mech!.xp).toBe(1000);
    // two phones racing for the same open seat: the second is told, never silently swapped in
    expect(apply(s, { t: 'join', uid: 'z', name: 'Zed', role: 'mech' }, NOW).error).toMatch(/seat code/);
    s = apply(s, { t: 'join', uid: 'z', name: 'Zed', role: 'mech', takeover: true }, NOW).s;
    expect(s.players.mech!.xp).toBe(600); // an explicit replacement inherits 60%
  });

  it('is deterministic: same actions, same result', () => {
    const a = simulate(TEAMS['all good'], 12, 3).final;
    const b = simulate(TEAMS['all good'], 12, 3).final;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('resolves when all three end their turn, not before', () => {
    let s = started();
    s = apply(s, { t: 'endTurn', role: 'mech' }, NOW).s;
    s = apply(s, { t: 'endTurn', role: 'elec' }, NOW).s;
    expect(canResolve(s, NOW)).toBe(false);
    expect(apply(s, { t: 'resolve', week: 1 }, NOW).error).toBeTruthy();
    s = apply(s, { t: 'endTurn', role: 'fin' }, NOW).s;
    expect(s.week).toBe(2);
    expect(s.history[0].week).toBe(1);
  });

  it('resolve is idempotent across racing phones', () => {
    let s = started();
    const late = s.deadline! + 1;
    const once = apply(s, { t: 'resolve', week: 1 }, late).s;
    const twice = apply(once, { t: 'resolve', week: 1 }, late).s;
    expect(twice.week).toBe(2);
    expect(twice.history.length).toBe(1);
  });

  it('missed turns auto-run at 50% and never count toward unlocks', () => {
    let s = started();
    s = apply(s, { t: 'resolve', week: 1 }, s.deadline! + 1).s;
    const rep = s.history[0];
    expect(rep.autoRun.sort()).toEqual(['elec', 'fin', 'mech']);
    expect(s.stats.weeksBPlus).toBe(0);
    expect(s.players.mech!.missedStreak).toBe(1);
  });
});

describe('approvals, counters, freeze', () => {
  it('approve spends cash and reserves parts; defer increments risk', () => {
    let s = started();
    const o = s.orders.find((x) => x.status === 'pending')!;
    expect(o).toBeTruthy();
    const cash = s.cash;
    s = apply(s, { t: 'approve', orderId: o.id }, NOW).s;
    const after = s.orders.find((x) => x.id === o.id)!;
    expect(['ready', 'waiting_part']).toContain(after.status);
    expect(s.cash).toBe(cash - o.cost);

    const p = s.orders.find((x) => x.status === 'pending');
    if (p) {
      s = apply(s, { t: 'defer', orderId: p.id, reason: 'priority' }, NOW).s;
      expect(s.orders.find((x) => x.id === p.id)!.deferrals).toBe(1);
      expect(apply(s, { t: 'defer', orderId: p.id, reason: 'priority' }, NOW).error).toBeTruthy();
    }
  });

  it('counter-offer: owner accepts the cheaper fix', () => {
    let s = started();
    const o = s.orders.find((x) => x.status === 'pending')!;
    s = apply(s, { t: 'counter', orderId: o.id }, NOW).s;
    const c = s.orders.find((x) => x.id === o.id)!;
    expect(c.status).toBe('countered');
    s = apply(s, { t: 'acceptCounter', orderId: o.id }, NOW).s;
    const d = s.orders.find((x) => x.id === o.id)!;
    expect(d.cost).toBeLessThan(o.cost);
    expect(d.gain).toBeLessThan(o.gain);
  });

  it('cash under $2,000 freezes approvals', () => {
    let s = started();
    s.cash = 1500;
    const o = s.orders.find((x) => x.status === 'pending')!;
    const a = s.assets.find((x) => x.id === o.assetId);
    if (a) a.health = 80;
    o.kind = 'repair';
    expect(apply(s, { t: 'approve', orderId: o.id }, NOW).error).toMatch(/safety-critical/);
    // safety-critical work (asset under 60) can still be approved if cash covers it
    if (a) {
      a.health = 50;
      o.cost = 400;
      expect(apply(s, { t: 'approve', orderId: o.id }, NOW).error).toBeUndefined();
    }
  });

  it('receivership comes with one bridge loan, repaid weekly', () => {
    let s = started();
    s.cash = -3000;
    s.stats.negCashStreak = 1;
    s = apply(s, { t: 'resolve', week: s.week }, s.deadline! + 1).s;
    expect(s.receivership).toBeGreaterThan(0);
    expect(s.loan?.left).toBeGreaterThan(0);
    expect(s.cash).toBeGreaterThan(0);
  });

  it('a move stamped for a closed week is rejected, not applied to the next', () => {
    let s = started();
    s = apply(s, { t: 'resolve', week: s.week }, s.deadline! + 1).s;
    expect(apply(s, { t: 'endTurn', role: 'mech', week: s.week - 1 }, NOW).error).toMatch(/closed/);
    expect(apply(s, { t: 'endTurn', role: 'mech', week: s.week }, NOW).error).toBeUndefined();
  });

  it('parts are capped at 6 (stock + in transit)', () => {
    let s = started();
    s.parts = { stock: 4, inTransit: 2 };
    expect(apply(s, { t: 'buyList' }, NOW).error).toMatch(/capped/);
  });

  it('charter rate is capped at 2x base', () => {
    let s = started();
    s = apply(s, { t: 'setRates', nightly: 99999, charter: 99999 }, NOW).s;
    expect(s.rates.charter).toBe(ECON.baseCharter * 2);
    expect(s.rates.nightly).toBe(ECON.baseNightly * 2);
  });
});

describe('orders and puzzles', () => {
  it('completing an order raises health, gives XP, perfect adds a bonus stack', () => {
    let s = started();
    const pend = s.orders.find((x) => x.role === 'elec' && x.status === 'pending');
    if (pend) s = apply(s, { t: 'approve', orderId: pend.id }, NOW).s;
    const o = s.orders.find((x) => x.role === 'elec' && x.status === 'ready')!;
    const asset = s.assets.find((a) => a.id === o.assetId)!;
    const before = asset.health;
    s = apply(s, { t: 'complete', role: 'elec', orderId: o.id, score: 1, perfect: true }, NOW).s;
    const a2 = s.assets.find((a) => a.id === o.assetId)!;
    expect(a2.health).toBeGreaterThan(before);
    expect(s.players.elec!.xp).toBeGreaterThan(0);
    expect(s.players.elec!.perfects).toBe(1);
  });

  it('lend a hand: one try per week at another trade; a botch damages and stays open', () => {
    let s = started();
    const o = s.orders.find((x) => x.role === 'mech' && x.status === 'ready')!;
    expect(o).toBeTruthy();
    expect(apply(s, { t: 'complete', role: 'elec', orderId: o.id, score: 1, perfect: false }, NOW).error).toMatch(/Lend a hand/);
    // only for jobs that have already waited a week
    expect(apply(s, { t: 'complete', role: 'elec', orderId: o.id, score: 1, perfect: false, cover: true }, NOW).error).toMatch(/waited/);
    s.orders.find((x) => x.id === o.id)!.deferrals = 1;
    const asset = s.assets.find((a) => a.id === o.assetId)!;
    const h = asset.health;
    s = apply(s, { t: 'complete', role: 'elec', orderId: o.id, score: 0.25, perfect: false, cover: true }, NOW).s;
    expect(s.orders.find((x) => x.id === o.id)!.status).toBe('ready');
    expect(s.assets.find((a) => a.id === o.assetId)!.health).toBeCloseTo(h - 6);
    expect(apply(s, { t: 'complete', role: 'elec', orderId: o.id, score: 1, perfect: false, cover: true }, NOW).error).toMatch(/already/);
    // the owner can still do it
    s = apply(s, { t: 'complete', role: 'mech', orderId: o.id, score: 0.9, perfect: false }, NOW).s;
    expect(s.orders.find((x) => x.id === o.id)!.status).toBe('done');
  });

  it('auction result adds parts in transit and costs cash', () => {
    let s = started();
    s.parts = { stock: 1, inTransit: 0 };
    s.orders.push({ ...s.orders.find((o) => o.role === 'fin')!, id: 'auc', kind: 'auction', puzzle: 'auction', status: 'ready' });
    const cash = s.cash;
    s = apply(s, { t: 'complete', role: 'fin', orderId: 'auc', score: 0.9, perfect: false, data: { kits: 1, spent: 310 } }, NOW).s;
    expect(s.parts.inTransit).toBe(1);
    expect(s.cash).toBe(cash - 310);
  });
});

describe('economy rules from the spec', () => {
  it('deferral risk: 10% tier 1, +10/tier, +10/extra week, capped at 60%', () => {
    expect(deferralRisk({ tier: 1, deferrals: 1 })).toBeCloseTo(0.1);
    expect(deferralRisk({ tier: 3, deferrals: 1 })).toBeCloseTo(0.3);
    expect(deferralRisk({ tier: 3, deferrals: 3 })).toBeCloseTo(0.5);
    expect(deferralRisk({ tier: 5, deferrals: 5 })).toBeCloseTo(0.6);
  });

  it('shows the expected cost of deferral next to approve', () => {
    const s = started();
    const o = s.orders.find((x) => x.role === 'mech')!;
    const e = expectedDeferralCost(s, o);
    expect(e.p).toBeGreaterThan(0);
    expect(e.cost).toBeGreaterThan(0);
  });

  it('airworthiness bands: >=60 full, 40-59 restricted, <40 AOG', () => {
    const base = { id: 'x', kind: 'plane' as const, model: 'twin', name: 'x', touchedWeek: 0 };
    expect(planeCapacity({ ...base, health: 70 }, 1, 'clear')).toBe(4);
    expect(planeCapacity({ ...base, health: 55 }, 1, 'clear')).toBe(2);
    expect(planeCapacity({ ...base, health: 30 }, 1, 'clear')).toBe(0);
    expect(planeCapacity({ ...base, health: 70 }, 1, 'wind')).toBe(3);
  });

  it('deadline is the next 20:00 in the creator tz, at least 12 h away', () => {
    // 10:00 UTC = 12:00 Paris (CEST) → 20:00 Paris same day is 8 h away → next day
    const d = nextDeadline(Date.UTC(2026, 8, 26, 10), 'Europe/Paris');
    expect(new Date(d).toISOString()).toBe('2026-09-27T18:00:00.000Z');
    const e = nextDeadline(Date.UTC(2026, 8, 26, 2), 'Europe/Paris');
    expect(new Date(e).toISOString()).toBe('2026-09-26T18:00:00.000Z');
  });
});

describe('paper-sim exit tests (spec phase 0)', () => {
  const seeds = [1, 2, 3, 4, 5, 6];
  it('sensible play never ends a week with cash < 0', () => {
    for (const seed of seeds) {
      for (const team of ['all good', 'all average']) {
        const { minCash } = simulate(TEAMS[team], 26, seed);
        expect(minCash, `${team} seed ${seed}`).toBeGreaterThanOrEqual(0);
      }
    }
  });
  it('no role can win alone: solo players never leave tier 1', () => {
    for (const seed of seeds) {
      for (const team of ['solo mech', 'solo elec', 'solo fin', 'nobody']) {
        expect(simulate(TEAMS[team], 26, seed).final.tier, `${team} seed ${seed}`).toBe(1);
      }
    }
  });
  it('every tier is reachable within 26 weeks of normal play', () => {
    const tiers = seeds.map((seed) => simulate(TEAMS['all average'], 26, seed).final.tier);
    expect(Math.max(...tiers)).toBe(5);
    expect(tiers.filter((t) => t >= 4).length).toBeGreaterThanOrEqual(seeds.length / 2);
  });
});

describe('multi-device seats', () => {
  it('a seat code links a second device (phone + computer) to the same seat', () => {
    let s = started();
    const key = s.players.mech!.seatKey!;
    expect(key).toMatch(/^[a-z2-9]{6}$/);
    expect(apply(s, { t: 'join', uid: 'laptop', name: 'Ana', role: 'mech', reclaim: true, key: 'nope00' }, NOW).error).toBeTruthy();
    s = apply(s, { t: 'join', uid: 'laptop', name: 'Ana', role: 'mech', reclaim: true, key }, NOW).s;
    expect(s.players.mech!.uid).toBe('a');
    expect(s.players.mech!.devices).toContain('laptop');
  });

  it('pass-and-play seats can be claimed online with progress intact', () => {
    let s = createIsland({ id: 'pp', name: 'PP', now: NOW, tz: 'UTC', seed: 1, creator: { uid: 'pp-mech', name: 'M', role: 'mech' } });
    s.players.mech!.xp = 900;
    s = apply(s, { t: 'join', uid: 'real-uid', name: 'Ana', role: 'mech' }, NOW).s;
    expect(s.players.mech!.uid).toBe('real-uid');
    expect(s.players.mech!.xp).toBe(900);
  });
});

describe('crew decisions', () => {
  it('safety calls: the A&P grounds a plane, only the trades can call it, and it flies nothing', () => {
    let s = started();
    expect(apply(s, { t: 'tag', role: 'fin', assetId: 'p1', on: true }, NOW).error).toBeTruthy();
    expect(apply(s, { t: 'tag', role: 'elec', assetId: 'p1', on: true }, NOW).error).toBeTruthy();
    s = apply(s, { t: 'tag', role: 'mech', assetId: 'p1', on: true }, NOW).s;
    s = apply(s, { t: 'tag', role: 'elec', assetId: 'h1', on: true }, NOW).s;
    for (const r of ['mech', 'elec', 'fin'] as Role[]) s = apply(s, { t: 'endTurn', role: r }, NOW).s;
    const rep = s.history[0];
    expect(rep.flightsFlown).toBe(0);
    expect(rep.housesBooked).toBe(0); // no guest flights, and cottage 1 red-tagged
    expect(s.tags).toEqual({}); // calls last one week
  });

  it('story cards are a crew vote: two of three decide', () => {
    let s = started();
    s.story = { id: 'surplus', week: s.week, title: 'Sale', body: '', options: [{ key: 'buy', label: 'Buy', effect: '' }, { key: 'pass', label: 'Pass', effect: '' }] };
    s = apply(s, { t: 'story', key: 'buy', role: 'fin' }, NOW).s;
    expect(s.story!.chosen).toBeUndefined();
    s = apply(s, { t: 'story', key: 'pass', role: 'mech' }, NOW).s;
    expect(s.story!.chosen).toBeUndefined();
    s = apply(s, { t: 'story', key: 'buy', role: 'elec' }, NOW).s;
    expect(s.story!.chosen).toBe('buy');
  });

  it('lend a hand: 40-59% is still a botch (the bar is a pass)', () => {
    let s = started();
    const o = s.orders.find((x) => x.role === 'mech' && x.status === 'ready')!;
    s.orders.find((x) => x.id === o.id)!.deferrals = 1;
    const r = apply(s, { t: 'complete', role: 'fin', orderId: o.id, score: 0.55, perfect: false, cover: true }, NOW);
    expect(r.error).toBeUndefined();
    s = r.s;
    expect(s.orders.find((x) => x.id === o.id)!.status).toBe('ready');
    expect(s.coversUsed.fin).toBe(1);
  });

  it('the load sheet is paperwork: ready at once, no health gain, expires weekly', () => {
    const s = started();
    const wb = s.orders.find((o) => o.kind === 'wb');
    expect(wb?.status).toBe('ready');
    const s2 = apply(s, { t: 'complete', role: 'mech', orderId: wb!.id, score: 1, perfect: true }, NOW).s;
    expect(s2.assets.find((a) => a.id === wb!.assetId)!.health).toBe(s.assets.find((a) => a.id === wb!.assetId)!.health);
  });
});

describe('crew projects', () => {
  it('qualifying opens one job per trade; the tier arrives when all three finish', () => {
    let s = started();
    s.stats.weeksBPlus = 4; // qualifies for tier 2
    s = apply(s, { t: 'resolve', week: s.week }, s.deadline! + 1).s;
    expect(s.tier).toBe(1);
    expect(s.project?.tier).toBe(2);
    const ids = s.project!.orders;
    // autopilot never does your part; lend a hand can't either
    s.orders.find((o) => o.id === ids.elec)!.deferrals = 1;
    expect(apply(s, { t: 'complete', role: 'mech', orderId: ids.elec!, score: 1, perfect: true, cover: true }, NOW).error).toMatch(/own part/);
    for (const r of ['mech', 'elec', 'fin'] as Role[]) s = apply(s, { t: 'complete', role: r, orderId: ids[r]!, score: 0.9, perfect: false }, NOW).s;
    expect(s.tier).toBe(2);
    expect(s.project).toBeNull();
    const cargo = s.assets.find((a) => a.model === 'cargo')!;
    expect(cargo.health).toBe(Math.round(60 + 30 * 0.9));
  });
});

describe('skill keeps paying above a pass', () => {
  it('credit rises all the way to a clean job', () => {
    expect(credit(0.6, 0)).toBeCloseTo(0.81);
    expect(credit(0.9, 0)).toBeGreaterThan(credit(0.7, 0));
    expect(credit(1, 0)).toBeCloseTo(1.05);
  });

  it('an owner under 40% is sent back for rework with a fresh fault', () => {
    const s = started();
    const o = s.orders.find((x) => x.role === 'mech' && x.status === 'ready' && x.assetId)!;
    const hp = s.assets.find((a) => a.id === o.assetId)!.health;
    const r = apply(s, { t: 'complete', role: 'mech', orderId: o.id, score: 0.3, perfect: false }, NOW);
    expect(r.error).toBeUndefined();
    const o2 = r.s.orders.find((x) => x.id === o.id)!;
    expect(o2.status).toBe('ready');
    expect(o2.seed).not.toBe(o.seed);
    expect(r.s.assets.find((a) => a.id === o.assetId)!.health).toBe(hp);
    // a 90% job restores more than a 65% one
    const hi = apply(s, { t: 'complete', role: 'mech', orderId: o.id, score: 0.9, perfect: false }, NOW).s;
    const lo = apply(s, { t: 'complete', role: 'mech', orderId: o.id, score: 0.65, perfect: false }, NOW).s;
    const h = (x: IslandState) => x.assets.find((a) => a.id === o.assetId)!.health;
    if (o.gain > 0 && hp < 90) expect(h(hi)).toBeGreaterThan(h(lo));
  });
});

describe('squawks: the trades write up what their assets need', () => {
  it('one write-up per trade per week, on its own assets, and it goes to the analyst', () => {
    let s = started();
    const plane = s.assets.find((a) => a.kind === 'plane')!;
    const house = s.assets.find((a) => a.kind === 'house')!;
    const open = new Set(s.orders.filter((o) => o.assetId === plane.id && o.status !== 'done').map((o) => o.kind));
    const kind = ['cylinder', 'alternator', 'corrosion', 'prop', 'tires'].find((k) => !open.has(k))!;
    expect(apply(s, { t: 'squawk', role: 'mech', assetId: house.id, kind }, NOW).error).toMatch(/doesn't apply/);
    expect(apply(s, { t: 'squawk', role: 'fin', assetId: plane.id, kind }, NOW).error).toMatch(/trades/);
    const r = apply(s, { t: 'squawk', role: 'mech', assetId: plane.id, kind }, NOW);
    expect(r.error).toBeUndefined();
    s = r.s;
    const o = s.orders[s.orders.length - 1];
    expect(o.squawk).toBe('Ana');
    expect(o.status).toBe('pending');
    expect(apply(s, { t: 'squawk', role: 'mech', assetId: plane.id, kind: 'tires' }, NOW).error).toMatch(/One write-up/);
  });
});
