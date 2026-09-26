# Decisions log: where this build departs from the spec, and why

Spec: *Island Company — Game Spec Sheet* (Sep 23, 2026). The brief changed to "free, just for three friends, not on the App Store, snappy". Each deviation below says what changed, why, and how to undo it.

## Platform

| Spec | Built | Why |
| --- | --- | --- |
| Unity 6 URP, iOS/Android store builds | Installable web app (PWA): Preact + TypeScript + Vite | With no App Store, iOS sideloading a Unity build needs a Mac, Xcode, and either $99/yr or a free profile that expires every 7 days. A PWA installs from Safari/Chrome for $0, updates instantly, and also runs on computers. |
| Firebase Auth (phone/Apple/Google) | Anonymous auth + island code + per-seat code | Zero-friction for 3 friends. Seat codes link phone ↔ computer. To upgrade later, add Google sign-in and keep the same `seatHas` check. |
| Cloud Functions resolve the week | Any client resolves inside a Firestore transaction | Cloud Functions need the paid Blaze plan. Resolution is a pure deterministic reducer, so whichever phone sees the deadline first resolves it, and the week-number check makes it idempotent. Trade-off: a phone with a wrong clock could resolve slightly early. That's acceptable among friends. |
| Signed state diffs | Plain transactions, trust-the-friends rules | Anti-tamper matters for strangers, not for 3 friends (Chesterton's fence: it existed for a public game). The island code (≈50 bits) is the key, and listing islands is blocked. |
| FCM push | Optional ntfy.sh topic (free, no server) | FCM sending needs a server key and server. ntfy is a free push relay the clients post to directly. |
| 60k-tri 3D island | Painterly low-poly **SVG** island | Same art direction (palette, facets, time of day, weather, zone zoom) at a fraction of the weight: ≈80 kB gzipped first load, not 150 MB. |
| Monetization | None | Built for friends. |

## Rules clarified (the spec contradicted itself)

1. **Airworthiness bands.** The spec says planes fly at ≥60 but also "incident if flown at <40", which can't both hold if <60 is grounded. Built: **≥60 full schedule (4 flights), 40–59 restricted (2 flights, 10% near-miss per flight), <40 AOG.** This matches the spec's own review example ("2 flights lost: airworthiness 55").
2. **Houses** mirror planes: ≥60 rentable, 40–59 rentable with a 25% outage roll (half refund, near-miss), <40 closed, <30 fire risk (15%/week).
3. **Tier 1 has no cargo plane**, yet parts ride cargo flights. Built: at tier 1 each guest flight carries 1 kit in the hold. From tier 2 the cargo plane carries 3 per flight.
4. **Guests need flights:** each passenger flight brings one party (one house-week). Spare flights sell day-tour charters. Tier 3 adds 2 ferry parties per week (the spec's "guest ferry days"), which frees flights for charters.
5. **Deferral risk** is exactly the spec's formula: 10% at tier 1, +10 per tier, +10 per extra week, cap 60%, incident = 3× the order cost + downstream loss. It rolls the week *after* an order is first carried, so the team always gets one week to react. Undecided cards count as deferred by the analyst. Approved-but-undone orders count against their owner.
6. **Missed turns never count toward unlocks.** Autopilot (50%) keeps the island alive, but those weeks don't add B+ weeks or perfect weeks, and they reset the streak. Without this, the paper sim showed a team where *nobody* played still reaching tier 2 by week 4.
7. **Week pacing.** The next deadline is the first 20:00 (creator's tz) at least 12 h after the week opens. Finishing early resolves immediately, and nobody ever gets a 5-minute week.
8. **Repair budgets.** The spec's "approved budget for repairs" is now two sliders (mechanic and electrician). Jobs under the budget auto-approve when the week opens, so nobody waits on the analyst for a $120 breaker trace. Bigger jobs arrive as swipe cards.
9. **Insurance tiers** (none / standard / premium) are real: weekly premium vs share of incident cost covered.
10. **First week is a guaranteed B or better** (spec), and nothing can fail in week 0.

## Owner direction added during the build (Sep 26)

- **Real trade knowledge is the gate between roles, not in-game levels.** The three players really are an A&P mechanic, an electrician and an FP&A analyst. Every puzzle models the real procedure.
  - Tiers 0–2 teach: sequence numbers, terminal labels, fair-value markers, run-rate guides.
  - From tier 3 that scaffolding is gone. A tradesperson solves it from knowledge, and an outsider mostly guesses.
  - Each puzzle model has a test asserting that no answer-revealing hint survives at tier 3+.
- **Lend a hand replaces the spec's cover rule** (the spec allowed covering after 2 missed turns, at double cost).
  - Anyone may try another trade's job once a week, but only a job that has already waited a week, and never a crew-project part.
  - It always plays at expert difficulty (tier ≥3): no tools, no rule text in the help card.
  - Under 60% is a botch: the asset takes −6 and the job stays open for its owner.
  - Nobody is ever fully gridlocked, and specialisation still matters.
- **Skill keeps paying above a pass.** Work credit = 0.45 + 0.6 × score: a bare pass (60%) restores 81% of the job's gain, a clean job 105%, plus up to +15% from perfect runs. An owner under 40% gets **rework**: the job stays open with a fresh fault (new seed, so no replaying a memorised answer). Inspection sign-offs are pass/fail at 60%. *(Since the consequences update, both rules apply at teaching tiers 0–1 only; from tier 2 a job is signed off blind and hidden defects take their place. See "Consequences" below.)*
- **Crew projects build each new tier.** Qualifying for the next tier opens one job per trade (e.g. tier 2: first cargo load sheet, put cottages 3–4 on the panel, pay the builders by three-way match). The tier arrives the moment all three are done; new buildings start at 60 + 30 × the average score. Autopilot and lend-a-hand can't do a project part.
- **Safety calls and votes.** The mechanic can ground a plane and the electrician can red-tag a house or the generator for the week (no revenue, but no incident rolls). Story cards are a 2-of-3 crew vote.
- **Integral but not gridlocked:**
  - Parallel turns.
  - Auto-approve budgets for small jobs.
  - Autopilot at 50% for missed days.
  - A 12-hour minimum week.
  - Lend a hand.

## Critique round (Sep 26): five review agents, one per area

- **Functional:** week-bound moves carry their week (an offline move can't land in the next week); the review never opens over a running puzzle; joining a held seat fails with "ask for the seat code" instead of silently replacing a friend; the $2,000 freeze exempts safety-critical work (asset under 60, inspections) and receivership comes with one bridge loan (deficit + 2 weeks' fixed + $3k, repaid at 15% over 10 weeks); jobs waiting on parts don't block new hand-work, and a boat brings one kit ($350) when nothing flew; a solved puzzle's result is locked in before its finish animation; "nothing can fail until week 3" is now literally true; an unallocated A bonus goes to reserve.
- **Balance / systems:** see the table below; plus crew projects, safety calls, votes, the load sheet gating charters, weather-capped grading and the credit curve above.
- **UX:** the clock starts on your first touch, Back before touching costs nothing, help stays until you tap it, wrong input shakes and says so; meter and panel labels no longer overlap.
- **Performance:** island motion pauses when idle, covered or off-screen (main thread 28% → 0.3% busy at 4× CPU); puzzle canvases idle at 30 → 10 fps and stop under cards; cold start reopens the last island (≈140 ms, offline too); online moves show instantly.
- **Squawks** (systems finding "the trades make almost no decisions"): once a week each trade writes up a job it judges an asset needs; the analyst sees "Written up by <name>" on the card. A hard work cap was considered and rejected: it adds friction, not choices.
- **Not done yet:** lazy-loading puzzles (≈86 kB gzipped off the first load); fully on-demand canvas redraws; moving the top-heavy puzzles' targets into the thumb zone.

## Additions (beyond MVP scope)

- **Six more real-life puzzles** (15 total): weight and balance, safety wire, multimeter diagnosis, conduit bending, bank reconciliation, three-way match. Every role now has five puzzle types, each modelled on the actual procedure.
- **All 5 island tiers** are data-driven in `src/sim/data.ts` (spec MVP was tiers 1–2). Tiers 3–5 add storms, the ferry, the generator, a floatplane, villas, a lodge, and night flights.
- **Pass-and-play** on one device, plus **move to online** with progress intact.
- **Desktop layout** (two columns), keyboard approvals (← defer, → approve, ↑ counter), Esc to close.
- **Story cards** every 3-week B+ streak (6 at launch).
- **Analyst money hunts:** each week's close alternates between variance find and bank reconciliation, plus a three-way match whenever last week's spend was ≥ $500. Each recovers a hidden leak, so an absent analyst costs real money.

## Consequences: blind sign-off, hidden defects, repairs, cross-trade reports

Owner direction: *"If we mess something up we shouldn't see an immediate sign that we're wrong, so it's realistic, and there's an incident if we mess up."* Plus: *"I get a chance to fix it with a reasonable repair, and then I have to complete the original task."* And: *"Cross-dependency reports from random things, using all 3 jobs."*

**Blind sign-off.** A real work order launched at puzzle tier 2+ gives no verdict. The result says "Signed off", with no score, and the order card shows no %.
- Not blind: tiers 0–1 (teaching), week 0, practice and the weekly challenge, lend-a-hand (an explicit expert try that keeps its botch rule), and a new player's grace weeks (they play tier 1).
- The engine still records the true score and uses it for credit, health, XP and the defect roll.
- Blind jobs never go back for rework. A signed-off inspection counts as done in the logbook whatever it missed; what it missed becomes a hidden defect.
- Feed lines and the review's MVP line never show a blind score.

**Hidden defects.** A mechanic or electrician job on an asset can leave a latent defect. Crew-project parts and desk work can't.
- The roll is seeded from the order and uses the true score q:
  - q ≥ 0.85: none.
  - 0.6 ≤ q < 0.85: (0.85 − q) × 0.2.
  - q < 0.6: 10% + 1.8 per point under 0.6.
  - Under 0.4 it is severe.
- Defects live in `s.defects` and are never shown. They surface 1–4 weeks later (1–2 if severe), never before week 3.
- A grounded or red-tagged asset can't fail in service, so its defect waits a week.
- **Found first:** a passed (≥ 60%) inspection-type job by the same trade on the same asset finds defects left in an earlier week. No incident: the feed and review say "Ana's 100-hr inspection found under-torqued fasteners on Twin N-12, left from week 5". These jobs count as inspections:
  - 100-hr inspection, wheel-half penetrant check, wing-spar inspection.
  - Oil change (the engine look-over and filter check).
  - Code inspection prep, outlet trace, flicker diagnosis.
  - Generator circuit test, panel diagnosis.
- **Surfaces:** otherwise it becomes an incident (kind `defect`). It costs 1.2× the original job's cost (2.5× if severe), takes −12 / −25 health, and counts like any incident: insurance, safety grade, clean-week unlocks, guest refunds.
- The review traces it: "Fasteners worked loose in service on Twin N-12: traced to the prop bolt re-torque Ana signed off in week 5."

**Repair, then the original task.** A found or surfaced defect creates a repair for the same trade and asset. It uses a different puzzle, per the table in `DEFECT_RULES` (for example torque → teardown "Replace the stretched fasteners", trace → meter "Find the arcing connection").
- Unknown puzzles fall back to a per-trade default, so new puzzles from other branches just add a row.
- The repair goes to the analyst as a normal pending card at 0.6× the original's cost. It counts as safety-critical, so it can be approved through a cash freeze. Deferring it rolls deferral risk like any job.
- It restores a small amount of health, plus half of what an incident took.
- Finishing the repair spawns the **redo**: "<original title> (redo)", ready, cost 0 (already paid), restoring the original's gain.
- A botched repair or redo can leave a defect again, so the chain continues. A load sheet has no redo, because it's redone every week anyway.

**Cross-trade reports** (`REPORTS` in data.ts: 10 reports, and every trade both reports and fixes).
- From week 3, each week has a 30% chance of a new report, if fewer than 2 are open and the fixer has none.
- A report is a ready card for the fixer: a small cost paid at once, no approval.
- While it's open:
  - **cap:** the reporter gets 2 jobs per turn, or 1 desk task for the analyst. They see "Hangar lights out: 2 jobs max until Ben fixes them."
  - **leak:** it costs cash every resolved week, shown as a review line and `costs.reports`.
- A fix that fails a pass always comes back 1–2 weeks later ("…again. The fix from week 5 didn't hold."). A sloppy pass comes back with the defect-curve chance.
- At teaching tiers, a fix under 40% stays open for rework, like any job.
- Autopilot patches a missed fixer's report at 50% on top of its two jobs, so it always comes back.

**Paper sim.** Bots fix a crewmate's report as a favour on top of their usual jobs. They rank repairs and redos as urgent, and the analyst treats repairs as safety work.
- The sim now draws attendance and turn order from their own random stream, and gives each seat's week its own stream too.
- Before this change, one extra job shifted every later absence roll. A rule change then showed up as a different crew having a different run of holidays. Seed 3 "collapsed" only because the electrician happened to be away 6 of 8 weeks.
- Before/after runs now compare the same crew weeks. `npm run balance -- robust` re-rolls the crews 4 ways over 90 seeds.

**Tuning** (spec value → shipped), all in `DEFECT` / `REPORT` in data.ts:

| Knob | Spec | Shipped | Why |
| --- | --- | --- | --- |
| Defect chance, 0.6 ≤ q < 0.85 | (0.85 − q) × 0.4 | × 0.2 | The three-friends bots live in this band from tier 3. At 0.4, tier 4 tipped into deferral spirals. |
| Defect chance, q < 0.6 | 10% + 1.8/pt | unchanged | A real botch should bite. |
| Weeks until a defect surfaces | 1–3 | 1–4 (severe 1–2) | Gives an inspection a real chance to catch it: about ⅓ are now found first. |
| Incident cost | 1.5× / 3× | 1.2× / 2.5× | Big-ticket jobs (a $2,900 panel upgrade) made one defect a $6k+ hit. |
| Repair cost | ~0.8× | 0.6× | Same reason. |
| Report chance per week | ~0.4 | 0.3 | Each report costs a job slot plus the reporter's cap. |

Results, same bots, 26 weeks × 30 seeds (`npm run balance`):

| Team | Consequences | Wk → T5 | Weeks < $0 | Min cash | Incidents / wk | **Defect incidents / wk** | Revenue / wk |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Three friends | off | 22 | 0 | $6,444 | 0.12 | — | $9,767 |
| Three friends | **on** | **22** | **0** | $6,226 | 0.29 | **0.109** (≈3 a season; about 1 more a season is caught by an inspection first) | $9,322 |
| All average | off | 21 | 0 | $6,521 | 0.08 | — | $10,414 |
| All average | **on** | **21** | **0** | $6,521 | 0.24 | **0.086** | $9,912 |
| All good | on | 21 | 0 | $6,493 | 0.03 | 0.009 | $11,936 |
| Every solo / absent team | on | stays at tier 1 | | | | | |

Robustness (`npm run balance -- robust`, 90 seeds × 4 crews = 360 games per team):
- **Three friends:** 0 weeks below $0 (1 with consequences off). 53 of 360 miss tier 5 by week 26 (38 with them off).
- **All average:** 0 weeks below $0. 31 of 360 miss tier 5 (11 with them off).
- **Median tier 5:** week 22–23.
- Consequences make tier 5 a little less certain without making the island go broke.
- Defect incidents are about ⅓ of all incidents for three friends: noticeable, not dominant. Deferrals are still the main risk.

**Knobs if it feels too soft or too harsh:** `DEFECT.slope` (0.2), `REPORT.chance` (0.3), and the `INSPECTS` list (more inspection types means more defects caught before they fail). Re-run `npm run balance -- robust` after any change. Tier 4 ($7k/week fixed) is where it tips.

## Balance (paper sim, `npm run balance`): 26 weeks × 30 seeds, medians

Retuned after the balance and systems critiques, then re-run after crew projects, the credit curve and the functional fixes (Sep 26). The table below predates the consequences above; see that section for current numbers.

| Team | Tier at wk 26 | Wk → T2 / T3 / T4 / T5 | % weeks B+ | Min cash | Weeks < $0 |
| --- | --- | --- | --- | --- | --- |
| All good | 5 | 5 / 8 / 16 / 21 | 100% | $6,456 | 0 |
| All average (3 jobs/turn, 10% missed turns) | 5 | 7 / 10 / 16 / 21 | 91% | $6,126 | 0 |
| **Three friends** (skill drops with tier, absences in streaks) | 5 | 7 / 11 / 16 / 22 | 90% | $5,882 | 0 |
| Naive analyst (approves everything, never prices) | 3 | 5 / 13 / — / — | 100% | $5,962 | 0 |
| Any role absent / any solo player | 1 | — | 37–100% | down to −$133k | up to 409 of 780 |

Knife-edge found on the way: with the new credit curve, "inspection renewed only at credit ≥ 1" silently stopped renewals and the average team collapsed at tier 4 (−$83k). Sign-off is now pass/fail at 60%, and the collapse is gone. Lesson: the economy has thin margins at tier 4 ($7k/week fixed), so any change to repair throughput needs a sim run.

What changed and why:

- **Death spiral fixed.** Approved jobs waiting for a part no longer roll deferral incidents. Before, a grounded twin at tier 1 meant parts could never land and a 60% incident every week, forever.
- **Pacing.**
  - Tier 3 now needs $18k (was $25k).
  - Tier 4 needs 15 weeks (was 12).
  - Tier 5 needs 20 weeks and $60k (was 24 weeks and $100k).
  - Fixed costs at tier 4 / 5 are $7,000 / $9,500 (were $5,500 / $7,500).
  - Every tier now lasts long enough to matter: roughly 4 / 5 / 6 / 5 weeks, then the endgame.
- **Difficulty climbs with the island.**
  - Ops order tier = catalog tier + ⌊island tier / 2⌋.
  - The analyst's tier gains a step every 20 weeks (was 10).
  - Expert tiers (3+, no teaching aids) arrive from about week 5–9.
- **Approvals matter again.** Auto-approve is petty cash only: parts-free, tier ≤2, ≤$150 per tier, capped at one week's fixed cost. Bigger work always comes to the analyst as a card.
- **Insurance is a real call.**
  - Storms (tier 3+) cause claims in 60% of storm weeks: $1,500 plus $1,000 per tier above 2.
  - Wind claims can happen from tier 2.
  - Premiums are $150 / $320.
- **Mastery pays.**
  - A perfect job holds: the asset skips next week's decay.
  - The forecast bonus is up to $1,400 × tier factor.
- **Puzzle time budgets:** tier difficulty is never a race. Invoice gets about 24 s per card at every tier; reconcile gets 50 + 21 × tier; teardown gets 60 + 22 × tier.
- **Critical assets always get a job:**
  - An asset under 45 health with nothing open on it jumps the queue, even past the cap (8).
  - Before, a clogged queue let the grid rot to 5.

Spec phase-0 exit tests, automated in `tests/engine.test.ts`:

- **No role can win alone.** Pass: every solo team stays at tier 1.
- **No week ends with cash < 0 under sensible play.** Pass: minimum $5,882, including the three-friends team.
- **Every unlock is reachable within 26 weeks.** Pass: tier 5 by week 21–22.

**Goodhart warning.** The board grade weights revenue at 40%, so an analyst can inflate it by pricing up. The rate cap (2× base) limits that, occupancy falls off a logistic curve, and empty houses cost the electrician's "houses booked" MVP line. If players start gaming the grade, lower the revenue weight in `resolveWeek`, or grade revenue *per rentable house* instead.

## Open questions for the three of you

- **Deadline hour:** 20:00 creator time. If the three of you span time zones, change `resolveHour` in `createIsland`.
- **Difficulty:** if weeks feel too easy by tier 3, raise `ECON.decay` from 5 to 6. That is the single biggest knob.
- **Trust model:** anyone with the island code can play an open seat. That's fine for friends. Don't post the code publicly.
