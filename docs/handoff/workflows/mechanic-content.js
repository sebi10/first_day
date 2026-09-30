export const meta = {
  name: 'mechanic-content',
  description: 'Crack-hunt one-tap controls, new hydraulic servicing and ground power cart puzzles, reviewed and integrated',
  phases: [
    { title: 'Build', detail: 'one builder per item, each in its own worktree with its own lab server' },
    { title: 'Review', detail: 'per item: an A&P domain reviewer and a playtest/code reviewer' },
    { title: 'Fix', detail: 'a fixer per item when reviewers raise blockers or majors' },
    { title: 'Integrate', detail: 'merge all three, wire the new puzzles into the catalog, test everything' },
  ],
}

const SP = '/tmp/claude-0/-home-user-first-day/fbc0a559-d1ad-537c-84ea-3d4f56ea63a5/scratchpad'
const MAIN = '/home/user/first_day/island-company'
const BASE = '6f041f2'
const OUT = `${SP}/mech`

const GAME = `PROJECT: "Island Company", a Preact + TypeScript PWA (Vite) co-op game for three real friends on their phones: a real A&P mechanic, a real residential electrician and a real FP&A analyst. Each trade's jobs are small puzzles modelled on the REAL procedure, so that real-world know-how is what makes a player good at their own trade (and bad at the others'). Tiers 0-2 teach (hints, labels, sequence numbers); from tier 3 the scaffolding is gone and only real knowledge solves it. Tools unlocked by level give convenience or raw readings, never the answer. Puzzles must be FUN on a phone: fast to understand, satisfying feedback, 40-120 s, thumb-friendly targets (>= 44 px), readable at 390 px wide.

PUZZLE CONTRACT (read island-company/src/puzzles/types.ts, kit.ts and two examples: torque.ts and teardown.ts, plus their tests tests/torque.test.ts and tests/puzzles.test.ts):
- A puzzle module exports a PuzzleDef named after its id: { id, role: 'mech', title, gesture, howTo, term, seconds(tier), mount(host, params) }. mount returns { timeUp(): PuzzleResult, destroy() }.
- Export a pure generateX(seed, tier, tools) model and a pure scoreX(...) so tests can check the rules without a browser. Deterministic from the seed (src/sim/rng.ts).
- Finish with settle(host, result, ms) from kit.ts (it locks the result before the finish animation). Use result() from types.ts; PASS = 0.6, PERFECT = 0.95. Use host.fx (tap/good/bad/snap/fault/flourish), host.status(text), host.paused(). Use kit's stage(), loop(), pointer(), label(), fitLabel(), roundRect() and the C palette so it matches the other puzzles.
- The puzzle lab loads any puzzle by file name: /lab.html?p=<id>&tier=<n>&seed=<n>&notimer=1 (window.__lab exposes timeUp and the result).
- Add your id to the PuzzleId union in src/puzzles/types.ts and your entry to src/puzzles/index.ts (the integrator will merge these). Do not edit the game catalog (src/sim/data.ts) or anything else outside your own puzzle and its test; the integrator wires the catalog.
- cd island-company && npx tsc --noEmit && npx vitest run must pass.`

const SETUP = (key, port) => `SETUP (you are in a fresh git worktree; it starts on the repo's default branch, which does not contain the game):
1. From the worktree root: git checkout -B mech-${key} ${BASE}
2. mkdir -p ${OUT}/${key} && ln -s ${MAIN}/node_modules island-company/node_modules
3. Dev server (never touch ports 5173/5174): cd island-company && VITE_CACHE_DIR=${OUT}/${key}/vite-cache nohup npx vite --port ${port} --strictPort > ${OUT}/${key}/vite.log 2>&1 &
4. Screenshot and play the puzzle in the lab with Playwright (import from '${MAIN}/node_modules/playwright-core/index.mjs', chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }), a 390x844 phone viewport with deviceScaleFactor 2, hasTouch, isMobile). Drive real pointer gestures (page.mouse / touchscreen), LOOK at screenshots with the Read tool, and play it at tiers 1, 3 and 5 like a player would.
FINISH: stop your dev server; commit on branch mech-${key} (do not push); return the structured result.`

const ITEMS = [
  {
    key: 'crack', port: 5186, name: 'Crack hunt: one-tap controls',
    brief: `Rework src/puzzles/crack.ts ("Crack hunt", fluorescent penetrant inspection). The owner's complaint: "fix crack finding controls (one click only to find ideally)".
Current scheme (the problem): you drag a small UV spotlight drawn 64 px above your finger; glows fade 1.2-1.6 s after the light leaves; tagging is a separate quick tap placed at your FINGER, not at the light. So you sweep, lift, and tap from memory. It is tedious and imprecise.
New scheme, matching the real booth: the whole part is under the UV lamp (no dragging to find things). ONE TAP on an indication tags it (tap it again to untag); the tag snaps to the nearest indication within a generous radius (about 28 px) so one tap is enough, while a tap on bare metal is a false call. The skill moves to telling relevant indications (cracks: at stress risers such as fastener holes, fillet radii and edges; jagged; they BLEED, growing and re-bleeding) from non-relevant ones (scratches: straight, crisp, don't bleed; porosity dots; excess-penetrant smears at edges). Add a "Wipe" action (a thumb-zone button): a solvent wipe clears the surface, then real cracks bleed back within 1-2 s and surface residue doesn't; that is the real technique for sorting indications. Tiers: 0-2 clear indications and a hint about bleed-back; 3+ fainter indications, more decoys, no hints; the 'borescope' tool (really "Non-aqueous developer") makes bleed-back faster and brighter; 'uvPlus' makes indications brighter. Keep the part variants (the job-driven spar/hub/wheel-half choice, context.job) and the sign-off. Keep generateCrack/scoreCrack exported (update the scoring to one-tap tags); update and extend its tests (tests/puzzles.test.ts has crack cases; keep "no answer-revealing hints at tier 3+").`,
  },
  {
    key: 'hydraulics', port: 5187, name: 'Hydraulic servicing (new puzzle)',
    brief: `Build a NEW mechanic puzzle, id 'hydraulics', title "Hydraulic servicing", file src/puzzles/hydraulics.ts, test tests/hydraulics.test.ts. The owner asked to "add hydraulic servicing". Model the real task on a light twin / cargo single (brake and gear hydraulics):
- Read the servicing placard: the fluid spec (MIL-PRF-5606, red, mineral base, is the norm for light aircraft; MIL-PRF-83282 is a compatible synthetic hydrocarbon substitute where the placard allows it; phosphate-ester fluid such as Skydrol, purple, is for transport category and must NEVER go into a 5606 system: it destroys Buna-N seals). Picking the wrong can is a serious fault.
- Relieve system pressure first (discharge the accumulator / pump the brakes down) before reading the reservoir sight gauge; a level read under pressure is wrong.
- Fill to the FULL mark for the stated condition; overfilling is a fault (it spills when the system warms); underfilling is a fault.
- Tier 3+: check the accumulator nitrogen precharge on its gauge with hydraulic pressure at zero, correct it for ramp temperature (charge pressure is specified at a reference temperature, e.g. 800 psi at 70 °F; scale by absolute temperature, Rankine), and add nitrogen (never shop air or oxygen) or bleed it to within tolerance.
- Tier 4-5: bleed the brakes: open the bleeder, pump, watch bubbles in the clear hose, close when the fluid runs clear, without letting the reservoir run dry.
Tiers 0-2 show the placard's meaning and step order; 3+ show only what a mechanic would actually see (spec numbers, gauges, placard text), no hints. Make it tactile and fun: tilt/pour the can, press to pump, a sight glass that fills, bubbles you can see, a nitrogen valve you hold to add. Score for correctness of the procedure and precision; a contamination (wrong fluid) caps the score below a pass.`,
  },
  {
    key: 'gpu', port: 5188, name: 'Ground power cart (new puzzle)',
    brief: `Build a NEW mechanic puzzle, id 'gpu', title "Ground power start", file src/puzzles/gpu.ts, test tests/gpu.test.ts. The owner asked to "add ground power carts". Model a real GPU (ground power unit) start of a light twin / turbine cargo single:
- The aircraft's external power placard gives the system voltage (28 V DC for 24 V battery systems, 14 V for older 12 V systems) and, for a turbine start, a current limit (e.g. 800-1000 A). Set the cart's output voltage to match; 28 V into a 14 V system (or the reverse, which will not start it) is a fault.
- Sequence (typical AFM): avionics master OFF before connecting and during start (voltage transients damage avionics); battery master ON where the aircraft needs it to close the external power relay (the placard says); plug in (keyed plug, check it is fully seated); cart ON; verify bus voltage on the aircraft voltmeter; start; after start: cart OFF, then unplug, then generator/alternator ON, then avionics ON. Unplugging while the cart is ON arcs the pins.
- Turbine (tier 4-5): watch ITT/ITT-like temperature and N1 during the start; too little current = a slow, hot (hung) start, so you must abort (fuel off) if temperature runs toward the limit.
Tiers 0-2 show a checklist; 3+ no checklist (from memory, as on the ramp). Make it tactile: a cart with a voltage dial and a current-limit knob, a heavy cable you drag to the aircraft's receptacle, cockpit switches that flip, a voltmeter needle, an engine that spools. Score the sequence, the settings and the start; a fault (wrong voltage, avionics on during start, hot start not aborted) caps the score.`,
  },
]

const BUILD_SCHEMA = {
  type: 'object',
  properties: {
    worktreePath: { type: 'string' }, branch: { type: 'string' }, commit: { type: 'string' },
    shotsDir: { type: 'string' }, summary: { type: 'string' }, howToPlay: { type: 'string' },
    tscOk: { type: 'boolean' }, testsOk: { type: 'boolean' }, testsAdded: { type: 'number' },
    openIssues: { type: 'array', items: { type: 'string' } },
  },
  required: ['worktreePath', 'branch', 'commit', 'shotsDir', 'summary', 'howToPlay', 'tscOk', 'testsOk', 'testsAdded', 'openIssues'],
}
const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    issues: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, problem: { type: 'string' }, fix: { type: 'string' } }, required: ['severity', 'problem', 'fix'] } },
    notes: { type: 'string' },
  },
  required: ['pass', 'issues', 'notes'],
}
const FIX_SCHEMA = {
  type: 'object',
  properties: { commit: { type: 'string' }, fixed: { type: 'array', items: { type: 'string' } }, notFixed: { type: 'array', items: { type: 'string' } }, tscOk: { type: 'boolean' }, testsOk: { type: 'boolean' } },
  required: ['commit', 'fixed', 'notFixed', 'tscOk', 'testsOk'],
}

const results = await pipeline(
  ITEMS,
  (it) => agent(`${GAME}

YOUR TASK: ${it.name}
${it.brief}

${SETUP(it.key, it.port)}
Put screenshots in ${OUT}/${it.key}/shots. Iterate until it is accurate, fun and clean on a phone (at least 3 play-and-look rounds).`, { label: `build:${it.key}`, phase: 'Build', schema: BUILD_SCHEMA, isolation: 'worktree' }),
  async (b, it) => {
    if (!b) return null
    const where = `The work is in worktree ${b.worktreePath} on branch ${b.branch} (base ${BASE}); see \`git -C ${b.worktreePath} diff ${BASE}\`. Screenshots: ${b.shotsDir}. Builder's summary: ${b.summary}. How to play: ${b.howToPlay}. You can run its lab: cd ${b.worktreePath}/island-company && VITE_CACHE_DIR=${OUT}/${it.key}/vite-cache-rev nohup npx vite --port ${it.port + 10} --strictPort > ${OUT}/${it.key}/rev.log 2>&1 &  then open http://localhost:${it.port + 10}/lab.html?p=${it.key}&tier=<1|3|5>&seed=<n>&notimer=1 with Playwright (import from '${MAIN}/node_modules/playwright-core/index.mjs', executablePath '/opt/pw-browsers/chromium', 390x844 phone, deviceScaleFactor 2). Stop any server you start.`
    const [domain, play] = await parallel([
      () => agent(`You are a senior A&P mechanic (airframe and powerplant, 20 years on light twins and turbine singles) reviewing a phone-game puzzle meant to feel like the real job to a real A&P. ${GAME}

ITEM: ${it.name}
${it.brief}

${where}

Read the puzzle code and its tests, and look at the screenshots. Judge technical accuracy against real maintenance practice (procedure order, the right numbers and units, what really goes wrong and why), whether tiers 3+ truly require real knowledge with no answer-revealing hints, and whether anything would make a real mechanic roll their eyes. pass = no blocker or major issue.`, { label: `a&p:${it.key}`, phase: 'Review', schema: REVIEW_SCHEMA }),
      () => agent(`You are a mobile game designer and senior front-end reviewer. ${GAME}

ITEM: ${it.name}
${it.brief}

${where}

PLAY it in the lab on a phone viewport at tiers 1, 3 and 5 (drive real pointer gestures with Playwright and look at screenshots with the Read tool): is it immediately understandable, thumb-friendly, satisfying, free of layout overlaps and dead ends, and can a correct play reach PERFECT and a sloppy play fail? For the crack item specifically: can a player find and tag an indication with a single tap? Then review the code: contract (settle, timeUp returns a locked result, destroy cleans up listeners and loops, deterministic generate/score), tests (meaningful, including tier 3+ scaffolding removal), tsc and vitest (run them). pass = no blocker or major issue.`, { label: `play:${it.key}`, phase: 'Review', schema: REVIEW_SCHEMA }),
    ])
    const issues = [...(domain ? domain.issues : []), ...(play ? play.issues : [])]
    const needsFix = issues.some((x) => x.severity !== 'minor') || !(domain && domain.pass) || !(play && play.pass)
    let fix = null
    if (needsFix) {
      fix = await agent(`${GAME}

You are continuing ${it.name} in the existing worktree ${b.worktreePath} (branch ${b.branch}). Work there directly (cd ${b.worktreePath}); do not create a new worktree or branch.
${it.brief}

Reviewers (a senior A&P mechanic and a mobile game designer/code reviewer) raised:
${JSON.stringify(issues, null, 1)}

Fix every blocker and major issue and as many minor ones as sensible, without regressing anything. Verify by playing it in the lab: cd island-company && VITE_CACHE_DIR=${OUT}/${it.key}/vite-cache nohup npx vite --port ${it.port} --strictPort > ${OUT}/${it.key}/fix.log 2>&1 & (Playwright: import from '${MAIN}/node_modules/playwright-core/index.mjs', executablePath '/opt/pw-browsers/chromium', 390x844 phone). Run tsc and vitest, stop your server, commit on ${b.branch} ("${it.key}: review fixes"), do not push.`, { label: `fix:${it.key}`, phase: 'Fix', schema: FIX_SCHEMA })
    }
    return { key: it.key, name: it.name, build: b, domain, play, fix, commit: fix ? fix.commit : b.commit }
  },
)

const done = results.filter(Boolean)
const missing = ITEMS.filter((i) => !done.some((d) => d.key === i.key)).map((i) => i.key)
if (missing.length) log(`items that failed to build: ${missing.join(', ')}`)
if (!done.length) return { error: 'nothing built', missing }

phase('Integrate')
const INTEGRATE_SCHEMA = {
  type: 'object',
  properties: {
    worktreePath: { type: 'string' }, branch: { type: 'string' }, commit: { type: 'string' },
    catalogChanges: { type: 'array', items: { type: 'string' } },
    tscOk: { type: 'boolean' }, testsOk: { type: 'boolean' }, testsTotal: { type: 'number' }, e2eOk: { type: 'boolean' },
    balance: { type: 'string', description: 'the paper-sim table after the catalog changes' },
    notes: { type: 'string' },
  },
  required: ['worktreePath', 'branch', 'commit', 'catalogChanges', 'tscOk', 'testsOk', 'testsTotal', 'e2eOk', 'balance', 'notes'],
}
const integ = await agent(`${GAME}

INTEGRATE these finished branches into one branch and wire the new puzzles into the game:
${done.map((d) => `- ${d.name}: branch ${d.build.branch} at ${d.commit} (worktree ${d.build.worktreePath})`).join('\n')}

SETUP: you are in a fresh worktree (it starts on the default branch). Run: git checkout -B mech-integrated ${BASE} && ln -s ${MAIN}/node_modules island-company/node_modules, then merge each branch above (git merge --no-ff <branch>; resolve the expected conflicts in src/puzzles/types.ts and src/puzzles/index.ts by keeping every puzzle).

WIRE INTO THE GAME (read src/sim/data.ts CATALOG, TOOLS, PROJECTS; src/sim/engine.ts order generation; src/ui/select.ts launchFor):
- Add mechanic catalog jobs that use the new puzzles, realistic and sensibly weighted against the existing ones: e.g. 'hydraulics' ("Service the brake hydraulics") on twin/cargo/float, and 'gpustart' ("Ground power start: weak battery", no parts, low cost) on twin/cargo. Pick tiers, costs, parts, gains and weights that fit the existing catalog; keep total order volume roughly unchanged (the economy has thin margins at tier 4).
- Make sure launchFor passes whatever context the new puzzles need (e.g. aircraft model/placard via context.job or assetName), and that the puzzle host, week-0 practice and the Board's weekly challenge can all launch them if they pick puzzles generically.
- Run the paper sim (cd island-company && npx tsx scripts/balance.ts) before and after; the "three friends" and "all average" teams must still reach tier 5 by week ~22 with zero negative-cash weeks and solo teams must stay at tier 1. Report the table.
- Update README.md's puzzle list and docs/ONBOARDING.md's "Your jobs (puzzles)" row for the mechanic (now 7 puzzle types: add hydraulic servicing and ground power start; say crack hunt is one-tap).
- Verify: npx tsc --noEmit, npx vitest run, and the pass-and-play e2e (start a dev server on port 5189 with VITE_CACHE_DIR=${OUT}/integ-cache, then BASE=http://localhost:5189 node scripts/e2e.mjs ${OUT}/e2e) must pass with no console errors. Stop the server.
Commit on mech-integrated (do not push) and return the result.`, { label: 'integrate', phase: 'Integrate', schema: INTEGRATE_SCHEMA, isolation: 'worktree' })

return {
  items: done.map((d) => ({ key: d.key, name: d.name, commit: d.commit, summary: d.build.summary, howToPlay: d.build.howToPlay, domainPass: d.domain && d.domain.pass, domainIssues: d.domain && d.domain.issues, playPass: d.play && d.play.pass, playIssues: d.play && d.play.issues, fixed: d.fix && d.fix.fixed, notFixed: d.fix && d.fix.notFixed })),
  missing,
  integration: integ,
}
