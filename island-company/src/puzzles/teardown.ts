// Mechanic · Engine teardown. Remove parts in the real maintenance-manual
// order, find and replace the failed part, reinstall in reverse. Forcing a
// part that is still captured by another is a mistake (it snaps back).
// Tiers 0–2 number the removal order and tag the failed part; from tier 3 you
// need to know the procedure, and the failed part only shows when inspected.
import { rng } from '../sim/rng';
import { C, backdrop, clamp, label, loop, pointer, roundRect, shade, stage } from './kit';
import { result, type PuzzleDef, type PuzzleResult } from './types';

export type Part = {
  id: string;
  name: string;
  /** parts that must come off first (they sit on top / hold this one) */
  above: string[];
  /** layout box in a 0..1 frame */
  box: [number, number, number, number];
  minTier: number;
  shade: string;
};

type Assembly = { title: string; parts: Part[]; faults: string[][]; note: string };

const ASSEMBLIES: Record<string, Assembly> = {
  alternator: {
    title: 'Belt-driven alternator',
    note: 'Slacken the adjusting arm before the belt.',
    parts: [
      { id: 'cowl', name: 'Upper cowling', above: [], box: [0.05, 0.02, 0.9, 0.12], minTier: 0, shade: '#dcd2bd' },
      { id: 'leads', name: 'Field + output leads', above: ['cowl'], box: [0.64, 0.2, 0.28, 0.12], minTier: 2, shade: '#56646b' },
      { id: 'arm', name: 'Adjusting arm bolt', above: ['cowl'], box: [0.06, 0.2, 0.26, 0.12], minTier: 0, shade: '#9aa5a9' },
      { id: 'belt', name: 'Drive belt', above: ['arm'], box: [0.36, 0.2, 0.24, 0.3], minTier: 0, shade: '#3b464b' },
      { id: 'pivot', name: 'Pivot bolt', above: ['belt', 'leads'], box: [0.06, 0.38, 0.26, 0.12], minTier: 1, shade: '#9aa5a9' },
      { id: 'alt', name: 'Alternator', above: ['pivot', 'belt'], box: [0.12, 0.56, 0.76, 0.28], minTier: 0, shade: '#b8c0c2' },
    ],
    faults: [['alt'], ['alt'], ['alt', 'belt']],
    // real squawk: worn bearing / diode failure; tier 5 also a glazed belt
  },
  cylinder: {
    title: 'Cylinder #3 (O-360)',
    note: 'Head hardware first; base nuts last.',
    parts: [
      { id: 'cowl', name: 'Upper cowling', above: [], box: [0.05, 0.02, 0.9, 0.1], minTier: 0, shade: '#dcd2bd' },
      { id: 'baffle', name: 'Cylinder baffles', above: ['cowl'], box: [0.05, 0.15, 0.4, 0.1], minTier: 0, shade: '#c9a86a' },
      { id: 'plugs', name: 'Spark plugs + leads', above: ['baffle'], box: [0.5, 0.15, 0.45, 0.1], minTier: 2, shade: '#56646b' },
      { id: 'intake', name: 'Intake tube', above: ['cowl'], box: [0.05, 0.29, 0.28, 0.1], minTier: 1, shade: '#9aa5a9' },
      { id: 'exhaust', name: 'Exhaust stack', above: ['cowl'], box: [0.67, 0.29, 0.28, 0.1], minTier: 1, shade: '#7f8b90' },
      { id: 'rocker', name: 'Rocker cover', above: ['baffle'], box: [0.36, 0.29, 0.28, 0.1], minTier: 0, shade: '#b8c0c2' },
      { id: 'pushrod', name: 'Pushrods + shrouds', above: ['rocker'], box: [0.3, 0.43, 0.4, 0.1], minTier: 3, shade: '#9aa5a9' },
      { id: 'nuts', name: 'Cylinder base nuts', above: ['intake', 'exhaust', 'pushrod', 'plugs', 'rocker'], box: [0.05, 0.57, 0.9, 0.08], minTier: 0, shade: '#7f8b90' },
      { id: 'cyl', name: 'Cylinder assembly', above: ['nuts'], box: [0.2, 0.69, 0.6, 0.14], minTier: 0, shade: '#b8c0c2' },
      { id: 'piston', name: 'Piston + rings', above: ['cyl'], box: [0.32, 0.86, 0.36, 0.1], minTier: 4, shade: '#dcd2bd' },
    ],
    faults: [['cyl'], ['cyl'], ['cyl', 'piston']],
  },
  avionics: {
    title: 'Com radio (panel stack)',
    note: 'Master off and breaker pulled, first.',
    parts: [
      { id: 'master', name: 'Avionics master OFF', above: [], box: [0.05, 0.04, 0.42, 0.12], minTier: 0, shade: '#3b464b' },
      { id: 'cb', name: 'Com circuit breaker (pull)', above: ['master'], box: [0.53, 0.04, 0.42, 0.12], minTier: 1, shade: '#56646b' },
      { id: 'lock', name: 'Radio lock screw', above: ['cb'], box: [0.05, 0.24, 0.42, 0.12], minTier: 0, shade: '#9aa5a9' },
      { id: 'radio', name: 'Com radio', above: ['lock'], box: [0.12, 0.44, 0.76, 0.2], minTier: 0, shade: '#34444c' },
      { id: 'coax', name: 'Antenna coax (tray)', above: ['radio'], box: [0.53, 0.24, 0.42, 0.12], minTier: 4, shade: '#56646b' },
      { id: 'tray', name: 'Mounting tray connector', above: ['radio'], box: [0.12, 0.7, 0.76, 0.14], minTier: 3, shade: '#7f8b90' },
    ],
    faults: [['radio'], ['radio'], ['radio', 'tray']],
  },
};

export type TeardownModel = {
  title: string;
  note: string;
  parts: Part[];
  faults: string[];
  numbered: boolean; // teaching tiers print the removal order
  tagged: boolean; // teaching tiers show the failed part up front
  order: string[]; // one legal removal order
};

export function removable(m: TeardownModel, id: string, removed: Set<string>) {
  const p = m.parts.find((x) => x.id === id)!;
  return p.above.filter((a) => m.parts.some((x) => x.id === a)).every((a) => removed.has(a));
}

/** can `id` go back on, given what is currently installed? (everything it sits on must be installed) */
export function installable(m: TeardownModel, id: string, installed: Set<string>) {
  const under = m.parts.filter((x) => x.above.includes(id)).map((x) => x.id);
  return under.every((u) => installed.has(u));
}

export function generateTeardown(seed: number, tier: number, _tools: string[] = [], job?: string): TeardownModel {
  const r = rng(seed);
  const key = job === 'cylinder' || job === 'alternator' || job === 'avionics' ? job : tier >= 3 ? 'cylinder' : r.pick(['alternator', 'avionics']);
  const a = ASSEMBLIES[key];
  const parts = a.parts.filter((p) => p.minTier <= Math.max(0, tier)).map((p) => ({ ...p, above: [...p.above] }));
  // drop references to parts that aren't in this tier's version
  const ids = new Set(parts.map((p) => p.id));
  for (const p of parts) p.above = p.above.filter((x) => ids.has(x));
  const faults = (tier >= 5 ? a.faults[2] : a.faults[0]).filter((f) => ids.has(f));
  const order: string[] = [];
  const removed = new Set<string>();
  while (order.length < parts.length) {
    const next = parts.find((p) => !removed.has(p.id) && p.above.every((x) => removed.has(x)));
    if (!next) break;
    removed.add(next.id);
    order.push(next.id);
  }
  return { title: a.title, note: a.note, parts, faults, numbered: tier <= 2, tagged: tier <= 2, order };
}

/** Deepest fault must be reached: everything needed to expose all faulty parts. */
export function mustRemove(m: TeardownModel) {
  const need = new Set<string>();
  const add = (id: string) => {
    if (need.has(id)) return;
    need.add(id);
    m.parts.find((p) => p.id === id)!.above.forEach(add);
  };
  m.faults.forEach(add);
  return need;
}

export function scoreTeardown(m: TeardownModel, s: { forced: number; wrongInstall: number; replaced: string[]; goodReplaced: number; reinstalled: boolean }) {
  const missed = m.faults.filter((f) => !s.replaced.includes(f)).length;
  let v = 1 - 0.12 * s.forced - 0.12 * s.wrongInstall - 0.4 * missed - 0.15 * s.goodReplaced;
  if (!s.reinstalled) v = Math.min(v, 0.55);
  return clamp(v, 0, 1);
}

export const teardown: PuzzleDef = {
  id: 'teardown',
  role: 'mech',
  title: 'Remove and replace',
  gesture: 'Drag parts to slots',
  howTo: 'Remove in order, swap the failed part, rebuild in reverse.',
  term: 'Teardown: disassembly per the maintenance manual; reassembly is the reverse order.',
  seconds: (tier) => 70 + tier * 10,
  mount(host, p) {
    const m = generateTeardown(p.seed, p.tier, p.tools, p.context?.job);
    const trayHint = p.tools.includes('partsTray');
    const st = stage(host.el);
    const { ctx } = st;
    const removed = new Set<string>();
    const removalOrder: string[] = [];
    const installed = new Set<string>(m.parts.map((x) => x.id));
    const inspected = new Set<string>();
    const binned = new Set<string>(); // failed parts thrown out
    const fresh = new Set<string>(); // new parts in the tray
    const replaced: string[] = [];
    let goodReplaced = 0;
    let forced = 0;
    let wrongInstall = 0;
    let phase: 'teardown' | 'rebuild' = 'teardown';
    let drag: { id: string; x: number; y: number; ox: number; oy: number; from: 'asm' | 'tray' } | null = null;
    let shake: { id: string; t: number } | null = null;
    let finished = false;
    let flourish = 0;

    const geo = () => {
      const w = st.w;
      const h = st.h;
      const asm = { x: 14, y: 40, w: w - 28, h: h * 0.5 };
      const tray = { x: 14, y: asm.y + asm.h + 16, w: w - 28, h: h - (asm.y + asm.h + 16) - 70 };
      return { w, h, asm, tray, bin: { x: w - 84, y: h - 60, w: 70, h: 48 } };
    };
    const partRect = (pt: Part) => {
      const { asm } = geo();
      const [x, y, w, h] = pt.box;
      return { x: asm.x + x * asm.w, y: asm.y + y * asm.h, w: w * asm.w, h: h * asm.h };
    };
    const trayIds = () => m.parts.filter((pt) => removed.has(pt.id) && !installed.has(pt.id)).map((pt) => pt.id);
    const trayRect = (i: number) => {
      const { tray } = geo();
      const cols = 2;
      const cw = (tray.w - 8) / cols;
      const ch = 40;
      return { x: tray.x + (i % cols) * (cw + 8), y: tray.y + 26 + Math.floor(i / cols) * (ch + 6), w: cw, h: ch };
    };
    const isFault = (id: string) => m.faults.includes(id) && !fresh.has(id);
    const hit = (x: number, y: number, r: { x: number; y: number; w: number; h: number }) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

    const need = mustRemove(m);
    const status = () => {
      if (phase === 'teardown') host.status(`Teardown · ${removed.size}/${need.size} off · ${m.faults.length} squawk${m.faults.length > 1 ? 's' : ''}`);
      else host.status(`Rebuild · ${[...removed].filter((id) => installed.has(id)).length}/${removed.size} back on`);
    };
    status();

    const tryRemove = (id: string) => {
      if (!removable(m, id, removed)) {
        forced++;
        shake = { id, t: performance.now() };
        host.fx.bad();
        return false;
      }
      removed.add(id);
      installed.delete(id);
      removalOrder.push(id);
      host.fx.snap();
      status();
      return true;
    };
    const tryInstall = (id: string) => {
      if (isFault(id)) {
        // reinstalling the failed part: counts as not replaced, but allowed
      }
      if (!installable(m, id, installed)) {
        wrongInstall++;
        shake = { id, t: performance.now() };
        host.fx.bad();
        return false;
      }
      installed.add(id);
      host.fx.tick();
      host.fx.snap();
      status();
      if (m.parts.every((pt) => installed.has(pt.id))) finish();
      return true;
    };

    const offPtr = pointer(st.canvas, {
      down(pt) {
        if (finished || host.paused()) return;
        const g = geo();
        // bin: throw a failed part out → new part appears
        // tray parts
        const ids = trayIds();
        for (let i = 0; i < ids.length; i++) {
          const r = trayRect(i);
          if (hit(pt.x, pt.y, r)) {
            drag = { id: ids[i], x: pt.x, y: pt.y, ox: pt.x - r.x, oy: pt.y - r.y, from: 'tray' };
            if (!inspected.has(ids[i])) {
              inspected.add(ids[i]);
              if (isFault(ids[i])) host.fx.fault();
            }
            return;
          }
        }
        // assembly parts (topmost first)
        for (const part of [...m.parts].reverse()) {
          if (!installed.has(part.id)) continue;
          const r = partRect(part);
          if (hit(pt.x, pt.y, r)) {
            if (phase === 'rebuild') return;
            drag = { id: part.id, x: pt.x, y: pt.y, ox: pt.x - r.x, oy: pt.y - r.y, from: 'asm' };
            return;
          }
        }
        if (phase === 'teardown' && m.faults.every((f) => fresh.has(f) || binned.has(f)) && hit(pt.x, pt.y, { x: g.w / 2 - 100, y: g.h - 62, w: 200, h: 50 })) {
          phase = 'rebuild';
          host.fx.tap();
          status();
        }
      },
      move(pt) {
        if (!drag) return;
        drag.x = pt.x;
        drag.y = pt.y;
      },
      up(pt) {
        if (!drag || finished) return;
        const g = geo();
        const d = drag;
        drag = null;
        if (d.from === 'asm' && pt.y > g.tray.y - 10) tryRemove(d.id);
        else if (d.from === 'tray') {
          if (hit(pt.x, pt.y, g.bin)) {
            if (fresh.has(d.id)) return;
            // scrap it and pull a new one from stores
            if (m.faults.includes(d.id)) replaced.push(d.id);
            else goodReplaced++;
            binned.add(d.id);
            fresh.add(d.id);
            host.fx.thunk();
            return;
          }
          if (pt.y < g.asm.y + g.asm.h) {
            if (phase === 'teardown') {
              phase = 'rebuild';
              status();
            }
            tryInstall(d.id);
          }
        }
      },
    });

    const stop = loop(() => draw());

    function drawPart(part: Part, r: { x: number; y: number; w: number; h: number }, ghost = false) {
      const now = performance.now();
      const dx = shake && shake.id === part.id && now - shake.t < 300 ? Math.sin((now - shake.t) / 20) * 5 : 0;
      roundRect(ctx, r.x + dx, r.y, r.w, r.h, 8);
      ctx.fillStyle = ghost ? 'rgba(31,42,48,.06)' : fresh.has(part.id) ? shade(part.shade, 0.35) : part.shade;
      ctx.fill();
      if (!ghost) {
        ctx.strokeStyle = fresh.has(part.id) ? C.sea : 'rgba(31,42,48,.35)';
        ctx.lineWidth = fresh.has(part.id) ? 2.5 : 1;
        ctx.stroke();
      } else {
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(31,42,48,.3)';
        ctx.stroke();
        ctx.setLineDash([]);
      }
      const dark = ['#3b464b', '#34444c', '#56646b', '#7f8b90'].includes(part.shade) && !fresh.has(part.id);
      label(ctx, part.name, r.x + dx + r.w / 2, r.y + r.h / 2, { size: 11, weight: 800, color: ghost ? C.inkSoft : dark ? C.paper : C.ink });
      const showFault = !ghost && isFault(part.id) && (m.tagged || inspected.has(part.id));
      if (showFault) {
        roundRect(ctx, r.x + dx + r.w - 34, r.y - 8, 30, 16, 8);
        ctx.fillStyle = C.rust;
        ctx.fill();
        label(ctx, 'worn', r.x + dx + r.w - 19, r.y, { size: 9, weight: 900, color: C.white });
      }
      if (fresh.has(part.id) && !ghost) label(ctx, 'NEW', r.x + dx + 20, r.y + 9, { size: 9, weight: 900, color: C.sea });
    }

    function draw() {
      const g = geo();
      backdrop(ctx, g.w, g.h);
      label(ctx, m.title, 16, 20, { size: 14, weight: 800, align: 'left' });
      label(ctx, phase === 'teardown' ? 'Teardown' : 'Rebuild', g.w - 16, 20, { size: 12, weight: 800, align: 'right', color: C.sea });
      // assembly
      roundRect(ctx, g.asm.x - 4, g.asm.y - 4, g.asm.w + 8, g.asm.h + 8, 14);
      ctx.fillStyle = 'rgba(31,42,48,.05)';
      ctx.fill();
      for (const part of m.parts) {
        const r = partRect(part);
        if (!installed.has(part.id)) {
          drawPart(part, r, true);
          continue;
        }
        if (drag && drag.id === part.id && drag.from === 'asm') continue;
        drawPart(part, r);
        if (m.numbered && phase === 'teardown') {
          const n = m.order.indexOf(part.id) + 1;
          ctx.fillStyle = C.ink;
          ctx.beginPath();
          ctx.arc(r.x + 12, r.y + 10, 9, 0, Math.PI * 2);
          ctx.fill();
          label(ctx, String(n), r.x + 12, r.y + 10, { size: 10, weight: 900, color: C.paper });
        }
      }
      // tray
      roundRect(ctx, g.tray.x, g.tray.y, g.tray.w, g.tray.h, 14);
      ctx.fillStyle = C.paper;
      ctx.fill();
      label(ctx, 'Parts tray · tap to inspect, drag back to rebuild', g.tray.x + 12, g.tray.y + 13, { size: 11, weight: 700, align: 'left', color: C.inkSoft });
      trayIds().forEach((id, i) => {
        if (drag && drag.id === id) return;
        const r = trayRect(i);
        drawPart(m.parts.find((x) => x.id === id)!, r);
        if (trayHint) {
          const n = removalOrder.indexOf(id) + 1;
          if (n > 0) label(ctx, `#${n}`, r.x + r.w - 14, r.y + r.h - 9, { size: 10, weight: 900, color: C.sea });
        }
      });
      // bin
      roundRect(ctx, g.bin.x, g.bin.y, g.bin.w, g.bin.h, 12);
      ctx.fillStyle = 'rgba(31,42,48,.1)';
      ctx.fill();
      label(ctx, 'Scrap →', g.bin.x + g.bin.w / 2, g.bin.y + 16, { size: 10, weight: 800, color: C.inkSoft });
      label(ctx, 'new part', g.bin.x + g.bin.w / 2, g.bin.y + 32, { size: 10, weight: 800, color: C.inkSoft });
      // phase button
      if (phase === 'teardown' && m.faults.every((f) => fresh.has(f) || binned.has(f))) {
        roundRect(ctx, g.w / 2 - 100, g.h - 62, 200, 50, 25);
        ctx.fillStyle = C.sea;
        ctx.fill();
        label(ctx, 'Start rebuild', g.w / 2, g.h - 37, { size: 16, weight: 800, color: C.white });
      } else if (m.numbered) {
        label(ctx, m.note, 14, g.h - 36, { size: 11, color: C.inkSoft, align: 'left' });
      }
      // dragged part on top
      if (drag) {
        const part = m.parts.find((x) => x.id === drag!.id)!;
        const r0 = drag.from === 'asm' ? partRect(part) : trayRect(0);
        drawPart(part, { x: drag.x - drag.ox, y: drag.y - drag.oy, w: r0.w, h: r0.h });
      }
      if (flourish) {
        const t = clamp((performance.now() - flourish) / 700, 0, 1);
        ctx.globalAlpha = 0.3 * (1 - t);
        ctx.fillStyle = C.white;
        ctx.fillRect(0, 0, g.w, g.h);
        ctx.globalAlpha = 1;
      }
    }

    function state() {
      return { forced, wrongInstall, replaced, goodReplaced, reinstalled: m.parts.every((pt) => installed.has(pt.id)) };
    }
    function makeResult(): PuzzleResult {
      const s = state();
      let sc = scoreTeardown(m, s);
      if (!s.reinstalled) {
        const progress = (removed.size ? [...removed].filter((id) => installed.has(id)).length / removed.size : 0) * 0.3 + Math.min(1, removed.size / need.size) * 0.3;
        sc = Math.min(sc, progress + (replaced.length === m.faults.length ? 0.2 : 0));
      }
      const parts = [];
      parts.push(replaced.length === m.faults.length ? 'failed part replaced' : `${m.faults.length - replaced.length} fault missed`);
      if (forced) parts.push(`${forced} forced`);
      if (wrongInstall) parts.push(`${wrongInstall} out of order`);
      if (goodReplaced) parts.push(`${goodReplaced} good part scrapped`);
      if (!s.reinstalled) parts.push('not reassembled');
      return result(sc, parts.join(', '));
    }
    function finish() {
      if (finished) return;
      finished = true;
      const res = makeResult();
      if (res.perfect) {
        flourish = performance.now();
        host.fx.flourish();
      } else host.fx.good();
      setTimeout(() => host.done(res), res.perfect ? 900 : 400);
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
