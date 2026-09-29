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

**Cross-trade reports** (`REPORTS`: 14 rows at first, 19 since the ground power update; all three trades report and fix; a branch that adds a puzzle adds its rows).

| Reporter → fixer | Report | Puzzle | Effect |
| --- | --- | --- | --- |
| Mechanic → electrician | Hangar work lights are dead · Hangar compressor keeps tripping its breaker · Aircraft battery charger keeps tripping the hangar GFCI · Hangar 28 V ground power receptacle keeps going dead | trace (hangar wall) · meter (hangar circuit) · meter · meter (the 28 V supply's circuit) | cap |
| Mechanic → electrician | GPU cart cable insulation is cracked at the plug (raised by wear, never at random) | wire-up (a new GPU plug) | that cart tagged out |
| Mechanic → analyst | Parts vendor is billing list price, not our contract price · Avgas went up $1.20/gal and charter prices never moved · GPU starts never make it onto the charter invoices | invoice · variance · variance (ground power line) | leak |
| Mechanic → analyst | Parts vendor put us on credit hold | reconcile | cap |
| Electrician → mechanic | Generator radiator fan bearing is screaming (tier 3+) · Trencher drive belt snapped · Work truck ladder rack is cracked at the welds · Bucket truck boom creeps down: hydraulic leak at the lift cylinder | teardown (fan) · teardown (trencher) · crack (welds) · hydraulics (bucket truck) | cap |
| Electrician → analyst | Utility autopay is drafting more than the bills · Supply house auto-ship keeps billing wire we cancelled · Copper jumped 20%: fixed-price house jobs are underwater | reconcile · invoice · variance | leak |
| Analyst → electrician | Office outlets go dead and come back when the printer runs | meter (office circuit) | cap |
| Analyst → mechanic | Company van wheel is wobbling: lug nuts loose · Company van brake pedal is soft | torque · hydraulics (van) | leak |

- Changed from the spec's list after review: leaks are causes that really recur (list price, auto-ship, autopay), not one-off double bills. "Office circuit trips when the printer and kettle run" is an overload (a dedicated circuit, not a meter job), so it's now the loose-connection version. It's the generator's *radiator* fan. "Van brakes feel soft" is hydraulic, so it was a wobbling wheel the torque puzzle really fixes; the soft pedal itself arrived with the hydraulic bench's vehicle scenarios (see *Ground power carts* below), and the wobbling wheel stays. The hangar-door row played a residential 3-way switch and was dropped.
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

**Trigger.** A mechanic signs off an eligible job on a plane (32-40: tire and brake, wheel-half penetrant check; 61-10: prop bolt re-torque (not the safety wiring: galled threads show at the re-torque, not while wiring); 29-10: brake hydraulic servicing; 23-10: com radio swap; 24-30: alternator replacement) and the job finds a part it can't be finished without. Conditions: week ≥ 3, island tier ≥ 2, not in the mechanic's grace weeks, not a repair, redo, report or crew-project job, no chain already open, and 2 weeks' rest after the last one closed. Then a roll seeded from the order and the week (`rng(hashSeed(o.seed, 'chain', week)).chance(0.3)`), never the score. It is not a new action: `complete` opens it, so the existing week stamp covers it.

**What it does.** The job is not signed off. It shows *Work stopped · Part needed* instead of a logbook entry and waits (`waiting_part`). The plane is **grounded** (`outOfService`: no flights, no capacity) until the part is on. Every seat gets a banner at the top of the island screen (the plane, the part, a stepper *Found → IPC → (Logbooks → Engineering) → Buy → Delivery → Install*, and whose move it is: *Your move: …* or *Waiting on Cy: approve the part*). Chips on every step's card say the same, and ntfy pings the crew when the step changes.

| Step | Who | What |
| --- | --- | --- |
| IPC lookup | mechanic | The IPC puzzle on this airplane (its S/N and SB status), with the squawk: *"L/H brake linings worn below minimum … On the airplane: brake assy P/N 30-86A (Clearwater Wheel & Brake)."* Hand in a P/N, or *Not in the IPC · research the records*. Blind from tier 2. |
| Buy | analyst | An AOG card on the desk: *Buy 066-22500 LINING … for N658VN*, with the freight on the PO (the AOG boat, or the next guest flight a week later, when the cargo plane is the one down), what a week grounded costs, and what the chain has cost so far. No counter-offer. (Review fixes, below.) |
| Logbook research | mechanic | Only when the part isn't in the IPC. The logbook puzzle on this airplane finds how the assembly got there (an STC, a field-approved 337) and sends engineering a request citing it, or signs on a part from the records alone. |
| Engineering fee | analyst | An AOG card: $380 + $40 per tier above 2. Engineering answers when the week resolves. |
| Engineering answer | (resolve) | Approved: *"Engineering approved <P/N> for <reg> on <STC>: EA issued"*, then a Buy card for the right P/N. Rejected: *"Engineering returned the request: <reason>"* and a new research order (or back to the IPC, if the part was in the IPC all along). |
| Install | mechanic | *Install <P/N>, then finish <job>*. The original job's own puzzle. It completes the original job with its normal gain (paid once), and the plane is back in service. |

**Wrong answers surface later, never at hand-in.**

- **A P/N that doesn't fit** (not effective for this S/N or SB status, superseded one-way, the IPC part for an assembly an STC replaced, not the right item, NP) is caught **at receiving** when the week resolves. It goes back, credited its price less a 15% restocking fee (at least $40), and a new lookup (or research, when the IPC doesn't cover the assembly on the airplane) opens. The banner says why: *"Sent back at receiving: P/N 066-22600 is not effective for N658VN's SB status (EFF C: POST SB IC208-32-07; INTCHG code 3, only as the SB set)."*
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
| Planes with an alteration / of those field-approved | 0.5 / 0.3 (on a fixed per-model ATA list) |
| Chance on an altered plane's own assembly / elsewhere on it (review fixes) | 0.9 / 0.3 × the chance |
| An electrical unit's fault in its wiring / a part without its 8130-3 (review fixes) | 0.3 / 0.12 |
| Part list price at tier 1 | lining $240, prop bolts $360, filter $110, reservoir cap $130, radio $950, generator $760, starter-generator $1,350; +10% per tier; ICA part ×1.35 |
| Engineering fee | $380 + $40 per tier above 2 |
| Restocking fee | 15% of the part, at least $40 |

Per closed chain in the paper sim (30 seeds), as first built: three friends and all average get 1.07 chains a game, the plane is grounded 2.2 resolved weeks, it costs about $950 in parts, fees and restocking, 0.13 parts go back at receiving, and 6–13% of chains are not in the IPC. All good gets 1.73 chains a game. (The review fixes bias the find toward an altered plane's own assembly: about 40% are now not in the IPC. See below.)

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

## Ground power carts, and cross-trade reports for hydraulics and ground power

Owner direction, the A&P: *"ground power carts have to be interactive for the mechanic"*; the crew: *"cross-dependency reports from random things using all 3 jobs"* (his example: *"this light doesn't work in my shop"*, and the electrician fixes it), everyone integral but nobody gridlocked, and still no immediate sign when something was done wrong.

**The carts** (`s.gse`, optional in the doc). GPU cart 1 comes with the island (second-hand: some wear on its cable already), GPU cart 2 with tier 3. Each has a charge (0–100), a hidden cable wear (0–100), a plane it is hooked up to *or* a place on the hangar charger (never both), and the last look at its cable. An island saved before carts existed reads the default (both on the charger, full) through `gseCarts()`; its first cart move or resolve stores it. Nothing derivable is stored.

**The mechanic's moves** (action `gse`, week-stamped in `WEEK_BOUND`: charging costs money, a hooked cart gates the week's starts, and an inspection can write up a report):

| Move | What it does |
| --- | --- |
| Plug in to charge | Off a plane if it was on one, onto the hangar charger |
| Unplug | Parked |
| Hook up to *plane* | Towed off the charger and plugged into that plane's external power receptacle. One cart per plane; a tagged-out cart can't be hooked up |
| Unhook | Parked beside the plane |
| Inspect the cable | Once a week per cart: a close-up of the plug end whose tells follow the hidden wear (crazing from 22, cracks through the boot from 40, heat discoloration from 60, pitted and burnt contacts from 70), and the mechanic's call: *Serviceable* (it stays in service as it is) or *Tag it out* (written up for the electrician on the spot, in the words of the band). Not in the week of a new plug |

Only the mechanic moves them. The other seats see the same card read-only.

**A start needs a cart.** A *Ground power start* job needs a cart hooked up to that plane, in service, with 30% or more (`gseForStart`). Until then its card says *Hook a charged cart up to Cargo C-7 first* and the engine refuses the start (lending a hand too: it's the same cart). The app never launches a puzzle that can't count: it says what's missing and opens the carts. A start takes 25% of the charge on the piston planes, 45% on the turbine cargo plane (by the plane's model, which is also the airframe the puzzle draws), and adds 7 wear, 15 more when the plug went in or came out live.

**The puzzle gets the cart as it was left** (`context.cart`). A run-down battery rests a little below its setting and sags much further under the start load, because its internal resistance climbs as it runs down. On a 14 V start at 30% the cart's meter falls to about 11 V while cranking, against 13.4 V on a full cart. Its LED bar shows two amber lights, and it cranks a little weaker (a turbine runs a little hotter on it). Nothing is called out: the meter is the instrument.

**Charging.** When the week resolves, a cart on the charger gains up to 60% if the hangar has power (grid up, or the generator carrying), at $0.50 of electricity per point ($30 for 60%), shown in the review's costs as *GPU charging*. With no hangar power the review says the cart sat on a dead charger. A cart off the charger self-discharges 4% a week. The bots and autopilot tow a charged cart over for each start and put it back on the charger after.

**Wear is hidden until inspected, and shows up later.**
- At 85 the damage can't be missed: the report opens at the next week open without an inspection.
- A start through pitted pins can arc into the plane's external power receptacle: (wear − 60) / 60, so 17% at 70, 42% at 85, 67% at 100, seeded from the order. Nothing shows at sign-off. It is a hidden defect on the plane that surfaces 1–4 weeks later through the existing `gpu:arc` row (a burnt receptacle; from 90 wear the severe kind, a melted plug), traced to *"the ground power start on a worn cart cable Seb signed off in week 12"*. The repair replaces the receptacle; there is no redo, because the start itself was fine. A 100-hr inspection finds it first.
- The electrician's fix: *GPU cart cable insulation is cracked at the plug* (effect `gse`: that cart is tagged out, no starts on it) is a wire-up job (`gpuCable`). Cut the cable back past the damage and fit a new 28 V DC plug. The cart's plug has sockets (the pins are on the airplane's AN2551 receptacle): the red 2/0 AWG lead to the + socket, the black 2/0 to the − socket, and the small lead, fed from +, to the interlock (small) socket; it mates with the receptacle's short pin, so the airplane's external power relay closes only once the plug is fully seated. Each conductor is stripped to its barrel's depth and clamped, with no hook. From tier 3 the plug face shows only its moulded + and −. The fix resets the wear (to 0 for a clean job, (0.85 − score) × 120 otherwise). A fix that doesn't hold comes back in 1–2 weeks with the plug end burnt again.

**Avionics work on ground power.** A com radio swap needs a charged cart hooked up to the plane, as a start does: the radio's ops check runs the bus on ground power, not a sagging battery. It takes 5% of the charge and 3 wear (a plug-in). (As first built it was an optional +2 health bonus; the review fixes made it required.)

**On the island.** Each cart is drawn on the apron in the island's style: a small yellow cart with its charge light (green from 60%, amber from 30%, red below), a cable to the charger outlet on the hangar wall while it charges, beside the plane with a cable to its receptacle when hooked up (on the dock for the floatplane), a red tag when tagged out, and its light over the night grade. Tapping a cart opens the ground power sheet: `role=button`, keyboard focusable (SVG takes a lower-case `tabindex`), a 44 × 44 map-unit hit area (47 px zoomed to the mechanic's zone on a phone). The ops panel's *Ground power* card shows the same thing; its rows are 44 px targets. Island-lab scenes: `gse`, `gse-zoom` (a tagged-out cart, one hooked to the twin on jacks), `gse-night`. Node budget: the beaten scene is 1365 nodes (1339 before; the limit is 1500).

### Five more cross-trade reports (19 rows)

| Reporter → fixer | Report | Physical cause → fix | Puzzle (job) | Effect |
| --- | --- | --- | --- | --- |
| Mechanic → electrician | Hangar 28 V ground power receptacle keeps going dead | The hangar's 28 V DC maintenance supply plugs into a 120 V branch circuit. An open or loose connection upstream of its outlet kills it, or drops it out under load. The electrician meters the run; the supply's outlet is always the last device on it | meter (`hangar`) | cap |
| Mechanic → electrician | GPU cart cable insulation is cracked at the plug | Raised by wear, never drawn at random (see above) | wire-up (`gpuCable`) | `gse`: cart tagged out |
| Mechanic → analyst | GPU starts never make it onto the charter invoices | The ground power fee is a pass-through the billing never picks up, so the carts' cost lands in *Ground power (net)*, a price driver in the variance review, and gets billed from then on | variance (`gpu`) | leak $150 |
| Electrician → mechanic | Bucket truck boom creeps down: hydraulic leak at the lift cylinder | Oil escaping on the lift cylinder's load side (the base port O-ring, or the rigid tube from the holding valve) lets the raised boom settle. Lower it onto its rest first: a load-side fitting is never opened with the boom up, and an extended cylinder holds oil out of the tank. Replace the seal that leaks, then top up with the decal's ISO 32 AW oil, boom stowed | hydraulics (`boom`) | cap |
| Analyst → mechanic | Company van brake pedal is spongy (it goes most of the way down, and firms up when you pump it) | Air in the brake lines: bleed at the wheel off the pedal (bleeder open, press, close), keeping the master cylinder above MIN, then fill to MAX with DOT 3/4 brake fluid, a glycol. Mineral 5606 or ATF swells a DOT system's rubber seals; silicone DOT 5 doesn't mix | hydraulics (`van`) | leak $150 |

In the new set all three trades report (mechanic 3, electrician 1, analyst 1) and all three fix (mechanic 2, electrician 2, analyst 1). *Company van wheel is wobbling* stays, as the torque job it is.

**The hydraulic bench's vehicles** (`generateHydraulics(…, job)`: the aircraft's brakes are unchanged):

| | Bucket truck (`boom`) | Company van (`van`) |
| --- | --- | --- |
| Placard | ISO VG 32 AW hydraulic oil, level checked with the boom stowed | DOT 3 or DOT 4 (from tier 3, sometimes DOT 4 only), from a sealed container, fill to MAX |
| On the shelf | AW 32; 5606 (it mixes, but is far thinner than the decal's oil: −0.2); DOT 4 or Skydrol (contaminate it); AW 46 from tier 3 (not the decal's grade) | DOT 4; 5606 and ATF (mineral: they swell the seals); DOT 5 (silicone: won't mix); DOT 3 on a DOT-4-only cap |
| The job | The *lower boom* lever lets it down a step at a time, its oil back into the tank, and the lift gauge falls to 0 on the rest. While it's up, the leak lets it settle and the oil goes on the bed. The *Cylinder* tab: tap the fitting or seal that leaks and replace it. Opened with the boom up, it drops (capped at 0.3). From tier 3, the rod's normal oil film and an old dry weep upstream of the holding valve look oily too | No gauge and no accumulator. The *Brake* tab: bleeder open, press the pedal, a slug goes down the hose (bubbles until it's clear). Run the reservoir below MIN and the master cylinder draws air again |
| Must be right for a pass | The leak fixed | Bled firm, bleeder closed |
| Blind hides | The *boom dropped* call-out and its fault sound, *fresh oil*, the ticking step card, the CONTAMINATED card | *dry!*, fault sounds on air, the CONTAMINATED card |
| Blind keeps (the world) | The boom's thud onto its rest, the drips and the puddle, the wet fitting, the lift gauge | The bubbles in the hose, a soft pedal, the level in the master cylinder |

`tests/blind.test.ts` plays both blind and not: opening the lift circuit under load, and running the van's master cylinder dry. The GPU plug, the hangar circuit and the GPU billing line live in the wire-up, meter and variance puzzles, whose blind handling is generic.

### Balance

The standard run (`npm run balance`, 26 weeks × 30 seeds) is unchanged at the medians:

| Team | Wk → T2 / T3 / T4 / T5 | Min cash | Weeks < $0 | Defect incidents / wk | Revenue / wk |
| --- | --- | --- | --- | --- | --- |
| Three friends | 8 / 11 / 16 / **21** | $5,889 | **0** | 0.118 | $9,210 |
| All average | 7 / 10 / 16 / **21** | $6,554 | **0** | 0.079 | $9,970 |
| All good | 5 / 8 / 16 / 21 | $6,735 | 0 | 0.009 | $11,908 |
| Every solo / absent team | stays at tier 1 | | | | |

Robustness (`npm run balance -- robust`, 360 games per team), against the base commit run the same day:

| Team | Wk → T5 (4 crews) | Miss T5 by wk 26 | Weeks < $0 |
| --- | --- | --- | --- |
| Three friends | 22 / 23 / 23 / 22 (before: 22 / 23 / 22 / 23) | 57 (before: 60) | 3 (before: 4) |
| All average | 21 / 22 / 22 / 22 (before: 22 / 22 / 22 / 22) | 19 (before: 21) | 4 (before: 4) |

The negative weeks are the same late tier-4 grid-and-generator collapses described above. The carts barely move the sim: about 1.4 starts per season, because *Ground power start* is a low-weight job. Raising its queue weight to 7 doubled the starts but cut three friends' minimum cash to $2,402, so it stays at 4. The random draw of reports now has 18 rows to pick from (the cable report is never drawn), at the same rate.

**Knobs:** `GSE` in `data.ts`: `minStart` (30), `drain` (25 / 45), `wear` / `arcWear` (7 / 15), `chargePerWeek` (60), `powerPerPoint` (0.5), the bands (40 / 70), `autoReport` (85), the arc curve (`arcFrom` 60, `arcSpan` 60).

## The part chain and the ground power carts together

The two Phase B branches were built side by side and merged into `integrate`, the part chain first, then the carts. Both merges kept each feature whole. This is what changed to make them one system.

### No deadlock between a grounded plane and a start

- **A start never opens a chain, and no chain step needs a cart.** *Ground power start* has no IPC chapter in `CHAIN.kinds`. The lookup and the research are paperwork, the buy and engineering cards are money, and the install is the original job (tire and brake, prop, hydraulics, radio, alternator).
- **A plane AOG for a part can still take a ground power start**, as an engine run on the ground. It doesn't put the plane back in service. Like any job on an out-of-service plane, it never rolls a deferral incident while it waits.
- **A cart left on a plane that goes down isn't stuck there.** A cart can be hooked up to a plane that then goes AOG for a part (or gets grounded by a safety call). Hooking it up to another plane tows it straight over, as before. What changed is that everyone now picks the cart for a start the same way (`startCart` in `econ.ts`):
  1. the cart already on that plane, if it's charged and in service;
  2. else the best-charged free one (on the charger, or parked);
  3. else one on a plane that isn't flying;
  4. else one on another plane.

  Autopilot and the paper-sim bots use it. Before, both only took a free cart, so an island whose only charged cart sat on a grounded plane never got its start from autopilot.
- **The start's card says where that cart is:** *Hook a charged cart up to Float F-3 first: GPU cart 1 is on Cargo C-7, AOG for a part* (or *grounded this week*). *Ground power carts ▸* opens the sheet on that cart, and the carts card and sheet say *Hooked to Cargo C-7 (AOG)*.
- **A cable report holds up starts, never the chain.** A tagged-out cart is the electrician's move, and only starts on that cart wait for it. `tests/chaingse.test.ts` runs a chain through to its install with the only cart tagged out, and then does the start after the fix.
- **Autopilot and the bots check the charge when each start comes up**, not at the top of the turn. With two starts and one charge, the first goes, the second waits, and its slot goes to the next job. Before, autopilot could sign off the second start with no cart at all (it checked the charge before the first start drained it), and a bot lost the slot.

### Whose move is it: reports and chain steps count the same way

One list, `crossMoves()` in `ui/select.ts`, holds both kinds of cross-trade wait:

| Move | Whose | Who waits |
| --- | --- | --- |
| A crewmate's report | the fixer | the reporter |
| The chain's IPC lookup, logbook research, install | mechanic | analyst (nothing to buy, or no revenue from the plane, until it's done) |
| The chain's part card, engineering fee | analyst | mechanic |
| Engineering reviewing, the part in transit | nobody | |

Every surface reads it:

- **The crew strip** (*waiting on you* / *blocking you*). Before, the chain counted only when it was the analyst's move.
- **The cards at the top of the island screen**: *Waiting on Mia: the GPU cart cable insulation is cracked at the plug (GPU cart 2 tagged out)*, *You're blocking Ravi: …*. The chain keeps its own banner with the stepper, so it isn't shown twice. Its part card no longer also counts as a plain *1 approval waiting*.
- **The end-turn check** (new). *End turn* now asks first whenever a crewmate is waiting on this seat, and names them: *Seb is waiting on you: approve the part (066-22500, $310; Cargo C-7 is AOG).* Before, an analyst with no desk task left ended the turn without a word while the grounded plane's part sat on the desk. Reports and chain steps never roll an incident, so the "pick up deferral risk" line now only appears when other jobs are carried.
- **The pings (ntfy).** The chain already pinged when it moved on to someone's move. A report now pings too:
  - when it's raised mid-week, for example a cable written up at an inspection: *Seb reports: The GPU cart cable insulation is cracked at the plug. Mia, your move.*;
  - inside the week-resolved ping when it opens with the week;
  - when it's closed out.

  The texts come from one pure function (`pushes()` in `ui/select.ts`), which `tests/chaingse.test.ts` checks. The Me tab's notification blurb lists them.

### On the island

- **A plane AOG for a part is drawn like one AOG from wear**: at its AOG spot, on jacks, with the mechanic and the wrench bubble. Before, it stayed on its stand as if it were flying. The island's screen-reader description says *AOG for a part*.
- **A cart hooked to it follows it.** For the floatplane that's the dock's T-head. The cart now parks at the east end, and the mechanic stands between it and the parts kit. Before, the two overlapped; the carts branch never shot this position.
- Island-lab scenes: `chain-aog` (the cargo plane down for brake linings, cart 1 still hooked up) and `chain-float` (zoomed to the mechanic: the floatplane down for its alternator, the cart on the dock). Node budget: the beaten scene is still 1365 nodes (limit 1500).

### Balance: unchanged, no tuning

The bots always put a cart back on the charger after a start, so no cart is ever stranded in the paper sim. The new rules only change what autopilot and the bots do with a stranded cart, or with a second start on one charge. Both runs are identical to the merged state before these changes: the full week-by-week histories match, seed for seed (three friends, all average and all good, 30 seeds, two crews each).

Standard (26 weeks × 30 seeds, medians):

| Team | Wk → T2 / T3 / T4 / T5 | % weeks B+ | Min cash | Weeks < $0 | Revenue / wk |
| --- | --- | --- | --- | --- | --- |
| All good | 5 / 8 / 16 / 21 | 98% | $6,735 | 0 | $11,714 |
| All average | 7 / 11 / 16 / **22** | 91% | $6,554 | **0** | $9,553 |
| **Three friends** | 8 / 11 / 16 / **22** | 87% | $1,247 | **0** | $9,079 |
| Naive analyst | stays at tier 3 | 98% | $6,176 | 0 | |
| Every solo / absent team | stays at tier 1 | | | | |

Robust (`npm run balance -- robust`, 90 seeds × 4 crews per team):

| Team | Crew | Wk → T5 | Miss T5 (of 90) | Weeks < $0 | Min cash |
| --- | --- | --- | --- | --- | --- |
| Three friends | – / a / b / c | 23 / 24 / 24 / 23 | 22 / 29 / 25 / 18 | 1 / 1 / 1 / 2 | −$5,332 / −$8,092 / −$3,366 / −$3,781 |
| All average | – / a / b / c | 22 / 22 / 22 / 22 | 15 / 16 / 13 / 8 | 0 / 0 / 0 / 0 | $5,856 / $4,354 / $5,812 / $4,353 |

- **Against the chain alone:** three friends reached tier 5 in weeks 23/24/24/23 there too, with 21/28/24/20 misses and 2/1/1/2 weeks below $0.
- **The three friends' $1,247 minimum** (seed 3) is week 26 of a tier-4 collapse: no rentable houses for two weeks, and no chain open. It's the same week in the merged state before these changes, so it's the known tier-4 knife-edge, reshuffled by the two merged branches' extra jobs.
- **The targets hold:** tier 5 in week 22 for both target teams, no week below $0 in the standard run, and every solo or absent team stays at tier 1. So nothing was tuned.
- **If the late dip shows up in play,** the first knobs are the ones each branch named: `CHAIN.chance` (0.3), and the new jobs' queue weights.

## Phase B review fixes (round 1)

Three review lenses (an A&P's, a player's and a systems one) played the integrated branch on a phone and in the paper sim. What changed:

### Ground power: the plane's own airframe, and a reason most weeks

- **The start is on the plane the cart is hooked to.** `launchFor` sets the airframe from the plane's model and its placard (`externalPower` in `aircraft.ts`, derived from the seed): the cargo plane (IC-208C) is the turbine, with its start current limit (800, 900 or 1000 A) and *battery switch ON*; the floatplane (IC-185F) is a high-wing piston on its amphibian floats, 28 V, *battery master ON*; the twin a low-wing piston. The title carries the name and the registration. The tier only sets the aids and the clock. The cart's drain follows the plane's model, not the puzzle.
- **Its Manual** is the flight manual's *Section 4: Starting engine with external power* with the plane's placard (volts, amp limit, battery switch), and the procedure at tiers 0–2.
- **Weak battery (flight days).** From week 2, about one week in three (`GSE.weakChance` 0.35) opens with a plane whose battery is weak: its first start is on ground power. A charged cart in service hooked up to it when the week resolves starts it (a start's drain, its wear, and through pitted contacts the chance of an arc); otherwise its first flight is lost. It costs no job slot: it's the cart chore, most weeks. The cart stays on that plane after the start; the mechanic (or autopilot for an empty seat) puts it back on the charger next week. The end-turn sheet warns about both.
- **Radio work needs a cart** hooked up to the plane (the ops check runs the bus on ground power), 5% of its charge and 3 wear. It replaced the optional +2 bonus.
- **The inspection is a call.** A close-up of the plug end with tells that follow the hidden wear: harmless crazing from 22, cracks through the boot from 40, heat discoloration from 60, pitted and burnt contacts from 70 (a melted edge from 90). *Serviceable* keeps it in service as it is; *Tag it out* writes it up in the words of its band (*insulation cracked at the plug*, or *plug contacts pitted and burnt: new plug*). A re-inspection waits a week after a new plug.
- **A botched cable fix stays hidden.** A fix under the clean line leaves the visible wear under *cracked*, so the next inspection can't give it away; the comeback, when it fires, burns the plug end again. A later fix (or a tag at an inspection) consumes that cart's pending comeback: the botch went with the old plug end. A cable already tagged out is never written up twice.
- **The GPU plug wire-up** has sockets on the cart's plug (the pins are on the airplane's AN2551 receptacle): 2/0 AWG leads to + and −, and the interlock (small) socket fed from +.
- **The island's cart** has a tap target of 44 CSS px at any zoom (a near miss opens its sheet).

Engagement per 26-week game (30 seeds): flight days about 9, a first flight lost to a missing cart 0.1–0.4, starts 1.6–1.7, cable reports 1.5–2.5 (before: 0.2–0.3, the cable never reached *cracked*). The paper-sim mechanic calls a plug end well inside its band right 97% of the time and near the edge of *cracked* by skill; at a flat skill it had tagged good cables a third of the time and flooded the electrician.

### The manual on an altered airplane (ICA)

`PlantDef` carries the alteration's ICA values (torques; the power pack's fluid): the 4-blade prop's bolts 80–85 ft-lb lubricated and its spinner screws, the heavy-duty brakes, the power pack (MIL-PRF-5606 only), the radio tray, the starter-generator's V-band and QAD nut, the alternator's pulley nut and belt. On an assembly the plane's STC or field approval replaced, `manualCard` puts the ICA line first as this airplane's (`eff: 'ICA'`, its document and approval), and keeps the airframe manual's lines printed, marked *not this airplane: assembly replaced by STC …* at tiers 0–2. The torque and hydraulic puzzles work to the ICA line; torquing to the airframe manual's value there is a sure defect (`torque:ica`, `torque:ica:propBolt`). The data plate lists the alteration and tags an SB on the assembly it removed *n/a: Beaumont propeller removed by STC …*. The part chain's steps show the part's own task card (the brake linings', not the wheel's).

### The part chain

- **The research branch is common now.** An altered plane's trouble is mostly on its altered assembly: a job on the planted ATA finds a part at `CHAIN.plantedChance` 0.9, a job elsewhere on that plane at 0.3 × `CHAIN.chance`, an unaltered plane at `CHAIN.chance` 0.3. About 40% of chains are now *not in the IPC* (before: 6–20%), and a third of the three friends' games see the logbook research and engineering (before: under a fifth). The plant sits on a **fixed per-model ATA list** (not the catalog's jobs), so a later catalog or tuning edit can't re-roll a live island's airplanes; `tests/aircraft-golden.test.ts` pins registrations, serials, SBs, alterations and P/Ns for four island seeds.
- **The electrician's move: the circuit check.** On a com radio, an alternator or a starter-generator, a bench order opens for the electrician beside the lookup: the meter puzzle on the airplane's 28 V DC circuit (bus, breaker, switch or relay, regulator or GCU, connectors, the unit), under the mechanic's supervision (14 CFR 43.3(d)). The fault is seeded (`CHAIN.wiringShare` 0.3 in the wiring). The part card waits on the call (`check` in the stepper). *The unit*: bought. *The wiring*, found: fixed there, no part, the lookup dropped, the mechanic finishes the job. A good unit bought for a wiring fault makes no difference at the install: it goes back for a credit, and the electrician meters again (the unit ruled out). A dead unit left in service after a wiring call, or a break still in the wiring after a fix at the wrong spot, is a sure hidden defect that comes back as a pilot write-up; the A&P replaces the unit or splices the wire. Autopilot calls the unit (the symptom), so an empty seat never holds the plane.
- **The analyst's call.** The part card shows what a week grounded costs (a guest plane: its projected revenue; the cargo plane: its kits by boat) and what the chain has cost so far. When the cargo plane is the one down, the freight is on the PO: the AOG boat (+$350, here when the week resolves) or the next guest flight (free, a week later). A chain card stays approvable after End turn, and one that came in after the analyst ended the turn goes through at the resolve on the standing AOG approval, unless it was deferred.
- **Receiving.** The part's paperwork first: *8130-3 in the box, matches the PO*. Now and then (`CHAIN.noPaperwork` 0.12) a part comes without it, or with a S/N that doesn't match the unit: a week in quarantine, then it goes on. A returned part is **credited its price less the restocking fee** (*Returned: $220 credited ($40 restocking)*); the freight is spent. When receiving shows the IPC doesn't cover the assembly on the airplane, the next step is the research, not another lookup.
- **Smaller:** the hydraulic filter finding is a clogged element with sludge, no metal (metal would call for the pump and a flush); the alternator gives no output (rotor field or diodes), the starter-generator its GEN OFF light; the logbook research's work order is the chain's own finding, on its side, naming the job that found it, and says *IPC lookup: not in the IPC* (no stores slip); no chain on the safety-wire job; `ipc:unapproved` is the company's records audit (or the FAA inspector's surveillance of the GMM), not a ramp check; the chain's paperwork is exempt from the grid-down cap and damages nothing when a lend-a-hand botches it; a blind lookup gets its provisional XP settled; a stale lookup says it is still waiting in the new week.

### Version skew (a tab on the old build)

The live build writes island docs of format `v: 1`, and an open tab or an installed phone app can keep running it after a deploy. In a replay (`tests/fixtures/skew-79f806b-*.json`: this build's chain docs moved on by the live engine), its resolve cancelled the chain's step orders and made the stopped job ready, and its approval made the part order ready with the chain still at the buy: a plane grounded forever, or finished with no part.

- **The doc version gate.** This build writes `v: 2` (`DOC_VERSION` in `src/net/firebase.ts`), and `firestore.rules` accepts only `v == 2`. Deploy the rules with the hosting build: an old tab's writes are refused (permission-denied) instead of landing. This build reloads on permission-denied (at most once a minute).
- **Reload on a new version.** An open page reloads when a new service worker takes over (`controllerchange`), so no tab keeps the old engine.
- **The engine version.** The doc carries `engine` (`ENGINE_VERSION` 2). `apply()` refuses a doc saved by a newer engine instead of writing over it, and the app reloads.
- **Self-heal.** Every action and every week open first puts the open chain's orders back as they should be (`healChain`): a missing or cancelled lookup, research, check or card is recreated, a paid card moves the chain on, and the job waits for the part until the install.
- **Live docs.** `tests/fixtures/live-79f806b-*.json` are three docs the live engine wrote (tier 1, tier 3, and mid-week with seats part way). `tests/skew.test.ts` loads them, runs every selector, and plays ten more weeks, the same in memory and through a JSON round trip.

### Pacing

An AOG plane is off the week's schedule (its flights were cancelled when it went down), so an AOG week can still be a perfect week for the on-time grade. `tests/engine.test.ts` guards the pace: the three friends reach tier 5 by week 26 in at least 75% of seeds 1–30.

### Balance after the fixes

Standard (`npm run balance`, 26 weeks × 30 seeds, medians):

| Team | Wk → T2 / T3 / T4 / T5 | % weeks B+ | Min cash | Weeks < $0 | Revenue / wk |
| --- | --- | --- | --- | --- | --- |
| All good | 5 / 8 / 16 / 21 | 100% | $6,742 | 0 | $11,778 |
| All average | 7 / 11 / 16 / **22** | 92% | $5,016 | **0** | $9,695 |
| **Three friends** | 8 / 11 / 16 / **22** | 88% | $2,273 | **0** | $8,992 |
| Naive analyst | stays at tier 3 | 100% | $6,166 | 0 | |
| Every solo / absent team | stays at tier 1 | | | | |

Before the fixes: three friends $1,247 minimum, all average $6,554, tier 5 in week 22 for both. The electrician-absent team now dips below $0 for 7 of 780 weeks (−$3,517) at tier 1: nobody fixes the cart's cable, so it is often tagged out on flight days. Absent seats aren't sensible play, and it still never leaves tier 1.

Robust (`npm run balance -- robust`, 90 seeds × 4 crews per team):

| Team | Crew | Wk → T5 | Miss T5 (of 90) | Weeks < $0 | Min cash |
| --- | --- | --- | --- | --- | --- |
| Three friends | – / a / b / c | 23 / 24 / 23 / 23 | 21 / 20 / 20 / 14 | 6 / 6 / 2 / 3 | −$9,050 / −$28,561 / −$6,550 / −$6,413 |
| All average | – / a / b / c | 22 / 22 / 22 / 22 | 15 / 12 / 6 / 4 | 1 / 1 / 0 / 0 | −$1,872 / −$5,198 / $6,252 / $5,048 |

Before: three friends missed tier 5 in 22 / 29 / 25 / 18 games (now 75 of 360, before 94) with 1 / 1 / 1 / 2 weeks below $0; all average missed it in 15 / 16 / 13 / 8 (now 37, before 52) with none. The misses fell (the AOG schedule fix, and bots that use a returned request's reason). The late tail grew from 5 to 17 negative weeks for the three friends, in 12 of 360 games: mostly a single week at 25–26 at tier 4, largely on the seeds that dipped before (40, 67, 3, 45), plus a few new ones such as crew *a* seed 3, a long mechanic absence into a storm-and-grid collapse with no chain open. It moves between seeds with any change (a planted chance of 0.7 or a chain chance of 0.25 give 13 and 17), so it was left as is. At a weak-battery chance of 0.45 one standard seed (6) collapsed after an electrician absence left the only cart in a patch-and-comeback loop; 0.35 is the highest that keeps the standard run clean.

**Knobs:** `GSE.weakChance` (0.35), `GSE.weakFrom` (2), `GSE.avionicsDrain` / `busWear` (5 / 3); `CHAIN.plantedChance` (0.9), `offPlant` (0.3), `wiringShare` (0.3), `noPaperwork` (0.12).

## Real job flow (docs/JOBFLOW.md)

The trades' work comes from alerts now (a squawk, a trend, a due item, a guest's complaint, a code notice), each with a hidden cause. A tech finds the task in the manual and the parts in the IPC or the materials list; what's on the shelf is reserved and the trade's work budget approves it at once; anything to buy is a card for the analyst, who runs real stock (purchase orders, receiving, payment net 7, min/max, bins) instead of kits. Wrong tasks and wrong parts come back later. Four packages: A the engine and data, B the technicians' screens, C the analyst's desk, D the NPC staff.

### Engine and data (A)

What A delivers: the item catalog (every IPC row of every model, fig 79-20, the shop's consumables, the electrician's materials with their NEC basis, tools, building materials), the tasks, the search, the symptom tables, `stdPick` and the judges, the reducer's flow moves (`plan`, `nff`, `mel`, `melExtend`, `makeSafe`, `askBench`, `repick`, `dropJob`, `request`, `cancelReq`, `approve` on a flow card, `approveReq`, `deferReq`, `buy`, `setStock`, `scrap`, `nudge`, `setStanding`), the week's new steps (standing approvals, receiving, the payment run, replenishment, the ledger), `migrate()`, the staff constants and stubs, the flow selectors in `select.ts` (`flowMove`, `flowMoves`, `dueNow`, `yourMoves`, `dockNext`, `endTurnChecks`, `openTarget`), the bots and autopilot, and the tests. The UI still draws today's screens; B, C and D draw the new ones on this engine.

Where A departs from the spec, and why:

- **No-fault-found rate.** `ALERTS.nff` is 0.2 a week for the mechanic and 0.4 for the electrician (the spec: 0.125 and 0.25). The spec's own rates give an NFF share of 8%, under its 10–20% target; these give 12–13%. Alert volume stays within ±10% of the base engine's orders (mechanic −2.5%, electrician −4.6%; `tests/flow.test.ts`).
- **The bots' misses.** A missed call turns into a wrong move at `BOT_MISS` (task 0.15, pick 0.15, a real fault closed NFF 0.1, 0.3 when it looks NFF), times (1 − hit), one roll for the whole pick. The spec's rates (1 − hit, 0.25, 0.6) doubled the three friends' hidden defects. The bots stand for players who search, and the search puts a fixing task and the book's line in the top three at the teaching tiers.
- **The bots read a plain finding.** At alert tier 2 and below the finding of a radio or generator fault says which it is ("It's the unit."), so the mechanic bot plans the unit at once and asks the electrician only for the wiring. At tier 3 and up it always asks. The electrician bot does the check first thing in its turn (a plane waits on it).
- **A placard running out is urgent.** The fin bot and autopilot approve a card whose MEL placard runs out within a week as they would one whose alert grounds a plane (`dueJob` in `stock.ts`); before, the card waited until the plane was down, and its part then landed a week late.
- **Autopilot doesn't let the island rot.** An absent analyst's autopilot also approves a card that has waited three weeks, while spendable cash stays above the $2,000 freeze. The electrician's tier-1 jobs often need a tool or a lot, their cards are dear, and at the $4,000 floor they waited forever, failing 60% of weeks at 3 × their labour. The analyst-absent team went from 71 weeks below $0 to 16.
- **The fin bot's first insurance spare** is at most $400 (`BOT_SPARE_MAX`): four linings or a tire, not a $950 radio or a $760 alternator. The placard and a lead-1 order cover those.
- **Stock.** `STOCK.coverWeeks` 2 (a suggested max is the ROP plus two weeks of the family's use; the spec's four held too much cash), `STOCK.lotMaxUnit` $150 (the broker's lot is shop stock the island draws, never a rotable, a lot, a tool or a building material). The starter stock adds the cargo plane's linings at tier 2 (4 · 0/4), as the twin and the float have theirs.
- **The teaching weeks give a week.** An alert raised in the first two weeks of the flow (a new island's weeks 1–2, a migrated island's first two) is due next week at the earliest. Otherwise a new crew opened week 1 to the twin flying restricted and a cottage closed for alerts nobody had yet been able to plan, and the first review was a D.
- **MEL extension.** The analyst's one extension can be given in the week after the placard at the latest (`That placard has run out.` after that), so a placard from the mechanic's turn can still be extended before the next week's flights.
- **Timing.** A replenishment is placed at the resolve, after receiving: its lines land at the next resolve (`eta` W + 1). A line received for a job resets that job's deferral clock (waiting on parts isn't a deferral).
- **Nothing flew.** A week with no flight at all brings the PO of the job that has waited longest (safety work first) on a mainland boat at the AOG price, as the base engine's kit boat did; otherwise a fleet grounded for want of a part could never get one. The POs that wait a week are one review line per carrier.
- **Doc size.** The week reports keep 26 weeks (was 40; every screen reads 12 at most), the ledger 26 rows with the week in progress, and a migrated island's backfill 25. A 52-week island peaks at about 110–125 KB (budget 150 KB; `tests/docsize.test.ts`). The spec's "today about 35 KB" was wrong: the base engine's doc is about 110 KB at week 52, almost all of it week reports.
- **Fixes found by the new tests:** the memoized analytics (families, velocity, classes, flags) could be read part way through a move and go stale (`apply()` now forgets them before handing the state on); `mel`, `makeSafe` and `askBench` checked the alert's trade, not the mover's; a pending card's lines to buy raise the order flag (urgent, its one tap approves the card); a key set to `undefined` in the chain's bench record kept its place in memory but not through JSON, so the doc stringified differently after a round trip.
- **Money per job.** `kitValue` is 300 at tier 1 (the spec: 340). The labour band test (0.85–1.25 × today's card, 7,558 combinations) exempts the ICA picks, dearer by design: cargo 23-10-01 (island seed 3), 24-30-01 (31), 32-40-02 (8); float 23-10-01 (14), 24-30-01 (6), 24-30-02 (6), 29-10-01 (17), 32-40-02 (19); twin 23-10-01 (3), 24-30-01 (9), 24-30-02 (9), 29-10-01 (8), 32-40-02 (27).
- **Overhead.** `TIERS[].overhead` is $150 lower at tiers 2–5 (the spec's first lever), so `TIERS[].fixed` is 1,500 / 2,150 / 2,850 / 6,850 / 9,350 with the standard crew's payroll (760 / 1,080 / 1,080 / 1,260 / 1,320).

#### Balance (26 weeks × 30 seeds, medians)

| Team | Wk → T2 / T3 / T4 / T5 | % weeks B+ | Min cash | Weeks < $0 | Revenue / wk |
| --- | --- | --- | --- | --- | --- |
| All good | 5 / 8 / 16 / 21 | 99% | $6,740 | 0 | $11,583 |
| All average | 7 / 12 / 16 / **22** | 94% | $5,554 | **0** | $9,575 |
| **Three friends** | 8 / 12 / 16 / **22** | 92% | $5,792 | **0** | $9,105 |
| Naive analyst | stays at tier 3 (dead stock, bins over the cap from returns) | 97% | $3,590 | 0 | $4,885 |
| Mechanic / electrician / analyst absent | stay at tier 1 | 40% / 86% / 94% | −$685 / −$9,034 / −$82,060 | 2 / 42 / 16 | |
| Every solo team, nobody | stay at tier 1 | | | | |

The three friends reach tier 5 by week 26 in 24 of 30 seeds (the pacing guard needs 23). Before the job flow: 22 / 22 / 21 for the three friends / all average / all good, $2,273 / $5,016 / $6,742 minimum.

The job flow's numbers, three friends: weeks from an alert to its sign-off 0.68 (the base engine's order to sign-off: 0.64); plane-weeks AOG on an alert per game 3.2 (not stocked 1.9, waiting on approval 0.5, not planned 0.7, the carrier 0.1; the base engine's chain AOG: 3.2); the only guest plane restricted 0.7 weeks a game; fill rate by value 27% (weeks 8–26; the spec expected 45–80%: the fin bot stocks lean, a line gets a min/max only after three uses, and every dollar on the shelf is a dollar short of the $60,000 tier 5 needs); job-weeks waiting on parts 0.11 a week; stock at week 26 $9,711, 73% of the bins; payroll 100% of the standard crew's. A 26-week sim takes 230 ms.

Robust (90 seeds × 4 crews):

| Team | Crew | Wk → T5 | Miss T5 (of 90) | Weeks < $0 | Min cash |
| --- | --- | --- | --- | --- | --- |
| Three friends | – / a / b / c | 24 / 24 / 24 / 24 | 25 / 27 / 24 / 23 | 18 / 1 / 0 / 1 | −$39,804 / −$5,850 / $3,079 / −$1,742 |
| All average | – / a / b / c | 22 / 23 / 23 / 23 | 14 / 11 / 12 / 16 | 0 / 0 / 0 / 0 | $1,157 / $3,593 / $1,123 / $2,614 |

Before the job flow: three friends 23 / 24 / 23 / 23, missed 75 of 360 with 17 weeks below $0; all average 22 in every crew, missed 37 with 2. In the robust sweep the flow is about half a week slower to tier 5 and misses it in 99 and 53 games. Over 22 weeks (60 seeds) the three friends take $7,100 less revenue (the only guest plane flying restricted, houses closed for a hazard) and spend $7,600 more on jobs and stock (the money per job band, the twin's and the turbine's dearer cards, tools, and $6,000 of stock built up), against $5,700 less overhead. The three friends' negative weeks are mostly one game (seed 50: an early storm claim, then the analyst and the mechanic away for weeks at under $4,000, the twin worn out by two deferral incidents in one week), 20 in all against 17 before; the average crews have none (2 before).

**Knobs:** `ALERTS.nff` (0.2 / 0.4), `ALERTS.looksNff` 0.3; `BOT_MISS` (0.15 / 0.15 / 0.1 / 0.3), `BOT_SPARE_MAX` $400; `KIT.base` 300; `STOCK.coverWeeks` 2, `z` 1.28, `lotMaxUnit` $150; `TIERS[].overhead` (−$150 at tiers 2–5); `FREIGHT.aog` $350; the work budgets $500 and the standing limit (their sum).

### Technicians' screens (B)

What B delivers: the job-flow screens in `src/ui/flow/` (one component for both trades: *Your move* and the inbox, the job sheet with its five steps, the AMM / reference search, the airplane's IPC, the supply catalog, the Stock step and its badges, the job view with its lines, the stop sheet, Stores with requests, What's new), all driven by a pure model (`steps.ts`: the steps, the draft and its reducer, what Send dispatches, what it comes to, the tap counts); the ops panel's asset chip row, inbox and `ic:open` / `ic:flow` host (`ops.tsx`); the flow job in the order detail (`orders.tsx`); the reference and generator manual cards (`manual.tsx`); the flow-opened chain's words (`chain.tsx`); the pick line in the puzzle host; week 0's walk-through; the puzzles' pick labels (`conduit.ts` with `takeUp(size)`, `wireup.ts`, `panel.ts`) and the meter's two places; `tests/flowui.test.ts` and `tests/conduit.test.ts`. Played end to end on a 390 × 844 phone and at 1280 × 820 for both trades: a stock hit, a requisition through the analyst's approval to the part landing and the job starting, a no-fault-found close, a one-tap inspection, a hazard made safe, a take-off, a tier-3 job, Stores with a request, and week 0.

Where B departs from the spec, and why:

- **The labour before Send comes from the draft, not the alert.** The Stock step prices labour from the slots the tech has filled (today's card less their standard parts); the engine prices the card from the fault's hidden needs. Reading the needs would tell the tech which slots the fault needs before a single part is picked. So the two can differ when the pick doesn't match the fault (a tire without its tube: the preview's labour is the tube's price higher), and at the edge of the work budget the preview can say *ready now* while the job lands as a card, or the other way round. The banner after Send says what really happened. `tests/flowui.test.ts` holds the preview identical for two alerts that differ only in their cause.
- **Send says what the card comes to.** *"Pull 0 · buy 1 · labour $1,080: a card for Cy, about $1,118 in all"*: the buys in whole packs at the default supplier's price, plus the labour. The analyst's supplier choice or AOG freight can change it.
- **The flow moves on by itself.** Filling the last required slot opens Stock (the 17.2 tap counts assume it: 10 taps for the tier-3 tire, 7 for the GFCI). A task whose slots are all *if needed* (the tire task: which one the fault needs is hidden) moves on once every slot is filled; *Check stock* is always there.
- **The protection slot lights up late.** *Needed here* shows on the protection slot only once the device is chosen and still doesn't give the protection the room needs; before that a note says where it can come from (the device, or a breaker in the protection slot). Lit from the start, it pointed a bathroom's GFCI replacement at an AFCI / DF breaker.
- **"Likely" is per slot.** The teaching tiers mark the standard pick's line for that slot only, so the spa's connectors slot marks the raintight connector, not the EMT stick in the same category (it marked both, and the wire slot marked the EGC's gauge).
- **Three stock states everywhere.** A search row with nothing in stores says *none in stores* (quiet, so the IPC's own badges stay the loud ones). On-order dates say when the line lands (*lands tonight*, *lands next week*, *lands wk 9*): a PO's `eta` is the week whose resolve delivers it, and *here wk 1* in week 1 read as a mistake. Stores reads a line wholly held for jobs as amber (*1 on hand · all for jobs*), not rust.
- **After Send the sheet stays on the job**, with the toast the spec asks for and a banner that stays, so *Start ▸* is the next tap. A closed no-fault-found shows only Investigate done (the other dots struck through) and says what it risks: the fault, if there was one, comes back as a new alert due at once.
- **A flow-opened chain says research, not AOG.** Its banner reads *"Research: the {item} on {plane} isn't in the IPC"*, the order's chip *Research · part chain*, and the plane's downtime words show only when the job's alert grounds it (13).
- **Lend a hand on a flow job runs the install check first**; a stop is a toast, never the puzzle.
- **Week 0's walk-through.** The techs' second step walks one scripted alert (the worn tire on the twin, the bathroom GFCI that trips) through the real job sheet, raised on a copy of the island: nothing is written, and Send says what would have happened. It replaces the techs' *Nobody wins alone* card and second practice puzzle (the analyst's week 0 is unchanged), and marks What's new as seen. The sheet sits above week 0's overlay.
- **The conduit's stick is physical, its labels aren't.** `TAKE_UP` became `takeUp(size)` (1/2 in: 5 in, 3/4 in: 6 in) and the pipe radius follows the stick (0.35 / 0.46 in): a 3/4 in stub marked with the 1/2 in take-up stands an inch short. The stick, connector and wire labels appear only for an EMT pick, along the scene's bottom edge; the fuel dock's lot (no EMT) keeps today's plain 1/2 in stick. A test holds the score identical with and without labels, and every generated 3/4 in instance solvable.
- **Where the labels sit.** The wire-up prints the device's P/N on the device face (the space under the box is the strip tray's); the host's *Your pick* line under the title names the lines in full. The panel names the panelboard a lot brings under its title.
- **The stepper fits a phone.** Five equal columns that may use the head's side padding, 11 px words: *Investigate* beside the electrician's *Reference* overlapped at 390 px with the fallback font.
- **Storage.** A draft lives in sessionStorage per island and alert (`jf:{island}:{alert}`) and is dropped when it no longer fits (its task out of the set, the alert closed, the job done). The asset list's fold and What's new seen are per-viewer conveniences in localStorage. Every access is guarded.

Seen while playing, in other packages' files (for Integrate):

- The Dock's *Start: …* on a flow order calls `onPlay` directly (`home.tsx`), skipping the install check that Your move's Start runs; it should go through `openTarget` for a flow order.
- `alertShort` lowercases the first letter (*r/H main tire* in the Dock), a finding reads *"The fix: gfci replacement"*, a wear alert *"change within 1 weeks"*.
- The belt task (24-30-02) is priced off the alternator kind's card: labour $1,080 for a $38 belt.
- `tests/tasks.test.ts` (money per job, 5.8 s) and `tests/consequences.test.ts` time out at vitest's 5 s default when the machine is busy; both pass alone. They need the `vi.setConfig({ testTimeout: 30000 })` the other whole-matrix tests have.
- `scripts/e2e.mjs`'s week-0 step for the techs (*Do the job*) needs the walk-through instead: *Open the alert*, the five steps, Send, *Next*.

### The analyst's desk (C)

What C delivers: `src/ui/purchasing/` (a pure view model in `model.ts`; the approval cards, the requests, the stock planner with its flags, needs, item and buy sheets and receiving; the Money tab and its charts; What's new), the desk's four tabs in `desk.tsx` (Approvals, Stock, Money, and Staff hosting D's `StaffDesk`), the cost lines on the board, the auction's real lot, the three-way match on real POs, and `tests/purchasing.test.ts`.

- **Families by what they share.** A family holds the right P/N and its near misses, and A names it after its first P/N ("Stop stocking Duplex receptacle, tamper-resistant…"), which reads as one of them. The desk names it by what they have in common (`FAM_LABEL`: "GFCI receptacles 20 A", "THWN-2 #8"; a lot by what it's for) and writes the stop flag in those words with the ledger's own length ("no use in 11 wk": A's text says 26 weeks on an 11-week island).
- **One flag a job.** A's order flag comes a line at a time; a card short of four P/Ns is one flag naming them all, with one approval.
- **The one-tap min/max only for a P/N that moved.** A fast family's near-miss P/N has no use of its own: its flag opens the sheet instead of stocking it.
- **The AOG boat only when it's faster.** A lead-1 line lands tonight on the week's carrier, so $350 of boat buys nothing. The card, the buy sheet and the requests offer the boat when a line would come later, including a line due tonight whose carrier plane is out of service (receiving slips it a week). The requests split each trade's batch: the lines the boat speeds up go on one `approveReq` with the boat, the rest scheduled.
- **The carrier down, in words.** A PO due tonight whose carrier can't fly (the cargo plane for bulk, every plane for the rest) reads "slips to wk N unless it's flying by the resolve"; its job's line in Needs and the card's scheduled option say it too.
- **MEL placards** say where they stand: "runs out at this week's resolve", "ran out last week: the plane is grounded at this resolve unless you extend it", "ran out wk N" (A's one extension can come the week after).
- **Payroll adds up.** A's stub charges the tier's standard crew whoever is on the list: a tier-2 island with the tier-1 crew pays $1,080 for $760 of staff. The Money and Staff tabs name the difference ("Open post of the standard crew (1 pilot)"); under D's payroll it goes away, or reads as hires starting and notice pay. The overhead lines are whole dollars that add up to the tier's overhead.
- **Charts.** Revenue and cash out share one axis: revenue up and cash out down from one baseline, never a second scale; week-end cash is its own line with the $2,000 freeze as a reference line when cash comes near it. The categorical colors are a validated set (blue, amber, violet, gray for context), every multi-series chart has a legend, every chart a readout on tap, hover or focus and a table view. The runway chip is short; a note says what it covers (overhead, payroll, insurance, the loan), since the header's *Fixed* is overhead and payroll only.
- **The auction's lot.** A's `launchFor` passes today's one-kit market with the lot, so `lotMarket` takes the lot's fair and caps the bid at 92% of the lot at list, or at the kit's cap when that one is cash-bound (under 1.2 × its fair). Each line is priced from the catalog's unit price: `launchFor` prices a line by the pack (a $65 can of 20 uses read $1,300 in a $102 lot). Lines read in the packs they come in ("a can of 20 uses"). A real lot is one lot at every tier, bid in $5 steps when it's small.
- **The three-way match on real POs.** The PO and RCVD columns are the island's own and never altered; the issues go on the invoice side (billed over received, a price over tolerance, freight over the PO, discount terms). A PO over three lines becomes several invoices ("po14 (1/2)"); the batch is padded to the tier's count from the resort's own vendors; no sales tax; tier 0 shows the clean ones first. The run's cash is labelled *Float*: it's the puzzle's pot, not the island's cash. The engine still books the match against the week's leak, not per PO (A leaves `PO.caught` unset).
- **What's new** opens only on an island played before the job flow (`flowSince > 1`). A new island starts with the flow, so nothing is new, and a sheet over the desk would block the first week.
- **The tabs.** The bar sticks under the top of the screen; a tab picked while it's stuck opens at its top. The tab chosen lasts the session; the Dock's Next opens Approvals or Stock (`ic:open`). The Staff tab shows the crew read-only while D's `StaffDesk` renders nothing.
- **Part-chain cards** keep A's end-of-turn lock. A chain the job flow's research opened doesn't ground its plane by itself, so its card says the job waits a week and the plane flies.
- **Not in v1:** shelf life and expiry (the engine keeps no lots), core deposits (an exchange unit's core goes back in its box), per-P/N forecasts and spend budgets by category.

### Staff (D)

What D delivers: `src/sim/staff.ts` behind the hooks A wired (who flies what and the pilots' cap, tours, tire wear and write-ups by the pilot, hard landings, the housekeepers' turnovers and reviews, the payroll, the builders' week and its materials, the hiring board, the effect statements, `hire` / `letGo` / `build`, the fin bot and autopilot), the analyst's *Staff and payroll* desk section and the builders' line on Home (`src/ui/staff/`), the staff on the island (`src/ui/island/staff.tsx`) with the placard, no-entry and tag bubbles, four island-lab scenes, and `tests/staff.test.ts` (26 tests). With the standard crew and hard landings off, every week of a season resolves exactly as with A's stubs (`tests/staff.test.ts`); with the stubs on, the game plays as before the staff update (`tests/staffstub.test.ts`).

Where D departs from the spec, and why:

- **The contractor commissions a new tier.** The week a tier arrives (its crew project finishes during a turn), the standard crew's increase for it is flown and cleaned by the mainland contractor: a ferry pilot's 6 flights, a skill-3 housekeeper's turnovers (`commissioning`). From the next week the island's own staff do it. Without this, every tier-up lost flights and bookings in the week before the analyst could see a board with the new places on it. That week the desk says so (*"the contractor's ferry pilot flies the new plane this week only. From week 7 that's your crew: one more pilot."*), and the effect statements look at the week after.
- **The first site's lots come with the island.** A new island has the t2 site's materials on the shelf (`newIslandStaff`): the builders start in week 1, and the analyst first meets the buying on the second site. Without them a tier-1 island spent $640 before its first B+ weeks.
- **A candidate drawn for a need can fill it.** A pilot for the guest planes is skill 3+, anyone else 2+; the rest of the board draws 25 / 30 / 25 / 15 / 5 %. With the plain draw, a pilot need was often a skill 1 who can't fly guests.
- **Pacing the builders' materials (the fin bot).** The next tier's site work two units at a time; a site two tiers ahead all at once when the next tier's crew project opens, or earlier while the cash stays over that tier's cash gate after the buy; three tiers ahead (the builders ran ahead) it waits. A's `finStock` bought the next two units whenever the builders idled (`buyBuildUnits` in `src/sim/bots.ts`: that one line removed, in A's file). It spent the tier-3 $18,000 gate on the villas' materials and put tier 3 back about a week. Tried and dropped: buying ahead of a tier with no cash gate (the Lodge's materials at tier 3, the generator house's at tier 1) put tier 5 back 0.3–0.7 week for all average; a three-unit villa site (decking, ties and shutters as one unit) cut the late villa sites from 13 to 9 of 30 but cost a seed of tier 5.
- **The spec's "no new building below today's health in 90% of games" isn't met.** A tier's site work is short when the tier arrives in about half the games (three friends: 16 of 30). The villas and dock are short in 13 (8 lower on average), the generator house in 3 (7.5 lower), the Lodge in 2 (4 lower). The villa site is the tight one: its materials wait for the tier-3 cash gate, and tier 4 follows tier 3 by about four weeks. Having all of it on time costs tier 5 more than the late site work costs the new buildings (two to three weeks of the electrician's upkeep). An analyst who buys ahead when the cash allows, or hires a second builder for the villa site, is on time; the desk shows the cash gate beside the buy.
- **Effect statements.** Each is `projectWeek` with and without the person, as specified, plus:
  - a hire that adds no revenue this week (a builder, a spare) says *"no new income"* instead of repeating its wage as the net;
  - a pilot whose gap a grounded or restricted plane hides this week shows it on the full schedule (*"every flight this week has a pilot; on the full schedule +2 flights a week"*);
  - a builder's finish week counts a skill 4–5 hire's notice week, and says *"either way: no sooner with them"* when it wouldn't move.
  - The spec's *"new villas start at 81 instead of 84"* needs the crew project's quality and the week the tier comes, and neither is known at the hire. While the build's tier's crew project is open (the tier can come at this week's resolve), the statement gives the difference: *"if tier 4 comes this week, its new buildings start 4 higher"*.
- **The fin bot's crew.** Only guest-qualified pilots (skill 3+) count toward its standard crew. It hires the best candidate who starts now (then the most skilled, then the cheapest) asking at most 1.25 × the skill-3 wage.
- **The naive analyst** hires every skill 4–5 candidate while the wages (hires giving notice included) stay under 1.8 × the standard payroll. In a crunch (spendable under $4,000) it lets the dearest hire above the standard crew go, severance and all. It ends at 171% of the standard payroll, stays at tier 2 (tier 3 before the staff update) and has 3 weeks below $0: over-hiring costs something now.
- **Idle builders.** A site two tiers ahead waiting on materials on purpose says so once, as information (*"Builders idle: the site work on the villas and the seaplane dock (tier 4) waits for materials. Buy them on the desk (Staff) when the cash allows."*), not every week as a fault, and Home offers no one-tap buy for it.
- **Extra cottages.** Plots `h8` and `h9` in the lagoon grove; the grove's young palms on a plot in use are cleared. `COTTAGE_SHELL` is $17,000: at tiers 3–4 a cottage rents a median $800–900 a week when the guests outnumber the houses, a payback of 21–27 weeks. The start sheet prices a housekeeper in when every turnover is taken, and says when the cottage would sit empty (*"3 of 4 houses are booked"*). The `cottages` variant (three friends, an analyst who starts one at tier 4 over $40,000) starts one in 28 of 30 games and finishes it by week 26 in 20. It reaches tier 5 in 12 of 30 games (the plain three friends: 25), with 0 weeks below $0: a cottage is an investment for an island that keeps playing, not a shortcut.
- **A's files touched (for the merge):**
  - `src/sim/bots.ts`: the one line above.
  - `tests/staffstub.test.ts`: it tests the stubs, so it sets `STAFF_TEST.stubs` in `beforeAll`.
  - `tests/flow.test.ts`: the staff moves' refusals are the real ones now (*"That candidate took another job."*, *"They have already left."*, *"Extra cottages open at tier 3."*).
  - `tests/gse.test.ts`: `withCargo()` and `weakWeek()` add the tier-2 second pilot, since one pilot can't fly the cargo plane's four flights too.
- **Left for A:**
  - `nextTierProgress` has no *"Site work (builders): 2.5 of 4"* line yet (15.5).
  - The review's *"2 flights lost: the pilots fly 6 a week. Hire a pilot?"* (and its housekeeping twin) still asks when a hire starts next week.
  - `PROJECTS[2].jobs.fin.title` *"Pay the builders (three-way match)"* now reads as paying the island's own builders; it's the mainland contractor's invoice.

**On the island.** Up to 8 figures, each a `<use>` of one of three symbols drawn once (`StaffDefs`, kept in `staff.tsx` beside the figures rather than in `LifeDefs`):

- builders in hard hats and hi-vis on the open site, with a two-frame hammer when motion is on;
- a pilot by the lead guest plane and one by the cargo plane (none by a plane that's down, or by the floatplane on the water);
- a housekeeper at up to two open houses.

None are out in a storm or at night; at night one figure works late in the lit office window. A site shows the further of the crew project's stage and the builders' (`⌊3 × done / need⌋`). The restricted plane gets a sunflower placard bubble, a house closed by a hazard the no-entry bubble, a made-safe house a small tag. The beaten scene is 1,390 SVG nodes (budget 1,500; `scripts/island-shots.mjs` now fails over it). New island-lab scenes: `staff`, `staff-night`, `staff-alerts` (placard, no entry, tag, a cottage going up) and `staff-cottages`.

#### Balance (26 weeks × 30 seeds, medians)

| Team | Wk → T2 / T3 / T4 / T5 | % weeks B+ | Min cash | Weeks < $0 | Revenue / wk | Payroll @26 | Late site work |
| --- | --- | --- | --- | --- | --- | --- | --- |
| All good | 5 / 9 / 16 / 21 | 99% | $6,739 | 0 | $11,525 | 104% | 30% of games |
| All average | 7 / 12 / 16 / **22** | 95% | $5,554 | **0** | $9,668 | 104% | 53% |
| **Three friends** | 8 / 12 / 16 / **23** | 91% | $5,792 | **0** | $9,226 | 103% | 53% |
| Naive analyst | 5 / – (tier 2 at week 26) | 93% | −$1,174 | 3 | $4,456 | 171% | 3% |
| Mechanic / electrician / analyst absent | stay at tier 1 | 40% / 85% / 94% | −$687 / −$9,035 / −$82,076 | 2 / 44 / 16 | | 100% | |
| Every solo team, nobody | stay at tier 1 | | | | | 100% | |

Against the same code with the staff stubbed (A's table): tier 5 in 25 of 30 games for the three friends (stubbed 24), mean week 23.3 (23.3); all average 27 of 30 (27), 22.6 (22.3); all good 30 of 30, 21.0 (21.1). That is within the spec's ±0.5 week. The pacing guard holds (it needs 23), and no solo or absent team leaves tier 1. Where the money goes per game (90 seeds): about $2,100 of building materials, $520 of payroll over the standard crew's (hires ask 0.95–1.1 × the wage, and skill 4 costs 1.2 ×), 0.4 flights and 0.2 bookings lost to a crew short for a week, 0.4 hard landings and 1.3 builder-weeks of rework.

Robust (90 seeds × 4 crews), beside the same code stubbed:

| Team | Crew | Wk → T5 | Miss T5 (of 90) | Weeks < $0 | Min cash | Stubbed: wk → T5 / miss / weeks < $0 |
| --- | --- | --- | --- | --- | --- | --- |
| Three friends | – / a / b / c | 24 / 24 / 25 / 25 | 30 / 26 / 34 / 32 | 18 / 4 / 1 / 1 | −$38,286 / −$23,294 / −$2,996 / −$5,499 | 24 / 24 / 24 / 24 · 25 / 27 / 24 / 23 · 18 / 1 / 0 / 1 |
| All average | – / a / b / c | 23 / 24 / 24 / 24 | 19 / 19 / 19 / 22 | 1 / 0 / 0 / 4 | −$424 / $3,592 / $1,137 / −$10,701 | 22 / 23 / 23 / 23 · 15 / 11 / 12 / 16 · 0 / 0 / 0 / 0 |

The robust sweep shows the cost the 30-seed table hides: half a week (three friends) to a week (all average) later to tier 5 at the median, and 23 and 25 more of 360 games missing it by week 26. That is the $3,000 above, at the $60,000 gate, in games that were already making it by a week or less. The staff don't slow the job flow: the latency stays at 0.66–0.69 weeks (A's standard run: 0.68). If it needs buying back, the spec's levers come in order: `TIERS[].overhead` (A already took $150 off at tiers 2–5), then the `BUILDS` quantities.

**Knobs:** `STAFF` (wages 320 / 180 / 260, skill wage × 0.7 / 0.85 / 1 / 1.2 / 1.45, severance 2 weeks, duty 6, guest pilots skill 3+, charter 0.04, hard landings 0.8% / 0.5% / 0.3% / 0.2% / 0.1% a flight, −2 health, turnovers 2–6, reviews 0.025, builder output 0.6 / 0.8 / 1 / 1.25 / 1.5, rework 20% / 12% / 6% / 3% / 1%, the standard crews, the board 3 / 4 from tier 3, at most 10 staff); `BUILDS` as specified; `COTTAGE_SHELL` $17,000.

### Integration: the four packages together

The branches merged in order (engine, the technicians' screens, the analyst's desk, the staff) with one text conflict (`docs/ONBOARDING.md`: the analyst's calls and the section numbers). What the integration changed so the flows work across the seats, and why:

- **The Dock's Start on a job-flow job goes through the ops panel's host** (`openTarget({ order })`), so the install check runs first and a stop shows its sheet, as *Your move*'s Start does; before, the Dock called the puzzle directly. Other orders keep today's direct start.
- **The analyst's Dock says "2 to approve ▸"** (the legacy cards too). *"Review 1 card · 1 requisition ▸"* was cut to *"Review 1 card · 1 …"* on a 390 px phone; the desk and the End-turn check say what they are.
- **MEL on the island and the board.** A plane flying on a placard gets a small placard bubble (the same glyph as the restricted plane's, small, as a made-safe house's tag is small beside the closed house's no-entry sign), and the week's review says it: *"Twin N-12 flew with com 1 dead on transmit placarded INOP (MEL C, to week 2, extended). Fix it by then, or it flies restricted."* (`melOn` in `econ.ts`). Make-safe already showed on both (the tag, *"rented at 75%"*).
- **A card that comes in after the analyst ended the turn** says honestly whether it goes through tonight. The tech's toast and job view, and the analyst's push, compare it with the standing limit and the freeze (`standingWords` in `select.ts`); the review now says why a late card waited (*"over the standing limit ($1,000 left), so it waits for Cy"*). Before, the toast promised tonight for a $1,714 card over a $1,000 limit.
- **The analyst's nudge shows on the tech's row** (*Cy nudged*, this week), beside the push and the feed line.
- **Staff in the rest of the game.** The desk's Staff tab is D's desk alone (C's read-only fallback went). The tier checklist on the Board shows the builders' site work (*"Site work (builders): 2 of 3"*, with what it means for the new buildings); it is information and never gates the tier (`tierUnlocked` reads the unlock lines only). The review's *"Hire a pilot?"* / *"Hire a housekeeper?"* names the hire giving notice instead (*"Oskar H. starts week 7."*). The tier-3 project's analyst job reads *"Pay the contractor (three-way match)"*. The purchasing test's payroll case follows D's real payroll (the stub case is kept under `STAFF_TEST.stubs`).
- **Wording.** `lowerFirst` keeps a side or an acronym as written mid-sentence (*"R/H brake pedal…"*, *"The fix: GFCI replacement"*; they read *"r/H"* and *"gfci"*), and *"1 weeks"* reads *"1 week"*. The write-up sheet says *"+ parts"* instead of the retired kit.
- **Labour for a cheap fix under a dear kind is capped** at `LABOR.capX` = 4 × the book hours. A belt priced off the alternator's card was $1,080–1,270 of labour for a $38 belt, a com connector or a unit-less avionics write-up $1,020–1,100, which the A&P and the analyst would both call out. Now $360. The band test exempts exactly those causes (and a tube under the tire's card at the top tiers) and pins the list; every other job keeps today's card. The balance moved a little the right way (below).
- **The auction's lot.** `launchFor` prices the lot's lines at the catalog's unit price (it priced them by the pack: a $65 can of 20 uses read $1,300) and passes the lot's own market (fair, and a cap at 92% of the lot at list or spendable less the freeze), which the puzzle's `lotMarket` takes as it is.
- **Stock flags.** A slow line used in the last four weeks isn't flagged to stop; the stop text counts the ledger's own weeks (*"no use in 11 weeks"* on an 11-week island); the no-min/max flag names only a P/N that moved itself, never the near-miss beside it. The bots don't read these flags.
- **Week 0's step survives a remount** (sessionStorage per island and seat, cleared when the seat finishes week 0): in the online run a sync blip once re-rendered Mia's week 0 from its first card.
- **Tests and scripts.** `tests/tasks.test.ts` and `tests/consequences.test.ts` get the 30 s timeout the other whole-matrix runs have. `scripts/e2e.mjs` walks week 0's alert for the techs, then week 1 across the seats: the mechanic takes an alert through the flow and asks Stores for a line, the analyst finds the request on the desk at once and buys it (the run fails if not), approves the cards and hires, the electrician makes a hazard safe and plans; after the resolve the requested line reads one more on hand (the run fails if not). `scripts/e2e-online.mjs` does the same across devices on the emulator: the laptop's plan is seen on the phone, the request on the analyst's laptop, and the line on hand on the phone after the week resolves everywhere. When receiving quarantines that line for its paperwork (an OEM part, about 1 line in 50 on a fresh island's seed), the review must say so and the phone must read *"on order, lands tonight"*; the run then ends week 2 and finds it on hand in week 3.

Left as the packages recorded them: the three-way match books against the week's leak and doesn't hold a PO's payment (`PO.caught` stays unset; since fixed, see *Job flow review fixes*); shelf life, cores and per-P/N forecasts are v2; the stores can go a bin or two over the cap after approvals (the desk shows it in rust); the staff's *"no new building below today's health in 90% of games"* is missed as D recorded.

#### Balance after the integration (26 weeks × 30 seeds, medians)

| Team | Wk → T2 / T3 / T4 / T5 | % weeks B+ | Min cash | Weeks < $0 | Revenue / wk | Payroll @26 |
| --- | --- | --- | --- | --- | --- | --- |
| All good | 5 / 9 / 16 / 21 | 99% | $6,739 | 0 | $11,507 | 104% |
| All average | 7 / 12 / 16 / **22** | 95% | $5,783 | **0** | $9,469 | 104% |
| **Three friends** | 8 / 12 / 16 / **23** | 92% | $5,882 | **0** | $9,189 | 103% |
| Naive analyst | 5 / – (tier 2 at week 26) | 93% | −$1,174 | 2 | $4,444 | 173% |
| Mechanic / electrician / analyst absent | stay at tier 1 | 40% / 87% / 92% | −$2,067 / −$8,522 / −$82,076 | 6 / 36 / 31 | | 100% |
| Every solo team, nobody | stay at tier 1 | | | | | 100% |

The analyst-absent team's weeks below $0 went from 16 to 31 in the 30 seeds: one seed (24) now falls into receivership where it didn't (seed 15 falls either way). It is the absent analyst's known cliff (an early claim, cards the autopilot won't approve, then deferral incidents), not the cap: over 90 seeds the same team has 129 weeks below $0 with the cap and 148 without (seeds 50 and 89 no longer fall).

Robust (90 seeds × 4 crews): three friends reach tier 5 at 24 / 24 / 25 / 25 and miss it in 31 / 27 / 30 / 30 games (118 of 360; D's run 122, A's stubbed 99), with 13 / 4 / 1 / 0 weeks below $0 (D: 18 / 4 / 1 / 1); all average 23 / 23 / 24 / 23, missing in 18 / 18 / 17 / 21 (74; D 79), 1 / 0 / 0 / 0 weeks below $0 (D 1 / 0 / 0 / 4). A 26-week sim takes 259 ms; the standard run 1 min 27 s, the robust sweep 4 min 52 s.

## Job flow review fixes (round 1)

Three review lenses played the integrated job flow: the trades' (an A&P's, an electrician's and an FP&A reader's eye on the content and the money), a player's (all three seats on a phone and at 1280 px) and a systems one (the engine, the migration of live islands, the paper sim). What changed, and why.

### The trades' calls

- **No fault found only on a "could not duplicate" finding.** `nff` is refused when the finding at the alert's tier shows the fault (*"The finding shows the fault: fix it, placard it or make it safe."*), and Investigate hides the button there. An NFF close over a measured fault was a free deferral: the comeback raised no incident, so on a week-13 island a guest's shock complaint closed NFF made $5,454 against $4,089 left open, and a float plane's dead com closed NFF made $11,200 against $2,541. The finding already says which case it is, so the gate gives nothing away. An intermittent that hides at tier 3+ (`looksNff`) can still be closed wrongly, and comes back due at once.
- **The only guest plane's findings are within limits.** Each sole-plane cause has a `soleFinding`: *"Two prop bolts at the bottom of the torque band, stripes intact, no fretting"*, *"linings 0.12 in (limit 0.10)"*, *"the wire is nicked at the twist, not parted"*, the drain plug's wire loose with the plug tight, paint cracked at two rivets with the fairing firm, the accumulator at the low end of its card's band. What the mechanic reads is now a squawk an IA would let fly to its due week, which the decision to soften the sole plane's squawks assumed.
- **A take-off's site line names the equipment, not the conductors** (*"Spa: 240 V, needs a 60 A GFCI disconnect · pad 43 ft from the panel"*). *"60 A breaker, 6 AWG"* answered the take-off's question, and the judge's undersized rule could never catch anyone. A repair on an existing circuit keeps its breaker and wire: reading them is the job.
- **The puzzles are the alert's site** (`PuzzleContext.site`, from `puzzleSite` in `launchFor`): the trace names the alert's room and breaker; a receptacle on an individual circuit is one outlet; a warm plate or plug is an IR-thermometer hunt among live devices (the hot joint reads 130–160 °F); a flicker is the meter's loose neutral under load (at the panel it is the lug screw). A hall's warm switch used to launch *"Kitchen is dead"*.
- **Content** a working A&P or electrician would call out: the prop bolts are a re-torque case (stripes moved, no fretting); the engine trends justify the pull (38/80 against a master orifice of 46 with the exhaust valve eroded; a scored barrel with iron in the filter); penetrant results are left to the job; the accumulator prints its card's precharge (from the airplane's S/N block); 32-40-01 takes the in-lb wrench, the relining a lining rivet tool (`T-RIVET`), Type I fluorescent penetrant a UV-A lamp (`T-UVA`; both in the starter tools); the com wiring cause is a transmit-side sag (*"27.8 V at the tray unkeyed, 20 V keyed: a loose power pin sags under the transmit load"*), so the squawk is *"dead on transmit; it receives fine"* for both causes; LOT-DIST is a 600 A panelboard, the generator site's switch 60 A and LOT-XFER 200 A; the judge computes conduit fill from Chapter 9 Table 5 for the conductors actually picked, with the real count, and calls a feed oversized only past the next standard size (240.4(B)); a heater cause's site is the heater's 30 A 2-pole circuit and the make-safe names the breaker it tags; *"the leg to the villas"*; R-GRND's *"8 AWG copper up to a 2 AWG service"*.
- **The MEL extension is the maintenance side's call.** The mechanic asks (*"Ask Cy to extend the MEL (once)"*), the analyst approves the cost (the card or the Needs list), and the feed names both. A placard covers the item to its due week (`until = max(week, due)`): placarding a week early spent it on a week when nothing was due. The mechanic's End turn says what the MEL still allows (placard it, tag it, ask for the extension, waiting on the analyst).
- **Stores shows the techs on hand and on order, not the min/max**, which pointed at the effective P/N beside its near miss.

### The analyst's money

- **Scheduled freight is charged per shipment**: `FREIGHT.sched` $35 a mechanic's, $25 an electrician's, $0 for the yard's building materials. One supplier's lines on one carrier landing the same week ride one shipment, however many POs they are on, so the week's buys and the replenishment run consolidate for nothing extra; a broker's lot and the migration's POs carry none. It is what makes stocking ahead pay on an island: before, a lead-1 line bought per job was free and landed that night. The card, the buy sheet and the request queue show it (*"+$35 freight: its own shipment"*). The crews pay about $1,400 a game more in freight (the average crew: $470 → $1,890 a game, the AOG boat included).
- **Safety work due this week or next goes through the standing approval whatever the limit** (down to $0 spendable, and it doesn't use the limit up). In pass-and-play the analyst often plays first: a $1,120 alternator card on the only guest plane waited a week over a $1,000 limit and the twin flew 1 of 4. The Stock step's preview uses the card's total (freight included) and says which it will be; the analyst's End turn warns that the techs haven't played, with a one-tap raise on Home.
- **Cash in stock** is inventory less payables (the vendors finance what came in unpaid); open POs show apart as *Committed, not yet paid*. The old *"cash tied up"* counted received-unpaid stock twice and open POs as cash, about 40% over. *Cash out, 4 weeks* replaces *Where it went* (stock bought is working capital, not opex), and labour reads *Shop charges (overtime, call-outs, outside help)*.
- **The three-way match**: the vendors overbill about 3% of the POs matched (at least $60), plus a plainly bad invoice ($100–240) in about 2 weeks of 5, seeded per week (it was 8% plus $80–220: 26% of a week's POs). The overbilling sits on the POs (`PO.over`); the match's result sets `PO.caught`, so the payable and the payment run drop by what it found.
- **Planner and auction**: no stop flag while the forecast, an open job, a part chain or an open PO draws the family, or on a slow family never used yet; the spa panel isn't an insurance spare, and a spare's bench consumables (lining rivets) count with it; a broker's lot is one trade's.
- **Staff**: reviews count the housekeepers who turn the bookings over, best first, so a spare moves nothing (*"reviews down: −$33 a week"* for a spare who cleans nothing is gone); the hiring board sorts by what a hire nets and folds the ones who'd cost more than they bring; a cottage is priced on an 8-week average of flights and bookings (a week with two planes AOG priced a $17,000 shell at $11 a week).
- **Needs**: a scheduled inspection reads *Scheduled* with no nudge; *"(1 flight)"*.

### Whose move

- **The research branch is a tap away**: *Open the logbooks ▸* (or the IPC, or the circuit check) on the job, the chain banner, the Dock (*"Open the logbooks · Cargo C-7 ▸"*) and Your move, whose chip reads *Your move: logbooks* on the viewer's own row, never *Waiting on* themselves.
- **A chain's plane is AOG only when it is grounded** (`chainGrounds`, `chainTag`): otherwise it *flies restricted*, *flies on its MEL placard to wk N* or *flies meanwhile*. End turn, the pushes and the desk's chip said AOG beside *"flies meanwhile"*, and an analyst would have paid for the AOG boat on it.
- **An empty required slot is named before Send** (Materials unticked, *"Pick the GFCI device first"*, a button back to the slot, Send refused): Send used to say *"Ready: start it now"* and the start refused it.
- **The week's revenue work** (the load sheet, a ground power start) shows in Your move and the Dock (ahead of an alert not due this week), and End turn names what skipping it costs (*"No load sheet: half of Twin N-12's charters stay on the ramp."*).
- **Smaller**: the seat chips read *"you wait on Ben"* in a neutral tone until that seat has ended (red *"blocking you"* before a friend had played read as blame); no toast after Send (it covered the sheet and repeated the banner); the taskline drops a repeated task number; the IPC's negative badges test first (*not effective* was green); an NFF alert's search chips come from its own words; the Dock skips a job the per-turn cap would refuse; a desktop tab switch opens the tab at its top; a new island's analyst gets the desk's intro in week 0 (the mechanic's tire as the real approval card, on a copy of the island) instead of the legacy practice card; the move chip takes a second line rather than losing its word on a phone.

### Systems

- **Wiring causes occur.** The generator never produced one (a kind's pairs held only that kind's causes), so the circuit check's wiring branch had never run in play. `pairsFor` now gives a bench symptom its unit and wiring pairs: about 1 bench alert in 4 is the wiring in the paper sim. A wiring alert fills its unit's slot (`slotKind`).
- **A wrong "unit" call plants nothing**: it shows at the install (the new unit makes no difference, the check comes back), and once the wiring is fixed and signed off nothing comes back. It used to plant a hidden defect that surfaced after the plane had been fixed. A wrong "wiring" call on a dead unit is still a sure hidden defect. `tests/flowbench.test.ts` drives the whole path with the electrician present and away.
- **Migrated islands' analytics count the flow's weeks only** (`flowRows`, `flowWeeks` from `flowSince`): a backfilled ledger has no item use, so every migrated island's stock was *dead* and its families classed on empty weeks. Classes need 8 flow weeks, *dead* 25. A week-0 island migrates with `flowSince = 1`; What's new says how the kits' store credit was valued ($300 at tier 1 to $420 at tier 5, not the list price paid); a com write-up needs the radio.
- **The bots and autopilot placard a bench item while it waits on the electrician's check** (MEL C, where the model has it), not only when a part must be bought. A com wiring fault on the only guest plane, with the electrician away for a week, flew the twin restricted for five weeks and emptied the cottages: one of the three friends' collapses in the robust sweep.
- **Money edges**: dropping a never-started job gives its labour back (a wrong task re-planned paid twice); a part reserved in the old P/N stays that P/N when the rest arrives superseded (the pick is split); a trade keeps at most 12 open stock requests, a repeat folds into the open one, a requisition or a won lot needs a free bin, and a late request that waits gets its review line.
- **The mistakes crew** (`npm run balance`): the three friends with a human's slips, a near-miss or wrong-model pick on one plan in ten and a stock request a week between the techs. Per game: 0.7 receiving returns, 1.8 install stops, 22 requests, $27 of restocking fees; tier 5 at week 26 (median) against the three friends' 23, and a minimum of $2,382 with no week below $0. The bots don't make these mistakes, so the balance never priced them: about three weeks of tier-5 pace.
- **Bundle**: the analyst's desk, the job sheet and week 0 are chunks of their own (`src/ui/lazy.tsx`, fetched when the seat's screen first shows, the job sheet on idle): the main chunk is 70 KB (it was 742 KB and tripped the 700 KB warning) and a phone's first load 1,340 KB (469 KB gzip) instead of 1,467 KB (505 KB). The service worker still precaches every chunk; a chunk that fails after a deploy reloads the page (`ic:stale`).
- **CI**: `vi.setConfig({ testTimeout: 30000 })` in `tests/chainmoney.test.ts` (2.8 s in the full suite on a dev box).
- **The e2e scripts** follow the new words and the random islands they meet: the make-safe button names its breaker (*"The kitchen's 20 A breaker: off and tag it"*), a tech's alert rows skip the week's revenue work (`.jf-arow.rev`), the Dock may lead to the load sheet, a Start that needs a ground power cart hooks one up first, and the pass-and-play run, like the online one, follows a requested line that receiving quarantined for its paperwork into week 3.

### Left as they are

- **Payroll scale** (open question 4): wages 2.5–3× with the overhead cut to match would make a hire real money. It changes every island's P&L, so it waits for the owner's call.
- **Cores and shelf life**: v2, as recorded.
- **The only guest plane past due** still flies restricted (a near-miss a flight). A mainland sub-charter instead is a new economy line; the softened findings answer the trades' point.
- **The builders on Home**: zooming the island to the build site needs a zoom box of its own and bigger figures under the 1,500-node budget: not a cheap fix.
- `STAFF_TEST` stays a test-only flag (default off).

### Balance

**The lever**: `TIERS[].overhead` is another $150 a week lower at tiers 3–5 (1,620 / 5,440 / 7,880), and `TIERS[].fixed` with it (2,700 / 6,700 / 9,200: the standard crew's payroll is unchanged). It pays back the new freight (about $1,400 a game) and a little more.

Standard (`npm run balance`, 26 weeks × 30 seeds, medians):

| Team | Wk → T2 / T3 / T4 / T5 | % weeks B+ | Min cash | Weeks < $0 | Revenue / wk | Payroll @26 |
| --- | --- | --- | --- | --- | --- | --- |
| All good | 5 / 9 / 16 / 21 | 99% | $6,530 | 0 | $11,583 | 105% |
| All average | 7 / 12 / 16 / **23** | 93% | $5,791 | **0** | $9,304 | 104% |
| **Three friends** | 8 / 12 / 16 / **23** | 91% | $6,271 | **0** | $9,114 | 103% |
| Mistakes (the three friends' slips) | 8 / 13 / 16 / 24 | 90% | $2,382 | 0 | $8,364 | 102% |
| Naive analyst | 5 / – (tier 2 at week 26) | 94% | −$33,118 | 8 | $4,478 | 170% |
| Mechanic / electrician / analyst absent | stay at tier 1 | 44% / 88% / 96% | −$981 / −$12,288 / −$10,830 | 3 / 46 / 3 | | 100% |
| Every solo team, nobody | stay at tier 1 | | | | | 100% |

Before the fixes: three friends 8 / 12 / 16 / 23 with $5,882 minimum, all average tier 5 in week 22 with $5,783. The analyst-absent team falls below $0 in one seed again (seed 15, 3 weeks: the known cliff of cards the autopilot won't approve, then deferral incidents at tier 1), which the run before the fixes happened to miss. Absent seats aren't sensible play, and it never leaves tier 1. A 26-week sim takes 280 ms.

Robust (`npm run balance -- robust`, 90 seeds × 4 crews):

| Team | Crew | Wk → T5 | Miss T5 (of 90) | Weeks < $0 | Min cash |
| --- | --- | --- | --- | --- | --- |
| Three friends | – / a / b / c | 24 / 24 / 24 / 24 | 24 / 24 / 31 / 17 | 1 / 1 / 1 / 4 | −$729 / −$8,674 / −$1,685 / −$3,294 |
| All average | – / a / b / c | 23 / 23 / 23 / 23 | 18 / 20 / 18 / 24 | 0 / 0 / 0 / 0 | $1,753 / $3,570 / $3,347 / $4,016 |

The review measured the branch at 118 and 74 misses (medians 24/24/25/25 and 23/23/24/23) against Phase B's 75 and 37 (23 and 22). Now 96 and 80, with the three friends' weeks below $0 down from 18 to 7 and none for the average crew. **Phase B's numbers aren't reached**, and money isn't what's missing. On 180 games (seeds 1–45 × 4 crews, before the bots' MEL fix) the overhead cut at tiers 3–5 bought this:

| Overhead cut, tiers 3–5 | Three friends: median / misses | All average: median / misses |
| --- | --- | --- |
| none | 24 / 43 | 24 / 44 |
| −$150 (taken) | 24 / 37 | 23 / 41 |
| −$300 | 24 / 37 | 23 / 36 |
| −$450 | 24 / 37 | 23 / 34 |

The branch before the fixes did 24 / 49 and 23 / 40 on the same games; freight turned off is worth 3 of them for the average crew. What misses now: (1) the crew project, which needs a job from every seat, sat through a long absence (the three friends' crew *b*: the mechanic away weeks 21–26 with $70,000 in the bank); (2) the electrician's tier-4 overload, when four cottages' code notices, storm damage and a feeder come due together at 3 jobs a turn and the houses decay past 45 into must-do work (the average crew's late collapses, cash falling from $42,000 to $12,000 in six weeks). Neither is bought back with overhead. The next levers are there: stagger the code notices per house, and let the tier-4 generator hold back when a trade's ready jobs pile up. They change play, so they wait for the owner's call.

## Balance (paper sim, `npm run balance`): 26 weeks × 30 seeds, medians

Retuned after the balance and systems critiques, then re-run after crew projects, the credit curve and the functional fixes (Sep 26). The table below predates the consequences above; the current numbers are in *Phase B review fixes*.

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

## Deploy log

**Sep 27, 04:32 UTC: island art + consequences + mechanic content + Phase B go live** (run #10, `a80202c`). Hosting and `firestore.rules` went out 4 s apart.
- **Doc format now `v: 2`.** A live probe after the deploy confirmed the rules refuse a `v: 1` write (`permission-denied`, nothing written).
- **Everyone must reopen the app.** An app opened before this deploy keeps the old engine until it reloads, and until then its moves are refused. Close it and open it again, twice if the first open still served the cached copy.
- **Run #9 was blocked at `npm test`.** Two whole-season paper-sim tests took 5.1–5.5 s on GitHub's 2-core runner, over vitest's 5 s default, though they finish in under 5 s locally. Fix: the per-file `vi.setConfig({ testTimeout: 30000 })` that `tests/ipc.test.ts` already used, now also in chain, chaingse and gse, with no assertion changed. The full suite also passes at `--testTimeout=2500`, so no other test is near the limit.
- **Not yet done:** a human playtest on real phones. Automated coverage is 461 tests, pass-and-play e2e on phone and desktop, a 4-device online e2e on the emulator, and replays of the live docs.

**Sep 28, 02:17 UTC: the real job flow, finance tracking and NPC staff go live** (run #12, merge `bd1e1d2` of branch `jobflow`). Hosting released at 02:17:23 and `firestore.rules` at 02:17:27.
- **Doc format now `v: 3`, engine 3.** Live v2 islands migrate on their first read: kits become store credit, a starter shelf, and a What's new sheet.
- **The live probe writes nothing now.** It tries to update a missing island doc, so a write the rules allow fails as not-found and no doc is created, even before the new rules have propagated. It signs in anonymously and deletes that user afterwards. Result 30 s after the rules release: `v: 2` → permission-denied, `v: 3` → not-found. The script is `docs/handoff/probe-gate.mts` at the repo root.
- **Everyone must reopen the app,** as on Sep 27. A tab on the old build has its moves refused, and it reloads itself at most once a minute.
- **Before the push:** QA passed on `bdf97ba`. That covered tsc, 689/689 tests, the build, balance, e2e on phone and desktop, the online e2e on the emulator with 10/10 rules probes, migration of 8 docs from the live build, reverse skew, 28 island-lab scenes and scripted phone runs of every new flow. The merged tree passed again here: tsc, 689/689 tests with `--maxWorkers=2 --testTimeout=3000`, and the build. On CI, `npm test` took 74 s.
- **Robust sweep is worse than the Sep 27 build.** Three friends miss tier 5 in 96 of 360 games (was 75); all average miss in 80 (was 37). The standard targets hold. Details and levers are in *Job flow review fixes → Balance*.
- **Not yet done:** a human playtest on real phones.

## Open questions for the three of you

- **Deadline hour:** 20:00 creator time. If the three of you span time zones, change `resolveHour` in `createIsland`.
- **Difficulty:** if weeks feel too easy by tier 3, raise `ECON.decay` from 5 to 6. That is the single biggest knob.
- **Trust model:** anyone with the island code can play an open seat. That's fine for friends. Don't post the code publicly.

## 2026-09-28: the only guest plane past due is grounded; a mainland sub-charter flies the guests

Branch `gap-charter` (HANDOFF §3 "Known gaps", §7.3). It replaces JOBFLOW decision 4 ("never grounded by an alert; overdue, it flies half its flights with a near-miss each").

- **Why.** An A&P won't sign a plane flying past its MEL interval or an airworthiness item's due week: "restricted" flew an unairworthy plane on purpose. The pillar the old rule served (grounding the only guest plane must never empty every house and bankrupt the island) is kept a different way.
- **The rule.** Past due, the only guest plane (the twin through tier 3) is AOG like any plane (`alertAog` has no exception any more) until the fix is signed off. Meanwhile a **mainland sub-charter** (an outside Part 135 operator's plane and crew) flies the island's guests in, automatically: nobody has to act, nobody is gridlocked.
  - It flies only the guests who need a seat: the houses that can rent and the housekeepers can turn over, less the ferry's parties, up to the twin's own schedule in that week's weather. No day tours. The island's pilots don't cap it (the operator's own crew).
  - Its flights carry POs as guest flights do (a box in the hold), so a tier-1 island with the twin down isn't cut off from its parts.
  - No near-miss is counted: nothing flew an unairworthy plane.
- **The money.** `SUBCHARTER = { ownPerFlight: 180, mult: 1.5 }` in data.ts, so `SUB_FEE` = $270 a flight.
  - $180 is the island's own cost of a guest flight on the twin in game dollars (the pilot's share of a $320 week over 4 flights ≈ $80, avgas and oil ≈ $70, reserves and the landing fee ≈ $30). The sim still carries those in payroll and overhead; nothing is saved while the twin sits, so the island's extra cost is the whole fee.
  - Sanity check: a Part 135 piston-twin charter runs roughly 1.3–1.8× an owner's fully loaded cost for the same airplane (its fixed costs, the positioning leg, its margin). 1.5× is the middle. At the game's scale (a $320-a-week pilot is about a quarter of a real one) $270 is about $1,000 a real leg.
  - A week of it: tier 1 (2 cottages) 2 × $270 = $540; tier 2 (4 cottages) $1,080; tier 3 (4 cottages, 2 on the ferry) $540. Plus the day tours the twin doesn't fly. Against the old rule: at tier 2 it's cheaper than restricted flying (2 of 4 houses empty, about $2,800 of rent lost); at tiers 1 and 3 about $540 a week dearer. Both cost the week's grade.
  - Booked as ledger spend `subcharter` (trade: mech, the flight-ops side), `WeekReport.costs.subCharter`, the review's "Mainland sub-charter" cost line, the Money tab's "Insurance, incidents, sub-charter, other" group, and the review line *"Twin N-12 stayed on the ground: a mainland sub-charter flew the guests in (2 flights at $270, $540)."*
- **Visible before it happens, to all three seats.** Investigate (*"Airworthiness item, due week 8: from week 8, Twin N-12 is grounded until it's signed off, and a mainland sub-charter flies the guests at about $1,080 a week (4 flights at $270)"*; the MEL note the same, *"Past it, …"* / *"It ran out: …"*), the placard's review line, the analyst's card chip (*"From wk 8: sub-charter ~$1,080/wk"*, then *"Sub-charter ~$1,080/wk"*), the Needs row, the mechanic's End turn line, the row flags (*AOG · sub-charter*), the ops chips, the cash card (*"Sub-charter −$540 this week"*) and the Home stat (*"flights · +2 sub-charter"*). The card's downtime (the fin bot's and autopilot's "waiting a week") counts the fee and the lost tours.
- **Decisions beyond the brief (reasons):**
  - **The safety call brings the sub-charter too.** Grounding the only guest plane by `tag` used to empty every house, which pushed a mechanic to fly a known defect rather than ground it. Same pillar, same fix. The bots never tag planes, so balance doesn't move.
  - **The on-time grade keeps the twin's schedule on the books** while the sub-charter flies (0 of 4: the operator's flights aren't the island's). Other AOG planes stay off the schedule as before. Without this a grounded twin at tier 1 graded flights A (0 of 0) and the mech-absent team's B+ weeks jumped from 44% to 99%. With it, a grounded week grades flights D (0 of 4) and safety A, where the old restricted week graded flights C (2 of 4) and safety B; at tier 2 revenue is better (all four houses booked, not two).
  - **Not covered:** a twin below 40 health (worn out, not grounded by an item) still flies nothing and empties the houses, as before: that's neglect's consequence, and covering it would prop up the solo and absent teams. From tier 4 the float shares the guests, so the twin is grounded with no sub-charter, like any plane. "One MEL extension by the analyst" is unchanged.
- **Old docs.** The only new stored fields are optional and derived at resolve (`costs.subCharter` in the week report, `sp.subcharter` in the ledger row); nothing new on the island itself; a v3 doc with the twin flying restricted mid-week loads and resolves here (the twin goes AOG on the same alert, the sub-charter flies). Fixtures written by the live engine (bd1e1d2): `tests/fixtures/v3-bd1e1d2-restricted-{t1,t2,mel}.json`, in `tests/subcharter.test.ts` (16 tests). An unknown spend category on an older reader falls into "Other" (`spendSeries`).
- **Version gate: needed, not bumped here.** An open v3 client would resolve a week flying the twin restricted where this engine grounds it. The integrator bumps ENGINE_VERSION/DOC_VERSION/rules to 4 once for the release, with the skew test and the live probe, and the crew closes and reopens the app.
- **Balance** (medians; before = 1f92356, after = this branch):
  - standard (26 weeks × 30 seeds): three friends tiers 2/3/4/5 at weeks 8/12/16/23 → 8/11/16/23, 0 weeks below $0 both; all average 7/12/16/23 → 7/12/16/22, 0 both. Solo, absent and nobody stay at tier 1. Mech absent: min cash −$981 → $424, weeks below $0 3 → 0, %B+ 44 → 52 (tier 1 still). `sub` column (weeks on the sub-charter per game): three friends 0.3, all average 0.7, mech absent 18.0.
  - robust (90 seeds × 4 crews = 360 games per team): three friends miss tier 5 in 96 → 93 (24+24+31+17 → 20+25+31+17), weeks below $0 7 → 7; all average 80 → 76 (18+20+18+24 → 20+19+18+19), weeks below $0 0 → 2. The 2 are weeks 25–26 at tier 4 (seed 29 crew a, seed 88 crew c), where no sub-charter flies (the float carries the guests); seed 88's only sub-charter week was week 11. It's the known late-season tail (HANDOFF §7.5), reached by a different path, not the fee.

## 2026-09-28: the feeder re-splice gets its own hands-on scene

The underground feeder to the east cottages (`E_FEEDER_DROP`, `ref:feeder`, the catalog's `feeder`) used to launch the branch-circuit trace: *"Bedroom is dead · Drywall cutaway"*, outlets and a loose backstab. A licensed electrician spots that at once. Now every feeder launch plays its own scene.

**The call: a scene inside the trace puzzle, picked by the job (`Order.job === 'feeder'`), not a new puzzle id and not the meter.**
- Live orders already store `puzzle: 'trace'` with `job: 'feeder'` (flow jobs, the split-bolt repair, redos; a migrated legacy order gets `job = kind`). Picking the scene by job fixes every one of them with no migration and no version bump.
- A new `PuzzleId` in the doc would crash a tab still on the live build when it opened that job (`PUZZLES[id]` undefined), and the old stored `'trace'` orders would still need remapping.
- The meter (option b) is a 120 V branch-circuit voltage scene: no insulation-resistance readings, and it would have needed the same rewrite.
- The trace's mechanics are the real procedure: follow the run from the source, test at the access points, half-split, mark the one place to open up.

**The scene** (`src/puzzles/trace.ts`, `generateFeeder`, `drawYard`):
- A site plan of the yard: the distribution panel with the feeder breaker off, locked and tagged, and the cottages' disconnects open. Its header says *"Feeder to the east cottages: 0.4 MΩ"*, the reading the alert's finding gave.
- The cable locator follows the buried run from the panel (a drag), and a tap on a hand hole opens it and meggers back to the panel at 1000 V.
  - Before the failed splice it reads hundreds to thousands of MΩ, lower the more cable it takes in (sections in parallel). From the failed splice on, it reads 0.4 MΩ.
- **Dig here:** tap the section between the last good hand hole and the first bad one. The failed splice is buried in the section. A dig at a hand hole re-makes good splices and counts as wrong.
- **Close it up** (after the dig, before the verdict):
  1. what was dug
  2. cut out and re-spliced with the kits the job flow picked (display only: *"DBS-2 × 4"*, or *"SPLIT-4 × 4"*)
  3. megger again before re-energizing (110.7)
  4. backfill with 24 in of cover and a warning ribbon 12 in above (300.5)
  Then **Re-energize the feeder** hands it in.
- **Tiers and blind:**
  - tiers 0–2 show and colour every reading
  - from tier 3 you megger it yourself, and the numbers are plain ink: knowing 0.4 MΩ is a failed splice is the trade
  - tier 3 adds a splice pedestal tapping Cottage 2 (it reads good); tier 4 adds the dock lights, another buried circuit, to not follow or dig
  - blind: one dig, no X, no reveal, the close-out never says whether it was the failed splice, and the hand-in time is the same 700 ms right or wrong
- Its own name, first-encounter card and term (`PuzzleDef.titleFor` / `howToFor` / `termFor`): *"Underground feeder"*, *"Follow the buried run, megger each hand hole, dig the bad section."* The first-encounter card is remembered per scene. It gets 10 s more than the room, for the close-out.
- The same scoring as the room (`scoreTrace`): a first-try dig with the fewest tests is perfect.

**Defects:**
- **The material still decides first.** Split bolts and tape in the ground are the sure `elec:noburial` defect at the sign-off, as before (`flow.ts` 11.3). It replaces the scene's quality roll. Its repair, *"Cut it out and re-splice with a direct-burial kit"*, now names `job: 'feeder'`, so it plays the scene.
- **The scene's own miss or poor work** reports the variant `'feeder'` → `FEEDER_REDIG`: *"a feeder splice in the ground still failing its insulation test"*. Its repair is *"Megger the feeder, dig up the failing splice and re-splice it with a direct-burial kit"*, in the same scene.
  - The kind row `DEFECT_RULES_BY_KIND.feeder` is the same rule. It covers autopilot, the paper sim and a result from a client on the live build. It used to be *"a loose wire-nut splice in the feeder junction box"* → a receptacle wire-up.
  - A feeder repair that goes wrong again stays the feeder's defect, not the room's loose backstab (`DEFECT_RULES.trace`).
  - `redo: false`: the re-splice is the job, so there's nothing to redo.
- **The one exception to "a repair is a different puzzle".** For a buried feeder, the damage and the job are the same hole in the ground, and every other electrician's puzzle is a branch circuit in a room. The invariant test exempts exactly `FEEDER_REDIG`.

**Two fixes to the room's trace, found on the way:**
- Blind no longer reveals every device's live/dead state at the hand-in. It showed where the open really was.
- Blind now hands in at 700 ms whatever the score. A perfect run's 1000 ms flourish gave it away.
- In both scenes a tap on a device tests it and a drag that starts on one follows the cable. Before, a drag starting on an outlet (or a hand hole) counted as a test and traced nothing.

**Also:**
- The catalog `feeder` is now *"Find and re-splice the cottage feeder"* (log *"feeder re-splice"*). Stored orders keep their old titles.
- `R-FEED`'s summary is the whole procedure: lock out, megger, sectionalize at the hand holes, dig, re-splice with direct-burial kits (300.5(E), 110.14(B)), megger again (110.7), backfill to 24 in with a ribbon (300.5).
- The lab takes `&job=feeder` and `&pick=DBS-2:4`.

**No version bump.** No state field is new, and nothing stored changes shape. An old tab on the live build still plays the room for a feeder job, and its result (no variant) takes the kind row. It resolves defects with its own rows. Nothing corrupts.

**Balance** (the paper sim, this branch against `1f92356`):
- **Standard** (26 weeks × 30 seeds), unchanged. Three friends reach tiers 2/3/4/5 in weeks 8/12/16/23 and all average in 7/12/16/23, both with 0 weeks below $0. Solo, absent and nobody teams stay at tier 1.
- **Robust** (90 seeds × 4 crews = 360 games a team):
  - three friends: unchanged at 96/360 missing tier 5 (24 + 24 + 31 + 17 by crew –, a, b, c) and 7 weeks below $0
  - all average: 79/360 missing tier 5 (17 + 19 + 18 + 25), against 80 (18 + 20 + 18 + 24); 0 weeks below $0
- The paper sim's bots score the same whatever the puzzle, so the one economic change is the dropped redo after a feeder re-dig: one game in 360 for one team, which is noise. The robust tail is still open (HANDOFF §7.5).

**Checks:**
- `npx tsc --noEmit`, and 703/703 tests: the 689 before, plus `tests/feeder.test.ts` (9) and 5 feeder model tests in `tests/puzzles.test.ts`
- `npm run build`
- the pass-and-play e2e on phone and desktop
- the scene in the lab on a 390×844 phone at tiers 1, 3 and 5 (open and blind) and at 1280×820
- the real app, pass and play: the feeder alert through Investigate, Reference, Materials, Stock and Send, then the job started from Your move into the scene, on phone and desktop. With split bolts picked, the `noburial` defect is planted.

## 2026-09-28: online e2e handles a no-fault-found first alert; emulator ports are configurable

- **The gap, reproduced.** `scripts/e2e-online.mjs` took the mechanic's first Your move row straight into the flow. On a no-fault-found (NFF) alert nothing in the book or the catalog is marked likely, so the script either stalls or plans the wrong job. On forced NFF-first week-1 islands (seeds found with the engine, the state loaded into pass-and-play), the old move:
  - stalled at Stock on 2 of 4 electrician alerts ("outlet trips with the hair dryer", "bedroom outlets dead"): "Pick the GFCI device first", no Send
  - on the other two ("phase B sags", "lights flicker") and on the mechanic's "gear takes 12 s", reached Send with the book's first task, e.g. AMM 29-10-01 hydraulic power pack servicing for a low-battery finding, sent to the analyst as a card: a silent wrong plan
- **How often it happens.** 1,000 engine islands at week 1: the electrician's first alert is NFF on 206 (21%), the mechanic's on 61 (6%), either on 258 (26%). The old online script never drove the electrician, so it only met the 6% case.
- **Fix: `planFirst` ported from `scripts/e2e.mjs`.**
  - Open each alert row; skip one that offers "No fault found · close"; plan the first real one.
  - If every row is NFF, close the first with "Close it: no fault found".
  - The online run now also drives the electrician's first alert on her phone, so both techs meet the case.
  - Both scripts now check the close on the closed card (`.jf-stage.closed`: "Closed: no fault found.") and fail if it isn't there. Before, `scripts/e2e.mjs` read `.jf-note.ok`, which that card doesn't use, so its banner was always empty and never checked.
- **Emulator ports.** `src/net/firebase.ts` reads `VITE_FB_FS_PORT` and `VITE_FB_AUTH_PORT` (defaults 8080 and 9099) when `VITE_FB_EMULATOR` is set. macOS has only the 127.0.0.1 loopback, so parallel emulators need their own ports, not their own 127.0.0.x hosts. The header of `scripts/e2e-online.mjs` has the steps: a temp `firebase.json` with its own auth, firestore, websocket, hub and logging ports, `--config`, and its own `TMPDIR`.
  - Nothing changes live. Production never sets `VITE_FB_EMULATOR`. The reads stay direct `import.meta.env.X`, so the production build still inlines `undefined` and drops the emulator branch. The production `dist/` is byte-identical to `1f92356`'s: one shasum over every file matches.
- **`docs/handoff/probe-gate.mts` also tries to list the islands** (a read, limit 1): want permission-denied. It still writes nothing.
- **`firebase-tools@15` needs Java 21+.** This Mac has Java 17: `@15` refuses to start the emulators, and `@14` runs the same emulators with a deprecation warning.
- **Proof** (emulator on 127.0.0.1: Firestore 8181, Auth 9191, hub 4481, logging 4581, websocket 9251; branch rules; `demo-island`; Vite on 5194):
  - The online e2e passed on 7 of 7 new islands. The first alert was NFF on 3 of them: the electrician's on `86x2tvwev9` and `0s8dr5fvf8`, the mechanic's on `y6mym60780`. There's no seed picker in the UI (the seed is hashed from the island code and the creation time), so those islands came from re-running, at about 26% per island.
  - Rules: `v: 2` update → permission-denied, `v: 3` → not-found (passes the rules), list → permission-denied.
  - Real emulator writes: create `v: 2` refused, create `v: 3` written, update `v: 2` refused, update `v: 3` written.
- **No version bump. Balance unchanged:** no sim code was touched.

## 2026-09-28: the builders' site gets its own zoom box

HANDOFF §3 "Known gaps": the island on Home zoomed only to the viewer's own trade zone (`focusBox(role, tier)`). The builders' site work had no view of its own.

- **How you get there.** Tap the builders' line on Home. With a build open it is a button now, with a › like an alert row, and the analyst's *Buy* stays a separate button beside it. Or tap a builder on the island. The tap is hit-tested in code, within 22 CSS px of the figure's middle (a 44 px target), so the figures need no extra SVG nodes. On a phone the island scrolls back into view. To leave, tap the 44 px *See the island* button in the island's corner, or anywhere on the zoomed island. Home's zoom is now `view: 'zone' | 'site' | null`. A tap on the island away from any builder still toggles the zone zoom as before.
- **The box.** `siteBox(s)` in `src/ui/island/geo.tsx` is a pure function of `builds` and `tier`, like `focusBox`, so the planned free camera can use it as a preset. It frames `workSites(s)`: each site's drawn extent (the dug plot, the frame, the tower crane at its tallest, the lumber, the barrier and the builders) plus 10 units, clamped to the map. `zoomK` caps it at 3.2, a 250 × 188-unit view. With no build open it returns null and the whole island shows. That includes old docs with no `builds` field.
- **The builders work one unit at a time.** This changes where they stand. On the tier-4 build they do the villas' footings and shutters at the villas, and the dock's pilings and marine decking at the dock. Before, the crew was split across the dock and both villas. The standard crew's one builder always stood at the dock, even for the villas' footings. A box around all three sites was a 1.3× zoom with 8 px figures on a phone. The dock gets a third crew spot for a crew of three. The other builds have one site, or two cottages side by side.
- **Fix on the way.** The generator site's middle builder stood behind its frame: its spot was 1.2 units above the site's sort point. Every crew spot now stands at least 2 units in front of its site.
- **No version bump.** It's UI only: no state field, no action, no engine change. Balance is unchanged, since nothing in `src/sim` changed.
- **Numbers.**
  - SVG nodes: the beaten island-lab scene has 1,390 before and after (budget 1,500). The staff scene has 1,240 before and after. On Home the island has the same node count zoomed or not.
  - Cart tap targets under the site zoom: 63 × 63 CSS px on a phone's 358 px island and 105.6 × 105.6 on a 600 px desktop island. The minimum is 44; `cartHit` now goes through `hitUnits(px, cssW, box)`.
- **Tests.** Six island-lab scenes: `site-t2`, `site-t3`, `site-t4-villas`, `site-t4-dock`, `site-t5` and `site-cottage`. `tests/sitebox.test.ts` has 11 tests. For every tier build at every half unit, worked one and two tiers ahead, and for both cottage plots at every unit, it checks:
  - the box lies inside the map
  - the zoom is at least 2×
  - the view shows every work site and every builder figure
  - the carts stay at least 44 CSS px from 320 to 720 px wide
  - which site each tier-4 unit is worked at
  - the tier build is framed before a queued cottage
  - there is no box with no build open or on a doc without builds
  - every crew spot stands in front of its site

## 2026-09-28: integrating the job-flow gap fixes; the v4 version gate

Branch `gaps`, off `1f92356`. The four gap branches merged `--no-ff` in this order: `gap-charter` (`c714c2e`), `gap-feeder` (`800fe30`), `gap-e2e` (`5038bdc`), `gap-zoom` (`89f9e49`). Then the version gate. Not pushed, not deployed.

- **Merges.** Only this file conflicted: each branch appended its own 2026-09-28 section at the same spot. Every section is kept, in merge order. No code conflicts. After the four merges and before the gate: tsc clean, 731/731 tests.
- **What each fix does now, merged:**
  - **Only guest plane past due** (`gap-charter`): grounded like any plane; a mainland sub-charter flies the guests who need a seat at $270 a flight ($180 own cost × 1.5), automatically. The MEL words in Investigate, the cards, Needs, End turn, the cash card and the Home stat all say so before it happens.
  - **Feeder re-splice** (`gap-feeder`): every feeder job (`Order.job === 'feeder'`) plays its own "Underground feeder" scene inside the trace puzzle: site plan, megger at the hand holes, dig, close-out. The bedroom trace is gone from it. There is no new puzzle id, so orders already stored as `trace` + `feeder` get the scene.
  - **Online e2e** (`gap-e2e`): `planFirst` skips a no-fault-found first alert for both techs. Emulator ports come from `VITE_FB_FS_PORT` / `VITE_FB_AUTH_PORT`; the production build is unchanged.
  - **Builders' zoom** (`gap-zoom`): tap the builders' line or a builder to get `siteBox(s)`, and "See the island" to go back. The beaten island-lab scene is still 1,390 SVG nodes (budget 1,500).
- **Why v4.** `gap-charter` changes what a doc means. A tab still on the v3 engine (`bd1e1d2`) would resolve a week flying the only guest plane restricted (half its flights, near-misses) where this engine grounds it and bills the sub-charter. So: `ENGINE_VERSION` 4, `DOC_VERSION` 4, `firestore.rules` `v == 4`. The other three fixes need no bump on their own: no new stored field, and nothing stored changes shape. This release will ship with more engine changes later, all under the same v4.
- **Fixtures from the live build.** `scripts/fixtures-v3.ts` ran in a temp worktree of `bd1e1d2` (outside the repo, removed afterwards). It plays the live engine's own bots, 'three friends' and 'mistakes' (the same crew with slips and a stock request a week; that crew leaves requisitions open mid-week), and saves the first doc that matches each state. Every doc is written by the live reducer; the script only dispatches moves.

  | fixture | crew, seed, week, tier | state |
  |---|---|---|
  | `v3-bd1e1d2-early` | three friends, 1, wk 4, T1 | start of the week, alerts open, the starter crew |
  | `v3-bd1e1d2-late` | three friends, 1, wk 20, T4 | start of the week, 6 staff, 74 stock lines, 21 POs, 19 ledger weeks |
  | `v3-bd1e1d2-midweek` | mistakes, 1, wk 5, T1 | mechanic ended, electrician part way, analyst not started: an open requisition and a tech's card waiting |
  | `v3-bd1e1d2-mel` | three friends, 2, wk 3, T1 | the only guest plane on an MEL C placard that runs out at this week's resolve |
  | `v3-bd1e1d2-chain` | mistakes, 2, wk 20, T4 | mid-week, an open part chain at the engineering fee; saved 10 minutes past its deadline, so whoever opens it next resolves the week first |
  | `v3-bd1e1d2-makesafe` | three friends, 1, wk 7, T2 | mid-week, a shower tingle made safe at the breaker |
  | `v3-bd1e1d2-build` | three friends, 1, wk 6, T2 | the builders half way through the generator house |
  | `v3-bd1e1d2-feeder` | three friends, 1, wk 1, T1 | mid-week, the feeder job's card waiting on approval |

  The three `v3-bd1e1d2-restricted-*` docs from `gap-charter` (the twin flying restricted) stay in `tests/subcharter.test.ts`.
- **Tests** (748 in all, from 689 on `1f92356`):
  - `tests/skew.test.ts`, for each of the 8 docs:
    - it loads and runs every screen's selectors: Home, the tech panels, the desk and cards, Needs, the staff and builds, the sub-charter, `siteBox`, the review's cost lines
    - `migrate()` leaves it byte-identical
    - the first move stamps engine 4 and leaves the cash, the orders and the alerts as they were
    - through the week's resolve, the review opens at the doc's `openCash` and no open order is dropped
    - it plays ten more weeks with each review opening at the last one's close, identical in memory and through JSON
  - `tests/skew.test.ts`, one test per doc:
    - MEL runs out: grounded from the next week, with the sub-charter (1 flight, $270) in the review
    - the waiting feeder card, approved here, launches "Underground feeder"
    - the build has its site box
    - the analyst approves the open requisition and the card
    - the chain runs to the end
    - the made-safe house rents at 75%
  - Reverse skew: every doc this build writes is engine 4, and a doc ahead of the engine is refused whole on every move, the resolve included.
  - `tests/migrate.test.ts`: all 11 v3 fixtures come through `migrate()` byte-identical, and a v2 doc goes to engine 4 in one move.
- **The live v3 engine against v4 docs, for real.** In the `bd1e1d2` worktree, `apply()` refused 67 of 67 moves on the 8 docs this build wrote: every seat's end turn, the resolve, a rename, each pending approval, each open alert's NFF. Every time it returned the doc untouched ("saved by a newer version … Reload").
- **Rules on the emulator.** `firebase-tools@14` (this Mac has Java 17). Ports on 127.0.0.1: Firestore 8282, Auth 9292, hub 4482, logging 4582, websocket 9252. The branch's rules, its own TMPDIR.
  - `probe-gate.mts` with OLD_V=3, NEW_V=4:
    - v:3 → permission-denied
    - v:4 → not-found
    - list → permission-denied
    - result: GATE LIVE
  - Real writes:
    - create v:3 refused
    - create v:4 written
    - update v:3 refused
    - update v:4 written
    - create v:5 refused
  - The rules never read the stored `v`, so a live v:3 doc takes a v:4 write from this build.
  - The online e2e passed 3 of 3 runs on the same emulator (Vite on 5197). In 2 of them the electrician's first alert was NFF ("lights flicker when the AC kicks on", "kitchen outlets are dead"): it was skipped and the next alert planned. The mechanic's first alert was never NFF in these runs; `gap-e2e` covered that case.
- **In the real app.** Each of the 11 v3 fixtures went into pass and play on this build at 390×844, with the clock at the doc's own time. Each run covered:
  - every seat's Home and a job sheet
  - the analyst's desk
  - the builders' zoom and back, on the build doc
  - the week ended in the UI and resolved here, writing engine 4
  - Three docs were past their deadline (`chain`, `restricted-t2`, `restricted-mel`). They resolved on open on this build, as a live doc does when nobody was on at 20:00. The review that popped up then covered the harness's tap on a job row: a harness miss, not an app error.
  - No page errors, apart from Chrome's "vibrate before a tap" intervention.
- **A wording fix found in integration.** In a placard's last week the review line read "(MEL C, to week 5). Fix it by then, or it is grounded". It sits in week 5's review, which the crew reads in week 6. It now reads "(MEL C, to week 5: its last week). From week 6 it stays on the ground until it's fixed: a mainland sub-charter flies the guests at about $540 a week (2 flights at $270)". Earlier weeks keep "Fix it by then". This is text only.
- `docs/handoff/probe-gate.mts` now defaults to OLD_V 3 / NEW_V 4.
- **Balance** (medians; baseline `1f92356` → `gaps`):
  - Standard (26 weeks × 30 seeds):
    - three friends, tiers 2/3/4/5: weeks 8/12/16/23 → 8/11/16/23, 0 weeks below $0
    - all average: weeks 7/12/16/23 → 7/12/16/22, 0 weeks below $0
    - solo, absent and nobody teams stay at tier 1
  - Robust (90 seeds × 4 crews = 360 games a team):

    | team | tier 5 missed | by crew −/a/b/c | weeks below $0 |
    |---|---|---|---|
    | three friends | 96 → 92 | 20+24+31+17 | 7 → 7 |
    | all average | 80 → 76 | 19+19+18+20 | 0 → 2 |

  - The 2 new weeks below $0 are `gap-charter`'s: weeks 25–26 at tier 4, where no sub-charter flies. The tail is still open (HANDOFF §7.5).
- **When it ships.**
  - The push runs the Action, which deploys hosting and rules together.
  - Then run `probe-gate.mts` live with OLD_V=3 NEW_V=4: want v:3 permission-denied and v:4 not-found.
  - Then tell the crew to close and reopen the app.

## 2026-09-28: the robust tail (HANDOFF §7.5)

Branch `gaps` (on `5532631`). Goal: close the robust sweep's tier-5 tail by fixing its causes, not by buying it back with cash, overhead or softer gates. Targets (90 seeds × 4 crews = 360 games a team): three friends miss tier 5 in ≤ 75, all average in ≤ 37, all average 0 weeks below $0, three friends fewer than 7. The standard 30-seed targets must hold as they are.

### Diagnosis (the sim first)

A per-game trace of all 720 robust games (scratch scripts, not committed) sorted each miss by what stopped it. At `5532631`:

| Why tier 5 was missed | Three friends | All average |
|---|---|---|
| Cash under $60,000 with tier 4 on time (week ≤ 17): the tier-4 economy | 26 | 30 |
| Cash under $60,000 with tier 4 late (week ≥ 18): the tier-3 gate at tier 2 | 29 | 23 |
| Tier 4 never opened, late or its project stalled | 19 | 18 |
| The tier-5 project waited on one seat past week 26 | 18 | 5 |
| **Total** | **92** | **76** |

What the tier-4 misses look like, per tier-4 week, against the games that made it (three friends): revenue $11,223 against $15,662; 4.8 of 6 houses rentable against 6.0; the electrician's assets at 52.6 health against 65.2; carried jobs' deferral incidents 34 per 100 weeks against 13; storms 0.25 a week against 0.18. The electrician does 3.0 jobs a turn either way. Code preps were 22% of the electrician's tier-4 jobs.

Four mechanisms behind that, three of them unrealistic:

1. **A code prep renewed the certificate from the week of the prep.** The notice comes 2 weeks ahead and the prep is done at once, so the county's 8-week cycle ran every 6 weeks. The houses of a tier also came due in pairs (every house of a tier-up started on the same date).
2. **A job planned ahead of its due week was deferred at the carry-over like any unfinished job.** A hall 3-way due in 2 weeks, planned this week and done next week, rolled deferral risk (tier-4 jobs: 30–50% a week of −25 health, 3× the labour and half the week's rent refunded) before it was due, while the same alert left unplanned rolls only once it's past due (resolve step 7). Planning early, which the flow asks for, cost more than waiting.
3. **Autopilot's covered code prep and 100-hour inspection didn't pass.** Autopilot did the job at 50% and closed the alert, but the certificate wasn't renewed (and the 100-hour wasn't logged), so the notice came straight back and the house lapsed. A blind sign-off at the same tiers passes whatever it scored.
4. **A crew project waited forever on a seat that was away** (the three friends' streaks): 18 of their 92 misses.

### The levers, one at a time (robust sweep; misses by crew − / a / b / c)

| Step | Three friends: miss T5 | weeks < $0 | All average: miss T5 | weeks < $0 |
|---|---|---|---|---|
| `5532631` | 92 (20+24+31+17) | 7 | 76 (19+19+18+20) | 2 |
| L1a: the certificate runs from the inspection date | 95 (21+27+30+17) | 5 | 75 (16+22+18+19) | 1 |
| L1b: + the county books one house a week | 96 (24+25+27+20) | 2 | 73 (16+17+20+20) | 0 |
| B: + a job planned ahead of its due week is on schedule | 78 (22+22+20+14) | 2 | 60 (18+15+12+15) | 0 |
| L3: + a crew project part waits two weeks, then autopilot does it at 50% | 75 (15+20+22+18) | 3 | 58 (17+14+12+15) | 0 |
| L2: + the tier-4 generator holds back optional alerts at 4+ ready jobs (tried, **not kept**) | 75 (15+20+21+19) | 3 | 58 (17+14+12+15) | 0 |
| L4: + autopilot's covered inspections pass (L2 out) | 74 (15+19+23+17) | 2 | 50 (16+10+13+11) | 0 |
| **Final** (the inspector story card stays one visit, below) | **75 (18+19+21+17)** | **2 (0+1+0+1)** | **51 (16+10+14+11)** | **0** |

The final run differs from the L4 row by the story card only (±1, noise). Median week to tier 5: three friends 23 / 23 / 23 / 23 (was 23 / 24 / 24 / 23), all average 23 for every crew (unchanged). Min cash: three friends $4,115 / −$5,312 / $5,921 / −$3,799; all average $2,890 / $4,420 / $5,116 / $1,980.

- **L1: code inspections on the county's calendar** (`renewedInspection`, `bookInspection` in econ.ts).
  - The certificate runs 8 weeks from the booked inspection date when the prep is done inside the notice (2 weeks), as a real certificate runs from the inspection. A lapsed inspection is re-done at once (from the week of the prep), and a prep further ahead than the notice counts from that week too (as before), so preps can't push the date out.
  - The county books one of the island's houses a week: a house whose date another house holds goes to the next free week, up to 3 weeks later (`INSPECTION_SLIP`), else the date as asked. New houses (a tier's pair, a built cottage) get notices a week apart, and a live island whose houses are in step spreads out as they renew. An electrician would find this normal: a county's rental inspections are booked per unit.
  - Effect: code preps fell from 22% to 17% of the electrician's tier-4 jobs, and weeks below $0 fell (7 → 2, 2 → 0), but the misses didn't move (92 → 96, 76 → 73, within noise). Kept for the realism and the collapses, not the misses.
  - The inspector story card (*"Book the inspector"*) stays one visit for every house on one date: that's the card's meaning. Their renewals then book a week each.
- **B: a job planned ahead of its alert's due week is on schedule** (`onSchedule`, econ.ts; resolve step 8). The carry-over doesn't count it as a deferral until its due week has passed, so its deferral clock starts exactly when the unplanned alert's would. Planning early never costs more than waiting. Everything else is as before: a job waiting on parts isn't deferred, a job past due is, a non-flow job is, and the analyst's own *Defer* still counts. End turn now says which ready jobs carry risk (*"2 ready jobs will carry to next week: 1 of them picks up deferral risk"*; a crew project part never did, and the old count included it). The biggest lever: −18 and −13 misses.
- **L3: a crew project part waits two weeks for a seat that's away, then autopilot does it by the book at 50%** (`PROJECT_COVER = { wait: 2, recent: 4, score: 0.5 }` in data.ts, `projectCoverWeek` in econ.ts, `coverProject` at resolve step 1).
  - At the resolve two weeks after the project opened, a seat still away gets its part done at 50%. The tier arrives at that resolve (step 16), and the new buildings start at 60 + 30 × the parts' average, so a 50% part costs every new building about 4 health against a 0.9 one (30 × 0.4 ÷ 3). The review says so: *"Ben was still away: autopilot did Ben's part of the crew project by the book, at 50%: Put cottages 3–4 on the panel. It had waited 2 weeks."*
  - Only for a seat played in the last 4 weeks (someone on holiday, not a seat nobody plays): a seat with a miss streak of 4 or more waits for its player, as before.
  - "No role can win alone" holds without leaning on it: tier 2 needs 4 full-crew B+ weeks and tier 4 2 full-crew perfect weeks, so solo and absent teams can't open a project that needs covering. A seat that plays a few weeks and vanishes could at most be carried to tier 3; the 4-week guard stops even that.
  - The crew project card on Home shows each other seat's cover week (*"to do · autopilot wk 9 if away"*) and your own deadline (*"Yours: do it by week 9 or autopilot does it at 50%"*). ONBOARDING §10 says the same.
  - Effect: the three friends' "project waited on one seat" misses 18 → 6 (a project opened in week 24–25 can't be covered by 26). Net −3 and −2, because most of those games then wait on cash.
- **L2: the throttle** (tried, not kept). From tier 4, no new optional alerts while the trade has 4 or more ready jobs. No effect at all (75 → 75, 58 → 58): the generator already stops optional work at 5 open per trade, and the electrician's new alerts per tier-4 week (2.9 in the games that made tier 5, 3.0 in those that missed) already match the 3 jobs a turn. The pile-up is must-do work (critical assets under 45, code preps), and holding that back would make the island forget its problems. Reverted.
- **L4: autopilot keeps to the manual, so its covered inspections pass** (autoRun). A covered code prep renews the certificate (`renewedInspection`, so booked like any other) and a covered 100-hour inspection is logged (`sinceInspection = 0`), as a blind sign-off is whatever it scored. Autopilot's other jobs are unchanged (2 at 50%, no hidden defects). Effect: −1 and −8 misses; the all-average crews' short absences no longer lapse houses.

### Final balance

Standard (26 weeks × 30 seeds, medians; `5532631` → final). Every target in CLAUDE.md holds.

| Team | Wk → T2 / T3 / T4 / T5 | Min cash | Weeks < $0 |
|---|---|---|---|
| All good | 5 / 9 / 16 / 21 → 5 / 9 / 16 / 21 | $6,530 → $7,088 | 0 → 0 |
| All average | 7 / 12 / 16 / 22 → 7 / 12 / 16 / 22 | $5,805 → $5,805 | 0 → 0 |
| **Three friends** | 8 / 11 / 16 / 23 → 8 / 11 / 16 / **22** | $6,271 → $6,271 | 0 → 0 |
| Mistakes | 8 / 12 / 16 / 24 → 8 / 13 / 16 / 24 | −$7,168 → $3,932 | 1 → 0 |
| Naive analyst | tier 2 at week 26 → tier 2 | $2,514 → $3,675 | 0 → 0 |
| Mech / elec / fin absent | tier 1 → tier 1 | $424 / −$16,442 / $2,821 → $3,172 / $7,410 / $4,847 | 0 / 45 / 0 → 0 / 0 / 0 |
| Solo mech / elec / fin, nobody | tier 1 → tier 1 | | 321 / 331 / 379 / 459 → 43 / 274 / 4 / 350 |

The absent and solo teams lose far less money now (L4 above all: a covered prep keeps the houses inspected, a covered 100-hour keeps the planes out of the overdue penalty) and still never leave tier 1. That's pillar 2 (nobody is gridlocked by an empty seat) working as meant; unlocks still need the full crew.

Robust (the final row above), with what still misses (same trace; `5532631` → final):

| Why tier 5 was missed | Three friends | All average |
|---|---|---|
| The tier-4 economy (cash, tier 4 on time) | 26 → 36 | 30 → 12 |
| The tier-3 gate at tier 2 (cash, tier 4 late) | 29 → 14 | 23 → 24 |
| Tier 4 never opened, late or stalled | 19 → 19 | 18 → 11 |
| The tier-5 project waited on one seat | 18 → 6 | 5 → 4 |
| **Total** | **92 → 75** | **76 → 51** |

- **Three friends: target met, at the line** (75 ≤ 75; the last three code states gave 74–75, so call it ±3). Weeks below $0: 7 → 2 (target < 7). The 2 are seed 3 crew a (the mechanic away weeks 11–19, then the tier-4 houses decay to 0–30, −$5,000 in week 25) and seed 32 crew c (the electrician away 11 weeks of 19).
- **All average: target not met** (51 against ≤ 37). Weeks below $0: 2 → 0 (target 0).

### What's left, and why I stopped (not fixed)

- **The electrician's tier-4 overload is structural.** At tier 4 the electrician keeps 8 assets (6 houses, the grid, the generator) on 3 jobs a turn; the mechanic keeps 4 (3 planes and the generator's service). Untouched assets lose 5 a week, a booked house 2 more, a storm 6 per house and 8 on the grid (20% of weeks from tier 3). Ceiling experiment (bots only, not kept): one extra electrician job a turn at tier 4 gives 67 and 47 misses (−8 and −11 on the final). So no electrician-side lever inside the current capacity can reach 37 either. The realistic fix is more hands, the backlog's **line-crew NPCs** (an electrician's helper the analyst hires, JOBFLOW v2): the owner's call, and a feature, not a lever.
- **The all-average crew's other 24 misses are the tier-3 gate at tier 2**: $18,000 cash and 4 incident-free weeks together. Those games earn $620 a week less at tier 2 ($5,692 against $6,192 revenue in the games with tier 3 by week 13: the season's low weeks), and an average crew's hidden defects (0.13 a week at tier 2, blind sign-offs from tier 2) keep resetting the 4 clean weeks. That's skill and the season, as designed. Only the gate or the cash would buy it back, which the brief rules out.
- **Goodhart check.** No cash, overhead, gate, price or payroll changed; the bots' play didn't change. The four kept levers remove a penalty for planning early, a 6-week county cycle that should be 8, an autopilot that failed inspections it did by the book, and an unbounded wait on an away friend. They also make the standard three friends a week faster to tier 5 (23 → 22, inside 21–23).

### Old docs and the version gate

- No new stored field; nothing stored changes shape. `inspectionUntil`, `deferrals`, the project's orders and `missedStreak` are read as they are.
- Live v3 docs: their houses share dates in pairs (every `v3-bd1e1d2` fixture); they load, play and spread out as their preps renew (`tests/robusttail.test.ts` plays `v3-bd1e1d2-chain` six weeks: every house renews once, each on its own week). `v3-bd1e1d2-restricted-mel` has an open tier-4 project the mechanic still owes from week 15: on this build it's covered at week 17's resolve if the mechanic is still away, and tier 4 arrives.
- Version gate: these change what a resolve does (the carry-over, autopilot, the project, the renewal date), so an open v3 client must not resolve a v4 doc. The branch's v4 gate (`ENGINE_VERSION` 4, `DOC_VERSION` 4, rules `v == 4`) already covers it; no further bump. The skew and migration tests pass unchanged.

### Tests

`tests/robusttail.test.ts` (15): L1 (a new island's two cottages a week apart; the renewal from the booked date, lapsed and early; one house a week with the 3-week slip; the engine's sign-off; four cottages in step spread to four weeks; the live chain doc spreads), B (on schedule until due, then carried from the due week exactly as the unplanned alert; a non-flow job unchanged), L3 (covered at the second away resolve at 50% with the tier and the building health; a returning seat does its own part; a 4-week-absent seat isn't covered; the live doc's project; the absent teams stay at tier 1 over seeds 1–6), L4 (a covered prep renews; a covered 100-hour is logged). `tests/staff.test.ts`: a built cottage is booked the first free week from 8 out. The pacing guard and "no role can win alone" pass unchanged. 763 tests in all (748 before).

## 2026-09-28: gap fixes, review round 1

Branch `gaps` (on `2241f22`). Three read-only reviews (trades, play, systems) of the gap fixes and the robust tail: 6 majors, 30 minors. Every major is fixed; the minors are fixed or rejected below with the reason. Not pushed, not deployed. It ships under the branch's v4 gate (no further bump).

### Majors

- **The sub-charter's cover is what the twin would have flown** (`subCharterNeed`, econ.ts). It used the twin's schedule at health 100 with no pilot cap, so grounding a worn twin paid better than flying it. Reproduced on the engine (seed 42, week 5, clear): tier 2, twin at 35, tagged +$1,965 against −$2,024 flying (+$3,989 a week, 4/4 houses against 0/4, grade B against C); twin at 50, +$1,558; tier 1 at 35, +$2,098; tier 3 at 35, +$1,891. An unfixed past-due item paid the same. Now the cover is the twin's own schedule at its real airworthiness in that weather, as the island's pilots crew it (`capFleet`): a twin at 50 is covered for 2 of its 4, one under 40 for none (and no fee). The same runs after the fix: tagged or unfixed is never better (tier 2 at 50: −$333; at 35: $0, both empty). The empty-house lines read the same `cap`. Test: tiers 1–3 × health 0–100 in 10s, tagged against flying and unfixed against fixed, never more cash, guests or grade. The design note's "a twin below 40 flies nothing and empties the houses" is true again.
- **The floatplane isn't free when the analyst is away** (`coverProject`, engine.ts). Autopilot's cover of *Win the floatplane at auction* now buys it at the fair price (`FLOAT_AUCTION.fair`, $4,800) and says so (*"…won at the fair price, $4,800."*). If that would take spendable cash under the freeze line ($2,000), the part waits and the review says why. Both follow-ups too:
  - a lost bid no longer completes the part: nothing is bought, the part stays open, the same week refuses a second go (`Order.rebid`, optional, a new sale's seed), and the next floatplane comes up at next week's auction. The Home card says *Outbid this week*.
  - the paper-sim bots bid for it as they bid for a lot (fair × (1.15 − 0.25 × score), capped at $5,600) and pay what they bid. Before, `bots.ts` completed it with no data, so the sim never paid the deposit a human pays. The win (and autopilot's buy) is booked in the ledger as `building` (the analyst's trade); before, the deposit left the bank with no ledger line.
- **The feeder's re-test shows its number, blind too** (trace.ts close-out). Step 3 is now *"Megger again (110.7): L1, L2, N 380 MΩ to ground"* after the dig that re-made the failed splice (any dig so far), *"… 0.4 MΩ …"* after a wrong one, in plain ink at every tier. Two calls, the same look: **Dig again** and **Re-energize**. Dig again backfills that hole (drawn as fresh soil) and goes back to Dig here; a wrong dig was already counted as a wrong mark, and the clock runs. **Rejected part of the fix:** "the only button is Dig again" while it reads low. Knowing that 0.4 MΩ means don't close it (110.7) is the trade the scene tests; a button that disappears would tell a non-electrician the answer. Re-energizing at 0.4 MΩ is the low score and the `FEEDER_REDIG` defect later, as before. Mistakes still surface later on workmanship: split bolts plant `elec:noburial`, and the quality roll `FEEDER_REDIG`.
- **The MEL ask is on the sent job's sheet and on End turn** (`MelNote.tsx`, JobView, home.tsx). Reproduced: with the job sent (the card with the analyst), the only ask was behind *Change the pick* → Investigate. Now the job sheet shows the MEL/airworthiness note (with the sub-charter clause) and *Ask Cy to authorize the one-time extension* whenever the placard runs out at this resolve or ran out at the last one (`canAskMel`, select.ts, the engine's `melExtend` window); the End turn lines that name the ask carry the same button (`EndCheck.melAsk`). Checked on a 390 px phone: one tap from the job sheet and from End turn, then the note reads *"Ana asked Cy to authorize the one extension"*.
- **The hangar row at 360 px** (ops.tsx). The column keeps *AOG* (or *GND*) and the inspection count; why it's down is one short word (*for a part*, *past due*); the sub-charter gets its own full-width line under the row (*"Its guests fly in on a mainland sub-charter (2 × $270 this week) until it's back in service."*). At 360 px the name wraps to 3 lines in 113 px with a 113 px health bar and nothing overlaps (was: the label over the name and the bar).
- **One missed evening isn't two** (`projectCoverWeek`, econ.ts). Autopilot now covers a crew project part only when the seat has missed every resolve of the wait (2 in a row), not whenever it happens to be away two weeks after the project opened. The cover week is the earliest resolve that could happen from here: never before the project has waited 2 weeks, this week's if the seat missed the last one, next week's if it hasn't, two weeks on once it has ended this week's turn; so the cards never point at a week gone by. The review line is from the real streak (*"Ben was away 2 weeks running: …"*). Test: Ben plays the week after it opened, misses the next, not covered; misses again, covered. **Owner call** (a pillar-level rule): HANDOFF §1.

### Minors fixed

- Feeder: one plausible trench (east along the path with a gentle, one-way drift, then down the east side to the cottages; hand holes at even spacing, a section down the side the same length on the drawn yard as one along the top). The dock-light circuit (tier 4) crosses the pedestal's tap to the dock instead of ending at the cottages. A dig counts as at a hand hole within 0.9 × the tap tolerance of it (its 26 px lid), so the shorter sections still leave a 36 px or longer dig target at tier 5 on a phone. Close-out wording: *"Re-made the failed splice with the slack: DBS-2 × 4"* (one splice re-made on each of L1, L2, N and the EGC, not a length spliced in); *"Backfill to 24 in (Table 300.5), warning ribbon above"* (the ribbon's 300.5(D)(3) is for services: R-FEED now calls it good practice). A blind hand-in draws only the runs you traced (both scenes).
- MEL words: *"Ask Cy to authorize the one-time extension (the company's call and cost)"*; ONBOARDING says the analyst stands in for the certificate holder's management. A non-airworthiness MEL item (the intermittent com) no longer says it grounds the plane: past the placard it's an open write-up again, with deferral risk (Investigate, the analyst's Needs row). The airworthiness note reads *"at week 3's resolve, Twin N-12 is grounded unless it's signed off by then"*.
- End turn, due now with no MEL relief: *"Fix it this week (no MEL relief), or from this resolve Twin N-12 is grounded …"* (no *or tag it*: the safety call grounds it too).
- The approval card's *Waiting a week* counts the week a deferral would ground the plane: the extra resolves out (`outWeeks` at the picked freight's arrival a week later) × the downtime. A tier-1 card due next week with its part landing tonight: the deferral cost plus the $540+ of downtime (before: the deferral cost only).
- The analyst's desk words the sub-charter as a projection while it can still be avoided (*"Twin N-12 is grounded at this resolve unless Ana signs off Brake linings: … −$540"*, chip *Sub-charter −$540 unless fixed*), else what holds it (the safety call, the part).
- The review's AOG line counts the flights the weather allowed (the on-time grade's): *"… 3 flights cancelled"* in wind.
- The forecast's hints add *"Sub-charter −$540/wk while Twin N-12 is down"*.
- The sub-charter fee is booked on the twin (`asset`) and on the side that kept it down: the analyst's for an approval, stock or carrier AOG (`aogCause`), the mechanic's for the plan, a part chain or the safety call.
- Home's island hint adds *"· a builder: the site"* when builders are drawn (it stays inside the island, ellipsized).
- The inspector story card still passes every house in one visit, but books each renewal through the county's calendar (`bookInspection` from W + 8), so the notices never all come back in one week. Its option says so.
- `bookInspection` books the nearest free week at or before the date first (up to the notice, 2 weeks early), and only later (up to 3 weeks) when none of those is free. A certificate no longer outlives its 8 weeks because the county is busy (the reviewer counted 59 of 349 renewals made 9–11 weeks); the notice just comes earlier.
- Autopilot's covered code prep and 100-hour are signed at the pass mark (`SIGNOFF`, 60%), not 50%: a human's 50% fails the sign-off at a teaching tier, so autopilot passing at 50% made being away better than a poor attempt. (The fix's other option, passing only where a blind sign-off would, would lapse every absent seat's houses at tier 1; that's the absence-cost question for Seb below.)
- `scripts/reverse-skew.ts`: the live engine's own reducer against docs this build wrote. It extracts nothing itself: `git archive <live sha> island-company | tar -x` into scratch (no repo worktree), then it plays one move on every fixture with this engine and asks the live one for every seat's end of turn, the resolve, a rename, each approval and each alert's NFF. On bd1e1d2: 173 of 173 moves on 19 docs refused, every doc untouched.

### Minors rejected (reasons)

- **Overdue 100-hour grounds the plane** (predates the branch). Right in principle (14 CFR 91.409(b)), but it isn't a wording or a cap: the 100-hour would need an airworthiness alert tied to the flight count, the generator and the bots changed with it, and its own balance run and skew test. It belongs in its own change. Logged in HANDOFF §7.
- **Hand holes labelled by landmark.** A site plan numbers hand holes from the source (HH-1 nearest the panel); the locator still matters for the pedestal's tap and the dock-light circuit. The trench now reads as one run, which was the realism problem.
- **Sub-charter fee at the incremental cost (~$170–200).** Kept at $270 as a deliberate price: the sim carries the twin's avgas, oil, reserves and landing fees in fixed overhead, not per flight, so nothing is saved while it sits and the island's extra cost is the whole fee. Said here; the number is Seb's to move.
- **Regenerating the three `v3-bd1e1d2-restricted-*` fixtures.** Tried on the live engine (every team, seeds 0–9, the state after the week's last seat with the mechanic away and `restrictedBy` on the twin): no byte match with gap-charter's uncommitted capture. They stay as they are, with their provenance in `scripts/fixtures-v3.ts`; the reverse-skew script covers them.
- **Absence cheaper (L4) and the robust tail.** Not code: HANDOFF §1 puts both to Seb with the numbers.

### Balance (medians; `2241f22` → this commit)

Standard (26 weeks × 30 seeds). Every CLAUDE.md target holds.

| Team | Wk → T2 / T3 / T4 / T5 | Min cash | Weeks < $0 |
|---|---|---|---|
| All good | 5 / 9 / 16 / 21 → same | $7,088 → $7,088 | 0 → 0 |
| All average | 7 / 12 / 16 / 22 → 7 / 12 / 16 / 23 | $5,805 → $5,805 | 0 → 0 |
| Three friends | 8 / 11 / 16 / 22 → 8 / 11 / 16 / 23 | $6,271 → $6,271 | 0 → 0 |
| Mistakes | 8 / 13 / 16 / 24 → 8 / 13 / 16 / 25 | $3,932 → $4,079 | 0 → 0 |
| Mech / elec / fin absent | tier 1 | $3,172 / $7,410 / $4,847 → $2,305 / $7,410 / $4,847 | 0 / 0 / 0 |
| Solo mech / elec / fin, nobody | tier 1 | | 43 / 274 / 4 / 350 → 35 / 263 / 12 / 362 |

Robust (90 seeds × 4 crews = 360 games a team; misses by crew − / a / b / c):

| Run | Three friends: miss T5 | weeks < $0 | All average: miss T5 | weeks < $0 |
|---|---|---|---|---|
| `2241f22` | 75 (18+19+21+17) | 2 | 51 (16+10+14+11) | 0 |
| **this commit** | **102 (27+25+24+26)** | **1** | **77 (19+18+19+21)** | **0** |
| this commit, bots pay no floatplane deposit (as before) | 69 (17+18+18+16) | 1 | 62 (15+12+15+20) | 0 |
| this commit, the county's old booking (next free week after) | 94 (24+21+25+24) | 1 | 71 (22+17+16+16) | 0 |
| this commit, the old L3 rule | 102 (identical) | 1 | 77 (identical) | 0 |

- **The tail got worse because the sim got honest.** The bots now pay the floatplane deposit a human pays (about $4,560 at their bids): +33 and +15 misses. The deposit comes out at tier 4, from the cash the tier-5 gate counts ($60,000 and 20 weeks); a per-game trace of which gate each extra miss hit wasn't run. The live game didn't get harder for a human who wins the auction: it was always this price. Like for like (no deposit) this commit's other changes are 69 against 75 and 62 against 51 (the booking change is about +8 / +6 of it; the rest is within the ±3 noise per crew seen before, plus the cheaper certificates).
- The L3 change doesn't move the sim: a present bot always does its project part the week it's there, so "played but skipped the part" only happens to people.
- **Median week to tier 5** 22 → 23 for both target teams (inside 21–23).
- The weeks below $0: three friends' 1 is crew a (seed 3, the mechanic away weeks 11–19, as before).
- **Not fixed: the tail.** Both targets are missed (≤ 75 and ≤ 37). The levers left are Seb's (HANDOFF §1): count the floatplane at its book value toward the tier-5 cash gate (it's capex the island owns), or finance it, and the line-crew NPC (an electrician's helper) for the tier-4 overload. No gate, price or payroll changed here.

### Old docs and the version gate

- One new optional field, `Order.rebid` (the week a floatplane bid was lost); nothing else stored changes shape. These change what a resolve does (the cover, the booking, the sub-charter's cover, autopilot's inspections), which the branch's v4 gate already covers: `ENGINE_VERSION` 4, `DOC_VERSION` 4, rules `v == 4`. No further bump. Every fixture passes the skew and migration tests unchanged, and `scripts/reverse-skew.ts` shows the live engine refusing every move on them once this build has written them.
- When it ships: the push deploys hosting and rules together, then `docs/handoff/probe-gate.mts` with OLD_V=3 NEW_V=4 (want v:3 permission-denied, v:4 not-found), then the crew closes and reopens the app.

### Checks

- `npx tsc --noEmit -p .`; 781/781 tests (45 files; 763 before): `tests/subcharter.test.ts` (the cover sweep, the worn and pilot-capped cover, the fee's side and asset, the card's waiting cost, the wind AOG line, the forecast hint, the MEL ask on a sent job), `tests/feeder.test.ts` (the blind re-test right and wrong, dig again, the route stays as traced, one trench over 40 seeds × 3 tiers), `tests/robusttail.test.ts` (one miss isn't two, the cover week, the floatplane won / outbid / covered / waiting, the inspector card, the booking), `tests/whosemove.test.ts`, `tests/staff.test.ts`.
- `npm run build`; balance standard and robust (above); the pass-and-play e2e on a 390 × 844 phone and at 1280 × 820 (only the Manrope 403s); the island lab (beaten scene 1,390 nodes); scripted phone checks at 390 and 360 px of the hangar row, the job sheet's and End turn's MEL ask, the crew project card, the desk's projection, the island hint, and the feeder's blind close-out in the lab (wrong dig 0.4 MΩ → dig again → 380 MΩ → re-energize: 70%, one wrong call).

## 2026-09-28: Expansion spec (the airline network, the free map, per-trade island interactions)

The spec is `docs/EXPANSION.md`. It is written for four packages (A engine, B map, C objects, D network desk), builds on branch `gaps`, and ships as v4 with it (v5 if `gaps` ships alone first). Not built yet; the critique round comes next.

### The finding that reorders the work

The long game after the Resort doesn't hold today. Scratch probes on `1f92356` (the real reducer, 10 seeds × 52 weeks, nothing committed):
- **three friends:** 10 of 10 games go below $0 in weeks 24–52 (141 of 290 weeks), with 214 dead weeks (revenue under $2,000) and −$187,000 median cash at week 52.
- **all average:** 10 of 10 games, 134 weeks below $0, −$183,000.
- **all good:** 0 of 10 games, +$416,000.
- **credits:** 0 of 20 games for the two target crews reach them.

What drives it:
- The electrician's upkeep at tiers 4–5 (7 houses, the grid, the generator, bunched code prep) beats about 3 jobs a week.
- House condition slides from 87 at week 12 to 60 at week 22 (the medians), so it starts before the Resort.
- The grid is the single point of failure. Once it's down, the houses are dark, the hangar is capped at one job, and the planes rot.
- The 26-week balance window hides it: cash keeps rising until week 28–30.

Post-tier-5 levers alone don't fix it. Decay 1, code inspections every 13 weeks and houseWear 1 still leave three friends negative in 4 of 10 games.

**Decision:** package A starts with **A0, a Resort that holds**:
- a 52-week target (T1: median 0 weeks below $0 in weeks 24–52, at most 3 of 30 games ever below $0)
- measured on `gaps`' levers first
- then levers that act from tier 4, inside the tier 1–5 pacing band

The network is built on A0.

### Key decisions in the spec

- **Backbone, not a new game.**
  - A station is a field on the asset (`asset.st`; absent = home).
  - Tern Cay and Port Adair reuse the `cottage` and `panel` models, so every symptom, task, puzzle and defect rule applies.
  - Adding an airport is data: a `StationDef`, its `RouteDef`s and a `SceneLayout`. A data-only test station (ZZ) proves it for each trade.
- **Home is byte-identical until the network opens.**
  - New fields are lazy, and new draws have their own rng streams.
  - A golden digest test (recorded after A0) is the proof that tiers 1–5 are untouched.
- **The trades' time is the scarce resource.** The network's routine alerts come from a separate pass: at most 1 new a week per trade, network-wide, plus must-dos capped at 3 open. The analyst sees a load gauge.
- **Travel is one trip a week per tech,** from the work budget, 2 taps, with the parts hand-carried. A plane is worked at its base or either end of its route, so planes on a route through home never need a trip. There is no ferry action. HEAVY work (100-hr, cylinder, spar, penetrant) needs a hangar end, or a field repair if the plane is AOG.
- **One central stockroom.** Station jobs' parts are drop-shipped at the normal ETA. Port Adair's parts desk takes a week off long leads network-wide.
- **The only guest plane is per station** (`soleFor`), with `gaps`' sub-charter generalized to take the station. Home can't assign away its last guest plane.
- **Money, at game scale, at tier 5:**
  - the first twin on Home–Adair makes about +$2,930 a week; a second there, −$3,370; Adair–Tern, −$240 (the traps are on the cards)
  - Tern Cay pays back in about 19 weeks, Port Adair in about 21
  - lease is $1,000 a week (13-week minimum); buy is $58,000, resale from 80% falling to 45%
  - no network spend may leave spendable cash under $25,000
- **Quick checks: one a week per tech,** available from week 1, blind:
  - the mechanic's walkaround (6 zones, 3 looks)
  - the electrician's IR scan (ΔT against load, with the NETA criteria) or meter check (voltage drop under load)
  - a right call turns a hidden defect into a repair via inspection; a wrong one becomes an NFF write-up for later
- **"Report a problem":** on a crewmate's asset, a flag (their write-up alert, one a week, counted in their slots); on a fixture, a crew-board DM. A player can't raise a cross-trade report row, because rows carry a cap or a leak on the reporter.
- **The map:**
  - an inline map that keeps the page scrolling at k = 1, plus a full-screen Explore
  - transform-only gestures on a wrapper div (no render per frame, one commit at the end)
  - JS hit-tests with 0 new SVG nodes
  - one detailed scene at a time; every scene ≤ 1,500 nodes, the region ≤ 400
  - the empty-ground tap keeps toggling "my zone" (delayed 250 ms so a double tap can zoom)
- **Realism scope:**
  - Port Adair's terminal and airfield lighting are the airport authority's; our electrician does the leased hangar bay's panel, the GPU charger and 28 V circuits (NEC 513) and the hub's hangar reports
  - Tern Cay's dispenser circuit follows NEC 514 (seals, the remote disconnect, the emergency shutoff)
  - no airfield series lighting
- **Wages:** the route numbers assume today's wages. At the ×2.5–3 wage call, the stations' paybacks stretch to 35–83 weeks and the network would need a retune.

## 2026-09-28: Expansion spec, critique round

Three read-only critics (trade realism, game design, architecture) raised 81 points: 3 blockers, 44 majors, 34 minors. `docs/EXPANSION.md` is revised: every blocker and major is resolved, and the points turned down are in its §17 with reasons. **This entry replaces the previous one wherever they differ.** The spec is now based on `gaps` at `249988a`.

- **Three releases, each with its own version bump,** instead of one v4:
  1. A0, a Resort that holds. It rides in `gaps`' v4 if `gaps` hasn't deployed yet.
  2. The free map, tappable objects, quick checks and *Report a problem*.
  3. The airline.
  - Why: A0 fixes a live collapse and shouldn't wait for the largest engine change so far.
  - Each release gets fixtures from the previous live commit, reverse skew, the probe, and "close and reopen".
- **Quick checks read wear that is coming, never `s.defects`** (the two blockers).
  - The top in-scope catalog kind with weight > 0 shows a tell that grows with the wear depth, drawn from seeded pools of look-alike phrasings.
  - A right call raises that alert now, one order tier easier and a week earlier (`alert.early`).
  - A wrong call is a `src: 'check'` write-up that takes a slot until it's closed on site.
  - One view, ≤ 3 taps. From tier 2.
  - The IR scan is load-normalized: the tell is 10–20 °C over what its load should give, at 40–70% load; the distractor is normal at 85–95%; under 30% is "too light to judge". The PPE line and NFPA 70B are on screen.
  - Defects in scope is Seb's call; the default is no.
- **One alert pass per trade over every asset** (today's targets and the must-do cap of 8). The network adds no routine slots; its cost is condition, shown on a load gauge.
  - No `wb` for route planes: the load manifest is the pilot's, 135.63(c).
  - Route planes' 100-hr counts block hours (`NET.inspPerH` 0.12).
  - One decay rule for every plane; network rules come from a plane's origin (`isNetPlane`), never from `st`/`rt`.
- **The island-ops loophole is closed.** A network plane must fly a route or it's parked; it never flies home's tours. An unassigned leased twin would have earned about +$1,250 a week there.
- **Where work is.**
  - A plane is worked at its base (where it overnights), or where it's stuck: a route plane's grounding strands it at a seeded end (`aogAt`, derived).
  - A base must be an end of the plane's route.
  - Leased planes are delivered to Port Adair while it's open and need an acceptance (records review via `logbook`, then `inspect100`) before they fly.
  - HEAVY and the ferry permit are dropped from v1: every route has a hangar end, and a ferry permit needs the mechanic on site anyway.
- **Hands-on vs paperwork (`SITE_BOUND`).**
  - On site: `complete`, `makeSafe`, `nff`, (M) MEL items, `check`, `gse`.
  - Anywhere: planning, requests, the mechanic's grounding call, (O)-only MEL, `squawk`.
  - The electrician's remote `tag` closes a station house via the station agent (not trade work).
- **Trips** are booked as `travel`, never in `autoSpent`: a free company seat plus the per diem, or an air taxi. They're allowed with cash short.
- **Hub hangar reports** are drawn only after the mechanic worked there in the last 2 weeks. Their cap binds only his jobs at that station.
- **A station's only plane grounds like any other** (no station sub-charter). Its cottages sit empty that week. `soleGuest` stays home-only.
- **Money, retuned** (starting values, **tune**). Route P&L carries each plane's parts and labour, hull (1.5% a year), pilots by block hour, fuel, fees and travel.
  - Twin: $150,000, or $500 a week to lease (13-week minimum, 4-week deposit, a true-up of $300 a point under 85 on return). Resale 92%, −0.1% a week, floor 55%.
  - Tern Cay: capex $12,000, $650 a week. Port Adair: capex $15,000, $1,200 a week.
  - Demand is frequency-sensitive, ramps from 50% over 8 flown weeks, has a seeded ±20% maturity, and swings ±25% on the trunk. Connecting passengers go via home. Routes into unlit Tern Cay are day VFR only.
  - Good play pays back about 11 weeks (Tern) and 13 weeks (Adair) after opening. Naive play loses about $2,150 a week.
- **The grade counts the network by contribution.** A new station is out of it for 4 weeks. The A bonus is on home revenue only. Test: the naive bot's A-week rate ≤ no-network's.
- **Station content is its own data.** `StationDef.kinds`, `syms`, `after` and `panels`; station-only `SYMPTOMS`/`REPORTS` rows (`only`). `words`/`stationWords` are dropped.
  - Tern Cay: a 200 A service with underground cottage feeds, so the feeder scene fits; an attended dispenser (NEC 2023 514.11).
  - Port Adair: the bay subpanel (513.10(B), 513.12).
  - The projects are retitled to match their puzzles: `ipc` fly-away kit; `conduit` RMC with EYS seal; `panel` bay circuits. Hazardous-location work runs "under the company's commercial permit (master of record)".
  - The electrician's project score rolls a hidden defect on the asset it built.
- **A0** leads with grid-first and a spiral breaker, tested with the other levers from tier 4. It adds an A streak that pauses (not resets) on an autopilot week.
  - T1 now includes reaching the credits in ≥ 50% of three-friends games by week 45.
  - It's time-boxed to one balance pass. Then Seb gets the numbers.
- **The camera:**
  - one finger always scrolls Home; two fingers pan and zoom inline; one-finger pan only in Explore
  - Explore portals the one map
  - true-footprint hit-tests: 2+ near objects zoom ×2, and a chooser at max zoom
  - ambient animations paused during gestures
  - region pinch-out only in Explore
  - presets built on `gap-zoom`'s view state
- **Absences:** after 2 missed analyst weeks, the analyst's autopilot guard trims round trips, returns a losing lease past its minimum, and mothballs a station losing over $1,000 a week. It never opens or leases.
- **The contract** (§14.3) lists every cross-package symbol with its signature and a working home-only implementation. §4.2 decides every `planes`/`houses`/`grid`/`generator`/`powered` call site. File ownership now covers purchasing, staff, flow, board and crewboard, with an ownership check at Integrate.

## 2026-09-29: A0, a Resort that holds (stage 1 of docs/EXPANSION.md)

Branch `gaps` (on `258d0d2` + the `expansion-spec` merge). Goal (EXPANSION §0.3, §11.2): the long game after the Resort collapsed in every sim game; make it hold from tier 4 with the spec's levers, tested together, without buying numbers with cash, overhead, softer gates or cheaper prices. One balance pass (the time box), then Seb gets the numbers. Not pushed, not deployed; it rides in the branch's v4 gate.

### The long run (`npx tsx scripts/balance.ts long`, new)

52 weeks × 30 seeds, every team, no network; weeks 24–52 judged (after the Resort). The T1 columns: games ever below $0, weeks below $0 (total and the median game), dead weeks (revenue under $2,000), receiverships, cash at weeks 26 / 39 / 52, the credits' week and the share of games with the credits by week 45, the A-week rate at tier 5, and the mean house and grid health over weeks 30–52 (the mechanism). `robust` now plays its 360 games 52 weeks: its 26-week columns read only the first 26 (identical to before: checked against `258d0d2`, column for column) and two columns are new, games below $0 in weeks 24–52 and credits by week 45. The standard 26-week run is unchanged.

### Before: `258d0d2` on the long run

The collapse the spec found on `1f92356` is still there after the robust-tail work: three friends and all average go below $0 in 30 of 30 games (399 and 308 weeks below $0; 605 and 531 dead weeks). Traced (three friends, seed 1): the houses slide from about 70 when tier 4 arrives (week 17) to about 40 by week 29 on the electrician's 3 jobs a turn; the grid falls from about 55 to 0 between weeks 30 and 36; then the houses go dark, the planes rot, and revenue is $0 from week 38. Cash peaks near $87,000 at week 32, so the 26-week table never sees it.

### The levers, from tier 4, in the spec's order (cumulative)

All from tier 4 (data `LATE`); tiers 1–3 play byte for byte as before (the standard run's medians, the solo, absent and nobody teams and every pre-tier-4 week are unchanged in every row). The long columns are the two target teams over the 30 seeds; robust is 360 games a team (misses by crew − / a / b / c).

| Levers | Long: three friends games < $0 · weeks < $0 · dead wk | Long: all average | Robust: three friends miss T5 · weeks < $0 · long < $0 | Robust: all average |
|---|---|---|---|---|
| `258d0d2` | 30/30 · 399 · 605 | 30/30 · 308 · 531 | 102 (27+25+24+26) · 1 · 359 | 77 (19+18+19+21) · 0 · 351 |
| (e) grid first | 30/30 · 372 · 448 | 29/30 · 244 · 293 | 103 (29+23+25+26) · 0 · 358 | 73 (18+19+18+18) · 0 · 339 |
| + (g) dark houses don't decay | 30/30 · 370 · 449 | 29/30 · 245 · 292 | 103 · 0 · 358 | 73 · 0 · 339 |
| + (a) inspections every 13 weeks | 30/30 · 345 · 412 | 28/30 · 183 · 228 | 109 (29+24+28+28) · 0 · 357 | 79 (19+20+20+20) · 0 · 330 |
| + (b) houseWear 1 | 28/30 · 221 · 298 | 14/30 · 61 · 104 | 82 (24+19+21+18) · 0 · 333 | 70 (19+17+14+20) · 0 · 214 |
| + (c) decay 3 at 70+ | 18/30 · 104 · 200 | 7/30 · 24 · 60 | **69 (17+20+14+18) · 0 · 247** | **63 (18+14+16+15) · 0 · 100** |
| + (d) no +1 alert tier under 50 | 20/30 · 112 · 207 | 7/30 · 19 · 56 | 70 (18+20+14+18) · 0 · 248 | 62 (18+14+16+14) · 0 · 103 |
| + (f) the A streak pauses | 20/30 · 112 · 207 | 7/30 · 19 · 56 | 70 · 0 · 248 | 62 · 0 · 103 |
| the same with (c) decay 4 | 26/30 · 163 · 261 | 15/30 · 48 · 79 | 78 (22+20+18+18) · 0 · 307 | 64 (19+13+15+17) · 0 · 156 |
| **kept: e, g, a, b, c (3), f** | **18/30 · 104 · 200** | **7/30 · 24 · 60** | **69 · 0 · 247** | **63 · 0 · 100** |

- **(e) Grid first** (`gridFirst`, econ.ts; `generateAlerts`, `urgency`, autopilot, `yourMoves`). The island grid under 55 reliability at tier 4+ is must-do work: it gets a job even when the electrician's list is full (the must-do pass, grid first among them), it ranks above code prep in the bots' and autopilot's order (`urgency` +150, what a hazard or airworthiness item due now gets), autopilot plans its alert though it isn't due yet, and on Home it counts as due now, after hazards and airworthiness: the Dock's button and the top of *Your move*, with a **grid first** chip on the row saying why. It trades house health for the grid (houses 44 → 37 against the same set without it) but kills the blackouts (all average grid health 41 → 57 over weeks 30–52, dead weeks 172 → 56). An electrician would do the same: the service that feeds every house comes before an inspection's paperwork.
- **(g) The spiral breaker** (`decayOf`). A house dark all week (grid down, the generator not carrying it) loses nothing to the week's decay: nobody's in it. Storms still hit it. No measurable effect in the sim, because grid first keeps the grid up; kept as the safety net for the weeks it does go down (an electrician away two weeks at the Harbor), where it stops the spiral by construction. It costs nothing when the grid is up.
- **(a) Code inspections every 13 weeks** (`inspectionWeeks`; the county's calendar from the robust tail books them, one house a week). Real rental inspections are annual or biennial; quarterly is still strict. Effect alone: small, and in the robust run slightly the wrong way (+6 and +6 misses, about the ±3 per crew noise): fewer $150 preps, but the slot goes to a dearer job, so the tier-5 cash gate comes a little later. Kept: it's realistic, and with (b) and (c) the set is far better.
- **(b) A booked week wears a house 1, not 2** (`houseWearOf`). The biggest lever with (c).
- **(c) A maintained asset (70 or more) loses 3 a week untouched, not 5,** every plane and every home asset alike; under 70 it's 5 again. 3 beat 4 on every column (the spec's range was 3–4). Kept at 3.
- **(d) No "+1 alert tier under 50" from tier 4: tested, not kept.** No measurable effect (three friends 18 → 20 games below $0, all average 24 → 19 weeks below $0; robust 69 → 70 and 63 → 62), and a worn-out asset really is the harder job. The knob stays (`LATE.lowHealthTierBump`, true), so the bump is unchanged. The owner summary in EXPANSION §18.2 never listed it.
- **(f) The credits' A streak pauses on an autopilot week graded A** (`aStreakAfter`, econ.ts). From tier 4 an A week with a seat on autopilot doesn't count toward the eight and doesn't reset the streak; any week graded below A still resets it, whoever played. Chosen over "pause on any autopilot week" because that one is an exploit: skip a turn in a week that looks bad and a reset becomes a pause. With A-only, missing a week can never help a streak. Nobody wins alone: the credits need tier 5, which solo and absent teams never reach, and a test checks on 6 whole seasons (the crews with absences) that the streak never grows on an autopilot week and the credits never land on one. Effect: the credits by week 45 in the robust run, three friends 3 → 4 of 360, all average 2 → 5 of 360 (the rest of play is identical: the streak drives only the credits and the bunting).
- **Goodhart check.** No cash, overhead, price, payroll or tier gate changed, and the bots play as before. The levers are upkeep rules an electrician and an FP&A person can check: the feed before the paperwork, no wear on an empty dark house, a quarterly inspection, lighter wear on a maintained asset, an A streak that an absence pauses.

### After: the kept set on the long run, against T1 (weeks 24–52, 30 seeds)

| Metric | Three friends: `258d0d2` → A0 | All average: `258d0d2` → A0 | T1 |
|---|---|---|---|
| Games ever below $0 | 30/30 → **18/30** | 30/30 → **7/30** | ≤ 3/30 (**missed** by both) |
| Weeks below $0: total (the median game) | 399 (14) → **104 (1)** | 308 (12) → **24 (0)** | median 0 (**met** by all average, missed by three friends) |
| Dead weeks: total (the median game) | 605 (20) → **200 (6)** | 531 (18) → **60 (1)** | median ≤ 2 (**met** by all average, missed by three friends) |
| Receiverships entered | 30 → 16 | 30 → 5 | |
| Cash at weeks 26 / 39 / 52, median | $92,628 / $1,355 / −$192,491 → $100,133 / $136,134 / $567 | $100,685 / $21,538 / −$166,928 → $108,518 / $186,262 / $138,729 | |
| Credits by week 45 | 2/30 (7%) → 1/30 (3%) | 0/30 → 2/30 (7%) | ≥ 50% of three friends' games (**missed**) |
| A-week rate at tier 5 | 2% → 7% | 3% → 13% | |
| House / grid health, weeks 30–52 | 8 / 8 → 22 / 49 | 14 / 15 → 36 / 58 | |
| Tier medians (wk → T2 / T3 / T4 / T5) | 8 / 11 / 16 / 23 → same | 7 / 12 / 16 / 23 → same | as in T0 (**met**) |

All good: 0/30 → 0/30 below $0, credits by week 45 53% → 63%, house health 60 → 88. Solo, absent and nobody teams: every number identical (they never reach tier 4) and all stay at tier 1 through week 52.

**T1 is not met.** All average meets two of its four lines (median 0 weeks below $0, median 1 dead week); three friends meet none but the tier medians. ~~The collapse is gone in most games~~ **Corrected in review round 1: the collapse is delayed, not gone.** A0 buys about 13 weeks for three friends and about 26 for all average; by week 52 their houses are at health 4 and 8 with 0 of 7 rentable, cash is falling about $10,800 and $5,200 a week, and 30 and 27 of 30 games go below $0 in weeks 53–78 ("2026-09-29: A0 review round 1"). What the 52-week columns showed: three friends' median game is 1 week below $0 instead of 14, cash at week 52 is flat instead of −$192,000, and the grid holds. Three friends' credits went 2 → 1 of 30 on the standard seeds, and 3 → 4 of 360 in the robust run: noise at a level near zero either way. Per the time box I stopped here.

### What would reach T1 (probes for Seb's call, scratch, not kept)

On top of the A0 set (these ran with (d) on, which the table shows makes no difference):

| Probe | Three friends: games < $0 · weeks < $0 (median) · dead (median) · credits ≤ 45 | All average |
|---|---|---|
| A0 as kept | 18/30 · 104 (1) · 200 (6) · 3% | 7/30 · 24 (0) · 60 (1) · 7% |
| + one more electrician job a turn (the line-crew NPC's ceiling) | 8/30 · 19 (0) · 60 (1) · 7% | 0/30 · 0 · 3 · 13% |
| + one more job a turn for both techs | 4/30 · 6 (0) · 38 (0) · 0% | 0/30 · 0 · 0 · 3% |
| decay 3 for every asset from tier 4 (no 70 gate) | 7/30 · 14 (0) · 42 (1) · 3% | 0/30 · 0 · 5 · 10% |
| the healthy decay from 50, not 70 | 9/30 · 41 (0) · 101 (3) · 3% | 0/30 · 0 · 11 · 10% |

- **The money side of T1 needs more hands, not softer rules:** the line-crew NPC (an electrician's helper the analyst hires; JOBFLOW v2) is the lever that gets close: three friends at a median of 0 weeks below $0 and 1 dead week, all average at 0 of 30. It's a feature and the owner's call (HANDOFF §1). Decay 3 without the 70 gate gets as far, but "a run-down asset wears as slowly as a kept one" isn't believable; not proposed.
- **The credits line is out of reach of any upkeep lever.** An A week needs revenue at 85–100% of the tier-5 budget ($22,000) with the flights and safety grades at A. Three friends' bot plays tier 5 at skill 0.62 (0.82 less 0.05 a tier) and takes about $13,800 a week there even with an extra job a turn in both trades; all good takes $22,300 and gets the credits in 63% of games. So "credits in half the three friends' games by week 45" is a question about the goal (the budget, or what counts as a credits week), which is a gate: Seb's call, not a balance lever.
- **Found on the way (not changed here; fixed in review round 1):** the credits count A weeks from before the Resort. `aStreak` builds at tier 4 and the check is `tier === 5 && aStreak >= 8`, so a crew with 8 straight A weeks at the Harbor gets the credits the week the Resort arrives (both of three friends' credits on `258d0d2` came that way: weeks 21 and 23, the week tier 5 arrived). The review line says *"Eight straight A weeks at the Resort"*. Counting only tier-5 weeks would make the credits rarer still; it's a win-condition change, so it's listed for Seb.

### The golden digests (EXPANSION §13.1)

`tests/golden.test.ts` records, after A0, the sha-256 of 26 weeks of the paper-sim crews (three friends seeds 1–3, all average seed 1: the week-by-week table and the island doc at week 26). Stages 2 and 3 must reproduce them with their new features unused. Re-record only on purpose (`GOLDEN=print`), with a DECISIONS line saying why.

### Old docs and the version gate

- **No new stored field.** `LATE` is code; `aStreak`, `inspectionUntil` and health are read as they were.
- **Live v3 docs** load, render and resolve (the skew and migration tests unchanged). The tier-4 ones (`v3-bd1e1d2-late`, `v3-bd1e1d2-chain`) switch to A0's rules at their next resolve: their 8-week notices stand until they come round, and each renewal books 13 weeks. `tests/resort.test.ts` plays `v3-bd1e1d2-late` twelve weeks with the electrician on autopilot. `tests/robusttail.test.ts`'s chain-doc test now plays seven weeks, not six: on that doc grid first takes two of the electrician's slots (the grid at 45–50), so the last house's prep comes in the seventh week.
- **Version gate:** A0 changes the resolve from tier 4, so an open v3 client must not resolve a v4 doc; the branch's v4 gate (`ENGINE_VERSION` 4, `DOC_VERSION` 4, rules `v == 4`) already covers it. No further bump.

### Balance (T0)

- **Standard** (26 weeks × 30 seeds, medians): three friends 8 / 11 / 16 / 23, all average 7 / 12 / 16 / 23 (unchanged), both 0 weeks below $0; all good 5 / 9 / 16 / 21; mistakes tier 5 at 24 (was 25); solo, absent and nobody at tier 1 with identical numbers. Pacing guard and "no role can win alone" pass.
- **Robust** (90 seeds × 4 crews): three friends 102 → **69** misses (27+25+24+26 → 17+20+14+18), weeks below $0 1 → 0; all average 77 → **63** (19+18+19+21 → 18+14+16+15), 0 → 0. Median week to tier 5 23 in every crew (was 23 / 24 / 23 / 24 and 23 / 24 / 24 / 23). Better than `gaps` as landed, as T0 asks; three friends are inside the old ≤ 75 target again, all average still over ≤ 37. Long columns: games below $0 in weeks 24–52, 359 → 247 and 351 → 100 of 360.

### Tests

`tests/resort.test.ts` (17): each lever at tier 3 and tier 4 ((a) the renewal, the sign-off and the villas' first notices; (b); (c) by kind and in the resolve; (g) by kind and in a grid-down resolve; (d)'s knob; (e) the urgency order, the must-do with a full list, autopilot planning the grid, the Dock and *Your move*; (f) the streak rule), then whole seasons: the solo, absent and nobody teams at tier 1 through 52 weeks, the streak never growing on an autopilot week over 6 seasons (and the pause seen), the long-game guard (seeds 1–10, with room for noise), and the live tier-4 doc. `tests/golden.test.ts` (5). 803 tests in all (781 before), 47 files.

## 2026-09-29: A0 review round 1 (the credits, the long game's real trajectory, the electrician's helper, the receiver)

Branch `gaps` on `25afc96` (A0), still under the unshipped v4 gate. Three reviews (two systems, one late-game): 6 majors (two of them the same credits bug), 12 minors. Every major is fixed; the minors are fixed except the three listed under *Not done*. Each issue was reproduced first; the numbers below are 30 seeds unless noted, weeks 24–52 unless noted, medians unless noted.

### Reproduced

- **The credits paid out for Harbor weeks.** `aStreak` grew on every full-crew A week at any tier and the check was `tier === 5 && aStreak >= 8`, so a Harbor streak paid out the week the Resort arrived. All good seed 4: tier 5 and the credits both in week 21. Over 52 weeks: all good 22 credit runs, 13 with pre-Resort weeks in them and 5 on the arrival week; three friends' 1 and all average's 2 all came that way. Counting honestly (8 full-crew A weeks that opened at tier 5, none below A): all good 13 of 30 by week 45, three friends 0, all average 0. A0's pause made it worse: it held Harbor streaks through autopilot weeks.
- **A0 delayed the collapse; it didn't remove it.** `balance.ts long 78` (new, below) on the A0 source: three friends had 1 of 7 houses rentable at week 40 and 0 at week 52, house health 4 at week 52, cash falling $10,852 a week over weeks 39–52, revenue at 13% of budget in weeks 40–52, and 30 of 30 games below $0 in weeks 53–78. All average: 5 of 7 rentable at week 40, 0 at 52, 27 of 30 below $0 in weeks 53–78. The T1 columns hid it: a dead week is revenue under $2,000 (9% of the tier-5 budget), "games below $0" reads cash, not the business, and the house health column averaged weeks 30–52. The live fixture `v3-bd1e1d2-late` played forward by the three-friends bots on A0: houses 55 at week 33, 0 at week 52, 0 of 7 rentable.
- **The electrician's capacity, not the rules, is the ceiling.** Played at the resolve, the electrician (bot or person) clears what the week raises: about 4 alerts a week at the Resort, capped by the alert generator's target (5 open, 3 new routine slots a week). So "one more electrician job a turn", A0's probe, hits that cap: re-run to 78 weeks on A0 it still collapses (three friends 0 of 7 rentable at week 52, 27 of 30 below $0 in weeks 53–78; all average 2 of 7 at week 65).
- **Receivership locked everyone out.** Three friends seed 11, week 43: cash −$30,691, houses at 0–21, grid 23, generator 29; all 11 waiting cards (the feeder, the grid's dead circuit, a generator circuit, receptacles) failed with "Not enough cash." while the desk said "only safety-critical work is approved". The bridge loan's $4,669 a week came out of a negative balance.
- **The streak pause was invisible:** the review shows 9 lines and the pause had none; the Board said "A-grade streak 4/8" over six A's.
- **Found in the phone check:** approving or deferring a card on a phone flew it 440 px off screen, the layout viewport grew to 885 px, and the dock and every later toast went wider than the screen (pre-existing, `ApprovalCard`).

### Fixed

1. **The credits count only weeks played at the Resort** (`atResort`, `creditsStreak`, `aStreakAfter(s, W, grade, fullTeam)`, resolve step 14). A week counts if tier 5 was reached before it (the arrival week was played at the Harbor). Before the Resort the streak is 0. A full-crew A adds one, an autopilot A holds it (the pause now applies only at the Resort), below A resets it, and the credits land only on a full-crew week. A live doc's stored streak is read as at most the Resort weeks it has played (derived, nothing stored). The line reads *"Eight full-crew A weeks at the Resort, none below A. You beat Island Company!"* (engine, the credits card, ONBOARDING). The bunting keeps its old meaning, 3 full-crew A weeks in a row at any tier, read off the week reports (`aRun`), so the island still celebrates at the Harbor.
2. **The pause is readable.** A paused week's review says so under the grade (*"An A with autopilot covering Ben doesn't count toward the eight: the streak holds at 4/8."*), outside the 9-line list. The Endgame card says the rule; *Last 12 weeks* rings a paused A and says what the ring means.
3. **Grid first only at real risk, and only the feed** (`gridFirst`, `feedAlert`, `gridFirstAlert`, `gridFirstJob`, `reopenBeforeGrid`). The grid under 55 goes first only if the generator is under 50, or a week's decay (5) and a storm (8) would take it under 40 (so under 53). Only the island feed counts: an alert whose symptom is at the panel (the feeder, a dead circuit, a hot lug, the panel upgrade), read from the symptom, never the hidden cause; the fuel dock's trip and conduit run are ordinary work (chip, urgency, the must-do slot, the Dock). A code prep that reopens a house whose inspection has lapsed goes before grid first while the grid holds at 48 or more (urgency +180 against grid first's +150; `yourMoves` rank 1.25 against 1.5). A grid-first card that comes in after the analyst ended the turn goes through on the standing approval whatever the limit, and its approval card carries the **grid first** chip. Effect on the aggregate: none measurable (the attribution table below); it's for the players' order of work, which the review found wrong.
4. **The electrician's helper** (the line-crew NPC; `STAFF.helper`, `helperWeek`, `helperQueue`, `helperWanted`). A new NPC role on the analyst's hiring board from tier 4, $280 a week at skill 3 (0.7–1.45×, as every role). At the resolve (step 1c) each helper does the electrician's *planned, ready* routine jobs nobody got to, most urgent first: skill 1–2 one a week at 50–55%, skill 3–5 two at 60–70%. Only a house's branch-circuit work and the generator's circuit test (`trip`, `gfci`, `switch3`, `flicker`, `hottub`, `storm`, `genTest`), and a hazard's fix only once the electrician has made it safe. Never the diagnosis or the plan, making a hazard safe, code prep, the grid's feed, a repair or its redo, a chain's job or a report. By the book (no quality-roll defect, as autopilot), but the plan is the electrician's: a wrong task or a pick that installs but isn't right goes in as planned and surfaces later, traced to the electrician (`flowSureDefect`, pillar 3). The box is opened as planned: a wrong pick stops it, back to the electrician. The helper's rounds raise the electrician's alert target and weekly slots by the helper's jobs, so the throughput really grows (without that the helper found nothing to do: the cap above). The board offers one when the electrician has 6 alerts open or the houses average under 65, a second under 55. The hiring card says what they do, what stays the electrician's, and the money in the analyst's terms (*$280 a week · pays for itself if it keeps one cottage open (about $1,527 a week in rent)*). *Your move* marks the jobs the helper will take tonight (**helper tonight**); the review names each one. The fin bot hires one only once spendable covers the next tier's cash gate plus a month's wage (hired at the Harbor before the Resort's $60,000, payroll only delays the tier: robust misses +10 in a first cut); autopilot never hires one (it keeps the standard crew). Not drawn on the island (the node budget; the beaten scene is still 1,390).
5. **The receiver** (`RECEIVER`, `receiverFunds`, `receiverAdvance`, resolve step 11). In receivership, when the island can't pay, the receiver funds safety-critical work (what `isEmergency` passes: an inspection, a known defect's repair, a grounded plane's part, a job whose alert closes a house or grounds a plane, an asset under 60) up to $1,500 a week, added to the bridge loan at 15%; the analyst's approvals, the standing approval, the analyst's autopilot and the fin bot all use it. The receiver takes its weekly payment only out of cash above $0 while the island is in receivership. The review tells the whole crew each such week (*"Receivership, cash −$8,834: the receiver funds safety-critical work up to $1,500 a week … The way out is revenue: reopen the houses, get the grid and the planes back."*); the desk banner says what can be paid for (below $0 nothing, except what the receiver funds; under $2,000 safety work up to the cash there is), and a refused approval says why (*"Not enough cash, and the receiver's repair allowance has $1,100 left this week ($1,200 card)."*).
6. **The cottage plan counts its upkeep** (`cottagePlan` → `upkeep`, `open`): the health it loses a week (from tier 4 decay 3 at 80 and wear 1; at tier 3, 5 and 2) at the house jobs' price per health point, about $90 a week from tier 4 and $150 at tier 3, comes off the rent before the payback; the sheet says how many alerts the electrician has open and that a house nobody gets to pays back nothing.
7. **The rules show in the game.** A one-time sheet, *The Harbor: keeping it standing*, per island and seat on this device (localStorage, guarded, as What's new): when tier 4 arrives, and on the first open of an island already at tier 4 or 5. Health bars get ticks: 70 on every asset from tier 4, the grid's 55 and 40, the generator's 50. The inspector's story card shows the one cadence that applies (8, or 13 from tier 4), also on a card an older build dealt (`storyEffect`).
8. **(g) dropped:** a dark house decays like any other (`LATE.darkNoDecay` false, the knob stays). A tropical house with no power rots faster, not slower, and it never had a measurable effect.
9. **The cadence has a reason:** the Harbor's rental licence puts the island on the county's quarterly schedule (the sheet, ONBOARDING, the data comment). Moving tiers 1–3 to 13 weeks too is a balance pass of its own (not done).
10. **The long-game tooling.** `balance.ts long` prints a second table, *Does the Resort hold?*: median house health at weeks 40 and 52, the grid at 52, houses rentable at weeks 40 and 52, revenue against budget over weeks 40–52 and the cash slope over weeks 39–52; `long 78` plays on and adds weeks 65 and 78 and games below $0 in weeks 53–78. It also prints a proposed *hold line* for T1: the median three-friends game keeps at least 4 of 7 houses rentable at week 52, with revenue at 70% of budget or more in weeks 40–52. Receiverships count to week 52.
11. **The golden digests see the late game** (`tests/golden.test.ts`): each digest now reads every week's doc after the resolve (so the streak, the stats and every asset's health count), and four of the eight runs are 52 weeks (three friends 1, all average 1, mistakes 1 and 6: seed 6 has a receivership below $0, a grid-down week and a lapsed prep against grid first; seed 1 an autopilot A at the Resort mid-streak). A new test flips each late-game knob (13: every `LATE` lever, the helper, the receiver's allowance and standstill) and asserts some digest changes: all 13 are seen (before, 3 of A0's 7 levers were seen by no digest).
12. **The long-game guard is tight and reads the mechanism:** three friends at most 3 of 10 games below $0, 12 weeks and 25 dead weeks, and at week 52 a median of at least 4 of 7 houses rentable and house health 35 or more; all average at most 2, 6 and 12, cash over $150,000 at week 52, at least 6 of 7 rentable and house health 55 or more (seeds 1–10 now: 0/0/4 and 7 of 7 at health 48; 0/0/0 and 7 of 7 at 70).
13. **Words:** ONBOARDING 10a rewritten (the generator is all-or-nothing: under 40 the grid is down, and if the generator is under 50 too every house goes dark; grid first ranks ahead of everything but a hazard or an airworthiness item due now; "a kept-up airplane throws fewer knock-on squawks"; the wear goes by the calendar week), the receiver in *Cash trouble*, the helper in the staff and desk sections, the cottage's upkeep.
14. **The phone overflow:** `.pc-stack` clips the flying card (`overflow-x: clip`, a 24 px clip margin for the shadow), and toasts centre without a translate (`left/right: 16px`, `width: fit-content`). Checked: the page stays 390 px wide through a refused and an accepted approval.

### Not done (and why)

- **An insolvency restructuring** (sell the floatplane or a villa at book value, or restart at the Harbor), from the receivership review: not built. Assets have no book value in the model, and removing a tier's asset touches the tier gates, the budget, the island art and every system that keeps an asset by id. The allowance plus the payment standstill remove the gridlock (safety work gets done, the loan never deepens the hole) and the way out is said every week. With the helper, receiverships entered by week 52 fell 16 → 3 (three friends) and 5 → 1 (all average). Listed for Seb if a real restructure is wanted.
- **Plane decay by flights flown** (the mechanic's realism note, marked optional): a rule change with its own balance pass. ONBOARDING now says the wear is by the calendar week.
- **13-week inspections at every tier:** a balance pass of its own; the step now has a story reason instead.

### How much each fix moved the long game (weeks 24–52; each row adds one fix to the build with the credits fix)

| Build | Three friends: games < $0 · weeks < $0 (median) · dead (median) · rent@52 · cash@52 | All average |
|---|---|---|
| none of the play fixes (≈ A0) | 18/30 · 114 (2) · 239 (6) · 0/7 · −$3,505 | 7/30 · 29 (0) · 65 (1) · 0/7 · $138,729 |
| + grid first at risk, the feed, reopen first | 18/30 · 112 (2) · 242 (8) · 0/7 · −$9,635 | 8/30 · 28 (0) · 63 (1) · 0/7 · $142,534 |
| + a dark house decays | 18/30 · 112 (2) · 243 (8) · 0/7 · −$6,861 | 8/30 · 29 (0) · 64 (1) · 0/7 · $142,534 |
| + the receiver | 18/30 · 110 (2) · 240 (8) · 0/7 · −$6,861 | 8/30 · 29 (0) · 64 (1) · 0/7 · $142,534 |
| + the electrician's helper (as built) | **3/30 · 16 (0) · 21 (0) · 6/7 · $169,345** | **1/30 · 8 (0) · 11 (0) · 7/7 · $276,762** |

The helper is the lever; the rest is the players' order of work, the realism fix and the gridlock fix, measured as neutral on the aggregate. Goodhart check: no price, gate, payroll, overhead or tier rule was changed. The helper is a cost the analyst chooses ($280 a week, on top of the job's labour, which the card still pays), the receiver's money is debt at 15%, and the credits got harder, not easier.

### After: the long game (`balance.ts long 78`), A0 → review round 1

| Metric | Three friends | All average | T1 |
|---|---|---|---|
| Games ever below $0, weeks 24–52 | 18/30 → **3/30** | 7/30 → **1/30** | ≤ 3/30: **met by both** |
| Weeks below $0: total (median game) | 104 (1) → **16 (0)** | 24 (0) → **8 (0)** | median 0: **met** |
| Dead weeks: total (median game) | 200 (6) → **21 (0)** | 60 (1) → **11 (0)** | median ≤ 2: **met** |
| Receiverships entered by week 52 | 16 → 3 | 5 → 1 | |
| Credits by week 45 (honest count) | 3% → **0%** (A0's 3% was a Harbor streak) | 7% → 0% | ≥ 50% of three friends: **missed** |
| A-week rate at tier 5 | 7% → 8% | 13% → 21% | |
| Houses rentable at weeks 40 / 52 | 1/7 · 0/7 → **7/7 · 6/7** | 5/7 · 0/7 → **7/7 · 7/7** | hold line ≥ 4/7 at 52: **met** |
| Revenue against budget, weeks 40–52 | 13% → **69%** | 35% → **86%** | hold line ≥ 70%: three friends **missed by 1 point** |
| Cash slope, weeks 39–52 | −$10,852 → **+$1,207** a week | −$5,177 → **+$6,132** | |
| House health at weeks 52 / 65 / 78 | 4 / 0 / 0 → 46 / 35 / 26 | 8 / 2 / 0 → 68 / 67 / 72 | |
| Houses rentable at weeks 65 / 78 | 0/7 · 0/7 → 4/7 · 2/7 | 0/7 · 0/7 → **7/7 · 7/7** | |
| Games below $0 in weeks 53–78 | 30/30 → **11/30** | 27/30 → **1/30** | |
| Tier medians (T2 / T3 / T4 / T5) | 8 / 11 / 16 / 23, unchanged | 7 / 12 / 16 / 23, unchanged | as T0: **met** |

- **All average holds the Resort through week 78.** Three friends hold it through week 52 and slide after it: houses 55 → 46 → 35 → 26 at weeks 40 / 52 / 65 / 78, 4 of 7 rentable at week 65 and 2 at 78, 11 of 30 games below $0 in weeks 53–78. So for three friends the collapse is pushed past the 52-week window, not removed: about 25 more weeks than A0, which itself bought about 13 on `258d0d2` (all average: about 26 on A0, and none left by week 78 now). The remaining slide is the licensed work (hazards, code prep, the grid) at three friends' tier-5 skill (0.62) on 3 jobs a turn: a third hand only helps where the job is routine.
- **The live tier-4 fixture** (`v3-bd1e1d2-late`) played forward by the three-friends bots: houses 58 and 7 of 7 rentable at week 52, cash $206,000, one helper from week 25. On A0 the same run ended at house health 0 and 0 of 7 rentable.
- The mistakes crew (three friends with a human's slips) also holds to 52 (5 of 7 rentable) and still collapses after it (0 of 7 at week 78, 21 of 30 below $0 in weeks 53–78).
- **T1:** three friends now meet three of its four lines (games below $0 3 of 30, median 0 weeks, median 0 dead weeks) and all average all but the credits. The credits line is further away than A0 said: counted honestly, 0 of 30 for both (all good: 50% by week 45, median week 46; A0's inflated count said 63%). It's still the question A0 raised, now sharper: at the Resort three friends grade A in 8% of weeks (revenue about $15,000 against the $22,000 budget), so no upkeep lever reaches it. That's the goal (the budget, or the grade bands), a gate: Seb's call.

### T0 (unchanged, as the task asks)

- **Standard** (26 weeks × 30 seeds): three friends 8 / 11 / 16 / 23, all average 7 / 12 / 16 / 23, both 0 weeks below $0; all good 5 / 9 / 16 / 21, mistakes tier 5 at 24; solo, absent and nobody teams at tier 1 in every seed. Weeks below $0 for the teams that go broke by design: solo mech 35 → 31, solo elec 263 → 258, solo fin 12 → 12, nobody 362 → 352 (the receiver's standstill).
- **Robust** (90 seeds × 4 crews): three friends 69 → **70** misses (17+20+14+18 → 17+20+15+18), all average 63 → **58** (18+14+16+15 → 16+12+15+15), weeks below $0 0 and 0. The long columns: games below $0 in weeks 24–52, 247 → 61 and 100 → 12 of 360; the credits by week 45 (honest), 0 and 0 of 360 (A0's 4 and 5 counted Harbor weeks or landed on paused arrival weeks).

### Decisions for Seb

- **The electrician's helper is the late game's lever, and it's yours.** Default as built: on the board from tier 4, $280 a week at skill 3, two planned routine jobs a week, the licensed work stays the electrician's. The alternatives: a price closer to the 2.5–3× wages question (JOBFLOW §23.4: the helper would scale with it), no alert-flow bonus (then it does little: the probe above), or no helper (A0's collapse).
- **The credits are honest now, and nobody but a very good crew reaches them.** Three friends and all average 0 of 30 by week 52. A goal the friends can reach needs a gate change (the tier-5 budget, the A band, or fewer weeks: 6 instead of 8), not an upkeep lever.
- **The receiver** (default: $1,500 a week of safety work, 15%, no payment below $0): the alternative is an asset sale or a restart at the Harbor (not built).
- **Absence got cheaper at the Harbor:** a covered code prep renews for 13 weeks from tier 4 (not 8), and autopilot takes the grid-first job before it's due. HANDOFF §1 has it.

### Old docs and the version gate

- New, all optional: `loan.adv` (the week's advance), `OrderResult.npc` (who did it), and the NPC role `helper` in `staff[].role` and the board's candidates. Derived, not stored: the credits' streak cap, the paused weeks, the helper's queue, the bunting.
- A live v3 doc at tier 5 with a streak from Harbor weeks reads as the Resort weeks it has played; a v3 doc at tier 4 starts its streak at the Resort. A story card an older build dealt shows the right cadence. The skew, migration and live-fixture tests pass unchanged.
- All of it rides the branch's unshipped v4 gate: a v3 client can't write a v4 doc, so it never meets a helper or a receiver's advance. No further bump.

### The golden digests, re-recorded

On purpose: the helper, the receiver, grid first at risk, a dark house decaying and the credits counting only Resort weeks all change play or the doc; the digests now read every week's doc; and four runs are 52 weeks. Stages 2 and 3 must reproduce these (`tests/golden.test.ts`, recorded on this commit).

### Tests

- `tests/latefix.test.ts` (13): the helper (the board from tier 4 only, the pool before tier 4 unchanged, two jobs at 60% by urgency and never the licensed work, a hazard only once made safe, a wrong plan still traced to the electrician, the alert flow growing with the helper, the hiring card's words, the bots hiring it only past the cash gate and solo or absent teams never, the cottage's upkeep) and the receiver (funding safety work into the loan, the allowance's cap and its words, not outside receivership, the week's renewal, the payment standstill and the crew's line).
- `tests/resort.test.ts` (21): grid first at real risk, the feed only, the lapsed prep first at 48+; (g) dropped; the streak rule; a 9-week Harbor streak with the Resort arriving mid-week on an autopilot week graded A, over 12 all-good seasons (A-graded arrivals seen, no credits); the credits only after 8 full-crew Resort weeks over 10 seasons (the pause seen and said); the guard as above.
- `tests/golden.test.ts` (22): 8 digests and 13 knob flips. `staff.test.ts` and `robusttail.test.ts`: the helper outside the standard crew's payroll ratio; the chain doc can reach the Resort inside its seven weeks now.
- 837 tests in 48 files (803 in 47 before).

## 2026-09-29: Release QA of stage 1 (v4), `c57c51e`

What was tested: the tip of `gaps`, `c57c51e` (the gap fixes, A0 and A0 review round 1, under the v4 gate), against the live build `bd1e1d2`. No game code, test or script was changed; this entry is the only change.

### Results

- **tsc** clean. **vitest** 837 tests in 48 files, all pass. **Build** passes (dist removed).
- **Balance, standard** (26 weeks × 30 seeds): three friends 8 / 11 / 16 / 23, all average 7 / 12 / 16 / 23, both 0 weeks below $0; solo, absent and nobody teams at tier 1. Targets met.
- **Robust** (90 seeds × 4 crews): three friends miss tier 5 in 70 of 360 (17 + 20 + 15 + 18), all average in 58 (16 + 12 + 15 + 15), weeks below $0 0 and 0. Long columns: games below $0 in weeks 24–52, 61 and 12 of 360; the credits by week 45, 0 and 0. All average is still over its ≤ 37 tail target (known; Seb's call, HANDOFF §1).
- **Long** (52 weeks × 30 seeds), T1: three friends 3 of 30 games below $0 (median 0 weeks, median 0 dead weeks), all average 1 of 30 (0, 0); the credits by week 45 0% for both (the one T1 line not met, a gate question). The proposed hold line: three friends 6 of 7 houses rentable at week 52 (met), revenue 69% of budget in weeks 40–52 (1 point under 70%).
- **Pass-and-play e2e** on phone (390×844) and desktop (1280×820): pass. The only console errors are the Manrope font 403 through the symlinked `node_modules` (cosmetic, worktree-only).
- **Online e2e** on its own emulator (firebase-tools 14, Firestore 8585, Auth 9595, this branch's rules): 3 of 3 runs pass; run 1's electrician's first alert was a no-fault-found and the script planned the next one. **probe-gate** on the emulator: v:3 permission-denied, v:4 not-found, listing refused.
- **Migration:** the eight `v3-bd1e1d2-*` fixtures regenerate byte for byte from the live engine (`scripts/fixtures-v3.ts` on a `git archive` of `bd1e1d2`). The skew, migrate and sub-charter tests over all eleven pass (68 tests). In the browser, the late doc (week 20, tier 4) loaded into pass-and-play at its own saved time: the week 19 review and the Harbor sheet show, the mechanic and the electrician each hand in a ready job, the analyst's tabs render, all three end the turn and week 20 resolves. Engine 4 afterwards, the review's opening cash equals the doc's `openCash`, and none of the 7 open orders is lost.
- **Reverse skew** (`scripts/reverse-skew.ts` against `bd1e1d2`): 173 of 173 moves refused on 19 docs, all with "saved by a newer version", and the docs are untouched.
- **islandlab** at phone width: all 34 scenes render. The beaten scene has 1,390 SVG nodes (the budget is 1,500).

### Found, not fixed (commit messages only; the trees are fine)

- `a46bd49` (the expansion-spec merge, not pushed): its message ends with git's leftover `# Conflicts:` block after the trailer. git's own trailer parser still finds the trailer. Fixing it means rewriting `a46bd49` and every commit after it, which changes the release SHAs, and other worktrees are built on `25afc96`. So it's left to whoever deploys: `git filter-branch --msg-filter` over `a46bd49^..gaps` to drop the `# Conflicts` lines (the trees stay identical, per HANDOFF §6.4 item 7), or leave it as it is.
- `abda756` (already pushed to `claude/jolly-keller-gy5hs4`): it ends with a `Claude-Session:` line and the cloud session's own attribution trailer. It's pushed history, so it can't be rewritten.

## 2026-09-29: A0 review round 2 (the commit-message check; no game change)

Branch `gaps`, still under the unshipped v4 gate. The release QA's check 9 (commit trailers) found two blockers, both in commit messages. No game code, balance, rule or fixture changed, so the golden digests stand as recorded.

### Reproduced

A check that says what "ends with the trailer" means, `scripts/check-commits.ts` (new, below), on the old tip `f398ed4`:

- over `origin/claude/jolly-keller-gy5hs4..gaps`, what a deploy push publishes: 18 commits, 1 failing. `a46bd49` (the expansion-spec merge): after the trailer come a blank line, `# Conflicts:` and `#<tab>island-company/docs/DECISIONS.md`, git's conflict note, which an editor commit strips and this merge kept. `git interpret-trailers --parse` still finds the trailer, which is how it got through.
- over `bd1e1d2..gaps` (the QA's range, from the live build): 19 commits, 2 failing, the second `abda756` ("Handoff and deploy log", the cloud session's): its last line is a `Claude-Session:` URL after that session's own attribution trailer. It's on `origin/claude/jolly-keller-gy5hs4`.

### Fixed

1. **`a46bd49` reworded, trees identical.** It and the three commits on top were rebuilt object by object (`git cat-file commit` → drop the conflict block, or point the parent line at the rebuilt parent → `git hash-object -t commit -w`), then `git update-ref` moved `gaps`. Per pair, `diff` of the raw objects shows only those lines: author, committer, dates and trees are byte for byte the same (`git diff --quiet f398ed4 4a7ff22`), so every result measured on the old SHAs holds on the new ones, the release QA of `c57c51e` included.

   | before | after | commit |
   |---|---|---|
   | `a46bd49` | `09ca693` | Merge expansion-spec: the expansion plan (docs only) |
   | `25afc96` | `e4908db` | A0: a Resort that holds |
   | `c57c51e` | `dd73915` | A0: review round 1 (the tree the release QA passed) |
   | `f398ed4` | `4a7ff22` | Release QA log: stage 1 (v4) |

   Safe because none of them was pushed (no remote branch contains them). The stage 2 branches (`stage2`, `s2-b1`, `s2-c1`) are built on `258d0d2`, which didn't change. The wfG0 experiment worktrees are detached at the old `25afc96` with uncommitted work; their checkouts are untouched and the old commits stay reachable from them and from the `gaps` reflog. **Bring their work over as a patch or with `git rebase --onto e4908db 25afc96`, never a merge**: a merge would bring the old messages back into `gaps`, and the check would fail on them. Entries above this one keep the old SHAs (the log isn't rewritten); this table maps them. `tests/resort.test.ts`'s comment points at `e4908db`.
2. **`abda756` is not reworded, and the check is scoped to what the push publishes.** It is pushed history (CLAUDE.md: never rewrite it), and it can't leave `gaps`' history either: the deploy branch already holds it, so every push of `gaps` lands on top of it. So the check covers `base..HEAD`, with `base` the deploy branch as the remote has it: the commits the push adds. That is HANDOFF §6.4 item 7's own scope ("for unpushed commits only"), now written down and run by a script. It isn't weaker than what QA ran. Every commit the push adds is checked, and more strictly than a trailer parser would:
   - the trailer is the very last line (a parser accepts `a46bd49`)
   - no git comment line is left in
   - no second attribution trailer, and the model isn't named outside the trailer
   - `base` must already be in HEAD. A diverged base fails, where before it silently made the range bigger or smaller.

   Given the live build as the base, the script still lists `abda756`, marked as already on the remote.
   - Rejected: `git replace` or notes (they only change what this clone shows), an allowlist of SHAs (a standing exception), and rebuilding `gaps` without `abda756` (the push would then need a force push, which rewrites pushed history).

### New

- `scripts/check-commits.ts`: `git fetch origin`, then `TRAILER='<your attribution line>' npx tsx scripts/check-commits.ts [base]` from `island-company/`. It exits 1 on any failure and prints each problem. The model's name isn't in the file: it comes from `TRAILER` at run time. `tests/commits.test.ts` (5) covers the message rules on a stand-in trailer: a46bd49's and abda756's shapes, trailing blank lines, and `CLAUDE.md` or `#12` not tripping the name or comment rules.
- Docs: CLAUDE.md (the scripts list, the commands, the git rule: the trailer as the very last line), HANDOFF §1 (the SHA map) and §6.4 item 7 (the check and how to reword).

### Verified

- The check on the new tip: `origin/claude/jolly-keller-gy5hs4..gaps`, 19 commits including this one, 0 failing.
- **tsc** clean; **vitest** 842 tests in 49 files, all pass; **build** passes (dist removed).
- **Balance, standard:** three friends 8 / 11 / 16 / 23, all average 7 / 12 / 16 / 23, both 0 weeks below $0; solo, absent and nobody teams at tier 1.
- **Robust:** three friends miss tier 5 in 70 of 360 (17 + 20 + 15 + 18), all average in 58 (16 + 12 + 15 + 15), 0 and 0 weeks below $0. Long columns: 61 and 12 of 360 games below $0 in weeks 24–52; the credits 0 and 0.
- **Long:** three friends 3 of 30 games below $0 (median 0 weeks, 0 dead weeks), 6 of 7 houses rentable at week 52, revenue 69% of budget in weeks 40–52; all average 1 of 30, 7 of 7, 86%. Every number is the same as the release QA's on `c57c51e`, as an identical tree should give.
- **Pass-and-play e2e** on phone (390×844) and desktop (1280×820): pass. The only console errors are the Manrope font 403s through the symlinked `node_modules`.

## 2026-09-29: Release QA of stage 1 (v4), `1a50845`

What was tested: the tip of `gaps`, `1a50845` (the gap fixes, A0, A0 review rounds 1 and 2, under the v4 gate), against the live build `bd1e1d2`. The brief named `258d0d2` and 781 tests; the branch has moved on since, and what goes live is its tip, so the tip was tested. No game code, test or script was changed; this entry is the only change.

### Results

- **tsc** clean. **vitest** 842 tests in 49 files, all pass. **Build** passes (dist removed).
- **Balance, standard** (26 weeks × 30 seeds): three friends 8 / 11 / 16 / 23, all average 7 / 12 / 16 / 23, both 0 weeks below $0; solo, absent and nobody teams at tier 1. Targets met.
- **Robust** (90 seeds × 4 crews): three friends miss tier 5 in 70 of 360 (17 + 20 + 15 + 18), all average in 58 (16 + 12 + 15 + 15), 0 and 0 weeks below $0. Long columns: 61 and 12 of 360 games below $0 in weeks 24–52; the credits by week 45, 0 and 0. All average is still over its ≤ 37 tail target (known; Seb's call, HANDOFF §1).
- **Long** (52 weeks × 30 seeds), T1: three friends 3 of 30 games below $0 (median 0 weeks, 0 dead weeks), all average 1 of 30 (0, 0); the credits by week 45 0% for both (the one T1 line not met, a gate question). Hold line: three friends 6 of 7 rentable at week 52, revenue 69% of budget in weeks 40–52 (1 point under 70%). Same as the QA of `c57c51e`, as the identical game tree should give.
- **Pass-and-play e2e** on phone (390×844) and desktop (1280×820): pass. The only console errors are two 403s for `manrope-latin-wght-normal.woff2` through the symlinked `node_modules` (cosmetic, worktree-only; the URL was checked).
- **Online e2e** on its own emulator (firebase-tools 14, Firestore 8686, Auth 9696, hub 4686, logging 4696, websocket 9686, this branch's rules, its own TMPDIR; Vite 5238): 6 of 6 runs pass. Run 6 had a no-fault-found first alert on both techs (each planned the next alert), and its requested line was quarantined at receiving and landed a week later. **probe-gate** on the emulator: v:3 permission-denied, v:4 not-found, listing refused.
- **Migration:** the eight `v3-bd1e1d2-*` fixtures `scripts/fixtures-v3.ts` makes regenerate byte for byte from a `git archive` of `bd1e1d2`. The skew, migrate and sub-charter tests (68) and the resort and robust-tail tests over the live docs pass. In the browser, the late doc (week 20, tier 4) loaded into pass-and-play at its own saved time: the week 19 review and the Harbor sheet show, the doc is left as written until the first move (engine 3), the mechanic and the electrician each hand in a ready job (engine 4 from the first write), the analyst's four tabs render, all three end the turn and week 20 resolves. The review's opening cash ($54,787) equals the doc's `openCash`, and all 7 open orders are still there (two ready, one done, two load sheets and two desk tasks cancelled at the resolve as this-week-only, as on the live engine).
- **Reverse skew** (`scripts/reverse-skew.ts` against `bd1e1d2`): 173 of 173 moves refused on 19 docs, every one with "saved by a newer version", and the docs are untouched.
- **islandlab** at phone width: all 34 scenes render. The beaten scene has 1,390 SVG nodes (the budget is 1,500).
- **Diff** `bd1e1d2..HEAD`: 92 files, +9,208 / −622. No binaries, scratch files or secrets (the only key is the public web config, in `probe-gate.mts`, the same as `.env.production`). The largest files are text: `docs/JOBFLOW.md`, `docs/DECISIONS.md`, `src/sim/engine.ts` and `docs/EXPANSION.md` (216–272 kB); the largest fixture is 85 kB. No model name in the diff or in the tree.

### Found, not fixed

- **Commit messages over `bd1e1d2..HEAD`: 19 of 20 pass, `abda756` fails.** It ends with a `Claude-Session:` line after the cloud session's own attribution trailer, which names another model. It's pushed history (on `origin/claude/jolly-keller-gy5hs4`, which is `abda756` on the remote too), so it can't be reworded (CLAUDE.md). `scripts/check-commits.ts` over what the push publishes (`origin/claude/jolly-keller-gy5hs4..HEAD`): 19 commits, 0 failing (A0 review round 2 above).

## 2026-09-29: stage 1 release gate

Branch `gaps` at `db306aa` (stage 1, v4, not shipped), against the live build `bd1e1d2` with real islands mid-season. Three reviews before the release: correctness, live docs, pillars. Seb's brief: "make sure everything runs perfectly and we dont lose where we are now". The reviewers split on the electrician's helper and the pillars review said hold it back, so it's behind one flag, off for this release. Each issue was reproduced first. The numbers are 30 seeds and weeks 24–52 unless noted; the sims are the paper-sim bots.

### Decided

1. **The electrician's helper is held back: `STAFF.helper.enabled` false (`helperOn`).** An NPC putting in the electrician's jobs is trade work, and `docs/JOBFLOW.md` 15 and `docs/EXPANSION.md` 7 still say "NPCs never do trade work". While it's off:
   - the hiring board never deals one; a hire is refused with "The electrician's helper isn't in this release."
   - no work at the resolve, no alert-flow bonus (`helperJobs` 0), no *helper tonight* chip
   - the bots never hire one
   - the Harbor sheet, ONBOARDING (3, 7, 10a) and the Payroll label leave it out; the `staff.ts` header says it's held back
   - the code, its tests (`tests/latefix.test.ts`, `tests/releasegate.test.ts`, the helper's long-game guard, all run with it on) and this log stay. No live doc has a helper (it was never live), so nothing is lost; turning it on later is one flag, and it's Seb's call (HANDOFF 1).
2. **What the helper does, if Seb turns it on** (the pillars review's majors, built now):
   - **By task, not by catalog kind** (`STAFF.helper.tasks`): the receptacle, GFCI and 3-way swaps and the generator's circuit test only. No flicker diagnosis, water heater, bonding, spa feed, storm rewire or panel AFCI. No review line says "helper did … diagnosis".
   - **No hazard's fix**, made safe or not: the electrician puts what they made safe back in service.
   - **Only what was ready when the electrician ended the turn** (`TurnState.ready`, stamped at End turn). A card the analyst approves later, or the standing approval at the resolve, waits for the electrician.
   - **Never in a week the electrician is on autopilot.** Nobody supervises the helper, and the review says so.
   - **Named everywhere:**
     - the trace: "the wet-room GFCI install Ben planned and Lina M. (helper) put in under Ben's licence in week 20" (`Defect.npc`)
     - the closed job: "Put in by Lina M. (helper) to Ben's plan, week 42: 60%."
     - the review: a pinned *The electrician's helper* card, outside the nine lines
     - the island log: "The electrician's helper put in 2 of Ben's planned jobs: …"
     - the chip: *helper tonight* says who and how on the open job
   - **Each helper's own queue** on the Staff desk (`helperQueues`), in the resolve's order.
   - **The hiring card** gives the rule the board applies:
     - the first helper by the list or the houses: "0 of 6 alerts open and the houses at 80 (the first helps at 6 open or under 65)"
     - a second by the houses only: "the houses average 60: a second helps under 55"
     - in receivership: none dealt ("no new hires")
   - **The card's money** is a break-even against a cottage's *expected* rent (`cottageRent`: the extra cottage's 8-week, occupancy-weighted figure, not a fully booked week's $1,709). It sorts at 0, not at +$1,419.
   - **The price:** the narrower scope costs the helper most of its hold. The helper-on guard (seeds 1–10) gives three friends 2 of 10 games below $0, 8 weeks and 18 dead weeks, with houses at about 19 at week 52 and 2 of 7 rentable; all average 0/0/0, about 49, 6 of 7. The old kinds under the other new rules give 1/1/1 and about 40 with 5 of 7. Dropping the ready stamp changes little (2/7/25, about 21, 2 of 7). Still open if Seb says yes: a *Give to helper* toggle on each ready job (bots always hand), and rewriting JOBFLOW 15 and EXPANSION 7 with his decision.
3. **Live islands keep their credits streak** (`stats.aCarry`, `carriedStreak`). The one piece of lost progress the live-docs review found:
   - What v4 did: capped a tier-5 doc's stored streak at its Resort weeks (7/8 read 3/8 on load), and zeroed a tier-4 doc's streak at its first resolve.
   - The fix: `migrate()` stamps `aCarry = aStreak` once, on a doc an older engine wrote last (`engine < 4`, read before `apply` sets 4, week > 0). New islands never get it, so the digests and balance don't see it.
   - While a carried streak is unbroken: it counts in full; an A at the Harbor holds it (new Harbor weeks don't add, as the new rule says); an autopilot A holds it; at the Resort a full-crew A adds one and the credits come at 8 on a full-crew week. A week below A ends it and clears `aCarry`; from then on only the new rule applies.
   - The Endgame card, the Board's Next card (tier 4) and the Harbor sheet's credits line say "Your streak from before this update counts: 7/8. Once it ends, only Resort weeks count."
   - On the live-built fixtures (now committed):
     - `credits-next-t5` (7) gets the credits in week 25 in 4 of 4 continued runs, as on `bd1e1d2`
     - `t5-harbor-streak` shows 6/8, not 0/8
     - `t4-streak-high` keeps 8 and pays on its first full-crew A at the Resort
   - `tests/resort.test.ts`'s old expectation (a stored 9 read as 2) now holds only for a streak nobody carried.
   - **Seb, before deploying (read-only, prod is off limits to agents):** check whether any live island has tier ≥ 4 and `stats.aStreak` > 0, and tell that crew.
4. **The Board rings a paused A only on weeks v4 resolved** (`stats.v4From`, stamped with `aCarry`; `onV4`). The live engine reset the streak on an autopilot A, so `t5-auto-a`'s week 23 is no longer ringed as "held the streak". A credits card from a week an older engine resolved keeps its v3 words ("Eight straight A weeks at the Resort").
5. **Grid first isn't masked** (`generateAlerts`). At real risk, only an open feed alert or grid-first job counts as "something open on the grid". Before, a fuel-dock take-off (a conduit run due in weeks) or a dock card switched grid first off: no feed alert, no chip, not planned. The review counted 37 of 401 at-risk weeks in 19 of 30 three-friends games.
6. **The receiver:**
   - **Funds only a batch's safety-critical share.** The rest must fit the cash above $0 and its $800 block on its own. The $2,000 freeze goes by the share too: a plain stock request no longer rides through with one urgent part. The desk's batch approval sends the safety-critical requests on their own under the freeze or in receivership (`reqActions`).
   - **Says its fee.** The approval card and the feed read "The receiver funds $190 → +$218 on the bridge loan (15% fee)", with the loan and its weekly payment after it. The desk's loan line says "about N weeks".
   - **The loan stays a 10-week loan.** Each advance raises the weekly payment (`max(weekly, ceil(left/10))`) instead of stretching the term unsaid.
   - **A second receivership gets its bridge loan too**, on top of what's still owed. Before, a balance left meant it started below $0 on the $1,500 allowance alone.
   - **A card over the whole week's allowance says it can't be funded.**
   - **The review books the receiver's money as *Financing in*** (`costs.financing`).
   - **The weekly line is plain numbers**, pinned at the top of the review: "Receivership, cash −$37,912: revenue $0 this week against $9,260 of overhead and payroll. The receiver funds safety-critical work up to $1,500 a week onto the bridge loan (15% fee; $49,675 owed) … It ends when cash is back above $0." It replaces "The way out is revenue …", which promised a way out the sim never finds. The desk gives last week's revenue against overhead and payroll.
7. **Minors:**
   - a perfect blind sign-off's no-decay week survives a helper's or autopilot's job on the same asset at the same resolve (`touchedWeek` takes the max, as `complete()` does)
   - `balance.ts long 78`'s credits column is capped at week 52 like the others
8. **The golden digests were re-recorded** (`tests/golden.test.ts`), and a ninth run was added (all average seed 4, 52 weeks).
   - Why they moved: with the helper held back, the hiring board's draw from tier 4 no longer includes it and the bots never hire one. With the helper turned on, three friends 2 and 3 and all average 1 (26 weeks) reproduce review round 1's digests byte for byte, so the draw is all that moved them. The other five hire a helper, whose rules changed. Two moved again for the receivership line's minus sign.
   - Why the ninth run: with the helper held back, no other run has an autopilot A at the Resort, and the streak pause's knob went unseen. The helper's knob is now "on".

### Not done (Seb's calls)

- **The helper itself.** Off is what the pillars review asked for, and it has a price: the long game on the release build is A0's alone again (below). Yes means the scope above plus the hand-over toggle and the spec rewrite. The live A0 slide starts around week 33 on the live late fixture, so an island at week 20 leaves about 2 real weeks to decide.
- **The credits' goal is out of reach** for the friends: 8 full-crew A weeks at the Resort, none below A, comes by week 45 in 0 of 30 games for three friends and all average, and the median game never gets there by week 52 (the A-grade share of Resort weeks is 7% and 13% on this build). Options: 8 in any 12, 6 in a row, or grading the Resort against a revenue budget they can reach. The gate stays as is: no softer gate was bought.
- **Receivership deep below $0 has no way out.** The receiver funds $1,500 a week of repairs while $6,700–9,800 of overhead and payroll run on little revenue. On the three live receivership docs (continued 14 weeks with their crews' bots), cash minus loan ends at −$259,582, −$215,059 and −$182,644, the same as `db306aa`. On the re-entry repro (the late fixture at −$6,000), the island now gets a second and a third bridge loan, and it still goes to 0 of 6 houses by week 35. Real levers: freeze the overhead, furlough the grounded pilots, size the allowance to reopen one house, an asset sale or a restart at the Harbor. The same check as the streak: whether any live island is in receivership below $0.

### Verified on the release build

- tsc clean. vitest: 868 tests in 50 files, all pass (842 on `db306aa`). `npm run build` passes (dist removed).
- **Balance, standard (T0):** unchanged. Three friends reach T2–T5 in weeks 8 / 11 / 16 / 23 and all average in 7 / 12 / 16 / 23, both with 0 weeks below $0. Solo, absent and nobody teams stay at tier 1.
- **Robust:**
  - Three friends miss tier 5 in 70 of 360 games (17 + 19 + 16 + 18), all average in 64 (18 + 14 + 16 + 16), with 0 and 0 weeks below $0. That's 70 and 58 with the helper: the all-average tail is 6 worse without it.
  - Long columns: 251 and 115 of 360 games below $0 in weeks 24–52 (61 and 12 with the helper; 247 and 100 on A0 alone). The credits by week 45: 0 and 0.
- **Long (T1 not met on the release build):**
  - Three friends: 18 of 30 games below $0 (median 2 weeks), median 8 dead weeks. Houses at 23 at week 40 and 4 at week 52, 0 of 7 rentable at week 52, revenue at 9% of budget in weeks 40–52.
  - All average: 8 of 30 games below $0 (0 weeks, 1 dead week). Houses at 41 and 9, 0 of 7 rentable at week 52.
  - This is the review's prediction for the helper off (18 of 30). The release long-game guard pins it. It's still far better than live `bd1e1d2`: before A0, 30 of 30 games below $0 with a median of 14 weeks.
- **Pass-and-play e2e** on phone (390×844) and desktop (1280×820): pass. The only console errors are the Manrope 403s.
- **In the browser (phone), the live-built docs on this build:**
  - the Endgame card reads 6/8 and 7/8 with the carried-streak line; the tier-4 Next card reads 8/8
  - the Harbor sheet has no helper paragraph, and its credits line has the carried streak
  - `t5-auto-a`'s week 23 isn't ringed
  - the receivership desk says the fee, the loan's weeks and last week's revenue against overhead and payroll
  - the review pins the receivership line and books *Financing in*

## 2026-09-29: stage 1 release, the last two QA findings

The release-gate QA of `14e5811` passed every check except one major and a UI minor. Both are fixed here, before the push.

- **Grid first under 45 health.** The gate fix made "something open on the grid" mean a feed alert or a grid-first job only when the grid was at 45 or above. Below 45 the old critical-shape rule still let any open job or alert (a grid repair, a dock take-off) stand in for the feed, so grid first switched off exactly when the grid was worst: on the paper sim, 73 of 291 tier-4+ grid-first weeks under 45 had no feed work open (three friends, 30 seeds × 52 weeks). Now the rule holds at every health: at real risk only feed work counts, the must-do is a feed job, and a grid in critical shape with no feed job to raise still gets its cheapest job, as before. Test: `releasegate.test.ts` "under 45 too" (fails on `14e5811`). The golden digests move for four runs whose grid goes under 45 (three friends seed 3 at 26 weeks; three friends seed 1, mistakes seeds 1 and 6 at 52 weeks) and were re-recorded. The standard run is unchanged.
- **The desk's split batch.** Under the freeze or in receivership only a batch's urgent lines can be paid, so part of a batch can go through. The toast said "Ordered 2 requests" when one went through; it now counts what was ordered ("Ordered 1 of 2 requests: the rest can't be paid for now and stay open").

## Airline network

The build log of `docs/EXPANSION.md`, one subsection per package (§14.2). Each package writes only in its own.

### Engine and data (A)

#### 2026-09-28: A1, the stage-2 contract: objects, quick checks, Report a problem

Branch `stage2`, from `gaps` at `258d0d2` plus the spec (`expansion-spec`, `a608675`). Stage 1 (A0) is being built in parallel on `gaps`; the integrator merges both. Nothing is version-bumped here (engine 4, doc 4, rules `v == 4`): the stage-2 release needs its own bump (v5 if `gaps` + A0 ship as v4), because it adds two moves (`check`, `flag`), two alert sources the open work counts (`check`, `flag`) and `alert.early`, and an older open client would drop or mis-resolve them.

**What's in it** (every symbol B1 and C1 build on, with a working home-only implementation; `tests/contract.test.ts` imports them all):
- `types.ts`: `IslandState.checked` / `flagged` (written on first use), `Alert.early` (hidden), `AlertSrc` `'check' | 'flag'`, the `check` and `flag` actions, both in `WEEK_BOUND`.
- `src/sim/checks.ts` (the logic) and `src/sim/checkdata.ts` (the zones, the home panel's breaker schedule, the houses' circuits, the pools, the write-up rows). The data is in its own file so `alerts.ts` can fold the rows into `SYMPTOMS` without an import cycle.
- The engine's `check` and `flag` moves (`engine.ts`, one marked block), the early tier in `planAlert`, the review lines at resolve step 17b, and one line in `generateAlerts` (a wrong call holds a slot).
- `src/ui/objects.ts`, the selectors in `select.ts` (`assetPnl`, `fixtureFacts`, `openAlertsOn`, `flaggable`, `DockTarget` `{ object }`), `openDm` in `crewboard.tsx`, the version-keyed `whatsnew.tsx` shell, and the mounts in `home.tsx`.
- Stubs that render today's behaviour, for their owners to replace: `src/ui/map/MapView.tsx` (today's `<Island>` and toggle, moved out of Home unchanged; it never emits `onObject`), `src/ui/inspect/InspectSheet.tsx` (a plain sheet that proves the wiring: status, the check, Report a problem), `src/ui/inspect/WhatsNewMap.tsx` (no panels, so What's new shows nothing yet).
- `ops.tsx` exports `WriteUp` and `SafetyCall` for C.

**Decisions beyond the spec (reasons):**
- **A right call and a wrong call raise the same write-up row.** Each check item has its own symptom row (`K_walk:rmain`, `K_ir:hangar`, `K_meter:kitchen1`; `auto`, never drawn by the slots): "Written up at Ana's walkaround: the R main." A right call carries the tell's cause (its finding and fix); a wrong call a no-fault cause. Both are `src: 'check'`. Why: the spec's right call raised the kind's usual symptom (`src: 'finding'`) and the wrong call a write-up, which would tell the tech at once which it was (pillar 3). Now it surfaces at Investigate, like any no-fault-found. Only an open `src: 'check'` alert with no cause counts as a held slot (`generateAlerts`, `openWork`).
- **The plane walkaround rows are airworthiness items** (`aw`): a written-up discrepancy has to be cleared before flight, so an open write-up grounds the plane from its due week (2–3 weeks out, time to close it). The generator's, the panel's and the houses' rows close nothing and roll no incident (a no-fault cause never does).
- **The tell's kind is drawn as the week's draw would weigh it** (seeded per asset and week, so the view holds all week), not "the highest weight". The spec's rule surfaced the heaviest kinds every week (a panel upgrade, a spar, a wheel half). On the robust sweep (90 seeds × 4 crews) it cost all average 20 more tier-5 misses (77 → 97) and three friends 11 (102 → 113). The weighted draw brought them to 81 and 107.
- **An early catch is priced one tier lower as well as played one tier easier** (`earlyLess` in `flow.ts`: `cardToday`/`laborCost` take tiers off; the job flow's labour preview in `steps.ts` uses it too, so the card and the preview agree). Caught early, it's less work. It took the robust misses to 72 and 101, at or under the run without checks.
- **`CHECK.detect` 0.7 → 0.5** (the spec's named lever, 11.5.3). The standard 30-seed median for all average sits on a 23/24 knife edge: with detect 0.7 it read 24 (T0 wants 21–23); 0.5 reads 23 and 23 for both target crews, and the robust sweep equals the run without checks. The 30-seed median moves ±1 week with any reshuffle (one extra alert changes every later seed), so read the robust numbers first.
- **`CHECK.fromTier` stays 2** (the owner's default, 18.9). Tier 3 was tried: no better.
- **The IR scan's layout.** Home's panel: the main (400 A, read for its continuous load: 82–95% is the upgrade's tell) and the tier's feeders (east and west cottages, hangar, office, fuel dock, then the transfer switch feed, the villas, the lodge, the runway edge lights). One distractor a scan: a branch at 85–95% load, 14–18 °C, normal for its load. The generator is scanned during its weekly test run: the generator-side and load-side lugs carry the same current, so the tell is the ΔT between similar components under similar load (NETA's method); the utility-side lugs are open (too light to judge).
- **The meter check's layout.** A cottage's seven receptacle circuits (a villa or the lodge nine) and the service. Kitchen, bath, laundry and porch are 20 A 12 AWG GFCI; bedrooms, living room and hall 15 A 14 AWG. Run lengths are stable per house. The porch is the long run (120–150 ft), the look-alike: its 4.5–6 V drop is normal for its length. The job a right call raises is sited on that circuit (its breaker and conductors).
- **`wearFrom` is read off the catalog's weight functions** (`wearFromOf`, probing health 0–100) unless a catalog line sets it; no catalog line was edited, so A0's changes merge cleanly.
- **Flags.** The receiver is the asset's trade; the analyst's flag on the generator goes to the tech with more coming on it (the mechanic on a tie). "One received per trade a week" is read off this week's `src: 'flag'` alerts (nothing new stored). A flag is drawn from `guest`, `squawk` and `utility` rows of the receiver's trade, with the flagger's name ("Flagged by Seb on Twin N-12: …", a guest's "Guest at …:" dropped).
- **The bots** (`Bot.checks`, `Bot.flags`, on unless false; 12.1): the tech checks the lowest-health checkable asset (the electrician the grid under 70 first) and calls it by `hit`. The analyst flags the house with the most revenue at risk, the electrician a plane under 60, both with nothing open on it, and **only when the receiver is under their open-work target** (a considerate crewmate: a swamped one gets a message, not a flag on top). Their draws have their own streams (`hashSeed(s.seed, 'bot-check', …)`), so with checks and flags off a run is the base build's. Autopilot never checks or flags.
- **`assetPnl`**: revenue is this week's projected (a house's booking, a plane's guests and tours, what a week down would lose): the doc keeps no per-asset revenue history. Parts + labour is exact over the window; the split between them is estimated from each week's island-wide labour share, since the ledger keeps one sum per asset.
- **MapView takes an optional `go: { preset, n }`** (not in 14.3): Home's builders' line still jumps the map to the build site and scrolls it into view.

**The golden identity** (`tests/golden.test.ts`): with checks and flags off, 26 weeks of three friends (seeds 1–3) and all average (seed 1) hash (sha256 of the final doc's JSON) to what `258d0d2` gives, recorded in a throwaway worktree of it (removed after). Nothing stage 2 is written, and `migrate()` adds nothing. **After A0 merges, re-record them** on the merged base: `simulate(TEAMS[team], 26, seed)` there, then the hashes.

**Four older sim tests reshuffled** (one extra alert changes every later seed): the alert-volume test now counts the check write-ups (they take the week's slots: right and wrong calls together keep each trade within ±10% of the base volume); the late-game test runs ten seeds, not five, at the same share; the county-calendar and staff-stub tests run the base crew (`tests/crews.ts`), since their claims are about the base game. The staff-stub one exposed a latent report bug, **not fixed here** (it would change the golden digests, and it's stage 1's resolve): when a crew project finishes at the resolve (autopilot's cover), `tierUp` is computed before `finishProjectIfDone`, so that week's review reports the new tier at the old tier's costs.

**Balance (T7; 26 weeks; medians):**

| Run | Team | T2/T3/T4/T5 | weeks < $0 | T5 misses | checks right/wrong/flags per game |
|---|---|---|---|---|---|
| standard, off | three friends | 8/11/16/23 | 0 | 6 / 30 | — |
| standard, on | three friends | 8/11/16/23 | 0 | 7 / 30 | 9.7 / 1.3 / 2.0 |
| standard, off | all average | 7/12/16/23 | 0 | 4 / 30 | — |
| standard, on | all average | 7/12/16/23 | 0 | 3 / 30 | 10.8 / 1.2 / 1.8 |
| robust, off | three friends | T5 23/24/23/24 | 1 | 102 / 360 | — |
| robust, on | three friends | T5 24/24/23/24 | 1 | 102 / 360 | — |
| robust, off | all average | T5 23/24/24/23 | 0 | 77 / 360 | — |
| robust, on | all average | T5 23/24/24/24 | 0 | 78 / 360 | — |

Solo, absent and nobody stay at tier 1 either way (their numbers are identical: checks start at tier 2). **The tier-3 unlock week doesn't move** (11 and 12, on and off). The pacing-guard test holds.

**Checks:** `npx tsc --noEmit -p .`; 828 of 828 tests in 49 files (781 in 45 before): `tests/golden.test.ts`, `contract.test.ts`, `check.test.ts`, `flag.test.ts`, the stage-2 blocks in `whosemove.test.ts` and `skew.test.ts`. `npm run build`. The pass-and-play e2e at 390 × 844 and 1280 × 820 (only the Manrope 403s). A scripted phone run (390 and 360 px) and a desktop run on a crafted save (`scripts/stage2-save.ts`): Home as before, the zone toggle, the walkaround in the stub sheet and its write-up, the analyst's flag, a fixture's facts, and `openDm` opening the DM prefilled.

### The map (B)

#### 2026-09-29: B1, the free map: camera, gestures, presets, Explore, hotspots

Branch `s2-b1`, from A1's `3e04cfb`. UI only: no engine, selector or state change, nothing stored in the island doc (the preset in use and the one-time hints are per-device `localStorage`, guarded). Balance is unchanged by construction.

**What's in it:**
- `src/ui/map/camera.ts` (pure): the camera `{ x, y, k }` with a contain fit, clamping, zoom about a point, the pinch (spread and midpoint), pan, the presets (`camForBox`: in the inline 4:3 map exactly `zoomOf`'s view, tested for every role, tier and build), the stage transform between two cameras, the raster region (`frameOf`) and the flight plan. Ready for stage 3: `REGION_SCENE`, `SceneKind`, and limits that carry a `kMin` (the region's transient 0.8).
- `gestures.ts` (the pure tap/drag/pinch classifier), `controller.ts` (a CSS transform per animation frame, one commit at the end; flights), `hotspots.ts` (the registry and hit-test), `place.ts` (where the planes, carts, builders and staff are drawn: the art and the hit-test read the same spots), `layouts.ts` (`SceneLayout` and `LAYOUTS.home`; the station layouts are B2's), `MapView.tsx` (replaces A1's stub; the 14.3 props plus A1's `go`, and optional `phase` / `reduceMotion` for the lab), `map.css`.
- `island.tsx` takes `frame` (the camera) and a `probe` (where it placed the bubbles); `focus` stays for the lab, week 0 and the start screen. The placement code moved to `map/place.ts` unchanged: all 34 island-lab scenes render pixel-identical to `3e04cfb` (still, 358 px, dpr 2).
- The island lab: `&map=1` renders every scene in the map; a `beaten-storm-night` scene. `scripts/island-shots.mjs` checks the budget list (5.7) drawn plain and through the map, and has a `perf` mode (5.6).

**Decisions beyond the spec (reasons):**
- **A committed camera draws a region, not just the viewport.** The whole scene when it fits 4 M device px (the phone card, at every zoom), else the view grown on every side as far as that budget allows (Explore close up, a retina desktop). Why: the spec's wrapper transform alone shows bare sea wherever a pan or a pinch-out uncovers what was off screen. The `viewBox` keeps its origin at 0 0 and the region's corner is a translate on the zoom group, so the ambient animations (`transform-box: view-box`, origin 0 0) still pivot where they should. A letterboxed view (a portrait Explore) draws the scene's own sea overhang (60 units) into the bands.
- **Flights pick their order** so the ground is drawn all the way (`planFlight`): the drawing on screen flies to the new view when it covers it (the phone card, always), else the new camera is drawn first and flies in from the old view (a flip), else the whole island is drawn, flown across, and the end drawn (two distant close-ups in Explore).
- **The reach is 22 CSS px from an object's middle, not from its footprint's edge.** From the edge, 22 px at k = 1 on a 358 px card is 49 map units round every footprint: the beaten island had 14% empty ground (tier 1: 28%), against the 40% the zone toggle needs (13.2). From the middle (gap-zoom's rule for the builders, a 44 px disc round every object; a building's own footprint is bigger than that) it's 46% (tier 3: 55%, tier 1: 60%), and a small thing (a figure, the windsock, the bowser) still has its 44 px target.
- **A cart's own 44 px target yields to another object's drawn footprint.** At k = 1 it is ~98 map units square and buried the twin parked beside the charger (5 px of it was tappable: the plane's sheet, the mechanic's main new screen, was unreachable at the default view). Where the cart is drawn it still wins over the plane beside it (z 60, tested); on open ground its target is its SVG button's size, max(44 map units, 44 CSS px), at every zoom.
- **Taps are handled at pointer-up, and the click that follows is swallowed window-wide.** The sheet a tap opens is under the finger by the time the browser's click arrives: its scrim took that click and closed the sheet at once. A click with no pointer sequence before it (a screen reader's) still reaches a cart's SVG button.
- **A builder or a build site opens the site's sheet and frames the build site behind it** (so gap-zoom's "tap a builder: the site" habit still lands there when the sheet closes).
- **After a pinch, the finger left on the glass pans on**, inline too, until it lifts; a lone finger inline never pans (5.1).
- **A double tap at the most zoom goes back to the whole island** (the double tap is otherwise a no-op there).
- **The bubble scale is min(1, 1.3 / k)**: continuous under a free zoom; every preset's bubbles are as before.
- **The idle stillness is a class toggle, not a render** (`useStill`), so the first touch after 20 s idle doesn't re-render the island under the finger.
- **Explore is the same instance, in a root of its own** (a portal without `preact/compat`, whose option hooks would change the whole app), lifted to `body`: out of `.side`'s sticky stacking context on desktop, under which the dock would paint over it. The slot keeps its height. A sheet opened from Explore rides above it (`html.map-exploring` raises `.scrim` and `.sheet`).
- **The controls are text glyphs** (+ − ⌖ ⤢ ✕), so the map adds no SVG nodes; the beaten scene is 1,392 nodes through the map (1,390 plain: the two carts' hit rects, as on Home today) and `beaten-storm-night` 1,348.
- **A mouse over the map shows the pointer and a name tag** over whatever a click would open (desktop only; written to the DOM directly, no render). It makes "click around" discoverable on a computer.
- **`hotspots()` takes an optional `phase`**: the staff (and their hotspots) are off at night and in a storm, as drawn.

**What the map emits** (for C): `plane`, `house`, `grid`, `generator` (the asset's id); `hangar`, `office`, `runway`, `fuel` (the bowser), `windsock`, `dock` (the seaplane dock, from tier 4; before it the works are a `site`), id = the kind; `staff` (a pilot's or a housekeeper's npc id); `site` (the build's id, or `project` for a crew project's sites with no build); carts go to `onCart`. Every `st` is `home`.

**Performance** (`island-shots.mjs perf`: 390 × 844, dpr 2, touch, CPU throttled 4×, ambient motion on; frame times from `requestAnimationFrame` over 60 touch moves at 60 Hz each, which CDP's dispatch stretches to about 2 s):

| Scene | pinch (median, p95) | two-finger pan | one-finger drag in Explore |
|---|---|---|---|
| `beaten` | 16.7 ms, 16.8 ms | 16.7, 16.7 | 16.7, 16.7 |
| `beaten-storm-night` | 16.7, 16.7 | 16.7, 16.7 | 16.7, 16.8 |

A trace of the throttled pinch: 2 paints in the whole gesture (the drawing moves as a picture), 4 ms of main thread a frame; the commit after the lift is ~46 ms of main thread over 3 frames at 4× (no long task). Headless Chromium rasters on the CPU; a real phone's GPU raster isn't measured here.

**Checks:** `npx tsc --noEmit -p .`; 861 of 861 tests in 52 files (`tests/camera.test.ts`, `hotspots.test.ts`, `scenes.test.ts`: the math, the classifier, render counts through the real map in a small DOM, Explore's one scene, the budget); `npm run build`; balance standard and robust as A1's; `island-shots.mjs` (budget: no errors); the pass-and-play e2e at 390 × 844 and 1280 × 820 (only the Manrope 403s); scripted runs at 390 and 360 px and 1280 × 820: one-finger page scroll, a tap on every object kind, pinch on the far side, two-finger pan, double tap, each preset, the ground toggle, Explore (pinch, drag, a sheet above it, ✕), Ctrl + wheel about the cursor, the plain-wheel hint, drag, double-click, the keys and the object list, Esc; idle stillness and reduced motion.

**Not done (stage 3, B2):** the station scenes, the region view and pin fly-to, `home-fleet` / `tern-busy` / `adair-busy` / `region` lab scenes (the budget list already names them), the layout-only ZZ scene test.

### Objects (C)

#### 2026-09-29: C1, the inspect sheets, the three quick checks' screens, Report a problem, stage 2's What's new

Branch `s2-c1`, from A1's contract commit `3e04cfb`. Files: `src/ui/inspect/*` and `tests/inspect.test.ts` only. No engine, select or version change: what C needs from A is listed at the end.

**What's in it:**
- `facts.ts`: `facts(s, ref, role)`, a pure model of what a seat sees on an object and the moves it makes there (the lines, the records, the moves, the one primary move, Report a problem). `Inspect.tsx` draws it, and `InspectSheet.tsx` (the contract's component) loads that as a chunk of its own; `plane.tsx` (data plate, external power placard, logbook), `house.tsx` (the nightly-rate stepper), `power.tsx` (panel and breaker schedules), `hangar.tsx` (the carts), `office.tsx` (cash, spendable, runway), `people.tsx` (a crew member, the crew project, the inline hire, let go, start a cottage), `fixtures.tsx` (the badges), `Report.tsx`, `parts.tsx` (the checks' footer and help).
- The checks: `Walkaround.tsx` (the airframe in plan view, twin / cargo single / amphibian, or the generator side on with its door open; a numbered marker per zone and every zone's observation in one list), `IrScan.tsx` (the PPE line first; the panel under a thermal camera; every breaker's rating, conductor, load and rise), `MeterCheck.tsx` (a plug-in tester with a 12 A load at every receptacle circuit, the GFCI results, both service legs). Each is 3 taps from the sheet: the check, an item, the call; the "all serviceable / all normal" call is 2.
- `WhatsNewMap.tsx`: the four panels (explore the map; tap anything, per seat; your quick check and Report a problem; what else changed). A new island's week 1 shows only the first.

**Decisions beyond the spec (reasons):**
- **Nothing hidden, proven by invariance.** Every sheet's facts are the same with the defects, the no-fault flags, the early flags (where nothing's planned) and the carts' cable wear changed, and no alert's hidden finding appears in any line (`tests/inspect.test.ts`, on a tier-1 island, a played tier-5 one and every live v3 fixture). The early flag is left alone on planned alerts: the card prices an early catch a tier lower (A1's rule), and the desk already shows that price.
- **No open-work numbers on Report a problem, and words true of every flag.** `openWork` counts no-fault alerts differently from real ones, so a number next to a crewmate's visible alerts would tell the analyst which are no-fault. The spec's words ("It counts in her open work, so next week's draw is one smaller") are false for a no-fault flag, which takes no slot. The sheet says what every flag does, real or not: "Adds one alert for Ben now, in your name. It's on Ben's list until Ben closes it." No pronouns (we don't know the crew's).
- **Blind calls.** After a check the sheet says "Walkaround done: you wrote up the L main. It's on your alert list; a closer look at Investigate shows what it is", with the write-up row's own words (`CHECK_ROWS`). Verified in the browser: a right call's alert opens on its real finding at Investigate, a wrong call's on the no-fault finding with "No fault found · close"; the review says only "Ana walked around Twin N-12 and wrote up the L main."
- **The IR image paints by temperature, never by verdict.** Each lug is coloured by ambient + its rise (a magma palette over a 30 °C span, a little gamma so a warm lug glows before it's white hot), as a real camera does. A tell at half load and a 90% distractor glow alike; reading heat against load is still the skill. The ambient is the island afternoon's, 27–31 °C, seeded by the asset and the week (display only).
- **The meter check shows loaded volts, not a drop.** The view gives the volts under the load and the run length; the tester's LCD shows the picked circuit big. (A SureTest-style % drop would need each circuit's no-load volts from A.)
- **The drawings only repeat the list.** The markers are `aria-hidden` duplicates of the list's buttons, so Tab and a screen reader go through the list; each marker has a 22-unit (44 CSS px on a phone) tap circle.
- **The records come after the moves.** A sheet reads: status and health, the lines, the seat's moves, then the records (data plate, logbook, schedules), then Report a problem, with the primary move in the sticky footer. Schedules are folded (`details`): the checks read the same circuits, and a phone's sheet stays short.
- **The logbook** shows this season's sign-offs on the plane (maintenance only: a load sheet is the pilot's, a ground power start an operation; never a score) above the airplane's own derived entries, 2 shown, the rest a tap away.
- **The analyst's moves:** a plane's pending flow cards approve inline (the footer: "Approve Oil and filter change · $150"; other cards on it link to Approvals); a house steps the island's nightly rate ±$10 with this week's effect either way; a staff figure hires this week's best candidate for that role by the card's dollar effect (+1 confirm), or lets them go with the severance; the build site buys the next unit's materials or starts a cottage (+1 confirm); the hangar opens Stock, the office the desk.
- **Fixtures, carts, staff and sites** have no flag (a player-raised report would be self-harm or a fake, 6.5): a DM to the seats whose it is, started "About the hangar: ". The windsock's reads "Tell the crew", the weather isn't broken. A cart's ref is the ground power sheet unchanged; for the other seats it adds the cart's open report job and a word to the mechanic.
- **Refs from the map (B1's hotspots, read-only):** staff ids are npc ids (the standard crew's `std-…` ids included); a site is the open build, a finished build as built, or a queued build's own site; `project` is the tier's.
- **Esc closes the sheet** (kit.tsx's `Sheet` only closes on its scrim) and focus moves into it on open.
- **The sheet's body is a chunk of its own** (`lazy`, preloaded when the phone is idle after the first paint, as the job sheet is). It pulls in the purchasing model (for the analyst's inline approve) and the checks' art; eager, it had doubled Home's main chunk (65 kB → 137 kB). Now Home's first paint carries none of it and the first tap finds it loaded.

**How to try it before B1's map lands:** open a sheet from the console, `window.dispatchEvent(new CustomEvent('ic:open', { detail: { object: { kind: 'plane', id: 'p1', st: 'home' } } }))` (home.tsx's mount), on a save from `scripts/stage2-save.ts`.

**Verified** at 390 × 844, 360 × 844 and 1280 × 820 as each seat (Playwright screenshots, looked at): every object kind; the walkaround on the twin, the cargo single, the amphibian and the generator; the IR scan on the grid (tier 2 and tier 5) and the generator's transfer switch; the meter check on a cottage and a villa; a right and a wrong call followed to Investigate and through the resolve; the analyst's flag on a cottage arriving on the electrician's list, the electrician's on the cargo plane arriving on the mechanic's; the DMs opening the board prefilled; the inline approve, rate step and hire; the What's new panels. The pass-and-play e2e passes on phone and desktop once the stage-2 What's new is dismissed (see below).

**Needs from A / the integrator (not done here: not C's files):**
- `tests/contract.test.ts:105` asserts A1's stub (`whatsNewMapPanels(...)` equals `[]`); with the real panels it fails on the 11 live fixtures. Replace it with a shape check (every panel has a title and a body).
- `scripts/e2e.mjs` (Integrate): a new island's week 1 now opens the stage-2 What's new (panel 1); tap Got it (or Skip) on each seat's first island view.
- `DockTarget` `{ desk: 'money' | 'staff' }` (and desk.tsx's `ic:open` handler), so the sheets' Pricing ▸ and Hiring board ▸ can land on their tabs; today the sheets offer only Stock and Approvals.
- Realism nits in `checkdata.ts`: the main's `500 kcmil Al` is below the 400 A row of NEC 310.12 (600 kcmil Al); the generator's 70 A main feeds a 60 A transfer switch (its rating should be at least the breaker's).
- Nice to have: a circuit's no-load volts in `CheckItem.reading`, for a % voltage drop on the tester.
- `flagTo` picks the generator's receiver from open alerts' hidden kinds (`slotKind`): the analyst's "Report a problem to Ana / Ben" on the generator can shift with a hidden cause. Use the alerts' visible symptoms instead.

### The network desk (D)

### Integration (stage 2)

#### 2026-09-29: stage 2 on the live stage 1: the free map, per-seat objects, quick checks

Branch `s2rel`, from the live `e810cc5` (engine 4, doc 4, rules `v == 4`). The three packages merged with `--no-ff`, in order: `stage2` (A1, `3e04cfb`, built on `258d0d2`, before A0 and the stage-1 fix rounds) as `c5c8cef`, `s2-b1` (`bae368d`) as `419fa7d`, `s2-c1` (`0100ab8`) as `fc7dc86`. Every feature whole, no stage-1 behaviour dropped. No version bump here: stage 2 ships as v5 in a later step (A1's reasons: two new moves, two alert sources the open work counts, `alert.early`).

**The A1 merge** (the only one with conflicts; the rest merged clean):
- `alerts.ts` `generateAlerts`: A0's helper slots (held back, `STAFF.helper.enabled` false) and A1's held slot for an open wrong-call write-up, both kept. Grid first unchanged: at real risk only an open feed alert with a real cause stands in for the feed, so a wrong call's no-fault write-up on the grid never switches grid first off, and a right IR call on the grid (an `xfmr` or `panelUp` alert on the panel) counts as feed work.
- `bots.ts`: A0's receiver approvals with A1's check and flag imports. `home.tsx`: the Harbor sheet and stage 2's inspect sheet and What's new all mounted; What's new waits for the week's review and the Harbor sheet. `balance.ts`: A0's long game and A1's `checks=off` together. `golden.test.ts`: stage 1's nine runs and the knob test, played by the base crew (no checks, no flags).
- The asset lists' health bars carry stage 1's tick marks (A0 review round 1); the inspect sheet's bar now carries the same marks (C1 was built before them).

**What the packages asked of the integrator, done:**
- `tests/contract.test.ts` checks the What's new panels' shape (a title and a body each) on every live fixture, not A1's empty stub.
- `DockTarget` `{ desk: 'approvals' | 'stock' | 'money' | 'staff'; at?: string }`, routed by the desk's `ic:open` handler to any tab and scrolled to the section `at` names (kept across the desk's lazy load, like the tab). The analyst's sheets link to it: a house to **Pricing** (Money), a crew member to the **Hiring board** (Staff), the build site to **Site work** (Staff).
- `checkdata.ts` realism:
  - **The main is two parallel sets of 250 kcmil Al (410 A at 75 °C), not 500 kcmil Al (310 A) and not 600 kcmil Al.** Table 310.12's 400 A row (600 kcmil Al) is for a dwelling's service or feeder; this panel feeds the hangar, the office and the fuel dock too, so Table 310.16 applies, where 600 kcmil Al is 340 A (240.4(B) would allow a 350 A breaker, not 400). Two sets of 250 kcmil Al are right under either table. A test checks every breaker on both panels against its conductor's 75 °C ampacity.
  - **The generator's main breaker is 60 A on #6 Cu,** no bigger than the 60 A transfer switch it feeds (the switch as installed, which the electrician's `transfer` job later finds the houses have outgrown).
- `checks.ts` `flagTo`: **the analyst's flag on the generator goes by what she can see.** Before, the receiver was the tech with more upcoming wear on it (catalog weights and the alerts' hidden kinds), and the sheet names the receiver before the flag, so it told her which trade's wear was ahead. Now: the tech who already has an open alert on it (the sheet's chips show them), else the mechanic, or the electrician when the mechanic already has this week's flag. What the flag raises is still drawn from what's coming, as on every asset (6.5).
- **A flagged airworthiness squawk is due next week at the earliest** (`FLAG.awLead` 1). A pilot-squawk row with a lead of 0, raised mid-week by a crewmate, grounded the plane at once, possibly after the mechanic had ended his turn. A crewmate's report is a heads-up, not a grounding.
- Wording: the grid and the generator read as things mid-sentence (`nameMid` in `alerts.ts`): "Ben IR-scanned the island grid", "Cy flagged the generator house for Ana", "Flagged by Cy on the island grid: …", "Tell Ben about the island grid".
- The inspect sheet's dialog name is the sheet's own header name for every object: an asset's, a crew member's, the build's, a cart's, and a fixture's own name ("Fuel dock", "Dock and boats", `FIXTURE_NAME` in `objects.ts`). It moved to `select.ts` (`inspectLabel`), still out of the sheet's lazy chunk, with a test over every object on every fixture.
- `scripts/e2e.mjs` and `scripts/e2e-online.mjs` dismiss stage 2's What's new on each seat's first view (the week-1 one is screenshotted). **`e2e.mjs` has a map pass** (phone and desktop): on the new island each seat moves the map (two-finger pinch and pan, or Ctrl + wheel and a mouse drag; the camera must move), taps an object at its hotspot and reads its own sheet (the mechanic a plane's walkaround, the electrician a house's meter check, the analyst the nightly rate, then Pricing lands on the Money tab); then, on a tier-2 save past week 3 (`scripts/stage2-save.ts`, generated by the run), the mechanic walks round the plane that shows a sign, writes it up (it's on his list, `checked` stamped), reports a problem on a house that lands on the electrician's list in the mechanic's name (opened: "Flagged by Ana on Cottage 1: …"), the electrician IR-scans the grid (the PPE line, 2 × 250 kcmil Al, All normal), and the analyst is told the electrician already has this week's flag.

**Checks** (on this tree):
- `npx tsc --noEmit -p .`; **997 of 997 tests in 57 files** (new: the panels' ampacity and the generator's breaker, the grid's words, the generator's receiver by what's visible, the flagged squawk's lead, the desk links, the dialog names). An earlier full run hit four 30 s timeouts while other agents loaded the machine (load average 65); alone it runs in 45 s.
- **The golden digests are unchanged** (not re-recorded): with quick checks and flags unused, every run is byte for byte `e810cc5`'s, no week's doc carries a stage-2 field, and `migrate()` adds nothing. `balance.ts checks=off` reproduces `e810cc5`'s standard and robust tables exactly.
- **Balance, T0 and T7** (standard 26 weeks × 30 seeds; robust 90 seeds × 4 crews; checks and flags on vs off):

| Run | Team | T2 / T3 / T4 / T5 (median week) | weeks < $0 | robust: T5 misses of 360 | robust: games below $0 in weeks 24–52 | credits by week 45 |
|---|---|---|---|---|---|---|
| off (= `e810cc5`) | three friends | 8 / 11 / 16 / 23 | 0 | 70 | 248 | 0 |
| on | three friends | 8 / 11 / 16 / 23 | 0 | 74 | 209 | 0 |
| off (= `e810cc5`) | all average | 7 / 12 / 16 / 23 | 0 | 64 | 115 | 0 |
| on | all average | 7 / 12 / 16 / 23 | 0 | 49 | 80 | 4 |

  T0 holds with them on: the standard medians are unchanged, 0 weeks below $0, solo, absent and nobody stay at tier 1 in every seed (their rows are identical: checks start at tier 2, and they flag nothing). **The tier-3 unlock week doesn't move** (11 for three friends and 12 for all average, on and off). Robust: three friends' misses 70 → 74 of 360 (inside the run's noise, about ±8 games), all average 64 → 49; weeks below $0 0 and 0; the robust medians to tier 5 read 23 / 24 / 23 / 24 and 23 / 24 / 23 / 23 across the crews (all 23 off). The long columns improve: games below $0 after the Resort 248 → 209 and 115 → 80 of 360. Per game the bots make about 9.6 right calls, 1.3 wrong calls and 0.8 flags (three friends).
- `npm run build`. Island lab at 358 px: beaten 1,390 SVG nodes plain and 1,392 through the map; `beaten-storm-night` 1,345 and 1,348 (budget 1,500), phone and desktop, no errors.
- The pass-and-play e2e with the map pass at 390 × 844 and 1280 × 820; a scripted run at 360 px (every check screen, the desk links, no horizontal overflow); the online e2e on the emulators (four devices, What's new dismissed on each); only the Manrope 403s.
- **Live v4 docs:** six docs written by `e810cc5`'s own engine and bots (tiers 1 to 5, weeks 4 to 40, one mid-week) load, need no migration, render every object's sheet for every seat, take a quick check from each tech and a flag from the analyst, and play ten more weeks through the resolve, the same in memory and through JSON, with no open order dropped (a scratch check; the v5 step commits fixtures from the live build).

**Not done here:**
- The v5 version gate (a later step): `ENGINE_VERSION` / `DOC_VERSION` 5, rules `v == 5`, fixtures written by `e810cc5`, the skew and reverse-skew runs, the rules probe.
- Autopilot never closes a no-fault alert (stage 1's rule: it plans only real faults). A wrong call's walkaround write-up on a plane, left open by a mechanic who then goes away, grounds that plane from its due week until he's back, as a pilot's no-fault squawk already does. The robust numbers above include it; worth a look in review.

#### 2026-09-30: G0, the Resort holds for 64 weeks (the builder's warranty, the service upgrade, renovations; the credits' goal as one switch)

Branch `s2rel` at `335c9fb` (stage 2 integrated on the live `e810cc5`). The G0 probes (four lever families) and their synthesis chose **variant (c)**: the upkeep structure with the electrician's helper off. Its patch (`variant-c.patch`, made on `db306aa`) went in with `git apply -3` and a hand merge over stage 1's release gate and stage 2; then the changes below. **The helper stays off** (`STAFF.helper.enabled` false, as live): the synthesis's `fromTier: 99` switch was not taken.

**What G0 is** (all data in `data.ts`, every knob seen by a golden digest):
- **`WARRANTY`** `{ fromTier: 4, weeks: 26, decay: 1, service: { grid: true, gen: true } }`. From the Harbor, a tier's new houses and generator house, and an extra cottage the builders finish, lose 1 a week untouched for 26 weeks (instead of 3 or 5); guests' wear, storms, incidents and fires still hit them (`Asset.warrantyUntil`, optional). **The service upgrade:** at tier 4 the grid gets a new pad-mount transformer and feeder, at tier 5 the Resort a bigger standby set and transfer switch, each raised to the new buildings' health (if below) under the same warranty.
- **`RENO`**: a renovation is the analyst's capex from tier 4 on a house at 75 or below: the package when it's ordered (cottage $6,000, villa $12,000, lodge $16,000: roofing membrane, flooring, fixtures, paint, the permit) plus materials (BLD-FLASH + BLD-TRIM, then BLD-DECK + BLD-SHUT, × 1/2/3 by size: $850 / $1,700 / $2,550 at list). The builders (NPCs: carpentry, roofing, finishes, never licensed work) do it in 2 work units with the house closed (no guests, no decay, no new alerts); the electrician's permit final (`E_RENO_FINAL`, a code-prep job, urgency +120; a live code notice on the house doubles as it) reopens it at 85 or better under a 13-week warranty. Autopilot buys an ordered renovation's materials and signs a covered final by the book, but never orders one.
- **New here: the cooldown** `RENO.cooldown` 26: one renovation per house every 26 weeks, counted from the week it's ordered (the Goodhart guard: a renovation resets a house to 85 under a fresh warranty, so without it an analyst could keep a house new by renovating it on repeat instead of maintaining it). A signed renovation stays on `s.builds` until its cooldown ends (at most one record per house: the doc budget holds). **Its price is in the tail (below): Seb's call.**
- **`RENO_BOT`** (the fin bot): a house under 55, out of its warranty and not red-tagged, the most rent at stake first, at most 2 the builders haven't finished, when the cash after the package and materials stays over $20,000 and the reserve; at the Harbor the Resort's $60,000 cash gate first unless the house is under 40. The naive analyst renovates the cheapest house at 75 or below while spendable is over $15,000, warranty or not, up to 2. The fin bot keeps one builder at the Resort while it renovates (a second while 3 or more houses are worn or on the list).
- **`GOAL`, one data switch.** `rule: 'streak'` (**the default, today's rule**: 8 full-crew A weeks at the Resort, `stats.aCarry` for live islands) or `rule: 'quarter'` (the synthesis's "two months on plan at the Resort": of the last 8 counted Resort weeks, 6 at B or better and the period's revenue at 85% of its budget or more; a full-crew week joins; an autopilot week on plan pauses; one below plan joins as a miss; a week played in receivership clears it; Harbor weeks never count; the credits land on a full-crew week). **Changed from the synthesis:** `quarter` is **computed from `s.history`** (`econ.ts goalWindow`), not a stored `stats.quarter` window, so a live island's Resort weeks count the moment Seb flips it (tested on a live e810cc5 doc: its 4 Resort weeks are in the window at once). The one thing the reports didn't say, receivership, is now on each week's report (`WeekReport.rcv`, optional; a pre-v5 week has none, and its grade is capped at C anyway, so it counts as a miss there). The Endgame card, the Harbor sheet, the review line and ONBOARDING say whichever rule is on (`quarter`: *x of the last 8 at B or better*, and the period's revenue against the 85% line). **Not flipped: Seb decides.** History keeps 26 weeks, so more than 18 paused autopilot weeks in a row would push counted weeks out of reach (no crew plays like that).

**Live islands: the one-time migration** (`migrate.ts` step 9). On a doc an older engine wrote (engine < 5) at tier 4–5, once, stamped `stats.g0From` (the week): the builder's warranty dated from when its Harbor and Resort buildings went up (`stats.tierReachedWeek`, and an extra cottage's `finished` week from the Harbor on), **only where it still runs** (fair, no gift: a Harbor 27 weeks old gets none); and the service upgrade a new island gets with its tier, granted now: the grid at 80 or better (the generator too at tier 5) under a warranty from this week. One feed line says so; What's new says it with the numbers. Houses keep their health. A doc engine 5 wrote is never migrated; a live doc below tier 4 gets these when its tiers come.
- **This needs the version gate, so the constants are bumped here:** `ENGINE_VERSION` 5, `DOC_VERSION` 5, rules `v == 5` (the migration keys on engine < 5, and G0 changes the resolve from tier 4: an open v4 client would resolve a week on the old wear). `EXPANSION.md` 10.2 said no stage migrates; G0 is the exception, and the golden test still proves `migrate()` adds nothing to a doc this build wrote. **The rest of the v5 gate is still the later step:** reverse skew with `e810cc5`, the rules probe, the release fixture set (`tests/fixtures/v4-e810cc5-*.json`, five docs written by `e810cc5`'s own engine and bots with `scripts/fixtures-v4.ts`, are committed here for the migration tests and can be its start).

**The UI** (none existed): the **Renovations** card on the analyst's Staff desk next to the extra cottages (every house at 75 or below, its rent a week, the case in one line, *Renovate · $6,000*; renovated houses with their final's week and when the cooldown ends); the **Renovate** sheet (package, materials, weeks closed at the builders' output then the final, rent lost, when the house closes if left alone, the points it gets back and what they'd cost in the electrician's routine jobs, the payback, the cooldown, the rule "75 or below"); the house's **inspect sheet** for every seat (*Builder's warranty to week N*, where the renovation stands, the analyst's Renovate card with the same case), the grid's and the generator's warranty lines; the island (a scaffold and a blue tarp while the builders work, their figures at the house, a cone bubble; the permit card on a stake and a clipboard bubble while the final waits; +4 and +3 SVG nodes, beaten scene 1,390, beaten with two renovations 1,385, budget 1,500); the electrician's flow (*Permit final: Cottage 2 stays closed until it passes*, a **house closed** chip that says why, the sheet's header *Permit final*); the Harbor sheet's two new items; the **v5 What's new** panel *Buildings that last* (the warranty, the service upgrade, what this island got, renovations, the seat's own line) in the version-keyed shell, before stage 2's last panel.

**Golden digests re-recorded on purpose:** G0 changes tier 4+ play (the warranty, the upgrade, the fin bot's renovations and the builder it keeps), and every report now says `rcv` in receivership (why the nobody crew's digest moved). Two runs added from the synthesis (mistakes seed 10 at 52 weeks for grid first at risk; nobody seed 1 for the receiver). Every knob, G0's included (`WARRANTY` off, `WARRANTY.service` off, `RENO_BOT.trigger` 0, `RENO.cooldown` 0, `GOAL.rule` quarter), moves a digest.

**Balance** (paper sim; e810cc5 = the live stage 1; 335c9fb = stage 2 before G0):

| Run | Team | e810cc5 | 335c9fb | G0 |
|---|---|---|---|---|
| standard 26 wk × 30: T2/T3/T4/T5, weeks < $0 | three friends | 8/11/16/23, 0 | 8/11/16/23, 0 | 8/11/16/23, 0 |
| | all average | 7/12/16/23, 0 | 7/12/16/23, 0 | 7/12/16/23, 0 |
| robust 90 × 4: T5 misses of 360, weeks < $0 | three friends | 70, 0 | 74, 0 | **61**, 0 |
| | all average | 64, 0 | 49, 0 | **39**, 0 |
| robust long: games below $0 wk 24–52, of 360 | three friends | 248 | 209 | **2** |
| | all average | 115 | 80 | **0** |
| long 52 wk × 30: games below $0 wk 24–52; rentable at 52 | three friends | 17–18/30; 0/7 | — | **0/30; 6/7** (revenue 80% of budget wk 40–52) |
| | all average | 8/30; 0/7 | — | **0/30; 7/7** (93%) |

Solo, absent and nobody stay at tier 1 in every seed (standard, long and 64 weeks, both goals). The naive analyst never reaches tier 4 (top tier 3), so its renovation policy only plays in tests.

**The G0 table** (`balance.ts long64`, 64 weeks × 30 seeds, weeks 24–64 judged; medians unless noted):

| Team | Build | games < $0 | weeks < $0 (med) | dead weeks (med) | receiverships | house @39/52/64 | credits by 52: streak / quarter (med week) |
|---|---|---|---|---|---|---|---|
| three friends | e810cc5 | 28/30 | 404 (14) | 537 (18) | 28/30 | 22/4/3 | 0/30 / — |
| three friends | **G0** | **0/30** | 0 (0) | 3 (0) | **0/30** | **71/63/59** | 0/30 / **25/30 (wk 36)** |
| all average | e810cc5 | 17/30 | 153 (1) | 209 (5) | 14/30 | 46/9/3 | 0/30 / — |
| all average | **G0** | **0/30** | 0 (0) | 0 (0) | **0/30** | **79/74/71** | 0/30 / **30/30 (wk 34)** |

(The two goals play the same weeks: the goal only decides when the credits land. Under `quarter` all good 30/30 at week 29 and mistakes 18/30 at 42; under `streak` all good 24/30 at 39. `balance.ts long` with `goal=quarter`: the credits by week 45 in 80% and 97% of games.) Every G0 line is met by both teams under `quarter`; under `streak` every line but the credits.

**After week 64** (new islands, 91 weeks, three friends): with the 26-week cooldown the houses read 63/59/42/54 at weeks 52/64/78/91, and **7/30 games go below $0 and into receivership in weeks 65–91**; with a 13-week cooldown or none, 66/67/57/62 and **3/30** (a 13-week one never binds: the fin bot waits out the 13-week renovation warranty anyway). All average: 0/30 either way. 15.3 renovations a game with the cooldown, 18.5 without. **Seb's call: the cooldown as asked (26, the default here), or 13** (the same guard against renovating inside a warranty, none of the tail cost).

**Live islands switched to G0** (they played stage 1 as `e810cc5` does, the helper off, until the switch; then this build with its migration; 30 seeds; receiverships entered after the switch by week 64 / 91):

| Switch | three friends, with the migration | without it | all average, with it |
|---|---|---|---|
| week 26 (houses at 66) | **4 / 10** | 12 / 25 | 0 / 0 |
| week 39 (houses at 23; 3 already in trouble) | 20 / 25 | 21 / 27 | 4 / 4 |
| week 52 (houses at 4; 17 already in trouble) | 10 / 15 | 11 / 15 | 8 / 10 |

**This corrects the brief's "3/9, 4/12, 0/9":** those were the synthesis's runs with the helper **on** before the switch (as A0 review round 1 had it), but the live build has had it off since the release gate. With the helper off the live slide starts around week 30, and by week 39 the median three-friends house is at 23: the warranty is dated from the buildings (fair) and mostly run out, and the upgrade fixes the grid, not the houses; renovations are the way back, two at a time. **What it means for Seb: ship stage 2 while live islands are in their 20s** (switched at week 26 the migration cuts three friends' receiverships from 12 to 4 of 30 by week 64). Stronger options for a late switch weren't built (they'd be a gift): a one-time renovation credit, or the builders' warranty restarted at the switch.

**Tests:** `tests/g0.test.ts` (22: the cooldown and its words; the refusals; the case's numbers; the cycle in play: queued and open, closed with no decay, the final on the electrician's list flagged *house closed* and urgent, reopened at 85+ under a 13-week warranty; a code notice doubling as the final; autopilot buys an ordered renovation's materials and never orders one; the fin bot's trigger, warranty, cash, cap, rent order, cooldown and Harbor gate; the naive analyst; `GOAL`'s default, the window's rules on synthetic reports, whole seasons under `quarter` checked week by week against a recomputation, a live doc's Resort weeks counting at once; the migration on the five e810cc5 docs, once, only for engine < 5 at tier 4–5, fair to the week, then ten weeks the same in memory and through JSON; What's new's words; every seat's sheet; nobody wins alone over 64 weeks under either goal; a 64-week guard on seeds 1–10), `tests/warranty.test.ts` (the synthesis's 5), `tests/livedocs.ts` (the migration spelled out by hand for the skew and migrate tests), the skew test at 5. **1029 of 1029 tests** in 59 files.

**Checks:** `npx tsc --noEmit -p .`; `npm run build`; island lab (358 px): beaten 1,390 / 1,392 through the map, beaten-reno 1,385 / 1,388, beaten-storm-night 1,345; pass-and-play e2e on a 390 × 844 phone and at 1280 × 820 (the phone run timed out once under a parallel balance run, and passed on the retry); a scripted 390 × 844 and 360 × 844 play: the analyst renovates Cottage 2 from its sheet and the desk, buys its materials, the builders close it (scaffold, tarp) for weeks 31–32, the permit final lands on the electrician's list week 33, he takes it through the flow to Send, starts it, hands it in, and the house opens at 90 under warranty to week 46 (no horizontal overflow, no console errors but the Manrope 403s).

**Not done here:** the rest of the v5 gate (reverse skew, the rules probe, the online e2e on the emulator); the renovation cooldown's tail and the goal are Seb's calls (above).

#### 2026-09-30: the stage 2 version gate (v5): fixtures from the live stage 1, reverse skew, the rules probe

**Goal:** an open stage 1 client (`e810cc5`, engine 4, doc v4) must never write a stage 2 doc, and every island stage 1 wrote (and every v3 island not opened since the v4 release) must load, render and resolve on this build with nothing lost: cash, orders, the carried streak (`stats.aCarry`), the credits.

**The constants** were already at 5 (G0 bumped them): `ENGINE_VERSION` 5 (engine.ts), `DOC_VERSION` 5 (net/firebase.ts), `firestore.rules` `request.resource.data.v == 5`; `tests/skew.test.ts` pins all three and that no rule still reads 1–4.

**Fixtures written by the live build.** `scripts/fixtures-v4.ts`, extended from G0's, run in a detached worktree of `e810cc5` outside the repo (removed after): it only dispatches moves to `e810cc5`'s reducer and bots. Three sets; all 15 docs reproduce byte for byte from the committed script (G0's five included):
- `g0` (G0's, unchanged): `t2`, `t4`, `t4-mid`, `t5`, `t5-late`.
- `live` (new islands): `early` (tier 1, week 4), `midweek` (the mechanic ended, the analyst not started: an open requisition, two of the electrician's cards waiting), `chain` (tier 3, week 28, a part chain at the fee), `feeder` (the feeder job approved, waiting on its part), `subcharter` (the only guest plane AOG past due on its gear write-up: the sub-charter flies its guests), `rcv` (tier 4, week 37, receivership 3 with the bridge loan, $36,110 left at $3,611 a week).
- `carry` (**a live island that was a v3 doc**): the v3 docs `bd1e1d2` wrote with an A streak, opened on `e810cc5` (its `migrate` stamps `aCarry` and `v4From`) and played on by its bots: `t4-carry` (the Harbor, 8 carried and held), `t5-carry` and `t5-carry-mid` (the Resort, 7 carried, held through an autopilot A: one full-crew A from the credits), `credits` (the credits rolled in week 25 on the carried streak, `aCarry` 7 still on). A fresh `e810cc5` island never has `aCarry` (it's only stamped on a doc an older engine wrote), so this is the only honest way to a v4 doc with one. `t5-harbor-streak` can't give a Resort doc with the carry running: its first week on `e810cc5` is a B.

**Tests** (1,029 → 1,100):
- `skew.test.ts`, a v5 section on all 15: loads and renders as written and as the app shows it (migrated): Home's selectors, the tech panels, the desk (counts, queues, requisitions, money, the receiver, the Harbor sheet), the map's hotspots day and night (every asset has one) and, from each hotspot, every seat's inspect sheet and dialog name; What's new's panels. G0's migration is exactly `tests/livedocs.ts`'s and idempotent. The first move on this build: engine 5, cash, open cash, store credit, loan, receivership, orders, alerts, requisitions, POs, the chain, turns and the streak (`aStreak`, `aCarry`, `v4From`, `creditsWeek`) as they were, `g0From` at tier 4–5 only, `checked`/`flagged` absent. Then the week and ten more resolve here, the same in memory and through JSON: each review starts from the last one's cash, no open order dropped, `g0From` never changes and `migrate` is the identity on every doc this build wrote (G0 ran once), the credits stay rolled, a carried streak ends only on a week below A and takes the carry with it. Per state: the carried streaks read and resolve as on `e810cc5` (held at the Harbor, 8 at the Resort on a full-crew A); **`t5-carry`'s next week here is a full-crew A and rolls the credits in week 26 on the carried streak**; the requisition and both cards approved; the chain runs out; the feeder job plays the feeder scene; the sub-charter flies and is booked; the receiver's loan loses exactly the week's payment. Reverse skew on this build: a doc it writes is engine 5, and the guard `e810cc5` opens with (the same line) refuses a doc one ahead.
- `migrate.test.ts`: **v3 → v5 in one read** for all 16 `bd1e1d2` docs: `v4From`, `aCarry` (= the old streak) and G0's stamp and feed line together, the first write is engine 5 (never a v4 doc on the way), nothing lost, neither step runs again over three resolves. And the 15 v4 docs read with G0 only, keeping what v4 stamped.
- `contract.test.ts` and `inspect.test.ts` run their stage 2 selectors and every sheet × seat (with the hidden-state perturbation) on the v4 docs too.

**Reverse skew for real** (`scripts/reverse-skew.ts`, extended): each fixture (v2, v3, v4: 39) becomes two docs this build wrote: `read` (the first write) and `played` (two resolves by this build's bots with stage 2 on: 28 with a quick check, 9 with a flag, 4 with a renovation, 22 with a warranty). `e810cc5`'s own reducer got every move an open old tab can send (each seat's end of turn, the resolve, a rename, each approval, the requisitions, each ready job's hand-in, each open alert's no-fault-found): **1,471 of 1,471 refused with "saved by a newer version… Reload", every doc untouched**; a control (the same move on an engine-4 doc) goes through. `e810cc5`'s screen selectors read all 78 docs without throwing (an old tab shows a newer doc until `ic:stale` reloads it).

**Checks:** tsc; 1,100 of 1,100 tests in 59 files; `npm run build`; standard balance T0 unchanged (three friends 8/11/16/23, all average 7/12/16/23, 0 weeks below $0; solo, absent and nobody at tier 1); robust misses 61 and 39 of 360, 0 weeks below $0, long column 2 and 0 of 360 (as G0). Pass-and-play e2e on a 390 × 844 phone and at 1280 × 820 (no console errors but the Manrope 403s). Seven v4 docs (`t5-carry`, `credits`, `rcv`, `subcharter`, `t4-carry`, `midweek`, `chain`) opened in the real app for each seat (local store, phone): What's new (the upkeep panel says what the island got: "the grid and the generator at 80 or better, under warranty to week 52"), Home (the credits' fireworks), the desk, the plane, house and grid sheets; no page errors, and nothing written until a move. Online, on an emulator of its own (Firestore 8881, Auth 9881, `firebase-tools@14`): `e2e-online.mjs` passed (four devices; the island doc stored `v` 5, engine 5); `probe-gate.mts` OLD_V=4 NEW_V=5: v:4 permission-denied, v:5 not-found, listing refused ("GATE LIVE"); and `e810cc5`'s own build, served against the same emulator, linking a device to that v5 island: "This island was saved by a newer version of Island Company. Reload the app to keep playing.", the doc byte for byte as before.

**Seen, not changed (stage 1 behaviour, not the gate):** the plane's sheet (and the ops panel's safety call since stage 1) still offers *Ground* on a plane already AOG past due; grounding it changes nothing.

**Deploying stage 2 (not done here):** hosting and rules together, then `probe-gate.mts` OLD_V=4 NEW_V=5 against prod, and "close and reopen the app" to the crew.
