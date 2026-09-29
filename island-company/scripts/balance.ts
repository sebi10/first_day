// Phase-0 paper sim: run scripted teams through N weeks over many seeds and
// print the numbers the spec's exit test asks for (docs/JOBFLOW.md 20).
//   npm run balance                       # summary over 26 weeks x 30 seeds, with the job flow's columns and a timing line
//   npm run balance -- detail [team] [n]  # week by week for one seed
//   npm run balance -- robust             # the two target teams over 90 seeds x 4 re-rolled crews (slow, a few minutes);
//                                         # its 26-week columns as before, plus the long game's (52 weeks: games below $0 in weeks 24-52, credits by week 45)
//   npm run balance -- long [78]          # the long game (docs/EXPANSION.md 11.1 T1): every team over 52 weeks x 30 seeds, no network;
//                                         # its money table (T1) and a trajectory table (does the Resort hold: houses rentable at
//                                         # weeks 40 and 52, revenue against budget, the cash slope). `long 78` plays 78 weeks and
//                                         # adds weeks 65 and 78 (review round 1: the 52-week window hid a delayed collapse)
//   npm run balance -- flow [team] [n]    # the first 40 alerts of one game: symptom, hidden cause, the bot's task and pick, the verdict, what came of it
//   npm run balance -- cottages           # the three friends with an analyst who starts a cottage at tier 4 (the staff update's growth project)
//   add checks=off to any run             # stage 2 (docs/EXPANSION.md 11.1 T7): the bots make no quick checks and no flags (the run as before they existed)
// The summary's `mistakes` crew is the three friends with a human's slips (a near-miss pick on one plan in ten, a
// stock request a week): its money and latency next to the three friends' price the mistakes the bots don't make.
import { causeOf, fixesOf, symptomOf } from '../src/sim/alerts';
import { simulate, TEAMS, type SimWeek, type Team } from '../src/sim/bots';
import { stdPickFor, planTask } from '../src/sim/flow';
import { ECON } from '../src/sim/data';
import { invValue } from '../src/sim/ledger';
import { payroll, standardPayroll } from '../src/sim/staff';
import { binsInUse, binsTotal } from '../src/sim/stock';
import type { Alert, IslandState, Order } from '../src/sim/types';

const WEEKS = 26;
const SEEDS = 30;
// stage 2 (T7): `checks=off` anywhere in the arguments turns the bots' quick checks and flags off
const checksOff = process.argv.includes('checks=off');
const args = process.argv.slice(2).filter((a) => a !== 'checks=off');
process.argv.splice(2, process.argv.length - 2, ...args);
/** the long game (docs/EXPANSION.md 11.1 T1): 52 weeks, judged on weeks 24-52 (after the Resort); `long 78` plays on to week 78 */
const LONG = 52;
const LONG_FROM = 24;
const LONG_MAX = process.argv[2] === 'long' && process.argv[3] === '78' ? 78 : LONG;
/** a dead week: the island took less than this in revenue (planes rotting, houses dark) */
const DEAD_REV = 2000;
/** the T1 target: the credits (8 full-crew A weeks at the Resort, none below A) by this week */
const CREDITS_BY = 45;
const arg = process.argv[2];
/** a team as the run plays it: with checks=off, no bot makes a quick check or a flag */
const crew = (t: Team): Team =>
  checksOff ? { mech: { ...t.mech, checks: false, flags: false }, elec: { ...t.elec, checks: false, flags: false }, fin: { ...t.fin, checks: false, flags: false } } : t;
if (checksOff) console.log('(checks=off: no quick checks or flags)');

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
  /** stage 2: quick-check write-ups (right calls, wrong calls) and flags raised, per game */
  chkRight: number;
  chkWrong: number;
  flags: number;
};
function flowTrace(): { f: Flow; trace: (s: IslandState) => void } {
  const f: Flow = { latency: [], aog: { stock: 0, approval: 0, plan: 0, carrier: 0 }, subWeeks: 0, fill: [0, 0], wait: 0, weeks: 0, returns: 0, stops: 0, reqs: 0, restock: 0, wiring: 0, chkRight: 0, chkWrong: 0, flags: 0 };
  const checked = new Set<string>();
  const closed = new Set<string>();
  const stopped = new Set<string>();
  const asked = new Set<string>();
  const wired = new Set<string>();
  const trace = (s: IslandState) => {
    const once = (seen: Set<string>, id: string) => !seen.has(id) && !!seen.add(id);
    for (const o of s.orders) if (o.flow?.stop && once(stopped, o.id)) f.stops++;
    for (const q of s.reqs ?? []) if (!q.order && once(asked, q.id)) f.reqs++;
    for (const a of s.alerts ?? []) if (a.kind === 'wiring' && once(wired, a.id)) f.wiring++;
    for (const a of s.alerts ?? []) {
      if ((a.src !== 'check' && a.src !== 'flag') || !once(checked, a.id)) continue;
      if (a.src === 'flag') f.flags++;
      else if (a.early) f.chkRight++;
      else f.chkWrong++;
    }
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

/** one long game's T1 numbers (docs/EXPANSION.md 11.1): weeks 24-52 judged, the credits' week, the A rate at tier 5, condition */
type LongGame = {
  /** weeks below $0 and dead weeks (revenue < $2,000) in weeks 24-52 */
  neg: number;
  dead: number;
  /** cash at the end of weeks 26, 39 and 52 */
  cash: [number, number, number];
  /** the week the credits came (8 full-crew A weeks at the Resort), 99 = never */
  credits: number;
  t5: number;
  aWeeks: number;
  t5Weeks: number;
  receiverships: number;
  /** mean house and grid health over weeks 30-52 */
  house: number;
  grid: number;
  tiers: Record<number, number>;
  /** the trajectory (review round 1): week by week after the resolve, weeks 1..N */
  at: Record<number, { house: number; grid: number; rentable: number; houses: number }>;
  /** revenue against the tier's budget over weeks 40-52 (mean of the weeks' shares) */
  revShare: number;
  /** $ a week, weeks 39-52 */
  slope: number;
  /** weeks below $0 after week 52 (a 78-week run) */
  negAfter: number;
  cashAt: (week: number) => number;
};
function longGame(team: Team, seed: number, salt = '', trace?: (s: IslandState) => void, weeksN = LONG): { g: LongGame; weeks: SimWeek[]; final: IslandState } {
  const hp = { house: [] as number[], grid: [] as number[] };
  const at: LongGame['at'] = {};
  const share: number[] = [];
  let recv = 0;
  let inRecv = false;
  const { weeks, final } = simulate(
    team,
    weeksN,
    seed,
    (s) => {
      trace?.(s);
      const W = s.week - 1;
      if (s.receivership > 0 && !inRecv && W <= LONG) recv++;
      inRecv = s.receivership > 0;
      const hs = s.assets.filter((a) => a.kind === 'house');
      const g = s.assets.find((a) => a.kind === 'grid');
      const h = s.history[s.history.length - 1];
      at[W] = { house: hs.length ? mean(hs.map((a) => a.health)) : NaN, grid: g?.health ?? NaN, rentable: h?.housesRentable ?? 0, houses: hs.length };
      if (W >= 40 && W <= 52 && h) share.push(h.revenue / Math.max(1, h.budget));
      if (W < 30 || W > LONG) return;
      if (hs.length) hp.house.push(mean(hs.map((a) => a.health)));
      if (g) hp.grid.push(g.health);
    },
    salt,
  );
  const late = weeks.filter((w) => w.week >= LONG_FROM && w.week <= LONG);
  const at_ = (wk: number) => weeks.find((w) => w.week === wk)?.cash ?? NaN;
  const t5w = weeks.filter((w) => w.tier === 5 && w.week <= LONG);
  return {
    g: {
      neg: late.filter((w) => w.cash < 0).length,
      dead: late.filter((w) => w.revenue < DEAD_REV).length,
      cash: [at_(26), at_(39), at_(52)],
      // (capped at week 52 like every other long column: `long 78` counted credits won in weeks 53-78)
      credits: final.creditsWeek && final.creditsWeek <= LONG ? final.creditsWeek : 99,
      t5: final.stats.tierReachedWeek[5] ?? 99,
      aWeeks: t5w.filter((w) => w.grade === 'A').length,
      t5Weeks: t5w.length,
      receiverships: recv,
      house: mean(hp.house),
      grid: mean(hp.grid),
      tiers: final.stats.tierReachedWeek,
      at,
      revShare: mean(share),
      slope: (at_(52) - at_(39)) / 13,
      negAfter: weeks.filter((w) => w.week > LONG && w.cash < 0).length,
      cashAt: at_,
    },
    weeks,
    final,
  };
}

if (arg === 'detail') {
  const team = process.argv[3] ?? 'all good';
  const seed = Number(process.argv[4] ?? 1);
  const extra: string[] = [];
  const seen = new Set<string>();
  const { weeks } = simulate(crew(TEAMS[team]), WEEKS, seed, (s) => {
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
  // Each game plays 52 weeks: the 26-week columns read only its first 26 (the same numbers a 26-week run gives:
  // a week's play never depends on how long the run is), and the last two columns are the long game's (T1).
  console.log(`\nRobustness: ${WEEKS} weeks x 90 seeds x 4 crews per team (and the long game: ${LONG} weeks)\n`);
  console.log(`team            crew  wk→T5  miss T5  weeks<0  min cash  defect/wk  latency  AOG wk  fill%  long<0 wk${LONG_FROM}+  credits≤${CREDITS_BY}`);
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
      let longNeg = 0;
      let credits = 0;
      for (let seed = 1; seed <= 90; seed++) {
        const { f, trace } = flowTrace();
        const { g, weeks } = longGame(crew(TEAMS[name]), seed, salt, (s) => {
          if (s.week - 1 <= WEEKS) trace(s);
        });
        t5.push(g.t5 <= WEEKS ? g.t5 : 99);
        for (const w of weeks.slice(0, WEEKS)) {
          n++;
          def += w.defects;
          if (w.cash < 0) neg++;
          min = Math.min(min, w.cash);
        }
        lat.push(...f.latency);
        aog += Object.values(f.aog).reduce((a, b) => a + b, 0);
        fill[0] += f.fill[0];
        fill[1] += f.fill[1];
        if (g.neg > 0) longNeg++;
        if (g.credits <= CREDITS_BY) credits++;
      }
      console.log(
        `${name.padEnd(15)} ${(salt || '-').padStart(4)} ${String(med(t5)).padStart(6)} ${String(t5.filter((x) => x === 99).length).padStart(8)} ${String(neg).padStart(8)} ${usd(Math.min(min, ECON.startCash)).padStart(9)} ${(def / n).toFixed(3).padStart(10)} ${mean(lat).toFixed(2).padStart(8)} ${(aog / 90).toFixed(1).padStart(7)} ${String(Math.round((100 * fill[0]) / Math.max(1, fill[1]))).padStart(6)} ${`${longNeg}/90`.padStart(13)} ${`${credits}/90`.padStart(11)}`,
      );
    }
  }
  console.log(`\nlong<0: games ever below $0 in weeks ${LONG_FROM}-${LONG}; credits: games that reach the credits (8 full-crew A weeks at the Resort, none below A) by week ${CREDITS_BY}.`);
} else if (arg === 'long') {
  // the long game (docs/EXPANSION.md 11.1 T1): does the Resort hold? 52 weeks x 30 seeds, no network, every team
  console.log(`\nThe long game: ${LONG_MAX} weeks x ${SEEDS} seeds per team (weeks ${LONG_FROM}-${LONG} judged; medians unless noted)\n`);
  console.log(
    `team            wk→T2 wk→T3 wk→T4 wk→T5  games<0  weeks<0 (med)  dead wk (med)  recv   cash@26   cash@39   cash@52  credits wk  credits≤${CREDITS_BY}  A@T5  house hp  grid hp`,
  );
  const t0 = Date.now();
  let sims = 0;
  const all: [string, LongGame[]][] = [];
  for (const [name, team] of Object.entries(TEAMS)) {
    const gs: LongGame[] = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
      gs.push(longGame(crew(team), seed, '', undefined, LONG_MAX).g);
      sims++;
    }
    all.push([name, gs]);
    const wk = (t: number) => {
      const m = med(gs.map((g) => g.tiers[t] ?? 99));
      return m >= 99 ? '  —' : String(m).padStart(3);
    };
    const cash = (i: 0 | 1 | 2) => usd(med(gs.map((g) => g.cash[i]))).padStart(9);
    const cw = med(gs.map((g) => g.credits));
    const t5w = gs.reduce((n, g) => n + g.t5Weeks, 0);
    const aw = gs.reduce((n, g) => n + g.aWeeks, 0);
    const sum = (k: 'neg' | 'dead' | 'receiverships') => gs.reduce((n, g) => n + g[k], 0);
    console.log(
      `${name.padEnd(15)}   ${wk(2)}   ${wk(3)}   ${wk(4)}   ${wk(5)} ${`${gs.filter((g) => g.neg > 0).length}/${SEEDS}`.padStart(8)} ${`${sum('neg')} (${med(gs.map((g) => g.neg))})`.padStart(14)} ${`${sum('dead')} (${med(gs.map((g) => g.dead))})`.padStart(14)} ${String(sum('receiverships')).padStart(5)} ${cash(0)} ${cash(1)} ${cash(2)} ${(cw >= 99 ? '—' : String(cw)).padStart(11)} ${`${Math.round((100 * gs.filter((g) => g.credits <= CREDITS_BY).length) / SEEDS)}%`.padStart(11)} ${(t5w ? `${Math.round((100 * aw) / t5w)}%` : '—').padStart(5)} ${mean(gs.map((g) => g.house)).toFixed(0).padStart(9)} ${mean(gs.map((g) => g.grid)).toFixed(0).padStart(8)}`,
    );
  }
  const ms = (Date.now() - t0) / Math.max(1, sims);
  console.log(`\nTiming: ${Math.round(ms)} ms per ${LONG_MAX}-week sim (${sims} sims).`);
  console.log(`games<0: games ever below $0 in weeks ${LONG_FROM}-${LONG}. weeks<0 and dead wk (revenue < ${usd(DEAD_REV)}): summed over the ${SEEDS} games in weeks ${LONG_FROM}-${LONG}, (the median game).`);
  console.log(`recv: receiverships entered by week ${LONG}, summed. credits wk: the median game's credits week (8 full-crew A weeks at the Resort, none below A; — = the median game never gets there). credits≤${CREDITS_BY}: games with the credits by week ${CREDITS_BY}.`);
  console.log(`A@T5: the share of tier-5 weeks graded A (to week ${LONG}). house hp / grid hp: mean health over weeks 30-52 (houses averaged), averaged over the games.`);
  // the trajectory (review round 1): the means above hide the end state, so the Resort's condition week by week
  const far = LONG_MAX > LONG;
  console.log(`\nDoes the Resort hold? The trajectory (medians over the ${SEEDS} games; health after the week's resolve)\n`);
  console.log(
    `team            house@40 house@52 grid@52  rent@40  rent@52  rev/budget 40-52  cash/wk 39-52${far ? '  house@65 house@78  rent@65  rent@78   cash@65   cash@78  games<0 53-78' : ''}`,
  );
  for (const [name, gs] of all) {
    const m = (f: (g: LongGame) => number) => med(gs.map(f));
    const hp = (w: number) => m((g) => g.at[w]?.house ?? NaN).toFixed(0).padStart(8);
    const rent = (w: number) => `${m((g) => g.at[w]?.rentable ?? 0)}/${m((g) => g.at[w]?.houses ?? 0)}`.padStart(8);
    console.log(
      `${name.padEnd(15)} ${hp(40)} ${hp(52)} ${m((g) => g.at[52]?.grid ?? NaN).toFixed(0).padStart(7)} ${rent(40)} ${rent(52)} ${`${Math.round(100 * m((g) => g.revShare))}%`.padStart(17)} ${usd(m((g) => g.slope)).padStart(14)}${far ? ` ${hp(65)} ${hp(78)} ${rent(65)} ${rent(78)} ${usd(m((g) => g.cashAt(65))).padStart(9)} ${usd(m((g) => g.cashAt(78))).padStart(9)} ${`${gs.filter((g) => g.negAfter > 0).length}/${SEEDS}`.padStart(14)}` : ''}`,
    );
  }
  console.log(`rent@N: houses rentable at week N's resolve, of the houses there. rev/budget: the week's revenue against the tier's budget, weeks 40-52, the median game's mean. cash/wk: the median game's cash slope, weeks 39-52.`);
  console.log(`\nT1 (docs/EXPANSION.md 11.1): three friends and all average at a median of 0 weeks below $0 in weeks ${LONG_FROM}-${LONG}; at most 3 of ${SEEDS} games ever below $0; median dead weeks ≤ 2; the credits by week ${CREDITS_BY} in ≥ 50% of three-friends games; tier medians as in T0.`);
  console.log('The hold line (review round 1, proposed): the median three-friends game has at least 4 of 7 houses rentable at week 52, and revenue at 70% of budget or more in weeks 40-52.');
} else if (arg === 'flow') {
  // the first 40 alerts of one game, to tune the symptom weights: what it looked like, what it really was, what the bot did and what came of it
  const team = process.argv[3] ?? 'three friends';
  const seed = Number(process.argv[4] ?? 1);
  type Row = { a: Alert; o?: Order; stop?: string; pick?: string; std?: string; task?: string; fixes: string[]; defects: string[]; again: boolean };
  const rows = new Map<string, Row>();
  simulate(crew(TEAMS[team]), WEEKS, seed, (s) => {
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
    'team            tier@26  wk→T2 wk→T3 wk→T4 wk→T5  %B+  min cash  weeks<0  incid/wk  defect/wk  rev/wk  latency  AOG wk (stk/apr/pln/car)    sub  fill%  wait/wk  inv@26  bins@26  payroll@26  late bld  ret/stp/req  restock  wiring  chk r/w/flag',
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
    const slip = { returns: 0, stops: 0, reqs: 0, restock: 0, wiring: 0, chkRight: 0, chkWrong: 0, flags: 0 };
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { f, trace } = flowTrace();
      const { weeks, final, minCash } = simulate(crew(team), WEEKS, seed, trace);
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
      `${name.padEnd(15)} ${String(med(tiers)).padStart(7)}   ${wk(2)}   ${wk(3)}   ${wk(4)}   ${wk(5)} ${String(Math.round((100 * bplus) / total)).padStart(4)} ${usd(Math.min(...mins)).padStart(9)} ${String(neg).padStart(8)} ${(inc / total).toFixed(2).padStart(9)} ${(def / total).toFixed(3).padStart(10)} ${usd(rev / total).padStart(7)} ${mean(lat).toFixed(2).padStart(8)}  ${`${g(aog.stock)}/${g(aog.approval)}/${g(aog.plan)}/${g(aog.carrier)}`.padStart(23)} ${g(subWeeks).padStart(6)} ${String(fill[1] ? Math.round((100 * fill[0]) / fill[1]) : 0).padStart(6)} ${(wait / Math.max(1, weeksAll)).toFixed(2).padStart(8)} ${usd(med(inv)).padStart(7)} ${`${Math.round(100 * med(bins))}%`.padStart(8)} ${`${Math.round(100 * med(pay))}%`.padStart(11)} ${`${Math.round((100 * late) / SEEDS)}%`.padStart(9)}  ${`${g(slip.returns)}/${g(slip.stops)}/${g(slip.reqs)}`.padStart(11)} ${usd(slip.restock / SEEDS).padStart(8)} ${g(slip.wiring).padStart(7)}  ${`${g(slip.chkRight)}/${g(slip.chkWrong)}/${g(slip.flags)}`.padStart(12)}`,
    );
  }
  const ms = (Date.now() - t0) / Math.max(1, sims);
  console.log(`\nTiming: ${Math.round(ms)} ms per ${WEEKS}-week sim (${sims} sims; the budget is 500 ms).`);
  console.log('AOG wk: plane-weeks grounded on an alert (the only guest plane too), per game, by why: not stocked / waiting on approval / not planned / the carrier.');
  console.log('latency: weeks from an alert to its sign-off. sub: weeks a mainland sub-charter flew the guests (the only guest plane on the ground), per game. fill%: main-slot value from stock at plan time, weeks 8-26.');
  console.log('payroll@26: the crew\'s payroll against the standard crew\'s. late bld: games where a new tier\'s buildings started before the builders finished them.');
  console.log('ret/stp/req: receiving returns, install stops and stock requests per game; restock: restocking fees per game; wiring: wiring faults met per game (5.4).');
  console.log('chk r/w/flag (stage 2): quick-check write-ups per game, right calls (found early) / wrong calls (no-fault write-ups), and flags raised.');
  console.log('\nExit test (spec phase 0): "no role can win alone" + "no week ends with cash < 0 under sensible play".');
}
