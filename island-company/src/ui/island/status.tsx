// Mobile-game notification bubbles that sit above the asset they refer to: a
// chunky rounded bubble with a pointer down to the asset and one bold
// pictogram. Rust = out of service (the only alert hue), sunflower = warning.
// Positioned by an outer <g transform>, counter-scaled against the zoom by a
// middle <g>, bobbed by an inner <g>. spread() lifts bodies clear of each
// other (and off the runway) while every pointer keeps aiming at its asset:
// a bubble that had to move gets a longer, stretched pointer, never a
// dotted leader line.
import { K } from './paint';

export type Icon = 'wrench' | 'cone' | 'noflight' | 'noentry' | 'broken' | 'clipboard' | 'bolt-off' | 'bolt' | 'cash' | 'placard' | 'tag' | 'warn';
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
    case 'noflight':
      // grounded (red-tagged by the mechanic): a plane struck through, "no flights"
      return (
        <g>
          <path d="M-1.4 -11h2.8l1 7.6l8.6 4.4v2.8l-8.6 -2.2l-.6 5.6l3 2.2v2.2l-4.2 -1.2h-.8l-4.2 1.2v-2.2l3 -2.2l-.6 -5.6l-8.6 2.2v-2.8l8.6 -4.4z" fill={ink} />
          <path d="M-10 -9L10 9" stroke={sub} stroke-width="4.6" stroke-linecap="round" />
          <path d="M-10 -9L10 9" stroke={ink} stroke-width="2" stroke-linecap="round" />
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
      // inspection lapsed: a checklist on a clipboard (a ringed clip on top,
      // ticked lines), stamped with a cross in the corner
      return (
        <g>
          <rect x={-8} y={-9} width={16} height={20} rx={2} fill={ink} />
          <path d="M-4.6 -8.6v-2.2h9.2v2.2z" fill={sub} stroke={ink} stroke-width="1.2" stroke-linejoin="round" />
          <circle cx={0} cy={-11.6} r={2} fill="none" stroke={ink} stroke-width="1.5" />
          <path d="M-5.6 -3.6l1.3 1.3l2.2 -2.6M-5.6 1.6l1.3 1.3l2.2 -2.6" stroke={sub} stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M0 -3h4.6M0 2.2h4.6" stroke={sub} stroke-width="1.4" stroke-linecap="round" />
          <circle cx={6} cy={8} r={5.4} fill={sub} stroke={ink} stroke-width="1.4" />
          <path d="M3.9 5.9l4.2 4.2M8.1 5.9l-4.2 4.2" stroke={ink} stroke-width="1.7" stroke-linecap="round" />
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
    case 'placard':
      // flying on an MEL C placard (an INOP item deferred): a placard on its post
      return (
        <g>
          <rect x={-10} y={-11} width={20} height={13} rx={1.8} fill={ink} />
          <path d="M-6 -6.6h12M-6 -2.4h7" stroke={sub} stroke-width="2" stroke-linecap="round" />
          <path d="M0 2v7.4" stroke={ink} stroke-width="3" />
          <path d="M-5.4 10h10.8" stroke={ink} stroke-width="2.6" stroke-linecap="round" />
        </g>
      );
    case 'tag':
      // made safe: the breaker is off and tagged (a lockout tag on its string)
      return (
        <g>
          <path d="M-1 -8q-6 -4 -9 1" stroke={ink} stroke-width="1.5" fill="none" stroke-linecap="round" />
          <path d="M-6.5 -5.4l6.5 -5.2l6.5 5.2v16.4h-13z" fill={ink} />
          <circle cy={-5.4} r={1.9} fill={sub} />
          <path d="M-3.4 1h6.8M-3.4 5.4h6.8" stroke={sub} stroke-width="1.7" stroke-linecap="round" />
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
/** a tail's length with the body in its home spot, and the most spread()
 *  lets it stretch (about 12 px more on a phone) */
const TAIL_HOME = 10, TAIL_MAX = 24;
export const bubbleK = (scale: number, small?: boolean) => scale * (small ? 0.88 : 1.1);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Where the tail leaves the body (local units, body offset bx, by): from the
 *  bottom edge when the asset is below, else from the side that faces it. */
function tailOf(bx: number, by: number) {
  const top = by - TIP - 9 - BH, bot = by - TIP - 9;
  const l = bx - BW / 2, r = bx + BW / 2;
  if (-TIP >= bot + 2 || (0 >= l + 4 && 0 <= r - 4)) {
    const c = clamp(0, bx - 11, bx + 11);
    return { below: true, ax: c, ay: bot - 1, len: Math.hypot(c, -TIP - bot) };
  }
  const side = 0 < bx ? l + 1 : r - 1;
  const c = clamp(-TIP, top + 12, bot - 9);
  return { below: false, ax: side, ay: c, len: Math.hypot(side, -TIP - c) };
}

/** (x, y) = where the pointer touches the asset; (dx, dy) moves the body. The
 *  tail leaves the body on the side that faces the asset, so a bubble that
 *  had to slide aside keeps an angled tail back to what it is about. */
export function Bubble({ x, y, icon, tone = 'alert', small, scale, motion, dx = 0, dy = 0, delay = 0, count }: { x: number; y: number; icon: Icon; tone?: Tone; small?: boolean; scale: number; motion: boolean; dx?: number; dy?: number; delay?: number; count?: number }) {
  const t = TONE[tone];
  const k = bubbleK(scale, small);
  const bx = Math.round((dx / k) * 10) / 10, by = Math.round((dy / k) * 10) / 10;
  const top = by - TIP - 9 - BH, bot = by - TIP - 9;
  const l = bx - BW / 2, r = bx + BW / 2;
  const body = `M${bx - 11} ${top}H${bx + 11}A12 12 0 0 1 ${r} ${top + 12}V${bot - 12}A12 12 0 0 1 ${bx + 11} ${bot}H${bx - 11}A12 12 0 0 1 ${l} ${bot - 12}V${top + 12}A12 12 0 0 1 ${bx - 11} ${top}Z`;
  const tl = tailOf(bx, by);
  // the pointer always runs all the way to the asset: a bubble that had to
  // move gets a longer tail, a little slimmer so it still reads as a pointer
  const hw = Math.round(Math.max(4.6, (tl.below ? 7 : 6) - Math.max(0, tl.len - 16) * 0.16) * 10) / 10;
  const ptr = tl.below ? `M${tl.ax - hw} ${tl.ay}L0 ${-TIP}L${tl.ax + hw} ${tl.ay}Z` : `M${tl.ax} ${Math.round((tl.ay - hw) * 10) / 10}L0 ${-TIP}L${tl.ax} ${Math.round((tl.ay + hw) * 10) / 10}Z`;
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
          {/* how many assets this one fault takes out (the grid: every house) */}
          {count !== undefined && (
            <g transform={`translate(${r - 3} ${top + 3})`}>
              <rect x={-12} y={-8} width={24} height={16} rx={8} fill={K.ink} stroke="#fff" stroke-width="2" />
              <text y={3.8} text-anchor="middle" font-size="11" font-weight="800" fill="#fff">
                ×{count}
              </text>
            </g>
          )}
        </g>
      </g>
    </g>
  );
}

export type Rect = [number, number, number, number];
/** a footprint bubbles keep off; `owner` = the asset it belongs to (its own
 *  bubble may sit on it); `w` = how much it matters (default 1: buildings,
 *  the runway, smoke; props, stalls and the fountain are cheaper to cover) */
export type KeepOut = { r: Rect; owner?: string; w?: number };
/** (dx, dy) is the preferred offset on the way in; `fixed` bubbles stay put and the others avoid them */
export type Placed = { x: number; y: number; k: number; dx: number; dy: number; owner?: string; fixed?: boolean };

/** body offsets to try, in units of the bubble's scale: up to 60 aside and
 *  48 up, nearest first; moving straight up is cheapest (the pointer just
 *  gets longer), sideways counts double */
const OFFSETS: [number, number, number][] = (() => {
  const o: [number, number, number][] = [];
  for (let oy = 0; oy <= 48; oy += 3) for (let ox = -60; ox <= 60; ox += 3) o.push([ox, oy, Math.abs(ox) * 2 + oy]);
  return o.sort((a, b) => a[2] - b[2]);
})();
const area = (a: Rect, b: Rect) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));

/** Place every bubble body: as close to its preferred spot as it can get
 *  while staying off the other bubbles, off every other asset and the runway
 *  (keep-outs) and inside the view. A small exhaustive search per bubble
 *  (a few hundred candidate offsets), two rounds, deterministic. */
/** the rect a placed bubble's body covers (with its white rim), in map units: what spread() keeps apart, and what a tap on it hits */
export function bubbleBox(b: Pick<Placed, 'x' | 'y' | 'k'>, dx: number, dy: number): Rect {
  const w = (BW + 8) * b.k, h = (BH + 10) * b.k;
  const cx = b.x + dx, cy = b.y + dy - (TIP + 9 + BH / 2) * b.k;
  return [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
}

export function spread<T extends Placed>(bs: T[], keepOut: KeepOut[] = [], view: Rect = [0, 0, 800, 600]) {
  const boxAt = bubbleBox;
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
          if (ko.owner === undefined || ko.owner !== b.owner) cost += (area(q, ko.r) * (ko.w ?? 1)) / k2;
        }
        for (let j = 0; j < bs.length && cost < best; j++) if (j !== i) cost += (2.5 * area(q, boxAt(bs[j], bs[j].dx, bs[j].dy))) / k2;
        const out = Math.max(0, view[0] + 2 - q[0]) + Math.max(0, q[2] - view[2] + 2) + Math.max(0, view[1] + 2 - q[1]);
        cost += (out * 60) / b.k;
        // keep bubbles near their asset: every unit of pointer costs, and
        // past TAIL_MAX a bubble reads as a diagram callout
        const len = tailOf(dx / b.k, dy / b.k).len;
        cost += Math.max(0, len - TAIL_HOME) * 2 + Math.max(0, len - TAIL_MAX) * 60;
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
