// Writes the v4 island docs that tests/g0.test.ts, tests/skew.test.ts and tests/migrate.test.ts load (stage 2 = v5):
// docs written by the live stage 1 build (e810cc5, ENGINE_VERSION 4, DOC_VERSION 4) with its own engine and bots. Run
// it in a worktree of that commit outside the repo, never in this one (as scripts/fixtures-v3.ts):
//
//   git -C <repo> worktree add --detach <scratch>/live e810cc5
//   ln -s <repo>/island-company/node_modules <scratch>/live/island-company/node_modules
//   cp scripts/fixtures-v4.ts <scratch>/live/island-company/scripts/
//   (cd <scratch>/live/island-company && npx tsx scripts/fixtures-v4.ts <out dir> [g0|live|carry|all])
//   git -C <repo> worktree remove --force <scratch>/live
//
// It only dispatches moves (a bot's turn, an end of turn, the resolve) to the live engine's reducer; it never edits a
// doc by hand. It saves the first doc that matches each state, as v4-e810cc5-<name>.json. Three sets (default: all):
//
//   g0     (G0, 2026-09-30; tests/g0.test.ts) new islands, 'three friends' then 'all average', seeds 1-40, 52 weeks:
//          t2       tier 2, nothing for G0 to migrate
//          t4       the Harbor 3-6 weeks old (its villas' warranty dated from then still runs), the grid below 80
//          t4-mid   the same mid-week (one seat's turn ended, the others still open)
//          t5       the Resort some weeks in, a streak under way (no credits yet)
//          t5-late  the Resort long after the Harbor (the Harbor's villas out of warranty, the Lodge's still running)
//   live   (the stage 2 version gate, 2026-09-30; tests/skew.test.ts) new islands, 'three friends', 'mistakes' (the
//          same crew with a human's slips and a stock request a week), 'all average', 'naive analyst', seeds 1-60,
//          52 weeks:
//          early       tier 1, start of week 4: alerts open, the starter crew on the payroll
//          midweek     a tech ended the turn, the analyst hasn't started: an open requisition and a tech's card waiting
//          chain       mid-week, an open part chain (IPC lookup, research, the buy, transit or the install)
//          feeder      the electrician's underground feeder job in flight (approved: ready or waiting on its part)
//          subcharter  the only guest plane out of service: the mainland sub-charter flies its guests this week
//          rcv         in receivership with the receiver's bridge loan on the books
//   carry  (the same gate) a live island that was a v3 doc: the v3 docs the live job-flow build (bd1e1d2) wrote at tier
//          4-5 with an A streak (tests/fixtures/v3-bd1e1d2-*.json, scripts/fixtures-v3-late.ts), opened on e810cc5
//          (its migrate() carries the streak: stats.aCarry, stats.v4From) and played on by e810cc5's bots (the crew
//          that wrote them first, then the others), at least one week resolved by e810cc5:
//          credits       past the credits: e810cc5 rolled them on the carried streak (creditsWeek set, aCarry still on)
//          t4-carry      the Harbor, the carried streak still running (held at the Harbor)
//          t5-carry      the Resort, the carried streak still running, no credits yet
//          t5-carry-mid  the same mid-week
//
// The committed docs (2026-09-30; the g0 set reproduces G0's five byte for byte):
//   early 'three friends' seed 1 week 4 · midweek 'mistakes' 1, week 5 · chain 'mistakes' 1, week 28 (tier 3, at the
//   fee) · feeder 'three friends' 1, week 2 (waiting on its part) · subcharter 'three friends' 1, week 2 (the twin AOG
//   past due) · rcv 'three friends' 2, week 37 (tier 4, receivership 3, the loan $36,110) · credits: credits-next-t5 +
//   'all good', week 26 (the credits in week 25, aCarry 7) · t4-carry: t4-streak-high + 'all good', week 18 (8 carried)
//   · t5-carry and t5-carry-mid: credits-next-t5 + 'all average', week 26 (7 carried, held by an autopilot A in week 25)
//   (t5-harbor-streak is never needed: its first week on e810cc5 is a B, which ends the carried streak)
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { soleGuest } from '../src/sim/alerts';
import { botTurn, TEAMS } from '../src/sim/bots';
import { openChain } from '../src/sim/chain';
import { subCharterOn } from '../src/sim/econ';
import { apply, createIsland, ENGINE_VERSION } from '../src/sim/engine';
import { hashSeed, rng } from '../src/sim/rng';
import { ROLES, type Action, type IslandState, type Order, type Role } from '../src/sim/types';

if ((ENGINE_VERSION as number) !== 4) throw new Error(`Run this on the live v4 engine (e810cc5), not engine ${ENGINE_VERSION}.`);
const out = process.argv[2]!;
const set = process.argv[3] ?? 'all';
if (!out || !['g0', 'live', 'carry', 'all'].includes(set)) throw new Error('usage: npx tsx scripts/fixtures-v4.ts <out dir> [g0|live|carry|all]');
const step = (s: IslandState, a: Action, now: number) => {
  const r = apply(s, a, now);
  return r.error ? s : r.s;
};
const t = (s: IslandState, n: number) => s.stats.tierReachedWeek[n];
const live = (o: Order) => o.status !== 'done' && o.status !== 'cancelled';
const openAlerts = (s: IslandState) => (s.alerts ?? []).filter((a) => a.status !== 'closed');
type At = 'open' | 'mid';
type Want = { file: string; at: At[]; test(s: IslandState): boolean; optional?: boolean };

const found = new Map<string, string>();
function save(w: Want, s: IslandState, tag: string) {
  if (s.engine !== 4) throw new Error(`${w.file}: engine ${s.engine}`);
  found.set(w.file, tag);
  writeFileSync(resolve(out, `v4-e810cc5-${w.file}.json`), JSON.stringify(s));
  const grid = s.assets.find((a) => a.kind === 'grid')?.health.toFixed(1);
  const houses = s.assets.filter((a) => a.kind === 'house').map((a) => `${a.id}:${a.health.toFixed(0)}`).join(',');
  const turns = ROLES.map((r) => `${r}${s.turns[r]?.ended ? '+' : '-'}`).join(' ');
  console.log(
    `${w.file}: ${tag} week ${s.week} tier ${s.tier} reached ${JSON.stringify(s.stats.tierReachedWeek)} aStreak ${s.stats.aStreak} aCarry ${s.stats.aCarry} v4From ${s.stats.v4From} credits ${s.creditsWeek} cash ${s.cash} credit ${s.credit ?? 0} rcv ${s.receivership} loan ${JSON.stringify(s.loan)} turns ${turns} grid ${grid} houses ${houses}`,
  );
}
const check = (wants: Want[], s: IslandState, at: At, tag: string) => {
  for (const w of wants) if (w.at.includes(at) && !found.has(w.file) && w.test(s)) save(w, s, tag);
};

/** one week of the live engine's bots on `s` (each seat at its own time, the resolve at the deadline) */
function playWeek(s: IslandState, name: string, seed: number, away: ReturnType<typeof rng>, awayLast: Record<Role, boolean>, now: number, wants: Want[], tag: string): { s: IslandState; now: number } {
  const team = TEAMS[name];
  const week = s.week;
  const order = away.shuffle([...ROLES]);
  for (const role of order) {
    const bot = team[role];
    const missed = bot.absent || (bot.miss ? away.chance(bot.streak && awayLast[role] ? 0.5 : bot.miss) : false);
    awayLast[role] = !!missed;
    if (missed) continue;
    s = botTurn(s, role, bot, rng(hashSeed('bots', seed, name, role, week)), now);
    if (s.week === week) check(wants, s, 'mid', tag);
    s = step(s, { t: 'endTurn', role, week }, now);
    if (s.week === week) check(wants, s, 'mid', tag);
    now += 60_000;
  }
  if (s.week === week) {
    now = (s.deadline ?? now) + 1000;
    s = step(s, { t: 'resolve', week }, now);
  } else now += 86400_000;
  return { s, now };
}

/** new islands of `crews`, seeds 1..`seeds`, `weeks` weeks each, until every want is found */
function fresh(wants: Want[], crews: string[], seeds: number, weeks: number, idp: string) {
  const todo = () => wants.filter((w) => !found.has(w.file)).length;
  for (let seed = 1; seed <= seeds && todo() > 0; seed++) {
    for (const name of crews) {
      let now = Date.UTC(2026, 8, 1, 12);
      let s = createIsland({ id: `${idp}-${seed}`, name: 'Live Island', now, tz: 'Europe/Paris', seed: hashSeed('sim', seed), creator: { uid: 'u-mech', name: 'Seb', role: 'mech' } });
      s = step(s, { t: 'join', uid: 'u-elec', name: 'Ana', role: 'elec' }, now);
      s = step(s, { t: 'join', uid: 'u-fin', name: 'Cy', role: 'fin' }, now);
      for (const role of ROLES) s = step(s, { t: 'week0Done', role }, now);
      const away = rng(hashSeed('bots-away', seed, name));
      const awayLast: Record<Role, boolean> = { mech: false, elec: false, fin: false };
      for (let w = 0; w < weeks; w++) {
        const tag = `${name}/${seed}`;
        check(wants, s, 'open', tag);
        ({ s, now } = playWeek(s, name, seed, away, awayLast, now, wants, tag));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// g0: the docs tests/g0.test.ts was written on (unchanged since G0: this set reproduces them byte for byte)

const G0: Want[] = [
  { file: 't2', at: ['open'], test: (s) => s.tier === 2 && s.week >= 8 },
  { file: 't4', at: ['open'], test: (s) => s.tier === 4 && s.week - t(s, 4)! >= 3 && s.week - t(s, 4)! <= 6 && s.assets.find((a) => a.kind === 'grid')!.health < 80 },
  { file: 't4-mid', at: ['mid'], test: (s) => s.tier === 4 && s.week - t(s, 4)! >= 2 && ROLES.some((r) => s.turns[r]?.ended) && ROLES.some((r) => !s.turns[r]?.ended) },
  { file: 't5', at: ['open'], test: (s) => s.tier === 5 && s.week - t(s, 5)! >= 4 && s.week - t(s, 5)! <= 10 && (s.stats.aStreak ?? 0) >= 1 && !s.creditsWeek },
  { file: 't5-late', at: ['open'], test: (s) => s.tier === 5 && s.week > t(s, 4)! + 26 && s.week <= t(s, 5)! + 26 && s.assets.some((a) => a.kind === 'house' && a.health <= 75) },
];
if (set === 'g0' || set === 'all') fresh(G0, ['three friends', 'all average'], 40, 52, 'fx4');

// ---------------------------------------------------------------------------
// live: the states the stage 2 version gate plays on (a live island mid-season)

const LIVE: Want[] = [
  { file: 'early', at: ['open'], test: (s) => s.week === 4 && s.tier === 1 && openAlerts(s).length > 0 && (s.staff?.length ?? 0) > 0 },
  {
    file: 'midweek',
    at: ['mid'],
    test: (s) =>
      (!!s.turns.mech?.ended || !!s.turns.elec?.ended) &&
      !s.turns.fin?.ended &&
      (s.turns.fin?.done ?? 0) === 0 &&
      (s.reqs ?? []).some((q) => q.status === 'open') &&
      s.orders.some((o) => o.status === 'pending' && o.role !== 'fin' && !!o.flow),
  },
  { file: 'chain', at: ['mid'], test: (s) => !!openChain(s) && s.orders.some((o) => o.id === s.chain!.orderId && live(o)) },
  { file: 'feeder', at: ['open', 'mid'], test: (s) => s.orders.some((o) => o.role === 'elec' && o.job === 'feeder' && (o.status === 'ready' || o.status === 'waiting_part')) },
  { file: 'subcharter', at: ['open', 'mid'], test: (s) => { const sub = subCharterOn(s); return !!sub && soleGuest(s, sub.plane.id); } },
  { file: 'rcv', at: ['open'], test: (s) => s.receivership > 0 && !!s.loan && s.loan.left > 0 },
];
if (set === 'live' || set === 'all') fresh(LIVE, ['three friends', 'mistakes', 'all average', 'naive analyst'], 60, 52, 'fx4l');

// ---------------------------------------------------------------------------
// carry: v3 docs with an A streak, opened on e810cc5 (its migrate carries the streak) and played on by its bots

const onV4 = (s: IslandState) => s.stats.v4From !== undefined && s.week > s.stats.v4From;
const carrying = (s: IslandState) => onV4(s) && (s.stats.aCarry ?? 0) > 0 && (s.stats.aStreak ?? 0) > 0 && !s.creditsWeek;
const CARRY: Want[] = [
  { file: 't4-carry', at: ['open'], test: (s) => s.tier === 4 && carrying(s) },
  { file: 't5-carry', at: ['open'], test: (s) => s.tier === 5 && carrying(s) },
  { file: 't5-carry-mid', at: ['mid'], test: (s) => s.tier === 5 && carrying(s) && ROLES.some((r) => s.turns[r]?.ended) && ROLES.some((r) => !s.turns[r]?.ended) },
  { file: 'credits', at: ['open'], test: (s) => onV4(s) && !!s.creditsWeek && s.creditsWeek >= s.stats.v4From! && s.week > s.creditsWeek && (s.stats.aCarry ?? 0) > 0, optional: true },
];
// the v3 docs and the crews that wrote them (scripts/fixtures-v3-late.ts: 'fxl-<seed>')
const V3: [string, string][] = [
  ['v3-bd1e1d2-credits-next-t5', 'all good'],
  ['v3-bd1e1d2-t4-streak-high', 'all good'],
  ['v3-bd1e1d2-t5-harbor-streak', 'all average'],
];
// each doc with the crew that wrote it first, then the others (the away draws salted per crew), until every want is found
const CARRY_CREWS = ['all good', 'three friends', 'all average', 'naive analyst'];
if (set === 'carry' || set === 'all')
  for (const [file, first] of V3)
    for (const name of [first, ...CARRY_CREWS.filter((c) => c !== first)]) {
      if (CARRY.every((w) => found.has(w.file))) break;
      let s = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', 'tests', 'fixtures', `${file}.json`), 'utf8')) as IslandState;
      if (s.engine !== 3) throw new Error(`${file}: engine ${s.engine}`);
      const seed = Number(s.id.split('-')[1]);
      const away = rng(hashSeed('bots-away-v4', seed, name));
      const awayLast: Record<Role, boolean> = { mech: false, elec: false, fin: false };
      let now = s.updatedAt + 60_000;
      for (let w = 0; w < 16; w++) {
        const tag = `${file} + ${name}/${seed} on e810cc5`;
        check(CARRY, s, 'open', tag);
        ({ s, now } = playWeek(s, name, seed, away, awayLast, now, CARRY, tag));
      }
    }

let missing = 0;
const wanted = [...(set === 'g0' || set === 'all' ? G0 : []), ...(set === 'live' || set === 'all' ? LIVE : []), ...(set === 'carry' || set === 'all' ? CARRY : [])];
for (const w of wanted)
  if (!found.has(w.file)) {
    console.log(`${w.optional ? 'not found (optional)' : 'MISSING'} ${w.file}`);
    if (!w.optional) missing++;
  }
process.exit(missing ? 1 : 0);
