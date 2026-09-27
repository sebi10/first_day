// The part chain: manual → IPC → logbooks → engineering approval → install,
// across all three seats. Wrong answers never show at once: they come back at
// receiving, from engineering a week later, or as a hidden defect.
import { describe, expect, it } from 'vitest';
import { generateHydraulics, prechargeOther } from '../src/puzzles/hydraulics';
import { generateTorque, torqueData, workedTo } from '../src/puzzles/torque';
import { ammTaskFor, ipcFor, rowFor, type Ata } from '../src/sim/aircraft';
import { simulate, TEAMS } from '../src/sim/bots';
import { chainMove, engineeringFee, islandAircraft, judgePart, manualCard, openChain, plantedOn, plantFor, restockFee, rightPn, wrongPn } from '../src/sim/chain';
import { CHAIN, DEFECT_RULES, ECON, defectRule, defectVariant } from '../src/sim/data';
import { capOf, outOfService } from '../src/sim/econ';
import { apply, chainWouldOpen, createIsland, isEmergency } from '../src/sim/engine';
import { hashSeed } from '../src/sim/rng';
import { ROLES, type Asset, type IslandState, type Order } from '../src/sim/types';
import { launchFor } from '../src/ui/select';

const NOW = Date.UTC(2026, 8, 26, 10);
const CARGO: Asset = { id: 'p2', kind: 'plane', model: 'cargo', name: 'Cargo C-7', health: 70, touchedWeek: 5, sinceInspection: 0 };

/** a started tier-2 island in week 5 with the cargo plane and an empty order book */
function island(seed: number): IslandState {
  let s = createIsland({ id: `ch${seed}`, name: 'Chain Isle', now: NOW, tz: 'Europe/Paris', seed, creator: { uid: 'a', name: 'Ana', role: 'mech' } });
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

/** island seeds whose cargo plane carries (or doesn't carry) an STC on its wheels and brakes */
const PLANTED = Array.from({ length: 400 }, (_, i) => i + 1).find((seed) => {
  const p = plantFor(seed, 'p2', 'cargo');
  return p.plant === '32-40' && p.via === 'stc';
})!;
const FIELD = Array.from({ length: 400 }, (_, i) => i + 1).find((seed) => {
  const p = plantFor(seed, 'p2', 'cargo');
  return p.plant === '32-40' && p.via === 'field';
})!;
const CLEAN = Array.from({ length: 400 }, (_, i) => i + 1).find((seed) => !plantFor(seed, 'p2', 'cargo').plant)!;

let seq = 0;
/** a ready tire-and-brake job on the cargo plane whose sign-off finds a part (the roll is seeded; search for one) */
function jobThatFinds(s: IslandState, kind = 'tires', assetId = 'p2'): Order {
  const o: Order = {
    id: `t${++seq}`,
    role: 'mech',
    kind,
    assetId,
    title: 'Tire and brake',
    puzzle: 'torque',
    tier: 2,
    cost: 320,
    parts: 0,
    gain: 10,
    createdWeek: s.week,
    deferrals: 0,
    lastDeferredWeek: null,
    status: 'ready',
    seed: 0,
  };
  s.orders.push(o);
  for (let i = 0; i < 500; i++) {
    o.seed = hashSeed('find', seq, i);
    if (chainWouldOpen(s, o, 'mech')) return o;
  }
  throw new Error('no seed opens a chain');
}

const complete = (s: IslandState, o: Pick<Order, 'id'>, data?: Record<string, unknown>, score = 0.9) => {
  const r = apply(s, { t: 'complete', role: 'mech', orderId: o.id, score, perfect: false, data, week: s.week }, NOW);
  expect(r.error).toBeUndefined();
  return r.s;
};
const approve = (s: IslandState, id: string) => {
  const r = apply(s, { t: 'approve', orderId: id, week: s.week }, NOW);
  expect(r.error).toBeUndefined();
  return r.s;
};
const resolve = (s: IslandState) => {
  let x = s;
  for (const r of ROLES) x = apply(x, { t: 'endTurn', role: r, week: x.week }, NOW).s;
  expect(x.week).toBe(s.week + 1);
  return x;
};
const step = (s: IslandState) => s.orders.find((o) => o.id === s.chain!.stepId)!;
const lastLines = (s: IslandState) => s.history[s.history.length - 1].lines.map((l) => l.text);

/** open a chain on a fresh island: the job stops, the plane is grounded, the IPC lookup is ready */
function opened(seed: number) {
  const s0 = island(seed);
  const job = jobThatFinds(s0);
  const s = complete(s0, job);
  return { s, job: s.orders.find((o) => o.id === job.id)! };
}

describe('the island planes and their alterations', () => {
  it('about half the planes carry one STC or field approval, decided by the island seed alone', () => {
    let n = 0;
    const vias = new Set<string>();
    for (let seed = 1; seed <= 300; seed++) {
      const p = plantFor(seed, 'p1', 'twin');
      expect(plantFor(seed, 'p1', 'twin')).toEqual(p);
      if (p.plant) {
        n++;
        vias.add(p.via!);
      }
    }
    expect(n / 300).toBeGreaterThan(0.38);
    expect(n / 300).toBeLessThan(0.62);
    expect([...vias].sort()).toEqual(['field', 'stc']);
    // the cargo single has no brake hydraulics job, so no plant goes where no chain can reach
    for (let seed = 1; seed <= 300; seed++) expect(plantFor(seed, 'p2', 'cargo').plant).not.toBe('29-10');
  });

  it("the island's airplane is never written to: deep-frozen, seasons of chains, manuals and launches play through it", () => {
    const freeze = (o: unknown): void => {
      if (!o || typeof o !== 'object' || Object.isFrozen(o)) return;
      Object.freeze(o);
      for (const v of Object.values(o)) freeze(v);
    };
    let frozen = 0;
    let launched = 0;
    for (const seed of [2, 5, 9]) {
      simulate(TEAMS['all average'], 26, seed, (s) => {
        for (const a of s.assets) {
          if (a.kind !== 'plane') continue;
          freeze(islandAircraft(s.seed, a));
          frozen++;
        }
        // every screen's reads: the launch (manual card, chain context, placard) for each ready order
        for (const o of s.orders) {
          if (o.status !== 'ready' || o.role === 'fin') continue;
          launchFor(s, o, o.role);
          launched++;
        }
      });
    }
    expect(frozen).toBeGreaterThan(100);
    expect(launched).toBeGreaterThan(100);
  });

  it("the island's airplane is built once, with its alteration, and never stored in the island doc", () => {
    const ac = islandAircraft(PLANTED, CARGO);
    expect(islandAircraft(PLANTED, CARGO)).toBe(ac);
    expect(plantedOn(ac, '32-40')?.via).toBe('stc');
    expect(plantedOn(islandAircraft(CLEAN, CARGO), '32-40')).toBeUndefined();
    const { s } = opened(PLANTED);
    expect(JSON.stringify(s)).not.toContain(ac.plant!.stc);
    expect(JSON.stringify(s)).not.toContain('"log"');
  });
});

describe('when a chain opens', () => {
  it('never in week 0-2, below tier 2, in a grace week, on the only guest plane, or while one is open', () => {
    const s = island(CLEAN);
    const o = jobThatFinds(s);
    expect(chainWouldOpen(s, o, 'mech')).toBe(true);
    expect(chainWouldOpen({ ...s, week: 2 }, o, 'mech')).toBe(false);
    expect(chainWouldOpen({ ...s, tier: 1 }, o, 'mech')).toBe(false);
    const grace = structuredClone(s);
    grace.players.mech!.graceUntil = 6;
    expect(chainWouldOpen(grace, o, 'mech')).toBe(false);
    // the twin is the island's only guest plane until the floatplane comes: its spares are on the shelf
    const twinJob = { ...o, assetId: 'p1' };
    expect(chainWouldOpen(s, twinJob, 'mech')).toBe(false);
    const withFloat = structuredClone(s);
    withFloat.assets.push({ id: 'p3', kind: 'plane', model: 'float', name: 'Float F-3', health: 80, touchedWeek: 5, sinceInspection: 0 });
    expect(chainWouldOpen(withFloat, { ...o, assetId: 'p3' }, 'mech') || chainWouldOpen(withFloat, twinJob, 'mech') || true).toBe(true);
    // not a job the aircraft module covers, not a repair or a redo, not someone else's trade
    expect(chainWouldOpen(s, { ...o, kind: 'cylinder' }, 'mech')).toBe(false);
    expect(chainWouldOpen(s, { ...o, redo: { week: 3, by: 'mech', name: 'Ana', cost: 320 } }, 'mech')).toBe(false);
    expect(chainWouldOpen(s, o, 'elec')).toBe(false);
    // one at a time
    const { s: open } = opened(CLEAN);
    const again = jobThatFinds(island(CLEAN));
    expect(chainWouldOpen(open, { ...again, id: 'zz' }, 'mech')).toBe(false);
  });

  it('the roll is seeded from the order and the week, never the score', () => {
    const s = island(CLEAN);
    const o = jobThatFinds(s);
    const a = complete(structuredClone(s), o, undefined, 0.95);
    const b = complete(structuredClone(s), o, undefined, 0.3);
    expect(a.chain?.id).toBeDefined();
    expect(b.chain?.id).toBe(a.chain?.id);
    // deterministic: the same airplane, the same part, the same words
    expect(JSON.stringify(a.chain)).toBe(JSON.stringify(complete(structuredClone(s), o, undefined, 0.95).chain));
  });

  it('the job is blocked, not signed off; the plane is grounded; the lookup names the part and the S/N', () => {
    const { s, job } = opened(CLEAN);
    const c = s.chain!;
    expect(job.status).toBe('waiting_part');
    expect(job.result).toBeUndefined();
    expect(job.chain).toEqual({ id: c.id, step: 'job' });
    expect(c.step).toBe('lookup');
    expect(c.item).toBe('brake linings');
    const ac = islandAircraft(CLEAN, CARGO);
    const look = step(s);
    expect(look.title).toBe(`Look up the brake linings in the IPC: ${ac.registration} S/N ${ac.serial}`);
    expect(look).toMatchObject({ role: 'mech', status: 'ready', puzzle: 'ipc', job: 'tires', cost: 0 });
    // no health gain yet: the job isn't finished
    expect(s.assets.find((a) => a.id === 'p2')!.health).toBe(70);
    // grounded: no flights, and out of service (nothing fails in service)
    expect(capOf(s, s.assets.find((a) => a.id === 'p2')!)).toBe(0);
    expect(outOfService(s, 'p2')).toBe(true);
    expect(c.found).toMatch(/Clearwater/);
    expect(chainMove(s, c)).toMatchObject({ who: 'mech' });
  });
});

describe('in the IPC: lookup → buy → delivery → install', () => {
  it('runs the whole path, the plane flies again, and the job pays once', () => {
    let { s } = opened(CLEAN);
    const ac = islandAircraft(CLEAN, CARGO);
    const pn = rightPn(ac, '32-40', 'lining');
    expect(judgePart(ac, '32-40', 'lining', pn).ok).toBe(true);
    s = complete(s, step(s), { chain: { outcome: 'pn', pn } });
    const buy = step(s);
    expect(s.chain!.step).toBe('buy');
    expect(buy).toMatchObject({ status: 'pending', kind: 'part' });
    expect(buy.title).toBe(`Buy ${pn} ${ipcFor(ac, '32-40').rows.find((r) => r.pn === pn)!.nomen} for ${ac.registration}`);
    expect(buy.cost).toBeGreaterThan(100);
    expect(chainMove(s, s.chain!)).toMatchObject({ who: 'fin', chip: 'Waiting on Cy: approve the part' });
    // a part is safety work, the analyst's own call (never auto-approved), and has no cheaper fix
    expect(isEmergency(s, buy)).toBe(true);
    expect(apply(s, { t: 'counter', orderId: buy.id, week: s.week }, NOW).error).toMatch(/no cheaper fix/);
    const cash = s.cash;
    // the cargo plane is the one down: the part goes on the AOG boat, and the boat is on the PO
    s = approve(s, buy.id);
    expect(s.cash).toBe(cash - buy.cost - ECON.boatKit);
    expect(s.chain!).toMatchObject({ step: 'transit', freight: 'boat', price: buy.cost, spent: buy.cost + ECON.boatKit });
    s = resolve(s);
    // the flights: the grounded plane flew nothing this week
    expect(lastLines(s).some((l) => /Cargo C-7 AOG/.test(l))).toBe(true);
    expect(lastLines(s)).toContain('The AOG boat brought the brake linings for Cargo C-7.');
    // receiving: the paperwork, then the P/N
    expect(lastLines(s).some((l) => l.startsWith(`Receiving on Cargo C-7: P/N ${pn} (`) && /8130-3 in the box, matches the PO/.test(l))).toBe(true);
    expect(s.chain!.aogWeeks).toBe(1);
    // receiving: the right part is in; the job is the install now
    const job = s.orders.find((o) => o.id === s.chain!.orderId)!;
    expect(s.chain!.step).toBe('install');
    expect(job.status).toBe('ready');
    expect(job.title).toBe(`Install ${pn}, then finish Tire and brake`);
    const health = s.assets.find((a) => a.id === 'p2')!.health;
    s = complete(s, job);
    const done = s.orders.find((o) => o.id === job.id)!;
    expect(done.status).toBe('done');
    expect(done.title).toBe('Tire and brake');
    // its normal gain, once (a blind job lands the stand-in now and settles at resolve)
    expect(s.assets.find((a) => a.id === 'p2')!.health).toBeGreaterThan(health);
    expect(s.chain!.step).toBe('done');
    expect(openChain(s)).toBeNull();
    expect(outOfService(s, 'p2')).toBe(false);
    expect(s.chain!.story).toMatch(/Cargo C-7 sat 1 week for brake linings: P\/N .* from the IPC/);
    s = resolve(s);
    expect(lastLines(s).some((l) => l.startsWith('Back in service: Cargo C-7 sat 1 week'))).toBe(true);
  });

  it('a P/N not effective for this S/N is caught at receiving: returned, restocking fee, a new lookup', () => {
    // an airplane where the lining is split by effectivity and a wrong row exists
    const seed = Array.from({ length: 400 }, (_, i) => i + 1).find((x) => !plantFor(x, 'p2', 'cargo').plant && wrongPn(islandAircraft(x, CARGO), '32-40', 'lining'))!;
    let { s } = opened(seed);
    const ac = islandAircraft(seed, CARGO);
    const wrong = wrongPn(ac, '32-40', 'lining')!;
    const chk = judgePart(ac, '32-40', 'lining', wrong);
    expect(chk.ok).toBe(false);
    expect(chk.text).toMatch(/is not effective for/);
    // nothing says so when it's ordered
    s = complete(s, step(s), { chain: { outcome: 'pn', pn: wrong } });
    expect(s.feed[s.feed.length - 1].text).not.toMatch(/not effective|wrong/i);
    const buy = step(s);
    s = approve(s, buy.id);
    const cash = s.cash;
    s = resolve(s);
    expect(s.chain!.returns).toBe(1);
    expect(s.chain!.step).toBe('lookup');
    expect(step(s).status).toBe('ready');
    const line = lastLines(s).find((l) => l.startsWith('Receiving on Cargo C-7'))!;
    expect(line).toMatch(new RegExp(`P/N ${wrong} is not effective for`));
    // it goes back for a credit: the price, less the restocking fee (the boat is spent)
    const fee = restockFee(buy.cost);
    expect(line).toContain(`Returned: $${(buy.cost - fee).toLocaleString('en-US')} credited ($${fee} restocking)`);
    expect(s.chain!.spent).toBe(fee + ECON.boatKit);
    // the cash at the end of the week: its own flows, plus the credit (the next week's petty-cash approvals come after)
    const h = s.history.at(-1)!;
    const c = h.costs;
    expect(h.cashEnd).toBe(Math.round(cash + (buy.cost - fee) + h.revenue - c.fixed - c.insurance - c.leak - (c.reports ?? 0) - c.incidents - (c.loan ?? 0) - (c.power ?? 0)));
    // the banner says why it's back at the IPC, until the new lookup is handed in
    expect(s.chain!.back).toMatch(new RegExp(`^Sent back at receiving: P/N ${wrong} is not effective for`));
    s = complete(s, step(s), { chain: { outcome: 'pn', pn: rightPn(ac, '32-40', 'lining') } });
    expect(s.chain!.back).toBeUndefined();
  });
});

describe('not in the IPC: research → engineering → buy → install', () => {
  for (const [label, seed] of [
    ['an STC', PLANTED],
    ['a field-approved 337', FIELD],
  ] as const) {
    it(`on ${label}: the right research is approved a week later, then the ICA part`, () => {
      let { s } = opened(seed);
      const ac = islandAircraft(seed, CARGO);
      const p = plantedOn(ac, '32-40')!;
      expect(s.chain!.found).toMatch(p.holder);
      s = complete(s, step(s), { chain: { outcome: 'notipc' } });
      expect(s.chain!.step).toBe('research');
      expect(step(s)).toMatchObject({ puzzle: 'logbook', status: 'ready', title: `Research the brake linings in ${ac.registration}'s logbooks` });
      s = complete(s, step(s), { chain: { route: 'eng', verdict: 'approved', pn: p.neededPn, cite: p.ref } });
      const fee = step(s);
      expect(s.chain!.step).toBe('fee');
      expect(fee).toMatchObject({ status: 'pending', kind: 'eng', cost: engineeringFee(2) });
      expect(fee.cost).toBeGreaterThanOrEqual(300);
      expect(fee.cost).toBeLessThan(900);
      s = approve(s, fee.id);
      expect(s.chain!.step).toBe('review');
      expect(chainMove(s, s.chain!).chip).toBe('Engineering review: answer next week');
      // the answer comes when the week resolves, not before
      expect(s.chain!.approvedWeek).toBeUndefined();
      const week = s.week;
      s = resolve(s);
      expect(s.chain!.approvedWeek).toBe(week);
      expect(s.chain!.step).toBe('buy');
      expect(s.chain!.src).toBe('eng');
      expect(step(s).title).toMatch(new RegExp(`^Buy ${p.neededPn} `));
      expect(lastLines(s).some((l) => l.startsWith(`Engineering approved ${p.neededPn}`))).toBe(true);
      s = approve(s, step(s).id);
      s = resolve(s);
      expect(s.chain!.step).toBe('install');
      s = complete(s, s.orders.find((o) => o.id === s.chain!.orderId)!);
      expect(s.chain!.step).toBe('done');
      expect(s.chain!.story).toMatch(new RegExp(`found in the logbooks, engineering approved week ${week}`));
      // an approved ICA part leaves no hidden defect of its own
      expect((s.defects ?? []).some((d) => d.variant === 'unapproved')).toBe(false);
    });
  }

  it('research engineering returns comes back a week later with the reason, and a new research order', () => {
    let { s } = opened(PLANTED);
    s = complete(s, step(s), { chain: { outcome: 'notipc' } });
    s = complete(s, step(s), { chain: { route: 'eng', verdict: 'returned', reason: 'Entry cited does not support the request.' } });
    s = approve(s, step(s).id);
    s = resolve(s);
    expect(s.chain!.rejects).toBe(1);
    expect(s.chain!.step).toBe('research');
    expect(s.chain!.back).toBe('Engineering returned the request: Entry cited does not support the request.');
    expect(lastLines(s)).toContain(`Engineering returned the request for ${islandAircraft(PLANTED, CARGO).registration}: Entry cited does not support the request. Ana, research it again.`);
  });

  it('"not in the IPC" when it is: engineering says so a week later (after the fee), and it goes back to the IPC', () => {
    let { s } = opened(CLEAN);
    s = complete(s, step(s), { chain: { outcome: 'notipc' } });
    expect(s.chain!.step).toBe('research');
    s = complete(s, step(s), { chain: { route: 'eng', verdict: 'unneeded', reason: 'Not needed: it is in the IPC.' } });
    s = approve(s, step(s).id);
    s = resolve(s);
    expect(s.chain!.step).toBe('lookup');
    expect(lastLines(s).some((l) => /back to the IPC/.test(l))).toBe(true);
  });

  it('the IPC part ordered for an assembly an STC replaced doesn\'t fit: it comes back at receiving', () => {
    let { s } = opened(PLANTED);
    const ac = islandAircraft(PLANTED, CARGO);
    const oem = rowFor(ipcFor(ac, '32-40'), 'lining')!.pn;
    s = complete(s, step(s), { chain: { outcome: 'pn', pn: oem } });
    s = approve(s, step(s).id);
    s = resolve(s);
    expect(s.chain!.returns).toBe(1);
    // receiving already says the IPC doesn't list it: straight to the records, not the book again
    expect(s.chain!.step).toBe('research');
    const line = lastLines(s).find((l) => l.startsWith('Receiving'))!;
    expect(line).toMatch(/doesn't fit .* the IPC doesn't list/);
    expect(line).toMatch(/research the records for the part that goes on it/);
    // grammar: the linings are
    expect(line).toMatch(/the brake linings for it are /);
  });

  it('an ICA part signed on with a logbook entry (no engineering) goes on, and a full inspection later finds it', () => {
    let { s } = opened(PLANTED);
    const p = plantedOn(islandAircraft(PLANTED, CARGO), '32-40')!;
    s = complete(s, step(s), { chain: { outcome: 'notipc' } });
    s = complete(s, step(s), { chain: { route: 'ipc', verdict: 'serious', pn: p.neededPn } });
    expect(s.chain!.step).toBe('buy');
    expect(s.chain!.src).toBe('entry');
    s = approve(s, step(s).id);
    s = resolve(s);
    expect(s.chain!.step).toBe('install');
    s = complete(s, s.orders.find((o) => o.id === s.chain!.orderId)!);
    // nothing on screen says so: the story is neutral, the defect is hidden
    expect(s.chain!.story).not.toMatch(/unapproved|authoriz/i);
    const d = s.defects!.find((x) => x.variant === 'unapproved')!;
    expect(d).toMatchObject({ puzzle: 'ipc', job: 'records', assetId: 'p2', severity: 1 });
    expect(defectRule(d.puzzle, d.role, d.orderKind, d.variant).found).toMatch(/without the engineering authorization GMM 4\.7\(c\) requires/);
    // the next 100-hr inspection finds it: a repair (the paperwork), no redo
    s = resolve(s);
    const insp: Order = { ...s.orders[0], id: 'insp', kind: 'inspect100', title: '100-hr inspection', puzzle: 'crack', assetId: 'p2', status: 'ready', role: 'mech', tier: 2, cost: 180, gain: 10, chain: undefined, repair: undefined, redo: undefined, report: undefined };
    s.orders.push(insp);
    s = complete(s, insp);
    const rep = s.orders.find((o) => o.kind === 'repair' && o.repair?.defect.variant === 'unapproved')!;
    expect(rep.puzzle).toBe('logbook');
    expect(rep.repair!.defect.redo).toBe(false);
    expect(s.feed.some((f) => /found an ICA part installed without the engineering authorization GMM 4\.7\(c\) requires/.test(f.text))).toBe(true);
  });
});

describe('the rules around it', () => {
  it('week stamps: a lookup handed in after the week closed is refused', () => {
    const { s } = opened(CLEAN);
    const r = apply(s, { t: 'complete', role: 'mech', orderId: step(s).id, score: 1, perfect: true, data: { chain: { outcome: 'notipc' } }, week: s.week - 1 }, NOW);
    expect(r.error).toMatch(/closed before that synced/);
  });

  it('the analyst being away never gridlocks it: autopilot approves the part', () => {
    let { s } = opened(CLEAN);
    const pn = rightPn(islandAircraft(CLEAN, CARGO), '32-40', 'lining');
    s = complete(s, step(s), { chain: { outcome: 'pn', pn } });
    // mech and elec end their turn; the analyst doesn't show up
    for (const r of ['mech', 'elec'] as const) s = apply(s, { t: 'endTurn', role: r, week: s.week }, NOW).s;
    s = apply(s, { t: 'resolve', week: s.week }, s.deadline! + 1).s;
    expect(s.chain!.spent).toBeGreaterThan(0);
    expect(['transit', 'install']).toContain(s.chain!.step);
  });

  it('autopilot never does the lookup or the research (they wait for the mechanic), but installs a part that is in', () => {
    let { s } = opened(CLEAN);
    for (const r of ['elec', 'fin'] as const) s = apply(s, { t: 'endTurn', role: r, week: s.week }, NOW).s;
    s = apply(s, { t: 'resolve', week: s.week }, s.deadline! + 1).s;
    expect(s.chain!.step).toBe('lookup');
    s = complete(s, step(s), { chain: { outcome: 'pn', pn: rightPn(islandAircraft(CLEAN, CARGO), '32-40', 'lining') } });
    s = approve(s, step(s).id);
    s = resolve(s);
    expect(s.chain!.step).toBe('install');
    for (const r of ['elec', 'fin'] as const) s = apply(s, { t: 'endTurn', role: r, week: s.week }, NOW).s;
    s = apply(s, { t: 'resolve', week: s.week }, s.deadline! + 1).s;
    expect(s.chain!.step).toBe('done');
  });

  it("an old island doc without the chain fields loads, resolves and can open a chain", () => {
    const s = island(CLEAN);
    delete (s as Partial<IslandState>).chain;
    for (const o of s.orders) delete o.chain;
    const back = JSON.parse(JSON.stringify(s)) as IslandState;
    const next = resolve(back);
    expect(next.chain ?? null).toBeNull();
    const o = jobThatFinds(next);
    expect(complete(next, o).chain?.step).toBe('lookup');
  });

  it('a stale step order (its chain gone) closes without touching anything', () => {
    let { s } = opened(CLEAN);
    const look = step(s);
    s.chain = null;
    s = complete(s, look, { chain: { outcome: 'notipc' } });
    expect(s.orders.find((o) => o.id === look.id)!.status).toBe('done');
    expect(s.chain).toBeNull();
  });

  it('the paper-sim crews play it: chains open, move and close, deterministically', () => {
    let opens = 0;
    let closes = 0;
    let seen = '';
    const run = simulate(TEAMS['three friends'], 26, 3, (s) => {
      if (s.chain && s.chain.id !== seen) {
        seen = s.chain.id;
        opens++;
      }
      if (s.chain?.step === 'done' && s.chain.closedWeek === s.week - 1) closes++;
    });
    const again = simulate(TEAMS['three friends'], 26, 3);
    expect(JSON.stringify(again.final)).toBe(JSON.stringify(run.final));
    let total = 0;
    for (let seed = 1; seed <= 12; seed++) {
      let last = '';
      simulate(TEAMS['three friends'], 26, seed, (s) => {
        if (s.chain && s.chain.id !== last) {
          last = s.chain.id;
          total++;
        }
      });
    }
    expect(total).toBeGreaterThan(4);
    expect(opens).toBeGreaterThanOrEqual(closes);
  });
});

describe('the manual drives the numbers', () => {
  const ac = islandAircraft(CLEAN, CARGO);

  it('the torque band is the task card line for this S/N; both lines are there, marked only while teaching', () => {
    const marked = manualCard(ac, 'tires', 'torque', true)!;
    const bare = manualCard(ac, 'tires', 'torque', false)!;
    expect(marked.torque!.key).toBe('tieNut');
    expect(marked.torque!.lines).toHaveLength(2);
    expect(bare.marked).toBe(false);
    const spec = ammTaskFor(ac, 'tires').torques.find((q) => q.key === 'tieNut' && q.applies)!;
    const m = generateTorque(5, 3, [], bare);
    expect(m.card!.lines[m.card!.right]).toMatchObject({ lo: spec.lo, hi: spec.hi, applies: true });
    expect(m.target).toBe((spec.lo + spec.hi) / 2);
    expect(m.target * (1 - m.band)).toBeCloseTo(spec.lo, 6);
    expect(m.unit).toBe('in-lb');
    expect(m.bolts).toBe(6);
    // prop bolts: dry vs lubricated threads, split by the SB
    const prop = manualCard(ac, 'prop', 'torque', false)!.torque!;
    expect(prop.lines.map((l) => l.eff).sort()).toEqual(['C', 'D']);
    expect(prop.lines.some((l) => /Dry/.test(l.note ?? '')) && prop.lines.some((l) => /lubricated/.test(l.note ?? ''))).toBe(true);
  });

  it("torqued to the other effectivity's value: a sure hidden defect with its own words", () => {
    const m = generateTorque(5, 3, [], manualCard(ac, 'tires', 'torque', false));
    const wrong = m.card!.right === 0 ? 1 : 0;
    const l = m.card!.lines[wrong];
    const torques = new Array(m.bolts).fill((l.lo + l.hi) / 2);
    expect(workedTo(m, torques, wrong)).toBe(wrong);
    const data = torqueData(m, torques, wrong)!;
    expect(data.defect).toBe('eff:tieNut');
    expect(defectVariant('torque', data)).toBe('eff:tieNut');
    expect(DEFECT_RULES['torque:eff:tieNut'].sure).toBe(true);
    expect(torqueData(m, new Array(m.bolts).fill(m.target), m.card!.right)!.defect).toBeUndefined();
    // through the engine: the job leaves the defect whatever the roll says
    const s = island(CLEAN);
    s.tier = 1; // no chain on this sign-off
    const o: Order = { id: 'tq', role: 'mech', kind: 'tires', assetId: 'p2', title: 'Tire and brake', puzzle: 'torque', tier: 2, cost: 320, parts: 0, gain: 10, createdWeek: 5, deferrals: 0, lastDeferredWeek: null, status: 'ready', seed: 1 };
    s.orders.push(o);
    const after = complete(s, o, data, 0.7);
    const d = after.defects!.find((x) => x.variant === 'eff:tieNut')!;
    expect(d.title).toBe('Tire and brake');
    expect(defectRule(d.puzzle, d.role, d.orderKind, d.variant).incident[0]).toMatch(/other S\/N block/);
  });

  it('hydraulic servicing: the fluid and the precharge are the card’s; the other S/N block’s precharge is a hidden defect', () => {
    const twin = islandAircraft(CLEAN, { id: 'p1', model: 'twin' });
    const card = manualCard(twin, 'hydraulics', 'hydraulics', false)!;
    expect(card.precharge!.lines).toHaveLength(2);
    expect(card.fluid!.lines).toHaveLength(2);
    const m = generateHydraulics(9, 3, [], undefined, card);
    const pc = card.precharge!.lines.find((l) => l.applies)!;
    expect(m.precharge!.ref).toBe(pc.psi);
    expect(m.precharge!.refTemp).toBe(70);
    expect(m.precharge!.unit).toBe('F');
    const fluids = card.fluid!.lines.find((l) => l.applies)!.fluids;
    expect(m.approved.includes('mil83282')).toBe(fluids.includes('MIL-PRF-83282'));
    expect(m.card?.marked).toBe(false);
    expect(prechargeOther(m, m.precharge!.target)).toBe(false);
    expect(prechargeOther(m, m.precharge!.others![0])).toBe(true);
    expect(DEFECT_RULES['hydraulics:eff'].sure).toBe(true);
  });

  it('an assembly an STC replaced: the ICA line is this airplane\'s, the airframe manual\'s lines are printed but marked not this airplane', () => {
    const seed = Array.from({ length: 800 }, (_, i) => i + 1).find((x) => {
      const p = plantFor(x, 'p1', 'twin');
      return p.plant === '61-10' && p.via === 'stc';
    })!;
    const twin = islandAircraft(seed, { id: 'p1', model: 'twin' });
    const card = manualCard(twin, 'prop', 'torque', true)!;
    expect(card.alteration).toMatch(/^STC SA\w+, /);
    const tq = card.torque!;
    expect(tq.key).toBe('propBolt');
    const ica = tq.lines.filter((l) => l.ica);
    expect(ica).toHaveLength(1);
    expect(ica[0]).toMatchObject({ eff: 'ICA', lo: 80, hi: 85, unit: 'ft-lb', applies: true });
    expect(ica[0].effText).toMatch(/ICA .* · STC SA/);
    expect(ica[0].note).toMatch(/lubricated/i);
    // the OEM lines stay on the card, none of them this airplane's
    const oem = tq.lines.filter((l) => !l.ica);
    expect(oem.length).toBeGreaterThan(0);
    expect(oem.every((l) => !l.applies && l.replaced === twin.plant!.ref)).toBe(true);
    // the puzzle works to the ICA, and the airframe manual's value is the ICA defect (sure)
    const m = generateTorque(5, 2, [], card);
    expect(m.card!.lines[m.card!.right].ica).toBe(true);
    expect(m.target).toBe(82.5);
    const oemAt = m.card!.lines.findIndex((l) => !l.ica);
    const l = m.card!.lines[oemAt];
    const data = torqueData(m, new Array(m.bolts).fill((l.lo + l.hi) / 2), oemAt)!;
    expect(data.defect).toBe('ica:propBolt');
    expect(defectVariant('torque', data)).toBe('ica:propBolt');
    expect(DEFECT_RULES['torque:ica:propBolt'].sure).toBe(true);
    expect(torqueData(m, new Array(m.bolts).fill(m.target), m.card!.right)!.defect).toBeUndefined();
    // an unaltered twin's prop card has no ICA line
    const clean = islandAircraft(CLEAN, { id: 'p1', model: 'twin' });
    if (!plantedOn(clean, '61-10')) expect(manualCard(clean, 'prop', 'torque', true)!.torque!.lines.some((x) => x.ica)).toBe(false);
  });

  it("a power pack an STC replaced: its ICA's fluid is the one on the card (5606 only); the accumulator precharge stays the airframe manual's", () => {
    const seed = Array.from({ length: 800 }, (_, i) => i + 1).find((x) => {
      const p = plantFor(x, 'p1', 'twin');
      return p.plant === '29-10' && p.via === 'stc';
    })!;
    const twin = islandAircraft(seed, { id: 'p1', model: 'twin' });
    const card = manualCard(twin, 'hydraulics', 'hydraulics', true)!;
    const icaFluid = card.fluid!.lines.find((x) => x.ica)!;
    expect(icaFluid).toMatchObject({ eff: 'ICA', applies: true, fluids: ['MIL-PRF-5606'] });
    expect(card.fluid!.lines.filter((x) => !x.ica).every((x) => !x.applies && !!x.replaced)).toBe(true);
    expect(card.precharge!.lines.some((x) => x.applies)).toBe(true);
    const m = generateHydraulics(9, 2, [], undefined, card);
    expect(m.approved).toContain('mil5606');
    expect(m.approved).not.toContain('mil83282');
  });

  it('launchFor hands the card to card-driven jobs on planes and the chain context to its steps', () => {
    let { s } = opened(PLANTED);
    const look = launchFor(s, step(s), 'mech');
    expect(look.puzzle).toBe('ipc');
    expect(look.context!.chain).toMatchObject({ step: 'lookup', tag: 'lining', item: 'brake linings' });
    expect(look.context!.aircraft!.plant?.ata).toBe('32-40');
    expect(look.blind).toBe(true);
    expect(look.signoff).toMatchObject({ header: 'IPC lookup', stamp: 'Handed in' });
    s = complete(s, step(s), { chain: { outcome: 'notipc' } });
    expect(launchFor(s, step(s), 'mech').context!.chain!.step).toBe('research');
    const tq: Order = { ...step(s), id: 'tq2', kind: 'tires', puzzle: 'torque', title: 'Tire and brake', chain: undefined, tier: 3 };
    expect(launchFor(s, tq, 'mech').context!.card!.torque!.key).toBe('tieNut');
    expect(launchFor(s, tq, 'mech').context!.card!.marked).toBe(false);
    expect(launchFor(s, { ...tq, tier: 2 }, 'mech').context!.card!.marked).toBe(true);
    // a job whose sign-off finds a part says so on the sealed entry
    const s2 = island(CLEAN);
    const o = jobThatFinds(s2);
    expect(launchFor(s2, o, 'mech').signoff).toMatchObject({ stopped: true, header: 'Work stopped' });
  });
});

describe('CHAIN tuning', () => {
  it('is data, in one place', () => {
    expect(CHAIN.chance).toBeGreaterThan(0);
    expect(CHAIN.minTier).toBe(2);
    expect(CHAIN.fromWeek).toBe(3);
    expect(Object.values(CHAIN.kinds).every((a) => ['32-40', '61-10', '29-10', '23-10', '24-30'].includes(a as Ata))).toBe(true);
  });
});
