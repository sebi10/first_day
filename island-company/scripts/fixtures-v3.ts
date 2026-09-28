// Writes the v3 island docs that tests/skew.test.ts and tests/migrate.test.ts
// load: docs written by the live build of the job flow (bd1e1d2, ENGINE_VERSION 3,
// DOC_VERSION 3). Run it in a worktree of that commit, never in this one:
//
//   git worktree add <scratch>/live-bd1e1d2 bd1e1d2
//   ln -s <repo>/island-company/node_modules <scratch>/live-bd1e1d2/island-company/node_modules
//   cp scripts/fixtures-v3.ts <scratch>/live-bd1e1d2/island-company/scripts/
//   (cd <scratch>/live-bd1e1d2/island-company && npx tsx scripts/fixtures-v3.ts <out dir>)
//   git worktree remove <scratch>/live-bd1e1d2
//
// It plays the live engine's own bots week by week, the way its paper sim does
// (each seat at its own time, then the resolve at the deadline), with two crews:
// 'three friends' and 'mistakes' (the same crew with a human's slips and a stock
// request a week, which is what leaves requisitions open mid-week). It saves the
// first doc that matches each state below. Every doc is written by the live
// engine's reducer: the script only dispatches moves (a bot's turn, an end of
// turn, the resolve), it never edits a doc by hand.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { soleGuest } from '../src/sim/alerts';
import { botTurn, TEAMS } from '../src/sim/bots';
import { apply, createIsland, ENGINE_VERSION } from '../src/sim/engine';
import { hashSeed, rng } from '../src/sim/rng';
import { ROLES, type Action, type IslandState, type Role } from '../src/sim/types';

if ((ENGINE_VERSION as number) !== 3) throw new Error(`Run this on the live v3 engine (bd1e1d2), not engine ${ENGINE_VERSION}.`);

const out = process.argv[2] ?? 'tests/fixtures';
const step = (s: IslandState, a: Action, now: number) => {
  const r = apply(s, a, now);
  return r.error ? s : r.s;
};

type At = 'open' | 'mid';
type Want = { file: string; what: string; at: At[]; test(s: IslandState): boolean; optional?: boolean };
const live = (o: { status: string }) => o.status !== 'done' && o.status !== 'cancelled';
const openAlerts = (s: IslandState) => (s.alerts ?? []).filter((a) => a.status !== 'closed');
const WANT: Want[] = [
  {
    file: 'v3-bd1e1d2-early',
    what: 'tier 1, start of week 4: alerts open, the starter crew on the payroll',
    at: ['open'],
    test: (s) => s.week === 4 && s.tier === 1 && openAlerts(s).length > 0 && (s.staff?.length ?? 0) > 0,
  },
  {
    file: 'v3-bd1e1d2-late',
    what: 'tier 4 or 5, week 20 or later: a bigger staff, a stocked shelf, purchase orders on the books, 20+ weeks of ledger',
    at: ['open'],
    test: (s) =>
      s.tier >= 4 &&
      s.week >= 20 &&
      (s.staff?.length ?? 0) >= 5 &&
      Object.keys(s.inv ?? {}).length >= 20 &&
      (s.pos?.length ?? 0) > 0 &&
      (s.ledger?.length ?? 0) >= 15,
  },
  {
    file: 'v3-bd1e1d2-midweek',
    what: "mid-week: a tech has ended the turn, the analyst hasn't started, an open requisition and a tech's card waiting on approval",
    at: ['mid'],
    test: (s) =>
      (!!s.turns.mech?.ended || !!s.turns.elec?.ended) &&
      !s.turns.fin?.ended &&
      (s.turns.fin?.done ?? 0) === 0 &&
      (s.reqs ?? []).some((q) => q.status === 'open') &&
      s.orders.some((o) => o.status === 'pending' && o.role !== 'fin' && !!o.flow),
  },
  {
    file: 'v3-bd1e1d2-mel',
    what: "the only guest plane on an MEL placard that runs out at this week's resolve, or already has",
    at: ['open', 'mid'],
    test: (s) => openAlerts(s).some((a) => !!a.mel && soleGuest(s, a.assetId) && a.mel.until <= s.week),
  },
  {
    file: 'v3-bd1e1d2-chain',
    what: 'an open part chain (IPC lookup, research, the buy, transit or the install)',
    at: ['mid'],
    test: (s) => !!s.chain && s.chain.step !== 'done' && s.orders.some((o) => o.id === s.chain!.orderId && live(o)),
  },
  {
    file: 'v3-bd1e1d2-makesafe',
    what: "an electrician's make-safe on an open hazard (the house rents at 75% until the fix), week 5 or later",
    at: ['open', 'mid'],
    test: (s) => s.week >= 5 && openAlerts(s).some((a) => !!a.safe && a.role === 'elec'),
  },
  {
    file: 'v3-bd1e1d2-build',
    what: "the builders part way through an open build (the island's next tier or a cottage), week 6 or later",
    at: ['open'],
    test: (s) => s.week >= 6 && (s.builds ?? []).some((b) => b.finished === undefined && b.done > 0 && b.done < b.need) && (s.staff ?? []).some((n) => n.role === 'builder'),
  },
  {
    file: 'v3-bd1e1d2-feeder',
    what: "an open electrician's feeder job (the job the feeder scene now plays)",
    at: ['open', 'mid'],
    test: (s) => s.orders.some((o) => o.role === 'elec' && o.job === 'feeder' && live(o)),
    optional: true,
  },
];

const found = new Map<string, { team: string; seed: number; week: number; point: string }>();
const save = (w: Want, s: IslandState, team: string, seed: number, point: string) => {
  if (found.has(w.file)) return;
  found.set(w.file, { team, seed, week: s.week, point });
  if (s.engine !== 3) throw new Error(`${w.file}: engine ${s.engine}`);
  writeFileSync(resolve(out, `${w.file}.json`), JSON.stringify(s));
  console.log(`${w.file}: ${team}, seed ${seed}, week ${s.week}, tier ${s.tier}, ${point} (${w.what})`);
};
const check = (s: IslandState, at: At, team: string, seed: number, point: string) => {
  for (const w of WANT) if (w.at.includes(at) && !found.has(w.file) && w.test(s)) save(w, s, team, seed, point);
};

const CREWS = ['three friends', 'mistakes'] as const;
for (let seed = 1; seed <= 200 && found.size < WANT.length; seed++) {
  for (const name of CREWS) {
    const team = TEAMS[name];
    let now = Date.UTC(2026, 8, 1, 12);
    let s = createIsland({ id: `fx3-${seed}`, name: 'Fixture Island', now, tz: 'Europe/Paris', seed: hashSeed('sim', seed), creator: { uid: 'u-mech', name: 'Seb', role: 'mech' } });
    s = step(s, { t: 'join', uid: 'u-elec', name: 'Ana', role: 'elec' }, now);
    s = step(s, { t: 'join', uid: 'u-fin', name: 'Cy', role: 'fin' }, now);
    for (const role of ROLES) s = step(s, { t: 'week0Done', role }, now);
    const away = rng(hashSeed('bots-away', seed, name));
    const awayLast: Record<Role, boolean> = { mech: false, elec: false, fin: false };
    for (let w = 0; w < 26; w++) {
      const week = s.week;
      check(s, 'open', name, seed, 'start of the week');
      const order = away.shuffle([...ROLES]);
      for (const role of order) {
        const bot = team[role];
        const missed = bot.absent || (bot.miss ? away.chance(bot.streak && awayLast[role] ? 0.5 : bot.miss) : false);
        awayLast[role] = !!missed;
        if (missed) continue;
        s = botTurn(s, role, bot, rng(hashSeed('bots', seed, name, role, week)), now);
        if (s.week === week) check(s, 'mid', name, seed, `after ${role}'s turn (not ended)`);
        s = step(s, { t: 'endTurn', role, week }, now);
        if (s.week === week) check(s, 'mid', name, seed, `after ${role} ended the turn`);
        now += 60_000;
      }
      if (s.week === week) {
        now = (s.deadline ?? now) + 1000;
        s = step(s, { t: 'resolve', week }, now);
      } else now += 86400_000;
    }
  }
}

let missing = 0;
for (const w of WANT)
  if (!found.has(w.file)) {
    console.log(`${w.optional ? 'not found (optional)' : 'MISSING'} ${w.file}: ${w.what}`);
    if (!w.optional) missing++;
  }
process.exit(missing ? 1 : 0);
