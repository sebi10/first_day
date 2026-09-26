// The island is the progress bar and the status board: a cartoon map that
// grows tier by tier (and week by week, src/sim/growth.ts), with notification
// bubbles above whatever needs a hand, and every fault drawn on the asset
// itself. Layers, bottom to top: memoized terrain, sea life, flat props,
// y-sorted buildings/planes/people, wires, sky, the light of the hour,
// bubbles; rain and wind streaks sit outside the zoom.
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { COSMETICS, TIERS } from '../sim/data';
import { houseBlocker, houseRentable, planeCapacity, powered } from '../sim/econ';
import { developmentOf, type Development, type Flourish } from '../sim/growth';
import type { Asset, IslandState, Role } from '../sim/types';
import { Cottage, GenHouse, Hangar, Lodge, Office, Pole, POLE_H, Ribbon, Substation, Villa, type Fault, type Win } from './island/buildings';
import { FlyingPlane, Plane, type PlaneModel } from './island/craft';
import {
  ApronProps, BeachBar, Bench, Boardwalk, Confetti, Dock, FishingBoats, Fountain, GardenBeds, Grove, Lamp, Lighthouse, Market, NewFlags, Observatory, Statue,
  Bunting, buntingBulbs, YachtAt,
} from './island/extras';
import { AOG_SPOT, curve, DOCK, focusBox, H, HANGAR, OFFICE, P, POS, RUNWAY, RUNWAY_ANGLE, RUNWAY_C, RUNWAY_LEN, SPOT, viewOf, W, zoomK, zoomOf, type Pt } from './island/geo';
import { blob } from './island/rocks';
import { Clouds, DawnGrade, GoldenGrade, Gulls, Guy, LifeDefs, NightGrade, NightSky, Rain, SeaLife, StormGrade, Wind } from './island/life';
import { K } from './island/paint';
import { DockSite, Site, type SiteKind } from './island/sites';
import { Bubble, bubbleK, NewBadge, spread, type Icon, type KeepOut, type Rect, type Tone } from './island/status';
import { COAST_LINE, Terrain, TerrainDefs } from './island/terrain';

type Phase = 'dawn' | 'day' | 'golden' | 'night';
export const phaseOf = (d = new Date()): Phase => {
  const h = d.getHours();
  return h >= 5 && h < 8 ? 'dawn' : h >= 8 && h < 17 ? 'day' : h >= 17 && h < 20 ? 'golden' : 'night';
};

const cosmeticColor = (role: Role, id: string | undefined) => COSMETICS[role].find((c) => c.id === id)?.color ?? COSMETICS[role][0].color;
const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];

// house geometry, for bubbles, wires and window glows
const HOUSE = {
  cottage: { top: 42, w: 20, h: 18, d: 26, glow: [[0, -9, 22]] },
  villa: { top: 54, w: 28, h: 30, d: 30, glow: [[-10, -22, 22], [10, -9, 22]] },
  lodge: { top: 66, w: 30, h: 20, d: 40, glow: [[0, -30, 20], [-48, -8, 16]] },
} as const;
const houseGeo = (a: Asset) => HOUSE[(a.model as keyof typeof HOUSE) in HOUSE ? (a.model as keyof typeof HOUSE) : 'cottage'];

// Power: the substation feeds its own pole Q on the west bank; the line
// crosses the river to the junction S, then runs up the east bank and along
// the cottage spine. The generator (tier 3) feeds S directly.
const POLES: Record<string, { at: Pt; tier: number }> = {
  Q: { at: [488, 372], tier: 1 },
  S: { at: [548, 406], tier: 1 },
  A: { at: [554, 320], tier: 1 },
  C: { at: [636, 318], tier: 1 },
  D: { at: [640, 366], tier: 2 },
  E: { at: [644, 418], tier: 4 },
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

const siteKind = (model: string): SiteKind | null =>
  model === 'cottage' ? 'house' : model === 'villa' ? 'villa' : model === 'lodge' ? 'lodge' : model === 'gen' ? 'gen' : null;

/** the runway's markings: bubbles are pushed off it */
const RUNWAY_BOX: Rect = [RUNWAY.a[0] - 6, Math.min(RUNWAY.a[1], RUNWAY.b[1]) - RUNWAY.w / 2 - 4, RUNWAY.b[0] + 6, Math.max(RUNWAY.a[1], RUNWAY.b[1]) + RUNWAY.w / 2 + 4];

type Item = { y: number; el: JSX.Element };
type Bub = { x: number; y: number; k: number; dx: number; dy: number; icon: Icon; tone: Tone; small?: boolean; key: string; owner: string; fixed?: boolean };

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
  statue: [-16, -44, 16, 4],
} satisfies Record<string, Rect>;
const footAt = (p: Pt, f: Rect): Rect => [p[0] + f[0], p[1] + f[1], p[0] + f[2], p[1] + f[3]];

export function Island({
  s,
  focus,
  onTap,
  reduceMotion,
  phase: phaseProp,
}: {
  s: IslandState;
  focus: Role | null;
  onTap?: () => void;
  reduceMotion: boolean;
  phase?: Phase;
}) {
  const phase = phaseProp ?? phaseOf();
  const motion = !reduceMotion;
  const svgRef = useRef<SVGSVGElement>(null);
  const still = useStill(svgRef);
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
  const newIds = new Set(dev.justBuilt ? TIERS[dev.justBuilt - 1].adds.map((a) => a.id) : []);
  const paved = has('paved-paths');
  const carrying = pw.gridDown && pw.genOK;

  // static layers, rendered once per combination that changes them
  const defs = useMemo(
    () => (
      <defs>
        <TerrainDefs />
        <LifeDefs />
      </defs>
    ),
    [],
  );
  const grove = has('palm-grove');
  const ground = useMemo(
    () => <Terrain tier={s.tier} weather={s.weather} motion={motion} paved={paved} night={night} grove={grove} />,
    [s.tier, s.weather, motion, paved, night, grove],
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
      night ? <NightGrade coast={COAST_LINE} /> : storm ? <StormGrade /> : phase === 'dawn' ? <DawnGrade /> : phase === 'golden' ? <GoldenGrade /> : null,
    [night, storm, phase],
  );
  // no moon or stars behind a storm's cloud deck
  const stars = useMemo(() => (night && !storm ? <NightSky motion={motion} /> : null), [night, storm, motion]);

  const items: Item[] = [];
  const flat: JSX.Element[] = [];
  const glows: [number, number, number][] = [];
  const bubbles: Bub[] = [];
  const badges: Pt[] = [];
  const keep: KeepOut[] = [{ r: RUNWAY_BOX }];
  const foot = (owner: string, p: Pt, f: Rect) => keep.push({ owner, r: footAt(p, f) });
  const bub = (key: string, x: number, y: number, icon: Icon, tone: Tone, o: { small?: boolean; dx?: number; dy?: number; owner?: string; fixed?: boolean } = {}) =>
    bubbles.push({ key, x, y, k: bubbleK(bscale, o.small), dx: (o.dx ?? 0) * bscale, dy: (o.dy ?? 0) * bscale, icon, tone, small: o.small, owner: o.owner ?? key, fixed: o.fixed });
  const at = (id: string) => POS[id];

  // ---- airfield: every plane has its own stand and its own AOG spot
  const aog = planes.filter((p) => p.health < 40);
  items.push({ y: HANGAR[1], el: <At key="hangar" p={HANGAR}><Hangar tint={hangarColor} wear={wear} doorOpen={aog.some((p) => p.id === 'p1')} /></At> });
  foot('hangar', HANGAR, FOOT.hangar);
  const spots = unclutter(planes.map((p) => ({ id: p.id, x: (p.health < 40 ? AOG_SPOT[p.id] ?? POS[p.id] : POS[p.id] ?? POS.p1)[0], y: (p.health < 40 ? AOG_SPOT[p.id] ?? POS[p.id] : POS[p.id] ?? POS.p1)[1] })));
  const spotOf = (id: string) => spots.find((q) => q.id === id)!;
  const float = planes.find((p) => p.model === 'float');
  for (const p of planes) {
    const { x, y } = spotOf(p.id);
    const down = p.health < 40;
    const g = tagged(p);
    const onWater = p.model === 'float';
    // the floatplane sits on the water, drawn with the dock below the y-sorted things
    if (!onWater) items.push({ y, el: <Plane key={p.id} model={p.model as PlaneModel} x={x} y={y} rot={PLANE_ROT[p.id] ?? 92} jacks={down} chocks={g} covered={storm && !down} mood={dev.care} /> });
    foot(p.id, [x, y], onWater ? FOOT.float : FOOT.plane);
    if (down) {
      const mech: Pt = onWater ? [DOCK.head[2] - 22, DOCK.head[1] + 9] : [x + 22, y + 12];
      items.push({ y: mech[1], el: <Guy key={`mech${p.id}`} x={mech[0]} y={mech[1]} c={K.orange} /> });
      if (onWater) items.push({ y: DOCK.head[3], el: <path key="kit" d={`M${DOCK.head[2] - 40} ${DOCK.head[3] - 2}h9v-5h-9zM${DOCK.head[2] - 39} ${DOCK.head[3] - 7}v-2h7v2`} fill={K.red} stroke="#8a2a22" stroke-width=".8" /> });
      // the twin is on jacks just out of the hangar mouth: its bubble sits on
      // the apron beside it, tail to the wing, so it reads "plane", not "hangar"
      if (p.id === 'p1' && !onWater) bub(p.id, x - 32, y - 2, 'wrench', 'alert', { dx: -36, dy: 12, fixed: true });
      else bub(p.id, x, y - (onWater ? 20 : 26), 'wrench', 'alert');
    } else if (g) bub(p.id, x, y - 22, 'cone', 'alert');
    else if (p.health < 60) bub(p.id, x, y - 22, 'warn', 'warn');
    if (newIds.has(p.id) && !onWater) {
      items.push({ y: y + 1, el: <Ribbon key={`rb${p.id}`} x={x} y={y - 6} /> });
      badges.push([x - 30, y - 12]);
    }
  }
  flat.push(<ApronProps key="apron" />);
  if (s.tier >= 5) flat.push(<RunwayLights key="rwl" night={night} />);

  // ---- office and the square
  const officeWin: Win = !pw.on ? 'dark' : warm ? 'lit' : 'glass';
  items.push({ y: OFFICE[1], el: <At key="office" p={OFFICE}><Office tint={officeColor} win={officeWin} wear={wear} flag={officeColor} motion={motion} /></At> });
  foot('office', OFFICE, FOOT.office);
  if (pw.on && (night || storm)) glows.push([OFFICE[0], OFFICE[1] - 12, 26], [OFFICE[0], OFFICE[1] - 28, 26]);
  if (s.cash < 2000) bub('cash', OFFICE[0] - 20, OFFICE[1] - 52, 'cash', 'alert', { owner: 'office' });

  // ---- grid: substation, poles, wires
  if (grid) {
    items.push({ y: at('g1')[1], el: <At key="g1" p={at('g1')}><Substation wear={wear} down={pw.gridDown} motion={motion} /></At> });
    foot('g1', at('g1'), FOOT.g1);
    // grid down says "power", not "repair": a struck-through bolt. The body
    // leans east over the river bank, off the square's stalls and fountain.
    if (pw.gridDown) bub('g1', at('g1')[0] + 4, at('g1')[1] - 26, 'bolt-off', 'alert', { dx: 30 });
    else if (grid.health < 60) bub('g1', at('g1')[0] + 4, at('g1')[1] - 26, 'warn', 'warn', { dx: 30 });
  }
  const poles = Object.entries(POLES).filter(([, p]) => p.tier <= s.tier);
  for (const [k, p] of poles) items.push({ y: p.at[1], el: <Pole key={`pole${k}`} x={p.at[0]} y={p.at[1]} lean={k === 'Q' && pw.gridDown ? Q_LEAN : 0} /> });

  // ---- generator
  if (gen) {
    const [x, y] = at('gen');
    const standby = !carrying && (night || storm);
    items.push({ y, el: <At key="gen" p={[x, y]}><GenHouse wear={wear} running={carrying} motion={motion} lamp={standby} /></At> });
    foot('gen', [x, y], FOOT.gen);
    // west of the stack, so the exhaust stays in view. Carrying the island is
    // good news, so it gets the green "running" tone, not the warning yellow.
    if (gen.health < 50) bub('gen', x - 10, y - 28, pw.gridDown ? 'wrench' : 'warn', pw.gridDown ? 'alert' : 'warn', { dx: -24 });
    else if (carrying) bub('gen', x - 10, y - 28, 'bolt', 'ok', { small: true, dx: -24 });
    if (carrying && night) glows.push([x - 3, y - 29, 13]);
    if (standby) glows.push([x - 9.5, y - 13, 11]);
    if (newIds.has('gen')) {
      items.push({ y: y + 1, el: <Ribbon key="rbgen" x={x - 4} y={y - 6} /> });
      items.push({ y: y + 2, el: <NewFlags key="nfgen" x={x + 2} y={y - 26} w={46} /> });
      badges.push([x - 30, y - 30]);
    }
  }

  // ---- houses: open, or showing what is wrong on the building itself
  for (const h of houses) {
    const [x, y] = at(h.id) ?? [0, 0];
    const g = houseGeo(h);
    const open = houseRentable(s, h);
    const why = houseBlocker(s, h);
    const fault: Fault = { tag: why === 'red-tagged', damaged: h.health < 40, lapsed: (h.inspectionUntil ?? 0) < s.week };
    const win: Win = !pw.on ? 'dark' : open ? (warm ? 'lit' : 'glass') : 'shut';
    const props = { tint: houseColor, win, wear, open, fault };
    const el = h.model === 'villa' ? <Villa {...props} /> : h.model === 'lodge' ? <Lodge {...props} /> : <Cottage {...props} />;
    items.push({ y, el: <g key={h.id} transform={`translate(${x} ${y})${h.model === 'villa' ? ' scale(.92)' : ''}`}>{el}</g> });
    foot(h.id, [x, y], h.model === 'villa' ? FOOT.villa : h.model === 'lodge' ? FOOT.lodge : FOOT.cottage);
    if (open && (night || storm) && pw.on) g.glow.forEach((q) => glows.push([x + q[0], y + q[1], q[2]]));
    if (newIds.has(h.id)) {
      items.push({ y: y + 1, el: <Ribbon key={`rb${h.id}`} x={x} y={y - 6} /> });
      items.push({ y: y + 2, el: <NewFlags key={`nf${h.id}`} x={x + 4} y={y - g.top + 12} w={g.w * 2 + 10} /> });
      badges.push([x - g.w - 12, y - g.top + 8]);
    }
    if (why) {
      // one pictogram per reason a house is closed: closed on purpose (no
      // entry), no power, inspection lapsed, or falling apart (cracked house)
      const icon: Icon = why === 'red-tagged' ? 'noentry' : why === 'no power' ? 'bolt-off' : why === 'inspection lapsed' ? 'clipboard' : 'broken';
      bub(h.id, x + 4, y - g.top, icon, 'alert', { small: why === 'no power' });
    }
  }

  // ---- build sites: the next tier under construction, later ones surveyed
  const cons = dev.construction && dev.construction.stage < 3 ? dev.construction : null;
  for (const t of TIERS.filter((t) => t.n > s.tier)) {
    const stage = cons && cons.tier === t.n ? (cons.stage as 0 | 1 | 2) : -1;
    for (const a of t.adds) {
      if (a.id === 'p3') {
        flat.push(<DockSite key="dock" stage={stage} motion={motion} />);
        continue;
      }
      const kind = siteKind(a.model);
      if (!kind || !POS[a.id]) continue;
      if (stage < 0 && t.n > s.tier + 2) continue; // far future: nothing staked out yet
      const [x, y] = POS[a.id];
      items.push({ y, el: <Site key={`site${a.id}`} x={x} y={y} kind={kind} stage={stage} /> });
    }
  }
  if (s.tier >= 4) flat.push(<Dock key="dockbuilt" />);

  // ---- a poorly kept island: dry, patchy lawns (paint fades on the buildings too)
  if (wear > 0.3) flat.push(<Worn key="worn" wear={wear} />);

  // ---- flourishes
  if (has('boardwalk')) flat.push(<Boardwalk key="bw" />);
  if (has('fishing-boats')) flat.push(<FishingBoats key="fb" />);
  if (has('yacht')) flat.push(<YachtAt key="yacht" />);
  if (has('garden')) items.push({ y: SPOT.garden[0][1], el: <GardenBeds key="garden" /> });
  if (has('benches')) {
    SPOT.benches.forEach(([x, y], i) => items.push({ y, el: <Bench key={`bn${i}`} x={x} y={y} flip={i % 2 === 1} /> }));
    SPOT.lamps.forEach(([x, y], i) => {
      items.push({ y, el: <Lamp key={`lp${i}`} x={x} y={y} /> });
      if ((night || storm) && pw.on) glows.push([x, y - 22, 13]);
    });
  }
  if (grove) items.push({ y: SPOT.grove[SPOT.grove.length - 1][1], el: <Grove key="grove" /> });
  if (has('beach-bar')) {
    items.push({ y: SPOT.bar[1], el: <BeachBar key="bar" closed={storm} /> });
    if (night && !storm) glows.push([SPOT.bar[0], SPOT.bar[1] - 10, 22]);
  }
  if (has('fountain')) {
    items.push({ y: SPOT.fountain[1], el: <Fountain key="fountain" motion={motion} /> });
    keep.push({ r: footAt(SPOT.fountain, FOOT.fountain) });
  }
  if (has('market')) {
    items.push({ y: SPOT.market[0][1], el: <Market key="market" closed={storm} /> });
    SPOT.market.forEach((m) => keep.push({ r: footAt(m, FOOT.stall) }));
  }
  if (has('lighthouse')) items.push({ y: SPOT.lighthouse[1], el: <Lighthouse key="lh" /> });
  if (has('observatory')) items.push({ y: SPOT.observatory[1], el: <Observatory key="obs" /> });
  if (has('statue')) {
    items.push({ y: SPOT.statue[1], el: <Statue key="statue" /> });
    keep.push({ r: footAt(SPOT.statue, FOOT.statue) });
  }

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
  const droop = (a: Pt, b: Pt, k: number) => sag(a, b, k * 1.9);
  const put = (on: boolean, a: Pt, b: Pt, k = 0.12) => (on ? live.push(sag(a, b, k)) : dead.push(droop(a, b, k)));
  const bushing = add(at('g1'), [1, -24]);
  if (grid && !pw.gridDown) {
    live.push(sag(bushing, poleTop('Q'), 0.05), sag(poleTop('Q'), poleTop('S'), 0.08));
  } else if (grid) dead.push(droop(poleTop('Q', Q_LEAN), poleTop('S'), 0.08));
  if (gen && POLES.S) {
    const from = add(at('gen'), [-9, -30]);
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
    // the lodge takes its service drop low on its east side, not across its front
    const drop: Pt = h.model === 'lodge' ? add([x, y], P([g.w, 9, 3])) : add([x, y], P([side * g.w, g.h + 2, g.d * 0.4]));
    put(pw.on, poleTop(k), drop, 0.06);
  }

  // ---- bubbles: above their asset, never on each other, on other assets or
  // on the runway, and always inside the (zoomed) view
  spread(bubbles, keep, viewOf(z));

  return (
    <svg
      ref={svgRef}
      class={`island-svg${still ? ' still' : ''}${s.weather !== 'clear' ? ' windy' : ''}`}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
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
            <Plane model="float" x={spotOf(float.id).x} y={spotOf(float.id).y} rot={PLANE_ROT.p3} mood={dev.care} size={PLANE_SIZE.p3} service={float.health < 40} />
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
          {pw.gridDown && grid && <BrokenFeed from={bushing} />}
        </g>
        {dev.celebration && <Confetti motion={motion} />}
        {has('bunting') && <Bunting motion={motion} />}
        {flying && (
          <g class={motion ? 'flyby' : undefined} transform={motion ? undefined : 'translate(470 28) rotate(-24)'}>
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
        {night && carrying && <circle cx={at('gen')[0] - 3} cy={at('gen')[1] - 29} r={9} fill="#6dff8e" opacity=".45" />}
        {storm && !night && glows.length > 0 && (
          <g pointer-events="none" opacity=".7">
            {glows.map(([x, y, r], i) => (
              <circle key={i} cx={x} cy={y} r={r} fill="url(#i-glow)" />
            ))}
          </g>
        )}
        {night && (
          <g pointer-events="none">
            {glows.map(([x, y, r], i) => (
              <circle key={i} cx={x} cy={y} r={r} fill="url(#i-glow)" />
            ))}
            {has('lighthouse') && <Beam motion={motion} />}
            {has('observatory') && <circle cx={SPOT.observatory[0]} cy={SPOT.observatory[1] - 10} r={16} fill="url(#i-glow)" />}
            {has('statue') && <ellipse cx={SPOT.statue[0]} cy={SPOT.statue[1] - 16} rx={20} ry={24} fill="url(#i-glow)" opacity=".8" />}
            {s.tier >= 5 && <RunwayLights night glowOnly />}
            {has('bunting') && buntingBulbs().map(([x, y], i) => <circle key={`bb${i}`} cx={x} cy={y} r={9} fill="url(#i-glow)" />)}
          </g>
        )}
        {badges.map(([x, y], i) => (
          <NewBadge key={i} x={x} y={y} scale={bscale} motion={motion} />
        ))}
        {/* notification bubbles, above everything so they read at night */}
        {bubbles
          .sort((a, b) => a.y + a.dy - (b.y + b.dy))
          .map((b, i) => (
            <Bubble key={b.key} x={b.x} y={b.y} dx={b.dx} dy={b.dy} icon={b.icon} tone={b.tone} small={b.small} scale={bscale} motion={motion} delay={(i * 0.37) % 1.6} />
          ))}
      </g>
      {storm && <Rain motion={motion} />}
      {s.weather === 'wind' && <Wind motion={motion} />}
    </svg>
  );
}

// ---------------------------------------------------------------- bits ---
const At = ({ p, children }: { p: Pt; children: JSX.Element }) => <g transform={`translate(${p[0]} ${p[1]})`}>{children}</g>;
const SQUARE_PEOPLE: Pt[] = [[396, 318], [444, 314], [402, 346], [446, 350], [378, 336], [466, 334], [424, 356]];
const BEACH_TOWELS: Pt[] = [[212, 536], [410, 536], [566, 524], [612, 516], [160, 522], [654, 508]];
const SWIMMERS: Pt[] = [[250, 560], [410, 558], [580, 552], [650, 540]];

const DRY: [number, number, number, number][] = [[330, 262, 26, 9], [470, 250, 18, 7], [210, 398, 22, 7], [150, 206, 30, 8], [722, 330, 14, 8], [560, 252, 18, 6]];
function Worn({ wear }: { wear: number }) {
  return (
    <g opacity={Math.min(0.85, 0.3 + wear * 0.8)}>
      <path d={DRY.map(([x, y, rx, ry], i) => curve(blob(x, y, rx, ry, i * 7 + 3, 7, 0.3))).join('')} fill="#c2b35e" />
      <path d={DRY.map(([x, y, rx], i) => `M${x - rx * 0.4} ${y + 2}l-2 -6M${x - rx * 0.3} ${y + 2}l2 -7M${x + rx * 0.3} ${y}l1 -6M${x + rx * 0.36} ${y}l-3 -5` + (i % 2 ? '' : `M${x} ${y - 3}l-1 -5`)).join('')} stroke="#8a7a3a" stroke-width="1.3" fill="none" />
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
      {night && <circle cx={ax + 11} cy={ay - 17} r={9} fill="#ff3b30" opacity=".4" />}
      {sparkEnds(from).map(([x, y], i) => (
        <g key={i} transform={`translate(${x} ${y})`}>
          <circle r={11} fill="#fff3a0" opacity=".4" />
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
  const pl = planes.map((p) => `${p.name} ${p.health < 40 ? 'AOG' : s.tags?.[p.id] ? 'grounded' : p.health < 60 ? 'needs attention' : 'flying'}`);
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
    s.weather !== 'clear' ? s.weather : '',
    building,
    dev.justBuilt ? `tier ${dev.justBuilt} just arrived` : '',
    fl.length ? `the island has developed ${fl.length > 1 ? fl.slice(0, -1).join(', ') + ' and ' + fl[fl.length - 1] : fl[0]}` : 'nothing extra developed yet',
  ];
  return parts.filter(Boolean).join('. ') + '.';
}
