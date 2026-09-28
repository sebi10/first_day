// Reverse skew, for real (the version gate's other half; docs/DECISIONS.md "fix round 1"): the LIVE engine must
// refuse every move on a doc this build wrote, and leave it untouched. tests/skew.test.ts only fakes an engine one
// version ahead on this build; this runs the old build's own reducer.
//
//   1. extract the live commit's game without touching the repo's worktrees:
//        mkdir -p <scratch>/live && git archive <live sha> island-company | tar -x -C <scratch>/live
//        ln -s <repo>/island-company/node_modules <scratch>/live/island-company/node_modules
//   2. from this build's island-company/:
//        npx tsx scripts/reverse-skew.ts <scratch>/live/island-company [fixtures dir]
//
// It takes every v*-*.json doc in the fixtures dir (docs older live builds wrote), plays one move on each with THIS
// engine (so the doc is stamped with this build's ENGINE_VERSION, as the first write from a new client stamps it),
// then asks the live engine for every seat's end of turn, the resolve, a rename, each pending approval and each open
// alert's no-fault-found. Every one must come back refused, with the doc exactly as it was. Exit 1 otherwise.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { apply, ENGINE_VERSION } from '../src/sim/engine';
import { migrate } from '../src/sim/migrate';
import { ROLES, type Action, type IslandState } from '../src/sim/types';

const liveDir = process.argv[2];
const fixtures = process.argv[3] ?? resolve(import.meta.dirname, '..', 'tests', 'fixtures');
if (!liveDir) throw new Error('usage: npx tsx scripts/reverse-skew.ts <live island-company dir> [fixtures dir]');
const live = (await import(pathToFileURL(resolve(liveDir, 'src', 'sim', 'engine.ts')).href)) as { apply: typeof apply; ENGINE_VERSION: number };
if (live.ENGINE_VERSION >= ENGINE_VERSION) throw new Error(`The live engine is ${live.ENGINE_VERSION}: not older than this build's ${ENGINE_VERSION}.`);

/** a doc this build wrote: the fixture through migrate() and one harmless move (a seat's own name), stamped by this engine */
function written(doc: IslandState): IslandState {
  const s = migrate(doc);
  const role = ROLES.find((r) => s.players[r]);
  const r = apply(s, { t: 'rename', role: role!, name: s.players[role!]!.name }, s.updatedAt + 1);
  if (r.error) throw new Error(`this build refused the rename: ${r.error}`);
  if (r.s.engine !== ENGINE_VERSION) throw new Error(`this build wrote engine ${r.s.engine}`);
  return r.s;
}

/** the moves an open old tab could send */
function moves(s: IslandState): Action[] {
  const out: Action[] = [];
  for (const role of ROLES) if (s.players[role]) out.push({ t: 'endTurn', role, week: s.week });
  out.push({ t: 'resolve', week: s.week });
  const role = ROLES.find((r) => s.players[r])!;
  out.push({ t: 'rename', role, name: 'Old tab' });
  for (const o of s.orders) if (o.status === 'pending') out.push({ t: 'approve', orderId: o.id } as Action);
  for (const a of s.alerts ?? []) if (a.status !== 'closed') out.push({ t: 'nff', role: a.role, alert: a.id, week: s.week });
  return out;
}

let refused = 0;
let bad = 0;
const files = readdirSync(fixtures).filter((f) => /^v\d+-.+\.json$/.test(f));
for (const f of files) {
  const doc = written(JSON.parse(readFileSync(resolve(fixtures, f), 'utf8')));
  const before = JSON.stringify(doc);
  // the resolve at the deadline, the rest mid-week
  for (const m of moves(doc)) {
    const at = m.t === 'resolve' ? (doc.deadline ?? doc.updatedAt) + 1000 : doc.updatedAt + 60_000;
    const r = live.apply(JSON.parse(before) as IslandState, m as never, at);
    if (!r.error || JSON.stringify(r.s) !== before) {
      bad++;
      console.log(`NOT REFUSED ${f}: ${m.t}${r.error ? ' (changed the doc)' : ''}`);
    } else refused++;
  }
}
console.log(`live engine ${live.ENGINE_VERSION} on ${files.length} docs written by engine ${ENGINE_VERSION}: ${refused} of ${refused + bad} moves refused, docs untouched`);
process.exit(bad ? 1 : 0);
