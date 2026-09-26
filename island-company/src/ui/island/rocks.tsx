// Chunky faceted rock, drawn in screen space: a top face plus the extruded
// faces that point toward the viewer, shaded by which way they face (lit from
// the upper left). Faces of one rock are merged per tone to save nodes.
import { rng } from '../../sim/rng';
import { along, curve, lin, type Pt } from './geo';
import { K, mix } from './paint';

export type RockPal = { top: string; hi: string; light: string; mid: string; dark: string; line: string };
export const ROCK: RockPal = { top: K.rockTop, hi: K.rockHi, light: K.rockLight, mid: K.rockMid, dark: K.rockDark, line: '#4a3d35' };

/** an irregular convex-ish outline around an ellipse */
export function blob(cx: number, cy: number, rx: number, ry: number, seed: number, n = 7, jit = 0.18): Pt[] {
  const r = rng(seed);
  const off = r.range(0, Math.PI * 2);
  return Array.from({ length: n }, (_, i) => {
    const a = off + (i / n) * Math.PI * 2 + r.range(-0.2, 0.2);
    const k = 1 + r.range(-jit, jit);
    return [cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k] as Pt;
  });
}

/** Faces of an extruded outline (clockwise on screen). */
export function extrude(top: Pt[], h: number) {
  const light: string[] = [], mid: string[] = [], dark: string[] = [], cracks: string[] = [];
  for (let i = 0; i < top.length; i++) {
    const a = top[i], b = top[(i + 1) % top.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    const nx = dy / l, ny = -dx / l;
    if (ny <= 0.02) continue; // faces away from the viewer
    const q = lin([a, b, [b[0], b[1] + h], [a[0], a[1] + h]], true);
    (nx < -0.38 ? light : nx > 0.38 ? dark : mid).push(q);
    if (h > 14 && l > 16) {
      const t = 0.45 + ((i * 37) % 20) / 100;
      cracks.push(lin([[a[0] + dx * 0.08, a[1] + dy * 0.08 + h * t], [a[0] + dx * 0.55, a[1] + dy * 0.55 + h * (t + 0.08)]]));
    }
  }
  return { light: light.join(''), mid: mid.join(''), dark: dark.join(''), cracks: cracks.join('') };
}

/** highlight patch: the top shrunk toward its upper-left */
function inset(top: Pt[], k: number, dx: number, dy: number): Pt[] {
  const cx = top.reduce((n, p) => n + p[0], 0) / top.length;
  const cy = top.reduce((n, p) => n + p[1], 0) / top.length;
  return top.map(([x, y]) => [cx + (x - cx) * k + dx, cy + (y - cy) * k + dy]);
}

export function Rock({ top, h, pal = ROCK, topFill, hi = true, cracks = true, smooth }: { top: Pt[]; h: number; pal?: RockPal; topFill?: string; hi?: boolean; cracks?: boolean; smooth?: boolean }) {
  const f = extrude(top, h);
  const outline = (p: Pt[]) => (smooth ? curve(p) : lin(p, true));
  return (
    <>
      {f.light && <path d={f.light} fill={pal.light} />}
      {f.mid && <path d={f.mid} fill={pal.mid} />}
      {f.dark && <path d={f.dark} fill={pal.dark} />}
      {cracks && f.cracks && <path d={f.cracks} stroke={pal.line} stroke-width="1.4" stroke-linecap="round" opacity=".45" fill="none" />}
      <path d={outline(top)} fill={topFill ?? pal.top} />
      {hi && <path d={outline(inset(top, 0.55, -0.12 * h, -0.1 * h))} fill={topFill ? mix(topFill, '#fffbe0', 0.22) : pal.hi} opacity=".75" />}
    </>
  );
}

/** A whole row of boulders in five nodes: faces merged per tone, then the
 *  tops, then their highlights (rows barely overlap, so order holds). */
export function RockRow({ rocks, pal = ROCK }: { rocks: { top: Pt[]; h: number }[]; pal?: RockPal }) {
  const light: string[] = [], mid: string[] = [], dark: string[] = [], tops: string[] = [], his: string[] = [];
  for (const r of rocks) {
    const f = extrude(r.top, r.h);
    light.push(f.light);
    mid.push(f.mid);
    dark.push(f.dark);
    tops.push(lin(r.top, true));
    his.push(lin(inset(r.top, 0.55, -0.12 * r.h, -0.1 * r.h), true));
  }
  return (
    <>
      <path d={light.join('')} fill={pal.light} />
      <path d={mid.join('')} fill={pal.mid} />
      <path d={dark.join('')} fill={pal.dark} />
      <path d={tops.join('')} fill={pal.top} />
      <path d={his.join('')} fill={pal.hi} opacity=".75" />
    </>
  );
}

/** a small loose boulder */
export function Boulder({ x, y, r, seed, pal = ROCK }: { x: number; y: number; r: number; seed: number; pal?: RockPal }) {
  return <Rock top={blob(x, y - r * 0.5, r, r * 0.55, seed, 6, 0.22)} h={r * 0.7} pal={pal} cracks={false} hi={r >= 9} />;
}

/** a row of stacked boulders along a ledge's front edge (points run east to west) */
export function ridge(edge: Pt[], h: number, seed: number, step = 24, size = 1): { top: Pt[]; h: number; key: number }[] {
  const r = rng(seed);
  const len = edge.slice(1).reduce((n, p, i) => n + Math.hypot(p[0] - edge[i][0], p[1] - edge[i][1]), 0);
  const n = Math.max(2, Math.round(len / step));
  const out: { top: Pt[]; h: number; key: number; y: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const [x, y] = along(edge, i / n);
    const rx = r.range(12, 19) * size, ry = r.range(6.5, 9) * size;
    const lift = r.range(-3, 7);
    out.push({ top: blob(x + r.range(-4, 4), y - lift, rx, ry, seed * 100 + i, 6, 0.16), h: Math.max(8, h - ry + lift + 2), key: i, y });
  }
  return out.sort((a, b) => a.y - b.y);
}
