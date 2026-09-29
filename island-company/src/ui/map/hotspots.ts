// The hotspot registry and hit-test (docs/EXPANSION.md 6.1): every object on
// the map with its true drawn footprint, so a tap opens what is under the
// finger. It's JS over the same spots the art uses (place.ts), so the map adds
// no SVG nodes for it. The map (MapView) emits a hotspot's ref; the inspect
// sheets (package C) consume it.
import { TIERS } from '../../sim/data';
import { openBuild } from '../../sim/staff';
import type { IslandState } from '../../sim/types';
import { DOCK, H, POS, SITE_EXTENT, W, siteKindOf, workSites, type Box, type Pt } from '../island/geo';
import { assetRef, fixtureRef, HOME, type ObjectRef, type StationId } from '../objects';
import { LAYOUTS, type FixtureKind, type SceneLayout } from './layouts';
import { at, cartHitCentre, cartPlaces, figurePlaces, FOOT, footAt, modelOf, planePlaces, type Phase } from './place';

export type Hotspot = {
  ref: ObjectRef;
  label: string;
  /** the drawn extent [x0, y0, x1, y1] in map units: never grown to 44 px */
  foot: Box;
  /** priority among overlapping footprints */
  z: number;
  /** a target of its own around `c`, at least `px` CSS px and `units` map units square (a cart's SVG button: the same size) */
  min?: { px: number; units?: number; c: Pt };
};

/** priority `z` (6.1): it only breaks ties between overlapping true footprints */
export const Z = { bubble: 70, cart: 60, staff: 50, prop: 40, plane: 30, building: 20, runway: 10 } as const;
/** a tap this close (CSS px) to an object's middle counts as on it; two within reach zoom instead of guessing */
export const REACH_PX = 22;

const clip = (b: Box): Box => [Math.max(0, b[0]), Math.max(0, b[1]), Math.min(W, b[2]), Math.min(H, b[3])];
export const refKey = (r: ObjectRef) => `${r.st}:${r.kind}:${r.id}`;

const FIXTURE_LABEL: Record<FixtureKind, string> = {
  hangar: 'Hangar',
  office: 'Office',
  fuel: 'Fuel bowser',
  windsock: 'Windsock',
  dock: 'Seaplane dock',
  terminal: 'Terminal',
  estop: 'Emergency stop',
};

/**
 * Every object on a scene (stage 2: home), with its footprint as drawn for this state. `phase` is the light the
 * island is drawn in (the staff are off at night). The region map (stage 3) has none yet.
 */
export function hotspots(s: IslandState, scene: StationId | 'region' = HOME, layout: SceneLayout = LAYOUTS.home, o: { phase?: Phase } = {}): Hotspot[] {
  if (scene !== HOME) return [];
  const phase = o.phase ?? 'day';
  const out: Hotspot[] = [];
  const add = (ref: ObjectRef, label: string, foot: Box, z: number, min?: Hotspot['min']) => out.push({ ref, label, foot: clip(foot), z, ...(min ? { min } : {}) });

  // ---- assets: the planes at their stands (or AOG spots), the houses, the grid and the generator
  const planes = planePlaces(s);
  for (const p of planes) add(assetRef(p.a), p.a.name, footAt([p.x, p.y], p.water ? FOOT.float : FOOT.plane), Z.plane);
  for (const h of s.assets.filter((a) => a.kind === 'house')) {
    const p = at(h.id);
    if (p) add(assetRef(h), h.name, footAt(p, FOOT[modelOf(h)]), Z.building);
  }
  const grid = s.assets.find((a) => a.kind === 'grid');
  if (grid) add(assetRef(grid), grid.name, footAt(POS.g1, FOOT.g1), Z.building);
  const gen = s.assets.find((a) => a.kind === 'generator');
  if (gen) add(assetRef(gen), gen.name, footAt(POS.gen, FOOT.gen), Z.building);

  // ---- fixtures (id = kind): the dock only once it's built (tier 4); before that it is a build site
  const { a, b, w } = layout.runway;
  add(fixtureRef('runway'), 'Runway', [Math.min(a[0], b[0]), Math.min(a[1], b[1]) - w / 2, Math.max(a[0], b[0]), Math.max(a[1], b[1]) + w / 2], Z.runway);
  for (const [kind, p] of Object.entries(layout.fixtures) as [FixtureKind, Pt][]) {
    if (kind === 'dock' && s.tier < 4) continue;
    const f = layout.fixtureFoot[kind];
    if (f) add(fixtureRef(kind), FIXTURE_LABEL[kind], footAt(p, f), kind === 'hangar' || kind === 'office' || kind === 'terminal' ? Z.building : Z.prop);
  }

  // ---- the ground power carts: their own 44 px targets (they keep their SVG buttons; listed here for the keyboard)
  for (const c of cartPlaces(s, planes)) add({ kind: 'cart', id: c.c.id, st: HOME }, c.c.name, footAt(c.at, FOOT.cart), Z.cart, { px: 44, units: 44, c: cartHitCentre(c.at) });

  // ---- the build sites: the open build's work sites, and the next tier's sites while its crew project is under way
  const building = openBuild(s);
  const siteLabel = (id: string) => (id === 'project' ? `Tier ${s.project?.tier ?? s.tier + 1} ${TIERS[(s.project?.tier ?? s.tier + 1) - 1]?.name ?? ''} build site` : ((s.builds ?? []).find((x) => x.id === id)?.what ?? 'Build site'));
  const seen = new Set<string>();
  const site = (id: string, kind: keyof typeof SITE_EXTENT, p: Pt) => {
    const key = `${id}@${p[0]},${p[1]}`;
    if (seen.has(key)) return;
    seen.add(key);
    const e = SITE_EXTENT[kind];
    add({ kind: 'site', id, st: HOME }, siteLabel(id), [p[0] + e[0], p[1] + e[1], p[0] + e[2], p[1] + e[3]], Z.building);
  };
  // (a renovation's site is the house itself: its own hotspot, whose sheet says where the renovation stands)
  if (building && !building.reno) for (const ws of workSites(s)) site(building.id, ws.kind, ws.at);
  const pj = s.project;
  if (pj && pj.tier === s.tier + 1) {
    const b = (s.builds ?? []).find((x) => x.tier === pj.tier && x.finished === undefined);
    for (const ad of TIERS[pj.tier - 1]?.adds ?? []) {
      if (ad.id === 'p3') site(b?.id ?? 'project', 'dock', DOCK.root);
      else {
        const kind = siteKindOf(ad.model);
        if (kind && POS[ad.id]) site(b?.id ?? 'project', kind, POS[ad.id]);
      }
    }
  }

  // ---- the staff drawn at work: a builder is the build site's (gap-zoom's builders' tap), the others themselves
  for (const f of figurePlaces(s, phase, planes)) {
    const foot = footAt(f.at, FOOT.figure);
    if (f.kind === 'builder' && building) add({ kind: 'site', id: building.id, st: HOME }, `Builders: ${building.what}`, foot, Z.staff);
    else if (f.kind !== 'builder') add({ kind: 'staff', id: f.npc.id, st: HOME }, `${f.kind === 'pilot' ? 'Pilot' : 'Housekeeper'} ${f.npc.name}`, foot, Z.staff);
  }
  return out;
}

const inBox = (b: Box, p: Pt) => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
const boxDist = (b: Box, p: Pt) => Math.hypot(Math.max(b[0] - p[0], 0, p[0] - b[2]), Math.max(b[1] - p[1], 0, p[1] - b[3]));
const area = (b: Box) => (b[2] - b[0]) * (b[3] - b[1]);
/** a hotspot's own min-size target at this zoom (CSS px → map units) */
const minBox = (h: Hotspot, pxPerUnit: number): Box | null => {
  if (!h.min) return null;
  const r = Math.max(h.min.px / 2 / pxPerUnit, (h.min.units ?? 0) / 2);
  return [h.min.c[0] - r, h.min.c[1] - r, h.min.c[0] + r, h.min.c[1] + r];
};
/** how far a tap is from an object's middle (its footprint's centre; a cart's, its target's) */
const midDist = (h: Hotspot, p: Pt) => {
  const c = h.min?.c ?? ([(h.foot[0] + h.foot[2]) / 2, (h.foot[1] + h.foot[3]) / 2] as Pt);
  return Math.hypot(p[0] - c[0], p[1] - c[1]);
};

export type Hit = { hit: Hotspot } | { choose: [Hotspot, Hotspot] } | { zoom: true } | { empty: true };

/**
 * What a tap at `p` (map units) opens, with `pxPerUnit` CSS px per map unit at the current zoom (6.1):
 * 1. inside one or more true footprints: the highest z among them, then the smallest (a cart drawn beside a plane
 *    wins over the plane)
 * 2. else inside a cart's own 44 px target (its SVG button): that cart. It never takes a tap that lands on another
 *    object as drawn (at k = 1 on a phone a 44 px square is ~98 map units: it would bury the twin beside the charger)
 * 3. else the objects whose middle is within 22 CSS px (a 44 px target round every object, the way gap-zoom tapped a
 *    builder; a building's own footprint is bigger than that): exactly one is that object; two or more zoom x2 about p
 *    (one predictable tap instead of a guess), or at the most zoom (`atMax`) a chooser of the two nearest. Measured
 *    from the footprints' edges instead, 22 px (49 map units at k = 1 on a phone) would leave 14% of the beaten
 *    island's land as empty ground, and the zone toggle needs 40%
 * 4. else empty ground
 */
export function hitTest(spots: Hotspot[], p: Pt, pxPerUnit: number, atMax = false): Hit {
  const inside = spots.filter((h) => inBox(h.foot, p));
  if (inside.length) {
    inside.sort((a, b) => b.z - a.z || area(a.foot) - area(b.foot));
    return { hit: inside[0] };
  }
  const own = spots.filter((h) => h.min && inBox(minBox(h, pxPerUnit)!, p));
  if (own.length) {
    own.sort((a, b) => boxDist(a.foot, p) - boxDist(b.foot, p));
    return { hit: own[0] };
  }
  const reach = REACH_PX / Math.max(1e-6, pxPerUnit);
  const near = new Map<string, { h: Hotspot; d: number }>();
  for (const h of spots) {
    const d = midDist(h, p);
    if (d > reach) continue;
    const k = refKey(h.ref);
    const was = near.get(k);
    if (!was || d < was.d) near.set(k, { h, d });
  }
  const list = [...near.values()].sort((a, b) => a.d - b.d || b.h.z - a.h.z);
  if (list.length === 1) return { hit: list[0].h };
  if (list.length >= 2) return atMax ? { choose: [list[0].h, list[1].h] } : { zoom: true };
  return { empty: true };
}

/** the hotspots whose footprint shows in a view (the keyboard's "Objects on the map"), one per object, by kind */
export function inView(spots: Hotspot[], view: Box): Hotspot[] {
  const seen = new Set<string>();
  const order = ['plane', 'house', 'grid', 'generator', 'hangar', 'office', 'runway', 'fuel', 'dock', 'windsock', 'cart', 'staff', 'site'];
  return spots
    .filter((h) => h.foot[2] >= view[0] && h.foot[0] <= view[2] && h.foot[3] >= view[1] && h.foot[1] <= view[3])
    .filter((h) => {
      const k = refKey(h.ref);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => order.indexOf(a.ref.kind) - order.indexOf(b.ref.kind));
}

/** the rect a bubble covers (map units), as the island reports its placed bubbles: a tap on it goes to its asset */
export function bubbleSpot(ref: ObjectRef, label: string, r: Box): Hotspot {
  return { ref, label, foot: clip(r), z: Z.bubble };
}
