// The island is the progress bar. Painterly low-poly SVG, readable with no
// text: rust tags = faults, dim windows = no power, empty runway = grounded.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { COSMETICS, TIERS } from '../sim/data';
import { houseRentable, planeCapacity, powered } from '../sim/econ';
import type { Asset, IslandState, Role } from '../sim/types';
import { C } from './theme';

type Phase = 'dawn' | 'day' | 'golden' | 'night';
export const phaseOf = (d = new Date()): Phase => {
  const h = d.getHours();
  return h >= 5 && h < 8 ? 'dawn' : h >= 8 && h < 17 ? 'day' : h >= 17 && h < 20 ? 'golden' : 'night';
};

const OUTLINE = [
  [40, 150], [55, 110], [85, 82], [130, 62], [185, 52], [240, 55], [290, 68], [335, 90], [365, 125], [372, 165],
  [360, 205], [330, 238], [285, 258], [230, 268], [170, 265], [115, 252], [72, 228], [48, 195],
];
const pts = (p: number[][]) => p.map((x) => x.join(',')).join(' ');

const POS: Record<string, [number, number]> = {
  p1: [142, 138],
  p2: [184, 128],
  p3: [70, 262],
  h1: [262, 108],
  h2: [302, 126],
  h3: [266, 166],
  h4: [310, 176],
  h5: [346, 146],
  h6: [320, 214],
  h7: [240, 226],
  g1: [236, 138],
  gen: [206, 204],
};

const FOCUS: Record<Role, { x: number; y: number; k: number }> = {
  mech: { x: 128, y: 118, k: 1.9 },
  elec: { x: 290, y: 165, k: 1.75 },
  fin: { x: 200, y: 158, k: 2.2 },
};

const cosmeticColor = (role: Role, id: string | undefined) =>
  COSMETICS[role].find((c) => c.id === id)?.color ?? COSMETICS[role][0].color;

function Tag({ x, y, text }: { x: number; y: number; text?: string }) {
  const w = text ? 8 + text.length * 5.6 : 14;
  return (
    <g transform={`translate(${x},${y})`} class="pulse">
      <rect x={-w / 2} y={-8} width={w} height={14} rx={7} fill={C.rust} />
      <text x={0} y={2.5} text-anchor="middle" font-size="9" font-weight="900" fill="#fff">
        {text ?? '!'}
      </text>
    </g>
  );
}

function Palm({ x, y, s = 1, motion }: { x: number; y: number; s?: number; motion: boolean }) {
  return (
    <g transform={`translate(${x},${y}) scale(${s})`}>
      <ellipse cx={3} cy={1} rx={9} ry={3} fill="rgba(31,42,48,.12)" />
      <path d="M0 0 C1 -8 -1 -16 2 -24" stroke="#8a6a44" stroke-width="3" fill="none" stroke-linecap="round" />
      <g class={motion ? 'sway' : ''}>
        <path d="M2 -24 l-13 5 l6 -8z" fill={C.palm} />
        <path d="M2 -24 l13 4 l-7 -8z" fill="#5d9a68" />
        <path d="M2 -24 l-9 -9 l10 3z" fill="#5d9a68" />
        <path d="M2 -24 l9 -10 l-3 9z" fill={C.palm} />
        <path d="M2 -24 l-2 12 l5 -9z" fill="#3A6B45" />
      </g>
    </g>
  );
}

function Plane({ x, y, cargo, float, rot = -14 }: { x: number; y: number; cargo?: boolean; float?: boolean; rot?: number }) {
  const body = '#fbf5e9';
  return (
    <g transform={`translate(${x},${y}) rotate(${rot})`}>
      <ellipse cx={2} cy={4} rx={16} ry={5} fill="rgba(31,42,48,.18)" />
      {float && (
        <>
          <rect x={-12} y={4} width={22} height={3} rx={1.5} fill={C.ink} />
          <rect x={-12} y={-7} width={22} height={3} rx={1.5} fill={C.ink} />
        </>
      )}
      <rect x={-3} y={-15} width={7} height={30} rx={3} fill={body} stroke={C.ink} stroke-width="0.8" />
      <path d="M-14 -1 h29 l-2 4 h-25z" fill={body} stroke={C.ink} stroke-width="0.8" />
      <path d="M-15 -2 L-15 2 L-10 2 L-10 -2 Z" fill={cargo ? C.mech : C.sea} />
      <path d="M-6 -1 h13" stroke={cargo ? C.mech : C.sea} stroke-width="2" />
      <rect x={-2} y={10} width={5} height={2} fill={C.ink} opacity=".5" />
    </g>
  );
}

function House({ a, tint, lit, dim, big, lodge }: { a: Asset; tint: string; lit: boolean; dim: boolean; big?: boolean; lodge?: boolean }) {
  const [x, y] = POS[a.id] ?? [0, 0];
  const s = lodge ? 1.5 : big ? 1.25 : 1;
  const wall = '#f7ecd8';
  return (
    <g transform={`translate(${x},${y}) scale(${s})`}>
      <ellipse cx={3} cy={9} rx={17} ry={5} fill="rgba(31,42,48,.14)" />
      <path d="M-13 -2 L-13 9 L13 9 L13 -2 Z" fill={wall} />
      <path d="M0 -2 L13 -2 L13 9 L0 9 Z" fill="#eadcc2" />
      <path d="M-16 -1 L0 -14 L16 -1 Z" fill={tint} />
      <path d="M0 -14 L16 -1 L0 -1 Z" fill="rgba(31,42,48,.14)" />
      <rect x={-3} y={2} width={6} height={7} fill={dim ? '#8b8f88' : '#8a6a44'} />
      <rect class="win" x={-10} y={1} width={5} height={4} fill={lit ? C.elec : dim ? '#56646B' : '#cfd8d8'} />
      <rect class="win" x={6} y={1} width={5} height={4} fill={lit ? C.elec : dim ? '#56646B' : '#cfd8d8'} />
    </g>
  );
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
  const pw = powered(s);
  const players = s.players;
  const hangarColor = cosmeticColor('mech', players.mech?.cosmetic);
  const houseColor = cosmeticColor('elec', players.elec?.cosmetic);
  const officeColor = cosmeticColor('fin', players.fin?.cosmetic);
  const planes = s.assets.filter((a) => a.kind === 'plane');
  const houses = s.assets.filter((a) => a.kind === 'house');
  const grid = s.assets.find((a) => a.kind === 'grid');
  const gen = s.assets.find((a) => a.kind === 'generator');
  const flying = planes.some((p) => !s.tags?.[p.id] && planeCapacity(p, s.tier, s.weather) > 0 && !p.model.includes('cargo'));
  const booked = houses.filter((h) => houseRentable(s, h)).length;
  const night = phase === 'night';

  const z = focus ? FOCUS[focus] : null;
  const zoom = z ? `translate(${200 - z.x * z.k}px, ${150 - z.y * z.k}px) scale(${z.k})` : 'none';

  const overlay = useMemo(
    () =>
      ({
        dawn: { fill: '#F7B7A3', o: 0.16 },
        day: { fill: '#FFFFFF', o: 0 },
        golden: { fill: '#F2A65A', o: 0.2 },
        night: { fill: '#16223A', o: 0.5 },
      })[phase],
    [phase],
  );

  const aog = planes.filter((p) => p.health < 40);
  const parked = planes.filter((p) => p.health >= 40 && p.model !== 'float');
  const floatPlane = planes.find((p) => p.model === 'float');

  return (
    <svg ref={svgRef} class={still ? 'still' : undefined} viewBox="0 0 400 300" role="img" aria-label={`${s.name}: ${planes.length} planes, ${houses.length} houses, tier ${s.tier}`} onClick={onTap}>
      <defs>
        <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#3a8ea4" />
          <stop offset="1" stop-color={C.seaDeep} />
        </linearGradient>
        <radialGradient id="sand" cx="0.45" cy="0.4" r="0.7">
          <stop offset="0" stop-color="#f7ead0" />
          <stop offset="1" stop-color={C.sandDeep} />
        </radialGradient>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
      </defs>
      <rect width="400" height="300" fill="url(#sea)" />
      <g class="island-zoom" style={{ transform: zoom }}>
        {/* shallows + waves */}
        <polygon points={pts(OUTLINE)} fill="none" stroke={C.seaLight} stroke-width="34" stroke-linejoin="round" opacity=".45" />
        <polygon points={pts(OUTLINE)} fill="none" stroke="#fbf5e9" stroke-width="10" stroke-linejoin="round" opacity=".55" />
        <g class={motion ? 'drift' : ''} stroke="#fbf5e9" stroke-width="1.6" fill="none" opacity=".45" stroke-linecap="round">
          <path d="M20 40 q8 -4 16 0 t16 0" />
          <path d="M330 30 q8 -4 16 0 t16 0" />
          <path d="M15 270 q8 -4 16 0 t16 0" />
          <path d="M350 275 q8 -4 16 0 t16 0" />
          <path d="M380 70 q6 -3 12 0" />
        </g>
        {/* island body, low-poly facets */}
        <polygon points={pts(OUTLINE)} fill={C.sandDeep} />
        <polygon points={pts(OUTLINE)} fill="url(#sand)" transform="translate(205 160) scale(0.95) translate(-205 -160)" />
        <polygon points="85,82 185,52 150,140" fill="#fff" opacity=".07" />
        <polygon points="240,55 335,90 260,150" fill="#fff" opacity=".06" />
        <polygon points="72,228 170,265 150,190" fill={C.ink} opacity=".035" />
        <polygon points="285,258 360,205 300,200" fill={C.ink} opacity=".04" />
        {/* grass */}
        <polygon points="290,68 335,90 348,112 316,104 296,86" fill={C.palm} opacity=".75" />
        <polygon points="48,195 72,228 98,236 86,206 60,188" fill={C.palm} opacity=".7" />
        <polygon points="150,232 200,242 226,258 170,262 140,250" fill="#5d9a68" opacity=".65" />
        <polygon points="340,190 362,168 366,196 350,214" fill="#5d9a68" opacity=".6" />

        {/* footpaths: apron → office → cottages, and down to the beach */}
        <g stroke="#fbf5e9" stroke-width="5" fill="none" stroke-linecap="round" opacity=".55">
          <path d="M200 150 C 220 150, 236 136, 262 118" />
          <path d="M214 160 C 240 168, 262 172, 300 176" />
          <path d="M194 170 C 190 200, 206 230, 238 236" />
          <path d="M150 158 C 140 190, 120 214, 96 238" />
        </g>
        {/* beach life: rocks, umbrellas, a towel */}
        <g>
          <ellipse cx={352} cy={228} rx={7} ry={4} fill="#9aa5a9" />
          <ellipse cx={360} cy={232} rx={4} ry={3} fill="#b8c0c2" />
          <ellipse cx={58} cy={120} rx={6} ry={3.5} fill="#9aa5a9" />
          <g transform="translate(262 252)">
            <line x1={0} y1={0} x2={0} y2={-12} stroke={C.ink} stroke-width="1" />
            <path d="M-9 -11 Q0 -19 9 -11 Z" fill={C.fin} />
            <rect x={4} y={-2} width={9} height={4} rx={1} fill={C.elec} />
          </g>
          <g transform="translate(150 250)">
            <line x1={0} y1={0} x2={0} y2={-12} stroke={C.ink} stroke-width="1" />
            <path d="M-9 -11 Q0 -19 9 -11 Z" fill={C.mech} />
          </g>
        </g>
        {/* plots for what the next tiers will build: the island is the progress bar */}
        <g fill="none" stroke={C.ink} stroke-width="1" stroke-dasharray="3 3" opacity=".28">
          {TIERS.filter((t) => t.n > s.tier).flatMap((t) =>
            t.adds
              .filter((a) => POS[a.id] && a.id !== 'p3')
              .map((a) => {
                const [x, y] = POS[a.id];
                const big = a.model === 'villa' || a.model === 'lodge';
                return (
                  <g key={a.id}>
                    <rect x={x - (big ? 18 : 14)} y={y - (big ? 16 : 12)} width={big ? 36 : 28} height={big ? 26 : 22} rx={3} />
                    <text x={x} y={y + 2} text-anchor="middle" font-size="7" font-weight="800" fill={C.ink} stroke="none">
                      T{t.n}
                    </text>
                  </g>
                );
              }),
          )}
        </g>

        {/* runway + apron */}
        <g transform="translate(140 92) rotate(-14)">
          <rect x={-88} y={-11} width={176} height={22} rx={3} fill="#626d72" />
          <rect x={-88} y={-11} width={176} height={4} fill="#566064" />
          {Array.from({ length: 9 }, (_, i) => (
            <rect key={i} x={-78 + i * 18} y={-1} width={10} height={2} fill="#fbf5e9" opacity=".85" />
          ))}
          <rect x={-86} y={-8} width={3} height={16} fill="#fbf5e9" opacity=".6" />
          <rect x={83} y={-8} width={3} height={16} fill="#fbf5e9" opacity=".6" />
        </g>
        <path d="M112 118 L208 108 L214 146 L118 156 Z" fill="#8b9599" opacity=".55" />

        {/* windsock */}
        <g transform="translate(226 64)">
          <line x1="0" y1="0" x2="0" y2="-16" stroke={C.ink} stroke-width="1.5" />
          <path d={s.weather === 'clear' ? 'M0 -16 l9 3 l0 3 l-9 1z' : 'M0 -16 l14 1 l0 4 l-14 1z'} fill={C.mech} class={motion ? 'drift' : ''} />
        </g>

        {/* hangar */}
        <g transform="translate(62 128)">
          <ellipse cx={4} cy={17} rx={34} ry={6} fill="rgba(31,42,48,.16)" />
          <rect x={-28} y={-6} width={56} height={22} fill="#eadcc2" />
          <path d="M-31 -5 Q0 -34 31 -5 Z" fill={hangarColor} />
          <path d="M0 -20 Q20 -16 31 -5 L0 -5 Z" fill="rgba(31,42,48,.14)" />
          <rect x={-16} y={0} width={32} height={16} fill="#3b464b" />
          {aog.map((p, i) => (
            <g key={p.id}>
              <g transform={`translate(${-6 + i * 12} 9) scale(.5)`}>
                <Plane x={0} y={0} cargo={p.model === 'cargo'} rot={0} />
              </g>
            </g>
          ))}
        </g>
        {aog.length > 0 && <Tag x={62} y={100} text="AOG" />}

        {/* planes on the apron / dock */}
        {parked.map((p) => {
          const [x, y] = POS[p.id] ?? [150, 130];
          const grounded = !!s.tags?.[p.id];
          return (
            <g key={p.id} opacity={grounded ? 0.7 : 1}>
              <Plane x={x} y={y} cargo={p.model === 'cargo'} />
              {grounded ? <Tag x={x + 14} y={y - 16} text="GND" /> : p.health < 60 && <Tag x={x + 12} y={y - 16} />}
            </g>
          );
        })}
        {s.tier >= 3 && (
          <g>
            <rect x={78} y={238} width={10} height={44} fill="#9b7a52" transform="rotate(-24 83 240)" />
            <rect x={96} y={236} width={10} height={10} rx={2} fill={C.rust} opacity="0" />
            <circle cx={104} cy={240} r={4} fill={C.mech} />
          </g>
        )}
        {floatPlane && floatPlane.health >= 40 && (
          <g>
            <Plane x={POS.p3[0]} y={POS.p3[1]} float rot={20} />
            {floatPlane.health < 60 && <Tag x={POS.p3[0] + 14} y={POS.p3[1] - 16} />}
          </g>
        )}

        {/* office */}
        <g transform="translate(194 156)">
          <ellipse cx={3} cy={12} rx={24} ry={5} fill="rgba(31,42,48,.15)" />
          <rect x={-18} y={-10} width={36} height={22} fill="#f7ecd8" />
          <rect x={0} y={-10} width={18} height={22} fill="#eadcc2" />
          <path d="M-21 -10 L21 -10 L17 -18 L-17 -18 Z" fill={officeColor} />
          {[-15, -7, 1, 9].map((dx) => (
            <path key={dx} d={`M${dx} -10 l4 0 l0 5 l-2 2 l-2 -2z`} fill={officeColor} />
          ))}
          <path d="M-21 -10 L21 -10" stroke="#fff" stroke-width=".6" opacity=".6" />
          <rect x={-13} y={-2} width={9} height={7} fill="#cfd8d8" />
          <rect x={4} y={-2} width={9} height={7} fill="#cfd8d8" />
          <line x1={20} y1={-18} x2={20} y2={-34} stroke={C.ink} stroke-width="1.2" />
          <path d="M20 -34 l10 3 l-10 3z" fill={C.fin} />
          {s.cash < 2000 && <Tag x={0} y={-26} text="$" />}
        </g>

        {/* generator (tier 3) */}
        {gen && (
          <g transform={`translate(${POS.gen[0]} ${POS.gen[1]})`}>
            <ellipse cx={2} cy={8} rx={14} ry={4} fill="rgba(31,42,48,.14)" />
            <rect x={-11} y={-6} width={22} height={14} fill="#dcd2bd" />
            <path d="M-13 -6 L13 -6 L10 -11 L-10 -11 Z" fill="#7f8b90" />
            <rect x={5} y={-17} width={3} height={8} fill="#56646b" />
            {pw.gridDown && pw.genOK && <circle cx={6.5} cy={-20} r={3} fill="#cfd8d8" class={motion ? 'smoke' : ''} />}
            {gen.health < 50 && <Tag x={0} y={-24} />}
          </g>
        )}

        {/* solar (tier 5) */}
        {s.tier >= 5 && (
          <g transform="translate(140 196) skewX(-20)">
            {[0, 1, 2].map((r) =>
              [0, 1, 2, 3].map((c) => <rect key={`${r}${c}`} x={c * 9} y={r * 7} width={8} height={6} fill={C.seaDeep} stroke="#8fb8de" stroke-width=".6" />),
            )}
          </g>
        )}

        {/* grid: transformer + lines */}
        {grid && (
          <g>
            {houses.map((h) => {
              const [hx, hy] = POS[h.id] ?? [0, 0];
              const [gx, gy] = POS.g1;
              const live = pw.on;
              return (
                <path
                  key={h.id}
                  d={`M${gx} ${gy - 16} Q ${(gx + hx) / 2} ${Math.min(gy, hy) - 26} ${hx} ${hy - 12}`}
                  stroke={live ? C.elec : '#56646b'}
                  stroke-width={live ? 1.2 : 0.9}
                  fill="none"
                  opacity={live ? 0.9 : 0.5}
                  class={live && grid.health < 60 && motion ? 'flicker' : ''}
                />
              );
            })}
            <g transform={`translate(${POS.g1[0]} ${POS.g1[1]})`}>
              <line x1={0} y1={6} x2={0} y2={-18} stroke="#6b5438" stroke-width="2.5" />
              <line x1={-7} y1={-14} x2={7} y2={-14} stroke="#6b5438" stroke-width="2" />
              <rect x={-5} y={-10} width={10} height={9} rx={2} fill="#9aa5a9" stroke={C.ink} stroke-width=".6" />
              {grid.health < 40 && <Tag x={0} y={-26} />}
            </g>
          </g>
        )}

        {/* houses */}
        {houses.map((h) => {
          const rentable = houseRentable(s, h);
          const dim = !pw.on;
          return (
            <g key={h.id}>
              <House a={h} tint={houseColor} lit={rentable && (night || phase === 'golden' || booked > 0)} dim={dim} big={h.model === 'villa'} lodge={h.model === 'lodge'} />
              {h.health < 30 && (
                <g transform={`translate(${POS[h.id][0] + 6} ${POS[h.id][1] - 16})`}>
                  <circle r={4} fill="#9aa5a9" class={motion ? 'smoke' : ''} />
                  <circle r={3} cx={3} cy={-4} fill="#b8c0c2" class={motion ? 'smoke' : ''} style={{ animationDelay: '1.2s' }} />
                </g>
              )}
              {!rentable && <Tag x={POS[h.id][0] + 12} y={POS[h.id][1] - 22} text={s.tags?.[h.id] ? 'TAG' : undefined} />}
            </g>
          );
        })}

        {/* palms */}
        {[
          [48, 168, 1],
          [95, 210, 0.9],
          [176, 236, 1.1],
          [292, 248, 1],
          [360, 186, 0.9],
          [332, 96, 1],
          [250, 80, 0.85],
          [124, 186, 0.8],
        ].map(([x, y, sc], i) => (
          <Palm key={i} x={x} y={y} s={sc} motion={motion} />
        ))}

        {/* a guest walking from the apron to the cottages */}
        {booked > 0 && flying && motion && (
          <circle r={2.4} fill={C.ink}>
            <animateMotion dur="16s" repeatCount="indefinite" {...({ path: 'M170 142 C 210 150, 228 128, 262 116' } as Record<string, string>)} />
          </circle>
        )}

        {/* lights on top of the night overlay */}
      </g>

      <rect width="400" height="300" fill={overlay.fill} opacity={overlay.o} pointer-events="none" />
      {night && (
        <g class="island-zoom" style={{ transform: zoom }} pointer-events="none">
          {houses
            .filter((h) => houseRentable(s, h))
            .map((h) => {
              const [x, y] = POS[h.id];
              return <circle key={h.id} cx={x} cy={y + 3} r={10} fill={C.elec} opacity=".35" filter="url(#glow)" />;
            })}
          <circle cx={194} cy={158} r={10} fill={C.elec} opacity=".3" filter="url(#glow)" />
        </g>
      )}

      {/* weather */}
      {s.weather === 'wind' && motion && (
        <g stroke="#fbf5e9" stroke-width="1.4" opacity=".7" stroke-linecap="round" pointer-events="none">
          {[40, 120, 200].map((y, i) => (
            <line key={y} x1={0} y1={y} x2={60} y2={y - 4} style={{ animation: `streak ${3 + i}s linear ${i * 0.8}s infinite` }} />
          ))}
        </g>
      )}
      {s.weather === 'storm' && (
        <g pointer-events="none">
          <rect width="400" height="300" fill="#1f2a30" opacity=".28" />
          <g fill="#56646b" opacity=".85">
            <ellipse cx={90} cy={30} rx={70} ry={20} />
            <ellipse cx={160} cy={22} rx={60} ry={18} />
            <ellipse cx={300} cy={34} rx={80} ry={22} />
          </g>
          {motion && (
            <g stroke="#cfd8d8" stroke-width="1" opacity=".6">
              {Array.from({ length: 22 }, (_, i) => (
                <line key={i} x1={i * 19} y1={0} x2={i * 19 - 6} y2={16} style={{ animation: `rain ${0.9 + (i % 4) * 0.15}s linear ${(i % 5) * 0.2}s infinite` }} />
              ))}
            </g>
          )}
        </g>
      )}
      {flying && motion && s.weather !== 'storm' && (
        <g class="flyby" pointer-events="none" opacity=".9">
          <g transform="scale(.55)">
            <path d="M0 0 l22 -4 l4 2 l-22 6z" fill="#fbf5e9" />
            <path d="M8 -2 l-4 -9 l4 0 l6 8z M10 2 l-3 8 l4 0 l5 -8z" fill="#fbf5e9" />
          </g>
        </g>
      )}
    </svg>
  );
}
