# Workflow templates

These are the workflow scripts the cloud session ran for Island Company, kept so a local session can reuse the patterns with the Claude Code `Workflow` tool.

**They are templates, not ready to run.** Before reusing one, adapt:

- **Paths:** `MAIN` (the repo, `/home/user/first_day` in the cloud) and `OUT` (the scratch dir, `/tmp/claude-0/...`). Point them at your checkout and at a scratch folder outside the repo.
- **Chromium:** `/opt/pw-browsers/chromium` → your Playwright Chromium (see `HANDOFF.md` §4.3).
- **Ports** (5190–5230) and **emulator hosts** (127.0.0.x) if they clash with something on your machine. On macOS (only 127.0.0.1) give each emulator its own ports instead: see the header of `island-company/scripts/e2e-online.mjs`.
- **Commit trailer:** the `TRAILER` placeholder → your session's attribution trailer.
- **Base commits and branch names:** the shas in them are from the day they ran.

Script API reminders:
- `meta` must be a pure literal.
- There is no `Date.now()`/`Math.random()` in scripts.
- `agent(prompt, {label, phase, schema})` returns structured output when given a JSON schema.
- `parallel()` is a barrier; `pipeline()` streams items through stages.
- Resume with `Workflow({scriptPath, resumeFromRunId})`. Unchanged completed agents replay from cache, and resume works within the same session only.

| File | Pattern it shows | Agents |
|---|---|---|
| `real-job-flow.js` | **The full pipeline.** Design (spec → 2 parallel critics → revise with "Decisions the owner should know about") → engine package → 3 parallel feature packages in their own worktrees → integrate → 3 parallel read-only reviewers → fix → QA, with a fix→QA retry on failure. Includes the owner's words and 13 design decisions (`USER` / `ASSUME` blocks). | ~13 |
| `phase-b-mechanic-flow.js` | **Merge several finished branches, then build on top.** Merge → 2 parallel builders → integrate → 3 reviewers → fix → QA. Its integrate prompt shows how to resume after a killed agent that left uncommitted work. | 9 |
| `realistic-consequences.js` | Engine then UI for one cross-cutting system (blind sign-off, hidden defects, repair→redo, cross-trade reports), then realism/systems/UX reviews and a fix round. | 6 |
| `mechanic-content.js` | **Per-item pipeline** over several puzzles: build → domain-expert review + play review → fix per item → one integrator that wires the catalog and rebalances. | 13 |
| `mechanic-paperwork.js` | A shared data module first (aircraft records/IPC/AMM), then two puzzles built on it in parallel, each with expert + play review and fixes. | 9 |
| `island-art-design-panel.js` | **Judge panel:** four art directions, one designer each in its own worktree and dev server, iterating on screenshots. Then a blind legibility test (a fresh agent reads each design's screenshots without the ground truth, scored in code) and art + tech judges comparing all designs. The owner picks from the finalists. | ~7 |
| `island-art-iterate.js` | **Screenshot critique loop:** build the chosen art, then up to 3 rounds of art-critic + legibility + tech review → fix, until pass. | 12 |

Conventions that made these work are listed in `HANDOFF.md` §6.2: the `ENV`/`USER`/`ASSUME` blocks, read-only reviewers, severity + fix issue lists, own worktree/port/cache per agent, and "look at your screenshots".
