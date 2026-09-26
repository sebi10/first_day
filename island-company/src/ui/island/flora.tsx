// Vegetation: chunky cartoon palms (drawn per instance so they can sway and
// vary), and small repeated scatter (trees, bushes, flowers, tufts, beach
// bits) as <symbol>s so hundreds of them cost one node each.
import { K } from './paint';

const r1 = (n: number) => Math.round(n * 10) / 10;

/** a broad drooping leaf from the crown at angle a (deg), length L */
function leaf(a: number, L: number, droop: number, ox = 0, oy = 0) {
  const c = Math.cos((a * Math.PI) / 180), s = Math.sin((a * Math.PI) / 180);
  // local leaf: along +x, bulging up then drooping at the tip
  const pts: [number, number][] = [
    [0, 0],
    [L * 0.45, -L * 0.3],
    [L, L * droop],
    [L * 0.5, L * 0.06],
  ];
  const tr = ([x, y]: [number, number]) => `${r1(ox + x * c - y * s)} ${r1(oy + x * s + y * c + Math.abs(x * c) * 0.1)}`;
  return `M${tr(pts[0])}Q${tr(pts[1])} ${tr(pts[2])}Q${tr(pts[3])} ${tr(pts[0])}Z`;
}

const PALM_CACHE = new Map<string, { back: string; front: string; hi: string }>();
function crown(size: number, flip: boolean) {
  const key = `${size}${flip}`;
  let c = PALM_CACHE.get(key);
  if (!c) {
    const back = [200, 250, 300, 345].map((a) => leaf(flip ? 180 - a : a, 17 * size, 0.28)).join('');
    const front = [160, 115, 25, 65].map((a) => leaf(flip ? 180 - a : a, 18 * size, 0.34)).join('');
    const hi = [115, 25].map((a) => leaf(flip ? 180 - a : a, 11 * size, 0.2)).join('');
    c = { back, front, hi };
    PALM_CACHE.set(key, c);
  }
  return c;
}

/** Palm with a curved trunk; (x, y) is where the trunk meets the ground. */
/** `night`: the trunk rings and the coconuts, which the night grade hides, are left out */
export function Palm({ x, y, s = 1, lean = 1, motion, young, pal, wind, storm, night }: { x: number; y: number; s?: number; lean?: number; motion: boolean; young?: boolean; pal?: { leaf: string; dark: string }; wind?: boolean; storm?: boolean; night?: boolean }) {
  const h = (young ? 20 : 40) * s;
  const lx = 9 * lean * s;
  const w = (young ? 2.2 : 3.6) * s;
  const cr = crown(young ? 0.62 * s : s, lean < 0);
  const trunk = `M${r1(-w)} 0Q${r1(lx * 0.1 - w)} ${r1(-h * 0.6)} ${r1(lx - w * 0.5)} ${r1(-h)}L${r1(lx + w * 0.5)} ${r1(-h)}Q${r1(lx * 0.1 + w * 1.1)} ${r1(-h * 0.55)} ${r1(w)} 0Z`;
  const mid = `M0 -2Q${r1(lx * 0.1)} ${r1(-h * 0.6)} ${r1(lx)} ${r1(-h + 2)}`;
  return (
    <g transform={`translate(${r1(x)} ${r1(y)})${wind ? ` skewX(${storm ? -16 : -8})` : ''}`}>
      <ellipse cx={r1(lx + 12 * s)} cy={1.5} rx={r1(18 * s)} ry={r1(5 * s)} fill={K.shadow} />
      <path d={trunk} fill={K.trunk} />
      {!night && <path d={mid} stroke={K.trunkDark} stroke-width={r1(w * 1.3)} stroke-dasharray="2 3.2" fill="none" opacity=".55" />}
      <g transform={`translate(${r1(lx)} ${r1(-h)})${wind ? (storm ? ' rotate(22) skewX(-12)' : ' rotate(14) skewX(-8)') : ''}`}>
        <g class={motion ? 'sway' : undefined} style={motion ? { animationDelay: `${r1(-((x * 7 + y) % 50) / 10)}s` } : undefined}>
          <path d={cr.back} fill={pal?.dark ?? K.leafDark} />
          <path d={cr.front} fill={pal?.leaf ?? K.leaf} />
          <path d={cr.hi} fill={K.leafLight} opacity=".8" />
          {!young && !night && <path d="M-3 1a2.6 2.6 0 1 0 .1 0M2 2a2.6 2.6 0 1 0 .1 0" fill="#7a4d25" />}
        </g>
      </g>
    </g>
  );
}

/** A young palm (the palm-grove flourish), drawn once as a symbol: its trunk
 *  base is (0, 0), crown leaning east (flip it for west). Each sapling is one
 *  <use>, so it can be y-sorted with the trees around it; its ground shadow
 *  is part of the grove's clearing. */
const SAPLING = (() => {
  const lx = 5, h = 19, cx = lx, cy = -h;
  return {
    trunk: `M-2 0Q${r1(lx * 0.1 - 2)} ${r1(-h * 0.6)} ${r1(cx - 1)} ${cy}L${r1(cx + 1.2)} ${cy}Q${r1(lx * 0.1 + 2.4)} ${r1(-h * 0.55)} 2 0Z`,
    back: [200, 250, 300, 345].map((a) => leaf(a, 10.5, 0.28, cx, cy)).join(''),
    front: [160, 115, 25, 65].map((a) => leaf(a, 11, 0.34, cx, cy)).join(''),
  };
})();

/** Symbols shared by all scatter. Coordinates: (0,0) is the ground point. */
export function FloraDefs() {
  return (
    <>
      <symbol id="i-tree" overflow="visible">
        <ellipse cx="11" cy="1" rx="15" ry="5" fill={K.shadow} />
        <rect x="-2.2" y="-12" width="4.4" height="13" rx="2" fill={K.trunkDark} />
        <path d="M-13 -16a9 9 0 1 0 .1 0M-3 -26a11 11 0 1 0 .1 0M8 -14a8 8 0 1 0 .1 0" fill={K.treeDark} />
        <path d="M-12 -18a8 8 0 1 0 .1 0M-2 -28a9.5 9.5 0 1 0 .1 0M6 -17a7 7 0 1 0 .1 0" fill={K.tree} />
        <path d="M-9 -22a4.5 4.5 0 1 0 .1 0M0 -33a5 5 0 1 0 .1 0" fill={K.treeLight} />
      </symbol>
      <symbol id="i-pine" overflow="visible">
        <ellipse cx="9" cy="1" rx="12" ry="4" fill={K.shadow} />
        <rect x="-1.8" y="-6" width="3.6" height="7" fill={K.trunkDark} />
        <path d="M0 -38L12 -16L6 -17L14 -4L-14 -4L-6 -17L-12 -16Z" fill={K.treeDark} />
        <path d="M0 -38L-12 -16L-6 -17L-14 -4L0 -4Z" fill={K.tree} />
      </symbol>
      <symbol id="i-bush" overflow="visible">
        <ellipse cx="6" cy="1" rx="11" ry="3.5" fill={K.shadow} />
        <path d="M-8 -4a6 6 0 1 0 .1 0M0 -8a7 7 0 1 0 .1 0M7 -4a5.5 5.5 0 1 0 .1 0" fill={K.treeDark} />
        <path d="M-7 -6a4.5 4.5 0 1 0 .1 0M-1 -10a5 5 0 1 0 .1 0" fill={K.tree} />
        <path d="M-2 -12a2.2 2.2 0 1 0 .1 0" fill={K.treeLight} />
      </symbol>
      <symbol id="i-sapling" overflow="visible">
        <path d={SAPLING.trunk} fill={K.trunk} />
        <path d={SAPLING.back} fill={K.leafDark} />
        <path d={SAPLING.front} fill={K.leaf} />
      </symbol>
      {/* a square lamp post and a park bench (the benches flourish), one <use> each */}
      <symbol id="i-lamp" overflow="visible">
        <ellipse cx="3" cy="1" rx="4" ry="1.4" fill={K.shadow} />
        <path d="M-3 -20h6l-1 -5h-4z" fill="#ffe89a" stroke="#3f4a52" stroke-width="1" />
        <path d="M0 0V-20M-3.5 -25h7" stroke="#3f4a52" stroke-width="1.7" />
      </symbol>
      <symbol id="i-bench" overflow="visible">
        <ellipse cx="3" cy="1" rx="9" ry="2" fill={K.shadow} />
        <path d="M-7 0v-4M7 0v-4" stroke="#4a4f55" stroke-width="1.6" />
        <path d="M-8 -4h16v-2.4h-16z" fill={K.wood} />
        <path d="M-8 -7.5h16v-3h-16z" fill={K.woodLight} />
      </symbol>
      <symbol id="i-mush" overflow="visible">
        <rect x="-1.4" y="-4" width="2.8" height="4" rx="1" fill="#fff3e0" />
        <path d="M-5 -3.5q5 -8 10 0z" fill="#e8453c" />
        <path d="M-2 -5.5a.9 .9 0 1 0 .1 0M2 -5a.8 .8 0 1 0 .1 0" fill="#fff" />
      </symbol>
      <symbol id="i-reed" overflow="visible">
        <path d="M-3 0q-1 -7 -3 -10M0 0q0 -8 0 -12M3 0q1 -6 3 -9" stroke={K.leafDark} stroke-width="1.4" fill="none" stroke-linecap="round" />
        <path d="M-6 -10l0 -3M0 -12l0 -3" stroke="#8a5a30" stroke-width="2.4" stroke-linecap="round" />
      </symbol>
    </>
  );
}

export const Use = ({ id, x, y, s = 1, color, flip }: { id: string; x: number; y: number; s?: number; color?: string; flip?: boolean }) => (
  <use href={`#${id}`} transform={`translate(${r1(x)} ${r1(y)})${s !== 1 || flip ? ` scale(${flip ? -r1(s * 100) / 100 : r1(s * 100) / 100} ${r1(s * 100) / 100})` : ''}`} style={color ? { color } : undefined} />
);
