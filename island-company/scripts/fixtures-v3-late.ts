// Writes the late-game v3 island docs tests/releasegate.test.ts loads (the stage 1 release gate, 2026-09-29): docs
// written by the live build (bd1e1d2, ENGINE_VERSION 3) at tier 4 and 5 with an A streak in progress, an autopilot A
// at the Resort, and a receivership below $0. Run it in a worktree of that commit, never in this one (as
// scripts/fixtures-v3.ts):
//
//   git worktree add <scratch>/live-bd1e1d2 bd1e1d2
//   ln -s <repo>/island-company/node_modules <scratch>/live-bd1e1d2/island-company/node_modules
//   cp scripts/fixtures-v3-late.ts <scratch>/live-bd1e1d2/island-company/scripts/
//   (cd <scratch>/live-bd1e1d2/island-company && npx tsx scripts/fixtures-v3-late.ts <out dir> '<crews>' <set>)
//   git worktree remove <scratch>/live-bd1e1d2
//
// It plays the live engine's own bots week by week, each seat at its own time and the resolve at the deadline, and
// saves the first doc that matches each state of the set (a, b, c or d below). It only dispatches moves (a bot's turn,
// an end of turn, the resolve); it never edits a doc by hand. The committed docs, renamed v3-bd1e1d2-<name>.json:
//   credits-next-t5      set d, 'all good' (seed 8, week 25: stored streak 7, tier 5 since week 21)
//   t5-harbor-streak     set b's tf-t5-harbor-streak, 'all average' (seed 15, week 25: stored 6, tier 5 since 24)
//   t4-streak-high       set a, 'all good' (seed 1, week 17: tier 4, stored 8)
//   t5-auto-a            set c, 'three friends' (seed 4, week 24: week 23 an autopilot A at the Resort)
//   rcv-neg              set b, 'three friends' (seed 1, week 41: receivership, cash below $0, the bridge loan)
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { botTurn, TEAMS } from '../src/sim/bots';
import { apply, createIsland, ENGINE_VERSION } from '../src/sim/engine';
import { hashSeed, rng } from '../src/sim/rng';
import { ROLES, type Action, type IslandState, type Role } from '../src/sim/types';

if ((ENGINE_VERSION as number) !== 3) throw new Error('live engine only');
const out = process.argv[2]!;
const step = (s: IslandState, a: Action, now: number) => { const r = apply(s, a, now); return r.error ? s : r.s; };
const resortWeeks = (s: IslandState) => (s.tier < 5 ? 0 : s.week - 1 - (s.stats.tierReachedWeek[5] ?? 0));
const openReq = (s: IslandState) => (s.reqs ?? []).some((q) => q.status === 'open');
const projOpen = (s: IslandState) => !!s.project && s.orders.some((o) => o.kind === 'project' && o.status !== 'done' && o.status !== 'cancelled');
type At = 'open' | 'mid';
type Want = { file: string; at: At[]; test(s: IslandState): boolean };
const WANT: Want[] = process.argv[4] === 'd' ? [
  // one full-crew A week from the credits under the live rules, the streak mostly Harbor weeks
  { file: 'credits-next-t5', at: ['open'], test: (s) => s.tier === 5 && !s.creditsWeek && (s.stats.aStreak ?? 0) >= 7 && (s.stats.aStreak ?? 0) > resortWeeks(s) + 2 },
  { file: 'credits-next-t4', at: ['open'], test: (s) => s.tier === 4 && (s.stats.aStreak ?? 0) >= 7 && !!s.project && s.project.tier === 5 && s.orders.filter((o) => o.kind === 'project' && o.status !== 'done' && o.status !== 'cancelled').length === 1 },
] : process.argv[4] === 'c' ? [
  { file: 't5-auto-a', at: ['open'], test: (s) => s.tier === 5 && s.history.slice(-12).some((r) => r.grade === 'A' && r.autoRun?.length && r.week > (s.stats.tierReachedWeek[5] ?? 99)) },
] : process.argv[4] === 'b' ? [
  { file: 'tf-t5-harbor-streak', at: ['open'], test: (s) => s.tier === 5 && !s.creditsWeek && (s.stats.aStreak ?? 0) >= 3 && (s.stats.aStreak ?? 0) > resortWeeks(s) },
  { file: 'tf-t4-streak-project', at: ['open', 'mid'], test: (s) => s.tier === 4 && (s.stats.aStreak ?? 0) >= 3 && projOpen(s) },
  { file: 'rcv-neg', at: ['open'], test: (s) => s.receivership > 0 && !!s.loan && s.cash < 0 && s.tier >= 3 },
  { file: 'rcv-neg-mid', at: ['mid'], test: (s) => s.receivership > 0 && !!s.loan && s.cash < 0 && openReq(s) },
] : [
  { file: 't5-harbor-streak', at: ['open'], test: (s) => s.tier === 5 && !s.creditsWeek && (s.stats.aStreak ?? 0) >= 3 && (s.stats.aStreak ?? 0) > resortWeeks(s) + 1 },
  { file: 't5-harbor-streak-mid', at: ['mid'], test: (s) => s.tier === 5 && !s.creditsWeek && (s.stats.aStreak ?? 0) >= 3 && (s.stats.aStreak ?? 0) > resortWeeks(s) + 1 && openReq(s) },
  { file: 't4-streak-project', at: ['open'], test: (s) => s.tier === 4 && (s.stats.aStreak ?? 0) >= 4 && projOpen(s) },
  { file: 't4-streak-mid', at: ['mid'], test: (s) => s.tier === 4 && (s.stats.aStreak ?? 0) >= 3 && openReq(s) && projOpen(s) },
  { file: 't4-streak-high', at: ['open'], test: (s) => s.tier === 4 && (s.stats.aStreak ?? 0) >= 6 },
  { file: 'rcv-t4', at: ['open'], test: (s) => s.receivership > 0 && !!s.loan && s.tier >= 3 },
  { file: 'rcv-any', at: ['open', 'mid'], test: (s) => s.receivership > 0 && !!s.loan },
];
const found = new Map<string, string>();
const check = (s: IslandState, at: At, tag: string) => {
  for (const w of WANT)
    if (w.at.includes(at) && !found.has(w.file) && w.test(s)) {
      found.set(w.file, tag);
      writeFileSync(resolve(out, `${w.file}.json`), JSON.stringify(s));
      console.log(`${w.file}: ${tag} week ${s.week} tier ${s.tier} aStreak ${s.stats.aStreak} t5 ${s.stats.tierReachedWeek[5]} cash ${s.cash} rcv ${s.receivership} loan ${JSON.stringify(s.loan)} reqsOpen ${(s.reqs ?? []).filter((q) => q.status === 'open').length} project ${s.project?.tier}`);
    }
};
const CREWS = (process.argv[3] ?? 'three friends,all average,all good,mistakes,naive analyst').split(',');
const maxStreak: Record<string, number> = {};
for (let seed = 1; seed <= 120 && found.size < WANT.length; seed++) {
  for (const name of CREWS) {
    const team = TEAMS[name];
    let now = Date.UTC(2026, 8, 1, 12);
    let s = createIsland({ id: `fxl-${seed}`, name: 'Live Island', now, tz: 'Europe/Paris', seed: hashSeed('sim', seed), creator: { uid: 'u-mech', name: 'Seb', role: 'mech' } });
    s = step(s, { t: 'join', uid: 'u-elec', name: 'Ana', role: 'elec' }, now);
    s = step(s, { t: 'join', uid: 'u-fin', name: 'Cy', role: 'fin' }, now);
    for (const role of ROLES) s = step(s, { t: 'week0Done', role }, now);
    const away = rng(hashSeed('bots-away', seed, name));
    const awayLast: Record<Role, boolean> = { mech: false, elec: false, fin: false };
    for (let w = 0; w < 44; w++) {
      const week = s.week;
      const tag = `${name}/${seed}`;
      check(s, 'open', tag);
      maxStreak[name] = Math.max(maxStreak[name] ?? 0, s.stats.aStreak ?? 0);
      const order = away.shuffle([...ROLES]);
      for (const role of order) {
        const bot = team[role];
        const missed = bot.absent || (bot.miss ? away.chance(bot.streak && awayLast[role] ? 0.5 : bot.miss) : false);
        awayLast[role] = !!missed;
        if (missed) continue;
        s = botTurn(s, role, bot, rng(hashSeed('bots', seed, name, role, week)), now);
        if (s.week === week) check(s, 'mid', tag);
        s = step(s, { t: 'endTurn', role, week }, now);
        if (s.week === week) check(s, 'mid', tag);
        now += 60_000;
      }
      if (s.week === week) { now = (s.deadline ?? now) + 1000; s = step(s, { t: 'resolve', week }, now); } else now += 86400_000;
    }
  }
}
console.log('max streak by crew', maxStreak);
for (const w of WANT) if (!found.has(w.file)) console.log('MISSING', w.file);
