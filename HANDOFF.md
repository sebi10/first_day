# Handoff: moving Island Company from the cloud session to local Claude Code

The rules that don't change are in `CLAUDE.md`. This file is the state of play as of **2026-09-29** (branch `gaps`: the stage 1 release gate; the live build as of 2026-09-28, about 02:25 UTC), plus the playbook for working the way the cloud session did: multi-agent builds, reviews, testing, deploys and monitoring. Update the "State" sections when things land.

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
   - **Local, not pushed:** branch `gaps` has, all under one **v4 version gate** (`ENGINE_VERSION` 4, `DOC_VERSION` 4, rules `v == 4`; proof in `docs/DECISIONS.md` "2026-09-28: integrating the job-flow gap fixes; the v4 version gate"):
     - the four job-flow gap fixes (the known gaps in §3)
     - the robust-tail work (`2241f22`): L1 the county's inspection calendar, B a job planned ahead of its due week is on schedule, L3 a crew project part covered by autopilot at 50% after a two-week absence, L4 autopilot's covered inspections pass. L2 (throttling the generator) was tried and rejected: no effect.
     - review round 1 ("Gap fixes: review round 1", DECISIONS 2026-09-28): the sub-charter's cover capped at what the twin would have flown, the floatplane auction paid for (by autopilot at the fair price, by the bots at their bid; a lost bid leaves the part open), the feeder's blind re-test shows its reading, the MEL ask on the sent job and on End turn, L3 needs two missed resolves in a row, and 20-odd wording and layout fixes
     - **Stage 1 of `docs/EXPANSION.md` = `gaps` + A0 ("a Resort that holds") + its review round 1, all under this v4 gate** (DECISIONS "2026-09-29: A0" and "2026-09-29: A0 review round 1"). From tier 4: the grid's feed at real risk goes first (a must-do, above code prep, for the bots, autopilot and the Dock), code inspections every 13 weeks, a booked week wears a house 1 (not 2), a maintained asset (70+) decays 3 (not 5), and the credits' A streak pauses on an autopilot week graded A (only Resort weeks count). (A0's "a dark house doesn't decay" was dropped in review round 1.) Tested and not kept: no "+1 alert tier under 50" (no effect). New: `npx tsx scripts/balance.ts long` (52 weeks × 30 seeds, the T1 table) and a long column in `robust`; `tests/golden.test.ts` holds the digests (four 26-week and five 52-week runs since the release gate, every week's doc) stages 2 and 3 must reproduce with their features unused.
       - The long game on A0 alone (weeks 24–52, 30 seeds): three friends below $0 in 30/30 → 18/30 games (median game 14 → 1 week), all average 30/30 → 7/30 (12 → 0). **But A0 only delayed the collapse** (review round 1, `balance.ts long 78`): about 13 weeks for three friends and 26 for all average. At week 52 their houses were at health 4 and 8 with 0 of 7 rentable, cash falling about $10,800 and $5,200 a week, and 30/30 and 27/30 games went below $0 in weeks 53–78. The 52-week cash columns hid it.
     - **A0 review round 1** (DECISIONS "2026-09-29: A0 review round 1"), same v4 gate:
       - **the credits count only weeks played at the Resort** (a Harbor streak paid out the week the Resort arrived) and land on a full-crew week; the pause is said in the review, on the Endgame card and as a ringed A in *Last 12 weeks*
       - **the electrician's helper** (the line-crew NPC): the analyst hires one from tier 4 ($280 a week at skill 3); at the resolve they do the electrician's planned routine jobs (two a week at 60%), never the licensed work, and their rounds let the alert flow grow with them. This is the lever (the attribution table in DECISIONS). **Held back since the release gate (below): off in this release.**
       - **the receiver** funds safety-critical work up to $1,500 a week (into the bridge loan) and takes its payment only out of cash above $0; the crew is told the way out
       - grid first only at real risk and only on the feed, a lapsed house's prep first while the grid holds at 48+; a dark house decays again ((g) dropped); the cottage plan counts its upkeep; the Harbor sheet, tick marks on the health bars; `balance.ts long [78]` prints the trajectory; the golden digests read every week's doc with four 52-week runs and a knob-flip test; a phone-width overflow fix on the approval card and toasts
       - **long game now** (weeks 24–52): three friends 3/30 games below $0 (median 0 weeks, 0 dead weeks), 6 of 7 houses rentable at week 52, revenue 69% of budget in weeks 40–52; all average 1/30, 7 of 7, 86%. Past week 52: all average holds through week 78 (7 of 7 rentable); **three friends still slide** (houses 46 → 35 → 26 at weeks 52 / 65 / 78, 2 of 7 rentable at week 78, 11/30 games below $0 in weeks 53–78). **T1: three friends and all average meet every line but the credits.** The credits, counted honestly, are 0/30 for both (all good 50% by week 45); that's the goal (the tier-5 budget or the A band), a gate.
       - T0 holds: standard medians unchanged (8 / 11 / 16 / 23 and 7 / 12 / 16 / 23, 0 weeks below $0); robust misses 69 → 70 and 63 → 58, 0 weeks below $0; the long robust columns 247 → 61 and 100 → 12 of 360 games below $0 in weeks 24–52.
       - **Seb's call (EXPANSION §11.2):** ship stages 2/3 on this (the network's T2 is measured at week 52, where three friends now hold; their slide after it is the known caveat), or keep working the long game: the credits' gate, and three friends' post-52 slide (the licensed work at tier-5 skill). Also yours: the helper's price and scope, the receiver's terms (an asset sale or a restart at the Harbor weren't built).
     - **A0 review round 2** (DECISIONS "2026-09-29: A0 review round 2"): commit messages only, no game change. `a46bd49` (the expansion-spec merge) ended with git's leftover `# Conflicts:` block after the trailer; it and the three commits after it were reworded with identical trees, so the release SHAs changed: `a46bd49` → `09ca693`, `25afc96` (A0) → `e4908db`, `c57c51e` (A0 review round 1, the tree release QA passed) → `dd73915`, `f398ed4` → `4a7ff22`. Work built on the old SHAs (the wfG0 experiment worktrees sit on the old `25afc96`) goes on with `git rebase --onto e4908db 25afc96` or as a patch, never a merge: a merge would bring the old messages back, and `scripts/check-commits.ts` would fail it. `abda756` (already pushed, it ends with a session line) stays as it is: it isn't in what the push publishes.
     - **The stage 1 release gate** (DECISIONS "2026-09-29: stage 1 release gate"; commit "Stage 1 release gate fixes"), same v4 gate, after three reviews (correctness, live docs, pillars):
       - **the electrician's helper is held back: `STAFF.helper.enabled` false.** It isn't on the board, has no effect, and the bots never hire one; the code, its tests (run with it on) and its docs stay. **It waits for Seb's call** (open decisions below). If he says yes, it's already narrowed: device swaps only, only what was ready when the electrician ended the turn, never in a week they're away, never a hazard's fix, named on the trace, the closed job, the review and the chip.
       - **live islands keep their credits streak** (`stats.aCarry`, stamped once by `migrate` on a doc an older engine wrote): it counts in full until a week below A, and the Board and the Harbor sheet say so. `stats.v4From` stops the Board ringing weeks the old engine resolved.
       - grid first no longer masked by an open fuel-dock job; the receiver funds only a batch's safety-critical share (the $2,000 freeze too), says its 15% fee on the card and in the feed, keeps the loan a 10-week loan, gives a second receivership its bridge loan, books *Financing in* in the review, and says the week in plain numbers (no "way out" promise)
       - numbers: 868 tests in 50 files; standard T0 unchanged (8 / 11 / 16 / 23 and 7 / 12 / 16 / 23, 0 weeks below $0); robust misses 70 and 64 (58 with the helper); **long T1 not met on the release build**: three friends 18 of 30 games below $0 and 0 of 7 houses rentable at week 52, all average 8 of 30 and 0 of 7 (A0 alone, as predicted for the helper off). Golden digests re-recorded, plus a ninth run (all average seed 4, 52 weeks); the reasons are in DECISIONS.
       - **Before deploying, Seb (read-only in the console; prod is off limits to agents):** does any live island have tier ≥ 4 and `stats.aStreak` > 0 (the carry covers it: tell that crew their streak counts), or sit in receivership with cash below $0 (stage 1 has no way out for it: tell them before, not after)?
     - After that deploy: `probe-gate.mts` with OLD_V=3 NEW_V=4, and tell the crew to close and reopen the app. `island-company/scripts/reverse-skew.ts` re-runs the old engine against docs this build writes (on bd1e1d2: 173 of 173 moves refused).
   - **Stage 2 = v5, branch `s2rel`** (local, not pushed; from the live `e810cc5`, stage 1 deployed 2026-09-29). **`ENGINE_VERSION` 5, `DOC_VERSION` 5, rules `v == 5`** (bumped by G0; the rest of the v5 gate is still to do: reverse skew with `e810cc5`, the rules probe, the online e2e). It holds:
     - **the free map** (B1): a free camera on phone and computer, presets, Explore, hotspots on every object
     - **per-seat objects and quick checks** (A1 + C1): every object's inspect sheet in each seat's words and moves, one quick check a week per tech (the walkaround, the IR scan, the meter check), *Report a problem* across trades (DECISIONS "stage 2 on the live stage 1")
     - **G0, the Resort holds for 64 weeks** (DECISIONS "2026-09-30: G0"): **the builder's warranty** (from tier 4 new construction loses 1 a week untouched for 26 weeks), **the service upgrade** (tier 4: the grid's new transformer and feeder; tier 5: the Resort's standby set; both under the warranty), **renovations** (the analyst's capex on a house at 75 or below from the Staff desk or its sheet; the builders close it for two work units; the electrician's **permit final** reopens it at 85 under a 13-week warranty; one per house every 26 weeks), the fin bot's renovation policy, a **one-time migration** for live islands at tier 4–5 (the warranty dated from their buildings, the upgrade at release), and a v5 What's new panel. The helper stays off.
     - **Numbers:** 1,029 tests; standard T0 unchanged; robust misses 61 and 39 of 360; **`long64`: three friends and all average 0/30 games below $0 and 0/30 receiverships in weeks 24–64, houses 59 and 71 at week 64** (the live e810cc5: 28/30 and 17/30 games below $0, houses 3 and 3).
   - **Seb's calls for stage 2:**
     - **The credits' goal, one data switch (`GOAL.rule` in `data.ts`).** `streak` (the default, as live: 8 full-crew A weeks at the Resort, none below A): the credits by week 52 in **0/30** three-friends and **0/30** all-average games. `quarter` (two months on plan at the Resort: of the last 8 counted Resort weeks, 6 at B or better and revenue at 85% of budget): **25/30 (median week 36)** and **30/30 (week 34)**. Same play either way: only when the credits land changes. `quarter` reads the week reports, so a live island's Resort weeks count the moment it's flipped. Autopilot weeks never win it (a week on plan with a seat on autopilot pauses the count); solo, absent and nobody crews never win under either (tested over 64 weeks).
     - **The renovation cooldown** (`RENO.cooldown`): 26 weeks (the brief's, the default) costs three friends 7/30 receiverships in weeks 65–91 against 3/30 with 13 (13 never binds the fin bot but still stops a renovation inside a renovation's warranty).
     - **Ship stage 2 soon:** live three-friends islands switched at week 26 go into receivership 4/30 by week 64 (12/30 without G0's migration); switched at week 39, 20/30 (their houses are at 23 by then on stage 1).
3. **First local tasks:**
   - set up the machine (§4), then `git pull`
   - make the scripts' Chromium path portable (§4.3)
   - run the full check suite (§6.4 items 1–4)
   - get the crew to playtest on real phones, then act on their feedback (the backlog in §7 lists what's known)
4. **Open owner decisions** (defaults are what's live):
   - **Builders speed-up:** should NPC builders be able to speed up a tier, by up to 2 weeks when staffed and supplied, but never delay it? Live default: no. Builders set how good new buildings start and can build extra cottages, but never change when a tier arrives.
   - **Wages scale** (`docs/JOBFLOW.md` §23, question 4): a skill-3 pilot is $320 a week and a builder $260. Scale 2.5–3× with overhead cut to match, so a hire is real money? Live default: as is, tune after a playtest. It changes every island's P&L.
   - The spec's other open questions (§23, 1–3 and 5–7) run on their bracketed defaults.
   - **The electrician's helper (branch `gaps`, A0 review round 1): waits for Seb's call. OFF in this release** (`STAFF.helper.enabled` false, the release gate: the pillars review said hold it back; an NPC putting in the electrician's jobs breaks "NPCs never do trade work", JOBFLOW 15 and EXPANSION 7). Built and tested, narrowed per the review: an NPC the analyst hires from tier 4, $280 a week at skill 3, who puts in two of the electrician's *planned* receptacle, GFCI and 3-way swaps or the generator's circuit test a week at the resolve, only what was ready when the electrician ended the turn, never in a week they're away, never a hazard's fix, named everywhere; their rounds let the alert flow grow by as much. **The price of each answer (long game, weeks 24–52):** off (this release), three friends 18 of 30 games below $0 with 0 of 7 houses rentable at week 52, all average 8 of 30 and 0 of 7; on with the narrowed scope, three friends 2 of 10 games below $0 (seeds 1–10) with houses about 19 and 2 of 7 rentable, all average 0 of 10 and 6 of 7; the old broader scope (diagnosis-led jobs too) held the houses at about 40–48. If yes: flip the flag, add a *Give to helper* toggle on each ready job (bots always hand), rewrite JOBFLOW 15 and EXPANSION 7 with the decision, and re-record the golden digests. The live A0 slide starts around week 33 on the live late fixture: an island at week 20 leaves about 2 real weeks to decide.
   - **The credits' goal (branch `gaps`):** counted honestly (8 full-crew A weeks at the Resort, none below A), three friends and all average reach them in 0 of 30 games by week 45 (the A-grade share of Resort weeks 7% and 13% on the release build); all good in about half by week 45. The friends will spend every Resort week with the win out of reach. A reachable goal needs a gate change (8 A weeks in any 12, 6 in a row, or grading the Resort against a revenue budget they can reach; keep "full crew" and the autopilot pause). Default: as built (no change). Live streaks earned before v4 are carried (the release gate).
   - **The receiver's terms (branch `gaps`):** it funds $1,500 a week of safety-critical repairs into the bridge loan (15%) while overhead and payroll run on; an island deep below $0 never gets out (78-week sims: 10 of 30 three-friends and 20 of 30 mistakes games end in receivership; the three live receivership docs end $183k–260k down after 14 weeks, as on `db306aa`). The release gate made it honest (the fee, the loan's term, a second bridge loan, plain numbers), not survivable. Levers: freeze the overhead, furlough the grounded pilots, size the allowance to reopen one house in a stated number of weeks, an asset sale or a restart at the Harbor.
   - **Crew project cover (branch `gaps`, a pillar-level rule):** a friend away **two resolves in a row** gets their part of the tier done by autopilot at 50% (it lowers the new buildings by about 4 health), so nobody waits for good; one missed evening doesn't. Before the branch nobody could do your part. Default as built. Alternatives: 3 weeks, or never (the old rule).
   - **Absence got cheap (branch `gaps`, L4 + the sub-charter, and A0 at the Harbor):** autopilot's covered code prep and 100-hour pass (at the 60% pass mark), so an away seat's island stays solvent at tier 1. From tier 4 a covered code prep renews for **13 weeks** (A0's quarterly schedule), not 8, and autopilot takes the grid-first job before it's due, so an away seat at the Harbor or the Resort costs less still (the electrician's helper, held back since the release gate, never works a week the electrician is away). Weeks below $0 summed over the standard run (30 seeds × 26 weeks), before the tail work (`5532631`) → `gaps` now: elec absent 45 → 0 (mech and fin absent 0 → 0), solo mech 321 → 31, solo elec 331 → 258, solo fin 379 → 12, nobody 459 → 352 (the release build: 31, 254, 9, 352). Every absent and solo team still ends at tier 1 in every seed: tiers still need the full crew, and the credits need eight full-crew A weeks at the Resort. Default as built ("autopilot keeps an away seat's island solvent; tiers still need the full crew"). If absence should sting: a covered inspection renews for half the cadence (4 weeks, or 6 from tier 4), autopilot leaves the grid-first job until it's due, or autopilot's jobs cost labour at the contractor rate.
   - **Robust tail (not met):** three friends miss tier 5 in 102 of 360 robust games (target ≤ 75), all average in 77 (target ≤ 37); weeks below $0 1 and 0. **With A0: 69 (met) and 63 (not met), 0 and 0; with review round 1: 70 and 58, 0 and 0; the release build (helper held back): 70 and 64, 0 and 0.** Most of the jump from 75 / 51 is the sim getting honest: the bots now pay the floatplane deposit a human pays (about $4,560; without it, 69 and 62). Levers, all yours: count the floatplane at book value toward the tier-5 cash gate ($60,000; it's capex the island owns) or finance it; the line-crew NPC (an electrician's helper the analyst hires, JOBFLOW v2) for the electrician's tier-4 overload (a bots-only ceiling test with one extra electrician job a turn gave 67 and 47 before this round). No gate, price or payroll was changed to buy the tail back.

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
  - **on branch `gaps`** (not live): standard three friends 8/11/16/23 and all average 7/12/16/23, both 0 weeks below $0, solo and absent teams at tier 1. Robust after the tail work (`2241f22`): 75 and 51 misses; after review round 1: **102 and 77** (weeks below $0: 1 and 0), because the bots now pay the floatplane deposit (69 and 62 without it). Targets not met; see §1.4 and DECISIONS "2026-09-28: gap fixes, review round 1".
- **Known gaps** (also in §7). All five are fixed on branch `gaps` (not deployed; live still has them):
  - Past due, the only guest plane still flies restricted; there's no mainland sub-charter. *Fixed (`gap-charter`): grounded like any plane, and a sub-charter flies its guests at $270 a flight.*
  - The builders' zoom on Home needs its own zoom box. *Fixed (`gap-zoom`): `siteBox`; the beaten scene is still 1,390 nodes.*
  - The MEL wording in `src/ui/flow/Investigate.tsx` says "Past it, the plane is grounded", which is wrong for the only guest plane (it flies restricted). *Moot (`gap-charter`): it is grounded now, and the words name the sub-charter.*
  - The underground feeder re-splice launches the branch-circuit trace puzzle ("Bedroom is dead · Drywall cutaway"); an electrician would notice. *Fixed (`gap-feeder`): its own "Underground feeder" scene.*
  - `scripts/e2e-online.mjs` stalls if the first alert is a no-fault-found; port `planFirst`'s NFF skip from `scripts/e2e.mjs`. *Fixed (`gap-e2e`), plus configurable emulator ports.*
- **Backup branch `backup/jobflow`** (= `jobflow` at `bdf97ba`) is now redundant; delete it once the owner OKs.
- **The spec's key decisions** (full text: `docs/JOBFLOW.md` §25):
  1. v1 covers the jobs that make up ~90% of the work. Rare jobs keep the diagnosis but come with parts pre-filled.
     - Deferred to v2: ignition, the turbine hot section, calibration, cores, shelf life, line-crew NPCs, morale.
  2. In stock means the tech starts now, paid from the trade's weekly **work budget**. Missing means a requisition to the analyst.
  3. No play-order gridlock:
     - cards stay approvable after the analyst ends their turn
     - a standing auto-approve limit applies at resolve
     - a 1-week-lead part ordered this week arrives at this week's resolve
  4. The only guest plane is grounded past due like any plane, and a mainland sub-charter flies its guests meanwhile ($270 a flight, automatic). Changed 2026-09-28 (branch `gap-charter`); before, overdue, it flew half its flights with near-misses.
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
7. Check commit messages: `git fetch origin`, then from `island-company/` `TRAILER='<your attribution line>' npx tsx scripts/check-commits.ts [base]` (base defaults to `origin/claude/jolly-keller-gy5hs4`). It checks every commit the push publishes (`base..HEAD`, merges too): the trailer is the very last line, no git comment line (a merge's `# Conflicts:` block) is left in, no model is named outside the trailer, and `base` is already in HEAD. Commits already on the remote are outside the range: pushed history is never rewritten. An unpushed commit that fails is reworded with an identical tree (`git filter-branch --msg-filter` over `<first bad>^..<branch>`, or `hash-object` as in DECISIONS "A0 review round 2"); check the trees match (`git diff --quiet old new`), and say which SHAs changed.
8. Push to the deploy branch. If docs were committed there meanwhile, merge `--no-ff` rather than fast-forward.
9. `gh run watch <id> --exit-status`. On failure, `gh run view --log-failed`, root-cause it, reproduce locally, fix and push again. Example: a whole-season test hit vitest's 5 s limit on the 2-core runner; fixed with a per-file `testTimeout`, no assertion changed.
10. Live probe for rules/version changes with `docs/handoff/probe-gate.mts` (how to run it is in its header). It signs in anonymously and tries to update a missing doc with the old and the new `v`, so it never writes a doc, even before the rules propagate. Want `permission-denied` for the old `v` and `not-found` for the new one. It deletes its anonymous user. Then report to the owner, including **"close and reopen the app"** after a version bump.

### 6.5 Gotchas learned the hard way

- **Worktree base:** the `Workflow` agent option `isolation: 'worktree'` starts from the repo's **default branch `master`** (an unrelated first commit). The templates create worktrees explicitly with `git worktree add -b <b> .claude/worktrees/<b> <sha>`.
- **Concurrency:** about 2 agents run at once on a 4-CPU box. Plan wall-clock accordingly; a stronger local machine runs more.
- **Font 403:** the Manrope font 403s through a symlinked `node_modules` in worktrees. It's cosmetic.
- **Dev server port:** Vite's 5173 is `strictPort`. Agents used ports 5190–5230. The cloud container gave each emulator its own host (127.0.0.2–127.0.0.4); macOS has only 127.0.0.1, so locally each emulator gets its own ports instead (`scripts/e2e-online.mjs` header).
- **CI speed:** the runner is about 1.5× slower (§6.4 item 9).
- **The only guest plane:** never let grounding it empty the houses. That can bankrupt the island. Since 2026-09-28 (`gap-charter`) it's grounded past due like any plane and the mainland sub-charter (`subCharterOn`, econ.ts) flies its guests, at a price; the part chain still never opens on it.
- **Anonymous-auth accounts:** deleting one breaks that device's seat. The app has a recovery layer ("Missing or insufficient permissions" → re-sign-in → relink), but still don't delete them.
- **Sim tests:** balance or pacing tests that play whole seasons belong in files with `vi.setConfig({ testTimeout: 30000 })`.

---

## 7. Backlog

1. **Crew playtest on real phones.** Nothing has had a human playtest since the island art, and the job flow changes every seat. Collect friction points per seat.
2. **Owner decisions** (§1): builders speed-up; wages scale.
3. **Job flow follow-ups from review and QA** (§3 "Known gaps"). All five are done on branch `gaps`, with review round 1's fixes, waiting on the v4 release:
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
5. **Robust-sweep tail:** on branch `gaps` three friends miss tier 5 in 102 of 360 robust games (target ≤ 75) and all average in 77 (≤ 37). Tried and kept: the inspection calendar, on-schedule early jobs, the crew-project cover, autopilot's inspections passing (DECISIONS "the robust tail"). Tried and rejected: throttling the generator (no effect). What's left is an owner call (§1.4): the floatplane against the tier-5 cash gate, and the line-crew NPC for the electrician's tier-4 overload.
   - Also from review round 1, not done: **an overdue 100-hour should ground the plane** (14 CFR 91.409(b); today it flies for hire at −6 health a week past its allowance). It needs the 100-hour tied to an airworthiness alert and the flight count, the bots and generator with it, a balance run and a skew test: its own change (a v5 gate if v4 has shipped by then).
6. **Portable Chromium path** in the scripts (§4.3).
7. **Keep `docs/DECISIONS.md` and `docs/ONBOARDING.md` current** with every feature.

## 8. Templates

`docs/handoff/workflows/` holds the actual workflow scripts the cloud session ran. See its README for which pattern each shows and what to adapt: paths, ports, the attribution trailer.
