// Whose move, in the right words (docs/JOBFLOW.md 16, the play review's fixes):
// the research branch is a tap away (the job, the banner, the Dock, Your move)
// and the viewer's own move reads "Your move"; a chain's plane is AOG only when
// it is; an empty required slot is named before Send; the standing approval's
// words tell the truth before Send; the week's revenue work shows with what
// skipping it costs; the MEL End-turn lines say what the MEL still allows.
import { describe, expect, it, vi } from 'vitest';
import { raiseAlert, SYMPTOMS } from '../src/sim/alerts';
import { plantFor } from '../src/sim/chain';
import { apply, createIsland } from '../src/sim/engine';
import { fixTaskFor, stdPickFor } from '../src/sim/flow';
import { addStarter } from '../src/sim/stock';
import { ROLES, type Alert, type Asset, type IslandState, type Order } from '../src/sim/types';
import { missingSlot, newDraft, preview, reduceDraft, sendAction, stepper, type Draft, type DraftAct } from '../src/ui/flow/steps';
import { moveChip } from '../src/ui/flow/words';
import { chainStepOrder, chainTag, crossMoves, dockNext, endTurnChecks, lateSafeAlert, revenueMoves, standingWords } from '../src/ui/select';

vi.setConfig({ testTimeout: 30000 });

const NOW = Date.UTC(2026, 8, 26, 10);
const CARGO: Asset = { id: 'p2', kind: 'plane', model: 'cargo', name: 'Cargo C-7', health: 70, touchedWeek: 5, sinceInspection: 0 };
/** an island whose cargo plane's wheels and brakes carry an STC (its linings aren't the IPC's: research) */
const PLANTED = Array.from({ length: 400 }, (_, i) => i + 1).find((seed) => {
  const p = plantFor(seed, 'p2', 'cargo');
  return p.plant === '32-40' && p.via === 'stc';
})!;

function island(seed = 42): IslandState {
  let s = createIsland({ id: `wm${seed}`, name: 'Move Isle', now: NOW, tz: 'Europe/Paris', seed, creator: { uid: 'a', name: 'Ana', role: 'mech' } });
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
  for (const p of Object.values(s.players)) if (p) p.graceUntil = 0;
  return s;
}
let clock = NOW;
function ok(s: IslandState, a: Parameters<typeof apply>[1]): IslandState {
  const r = apply(s, a, ++clock);
  expect(r.error, JSON.stringify(a)).toBeUndefined();
  return r.s;
}
const raise = (s: IslandState, sym: string, cause: number, assetId: string, due?: number): Alert =>
  raiseAlert(s, { role: SYMPTOMS[sym].role, asset: s.assets.find((a) => a.id === assetId)!, sym, cause, ...(due !== undefined ? { due } : {}) }, clock);
const run = (s: IslandState, a: Alert, d: Draft, ...acts: DraftAct[]) => acts.reduce((x, act) => reduceDraft(s, a, x, act), d);

describe('the research branch is a tap away (13, 16)', () => {
  function researching(due?: number, sym = 'M_BRAKE_CHATTER', cause = 0) {
    let s = island(PLANTED);
    const al = raise(s, sym, cause, 'p2', due);
    const task = fixTaskFor(s, al)!;
    s = ok(s, { t: 'plan', role: 'mech', alert: al.id, task: task.id, pick: stdPickFor(s, al, task), research: true, week: s.week });
    return { s, al: s.alerts!.find((a) => a.id === al.id)! };
  }

  it('the logbooks open from the Dock and Your move, and the row reads "Your move: logbooks", never waiting on yourself', () => {
    const { s, al } = researching(7);
    const step = chainStepOrder(s)!;
    expect(step).toMatchObject({ who: 'mech', label: 'Open the logbooks ▸' });
    const o = s.orders.find((x) => x.id === step.order)!;
    expect(o).toMatchObject({ role: 'mech', status: 'ready' });
    expect(moveChip(s, al, 'mech').chip).toBe('Your move: logbooks');
    expect(moveChip(s, al, 'fin').chip).toBe('Ana: logbooks');
    const next = dockNext(s, 'mech')!;
    expect(next.target).toEqual({ order: step.order });
    expect(next.label).toMatch(/^Open the logbooks · Cargo C-7 ▸$/);
  });

  it("the chain says AOG only when its plane is grounded: a job that isn't due yet flies meanwhile", () => {
    const { s } = researching(7);
    expect(chainTag(s, s.chain!)).toBe('Cargo C-7 flies meanwhile');
    const m = crossMoves(s).find((x) => x.kind === 'chain')!;
    expect(m.text).not.toMatch(/AOG/);
    expect(m.text).toMatch(/\(Cargo C-7 flies meanwhile\)$/);
    expect(m.what).toBe(`Cargo C-7: ${s.chain!.item}`);
    // an airworthiness item due now: grounded, and it says so
    const now = researching(5, 'M_BRAKE_SOFT', 1);
    expect(chainTag(now.s, now.s.chain!)).toBe('Cargo C-7 is AOG');
    expect(crossMoves(now.s).find((x) => x.kind === 'chain')!.text).toMatch(/\(Cargo C-7 is AOG\)$/);
  });
});

describe('an empty required slot is named before Send (17.2)', () => {
  it('Materials isn’t ticked, the Stock step says which, Send won’t go, and the words keep the acronym', () => {
    const s = island();
    const al = raise(s, 'E_GFCI_TRIPS', 0, 'h1');
    let d = newDraft(s, al);
    d = run(s, al, d, { t: 'useTask', task: 'ref:gfci' }, { t: 'go', step: 'stock' });
    expect(missingSlot(s, al, d)?.slot).toBe('gfci');
    const p = preview(s, al, d);
    expect(p.outcome).toBe('incomplete');
    expect(p.text).toBe('Pick the GFCI device first: this job needs a GFCI device, and none is picked.');
    expect(stepper(s, al, d).find((x) => x.key === 'parts')!.state).toBe('todo');
    expect(sendAction(s, al, d)).toEqual({ error: 'Pick the GFCI device first: this job needs one.' });
    // picked: ticked, and it goes
    d = run(s, al, d, { t: 'fill', slot: 'gfci', item: 'KG20-TR' }, { t: 'go', step: 'stock' });
    expect(missingSlot(s, al, d)).toBeNull();
    expect(preview(s, al, d).outcome).not.toBe('incomplete');
    expect(stepper(s, al, d).find((x) => x.key === 'parts')!.state).toBe('done');
    expect('t' in sendAction(s, al, d)).toBe(true);
  });
});

describe("the standing approval's words before Send (8.5)", () => {
  it('safety work due this week or next: through tonight whatever the limit; the rest over it: it waits', () => {
    let s = island();
    s = ok(s, { t: 'setStanding', amount: 0 });
    s = ok(s, { t: 'endTurn', role: 'fin', week: 5 });
    const soon = raise(s, 'M_WHEEL_CORROSION', 0, 'p2', 6);
    const later = raise(s, 'M_WHEEL_CORROSION', 0, 'p1', 8);
    expect(lateSafeAlert(s, soon)).toBe(true);
    expect(lateSafeAlert(s, later)).toBe(false);
    expect(standingWords(s, 1200, true, true)).toBe('Cy has ended the turn: it goes through tonight on the standing approval whatever the limit (safety work due this week or next).');
    expect(standingWords(s, 1200, true, false)).toBe("Cy has ended the turn, and it's over the standing limit ($0): it waits for Cy's approval.");
    // the Stock step's preview carries it, with the card's total (freight included)
    const task = fixTaskFor(s, soon)!;
    let d = newDraft(s, soon);
    d = run(s, soon, d, { t: 'useTask', task: task.id });
    for (const l of stdPickFor(s, soon, task)) if (l.slot) d = run(s, soon, d, { t: 'fill', slot: l.slot, item: l.item, qty: l.qty });
    d = run(s, soon, d, { t: 'go', step: 'stock' });
    const p = preview(s, soon, d);
    if (p.outcome === 'card') expect(p.late).toMatch(/whatever the limit/);
  });

  it("the analyst's End turn warns that the techs play later, and a raise is a tap away", () => {
    const s = island();
    const c = endTurnChecks(s, 'fin').find((x) => x.standing)!;
    expect(c.text).toMatch(/^Ana and Ben haven't played yet: a card over \$[\d,]+ that isn't safety work due this week or next will wait a week\./);
  });
});

describe("the week's revenue work (16)", () => {
  it('the load sheet shows in Your move and the Dock, and End turn names what skipping it costs', () => {
    const s = island();
    const sheet: Order = { id: 'wb1', role: 'mech', kind: 'wb', assetId: 'p1', title: 'Charter load sheet', puzzle: 'balance', tier: 1, cost: 0, parts: 0, gain: 0, createdWeek: 5, deferrals: 0, lastDeferredWeek: null, status: 'ready', seed: 3 };
    s.orders.push(sheet);
    const rev = revenueMoves(s, 'mech');
    expect(rev.map((r) => r.order.id)).toEqual(['wb1']);
    expect(rev[0].label).toBe('Load sheet · Twin N-12');
    expect(dockNext(s, 'mech')).toEqual({ label: 'Load sheet · Twin N-12 ▸', target: { order: 'wb1' } });
    expect(endTurnChecks(s, 'mech').some((x) => x.text === "No load sheet: half of Twin N-12's charters stay on the ramp." && x.urgent)).toBe(true);
    expect(revenueMoves(s, 'elec')).toEqual([]);
  });
});

describe('the MEL on End turn (10)', () => {
  it('placard it only where the MEL gives relief; a lapsed placard: ask the analyst for the one extension', () => {
    let s = island();
    const tire = raise(s, 'M_TIRE_PRESSURE', 0, 'p2', 5);
    const com = raise(s, 'M_COM_DEAD', 0, 'p2', 5);
    const lines = endTurnChecks(s, 'mech').map((x) => x.text);
    // no MEL relief: only the fix (a safety call grounds it too, so it's no way out)
    expect(lines.some((t) => /^Fix it this week \(no MEL relief\), or from this resolve Cargo C-7 is AOG: /.test(t))).toBe(true);
    expect(lines.some((t) => /or tag it/.test(t))).toBe(false);
    expect(lines.some((t) => /^Fix it or placard it \(MEL C\) this week, or from this resolve Cargo C-7 is AOG: /.test(t))).toBe(true);
    expect(endTurnChecks(s, 'mech').some((x) => x.melAsk)).toBe(false);
    void tire;
    // placarded in week 5: covers week 5; in week 6 it has run out: ask Cy for the extension, from the line itself
    s = ok(s, { t: 'mel', role: 'mech', alert: com.id, week: 5 });
    const runsOut = endTurnChecks(s, 'mech').find((x) => /MEL placard runs out at this resolve: fix it, or ask Cy to authorize the one-time extension\.$/.test(x.text));
    expect(runsOut?.melAsk).toBe(com.id);
    s.week = 6;
    const ran = endTurnChecks(s, 'mech').find((x) => /^The MEL placard ran out: ask Cy to authorize the one-time extension, or fix it, or Cargo C-7 is AOG: /.test(x.text));
    expect(ran?.melAsk).toBe(com.id);
    // the line's button is the mechanic's ask
    s = ok(s, { t: 'melExtend', role: 'mech', alert: ran!.melAsk!, week: 6 });
    expect(endTurnChecks(s, 'mech').some((x) => /^Cy hasn't authorized the MEL extension yet: /.test(x.text))).toBe(true);
    expect(endTurnChecks(s, 'mech').some((x) => x.melAsk)).toBe(false);
  });
});
