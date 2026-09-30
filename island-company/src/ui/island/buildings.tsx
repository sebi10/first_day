// Buildings, each drawn at its front-centre ground point in the oblique
// projection: light roof top, mid front, dark east side. Care wears the paint.
import { face, P, type V3 } from './geo';
import { aged, K, mix, shade, tones, weather } from './paint';
import { box, gable, gableZ, hip, post, seg, shadowOf } from './solid';

export type Win = 'glass' | 'lit' | 'shut' | 'dark';
const winFill = (w: Win) => (w === 'lit' ? K.lit : w === 'dark' ? '#33455a' : w === 'shut' ? K.wood : K.glass);
const pt = (v: V3) => P(v).map((n) => Math.round(n * 10) / 10).join(' ');

export type WinRect = [number, number, number, number];
/** window rects per building (local screen units on the front face), shared
 *  with the island's night layer, which redraws lit windows above the grade */
export const WINDOWS: Record<'cottage' | 'villa' | 'lodge' | 'office', WinRect[]> = {
  cottage: [[-16, -12.5, 7.5, 6.5], [8.5, -12.5, 7.5, 6.5]],
  villa: [[-25, -29, 9, 9], [-4.5, -29, 9, 9], [16, -29, 9, 9], [-25, -12, 10, 10], [15, -12, 10, 10]],
  lodge: [[-48, -12, 7, 7], [-38, -12, 7, 7]],
  office: [[-27, -30, 10, 9], [-5, -30, 10, 9], [17, -30, 10, 9], [-26, -12, 10, 9], [16, -12, 10, 9]],
};
/** the lodge's big A-frame window */
export const LODGE_AFRAME = 'M-14 -20L0 -46L14 -20Z';
export const winPath = (rects: WinRect[], ox = 0, oy = 0, k = 1) =>
  rects.map(([x, y, ww, hh]) => `M${Math.round((ox + x * k) * 10) / 10} ${Math.round((oy + y * k) * 10) / 10}h${Math.round(ww * k * 10) / 10}v${Math.round(hh * k * 10) / 10}h${-Math.round(ww * k * 10) / 10}z`).join('');

/** windows (screen rects on the front face, which is undistorted) */
function Windows({ rects, w }: { rects: WinRect[]; w: Win }) {
  const d = winPath(rects);
  return (
    <>
      <path d={d} fill={winFill(w)} stroke={w === 'lit' ? '#e8a040' : '#ffffff'} stroke-width={w === 'lit' ? 0.8 : 1.2} />
      {w === 'glass' && <path d={rects.map(([x, y, ww, hh]) => `M${x + 1} ${y + hh - 1.5}l${Math.min(ww, hh) * 0.6} ${-hh + 3}`).join('')} stroke="#fff" stroke-width="1.3" opacity=".8" />}
      {w === 'shut' && <path d={rects.map(([x, y, ww, hh]) => `M${x + ww / 2} ${y}v${hh}`).join('')} stroke={K.woodDark} stroke-width="1" />}
    </>
  );
}

/** peeling paint when the island is poorly kept: patches of bare plaster
 *  with a lifted white lip along their top and a drip or two below, stronger
 *  the more worn the place is */
function Wear({ wear, spots }: { wear: number; spots: [number, number, number][] }) {
  if (wear < 0.25) return null;
  const o = Math.min(0.9, 0.3 + wear);
  const patch = ([x, y, r]: [number, number, number]) => `M${x - r * 1.3} ${y}q${r * 0.5} ${-r} ${r * 1.3} ${-r * 0.6}q${r} ${r * 0.1} ${r * 1.3} ${r * 0.8}q${-r * 0.8} ${r * 0.7} ${-r * 1.8} ${r * 0.2}z`;
  return (
    <g opacity={o}>
      <path d={spots.map(patch).join('')} fill="#b59c78" />
      <path d={spots.map(([x, y, r]) => `M${x - r * 1.3} ${y}q${r * 0.5} ${-r} ${r * 1.3} ${-r * 0.6}q${r} ${r * 0.1} ${r * 1.3} ${r * 0.8}`).join('')} stroke="#fffaf0" stroke-width=".9" fill="none" />
      <path d={spots.map(([x, y, r]) => `M${x + r * 0.2} ${y + r * 0.4}v${r * 1.4}M${x + r * 0.7} ${y + r * 0.2}v${r}`).join('')} stroke="#7d6e5c" stroke-width="1.1" />
    </g>
  );
}
/** a roof in need of care: a plank gone (a dark gap) and one patched in a
 *  paler, odd colour; `gap` and `odd` = [x, y, width] of each on the front slope */
function RoofWear({ wear, lo, mid, gap, odd }: { wear: number; lo: string; mid: string; gap: [number, number, number]; odd: [number, number, number] }) {
  if (wear < 0.25) return null;
  const o = Math.min(1, 0.45 + wear);
  const plank = ([x, y, w]: [number, number, number], h: number) => `M${x} ${y}h${w}l.5 ${h}h${-w}z`;
  return (
    <g opacity={o}>
      <path d={plank(gap, 2.6)} fill={lo} />
      <path d={plank(odd, 3)} fill={mix(mid, '#e9e2b8', 0.55)} stroke={lo} stroke-width=".5" />
    </g>
  );
}

export function Ribbon({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d="M-11 -6L0 0L-11 6ZM11 -6L0 0L11 6Z" fill="#e8453c" />
      <path d="M0 0L-6 12L-3 12L0 5L3 12L6 12Z" fill="#c9302a" />
      <circle r={3} fill="#ff6b5e" />
    </g>
  );
}

/** What is wrong with a house, drawn on the house itself. */
/** reno (G0): 'work' the builders have it closed for its renovation (scaffold and a tarp); 'final' they're done and it
 *  waits on the electrician's permit final (a permit card staked out front) */
export type Fault = { tag?: boolean; damaged?: boolean; lapsed?: boolean; smoking?: boolean; reno?: 'work' | 'final' };
type FaultGeo = { w: number; h: number; door: [number, number, number, number]; shutter: [number, number]; patches: [number, number][]; crack: [number, number]; board: [number, number]; smoke: [number, number] };
/** where a house's smoke rises from (front-centre local units), for keep-outs */
export const SMOKE_AT: Record<'cottage' | 'villa' | 'lodge', [number, number]> = { cottage: [12, -31], villa: [14, -45], lodge: [17, -40] };

/** a house in a bad way (under 30): a charred hole in the roof and a grey
 *  column of smoke. The first wisp is static so it always reads; the rest
 *  rise on the shared puff loop (static too when motion is off). */
function Smoke({ at: [x, y], motion }: { at: [number, number]; motion: boolean }) {
  return (
    <g>
      <path d={`M${x - 5} ${y + 1}q1 -3 4 -3.4q3 -.6 5 1.2q1.6 2 -1 3.4q-4 1.4 -8 -1.2z`} fill="#2f2a26" />
      <path d={`M${x - 3} ${y}q2 -2 4.4 -1.6`} stroke="#ff8a3a" stroke-width="1" fill="none" stroke-linecap="round" />
      <g transform={`translate(${x} ${y - 3})`}>
        <circle cx={0.5} cy={-1} r={4.4} fill="#4a4f53" />
        <circle cx={2.6} cy={-8.4} r={5.6} fill="#686d71" opacity=".95" />
        <g class={motion ? 'puff' : undefined}>
          <circle cx={4.4} cy={-15} r={6} fill="#868c90" />
          <circle cx={7.4} cy={-23.5} r={6.8} fill="#a7acaf" opacity=".9" />
          <circle cx={10.4} cy={-32} r={7.2} fill="#c9cdd0" opacity=".8" />
        </g>
        <g class={motion ? 'puff puff-late' : undefined}>
          <circle cx={6} cy={-19} r={6} fill="#979da1" opacity=".85" />
          <circle cx={11.4} cy={-36} r={6.6} fill="#d4d7d9" opacity=".7" />
        </g>
      </g>
    </g>
  );
}
/** red-tagged: sealed with barrier tape and a tag on the door; damaged: a
 *  shutter hanging off, a crack, planks nailed over the roof and across the
 *  door; inspection lapsed: a closed notice staked out front */
function Faults({ f, g, motion }: { f: Fault; g: FaultGeo; motion: boolean }) {
  const [dx0, dy0, dx1, dy1] = g.door;
  const cx = (dx0 + dx1) / 2;
  return (
    <>
      {f.smoking && <Smoke at={g.smoke} motion={motion} />}
      {f.damaged && (
        <>
          <path d={g.patches.map(([x, y]) => `M${x - 5} ${y - 3}l10 -1.5l1 6l-10 1.5z`).join('')} fill="#c9a36a" stroke="#7a5534" stroke-width=".9" />
          <path d={g.patches.map(([x, y]) => `M${x - 3.4} ${y - 2.6}l.2 5M${x + 3.4} ${y - 3.6}l.2 5`).join('')} stroke="#7a5534" stroke-width=".8" />
          <path d={`M${g.crack[0]} ${g.crack[1]}l2 3.5l-2.4 2.6l2.2 4`} stroke="#7d6e5c" stroke-width="1.1" fill="none" />
          <g transform={`translate(${g.shutter[0]} ${g.shutter[1]}) rotate(28)`}>
            <path d="M0 0h4.2v8.4h-4.2z" fill={K.woodDark} stroke="#5c3b20" stroke-width=".6" />
            <path d="M.8 2.2h2.6M.8 4.6h2.6" stroke="#5c3b20" stroke-width=".6" />
          </g>
          {/* boarded up: two planks nailed across the door */}
          <path d={`M${dx0 - 2} ${dy0 + (dy1 - dy0) * 0.25}L${dx1 + 2} ${dy0 + (dy1 - dy0) * 0.62}M${dx0 - 2} ${dy0 + (dy1 - dy0) * 0.7}L${dx1 + 2} ${dy0 + (dy1 - dy0) * 0.36}`} stroke="#5c3b20" stroke-width="3.6" stroke-linecap="round" />
          <path d={`M${dx0 - 2} ${dy0 + (dy1 - dy0) * 0.25}L${dx1 + 2} ${dy0 + (dy1 - dy0) * 0.62}M${dx0 - 2} ${dy0 + (dy1 - dy0) * 0.7}L${dx1 + 2} ${dy0 + (dy1 - dy0) * 0.36}`} stroke="#d8b27a" stroke-width="2.2" stroke-linecap="round" />
        </>
      )}
      {f.tag && (
        <>
          <path d={`M${-g.w + 1} ${-g.h + 3}L${g.w - 1} -2M${-g.w + 1} -2L${g.w - 1} ${-g.h + 3}`} stroke={K.red} stroke-width="3.2" stroke-linecap="round" />
          <path d={`M${-g.w + 1} ${-g.h + 3}L${g.w - 1} -2M${-g.w + 1} -2L${g.w - 1} ${-g.h + 3}`} stroke="#fff" stroke-width="3.2" stroke-dasharray="2.6 3.2" />
          <g transform={`translate(${cx + 1} ${dy0 + (dy1 - dy0) * 0.45}) rotate(-8)`}>
            <path d="M-3.6 0h7.2l1.6 2v8.4h-10.4v-8.4z" fill={K.red} stroke="#fff" stroke-width="1" />
            <circle cx={0} cy={2.2} r={0.9} fill="#fff" />
            <path d="M-2.2 5h4.4M-2.2 7.2h4.4" stroke="#fff" stroke-width=".9" />
          </g>
        </>
      )}
      {/* G0: under renovation: a blue tarp over the front wall's west half and a scaffold across the front (4 nodes) */}
      {f.reno === 'work' && (
        <>
          <path d={`M${-g.w + 2} ${-g.h + 1}H${-1}l-1.4 ${g.h * 0.55}l-3 ${g.h * 0.3}H${-g.w + 3}l-1 ${-g.h * 0.4}z`} fill="#2f6fb8" opacity=".92" />
          <path d={`M${-g.w + 4} ${-g.h + 4}h${g.w - 8}M${-g.w + 4} ${-g.h * 0.55}h${g.w - 9}`} stroke="#6aa6e6" stroke-width="1.1" />
          <path d={`M${-g.w - 2} 1V${-g.h - 5}M${g.w + 2} 1V${-g.h - 5}M${-g.w - 2} ${-g.h * 0.5}L${g.w + 2} ${-g.h - 3}`} stroke="#8d969c" stroke-width="1.6" stroke-linecap="round" />
          <path d={`M${-g.w - 4} ${-g.h * 0.5}h${2 * g.w + 8}M${-g.w - 4} ${-g.h - 3}h${2 * g.w + 8}`} stroke={K.wood} stroke-width="2.6" stroke-linecap="round" />
        </>
      )}
      {/* G0: the builders are done, the permit final is the electrician's: the permit card on its stake (3 nodes) */}
      {f.reno === 'final' && (
        <g transform={`translate(${g.board[0]} ${g.board[1]})`}>
          <path d="M0 0V-13" stroke={K.woodDark} stroke-width="2" />
          <path d="M-8 -24h16v11h-16z" fill="#ffd23f" stroke={K.woodDark} stroke-width="1.4" />
          <path d="M-5 -21h10M-5 -18h10M-5 -15.4h6" stroke={K.woodDark} stroke-width=".9" />
        </g>
      )}
      {f.lapsed && (
        <g transform={`translate(${g.board[0]} ${g.board[1]})`}>
          <ellipse cx={3} cy={1} rx={7} ry={2} fill={K.shadow} />
          <path d="M0 0V-13" stroke={K.woodDark} stroke-width="2" />
          <path d="M-8 -24h16v11h-16z" fill="#fff" stroke={K.red} stroke-width="1.8" />
          <path d="M-8 -18.5h16" stroke={K.red} stroke-width="3.4" />
          <path d="M-5 -21.5h10M-5 -15.4h7" stroke="#8a8f93" stroke-width=".9" />
        </g>
      )}
    </>
  );
}

// ------------------------------------------------------------- cottage ---
type HouseProps = { tint: string; win: Win; wear: number; open: boolean; fault?: Fault; motion?: boolean };
export function Cottage({ tint, win, wear, open, fault = {}, motion = false }: HouseProps) {
  const w = 20, d = 26, h = 18, rh = 16, o = 5;
  const b = box(-w, w, 0, h, 0, d);
  const r = gable(-w, w, h, 0, d, rh, o);
  const roof = tones(aged(tint, wear));
  const thatch = tint.toLowerCase() === '#e6d0a6';
  const wall = weather(K.wall, wear);
  return (
    <g>
      <path d={shadowOf(-w, w, 0, d, h + rh)} fill={K.shadow} />
      <path d={r.back} fill={roof.lo} />
      <path d={b.side + r.end} fill={weather(K.wallDark, wear)} />
      <path d={b.front} fill={wall} />
      <path d="M-20 -3h40v3h-40z" fill={weather(K.wallShade, wear)} />
      <Wear wear={wear} spots={[[-12, -4, 5], [12, -10, 4]]} />
      <path d="M-4.5 0v-11.5a4.5 4 0 0 1 9 0V0z" fill={open ? K.woodDark : '#6b4a2e'} />
      <circle cx={2.4} cy={-5.5} r={0.9} fill={K.yellow} />
      <Windows rects={WINDOWS.cottage} w={win} />
      {wear < 0.4 && <path d="M-16.5 -5.2h8.5v2h-8.5zM8 -5.2h8.5v2h-8.5z" fill={K.woodDark} />}
      {wear < 0.4 && <path d="M-15 -6a1.4 1.4 0 1 0 .1 0M-11.5 -6.4a1.4 1.4 0 1 0 .1 0M10 -6a1.4 1.4 0 1 0 .1 0M13.5 -6.4a1.4 1.4 0 1 0 .1 0" fill={K.pink} />}
      <path d={r.front} fill={thatch ? mix(roof.mid, '#f3d57e', 0.35) : roof.mid} />
      <path d={r.courses(thatch ? 4 : 3)} stroke={roof.lo} stroke-width={thatch ? 1.6 : 1.1} opacity=".55" fill="none" />
      <path d={r.ridge} stroke={roof.hi} stroke-width="3" stroke-linecap="round" />
      <RoofWear wear={wear} lo={roof.dk} mid={roof.mid} gap={[-5, -31, 9]} odd={[7.5, -23.8, 10]} />
      <Faults f={fault} motion={motion} g={{ w, h, door: [-4.5, -11.5, 4.5, 0], shutter: [-17, -12.5], patches: [[-8, -27], [4, -22]], crack: [11, -17], board: [-27, 6], smoke: SMOKE_AT.cottage }} />
    </g>
  );
}

// --------------------------------------------------------------- villa ---
export function Villa({ tint, win, wear, open, fault = {}, motion = false }: HouseProps) {
  const w = 30, d = 32, h = 32, rh = 13, o = 5;
  const b = box(-w, w, 0, h, 0, d);
  const r = hip(-w, w, h, 0, d, rh, o, 14);
  const roof = tones(aged(tint, wear));
  const wall = weather('#ffffff', wear * 0.9);
  const bal = box(-w + 2, w - 2, 14, 16.5, -8, 0);
  return (
    <g>
      <path d={shadowOf(-w, w, 0, d, h + rh)} fill={K.shadow} />
      {/* pool terrace in front */}
      <path d={`M${pt([-w - 8, 0, -30])}L${pt([w + 6, 0, -30])}L${pt([w + 6, 0, 0])}L${pt([-w - 8, 0, 0])}Z`} fill={K.stoneLight} />
      <path d={`M${pt([-w - 2, 0, -26])}L${pt([4, 0, -26])}L${pt([4, 0, -12])}L${pt([-w - 2, 0, -12])}Z`} fill="#4fcbe8" stroke="#fff" stroke-width="2" />
      <path d={`M${pt([-w + 2, 0, -22])}l18 0`} stroke="#b8f2ff" stroke-width="2" stroke-linecap="round" />
      <path d={`M${pt([12, 0, -24])}l12 -3l2 2l-12 3z`} fill="#fff" />
      <path d={r.back} fill={roof.lo} />
      <path d={b.side} fill={weather(K.wallShade, wear)} />
      <path d={b.front} fill={wall} />
      <Wear wear={wear} spots={[[-20, -6, 6], [18, -24, 5], [0, -12, 4]]} />
      <Windows rects={WINDOWS.villa} w={win} />
      <path d="M-6 0v-13h12v13z" fill={open ? '#6fb7d8' : K.wood} stroke="#fff" stroke-width="1.2" />
      <path d={`M-27 -30h2v11h-2zM-16 -30h2v11h-2zM14 -30h2v11h-2zM25 -30h2v11h-2z`} fill={weather(tint, wear)} />
      {/* balcony */}
      <path d={bal.front + bal.top} fill={weather('#f1ece2', wear)} />
      <path d={`M${pt([-w + 2, 16.5, -8])}L${pt([w - 2, 16.5, -8])}`} stroke="#fff" stroke-width="1" />
      <path d={Array.from({ length: 12 }, (_, i) => post(-w + 3 + i * 4.9, -8, 6, 16.5)).join('') + seg([-w + 2, 22.5, -8], [w - 2, 22.5, -8])} stroke="#fff" stroke-width="1.3" />
      <path d={r.west} fill={roof.hi} />
      <path d={r.east} fill={roof.lo} />
      <path d={r.front} fill={roof.mid} />
      <path d={r.ridge} stroke={roof.hi} stroke-width="2.4" stroke-linecap="round" />
      <RoofWear wear={wear} lo={roof.dk} mid={roof.mid} gap={[-12, -40, 8]} odd={[8, -35, 10]} />
      <path d={`M${pt([w - 8, h + 6, d * 0.7])}v-10h5v10z`} fill={weather('#e9e2d6', wear)} />
      <Faults f={fault} motion={motion} g={{ w, h, door: [-6, -13, 6, 0], shutter: [-26, -29], patches: [[-12, -40], [2, -38]], crack: [20, -26], board: [-40, 8], smoke: SMOKE_AT.villa }} />
    </g>
  );
}

// --------------------------------------------------------------- lodge ---
export function Lodge({ tint, win, wear, open, fault = {}, motion = false }: HouseProps) {
  const w = 30, d = 40, h = 20, rh = 34, o = 5;
  const b = box(-w, w, 0, h, 0, d);
  const base = box(-w, w, 0, 7, 0, d);
  const r = gableZ(-w, w, h, 0, d, rh, o);
  const wing = box(-w - 24, -w, 0, 16, 6, 34);
  const wr = gable(-w - 24, -w, 16, 6, 34, 11, 3);
  // a dressed-stone retaining wall holds the peak's boulders back from the terrace
  const wall = box(-w - 36, -w - 29, 0, 13, -8, 46);
  const courses = [4.4, 8.8].map((y) => `M${pt([-w - 29, y, -8])}L${pt([-w - 29, y, 46])}`).join('') + [4, 16, 28, 40].map((z, i) => `M${pt([-w - 29, i % 2 ? 4.4 : 0, z])}v-4.4`).join('');
  const roof = tones(aged(tint, wear));
  const timber = weather('#c98a52', wear);
  const deck = box(-w - 4, w + 4, 0, 4, -14, 0);
  return (
    <g>
      <path d={shadowOf(-w - 36, w, 0, d, h + rh)} fill={K.shadow} />
      <path d={wall.top} fill="#d9d0c0" />
      <path d={wall.side} fill="#b8ad9a" />
      <path d={wall.front} fill="#9d927f" />
      <path d={courses} stroke="#8a7f6c" stroke-width=".8" fill="none" />
      {/* west wing */}
      <path d={wr.back} fill={roof.lo} />
      <path d={wing.front} fill={timber} />
      <Windows rects={WINDOWS.lodge} w={win} />
      <path d={wr.front} fill={roof.mid} />
      <path d={wr.ridge} stroke={roof.hi} stroke-width="2" />
      {/* main hall */}
      <path d={b.side} fill={shade(timber, -0.3)} />
      <path d={base.side} fill="#7d7468" />
      <path d={b.front} fill={timber} />
      <path d={base.front} fill="#a39a8c" />
      <path d="M-28 -2h8M-16 -5h9M-2 -2h10M12 -5h8M-24 -6h6M4 -6h6" stroke="#857b6e" stroke-width="1.2" />
      <path d={`M${pt([-w, 20, 0])}L${pt([w, 20, 0])}`} stroke={shade(timber, -0.35)} stroke-width="2" />
      <path d={r.east} fill={roof.lo} />
      <path d={r.west} fill={roof.hi} />
      <path d={r.gable} fill={shade(timber, 0.12)} />
      {/* big A-frame window */}
      <path d={LODGE_AFRAME} fill={winFill(win)} stroke="#fff4dc" stroke-width="1.6" />
      <path d="M0 -46V-20M-7 -33H7" stroke="#fff4dc" stroke-width="1.2" />
      {win === 'glass' && <path d="M-9 -22l6 -12" stroke="#fff" stroke-width="1.4" opacity=".8" />}
      <path d={r.eaves} stroke={roof.dk} stroke-width="2.4" fill="none" stroke-linejoin="round" />
      <RoofWear wear={wear} lo={roof.dk} mid={roof.hi} gap={[-27, -28, 8]} odd={[20, -36, 9]} />
      <Wear wear={wear} spots={[[-18, -10, 5], [16, -14, 5]]} />
      {/* stone chimney rising out of the east slope, just clear of the ridge, with a cap */}
      {(() => {
        const cap = box(10.8, 21.2, 56, 59.5, 20.8, 31.2);
        return (
          <g>
            <path d={face([[12, 42.3, 22], [20, 34.6, 22], [20, 57, 22], [12, 57, 22]])} fill="#a39a8c" />
            <path d={face([[20, 34.6, 22], [20, 34.6, 30], [20, 57, 30], [20, 57, 22]])} fill="#7d7468" />
            <path d={cap.front + cap.side} fill="#5f574e" />
            <path d={cap.top} fill="#8f8577" />
            <path d={face([[13, 59.5, 23.5], [19, 59.5, 23.5], [19, 59.5, 28.5], [13, 59.5, 28.5]])} fill="#3a342e" />
          </g>
        );
      })()}
      {/* deck */}
      <path d={deck.top} fill={weather(K.woodLight, wear)} />
      <path d={deck.front} fill={K.woodDark} />
      <path d={Array.from({ length: 13 }, (_, i) => post(-w - 3 + i * 5.5, -14, 7, 4)).join('') + seg([-w - 4, 11, -14], [w + 4, 11, -14])} stroke={K.woodDark} stroke-width="1.4" />
      <path d="M-5 -4v-14h10v14z" fill={open ? '#6fb7d8' : K.woodDark} stroke="#fff4dc" stroke-width="1.2" />
      <Faults f={fault} motion={motion} g={{ w: 22, h: 22, door: [-5, -18, 5, -4], shutter: [-49, -12], patches: [[-18, -34], [8, -30]], crack: [18, -14], board: [-60, 12], smoke: SMOKE_AT.lodge }} />
    </g>
  );
}

// -------------------------------------------------------------- hangar ---
export function Hangar({ tint, wear, doorOpen }: { tint: string; wear: number; doorOpen: boolean }) {
  const w = 50, d = 54, h = 22, ah = 20;
  const bx = P([0, 0, d]); // back shift
  const [sx, sy] = bx;
  const roof = tones(aged(tint, wear));
  const side = box(-w, w, 0, h, 0, d);
  // rust running down the barrel roof between the ribs, the more worn the more of it
  const onArch = (t: number, k: number) => `${Math.round((w * Math.cos(t) + sx * k) * 10) / 10} ${Math.round((-h - ah * Math.sin(t) + sy * k) * 10) / 10}`;
  const rust = [
    [0.14, 1.25, 0.8], [0.22, 2.0, 2.45], [0.45, 1.05, 0.62], [0.52, 2.3, 2.75], [0.78, 1.5, 1.05], [0.86, 2.55, 2.9], [0.35, 1.7, 2.1],
  ].map(([k, a, b]) => `M${onArch(a, k)}L${onArch(b, k)}`).join('');
  const arch = (dx: number, dy: number, rev = false) =>
    rev ? `L${w + dx} ${-h + dy}A${w} ${ah} 0 0 0 ${-w + dx} ${-h + dy}` : `M${-w + dx} ${-h + dy}A${w} ${ah} 0 0 1 ${w + dx} ${-h + dy}`;
  const ribs = [0.33, 0.66].map((k) => `M${-w + sx * k} ${-h + sy * k}A${w} ${ah} 0 0 1 ${w + sx * k} ${-h + sy * k}`).join('');
  return (
    <g>
      <path d={shadowOf(-w, w, 0, d, h + ah + 6)} fill={K.shadow} />
      <path d={side.side} fill={weather('#b9b3a6', wear)} />
      <path d={`M${w + sx * 0.25} ${-h + 6 + sy * 0.25}l${sx * 0.5} ${sy * 0.5}v5l${-sx * 0.5} ${-sy * 0.5}z`} fill="#8fb4c8" />
      <path d={arch(0, 0) + arch(sx, sy, true) + 'Z'} fill={roof.mid} />
      <path d={`M${-w} ${-h}A${w} ${ah} 0 0 1 ${-w * 0.2} ${-h - ah * 0.98}L${-w * 0.2 + sx} ${-h - ah * 0.98 + sy}A${w} ${ah} 0 0 0 ${-w + sx} ${-h + sy}Z`} fill={roof.hi} />
      <path d={ribs} stroke={roof.lo} stroke-width="1.6" fill="none" opacity=".7" />
      {wear >= 0.25 && <path d={rust} stroke="#7e3a18" stroke-width="2.2" stroke-linecap="round" fill="none" opacity={Math.min(0.85, 0.3 + wear)} />}
      {/* facade */}
      <path d={`M${-w} 0V${-h}A${w} ${ah} 0 0 1 ${w} ${-h}V0Z`} fill={weather('#ece6da', wear)} />
      <path d={`M${-w} ${-h}A${w} ${ah} 0 0 1 ${w} ${-h}`} stroke={roof.lo} stroke-width="3" fill="none" />
      <Wear wear={wear} spots={[[-40, -8, 6], [38, -14, 5]]} />
      <path d="M-36 0V-30H36V0Z" fill="#2c3840" />
      <path d="M-36 -30H36" stroke="#6c7780" stroke-width="3" />
      {doorOpen ? (
        <path d="M-44 0V-29H-34V0ZM34 0V-29H44V0Z" fill="#cfd6d8" stroke="#9aa5ab" stroke-width="1" />
      ) : (
        <path d="M-36 0V-29H36V0Z" fill="#cfd6d8" stroke="#9aa5ab" stroke-width="1" />
      )}
      <path d={doorOpen ? 'M-39 -2V-27M-41 -2V-27M39 -2V-27M41 -2V-27' : 'M-24 -2V-27M-12 -2V-27M0 -2V-27M12 -2V-27M24 -2V-27'} stroke="#9aa5ab" stroke-width="1" />
      {/* emblem: a propeller in a roundel */}
      <circle cx={0} cy={-35} r={5.5} fill={roof.mid} stroke="#fff" stroke-width="1.4" />
      <path d="M0 -35l-3.5 -3M0 -35l4 -1.5M0 -35l-.5 4.5" stroke="#fff" stroke-width="1.8" stroke-linecap="round" />
    </g>
  );
}

// -------------------------------------------------------------- office ---
export function Office({ tint, win, wear, flag, motion }: { tint: string; win: Win; wear: number; flag: string; motion: boolean }) {
  const w = 32, d = 32, h = 34, rh = 14, o = 4;
  const b = box(-w, w, 0, h, 0, d);
  const r = hip(-w, w, h, 0, d, rh, o, 14);
  const roof = tones(aged('#3f6fb5', wear * 0.8));
  const wall = weather('#fde9b8', wear);
  const aw = tones(weather(tint, wear * 0.6));
  // striped awning from the wall (y 17) out to the valance (y 12, z -10)
  const stripes = Array.from({ length: 8 }, (_, i) => {
    const x0 = -29 + i * 7.25, x1 = x0 + 7.25;
    return { d: `M${pt([x0, 17, 0])}L${pt([x1, 17, 0])}L${pt([x1, 11.5, -10])}L${pt([x0, 11.5, -10])}Z`, c: i % 2 ? '#ffffff' : aw.mid };
  });
  return (
    <g>
      <path d={shadowOf(-w, w, 0, d, h + rh + 10)} fill={K.shadow} />
      <path d={r.back} fill={roof.lo} />
      <path d={b.side} fill={weather('#e3c98f', wear)} />
      <path d={b.front} fill={wall} />
      <path d="M-32 -34h64v3h-64z" fill="#fff" opacity=".7" />
      <path d="M-32 -17.5h64" stroke="#fff" stroke-width="1.6" />
      <Wear wear={wear} spots={[[-22, -6, 5], [20, -26, 5]]} />
      <Windows rects={WINDOWS.office} w={win} />
      <path d="M-7 0V-13H7V0Z" fill={win === 'lit' ? K.lit : '#7fc3dc'} stroke="#fff" stroke-width="1.4" />
      <path d="M0 0V-13" stroke="#fff" stroke-width="1" />
      {stripes.map((s, i) => (
        <path key={i} d={s.d} fill={s.c} />
      ))}
      <path d={Array.from({ length: 8 }, (_, i) => `M${pt([-29 + i * 7.25, 11.5, -10])}q3.6 4 7.25 0`).join('')} fill={aw.mid} stroke={aw.lo} stroke-width=".6" />
      <path d="M-11 0h22v2.5h-22z" fill={K.stoneDark} />
      <path d={r.west} fill={roof.hi} />
      <path d={r.east} fill={roof.lo} />
      <path d={r.front} fill={roof.mid} />
      <path d={r.ridge} stroke={roof.hi} stroke-width="2.2" stroke-linecap="round" />
      {/* sign on the roof: a little rising bar chart */}
      <rect x={-10} y={-45} width={20} height={11} rx={2.5} fill="#fff" stroke={aw.lo} stroke-width="1.4" />
      <path d="M-5.5 -36.5v-3M-1.8 -36.5v-5M1.9 -36.5v-4M5.6 -36.5v-6.5" stroke={aw.lo} stroke-width="2.4" />
      {/* potted plants by the door */}
      <path d="M-16 0l1 -5h6l1 5zM10 0l1 -5h6l1 5z" fill="#c07a4a" />
      <path d="M-12 -5a4 4 0 1 0 .1 0M14 -5a4 4 0 1 0 .1 0" fill={K.tree} />
      {/* flagpole on the roof */}
      {(() => {
        const [fx, fy] = P([0, h + rh, d / 2]);
        return (
          <g transform={`translate(${fx} ${fy})`}>
            <path d="M0 0V-26" stroke="#e6e1d8" stroke-width="1.8" />
            <circle cy={-26.5} r={1.4} fill={K.yellow} />
            <g transform="translate(1 -25)">
              <g class={motion ? 'flag' : undefined}>
                <path d="M0 0q7 -2 14 1v9q-7 -3 -14 -1z" fill={flag} />
                <circle cx={7} cy={4.8} r={2.2} fill={K.yellow} />
              </g>
            </g>
          </g>
        );
      })()}
    </g>
  );
}

// ------------------------------------------------------------ generator ---
/** running: carrying the island (grid down) — exhaust, a green beacon, door open, lit inside */
export function GenHouse({ wear, running, motion, lamp }: { wear: number; running: boolean; motion: boolean; lamp?: boolean }) {
  const w = 18, d = 22, h = 16;
  const b = box(-w, w, 0, h, 0, d);
  const para = box(-w, w, h, h + 2, 0, d);
  const tank = box(w + 4, w + 20, 0, 8, 4, 18);
  const [sx, sy] = P([w + 12, 8, 11]); // the stack stands on the tank end, clear of the grid next door
  const [lx, ly] = P([8, h + 2, 8]); // east of the wire's roof insulator
  return (
    <g>
      <path d={shadowOf(-w, w + 20, 0, d, h + 4)} fill={K.shadow} />
      <path d={b.side} fill={weather('#a9a391', wear)} />
      <path d={b.front} fill={weather('#d9d3c2', wear)} />
      <path d={para.top} fill={weather('#8d9489', wear)} />
      <path d={para.front + para.side} fill={weather('#c4bda9', wear)} />
      <path d={`M${pt([-w + 3, h + 2, 4])}L${pt([w - 3, h + 2, 4])}L${pt([w - 3, h + 2, d - 4])}L${pt([-w + 3, h + 2, d - 4])}Z`} fill="#7b8378" />
      <Wear wear={wear} spots={[[-10, -6, 4], [10, -10, 4]]} />
      {/* louvres + door + hazard stripe */}
      <path d="M4 -12h11M4 -9.5h11M4 -7h11M4 -4.5h11" stroke={running ? '#ffcf5a' : '#6d7470'} stroke-width="1.4" />
      {running ? (
        <>
          <path d="M-14 0v-12h9v12z" fill="#ffd966" />
          <path d="M-14 0v-12l-5 2v11z" fill="#5d8a72" />
          <path d="M-12 0v-4h5v4z" fill="#8a6a3a" />
        </>
      ) : (
        <path d="M-14 0v-12h9v12z" fill="#5d8a72" />
      )}
      <path d="M-18 -1.5h36" stroke="#f2c230" stroke-width="3" stroke-dasharray="3 3" />
      {/* a lamp over the door that stays on at night while the generator stands by */}
      <path d="M-13.5 -15.5h8" stroke="#3e4448" stroke-width="1.6" />
      <circle cx={-9.5} cy={-13.4} r={1.9} fill={lamp ? '#ffe89a' : '#9aa0a4'} />
      {/* fuel tank */}
      <path d={tank.side + tank.front} fill="#e8e3d6" />
      <path d={tank.top} fill="#f7f4ec" />
      <path d={`M${pt([w + 6, 0, 4])}v-4M${pt([w + 18, 0, 4])}v-4`} stroke="#6d7470" stroke-width="1.6" />
      {/* exhaust stack */}
      <path d={`M${sx} ${sy}v-20`} stroke="#5a6064" stroke-width="3.6" stroke-linecap="round" />
      <path d={`M${sx - 2.6} ${sy - 20}h5.2`} stroke="#3e4448" stroke-width="2" />
      {/* the overhead line leaves from an insulator on the roof's west end */}
      <path d={`M${pt([-8, h + 2, 12])}v-6`} stroke="#5a6064" stroke-width="1.6" />
      <circle cx={P([-8, h + 2, 12])[0]} cy={P([-8, h + 2, 12])[1] - 6.6} r={1.4} fill="#dfe7ea" />
      {/* roof beacon: a domed lamp, green and glowing while it carries the island */}
      <path d={`M${lx} ${ly}v-3`} stroke="#5a6064" stroke-width="2" />
      <path d={`M${lx - 3.4} ${ly - 3}a3.4 3.6 0 0 1 6.8 0z`} fill={running ? '#6dff8e' : '#8f9a90'} />
      <path d={`M${lx - 4} ${ly - 3}h8`} stroke="#3e4448" stroke-width="1.4" />
      {running && <circle cx={lx} cy={ly - 5} r={8} fill="#6dff8e" opacity=".3" />}
      {running && (
        // exhaust leans west, away from the lower bridge; the first wisp is
        // static so the running engine always reads, the rest rise on a loop
        <g transform={`translate(${Math.round(sx)} ${Math.round(sy - 22)})`}>
          <circle cx={-1} cy={0} r={4.2} fill="#6a7074" opacity=".95" />
          <circle cx={-6} cy={-6} r={4.8} fill="#8f959a" opacity=".85" />
          <g class={motion ? 'puff-w' : undefined}>
            <circle cx={-5} cy={-6} r={4.8} fill="#6f7478" />
            <circle cx={-11} cy={-13} r={5.6} fill="#9aa0a4" />
            <circle cx={-17} cy={-20} r={5} fill="#c4c8cb" opacity=".85" />
          </g>
          <g class={motion ? 'puff-w puff-late' : undefined}>
            <circle cx={-9} cy={-10} r={4.6} fill="#80868a" opacity=".85" />
            <circle cx={-21} cy={-27} r={6} fill="#d6d9db" opacity=".7" />
          </g>
        </g>
      )}
    </g>
  );
}

// ------------------------------------------------------ substation (g1) ---
/** down: burnt transformer, black bushings, a red alarm light and smoke */
export function Substation({ wear, down, motion }: { wear: number; down?: boolean; motion?: boolean }) {
  const pad = box(-18, 18, 0, 2, -2, 22);
  const tr = box(-10, 4, 2, 16, 6, 16);
  const cab = box(7, 15, 2, 14, 3, 10);
  const fence = [
    [-18, -2], [18, -2], [18, 22], [-18, 22],
  ] as const;
  const fpost = fence.map(([x, z]) => post(x, z, 10)).join('');
  const frail = seg([-18, 10, -2], [18, 10, -2]) + seg([18, 10, -2], [18, 10, 22]) + seg([18, 10, 22], [-18, 10, 22]) + seg([-18, 10, 22], [-18, 10, -2]);
  const [bx, by] = P([-3, 16, 11]);
  return (
    <g>
      <path d={shadowOf(-18, 18, -2, 22, 16)} fill={K.shadow} />
      <path d={pad.top} fill={K.concrete} />
      <path d={pad.front + pad.side} fill={K.concreteDark} />
      {/* back fence first */}
      <path d={seg([18, 10, 22], [-18, 10, 22]) + seg([-18, 10, 22], [-18, 10, -2]) + seg([18, 10, -2], [18, 10, 22])} stroke="#9aa5ab" stroke-width="1" />
      <path d={tr.side} fill={weather(down ? '#56625c' : '#6f8a80', wear)} />
      <path d={tr.front} fill={weather(down ? '#6f7d76' : '#8fa99e', wear)} />
      <path d={tr.top} fill={weather(down ? '#8a948f' : '#b5c9c0', wear)} />
      <path d="M-8 -5v-8M-5 -5v-8M-2 -5v-8M1 -5v-8" stroke="#5f776d" stroke-width="1.3" />
      {down && <path d="M-9 -4q2 -7 6 -9q4 2 5 8q-5 3 -11 1z" fill="#2f3336" opacity=".85" />}
      <path d={`M${pt([-7, 16, 11])}v-5M${pt([-3, 16, 11])}v-5M${pt([1, 16, 11])}v-5`} stroke={down ? '#2f3336' : '#c9d3d6'} stroke-width="2.2" stroke-linecap="round" />
      <path d={cab.side} fill="#8a9298" />
      <path d={cab.front} fill="#b7c0c5" />
      <path d="M9.5 -9.5l2 -2.5h-1.8l1.8 -2.6" stroke={K.yellow} stroke-width="1.4" fill="none" />
      <path d={fpost + seg([-18, 10, -2], [18, 10, -2])} stroke="#9aa5ab" stroke-width="1.2" />
      <path d={frail} stroke="#c4ccd0" stroke-width=".6" opacity=".7" />
      {/* danger plate on the fence */}
      <path d="M-11 -9.5l3.4 -6l3.4 6z" fill={K.yellow} stroke="#3e4448" stroke-width=".8" stroke-linejoin="round" />
      {down && (
        <>
          <circle cx={11} cy={-17} r={2.6} fill="#ff3b30" stroke="#7a1a14" stroke-width=".8" />
          <circle cx={11} cy={-17} r={6.5} fill="#ff3b30" opacity=".3" />
          <g transform={`translate(${bx} ${by - 6})`}>
            <g class={motion ? 'puff' : undefined}>
              <circle r={4.4} fill="#4f5457" opacity=".85" />
              <circle cx={-3} cy={-8} r={5.6} fill="#6c7073" opacity=".7" />
              <circle cx={1} cy={-16} r={5} fill="#8e9295" opacity=".55" />
            </g>
          </g>
        </>
      )}
    </g>
  );
}

/** a timber power pole at a screen point; `lean` (deg) when it has been knocked over */
export const POLE_H = 34;
export function Pole({ x, y, lean = 0 }: { x: number; y: number; lean?: number }) {
  return (
    <g transform={`translate(${x} ${y})${lean ? ` rotate(${lean})` : ''}`}>
      <ellipse cx={4} cy={1} rx={5} ry={1.8} fill={K.shadow} />
      <path d={`M0 0V${-POLE_H}`} stroke="#7a5534" stroke-width="2.6" />
      {lean ? (
        <path d={`M-7 ${-POLE_H + 8}L2 ${-POLE_H + 4}M3 ${-POLE_H + 5}l6 5`} stroke="#7a5534" stroke-width="2" />
      ) : (
        <>
          <path d={`M-7 ${-POLE_H + 4}H7`} stroke="#7a5534" stroke-width="2" />
          <path d={`M-6 ${-POLE_H + 3}v-2M0 ${-POLE_H + 3}v-2M6 ${-POLE_H + 3}v-2`} stroke="#dfe7ea" stroke-width="1.8" stroke-linecap="round" />
        </>
      )}
    </g>
  );
}
