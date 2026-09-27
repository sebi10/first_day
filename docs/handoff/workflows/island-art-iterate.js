export const meta = {
  name: 'island-final-a-style-b-shape',
  description: 'Build the chosen island: design A\'s style on design B\'s island shape, then critique-and-fix rounds until art, legibility and code pass',
  phases: [
    { title: 'Build', detail: 'one builder: A\'s art rebuilt on B\'s coastline, zones re-placed, judges\' fix list applied' },
    { title: 'Review', detail: 'each round: art critic, fresh blind legibility test (scored in code), code reviewer' },
    { title: 'Fix', detail: 'a fixer addresses every issue from the round; loop until all pass (max 3 rounds)' },
  ],
}

const SP = '/tmp/claude-0/-home-user-first-day/fbc0a559-d1ad-537c-84ea-3d4f56ea63a5/scratchpad'
const MAIN = '/home/user/first_day/island-company'
const BASE_SHA = '3bcf538'
const A_COMMIT = '33485f8'
const A_WT = '/home/user/first_day/.claude/worktrees/wf_ac1eaef8-80e-1'
const B_WT = '/home/user/first_day/.claude/worktrees/wf_ac1eaef8-80e-2'
const OUT = `${SP}/island-final`
const PORT = 5185

const REFERENCE = `The owner's reference: a lush, cartoony mobile-game island map in a top-down 3/4 view. Vivid blue sea with ripples; a bright turquoise shallows band with foam on every coast; clouds framing two corners; sea life. An organic lobed coastline with bays and peninsulas and a pale-sand rim; a bright grass plateau stepping down with a darker lip; warm dirt paths; a blue river with plank bridges running from a rocky peak (chunky faceted boulders, a waterfall) to the sea. Chunky palms, round trees, flower clusters. Small chunky colourful buildings with character, wooden docks, props and tiny people. Flat cel-shaded vector with 2-3 tones per object, no heavy outlines, saturated and cheerful. It should look like a finished commercial mobile game.`

const CHOICE = `THE OWNER'S CHOICE, after seeing three candidate designs side by side: "I like A but B's island shape".
- Design A ("Terrain and water first"): commit ${A_COMMIT} on branch island-terrain; worktree ${A_WT}; final screenshots ${SP}/island-ref/terrain/final/ (phone-<scene>.png, desk-<scene>.png). Keep A's LOOK: its sea with a radial gradient, ripples and caustics; the layered turquoise shallows and white surf line; wet-sand edge; its grass and rock rendering, its peak with the waterfall, its trees, buildings, bubbles and palette.
- Design B ("Buildings and island life first"): commit 39647e6 on branch island-charm; worktree ${B_WT} (its island code is in island-company/src/ui/island/, the coastline and positions are in geo.ts; IGNORE its later commit 0f2f97f, a duplicate message board). Final screenshots ${SP}/island-ref/charm/final/. Take B's ISLAND SHAPE: its coastline silhouette (lobes, the sheltered lagoon/bay, headlands, where the peak sits at the back, the river's course down the middle) and the broad arrangement of zones that shape implies (airfield plain and hangar on the west side with the large apron, town square in the middle, cottages east of the river, peak at the back). Use B's spread() bubble-relaxation idea too.
The result must read, at a glance, as "A's art" drawn on "B's island".`

const FIXES = `FIX LIST from the judges and the blind legibility test of design A (address all of it):
1. Faults must change the ART, not only the bubbles: a red-tagged cottage gets a red tag/tape on its door; a damaged cottage (health < 40) looks damaged (broken shutter, patched roof) and one under 30 shows smoke; an inspection-lapsed cottage gets a notice board/closed sign; no-power houses have dark windows. Grid down must be visible on the grid itself (dark/sagging lines, a spark or a broken pole), and "generator carrying" must be obvious (exhaust puffs plus a small bubble or light on the generator house). The blind tester could not tell grid-down or generator-running.
2. Bubbles: never cover the asset they refer to (sit above it with a pointer), never overlap each other (add a relaxation/spread pass, as in B), one consistent pictogram style (the "$!" cash bubble must be a pictogram like the rest), and never cover runway markings.
3. Three AOG planes at tier 4+ overlap on the apron (AOG_SPOTS): give every possible AOG plane its own spot and run the overlap avoidance.
4. Night is low-contrast and muddy: grade it properly (cool blue shadows, keep terrain and buildings separable, rim light on edges, warm window glow, stars, moon reflection on the water), not a flat wash.
5. Storm is a uniform grey overlay: make it stormy (darker sky toward the edges, varied heavier rain, whitecaps, palms leaning, clouds as real cloud shapes), while the island stays readable.
6. The lodge looks pasted onto a grey cliff and the two villas crowd a coastline: place them properly on the new shape (lodge on high ground with a terrace, villas on a headland with room).
7. The town plaza looks sparse/unfinished and build plots look like bald khaki patches: make the square feel intentional (paving pattern, planters) and build sites read as tidy surveyed plots (stakes, string lines, a small sign).
8. Paved paths and the square must be driven by developmentOf(s).flourishes including 'paved-paths', not by tier directly.
9. aria-label must also mention construction under way and what the island has developed.
10. Keep <= ~1500 SVG nodes in the "beaten" scene; memoize the static defs/life layers as well as terrain.`

const CONTRACT = `CONTRACT (unchanged from the design round; read ${MAIN}/src/islandlab.tsx and ${MAIN}/src/sim/growth.ts):
- Files you own: island-company/src/ui/island.tsx (must export Island and phaseOf, same props), island-company/src/ui/island/* helpers, and the island section of island-company/src/styles.css ("/* island */" through the island keyframes and the ".still" rule). Edit nothing else.
- Keep the idle/visibility pause (useStill, .still with animation-play-state: paused, pauseAnimations for SMIL) and reduceMotion = no animation. Only CSS keyframes on transform/opacity; never a CSS transform animation on an element that has a transform attribute. No SVG filters beyond one cheap blur.
- Zoom per role (mech: hangar/runway/planes; elec: cottages/grid/generator; fin: office) via a CSS transform + transition on the island-zoom group, framing each zone well on the NEW shape.
- Every asset id at every tier (p1 p2 p3, h1-h7, g1, gen), every status predicate (AOG < 40, grounded = s.tags, warning < 60; houseRentable/houseBlocker reasons; powered(s).gridDown / genOK / on; cash < 2000; weather; phase; runway lights at tier 5 night), cosmetic tints (hangar = mech, houses = elec, office awning = fin), and every developmentOf(s) flourish + construction stage + prosperity + care + justBuilt + celebration drawn without collisions.
- cd island-company && npx tsc --noEmit && npx vitest run must pass.`

const SCENES = 't1-day, t1-dawn, t2-golden, t3-storm, t4-wind, t5-day, t5-night, faults, lapsed, zoom-mech, zoom-elec, zoom-fin, dev-fresh, dev-settled, project, just-built, t4-thriving, weathered, beaten'

const SERVER = (wt) => `Dev server for screenshots (port ${PORT}; if the port is busy, kill whatever vite you started earlier on it, never touch 5173/5174): cd ${wt}/island-company && VITE_CACHE_DIR=${OUT}/vite-cache nohup npx vite --port ${PORT} --strictPort > ${OUT}/vite.log 2>&1 &   then: cd ${wt}/island-company && BASE=http://localhost:${PORT} node scripts/island-shots.mjs <dir>   (writes phone-<scene>.png and desk-<scene>.png for 19 scenes and prints SVG node counts). If Vite refuses to serve the font from the symlinked node_modules, that 403 is a worktree artifact; ignore it.`

const BUILD_SCHEMA = {
  type: 'object',
  properties: {
    worktreePath: { type: 'string' }, branch: { type: 'string' }, commit: { type: 'string' },
    shotsDir: { type: 'string', description: 'directory with the final phone-*.png / desk-*.png' },
    summary: { type: 'string' }, nodesBeaten: { type: 'number' }, tscOk: { type: 'boolean' }, testsOk: { type: 'boolean' },
    fixListStatus: { type: 'array', items: { type: 'string' }, description: 'one line per fix-list item: done / how' },
    openIssues: { type: 'array', items: { type: 'string' } },
  },
  required: ['worktreePath', 'branch', 'commit', 'shotsDir', 'summary', 'nodesBeaten', 'tscOk', 'testsOk', 'fixListStatus', 'openIssues'],
}

phase('Build')
const build = await agent(`${REFERENCE}

${CHOICE}

${FIXES}

${CONTRACT}

SETUP (you are in a fresh git worktree; it starts on the repo's default branch, which does not contain the game):
1. From the worktree root: git checkout -B island-final ${BASE_SHA} && git cherry-pick ${A_COMMIT}   (the shared object store has both; this is the current game with design A's island applied).
2. mkdir -p ${OUT}/r0 && ln -s ${MAIN}/node_modules island-company/node_modules
3. ${SERVER('<your worktree>')}

PROCESS:
- Study A's code (now in your tree) and B's shape: read ${B_WT}/island-company/src/ui/island/geo.ts and B's terrain.tsx, and LOOK at B's and A's final screenshots with the Read tool (phone-t1-day, phone-t5-day, phone-t5-night, phone-faults, phone-beaten, desk-t5-day at least).
- Plan the new layout on B's silhouette: where every tier's assets, every flourish and every build site sit, so tier 1 looks complete and the beaten scene is rich but uncluttered. Then rebuild A's terrain layers on B's coastline and move every placement.
- Work through the FIX LIST.
- Screenshot all scenes to ${OUT}/r<N> after each major step and LOOK at them (phone and desktop) with the Read tool; do at least 4 review-fix rounds as a harsh art director. Compare side by side with A's and B's finals: the look must be A's, the silhouette B's.
- Finish: final screenshots in ${OUT}/final; tsc + vitest; stop your dev server; commit on branch island-final (git add -A && git commit -m "Island art: design A on design B's island shape"); do not push. Return the result.`, { label: 'build', phase: 'Build', schema: BUILD_SCHEMA, isolation: 'worktree' })

if (!build) return { error: 'builder failed' }
const WT = build.worktreePath
log(`built on ${build.branch} ${build.commit}; beaten scene ${build.nodesBeaten} nodes`)

const SCN = ['faults', 'lapsed', 't5-night', 't3-storm']
const YNU = ['yes', 'no', 'unclear']
const BLIND_SCHEMA = {
  type: 'object',
  properties: {
    scenes: { type: 'array', items: { type: 'object', properties: {
      scene: { type: 'string', enum: SCN },
      timeOfDay: { type: 'string', enum: ['dawn', 'day', 'golden', 'night', 'unclear'] },
      weather: { type: 'string', enum: ['clear', 'wind', 'storm', 'unclear'] },
      planes: { type: 'array', items: { type: 'object', properties: { which: { type: 'string' }, status: { type: 'string', enum: ['ok', 'warning', 'aog', 'grounded', 'unclear'] } }, required: ['which', 'status'] } },
      houses: { type: 'array', items: { type: 'object', properties: { which: { type: 'string' }, status: { type: 'string', enum: ['open', 'closed', 'unclear'] }, reason: { type: 'string', enum: ['redtag', 'low-reliability', 'inspection', 'no-power', 'none', 'unclear'] }, smoke: { type: 'boolean' } }, required: ['which', 'status', 'reason', 'smoke'] } },
      gridDown: { type: 'string', enum: YNU }, generatorRunning: { type: 'string', enum: YNU }, cashAlarm: { type: 'string', enum: YNU }, futureBuildSites: { type: 'string', enum: YNU },
      confusing: { type: 'array', items: { type: 'string' } }, ugly: { type: 'array', items: { type: 'string' } },
    }, required: ['scene', 'timeOfDay', 'weather', 'planes', 'houses', 'gridDown', 'generatorRunning', 'cashAlarm', 'futureBuildSites', 'confusing', 'ugly'] } },
    overallImpression: { type: 'string' },
  },
  required: ['scenes', 'overallImpression'],
}
const TRUTH = {
  faults: { time: 'day', weather: 'clear', planes: { aog: 1, grounded: 1 }, housesClosed: 2, reasons: ['redtag', 'low-reliability'], smoke: 1, gridDown: 'yes', gen: 'yes', cash: 'yes', future: 'yes', houses: 4, planeCount: 2 },
  lapsed: { time: 'day', weather: 'clear', planes: { warning: 1, ok: 1 }, housesClosed: 1, reasons: ['inspection'], smoke: 0, gridDown: 'no', gen: 'no', cash: 'no', future: 'yes', houses: 4, planeCount: 2 },
  't5-night': { time: 'night', weather: 'clear', planes: { ok: 3 }, housesClosed: 0, reasons: [], smoke: 0, gridDown: 'no', gen: 'no', cash: 'no', future: 'no', houses: 7, planeCount: 3 },
  't3-storm': { time: 'day', weather: 'storm', planes: { ok: 2 }, housesClosed: 0, reasons: [], smoke: 0, gridDown: 'no', gen: 'no', cash: 'no', future: 'yes', houses: 4, planeCount: 2 },
}
function scoreBlind(b) {
  let pts = 0, max = 0
  const notes = []
  for (const sc of (b && b.scenes) || []) {
    const t = TRUTH[sc.scene]
    if (!t) continue
    const chk = (ok, what, w = 1) => { max += w; if (ok) pts += w; else notes.push(`${sc.scene}: missed ${what}`) }
    chk(sc.timeOfDay === t.time, `time (${t.time}, saw ${sc.timeOfDay})`)
    chk(sc.weather === t.weather, `weather (${t.weather}, saw ${sc.weather})`)
    const pc = {}
    for (const p of sc.planes) pc[p.status] = (pc[p.status] || 0) + 1
    for (const [st, n] of Object.entries(t.planes)) chk((pc[st] || 0) === n, `${n} plane(s) ${st} (saw ${pc[st] || 0})`, 2)
    chk(sc.planes.length === t.planeCount, `plane count ${t.planeCount} (saw ${sc.planes.length})`)
    const closed = sc.houses.filter((h) => h.status === 'closed')
    chk(closed.length === t.housesClosed, `${t.housesClosed} closed house(s) (saw ${closed.length})`, 2)
    for (const r of t.reasons) chk(closed.some((h) => h.reason === r), `closed reason ${r}`, 2)
    chk(sc.houses.filter((h) => h.smoke).length === t.smoke, `smoke on ${t.smoke} house(s)`)
    chk(sc.houses.length === t.houses, `house count ${t.houses} (saw ${sc.houses.length})`)
    chk(sc.gridDown === t.gridDown, `grid down=${t.gridDown} (saw ${sc.gridDown})`, 2)
    chk(sc.generatorRunning === t.gen, `generator running=${t.gen} (saw ${sc.generatorRunning})`)
    chk(sc.cashAlarm === t.cash, `cash alarm=${t.cash} (saw ${sc.cashAlarm})`, 2)
    chk(sc.futureBuildSites === t.future, `future sites=${t.future} (saw ${sc.futureBuildSites})`)
  }
  return { pct: max ? Math.round((100 * pts) / max) : 0, pts, max, missed: notes }
}

const ART_SCHEMA = {
  type: 'object',
  properties: {
    pass: { type: 'boolean', description: 'true only if it clearly reads as A\'s art on B\'s island shape, matches the reference, and has no issue a player would notice' },
    styleFidelityToA: { type: 'number' }, shapeFidelityToB: { type: 'number' }, polish: { type: 'number' }, nightAndStorm: { type: 'number' }, growth: { type: 'number' },
    issues: { type: 'array', items: { type: 'object', properties: { scene: { type: 'string' }, where: { type: 'string' }, problem: { type: 'string' }, fix: { type: 'string' }, severity: { type: 'string', enum: ['blocker', 'major', 'minor'] } }, required: ['scene', 'where', 'problem', 'fix', 'severity'] } },
  },
  required: ['pass', 'styleFidelityToA', 'shapeFidelityToB', 'polish', 'nightAndStorm', 'growth', 'issues'],
}
const TECH_SCHEMA = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    fixListItems: { type: 'array', items: { type: 'object', properties: { item: { type: 'number' }, done: { type: 'boolean' }, note: { type: 'string' } }, required: ['item', 'done', 'note'] } },
    issues: { type: 'array', items: { type: 'object', properties: { file: { type: 'string' }, problem: { type: 'string' }, fix: { type: 'string' }, severity: { type: 'string', enum: ['blocker', 'major', 'minor'] } }, required: ['file', 'problem', 'fix', 'severity'] } },
    nodesBeaten: { type: 'number' },
  },
  required: ['pass', 'fixListItems', 'issues', 'nodesBeaten'],
}
const FIX_SCHEMA = {
  type: 'object',
  properties: { commit: { type: 'string' }, shotsDir: { type: 'string' }, fixed: { type: 'array', items: { type: 'string' } }, notFixed: { type: 'array', items: { type: 'string' } }, tscOk: { type: 'boolean' }, testsOk: { type: 'boolean' } },
  required: ['commit', 'shotsDir', 'fixed', 'notFixed', 'tscOk', 'testsOk'],
}

let shots = build.shotsDir
let commit = build.commit
const rounds = []
for (let round = 1; round <= 3; round++) {
  phase('Review')
  log(`review round ${round} on ${commit}`)
  const [art, blind, tech] = await parallel([
    () => agent(`You are the art director. ${REFERENCE}

${CHOICE}

Review the build's screenshots in ${shots}/ (phone-<scene>.png and desk-<scene>.png for: ${SCENES}) with the Read tool, next to A's finals (${SP}/island-ref/terrain/final/) and B's finals (${SP}/island-ref/charm/final/). Look at every phone scene and at least t1-day, t5-day, t5-night, faults, beaten and zoom-elec on desktop.

${FIXES}

Judge: does it read as A's art on B's island shape? Is it polished (no overlaps, no clipping, no clutter, nothing that looks like a diagram)? Are night and storm good? Does the island visibly grow (dev-fresh vs dev-settled vs t4-thriving vs beaten, project construction, just-built, weathered)? List every issue a player would notice, with scene, spot, problem and concrete fix. pass = true only when there is nothing above minor.`, { label: `art:r${round}`, phase: 'Review', schema: ART_SCHEMA }),
    () => agent(`You are play-testing a phone game's home screen art. You have NOT seen the code. Look at these four images with the Read tool (the island at 358 px wide on a phone, 2x):
- ${shots}/phone-faults.png (scene "faults")
- ${shots}/phone-lapsed.png (scene "lapsed")
- ${shots}/phone-t5-night.png (scene "t5-night")
- ${shots}/phone-t3-storm.png (scene "t3-storm")
Open no other file, and ignore the caption text under each image. The island has planes (a mechanic looks after them), guest houses plus a power grid and generator (an electrician) and an office (the analyst, who handles cash). For each scene report only what the picture tells you: time of day and weather; every plane and its status (ok, warning = needs attention soon, aog = broken/out of action, grounded = deliberately taken out of service as a safety call, unclear); every guest house (cottages, villas, a lodge), open or closed, the reason if closed (redtag, low-reliability, inspection, no-power, unclear) and whether it smokes; whether the grid is down, whether a backup generator is running, whether there is a cash alarm at the office, whether you see sites for future buildings; anything confusing or ugly. If you have to guess, say unclear.`, { label: `blind:r${round}`, phase: 'Review', schema: BLIND_SCHEMA }),
    () => agent(`You are a senior front-end reviewer. The island view of a Preact + TypeScript PWA was rebuilt in the worktree ${WT} on branch island-final (base ${BASE_SHA}). Review \`git -C ${WT} diff ${BASE_SHA} --stat\` and the full diff. Check the contract and every numbered fix-list item, run \`cd ${WT}/island-company && npx tsc --noEmit && npx vitest run\`, and count SVG nodes if useful (the shots script prints them; latest screenshots are in ${shots}). Edits outside the owned files are violations.

${CONTRACT}

${FIXES}

pass = true only if tsc and tests pass, nothing outside the owned files changed, and there is no blocker or major issue.`, { label: `tech:r${round}`, phase: 'Review', schema: TECH_SCHEMA }),
  ])
  const legibility = scoreBlind(blind)
  const artOk = !!art && art.pass
  const techOk = !!tech && tech.pass
  const legOk = legibility.pct >= 85
  rounds.push({ round, commit, shots, art, tech, legibility, blindUgly: blind && blind.scenes.flatMap((s) => s.ugly.map((u) => `${s.scene}: ${u}`)), blindConfusing: blind && blind.scenes.flatMap((s) => s.confusing.map((u) => `${s.scene}: ${u}`)) })
  log(`round ${round}: art ${artOk ? 'pass' : 'fail'} (${art ? art.issues.length : '?'} issues), legibility ${legibility.pct}%, tech ${techOk ? 'pass' : 'fail'} (${tech ? tech.issues.length : '?'} issues)`)
  if (artOk && techOk && legOk) break
  if (round === 3) break

  phase('Fix')
  const issues = JSON.stringify({
    art: art ? art.issues : 'art review failed to run',
    legibility: { score: legibility.pct, missed: legibility.missed, ugly: rounds[rounds.length - 1].blindUgly, confusing: rounds[rounds.length - 1].blindConfusing },
    tech: tech ? { issues: tech.issues, fixListItemsNotDone: tech.fixListItems.filter((f) => !f.done) } : 'tech review failed to run',
  }, null, 1)
  const fix = await agent(`You are the island's art developer, continuing the build in the existing worktree ${WT} (branch island-final). Work there directly: cd ${WT}. Do not create a new worktree or branch.

${CHOICE}

${CONTRACT}

Round ${round} review found these issues (art director, a blind legibility test scored ${legibility.pct}% against the true game state, and a code reviewer):
${issues}

Fix every blocker and major issue and as many minor ones as you can, without regressing anything else. The legibility misses mean a first-time player could not read that status from the picture; fix the ART so they can.
${SERVER(WT)}
Screenshot all scenes to ${OUT}/fix${round} after each change set and LOOK at them with the Read tool (at least 2 rounds). Then: final screenshots in ${OUT}/fix${round}/final, tsc + vitest, stop the dev server, commit on island-final ("Island art: review round ${round} fixes"), do not push. Return the result.`, { label: `fix:r${round}`, phase: 'Fix', schema: FIX_SCHEMA })
  if (!fix) break
  shots = fix.shotsDir
  commit = fix.commit
}

const last = rounds[rounds.length - 1]
return {
  worktree: WT,
  branch: 'island-final',
  commit,
  shots,
  build: { summary: build.summary, fixListStatus: build.fixListStatus, openIssues: build.openIssues, nodesBeaten: build.nodesBeaten },
  rounds: rounds.map((r) => ({ round: r.round, commit: r.commit, artPass: r.art && r.art.pass, artScores: r.art && { a: r.art.styleFidelityToA, b: r.art.shapeFidelityToB, polish: r.art.polish, nightStorm: r.art.nightAndStorm, growth: r.art.growth }, artIssues: r.art && r.art.issues, legibility: r.legibility, techPass: r.tech && r.tech.pass, techIssues: r.tech && r.tech.issues, nodes: r.tech && r.tech.nodesBeaten })),
  passed: !!(last && last.art && last.art.pass && last.tech && last.tech.pass && last.legibility.pct >= 85),
}
