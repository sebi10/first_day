// Electrician · Multimeter diagnosis. A cottage branch circuit misbehaves.
// Drag the V and COM probes onto terminals, read the meter (120/240 V
// split-phase), half-split the run like a real tech, then call the bad
// connection. Fewer readings and no wrong calls = a clean diagnosis.
import { hashSeed, rng } from '../sim/rng';
import { C, FONT, backdrop, clamp, ease, label, loop, pointer, roundRect, settle as settleResult, shade, stage } from './kit';
import { result, type PuzzleDef, type PuzzleResult } from './types';

export type Cond = 'H' | 'N' | 'G';
export type FaultKind = 'openHot' | 'openNeutral' | 'looseHot' | 'looseNeutral' | 'mwbcNeutral';
export type ItemKind = 'recep' | 'jbox' | 'light';

export type MeterItem = {
  name: string;
  kind: ItemKind;
  /** 0 = leg A (black), 1 = leg B (red) on a multi-wire branch circuit */
  leg: 0 | 1;
  /** harmless anomaly: a switched outlet whose wall switch is simply off */
  switchedOff: boolean;
};

/** item -1 = the panel (breaker lug, neutral bar, ground bar) */
export type TestPoint = { item: number; cond: Cond; leg: 0 | 1 };

export type MeterModel = {
  seed: number;
  tier: number;
  items: MeterItem[];
  points: TestPoint[];
  fault: { kind: FaultKind; at: number; drop: number };
  /** index of the switched-off outlet, -1 if none */
  anomaly: number;
  mwbc: boolean;
  /** utility voltage at the panel, e.g. 121.4 */
  supply: number;
  /** load toggle offered (kettle + heater on) */
  loadable: boolean;
  /** player must say which conductor (hot / neutral) is bad */
  askConductor: boolean;
  /** readings a half-splitting tech needs */
  par: number;
  maxCalls: number;
  symptom: string;
  /** teaching lines (expected readings). Tiers 0–2 only: from tier 3 the tech
   *  must know split-phase readings; nothing in the model gives the answer away. */
  hints: string[];
};

export type Reading = { a: number; b: number; load: boolean };
export type Call = { item: number; cond: 'H' | 'N' };

/** healthy branch-circuit band for hot-to-neutral and hot-to-ground */
export const OK_LO = 110;
export const OK_HI = 132;
/** neutral-to-ground above this is suspicious */
export const NG_MAX = 6;

export const FAULT_TERM: Record<FaultKind, string> = {
  openHot: 'open hot',
  openNeutral: 'open neutral',
  looseHot: 'loose hot (backstab)',
  looseNeutral: 'loose neutral (backstab)',
  mwbcNeutral: 'lost shared neutral (MWBC)',
};

export const faultConductor = (k: FaultKind): 'H' | 'N' => (k === 'openHot' || k === 'looseHot' ? 'H' : 'N');

const SYMPTOMS: Record<FaultKind, string[]> = {
  openHot: ['Half the kitchen is out. Breaker is on.', 'Half the outlets on this circuit are dead.', 'Outlets dead, breaker never tripped.'],
  openNeutral: [
    'Half the kitchen is out. Breaker is on.',
    'Dead outlets, but the guest’s pen tester beeps.',
    'Lights died after the storm. Breaker is on.',
  ],
  looseHot: ['Lights flicker when the kettle runs.', 'Outlet cuts out when the heater kicks on.', 'Toaster is slow and the lights dim.'],
  looseNeutral: ['Lights flicker when the kettle runs.', 'Outlet cuts out when the heater kicks on.', 'Toaster is slow and the lights dim.'],
  mwbcNeutral: ['Some bulbs blaze, others glow dim. Toaster crawls.', 'Lamp bulbs keep popping; the microwave died.'],
};

const HINTS: string[][] = [
  ['Drag V onto H, COM onto N (or tap them)', '~120 V = healthy. Now try an item further down', 'The first dead item is the fault · tap its name'],
  ['Healthy: H–N ≈120 · H–G ≈120 · N–G ≈0', 'Split the run in half, then half again'],
  ['Healthy: H–N ≈120 · H–G ≈120 · N–G ≈0', 'H–N 0 but H–G 120? The neutral is open', 'H–N 0 and H–G 0? The hot is open'],
];

const RECEPS = ['Counter outlet', 'Fridge outlet', 'Island outlet', 'Dining outlet', 'Sofa outlet', 'Desk outlet', 'Porch outlet', 'Bar outlet'];
const JBOXES = ['Attic J-box', 'Crawlspace splice', 'Wall J-box'];
const LIGHTS = ['Pendant light', 'Hall light', 'Porch light'];

/**
 * Where the circuit is, picked by the work order's job (a crewmate's report in
 * the hangar or the office). Same fault physics, the room's own devices and the
 * way that crewmate would describe it.
 */
const PLACES: Record<string, { receps: string[]; jboxes: string[]; lights: string[]; symptoms: Partial<Record<FaultKind, string[]>> }> = {
  shop: {
    receps: ['Compressor outlet', 'Workbench outlet', 'Charger outlet', 'Parts-washer outlet', 'Drill-press outlet', 'Door-side outlet', 'Tug outlet', 'Crib outlet'],
    jboxes: ['Hangar J-box', 'Conduit pull box', 'Wall J-box'],
    lights: ['Bay light', 'Bench light', 'Crib light'],
    symptoms: {
      openHot: ['Half the hangar outlets are dead. Breaker is on.'],
      openNeutral: ['Dead outlets in the hangar, but the pen tester beeps.'],
      looseHot: ['The compressor cuts out every time it starts.', 'The battery charger drops out under load.'],
      looseNeutral: ['The compressor cuts out every time it starts.', 'The bench lights dim when the charger kicks on.'],
    },
  },
  office: {
    receps: ['Printer outlet', 'Desk outlet', 'Copier outlet', 'Kettle outlet', 'Monitor outlet', 'Filing-room outlet', 'Router outlet', 'Window outlet'],
    jboxes: ['Ceiling J-box', 'Wall J-box', 'Floor box'],
    lights: ['Desk lamp', 'Ceiling light', 'Hall light'],
    symptoms: {
      openHot: ['Half the office outlets are dead. Breaker is on.'],
      openNeutral: ['Office outlets dead, but the pen tester beeps.'],
      looseHot: ['Outlets go dead and come back when the printer runs.'],
      looseNeutral: ['Outlets go dead and come back when the printer runs.', 'The lights dim every time the printer warms up.'],
    },
  },
};

function pickFault(r: ReturnType<typeof rng>, tier: number): FaultKind {
  if (tier <= 1) return 'openHot';
  if (tier === 2) return r.chance(0.7) ? 'openNeutral' : 'openHot';
  if (tier === 3) return r.chance(0.65) ? r.pick(['looseHot', 'looseNeutral'] as const) : 'openNeutral';
  if (tier === 4) return r.chance(0.6) ? r.pick(['looseHot', 'looseNeutral'] as const) : 'openNeutral';
  return 'mwbcNeutral';
}

export function generateMeter(seed: number, tier: number, _tools: string[] = [], job?: string): MeterModel {
  const place = job ? PLACES[job] : undefined;
  const r = rng(seed);
  const t = clamp(Math.round(tier), 0, 5);
  const n = [3, 4, 5, 6, 7, 8][t];
  const kind = pickFault(r, t);
  const mwbc = kind === 'mwbcNeutral';
  const withAnomaly = t >= 4;

  // names: receptacles, plus a splice (tier 2+) and a light (tier 3+)
  const recs = r.shuffle([...(place?.receps ?? RECEPS)]);
  const kinds: ItemKind[] = new Array(n).fill('recep');
  if (t >= 2) kinds[r.int(1, n - 1)] = 'jbox';
  if (t >= 3) kinds[r.pick(kinds.map((_, i) => i).filter((i) => i >= 1 && kinds[i] !== 'jbox'))] = 'light';
  const legStart = r.int(0, 1);
  const items: MeterItem[] = kinds.map((k, i) => ({
    name: k === 'jbox' ? r.pick(place?.jboxes ?? JBOXES) : k === 'light' ? r.pick(place?.lights ?? LIGHTS) : recs[i % recs.length],
    kind: k,
    leg: (mwbc ? (i + legStart) % 2 : 0) as 0 | 1,
    switchedOff: false,
  }));

  // the fault sits past at least one healthy item; past the anomaly by one more;
  // on an MWBC both legs must show symptoms past the break
  const at = r.int(withAnomaly ? 2 : 1, mwbc ? n - 2 : n - 1);
  let anomaly = -1;
  if (withAnomaly) {
    // a receptacle upstream of a healthy item that is itself upstream of the fault
    anomaly = r.pick(items.map((_, i) => i).filter((i) => i <= at - 2 && items[i].kind === 'recep'));
    items[anomaly].switchedOff = true;
    items[anomaly].name = 'Switched outlet';
  }
  const drop = kind === 'looseHot' || kind === 'looseNeutral' ? (t <= 3 ? r.range(22, 32) : r.range(16, 24)) : 0;
  const supply = Math.round(r.range(119.2, 122.8) * 10) / 10;

  const points: TestPoint[] = [{ item: -1, cond: 'H', leg: 0 }];
  if (mwbc) points.push({ item: -1, cond: 'H', leg: 1 });
  points.push({ item: -1, cond: 'N', leg: 0 }, { item: -1, cond: 'G', leg: 0 });
  items.forEach((it, i) => {
    points.push({ item: i, cond: 'H', leg: it.leg }, { item: i, cond: 'N', leg: it.leg }, { item: i, cond: 'G', leg: it.leg });
  });

  const askConductor = t >= 2;
  const par = Math.ceil(Math.log2(n)) + 1 + (askConductor ? 1 : 0) + (anomaly >= 0 ? 1 : 0);
  return {
    seed,
    tier: t,
    items,
    points,
    fault: { kind, at, drop },
    anomaly,
    mwbc,
    supply,
    loadable: t >= 2,
    askConductor,
    par,
    maxCalls: t === 0 ? 5 : 3,
    symptom: r.pick(place?.symptoms[kind] ?? SYMPTOMS[kind]),
    hints: HINTS[t] ?? [],
  };
}

/** Signed voltage to ground (L1 = +, L2 = −, 180° apart) at a test point. */
export function pointVolts(m: MeterModel, p: TestPoint, load: boolean, ignoreSwitch = false): number {
  if (p.cond === 'G') return 0;
  const E = m.supply;
  const s = p.leg === 0 ? 1 : -1;
  if (p.item < 0) return p.cond === 'H' ? s * E : 0;
  const i = p.item;
  // ordinary voltage drop along the run (bigger under load), split hot / neutral
  const d = (load ? 0.42 : 0.03) * (i + 1);
  let h = s * (E - d / 2);
  let n = s * (d / 2);
  const f = m.fault;
  if (i >= f.at) {
    switch (f.kind) {
      case 'openHot':
        h = 0;
        n = 0;
        break;
      case 'openNeutral':
        n = h; // neutral pulled up to the hot through whatever is plugged in
        break;
      case 'looseHot':
        if (load) h -= s * f.drop;
        break;
      case 'looseNeutral':
        if (load) n += s * f.drop;
        break;
      case 'mwbcNeutral': {
        // loads on legs A and B now sit in series across 240 V
        const ratio = load ? 0.25 : 0.4;
        h = s * E;
        n = E - 2 * E * ratio;
        break;
      }
    }
  }
  if (m.items[i].switchedOff && !ignoreSwitch) h = 0; // wall switch off: the switched hot is dead, harmlessly
  return p.cond === 'H' ? h : n;
}

/** What the meter shows (V AC, 0.1 V resolution) between two test points. */
export function readVolts(m: MeterModel, a: number, b: number, load: boolean): number {
  if (a === b) return 0;
  const pa = m.points[a];
  const pb = m.points[b];
  const v = Math.abs(pointVolts(m, pa, load) - pointVolts(m, pb, load));
  // tiny seeded jitter so it feels like a real meter, plus ghost voltage on dead legs
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const j = (hashSeed(m.seed, lo, hi, load ? 1 : 0) % 1000) / 1000;
  const shown = v < 1 ? v + 0.1 + j * 0.5 : v + (j - 0.5) * 0.3;
  return Math.round(Math.max(0, shown) * 10) / 10;
}

/** Non-contact tester on the cable jacket: glows if ANY conductor in it has
 *  voltage to ground. Finds a dead cable, can't tell a hot from a neutral. */
export function cableLive(m: MeterModel, item: number, load: boolean): boolean {
  return m.points.some((p) => p.item === item && p.cond !== 'G' && Math.abs(pointVolts(m, p, load, true)) > 40);
}

export const pointIndex = (m: MeterModel, item: number, cond: Cond, leg?: 0 | 1) =>
  m.points.findIndex((p) => p.item === item && p.cond === cond && (leg === undefined || p.leg === leg));

/** A tech's verdict on an item after reading all three pairs under load. */
export function itemHealthy(m: MeterModel, i: number, load = true): boolean {
  const h = pointIndex(m, i, 'H');
  const n = pointIndex(m, i, 'N');
  const g = pointIndex(m, i, 'G');
  const hn = readVolts(m, h, n, load);
  const hg = readVolts(m, h, g, load);
  const ng = readVolts(m, n, g, load);
  return hn >= OK_LO && hn <= OK_HI && hg >= OK_LO && hg <= OK_HI && ng < NG_MAX;
}

/** Does this reading, on its own, say the item it was taken on is sick? */
function readingVerdict(m: MeterModel, rd: Reading): { item: number; bad: boolean; good: boolean } | null {
  const pa = m.points[rd.a];
  const pb = m.points[rd.b];
  if (pa.item !== pb.item || pa.item < 0) return null;
  const i = pa.item;
  if (m.items[i].switchedOff) return null;
  const v = readVolts(m, rd.a, rd.b, rd.load);
  const pair = [pa.cond, pb.cond].sort().join('');
  const inBand = v >= OK_LO && v <= OK_HI;
  if (pair === 'GN') return { item: i, bad: v >= NG_MAX, good: false };
  // H-N under load is the proof of health; unloaded reads can hide a loose splice
  const loadMatters = m.fault.kind === 'looseHot' || m.fault.kind === 'looseNeutral';
  return { item: i, bad: !inBand, good: pair === 'HN' && inBand && (rd.load || !loadMatters) };
}

/** How far the readings narrowed the fault: 1 = bracketed to one item. */
export function narrowing(m: MeterModel, readings: Reading[]): number {
  const n = m.items.length;
  let lo = -1;
  let hi = n;
  for (const rd of readings) {
    const v = readingVerdict(m, rd);
    if (!v) continue;
    if (v.good && v.item < m.fault.at) lo = Math.max(lo, v.item);
    if (v.bad && v.item >= m.fault.at) hi = Math.min(hi, v.item);
  }
  const remaining = hi - lo; // candidate items left, lo+1..hi
  return clamp(1 - (remaining - 1) / Math.max(1, n), 0, 1);
}

const uniq = (rs: Reading[]) => new Set(rs.map((r) => `${Math.min(r.a, r.b)}-${Math.max(r.a, r.b)}-${r.load ? 1 : 0}`)).size;

export function tallyCalls(m: MeterModel, calls: Call[]) {
  const hit = calls.findIndex((c) => c.item === m.fault.at);
  const wrong = hit < 0 ? calls.length : hit;
  const condOk = hit >= 0 && (!m.askConductor || calls[hit].cond === faultConductor(m.fault.kind));
  return { found: hit >= 0, wrong, condOk };
}

/** Did the readings prove which conductor failed (not just where)? */
export function conductorProven(m: MeterModel, readings: Reading[]): boolean {
  const hot = faultConductor(m.fault.kind) === 'H';
  let hgBad = false;
  let ngBad = false;
  let ngOk = false;
  let hnBad = false;
  let hnHigh = false;
  for (const rd of readings) {
    const pa = m.points[rd.a];
    const pb = m.points[rd.b];
    if (pa.item !== pb.item || pa.item < m.fault.at || m.items[pa.item].switchedOff) continue;
    const v = readVolts(m, rd.a, rd.b, rd.load);
    const pair = [pa.cond, pb.cond].sort().join('');
    if (pair === 'GH' && (v < OK_LO || v > OK_HI)) hgBad = true;
    if (pair === 'GN') (v >= NG_MAX ? (ngBad = true) : (ngOk = true));
    if (pair === 'HN' && v < OK_LO) hnBad = true;
    if (pair === 'HN' && v > OK_HI) hnHigh = true; // only a floating neutral lifts H–N past 120
  }
  return hot ? hgBad || (hnBad && ngOk) : ngBad || hnHigh;
}

export function scoreMeter(m: MeterModel, readings: Reading[], calls: Call[]): number {
  const { found, wrong, condOk } = tallyCalls(m, calls);
  const wrongPen = m.tier === 0 ? 0.08 : 0.2;
  if (found) {
    const extra = Math.max(0, uniq(readings) - m.par);
    const eff = m.tier === 0 ? 0 : Math.min(0.35, 0.05 * extra);
    // the right wire, but unproven, is still a guess
    const condPen = !condOk ? 0.15 : m.askConductor && !conductorProven(m, readings) ? 0.1 : 0;
    const s = 1 - wrongPen * wrong - condPen - eff;
    // a call the readings don't support is a lucky guess, not a diagnosis
    const nar = narrowing(m, readings);
    const cap = m.tier === 0 || nar >= 1 ? 1 : 0.2 + 0.5 * nar;
    return clamp(Math.min(s, cap), 0.1, 1);
  }
  // no correct call: credit for how far the readings narrowed it down
  return clamp(0.08 + 0.37 * narrowing(m, readings) - 0.08 * wrong, 0.05, 0.45);
}

export function summarizeMeter(m: MeterModel, readings: Reading[], calls: Call[]): string {
  const { found, wrong, condOk } = tallyCalls(m, calls);
  const n = uniq(readings);
  const where = m.items[m.fault.at].name;
  const parts: string[] = [];
  if (found) parts.push(`${condOk ? FAULT_TERM[m.fault.kind] : 'right box, wrong wire'} at ${where}`);
  else parts.push(`Not found (${FAULT_TERM[m.fault.kind]} at ${where})`);
  parts.push(`${n} reading${n === 1 ? '' : 's'} (par ${m.par})`);
  if (wrong) parts.push(`${wrong} wrong call${wrong === 1 ? '' : 's'}`);
  return parts.join(', ');
}

// ───────────────────────────── view ─────────────────────────────

const COPPER = shade(C.mech, -0.3); // bare ground: warm orange-brown, not rust
const V_LEAD = shade(C.mech, -0.08);
const CODE: Record<Cond, string> = { H: 'H', N: 'N', G: 'G' };

export const meter: PuzzleDef = {
  id: 'meter',
  role: 'elec',
  title: 'Multimeter diagnosis',
  gesture: 'Drag two probes + tap',
  howTo: 'Probe terminals, find the first bad reading, tap that item.',
  term: 'Open neutral: the return path is broken, so power has nowhere to go.',
  seconds: (tier) => 70 + clamp(tier, 0, 5) * 10,
  mount(host, p) {
    const m = generateMeter(p.seed, p.tier, p.tools, p.context?.job);
    const hasPen = p.tools.includes('nonContact');
    const st = stage(host.el);
    const { ctx } = st;
    const n = m.items.length;
    const readings: Reading[] = [];
    const calls: Call[] = [];
    const seen = new Set<string>();
    const log: string[] = [];
    const rowNote = new Map<number, string>();
    const checked = new Map<number, number>();
    let load = false;
    let finished = false;
    let flourishT = -1;
    /** a finished diagnosis, locked in (the host seals a blind job at once) */
    let pending: PuzzleResult | null = null;
    // blind: your call is the sign-off (no "✓ tight · not here", no second guess), and nothing is revealed after
    const blind = !!p.blind;
    const reveal = () => finished && !blind;
    type Probe = { pt: number; x: number; y: number; drag: number | null; ox: number; oy: number; at: number };
    const probes: Probe[] = [
      { pt: -1, x: 0, y: 0, drag: null, ox: 0, oy: 0, at: 0 },
      { pt: -1, x: 0, y: 0, drag: null, ox: 0, oy: 0, at: 0 },
    ];
    const pen = { x: 0, y: 0, drag: null as number | null, live: false, lastBeep: 0 };
    let hover = -1;
    let selected = -1;
    let needle = 0;
    let settle = { t0: -1, v: 0, snapped: true };
    let sawBad = false;
    let dwell: (Reading & { t0: number }) | null = null;

    const colOf = (pt: TestPoint) =>
      m.mwbc ? (pt.cond === 'H' ? pt.leg : pt.cond === 'N' ? 2 : 3) : pt.cond === 'H' ? 0 : pt.cond === 'N' ? 1 : 2;
    const geo = () => {
      const w = st.w;
      const h = st.h;
      const pad = 14;
      const mY = 28;
      const mH = clamp(h * 0.155, 92, 118);
      const trayH = 124;
      const trayY = h - trayH;
      const dTop = mY + mH + 12;
      const dBot = trayY - 6;
      const rowH = Math.min(n <= 4 ? 70 : 60, (dBot - dTop - 22) / (n + 1));
      const cols = m.mwbc ? 4 : 3;
      const colGap = clamp((w - 2 * pad) * 0.125, 44, 54);
      const colX = (k: number) => w - pad - 26 - (cols - 1 - k) * colGap;
      const slack = Math.max(0, dBot - dTop - 22 - rowH * (n + 1)) / 2;
      const rowY = (r: number) => dTop + 20 + slack * 0.6 + rowH * (r + 0.5);
      const docks = [
        { x: pad + 30, y: trayY + 12 },
        { x: pad + 84, y: trayY + 12 },
        { x: pad + 138, y: trayY + 12 },
      ];
      const loadR = { x: w - pad - 124, y: trayY + 14, w: 124, h: 46 };
      return { w, h, pad, mY, mH, trayY, dTop, dBot, rowH, cols, colGap, colX, rowY, docks, loadR };
    };
    type G = ReturnType<typeof geo>;
    const ptPos = (g: G, i: number) => {
      const pt = m.points[i];
      return { x: g.colX(colOf(pt)), y: g.rowY(pt.item + 1) };
    };
    const nearestPt = (g: G, x: number, y: number, r: number) => {
      let best = -1;
      let bd = r;
      m.points.forEach((_, i) => {
        const q = ptPos(g, i);
        const d = Math.hypot(q.x - x, q.y - y);
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      return best;
    };
    const ptName = (i: number) => {
      const pt = m.points[i];
      const where = pt.item < 0 ? 'P' : String(pt.item + 1);
      const c = m.mwbc && pt.cond === 'H' && pt.item < 0 ? (pt.leg ? 'B' : 'A') : CODE[pt.cond];
      return { where, c };
    };
    const probeTip = (g: G, k: number) => {
      const pr = probes[k];
      if (pr.drag !== null) return { x: pr.x, y: pr.y };
      if (pr.pt >= 0) return ptPos(g, pr.pt);
      return g.docks[k];
    };
    /** direction the probe body leans from its tip */
    const lean = (k: number, docked: boolean) => {
      if (docked) return 0;
      const g = geo();
      const mine = probeTip(g, k).x;
      const o = probes[1 - k];
      const other = o.pt >= 0 || o.drag !== null ? probeTip(g, 1 - k).x : k === 0 ? Infinity : -Infinity;
      return mine < other || (mine === other && k === 0) ? -0.42 : 0.42;
    };
    const bodyAt = (g: G, k: number) => {
      const t = probeTip(g, k);
      const a = lean(k, probes[k].pt < 0 && probes[k].drag === null);
      return { x: t.x + Math.sin(a) * 40, y: t.y + Math.cos(a) * 40, tx: t.x, ty: t.y, a };
    };

    const status = () => {
      const left = m.maxCalls - calls.length;
      host.status(`${readings.length} reading${readings.length === 1 ? '' : 's'} · par ${m.par} · ${blind ? 'your call signs it off' : `${left} call${left === 1 ? '' : 's'} left`}`);
    };
    status();

    const takeReading = () => {
      const a = probes[0].pt;
      const b = probes[1].pt;
      dwell = null;
      if (a < 0 || b < 0 || a === b) {
        settle.t0 = -1;
        return;
      }
      const v = readVolts(m, a, b, load);
      const rank = (i: number) => (m.points[i].cond === 'H' ? 0 : m.points[i].cond === 'N' ? 1 : 2) + m.points[i].item * 3;
      const [na, nb] = rank(a) <= rank(b) ? [ptName(a), ptName(b)] : [ptName(b), ptName(a)];
      const pair = na.where === nb.where ? `${na.where} ${na.c}–${nb.c}` : `${na.where}.${na.c}–${nb.where}.${nb.c}`;
      log.unshift(`${pair}${load ? '*' : ''}  ${v.toFixed(1)}`);
      log.length = Math.min(log.length, 3);
      if (na.where === nb.where && na.where !== 'P') rowNote.set(Number(na.where) - 1, `${na.c}–${nb.c} ${v.toFixed(1)} V${load ? ' loaded' : ''}`);
      if (v < OK_LO && na.c !== 'G' && nb.c !== 'G') sawBad = true;
      settle = { t0: performance.now(), v, snapped: !!p.reducedMotion };
      if (p.reducedMotion) host.fx.snap();
      // a same-device pair is a deliberate reading; a cross-device pair counts only
      // if the tech holds it (a long-lead reading), not while shuffling probes
      dwell = { a, b, load, t0: performance.now() };
      if (m.points[a].item === m.points[b].item) commit();
    };
    const commit = () => {
      if (!dwell) return;
      const { a, b } = dwell;
      const key = `${Math.min(a, b)}-${Math.max(a, b)}-${dwell.load ? 1 : 0}`;
      if (!seen.has(key)) {
        seen.add(key);
        readings.push({ a, b, load: dwell.load });
      }
      dwell = null;
      status();
    };

    const finish = () => {
      if (finished) return;
      finished = true;
      selected = -1;
      const res = result(scoreMeter(m, readings, calls), summarizeMeter(m, readings, calls), {
        readings: readings.length,
        par: m.par,
        calls: calls.length,
        fault: m.fault.kind,
      });
      if (res.perfect && !blind) {
        flourishT = performance.now();
        host.fx.flourish();
      } else host.fx.good();
      pending = res;
      settleResult(host, res, res.perfect ? 850 : 350);
    };

    const call = (item: number, cond: 'H' | 'N') => {
      calls.push({ item, cond });
      selected = -1;
      if (item === m.fault.at || blind) {
        finish();
        return;
      }
      host.fx.bad();
      checked.set(item, performance.now());
      status();
      if (calls.length >= m.maxCalls) finish();
    };

    const chips = (g: G) => {
      const y = g.trayY + 72;
      const list: { x: number; w: number; id: 'H' | 'N' | 'X'; text: string }[] = [];
      let x = g.w - g.pad - 48;
      list.push({ x, w: 48, id: 'X', text: '✕' });
      if (m.askConductor) {
        x -= 96;
        list.push({ x, w: 90, id: 'N', text: 'Neutral' });
        x -= 78;
        list.push({ x, w: 72, id: 'H', text: 'Hot' });
      } else {
        x -= 102;
        list.push({ x, w: 96, id: 'H', text: 'Call it' });
      }
      return list.map((c) => ({ ...c, y, h: 46 }));
    };

    const offPtr = pointer(st.canvas, {
      down(pt) {
        if (finished || host.paused()) return;
        const g = geo();
        if (selected >= 0) {
          for (const c of chips(g)) {
            if (pt.x >= c.x && pt.x <= c.x + c.w && pt.y >= c.y - 2 && pt.y <= c.y + c.h + 4) {
              if (c.id === 'X') {
                selected = -1;
                host.fx.tap();
              } else call(selected, c.id);
              return;
            }
          }
        }
        // grab a probe (placed or docked)
        for (const k of [1, 0]) {
          const b = bodyAt(g, k);
          const t = probeTip(g, k);
          const docked = probes[k].pt < 0;
          const hit = docked
            ? Math.abs(pt.x - t.x) < 26 && pt.y > t.y - 12 && pt.y < t.y + 62
            : Math.hypot(pt.x - b.x, pt.y - b.y) < 26 || Math.hypot(pt.x - t.x, pt.y - t.y) < 12;
          if (hit) {
            const pr = probes[k];
            pr.drag = pt.id;
            // tip rides above the thumb so the terminal stays visible
            pr.ox = docked ? 0 : t.x - pt.x;
            pr.oy = docked ? -46 : Math.min(-30, t.y - pt.y);
            pr.x = pt.x + pr.ox;
            pr.y = pt.y + pr.oy;
            pr.pt = -1;
            settle.t0 = -1;
            dwell = null;
            host.fx.tap();
            return;
          }
        }
        if (hasPen) {
          const d = g.docks[2];
          const px = pen.drag === null ? d.x : pen.x;
          if (Math.abs(pt.x - px) < 26 && pt.y > d.y - 12 && pt.y < d.y + 62) {
            pen.drag = pt.id;
            pen.x = pt.x;
            pen.y = pt.y - 46;
            host.fx.tap();
            return;
          }
        }
        const L = g.loadR;
        if (m.loadable && pt.x >= L.x && pt.x <= L.x + L.w && pt.y >= L.y - 4 && pt.y <= L.y + L.h + 4) {
          load = !load;
          host.fx.thunk();
          if (probes[0].pt >= 0 && probes[1].pt >= 0) takeReading();
          return;
        }
        // tap a terminal: drop the free (or older) probe on it
        const tp = nearestPt(g, pt.x, pt.y, 22);
        if (tp >= 0) {
          const k = probes[0].pt < 0 ? 0 : probes[1].pt < 0 ? 1 : probes[0].at <= probes[1].at ? 0 : 1;
          const other = probes[1 - k];
          if (other.pt === tp) return;
          probes[k].pt = tp;
          probes[k].at = performance.now();
          host.fx.tick();
          takeReading();
          return;
        }
        // tap an item's name to call it
        const r = Math.round((pt.y - g.rowY(0)) / g.rowH);
        if (r >= 1 && r <= n && pt.x < g.colX(0) - 20 && Math.abs(pt.y - g.rowY(r)) < g.rowH / 2) {
          selected = selected === r - 1 ? -1 : r - 1;
          host.fx.tap();
          return;
        }
        if (selected >= 0) selected = -1;
      },
      move(pt) {
        if (finished || host.paused()) return;
        const g = geo();
        for (const pr of probes) {
          if (pr.drag !== pt.id) continue;
          pr.x = clamp(pt.x + pr.ox, 4, g.w - 4);
          pr.y = clamp(pt.y + pr.oy, 4, g.h - 4);
          hover = nearestPt(g, pr.x, pr.y, 30);
        }
        if (pen.drag === pt.id) {
          pen.x = clamp(pt.x, 4, g.w - 4);
          pen.y = clamp(pt.y - 46, 4, g.h - 4);
          // held against a cable run: senses any conductor with voltage to ground
          const r = Math.round((pen.y - g.rowY(0)) / g.rowH);
          const onRun = r >= 0 && r <= n && pen.x > g.colX(0) - 30 && pen.x < g.colX(g.cols - 1) + 30 && Math.abs(pen.y - g.rowY(r)) <= g.rowH * 0.5;
          pen.live = onRun && (r === 0 || cableLive(m, r - 1, load));
          const now = performance.now();
          if (pen.live && now - pen.lastBeep > 160) {
            host.fx.tick();
            pen.lastBeep = now;
          }
        }
      },
      up(pt) {
        const g = geo();
        probes.forEach((pr, k) => {
          if (pr.drag !== pt.id) return;
          pr.drag = null;
          hover = -1;
          if (finished) return;
          const q = nearestPt(g, pr.x, pr.y, 32);
          if (q >= 0 && probes[1 - k].pt !== q) {
            pr.pt = q;
            pr.at = performance.now();
            host.fx.tick();
            takeReading();
          } else {
            pr.pt = -1;
            host.fx.swipe();
          }
        });
        if (pen.drag === pt.id) {
          pen.drag = null;
          pen.live = false;
        }
      },
    });

    const stop = loop((_t, dt) => {
      const now = performance.now();
      if (host.paused()) {
        // hold the meter and the long-lead timer still while paused
        if (settle.t0 > 0) settle.t0 += dt * 1000;
        if (dwell) dwell.t0 += dt * 1000;
      }
      if (settle.t0 > 0 && !settle.snapped && now - settle.t0 > 320) {
        settle.snapped = true;
        host.fx.snap();
      }
      if (dwell && now - dwell.t0 > 1100) {
        if (probes[0].pt === dwell.a && probes[1].pt === dwell.b && load === dwell.load && !finished) commit();
        else dwell = null;
      }
      const target = settle.t0 > 0 ? settle.v : 0;
      needle = p.reducedMotion ? target : needle + (target - needle) * (1 - Math.exp(-dt / 0.09));
      draw(geo(), now);
    });

    function draw(g: G, now: number) {
      backdrop(ctx, g.w, g.h);
      const gleam = flourishT > 0 ? clamp((now - flourishT) / 800, 0, 1) : 0;
      // symptom line, shrunk to fit the width
      const sym = `“${m.symptom}”`;
      let fs = 12.5;
      ctx.font = `600 ${fs}px ${FONT}`;
      while (fs > 10 && ctx.measureText(sym).width > g.w - 2 * g.pad) {
        fs -= 0.5;
        ctx.font = `600 ${fs}px ${FONT}`;
      }
      label(ctx, sym, g.pad, 14, { size: fs, color: C.inkSoft, align: 'left' });
      drawMeter(g, now);
      drawDiagram(g, now, gleam);
      drawTray(g, now);
      drawLeads(g);
      for (const k of [0, 1]) drawProbe(g, k);
      if (hasPen) drawPen(g, now);
      if (gleam > 0 && gleam < 1) {
        ctx.globalAlpha = 0.3 * (1 - ease.outCubic(gleam));
        ctx.fillStyle = C.white;
        ctx.fillRect(0, 0, g.w, g.h);
        ctx.globalAlpha = 1;
      }
    }

    function drawMeter(g: G, now: number) {
      const x = g.pad;
      const y = g.mY;
      const W = g.w - 2 * g.pad;
      const H = g.mH;
      roundRect(ctx, x, y + 3, W, H, 18);
      ctx.fillStyle = 'rgba(31,42,48,0.12)';
      ctx.fill();
      roundRect(ctx, x, y, W, H, 18);
      ctx.fillStyle = C.elec;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = shade(C.elec, -0.35);
      ctx.stroke();
      // LCD
      const lx = x + 10;
      const ly = y + 10;
      const lw = W * 0.63;
      const lh = H - 20;
      roundRect(ctx, lx, ly, lw, lh, 8);
      const lg = ctx.createLinearGradient(0, ly, 0, ly + lh);
      lg.addColorStop(0, shade(C.palm, 0.72));
      lg.addColorStop(1, shade(C.palm, 0.82));
      ctx.fillStyle = lg;
      ctx.fill();
      ctx.strokeStyle = shade(C.ink, 0.3);
      ctx.lineWidth = 2;
      ctx.stroke();
      // faint needle sweep (0..250 V)
      ctx.save();
      roundRect(ctx, lx, ly, lw, lh, 8);
      ctx.clip();
      const cx = lx + lw / 2;
      // shallow arc in the top band so it never runs through the digits
      const cy = ly + lh * 2.6;
      const R = lh * 2.45;
      const a0 = -Math.PI / 2 - 0.4;
      const a1 = -Math.PI / 2 + 0.4;
      const toA = (v: number) => a0 + (clamp(v, 0, 250) / 250) * (a1 - a0);
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, R, a0, a1);
      ctx.stroke();
      for (let v = 0; v <= 250; v += 10) {
        const a = toA(v);
        const len = v % 60 === 0 ? 7 : 3;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
        ctx.lineTo(cx + Math.cos(a) * (R + len), cy + Math.sin(a) * (R + len));
        ctx.stroke();
      }
      for (const v of [0, 120, 240]) {
        const a = toA(v);
        label(ctx, String(v), cx + Math.cos(a) * (R - 10), cy + Math.sin(a) * (R - 10), { size: 8.5, weight: 700 });
      }
      const na = toA(needle);
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(na) * (R - lh * 0.32), cy + Math.sin(na) * (R - lh * 0.32));
      ctx.lineTo(cx + Math.cos(na) * (R + 8), cy + Math.sin(na) * (R + 8));
      ctx.stroke();
      ctx.restore();
      // digits: fixed cells = tabular figures, with ghost segments behind
      const live = settle.t0 > 0;
      let val = settle.v;
      if (live && !settle.snapped) val = settle.v * (0.55 + 0.45 * ((now - settle.t0) / 320)) + (Math.random() - 0.5) * 6;
      const str = live ? Math.max(0, val).toFixed(1).padStart(5, ' ') : '  -.-';
      const size = Math.min(42, lh * 0.4);
      const cell = size * 0.62;
      const dot = size * 0.3;
      const right = lx + lw - 12;
      const base = ly + lh * 0.9;
      let cxr = right;
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'center';
      for (let i = str.length - 1; i >= 0; i--) {
        const ch = str[i];
        const cw = ch === '.' ? dot : cell;
        const mx = cxr - cw / 2;
        ctx.font = `700 ${size}px ui-monospace, 'SF Mono', Menlo, monospace`;
        if (ch !== '.') {
          ctx.fillStyle = 'rgba(31,42,48,0.05)';
          ctx.fillText('8', mx, base);
        }
        ctx.fillStyle = C.ink;
        if (ch !== ' ') ctx.fillText(ch, mx, base);
        cxr -= cw;
      }
      label(ctx, 'V AC', lx + lw - 10, ly + 11, { size: 10, weight: 800, align: 'right' });
      label(ctx, load ? 'LOADED' : 'AUTO', lx + 8, ly + 11, { size: 9, weight: 800, align: 'left', color: shade(C.ink, 0.2) });
      // side panel: log + jacks
      const sx = lx + lw + 10;
      const sw = x + W - 10 - sx;
      label(ctx, 'LOG', sx, y + 16, { size: 9, weight: 800, align: 'left', color: shade(C.ink, 0.25) });
      log.forEach((l, i) => {
        ctx.save();
        ctx.globalAlpha = 1 - i * 0.25;
        label(ctx, l, sx, y + 31 + i * 14, { size: 10.5, weight: 700, align: 'left' });
        ctx.restore();
      });
      const jy = y + H - 20;
      const jacks = [sx + sw * 0.3, sx + sw * 0.75];
      jacks.forEach((jx, k) => {
        ctx.fillStyle = C.ink;
        ctx.beginPath();
        ctx.arc(jx, jy, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = k === 0 ? V_LEAD : shade(C.ink, 0.4);
        ctx.beginPath();
        ctx.arc(jx, jy, 4, 0, Math.PI * 2);
        ctx.fill();
        label(ctx, k === 0 ? 'V' : 'COM', jx, jy - 16, { size: 9, weight: 800 });
      });
    }

    function wireColor(k: number) {
      if (m.mwbc) return [C.ink, C.sea, C.paper, COPPER][k];
      return [C.ink, C.paper, COPPER][k];
    }

    function drawDiagram(g: G, now: number, gleam: number) {
      const top = g.dTop;
      roundRect(ctx, g.pad - 4, top, g.w - 2 * g.pad + 8, g.dBot - top, 14);
      ctx.fillStyle = 'rgba(251,245,233,0.78)';
      ctx.fill();
      ctx.strokeStyle = C.sandDeep;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      const heads = m.mwbc ? ['A', 'B', 'N', 'G'] : ['H', 'N', 'G'];
      const hy = Math.max(top + 12, g.rowY(0) - g.rowH / 2 - 4);
      heads.forEach((hd, k) => label(ctx, hd, g.colX(k), hy, { size: 10.5, weight: 800, color: C.inkSoft }));
      label(ctx, m.mwbc ? 'MWBC · shared neutral' : '20 A branch circuit', g.pad + 8, hy, {
        size: 10.5,
        weight: 700,
        align: 'left',
        color: C.inkSoft,
      });
      // conductors (drawn continuous: the break is inside a box, not visible)
      for (let k = 0; k < g.cols; k++) {
        const x = g.colX(k);
        const y0 = g.rowY(0);
        const y1 = g.rowY(n);
        ctx.lineCap = 'round';
        ctx.lineWidth = 6;
        ctx.strokeStyle = shade(C.ink, 0.15);
        ctx.beginPath();
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y1);
        ctx.stroke();
        ctx.lineWidth = 3.6;
        ctx.strokeStyle = wireColor(k);
        ctx.stroke();
      }
      for (let r = 0; r <= n; r++) {
        const y = g.rowY(r);
        const it = r > 0 ? m.items[r - 1] : null;
        const i = r - 1;
        const isFault = reveal() && i === m.fault.at;
        const chk = checked.get(i);
        if ((r > 0 && selected === i) || isFault) {
          roundRect(ctx, g.pad, y - g.rowH / 2 + 3, g.w - 2 * g.pad, g.rowH - 6, 10);
          ctx.fillStyle = isFault ? 'rgba(199,80,47,0.10)' : 'rgba(46,124,147,0.12)';
          ctx.fill();
          ctx.strokeStyle = isFault ? C.rust : C.sea;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        if (chk && now - chk < 700) {
          roundRect(ctx, g.pad, y - g.rowH / 2 + 3, g.colX(0) - g.pad - 20, g.rowH - 6, 10);
          ctx.strokeStyle = C.rust;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        // tie line from device to its terminals
        ctx.strokeStyle = C.sandDeep;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(g.pad + 36, y);
        ctx.lineTo(g.colX(0) - 12, y);
        ctx.stroke();
        ctx.setLineDash([]);
        drawIcon(g.pad + 20, y, it, gleam, r === 0);
        const name = r === 0 ? (m.mwbc ? 'Panel · 2-pole 20 A' : 'Panel · 20 A breaker') : `${r}  ${it!.name}`;
        const nameW = g.colX(0) - 22 - (g.pad + 40);
        ctx.save();
        ctx.beginPath();
        ctx.rect(g.pad + 36, y - g.rowH / 2, nameW + 4, g.rowH);
        ctx.clip();
        ctx.font = `700 13px ${FONT}`;
        ctx.fillStyle = C.paper;
        ctx.fillRect(g.pad + 38, y - 15, Math.min(nameW, ctx.measureText(name).width + 8), 30);
        label(ctx, name, g.pad + 40, y - 6, { size: 13, weight: 700, align: 'left' });
        let sub = '';
        let subColor: string = C.inkSoft;
        if (isFault) {
          sub = FAULT_TERM[m.fault.kind];
          subColor = C.rust;
        } else if (chk) sub = '✓ tight · not here';
        else if (r === 0) sub = 'breaker ON';
        else if (rowNote.has(i)) sub = rowNote.get(i)!;
        else if (i === 0 && m.tier === 0 && readings.length === 0) sub = 'start here: H to N';
        if (sub) label(ctx, sub, g.pad + 40, y + 10, { size: 11, weight: 600, align: 'left', color: subColor });
        ctx.restore();
      }
      // terminals
      const pulse = p.reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(now / 260);
      m.points.forEach((pt, idx) => {
        const q = ptPos(g, idx);
        const k = colOf(pt);
        const dead = pt.item >= 0 && m.items[pt.item].switchedOff && pt.cond === 'H';
        if (m.tier === 0 && readings.length === 0 && pt.item === 0 && pt.cond !== 'G') {
          ctx.strokeStyle = C.sea;
          ctx.lineWidth = 2;
          ctx.globalAlpha = 0.4 + 0.5 * pulse;
          ctx.beginPath();
          ctx.arc(q.x, q.y, 15, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        if (hover === idx) {
          ctx.fillStyle = 'rgba(46,124,147,0.2)';
          ctx.beginPath();
          ctx.arc(q.x, q.y, 18, 0, Math.PI * 2);
          ctx.fill();
        }
        const faultDot = reveal() && pt.item === m.fault.at && pt.cond === faultConductor(m.fault.kind);
        ctx.fillStyle = dead ? C.paper : wireColor(k);
        ctx.strokeStyle = faultDot ? C.rust : C.ink;
        ctx.lineWidth = faultDot ? 3 : 1.6;
        ctx.beginPath();
        ctx.arc(q.x, q.y, dead ? 6 : 7.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        if (dead) {
          // little open switch glyph beside the switched terminal
          ctx.strokeStyle = C.ink;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(q.x - 22, q.y + 6);
          ctx.lineTo(q.x - 12, q.y - 4);
          ctx.stroke();
        }
      });
    }

    function drawIcon(x: number, y: number, it: MeterItem | null, gleam: number, panel: boolean) {
      ctx.save();
      ctx.translate(x, y);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = C.ink;
      if (panel) {
        roundRect(ctx, -12, -15, 24, 30, 3);
        ctx.fillStyle = shade(C.inkSoft, 0.55);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = C.ink;
        ctx.fillRect(-4, -10, 8, 8);
        ctx.fillRect(-4, 2, 8, 8);
      } else if (it!.kind === 'jbox') {
        ctx.beginPath();
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
          ctx.lineTo(Math.cos(a) * 14, Math.sin(a) * 14);
        }
        ctx.closePath();
        ctx.fillStyle = shade(C.inkSoft, 0.6);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = C.elec;
        ctx.beginPath();
        ctx.arc(0, 0, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (it!.kind === 'light') {
        ctx.fillStyle = gleam > 0 ? shade(C.elec, 0.2) : C.paper;
        if (gleam > 0) {
          ctx.shadowColor = C.elec;
          ctx.shadowBlur = 18;
        }
        ctx.beginPath();
        ctx.arc(0, -2, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.stroke();
        ctx.fillStyle = C.inkSoft;
        ctx.fillRect(-5, 8, 10, 6);
      } else {
        roundRect(ctx, -10, -15, 20, 30, 5);
        ctx.fillStyle = gleam > 0 ? shade(C.elec, 0.5) : C.white;
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = C.ink;
        for (const oy of [-7, 6]) {
          ctx.fillRect(-5, oy - 3, 2, 5);
          ctx.fillRect(3, oy - 3, 2, 5);
        }
      }
      ctx.restore();
    }

    function drawTray(g: G, now: number) {
      const y = g.trayY;
      ctx.fillStyle = 'rgba(230,208,166,0.55)';
      roundRect(ctx, 0, y, g.w, g.h - y + 20, 18);
      ctx.fill();
      // docks
      const names = ['V', 'COM', 'NCV'];
      for (let k = 0; k < (hasPen ? 3 : 2); k++) {
        const d = g.docks[k];
        roundRect(ctx, d.x - 21, d.y - 6, 42, 60, 10);
        ctx.fillStyle = 'rgba(31,42,48,0.07)';
        ctx.fill();
        const out = k < 2 ? probes[k].pt >= 0 || probes[k].drag !== null : pen.drag !== null;
        if (out) label(ctx, names[k], d.x, d.y + 24, { size: 11, weight: 800, color: C.inkSoft });
      }
      if (m.loadable) {
        const L = g.loadR;
        roundRect(ctx, L.x, L.y, L.w, L.h, 23);
        ctx.fillStyle = load ? C.elec : C.paper;
        ctx.fill();
        ctx.strokeStyle = C.ink;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        const kx = load ? L.x + L.w - 23 : L.x + 23;
        ctx.fillStyle = load ? C.ink : C.inkSoft;
        ctx.beginPath();
        ctx.arc(kx, L.y + 23, 17, 0, Math.PI * 2);
        ctx.fill();
        label(ctx, load ? 'Load ON' : 'Load off', load ? L.x + 48 : L.x + L.w - 44, L.y + 16, { size: 13, weight: 800 });
        label(ctx, 'kettle + heater', load ? L.x + 48 : L.x + L.w - 44, L.y + 32, { size: 9.5, weight: 600, color: C.inkSoft });
      }
      // row 2: call chips or a prompt
      const ry = y + 72;
      if (selected >= 0 && !finished) {
        label(ctx, `${m.askConductor ? 'Bad wire here?' : 'Fault here?'}${blind ? ' (final)' : ''}`, g.pad + 4, ry + 23, { size: 13, weight: 800, align: 'left' });
        for (const c of chips(g)) {
          roundRect(ctx, c.x, c.y, c.w, c.h, 23);
          ctx.fillStyle = c.id === 'X' ? C.paper : C.sea;
          ctx.fill();
          ctx.strokeStyle = c.id === 'X' ? C.inkSoft : C.seaDeep;
          ctx.lineWidth = 1.5;
          ctx.stroke();
          label(ctx, c.text, c.x + c.w / 2, c.y + c.h / 2, { size: 14, weight: 800, color: c.id === 'X' ? C.ink : C.white });
        }
      } else if (!finished) {
        let tip = 'Probe terminals · tap an item’s name to call the fault';
        const hs = m.hints;
        if (m.tier === 0 && hs.length) tip = !readings.length ? hs[0] : !sawBad ? hs[1] : hs[2];
        else if (hs.length) tip = hs[Math.floor(now / 4200) % hs.length];
        label(ctx, tip, g.w / 2, ry + 23, { size: 12, weight: 700, color: C.inkSoft });
      }
    }

    function drawLeads(g: G) {
      // a short length of test lead leaving each probe (the rest runs off to the meter)
      ctx.save();
      ctx.lineCap = 'round';
      for (const k of [0, 1]) {
        const b = bodyAt(g, k);
        const tx = b.tx + Math.sin(b.a) * 62;
        const ty = b.ty + Math.cos(b.a) * 62;
        const ex = tx + (k === 0 ? -26 : 26);
        const ey = Math.min(g.h + 10, ty + 56);
        const lg = ctx.createLinearGradient(tx, ty, ex, ey);
        const col = k === 0 ? 'rgba(206,151,81,' : 'rgba(31,42,48,';
        lg.addColorStop(0, col + '0.9)');
        lg.addColorStop(1, col + '0)');
        ctx.strokeStyle = lg;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.quadraticCurveTo(tx, ty + 34, ex, ey);
        ctx.stroke();
      }
      ctx.restore();
    }

    function drawProbe(g: G, k: number) {
      const b = bodyAt(g, k);
      ctx.save();
      ctx.translate(b.tx, b.ty);
      ctx.rotate(-b.a);
      // metal tip, then the insulated body with a finger guard
      ctx.strokeStyle = shade(C.inkSoft, 0.35);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, 14);
      ctx.stroke();
      const body = k === 0 ? V_LEAD : C.ink;
      roundRect(ctx, -6, 14, 12, 48, 5);
      ctx.fillStyle = body;
      ctx.fill();
      ctx.strokeStyle = shade(C.ink, 0.1);
      ctx.lineWidth = 1.2;
      ctx.stroke();
      roundRect(ctx, -9, 18, 18, 5, 2);
      ctx.fillStyle = body;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      const docked = probes[k].pt < 0 && probes[k].drag === null;
      if (docked) label(ctx, k === 0 ? 'V' : 'COM', b.tx, b.ty + 40, { size: 9, weight: 800, color: k === 0 ? C.ink : C.paper });
    }

    function drawPen(g: G, now: number) {
      const d = g.docks[2];
      const x = pen.drag === null ? d.x : pen.x;
      const y = pen.drag === null ? d.y : pen.y;
      if (pen.live) {
        const rg = ctx.createRadialGradient(x, y, 2, x, y, 30);
        rg.addColorStop(0, 'rgba(244,211,94,0.95)');
        rg.addColorStop(1, 'rgba(244,211,94,0)');
        ctx.fillStyle = rg;
        ctx.beginPath();
        ctx.arc(x, y, 30 + (p.reducedMotion ? 0 : 3 * Math.sin(now / 60)), 0, Math.PI * 2);
        ctx.fill();
      }
      roundRect(ctx, x - 7, y, 14, 58, 6);
      ctx.fillStyle = C.elec;
      ctx.fill();
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.fillStyle = pen.live ? C.white : shade(C.inkSoft, 0.4);
      ctx.beginPath();
      ctx.arc(x, y + 7, 4, 0, Math.PI * 2);
      ctx.fill();
      if (pen.drag === null) label(ctx, 'NCV', x, y + 36, { size: 8.5, weight: 800 });
    }

    return {
      timeUp(): PuzzleResult {
        if (pending) return pending;
        finished = true;
        return result(scoreMeter(m, readings, calls), summarizeMeter(m, readings, calls), { readings: readings.length, par: m.par });
      },
      destroy() {
        stop();
        offPtr();
        st.destroy();
      },
    };
  },
};
