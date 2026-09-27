// The ground itself: sea, shallows and foam, beach, the grass plateau with its
// lip, the rocky mountain with a waterfall, the lodge terrace, the river and
// its bridges, paths, the square, the airfield surface and seeded scatter.
// All static for a given tier, weather and paving, so it is memoized by the
// caller.
import type { Weather } from '../../sim/types';
import {
  APRON, BEACH_STEPS, BRIDGES, COAST, COAST_S, DOCK, FALLS, H, HANGAR_PAD, LIP, MOUTH, MOUTH_WATER, PATHS, PLATEAU, PLATEAU_S, POOL, POS, RIVER, RIVER_S, RUNWAY, RUNWAY_ANGLE,
  RUNWAY_C, RUNWAY_LEN, SPOT, SQUARE, TAXIWAY, TERRACE, TERRACE_H, W, WINDSOCK, curve, edgeDist, groveLeft, inPoly, inset, lin, lineDist, scatter, type Pt, type Zone,
} from './geo';
import { GroveField } from './extras';
import { FloraDefs, Palm, Use } from './flora';
import { K, mix } from './paint';
import { blob, boulder, ridge, Rock, RockRow, ROCK } from './rocks';

const r1 = (n: number) => Math.round(n * 10) / 10;
/** a rounded rectangle as path data, so rows of them merge into one node */
const rrect = (x: number, y: number, w: number, h: number, r: number) =>
  `M${r1(x + r)} ${r1(y)}h${r1(w - 2 * r)}a${r} ${r} 0 0 1 ${r} ${r}v${r1(h - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${r}h${r1(-(w - 2 * r))}a${r} ${r} 0 0 1 ${-r} ${-r}v${r1(-(h - 2 * r))}a${r} ${r} 0 0 1 ${r} ${-r}z`;
const COAST_D = curve(COAST);
const PLATEAU_D = curve(PLATEAU);
const TERRACE_D = curve(TERRACE);
/** the high ground's top edges, for the moonlit rim at night */
export const COAST_LINE = COAST_D;

// ------------------------------------------------------------ mountain ---
// Stacked ledges from the foot shelf up to the summit, west of centre at the
// back of the island; the waterfall drops down their fronts to the pool.
const L0: Pt[] = [
  [292, 178], [302, 142], [328, 116], [370, 98], [420, 84], [480, 76], [540, 78], [590, 88], [622, 106], [634, 132], [626, 160],
  [604, 180], [580, 194], [556, 204], [520, 210], [484, 212], [446, 212], [408, 210], [370, 206], [334, 200], [306, 192],
];
const L1: Pt[] = [
  [340, 150], [362, 122], [400, 104], [450, 94], [510, 92], [560, 98], [596, 114], [606, 138], [592, 158], [560, 170], [520, 174], [480, 174],
  [440, 172], [400, 168], [364, 162],
];
const L2: Pt[] = [[380, 126], [400, 102], [444, 88], [500, 84], [548, 92], [580, 108], [584, 130], [560, 144], [514, 150], [466, 152], [420, 148], [392, 140]];
const L3: Pt[] = [[412, 104], [432, 80], [470, 68], [512, 70], [542, 84], [548, 102], [530, 116], [490, 122], [450, 120], [424, 114]];
const SUMMIT: Pt[] = [[444, 78], [456, 58], [482, 50], [508, 56], [516, 70], [502, 82], [476, 86], [454, 84]];

// ------------------------------------------------- exclusion for scatter ---
const FOOT = L0.map(([x, y]) => [x, y + (y > 150 ? 28 : 0)] as Pt);
export const ZONES: Zone[] = [
  { line: [RUNWAY.a, RUNWAY.b], r: RUNWAY.w / 2 + 12 },
  { poly: APRON, pad: 10 },
  { poly: TAXIWAY, pad: 8 },
  { poly: [[80, 214], [212, 214], [212, 300], [80, 300]], pad: 6 }, // hangar
  { poly: FOOT, pad: 8 },
  { poly: TERRACE.map(([x, y]) => [x, y + (y > 180 ? TERRACE_H : 0)] as Pt), pad: 6 },
  { c: SQUARE.c, r: 80 },
  { poly: [[376, 200], [466, 200], [466, 300], [376, 300]], pad: 4 }, // office + forecourt
  { line: RIVER_S, r: 20 },
  { c: POOL, r: 30 },
  ...PATHS.map((p) => ({ line: p.pts, r: (p.w ?? 12) / 2 + 7 })),
  ...Object.entries(POS).map(([id, c]) => ({ c: [c[0] + 4, c[1] - 16] as Pt, r: id === 'h5' || id === 'h6' ? 52 : id === 'h7' ? 58 : id === 'gen' ? 42 : id.startsWith('h') ? 38 : id.startsWith('p') ? 44 : 30 })),
  ...SPOT.garden.map((c) => ({ c, r: 18 })),
  ...SPOT.benches.map((c) => ({ c, r: 10 })),
  ...SPOT.lamps.map((c) => ({ c, r: 8 })),
  ...SPOT.boats.map((c) => ({ c, r: 22 })),
  ...SPOT.boardwalk.map((c) => ({ c, r: 18 })),
  { poly: [[240, 192], [312, 192], [312, 254], [240, 254]], pad: 4 }, // grove
  { c: SPOT.bar, r: 58 },
  { c: SPOT.lighthouse, r: 24 },
  { line: [DOCK.root, DOCK.tip], r: 14 },
  { line: [[DOCK.head[0], DOCK.head[3]], [DOCK.head[2], DOCK.head[3]]], r: 12 },
  { c: WINDSOCK, r: 16 },
];

/** south of the runway anything tall would stand over the tarmac: bushes keep
 *  a mown strip clear, trees and palms a wider one */
const runwayStrip = (d: number): Zone => ({
  poly: [[RUNWAY.a[0] - 14, RUNWAY.a[1]], [RUNWAY.b[0] + 12, RUNWAY.b[1]], [RUNWAY.b[0] + 12, RUNWAY.b[1] + RUNWAY.w / 2 + d], [RUNWAY.a[0] - 14, RUNWAY.a[1] + RUNWAY.w / 2 + d]],
  pad: 0,
});
const LOW = [...ZONES, runwayStrip(20)];
const TALL = [...ZONES, runwayStrip(46)];

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
      {/* the plateau's south-facing lip: where the moon catches the edge at night */}
      <clipPath id="i-lip">
        <path d={PLATEAU_D} transform={`translate(0 ${LIP})`} />
      </clipPath>
      <clipPath id="i-plat">
        <path d={PLATEAU_D} />
      </clipPath>
      <linearGradient id="i-mouth" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color={K.river} />
        <stop offset=".6" stop-color={K.shallow2} />
        <stop offset="1" stop-color={K.shallow3} />
      </linearGradient>
      <clipPath id="i-fallclip">
        <path d={`M${FALLS[0] - 8} ${FALLS[1] + 6}L${FALLS[0] + 8} ${FALLS[1] + 6}L${FALLS[0] + 9} ${POOL[1] - 4}L${FALLS[0] - 9} ${POOL[1] - 4}Z`} />
      </clipPath>
      <FloraDefs />
    </>
  );
}

// ----------------------------------------------------------------- sea ---
const CAPS: Pt[] = [
  [24, 70], [150, 30], [300, 22], [660, 24], [770, 80], [786, 250], [780, 380], [792, 540], [650, 580], [480, 590], [230, 584], [30, 520], [16, 400], [22, 250],
  [100, 50], [560, 12], [700, 560], [120, 570], [18, 150], [790, 180],
];
/** whitecaps: a broken crescent crest with a foam blob at its leading end
 *  and a faint trail behind, each at its own angle so none reads as a bird */
const CAP_ROT = [-16, 9, -5, 14, -11, 3, 18, -8, 6, -14, 11, -2, 16, -19, 4, -7, 12, -12, 8, -4];
function capPaths(caps: Pt[]) {
  let crest = '', foam = '', trail = '';
  caps.forEach(([x, y], i) => {
    const a = (CAP_ROT[i % CAP_ROT.length] * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    const R = (px: number, py: number) => `${r1(x + px * c - py * s)} ${r1(y + px * s + py * c)}`;
    crest += `M${R(-11, 2.2)}Q${R(-4, -2.6)} ${R(3, -2)}M${R(5.2, -1.6)}Q${R(7.6, -1)} ${R(9, 0.2)}`;
    foam += `M${R(9.4, 1)}a2.3 1.7 0 1 0 4.6 0a2.3 1.7 0 1 0 -4.6 0`;
    if (i % 2 === 0) trail += `M${R(-17, 5)}Q${R(-11, 3.4)} ${R(-5, 4.6)}`;
  });
  return { crest, foam, trail };
}
const CAP_ALL = capPaths(CAPS);
const CAP_WIND = capPaths(CAPS.slice(0, 12));
function Sea({ motion, weather }: { motion: boolean; weather: Weather }) {
  const rough = weather !== 'clear';
  const storm = weather === 'storm';
  const caps = storm ? CAP_ALL : CAP_WIND;
  return (
    <g>
      <rect x={-60} y={-60} width={W + 120} height={H + 120} fill="url(#i-sea)" />
      <rect x={-60} y={-60} width={W + 120} height={H + 120} fill="url(#i-ripple)" />
      {/* whitecaps when it blows */}
      {rough && (
        <g class={motion ? 'bob' : undefined} fill="none" stroke="#fff" stroke-linecap="round">
          <path d={caps.trail} stroke-width="1.4" opacity=".45" />
          <path d={caps.crest} stroke-width={storm ? 2.4 : 1.8} opacity={storm ? 0.9 : 0.75} />
          <path d={caps.foam} fill="#fff" stroke="none" opacity={storm ? 0.9 : 0.7} />
        </g>
      )}
    </g>
  );
}

/** the coast with its notches eased out, so the wide water bands keep smooth
 *  curves instead of kinking where the shore turns in sharply */
function ease(p: Pt[], passes: number): Pt[] {
  let q = p;
  for (let k = 0; k < passes; k++) q = q.map((c, i) => { const a = q[(i - 1 + q.length) % q.length], b = q[(i + 1) % q.length]; return [(a[0] + 2 * c[0] + b[0]) / 4, (a[1] + 2 * c[1] + b[1]) / 4] as Pt; });
  return q;
}
const WIDE_D = curve(ease(COAST, 5));
const MID_D = curve(ease(COAST, 2));
const REEF_D = curve(inset(ease(COAST, 5), () => -32));
function Shallows({ motion, weather }: { motion: boolean; weather: Weather }) {
  const rough = weather !== 'clear';
  return (
    <g stroke-linejoin="round" fill="none">
      <path d={WIDE_D} stroke={K.halo} stroke-width="104" opacity=".55" />
      <path d={WIDE_D} stroke="#fff" stroke-width="74" opacity=".5" class={motion ? 'surf' : undefined} />
      <path d={WIDE_D} stroke={K.shallow1} stroke-width="68" />
      <path d={WIDE_D} stroke="url(#i-caustic)" stroke-width="68" />
      <path d={MID_D} stroke={K.shallow2} stroke-width="42" />
      <path d={COAST_D} stroke={K.shallow3} stroke-width="20" />
      {/* a second surf line offshore; broken and brighter when it blows */}
      <path d={REEF_D} stroke="#fff" stroke-width={rough ? 3 : 2} stroke-dasharray={rough ? '30 10 14 12' : '22 26 8 30'} stroke-linecap="round" opacity={rough ? 0.8 : 0.45} />
    </g>
  );
}

function Beach({ night }: { night: boolean }) {
  return (
    <g>
      <path d={COAST_D} fill={K.sand} />
      <path d={COAST_D} fill="none" stroke={K.sandWet} stroke-width="16" clip-path="url(#i-land)" />
      {/* at night the surf keeps a soft unbroken glow under the grade */}
      {night && <path d={COAST_D} fill="none" stroke="#fff" stroke-width="9" opacity=".3" />}
      <path d={COAST_D} fill="none" stroke="#fff" stroke-width="5" stroke-dasharray="26 7 12 6" stroke-linecap="round" opacity=".95" />
    </g>
  );
}

// ------------------------------------------------------------- plateau ---
const PATCHES: [number, number, number, number, number][] = [
  // cx, cy, rx, ry, seed
  [120, 240, 20, 12, 1], [180, 206, 30, 10, 2], [330, 260, 30, 12, 3], [110, 410, 18, 12, 4], [250, 480, 40, 10, 5], [380, 470, 26, 14, 6],
  [470, 250, 22, 10, 7], [560, 250, 20, 10, 8], [700, 330, 20, 14, 9], [620, 350, 26, 10, 10], [560, 490, 24, 8, 11], [700, 240, 16, 8, 12],
  [360, 420, 18, 10, 13], [150, 460, 26, 8, 14],
];

function Plateau({ night }: { night: boolean }) {
  return (
    <g>
      {/* soft shadow the lip throws onto the sand */}
      <path d={PLATEAU_D} fill={K.shadowSand} transform={`translate(5 ${LIP + 5})`} />
      <path d={PLATEAU_D} fill={K.earthDark} transform={`translate(0 ${LIP})`} />
      <path d={PLATEAU_D} fill={K.earth} transform={`translate(0 ${LIP - 3})`} />
      <path d={PLATEAU_D} fill={K.grassDarker} transform="translate(0 4)" />
      <path d={PLATEAU_D} fill={K.grass} />
      <path d={PLATEAU_D} fill="none" stroke={K.grassLight} stroke-width="3" opacity=".7" transform="translate(-1 -1.5)" clip-path="url(#i-land)" />
      {/* moonlight on the lip's edge: under the trees and buildings, south faces only */}
      {night && <path d={PLATEAU_D} fill="none" stroke="#f2f6ff" stroke-width="3" opacity=".6" transform="translate(0 -1)" clip-path="url(#i-lip)" />}
      <path d={PATCHES.map(([x, y, rx, ry, s]) => curve(blob(x, y, rx, ry, s * 11, 7, 0.25))).join('')} fill={K.grassLight} />
      <path d={PATCHES.filter((_, i) => i % 2 === 0).map(([x, y, rx, ry, s]) => curve(blob(x - rx * 0.2, y - ry * 0.2, rx * 0.45, ry * 0.45, s * 13, 6, 0.2))).join('')} fill={K.grassLighter} opacity=".8" />
      <path
        d={[[330, 140, 20, 8], [420, 460, 22, 8], [180, 400, 20, 7], [640, 440, 24, 7], [736, 380, 10, 14], [80, 300, 10, 16], [600, 230, 18, 6]]
          .map(([x, y, rx, ry], i) => curve(blob(x, y, rx, ry, i * 17 + 5, 7, 0.2)))
          .join('')}
        fill={K.grassDark}
        opacity=".55"
      />
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
const noFalls = (q: Pt) => Math.abs(q[0] - FALLS[0]) < 18;
const R0 = frontEdge(L0, 9, 20, noFalls).flatMap((e, i) => ridge(e, 26, 40 + i, 26));
const R1 = frontEdge(L1, 7, 14, noFalls).flatMap((e, i) => ridge(e, 28, 50 + i, 24));
const R3 = frontEdge(L3, 5, 9).flatMap((e, i) => ridge(e, 24, 65 + i, 20, 0.85));
const R2 = frontEdge(L2, 6, 11, noFalls).flatMap((e, i) => ridge(e, 26, 60 + i, 22, 0.9));
export const RIM_D = PLATEAU_D;
/** loose boulders on the shoulders, one row of nodes */
const LOOSE = [
  [322, 150, 12, 3], [350, 118, 10, 4], [602, 108, 12, 5], [616, 146, 9, 6], [556, 74, 8, 7], [398, 96, 7, 8], [300, 186, 9, 10], [590, 150, 9, 12],
  [424, 92, 7, 13],
].map(([x, y, r, s]) => ({ top: blob(x, y - r * 0.5, r, r * 0.55, s * 31, 6, 0.22), h: r * 0.7 }));
const RT = frontEdge(TERRACE, 5, 9, (q) => q[0] > 600 && q[0] < 640).flatMap((e, i) => ridge(e, TERRACE_H, 70 + i, 22, 0.8));

function Mountain() {
  return (
    <g>
      {/* ground shadow down-right */}
      <path d={curve(FOOT)} fill={K.shadow} transform="translate(12 6)" />
      <Rock top={L0} h={26} topFill={K.grass} smooth />
      <RockRow rocks={R0} />
      <Rock top={L1} h={28} smooth />
      <path d={curve(blob(380, 140, 22, 9, 81, 7, 0.2)) + curve(blob(584, 126, 16, 10, 82, 7, 0.2))} fill={K.grassDark} opacity=".9" />
      <RockRow rocks={R1} />
      <Rock top={L2} h={26} smooth />
      <path d={curve(blob(410, 126, 22, 10, 71, 7, 0.2)) + curve(blob(560, 116, 20, 10, 72, 7, 0.2))} fill={K.grassDark} />
      <path d={curve(blob(406, 123, 13, 6, 73, 7, 0.2)) + curve(blob(556, 113, 11, 5, 75, 7, 0.2))} fill={K.grass} />
      <RockRow rocks={R2} />
      <Rock top={L3} h={24} smooth />
      <path d={curve(blob(438, 100, 14, 7, 76, 7, 0.2)) + curve(blob(530, 96, 12, 6, 77, 7, 0.2))} fill={K.grassDark} opacity=".9" />
      <RockRow rocks={R3} />
      <Rock top={SUMMIT} h={20} topFill={K.grass} smooth />
      <path d={curve(blob(474, 64, 16, 6, 74, 6, 0.2))} fill={K.grassLighter} opacity=".8" />
      {/* loose boulders on the shoulders */}
      <RockRow rocks={LOOSE} />
    </g>
  );
}

/** the lodge shoulder: a raised grass shelf with a rock face, trees at the back */
function Terrace() {
  return (
    <g>
      <path d={TERRACE_D} fill={K.shadow} transform={`translate(10 ${TERRACE_H + 4})`} />
      <Rock top={TERRACE} h={TERRACE_H} topFill={K.grass} smooth hi={false} />
      <RockRow rocks={RT} />
      <path d={TERRACE_D} fill="none" stroke={K.grassLight} stroke-width="3" opacity=".7" transform="translate(-1 -1.5)" />
      <path d={curve(blob(690, 150, 30, 10, 91, 7, 0.2))} fill={K.grassLight} />
    </g>
  );
}

function Falls({ motion }: { motion: boolean }) {
  const [x, y] = FALLS;
  const by = POOL[1] - 4;
  return (
    <g>
      <path d={`M${x - 8} ${y + 6}L${x + 8} ${y + 6}L${x + 9} ${by}L${x - 9} ${by}Z`} fill="url(#i-fall)" />
      <g clip-path="url(#i-fallclip)">
        <g class={motion ? 'fall' : undefined}>
          <path d={Array.from({ length: 8 }, (_, i) => `M${x - 5 + (i % 3) * 5} ${y - 30 + i * 18}l0 12`).join('')} stroke="#fff" stroke-width="2.6" stroke-linecap="round" />
        </g>
      </g>
      <path d={`M${x - 8} ${y + 6}L${x + 8} ${y + 6}`} stroke="#fff" stroke-width="3" stroke-linecap="round" />
      {/* plunge pool */}
      <ellipse cx={POOL[0]} cy={POOL[1]} rx={24} ry={10} fill={K.river} />
      <ellipse cx={POOL[0]} cy={POOL[1] - 1} rx={17} ry={6} fill={K.riverLight} opacity=".7" />
      <path d={`M${POOL[0] - 14} ${POOL[1] - 2}q4 -6 8 0q4 -6 8 0q4 -6 8 0`} stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round" />
      {/* rope bridge across the gorge */}
      <path d={`M${x - 26} 200Q${x} 209 ${x + 26} 202`} stroke={K.woodDark} stroke-width="5" fill="none" />
      <path d={`M${x - 26} 200Q${x} 209 ${x + 26} 202`} stroke={K.woodLight} stroke-width="4" stroke-dasharray="3 1.6" fill="none" />
      <path d={`M${x - 26} 193Q${x} 201 ${x + 26} 195`} stroke="#6d4a2c" stroke-width="1.1" fill="none" />
    </g>
  );
}

function River() {
  const d = curve(RIVER, false);
  const [mx, my] = MOUTH;
  const foot = my + LIP + 1;
  const sea = MOUTH_WATER;
  const mid = (foot + sea) / 2;
  const channel = `M${mx - 9} ${foot - 2}Q${mx - 10} ${mid} ${mx - 16} ${sea + 4}L${mx + 16} ${sea + 4}Q${mx + 11} ${mid} ${mx + 9} ${foot - 2}Z`;
  return (
    <g fill="none" stroke-linecap="round" stroke-linejoin="round">
      {/* the channel stays on the grass: it ends exactly at the plateau's lip */}
      <g clip-path="url(#i-plat)">
        <path d={d} stroke={K.grassDarker} stroke-width="28" />
        <path d={d} stroke={K.earth} stroke-width="23" opacity=".5" />
        <path d={d} stroke={K.river} stroke-width="18" />
        <path d={d} stroke={K.riverLight} stroke-width="5" stroke-dasharray="14 18" opacity=".85" transform="translate(-2 0)" />
      </g>
      {/* it spills over the lip in a little fall... */}
      <path d={`M${mx - 9} ${my - 1}L${mx + 9} ${my - 1}L${mx + 10} ${foot}L${mx - 10} ${foot}Z`} fill="url(#i-fall)" stroke="none" />
      <path d={`M${mx - 5} ${my + 1}v${LIP - 3}M${mx + 1} ${my}v${LIP - 1}M${mx + 6} ${my + 2}v${LIP - 4}`} stroke="#fff" stroke-width="1.8" opacity=".9" />
      {/* ...then cuts across the sand to the sea: an opaque shallow channel,
          river blue running into the shallows' turquoise, between dark wet banks */}
      <path d={channel} fill={K.sandShadow} stroke={K.sandWet} stroke-width="7" stroke-linejoin="round" />
      <path d={channel} fill="url(#i-mouth)" stroke="none" />
      <path d={`M${mx - 3} ${foot + 4}q-1 7 -2 14M${mx + 4} ${foot + 6}q1 6 3 12`} stroke={K.riverLight} stroke-width="1.6" opacity=".8" />
      {/* white foam where it lands, and ticks where it meets the surf */}
      <path d={`M${mx - 12} ${foot + 1}a5 3 0 0 1 8 -2a5 3 0 0 1 8 0a5 3 0 0 1 8 2`} stroke="#fff" stroke-width="3" />
      <path d={`M${mx - 17} ${sea + 1}q3 -2.4 6 0M${mx - 4} ${sea + 3}q3.4 -2.6 7 0M${mx + 10} ${sea + 1}q3 -2.4 6 0`} stroke="#fff" stroke-width="2.2" />
      {/* reeds */}
      {[
        [506, 280], [540, 332], [494, 372], [532, 404], [542, 486],
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
      <path d={`M${-len / 2} -11v-4M${len / 2 - 1} -11v-4M${-len / 2} 7v-4M${len / 2 - 1} 7v-4`} stroke={K.woodDark} stroke-width="3" />
    </g>
  );
}

// --------------------------------------------------------------- paths ---
function Paths({ tier, paved }: { tier: number; paved: boolean }) {
  const list = PATHS.filter((p) => p.tier <= tier && !p.steps);
  return (
    <g fill="none" stroke-linecap="round" stroke-linejoin="round">
      <path d={list.map((p) => curve(p.pts, false)).join('')} stroke={paved ? K.stoneDark : K.dirtEdge} stroke-width={16} />
      {list.map((p, i) => (
        <path key={`m${i}`} d={curve(p.pts, false)} stroke={paved ? K.stone : K.dirt} stroke-width={p.w ?? 12} />
      ))}
      {paved ? (
        <path d={list.map((p) => curve(p.pts, false)).join('')} stroke={K.stoneDark} stroke-width={8} stroke-dasharray="1.2 5" opacity=".7" />
      ) : (
        <path d={list.map((p) => curve(p.pts, false)).join('')} stroke={K.dirtLight} stroke-width={4.4} />
      )}
    </g>
  );
}

/** The town square in front of the office: a planned plaza from day one
 *  (edging, raked sand, planters), laid in patterned stone once paved. */
const ell = (x: number, y: number, rx: number, ry: number) => `M${r1(x - rx)} ${y}a${rx} ${ry} 0 1 0 ${r1(2 * rx)} 0a${rx} ${ry} 0 1 0 ${r1(-2 * rx)} 0`;
export const PLANTERS: Pt[] = [[364, 352], [476, 352]];
function Square({ paved }: { paved: boolean }) {
  const { c: [x, y], rx, ry } = SQUARE;
  const spokes = Array.from({ length: 16 }, (_, i) => {
    const a = (i / 16) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    return `M${r1(x + c * rx * 0.34)} ${r1(y + s * ry * 0.34)}L${r1(x + c * rx * 0.8)} ${r1(y + s * ry * 0.8)}`;
  }).join('');
  const star = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 ? 7 : 17;
    return `${i ? 'L' : 'M'}${r1(x + Math.cos(a) * rr)} ${r1(y + Math.sin(a) * rr * 0.5)}`;
  }).join('') + 'Z';
  return (
    <g>
      <path d={ell(x, y + 3, rx + 4, ry + 4)} fill={paved ? K.stoneDark : K.dirtEdge} />
      <path d={ell(x, y, rx + 1, ry + 1)} fill={paved ? K.stoneLight : '#f0d7a4'} />
      <path d={ell(x, y + 1, rx - 5, ry - 4)} fill={paved ? K.stone : '#e8c68a'} />
      {paved ? (
        <>
          <path d={ell(x, y + 1, rx - 5, ry - 4)} fill="none" stroke={K.stoneLight} stroke-width="5" stroke-dasharray="5 2" />
          <path d={spokes + ell(x, y, rx * 0.58, ry * 0.58)} fill="none" stroke={K.stoneDark} stroke-width="1.2" opacity=".75" />
          <path d={ell(x, y, rx * 0.34, ry * 0.34)} fill={K.stoneLight} stroke={K.stoneDark} stroke-width="1.2" />
          <path d={star} fill="#c98a52" />
        </>
      ) : (
        <>
          <path d={ell(x, y + 1, rx - 5, ry - 4)} fill="none" stroke={K.stoneLight} stroke-width="3" stroke-dasharray="6 3" />
          <path d={ell(x, y, rx * 0.62, ry * 0.62) + ell(x, y, rx * 0.34, ry * 0.34)} fill="none" stroke="#d6ae70" stroke-width="1.6" stroke-dasharray="4 5" />
          <path d={star} fill="#d6ae70" />
        </>
      )}
      {/* planters at the south corners */}
      {PLANTERS.map(([px, py], i) => (
        <g key={i} transform={`translate(${px} ${py})`}>
          <ellipse cx={4} cy={2} rx={13} ry={4} fill={K.shadow} />
          <path d="M-10 0v-7h20v7z" fill={K.woodDark} />
          <path d="M-10 -7l3 -3h20l-3 3z" fill={K.woodLight} />
          <path d="M10 0v-7l3 -3v7z" fill="#6d4a2c" />
          <path d="M-6 -11a5 5 0 1 0 .1 0M2 -13a6 6 0 1 0 .1 0M8 -10a4 4 0 1 0 .1 0" fill={K.treeDark} />
          <path d="M-5 -13a3 3 0 1 0 .1 0M3 -15a3.4 3.4 0 1 0 .1 0" fill={K.tree} />
          <path d="M-7 -12a1.4 1.4 0 1 0 .1 0M1 -16a1.4 1.4 0 1 0 .1 0M7 -12a1.3 1.3 0 1 0 .1 0M-1 -10a1.3 1.3 0 1 0 .1 0" fill={i ? K.pink : K.yellow} />
        </g>
      ))}
    </g>
  );
}

/** where the south path reaches the plateau's lip, steps go down to the sand
 *  (timber, stone once the island is paved) and a worn trail runs on */
function BeachSteps({ paved }: { paved: boolean }) {
  const [x, y] = BEACH_STEPS;
  const top = paved ? K.stoneLight : K.woodLight, face = paved ? K.stoneDark : K.woodDark;
  return (
    <g>
      <path d={`M${x - 11} ${y - 2}h22l2 ${LIP + 5}h-26z`} fill={paved ? K.stoneDark : K.dirtEdge} />
      <path d={Array.from({ length: 4 }, (_, i) => rrect(x - 9 - i * 0.4, y + i * 4, 18 + i * 0.8, 4.4, 1)).join('')} fill={face} />
      <path d={Array.from({ length: 4 }, (_, i) => rrect(x - 9 - i * 0.4, y + i * 4 - 0.4, 18 + i * 0.8, 2.6, 1)).join('')} fill={top} />
      <path d={`M${x - 6} ${y + 20}q2 8 -1 16M${x + 5} ${y + 20}q3 8 1 16`} stroke={K.sandWet} stroke-width="3" fill="none" stroke-linecap="round" opacity=".6" />
    </g>
  );
}

/** stone steps up the terrace face to the lodge */
function Steps() {
  return (
    <g>
      <path d="M612 300Q614 270 618 244" stroke={K.stoneDark} stroke-width="14" fill="none" stroke-linecap="round" />
      <path d="M612 300Q614 270 618 244" stroke={K.stone} stroke-width="10" fill="none" stroke-linecap="round" />
      {/* treads: the risers (dark) merged into one path, then the tops */}
      {['dark', 'light'].map((k) => (
        <path
          key={k}
          d={Array.from({ length: 7 }, (_, i) => {
            const x = 618 + i * 1.2, y = 240 - i * 4.4;
            return k === 'dark' ? rrect(x - 9, y - 2, 18, 5, 1.5) : rrect(x - 9, y - 3.5, 18, 3.5, 1.5);
          })
            .reverse()
            .join('')}
          fill={k === 'dark' ? K.stoneDark : K.stoneLight}
        />
      ))}
    </g>
  );
}

// ------------------------------------------------------------ airfield ---
/** `night`: the apron's concrete goes darker and cooler, so the floodlight pools read */
function Airfield({ weather, motion, night }: { weather: Weather; motion: boolean; night: boolean }) {
  const L = RUNWAY_LEN, w = RUNWAY.w;
  const bars = (x: number) => Array.from({ length: 6 }, (_, i) => `M${x} ${r1(-w / 2 + 4 + i * 5.4)}h14`).join('');
  const stands = [POS.p1, POS.p2].map(([x, y]) => `M${x} ${y + 22}V${y - 26}M${x - 13} ${y + 24}h26`).join('');
  const rw = `translate(${r1(RUNWAY_C[0])} ${r1(RUNWAY_C[1])}) rotate(${r1(RUNWAY_ANGLE)})`;
  return (
    <g>
      {/* the runway's mown verge goes under the taxiway, which runs right up to the runway edge */}
      <rect x={-L / 2 - 6} y={-w / 2 - 5} width={L + 12} height={w + 10} rx={4} fill={K.grassDark} opacity=".6" transform={rw} />
      {/* apron and taxiway, with the hangar's forecourt painted on */}
      <path d={lin(APRON, true) + lin(TAXIWAY, true)} fill={night ? mix(K.concreteDark, '#3e4658', 0.25) : K.concreteDark} transform="translate(0 3)" />
      <path d={lin(APRON, true) + lin(TAXIWAY, true)} fill={night ? mix(K.concrete, '#4e586c', 0.24) : K.concrete} />
      <path d={lin(inset(APRON, () => 3), true)} fill="none" stroke="#fff" stroke-width="1" opacity=".45" />
      <path d={lin(inset(HANGAR_PAD, () => 3), true)} fill="none" stroke="#f2c230" stroke-width="1.6" stroke-dasharray="7 4" opacity=".9" />
      {/* parking stands and the taxi line */}
      <g stroke="#f2c230" stroke-width="1.8" fill="none" opacity=".95">
        <path d={stands} />
        <path d="M258 366Q274 380 274 396L274 420" stroke-dasharray="6 4" />
      </g>
      {/* runway */}
      <g transform={rw}>
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
      <g transform={`translate(${WINDSOCK[0]} ${WINDSOCK[1]})`}>
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
  // round the mountain foot and the office
  [296, 222], [318, 240], [342, 250], [308, 268], [364, 238], [476, 236], [494, 256], [470, 262], [560, 236], [578, 252], [552, 262],
  // north-west plain, the finger and the lagoon shore
  [96, 200], [92, 236], [118, 200], [150, 206], [100, 170], [292, 150], [306, 128],
  // east edge, behind the cottages, the terrace
  [724, 226], [712, 242], [736, 320], [724, 346], [740, 372], [598, 236], [700, 136], [724, 160], [630, 140],
  // south lawns
  [362, 400], [372, 446], [388, 472], [352, 482], [476, 510], [498, 494], [560, 494], [548, 470], [596, 500], [740, 470], [720, 490],
];
const PALMS: [number, number, number, number][] = [
  // x, y, scale, lean
  [86, 210, 1, 1], [122, 186, 0.9, -1], [284, 172, 0.95, 1], [58, 302, 1.05, -1], [56, 352, 0.95, -1], [74, 400, 1, -1],
  [92, 452, 1, 1], [200, 516, 0.95, -1], [276, 524, 1.05, 1], [458, 522, 0.9, -1], [490, 520, 1, 1], [566, 514, 1.05, -1], [620, 506, 0.95, 1],
  [730, 296, 1, -1], [744, 360, 0.95, -1], [752, 416, 1, -1], [742, 466, 0.95, 1], [736, 200, 0.95, -1], [700, 112, 0.9, 1], [312, 108, 1, 1],
  [560, 400, 0.8, 1],
];

/** rocks standing in the shallows, with a ring of foam */
const SEA_ROCKS: [number, number, number][] = [[18, 250, 9], [790, 300, 8], [790, 500, 10], [100, 560, 8], [600, 560, 7], [22, 168, 8], [770, 110, 7]];
const SEA_ROCK_ROW = SEA_ROCKS.map(([x, y, r], i) => boulder(x, y, r, i * 53 + 7));
function SeaRocks() {
  return (
    <g>
      <path d={SEA_ROCKS.map(([x, y, r]) => ell(x, y + 1, r * 1.7, r * 0.7)).join('')} fill="#fff" opacity=".75" />
      <RockRow rocks={SEA_ROCK_ROW} />
    </g>
  );
}

function Lookout() {
  const x = 462, y = 74;
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

/** trees felled when the villas are built (tier 4): the west villa's pool terrace reaches them */
const VILLA_FELLED: Pt[] = [[548, 470]];
/** tier each future asset arrives: its lot keeps a few trees until it is staked out */
const LOT_TREES: { tier: number; pts: Pt[] }[] = [
  { tier: 4, pts: [[590, 440], [616, 452], [690, 434], [668, 452], [712, 444]] },
  { tier: 5, pts: [[630, 180], [676, 176], [700, 190]] },
];

/** the young palms of the grove flourish, sorted in with the wood: a round
 *  tree that would share a canopy with one of them was cleared for the grove */
const GROVE_CLEAR = 25;
function Scatter({ motion, wind, storm, tier, night, grove, site, plots }: { motion: boolean; wind: boolean; storm: boolean; tier: number; night: boolean; grove: boolean; site: boolean; plots: string }) {
  const zones = ZONES;
  const tufts = scatter(11, 90, onGrass, zones, 14);
  const flowers = scatter(12, 48, onGrass, zones, 17);
  const bushes = scatter(13, 30, onGrass, LOW, 22);
  const beach = scatter(14, 34, onBeach, zones, 20);
  const felled = (p: Pt) => (grove && SPOT.grove.some((g) => Math.hypot(p[0] - g[0], p[1] - g[1]) < GROVE_CLEAR)) || (tier >= 4 && VILLA_FELLED.some((q) => q[0] === p[0] && q[1] === p[1]));
  // each tree keeps its kind, size and facing (from its place in the list) when others are felled
  const trees = TREE_SPOTS.filter((p) => clearOf(p, TALL));
  const lots = LOT_TREES.filter((l) => tier < l.tier - 2).flatMap((l) => l.pts);
  const cols = [K.pink, K.yellow, '#ffffff', K.orange, K.purple];
  const items: { y: number; el: preact.JSX.Element }[] = [];
  [...trees, ...lots].forEach(([x, y], i) => {
    if (!felled([x, y])) items.push({ y, el: <Use key={`t${i}`} id={i % 4 === 3 ? 'i-pine' : 'i-tree'} x={x} y={y} s={0.9 + (i % 3) * 0.12} flip={i % 2 === 1} /> });
  });
  bushes.forEach(([x, y], i) => items.push({ y, el: <Use key={`b${i}`} id="i-bush" x={x} y={y} s={0.8 + (i % 3) * 0.15} flip={i % 2 === 0} /> }));
  // while the generator's shed goes up, the two beach palms in front of its plot are cut back
  const palms = PALMS.filter(([x, y]) => clearOf([x, y], TALL) && !(site && Math.hypot(x - POS.gen[0], y - POS.gen[1]) < 56));
  palms.forEach(([x, y, s, l], i) => items.push({ y, el: <Palm key={`p${i}`} x={x} y={y} s={s} lean={l} motion={motion} wind={wind} storm={storm} night={night} /> }));
  // a cottage plot in use is cleared of its palms (each keeps its facing)
  if (grove) SPOT.grove.forEach(([x, y], i) => groveLeft(plots).some((g) => g[0] === x && g[1] === y) && items.push({ y, el: <Use key={`g${i}`} id="i-sapling" x={x} y={y} flip={i % 2 === 1} /> }));
  items.sort((a, b) => a.y - b.y);
  return (
    <g>
      {/* small scatter merged into a few paths: hundreds of bits, a handful of
          nodes (at night the grade hides them, so they are left out) */}
      {!night && <path d={tufts.filter((_, i) => i % 3).map(([x, y]) => `M${r1(x - 4)} ${r1(y)}q1 -5 -2 -8M${r1(x)} ${r1(y)}q0 -6 1 -10M${r1(x + 3)} ${r1(y)}q1 -4 4 -7`).join('')} stroke={K.grassDarker} stroke-width="1.6" fill="none" stroke-linecap="round" />}
      {!night && <path d={tufts.filter((_, i) => !(i % 3)).map(([x, y]) => `M${r1(x - 3)} ${r1(y)}q0 -4 -3 -6M${r1(x)} ${r1(y)}q1 -5 3 -8M${r1(x + 3)} ${r1(y)}q2 -2 4 -3`).join('')} stroke={K.grassLighter} stroke-width="1.5" fill="none" stroke-linecap="round" />}
      {!night &&
        cols.map((c, ci) => (
          <path key={c} d={flowers.filter((_, i) => i % cols.length === ci).map(([x, y]) => dot(x - 5, y - 2, 2.3) + dot(x + 1, y - 5, 2.5) + dot(x + 4, y, 2.2) + dot(x - 1, y + 1, 2)).join('')} fill={c} />
        ))}
      {!night && <path d={flowers.map(([x, y]) => dot(x - 5, y - 2.4, 0.9) + dot(x + 1, y - 5.4, 0.9)).join('')} fill="#fff6c8" />}
      <path d={beach.filter((_, i) => i % 4 === 0 || i % 4 === 3).map(([x, y]) => `M${r1(x - 4)} ${r1(y)}q0 -3 4 -3q4 0 4 3z`).join('')} fill="#c9b8a0" />
      <path d={beach.filter((_, i) => i % 4 === 1).map(([x, y]) => `M${r1(x)} ${r1(y - 5)}l1.4 3.4l3.6 .2l-2.8 2.4l1 3.6l-3.2 -2l-3.2 2l1 -3.6l-2.8 -2.4l3.6 -.2z`).join('')} fill="#ff8a5c" />
      <path d={beach.filter((_, i) => i % 4 === 2).map(([x, y]) => `M${r1(x - 3)} ${r1(y)}q3 -6 6 0z`).join('')} fill="#fff0e6" stroke="#f0b8a0" stroke-width=".6" />
      {!night &&
        [
          [470, 250], [300, 250], [590, 262], [720, 260],
        ].map(([x, y], i) => <Use key={i} id="i-mush" x={x} y={y} />)}
      {/* shore boulders */}
      <RockRow rocks={SHORE_ROCKS} pal={SHORE_PAL} />
      {items.map((it) => it.el)}
    </g>
  );
}
const SHORE_ROCKS = [
  [58, 330, 9, 1], [70, 372, 6, 2], [748, 236, 8, 3], [756, 330, 9, 4], [760, 440, 7, 5], [96, 118, 7, 6], [680, 512, 7, 7], [268, 132, 6, 8],
].map(([x, y, r, s]) => boulder(x, y, r, s * 97));
const SHORE_PAL = { ...ROCK, top: mix(K.rockTop, K.sand, 0.15) };
const dot = (x: number, y: number, r: number) => `M${r1(x - r)} ${r1(y)}a${r} ${r} 0 1 0 ${r1(2 * r)} 0a${r} ${r} 0 1 0 ${r1(-2 * r)} 0`;
const clearOf = (p: Pt, zones: Zone[]) =>
  zones.every((z) => ('c' in z ? Math.hypot(p[0] - z.c[0], p[1] - z.c[1]) >= z.r * 0.8 : 'line' in z ? lineDist(p, z.line) >= z.r : !inPoly(p, z.poly)));

// -------------------------------------------------------------- export ---
/** rain collects on the square, the paths and the apron */
const PUDDLES: [number, number, number][] = [
  [386, 344, 11], [452, 322, 9], [423, 392, 8], [570, 302, 9], [648, 352, 7], [602, 402, 8], [108, 330, 12], [236, 306, 9], [470, 427, 7], [428, 470, 7],
];
function Puddles() {
  return (
    <g>
      <path d={PUDDLES.map(([x, y, r]) => ell(x, y, r, r * 0.38)).join('')} fill="#8fa9bd" opacity=".85" />
      <path d={PUDDLES.map(([x, y, r]) => ell(x - r * 0.2, y - r * 0.08, r * 0.55, r * 0.16)).join('')} fill="#d9e8f2" opacity=".75" />
      <path d={PUDDLES.map(([x, y, r]) => ell(x + r * 0.3, y + 0.5, r * 0.3, r * 0.1)).join('')} fill="none" stroke="#fff" stroke-width=".9" opacity=".8" />
    </g>
  );
}

/** `site`: the generator's shed is being built (its plot is cleared of palms); `plots`: the extra cottages' plots in use ("h8,h9"), cleared of the grove's palms */
export function Terrain({ tier, weather, motion, paved, night, grove, site, plots = '' }: { tier: number; weather: Weather; motion: boolean; paved: boolean; night: boolean; grove: boolean; site: boolean; plots?: string }) {
  return (
    <g>
      <Sea motion={motion} weather={weather} />
      <Shallows motion={motion} weather={weather} />
      <SeaRocks />
      <Beach night={night} />
      <Plateau night={night} />
      <Terrace />
      <River />
      {/* the grove's clearing is ground: the mountain's foot stands on it */}
      {grove && <GroveField plots={plots} />}
      <Mountain />
      <Falls motion={motion} />
      <Lookout />
      <Use id="i-tree" x={560} y={120} s={0.8} />
      <Use id="i-bush" x={506} y={62} s={0.8} />
      {tier >= 5 && <Steps />}
      <Paths tier={tier} paved={paved} />
      <BeachSteps paved={paved} />
      <Square paved={paved} />
      {BRIDGES.map((b, i) => (
        <Bridge key={i} {...b} />
      ))}
      <Airfield weather={weather} motion={motion} night={night} />
      {weather === 'storm' && <Puddles />}
      <Scatter motion={motion} wind={weather !== 'clear'} storm={weather === 'storm'} tier={tier} night={night} grove={grove} site={site} plots={plots} />
    </g>
  );
}
