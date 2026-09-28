// Where everything on the home island is drawn, as a pure function of the
// state: the planes' stands (or their AOG spots), the ground power carts, the
// builders' spots and the staff figures. The island art (island.tsx) draws
// from it and the hit-test (hotspots.ts) reads the same spots, so a tap lands
// on what is on screen (docs/EXPANSION.md 6.1: footprints are the true drawn
// extents). No JSX here.
import { TIERS } from '../../sim/data';
import { gseCarts, houseRentable, isAog } from '../../sim/econ';
import { openBuild, pilotSeats, working } from '../../sim/staff';
import type { Asset, GseCart, IslandState, Npc } from '../../sim/types';
import { AOG_SPOT, PLOT, POS, siteKindOf, workSites, type Box, type Pt } from '../island/geo';
import { CART_HOME, CART_OUTLET, cartBeside, receptacle } from '../island/gse';
import { crewSpots, DOCK_CREW } from '../island/sites';

export type Phase = 'dawn' | 'day' | 'golden' | 'night';

// house geometry, for bubbles, wires and the housekeepers (k = the scale it is drawn at)
export const HOUSE = {
  cottage: { top: 42, w: 20, h: 18, d: 26, k: 1 },
  villa: { top: 54, w: 30, h: 32, d: 32, k: 0.92 },
  lodge: { top: 66, w: 30, h: 20, d: 40, k: 1 },
} as const;
export type HouseModel = keyof typeof HOUSE;
export const modelOf = (a: Pick<Asset, 'model'>): HouseModel => ((a.model as HouseModel) in HOUSE ? (a.model as HouseModel) : 'cottage');
export const houseGeo = (a: Pick<Asset, 'model'>) => HOUSE[modelOf(a)];

/** Screen footprints around a front-centre ground point: what other assets' bubbles keep off, and what a tap hits. */
export const FOOT = {
  hangar: [-52, -66, 68, 2],
  office: [-34, -58, 44, 4],
  plane: [-38, -22, 38, 22],
  float: [-30, -16, 30, 16],
  cottage: [-22, -42, 30, 2],
  villa: [-30, -50, 36, 4],
  lodge: [-62, -66, 44, 8],
  g1: [-18, -26, 26, 2],
  gen: [-18, -30, 40, 2],
  fountain: [-20, -24, 20, 6],
  stall: [-14, -26, 16, 4],
  statue: [-22, -48, 22, 6],
  /** a ground power cart's body, its reel and its charge light */
  cart: [-13, -14, 10, 3],
  /** a staff figure (NpcFigure: about 8 wide and 14 tall over its ground point) */
  figure: [-5, -15, 6, 2],
} satisfies Record<string, Box>;
export const footAt = (p: Pt, f: Box): Box => [p[0] + f[0], p[1] + f[1], p[0] + f[2], p[1] + f[3]];

export const at = (id: string): Pt | undefined => POS[id] ?? PLOT[id];

/** a plane is drawn down (on jacks, at its AOG spot) when worn out or waiting on a part */
export const isDown = (s: IslandState, p: Asset) => p.health < 40 || isAog(s, p.id);

/** Keep plane footprints apart (wingspan ~76, depth ~50): a safety net over the fixed spots. */
function unclutter(ps: { id: string; x: number; y: number }[]) {
  for (let pass = 0; pass < 4; pass++)
    for (let i = 0; i < ps.length; i++)
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i], b = ps[j];
        const ox = 80 - Math.abs(a.x - b.x), oy = 52 - Math.abs(a.y - b.y);
        if (ox <= 0 || oy <= 0) continue;
        const d = (a.x <= b.x ? -1 : 1) * (ox / 2);
        a.x += d;
        b.x -= d;
      }
  return ps;
}

export type PlanePlace = { a: Asset; x: number; y: number; down: boolean; water: boolean };
export type CartPlace = { c: GseCart; at: Pt; plug: Pt | null; plane?: Asset };
export type FigurePlace = { kind: 'builder' | 'keeper' | 'pilot'; at: Pt; flip?: boolean; npc: Npc; of?: string };

/** every plane at its stand, or at its AOG spot when down (each plane has its own) */
export function planePlaces(s: IslandState): PlanePlace[] {
  const planes = s.assets.filter((a) => a.kind === 'plane');
  const spot = (p: Asset) => (isDown(s, p) ? (AOG_SPOT[p.id] ?? POS[p.id]) : (POS[p.id] ?? POS.p1));
  const spots = unclutter(planes.map((p) => ({ id: p.id, x: spot(p)[0], y: spot(p)[1] })));
  return planes.map((a, i) => ({ a, x: spots[i].x, y: spots[i].y, down: isDown(s, a), water: a.model === 'float' }));
}

/** the ground power carts: on the charger by the hangar, or beside the plane they're hooked up to */
export function cartPlaces(s: IslandState, planes: PlanePlace[]): CartPlace[] {
  return gseCarts(s).map((c, i) => {
    const pl = c.hookedTo ? planes.find((p) => p.a.id === c.hookedTo) : undefined;
    const at: Pt = pl ? cartBeside(pl.a.model, [pl.x, pl.y]) : CART_HOME[i % CART_HOME.length];
    const plug: Pt | null = pl ? receptacle(pl.a.model, [pl.x, pl.y]) : c.charging ? CART_OUTLET[i % CART_OUTLET.length] : null;
    return { c, at, plug, ...(pl ? { plane: pl.a } : {}) };
  });
}

/** a cart's tap target: a square around its middle (gse.tsx draws it at (2, -4) from the cart's ground point) */
export const cartHitCentre = (p: Pt): Pt => [p[0] + 2, p[1] - 4];

/**
 * Where the builders stand: the sites of the open build's unit they work, one each (up to 3), as island.tsx has
 * always placed them (docs/JOBFLOW.md 15.5). Empty with no build open or no builder at work.
 */
export function builderSpots(s: IslandState): Pt[] {
  const building = openBuild(s);
  const builders = working(s).filter((n) => n.role === 'builder');
  if (!building || !builders.length) return [];
  const worked = new Set(workSites(s).map((w) => w.id));
  const crewAt: Pt[] = [];
  for (const t of TIERS.filter((t) => t.n > s.tier)) {
    const b = (s.builds ?? []).find((x) => x.tier === t.n);
    if (b !== building) continue;
    const spots: Pt[][] = [];
    for (const a of t.adds) {
      if (a.id === 'p3') {
        if (worked.has(a.id)) spots.push(DOCK_CREW);
        continue;
      }
      const kind = siteKindOf(a.model);
      if (!kind || !POS[a.id] || !worked.has(a.id)) continue;
      spots.push(crewSpots(kind, POS[a.id][0], POS[a.id][1]));
    }
    for (let i = 0; i < 3; i++) if (spots.length) crewAt.push(spots[i % spots.length][Math.floor(i / spots.length)] ?? spots[0][0]);
  }
  if (building.cottage && !s.assets.some((a) => a.id === building.cottage)) {
    const plot = PLOT[building.cottage];
    if (plot) crewAt.push(...crewSpots('house', plot[0], plot[1]));
  }
  return crewAt;
}

/**
 * The staff at work (docs/JOBFLOW.md 15.10): builders on the site they work, a pilot by the lead guest plane and one
 * by the cargo plane, a housekeeper at a booked house; up to 8, none in a storm or at night.
 */
export function figurePlaces(s: IslandState, phase: Phase, planes: PlanePlace[]): FigurePlace[] {
  if (s.weather === 'storm' || phase === 'night') return [];
  const out: FigurePlace[] = [];
  const crewAt = builderSpots(s);
  working(s)
    .filter((n) => n.role === 'builder')
    .slice(0, 3)
    .forEach((npc, i) => {
      const p = crewAt[i];
      if (p) out.push({ kind: 'builder', at: p, flip: i % 2 === 1, npc });
    });
  const seats = pilotSeats(s);
  const flying = (p: PlanePlace, cargo: boolean) => (p.a.model === 'cargo') === cargo && !p.down && !s.tags?.[p.a.id] && (seats.get(p.a.id) ?? []).length > 0;
  for (const p of [planes.find((q) => flying(q, false)), planes.find((q) => flying(q, true))]) {
    if (!p || p.water) continue;
    const npc = seats.get(p.a.id)![0].npc;
    out.push({ kind: 'pilot', at: [p.x - 24, p.y + 14], npc, of: p.a.id });
  }
  const keepers = working(s).filter((n) => n.role === 'housekeeper');
  s.assets
    .filter((a) => a.kind === 'house' && houseRentable(s, a))
    .sort((a, b) => b.health - a.health)
    .slice(0, Math.min(2, keepers.length))
    .forEach((h, i) => {
      const [x, y] = at(h.id) ?? [0, 0];
      const g = houseGeo(h);
      out.push({ kind: 'keeper', at: [x + g.w * g.k + 6, y + 6], flip: i % 2 === 1, npc: keepers[i], of: h.id });
    });
  return out;
}
