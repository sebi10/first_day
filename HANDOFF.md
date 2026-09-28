# Handoff: moving Island Company from the cloud session to local Claude Code

The rules that don't change are in `CLAUDE.md`. This file is the state of play as of **2026-09-28, about 02:25 UTC**, plus the playbook for working the way the cloud session did: multi-agent builds, reviews, testing, deploys and monitoring. Update the "State" sections when things land.

---

## 1. TL;DR for the next session

1. **What's live** (https://islandgame-efc37.web.app): deploy run #12, code `bd1e1d2` (the merge of `jobflow`), 2026-09-28 at 02:17 UTC. Nothing ships without the checklist in §6.4.
   - **new in this release:**
     - the real job flow for both trades: alert → investigate → manual/reference search → IPC/supply search → stock check → Send (start now from the work budget, or a card to the analyst) → approval, purchase order, receiving → the puzzle → sign-off
     - the analyst's finance tracking: cash and runway, where the money went, part-family velocity (fast / steady / slow over 26 weeks), ABC, min/max with reorder points, forecast
     - NPC staff on payroll: pilots, housekeepers and builders, a weekly hiring board run by the analyst, every card with its dollar effect, and the staff drawn on the island
   - already live before it: the island art, blind sign-off with hidden defects, cross-trade reports, the part chain (IPC → logbooks → engineering approval), AMM task cards with S/N effectivity, the crack / hydraulics / ground power puzzles with interactive carts, the crew board and DMs, and the doc version gate
   - numbers: 689 tests; `DOC_VERSION` 3; `ENGINE_VERSION` 3; `firestore.rules` `v == 3`. Live v2 islands migrate on first read (kits become store credit, a starter shelf, a What's new sheet).
2. **In flight in the cloud:** nothing. The swarm landed (§3).
3. **First local tasks:**
   - set up the machine (§4), then `git pull`
   - make the scripts' Chromium path portable (§4.3)
   - run the full check suite (§6.4 items 1–4)
   - get the crew to playtest on real phones, then act on their feedback (the backlog in §7 lists what's known)
4. **Open owner decisions** (defaults are what's live):
   - **Builders speed-up:** should NPC builders be able to speed up a tier, by up to 2 weeks when staffed and supplied, but never delay it? Live default: no. Builders set how good new buildings start and can build extra cottages, but never change when a tier arrives.
   - **Wages scale** (`docs/JOBFLOW.md` §23, question 4): a skill-3 pilot is $320 a week and a builder $260. Scale 2.5–3× with overhead cut to match, so a hire is real money? Live default: as is, tune after a playtest. It changes every island's P&L.
   - The spec's other open questions (§23, 1–3 and 5–7) run on their bracketed defaults.

---

## 2. The people and their words (design source of truth)

- **Owner:** Seb, the FP&A analyst seat. Their working-style preferences are in `CLAUDE.md`.
- **Mechanic seat:** a friend who is an A&P. His flow, verbatim: *"When I get a task / I get a manual / I follow manual / If part is gone or missing or damaged / IPC / If part no exist / I check in previous logged items on airplane / The maintenance logs / And then get engineering approval / To put part on airplane"* and *"I want it to be real"*.
- **Electrician seat:** a friend who is a licensed residential electrician.
- **Owner asks, verbatim, in order:**
  1. *"I have a chance to fix it via a reasonable repair and then I have to complete the original task / ground power carts have to be interactive for the mechanic / … add cross dependency reports from random things so like mechanic says; this light doesn't work in my shop, and electrician has to go fix it. but using all 3 jobs / And if we fuck something up we don't see the immediate sign that your incorrect such that it's realistic / so there's an incident if we fuck up"*
  2. *"for mechanics and electrician we need new level flow such that the mechanic gets alerted to potential issues with the plane, has to search (w a search bar in IPC and manual) to find the part, then he can see if this item is already in stock (if analyst has ordered it already expecting it. so we need different parts.) the electrician is much the same, so customers will flag an issue, he will find the tools see if our inventory (new feature) and if we don't hav it he'll request analyst t buy them. make each job flow like real life as described above."*
  3. *"make the analyst be able to track finances more closely too just in passing so we can plan. so i can see which parts we more [move] over time quickly vs slowly etc"*
  4. *"We also need to add a couple npc to help with expansion of the island like builders and other people that aren't gonna be supplied with other people (these are on the islands payroll and we can hire more skilled for more money etc) analyst decides on hiring."*

---

## 3. State: what landed (the cloud swarm)

**Workflow `real-job-flow`** (run `wf_81280479-e48`, template `docs/handoff/workflows/real-job-flow.js`): started 2026-09-27 about 08:30 UTC, resumed through two container restarts, QA passed 2026-09-28 about 02:10 UTC (about 17.5 hours wall-clock). Deployed by run #12.

| Stage | Result |
|---|---|
| Design | spec → 2 critics (trade realism; game design) → revise: `docs/JOBFLOW.md` |
| A · Engine | alerts, manual/IPC/supply search, real inventory, requisitions, work budgets, MEL defer / make-safe, finance ledger, staff hooks, migration v2→v3, bots |
| B · Tech UI | alert inbox, the five-step job sheet, search bars, stock badges (mech + elec) |
| C · Analyst UI | requisitions, stock planner, finance tracking (family velocity over 26 weeks, spend, budget vs actual) |
| D · NPC staff | pilots, housekeepers, builders; hiring board; payroll; staff drawn on the island |
| Integrate | `ea41c08`, online e2e fix `29f6e90` |
| 3 reviews (trades, play, systems) | 15 major and 37 minor issues |
| Fix | `18ef25c` "Job flow review fixes": all 15 majors addressed (two only partly: see the gaps below) |
| QA | **passed**: tsc, 689/689 tests, build, balance, e2e phone + desktop, online e2e on the emulator with 10/10 rules probes, migration of 8 docs from the live build (`6c0c426`) in tests and in the real app, reverse skew (the old build opens a v3 doc, reloads, never writes), 28 island-lab scenes (beaten scene 1,390 nodes), scripted phone runs of every new flow. `bdf97ba` fixed the e2e script only. |
| Deploy | merge `bd1e1d2` → run #12; the live gate probe refuses a v:2 write |

- **Balance** (medians; targets in `CLAUDE.md`):
  - standard run (26 weeks × 30 seeds), all targets met:
    - three friends: tiers 2/3/4/5 in weeks 8/12/16/23, 0 weeks below $0
    - all average: weeks 7/12/16/23, 0 weeks below $0
    - solo, absent and nobody teams stay at tier 1; the pacing guard holds
  - **robust sweep (90 seeds × 4 crews) is worse than the previous live build:**
    - three friends: median week 24, 96 of 360 games miss tier 5, 7 weeks below $0 across all games
    - all average: median week 23, 80 of 360 miss, 0 weeks below $0
    - the previous build had 75 and 37 misses
    - the misses come from crew projects stalled by long absences and the electrician's tier-4 overload, not cash; the levers are in `docs/DECISIONS.md` (stagger code notices, throttle the generator)
- **Known gaps** (also in §7):
  - Past due, the only guest plane still flies restricted; there's no mainland sub-charter.
  - The builders' zoom on Home needs its own zoom box.
  - The MEL wording in `src/ui/flow/Investigate.tsx` says "Past it, the plane is grounded", which is wrong for the only guest plane (it flies restricted).
  - The underground feeder re-splice launches the branch-circuit trace puzzle ("Bedroom is dead · Drywall cutaway"); an electrician would notice.
  - `scripts/e2e-online.mjs` stalls if the first alert is a no-fault-found; port `planFirst`'s NFF skip from `scripts/e2e.mjs`.
- **Backup branch `backup/jobflow`** (= `jobflow` at `bdf97ba`) is now redundant; delete it once the owner OKs.
- **The spec's key decisions** (full text: `docs/JOBFLOW.md` §25):
  1. v1 covers the jobs that make up ~90% of the work. Rare jobs keep the diagnosis but come with parts pre-filled.
     - Deferred to v2: ignition, the turbine hot section, calibration, cores, shelf life, line-crew NPCs, morale.
  2. In stock means the tech starts now, paid from the trade's weekly **work budget**. Missing means a requisition to the analyst.
  3. No play-order gridlock:
     - cards stay approvable after the analyst ends their turn
     - a standing auto-approve limit applies at resolve
     - a 1-week-lead part ordered this week arrives at this week's resolve
  4. The only guest plane is never grounded by an alert. Overdue, it flies half its flights with near-misses.
  5. Labour plus parts equals today's card prices. Exceptions: the twin's 100-hr and oil change, and the cargo plane's starter-generator.
  6. Mistakes stay hidden. The stockroom holds near-miss parts, so "on hand" never gives the answer away.
  7. Velocity ("fast vs slow movers") is tracked by **part family over 26 weeks**; per-P/N weekly data is too sparse. Bills are paid a week after delivery, after a three-way match.
  8. The analyst hires pilots, housekeepers and builders. Every candidate card states its effect in dollars.
  9. Builders make new buildings better, not faster. This is the open question in §1.
  10. Live islands migrate: a starter shelf, kits become store credit, and a "What's new" sheet with 2 weeks of hints.

---

## 4. Local setup (do once)

### 4.1 Machine

- **Node and packages:** Node 22, git, then `cd island-company && npm ci`.
- **GitHub CLI:** `gh auth login` with `repo` and `workflow` scopes. The cloud session had no `gh`; locally it is the fastest way to watch CI.
- **Java 11+** for the Firestore emulator. Use `npx --yes firebase-tools@15 ...`; no global install needed.
- **Optional MCP servers:**
  - GitHub MCP, if you prefer tools over `gh`
  - Desktop Commander, the owner's "Gimble" second brain; log key decisions there as well as in `docs/DECISIONS.md`

### 4.2 Claude Code permissions (so it can test, push and monitor freely)

Put this in `.claude/settings.local.json` (personal, don't commit) or `~/.claude/settings.json`. Adjust to taste. `git push` deploys, so only allow it if you're happy for the agent to deploy.

```json
{
  "permissions": {
    "allow": [
      "Bash(git:*)", "Bash(gh:*)", "Bash(npm:*)", "Bash(npx:*)", "Bash(node:*)",
      "Bash(python3:*)", "Bash(ls:*)", "Bash(cat:*)", "Bash(grep:*)", "Bash(rg:*)", "Bash(sed:*)",
      "Bash(ps:*)", "Bash(lsof:*)", "Bash(kill:*)", "Bash(mkdir:*)", "Bash(cp:*)", "Bash(ln:*)",
      "Edit", "Write"
    ]
  }
}
```

- `--permission-mode acceptEdits` removes the edit prompts.
- Use bypass modes only in a disposable sandbox.
- For multi-hour swarms, keep the machine awake: `caffeinate -dimsu` (macOS) or `systemd-inhibit` (Linux).

### 4.3 Chromium for the e2e and screenshot scripts

- Done (2026-09-28): the scripts take their Chromium from `scripts/chromium.mjs`: `$CHROMIUM_PATH`, else `/opt/pw-browsers/chromium` if it exists, else Playwright's default. Locally, `npx playwright@1.56 install chromium` once is enough.
- Locally there's no egress proxy, so you can also Playwright the live site. Careful: that creates real anonymous users and island docs in production.

---

## 5. Capability map: cloud session → local session

| Need | Cloud session used | Local equivalent |
|---|---|---|
| Multi-agent builds | `Workflow` tool (scripts, `resumeFromRunId`) | Same tool. The owner opts in by saying "use a workflow" or including "ultracode". Watch with `/workflows`. Resume works **within the same session**: reopen with `claude --continue`. |
| One-off subagents | `Agent` tool (background) | Same |
| GitHub: CI status, logs, PRs | GitHub MCP tools | `gh run list/watch/view --log-failed`, `gh pr ...`, plain `git push` |
| Scheduled check-ins that survive restarts | server-side `send_later` / triggers | `/loop` (self-paced), `CronCreate` if present, background Bash with notify-on-exit (e.g. `gh run watch <id> --exit-status`), the `Monitor` tool for "wait until X". Local timers die when the machine sleeps. |
| Show the owner screenshots | `SendUserFile` / Artifacts | The owner is at the terminal: save PNGs to a folder, `Read` them yourself (you can see images) and point to the paths |
| Browser | preinstalled Chromium | §4.3 |
| Live Firebase checks | Node SDK with `NODE_USE_ENV_PROXY=1` (the proxy blocked `*.web.app`; Chromium distrusted Google certs) | Node SDK directly (no proxy), or the browser |
| Deploy | push → GitHub Action | Same. Or `npx firebase-tools@15 login` then `deploy --only hosting,firestore:rules` with the owner's own account (always both together) |

---

## 6. The playbook (how the cloud session worked; do the same)

### 6.1 The shape of a big feature (all of these are in the templates)

1. **Scout inline first.** Grep and read enough to write precise briefs, then delegate file-heavy work to keep your own context lean.
2. **Design workflow.**
   - A **spec agent** writes `docs/<FEATURE>.md` with:
     - exact types, actions, UI screens and tap counts
     - the migration and version-gate plan
     - balance knobs, a test plan, and a file-owned **work split**
   - **Two read-only critics** run in parallel: a trade-realism panel (A&P/IA, licensed electrician, purchasing/FP&A) and a game-design lens (gridlock, tedium, clarity, learning curve, Goodhart, live-migration risk). Each returns `{severity, area, problem, fix}`.
   - A **revise agent** fixes every blocker and major. It writes "Rejected critique" (with reasons) and "Decisions the owner should know about".
   - **Send those decisions to the owner before the heavy build.** They redirect early.
3. **Build workflow.**
   - **Package A** (engine / data / tests / bots / migration) goes first. It is the contract.
   - UI packages run in parallel, each in **its own worktree and branch from A's commit**, with its own port and cache dir.
   - An **integrator** merges them `--no-ff`, glues cross-seat behaviour, and updates the e2e scripts.
4. **Review.** Three parallel **read-only** reviewers with distinct lenses: trade realism, play/UX on a 390×844 phone across all three seats plus desktop, and systems/migration/balance. `pass` = no blocker or major.
5. **Fix round.** Every blocker and major plus the cheap minors, then re-run everything.
6. **QA agent.**
   - tsc, vitest, build, balance (standard + robust), and e2e on phone and desktop
   - the online e2e on its **own emulator ports** with the branch's rules, including rules probes (macOS has only 127.0.0.1: separate runs by port, `VITE_FB_FS_PORT` / `VITE_FB_AUTH_PORT`; the steps are in the header of `scripts/e2e-online.mjs`)
   - migration from fixtures written by the previous live commit
   - the islandlab node count
   - scripted phone runs of the new flows, with screenshots
   - If QA fails: fix → QA again.
7. **You verify before deploying** (§6.4). Reports to the owner include before/after screenshots and **honest caveats**: what wasn't tested, balance tails, trade-offs.

### 6.2 Prompt conventions that worked

- An `ENV` block per agent:
  - exact worktree path; "use `git -C`, don't cd into the main checkout"
  - the node_modules symlink, a unique Vite port and `VITE_CACHE_DIR`
  - Playwright import path and viewports, "LOOK at your screenshots"
  - where to put scratch files, the commit trailer rule, "do not push"
- A `USER` block with the owner's words **verbatim**, plus the standing asks.
- A numbered `ASSUME` / decisions block so every agent builds on the same decisions.
- **Structured output** (a JSON schema) for every agent, e.g. builds return `{branch, worktree, commit, summary, howToPlay, balance, tscOk, testsOk, notDone[]}`.
- **Review prompts:**
  - reviewers are told they are **READ-ONLY** and to report severity + fix
  - fixers get the issue list as JSON and "fix EVERY blocker and major"
- Tell agents to **reproduce before fixing**, to **verify in the browser**, and to **kill only their own servers, by PID**.

### 6.3 Monitoring long runs

- **Check in every 30–45 min.** `<transcriptDir>/journal.jsonl` has `started` / `result` lines; `agent-*.jsonl` mtimes show liveness. A **stall** is no writes for more than 20 min while an agent is started.
- **If a stage died:**
  1. Look in its worktree (`git status`) for uncommitted work.
  2. **Edit that stage's prompt** in the script: "a previous agent was killed; keep its uncommitted work, don't reset".
  3. Run `Workflow({scriptPath, resumeFromRunId})`. Unchanged completed agents replay from cache.
- **Owner changes scope mid-run:** if the affected stages haven't finished, stop the workflow (TaskStop), edit the `USER`/`ASSUME` blocks and resume. Otherwise feed the change into the next fix round.
- **Clean up after swarms:** `ps`/`ss -ltnp` for leftover Vite servers and emulators. Kill only ones you started.

### 6.4 Deploy checklist

1. `npx tsc --noEmit -p .`, `npx vitest run`, `npm run build` (then `rm -rf dist`).
2. Balance: standard + robust. Compare against the targets in `CLAUDE.md`.
3. `scripts/e2e.mjs` on phone and desktop; `scripts/e2e-online.mjs` on the emulator for net or rules changes.
4. Old live docs load: skew/migration tests with fixtures from the previous live commit.
5. If the engine changed incompatibly: **version gate** bumped (engine + doc + rules) and tested.
6. Audit the diff: `git diff --stat <live>..HEAD`. Check for scratch files, secrets and giant files.
7. Check commit trailers. For unpushed commits only, `git filter-branch --msg-filter` can append missing trailers with an identical tree.
8. Push to the deploy branch. If docs were committed there meanwhile, merge `--no-ff` rather than fast-forward.
9. `gh run watch <id> --exit-status`. On failure, `gh run view --log-failed`, root-cause it, reproduce locally, fix and push again. Example: a whole-season test hit vitest's 5 s limit on the 2-core runner; fixed with a per-file `testTimeout`, no assertion changed.
10. Live probe for rules/version changes with `docs/handoff/probe-gate.mts` (how to run it is in its header). It signs in anonymously and tries to update a missing doc with the old and the new `v`, so it never writes a doc, even before the rules propagate. Want `permission-denied` for the old `v` and `not-found` for the new one. It deletes its anonymous user. Then report to the owner, including **"close and reopen the app"** after a version bump.

### 6.5 Gotchas learned the hard way

- **Worktree base:** the `Workflow` agent option `isolation: 'worktree'` starts from the repo's **default branch `master`** (an unrelated first commit). The templates create worktrees explicitly with `git worktree add -b <b> .claude/worktrees/<b> <sha>`.
- **Concurrency:** about 2 agents run at once on a 4-CPU box. Plan wall-clock accordingly; a stronger local machine runs more.
- **Font 403:** the Manrope font 403s through a symlinked `node_modules` in worktrees. It's cosmetic.
- **Dev server port:** Vite's 5173 is `strictPort`. Agents used ports 5190–5230. The cloud container gave each emulator its own host (127.0.0.2–127.0.0.4); macOS has only 127.0.0.1, so locally each emulator gets its own ports instead (`scripts/e2e-online.mjs` header).
- **CI speed:** the runner is about 1.5× slower (§6.4 item 9).
- **The only guest plane:** never ground it by rule. That empties every house and can bankrupt the island.
- **Anonymous-auth accounts:** deleting one breaks that device's seat. The app has a recovery layer ("Missing or insufficient permissions" → re-sign-in → relink), but still don't delete them.
- **Sim tests:** balance or pacing tests that play whole seasons belong in files with `vi.setConfig({ testTimeout: 30000 })`.

---

## 7. Backlog

1. **Crew playtest on real phones.** Nothing has had a human playtest since the island art, and the job flow changes every seat. Collect friction points per seat.
2. **Owner decisions** (§1): builders speed-up; wages scale.
3. **Job flow follow-ups from review and QA** (§3 "Known gaps"):
   - the MEL wording for the only guest plane
   - the feeder re-splice launching the branch-circuit trace puzzle
   - a mainland sub-charter for the only guest plane when past due
   - the builders' zoom box on Home (within the 1,500-node budget)
   - harden `scripts/e2e-online.mjs` against an NFF first alert
4. **Job flow v2:**
   - exchange units with core charges
   - shelf life and expiry
   - tool calibration and wear
   - line-crew NPCs
   - staff morale and raises
   - ignition (plugs/magneto) and turbine hot-section jobs
   - a tow / wing-tip symptom (57-30)
   - THWN take-offs for the transfer switch and fuel dock
   - MEL category B
5. **Robust-sweep tail:** three friends miss tier 5 in 96 of 360 robust games (target about 75) and all average in 80 (about 37). Causes: crew projects stalled by long absences, the electrician's tier-4 overload, and rare week 24–26 collapses below $0 after long electrician absences (grid + generator down). The levers are in `docs/DECISIONS.md` (stagger code notices, throttle the generator).
6. **Portable Chromium path** in the scripts (§4.3).
7. **Keep `docs/DECISIONS.md` and `docs/ONBOARDING.md` current** with every feature.

## 8. Templates

`docs/handoff/workflows/` holds the actual workflow scripts the cloud session ran. See its README for which pattern each shows and what to adapt: paths, ports, the attribution trailer.
