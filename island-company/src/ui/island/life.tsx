// Life and sky: sea creatures, boats, clouds framing two corners, people,
// gulls, the night sky and the weather overlays.
import { H, W } from './geo';
import { Sailboat } from './craft';
import { K } from './paint';

export function LifeDefs() {
  return (
    <>
      <symbol id="i-guy" overflow="visible">
        <ellipse cx="2.5" cy=".6" rx="4" ry="1.4" fill="rgba(20,50,30,.3)" />
        <path d="M-1.6 0v-4M1.6 0v-4" stroke="#3b4650" stroke-width="1.7" stroke-linecap="round" />
        <path d="M-3 -4v-4.6a3 3 0 0 1 6 0v4.6z" fill="currentColor" />
        <circle cy="-11" r="2.6" fill="#f2c7a0" />
        <path d="M-2.6 -11.6a2.6 2.6 0 0 1 5.2 0z" fill="#5a3d2b" />
      </symbol>
      <symbol id="i-swim" overflow="visible">
        <ellipse rx="6" ry="2.2" fill="none" stroke="#fff" stroke-width="1.2" opacity=".8" />
        <circle cy="-1.5" r="2.4" fill="#f2c7a0" />
        <path d="M-2.4 -2a2.4 2.4 0 0 1 4.8 0z" fill="currentColor" />
      </symbol>
      <symbol id="i-towel" overflow="visible">
        <path d="M-8 -3h16v6h-16z" fill="currentColor" />
        <path d="M-8 -1h16" stroke="#fff" stroke-width="1" opacity=".7" />
        <circle cx="-4" cy="0" r="2.2" fill="#f2c7a0" />
        <path d="M-2 -1.4h8v2.8h-8z" fill="#fff" opacity=".9" />
      </symbol>
      <symbol id="i-gull" overflow="visible">
        <path d="M-6 0q3 -3 6 0q3 -3 6 0" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round" />
      </symbol>
      <radialGradient id="i-glow">
        <stop offset="0" stop-color="#ffe7a0" stop-opacity=".95" />
        <stop offset=".4" stop-color="#ffc861" stop-opacity=".45" />
        <stop offset="1" stop-color="#ffb347" stop-opacity="0" />
      </radialGradient>
      <linearGradient id="i-beam" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#fff3b0" stop-opacity=".75" />
        <stop offset="1" stop-color="#fff3b0" stop-opacity="0" />
      </linearGradient>
      <radialGradient id="i-nightvig" cx=".5" cy=".5" r=".72">
        <stop offset=".55" stop-color="#040a24" stop-opacity="0" />
        <stop offset="1" stop-color="#040a24" stop-opacity=".55" />
      </radialGradient>
      <radialGradient id="i-stormvig" cx=".5" cy=".55" r=".75">
        <stop offset=".45" stop-color="#1a2230" stop-opacity="0" />
        <stop offset="1" stop-color="#1a2230" stop-opacity=".62" />
      </radialGradient>
      <radialGradient id="i-moonpath" cx=".5" cy=".35" r=".6">
        <stop offset="0" stop-color="#fff4c2" stop-opacity=".45" />
        <stop offset="1" stop-color="#fff4c2" stop-opacity="0" />
      </radialGradient>
      <linearGradient id="i-dawn" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ff6f9c" stop-opacity=".46" />
        <stop offset=".32" stop-color="#ffa98a" stop-opacity=".2" />
        <stop offset=".7" stop-color="#ffd0b0" stop-opacity=".06" />
        <stop offset="1" stop-color="#8fa6ff" stop-opacity=".16" />
      </linearGradient>
      <radialGradient id="i-dawnsun" cx="1" cy="0" r=".6">
        <stop offset="0" stop-color="#fff3d0" stop-opacity=".7" />
        <stop offset=".35" stop-color="#ffc0a0" stop-opacity=".22" />
        <stop offset="1" stop-color="#ffc0a0" stop-opacity="0" />
      </radialGradient>
      <linearGradient id="i-golden" x1="0" y1=".2" x2="1" y2=".8">
        <stop offset="0" stop-color="#ffd49a" />
        <stop offset=".55" stop-color="#ffc58e" />
        <stop offset="1" stop-color="#f2a6ae" />
      </linearGradient>
      <radialGradient id="i-goldsun" cx="0" cy=".8" r=".6">
        <stop offset="0" stop-color="#fff0b8" stop-opacity=".55" />
        <stop offset=".45" stop-color="#ffc45c" stop-opacity=".16" />
        <stop offset="1" stop-color="#ffc45c" stop-opacity="0" />
      </radialGradient>
      <linearGradient id="i-stormtop" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#2e3542" stop-opacity=".7" />
        <stop offset="1" stop-color="#2e3542" stop-opacity="0" />
      </linearGradient>
    </>
  );
}

export const Guy = ({ x, y, c }: { x: number; y: number; c: string }) => <use href="#i-guy" transform={`translate(${Math.round(x)} ${Math.round(y)})`} style={{ color: c }} />;

// ------------------------------------------------------------ sea life ---
export function SeaLife({ motion, boats, storm }: { motion: boolean; boats: number; storm: boolean }) {
  return (
    <g>
      {/* whale off the north shore, spouting (it dives when a storm comes in) */}
      {!storm && <g transform="translate(318 34)">
        <ellipse cx={4} cy={4} rx={30} ry={7} fill="#fff" opacity=".35" />
        <path d="M-24 4Q-18 -12 2 -12Q18 -12 24 4Z" fill="#35577e" />
        <path d="M-16 0Q-8 -8 6 -8" stroke="#6f93bb" stroke-width="3" fill="none" stroke-linecap="round" />
        <circle cx={14} cy={-3} r={1.4} fill="#10263e" />
        <path d="M-30 2q-6 -10 -12 -8q6 2 8 8q-6 -2 -10 2q8 2 14 -2z" fill="#35577e" />
        <path d="M-26 5q10 -3 20 0M4 6q10 -3 20 0" stroke="#fff" stroke-width="1.6" fill="none" opacity=".8" />
        <g transform="translate(4 -12)">
          <g class={motion ? 'spout' : undefined}>
            <path d="M0 0Q-1 -10 -7 -16M0 0Q1 -11 7 -17M0 0V-19" stroke="#e8f8ff" stroke-width="2.6" fill="none" stroke-linecap="round" />
            <path d="M-9 -18a2.4 2.4 0 1 0 .1 0M9 -19a2.4 2.4 0 1 0 .1 0M0 -22a2.6 2.6 0 1 0 .1 0" fill="#fff" />
          </g>
        </g>
      </g>}
      {/* dolphin leaping off the south-west */}
      {!storm && <g transform="translate(56 540)">
        <g class={motion ? 'leap' : undefined}>
          <path d="M-14 4Q-4 -18 14 -6Q10 -8 6 -6Q-2 -12 -10 4Z" fill="#6b8fb5" />
          <path d="M-2 -10l3 -6l3 5z" fill="#6b8fb5" />
          <path d="M12 -7l6 1l-5 2z" fill="#6b8fb5" />
          <path d="M-8 1Q-2 -8 8 -6" stroke="#c8dcef" stroke-width="1.6" fill="none" />
        </g>
        <path d="M-20 8q5 -4 10 0M10 8q5 -4 10 0" stroke="#fff" stroke-width="1.6" fill="none" />
      </g>}
      {/* sailboats; more of them when business is good */}
      {[
        [238, 566, '#ffffff', K.blue], [626, 30, '#ffd23f', '#e8453c'], [30, 110, '#ffffff', '#4caf50'], [118, 578, '#ff9fc4', K.blue],
      ]
        .slice(0, boats)
        .map(([x, y, sail, stripe], i) => (
          <g key={i} transform={`translate(${x} ${y})`}>
            <g class={motion ? 'drift' : undefined} style={{ animationDelay: `${-i * 2.3}s` }}>
              <Sailboat sail={sail as string} stripe={stripe as string} />
            </g>
          </g>
        ))}
    </g>
  );
}

// -------------------------------------------------------------- clouds ---
const PUFFS: [number, number, number][] = [[0, 0, 22], [26, -8, 19], [48, 2, 17], [24, 12, 17], [-20, 8, 15], [4, 16, 14]];
const CLOUD = PUFFS.map(([x, y, r]) => `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`).join('');
const CLOUD_HI = 'M-10 -8a10 10 0 0 1 14 -10M20 -16a9 9 0 0 1 14 -4';
/** fair-weather clouds frame two corners; a storm brings a heavy deck along the top and sides */
const FAIR: [number, number, number][] = [[-6, 6, 1.25], [64, -14, 0.9], [-26, 62, 0.8], [752, 582, 1.3], [690, 606, 0.9], [808, 530, 0.8]];
const STORM: [number, number, number][] = [
  [-20, 22, 1.7], [112, -16, 1.45], [252, -34, 1.3], [400, -40, 1.3], [546, -34, 1.35], [684, -14, 1.55], [822, 34, 1.7],
  [180, -2, 1.1], [330, -12, 1.05], [470, -8, 1.1], [612, -2, 1.05],
  [-42, 178, 1.25], [842, 206, 1.25], [-34, 578, 1.6], [120, 630, 1.25], [676, 628, 1.35], [822, 556, 1.6],
];
export function Clouds({ storm, motion, night }: { storm: boolean; motion: boolean; night?: boolean }) {
  const list = storm ? STORM : FAIR;
  const top = storm ? (night ? '#454e60' : '#7b8595') : '#ffffff';
  const under = storm ? (night ? '#262c38' : '#434b58') : '#cfe4f6';
  const tr = (x: number, y: number, s: number, dx = 0, dy = 0) => `translate(${x + dx} ${y + dy}) scale(${s})`;
  return (
    <g>
      {/* a storm brings a low deck across the whole top of the view, and lightning in it */}
      {storm && <rect x={-60} y={-60} width={W + 120} height={200} fill="url(#i-stormtop)" />}
      {storm && (
        <g transform="translate(178 38)">
          <g class={motion ? 'flicker' : undefined}>
            <path d="M0 0l-9 20h8l-12 26l22 -32h-8l9 -14z" fill="#fff8c8" stroke="#ffd84a" stroke-width="1.6" stroke-linejoin="round" />
          </g>
        </g>
      )}
    <g class={motion ? 'cloud' : undefined}>
      {/* merged per tone: a whole cloud deck costs four nodes a cloud at most */}
      {list.map(([x, y, s], i) => (
        <path key={`s${i}`} d={CLOUD} fill={storm ? 'rgba(10,20,40,.3)' : 'rgba(10,60,130,.18)'} transform={tr(x, y, s, 14, 20)} />
      ))}
      {list.map(([x, y, s], i) => (
        <path key={`u${i}`} d={CLOUD} fill={under} transform={tr(x, y, s, 2, 6)} />
      ))}
      {list.map(([x, y, s], i) => (
        <path key={`t${i}`} d={CLOUD} fill={top} transform={tr(x, y, s)} />
      ))}
      {list.map(([x, y, s], i) => (
        <path key={`h${i}`} d={CLOUD_HI} stroke={storm ? (night ? '#6b7486' : '#c3cad4') : '#fff'} stroke-width="4" fill="none" opacity={storm ? 0.7 : 0.95} stroke-linecap="round" transform={tr(x, y, s)} />
      ))}
    </g>
    </g>
  );
}

export function Gulls({ motion }: { motion: boolean }) {
  return (
    <g class={motion ? 'gulls' : undefined} opacity=".9">
      <use href="#i-gull" transform="translate(212 58)" />
      <use href="#i-gull" transform="translate(228 66) scale(.8)" />
      <use href="#i-gull" transform="translate(560 520) scale(.9)" />
    </g>
  );
}

// ----------------------------------------------------------------- sky ---
const STARS: [number, number, number][] = [
  [30, 60, 1.4], [90, 30, 1], [160, 50, 1.2], [260, 20, 1.6], [420, 24, 1], [520, 16, 1.3], [690, 40, 1], [780, 90, 1.4], [790, 200, 1],
  [20, 180, 1], [16, 300, 1.3], [24, 480, 1], [120, 570, 1.2], [300, 580, 1], [520, 568, 1.4], [600, 588, 1], [786, 450, 1.2], [770, 540, 1],
  [640, 20, 1.6], [360, 44, 1], [200, 90, 1], [720, 70, 1.1],
];
const MOON: [number, number] = [762, 40];
export function NightSky({ motion }: { motion: boolean }) {
  const [mx, my] = MOON;
  return (
    <g pointer-events="none">
      <path d={STARS.map(([x, y, r]) => `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`).join('')} fill="#fff8d8" />
      <g class={motion ? 'twinkle' : undefined}>
        <path d="M200 30l1.5 4l4 1.5l-4 1.5l-1.5 4l-1.5 -4l-4 -1.5l4 -1.5zM790 250l1.2 3l3 1.2l-3 1.2l-1.2 3l-1.2 -3l-3 -1.2l3 -1.2zM40 420l1.2 3l3 1.2l-3 1.2l-1.2 3l-1.2 -3l-3 -1.2l3 -1.2z" fill="#fffbe6" />
      </g>
      {/* moon, and a soft sheen of it on the sea with a few loose glints */}
      <ellipse cx={mx - 24} cy={my + 64} rx={34} ry={22} fill="url(#i-moonpath)" opacity=".6" />
      <path d={`M${mx - 36} ${my + 50}q4 -2 8 0M${mx - 8} ${my + 58}q5 -2.5 10 0M${mx - 30} ${my + 74}q3 -1.5 6 0M${mx - 52} ${my + 66}q4 -2 8 0`} stroke="#fff4c2" stroke-width="1.5" fill="none" stroke-linecap="round" opacity=".5" />
      <circle cx={mx} cy={my} r={24} fill="#fff6c9" opacity=".16" />
      <path d={`M${mx - 6} ${my - 13}A14 14 0 1 0 ${mx + 12} ${my + 7}A11 11 0 1 1 ${mx - 6} ${my - 13}Z`} fill="#fff4c2" />
    </g>
  );
}

/** Night: a cool multiply grade (keeps dark darks and every edge; no grey
 *  wash) and a soft vignette. The moonlit rim on the lip and the surf's glow
 *  are part of the ground (terrain.tsx), under the trees and buildings. */
export function NightGrade({ coast }: { coast: string }) {
  return (
    <g pointer-events="none">
      <rect x={-60} y={-60} width={W + 120} height={H + 120} fill="#5a6cb0" style={{ mixBlendMode: 'multiply' }} />
      {/* moonlight lifts the land's mid-tones, so it separates from the sea */}
      <path d={coast} fill="#7f95d6" opacity=".22" style={{ mixBlendMode: 'screen' }} />
      <rect x={-60} y={-60} width={W + 120} height={H + 120} fill="url(#i-nightvig)" />
    </g>
  );
}

/** Dawn: a pink-to-peach wash from the top, the sun coming up in the east
 *  (upper right), and mist lying on the sea. Plain fills, no blending. */
export function DawnGrade() {
  return (
    <g pointer-events="none">
      <rect x={-60} y={-60} width={W + 120} height={H + 120} fill="url(#i-dawn)" />
      <rect x={-60} y={-60} width={W + 120} height={H + 120} fill="url(#i-dawnsun)" />
      <Mist />
    </g>
  );
}
const MIST: [number, number, number][] = [
  [140, 60, 130], [550, 44, 120], [4, 330, 64], [8, 480, 60], [690, 562, 120], [240, 590, 120], [768, 250, 50], [450, 574, 80],
];
/** low banks of mist on the water: long soft wavy bands, stacked thin to thick */
function Mist() {
  const d = MIST.map(([x, y, l]) => `M${x} ${y}q${l / 4} -5 ${l / 2} 0t${l / 2} 0M${x + l * 0.25} ${y + 10}q${l / 6} -3 ${l / 3} 0t${l / 3} 0`).join('');
  return (
    <g fill="none" stroke="#fff" stroke-linecap="round">
      <path d={d} stroke-width="22" opacity=".1" />
      <path d={d} stroke-width="12" opacity=".12" />
      <path d={d} stroke-width="5" opacity=".14" />
    </g>
  );
}

/** Golden hour: a strong amber multiply grade (keeps the darks, so nothing
 *  goes hazy), deepening to rose in the east, the sun low in the west. */
export function GoldenGrade() {
  return (
    <g pointer-events="none">
      <rect x={-60} y={-60} width={W + 120} height={H + 120} fill="url(#i-golden)" style={{ mixBlendMode: 'multiply' }} />
      <rect x={-60} y={-60} width={W + 120} height={H + 120} fill="url(#i-goldsun)" />
    </g>
  );
}

/** Storm: a darker, cooler grade that falls off toward the edges so the
 *  island in the middle stays readable. */
export function StormGrade() {
  return (
    <g pointer-events="none">
      <rect x={-60} y={-60} width={W + 120} height={H + 120} fill="#b4bfd2" style={{ mixBlendMode: 'multiply' }} />
      <rect x={-60} y={-60} width={W + 120} height={H + 120} fill="url(#i-stormvig)" />
    </g>
  );
}

// ------------------------------------------------------------- weather ---
const GUST = 'M0 0h46q16 0 16 -11q0 -9 -9 -9q-7 0 -7 7';
const GUSTS: [number, number, number][] = [[70, 96, 1], [250, 236, 0.8], [560, 118, 0.9], [120, 440, 0.9], [610, 404, 1], [360, 560, 0.8]];
export function Wind({ motion }: { motion: boolean }) {
  return (
    <g stroke="#fff" stroke-width="3" opacity=".85" stroke-linecap="round" fill="none" pointer-events="none">
      {GUSTS.map(([x, y, s], i) => (
        <g key={i} transform={`translate(${x} ${y}) scale(${s})`}>
          <g class={motion ? 'gust' : undefined} style={motion ? { animationDelay: `${-i * 0.7}s` } : undefined}>
            <path d={GUST} />
            <path d="M8 10h30" opacity=".7" />
          </g>
        </g>
      ))}
    </g>
  );
}

/** three sheets of rain: fine far drizzle, long streaks, short heavy drops */
export function Rain({ motion }: { motion: boolean }) {
  const drops = (n: number, seed: number, len: number, slant: number) =>
    Array.from({ length: n }, (_, i) => {
      const x = (i * 97 + seed * 41) % (W + 60);
      const y = ((i * 53 + seed * 29) % 150) - 150;
      return [0, 150, 300, 450, 600].map((o) => `M${x} ${y + o}l${-slant} ${len}`).join('');
    }).join('');
  const sheets = [
    { d: drops(40, 3, 10, 3), c: '#c9d6e2', w: 1, o: 0.4, dur: '1.3s' },
    { d: drops(30, 1, 22, 7), c: '#e4eef6', w: 1.4, o: 0.6, dur: '.8s' },
    { d: drops(16, 2, 12, 5), c: '#ffffff', w: 2.2, o: 0.7, dur: '.6s' },
  ];
  return (
    <g pointer-events="none" stroke-linecap="round">
      {sheets.map((r, i) => (
        <path key={i} d={r.d} stroke={r.c} stroke-width={r.w} opacity={r.o} class={motion ? 'rain' : undefined} style={motion ? { animationDuration: r.dur, animationDelay: `${-i * 0.3}s` } : undefined} />
      ))}
      {motion && <rect width={W} height={H} fill="#fff" class="flash" opacity="0" />}
      {motion && <path d="M706 34l-16 32h13l-20 40l34 -48h-13l15 -24z" fill="#fffbe0" stroke="#ffe27a" stroke-width="1.5" stroke-linejoin="round" class="bolt" opacity="0" />}
    </g>
  );
}
