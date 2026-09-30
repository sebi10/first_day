// The technicians' job-flow screens as a pure model (src/ui/flow/steps.ts,
// docs/JOBFLOW.md 17.2): which steps an alert shows, the draft and its reducer,
// what Send dispatches, the tap counts for a known answer, and that nothing the
// screens show before a commit reads an alert's hidden cause. Also the puzzles'
// display-only labels from the job flow's pick.
import { describe, expect, it, vi } from 'vitest';
import { generateMeter } from '../src/puzzles/meter';
import { generatePanel, pickedPanel } from '../src/puzzles/panel';
import type { PuzzleContext } from '../src/puzzles/types';
import { generateWireup, pickedDevice } from '../src/puzzles/wireup';
import { raiseAlert, SYMPTOMS } from '../src/sim/alerts';
import { apply, createIsland } from '../src/sim/engine';
import { fixTaskFor, stdPickFor } from '../src/sim/flow';
import { itemById } from '../src/sim/items';
import { addStarter } from '../src/sim/stock';
import { ROLES, type Alert, type IslandState, type PickLine } from '../src/sim/types';
import { launchFor } from '../src/ui/select';
import {
  checkDraft,
  isOneTap,
  labourOf,
  likelyItems,
  manualDefault,
  manualTaps,
  newDraft,
  preview,
  reduceDraft,
  sendAction,
  slotsFor,
  slotTaps,
  startStep,
  stepLabel,
  siteWords,
  stepper,
  stockRows,
  taskFor,
  tierOf,
  type Draft,
  type DraftAct,
} from '../src/ui/flow/steps';

vi.setConfig({ testTimeout: 30000 });

const NOW = Date.UTC(2026, 8, 26, 10);

/**
 * A started island: the twin (p1), the cargo plane (p2), two cottages (h1, h2) and a villa (h3), the grid and
 * the starter shelf, no work open. Week 1 at tier 1 is a teaching week (alert tier 1); week 12 at tier 4 is
 * alert tier 3 (no hints). New-crew grace is off so the tier is the island's.
 */
function island(week: number, tier: number, seed = 42): IslandState {
  let s = createIsland({ id: `ui${week}${tier}${seed}`, name: 'Flow UI', now: NOW, tz: 'UTC', seed, creator: { uid: 'a', name: 'Seb', role: 'mech' } });
  s = apply(s, { t: 'join', uid: 'b', name: 'Ana', role: 'elec' }, NOW).s;
  s = apply(s, { t: 'join', uid: 'c', name: 'Cy', role: 'fin' }, NOW).s;
  for (const r of ROLES) s = apply(s, { t: 'week0Done', role: r }, NOW).s;
  s.week = week;
  s.tier = tier;
  s.cash = 20000;
  s.assets.push({ id: 'p2', kind: 'plane', model: 'cargo', name: 'Cargo C-7', health: 72, touchedWeek: week - 1, sinceInspection: 0 });
  s.assets.push({ id: 'h3', kind: 'house', model: 'villa', name: 'Villa 1', health: 80, touchedWeek: week - 1, inspectionUntil: week + 8 });
  addStarter(s, tier);
  s.orders = [];
  s.alerts = [];
  for (const p of Object.values(s.players)) if (p) p.graceUntil = 0;
  return s;
}
const raise = (s: IslandState, sym: string, cause: number, assetId: string, due?: number): Alert =>
  raiseAlert(s, { role: SYMPTOMS[sym].role, asset: s.assets.find((a) => a.id === assetId)!, sym, cause, ...(due !== undefined ? { due } : {}) }, NOW);
const run = (s: IslandState, a: Alert, d: Draft, ...acts: DraftAct[]) => acts.reduce((x, act) => reduceDraft(s, a, x, act), d);

/**
 * The taps to Send for a known answer (17.2): the row, Find the task, the Manual step's taps (the likely row, or a
 * chip, then Use), each slot's two (the slot and its row), Check stock only if the flow didn't move on by itself,
 * and Send. Each search step's own count is kept too.
 */
function walk(s: IslandState, a: Alert): { total: number; manual: number; slots: number[]; draft: Draft } {
  let total = 1;
  let d = newDraft(s, a);
  if (d.step === 'investigate') {
    d = run(s, a, d, { t: 'go', step: 'manual' });
    total++;
  }
  const fix = fixTaskFor(s, a)!;
  const manual = manualTaps(s, a, fix.id);
  total += manual;
  d = run(s, a, d, { t: 'preview', task: fix.id }, { t: 'useTask', task: fix.id });
  const t = taskFor(s, a, d.task)!;
  const slots: number[] = [];
  for (const l of stdPickFor(s, a, t)) {
    const m = slotsFor(s, a, t).find((x) => x.slot === l.slot)!;
    const n = slotTaps(s, a, m, l.item);
    slots.push(n);
    total += n;
    d = run(s, a, d, { t: 'openSlot', slot: m.slot }, { t: 'fill', slot: m.slot, item: l.item });
  }
  if (d.step !== 'stock') {
    d = run(s, a, d, { t: 'go', step: 'stock' });
    total++;
  }
  return { total: total + 1, manual, slots, draft: d };
}

describe('the five steps', () => {
  it("speaks each trade's words: the mechanic's Manual and Parts, the electrician's Reference and Materials", () => {
    expect(['investigate', 'manual', 'parts', 'stock', 'send'].map((k) => stepLabel(k as never, 'mech'))).toEqual(['Investigate', 'Manual', 'Parts', 'Stock', 'Send']);
    expect(['investigate', 'manual', 'parts', 'stock', 'send'].map((k) => stepLabel(k as never, 'elec'))).toEqual(['Investigate', 'Reference', 'Materials', 'Stock', 'Send']);
  });

  it('opens where the alert says: a symptom at Investigate, a due item at its task, a take-off at Materials', () => {
    const s = island(1, 1);
    const tire = raise(s, 'M_TIRE_WORN', 0, 'p1', 3);
    const insp = raise(s, 'M_INSP_DUE', 0, 'p1', 3);
    const spa = raise(s, 'E_TAKEOFF_SPA', 0, 'h2', 4);
    expect(startStep(s, tire)).toBe('investigate');
    expect(startStep(s, insp)).toBe('manual');
    expect(newDraft(s, insp).preview).toBe(insp.task);
    expect(startStep(s, spa)).toBe('parts');
    // a take-off skips Investigate: its dot is struck through, Reference is done
    const dots = stepper(s, spa, newDraft(s, spa));
    expect(dots.map((x) => x.state)).toEqual(['skip', 'done', 'now', 'todo', 'todo']);
    expect(dots.map((x) => x.label)).toEqual(['Investigate', 'Reference', 'Materials', 'Stock', 'Send']);
  });

  it('a pre-filled task with nothing to pick is one tap (the 100-hour); a symptom never is', () => {
    const s = island(1, 1);
    expect(isOneTap(s, raise(s, 'M_INSP_DUE', 0, 'p1', 3))).toBe(true);
    expect(isOneTap(s, raise(s, 'M_TIRE_WORN', 0, 'p1', 3))).toBe(false);
    expect(isOneTap(s, raise(s, 'E_GFCI_TRIPS', 0, 'h1', 3))).toBe(false);
  });

  it('a task with nothing to pick skips Parts: Use goes straight to Stock', () => {
    const s = island(1, 1);
    const a = raise(s, 'M_BRAKE_SOFT', 0, 'p1', 3);
    const bleed = fixTaskFor(s, a)!;
    const d = run(s, a, newDraft(s, a), { t: 'go', step: 'manual' }, { t: 'useTask', task: bleed.id });
    expect(d.step).toBe('stock');
    expect(stepper(s, a, d).find((x) => x.key === 'parts')!.state).toBe('skip');
  });
});

describe('the draft', () => {
  it('Use this task sets the task and opens Parts; another task clears the pick', () => {
    const s = island(1, 1);
    const a = raise(s, 'M_TIRE_WORN', 0, 'p1', 3);
    const tire = fixTaskFor(s, a)!;
    let d = run(s, a, newDraft(s, a), { t: 'go', step: 'manual' }, { t: 'preview', task: tire.id }, { t: 'useTask', task: tire.id });
    expect(d).toMatchObject({ step: 'parts', task: tire.id, pick: [] });
    expect(d.preview).toBeUndefined();
    d = run(s, a, d, { t: 'openSlot', slot: 'tire' }, { t: 'fill', slot: 'tire', item: 'OG-65010-8' });
    expect(d.pick).toEqual([{ item: 'OG-65010-8', qty: 1, slot: 'tire' }]);
    // the same task again keeps the pick; the brake lining task starts over
    expect(run(s, a, d, { t: 'useTask', task: tire.id }).pick).toHaveLength(1);
    const lining = run(s, a, d, { t: 'useTask', task: 'amm:twin:32-40-02' });
    expect(lining.task).toBe('amm:twin:32-40-02');
    expect(lining.pick).toEqual([]);
    // a task outside this airplane's manual set, or reference only, changes nothing
    expect(run(s, a, d, { t: 'useTask', task: 'amm:cargo:32-40-01' })).toBe(d);
  });

  it('fill puts the slot quantity in the slot, keeps the task order, and moves on to Stock once the pick is complete', () => {
    const s = island(1, 1);
    const a = raise(s, 'M_TIRE_WORN', 0, 'p1', 3);
    const tire = fixTaskFor(s, a)!;
    let d = run(s, a, newDraft(s, a), { t: 'useTask', task: tire.id }, { t: 'openSlot', slot: 'tube' }, { t: 'fill', slot: 'tube', item: 'OG-T65010' });
    // the slot's search closes and the flow comes back to Parts (the tire slot is still empty)
    expect(d.slot).toBeUndefined();
    expect(d.step).toBe('parts');
    d = run(s, a, d, { t: 'openSlot', slot: 'tire' }, { t: 'fill', slot: 'tire', item: 'OG-65010-8' });
    expect(d.pick.map((l) => l.slot)).toEqual(['tire', 'tube']);
    expect(d.step).toBe('stock');
    // refilling a slot replaces its line (the reducer never judges the pick: receiving and the install do)
    d = run(s, a, d, { t: 'fill', slot: 'tire', item: 'OG-T65010' });
    expect(d.pick.filter((l) => l.slot === 'tire')).toEqual([{ item: 'OG-T65010', qty: 1, slot: 'tire' }]);
    expect(d.pick).toHaveLength(2);
    // an unknown item closes the slot's search and changes nothing
    const same = run(s, a, { ...d, slot: 'tire' }, { t: 'fill', slot: 'tire', item: 'NOPE-1' });
    expect(same.pick).toEqual(d.pick);
    expect(same.slot).toBeUndefined();
  });

  it('an electrician slot waits for the protection the room needs (teaching tiers)', () => {
    const s = island(1, 1);
    const a = raise(s, 'E_GFCI_TRIPS', 0, 'h1', 3);
    const d0 = run(s, a, newDraft(s, a), { t: 'useTask', task: 'ref:gfci' });
    // a plain receptacle in the GFCI slot's place: the bathroom still needs GFCI protection, so Materials stays open
    const plain = run(s, a, d0, { t: 'fill', slot: 'gfci', item: 'KR20-TR' });
    expect(plain.step).toBe('parts');
    const gfci = run(s, a, d0, { t: 'fill', slot: 'gfci', item: 'KG20-TR' });
    expect(gfci.step).toBe('stock');
  });

  it('qty, add, remove, research and the search box', () => {
    const s = island(1, 1);
    const a = raise(s, 'M_BELT_SQUEAL', 0, 'p1', 3);
    const belt = fixTaskFor(s, a)!;
    let d = run(s, a, newDraft(s, a), { t: 'useTask', task: belt.id }, { t: 'fill', slot: 'belt', item: 'HA-B38' });
    d = run(s, a, d, { t: 'qty', index: 0, qty: 0 });
    expect(d.pick[0].qty).toBe(1);
    d = run(s, a, d, { t: 'add', item: 'AN960-416' }, { t: 'add', item: 'AN960-416', qty: 2 });
    expect(d.pick.find((l) => !l.slot)).toEqual({ item: 'AN960-416', qty: 3 });
    d = run(s, a, d, { t: 'remove', index: 1 });
    expect(d.pick).toHaveLength(1);
    // Not in the IPC: the slot's line goes, the slot is marked for research; a fill takes it back
    d = run(s, a, d, { t: 'research', slot: 'belt' });
    expect(d.research).toBe('belt');
    expect(d.pick).toEqual([]);
    expect(run(s, a, d, { t: 'fill', slot: 'belt', item: 'HA-B38' }).research).toBeUndefined();
    // typing clears the chapter chip, a chip clears the query
    d = run(s, a, d, { t: 'chapter', chapter: '24 Electrical power' });
    expect(run(s, a, d, { t: 'query', q: 'belt' })).toMatchObject({ query: 'belt', chapter: undefined });
    expect(run(s, a, { ...d, query: 'belt' }, { t: 'chapter', chapter: '32 Landing gear' })).toMatchObject({ query: '', chapter: '32 Landing gear' });
    // ten lines at most
    let many = d;
    for (let i = 0; i < 14; i++) many = run(s, a, many, { t: 'add', item: i % 2 ? 'AN960-416' : 'AN960-516', qty: 1 }, { t: 'fill', slot: 'belt', item: 'HA-B38' });
    expect(many.pick.length).toBeLessThanOrEqual(10);
  });

  it('a stored draft is dropped when it no longer fits: a task out of the set, a closed alert, a finished job', () => {
    const s = island(1, 1);
    const a = raise(s, 'M_TIRE_WORN', 0, 'p1', 3);
    const tire = fixTaskFor(s, a)!;
    const d = run(s, a, newDraft(s, a), { t: 'useTask', task: tire.id });
    expect(checkDraft(s, a, d)).toEqual(d);
    expect(checkDraft(s, a, { ...d, task: 'amm:cargo:32-40-01' })).toBeNull();
    expect(checkDraft(s, a, { ...d, v: 2 as never })).toBeNull();
    expect(checkDraft(s, a, null)).toBeNull();
    // unknown items fall out of the pick
    expect(checkDraft(s, a, { ...d, pick: [{ item: 'NOPE-1', qty: 1 }] })!.pick).toEqual([]);
    expect(checkDraft(s, { ...a, status: 'closed' }, d)).toBeNull();
  });
});

describe('what Send dispatches', () => {
  it('plan: the task and the pick (slot lines in task order), never the research slot', () => {
    let s = island(1, 1);
    const a = raise(s, 'M_TIRE_WORN', 0, 'p1', 3);
    const d = walk(s, a).draft;
    const x = sendAction(s, a, d);
    expect(x).toEqual({
      t: 'plan',
      role: 'mech',
      alert: a.id,
      task: 'amm:twin:32-40-01',
      pick: [
        { item: 'OG-65010-8', qty: 1, slot: 'tire' },
        { item: 'OG-T65010', qty: 1, slot: 'tube' },
      ],
    });
    // the engine takes it as it is: the job carries that pick
    const r = apply(s, x as never, NOW + 1);
    expect(r.error).toBeUndefined();
    s = r.s;
    const o = s.orders.find((z) => z.flow?.alert === a.id)!;
    expect(o.flow!.pick).toEqual((x as { pick: PickLine[] }).pick);
    // research: the slot is left out and the flag goes along
    const res = sendAction(s, a, { ...d, research: 'tube', pick: d.pick.filter((l) => l.slot !== 'tube') });
    expect(res).toMatchObject({ t: 'plan', research: true, pick: [{ item: 'OG-65010-8', qty: 1, slot: 'tire' }] });
  });

  it('repick for a job; a fixed line job sends no pick; no task, or reference only, says why', () => {
    const s = island(1, 1);
    const a = raise(s, 'M_TIRE_WORN', 0, 'p1', 3);
    const d = walk(s, a).draft;
    expect(sendAction(s, a, { ...d, order: 'o77' })).toMatchObject({ t: 'repick', role: 'mech', order: 'o77' });
    expect(sendAction(s, a, { ...d, task: undefined })).toEqual({ error: 'Find the task first.' });
    const g = raise(s, 'E_GFCI_TRIPS', 0, 'h1', 3);
    expect(sendAction(s, g, newDraft(s, g))).toEqual({ error: 'Find the procedure first.' });
    // the AFCI entry explains the rule: the procedure that does the work is its own entry
    expect(sendAction(s, g, { ...newDraft(s, g), task: 'ref:afci' })).toMatchObject({ error: expect.stringMatching(/reference only|Find the procedure/) });
  });

  it('the Stock step and the summary: on hand pulls, the rest goes on a card', () => {
    const s = island(1, 1);
    const tire = raise(s, 'M_TIRE_WORN', 0, 'p1', 3);
    const dt = walk(s, tire).draft;
    const rows = stockRows(s, tire, dt);
    expect(rows.filter((r) => r.from === 'pick').map((r) => r.badge)).toEqual(['ok', 'ok']);
    expect(preview(s, tire, dt)).toMatchObject({ outcome: 'ready', pull: expect.any(Number), buy: 0 });
    const belt = raise(s, 'M_BELT_SQUEAL', 0, 'p1', 3);
    const db = walk(s, belt).draft;
    const p = preview(s, belt, db);
    expect(p.outcome).toBe('card');
    expect(p.buy).toBe(1);
    expect(p.text).toMatch(/a card for Cy, about \$[\d,]+ in all\./);
  });
});

describe('tap counts for a known answer (17.2): three taps or fewer per search step', () => {
  it('mechanic, tier 1, brake pedal soft (a bleed): 5 taps to Send, the Manual step in 2', () => {
    const s = island(1, 1);
    const a = raise(s, 'M_BRAKE_SOFT', 0, 'p1', 3);
    expect(tierOf(s, a)).toBe(1);
    const w = walk(s, a);
    expect(w.manual).toBe(2);
    expect(w.slots).toEqual([]);
    expect(w.total).toBe(5);
  });

  it('mechanic, tier 3, tire at 2/32 on the cargo plane: Manual in 3, each part in 2, 10 taps to Send', () => {
    const s = island(12, 4);
    const a = raise(s, 'M_TIRE_WORN', 0, 'p2', 14);
    expect(tierOf(s, a)).toBe(3);
    const w = walk(s, a);
    expect(w.manual).toBe(3);
    expect(w.slots).toEqual([2, 2]);
    expect(w.total).toBe(10);
  });

  it('electrician, tier 1, bathroom GFCI: Reference in 2, the device in 2, 7 taps', () => {
    const s = island(1, 1);
    const a = raise(s, 'E_GFCI_TRIPS', 0, 'h1', 3);
    const w = walk(s, a);
    expect(w.manual).toBe(2);
    expect(w.slots).toEqual([2]);
    expect(w.total).toBe(7);
  });

  it('electrician, tier 2 and tier 3, a dead outlet: the reference and the receptacle within 3', () => {
    for (const [week, tier, house] of [
      [8, 2, 'h1'],
      [12, 4, 'h3'],
    ] as const) {
      const s = island(week, tier);
      const a = raise(s, 'E_DEAD_OUTLET', 0, house, week + 2);
      const w = walk(s, a);
      expect(w.manual).toBeLessThanOrEqual(3);
      for (const n of w.slots) expect(n).toBeLessThanOrEqual(3);
      expect(w.total).toBeLessThanOrEqual(8);
    }
  });

  it('every tier-1 and tier-3 search step of the sampled alerts is three taps or fewer', () => {
    const cases: [number, number, string, string][] = [
      [1, 1, 'M_TIRE_WORN', 'p1'],
      [1, 1, 'M_BELT_SQUEAL', 'p1'],
      [1, 1, 'M_BRAKE_CHATTER', 'p1'],
      [1, 1, 'E_GFCI_TRIPS', 'h1'],
      [12, 4, 'M_TIRE_WORN', 'p2'],
      [12, 4, 'M_BRAKE_CHATTER', 'p1'],
      [12, 4, 'E_GFCI_TRIPS', 'h1'],
      [12, 4, 'E_DEAD_OUTLET', 'h3'],
    ];
    for (const [week, tier, sym, asset] of cases) {
      const s = island(week, tier);
      const a = raise(s, sym, 0, asset, week + 2);
      const w = walk(s, a);
      expect(w.manual, `${sym} tier ${tierOf(s, a)}`).toBeLessThanOrEqual(3);
      for (const n of w.slots) expect(n, `${sym} slot`).toBeLessThanOrEqual(3);
    }
  });

  it('the 100-hour inspection is one tap: the row’s Start', () => {
    const s = island(1, 1);
    expect(isOneTap(s, raise(s, 'M_INSP_DUE', 0, 'p1', 3))).toBe(true);
  });
});

describe('nothing before Send reads the hidden cause', () => {
  it('the labour is the same for two alerts that differ only in their cause (same task, same pick)', () => {
    const s = island(8, 2);
    const bleed = raise(s, 'M_BRAKE_SOFT', 0, 'p1', 10);
    const lining = raise(s, 'M_BRAKE_SOFT', 1, 'p1', 10);
    for (const pick of [[], [{ item: '066-19600', qty: 4, slot: 'lining' }]] as PickLine[][]) {
      const d = (a: Alert): Draft => ({ ...newDraft(s, a), step: 'stock', task: 'amm:twin:32-40-02', pick });
      expect(labourOf(s, bleed, d(bleed))).toBe(labourOf(s, lining, d(lining)));
      expect(preview(s, bleed, d(bleed)).text).toBe(preview(s, lining, d(lining)).text);
    }
  });

  it('tier 3 lists nothing before a search and marks nothing likely', () => {
    const s = island(12, 4);
    const a = raise(s, 'M_TIRE_WORN', 0, 'p2', 14);
    expect(manualDefault(s, a)).toMatchObject({ chips: [], results: [], likely: [] });
    expect([...likelyItems(s, a, 'tire')]).toEqual([]);
  });

  it("tiers 0-1 mark each slot's own row: the spa's connectors slot marks a connector, not the EMT stick", () => {
    const s = island(1, 1);
    const a = raise(s, 'E_TAKEOFF_SPA', 0, 'h2', 4);
    const emt = [...likelyItems(s, a, 'emt')];
    const conn = [...likelyItems(s, a, 'connectors')];
    expect(emt).toHaveLength(1);
    expect(itemById(emt[0])!.spec?.raceway).toBe('emt');
    expect(conn).toHaveLength(1);
    expect(itemById(conn[0])!.spec?.device).toBe('connector');
    expect(conn).not.toContain(emt[0]);
    // the wire slot marks the wire the circuit takes, the EGC slot its own size
    const wire = [...likelyItems(s, a, 'wire')];
    const egc = [...likelyItems(s, a, 'egc')];
    expect(wire).toHaveLength(1);
    expect(egc).toHaveLength(1);
  });
});

describe("the electrician's site (6)", () => {
  it('a take-off reads the equipment, not the conductors; a repair reads the breaker and the wire; the heater its own circuit', () => {
    expect(siteWords({ room: 'spa', amps: 60, awg: 6, wet: true, run: 'buried', feet: 43 }, true)).toBe('Spa: 240 V, needs a 60 A GFCI disconnect · pad 43 ft from the panel');
    expect(siteWords({ room: 'spa', amps: 60, awg: 6, wet: true, run: 'buried', feet: 43 }, true)).not.toMatch(/AWG/);
    expect(siteWords({ room: 'dock', amps: 30, awg: 10, wet: true, run: 'buried', feet: 85 }, true)).toBe('Fuel dock pump: 240 V, 30 A · 85 ft underground from the panel');
    expect(siteWords({ room: 'gen', amps: 60, awg: 6, load: 110 }, true)).toBe('Transfer switch: 60 A today · the houses back up 110 A');
    expect(siteWords({ room: 'bath', amps: 20, awg: 12, run: 'nm' })).toBe('Bathroom · 20 A breaker, 12 AWG NM\u2011B');
    expect(siteWords({ room: 'bath', amps: 30, awg: 10, what: 'Water heater', poles: 2 })).toBe('Water heater · 30 A 2\u2011pole breaker, 10 AWG');
  });

  it("the trace and the meter play the alert's own circuit: its room, its breaker, its complaint", () => {
    const s = island(12, 4);
    const site = (sym: string, cause: number, assetId = 'h1') => {
      const al = raise(s, sym, cause, assetId);
      const task = fixTaskFor(s, al)!;
      const next = apply(s, { t: 'plan', role: 'elec', alert: al.id, task: task.id, pick: stdPickFor(s, al, task), week: s.week }, NOW + 1);
      expect(next.error).toBeUndefined();
      const o = next.s.orders.find((x) => x.flow?.alert === al.id)!;
      return launchFor(next.s, o, 'elec').context?.site;
    };
    const hall = site('E_SWITCH_WARM', 1)!;
    expect(hall).toMatchObject({ room: 'Hall', device: 'switch', fault: 'warm' });
    expect([15, 20]).toContain(hall.amps);
    expect(site('E_FLICKER', 0)).toMatchObject({ room: 'Living room', fault: 'neutral' });
    expect(site('E_APPLIANCE', 0)).toMatchObject({ single: true, amps: 20, fault: 'warm' });
    expect(site('E_DEAD_OUTLET', 0)).toMatchObject({ fault: 'dead' });
  });
});

describe('the puzzles label what the tech picked (display only)', () => {
  const pickOf = (lines: { item: string; qty: number; slot?: string }[]): NonNullable<PuzzleContext['pick']> =>
    lines.map((l) => {
      const x = itemById(l.item)!;
      return { pn: x.pn, nomen: x.nomen, qty: l.qty, ...(l.slot ? { slot: l.slot } : {}), ...(x.spec ? { spec: x.spec } : {}) };
    });

  it('wireup: the device, and nothing without one', () => {
    expect(pickedDevice(pickOf([{ item: 'KG20-TR', qty: 1, slot: 'gfci' }]))).toBe('KG20-TR · GFCI receptacle 20 A');
    expect(pickedDevice(pickOf([{ item: 'KS3', qty: 1 }]))).toBe('KS3 · Switch');
    expect(pickedDevice(pickOf([{ item: 'WN-ASST', qty: 1 }]))).toBeNull();
    expect(pickedDevice(undefined)).toBeNull();
    const bare = generateWireup(7, 2, [], 'gfci');
    const labelled = generateWireup(7, 2, [], 'gfci', pickOf([{ item: 'KG20-TR', qty: 1, slot: 'gfci' }]));
    expect(labelled.picked).toBe('KG20-TR · GFCI receptacle 20 A');
    expect({ ...labelled, picked: null }).toEqual(bare);
  });

  it('panel: the panelboard (or the transfer switch) a lot brings', () => {
    expect(pickedPanel(pickOf([{ item: 'LOT-DIST', qty: 1 }]))).toBe('600 A distribution panelboard · LOT-DIST');
    expect(pickedPanel(pickOf([{ item: 'LOT-XFER', qty: 1 }]))).toBe('automatic transfer switch sized to the standby set · LOT-XFER');
    expect(pickedPanel(pickOf([{ item: 'KP120', qty: 1 }]))).toBeNull();
    const bare = generatePanel(5, 3, [], 'panelUp');
    const labelled = generatePanel(5, 3, [], 'panelUp', pickOf([{ item: 'LOT-DIST', qty: 1 }]));
    expect({ ...labelled, picked: null }).toEqual(bare);
  });

  it("meter: the shower tingle's two places (the heater run, the bonding path)", () => {
    for (let tier = 0; tier <= 5; tier++) {
      const h = generateMeter(3, tier, [], 'heater');
      expect(h.items[h.items.length - 1].name).toBe('Water heater');
      const b = generateMeter(3, tier, [], 'bond');
      expect(b.items[b.items.length - 1].name).toBe('Shower valve');
    }
    const heaterNames = new Set(Array.from({ length: 20 }, (_, i) => generateMeter(i + 1, 3, [], 'heater').items.map((x) => x.name)).flat());
    expect(heaterNames.has('Bath outlet') || heaterNames.has('Hall outlet')).toBe(true);
    const bondNames = new Set(Array.from({ length: 20 }, (_, i) => generateMeter(i + 1, 3, [], 'bond').items.map((x) => x.name)).flat());
    expect(['Panel ground bar', 'Water entrance', "Heater's piping"].some((n) => bondNames.has(n))).toBe(true);
  });
});
