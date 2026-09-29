// Writes the v4 island docs tests/g0.test.ts loads (G0, stage 2 = v5, 2026-09-30): docs written by the live stage 1
// build (e810cc5, ENGINE_VERSION 4) with its own engine and bots, at tier 2 (no G0 migration), at the Harbor a few
// weeks after it went up (the builder's warranty dated from it still running), at the Resort mid-streak, and at the
// Resort long after the Harbor (the Harbor's warranty over, the Resort's still running: fair, no gift), plus one
// mid-week. Run it in a copy of that commit, never in this one (as scripts/fixtures-v3.ts):
//
//   mkdir -p <scratch>/live-e810cc5 && git archive e810cc5 island-company | tar -x -C <scratch>/live-e810cc5
//   ln -s <repo>/island-company/node_modules <scratch>/live-e810cc5/island-company/node_modules
//   cp scripts/fixtures-v4.ts <scratch>/live-e810cc5/island-company/scripts/
//   (cd <scratch>/live-e810cc5/island-company && npx tsx scripts/fixtures-v4.ts <out dir>)
//
// It plays the live engine's own bots week by week, each seat at its own time and the resolve at the deadline, and
// saves the first doc that matches each state. It only dispatches moves (a bot's turn, an end of turn, the resolve);
// it never edits a doc by hand. The committed docs are named v4-e810cc5-<name>.json.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { botTurn, TEAMS } from '../src/sim/bots';
import { apply, createIsland, ENGINE_VERSION } from '../src/sim/engine';
import { hashSeed, rng } from '../src/sim/rng';
import { ROLES, type Action, type IslandState, type Role } from '../src/sim/types';

if ((ENGINE_VERSION as number) !== 4) throw new Error('live engine only');
const out = process.argv[2]!;
const step = (s: IslandState, a: Action, now: number) => {
  const r = apply(s, a, now);
  return r.error ? s : r.s;
};
const t = (s: IslandState, n: number) => s.stats.tierReachedWeek[n];
type At = 'open' | 'mid';
type Want = { file: string; at: At[]; test(s: IslandState): boolean };
const WANT: Want[] = [
  // tier 2: nothing for G0 to migrate (its Harbor comes on v5, with the warranty)
  { file: 't2', at: ['open'], test: (s) => s.tier === 2 && s.week >= 8 },
  // the Harbor 3-6 weeks old: its villas' warranty dated from then still runs; the grid below 80 (the upgrade raises it)
  { file: 't4', at: ['open'], test: (s) => s.tier === 4 && s.week - t(s, 4)! >= 3 && s.week - t(s, 4)! <= 6 && s.assets.find((a) => a.kind === 'grid')!.health < 80 },
  // the same mid-week (one seat's turn ended, the others still open)
  { file: 't4-mid', at: ['mid'], test: (s) => s.tier === 4 && s.week - t(s, 4)! >= 2 && ROLES.some((r) => s.turns[r]?.ended) && ROLES.some((r) => !s.turns[r]?.ended) },
  // the Resort, some weeks in, a streak under way
  { file: 't5', at: ['open'], test: (s) => s.tier === 5 && s.week - t(s, 5)! >= 4 && s.week - t(s, 5)! <= 10 && (s.stats.aStreak ?? 0) >= 1 && !s.creditsWeek },
  // the Resort long after the Harbor: the Harbor's villas out of warranty, the Lodge's still running
  { file: 't5-late', at: ['open'], test: (s) => s.tier === 5 && s.week > t(s, 4)! + 26 && s.week <= t(s, 5)! + 26 && s.assets.some((a) => a.kind === 'house' && a.health <= 75) },
];
const found = new Map<string, string>();
const check = (s: IslandState, at: At, tag: string) => {
  for (const w of WANT)
    if (w.at.includes(at) && !found.has(w.file) && w.test(s)) {
      found.set(w.file, tag);
      writeFileSync(resolve(out, `v4-e810cc5-${w.file}.json`), JSON.stringify(s));
      console.log(`${w.file}: ${tag} week ${s.week} tier ${s.tier} reached ${JSON.stringify(s.stats.tierReachedWeek)} aStreak ${s.stats.aStreak} cash ${s.cash} grid ${s.assets.find((a) => a.kind === 'grid')?.health.toFixed(1)} houses ${s.assets.filter((a) => a.kind === 'house').map((a) => `${a.id}:${a.health.toFixed(0)}`).join(',')}`);
    }
};
for (let seed = 1; seed <= 40 && found.size < WANT.length; seed++) {
  for (const name of ['three friends', 'all average']) {
    const team = TEAMS[name];
    let now = Date.UTC(2026, 8, 1, 12);
    let s = createIsland({ id: `fx4-${seed}`, name: 'Live Island', now, tz: 'Europe/Paris', seed: hashSeed('sim', seed), creator: { uid: 'u-mech', name: 'Seb', role: 'mech' } });
    s = step(s, { t: 'join', uid: 'u-elec', name: 'Ana', role: 'elec' }, now);
    s = step(s, { t: 'join', uid: 'u-fin', name: 'Cy', role: 'fin' }, now);
    for (const role of ROLES) s = step(s, { t: 'week0Done', role }, now);
    const away = rng(hashSeed('bots-away', seed, name));
    const awayLast: Record<Role, boolean> = { mech: false, elec: false, fin: false };
    for (let w = 0; w < 52; w++) {
      const week = s.week;
      const tag = `${name}/${seed}`;
      check(s, 'open', tag);
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
      if (s.week === week) {
        now = (s.deadline ?? now) + 1000;
        s = step(s, { t: 'resolve', week }, now);
      } else now += 86400_000;
    }
  }
}
for (const w of WANT) if (!found.has(w.file)) console.log('MISSING', w.file);
