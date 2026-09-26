// Mechanic · Weight & balance. Before a charter, load the 6-seat twin: drag
// guests into seats and bags/freight into the nose or aft bay until the gross
// weight is under max and the CG (total moment / total weight) sits inside the
// envelope. Moment = weight × arm, exactly like the paper load sheet.
import { hashSeed, rng, type Rng } from '../sim/rng';
import { C, FONT, backdrop, clamp, ease, label, loop, pointer, roundRect, shade, stage } from './kit';
import { result, type PuzzleDef, type PuzzleResult } from './types';

// ---------------------------------------------------------------------------
// Aircraft data (a Baron-class light twin, metric weights, arms in inches aft
// of the datum at the nose). Fixed per airframe, like a real POH.
// ---------------------------------------------------------------------------

export type ItemKind = 'pax' | 'bag' | 'crate';
export type LoadItem = { name: string; kind: ItemKind; kg: number; optional: boolean };
export type Station = { id: string; name: string; kind: 'seat' | 'bay'; arm: number; limit: number };

export const ARM = { nose: 22, front: 84, middle: 119, rear: 155, aft: 178, fuel: 75 } as const;

/** Loadable stations. The pilot occupies seat 1 (front left) and is not movable. */
export const STATIONS: Station[] = [
  { id: 'nose', name: 'Nose bay', kind: 'bay', arm: ARM.nose, limit: 45 },
  { id: 's2', name: 'Seat 2', kind: 'seat', arm: ARM.front, limit: 0 },
  { id: 's3', name: 'Seat 3', kind: 'seat', arm: ARM.middle, limit: 0 },
  { id: 's4', name: 'Seat 4', kind: 'seat', arm: ARM.middle, limit: 0 },
  { id: 's5', name: 'Seat 5', kind: 'seat', arm: ARM.rear, limit: 0 },
  { id: 's6', name: 'Seat 6', kind: 'seat', arm: ARM.rear, limit: 0 },
  { id: 'aft', name: 'Aft bay', kind: 'bay', arm: ARM.aft, limit: 55 },
];
export const NOSE = 0;
export const AFT = 6;
const SEAT_ROWS = [[1], [2, 3], [4, 5]];

/** CG envelope: forward limit moves aft above bendW (the envelope narrows when heavy). */
export const ENVELOPE = { minW: 1700, bendW: 1900, maxW: 2450, fwdLight: 74.0, fwdHeavy: 80.5, aft: 86.0 };

export function fwdLimit(w: number): number {
  const E = ENVELOPE;
  if (w <= E.bendW) return E.fwdLight;
  return E.fwdLight + ((w - E.bendW) / (E.maxW - E.bendW)) * (E.fwdHeavy - E.fwdLight);
}
export function aftLimit(): number {
  return ENVELOPE.aft;
}
/** 1 at the middle of the envelope, 0 on a limit, negative outside. */
export function cgMargin(w: number, cg: number): number {
  const f = fwdLimit(w);
  const a = aftLimit();
  return Math.min(cg - f, a - cg) / ((a - f) / 2);
}

export type BalanceModel = {
  tier: number;
  maxGross: number;
  empty: { kg: number; arm: number };
  pilot: { name: string; kg: number };
  /** fuel on board at takeoff; burn > 0 means the landing CG must be checked too */
  fuel: { kg: number; burn: number };
  items: LoadItem[];
  /**
   * What the best legal loading achieves (fewest can-wait items left, then the
   * most centred CG). Scoring reference only: the loading itself is not stored,
   * call solveBalance() for it.
   */
  best: { offload: number; margin: number };
  /**
   * Teaching aids. Tiers 0-2 teach; from tier 3 the player works the load sheet
   * from trade knowledge (moment = weight × arm, CG = total moment / total weight).
   */
  aids: {
    /** show "82 × 155 = 12,710" while dragging over a station */
    momentMath: boolean;
    /** CG computed and plotted for you (tiers 0-2, or the cgComputer tool) */
    cgReadout: boolean;
    /** forward/aft limits at the current weight spelled out */
    limitLabels: boolean;
  };
  /** share of all possible loadings that are legal (lower = harder) */
  legalFrac: number;
  /** loadings legal at takeoff that fail only at landing fuel (tier 5 trap) */
  landingTraps: number;
};

export type LoadEval = {
  w: number;
  cg: number;
  wL: number;
  cgL: number;
  bayKg: [number, number];
  /** required items (guests, non-optional freight) not loaded */
  missing: number;
  offloaded: number;
  over: number;
  bayOver: number;
  /** inches outside the envelope (worst of takeoff and landing), 0 inside */
  cgOut: number;
  outSide: '' | 'fwd' | 'aft';
  landingOnly: boolean;
  margin: number;
  legal: boolean;
};

export function evaluateLoad(m: BalanceModel, place: number[]): LoadEval {
  let w = m.empty.kg + m.pilot.kg + m.fuel.kg;
  let mo = m.empty.kg * m.empty.arm + m.pilot.kg * ARM.front + m.fuel.kg * ARM.fuel;
  let nose = 0;
  let aft = 0;
  let missing = 0;
  let offloaded = 0;
  for (let i = 0; i < m.items.length; i++) {
    const it = m.items[i];
    const s = place[i];
    if (s == null || s < 0) {
      if (it.optional) offloaded++;
      else missing++;
      continue;
    }
    w += it.kg;
    mo += it.kg * STATIONS[s].arm;
    if (s === NOSE) nose += it.kg;
    if (s === AFT) aft += it.kg;
  }
  const cg = mo / w;
  const wL = w - m.fuel.burn;
  const cgL = (mo - m.fuel.burn * ARM.fuel) / wL;
  const over = Math.max(0, w - m.maxGross);
  const bayOver = Math.max(0, nose - STATIONS[NOSE].limit) + Math.max(0, aft - STATIONS[AFT].limit);
  const outAt = (ww: number, c: number): [number, '' | 'fwd' | 'aft'] => {
    const f = fwdLimit(ww);
    const a = aftLimit();
    if (c < f) return [f - c, 'fwd'];
    if (c > a) return [c - a, 'aft'];
    return [0, ''];
  };
  const [o1, s1] = outAt(w, cg);
  const [o2, s2] = m.fuel.burn > 0 ? outAt(wL, cgL) : [0, '' as const];
  const margin = Math.min(cgMargin(w, cg), m.fuel.burn > 0 ? cgMargin(wL, cgL) : Infinity);
  const cgOut = Math.max(o1, o2);
  return {
    w,
    cg,
    wL,
    cgL,
    bayKg: [nose, aft],
    missing,
    offloaded,
    over,
    bayOver,
    cgOut,
    outSide: o1 >= o2 ? s1 : s2,
    landingOnly: o1 === 0 && o2 > 0,
    margin,
    legal: missing === 0 && over === 0 && bayOver === 0 && cgOut === 0,
  };
}

/** Exhaustive search over every loading (guests by seat row, freight by bay). */
export type BalanceSolution = {
  best: { plan: number[]; offload: number; margin: number };
  legalFrac: number;
  landingTraps: number;
};

export function solveBalance(m: BalanceModel): BalanceSolution | null {
  const pax = m.items.map((it, i) => (it.kind === 'pax' ? i : -1)).filter((i) => i >= 0);
  const cargo = m.items.map((it, i) => (it.kind !== 'pax' ? i : -1)).filter((i) => i >= 0);
  const place = new Array(m.items.length).fill(-1);
  let best: BalanceSolution['best'] | null = null;
  let total = 0;
  let legal = 0;
  let traps = 0;
  const cargoLoop = (k: number) => {
    if (k === cargo.length) {
      total++;
      const e = evaluateLoad(m, place);
      if (e.landingOnly && e.missing === 0 && e.over === 0 && e.bayOver === 0) traps++;
      if (!e.legal) return;
      legal++;
      if (!best || e.offloaded < best.offload || (e.offloaded === best.offload && e.margin > best.margin + 1e-9)) {
        best = { plan: place.slice(), offload: e.offloaded, margin: e.margin };
      }
      return;
    }
    const i = cargo[k];
    const opts = m.items[i].optional ? [NOSE, AFT, -1] : [NOSE, AFT];
    for (const s of opts) {
      place[i] = s;
      cargoLoop(k + 1);
    }
    place[i] = -1;
  };
  const used = [0, 0, 0];
  const paxLoop = (k: number) => {
    if (k === pax.length) {
      cargoLoop(0);
      return;
    }
    for (let row = 0; row < 3; row++) {
      if (used[row] >= SEAT_ROWS[row].length) continue;
      place[pax[k]] = SEAT_ROWS[row][used[row]];
      used[row]++;
      paxLoop(k + 1);
      used[row]--;
    }
    place[pax[k]] = -1;
  };
  paxLoop(0);
  if (!best) return null;
  return { best, legalFrac: legal / Math.max(1, total), landingTraps: traps };
}

const NAMES = ['Ana', 'Kai', 'Mele', 'Tomas', 'Rosa', 'Jules', 'Noa', 'Ivy', 'Sione', 'Lani', 'Ben', 'Priya', 'Omar', 'Hana', 'Teo', 'Lupe'];
const BAGS = ['Bag', 'Duffel', 'Dive bag', 'Cooler', 'Golf bag', 'Surf bag', 'Case'];

const TIER = {
  pax: [2, 3, 4, 4, 5, 5],
  bags: [1, 2, 2, 3, 3, 3],
  crate: [false, false, true, true, true, true],
  fuel: [190, 165, 200, 225, 240, 255],
  paxKg: [
    [58, 88],
    [72, 98],
    [58, 94],
    [58, 92],
    [58, 92],
    [58, 92],
  ],
  bagKg: [
    [9, 18],
    [14, 25],
    [9, 22],
    [12, 26],
    [12, 26],
    [12, 26],
  ],
  /** max share of legal loadings we accept, so harder tiers really are harder */
  maxLegal: [1, 0.9, 0.6, 0.45, 0.3, 0.22],
  minLegal: [0.6, 0.25, 0.08, 0.02, 0.01, 0.004],
  /** share of seeds where leaving the can-wait freight behind is the right call */
  offload: [0, 0, 0, 0.35, 0.45, 0.5],
};

const r5 = (v: number) => Math.round(v / 5) * 5;

function buildLoad(r: Rng, t: number): BalanceModel {
  const names = r.shuffle(NAMES.slice());
  const items: LoadItem[] = [];
  const nPax = TIER.pax[t];
  for (let i = 0; i < nPax; i++) {
    let kg = r.int(TIER.paxKg[t][0], TIER.paxKg[t][1]);
    if (t >= 3 && i === 0) kg = r.int(112, 132); // one heavy guest
    else if (t >= 2 && i === nPax - 1 && r.chance(0.3)) kg = r.int(26, 40); // a child
    items.push({ name: names[i], kind: 'pax', kg, optional: false });
  }
  const bagNames = r.shuffle(BAGS.slice());
  for (let i = 0; i < TIER.bags[t]; i++)
    items.push({ name: bagNames[i], kind: 'bag', kg: r.int(TIER.bagKg[t][0], TIER.bagKg[t][1]), optional: false });
  if (TIER.crate[t]) items.push({ name: 'Parts crate', kind: 'crate', kg: t >= 3 ? r.int(28, 42) : r.int(24, 36), optional: false });
  if (t >= 3) {
    // the freight that can go on tomorrow's run: the crate, or at tier 5 maybe a bag too
    const crate = items.find((it) => it.kind === 'crate');
    if (crate) crate.optional = true;
    if (t >= 5 && r.chance(0.4)) {
      const bag = items.find((it) => it.kind === 'bag');
      if (bag) bag.optional = true;
    }
  }
  r.shuffle(items);
  const fuelKg = r5(TIER.fuel[t] + r.int(-10, 10));
  return {
    tier: t,
    maxGross: ENVELOPE.maxW,
    empty: { kg: 1580 + r.int(0, 40), arm: Math.round((76.6 + r.range(0, 0.8)) * 10) / 10 },
    pilot: { name: 'Pilot', kg: r.int(72, 92) },
    fuel: { kg: fuelKg, burn: t >= 5 ? r5(fuelKg * r.range(0.55, 0.68)) : 0 },
    items,
    best: { offload: 0, margin: 0 },
    aids: { momentMath: t <= 2, cgReadout: t <= 2, limitLabels: t <= 2 },
    legalFrac: 0,
    landingTraps: 0,
  };
}

function adopt(m: BalanceModel, s: BalanceSolution, tools: string[]): BalanceModel {
  m.best = { offload: s.best.offload, margin: s.best.margin };
  m.legalFrac = s.legalFrac;
  m.landingTraps = s.landingTraps;
  // the CG computer is a convenience readout; it never places anything for you
  if (tools.includes('cgComputer')) m.aids.cgReadout = true;
  return m;
}

export function generateBalance(seed: number, tier: number, tools: string[] = []): BalanceModel {
  const t = clamp(Math.round(tier), 0, 5);
  const wantOffload = rng(hashSeed('balance-offload', seed, t)).chance(TIER.offload[t]);
  let fallback: BalanceModel | null = null;
  let fair: BalanceModel | null = null;
  for (let attempt = 0; attempt < 80; attempt++) {
    const m = buildLoad(rng(hashSeed('balance', seed, t, attempt)), t);
    const s = solveBalance(m);
    if (!s) continue;
    adopt(m, s, tools);
    fallback ??= m;
    const ok =
      m.legalFrac <= TIER.maxLegal[t] &&
      m.legalFrac >= TIER.minLegal[t] &&
      (t > 0 || m.best.margin > 0.35) &&
      (t < 5 || m.landingTraps > 0);
    if (!ok) continue;
    fair ??= m;
    if (m.best.offload > 0 === wantOffload) return m;
  }
  if (fair) return fair;
  if (fallback) return fallback;
  // Never expected: strip everything optional-free down to a trivially legal load.
  const m = buildLoad(rng(hashSeed('balance-easy', seed)), 0);
  return adopt(m, solveBalance(m)!, tools);
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Legal load: 1, minus 0.03 per move beyond one-per-item (max 0.2), up to 0.12
 * for a CG hugging a limit (relative to the best achievable margin), 0.12 per
 * item left behind that didn't need to be; floored at a pass (0.6).
 * Each refused signature (the pilot's check found it illegal) is a botched load
 * sheet: -0.06 while teaching (tiers 1-2, still floored), -0.2 from tier 3 with
 * no floor, so trial-and-error signing without knowing the maths fails.
 * Time-up without a signature: partial credit only (never a pass from tier 3).
 * Illegal load at time-up: 0.05-0.5 by progress and closeness.
 */
export function scoreBalance(m: BalanceModel, place: number[], moves: number, refused: number, signed = true): number {
  const e = evaluateLoad(m, place);
  const tut = m.tier === 0;
  const expert = m.tier >= 3;
  if (!e.legal) {
    const req = m.items.filter((it) => !it.optional).length;
    const progress = req ? (req - e.missing) / req : 1;
    const close = 1 - clamp(e.cgOut / 4 + e.over / 120 + e.bayOver / 40, 0, 1);
    return clamp(0.1 + 0.4 * progress * (0.35 + 0.65 * close) - (expert ? 0.06 : 0.03) * refused, 0.05, 0.5);
  }
  const loaded = place.filter((s) => s >= 0).length;
  const extra = Math.max(0, moves - loaded);
  let s = 1;
  s -= Math.min(0.2, (tut ? 0.01 : 0.03) * extra);
  if (!tut) {
    const q = m.best.margin > 0 ? clamp(e.margin / m.best.margin, 0, 1) : 1;
    s -= 0.12 * clamp((0.6 - q) / 0.6, 0, 1);
  }
  s -= 0.12 * Math.max(0, e.offloaded - m.best.offload);
  if (expert) s = Math.max(0.6, s) - 0.2 * refused;
  else s = Math.max(0.6, s - (tut ? 0.02 : 0.06) * refused);
  if (!signed) s = Math.min(s - 0.05, expert ? 0.55 : 0.75);
  return clamp(s, 0, 1);
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

function summarize(m: BalanceModel, place: number[], moves: number, refused: number): string {
  const e = evaluateLoad(m, place);
  const loaded = place.filter((s) => s >= 0).length;
  const parts: string[] = [];
  if (e.legal) {
    parts.push(`In envelope, CG ${e.cg.toFixed(1)} in${m.fuel.burn ? ` → ${e.cgL.toFixed(1)}` : ''}`);
  } else if (e.missing) parts.push(`${e.missing} not loaded`);
  else if (e.over) parts.push(`${fmt(e.over)} kg over gross`);
  else if (e.bayOver) parts.push('bay over limit');
  else parts.push(`CG ${e.outSide === 'fwd' ? 'forward' : 'aft'} of limit${e.landingOnly ? ' at landing' : ''}`);
  parts.push(`${moves} moves (min ${loaded})`);
  if (e.offloaded) parts.push(`${e.offloaded} left for next run`);
  if (refused) parts.push(`${refused} refused`);
  return parts.join(', ');
}

// ---------------------------------------------------------------------------
// Puzzle
// ---------------------------------------------------------------------------

export const balance: PuzzleDef = {
  id: 'balance',
  role: 'mech',
  title: 'Weight & balance',
  gesture: 'Drag to stations',
  howTo: 'Drag each load to a station. Keep the CG in the envelope.',
  term: 'CG: the balance point. Outside the envelope the plane is unsafe to fly.',
  seconds: (tier) => 70 + clamp(tier, 0, 5) * 10,
  mount(host, p) {
    const m = generateBalance(p.seed, p.tier, p.tools);
    const live = p.tools.includes('cgComputer');
    // from tier 3 (without the CG computer) nobody computes the CG for you: the
    // sheet shows total weight and total moment, the pilot's check shows the CG
    const key = (pl: number[]) => pl.join(',');
    let checkedKey = '';
    const cgVisible = () => m.aids.cgReadout || checkedKey === key(place) || finished;
    const st = stage(host.el);
    const { ctx } = st;
    const place: number[] = new Array(m.items.length).fill(-1);
    let moves = 0;
    let refused = 0;
    let finished = false;
    let flourishT = -1;
    type Drag = { item: number; from: number; id: number; x: number; y: number; over: number | null };
    let drag: Drag | null = null;
    const flash = { what: '' as string, until: 0 };
    const LIFT = 30; // chip rides above the thumb so it stays visible

    // ---- layout -----------------------------------------------------------
    // Readouts and the envelope chart sit up top (look, don't touch); the
    // airframe is mid-screen; the ramp and the sign button live under the thumb.
    const cols = m.items.length > 6 ? 4 : 3;
    const rows = Math.ceil(m.items.length / cols);
    const geo = () => {
      const w = st.w;
      const h = st.h;
      const pad = 12;
      const bw = Math.min(230, w - pad * 2);
      const btn = { x: (w - bw) / 2, y: h - 58, w: bw, h: 48 };
      const chipH = h < 640 ? 46 : 52;
      const rampH = 26 + rows * chipH + (rows - 1) * 7 + 6;
      const rTop = btn.y - 8 - rampH;
      const ramp = { x: pad, y: rTop, w: w - pad * 2, h: rampH };
      const cTop = 40;
      const avail = rTop - cTop - 4;
      const pH = clamp(avail * 0.46, 146, 214);
      const cH = clamp(avail - pH - 4, 110, 250);
      const spare = Math.max(0, avail - pH - cH - 4);
      const chart = { x: pad + 36, y: cTop + 20, w: w - pad * 2 - 44, h: cH - 44 };
      const pTop = cTop + cH + 4 + spare / 2;
      const k = (w - pad * 2) / 218;
      const plane = { top: pTop, h: pH, cy: pTop + pH * 0.44, half: clamp(pH * 0.28, 40, 58), k, x0: pad + 2 * k };
      return { w, h, pad, chart, chartTop: cTop, chartH: cH, plane, btn, ramp, chipH };
    };
    type Geo = ReturnType<typeof geo>;
    const xOf = (g: Geo, arm: number) => g.plane.x0 + arm * g.plane.k;

    type Rect = { x: number; y: number; w: number; h: number };
    const stationRect = (g: Geo, s: number): Rect => {
      const P = g.plane;
      const st0 = STATIONS[s];
      if (st0.kind === 'bay') {
        const a0 = s === NOSE ? 8 : 167;
        const a1 = s === NOSE ? 36 : 189;
        const top = P.cy - P.half * (s === NOSE ? 0.52 : 0.72);
        const bot = P.cy + P.half * (s === NOSE ? 0.7 : 0.78);
        return { x: xOf(g, a0), y: top, w: xOf(g, a1) - xOf(g, a0), h: bot - top };
      }
      const sw = Math.min(40, P.k * 26);
      const sh = Math.min(48, P.half - 4);
      const upper = s === 2 || s === 4;
      const cx = xOf(g, st0.arm);
      return { x: cx - sw / 2, y: upper ? P.cy - sh - 3 : P.cy + 3, w: sw, h: sh };
    };
    const pilotRect = (g: Geo): Rect => {
      const r = stationRect(g, 1);
      return { ...r, y: r.y - r.h - 6 };
    };

    const chipRect = (g: Geo, i: number): Rect => {
      const gap = 7;
      const cw = (g.ramp.w - gap * (cols - 1)) / cols;
      const c = i % cols;
      const r = Math.floor(i / cols);
      return { x: g.ramp.x + c * (cw + gap), y: g.ramp.y + 26 + r * (g.chipH + gap), w: cw, h: g.chipH };
    };
    const inRect = (r: Rect, x: number, y: number, slop = 0) =>
      x >= r.x - slop && x <= r.x + r.w + slop && y >= r.y - slop && y <= r.y + r.h + slop;

    const accepts = (s: number, i: number) => (STATIONS[s].kind === 'seat') === (m.items[i].kind === 'pax');
    const seatOccupant = (s: number, except = -1) => place.findIndex((v, i) => v === s && i !== except);
    const bayItems = (s: number) => place.map((v, i) => (v === s ? i : -1)).filter((i) => i >= 0);

    /** apply a drop to a placement copy (seat drops swap with the occupant) */
    const applied = (base: number[], i: number, to: number, from: number) => {
      const next = base.slice();
      if (to >= 0 && STATIONS[to].kind === 'seat') {
        const o = next.findIndex((v, j) => v === to && j !== i);
        if (o >= 0) next[o] = from;
      }
      next[i] = to;
      return next;
    };

    const targetAt = (g: Geo, x: number, y: number): number | null => {
      if (y > g.ramp.y - 4) return -1;
      let best: number | null = null;
      let bd = Infinity;
      for (let s = 0; s < STATIONS.length; s++) {
        const r = stationRect(g, s);
        const d = Math.hypot(x - (r.x + r.w / 2), y - (r.y + r.h / 2));
        if ((inRect(r, x, y, 8) || d < 38) && d < bd) {
          bd = d;
          best = s;
        }
      }
      return best;
    };

    // ---- state helpers ------------------------------------------------------
    const updateStatus = () => {
      const e = evaluateLoad(m, place);
      const cg = m.fuel.burn ? `${e.cg.toFixed(1)}→${e.cgL.toFixed(1)}` : e.cg.toFixed(1);
      if (cgVisible()) host.status(`GW ${fmt(e.w)} / ${fmt(m.maxGross)} kg · CG ${cg} in`);
      else host.status(`GW ${fmt(e.w)} / ${fmt(m.maxGross)} kg · moment ${fmt(e.w * e.cg)} kg·in`);
    };
    updateStatus();

    const finish = () => {
      if (finished) return;
      finished = true;
      drag = null;
      const res = result(scoreBalance(m, place, moves, refused), summarize(m, place, moves, refused), dataOf());
      if (res.perfect) {
        flourishT = performance.now();
        host.fx.flourish();
      } else host.fx.good();
      setTimeout(() => host.done(res), res.perfect ? 800 : 350);
    };
    const dataOf = () => {
      const e = evaluateLoad(m, place);
      return {
        gw: Math.round(e.w),
        cg: Math.round(e.cg * 10) / 10,
        cgLanding: m.fuel.burn ? Math.round(e.cgL * 10) / 10 : undefined,
        moves,
        refused,
        offloaded: e.offloaded,
      };
    };

    const sign = () => {
      const e = evaluateLoad(m, place);
      if (e.legal) {
        checkedKey = key(place);
        finish();
        return;
      }
      host.fx.bad();
      flash.until = performance.now() + 1400;
      // an incomplete sheet is just bounced; a completed one that fails the check is a botched load sheet
      if (!e.missing) {
        refused++;
        checkedKey = key(place);
      }
      if (e.missing) {
        flash.what = 'missing';
        host.status(`Can't sign: ${e.missing} still on the ramp`);
      } else if (e.over) {
        flash.what = 'gw';
        host.status(`Can't sign: ${fmt(e.over)} kg over max gross`);
      } else if (e.bayOver) {
        flash.what = e.bayKg[0] > STATIONS[NOSE].limit ? 'bay0' : 'bay6';
        host.status(`Can't sign: ${flash.what === 'bay0' ? 'nose' : 'aft'} bay over its limit`);
      } else {
        flash.what = 'cg';
        host.status(`Can't sign: CG ${e.outSide === 'fwd' ? 'forward' : 'aft'} of limit${e.landingOnly ? ' at landing fuel' : ''}`);
      }
    };

    // ---- input --------------------------------------------------------------
    const offPtr = pointer(st.canvas, {
      down(pt) {
        if (finished || host.paused() || drag) return;
        const g = geo();
        if (inRect(g.btn, pt.x, pt.y, 4)) {
          sign();
          return;
        }
        // grab: ramp chips, seated guests, bay contents
        let item = -1;
        for (let i = 0; i < m.items.length && item < 0; i++) if (place[i] < 0 && inRect(chipRect(g, i), pt.x, pt.y, 3)) item = i;
        for (let s = 0; s < STATIONS.length && item < 0; s++) {
          const r = stationRect(g, s);
          if (!inRect(r, pt.x, pt.y, STATIONS[s].kind === 'seat' ? 4 : 6)) continue;
          if (STATIONS[s].kind === 'seat') item = seatOccupant(s);
          else {
            const inBay = bayItems(s);
            if (inBay.length) {
              // rows stack from the floor up; pick the one under the finger
              const rh = Math.min(22, (r.h - 6) / inBay.length);
              const k = clamp(Math.floor((r.y + r.h - 3 - pt.y) / rh), 0, inBay.length - 1);
              item = inBay[k];
            }
          }
        }
        if (item < 0) return;
        drag = { item, from: place[item], id: pt.id, x: pt.x, y: pt.y, over: place[item] };
        host.fx.tap();
      },
      move(pt) {
        if (!drag || drag.id !== pt.id || finished || host.paused()) return;
        drag.x = pt.x;
        drag.y = pt.y;
        const over = targetAt(geo(), pt.x, pt.y - LIFT);
        if (over !== drag.over && over != null && over >= 0 && accepts(over, drag.item)) host.fx.tick();
        drag.over = over;
      },
      up(pt) {
        if (!drag || drag.id !== pt.id) return;
        const d = drag;
        drag = null;
        if (finished || host.paused()) return;
        const to = targetAt(geo(), pt.x, pt.y - LIFT);
        if (to == null || to === d.from) return; // dropped back / nowhere: no move
        if (to >= 0 && !accepts(to, d.item)) {
          host.fx.bad();
          flash.what = m.items[d.item].kind === 'pax' ? 'seats' : 'bays';
          flash.until = performance.now() + 900;
          return;
        }
        const next = applied(place, d.item, to, d.from);
        for (let i = 0; i < place.length; i++) place[i] = next[i];
        moves++;
        const e = evaluateLoad(m, place);
        const bayNow = to === NOSE ? e.bayKg[0] : to === AFT ? e.bayKg[1] : 0;
        if (to >= 0 && STATIONS[to].kind === 'bay' && bayNow > STATIONS[to].limit) {
          host.fx.bad();
          flash.what = to === NOSE ? 'bay0' : 'bay6';
          flash.until = performance.now() + 900;
        } else host.fx.snap();
        updateStatus();
      },
    });

    const stop = loop(() => draw(geo()));

    // ---- drawing ------------------------------------------------------------
    function draw(g: Geo) {
      const now = performance.now();
      backdrop(ctx, g.w, g.h);
      const gleam = flourishT > 0 ? clamp((now - flourishT) / 800, 0, 1) : 0;
      const flashing = (what: string) => flash.what === what && now < flash.until;
      const pulse = p.reducedMotion ? 1 : 0.5 + 0.5 * Math.sin(now / 90);

      const e = evaluateLoad(m, place);
      let preview: LoadEval | null = null;
      if (drag && drag.over != null && drag.over !== drag.from && (drag.over < 0 || accepts(drag.over, drag.item)) && live) {
        preview = evaluateLoad(m, applied(place, drag.item, drag.over, drag.from));
      }

      // header readout
      const overGross = e.w > m.maxGross;
      label(ctx, 'GW', g.pad, 20, { size: 11, weight: 700, color: C.inkSoft, align: 'left' });
      label(ctx, `${fmt(e.w)}`, g.pad + 22, 20, {
        size: 18,
        weight: 800,
        color: overGross || flashing('gw') ? C.rust : C.ink,
        align: 'left',
      });
      ctx.font = `800 18px ${FONT}`;
      const gwW = ctx.measureText(fmt(e.w)).width;
      label(ctx, `/ ${fmt(m.maxGross)} kg`, g.pad + 26 + gwW, 21, { size: 12, weight: 600, color: C.inkSoft, align: 'left' });
      const showCG = cgVisible();
      const inside = e.cgOut === 0;
      const cgTxt = !showCG
        ? `${fmt(e.w * e.cg)}`
        : m.fuel.burn
          ? `${e.cg.toFixed(1)} → ${e.cgL.toFixed(1)} in`
          : `${e.cg.toFixed(1)} in`;
      label(ctx, cgTxt, g.w - g.pad, 20, { size: 18, weight: 800, color: inside || !showCG ? C.ink : C.rust, align: 'right' });
      ctx.font = `800 18px ${FONT}`;
      label(ctx, showCG ? 'CG' : 'Σ moment kg·in', g.w - g.pad - ctx.measureText(cgTxt).width - 6, 20, {
        size: 11,
        weight: 700,
        color: C.inkSoft,
        align: 'right',
      });

      drawChart(g, e, preview, gleam, flashing('cg') ? pulse : 0, showCG);
      drawPlane(g, e, flashing, pulse);
      drawRamp(g, flashing('missing') ? pulse : 0);

      // sign button
      const ready = e.missing === 0;
      ctx.fillStyle = finished ? shade(C.palm, 0.2) : ready ? C.sea : shade(C.sea, 0.45);
      roundRect(ctx, g.btn.x, g.btn.y, g.btn.w, g.btn.h, 24);
      ctx.fill();
      label(ctx, finished ? 'Signed' : 'Sign load sheet', g.w / 2, g.btn.y + g.btn.h / 2 + 1, {
        size: 16,
        weight: 700,
        color: C.white,
      });

      if (drag) drawDragChip(g, drag, preview);

      if (gleam > 0 && gleam < 1 && !p.reducedMotion) {
        ctx.globalAlpha = 0.35 * (1 - ease.outCubic(gleam));
        ctx.fillStyle = C.white;
        ctx.fillRect(0, 0, g.w, g.h);
        ctx.globalAlpha = 1;
      }
    }

    function drawChart(g: Geo, e: LoadEval, preview: LoadEval | null, gleam: number, alarm: number, showCG: boolean) {
      const c = g.chart;
      const X0 = 72;
      const X1 = 88;
      const Y0 = ENVELOPE.minW;
      const Y1 = 2500;
      const px = (cg: number) => c.x + ((clamp(cg, X0 - 0.3, X1 + 0.3) - X0) / (X1 - X0)) * c.w;
      const py = (w: number) => c.y + c.h - ((clamp(w, Y0 - 30, Y1 + 30) - Y0) / (Y1 - Y0)) * c.h;
      // paper card
      ctx.fillStyle = shade(C.paper, 0.3);
      roundRect(ctx, g.pad, g.chartTop, g.w - g.pad * 2, g.chartH, 12);
      ctx.fill();
      ctx.strokeStyle = shade(C.sandDeep, -0.05);
      ctx.lineWidth = 1;
      ctx.stroke();
      label(ctx, 'CG envelope', g.pad + 10, g.chartTop + 11, { size: 11, weight: 800, color: C.ink, align: 'left' });
      if (m.aids.limitLabels) {
        // teaching: spell out the limits at the current weight
        label(ctx, `limits at ${fmt(e.w)} kg: ${fwdLimit(e.w).toFixed(1)}–${aftLimit().toFixed(1)} in`, g.w - g.pad - 10, g.chartTop + 11, {
          size: 10,
          weight: 700,
          color: C.palmDark,
          align: 'right',
        });
      } else label(ctx, 'weight vs CG', g.w - g.pad - 10, g.chartTop + 11, { size: 10, weight: 600, color: C.inkSoft, align: 'right' });
      // grid
      ctx.strokeStyle = shade(C.sandDeep, 0.2);
      ctx.lineWidth = 1;
      for (let x = 74; x <= 86; x += 2) {
        ctx.beginPath();
        ctx.moveTo(px(x), c.y);
        ctx.lineTo(px(x), c.y + c.h);
        ctx.stroke();
        label(ctx, x === 86 ? '86 in' : String(x), px(x) + (x === 86 ? 6 : 0), c.y + c.h + 10, { size: 10, weight: 600, color: C.inkSoft });
      }
      for (let w = 1800; w <= 2400; w += 200) {
        ctx.beginPath();
        ctx.moveTo(c.x, py(w));
        ctx.lineTo(c.x + c.w, py(w));
        ctx.stroke();
        label(ctx, fmt(w), c.x - 5, py(w), { size: 10, weight: 600, color: C.inkSoft, align: 'right' });
      }
      // envelope polygon
      const E = ENVELOPE;
      ctx.beginPath();
      ctx.moveTo(px(E.fwdLight), py(Y0));
      ctx.lineTo(px(E.fwdLight), py(E.bendW));
      ctx.lineTo(px(E.fwdHeavy), py(E.maxW));
      ctx.lineTo(px(E.aft), py(E.maxW));
      ctx.lineTo(px(E.aft), py(Y0));
      ctx.closePath();
      ctx.fillStyle = gleam > 0 ? shade(C.palm, 0.55 - 0.25 * Math.sin(gleam * Math.PI)) : shade(C.palm, 0.72);
      ctx.fill();
      ctx.strokeStyle = C.palm;
      ctx.lineWidth = 2;
      ctx.stroke();
      // max gross line
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(c.x, py(E.maxW));
      ctx.lineTo(c.x + c.w, py(E.maxW));
      ctx.stroke();
      ctx.setLineDash([]);
      label(ctx, `max gross ${fmt(E.maxW)}`, c.x + c.w - 2, py(E.maxW) - 7, { size: 9, weight: 700, color: C.ink, align: 'right' });

      const dot = (ev: LoadEval, ghost: boolean) => {
        const tx = px(ev.cg);
        const ty = py(ev.w);
        if (m.fuel.burn) {
          const lx = px(ev.cgL);
          const ly = py(ev.wL);
          ctx.setLineDash([3, 3]);
          ctx.strokeStyle = ghost ? C.sea : C.ink;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(tx, ty);
          ctx.lineTo(lx, ly);
          ctx.stroke();
          ctx.setLineDash([]);
          const lOut = cgMargin(ev.wL, ev.cgL) < 0;
          ctx.fillStyle = C.paper;
          ctx.strokeStyle = ghost ? C.sea : lOut ? C.rust : C.ink;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(lx, ly, 5.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          if (!ghost) label(ctx, 'LDG', lx + 9, ly + 1, { size: 9, weight: 800, color: lOut ? C.rust : C.inkSoft, align: 'left' });
        }
        const out = cgMargin(ev.w, ev.cg) < 0 || ev.w > m.maxGross;
        ctx.fillStyle = ghost ? shade(C.sea, 0.25) : out ? C.rust : C.ink;
        ctx.strokeStyle = C.paper;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(tx, ty, ghost ? 6 : 7 + alarm * 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        if (!ghost && m.fuel.burn) label(ctx, 'T/O', tx - 10, ty - 1, { size: 9, weight: 800, color: C.inkSoft, align: 'right' });
      };
      if (!showCG) {
        // only the weight is known until the CG is worked out (or the pilot checks it)
        const line = (w: number, txt: string) => {
          ctx.setLineDash([2, 4]);
          ctx.strokeStyle = C.seaDeep;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(c.x, py(w));
          ctx.lineTo(c.x + c.w, py(w));
          ctx.stroke();
          ctx.setLineDash([]);
          label(ctx, txt, c.x + 4, py(w) - 7, { size: 9, weight: 800, color: C.seaDeep, align: 'left' });
        };
        line(e.w, `GW ${fmt(e.w)}`);
        if (m.fuel.burn) line(e.wL, `LDG ${fmt(e.wL)}`);
        return;
      }
      if (preview) {
        ctx.globalAlpha = 0.85;
        dot(preview, true);
        ctx.globalAlpha = 1;
      }
      dot(e, false);
    }

    function drawPlane(g: Geo, e: LoadEval, flashing: (w: string) => boolean, pulse: number) {
      const P = g.plane;
      const x = (a: number) => xOf(g, a);
      const top = P.cy - P.half;
      const bot = P.cy + P.half;
      // wing (low wing, edge-on) and the engine nacelle, behind the fuselage
      ctx.fillStyle = shade(C.ink, 0.55);
      roundRect(ctx, x(30), bot - 16, x(96) - x(30), 24, 12);
      ctx.fill();
      ctx.fillStyle = shade(C.ink, 0.4);
      ctx.beginPath();
      ctx.ellipse(x(90), bot + 3, (x(122) - x(58)) / 2, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = shade(C.ink, 0.3);
      ctx.beginPath();
      ctx.ellipse(x(29), bot - 4, 4, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      // fin
      ctx.fillStyle = shade(C.mech, 0.3);
      ctx.beginPath();
      ctx.moveTo(x(190), top + 2);
      ctx.quadraticCurveTo(x(203), top - P.half * 0.2, x(207), top - P.half * 0.55);
      ctx.lineTo(x(214), top - P.half * 0.55);
      ctx.lineTo(x(215), P.cy - P.half * 0.62);
      ctx.closePath();
      ctx.fill();
      // fuselage
      const body = () => {
        ctx.beginPath();
        ctx.moveTo(x(0), P.cy + P.half * 0.22);
        ctx.bezierCurveTo(x(1), P.cy - P.half * 0.4, x(26), top + P.half * 0.14, x(54), top);
        ctx.lineTo(x(188), top);
        ctx.bezierCurveTo(x(200), top, x(208), P.cy - P.half * 0.72, x(216), P.cy - P.half * 0.62);
        ctx.lineTo(x(216), P.cy - P.half * 0.36);
        ctx.bezierCurveTo(x(206), P.cy - P.half * 0.1, x(198), bot, x(186), bot);
        ctx.lineTo(x(56), bot);
        ctx.bezierCurveTo(x(24), bot, x(3), P.cy + P.half * 0.66, x(0), P.cy + P.half * 0.22);
        ctx.closePath();
      };
      const fg = ctx.createLinearGradient(0, top, 0, bot);
      fg.addColorStop(0, C.paper);
      fg.addColorStop(1, shade(C.sandDeep, 0.3));
      body();
      ctx.fillStyle = fg;
      ctx.fill();
      ctx.strokeStyle = shade(C.ink, 0.3);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // windshield + stabiliser + cheat line
      ctx.fillStyle = shade(C.seaDeep, 0.35);
      ctx.beginPath();
      ctx.moveTo(x(38), top + P.half * 0.34);
      ctx.lineTo(x(53), top + 2);
      ctx.lineTo(x(62), top + 2);
      ctx.lineTo(x(58), top + P.half * 0.36);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = shade(C.mech, 0.1);
      ctx.beginPath();
      ctx.ellipse(x(205), P.cy - P.half * 0.5, (x(216) - x(194)) / 2, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = C.mech;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x(4), P.cy + P.half * 0.46);
      ctx.lineTo(x(208), P.cy - P.half * 0.2);
      ctx.stroke();
      if (p.context?.assetName)
        label(ctx, p.context.assetName, x(186), top - 8, { size: 9, weight: 800, color: C.inkSoft, align: 'right' });

      // fuel (wing tanks) tag
      const fuelTxt = `Fuel ${m.fuel.kg} kg @ ${ARM.fuel} in${m.fuel.burn ? ` · burn ${m.fuel.burn}` : ''}`;
      label(ctx, fuelTxt, x(96), bot + 15, { size: 10, weight: 700, color: C.seaDeep });

      // stations
      const hl = drag && drag.over != null && drag.over >= 0 ? drag.over : -1;
      for (let s = 0; s < STATIONS.length; s++) {
        const r = stationRect(g, s);
        const S = STATIONS[s];
        const valid = drag ? accepts(s, drag.item) : false;
        const alarm =
          (S.kind === 'seat' && flashing('seats')) ||
          (S.kind === 'bay' && flashing('bays')) ||
          flashing(s === NOSE ? 'bay0' : s === AFT ? 'bay6' : '-');
        if (S.kind === 'bay') {
          const kg = s === NOSE ? e.bayKg[0] : e.bayKg[1];
          const over = kg > S.limit;
          ctx.fillStyle = shade(C.sandDeep, drag && valid ? 0.35 : 0.1);
          roundRect(ctx, r.x, r.y, r.w, r.h, 6);
          ctx.fill();
          ctx.lineWidth = hl === s ? 3 : alarm ? 2 + pulse * 2 : 1.4;
          ctx.strokeStyle = over || alarm ? C.rust : hl === s ? C.sea : drag && valid ? C.sea : shade(C.ink, 0.35);
          ctx.setLineDash(drag && valid && hl !== s ? [4, 3] : []);
          ctx.stroke();
          ctx.setLineDash([]);
          const inBay = bayItems(s);
          const rh = Math.min(22, (r.h - 6) / Math.max(1, inBay.length));
          inBay.forEach((i, k) => {
            if (drag && drag.item === i) return;
            const it = m.items[i];
            const yy = r.y + r.h - 3 - (k + 1) * rh;
            ctx.fillStyle = it.kind === 'crate' ? C.mech : shade(C.sea, 0.55);
            roundRect(ctx, r.x + 3, yy + 1, r.w - 6, rh - 2, 4);
            ctx.fill();
            label(ctx, String(it.kg), r.x + r.w / 2, yy + rh / 2 + 0.5, { size: rh > 16 ? 11 : 9, weight: 800, color: C.ink });
          });
          label(ctx, `${kg}/${S.limit}`, r.x + r.w / 2, r.y - 8, { size: 10, weight: 800, color: over ? C.rust : C.ink });
        } else {
          // seat cushion + back
          ctx.fillStyle = drag && valid ? shade(C.sea, 0.78) : shade(C.sandDeep, 0.05);
          roundRect(ctx, r.x, r.y, r.w, r.h, 8);
          ctx.fill();
          ctx.lineWidth = hl === s ? 3 : alarm ? 2 + pulse * 2 : 1.2;
          ctx.strokeStyle = alarm ? C.rust : hl === s ? C.sea : drag && valid ? C.sea : shade(C.ink, 0.45);
          ctx.stroke();
          ctx.fillStyle = shade(C.sandDeep, -0.12);
          roundRect(ctx, r.x + r.w - 7, r.y + 3, 4, r.h - 6, 2);
          ctx.fill();
          const o = seatOccupant(s);
          if (o >= 0 && !(drag && drag.item === o)) person(r, String(m.items[o].kg), C.sea);
          else if (!drag) label(ctx, S.name.replace('Seat ', ''), r.x + r.w / 2 - 2, r.y + r.h / 2, { size: 10, weight: 700, color: shade(C.ink, 0.5) });
        }
      }
      // pilot, fixed in seat 1
      const pr = pilotRect(g);
      ctx.fillStyle = shade(C.sandDeep, 0.05);
      roundRect(ctx, pr.x, pr.y, pr.w, pr.h, 8);
      ctx.fill();
      person(pr, String(m.pilot.kg), C.ink);
      label(ctx, 'PIC', pr.x + pr.w / 2 - 2, pr.y - 7, { size: 9, weight: 800, color: C.inkSoft });

      // arm ruler with datum
      const ry = bot + 27;
      ctx.strokeStyle = shade(C.ink, 0.3);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x(0), ry);
      ctx.lineTo(x(212), ry);
      ctx.stroke();
      ctx.fillStyle = C.ink;
      ctx.beginPath();
      ctx.moveTo(x(0), ry - 5);
      ctx.lineTo(x(0) - 5, ry - 12);
      ctx.lineTo(x(0) + 5, ry - 12);
      ctx.closePath();
      ctx.fill();
      label(ctx, 'datum', x(0) + 7, ry - 8, { size: 9, weight: 700, color: C.inkSoft, align: 'left' });
      for (const a of [ARM.nose, ARM.front, ARM.middle, ARM.rear, ARM.aft]) {
        ctx.beginPath();
        ctx.moveTo(x(a), ry - 4);
        ctx.lineTo(x(a), ry + 4);
        ctx.stroke();
        label(ctx, `${a}`, x(a), ry + 11, { size: 10, weight: 700, color: C.ink });
      }
      label(ctx, 'arm, in', x(212), ry + 11, { size: 9, weight: 600, color: C.inkSoft, align: 'right' });
    }

    function person(r: Rect, txt: string, col: string) {
      const cx = r.x + r.w / 2 - 2;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(cx, r.y + r.h * 0.28, Math.min(7, r.h * 0.16), 0, Math.PI * 2);
      ctx.fill();
      roundRect(ctx, cx - r.w * 0.34, r.y + r.h * 0.44, r.w * 0.68, r.h * 0.5, 6);
      ctx.fill();
      label(ctx, txt, cx, r.y + r.h * 0.7, { size: 11, weight: 800, color: C.white });
    }

    function chip(r: Rect, i: number, lifted: boolean) {
      const it = m.items[i];
      const bg = it.kind === 'pax' ? C.sea : it.kind === 'crate' ? C.mech : C.sandDeep;
      const fg = it.kind === 'pax' ? C.white : C.ink;
      if (lifted) {
        ctx.fillStyle = 'rgba(31,42,48,0.18)';
        roundRect(ctx, r.x + 3, r.y + 6, r.w, r.h, 10);
        ctx.fill();
      }
      ctx.fillStyle = bg;
      roundRect(ctx, r.x, r.y, r.w, r.h, 10);
      ctx.fill();
      if (it.optional) {
        ctx.setLineDash([5, 3]);
        ctx.strokeStyle = C.ink;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      label(ctx, it.kind === 'pax' ? `Guest ${it.name}` : it.name, r.x + r.w / 2, r.y + r.h * 0.31, {
        size: 10,
        weight: 600,
        color: fg,
      });
      label(ctx, `${it.kg} kg`, r.x + r.w / 2, r.y + r.h * 0.68, { size: 15, weight: 800, color: fg });
      if (it.optional) {
        // "can wait" tag straddling the top edge
        const tw = 50;
        ctx.fillStyle = C.ink;
        roundRect(ctx, r.x + r.w - tw - 4, r.y - 7, tw, 14, 7);
        ctx.fill();
        label(ctx, 'can wait', r.x + r.w - tw / 2 - 4, r.y, { size: 9, weight: 800, color: C.paper });
      }
    }

    function drawRamp(g: Geo, alarm: number) {
      const R = g.ramp;
      ctx.fillStyle = shade(C.sandDeep, 0.35);
      roundRect(ctx, R.x - 4, R.y, R.w + 8, R.h + 4, 12);
      ctx.fill();
      const anyOpt = m.items.some((it) => it.optional);
      label(ctx, anyOpt ? 'Ramp · left here = next flight' : 'Ramp · load everything', R.x + 4, R.y + 11, {
        size: 11,
        weight: 700,
        color: C.inkSoft,
        align: 'left',
      });
      if (drag && drag.from >= 0) {
        ctx.strokeStyle = drag.over === -1 ? C.sea : shade(C.sea, 0.4);
        ctx.lineWidth = drag.over === -1 ? 3 : 1.5;
        ctx.setLineDash([6, 4]);
        roundRect(ctx, R.x - 4, R.y, R.w + 8, R.h + 4, 12);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      for (let i = 0; i < m.items.length; i++) {
        const r = chipRect(g, i);
        if (place[i] >= 0 || (drag && drag.item === i)) {
          ctx.strokeStyle = shade(C.sandDeep, -0.08);
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 4]);
          roundRect(ctx, r.x + 2, r.y + 2, r.w - 4, r.h - 4, 9);
          ctx.stroke();
          ctx.setLineDash([]);
          continue;
        }
        chip(r, i, false);
        if (alarm > 0 && !m.items[i].optional) {
          ctx.strokeStyle = C.rust;
          ctx.lineWidth = 2 + alarm * 2;
          roundRect(ctx, r.x, r.y, r.w, r.h, 10);
          ctx.stroke();
        }
      }
    }

    function drawDragChip(g: Geo, d: Drag, preview: LoadEval | null) {
      const it = m.items[d.item];
      const over = d.over;
      if (over != null && over >= 0 && accepts(over, d.item) && over !== d.from) {
        // magnetic preview: a ghost of the load sits in the slot, one tag floats above the airframe
        const t = stationRect(g, over);
        ctx.globalAlpha = 0.6;
        if (STATIONS[over].kind === 'seat') person(t, String(it.kg), C.sea);
        else {
          const n0 = bayItems(over).filter((i) => i !== d.item).length;
          const rh = Math.min(22, (t.h - 6) / (n0 + 1));
          const yy = t.y + t.h - 3 - (n0 + 1) * rh;
          ctx.fillStyle = it.kind === 'crate' ? C.mech : shade(C.sea, 0.55);
          roundRect(ctx, t.x + 3, yy + 1, t.w - 6, rh - 2, 4);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.strokeStyle = C.sea;
        ctx.lineWidth = 3;
        roundRect(ctx, t.x - 2, t.y - 2, t.w + 4, t.h + 4, 9);
        ctx.stroke();
        const bayKg = STATIONS[over].kind === 'bay' ? bayItems(over).filter((i) => i !== d.item).reduce((a2, i) => a2 + m.items[i].kg, 0) + it.kg : 0;
        const full = STATIONS[over].kind === 'bay' && bayKg > STATIONS[over].limit;
        const txt = m.aids.momentMath
          ? `${it.kg} × ${STATIONS[over].arm} = ${fmt(it.kg * STATIONS[over].arm)}`
          : `${it.kind === 'pax' ? 'Guest ' : ''}${it.name} · ${it.kg} kg`;
        const full2 = full ? `${txt} · bay ${bayKg}/${STATIONS[over].limit}` : txt;
        ctx.font = `700 12px ${FONT}`;
        const tw = ctx.measureText(full2).width + 18;
        const tx = clamp(t.x + t.w / 2 - tw / 2, 4, g.w - tw - 4);
        const ty = g.plane.cy - g.plane.half - 34;
        ctx.fillStyle = full ? C.rust : C.ink;
        roundRect(ctx, tx, ty, tw, 24, 12);
        ctx.fill();
        label(ctx, full2, tx + tw / 2, ty + 12.5, { size: 12, weight: 700, color: C.paper });
        if (preview && !preview.legal && preview.missing === 0 && !full) {
          label(ctx, preview.over ? 'over gross' : 'CG out', tx + tw / 2, ty - 10, { size: 11, weight: 800, color: C.rust });
        }
        return;
      }
      const base = chipRect(g, d.item);
      const w = Math.min(base.w, 84);
      const h = base.h - 4;
      const r = { x: d.x - w / 2, y: d.y - LIFT - h / 2, w, h };
      chip(r, d.item, true);
      if (over != null && over >= 0 && !accepts(over, d.item)) {
        ctx.strokeStyle = C.rust;
        ctx.lineWidth = 2.5;
        roundRect(ctx, r.x, r.y, r.w, r.h, 10);
        ctx.stroke();
        label(ctx, it.kind === 'pax' ? 'guests ride in seats' : 'cargo goes in a bay', d.x, r.y - 10, { size: 11, weight: 800, color: C.rust });
      }
    }

    return {
      timeUp(): PuzzleResult {
        finished = true;
        drag = null;
        const e = evaluateLoad(m, place);
        return result(
          scoreBalance(m, place, moves, refused, false),
          (e.legal ? 'Not signed: ' : 'Time: ') + summarize(m, place, moves, refused),
          dataOf(),
        );
      },
      destroy() {
        stop();
        offPtr();
        st.destroy();
      },
    };
  },
};
