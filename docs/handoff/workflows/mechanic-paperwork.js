export const meta = {
  name: 'mechanic-paperwork',
  description: 'Aircraft identity (S/N, SBs, STCs, logbook) plus two new A&P puzzles: IPC parts lookup, logbook research + engineering approval',
  phases: [
    { title: 'Aircraft data', detail: 'deterministic per-aircraft identity: registration, model, S/N, SBs, STCs, logbook history, IPC/AMM data' },
    { title: 'Puzzles', detail: 'IPC parts lookup and logbook research + engineering approval, built in parallel on the shared data' },
    { title: 'Review', detail: 'per puzzle: a senior A&P reviewer and a playtest/code reviewer' },
    { title: 'Fix', detail: 'fix blockers/majors' },
  ],
}

const SP = '/tmp/claude-0/-home-user-first-day/fbc0a559-d1ad-537c-84ea-3d4f56ea63a5/scratchpad'
const MAIN = '/home/user/first_day/island-company'
const BASE = '79f806b'
const OUT = `${SP}/paperwork`

const FRIEND = `THE REAL A&P MECHANIC WHO WILL PLAY THIS SAID (verbatim): "Brother, I want it to be real. When I get a task I get a manual. I follow manual. If part is gone or missing or damaged: IPC. If part no exist, I check in previous logged items on airplane, the maintenance logs, and then get engineering approval to put part on airplane." The owner: "include all this for mechanic too".`

const GAME = `PROJECT: "Island Company", a Preact + TypeScript PWA co-op game for three real friends on phones (a real A&P mechanic, a real residential electrician, a real FP&A analyst). Each trade's jobs are small puzzles modelled on the REAL procedure so real know-how wins. Tiers 0-2 teach; from tier 3 no answer-revealing scaffolding. Puzzles must be fun on a phone (40-120 s, thumb targets >= 44 px, readable at 390 px) with satisfying feedback.
The island's planes: asset ids p1 (model 'twin', "Twin N-12", a 6-seat piston twin), p2 ('cargo', "Cargo C-7", a turbine cargo single), p3 ('float', "Float F-3", a floatplane). See src/sim/data.ts MODELS/TIERS.
PUZZLE CONTRACT: read island-company/src/puzzles/types.ts, kit.ts, torque.ts, teardown.ts and tests/torque.test.ts, tests/puzzles.test.ts. A puzzle module exports a PuzzleDef named after its id { id, role: 'mech', title, gesture, howTo, term, seconds(tier), mount(host, params) } returning { timeUp(), destroy() }; export pure generateX/scoreX; deterministic from the seed; finish with settle(host, result, ms); result() with PASS 0.6 / PERFECT 0.95; kit's stage/loop/pointer/label/fitLabel/roundRect and palette C. params.context may carry { assetName, job } (src/puzzles/types.ts PuzzleContext; you may add optional fields such as aircraft: an aircraft record). The lab loads any puzzle by file name: /lab.html?p=<id>&tier=<n>&seed=<n>&notimer=1. Add your id to the PuzzleId union (src/puzzles/types.ts) and src/puzzles/index.ts; do not touch the game catalog (src/sim/data.ts CATALOG) or the engine: another phase wires the flow.`

const SETUP = (branch, key, port) => `SETUP: you are in a fresh git worktree (it starts on the repo's default branch, which does not contain the game). From the worktree root: git checkout -B ${branch} <base> (given below) && mkdir -p ${OUT}/${key} && ln -s ${MAIN}/node_modules island-company/node_modules. Dev server (never touch 5173/5174): cd island-company && VITE_CACHE_DIR=${OUT}/${key}/vite-cache nohup npx vite --port ${port} --strictPort > ${OUT}/${key}/vite.log 2>&1 &. Play it with Playwright (import from '${MAIN}/node_modules/playwright-core/index.mjs', chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }), 390x844 phone viewport, deviceScaleFactor 2, hasTouch, isMobile), driving real gestures, and LOOK at screenshots with the Read tool. Must pass: npx tsc --noEmit && npx vitest run. Finish: stop your server, commit on ${branch} (do not push), return the result.`

const DATA_SCHEMA = {
  type: 'object',
  properties: { worktreePath: { type: 'string' }, branch: { type: 'string' }, commit: { type: 'string' }, api: { type: 'string', description: 'the exported types and functions, with a short example of each' }, summary: { type: 'string' }, tscOk: { type: 'boolean' }, testsOk: { type: 'boolean' } },
  required: ['worktreePath', 'branch', 'commit', 'api', 'summary', 'tscOk', 'testsOk'],
}

phase('Aircraft data')
const data = await agent(`${FRIEND}

${GAME}

YOUR TASK: build the shared, deterministic aircraft data that makes the mechanic's paperwork real, in a new module island-company/src/sim/aircraft.ts (pure, no DOM) with tests in tests/aircraft.test.ts. Nothing else.
- aircraftOf(islandSeed, assetId, model): a stable record per plane: registration (N-number style), manufacturer-like model designation (fictional but plausible, e.g. a light twin "IC-310", a turbine single "IC-208C", an amphibian/float "IC-185F"), serial number, year, airframe total time, engine model(s), the list of Service Bulletins complied with (with dates), installed STCs/major alterations (with FAA Form 337 references) and a generated airframe logbook: dated entries with tach/total time, description, reference ("IAW <model> MM 32-40-01", "per STC SA0xxxxCH, Form 337 dated ..."), and a signature line with a certificate number. Entries should include plenty of realistic noise (annuals, 100-hr inspections, oil changes, ADs complied with, tire changes) so research takes reading.
- ipcFor(aircraft, ata): Illustrated Parts Catalog data for an assembly (at least: main wheel and brake assembly (ATA 32-40), propeller hub/attach (61-10), a hydraulic reservoir/power pack (29-10), a com radio mount (23-10), and a starter-generator or alternator (24-30)): a figure (items with positions for an exploded view you can draw) and parts-list rows with fig-item, part number with dash numbers, indented nomenclature (". Lining", ". . Rivet"), effectivity codes (by S/N range and pre/post SB), units per assembly, and notes: "SUPSD BY ... (interchangeability code 1/2/3)", "NP" (not procurable: order the next higher assembly), "ALT", "ATTACHING PARTS".
- ammTaskFor(aircraft, task): AMM task-card data (ATA chapter-section-subject task number, effectivity notes, steps, torque values/consumables that can differ by S/N or SB status, cautions).
- Realism matters most: use real conventions (ATA chapters, IPC column layout, interchangeability codes, effectivity, supersession, STC/337 records, AD notes) with fictional part numbers and makers. Make it seeded and deterministic, and design it so a later puzzle can plant exactly one "the part you need is not in the IPC for this aircraft because of <logbook-recorded alteration>" case.
${SETUP('mech-aircraft', 'data', 5197).replace('<base>', BASE)}`, { label: 'aircraft-data', phase: 'Aircraft data', schema: DATA_SCHEMA, isolation: 'worktree' })
if (!data) return { error: 'aircraft data failed' }

const PUZZLES = [
  { key: 'ipc', port: 5198, name: 'IPC parts lookup (new puzzle)', brief: `Build id 'ipc', title "Parts lookup (IPC)", file src/puzzles/ipc.ts, test tests/ipc.test.ts. A part on the aircraft is damaged or missing (tier 0-2: its callout is circled on the figure; tier 3+: only a squawk-style text description such as "L/H main brake linings worn below minimum, rivets exposed"; the player must find the item on the exploded view). The player works the IPC like a mechanic: find the item on the figure, read the parts-list rows, apply effectivity for THIS aircraft's S/N and SB status (from its data plate / record), resolve supersession (SUPSD BY with interchangeability codes: order the current part; one-way codes matter), handle NP by ordering the next higher assembly, and set the quantity (units per assembly x sides as the task needs). Then "Order". Score the part number, the quantity and the reasoning; ordering an NP, wrong-effectivity or superseded-old part is a fault (a wrong part would be a latent defect in the game). Make it tactile: pinch/drag or tap-zoom the exploded view, tap callouts, a scrollable parts list with sticky headers, a data plate you can peek at, an order slip.` },
  { key: 'logbook', port: 5199, name: 'Logbook research + engineering approval (new puzzle)', brief: `Build id 'logbook', title "Logbook research", file src/puzzles/logbook.ts, test tests/logbook.test.ts. The part the job needs is not in the IPC for this aircraft (or the installed part doesn't match the IPC). The player researches the airframe logbook (flip or scroll dated pages; entries with noise) to find the entry that explains the configuration (an STC installation with its Form 337, a field approval, an SB that changed the part, or nothing at all), then chooses how the replacement gets approved, as a real A&P would: use the STC holder's ICA / parts data (already approved data), a minor repair with a logbook entry, a major repair/alteration needing approved data (FAA Form 337 with DER-approved data or a field approval: "engineering approval"), or a PMA part. Then fill the engineering request / logbook entry fields that matter (aircraft reg and S/N, ATA chapter, what and why, reference). Score: finding the right entry, choosing the right approval path, filling it correctly; asking engineering when approved data already exists costs time/money (partial), and installing without required approval is a serious fault. Make it feel like the real logbook: aged paper, handwriting-like entries, tabs by year, a highlighter to mark the entry you rely on.` },
]

const BUILD_SCHEMA = {
  type: 'object',
  properties: { worktreePath: { type: 'string' }, branch: { type: 'string' }, commit: { type: 'string' }, shotsDir: { type: 'string' }, summary: { type: 'string' }, howToPlay: { type: 'string' }, tscOk: { type: 'boolean' }, testsOk: { type: 'boolean' }, openIssues: { type: 'array', items: { type: 'string' } } },
  required: ['worktreePath', 'branch', 'commit', 'shotsDir', 'summary', 'howToPlay', 'tscOk', 'testsOk', 'openIssues'],
}
const REVIEW_SCHEMA = {
  type: 'object',
  properties: { pass: { type: 'boolean' }, issues: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, problem: { type: 'string' }, fix: { type: 'string' } }, required: ['severity', 'problem', 'fix'] } }, notes: { type: 'string' } },
  required: ['pass', 'issues', 'notes'],
}

const built = await pipeline(
  PUZZLES,
  (p) => agent(`${FRIEND}

${GAME}

THE SHARED AIRCRAFT DATA is on branch ${data.branch} (commit ${data.commit}): ${data.summary}
API: ${data.api}

YOUR TASK: ${p.name}
${p.brief}
Use src/sim/aircraft.ts for the aircraft, its logbook, IPC and AMM data (fix or extend it if your puzzle needs more, keeping its tests green). Tier ramp: 0-2 teach (highlighted item, hints about effectivity/supersession or which entry matters); 3+ only what a mechanic would really see.
${SETUP(`mech-${p.key}`, p.key, p.port).replace('<base>', data.commit)}
Put screenshots in ${OUT}/${p.key}/shots and iterate until it is accurate, fun and clean on a phone (at least 3 play-and-look rounds).`, { label: `build:${p.key}`, phase: 'Puzzles', schema: BUILD_SCHEMA, isolation: 'worktree' }),
  async (b, p) => {
    if (!b) return null
    const where = `Work: worktree ${b.worktreePath}, branch ${b.branch} (base ${data.commit}; see \`git -C ${b.worktreePath} diff ${BASE}\`). Screenshots: ${b.shotsDir}. Summary: ${b.summary}. How to play: ${b.howToPlay}. Lab: cd ${b.worktreePath}/island-company && VITE_CACHE_DIR=${OUT}/${p.key}/vite-rev nohup npx vite --port ${p.port + 10} --strictPort > ${OUT}/${p.key}/rev.log 2>&1 & then http://localhost:${p.port + 10}/lab.html?p=${p.key}&tier=<1|3|5>&seed=<n>&notimer=1 (Playwright from '${MAIN}/node_modules/playwright-core/index.mjs', executablePath '/opt/pw-browsers/chromium', 390x844). Stop any server you start.`
    const [ap, play] = await parallel([
      () => agent(`You are a senior A&P mechanic with IA (20+ years; light twins, turbine singles, floatplanes; lots of parts research, logbook research and 337s). ${FRIEND}

${GAME}

ITEM: ${p.name}
${p.brief}
${where}

Read the puzzle, the aircraft data module and the tests; look at the screenshots. Is it how the IPC / logbooks / approvals really work (columns, effectivity, supersession and interchangeability codes, NP/next higher assembly, STC/337/field approval/DER/minor vs major, logbook entry wording)? Would a real A&P respect it or roll their eyes? Do tiers 3+ truly need real knowledge without giving it away? pass = no blocker/major.`, { label: `a&p:${p.key}`, phase: 'Review', schema: REVIEW_SCHEMA }),
      () => agent(`You are a mobile game designer and senior front-end reviewer. ${GAME}

ITEM: ${p.name}
${p.brief}
${where}

PLAY it on a phone viewport at tiers 1, 3 and 5 with real gestures and look at the screenshots: understandable, readable (dense tables at 390 px!), thumb-friendly, no overlaps or dead ends, satisfying; a correct play reaches PERFECT and a sloppy one fails. Review the code: contract (settle, locked timeUp, destroy cleans up), deterministic generate/score, meaningful tests (tier 3+ scaffolding removal), tsc and vitest (run them). pass = no blocker/major.`, { label: `play:${p.key}`, phase: 'Review', schema: REVIEW_SCHEMA }),
    ])
    const issues = [...(ap ? ap.issues : []), ...(play ? play.issues : [])]
    let fix = null
    if (!(ap && ap.pass && play && play.pass) || issues.some((x) => x.severity !== 'minor')) {
      fix = await agent(`${GAME}

Continue ${p.name} in the existing worktree ${b.worktreePath} (branch ${b.branch}); work there directly, no new worktree or branch.
${p.brief}

Reviewers (a senior A&P/IA and a mobile designer/code reviewer) raised:
${JSON.stringify(issues, null, 1)}

Fix every blocker and major and the cheap minors. Verify by playing it in the lab (cd island-company && VITE_CACHE_DIR=${OUT}/${p.key}/vite-cache nohup npx vite --port ${p.port} --strictPort > ${OUT}/${p.key}/fix.log 2>&1 &; Playwright from '${MAIN}/node_modules/playwright-core/index.mjs', executablePath '/opt/pw-browsers/chromium', 390x844). tsc + vitest, stop the server, commit on ${b.branch} ("${p.key}: review fixes"), do not push.`, { label: `fix:${p.key}`, phase: 'Fix', schema: { type: 'object', properties: { commit: { type: 'string' }, fixed: { type: 'array', items: { type: 'string' } }, notFixed: { type: 'array', items: { type: 'string' } }, tscOk: { type: 'boolean' }, testsOk: { type: 'boolean' } }, required: ['commit', 'fixed', 'notFixed', 'tscOk', 'testsOk'] } })
    }
    return { key: p.key, name: p.name, branch: b.branch, worktree: b.worktreePath, commit: fix ? fix.commit : b.commit, summary: b.summary, howToPlay: b.howToPlay, apPass: ap && ap.pass, apIssues: ap && ap.issues, playPass: play && play.pass, playIssues: play && play.issues, fixed: fix && fix.fixed, notFixed: fix && fix.notFixed }
  },
)

return { data: { branch: data.branch, commit: data.commit, worktree: data.worktreePath, summary: data.summary, api: data.api }, puzzles: built.filter(Boolean), missing: PUZZLES.filter((p) => !built.some((x) => x && x.key === p.key)).map((p) => p.key) }
