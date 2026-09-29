// The electrician's IR scan (docs/EXPANSION.md 6.4): the dead front off, the
// panel under a thermal camera. It opens on the PPE line. Each breaker shows its
// rating, its conductor, its load (amps and % of rating) and its temperature rise
// over ambient; the camera paints the lugs by their temperature, the way a real
// one does, never by whether they're wrong. He taps the breaker he'd open, then
// Open it up; or All normal. At most 3 taps from the sheet.
//
// Reading it is the skill: a healthy termination's rise grows with the square of
// its load, so a lug at half load running as hot as a neighbour at 90% is the one
// (I²R at a loose lug). Under 30% it's too light to judge. The generator is scanned
// during its weekly test run: its generator-side and load-side lugs carry the same
// current, so they're compared with each other (NETA's ΔT between similar parts).
import { useState } from 'preact/hooks';
import type { CheckItem, CheckView } from '../../sim/checks';
import { hashSeed, rng } from '../../sim/rng';
import type { Asset, IslandState } from '../../sim/types';
import { fx } from '../feedback';
import { Icon } from '../kit';
import { CheckFoot, Help } from './parts';

/** magma, as a thermal camera's palette: cold (ambient) to white hot */
const STOPS: [number, string][] = [
  [0, '#0b0620'],
  [0.14, '#2a0f55'],
  [0.3, '#57157e'],
  [0.46, '#8c2981'],
  [0.6, '#c13a73'],
  [0.72, '#e8575f'],
  [0.84, '#fb8b5e'],
  [0.94, '#fec488'],
  [1, '#fcf6c4'],
];
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
/** the palette at t in 0..1 */
export function heat(t: number): string {
  const x = Math.max(0, Math.min(1, t));
  for (let i = 1; i < STOPS.length; i++) {
    const [t1, c1] = STOPS[i];
    const [t0, c0] = STOPS[i - 1];
    if (x <= t1) {
      const f = (x - t0) / (t1 - t0);
      const a = hex(c0);
      const b = hex(c1);
      return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(',')})`;
    }
  }
  return STOPS[STOPS.length - 1][1];
}

/** the camera's span over ambient, °C (a tell reads up to about +30) */
export const SPAN = 30;
/** a rise over ambient as the palette's position: a little gamma so a warm lug glows before it's white hot */
const tOf = (rise: number) => Math.pow(Math.max(0, Math.min(1, rise / SPAN)), 0.75);
/** the day's ambient where the panel is (an island afternoon, 27-31 °C), seeded by the asset and the week */
export const ambientOf = (s: IslandState, a: Pick<Asset, 'id'>) => 27 + rng(hashSeed(s.seed, 'ambient', a.id, s.week)).int(0, 4);

/** a breaker's name as the camera's overlay prints it */
const SHORT: Record<string, string> = {
  main: 'MAIN',
  cfeedE: 'East cott.',
  cfeedW: 'West cott.',
  hangar: 'Hangar',
  office: 'Office',
  dock: 'Fuel dock',
  xfer: 'Xfer feed',
  villas: 'Villas',
  lodge: 'Lodge',
  edge: 'Edge lts',
  xferG: 'Gen side',
  xferL: 'Load side',
  genbrk: 'Gen main',
  xferU: 'Utility side',
};
const shortOf = (it: CheckItem) => SHORT[it.id] ?? it.label.split(' ')[0];

type Cell = { it: CheckItem; x: number; y: number; w: number; h: number };

/** the camera frame: the main across the top, the branches (or the transfer switch's lugs) in two columns */
function layout(items: CheckItem[]): { cells: Cell[]; h: number } {
  const main = items.find((i) => i.id === 'main');
  const rest = items.filter((i) => i !== main);
  const cells: Cell[] = [];
  let y = 12;
  if (main) {
    cells.push({ it: main, x: 86, y, w: 148, h: 50 });
    y += 60;
  }
  rest.forEach((it, i) => cells.push({ it, x: i % 2 ? 164 : 8, y: y + Math.floor(i / 2) * 48, w: 148, h: 44 }));
  return { cells, h: y + Math.ceil(rest.length / 2) * 48 + 34 };
}

/** the thermal image of the panel; a tap on a breaker picks it */
export function IrImage({ view, amb, pick, onPick }: { view: CheckView; amb: number; pick: string | null; onPick(id: string): void }) {
  const { cells, h } = layout(view.items);
  return (
    <svg class="qc-art ir-img" viewBox={`0 0 320 ${h}`} role="img" aria-label={`Thermal image: ${view.items.length} ${view.items.some((i) => i.id === 'xferG') ? 'terminations' : 'breakers'}, ambient ${amb} °C`}>
      <defs>
        <linearGradient id="ir-legend" x1="0" x2="1" y1="0" y2="0">
          {STOPS.map(([t, c]) => (
            <stop key={t} offset={t} stop-color={c} />
          ))}
        </linearGradient>
        {cells.map(({ it }) => {
          const t = tOf(it.reading?.riseC ?? 0);
          return (
            <radialGradient key={it.id} id={`irg-${it.id}`}>
              <stop offset="0" stop-color={heat(t)} />
              <stop offset="0.35" stop-color={heat(t * 0.92)} />
              <stop offset="0.7" stop-color={heat(t * 0.55)} stop-opacity="0.8" />
              <stop offset="1" stop-color={heat(t * 0.2)} stop-opacity="0" />
            </radialGradient>
          );
        })}
      </defs>
      <rect x="0" y="0" width="320" height={h} rx="12" fill={heat(0.05)} />
      {cells.map(({ it, x, y, w, h: ch }) => {
        const rise = it.reading?.riseC ?? 0;
        const on = pick === it.id;
        const cx = x + (it.id === 'main' ? 60 : 64);
        const cy = y + ch / 2;
        return (
          <g
            key={it.id}
            class="mk"
            aria-hidden="true"
            onClick={() => {
              fx.tap();
              onPick(it.id);
            }}
          >
            <rect x={x} y={y} width={w} height={ch} rx="6" fill="transparent" />
            {/* the breaker's body warms a little with its load; its load lug is where the heat shows */}
            <rect x={x + 6} y={y + 7} width={it.id === 'main' ? 46 : 50} height={ch - 14} rx="3" fill={heat(tOf(rise * 0.3) * 0.6 + 0.08)} />
            <rect x={x + 12} y={y + ch / 2 - 3} width="18" height="6" rx="2" fill={heat(0.02)} />
            <circle cx={cx} cy={cy} r={it.id === 'main' ? 24 : 20} fill={`url(#irg-${it.id})`} />
            <text x={x + 88} y={y + ch / 2 - 4} font-size="10" font-weight="700" fill="#cfc7e6">
              {shortOf(it)}
            </text>
            <text x={x + 88} y={y + ch / 2 + 12} font-size="14" font-weight="900" fill="#fbf5e9">
              {(amb + rise).toFixed(1)}°
            </text>
            {on && (
              <g stroke="#ffffff" stroke-width="1.6" fill="none">
                <rect x={x + 1} y={y + 1} width={w - 2} height={ch - 2} rx="6" />
                <line x1={cx - 20} y1={cy} x2={cx - 8} y2={cy} />
                <line x1={cx + 8} y1={cy} x2={cx + 20} y2={cy} />
                <line x1={cx} y1={cy - 20} x2={cx} y2={cy - 8} />
                <line x1={cx} y1={cy + 8} x2={cx} y2={cy + 20} />
              </g>
            )}
          </g>
        );
      })}
      <rect x="16" y={h - 18} width="150" height="8" rx="3" fill="url(#ir-legend)" />
      <text x="16" y={h - 22} font-size="9.5" font-weight="700" fill="#cfc7e6">
        {amb} °C
      </text>
      <text x="166" y={h - 22} font-size="9.5" font-weight="700" fill="#cfc7e6" text-anchor="end">
        {amb + SPAN} °C
      </text>
      <text x="304" y={h - 11} font-size="9.5" font-weight="700" fill="#9d94b8" text-anchor="end">
        ε 0.95 · ambient {amb} °C
      </text>
    </svg>
  );
}

/** a breaker's row: rating and conductor, its load (a bar), its rise over ambient */
function IrRow({ it, on, onPick }: { it: CheckItem; on: boolean; onPick(): void }) {
  const r = it.reading ?? {};
  const main = it.id === 'main';
  return (
    <button class={`qc-item ir-row ${on ? 'on' : ''}`} aria-pressed={on} aria-label={`${it.label}: ${it.text}`} onClick={onPick}>
      <span class="ld">
        <b>{it.label}</b>
        <span class="ir-rise">+{(r.riseC ?? 0).toFixed(1)} °C</span>
        <span class="ir-bar" aria-hidden="true">
          <i style={{ width: `${Math.max(2, Math.min(100, r.loadPct ?? 0))}%` }} />
        </span>
        <span class="label">
          {main ? it.text.split(' · ')[0] : `${r.amps ?? 0} A · ${r.loadPct ?? 0}% of its rating`}
          {r.tooLight ? ' ' : ''}
          {r.tooLight && <span class="ir-light">too light to judge</span>}
        </span>
      </span>
    </button>
  );
}

export function IrScan({ s, a, view, busy, onCall }: { s: IslandState; a: Pick<Asset, 'id' | 'kind' | 'name'>; view: CheckView; busy?: boolean; onCall(item: string | null): void }) {
  const [pick, setPick] = useState<string | null>(null);
  const amb = ambientOf(s, a);
  const toggle = (id: string) => setPick((p) => (p === id ? null : id));
  const picked = view.items.find((i) => i.id === pick);
  return (
    <div class="col qc">
      {view.ppe && (
        <div class="qc-ppe" role="note">
          <Icon name="hardhat" size={18} color="#f4d35e" /> {view.ppe}
        </div>
      )}
      <p class="qc-lead">
        {a.kind === 'generator' ? 'The transfer switch, scanned on the weekly test run with the set carrying the backed-up load.' : `${a.kind === 'grid' ? `The ${a.name.charAt(0).toLowerCase()}${a.name.slice(1)}` : a.name}'s panel under load.`} Tap the one you'd open up, or call it all normal.
      </p>
      <IrImage view={view} amb={amb} pick={pick} onPick={toggle} />
      <div class="qc-items">
        {view.items.map((it) => (
          <IrRow key={it.id} it={it} on={pick === it.id} onPick={() => toggle(it.id)} />
        ))}
      </div>
      <Help lines={view.help} />
      <CheckFoot none="All normal" call="Open it up" pick={pick} pickLabel={picked?.label} busy={busy} onCall={onCall} />
    </div>
  );
}
