// Phase-0 paper sim: run scripted teams through N weeks over many seeds and
// print the numbers the spec's exit test asks for.
//   npm run balance            # summary over 26 weeks x 30 seeds
//   npm run balance -- detail  # week-by-week for one seed of "all good"
//   npm run balance -- robust  # the two target teams over 90 seeds x 4 re-rolled crews (slow, ~1 min)
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
  console.log('wk tier grade  revenue     cash  inc defect flights houses');
  for (const w of weeks)
    console.log(
      `${String(w.week).padStart(2)} ${String(w.tier).padStart(4)} ${w.grade.padStart(5)} ${usd(w.revenue).padStart(8)} ${usd(w.cash).padStart(8)} ${String(w.incidents).padStart(4)} ${String(w.defects).padStart(6)} ${w.flights.padStart(7)} ${w.houses.padStart(6)}`,
    );
} else if (arg === 'robust') {
  // Same rules, re-rolled crews: who shows up and how each job goes change with the salt.
  // The 30-seed table can hide a knife-edge; this shows how often a team actually falls off it.
  console.log(`\nRobustness: ${WEEKS} weeks x 90 seeds x 4 crews per team\n`);
  console.log('team            crew  wk→T5  miss T5  weeks<0  min cash  defect/wk');
  for (const name of ['three friends', 'all average']) {
    for (const salt of ['', 'a', 'b', 'c']) {
      const t5: number[] = [];
      let neg = 0;
      let def = 0;
      let n = 0;
      let min = Infinity;
      for (let seed = 1; seed <= 90; seed++) {
        const { weeks, final, minCash } = simulate(TEAMS[name], WEEKS, seed, undefined, salt);
        t5.push(final.stats.tierReachedWeek[5] ?? 99);
        min = Math.min(min, minCash);
        for (const w of weeks) {
          n++;
          def += w.defects;
          if (w.cash < 0) neg++;
        }
      }
      console.log(
        `${name.padEnd(15)} ${(salt || '-').padStart(4)} ${String(med(t5)).padStart(6)} ${String(t5.filter((x) => x === 99).length).padStart(8)} ${String(neg).padStart(8)} ${usd(min).padStart(9)} ${(def / n).toFixed(3).padStart(10)}`,
    );
    }
  }
} else {
  console.log(`\nPaper sim: ${WEEKS} weeks x ${SEEDS} seeds per team (medians unless noted)\n`);
  console.log('team            tier@26  wk→T2 wk→T3 wk→T4 wk→T5  %B+  min cash  weeks<0  incid/wk  defect/wk  rev/wk');
  for (const [name, team] of Object.entries(TEAMS)) {
    const tiers: number[] = [];
    const reach: Record<number, number[]> = { 2: [], 3: [], 4: [], 5: [] };
    let bplus = 0;
    let total = 0;
    let neg = 0;
    let inc = 0;
    let def = 0;
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
        def += w.defects;
        rev += w.revenue;
      }
      mins.push(minCash);
    }
    const wk = (t: number) => {
      const m = med(reach[t]);
      return m >= 99 ? '  —' : String(m).padStart(3);
    };
    console.log(
      `${name.padEnd(15)} ${String(med(tiers)).padStart(7)}   ${wk(2)}   ${wk(3)}   ${wk(4)}   ${wk(5)} ${String(Math.round((100 * bplus) / total)).padStart(4)} ${usd(Math.min(...mins)).padStart(9)} ${String(neg).padStart(8)} ${(inc / total).toFixed(2).padStart(9)} ${(def / total).toFixed(3).padStart(10)} ${usd(rev / total).padStart(7)}`,
    );
  }
  console.log('\nExit test (spec phase 0): "no role can win alone" + "no week ends with cash < 0 under sensible play".');
}
