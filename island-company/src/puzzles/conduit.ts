// Electrician · Conduit bending. Lay out bend marks on a straight stick of
// 1/2-in EMT, set each bend's angle, bend it, and test-fit it on the wall
// between the panel and the hot-tub disconnect. Real trade math: take-up for
// stubs, offset multipliers and shrink, 3- and 4-point saddles, the 360° rule.
import { rng } from '../sim/rng';
import { C, FONT, backdrop, clamp, ease, label, loop, pointer, roundRect, settle, shade, stage } from './kit';
import { result, type PuzzleDef, type PuzzleResult } from './types';

export const ANGLES = [10, 22.5, 30, 45, 60, 90] as const;
/** Field table for a hand bender: offset multiplier and shrink per inch of rise. */
export const TABLE: Record<number, { mult: number; shrink: number }> = {
  10: { mult: 6, shrink: 1 / 16 },
  22.5: { mult: 2.6, shrink: 3 / 16 },
  30: { mult: 2, shrink: 1 / 4 },
  45: { mult: 1.414, shrink: 3 / 8 },
  60: { mult: 1.155, shrink: 1 / 2 },
};
/** 1/2-in EMT hand bender: deduct 5 in from a stub height to place the arrow. */
export const TAKE_UP = 5;
/** 3-point saddle rule: outer marks 2-1/2 in per inch of height; center shrink 3/16 in per inch */
export const SADDLE3_SPREAD = 2.5;
export const SADDLE3_SHRINK = 3 / 16;
const PIPE_R = 0.35; // half the OD of 1/2-in EMT

export type Bend = { at: number; angle: number; dir: 1 | -1 };
export type JobKind = 'stub' | 'offset' | 'stubOffset' | 'stubSaddle3' | 'stubSaddle4';
export type Obstacle =
  | { kind: 'beam' | 'duct'; x: number; y: number; w: number; h: number }
  | { kind: 'pipe'; x: number; y: number; r: number };

export type ConduitModel = {
  seed: number;
  tier: number;
  job: JobKind;
  /** stub-up height (0 = no stub; the run starts level out of a side knockout) */
  stub: number;
  /** offset / saddle height */
  rise: number;
  /** offset: where the rise must be finished; saddle3: obstacle centre; saddle4: near face */
  x1: number;
  /** saddle4: far face */
  x2: number;
  obstacle: Obstacle | null;
  /** panel knockout, measured along the wall from the back of the stub (or the start box) */
  panelX: number;
  endY: number;
  /** fit tolerance, inches */
  tol: number;
  /** degrees already in this run between pull points (e.g. the LB at the panel) */
  existing: number;
  minBends: number;
  stickLen: number;
  maxSticks: number;
  /** teaching lines (tiers 0–2 only) */
  hints: string[];
  /** multiplier/shrink table: printed at tiers 0–2, from tier 3 only with the bender tool */
  table: Record<number, { mult: number; shrink: number }> | null;
};

const q4 = (v: number) => Math.round(v * 4) / 4;
const rad = (d: number) => (d * Math.PI) / 180;

export function generateConduit(seed: number, tier: number, tools: string[] = []): ConduitModel {
  const r = rng(seed);
  const t = clamp(Math.round(tier), 0, 5);
  const job: JobKind = (['stub', 'stub', 'offset', 'stubOffset', 'stubSaddle3', 'stubSaddle4'] as const)[t];
  const hasStub = job !== 'offset';
  const stub = !hasStub ? 0 : t === 0 ? 12 : t === 1 ? r.int(20, 44) / 2 : r.int(24, 40) / 2;
  let rise = 0;
  let x1 = 0;
  let x2 = 0;
  let obstacle: Obstacle | null = null;
  let panelX = 36;
  let endY = 0;
  if (job === 'stub') {
    panelX = r.int(30, 42);
  } else if (job === 'offset' || job === 'stubOffset') {
    rise = r.int(6, job === 'offset' ? 16 : 14) / 2;
    x1 = r.int(job === 'offset' ? 22 : 20, 36);
    panelX = x1 + r.int(18, 24);
    endY = rise;
    // a beam on the wall: the run has to climb onto it, tight to its face
    obstacle = { kind: 'beam', x: x1 + 0.5, y: -3.5, w: panelX - x1 - 4, h: rise - 0.75 + 3.5 };
  } else if (job === 'stubSaddle3') {
    rise = r.int(6, 12) / 2;
    x1 = r.int(22, 34);
    panelX = x1 + r.int(18, 26);
    const pr = (rise - 0.5) / 2;
    obstacle = { kind: 'pipe', x: x1, y: rise - 1 - pr, r: pr };
  } else {
    rise = r.int(6, 10) / 2;
    x1 = r.int(18, 28);
    x2 = x1 + r.int(10, 18);
    panelX = x2 + r.int(16, 22);
    obstacle = { kind: 'duct', x: x1 + 0.5, y: -2.5, w: x2 - x1 - 1, h: rise - 0.75 + 2.5 };
  }
  const minBends = { stub: 1, offset: 2, stubOffset: 3, stubSaddle3: 4, stubSaddle4: 5 }[job];
  const showTable = t <= 2 || tools.includes('bender');
  const hints: string[] =
    t === 0
      ? [`Stub ${stub} in − 5 in take-up = mark at ${stub - TAKE_UP} in`, 'Angle 90°, then Bend']
      : t === 1
        ? ['Stub-up: mark at stub height − 5 in take-up']
        : t === 2
          ? ['Offset: marks apart = rise × multiplier', 'Add the shrink to the distance to the beam']
          : [];
  return {
    seed,
    tier: t,
    job,
    stub,
    rise,
    x1,
    x2,
    obstacle,
    panelX,
    endY,
    tol: [1, 0.5, 0.5, 0.5, 0.375, 0.25][t],
    existing: t >= 4 ? 90 : 0,
    minBends,
    stickLen: t <= 1 ? 60 : t === 2 ? 96 : 120,
    maxSticks: t === 0 ? 3 : 2,
    hints,
    table: showTable ? TABLE : null,
  };
}

export type Corner = { x: number; y: number; angle: number; dir: 1 | -1; heading: number };

/** Stick position of the sharp corner a bend makes: a 90 lands its back 5 in past the arrow. */
export const cornerAt = (b: Bend) => b.at + (b.angle === 90 ? TAKE_UP : 0);

/** Bend the stick. `progress` (bends done, fractional) animates it. Heading in degrees, y up. */
export function bendPath(m: ConduitModel, bends: Bend[], progress = Infinity) {
  const sorted = [...bends].sort((a, b) => cornerAt(a) - cornerAt(b));
  let x = 0;
  let y = m.stub;
  let h = m.stub ? -90 : 0;
  let pos = 0;
  const pts: { x: number; y: number }[] = [{ x, y }];
  const corners: Corner[] = [];
  sorted.forEach((b, i) => {
    const c = Math.min(m.stickLen, Math.max(pos, cornerAt(b)));
    x += (c - pos) * Math.cos(rad(h));
    y += (c - pos) * Math.sin(rad(h));
    pos = c;
    pts.push({ x, y });
    const f = clamp(progress - i, 0, 1);
    h += b.dir * b.angle * f;
    corners.push({ x, y, angle: b.angle, dir: b.dir, heading: h });
  });
  const rest = m.stickLen - pos;
  pts.push({ x: x + rest * Math.cos(rad(h)), y: y + rest * Math.sin(rad(h)) });
  return { pts, corners, heading: h };
}

/** `way`: what you'd see on the wall ("too long", "high", "early"…) */
export type Check = { label: string; err: number; ok: boolean; x: number; y: number; way?: string };

const BIG = 24;

function obstacleDepth(o: Obstacle, px: number, py: number): number {
  // how deep a point of the conduit centreline sits inside the obstacle (grown by the pipe radius)
  if (o.kind === 'pipe') return Math.max(0, o.r + PIPE_R - Math.hypot(px - o.x, py - o.y));
  const dx = Math.min(px - (o.x - PIPE_R), o.x + o.w + PIPE_R - px);
  const dy = Math.min(py - (o.y - PIPE_R), o.y + o.h + PIPE_R - py);
  return Math.max(0, Math.min(dx, dy));
}

/** Test-fit a bent stick against the wall. Every error is in inches. */
export function fitChecks(m: ConduitModel, bends: Bend[]) {
  const { pts, corners, heading } = bendPath(m, bends);
  const checks: Check[] = [];
  const add = (lbl: string, err: number, x: number, y: number, way?: string) =>
    checks.push({ label: lbl, err: Math.max(0, err), ok: Math.max(0, err) <= m.tol, x, y, way });
  const hl = (v: number, target: number) => (v > target ? 'high' : 'low');
  const el = (v: number, target: number) => (v > target ? 'late' : 'early');
  let k = 0;
  if (m.stub) {
    const c = corners[0];
    if (!c) add('Stub bend', BIG, 0, m.stub / 2);
    else if (Math.abs(c.heading) > 1) add('Stub not square', BIG, c.x, c.y);
    else add('Stub height', Math.abs(c.y), c.x, c.y, c.y < 0 ? 'too long' : 'too short');
    k = 1;
  }
  const fc = corners.slice(k);
  const trade = (i: number) => TABLE[fc[i]?.angle ?? -1];
  const need = { stub: 0, offset: 2, stubOffset: 2, stubSaddle3: 3, stubSaddle4: 4 }[m.job];
  if (need && fc.length < need) add('Missing bends', BIG, m.x1 || m.panelX / 2, m.rise);
  else if (m.job === 'offset' || m.job === 'stubOffset') {
    // a rise built with the field multiplier/shrink is right, even where trig differs a hair
    const t = trade(0);
    const th = rad(fc[0].angle);
    const aRise = t ? m.rise * Math.abs(t.mult * Math.sin(th) - 1) : 0;
    const aX = t ? m.rise * Math.abs(t.shrink - (1 / Math.sin(th) - 1 / Math.tan(th))) : 0;
    add('Offset height', Math.abs(fc[1].y - m.rise) - aRise, fc[1].x, fc[1].y, hl(fc[1].y, m.rise));
    add('Offset at beam', Math.abs(fc[1].x - m.x1) - aX, fc[1].x, fc[1].y, el(fc[1].x, m.x1));
  } else if (m.job === 'stubSaddle3') {
    const outer = rad(fc[0].angle);
    const aRise = m.rise * Math.abs(1 - SADDLE3_SPREAD * Math.sin(outer)) * (fc[0].angle === 22.5 ? 1 : 0);
    add('Saddle height', Math.abs(fc[1].y - m.rise) - aRise, fc[1].x, fc[1].y, hl(fc[1].y, m.rise));
    add('Saddle centre', Math.abs(fc[1].x - m.x1) - 0.02 * m.rise, fc[1].x, fc[1].y, el(fc[1].x, m.x1));
    add('Back on the wall', Math.abs(fc[2].y), fc[2].x, fc[2].y, hl(fc[2].y, 0));
  } else if (m.job === 'stubSaddle4') {
    const t = trade(0);
    const th = rad(fc[0].angle);
    const aRise = t ? m.rise * Math.abs(t.mult * Math.sin(th) - 1) : 0;
    const aX = t ? m.rise * Math.abs(t.shrink - (1 / Math.sin(th) - 1 / Math.tan(th))) : 0;
    add('Rise', Math.abs(fc[1].y - m.rise) - aRise, fc[1].x, fc[1].y, hl(fc[1].y, m.rise));
    add('Near face', Math.abs(fc[1].x - m.x1) - aX, fc[1].x, fc[1].y, el(fc[1].x, m.x1));
    add('Far face', Math.abs(fc[2].x - m.x2) - aX, fc[2].x, fc[2].y, el(fc[2].x, m.x2));
    add('Back on the wall', Math.abs(fc[3].y), fc[3].x, fc[3].y, hl(fc[3].y, 0));
  }
  // lands on the panel knockout, square (a dog-leg misses it)
  const last = pts[pts.length - 2];
  const cosH = Math.cos(rad(heading));
  let landErr = BIG;
  let yAt = m.endY;
  if (cosH > 0.05) {
    yAt = last.y + (m.panelX - last.x) * Math.tan(rad(heading));
    landErr = Math.min(BIG, Math.abs(yAt - m.endY) + Math.abs(Math.sin(rad(heading))) * 6);
  }
  add('Lands on panel', landErr, m.panelX, m.endY, Math.abs(heading) > 1 ? 'not square' : hl(yAt, m.endY));
  // clears the obstacle
  if (m.obstacle) {
    let depth = 0;
    let at = { x: 0, y: 0 };
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.25);
      for (let s = 0; s <= n; s++) {
        const px = a.x + ((b.x - a.x) * s) / Math.max(1, n);
        const py = a.y + ((b.y - a.y) * s) / Math.max(1, n);
        if (px > m.panelX) continue;
        const d = obstacleDepth(m.obstacle, px, py);
        if (d > depth) {
          depth = d;
          at = { x: px, y: py };
        }
      }
    }
    if (depth > 0) add(m.obstacle.kind === 'pipe' ? 'Hits the pipe' : `Hits the ${m.obstacle.kind}`, depth * 3, at.x, at.y);
  }
  const degrees = m.existing + bends.reduce((s, b) => s + b.angle, 0);
  return { checks, extra: Math.max(0, bends.length - m.minBends), degrees, over: degrees > 360 };
}

export function checkScore(err: number, tol: number): number {
  if (err <= tol) return 1;
  return 0.75 * clamp(1 - (err - tol) / (6 * tol), 0, 1);
}

/** Score the last stick bent. More sticks = the first one didn't fit. */
export function scoreConduit(m: ConduitModel, sticks: Bend[][]): number {
  if (!sticks.length || !sticks[sticks.length - 1].length) return 0.05;
  const f = fitChecks(m, sticks[sticks.length - 1]);
  // a stick is only as good as its worst fit: one dog-leg and it doesn't go on the wall
  const each = f.checks.map((c) => checkScore(c.err, m.tol));
  const q = 0.5 * Math.min(...each) + (0.5 * each.reduce((s, v) => s + v, 0)) / each.length;
  let s = q - 0.12 * f.extra - (f.over ? 0.3 : 0);
  const retries = sticks.length - 1;
  if (retries > 0) s = m.tier === 0 ? s - 0.04 * retries : Math.min(s, 0.82) - 0.06 * (retries - 1);
  return clamp(s, 0.02, 1);
}

/** How a journeyman lays it out with the field table (used by tests / solvability). */
export function solveConduit(m: ConduitModel, angle: 10 | 22.5 | 30 | 45 | 60 = 30): Bend[] {
  const out: Bend[] = [];
  const base = m.stub;
  if (m.stub) out.push({ at: m.stub - TAKE_UP, angle: 90, dir: 1 });
  const t = TABLE[angle];
  if (m.job === 'offset' || m.job === 'stubOffset') {
    const m2 = base + m.x1 + m.rise * t.shrink;
    out.push({ at: m2 - m.rise * t.mult, angle, dir: 1 }, { at: m2, angle, dir: -1 });
  } else if (m.job === 'stubSaddle3') {
    const c = base + m.x1 + m.rise * SADDLE3_SHRINK;
    const d = m.rise * SADDLE3_SPREAD;
    out.push({ at: c - d, angle: 22.5, dir: 1 }, { at: c, angle: 45, dir: -1 }, { at: c + d, angle: 22.5, dir: 1 });
  } else if (m.job === 'stubSaddle4') {
    const m2 = base + m.x1 + m.rise * t.shrink;
    const m3 = base + m.x2 + m.rise * t.shrink;
    out.push(
      { at: m2 - m.rise * t.mult, angle, dir: 1 },
      { at: m2, angle, dir: -1 },
      { at: m3, angle, dir: -1 },
      { at: m3 + m.rise * t.mult, angle, dir: 1 },
    );
  }
  return out.map((b) => ({ ...b, at: q4(b.at) }));
}

const FRAC: Record<number, string> = { 0: '', 1: '⅛', 2: '¼', 3: '⅜', 4: '½', 5: '⅝', 6: '¾', 7: '⅞' };
/** 23.25 → "23¼", 2.4375 → "2 7/16" (field tapes read to 1/16) */
export function inches(v: number): string {
  const sx = Math.round(Math.abs(v) * 16);
  const sign = v < 0 && sx ? '−' : '';
  if (sx % 2) return `${sign}${Math.floor(sx / 16) || ''}${sx >= 16 ? ' ' : ''}${sx % 16}/16`;
  const e = sx / 2;
  const whole = Math.floor(e / 8);
  const f = FRAC[e % 8];
  return `${sign}${whole || !f ? whole : ''}${f}`;
}
/** shrink per inch as a field fraction (1/16 resolution) */
export const sixteenths = (v: number) => {
  const n = Math.round(v * 16);
  const g = n % 8 === 0 ? 8 : n % 4 === 0 ? 4 : n % 2 === 0 ? 2 : 1;
  return `${n / g}/${16 / g}`;
};
export const deg = (a: number) => (a === 22.5 ? '22½°' : `${a}°`);

export function summarizeConduit(m: ConduitModel, sticks: Bend[][]): string {
  if (!sticks.length) return 'No stick bent';
  const f = fitChecks(m, sticks[sticks.length - 1]);
  const bad = f.checks.filter((c) => !c.ok);
  const parts: string[] = [];
  if (!bad.length) parts.push(sticks.length === 1 ? 'Fit first stick' : `Fit on stick ${sticks.length}`);
  else {
    const worst = bad.reduce((a, b) => (b.err > a.err ? b : a));
    parts.push(worst.err >= BIG ? `${worst.label}` : `${worst.label} off ${inches(worst.err)} in`);
    if (sticks.length > 1) parts.push(`${sticks.length} sticks`);
  }
  if (f.extra) parts.push(`${f.extra} extra bend${f.extra > 1 ? 's' : ''}`);
  parts.push(`${f.degrees}°${f.over ? ' (over 360°)' : ''}`);
  return parts.join(', ');
}

// ───────────────────────────── view ─────────────────────────────

const EMT = shade(C.inkSoft, 0.45);
const WOOD = C.sandDeep;

export const conduit: PuzzleDef = {
  id: 'conduit',
  role: 'elec',
  title: 'Conduit bending',
  gesture: 'Drag bend marks + drag angle',
  howTo: 'Mark the stick, set each angle, bend, test-fit on the wall.',
  term: 'Offset multiplier: marks apart = offset height × multiplier (30° → ×2).',
  seconds: (tier) => 70 + clamp(tier, 0, 5) * 10,
  mount(host, p) {
    const m = generateConduit(p.seed, p.tier, p.tools);
    const hasBender = p.tools.includes('bender');
    const st = stage(host.el);
    const { ctx } = st;
    type Mark = Bend & { id: number };
    let nextId = 1;
    const marks: Mark[] = [];
    const sticks: Bend[][] = [];
    let selected = -1; // mark id
    let dialAngle: number = m.tier === 0 ? 90 : 30;
    let state: 'layout' | 'bending' | 'fit' | 'done' = 'layout';
    let bendT0 = 0;
    let bentMarks: Bend[] = [];
    let lastThunk = -1;
    let fit: ReturnType<typeof fitChecks> | null = null;
    let drag: { kind: 'mark' | 'dial'; id: number; ptr: number; lastInch: number } | null = null;
    let finished = false;
    let flourishT = -1;
    /** the finished run, locked in (the host seals a blind job at once) */
    let pending: PuzzleResult | null = null;
    let lastPencil = 0;
    let dragX = 0;
    const BEND_S = p.reducedMotion ? 0 : 0.3;

    if (m.tier === 0) {
      marks.push({ id: nextId++, at: 20, angle: 90, dir: 1 });
      selected = marks[0].id;
    }

    const sel = () => marks.find((k) => k.id === selected) ?? null;
    const degrees = () => m.existing + marks.reduce((s, k) => s + k.angle, 0);
    const status = () => {
      const n = Math.min(m.maxSticks, sticks.length + (state === 'layout' || state === 'bending' ? 1 : 0));
      host.status(`Stick ${n}/${m.maxSticks} · ${marks.length} bend${marks.length === 1 ? '' : 's'} · ${degrees()}° of 360°`);
    };
    status();

    const geo = () => {
      const w = st.w;
      const h = st.h;
      const pad = 14;
      const trayH = 224;
      const stickH = 134;
      const sceneTop = 4;
      // scene mapping (inches → px), uniform scale; the scene is only as tall as the wall needs
      const xmin = m.stub ? -15 : -12;
      const xmax = m.panelX + 12;
      const ymin = -4.5;
      const ymax = Math.max(m.stub + 16, m.rise + 16, 20);
      const room = clamp(h - trayH - stickH - 14, 170, 420);
      const k = Math.min((w - 2 * pad) / (xmax - xmin), (room - 30) / (ymax - ymin));
      const sceneH = clamp(k * (ymax - ymin) + 30, 170, room);
      const stickTop = sceneTop + sceneH + 4 + (room - sceneH) * 0.12;
      const trayTop = Math.max(stickTop + stickH, h - trayH);
      const ox = pad + (w - 2 * pad - k * (xmax - xmin)) / 2 - k * xmin;
      const base = sceneTop + sceneH - 8 - (sceneH - 30 - k * (ymax - ymin)) / 2;
      const sx = (x: number) => ox + x * k;
      const sy = (y: number) => base - (y - ymin) * k;
      const sL = pad + 8;
      const sR = w - pad - 8;
      const ppi = (sR - sL) / m.stickLen;
      const dial = { x: pad + 12, y: trayTop + 212, R: Math.min(136, (w - 2 * pad) * 0.4) };
      return { w, h, pad, sceneTop, sceneH, stickTop, trayTop, k, sx, sy, sL, sR, ppi, dial };
    };
    type G = ReturnType<typeof geo>;
    const markX = (g: G, at: number) => g.sL + at * g.ppi;
    const handleY = (g: G, i: number) => g.stickTop + (i % 2 ? 96 : 76);
    const sortedMarks = () => [...marks].sort((a, b) => a.at - b.at);

    type Btn = { id: string; x: number; y: number; w: number; h: number; text: string; primary?: boolean; off?: boolean };
    const buttons = (g: G): Btn[] => {
      const y0 = g.trayTop;
      const out: Btn[] = [];
      if (state === 'fit') {
        const bw = (g.w - 2 * g.pad - 10) / 2;
        const canRetry = sticks.length < m.maxSticks;
        if (canRetry) out.push({ id: 'retry', x: g.pad, y: y0 + 150, w: bw, h: 52, text: 'New stick', primary: true });
        out.push({ id: 'accept', x: canRetry ? g.pad + bw + 10 : g.pad, y: y0 + 150, w: canRetry ? bw : g.w - 2 * g.pad, h: 52, text: 'Accept fit' });
        return out;
      }
      if (state !== 'layout') return out;
      const s = sel();
      let x = g.w - g.pad;
      const row = (id: string, bw: number, text: string, off = false) => {
        x -= bw;
        out.push({ id, x, y: y0 + 6, w: bw, h: 44, text, off });
        x -= 6;
      };
      row('del', 44, '✕', !s);
      row('flip', 66, s ? (s.dir > 0 ? '↑ up' : '↓ down') : '↑↓', !s);
      row('plus', 46, '+¼', !s);
      row('minus', 46, '−¼', !s);
      const cw = Math.min(150, g.w - g.pad - (g.dial.x + g.dial.R + 26));
      const cx = g.w - g.pad - cw;
      out.push({ id: 'add', x: cx, y: y0 + 64, w: cw, h: 46, text: '+ Mark' });
      out.push({ id: 'bend', x: cx, y: y0 + 160, w: cw, h: 52, text: 'Bend ▸', primary: true, off: !marks.length });
      return out;
    };

    const setAngle = (a: number) => {
      if (a === dialAngle) return;
      dialAngle = a;
      const s = sel();
      if (s) s.angle = a;
      host.fx.tick();
      status();
    };

    const finish = () => {
      if (finished) return;
      finished = true;
      state = 'done';
      const res = result(scoreConduit(m, sticks), summarizeConduit(m, sticks), {
        sticks: sticks.length,
        bends: sticks[sticks.length - 1]?.length ?? 0,
        degrees: fit?.degrees ?? degrees(),
      });
      if (res.perfect && !p.blind) {
        flourishT = performance.now();
        host.fx.flourish();
      } else host.fx.good();
      pending = res;
      settle(host, res, res.perfect ? 850 : 350);
    };

    const press = (b: Btn) => {
      if (b.off) {
        host.fx.bad();
        return;
      }
      const s = sel();
      switch (b.id) {
        case 'del':
          marks.splice(marks.indexOf(s!), 1);
          selected = -1;
          host.fx.swipe();
          break;
        case 'flip':
          s!.dir = (s!.dir * -1) as 1 | -1;
          host.fx.tap();
          break;
        case 'plus':
        case 'minus':
          s!.at = clamp(s!.at + (b.id === 'plus' ? 0.25 : -0.25), 0, m.stickLen);
          host.fx.tick();
          break;
        case 'add': {
          const srt = sortedMarks();
          const last = srt[srt.length - 1];
          const at = last ? clamp(q4(last.at + 10), 0, m.stickLen - 1) : q4(m.stickLen * 0.45);
          const dir: 1 | -1 = last ? ((last.dir * -1) as 1 | -1) : 1;
          const mk = { id: nextId++, at, angle: dialAngle, dir };
          marks.push(mk);
          selected = mk.id;
          host.fx.pencil();
          break;
        }
        case 'bend':
          bentMarks = marks.map(({ at, angle, dir }) => ({ at, angle, dir }));
          state = 'bending';
          bendT0 = performance.now();
          lastThunk = -1;
          selected = -1;
          break;
        case 'retry':
          state = 'layout';
          fit = null;
          host.fx.swipe();
          break;
        case 'accept':
          finish();
          return;
      }
      status();
    };

    const offPtr = pointer(st.canvas, {
      down(pt) {
        if (finished || host.paused() || state === 'bending') return;
        const g = geo();
        for (const b of buttons(g)) {
          if (pt.x >= b.x - 3 && pt.x <= b.x + b.w + 3 && pt.y >= b.y - 3 && pt.y <= b.y + b.h + 3) {
            press(b);
            return;
          }
        }
        if (state !== 'layout') return;
        // mark handles (the selected one wins ties), or the mark line on the stick
        let best: Mark | null = null;
        let bd = 24;
        sortedMarks().forEach((mk, i) => {
          const mx = markX(g, mk.at);
          const dh = Math.hypot(pt.x - mx, pt.y - handleY(g, i)) - (mk.id === selected ? 4 : 0);
          const ds = pt.y > g.stickTop + 16 && pt.y < g.stickTop + 62 ? Math.abs(pt.x - mx) + 4 : Infinity;
          const d = Math.min(dh, ds);
          if (d < bd) {
            bd = d;
            best = mk;
          }
        });
        if (best) {
          const mk = best as Mark;
          selected = mk.id;
          dialAngle = mk.angle;
          drag = { kind: 'mark', id: mk.id, ptr: pt.id, lastInch: Math.floor(mk.at) };
          dragX = markX(g, mk.at) - pt.x;
          host.fx.tap();
          return;
        }
        // angle dial: anywhere in its quarter
        const d = g.dial;
        const rr = Math.hypot(pt.x - d.x, pt.y - d.y);
        if (rr < d.R + 34 && pt.x >= d.x - 10 && pt.y <= d.y + 10) {
          drag = { kind: 'dial', id: 0, ptr: pt.id, lastInch: 0 };
          dialTo(g, pt.x, pt.y);
          return;
        }
        if (pt.y > g.stickTop && pt.y < g.trayTop) selected = -1;
      },
      move(pt) {
        if (!drag || drag.ptr !== pt.id || finished || host.paused()) return;
        const g = geo();
        if (drag.kind === 'dial') {
          dialTo(g, pt.x, pt.y);
          return;
        }
        const mk = marks.find((k) => k.id === drag!.id);
        if (!mk) return;
        mk.at = clamp(q4((pt.x + dragX - g.sL) / g.ppi), 0, m.stickLen);
        const inch = Math.floor(mk.at);
        const now = performance.now();
        if (inch !== drag.lastInch && now - lastPencil > 45) {
          host.fx.pencil();
          lastPencil = now;
        }
        drag.lastInch = inch;
      },
      up(pt) {
        if (!drag || drag.ptr !== pt.id) return;
        if (drag.kind === 'mark' && !finished) host.fx.tick();
        drag = null;
      },
    });

    function dialTo(g: G, x: number, y: number) {
      const a = (Math.atan2(g.dial.y - y, x - g.dial.x) * 180) / Math.PI;
      let best: number = ANGLES[0];
      for (const A of ANGLES) if (Math.abs(A - a) < Math.abs(best - a)) best = A;
      setAngle(best);
    }

    const stop = loop((_t, dt) => {
      const now = performance.now();
      if (state === 'bending' && host.paused()) bendT0 += dt * 1000; // freeze the bender while paused
      else if (state === 'bending') {
        const n = bentMarks.length;
        if (BEND_S === 0 && lastThunk < 0) {
          lastThunk = 0;
          host.fx.thunk();
        }
        const prog = BEND_S > 0 ? (now - bendT0) / 1000 / BEND_S : n;
        const idx = Math.floor(prog);
        if (idx !== lastThunk && idx < n) {
          lastThunk = idx;
          host.fx.thunk();
        }
        if (prog >= n + (BEND_S > 0 ? 0.6 : 0)) {
          sticks.push(bentMarks);
          fit = fitChecks(m, bentMarks);
          const clean = fit.checks.every((c) => c.ok) && !fit.over && fit.extra === 0;
          if (clean) {
            host.fx.snap();
            finish();
          } else {
            host.fx.bad();
            state = 'fit';
          }
          status();
        }
      }
      draw(geo(), now);
    });

    function draw(g: G, now: number) {
      backdrop(ctx, g.w, g.h);
      drawScene(g, now);
      drawStick(g);
      drawTray(g);
      const gleam = flourishT > 0 ? clamp((now - flourishT) / 800, 0, 1) : 0;
      if (gleam > 0 && gleam < 1) {
        ctx.globalAlpha = 0.3 * (1 - ease.outCubic(gleam));
        ctx.fillStyle = C.white;
        ctx.fillRect(0, 0, g.w, g.h);
        ctx.globalAlpha = 1;
      }
    }

    function dim(x0: number, y0: number, x1: number, y1: number, text: string, side: 'above' | 'left' | 'below' = 'above') {
      ctx.strokeStyle = C.inkSoft;
      ctx.fillStyle = C.inkSoft;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      const ang = Math.atan2(y1 - y0, x1 - x0);
      for (const [x, y, a] of [
        [x0, y0, ang + Math.PI],
        [x1, y1, ang],
      ]) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - Math.cos(a - 0.4) * 6, y - Math.sin(a - 0.4) * 6);
        ctx.lineTo(x - Math.cos(a + 0.4) * 6, y - Math.sin(a + 0.4) * 6);
        ctx.closePath();
        ctx.fill();
      }
      const mx = (x0 + x1) / 2;
      const my = (y0 + y1) / 2;
      ctx.font = `800 11px ${FONT}`;
      const tw = ctx.measureText(text).width + 8;
      const lx = side === 'left' ? mx - tw / 2 - 4 : mx;
      const ly = side === 'above' ? my - 9 : side === 'below' ? my + 9 : my;
      ctx.fillStyle = 'rgba(251,245,233,0.92)';
      ctx.fillRect(lx - tw / 2, ly - 8, tw, 16);
      label(ctx, text, lx, ly, { size: 11, weight: 800, color: C.ink });
    }

    function drawScene(g: G, now: number) {
      const { sx, sy, k } = g;
      const top = g.sceneTop;
      roundRect(ctx, g.pad - 4, top, g.w - 2 * g.pad + 8, g.sceneH, 14);
      ctx.fillStyle = C.paper;
      ctx.fill();
      ctx.save();
      ctx.clip();
      // lap siding
      ctx.strokeStyle = 'rgba(230,208,166,0.8)';
      ctx.lineWidth = 1;
      for (let y = -6; y < 80; y += 6) {
        ctx.beginPath();
        ctx.moveTo(0, sy(y));
        ctx.lineTo(g.w, sy(y));
        ctx.stroke();
      }
      // deck (stub jobs) — the run sits on it
      if (m.stub) {
        const dy = sy(-PIPE_R - 0.4);
        ctx.fillStyle = C.sandDeep;
        ctx.fillRect(0, dy, g.w, g.sceneH);
        ctx.strokeStyle = shade(C.sandDeep, -0.18);
        for (let x = sx(-40); x < g.w; x += 6 * k) {
          ctx.beginPath();
          ctx.moveTo(x, dy);
          ctx.lineTo(x, dy + 30);
          ctx.stroke();
        }
        label(ctx, 'deck', g.pad + 4, dy + 10, { size: 10, weight: 700, color: shade(C.sandDeep, -0.45), align: 'left' });
      }
      // obstacle
      const o = m.obstacle;
      if (o && o.kind !== 'pipe') {
        const x0 = sx(o.x);
        const y0 = sy(o.y + o.h);
        ctx.fillStyle = o.kind === 'beam' ? WOOD : shade(C.inkSoft, 0.62);
        ctx.fillRect(x0, y0, o.w * k, o.h * k);
        ctx.strokeStyle = shade(C.ink, 0.25);
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x0, y0, o.w * k, o.h * k);
        ctx.strokeStyle = o.kind === 'beam' ? shade(WOOD, -0.15) : shade(C.inkSoft, 0.4);
        ctx.lineWidth = 1;
        for (let i = 1; i < 4; i++) {
          ctx.beginPath();
          ctx.moveTo(x0 + 3, y0 + (o.h * k * i) / 4);
          ctx.lineTo(x0 + o.w * k - 3, y0 + (o.h * k * i) / 4 + (o.kind === 'beam' ? 2 : 0));
          ctx.stroke();
        }
        label(ctx, o.kind === 'beam' ? 'beam' : 'duct', x0 + (o.w * k) / 2, y0 + (o.h * k) / 2, { size: 10, weight: 800, color: shade(C.ink, 0.2) });
      } else if (o && o.kind === 'pipe') {
        const g2 = ctx.createRadialGradient(sx(o.x) - o.r * k * 0.3, sy(o.y) - o.r * k * 0.3, 1, sx(o.x), sy(o.y), o.r * k);
        g2.addColorStop(0, shade(C.seaLight, 0.4));
        g2.addColorStop(1, C.sea);
        ctx.fillStyle = g2;
        ctx.beginPath();
        ctx.arc(sx(o.x), sy(o.y), o.r * k, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = C.seaDeep;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        if (o.r * k > 15) label(ctx, 'water', sx(o.x), sy(o.y), { size: 9.5, weight: 800, color: C.white });
        else label(ctx, 'water pipe', sx(o.x), sy(o.y - o.r) + 10, { size: 9.5, weight: 800, color: C.seaDeep });
      }
      // start box: hot-tub disconnect
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = C.ink;
      const box = m.stub ? { x: -5, y: m.stub + 0.6, w: 10, h: 9 } : { x: -10, y: -5, w: 9.4, h: 10 };
      roundRect(ctx, sx(box.x), sy(box.y + box.h), box.w * k, box.h * k, 4);
      ctx.fillStyle = shade(C.inkSoft, 0.7);
      ctx.fill();
      ctx.stroke();
      label(ctx, 'hot tub', sx(box.x + box.w / 2), sy(box.y + box.h * 0.62), { size: 9.5, weight: 800 });
      label(ctx, 'disconnect', sx(box.x + box.w / 2), sy(box.y + box.h * 0.32), { size: 8.5, weight: 700, color: C.inkSoft });
      // panel
      const px0 = sx(m.panelX + 0.6);
      roundRect(ctx, px0, sy(m.endY + 13), 11 * k, 21 * k, 4);
      ctx.fillStyle = shade(C.inkSoft, 0.55);
      ctx.fill();
      ctx.stroke();
      label(ctx, 'panel', px0 + 5.5 * k, sy(m.endY + 6), { size: 10, weight: 800 });
      if (m.existing) label(ctx, `LB ${m.existing}°`, px0 + 5.5 * k, sy(m.endY - 4), { size: 9, weight: 700, color: C.inkSoft });
      // knockouts
      const ko = (x: number, y: number) => {
        ctx.strokeStyle = C.ink;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(sx(x), sy(y), Math.max(4, k * 0.6), 0, Math.PI * 2);
        ctx.stroke();
      };
      ko(0, m.stub);
      ko(m.panelX, m.endY);
      // dimensions: what the tech measured on the wall
      if (state === 'layout' || state === 'fit') {
        if (m.stub) dim(sx(-7), sy(0), sx(-7), sy(m.stub), `${inches(m.stub)}″`, 'left');
        const dy = sy(Math.max(m.stub + 13, m.rise + 7));
        if (m.job !== 'stub') {
          ctx.setLineDash([3, 3]);
          ctx.strokeStyle = C.inkSoft;
          ctx.lineWidth = 1;
          const ext = [0, m.x1, ...(m.job === 'stubSaddle4' ? [m.x2] : [])];
          for (const ex of ext) {
            ctx.beginPath();
            ctx.moveTo(sx(ex), dy - 6);
            ctx.lineTo(sx(ex), sy(ex === 0 ? (m.stub ? m.stub + 10 : 5.5) : m.job === 'stubSaddle3' ? m.rise : m.rise - 0.75));
            ctx.stroke();
          }
          ctx.setLineDash([]);
        }
        if (m.job === 'offset' || m.job === 'stubOffset') {
          dim(sx(0), dy, sx(m.x1), dy, `${inches(m.x1)}″ to beam`);
          dim(sx(m.x1 + 3), sy(0), sx(m.x1 + 3), sy(m.rise), `${inches(m.rise)}″`, 'left');
        } else if (m.job === 'stubSaddle3') {
          dim(sx(0), dy, sx(m.x1), dy, `${inches(m.x1)}″ to ℄`);
          dim(sx(m.x1 + (o as { r: number }).r + 3), sy(0), sx(m.x1 + (o as { r: number }).r + 3), sy(m.rise), `${inches(m.rise)}″`);
        } else if (m.job === 'stubSaddle4') {
          dim(sx(0), dy, sx(m.x1), dy, `${inches(m.x1)}″`);
          dim(sx(m.x1), dy, sx(m.x2), dy, `${inches(m.x2 - m.x1)}″`);
          dim(sx(m.x2 + 3), sy(0), sx(m.x2 + 3), sy(m.rise), `${inches(m.rise)}″`, 'below');
        }
        if (m.stub && m.job !== 'stub') label(ctx, 'from back of stub', sx(0) + 4, dy - 21, { size: 9, weight: 700, color: C.inkSoft, align: 'left' });
      }
      // the bent stick
      if (state !== 'layout') {
        const prog = state === 'bending' && BEND_S > 0 ? (now - bendT0) / 1000 / BEND_S : Infinity;
        const { pts } = bendPath(m, bentMarks, prog);
        const gl = flourishT > 0 ? clamp((now - flourishT) / 800, 0, 1) : 0;
        ctx.save();
        // the tail is cut to length at the panel
        ctx.beginPath();
        ctx.rect(0, 0, sx(m.panelX + 0.6), g.h);
        ctx.clip();
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.lineWidth = Math.max(4, 0.75 * k) + 2.5;
        ctx.strokeStyle = shade(C.ink, 0.1);
        // bends drawn on a ~4 in centreline radius, like a real ½-in hand bender
        ctx.beginPath();
        ctx.moveTo(sx(pts[0].x), sy(pts[0].y));
        for (let i = 1; i < pts.length - 1; i++) {
          const a = pts[i - 1];
          const b = pts[i];
          const c = pts[i + 1];
          const room = Math.min(Math.hypot(b.x - a.x, b.y - a.y), Math.hypot(c.x - b.x, c.y - b.y)) / 2;
          ctx.arcTo(sx(b.x), sy(b.y), sx(c.x), sy(c.y), Math.max(0.1, Math.min(4, room) * k * 0.6));
        }
        const e = pts[pts.length - 1];
        ctx.lineTo(sx(e.x), sy(e.y));
        ctx.stroke();
        ctx.lineWidth = Math.max(4, 0.75 * k);
        ctx.strokeStyle = gl > 0 && gl < 1 ? shade(C.elec, 0.3 * gl) : EMT;
        ctx.stroke();
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.stroke();
        ctx.restore();
        if (fit && state !== 'bending') {
          for (const c of fit.checks) {
            const cx = clamp(sx(Math.min(c.x, m.panelX + 8)), g.pad + 8, g.w - g.pad - 8);
            const cy = clamp(sy(c.y), top + 10, top + g.sceneH - 10);
            if (c.ok) {
              ctx.fillStyle = C.palm;
              ctx.beginPath();
              ctx.arc(cx, cy, 6, 0, Math.PI * 2);
              ctx.fill();
            } else {
              ctx.strokeStyle = C.rust;
              ctx.lineWidth = 2.5;
              ctx.beginPath();
              ctx.arc(cx, cy, 11, 0, Math.PI * 2);
              ctx.stroke();
            }
          }
        }
      }
      ctx.restore();
      // teaching line / field table (tiers 0–2, or the bender tool)
      if (m.hints.length && state === 'layout') {
        const hint = m.hints[Math.floor(now / 4500) % m.hints.length];
        label(ctx, hint, g.pad + 6, top + 14, { size: 11.5, weight: 700, color: C.inkSoft, align: 'left' });
      }
      if (m.table && m.job !== 'stub' && state === 'layout') drawTable(g);
      if (fit?.over) label(ctx, `${fit.degrees}° between pull points: over 360°`, g.w / 2, top + g.sceneH - 14, { size: 12, weight: 800, color: C.rust });
    }

    function drawTable(g: G) {
      const rows = [10, 22.5, 30, 45, 60];
      const gapTop = g.stickTop + 134;
      const strip = g.trayTop - gapTop >= 62;
      const tw = strip ? g.w - 2 * g.pad : 138;
      const th = strip ? 54 : 16 + rows.length * 13;
      const x = strip ? g.pad : g.w - g.pad - tw - 2;
      const y = strip ? gapTop + (g.trayTop - gapTop - th) / 2 - 2 : g.sceneTop + (m.hints.length ? 24 : 8);
      roundRect(ctx, x, y, tw, th, 8);
      ctx.fillStyle = 'rgba(242,227,198,0.95)';
      ctx.fill();
      ctx.strokeStyle = C.sandDeep;
      ctx.lineWidth = 1;
      ctx.stroke();
      if (strip) {
        const cw = (tw - 58) / rows.length;
        label(ctx, 'angle', x + 8, y + 12, { size: 9, weight: 800, color: C.inkSoft, align: 'left' });
        label(ctx, 'mult', x + 8, y + 27, { size: 9, weight: 800, color: C.inkSoft, align: 'left' });
        label(ctx, 'shrink/in', x + 8, y + 42, { size: 9, weight: 800, color: C.inkSoft, align: 'left' });
        rows.forEach((a, i) => {
          const t = TABLE[a];
          const cx = x + 58 + cw * (i + 0.5);
          label(ctx, deg(a), cx, y + 12, { size: 10.5, weight: 800 });
          label(ctx, `×${t.mult}`, cx, y + 27, { size: 10.5, weight: 700 });
          label(ctx, `${sixteenths(t.shrink)}″`, cx, y + 42, { size: 10.5, weight: 700 });
        });
        return;
      }
      label(ctx, 'angle', x + 8, y + 9, { size: 8.5, weight: 800, color: C.inkSoft, align: 'left' });
      label(ctx, 'mult', x + 50, y + 9, { size: 8.5, weight: 800, color: C.inkSoft, align: 'left' });
      label(ctx, 'shrink/in', x + 100, y + 9, { size: 8.5, weight: 800, color: C.inkSoft, align: 'left' });
      rows.forEach((a, i) => {
        const t = TABLE[a];
        const yy = y + 22 + i * 13;
        label(ctx, deg(a), x + 8, yy, { size: 10, weight: 800, align: 'left' });
        label(ctx, `×${t.mult}`, x + 50, yy, { size: 10, weight: 700, align: 'left' });
        label(ctx, `${sixteenths(t.shrink)}″`, x + 100, yy, { size: 10, weight: 700, align: 'left' });
      });
    }

    function drawStick(g: G) {
      const y = g.stickTop;
      const sy0 = y + 22;
      // EMT stick
      const gr = ctx.createLinearGradient(0, sy0, 0, sy0 + 14);
      gr.addColorStop(0, shade(C.inkSoft, 0.75));
      gr.addColorStop(0.5, shade(C.inkSoft, 0.45));
      gr.addColorStop(1, shade(C.inkSoft, 0.25));
      roundRect(ctx, g.sL - 4, sy0, g.sR - g.sL + 8, 14, 5);
      ctx.fillStyle = gr;
      ctx.fill();
      ctx.strokeStyle = shade(C.ink, 0.2);
      ctx.lineWidth = 1.2;
      ctx.stroke();
      label(ctx, m.stub ? 'stub end' : 'box end', g.sL - 4, y + 10, { size: 9.5, weight: 800, color: C.inkSoft, align: 'left' });
      label(ctx, `${m.stickLen / 12}-ft ${m.stickLen === 120 ? 'stick' : 'offcut'} · ½″ EMT`, g.sR + 4, y + 10, {
        size: 9.5,
        weight: 700,
        color: C.inkSoft,
        align: 'right',
      });
      // tape
      const ty = sy0 + 15;
      ctx.fillStyle = C.elec;
      ctx.fillRect(g.sL, ty, g.sR - g.sL, 17);
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 1;
      for (let i = 0; i <= m.stickLen; i++) {
        const x = markX(g, i);
        const len = i % 12 === 0 ? 10 : i % 6 === 0 ? 7 : 3.5;
        if (g.ppi < 3.2 && i % 2 && len < 5) continue;
        ctx.beginPath();
        ctx.moveTo(x, ty);
        ctx.lineTo(x, ty + len);
        ctx.stroke();
        const every = g.ppi > 5 ? 6 : 12;
        if (i % every === 0 && i > 0 && i < m.stickLen) label(ctx, String(i), x, ty + 12.5, { size: 8.5, weight: 800 });
      }
      // bender readout for the selected mark: the multiplier math and shrink of its offset pair
      const srt = sortedMarks();
      const cur = sel();
      if (hasBender && state === 'layout' && cur) {
        // the table printed on the shoe, nothing more: the layout math stays the electrician's
        let txt = cur.angle === 90 ? 'bender: arrow on the mark · 90° take-up 5″' : '';
        if (!txt && TABLE[cur.angle]) txt = `bender: ${deg(cur.angle)} · ×${TABLE[cur.angle].mult} · shrink ${sixteenths(TABLE[cur.angle].shrink)}″ per inch`;
        label(ctx, txt, g.w / 2, y + 124, { size: 11, weight: 800, color: C.seaDeep });
      }
      // marks + handles
      srt.forEach((mk, i) => {
        const x = markX(g, mk.at);
        const isSel = mk.id === selected;
        ctx.strokeStyle = isSel ? C.seaDeep : C.ink;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, sy0 - 3);
        ctx.lineTo(x, ty + 17);
        ctx.stroke();
        const hy = handleY(g, i);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, ty + 17);
        ctx.lineTo(x, hy - 14);
        ctx.stroke();
        ctx.fillStyle = isSel ? C.sea : C.paper;
        ctx.beginPath();
        ctx.arc(x, hy, 15, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = isSel ? C.seaDeep : C.ink;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        label(ctx, `${mk.angle === 22.5 ? '22½' : mk.angle}${mk.dir > 0 ? '↑' : '↓'}`, x, hy, {
          size: mk.angle === 22.5 ? 8.5 : 9.5,
          weight: 800,
          color: isSel ? C.white : C.ink,
        });
      });
      // readout bubble while dragging
      if (drag?.kind === 'mark') {
        const mk = marks.find((k) => k.id === drag!.id);
        if (mk) {
          const x = clamp(markX(g, mk.at), g.pad + 36, g.w - g.pad - 36);
          roundRect(ctx, x - 36, sy0 - 34, 72, 26, 13);
          ctx.fillStyle = C.ink;
          ctx.fill();
          label(ctx, `${inches(mk.at)}″`, x, sy0 - 21, { size: 14, weight: 800, color: C.white });
        }
      }
    }

    function drawTray(g: G) {
      const y0 = g.trayTop;
      ctx.fillStyle = 'rgba(230,208,166,0.5)';
      roundRect(ctx, 0, y0 - 4, g.w, g.h - y0 + 24, 18);
      ctx.fill();
      if (state === 'done' && fit) {
        const clean = fit.checks.every((c) => c.ok);
        label(ctx, clean ? 'Test fit: sits flat, lands on the knockout' : 'Fit accepted', g.pad + 4, y0 + 22, { size: 14, weight: 800, align: 'left' });
        label(ctx, summarizeConduit(m, sticks), g.pad + 4, y0 + 46, { size: 12.5, weight: 700, color: C.inkSoft, align: 'left' });
      } else if (state === 'fit' && fit) {
        const bad = fit.checks.filter((c) => !c.ok);
        label(ctx, bad.length ? 'Test fit: it doesn’t sit right' : 'Fits, but…', g.pad + 4, y0 + 18, { size: 14, weight: 800, align: 'left' });
        const lines = bad.slice(0, 3).map((c) => (c.err >= 24 ? c.label : `${c.label}: ${inches(c.err)}″ ${c.way ?? 'off'}`));
        if (fit.extra) lines.push(`${fit.extra} bend${fit.extra > 1 ? 's' : ''} more than the job needs`);
        if (fit.over) lines.push(`${fit.degrees}° total: the 360° limit is blown`);
        lines.slice(0, 4).forEach((l, i) => label(ctx, l, g.pad + 4, y0 + 44 + i * 20, { size: 12.5, weight: 700, color: C.rust, align: 'left' }));
      } else if (state === 'layout') {
        const s = sel();
        label(ctx, s ? `${inches(s.at)}″ · ${deg(s.angle)}` : marks.length ? 'Tap a mark' : 'Add a mark', g.pad + 2, y0 + 28, {
          size: 14,
          weight: 800,
          align: 'left',
        });
        drawDial(g);
        const deg0 = degrees();
        const bx = buttons(g).find((b) => b.id === 'bend')!;
        label(ctx, `Σ ${deg0}° / 360°`, bx.x + bx.w / 2, y0 + 126, { size: 13, weight: 800, color: deg0 > 360 ? C.rust : C.ink });
        label(ctx, m.existing ? `incl. ${m.existing}° LB` : 'between pull points', bx.x + bx.w / 2, y0 + 143, { size: 9.5, weight: 700, color: C.inkSoft });
      }
      for (const b of buttons(g)) {
        roundRect(ctx, b.x, b.y, b.w, b.h, b.h / 2);
        ctx.fillStyle = b.primary ? C.sea : C.paper;
        ctx.globalAlpha = b.off ? 0.45 : 1;
        ctx.fill();
        ctx.strokeStyle = b.primary ? C.seaDeep : C.inkSoft;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        label(ctx, b.text, b.x + b.w / 2, b.y + b.h / 2, { size: b.h > 46 ? 16 : 13.5, weight: 800, color: b.primary ? C.white : C.ink });
        ctx.globalAlpha = 1;
      }
    }

    function drawDial(g: G) {
      const d = g.dial;
      const a2r = (a: number) => (-a * Math.PI) / 180;
      // bender shoe: a quarter arc with degree marks
      ctx.lineCap = 'butt';
      ctx.strokeStyle = shade(C.inkSoft, 0.55);
      ctx.lineWidth = 16;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.R, a2r(0), a2r(90), true);
      ctx.stroke();
      ctx.lineCap = 'round';
      for (const A of ANGLES) {
        const on = A === dialAngle;
        const c = Math.cos(a2r(A));
        const s = Math.sin(a2r(A));
        ctx.strokeStyle = on ? C.seaDeep : C.ink;
        ctx.lineWidth = on ? 3 : 1.5;
        ctx.beginPath();
        ctx.moveTo(d.x + c * (d.R - 8), d.y + s * (d.R - 8));
        ctx.lineTo(d.x + c * (d.R + 8), d.y + s * (d.R + 8));
        ctx.stroke();
        label(ctx, A === 22.5 ? '22½' : String(A), d.x + c * (d.R + 20), d.y + s * (d.R + 20), {
          size: on ? 13 : 11,
          weight: 800,
          color: on ? C.seaDeep : C.ink,
        });
      }
      // arm + knob
      const aa = a2r(dialAngle);
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x + Math.cos(aa) * (d.R - 10), d.y + Math.sin(aa) * (d.R - 10));
      ctx.stroke();
      ctx.fillStyle = C.sea;
      ctx.beginPath();
      ctx.arc(d.x + Math.cos(aa) * (d.R * 0.72), d.y + Math.sin(aa) * (d.R * 0.72), 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = C.seaDeep;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = C.ink;
      ctx.beginPath();
      ctx.arc(d.x, d.y, 6, 0, Math.PI * 2);
      ctx.fill();
    }

    return {
      timeUp(): PuzzleResult {
        if (pending) return pending;
        finished = true;
        state = 'done';
        if (!sticks.length) {
          // never bent: the layout on the stick is worth something, but it is unproven
          const plan = marks.map(({ at, angle, dir }) => ({ at, angle, dir }));
          const s = plan.length ? Math.min(0.5, scoreConduit(m, [plan])) : 0.05;
          return result(s, plan.length ? `Out of time before bending (${plan.length} mark${plan.length === 1 ? "" : "s"} laid out)` : 'Out of time, no marks');
        }
        return result(scoreConduit(m, sticks), summarizeConduit(m, sticks));
      },
      destroy() {
        stop();
        offPtr();
        st.destroy();
      },
    };
  },
};
