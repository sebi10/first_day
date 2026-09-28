// The job flow on the reducer (docs/JOBFLOW.md 7, 8): every move's checks and
// words, the week stamps, the no-gridlock rules, the work budget, reservations,
// the install check, sign-off and the card the analyst approves.
import { describe, expect, it, vi } from 'vitest';
import { findingOf, raiseAlert, symptomText, SYMPTOMS } from '../src/sim/alerts';
import { ALERTS, ECON, FREIGHT, STOCK } from '../src/sim/data';
import { alertAog, hazardOn, houseBlocker, rentFactor, SUB_FEE, subCharterOn } from '../src/sim/econ';
import { simulate, TEAMS } from '../src/sim/bots';
import { apply, createIsland } from '../src/sim/engine';
import { cardOf, fixTaskFor, flowStage, installCheck, planTask, stdPickFor } from '../src/sim/flow';
import { ITEMS, itemById } from '../src/sim/items';
import { committed } from '../src/sim/ledger';
import { addStarter, available, binsInUse, binsTotal, onHand, reservedFor } from '../src/sim/stock';
import { ROLES, type Action, type Alert, type Asset, type IslandState, type Order, type PickLine, type Role } from '../src/sim/types';

vi.setConfig({ testTimeout: 30000 });

const NOW = Date.UTC(2026, 8, 26, 10);
/** the cargo plane's propeller assembly ($8,400) */
const PROP = 'BHC-B3TN-3D/T10282NS';
const CARGO: Asset = { id: 'p2', kind: 'plane', model: 'cargo', name: 'Cargo C-7', health: 70, touchedWeek: 5, sinceInspection: 0 };

/** a started tier-2 island in week 5: the twin, the cargo plane, two cottages and the grid, the starter shelf, no work open */
function island(seed = 42): IslandState {
  let s = createIsland({ id: `fl${seed}`, name: 'Flow Isle', now: NOW, tz: 'Europe/Paris', seed, creator: { uid: 'a', name: 'Ana', role: 'mech' } });
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

// every move at its own time: the standing approvals read the order moves came in
let clock = NOW;
function ok(s: IslandState, a: Action): IslandState {
  const r = apply(s, a, ++clock);
  expect(r.error, JSON.stringify(a)).toBeUndefined();
  return r.s;
}
const no = (s: IslandState, a: Action) => apply(s, a, ++clock).error;

/** an alert raised on the island (a symptom and its hidden cause) */
function raise(s: IslandState, sym: string, cause: number, assetId: string, due?: number): Alert {
  const asset = s.assets.find((a) => a.id === assetId)!;
  return raiseAlert(s, { role: SYMPTOMS[sym].role, asset, sym, cause, ...(due !== undefined ? { due } : {}) }, clock);
}

/** plan an alert: the task that fixes it and the right pick, unless told otherwise */
function plan(s: IslandState, al: Alert, pick?: PickLine[], taskId?: string): { s: IslandState; o: Order } {
  const task = taskId ? planTask(s, al, taskId)! : fixTaskFor(s, al)!;
  const next = ok(s, { t: 'plan', role: al.role, alert: al.id, task: task.id, pick: pick ?? stdPickFor(s, al, task), week: s.week });
  return { s: next, o: next.orders.find((o) => o.flow?.alert === al.id && o.status !== 'cancelled')! };
}
const orderOf = (s: IslandState, id: string) => s.orders.find((o) => o.id === id)!;
const alertOf = (s: IslandState, id: string) => s.alerts!.find((a) => a.id === id)!;

/** everyone ends the turn (in this order): the week resolves */
function endWeek(s: IslandState, order: Role[] = ['mech', 'elec', 'fin']): IslandState {
  for (const r of order) if (!s.turns[r]?.ended) s = ok(s, { t: 'endTurn', role: r, week: s.week });
  return s;
}
const signOff = (s: IslandState, o: Order, score = 0.9) => ok(s, { t: 'complete', role: o.role, orderId: o.id, score, perfect: false, week: s.week });
const reviewSays = (s: IslandState, week: number, re: RegExp) => s.history.find((h) => h.week === week)!.lines.some((l) => re.test(l.text));

describe('the moves and their words', () => {
  it('plan: an open alert of your trade, a task in the manual set that does the work, a pick of your trade', () => {
    let s = island();
    const al = raise(s, 'M_BRAKE_CHATTER', 0, 'p1');
    const task = fixTaskFor(s, al)!;
    const pick = stdPickFor(s, al, task);
    const at = (over: Partial<Extract<Action, { t: 'plan' }>>): Action => ({ t: 'plan', role: 'mech', alert: al.id, task: task.id, pick, week: s.week, ...over });
    expect(no(s, at({ alert: 'a9999' }))).toBe('That alert is not open.');
    expect(no(s, at({ role: 'elec' }))).toBe('Not your trade.');
    expect(no(s, at({ task: 'amm:cargo:32-40-02' }))).toBe("That task isn't in the manual set for Twin N-12.");
    expect(no(s, at({ task: 'amm:twin:12-10-01' }))).toBe("That's reference only: pick the task that does the work.");
    expect(no(s, at({ pick: [{ item: 'NOPE-1', qty: 1 }] }))).toBe('Unknown item NOPE-1.');
    expect(no(s, at({ pick: [{ item: 'KR15-TR', qty: 1 }] }))).toBe("KR15-TR isn't a mechanic's part.");
    expect(no(s, at({ pick: [{ item: 'T-TW-IN', qty: 1 }] }))).toBe("T-TW-IN isn't a mechanic's part.");
    expect(no(s, at({ pick: [{ ...pick[0], qty: 0 }] }))).toBe(`Quantities are 1 to ${STOCK.maxQty}.`);
    expect(no(s, at({ pick: Array.from({ length: 11 }, () => ({ ...pick[0], qty: 1 })) }))).toBe('A pick is 10 lines at most.');
    expect(no(s, at({ week: 4 }))).toMatch(/^Week 4 closed before that synced; autopilot covered what was left\. You're in week 5 now\.$/);
    s = ok(s, at({}));
    expect(no(s, at({}))).toBe('That alert is not open.');
    // research is for a part in the IPC: not the electrician's
    const el = raise(s, 'E_WARM_OUTLET', 0, 'h1');
    const et = fixTaskFor(s, el)!;
    expect(no(s, { t: 'plan', role: 'elec', alert: el.id, task: et.id, pick: stdPickFor(s, el, et), research: true, week: s.week })).toBe('Research is for a part in the IPC.');
    // a pre-filled job carries its line
    const cyl = raise(s, 'M_OIL_IRON', 0, 'p1');
    expect(no(s, { t: 'plan', role: 'mech', alert: cyl.id, task: 'amm:twin:72-30-01', pick: [{ item: 'MIL-PRF-907', qty: 1 }], week: s.week })).toBe('That job carries its pre-filled line.');
  });

  it('nff, mel, melExtend, makeSafe and askBench say why not', () => {
    let s = island();
    const due = raise(s, 'M_INSP_DUE', 0, 'p1');
    const chatter = raise(s, 'M_BRAKE_CHATTER', 0, 'p1');
    const com = raise(s, 'M_COM_DEAD', 0, 'p2');
    const warm = raise(s, 'E_WARM_OUTLET', 0, 'h1');
    const flicker = raise(s, 'E_FLICKER', 0, 'h2');
    const w = s.week;
    expect(no(s, { t: 'nff', role: 'mech', alert: due.id, week: w })).toBe("There's a known task for this one.");
    expect(no(s, { t: 'nff', role: 'elec', alert: chatter.id, week: w })).toBe('Not your trade.');
    expect(no(s, { t: 'mel', role: 'mech', alert: chatter.id, week: w })).toBe('No MEL relief for that on Twin N-12.');
    expect(no(s, { t: 'mel', role: 'mech', alert: warm.id, week: w })).toBe('Not your trade.');
    expect(no(s, { t: 'melExtend', alert: com.id, week: w })).toBe('That item is not placarded.');
    s = ok(s, { t: 'mel', role: 'mech', alert: com.id, week: w });
    expect(alertOf(s, com.id).mel).toMatchObject({ until: w });
    expect(no(s, { t: 'mel', role: 'mech', alert: com.id, week: w })).toBe('It is already placarded.');
    expect(no(s, { t: 'makeSafe', role: 'elec', alert: flicker.id, how: 'breaker', week: w })).toBe('Nothing there to make safe.');
    expect(no(s, { t: 'makeSafe', role: 'mech' as 'elec', alert: warm.id, how: 'breaker', week: w })).toBe('Not your trade.');
    s = ok(s, { t: 'makeSafe', role: 'elec', alert: warm.id, how: 'breaker', week: w });
    expect(no(s, { t: 'makeSafe', role: 'elec', alert: warm.id, how: 'blankoff', week: w })).toBe('It is already made safe.');
    expect(no(s, { t: 'askBench', role: 'mech', alert: chatter.id, week: w })).toBe('Nothing on that one for the electrician to meter.');
    s = ok(s, { t: 'askBench', role: 'mech', alert: com.id, week: w });
    const bench = s.orders.find((o) => o.bench === com.id)!;
    expect(bench).toMatchObject({ role: 'elec', kind: 'bench', puzzle: 'meter', status: 'ready' });
    expect(no(s, { t: 'askBench', role: 'mech', alert: com.id, week: w })).toBe('The check is already asked for.');
    expect(no(s, { t: 'nudge', alert: 'a9999', week: w })).toBe('That alert is not open.');
    s = ok(s, { t: 'nudge', alert: chatter.id, week: w });
    expect(no(s, { t: 'nudge', alert: chatter.id, week: w })).toBe('Already nudged this week.');
  });

  it('repick, dropJob, request, cancelReq, approveReq and deferReq say why not', () => {
    let s = island();
    const belt = raise(s, 'M_BELT_SQUEAL', 0, 'p1');
    const r = plan(s, belt);
    s = r.s;
    const w = s.week;
    expect(no(s, { t: 'repick', role: 'mech', order: 'o9999', pick: [], week: w })).toBe('That job is not open.');
    expect(no(s, { t: 'repick', role: 'elec', order: r.o.id, pick: [], week: w })).toBe('Not your trade.');
    expect(no(s, { t: 'repick', role: 'mech', order: r.o.id, pick: [{ item: 'KR15-TR', qty: 1 }], week: w })).toBe("KR15-TR isn't a mechanic's part.");
    expect(no(s, { t: 'dropJob', role: 'elec', order: r.o.id, week: w })).toBe('Not your trade.');
    expect(no(s, { t: 'request', role: 'mech', item: 'NOPE-1', qty: 1, week: w })).toBe('Unknown item NOPE-1.');
    expect(no(s, { t: 'request', role: 'mech', item: 'KR15-TR', qty: 1, week: w })).toBe('Not your trade.');
    expect(no(s, { t: 'request', role: 'mech', item: 'AN900-10', qty: 51, week: w })).toBe('Ask for 1 to 50.');
    expect(no(s, { t: 'request', role: 'mech', item: 'T-N2', qty: 2, week: w })).toBe('One of a tool.');
    s = ok(s, { t: 'request', role: 'mech', item: 'AN900-10', qty: 10, why: 'crush gaskets for the oil changes', week: w });
    const req = s.reqs!.find((q) => q.item === 'AN900-10')!;
    expect(req).toMatchObject({ status: 'open', role: 'mech', qty: 10, week: w });
    expect(no(s, { t: 'cancelReq', role: 'elec', req: req.id, week: w })).toBe('Only who asked, or the analyst.');
    s = ok(s, { t: 'deferReq', req: req.id, week: w });
    expect(no(s, { t: 'deferReq', req: req.id, week: w })).toBe('Already deferred this week.');
    s = ok(s, { t: 'approveReq', reqs: [req.id], week: w });
    expect(s.reqs!.find((q) => q.id === req.id)).toMatchObject({ status: 'ordered' });
    expect(no(s, { t: 'approveReq', reqs: [req.id], week: w })).toBe('That request is no longer waiting.');
    expect(no(s, { t: 'cancelReq', role: 'mech', req: req.id, week: w })).toBe('That request is not open.');
    // cash: the request's cost against what's spendable
    // a propeller assembly for the cargo plane: more than the island can spare
    s = ok(s, { t: 'request', role: 'mech', item: PROP, qty: 1, week: w });
    const dear = s.reqs!.find((q) => q.item === PROP)!;
    s.cash = committed(s) + 100;
    expect(no(s, { t: 'approveReq', reqs: [dear.id], week: w })).toMatch(/^Spendable cash under \$2,000: only safety-critical work can be approved\.$/);
    s.cash = committed(s) + ECON.freezeBelow + 100;
    expect(no(s, { t: 'approveReq', reqs: [dear.id], week: w })).toBe('Not enough cash.');
    // the job is dropped: its alert is open again
    s.cash = 20000;
    s = ok(s, { t: 'dropJob', role: 'mech', order: r.o.id, week: w });
    expect(orderOf(s, r.o.id).status).toBe('cancelled');
    expect(alertOf(s, belt.id)).toMatchObject({ status: 'open' });
    expect(no(s, { t: 'dropJob', role: 'mech', order: r.o.id, week: w })).toBe('That job is not open.');
  });

  it('buy, setStock and scrap: the lines, the cash and the bins', () => {
    let s = island();
    const w = s.week;
    const line = (item: string, qty = 1) => ({ item, qty });
    expect(no(s, { t: 'buy', lines: [], week: w })).toBe(`A buy is 1 to ${STOCK.maxLines} lines.`);
    expect(no(s, { t: 'buy', lines: Array.from({ length: STOCK.maxLines + 1 }, () => line('AN900-10')), week: w })).toBe(`A buy is 1 to ${STOCK.maxLines} lines.`);
    expect(no(s, { t: 'buy', lines: [line('NOPE-1')], week: w })).toBe('Unknown item NOPE-1.');
    expect(no(s, { t: 'buy', lines: [line('AN900-10', 0)], week: w })).toBe(`Buy 1 to ${STOCK.maxQty} of an item.`);
    s.cash = committed(s) + 100;
    expect(no(s, { t: 'buy', lines: [line('AN900-10')], week: w })).toBe('Spendable cash under $2,000: stock orders are frozen.');
    s.cash = committed(s) + ECON.freezeBelow + 10;
    expect(no(s, { t: 'buy', lines: [line(PROP)], week: w })).toBe('Not enough cash.');
    s.cash = 20000;
    expect(no(s, { t: 'setStock', item: 'T-N2', rop: 0, max: 1, week: w })).toBe('Tools and building materials take no min/max.');
    expect(no(s, { t: 'setStock', item: 'BLD-FTG', rop: 0, max: 1, week: w })).toBe('Tools and building materials take no min/max.');
    expect(no(s, { t: 'setStock', item: 'AN900-10', rop: null, max: 10, week: w })).toBe('Set both, or clear both.');
    expect(no(s, { t: 'setStock', item: 'AN900-10', rop: 10, max: 10, week: w })).toBe(`The min is 0 or more, under the max, and the max ${STOCK.maxQty} or less.`);
    s = ok(s, { t: 'setStock', item: 'AN900-10', rop: 8, max: 30, week: w });
    expect(s.inv!['AN900-10']).toMatchObject({ rop: 8, max: 30 });
    expect(no(s, { t: 'scrap', item: 'AN900-10', qty: onHand(s, 'AN900-10') + 1, week: w })).toBe(`Only ${available(s, 'AN900-10')} free to scrap.`);
    // the stores room fills up: a new line needs a bin, a line that has one doesn't
    const fresh = ITEMS.filter((x) => x.trade === 'mech' && x.kind === 'consumable' && !s.inv![x.id]).map((x) => x.id);
    let i = 0;
    while (binsInUse(s) < binsTotal(s)) s.inv![`${fresh[i++]}`] = { on: 1 };
    const unbinned = fresh[i];
    expect(unbinned).toBeTruthy();
    expect(no(s, { t: 'buy', lines: [line(unbinned)], week: w })).toBe(`Stores full: ${binsTotal(s)} of ${binsTotal(s)} bins. Use up, scrap or return a line first.`);
    expect(no(s, { t: 'setStock', item: unbinned, rop: 1, max: 2, week: w })).toBe(`Stores full: ${binsTotal(s)} of ${binsTotal(s)} bins. Use up, scrap or return a line first.`);
    s = ok(s, { t: 'buy', lines: [line('AN900-10', 25)], week: w });
    // scrapping a line frees its bin
    s = ok(s, { t: 'scrap', item: fresh[0], qty: 1, week: w });
    s = ok(s, { t: 'buy', lines: [line(unbinned)], week: w });
  });

  it('the week stamps: a move from a week that closed is refused', () => {
    const s = island();
    const al = raise(s, 'M_BRAKE_CHATTER', 0, 'p1');
    const moves: Action[] = [
      { t: 'nff', role: 'mech', alert: al.id, week: 4 },
      { t: 'mel', role: 'mech', alert: al.id, week: 4 },
      { t: 'melExtend', alert: al.id, week: 4 },
      { t: 'makeSafe', role: 'elec', alert: al.id, how: 'breaker', week: 4 },
      { t: 'askBench', role: 'mech', alert: al.id, week: 4 },
      { t: 'repick', role: 'mech', order: 'x', pick: [], week: 4 },
      { t: 'dropJob', role: 'mech', order: 'x', week: 4 },
      { t: 'request', role: 'mech', item: 'AN900-10', qty: 1, week: 4 },
      { t: 'cancelReq', role: 'mech', req: 'x', week: 4 },
      { t: 'approveReq', reqs: ['x'], week: 4 },
      { t: 'deferReq', req: 'x', week: 4 },
      { t: 'buy', lines: [{ item: 'AN900-10', qty: 1 }], week: 4 },
      { t: 'setStock', item: 'AN900-10', rop: 1, max: 5, week: 4 },
      { t: 'scrap', item: 'AN900-10', qty: 1, week: 4 },
      { t: 'nudge', alert: al.id, week: 4 },
      { t: 'approve', orderId: 'x', week: 4 },
    ];
    for (const m of moves) expect(no(s, m), m.t).toMatch(/^Week 4 closed before that synced/);
  });

  it('a turn once ended: the techs’ moves wait for next week, the analyst’s approvals never do', () => {
    let s = island();
    const al = raise(s, 'M_BELT_SQUEAL', 0, 'p1');
    const warm = raise(s, 'E_WARM_OUTLET', 0, 'h1');
    // the analyst plays first and ends the turn: the card and the request come in after
    s = ok(s, { t: 'endTurn', role: 'fin', week: 5 });
    const r = plan(s, al);
    s = ok(r.s, { t: 'request', role: 'mech', item: 'AN900-10', qty: 5, week: 5 });
    const req = s.reqs!.find((q) => q.status === 'open')!;
    s = ok(s, { t: 'approve', orderId: r.o.id, week: 5 });
    s = ok(s, { t: 'approveReq', reqs: [req.id], week: 5 });
    expect(orderOf(s, r.o.id).status).toBe('waiting_part');
    s = ok(s, { t: 'endTurn', role: 'mech', week: 5 });
    const over = 'Your turn is over for this week.';
    expect(no(s, { t: 'repick', role: 'mech', order: r.o.id, pick: r.o.flow!.pick, week: 5 })).toBe(over);
    expect(no(s, { t: 'dropJob', role: 'mech', order: r.o.id, week: 5 })).toBe(over);
    expect(no(s, { t: 'request', role: 'mech', item: 'AN900-10', qty: 1, week: 5 })).toBe(over);
    expect(no(s, { t: 'nff', role: 'mech', alert: al.id, week: 5 })).toBe(over);
    // the electrician still plays
    s = ok(s, { t: 'makeSafe', role: 'elec', alert: warm.id, how: 'breaker', week: 5 });
    const task = fixTaskFor(s, warm)!;
    s = ok(s, { t: 'endTurn', role: 'elec', week: 5 });
    expect(s.week).toBe(6);
    const late = apply(s, { t: 'plan', role: 'elec', alert: warm.id, task: task.id, pick: stdPickFor(s, warm, task), week: 5 }, ++clock).error;
    expect(late).toMatch(/^Week 5 closed before that synced/);
  });

  it('the staff moves check their own rules (tests/staff.test.ts); kits and counter-offers are gone from the flow', () => {
    let s = island();
    expect(no(s, { t: 'hire', cand: 'x', week: 5 })).toBe('That candidate took another job.');
    expect(no(s, { t: 'letGo', npc: 'n999', week: 5 })).toBe('They have already left.');
    expect(no(s, { t: 'build', what: 'cottage', week: 5 })).toBe('Extra cottages open at tier 3.');
    expect(no(s, { t: 'buyList', week: 5 })).toBe('Parts kits are gone: buy real items from the stock planner.');
    const r = plan(s, raise(s, 'M_BELT_SQUEAL', 0, 'p1'));
    s = r.s;
    expect(no(s, { t: 'counter', orderId: r.o.id, week: 5 })).toBe('MEL, make-safe or a cheaper pick is the cheaper fix: approve or defer.');
    s = ok(s, { t: 'setStanding', amount: 1234 });
    expect(s.standing).toBe(1250);
    s = ok(s, { t: 'setStanding', amount: 99999 });
    expect(s.standing).toBe(5000);
  });

  it('a squawk is an alert with its task filled in, one a week, never a second of the same job', () => {
    let s = island();
    s = ok(s, { t: 'squawk', role: 'mech', assetId: 'p2', kind: 'tires', week: 5 });
    const a = s.alerts!.find((x) => x.sym === 'W_tires')!;
    expect(a).toMatchObject({ role: 'mech', assetId: 'p2', src: 'finding', status: 'open', due: 7 });
    expect(a.task).toBeTruthy();
    expect(s.orders.filter((o) => o.kind === 'tires')).toHaveLength(0);
    expect(no(s, { t: 'squawk', role: 'mech', assetId: 'p1', kind: 'tires', week: 5 })).toBe('One write-up per week.');
    s.squawked = {};
    expect(no(s, { t: 'squawk', role: 'mech', assetId: 'p2', kind: 'tires', week: 5 })).toBe('That job is already open.');
    expect(no(s, { t: 'squawk', role: 'fin', assetId: 'p2', kind: 'tires', week: 5 })).toBe('Only the trades write up squawks.');
  });
});

/** keep only these alerts (the week open raises new ones; a test watches its own) */
const only = (s: IslandState, ...ids: string[]) => {
  s.alerts = s.alerts!.filter((a) => ids.includes(a.id));
  return s;
};

describe('no gridlock (0.2 rule 8)', () => {
  for (const order of [
    ['mech', 'elec', 'fin'],
    ['fin', 'mech', 'elec'],
  ] as Role[][]) {
    it(`a stocked airworthiness alert due now is fixed the week it comes up (${order[0] === 'fin' ? 'the analyst plays first' : 'the mechanic plays first'})`, () => {
      let s = island();
      const al = raise(s, 'M_SAFETY_WIRE', 0, 'p2');
      expect(al.due).toBe(5);
      if (order[0] === 'fin') s = ok(s, { t: 'endTurn', role: 'fin', week: 5 });
      const r = plan(s, al);
      s = r.s;
      // on the shelf: the mechanic's own work budget approves it
      expect(orderOf(s, r.o.id)).toMatchObject({ status: 'ready', autoApproved: true });
      s = signOff(s, orderOf(s, r.o.id));
      expect(alertOf(s, al.id).status).toBe('closed');
      s = endWeek(s, order);
      expect(s.week).toBe(6);
      expect(reviewSays(s, 5, /Cargo C-7 AOG/)).toBe(false);
      expect(s.ledger!.find((l) => l.w === 5)?.aog).toBeUndefined();
    });
  }

  for (const analystFirst of [true, false]) {
    it(`a lead-1 part planned in week W lands at W's resolve and the job is done in W+1 (${analystFirst ? 'on the standing approval' : 'the analyst approves the card'})`, () => {
      let s = island();
      const al = raise(s, 'M_WHEEL_CORROSION', 0, 'p2', 6);
      expect(flowStage(s, al)).toBe('new');
      if (analystFirst) s = ok(s, { t: 'endTurn', role: 'fin', week: 5 });
      const r = plan(s, al);
      s = r.s;
      const card = cardOf(s, orderOf(s, r.o.id));
      expect(orderOf(s, r.o.id).status).toBe('pending');
      expect(flowStage(s, alertOf(s, al.id))).toBe('approval');
      expect(card.toBuy.length).toBeGreaterThan(0);
      expect(card.toBuy.every((l) => l.eta === 5)).toBe(true);
      expect(card.freight).toMatchObject({ pick: 'sched', sched: { eta: 5 } });
      if (!analystFirst) {
        s = ok(s, { t: 'approve', orderId: r.o.id, week: 5 });
        expect(orderOf(s, r.o.id).status).toBe('waiting_part');
        expect(flowStage(s, alertOf(s, al.id))).toBe('parts');
        expect(committed(s)).toBeGreaterThan(0);
      }
      s = only(endWeek(s), al.id);
      expect(s.week).toBe(6);
      if (analystFirst) expect(reviewSays(s, 5, /had ended the turn when .*card for Wheel-half corrosion and penetrant on Cargo C-7 came in: it went through on the standing approval \(\$[\d,]+, next flight, here tonight\)/)).toBe(true);
      expect(orderOf(s, r.o.id).status).toBe('ready');
      expect(flowStage(s, alertOf(s, al.id))).toBe('ready');
      s = signOff(s, orderOf(s, r.o.id));
      expect(flowStage(s, alertOf(s, al.id))).toBe('closed');
      s = endWeek(s);
      expect(reviewSays(s, 5, /Cargo C-7 AOG/)).toBe(false);
      expect(reviewSays(s, 6, /Cargo C-7 AOG/)).toBe(false);
      // paid at the payment run after it landed (net 7)
      const pos = s.pos!.filter((p) => p.lines.some((l) => l.order === r.o.id));
      expect(pos.length).toBeGreaterThan(0);
      expect(pos.every((p) => p.status === 'paid' && p.got === 5 && p.paid === 6)).toBe(true);
    });
  }

  it('the standing approval stops at its limit and at the freeze; the rest waits for the analyst', () => {
    let s = island();
    s = ok(s, { t: 'setStanding', amount: 0 });
    s = ok(s, { t: 'endTurn', role: 'fin', week: 5 });
    const al = raise(s, 'M_WHEEL_CORROSION', 0, 'p2', 7);
    const r = plan(s, al);
    s = only(endWeek(r.s), al.id);
    expect(orderOf(s, r.o.id).status).toBe('pending');
    expect(reviewSays(s, 5, /standing approval/)).toBe(false);
    // the board says why it waits (the tech was told it might go through tonight)
    expect(reviewSays(s, 5, /^.+ had ended the turn when .+'s card for Wheel-half corrosion and penetrant on Cargo C-7 came in \(\$[\d,]+\): over the standing limit \(\$0 left\), so it waits for .+\.$/)).toBe(true);
  });
});

describe('the standing approval and safety work (8.5)', () => {
  it('a late card for safety work due this week or next goes through tonight whatever the limit, and the board says why', () => {
    let s = island();
    s = ok(s, { t: 'setStanding', amount: 0 });
    s = ok(s, { t: 'endTurn', role: 'fin', week: 5 });
    // the cargo plane's wheel halves, due next week: it grounds the plane at week 6's resolve
    const al = raise(s, 'M_WHEEL_CORROSION', 0, 'p2', 6);
    const r = plan(s, al);
    s = r.s;
    expect(orderOf(s, r.o.id).status).toBe('pending');
    const total = cardOf(s, orderOf(s, r.o.id)).total;
    expect(total).toBeGreaterThan(0);
    s = only(endWeek(s), al.id);
    expect(orderOf(s, r.o.id).status).not.toBe('pending');
    expect(reviewSays(s, 5, /went through on the standing approval \(\$[\d,]+.*\): safety work due this week or next goes through whatever the limit\.$/)).toBe(true);
    // the same card with the fix due in three weeks waits (the other test: over the limit)
    let t = island();
    t = ok(t, { t: 'setStanding', amount: 0 });
    t = ok(t, { t: 'endTurn', role: 'fin', week: 5 });
    const later = raise(t, 'M_WHEEL_CORROSION', 0, 'p2', 8);
    const rl = plan(t, later);
    t = only(endWeek(rl.s), later.id);
    expect(orderOf(t, rl.o.id).status).toBe('pending');
  });

  it('safety work still needs the cash: under $0 spendable it waits, and the board says so', () => {
    let s = island();
    s = ok(s, { t: 'endTurn', role: 'fin', week: 5 });
    const al = raise(s, 'M_WHEEL_CORROSION', 0, 'p2', 6);
    const r = plan(s, al);
    s = r.s;
    s.cash = committed(s) + 5;
    s = only(endWeek(s), al.id);
    expect(orderOf(s, r.o.id).status).toBe('pending');
    expect(reviewSays(s, 5, /there isn’t the cash for it, so it waits for Cy\.$/)).toBe(true);
  });
});

describe('dropping a job (8.9)', () => {
  it('a job never started gives its labour back: dropping a wrong task to plan the right one doesn’t pay twice', () => {
    let s = island();
    const belt = raise(s, 'M_BELT_SQUEAL', 0, 'p1');
    s.inv!['HA-B38'] = { on: 2 };
    const cash0 = s.cash;
    const spent0 = s.autoSpent.mech ?? 0;
    const r = plan(s, belt);
    s = r.s;
    const o = orderOf(s, r.o.id);
    expect(o).toMatchObject({ status: 'ready', autoApproved: true });
    expect(s.cash).toBe(cash0 - o.cost);
    s = ok(s, { t: 'dropJob', role: 'mech', order: o.id, week: 5 });
    expect(s.cash).toBe(cash0);
    expect(s.autoSpent.mech ?? 0).toBe(spent0);
    expect(s.feed.some((f) => f.text.includes(`(the $${o.cost} of labour comes back: it was never started)`))).toBe(true);
    const row = s.ledger!.find((l) => l.w === 5)!;
    expect(row.sp.labor ?? 0).toBe(0);
    // planned again: labour paid once in all
    const again = plan(s, alertOf(s, belt.id));
    s = again.s;
    expect(s.cash).toBe(cash0 - orderOf(s, again.o.id).cost);
    // a started job keeps it: its sign-off is in
    s = signOff(s, orderOf(s, again.o.id));
    expect(no(s, { t: 'dropJob', role: 'mech', order: again.o.id, week: 5 })).toBe('That job is not open.');
  });
});

describe('requests (9.3)', () => {
  it('a repeat request for the same line folds into the open one; a trade keeps at most 12 open', () => {
    let s = island();
    s = ok(s, { t: 'request', role: 'mech', item: 'AN900-10', qty: 10, week: 5 });
    s = ok(s, { t: 'request', role: 'mech', item: 'AN900-10', qty: 5, why: 'the oil changes', week: 5 });
    const open = s.reqs!.filter((r) => r.status === 'open' && r.item === 'AN900-10');
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ qty: 15, why: 'the oil changes' });
    s = ok(s, { t: 'request', role: 'mech', item: 'T-N2', qty: 1, week: 5 });
    expect(no(s, { t: 'request', role: 'mech', item: 'T-N2', qty: 1, week: 5 })).toBe('Already asked: Cy decides on it.');
    const items = ITEMS.filter((x) => x.trade === 'mech' && x.kind === 'consumable' && x.id !== 'AN900-10').map((x) => x.id);
    let i = 0;
    while (s.reqs!.filter((r) => r.status === 'open' && !r.order && r.role === 'mech').length < STOCK.maxReqs) s = ok(s, { t: 'request', role: 'mech', item: items[i++], qty: 1, week: 5 });
    expect(no(s, { t: 'request', role: 'mech', item: items[i], qty: 1, week: 5 })).toBe(`${STOCK.maxReqs} requests are already waiting on Cy: cancel one, or wait for the desk.`);
    // the electrician's are their own
    s = ok(s, { t: 'request', role: 'elec', item: 'KR20-TR', qty: 10, week: 5 });
    expect(STOCK.maxReqs).toBe(12);
  });

  it('a standalone request takes a bin like any stock buy; a late one skipped by the standing approval says why', () => {
    let s = island();
    const fresh = ITEMS.filter((x) => x.trade === 'mech' && x.kind === 'consumable' && !s.inv![x.id]).map((x) => x.id);
    s = ok(s, { t: 'request', role: 'mech', item: fresh[0], qty: 1, week: 5 });
    const req = s.reqs!.find((r) => r.item === fresh[0])!;
    let i = 1;
    while (binsInUse(s) < binsTotal(s)) s.inv![fresh[i++]] = { on: 1 };
    expect(no(s, { t: 'approveReq', reqs: [req.id], week: 5 })).toMatch(/^Stores full: /);
    // after the analyst's turn: over the limit, it waits with a review line
    let t = island();
    t = ok(t, { t: 'setStanding', amount: 0 });
    t = ok(t, { t: 'endTurn', role: 'fin', week: 5 });
    t = ok(t, { t: 'request', role: 'mech', item: 'AN900-10', qty: 10, week: 5 });
    t = endWeek(t);
    expect(t.reqs!.find((r) => r.item === 'AN900-10')!.status).toBe('open');
    expect(reviewSays(t, 5, /request for 10 × AN900-10 came in \(\$[\d,]+\): over the standing limit \(\$0 left\), so it waits for Cy\.$/)).toBe(true);
  });
});

describe('the work budget (8.4)', () => {
  it('in stock and inside the budget: approved at once at every tier; over it: a labour-only card; safety work runs past it', () => {
    for (let tier = 1; tier <= 5; tier++) {
      let s = island();
      s.tier = tier;
      s.autoBudget.mech = 3000;
      const chatter = raise(s, 'M_BRAKE_CHATTER', 0, 'p1');
      let r = plan(s, chatter);
      s = r.s;
      const o1 = orderOf(s, r.o.id);
      expect(o1, `tier ${tier}`).toMatchObject({ status: 'ready', autoApproved: true, approvedWeek: 5 });
      expect(s.autoSpent.mech).toBe(o1.cost);
      // the budget is spent: the oil change (all on the shelf) waits for the analyst as labour only
      s.autoSpent.mech = s.autoBudget.mech - 10;
      const oil = raise(s, 'M_OIL_DUE', 0, 'p1');
      r = plan(s, oil);
      s = r.s;
      const o2 = orderOf(s, r.o.id);
      expect(o2.status, `tier ${tier}`).toBe('pending');
      const card = cardOf(s, o2);
      expect(card.toBuy).toHaveLength(0);
      expect(card.tools).toHaveLength(0);
      expect(card.total).toBe(o2.cost);
      expect(card.budget).toEqual({ trade: 'mech', spent: s.autoBudget.mech - 10, of: s.autoBudget.mech });
      // a soft brake pedal, due now: airworthiness, approved past the budget (and counted against it)
      const soft = raise(s, 'M_BRAKE_SOFT', 0, 'p1', 5);
      r = plan(s, soft);
      s = r.s;
      const o3 = orderOf(s, r.o.id);
      expect(o3.status, `tier ${tier}`).toBe('ready');
      expect(s.autoSpent.mech).toBe(s.autoBudget.mech - 10 + o3.cost);
      expect(s.autoSpent.mech).toBeGreaterThan(s.autoBudget.mech);
    }
  });

  it('safety work still needs the cash: spendable stays above zero (other work: above the freeze)', () => {
    let s = island();
    const soft = raise(s, 'M_BRAKE_SOFT', 0, 'p1', 5);
    s.cash = 10;
    const r = plan(s, soft);
    expect(orderOf(r.s, r.o.id).status).toBe('pending');
    s = island();
    const chatter = raise(s, 'M_BRAKE_CHATTER', 0, 'p1');
    s.cash = ECON.freezeBelow + 50;
    expect(orderOf(plan(s, chatter).s, plan(s, chatter).o.id).status).toBe('pending');
  });
});

describe('reservations (9.2, 9.3)', () => {
  it('first come, first served; a safety plan takes a card’s soft reservation; drop and repick release', () => {
    let s = island();
    s.autoSpent.mech = s.autoBudget.mech;
    const chat = raise(s, 'M_BRAKE_CHATTER', 0, 'p1');
    const task = fixTaskFor(s, chat)!;
    const lining = stdPickFor(s, chat, task).find((l) => itemById(l.item)?.slot === 'lining')!.item;
    expect(onHand(s, lining)).toBe(4);
    // over the budget: a pending card, its linings reserved softly
    const r1 = plan(s, chat);
    s = r1.s;
    expect(orderOf(s, r1.o.id).status).toBe('pending');
    expect(reservedFor(s, r1.o.id, lining)).toBe(4);
    expect(available(s, lining)).toBe(0);
    expect(cardOf(s, orderOf(s, r1.o.id)).fromStock.find((l) => l.item === lining)?.qty).toBe(4);
    // the next card finds none free: its linings are to buy
    const chat2 = raise(s, 'M_BRAKE_CHATTER', 0, 'p1');
    const r2 = plan(s, chat2);
    s = r2.s;
    expect(reservedFor(s, r2.o.id, lining)).toBe(0);
    expect(cardOf(s, orderOf(s, r2.o.id)).toBuy.find((l) => l.item === lining)?.qty).toBe(4);
    // a soft brake pedal due now takes the first card's linings; that card's go back on its list to buy
    const soft = raise(s, 'M_BRAKE_SOFT', 1, 'p1', 5);
    const r3 = plan(s, soft);
    s = r3.s;
    expect(orderOf(s, r3.o.id).status).toBe('ready');
    expect(reservedFor(s, r3.o.id, lining)).toBe(4);
    expect(reservedFor(s, r1.o.id, lining)).toBe(0);
    expect(cardOf(s, orderOf(s, r1.o.id)).toBuy.find((l) => l.item === lining)?.qty).toBe(4);
    // dropped: the linings go to the oldest card waiting for them
    s = ok(s, { t: 'dropJob', role: 'mech', order: r3.o.id, week: 5 });
    expect(reservedFor(s, r3.o.id, lining)).toBe(0);
    expect(reservedFor(s, r1.o.id, lining)).toBe(4);
    expect(alertOf(s, soft.id).status).toBe('open');
    // repicked with the near-miss beside them on the shelf: the effective linings are free for the next card
    const near = Object.keys(s.inv!).find((id) => id !== lining && itemById(id)?.slot === 'lining' && itemById(id)?.models?.includes('twin') && onHand(s, id) > 0)!;
    expect(near).toBeTruthy();
    const pick = orderOf(s, r1.o.id).flow!.pick.map((l) => (l.item === lining ? { ...l, item: near } : l));
    s = ok(s, { t: 'repick', role: 'mech', order: r1.o.id, pick, week: 5 });
    expect(reservedFor(s, r1.o.id, lining)).toBe(0);
    expect(reservedFor(s, r1.o.id, near)).toBe(4);
    expect(reservedFor(s, r2.o.id, lining)).toBe(4);
  });
});

describe('the install check and sign-off (8.7)', () => {
  const swap = (pick: PickLine[], from: string, to: string, qty?: number) => pick.map((l) => (l.item === from ? { ...l, item: to, qty: qty ?? l.qty } : l));

  it('stops a part this airplane doesn’t take, a short slot, an empty slot the cause needs and a missing tool; the result is dropped', () => {
    // the cargo plane's linings on the twin
    let s = island();
    const soft = raise(s, 'M_BRAKE_SOFT', 1, 'p1', 5);
    const std = stdPickFor(s, soft, fixTaskFor(s, soft)!);
    const lining = std.find((l) => itemById(l.item)?.slot === 'lining')!.item;
    const cargoLining = Object.keys(s.inv!).find((id) => itemById(id)?.slot === 'lining' && itemById(id)?.models?.includes('cargo') && !itemById(id)?.models?.includes('twin'))!;
    let r = plan(s, soft, swap(std, lining, cargoLining));
    s = r.s;
    expect(orderOf(s, r.o.id).status).toBe('ready');
    const onBefore = onHand(s, cargoLining);
    s = signOff(s, orderOf(s, r.o.id));
    let o = orderOf(s, r.o.id);
    expect(o.status).toBe('waiting_part');
    expect(o.result).toBeUndefined();
    expect(o.flow!.stop).toMatch(new RegExp(`^${cargoLining} isn't the .* this airplane takes: check the IPC for S/N `));
    expect(onHand(s, cargoLining)).toBe(onBefore);
    expect(reservedFor(s, o.id, cargoLining)).toBe(4);
    expect(alertOf(s, soft.id).status).toBe('job');
    expect(s.feed.some((f) => /^Work stopped at the install on Twin N-12: /.test(f.text))).toBe(true);
    expect(no(s, { t: 'complete', role: 'mech', orderId: o.id, score: 0.9, perfect: false, week: 5 })).toBe('That order is not ready.');
    // the repick with the right linings: ready again, and it signs off
    s = ok(s, { t: 'repick', role: 'mech', order: o.id, pick: std, week: 5 });
    o = orderOf(s, o.id);
    expect(o.status).toBe('ready');
    expect(o.flow!.stop).toBeUndefined();
    s = signOff(s, o);
    expect(orderOf(s, o.id).status).toBe('done');

    // two linings short
    s = island();
    const soft2 = raise(s, 'M_BRAKE_SOFT', 1, 'p1', 5);
    r = plan(s, soft2, swap(std, lining, lining, 2));
    s = signOff(r.s, orderOf(r.s, r.o.id));
    expect(orderOf(s, r.o.id).flow!.stop).toMatch(/^Two .* short: the AMM does both brakes\.$/);

    // a worn tire, and only a tube picked
    s = island();
    const worn = raise(s, 'M_TIRE_WORN', 0, 'p1', 5);
    const tstd = stdPickFor(s, worn, fixTaskFor(s, worn)!);
    const tire = tstd.find((l) => itemById(l.item)?.slot === 'tire')!.item;
    r = plan(s, worn, tstd.filter((l) => l.item !== tire));
    s = signOff(r.s, orderOf(r.s, r.o.id));
    expect(orderOf(s, r.o.id).flow!.stop).toBe('Tread 2/32 in at the shoulder, no cords: this job replaces the tire, and none was picked.');

    // the analyst sent the nitrogen kit back before the accumulator job started
    s = island();
    s.inv!['T-N2'] = { on: 1 };
    s.inv!['MS28775-228'] = { on: 2 };
    const acc = raise(s, 'M_ACCUM', 0, 'p1', 5);
    r = plan(s, acc);
    s = r.s;
    expect(orderOf(s, r.o.id).status).toBe('ready');
    s = ok(s, { t: 'scrap', item: 'T-N2', qty: 1, week: 5 });
    s = signOff(s, orderOf(s, r.o.id));
    expect(orderOf(s, r.o.id).flow!.stop).toBe(`${itemById('T-N2')!.nomen} isn't in the shop: the job waits for it.`);
    expect(installCheck(s, orderOf(s, r.o.id))).not.toBeNull();
  });

  it('a sign-off takes what was pulled out of stock and closes the alert; a rework takes nothing', () => {
    let s = island();
    s.tier = 1; // a teaching job: not blind, so a failed check is a rework
    const al = raise(s, 'M_BRAKE_CHATTER', 0, 'p1');
    const r = plan(s, al);
    s = r.s;
    const lining = r.o.flow!.pick.find((l) => itemById(l.item)?.slot === 'lining')!.item;
    const before = onHand(s, lining);
    s = signOff(s, orderOf(s, r.o.id), 0.2);
    expect(orderOf(s, r.o.id).status).toBe('ready');
    expect(onHand(s, lining)).toBe(before);
    expect(reservedFor(s, r.o.id, lining)).toBe(4);
    s = signOff(s, orderOf(s, r.o.id), 0.9);
    expect(orderOf(s, r.o.id).status).toBe('done');
    expect(onHand(s, lining)).toBe(before - 4);
    expect(reservedFor(s, r.o.id, lining)).toBe(0);
    expect(alertOf(s, al.id)).toMatchObject({ status: 'closed', closed: { week: 5, how: 'fixed' } });
    expect(s.ledger!.find((l) => l.w === 5)!.use![lining]).toBe(4);
  });
});

describe('the card (8.6)', () => {
  it('adds up the labour, the lines to buy, the tools and the freight', () => {
    let s = island();
    const belt = raise(s, 'M_BELT_SQUEAL', 0, 'p1');
    let r = plan(s, belt);
    s = r.s;
    let o = orderOf(s, r.o.id);
    let c = cardOf(s, o);
    const beltItem = itemById('HA-B38')!;
    expect(c.labour).toBe(o.cost);
    expect(c.toBuy).toEqual([{ item: 'HA-B38', qty: 1, unit: beltItem.price, supplier: 'oem', eta: 5 }]);
    expect(c.freight.pick).toBe('sched');
    // scheduled freight is per shipment (3.6): the week's first mech PO from the OEM pays its own
    expect(c.freight.sched).toMatchObject({ cost: FREIGHT.sched.mech });
    expect(c.total).toBe(Math.round(o.cost + beltItem.price + FREIGHT.sched.mech));
    expect(c.aog).toBe(false);
    // a tool is capex on the card
    const acc = raise(s, 'M_ACCUM', 0, 'p1');
    r = plan(s, acc);
    s = r.s;
    c = cardOf(s, orderOf(s, r.o.id));
    expect(c.tools).toEqual([{ item: 'T-N2', price: itemById('T-N2')!.price }]);
    expect(c.total).toBe(Math.round(c.labour + c.toBuy.reduce((n, l) => n + l.qty * l.unit, 0) + itemById('T-N2')!.price + c.freight.sched.cost));
  });

  it('the default freight: scheduled, unless the AOG boat saves more downtime than it costs', () => {
    let s = island();
    // the only guest plane's wheel halves, due now, with a new wheel (a two-week part) on the pick: it's grounded until the fix
    // (its guests on the mainland sub-charter)
    const corr = raise(s, 'M_WHEEL_CORROSION', 0, 'p1', 5);
    const std = stdPickFor(s, corr, fixTaskFor(s, corr)!);
    const wheel = ['40-190A', '40-190B', '40-220A', '40-220B', '40-120A', '40-120B'].find((id) => itemById(id)?.models?.includes('twin'))!;
    expect(itemById(wheel)!.lead).toBe(2);
    const r = plan(s, corr, [...std, { item: wheel, qty: 1 }]);
    s = r.s;
    const o = orderOf(s, r.o.id);
    const c = cardOf(s, o);
    expect(c.aog).toBe(true);
    expect(c.sub).toEqual({ flights: 2, fee: SUB_FEE, usd: 2 * SUB_FEE });
    // the wheel rides any flight, the bulk consumables the cargo flight: two shipments, as placePo splits them
    expect(c.freight.sched).toEqual({ eta: 6, outWeeks: 2, cost: 2 * FREIGHT.sched.mech, shipments: 2 });
    expect(c.freight.aog).toEqual({ eta: 5, outWeeks: 1, cost: FREIGHT.aog });
    expect(c.downtime!.usd).toBeGreaterThan(FREIGHT.aog);
    expect(c.freight.pick).toBe('aog');
    const buy = c.toBuy.reduce((n, l) => n + l.qty * l.unit, 0);
    // the boat replaces the scheduled shipment's charge
    expect(c.total).toBe(Math.round(o.cost + buy + FREIGHT.aog));
    expect(cardOf(s, o, { freight: 'sched' }).total).toBe(Math.round(o.cost + buy + 2 * FREIGHT.sched.mech));
    // approved on the boat: every line lands at this week's resolve
    s = ok(s, { t: 'approve', orderId: o.id, week: 5 });
    const pos = s.pos!.filter((p) => p.lines.some((l) => l.order === o.id));
    expect(pos.length).toBeGreaterThan(0);
    expect(pos.every((p) => p.eta === 5 && p.freight === 'aog')).toBe(true);
    // the cargo plane carries no guests: a week of it down costs the bulk POs it holds, so the boat isn't the default there
    s = island();
    const cc = raise(s, 'M_WHEEL_CORROSION', 0, 'p2', 5);
    const cwheel = ['40-190A', '40-190B', '40-220A', '40-220B', '40-120A', '40-120B'].find((id) => itemById(id)?.models?.includes('cargo'))!;
    const rc = plan(s, cc, [...stdPickFor(s, cc, fixTaskFor(s, cc)!), { item: cwheel, qty: 1 }]);
    const ccard = cardOf(rc.s, orderOf(rc.s, rc.o.id));
    expect(ccard.aog).toBe(true);
    expect(ccard.freight.pick).toBe('sched');
  });

});

describe('MEL, make safe and the only guest plane (10)', () => {
  it('an MEL C placard covers the week it goes on; the one extension covers the next; past it the plane is grounded', () => {
    let s = island();
    const com = raise(s, 'M_COM_DEAD', 0, 'p2');
    expect(alertAog(s, 'p2')?.id).toBe(com.id);
    s = ok(s, { t: 'mel', role: 'mech', alert: com.id, week: 5 });
    expect(alertAog(s, 'p2')).toBeUndefined();
    s = only(endWeek(s), com.id);
    // it flew on the placard: the board says so, and nothing grounded it
    expect(reviewSays(s, 5, /AOG|grounded until|cancelled/)).toBe(false);
    expect(reviewSays(s, 5, /^Cargo C-7 flew with .+ placarded INOP \(MEL C, to week 5\)\. Fix it by then, or it is grounded\.$/)).toBe(true);
    // the extension is the maintenance side's call: the mechanic asks, the analyst approves the cost and downtime
    expect(no(s, { t: 'melExtend', role: 'fin', alert: com.id, week: 6 })).toBe("Ana asks for the extension first (the maintenance side's call).");
    expect(no(s, { t: 'melExtend', role: 'elec', alert: com.id, week: 6 })).toBe('Not your call.');
    s = ok(s, { t: 'melExtend', role: 'mech', alert: com.id, week: 6 });
    expect(alertOf(s, com.id).mel).toMatchObject({ until: 5, ask: { week: 6, by: 'Ana' } });
    expect(no(s, { t: 'melExtend', role: 'mech', alert: com.id, week: 6 })).toBe('Already asked: Cy approves it.');
    s = ok(s, { t: 'melExtend', role: 'fin', alert: com.id, week: 6 });
    expect(alertOf(s, com.id).mel).toMatchObject({ until: 6, ext: true });
    expect(s.feed.some((f) => /^Cy approved Ana's MEL C extension on Cargo C-7 for .+: it flies on the placard to week 6\.$/.test(f.text))).toBe(true);
    expect(no(s, { t: 'melExtend', role: 'mech', alert: com.id, week: 6 })).toBe('The MEL allows one extension.');
    s = only(endWeek(s), com.id);
    expect(reviewSays(s, 6, /Cargo C-7 AOG|ran out/)).toBe(false);
    expect(reviewSays(s, 6, /\(MEL C, to week 6, extended\)/)).toBe(true);
    s = only(endWeek(s), com.id);
    expect(reviewSays(s, 7, /^Cargo C-7's MEL C for .+ ran out in week 6: grounded until it's fixed \(\d flights? cancelled\)\.$/)).toBe(true);
    expect(s.ledger!.find((l) => l.w === 7)?.aog).toEqual({ plan: 1 });
  });

  it('the extension comes the week after the placard at the latest', () => {
    let s = island();
    const com = raise(s, 'M_COM_DEAD', 0, 'p2');
    s = ok(s, { t: 'mel', role: 'mech', alert: com.id, week: 5 });
    s = only(endWeek(s), com.id);
    s = only(endWeek(s), com.id);
    expect(s.week).toBe(7);
    expect(no(s, { t: 'melExtend', role: 'mech', alert: com.id, week: 7 })).toBe('That placard has run out.');
  });

  it('a placard put on early covers the item through its due week: it is not spent before it is needed', () => {
    let s = island();
    // com 1 dead on the cargo plane, due next week (written up early)
    const com = raise(s, 'M_COM_DEAD', 0, 'p2', 6);
    s = ok(s, { t: 'mel', role: 'mech', alert: com.id, week: 5 });
    expect(alertOf(s, com.id).mel).toMatchObject({ until: 6 });
    s = only(endWeek(s), com.id);
    s = only(endWeek(s), com.id);
    // week 6's resolve: still on the placard, nothing grounded
    expect(reviewSays(s, 6, /Cargo C-7 AOG|ran out/)).toBe(false);
    // no MEL relief on the tires: the placard move says so
    const tire = raise(s, 'M_TIRE_PRESSURE', 0, 'p1');
    expect(no(s, { t: 'mel', role: 'mech', alert: tire.id, week: s.week })).toMatch(/^No MEL relief for that on /);
  });

  it('a hazard closes its house until it is made safe (then it rents at 75%) or fixed', () => {
    let s = island();
    const h1 = s.assets.find((a) => a.id === 'h1')!;
    const warm = raise(s, 'E_WARM_OUTLET', 0, 'h1');
    expect(hazardOn(s, 'h1')?.id).toBe(warm.id);
    expect(houseBlocker(s, h1)).toBe('hazard');
    s = only(endWeek(s), warm.id);
    expect(reviewSays(s, 5, new RegExp(`^${h1.name} closed: .+ \\(make it safe or fix it\\)\\.$`))).toBe(true);
    s = ok(s, { t: 'makeSafe', role: 'elec', alert: warm.id, how: 'blankoff', week: 6 });
    expect(houseBlocker(s, s.assets.find((a) => a.id === 'h1')!)).toBeNull();
    expect(rentFactor(s, h1)).toBe(0.75);
    s = only(endWeek(s), warm.id);
    const booked = s.history.find((h) => h.week === 6)!.housesBooked > 0;
    if (booked) expect(reviewSays(s, 6, new RegExp(`^${h1.name} rented at 75%: a blank-off is on until the fix\\.$`))).toBe(true);
    // the fix: on the shelf, a hazard, so the work budget approves it at once
    const r = plan(s, warm);
    s = signOff(r.s, orderOf(r.s, r.o.id));
    expect(hazardOn(s, 'h1')).toBeUndefined();
    expect(rentFactor(s, h1)).toBe(1);
  });

  it('a branch breaker doesn’t isolate a service-neutral fault: the fault stays (hidden) until the fix', () => {
    let s = island();
    const tingle = raise(s, 'E_SHOWER_TINGLE', 2, 'h1');
    s = ok(s, { t: 'makeSafe', role: 'elec', alert: tingle.id, how: 'breaker', week: 5 });
    const d = s.defects!.find((x) => x.puzzle === 'elec' && x.variant === 'isolation');
    expect(d?.alert?.alert).toBe(tingle.id);
    expect(d!.dueWeek).toBeGreaterThanOrEqual(6);
    // fixed first: the hidden miss goes with it
    const r = plan(s, tingle);
    s = signOff(r.s, orderOf(r.s, r.o.id));
    expect(s.defects!.some((x) => x.variant === 'isolation' && x.alert?.alert === tingle.id)).toBe(false);
    // the other causes are isolated by the branch breaker
    s = island();
    const wh = raise(s, 'E_SHOWER_TINGLE', 0, 'h1');
    s = ok(s, { t: 'makeSafe', role: 'elec', alert: wh.id, how: 'breaker', week: 5 });
    expect((s.defects ?? []).some((x) => x.variant === 'isolation')).toBe(false);
  });

  it('the only guest plane past due is grounded like any plane: a mainland sub-charter flies its guests, no near-miss', () => {
    let s = island();
    const al = raise(s, 'M_BRAKE_SOFT', 1, 'p1', 5);
    expect(al.sole).toBe(true);
    expect(alertAog(s, 'p1')?.id).toBe(al.id);
    expect(subCharterOn(s)).toMatchObject({ alert: { id: al.id }, flights: 2, fee: SUB_FEE, usd: 2 * SUB_FEE });
    s = only(endWeek(s), al.id);
    expect(reviewSays(s, 5, /^Twin N-12 AOG: .+ \(due week 5, not fixed\): 4 flights cancelled\.$/)).toBe(true);
    expect(reviewSays(s, 5, new RegExp(`^Twin N-12 stayed on the ground: a mainland sub-charter flew the guests in \\(2 flights at \\$${SUB_FEE}, \\$${2 * SUB_FEE}\\)\\.$`))).toBe(true);
    expect(reviewSays(s, 5, / flew \d of \d with /)).toBe(false);
    const h = s.history.find((x) => x.week === 5)!;
    expect(h.nearMisses).toBe(0);
    expect(h.housesBooked).toBe(2);
    expect(h.costs.subCharter).toBe(2 * SUB_FEE);
  });
});

describe('comebacks (5.5)', () => {
  it('a finding that shows the fault can’t be closed as nothing: fix it, placard it or make it safe', () => {
    let s = island();
    const chatter = raise(s, 'M_BRAKE_CHATTER', 0, 'p1');
    expect(findingOf(s, chatter, 3).nff).toBe(false);
    expect(no(s, { t: 'nff', role: 'mech', alert: chatter.id, week: 5 })).toBe('The finding shows the fault: fix it, placard it or make it safe.');
    const com = raise(s, 'M_COM_DEAD', 0, 'p2');
    expect(no(s, { t: 'nff', role: 'mech', alert: com.id, week: 5 })).toBe('The finding shows the fault: fix it, placard it or make it safe.');
    const tingle = raise(s, 'E_SHOWER_TINGLE', 0, 'h1');
    expect(no(s, { t: 'nff', role: 'elec', alert: tingle.id, week: 5 })).toBe('The finding shows the fault: fix it, placard it or make it safe.');
    // a finding that reads "could not duplicate" can be
    const nff = raise(s, 'M_BRAKE_CHATTER', -1, 'p2');
    expect(findingOf(s, nff, 3).nff).toBe(true);
    s = ok(s, { t: 'nff', role: 'mech', alert: nff.id, week: 5 });
    expect(alertOf(s, nff.id).status).toBe('closed');
  });

  it('an NFF close on a real fault that hid (an intermittent) comes back 1-2 weeks later, due now, same cause; a real NFF doesn’t', () => {
    let s = island();
    // an intermittent that didn't show on the ground: the finding reads "could not duplicate" (the tier-3 roll)
    const al = raise(s, 'M_COM_INTERMITTENT', 0, 'p1');
    al.looksNff = true;
    expect(findingOf(s, al, 3).nff).toBe(true);
    const nff = raise(s, 'M_COM_INTERMITTENT', -1, 'p2');
    expect(nff.kind).toBe('nff');
    s = ok(s, { t: 'nff', role: 'mech', alert: al.id, week: 5 });
    s = ok(s, { t: 'nff', role: 'mech', alert: nff.id, week: 5 });
    expect(alertOf(s, al.id)).toMatchObject({ status: 'closed', closed: { week: 5, how: 'nff' } });
    let back: Alert | undefined;
    for (let i = 0; i < 4 && !back; i++) {
      s = endWeek(s);
      back = s.alerts!.find((a) => a.src === 'again' && a.sym === 'M_COM_INTERMITTENT');
    }
    expect(back).toBeTruthy();
    expect(back!).toMatchObject({ assetId: 'p1', cause: 0, status: 'open' });
    expect(back!.due).toBe(back!.week);
    // 1-2 weeks go by (it surfaces at that week's resolve and is written up for the week after)
    const between = back!.week - 5 - 1;
    expect(between).toBeGreaterThanOrEqual(ALERTS.againMin);
    expect(between).toBeLessThanOrEqual(ALERTS.againMax);
    expect(symptomText(s, back!)).toMatch(/^Written up again: /);
    expect(s.alerts!.some((a) => a.src === 'again' && a.assetId === 'p2')).toBe(false);
  });
});

describe('alert volume (5.1)', () => {
  /** the trade orders the base engine (6c0c426) generated a week: three friends, seeds 1-30, 26 weeks */
  const BASE = { mech: 1.469, elec: 2.583 };
  it('per trade within ±10% of the orders the base engine generated; no fault found on 10-20% of alerts', () => {
    const real = { mech: 0, elec: 0 };
    const nff = { mech: 0, elec: 0 };
    let weeks = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const seen = new Set<string>();
      simulate(TEAMS['three friends'], 26, seed, (s) => {
        weeks++;
        for (const a of s.alerts ?? []) {
          if (seen.has(a.id)) continue;
          seen.add(a.id);
          const sym = SYMPTOMS[a.sym];
          // repairs, write-ups, hard landings and comebacks don't come from the week's slots
          if (a.repair || sym?.writeUp || sym?.auto || a.again !== undefined) continue;
          (a.cause < 0 ? nff : real)[a.role as 'mech' | 'elec']++;
        }
      });
    }
    for (const r of ['mech', 'elec'] as const) {
      const ratio = real[r] / weeks / BASE[r];
      expect(ratio, r).toBeGreaterThanOrEqual(0.9);
      expect(ratio, r).toBeLessThanOrEqual(1.1);
    }
    const share = (nff.mech + nff.elec) / (nff.mech + nff.elec + real.mech + real.elec);
    expect(share).toBeGreaterThanOrEqual(0.1);
    expect(share).toBeLessThanOrEqual(0.2);
  }, 120_000);
});
