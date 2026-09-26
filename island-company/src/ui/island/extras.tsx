// What the island gains between tiers (src/sim/growth.ts flourishes), plus
// the finished dock. Every piece has a reserved spot in geo.tsx SPOT.
import { curve, DOCK, lin, P, SPOT, type Pt } from './geo';
import { Dinghy, Yacht } from './craft';
import { K, mix, tones } from './paint';
import { blob } from './rocks';
import { box, hip, post } from './solid';

const pt = (x: number, y: number, z: number) => P([x, y, z]).map((n) => Math.round(n * 10) / 10).join(' ');

/** the floatplane jetty: a short plank stem from the beach to a T-head
 *  landing lying across the water. Thin deck edges, piles and ripples along
 *  the sunny south and east edges, two bollards, a shadow on the water. */
export function Dock() {
  const [ax, ay] = DOCK.root, [, by] = DOCK.tip;
  const [x0, y0, x1, y1] = DOCK.head;
  const hw = 6;
  const stemPlanks = Array.from({ length: Math.floor((ay - by) / 3.4) }, (_, i) => `M${ax - hw + 0.8} ${ay - 2 - i * 3.4}h${2 * hw - 1.6}`).join('');
  const headPlanks = Array.from({ length: Math.floor((x1 - x0) / 3.4) }, (_, i) => `M${x0 + 2 + i * 3.4} ${y0 + 0.8}v${y1 - y0 - 1.6}`).join('');
  const piles: Pt[] = [
    ...Array.from({ length: 5 }, (_, i) => [x0 + 4 + (i * (x1 - x0 - 8)) / 4, y1 + 2] as Pt),
    [ax + hw, ay - 12], [ax + hw, by + 12], [x1, y0 + 6],
  ];
  return (
    <g>
      {/* shadow on the water */}
      <path d={`M${x0 + 5} ${y0 + 5}H${x1 + 5}V${y1 + 5}H${ax + hw + 5}V${ay}H${ax - hw + 5}V${y1 + 5}H${x0 + 5}Z`} fill="rgba(10,60,120,.24)" />
      {/* piles standing in the water, a ring of ripple round each */}
      <path d={piles.map(([x, y]) => `M${x - 2.4} ${y + 4.4}a3.4 1.2 0 1 0 6.8 0a3.4 1.2 0 1 0 -6.8 0`).join('')} fill="none" stroke="#fff" stroke-width=".9" opacity=".8" />
      <path d={piles.map(([x, y]) => `M${x} ${y}v4.2`).join('')} stroke="#5a3a20" stroke-width="2.4" stroke-linecap="round" />
      {/* the stem: a thin east edge, then the deck */}
      <path d={`M${ax + hw} ${y1}V${ay}h1.6V${y1}Z`} fill={K.woodDark} />
      <path d={`M${ax - hw} ${ay}V${y1}H${ax + hw}V${ay}Z`} fill={K.woodLight} />
      <path d={stemPlanks} stroke={mix(K.woodLight, K.wood, 0.55)} stroke-width=".8" />
      {/* the T-head, lying across the water: a thin south and east edge */}
      <path d={`M${x0} ${y1}H${x1}v1.8H${x0}Z`} fill={K.woodDark} />
      <path d={`M${x1} ${y0}v${y1 - y0 + 1.8}h1.6V${y0}Z`} fill={mix(K.woodDark, '#000', 0.15)} />
      <path d={`M${x0} ${y0}H${x1}V${y1}H${x0}Z`} fill={K.woodLight} />
      <path d={headPlanks} stroke={mix(K.woodLight, K.wood, 0.55)} stroke-width=".8" />
      {/* two bollards and a coil of rope */}
      {[[x0 + 4, y0 + 3], [x1 - 4, y0 + 3]].map(([x, y], i) => (
        <g key={i}>
          <path d={`M${x} ${y + 1.6}v-3`} stroke="#3e3a36" stroke-width="3.4" stroke-linecap="round" />
          <circle cx={x} cy={y - 1.6} r={1.5} fill="#6b6560" />
        </g>
      ))}
      <circle cx={x0 + 16} cy={(y0 + y1) / 2} r={2.4} fill="none" stroke="#e8d8b0" stroke-width="1.3" />
      {/* barrels and crates at the root */}
      <g transform={`translate(${ax - 18} ${ay - 2})`}>
        <ellipse cx={4} cy={2} rx={8} ry={2.5} fill={K.shadowSand} />
        <path d="M-4 0v-8a4 1.6 0 0 1 8 0v8a4 1.6 0 0 1 -8 0z" fill="#a86a38" />
        <ellipse cx={0} cy={-8} rx={4} ry={1.6} fill="#c98a52" />
        <path d="M-4 -3h8M-4 -6h8" stroke="#6b4a2e" stroke-width=".9" />
        <path d="M6 0h9v-8h-9z" fill={K.woodLight} stroke={K.woodDark} stroke-width="1" />
        <path d="M6 -8l3 -2.5h9l-3 2.5zM15 0l3 -2.5v-8l-3 2.5z" fill={K.wood} />
      </g>
    </g>
  );
}

/** two floodlight masts on the apron's north edge, one over each stand */
const MASTS: { at: Pt; pool: [number, number, number, number] }[] = [
  { at: [256, 297], pool: [214, 339, 50, 23] },
  { at: [334, 300], pool: [300, 338, 44, 21] },
];
const MAST_H = 32;
/** apron props, as screen rects that bubbles keep off */
export const APRON_PROPS: [number, number, number, number][] = [
  [220, 354, 262, 378], // fuel bowser
  [306, 358, 346, 380], // baggage train
  [88, 358, 116, 378], // drums
  ...MASTS.map(({ at: [x, y] }): [number, number, number, number] => [x - 7, y - MAST_H - 4, x + 7, y + 2]),
];
/** life on the apron: a fuel bowser, a baggage train and a stack of drums */
export function ApronProps() {
  const cab = box(10, 18, 0, 8, 0, 8);
  const bed = box(-12, 10, 0, 3, 0, 8);
  const tank = box(-11, 8, 3, 10, 1, 7);
  const cart = box(-6, 6, 0, 5, 0, 7);
  return (
    <g>
      <g transform="translate(236 372)">
        <ellipse cx={4} cy={2} rx={17} ry={4} fill={K.shadow} />
        <path d={bed.front + bed.side} fill="#4a5258" />
        <path d={tank.side} fill="#c9ced1" />
        <path d={tank.front} fill="#eef1f2" />
        <path d={tank.top} fill="#ffffff" />
        <path d="M-9 -6h15" stroke={K.red} stroke-width="1.6" />
        <path d={cab.side} fill="#a8322a" />
        <path d={cab.front} fill="#e8453c" />
        <path d={cab.top} fill="#ff6b5e" />
        <path d="M12 -6.5h4.4v3h-4.4z" fill="#bfe6f5" />
        <path d="M-7 0.6a2 2 0 1 0 .1 0M5 0.6a2 2 0 1 0 .1 0M14 0.6a2 2 0 1 0 .1 0" fill="#2f3438" />
      </g>
      {[[318, 372, '#3a8ee6'], [334, 368, '#f2c230']].map(([x, y, c], i) => (
        <g key={i} transform={`translate(${x} ${y})`}>
          <path d={cart.front + cart.side} fill="#56606a" />
          <path d={cart.top} fill={c as string} />
          <path d="M-4 0.6a1.6 1.6 0 1 0 .1 0M4 0.6a1.6 1.6 0 1 0 .1 0" fill="#2f3438" />
        </g>
      ))}
      {/* floodlight masts */}
      <path d={MASTS.map(({ at: [x, y] }) => `M${x} ${y}V${y - MAST_H}`).join('')} stroke="#5f6a72" stroke-width="2" />
      <path d={MASTS.map(({ at: [x, y] }) => `M${x - 6} ${y - MAST_H - 2}h12v3.6h-12z`).join('')} fill="#e3e8ea" stroke="#3f4a52" stroke-width=".8" />
      <g transform="translate(96 372)">
        <ellipse cx={8} cy={2} rx={13} ry={3} fill={K.shadow} />
        <path d="M-4 0v-8a4 1.6 0 0 1 8 0v8a4 1.6 0 0 1 -8 0zM5 1v-8a4 1.6 0 0 1 8 0v8a4 1.6 0 0 1 -8 0z" fill="#2e7c93" />
        <path d="M0 -8m-4 0a4 1.6 0 1 0 8 0a4 1.6 0 1 0 -8 0M9 -7m-4 0a4 1.6 0 1 0 8 0a4 1.6 0 1 0 -8 0" fill="#5aa7bd" />
        <path d="M-4 -3h8M5 -2h8" stroke="#1f5c6e" stroke-width=".9" />
      </g>
    </g>
  );
}

/** The airfield at night, drawn over the grade while the island has power:
 *  warm light from the hangar (its door windows, or the open mouth while
 *  the twin is worked on) spilling onto the forecourt, and the two
 *  floodlights throwing a cone down onto a pool round each stand. */
export function ApronLights({ hangar: [hx, hy], open }: { hangar: Pt; open: boolean }) {
  const heads = MASTS.map(({ at: [x, y] }) => `M${x} ${y - MAST_H}h.01`).join('');
  return (
    <g>
      <path d={`M${hx - 36} ${hy}L${hx + 36} ${hy}L${hx + 60} ${hy + 42}L${hx - 52} ${hy + 42}Z`} fill="url(#i-spill)" />
      {open ? (
        <path d={`M${hx - 34} ${hy}V${hy - 29}H${hx + 34}V${hy}Z`} fill="#ffcf6e" opacity=".8" />
      ) : (
        <path d={Array.from({ length: 5 }, (_, i) => `M${hx - 33 + i * 13.5} ${hy - 25}h9.5v4.4h-9.5z`).join('')} fill="#ffd966" stroke="#f0a848" stroke-width=".6" />
      )}
      <path
        d={MASTS.map(({ at: [x, y], pool: [px, py, rx, ry] }) => `M${x - 5} ${y - MAST_H + 1}H${x + 5}L${px + rx * 0.75} ${py + ry * 0.62}L${px - rx * 0.9} ${py + ry * 0.3}Z`).join('')}
        fill="url(#i-cone)"
      />
      {MASTS.map(({ pool: [px, py, rx, ry] }, i) => (
        <ellipse key={i} cx={px} cy={py} rx={rx} ry={ry} fill="url(#i-pool)" />
      ))}
      <path d={heads} stroke="#ffe7a0" stroke-width="12" stroke-linecap="round" opacity=".4" />
      <path d={MASTS.map(({ at: [x, y] }) => `M${x - 6} ${y - MAST_H - 2}h12v3.6h-12z`).join('')} fill="#fff8dc" />
    </g>
  );
}

export function GardenBeds() {
  return (
    <g>
      {SPOT.garden.map(([x, y], i) => {
        const b = box(-15, 15, 0, 5, 0, 10);
        return (
          <g key={i} transform={`translate(${x} ${y})`}>
            <path d={b.front + b.side} fill={K.woodDark} />
            <path d={b.top} fill="#7a5234" />
            <path d="M-11 -6a3 3 0 1 0 .1 0M-4 -9a3.2 3.2 0 1 0 .1 0M3 -6a3 3 0 1 0 .1 0M10 -9a2.8 2.8 0 1 0 .1 0M14 -6a2.4 2.4 0 1 0 .1 0" fill={i ? K.yellow : K.pink} />
            <path d="M-8 -10a2.6 2.6 0 1 0 .1 0M-1 -5a2.4 2.4 0 1 0 .1 0M6 -10a2.4 2.4 0 1 0 .1 0M12 -4a2 2 0 1 0 .1 0" fill={i ? '#fff' : K.purple} />
            <path d="M-12 -4l2 -3M-5 -4l1 -4M2 -4l1 -3M9 -4l1 -4" stroke={K.leafDark} stroke-width="1.4" />
          </g>
        );
      })}
    </g>
  );
}

export const Bench = ({ x, y, flip }: { x: number; y: number; flip?: boolean }) => <use href="#i-bench" transform={`translate(${x} ${y})${flip ? ' scale(-1 1)' : ''}`} />;
export const Lamp = ({ x, y }: { x: number; y: number }) => <use href="#i-lamp" transform={`translate(${x} ${y})`} />;

/** a newly planted palm grove: a freshly mown, irregular clearing in the
 *  grass, a ring of sandy mulch round each young palm, planted off-grid, and
 *  each sapling's shadow. All ground: the mountain's foot is drawn over the
 *  clearing's top, and the saplings (terrain.tsx) are y-sorted with the wood. */
const GX = SPOT.grove.map((p) => p[0]), GY = SPOT.grove.map((p) => p[1]);
const GC: Pt = [(Math.min(...GX) + Math.max(...GX)) / 2, (Math.min(...GY) + Math.max(...GY)) / 2];
const CLEARING = curve(blob(GC[0] - 2, GC[1] + 4, (Math.max(...GX) - Math.min(...GX)) / 2 + 16, (Math.max(...GY) - Math.min(...GY)) / 2 + 12, 311, 11, 0.12));
const ring = (x: number, y: number, rx: number, ry: number) => `M${x - rx} ${y}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0`;
export function GroveField() {
  return (
    <g>
      <path d={CLEARING} fill={mix(K.grassLight, K.grassLighter, 0.5)} opacity=".75" />
      <path d={SPOT.grove.map(([x, y]) => ring(x + 1, y + 0.5, 9, 3.6)).join('')} fill="#e6cf98" />
      <path d={SPOT.grove.map(([x, y]) => ring(x + 1, y + 0.5, 5.6, 2.2)).join('')} fill="#c9a86a" />
      <path d={SPOT.grove.map(([x, y]) => ring(x + 11, y + 1, 9, 2.8)).join('')} fill={K.shadow} />
    </g>
  );
}

export function FishingBoats() {
  return (
    <g>
      <Dinghy x={SPOT.boats[0][0]} y={SPOT.boats[0][1]} rot={40} hull="#3a8ee6" />
      <Dinghy x={SPOT.boats[1][0]} y={SPOT.boats[1][1]} rot={24} hull="#f2c230" />
      <path d={`M${SPOT.boats[0][0] + 22} ${SPOT.boats[0][1] - 18}l10 4l-3 6l-10 -3z`} fill="#c9b27a" opacity=".8" />
    </g>
  );
}

function Umbrella({ x, y, c }: { x: number; y: number; c: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cx={6} cy={1} rx={11} ry={3.5} fill={K.shadowSand} />
      <path d="M0 0V-18" stroke="#8a6a4a" stroke-width="1.4" />
      <path d="M-12 -15Q0 -26 12 -15Z" fill={c} />
      <path d="M-12 -15Q-6 -17 -4 -22M12 -15Q6 -17 4 -22M0 -24V-15" stroke="#fff" stroke-width="2.2" opacity=".85" />
    </g>
  );
}
/** a beach umbrella folded up against the weather */
function Furled({ x, y, c }: { x: number; y: number; c: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cx={3} cy={1} rx={5} ry={1.8} fill={K.shadowSand} />
      <path d="M0 0V-20" stroke="#8a6a4a" stroke-width="1.4" />
      <path d="M-2.6 -8L0 -22L2.6 -8Z" fill={c} />
      <path d="M-2 -11h4" stroke="#fff" stroke-width="1" opacity=".7" />
    </g>
  );
}
function Lounger({ x, y, c }: { x: number; y: number; c: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d="M-9 0h14l4 -5h-4l-2 2h-12z" fill="#fff" />
      <path d="M-8 -1.5h12" stroke={c} stroke-width="2" />
    </g>
  );
}

export function BeachBar({ closed }: { closed?: boolean }) {
  const [x, y] = SPOT.bar;
  const w = 16, d = 16, h = 13;
  const r = hip(-w, w, h, 0, d, 13, 6, 8);
  const counter = box(-w, w, 0, 7, -2, 6);
  const posts = [post(-w, 0, h), post(w, 0, h), post(-w, d, h), post(w, d, h)].join('');
  return (
    <g>
      {closed ? (
        <>
          <Furled x={x - 40} y={y + 12} c="#ff6fa8" />
          <Furled x={x + 44} y={y + 10} c="#3a8ee6" />
        </>
      ) : (
        <>
          <Umbrella x={x - 46} y={y + 12} c="#ff6fa8" />
          <Umbrella x={x + 50} y={y + 10} c="#3a8ee6" />
          <Lounger x={x - 66} y={y + 14} c="#ff6fa8" />
          <Lounger x={x + 30} y={y + 14} c="#3a8ee6" />
          <Lounger x={x + 70} y={y + 12} c={K.yellow} />
        </>
      )}
      <g transform={`translate(${x} ${y})`}>
        <path d={`M${pt(-w, 0, 0)}L${pt(w + 12, 0, 0)}L${pt(w + 12, 0, d)}L${pt(-w, 0, d)}Z`} fill={K.shadowSand} />
        <path d={posts} stroke={K.woodDark} stroke-width="2.6" />
        <path d={counter.side} fill={K.woodDark} />
        <path d={counter.front} fill={K.wood} />
        <path d="M-16 -3.5h32" stroke={K.woodDark} stroke-width="1" />
        <path d={counter.top} fill={K.woodLight} />
        <path d={`M${pt(-10, 7, 2)}v-4M${pt(-4, 7, 2)}v-5M${pt(8, 7, 2)}v-4`} stroke="#8fd3ff" stroke-width="2.4" stroke-linecap="round" />
        <path d={r.back} fill="#b8903a" />
        <path d={r.east} fill="#c9a24a" />
        <path d={r.front} fill="#e8c46a" />
        <path d={r.west} fill="#f3d98c" />
        <path d={`M${pt(-w - 6, h - 1.5, -6)}L${pt(w + 6, h - 1.5, -6)}`} stroke="#b8903a" stroke-width="2.4" stroke-dasharray="2 2" />
        {/* stools */}
        <path d="M-10 6v5M0 6v5M10 6v5" stroke={K.woodDark} stroke-width="1.4" />
        <path d="M-12.5 6h5M-2.5 6h5M7.5 6h5" stroke="#ff6fa8" stroke-width="2.4" stroke-linecap="round" />
      </g>
    </g>
  );
}

export function Fountain({ motion }: { motion: boolean }) {
  const [x, y] = SPOT.fountain;
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cx={3} cy={3} rx={20} ry={8} fill={K.shadow} />
      <ellipse cx={0} cy={0} rx={19} ry={8} fill={K.stoneDark} />
      <ellipse cx={0} cy={-3} rx={19} ry={8} fill={K.stoneLight} />
      <ellipse cx={0} cy={-3} rx={15} ry={5.8} fill="#4fc6ee" />
      <ellipse cx={-3} cy={-4} rx={8} ry={2.6} fill="#a8eaff" opacity=".8" />
      <path d="M-3 -3v-10h6v10z" fill={K.stone} />
      <ellipse cx={0} cy={-13} rx={7} ry={2.6} fill={K.stoneLight} />
      <g class={motion ? 'spray' : undefined}>
        <path d="M0 -14q-6 -10 -11 2M0 -14q6 -10 11 2M0 -14v-9" stroke="#bff0ff" stroke-width="2.2" fill="none" stroke-linecap="round" />
      </g>
    </g>
  );
}

function Stall({ x, y, c, goods, closed }: { x: number; y: number; c: string; goods: string; closed?: boolean }) {
  const b = box(-11, 11, 0, 7, 0, 10);
  const t = tones(c);
  const canopy = Array.from({ length: 4 }, (_, i) => {
    const x0 = -13 + i * 6.5;
    return { d: `M${pt(x0, 20, 10)}L${pt(x0 + 6.5, 20, 10)}L${pt(x0 + 6.5, 15, -4)}L${pt(x0, 15, -4)}Z`, c: i % 2 ? '#fff' : t.mid };
  });
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cx={5} cy={2} rx={15} ry={4} fill={K.shadow} />
      <path d={post(-11, -3, 16) + post(11, -3, 16)} stroke={K.woodDark} stroke-width="1.8" />
      <path d={b.side} fill={K.woodDark} />
      <path d={b.front} fill={K.wood} />
      <path d={b.top} fill={K.woodLight} />
      {closed ? (
        // packed away under a tied tarp
        <>
          <path d={`M${pt(-12, 7, -1)}L${pt(12, 7, -1)}L${pt(12, 7, 11)}L${pt(-12, 7, 11)}Z`} fill="#6d8a8c" />
          <path d={`M${pt(-12, 7, -1)}L${pt(12, 7, -1)}L${pt(12, 2, -1)}L${pt(-12, 2, -1)}Z`} fill="#56706f" />
          <path d={`M${pt(-5, 7, -1)}v5M${pt(5, 7, -1)}v5`} stroke="#e8d8b0" stroke-width="1" />
        </>
      ) : (
        <path d={`M${pt(-8, 7, 4)}a2.2 1.4 0 1 0 .1 0M${pt(-2, 7, 5)}a2.2 1.4 0 1 0 .1 0M${pt(4, 7, 4)}a2.2 1.4 0 1 0 .1 0M${pt(9, 7, 5)}a2 1.3 0 1 0 .1 0`} fill={goods} />
      )}
      {canopy.map((s, i) => (
        <path key={i} d={s.d} fill={s.c} />
      ))}
      <path d={`M${pt(-13, 15, -4)}L${pt(13, 15, -4)}`} stroke={t.lo} stroke-width="1.4" />
    </g>
  );
}
export function Market({ closed }: { closed?: boolean }) {
  const [[ax, ay], [bx, by], [cx, cy]] = SPOT.market;
  return (
    <g>
      <Stall x={ax} y={ay} c="#3a8ee6" goods={K.orange} closed={closed} />
      <Stall x={bx} y={by} c="#4caf50" goods={K.yellow} closed={closed} />
      <Stall x={cx} y={cy} c="#a77be0" goods="#ff6fa8" closed={closed} />
    </g>
  );
}

export function Lighthouse() {
  const [x, y] = SPOT.lighthouse;
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cx={12} cy={2} rx={20} ry={5} fill={K.shadow} />
      <path d="M-12 2Q-14 -6 -6 -8H8Q15 -6 12 2Z" fill="#9c8876" />
      <path d="M-10 -4Q-8 -9 -2 -9H6Q12 -8 10 -4Z" fill="#bda994" />
      <path d="M-8 -6L-5.5 -52H5.5L8 -6Z" fill="#fbfbf7" />
      <path d="M0 -6L0 -52H5.5L8 -6Z" fill="#d9dde0" />
      <path d="M-7.6 -14L-7.1 -22H7.1L7.6 -14ZM-6.7 -32L-6.2 -40H6.2L6.7 -32Z" fill="#2f6fb8" />
      <path d="M-8 -52h16v3h-16z" fill="#3f4a52" />
      <path d="M-5 -52v-8h10v8z" fill="#ffe27a" stroke="#3f4a52" stroke-width="1.4" />
      <path d="M-7 -60L0 -67L7 -60Z" fill="#2f6fb8" />
      <path d="M-2 -20v-6h4v6z" fill="#3f4a52" />
    </g>
  );
}

/** the stargazing dome: a drum, a white dome with its shutter slit open and
 *  the telescope poking out. `lit`: the night layer, drawn over the grade. */
const OBS_SLIT = 'M-2.4 -10L-1.4 -21.2L2.6 -21.2L3.6 -10Z';
const OBS_SCOPE = 'M1.4 -15.6L10 -26.6';
export function Observatory({ lit }: { lit?: boolean }) {
  const [x, y] = SPOT.observatory;
  if (lit)
    return (
      <g transform={`translate(${x} ${y})`} pointer-events="none">
        <circle cx={1} cy={-15} r={15} fill="url(#i-glow)" opacity=".85" />
        <path d={OBS_SLIT} fill="#ffd966" stroke="#ffb347" stroke-width=".7" />
        <path d={OBS_SCOPE} stroke="#2f3a44" stroke-width="3" stroke-linecap="round" />
        <path d="M-2 0v-5.6h4v5.6z" fill="#ffd966" />
      </g>
    );
  const b = box(-11, 11, 0, 10, 0, 14);
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cx={8} cy={1} rx={15} ry={3.6} fill={K.shadow} />
      <path d={b.side} fill="#c9ced1" />
      <path d={b.front} fill="#eef1f2" />
      <path d="M-11 -4h22" stroke="#c9ced1" stroke-width="1" />
      <path d="M-12.4 -10A12.4 11.4 0 0 1 12.4 -10Z" fill="#fbfbf7" />
      <path d="M0 -21.4A12.4 11.4 0 0 1 12.4 -10H0Z" fill="#dfe3e6" />
      <path d={OBS_SLIT} fill="#33455a" />
      <path d={OBS_SCOPE} stroke="#5a6470" stroke-width="3" stroke-linecap="round" />
      <path d="M8.6 -24.8l2.8 -3.6" stroke="#3e4852" stroke-width="3.6" stroke-linecap="round" />
      <path d="M-2 0v-5.6h4v5.6z" fill="#6f7a82" />
    </g>
  );
}

export function Boardwalk() {
  const d = lin(SPOT.boardwalk);
  return (
    <g fill="none">
      <path d={d} stroke="rgba(150,100,40,.3)" stroke-width="14" transform="translate(3 4)" />
      <path d={d} stroke={K.woodDark} stroke-width="13" />
      <path d={d} stroke={K.woodLight} stroke-width="11" stroke-dasharray="3.4 1.2" transform="translate(0 -1.5)" />
      <path d={SPOT.boardwalk.map(([x, y]) => `M${x} ${y + 6}v4`).join('')} stroke={K.woodDark} stroke-width="2.4" />
    </g>
  );
}

export function YachtAt() {
  const [x, y] = SPOT.yacht;
  return (
    <g transform={`translate(${x} ${y})`}>
      <Yacht />
    </g>
  );
}

/** The crew statue (beat the game): the mechanic with a raised wrench, the
 *  electrician in a hard hat with a coil of cable, the analyst with a tablet,
 *  cast in bronze on a pale stone plinth with a plaque, on a paved roundel.
 *  `lit`: the night layer, floodlit from the plinth, drawn over the grade. */
const BRONZE = { hi: '#e2b36a', mid: '#a9743a', lo: '#6b4520', ink: '#4e3116' };
const BRONZE_LIT = { hi: '#fff0c4', mid: '#eab466', lo: '#a86e34', ink: '#7a4c20' };
const STONE = { top: '#fbf7ee', front: '#efe7d6', side: '#cbbfa9', step: '#dcd2bf', stepTop: '#ece5d6', stepSide: '#b7ab96' };
const STONE_LIT = { top: '#fffaf0', front: '#fff4dc', side: '#e6d3ad', step: '#f2e4c6', stepTop: '#fbf2de', stepSide: '#d9c49c' };
function crew() {
  // three figures standing on the plinth top (screen units, base line y = -19)
  const by = -19;
  const body = (fx: number, h: number) => {
    const leg = h * 0.38, torso = h * 0.36;
    return (
      `M${fx - 2.9} ${by}v${-leg}h2.4v${leg}zM${fx + 0.5} ${by}v${-leg}h2.4v${leg}z` +
      `M${fx - 3.5} ${by - leg + 0.6}v${-torso + 2}q0 -2 2 -2h3q2 0 2 2v${torso - 2}z` +
      `M${fx - 2.5} ${by - leg - torso - 2.4}a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0`
    );
  };
  const m = -9, e = 0.5, a = 10; // mechanic, electrician, analyst
  return {
    fill:
      body(m, 19) +
      body(e, 21) +
      body(a, 18) +
      // mechanic: a cap with a peak; electrician: a hard hat; analyst: a bun and a tablet held out
      `M${m - 2.7} ${by - 19.2}a2.7 2.2 0 0 1 5.4 0h2v1h-7.4z` +
      `M${e - 3.4} ${by - 21.3}a3.4 3.2 0 0 1 6.8 0h1.2v1.2h-9.2v-1.2z` +
      `M${a + 1.2} ${by - 20.4}a1.5 1.5 0 1 0 .1 0`,
    arms:
      // the mechanic raises a wrench, the electrician raises a fist, the analyst holds the tablet
      `M${m - 2.6} ${by - 12.2}L${m - 7} ${by - 21.5}M${e + 2.8} ${by - 13.4}L${e + 6.4} ${by - 23}M${e - 2.8} ${by - 12.6}l-1.6 5.4M${a - 2.6} ${by - 11.4}l3 3.4h3.2`,
    tool: `M${m - 7} ${by - 21.5}l-2.2 -2.4M${m - 7} ${by - 21.5}l.6 -3`,
    coil: `M${e - 7.6} ${by - 6.6}a2.4 2.4 0 1 0 4.8 0a2.4 2.4 0 1 0 -4.8 0`,
    tablet: `M${a + 0.6} ${by - 13.4}h5.2v6.4h-5.2z`,
    shade: `M${m + 0.5} ${by}v-7.2h2.4v7.2zM${e + 0.5} ${by}v-8h2.4v8zM${a + 0.5} ${by}v-6.8h2.4v6.8zM${m + 1.5} ${by - 6.6}v-5q2 0 2 2v3zM${e + 1.5} ${by - 7.4}v-5.6q2 0 2 2v3.6zM${a + 1.5} ${by - 6.2}v-4.6q2 0 2 2v2.6z`,
  };
}
const CREW = crew();
export function Statue({ lit }: { lit?: boolean }) {
  const [x, y] = SPOT.statue;
  const step = box(-19, 19, 0, 3, -4, 16);
  const plinth = box(-14.5, 14.5, 3, 16, 0, 12);
  const b = lit ? BRONZE_LIT : BRONZE;
  const st = lit ? STONE_LIT : STONE;
  return (
    <g transform={`translate(${x} ${y})`} pointer-events={lit ? 'none' : undefined}>
      {lit ? (
        // two floodlights at the foot of the plinth throw light up the figures
        <>
          <path d="M-15 -2L-26 -52L-2 -52ZM15 -2L2 -52L26 -52Z" fill="url(#i-flood)" />
          <circle cx={0} cy={-26} r={26} fill="url(#i-glow)" opacity=".55" />
        </>
      ) : (
        <>
          <ellipse cx={3} cy={-3} rx={33} ry={13} fill={K.stoneDark} />
          <ellipse cx={2} cy={-4.5} rx={32} ry={12} fill={K.stoneLight} />
          <ellipse cx={2} cy={-4.5} rx={26} ry={9} fill="none" stroke={K.stone} stroke-width="1.6" stroke-dasharray="4 2" />
          <ellipse cx={13} cy={-3} rx={19} ry={5} fill={K.shadow} />
        </>
      )}
      <path d={step.top} fill={st.stepTop} />
      <path d={step.side} fill={st.stepSide} />
      <path d={step.front} fill={st.step} />
      <path d={plinth.top} fill={st.top} />
      <path d={plinth.side} fill={st.side} />
      <path d={plinth.front} fill={st.front} />
      {/* bronze plaque */}
      <path d="M-7.5 -12h15v6h-15z" fill={b.lo} stroke={b.hi} stroke-width=".8" />
      <path d="M-5 -9h10" stroke={b.hi} stroke-width=".9" opacity=".8" />
      <path d={CREW.fill} fill={b.mid} />
      <path d={CREW.shade} fill={b.lo} opacity=".8" />
      <path d={CREW.arms} stroke={b.mid} stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" fill="none" />
      <path d={CREW.tool} stroke={b.hi} stroke-width="1.6" stroke-linecap="round" fill="none" />
      <path d={CREW.coil} stroke={b.hi} stroke-width="1.3" fill="none" />
      <path d={CREW.tablet} fill={b.hi} stroke={b.lo} stroke-width=".6" />
      {/* a highlight down the lit (west) side of each figure */}
      <path d="M-11.6 -21v-7M-2.1 -21.6v-8M7.4 -20.8v-6.6" stroke={b.hi} stroke-width="1.1" stroke-linecap="round" opacity=".9" />
      {lit && <path d="M-15 -1.4h2.6M12.4 -1.4h2.6" stroke="#fff6c8" stroke-width="2.2" stroke-linecap="round" />}
    </g>
  );
}

/** strings of little flags across the square (with bulbs that glow at night) */
export const BUNTING: [Pt, Pt][] = [
  [[352, 300], [488, 302]],
  [[358, 326], [484, 328]],
];
const quadAt = (a: Pt, b: Pt, t: number, sag: number): Pt => {
  const m: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + sag * 2];
  return [(1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * m[0] + t * t * b[0], (1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * m[1] + t * t * b[1]];
};
export const buntingBulbs = (): Pt[] => BUNTING.flatMap(([a, b]) => [0.2, 0.5, 0.8].map((t) => quadAt(a, b, t, 12)));
export function Bunting({ motion }: { motion: boolean }) {
  const cols = ['#ff6fa8', '#ffd23f', '#3a8ee6', '#4caf50', '#a77be0', '#ff8c42'];
  const flags: string[][] = cols.map(() => []);
  BUNTING.forEach(([a, b], li) => {
    const n = 11;
    for (let i = 0; i < n; i++) {
      const [fx, fy] = quadAt(a, b, (i + 0.5) / n, 12);
      flags[(i + li) % cols.length].push(`M${(fx - 3).toFixed(1)} ${fy.toFixed(1)}h6l-3 6z`);
    }
  });
  return (
    <g>
      <path d={BUNTING.map(([a, b]) => `M${a[0]} ${a[1]}Q${(a[0] + b[0]) / 2} ${(a[1] + b[1]) / 2 + 24} ${b[0]} ${b[1]}`).join('')} stroke="#6b5a4a" stroke-width=".8" fill="none" />
      <g class={motion ? 'flutter' : undefined}>
        {cols.map((c, i) => (
          <path key={c} d={flags[i].join('')} fill={c} />
        ))}
      </g>
      <path d={BUNTING.map(([a, b]) => `M${a[0]} ${a[1]}v34M${b[0]} ${b[1]}v34`).join('')} stroke="#7a5534" stroke-width="1.6" />
    </g>
  );
}

/** Festoon lights (the finale): strung lamp to lamp across the top of the
 *  square and on along the path to the bridge. By day pale bulbs on a dark
 *  wire; `lit` is the night layer over the grade, each bulb with a halo. */
export const FESTOON: [Pt, Pt][] = [
  [[358, 281], [484, 283]],
  [[484, 283], [548, 295]],
];
const festoonBulbs = (): Pt[] =>
  FESTOON.flatMap(([a, b]) => {
    const n = Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 9);
    return Array.from({ length: n - 1 }, (_, i) => quadAt(a, b, (i + 1) / n, 5));
  });
export function Festoon({ lit }: { lit?: boolean }) {
  const bulbs = festoonBulbs();
  const dots = bulbs.map(([x, y]) => `M${x.toFixed(1)} ${(y + 1.6).toFixed(1)}h.1`).join('');
  if (lit)
    return (
      <g fill="none" stroke-linecap="round" pointer-events="none">
        <path d={dots} stroke="#ffc861" stroke-width="7" opacity=".4" />
        <path d={dots} stroke="#fff4c0" stroke-width="2.8" />
      </g>
    );
  return (
    <g fill="none" stroke-linecap="round">
      <path d={FESTOON.map(([a, b]) => `M${a[0]} ${a[1]}Q${(a[0] + b[0]) / 2} ${(a[1] + b[1]) / 2 + 10} ${b[0]} ${b[1]}`).join('')} stroke="#3e3a36" stroke-width=".8" />
      <path d={dots} stroke="#6b5a4a" stroke-width="3.2" />
      <path d={dots} stroke="#fff6d6" stroke-width="2.2" />
    </g>
  );
}

/** fireworks while the crew is celebrating, at night: bursting over the
 *  open sea north of the lagoon, their trails well clear of the moored
 *  floatplane and the dock. Rays merged per colour; the sparks, the cores and
 *  the trails of all three in one path each. */
const BURSTS: [number, number, number, string, string][] = [
  [212, 46, 24, '#ffd23f', '#fff4c0'],
  [150, 76, 18, '#ff6fa8', '#ffd0e4'],
  [272, 64, 15, '#7fe8ff', '#e0fbff'],
];
const f1 = (n: number) => n.toFixed(1);
const FIREWORKS = (() => {
  const rays: string[] = [], tips: string[] = [], cores: string[] = [], trails: string[] = [];
  BURSTS.forEach(([x, y, r], i) => {
    const n = 14;
    let d = '';
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + i * 0.4, c = Math.cos(a), s = Math.sin(a);
      d += `M${f1(x + c * r * 0.34)} ${f1(y + s * r * 0.34)}L${f1(x + c * r)} ${f1(y + s * r)}`;
      tips.push(`M${f1(x + c * (r + 3))} ${f1(y + s * (r + 3) + 1.5)}h.1`);
    }
    rays.push(d);
    cores.push(`M${x} ${y}h.1`);
    // the shell's trail: short, rising from open water under the burst
    trails.push(`M${x + 2} ${y + r + 20}q-3 ${-(r * 0.4 + 6)} -2 ${-(r * 0.7 + 20)}`);
  });
  return { rays, tips: tips.join(''), cores: cores.join(''), trails: trails.join('') };
})();
export function Fireworks() {
  return (
    <g fill="none" stroke-linecap="round" pointer-events="none">
      {BURSTS.map(([x, y, r, c], i) => (
        <circle key={`h${i}`} cx={x} cy={y} r={r * 1.15} fill={c} opacity=".14" stroke="none" />
      ))}
      <path d={FIREWORKS.trails} stroke="#ffe7b0" stroke-width="1.2" stroke-dasharray="2 3" opacity=".6" />
      {BURSTS.map(([, , , c], i) => (
        <path key={`r${i}`} d={FIREWORKS.rays[i]} stroke={c} stroke-width="2.2" />
      ))}
      {BURSTS.map(([, , , , hi], i) => (
        <path key={`i${i}`} d={FIREWORKS.rays[i]} stroke={hi} stroke-width=".9" />
      ))}
      <path d={FIREWORKS.tips} stroke="#fff6dc" stroke-width="2.6" />
      <path d={FIREWORKS.cores} stroke="#fff" stroke-width="5.2" />
    </g>
  );
}

/** the visiting yacht's lights at night: portholes, the saloon, the masthead */
export function YachtLights() {
  const [x, y] = SPOT.yacht;
  return (
    <g transform={`translate(${x} ${y})`} pointer-events="none">
      <path d="M-24 1.6h.1M-15 1.6h.1M-6 1.6h.1M3 1.6h.1M12 1.6h.1M21 1.6h.1" stroke="#ffe7a0" stroke-width="2.6" stroke-linecap="round" />
      <path d="M-16 -8V-12H12L16 -8Z" fill="#ffd966" />
      <path d="M-7 -15.5h12" stroke="#ffd966" stroke-width="2" />
      <circle cx={0} cy={-26} r={7} fill="url(#i-glow)" />
      <circle cx={0} cy={-26} r={1.8} fill="#fff" />
      <path d="M-22 12q6 -2 12 0M-4 14q8 -2.4 16 0M18 12q5 -2 10 0" stroke="#ffd98a" stroke-width="1.6" fill="none" stroke-linecap="round" opacity=".7" />
    </g>
  );
}

/** confetti over the square after an A week */
export function Confetti({ motion }: { motion: boolean }) {
  const cols = ['#ff6fa8', '#ffd23f', '#3a8ee6', '#4caf50', '#a77be0', '#ff8c42'];
  const pts = Array.from({ length: 36 }, (_, i) => [350 + ((i * 53) % 150), 240 + ((i * 37) % 130), ((i * 47) % 7) - 3] as const);
  return (
    <g class={motion ? 'confetti' : undefined}>
      {cols.map((c, ci) => (
        <path key={c} d={pts.filter((_, i) => i % cols.length === ci).map(([x, y, k]) => `M${x} ${y}l4 ${k}l-1 2.4l-4 ${-k}z`).join('')} fill={c} />
      ))}
    </g>
  );
}

/** a pennant string on a new building for the week it arrived */
export function NewFlags({ x, y, w }: { x: number; y: number; w: number }) {
  const cols = ['#ff6fa8', '#ffd23f', '#3a8ee6', '#4caf50', '#ff8c42'];
  const n = Math.round(w / 7);
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d={`M${-w / 2} 0Q0 10 ${w / 2} 0`} stroke="#6b5a4a" stroke-width=".8" fill="none" />
      {Array.from({ length: n }, (_, i) => {
        const t = (i + 0.5) / n;
        const fx = -w / 2 + w * t, fy = 10 * 2 * t * (1 - t) * 1;
        return <path key={i} d={`M${(fx - 2.6).toFixed(1)} ${fy.toFixed(1)}h5.2l-2.6 5z`} fill={cols[i % cols.length]} />;
      })}
    </g>
  );
}

