// Reverse skew, for real (the version gate's other half; docs/DECISIONS.md "fix round 1"): the LIVE engine must
// refuse every move on a doc this build wrote, and leave it untouched. tests/skew.test.ts only fakes an engine one
// version ahead on this build; this runs the old build's own reducer.
//
//   1. a worktree of the live commit outside the repo (never touch the repo's own worktrees):
//        git -C <repo> worktree add --detach <scratch>/live <live sha>
//        ln -s <repo>/island-company/node_modules <scratch>/live/island-company/node_modules
//   2. from this build's island-company/:
//        npx tsx scripts/reverse-skew.ts <scratch>/live/island-company [fixtures dir]
//   3. git -C <repo> worktree remove --force <scratch>/live
//
// It takes every v*-*.json doc in the fixtures dir (docs older live builds wrote) and makes two docs this build wrote
// from each, stamped with this build's ENGINE_VERSION as the first write from a new client stamps it:
//   - `read`: the doc through migrate() and one harmless move (a seat's own name)
//   - `played` (stage 2 on: the v5 gate, 2026-09-30): the doc played on for two resolves by this build's own bots, which
//     use what only this build has (the quick checks, Report a problem, the renovations; G0's warranty and upgrade)
// Then it asks the live engine for every move an open old tab could send on each: every seat's end of turn, the
// resolve, a rename, each pending approval, each open requisition's approval, each ready job's hand-in and each open
// alert's no-fault-found. Every one must come back refused, with the doc exactly as it was. And it runs the live
// build's screen selectors on each doc (read only: an old tab shows a newer doc until useIsland's ic:stale reloads it),
// which must not throw. Exit 1 otherwise.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { botTurn, TEAMS } from '../src/sim/bots';
import { apply, ENGINE_VERSION } from '../src/sim/engine';
import { migrate } from '../src/sim/migrate';
import { hashSeed, rng } from '../src/sim/rng';
import { ROLES, type Action, type IslandState, type Role } from '../src/sim/types';

const liveDir = process.argv[2];
const fixtures = process.argv[3] ?? resolve(import.meta.dirname, '..', 'tests', 'fixtures');
if (!liveDir) throw new Error('usage: npx tsx scripts/reverse-skew.ts <live island-company dir> [fixtures dir]');
const from = (p: string) => pathToFileURL(resolve(liveDir, 'src', p)).href;
const live = (await import(from('sim/engine.ts'))) as { apply: typeof apply; ENGINE_VERSION: number };
if (live.ENGINE_VERSION >= ENGINE_VERSION) throw new Error(`The live engine is ${live.ENGINE_VERSION}: not older than this build's ${ENGINE_VERSION}.`);
// the live build's screens (Home, the tech panels): what an old tab runs on a doc before it reloads
type Sel = Record<string, (...a: unknown[]) => unknown>;
const sel = (await import(from('ui/select.ts'))) as Sel;

/** a doc this build wrote: the fixture through migrate() and one harmless move (a seat's own name), stamped by this engine */
function read(doc: IslandState): IslandState {
  const s = migrate(doc);
  const role = ROLES.find((r) => s.players[r]);
  const r = apply(s, { t: 'rename', role: role!, name: s.players[role!]!.name }, s.updatedAt + 1);
  if (r.error) throw new Error(`this build refused the rename: ${r.error}`);
  if (r.s.engine !== ENGINE_VERSION) throw new Error(`this build wrote engine ${r.s.engine}`);
  return r.s;
}

/** the same doc played on by this build's bots for two resolves (checks, flags and renovations on), then a new week open */
function played(doc: IslandState, salt: string): IslandState {
  let s = read(doc);
  const team = TEAMS['three friends'];
  for (let w = 0; w < 2; w++) {
    const W = s.week;
    const now = (s.deadline ?? s.updatedAt) - 3600_000;
    for (const role of ROLES) {
      if (s.turns[role]?.ended || !s.players[role]) continue;
      s = botTurn(s, role, team[role], rng(hashSeed('reverse-skew', salt, role, W)), now);
      s = apply(s, { t: 'endTurn', role, week: W }, now).s;
    }
    if (s.week === W) s = apply(s, { t: 'resolve', week: W }, (s.deadline ?? now) + 1000).s;
    if (s.week !== W + 1) throw new Error(`${salt}: week ${W} did not resolve on this build`);
  }
  if (s.engine !== ENGINE_VERSION) throw new Error(`this build wrote engine ${s.engine}`);
  return s;
}

/** the moves an open old tab could send */
function moves(s: IslandState): Action[] {
  const out: Action[] = [];
  for (const role of ROLES) if (s.players[role]) out.push({ t: 'endTurn', role, week: s.week });
  out.push({ t: 'resolve', week: s.week });
  const role = ROLES.find((r) => s.players[r])!;
  out.push({ t: 'rename', role, name: 'Old tab' });
  for (const o of s.orders) if (o.status === 'pending') out.push({ t: 'approve', orderId: o.id } as Action);
  const reqs = (s.reqs ?? []).filter((q) => q.status === 'open').map((q) => q.id);
  if (reqs.length) out.push({ t: 'approveReq', reqs, week: s.week } as Action);
  for (const o of s.orders) if (o.status === 'ready') out.push({ t: 'complete', role: o.role, orderId: o.id, score: 0.9, perfect: false, week: s.week } as Action);
  for (const a of s.alerts ?? []) if (a.status !== 'closed') out.push({ t: 'nff', role: a.role, alert: a.id, week: s.week });
  return out;
}

/** the live build's selectors on a doc (read only); the error, if one throws */
function screens(s: IslandState): string | null {
  try {
    const x = JSON.parse(JSON.stringify(s)) as IslandState;
    sel.blocks(x);
    sel.crossMoves(x);
    sel.flowMoves(x);
    sel.teamNumbers(x);
    for (const role of ROLES) {
      sel.dockNext(x, role);
      sel.endTurnChecks(x, role);
      if (role !== 'fin') sel.yourMoves(x, role);
      for (const o of sel.openOrders(x, role) as IslandState['orders']) if (o.status === 'ready') sel.launchFor(x, o, role as Role);
    }
    return null;
  } catch (e) {
    return (e as Error).stack?.split('\n').slice(0, 3).join(' | ') ?? String(e);
  }
}

let refused = 0;
let bad = 0;
let threw = 0;
let docs = 0;
let viewed = 0;
const stage2 = { checked: 0, flagged: 0, reno: 0, warranty: 0 };
const files = readdirSync(fixtures).filter((f) => /^v\d+-.+\.json$/.test(f));
for (const f of files) {
  const src = JSON.parse(readFileSync(resolve(fixtures, f), 'utf8')) as IslandState;
  for (const [kind, doc] of [
    ['read', read(structuredClone(src))],
    ['played', played(structuredClone(src), f)],
  ] as const) {
    docs++;
    if (kind === 'played') {
      if (doc.checked) stage2.checked++;
      if (doc.flagged) stage2.flagged++;
      if ((doc.builds ?? []).some((b) => b.reno)) stage2.reno++;
      if (doc.assets.some((a) => a.warrantyUntil !== undefined)) stage2.warranty++;
    }
    const before = JSON.stringify(doc);
    // the resolve at the deadline, the rest mid-week
    for (const m of moves(doc)) {
      const at = m.t === 'resolve' ? (doc.deadline ?? doc.updatedAt) + 1000 : doc.updatedAt + 60_000;
      const r = live.apply(JSON.parse(before) as IslandState, m as never, at);
      if (!r.error || JSON.stringify(r.s) !== before || !/saved by a newer version of Island Company\. Reload/.test(r.error)) {
        bad++;
        console.log(`NOT REFUSED ${f} (${kind}): ${m.t}${r.error ? ` (${JSON.stringify(r.s) !== before ? 'changed the doc' : r.error})` : ''}`);
      } else refused++;
    }
    const err = screens(doc);
    if (err) {
      threw++;
      console.log(`THE LIVE SCREENS THREW ${f} (${kind}): ${err}`);
    } else viewed++;
  }
}
console.log(`docs this build played on with stage 2: ${stage2.checked} with a quick check this week, ${stage2.flagged} with a flag, ${stage2.reno} with a renovation, ${stage2.warranty} with a warranty`);
console.log(`live engine ${live.ENGINE_VERSION} on ${docs} docs written by engine ${ENGINE_VERSION} (${files.length} fixtures, read and played): ${refused} of ${refused + bad} moves refused, docs untouched; the live screens read ${viewed} of ${docs} without throwing`);
process.exit(bad || threw ? 1 : 0);
