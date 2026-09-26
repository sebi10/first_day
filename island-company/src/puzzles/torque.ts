// Mechanic · Torque sequence. Tap a bolt, then turn the dial with one thumb
// to bring it into the green band. Overshoot is permanent (like a real bolt).
import { rng } from '../sim/rng';
import { C, backdrop, clamp, ease, label, loop, pointer, shade, stage } from './kit';
import { result, type PuzzleDef, type PuzzleResult } from './types';

export type TorqueModel = {
  bolts: number;
  /** sequence[i] = bolt index to tighten at step i (star pattern) */
  sequence: number[];
  target: number; // ft-lb
  band: number; // fraction, e.g. 0.1 = +/-10%
  lag: number; // gauge time constant, seconds
  /** how many sequence numbers are printed on the flange */
  labelled: number;
};

/** Star pattern: opposite pairs, each next pair as far from the last as possible. */
export function starSequence(n: number, offset = 0): number[] {
  const half = n / 2;
  const pairOrder: number[] = [];
  // bit-reversal-ish spread over pair indices
  const pool = Array.from({ length: half }, (_, i) => i);
  let step = Math.max(1, Math.floor(half / 2));
  let cur = 0;
  while (pool.length) {
    const idx = pool.indexOf(cur);
    if (idx >= 0) {
      pairOrder.push(cur);
      pool.splice(idx, 1);
      cur = (cur + step) % half;
    } else {
      cur = pool[0];
      step = Math.max(1, Math.floor(step / 2));
    }
  }
  const seq: number[] = [];
  for (const p of pairOrder) seq.push((p + offset) % n, (p + half + offset) % n);
  return seq;
}

export function generateTorque(seed: number, tier: number, tools: string[] = []): TorqueModel {
  const r = rng(seed);
  const bolts = tier <= 1 ? 4 : tier <= 3 ? 6 : 8;
  const band = [0.14, 0.12, 0.1, 0.08, 0.06, 0.05][clamp(tier, 0, 5)];
  let lag = [0, 0, 0.08, 0.18, 0.26, 0.34][clamp(tier, 0, 5)];
  if (tools.includes('gaugeDamper')) lag *= 0.5;
  return {
    bolts,
    sequence: starSequence(bolts, r.int(0, bolts - 1)),
    target: 5 * r.int(5, 14), // 25..70 ft-lb
    band,
    lag,
    labelled: tier >= 3 ? 2 : bolts,
  };
}

export function boltScore(torque: number, target: number, band: number): number {
  const v = torque / target;
  const lo = 1 - band;
  const hi = 1 + band;
  if (v >= lo && v <= hi) return 1;
  if (v < lo) return 0.8 * Math.pow(Math.max(0, v / lo), 2);
  return Math.max(0.1, 0.5 - (v - hi) * 2);
}

export function scoreTorque(m: TorqueModel, torques: number[], seqErrors: number): number {
  const mean = torques.reduce((s, t) => s + boltScore(t, m.target, m.band), 0) / m.bolts;
  return clamp(mean - 0.08 * seqErrors, 0, 1);
}

function summarize(m: TorqueModel, torques: number[], seqErrors: number) {
  const inBand = torques.filter((t) => boltScore(t, m.target, m.band) === 1).length;
  const over = torques.filter((t) => t > m.target * (1 + m.band)).length;
  const parts = [`${inBand}/${m.bolts} bolts in band`];
  if (over) parts.push(`${over} overshoot`);
  if (seqErrors) parts.push(`${seqErrors} out of sequence`);
  return parts.join(', ');
}

export const torque: PuzzleDef = {
  id: 'torque',
  role: 'mech',
  title: 'Torque sequence',
  gesture: 'Rotate dial + tap',
  howTo: 'Tap the next bolt, turn the dial into the green band.',
  term: 'Torque: twisting force on a bolt. Star order clamps a part evenly.',
  seconds: (tier) => 60 + tier * 10,
  mount(host, p) {
    const m = generateTorque(p.seed, p.tier, p.tools);
    const hasClick = p.tools.includes('clickWrench');
    const st = stage(host.el);
    const { ctx } = st;
    const torques = new Array(m.bolts).fill(0);
    const firstTouchOrder: number[] = [];
    let step = 0; // index into m.sequence we expect next
    let seqErrors = 0;
    let active = -1;
    let shown = 0; // needle value (lagged)
    let dialAngle = 0;
    let dragging: { id: number; lastA: number } | null = null;
    let lastTickAt = 0;
    let wasInBand = false;
    let finished = false;
    let flourishT = -1;
    const hint = { bolt: -1, until: 0 };

    const geo = () => {
      const w = st.w;
      const h = st.h;
      const flangeR = Math.min(w * 0.36, h * 0.19);
      return {
        w,
        h,
        fx: w / 2,
        fy: h * 0.23,
        flangeR,
        boltR: Math.max(16, flangeR * 0.16),
        gx: w / 2,
        gy: h * 0.6,
        gr: Math.min(w * 0.34, h * 0.14),
        dx: w / 2,
        dy: h * 0.82,
        dr: Math.min(w * 0.3, h * 0.13),
      };
    };
    const boltPos = (i: number) => {
      const g = geo();
      const a = -Math.PI / 2 + (i / m.bolts) * Math.PI * 2;
      const rr = g.flangeR * 0.72;
      return { x: g.fx + Math.cos(a) * rr, y: g.fy + Math.sin(a) * rr };
    };

    const lockActive = () => {
      if (active < 0) return;
      active = -1;
    };

    const finish = () => {
      if (finished) return;
      finished = true;
      const s = scoreTorque(m, torques, seqErrors);
      const res = result(s, summarize(m, torques, seqErrors));
      if (res.perfect) {
        flourishT = performance.now();
        host.fx.flourish();
      } else host.fx.good();
      setTimeout(() => host.done(res), res.perfect ? 900 : 350);
    };

    const selectBolt = (i: number) => {
      if (i === active) return;
      lockActive();
      if (torques[i] === 0 && !firstTouchOrder.includes(i)) {
        const expected = m.sequence[step];
        if (i !== expected) {
          seqErrors++;
          host.fx.bad();
          hint.bolt = expected;
          hint.until = performance.now() + 900;
          return;
        }
        firstTouchOrder.push(i);
        step++;
      }
      active = i;
      shown = torques[i];
      wasInBand = false;
      host.fx.tap();
      host.status(`Bolt ${Math.min(step, m.bolts)} of ${m.bolts} · target ${m.target} ft-lb`);
    };

    host.status(`Target ${m.target} ft-lb · star pattern`);

    const angleAt = (x: number, y: number) => {
      const g = geo();
      return Math.atan2(y - g.dy, x - g.dx);
    };

    const offPtr = pointer(st.canvas, {
      down(pt) {
        if (finished || host.paused()) return;
        const g = geo();
        for (let i = 0; i < m.bolts; i++) {
          const b = boltPos(i);
          if (Math.hypot(pt.x - b.x, pt.y - b.y) < g.boltR * 1.6) {
            selectBolt(i);
            return;
          }
        }
        // finish button
        if (allTouched() && pt.y > g.h - 64 && Math.abs(pt.x - g.w / 2) < 90 && !dragging) {
          lockActive();
          finish();
          return;
        }
        if (Math.hypot(pt.x - g.dx, pt.y - g.dy) < g.dr * 1.6) {
          if (active < 0) {
            host.fx.bad();
            hint.bolt = m.sequence[Math.min(step, m.bolts - 1)];
            hint.until = performance.now() + 900;
            return;
          }
          dragging = { id: pt.id, lastA: angleAt(pt.x, pt.y) };
        }
      },
      move(pt) {
        if (!dragging || dragging.id !== pt.id || active < 0 || finished || host.paused()) return;
        const a = angleAt(pt.x, pt.y);
        let d = a - dragging.lastA;
        if (d > Math.PI) d -= Math.PI * 2;
        if (d < -Math.PI) d += Math.PI * 2;
        dragging.lastA = a;
        if (d <= 0) return; // ratchet: counter-clockwise does nothing
        dialAngle += d;
        const add = (d / (Math.PI * 2)) * m.target * 0.8;
        const before = torques[active];
        torques[active] = before + add;
        if (Math.floor(torques[active] / 2) !== Math.floor(before / 2)) {
          const now = performance.now();
          if (now - lastTickAt > 28) {
            host.fx.tick();
            lastTickAt = now;
          }
        }
        const inBand = boltScore(torques[active], m.target, m.band) === 1;
        if (hasClick && inBand && !wasInBand) host.fx.snap();
        if (!inBand && wasInBand && torques[active] > m.target) host.fx.bad();
        wasInBand = inBand;
      },
      up(pt) {
        if (dragging && dragging.id === pt.id) {
          dragging = null;
          if (active >= 0 && boltScore(torques[active], m.target, m.band) === 1) {
            host.fx.snap();
          }
          if (allTouched() && step >= m.bolts && active >= 0 && torques[active] >= m.target * (1 - m.band)) {
            lockActive();
            finish();
          }
        }
      },
    });

    const allTouched = () => torques.every((t) => t > 0);

    const stop = loop((_t, dt) => {
      const g = geo();
      // lagged needle
      const target = active >= 0 ? torques[active] : 0;
      if (m.lag <= 0 || p.reducedMotion) shown = target;
      else shown += (target - shown) * (1 - Math.exp(-dt / m.lag));
      draw(g);
    });

    function draw(g: ReturnType<typeof geo>) {
      backdrop(ctx, g.w, g.h);
      const now = performance.now();
      const gleam = flourishT > 0 ? clamp((now - flourishT) / 800, 0, 1) : 0;

      // flange
      const grad = ctx.createRadialGradient(g.fx - g.flangeR * 0.3, g.fy - g.flangeR * 0.3, 4, g.fx, g.fy, g.flangeR);
      grad.addColorStop(0, '#c9cfd2');
      grad.addColorStop(1, '#7f8b90');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(g.fx, g.fy, g.flangeR, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = shade(C.ink, 0.35);
      ctx.beginPath();
      ctx.arc(g.fx, g.fy, g.flangeR * 0.34, 0, Math.PI * 2);
      ctx.fill();
      if (p.context?.assetName) label(ctx, p.context.assetName, g.fx, g.fy, { size: 11, color: C.paper });

      for (let i = 0; i < m.bolts; i++) {
        const b = boltPos(i);
        const t = torques[i];
        const sc = t > 0 ? boltScore(t, m.target, m.band) : -1;
        const isActive = i === active;
        const isHint = hint.bolt === i && now < hint.until;
        ctx.save();
        ctx.translate(b.x, b.y);
        // hex head
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
          const rr = g.boltR * (isActive ? 1.12 : 1);
          ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        ctx.closePath();
        ctx.fillStyle = sc === 1 ? C.palm : sc >= 0 && t > m.target ? C.rust : sc >= 0 ? C.mech : '#d7dcdf';
        if (gleam > 0 && sc === 1) ctx.fillStyle = shade(C.palm, 0.5 * Math.sin(gleam * Math.PI));
        ctx.fill();
        ctx.lineWidth = isActive || isHint ? 3 : 1.5;
        ctx.strokeStyle = isHint ? C.sea : C.ink;
        ctx.stroke();
        const seqIdx = m.sequence.indexOf(i);
        if (seqIdx < m.labelled || t > 0) label(ctx, String(seqIdx + 1), 0, 1, { size: 13, weight: 800, color: C.ink });
        ctx.restore();
      }

      // gauge
      const a0 = Math.PI * 0.85;
      const a1 = Math.PI * 2.15;
      const max = m.target * 1.6;
      const toA = (v: number) => a0 + (clamp(v, 0, max) / max) * (a1 - a0);
      ctx.lineCap = 'round';
      ctx.lineWidth = 14;
      ctx.strokeStyle = shade(C.sand, -0.12);
      ctx.beginPath();
      ctx.arc(g.gx, g.gy, g.gr, a0, a1);
      ctx.stroke();
      ctx.strokeStyle = C.palm;
      ctx.beginPath();
      ctx.arc(g.gx, g.gy, g.gr, toA(m.target * (1 - m.band)), toA(m.target * (1 + m.band)));
      ctx.stroke();
      ctx.strokeStyle = C.rust;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(g.gx, g.gy, g.gr, toA(m.target * (1 + m.band) + 1), a1);
      ctx.stroke();
      const na = toA(shown);
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(g.gx, g.gy);
      ctx.lineTo(g.gx + Math.cos(na) * g.gr * 0.92, g.gy + Math.sin(na) * g.gr * 0.92);
      ctx.stroke();
      ctx.fillStyle = C.ink;
      ctx.beginPath();
      ctx.arc(g.gx, g.gy, 6, 0, Math.PI * 2);
      ctx.fill();
      label(ctx, active >= 0 ? `${Math.round(shown)} ft-lb` : 'select a bolt', g.gx, g.gy + g.gr * 0.45, {
        size: 17,
        weight: 700,
      });

      // dial (knurled)
      ctx.save();
      ctx.translate(g.dx, g.dy);
      ctx.rotate(dialAngle);
      const dg = ctx.createRadialGradient(-g.dr * 0.3, -g.dr * 0.3, 4, 0, 0, g.dr);
      dg.addColorStop(0, shade(C.mech, 0.35));
      dg.addColorStop(1, shade(C.mech, -0.2));
      ctx.fillStyle = dg;
      ctx.beginPath();
      ctx.arc(0, 0, g.dr, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = shade(C.mech, -0.35);
      ctx.lineWidth = 2;
      for (let k = 0; k < 36; k++) {
        const a = (k / 36) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * g.dr * 0.86, Math.sin(a) * g.dr * 0.86);
        ctx.lineTo(Math.cos(a) * g.dr, Math.sin(a) * g.dr);
        ctx.stroke();
      }
      ctx.fillStyle = C.ink;
      ctx.beginPath();
      ctx.arc(0, -g.dr * 0.62, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      if (active < 0 && !finished) label(ctx, 'tap a bolt first', g.dx, g.dy, { size: 13, color: C.ink });
      else if (!dragging && !finished) label(ctx, 'turn clockwise ↻', g.dx, g.dy, { size: 13, color: C.ink });

      if (allTouched() && !finished) {
        ctx.fillStyle = C.sea;
        const bw = 150;
        const bx = g.w / 2 - bw / 2;
        const by = g.h - 56;
        ctx.beginPath();
        ctx.roundRect?.(bx, by, bw, 44, 22);
        ctx.fill();
        label(ctx, 'Finish', g.w / 2, by + 22, { size: 16, weight: 700, color: C.white });
      }

      if (gleam > 0 && gleam < 1) {
        ctx.globalAlpha = 0.35 * (1 - ease.outCubic(gleam));
        ctx.fillStyle = C.white;
        ctx.fillRect(0, 0, g.w, g.h);
        ctx.globalAlpha = 1;
      }
    }

    return {
      timeUp(): PuzzleResult {
        finished = true;
        return result(scoreTorque(m, torques, seqErrors), summarize(m, torques, seqErrors));
      },
      destroy() {
        stop();
        offPtr();
        st.destroy();
      },
    };
  },
};
