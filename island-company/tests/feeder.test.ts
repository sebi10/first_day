// The underground feeder to the east cottages has its own hands-on scene (the
// trace puzzle's job 'feeder': a site plan, the megger at the hand holes, the
// dig, the close-out), never the branch-circuit room ("Bedroom is dead ·
// Drywall cutaway"). Every way a feeder job is launched plays it: the job
// flow's feeder job, the split-bolt splice's repair, the scene's own defect and
// its repair, a legacy catalog order and a defect the live build planted. The
// material still matters (split bolts → the split-bolt defect), and the blind
// sign-off gives nothing away.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { markInput } from '../src/puzzles/kit';
import { faultSeg, generateTrace, trace } from '../src/puzzles/trace';
import type { PuzzleContext, PuzzleResult } from '../src/puzzles/types';
import { raiseAlert } from '../src/sim/alerts';
import { DEFECT_RULES, FEEDER_REDIG, defectRule } from '../src/sim/data';
import { apply, createIsland } from '../src/sim/engine';
import { repairTask, stdPickFor } from '../src/sim/flow';
import { migrate } from '../src/sim/migrate';
import { taskById } from '../src/sim/tasks';
import { addStarter } from '../src/sim/stock';
import type { Alert, Defect, IslandState, Order, PickLine, Role } from '../src/sim/types';
import type { Fx } from '../src/ui/feedback';
import { launchFor } from '../src/ui/select';
import { C } from '../src/ui/theme';

vi.setConfig({ testTimeout: 30000 });

const NOW = Date.UTC(2026, 8, 28, 10);
const ROOM = /Drywall|cutaway|Bedroom|Kitchen|Bath|Porch|Living room|loose backstab|outlet/;

// ---------------------------------------------------------------------------
// the island

/** a started island at week `week`, tier `tier`: the grid, the cottages, the starter shelf, no work open */
function island(week = 8, tier = 3): IslandState {
  let s = createIsland({ id: `fd${week}${tier}`, name: 'Feeder Isle', now: NOW, tz: 'UTC', seed: 11, creator: { uid: 'a', name: 'Seb', role: 'fin' } });
  s = apply(s, { t: 'join', uid: 'b', name: 'Ana', role: 'mech' }, NOW).s;
  s = apply(s, { t: 'join', uid: 'c', name: 'Eli', role: 'elec' }, NOW).s;
  for (const r of ['mech', 'elec', 'fin'] as Role[]) s = apply(s, { t: 'week0Done', role: r }, NOW).s;
  s.week = week;
  s.tier = tier;
  s.cash = 30000;
  addStarter(s, tier);
  s.orders = [];
  s.alerts = [];
  for (const p of Object.values(s.players)) if (p) p.graceUntil = 0;
  return s;
}
const grid = (s: IslandState) => s.assets.find((a) => a.model === 'panel')!;
/** the utility's feeder drop, its cause the buried splice */
const feederAlert = (s: IslandState): Alert => raiseAlert(s, { role: 'elec', asset: grid(s), sym: 'E_FEEDER_DROP', cause: 0 }, NOW);

/** plan the feeder job with this pick (stocked; the standard pick if none), approve it, and return it ready */
function feederJob(s: IslandState, pick?: PickLine[]): { s: IslandState; o: Order; al: Alert } {
  const al = feederAlert(s);
  const task = taskById('ref:feeder')!;
  const lines = pick ?? stdPickFor(s, al, task);
  for (const l of lines) s.inv![l.item] = { on: 20 };
  // the shop's megger (a tool is a shelf line too)
  for (const t of task.tools) s.inv![t] = { on: 1 };
  let r = apply(s, { t: 'plan', role: 'elec', alert: al.id, task: 'ref:feeder', pick: lines, week: s.week }, NOW);
  expect(r.error).toBeUndefined();
  let o = r.s.orders.find((x) => x.flow?.alert === al.id)!;
  if (o.status === 'pending') {
    r = apply(r.s, { t: 'approve', orderId: o.id, week: r.s.week }, NOW);
    expect(r.error).toBeUndefined();
    o = r.s.orders.find((x) => x.id === o.id)!;
  }
  expect(o.status).toBe('ready');
  return { s: r.s, o, al };
}

const complete = (s: IslandState, o: Order, score: number, data?: Record<string, unknown>) => {
  const r = apply(s, { t: 'complete', role: o.role, orderId: o.id, score, perfect: score >= 0.95, ...(data ? { data } : {}) }, NOW);
  expect(r.error).toBeUndefined();
  return r.s;
};
/** every seat ends the turn: the week resolves, with no autopilot */
const endAll = (s: IslandState) => {
  for (const r of ['mech', 'elec', 'fin'] as Role[]) s = apply(s, { t: 'endTurn', role: r, week: s.week }, NOW).s;
  return s;
};
/** a defect comes due (an incident at the resolve), then its repair alert is planned as the tech would */
function surface(s: IslandState, d: Defect): { s: IslandState; o: Order } {
  d.dueWeek = s.week;
  s = endAll(s);
  const al = s.alerts!.find((a) => a.status === 'open' && a.repair?.defect.id === d.id)!;
  expect(al, 'a repair alert').toBeTruthy();
  const task = repairTask(s, al)!;
  let r = apply(s, { t: 'plan', role: al.role, alert: al.id, task: task.id, pick: [], week: s.week }, NOW);
  expect(r.error).toBeUndefined();
  let o = r.s.orders.find((x) => x.flow?.alert === al.id)!;
  if (o.status === 'pending') {
    r = apply(r.s, { t: 'approve', orderId: o.id, week: r.s.week }, NOW);
    o = r.s.orders.find((x) => x.id === o.id)!;
  }
  return { s: r.s, o };
}

// ---------------------------------------------------------------------------
// the puzzle, headless (a recording canvas, a manual frame clock, synthetic pointer events)

const W = 390;
const H = 640;
type Text = { text: string; x: number; y: number };
let now = 0;
let frames: ((t: number) => void)[] = [];
beforeEach(() => {
  now = 1000;
  frames = [];
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount(o: { seed: number; tier: number; blind: boolean; context?: PuzzleContext }) {
  const texts: Text[] = [];
  const inks: string[] = [];
  const on: Record<string, ((e: { clientX: number; clientY: number; pointerId: number; preventDefault(): void }) => void)[]> = {};
  const st: Record<string | symbol, unknown> = { fillStyle: '#000', strokeStyle: '#000' };
  const ctx = new Proxy(st, {
    get(t, k) {
      // about a Manrope glyph's advance at the font's size (fitLabel shrinks a long line to fit)
      if (k === 'measureText') return (s: string) => ({ width: s.length * 0.56 * Number(/(\d+(\.\d+)?)px/.exec(String(t.font))?.[1] ?? 12) });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
      if (k === 'fillText') return (text: string, x: number, y: number) => texts.push({ text, x, y });
      if (k === 'fill' || k === 'fillRect') return () => inks.push(String(t.fillStyle));
      if (k === 'stroke' || k === 'strokeRect') return () => inks.push(String(t.strokeStyle));
      if (k in t) return t[k];
      return () => {};
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  });
  const canvas = {
    style: {},
    width: 0,
    height: 0,
    getContext: () => ctx,
    addEventListener: (type: string, f: (typeof on)[string][number]) => (on[type] ??= []).push(f),
    removeEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }),
    setPointerCapture() {},
    remove() {},
  };
  vi.stubGlobal('document', { createElement: () => canvas });
  const sounds: string[] = [];
  const fx = new Proxy({}, { get: (_t, k) => () => sounds.push(String(k)) }) as Fx;
  let held: { r: PuzzleResult; ms: number } | null = null;
  const el = { appendChild() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }) } as unknown as HTMLElement;
  const inst = trace.mount(
    { el, fx, done: (r) => (held ??= { r, ms: 0 }), hold: (r, ms) => (held ??= { r, ms }), status: () => {}, paused: () => false },
    { seed: o.seed, tier: o.tier, tools: [], reducedMotion: true, blind: o.blind, context: o.context },
  );
  const fire = (type: string, x: number, y: number) => {
    for (const f of on[type] ?? []) f({ clientX: x, clientY: y, pointerId: 1, preventDefault() {} });
  };
  const run = {
    texts,
    inks,
    sounds,
    inst,
    get held() {
      return held;
    },
    step(secs: number) {
      for (let t = 0; t < secs; t += 1 / 60) {
        now += 1000 / 60;
        markInput();
        for (const f of frames.splice(0)) f(now);
      }
    },
    clear() {
      texts.length = 0;
      inks.length = 0;
    },
    fire,
    tap(x: number, y: number) {
      fire('pointerdown', x, y);
      fire('pointerup', x, y);
      run.step(0.1);
    },
    drew: (re: RegExp | string) => texts.some((t) => (typeof re === 'string' ? t.text === re : re.test(t.text))),
  };
  run.step(0.1);
  return run;
}
type Run = ReturnType<typeof mount>;

/** the puzzle's own layout: the yard's rectangle */
const S = (p: { x: number; y: number }) => ({ x: 10 + p.x * (W - 20), y: 54 + p.y * (H - 54 - 96) });
const mid = (pts: { x: number; y: number }[]) => {
  const len = pts.slice(1).map((q, i) => Math.hypot(q.x - pts[i].x, q.y - pts[i].y));
  let d = len.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < len.length; i++) {
    if (d <= len[i]) return { x: pts[i].x + ((pts[i + 1].x - pts[i].x) * d) / len[i], y: pts[i].y + ((pts[i + 1].y - pts[i].y) * d) / len[i] };
    d -= len[i];
  }
  return pts[pts.length - 1];
};
/** Dig here, dig at `at` (normalised), then re-energize */
function dig(run: Run, at: { x: number; y: number }, reenergize = true) {
  run.tap(W * 0.75, H - 48);
  const q = S(at);
  run.tap(q.x, q.y);
  if (reenergize) {
    run.tap(W / 2, H - 48);
    run.step(1);
  }
}

// ---------------------------------------------------------------------------

describe('every feeder launch plays the underground scene, never the room', () => {
  it("the job flow's feeder job: the trace puzzle on job 'feeder', the alert's 100 A feeder, and nothing of a room is drawn", () => {
    const { s, o } = feederJob(island());
    expect(o).toMatchObject({ kind: 'feeder', puzzle: 'trace', job: 'feeder' });
    const L = launchFor(s, o, 'elec');
    expect(L.puzzle).toBe('trace');
    expect(L.context?.job).toBe('feeder');
    expect(L.context?.site?.amps).toBe(100);
    expect(trace.titleFor?.(L.context)).toBe('Underground feeder');
    const run = mount({ seed: L.seed, tier: L.tier, blind: !!L.blind, context: L.context });
    expect(run.drew(/^Site plan · 100 A feeder, direct-buried/)).toBe(true);
    expect(run.drew('Feeder to the east cottages: 0.4 MΩ')).toBe(true);
    expect(run.drew('HH1')).toBe(true);
    for (const t of run.texts) expect(t.text, t.text).not.toMatch(ROOM);
  });

  it('split bolts in the ground still become the split-bolt defect, and its repair (the re-splice) is the underground scene', () => {
    let { s, o } = feederJob(island(), [{ item: 'SPLIT-4', qty: 4, slot: 'splice' }]);
    s = complete(s, o, 0.97, { defect: 'feeder' });
    const d = s.defects!.find((x) => x.variant === 'noburial')!;
    expect(d).toMatchObject({ puzzle: 'elec', orderKind: 'feeder', job: 'feeder' });
    // the material's sure defect replaces the scene's quality roll: one defect for the job
    expect(s.defects!.filter((x) => x.orderKind === 'feeder')).toHaveLength(1);
    expect(DEFECT_RULES['elec:noburial'].fix).toMatchObject({ puzzle: 'trace', job: 'feeder', title: 'Cut it out and re-splice with a direct-burial kit' });
    const rep = surface(s, d);
    expect(rep.o).toMatchObject({ kind: 'repair', puzzle: 'trace', job: 'feeder', title: 'Cut it out and re-splice with a direct-burial kit' });
    const L = launchFor(rep.s, rep.o, 'elec');
    expect(L.context?.job).toBe('feeder');
    const run = mount({ seed: L.seed, tier: L.tier, blind: !!L.blind, context: L.context });
    expect(run.drew('Feeder to the east cottages: 0.4 MΩ')).toBe(true);
    for (const t of run.texts) expect(t.text, t.text).not.toMatch(ROOM);
    // the right kits: no defect from the material (the scene's result decides)
    const good = feederJob(island());
    expect(good.o.flow!.pick.map((l) => l.item)).toContain('DBS-2');
    const after = complete(good.s, good.o, 0.97, { defect: 'feeder' });
    expect((after.defects ?? []).filter((x) => x.orderKind === 'feeder')).toHaveLength(0);
  });

  it("the scene's own miss leaves the feeder's defect (not the room's loose backstab), and its repair, and that repair's miss, stay underground", () => {
    let { s, o } = feederJob(island());
    // a dig in the wrong section: the scene hands in a low score with its variant
    s = complete(s, o, 0.05, { defect: 'feeder' });
    const d = s.defects!.find((x) => x.orderKind === 'feeder')!;
    expect(d).toMatchObject({ puzzle: 'trace', variant: 'feeder', redo: false });
    expect(defectRule(d.puzzle, d.role, d.orderKind, d.variant)).toBe(FEEDER_REDIG);
    const rep = surface(s, d);
    expect(rep.o).toMatchObject({ kind: 'repair', puzzle: 'trace', job: 'feeder' });
    expect(launchFor(rep.s, rep.o, 'elec').context?.job).toBe('feeder');
    // the repair botched again: the same scene's defect, never DEFECT_RULES.trace (a scorched outlet in a room)
    const again = complete(rep.s, rep.o, 0.05, { defect: 'feeder' });
    const d2 = again.defects!.find((x) => x.orderKind === 'repair' && x.id !== d.id)!;
    expect(defectRule(d2.puzzle, d2.role, d2.orderKind, d2.variant)).toBe(FEEDER_REDIG);
    expect(defectRule(d2.puzzle, d2.role, d2.orderKind, d2.variant)).not.toBe(DEFECT_RULES.trace);
    // a result with no variant (autopilot, the paper sim, a client from before the scene): the kind row, the same defect
    expect(defectRule('trace', 'elec', 'feeder')).toBe(FEEDER_REDIG);
  });
});

describe('docs the live build wrote', () => {
  it('a legacy catalog feeder order (no job stored) launches the underground scene after the v2 → v3 migration', () => {
    const doc = migrate(JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures', 'v2-6c0c426-kits.json'), 'utf8')));
    const o = doc.orders.find((x) => x.kind === 'feeder' && x.status === 'ready')!;
    expect(o.puzzle).toBe('trace');
    const L = launchFor(doc, o, 'elec');
    expect(L.context?.job).toBe('feeder');
    expect(generateTrace(L.seed, L.tier, L.tools, L.context?.job, L.context?.site).feeder).toBeDefined();
  });

  it('a feeder defect the live build planted (no variant) surfaces as the underground re-dig; a repair it already wrote up plays as written', () => {
    const s = island();
    const g = grid(s);
    // as the live build's quality roll wrote it
    const d: Defect = { id: 'dlive', orderKind: 'feeder', job: 'feeder', log: 'feeder trace', puzzle: 'trace', title: 'Feeder re-splice', assetId: g.id, role: 'elec', by: 'elec', name: 'Eli', week: s.week - 1, dueWeek: s.week + 2, severity: 1, cost: 300, tier: 2, gain: 16, redo: true };
    (s.defects ??= []).push(d);
    // and a repair from the live build's old feeder row (a receptacle wire-up), already open
    const old: Order = {
      id: 'olive', role: 'elec', kind: 'repair', assetId: g.id, title: 'Replace the burnt splice on the feeder', puzzle: 'wireup', tier: 2, cost: 250, parts: 0, gain: 6,
      createdWeek: s.week - 1, deferrals: 0, lastDeferredWeek: null, seed: 99, status: 'ready', job: 'outlet', approvedWeek: s.week - 1,
      repair: { defect: { ...d, id: 'dold' }, via: 'incident', problem: 'a loose wire-nut splice in the feeder junction box' },
    };
    s.orders.push(old);
    expect(launchFor(s, old, 'elec')).toMatchObject({ puzzle: 'wireup' });
    const rep = surface(s, s.defects!.find((x) => x.id === 'dlive')!);
    expect(rep.o).toMatchObject({ kind: 'repair', puzzle: 'trace', job: 'feeder' });
    expect(launchFor(rep.s, rep.o, 'elec').context?.job).toBe('feeder');
    // the old repair is untouched by the resolve
    expect(rep.s.orders.find((x) => x.id === 'olive')).toMatchObject({ puzzle: 'wireup', job: 'outlet' });
  });
});

describe('the scene: dig, close it up, re-energize; blind gives nothing away', () => {
  const TIER = 3;
  const SEED = 5;
  const ctx: PuzzleContext = { job: 'feeder', site: { amps: 100, fault: 'dead' }, pick: [{ pn: 'DBS-2', nomen: 'Direct-burial splice kit', qty: 4, slot: 'splice', spec: { device: 'splice', burial: true } }] };
  const m = generateTrace(SEED, TIER, [], 'feeder', ctx.site);
  const right = mid(faultSeg(m).pts);
  const wrongSeg = m.segs.find((s) => s.circuit === 1 && s !== faultSeg(m) && m.chain.includes(s.to))!;
  const wrong = mid(wrongSeg.pts);

  it('not blind: a hand hole is not the dig (an X, carry on); the right section opens the close-out, then the verdict', () => {
    const run = mount({ seed: SEED, tier: TIER, blind: false, context: ctx });
    dig(run, m.devices[faultSeg(m).from].pos, false);
    expect(run.sounds).toContain('bad');
    expect(run.drew('Close it up')).toBe(false);
    const q = S(right);
    run.tap(q.x, q.y);
    expect(run.drew('Close it up')).toBe(true);
    expect(run.drew(/: split bolts and tape, cracked$/)).toBe(true);
    expect(run.drew('Cut out the bad length; re-spliced: DBS-2 × 4')).toBe(true);
    expect(run.drew(/^Megger again from the panel: L1, L2, N [\d,]+ MΩ to ground$/)).toBe(true);
    expect(run.drew('Backfill: 24 in of cover, a warning ribbon 12 in above (300.5)')).toBe(true);
    expect(run.drew('Re-energize the feeder')).toBe(true);
    expect(run.held).toBeNull();
    run.tap(W / 2, H - 48);
    run.step(1);
    expect(run.held?.r.data).toEqual({ defect: 'feeder' });
    expect(run.held?.r.summary).toMatch(/^failed splice found after 1 wrong call/);
    expect(run.drew('split bolts + tape, cracked')).toBe(true);
  });

  it('blind: the same true score as the open run, no reveal, the same hand-in time right or wrong', () => {
    const open = mount({ seed: SEED, tier: TIER, blind: false, context: ctx });
    dig(open, right);
    const blindRight = mount({ seed: SEED, tier: TIER, blind: true, context: ctx });
    dig(blindRight, right, false);
    expect(blindRight.drew(/^Dug between HH\d and (HH\d|the cottages), down to the cable at 24 in$/)).toBe(true);
    expect(blindRight.drew('Megger L1, L2 and N again before re-energizing (110.7)')).toBe(true);
    expect(blindRight.drew(/split bolts/)).toBe(false);
    blindRight.tap(W / 2, H - 48);
    blindRight.step(1);
    expect(blindRight.held?.r).toEqual(open.held?.r);
    const blindWrong = mount({ seed: SEED, tier: TIER, blind: true, context: ctx });
    dig(blindWrong, wrong);
    expect(blindWrong.held?.r.score).toBeLessThan(0.3);
    expect(blindWrong.held?.r.data).toEqual({ defect: 'feeder' });
    for (const run of [blindRight, blindWrong]) {
      expect(run.held?.ms).toBe(700);
      expect(run.drew(/split bolts \+ tape|not found|first try|✓|✗/)).toBe(false);
      // tier 3: the megger's numbers are plain ink, and no end-of-job colours
      expect(run.inks.some((i) => i === C.rust || i === C.palm)).toBe(false);
      for (const v of ['bad', 'fault', 'flourish']) expect(run.sounds, v).not.toContain(v);
      for (const t of run.texts) expect(t.text, t.text).not.toMatch(ROOM);
    }
  });

  it('time up before the dig: the failed splice is still in the ground (a low score, the same defect)', () => {
    const run = mount({ seed: SEED, tier: TIER, blind: true, context: ctx });
    const r = run.inst.timeUp();
    expect(r.score).toBeLessThan(0.3);
    expect(r.data).toEqual({ defect: 'feeder' });
    expect(r.summary).toMatch(/^failed splice not found/);
  });

  it('a tap on a hand hole meggers it; a drag that starts on one follows the cable instead', () => {
    const run = mount({ seed: SEED, tier: TIER, blind: true, context: ctx });
    const hh = S(m.devices[m.chain[1]].pos);
    run.clear();
    run.tap(hh.x, hh.y);
    expect(run.drew(/^[\d,.]+ MΩ$/)).toBe(true);
    expect(run.inst.timeUp().summary).toMatch(/, 1 megger tests/);
    // a fresh run: from the panel along the run to HH1, then on from HH1 toward HH2 (the drag starts on HH1)
    const run2 = mount({ seed: SEED, tier: TIER, blind: true, context: ctx });
    const drag = (pts: { x: number; y: number }[]) => {
      const q = pts.map(S);
      run2.fire('pointerdown', q[0].x, q[0].y);
      for (let k = 1; k < q.length; k++) for (let j = 1; j <= 20; j++) run2.fire('pointermove', q[k - 1].x + ((q[k].x - q[k - 1].x) * j) / 20, q[k - 1].y + ((q[k].y - q[k - 1].y) * j) / 20);
      run2.fire('pointerup', q[q.length - 1].x, q[q.length - 1].y);
      run2.step(0.1);
    };
    drag(m.segs.find((x) => x.from === m.chain[0] && x.to === m.chain[1])!.pts);
    drag(m.segs.find((x) => x.from === m.chain[1] && x.to === m.chain[2])!.pts);
    expect(run2.inst.timeUp().summary).toMatch(/, 0 megger tests/);
  });
});
