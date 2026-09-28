// Puzzle lab: mount one puzzle with a fake host.
// /lab.html?p=torque&tier=3&seed=1&tools=clickWrench,gaugeDamper
//   &blind=1  blind sign-off (no verdict while you work)   &job=prop  the scenario a work order picks
//   &asset=Cargo%20C-7  which plane (paperwork puzzles build that airplane's records from it)
//   &card=1  card-driven torque / hydraulic servicing: the island plane's AMM task card (both effectivities)
//   &chain=lookup|research&tag=lining  the part chain's IPC lookup or logbook research (&plant=32-40&via=stc|field: the plane carries that alteration)
//   &isl=7  the island seed the plane (and its card) comes from
//   &charge=25  the ground power cart's charge (%): a low cart sags under the start
//   &job=boom / &job=van  the hydraulic bench's crewmate vehicles; &job=gpuCable (wire-up), hangar (meter), gpu (variance)
//   p=trace&job=feeder  the underground feeder to the east cottages (&pick=DBS-2:4 labels the close-out's splice kits)
//   p=gpu&asset=Float%20F-3  the start on the island's own plane (its placard; the amphibian on its float wheels)
//   p=meter&job=altField|sgField|comPower&fault=unit|wiring  the part chain's circuit check on the airplane
import type { PuzzleContext, PuzzleDef, PuzzleId, PuzzleResult } from './puzzles/types';
import { aircraftOf, externalPower, type Ata, type PlantVia } from './sim/aircraft';
import { chainFind, manualCard } from './sim/chain';
import { itemById } from './sim/items';
import { rng } from './sim/rng';
import { fx } from './ui/feedback';
import '@fontsource-variable/manrope';
import './styles.css';

const q = new URLSearchParams(location.search);
const id = (q.get('p') ?? 'torque') as PuzzleId;
const tier = Number(q.get('tier') ?? 2);
const seed = Number(q.get('seed') ?? 1);
const tools = (q.get('tools') ?? '').split(',').filter(Boolean);
const blind = q.has('blind');
const job = q.get('job') ?? undefined;
// load only the puzzle under test, so one half-written puzzle can't break the lab
const mods = import.meta.glob('./puzzles/*.ts');
const mod = (await mods[`./puzzles/${id}.ts`]()) as Record<string, PuzzleDef>;
const def = mod[id];
const el = document.getElementById('stage')!;
const res = document.getElementById('res')!;
document.getElementById('title')!.textContent = `${def.titleFor?.({ job }) ?? def.title} · tier ${tier} · seed ${seed}${blind ? ' · blind' : ''}`;

const lab = {
  result: null as PuzzleResult | null,
  statuses: [] as string[],
  timeUp: () => {
    const r = inst.timeUp();
    show(r);
    return r;
  },
};
(window as unknown as { __lab: typeof lab }).__lab = lab;

function show(r: PuzzleResult) {
  lab.result = r;
  res.style.display = 'block';
  // blind: the lab shows what the player gets (the score is still on window.__lab.result)
  res.textContent = blind ? 'Signed off · no verdict on a real job' : `score ${r.score.toFixed(2)}${r.perfect ? ' PERFECT' : ''} — ${r.summary} ${r.data ? JSON.stringify(r.data) : ''}`;
}

const context: PuzzleContext = {
  market: { low: 220, high: 460, fair: 330, cap: 380 },
  cashHistory: [8000, 8600, 9100, 8700, 9800],
  projection: [10400, 11100, 11500, 12300],
  hints: ['Tier 2 fixed costs start week 6', 'Pending: Panel upgrade $2,200'],
  leak: 540,
  assetName: q.get('asset') ?? 'Twin N-12',
  job,
  ...(q.has('charge') ? { cart: { name: 'GPU cart 1', charge: Number(q.get('charge')) } } : {}),
};

// the island's plane: its task card, or the part chain on it
const asset = context.assetName!.toLowerCase();
const model = asset.includes('cargo') ? 'cargo' : asset.includes('float') ? 'float' : 'twin';
const plant = q.get('plant') as Ata | null;
const ac = aircraftOf(Number(q.get('isl') ?? 7), model === 'twin' ? 'p1' : model === 'cargo' ? 'p2' : 'p3', model, plant ? { plant, via: (q.get('via') ?? 'stc') as PlantVia } : {});
if (q.has('card')) context.card = manualCard(ac, job ?? (id === 'hydraulics' ? 'hydraulics' : 'tires'), id, tier <= 2);
// a ground power start on the island's plane (&asset=Float%20F-3 or Cargo%20C-7): its own airframe and placard
if (id === 'gpu' && q.has('asset')) context.plane = { name: context.assetName!, reg: ac.registration, designation: ac.designation, ...externalPower(ac) };
// the part chain's circuit check (&job=altField|sgField|comPower): &fault=wiring|unit
if (id === 'meter' && q.has('fault') && !q.has('room')) context.bench = { fault: q.get('fault') === 'wiring' ? 'wiring' : 'unit' };
// the job flow's alert site for the trace and the meter: &room=Hall&amps=20&fault=warm|dead|neutral[&single=1&appliance=window%20unit][&device=switch]
if ((id === 'trace' || id === 'meter') && q.has('room')) {
  const fault = q.get('fault');
  context.site = {
    room: q.get('room')!,
    amps: Number(q.get('amps') ?? 20),
    fault: fault === 'warm' || fault === 'neutral' ? fault : 'dead',
    ...(q.has('single') ? { single: true, appliance: q.get('appliance') ?? 'window unit' } : {}),
    ...(q.get('device') === 'switch' ? { device: 'switch' as const } : {}),
  };
}
// the job flow's pick, display only (&pick=DBS-2:4,SPLIT-4:4): what the puzzle labels as going in
if (q.has('pick'))
  context.pick = q
    .get('pick')!
    .split(',')
    .filter(Boolean)
    .map((t) => {
      const [pn, n] = t.split(':');
      const x = itemById(pn);
      return { pn, nomen: x?.nomen ?? pn, qty: Number(n ?? 1), ...(x?.spec ? { spec: x.spec } : {}), ...(x?.spec?.device === 'splice' ? { slot: 'splice' } : {}) };
    });
const chainStep = q.get('chain');
if (chainStep === 'lookup' || chainStep === 'research') {
  const ata = (plant ?? ({ tires: '32-40', prop: '61-10', hydraulics: '29-10', avionics: '23-10', alternator: '24-30' } as Record<string, Ata>)[job ?? 'tires'] ?? '32-40') as Ata;
  const f = chainFind(ac, ata, rng(seed));
  context.aircraft = ac;
  context.job = job ?? { '32-40': 'tires', '61-10': 'prop', '29-10': 'hydraulics', '23-10': 'avionics', '24-30': 'alternator' }[ata];
  context.chain = { step: chainStep, tag: q.get('tag') ?? f.tag, item: f.item, found: f.found, from: { tires: 'Replace main tires', prop: 'Re-torque the prop bolts', hydraulics: 'Brake hydraulic service', avionics: 'Swap the com radio', alternator: 'Alternator belt and brushes' }[context.job ?? 'tires'] ?? 'Replace main tires', by: 'Seb', week: 8 };
}

const inst = def.mount(
  {
    el,
    fx,
    done: (r) => show(r),
    status: (s) => {
      lab.statuses.push(s);
      document.getElementById('status')!.textContent = s;
    },
    paused: () => false,
  },
  { seed, tier, tools, reducedMotion: false, context, blind },
);

const total = def.seconds(tier, context) * 1000;
const t0 = performance.now();
const bar = document.getElementById('bar')!;
if (tier > 0 && !q.has('notimer')) {
  const tick = () => {
    const left = Math.max(0, 1 - (performance.now() - t0) / total);
    bar.style.transform = `scaleX(${left})`;
    if (left <= 0 && !lab.result) lab.timeUp();
    else if (!lab.result) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
