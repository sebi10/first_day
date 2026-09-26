// Mobile-game notification bubbles that sit above the asset they refer to: a
// chunky rounded bubble with a pointer down to the asset and one bold
// pictogram. Rust = out of service (the only alert hue), sunflower = warning.
// Positioned by an outer <g transform>, counter-scaled against the zoom by a
// middle <g>, bobbed by an inner <g>. spread() pushes bodies apart (and off
// the runway) while every pointer keeps aiming at its asset.
import { K } from './paint';

export type Icon = 'wrench' | 'cone' | 'noentry' | 'broken' | 'clipboard' | 'bolt-off' | 'bolt' | 'cash' | 'warn';
/** alert = out of service, warn = needs attention soon, ok = running on backup (information only) */
export type Tone = 'alert' | 'warn' | 'ok';

const TONE = {
  alert: { body: K.rust, base: K.rustDark, ink: '#ffffff', sub: K.rust },
  warn: { body: '#ffd23f', base: '#c79512', ink: K.ink, sub: '#ffd23f' },
  ok: { body: '#2f9e5a', base: '#1d6b3b', ink: '#ffffff', sub: '#2f9e5a' },
};

function Glyph({ icon, ink, sub }: { icon: Icon; ink: string; sub: string }) {
  switch (icon) {
    case 'wrench':
      return (
        <g>
          <path d="M-7 7L2 -2" stroke={ink} stroke-width="4.6" stroke-linecap="round" />
          <circle cx={4.2} cy={-4.2} r={5.6} fill={ink} />
          <path d="M4.5 -4.5L9 -9" stroke={sub} stroke-width="4" stroke-linecap="round" />
        </g>
      );
    case 'cone':
      return (
        <g>
          <path d="M-2.6 -9h5.2l5 15h-15.2z" fill={ink} />
          <path d="M-4.4 -1.5h8.8" stroke={sub} stroke-width="2.6" />
          <path d="M-9 6.5h18" stroke={ink} stroke-width="3" stroke-linecap="round" />
        </g>
      );
    case 'noentry':
      // closed on purpose (red-tagged): a no-entry sign
      return (
        <g>
          <circle r={10.6} fill={ink} />
          <rect x={-7} y={-2.6} width={14} height={5.2} rx={1.4} fill={sub} />
        </g>
      );
    case 'broken':
      // closed because it is falling apart: a house split by a crack
      return (
        <g>
          <path d="M-11 -0.5L0 -10.5L11 -0.5H8V10H-8V-0.5Z" fill={ink} stroke={ink} stroke-width="1.2" stroke-linejoin="round" />
          <path d="M1.5 -9.5L-2.2 -3.2L2.6 0.8L-1.8 5.4L1 10.5" stroke={sub} stroke-width="2.4" fill="none" stroke-linejoin="round" />
        </g>
      );
    case 'clipboard':
      // inspection lapsed: a checklist struck through
      return (
        <g>
          <rect x={-8.5} y={-9.5} width={17} height={20} rx={2.4} fill={ink} />
          <rect x={-4} y={-11.6} width={8} height={4.4} rx={1.4} fill={sub} stroke={ink} stroke-width="1.4" />
          <path d="M-4.4 -1.4L4.4 7.4M4.4 -1.4L-4.4 7.4" stroke={sub} stroke-width="3" stroke-linecap="round" />
        </g>
      );
    case 'bolt-off':
      return (
        <g>
          <path d="M2 -10L-6 1H0L-2 10L6 -1H0Z" fill={ink} />
          <path d="M-9 -8L9 8" stroke={sub} stroke-width="4.6" stroke-linecap="round" />
          <path d="M-9 -8L9 8" stroke={ink} stroke-width="2" stroke-linecap="round" />
        </g>
      );
    case 'bolt':
      return <path d="M2.5 -11L-7 1.5H-0.5L-3 11L7 -1.5H0.5Z" fill={ink} />;
    case 'cash':
      // a coin running low: a coin with a down arrow
      return (
        <g>
          <circle cx={-3} cy={0} r={8.6} fill={ink} />
          <path d="M-0.2 -3.6q-1 -1.8 -3 -1.8q-2.6 0 -2.6 2q0 1.8 2.8 2.2q2.8 .4 2.8 2.4q0 2.2 -3 2.2q-2 0 -3 -1.8M-3 -7.4v14.8" stroke={sub} stroke-width="1.9" fill="none" stroke-linecap="round" />
          <path d="M9 -9v11" stroke={ink} stroke-width="3" stroke-linecap="round" />
          <path d="M4.6 1.2L9 7.2L13.4 1.2Z" fill={ink} stroke={ink} stroke-width="1.4" stroke-linejoin="round" />
        </g>
      );
    default:
      return (
        <g>
          <path d="M0 -8V2" stroke={ink} stroke-width="4.4" stroke-linecap="round" />
          <circle cy={7.5} r={2.5} fill={ink} />
        </g>
      );
  }
}

/** body size in local units (before scale) */
const BW = 46, BH = 34, TIP = 3;
export const bubbleK = (scale: number, small?: boolean) => scale * (small ? 0.88 : 1.1);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** (x, y) = where the pointer touches the asset; (dx, dy) moves the body. The
 *  tail leaves the body on the side that faces the asset, so a bubble that
 *  had to slide aside keeps an angled tail back to what it is about. */
export function Bubble({ x, y, icon, tone = 'alert', small, scale, motion, dx = 0, dy = 0, delay = 0 }: { x: number; y: number; icon: Icon; tone?: Tone; small?: boolean; scale: number; motion: boolean; dx?: number; dy?: number; delay?: number }) {
  const t = TONE[tone];
  const k = bubbleK(scale, small);
  const bx = Math.round((dx / k) * 10) / 10, by = Math.round((dy / k) * 10) / 10;
  const top = by - TIP - 9 - BH, bot = by - TIP - 9;
  const l = bx - BW / 2, r = bx + BW / 2;
  const body = `M${bx - 11} ${top}H${bx + 11}A12 12 0 0 1 ${r} ${top + 12}V${bot - 12}A12 12 0 0 1 ${bx + 11} ${bot}H${bx - 11}A12 12 0 0 1 ${l} ${bot - 12}V${top + 12}A12 12 0 0 1 ${bx - 11} ${top}Z`;
  let ptr: string;
  if (-TIP >= bot + 2 || (0 >= l + 4 && 0 <= r - 4)) {
    // the asset is below: the tail hangs from the bottom edge
    const c = clamp(0, bx - 11, bx + 11);
    ptr = `M${c - 7} ${bot - 1}L0 ${-TIP}L${c + 7} ${bot - 1}Z`;
  } else {
    // the asset is beside the body: the tail leaves the facing side
    const side = 0 < bx ? l + 1 : r - 1;
    const c = clamp(-TIP, top + 12, bot - 9);
    ptr = `M${side} ${c - 6}L0 ${-TIP}L${side} ${c + 6}Z`;
  }
  return (
    <g transform={`translate(${Math.round(x)} ${Math.round(y)})`}>
      <g class="bub-scale" style={{ transform: `scale(${k})` }}>
        <g class={motion ? 'bob' : undefined} style={delay ? { animationDelay: `${-delay}s` } : undefined}>
          <ellipse cx={3} cy={-1} rx={8} ry={2.6} fill="rgba(0,0,0,.22)" />
          <path d={body + ptr} fill={t.base} transform="translate(0 3.5)" />
          <path d={body + ptr} fill="#fff" stroke="#fff" stroke-width="6" stroke-linejoin="round" />
          <path d={body + ptr} fill={t.body} />
          <path d={`M${bx - 12} ${top + 5}H${bx + 12}`} stroke="#fff" stroke-width="2.6" stroke-linecap="round" opacity=".35" />
          <g transform={`translate(${bx} ${(top + bot) / 2})`}>
            <Glyph icon={icon} ink={t.ink} sub={t.sub} />
          </g>
        </g>
      </g>
    </g>
  );
}

export type Rect = [number, number, number, number];
/** a footprint bubbles keep off; `owner` = the asset it belongs to (its own bubble may sit on it) */
export type KeepOut = { r: Rect; owner?: string };
/** (dx, dy) is the preferred offset on the way in; `fixed` bubbles stay put and the others avoid them */
export type Placed = { x: number; y: number; k: number; dx: number; dy: number; owner?: string; fixed?: boolean };

/** body offsets to try, in units of the bubble's scale: up to 60 aside and
 *  64 up, nearest (sideways counts 1.25x) first */
const OFFSETS: [number, number, number][] = (() => {
  const o: [number, number, number][] = [];
  for (let oy = 0; oy <= 64; oy += 3) for (let ox = -60; ox <= 60; ox += 3) o.push([ox, oy, Math.abs(ox) * 1.25 + oy]);
  return o.sort((a, b) => a[2] - b[2]);
})();
const area = (a: Rect, b: Rect) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));

/** Place every bubble body: as close to its preferred spot as it can get
 *  while staying off the other bubbles, off every other asset and the runway
 *  (keep-outs) and inside the view. A small exhaustive search per bubble
 *  (a few hundred candidate offsets), two rounds, deterministic. */
export function spread<T extends Placed>(bs: T[], keepOut: KeepOut[] = [], view: Rect = [0, 0, 800, 600]) {
  const boxAt = (b: T, dx: number, dy: number): Rect => {
    const w = (BW + 8) * b.k, h = (BH + 10) * b.k;
    const cx = b.x + dx, cy = b.y + dy - (TIP + 9 + BH / 2) * b.k;
    return [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
  };
  const pref = bs.map((b) => [b.dx, b.dy] as const);
  const order = bs.map((_, i) => i).sort((i, j) => Number(!!bs[j].fixed) - Number(!!bs[i].fixed) || bs[i].y - bs[j].y);
  for (let round = 0; round < 2; round++)
    for (const i of order) {
      const b = bs[i];
      if (b.fixed) continue;
      const [px, py] = pref[i];
      const k2 = b.k * b.k;
      let best = Infinity, bx = b.dx, by = b.dy;
      // candidates nearest first, so the search stops as soon as moving any
      // further would cost more than the best spot found so far
      for (const [ox, oy, d] of OFFSETS) {
        const move = d * 3 * b.k;
        if (move >= best) break;
        const dx = px + ox * b.k, dy = py - oy * b.k;
        const q = boxAt(b, dx, dy);
        let cost = move;
        for (let j = 0; j < keepOut.length && cost < best; j++) {
          const ko = keepOut[j];
          if (ko.owner === undefined || ko.owner !== b.owner) cost += area(q, ko.r) / k2;
        }
        for (let j = 0; j < bs.length && cost < best; j++) if (j !== i) cost += (2.5 * area(q, boxAt(bs[j], bs[j].dx, bs[j].dy))) / k2;
        const out = Math.max(0, view[0] + 2 - q[0]) + Math.max(0, q[2] - view[2] + 2) + Math.max(0, view[1] + 2 - q[1]);
        cost += (out * 60) / b.k;
        if (cost < best) (best = cost), (bx = dx), (by = dy);
      }
      b.dx = bx;
      b.dy = by;
    }
  return bs;
}

/** a gold "new!" starburst for what arrived this week */
export function NewBadge({ x, y, scale, motion }: { x: number; y: number; scale: number; motion: boolean }) {
  const pts = Array.from({ length: 20 }, (_, i) => {
    const a = (i / 20) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 ? 9 : 14;
    return `${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`;
  }).join(' ');
  return (
    <g transform={`translate(${Math.round(x)} ${Math.round(y)})`}>
      <g class="bub-scale" style={{ transform: `scale(${scale})` }}>
        <g class={motion ? 'bob' : undefined}>
          <g transform="translate(0 -18)">
            <polygon points={pts} fill="#ffd23f" stroke="#fff" stroke-width="2.4" stroke-linejoin="round" />
            <path d="M0 -6.5L1.9 -2.1L6.6 -1.9L2.9 1.1L4.1 5.7L0 3.1L-4.1 5.7L-2.9 1.1L-6.6 -1.9L-1.9 -2.1Z" fill="#ff8c42" />
          </g>
        </g>
      </g>
    </g>
  );
}
