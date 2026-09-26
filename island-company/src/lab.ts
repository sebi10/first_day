// Puzzle lab: mount one puzzle with a fake host.
// /lab.html?p=torque&tier=3&seed=1&tools=clickWrench,gaugeDamper
//   &blind=1  blind sign-off (no verdict while you work)   &job=prop  the scenario a work order picks
//   &asset=Cargo%20C-7  which plane (paperwork puzzles build that airplane's records from it)
import type { PuzzleDef, PuzzleId, PuzzleResult } from './puzzles/types';
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
document.getElementById('title')!.textContent = `${def.title} · tier ${tier} · seed ${seed}${blind ? ' · blind' : ''}`;

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

const context = {
  market: { low: 220, high: 460, fair: 330, cap: 380 },
  cashHistory: [8000, 8600, 9100, 8700, 9800],
  projection: [10400, 11100, 11500, 12300],
  hints: ['Tier 2 fixed costs start week 6', 'Pending: Panel upgrade $2,200'],
  leak: 540,
  assetName: q.get('asset') ?? 'Twin N-12',
  job,
};

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

const total = def.seconds(tier) * 1000;
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
