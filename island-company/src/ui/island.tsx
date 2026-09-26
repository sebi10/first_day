// The island is the progress bar and the status board: a cartoon map that
// grows tier by tier (and week by week, src/sim/growth.ts), with notification
// bubbles sitting on whatever needs a hand. Layers, bottom to top: memoized
// terrain, sea life, flat props, y-sorted buildings/planes/people, wires,
// sky, light, bubbles; rain and wind streaks sit outside the zoom.
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { COSMETICS, TIERS } from '../sim/data';
import { houseBlocker, houseRentable, planeCapacity, powered } from '../sim/econ';
import { developmentOf, type Flourish } from '../sim/growth';
import type { Asset, IslandState, Role } from '../sim/types';
import { Cottage, GenHouse, Hangar, Lodge, Office, Pole, POLE_H, Ribbon, Substation, Villa, type Win } from './island/buildings';
import { FlyingPlane, Plane, type PlaneModel } from './island/craft';
import {
  BeachBar, Bench, Boardwalk, Confetti, Dock, FishingBoats, Fountain, GardenBeds, Grove, Lamp, Lighthouse, Market, NewFlags, Observatory, Statue,
  Bunting, buntingBulbs, YachtAt,
} from './island/extras';
import { curve, FOCUS, H, HANGAR, OFFICE, P, POS, RUNWAY, RUNWAY_ANGLE, RUNWAY_C, RUNWAY_LEN, SPOT, W, zoomOf, type Pt } from './island/geo';
import { blob } from './island/rocks';
import { Clouds, Gulls, Guy, LifeDefs, NightSky, Rain, SeaLife, Wind } from './island/life';
import { K } from './island/paint';
import { DockSite, Site, type SiteKind } from './island/sites';
import { Bubble, NewBadge, type Icon, type Tone } from './island/status';
import { Terrain, TerrainDefs } from './island/terrain';

type Phase = 'dawn' | 'day' | 'golden' | 'night';
export const phaseOf = (d = new Date()): Phase => {
  const h = d.getHours();
  return h >= 5 && h < 8 ? 'dawn' : h >= 8 && h < 17 ? 'day' : h >= 17 && h < 20 ? 'golden' : 'night';
};

const cosmeticColor = (role: Role, id: string | undefined) => COSMETICS[role].find((c) => c.id === id)?.color ?? COSMETICS[role][0].color;
const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];

// house geometry, for bubbles, wires and window glows
const HOUSE = {
  cottage: { top: 38, bub: 34, w: 20, h: 18, d: 26, glow: [[-12, -9], [12, -9]] },
  villa: { top: 58, bub: 50, w: 30, h: 32, d: 32, glow: [[-20, -24], [0, -24], [20, -24], [-20, -8], [20, -8]] },
  lodge: { top: 66, bub: 40, w: 30, h: 20, d: 40, glow: [[0, -30], [-48, -8]] },
} as const;
const houseGeo = (a: Asset) => HOUSE[(a.model as keyof typeof HOUSE) in HOUSE ? (a.model as keyof typeof HOUSE) : 'cottage'];

// power poles and the spans between them (tier each first appears)
const POLES: Record<string, { at: Pt; tier: number }> = {
  S: { at: [552, 268], tier: 1 },
  A: { at: [598, 306], tier: 1 },
  C: { at: [676, 290], tier: 1 },
  D: { at: [612, 356], tier: 2 },
  E: { at: [704, 296], tier: 4 },
  F: { at: [630, 272], tier: 5 },
};
const SPANS: [string, string][] = [['S', 'A'], ['A', 'C'], ['A', 'D'], ['C', 'E'], ['S', 'F']];
const FEED: Record<string, string> = { h1: 'A', h2: 'C', h3: 'D', h4: 'D', h5: 'E', h6: 'E', h7: 'F' };
const poleTop = (k: string): Pt => [POLES[k].at[0], POLES[k].at[1] - POLE_H + 3];
const sag = (a: Pt, b: Pt, k = 0.12) => {
  const m: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + Math.hypot(b[0] - a[0], b[1] - a[1]) * k];
  return `M${a[0]} ${a[1]}Q${m[0].toFixed(1)} ${m[1].toFixed(1)} ${b[0]} ${b[1]}`;
};

// where AOG planes are worked on: on jacks on the hangar pad
const AOG_SPOTS: Pt[] = [[112, 304], [276, 234]];
const PLANE_ROT: Record<string, number> = { p1: 100, p2: 96, p3: 20 };

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

const LIGHT: Record<Phase, { fill: string; o: number }> = {
  dawn: { fill: '#ff9eb4', o: 0.15 },
  day: { fill: '#ffffff', o: 0 },
  golden: { fill: '#ff9147', o: 0.15 },
  night: { fill: '#0a1745', o: 0.56 },
};

const siteKind = (model: string): SiteKind | null =>
  model === 'cottage' ? 'house' : model === 'villa' ? 'villa' : model === 'lodge' ? 'lodge' : model === 'gen' ? 'gen' : null;

type Item = { y: number; el: JSX.Element };
type Bub = { x: number; y: number; icon: Icon; tone: Tone; small?: boolean; key: string };

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
  const warm = night || phase === 'golden';
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
  const z = focus ? FOCUS[focus] : null;
  const bscale = z ? 1.3 / z.k : 1;
  const newIds = new Set(dev.justBuilt ? TIERS[dev.justBuilt - 1].adds.map((a) => a.id) : []);

  const ground = useMemo(() => <Terrain tier={s.tier} weather={s.weather} motion={motion} />, [s.tier, s.weather, motion]);
  const storm = s.weather === 'storm';
  const boats = storm ? 0 : 1 + Math.round(dev.prosperity * 3);
  const sea = useMemo(() => <SeaLife motion={motion} boats={boats} />, [motion, boats]);

  const items: Item[] = [];
  const flat: JSX.Element[] = [];
  const glows: Pt[] = [];
  const bubbles: Bub[] = [];
  const badges: Pt[] = [];
  const at = (id: string) => POS[id];

  // ---- airfield
  const aog = planes.filter((p) => p.health < 40);
  items.push({ y: HANGAR[1], el: <At key="hangar" p={HANGAR}><Hangar tint={hangarColor} wear={wear} doorOpen={aog.length > 0} /></At> });
  aog.forEach((p, i) => {
    const [x, y] = i === 0 ? AOG_SPOTS[0] : p.model === 'float' ? AOG_SPOTS[1] : POS[p.id];
    items.push({ y, el: <Plane key={p.id} model={p.model as PlaneModel} x={x} y={y} rot={92} jacks chocks={tagged(p)} /> });
    items.push({ y: y + 1, el: <Guy key={`mech${i}`} x={x + 22} y={y + 12} c={K.orange} /> });
    bubbles.push({ x: x - 4, y: y - 22, icon: 'wrench', tone: 'alert', key: p.id });
  });
  for (const p of planes.filter((q) => q.health >= 40)) {
    const [x, y] = at(p.id) ?? POS.p1;
    const g = tagged(p);
    // the floatplane is drawn on the water under the dock (see below); only its bubbles go here
    if (p.model !== 'float') items.push({ y, el: <Plane key={p.id} model={p.model as PlaneModel} x={x} y={y} rot={PLANE_ROT[p.id] ?? 96} chocks={g} mood={dev.care} /> });
    if (newIds.has(p.id) && p.model !== 'float') {
      items.push({ y: y + 1, el: <Ribbon key={`rb${p.id}`} x={x} y={y - 6} /> });
      badges.push([x - 18, y - 16]);
    }
    if (g) bubbles.push({ x: x + 16, y: y - 22, icon: 'cone', tone: 'alert', key: p.id });
    else if (p.health < 60) bubbles.push({ x: x + 16, y: y - 22, icon: 'warn', tone: 'warn', key: p.id });
  }
  if (s.tier >= 5) flat.push(<RunwayLights key="rwl" night={night} />);

  // ---- office and the square
  const officeWin: Win = !pw.on ? 'dark' : warm ? 'lit' : 'glass';
  items.push({ y: OFFICE[1], el: <At key="office" p={OFFICE}><Office tint={officeColor} win={officeWin} wear={wear} flag={officeColor} motion={motion} /></At> });
  if (pw.on && night) glows.push([OFFICE[0], OFFICE[1] - 14], [OFFICE[0], OFFICE[1] - 30]);
  if (s.cash < 2000) bubbles.push({ x: OFFICE[0] - 16, y: OFFICE[1] - 56, icon: 'cash', tone: 'alert', key: 'cash' });

  // ---- grid: substation, poles, wires
  if (grid) {
    items.push({ y: at('g1')[1], el: <At key="g1" p={at('g1')}><Substation wear={wear} /></At> });
    if (pw.gridDown) bubbles.push({ x: at('g1')[0] - 2, y: at('g1')[1] - 30, icon: 'wrench', tone: 'alert', key: 'g1' });
    else if (grid.health < 60) bubbles.push({ x: at('g1')[0] - 2, y: at('g1')[1] - 30, icon: 'warn', tone: 'warn', key: 'g1' });
  }
  const poles = Object.entries(POLES).filter(([, p]) => p.tier <= s.tier);
  for (const [k, p] of poles) items.push({ y: p.at[1], el: <Pole key={`pole${k}`} x={p.at[0]} y={p.at[1]} /> });

  // ---- generator
  if (gen) {
    const [x, y] = at('gen');
    const carrying = pw.gridDown && pw.genOK;
    items.push({ y, el: <At key="gen" p={[x, y]}><GenHouse wear={wear} running={carrying} motion={motion} /></At> });
    if (gen.health < 50) bubbles.push({ x, y: y - 40, icon: pw.gridDown ? 'wrench' : 'warn', tone: pw.gridDown ? 'alert' : 'warn', key: 'gen' });
    else if (carrying) bubbles.push({ x: x + 10, y: y - 40, icon: 'bolt', tone: 'warn', small: true, key: 'gen' });
    if (newIds.has('gen')) {
      items.push({ y: y + 1, el: <Ribbon key="rbgen" x={x - 4} y={y - 6} /> });
      items.push({ y: y + 2, el: <NewFlags key="nfgen" x={x + 2} y={y - 26} w={46} /> });
      badges.push([x - 16, y - 34]);
    }
  }

  // ---- houses
  for (const h of houses) {
    const [x, y] = at(h.id) ?? [0, 0];
    const g = houseGeo(h);
    const open = houseRentable(s, h);
    const win: Win = open ? (warm ? 'lit' : 'glass') : !pw.on ? 'dark' : 'shut';
    const props = { tint: houseColor, win, wear, open };
    const el = h.model === 'villa' ? <Villa {...props} /> : h.model === 'lodge' ? <Lodge {...props} /> : <Cottage {...props} />;
    items.push({ y, el: <g key={h.id} transform={`translate(${x} ${y})`}>{el}</g> });
    if (open && night) g.glow.forEach((q) => glows.push([x + q[0], y + q[1]]));
    if (newIds.has(h.id)) {
      items.push({ y: y + 1, el: <Ribbon key={`rb${h.id}`} x={x} y={y - 6} /> });
      items.push({ y: y + 2, el: <NewFlags key={`nf${h.id}`} x={x + 4} y={y - g.top + 8} w={g.w * 2 + 10} /> });
      badges.push([x - g.w, y - g.top + 4]);
    }
    if (h.health < 30) items.push({ y: y + 3, el: <Smoke key={`sm${h.id}`} x={x - g.w * 0.55} y={y - g.top + 8} motion={motion} /> });
    const why = houseBlocker(s, h);
    if (why) {
      const icon: Icon = why === 'red-tagged' ? 'tag' : why === 'no power' ? 'bolt-off' : why === 'inspection lapsed' ? 'clipboard' : h.health < 30 ? 'flame' : 'wrench';
      bubbles.push({ x: x + g.w * 0.45, y: y - g.bub, icon, tone: 'alert', small: why === 'no power', key: h.id });
      if (why === 'red-tagged') items.push({ y: y + 1, el: <path key={`tape${h.id}`} d={`M${x - 6} ${y - 12}l12 10M${x + 6} ${y - 12}l-12 10`} stroke={K.rust} stroke-width="2.4" /> });
    }
  }

  // ---- build sites: the next tier under construction, later ones planned
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
  const float = planes.find((p) => p.model === 'float');
  if (float && float.health >= 40) {
    // moored floatplane sits on the water, below the dock's things
    const [x, y] = POS.p3;
    flat.push(
      <g key="floatwater">
        <ellipse cx={x + 2} cy={y + 6} rx={30} ry={6} fill="#fff" opacity=".25" />
      </g>,
    );
  }

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
      if (night && pw.on) glows.push([x, y - 22]);
    });
  }
  if (has('palm-grove')) items.push({ y: 340, el: <Grove key="grove" motion={motion} /> });
  if (has('beach-bar')) {
    items.push({ y: SPOT.bar[1], el: <BeachBar key="bar" /> });
    if (night) glows.push([SPOT.bar[0], SPOT.bar[1] - 10]);
  }
  if (has('fountain')) items.push({ y: SPOT.fountain[1], el: <Fountain key="fountain" motion={motion} /> });
  if (has('market')) items.push({ y: SPOT.market[0][1], el: <Market key="market" /> });
  if (has('lighthouse')) items.push({ y: SPOT.lighthouse[1], el: <Lighthouse key="lh" /> });
  if (has('observatory')) items.push({ y: SPOT.observatory[1], el: <Observatory key="obs" /> });
  if (has('statue')) items.push({ y: SPOT.statue[1], el: <Statue key="statue" /> });

  // ---- people: busier with prosperity, guests walking when houses are booked
  const pr = dev.prosperity;
  const shirts = [K.pink, K.blue, K.yellow, '#4caf50', K.purple, K.orange, '#fff'];
  SQUARE_PEOPLE.slice(0, 1 + Math.round(pr * 5)).forEach(([x, y], i) => items.push({ y, el: <Guy key={`sq${i}`} x={x} y={y} c={shirts[i % shirts.length]} /> }));
  const beachN = storm ? 0 : Math.round(pr * 6);
  BEACH_TOWELS.slice(0, beachN).forEach(([x, y], i) => flat.push(<use key={`tw${i}`} href="#i-towel" transform={`translate(${x} ${y})`} style={{ color: shirts[(i + 2) % shirts.length] }} />));
  SWIMMERS.slice(0, storm ? 0 : Math.round(pr * 4)).forEach(([x, y], i) => flat.push(<use key={`sw${i}`} href="#i-swim" transform={`translate(${x} ${y})`} style={{ color: shirts[(i + 4) % shirts.length] }} />));

  items.sort((a, b) => a.y - b.y);

  // ---- wires (drawn over roofs, as overhead lines are)
  const wires: string[] = [];
  const dead: string[] = [];
  for (const [a, b] of SPANS) {
    if (POLES[a].tier > s.tier || POLES[b].tier > s.tier) continue;
    if (pw.gridDown && a === 'S' && b === 'A') continue; // the broken span, drawn separately
    (pw.on ? wires : dead).push(sag(poleTop(a), poleTop(b)));
  }
  if (grid) (pw.gridDown ? dead : wires).push(sag(add(at('g1'), [-2, -21]), poleTop('S'), 0.05));
  for (const h of houses) {
    const k = FEED[h.id];
    if (!k || POLES[k].tier > s.tier) continue;
    const g = houseGeo(h);
    const [x, y] = at(h.id);
    const side = POLES[k].at[0] < x ? -1 : 1;
    const end = add([x, y], P([side * g.w, g.h + 2, g.d * 0.4]));
    (pw.on ? wires : dead).push(sag(poleTop(k), end, 0.06));
  }

  const lit = LIGHT[phase];
  return (
    <svg
      ref={svgRef}
      class={`island-svg${still ? ' still' : ''}${s.weather !== 'clear' ? ' windy' : ''}`}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={describe(s, pw, rentable.length, dev.flourishes)}
      onClick={onTap}
    >
      <defs>
        <TerrainDefs />
        <LifeDefs />
      </defs>
      <g class="island-zoom" style={{ transform: zoomOf(z) }}>
        {ground}
        {sea}
        {flat}
        {float && float.health >= 40 && (
          <g>
            <Plane model="float" x={POS.p3[0]} y={POS.p3[1]} rot={PLANE_ROT.p3} mood={dev.care} />
            {tagged(float) && <path d={`M${POS.p3[0] - 30} ${POS.p3[1] - 18}q10 8 22 6`} stroke="#e8d8b0" stroke-width="1.6" fill="none" />}
            {newIds.has('p3') && <Ribbon x={POS.p3[0]} y={POS.p3[1] - 8} />}
            {newIds.has('p3') && <NewBadge x={POS.p3[0] - 22} y={POS.p3[1] - 14} scale={bscale} motion={motion} />}
          </g>
        )}
        {items.map((it) => it.el)}
        {/* overhead lines */}
        <g fill="none" stroke-linecap="round">
          {dead.length > 0 && <path d={dead.join('')} stroke="#4b535a" stroke-width="1.1" opacity=".75" />}
          {wires.length > 0 && <path d={wires.join('')} stroke="#2f3438" stroke-width="1.2" opacity=".85" />}
          {wires.length > 0 && <path d={wires.join('')} stroke={K.yellow} stroke-width=".7" class={motion && grid && grid.health < 60 ? 'flicker' : undefined} opacity=".9" />}
          {pw.gridDown && grid && <BrokenSpan motion={motion} />}
        </g>
        {dev.celebration && <Confetti motion={motion} />}
        {has('bunting') && <Bunting motion={motion} />}
        {!storm && <Gulls motion={motion} />}
        {flying && (
          <g class={motion ? 'flyby' : undefined} transform={motion ? undefined : 'translate(470 28) rotate(-24)'}>
            <FlyingPlane />
          </g>
        )}
        {booked > 0 && <Walkers n={Math.min(2, booked)} motion={motion} />}
        <Clouds storm={storm} motion={motion} />
        {/* light of the hour */}
        {lit.o > 0 && <rect x={-40} y={-40} width={W + 80} height={H + 80} fill={lit.fill} opacity={lit.o} pointer-events="none" />}
        {storm && <rect x={-40} y={-40} width={W + 80} height={H + 80} fill="#1d2a3a" opacity=".22" pointer-events="none" />}
        {night && <NightSky motion={motion} />}
        {night && (
          <g pointer-events="none">
            {glows.map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r={13} fill="url(#i-glow)" />
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
          .sort((a, b) => a.y - b.y)
          .map((b) => (
            <Bubble key={b.key} x={b.x} y={b.y} icon={b.icon} tone={b.tone} small={b.small} scale={bscale} motion={motion} />
          ))}
      </g>
      {storm && <Rain motion={motion} />}
      {s.weather === 'wind' && <Wind motion={motion} />}
    </svg>
  );
}

// ---------------------------------------------------------------- bits ---
const At = ({ p, children }: { p: Pt; children: JSX.Element }) => <g transform={`translate(${p[0]} ${p[1]})`}>{children}</g>;
const SQUARE_PEOPLE: Pt[] = [[338, 352], [386, 344], [352, 380], [392, 368], [322, 372], [408, 352], [370, 390]];
const BEACH_TOWELS: Pt[] = [[196, 498], [318, 500], [562, 480], [604, 476], [150, 486], [640, 464]];
const SWIMMERS: Pt[] = [[214, 530], [344, 524], [584, 506], [640, 494]];

const DRY: [number, number, number, number][] = [[196, 300, 26, 9], [470, 296, 18, 7], [640, 424, 24, 8], [296, 418, 26, 8], [168, 196, 30, 8], [700, 350, 16, 8], [580, 250, 18, 6], [110, 360, 16, 8]];
function Worn({ wear }: { wear: number }) {
  return (
    <g opacity={Math.min(0.85, 0.3 + wear * 0.8)}>
      <path d={DRY.map(([x, y, rx, ry], i) => curve(blob(x, y, rx, ry, i * 7 + 3, 7, 0.3))).join('')} fill="#c2b35e" />
      <path d={DRY.map(([x, y, rx], i) => `M${x - rx * 0.4} ${y + 2}l-2 -6M${x - rx * 0.3} ${y + 2}l2 -7M${x + rx * 0.3} ${y}l1 -6M${x + rx * 0.36} ${y}l-3 -5` + (i % 2 ? '' : `M${x} ${y - 3}l-1 -5`)).join('')} stroke="#8a7a3a" stroke-width="1.3" fill="none" />
    </g>
  );
}

function Smoke({ x, y, motion }: { x: number; y: number; motion: boolean }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d="M-5 0a6 6 0 1 0 .1 0M-9 -9a7 7 0 1 0 .1 0M-5 -19a6 6 0 1 0 .1 0" fill="#5d5956" opacity=".8" />
      <g class={motion ? 'puff' : undefined}>
        <circle cx={-4} cy={-26} r={7} fill="#7a7672" opacity=".7" />
        <circle cx={2} cy={-34} r={5} fill="#9a9692" opacity=".55" />
      </g>
    </g>
  );
}

function BrokenSpan({ motion }: { motion: boolean }) {
  const [ax, ay] = poleTop('S');
  const [bx, by] = poleTop('A');
  return (
    <g>
      <path d={`M${ax} ${ay}Q${ax + 10} ${ay + 20} ${ax + 14} ${ay + 34}M${bx} ${by}Q${bx - 8} ${by + 18} ${bx - 16} ${by + 30}`} stroke="#4b535a" stroke-width="1.2" />
      <g transform={`translate(${ax + 14} ${ay + 34})`}>
        <g class={motion ? 'flicker' : undefined}>
          <path d="M0 0l-4 -5M0 0l5 -4M0 0l1 6M0 0l-5 3" stroke={K.yellow} stroke-width="1.6" />
        </g>
      </g>
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
      <g class={motion ? 'beam' : undefined}>
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
        <Guy x={520} y={346} c={K.pink} />
        {n > 1 && <Guy x={420} y={352} c={K.blue} />}
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

function describe(s: IslandState, pw: ReturnType<typeof powered>, open: number, fl: Flourish[]) {
  const tierName = TIERS[s.tier - 1]?.name ?? '';
  const planes = s.assets.filter((a) => a.kind === 'plane');
  const houses = s.assets.filter((a) => a.kind === 'house');
  const pl = planes.map((p) => `${p.name} ${p.health < 40 ? 'AOG' : s.tags?.[p.id] ? 'grounded' : p.health < 60 ? 'needs attention' : 'flying'}`);
  const closed = houses.filter((h) => !houseRentable(s, h)).map((h) => `${h.name} closed (${houseBlocker(s, h)})`);
  const parts = [
    `${s.name}, tier ${s.tier} ${tierName}`,
    `${planes.length} plane${planes.length === 1 ? '' : 's'}: ${pl.join(', ')}`,
    `${open} of ${houses.length} houses open${closed.length ? ': ' + closed.join(', ') : ''}`,
    !pw.on ? 'no power on the island' : pw.gridDown ? 'grid down, generator carrying the load' : 'grid up',
    s.cash < 2000 ? 'cash alarm' : '',
    s.weather !== 'clear' ? s.weather : '',
    fl.length ? `developed: ${fl.join(', ')}` : '',
  ];
  return parts.filter(Boolean).join('. ') + '.';
}
