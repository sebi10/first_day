// Phase-0 paper sim: run scripted teams through N weeks over many seeds and
// print the numbers the spec's exit test asks for.
//   npm run balance            # summary over 26 weeks x 30 seeds
//   npm run balance -- detail  # week-by-week for one seed of "all good"
import { simulate, TEAMS } from '../src/sim/bots';

const WEEKS = 26;
const SEEDS = 30;
const arg = process.argv[2];

const usd = (n: number) => (n < 0 ? '-' : '') + '$' + Math.abs(Math.round(n)).toLocaleString('en-US');
const med = (xs: number[]) => {
  const v = [...xs].sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : NaN;
};

if (arg === 'detail') {
  const team = process.argv[3] ?? 'all good';
  const { weeks } = simulate(TEAMS[team], WEEKS, Number(process.argv[4] ?? 1));
  console.log(`\n${team}, seed ${process.argv[4] ?? 1}`);
  console.log('wk tier grade  revenue     cash  inc flights houses');
  for (const w of weeks)
    console.log(
      `${String(w.week).padStart(2)} ${String(w.tier).padStart(4)} ${w.grade.padStart(5)} ${usd(w.revenue).padStart(8)} ${usd(w.cash).padStart(8)} ${String(w.incidents).padStart(4)} ${w.flights.padStart(7)} ${w.houses.padStart(6)}`,
    );
} else {
  console.log(`\nPaper sim: ${WEEKS} weeks x ${SEEDS} seeds per team (medians unless noted)\n`);
  console.log('team            tier@26  wk→T2 wk→T3 wk→T4 wk→T5  %B+  min cash  weeks<0  incid/wk  rev/wk');
  for (const [name, team] of Object.entries(TEAMS)) {
    const tiers: number[] = [];
    const reach: Record<number, number[]> = { 2: [], 3: [], 4: [], 5: [] };
    let bplus = 0;
    let total = 0;
    let neg = 0;
    let inc = 0;
    let rev = 0;
    const mins: number[] = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { weeks, final, minCash } = simulate(team, WEEKS, seed);
      tiers.push(final.tier);
      for (const t of [2, 3, 4, 5]) reach[t].push(final.stats.tierReachedWeek[t] ?? 99);
      for (const w of weeks) {
        total++;
        if (w.grade === 'A' || w.grade === 'B') bplus++;
        if (w.cash < 0) neg++;
        inc += w.incidents;
        rev += w.revenue;
      }
      mins.push(minCash);
    }
    const wk = (t: number) => {
      const m = med(reach[t]);
      return m >= 99 ? '  —' : String(m).padStart(3);
    };
    console.log(
      `${name.padEnd(15)} ${String(med(tiers)).padStart(7)}   ${wk(2)}   ${wk(3)}   ${wk(4)}   ${wk(5)} ${String(Math.round((100 * bplus) / total)).padStart(4)} ${usd(Math.min(...mins)).padStart(9)} ${String(neg).padStart(8)} ${(inc / total).toFixed(2).padStart(9)} ${usd(rev / total).padStart(7)}`,
    );
  }
  console.log('\nExit test (spec phase 0): "no role can win alone" + "no week ends with cash < 0 under sensible play".');
}
