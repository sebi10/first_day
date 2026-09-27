// The island is the progress bar and the status board: a cartoon map that
// grows tier by tier (and week by week, src/sim/growth.ts), with notification
// bubbles above whatever needs a hand, and every fault drawn on the asset
// itself. Layers, bottom to top: memoized terrain, sea life, flat props,
// y-sorted buildings/planes/people, wires, sky, the light of the hour,
// bubbles; rain and wind streaks sit outside the zoom.
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { COSMETICS, TIERS } from '../sim/data';
import { cableReport, gseCarts, hazardOn, houseBlocker, houseRentable, isAog, planeCapacity, powered, restrictedBy } from '../sim/econ';
import { openBuild, pilotSeats, working } from '../sim/staff';
import { developmentOf, type Development, type Flourish } from '../sim/growth';
import type { Asset, IslandState, Role } from '../sim/types';
import { Cottage, GenHouse, Hangar, Lodge, Office, Pole, POLE_H, Ribbon, SMOKE_AT, Substation, Villa, WINDOWS, winPath, type Fault, type Win } from './island/buildings';
import { FlyingPlane, Plane, type PlaneModel } from './island/craft';
import { CART_HOME, CART_OUTLET, cartBeside, cartLight, GpuCart, receptacle } from './island/gse';
import {
  APRON_PROPS, ApronLights, ApronProps, BeachBar, Bench, Boardwalk, Confetti, Dock, Festoon, Fireworks, FishingBoats, Fountain, GardenBeds, Lamp, Lighthouse, Market, NewFlags,
  Observatory, Statue, Bunting, buntingBulbs, YachtAt, YachtLights,
} from './island/extras';
import { along, AOG_SPOT, curve, DOCK, focusBox, H, HANGAR, OFFICE, P, PATHS, PLOT, POS, RUNWAY, RUNWAY_ANGLE, RUNWAY_C, RUNWAY_LEN, SPOT, viewOf, W, zoomK, zoomOf, type Pt } from './island/geo';
import { blob } from './island/rocks';
import { Clouds, DawnGrade, GoldenGrade, Gulls, Guy, LifeDefs, NightGrade, NightSky, Rain, SeaLife, StormGrade, Wind } from './island/life';
import { K } from './island/paint';
import { crewSpots, DOCK_CREW, DockSite, Site, type SiteKind } from './island/sites';
import { NpcFigure, OfficeLate, StaffDefs } from './island/staff';
import { Bubble, bubbleK, NewBadge, spread, type Icon, type KeepOut, type Rect, type Tone } from './island/status';
import { COAST_LINE, Terrain, TerrainDefs } from './island/terrain';

type Phase = 'dawn' | 'day' | 'golden' | 'night';
export const phaseOf = (d = new Date()): Phase => {
  const h = d.getHours();
  return h >= 5 && h < 8 ? 'dawn' : h >= 8 && h < 17 ? 'day' : h >= 17 && h < 20 ? 'golden' : 'night';
};

const cosmeticColor = (role: Role, id: string | undefined) => COSMETICS[role].find((c) => c.id === id)?.color ?? COSMETICS[role][0].color;
const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];

// house geometry, for bubbles and wires (k = the scale it is drawn at)
const HOUSE = {
  cottage: { top: 42, w: 20, h: 18, d: 26, k: 1 },
  villa: { top: 54, w: 30, h: 32, d: 32, k: 0.92 },
  lodge: { top: 66, w: 30, h: 20, d: 40, k: 1 },
} as const;
type HouseModel = keyof typeof HOUSE;
const modelOf = (a: Asset): HouseModel => ((a.model as HouseModel) in HOUSE ? (a.model as HouseModel) : 'cottage');
const houseGeo = (a: Asset) => HOUSE[modelOf(a)];

// Power: the substation feeds its own pole Q on the west bank; the line
// crosses the river to the junction S, then runs up the east bank and along
// the cottage spine. The generator (tier 3) feeds S directly.
const POLES: Record<string, { at: Pt; tier: number }> = {
  Q: { at: [488, 372], tier: 1 },
  S: { at: [548, 406], tier: 1 },
  A: { at: [554, 320], tier: 1 },
  C: { at: [636, 318], tier: 1 },
  D: { at: [640, 366], tier: 2 },
  // behind the villas, off the lane: each villa takes a drop to its rear
  E: { at: [648, 410], tier: 4 },
  F: { at: [648, 236], tier: 5 }, // at the terrace foot, clear of the steps and the lodge
};
const SPANS: [string, string][] = [['S', 'A'], ['A', 'C'], ['C', 'D'], ['D', 'E'], ['C', 'F']];
const FEED: Record<string, string> = { h1: 'A', h2: 'C', h3: 'D', h4: 'D', h5: 'E', h6: 'E', h7: 'F' };
const Q_LEAN = 24;
const poleTop = (k: string, lean = 0): Pt => {
  const [x, y] = POLES[k].at, r = (lean * Math.PI) / 180, l = POLE_H - 3;
  return [Math.round((x + Math.sin(r) * l) * 10) / 10, Math.round((y - Math.cos(r) * l) * 10) / 10];
};
const sag = (a: Pt, b: Pt, k = 0.12) => {
  const m: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + Math.hypot(b[0] - a[0], b[1] - a[1]) * k];
  return `M${a[0]} ${a[1]}Q${m[0].toFixed(1)} ${m[1].toFixed(1)} ${b[0]} ${b[1]}`;
};

const PLANE_ROT: Record<string, number> = { p1: 94, p2: 91, p3: -84 };
const PLANE_SIZE: Record<string, number> = { p3: 0.8 };
/** Keep plane footprints apart (wingspan ~76, depth ~50): a safety net over the fixed spots. */
function unclutter(ps: { id: string; x: number; y: number }[]) {
  for (let pass = 0; pass < 4; pass++)
    for (let i = 0; i < ps.length; i++)
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i], b = ps[j];
        const ox = 80 - Math.abs(a.x - b.x), oy = 52 - Math.abs(a.y - b.y);
        if (ox <= 0 || oy <= 0) continue;
        const s = (a.x <= b.x ? -1 : 1) * (ox / 2);
        a.x += s;
        b.x -= s;
      }
  return ps;
}

// Ambient motion is decoration, so it must cost nothing when nobody is looking:
// it stops after 20 s without input, off-screen, in a background tab, and under
// a full-screen overlay (puzzle, review). Any input wakes it.
const IDLE_MS = 20_000;
let lastInput = typeof performance !== 'undefined' ? performance.now() : 0;
const wakers = new Set<() => void>();
if (typeof window !== 'undefined') {
  const poke = () => {
    const wasIdle = performance.now() - lastInput > IDLE_MS;
    lastInput = performance.now();
    if (wasIdle) wakers.forEach((f) => f());
  };
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll']) window.addEventListener(ev, poke, { passive: true, capture: true });
}

function useStill(ref: { current: SVGSVGElement | null }) {
  const [still, setStill] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let visible = true;
    const check = () => {
      const covered = [...document.querySelectorAll('.overlay')].some((o) => !o.contains(el));
      const s = !visible || document.hidden || covered || performance.now() - lastInput > IDLE_MS;
      setStill(s);
      if (s) el.pauseAnimations?.();
      else el.unpauseAnimations?.();
    };
    const io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(([e]) => ((visible = e.isIntersecting), check())) : null;
    io?.observe(el);
    const t = setInterval(check, 1000);
    wakers.add(check);
    document.addEventListener('visibilitychange', check);
    check();
    return () => {
      io?.disconnect();
      clearInterval(t);
      wakers.delete(check);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);
  return still;
}

const MODELS_CARGO = (p: Asset) => p.model === 'cargo';
const siteKind = (model: string): SiteKind | null =>
  model === 'cottage' ? 'house' : model === 'villa' ? 'villa' : model === 'lodge' ? 'lodge' : model === 'gen' ? 'gen' : null;

/** the runway's markings: bubbles are pushed off it */
const RUNWAY_BOX: Rect = [RUNWAY.a[0] - 6, Math.min(RUNWAY.a[1], RUNWAY.b[1]) - RUNWAY.w / 2 - 4, RUNWAY.b[0] + 6, Math.max(RUNWAY.a[1], RUNWAY.b[1]) + RUNWAY.w / 2 + 4];

type Item = { y: number; el: JSX.Element };
type Bub = { x: number; y: number; k: number; dx: number; dy: number; icon: Icon; tone: Tone; small?: boolean; key: string; owner: string; fixed?: boolean; count?: number };

/** Screen footprints (front-centre ground point p) that other assets' bubbles keep off. */
const FOOT = {
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
} satisfies Record<string, Rect>;
const footAt = (p: Pt, f: Rect): Rect => [p[0] + f[0], p[1] + f[1], p[0] + f[2], p[1] + f[3]];

export function Island({
  s,
  focus,
  onTap,
  onCart,
  reduceMotion,
  phase: phaseProp,
}: {
  s: IslandState;
  focus: Role | null;
  onTap?: () => void;
  /** a ground power cart was tapped: open its sheet */
  onCart?: (id: string) => void;
  reduceMotion: boolean;
  phase?: Phase;
}) {
  const phase = phaseProp ?? phaseOf();
  const motion = !reduceMotion;
  const svgRef = useRef<SVGSVGElement>(null);
  const still = useStill(svgRef);
  // the drawing's width on screen (CSS px): a cart's tap target is sized to stay at least 44 px, zoomed or not
  const [cssW, setCssW] = useState(360);
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const read = () => el.clientWidth > 0 && setCssW(el.clientWidth);
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const dev = developmentOf(s);
  const has = (f: Flourish) => dev.flourishes.includes(f);
  const pw = powered(s);
  const night = phase === 'night';
  const storm = s.weather === 'storm';
  // lights come on at dusk, at night and under a storm's dark sky
  const warm = night || phase === 'golden' || storm;
  const wear = Math.max(0, Math.min(1, (0.7 - dev.care) / 0.25));
  const hangarColor = cosmeticColor('mech', s.players.mech?.cosmetic);
  const houseColor = cosmeticColor('elec', s.players.elec?.cosmetic);
  const officeColor = cosmeticColor('fin', s.players.fin?.cosmetic);
  const planes = s.assets.filter((a) => a.kind === 'plane');
  const houses = s.assets.filter((a) => a.kind === 'house');
  const grid = s.assets.find((a) => a.kind === 'grid');
  const gen = s.assets.find((a) => a.kind === 'generator');
  const tagged = (a: Asset) => !!s.tags?.[a.id];
  const flying = planes.some((p) => !tagged(p) && planeCapacity(p, s.tier, s.weather) > 0 && !p.model.includes('cargo'));
  const rentable = houses.filter((h) => houseRentable(s, h));
  const booked = rentable.length;
  const z = focus ? focusBox(focus, s.tier) : null;
  const bscale = z ? 1.3 / zoomK(z) : 1;
  // 44 CSS px in drawing units, under the zoom (never smaller than the cart's own 44-unit box)
  const cartHit = Math.max(44, (44 * W) / (Math.max(1, cssW) * zoomK(z)));
  const newIds = new Set(dev.justBuilt ? TIERS[dev.justBuilt - 1].adds.map((a) => a.id) : []);
  const paved = has('paved-paths');
  const carrying = pw.gridDown && pw.genOK;

  // static layers, rendered once per combination that changes them
  const defs = useMemo(
    () => (
      <defs>
        <TerrainDefs />
        <LifeDefs />
        <StaffDefs />
      </defs>
    ),
    [],
  );
  const grove = has('palm-grove');
  const cons = dev.construction && dev.construction.stage < 3 ? dev.construction : null;
  // the generator's shed going up: its plot by the beach is cleared of palms
  const genSite = !!cons && TIERS[cons.tier - 1].adds.some((a) => a.model === 'gen');
  // the extra cottages' plots in use (built or going up): the grove's palms there are cleared
  const plots = Object.keys(PLOT)
    .filter((id) => s.assets.some((a) => a.id === id) || (s.builds ?? []).some((b) => b.cottage === id))
    .join(',');
  const ground = useMemo(
    () => <Terrain tier={s.tier} weather={s.weather} motion={motion} paved={paved} night={night} grove={grove} site={genSite} plots={plots} />,
    [s.tier, s.weather, motion, paved, night, grove, genSite, plots],
  );
  const boats = storm ? 0 : 1 + Math.round(dev.prosperity * 3);
  const sea = useMemo(() => <SeaLife motion={motion} boats={boats} storm={storm} />, [motion, boats, storm]);
  const sky = useMemo(
    () => (
      <>
        {!storm && <Gulls motion={motion} />}
        <Clouds storm={storm} motion={motion} night={night} />
      </>
    ),
    [storm, motion, night],
  );
  const grade = useMemo(
    () =>
      night ? <NightGrade coast={COAST_LINE} storm={storm} /> : storm ? <StormGrade coast={COAST_LINE} /> : phase === 'dawn' ? <DawnGrade /> : phase === 'golden' ? <GoldenGrade coast={COAST_LINE} /> : null,
    [night, storm, phase],
  );
  // no moon or stars behind a storm's cloud deck
  const stars = useMemo(() => (night && !storm ? <NightSky motion={motion} /> : null), [night, storm, motion]);

  const items: Item[] = [];
  const flat: JSX.Element[] = [];
  /** point lights (lamps, the bar, the generator's lamp): x, y, and whether the bulb itself shows */
  const glows: [number, number, boolean][] = [];
  /** lit windows (map-space path), redrawn crisp over the night grade */
  const litWins: string[] = [];
  const bubbles: Bub[] = [];
  /** someone working late at the office (night): drawn over the night grade, in the lit window */
  let litFigure = false;
  const badges: Pt[] = [];
  const keep: KeepOut[] = [{ r: RUNWAY_BOX }];
  const foot = (owner: string, p: Pt, f: Rect) => keep.push({ owner, r: footAt(p, f) });
  const bub = (key: string, x: number, y: number, icon: Icon, tone: Tone, o: { small?: boolean; dx?: number; dy?: number; owner?: string; fixed?: boolean; count?: number } = {}) =>
    bubbles.push({ key, x, y, k: bubbleK(bscale, o.small), dx: (o.dx ?? 0) * bscale, dy: (o.dy ?? 0) * bscale, icon, tone, small: o.small, owner: o.owner ?? key, fixed: o.fixed, count: o.count });
  const at = (id: string) => POS[id] ?? PLOT[id];

  // ---- airfield: every plane has its own stand and its own AOG spot (worn out, or waiting on a part: the part chain)
  const isDown = (p: Asset) => p.health < 40 || isAog(s, p.id);
  const aog = planes.filter(isDown);
  items.push({ y: HANGAR[1], el: <At key="hangar" p={HANGAR}><Hangar tint={hangarColor} wear={wear} doorOpen={aog.some((p) => p.id === 'p1')} /></At> });
  foot('hangar', HANGAR, FOOT.hangar);
  const spots = unclutter(planes.map((p) => ({ id: p.id, x: (isDown(p) ? AOG_SPOT[p.id] ?? POS[p.id] : POS[p.id] ?? POS.p1)[0], y: (isDown(p) ? AOG_SPOT[p.id] ?? POS[p.id] : POS[p.id] ?? POS.p1)[1] })));
  const spotOf = (id: string) => spots.find((q) => q.id === id)!;
  const float = planes.find((p) => p.model === 'float');
  for (const p of planes) {
    const { x, y } = spotOf(p.id);
    const down = isDown(p);
    const g = tagged(p);
    const onWater = p.model === 'float';
    // the floatplane sits on the water, drawn with the dock below the y-sorted things
    if (!onWater) items.push({ y, el: <Plane key={p.id} model={p.model as PlaneModel} x={x} y={y} rot={PLANE_ROT[p.id] ?? 92} jacks={down} chocks={g} covered={storm && !down} mood={dev.care} /> });
    foot(p.id, [x, y], onWater ? FOOT.float : FOOT.plane);
    if (down) {
      // on the dock: between the parts kit and where a ground power cart parks for the floatplane
      const mech: Pt = onWater ? [DOCK.head[2] - 27, DOCK.head[1] + 9] : [x + 22, y + 12];
      items.push({ y: mech[1], el: <Guy key={`mech${p.id}`} x={mech[0]} y={mech[1]} c={K.orange} /> });
      if (onWater) items.push({ y: DOCK.head[3], el: <path key="kit" d={`M${DOCK.head[2] - 40} ${DOCK.head[3] - 2}h9v-5h-9zM${DOCK.head[2] - 39} ${DOCK.head[3] - 7}v-2h7v2`} fill={K.red} stroke="#8a2a22" stroke-width=".8" /> });
      // the twin is on jacks just out of the hangar mouth: its bubble sits
      // straight above it, the tail on its fin, over the hangar's forecourt
      // (the others keep off it)
      if (p.id === 'p1' && !onWater) bub(p.id, x + 3, y - 24, 'wrench', 'alert', { fixed: true });
      else bub(p.id, x, y - (onWater ? 20 : 26), 'wrench', 'alert');
    } else if (g) bub(p.id, x, y - 22, 'noflight', 'alert');
    // the only guest plane past due on an airworthiness alert flies restricted: a placard
    else if (restrictedBy(s, p.id)) bub(p.id, x, y - 22, 'placard', 'warn');
    else if (p.health < 60) bub(p.id, x, y - 22, 'warn', 'warn');
    if (newIds.has(p.id) && !onWater) {
      items.push({ y: y + 1, el: <Ribbon key={`rb${p.id}`} x={x} y={y - 6} /> });
      badges.push([x - 30, y - 12]);
    }
  }
  // ---- ground power carts: on the charger by the hangar, or beside the plane they're hooked up to
  const carts = gseCarts(s);
  const cartLamps: [number, number, string][] = [];
  carts.forEach((c, i) => {
    const plane = c.hookedTo ? planes.find((p) => p.id === c.hookedTo) : undefined;
    const ps = plane ? spotOf(plane.id) : null;
    const at: Pt = plane && ps ? cartBeside(plane.model, [ps.x, ps.y]) : CART_HOME[i % CART_HOME.length];
    const plug: Pt | null = plane && ps ? receptacle(plane.model, [ps.x, ps.y]) : c.charging ? CART_OUTLET[i % CART_OUTLET.length] : null;
    const tagged = !!cableReport(s, c.id);
    const where = plane ? `hooked up to ${plane.name}` : c.charging ? 'on charge' : 'parked';
    items.push({
      y: at[1],
      el: (
        <GpuCart
          key={c.id}
          cart={c}
          at={at}
          plug={plug}
          tagged={tagged}
          label={`${c.name}: ${where}, ${Math.round(c.charge)}% charge${tagged ? ', tagged out' : ''}. Open ground power`}
          onTap={onCart ? () => onCart(c.id) : undefined}
          hit={cartHit}
        />
      ),
    });
    // a bubble may sit on a cart (it's small), but prefers not to
    keep.push({ owner: c.id, r: [at[0] - 12, at[1] - 14, at[0] + 12, at[1] + 3], w: 0.3 });
    cartLamps.push([at[0] + 3.6, at[1] - 11.2, cartLight(c.charge)]);
    // the charger outlet on the hangar wall, while something is plugged into it
    if (plug && !plane) items.push({ y: HANGAR[1] + 0.5, el: <path key={`outlet${c.id}`} d={`M${plug[0] - 2.5} ${plug[1] - 3}h5v5h-5z`} fill="#dfe4e6" stroke="#3b464b" stroke-width=".7" /> });
  });
  flat.push(<ApronProps key="apron" />);
  // props and the floodlight masts are cheap to cover: a bubble may sit on them
  APRON_PROPS.forEach((r) => keep.push({ r, w: 0.3 }));
  // the airfield's lights run off the island grid: dark when the power is out
  if (s.tier >= 5) flat.push(<RunwayLights key="rwl" night={night && pw.on} />);

  // ---- office and the square
  const officeWin: Win = !pw.on ? 'dark' : warm ? 'lit' : 'glass';
  items.push({ y: OFFICE[1], el: <At key="office" p={OFFICE}><Office tint={officeColor} win={officeWin} wear={wear} flag={officeColor} motion={motion} /></At> });
  foot('office', OFFICE, FOOT.office);
  if (officeWin === 'lit') litWins.push(winPath(WINDOWS.office, OFFICE[0], OFFICE[1]), winPath([[-7, -13, 14, 13]], OFFICE[0], OFFICE[1]));
  // the cash alarm sits beside the office, its tail into the east wall (above
  // the office is the peak's foot, where it would read as "the cliff")
  if (s.cash < 2000) bub('cash', OFFICE[0] + 31, OFFICE[1] - 22, 'cash', 'alert', { owner: 'office', dx: 38, dy: 12 });

  // ---- grid: substation, poles, wires
  if (grid) {
    items.push({ y: at('g1')[1], el: <At key="g1" p={at('g1')}><Substation wear={wear} down={pw.gridDown} motion={motion} /></At> });
    foot('g1', at('g1'), FOOT.g1);
    // grid down says "power", not "repair": a struck-through bolt, just above
    // the substation (a touch west, so the fallen pole shows). With no
    // generator to carry the load it is the one bubble for the whole
    // blackout, with a count of the houses gone dark.
    if (pw.gridDown) {
      // the knocked-over pole Q is part of the grid's own picture: its bubble
      // may overlap it, every other bubble keeps off its slim column
      const [qx, qy] = POLES.Q.at, [tx, ty] = poleTop('Q', Q_LEAN);
      keep.push({ owner: 'g1', r: [Math.min(qx, tx) - 4, ty - 4, Math.max(qx, tx) + 4, qy + 2] });
      bub('g1', at('g1')[0], at('g1')[1] - 26, 'bolt-off', 'alert', { dx: -12, count: !pw.on && houses.length > 1 ? houses.length : undefined });
    }
    else if (grid.health < 60) bub('g1', at('g1')[0] + 4, at('g1')[1] - 26, 'warn', 'warn', { dx: 30 });
  }
  const poles = Object.entries(POLES).filter(([, p]) => p.tier <= s.tier);
  for (const [k, p] of poles) items.push({ y: p.at[1], el: <Pole key={`pole${k}`} x={p.at[0]} y={p.at[1]} lean={k === 'Q' && pw.gridDown ? Q_LEAN : 0} /> });

  // ---- generator
  if (gen) {
    const [x, y] = at('gen');
    // the standby lamp says "ready to take over": only while it could
    const standby = !carrying && pw.genOK && (night || storm);
    items.push({ y, el: <At key="gen" p={[x, y]}><GenHouse wear={wear} running={carrying} motion={motion} lamp={standby} /></At> });
    foot('gen', [x, y], FOOT.gen);
    // west of the stack, so the exhaust stays in view. Carrying the island is
    // good news, so it gets the green "running" tone, not the warning yellow.
    if (gen.health < 50) bub('gen', x - 10, y - 28, pw.gridDown ? 'wrench' : 'warn', pw.gridDown ? 'alert' : 'warn', { dx: -24 });
    else if (carrying) bub('gen', x - 10, y - 28, 'bolt', 'ok', { small: true, dx: -24 });
    if (carrying && night) glows.push([x + 11, y - 27, false]);
    if (standby) glows.push([x - 9.5, y - 13, true]);
    // the exhaust column (it leans west off the tank-end stack)
    if (carrying) keep.push({ r: [x + 4, y - 72, x + 42, y - 32] });
    if (newIds.has('gen')) {
      items.push({ y: y + 1, el: <Ribbon key="rbgen" x={x - 4} y={y - 6} /> });
      items.push({ y: y + 2, el: <NewFlags key="nfgen" x={x + 2} y={y - 26} w={46} /> });
      // the starburst (drawn 18 above its anchor) sits on the roof's west
      // corner, overlapping the building: a label on it, not a loose prop
      badges.push([x - 18, y - 8]);
    }
  }

  // ---- houses: open, or showing what is wrong on the building itself
  for (const h of houses) {
    const [x, y] = at(h.id) ?? [0, 0];
    const g = houseGeo(h);
    const open = houseRentable(s, h);
    const why = houseBlocker(s, h);
    const model = modelOf(h);
    const smoking = h.health < 30;
    const fault: Fault = { tag: why === 'red-tagged', damaged: h.health < 40, lapsed: (h.inspectionUntil ?? 0) < s.week, smoking };
    const win: Win = !pw.on ? 'dark' : open ? (warm ? 'lit' : 'glass') : 'shut';
    const props = { tint: houseColor, win, wear, open, fault, motion };
    const el = model === 'villa' ? <Villa {...props} /> : model === 'lodge' ? <Lodge {...props} /> : <Cottage {...props} />;
    items.push({ y, el: <g key={h.id} transform={`translate(${x} ${y})${g.k !== 1 ? ` scale(${g.k})` : ''}`}>{el}</g> });
    foot(h.id, [x, y], FOOT[model]);
    if (smoking) {
      // the smoke column is part of the picture: every bubble keeps off it
      const [sx, sy] = SMOKE_AT[model];
      keep.push({ r: [x + sx * g.k - 6, y + sy * g.k - 50, x + sx * g.k + 24, y + sy * g.k + 2] });
    }
    if (win === 'lit') {
      litWins.push(winPath(WINDOWS[model], x, y, g.k));
      if (model === 'lodge') litWins.push(`M${x - 14} ${y - 20}L${x} ${y - 46}L${x + 14} ${y - 20}Z`);
    }
    if (newIds.has(h.id)) {
      items.push({ y: y + 1, el: <Ribbon key={`rb${h.id}`} x={x} y={y - 6} /> });
      items.push({ y: y + 2, el: <NewFlags key={`nf${h.id}`} x={x + 4} y={y - g.top + 12} w={g.w * 2 + 10} /> });
      badges.push([x - g.w - 12, y - g.top + 8]);
    }
    // one pictogram per reason a house is closed: closed on purpose (no
    // entry), falling apart (cracked house) or inspection lapsed. No power is
    // one island-wide fault: the dark windows say it, and the grid's bubble
    // carries the count, so a house shows only a trouble of its own.
    // a hazard closes it (shock or fire: no entry until it's made safe or fixed); made safe, a small tag
    const hz = hazardOn(s, h.id);
    const icon: Icon | null = !why ? null : fault.tag || why === 'hazard' ? 'noentry' : h.health < 40 ? 'broken' : fault.lapsed ? 'clipboard' : null;
    if (icon) bub(h.id, x + 4, y - g.top, icon, 'alert');
    else if (hz?.safe) bub(h.id, x + 4, y - g.top, 'tag', 'warn', { small: true });
  }

  // ---- build sites: the next tier under construction, later ones surveyed. A site shows the further of the crew
  // project's stage and the builders' (docs/JOBFLOW.md 15.5), with the island's builders on the one they work
  const building = openBuild(s);
  const builders = working(s).filter((n) => n.role === 'builder');
  const onSite = !!building && builders.length > 0;
  const buildStage = (b: NonNullable<IslandState['builds']>[number] | undefined): -1 | 0 | 1 | 2 => {
    if (!b) return -1;
    const k = Math.min(2, Math.floor((3 * b.done) / Math.max(1, b.need) + 1e-9)) as 0 | 1 | 2;
    return b.finished !== undefined || b.done > 0 || (b === building && onSite) ? k : -1;
  };
  /** where the builders stand: the open build's sites, one each (up to 3) */
  const crewAt: Pt[] = [];
  for (const t of TIERS.filter((t) => t.n > s.tier)) {
    const b = (s.builds ?? []).find((x) => x.tier === t.n);
    const stage = Math.max(cons && cons.tier === t.n ? cons.stage : -1, buildStage(b)) as -1 | 0 | 1 | 2;
    const spots: Pt[][] = [];
    for (const a of t.adds) {
      if (a.id === 'p3') {
        flat.push(<DockSite key="dock" stage={stage} motion={motion} />);
        spots.push(DOCK_CREW);
        continue;
      }
      const kind = siteKind(a.model);
      if (!kind || !POS[a.id]) continue;
      if (stage < 0 && t.n > s.tier + 2) continue; // far future: nothing staked out yet
      const [x, y] = POS[a.id];
      items.push({ y, el: <Site key={`site${a.id}`} x={x} y={y} kind={kind} stage={stage} /> });
      spots.push(crewSpots(kind, x, y));
    }
    // one builder to each of the build's sites in turn
    if (b && b === building && onSite) for (let i = 0; i < 3; i++) if (spots.length) crewAt.push(spots[i % spots.length][Math.floor(i / spots.length)] ?? spots[0][0]);
  }
  // the extra cottages the analyst started: their plots in the grove (a finished one is a house above)
  for (const b of (s.builds ?? []).filter((x) => x.cottage && !s.assets.some((a) => a.id === x.cottage))) {
    const plot = PLOT[b.cottage!];
    if (!plot) continue;
    items.push({ y: plot[1], el: <Site key={`site${b.cottage}`} x={plot[0]} y={plot[1]} kind="house" stage={buildStage(b)} /> });
    if (b === building && onSite) crewAt.push(...crewSpots('house', plot[0], plot[1]));
  }
  if (s.tier >= 4) flat.push(<Dock key="dockbuilt" />);

  // ---- a poorly kept island: dry, patchy lawns, weeds and cracks along the
  // paths (the buildings fade, peel, lose roof planks and rust too)
  if (wear > 0.3) flat.push(<Worn key="worn" wear={wear} tier={s.tier} />);

  // ---- flourishes
  if (has('boardwalk')) flat.push(<Boardwalk key="bw" />);
  if (has('fishing-boats')) flat.push(<FishingBoats key="fb" />);
  if (has('yacht')) flat.push(<YachtAt key="yacht" />);
  if (has('garden')) items.push({ y: SPOT.garden[0][1], el: <GardenBeds key="garden" /> });
  if (has('benches')) {
    SPOT.benches.forEach(([x, y], i) => items.push({ y, el: <Bench key={`bn${i}`} x={x} y={y} flip={i % 2 === 1} /> }));
    SPOT.lamps.forEach(([x, y], i) => {
      items.push({ y, el: <Lamp key={`lp${i}`} x={x} y={y} /> });
      if ((night || storm) && pw.on) glows.push([x, y - 22, true]);
    });
  }
  if (has('beach-bar')) {
    items.push({ y: SPOT.bar[1], el: <BeachBar key="bar" closed={storm} /> });
    if (night && !storm && pw.on) glows.push([SPOT.bar[0] - 8, SPOT.bar[1] - 6, true], [SPOT.bar[0] + 8, SPOT.bar[1] - 6, true]);
  }
  // the square's furniture: better covered than a building, still kept clear where it can be
  if (has('fountain')) {
    items.push({ y: SPOT.fountain[1], el: <Fountain key="fountain" motion={motion} /> });
    keep.push({ r: footAt(SPOT.fountain, FOOT.fountain), w: 0.4 });
  }
  if (has('market')) {
    items.push({ y: SPOT.market[0][1], el: <Market key="market" closed={storm} /> });
    SPOT.market.forEach((m) => keep.push({ r: footAt(m, FOOT.stall), w: 0.4 }));
  }
  if (has('lighthouse')) items.push({ y: SPOT.lighthouse[1], el: <Lighthouse key="lh" /> });
  if (has('observatory')) items.push({ y: SPOT.observatory[1], el: <Observatory key="obs" /> });
  if (has('statue')) {
    items.push({ y: SPOT.statue[1], el: <Statue key="statue" /> });
    keep.push({ r: footAt(SPOT.statue, FOOT.statue), w: 0.5 });
  }
  // the finale: festoon lights from lamp to lamp over the square and the bridge path
  const festoon = has('statue') && has('benches');

  // ---- the staff at work (docs/JOBFLOW.md 15.10): builders on the site they work, a pilot by the lead guest plane
  // and one by the cargo plane, a housekeeper at a booked house; up to 8, none in a storm or at night (then one
  // figure works late at the office window)
  if (!storm && !night) {
    builders.slice(0, 3).forEach((_, i) => {
      const p = crewAt[i];
      if (p) items.push({ y: p[1], el: <NpcFigure key={`bld${i}`} kind="builder" x={p[0]} y={p[1]} flip={i % 2 === 1} motion={motion} /> });
    });
    const seats = pilotSeats(s);
    const lead = planes.find((p) => !MODELS_CARGO(p) && !isDown(p) && !tagged(p) && (seats.get(p.id) ?? []).length);
    const cargo = planes.find((p) => MODELS_CARGO(p) && !isDown(p) && !tagged(p) && (seats.get(p.id) ?? []).length);
    for (const p of [lead, cargo]) {
      if (!p || p.model === 'float') continue;
      const { x, y } = spotOf(p.id);
      items.push({ y: y + 14, el: <NpcFigure key={`plt${p.id}`} kind="pilot" x={x - 24} y={y + 14} /> });
    }
    const keepers = working(s).filter((n) => n.role === 'housekeeper').length;
    rentable
      .slice()
      .sort((a, b) => b.health - a.health)
      .slice(0, Math.min(2, keepers))
      .forEach((h, i) => {
        const [x, y] = at(h.id) ?? [0, 0];
        const g = houseGeo(h);
        items.push({ y: y + 6, el: <NpcFigure key={`hk${h.id}`} kind="keeper" x={x + g.w * g.k + 6} y={y + 6} flip={i % 2 === 1} /> });
      });
  } else if (night && pw.on) litFigure = true;

  // ---- people: busier with prosperity, guests walking when houses are booked
  const pr = dev.prosperity;
  const shirts = [K.pink, K.blue, K.yellow, '#4caf50', K.purple, K.orange, '#fff'];
  // everyone heads indoors when a storm hits
  SQUARE_PEOPLE.slice(0, storm ? 0 : 1 + Math.round(pr * 5)).forEach(([x, y], i) => items.push({ y, el: <Guy key={`sq${i}`} x={x} y={y} c={shirts[i % shirts.length]} /> }));
  const beachN = storm ? 0 : Math.round(pr * 6);
  BEACH_TOWELS.slice(0, beachN).forEach(([x, y], i) => flat.push(<use key={`tw${i}`} href="#i-towel" transform={`translate(${x} ${y})`} style={{ color: shirts[(i + 2) % shirts.length] }} />));
  SWIMMERS.slice(0, storm ? 0 : Math.round(pr * 4)).forEach(([x, y], i) => flat.push(<use key={`sw${i}`} href="#i-swim" transform={`translate(${x} ${y})`} style={{ color: shirts[(i + 4) % shirts.length] }} />));

  items.sort((a, b) => a.y - b.y);

  // ---- wires (drawn over roofs, as overhead lines are)
  const live: string[] = []; // carrying power
  const idle: string[] = []; // energised-looking but unused (the generator on standby)
  const dead: string[] = []; // no power: dark and drooping
  // service drops to the houses: thinner and lighter than the trunk spans
  const liveDrops: string[] = [];
  const deadDrops: string[] = [];
  const droop = (a: Pt, b: Pt, k: number) => sag(a, b, k * 1.9);
  const put = (on: boolean, a: Pt, b: Pt, k = 0.12) => (on ? live.push(sag(a, b, k)) : dead.push(droop(a, b, k)));
  const bushing = add(at('g1'), [1, -24]);
  if (grid && !pw.gridDown) {
    live.push(sag(bushing, poleTop('Q'), 0.05), sag(poleTop('Q'), poleTop('S'), 0.08));
  } else if (grid) dead.push(droop(poleTop('Q', Q_LEAN), poleTop('S'), 0.08));
  if (gen && POLES.S) {
    const from = add(at('gen'), [-4, -31]); // the insulator on the roof's west end
    (carrying ? live : pw.gridDown ? dead : idle).push(sag(from, poleTop('S'), 0.06));
  }
  for (const [a, b] of SPANS) {
    if (POLES[a].tier > s.tier || POLES[b].tier > s.tier) continue;
    put(pw.on, poleTop(a), poleTop(b));
  }
  for (const h of houses) {
    const k = FEED[h.id];
    if (!k || POLES[k].tier > s.tier) continue;
    const g = houseGeo(h);
    const [x, y] = at(h.id);
    const side = POLES[k].at[0] < x ? -1 : 1;
    // each drop meets the wall that faces its pole, just under the eaves (the
    // east gable end, or the west end of the front), never across a roof; the
    // lodge takes its drop low on its east side, and the villas (their pole
    // stands behind them) at the back, where it drops behind the roof
    const m = modelOf(h);
    const local: [number, number, number] = m === 'lodge' ? [g.w, 9, 3] : m === 'villa' ? [side * (g.w - 10), g.h, g.d + 5] : side > 0 ? [g.w, g.h - 4, g.d * 0.3] : [-g.w, g.h - 4, 0];
    const [lx, ly] = P(local);
    const drop: Pt = [Math.round((x + lx * g.k) * 10) / 10, Math.round((y + ly * g.k) * 10) / 10];
    if (pw.on) liveDrops.push(sag(poleTop(k), drop, 0.06));
    else deadDrops.push(droop(poleTop(k), drop, 0.06));
  }

  // ---- bubbles: above their asset, never on each other, on other assets or
  // on the runway, and always inside the (zoomed) view
  spread(bubbles, keep, viewOf(z));

  return (
    <svg
      ref={svgRef}
      class={`island-svg${still ? ' still' : ''}${s.weather !== 'clear' ? ' windy' : ''}`}
      viewBox={`0 0 ${W} ${H}`}
      role={onCart ? 'group' : 'img'}
      aria-label={describe(s, pw, rentable.length, dev)}
      onClick={onTap}
    >
      {defs}
      <g class="island-zoom" style={{ transform: zoomOf(z) }}>
        {ground}
        {sea}
        {flat}
        {float && (
          <g>
            <Plane model="float" x={spotOf(float.id).x} y={spotOf(float.id).y} rot={PLANE_ROT.p3} mood={dev.care} size={PLANE_SIZE.p3} service={isDown(float)} />
            {tagged(float) && <path d={`M${DOCK.head[2] - 4} ${DOCK.head[1] + 2}q-6 -8 -${DOCK.head[2] - 4 - spotOf(float.id).x - 6} -14`} stroke="#e8d8b0" stroke-width="1.6" fill="none" />}
            {newIds.has('p3') && <Ribbon x={spotOf(float.id).x} y={spotOf(float.id).y - 8} />}
            {newIds.has('p3') && <NewBadge x={spotOf(float.id).x + 34} y={spotOf(float.id).y - 4} scale={bscale} motion={motion} />}
          </g>
        )}
        {items.map((it) => it.el)}
        {/* overhead lines */}
        <g fill="none" stroke-linecap="round">
          {dead.length > 0 && <path d={dead.join('')} stroke="#3a4046" stroke-width="1.3" opacity=".85" />}
          {idle.length > 0 && <path d={idle.join('')} stroke="#2f3438" stroke-width="1.2" opacity=".7" />}
          {live.length > 0 && <path d={live.join('')} stroke="#2f3438" stroke-width="1.4" opacity=".9" />}
          {live.length > 0 && <path d={live.join('')} stroke={carrying ? '#fff27a' : K.yellow} stroke-width={carrying ? 1.1 : 0.7} class={motion && grid && grid.health < 60 && !pw.gridDown ? 'flicker' : undefined} opacity=".95" />}
          {deadDrops.length > 0 && <path d={deadDrops.join('')} stroke="#3a4046" stroke-width=".9" opacity=".7" />}
          {liveDrops.length > 0 && <path d={liveDrops.join('')} stroke="#2f3438" stroke-width=".9" opacity=".7" />}
          {liveDrops.length > 0 && <path d={liveDrops.join('')} stroke={carrying ? '#fff27a' : K.yellow} stroke-width=".45" opacity=".85" />}
          {pw.gridDown && grid && <BrokenFeed from={bushing} />}
        </g>
        {dev.celebration && <Confetti motion={motion} />}
        {has('bunting') && <Bunting motion={motion} />}
        {festoon && <Festoon />}
        {flying && (
          <g class={motion ? 'flyby' : undefined} transform={motion ? undefined : FLY_STILL} style={motion ? FLY_DELAY : undefined}>
            <FlyingPlane />
          </g>
        )}
        {booked > 0 && !storm && <Walkers n={Math.min(2, booked)} motion={motion} />}
        {!storm && sky}
        {/* the light of the hour */}
        {grade}
        {storm && sky}
        {stars}
        {/* light sources stay bright over the grade */}
        {pw.gridDown && grid && <Sparks from={bushing} motion={motion} night={night} />}
        {night && carrying && <circle cx={at('gen')[0] + 10.7} cy={at('gen')[1] - 26} r={7} fill="#6dff8e" opacity=".45" />}
        {storm && !night && (glows.length > 0 || litWins.length > 0) && <Lights pts={glows} wins={litWins.join('')} o={0.6} />}
        {night && (
          <g pointer-events="none">
            {/* the airfield runs off the grid: the hangar spills warm light and
                two floodlights pool on the apron, so the planes read */}
            {pw.on && <ApronLights hangar={HANGAR} open={aog.some((p) => p.id === 'p1')} />}
            <Lights pts={has('bunting') ? [...glows, ...buntingBulbs().map(([x, y]): [number, number, boolean] => [x, y, true])] : glows} wins={litWins.join('')} />
            {/* every lit window, crisp over the grade */}
            {litWins.length > 0 && <path d={litWins.join('')} fill={K.lit} stroke="#f0a848" stroke-width=".7" />}
            {litFigure && officeWin === 'lit' && <OfficeLate x={OFFICE[0] - 21} y={OFFICE[1] - 3} />}
            {has('lighthouse') && <Beam motion={motion} />}
            {has('observatory') && <Observatory lit />}
            {has('statue') && <Statue lit />}
            {s.tier >= 5 && pw.on && <RunwayLights night glowOnly />}
            {festoon && <Festoon lit />}
            {has('yacht') && !storm && <YachtLights />}
            {/* the ground power carts' charge lights */}
            {cartLamps.length > 0 && cartLamps.map(([x, y, c], i) => <circle key={`cl${i}`} cx={x} cy={y} r={1.8} fill={c} />)}
            {/* the grid is up: a green lamp on the substation's cabinet */}
            {grid && !pw.gridDown && <circle cx={at('g1')[0] + 11} cy={at('g1')[1] - 17} r={2.2} fill="#7dff9a" />}
            {/* navigation lights on the night flight */}
            {flying && (
              <g class={motion ? 'flyby' : undefined} transform={motion ? undefined : FLY_STILL} style={motion ? FLY_DELAY : undefined}>
                <NavLights />
              </g>
            )}
            {dev.celebration && !storm && <Fireworks />}
          </g>
        )}
        {badges.map(([x, y], i) => (
          <NewBadge key={i} x={x} y={y} scale={bscale} motion={motion} />
        ))}
        {/* notification bubbles, above everything so they read at night */}
        {bubbles
          .sort((a, b) => a.y + a.dy - (b.y + b.dy))
          .map((b, i) => (
            <Bubble key={b.key} x={b.x} y={b.y} dx={b.dx} dy={b.dy} icon={b.icon} tone={b.tone} small={b.small} scale={bscale} motion={motion} delay={(i * 0.37) % 1.6} count={b.count} />
          ))}
      </g>
      {storm && <Rain motion={motion} />}
      {s.weather === 'wind' && <Wind motion={motion} />}
    </svg>
  );
}

// ---------------------------------------------------------------- bits ---
/** the fly-by parks over the open sea off the north-east point when motion is
 *  off (its shadow falls on water, clear of every flourish); running, it
 *  is already in view on arrival, coming in over the south-west beach */
const FLY_STILL = 'translate(700 44) rotate(-24)';
const FLY_DELAY = { animationDelay: '-1.2s' };
/** red and green wingtips, a white tail light and a strobe (FlyingPlane's frame) */
function NavLights() {
  return (
    <g>
      <circle cx={2.2} cy={-19} r={4} fill="#ff5a4a" opacity=".35" />
      <circle cx={2.2} cy={19} r={4} fill="#5aff8a" opacity=".35" />
      <circle cx={2.2} cy={-19} r={1.6} fill="#ff6b5e" />
      <circle cx={2.2} cy={19} r={1.6} fill="#7dff9a" />
      <circle cx={-22.5} cy={0} r={1.5} fill="#fff" />
      <circle cx={4} cy={0} r={1.3} fill="#fff8d8" />
    </g>
  );
}

const At = ({ p, children }: { p: Pt; children: JSX.Element }) => <g transform={`translate(${p[0]} ${p[1]})`}>{children}</g>;

/** Every light's glow in a handful of nodes: each lit window gets a soft halo
 *  that follows its own shape (a wide stroke on the windows' merged path), and
 *  the point lights (lamps, bulbs) a round one, stacked soft to bright. */
function Lights({ pts, wins, o }: { pts: [number, number, boolean][]; wins: string; o?: number }) {
  const all = pts.map(([x, y]) => `M${Math.round(x * 10) / 10} ${Math.round(y * 10) / 10}h.01`).join('');
  const bulbs = pts.filter((p) => p[2]).map(([x, y]) => `M${Math.round(x * 10) / 10} ${Math.round(y * 10) / 10}h.01`).join('');
  return (
    <g pointer-events="none" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity={o}>
      {wins && <path d={wins} stroke="#ffc861" stroke-width="10" opacity=".22" />}
      {wins && <path d={wins} stroke="#ffe0a0" stroke-width="4.5" opacity=".45" />}
      {all && <path d={all} stroke="#ffb347" stroke-width="22" opacity=".16" />}
      {all && <path d={all} stroke="#ffd27a" stroke-width="12" opacity=".3" />}
      {bulbs && <path d={bulbs} stroke="#fff3c0" stroke-width="4" opacity=".95" />}
    </g>
  );
}
const SQUARE_PEOPLE: Pt[] = [[396, 318], [444, 314], [402, 346], [446, 350], [378, 336], [466, 334], [424, 356]];
const BEACH_TOWELS: Pt[] = [[212, 536], [410, 536], [566, 524], [612, 516], [160, 522], [654, 508]];
const SWIMMERS: Pt[] = [[250, 560], [410, 558], [580, 552], [650, 540]];

const DRY: [number, number, number, number][] = [[330, 262, 26, 9], [470, 250, 18, 7], [210, 398, 22, 7], [150, 206, 30, 8], [722, 330, 14, 8], [560, 252, 18, 6]];
const r1 = (n: number) => Math.round(n * 10) / 10;
/** weeds pushing up along the path edges, and cracks in the path itself */
function pathWear(tier: number) {
  let weeds = '', cracks = '';
  PATHS.filter((p) => p.tier <= tier && !p.steps && p.pts.length > 2).forEach((p, pi) => {
    const len = p.pts.slice(1).reduce((n, q, i) => n + Math.hypot(q[0] - p.pts[i][0], q[1] - p.pts[i][1]), 0);
    const n = Math.floor(len / 34);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const [x, y] = along(p.pts, t);
      const [x2, y2] = along(p.pts, Math.min(1, t + 0.01));
      const l = Math.hypot(x2 - x, y2 - y) || 1;
      const nx = -(y2 - y) / l, ny = (x2 - x) / l; // across the path
      const side = (i + pi) % 2 ? 1 : -1, off = ((p.w ?? 12) / 2 + 0.5) * side;
      const wx = x + nx * off, wy = y + ny * off;
      weeds += `M${r1(wx - 2.4)} ${r1(wy)}q0 -3 -2 -5M${r1(wx)} ${r1(wy)}q.4 -4 2 -6M${r1(wx + 2)} ${r1(wy)}q1.4 -2 3.4 -3`;
      if (i % 2 === 0) cracks += `M${r1(x - nx * 3)} ${r1(y - ny * 3)}l${r1(nx * 2.2 + 1.2)} ${r1(ny * 2.2 - 0.6)}l${r1(nx * 1.8 - 1)} ${r1(ny * 1.8 + 0.8)}l${r1(nx * 2.2 + 0.8)} ${r1(ny * 2.2)}`;
    }
  });
  return { weeds, cracks };
}
function Worn({ wear, tier }: { wear: number; tier: number }) {
  const { weeds, cracks } = pathWear(tier);
  return (
    <g opacity={Math.min(0.9, 0.35 + wear * 0.9)}>
      <path d={DRY.map(([x, y, rx, ry], i) => curve(blob(x, y, rx, ry, i * 7 + 3, 7, 0.3))).join('')} fill="#c2b35e" />
      <path d={DRY.map(([x, y, rx], i) => `M${x - rx * 0.4} ${y + 2}l-2 -6M${x - rx * 0.3} ${y + 2}l2 -7M${x + rx * 0.3} ${y}l1 -6M${x + rx * 0.36} ${y}l-3 -5` + (i % 2 ? '' : `M${x} ${y - 3}l-1 -5`)).join('')} stroke="#8a7a3a" stroke-width="1.3" fill="none" />
      <path d={cracks} stroke="#7d5a34" stroke-width="1.1" fill="none" stroke-linejoin="round" opacity=".75" />
      <path d={weeds} stroke="#5f8f2e" stroke-width="1.4" fill="none" stroke-linecap="round" />
    </g>
  );
}

/** grid down: the feed from the substation has snapped; both ends dangle... */
const sparkEnds = (from: Pt): Pt[] => {
  const [bx, by] = poleTop('Q', Q_LEAN);
  return [[from[0] + 10, from[1] + 26], [bx - 2, by + 34]];
};
function BrokenFeed({ from }: { from: Pt }) {
  const [ax, ay] = from;
  const [bx, by] = poleTop('Q', Q_LEAN);
  const [end, end2] = sparkEnds(from);
  return <path d={`M${ax} ${ay}Q${ax + 6} ${ay + 14} ${end[0]} ${end[1]}M${bx} ${by}Q${bx - 4} ${by + 20} ${end2[0]} ${end2[1]}`} stroke="#3a4046" stroke-width="1.4" />;
}
/** ...and spark, with the substation's alarm light */
function Sparks({ from, motion, night }: { from: Pt; motion: boolean; night: boolean }) {
  const [ax, ay] = POS.g1;
  return (
    <g pointer-events="none">
      {night && <circle cx={ax + 11} cy={ay - 17} r={7} fill="#ff3b30" opacity=".4" />}
      {sparkEnds(from).map(([x, y], i) => (
        <g key={i} transform={`translate(${x} ${y})`}>
          <circle r={7} fill="#fff3a0" opacity=".35" />
          <g class={motion ? 'spark' : undefined}>
            <path d="M0 0l-8 -9M0 0l9 -7M0 0l2 10M0 0l-9 4M0 0l6 7M0 0l1 -11" stroke="#fffbe0" stroke-width="2.4" stroke-linecap="round" />
            <path d="M0 0l-8 -9M0 0l9 -7M0 0l2 10M0 0l-9 4" stroke="#ffc400" stroke-width="1.1" stroke-linecap="round" />
            <circle r={2.6} fill="#fff" />
          </g>
        </g>
      ))}
    </g>
  );
}

function RunwayLights({ night, glowOnly }: { night: boolean; glowOnly?: boolean }) {
  const L = RUNWAY_LEN, w = RUNWAY.w;
  const n = 11;
  const d = Array.from({ length: n }, (_, i) => {
    const x = -L / 2 + 4 + (i * (L - 8)) / (n - 1);
    return `M${x.toFixed(1)} ${-w / 2 - 3}h.1M${x.toFixed(1)} ${w / 2 + 3}h.1`;
  }).join('');
  const ends = `M${-L / 2 - 3} -12v24M${L / 2 + 3} -12v24`;
  return (
    <g transform={`translate(${RUNWAY_C[0].toFixed(1)} ${RUNWAY_C[1].toFixed(1)}) rotate(${RUNWAY_ANGLE.toFixed(1)})`} fill="none" stroke-linecap="round">
      {glowOnly && <path d={d} stroke="#ffe08a" stroke-width="8" opacity=".35" />}
      <path d={d} stroke={night ? '#fff6c8' : '#e8e4d8'} stroke-width={glowOnly ? 3.4 : 2.6} />
      <path d={ends} stroke={night ? '#7dff9a' : '#9fcfa8'} stroke-width="2.4" stroke-dasharray=".1 4" />
    </g>
  );
}

function Beam({ motion }: { motion: boolean }) {
  const [x, y] = SPOT.lighthouse;
  return (
    <g transform={`translate(${x} ${y - 56})`}>
      {/* it sweeps the open sea (west and north) and goes dark over the lagoon and the island */}
      <g class={motion ? 'beam' : undefined} transform={motion ? undefined : 'rotate(205)'}>
        <path d="M0 0L150 -26L150 26Z" fill="url(#i-beam)" />
      </g>
      <circle r={9} fill="url(#i-glow)" />
    </g>
  );
}

function Walkers({ n, motion }: { n: number; motion: boolean }) {
  if (!motion)
    return (
      <g>
        <Guy x={566} y={306} c={K.pink} />
        {n > 1 && <Guy x={346} y={326} c={K.blue} />}
      </g>
    );
  return (
    <g>
      <g class="walk-a">
        <Guy x={0} y={0} c={K.pink} />
      </g>
      {n > 1 && (
        <g class="walk-b">
          <Guy x={0} y={0} c={K.blue} />
        </g>
      )}
    </g>
  );
}

const FLOURISH_WORDS: Record<Flourish, string> = {
  garden: 'flower beds',
  benches: 'benches and lamps',
  'palm-grove': 'a young palm grove',
  'fishing-boats': 'fishing boats',
  'beach-bar': 'a beach bar',
  'paved-paths': 'paved paths',
  fountain: 'a fountain',
  market: 'market stalls',
  lighthouse: 'a lighthouse',
  boardwalk: 'a boardwalk',
  yacht: 'a visiting yacht',
  observatory: 'an observatory',
  bunting: 'festive bunting',
  statue: 'the crew statue',
};

function describe(s: IslandState, pw: ReturnType<typeof powered>, open: number, dev: Development) {
  const tierName = TIERS[s.tier - 1]?.name ?? '';
  const planes = s.assets.filter((a) => a.kind === 'plane');
  const houses = s.assets.filter((a) => a.kind === 'house');
  const pl = planes.map((p) => `${p.name} ${p.health < 40 ? 'AOG' : isAog(s, p.id) ? 'AOG for a part' : s.tags?.[p.id] ? 'grounded' : p.health < 60 ? 'needs attention' : 'flying'}`);
  const closed = houses.filter((h) => !houseRentable(s, h)).map((h) => `${h.name} closed (${houseBlocker(s, h)})`);
  const c = dev.construction;
  const building = c && c.stage < 3 ? `construction under way for tier ${c.tier} ${TIERS[c.tier - 1]?.name ?? ''}: ${c.stage} of 3 parts done` : '';
  const fl = dev.flourishes.map((f) => FLOURISH_WORDS[f]);
  const parts = [
    `${s.name}, tier ${s.tier} ${tierName}`,
    `${planes.length} plane${planes.length === 1 ? '' : 's'}: ${pl.join(', ')}`,
    `${open} of ${houses.length} houses open${closed.length ? ': ' + closed.join(', ') : ''}`,
    !pw.on ? 'no power on the island' : pw.gridDown ? 'grid down, generator carrying the load' : 'grid up',
    s.cash < 2000 ? 'cash alarm' : '',
    gseCarts(s)
      .map((c) => `${c.name} ${c.hookedTo ? `hooked up to ${s.assets.find((a) => a.id === c.hookedTo)?.name ?? 'a plane'}` : c.charging ? 'on charge' : 'parked'}, ${Math.round(c.charge)}%`)
      .join(', '),
    s.weather !== 'clear' ? s.weather : '',
    building,
    dev.justBuilt ? `tier ${dev.justBuilt} just arrived` : '',
    fl.length ? `the island has developed ${fl.length > 1 ? fl.slice(0, -1).join(', ') + ' and ' + fl[fl.length - 1] : fl[0]}` : 'nothing extra developed yet',
  ];
  return parts.filter(Boolean).join('. ') + '.';
}
