// Ground power carts on the apron: a small battery cart with its charge light
// (green, amber, red), a cable to the charger outlet on the hangar wall while it
// charges, and to the plane's external power receptacle when it is hooked up.
// Tapping one opens the ground power sheet (role=button, keyboard too).
import type { JSX } from 'preact';
import type { GseCart } from '../../sim/types';
import { DOCK, HANGAR, type Pt } from './geo';
import { K } from './paint';
import { box } from './solid';

/** where the carts park by the hangar (on the charger, or just parked) */
export const CART_HOME: Pt[] = [
  [212, 308],
  [104, 330],
];
/** the charger outlet on the hangar's front wall, one per parking spot (east corner, west corner) */
export const CART_OUTLET: Pt[] = [
  [HANGAR[0] + 50, HANGAR[1] - 9],
  [HANGAR[0] - 46, HANGAR[1] - 9],
];

/** the cart beside a plane it is hooked to: by the nose, on the west side; on the dock's T-head for the floatplane */
export function cartBeside(model: string, at: Pt): Pt {
  if (model === 'float') return [DOCK.head[2] - 12, DOCK.head[1] + 8];
  return [at[0] - 24, at[1] + 20];
}
/** the plane's external power receptacle: the fuselage's west side, forward of the wing */
export function receptacle(model: string, at: Pt): Pt {
  if (model === 'float') return [at[0] - 2, at[1] + 7];
  return [at[0] - 5, at[1] + 17];
}

/** a start needs 30%: green from 60, amber from 30, red below */
export const cartLight = (charge: number) => (charge >= 60 ? '#5be07a' : charge >= 30 ? '#ffb52e' : '#ff4a3a');

const BODY = box(-6.5, 6.5, 2, 9, 0, 6);

/** a cable with a little slack, from the cart's reel to where it plugs in */
export const cablePath = (from: Pt, to: Pt) => {
  const mx = (from[0] + to[0]) / 2;
  const my = Math.max(from[1], to[1]) + 3;
  return `M${from[0]} ${from[1]}Q${mx} ${my} ${to[0]} ${to[1]}`;
};

export function GpuCart({
  cart,
  at,
  plug,
  tagged,
  label,
  onTap,
}: {
  cart: Pick<GseCart, 'id' | 'charge'>;
  at: Pt;
  /** where its cable runs: the hangar charger or the plane's receptacle (none when parked) */
  plug: Pt | null;
  /** its cable is tagged out (cracked at the plug) */
  tagged: boolean;
  label: string;
  onTap?: () => void;
}) {
  const [x, y] = at;
  const tap = onTap
    ? {
        role: 'button',
        // SVG takes the attribute in lower case (a camel-cased one is ignored)
        tabindex: 0,
        'aria-label': label,
        onClick: (e: Event) => {
          e.stopPropagation();
          onTap();
        },
        onKeyDown: (e: KeyboardEvent) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          e.stopPropagation();
          onTap();
        },
      }
    : {};
  const reel: Pt = [x + 5, y - 6];
  return (
    <g class={onTap ? 'gse-cart' : undefined} {...(tap as JSX.SVGAttributes<SVGGElement>)}>
      {plug && <path d={cablePath(reel, plug)} fill="none" stroke="#23292c" stroke-width="1.3" stroke-linecap="round" />}
      <g transform={`translate(${x} ${y})`}>
        <ellipse cx={3} cy={1.4} rx={10} ry={2.6} fill={K.shadow} />
        <path d="M-6.5 -1.2l-6 2.4" stroke="#3b464b" stroke-width="1.4" stroke-linecap="round" />
        <path d={BODY.front} fill="#f2c230" />
        <path d={BODY.side} fill="#c99a1a" />
        <path d={BODY.top} fill="#ffe27a" />
        <path d="M-4.5 -7.4h5v2.6h-5z" fill="#3b464b" />
        <path d="M-4.2 -2.8a1.8 1.8 0 1 0 .1 0M4.2 -2.8a1.8 1.8 0 1 0 .1 0" fill="#2f3438" />
        <circle cx={3.6} cy={-11.2} r={1.9} fill={cartLight(cart.charge)} stroke="#3b464b" stroke-width=".5" />
        {tagged && <path d="M7.5 -8.5h3.4v4.8h-3.4z" fill={K.red} stroke="#8a2a22" stroke-width=".5" />}
        {onTap && <rect class="hit" x={-22} y={-30} width={44} height={44} rx={8} fill="transparent" />}
      </g>
    </g>
  );
}
