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
import { BUILDS, COTTAGE, wageAt } from './sim/staff';
import type { Alert, IslandState, NpcRole, Order, Role, Weather, WeekReport } from './sim/types';
import { Island } from './ui/island';

type Phase = 'dawn' | 'day' | 'golden' | 'night';
type Scn = { id: string; note: string; tier: number; phase: Phase; weather?: Weather; focus?: Role | 'site' | null; tweak?: (s: IslandState) => void };

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

/** the island's staff for a scene (role and skill each, all at work) */
function staffed(s: IslandState, crew: [NpcRole, 1 | 2 | 3 | 4 | 5][]) {
  s.staff = crew.map(([role, skill], i) => ({ id: `n${900 + i}`, name: `Crew ${i + 1}`, role, skill, wage: wageAt(role, skill), hired: 0, start: 0 }));
}

/** the builders' site work: tier 4's (the villas and the seaplane dock) part done, or finished and a cottage under way in the grove */
function sitework(s: IslandState, t4: number, cottage?: number) {
  const d = BUILDS.find((b) => b.tier === 4)!;
  s.builds = [{ id: d.id, what: d.what, tier: 4, done: t4, drawn: Math.ceil(t4), need: d.units.length, started: s.week - 4, ...(t4 >= d.units.length ? { finished: s.week - 1 } : {}) }];
  if (cottage !== undefined) s.builds.push({ id: 'cottage-h8', what: COTTAGE.what, cottage: 'h8', done: cottage, drawn: Math.ceil(cottage), need: COTTAGE.units.length, started: s.week - 2 });
}

/** the builders on one open build, zoomed to it (geo.tsx siteBox): a tier's build by id, or 'cottage-h8' / 'cottage-h9' */
function openSite(s: IslandState, id: string, done: number, builders: number) {
  const cottage = id.startsWith('cottage-') ? id.slice(8) : undefined;
  const d = cottage ? COTTAGE : BUILDS.find((b) => b.id === id)!;
  s.builds = [{ id, what: d.what, ...(d.tier ? { tier: d.tier } : {}), ...(cottage ? { cottage } : {}), done, drawn: Math.ceil(done), need: d.units.length, started: s.week - 3 }];
  staffed(s, [['pilot', 3], ['pilot', 3], ['housekeeper', 3], ...Array.from({ length: builders }, (): [NpcRole, 3] => ['builder', 3])]);
}
const siteScn = (id: string, note: string, tier: number, build: string, done: number, builders: number): Scn => ({ id, note, tier, phase: 'day', focus: 'site', tweak: (s) => openSite(s, build, done, builders) });

/** an open alert, as the engine raises it (a hazard on a house, a squawk due now on a plane) */
function alertOn(s: IslandState, id: string, assetId: string, sym: string, role: 'mech' | 'elec', o: Partial<Alert> = {}) {
  s.alerts = [...(s.alerts ?? []), { id, role, assetId, sym, src: role === 'mech' ? 'squawk' : 'guest', week: s.week - 1, due: s.week, seed: 5, kind: 'repair', cause: 0, status: 'open', ...o } as Alert];
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
    id: 'chain-aog',
    note: 'Tier 4: Cargo C-7 AOG for brake linings (the part chain, health 82), GPU cart 1 still hooked up to it at its AOG spot',
    tier: 4,
    phase: 'day',
    tweak: (s) => {
      gse(s);
      s.chain = { id: 'lab-chain', orderId: 'lab-job', assetId: 'p2', title: 'Tire and brake', ata: '32-40', tag: 'lining', item: 'brake linings', how: 'damaged', by: 'Seb', week: s.week - 1, step: 'buy', returns: 0, rejects: 0, spent: 0, aogWeeks: 1 };
    },
  },
  {
    id: 'chain-float',
    note: 'Zoomed to the mechanic: Float F-3 AOG for its alternator (the part chain), GPU cart 1 left hooked up to it on the dock head, the mechanic beside it',
    tier: 4,
    phase: 'day',
    focus: 'mech',
    tweak: (s) => {
      gse(s);
      s.gse![0].hookedTo = 'p3';
      s.chain = { id: 'lab-chain', orderId: 'lab-job', assetId: 'p3', title: 'Replace alternator', ata: '24-30', tag: 'generator', item: 'alternator', how: 'gone', by: 'Seb', week: s.week - 1, step: 'lookup', returns: 0, rejects: 0, spent: 0, aogWeeks: 1 };
    },
  },
  // the staff (docs/JOBFLOW.md 15.10): three builders on the villa site, a pilot by the twin and one by the cargo plane, two housekeepers
  {
    id: 'staff',
    note: "Tier 3 with its staff: three builders at the seaplane dock (1.4 of 4 units: the dock's pilings), a pilot by the twin and one by the cargo plane, housekeepers at two booked houses",
    tier: 3,
    phase: 'day',
    tweak: (s) => {
      staffed(s, [['pilot', 3], ['pilot', 2], ['housekeeper', 3], ['housekeeper', 4], ['builder', 3], ['builder', 4], ['builder', 2]]);
      sitework(s, 1.4);
    },
  },
  {
    id: 'staff-night',
    note: 'The same at night: the staff are off, one figure works late in the lit office window',
    tier: 3,
    phase: 'night',
    tweak: (s) => {
      staffed(s, [['pilot', 3], ['pilot', 2], ['housekeeper', 3], ['housekeeper', 4], ['builder', 3], ['builder', 4], ['builder', 2]]);
      sitework(s, 1.4);
    },
  },
  {
    id: 'staff-alerts',
    note: 'Tier 3: the twin flies restricted (placard), Cottage 2 closed by a hazard (no entry), Cottage 3 made safe (tag), two builders on Cottage 5 in the grove',
    tier: 3,
    phase: 'day',
    tweak: (s) => {
      staffed(s, [['pilot', 3], ['pilot', 3], ['housekeeper', 3], ['builder', 3], ['builder', 3]]);
      sitework(s, 4, 2.2);
      alertOn(s, 'a1', 'p1', 'M_BRAKE_SOFT', 'mech', { kind: 'brakes' });
      alertOn(s, 'a2', 'h2', 'E_WARM_OUTLET', 'elec', { kind: 'outlet' });
      alertOn(s, 'a3', 'h3', 'E_WARM_OUTLET', 'elec', { kind: 'outlet', safe: { how: 'breaker', week: s.week, by: 'Mia' } });
    },
  },
  {
    id: 'staff-cottages',
    note: 'Tier 4: the two extra cottages the analyst had built, in the lagoon grove (Cottage 5 and 6)',
    tier: 4,
    phase: 'day',
    tweak: (s) => {
      staffed(s, [['pilot', 3], ['pilot', 3], ['housekeeper', 3], ['housekeeper', 3], ['builder', 3]]);
      for (const [id, name] of [['h8', 'Cottage 5'], ['h9', 'Cottage 6']]) s.assets.push({ id, kind: 'house', model: 'cottage', name, health: 84, touchedWeek: s.week - 2, inspectionUntil: s.week + 8 });
    },
  },
  // the builders' zoom on Home (tap the builders' line, or a builder): every build tier and a cottage plot
  siteScn('site-t2', "Zoomed to the builders' site: cottages 3 and 4 (1.2 of 3 units, slabs poured), the tier-1 crew's one builder", 1, 't2', 1.2, 1),
  siteScn('site-t3', "Zoomed to the builders' site: the generator house (1.5 of 2 units, framed), two builders", 2, 't3', 1.5, 2),
  siteScn('site-t4-villas', "Zoomed to the builders' site: the villas' shutters (3.3 of 4 units, framed, cranes up), three builders", 3, 't4', 3.3, 3),
  siteScn('site-t4-dock', "Zoomed to the builders' site: the seaplane dock's pilings (1.4 of 4 units), three builders", 3, 't4', 1.4, 3),
  siteScn('site-t5', "Zoomed to the builders' site: the Lodge on its terrace (2.5 of 4 units), two builders", 4, 't5', 2.5, 2),
  siteScn('site-cottage', "Zoomed to the builders' site: Cottage 6 in the lagoon grove (2.2 of 5 units), three builders, a ground power cart on the apron (its tap target stays 44 px)", 3, 'cottage-h9', 2.2, 3),
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
