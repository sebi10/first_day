// Palette and colour helpers. Flat cel shading: every object gets a light top,
// a mid front and a dark side, all derived from one base colour.

export const K = {
  seaEdge: '#1560b4',
  seaMid: '#1f7fd4',
  seaCenter: '#2b95e4',
  ripple: '#6cc0ff',
  rippleDark: '#1257a6',
  halo: '#2ca3e8',
  shallow1: '#35bfe6',
  shallow2: '#4fd8e4',
  shallow3: '#95f0e0',
  foam: '#ffffff',
  sand: '#f8e2a6',
  sandLight: '#fcefc6',
  sandWet: '#e4bf78',
  sandShadow: '#d7aa62',
  grass: '#6cc04a',
  grassLight: '#88d25a',
  grassLighter: '#a3e06c',
  grassDark: '#52a63d',
  grassDarker: '#3f8b35',
  earth: '#b07443',
  earthDark: '#86532d',
  rockTop: '#bda994',
  rockLight: '#a08b78',
  rockMid: '#836f60',
  rockDark: '#5f4f45',
  rockHi: '#dccdb9',
  river: '#3cb8f4',
  riverLight: '#a8eaff',
  dirt: '#d6a263',
  dirtLight: '#e8bf84',
  dirtEdge: '#b38048',
  stone: '#d3c8b6',
  stoneDark: '#a99b86',
  stoneLight: '#ebe3d4',
  wood: '#b8783e',
  woodDark: '#86552b',
  woodLight: '#d89c5c',
  trunk: '#a8733f',
  trunkDark: '#7f5330',
  leaf: '#43b04c',
  leafDark: '#2d8a3e',
  leafLight: '#86d65c',
  tree: '#3f9e45',
  treeLight: '#62c052',
  treeDark: '#2b7a37',
  asphalt: '#5a6168',
  asphaltDark: '#474d54',
  concrete: '#b4b8b9',
  concreteDark: '#8d9396',
  wall: '#fbf1dc',
  wallShade: '#e6d4b4',
  wallDark: '#c9b391',
  glass: '#bfe6f5',
  glassDark: '#5d7f93',
  lit: '#ffd966',
  ink: '#1F2A30',
  rust: '#C7502F',
  rustDark: '#8f3419',
  white: '#ffffff',
  shadow: 'rgba(24,70,40,.28)',
  shadowSand: 'rgba(150,100,40,.28)',
  pink: '#ff6fa8',
  yellow: '#ffd23f',
  orange: '#ff8c42',
  red: '#e8453c',
  blue: '#3a8ee6',
  purple: '#a77be0',
} as const;

const hex = (h: string) => {
  const s = h.replace('#', '');
  const n = parseInt(s.length === 3 ? s.replace(/(.)/g, '$1$1') : s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (c: number[]) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');

/** blend a toward b by t (0..1) */
export function mix(a: string, b: string, t: number) {
  const x = hex(a), y = hex(b);
  return toHex(x.map((v, i) => v + (y[i] - v) * t));
}
export const shade = (c: string, t: number) => mix(c, t > 0 ? '#fff8e8' : '#2a1e2e', Math.abs(t));

/** light / mid / dark tones for a base colour */
export const tones = (c: string) => ({ hi: shade(c, 0.28), mid: c, lo: shade(c, -0.28), dk: shade(c, -0.45) });

/** paint that has seen some weather: faded toward a dusty grey */
export function weather(c: string, wear: number) {
  return wear <= 0 ? c : mix(c, '#b3a797', Math.min(0.6, wear * 0.8));
}
