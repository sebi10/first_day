// Mechanic · Torque sequence. Tap a bolt, then turn the dial with one thumb
// to bring it into the green band. Overshoot is permanent (like a real bolt).
import { rng } from '../sim/rng';
import { C, backdrop, clamp, ease, fitLabel, label, loop, pointer, roundRect, settle, shade, stage } from './kit';
import { result, type ManualCard, type PuzzleDef, type PuzzleResult } from './types';

/** one torque value as the task card prints it */
export type TorqueLine = { eff?: string; effText?: string; lo: number; hi: number; unit: string; note?: string; applies: boolean };

export type TorqueModel = {
  bolts: number;
  /** sequence[i] = bolt index to tighten at step i (star pattern) */
  sequence: number[];
  /** the value that is right for this airplane (card-driven: the applicable line's mid-band) */
  target: number;
  band: number; // fraction, e.g. 0.1 = +/-10%
  lag: number; // gauge time constant, seconds
  /** how many sequence numbers are printed on the flange */
  labelled: number;
  unit: string;
  /**
   * Card-driven (a job on a plane with an AMM task card): the manual's lines
   * for this fastener, both effectivities as printed. `right` is the line for
   * this S/N and SB status. Tiers 0-2 mark it; from tier 3 the mechanic sets
   * the wrench to the line they judge applies (the plate and the records say).
   */
  card?: { key: string; what: string; task: string; plate: string; sbs: string[]; lines: TorqueLine[]; right: number; marked: boolean };
};

/** the band a line's lo..hi makes: centre and half-width as a fraction */
export const lineBand = (l: Pick<TorqueLine, 'lo' | 'hi'>) => ({ target: (l.lo + l.hi) / 2, band: (l.hi - l.lo) / (l.lo + l.hi) });

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

export function generateTorque(seed: number, tier: number, tools: string[] = [], card?: ManualCard): TorqueModel {
  const r = rng(seed);
  const tq = card?.torque;
  // the manual's fastener: six tie bolts on a wheel, six prop bolts (the IPC's units per assembly)
  const bolts = tq ? 6 : tier <= 1 ? 4 : tier <= 3 ? 6 : 8;
  const band = [0.14, 0.12, 0.1, 0.08, 0.06, 0.05][clamp(tier, 0, 5)];
  let lag = [0, 0, 0.08, 0.18, 0.26, 0.34][clamp(tier, 0, 5)];
  if (tools.includes('gaugeDamper')) lag *= 0.5;
  const sequence = starSequence(bolts, r.int(0, bolts - 1));
  const target = 5 * r.int(5, 14); // 25..70 ft-lb
  const m: TorqueModel = { bolts, sequence, target, band, lag, labelled: tier >= 3 ? 2 : bolts, unit: 'ft-lb' };
  if (tq && tq.lines.some((l) => l.applies)) {
    const lines = tq.lines.map((l) => ({ ...l }));
    const right = lines.findIndex((l) => l.applies);
    const b = lineBand(lines[right]);
    m.target = b.target;
    m.band = b.band;
    m.unit = lines[right].unit;
    m.card = { key: tq.key, what: tq.what, task: card!.task, plate: `${card!.reg} · S/N ${card!.serial}`, sbs: card!.sbs, lines, right, marked: card!.marked };
  }
  return m;
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

function summarize(m: TorqueModel, torques: number[], seqErrors: number, pick = -1) {
  const inBand = torques.filter((t) => boltScore(t, m.target, m.band) === 1).length;
  const over = torques.filter((t) => t > m.target * (1 + m.band)).length;
  const parts = [`${inBand}/${m.bolts} bolts in band`];
  if (over) parts.push(`${over} overshoot`);
  if (seqErrors) parts.push(`${seqErrors} out of sequence`);
  if (m.card && pick >= 0 && pick !== m.card.right) parts.push(`worked to the ${m.card.lines[pick].eff ?? 'wrong'} line, not ${m.card.lines[m.card.right].eff}`);
  return parts.join(', ');
}

/** card-driven: which line the bolts ended up at (the one worked to), for the hidden defect it leaves */
export function workedTo(m: TorqueModel, torques: number[], pick: number): number {
  if (!m.card) return -1;
  // the wrench setting, unless most bolts sit in another line's band
  const hits = m.card.lines.map((l) => torques.filter((t) => t >= l.lo && t <= l.hi).length);
  const best = hits.indexOf(Math.max(...hits));
  return hits[best] > m.bolts / 2 ? best : pick;
}

/** the result's data: which line the job was worked to, and the variant when it's the other effectivity's */
export function torqueData(m: TorqueModel, torques: number[], pick: number): Record<string, unknown> | undefined {
  if (!m.card) return undefined;
  const w = workedTo(m, torques, pick);
  const line = w >= 0 ? m.card.lines[w] : undefined;
  return { line: line?.eff ?? null, ...(w >= 0 && w !== m.card.right ? { defect: `eff:${m.card.key}` } : {}) };
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
    const m = generateTorque(p.seed, p.tier, p.tools, p.context?.card);
    const hasClick = p.tools.includes('clickWrench');
    const cd = m.card;
    // card-driven: the line the wrench is set to (teaching tiers: the one for this airplane, marked)
    let pick = cd ? (cd.marked ? cd.right : -1) : -1;
    /** what the wrench is set to: the picked line (card) or the job's target */
    const set = () => (cd ? (pick >= 0 ? lineBand(cd.lines[pick]) : null) : { target: m.target, band: m.band });
    const inSet = (tq: number) => {
      const b = set();
      return !!b && boltScore(tq, b.target, b.band) === 1;
    };
    // blind: any bolt may go first (an out-of-order one is scored, never flagged), no ✓/! heads, no hint
    const blind = !!p.blind;
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

    const CARD_H = 90;
    const geo = () => {
      const w = st.w;
      const h = st.h;
      if (cd) {
        // the manual's lines across the top, then flange, finish, gauge and dial
        const flangeR = Math.min(w * 0.28, h * 0.13);
        const gr = Math.min(w * 0.3, h * 0.12);
        const dr = Math.min(w * 0.28, h * 0.12);
        const fy = CARD_H + 12 + flangeR;
        return { w, h, fx: w / 2, fy, flangeR, boltR: Math.max(16, flangeR * 0.17), gx: w / 2, gy: fy + flangeR + 58 + gr, gr, dx: w / 2, dy: h - dr - 14, dr };
      }
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
    const finishY = (g: ReturnType<typeof geo>) => (cd ? g.fy + g.flangeR + 29 : (g.fy + g.flangeR + (g.gy - g.gr)) / 2);
    /** the card's line chips (card-driven) */
    const chipRects = () => {
      const g = geo();
      const n = cd?.lines.length ?? 0;
      const pad = 10;
      const cw = (g.w - pad * 2 - 8 * (n - 1)) / Math.max(1, n);
      return Array.from({ length: n }, (_, i) => ({ x: pad + i * (cw + 8), y: 36, w: cw, h: CARD_H - 40 }));
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
      const res = result(s, summarize(m, torques, seqErrors, pick), torqueData(m, torques, pick));
      if (res.perfect && !blind) {
        flourishT = performance.now();
        host.fx.flourish();
      } else host.fx.good();
      settle(host, res, res.perfect ? 900 : 350);
    };

    const needSet = () => {
      (blind ? host.fx.tap : host.fx.bad)();
      host.status('Set the wrench first: tap the manual line for this airplane');
    };
    const unitOf = () => (cd && pick >= 0 ? cd.lines[pick].unit : m.unit);
    const targetWords = () => (cd ? (pick >= 0 ? `wrench set to ${cd.lines[pick].lo}–${cd.lines[pick].hi} ${cd.lines[pick].unit}` : 'wrench not set') : `target ${m.target} ${m.unit}`);
    const selectBolt = (i: number) => {
      if (i === active) return;
      if (cd && pick < 0) return needSet();
      lockActive();
      if (torques[i] === 0 && !firstTouchOrder.includes(i)) {
        if (blind) {
          // the next bolt of the star pattern that hasn't been started: anything else is out of sequence
          if (i !== m.sequence.find((b) => !firstTouchOrder.includes(b))) seqErrors++;
          firstTouchOrder.push(i);
          step++;
          active = i;
          shown = torques[i];
          wasInBand = false;
          host.fx.tap();
          host.status(`Bolt ${Math.min(step, m.bolts)} of ${m.bolts} · ${targetWords()}`);
          return;
        }
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
      host.status(`Bolt ${Math.min(step, m.bolts)} of ${m.bolts} · ${targetWords()}`);
    };

    host.status(cd ? (pick >= 0 ? `${cd.what}: ${targetWords()} · star pattern` : `${cd.task}: set the wrench to the line for this airplane`) : `Target ${m.target} ft-lb · star pattern`);

    const angleAt = (x: number, y: number) => {
      const g = geo();
      return Math.atan2(y - g.dy, x - g.dx);
    };

    const offPtr = pointer(st.canvas, {
      down(pt) {
        if (finished || host.paused()) return;
        const g = geo();
        // the manual's lines: set the wrench (before the first bolt; once one is torqued the setting stays)
        if (cd) {
          const k = chipRects().findIndex((r) => pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y - 6 && pt.y <= r.y + r.h + 6);
          if (k >= 0) {
            if (torques.some((q) => q > 0)) {
              (blind ? host.fx.tap : host.fx.bad)();
              host.status('Bolts already torqued at this setting');
              return;
            }
            pick = k;
            host.fx.snap();
            host.status(`${cd.what}: ${targetWords()}`);
            return;
          }
        }
        for (let i = 0; i < m.bolts; i++) {
          const b = boltPos(i);
          if (Math.hypot(pt.x - b.x, pt.y - b.y) < g.boltR * 1.6) {
            selectBolt(i);
            return;
          }
        }
        // the dial always wins: re-gripping it must never hand the job in
        const onDial = Math.hypot(pt.x - g.dx, pt.y - g.dy) < g.dr * 1.6;
        // finish button sits between the flange and the gauge, away from the dial
        const fy = finishY(g);
        if (!onDial && allTouched() && Math.abs(pt.y - fy) < 26 && Math.abs(pt.x - g.w / 2) < 80 && !dragging) {
          lockActive();
          finish();
          return;
        }
        if (onDial) {
          if (cd && pick < 0) return needSet();
          if (active < 0) {
            host.fx.bad();
            // blind: the dial says "tap a bolt first", it doesn't point at the right one
            if (!blind) {
              hint.bolt = m.sequence[Math.min(step, m.bolts - 1)];
              hint.until = performance.now() + 900;
            }
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
        // a narrow manual band turns finer (the wrench is set; the dial is the handle)
        const b = set() ?? { target: m.target, band: m.band };
        const add = (d / (Math.PI * 2)) * b.target * (cd ? clamp(b.band * 7, 0.25, 0.8) : 0.8);
        const before = torques[active];
        torques[active] = before + add;
        if (Math.floor(torques[active] / 2) !== Math.floor(before / 2)) {
          const now = performance.now();
          if (now - lastTickAt > 28) {
            host.fx.tick();
            lastTickAt = now;
          }
        }
        // the wrench clicks at what it's set to (card-driven: the line picked, right or not)
        const inBand = inSet(torques[active]);
        if (hasClick && inBand && !wasInBand) host.fx.snap();
        if (!inBand && wasInBand && torques[active] > b.target) host.fx.bad();
        wasInBand = inBand;
      },
      up(pt) {
        if (dragging && dragging.id === pt.id) {
          dragging = null;
          // letting go in band clicks like a click-type wrench; blind, only the real click wrench does
          if (active >= 0 && inSet(torques[active]) && (!blind || hasClick)) {
            host.fx.snap();
          }
          const b = set() ?? { target: m.target, band: m.band };
          if (allTouched() && step >= m.bolts && active >= 0 && torques[active] >= b.target * (1 - b.band)) {
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
      if (cd) label(ctx, cd.plate.split(' · ')[0], g.fx, g.fy, { size: 11, color: C.paper });
      else if (p.context?.assetName) label(ctx, p.context.assetName, g.fx, g.fy, { size: 11, color: C.paper });
      if (cd) drawCard(g);

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
        // blind: a torqued bolt is just torqued (the gauge showed its value while you turned)
        ctx.fillStyle = blind ? (sc >= 0 ? C.mech : '#d7dcdf') : sc === 1 ? C.palm : sc >= 0 && t > m.target ? C.rust : sc >= 0 ? C.mech : '#d7dcdf';
        if (gleam > 0 && sc === 1) ctx.fillStyle = shade(C.palm, 0.5 * Math.sin(gleam * Math.PI));
        ctx.fill();
        ctx.lineWidth = isActive || isHint ? 3 : 1.5;
        ctx.strokeStyle = isHint ? C.sea : C.ink;
        ctx.stroke();
        const seqIdx = m.sequence.indexOf(i);
        // colour plus a glyph: never colour alone
        const glyph = blind ? '' : sc === 1 ? '✓' : sc >= 0 && t > m.target ? '!' : '';
        if (glyph) label(ctx, glyph, 0, 1, { size: 15, weight: 900, color: C.white });
        // blind: only the numbers printed on the work card (a torqued bolt doesn't reveal its place in the pattern)
        else if (seqIdx < m.labelled || (t > 0 && !blind)) label(ctx, String(seqIdx + 1), 0, 1, { size: 13, weight: 800, color: C.ink });
        ctx.restore();
      }

      // gauge
      const a0 = Math.PI * 0.85;
      const a1 = Math.PI * 2.15;
      const max = cd ? Math.max(...cd.lines.map((l) => l.hi)) * 1.35 : m.target * 1.6;
      const toA = (v: number) => a0 + (clamp(v, 0, max) / max) * (a1 - a0);
      ctx.lineCap = 'round';
      ctx.lineWidth = 14;
      ctx.strokeStyle = shade(C.sand, -0.12);
      ctx.beginPath();
      ctx.arc(g.gx, g.gy, g.gr, a0, a1);
      ctx.stroke();
      // the band the wrench is set to (card-driven: none until a line is picked)
      const sb = set();
      if (sb) {
        ctx.strokeStyle = C.palm;
        ctx.beginPath();
        ctx.arc(g.gx, g.gy, g.gr, toA(sb.target * (1 - sb.band)), toA(sb.target * (1 + sb.band)));
        ctx.stroke();
        ctx.strokeStyle = C.rust;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(g.gx, g.gy, g.gr, toA(sb.target * (1 + sb.band) + max / 120), a1);
        ctx.stroke();
      }
      if (cd) {
        // the dial's scale: numbers every major division, so the reading is the mechanic's
        const step = max > 300 ? 100 : max > 120 ? 50 : max > 60 ? 20 : 10;
        for (let v = 0; v <= max; v += step) {
          const a = toA(v);
          label(ctx, String(v), g.gx + Math.cos(a) * (g.gr - 22), g.gy + Math.sin(a) * (g.gr - 22), { size: 9, weight: 700, color: C.inkSoft });
        }
      }
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
      label(ctx, active >= 0 ? `${Math.round(shown)} ${unitOf()}` : cd && pick < 0 ? 'set the wrench' : 'select a bolt', g.gx, g.gy + g.gr * (cd ? 0.72 : 0.45), {
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
      if (cd && pick < 0 && !finished) label(ctx, 'set the wrench first', g.dx, g.dy, { size: 13, color: C.ink });
      else if (active < 0 && !finished) label(ctx, 'tap a bolt first', g.dx, g.dy, { size: 13, color: C.ink });
      else if (!dragging && !finished) label(ctx, 'turn clockwise ↻', g.dx, g.dy, { size: 13, color: C.ink });

      if (allTouched() && !finished) {
        ctx.fillStyle = C.sea;
        const bw = 150;
        const bx = g.w / 2 - bw / 2;
        const by = finishY(g) - 22;
        ctx.beginPath();
        ctx.roundRect?.(bx, by, bw, 44, 22);
        ctx.fill();
        label(ctx, 'Finish', g.w / 2, by + 22, { size: 16, weight: 700, color: C.white });
      }

      if (cd && pick < 0 && !finished) label(ctx, 'tap the line for this airplane ↑', g.w / 2, finishY(g), { size: 13, weight: 800, color: C.rust });

      if (gleam > 0 && gleam < 1) {
        ctx.globalAlpha = 0.35 * (1 - ease.outCubic(gleam));
        ctx.fillStyle = C.white;
        ctx.fillRect(0, 0, g.w, g.h);
        ctx.globalAlpha = 1;
      }
    }

    /** the task card strip: the plate, then one chip per line as the manual prints it */
    function drawCard(g: ReturnType<typeof geo>) {
      if (!cd) return;
      const recs = [cd.sbs.length ? `SBs on record: ${cd.sbs.join(', ')}` : 'SBs on record: none'];
      fitLabel(ctx, `${cd.task} · ${cd.plate}`, 10, 10, g.w - 20, { size: 12, weight: 900, color: C.ink, align: 'left' });
      // the records: which SBs this airplane has had (the C/D lines turn on them)
      fitLabel(ctx, recs[0], 10, 25, g.w - 20, { size: 10.5, weight: 700, color: C.inkSoft, align: 'left' });
      chipRects().forEach((r, i) => {
        const l = cd.lines[i];
        const on = pick === i;
        const mark = cd.marked && l.applies;
        const dim = cd.marked && !l.applies;
        roundRect(ctx, r.x, r.y, r.w, r.h, 10);
        ctx.fillStyle = on ? shade(C.mech, 0.55) : C.paper;
        ctx.fill();
        ctx.lineWidth = on ? 3 : 1.5;
        ctx.strokeStyle = on ? C.ink : 'rgba(31,42,48,.35)';
        ctx.stroke();
        ctx.globalAlpha = dim ? 0.5 : 1;
        const x = r.x + 8;
        const mw = r.w - 16;
        fitLabel(ctx, `${l.eff ?? 'ALL'}${l.effText ? ` · ${l.effText}` : ''}`, x, r.y + 11, mw, { size: 10.5, weight: 800, color: C.inkSoft, align: 'left' });
        fitLabel(ctx, `${l.lo}–${l.hi} ${l.unit}`, x, r.y + 27, mw, { size: 15, weight: 900, color: C.ink, align: 'left' });
        const note = mark ? '◀ this airplane' : dim ? 'not this airplane' : (l.note ?? '').split(';')[0];
        fitLabel(ctx, note, x, r.y + 42, mw, { size: 10, weight: mark ? 900 : 600, color: mark ? C.palm : C.inkSoft, align: 'left' });
        ctx.globalAlpha = 1;
      });
    }

    return {
      timeUp(): PuzzleResult {
        finished = true;
        return result(scoreTorque(m, torques, seqErrors), summarize(m, torques, seqErrors, pick), torqueData(m, torques, pick));
      },
      destroy() {
        stop();
        offPtr();
        st.destroy();
      },
    };
  },
};
