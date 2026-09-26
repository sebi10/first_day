// Mobile-game notification bubbles that sit above the asset they refer to: a
// chunky rounded bubble with a pointer down to the asset and one bold
// pictogram. Rust = out of service (the only alert hue), sunflower = warning.
// Positioned by an outer <g transform>, counter-scaled against the zoom by a
// middle <g>, bobbed by an inner <g>. spread() pushes bodies apart (and off
// the runway) while every pointer keeps aiming at its asset.
import { K } from './paint';

export type Icon = 'wrench' | 'cone' | 'tag' | 'clipboard' | 'bolt-off' | 'bolt' | 'flame' | 'cash' | 'warn';
export type Tone = 'alert' | 'warn';

const TONE = {
  alert: { body: K.rust, base: K.rustDark, ink: '#ffffff', sub: K.rust },
  warn: { body: '#ffd23f', base: '#c79512', ink: K.ink, sub: '#ffd23f' },
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
    case 'tag':
      return (
        <g transform="rotate(-24)">
          <path d="M-10 -6.5h12l7 6.5l-7 6.5h-12z" fill={ink} />
          <circle cx={3} cy={0} r={2.3} fill={sub} />
          <path d="M-7 -2.2h6M-7 2.2h6" stroke={sub} stroke-width="1.8" stroke-linecap="round" />
        </g>
      );
    case 'clipboard':
      return (
        <g>
          <rect x={-7} y={-8} width={14} height={17} rx={2} fill={ink} />
          <rect x={-3.5} y={-10} width={7} height={4} rx={1.2} fill={ink} stroke={sub} stroke-width="1.2" />
          <path d="M-4 -2h8M-4 1.5h8" stroke={sub} stroke-width="1.6" />
          <path d="M1 4.2l4.4 4.4M5.4 4.2l-4.4 4.4" stroke={sub} stroke-width="1.8" stroke-linecap="round" />
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
    case 'flame':
      return (
        <g>
          <path d="M0 -11C4 -6 8 -3 7 3C6 8 2 10 0 10C-3 10 -7 8 -7 3C-7 -1 -4 -3 -3 -7C-2 -4 -1 -3 0 -2C1 -5 1 -8 0 -11Z" fill={ink} />
          <path d="M0 1C2 3 3 5 2 7C1 8.5 -1 8.5 -2 7C-3 5 -1 3 0 1Z" fill={sub} />
        </g>
      );
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

/** (x, y) = where the pointer touches the asset (its top); (dx, dy) nudges the body */
export function Bubble({ x, y, icon, tone = 'alert', small, scale, motion, dx = 0, dy = 0, delay = 0 }: { x: number; y: number; icon: Icon; tone?: Tone; small?: boolean; scale: number; motion: boolean; dx?: number; dy?: number; delay?: number }) {
  const t = TONE[tone];
  const k = bubbleK(scale, small);
  const bx = Math.round((dx / k) * 10) / 10, by = Math.round((dy / k) * 10) / 10;
  const top = by - TIP - 9 - BH, bot = by - TIP - 9;
  const body = `M${bx - 11} ${top}H${bx + 11}A12 12 0 0 1 ${bx + 23} ${top + 12}V${bot - 12}A12 12 0 0 1 ${bx + 11} ${bot}H${bx - 11}A12 12 0 0 1 ${bx - 23} ${bot - 12}V${top + 12}A12 12 0 0 1 ${bx - 11} ${top}Z`;
  const ptr = `M${bx - 7} ${bot}L0 ${-TIP}L${bx + 7} ${bot}Z`;
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

export type Placed = { x: number; y: number; k: number; dx: number; dy: number };
type Rect = [number, number, number, number];
/** Relaxation: push overlapping bubble bodies apart, never down onto their
 *  asset, and out of the keep-out rects (the runway markings, the map edge). */
export function spread<T extends Placed>(bs: T[], keepOut: Rect[] = [], view: Rect = [0, 0, 800, 600]) {
  const box = (b: T): Rect => {
    const w = (BW + 8) * b.k, h = (BH + 12) * b.k;
    const cx = b.x + b.dx, cy = b.y + b.dy - (TIP + 9 + BH / 2) * b.k;
    return [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
  };
  for (let pass = 0; pass < 12; pass++) {
    let moved = false;
    for (let i = 0; i < bs.length; i++)
      for (let j = i + 1; j < bs.length; j++) {
        const a = box(bs[i]), b = box(bs[j]);
        const ox = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
        const oy = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        const acx = (a[0] + a[2]) / 2, bcx = (b[0] + b[2]) / 2, acy = (a[1] + a[3]) / 2, bcy = (b[1] + b[3]) / 2;
        if (ox < oy * 1.3) {
          const s = (acx <= bcx ? -1 : 1) * (ox / 2 + 0.5);
          bs[i].dx += s;
          bs[j].dx -= s;
        } else {
          // the higher one goes further up; nobody goes down
          if (acy <= bcy) bs[i].dy -= oy + 0.5;
          else bs[j].dy -= oy + 0.5;
        }
      }
    for (const b of bs) {
      for (const r of keepOut) {
        const q = box(b);
        if (q[2] > r[0] && q[0] < r[2] && q[3] > r[1] && q[1] < r[3]) {
          b.dy -= q[3] - r[1] + 1;
          moved = true;
        }
      }
      const q = box(b);
      if (q[0] < view[0] + 2) b.dx += view[0] + 2 - q[0];
      if (q[2] > view[2] - 2) b.dx -= q[2] - view[2] + 2;
      if (q[1] < view[1] + 2) b.dy += view[1] + 2 - q[1];
      b.dx = Math.max(-44, Math.min(44, b.dx));
      b.dy = Math.max(-60, Math.min(0, b.dy));
    }
    if (!moved) break;
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
