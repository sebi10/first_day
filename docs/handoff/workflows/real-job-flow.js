export const meta = {
  name: 'real-job-flow',
  description: 'Real job flow (alert, manual/IPC/supply search, real inventory, requisitions), analyst finance tracking, and NPC staff on payroll hired by the analyst; design, build, review, fix and QA',
  phases: [
    { title: 'Design', detail: 'spec, realism and game-design critique, revise' },
    { title: 'Engine', detail: 'inventory, alerts, search, requisitions, migration, bots' },
    { title: 'UI', detail: 'tech job flow, analyst desk + finance tracking, NPC staff' },
    { title: 'Integrate', detail: 'merge, glue, balance, e2e' },
    { title: 'Review', detail: 'trade realism, play/UX, systems' },
    { title: 'Fix', detail: 'blockers, majors, cheap minors' },
    { title: 'QA', detail: 'tests, build, balance, phone/desktop/online e2e, migration' },
  ],
}

const MAIN = '/home/user/first_day'
const INT = MAIN + '/.claude/worktrees/jobflow'
const OUT = '/tmp/claude-0/-home-user-first-day/fbc0a559-d1ad-537c-84ea-3d4f56ea63a5/scratchpad/jobflow'
const SPEC = 'island-company/docs/JOBFLOW.md'
const TRAILER = 'End every commit message you author with these two lines:\n<ATTRIBUTION TRAILER: the Co-Authored-By line your Claude Code session is configured with>\n<optional session trailer>\nNever put a model name or id in commits or code. Do not push.'

const ENV = (dir, port, tag) => `ENVIRONMENT
- Game: "Island Company", a Preact + TypeScript + Vite PWA co-op game for three real friends: an A&P aircraft mechanic ('mech'), a residential electrician ('elec') and an FP&A analyst ('fin'). Real trade knowledge gates play.
- It is LIVE (Firebase, one Firestore doc per island) with real islands in play. Every new state field must be optional with safe defaults: old island docs must load, render and resolve without crashing.
- Engine: pure deterministic reducer apply(state, action, now) + resolveWeek in island-company/src/sim/engine.ts, seeded rng.
- Actions that change the week's economics are in WEEK_BOUND (types.ts) and carry a week stamp.
- Never store derivable data (aircraft records, catalogs, search indexes) in the island doc. Derive it from the seed and the code.
- Version gate: DOC_VERSION in src/net/firebase.ts + firestore.rules (request.resource.data.v == N), ENGINE_VERSION in engine.ts; see docs/DECISIONS.md 'Phase B review fixes' and tests/skew.test.ts.
- Work in: ${dir}. Use absolute paths or git -C; do not cd into the main checkout ${MAIN}.
- node_modules: if ${dir}/island-company/node_modules is missing, symlink ${MAIN}/island-company/node_modules into it.
- Checks, from island-company:
  - npx tsc --noEmit -p .
  - npx vitest run. Whole-season sim tests need vi.setConfig({ testTimeout: 30000 }), because CI runners are ~1.5x slower.
  - npx tsx scripts/balance.ts, and npx tsx scripts/balance.ts robust.
- Browser: run a Vite dev server on port ${port} ONLY: (cd island-company && VITE_CACHE_DIR=${OUT}/${tag}/vite-cache nohup npx vite --port ${port} --strictPort > ${OUT}/${tag}/vite.log 2>&1 &).
  - Kill only your own server, by PID, when done.
  - Playwright: import { chromium } from '${MAIN}/island-company/node_modules/playwright-core/index.mjs', executablePath '/opt/pw-browsers/chromium'. Phone: 390x844, hasTouch, isMobile, dpr 2. Desktop: 1280x820.
  - Never run playwright install. The Manrope font may 403 through the symlinked node_modules: cosmetic, ignore.
  - Scripts:
    - pass-and-play e2e: BASE=http://localhost:${port} node scripts/e2e.mjs <outdir> [desktop]
    - puzzle lab: lab.html?p=<puzzle>&tier=&seed=&notimer=1[&blind=1]
    - island lab: islandlab.html?w=358[&only=<scene>]
- Put screenshots and scratch files in ${OUT}/${tag}/, and LOOK at your screenshots.
- ${TRAILER}`

const USER = `THE OWNER'S REQUEST (verbatim): "for mechanics and electrician we need new level flow such that the mechanic gets alerted to potential issues with the plane, has to search (w a search bar in IPC and manual) to find the part, then he can see if this item is already in stock (if analyst has ordered it already expecting it. so we need different parts.) the electrician is much the same, so customers will flag an issue, he will find the tools see if our inventory (new feature) and if we don't hav it he'll request analyst t buy them. make each job flow like real life as described above."
Follow-up from the owner (verbatim): "make the analyst be able to track finances more closely too just in passing so we can plan. so i can see which parts we more over time quickly vs slowly etc" (= which parts we MOVE quickly vs slowly over time).
Second follow-up from the owner (verbatim): "We also need to add a couple npc to help with expansion of the island like builders and other people that aren't gonna be supplied with other people(these are on the islands payroll and we can hire more skilled for more money etc) analyst decides on hiring."
Earlier words from the A&P player: "When I get a task / I get a manual / I follow manual / If part is gone or missing or damaged / IPC / If part no exist / I check in previous logged items on airplane / The maintenance logs / And then get engineering approval / To put part on airplane".
Standing asks from the group:
- Everyone feels integral but nobody is gridlocked.
- Mistakes are not revealed immediately (realistic): they surface later as incidents or findings.
- Cross-dependency reports use all 3 jobs.
- Ground power carts are interactive.
- It must be snappy and fun on a phone as well as a computer.`

const ASSUME = `DESIGN DECISIONS ALREADY MADE (build on them):
1. EVERY mechanic job on a plane and EVERY electrician job on a house, grid or generator runs the real flow:
   ALERT -> find the task in the MANUAL (search bar) -> find the part / materials / tools (search bar in the IPC or the supply catalog) -> CHECK INVENTORY -> pull from stock, OR REQUISITION -> analyst buys (freight choice) -> delivery -> DO THE JOB (the existing puzzle is the hands-on step) -> sign-off, which consumes what was pulled.
   Charter load sheets (wb), the analyst's own desk tasks and crew projects keep their flow. Crew projects get a materials list from inventory where that is natural.
2. Real, different items replace the generic 'parts kits' (s.parts stock/inTransit, buyList, boat kit):
   - Mechanic, per plane: part numbers from each plane's own IPC (src/sim/aircraft.ts ipcFor/rowFor/orderFor, effectivity by S/N and SB), so the twin, the cargo single and the floatplane need DIFFERENT P/Ns for the same job. Extend the aircraft module's IPC/AMM coverage to every catalog job (tires/brakes 32-40, prop 61-10, hydraulics 29-10/32-40, avionics 23-10, alternator/starter-generator 24-30, oil/filter 79, cylinder/engine 72-00, ignition 74, spar/wing 57, corrosion/wheel, inspection consumables).
   - Mechanic, shop-wide: consumables (safety wire .032/.041, cotter pins, MS28775 O-rings, MIL-PRF-5606/83282 fluid, oil and filters, sealant with shelf life) and rotables (alternator, starter-generator, com radio, magneto) as exchange units with a core charge.
   - Electrician: materials (NM-B/THHN by AWG, breakers by type, amps and poles incl. GFCI/AFCI/dual-function, 15/20 A TR/WR receptacles, boxes, EMT/PVC conduit and fittings, connectors, ground rods) and TOOLS (conduit bender, fish tape, clamp meter, insulation tester, torque screwdriver, knockout set, cable puller). Tools are bought once and kept; they may need calibration or wear out. Materials are consumed.
3. The SEARCH BARS are the skill:
   - The alert describes a symptom, not the answer (e.g. 'Left brake pedal soft, pulls right on rollout').
   - The tech searches the manual (AMM task index / an electrician's code-and-procedure reference with NEC articles) and the IPC / supply catalog.
   - Fuzzy text search with autocomplete chips, fast on a phone (a known answer is found in 2-3 taps), plus chapter browse.
   - Teaching tiers 0-2 suggest from the alert's keywords. Tier 3+ has no suggestions and realistic near-misses: superseded P/Ns, the other S/N effectivity, the 15 A vs 20 A device, AFCI vs GFCI.
4. ALERTS are where jobs come from, several a week:
   - Mechanic: pilot squawks, engine trend monitoring (oil-analysis iron ppm, CHT/EGT trends), tire and brake wear, life-limited parts and inspections coming due, ADs/SBs, inspection findings.
   - Electrician: customer / guest complaints (dead outlet, tripping breaker, flicker, tingle at the shower valve = safety-critical), utility readings, code notices, and materials take-offs for builds.
   - Some alerts are 'could not duplicate / no fault found' after troubleshooting (realistic). Alerts can come early (a trend), so the analyst can stock BEFORE the failure.
   - Information sharing is the cooperative game: the analyst's forecast quality decides how often the techs wait.
5. The ANALYST gets a real purchasing and inventory-planning role:
   - requisition queue: approve, pick vendor and freight (AOG boat now vs next scheduled flight)
   - stocking plan: on hand, on order, reorder point / safety stock, lead time, demand history plus KNOWN upcoming demand from alerts, inspections and projects
   - carrying cost (roughly 0.4-0.6%/week of stock value), shelf-life expiry, obsolescence when a P/N is superseded, core returns, and tools as capex vs consumables as opex
   - This is the newsvendor trade-off: overstock ties up cash, understock grounds planes and leaves houses dark.
   - Adapt the existing auction puzzle (it negotiated 'one parts kit') and the analyst tasks to the new items.
6. NO GRIDLOCK:
   - MEL deferral: a non-critical plane item can be placarded INOP within its MEL category and the plane keeps flying while the part is on order; airworthiness items ground the plane (AOG).
   - Electrician 'make safe': breaker off and tagged, or a temporary blank-off, so a house stays rentable or partly rentable while material is on order; shock/fire hazards make the house unrentable until fixed.
   - An absent analyst: autopilot approves requisitions under a cap. Existing autopilot rules apply to absent techs.
7. WRONG CHOICES SURFACE LATER, NOT AT ONCE, through the existing machinery (receiving-inspection returns with a restocking fee, hidden defects via DEFECT_RULES, incidents traced to the signer, repair -> redo):
   - wrong task or effectivity: a hidden defect
   - wrong P/N or not effective for this S/N: caught at receiving or install
   - wrong breaker or wire size: a hidden defect, later a trip or a fire incident
   - stocking the wrong things: dead cash and expiry
8. The Phase B part chain (src/sim/chain.ts): "not in the IPC -> logbook research -> engineering approval -> install" stays and becomes a branch of this general flow. Reuse its machinery (steps, buy card, receiving, 8130-3 paperwork, quarantine) rather than duplicating it.
9. The existing puzzles stay the hands-on step, fed the chosen task-card values (torque, fluid, precharge) and the chosen device/wire where they apply.
10. Version gate: this changes the engine incompatibly.
    - ENGINE_VERSION -> 3, DOC_VERSION -> 3, firestore.rules requires v == 3, deployed with the hosting build.
    - Migrate v2 docs deterministically: generic kit stock/in-transit becomes starter stock or store credit; open orders waiting on kits become requisitions for specific items; open part chains keep working.
    - Add skew/migration tests with fixtures written by the current engine (base commit 6c0c426).
11. Balance targets are unchanged:
    - three friends and all average reach tier 5 around week 21-23 with 0 weeks below $0 in the standard 30-seed run
    - solo and absent teams stay at tier 1
    - the pacing guard test stays
    - report the robust sweep too
    - the paper-sim bots must play the whole flow (tech bots search with a skill-based hit rate, the fin bot runs a reorder policy, the naive analyst stocks badly).
12. FINANCE TRACKING FOR PLANNING: the analyst can track the business closely at a glance, to plan ahead.
    - INVENTORY VELOCITY per item: units used per week over time (sparkline); turnover and days of supply; weeks since last movement.
    - Fast / slow / dead-stock classes, with ABC by value.
    - Forecast next weeks' demand from history plus the KNOWN upcoming demand; flag items to reorder and items to stop stocking.
    - SPEND and CASH over time: spend by trade, category and asset; parts vs labour vs freight vs carrying cost; revenue vs costs per week; budget vs actual.
    - Inventory value and cash tied up in stock.
    - Readable in seconds on a phone. It feeds the stocking decisions in point 5; it is not a separate chore.
    - Data: store only bounded weekly aggregates in the island doc (e.g. the last 26 weeks, sparse: only items that moved). Derive everything else. Keep doc growth small and tested.
13. NPC STAFF ON THE ISLAND'S PAYROLL (the second follow-up). NPCs do only the work none of the three players do.
    - They NEVER do mechanic, electrician or analyst work. Interdependence and "no role can win alone" hold: solo and absent teams still stay at tier 1.
    - Pick 4-6 roles that matter, e.g.:
      - builders/carpenters: build the expansions over weeks (the tier build sites and the construction stages the island already draws, plus optional extra buildings such as more cottages as investments with a payback period). They consume building materials from the new inventory (lumber, concrete, roofing), so the analyst buys those too.
      - line-service crew: fuel, tow and wash the planes, marshal, and keep the GPU carts charged and parked.
      - charter pilots: fly the planes. More pilots mean more flights. Pilot skill changes hard landings, i.e. the tire/brake alerts the mechanic gets.
      - housekeeping / front desk: guest turnover and reviews drive occupancy.
      - groundskeeper: island care and flourishes.
    - Each NPC has a name, a skill (e.g. 1-5), a weekly wage (more skill costs more), and maybe morale/fatigue and a trait. Effects scale with skill: build speed and construction rework risk, damage incidents, guest satisfaction.
    - THE ANALYST DECIDES ON HIRING:
      - a weekly hiring board of candidates (skill, wage ask, start date), hire, let go (severance), raises
      - payroll is a weekly fixed cost shown in the finance tracking (decision 12)
      - expansion pace vs fixed-cost leverage is a real FP&A trade-off; an unaffordable payroll must be visible before it bites
    - The techs can REQUEST staff (e.g. "we need a second builder for the villa site", "line crew keeps leaving carts on planes"), and the analyst decides. This keeps all three involved.
    - NPC figures appear on the island at work (builders on sites, line crew on the apron) within the node budget (beaten scene ≤ 1500).
    - Bots and autopilot: the fin bot runs a simple hiring policy; the naive analyst over- or under-hires. Balance targets unchanged.`

const SPEC_SCHEMA = { type: 'object', properties: { commit: { type: 'string' }, summary: { type: 'string' }, engineScope: { type: 'string' }, techUiScope: { type: 'string' }, analystUiScope: { type: 'string' }, npcScope: { type: 'string' } }, required: ['commit', 'summary', 'engineScope', 'techUiScope', 'analystUiScope', 'npcScope'] }
const CRIT_SCHEMA = { type: 'object', properties: { issues: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, area: { type: 'string' }, problem: { type: 'string' }, fix: { type: 'string' } }, required: ['severity', 'area', 'problem', 'fix'] } } }, required: ['issues'] }
const BUILD_SCHEMA = { type: 'object', properties: { branch: { type: 'string' }, worktree: { type: 'string' }, commit: { type: 'string' }, summary: { type: 'string' }, howToPlay: { type: 'string' }, balance: { type: 'string' }, tscOk: { type: 'boolean' }, testsOk: { type: 'boolean' }, notDone: { type: 'array', items: { type: 'string' } } }, required: ['branch', 'worktree', 'commit', 'summary', 'howToPlay', 'balance', 'tscOk', 'testsOk', 'notDone'] }
const MERGE_SCHEMA = { type: 'object', properties: { commit: { type: 'string' }, summary: { type: 'string' }, tscOk: { type: 'boolean' }, testsOk: { type: 'boolean' }, testsTotal: { type: 'number' }, balance: { type: 'string' } }, required: ['commit', 'summary', 'tscOk', 'testsOk', 'balance'] }
const REVIEW_SCHEMA = { type: 'object', properties: { pass: { type: 'boolean' }, issues: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, area: { type: 'string' }, problem: { type: 'string' }, fix: { type: 'string' } }, required: ['severity', 'area', 'problem', 'fix'] } } }, required: ['pass', 'issues'] }
const FIX_SCHEMA = { type: 'object', properties: { commit: { type: 'string' }, fixed: { type: 'array', items: { type: 'string' } }, notFixed: { type: 'array', items: { type: 'string' } }, tscOk: { type: 'boolean' }, testsOk: { type: 'boolean' }, balance: { type: 'string' } }, required: ['commit', 'fixed', 'notFixed', 'tscOk', 'testsOk', 'balance'] }
const QA_SCHEMA = { type: 'object', properties: { commit: { type: 'string' }, ok: { type: 'boolean' }, testsTotal: { type: 'number' }, tscOk: { type: 'boolean' }, buildOk: { type: 'boolean' }, balance: { type: 'string' }, e2ePhoneOk: { type: 'boolean' }, e2eDesktopOk: { type: 'boolean' }, e2eOnlineOk: { type: 'boolean' }, migrationOk: { type: 'boolean' }, shotsDir: { type: 'string' }, failures: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' } }, required: ['commit', 'ok', 'tscOk', 'buildOk', 'balance', 'e2ePhoneOk', 'e2eDesktopOk', 'e2eOnlineOk', 'migrationOk', 'failures', 'summary'] }

// ---------- Design ----------
phase('Design')
const spec = await agent(`${ENV(INT, 5210, 'spec')}

${USER}

${ASSUME}

TASK: write the implementation spec at ${INT}/${SPEC} and commit it on branch 'jobflow' ("Job flow spec"). Read the code first:
- sim/engine.ts, types.ts, data.ts, econ.ts, chain.ts, aircraft.ts, bots.ts
- the puzzles and the UI (ops.tsx, orders.tsx, desk.tsx, manual.tsx, chain.tsx, select.ts, home.tsx)
- docs/DECISIONS.md

The spec must be concrete enough that three builders can work in parallel without guessing:
- DATA MODEL: exact TypeScript types for:
  - catalog items (id, trade, kind part/consumable/rotable/material/tool, P/N, nomenclature, effectivity, price, lead time, shelf life, core charge)
  - inventory (per item on hand, on order, eta, reorder point)
  - alerts
  - requisitions
  - the job-flow stage on orders
  - MEL / make-safe state
  - What is stored vs derived.
- CATALOG CONTENT: real-world names and P/N styles for every catalog job's parts and consumables, per plane model (extend aircraft.ts), and the electrical materials and tools with the NEC basis for each choice.
- ALERTS: generators per trade with symptom text and weights, true-fault vs no-fault-found rates, early-warning lead times, safety-critical flags.
- SEARCH:
  - index sources (AMM task index, IPC nomenclature/P/N, electrical reference with NEC articles, supply catalog)
  - ranking, tier behaviour, and the near-miss distractors
  - pure functions with signatures, deterministic for tests and bots
- ENGINE ACTIONS: each new action (investigate/diagnose, choose task, pick items, pull, requisition, analyst purchase and stock order, freight, receive, MEL defer / make safe, cancel/return), with validation, week stamps, and what resolveWeek does (deliveries, carrying cost, expiry, autopilot).
- CONSEQUENCES for each kind of wrong choice (point at the existing DEFECT_RULES / receiving machinery).
- UI SCREENS, phone-first, with the tap sequence for a known answer (target 2-3 taps per search step):
  - tech: alert inbox, job-flow stepper, search bars, stock badges
  - analyst: purchasing desk, stock planner, requisition queue
  - how each role knows whose move it is
- MIGRATION + VERSION GATE plan.
- BALANCE PLAN: the knobs and the expected numbers.
- BOTS and AUTOPILOT.
- A TEST PLAN.
- A WORK SPLIT that avoids file conflicts:
  - (A) engine + data + aircraft catalog extension + search functions + bots + migration + tests
  - (B) tech UI for both mech and elec (one shared job-flow component with trade-specific search/catalog views)
  - (C) analyst purchasing/inventory UI + auction/desk-task adaptation
  - (D) NPC staff: staff model, payroll, hiring board, NPC effects on construction, flights and guests, the analyst's hiring UI as its own component, NPC figures on the island, bots
  - B, C and D build on A's commit. D keeps its engine changes in its own module (e.g. src/sim/staff.ts) with small hooks into resolveWeek.
If a partial ${SPEC} from a stopped earlier agent exists uncommitted, reuse what is good.
Return the commit and one-paragraph scopes for A, B, C and D.`, { label: 'spec', phase: 'Design', schema: SPEC_SCHEMA })
if (!spec) return { stage: 'spec' }
log('spec committed ' + spec.commit)

const CRIT = (lens, port, tag) => `${ENV(INT, port, tag)}
READ-ONLY: review the spec at ${INT}/${SPEC} (commit ${spec.commit}) against the code it will change. Do not edit files.
${USER}
LENS: ${lens}
Return issues with a severity and a concrete fix each. A blocker or major is something that would make the game wrong, unfair, gridlocked, tedious or unbuildable.`
const crits = await parallel([
  () => agent(CRIT(`TRADE REALISM, from three experts at once:
- a senior A&P/IA: squawk -> troubleshoot -> AMM task -> IPC effectivity -> stores/stock -> requisition -> receiving (8130-3) -> install -> return to service; MEL categories and placards; rotables, cores, shelf life
- a licensed residential electrician: service call from a customer complaint -> diagnose -> material take-off and tools -> supply-house run; NEC basis for GFCI/AFCI, conductor sizing, box fill, conduit; make-safe practice
- a purchasing / FP&A manager: reorder points, safety stock, lead times, carrying cost, obsolescence, capex vs opex, budgets, and hiring/payroll decisions for the NPC staff
Is every item, symptom, part and price believable? Would each player respect it?`, 5211, 'crit-real'), { label: 'critique:realism', phase: 'Design', schema: CRIT_SCHEMA }),
  () => agent(CRIT(`GAME DESIGN for three friends on phones:
- tedium: search every job on a phone?
- gridlock: techs waiting on the analyst, the analyst with nothing to do
- clarity of whose move it is
- learning curve and week 0
- fun and interdependence (the analyst's stocking as a newsvendor game; information sharing from early alerts)
- balance risk: cash tied up in stock, planes grounded
- scope risk for a live game with real islands (migration)
- Goodhart risks in the new metrics
- NPC staff: does hiring feel like a real decision, and does any NPC erode a player's role?
Propose the smallest changes that make it fun and snappy.`, 5212, 'crit-game'), { label: 'critique:game', phase: 'Design', schema: CRIT_SCHEMA }),
])
const critIssues = []
crits.forEach((c, i) => { if (c) c.issues.forEach((x) => critIssues.push({ lens: i ? 'game' : 'realism', ...x })) })
log('design critique: ' + critIssues.filter((x) => x.severity !== 'minor').length + ' blocker/major, ' + critIssues.filter((x) => x.severity === 'minor').length + ' minor')

const revised = await agent(`${ENV(INT, 5213, 'revise')}
TASK: revise the spec at ${INT}/${SPEC} on branch 'jobflow'. Resolve every blocker and major from the critique below, and take the minors that are cheap or clearly right. Where you reject a point, say why in a 'Rejected critique' section. Keep the work split (A engine, B tech UI, C analyst UI, D NPC staff) and make it sharper where the critique exposed gaps. Commit ("Job flow spec: critique round").
Also, as the last section, write DECISIONS the owner should know about: the 5-10 most consequential design choices and their trade-offs, in plain words.
${USER}
CRITIQUE (JSON):
${JSON.stringify(critIssues, null, 1)}`, { label: 'revise', phase: 'Design', schema: SPEC_SCHEMA })
if (!revised) return { stage: 'revise', spec, critIssues }
log('spec revised ' + revised.commit)

// ---------- Engine ----------
phase('Engine')
const WT = (b) => `${MAIN}/.claude/worktrees/${b}`
const MKWT = (b, base) => `FIRST create your own worktree: git -C ${MAIN} worktree add -b ${b} ${WT(b)} ${base}  (if it exists, check it out at ${base}). Symlink node_modules into it. Commit on branch ${b}.`
const engine = await agent(`${ENV(WT('jobflow-engine'), 5214, 'engine')}
${MKWT('jobflow-engine', revised.commit)}

${USER}

BUILD WORK PACKAGE A from the spec ${SPEC} (read ALL of it first; it is the contract, and the UI builders will code against your types and actions):
- engine
- data
- aircraft catalog/IPC/AMM extension
- electrical catalog and reference
- pure search functions
- alerts
- inventory
- requisitions and purchasing actions
- MEL / make-safe
- resolveWeek changes (deliveries, carrying cost, expiry, autopilot)
- consequences wiring
- the Phase B chain as a branch of the flow
- version bump + migration
- paper-sim bots and autopilot
- tests: unit, flow paths per trade, migration from fixtures written by the base engine at 6c0c426, determinism, week stamps, balance guard
Keep the existing UI compiling: add minimal adapters or TODO stubs in UI files only where types force it, and leave real UI work to packages B and C.
Scope from the spec: ${revised.engineScope}
Balance: meet the targets (standard + robust) and document the tuning in docs/DECISIONS.md (new section 'Real job flow').
Commit ("Job flow engine: alerts, search, inventory, requisitions").
Return branch, worktree, commit, summary (types and actions the UI must use, with file paths), howToPlay (how to reach each flow quickly in the lab or a crafted save), balance tables, notDone.`, { label: 'build:engine', phase: 'Engine', schema: BUILD_SCHEMA })
if (!engine || !engine.testsOk || !engine.tscOk) { log('engine failed'); return { stage: 'engine', revised, engine } }
log('engine ' + engine.commit)

// ---------- UI ----------
phase('UI')
const ui = await parallel([
  () => agent(`${ENV(WT('jobflow-techui'), 5215, 'techui')}
${MKWT('jobflow-techui', engine.commit)}
${USER}
BUILD WORK PACKAGE B from the spec ${SPEC}: the tech job-flow UI for BOTH the mechanic and the electrician. Use one shared job-flow component with trade-specific search and catalog views.
Screens:
- alert inbox, with whose-move chips
- the job stepper: alert -> manual search -> part/material/tool search with stock badges (on hand / on order + ETA / none) -> pull or requisition -> MEL defer / make safe -> start the puzzle -> sign-off
- the IPC and manual search bars (fuzzy search, autocomplete chips, chapter browse, keyboard-aware on phones)
- the electrician's code/procedure reference and supply-catalog search
- a read-only inventory view for techs
Launching the existing puzzles must pass the chosen task-card values and items.
Engine contract: ${engine.summary.slice(0, 3000)}
Scope from the spec: ${revised.techUiScope}
Phone-first:
- 44px targets, no overlaps at 360-390 px, a known answer reachable in 2-3 taps per search step
- teaching tiers show suggestions; tier 3+ does not
- desktop 1280 must work too
Play each trade's flow end to end on a 390x844 phone (both the stock-hit path and the requisition path, plus a no-fault-found alert), screenshot every step, and fix what's unclear. Update docs/ONBOARDING.md (mechanic and electrician sections).
Commit ("Job flow UI: alerts, manual and IPC search, stock, requisitions"). Return branch, worktree, commit, summary, howToPlay, balance (unchanged or not), notDone.`, { label: 'build:techui', phase: 'UI', schema: BUILD_SCHEMA }),
  () => agent(`${ENV(WT('jobflow-fin'), 5216, 'finui')}
${MKWT('jobflow-fin', engine.commit)}
${USER}
BUILD WORK PACKAGE C from the spec ${SPEC}: the analyst's purchasing and inventory-planning UI.
Screens:
- requisition queue: approve, vendor/freight choice, AOG vs scheduled, running totals
- stock planner: per item on hand, on order, reorder point / safety stock, lead time, demand history, KNOWN upcoming demand from alerts, inspections and projects, carrying cost, shelf-life/expiry and obsolescence flags; set reorder points and place stock orders
- receiving (8130-3 / packing slip)
- cores
- tools capex vs consumables opex
- FINANCE TRACKING for planning (decision 12 in the spec). It is part of the stock planner and the analyst's desk, glanceable on a phone:
  - item velocity sparklines and fast/slow/dead-stock classes, turnover and days of supply, ABC by value
  - demand forecast with reorder / stop-stocking flags
  - spend by trade, category and asset over weeks
  - revenue vs costs per week, budget vs actual, cash tied up in stock
  Use the repo's existing chart and number styles.
Adapt the auction puzzle (it negotiated 'one parts kit') and the desk tasks to real items. The island may show deliveries or a stores building ONLY if it stays within the island's 1500-node budget (optional).
Engine contract: ${engine.summary.slice(0, 3000)}
Scope from the spec: ${revised.analystUiScope}
Phone-first:
- 44px targets, dense tables readable at 390 px
- desktop 1280 must work too
Play the analyst seat for several weeks on a phone: stock ahead of alerts, run a requisition in AOG, let something expire. Screenshot and fix what's unclear. Update docs/ONBOARDING.md (analyst section).
Commit ("Job flow UI: purchasing desk and stock planner"). Return branch, worktree, commit, summary, howToPlay, balance, notDone.`, { label: 'build:finui', phase: 'UI', schema: BUILD_SCHEMA }),
  () => agent(`${ENV(WT('jobflow-npc'), 5226, 'npc')}
${MKWT('jobflow-npc', engine.commit)}
${USER}
BUILD WORK PACKAGE D from the spec ${SPEC}: NPC staff on the island's payroll (decision 13).
- Engine, in its own module (e.g. src/sim/staff.ts) with small hooks into resolveWeek:
  - staff model: names, roles, skill, wage, morale/fatigue if in the spec
  - weekly hiring board, hire / let go / raise actions (week-stamped, WEEK_BOUND)
  - payroll as a fixed cost, recorded in the finance aggregates
  - role effects: builders build expansions and consume building materials from inventory; line crew; pilots and flights; hard landings feeding the mechanic's tire/brake alerts; housekeeping and occupancy
  - techs' staff requests
  - migration defaults (no staff on old islands, or a minimal starting crew if the spec says so)
- The analyst's hiring UI as its own component (e.g. src/ui/staff.tsx), mounted on the desk with a small hook:
  - candidates with skill stars and wage
  - payroll now vs after hiring, and what each hire changes
- NPC figures at work on the island (builders on build sites, line crew on the apron), in the island's art style, within the node budget: beaten scene ≤ 1500 nodes; check with islandlab.
- Bots: the fin bot's hiring policy; autopilot.
- Tests and balance:
  - the same targets
  - NPCs must never let a solo or absent team leave tier 1
  - report the standard + robust tables
Engine contract: ${engine.summary.slice(0, 2500)}
Scope from the spec: ${revised.npcScope}
Play several weeks on a 390x844 phone as the analyst (hire a builder, watch a build progress, let someone go), screenshot and fix what's unclear. Update docs/ONBOARDING.md and docs/DECISIONS.md.
Commit ("NPC staff: payroll, hiring board, builders and crew"). Return branch, worktree, commit, summary, howToPlay, balance, notDone.`, { label: 'build:npc', phase: 'UI', schema: BUILD_SCHEMA }),
])
const [techui, finui, npc] = ui
if (!techui || !finui || !npc) { log('a UI/NPC build failed'); return { stage: 'ui', engine, techui, finui, npc } }

// ---------- Integrate ----------
phase('Integrate')
const integ = await agent(`${ENV(INT, 5217, 'integrate')}
TASK: bring everything into branch 'jobflow' in ${INT}, which is at the spec commit (${revised.commit}):
- Merge jobflow-engine (${engine.commit}), then jobflow-techui (${techui.commit}), jobflow-fin (${finui.commit}) and jobflow-npc (${npc.commit}), with --no-ff. Resolve conflicts keeping all features whole.
- Make the flows work across seats. For example: a tech's requisition shows on the analyst's queue at once; a stock order arrives and flips badges to 'on hand'; a no-fault-found alert closes cleanly; MEL / make-safe show on the island and the board.
- Engine notes: ${engine.summary.slice(0, 1500)}
- Tech UI notes: ${techui.summary.slice(0, 1200)}; not done: ${JSON.stringify(techui.notDone).slice(0, 500)}
- Analyst UI notes: ${finui.summary.slice(0, 1200)}; not done: ${JSON.stringify(finui.notDone).slice(0, 500)}
- NPC notes: ${npc.summary.slice(0, 1200)}; not done: ${JSON.stringify(npc.notDone).slice(0, 500)}
Verify:
- tsc and vitest
- balance, standard and robust
- the pass-and-play e2e on phone and desktop; update scripts/e2e.mjs and scripts/e2e-online.mjs for the new flow so they exercise it
- islandlab beaten-scene node count ≤ 1500
Commit ("Integrate the real job flow"). Return commit, summary, tsc/tests, balance.`, { label: 'integrate', phase: 'Integrate', schema: MERGE_SCHEMA })
if (!integ || !integ.tscOk || !integ.testsOk) { log('integration failed'); return { stage: 'integrate', engine, techui, finui, npc, integ } }
const HEAD = integ.commit.slice(0, 12)

// ---------- Review ----------
const REV = (port, tag) => `${ENV(INT, port, tag)}
You are a READ-ONLY reviewer of branch 'jobflow' at ${HEAD} in ${INT}. Do not edit, commit or stash anything there. You may write scratch files in ${OUT}/${tag}/.
What was built:
- the spec, at ${SPEC}
- engine: ${engine.summary.slice(0, 1000)}; how to reach it: ${engine.howToPlay.slice(0, 500)}
- tech UI: ${techui.summary.slice(0, 800)}; how to reach it: ${techui.howToPlay.slice(0, 500)}
- analyst UI: ${finui.summary.slice(0, 800)}; how to reach it: ${finui.howToPlay.slice(0, 500)}
- NPC staff: ${npc.summary.slice(0, 800)}; how to reach it: ${npc.howToPlay.slice(0, 500)}
${USER}
Report issues with severity (blocker = broken or unplayable, major = wrong or confusing enough that the friends would notice, minor = polish), each with a concrete fix. pass = no blocker or major.`
phase('Review')
const reviews = await parallel([
  () => agent(`${REV(5218, 'rev-trades')}
LENS: three experts playing their own seat on a phone:
- A senior A&P/IA: are the alerts, troubleshooting, AMM tasks, IPC effectivity, stores, requisitions, receiving, MEL deferrals and consequences how the line really works?
- A licensed electrician: are the complaints, diagnosis, materials and tools, NEC basis and make-safe right?
- A purchasing / FP&A manager: do the stocking decisions, carrying cost, lead times, cores, expiry and capex/opex make business sense, and is it a real decision rather than busywork? Are the finance tracking views right, and are hiring and payroll for the NPC staff realistic?
Read the text and the numbers.`, { label: 'review:trades', phase: 'Review', schema: REVIEW_SCHEMA }),
  () => agent(`${REV(5219, 'rev-play')}
LENS: the three friends playing it.
- Play pass-and-play on a 390x844 phone across all three seats for several weeks.
- For each trade: run a stock-hit job, a requisition job, a no-fault-found alert, and an MEL deferral (mech) or make-safe (elec).
- As the analyst: stock ahead of alerts, handle an AOG requisition, use the finance tracking to plan, and hire and let go NPC staff (watch a builder build).
- Check desktop 1280x820 too.
Judge:
- Is it snappy (taps per job, typing on a phone)?
- Is it always clear whose move it is?
- Does anyone get gridlocked or bored?
- Is it fun and interdependent?
- Is it readable with no overlaps, and is week 0 / the learning curve OK?
Take screenshots and look at them.`, { label: 'review:play', phase: 'Review', schema: REVIEW_SCHEMA }),
  () => agent(`${REV(5220, 'rev-sys')}
LENS: systems, code and balance.
- Engine determinism and purity; week stamps / WEEK_BOUND for every new action.
- The online multi-device model: one Firestore doc, transactions. Doc size growth: catalogs and indexes must be derived, and the inventory, alert and requisition histories must be bounded.
- The version gate and MIGRATION: build v2 fixtures with the base engine (git show 6c0c426) in a temp worktree, including docs mid-chain, mid-week and with kits in transit. Load and resolve them on this build and look for lost orders or money.
- Performance: search indexes built once and memoized; renders with large catalogs on a phone.
- Test quality.
- Balance: the standard and robust sweeps.
- NPCs must never let a solo or absent team leave tier 1, and payroll must be affordable in the standard run.
- Edge cases: two requisitions for the last item, an item superseded while on order, expiry mid-job, a seat leaving mid-flow, a week closing mid-search.`, { label: 'review:systems', phase: 'Review', schema: REVIEW_SCHEMA }),
])
const issues = []
const names = ['trades', 'play', 'systems']
reviews.forEach((r, i) => { if (r) r.issues.forEach((x) => issues.push({ lens: names[i], ...x })) })
log('reviews: ' + reviews.map((r, i) => names[i] + '=' + (r ? (r.pass ? 'pass' : 'fail') : 'died')).join(', ') + '; ' + issues.filter((x) => x.severity !== 'minor').length + ' blocker/major, ' + issues.filter((x) => x.severity === 'minor').length + ' minor')

// ---------- Fix ----------
const FIXP = (list, round, port) => `${ENV(INT, port, 'fix' + round)}
TASK: fix round ${round} on branch 'jobflow' in ${INT}.
- Fix EVERY blocker and major below, and the cheap minors.
- Keep the balance targets.
- Verify each fix: tests, and the phone browser for UI.
- Run tsc, vitest, balance (standard + robust), and the pass-and-play e2e on phone and desktop.
- Update the docs where behaviour changed.
- Commit "Job flow review fixes${round > 1 ? ' (round ' + round + ')' : ''}".
ISSUES (JSON):
${JSON.stringify(list, null, 1)}`
phase('Fix')
let fix = await agent(FIXP(issues, 1, 5221), { label: 'fix', phase: 'Fix', schema: FIX_SCHEMA })

// ---------- QA ----------
const QAP = (port) => `${ENV(INT, port, 'qa')}
TASK: final QA of branch 'jobflow' in ${INT} before it deploys to the live game.
- Do not change game behaviour. You may fix only a failing check's trivial cause (a stale test expectation, a script), and must commit any fix ("QA fixes").
Run and report each:
1. tsc and vitest (count).
2. npm run build.
3. Balance, standard and robust.
4. Pass-and-play e2e on phone and desktop.
5. The online e2e against the Firebase emulators (header of scripts/e2e-online.mjs):
   - Run your OWN emulator on host 127.0.0.4 with this branch's firestore.rules and its own TMPDIR. Other agents may hold 127.0.0.1-3; never kill processes that are not yours.
   - Vite on port ${port + 1} with VITE_FB_EMULATOR=127.0.0.4.
   - Also confirm on the emulator: a v:2 write is refused, a v:3 write is accepted, and listing islands is refused.
   - Stop everything you started, by PID.
6. Migration: docs written by the base engine (6c0c426: early, late, mid-week, mid-chain, kits in transit) load, render and resolve, with no money or orders lost. Point to or add tests.
7. islandlab: all scenes at phone width, plus the beaten-scene node count (≤ 1500).
8. Scripted phone runs with screenshots:
   - one mechanic job: stock hit
   - one mechanic requisition incl. the analyst's approval and the delivery
   - one electrician job with a tool bought
   - one no-fault-found alert
   - one MEL deferral
   - the analyst's finance tracking view
   - hiring a builder and seeing a build progress on the island
Save everything under ${OUT}/qa/. ok = every check passes. List failures precisely.`
phase('QA')
let qa = await agent(QAP(5222), { label: 'qa', phase: 'QA', schema: QA_SCHEMA })
if (qa && !qa.ok) {
  log('QA failed: ' + qa.failures.join(' | ').slice(0, 500))
  phase('Fix')
  const fix2 = await agent(FIXP(qa.failures.map((f) => ({ severity: 'blocker', area: 'qa', problem: f, fix: 'make the check pass without weakening it' })), 2, 5224), { label: 'fix:qa', phase: 'Fix', schema: FIX_SCHEMA })
  phase('QA')
  qa = await agent(QAP(5225), { label: 'qa:2', phase: 'QA', schema: QA_SCHEMA })
  fix = { first: fix, second: fix2 }
}
return { spec, critIssues, revised, engine, techui, finui, npc, integ, reviews: { trades: reviews[0], play: reviews[1], systems: reviews[2] }, fix, qa }