// Build sites for tiers still to come. Subtle while they are only planned
// (cleared plot, survey stakes, a buoy); a real construction site while the
// crew project is under way: 0 stakes, string lines and lumber, 1 slabs
// poured, 2 timber frames and scaffolding (and a tower crane on the houses).
import { DOCK, lin, P, type Pt, type V3 } from './geo';
import { K, mix } from './paint';
import { box, post, seg } from './solid';

export type SiteKind = 'house' | 'villa' | 'lodge' | 'gen';
const DIM: Record<SiteKind, { w: number; d: number; h: number }> = {
  house: { w: 20, d: 26, h: 18 },
  villa: { w: 30, d: 32, h: 32 },
  lodge: { w: 30, d: 40, h: 22 },
  gen: { w: 18, d: 22, h: 16 },
};

const quad = (x0: number, x1: number, z0: number, z1: number, y = 0) => lin([P([x0, y, z0]), P([x1, y, z0]), P([x1, y, z1]), P([x0, y, z1])], true);

function Stakes({ w, d, lines, flags }: { w: number; d: number; lines: boolean; flags?: boolean }) {
  const c: V3[] = [[-w - 4, 0, -4], [w + 4, 0, -4], [w + 4, 0, d + 4], [-w - 4, 0, d + 4]];
  const hgt = flags ? 12 : 8;
  return (
    <g>
      {lines && <path d={lin([...c.map(([x, , z]) => P([x, 5, z]))], true)} stroke="#c98f2e" stroke-width="1.1" fill="none" />}
      <path d={c.map(([x, , z]) => post(x, z, hgt)).join('')} stroke={K.woodDark} stroke-width={flags ? 2.4 : 2} />
      <path d={c.map(([x, , z]) => post(x, z, 2.5, hgt - 2)).join('')} stroke="#ff7a1f" stroke-width={flags ? 3 : 2.4} />
      {/* a little survey flag on every corner */}
      {flags && <path d={c.map(([x, , z]) => `M${P([x, hgt, z]).map((n) => Math.round(n * 10) / 10).join(' ')}l6 1.8l-6 1.8z`).join('')} fill="#ff4f2e" />}
    </g>
  );
}

function Lumber({ x, z }: { x: number; z: number }) {
  const a = box(x, x + 18, 0, 3, z, z + 7);
  const b = box(x + 1, x + 17, 3, 6, z + 1, z + 6);
  return (
    <g>
      <path d={a.front + b.front} fill={K.wood} />
      <path d={a.side + b.side} fill={K.woodDark} />
      <path d={b.top} fill={K.woodLight} />
      <path d={`M${P([x, 1.5, z]).join(' ')}h18`} stroke={K.woodDark} stroke-width=".8" />
    </g>
  );
}

function Frame({ w, d, h }: { w: number; d: number; h: number }) {
  const xs = [-w, 0, w];
  const zs = [0, d];
  const posts = xs.flatMap((x) => zs.map((z) => post(x, z, h, 3))).join('');
  const plates = seg([-w, h + 3, 0], [w, h + 3, 0]) + seg([-w, h + 3, d], [w, h + 3, d]) + seg([w, h + 3, 0], [w, h + 3, d]) + seg([-w, h + 3, 0], [-w, h + 3, d]);
  const rh = h * 0.6;
  const rafters = [-w, -w / 2, 0, w / 2, w].map((x) => seg([x, h + 3, 0], [x, h + 3 + rh, d / 2]) + seg([x, h + 3 + rh, d / 2], [x, h + 3, d])).join('') + seg([-w, h + 3 + rh, d / 2], [w, h + 3 + rh, d / 2]);
  const braces = seg([-w, 3, 0], [0, h + 3, 0]) + seg([w, 3, 0], [0, h + 3, 0]);
  return (
    <g stroke-linecap="round">
      <path d={posts + plates + rafters} stroke={K.woodDark} stroke-width="3.2" fill="none" />
      <path d={posts + plates + rafters + braces} stroke={K.woodLight} stroke-width="1.8" fill="none" />
    </g>
  );
}

function Scaffold({ w, h }: { w: number; h: number }) {
  const z = -6;
  const poles = [-w - 2, -w / 3, w / 3, w + 2].map((x) => post(x, z, h + 6)).join('');
  const decks = [h * 0.45, h * 0.9].map((y) => seg([-w - 2, y, z], [w + 2, y, z])).join('');
  const cross = seg([-w - 2, 0, z], [-w / 3, h * 0.45, z]) + seg([w / 3, h * 0.45, z], [w + 2, h * 0.9, z]);
  return (
    <g>
      <path d={poles + cross} stroke="#8e9aa1" stroke-width="1.4" />
      <path d={decks} stroke={K.wood} stroke-width="2.6" />
    </g>
  );
}

/** a tower crane standing on the site's west side, its jib reaching east over
 *  the frame; `z` = how far back it stands (a big plot's crane stands at the
 *  front corner, so its jib stays below the houses up the slope behind) */
function Crane({ x, h, z = 22 }: { x: number; h: number; z?: number }) {
  const top = h + 34;
  const [bx, by] = P([x, 0, z]);
  return (
    <g transform={`translate(${bx} ${by})`}>
      <path d="M-6 1h12v-3h-12z" fill="#6b7176" />
      <path d={`M-3 0V${-top}M3 0V${-top}`} stroke="#f2b01e" stroke-width="1.8" />
      <path d={Array.from({ length: Math.floor(top / 7) }, (_, i) => `M3 ${-i * 7}L-3 ${-i * 7 - 7}`).join('')} stroke="#f2b01e" stroke-width="1.1" />
      <path d={`M42 ${-top}H-14`} stroke="#f2b01e" stroke-width="3" />
      <path d={`M0 ${-top - 8}L42 ${-top}M0 ${-top - 8}L-14 ${-top}`} stroke="#c98a12" stroke-width="1" />
      <rect x={-16} y={-top - 1} width={7} height={6} fill="#6b7176" />
      <path d={`M34 ${-top}V${-top + 22}`} stroke="#3e4448" stroke-width=".8" />
      <path d={`M30 ${-top + 22}h8v4h-8z`} fill={K.wood} />
    </g>
  );
}

function Worker({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <use href="#i-guy" style={{ color: '#ff8c42' }} />
      <path d="M-3 -12.4a3 3 0 0 1 6 0h1v1h-8v-1z" fill="#ffd23f" />
    </g>
  );
}

/** a little board on a post: what will be built here */
function PlotSign({ x, kind }: { x: number; kind: SiteKind }) {
  return (
    <g transform={`translate(${x} 6)`}>
      <ellipse cx={3} cy={1} rx={6} ry={1.8} fill={K.shadow} />
      <path d="M0 0V-10" stroke={K.woodDark} stroke-width="1.8" />
      <path d="M-7 -20h14v10h-14z" fill="#fffaf0" stroke={K.woodDark} stroke-width="1.2" />
      {kind === 'gen' ? (
        // a power shed: a little shed with a lightning bolt on it
        <>
          <path d="M-5 -11.6v-4.4l5 -3l5 3v4.4z" fill="#6f7a82" />
          <path d="M.9 -18.4l-2.6 3.8h2l-1.6 3.4l3.4 -4.4h-2z" fill={K.yellow} stroke="#6d5a1c" stroke-width=".4" />
        </>
      ) : (
        <path d="M-3.6 -12v-3.6l3.6 -3l3.6 3v3.6z" fill={K.rust} />
      )}
    </g>
  );
}

/** one site at a screen point. stage -1 = planned only (subtle) */
export function Site({ x, y, kind, stage }: { x: number; y: number; kind: SiteKind; stage: -1 | 0 | 1 | 2 }) {
  const { w, d, h } = DIM[kind];
  const big = kind === 'villa' || kind === 'lodge';
  if (stage < 0) {
    // a surveyed plot: rough cleared ground, ochre string lines on flagged
    // corner stakes, a few survey pegs, a small stack of timber and a sign
    const pegs = [[-w * 0.4, d * 0.3], [w * 0.35, d * 0.55], [-w * 0.05, d * 0.8]].map(([px, pz]) => post(px, pz, 4)).join('');
    return (
      <g transform={`translate(${x} ${y})`}>
        <path d={quad(-w - 2, w + 2, -2, d + 2)} fill={mix(K.grass, K.dirtLight, 0.35)} opacity=".85" />
        <path d={quad(-w * 0.5, w * 0.3, d * 0.2, d * 0.7)} fill={mix(K.grass, K.dirt, 0.45)} opacity=".5" />
        <path d={pegs} stroke="#f2e6c8" stroke-width="1.8" />
        <Stakes w={w - 2} d={d - 4} lines flags />
        <g transform="scale(.7)">
          <Lumber x={w * 0.2} z={d * 0.9} />
        </g>
        <PlotSign x={-w - 8} kind={kind} />
      </g>
    );
  }
  const slab = box(-w, w, 0, 3, 0, d);
  const k = big ? 1 : 1.2;
  // the generator's plot is by the lip, where the beach steps go down: the
  // works sit a little up and east of it, the barrier clear of the steps, and
  // the shed is too small a job for a crane
  const gen = kind === 'gen';
  const by = gen ? 11 : 18;
  const [ox, oy] = gen ? [7, -6] : [0, 0];
  return (
    <g transform={`translate(${x + ox} ${y + oy}) scale(${k})`}>
      <path d={quad(-w - 6, w + 6, -6, d + 6)} fill={K.dirt} />
      <path d={quad(-w - 3, w + 3, -3, d + 3)} fill={K.dirtLight} opacity=".6" />
      {stage >= 1 && (
        <>
          <path d={slab.side + slab.front} fill={K.concreteDark} />
          <path d={slab.top} fill={K.concrete} />
        </>
      )}
      <Stakes w={w} d={d} lines={stage === 0} />
      {stage === 2 && <Frame w={w} d={d} h={h} />}
      {stage === 2 && <Scaffold w={w} h={h} />}
      {stage === 2 && !gen && (big ? <Crane x={-w - 2} h={h} z={-8} /> : <Crane x={-w - 3} h={h * 0.7} />)}
      <Lumber x={big ? -w + 6 : -w - 4} z={-20} />
      {/* sand pile and a barrier along the front */}
      <path d={`M${w - 2} 14q7 -12 14 0z`} fill="#e3c27e" />
      <path d={`M${w + 1} 10q4 -6 7 -1`} stroke="#f6e2b0" stroke-width="1.4" fill="none" />
      <path d={`M${-w - 6} ${by}h${w * 0.9}`} stroke="#ff7a1f" stroke-width="3.4" />
      <path d={`M${-w - 6} ${by}h${w * 0.9}`} stroke="#fff" stroke-width="3.4" stroke-dasharray="3 3" />
      <path d={`M${-w - 5} ${by + 3}v-4M${-w * 0.15 - 6} ${by + 3}v-4`} stroke="#555" stroke-width="1.2" />
      {/* the crew at work */}
      <Worker x={-w * 0.4} y={10} />
      {stage >= 1 && <Worker x={w * 0.6} y={4} />}
      {stage >= 1 && (
        <g transform={`translate(${w + 8} 8)`}>
          <ellipse cx={3} cy={2} rx={7} ry={2.4} fill={K.shadow} />
          <path d="M-5 0l2 -9h8l2 9z" fill="#e8e3d6" />
          <ellipse cx={0} cy={-9} rx={4.4} ry={2} fill="#f2c230" />
          <path d="M-5 -1h10" stroke="#8e9aa1" stroke-width="1.5" />
        </g>
      )}
    </g>
  );
}

/** the floatplane dock: buoy while planned, piles then planks while building */
export function DockSite({ stage, motion }: { stage: -1 | 0 | 1 | 2; motion: boolean }) {
  const [ax, ay] = DOCK.root, [, by] = DOCK.tip;
  const [x0, y0, x1, y1] = DOCK.head;
  const piles: Pt[] = [
    [ax - 6, ay - 12], [ax + 6, ay - 12], [ax - 6, by + 4], [ax + 6, by + 4],
    ...Array.from({ length: 5 }, (_, i) => [x0 + 4 + (i * (x1 - x0 - 8)) / 4, y1 + 1] as Pt),
  ];
  return (
    <g>
      <g transform={`translate(${x1 + 12} ${y0 + 2})`}>
        <g class={motion ? 'bob' : undefined}>
          <ellipse cx={0} cy={4} rx={8} ry={2.6} fill="#fff" opacity=".5" />
          <path d="M-5 3q5 -16 10 0z" fill="#fff" />
          <path d="M-4.2 -1q4.2 -9 8.4 0z" fill="#e8453c" />
          <path d="M0 -8v-5" stroke="#555" stroke-width="1.2" />
        </g>
      </g>
      {stage >= 0 && <path d={`M${ax - 8} ${ay}v-8M${ax + 8} ${ay + 4}v-8`} stroke={K.woodDark} stroke-width="2" />}
      {stage === 0 && (
        <g transform={`translate(${ax - 34} ${ay - 2})`}>
          <Lumber x={0} z={0} />
        </g>
      )}
      {stage >= 1 &&
        piles.map(([x, y], i) => (
          <g key={i}>
            <ellipse cx={x + 1} cy={y + 4.4} rx={3.4} ry={1.2} fill="none" stroke="#fff" stroke-width=".9" opacity=".8" />
            <path d={`M${x} ${y - 4}v8`} stroke={K.woodDark} stroke-width="2.6" stroke-linecap="round" />
          </g>
        ))}
      {stage === 2 && <path d={`M${ax} ${ay}V${y1}M${x0 + 4} ${(y0 + y1) / 2}H${(x0 + x1) / 2}`} stroke={K.woodLight} stroke-width="11" stroke-dasharray="3 1.4" />}
    </g>
  );
}
