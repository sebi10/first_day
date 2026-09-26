// Mechanic · Crack hunt. Fluorescent penetrant inspection in a dark booth:
// sweep the UV lamp with one finger, tap indications to tag them, sign off.
// Real tells, as on the hangar floor: cracks start at fastener holes and
// edges, run jagged, and BLEED (the indication grows while the lamp dwells).
// Scratches are straight tool marks and don't bleed. Tiers 0–2 print that rule
// and make decoys dimmer; from tier 3 decoys look just as bright and you read
// shape, origin and bleed-out yourself.
import { rng } from '../sim/rng';
import { C, clamp, dist, label, loop, pointer, roundRect, settle, stage } from './kit';
import { result, type PuzzleDef, type PuzzleResult } from './types';

type P = { x: number; y: number }; // normalised 0..1
export type Indication = { pts: P[]; kind: 'crack' | 'scratch'; depth: number };
export type CrackModel = {
  part: 'spar' | 'hub';
  holes: P[];
  indications: Indication[];
  cracks: number;
  battery: number; // seconds of lamp time (Infinity for tutorial)
  lampR: number; // fraction of min(w,h)
  linger: number; // seconds a glow lingers after the lamp leaves
  decoyDim: number; // 1 = decoys as bright as cracks
  allowedSweeps: number;
  teach: boolean;
};

function jagged(r: ReturnType<typeof rng>, from: P, angle: number, len: number, steps = 6): P[] {
  const pts: P[] = [from];
  let a = angle;
  let cur = from;
  for (let i = 0; i < steps; i++) {
    a += r.range(-0.45, 0.45);
    cur = { x: cur.x + (Math.cos(a) * len) / steps, y: cur.y + (Math.sin(a) * len) / steps };
    pts.push(cur);
  }
  return pts;
}

export function generateCrack(seed: number, tier: number, tools: string[] = [], job?: string): CrackModel {
  const r = rng(seed);
  const coin = r.chance(0.5);
  // the job decides the part: spar inspections look at a spar, wheel-half checks at a hub
  const part: CrackModel['part'] = job === 'spar' ? 'spar' : job === 'corrosion' ? 'hub' : coin ? 'spar' : 'hub';
  const holes: P[] = [];
  if (part === 'spar') {
    for (let i = 0; i < 7; i++) {
      holes.push({ x: 0.1 + i * 0.133, y: 0.27 });
      holes.push({ x: 0.1 + i * 0.133, y: 0.73 });
    }
  } else {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      holes.push({ x: 0.5 + Math.cos(a) * 0.26, y: 0.5 + Math.sin(a) * 0.26 });
    }
  }
  const cracks = tier <= 0 ? 1 : tier <= 2 ? 2 : tier <= 4 ? 3 : 4;
  const decoys = tier <= 1 ? 0 : tier === 2 ? 1 : tier <= 4 ? 2 : 3;
  const len = clamp(0.13 - tier * 0.012, 0.06, 0.13);
  const used = r.shuffle(holes.map((_, i) => i));
  const indications: Indication[] = [];
  for (let k = 0; k < cracks; k++) {
    const h = holes[used[k]];
    // cracks radiate from the hole, perpendicular to the main load path
    const base = part === 'spar' ? (h.y < 0.5 ? Math.PI / 2 : -Math.PI / 2) : Math.atan2(h.y - 0.5, h.x - 0.5);
    const start = { x: h.x + Math.cos(base) * 0.025, y: h.y + Math.sin(base) * 0.025 };
    indications.push({ pts: jagged(r, start, base + r.range(-0.6, 0.6), len * r.range(0.8, 1.2)), kind: 'crack', depth: r.range(0.3, 1) });
  }
  for (let k = 0; k < decoys; k++) {
    // scratches: straight tool marks, clear of the holes, along the machining direction
    for (let tries = 0; tries < 30; tries++) {
      const x = r.range(0.2, 0.75);
      const y = part === 'spar' ? r.range(0.42, 0.58) : r.range(0.25, 0.75);
      const a = part === 'spar' ? r.range(-0.08, 0.08) : r.range(0, Math.PI);
      const l = len * r.range(1.1, 1.6);
      const seg = [{ x, y }, { x: x + Math.cos(a) * l, y: y + Math.sin(a) * l }];
      const clear =
        holes.every((h) => distToLine(h, seg) > 0.07) &&
        (part === 'spar' || distToLine({ x: 0.5, y: 0.5 }, seg) > 0.16) &&
        indications.every((ind) => ind.pts.every((q) => distToLine(q, seg) > 0.07) && seg.every((q) => distToLine(q, ind.pts) > 0.07));
      if (clear || tries === 29) {
        indications.push({ pts: seg, kind: 'scratch', depth: 0 });
        break;
      }
    }
  }
  const battery = tier <= 0 ? Infinity : [Infinity, 40, 32, 26, 22, 18][tier];
  return {
    part,
    holes,
    indications,
    cracks,
    battery,
    lampR: clamp(0.2 - tier * 0.015, 0.12, 0.2) * (tools.includes('uvPlus') ? 1.4 : 1),
    linger: (tier <= 2 ? 1.6 : 1.2) * (tools.includes('borescope') ? 1.6 : 1),
    decoyDim: tier <= 2 ? 0.45 : 1,
    allowedSweeps: cracks + decoys + 3,
    teach: tier <= 2,
  };
}

/** distance from p to a polyline, in normalised units */
function distToLine(p: P, pts: P[]) {
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

export function scoreCrack(m: CrackModel, tags: P[], sweeps: number, tol = 0.035) {
  const found = new Set<number>();
  let falseTags = 0;
  for (const t of tags) {
    let hit = -1;
    m.indications.forEach((ind, i) => {
      if (ind.kind === 'crack' && distToLine(t, ind.pts) < tol) hit = i;
    });
    if (hit >= 0) found.add(hit);
    else falseTags++;
  }
  const extra = Math.max(0, sweeps - m.allowedSweeps);
  const score = clamp(found.size / m.cracks - 0.2 * falseTags - 0.03 * extra, 0, 1);
  return { score, found: found.size, falseTags, extra };
}

/** the lamp shines this far above the finger, so your thumb never hides the glow */
const LAMP_LIFT = 64;

export const crack: PuzzleDef = {
  id: 'crack',
  role: 'mech',
  title: 'Crack hunt',
  gesture: 'Drag a UV lamp',
  howTo: 'Sweep the lamp, tap each crack indication, then sign off.',
  term: 'Penetrant inspection: dye seeps into cracks and glows under UV. Cracks bleed; scratches don’t.',
  seconds: (tier) => 60 + tier * 10,
  mount(host, p) {
    const m = generateCrack(p.seed, p.tier, p.tools, p.context?.job);
    const depthView = p.tools.includes('borescope');
    const st = stage(host.el);
    const { ctx } = st;
    const lit = m.indications.map(() => 0); // glow 0..1
    const dwell = m.indications.map(() => 0); // seconds under the lamp (bleed-out)
    const tags: P[] = [];
    let lamp: P | null = null;
    let battery = m.battery;
    let sweeps = 0;
    let down: { x: number; y: number; t: number; moved: boolean } | null = null;
    let finished = false;
    let revealT = 0;

    const area = () => {
      const w = st.w;
      const h = st.h;
      const top = 44;
      const bottom = h - 84;
      let x = 12;
      let y = top;
      let pw = w - 24;
      let ph = bottom - top;
      if (m.part === 'hub') {
        // a round part needs a square frame so holes sit on the bolt circle
        const side = Math.min(pw, ph);
        x += (pw - side) / 2;
        y += (ph - side) / 2;
        pw = ph = side;
      }
      return { w, h, x, y, pw, ph };
    };
    const toN = (x: number, y: number): P => {
      const a = area();
      return { x: (x - a.x) / a.pw, y: (y - a.y) / a.ph };
    };
    const toS = (p: P) => {
      const a = area();
      return { x: a.x + p.x * a.pw, y: a.y + p.y * a.ph };
    };
    const tol = () => 22 / Math.min(area().pw, area().ph);

    const status = () =>
      host.status(`${tags.length} tagged · ${sweeps} sweeps${Number.isFinite(battery) ? ` · lamp ${Math.max(0, Math.round(battery))}s` : ''}`);
    status();

    const offPtr = pointer(st.canvas, {
      down(pt) {
        if (finished || host.paused()) return;
        const a = area();
        if (pt.y > a.h - 70) return signOff();
        down = { x: pt.x, y: pt.y, t: performance.now(), moved: false };
        if (battery > 0) lamp = toN(pt.x, pt.y - LAMP_LIFT);
      },
      move(pt) {
        if (!down || finished) return;
        if (!down.moved && dist(pt.x, pt.y, down.x, down.y) > 10) {
          down.moved = true;
          sweeps++;
          status();
        }
        if (battery > 0) lamp = toN(pt.x, pt.y - LAMP_LIFT);
      },
      up(pt) {
        if (!down || finished) return;
        const quick = !down.moved && performance.now() - down.t < 350;
        if (quick) {
          const n = toN(pt.x, pt.y);
          const near = tags.findIndex((t) => Math.hypot(t.x - n.x, t.y - n.y) < tol());
          if (near >= 0) {
            tags.splice(near, 1);
            host.fx.tap();
          } else if (n.x >= 0 && n.x <= 1 && n.y >= 0 && n.y <= 1) {
            tags.push(n);
            // tactile truth: a rigid double when you tag something that glows
            const onGlow = m.indications.some((ind, i) => lit[i] > 0.2 && distToLine(n, ind.pts) < tol());
            onGlow ? host.fx.fault() : host.fx.snap();
          }
          status();
        }
        down = null;
        lamp = null;
      },
    });

    const stop = loop((_t, dt) => {
      if (!finished && !host.paused() && lamp) {
        if (Number.isFinite(battery)) {
          battery -= dt;
          if (battery <= 0) {
            battery = 0;
            lamp = null;
            host.fx.bad();
          }
          status();
        }
      }
      const R = m.lampR;
      m.indications.forEach((ind, i) => {
        const under = lamp && ind.pts.some((q) => lamp && Math.hypot(q.x - lamp.x, q.y - lamp.y) < R);
        if (under) {
          lit[i] = Math.min(1, lit[i] + dt * 5);
          dwell[i] += dt;
        } else lit[i] = Math.max(0, lit[i] - dt / m.linger);
      });
      draw();
    });

    function draw() {
      const a = area();
      // dark booth
      ctx.fillStyle = '#10181c';
      ctx.fillRect(0, 0, a.w, a.h);
      // the part
      ctx.save();
      roundRect(ctx, a.x, a.y, a.pw, a.ph, 18);
      ctx.clip();
      const g = ctx.createLinearGradient(0, a.y, 0, a.y + a.ph);
      g.addColorStop(0, '#2a3439');
      g.addColorStop(1, '#1b2327');
      ctx.fillStyle = g;
      ctx.fillRect(a.x, a.y, a.pw, a.ph);
      if (m.part === 'spar') {
        // I-beam flanges + web
        ctx.fillStyle = '#323e44';
        ctx.fillRect(a.x, a.y + a.ph * 0.18, a.pw, a.ph * 0.18);
        ctx.fillRect(a.x, a.y + a.ph * 0.64, a.pw, a.ph * 0.18);
        ctx.strokeStyle = 'rgba(255,255,255,.04)';
        for (let i = 0; i < 40; i++) {
          const y = a.y + a.ph * (0.4 + (i % 10) * 0.02);
          ctx.beginPath();
          ctx.moveTo(a.x, y);
          ctx.lineTo(a.x + a.pw, y);
          ctx.stroke();
        }
      } else {
        const c = toS({ x: 0.5, y: 0.5 });
        const rr = Math.min(a.pw, a.ph) * 0.42;
        ctx.fillStyle = '#323e44';
        ctx.beginPath();
        ctx.arc(c.x, c.y, rr, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1b2327';
        ctx.beginPath();
        ctx.arc(c.x, c.y, rr * 0.35, 0, Math.PI * 2);
        ctx.fill();
      }
      for (const h of m.holes) {
        const s = toS(h);
        ctx.fillStyle = '#0b1114';
        ctx.beginPath();
        ctx.arc(s.x, s.y, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#46545b';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      // UV lamp
      if (lamp) {
        const s = toS(lamp);
        const R = m.lampR * Math.min(a.pw, a.ph);
        const lg = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, R);
        lg.addColorStop(0, 'rgba(143,184,222,.42)');
        lg.addColorStop(1, 'rgba(143,184,222,.06)');
        ctx.fillStyle = lg;
        ctx.beginPath();
        ctx.arc(s.x, s.y, R, 0, Math.PI * 2);
        ctx.fill();
        // the lamp's rim, so you can see where it points above your finger
        ctx.strokeStyle = 'rgba(143,184,222,.7)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      // indications (fluorescent yellow-green)
      m.indications.forEach((ind, i) => {
        const glow = finished ? 1 : lit[i];
        if (glow <= 0.01) return;
        const isCrack = ind.kind === 'crack';
        const bleed = isCrack ? Math.min(1, dwell[i] / 1.4) : 0;
        const alpha = glow * (isCrack ? 1 : m.decoyDim);
        ctx.strokeStyle = finished ? (isCrack ? C.elec : 'rgba(207,216,216,.6)') : `rgba(244,211,94,${alpha})`;
        ctx.lineWidth = isCrack ? 1.6 + bleed * 2.6 + (depthView ? ind.depth * 1.5 : 0) : 2;
        ctx.shadowColor = '#F4D35E';
        ctx.shadowBlur = 8 * alpha * (isCrack ? 1 + bleed : 0.6);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ind.pts.forEach((q, k) => {
          const s = toS(q);
          k ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y);
        });
        ctx.stroke();
        ctx.shadowBlur = 0;
        if (depthView && isCrack && glow > 0.5) {
          const s = toS(ind.pts[ind.pts.length - 1]);
          label(ctx, `${Math.round(ind.depth * 40 + 10)} thou`, s.x + 6, s.y - 8, { size: 10, color: C.elec, align: 'left' });
        }
      });
      ctx.restore();
      // tags
      tags.forEach((t) => {
        const s = toS(t);
        const hit = finished && m.indications.some((ind) => ind.kind === 'crack' && distToLine(t, ind.pts) < tol());
        ctx.strokeStyle = finished ? (hit ? C.palm : C.rust) : C.fin;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 14, 0, Math.PI * 2);
        ctx.stroke();
      });
      if (finished) {
        // show missed cracks
        m.indications.forEach((ind) => {
          if (ind.kind !== 'crack') return;
          const tagged = tags.some((t) => distToLine(t, ind.pts) < tol());
          if (tagged) return;
          const s = toS(ind.pts[0]);
          const tt = clamp((performance.now() - revealT) / 400, 0, 1);
          ctx.globalAlpha = tt;
          ctx.strokeStyle = C.rust;
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.arc(s.x, s.y, 20, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
        });
      }
      // header
      label(ctx, p.context?.assetName ? `${p.context.assetName} · ${m.part === 'spar' ? 'wing spar' : 'wheel hub'}` : m.part === 'spar' ? 'Wing spar' : 'Wheel hub', 16, 22, {
        size: 13,
        weight: 800,
        color: C.paper,
        align: 'left',
      });
      if (Number.isFinite(m.battery)) {
        const bw = 90;
        const frac = clamp(battery / m.battery, 0, 1);
        roundRect(ctx, a.w - bw - 16, 14, bw, 14, 7);
        ctx.fillStyle = 'rgba(255,255,255,.12)';
        ctx.fill();
        roundRect(ctx, a.w - bw - 16, 14, bw * frac, 14, 7);
        ctx.fillStyle = frac < 0.2 ? C.rust : C.fin;
        ctx.fill();
        label(ctx, 'UV', a.w - bw - 26, 21, { size: 10, weight: 800, color: C.paper, align: 'right' });
      }
      if (m.teach && !finished) label(ctx, 'Cracks: at holes, jagged, they bleed.', a.w / 2, a.h - 76, { size: 12, color: C.fin, weight: 700 });
      // sign-off button
      roundRect(ctx, a.w / 2 - 110, a.h - 62, 220, 50, 25);
      ctx.fillStyle = finished ? 'rgba(255,255,255,.15)' : C.sea;
      ctx.fill();
      label(ctx, finished ? 'Signed off' : 'Sign off inspection', a.w / 2, a.h - 37, { size: 16, weight: 800, color: C.white });
    }

    function makeResult(): PuzzleResult {
      const r = scoreCrack(m, tags, sweeps, tol());
      const parts = [`${r.found}/${m.cracks} cracks`];
      if (r.falseTags) parts.push(`${r.falseTags} false call${r.falseTags > 1 ? 's' : ''}`);
      parts.push(`${sweeps} sweeps`);
      return result(r.score, parts.join(', '));
    }

    function signOff() {
      if (finished) return;
      finished = true;
      revealT = performance.now();
      const res = makeResult();
      if (res.perfect) host.fx.flourish();
      else host.fx.good();
      settle(host, res, res.perfect ? 1000 : 700);
    }

    return {
      timeUp() {
        finished = true;
        revealT = performance.now();
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
