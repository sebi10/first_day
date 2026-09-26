// Electrician · Panel load. A split-phase 120/240 V panel: rows alternate
// legs (L1, L2), a 240 V load is a double-pole breaker straddling two rows.
// Place every circuit so neither leg exceeds the service limit, balanced.
// Tiers 0–2 hand you sized breakers in amps with live leg totals. From tier
// 3 you size the breaker to the wire (14→15 A, 12→20 A, 10→30 A, 8→40 A,
// 6→50 A) and do the load math yourself; from tier 4 loads come in watts.
import { rng } from '../sim/rng';
import { C, backdrop, clamp, label, loop, pointer, roundRect, stage } from './kit';
import { result, type PuzzleDef, type PuzzleResult } from './types';

export const AMPACITY: Record<number, number> = { 14: 15, 12: 20, 10: 30, 8: 40, 6: 50 };
export const SIZES = [15, 20, 30, 40, 50];

export type Circuit = {
  id: number;
  name: string;
  volts: 120 | 240;
  amps: number; // running load per leg
  watts: number;
  awg: number;
  breaker: number; // correct breaker
};

export type PanelModel = {
  rows: number; // per column
  limit: number; // per-leg service limit in amps
  circuits: Circuit[];
  sizing: boolean; // player picks breaker size (tier >= 3)
  wattsOnly: boolean; // loads shown in watts (tier >= 4)
  liveTotals: boolean; // teaching tiers show leg totals
};

const LOADS_120 = [
  { name: 'Kitchen counter', awg: 12, lo: 900, hi: 1700 },
  { name: 'Bath GFCI', awg: 12, lo: 700, hi: 1500 },
  { name: 'Bedroom lights', awg: 14, lo: 200, hi: 600 },
  { name: 'Living room', awg: 14, lo: 400, hi: 1100 },
  { name: 'Fridge', awg: 12, lo: 600, hi: 900 },
  { name: 'Microwave', awg: 12, lo: 1000, hi: 1500 },
  { name: 'Porch + deck', awg: 14, lo: 150, hi: 500 },
  { name: 'Laundry', awg: 12, lo: 700, hi: 1400 },
  { name: 'Dishwasher', awg: 12, lo: 900, hi: 1400 },
  { name: 'Hot tub pump', awg: 12, lo: 1000, hi: 1600 },
];
const LOADS_240 = [
  { name: 'Water heater', awg: 10, lo: 3800, hi: 4500 },
  { name: 'Mini-split A/C', awg: 12, lo: 1800, hi: 3000 },
  { name: 'Range', awg: 6, lo: 6000, hi: 8000 },
  { name: 'Dryer', awg: 10, lo: 4000, hi: 5200 },
  { name: 'Hot tub heater', awg: 8, lo: 5000, hi: 6500 },
];

export function generatePanel(seed: number, tier: number, _tools: string[] = []): PanelModel {
  const r = rng(seed);
  const n120 = tier <= 0 ? 3 : tier <= 2 ? 4 + tier : tier === 3 ? 6 : tier === 4 ? 7 : 8;
  const n240 = tier <= 0 ? 1 : tier <= 2 ? 1 : tier <= 4 ? 2 : 3;
  const circuits: Circuit[] = [];
  let id = 0;
  for (const c of r.shuffle([...LOADS_120]).slice(0, n120)) {
    const watts = Math.round(r.range(c.lo, c.hi) / 10) * 10;
    circuits.push({ id: id++, name: c.name, volts: 120, watts, amps: +(watts / 120).toFixed(1), awg: c.awg, breaker: AMPACITY[c.awg] });
  }
  for (const c of r.shuffle([...LOADS_240]).slice(0, n240)) {
    const watts = Math.round(r.range(c.lo, c.hi) / 100) * 100;
    circuits.push({ id: id++, name: c.name, volts: 240, watts, amps: +(watts / 240).toFixed(1), awg: c.awg, breaker: AMPACITY[c.awg] });
  }
  const slotsNeeded = circuits.reduce((n, c) => n + (c.volts === 240 ? 2 : 1), 0);
  const rows = Math.max(4, Math.ceil((slotsNeeded + 2) / 2) + (tier >= 4 ? 0 : 1));
  // best achievable balance (greedy): 240 V loads hit both legs equally
  const both = circuits.filter((c) => c.volts === 240).reduce((n, c) => n + c.amps, 0);
  let l1 = both;
  let l2 = both;
  for (const c of circuits.filter((x) => x.volts === 120).sort((a, b) => b.amps - a.amps)) {
    if (l1 <= l2) l1 += c.amps;
    else l2 += c.amps;
  }
  const margin = [1.12, 1.1, 1.08, 1.06, 1.05, 1.04][clamp(tier, 0, 5)];
  const limit = Math.ceil((Math.max(l1, l2) * margin) / 5) * 5;
  return { rows, limit, circuits: r.shuffle(circuits), sizing: tier >= 3, wattsOnly: tier >= 4, liveTotals: tier <= 2 };
}

/** slot index: col*rows + row. Row parity decides the leg: even row = L1, odd row = L2. */
export const legOf = (row: number) => (row % 2 === 0 ? 1 : 2);

export type Placement = { circuit: number; col: number; row: number; breaker: number };

export function legLoads(m: PanelModel, placed: Placement[]) {
  let l1 = 0;
  let l2 = 0;
  for (const p of placed) {
    const c = m.circuits.find((x) => x.id === p.circuit)!;
    if (c.volts === 240) {
      l1 += c.amps;
      l2 += c.amps;
    } else if (legOf(p.row) === 1) l1 += c.amps;
    else l2 += c.amps;
  }
  return { l1: +l1.toFixed(1), l2: +l2.toFixed(1) };
}

export function scorePanel(m: PanelModel, placed: Placement[]) {
  const { l1, l2 } = legLoads(m, placed);
  const over = (l1 > m.limit ? 1 : 0) + (l2 > m.limit ? 1 : 0);
  const imbalance = Math.abs(l1 - l2) / m.limit;
  let oversize = 0;
  let undersize = 0;
  for (const p of placed) {
    const c = m.circuits.find((x) => x.id === p.circuit)!;
    if (p.breaker > c.breaker) oversize++; // breaker bigger than the wire: fire risk
    else if (p.breaker < c.breaker && p.breaker < c.amps * 1.25) undersize++; // nuisance trips
  }
  const missing = m.circuits.length - placed.length;
  const v = 1 - 0.3 * over - Math.min(0.3, Math.max(0, imbalance - 0.05) * 1.5) - 0.25 * oversize - 0.1 * undersize - 0.15 * missing;
  return { score: clamp(v, 0, 1), l1, l2, over, oversize, undersize, missing, imbalance };
}

export const panel: PuzzleDef = {
  id: 'panel',
  role: 'elec',
  title: 'Panel load',
  gesture: 'Drag breakers onto bus',
  howTo: 'Place every breaker; keep both legs under the limit.',
  term: 'Split-phase: two 120 V legs. 240 V loads draw from both. Breaker protects the wire.',
  seconds: (tier) => 70 + tier * 10,
  mount(host, p) {
    const m = generatePanel(p.seed, p.tier, p.tools);
    const clampMeter = p.tools.includes('clampMeter');
    const st = stage(host.el);
    const { ctx } = st;
    const placed: Placement[] = [];
    const chosen = new Map<number, number>(m.circuits.map((c) => [c.id, m.sizing ? 20 : c.breaker]));
    let drag: { id: number; x: number; y: number } | null = null;
    let finished = false;
    let energized = 0;
    let trayScroll = 0;

    const geo = () => {
      const w = st.w;
      const h = st.h;
      const cardH = 64;
      const pw = Math.min(w - 56, 320);
      const px = (w - pw) / 2;
      const py = 46;
      const trayY = h - 64 - cardH - 34; // circuits sit in the thumb zone, above the main switch
      const slotH = clamp((trayY - py - 40) / m.rows, 30, 50);
      const ph = slotH * m.rows + 20;
      return { w, h, px, py, pw, ph, slotH, colW: (pw - 40) / 2, trayY, cardW: 150, cardH };
    };
    const slotRect = (col: number, row: number) => {
      const g = geo();
      return { x: g.px + 10 + col * (g.colW + 20), y: g.py + 10 + row * g.slotH, w: g.colW, h: g.slotH - 4 };
    };
    const occupied = (col: number, row: number) =>
      placed.some((pl) => pl.col === col && (pl.row === row || (m.circuits.find((c) => c.id === pl.circuit)!.volts === 240 && pl.row + 1 === row)));
    const unplaced = () => m.circuits.filter((c) => !placed.some((pl) => pl.circuit === c.id));
    const cardRect = (i: number) => {
      const g = geo();
      return { x: 16 + i * (g.cardW + 10) - trayScroll, y: g.trayY + 22, w: g.cardW, h: g.cardH };
    };
    const hit = (x: number, y: number, r: { x: number; y: number; w: number; h: number }) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
    const loadText = (c: Circuit) => (m.wattsOnly ? `${c.watts.toLocaleString('en-US')} W · ${c.volts} V` : `${c.amps} A · ${c.volts} V`);

    const status = () => {
      const { l1, l2 } = legLoads(m, placed);
      const showTotals = m.liveTotals || clampMeter;
      host.status(showTotals ? `L1 ${l1} A · L2 ${l2} A · limit ${m.limit} A per leg` : `Limit ${m.limit} A per leg · ${placed.length}/${m.circuits.length} placed`);
    };
    status();

    let dragStart: { x: number; y: number; id: number; moved: boolean; scroll: number; sx: number } | null = null;
    const offPtr = pointer(st.canvas, {
      down(pt) {
        if (finished || host.paused()) return;
        const g = geo();
        if (placed.length === m.circuits.length && pt.y > g.h - 64) return energize();
        // tap a placed breaker: pull it back to the tray
        for (const pl of [...placed]) {
          const c = m.circuits.find((x) => x.id === pl.circuit)!;
          const r = slotRect(pl.col, pl.row);
          const rr = { ...r, h: c.volts === 240 ? r.h * 2 + 4 : r.h };
          if (hit(pt.x, pt.y, rr)) {
            placed.splice(placed.indexOf(pl), 1);
            host.fx.thunk();
            drag = { id: c.id, x: pt.x, y: pt.y };
            status();
            return;
          }
        }
        const list = unplaced();
        for (let i = 0; i < list.length; i++) {
          const r = cardRect(i);
          if (hit(pt.x, pt.y, r)) {
            dragStart = { x: pt.x, y: pt.y, id: list[i].id, moved: false, scroll: trayScroll, sx: pt.x };
            return;
          }
        }
        if (pt.y > g.trayY) dragStart = { x: pt.x, y: pt.y, id: -1, moved: false, scroll: trayScroll, sx: pt.x };
      },
      move(pt) {
        if (drag) {
          drag.x = pt.x;
          drag.y = pt.y;
          return;
        }
        if (!dragStart) return;
        const dy = pt.y - dragStart.y;
        const dx = pt.x - dragStart.sx;
        if (!dragStart.moved && Math.hypot(dx, dy) > 8) {
          dragStart.moved = true;
          if (dragStart.id >= 0 && dy < -6 && Math.abs(dy) > Math.abs(dx) * 0.6) drag = { id: dragStart.id, x: pt.x, y: pt.y };
        }
        if (dragStart.moved && !drag) {
          const g = geo();
          const max = Math.max(0, unplaced().length * (g.cardW + 10) - (g.w - 32));
          trayScroll = clamp(dragStart.scroll - dx, 0, max);
        }
      },
      up(pt) {
        const ds = dragStart;
        dragStart = null;
        if (!drag) {
          // tap on a card with sizing: cycle the breaker size
          if (ds && !ds.moved && ds.id >= 0 && m.sizing) {
            const cur = chosen.get(ds.id)!;
            chosen.set(ds.id, SIZES[(SIZES.indexOf(cur) + 1) % SIZES.length]);
            host.fx.tick();
          }
          return;
        }
        const d = drag;
        drag = null;
        const c = m.circuits.find((x) => x.id === d.id)!;
        for (let col = 0; col < 2; col++) {
          for (let row = 0; row < m.rows; row++) {
            if (!hit(pt.x, pt.y, slotRect(col, row))) continue;
            const needTwo = c.volts === 240;
            if (occupied(col, row) || (needTwo && (row + 1 >= m.rows || occupied(col, row + 1)))) {
              host.fx.bad();
              return;
            }
            placed.push({ circuit: c.id, col, row, breaker: chosen.get(c.id)! });
            host.fx.thunk();
            status();
            return;
          }
        }
        status();
      },
    });

    const stop = loop(() => draw());

    function drawBreaker(c: Circuit, r: { x: number; y: number; w: number; h: number }, size: number, lit: boolean) {
      roundRect(ctx, r.x, r.y, r.w, r.h, 6);
      ctx.fillStyle = lit ? '#2b363b' : C.ink;
      ctx.fill();
      ctx.fillStyle = lit ? C.elec : '#56646b';
      ctx.fillRect(r.x + 6, r.y + r.h / 2 - 3, 14, 6);
      label(ctx, c.name, r.x + 26, r.y + r.h / 2 - (r.h > 40 ? 7 : 0), { size: 10, weight: 800, color: C.paper, align: 'left' });
      label(ctx, `${size}A${c.volts === 240 ? ' 2P' : ''}`, r.x + r.w - 6, r.y + r.h / 2, { size: 10, weight: 900, color: C.elec, align: 'right' });
      if (r.h > 40) label(ctx, loadText(c), r.x + 26, r.y + r.h / 2 + 9, { size: 9, color: C.paper, align: 'left' });
    }

    function draw() {
      const g = geo();
      backdrop(ctx, g.w, g.h);
      label(ctx, `Main panel · ${m.limit} A per leg`, 16, 22, { size: 14, weight: 800, align: 'left' });
      // panel box + bus
      roundRect(ctx, g.px, g.py, g.pw, g.ph, 12);
      ctx.fillStyle = '#9aa5a9';
      ctx.fill();
      ctx.fillStyle = '#7f8b90';
      ctx.fillRect(g.px + g.pw / 2 - 6, g.py + 8, 12, g.ph - 16);
      for (let row = 0; row < m.rows; row++) {
        const leg = legOf(row);
        label(ctx, `L${leg}`, g.px + g.pw / 2, g.py + 10 + row * g.slotH + (g.slotH - 4) / 2, { size: 8, weight: 900, color: leg === 1 ? C.ink : C.paper });
        for (let col = 0; col < 2; col++) {
          const r = slotRect(col, row);
          roundRect(ctx, r.x, r.y, r.w, r.h, 6);
          ctx.fillStyle = 'rgba(31,42,48,.14)';
          ctx.fill();
        }
      }
      const { l1, l2 } = legLoads(m, placed);
      const trips = finished ? { 1: l1 > m.limit, 2: l2 > m.limit } : { 1: false, 2: false };
      for (const pl of placed) {
        const c = m.circuits.find((x) => x.id === pl.circuit)!;
        const r = slotRect(pl.col, pl.row);
        const rr = { ...r, h: c.volts === 240 ? r.h * 2 + 4 : r.h };
        const leg = legOf(pl.row);
        const lit = energized > 0 && !(c.volts === 240 ? trips[1] || trips[2] : trips[leg as 1 | 2]);
        drawBreaker(c, rr, pl.breaker, lit);
        if (finished && pl.breaker > c.breaker) {
          ctx.strokeStyle = C.rust;
          ctx.lineWidth = 3;
          roundRect(ctx, rr.x, rr.y, rr.w, rr.h, 6);
          ctx.stroke();
        }
      }
      // leg meters (teaching tiers or clamp meter)
      if (m.liveTotals || clampMeter || finished) {
        const drawMeter = (leg: 1 | 2, v: number, x: number) => {
          const w = 10;
          const top = g.py + 6;
          const h = g.ph - 12;
          roundRect(ctx, x, top, w, h, 5);
          ctx.fillStyle = 'rgba(31,42,48,.12)';
          ctx.fill();
          const f = clamp(v / (m.limit * 1.2), 0, 1);
          roundRect(ctx, x, top + h * (1 - f), w, h * f, 5);
          ctx.fillStyle = v > m.limit ? C.rust : C.palm;
          ctx.fill();
          const ly = top + h * (1 - m.limit / (m.limit * 1.2));
          ctx.fillStyle = C.ink;
          ctx.fillRect(x - 3, ly, w + 6, 2);
          label(ctx, `L${leg}`, x + w / 2, top - 8, { size: 9, weight: 900 });
          label(ctx, `${v}`, x + w / 2, top + h + 10, { size: 9, weight: 800 });
        };
        drawMeter(1, l1, g.px - 18);
        drawMeter(2, l2, g.px + g.pw + 8);
      }
      // tray
      label(ctx, m.sizing ? 'Circuits · tap to size, drag up to install' : 'Circuits · drag up to install', 16, g.trayY + 8, { size: 11, weight: 700, color: C.inkSoft, align: 'left' });
      unplaced().forEach((c, i) => {
        if (drag && drag.id === c.id) return;
        const r = cardRect(i);
        roundRect(ctx, r.x, r.y, r.w, r.h, 12);
        ctx.fillStyle = C.paper;
        ctx.fill();
        ctx.strokeStyle = c.volts === 240 ? C.elec : 'rgba(31,42,48,.15)';
        ctx.lineWidth = c.volts === 240 ? 3 : 1;
        ctx.stroke();
        label(ctx, c.name, r.x + 10, r.y + 16, { size: 12, weight: 800, align: 'left' });
        label(ctx, loadText(c), r.x + 10, r.y + 34, { size: 11, align: 'left', color: C.inkSoft });
        label(ctx, `${c.awg} AWG`, r.x + 10, r.y + 51, { size: 11, align: 'left', color: C.inkSoft, weight: 700 });
        roundRect(ctx, r.x + r.w - 48, r.y + 38, 40, 20, 10);
        ctx.fillStyle = C.ink;
        ctx.fill();
        label(ctx, `${chosen.get(c.id)}A`, r.x + r.w - 28, r.y + 48, { size: 11, weight: 900, color: C.elec });
      });
      if (drag) {
        const c = m.circuits.find((x) => x.id === drag!.id)!;
        const r = slotRect(0, 0);
        drawBreaker(c, { x: drag.x - r.w / 2, y: drag.y - r.h / 2, w: r.w, h: c.volts === 240 ? r.h * 2 + 4 : r.h }, chosen.get(c.id)!, false);
      }
      // energize
      if (placed.length === m.circuits.length) {
        roundRect(ctx, g.w / 2 - 110, g.h - 60, 220, 48, 24);
        ctx.fillStyle = finished ? 'rgba(31,42,48,.2)' : C.sea;
        ctx.fill();
        label(ctx, finished ? 'Energized' : 'Close the main', g.w / 2, g.h - 36, { size: 16, weight: 800, color: C.white });
      }
    }

    function makeResult(): PuzzleResult {
      const s = scorePanel(m, placed);
      const parts = [`L1 ${s.l1} A / L2 ${s.l2} A (limit ${m.limit})`];
      if (s.over) parts.push(`${s.over} leg overloaded`);
      if (s.oversize) parts.push(`${s.oversize} breaker oversized for its wire`);
      if (s.undersize) parts.push(`${s.undersize} undersized`);
      if (s.missing) parts.push(`${s.missing} not installed`);
      return result(s.score, parts.join(', '));
    }

    function energize() {
      if (finished) return;
      finished = true;
      energized = performance.now();
      const s = scorePanel(m, placed);
      if (s.over) host.fx.thunk();
      const res = makeResult();
      setTimeout(() => {
        res.perfect ? host.fx.flourish() : host.fx.good();
      }, 250);
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
