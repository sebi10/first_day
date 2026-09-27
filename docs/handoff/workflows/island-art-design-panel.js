export const meta = {
  name: 'island-art-design-panel',
  description: 'Four art directions for the island (worktrees), blind legibility test, art + tech judges',
  phases: [
    { title: 'Design', detail: 'one designer per art direction, each in its own worktree + dev server, iterating on screenshots' },
    { title: 'Blind test', detail: 'a fresh agent reads each design\'s screenshots without the ground truth; scored in code' },
    { title: 'Judge', detail: 'art-direction judge and technical/contract judge compare all designs' },
  ],
}

const SP = '/tmp/claude-0/-home-user-first-day/fbc0a559-d1ad-537c-84ea-3d4f56ea63a5/scratchpad'
const MAIN = '/home/user/first_day/island-company'

const DIRECTIONS = [
  { key: 'iso', port: 5181, name: 'Cozy isometric diorama',
    brief: 'The island as a small floating diorama in 2:1 isometric projection: an extruded island with visible sand/rock strata on its sides, water with a depth gradient and a soft foam line, buildings as little three-face iso blocks with pitched roofs and consistent light from the upper left, the runway along one edge. Think Townscaper / Islanders / Monument Valley pastels. Charming, toy-like, tactile.' },
  { key: 'poster', port: 5182, name: 'Modern flat travel poster',
    brief: 'A top-down / gentle 3/4 view in bold simplified shapes: turquoise shallows fading to deep blue, a reef ring with a lagoon, a crisp coastline with a bay and a sandbar, strong silhouettes, a limited palette built from the game theme colours, one consistent hard shadow direction. Think a modern airline/travel illustration or a vintage aviation poster: confident, graphic, instantly readable.' },
  { key: 'lowpoly', port: 5183, name: 'Refined painterly low-poly',
    brief: 'Evolve the current low-poly look into something genuinely good: an organic coastline with bays and headlands, a central green hill with faceted elevation and triangulated light, soft contact shadows and ambient occlusion, a composition that clearly separates three zones (airfield west, cottages east, office in the middle), sparing and deliberate decoration. Think a polished indie mobile game.' },
  { key: 'board', port: 5184, name: 'Clarity-first game board',
    brief: 'A stylised map where clarity comes first but it is still pretty: clean zones on pads (airfield, cottage row, office square, power yard), each asset a crisp icon-like building, one consistent status language (e.g. coloured rings/badges and clear out-of-service states), strong visual hierarchy so every status reads at 358 px wide. Think Mini Metro / Two Point / Pocket City: readable at a glance, satisfying to watch grow.' },
]

const CONTRACT = `
PROJECT: "Island Company", a Preact + TypeScript PWA (Vite). Three friends play a co-op island business on their phones: an A&P mechanic (planes, hangar, runway), an electrician (cottages, grid, generator) and an FP&A analyst (office, cash). The island SVG on the home screen is the game's progress bar and status board. The owner's verdict: "overall okay but the island doesn't look good". Your job: make it look genuinely good AND keep every status readable on a phone.

Current problems (from screenshots of the existing island):
- The island is a lumpy 18-point polygon blob; no bays, reef, lagoon, elevation.
- Future-tier plots are dashed boxes labelled "T2/T4/T5" that look like debug wireframes.
- Power lines are a tangle of yellow curves from one pole; palms overlap buildings.
- Incoherent scale (planes vs houses), a floating grey apron slab, a plank for the float dock.
- Night is just a dark veil (no stars, moon, reflections); palette is flat.
- REAL BUG: fault tags (GND, TAG, AOG, "!") use class "pulse", whose CSS keyframes animate transform; on an element that also has an SVG transform="translate(...)" attribute, the CSS transform replaces it, so the tags render at the top-left corner instead of on the asset. Never put a CSS transform animation on an element that carries a transform attribute: position with an outer <g transform>, animate an inner <g>.

FILES YOU OWN (edit nothing else):
- island-company/src/ui/island.tsx: rewrite freely. You may split helpers into island-company/src/ui/island/*.tsx, but island.tsx must still export \`Island\` and \`phaseOf\`.
- The island section of island-company/src/styles.css (from "/* island */" through the island keyframes and the ".still" rule). Keep .island-wrap's aspect-ratio 4 / 3 and .island-hint.

HARD CONTRACT:
- Props unchanged: Island({ s: IslandState, focus: Role | null, onTap?: () => void, reduceMotion: boolean, phase?: 'dawn'|'day'|'golden'|'night' }). phaseOf(date) stays exported. Rendered aspect stays 4:3 (viewBox coordinates are yours).
- Keep the idle/visibility pause logic (useStill, the .still class with animation-play-state: paused, pauseAnimations for any SMIL). reduceMotion = no animation at all.
- Animate only transform/opacity with CSS keyframes; no per-frame JS; no heavy filters (at most one cheap blur used sparingly). Target <= ~450 SVG nodes at tier 5 (current ~300).
- Zoom: focus = role zooms to that role's zone (mech: hangar/runway/planes; elec: cottages/grid/generator; fin: office) via a CSS transform + transition on a wrapper group (class island-zoom).
- Assets by tier (ids): t1 p1 twin plane, h1 h2 cottages, g1 grid (panel+transformer); t2 p2 cargo plane, h3 h4 cottages; t3 gen generator house (storms begin); t4 p3 floatplane (on water, needs a real dock), h5 h6 villas; t5 h7 the Lodge (night flights). Villas and the Lodge must look like upgrades, not scaled cottages.
- Future tiers visibly "grow" the island without text labels: e.g. survey stakes and string lines, cleared plots, foundation outlines, a buoy for the future dock.
- Status must be readable with no text (a tiny badge like "GND" is allowed if it is legible at 358 px):
  * plane AOG: health < 40 (in the hangar / on jacks), distinct from plane grounded: s.tags[p.id] (a safety call; parked with chocks/cones), distinct from plane warning: health < 60, and from healthy/flying.
  * house closed: !houseRentable(s, h), with the reason visible via houseBlocker(s, h): 'red-tagged' (s.tags[h.id]), 'reliability N' (health < 40), 'inspection lapsed', 'no power'. Health < 30 = fire risk (smoke).
  * grid down: powered(s).gridDown (lines dark / broken); generator carrying: gridDown && powered(s).genOK (exhaust, houses still lit); no power at all: !powered(s).on (houses dark).
  * cash < 2000: an alarm at the office.
  * weather: s.weather 'clear' | 'wind' | 'storm'; phase lighting dawn/day/golden/night. Night: warm windows only in rentable powered houses, stars/moon, runway edge lights when s.tier >= 5 (night flights).
  * a plane fly-by when flights are active; a guest or two walking when houses are booked.
- Cosmetic tints: hangar roof = cosmeticColor('mech'), house roofs = cosmeticColor('elec'), office awning = cosmeticColor('fin') (see the existing cosmeticColor helper and COSMETICS in src/sim/data.ts). Use the theme palette C from src/ui/theme.ts as the base.
- role="img" with an informative aria-label.
- Must pass: cd island-company && npx tsc --noEmit && npx vitest run.
`

const designPrompt = (d) => `${CONTRACT}

YOUR ART DIRECTION: "${d.name}"
${d.brief}

SETUP (you are in a fresh git worktree of the repo; the project is in ./island-company):
1. node_modules is not in the worktree: run \`ln -s ${MAIN}/node_modules island-company/node_modules\`.
2. Your output dir: ${SP}/island-design/${d.key}  (mkdir -p it).
3. Start your own dev server (never touch ports 5173/5174):
   cd island-company && VITE_CACHE_DIR=${SP}/island-design/${d.key}/vite-cache nohup npx vite --port ${d.port} --strictPort > ${SP}/island-design/${d.key}/vite.log 2>&1 &
4. Screenshot harness: cd island-company && BASE=http://localhost:${d.port} node scripts/island-shots.mjs <dir>
   It renders /islandlab.html (src/islandlab.tsx: 12 scenarios: t1-day, t1-dawn, t2-golden, t3-storm, t4-wind, t5-day, t5-night, faults, lapsed, zoom-mech, zoom-elec, zoom-fin) at phone (358 px, 2x) and desktop (600 px) widths and prints SVG node counts. The baseline (current art) is already at ${SP}/island-before/. Look at several baseline images with the Read tool first.

PROCESS:
- Read the current src/ui/island.tsx, the island CSS in src/styles.css, src/islandlab.tsx, src/ui/theme.ts, and the helpers in src/sim/econ.ts (houseRentable, houseBlocker, powered, planeCapacity).
- Design deliberately: plan the composition (where each zone and each asset sits at every tier, so tier 1 does not look empty and tier 5 is not crowded), the light direction, the palette, and the status language, before drawing.
- Implement, then screenshot and LOOK at the phone and desktop images with the Read tool. Be a harsh art director: fix anything ugly, cluttered, misaligned, overlapping, off-scale, or illegible at phone size. Do at least 3 full screenshot-review-fix rounds; check every scenario, especially faults, lapsed, t5-night, t3-storm and the three zooms (zoom must frame the zone well).
- Run tsc and vitest at the end.

FINISH:
- Final screenshots in ${SP}/island-design/${d.key}/final (the harness names files phone-<id>.png and desk-<id>.png).
- Copy your final files into ${SP}/island-design/${d.key}/src/ (island.tsx, any island/ helpers, and a file island.css containing your island CSS section).
- Stop your dev server (kill the vite process on port ${d.port}).
- Commit in your worktree (git add -A && git commit -m "island art: ${d.name}"); do not push.
- Return the structured result. Be honest in selfCritique about what still looks weak.`

const DESIGN_SCHEMA = {
  type: 'object',
  properties: {
    direction: { type: 'string' },
    summary: { type: 'string', description: 'what you built: composition, palette, light, status language, how tiers grow' },
    outDir: { type: 'string' },
    worktreePath: { type: 'string' },
    branch: { type: 'string' },
    commit: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    svgNodesT5: { type: 'number' },
    tscOk: { type: 'boolean' },
    testsOk: { type: 'boolean' },
    selfCritique: { type: 'array', items: { type: 'string' } },
    bestIdeas: { type: 'array', items: { type: 'string' } },
  },
  required: ['direction', 'summary', 'outDir', 'worktreePath', 'files', 'svgNodesT5', 'tscOk', 'testsOk', 'selfCritique', 'bestIdeas'],
}

// Blind legibility: the describer never sees the code or the ground truth.
const SCENES = ['faults', 'lapsed', 't5-night', 't3-storm']
const PLANE_ST = ['ok', 'warning', 'aog', 'grounded', 'unclear']
const HOUSE_ST = ['open', 'closed', 'unclear']
const REASON = ['redtag', 'low-reliability', 'inspection', 'no-power', 'none', 'unclear']
const YNU = ['yes', 'no', 'unclear']
const BLIND_SCHEMA = {
  type: 'object',
  properties: {
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          scene: { type: 'string', enum: SCENES },
          timeOfDay: { type: 'string', enum: ['dawn', 'day', 'golden', 'night', 'unclear'] },
          weather: { type: 'string', enum: ['clear', 'wind', 'storm', 'unclear'] },
          planes: { type: 'array', items: { type: 'object', properties: { which: { type: 'string' }, status: { type: 'string', enum: PLANE_ST } }, required: ['which', 'status'] } },
          houses: { type: 'array', items: { type: 'object', properties: { which: { type: 'string' }, status: { type: 'string', enum: HOUSE_ST }, reason: { type: 'string', enum: REASON }, smoke: { type: 'boolean' } }, required: ['which', 'status', 'reason', 'smoke'] } },
          gridDown: { type: 'string', enum: YNU },
          generatorRunning: { type: 'string', enum: YNU },
          cashAlarm: { type: 'string', enum: YNU },
          futureBuildSites: { type: 'string', enum: YNU },
          confusing: { type: 'array', items: { type: 'string' } },
          ugly: { type: 'array', items: { type: 'string' } },
        },
        required: ['scene', 'timeOfDay', 'weather', 'planes', 'houses', 'gridDown', 'generatorRunning', 'cashAlarm', 'futureBuildSites', 'confusing', 'ugly'],
      },
    },
    overallImpression: { type: 'string' },
  },
  required: ['scenes', 'overallImpression'],
}

const blindPrompt = (dir) => `You are play-testing a phone game's home screen art. You have NOT seen the code. Look at these four images with the Read tool (each is the island view at 358 px wide on a phone, 2x resolution):
- ${dir}/final/phone-faults.png  (scene "faults")
- ${dir}/final/phone-lapsed.png  (scene "lapsed")
- ${dir}/final/phone-t5-night.png  (scene "t5-night")
- ${dir}/final/phone-t3-storm.png  (scene "t3-storm")
Do not open any other file, and ignore the caption text under each image (it describes the setup; judge only the picture above it).

The island has planes (a mechanic looks after them), guest houses plus a power grid and generator (an electrician looks after those) and an office (the analyst, who handles cash). For each scene, report ONLY what the picture itself tells you:
- time of day and weather;
- every plane you can see and its status: ok (healthy/flying), warning (needs attention soon), aog (broken, out of action), grounded (deliberately taken out of service as a safety call), or unclear;
- every guest house and whether it is open or closed; if closed, why (red-tagged by the electrician, low reliability/damaged, inspection lapsed, no power, or unclear) and whether it is smoking;
- whether the grid is down, whether a backup generator is running, whether there is a cash alarm at the office, whether you can see sites for future buildings;
- anything confusing, and anything ugly.
Be literal and skeptical: if you have to guess, say unclear.`

// ground truth for scoring (from src/islandlab.tsx)
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
    chk(Math.abs(sc.houses.length - t.houses) <= 0, `house count ${t.houses} (saw ${sc.houses.length})`)
    chk(sc.gridDown === t.gridDown, `grid down=${t.gridDown} (saw ${sc.gridDown})`, 2)
    chk(sc.generatorRunning === t.gen, `generator running=${t.gen} (saw ${sc.generatorRunning})`)
    chk(sc.cashAlarm === t.cash, `cash alarm=${t.cash} (saw ${sc.cashAlarm})`, 2)
    chk(sc.futureBuildSites === t.future, `future sites=${t.future} (saw ${sc.futureBuildSites})`)
  }
  return { pct: max ? Math.round((100 * pts) / max) : 0, pts, max, missed: notes }
}

phase('Design')
log('4 designers start in parallel worktrees; each design goes to its blind legibility test as soon as it finishes')
const designs = await pipeline(
  DIRECTIONS,
  (d) => agent(designPrompt(d), { label: `design:${d.key}`, phase: 'Design', schema: DESIGN_SCHEMA, isolation: 'worktree' }),
  async (res, d) => {
    if (!res) return null
    const dir = `${SP}/island-design/${d.key}`
    const blind = await agent(blindPrompt(dir), { label: `blind:${d.key}`, phase: 'Blind test', schema: BLIND_SCHEMA })
    return { key: d.key, name: d.name, dir, design: res, blind, legibility: scoreBlind(blind) }
  },
)
const done = designs.filter(Boolean)
const dropped = DIRECTIONS.filter((d) => !done.some((x) => x.key === d.key)).map((d) => d.key)
if (dropped.length) log(`designs that failed: ${dropped.join(', ')}`)
for (const x of done) log(`${x.key}: blind legibility ${x.legibility.pct}% (${x.legibility.pts}/${x.legibility.max})`)

phase('Judge')
const roster = done
  .map((x) => `- ${x.key} ("${x.name}"): screenshots ${x.dir}/final/ (phone-<scene>.png, desk-<scene>.png); code ${x.dir}/src/ (and worktree ${x.design.worktreePath}); designer summary: ${x.design.summary}; designer self-critique: ${x.design.selfCritique.join(' | ')}; SVG nodes at t5: ${x.design.svgNodesT5}; blind legibility test: ${x.legibility.pct}% (missed: ${x.legibility.missed.join('; ') || 'nothing'})`)
  .join('\n')
const SCENE_LIST = 't1-day, t1-dawn, t2-golden, t3-storm, t4-wind, t5-day, t5-night, faults, lapsed, zoom-mech, zoom-elec, zoom-fin'

const ART_SCHEMA = {
  type: 'object',
  properties: {
    rankings: { type: 'array', items: { type: 'object', properties: {
      key: { type: 'string' }, score: { type: 'number', description: '1-10 overall' },
      appeal: { type: 'number' }, cohesion: { type: 'number' }, polish: { type: 'number' }, lightingAndWeather: { type: 'number' }, growthAcrossTiers: { type: 'number' }, phoneReadability: { type: 'number' },
      strengths: { type: 'array', items: { type: 'string' } }, weaknesses: { type: 'array', items: { type: 'string' } },
    }, required: ['key', 'score', 'appeal', 'cohesion', 'polish', 'lightingAndWeather', 'growthAcrossTiers', 'phoneReadability', 'strengths', 'weaknesses'] } },
    winner: { type: 'string' },
    why: { type: 'string' },
    graftIdeas: { type: 'array', items: { type: 'object', properties: { fromKey: { type: 'string' }, idea: { type: 'string' } }, required: ['fromKey', 'idea'] } },
    mustFixInWinner: { type: 'array', items: { type: 'string' } },
  },
  required: ['rankings', 'winner', 'why', 'graftIdeas', 'mustFixInWinner'],
}
const TECH_SCHEMA = {
  type: 'object',
  properties: {
    reviews: { type: 'array', items: { type: 'object', properties: {
      key: { type: 'string' }, score: { type: 'number', description: '1-10' },
      contractViolations: { type: 'array', items: { type: 'string' } },
      stateMappingBugs: { type: 'array', items: { type: 'string' } },
      perf: { type: 'string' }, maintainability: { type: 'string' },
    }, required: ['key', 'score', 'contractViolations', 'stateMappingBugs', 'perf', 'maintainability'] } },
    ranking: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
  required: ['reviews', 'ranking', 'notes'],
}

const [art, tech] = await parallel([
  () => agent(`You are the art director for a small co-op phone game (three friends, played on phones, also on desktop). The owner said the old island "doesn't look good". Four candidate redesigns of the island view exist. Compare them rigorously by LOOKING at the images with the Read tool: for each design view every scene at phone size (${SCENE_LIST}) and at least t1-day, t5-night, faults and zoom-elec at desktop size. The old art for reference is ${SP}/island-before/ (same file names).

Candidates:
${roster}

Score each 1-10 on: appeal (would the friends find it beautiful and charming?), cohesion (one consistent style, light and scale), polish (alignment, no overlaps, no clutter, no debug look), lightingAndWeather (dawn/day/golden/night, wind, storm), growthAcrossTiers (tier 1 not empty, tier 5 not crowded, future sites tasteful, upgrades read as upgrades), phoneReadability (every status legible at 358 px; weigh the blind legibility result). Pick a winner, explain why, list concrete ideas from the other designs worth grafting onto the winner, and list what must still be fixed in the winner. Be demanding and specific (name the scene and the spot).`, { label: 'judge:art', phase: 'Judge', schema: ART_SCHEMA }),
  () => agent(`You are a senior front-end reviewer. Four candidate rewrites of the island view of a Preact + TypeScript PWA exist. Review each one's code against the contract below and for correctness, performance and maintainability. Code for each is under <dir>/src/ (copies), and each designer's worktree holds the full change (run \`git -C <worktree> show --stat HEAD\` and \`git -C <worktree> diff HEAD~1\` to see exactly what changed, including any edits outside the owned files, which are violations). The current code on the main branch is ${MAIN}/src/ui/island.tsx and ${MAIN}/src/styles.css; the state helpers are in ${MAIN}/src/sim/econ.ts.

Candidates:
${roster}

${CONTRACT}

Check in particular: props/exports unchanged; idle pause (.still, pauseAnimations) and reduceMotion kept; no CSS transform animation on an element with a transform attribute; every status maps to the right predicate (houseRentable/houseBlocker/powered/tags/health thresholds); every asset id handled at every tier (p1 p2 p3 h1-h7 g1 gen); zoom works for all three roles; node count and filters; nothing edited outside the owned files. You may run \`cd <worktree>/island-company && npx tsc --noEmit\` to verify. Score 1-10 each and rank.`, { label: 'judge:tech', phase: 'Judge', schema: TECH_SCHEMA }),
])

return {
  designs: done.map((x) => ({ key: x.key, name: x.name, dir: x.dir, worktree: x.design.worktreePath, branch: x.design.branch, commit: x.design.commit, nodes: x.design.svgNodesT5, tscOk: x.design.tscOk, testsOk: x.design.testsOk, summary: x.design.summary, selfCritique: x.design.selfCritique, bestIdeas: x.design.bestIdeas, legibility: x.legibility, blindImpression: x.blind && x.blind.overallImpression, blindUgly: x.blind && x.blind.scenes.flatMap((s) => s.ugly.map((u) => `${s.scene}: ${u}`)), blindConfusing: x.blind && x.blind.scenes.flatMap((s) => s.confusing.map((u) => `${s.scene}: ${u}`)) })),
  dropped,
  art,
  tech,
}
