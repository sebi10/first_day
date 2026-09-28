// Electrician · Circuit trace. Some outlets in a cottage are dead. Trace the
// cable through the wall from the breaker, test devices, and mark where the
// fault is. Real troubleshooting logic: on a daisy chain the open is between
// the LAST LIVE device and the FIRST DEAD one (very often a loose backstab at
// the last live outlet). Tiers 0–2 show which devices are live; from tier 3
// you test them yourself (fewest tests wins: half-split the run).
//
// From the job flow the circuit is the alert's own (context.site): its room
// and breaker; one receptacle on an individual circuit; and a warm plate is a
// live high-resistance joint, not a dead run: every device is live, and the
// test is an IR thermometer at each plate: mark the hot termination.
//
// The underground feeder to the east cottages (job 'feeder': the feeder job,
// its re-splice repairs and redos) is its own scene, never a room: a site plan
// of the yard, the feeder breaker locked out and the cottages' disconnects
// open. Follow the buried run from the panel with the cable locator, open a
// hand hole and megger back to the panel (1000 V): the sections before the
// failed splice read hundreds of MΩ, from the failed splice on it reads what
// the whole run read (0.4 MΩ). Dig the section between the last good hand hole
// and the first bad one (the splice in the ground, not a hand hole), then close
// it up: cut it out, re-splice with the kits the job flow picked, megger again
// before re-energizing, backfill with 24 in of cover and a warning ribbon.
// Tiers 0-2 show every reading and colour it; from tier 3 you megger it
// yourself and the readings are plain numbers (knowing 0.4 MΩ is a failed
// splice is the trade). Blind: where you dig is where you re-splice.
import { hashSeed, rng } from '../sim/rng';
import { C, FONT, backdrop, clamp, fitLabel, label, loop, pointer, roundRect, stage, settle } from './kit';
import { result, type PuzzleContext, type PuzzleDef, type PuzzleResult, type PuzzleSite } from './types';

type P = { x: number; y: number }; // normalised
export type Device = { id: number; kind: 'outlet' | 'switch' | 'light' | 'jbox' | 'handhole' | 'cottages'; pos: P; live: boolean; name: string };
export type Seg = { from: number; to: number; pts: P[]; circuit: 1 | 2 };
export type TraceModel = {
  devices: Device[]; // index 0 = panel breaker
  segs: Seg[];
  chain: number[]; // devices on the faulty run, in order from the panel
  faultAfter: number; // index into chain: fault lies between chain[faultAfter] and chain[faultAfter+1] (warm: the hot device is chain[faultAfter])
  showStates: boolean;
  symptom: string;
  optimalTests: number;
  /** the breaker's rating (the alert's circuit; 20 A otherwise) */
  amps: number;
  /** a warm termination: every device live; `temps` (°F) at each device, the hot one at chain[faultAfter] */
  warm?: boolean;
  temps?: number[];
  /**
   * The underground feeder (job 'feeder'): hand holes and the cottages, not outlets. `megohms` is what the
   * megger reads at each device, back to the panel with the run opened there (the panel's: the whole run);
   * `live` means the insulation back to the panel is good. `fault` is the failed splice's reading; `whole` what the
   * whole run reads from the panel once it's re-spliced (every section in parallel).
   */
  feeder?: { megohms: number[]; fault: number; whole: number };
};

/** the underground feeder scene is the job's, whatever launched it (the feeder job, its repair, its redo) */
export const isFeeder = (c?: Pick<PuzzleContext, 'job'>) => c?.job === 'feeder';

const ROOMS = ['Kitchen', 'Bath', 'Bedroom', 'Porch', 'Living room', 'Deck'];
/** a crewmate's report from the hangar: the same wall-and-cable hunt, the hangar's own stations */
const HANGAR = ['Bay', 'Bench', 'Crib', 'Stores', 'Office', 'Door'];

export function generateTrace(seed: number, tier: number, _tools: string[] = [], job?: string, site?: PuzzleSite): TraceModel {
  if (job === 'feeder') return generateFeeder(seed, tier, site);
  const r = rng(seed);
  const ROOMS_ = job === 'hangar' ? HANGAR : ROOMS;
  const single = !!site?.single;
  const warm = site?.fault === 'warm';
  const amps = site?.amps ?? 20;
  // an individual circuit is one receptacle for one appliance
  const n = single ? 1 : tier <= 0 ? 3 : tier <= 2 ? 3 + tier : tier === 3 ? 6 : tier === 4 ? 7 : 8;
  const devices: Device[] = [{ id: 0, kind: 'outlet', pos: { x: 0.08, y: 0.1 }, live: true, name: `Breaker ${amps} A` }];
  // the alert's room names the run's devices (the spur and the other circuit are elsewhere in the house)
  const runRoom = () => site?.room ?? r.pick(ROOMS_);
  const segs: Seg[] = [];
  // main run: snake across the wall at two heights, through stud bays
  const chain = [0];
  const cols = n;
  for (let i = 1; i <= n; i++) {
    const x = single ? 0.62 : 0.1 + (i / (cols + 0.3)) * 0.85;
    const y = single ? 0.5 : i % 2 ? r.range(0.3, 0.42) : r.range(0.55, 0.7);
    const kind: Device['kind'] = single ? 'outlet' : i === n ? r.pick(['outlet', 'light'] as const) : r.chance(0.2) ? 'switch' : 'outlet';
    const name = single && site?.appliance ? `${upper(site.appliance)} outlet` : `${runRoom()} ${kind}`;
    devices.push({ id: i, kind, pos: { x, y }, live: true, name });
    chain.push(i);
  }
  const route = (a: P, b: P): P[] => {
    // real cable routing: along the top plate, then down the stud
    const midY = Math.min(a.y, b.y) - r.range(0.06, 0.12);
    return [a, { x: a.x, y: Math.max(0.16, midY) }, { x: b.x, y: Math.max(0.16, midY) }, b];
  };
  for (let i = 1; i < chain.length; i++) segs.push({ from: chain[i - 1], to: chain[i], pts: route(devices[chain[i - 1]].pos, devices[chain[i]].pos), circuit: 1 });
  // branch through a junction box (tier >= 3): a spur that stays live
  if (tier >= 3 && !single) {
    const at = chain[1];
    const jb: Device = { id: devices.length, kind: 'jbox', pos: { x: devices[at].pos.x + 0.04, y: 0.83 }, live: true, name: 'Junction box' };
    devices.push(jb);
    segs.push({ from: at, to: jb.id, pts: [devices[at].pos, { x: devices[at].pos.x, y: 0.83 }, jb.pos], circuit: 1 });
    const spur: Device = { id: devices.length, kind: 'outlet', pos: { x: jb.pos.x + 0.22, y: 0.86 }, live: true, name: `${r.pick(ROOMS_)} outlet` };
    devices.push(spur);
    segs.push({ from: jb.id, to: spur.id, pts: [jb.pos, spur.pos], circuit: 1 });
  }
  // a second circuit crossing the wall (tier >= 4): don't follow the wrong cable
  if (tier >= 4 && !single) {
    const a: Device = { id: devices.length, kind: 'light', pos: { x: 0.9, y: 0.9 }, live: true, name: job === 'hangar' ? 'Yard light (other circuit)' : 'Porch light (other circuit)' };
    devices.push(a);
    segs.push({ from: 0, to: a.id, pts: [{ x: 0.12, y: 0.12 }, { x: 0.12, y: 0.48 }, { x: 0.86, y: 0.48 }, a.pos], circuit: 2 });
  }
  if (warm) {
    // a live high-resistance joint (a loose backstab or terminal) at one device: everything works, that plate runs hot.
    // The complaint names the device (a switch plate, an outlet), so that device is the hot one
    const want = site?.device ?? 'outlet';
    const hotAt = single ? 1 : (() => {
      const k = chain.map((_, i) => i).filter((i) => i >= 1 && devices[chain[i]].kind === want);
      if (k.length) return r.pick(k);
      const i = r.int(1, chain.length - 1);
      devices[chain[i]].kind = want;
      devices[chain[i]].name = `${site?.room ?? r.pick(ROOMS_)} ${want}`;
      return i;
    })();
    // the current through a feed-through joint warms the plates upstream a little; the hot one is 130-160 °F
    const temps = devices.map((_, id) => {
      const i = chain.indexOf(id);
      if (i < 0) return Math.round(r.range(74, 79));
      if (i === hotAt) return Math.round(r.range(130, 160));
      return Math.round(i < hotAt ? r.range(80, 88) : r.range(74, 80));
    });
    const hot = devices[chain[hotAt]];
    const same = chain.filter((id, i) => i >= 1 && devices[id].kind === hot.kind).length;
    return {
      devices,
      segs,
      chain,
      faultAfter: hotAt,
      showStates: tier <= 2,
      symptom: single && site?.appliance ? `The ${site.appliance}'s plug runs warm` : `A ${hot.name.toLowerCase()} plate is warm`,
      optimalTests: Math.max(1, same),
      amps,
      warm: true,
      temps,
    };
  }
  // the fault: open somewhere after the first device (an individual circuit: between the breaker and its one receptacle)
  const faultAfter = single ? 0 : r.int(1, chain.length - 2);
  for (let k = faultAfter + 1; k < chain.length; k++) devices[chain[k]].live = false;
  const firstDead = devices[chain[faultAfter + 1]];
  const where = site?.room ?? ROOMS_.find((x) => firstDead.name.startsWith(x)) ?? firstDead.name.split(' ')[0];
  return {
    devices,
    segs,
    chain,
    faultAfter,
    showStates: tier <= 2,
    symptom: single ? `The ${site?.appliance ?? 'appliance'}'s outlet is dead` : `${where} is dead${chain.length - faultAfter - 2 > 0 ? ', and more past it' : ''}`,
    optimalTests: single ? 1 : Math.ceil(Math.log2(chain.length - 1)) + 1,
    amps,
  };
}

const upper = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** a megger reading as the meter shows it: "0.4", "1,240" (MΩ) */
export const megWords = (v: number) => (v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString('en-US'));

/**
 * The underground feeder: the panel, hand holes along the buried run and the cottages at the end. The failed
 * splice is buried in the section between two points (never in the first section, so the run has a good
 * reference, like the room's first live outlet). Good insulation reads lower the more cable the test takes in
 * (the sections are in parallel), always in the hundreds of MΩ or more; from the failed splice on, the reading
 * is the failed splice's (the whole-run reading the job started from).
 */
function generateFeeder(seed: number, tier: number, site?: PuzzleSite): TraceModel {
  const r = rng(hashSeed(seed, 'feeder'));
  const amps = site?.amps ?? 100;
  // the points past the panel: the hand holes, then the cottages
  const n = tier <= 1 ? 4 : tier === 2 ? 5 : tier <= 4 ? 6 : 7;
  const devices: Device[] = [{ id: 0, kind: 'jbox', pos: { x: 0.08, y: 0.1 }, live: true, name: `Feeder breaker ${amps} A` }];
  const chain = [0];
  for (let i = 1; i <= n; i++) {
    const x = 0.1 + (i / (n + 0.3)) * 0.85;
    const y = i % 2 ? r.range(0.26, 0.4) : r.range(0.56, 0.74);
    devices.push({ id: i, kind: i === n ? 'cottages' : 'handhole', pos: { x, y }, live: true, name: i === n ? 'East cottages' : `HH${i}` });
    chain.push(i);
  }
  // a buried run between hand holes is near enough straight: a dog-leg around a palm or a path
  const route = (a: P, b: P): P[] => [a, { x: (a.x + b.x) / 2 + r.range(-0.03, 0.03), y: (a.y + b.y) / 2 + r.range(-0.07, 0.07) }, b];
  const segs: Seg[] = [];
  for (let i = 1; i < chain.length; i++) segs.push({ from: chain[i - 1], to: chain[i], pts: route(devices[chain[i - 1]].pos, devices[chain[i]].pos), circuit: 1 });
  // a splice pedestal at the first hand hole taps off to the cottage nearest the panel (tier 3+): it stays good
  if (tier >= 3) {
    const at = chain[1];
    const ped: Device = { id: devices.length, kind: 'jbox', pos: { x: devices[at].pos.x + 0.04, y: 0.83 }, live: true, name: 'Splice pedestal' };
    devices.push(ped);
    segs.push({ from: at, to: ped.id, pts: [devices[at].pos, { x: devices[at].pos.x, y: 0.83 }, ped.pos], circuit: 1 });
    const tap: Device = { id: devices.length, kind: 'cottages', pos: { x: ped.pos.x + 0.22, y: 0.86 }, live: true, name: 'Cottage 2 tap' };
    devices.push(tap);
    segs.push({ from: ped.id, to: tap.id, pts: [ped.pos, tap.pos], circuit: 1 });
  }
  // another buried circuit from the same panel crossing the yard (tier 4+): don't follow (or dig) the wrong cable
  if (tier >= 4) {
    const a: Device = { id: devices.length, kind: 'light', pos: { x: 0.9, y: 0.9 }, live: true, name: 'Dock lights (other circuit)' };
    devices.push(a);
    segs.push({ from: 0, to: a.id, pts: [{ x: 0.12, y: 0.12 }, { x: 0.12, y: 0.48 }, { x: 0.86, y: 0.48 }, a.pos], circuit: 2 });
  }
  const faultAfter = r.int(1, chain.length - 2);
  for (let k = faultAfter + 1; k < chain.length; k++) devices[chain[k]].live = false;
  // the finding's reading (the whole run, from the panel)
  const fault = 0.4;
  const per = r.range(2600, 4200);
  const megohms = devices.map((d, id) => {
    if (id === 0) return fault;
    const k = chain.indexOf(id);
    if (k > faultAfter) return fault;
    // good: the cable back to the panel, in parallel (the tap and the other circuit: their own runs)
    const len = k >= 1 ? k : d.kind === 'light' ? 3 : 2;
    return Math.round(per / len / 10) * 10;
  });
  return {
    devices,
    segs,
    chain,
    faultAfter,
    showStates: tier <= 2,
    symptom: `Feeder to the east cottages: ${megWords(fault)} MΩ`,
    optimalTests: Math.ceil(Math.log2(chain.length - 1)) + 1,
    amps,
    feeder: { megohms, fault, whole: Math.round(per / n / 10) * 10 },
  };
}

/** Is a mark at `p` inside the fault region (segment between last live and first dead, incl. both devices; warm: the hot device)? */
export function isFaultMark(m: TraceModel, p: P, tol = 0.05) {
  if (m.feeder) {
    // the failed splice is buried in the section, not in a hand hole: a dig at a hand hole re-makes good splices
    if (m.devices.some((d, i) => i > 0 && Math.hypot(p.x - d.pos.x, p.y - d.pos.y) < tol * 1.3)) return false;
    return distToPoly(p, faultSeg(m).pts) < tol;
  }
  if (m.warm) {
    const d = m.devices[m.chain[m.faultAfter]];
    return Math.hypot(p.x - d.pos.x, p.y - d.pos.y) < tol * 1.3;
  }
  const a = m.chain[m.faultAfter];
  const b = m.chain[m.faultAfter + 1];
  const seg = m.segs.find((s) => s.from === a && s.to === b)!;
  if (Math.hypot(p.x - m.devices[a].pos.x, p.y - m.devices[a].pos.y) < tol * 1.3) return true;
  if (Math.hypot(p.x - m.devices[b].pos.x, p.y - m.devices[b].pos.y) < tol * 1.3) return true;
  return distToPoly(p, seg.pts) < tol;
}

/** the section the fault is in (the feeder: where the failed splice is buried) */
export const faultSeg = (m: TraceModel) => m.segs.find((s) => s.from === m.chain[m.faultAfter] && s.to === m.chain[m.faultAfter + 1])!;

export function distToPoly(p: P, pts: P[]) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}

export function scoreTrace(m: TraceModel, o: { wrongMarks: number; correct: boolean; tests: number; tracedFrac: number }) {
  if (!o.correct) return clamp(0.25 * o.tracedFrac - 0.05 * o.wrongMarks, 0, 0.3);
  const extraTests = m.showStates ? 0 : Math.max(0, o.tests - m.optimalTests);
  return clamp(1 - 0.3 * o.wrongMarks - 0.05 * extraTests, 0, 1);
}

/** the splice kits the job flow picked, as the close-out names them (display only): "DBS-2 × 4" */
export function pickedSplice(pick: PuzzleContext['pick']): string | null {
  const l = pick?.find((x) => x.slot === 'splice' || x.spec?.device === 'splice');
  return l ? `${l.pn} × ${l.qty}` : null;
}

export const trace: PuzzleDef = {
  id: 'trace',
  role: 'elec',
  title: 'Circuit trace',
  titleFor: (c) => (isFeeder(c) ? 'Underground feeder' : undefined),
  gesture: 'Drag a path',
  howTo: 'Trace the cable, test outlets, mark where the circuit opens.',
  howToFor: (c) => (isFeeder(c) ? 'Follow the buried run, megger each hand hole, dig the bad section.' : undefined),
  term: 'Open circuit: a break in the path. Everything past it goes dead.',
  termFor: (c) => (isFeeder(c) ? 'Insulation resistance: what a megger reads to earth. Water in a splice drops it.' : undefined),
  // the feeder has its close-out after the dig
  seconds: (tier, c) => 70 + tier * 10 + (isFeeder(c) ? 10 : 0),
  mount(host, p) {
    const m = generateTrace(p.seed, p.tier, p.tools, p.context?.job, p.context?.site);
    const F = m.feeder;
    const tone = p.tools.includes('toneTracer');
    const fish = p.tools.includes('fishTape');
    const st = stage(host.el);
    const { ctx } = st;
    const revealed = new Set<number>(); // segment indexes traced
    const segProgress = m.segs.map(() => 0); // 0..1 along each segment
    const tested = new Set<number>();
    const wrongSpots: P[] = [];
    let mode: 'trace' | 'mark' = 'trace';
    let tracing: P | null = null;
    let wrongMarks = 0;
    let finished = false;
    let correctSpot: P | null = null;
    let lastTick = 0;
    let tests = 0;
    // the feeder: where it was dug, and the close-out before it's re-energized
    let dug: P | null = null;
    let closing = false;
    /** a finger down on a testable device: a test if it comes up there, a trace if it drags */
    let press: { d: number; x: number; y: number } | null = null;

    const area = () => {
      const w = st.w;
      const h = st.h;
      return { w, h, x: 10, y: 54, pw: w - 20, ph: h - 54 - 96 };
    };
    const S = (p: P) => {
      const a = area();
      return { x: a.x + p.x * a.pw, y: a.y + p.y * a.ph };
    };
    const N = (x: number, y: number): P => {
      const a = area();
      return { x: (x - a.x) / a.pw, y: (y - a.y) / a.ph };
    };
    const tolN = () => 20 / Math.min(area().pw, area().ph);
    const status = () => {
      if (F)
        return host.status(
          closing
            ? `${m.symptom} · close it up, then re-energize`
            : `${m.symptom} · ${mode === 'trace' ? 'trace + megger' : p.blind ? 'tap where to dig (one dig: you re-splice there)' : 'tap where to dig'}${m.showStates ? '' : ` · ${tests} tests`}`,
        );
      host.status(`${m.symptom} · ${mode === 'trace' ? 'trace + test' : p.blind ? 'tap the fault (one mark: you open the wall there)' : 'tap the fault'}${m.showStates ? '' : ` · ${tests} tests`}`);
    };
    status();

    const segLen = (s: Seg) => s.pts.reduce((n, q, i) => (i ? n + Math.hypot(q.x - s.pts[i - 1].x, q.y - s.pts[i - 1].y) : 0), 0);
    const pointAt = (s: Seg, f: number): P => {
      let d = f * segLen(s);
      for (let i = 1; i < s.pts.length; i++) {
        const a = s.pts[i - 1];
        const b = s.pts[i];
        const l = Math.hypot(b.x - a.x, b.y - a.y);
        if (d <= l) return { x: a.x + ((b.x - a.x) * d) / l, y: a.y + ((b.y - a.y) * d) / l };
        d -= l;
      }
      return s.pts[s.pts.length - 1];
    };
    const projectF = (s: Seg, p: P) => {
      // fraction along the segment of the closest point
      let best = { d: Infinity, f: 0 };
      let acc = 0;
      const total = segLen(s);
      for (let i = 1; i < s.pts.length; i++) {
        const a = s.pts[i - 1];
        const b = s.pts[i];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const l = Math.hypot(dx, dy);
        const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (l * l || 1), 0, 1);
        const d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
        if (d < best.d) best = { d, f: (acc + t * l) / total };
        acc += l;
      }
      return best;
    };
    const reachable = (i: number) => {
      const s = m.segs[i];
      // you can only trace a cable from a device you've already reached (or the panel)
      return s.from === 0 || m.segs.some((t, j) => revealed.has(j) && t.to === s.from);
    };

    const traceAt = (p: P) => {
      let moved = false;
      m.segs.forEach((s, i) => {
        if (!reachable(i)) return;
        const pr = projectF(s, p);
        if (pr.d < tolN() * 1.2 && pr.f > segProgress[i] - 0.02 && pr.f <= segProgress[i] + 0.25) {
          segProgress[i] = Math.max(segProgress[i], pr.f);
          if (segProgress[i] > 0.97) {
            segProgress[i] = 1;
            if (!revealed.has(i)) {
              revealed.add(i);
              host.fx.snap();
            }
          }
          moved = true;
        }
      });
      if (moved) {
        const now = performance.now();
        // tone tracer: a steady tone while you're on the cable (it follows wire, it doesn't find faults)
        const gap = tone ? 45 : 110;
        if (now - lastTick > gap) {
          host.fx.tick();
          lastTick = now;
        }
      }
    };

    const deviceAt = (p: P) => m.devices.findIndex((d, i) => i > 0 && Math.hypot(d.pos.x - p.x, d.pos.y - p.y) < tolN() * 1.4);

    const offPtr = pointer(st.canvas, {
      down(pt) {
        if (finished || host.paused()) return;
        const a = area();
        if (pt.y > a.h - 84) {
          // the feeder's close-out: one button, re-energize
          if (closing) {
            host.fx.tap();
            finish();
            return;
          }
          // mode toggle buttons
          const left = pt.x < a.w / 2;
          mode = left ? 'trace' : 'mark';
          host.fx.tap();
          status();
          return;
        }
        if (closing) return;
        const n = N(pt.x, pt.y);
        if (mode === 'mark') return mark(n);
        // a plug-in tester works on any outlet you can see; tracing tells you the order. A megger works at any
        // hand hole, the pedestal or the far end: open it there and test back to the panel. A tap on one tests
        // it (when the finger comes up); a drag that starts on one follows the cable out of it
        const d = deviceAt(n);
        press = d > 0 && (F || m.devices[d].kind !== 'jbox') && !m.showStates && !tested.has(d) ? { d, x: pt.x, y: pt.y } : null;
        tracing = n;
        traceAt(n);
      },
      move(pt) {
        if (press && Math.hypot(pt.x - press.x, pt.y - press.y) > 10) press = null;
        if (!tracing || finished) return;
        const n = N(pt.x, pt.y);
        tracing = n;
        traceAt(n);
      },
      up() {
        tracing = null;
        const d = press?.d;
        press = null;
        if (d === undefined || finished || closing || tested.has(d)) return;
        tested.add(d);
        tests++;
        (m.warm ? (m.temps?.[d] ?? 0) < 110 : m.devices[d].live) ? host.fx.snap() : host.fx.fault();
        status();
      },
    });

    function mark(n: P) {
      if (isFaultMark(m, n, tolN())) {
        correctSpot = n;
      } else if (p.blind) {
        // blind: where you open the wall (or dig) is where you fix it (no X, no second guess)
        wrongMarks++;
      } else {
        wrongMarks++;
        wrongSpots.push(n);
        host.fx.bad();
        return;
      }
      if (!F) return finish();
      // the feeder: dug; close it up before it goes back on
      dug = n;
      closing = true;
      host.fx.tap();
      status();
    }

    const stop = loop(() => (F ? drawYard(F) : draw()));

    function draw() {
      const a = area();
      backdrop(ctx, a.w, a.h);
      label(ctx, m.symptom, 14, 20, { size: 14, weight: 800, align: 'left' });
      label(ctx, `${p.context?.job === 'hangar' ? 'Hangar wall cutaway' : 'Drywall cutaway'} · ${m.amps} A circuit${m.warm ? ' · IR thermometer' : ''}`, 14, 38, { size: 11, color: C.inkSoft, align: 'left' });
      // wall
      roundRect(ctx, a.x, a.y, a.pw, a.ph, 12);
      ctx.fillStyle = '#efe6d6';
      ctx.fill();
      ctx.fillStyle = 'rgba(160,120,70,.25)';
      for (let x = a.x + 30; x < a.x + a.pw; x += 44) ctx.fillRect(x, a.y + 6, 10, a.ph - 12);
      ctx.fillStyle = 'rgba(160,120,70,.35)';
      ctx.fillRect(a.x, a.y + 6, a.pw, 8);
      // cables (only what you've traced shows)
      m.segs.forEach((s, i) => {
        const prog = finished ? 1 : segProgress[i];
        if (prog <= 0) return;
        const color = s.circuit === 2 ? C.fin : '#d9d3c7';
        ctx.strokeStyle = color;
        ctx.lineWidth = 6;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        cablePath(s, prog);
        ctx.stroke();
        ctx.strokeStyle = s.circuit === 2 ? '#5f7f99' : '#8f8778';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });
      locatorPreview();
      // devices
      m.devices.forEach((d, i) => {
        const s = S(d.pos);
        if (i === 0) {
          roundRect(ctx, s.x - 22, s.y - 16, 44, 32, 6);
          ctx.fillStyle = '#7f8b90';
          ctx.fill();
          ctx.fillStyle = C.ink;
          ctx.fillRect(s.x - 8, s.y - 6, 16, 12);
          label(ctx, `${m.amps} A`, s.x, s.y + 26, { size: 10, weight: 800 });
          return;
        }
        // blind: no end-of-job reveal (the states past your mark would say whether it was right)
        const known = m.showStates || tested.has(i) || (finished && !p.blind);
        roundRect(ctx, s.x - 14, s.y - 18, 28, 36, 5);
        ctx.fillStyle = d.kind === 'jbox' ? '#9aa5a9' : C.white;
        ctx.fill();
        ctx.strokeStyle = C.ink;
        ctx.lineWidth = 1;
        ctx.stroke();
        if (d.kind === 'outlet') {
          ctx.fillStyle = C.ink;
          ctx.fillRect(s.x - 4, s.y - 10, 2, 5);
          ctx.fillRect(s.x + 2, s.y - 10, 2, 5);
          ctx.fillRect(s.x - 4, s.y + 4, 2, 5);
          ctx.fillRect(s.x + 2, s.y + 4, 2, 5);
        } else if (d.kind === 'switch') {
          ctx.fillStyle = C.ink;
          ctx.fillRect(s.x - 3, s.y - 7, 6, 14);
        } else if (d.kind === 'light') {
          ctx.fillStyle = known && d.live ? C.elec : '#cfd8d8';
          ctx.beginPath();
          ctx.arc(s.x, s.y, 8, 0, Math.PI * 2);
          ctx.fill();
        } else if (fish) {
          label(ctx, '→', s.x, s.y, { size: 12, weight: 900 });
        }
        if (known && d.kind !== 'jbox' && m.warm) {
          // the IR reading at the plate: a hot termination is well above the rest
          const t = m.temps?.[i] ?? 78;
          const hot = t >= 110;
          ctx.fillStyle = hot ? C.rust : C.palm;
          ctx.beginPath();
          ctx.arc(s.x + 13, s.y - 16, 6, 0, Math.PI * 2);
          ctx.fill();
          label(ctx, `${t}°F`, s.x, s.y + 28, { size: 10, weight: 900, color: hot ? C.rust : C.inkSoft });
        } else if (known && d.kind !== 'jbox') {
          ctx.fillStyle = d.live ? C.palm : C.inkSoft;
          ctx.beginPath();
          ctx.arc(s.x + 13, s.y - 16, 6, 0, Math.PI * 2);
          ctx.fill();
          label(ctx, d.live ? '120' : '0', s.x, s.y + 28, { size: 10, weight: 900, color: d.live ? C.palm : C.inkSoft });
        } else if (d.kind !== 'jbox' && mode === 'trace') {
          label(ctx, m.warm ? 'IR' : 'test', s.x, s.y + 28, { size: 10, weight: 800, color: C.sea });
        }
      });
      wrongX();
      if (finished && !p.blind) {
        const aDev = m.devices[m.chain[m.faultAfter]];
        const q = S(aDev.pos);
        ctx.strokeStyle = correctSpot ? C.palm : C.rust;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(q.x, q.y, 24, 0, Math.PI * 2);
        ctx.stroke();
        label(ctx, m.warm ? 'loose termination (hot)' : 'loose backstab', q.x, q.y - 32, { size: 11, weight: 800, color: correctSpot ? C.palm : C.rust });
      }
      fingertip();
      modeButtons('Trace + test', 'Mark the fault');
      if (m.showStates && !finished)
        label(ctx, m.warm ? 'Everything works: the loose joint is the hot plate. Mark it.' : 'Green = live. The open is after the last live device.', a.w / 2, a.y + a.ph + 12, { size: 11, color: C.inkSoft, weight: 700 });
    }

    /** a traced cable's path, as far as it has been followed */
    function cablePath(s: Seg, prog: number) {
      ctx.beginPath();
      const steps = 30;
      for (let k = 0; k <= steps * prog; k++) {
        const q = S(pointAt(s, k / steps));
        k ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
      }
    }
    /** the wire end you're following: a short faint preview, like a toner in your ear */
    function locatorPreview() {
      if (finished) return;
      m.segs.forEach((s, i) => {
        if (segProgress[i] >= 1 || !reachable(i)) return;
        ctx.strokeStyle = 'rgba(46,124,147,.35)';
        ctx.setLineDash([3, 5]);
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let k = 0; k <= 8; k++) {
          const q = S(pointAt(s, Math.min(1, segProgress[i] + (k / 8) * 0.16)));
          k ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      });
    }
    function wrongX() {
      wrongSpots.forEach((w) => {
        const s = S(w);
        ctx.strokeStyle = C.inkSoft;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(s.x - 7, s.y - 7);
        ctx.lineTo(s.x + 7, s.y + 7);
        ctx.moveTo(s.x + 7, s.y - 7);
        ctx.lineTo(s.x - 7, s.y + 7);
        ctx.stroke();
      });
    }
    function fingertip() {
      if (!tracing) return;
      const s = S(tracing);
      ctx.fillStyle = 'rgba(46,124,147,.25)';
      ctx.beginPath();
      ctx.arc(s.x, s.y, 16, 0, Math.PI * 2);
      ctx.fill();
    }
    /** a label on a paper pill, readable over the yard and the cable line */
    function tag(t: string, x: number, y: number, o: { size: number; weight: number; color: string; align?: CanvasTextAlign }) {
      ctx.font = `${o.weight} ${o.size}px ${FONT}`;
      const w = ctx.measureText(t).width;
      const x0 = o.align === 'left' ? x : o.align === 'right' ? x - w : x - w / 2;
      roundRect(ctx, x0 - 4, y - o.size / 2 - 3, w + 8, o.size + 6, (o.size + 6) / 2);
      ctx.fillStyle = 'rgba(251,245,233,.9)';
      ctx.fill();
      label(ctx, t, x, y, o);
    }
    /** mode buttons (thumb zone) */
    function modeButtons(traceWord: string, markWord: string) {
      const a = area();
      const by = a.h - 74;
      const bw = (a.w - 36) / 2;
      [
        ['trace', traceWord],
        ['mark', markWord],
      ].forEach(([k, t], i) => {
        roundRect(ctx, 12 + i * (bw + 12), by, bw, 52, 26);
        ctx.fillStyle = mode === k ? (k === 'mark' ? C.ink : C.sea) : C.sandDeep;
        ctx.fill();
        label(ctx, t, 12 + i * (bw + 12) + bw / 2, by + 26, { size: 15, weight: 800, color: mode === k ? C.white : C.ink });
      });
    }

    // ---- the underground feeder: a site plan of the yard

    // the yard's own furniture, seeded (the same every frame): palm crowns clear of the run, grass tufts
    const yard = (() => {
      if (!F) return { palms: [] as P[], tufts: [] as P[] };
      const r = rng(hashSeed(p.seed, 'yard'));
      const palms: P[] = [];
      for (let k = 0; k < 60 && palms.length < 4; k++) {
        const q = { x: r.range(0.06, 0.94), y: r.range(0.14, 0.95) };
        if (m.devices.every((d) => Math.hypot(d.pos.x - q.x, d.pos.y - q.y) > 0.15) && m.segs.every((s) => distToPoly(q, s.pts) > 0.09) && palms.every((o) => Math.hypot(o.x - q.x, o.y - q.y) > 0.2)) palms.push(q);
      }
      const tufts = Array.from({ length: 28 }, () => ({ x: r.range(0.04, 0.96), y: r.range(0.04, 0.97) }));
      return { palms, tufts };
    })();
    const devWord = (id: number) => {
      const d = m.devices[id];
      return id === 0 ? 'the panel' : d.kind === 'handhole' ? d.name : d.kind === 'jbox' ? 'the pedestal' : d.name.startsWith('Cottage 2') ? 'Cottage 2' : 'the cottages';
    };
    /** where the dig went, as you'd write it on the work order (what you chose, never whether it was right) */
    const digWhere = (q: P) => {
      let best = { d: Infinity, s: m.segs[0] };
      for (const s of m.segs) {
        const d = distToPoly(q, s.pts);
        if (d < best.d) best = { d, s };
      }
      const at = m.devices.findIndex((d, i) => i > 0 && Math.hypot(q.x - d.pos.x, q.y - d.pos.y) < tolN() * 1.3);
      if (at > 0) return `at ${devWord(at)}`;
      if (best.d > tolN() * 2) return 'off the run';
      if (best.s.circuit === 2) return 'on the dock-light circuit';
      return `between ${devWord(best.s.from)} and ${devWord(best.s.to)}`;
    };

    function drawYard(f: NonNullable<TraceModel['feeder']>) {
      const a = area();
      backdrop(ctx, a.w, a.h);
      fitLabel(ctx, m.symptom, 14, 20, a.w - 28, { size: 14, weight: 800, align: 'left' });
      fitLabel(ctx, `Site plan · ${m.amps} A feeder, direct-buried · locked out · 1000 V megger`, 14, 38, a.w - 28, { size: 11, color: C.inkSoft, align: 'left' });
      // the yard, seen from above
      roundRect(ctx, a.x, a.y, a.pw, a.ph, 12);
      ctx.fillStyle = '#dfe6c2';
      ctx.fill();
      ctx.strokeStyle = 'rgba(78,138,90,.28)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (const t of yard.tufts) {
        const q = S(t);
        for (const dx of [-3, 0, 3]) {
          ctx.moveTo(q.x, q.y + 2);
          ctx.lineTo(q.x + dx, q.y - (dx ? 2 : 4));
        }
      }
      ctx.stroke();
      for (const q0 of yard.palms) {
        const q = S(q0);
        ctx.fillStyle = 'rgba(58,107,69,.22)';
        ctx.beginPath();
        ctx.arc(q.x, q.y, 20, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(58,107,69,.42)';
        ctx.beginPath();
        ctx.arc(q.x, q.y, 7, 0, Math.PI * 2);
        ctx.fill();
      }
      // the buried runs the locator has followed: the trench line, the cable in it
      m.segs.forEach((s, i) => {
        const prog = finished ? 1 : segProgress[i];
        if (prog <= 0) return;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        cablePath(s, prog);
        ctx.strokeStyle = s.circuit === 2 ? 'rgba(143,184,222,.45)' : 'rgba(150,118,76,.28)';
        ctx.lineWidth = 11;
        ctx.stroke();
        ctx.setLineDash([9, 6]);
        ctx.strokeStyle = s.circuit === 2 ? C.seaDeep : '#6f5438';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.setLineDash([]);
      });
      locatorPreview();
      // the dig (where you re-splice)
      if (dug) {
        const q = S(dug);
        ctx.fillStyle = '#8b6b47';
        ctx.beginPath();
        ctx.ellipse(q.x, q.y, 17, 11, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#5e4730';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      m.devices.forEach((d, i) => {
        const s = S(d.pos);
        if (i === 0) {
          // the distribution panel on its pad: the feeder breaker off, locked and tagged
          roundRect(ctx, s.x - 26, s.y - 20, 52, 40, 4);
          ctx.fillStyle = '#cbc7bc';
          ctx.fill();
          roundRect(ctx, s.x - 18, s.y - 14, 36, 28, 4);
          ctx.fillStyle = '#7f8b90';
          ctx.fill();
          ctx.fillStyle = C.ink;
          ctx.fillRect(s.x - 9, s.y - 5, 10, 10);
          roundRect(ctx, s.x + 6, s.y + 2, 11, 14, 2);
          ctx.fillStyle = C.elec;
          ctx.fill();
          ctx.strokeStyle = C.ink;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(s.x + 11.5, s.y + 2, 3, Math.PI, 0);
          ctx.stroke();
          tag(`${m.amps} A off · ${megWords(f.megohms[0])} MΩ`, s.x - 22, s.y + 30, { size: 10, weight: 800, color: C.ink, align: 'left' });
          return;
        }
        const known = m.showStates || tested.has(i) || (finished && !p.blind);
        if (d.kind === 'handhole') {
          // a concrete hand hole lid at grade
          roundRect(ctx, s.x - 13, s.y - 13, 26, 26, 3);
          ctx.fillStyle = '#b9bfbf';
          ctx.fill();
          ctx.strokeStyle = '#6d7778';
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.fillStyle = '#6d7778';
          ctx.fillRect(s.x - 6, s.y - 1, 12, 2);
          tag(d.name, s.x, s.y - 22, { size: 10, weight: 800, color: C.inkSoft });
        } else if (d.kind === 'jbox') {
          roundRect(ctx, s.x - 9, s.y - 14, 18, 28, 4);
          ctx.fillStyle = '#8fa39a';
          ctx.fill();
          ctx.strokeStyle = C.ink;
          ctx.lineWidth = 1;
          ctx.stroke();
          if (fish) label(ctx, '→', s.x, s.y, { size: 12, weight: 900, color: C.white });
          tag('Pedestal', s.x, s.y - 23, { size: 10, weight: 800, color: C.inkSoft });
        } else if (d.kind === 'cottages') {
          // the cottage (its disconnect on the wall, open)
          ctx.fillStyle = C.white;
          ctx.fillRect(s.x - 13, s.y - 8, 26, 20);
          ctx.strokeStyle = C.ink;
          ctx.lineWidth = 1;
          ctx.strokeRect(s.x - 13, s.y - 8, 26, 20);
          ctx.fillStyle = C.sandDeep;
          ctx.beginPath();
          ctx.moveTo(s.x - 17, s.y - 7);
          ctx.lineTo(s.x, s.y - 20);
          ctx.lineTo(s.x + 17, s.y - 7);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#7f8b90';
          ctx.fillRect(s.x - 10, s.y - 3, 7, 9);
          tag(d.name.startsWith('Cottage 2') ? 'Cottage 2' : 'Cottages', s.x, s.y - 29, { size: 10, weight: 800, color: C.inkSoft });
        } else {
          // the other circuit's dock light
          ctx.fillStyle = '#cfd8d8';
          ctx.beginPath();
          ctx.arc(s.x, s.y, 8, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = C.ink;
          ctx.lineWidth = 1;
          ctx.stroke();
          tag('Dock lights', s.x - 6, s.y - 16, { size: 10, weight: 800, color: C.inkSoft, align: 'right' });
        }
        if (known) {
          // the megger's reading, back to the panel: coloured only while the game teaches
          const v = f.megohms[i];
          const tint = m.showStates ? (d.live ? C.palm : C.rust) : C.ink;
          if (m.showStates) {
            ctx.fillStyle = tint;
            ctx.beginPath();
            ctx.arc(s.x + 13, s.y - 13, 5, 0, Math.PI * 2);
            ctx.fill();
          }
          tag(`${megWords(v)} MΩ`, s.x, s.y + 25, { size: 10, weight: 900, color: tint });
        } else if (mode === 'trace' && !closing) {
          tag('megger', s.x, s.y + 25, { size: 10, weight: 800, color: C.sea });
        }
      });
      wrongX();
      if (finished && !p.blind) {
        // the failed splice, in the ground between two hand holes
        const seg = faultSeg(m);
        const q = S(pointAt(seg, 0.5));
        ctx.strokeStyle = correctSpot ? C.palm : C.rust;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(q.x, q.y, 22, 0, Math.PI * 2);
        ctx.stroke();
        tag('split bolts + tape, cracked', q.x, q.y - 32, { size: 11, weight: 800, color: correctSpot ? C.palm : C.rust });
      }
      fingertip();
      if (closing) closeOut(f);
      else modeButtons('Trace + megger', 'Dig here');
      if (m.showStates && !finished && !closing) fitLabel(ctx, 'Green = good. Dig between the last good and the first bad.', a.w / 2, a.y + a.ph + 12, a.w - 24, { size: 11, color: C.inkSoft, weight: 700 });
    }

    /** after the dig: cut it out, re-splice with what the job picked, megger it again, backfill; then re-energize */
    function closeOut(f: NonNullable<TraceModel['feeder']>) {
      const a = area();
      const kit = pickedSplice(p.context?.pick) ?? 'a direct-burial kit on each conductor';
      const where = dug ? digWhere(dug) : 'down to the cable';
      const lines = [
        // blind: what you dug and did, never whether it was the failed splice
        p.blind ? `Dug ${where}, down to the cable at 24 in` : `Dug ${where}: split bolts and tape, cracked`,
        `Cut out the bad length; re-spliced: ${kit}`,
        p.blind ? 'Megger L1, L2 and N again before re-energizing (110.7)' : `Megger again from the panel: L1, L2, N ${megWords(f.whole)} MΩ to ground`,
        'Backfill: 24 in of cover, a warning ribbon 12 in above (300.5)',
      ];
      const cardH = 30 + lines.length * 19;
      const y0 = a.h - 84 - cardH - 6;
      roundRect(ctx, 12, y0, a.w - 24, cardH, 12);
      ctx.fillStyle = 'rgba(251,245,233,.97)';
      ctx.fill();
      ctx.strokeStyle = C.sandDeep;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      label(ctx, 'Close it up', 24, y0 + 16, { size: 13, weight: 800, align: 'left' });
      lines.forEach((t, k) => {
        label(ctx, `${k + 1}`, 24, y0 + 36 + k * 19, { size: 11, weight: 900, color: C.sea, align: 'left' });
        fitLabel(ctx, t, 38, y0 + 36 + k * 19, a.w - 24 - 38, { size: 11.5, weight: 700, color: C.ink, align: 'left' });
      });
      const by = a.h - 74;
      roundRect(ctx, 12, by, a.w - 24, 52, 26);
      ctx.fillStyle = C.sea;
      ctx.fill();
      label(ctx, 'Re-energize the feeder', a.w / 2, by + 26, { size: 15, weight: 800, color: C.white });
    }

    function makeResult(): PuzzleResult {
      const tracedFrac = m.segs.filter((_, i) => revealed.has(i)).length / m.segs.length;
      const sc = scoreTrace(m, { wrongMarks, correct: !!correctSpot, tests, tracedFrac });
      const what = F ? 'failed splice' : m.warm ? 'hot joint' : 'fault';
      const parts = [correctSpot ? (wrongMarks ? `${what} found after ${wrongMarks} wrong call${wrongMarks > 1 ? 's' : ''}` : `${what} found first try`) : `${what} not found`];
      if (!m.showStates) parts.push(`${tests} ${F ? 'megger tests' : 'tests'} (best ${m.optimalTests})`);
      // the feeder's own hidden defect (DEFECT_RULES 'trace:feeder'), not the room's loose backstab
      return result(sc, parts.join(', '), F ? { defect: 'feeder' } : undefined);
    }
    function finish() {
      if (finished) return;
      finished = true;
      closing = false;
      const res = makeResult();
      res.perfect && !p.blind ? host.fx.flourish() : host.fx.good();
      // blind: the same hand-in time whatever the result (a perfect run's longer flourish would tell)
      settle(host, res, p.blind ? 700 : res.perfect ? 1000 : 600);
    }

    return {
      timeUp() {
        finished = true;
        closing = false;
        return makeResult();
      },
      destroy() {
        stop();
        offPtr();
        st.destroy();
      },
    };
  },
};
