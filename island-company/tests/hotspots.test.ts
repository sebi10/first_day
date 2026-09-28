// The hotspot registry and hit-test (docs/EXPANSION.md 6.1, 13.2): every
// object on the beaten scene has a hotspot, a tap on an object's footprint
// resolves to it at k = 1 and at k = 3.2, every object opens with one tap at
// the preset that frames it, close neighbours zoom (or at the most zoom, a
// chooser), empty ground survives for the zone toggle, carts win over the
// plane they're beside, the builders are the build site, nothing is outside
// the scene.
import { describe, expect, it } from 'vitest';
import { MODELS, TIERS } from '../src/sim/data';
import { gseCarts } from '../src/sim/econ';
import { apply, createIsland } from '../src/sim/engine';
import { BUILDS, wageAt } from '../src/sim/staff';
import { ROLES, type IslandState, type NpcRole, type WeekReport } from '../src/sim/types';
import { focusBox, H, inPoly, PLATEAU, siteBox, W, workSites, type Box, type Pt } from '../src/ui/island/geo';
import { allCam, camForBox, frameOf, HOME_SCENE, K_MAX, pxPerUnit, viewRect, type Cam, type Size } from '../src/ui/map/camera';
import { bubbleSpot, hitTest, hotspots, inView, refKey, REACH_PX, Z, type Hotspot } from '../src/ui/map/hotspots';
import { LAYOUTS } from '../src/ui/map/layouts';
import { builderSpots, cartPlaces, figurePlaces, planePlaces } from '../src/ui/map/place';
import { assetRef, HOME, type ObjectRef } from '../src/ui/objects';

const CARD: Size = { w: 358, h: 268.5 }; // islandlab.html?w=358
const NOW = Date.UTC(2026, 8, 26, 10);

/** an island at a tier, as the island lab builds its scenes (src/islandlab.tsx) */
function island(tier: number, weather: IslandState['weather'] = 'clear'): IslandState {
  let s = createIsland({ id: 'hot', name: 'Frigate Bay', now: NOW, tz: 'Europe/Paris', seed: 7, creator: { uid: 'a', name: 'Seb', role: 'mech' } });
  s = apply(s, { t: 'join', uid: 'b', name: 'Mia', role: 'elec' }, NOW).s;
  s = apply(s, { t: 'join', uid: 'c', name: 'Ravi', role: 'fin' }, NOW).s;
  for (let t = 2; t <= tier; t++)
    for (const a of TIERS[t - 1].adds) {
      const kind = MODELS[a.model].kind;
      s.assets.push({ id: a.id, kind, model: a.model, name: a.name, health: 82, touchedWeek: 0, ...(kind === 'house' ? { inspectionUntil: 40 } : {}), ...(kind === 'plane' ? { sinceInspection: 4 } : {}) });
    }
  s.tier = tier;
  s.weather = weather;
  s.week = 31;
  s.history = [{ week: 30, tier, grade: 'A', revenue: 24000, budget: 22000 } as unknown as WeekReport];
  for (const a of s.assets) a.health = Math.max(a.health, 80);
  return s;
}
const staffed = (s: IslandState, crew: [NpcRole, 1 | 2 | 3 | 4 | 5][]) =>
  (s.staff = crew.map(([role, skill], i) => ({ id: `n${900 + i}`, name: `Crew ${i + 1}`, role, skill, wage: wageAt(role, skill), hired: 0, start: 0 })));

/** the beaten island by day: tier 5, the staff at work (pilots, housekeepers), both carts (one hooked up to the cargo plane) */
function beaten(): IslandState {
  const s = island(5);
  staffed(s, [['pilot', 3], ['pilot', 3], ['housekeeper', 3], ['housekeeper', 3], ['builder', 3]]);
  s.gse = gseCarts(s).map((c, i) => (i === 0 ? { ...c, hookedTo: 'p2', charging: false, charge: 70 } : { ...c, charging: true, charge: 20 }));
  return s;
}
/** tier 3 with the builders on the tier-4 build (the villas' footings) */
function building(done = 0.4): IslandState {
  const s = island(3);
  const d = BUILDS.find((b) => b.tier === 4)!;
  s.builds = [{ id: d.id, what: d.what, tier: 4, done, drawn: Math.ceil(done), need: d.units.length, started: s.week - 3 }];
  staffed(s, [['pilot', 3], ['housekeeper', 3], ['builder', 3], ['builder', 3], ['builder', 3]]);
  return s;
}

const K1 = pxPerUnit(allCam(CARD), CARD); // 0.4475 CSS px a unit
const KMAX = pxPerUnit({ x: 400, y: 300, k: K_MAX }, CARD);
const key = (r: ObjectRef) => refKey(r);
const inBox = (b: Box, p: Pt) => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
/** a grid of points inside a footprint */
const samples = (b: Box, n = 5): Pt[] => {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out.push([b[0] + ((b[2] - b[0]) * (i + 0.5)) / n, b[1] + ((b[3] - b[1]) * (j + 0.5)) / n]);
  return out;
};
/** would a tap at p be this spot's, by the rule (the highest z inside, then the smallest)? */
const ownsPoint = (spots: Hotspot[], h: Hotspot, p: Pt) => {
  const area = (b: Box) => (b[2] - b[0]) * (b[3] - b[1]);
  return !spots.some((o) => o !== h && key(o.ref) !== key(h.ref) && inBox(o.foot, p) && (o.z > h.z || (o.z === h.z && area(o.foot) < area(h.foot))));
};

describe('the hotspot registry', () => {
  it('has every object on the beaten scene: each asset, the fixtures, the carts and the staff at work', () => {
    const s = beaten();
    const spots = hotspots(s, HOME, LAYOUTS.home, { phase: 'day' });
    const keys = new Set(spots.map((h) => key(h.ref)));
    for (const a of s.assets) expect(keys.has(key(assetRef(a))), a.id).toBe(true);
    for (const f of ['hangar', 'office', 'runway', 'fuel', 'windsock', 'dock']) expect(keys.has(`home:${f}:${f}`), f).toBe(true);
    for (const c of gseCarts(s)) expect(keys.has(`home:cart:${c.id}`), c.id).toBe(true);
    const figs = figurePlaces(s, 'day', planePlaces(s)).filter((f) => f.kind !== 'builder');
    expect(figs.length).toBeGreaterThanOrEqual(3);
    for (const f of figs) expect(keys.has(`home:staff:${f.npc.id}`), f.npc.id).toBe(true);
    // the staff are off at night and in a storm: no figure, no hotspot
    expect(hotspots(s, HOME, LAYOUTS.home, { phase: 'night' }).some((h) => h.ref.kind === 'staff')).toBe(false);
    // the region map is stage 3
    expect(hotspots(s, 'region')).toEqual([]);
  });

  it('keeps every footprint inside the scene', () => {
    for (const s of [island(1), island(3, 'storm'), building(), beaten()])
      for (const h of hotspots(s, HOME, LAYOUTS.home, { phase: 'day' })) {
        expect(h.foot[0], h.label).toBeGreaterThanOrEqual(0);
        expect(h.foot[1], h.label).toBeGreaterThanOrEqual(0);
        expect(h.foot[2], h.label).toBeLessThanOrEqual(W);
        expect(h.foot[3], h.label).toBeLessThanOrEqual(H);
        expect(h.foot[2] - h.foot[0], h.label).toBeGreaterThan(0);
        expect(h.foot[3] - h.foot[1], h.label).toBeGreaterThan(0);
      }
  });

  it('on the beaten scene at 358 px, sampled taps on each footprint resolve to its object, at k = 1 and at k = 3.2', () => {
    const s = beaten();
    const spots = hotspots(s, HOME, LAYOUTS.home, { phase: 'day' });
    for (const px of [K1, KMAX]) {
      for (const h of spots) {
        let own = 0;
        for (const p of samples(h.foot)) {
          if (!ownsPoint(spots, h, p)) continue;
          own++;
          const r = hitTest(spots, p, px, px === KMAX);
          expect('hit' in r && key(r.hit.ref), `${h.label} at ${p.map(Math.round)} (px ${px.toFixed(2)})`).toBe(key(h.ref));
        }
        // every object is on top somewhere on its own footprint
        expect(own, `${h.label} is buried`).toBeGreaterThan(0);
      }
    }
  });

  it('opens every object with one tap at the preset that frames it (my zone, the build site, all)', () => {
    for (const s of [beaten(), building(0.4), building(1.5), island(2)]) {
      const spots = hotspots(s, HOME, LAYOUTS.home, { phase: 'day' });
      const presets: Cam[] = [allCam(CARD), ...ROLES.map((r) => camForBox(focusBox(r, s.tier), CARD))];
      const sb = siteBox(s);
      if (sb) presets.push(camForBox(sb, CARD));
      for (const h of spots) {
        const opens = presets.some((c) => {
          const v = viewRect(c, CARD);
          const px = pxPerUnit(c, CARD);
          return samples(h.foot, 7).some((p) => inBox(v, p) && (() => {
            const r = hitTest(spots, p, px, c.k >= K_MAX - 1e-6);
            return 'hit' in r && key(r.hit.ref) === key(h.ref);
          })());
        });
        expect(opens, `${h.label} (tier ${s.tier})`).toBe(true);
      }
    }
  });

  it("two footprints within reach zoom x2 about the tap; at the most zoom a chooser of the two nearest", () => {
    const a: Hotspot = { ref: { kind: 'house', id: 'a', st: HOME }, label: 'A', foot: [100, 100, 110, 110], z: Z.building };
    const b: Hotspot = { ref: { kind: 'house', id: 'b', st: HOME }, label: 'B', foot: [140, 100, 150, 110], z: Z.building };
    const c: Hotspot = { ref: { kind: 'house', id: 'c', st: HOME }, label: 'C', foot: [300, 100, 310, 110], z: Z.building };
    const mid: Pt = [125, 105];
    expect(hitTest([a, b, c], mid, K1)).toEqual({ zoom: true });
    expect(hitTest([a, b, c], mid, K1, true)).toEqual({ choose: [a, b] });
    // one within reach (22 CSS px of its middle, as gap-zoom's builders' tap): that one; none: empty ground
    const reach = REACH_PX / K1;
    expect(hitTest([a, c], [105 + reach - 1, 105], K1)).toEqual({ hit: a });
    expect(hitTest([a, c], [105 + reach + 1, 105], K1)).toEqual({ empty: true });
    // the same object twice (a plane and its bubble) is one object
    const bubbleA = bubbleSpot(a.ref, 'A', [100, 80, 112, 95]);
    expect(hitTest([a, bubbleA, c], [106, 97], K1)).toMatchObject({ hit: { ref: a.ref } });
  });

  it('leaves at least 40% of the land empty ground at k = 1 (the zone toggle survives)', () => {
    for (const s of [island(1), island(3), beaten()]) {
      const spots = hotspots(s, HOME, LAYOUTS.home, { phase: 'day' });
      let land = 0, empty = 0;
      for (let x = 4; x < W; x += 8)
        for (let y = 4; y < H; y += 8) {
          if (!inPoly([x, y], PLATEAU)) continue;
          land++;
          if ('empty' in hitTest(spots, [x, y], K1)) empty++;
        }
      expect(empty / land, `tier ${s.tier}: ${((100 * empty) / land).toFixed(0)}% empty`).toBeGreaterThanOrEqual(0.4);
    }
  });

  it('a cart wins over the plane it is beside, and keeps its 44 px target on open ground', () => {
    const s = beaten();
    const spots = hotspots(s, HOME, LAYOUTS.home, { phase: 'day' });
    const planes = planePlaces(s);
    const cart = cartPlaces(s, planes).find((c) => c.plane?.id === 'p2')!;
    expect(cart).toBeTruthy();
    const cs = spots.find((h) => h.ref.kind === 'cart' && h.ref.id === cart.c.id)!;
    const ps = spots.find((h) => h.ref.kind === 'plane' && h.ref.id === 'p2')!;
    const overlap: Box = [Math.max(cs.foot[0], ps.foot[0]), Math.max(cs.foot[1], ps.foot[1]), Math.min(cs.foot[2], ps.foot[2]), Math.min(cs.foot[3], ps.foot[3])];
    expect(overlap[2] > overlap[0] && overlap[3] > overlap[1]).toBe(true);
    for (const p of samples(overlap, 3)) for (const px of [K1, KMAX]) expect(hitTest(spots, p, px)).toMatchObject({ hit: { ref: { kind: 'cart', id: cart.c.id } } });
    // its own target stays 44 CSS px on open ground, at every zoom (the SVG button is that size too)
    for (const k of [1, 1.7, 2.26, 3.2]) {
      const px = pxPerUnit({ x: 400, y: 300, k }, CARD);
      const half = 22 / px - 0.5;
      const c = cs.min!.c;
      // the side of the square away from the plane (the cart sits by the nose, to the west)
      const west: Pt = [c[0] - half, c[1]];
      const r = hitTest(spots, west, px);
      if (!spots.some((o) => o !== cs && inBox(o.foot, west))) expect(r, `k ${k}`).toMatchObject({ hit: { ref: { kind: 'cart' } } });
    }
  });

  it("the builders' taps (gap-zoom's) resolve to the build site", () => {
    for (const done of [0.4, 1.5, 3.3]) {
      const s = building(done);
      const spots = hotspots(s, HOME, LAYOUTS.home, { phase: 'day' });
      const crew = builderSpots(s);
      expect(crew.length).toBeGreaterThan(0);
      for (const [x, y] of crew) {
        // the figure's middle, as gap-zoom hit-tested it
        const r = hitTest(spots, [x, y - 7], KMAX);
        expect(r, `builder at ${x},${y} (${done})`).toMatchObject({ hit: { ref: { kind: 'site', id: 't4' } } });
      }
      // and each site itself (its ground point, where the plot is dug)
      for (const w of workSites(s)) expect(hitTest(spots, [w.at[0], w.at[1] - 10], KMAX), w.id).toMatchObject({ hit: { ref: { kind: 'site', id: 't4' } } });
    }
  });

  it("lists what's in view for the keyboard, one entry an object", () => {
    const s = beaten();
    const spots = hotspots(s, HOME, LAYOUTS.home, { phase: 'day' });
    const all = inView(spots, [0, 0, W, H]);
    expect(new Set(all.map((h) => key(h.ref))).size).toBe(all.length);
    expect(all.length).toBe(new Set(spots.map((h) => key(h.ref))).size);
    const zone = inView(spots, viewRect(camForBox(focusBox('mech', 5), CARD), CARD));
    expect(zone.some((h) => h.ref.kind === 'plane')).toBe(true);
    expect(zone.some((h) => h.ref.kind === 'house' && h.ref.id === 'h4')).toBe(false);
    // the frame the island draws covers every hotspot a preset shows
    const f = frameOf(camForBox(focusBox('elec', 5), CARD), CARD, HOME_SCENE, 2);
    for (const h of inView(spots, f.view)) expect(h.foot[0] < f.region[2] && h.foot[2] > f.region[0]).toBe(true);
  });
});
