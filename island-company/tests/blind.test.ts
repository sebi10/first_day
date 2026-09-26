// Blind sign-off in the crack hunt, hydraulic servicing, ground power start,
// and the paperwork puzzles (IPC parts lookup, logbook research).
// Each puzzle is mounted headless (a recording canvas, a manual frame clock and
// synthetic pointer events; the paperwork puzzles on a small DOM), played the
// same way with and without `blind`, and what it draws and plays is compared:
// the teaching run gets its verdict and reveal, the blind run gets none, and
// both hand in the same true score.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { crack, distToInd, generateCrack, styleOf } from '../src/puzzles/crack';
import { generateGpu, gpu } from '../src/puzzles/gpu';
import { hydraulics } from '../src/puzzles/hydraulics';
import { generateIpc, ipc, scoreIpc } from '../src/puzzles/ipc';
import { markInput } from '../src/puzzles/kit';
import { FIELDS_FOR, generateLogbook, idealAnswer, logbook, rightValues, scoreLogbook, type LbModel, type LbRoute } from '../src/puzzles/logbook';
import type { PuzzleContext, PuzzleDef, PuzzleResult } from '../src/puzzles/types';
import type { Fx } from '../src/ui/feedback';
import { C } from '../src/ui/theme';
import { MiniEl, miniDocument, textOf } from './minidom';

const W = 390;
const H = 640;
const VERDICT = ['bad', 'fault', 'good', 'flourish'];

type Text = { text: string; x: number; y: number; fill: string };
type Arc = { x: number; y: number; r: number };
type Ink = { op: 'fill' | 'stroke'; style: string };
type Listener = (e: { clientX: number; clientY: number; pointerId: number; preventDefault(): void }) => void;

/** a 2D context that records text (with the translate offset it was drawn at) and the colours it fills and strokes with */
function recorder(texts: Text[], inks: Ink[], arcs: Arc[]) {
  const st: Record<string | symbol, unknown> = { fillStyle: '#000', strokeStyle: '#000', font: '10px sans-serif', globalAlpha: 1 };
  const stack: [number, number][] = [];
  let off: [number, number] = [0, 0];
  const grad = { addColorStop() {} };
  return new Proxy(st, {
    get(t, k) {
      switch (k) {
        case 'measureText':
          return (s: string) => ({ width: s.length * 6.5 });
        case 'createLinearGradient':
        case 'createRadialGradient':
          return () => grad;
        case 'getLineDash':
          return () => [];
        case 'save':
          return () => stack.push([...off]);
        case 'restore':
          return () => (off = stack.pop() ?? [0, 0]);
        case 'translate':
          return (x: number, y: number) => (off = [off[0] + x, off[1] + y]);
        case 'setTransform':
          return () => (off = [0, 0]);
        case 'arc':
          return (x: number, y: number, r: number) => arcs.push({ x: x + off[0], y: y + off[1], r });
        case 'fillText':
          return (text: string, x: number, y: number) => texts.push({ text, x: x + off[0], y: y + off[1], fill: String(t.fillStyle) });
        case 'fill':
        case 'fillRect':
          return () => inks.push({ op: 'fill', style: String(t.fillStyle) });
        case 'stroke':
        case 'strokeRect':
          return () => inks.push({ op: 'stroke', style: String(t.strokeStyle) });
      }
      if (k in t) return t[k];
      return () => {};
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  });
}

function fakeCanvas(texts: Text[], inks: Ink[], arcs: Arc[]) {
  const on: Record<string, Listener[]> = {};
  const ctx = recorder(texts, inks, arcs);
  return {
    style: {} as Record<string, string>,
    width: 0,
    height: 0,
    getContext: () => ctx,
    addEventListener: (type: string, f: Listener) => (on[type] ??= []).push(f),
    removeEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }),
    setPointerCapture() {},
    remove() {},
    fire(type: string, x: number, y: number, id = 1) {
      for (const f of on[type] ?? []) f({ clientX: x, clientY: y, pointerId: id, preventDefault() {} });
    },
  };
}
type Canvas = ReturnType<typeof fakeCanvas>;

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

/** Mount a puzzle headless. Everything it draws, says and plays is recorded. */
function mount(def: PuzzleDef, o: { seed: number; tier: number; blind: boolean; job?: string; assetName?: string; motion?: boolean }) {
  const texts: Text[] = [];
  const inks: Ink[] = [];
  const arcs: Arc[] = [];
  const canvases: Canvas[] = [];
  vi.stubGlobal('document', {
    createElement: () => {
      const c = fakeCanvas(texts, inks, arcs);
      canvases.push(c);
      return c;
    },
  });
  const sounds: string[] = [];
  const fx = new Proxy({}, { get: (_t, k) => () => sounds.push(String(k)) }) as Fx;
  const statuses: string[] = [];
  let held: { r: PuzzleResult; ms: number } | null = null;
  const el = { appendChild() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }) } as unknown as HTMLElement;
  const inst = def.mount(
    {
      el,
      fx,
      done: (r) => (held ??= { r, ms: 0 }),
      hold: (r, ms) => (held ??= { r, ms }),
      status: (s) => statuses.push(s),
      paused: () => false,
    },
    { seed: o.seed, tier: o.tier, tools: [], reducedMotion: !o.motion, blind: o.blind, context: { job: o.job, assetName: o.assetName } },
  );
  const cv = canvases[0];
  const run = {
    texts,
    inks,
    arcs,
    sounds,
    statuses,
    get held() {
      return held;
    },
    /** advance the frame clock (60 fps) */
    step(secs: number) {
      for (let t = 0; t < secs; t += 1 / 60) {
        now += 1000 / 60;
        markInput();
        const q = frames.splice(0);
        for (const f of q) f(now);
      }
    },
    /** forget what was drawn so far (to look at the next frames only) */
    clear() {
      texts.length = 0;
      inks.length = 0;
      arcs.length = 0;
    },
    fire: (type: string, x: number, y: number, id = 1) => cv.fire(type, x, y, id),
    tap(x: number, y: number, id = 1) {
      cv.fire('pointerdown', x, y, id);
      cv.fire('pointerup', x, y, id);
    },
    press(x: number, y: number, secs: number, id = 1) {
      cv.fire('pointerdown', x, y, id);
      run.step(secs);
      cv.fire('pointerup', x, y, id);
    },
    /** where a label was last drawn (a button's caption sits at its centre) */
    at(text: string | RegExp) {
      const hit = [...texts].reverse().find((t) => (typeof text === 'string' ? t.text === text : text.test(t.text)));
      if (!hit) throw new Error(`"${text}" was not drawn`);
      return hit;
    },
    drew: (text: string | RegExp) => texts.some((t) => (typeof text === 'string' ? t.text === text : text.test(t.text))),
    inst,
  };
  run.step(0.1);
  return run;
}

// ---------------------------------------------------------------------------

/** crack.ts lays the part out from the stage size and the part's aspect */
function crackXY(aspect: number, q: { x: number; y: number }) {
  const top = 40;
  const bottom = H - 52 - 14 - 20 - 16;
  const availH = Math.max(80, bottom - top);
  const s = Math.min((W - 16) / aspect, availH);
  return { x: (W - s * aspect) / 2 + q.x * s, y: top + (availH - s) * 0.62 + q.y * s };
}

describe('crack hunt: a blind sign-off gives nothing away', () => {
  const SEED = 3;
  const TIER = 3;
  const play = (blind: boolean) => {
    const m = generateCrack(SEED, TIER, [], 'spar');
    const run = mount(crack, { seed: SEED, tier: TIER, blind, job: 'spar' });
    // circle a decoy (a tool mark or a thread of penetrant that looks just like a crack)
    const decoy = m.indications.find((i) => i.kind !== 'crack' && styleOf(m, i) === 'line')!;
    const p = crackXY(m.aspect, decoy.pts[Math.floor(decoy.pts.length / 2)]);
    run.tap(p.x, p.y);
    run.step(0.3);
    // and call something on bare metal, well clear of every indication, hole and edge
    const clear = (q: { x: number; y: number }) =>
      q.x > 0.05 && q.x < m.aspect - 0.05 && m.holes.every((h) => Math.hypot(q.x - h.x, q.y - h.y) > h.r + 0.03) && m.indications.every((i) => distToInd(q, i) > 0.1);
    const spots = Array.from({ length: 19 * 11 }, (_, k) => ({ x: (m.aspect * ((k % 11) + 0.5)) / 11, y: (Math.floor(k / 11) + 0.5) / 19 }));
    const bare = crackXY(m.aspect, spots.find(clear)!);
    run.tap(bare.x, bare.y);
    run.step(0.3);
    const sign = run.at('Sign off');
    run.clear();
    run.tap(sign.x, sign.y);
    run.step(1);
    return run;
  };

  it('not blind: rings judged, missed cracks ringed, decoys named, a verdict sound', () => {
    const run = play(false);
    expect(run.held?.r.data).toMatchObject({ found: 0, falseCalls: 2 });
    expect(run.drew('✗')).toBe(true);
    expect(run.drew(/^missed (SCC )?crack$/)).toBe(true);
    expect(run.inks.some((i) => i.op === 'stroke' && i.style === C.rust)).toBe(true);
    expect(run.sounds).toContain('bad');
    expect(run.sounds.some((s) => s === 'good' || s === 'flourish')).toBe(true);
  });

  it('blind: the same run, the same true score, and no reveal of any kind', () => {
    const open = play(false);
    const run = play(true);
    expect(run.held?.r).toEqual(open.held?.r);
    for (const t of ['✗', '✓']) expect(run.drew(t), t).toBe(false);
    expect(run.drew(/missed|tool mark|penetrant|lint|scratch|bleed-out|porosity|specks/)).toBe(false);
    // your rings and your '?' stay grease pencil: never judged green or rust
    expect(run.inks.some((i) => i.style === C.rust || i.style === C.palm)).toBe(false);
    expect(run.drew('?')).toBe(true);
    for (const v of VERDICT) expect(run.sounds, v).not.toContain(v);
    // the same hand-in time whatever the result (a perfect run's longer flourish would tell)
    expect(run.held?.ms).toBe(700);
  });
});

// ---------------------------------------------------------------------------

describe('hydraulic servicing: a blind sign-off gives nothing away', () => {
  /** tier 3: to the accumulator, hook up the OXYGEN bottle, open the charge valve */
  const oxygen = (blind: boolean) => {
    const run = mount(hydraulics, { seed: 5, tier: 3, blind, assetName: 'Twin N-12' });
    const tab = run.at('Accum.');
    run.tap(tab.x, tab.y);
    run.step(0.1);
    const o2 = run.at('OXYGEN');
    run.tap(o2.x, o2.y);
    run.step(0.1);
    const wheel = run.at('CHARGE · hold');
    run.clear();
    run.press(wheel.x, wheel.y - 16, 1.5);
    run.step(0.5);
    return run;
  };

  it('not blind: oxygen in the charging hose stops the job with a STOP card and a fault', () => {
    const run = oxygen(false);
    expect(run.held).not.toBeNull();
    expect(run.held!.r.score).toBeLessThanOrEqual(0.2);
    expect(run.drew('STOP: OXYGEN')).toBe(true);
    expect(run.sounds).toContain('fault');
  });

  it('blind: the valve just opens (the gauge climbs), nothing is called out, and the true score is kept', () => {
    const run = oxygen(true);
    expect(run.held).toBeNull();
    expect(run.drew('STOP: OXYGEN')).toBe(false);
    expect(run.drew(/explosion|hazard/i)).toBe(false);
    for (const v of VERDICT) expect(run.sounds, v).not.toContain(v);
    const sign = run.at('Sign off');
    run.tap(sign.x, sign.y);
    run.step(0.2);
    expect(run.held!.r.score).toBeLessThanOrEqual(0.2);
    expect(run.held!.ms).toBe(600);
    expect(run.sounds).not.toContain('flourish');
  });

  it('tier 2 blind: the step card never ticks itself off, and no green ring at 0 psi', () => {
    for (const blind of [false, true]) {
      const run = mount(hydraulics, { seed: 2, tier: 2, blind });
      // pump the brakes down to 0 psi
      for (let k = 0; k < 40; k++) {
        const pedal = run.at('press');
        run.press(pedal.x, pedal.y, 0.25);
        run.step(0.25);
      }
      // the gauge's green ring when it reaches 0 psi, and the banner's ticked-off steps
      expect(run.inks.some((i) => i.style === C.palm)).toBe(!blind);
      run.clear();
      run.step(0.05);
      if (blind) {
        expect(run.statuses.every((s) => /^Hyd [\d,]+ psi$/.test(s)), run.statuses.join(' | ')).toBe(true);
        expect(run.drew('✓')).toBe(false);
        expect(run.drew(/reads low/)).toBe(false);
      } else {
        expect(run.statuses[0]).toMatch(/^Step 1\/5/);
        expect(run.statuses.at(-1)).toMatch(/^Step 2\/5/);
        expect(run.drew('✓')).toBe(true);
      }
      expect(run.statuses.join(' ')).toMatch(blind ? /Hyd 0 psi/ : /Take the filler cap off/);
    }
  });
});

// ---------------------------------------------------------------------------

describe('ground power start: a blind sign-off gives nothing away', () => {
  // a tier-2 piston single that wants the battery master ON, left with the avionics on
  const seed = Array.from({ length: 200 }, (_, i) => i + 1).find((s) => {
    const m = generateGpu(s, 2);
    return m.ac.master === 'on' && m.init.avionics;
  })!;

  /** avionics OFF (checklist item 1), battery ON, then crank with no cart plugged in */
  const crankOnTheBattery = (blind: boolean) => {
    const run = mount(gpu, { seed, tier: 2, blind });
    const toggle = (name: string) => {
      const t = run.at(name);
      run.tap(t.x, t.y + 33);
      run.step(0.2);
    };
    toggle('AVIONICS');
    if (!generateGpu(seed, 2).init.batt) toggle('BATT');
    const start = run.at('PUSH');
    run.press(start.x, start.y, 0.6);
    run.step(0.3);
    return run;
  };

  it('not blind: the checklist ticks off and the slip is called out', () => {
    const run = crankOnTheBattery(false);
    expect(run.inks.some((i) => i.op === 'fill' && i.style === C.palm)).toBe(true);
    expect(run.drew('Cranked on the flat battery')).toBe(true);
    expect(run.sounds).toContain('bad');
  });

  it('blind: the card lists the items but never ticks them, and the slip is scored, not called out', () => {
    const open = crankOnTheBattery(false);
    const run = crankOnTheBattery(true);
    expect(run.inks.some((i) => i.op === 'fill' && i.style === C.palm)).toBe(false);
    expect(run.drew(/flat battery|Fault/i)).toBe(false);
    expect(run.drew('list ☰')).toBe(true);
    for (const v of VERDICT) expect(run.sounds, v).not.toContain(v);
    // the slip still counts
    expect(run.inst.timeUp().data).toMatchObject({ errors: expect.arrayContaining(['noBus']) });
    expect(run.inst.timeUp().score).toBe(open.inst.timeUp().score);
  });

  it('blind: a live plug still throws sparks and pits the pins (the world), it just is not called out', () => {
    // a plug that seats on the first push, battery master left OFF: the arc is the only thing that happens
    const quiet = Array.from({ length: 200 }, (_, i) => i + 1).find((s) => {
      const m = generateGpu(s, 2);
      // (a master-ON ship's external power relay stays open with the master OFF: no power, no volts to judge)
      return m.ac.master === 'on' && !m.sticky && !m.init.batt;
    })!;
    for (const blind of [false, true]) {
      // (sparks are motion: reduced motion leaves them out)
      const run = mount(gpu, { seed: quiet, tier: 2, blind, motion: true });
      // cart output ON
      const out = run.at('OUTPUT');
      run.tap(out.x, out.y + 41);
      run.step(0.2);
      // the plug sits in its cup on the cart; the receptacle's two main pins are drawn 18 px apart
      const cart = run.at('GROUND POWER');
      const plug = { x: cart.x - 40, y: cart.y - 35 };
      const pins = run.arcs.filter((a) => a.r === 4.5);
      const pin = pins.find((a) => pins.some((b) => Math.abs(b.x - a.x - 18) < 0.01 && Math.abs(b.y - a.y) < 0.01))!;
      const rec = { x: pin.x + 9, y: pin.y + 4 };
      run.clear();
      // pick the plug up and carry it to the receptacle (the plug rides 34 px above the thumb)
      run.fire('pointerdown', plug.x, plug.y);
      run.fire('pointermove', plug.x + 20, plug.y - 20);
      run.fire('pointermove', rec.x, rec.y + 34);
      run.fire('pointerup', rec.x, rec.y + 34);
      run.step(0.1);
      // sparks: short strokes in the lamp colour, blind or not
      expect(run.inks.some((i) => i.op === 'stroke' && i.style === '#F4D35E'), `sparks, blind ${blind}`).toBe(true);
      // and the burnt, pitted main pins stay burnt
      expect(run.inks.some((i) => i.op === 'fill' && i.style === '#5a4034'), `pitted pins, blind ${blind}`).toBe(true);
      expect(run.drew('Plugged in live')).toBe(!blind);
      expect(run.sounds.includes('bad')).toBe(!blind);
      const r = run.inst.timeUp();
      expect(r.data).toMatchObject({ errors: expect.arrayContaining(['arcIn']), defect: 'arc' });
    }
  });
});

// ---------------------------------------------------------------------------
// The paperwork puzzles are HTML: mount them on the small DOM, click through
// ---------------------------------------------------------------------------

/** Mount an HTML puzzle headless: what it shows, says and plays is recorded. */
function mountDom(def: PuzzleDef, o: { seed: number; tier: number; blind: boolean; context?: PuzzleContext }) {
  vi.stubGlobal('document', miniDocument());
  vi.stubGlobal('window', { devicePixelRatio: 1, setTimeout: (f: () => void, ms?: number) => setTimeout(f, ms), clearTimeout: (h: number) => clearTimeout(h) });
  vi.stubGlobal('location', { pathname: '/' });
  const el = new MiniEl('div');
  const sounds: string[] = [];
  const fx = new Proxy({}, { get: (_t, k) => () => sounds.push(String(k)) }) as Fx;
  const statuses: string[] = [];
  let held: { r: PuzzleResult; ms: number } | null = null;
  const inst = def.mount(
    {
      el: el as unknown as HTMLElement,
      fx,
      done: (r) => (held ??= { r, ms: 0 }),
      hold: (r, ms) => (held ??= { r, ms }),
      status: (s) => statuses.push(s),
      paused: () => false,
    },
    { seed: o.seed, tier: o.tier, tools: [], reducedMotion: true, blind: o.blind, context: o.context },
  );
  const find = (sel: string) => {
    const e = el.querySelector(sel);
    if (!e) throw new Error(`nothing matches ${sel}`);
    return e;
  };
  return {
    el,
    sounds,
    statuses,
    inst,
    get held() {
      return held;
    },
    find,
    click: (sel: string) => find(sel).click(),
    text: (sel: string) => textOf(el.querySelector(sel)),
  };
}

const ASSETS = ['Twin N-12', 'Cargo C-7', 'Float F-3'];
/** the verdict words a stamp or a card could say */
const IPC_VERDICT = /WRONG PART|HELD|PULLED|NOT RIGHT|DOESN.T FIT|approved|not in|Needed|Missed|replaced that assembly/i;

describe('IPC parts lookup: a blind sign-off gives nothing away', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** click a parts-list row by its P/N and add it to the request */
  const order = (run: ReturnType<typeof mountDom>, pns: string[]) => {
    for (const pn of pns) {
      const row = run.el.querySelectorAll('.r[data-src="ipc"]').find((r) => textOf(r.querySelector('.rp')) === pn);
      if (!row) throw new Error(`no row ${pn}`);
      row.click();
      run.click('.r.sel [data-add]');
    }
    run.click('[data-act="order"]');
  };

  // tier 5: an STC replaced the assembly, so the IPC part is the wrong part
  const planted = (() => {
    for (const assetName of ASSETS)
      for (let seed = 1; seed <= 40; seed++) {
        const m = generateIpc(seed, 5, [], { assetName });
        if (m.planted) return { seed, assetName, m };
      }
    throw new Error('no planted case');
  })();

  it("not blind: the IPC part on an STC airplane comes back “doesn't fit”, and the job goes on", () => {
    const run = mountDom(ipc, { seed: planted.seed, tier: 5, blind: false, context: { assetName: planted.assetName } });
    order(run, [planted.m.ac.plant!.ipcPn]);
    expect(run.text('.vd')).toMatch(/DOESN.T FIT/);
    expect(run.sounds).toContain('thunk');
    expect(run.held).toBeNull();
  });

  it('blind: the same order goes to stores as written, stamped, with its true score and no reveal', () => {
    const run = mountDom(ipc, { seed: planted.seed, tier: 5, blind: true, context: { assetName: planted.assetName } });
    const pn = planted.m.ac.plant!.ipcPn;
    order(run, [pn]);
    const card = run.text('.vd');
    expect(card).toContain('ORDERED');
    expect(card).toContain(pn);
    expect(card).not.toMatch(IPC_VERDICT);
    for (const t of ['✓', '✗']) expect(card, t).not.toContain(t);
    for (const w of planted.m.why) expect(card).not.toContain(w);
    for (const v of [...VERDICT, 'thunk']) expect(run.sounds, v).not.toContain(v);
    // the true score: the wrong part, ordered without checking the records
    const truth = scoreIpc(planted.m, { lines: [{ pn, qty: 1, src: 'ipc' }], marks: {} });
    expect(run.held!.r.score).toBe(truth.score);
    expect(run.held!.r.score).toBeLessThanOrEqual(0.35);
    expect(run.held!.ms).toBe(1600);
    expect(run.statuses.join(' ')).not.toContain(truth.summary);
  });

  it('blind and not: the same order, the same result; only the open run gets the stamp, the ticks and the why', () => {
    // tier 3: a plain IPC job, ordered right and ordered wrong
    const m = generateIpc(7, 3, [], { assetName: 'Cargo C-7' });
    const wrong = m.fig.rows.find((r) => r.applies && r.upa !== 'RF' && !r.np && !m.expect.some((e) => e.accept.includes(r.pn)))!;
    for (const pns of [m.expect.map((e) => e.pn), [wrong.pn]]) {
      const open = mountDom(ipc, { seed: 7, tier: 3, blind: false, context: { assetName: 'Cargo C-7' } });
      order(open, pns);
      const run = mountDom(ipc, { seed: 7, tier: 3, blind: true, context: { assetName: 'Cargo C-7' } });
      order(run, pns);
      expect(run.held!.r).toEqual(open.held!.r);
      expect(open.text('.vd')).toMatch(/PULLED|NOT RIGHT|WRONG PART/);
      expect(open.text('.vd')).toMatch(/[✓✗]/);
      expect(open.sounds.some((s) => VERDICT.includes(s))).toBe(true);
      const card = run.text('.vd');
      expect(card).toContain('ORDERED');
      expect(card).not.toMatch(/[✓✗]/);
      expect(card).not.toMatch(IPC_VERDICT);
      for (const v of VERDICT) expect(run.sounds, v).not.toContain(v);
      // the same hand-in time whatever it scored
      expect(run.held!.ms).toBe(1600);
    }
  });

  it("tier 2 blind: the coach follows your steps, never whether the part on the request is the answer", () => {
    // a teaching job whose answer brings a second part (the code-3 set or an AMM part)
    const pick = (() => {
      for (const assetName of ASSETS)
        for (let seed = 1; seed <= 60; seed++) {
          const m = generateIpc(seed, 2, [], { assetName });
          if (m.teach && !m.premarked && m.expect.length > 1) return { seed, assetName, m };
        }
      throw new Error('no two-part tier-2 job');
    })();
    const { m } = pick;
    const wrong = m.fig.rows.find((r) => r.upa !== 'RF' && !r.np && !m.expect.some((e) => e.accept.includes(r.pn) || e.old?.pn === r.pn))!;
    const coachAfter = (blind: boolean, pn: string) => {
      const run = mountDom(ipc, { seed: pick.seed, tier: 2, blind, context: { assetName: pick.assetName } });
      // mark effectivity (any codes: the coach must not care which)
      run.click('.ec[data-code="A"]');
      run.click('.ec[data-code="C"]');
      const row = run.el.querySelectorAll('.r[data-src="ipc"]').find((r) => textOf(r.querySelector('.rp')) === pn)!;
      row.click();
      run.click('.r.sel [data-add]');
      return run.text('.coach');
    };
    expect(coachAfter(false, m.expect[0].pn)).not.toBe(coachAfter(false, wrong.pn));
    expect(coachAfter(true, m.expect[0].pn)).toBe(coachAfter(true, wrong.pn));
  });
});

describe('logbook research: a blind sign-off gives nothing away', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** research (the entry relied on, or "no record"), pick the route, fill the form, hand it in */
  const play = (run: ReturnType<typeof mountDom>, m: LbModel, entry: string, route: LbRoute, values: Partial<Record<string, string>>) => {
    run.click('[data-go="logs"]');
    if (entry === 'none') run.click('[data-act="none"]');
    else {
      const e = m.ac.log.find((x) => x.id === entry)!;
      const key = e.pos ? `${e.book}:${e.pos}` : e.book;
      if (run.el.querySelector(`[data-book="${key}"]`)?.classList.contains('on') === false) run.click(`[data-book="${key}"]`);
      run.find(`.lb-e[data-id="${entry}"]`).dispatch('keydown', { key: 'Enter' });
    }
    run.click('[data-act="next"]');
    run.click(`[data-route="${route}"]`);
    vi.advanceTimersByTime(200);
    for (const f of FIELDS_FOR[route]) {
      if (values[f] === undefined) continue;
      run.click(`[data-field="${f}"]`);
      run.click(`.lb-sheet [data-opt="${values[f]}"]`);
    }
    run.click('[data-submit]');
    vi.advanceTimersByTime(4000);
  };

  // tier 4: an STC case, so a request relying on "no record" is sent back by engineering
  const stc = (() => {
    for (let seed = 1; seed <= 80; seed++) {
      const m = generateLogbook(seed, 4, [], { assetName: 'Cargo C-7' });
      if (m.kase === 'stc') return { seed, m };
    }
    throw new Error('no STC case');
  })();

  it('not blind: engineering sends the request back, item by item, with a stamp and a sound', () => {
    const { seed, m } = stc;
    const values = Object.fromEntries(FIELDS_FOR.eng.map((f) => [f, rightValues(m, 'eng', f)[0]]));
    const run = mountDom(logbook, { seed, tier: 4, blind: false, context: { assetName: 'Cargo C-7' } });
    play(run, m, 'none', 'eng', values);
    const memo = run.text('.lb-rev');
    expect(memo).toContain('ENGINEERING REVIEW');
    expect(memo).toContain('Returned');
    expect(memo).toContain('✗');
    expect(run.sounds).toContain('bad');
    expect(run.held).toBeNull();
  });

  it('blind: the request goes in once, stamped as sent; no review, no return, the true score', () => {
    const { seed, m } = stc;
    const values = Object.fromEntries(FIELDS_FOR.eng.map((f) => [f, rightValues(m, 'eng', f)[0]]));
    const run = mountDom(logbook, { seed, tier: 4, blind: true, context: { assetName: 'Cargo C-7' } });
    play(run, m, 'none', 'eng', values);
    const memo = run.text('.lb-rev');
    expect(memo).toContain('YOUR ENGINEERING REQUEST');
    expect(memo).toContain('Sent to engineering');
    expect(memo).toContain('No record explains it');
    expect(memo).not.toMatch(/REVIEW|Returned|EA \d|Not approved|Not needed|Data on file|[✓✗]/);
    for (const v of VERDICT) expect(run.sounds, v).not.toContain(v);
    const truth = scoreLogbook(m, { entry: 'none', route: 'eng', values, returns: 0, submitted: true });
    expect(run.held!.r.score).toBe(truth.score);
    expect(run.held!.r.score).toBeLessThan(0.6);
    expect(run.held!.ms).toBe(1920);
    expect(run.statuses.join(' ')).not.toContain(truth.summary);
  });

  it('blind and not: the right paperwork, the same result; only the open run is told it was right', () => {
    const { seed, m } = stc;
    const ideal = idealAnswer(m);
    const open = mountDom(logbook, { seed, tier: 4, blind: false, context: { assetName: 'Cargo C-7' } });
    play(open, m, ideal.entry, ideal.route, ideal.values);
    const run = mountDom(logbook, { seed, tier: 4, blind: true, context: { assetName: 'Cargo C-7' } });
    play(run, m, ideal.entry, ideal.route, ideal.values);
    expect(open.held!.r.score).toBe(1);
    expect(run.held!.r).toEqual(open.held!.r);
    expect(open.text('.lb-rev')).toMatch(/EA issued/);
    expect(open.sounds).toContain('good');
    expect(run.text('.lb-rev')).not.toMatch(/EA issued|EA \d|[✓✗]/);
    for (const v of VERDICT) expect(run.sounds, v).not.toContain(v);
    expect(run.held!.ms).toBe(1920);
  });

  it('blind: a logbook entry you sign stays on the page with your signature, stamped signed, whatever the inspector would say', () => {
    // an SB case at tier 2: sign an IPC entry relying on "no record" (a serious fault, open or blind)
    const pick = (() => {
      for (let seed = 1; seed <= 120; seed++) {
        const m = generateLogbook(seed, 2, [], { assetName: 'Twin N-12' });
        if (m.kase === 'sb') return { seed, m };
      }
      throw new Error('no SB case');
    })();
    const { seed, m } = pick;
    const values = Object.fromEntries(FIELDS_FOR.ipc.map((f) => [f, rightValues(m, 'ipc', f)[0]]));
    const open = mountDom(logbook, { seed, tier: 2, blind: false, context: { assetName: 'Twin N-12' } });
    play(open, m, 'none', 'ipc', values);
    expect(open.text('.lb-rev')).toMatch(/Not airworthy|Not eligible|Records fault/);
    expect(open.sounds).toContain('bad');
    const run = mountDom(logbook, { seed, tier: 2, blind: true, context: { assetName: 'Twin N-12' } });
    play(run, m, 'none', 'ipc', values);
    const memo = run.text('.lb-rev');
    expect(memo).toContain('YOUR LOGBOOK ENTRY');
    expect(memo).toContain(`A&P ${m.cert}`);
    expect(memo).toContain('Signed');
    expect(memo).not.toMatch(/Not airworthy|Not eligible|Records fault|Inspector|serious|[✓✗]/i);
    for (const v of VERDICT) expect(run.sounds, v).not.toContain(v);
    expect(run.held!.r).toEqual(open.held!.r);
    expect(run.held!.r.score).toBeLessThanOrEqual(0.2);
    expect(run.held!.ms).toBe(1920);
  });
});
