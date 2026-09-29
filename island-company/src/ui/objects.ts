// Object references: the only contract the map (B) and the inspect sheets (C)
// share (docs/EXPANSION.md 2.5). The map emits a ref when something on it is
// tapped; the sheets take one and show what the seat sees and can do there.
import type { Asset, OpsRole } from '../sim/types';

/**
 * A station: 'home' is the island (stage 2 has only home). Stage 3 moves this type to src/sim/stations.ts and this
 * re-export stays, so B and C can keep importing it from here.
 */
export type StationId = string;
export const HOME: StationId = 'home';

export type ObjectKind =
  | 'plane' | 'house' | 'grid' | 'generator' // assets (id = asset id)
  | 'hangar' | 'office' | 'runway' | 'fuel' | 'estop' | 'dock' | 'windsock' | 'terminal' // fixtures (id = kind)
  | 'cart' // id = cart id (the GSE sheet, unchanged)
  | 'staff' // id = npc id
  | 'site' // id = build id, or 'project' (gap-zoom's builders' hit-test folds in here)
  | 'station' | 'route'; // region map (id = station / route id; stage 3)

export type ObjectRef = { kind: ObjectKind; id: string; st: StationId };

export const OBJECT_LABEL: Record<ObjectKind, string> = {
  plane: 'Plane',
  house: 'House',
  grid: 'Grid',
  generator: 'Generator',
  hangar: 'Hangar',
  office: 'Office',
  runway: 'Runway',
  fuel: 'Fuel',
  estop: 'Emergency stop',
  dock: 'Dock',
  windsock: 'Windsock',
  terminal: 'Terminal',
  cart: 'Ground power cart',
  staff: 'Staff',
  site: 'Build site',
  station: 'Station',
  route: 'Route',
};

/** the asset kinds (their ref's id is the asset's id) */
export const ASSET_KINDS: readonly ObjectKind[] = ['plane', 'house', 'grid', 'generator'];
/** the fixtures (their ref's id is their kind) */
export const FIXTURE_KINDS: readonly ObjectKind[] = ['hangar', 'office', 'runway', 'fuel', 'estop', 'dock', 'windsock', 'terminal'];

/**
 * The seat whose work an asset is: planes the mechanic's; houses, grids and panels the electrician's; the generator
 * both techs' (the engine and its mounts are the mechanic's, the transfer switch the electrician's).
 */
export function ownerOf(a: Pick<Asset, 'kind'>): OpsRole | 'both' {
  return a.kind === 'plane' ? 'mech' : a.kind === 'generator' ? 'both' : 'elec';
}

/** an asset's ref (stage 2: every asset is at home) */
export const assetRef = (a: Pick<Asset, 'kind' | 'id'>): ObjectRef => ({ kind: a.kind, id: a.id, st: HOME });

/** a fixture's ref */
export const fixtureRef = (kind: ObjectKind, st: StationId = HOME): ObjectRef => ({ kind, id: kind, st });

export const isAssetRef = (r: ObjectRef) => ASSET_KINDS.includes(r.kind);
