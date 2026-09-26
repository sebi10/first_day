// What the island gains between tiers (src/sim/growth.ts flourishes), plus
// the finished dock. Every piece has a reserved spot in geo.tsx SPOT.
import { DOCK, lin, P, SPOT, type Pt } from './geo';
import { Palm } from './flora';
import { Dinghy, Yacht } from './craft';
import { K, tones } from './paint';
import { box, hip, post } from './solid';

const pt = (x: number, y: number, z: number) => P([x, y, z]).map((n) => Math.round(n * 10) / 10).join(' ');

export function Dock() {
  const [ax, ay] = DOCK.root, [bx, by] = DOCK.tip;
  const n = 9;
  const posts = Array.from({ length: n }, (_, i) => {
    const t = (i + 0.5) / n;
    return [ax + (bx - ax) * t, ay + (by - ay) * t] as Pt;
  });
  return (
    <g>
      <path d={`M${ax + 4} ${ay + 8}L${bx + 8} ${by + 10}`} stroke="rgba(10,60,120,.25)" stroke-width="14" />
      {posts.map(([x, y], i) => (
        <path key={i} d={`M${x - 6} ${y + 6}v-8M${x + 7} ${y - 3}v-8`} stroke={K.woodDark} stroke-width="3" stroke-linecap="round" />
      ))}
      <path d={`M${ax} ${ay}L${bx} ${by}`} stroke={K.woodDark} stroke-width="14" stroke-linecap="square" />
      <path d={`M${ax} ${ay - 2}L${bx} ${by - 2}`} stroke={K.woodLight} stroke-width="12" stroke-dasharray="3.2 1.3" />
      <path d={`M${bx - 4} ${by - 16}l16 4l-6 14l-16 -4z`} fill={K.woodDark} />
      <path d={`M${bx - 4} ${by - 18}l16 4l-6 14l-16 -4z`} fill={K.woodLight} />
      {/* bollards + a coil of rope */}
      <path d={`M${bx + 8} ${by - 12}v-5M${bx - 3} ${by - 15}v-5`} stroke="#5a4636" stroke-width="3" stroke-linecap="round" />
      <circle cx={bx + 2} cy={by - 6} r={2.6} fill="none" stroke="#e8d8b0" stroke-width="1.4" />
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

export function Bench({ x, y, flip }: { x: number; y: number; flip?: boolean }) {
  return (
    <g transform={`translate(${x} ${y})${flip ? ' scale(-1 1)' : ''}`}>
      <ellipse cx={3} cy={1} rx={9} ry={2} fill={K.shadow} />
      <path d="M-7 0v-4M7 0v-4" stroke="#4a4f55" stroke-width="1.6" />
      <path d="M-8 -4h16v-2.4h-16z" fill={K.wood} />
      <path d="M-8 -7.5h16v-3h-16z" fill={K.woodLight} />
    </g>
  );
}

export function Lamp({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cx={3} cy={1} rx={4} ry={1.4} fill={K.shadow} />
      <path d="M0 0V-20" stroke="#3f4a52" stroke-width="1.8" />
      <path d="M-3 -20h6l-1 -5h-4z" fill="#ffe89a" stroke="#3f4a52" stroke-width="1" />
      <path d="M-3.5 -25h7" stroke="#3f4a52" stroke-width="1.6" />
    </g>
  );
}

/** a newly planted palm grove: tilled rows, saplings in a neat grid */
export function Grove({ motion }: { motion: boolean }) {
  return (
    <g>
      <path d="M182 306Q222 294 268 300Q276 336 262 372Q220 384 176 380Q166 342 182 306Z" fill="#9a7a4a" opacity=".35" transform="translate(0 3)" />
      <path d="M182 306Q222 294 268 300Q276 336 262 372Q220 384 176 380Q166 342 182 306Z" fill="#c29a62" />
      <path d="M182 314Q224 304 266 308M178 326Q222 316 268 320M177 338Q222 328 268 332M176 350Q222 340 267 344M176 362Q220 352 265 356M178 373Q220 364 262 367" stroke="#9e7440" stroke-width="2" fill="none" />
      <path d="M182 306Q222 294 268 300Q276 336 262 372Q220 384 176 380Q166 342 182 306Z" fill="none" stroke={K.grassDark} stroke-width="3" />
      {[...SPOT.grove]
        .sort((a, b) => a[1] - b[1])
        .map(([x, y], i) => (
          <Palm key={i} x={x} y={y} s={0.95} lean={i % 2 ? 1 : -1} young motion={motion} />
        ))}
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
function Lounger({ x, y, c }: { x: number; y: number; c: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d="M-9 0h14l4 -5h-4l-2 2h-12z" fill="#fff" />
      <path d="M-8 -1.5h12" stroke={c} stroke-width="2" />
    </g>
  );
}

export function BeachBar() {
  const [x, y] = SPOT.bar;
  const w = 16, d = 16, h = 13;
  const r = hip(-w, w, h, 0, d, 13, 6, 8);
  const counter = box(-w, w, 0, 7, -2, 6);
  const posts = [post(-w, 0, h), post(w, 0, h), post(-w, d, h), post(w, d, h)].join('');
  return (
    <g>
      <Umbrella x={x - 44} y={y + 16} c="#ff6fa8" />
      <Umbrella x={x + 48} y={y + 12} c="#3a8ee6" />
      <Lounger x={x - 58} y={y + 22} c="#ff6fa8" />
      <Lounger x={x + 36} y={y + 20} c="#3a8ee6" />
      <Lounger x={x + 58} y={y + 22} c={K.yellow} />
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

function Stall({ x, y, c, goods }: { x: number; y: number; c: string; goods: string }) {
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
      <path d={`M${pt(-8, 7, 4)}a2.2 1.4 0 1 0 .1 0M${pt(-2, 7, 5)}a2.2 1.4 0 1 0 .1 0M${pt(4, 7, 4)}a2.2 1.4 0 1 0 .1 0M${pt(9, 7, 5)}a2 1.3 0 1 0 .1 0`} fill={goods} />
      {canopy.map((s, i) => (
        <path key={i} d={s.d} fill={s.c} />
      ))}
      <path d={`M${pt(-13, 15, -4)}L${pt(13, 15, -4)}`} stroke={t.lo} stroke-width="1.4" />
    </g>
  );
}
export function Market() {
  const [[ax, ay], [bx, by], [cx, cy]] = SPOT.market;
  return (
    <g>
      <Stall x={ax} y={ay} c="#3a8ee6" goods={K.orange} />
      <Stall x={bx} y={by} c="#4caf50" goods={K.yellow} />
      <Stall x={cx} y={cy} c="#a77be0" goods="#ff6fa8" />
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

export function Observatory() {
  const [x, y] = SPOT.observatory;
  const b = box(-9, 9, 0, 8, 0, 12);
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d={b.side} fill="#c9ced1" />
      <path d={b.front} fill="#eef1f2" />
      <path d="M-10 -8A10 9 0 0 1 10 -8Z" fill="#fbfbf7" />
      <path d="M0 -17A10 9 0 0 1 10 -8H0Z" fill="#dfe3e6" />
      <path d="M-2 -8L-1 -16.6L2 -16.6L3 -8Z" fill="#33455a" />
      <path d="M-2 0v-5h4v5z" fill="#6f7a82" />
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

export function Statue() {
  const [x, y] = SPOT.statue;
  const b = box(-10, 10, 0, 7, 0, 10);
  const fig = (fx: number, h: number) => `M${fx - 2.6} -7v${-h}a2.6 2.6 0 0 1 5.2 0v${h}zM${fx} ${-9 - h - 3}a2.6 2.6 0 1 0 .1 0`;
  return (
    <g transform={`translate(${x} ${y}) scale(1.5)`}>
      <ellipse cx={5} cy={2} rx={14} ry={4} fill={K.shadow} />
      <path d={b.side} fill="#a39a8c" />
      <path d={b.front} fill="#cfc6b8" />
      <path d={b.top} fill="#e6dfd2" />
      <path d={fig(-5, 9) + fig(0, 11) + fig(5, 9)} fill="#b88a4a" transform="translate(0 -1)" />
      <path d="M-5 -19l-4 -6M5 -19l4 -6M0 -23v-5" stroke="#b88a4a" stroke-width="2" stroke-linecap="round" />
      <path d="M-6 -12l2 -4M-1 -14l2 -4" stroke="#e0b872" stroke-width="1" />
    </g>
  );
}

/** strings of little flags across the square (with bulbs that glow at night) */
export const BUNTING: [Pt, Pt][] = [
  [[300, 284], [420, 284]],
  [[304, 310], [424, 318]],
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

/** confetti over the square after an A week */
export function Confetti({ motion }: { motion: boolean }) {
  const cols = ['#ff6fa8', '#ffd23f', '#3a8ee6', '#4caf50', '#a77be0', '#ff8c42'];
  const pts = Array.from({ length: 36 }, (_, i) => [290 + ((i * 53) % 150), 250 + ((i * 37) % 130), ((i * 47) % 7) - 3] as const);
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

