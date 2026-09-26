// Electrician · Wire-up. Strip each conductor to the gauge (3/4 in), then land
// it on the right terminal with a clockwise hook. Real rules: black (hot) to
// brass, white (neutral) to silver, bare to green; on a 3-way the common
// (black screw) takes the source hot and the brass screws take the travelers;
// on a GFCI the source goes on LINE. Tiers 0–2 label every terminal; from
// tier 3 you get only the screw colours, like a real device.
import { rng } from '../sim/rng';
import { C, backdrop, clamp, label, loop, pointer, roundRect, stage } from './kit';
import { result, type PuzzleDef, type PuzzleResult } from './types';

type Term = { id: string; label: string; color: 'brass' | 'silver' | 'green' | 'dark' | 'nut'; x: number; y: number; multi?: boolean; stamp?: string };
type Wire = { id: string; color: 'black' | 'white' | 'bare' | 'red'; cable: string; target: string[]; label: string };
export type WireModel = {
  device: 'receptacle' | 'switch3' | 'passthrough' | 'gfci' | 'switch3src';
  title: string;
  terms: Term[];
  wires: Wire[];
  cables: { id: string; label: string; x: number }[];
  /** teaching labels (tiers 0-2): HOT / NEU / GND spelled out */
  labels: boolean;
  /** only what a real device has stamped on it (LINE/LOAD, COMMON): the headlamp tool */
  stamps: boolean;
  /** live strip-length readout: teaching tiers, or the stripper-with-gauge tool */
  stripReadout: boolean;
  stripTarget: number; // inches
};

export function generateWireup(seed: number, tier: number, tools: string[] = [], job?: string): WireModel {
  const r = rng(seed);
  const t = Math.max(0, tier);
  const byTier: WireModel['device'] = t <= 1 ? 'receptacle' : t === 2 ? (r.chance(0.5) ? 'switch3' : 'receptacle') : t === 3 ? r.pick(['passthrough', 'switch3'] as const) : t === 4 ? 'gfci' : 'switch3src';
  // the job decides the device: a GFCI job is a GFCI, a 3-way job is a 3-way
  const device: WireModel['device'] = job === 'gfci' ? 'gfci' : job === 'switch3' ? (t >= 5 ? 'switch3src' : 'switch3') : byTier;
  const labels = t <= 2;
  let terms: Term[] = [];
  let wires: Wire[] = [];
  let cables: WireModel['cables'] = [];
  let title = '';
  if (device === 'receptacle' || device === 'passthrough') {
    title = device === 'receptacle' ? 'Duplex receptacle' : 'Receptacle, power passing through';
    terms = [
      { id: 'b1', label: 'HOT', color: 'brass', x: 0.72, y: 0.36 },
      { id: 'b2', label: 'HOT', color: 'brass', x: 0.72, y: 0.62 },
      { id: 's1', label: 'NEU', color: 'silver', x: 0.28, y: 0.36 },
      { id: 's2', label: 'NEU', color: 'silver', x: 0.28, y: 0.62 },
      { id: 'g', label: 'GND', color: 'green', x: 0.5, y: 0.84, multi: true },
    ];
    cables = [{ id: 'A', label: device === 'passthrough' ? 'from panel' : 'from panel', x: 0.35 }];
    wires = [
      { id: 'A-blk', color: 'black', cable: 'A', target: ['b1', 'b2'], label: 'black' },
      { id: 'A-wht', color: 'white', cable: 'A', target: ['s1', 's2'], label: 'white' },
      { id: 'A-gnd', color: 'bare', cable: 'A', target: ['g'], label: 'bare' },
    ];
    if (device === 'passthrough') {
      cables.push({ id: 'B', label: 'to next outlet', x: 0.65 });
      wires.push(
        { id: 'B-blk', color: 'black', cable: 'B', target: ['b1', 'b2'], label: 'black' },
        { id: 'B-wht', color: 'white', cable: 'B', target: ['s1', 's2'], label: 'white' },
        { id: 'B-gnd', color: 'bare', cable: 'B', target: ['g'], label: 'bare' },
      );
    }
  } else if (device === 'switch3') {
    title = '3-way switch (switch loop end)';
    terms = [
      { id: 'com', label: 'COM', color: 'dark', x: 0.28, y: 0.62, stamp: 'COMMON' },
      { id: 't1', label: 'T1', color: 'brass', x: 0.72, y: 0.36 },
      { id: 't2', label: 'T2', color: 'brass', x: 0.72, y: 0.62 },
      { id: 'g', label: 'GND', color: 'green', x: 0.5, y: 0.84, multi: true },
    ];
    cables = [{ id: 'A', label: '12/3 from other switch', x: 0.5 }];
    wires = [
      { id: 'A-blk', color: 'black', cable: 'A', target: ['com'], label: 'black (common)' },
      { id: 'A-red', color: 'red', cable: 'A', target: ['t1', 't2'], label: 'red (traveler)' },
      { id: 'A-wht', color: 'white', cable: 'A', target: ['t1', 't2'], label: 'white, taped black (traveler)' },
      { id: 'A-gnd', color: 'bare', cable: 'A', target: ['g'], label: 'bare' },
    ];
  } else if (device === 'gfci') {
    title = 'GFCI receptacle, protecting downstream';
    terms = [
      { id: 'lh', label: 'LINE HOT', color: 'brass', x: 0.72, y: 0.66, stamp: 'LINE' },
      { id: 'ln', label: 'LINE NEU', color: 'silver', x: 0.28, y: 0.66, stamp: 'LINE' },
      { id: 'dh', label: 'LOAD HOT', color: 'brass', x: 0.72, y: 0.34, stamp: 'LOAD' },
      { id: 'dn', label: 'LOAD NEU', color: 'silver', x: 0.28, y: 0.34, stamp: 'LOAD' },
      { id: 'g', label: 'GND', color: 'green', x: 0.5, y: 0.86, multi: true },
    ];
    // real devices: LINE at the bottom; LOAD under the yellow tape at the top
    const swap = r.chance(0.5);
    cables = [
      { id: 'A', label: 'cable A', x: swap ? 0.65 : 0.35 },
      { id: 'B', label: 'cable B', x: swap ? 0.35 : 0.65 },
    ];
    const src = r.pick(['A', 'B']);
    const dn = src === 'A' ? 'B' : 'A';
    cables.find((c) => c.id === src)!.label = t <= 2 ? 'from panel' : 'reads 120 V';
    cables.find((c) => c.id === dn)!.label = t <= 2 ? 'to bath outlet' : 'reads 0 V';
    wires = [
      { id: `${src}-blk`, color: 'black', cable: src, target: ['lh'], label: 'black' },
      { id: `${src}-wht`, color: 'white', cable: src, target: ['ln'], label: 'white' },
      { id: `${dn}-blk`, color: 'black', cable: dn, target: ['dh'], label: 'black' },
      { id: `${dn}-wht`, color: 'white', cable: dn, target: ['dn'], label: 'white' },
      { id: `${src}-gnd`, color: 'bare', cable: src, target: ['g'], label: 'bare' },
      { id: `${dn}-gnd`, color: 'bare', cable: dn, target: ['g'], label: 'bare' },
    ];
  } else {
    title = '3-way switch at the source';
    terms = [
      { id: 'com', label: 'COM', color: 'dark', x: 0.28, y: 0.62, stamp: 'COMMON' },
      { id: 't1', label: 'T1', color: 'brass', x: 0.72, y: 0.36 },
      { id: 't2', label: 'T2', color: 'brass', x: 0.72, y: 0.62 },
      { id: 'nut', label: 'wire nut', color: 'nut', x: 0.5, y: 0.2, multi: true },
      { id: 'g', label: 'GND', color: 'green', x: 0.5, y: 0.86, multi: true },
    ];
    cables = [
      { id: 'S', label: '12/2 from panel', x: 0.3 },
      { id: 'T', label: '12/3 to other switch', x: 0.7 },
    ];
    wires = [
      { id: 'S-blk', color: 'black', cable: 'S', target: ['com'], label: 'black (source hot)' },
      { id: 'S-wht', color: 'white', cable: 'S', target: ['nut'], label: 'white (neutral)' },
      { id: 'T-blk', color: 'black', cable: 'T', target: ['t1', 't2'], label: 'black (traveler)' },
      { id: 'T-red', color: 'red', cable: 'T', target: ['t1', 't2'], label: 'red (traveler)' },
      { id: 'T-wht', color: 'white', cable: 'T', target: ['nut'], label: 'white (neutral to light)' },
      { id: 'S-gnd', color: 'bare', cable: 'S', target: ['g'], label: 'bare' },
      { id: 'T-gnd', color: 'bare', cable: 'T', target: ['g'], label: 'bare' },
    ];
  }
  return {
    device,
    title,
    terms,
    wires: r.shuffle(wires),
    cables,
    labels,
    stamps: !labels && tools.includes('labelMaker'),
    stripReadout: t <= 2 || tools.includes('torqueScrewdriver'),
    stripTarget: 0.75,
  };
}

export type Landing = { wire: string; term: string; strip: number; cw: boolean | null };

export function scoreWireup(m: WireModel, landed: Landing[]) {
  let total = 0;
  let wrong = 0;
  let exposed = 0;
  let hooks = 0;
  const used = new Map<string, number>();
  for (const l of landed) used.set(l.term, (used.get(l.term) ?? 0) + 1);
  for (const w of m.wires) {
    const l = landed.find((x) => x.wire === w.id);
    if (!l) continue;
    const term = m.terms.find((t) => t.id === l.term)!;
    const correct = w.target.includes(l.term) && (term.multi || (used.get(l.term) ?? 0) <= 1);
    if (!correct) {
      wrong++;
      continue;
    }
    let v = 0.6;
    const stripOk = Math.abs(l.strip - m.stripTarget) <= 0.2;
    if (l.strip > m.stripTarget + 0.2) exposed++;
    if (stripOk) v += 0.25;
    if (term.color === 'nut') v += 0.15; // splices twist, no hook
    else if (l.cw) v += 0.15;
    else hooks++;
    total += v;
  }
  // reversed polarity (hot on silver, neutral on brass) is a real hazard: zero both
  const score = clamp(total / m.wires.length, 0, 1);
  return { score, wrong, exposed, hooks, landed: landed.length };
}

const WIRE_FILL: Record<Wire['color'], string> = { black: '#1f2a30', white: '#f7f3ea', bare: '#c98a4b', red: '#9b3b45' };
const SCREW: Record<Term['color'], string> = { brass: '#c9a86a', silver: '#cfd8d8', green: '#4e8a5a', dark: '#3b464b', nut: '#f4d35e' };

export const wireup: PuzzleDef = {
  id: 'wireup',
  role: 'elec',
  title: 'Wire-up',
  gesture: 'Tap-and-swipe to strip, twist, land',
  howTo: 'Swipe to strip 3/4 in, then drag each wire to its screw.',
  term: 'Brass = hot, silver = neutral, green = ground. Hook clockwise so tightening closes the loop.',
  seconds: (tier) => 70 + tier * 10,
  mount(host, p) {
    const m = generateWireup(p.seed, p.tier, p.tools, p.context?.job);
    const st = stage(host.el);
    const { ctx } = st;
    const strip = new Map<string, number>(); // inches stripped
    const landed: Landing[] = [];
    let active: string | null = null; // selected wire
    let gesture: { kind: 'strip' | 'land'; wire: string; sx: number; sy: number; path: { x: number; y: number }[] } | null = null;
    let finished = false;
    let flash = 0;

    const geo = () => {
      const w = st.w;
      const h = st.h;
      const box = { x: w * 0.12, y: 84, w: w * 0.76, h: h * 0.4 };
      const tray = { x: 12, y: box.y + box.h + 24, w: w - 24, h: h - (box.y + box.h + 24) - 74 };
      return { w, h, box, tray };
    };
    const termPos = (t: Term) => {
      const { box } = geo();
      return { x: box.x + t.x * box.w, y: box.y + t.y * box.h };
    };
    const free = () => m.wires.filter((w) => !landed.some((l) => l.wire === w.id));
    const wireRow = (i: number) => {
      const { tray } = geo();
      const rh = Math.min(56, tray.h / Math.max(3, free().length));
      return { x: tray.x, y: tray.y + i * rh, w: tray.w, h: rh - 6 };
    };
    const stripZone = (r: { x: number; y: number; w: number; h: number }) => ({ x: r.x + r.w - 150, y: r.y, w: 140, h: r.h });
    const PX_PER_IN = 80;

    const status = () => {
      const n = landed.length;
      host.status(`${n}/${m.wires.length} landed · strip to 3/4 in${active ? ` · ${m.wires.find((w) => w.id === active)!.label}` : ''}`);
    };
    status();

    const offPtr = pointer(st.canvas, {
      down(pt) {
        if (finished || host.paused()) return;
        const g = geo();
        if (landed.length === m.wires.length && pt.y > g.h - 64) return finish();
        const list = free();
        for (let i = 0; i < list.length; i++) {
          const r = wireRow(i);
          if (pt.y >= r.y && pt.y <= r.y + r.h && pt.x >= r.x && pt.x <= r.x + r.w) {
            const wz = stripZone(r);
            active = list[i].id;
            if (pt.x >= wz.x) gesture = { kind: 'strip', wire: list[i].id, sx: pt.x, sy: pt.y, path: [] };
            else gesture = { kind: 'land', wire: list[i].id, sx: pt.x, sy: pt.y, path: [{ x: pt.x, y: pt.y }] };
            host.fx.tap();
            status();
            return;
          }
        }
      },
      move(pt) {
        if (!gesture || finished) return;
        if (gesture.kind === 'strip') {
          // swipe from the tip (right) toward the jacket (left): length = distance
          const len = clamp((gesture.sx - pt.x) / PX_PER_IN, 0, 1.6);
          const prev = strip.get(gesture.wire) ?? 0;
          if (len > prev) {
            strip.set(gesture.wire, Math.round(len * 16) / 16);
            if (Math.floor(len * 8) !== Math.floor(prev * 8)) host.fx.tick();
          }
        } else {
          gesture.path.push({ x: pt.x, y: pt.y });
          if (gesture.path.length > 60) gesture.path.shift();
        }
      },
      up(pt) {
        const gsx = gesture;
        gesture = null;
        if (!gsx || finished) return;
        if (gsx.kind === 'strip') {
          const s = strip.get(gsx.wire) ?? 0;
          if (s > 0) (!m.stripReadout || Math.abs(s - m.stripTarget) <= 0.2 ? host.fx.snap : host.fx.bad)();
          return;
        }
        // landing: nearest terminal to the release point
        let best: Term | null = null;
        let bd = Infinity;
        for (const t of m.terms) {
          const tp = termPos(t);
          const d = Math.hypot(tp.x - pt.x, tp.y - pt.y);
          if (d < bd) {
            bd = d;
            best = t;
          }
        }
        if (!best || bd > 46) return;
        const s = strip.get(gsx.wire) ?? 0;
        if (s < 0.25) {
          host.fx.bad(); // insulation still on: no contact
          return;
        }
        if (!best.multi && landed.some((l) => l.term === best!.id)) {
          host.fx.bad(); // one conductor per screw terminal
          return;
        }
        // hook direction: winding of the last part of the path around the screw
        const tp = termPos(best);
        let wind = 0;
        const path = gsx.path.slice(-24);
        for (let i = 1; i < path.length; i++) {
          const a1 = Math.atan2(path[i - 1].y - tp.y, path[i - 1].x - tp.x);
          const a2 = Math.atan2(path[i].y - tp.y, path[i].x - tp.x);
          let d = a2 - a1;
          if (d > Math.PI) d -= Math.PI * 2;
          if (d < -Math.PI) d += Math.PI * 2;
          wind += d;
        }
        const cw = Math.abs(wind) < 0.6 ? null : wind > 0; // screen coords: positive = clockwise
        landed.push({ wire: gsx.wire, term: best.id, strip: s, cw });
        active = null;
        host.fx.snap();
        status();
      },
    });

    const stop = loop(() => draw());

    function drawWire(w: Wire, x1: number, y1: number, x2: number, y2: number, stripped: number) {
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      if (w.color === 'white') {
        ctx.lineWidth = 11;
        ctx.strokeStyle = '#a79f90';
        ctx.stroke();
      }
      ctx.lineWidth = w.color === 'bare' ? 5 : 9;
      ctx.strokeStyle = WIRE_FILL[w.color];
      ctx.stroke();
      if (stripped > 0 && w.color !== 'bare') {
        const len = Math.hypot(x2 - x1, y2 - y1);
        const f = Math.min(1, (stripped * PX_PER_IN * 0.5) / len);
        ctx.lineWidth = 4;
        ctx.strokeStyle = WIRE_FILL.bare;
        ctx.beginPath();
        ctx.moveTo(x2 - (x2 - x1) * f, y2 - (y2 - y1) * f);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    }

    function draw() {
      const g = geo();
      backdrop(ctx, g.w, g.h);
      label(ctx, m.title, 14, 20, { size: 14, weight: 800, align: 'left' });
      // box
      roundRect(ctx, g.box.x, g.box.y, g.box.w, g.box.h, 10);
      ctx.fillStyle = '#9aa5a9';
      ctx.fill();
      roundRect(ctx, g.box.x + 8, g.box.y + 8, g.box.w - 16, g.box.h - 16, 8);
      ctx.fillStyle = '#6b767b';
      ctx.fill();
      // device yoke
      roundRect(ctx, g.box.x + g.box.w * 0.34, g.box.y + g.box.h * 0.14, g.box.w * 0.32, g.box.h * 0.72, 8);
      ctx.fillStyle = m.device === 'gfci' ? '#f7f3ea' : '#efe8da';
      ctx.fill();
      if (m.device === 'gfci') {
        ctx.fillStyle = C.elec; // yellow tape over LOAD, as shipped
        ctx.fillRect(g.box.x + g.box.w * 0.62, g.box.y + g.box.h * 0.26, 14, g.box.h * 0.16);
      }
      // cables entering from the top
      for (const c of m.cables) {
        const x = g.box.x + c.x * g.box.w;
        roundRect(ctx, x - 10, g.box.y - 30, 20, 40, 6);
        ctx.fillStyle = '#e8e0cf';
        ctx.fill();
        label(ctx, c.label, x, g.box.y - 40, { size: 11, weight: 800, color: C.ink });
      }
      // terminals
      for (const t of m.terms) {
        const tp = termPos(t);
        if (t.color === 'nut') {
          ctx.fillStyle = SCREW.nut;
          ctx.beginPath();
          ctx.moveTo(tp.x - 12, tp.y + 10);
          ctx.lineTo(tp.x + 12, tp.y + 10);
          ctx.lineTo(tp.x + 6, tp.y - 12);
          ctx.lineTo(tp.x - 6, tp.y - 12);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.fillStyle = SCREW[t.color];
          ctx.beginPath();
          ctx.arc(tp.x, tp.y, 11, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(31,42,48,.5)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(tp.x - 6, tp.y);
          ctx.lineTo(tp.x + 6, tp.y);
          ctx.stroke();
        }
        const txt = m.labels ? t.label : m.stamps ? t.stamp : undefined;
        if (txt) label(ctx, txt, tp.x + (t.x < 0.5 ? -16 : 16), tp.y + (t.color === 'nut' ? 18 : 0), { size: 9, weight: 900, color: C.paper, align: t.x < 0.5 ? 'right' : 'left' });
      }
      // landed wires
      for (const l of landed) {
        const w = m.wires.find((x) => x.id === l.wire)!;
        const t = m.terms.find((x) => x.id === l.term)!;
        const c = m.cables.find((x) => x.id === w.cable)!;
        const tp = termPos(t);
        const cx = g.box.x + c.x * g.box.w;
        drawWire(w, cx, g.box.y + 6, tp.x, tp.y, 0);
        // the hook
        if (t.color !== 'nut') {
          ctx.strokeStyle = WIRE_FILL.bare;
          ctx.lineWidth = 3;
          ctx.beginPath();
          const cwDir = l.cw !== false;
          ctx.arc(tp.x, tp.y, 13, cwDir ? -2.4 : 0.8, cwDir ? 0.8 : -2.4, !cwDir);
          ctx.stroke();
        }
        const exposed = l.strip > m.stripTarget + 0.2;
        const wrong = finished && !w.target.includes(l.term);
        if (exposed || wrong) {
          ctx.strokeStyle = C.rust;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(tp.x, tp.y, 17, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      // wire tray
      label(ctx, 'Swipe a tip left to strip (gauge 3/4 in), drag the wire to a screw', 14, g.tray.y - 10, { size: 10, weight: 700, color: C.inkSoft, align: 'left' });
      free().forEach((w, i) => {
        const r = wireRow(i);
        roundRect(ctx, r.x, r.y, r.w, r.h, 10);
        ctx.fillStyle = active === w.id ? 'rgba(46,124,147,.14)' : C.paper;
        ctx.fill();
        const s = strip.get(w.id) ?? 0;
        drawWire(w, r.x + 70, r.y + r.h / 2, r.x + r.w - 14, r.y + r.h / 2, s);
        label(ctx, w.cable, r.x + 14, r.y + r.h / 2 - 8, { size: 10, weight: 900, color: C.inkSoft, align: 'left' });
        label(ctx, w.label.split(' ')[0], r.x + 14, r.y + r.h / 2 + 8, { size: 11, weight: 800, align: 'left' });
        const z = stripZone(r);
        ctx.strokeStyle = 'rgba(31,42,48,.15)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(z.x, z.y + 2, z.w, z.h - 4);
        ctx.setLineDash([]);
        label(ctx, s ? (m.stripReadout ? `${s.toFixed(2)} in` : 'stripped') : 'strip ←', z.x + 30, r.y + 10, {
          size: 10,
          weight: 800,
          color: s ? (!m.stripReadout ? C.inkSoft : Math.abs(s - m.stripTarget) <= 0.2 ? C.palm : s > m.stripTarget ? C.rust : C.inkSoft) : C.sea,
        });
      });
      if (gesture && gesture.kind === 'land' && gesture.path.length) {
        const last = gesture.path[gesture.path.length - 1];
        const w = m.wires.find((x) => x.id === gesture!.wire)!;
        drawWire(w, gesture.sx, gesture.sy, last.x, last.y, strip.get(w.id) ?? 0);
      }
      if (landed.length === m.wires.length) {
        roundRect(ctx, g.w / 2 - 110, g.h - 60, 220, 48, 24);
        ctx.fillStyle = finished ? 'rgba(31,42,48,.2)' : C.sea;
        ctx.fill();
        label(ctx, finished ? 'Tested' : 'Fold in + test', g.w / 2, g.h - 36, { size: 16, weight: 800, color: C.white });
      }
      if (flash) {
        const t = clamp((performance.now() - flash) / 700, 0, 1);
        ctx.globalAlpha = 0.25 * (1 - t);
        ctx.fillStyle = C.elec;
        ctx.fillRect(0, 0, g.w, g.h);
        ctx.globalAlpha = 1;
      }
    }

    function makeResult(): PuzzleResult {
      const s = scoreWireup(m, landed);
      const parts = [`${landed.length - s.wrong}/${m.wires.length} on the right terminal`];
      if (s.wrong) parts.push(`${s.wrong} miswired`);
      if (s.exposed) parts.push(`${s.exposed} exposed copper`);
      if (s.hooks) parts.push(`${s.hooks} hook${s.hooks > 1 ? 's' : ''} not clockwise`);
      return result(s.score, parts.join(', '));
    }
    function finish() {
      if (finished) return;
      finished = true;
      const res = makeResult();
      if (res.perfect) {
        flash = performance.now();
        host.fx.flourish();
      } else host.fx.good();
      setTimeout(() => host.done(res), res.perfect ? 900 : 500);
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
