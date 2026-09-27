export const meta = {
  name: 'phase-b-mechanic-flow',
  description: 'Merge island + IPC/logbook puzzles, build the manual->IPC->logbook->engineering-approval part chain and interactive ground power carts with cross-trade reports, then review, fix and QA',
  phases: [
    { title: 'Merge', detail: 'island-final, mech-ipc, mech-logbook into integrate' },
    { title: 'Build', detail: 'part chain + AMM cards; ground power carts + reports' },
    { title: 'Integrate', detail: 'merge both builds, tests, balance, e2e' },
    { title: 'Review', detail: 'A&P realism, play/UX, systems' },
    { title: 'Fix', detail: 'blockers, majors, cheap minors' },
    { title: 'QA', detail: 'tests, build, balance, phone/desktop/online e2e' },
  ],
}

const MAIN = '/home/user/first_day'
const INT = MAIN + '/.claude/worktrees/integrate'
const OUT = '/tmp/claude-0/-home-user-first-day/fbc0a559-d1ad-537c-84ea-3d4f56ea63a5/scratchpad/phaseb'
const TRAILER = 'End every commit message you author with these two lines:\n<ATTRIBUTION TRAILER: the Co-Authored-By line your Claude Code session is configured with>\n<optional session trailer>\nNever put a model name or id in commits or code. Do not push.'

const ENV = (dir, port, tag) => `ENVIRONMENT
- Game: "Island Company", a Preact + TypeScript + Vite PWA co-op game for three real friends: an A&P aircraft mechanic (role 'mech'), a residential electrician ('elec') and an FP&A analyst ('fin'). Real trade knowledge gates play. It is LIVE (Firebase) with real islands saved in Firestore, so every new state field must be optional with safe defaults: old island docs must load and play without crashing.
- Engine: pure deterministic reducer apply(state, action, now) + resolveWeek in island-company/src/sim/engine.ts, seeded rng, one island document synced across devices. Actions that change the week's economics are listed in WEEK_BOUND (types.ts) and carry a week stamp. Never store derivable data (e.g. aircraft records) in the island doc: derive it from the seed.
- Work in: ${dir}. Use absolute paths or git -C; do not cd into the main checkout ${MAIN}.
- node_modules: if ${dir}/island-company/node_modules is missing, symlink ${MAIN}/island-company/node_modules into it.
- Checks from island-company: npx tsc --noEmit -p .  and  npx vitest run  and  npx tsx scripts/balance.ts  (and npx tsx scripts/balance.ts robust).
- Browser: Vite dev server on port ${port} ONLY (cd island-company && VITE_CACHE_DIR=${OUT}/${tag}/vite-cache nohup npx vite --port ${port} --strictPort > ${OUT}/${tag}/vite.log 2>&1 &), kill only your own server by PID when done. Playwright: import { chromium } from '${MAIN}/island-company/node_modules/playwright-core/index.mjs', executablePath '/opt/pw-browsers/chromium'; phone 390x844 hasTouch isMobile dpr 2, desktop 1280x820. Never run playwright install. The Manrope font may 403 through the symlinked node_modules: cosmetic, ignore. Scripts: scripts/e2e.mjs (pass-and-play: BASE=http://localhost:${port} node scripts/e2e.mjs <outdir> [desktop]), lab.html?p=<puzzle>&tier=&seed=&notimer=1[&blind=1], islandlab.html?w=358[&only=<scene>].
- Put screenshots and scratch files in ${OUT}/${tag}/. Look at your screenshots.
- ${TRAILER}`

const MERGE_SCHEMA = { type: 'object', properties: { commit: { type: 'string' }, summary: { type: 'string' }, tscOk: { type: 'boolean' }, testsOk: { type: 'boolean' }, testsTotal: { type: 'number' } }, required: ['commit', 'summary', 'tscOk', 'testsOk'] }
const BUILD_SCHEMA = { type: 'object', properties: { branch: { type: 'string' }, worktree: { type: 'string' }, commit: { type: 'string' }, summary: { type: 'string' }, howToPlay: { type: 'string' }, balance: { type: 'string' }, tscOk: { type: 'boolean' }, testsOk: { type: 'boolean' }, notDone: { type: 'array', items: { type: 'string' } } }, required: ['branch', 'worktree', 'commit', 'summary', 'howToPlay', 'balance', 'tscOk', 'testsOk', 'notDone'] }
const REVIEW_SCHEMA = { type: 'object', properties: { pass: { type: 'boolean' }, issues: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, area: { type: 'string' }, problem: { type: 'string' }, fix: { type: 'string' } }, required: ['severity', 'area', 'problem', 'fix'] } } }, required: ['pass', 'issues'] }
const FIX_SCHEMA = { type: 'object', properties: { commit: { type: 'string' }, fixed: { type: 'array', items: { type: 'string' } }, notFixed: { type: 'array', items: { type: 'string' } }, tscOk: { type: 'boolean' }, testsOk: { type: 'boolean' }, balance: { type: 'string' } }, required: ['commit', 'fixed', 'notFixed', 'tscOk', 'testsOk', 'balance'] }
const QA_SCHEMA = { type: 'object', properties: { commit: { type: 'string' }, ok: { type: 'boolean' }, testsTotal: { type: 'number' }, tscOk: { type: 'boolean' }, buildOk: { type: 'boolean' }, balance: { type: 'string' }, e2ePhoneOk: { type: 'boolean' }, e2eDesktopOk: { type: 'boolean' }, e2eOnlineOk: { type: 'boolean' }, migrationOk: { type: 'boolean' }, shotsDir: { type: 'string' }, failures: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' } }, required: ['commit', 'ok', 'tscOk', 'buildOk', 'balance', 'e2ePhoneOk', 'e2eDesktopOk', 'e2eOnlineOk', 'migrationOk', 'failures', 'summary'] }

const FRIEND = `The A&P player's own words about how his job really works (build exactly this): "When I get a task / I get a manual / I follow manual / If part is gone or missing or damaged / IPC / If part no exist / I check in previous logged items on airplane / The maintenance logs / And then get engineering approval / To put part on airplane". The group's other asks: everyone feels integral but nobody is gridlocked; if we mess something up we should NOT see an immediate sign we were wrong (realistic), there is an incident later; cross-dependency reports from random things using all 3 jobs (e.g. mechanic: "this light doesn't work in my shop" -> electrician fixes it); ground power carts have to be interactive for the mechanic.`

// ---------- Merge ----------
phase('Merge')
const merged = await agent(`${ENV(INT, 5193, 'merge')}

TASK: merge three finished branches into branch 'integrate' (currently 1f49dd7 = claude/jolly-keller-gy5hs4 + consequences + new mechanic puzzles crack/hydraulics/gpu) with git merge --no-ff, in this order:
1. island-final (3b5ebf3): the new island art (island.tsx, island/*.tsx, islandlab, island section of styles.css). Keep all of it.
2. mech-ipc (ab8094a): src/sim/aircraft.ts (seeded aircraft identity, logbooks, IPC figures ipcFor, AMM task cards ammTaskFor, plants = hidden STC/field approvals, approvalBasis/reviewRequest) + the new 'ipc' parts-lookup puzzle.
3. mech-logbook (e8f6d25): the same aircraft.ts base extended + the new 'logbook' research + engineering approval puzzle. Expect conflicts in aircraft.ts (adText return line, AdRecord literal, both sides extended the module: keep BOTH sides' features), lab.ts, puzzles/index.ts, puzzles/types.ts (register both puzzles; keep every existing puzzle).
Then:
- Blind mode: consequences added PuzzleParams.blind (from puzzle tier 2 a real job shows no verdict: no right/wrong sounds, shakes, ticks, reveal or score; neutral sign-off, settle via host.hold/settle()). Add it to ipc and logbook the same way (read tests/blind.test.ts and how crack/hydraulics/gpu did it): blind hides whether the P/N / approval route is right; the stamped paperwork itself stays. Extend tests/blind.test.ts to cover them.
- tests/catalog.test.ts requires every mechanic puzzle to be on the catalog: ipc and logbook will be launched by a part-chain being built next, so mark them as chain puzzles in that test (a small explicit set) rather than inventing catalog jobs now.
- src/ui/select.ts launchFor: pass the island's own aircraft to mechanic puzzles on planes (context.aircraft = aircraftOf(s.seed, asset.id, <model for that plane: twin/cargo/float>) if the puzzles read it); memoize so it is not rebuilt every render.
- tsc, vitest, balance (unchanged expectations: three friends & all average T5 ~wk 21-23, 0 weeks < $0 in the standard run), islandlab shots of t1-day and faults at 358px to confirm the island merged intact, lab check of ipc and logbook at tier 1 and tier 3 blind, pass-and-play e2e phone. Commit ("Merge island art and the IPC/logbook paperwork puzzles"). Return the final commit sha and what you resolved.`, { label: 'merge', phase: 'Merge', schema: MERGE_SCHEMA })
if (!merged || !merged.tscOk || !merged.testsOk) { log('merge failed: ' + JSON.stringify(merged).slice(0, 400)); return { stage: 'merge', merged } }
const BASE = merged.commit.slice(0, 12)
log('merged at ' + BASE + ' (' + (merged.testsTotal || '?') + ' tests)')

// ---------- Build ----------
const WT = (b) => `${MAIN}/.claude/worktrees/${b}`
const MKWT = (b) => `FIRST create your own worktree: git -C ${MAIN} worktree add -b ${b} ${WT(b)} ${BASE}  (if it exists, check it out at ${BASE}). Commit on branch ${b}.`

const CHAIN = `${ENV(WT('phaseb-chain'), 5194, 'chain')}
${MKWT('phaseb-chain')}

${FRIEND}

BUILD: the mechanic's manual -> IPC -> logbooks -> engineering approval -> install flow, as real game systems across all three players. Read src/sim/aircraft.ts (aircraftOf, ipcFor, ammTaskFor, torqueFor, rowFor, orderFor, findPart, searchLog, approvalBasis, reviewRequest, plants), the ipc and logbook puzzles, the consequences system (s.defects, DEFECT_RULES / BY_KIND / variants via data.defect, INSPECTS, REPORTS, repair->redo, blind sign-off) and the parts logistics (markApproved, s.parts stock/inTransit, buyList, cargo/guest-flight delivery, boat kit, 'waiting_part').

1. MANUAL: AMM task cards with serial-number effectivity.
 - Every mechanic job on a plane gets its task card from ammTaskFor(aircraftOf(seed, assetId, model), job). Show it in the order detail / start sheet as a 'Manual' section: the plane's data plate (registration, model, S/N, SBs complied with), task number, effectivity, warnings/cautions, steps, and torques/consumables with BOTH effectivities printed as the manual prints them. Tiers 0-2: the applicable line is marked. Tier 3+: not marked; matching S/N / SB status is the player's job.
 - The puzzles use the card: at minimum torque (target band = the applicable TorqueSpec for this job, e.g. tie nuts, prop bolts dry vs anti-seize) and hydraulics (fluid spec / accumulator precharge per the card); drive other spec values where the card has them. At tier 3+ the puzzle shows the values for both effectivities without saying which applies. Using the wrong one is a real miss: blind at tier >= 2, it becomes a hidden defect through the consequences system with a fitting DEFECT_RULES variant (e.g. 'torque:eff', torqued to the pre-SB value).
2. THE PART CHAIN ("if part is gone or missing or damaged").
 - Trigger: when the mechanic completes an eligible job on a plane (jobs that map to an ATA the aircraft module covers: 32-40 wheels/brakes, 61-10 prop, 29-10 hydraulic power, 23-10 com/nav, 24-30 alternator/starter-generator), from week 3 at island tier >= 2, a seeded roll (tune, start ~20%; at most one open chain on the island) finds a part gone, missing or damaged (name the real item from the IPC rows). The job is not finished: the original order is blocked with a visible chain stepper, and the plane is not airworthy (grounded, no flights) until the part is installed. That downtime is the pressure; tune so it matters without wrecking balance.
 - Step 1, mech: 'Look up <item> in the IPC: <reg> S/N <serial>' -> the ipc puzzle with this aircraft and ATA. Its result is the P/N ordered (right, wrong/not effective for this S/N, or 'not in the IPC: research the records'). Blind at tier >= 2.
 - Step 2, fin: purchase approval on the analyst's desk ('Buy <P/N> <nomenclature> for <reg>', a realistic price) through the existing approval + kit logistics, so the part arrives by the normal delivery.
 - If the plane carries a plant on that ATA (decide deterministically per plane from the island seed, e.g. about half the planes carry one plant on one ATA, via aircraftOf(..., {plant})), the right IPC outcome is 'not in the IPC'. Then Step 2', mech: 'Research <item> in <reg>'s logbooks' -> the logbook puzzle for the same aircraft (finds the STC / field approval / PMA basis and fills in the engineering request). Step 3', fin: approve the engineering review fee (realistic, a few hundred dollars). It takes a week: the answer arrives at the next resolve. Research wrong -> 'Engineering returned the request: <reason>' and a new research order. Approved -> Step 2 purchase of the right P/N.
 - Step 4, mech: once the part is in stock the original job is ready again as 'Install <P/N>, then finish <original task>'. Completing it completes the original job (its normal gain, no double pay).
 - Wrong answers surface later, never immediately: a P/N not effective for this S/N is caught at receiving/install ('P/N <x> is not effective for S/N <y>: returned, restocking fee $z') -> new IPC lookup. A part installed without a valid basis becomes a hidden defect through the consequences system ('unapproved part found at the annual' when inspected, or an incident). Only model what the puzzles can really tell.
 - Every player always knows whose move it is: chips like 'Waiting on <analyst name>: approve the part', 'Engineering review: answer next week', 'Part on the next cargo flight'. Feed and review lines tell the story ('The twin sat 2 weeks for a brake lining: STC SA0xxxx found in the logbooks, engineering approved week N'). ntfy pushes follow the existing pattern.
 - Paper-sim bots play the chain too (mech bot looks up/researches with its skill; fin bot approves), so balance measures it.
 - Update tests/catalog.test.ts for how ipc/logbook are launched. Optionally add one standalone ipc job if it is realistic.
3. BALANCE: three friends and all average reach tier 5 around week 21-23 with 0 weeks below $0 in the standard 30-seed run; solo/absent teams stay at tier 1. Also run the robust sweep and report it.
4. TESTS for every path: in-IPC, not-in-IPC -> research -> approval -> install, wrong P/N returned, engineering rejection -> re-research, grounded while open, week stamps, determinism, no chain in week 0/grace, old island docs without the new fields, card-driven torque/hydraulics values.
5. PLAY IT on a 390x844 phone in pass-and-play across the three seats (use the lab or a crafted save), screenshot every step, and fix anything unclear. Update docs/DECISIONS.md, docs/ONBOARDING.md (mechanic section) and README.
Commit. Return branch, worktree, commit, summary, howToPlay (how to reach a chain quickly for testing), balance tables, notDone.`

const GSE = `${ENV(WT('phaseb-gse'), 5195, 'gse')}
${MKWT('phaseb-gse')}

${FRIEND}

BUILD: interactive ground power carts for the mechanic, plus cross-trade reports for hydraulics and ground power. Read the gpu and hydraulics puzzles, the 'gpustart' and 'hydraulics' catalog jobs, REPORTS/ReportDef and the report machinery (cap/leak, comebacks), DEFECT_RULES (including the 'gpu:arc' and 'gpu:hot' variants), the ops panel (src/ui/ops.tsx), orders UI, and the island art (src/ui/island.tsx, src/ui/island/*.tsx, islandlab scenes; node budget: the beaten scene must stay <= 1500 SVG nodes).
1. STATE: s.gse carts: one at tier 1 (maybe a second at tier 3). Each has id, name, charge 0-100, wear 0-100 (hidden), hookedTo (asset id or null), charging (bool) and the last inspection result/week. Optional field; old islands get the default.
2. ACTIONS (mechanic; week-stamped via WEEK_BOUND where they touch the week's economics):
 - plug in to charge / unplug
 - hook up to a plane / unhook
 - inspect the cable, which reveals the wear band: good / insulation cracked near the plug / pins pitted and burnt
 A cart is either on its charger or powering an aircraft, never both. It charges during resolve only if the hangar has power (grid up or generator carrying), for a small electricity cost.
3. USE:
 - A gpustart job needs a cart hooked to that plane with enough charge; otherwise the card says 'Hook a charged cart up to <plane> first' and it can't start.
 - The gpu puzzle gets the cart state (context): low charge means the voltage visibly sags under the start load.
 - Each start drains charge and adds wear, more if the puzzle reports a live plug/unplug (data.defect 'arc' or its data).
 - Optional, only if simple: a small benefit for avionics work on a plane with a cart hooked up.
4. WEAR CONSEQUENCES (hidden until inspected):
 - At high wear an automatic report goes mech -> elec: 'GPU cart cable insulation is cracked at the plug'. The electrician fixes it with wireup (job 'gpuCable'), which resets wear. Its effect: no GPU starts until fixed.
 - Starting on a badly worn cable risks an arc: an incident through the existing 'gpu:arc' row (receptacle damage, health hit). Realistic: no immediate 'you were wrong', the consequence shows up.
5. UI:
 - Ops panel 'Ground power' card for the mechanic: a charge bar, state ('On charge' / 'Hooked to Twin N-12' / 'Parked'), cable condition as last inspected, and buttons (plug in, hook up to..., unhook, inspect). Other roles see it read-only. 44px targets on phones.
 - Island: draw the cart(s) on the apron near the stands in the island's art style: a small cart with a charge light (green / amber / red), a cable to the hangar outlet while charging, a cable to the plane when hooked. Tapping the cart on the island opens the same sheet (role=button, aria-label, keyboard). Add an islandlab scene with a hooked cart and one on charge.
 - The gpustart card shows the prerequisite.
6. CROSS-TRADE REPORTS: add to REPORTS so that across the new set all three trades both report and fix. The wording must be physically correct cause -> fix (earlier reviewers were strict). Suggested:
 - elec -> mech: 'Bucket truck boom creeps down: hydraulic leak at the lift cylinder'. Uses the hydraulics puzzle with a real vehicle scenario, job 'boom': add that variant to hydraulics.ts, with the truck's decal fluid (AW hydraulic oil, not aviation 5606), reservoir level and cylinder/hose.
 - fin -> mech: 'Company van brake pedal is soft'. Hydraulics, job 'van': a DOT 3/4 brake fluid system, where mineral 5606 in a DOT system ruins the seals. Adjust the existing vanWheel comment; keep vanWheel.
 - mech -> elec: the wear-driven GPU cable report above, plus 'Hangar 28 V ground power receptacle is dead' (meter or trace, job 'hangar').
 - mech -> fin: 'GPU starts never make it onto the charter invoices' (leak; invoice or variance).
 - Add another if needed to keep all 3 trades both reporting and fixing.
 Blind mode must work for the new variants (tests/blind.test.ts pattern).
7. Tests (engine, reports, variants, migration of old docs), balance (same targets: three friends & all average T5 ~wk 21-23, 0 weeks < $0; solo/absent stay T1; report the robust sweep too), and phone play: tap the cart on the island, the ops sheet, hook up, gpustart, the boom/van hydraulics variants in the lab. Take screenshots and look at them. Update docs/DECISIONS.md, docs/ONBOARDING.md and README.
Commit. Return branch, worktree, commit, summary, howToPlay, balance, notDone.`

phase('Build')
const builds = await parallel([
  () => agent(CHAIN, { label: 'build:chain', phase: 'Build', schema: BUILD_SCHEMA }),
  () => agent(GSE, { label: 'build:gse', phase: 'Build', schema: BUILD_SCHEMA }),
])
const [chain, gse] = builds
if (!chain || !gse) { log('a build failed: chain=' + !!chain + ' gse=' + !!gse); return { stage: 'build', merged, chain, gse } }
log('chain ' + chain.commit + ' tests ' + chain.testsOk + '; gse ' + gse.commit + ' tests ' + gse.testsOk)

// ---------- Integrate ----------
phase('Integrate')
const integ = await agent(`${ENV(INT, 5196, 'integrate')}

RESUMING AFTER A CONTAINER RESTART. A previous integrator was killed mid-task. Its state is on disk in ${INT}:
- Both merges are already committed: ce1fc4c (phaseb-chain) and 7d1ee49 (phaseb-gse).
- Its UNCOMMITTED work-in-progress on making them work together is in the worktree: modified bots.ts, econ.ts, engine.ts, gse.tsx, home.tsx, island.tsx, islandlab.tsx, select.ts, useIsland.ts, plus a new tests/chaingse.test.ts. A stray scratch file scripts/_explore.ts should be deleted.
- Do NOT reset or discard it. Read git diff first, keep what is right, finish what is missing, and fix what is wrong.
- Its dev server (port 5196) died with the container. If the port is busy, the holder is stale: check with ss/lsof before starting yours.

ORIGINAL TASK: merge phaseb-chain (${chain.commit}) and then phaseb-gse (${gse.commit}) into branch 'integrate' (currently ${BASE}) with --no-ff. Both touch engine.ts, types.ts, data.ts, select.ts, ops/orders UI, docs and tests; keep BOTH features whole. Then make them work together:
- The gpustart job's cart prerequisite and the part chain's grounded plane must not deadlock. For example, a chain on a plane that also needs a GPU start must still resolve.
- Cross-trade reports and chains count toward the same 'whose move is it' surfaces.
- The paper-sim bots handle both.

Builder notes:
- chain: ${chain.summary.slice(0, 1500)}
- chain notDone: ${JSON.stringify(chain.notDone).slice(0, 600)}
- gse: ${gse.summary.slice(0, 1500)}
- gse notDone: ${JSON.stringify(gse.notDone).slice(0, 600)}

Verify:
- tsc, vitest.
- Balance, standard and robust. Targets: three friends & all average T5 ~wk 21-23, 0 weeks < $0 in the standard run; solo/absent stay T1. Tune minimally and document it in DECISIONS.md if the combination breaks it.
- The pass-and-play e2e on phone and desktop.
- islandlab shots (t4-thriving, t5-night, faults, beaten) with the node count of the beaten scene (<= 1500).
- Commit "Integrate the part chain and ground power carts".

Return: commit, summary, testsOk/tscOk/testsTotal.`, { label: 'integrate', phase: 'Integrate', schema: MERGE_SCHEMA })
if (!integ || !integ.tscOk || !integ.testsOk) { log('integration failed'); return { stage: 'integrate', merged, chain, gse, integ } }
const HEAD = integ.commit.slice(0, 12)

// ---------- Review ----------
const REV = (port, tag) => `${ENV(INT, port, tag)}
You are a READ-ONLY reviewer of branch 'integrate' at ${HEAD} in ${INT}: do not edit, commit or stash anything there. You may write scratch files in ${OUT}/${tag}/.
What was built:
- chain: ${chain.summary.slice(0, 1200)}
  How to reach it: ${chain.howToPlay.slice(0, 600)}
- gse: ${gse.summary.slice(0, 1200)}
  How to reach it: ${gse.howToPlay.slice(0, 600)}
${FRIEND}
Report issues with severity (blocker = broken or unplayable, major = wrong or confusing enough that the friends would notice, minor = polish), each with a concrete fix. pass = no blocker or major.`

phase('Review')
const reviews = await parallel([
  () => agent(`${REV(5197, 'rev-ap')}
LENS: a senior A&P/IA with years on the line, and an FAA-literate electrician. Is this how the work really goes?
- AMM effectivity by S/N and SB status
- IPC columns, supersession, interchangeability codes, NP/next higher assembly
- the logbook research that finds STCs, field approvals (Form 337) or PMA
- engineering approval (DER / engineering disposition) and what it takes
- receiving inspection of parts
- GPU procedures: volts and current limit, battery master, never plug or unplug live, cable and pin inspection, arcing
- hydraulic fluids: 5606 vs 83282 vs Skydrol vs AW oil vs DOT 3/4, and what mixing does
- report wording: every cause -> fix physically right
Play the chain and the cart on the phone and read the text. Would the A&P friend respect it or roll his eyes? Does the analyst's part (approving parts and fees) make business sense?`, { label: 'review:a&p', phase: 'Review', schema: REVIEW_SCHEMA }),
  () => agent(`${REV(5198, 'rev-play')}
LENS: the three friends playing it.
- Play pass-and-play on a 390x844 phone across all three seats for several weeks. Follow a part chain start to finish.
- Use the ground power cart from the island tap and from the ops panel.
- Trigger and fix cross-trade reports in each direction.
- Check desktop 1280x820 too.
Judge: Is it always clear whose move it is and what to do next? Does anyone get gridlocked waiting? (The user wants everyone integral but NOT gridlocked.) Is it fun? Is it readable at 390px, with no overlaps, 44px targets and no dead ends? Does blind sign-off still feel fair? Does the island cart read? Take screenshots and look at them.`, { label: 'review:play', phase: 'Review', schema: REVIEW_SCHEMA }),
  () => agent(`${REV(5199, 'rev-sys')}
LENS: systems, code and balance.
- Engine determinism and purity.
- Week stamps and WEEK_BOUND for every new action, and the online multi-device model (Firestore transactions over one doc).
- Doc size growth: aircraft records must be derived, never stored.
- Migration: old live islands without the new fields must load, render and resolve. Write a quick test that takes an island state serialized by the pre-merge engine (git show 79f806b:island-company/src/sim/engine.ts shape: build one with the old code in a temp worktree, or strip the new fields) and runs apply/resolveWeek on it.
- Performance: aircraftOf ~3.7 ms, so it must be memoized and not rebuilt per render or per resolve loop.
- Test quality.
- Balance: run the standard and robust sweeps. The robust sweep had rare late-game (wk 24-26) grid+generator collapses below $0; judge whether the new systems make it worse and propose the smallest fix.
- Chain and report edge cases: two chains, a plane scrapped/AOG mid-chain, tier change, a player leaving their seat, week closing mid-puzzle.`, { label: 'review:systems', phase: 'Review', schema: REVIEW_SCHEMA }),
])
const issues = []
const names = ['a&p', 'play', 'systems']
reviews.forEach((r, i) => { if (r) r.issues.forEach((x) => issues.push({ lens: names[i], ...x })) })
const heavy = issues.filter((x) => x.severity !== 'minor')
log('reviews: ' + reviews.map((r, i) => names[i] + '=' + (r ? (r.pass ? 'pass' : 'fail') : 'died')).join(', ') + '; ' + heavy.length + ' blocker/major, ' + (issues.length - heavy.length) + ' minor')

// ---------- Fix ----------
const FIXP = (list, round, port) => `${ENV(INT, port, 'fix' + round)}
TASK: fix round ${round} on branch 'integrate' in ${INT}. Fix EVERY blocker and major below, and the cheap minors. Keep the balance targets: three friends & all average T5 ~wk 21-23, 0 weeks < $0 in the standard run; solo/absent stay T1. Verify each fix: tests, and the phone browser for UI. Run tsc, vitest, balance (standard + robust) and the pass-and-play e2e. Update the docs where behaviour changed. Commit "Phase B review fixes${round > 1 ? ' (round ' + round + ')' : ''}".
ISSUES (JSON):
${JSON.stringify(list, null, 1)}`

phase('Fix')
let fix = await agent(FIXP(issues, 1, 5200), { label: 'fix', phase: 'Fix', schema: FIX_SCHEMA })

// ---------- QA ----------
const QAP = (port) => `${ENV(INT, port, 'qa')}
TASK: final QA of branch 'integrate' in ${INT} before it deploys to the live game. Do not change game behaviour. You may fix only a failing check's trivial cause (a stale test expectation, a typo), and must commit any fix ("QA fixes").
Run and report each:
1. tsc and vitest (count).
2. npm run build (tsc + vite build).
3. Balance, standard and robust.
4. Pass-and-play e2e: phone and desktop.
5. The online e2e against the Firebase emulators, following the header of scripts/e2e-online.mjs:
 - npx --yes firebase-tools@15 emulators:start --only firestore,auth --project demo-island, run from island-company. If ports 8080/9099 are busy, check what holds them; never kill processes that are not yours.
 - A second Vite on port ${port + 1} with VITE_FB_API_KEY=demo-key VITE_FB_PROJECT_ID=demo-island VITE_FB_EMULATOR=127.0.0.1.
 - BASE=http://localhost:${port + 1} node scripts/e2e-online.mjs <out>.
 Stop the emulators and servers afterwards (by PID).
6. Migration: a state from the old engine (without consequences/chain/gse fields) loads and resolves. Point to or add the test.
7. islandlab shots of all scenes at phone width, plus the beaten-scene node count.
8. A scripted phone run of one full part chain (lookup -> purchase -> [research -> engineering approval] -> install) and one GPU cart hook-up -> gpustart, with screenshots.
Save everything under ${OUT}/qa/. ok = every check passes. List failures precisely.`
phase('QA')
let qa = await agent(QAP(5201), { label: 'qa', phase: 'QA', schema: QA_SCHEMA })
if (qa && !qa.ok) {
  log('QA failed: ' + qa.failures.join(' | ').slice(0, 500))
  phase('Fix')
  const fix2 = await agent(FIXP(qa.failures.map((f) => ({ severity: 'blocker', area: 'qa', problem: f, fix: 'make the check pass without weakening it' })), 2, 5203), { label: 'fix:qa', phase: 'Fix', schema: FIX_SCHEMA })
  phase('QA')
  qa = await agent(QAP(5204), { label: 'qa:2', phase: 'QA', schema: QA_SCHEMA })
  fix = { first: fix, second: fix2 }
}
return { base: BASE, merged, chain, gse, integ, reviews: { ap: reviews[0], play: reviews[1], systems: reviews[2] }, fix, qa }