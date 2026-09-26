// Electrician · Circuit trace. Some outlets in a cottage are dead. Trace the
// cable through the wall from the breaker, test devices, and mark where the
// fault is. Real troubleshooting logic: on a daisy chain the open is between
// the LAST LIVE device and the FIRST DEAD one (very often a loose backstab at
// the last live outlet). Tiers 0–2 show which devices are live; from tier 3
// you test them yourself (fewest tests wins: half-split the run).
import { rng } from '../sim/rng';
import { C, backdrop, clamp, label, loop, pointer, roundRect, stage } from './kit';
import { result, type PuzzleDef, type PuzzleResult } from './types';

type P = { x: number; y: number }; // normalised
export type Device = { id: number; kind: 'outlet' | 'switch' | 'light' | 'jbox'; pos: P; live: boolean; name: string };
export type Seg = { from: number; to: number; pts: P[]; circuit: 1 | 2 };
export type TraceModel = {
  devices: Device[]; // index 0 = panel breaker
  segs: Seg[];
  chain: number[]; // devices on the faulty run, in order from the panel
  faultAfter: number; // index into chain: fault lies between chain[faultAfter] and chain[faultAfter+1]
  showStates: boolean;
  symptom: string;
  optimalTests: number;
};

const ROOMS = ['Kitchen', 'Bath', 'Bedroom', 'Porch', 'Living room', 'Deck'];

export function generateTrace(seed: number, tier: number, _tools: string[] = []): TraceModel {
  const r = rng(seed);
  const n = tier <= 0 ? 3 : tier <= 2 ? 3 + tier : tier === 3 ? 6 : tier === 4 ? 7 : 8;
  const devices: Device[] = [{ id: 0, kind: 'outlet', pos: { x: 0.08, y: 0.1 }, live: true, name: 'Breaker 12' }];
  const segs: Seg[] = [];
  // main run: snake across the wall at two heights, through stud bays
  const chain = [0];
  const cols = n;
  for (let i = 1; i <= n; i++) {
    const x = 0.1 + (i / (cols + 0.3)) * 0.85;
    const y = i % 2 ? r.range(0.3, 0.42) : r.range(0.55, 0.7);
    const kind: Device['kind'] = i === n ? r.pick(['outlet', 'light'] as const) : r.chance(0.2) ? 'switch' : 'outlet';
    devices.push({ id: i, kind, pos: { x, y }, live: true, name: `${r.pick(ROOMS)} ${kind}` });
    chain.push(i);
  }
  const route = (a: P, b: P): P[] => {
    // real cable routing: along the top plate, then down the stud
    const midY = Math.min(a.y, b.y) - r.range(0.06, 0.12);
    return [a, { x: a.x, y: Math.max(0.16, midY) }, { x: b.x, y: Math.max(0.16, midY) }, b];
  };
  for (let i = 1; i < chain.length; i++) segs.push({ from: chain[i - 1], to: chain[i], pts: route(devices[chain[i - 1]].pos, devices[chain[i]].pos), circuit: 1 });
  // branch through a junction box (tier >= 3): a spur that stays live
  if (tier >= 3) {
    const at = chain[1];
    const jb: Device = { id: devices.length, kind: 'jbox', pos: { x: devices[at].pos.x + 0.04, y: 0.83 }, live: true, name: 'Junction box' };
    devices.push(jb);
    segs.push({ from: at, to: jb.id, pts: [devices[at].pos, { x: devices[at].pos.x, y: 0.83 }, jb.pos], circuit: 1 });
    const spur: Device = { id: devices.length, kind: 'outlet', pos: { x: jb.pos.x + 0.22, y: 0.86 }, live: true, name: `${r.pick(ROOMS)} outlet` };
    devices.push(spur);
    segs.push({ from: jb.id, to: spur.id, pts: [jb.pos, spur.pos], circuit: 1 });
  }
  // a second circuit crossing the wall (tier >= 4): don't follow the wrong cable
  if (tier >= 4) {
    const a: Device = { id: devices.length, kind: 'light', pos: { x: 0.9, y: 0.9 }, live: true, name: 'Porch light (other circuit)' };
    devices.push(a);
    segs.push({ from: 0, to: a.id, pts: [{ x: 0.12, y: 0.12 }, { x: 0.12, y: 0.48 }, { x: 0.86, y: 0.48 }, a.pos], circuit: 2 });
  }
  // the fault: open somewhere after the first device
  const faultAfter = r.int(1, chain.length - 2);
  for (let k = faultAfter + 1; k < chain.length; k++) devices[chain[k]].live = false;
  const firstDead = devices[chain[faultAfter + 1]];
  return {
    devices,
    segs,
    chain,
    faultAfter,
    showStates: tier <= 2,
    symptom: `${firstDead.name.split(' ')[0]} is dead${chain.length - faultAfter - 2 > 0 ? ', and more past it' : ''}`,
    optimalTests: Math.ceil(Math.log2(chain.length - 1)) + 1,
  };
}

/** Is a mark at `p` inside the fault region (segment between last live and first dead, incl. both devices)? */
export function isFaultMark(m: TraceModel, p: P, tol = 0.05) {
  const a = m.chain[m.faultAfter];
  const b = m.chain[m.faultAfter + 1];
  const seg = m.segs.find((s) => s.from === a && s.to === b)!;
  if (Math.hypot(p.x - m.devices[a].pos.x, p.y - m.devices[a].pos.y) < tol * 1.3) return true;
  if (Math.hypot(p.x - m.devices[b].pos.x, p.y - m.devices[b].pos.y) < tol * 1.3) return true;
  return distToPoly(p, seg.pts) < tol;
}

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

export const trace: PuzzleDef = {
  id: 'trace',
  role: 'elec',
  title: 'Circuit trace',
  gesture: 'Drag a path',
  howTo: 'Trace the cable, test outlets, mark where the circuit opens.',
  term: 'Open circuit: a break in the path. Everything past it goes dead.',
  seconds: (tier) => 70 + tier * 10,
  mount(host, p) {
    const m = generateTrace(p.seed, p.tier, p.tools);
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
    const status = () =>
      host.status(`${m.symptom} · ${mode === 'trace' ? 'trace + test' : 'tap the fault'}${m.showStates ? '' : ` · ${tests} tests`}`);
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
          // mode toggle buttons
          const left = pt.x < a.w / 2;
          mode = left ? 'trace' : 'mark';
          host.fx.tap();
          status();
          return;
        }
        const n = N(pt.x, pt.y);
        if (mode === 'mark') return mark(n);
        const d = deviceAt(n);
        // a plug-in tester works on any outlet you can see; tracing tells you the order
        if (d > 0 && m.devices[d].kind !== 'jbox' && !m.showStates && !tested.has(d)) {
          tested.add(d);
          tests++;
          m.devices[d].live ? host.fx.snap() : host.fx.fault();
          status();
          return;
        }
        tracing = n;
        traceAt(n);
      },
      move(pt) {
        if (!tracing || finished) return;
        const n = N(pt.x, pt.y);
        tracing = n;
        traceAt(n);
      },
      up() {
        tracing = null;
      },
    });

    function mark(n: P) {
      if (isFaultMark(m, n, tolN())) {
        correctSpot = n;
        finish();
      } else {
        wrongMarks++;
        wrongSpots.push(n);
        host.fx.bad();
      }
    }

    const stop = loop(() => draw());

    function draw() {
      const a = area();
      backdrop(ctx, a.w, a.h);
      label(ctx, m.symptom, 14, 20, { size: 14, weight: 800, align: 'left' });
      label(ctx, 'Drywall cutaway · studs every 16 in', 14, 38, { size: 11, color: C.inkSoft, align: 'left' });
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
        ctx.beginPath();
        const steps = 30;
        for (let k = 0; k <= steps * prog; k++) {
          const q = S(pointAt(s, k / steps));
          k ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
        }
        ctx.stroke();
        ctx.strokeStyle = s.circuit === 2 ? '#5f7f99' : '#8f8778';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });
      // the wire end you're following: a short faint preview, like a toner in your ear
      if (!finished)
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
      // devices
      m.devices.forEach((d, i) => {
        const s = S(d.pos);
        if (i === 0) {
          roundRect(ctx, s.x - 22, s.y - 16, 44, 32, 6);
          ctx.fillStyle = '#7f8b90';
          ctx.fill();
          ctx.fillStyle = C.ink;
          ctx.fillRect(s.x - 8, s.y - 6, 16, 12);
          label(ctx, 'CB 12', s.x, s.y + 26, { size: 10, weight: 800 });
          return;
        }
        const known = m.showStates || tested.has(i) || finished;
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
        if (known && d.kind !== 'jbox') {
          ctx.fillStyle = d.live ? C.palm : C.inkSoft;
          ctx.beginPath();
          ctx.arc(s.x + 13, s.y - 16, 6, 0, Math.PI * 2);
          ctx.fill();
          label(ctx, d.live ? '120' : '0', s.x, s.y + 28, { size: 10, weight: 900, color: d.live ? C.palm : C.inkSoft });
        } else if (d.kind !== 'jbox' && mode === 'trace') {
          label(ctx, 'test', s.x, s.y + 28, { size: 10, weight: 800, color: C.sea });
        }
      });
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
      if (finished) {
        const aDev = m.devices[m.chain[m.faultAfter]];
        const q = S(aDev.pos);
        ctx.strokeStyle = correctSpot ? C.palm : C.rust;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(q.x, q.y, 24, 0, Math.PI * 2);
        ctx.stroke();
        label(ctx, 'loose backstab', q.x, q.y - 32, { size: 11, weight: 800, color: correctSpot ? C.palm : C.rust });
      }
      if (tracing) {
        const s = S(tracing);
        ctx.fillStyle = 'rgba(46,124,147,.25)';
        ctx.beginPath();
        ctx.arc(s.x, s.y, 16, 0, Math.PI * 2);
        ctx.fill();
      }
      // mode buttons (thumb zone)
      const by = a.h - 74;
      const bw = (a.w - 36) / 2;
      [
        ['trace', 'Trace + test'],
        ['mark', 'Mark the fault'],
      ].forEach(([k, t], i) => {
        roundRect(ctx, 12 + i * (bw + 12), by, bw, 52, 26);
        ctx.fillStyle = mode === k ? (k === 'mark' ? C.ink : C.sea) : C.sandDeep;
        ctx.fill();
        label(ctx, t, 12 + i * (bw + 12) + bw / 2, by + 26, { size: 15, weight: 800, color: mode === k ? C.white : C.ink });
      });
      if (m.showStates && !finished) label(ctx, 'Green = live. The open is after the last live device.', a.w / 2, a.y + a.ph + 12, { size: 11, color: C.inkSoft, weight: 700 });
    }

    function makeResult(): PuzzleResult {
      const tracedFrac = m.segs.filter((_, i) => revealed.has(i)).length / m.segs.length;
      const sc = scoreTrace(m, { wrongMarks, correct: !!correctSpot, tests, tracedFrac });
      const parts = [correctSpot ? (wrongMarks ? `fault found after ${wrongMarks} wrong call${wrongMarks > 1 ? 's' : ''}` : 'fault found first try') : 'fault not found'];
      if (!m.showStates) parts.push(`${tests} tests (best ${m.optimalTests})`);
      return result(sc, parts.join(', '));
    }
    function finish() {
      if (finished) return;
      finished = true;
      const res = makeResult();
      res.perfect ? host.fx.flourish() : host.fx.good();
      setTimeout(() => host.done(res), res.perfect ? 1000 : 600);
    }

    return {
      timeUp() {
        finished = true;
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

