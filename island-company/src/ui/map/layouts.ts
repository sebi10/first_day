// Scene layouts (docs/EXPANSION.md 2.2): geometry is UI data, so the sim has
// none. Stage 2 has one scene, home, whose layout is read off geo.tsx's
// constants (home keeps its bespoke drawing, island.tsx). Stage 3 (B2) adds
// Tern Cay and Port Adair, each drawn from its layout with the closed set of
// art kinds below, and the region map.
import type { Role } from '../../sim/types';
import { APRON, DOCK, HANGAR, OFFICE, POS, RUNWAY, WINDSOCK, type Box, type Pt } from '../island/geo';
import { CART_HOME, CART_OUTLET } from '../island/gse';
import { APRON_PROPS } from '../island/extras';
import type { StationId } from '../objects';
import { FOOT } from './place';

/** the closed set of art kinds B builds once; a new airport's layout picks from these (stage 3) */
export type PropKind = 'palms' | 'rocks' | 'drums' | 'bowser' | 'sock' | 'dispenser' | 'estop' | 'shed' | 'gate' | 'counter' | 'handhole' | 'floodlight';
export type FixtureKind = 'hangar' | 'terminal' | 'fuel' | 'estop' | 'windsock' | 'dock' | 'office';

export interface SceneLayout {
  id: StationId;
  /** the viewBox (home: 800 x 600) */
  w: number;
  h: number;
  /** feet per map unit (the E-stop post is placed to scale) */
  ftPerUnit: number;
  /** a station's own terrain: the coast (clockwise), beach widths, a hill; home keeps its bespoke Terrain */
  coast?: Pt[];
  beach?: number[];
  hill?: Pt[];
  runway: { a: Pt; b: Pt; w: number; lit: boolean };
  apron: Pt[];
  /** front-centre ground points; a fixture kind absent here isn't drawn or tappable */
  fixtures: Partial<Record<FixtureKind, Pt>>;
  /** each fixture's tap footprint around its point (the drawn extent) */
  fixtureFoot: Partial<Record<FixtureKind, Box>>;
  /** each station asset's front-centre ground point, by asset id */
  pos: Record<string, Pt>;
  /** plane stands in order; `water` stands take floats */
  stands: { at: Pt; water?: boolean }[];
  /** where a plane stuck here stands (by stand index) */
  aog?: Pt[];
  /** cart parking and the charger outlets */
  carts: { home: Pt[]; outlet: Pt[] };
  /** feeds: an overhead pole line, or an underground run with hand holes, from the panel to asset ids */
  feeds?: { kind: 'pole' | 'underground'; path: Pt[]; to: string[] }[];
  /** "my zone" per seat at this station (home: geo.tsx focusBox, which grows with the tier) */
  focus: Partial<Record<Role, Box>>;
  /** on the region map (1000 x 700): the pin, and the island's outline there */
  region: { at: Pt; shape: Pt[] };
  props?: { kind: PropKind; at: Pt[] }[];
}

const [bx0, by0, bx1, by1] = APRON_PROPS[0];
/** the fuel bowser's ground point (extras.tsx draws it at 236, 372) */
const BOWSER: Pt = [236, 372];

export const LAYOUTS: Record<string, SceneLayout> = {
  home: {
    id: 'home',
    w: 800,
    h: 600,
    ftPerUnit: 10,
    runway: { a: RUNWAY.a, b: RUNWAY.b, w: RUNWAY.w, lit: true },
    apron: APRON,
    fixtures: { hangar: HANGAR, office: OFFICE, fuel: BOWSER, windsock: WINDSOCK, dock: DOCK.root },
    fixtureFoot: {
      hangar: FOOT.hangar,
      office: FOOT.office,
      // the bowser (extras.tsx APRON_PROPS[0])
      fuel: [bx0 - BOWSER[0], by0 - BOWSER[1], bx1 - BOWSER[0], by1 - BOWSER[1]],
      // the mast and the sock (terrain.tsx), about 16 around its middle
      windsock: [-9, -30, 23, 2],
      // the stem from the beach and the T-head across the water, the barrels at the root
      dock: [DOCK.head[0] - DOCK.root[0], DOCK.head[1] - DOCK.root[1], DOCK.head[2] - DOCK.root[0], 4],
    },
    pos: POS,
    stands: [{ at: POS.p1 }, { at: POS.p2 }, { at: POS.p3, water: true }],
    carts: { home: CART_HOME, outlet: CART_OUTLET },
    focus: {},
    region: { at: [520, 330], shape: [] },
  },
};

/** the region map's size (stage 3) */
export const REGION = { w: 1000, h: 700 };
