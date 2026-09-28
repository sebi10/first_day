// Writes the v2 island docs that tests/migrate.test.ts migrates. Run it in a
// worktree of the base engine (6c0c426), never in this one:
//
//   git worktree add <scratch>/base-6c0c426 6c0c426
//   ln -s <repo>/island-company/node_modules <scratch>/base-6c0c426/island-company/node_modules
//   cp scripts/fixtures-v2.ts <scratch>/base-6c0c426/island-company/scripts/
//   (cd <scratch>/base-6c0c426/island-company && npx tsx scripts/fixtures-v2.ts <out dir>)
//
// It plays the base engine's own bots (TEAMS['three friends']) week by week,
// the way the paper sim does, and saves the first doc that matches each state
// below. Every doc is written by the base engine's reducer: the script only
// dispatches moves (a bot's turn, a counter-offer, one electrician job), it
// never edits a doc by hand.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { botTurn, TEAMS } from '../src/sim/bots';
import { apply, createIsland } from '../src/sim/engine';
import { hashSeed, rng } from '../src/sim/rng';
import { ROLES, type Action, type IslandState, type Role } from '../src/sim/types';

const out = process.argv[2] ?? 'tests/fixtures';
const team = TEAMS['three friends'];
const step = (s: IslandState, a: Action, now: number) => {
  const r = apply(s, a, now);
  return r.error ? s : r.s;
};

type Want = { file: string; what: string; at: 'open' | 'mid'; test(s: IslandState): boolean };
const kitsWaiting = (s: IslandState) => s.orders.filter((o) => o.status === 'waiting_part' && o.parts > 0 && !o.chain).length;
const WANT: Want[] = [
  { file: 'v2-6c0c426-early', what: 'tier 1, start of week 4, 3 kits in stock', at: 'open', test: (s) => s.week === 4 && s.tier === 1 && s.parts?.stock === 3 },
  { file: 'v2-6c0c426-kits', what: 'mid-week, kits in transit, 2 or more orders waiting on kits', at: 'mid', test: (s) => (s.parts?.inTransit ?? 0) > 0 && kitsWaiting(s) >= 2 },
  { file: 'v2-6c0c426-countered', what: 'a countered order that carries a kit', at: 'mid', test: (s) => s.orders.some((o) => o.status === 'countered' && o.parts > 0) },
  { file: 'v2-6c0c426-repair', what: 'a pending repair with parts', at: 'mid', test: (s) => s.orders.some((o) => o.kind === 'repair' && o.status === 'pending' && o.parts > 0) },
  { file: 'v2-6c0c426-chain-transit', what: 'an open chain with its part in transit (the plane AOG)', at: 'mid', test: (s) => s.chain?.step === 'transit' },
  { file: 'v2-6c0c426-chain-review', what: "an open chain waiting on engineering's answer", at: 'mid', test: (s) => s.chain?.step === 'review' },
  {
    file: 'v2-6c0c426-midweek',
    what: 'tier 3: the mechanic ended the turn, the electrician part way, the analyst not started, cards pending',
    at: 'mid',
    test: (s) =>
      s.tier === 3 &&
      !!s.turns.mech?.ended &&
      !s.turns.elec?.ended &&
      (s.turns.elec?.done ?? 0) > 0 &&
      !s.turns.fin?.ended &&
      (s.turns.fin?.done ?? 0) === 0 &&
      s.orders.some((o) => o.status === 'pending' && o.role !== 'fin'),
  },
  { file: 'v2-6c0c426-late', what: 'tier 4 or 5, week 20 or later, storm season', at: 'open', test: (s) => s.tier >= 4 && s.week >= 20 && s.weather === 'storm' },
];

const found = new Map<string, { seed: number; week: number; point: string }>();
const save = (w: Want, s: IslandState, seed: number, point: string) => {
  if (found.has(w.file)) return;
  found.set(w.file, { seed, week: s.week, point });
  writeFileSync(resolve(out, `${w.file}.json`), JSON.stringify(s, null, 1));
  console.log(`${w.file}: seed ${seed}, week ${s.week}, ${point} (${w.what})`);
};
const check = (s: IslandState, at: 'open' | 'mid', seed: number, point: string) => {
  for (const w of WANT) if (w.at === at && !found.has(w.file) && w.test(s)) save(w, s, seed, point);
};

for (let seed = 1; seed <= 400 && found.size < WANT.length; seed++) {
  let now = Date.UTC(2026, 8, 1, 12);
  let s = createIsland({ id: `fx-${seed}`, name: 'Fixture Island', now, tz: 'Europe/Paris', seed: hashSeed('sim', seed), creator: { uid: 'u-mech', name: 'Seb', role: 'mech' } });
  s = step(s, { t: 'join', uid: 'u-elec', name: 'Ana', role: 'elec' }, now);
  s = step(s, { t: 'join', uid: 'u-fin', name: 'Cy', role: 'fin' }, now);
  for (const role of ROLES) s = step(s, { t: 'week0Done', role }, now);
  const away = rng(hashSeed('bots-away', seed, ''));
  const awayLast: Record<Role, boolean> = { mech: false, elec: false, fin: false };
  for (let w = 0; w < 26; w++) {
    const week = s.week;
    check(s, 'open', seed, 'start of the week');
    // mid-week at tier 3: the mechanic plays and ends the turn, the electrician does one job, the analyst hasn't started
    if (s.tier === 3 && !found.has('v2-6c0c426-midweek')) {
      let m = botTurn(s, 'mech', team.mech, rng(hashSeed('bots', seed, '', 'mech', week)), now);
      m = step(m, { t: 'endTurn', role: 'mech', week }, now);
      const job = m.orders.find((o) => o.role === 'elec' && o.status === 'ready' && o.kind !== 'project');
      if (job && m.week === week) {
        m = step(m, { t: 'complete', role: 'elec', orderId: job.id, score: 0.8, perfect: false, week }, now + 60_000);
        check(m, 'mid', seed, 'mechanic ended, electrician one job in, analyst not started');
      }
    }
    const order = away.shuffle([...ROLES]);
    for (const role of order) {
      const bot = team[role];
      const missed = bot.absent || (bot.miss ? away.chance(bot.streak && awayLast[role] ? 0.5 : bot.miss) : false);
      awayLast[role] = !!missed;
      if (missed) continue;
      // a counter-offer on a pending card that carries a kit (the base bots never counter; the analyst's move does)
      if (role === 'fin' && !found.has('v2-6c0c426-countered')) {
        const kit = s.orders.find((o) => o.status === 'pending' && o.parts > 0 && !o.chain && !o.pushedBack);
        if (kit) {
          const c = step(s, { t: 'counter', orderId: kit.id, week }, now);
          check(c, 'mid', seed, 'the analyst countered a kit card');
        }
      }
      s = botTurn(s, role, bot, rng(hashSeed('bots', seed, '', role, week)), now);
      check(s, 'mid', seed, `after ${role}'s turn (not ended)`);
      s = step(s, { t: 'endTurn', role, week }, now);
      if (s.week === week) check(s, 'mid', seed, `after ${role} ended the turn`);
    }
    if (s.week === week) {
      now = (s.deadline ?? now) + 1000;
      s = step(s, { t: 'resolve', week }, now);
    } else now += 86400_000;
  }
}

for (const w of WANT) if (!found.has(w.file)) console.log(`MISSING ${w.file}: ${w.what}`);
