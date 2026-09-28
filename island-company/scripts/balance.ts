// Phase-0 paper sim: run scripted teams through N weeks over many seeds and
// print the numbers the spec's exit test asks for (docs/JOBFLOW.md 20).
//   npm run balance                       # summary over 26 weeks x 30 seeds, with the job flow's columns and a timing line
//   npm run balance -- detail [team] [n]  # week by week for one seed
//   npm run balance -- robust             # the two target teams over 90 seeds x 4 re-rolled crews (slow, a few minutes)
//   npm run balance -- flow [team] [n]    # the first 40 alerts of one game: symptom, hidden cause, the bot's task and pick, the verdict, what came of it
//   npm run balance -- cottages           # the three friends with an analyst who starts a cottage at tier 4 (the staff update's growth project)
// The summary's `mistakes` crew is the three friends with a human's slips (a near-miss pick on one plan in ten, a
// stock request a week): its money and latency next to the three friends' price the mistakes the bots don't make.
import { causeOf, fixesOf, symptomOf } from '../src/sim/alerts';
import { simulate, TEAMS, type Team } from '../src/sim/bots';
import { stdPickFor, planTask } from '../src/sim/flow';
import { invValue } from '../src/sim/ledger';
import { payroll, standardPayroll } from '../src/sim/staff';
import { binsInUse, binsTotal } from '../src/sim/stock';
import type { Alert, IslandState, Order } from '../src/sim/types';

const WEEKS = 26;
const SEEDS = 30;
const arg = process.argv[2];

const usd = (n: number) => (n < 0 ? '-' : '') + '$' + Math.abs(Math.round(n)).toLocaleString('en-US');
const med = (xs: number[]) => {
  const v = [...xs].sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : NaN;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

/** the job flow's numbers for one game, gathered week by week from the ledger rows and the week reports */
type Flow = {
  latency: number[];
  aog: Record<'stock' | 'approval' | 'plan' | 'carrier', number>;
  subWeeks: number;
  fill: [number, number];
  wait: number;
  weeks: number;
  /** the human mistakes' price: receiving returns, install stops, stock requests, restocking fees ($), wiring faults met */
  returns: number;
  stops: number;
  reqs: number;
  restock: number;
  wiring: number;
};
function flowTrace(): { f: Flow; trace: (s: IslandState) => void } {
  const f: Flow = { latency: [], aog: { stock: 0, approval: 0, plan: 0, carrier: 0 }, subWeeks: 0, fill: [0, 0], wait: 0, weeks: 0, returns: 0, stops: 0, reqs: 0, restock: 0, wiring: 0 };
  const closed = new Set<string>();
  const stopped = new Set<string>();
  const asked = new Set<string>();
  const wired = new Set<string>();
  const trace = (s: IslandState) => {
    const once = (seen: Set<string>, id: string) => !seen.has(id) && !!seen.add(id);
    for (const o of s.orders) if (o.flow?.stop && once(stopped, o.id)) f.stops++;
    for (const q of s.reqs ?? []) if (!q.order && once(asked, q.id)) f.reqs++;
    for (const a of s.alerts ?? []) if (a.kind === 'wiring' && once(wired, a.id)) f.wiring++;
    const W = s.week - 1;
    f.weeks++;
    const row = s.ledger?.find((r) => r.w === W);
    if (row) {
      for (const [k, n] of Object.entries(row.aog ?? {})) f.aog[k as keyof Flow['aog']] += n ?? 0;
      if (W >= 8 && row.fill) {
        f.fill[0] += row.fill[0];
        f.fill[1] += row.fill[1];
      }
      f.wait += row.wait ?? 0;
    }
    const h = s.history.find((x) => x.week === W);
    if (h) f.subWeeks += h.lines.some((l) => /a mainland sub-charter flew the guests in/.test(l.text)) ? 1 : 0;
    for (const l of h?.lines ?? []) {
      const m = /Returned: .+ \(\$([\d,]+) restocking\)/.exec(l.text);
      if (!m) continue;
      f.returns++;
      f.restock += Number(m[1].replace(/,/g, ''));
    }
    for (const a of s.alerts ?? []) {
      if (a.status !== 'closed' || closed.has(a.id) || !a.closed) continue;
      closed.add(a.id);
      if (a.closed.how === 'fixed' || a.closed.how === 'wired') f.latency.push(a.closed.week - a.week);
    }
  };
  return { f, trace };
}

if (arg === 'detail') {
  const team = process.argv[3] ?? 'all good';
  const seed = Number(process.argv[4] ?? 1);
  const extra: string[] = [];
  const seen = new Set<string>();
  const { weeks } = simulate(TEAMS[team], WEEKS, seed, (s) => {
    const W = s.week - 1;
    const raised = (s.alerts ?? []).filter((a) => a.week === W && !seen.has(a.id));
    for (const a of raised) seen.add(a.id);
    const planned = s.orders.filter((o) => o.flow && o.createdWeek === W).length;
    const nff = (s.alerts ?? []).filter((a) => a.closed?.week === W && a.closed.how === 'nff').length;
    const placed = (s.pos ?? []).filter((p) => p.week === W).length;
    const got = (s.pos ?? []).filter((p) => p.got === W).length;
    const paid = (s.pos ?? []).filter((p) => p.paid === W).length;
    extra.push(`${String(raised.length).padStart(3)}/${String(planned).padStart(2)}/${String(nff).padStart(2)} ${String(placed).padStart(3)}/${String(got).padStart(2)}/${String(paid).padStart(2)} ${usd(invValue(s)).padStart(8)} ${usd(payroll(s)).padStart(7)}`);
  });
  console.log(`\n${team}, seed ${seed}`);
  console.log('wk tier grade  revenue     cash  inc defect flights houses  alerts r/p/nff  POs p/r/paid     stock  payroll');
  weeks.forEach((w, i) =>
    console.log(
      `${String(w.week).padStart(2)} ${String(w.tier).padStart(4)} ${w.grade.padStart(5)} ${usd(w.revenue).padStart(8)} ${usd(w.cash).padStart(8)} ${String(w.incidents).padStart(4)} ${String(w.defects).padStart(6)} ${w.flights.padStart(7)} ${w.houses.padStart(6)}  ${extra[i] ?? ''}`,
    ),
  );
} else if (arg === 'robust') {
  // Same rules, re-rolled crews: who shows up and how each job goes change with the salt.
  // The 30-seed table can hide a knife-edge; this shows how often a team actually falls off it.
  console.log(`\nRobustness: ${WEEKS} weeks x 90 seeds x 4 crews per team\n`);
  console.log('team            crew  wk→T5  miss T5  weeks<0  min cash  defect/wk  latency  AOG wk  fill%');
  for (const name of ['three friends', 'all average']) {
    for (const salt of ['', 'a', 'b', 'c']) {
      const t5: number[] = [];
      let neg = 0;
      let def = 0;
      let n = 0;
      let min = Infinity;
      const lat: number[] = [];
      let aog = 0;
      const fill: [number, number] = [0, 0];
      for (let seed = 1; seed <= 90; seed++) {
        const { f, trace } = flowTrace();
        const { weeks, final, minCash } = simulate(TEAMS[name], WEEKS, seed, trace, salt);
        t5.push(final.stats.tierReachedWeek[5] ?? 99);
        min = Math.min(min, minCash);
        for (const w of weeks) {
          n++;
          def += w.defects;
          if (w.cash < 0) neg++;
        }
        lat.push(...f.latency);
        aog += Object.values(f.aog).reduce((a, b) => a + b, 0);
        fill[0] += f.fill[0];
        fill[1] += f.fill[1];
      }
      console.log(
        `${name.padEnd(15)} ${(salt || '-').padStart(4)} ${String(med(t5)).padStart(6)} ${String(t5.filter((x) => x === 99).length).padStart(8)} ${String(neg).padStart(8)} ${usd(min).padStart(9)} ${(def / n).toFixed(3).padStart(10)} ${mean(lat).toFixed(2).padStart(8)} ${(aog / 90).toFixed(1).padStart(7)} ${String(Math.round((100 * fill[0]) / Math.max(1, fill[1]))).padStart(6)}`,
      );
    }
  }
} else if (arg === 'flow') {
  // the first 40 alerts of one game, to tune the symptom weights: what it looked like, what it really was, what the bot did and what came of it
  const team = process.argv[3] ?? 'three friends';
  const seed = Number(process.argv[4] ?? 1);
  type Row = { a: Alert; o?: Order; stop?: string; pick?: string; std?: string; task?: string; fixes: string[]; defects: string[]; again: boolean };
  const rows = new Map<string, Row>();
  simulate(TEAMS[team], WEEKS, seed, (s) => {
    for (const a of s.alerts ?? []) {
      if (!rows.has(a.id) && rows.size < 40) rows.set(a.id, { a, fixes: fixesOf(s, a), defects: [], again: false });
      const row = rows.get(a.id);
      if (!row) continue;
      row.a = a;
      const o = a.order ? s.orders.find((x) => x.id === a.order) : row.o;
      if (o?.flow) {
        row.o = o;
        row.task = o.flow.task;
        row.pick = o.flow.pick.map((l) => `${l.qty}×${l.item}`).join(' ');
        const t = planTask(s, a, o.flow.task);
        if (t && !row.std) row.std = stdPickFor(s, a, t).map((l) => `${l.qty}×${l.item}`).join(' ');
        if (o.flow.stop) row.stop = o.flow.stop;
      }
      for (const d of s.defects ?? []) if (d.alert?.alert === a.id && !row.defects.includes(`${d.puzzle}:${d.variant}`)) row.defects.push(`${d.puzzle}:${d.variant}`);
    }
    for (const a of s.alerts ?? []) if (a.src === 'again') for (const row of rows.values()) if (row.a.assetId === a.assetId && row.a.sym === a.sym && row.a.id !== a.id) row.again = true;
  });
  console.log(`\n${team}, seed ${seed}: the first ${rows.size} alerts\n`);
  for (const r of rows.values()) {
    const a = r.a;
    const sym = symptomOf(a);
    const cause = a.cause < 0 ? 'no fault' : `${causeOf(a)?.kind ?? '?'} (${causeOf(a)?.fix ?? 'wiring'})`;
    const verdict = !r.task
      ? a.closed?.how === 'nff'
        ? a.cause < 0
          ? 'NFF, right'
          : 'NFF on a real fault'
        : a.closed?.how === 'wired'
          ? 'the wiring'
          : 'not planned'
      : r.stop
        ? 'stop'
        : r.fixes.length && !r.fixes.includes(r.task)
          ? 'wrong task'
          : r.pick !== r.std
            ? 'near-miss pick'
            : 'right';
    const came = [a.closed ? `closed wk ${a.closed.week} (${a.closed.how})` : `open (${a.status})`, ...r.defects, r.again ? 'came back' : ''].filter(Boolean).join(', ');
    console.log(`${a.id.padEnd(5)} wk ${String(a.week).padStart(2)} ${a.assetId.padEnd(3)} ${(sym?.key ?? a.sym).padEnd(18)} ${cause.padEnd(32)} ${(r.task ?? '-').padEnd(24)} ${verdict.padEnd(18)} ${came}`);
    if (r.pick && r.pick !== r.std) console.log(`      pick ${r.pick}   (the book: ${r.std})${r.stop ? `   stop: ${r.stop}` : ''}`);
  }
} else {
  // the summary, over every team (and the cottages variant on its own line)
  const teams: [string, Team][] =
    arg === 'cottages'
      ? [
          ['three friends', TEAMS['three friends']],
          ['cottages', { ...TEAMS['three friends'], fin: { ...TEAMS['three friends'].fin, cottages: true } }],
        ]
      : Object.entries(TEAMS);
  console.log(`\nPaper sim: ${WEEKS} weeks x ${SEEDS} seeds per team (medians unless noted)\n`);
  console.log(
    'team            tier@26  wk→T2 wk→T3 wk→T4 wk→T5  %B+  min cash  weeks<0  incid/wk  defect/wk  rev/wk  latency  AOG wk (stk/apr/pln/car)    sub  fill%  wait/wk  inv@26  bins@26  payroll@26  late bld  ret/stp/req  restock  wiring',
  );
  const t0 = Date.now();
  let sims = 0;
  for (const [name, team] of teams) {
    const tiers: number[] = [];
    const reach: Record<number, number[]> = { 2: [], 3: [], 4: [], 5: [] };
    let bplus = 0;
    let total = 0;
    let neg = 0;
    let inc = 0;
    let def = 0;
    let rev = 0;
    const mins: number[] = [];
    const lat: number[] = [];
    const aog = { stock: 0, approval: 0, plan: 0, carrier: 0 };
    let subWeeks = 0;
    const fill: [number, number] = [0, 0];
    let wait = 0;
    let weeksAll = 0;
    const inv: number[] = [];
    const bins: number[] = [];
    const pay: number[] = [];
    let late = 0;
    const slip = { returns: 0, stops: 0, reqs: 0, restock: 0, wiring: 0 };
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { f, trace } = flowTrace();
      const { weeks, final, minCash } = simulate(team, WEEKS, seed, trace);
      sims++;
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
      lat.push(...f.latency);
      for (const k of Object.keys(aog) as (keyof typeof aog)[]) aog[k] += f.aog[k];
      subWeeks += f.subWeeks;
      fill[0] += f.fill[0];
      fill[1] += f.fill[1];
      wait += f.wait;
      weeksAll += f.weeks;
      for (const k of Object.keys(slip) as (keyof typeof slip)[]) slip[k] += f[k];
      inv.push(invValue(final));
      bins.push(binsInUse(final) / binsTotal(final));
      pay.push(payroll(final) / standardPayroll(final.tier));
      // a new tier's buildings that started below today's health (the builders behind: package D)
      if ((final.builds ?? []).some((b) => b.finished !== undefined && (b.done ?? 0) < (b.need ?? 0))) late++;
    }
    const wk = (t: number) => {
      const m = med(reach[t]);
      return m >= 99 ? '  —' : String(m).padStart(3);
    };
    const g = (n: number) => (n / SEEDS).toFixed(1);
    console.log(
      `${name.padEnd(15)} ${String(med(tiers)).padStart(7)}   ${wk(2)}   ${wk(3)}   ${wk(4)}   ${wk(5)} ${String(Math.round((100 * bplus) / total)).padStart(4)} ${usd(Math.min(...mins)).padStart(9)} ${String(neg).padStart(8)} ${(inc / total).toFixed(2).padStart(9)} ${(def / total).toFixed(3).padStart(10)} ${usd(rev / total).padStart(7)} ${mean(lat).toFixed(2).padStart(8)}  ${`${g(aog.stock)}/${g(aog.approval)}/${g(aog.plan)}/${g(aog.carrier)}`.padStart(23)} ${g(subWeeks).padStart(6)} ${String(fill[1] ? Math.round((100 * fill[0]) / fill[1]) : 0).padStart(6)} ${(wait / Math.max(1, weeksAll)).toFixed(2).padStart(8)} ${usd(med(inv)).padStart(7)} ${`${Math.round(100 * med(bins))}%`.padStart(8)} ${`${Math.round(100 * med(pay))}%`.padStart(11)} ${`${Math.round((100 * late) / SEEDS)}%`.padStart(9)}  ${`${g(slip.returns)}/${g(slip.stops)}/${g(slip.reqs)}`.padStart(11)} ${usd(slip.restock / SEEDS).padStart(8)} ${g(slip.wiring).padStart(7)}`,
    );
  }
  const ms = (Date.now() - t0) / Math.max(1, sims);
  console.log(`\nTiming: ${Math.round(ms)} ms per ${WEEKS}-week sim (${sims} sims; the budget is 500 ms).`);
  console.log('AOG wk: plane-weeks grounded on an alert (the only guest plane too), per game, by why: not stocked / waiting on approval / not planned / the carrier.');
  console.log('latency: weeks from an alert to its sign-off. sub: weeks a mainland sub-charter flew the guests (the only guest plane on the ground), per game. fill%: main-slot value from stock at plan time, weeks 8-26.');
  console.log('payroll@26: the crew\'s payroll against the standard crew\'s. late bld: games where a new tier\'s buildings started before the builders finished them.');
  console.log('ret/stp/req: receiving returns, install stops and stock requests per game; restock: restocking fees per game; wiring: wiring faults met per game (5.4).');
  console.log('\nExit test (spec phase 0): "no role can win alone" + "no week ends with cash < 0 under sensible play".');
}
