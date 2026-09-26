// Mobile-game notification bubbles that sit on the asset: a chunky rounded
// bubble with a pointer and one bold icon. Rust = out of service (the only
// alert hue), sunflower = warning. Positioned by an outer <g transform>,
// counter-scaled against the zoom by a middle <g>, bobbed by an inner <g>.
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
      return (
        <text x={0} y={6.5} text-anchor="middle" font-size="19" font-weight="900" fill={ink} font-family="system-ui, sans-serif" letter-spacing="-1">
          $!
        </text>
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

export function Bubble({ x, y, icon, tone = 'alert', small, scale, motion }: { x: number; y: number; icon: Icon; tone?: Tone; small?: boolean; scale: number; motion: boolean }) {
  const t = TONE[tone];
  const k = scale * (small ? 0.88 : 1.1);
  const body = 'M-20 -46H20A12 12 0 0 1 32 -34V-24A12 12 0 0 1 20 -12H7L0 -3L-7 -12H-20A12 12 0 0 1 -32 -24V-34A12 12 0 0 1 -20 -46Z';
  const narrow = icon !== 'cash';
  const d = narrow ? 'M-11 -46H11A12 12 0 0 1 23 -34V-24A12 12 0 0 1 11 -12H7L0 -3L-7 -12H-11A12 12 0 0 1 -23 -24V-34A12 12 0 0 1 -11 -46Z' : body;
  return (
    <g transform={`translate(${Math.round(x)} ${Math.round(y)})`}>
      <g class="bub-scale" style={{ transform: `scale(${k})` }}>
        <g class={motion ? 'bob' : undefined}>
          <ellipse cx={3} cy={-1} rx={9} ry={3} fill="rgba(0,0,0,.22)" />
          <path d={d} fill={t.base} transform="translate(0 3.5)" />
          <path d={d} fill={t.body} stroke="#fff" stroke-width="3" stroke-linejoin="round" />
          <path d={narrow ? 'M-12 -41H12' : 'M-21 -41H21'} stroke="#fff" stroke-width="2.6" stroke-linecap="round" opacity=".35" />
          <g transform="translate(0 -29)">
            <Glyph icon={icon} ink={t.ink} sub={t.sub} />
          </g>
        </g>
      </g>
    </g>
  );
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
