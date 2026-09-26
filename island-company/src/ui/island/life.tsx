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
    </>
  );
}

export const Guy = ({ x, y, c }: { x: number; y: number; c: string }) => <use href="#i-guy" transform={`translate(${Math.round(x)} ${Math.round(y)})`} style={{ color: c }} />;

// ------------------------------------------------------------ sea life ---
export function SeaLife({ motion, boats }: { motion: boolean; boats: number }) {
  return (
    <g>
      {/* whale off the north shore, spouting */}
      <g transform="translate(318 34)">
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
      </g>
      {/* dolphin leaping off the south-west */}
      <g transform="translate(56 540)">
        <g class={motion ? 'leap' : undefined}>
          <path d="M-14 4Q-4 -18 14 -6Q10 -8 6 -6Q-2 -12 -10 4Z" fill="#6b8fb5" />
          <path d="M-2 -10l3 -6l3 5z" fill="#6b8fb5" />
          <path d="M12 -7l6 1l-5 2z" fill="#6b8fb5" />
          <path d="M-8 1Q-2 -8 8 -6" stroke="#c8dcef" stroke-width="1.6" fill="none" />
        </g>
        <path d="M-20 8q5 -4 10 0M10 8q5 -4 10 0" stroke="#fff" stroke-width="1.6" fill="none" />
      </g>
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
export function Clouds({ storm, motion }: { storm: boolean; motion: boolean }) {
  const top = storm ? '#8d97a4' : '#ffffff';
  const under = storm ? '#687382' : '#cfe4f6';
  const cl = (x: number, y: number, s: number, key: string) => (
    <g key={key} transform={`translate(${x} ${y}) scale(${s})`}>
      <path d={CLOUD} fill="rgba(10,60,130,.18)" transform="translate(14 20)" />
      <path d={CLOUD} fill={under} transform="translate(2 6)" />
      <path d={CLOUD} fill={top} />
      <path d={CLOUD_HI} stroke="#fff" stroke-width="4" fill="none" opacity={storm ? 0.2 : 0.95} stroke-linecap="round" />
    </g>
  );
  return (
    <g class={motion ? 'cloud' : undefined}>
      {cl(-6, 6, 1.25, 'a')}
      {cl(64, -14, 0.9, 'b')}
      {cl(-26, 62, 0.8, 'c')}
      {cl(752, 582, 1.3, 'd')}
      {cl(690, 606, 0.9, 'e')}
      {cl(808, 530, 0.8, 'f')}
      {storm && cl(360, -6, 1.2, 'g')}
      {storm && cl(470, -14, 1, 'h')}
      {storm && cl(250, -10, 0.9, 'i')}
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
  [20, 180, 1], [16, 300, 1.3], [24, 480, 1], [120, 560, 1.2], [300, 580, 1], [520, 560, 1.4], [600, 588, 1], [786, 450, 1.2], [770, 520, 1],
  [640, 20, 1.6], [360, 44, 1],
];
export function NightSky({ motion }: { motion: boolean }) {
  return (
    <g pointer-events="none">
      <path d={STARS.map(([x, y, r]) => `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`).join('')} fill="#fff8d8" />
      <g class={motion ? 'twinkle' : undefined}>
        <path d="M200 30l1.5 4l4 1.5l-4 1.5l-1.5 4l-1.5 -4l-4 -1.5l4 -1.5zM740 150l1.2 3l3 1.2l-3 1.2l-1.2 3l-1.2 -3l-3 -1.2l3 -1.2zM60 420l1.2 3l3 1.2l-3 1.2l-1.2 3l-1.2 -3l-3 -1.2l3 -1.2z" fill="#fffbe6" />
      </g>
      <g transform="translate(756 44)">
        <circle r={20} fill="#fff6c9" opacity=".18" />
        <path d="M-6 -13A14 14 0 1 0 12 7A11 11 0 1 1 -6 -13Z" fill="#fff4c2" />
      </g>
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

export function Rain({ motion }: { motion: boolean }) {
  const drops = (seed: number) =>
    Array.from({ length: 34 }, (_, i) => {
      const x = (i * 97 + seed * 41) % W;
      const y = ((i * 53 + seed * 29) % 150) - 150;
      return [0, 150, 300, 450, 600].map((o) => `M${x} ${y + o}l-5 16`).join('');
    }).join('');
  return (
    <g pointer-events="none">
      <rect width={W} height={H} fill="#1d2a3a" opacity=".3" />
      {motion ? (
        <g stroke="#dbe8f2" stroke-width="1.4" opacity=".55" stroke-linecap="round">
          <path d={drops(1)} class="rain" />
          <path d={drops(2)} class="rain" style={{ animationDuration: '1.1s', animationDelay: '-.4s' }} />
        </g>
      ) : (
        <path d={drops(1)} stroke="#dbe8f2" stroke-width="1.4" opacity=".45" />
      )}
      {motion && <rect width={W} height={H} fill="#fff" class="flash" opacity="0" />}
    </g>
  );
}
