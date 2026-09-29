# CLAUDE.md: Island Company

Claude Code loads this file automatically. It holds the rules that don't change. `HANDOFF.md` holds the current state, the in-flight work and the full operating playbook: read it at the start of a session.

## What this is

**Island Company** (`island-company/`) is a free 3-player co-op PWA for three real friends. Each seat is a real trade:

| Seat | Trade | Keeps |
|---|---|---|
| `mech` | an A&P aircraft mechanic | the planes flying |
| `elec` | a licensed residential electrician | the houses and the grid powered |
| `fin` | an FP&A analyst (the owner, Seb) | the cash, approvals, purchasing and hiring |

- It runs live on Firebase at https://islandgame-efc37.web.app, with real islands in play.
- One island week resolves every real day at 20:00.
- The rest of the repo (`main.java`, the root `README.md`) is unrelated to the game.

## Design pillars (don't break these)

1. **Real trade knowledge is the gate, not in-game levels.** Puzzles and flows must be right enough that a working A&P, electrician or FP&A person respects them. Their own words are quoted in `HANDOFF.md`.
2. **Everyone is integral; nobody is gridlocked.** No role can win alone: solo or absent teams stay at tier 1, and a test enforces it. Nobody waits helplessly on another seat; autopilot, deferrals and standing limits exist for that.
3. **Mistakes surface later, not immediately.** From puzzle tier 2, real jobs are "blind" (`PuzzleParams.blind`): no verdict, no score. Wrong work becomes a hidden defect, a receiving return or an incident traced to the signer.
4. **Snappy on a phone, and it works on a computer.** 44px targets, 360–390px widths, keyboard-aware sheets. Desktop at 1280px too.
5. **It's live.** Every change must load, render and resolve old island docs. See "Version gate" below.

## Repo map

- `island-company/src/sim/`: the game. It is pure and deterministic; no `Date.now()` or `Math.random()` in sim code (use the seeded `rng`/`hashSeed`).
  - `engine.ts`: `apply(state, action, now)` returns `{s}` or `{error}`; also `resolveWeek`, `ENGINE_VERSION`, autopilot.
  - `types.ts`: `IslandState`, `Order`, the `Action` union, `WEEK_BOUND` (actions that carry a week stamp).
  - `data.ts`: tuning and content, including `ECON`, `CATALOG`, `TOOLS`, `REPORTS`, `DEFECT_RULES`, `INSPECTS`, `CHAIN`, `GSE`.
  - `econ.ts`: the credit curve, `SIGNOFF` 0.6, `isBlind`/`launchTier`, capacity.
  - `chain.ts`: the part chain (IPC → logbooks → engineering approval).
  - `aircraft.ts`: seeded aircraft identity, logbooks, IPC figures, AMM task cards. Derived, never stored.
  - `growth.ts`: island development visuals.
  - `bots.ts`: the paper-sim crews (`simulate`, `TEAMS`).
- `src/puzzles/`: 19 hands-on puzzles, registered in `index.ts`. Shared helpers are in `kit.ts` (loop, settle, suspendLoops); `types.ts` has `PuzzleParams`/`PuzzleContext`.
- `src/ui/`:
  - `home.tsx` (Dock / End turn), `ops.tsx` (tech panel), `desk.tsx` (analyst), `orders.tsx`
  - `manual.tsx`, `chain.tsx`, `gse.tsx`, `crewboard.tsx` (board + DMs), `puzzlehost.tsx`
  - `island.tsx` + `island/*.tsx` (SVG island), `select.ts` (selectors, `launchFor`), `useIsland.ts`, `kit.tsx` (`Sheet`)
- `src/net/`:
  - `firebase.ts`: `DOC_VERSION`, transactions, the offline outbox, session recovery, the `ic:stale` reload
  - `store.ts`; `session.ts` (per-device refs)
  - Pass-and-play uses a local store.
- `src/main.tsx`: service worker registration; reload on `controllerchange` or `ic:stale`, throttled to once a minute.
- `vite.config.ts`: generates `dist/sw.js` (precache).
- `firestore.rules`, `firebase.json`, `.firebaserc`, `.env.production`. The web config is public by design; security is the rules.
- `tests/`: vitest. `skew.test.ts` + `tests/fixtures/` hold docs written by older live builds.
- `scripts/`:
  - `balance.ts`: the paper sim
  - `e2e.mjs`: pass-and-play in Chromium
  - `e2e-online.mjs`: 4 devices against the Firebase emulator
  - `island-shots.mjs`: island lab screenshots and node counts
  - `check-commits.ts`: the commit-message check before a deploy push (HANDOFF §6.4 item 7)
- Labs (dev server):
  - `/lab.html?p=<puzzle>&tier=0-5&seed=N&notimer=1[&blind=1]`
  - `/islandlab.html?w=358[&only=<scene>][&still]`
- `docs/`:
  - `DECISIONS.md`: the decision log. Append to it; it is the project's memory.
  - `ONBOARDING.md`: the player guide.
  - `JOBFLOW.md`: the job-flow spec, once merged.

## Commands (run from `island-company/`)

```bash
npm ci
npm run dev                                   # http://localhost:5173 (strictPort)
npx tsc --noEmit -p .                         # typecheck
npx vitest run                                # all tests
npx tsx scripts/balance.ts                    # paper sim, 26 wk x 30 seeds
npx tsx scripts/balance.ts robust             # 90 seeds x 4 crews (+ the long game's columns)
npx tsx scripts/balance.ts long [78]          # the long game: 52 wk x 30 seeds, the T1 table + the trajectory (docs/EXPANSION.md 11.1); 78 plays on to week 78
npm run build                                 # tsc + vite build (then rm -rf dist)
BASE=http://localhost:5173 node scripts/e2e.mjs /tmp/e2e [desktop]
TRAILER='<your attribution line>' npx tsx scripts/check-commits.ts [base]   # every commit the push publishes (base..HEAD) ends with it
```

- **Chromium for scripts:** the scripts launch the browser from `scripts/chromium.mjs`: `$CHROMIUM_PATH`, else `/opt/pw-browsers/chromium` (the cloud container's path) if it exists, else Playwright's own install (`npx playwright@1.56 install chromium`).
- **Online e2e:** needs Java (21+ for `firebase-tools@15`; `@14` runs on Java 11–17) plus `npx --yes firebase-tools@15 emulators:start --only firestore,auth --project demo-island`, and a second Vite with the emulator env. Parallel runs on one host use their own emulator ports (`VITE_FB_FS_PORT`, `VITE_FB_AUTH_PORT`). The header of `scripts/e2e-online.mjs` has the steps.

## Invariants every change must keep

- **Old docs keep working.** Every new state field is optional with a safe default. Add a migration test using fixtures written by the *previous live commit*.
- **Version gate.** When an engine change would let an old open client corrupt a new doc:
  - bump `ENGINE_VERSION` (engine.ts) and `DOC_VERSION` (net/firebase.ts)
  - change `firestore.rules` to `request.resource.data.v == N`
  - deploy hosting and rules together (the Action does this)
  - extend `tests/skew.test.ts`
  Old clients get permission-denied and reload.
- **Week stamps.** Any action that changes the week's economics goes in `WEEK_BOUND` and carries `week`.
- **Never store derivable data in the island doc** (aircraft records, catalogs, search indexes). Keep any history bounded, e.g. 26 weeks of sparse aggregates.
- **Balance targets** (paper sim, standard 30-seed run):
  - "three friends" and "all average" reach tier 5 around weeks 21–23 with **0 weeks below $0**
  - solo and absent teams stay at tier 1
  - the pacing-guard test holds
  - always report the robust sweep too
- **Island SVG budget:** the beaten scene stays at 1500 nodes or fewer (islandlab, w=358).
- **Whole-season sim tests** need `vi.setConfig({ testTimeout: 30000 })`. The CI runner has 2 cores and is about 1.5× slower than dev boxes. A deploy was blocked once by this.
- **Playwright checks:** puzzles must stay deterministic in `generate`/`score`, lock on `timeUp`, clean up in `destroy`, and finish via `settle()`/`host.hold`.

## Deploy and verification

- **Deploying = pushing** to `claude/jolly-keller-gy5hs4` (or `main`) with changes under `island-company/**`. GitHub Action **Deploy island** (`.github/workflows/deploy-island.yml`) runs `npm ci` → `npm test` → build → Firebase Hosting → Firestore rules. It uses the repo secret `FIREBASE_SERVICE_ACCOUNT`.
- **Credentials:** never ask anyone to paste keys or tokens into chat.
- **Watch the run:** `gh run list --workflow deploy-island.yml -L 3`, then `gh run watch <id> --exit-status`, and `gh run view <id> --log-failed` on failure. Root-cause every failure; never re-run blindly or skip tests.
- **After a deploy that changes rules or the version:** probe the live rules with the Node Firebase SDK. Sign in anonymously, attempt a write with the OLD `v` (it must be refused), then delete that anonymous user. **Never create stray island docs in production.**
- **Don't delete users in Firebase Auth.** They are the crew's devices; deleting one breaks that device's seat link.
- **Tell the crew to close and reopen the app** after a version bump.

## Git conventions

- Never rewrite pushed history.
- Never create a PR unless the owner asks.
- Commit messages: end with the attribution trailer your Claude Code session is configured with, as the very last line (nothing after it: no session line, no leftover `# Conflicts:` block from a merge). Never put model names or ids in code, docs or commit bodies. `scripts/check-commits.ts` checks every unpushed commit before a deploy.
- Parallel agent work happens in `git worktree`s under `.claude/worktrees/<branch>` (gitignored).
  - Symlink `island-company/node_modules` into each worktree.
  - Give each agent its own dev-server port and its own `VITE_CACHE_DIR`.
  - Integrate with `git merge --no-ff`.

## Working with the owner (Seb)

- **Tone:** "robot clear": direct, efficient, slightly informal, no fluff.
- **Numbers:** be explicit about units, denominators and time windows.
- **Push back:** challenge assumptions and say so plainly. Present competing hypotheses when the data supports more than one (Hickam). Warn when a metric could be gamed (Goodhart).
- **Format:** headings and bullets. For non-trivial work: restate the goal, list assumptions, then steps, the answer, and quick checks.
- **Ambiguity:** clarify only when it blocks correctness; otherwise pick the best assumption and label it.
- **Decision log:** log key decisions in `docs/DECISIONS.md`. If the Desktop Commander MCP ("Gimble", the owner's second brain) is available, write key findings there too.
- **Big features:** the owner likes multi-agent workflows. See the playbook in `HANDOFF.md` and the templates in `docs/handoff/workflows/`.
