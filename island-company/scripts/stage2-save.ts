// A pass-and-play save for trying stage 2 fast (docs/EXPANSION.md 6.4, 6.5): a
// tier-2+ island past week 3, every seat's turn open, where the mechanic's
// walkaround and the electrician's check show a tell this week and every seat can
// flag. Written by this build's own reducer (the paper-sim crew plays the weeks,
// quick checks and flags off, so nothing stage 2 is used yet); only the seats are
// moved to the pass-and-play device ids.
//
//   npx tsx scripts/stage2-save.ts <out dir>     # writes stage2-save.json and stage2-inject.js
//
// Then, on the dev server (http://localhost:<port>/), paste stage2-inject.js in
// the DevTools console (or pass it to Playwright's page.addInitScript before the
// first load): it stores the island in this browser's local store, adds it as a
// pass-and-play island on this device (seat: the mechanic), sets the deadline 3
// days out and opens it. The Pass button switches seats. Until package B's map
// emits object taps, open an inspect sheet from the console:
//   window.dispatchEvent(new CustomEvent('ic:open', { detail: { object: { kind: 'plane', id: 'p1', st: 'home' } } }))
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { botTurn, TEAMS, type Team } from '../src/sim/bots';
import { checkTruth } from '../src/sim/checks';
import { apply, createIsland } from '../src/sim/engine';
import { hashSeed, rng } from '../src/sim/rng';
import { ROLES, type IslandState } from '../src/sim/types';

const out = resolve(process.argv[2] ?? '.');
const PP = { mech: 'pp-mech', elec: 'pp-elec', fin: 'pp-fin' } as const;
const t = TEAMS['three friends'];
const crew: Team = { mech: { ...t.mech, miss: 0, checks: false, flags: false }, elec: { ...t.elec, miss: 0, checks: false, flags: false }, fin: { ...t.fin, miss: 0, checks: false, flags: false } };

function play(seed: number, weeks: number): IslandState {
  let now = Date.UTC(2026, 8, 1, 12);
  const id = `stage2${seed}`;
  let s = createIsland({ id, name: 'Stage 2 Isle', now, tz: 'Europe/Paris', seed: hashSeed('stage2', seed), creator: { uid: PP.mech, name: 'Ana', role: 'mech' } });
  s = apply(s, { t: 'join', uid: PP.elec, name: 'Ben', role: 'elec' }, now).s;
  s = apply(s, { t: 'join', uid: PP.fin, name: 'Seb', role: 'fin' }, now).s;
  for (const r of ROLES) s = apply(s, { t: 'week0Done', role: r }, now).s;
  for (let w = 0; w < weeks; w++) {
    const W = s.week;
    for (const role of ROLES) {
      s = botTurn(s, role, crew[role], rng(hashSeed('stage2', seed, role, W)), now);
      s = apply(s, { t: 'endTurn', role, week: W }, now).s;
      now += 60_000;
    }
    if (s.week === W) s = apply(s, { t: 'resolve', week: W }, (s.deadline ?? now) + 1000).s;
    now = (s.deadline ?? now) - 86400_000;
  }
  return s;
}

let save: IslandState | null = null;
for (let seed = 1; seed < 200 && !save; seed++) {
  for (let weeks = 6; weeks <= 14; weeks++) {
    const s = play(seed, weeks);
    if (s.tier < 2 || s.week < 3) continue;
    const planes = s.assets.filter((a) => a.kind === 'plane' && checkTruth(s, 'mech', a.id, s.week));
    const elec = s.assets.filter((a) => (a.kind === 'house' || a.kind === 'grid') && checkTruth(s, 'elec', a.id, s.week));
    if (planes.length && elec.length) {
      save = s;
      console.log(`seed ${seed}, week ${s.week}, tier ${s.tier}: walkaround tell on ${planes.map((a) => a.name).join(', ')}; electrician's on ${elec.map((a) => a.name).join(', ')}`);
      break;
    }
  }
}
if (!save) throw new Error('no save found');
mkdirSync(out, { recursive: true });
writeFileSync(resolve(out, 'stage2-save.json'), JSON.stringify(save));
writeFileSync(
  resolve(out, 'stage2-inject.js'),
  `(() => {
  const s = ${JSON.stringify(save)};
  // once per browser: a later load (or an init script on every navigation) keeps the island as played
  if (localStorage.getItem('ic.local.' + s.id)) return;
  s.deadline = Date.now() + 3 * 86400e3;
  localStorage.setItem('ic.local.' + s.id, JSON.stringify(s));
  const k = 'ic.session.v1';
  let sess = { islands: [], active: null, playerName: 'Ana' };
  try { sess = { ...sess, ...JSON.parse(localStorage.getItem(k) || '{}') }; } catch {}
  sess.islands = [{ id: s.id, name: s.name, mode: 'local', role: 'mech', passAndPlay: true, lastSeenReview: s.week - 1, lastSeenFeed: s.feed.length ? s.feed[s.feed.length - 1].id : 0 }, ...sess.islands.filter((i) => i.id !== s.id)];
  sess.active = s.id;
  localStorage.setItem(k, JSON.stringify(sess));
  location.hash = '#/i/' + s.id;
  // pasted into a running app: reload so it reads the new session (an init script runs before the app: no reload)
  if (document.readyState === 'complete') location.reload();
})();
`,
);
console.log(`wrote ${resolve(out, 'stage2-save.json')} and stage2-inject.js`);
