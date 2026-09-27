export const meta = {
  name: 'realistic-consequences',
  description: 'Blind sign-off, hidden defects that become incidents, repair-then-redo chains, and cross-trade reports; engine + UI, reviewed and balanced',
  phases: [
    { title: 'Engine', detail: 'defects, detection by inspection, incidents, repair chains, cross-trade reports, effects; tests + paper sim' },
    { title: 'UI', detail: 'blind sign-off in the puzzle host, result card, order chips, capacity notices, review lines' },
    { title: 'Review', detail: 'realism (trades), systems/balance, UX playtest' },
    { title: 'Fix', detail: 'one fix round for blockers/majors' },
  ],
}

const SP = '/tmp/claude-0/-home-user-first-day/fbc0a559-d1ad-537c-84ea-3d4f56ea63a5/scratchpad'
const MAIN = '/home/user/first_day/island-company'
const BASE = '79f806b'
const OUT = `${SP}/consequences`

const OWNER = `THE OWNER'S WORDS (three real friends play: an A&P mechanic, a residential electrician, an FP&A analyst):
- "for the mechanic have this: I have a chance to fix it via a reasonable repair and then I have to complete the original task"
- "add cross dependency reports from random things so like mechanic says: this light doesn't work in my shop, and electrician has to go fix it. but using all 3 jobs"
- "and if we fuck something up we don't see the immediate sign that you're incorrect such that it's realistic, so there's an incident if we fuck up"`

const SPEC = `SPEC (decided; implement it faithfully, adjust numbers only for balance):

A. BLIND SIGN-OFF (realistic feedback)
- A launched puzzle is "blind" when it is a real work order (not week 0, not practice/weekly challenge, not lend-a-hand) and its puzzle tier >= 2. Tiers 0-1 keep teaching feedback.
- In blind mode the puzzle host (src/ui/puzzlehost.tsx) swallows "wrong" feedback: host.fx.bad/fault play a neutral tap with no shake or "Not quite" caption, and the perfect flourish becomes a neutral "done" sound. The result card shows "Signed off" and a neutral line such as "How good it was shows up later: in the asset's health, an inspection, or an incident." No score, no verdict, no evaluative summary.
- Order cards and the order detail show "Signed off" (no %) for blind jobs. The engine still records the true score (result.score) and uses it.
- Remove the immediate rework rule (under 40% reopens the job) for blind jobs; hidden defects replace it. Keep lend-a-hand as it is (an explicit expert try with its botch rule).

B. HIDDEN DEFECTS -> INCIDENTS (mechanic and electrician jobs on an asset; not crew-project parts)
- On completion, roll (seeded from the order seed, deterministic) for a latent defect from the true score q: q >= 0.85 -> 0; 0.6 <= q < 0.85 -> (0.85 - q) * 0.4; q < 0.6 -> 0.1 + (0.6 - q) * 1.8, capped at 1. Severity 2 if q < 0.4, else 1.
- Store it hidden: s.defects: { id, orderKind, puzzle, title, assetId, by: Role, name, week, dueWeek (week + 1..3, seeded; severity 2 comes due sooner), severity }. Never shown in the UI until it surfaces.
- Detection (the "chance to fix it"): completing an inspection-type job on the same asset with q >= 0.6 (inspect100 on planes, codeprep on houses; add others that make sense, e.g. a crack hunt on that asset) finds its latent defects: no incident; the feed/review says "Seb's 100-hr inspection found <problem> left from week N"; the repair chain is created.
- Surfacing: at resolveWeek, a defect whose dueWeek <= W becomes an incident unless the asset is tagged out of service (grounded/red-tagged: it waits a week). Incident: kind 'defect', cost = the original job's cost x (1.5 severity 1, 3 severity 2), asset health -12 / -25, counted like other incidents (insurance applies, safety grade), with a review line that traces it: "<what happened> on <asset>: traced to the <job> <name> signed off in week N." Then the repair chain is created.

C. REPAIR, THEN THE ORIGINAL TASK
- A surfaced or detected defect creates a REPAIR order for the same role and asset: a reasonable corrective job using a DIFFERENT puzzle from the original, a realistic title, cost ~0.8 x the original's (pending: the analyst approves it; deferral risk applies because the defect is still there), a small health gain. Mapping by the original puzzle, for example: torque -> teardown "Replace the stretched fasteners"; crack -> teardown "Remove the cracked part and fit a serviceable one"; safetywire -> torque "Re-torque the loosened hardware"; teardown -> teardown "Rework the installation"; balance -> crack "Hard-landing inspection of the gear"; trace -> meter "Find the arcing connection"; panel -> wireup "Replace the heat-damaged breaker lugs"; wireup -> meter "Locate the loose terminal"; meter -> trace "Trace the real fault"; conduit -> wireup "Pull new conductors through the damaged run". Put the mapping in data.ts and make it easy to extend (new puzzles 'hydraulics' and 'gpu' will be added later by another branch: guard for unknown puzzles with a sensible default).
- When the repair is completed, spawn the REDO of the original job on that asset: status ready, cost 0 (already paid), title "<original title> (redo)". A botched repair or redo can leave a defect again (the chain continues).

D. CROSS-TRADE REPORTS (random, all three trades both report and fix)
- From week 3, at openWeek, with probability ~0.4 (seeded): create one report if there are fewer than 2 open reports and none open for that fixer. Pick from a table in data.ts of realistic reports, reporter -> fixer, title, puzzle, effect. Include at least:
  mech -> elec "Hangar work lights are dead" (trace) cap; mech -> elec "Hangar compressor keeps tripping its breaker" (meter) cap; mech -> fin "Parts vendor billed the brake kit twice" (invoice) leak;
  elec -> mech "Generator housing fan bearing is screaming" (teardown) cap; elec -> mech "Trencher drive belt snapped" (teardown) cap; elec -> fin "Utility bill doesn't match the meter readings" (reconcile) leak;
  fin -> elec "Office circuit trips when the printer and kettle run" (meter) cap; fin -> mech "Company van brakes feel soft" (torque; will move to the hydraulics puzzle later) leak.
  (Later a separate branch adds hydraulics/gpu-based reports such as "Bucket truck boom is leaking hydraulic fluid" and a GPU cart; keep the table data-driven.)
- A report is an order for the fixer: kind 'report', assetId null, small cost (0-150, ready, no approval), plus report metadata { by: Role, effect: 'cap' | 'leak', amount }. Feed: "Seb reports: the hangar work lights are dead. Mia, it's yours."
- Effects while open: 'cap' limits the REPORTER to 2 jobs per turn (1 desk task for the analyst) with a clear notice on their screen ("Hangar lights out: 2 jobs max until Mia fixes them"); 'leak' costs cash every resolved week (a line in the review).
- A blind botched report fix makes the problem come back 1-2 weeks later (the report reopens).
- Bots (src/sim/bots.ts) must handle reports, repairs and redos sensibly so the paper sim stays meaningful.

E. BALANCE: run cd island-company && npx tsx scripts/balance.ts before and after. Targets: "three friends" and "all average" still reach tier 5 by about week 22-24 with ZERO negative-cash weeks; solo/absent teams stay at tier 1; defect incidents should be noticeable but not dominant (report the average defect incidents per week for three friends). Tune the numbers (probabilities, costs, report rate) to hit the targets and document them in docs/DECISIONS.md.`

const FILES = `CODE MAP (read before changing): src/sim/types.ts (Order, IslandState, Action, WeekReport, Incident), src/sim/engine.ts (complete(), openWeek/generateOpsOrders/generateFinTasks, resolveWeek incidents and lines, finishProjectIfDone), src/sim/econ.ts (credit, workCredit, isRework, urgency), src/sim/data.ts (CATALOG, FIN_TASKS), src/sim/bots.ts (paper-sim bots), src/ui/puzzlehost.tsx (fx wrapper, result card, PuzzleLaunch), src/ui/select.ts (launchFor), src/ui/orders.tsx (OrderCard/OrderDetail/statusChip), src/ui/ops.tsx (OpsPanel), src/ui/desk.tsx (analyst), src/ui/board.tsx (Review lines), src/ui/home.tsx. Tests live in tests/*.test.ts (engine.test.ts has the paper-sim exit tests).`

const SETUP = (branch) => `SETUP: you are in a fresh git worktree (it starts on the repo's default branch, which does not contain the game). From the worktree root run: git checkout -B ${branch} ${BASE} && mkdir -p ${OUT} && ln -s ${MAIN}/node_modules island-company/node_modules. Commit on ${branch} when done; do not push. Must pass: cd island-company && npx tsc --noEmit && npx vitest run.`

const ENGINE_SCHEMA = {
  type: 'object',
  properties: {
    worktreePath: { type: 'string' }, branch: { type: 'string' }, commit: { type: 'string' },
    summary: { type: 'string' }, balanceBefore: { type: 'string' }, balanceAfter: { type: 'string' },
    defectIncidentsPerWeekThreeFriends: { type: 'number' }, testsAdded: { type: 'number' }, tscOk: { type: 'boolean' }, testsOk: { type: 'boolean' },
    uiHooks: { type: 'string', description: 'exactly what the UI needs: fields, helpers, how to tell a blind launch, repair/redo/report metadata, cap notices' },
  },
  required: ['worktreePath', 'branch', 'commit', 'summary', 'balanceBefore', 'balanceAfter', 'defectIncidentsPerWeekThreeFriends', 'testsAdded', 'tscOk', 'testsOk', 'uiHooks'],
}

phase('Engine')
const eng = await agent(`You are the game-systems engineer for "Island Company", a deterministic pure-reducer co-op game (Preact + TypeScript). ${OWNER}

${SPEC}

${FILES}

${SETUP('consequences')}

YOUR PART: the ENGINE (types, data, engine, econ, bots) and its tests: A (the data needed to know a launch is blind, and the rework rule change), B, C, D and E. Keep every existing test passing unless a rule intentionally changed (then update it and say why). Add focused tests: defect probability curve and determinism, detection by inspection, surfacing as an incident (and waiting while tagged), repair -> redo chain, report creation/effects (cap blocks the reporter's extra jobs, leak costs cash), report reopen on a botch, and the paper-sim exit tests still passing. Keep state JSON small (the whole island is one Firestore document < 900 KB): prune resolved defects. Return exactly what the UI will need in uiHooks.`, { label: 'engine', phase: 'Engine', schema: ENGINE_SCHEMA, isolation: 'worktree' })
if (!eng) return { error: 'engine builder failed' }

phase('UI')
const UI_SCHEMA = {
  type: 'object',
  properties: { commit: { type: 'string' }, shotsDir: { type: 'string' }, summary: { type: 'string' }, e2eOk: { type: 'boolean' }, tscOk: { type: 'boolean' }, testsOk: { type: 'boolean' } },
  required: ['commit', 'shotsDir', 'summary', 'e2eOk', 'tscOk', 'testsOk'],
}
const ui = await agent(`You are the UI engineer for "Island Company" (Preact + TypeScript PWA, phone-first). ${OWNER}

${SPEC}

${FILES}

The engine part is done in the worktree ${eng.worktreePath} on branch ${eng.branch} (commit ${eng.commit}). Work directly in that worktree (cd ${eng.worktreePath}); do not create a new worktree or branch. Engine summary: ${eng.summary}
UI hooks the engine provides: ${eng.uiHooks}

YOUR PART: the UI for A-D:
- Blind sign-off in the puzzle host (neutral feedback, "Signed off" result card) for blind launches; launchFor marks them.
- Order cards/detail: "Signed off" instead of a %, chips for Repair ("Repair · from week N"), Redo, and Report ("Reported by Seb"); the order detail explains a repair ("<what happened> on <asset>, traced to <job> signed off in week N. Repair first, then redo the original.").
- Capacity notices for 'cap' reports on the reporter's screen (ops panel for mechanic/electrician, desk for analyst), and leak lines on the analyst's desk.
- Review (board.tsx) lines for defect incidents and inspection finds, clearly traced.
- Keep everything thumb-friendly at 390 px and consistent with the existing style.
VERIFY: start a dev server (cd island-company && VITE_CACHE_DIR=${OUT}/vite-cache nohup npx vite --port 5195 --strictPort > ${OUT}/vite.log 2>&1 &), seed islands in localStorage with engine states that show a blind job, a repair, a redo, a report with a cap and a leak, and a defect incident in the review (build them with the engine via npx tsx), and screenshot them with Playwright (import from '${MAIN}/node_modules/playwright-core/index.mjs', executablePath '/opt/pw-browsers/chromium', 390x844 phone, deviceScaleFactor 2) into ${OUT}/shots; LOOK at them with the Read tool and fix what looks wrong. Run the pass-and-play e2e: BASE=http://localhost:5195 node scripts/e2e.mjs ${OUT}/e2e (must end "no console errors"). Stop your server. Commit on ${eng.branch} ("Consequences: UI") and return.`, { label: 'ui', phase: 'UI', schema: UI_SCHEMA })
if (!ui) return { error: 'ui builder failed', engine: eng }

phase('Review')
const REVIEW_SCHEMA = {
  type: 'object',
  properties: { pass: { type: 'boolean' }, issues: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, problem: { type: 'string' }, fix: { type: 'string' } }, required: ['severity', 'problem', 'fix'] } }, notes: { type: 'string' } },
  required: ['pass', 'issues', 'notes'],
}
const where = `Everything is in worktree ${eng.worktreePath} on branch ${eng.branch} (base ${BASE}): see \`git -C ${eng.worktreePath} diff ${BASE}\`. Screenshots: ${ui.shotsDir}. Engine summary: ${eng.summary}. UI summary: ${ui.summary}. Balance before: ${eng.balanceBefore}. Balance after: ${eng.balanceAfter}.`
const [realism, systems, ux] = await parallel([
  () => agent(`You review realism for three real tradespeople who will play this: a senior A&P mechanic, a licensed residential electrician and an FP&A analyst. ${OWNER}

${SPEC}

${where}

Judge: are the hidden-defect consequences, incident descriptions, repair mappings ("a reasonable repair, then the original task") and cross-trade reports things that really happen, described the way a pro would say them, with sensible fixes by the right trade? Would any of the three roll their eyes? List concrete corrections (titles, mappings, reports to add or drop). pass = no blocker/major.`, { label: 'review:realism', phase: 'Review', schema: REVIEW_SCHEMA }),
  () => agent(`You are a game-systems and balance reviewer. ${OWNER}

${SPEC}

${where}

Run the tests and the paper sim yourself (cd ${eng.worktreePath}/island-company && npx vitest run && npx tsx scripts/balance.ts). Check: determinism (seeded rolls, no Date/Math.random in the engine), the defect curve, detection before surfacing, tagging defers surfacing, the repair -> redo chain can't soft-lock (e.g. the repair never approved, the asset leaving, a redo on a crew project, repeated botches), report effects and reopen logic, state size (defects pruned), bots handling the new orders, and the balance targets (three friends / all average reach tier 5 ~22-24 with zero negative-cash weeks; solo teams stay at tier 1). pass = no blocker/major.`, { label: 'review:systems', phase: 'Review', schema: REVIEW_SCHEMA }),
  () => agent(`You are a mobile UX reviewer and front-end engineer. ${OWNER}

${SPEC}

${where}

Start the app from that worktree (cd ${eng.worktreePath}/island-company && VITE_CACHE_DIR=${OUT}/vite-cache-ux nohup npx vite --port 5196 --strictPort > ${OUT}/ux.log 2>&1 &), and with Playwright (import from '${MAIN}/node_modules/playwright-core/index.mjs', executablePath '/opt/pw-browsers/chromium', 390x844 phone) play a pass-and-play island through several weeks, including a deliberately sloppy job at tier >= 2. Check that the puzzle gives no "you're wrong" tell in blind mode, the result card says Signed off, later the incident and the repair -> redo appear and read clearly, reports and cap notices make sense, nothing overlaps at 390 px, and there are no console errors. Also read the diff for UI bugs. Stop your server. pass = no blocker/major.`, { label: 'review:ux', phase: 'Review', schema: REVIEW_SCHEMA }),
])

const issues = [realism, systems, ux].filter(Boolean).flatMap((r) => r.issues)
const passAll = [realism, systems, ux].every((r) => r && r.pass)
let fix = null
if (!passAll || issues.some((i) => i.severity !== 'minor')) {
  phase('Fix')
  fix = await agent(`You are finishing the "realistic consequences" feature in the existing worktree ${eng.worktreePath} (branch ${eng.branch}). Work there directly; do not create a new worktree or branch. ${OWNER}

${SPEC}

${FILES}

Reviewers (realism for the three trades, systems/balance, mobile UX) raised:
${JSON.stringify(issues, null, 1)}

Fix every blocker and major, and the minors that are cheap. Re-run tests, the paper sim (report the table), and the pass-and-play e2e (dev server: cd island-company && VITE_CACHE_DIR=${OUT}/vite-cache nohup npx vite --port 5195 --strictPort > ${OUT}/vite.log 2>&1 &; BASE=http://localhost:5195 node scripts/e2e.mjs ${OUT}/e2e-fix; stop the server). Update docs/DECISIONS.md and docs/ONBOARDING.md for the new rules (blind sign-off, defects/incidents, repair -> redo, cross-trade reports). Commit ("Consequences: review fixes") and return.`, { label: 'fix', phase: 'Fix', schema: { type: 'object', properties: { commit: { type: 'string' }, fixed: { type: 'array', items: { type: 'string' } }, notFixed: { type: 'array', items: { type: 'string' } }, balance: { type: 'string' }, e2eOk: { type: 'boolean' }, testsOk: { type: 'boolean' } }, required: ['commit', 'fixed', 'notFixed', 'balance', 'e2eOk', 'testsOk'] } })
}

return {
  worktree: eng.worktreePath, branch: eng.branch,
  commit: fix ? fix.commit : ui.commit,
  engine: { summary: eng.summary, balanceBefore: eng.balanceBefore, balanceAfter: eng.balanceAfter, defectsPerWeek: eng.defectIncidentsPerWeekThreeFriends },
  ui: { summary: ui.summary, shots: ui.shotsDir },
  reviews: { realism, systems, ux },
  fix,
}
