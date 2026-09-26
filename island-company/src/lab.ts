// Puzzle lab: mount one puzzle with a fake host.
// /lab.html?p=torque&tier=3&seed=1&tools=clickWrench,gaugeDamper
import { PUZZLES } from './puzzles';
import type { PuzzleId, PuzzleResult } from './puzzles/types';
import { fx } from './ui/feedback';

const q = new URLSearchParams(location.search);
const id = (q.get('p') ?? 'torque') as PuzzleId;
const tier = Number(q.get('tier') ?? 2);
const seed = Number(q.get('seed') ?? 1);
const tools = (q.get('tools') ?? '').split(',').filter(Boolean);
const def = PUZZLES[id];
const el = document.getElementById('stage')!;
const res = document.getElementById('res')!;
document.getElementById('title')!.textContent = `${def.title} · tier ${tier} · seed ${seed}`;

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
  res.textContent = `score ${r.score.toFixed(2)}${r.perfect ? ' PERFECT' : ''} — ${r.summary} ${r.data ? JSON.stringify(r.data) : ''}`;
}

const context = {
  market: { low: 220, high: 460, fair: 330, cap: 380 },
  cashHistory: [8000, 8600, 9100, 8700, 9800],
  projection: [10400, 11100, 11500, 12300],
  hints: ['Tier 2 fixed costs start week 6', 'Pending: Panel upgrade $2,200'],
  leak: 540,
  assetName: 'Twin N-12',
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
  { seed, tier, tools, reducedMotion: false, context },
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
