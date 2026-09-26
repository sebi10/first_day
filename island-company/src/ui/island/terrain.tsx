// The ground itself: sea, shallows and foam, beach, the grass plateau with its
// lip, the rocky mountain with a waterfall, the river and its bridges, paths,
// the airfield surface and seeded scatter. All static for a given tier, phase
// and weather, so it is memoized by the caller.
import type { Weather } from '../../sim/types';
import {
  APRON, BRIDGES, COAST, COAST_S, DOCK, FALLS, H, HANGAR_PAD, LIP, PATHS, PLATEAU, PLATEAU_S, POS, RIVER, RIVER_S, RUNWAY, RUNWAY_ANGLE,
  RUNWAY_C, RUNWAY_LEN, SPOT, SQUARE, W, curve, edgeDist, inPoly, lin, lineDist, scatter, type Pt, type Zone,
} from './geo';
import { FloraDefs, Palm, Use } from './flora';
import { K, mix } from './paint';
import { blob, Boulder, ridge, Rock, ROCK } from './rocks';

const r1 = (n: number) => Math.round(n * 10) / 10;
const COAST_D = curve(COAST);
const PLATEAU_D = curve(PLATEAU);

// ------------------------------------------------------------ mountain ---
const L0: Pt[] = [
  [440, 138], [462, 112], [500, 98], [560, 92], [622, 96], [676, 110], [708, 132], [722, 166], [718, 200], [704, 226], [668, 238],
  [626, 236], [598, 220], [586, 198], [556, 196], [534, 199], [512, 200], [490, 196], [466, 184], [446, 164],
];
const L1: Pt[] = [
  [476, 120], [510, 96], [560, 84], [616, 86], [664, 100], [690, 124], [686, 150], [662, 166], [622, 172], [580, 168], [546, 164], [520, 160],
  [496, 150], [480, 138],
];
const L2: Pt[] = [[520, 92], [552, 72], [596, 70], [636, 82], [652, 104], [636, 126], [600, 134], [562, 132], [534, 120]];
const SUMMIT: Pt[] = [[548, 62], [570, 46], [600, 46], [622, 58], [618, 78], [594, 86], [566, 84], [550, 76]];
export const MOUNTAIN_FOOT: Pt[] = L0.map(([x, y]) => [x, y + 26]);
export const LEDGE_TOP = L0;

// ------------------------------------------------- exclusion for scatter ---
const FOOT = [...L0.slice(0, 7), ...L0.slice(7).map(([x, y]) => [x, y + 30] as Pt)];
export const ZONES: Zone[] = [
  { line: [RUNWAY.a, RUNWAY.b], r: RUNWAY.w / 2 + 10 },
  { poly: APRON, pad: 10 },
  { poly: HANGAR_PAD, pad: 8 },
  { poly: [[62, 226], [182, 226], [182, 290], [62, 290]], pad: 6 },
  { poly: FOOT, pad: 6 },
  { poly: [[440, 138], [470, 100], [520, 70], [548, 44], [600, 34], [640, 56], [690, 96], [722, 166], [718, 226], [668, 262], [626, 262], [590, 226], [556, 222], [512, 228], [466, 212], [446, 190]], pad: 4 },
  { c: SQUARE.c, r: 78 },
  { c: [360, 300], r: 50 },
  { line: RIVER_S, r: 18 },
  ...PATHS.map((p) => ({ line: p.pts, r: (p.w ?? 12) / 2 + 7 })),
  ...Object.entries(POS).map(([id, c]) => ({ c: [c[0] + 4, c[1] - 14] as Pt, r: id === 'h5' || id === 'h6' ? 46 : id === 'h7' ? 50 : id === 'gen' ? 46 : id.startsWith('h') ? 38 : 30 })),
  { poly: [[176, 300], [268, 290], [272, 318], [264, 380], [170, 386]], pad: 6 },
  ...SPOT.garden.map((c) => ({ c, r: 18 })),
  ...SPOT.benches.map((c) => ({ c, r: 10 })),
  ...SPOT.lamps.map((c) => ({ c, r: 8 })),
  ...SPOT.boats.map((c) => ({ c, r: 22 })),
  ...SPOT.boardwalk.map((c) => ({ c, r: 20 })),
  { c: SPOT.bar, r: 44 },
  { c: SPOT.lighthouse, r: 26 },
  { line: [DOCK.root, DOCK.tip], r: 16 },
  { c: [392, 150], r: 22 }, // windsock
  { c: SPOT.pond, r: 36 },
];

const onGrass = (p: Pt) => inPoly(p, PLATEAU_S) && edgeDist(p, PLATEAU_S) > 10;
const onBeach = (p: Pt) => inPoly(p, COAST_S) && !inPoly(p, PLATEAU_S) && edgeDist(p, COAST_S) > 6 && edgeDist(p, PLATEAU_S) > LIP + 4;

// ---------------------------------------------------------------- defs ---
export function TerrainDefs() {
  return (
    <>
      <radialGradient id="i-sea" cx="0.5" cy="0.48" r="0.72">
        <stop offset="0" stop-color={K.seaCenter} />
        <stop offset="0.6" stop-color={K.seaMid} />
        <stop offset="1" stop-color={K.seaEdge} />
      </radialGradient>
      <pattern id="i-ripple" width="120" height="84" patternUnits="userSpaceOnUse">
        <path d="M10 18q9 -6 18 0t18 0M70 52q9 -6 18 0t18 0M84 14q6 -4 12 0M24 62q6 -4 12 0" stroke={K.ripple} stroke-width="2.2" fill="none" stroke-linecap="round" opacity=".42" />
        <path d="M44 34q10 6 20 0M96 76q8 5 16 0M4 44q8 5 16 0" stroke={K.rippleDark} stroke-width="2.4" fill="none" stroke-linecap="round" opacity=".32" />
      </pattern>
      <pattern id="i-caustic" width="46" height="34" patternUnits="userSpaceOnUse">
        <path d="M2 8q10 -7 20 2t20 -2M8 26q8 -6 16 0t16 2" stroke="#ffffff" stroke-width="1.6" fill="none" opacity=".28" />
      </pattern>
      <linearGradient id="i-fall" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#9fe6ff" />
        <stop offset="1" stop-color="#e8fbff" />
      </linearGradient>
      <clipPath id="i-land">
        <path d={COAST_D} />
      </clipPath>
      <clipPath id="i-fallclip">
        <path d={`M${FALLS[0] - 8} ${FALLS[1] + 6}L${FALLS[0] + 8} ${FALLS[1] + 6}L${FALLS[0] + 9} 226L${FALLS[0] - 9} 226Z`} />
      </clipPath>
      <FloraDefs />
    </>
  );
}

// ----------------------------------------------------------------- sea ---
function Sea({ motion, weather }: { motion: boolean; weather: Weather }) {
  const rough = weather !== 'clear';
  return (
    <g>
      <rect width={W} height={H} fill="url(#i-sea)" />
      <rect width={W} height={H} fill="url(#i-ripple)" />
      {/* whitecaps when it blows */}
      {rough && (
        <g stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round" opacity={weather === 'storm' ? 0.75 : 0.55} class={motion ? 'bob' : undefined}>
          <path d="M20 90q10 -7 20 0M120 40q10 -7 20 0M700 180q10 -7 20 0M770 420q10 -7 20 0M30 470q10 -7 20 0M250 570q10 -7 20 0M560 560q10 -7 20 0M650 30q10 -7 20 0M16 250q8 -6 16 0M790 110q6 -5 12 0" />
        </g>
      )}
    </g>
  );
}

function Shallows({ motion }: { motion: boolean }) {
  return (
    <g stroke-linejoin="round" fill="none">
      <path d={COAST_D} stroke={K.halo} stroke-width="104" opacity=".55" />
      <path d={COAST_D} stroke="#fff" stroke-width="74" opacity=".5" class={motion ? 'surf' : undefined} />
      <path d={COAST_D} stroke={K.shallow1} stroke-width="68" />
      <path d={COAST_D} stroke="url(#i-caustic)" stroke-width="68" />
      <path d={COAST_D} stroke={K.shallow2} stroke-width="42" />
      <path d={COAST_D} stroke={K.shallow3} stroke-width="20" />
    </g>
  );
}

function Beach() {
  return (
    <g>
      <path d={COAST_D} fill={K.sand} />
      <path d={COAST_D} fill="none" stroke={K.sandWet} stroke-width="16" clip-path="url(#i-land)" />
      <path d={COAST_D} fill="none" stroke={K.sandLight} stroke-width="30" clip-path="url(#i-land)" opacity=".0" />
      <path d={COAST_D} fill="none" stroke="#fff" stroke-width="5" stroke-dasharray="26 7 12 6" stroke-linecap="round" opacity=".95" />
    </g>
  );
}

// ------------------------------------------------------------- plateau ---
const PATCHES: [number, number, number, number, number][] = [
  // cx, cy, rx, ry, seed
  [150, 170, 34, 12, 1], [250, 136, 44, 12, 2], [420, 118, 30, 12, 3], [232, 320, 40, 18, 4], [120, 368, 30, 14, 5], [300, 426, 42, 14, 6],
  [430, 262, 36, 16, 7], [560, 250, 26, 10, 8], [700, 272, 22, 12, 9], [612, 420, 34, 14, 10], [690, 400, 20, 10, 11], [420, 408, 20, 10, 12],
  [160, 420, 26, 10, 13], [96, 250, 16, 22, 14],
];

function Plateau() {
  return (
    <g>
      {/* soft shadow the lip throws onto the sand */}
      <path d={PLATEAU_D} fill={K.shadowSand} transform={`translate(5 ${LIP + 5})`} />
      <path d={PLATEAU_D} fill={K.earthDark} transform={`translate(0 ${LIP})`} />
      <path d={PLATEAU_D} fill={K.earth} transform={`translate(0 ${LIP - 3})`} />
      <path d={PLATEAU_D} fill={K.grassDarker} transform="translate(0 4)" />
      <path d={PLATEAU_D} fill={K.grass} />
      <path d={PLATEAU_D} fill="none" stroke={K.grassLight} stroke-width="3" opacity=".7" transform="translate(-1 -1.5)" clip-path="url(#i-land)" />
      <g fill={K.grassLight}>
        {PATCHES.map(([x, y, rx, ry, s]) => (
          <path key={s} d={curve(blob(x, y, rx, ry, s * 11, 7, 0.25))} />
        ))}
      </g>
      <g fill={K.grassLighter} opacity=".8">
        {PATCHES.filter((_, i) => i % 2 === 0).map(([x, y, rx, ry, s]) => (
          <path key={s} d={curve(blob(x - rx * 0.2, y - ry * 0.2, rx * 0.45, ry * 0.45, s * 13, 6, 0.2))} />
        ))}
      </g>
      <g fill={K.grassDark} opacity=".55">
        {[[330, 150, 30, 8], [520, 300, 22, 8], [180, 392, 24, 8], [660, 440, 24, 7], [740, 300, 12, 16], [110, 300, 14, 20], [440, 440, 18, 5]].map(([x, y, rx, ry], i) => (
          <path key={i} d={curve(blob(x, y, rx, ry, i * 17 + 5, 7, 0.2))} />
        ))}
      </g>
    </g>
  );
}

// ------------------------------------------------------------ mountain ---
/** front edge of an outline: from its east-most to its west-most point along the bottom */
function frontEdge(p: Pt[], from: number, to: number, skip: (q: Pt) => boolean = () => false): Pt[][] {
  const pts: Pt[] = [];
  for (let i = from; i !== (to + 1) % p.length; i = (i + 1) % p.length) pts.push(p[i]);
  // split around gaps (waterfall, steps)
  const runs: Pt[][] = [[]];
  for (const q of pts) {
    if (skip(q)) runs.push([]);
    else runs[runs.length - 1].push(q);
  }
  return runs.filter((r) => r.length > 1);
}
const noFalls = (q: Pt) => Math.abs(q[0] - FALLS[0]) < 16;
const R0 = frontEdge(L0, 9, 19, (q) => noFalls(q) || (q[0] > 600 && q[0] < 632)).flatMap((e, i) => ridge(e, 26, 40 + i, 26));
const R1 = frontEdge(L1, 6, 13, noFalls).flatMap((e, i) => ridge(e, 28, 50 + i, 24));
const R2 = frontEdge(L2, 4, 8).flatMap((e, i) => ridge(e, 26, 60 + i, 22, 0.9));

function Mountain() {
  return (
    <g>
      {/* ground shadow down-right */}
      <path d={curve(FOOT)} fill={K.shadow} transform="translate(12 6)" />
      <Rock top={L0} h={26} topFill={K.grass} smooth />
      {R0.map((b) => (
        <Rock key={b.key} top={b.top} h={b.h} cracks={false} />
      ))}
      <Rock top={L1} h={28} smooth />
      <path d={curve(blob(520, 128, 26, 10, 81, 7, 0.2))} fill={K.grassDark} opacity=".9" />
      <path d={curve(blob(660, 132, 20, 12, 82, 7, 0.2))} fill={K.grassDark} opacity=".9" />
      {R1.map((b) => (
        <Rock key={b.key} top={b.top} h={b.h} cracks={false} />
      ))}
      <Rock top={L2} h={26} smooth />
      <path d={curve(blob(598, 102, 34, 16, 71, 7, 0.2))} fill={K.grassDark} />
      <path d={curve(blob(590, 98, 20, 9, 73, 7, 0.2))} fill={K.grass} />
      {R2.map((b) => (
        <Rock key={b.key} top={b.top} h={b.h} cracks={false} />
      ))}
      <Rock top={SUMMIT} h={22} topFill={K.grass} smooth />
      <path d={curve(blob(580, 60, 18, 7, 74, 6, 0.2))} fill={K.grassLighter} opacity=".8" />
      {/* loose boulders on the shoulders */}
      {[
        [470, 136, 12, 3], [494, 112, 10, 4], [664, 122, 12, 5], [684, 146, 9, 6], [612, 90, 8, 7], [540, 94, 7, 8],
        [702, 194, 9, 10], [566, 148, 9, 12],
      ].map(([x, y, r, s]) => (
        <Boulder key={s} x={x} y={y} r={r} seed={s * 31} />
      ))}
    </g>
  );
}

function Falls({ motion }: { motion: boolean }) {
  const [x, y] = FALLS;
  return (
    <g>
      <path d={`M${x - 8} ${y + 6}L${x + 8} ${y + 6}L${x + 9} 226L${x - 9} 226Z`} fill="url(#i-fall)" />
      <g clip-path="url(#i-fallclip)">
        <g class={motion ? 'fall' : undefined}>
          <path
            d={Array.from({ length: 7 }, (_, i) => `M${x - 5 + (i % 3) * 5} ${y - 30 + i * 18}l0 12`).join('')}
            stroke="#fff"
            stroke-width="2.6"
            stroke-linecap="round"
          />
        </g>
      </g>
      <path d={`M${x - 8} ${y + 6}L${x + 8} ${y + 6}`} stroke="#fff" stroke-width="3" stroke-linecap="round" />
      {/* plunge pool */}
      <ellipse cx={x - 2} cy={228} rx={22} ry={9} fill={K.river} />
      <ellipse cx={x - 2} cy={227} rx={16} ry={5.5} fill={K.riverLight} opacity=".7" />
      <path d={`M${x - 14} 226q4 -6 8 0q4 -6 8 0q4 -6 8 0`} stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round" />
      {/* rope bridge across the gorge */}
      <path d={`M${x - 26} 188Q${x} 197 ${x + 26} 190`} stroke={K.woodDark} stroke-width="5" fill="none" />
      <path d={`M${x - 26} 188Q${x} 197 ${x + 26} 190`} stroke={K.woodLight} stroke-width="4" stroke-dasharray="3 1.6" fill="none" />
      <path d={`M${x - 26} 181Q${x} 189 ${x + 26} 183`} stroke="#6d4a2c" stroke-width="1.1" fill="none" />
    </g>
  );
}

function River() {
  const d = curve(RIVER, false);
  return (
    <g fill="none" stroke-linecap="round" stroke-linejoin="round">
      <path d={d} stroke={K.grassDarker} stroke-width="26" />
      <path d={d} stroke={K.earth} stroke-width="21" opacity=".5" />
      <path d={d} stroke={K.river} stroke-width="17" />
      <path d={d} stroke={K.riverLight} stroke-width="5" stroke-dasharray="14 18" opacity=".85" transform="translate(-2 0)" />
      {/* where it spills over the lip and fans across the sand */}
      <path d="M452 452Q466 446 480 452L486 470Q466 476 446 470Z" fill={K.river} stroke="none" />
      <path d="M458 438q8 5 16 0" stroke="#fff" stroke-width="3" />
      {/* reeds */}
      {[
        [500, 262], [462, 330], [496, 398], [454, 404],
      ].map(([x, y], i) => (
        <Use key={i} id="i-reed" x={x} y={y} />
      ))}
    </g>
  );
}

function Bridge({ at, rot, len }: { at: Pt; rot: number; len: number }) {
  const n = Math.round(len / 5);
  return (
    <g transform={`translate(${at[0]} ${at[1]}) rotate(${rot})`}>
      <rect x={-len / 2 + 3} y={-6} width={len} height={16} rx={2} fill={K.shadow} />
      <rect x={-len / 2} y={-9} width={len} height={18} rx={2} fill={K.woodDark} />
      <path d={Array.from({ length: n }, (_, i) => `M${r1(-len / 2 + 2.5 + i * 5)} -8.5v15`).join('')} stroke={K.woodLight} stroke-width="3.6" />
      <path d={`M${-len / 2} -9h${len}M${-len / 2} 9h${len}`} stroke={K.woodDark} stroke-width="2.4" />
      {[-len / 2, len / 2 - 2.5].map((x) => (
        <g key={x}>
          <rect x={x} y={-13} width={3} height={6} fill={K.woodDark} />
          <rect x={x} y={5} width={3} height={6} fill={K.woodDark} />
        </g>
      ))}
    </g>
  );
}

// --------------------------------------------------------------- paths ---
function Paths({ tier }: { tier: number }) {
  const paved = tier >= 3;
  const list = PATHS.filter((p) => p.tier <= tier || p.steps);
  return (
    <g fill="none" stroke-linecap="round" stroke-linejoin="round">
      {list.map((p, i) => (
        <path key={`e${i}`} d={curve(p.pts, false)} stroke={paved ? K.stoneDark : K.dirtEdge} stroke-width={(p.w ?? 12) + 4} />
      ))}
      {list.map((p, i) => (
        <path key={`m${i}`} d={curve(p.pts, false)} stroke={paved ? K.stone : K.dirt} stroke-width={p.w ?? 12} />
      ))}
      {list.map((p, i) =>
        paved ? (
          <path key={`c${i}`} d={curve(p.pts, false)} stroke={K.stoneDark} stroke-width={(p.w ?? 12) - 3} stroke-dasharray="1.2 5" opacity=".7" />
        ) : (
          <path key={`c${i}`} d={curve(p.pts, false)} stroke={K.dirtLight} stroke-width={(p.w ?? 12) * 0.4} />
        ),
      )}
    </g>
  );
}

/** the town square in front of the office: packed sand, then cobbles (tier 3) */
function Square({ tier }: { tier: number }) {
  const { c: [x, y], rx, ry } = SQUARE;
  const paved = tier >= 3;
  return (
    <g>
      <ellipse cx={x} cy={y + 3} rx={rx + 3} ry={ry + 3} fill={paved ? K.stoneDark : K.dirtEdge} />
      <ellipse cx={x} cy={y} rx={rx} ry={ry} fill={paved ? K.stone : '#e8cb90'} />
      <ellipse cx={x} cy={y} rx={rx - 8} ry={ry - 6} fill="none" stroke={paved ? K.stoneDark : '#d8b474'} stroke-width={paved ? 5 : 2} stroke-dasharray={paved ? '1.2 5' : undefined} opacity=".7" />
      <ellipse cx={x} cy={y + 2} rx={rx * 0.42} ry={ry * 0.42} fill="none" stroke={paved ? K.stoneLight : '#f3dcaa'} stroke-width="3" />
    </g>
  );
}

/** stone steps up the ledge face to the lodge terrace */
function Steps() {
  return (
    <g>
      {Array.from({ length: 6 }, (_, i) => {
        const x = 608 + i * 2.2, y = 262 - i * 5;
        return (
          <g key={i}>
            <rect x={x - 9} y={y - 2} width={18} height={5} rx={1.5} fill={K.stoneDark} />
            <rect x={x - 9} y={y - 3.5} width={18} height={3.5} rx={1.5} fill={K.stoneLight} />
          </g>
        );
      })}
    </g>
  );
}

// ------------------------------------------------------------ airfield ---
function Airfield({ weather, motion }: { weather: Weather; motion: boolean }) {
  const L = RUNWAY_LEN, w = RUNWAY.w;
  const bars = (x: number) => Array.from({ length: 6 }, (_, i) => `M${x} ${r1(-w / 2 + 4 + i * 5.4)}h14`).join('');
  return (
    <g>
      {/* hangar pad and apron */}
      <path d={lin(HANGAR_PAD, true)} fill={K.concreteDark} transform="translate(0 3)" />
      <path d={lin(HANGAR_PAD, true)} fill={K.concrete} />
      <path d={lin(APRON, true)} fill={K.concreteDark} transform="translate(0 3)" />
      <path d={lin(APRON, true)} fill={K.concrete} />
      <path d={lin(APRON.map(([x, y]) => [x + (360 - x) * 0.04, y + (228 - y) * 0.06]), true)} fill="none" stroke="#fff" stroke-width="1" opacity=".35" />
      {/* taxiway */}
      <path d="M248 214L262 176L292 172L282 212Z" fill={K.concrete} />
      <path d="M270 210L277 176" stroke="#f2c230" stroke-width="1.6" />
      {/* parking stands */}
      <g stroke="#f2c230" stroke-width="1.6" fill="none" opacity=".9">
        <path d="M238 250l0 -32M226 252l24 -4M310 236l-2 -34M298 238l24 -4" />
      </g>
      {/* runway */}
      <g transform={`translate(${r1(RUNWAY_C[0])} ${r1(RUNWAY_C[1])}) rotate(${r1(RUNWAY_ANGLE)})`}>
        <rect x={-L / 2 - 6} y={-w / 2 - 5} width={L + 12} height={w + 10} rx={4} fill={K.grassDark} opacity=".6" />
        <rect x={-L / 2} y={-w / 2 + 3} width={L} height={w} rx={3} fill={K.asphaltDark} />
        <rect x={-L / 2} y={-w / 2} width={L} height={w} rx={3} fill={K.asphalt} />
        <path d={`M${-L / 2 + 4} ${-w / 2 + 2}h${L - 8}M${-L / 2 + 4} ${w / 2 - 2}h${L - 8}`} stroke="#fff" stroke-width="1.2" opacity=".8" />
        <path d={`M${-L / 2 + 44} 0H${L / 2 - 44}`} stroke="#fff" stroke-width="2" stroke-dasharray="14 10" />
        <path d={bars(-L / 2 + 6) + bars(L / 2 - 20)} stroke="#fff" stroke-width="2.6" />
        <path d={`M${-L / 2 + 30} -8h8M${-L / 2 + 30} 8h8M${L / 2 - 38} -8h8M${L / 2 - 38} 8h8`} stroke="#fff" stroke-width="4" />
        <path d={`M${-L / 2 + 60} -8h14M${-L / 2 + 60} 8h14M${L / 2 - 74} -8h14M${L / 2 - 74} 8h14`} stroke="#fff" stroke-width="2.2" opacity=".75" />
        {/* tyre marks */}
        <path d={`M${-L / 2 + 50} -3h40M${-L / 2 + 54} 4h36M${L / 2 - 90} -4h36`} stroke="#3c4248" stroke-width="2" opacity=".5" />
      </g>
      {/* windsock at the east end */}
      <g transform="translate(392 150)">
        <ellipse cx={5} cy={1} rx={6} ry={2} fill={K.shadow} />
        <rect x={-1} y={-28} width={2.2} height={28} fill="#e8e3da" />
        <g transform="translate(0 -26)">
          <g class={motion ? 'sock' : undefined}>
            {weather === 'clear' ? (
              <path d="M1 -3L14 1L14 6L1 5Z" fill="#ff7a2e" />
            ) : (
              <>
                <path d="M1 -3L20 -2L20 4L1 5Z" fill="#ff7a2e" />
                <path d="M6 -2.8v7.6M13 -2.4v6.8" stroke="#fff" stroke-width="3" />
              </>
            )}
          </g>
        </g>
      </g>
    </g>
  );
}

// ------------------------------------------------------------- scatter ---
const TREE_SPOTS: Pt[] = [
  // south lawns and river banks
  [262, 452], [284, 436], [318, 440], [338, 432], [300, 458], [196, 440], [110, 424], [214, 404], [250, 418],
  [566, 446], [612, 446], [640, 432], [676, 404], [744, 318], [424, 396], [436, 420],
  [604, 262], [588, 282], [700, 236], [470, 250], [452, 270], [416, 250], [132, 300], [100, 330],
  // forest round the mountain foot and on the back plain
  [430, 172], [428, 204], [446, 222], [410, 138], [424, 110], [700, 244], [724, 238], [720, 150], [700, 108], [652, 84], [470, 90],
  [150, 150], [196, 132], [96, 216], [86, 256], [712, 404], [690, 432], [96, 350], [118, 392], [280, 440], [150, 436],
];
const PALMS: [number, number, number, number][] = [
  // x, y, scale, lean
  [70, 312, 1.05, 1], [108, 440, 1, 1], [170, 464, 0.95, -1], [322, 468, 1.05, 1], [372, 452, 0.9, -1], [520, 470, 1, 1], [586, 474, 1.1, -1],
  [660, 460, 0.95, 1], [728, 372, 1, -1], [762, 290, 1, 1], [744, 196, 0.95, -1], [96, 170, 1, 1], [164, 118, 0.9, -1], [300, 104, 1, 1],
  [420, 300, 0.85, -1], [300, 330, 0.8, 1], [520, 398, 0.85, 1], [680, 350, 0.8, -1], [446, 90, 0.9, 1],
];

function Pond() {
  const [x, y] = SPOT.pond;
  return (
    <g>
      <ellipse cx={x + 2} cy={y + 2} rx={30} ry={13} fill={K.grassDarker} />
      <ellipse cx={x} cy={y} rx={28} ry={12} fill={K.earth} />
      <ellipse cx={x} cy={y + 1.5} rx={25} ry={10} fill={K.river} />
      <ellipse cx={x - 6} cy={y - 1} rx={12} ry={4} fill={K.riverLight} opacity=".7" />
      <path d={`M${x + 8} ${y + 3}a3.4 2 0 1 0 .1 0M${x - 12} ${y + 5}a3 1.8 0 1 0 .1 0M${x + 16} ${y - 2}a2.6 1.6 0 1 0 .1 0`} fill="#4caf50" />
      <path d={`M${x + 8} ${y + 1}a1.3 1 0 1 0 .1 0`} fill={K.pink} />
      <Use id="i-reed" x={x - 24} y={y + 2} />
      <Use id="i-reed" x={x + 25} y={y + 4} />
    </g>
  );
}

/** rocks standing in the shallows, with a ring of foam */
const SEA_ROCKS: [number, number, number][] = [[16, 262, 9], [790, 238, 8], [740, 452, 10], [150, 540, 8], [558, 528, 7], [96, 90, 8], [760, 106, 7]];
function SeaRocks() {
  return (
    <g>
      {SEA_ROCKS.map(([x, y, r], i) => (
        <g key={i}>
          <ellipse cx={x} cy={y + 1} rx={r * 1.7} ry={r * 0.7} fill="#fff" opacity=".75" />
          <Boulder x={x} y={y} r={r} seed={i * 53 + 7} />
        </g>
      ))}
    </g>
  );
}

function Lookout() {
  const x = 604, y = 60;
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cx={6} cy={1} rx={10} ry={3} fill={K.shadow} />
      <path d="M-7 0l2 -22M7 0l-2 -22M-2 1l1 -23M5 -2v-20" stroke={K.woodDark} stroke-width="2" />
      <path d="M-6 -8l12 -6M-6 -14l12 6" stroke={K.woodDark} stroke-width="1.2" />
      <path d="M-9 -22h18v3h-18z" fill={K.wood} />
      <path d="M-8 -25h16" stroke={K.woodDark} stroke-width="1.2" />
      <path d="M-10 -26L0 -34L10 -26Z" fill="#e8c46a" />
      <path d="M0 -34L10 -26H3Z" fill="#c9a24a" />
      <path d="M-14 -40v14" stroke="#9aa5ab" stroke-width="1.2" />
      <circle cx={-14} cy={-41} r={1.6} fill={K.red} />
    </g>
  );
}

function Scatter({ motion, wind }: { motion: boolean; wind: boolean }) {
  const zones = ZONES;
  const tufts = scatter(11, 90, onGrass, zones, 14);
  const flowers = scatter(12, 48, onGrass, zones, 17);
  const bushes = scatter(13, 30, onGrass, zones, 22);
  const beach = scatter(14, 34, onBeach, zones, 20);
  const trees = TREE_SPOTS.filter((p) => clearOf(p, zones));
  const cols = [K.pink, K.yellow, '#ffffff', K.orange, K.purple];
  const items: { y: number; el: preact.JSX.Element }[] = [];
  trees.forEach(([x, y], i) => items.push({ y, el: <Use key={`t${i}`} id={i % 4 === 3 ? 'i-pine' : 'i-tree'} x={x} y={y} s={0.9 + (i % 3) * 0.12} flip={i % 2 === 1} /> }));
  bushes.forEach(([x, y], i) => items.push({ y, el: <Use key={`b${i}`} id="i-bush" x={x} y={y} s={0.8 + (i % 3) * 0.15} flip={i % 2 === 0} /> }));
  PALMS.filter(([x, y]) => clearOf([x, y], zones)).forEach(([x, y, s, l], i) => items.push({ y, el: <Palm key={`p${i}`} x={x} y={y} s={s} lean={l} motion={motion} wind={wind} /> }));
  items.sort((a, b) => a.y - b.y);
  return (
    <g>
      {/* small scatter merged into a few paths: hundreds of bits, a handful of nodes */}
      <path d={tufts.filter((_, i) => i % 3).map(([x, y]) => `M${r1(x - 4)} ${r1(y)}q1 -5 -2 -8M${r1(x)} ${r1(y)}q0 -6 1 -10M${r1(x + 3)} ${r1(y)}q1 -4 4 -7`).join('')} stroke={K.grassDarker} stroke-width="1.6" fill="none" stroke-linecap="round" />
      <path d={tufts.filter((_, i) => !(i % 3)).map(([x, y]) => `M${r1(x - 3)} ${r1(y)}q0 -4 -3 -6M${r1(x)} ${r1(y)}q1 -5 3 -8M${r1(x + 3)} ${r1(y)}q2 -2 4 -3`).join('')} stroke={K.grassLighter} stroke-width="1.5" fill="none" stroke-linecap="round" />
      {cols.map((c, ci) => (
        <path key={c} d={flowers.filter((_, i) => i % cols.length === ci).map(([x, y]) => dot(x - 5, y - 2, 2.3) + dot(x + 1, y - 5, 2.5) + dot(x + 4, y, 2.2) + dot(x - 1, y + 1, 2)).join('')} fill={c} />
      ))}
      <path d={flowers.map(([x, y]) => dot(x - 5, y - 2.4, 0.9) + dot(x + 1, y - 5.4, 0.9)).join('')} fill="#fff6c8" />
      <path d={beach.filter((_, i) => i % 4 === 0 || i % 4 === 3).map(([x, y]) => `M${r1(x - 4)} ${r1(y)}q0 -3 4 -3q4 0 4 3z`).join('')} fill="#c9b8a0" />
      <path d={beach.filter((_, i) => i % 4 === 1).map(([x, y]) => `M${r1(x)} ${r1(y - 5)}l1.4 3.4l3.6 .2l-2.8 2.4l1 3.6l-3.2 -2l-3.2 2l1 -3.6l-2.8 -2.4l3.6 -.2z`).join('')} fill="#ff8a5c" />
      <path d={beach.filter((_, i) => i % 4 === 2).map(([x, y]) => `M${r1(x - 3)} ${r1(y)}q3 -6 6 0z`).join('')} fill="#fff0e6" stroke="#f0b8a0" stroke-width=".6" />
      {[
        [470, 236], [440, 240], [540, 236], [700, 262],
      ].map(([x, y], i) => (
        <Use key={i} id="i-mush" x={x} y={y} />
      ))}
      <Pond />
      {/* shore boulders */}
      {[
        [40, 372, 9, 1], [58, 396, 6, 2], [760, 222, 8, 3], [774, 312, 9, 4], [742, 372, 7, 5], [118, 118, 7, 6], [680, 470, 7, 7], [228, 96, 6, 8],
      ].map(([x, y, r, s]) => (
        <Boulder key={s} x={x} y={y} r={r} seed={s * 97} pal={{ ...ROCK, top: mix(K.rockTop, K.sand, 0.15) }} />
      ))}
      {items.map((it) => it.el)}
    </g>
  );
}
const dot = (x: number, y: number, r: number) => `M${r1(x - r)} ${r1(y)}a${r} ${r} 0 1 0 ${r1(2 * r)} 0a${r} ${r} 0 1 0 ${r1(-2 * r)} 0`;
const clearOf = (p: Pt, zones: Zone[]) =>
  zones.every((z) => ('c' in z ? Math.hypot(p[0] - z.c[0], p[1] - z.c[1]) >= z.r * 0.8 : 'line' in z ? lineDist(p, z.line) >= z.r : !inPoly(p, z.poly)));

// -------------------------------------------------------------- export ---
export function Terrain({ tier, weather, motion }: { tier: number; weather: Weather; motion: boolean }) {
  return (
    <g>
      <Sea motion={motion} weather={weather} />
      <Shallows motion={motion} />
      <SeaRocks />
      <Beach />
      <Plateau />
      <River />
      <Mountain />
      <Falls motion={motion} />
      <Lookout />
      <Use id="i-tree" x={566} y={70} s={0.7} />
      <Use id="i-bush" x={624} y={78} s={0.8} />
      <Steps />
      <Paths tier={tier} />
      <Square tier={tier} />
      {BRIDGES.map((b, i) => (
        <Bridge key={i} {...b} />
      ))}
      <Airfield weather={weather} motion={motion} />
      <Scatter motion={motion} wind={weather !== 'clear'} />
    </g>
  );
}
