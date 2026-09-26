// Island lab (dev tool): the island rendered in fixed scenarios, side by side,
// so art changes can be judged on the same states every time.
//   /islandlab.html?w=358            all scenarios at phone card width
//   /islandlab.html?w=600&only=t5-night
import { render } from 'preact';
import '@fontsource-variable/manrope';
import './styles.css';
import { MODELS, TIERS, ECON } from './sim/data';
import { apply, createIsland } from './sim/engine';
import type { IslandState, Role, Weather } from './sim/types';
import { Island } from './ui/island';

type Phase = 'dawn' | 'day' | 'golden' | 'night';
type Scn = { id: string; note: string; tier: number; phase: Phase; weather?: Weather; focus?: Role | null; tweak?: (s: IslandState) => void };

function build(tier: number, weather: Weather = 'clear') {
  const now = Date.UTC(2026, 8, 26, 10);
  let s = createIsland({ id: 'lab', name: 'Frigate Bay', now, tz: 'Europe/Paris', seed: 7, creator: { uid: 'a', name: 'Seb', role: 'mech' } });
  s = apply(s, { t: 'join', uid: 'b', name: 'Mia', role: 'elec' }, now).s;
  s = apply(s, { t: 'join', uid: 'c', name: 'Ravi', role: 'fin' }, now).s;
  for (let t = 2; t <= tier; t++)
    for (const a of TIERS[t - 1].adds) {
      const kind = MODELS[a.model].kind;
      s.assets.push({ id: a.id, kind, model: a.model, name: a.name, health: 82, touchedWeek: 0, ...(kind === 'house' ? { inspectionUntil: 8 } : {}), ...(kind === 'plane' ? { sinceInspection: 4 } : {}) });
    }
  s.tier = tier;
  s.week = 3;
  s.weather = weather;
  for (const a of s.assets) a.health = Math.max(a.health, 80);
  return s;
}

const SCN: Scn[] = [
  { id: 't1-day', note: 'Tier 1 Airstrip, clear day, all healthy', tier: 1, phase: 'day' },
  { id: 't1-dawn', note: 'Tier 1 at dawn', tier: 1, phase: 'dawn' },
  { id: 't2-golden', note: 'Tier 2 Outpost, golden hour', tier: 2, phase: 'golden' },
  { id: 't3-storm', note: 'Tier 3 Village in a storm', tier: 3, phase: 'day', weather: 'storm' },
  { id: 't4-wind', note: 'Tier 4 Harbor, windy day', tier: 4, phase: 'day', weather: 'wind' },
  { id: 't5-day', note: 'Tier 5 Resort, clear day', tier: 5, phase: 'day' },
  { id: 't5-night', note: 'Tier 5 Resort at night (lit houses, night flights)', tier: 5, phase: 'night' },
  {
    id: 'faults',
    note: 'Tier 3 faults: Twin AOG (health 30), Cargo grounded, Cottage 2 red-tagged, Cottage 3 health 25, grid down (35), cash under $2k',
    tier: 3,
    phase: 'day',
    tweak: (s) => {
      const h = (id: string, v: number) => (s.assets.find((a) => a.id === id)!.health = v);
      h('p1', 30);
      h('h3', 25);
      h('g1', 35);
      s.tags = { p2: 'mech', h2: 'elec' };
      s.cash = 1500;
    },
  },
  { id: 'lapsed', note: 'Tier 2: Cottage 1 inspection lapsed (closed), Cargo at 55 (warning)', tier: 2, phase: 'day', tweak: (s) => ((s.assets.find((a) => a.id === 'h1')!.inspectionUntil = 1), (s.assets.find((a) => a.id === 'p2')!.health = 55)) },
  { id: 'zoom-mech', note: 'Tier 2, zoomed to the mechanic zone', tier: 2, phase: 'day', focus: 'mech' },
  { id: 'zoom-elec', note: 'Tier 4, zoomed to the electrician zone', tier: 4, phase: 'day', focus: 'elec' },
  { id: 'zoom-fin', note: 'Tier 3, zoomed to the analyst zone', tier: 3, phase: 'golden', focus: 'fin' },
];

const q = new URLSearchParams(location.search);
const w = Number(q.get('w') ?? 358);
const only = q.get('only');
void ECON;

function Lab() {
  return (
    <div style={{ padding: 16, display: 'flex', flexWrap: 'wrap', gap: 16, background: 'var(--sand, #F2E3C6)' }}>
      {SCN.filter((x) => !only || x.id === only).map((x) => {
        const s = build(x.tier, x.weather);
        x.tweak?.(s);
        return (
          <div key={x.id} class="scn" data-id={x.id} style={{ width: w }}>
            <div class="island-wrap">
              <Island s={s} focus={x.focus ?? null} reduceMotion={q.has('still')} phase={x.phase} />
            </div>
            <div style={{ fontSize: 12, marginTop: 6, color: '#1F2A30' }}>
              <b>{x.id}</b> · {x.note}
            </div>
          </div>
        );
      })}
    </div>
  );
}

render(<Lab />, document.getElementById('app')!);
