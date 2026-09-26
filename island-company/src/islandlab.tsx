// Island lab (dev tool): the island rendered in fixed scenarios, side by side,
// so art changes can be judged on the same states every time.
//   /islandlab.html?w=358            all scenarios at phone card width
//   /islandlab.html?w=600&only=t5-night
import { render } from 'preact';
import '@fontsource-variable/manrope';
import './styles.css';
import { MODELS, TIERS, ECON } from './sim/data';
import { gseCarts } from './sim/econ';
import { apply, createIsland } from './sim/engine';
import { developmentOf } from './sim/growth';
import type { IslandState, Order, Role, Weather, WeekReport } from './sim/types';
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
  s.weather = weather;
  for (const a of s.assets) a.health = Math.max(a.health, 80);
  // a plausible history for this tier, so the island shows its usual development
  played(s, [3, 8, 12, 18, 24][tier - 1]);
  for (let t = 2; t <= tier; t++) s.stats.tierReachedWeek[t] = [0, 0, 6, 10, 16, 21][t];
  return s;
}

function played(s: IslandState, weeks: number, o: { bplus?: number; perfect?: number; strength?: number; grade?: 'A' | 'B' } = {}) {
  s.week = weeks + 1;
  s.stats.totalWeeks = weeks;
  s.stats.weeksBPlus = o.bplus ?? Math.floor(weeks * 0.7);
  s.stats.perfectWeeks = o.perfect ?? (weeks >= 10 ? 2 : 0);
  const budget = [3900, 5900, 6900, 16000, 22000][s.tier - 1];
  // inspections were kept up along the way (the 'lapsed' scene breaks one on purpose)
  for (const a of s.assets) if (a.kind === 'house') a.inspectionUntil = s.week + 6;
  s.history = Array.from({ length: Math.min(3, weeks) }, (_, i) => ({ week: weeks - 2 + i, tier: s.tier, grade: o.grade ?? 'B', revenue: Math.round(budget * (o.strength ?? 0.85)), budget }) as unknown as WeekReport);
}

/** ground power: cart 1 hooked up to the cargo plane, cart 2 low on the hangar charger */
function gse(s: IslandState) {
  s.gse = gseCarts(s).map((c, i) => (i === 0 ? { ...c, hookedTo: 'p2', charging: false, charge: 70 } : { ...c, charging: true, charge: 20 }));
}

function order(s: IslandState, role: Role, done: boolean): string {
  const id = `lab-${role}`;
  s.orders.push({ id, role, kind: 'project', assetId: null, title: 'Crew project part', puzzle: 'torque', tier: 3, cost: 0, parts: 0, gain: 0, createdWeek: s.week, deferrals: 0, lastDeferredWeek: null, status: done ? 'done' : 'ready', seed: 1 } as Order);
  return id;
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
  // development between tiers (src/sim/growth.ts)
  { id: 'dev-fresh', note: 'Week 1: a brand-new tier-1 island, nothing extra yet', tier: 1, phase: 'day', tweak: (s) => played(s, 0) },
  { id: 'dev-settled', note: 'Tier 1 after 6 good weeks: garden, benches, palm grove', tier: 1, phase: 'day', tweak: (s) => played(s, 6, { bplus: 4 }) },
  {
    id: 'project',
    note: 'Tier 2 building tier 3: crew project 2 of 3 parts done (construction stage 2)',
    tier: 2,
    phase: 'day',
    tweak: (s) => {
      played(s, 9, { bplus: 7 });
      s.project = { tier: 3, title: 'Village', orders: { mech: order(s, 'mech', true), elec: order(s, 'elec', true), fin: order(s, 'fin', false) } };
    },
  },
  { id: 'just-built', note: 'Tier 3 arrived this week: ribbons on the new buildings', tier: 3, phase: 'day', tweak: (s) => (s.stats.tierReachedWeek[3] = s.week) },
  {
    id: 't4-thriving',
    note: 'Tier 4 after 20 strong weeks: beach bar, fountain, market, lighthouse, boardwalk, yacht',
    tier: 4,
    phase: 'day',
    tweak: (s) => played(s, 20, { bplus: 16, perfect: 3, strength: 1.1 }),
  },
  { id: 'weathered', note: 'Tier 3, every asset around 58 health: weathered paint, still open', tier: 3, phase: 'day', tweak: (s) => s.assets.forEach((a) => (a.health = 58)) },
  {
    id: 'gse',
    note: 'Tier 3 ground power: GPU cart 1 hooked up to Cargo C-7 (70%), GPU cart 2 on the hangar charger (20%, red light)',
    tier: 3,
    phase: 'day',
    tweak: (s) => gse(s),
  },
  {
    id: 'gse-zoom',
    note: 'The same, zoomed to the mechanic: cart 2 tagged out (its cable report open), cart 1 hooked to the Twin on jacks',
    tier: 3,
    phase: 'day',
    focus: 'mech',
    tweak: (s) => {
      gse(s);
      s.assets.find((a) => a.id === 'p1')!.health = 30;
      s.gse![0].hookedTo = 'p1';
      s.orders.push({ id: 'lab-cable', role: 'elec', kind: 'report', assetId: null, title: 'GPU cart cable insulation is cracked at the plug', puzzle: 'wireup', tier: 2, cost: 40, parts: 0, gain: 0, createdWeek: s.week, deferrals: 0, lastDeferredWeek: null, status: 'ready', seed: 3, report: { key: 'gpuCable', by: 'mech', effect: 'gse', amount: 0, cart: 'gpu2' } } as Order);
    },
  },
  { id: 'gse-night', note: 'Tier 5 at night: both carts on the charger, their lights over the dark', tier: 5, phase: 'night' },
  {
    id: 'beaten',
    note: 'Beat the game: tier 5 at night, 8 straight A weeks, the crew statue, observatory, bunting',
    tier: 5,
    phase: 'night',
    tweak: (s) => {
      played(s, 30, { bplus: 26, perfect: 6, strength: 1.1, grade: 'A' });
      s.stats.aStreak = 8;
      s.creditsWeek = s.week - 1;
    },
  },
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
              <div style={{ opacity: 0.7 }}>
                {(() => {
                  const d = developmentOf(s);
                  return `develops: ${d.flourishes.join(', ') || 'nothing yet'}${d.construction ? ` · building T${d.construction.tier} stage ${d.construction.stage}` : ''}${d.justBuilt ? ` · just built T${d.justBuilt}` : ''} · prosperity ${d.prosperity.toFixed(2)} · care ${d.care.toFixed(2)}`;
                })()}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

render(<Lab />, document.getElementById('app')!);
