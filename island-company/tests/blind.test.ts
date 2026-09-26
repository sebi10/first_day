// Blind sign-off in the crack hunt, hydraulic servicing and ground power start.
// Each puzzle is mounted headless (a recording canvas, a manual frame clock and
// synthetic pointer events), played the same way with and without `blind`, and
// what it draws and plays is compared: the teaching run gets its verdict and
// reveal, the blind run gets none, and both hand in the same true score.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { crack, distToInd, generateCrack, styleOf } from '../src/puzzles/crack';
import { generateGpu, gpu } from '../src/puzzles/gpu';
import { hydraulics } from '../src/puzzles/hydraulics';
import { markInput } from '../src/puzzles/kit';
import type { PuzzleDef, PuzzleResult } from '../src/puzzles/types';
import type { Fx } from '../src/ui/feedback';
import { C } from '../src/ui/theme';

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
