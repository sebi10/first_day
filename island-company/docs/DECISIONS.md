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
- **Two more mechanic puzzles** (17 total): hydraulic servicing (`hydraulics`: discharge the accumulator, placard fluid to FULL, nitrogen precharge from tier 3, a brake bleed from tier 4) and ground power start (`gpu`: cart set to the placard, plug seated, volts checked; a turbine from tier 4). They are the work orders *Service the brake hydraulics* (twin, floatplane) and *Ground power start: weak battery* (the singles), with three new tools (sight-glass loupe, digital cart meter, nitrogen charging kit). The crack hunt was rewritten at the same time: one tap circles an indication, and a swab shows what bleeds back.
- **All 5 island tiers** are data-driven in `src/sim/data.ts` (spec MVP was tiers 1–2). Tiers 3–5 add storms, the ferry, the generator, a floatplane, villas, a lodge, and night flights.
- **Pass-and-play** on one device, plus **move to online** with progress intact.
- **Desktop layout** (two columns), keyboard approvals (← defer, → approve, ↑ counter), Esc to close.
- **Story cards** every 3-week B+ streak (6 at launch).
- **Analyst money hunts:** each week's close alternates between variance find and bank reconciliation, plus a three-way match whenever last week's spend was ≥ $500. Each recovers a hidden leak, so an absent analyst costs real money.

## Consequences: blind sign-off, hidden defects, repairs, cross-trade reports

Owner direction: *"If we mess something up we shouldn't see an immediate sign that we're wrong, so it's realistic, and there's an incident if we mess up."* Plus: *"I get a chance to fix it with a reasonable repair, and then I have to complete the original task."* And: *"Cross-dependency reports from random things, using all 3 jobs."* Three reviewers (the three trades' realism, systems and balance, mobile UX) went over the first version; their fixes are folded in below.

**Blind sign-off.** A real work order launched at puzzle tier 2+ gives no verdict, while you work or after.
- Not blind: tiers 0–1 (teaching), week 0, practice and the weekly challenge, lend-a-hand (an explicit expert try that keeps its botch rule), and a new player's grace weeks (they play tier 1).
- **In the puzzle** (`PuzzleParams.blind`): wrong moves are accepted silently and still scored. A bolt torqued out of sequence is taken, with no hint of the right one and no ✓/! heads. Safety wire threaded or wrapped the loosening way stays that way. The multimeter call and the spot where you open the wall are final. An invoice is just paid or held, with no "Should hold", ✓/✕ or coloured dots. A bank-rec misfile posts quietly. No end-of-job reveal (missed cracks, the true fault row, miswired terminals) and no perfect flourish.
- What real instruments show stays: the gauge needle and its band, the voltage, the tester's 120/0, the UV glow, a part that won't come off, a panel slot that's taken, bare copper past the terminal, and the load sheet's "Can't sign".
- **In the host:** wrong-input sounds are a neutral tap, and the job is sealed the moment it's handed in (every puzzle finishes through `settle()`/`host.hold`, so the timing is the same whatever the score). The entry reads by trade: an A&P's *Logbook entry* stamped *Return to service*, *Airworthy* (inspections) or *Released* (load sheet); an electrician's *Work order closed*; the analyst's *Filed*.
- **In the numbers:** at sign-off the asset gets a fixed stand-in (the credit of a 75% job) and XP gets the floor of the credit curve. The true credit, a perfect run's bonus and its week without decay settle silently at the start of the week's resolution, before anything flies. So health, XP and the perfect count don't give the score away at hand-in. XP only ever settles upward, so no level-up is taken back.
- Cards and details show "Signed off", never a %. Feed lines, the MVP line and personal bests never show a blind score. Blind jobs never rework (hidden defects replace it). A signed-off inspection is in the logbook whatever it missed.

**Hidden defects.** A mechanic or electrician job on an asset can leave a latent defect; crew-project parts and desk work can't. The roll is seeded from the order and uses the true score q: none from 0.85; (0.85 − q) × 0.2 between 0.6 and 0.85; 10% + 1.8 per point under 0.6. Under 0.4 it's severe.
- Defects live hidden in `s.defects`. They surface 1–4 weeks later (1–2 if severe), never before week 3. A grounded or red-tagged asset can't fail in service, so its defect waits a week.
- **What it looks like** depends on the job (`DEFECT_RULES_BY_KIND`, then `DEFECT_RULES` by puzzle, then a per-trade fallback for puzzles other branches add). Every rule is a pair: a write-up or callback when minor, a failure when severe. For example, prop bolts: *"Pilot wrote up a vibration on Twin N-12: prop bolts found loose"* / *"Prop bolts on Twin N-12 backed off in flight: heavy vibration, precautionary landing"*. A missed spar-cap crack is smoking rivets, then a wing root working in flight. A panel job's defect is a breaker oversized for its wire. A meter job misses a loose neutral.
- **Found first:** a passed inspection-type job by the same trade on the same asset finds defects left in an earlier week, but only in the work it looks at (`INSPECTS[kind].scope`):

| Inspection | Finds defects in |
| --- | --- |
| 100-hr inspection, code inspection prep | everything on the asset |
| Wheel-half penetrant check | tires, wheel halves, brake hydraulic servicing (the brake is off for it) |
| Wing spar inspection | spar, load sheet (hard-landing damage) |
| Oil change (engine look-over, filter check) | oil, prop, prop safety wire, cylinder, alternator |
| Outlet trace / flicker diagnosis | outlets, GFCIs, 3-way switches, storm rewires (and flicker jobs) |
| Generator circuit test | transfer panel, generator circuits |
| Panel diagnosis | dead-circuit diagnosis, feeder, panel upgrade, fuel-dock run |

  A repair or redo counts as the job it corrects. The feed says *"Seb's 100-hr inspection on Twin N-12 found prop bolts below torque, with fretting on the flange, left from week 5. Repair written up: … Not airworthy until it's repaired."* Until the repair is done, an asset in service with a known defect is a near-miss on the safety grade (ground it or red-tag it).
- **Surfaces:** otherwise it becomes an incident (kind `defect`): 1.2× the original job's cost (2.5× severe), −12 / −25 health, and it counts like any incident (insurance, safety grade, clean-week unlocks, guest refunds). The review traces it with the job's noun form (`CatalogEntry.log`): *"… Traced to the prop bolt re-torque Seb signed off in week 5."* A repair is quoted: *"the repair “Re-torque the prop bolts” Seb signed off in week 7"*.

**Repair, then the original task.** A found or surfaced defect creates a repair for the same trade and asset, on a different puzzle from the original. It's a real corrective job: repair the damage first, then redo the original.
- Mechanic: loose prop bolts → *Pull the prop, replace the bolts, inspect the flange for fretting* (teardown of the propeller). Wheel through-bolts → replace them and check the holes for elongation. A missed crack → *Replace the cracked exhaust riser*, *Replace the wheel half and tire*, *Spar-cap doubler repair per the SRM* (parts kit; the spar repair costs 1.2× the inspection). Safety wire the wrong way → re-torque the hardware. A botched install → inspect the bracket / case / radio tray for damage (crack hunt), then the redo reinstalls.
- Electrician: a missed backstab → *Replace the scorched outlet and move it off the backstab*. A missed loose neutral → *Replace the scorched device and re-terminate the neutral*. An oversized breaker → *Replace the scorched run and land it on the right-size breaker*. A kinked conduit run → *Find where the run is faulted to ground* (make it safe and find it); the redo re-bends the run and pulls new conductors.
- A load sheet has no redo (it's redone every week anyway).
- The puzzle shows the part the repair is about (`Order.job`): the propeller, the main wheel, the exhaust riser, the wing root, the alternator bracket, a receptacle. Seven teardown assemblies were added for this (and for the reports), and two more with the new mechanic puzzles (see below).
- The repair goes to the analyst as a pending card at 0.6× the original's cost. It counts as safety-critical, so it can be approved through a cash freeze, and deferring it rolls deferral risk like any job. It restores a little health, plus half of what an incident took.
- Finishing the repair spawns the **redo**: "<original title> (redo)", ready, cost 0 (already paid), approved in the trade's name, restoring half the original's gain (the botched sign-off already landed part of it; at 1× a caught defect ended up health-positive). If the same job is already open on that asset, that order becomes the redo, so there's never a second copy. A botched repair or redo can leave a defect again, so the chain continues.

**Cross-trade reports** (`REPORTS`: 14 rows; all three trades report and fix; a branch that adds a puzzle adds its rows).

| Reporter → fixer | Report | Puzzle | Effect |
| --- | --- | --- | --- |
| Mechanic → electrician | Hangar work lights are dead · Hangar compressor keeps tripping its breaker · Aircraft battery charger keeps tripping the hangar GFCI | trace (hangar wall) · meter (hangar circuit) · meter | cap |
| Mechanic → analyst | Parts vendor is billing list price, not our contract price · Avgas went up $1.20/gal and charter prices never moved | invoice · variance | leak |
| Mechanic → analyst | Parts vendor put us on credit hold | reconcile | cap |
| Electrician → mechanic | Generator radiator fan bearing is screaming (tier 3+) · Trencher drive belt snapped · Work truck ladder rack is cracked at the welds | teardown (fan) · teardown (trencher) · crack (welds) | cap |
| Electrician → analyst | Utility autopay is drafting more than the bills · Supply house auto-ship keeps billing wire we cancelled · Copper jumped 20%: fixed-price house jobs are underwater | reconcile · invoice · variance | leak |
| Analyst → electrician | Office outlets go dead and come back when the printer runs | meter (office circuit) | cap |
| Analyst → mechanic | Company van wheel is wobbling: lug nuts loose | torque | leak |

- Changed from the spec's list after review: leaks are causes that really recur (list price, auto-ship, autopay), not one-off double bills. "Office circuit trips when the printer and kettle run" is an overload (a dedicated circuit, not a meter job), so it's now the loose-connection version. It's the generator's *radiator* fan. "Van brakes feel soft" is hydraulic, so it's a wobbling wheel the torque puzzle really fixes. The hydraulics and ground power puzzles have landed, but they model aircraft only (a light twin's power brakes, a single on a GPU cart), so the van's soft brakes, the bucket-truck boom and a GPU-cart report wait for a vehicle scenario in those puzzles. The hangar-door row played a residential 3-way switch and was dropped.
- From week 3, a 30% chance each week of a new report. At most 2 are open, counting fixes that are about to come back, and never two for one fixer.
- A report is a ready card for the fixer: a small cost paid at once, no approval. Tapping it (like a repair or a redo) opens the story first, then *Start*.
- **cap:** the reporter gets 2 jobs per turn, or 1 desk task for the analyst ("No shop air: 2 jobs max until Mia fixes it"). When it's used up, the dock says *End turn · limit reached* and ready cards dim. **leak:** cash every resolved week, a review line and `costs.reports`.
- A fix under a pass always comes back 1–2 weeks later; a sloppy pass comes back with the defect-curve chance. A leak that comes back also charges the weeks it only looked fixed ("It cost $480 while it looked fixed").
- Autopilot patches a missed fixer's *cap* report at 50% (so it comes back), but leaves a leak for a person.
- The reporter can't sign off their own report through Lend a hand (engine refusal, and it's not listed); the third trade can.

**Paper sim.** Bots fix a crewmate's report as a favour on top of their usual jobs. They rank repairs and redos as urgent, and the analyst treats repairs as safety work. Attendance and each seat's week have their own random streams, so a rule that adds a job doesn't reshuffle every absence; before/after runs compare the same crew weeks. `npm run balance -- robust` re-rolls the crews 4 ways over 90 seeds.

**Tuning** (spec value → shipped), all in `DEFECT` / `REPORT` in data.ts:

| Knob | Spec | Shipped | Why |
| --- | --- | --- | --- |
| Defect chance, 0.6 ≤ q < 0.85 | (0.85 − q) × 0.4 | × 0.2 | The three-friends bots live in this band from tier 3. At 0.4, tier 4 tipped into deferral spirals. |
| Defect chance, q < 0.6 | 10% + 1.8/pt | unchanged | A real botch should bite. |
| Weeks until a defect surfaces | 1–3 | 1–4 (severe 1–2) | Gives an inspection a real chance to catch it. |
| Incident cost | 1.5× / 3× | 1.2× / 2.5× | Big-ticket jobs (a $2,900 panel upgrade) made one defect a $6k+ hit. |
| Repair cost | ~0.8× | 0.6× (spar doubler 1.2×) | Same reason. |
| Redo gain | — | 0.5× the original's | At 1× a caught defect was health-positive. |
| Blind stand-in | — | a 75% job's credit | Near the bots' average, so the week's economics barely move. |
| Report chance per week | ~0.4 | 0.3 | Each report costs a job slot plus the reporter's cap. |

Results, same bots, 26 weeks × 30 seeds (`npm run balance`, after the review fixes):

| Team | Wk → T5 | Weeks < $0 | Min cash | Incidents / wk | **Defect incidents / wk** | Revenue / wk |
| --- | --- | --- | --- | --- | --- | --- |
| Three friends | **22** | **0** | $6,444 | 0.31 | **0.118** | $9,068 |
| All average | **22** | **0** | $6,521 | 0.21 | **0.097** | $9,889 |
| All good | 21 | 0 | $6,493 | 0.03 | 0.013 | $11,899 |
| Naive analyst | stays at tier 3 | 0 | | | | |
| Every solo / absent team | stays at tier 1 | | | | | |

- Per 26-week season, three friends see about 3 defect incidents (and about 1.6 caught first by an inspection), 8 reports plus 2 that come back, and 2 known-defect near-misses. All average: 2.5 incidents, 1.9 caught. Defect incidents are about 40% of all incidents: noticeable, not dominant. Deferrals are still the main risk.
- Before the review fixes: three friends week 22, 0.109 defect incidents / week, $9,322 revenue / week. All average: week 21, 0.086, $9,912.

Robustness (`npm run balance -- robust`, 90 seeds × 4 crews = 360 games per team):
- **Three friends:** median tier 5 in week 22–23. 61 of 360 miss tier 5 by week 26 (53 before the review fixes, 38 with consequences off). 1 week below $0 in 360 games.
- **All average:** tier 5 in week 22. 32 of 360 miss (31 before, 11 off). 1 week below $0.
- Both negative weeks are week 26 of a late tier-4 collapse: the grid and the generator go down together and revenue goes to zero for three weeks. The previous version had none in this sweep. Variants didn't remove them: a full-value redo, a 25% report chance, and dropping the three new cap reports gave 1, 2–3 and 3–6 negative weeks. It is the known tier-4 knife-edge ($7k/week fixed), reshuffled by any rule change, not one consequence rule.

**Knobs if it feels too soft or too harsh:** `DEFECT.slope` (0.2), `REPORT.chance` (0.3), `REPORT.capOps` (2), and the `INSPECTS` scopes (wider scopes catch more before they fail). Re-run `npm run balance -- robust` after any change.

### Integration with the new mechanic puzzles (hydraulic servicing, ground power start, the one-tap crack hunt)

The consequences branch and the mechanic branch were built side by side and merged afterwards. What changed to make them one system:

**Blind sign-off covers all 17 puzzles.** The rewritten crack hunt and the two new puzzles honour `PuzzleParams.blind` the same way torque and safety wire do: grading commentary goes, the world stays, every finish goes through `settle()`/`host.hold` with the same time whatever the result, and no flourish.

| Puzzle | Hidden when blind | Still there (the world) |
| --- | --- | --- |
| Crack hunt | ✓/✗ badges and green/rust rings, dashed missed-crack rings, decoy labels ("tool mark: spanwise"), the booth re-lit as developed, the buzz on a bare-metal call, the flourish | your grease-pencil rings and '?' marks, the UV glow and bleed-back, the printed rules at tier 2 |
| Hydraulic servicing | "Not this system!" / "83282: only if the placard lists it", "At FULL", shakes and buzzes when something won't go, the step banner ticking itself off (it becomes the work card), "reads low under pressure", the green ring at 0 psi, "dry!", the CONTAMINATED / STOP: OXYGEN cards (the wrong can pours and oxygen charges like nitrogen; both still cap the score), fault sounds for air in the hose | the placard and its squawk, both gauges, the level in the sight glass (a foreign fluid shows its colour), fluid spilling over, a soft pedal, bubbles in the bleed hose, the relief valve |
| Ground power start | every slip and fault call-out ("Plugged in live", "Fault: hot start"), the checklist ticks and current item (the card still lists the items), the green flash when the plug seats, the summary on the status line, verdict sounds | sparks and pitted pins from a live plug, smoke from behind the panel, the ITT needle and the gauge's exceedance warning, torching at the exhaust, "Click. Nothing turns", the range-switch interlock |

**Their own hidden defects.** Before, a botched hydraulic service or ground power start fell back to the mechanic's generic "rework the job". Now each has a [write-up, failure] pair and a real repair, and what went wrong picks the row: a puzzle can report its failure mode in its result (`data.defect`), and `defectRule` looks up `<puzzle>:<variant>` before the job kind (`defectVariant` keeps only a variant with a row; it is stored on the defect). Bots report no variant, so the paper sim is unchanged by it.

| Job | What went wrong | Write-up / failure | Repair (then the original again) |
| --- | --- | --- | --- |
| Brake hydraulics | default (air left in the line, or the level or precharge off) | spongy brake pedal / brakes fade on the landing roll, runs off the end of the strip | teardown *Brake caliper*: replace the piston O-rings and flush the line (parts kit) |
| Brake hydraulics | `fluid`: the wrong fluid went in | fluid weeping, seals swelling / a swollen seal lets go on the landing roll | teardown *Brake caliper*: drain and flush the system, replace every seal the wrong fluid reached (parts kit, 1.5× cost) |
| Ground power start | default (avionics on at power-up, 28 V into a 14 V ship, a sloppy start) | dead com radio after the start / radios fail on departure | teardown *Com radio*: replace the spike-damaged radio and check the bus (parts kit) |
| Ground power start | `arc`: plugged in or pulled out live | burnt, pitted receptacle pins / the receptacle overheats on the next start | teardown *External power receptacle* (new): replace it and check the relay contacts (parts kit) |
| Ground power start | `hot`: a turbine hot start or a relight into residual fuel | ITT exceedance flagged, hot-section borescope written up / power loss on climb-out, burnt turbine blades | crack hunt on the *Compressor turbine disk*: hot-section inspection, borescope and penetrant (parts kit, 3× cost) |

- Two teardown assemblies were added: *Brake caliper (piston seals)* (accumulator to 0 psi first) and *External power receptacle* (battery disconnected first; the relay is in it from tier 3).
- The crack hunt keeps the consequences part table on the new drawing: repairs and reports look at a mount tube, the alternator bracket, the crankcase, the radio tray, the gear leg, the ladder rack welds or the compressor turbine disk (a long member draws as the spar, a round one as the wheel half). The lodge's crew-project job is now *Acceptance inspection: aluminium deck beams*, matching the part the crack hunt shows.
- The puzzle lab shows "Signed off · no verdict" instead of the score with `&blind=1` (the score is still on `window.__lab.result`). `scripts/e2e.mjs` checks the three puzzles draw no verdict blind.

**Balance after the merge** (`npm run balance`, 26 weeks × 30 seeds; no tuning needed):

| Team | Wk → T2 / T3 / T4 / T5 | % weeks B+ | Min cash | Weeks < $0 | Defect incidents / wk | Revenue / wk |
| --- | --- | --- | --- | --- | --- | --- |
| Three friends | 8 / 11 / 16 / **21** | 89% | $6,050 | **0** | 0.105 | $9,302 |
| All average | 7 / 10 / 16 / **22** | 93% | $6,554 | **0** | 0.072 | $9,952 |
| All good | 5 / 8 / 16 / 21 | 99% | $6,735 | 0 | 0.015 | $11,912 |
| Naive analyst | stays at tier 3 | 100% | $6,176 | 0 | | |
| Every solo / absent team | stays at tier 1 | | | | | |

Robustness (`npm run balance -- robust`, 360 games per team): three friends reach tier 5 in week 22–23 (60 of 360 miss it by week 26, 61 before the merge); all average in week 22 (21 miss, 32 before). Weeks below $0: 4 per team, in 3 of its 360 games (1 week in 1 game before the merge). All of them are weeks 24–26 of a late grid-and-generator collapse (no rentable houses, no flights for two or three weeks), the tier-4 knife-edge described above, now reshuffled by two more mechanic jobs in the queue. The follow-up rules (the new defect rows with their parts kits, the wider wheel-half scope; bots report no variants) barely move the bots: the same negative weeks, at most one more or fewer missed tier 5 per crew, and the 30-seed medians are unchanged. Left untuned because the standard run is clean; if it shows up in play, the first knob is the new jobs' queue weight (`below(94, 4)` / `below(96, 4)` in the catalog).

### Integration with the island art and the paperwork puzzles (IPC lookup, logbook research)

Three more branches merged on top: the new island art (`island.tsx`, `ui/island/*`, the island lab), the IPC parts lookup and the logbook research puzzle. Both puzzles build on `src/sim/aircraft.ts` (seeded identity, logbooks, IPC figures, AMM task cards and hidden plants), and each branch had extended it. The merged module keeps both: the AD method of compliance, the lining rivet UPA and the IPC art hooks, and the field-approved and FAA-PMA plants, per-unit engine and propeller books (a twin keeps one per engine and per propeller), EA parts control and the review of field 337s. An AD on a replaced assembly reads "N/A per STC …" or "per Form 337 dated … (field approval)". Every other AD line states how it was complied with.

- `reviewRequest` treated any cite containing "337" as a field approval, which refused an STC numbered like SA03372CE. An STC-shaped cite is now always an STC.
- The IPC puzzle handles the new plants on an airplane it is given. A field-approved kit is cited by its 337, since it has no STC number. An FAA-PMA part is an approved replacement for the IPC part, so that job is an ordinary IPC job. The records show which unit's book an entry is in.
- **Blind sign-off covers both.** The paperwork you stamp stays. Whether the P/N or the approval route was right is hidden.

| Puzzle | Hidden when blind | Still there |
| --- | --- | --- |
| IPC lookup | "DOESN'T FIT" at the airplane (the IPC part on an STC airplane goes to stores as ordered, scored as the wrong part), the coach line that knew whether the part on the request was the answer (it now follows your own steps), the PULLED / HELD / WRONG PART stamp, ✓/✗ notes, the "why", the ✓ on a cited entry, verdict sounds, the flourish | the figure, the book's notes and effectivity codes, the records and ICAs, and your request stamped ORDERED with the lines and the approval it cites |
| Logbook research | engineering's review and the inspector's buy-back (no returns: the paperwork goes in once), ✗ on fields, the EA issued / Returned / Not airworthy stamp, verdict sounds, the flourish | the books, the IPC sheet, the lead's note (tier 2), and your request or your signed entry, stamped *Sent to engineering* / *Signed* |

- Not catalog jobs. `ipc` and `logbook` are the part chain's puzzles (a job finds a part, then the IPC, then the logbooks and an engineering approval): the chain launches them (see *The manual and the part chain* below), and `tests/catalog.test.ts` checks that it does.
- `launchFor` hands a paperwork puzzle on a plane the island's own airplane: `context.aircraft = aircraftOf(seed, asset.id, asset.model)`. It is derived from the seed, never stored in the island doc, and built once per island and plane (`islandAircraft`). Other jobs don't build it. An airplane given without a plant never gets an IPC "part no exist" case. The logbook puzzle plants its case on that airplane's identity.
- The paperwork puzzles are HTML, so `tests/blind.test.ts` mounts them on a small DOM (`tests/minidom.ts`) and clicks through the same way with and without `blind`.
- Balance is unchanged by the merge. The paper sim does not play puzzles, and the standard and robust runs match the numbers above.

## The manual and the part chain (Phase B)

An A&P described the real workflow: *"When I get a task I get a manual. I follow manual. If part is gone or missing or damaged: IPC. If part no exist, I check in previous logged items on airplane, the maintenance logs, and then get engineering approval to put part on airplane."* It is now three game systems across all three seats.

### 1. The manual

- Every mechanic job on a plane opens its detail first, with a **Manual** section under *Start the job*: the airplane's data plate (registration, model, S/N, year, the SBs complied with) and the AMM task card for the job (`taskCardFor(islandAircraft(seed, asset), job)`, derived from the island seed and never stored). The card shows the task number, effectivity, warnings and cautions, the procedure, and the torques, servicing values and consumables with **both effectivities** as the manual prints them.
- Tiers 0–2 mark the line for this airplane (◀ this airplane); from tier 3 nothing is marked, and the plate and the SB record say which line applies.
- **Card-driven values.** The torque puzzle (tire and brake, prop bolts) and hydraulic servicing take their numbers from that card (`context.card`, built by `manualCard`): the torque band is the S/N's line; the hydraulic placard is the card's approved fluid by SB status (pre-SB: MIL-PRF-5606 only; post-SB: 5606 or 83282) and the accumulator precharge by S/N block (A/B). From tier 3 both lines are shown and nothing says which is this airplane's.
- **The wrong effectivity is a sure hidden defect.** A blind sign-off (tier ≥ 2) worked to the other line leaves a defect with its own words: `torque:eff` (and `:tieNut` / `:propBolt`), `hydraulics:eff`. These rules are `sure: true` in `DEFECT_RULES`: a wrong-line job always plants one, because it is a definite error, not a slip.
- A plane job the island's manual set has no card for (the 100-hr inspection, the charter load sheet) shows the data plate only. Jobs off a plane have no Manual section.

### 2. The part chain

**Trigger.** A mechanic signs off an eligible job on a plane (32-40: tire and brake, wheel-half penetrant check; 61-10: prop bolt re-torque, safety-wiring the prop bolts; 29-10: brake hydraulic servicing; 23-10: com radio swap; 24-30: alternator replacement) and the job finds a part it can't be finished without. Conditions: week ≥ 3, island tier ≥ 2, not in the mechanic's grace weeks, not a repair, redo, report or crew-project job, no chain already open, and 2 weeks' rest after the last one closed. Then a roll seeded from the order and the week (`rng(hashSeed(o.seed, 'chain', week)).chance(0.3)`), never the score. It is not a new action: `complete` opens it, so the existing week stamp covers it.

**What it does.** The job is not signed off. It shows *Work stopped · Part needed* instead of a logbook entry and waits (`waiting_part`). The plane is **grounded** (`outOfService`: no flights, no capacity) until the part is on. Every seat gets a banner at the top of the island screen (the plane, the part, a stepper *Found → IPC → (Logbooks → Engineering) → Buy → Delivery → Install*, and whose move it is: *Your move: …* or *Waiting on Cy: approve the part*). Chips on every step's card say the same, and ntfy pings the crew when the step changes.

| Step | Who | What |
| --- | --- | --- |
| IPC lookup | mechanic | The IPC puzzle on this airplane (its S/N and SB status), with the squawk: *"L/H brake linings worn below minimum … On the airplane: brake assy P/N 30-86A (Clearwater Wheel & Brake)."* Hand in a P/N, or *Not in the IPC · research the records*. Blind from tier 2. |
| Buy | analyst | An AOG card on the desk: *Buy 066-22500 LINING … for N658VN*, "If it waits: Cargo C-7 stays grounded". No counter-offer. It rides the next cargo flight, or the boat if there is none. |
| Logbook research | mechanic | Only when the part isn't in the IPC. The logbook puzzle on this airplane finds how the assembly got there (an STC, a field-approved 337) and sends engineering a request citing it, or signs on a part from the records alone. |
| Engineering fee | analyst | An AOG card: $380 + $40 per tier above 2. Engineering answers when the week resolves. |
| Engineering answer | (resolve) | Approved: *"Engineering approved <P/N> for <reg> on <STC>: EA issued"*, then a Buy card for the right P/N. Rejected: *"Engineering returned the request: <reason>"* and a new research order (or back to the IPC, if the part was in the IPC all along). |
| Install | mechanic | *Install <P/N>, then finish <job>*. The original job's own puzzle. It completes the original job with its normal gain (paid once), and the plane is back in service. |

**Wrong answers surface later, never at hand-in.**

- **A P/N that doesn't fit** (not effective for this S/N or SB status, superseded one-way, the IPC part for an assembly an STC replaced, not the right item, NP) is caught **at receiving** when the week resolves. It goes back with a 15% restocking fee (at least $40), and a new lookup (or research) opens. The banner says why: *"Sent back at receiving: P/N 066-22600 is not effective for N658VN's SB status (EFF C: POST SB IC208-32-07; INTCHG code 3, only as the SB set)."*
- **An ICA part put on from a logbook entry alone** (no engineering authorization) goes on and flies. It leaves a sure hidden defect (`ipc:unapproved`) that a later inspection finds. The repair is logbook research for the authorization.
- **"Not in the IPC" when it is** costs the engineering fee and a week, then *"back to the IPC"*.

**Who carries what.** The island doc stores only `s.chain` (the open chain, or the last closed one with its story) and `o.chain` on the orders it made. The airplane (records, IPC, plant) is rebuilt from the island seed. Whether the plane carries an alteration is `plantFor(islandSeed, assetId, model)`: about half the planes carry one STC or field-approved 337 on an assembly the chain can reach (30% of those are field approvals). Old island docs without these fields load unchanged (`s.chain` absent = no chain).

**The review tells the story.** *"Back in service: Cargo C-7 sat 2 weeks for brake linings: STC SA01600SE found in the logbooks, engineering approved week 8. $1,090 in parts and fees."*

**Bots and autopilot play it.** A bot mechanic does the lookup or research at its skill (`botChainData`: right P/N or "not in the IPC" by skill, a wrong P/N or a bad cite otherwise) as an extra step in the same turn. A bot analyst approves an AOG card whenever cash covers it. Autopilot never does the lookup or the research, because they wait for a person. It does approve AOG cards (cash permitting) and installs a part that has arrived, so an absent analyst never gridlocks a chain.

**Decision: no chain on the island's only guest plane.** Through tier 3 the twin is the only plane that brings guests. Grounding it for 2+ weeks at tier 2 emptied every house and sent the three-friends crew into a cash death spiral: the analyst couldn't afford the part, so the plane stayed down, so there was no revenue. The only guest plane "keeps its spares on the shelf". Chains fall on the cargo plane, and from tier 4 on either plane once the floatplane shares the guests. The same run also made AOG cards something bots and autopilot always approve when cash covers them.

| Tuning (`CHAIN` in `src/sim/data.ts`) | Value |
| --- | --- |
| From week / island tier | 3 / 2 |
| Chance an eligible sign-off finds a part | 0.3 (one open chain; 2 weeks' rest after one closes) |
| Planes with an alteration / of those field-approved | 0.5 / 0.3 |
| Part list price at tier 1 | lining $240, prop bolts $360, filter $110, reservoir cap $130, radio $950, generator $760, starter-generator $1,350; +10% per tier; ICA part ×1.35 |
| Engineering fee | $380 + $40 per tier above 2 |
| Restocking fee | 15% of the part, at least $40 |

Per closed chain in the paper sim (30 seeds): three friends and all average get 1.07 chains a game, the plane is grounded 2.2 resolved weeks, it costs about $950 in parts, fees and restocking, 0.13 parts go back at receiving, and 6–13% of chains are not in the IPC. All good gets 1.73 chains a game.

### 3. Balance with the chain (26 weeks × 30 seeds, medians)

| Team | Tier at wk 26 | Wk → T2 / T3 / T4 / T5 | % weeks B+ | Min cash | Weeks < $0 | Revenue / wk |
| --- | --- | --- | --- | --- | --- | --- |
| All good | 5 | 5 / 8 / 16 / 21 | 98% | $6,735 | 0 | $11,685 |
| All average | 5 | 7 / 11 / 16 / 22 | 92% | $6,554 | 0 | $9,540 |
| **Three friends** | 5 | 8 / 11 / 16 / 22 | 87% | $2,867 | 0 | $9,148 |
| Naive analyst | 3 | 5 / 14 / — / — | 98% | $6,176 | 0 | $5,151 |
| Any role absent / any solo player / nobody | 1 | — | 37–100% | down to −$152k | up to 413 of 780 | |

Before the chain, three friends reached tier 5 in week 21 with a minimum of $6,050, and all average in week 22. The chain costs the three friends about a week and $3k of headroom, and nothing goes below $0.

Robustness (`npm run balance -- robust`: 26 weeks × 90 seeds × 4 crews per team):

| Team | Crew | Wk → T5 | Miss T5 (of 90) | Weeks < $0 | Min cash |
| --- | --- | --- | --- | --- | --- |
| Three friends | – / a / b / c | 23 / 24 / 24 / 23 | 21 / 28 / 24 / 20 | 2 / 1 / 1 / 2 | −$7,178 / −$8,099 / −$4,035 / −$3,911 |
| All average | – / a / b / c | 22 / 22 / 22 / 22 | 16 / 14 / 16 / 6 | 0 / 0 / 0 / 0 | $2,450 / $4,354 / $5,802 / $4,403 |

Before the chain (same run): three friends reached tier 5 in weeks 22/23/22/23, missed it in 14/20/15/11 of 90, and had 2/0/0/2 weeks below $0. All average: week 22, missed in 5/11/2/3, with 0/0/0/4 weeks below $0. The chain adds about a week to the slowest crews and 6–11 more misses per 90 games. It adds two single negative weeks for the three friends: late-game cash dips while a plane is down. Left as is because the standard run is clean. The first knob is `CHAIN.chance`, and the next is the rest weeks.

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
