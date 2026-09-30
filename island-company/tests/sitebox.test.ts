// The builders' zoom box on Home (src/ui/island/geo.tsx siteBox, docs/JOBFLOW.md
// 15.5): for every tier build at every stage of its work and for each extra
// cottage's plot, the box lies inside the map, the view it frames is a real
// zoom that shows the site's ground point and every builder standing on it, the
// ground power carts' tap targets stay at least 44 CSS px, and there is no box
// (the whole island) when no build is open, including on old docs without builds.
import { describe, expect, it } from 'vitest';
import { BUILDS, COTTAGE, COTTAGE_PLOTS } from '../src/sim/staff';
import type { Build, IslandState } from '../src/sim/types';
import { DOCK, H, hitUnits, PLOT, POS, siteBox, viewOf, W, workSites, zoomK, type Box, type Pt } from '../src/ui/island/geo';
import { crewSpots, DOCK_CREW } from '../src/ui/island/sites';

type Lite = Pick<IslandState, 'builds' | 'tier'>;
const open = (id: string, tier: number | undefined, done: number, need: number, cottage?: string): Build => ({
  id,
  what: id,
  ...(tier !== undefined ? { tier } : {}),
  ...(cottage ? { cottage } : {}),
  done,
  drawn: Math.ceil(done),
  need,
  started: 1,
});
const inside = (b: Box, [x, y]: Pt) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];
/** a builder figure is about 14 tall and 8 wide over its ground point */
const figureIn = (v: Box, p: Pt) => inside(v, [p[0] - 4, p[1] - 14]) && inside(v, [p[0] + 4, p[1] + 1]);
/** where the island stands the builders for a build (island.tsx: the worked sites' crew spots) */
const crewOf = (s: Lite): Pt[] => workSites(s).flatMap((w) => (w.kind === 'dock' ? DOCK_CREW : crewSpots(w.kind, w.at[0], w.at[1])));

/** every build tier and both cottage plots, each at every stage of its work */
type Case = { name: string; s: Lite };
const groups: { name: string; cases: Case[] }[] = [
  ...BUILDS.map((d) => ({
    name: `the tier ${d.tier} build (${d.site})`,
    cases: Array.from({ length: d.units.length * 2 }, (_, i) => i / 2).flatMap((done) =>
      // worked the tier before it arrives, and two tiers ahead (a migrated island's open build)
      [...new Set([d.tier! - 1, Math.max(1, d.tier! - 2)])].map((tier) => ({ name: `${d.id} ${done}/${d.units.length} at tier ${tier}`, s: { tier, builds: [open(d.id, d.tier, done, d.units.length)] } })),
    ),
  })),
  ...COTTAGE_PLOTS.map((p) => ({
    name: `${p.name} on plot ${p.id}`,
    cases: Array.from({ length: COTTAGE.units.length }, (_, done) => done).flatMap((done) =>
      [3, 4, 5].map((tier) => ({ name: `${p.id} ${done}/${COTTAGE.units.length} at tier ${tier}`, s: { tier, builds: [open(`cottage-${p.id}`, undefined, done, COTTAGE.units.length, p.id)] } })),
    ),
  })),
];

function frames({ name, s }: Case) {
  const b = siteBox(s);
  expect(b, name).not.toBeNull();
  if (!b) return;
  // inside the map, and a real box
  expect(b[0], name).toBeGreaterThanOrEqual(0);
  expect(b[1], name).toBeGreaterThanOrEqual(0);
  expect(b[2], name).toBeLessThanOrEqual(W);
  expect(b[3], name).toBeLessThanOrEqual(H);
  expect(b[2] - b[0], name).toBeGreaterThan(40);
  expect(b[3] - b[1], name).toBeGreaterThan(40);
  // a real zoom (not the whole island): at least 2x
  expect(zoomK(b), name).toBeGreaterThanOrEqual(2);
  // the view it frames is on the map and shows the site and every builder on it
  const v = viewOf(b);
  expect(v[0], name).toBeGreaterThanOrEqual(-1e-9);
  expect(v[1], name).toBeGreaterThanOrEqual(-1e-9);
  expect(v[2], name).toBeLessThanOrEqual(W + 1e-9);
  expect(v[3], name).toBeLessThanOrEqual(H + 1e-9);
  const ws = workSites(s);
  expect(ws.length, name).toBeGreaterThan(0);
  for (const w of ws) expect(inside(b, w.at), `${name}: ${w.id}`).toBe(true);
  for (const p of crewOf(s)) expect(figureIn(v, p), `${name}: a builder at ${p}`).toBe(true);
  // the ground power carts stay a 44 CSS px target under the zoom, phone to desktop
  for (const cssW of [320, 358, 390, 600, 720]) expect((Math.max(44, hitUnits(44, cssW, b)) * cssW * zoomK(b)) / W, name).toBeGreaterThanOrEqual(44 - 1e-9);
}

describe("the builders' zoom box", () => {
  it('covers every build tier and both cottage plots', () => {
    expect(new Set(groups.flatMap((g) => g.cases.map((c) => c.s.builds![0].tier ?? c.s.builds![0].cottage)))).toEqual(new Set([2, 3, 4, 5, 'h8', 'h9']));
  });

  for (const g of groups) it(`frames the site of ${g.name}, inside the map, with every builder in view`, () => g.cases.forEach(frames));

  it("follows the unit the builders work: the villas' footings and shutters, the dock's pilings and decking", () => {
    const at = (done: number) => workSites({ tier: 3, builds: [open('t4', 4, done, 4)] }).map((w) => w.id);
    expect(at(0)).toEqual(['h5', 'h6']);
    expect(at(0.9)).toEqual(['h5', 'h6']);
    expect(at(1)).toEqual(['p3']);
    expect(at(2.5)).toEqual(['p3']);
    expect(at(3)).toEqual(['h5', 'h6']);
    // the dock's box is the lagoon's, the villas' the south-east headland's
    expect(inside(siteBox({ tier: 3, builds: [open('t4', 4, 1.4, 4)] })!, DOCK.root)).toBe(true);
    expect(inside(siteBox({ tier: 3, builds: [open('t4', 4, 3.3, 4)] })!, POS.h5)).toBe(true);
    // the other builds' sites are all of their buildings
    expect(workSites({ tier: 1, builds: [open('t2', 2, 1, 3)] }).map((w) => w.id)).toEqual(['h3', 'h4']);
    expect(workSites({ tier: 2, builds: [open('t3', 3, 1, 2)] }).map((w) => w.id)).toEqual(['gen']);
    expect(workSites({ tier: 4, builds: [open('t5', 5, 1, 4)] }).map((w) => w.id)).toEqual(['h7']);
    expect(workSites({ tier: 3, builds: [open('cottage-h8', undefined, 1, 5, 'h8')] })).toEqual([{ id: 'h8', kind: 'house', at: PLOT.h8 }]);
  });

  it('frames the build the builders work: the tier build before a queued cottage', () => {
    expect(workSites({ tier: 3, builds: [open('cottage-h9', undefined, 0, 5, 'h9'), open('t5', 5, 0.5, 4)] }).map((w) => w.id)).toEqual(['h7']);
  });

  it('is the whole island (no box) with no build open, and on old docs with no builds', () => {
    expect(siteBox({ tier: 2 })).toBeNull();
    expect(siteBox({ tier: 3, builds: [] })).toBeNull();
    // finished, or for a tier the island already has
    expect(siteBox({ tier: 3, builds: [{ ...open('t4', 4, 4, 4), finished: 9 }] })).toBeNull();
    expect(siteBox({ tier: 4, builds: [open('t4', 4, 2, 4)] })).toBeNull();
    // a cottage on a plot the art doesn't have
    expect(siteBox({ tier: 3, builds: [open('cottage-h99', undefined, 1, 5, 'h99')] })).toBeNull();
  });

  it('stands every builder in front of the works, so the island draws them over the site', () => {
    for (const kind of ['house', 'villa', 'lodge', 'gen'] as const) for (const [, y] of crewSpots(kind, 400, 300)) expect(y, kind).toBeGreaterThan(300);
    for (const [, y] of DOCK_CREW) expect(y).toBeGreaterThan(DOCK.root[1]);
  });
});
