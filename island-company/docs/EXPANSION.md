# The airline network, the free map, and per-trade island interactions: implementation spec

Status: **revised after the critique round.** Three read-only critics (trade realism; game design; architecture) raised 81 points: 3 blockers, 44 majors, 34 minors. Every blocker and major is resolved here; most minors too. What was turned down, and why, is in §17. It covers four packages: A (engine), B (map), C (objects) and D (network desk).

- **Base: `gaps` at `249988a`.** That is the merge of `gap-charter`, `gap-feeder`, `gap-e2e` and `gap-zoom`. It isn't version-bumped yet (ENGINE_VERSION 3).
- **The live build is `bd1e1d2`** (ENGINE_VERSION 3, DOC_VERSION 3, rules `v == 3`).
- **What `gaps` already built.** This spec builds on it and doesn't re-spec it:
  - `soleGuest(s, planeId)`; `alertAog` with no only-guest-plane exception (no "restricted" state anywhere)
  - `subCharterOn(s)`, `subCharterNeed(s, planeId)`, `SUB_FEE` ($270 a flight), spend category `subcharter`, `costs.subCharter`
  - the feeder re-splice scene (`trace` with `job: 'feeder'`)
  - `siteBox(s)`, Home's `view: 'zone' | 'site' | null`, and the builders' hit-test
  - `VITE_FB_FS_PORT` / `VITE_FB_AUTH_PORT`
- **Not yet on `gaps`:** the robust-tail levers (staggered code notices, an alert throttle) and the v4 bump.
- **It ships in three stages, each with its own version bump** (0.5).
- **This document is the contract between the four packages.** Where it names a type, a function, a file or a number, build that. §14.3 has every cross-package symbol with its exact signature.
- **Tune** marks a starting value that the balance run may move. Record the final value in `docs/DECISIONS.md`, section *Airline network*.

**Contents.**
- 0 What the owner asked for, the finding that comes first, the release stages, and where each critique point went
- 1 How it feels, seat by seat
- 2 Data model
- 3 Station content
- 4 How each existing system generalizes
- 5 The map camera
- 6 Interactive objects
- 7 Engine actions
- 8 The week, in order
- 9 Screens and tap counts
- 10 Migration and the version gate
- 11 Balance plan
- 12 Bots and autopilot
- 13 Test plan
- 14 Work split, file ownership and the contract
- 15 Risks and open questions
- 16 Changed direction, with reasons
- 17 Rejected critique
- 18 Decisions the owner should know about

**Who reads what.**
- **A:** all of it.
- **B (the map):** 0, 1, 2.2, 2.5, 3.1–3.2 (what's drawn), 4.2 (UI rows), 5, 6.1, 9.1, 13.2, 14, 16, 17.
- **C (objects):** 0, 1, 2.5, 4.3, 4.6, 4.8, 6, 7 (`check`, `flag`, `trip`, `tag`), 9.2, 13.3, 14, 16, 17.
- **D (the network desk and the techs' outstation screens):** 0, 1, 2, 3, 4, 7, 9.3–9.5, 10.4, 11.3, 12, 13.4, 14, 16, 17.

---

## 0. What the owner asked for

> "the goal of this next part is to build in some expansion with functionality we have already being the backbone for that, so we can expand to running an entire airline with an electrician and have different airport and such and the functinoality will stay the same. i also want to be able to like explore the island by licking around or zooming in, not just to my section, and i want things on the isalnd to be more interactive like the GPU charger is etc. but itneractions are different for each job bc we each care about different things. then once youre done do a full code review and make sure everything runs perfectly and we dont lose where we are now, make sure the game flows properly and is fun for all and you do all tests."

("licking around" = clicking around.)

The A&P, earlier: *"When I get a task / I get a manual / I follow manual / If part is gone or missing or damaged / IPC / If part no exist / I check in previous logged items on airplane / The maintenance logs / And then get engineering approval / To put part on airplane"*, and *"I want it to be real"*.

**Standing asks:**
- everyone integral, nobody gridlocked
- mistakes surface later, not at once
- cross-dependency reports use all three jobs
- the ground power carts are interactive
- snappy and fun on a phone and on a computer

**Open owner calls,** running on their defaults: builders never speed up a tier (and, here, never speed up a station opening either); NPC wages stay as they are.

### 0.1 In one paragraph

Three stages:
1. **Stage 1 fixes the game after the Resort** (A0, 0.3). It doesn't hold today.
2. **Stage 2 is the map and the objects.**
   - The map becomes a free camera.
   - Every object on the island is tappable, and what a tap shows and offers depends on your seat.
   - Each tech gets **one quick check a week** that reads wear that is coming, the way the GPU cart sheet reads a cable. Catch it early and the job is on your list sooner and a tier cheaper (and easier, but a blind job stays blind: review round 1).
   - **Report a problem** sends a crewmate a write-up.
3. **Stage 3 is the airline, after the Resort.** The analyst can open two stations, each a crew project (a job from every seat) plus a capex call:
   - **Tern Cay:** an outstation airstrip on a neighbouring island. Two guest cottages, a 200 A service panel, and a fuel dispenser the station agent runs.
   - **Port Adair Regional:** the mainland hub. A leased hangar bay with its subpanel and a GPU cart; a parts desk (parts that ride the Home–Adair flights come a week sooner); the pilot base; and the lessor's delivery point for leased planes.

**How the airline works:**
- Planes fly **routes**. The analyst leases or buys them, bases each at a route end, and sets fares and round trips.
- Every existing system works on an asset at any station, because the station is a field on the asset.
- **A plane is worked where it overnights** (its base) or where it broke down (AOG).
- **Techs make one trip a week, booked as travel.** Hands-on moves need the trip; paperwork and grounding calls don't.
- **One alert pass per trade covers the whole network, at today's targets.** The network adds no job slots; it spreads them. So a bigger network costs condition, and the analyst sizes it to the crew.

### 0.2 Rules that apply everywhere

1. **A station is context, not a code path.**
   - An asset's station is `asset.st` (absent = home).
   - Every system asks for the station through the helpers in `stations.ts` and otherwise runs unchanged.
   - **Adding an airport later is data:**
     - a `StationDef`
     - a `RouteDef` or two
     - a `SceneLayout` built from the closed set of art kinds (2.2)
     - optionally, its own `SYMPTOMS` and `REPORTS` rows marked `only: [id]`
   - **A building with new art is code** (B's art components). That's the honest limit of "data only".
   - A test proves the rest (13.1, the *ZZ* station): a full job flow for each trade at a station that exists only as data.
2. **Home is byte-identical until the network opens.**
   - An island that never opens a station and never uses a quick check or a flag resolves byte-for-byte as it would on the stage-1 build, given the same moves. A golden test proves it.
   - New fields are written only when first used, never initialized.
   - New random draws use their own streams (`hashSeed(s.seed, 'net', …)`), never the week's `r`.
3. **The trades' time is the scarce resource. One alert pass per trade, over every asset.**
   - Today's pass keeps 5 open alerts per trade from tier 3 (4 before), must-dos jump the queue up to 8 open, and the draw favours worn assets.
   - Once network assets exist, **the same pass covers them**: the same targets and the same weighted draw.
   - The network adds **no** routine slots. More assets means the same weekly work spread thinner, and the cost is condition.
   - The network's must-dos are few and named: a network plane's 100-hr (by block hours, about 0.1 a week per plane), a leased plane's acceptance, a station cottage's code prep, and the critical fix for an asset under 45.
   - The analyst sizes the network knowing that. A load gauge shows it (9.3).
4. **Hands-on work needs the tech there; paperwork doesn't** (4.6).
5. **Stored vs derived.**
   - **Stored:** what is open, the fleet deals, fares and frequencies, this week's and last week's trips, the weekly quick-check and flag stamps, each network plane's acceptance week, and 26 weeks of sparse route and station numbers.
   - **Derived:** everything else (2.7), including where a grounded plane is stuck.
6. **Old docs load and play.**
   - Every new field is optional, and absent means home only.
   - `migrate()` adds nothing.
   - Each stage has its own version bump (10).
7. **No role wins alone. NPCs never do trade work.**
   - A station opens only when all three seats have done their project job.
   - NPCs fly, clean and build.
   - The Tern Cay station agent (a contractor on retainer) fuels planes, handles bags, and opens a breaker or a disconnect when a tech asks by phone. Operating a disconnect is not trade work.
   - The Port Adair authority maintains its terminal and airfield. That's a landlord outside the game.
   - The electrician's hazardous-location work runs under the company's commercial permit, whose master of record is a permit signature, not a worker.
8. **Money decisions show their numbers.** Every network card states its weekly effect and its payback in dollars and weeks, with a P10–P90 band and the assumptions written on the card (3.3–3.5).
9. **Phones first.**
   - 44 px targets, 360–390 px widths, keyboard-aware sheets. Desktop at 1280 px too.
   - The camera never re-renders per frame, and one finger always scrolls the page on the inline map (5.1).

### 0.3 The finding that comes first: the long game after the Resort doesn't hold today

The direction (X3) makes the network "the long game after tier 5". The paper sim says that long game is broken today, and the 26-week balance window hides it. These are scratch probes on `1f92356`: 10 seeds × 52 weeks, the real reducer, scripts in the spec session's scratchpad. No code was committed.

| Team | Games below $0 in weeks 24–52 | Weeks below $0 (of 290) | Dead weeks (revenue < $2,000) | Cash at week 52, median | Credits (8 straight A at tier 5) |
|---|---|---|---|---|---|
| three friends | 10 / 10 | 141 | 214 | −$187,000 | 0 / 10 |
| all average | 10 / 10 | 134 | 211 | −$183,000 | 0 / 10 |
| all good (skill 0.88, 4 jobs/turn, never absent) | 0 / 10 | 0 | 1 | +$416,000 | — |

The game critic reproduced this table independently on `1f92356` and got the same numbers.

**The mechanism** (traced on *all average*, seed 2, and seen on every seed):
- The electrician does about 3 jobs a week. At tier 4–5 he looks after 7 houses, the grid and the generator.
- The upkeep is bigger than that:
  - decay of 5 a week on every untouched asset
  - 2 a booked week per house
  - storms
  - code inspection prep for 7 houses every 8 weeks, in bunches
- House condition slides from about 87 at week 12 to about 60 by week 22, **before** the Resort arrives. That's the median of 10 seeds for both target teams; *all good* holds at 82.
- The grid drifts from 60 to 0 between weeks 20 and 29, while its feeder job sits "ready" for three weeks behind code-prep cards.
- Grid down plus a tired generator means every house is dark and the hangar is capped at one job. The planes rot, revenue is $0 from about week 34, and the island goes into receivership.
- Cash keeps rising until week 28–30 (revenue lags condition), so the standard 26-week table looks healthy.

**Isolation runs** (8 seeds, 52 weeks):

| Crew | Games below $0 | Dead weeks |
|---|---|---|
| skill 0.88 at 4 jobs a turn | 0 | 1 |
| skill 0.88 at 3 jobs a turn | 0 | 45 |
| skill 0.72 at 4 jobs a turn | 2 of 8 | 52 |

The steady state is a throughput knife-edge: it needs about 3.5+ electrician jobs a week at good skill.

**Levers tried so far are too weak:**

| Change | three friends: games below $0 | Dead weeks | Source |
|---|---|---|---|
| after tier 5: decay 3, inspections every 13 weeks, houseWear 1 | 9 / 10 | — | spec probe |
| after tier 5: decay 1, the same | 4 / 10 | — | spec probe |
| after tier 5: decay 0 (the upper bound) | 2 / 10 | — | spec probe |
| **from week 1:** inspections every 13 weeks, houseWear 1, decay 4 | 7 / 10 | 127 | game critic |
| **from week 1:** the same with decay 3 | 2 / 10 | 61 (about 6 a game) | game critic |

- The tier medians didn't move in those runs: tier 4 at week 17, tier 5 at week 23.
- Even while cash holds, three friends grade A in only 34 of 291 tier-5 weeks (12%), and their longest A streak is 5.
- The credits are reached in 0 of 10 and 2 of 10 games. **The long game has no goal a real crew reaches.**

**Consequence for this spec:**
- **Stage 1 is A0, "a Resort that holds"** (11.2). It leads with the grid-first rule and a spiral breaker, the levers the runs above didn't try.
- It has its own 52-week target, T1, which now includes reaching the credits.
- **A0 is time-boxed to one balance pass.** Then Seb gets the numbers and the call.
- The network is built on A0. An airline on an island that sinks by week 35 would make the network look like the cause.

### 0.4 What's in v1 and what waits

| Area | v1 (this build) | Later |
|---|---|---|
| Stations | Tern Cay (outstation), Port Adair Regional (hub); open, drop, mothball, reopen | more airports (data + a layout); selling a station |
| Routes | Home–Tern, Home–Adair, Adair–Tern; fare and round trips a week per route; one route per plane; connecting passengers via home | multi-leg rotations, timetables, codeshare, fare classes |
| Fleet | lease (13-week minimum, deposit, return condition) or buy the three existing models; return or sell; base at a route end; park | new models (a turbine twin), wet lease, heavy checks by an outside MRO, a ferry permit |
| Where work happens | at the plane's base, or where it's stuck; one trip a week per tech, booked as travel; hands-on moves on site | per-station line kits, crew duty-time, basing incentives |
| Stock | one central stockroom; drop-ship to a station at the normal ETA; the parts desk takes a week off POs that ride the Home–Adair flights | per-station inventory and transfers |
| Map | free camera, presets, Explore, a region view, one detailed scene at a time | animated route traffic, a day/night clock per station |
| Objects | every object tappable; per-seat sheets with each seat's own moves; one quick check a week per tech (wear coming, from tier 2); *Report a problem* (from week 3) | checks that can find hidden defects (Seb's call, 18.3); per-object history timelines |

### 0.5 Release stages and versions

The critique's release-shape point: one deploy bundling A0, the objects and the network would be the largest engine change so far, and A0's fix for a live collapse would wait for all of it. So:

| Stage | What ships | Packages | Version |
|---|---|---|---|
| 0 (another track) | `gaps`: the grounded only guest plane and its sub-charter, the feeder scene, the builders' zoom, the online e2e fix, the robust-tail levers | — | **v4** (the `gaps` integrator bumps it) |
| 1 | **A0:** a Resort that holds (11.2) | A | rides in `gaps`' v4 if `gaps` hasn't deployed when A0 is ready; otherwise its own bump. It changes the resolve from tier 4, so an open older client would resolve a week on the old numbers. `gap-charter` set that precedent. |
| 2 | **The map and the objects:** the free camera, the hotspot registry, per-seat inspect sheets, quick checks, *Report a problem*, What's new | A (contract, checks, flags), B1, C | next version (live + 1) |
| 3 | **The airline** | A (network), B2 (station scenes, region), C2 (station objects), D | next version (live + 1) |

- **Every stage is a full release:**
  - the §6.4 checklist (HANDOFF)
  - fixtures from the previous live commit, written by that engine
  - reverse skew with the previous build
  - `docs/handoff/probe-gate.mts` (old `v` → permission-denied, new `v` → not-found)
  - "close and reopen the app" to the crew
- If the owner wants a single release instead, 18.1 says what that trades away.

### 0.6 Where each critique point went

| Theme | Points (lens) | Resolved in |
|---|---|---|
| Quick checks vs pillar 3 | blocker (game), blocker (architecture), tell timing (realism), IR/meter/walkaround scope (realism), Goodhart (game), 3 looks (architecture), X7 tap count (realism) | 6.4: checks read upcoming wear, never `s.defects`; one view, ≤ 3 taps; load-normalized IR; look-alike pools; a wrong call costs a slot |
| The island-ops loophole and home planes on lighter rules | blocker (architecture), `isNet` (game) | 2.1, 3.4: a network plane must fly a route or it's parked; network rules come from where an asset came from; one decay for every plane |
| Additive alert load, load sheets, 100-hr cadence | additive (game), `wb` (realism, architecture), 100-hr (realism, game) | 0.2.3, 4.5: one pass; no `wb` for route planes; 100-hr by block hours |
| Mechanic has no station work; where a plane is | base/AOG (realism), mechanic content (game, architecture), HEAVY non-decision (architecture), `FleetEntry` (architecture) | 4.6: worked at the base or where it's stuck (seeded end); acceptance at the hub; base must be a route end; HEAVY and ferry dropped (17) |
| Which moves need the tech on site | site moves (realism, architecture) | 4.6 `SITE_BOUND` table |
| Trips and the work budget | trips (realism, game, architecture) | 4.6: travel outside `autoSpent`, a free company seat, allowed when broke |
| Hub reports gridlock | hub (realism, game, architecture) | 3.2, 4.1: drawn only after he worked there; the cap only binds his jobs there |
| The only plane at a station | sole (realism), drift from `gaps` (architecture) | 4.3: home only; a station's plane grounds like any |
| Route and station money | P&L (realism), breaks even (game), formula answers (realism), lease (realism), pilots (realism), network effects (realism), fares non-decision (architecture), night (realism) | 3.3, 3.4, 4.10: retuned; maintenance, hull and pilots by the hour in the P&L; frequency-sensitive and ramping demand; peaks bind seats; connecting passengers; day-VFR at Tern |
| The grade and the A bonus | grade (realism, game, architecture) | 8 step 13: contribution, probation, bonus on home revenue |
| Station electrical content and projects | station content (realism), project puzzles (realism), project defects (realism), catalog kinds (architecture), NEC 514 (realism), license scope (realism), panel text (realism) | 3.1, 3.2, 3.7: `kinds`, `syms`, `after`, `panels`; own symptom rows; retitled projects; the electrician's project defect |
| "A new airport is data" | data (architecture), grep guard, ZZ (architecture) | 0.2.1, 2.1, 2.2, 13.1 |
| Mothball | mothball (game, architecture) | 3.5 |
| Absences in the network era | autopilot (game), absences (architecture) | 12.2 loss guard, T4b, T8 |
| A0 too weak, no reachable win | A0 (game) | 0.3, 11.2 |
| Hit-test, scroll trap, perf, Explore, region swap, camera details | (game, architecture) | 5, 6.1 |
| Leased-plane acceptance, registrations, lessor consent, decay rates, parts desk and hazmat, staff cap, due list | (realism, architecture) | 3.4, 4.7, 4.9, 9.4 |
| Contract, file ownership, single-island rows, call sites, test gaps, release shape | (architecture) | 4.2, 13, 14, 0.5 |
| Checks and flags from week 1; flags pick scheduled work; flag load; analyst taps are deep links; network reports | (game, realism, architecture) | 6.3, 6.5, 3.1, 3.2 |

---

## 1. How it feels, seat by seat

### 1.1 The three seats in the network era

| Seat | Stage 2 (any tier) | Stage 3 (the airline, after the Resort) |
|---|---|---|
| Mechanic | **Tap a plane:** its airworthiness, hours to the next 100-hr, MEL placards, open squawks, the logbook, the cart on it. **One walkaround a week** (from tier 2): six zones in one view. Reading fretting dust vs brake dust puts a coming brake job on his list early, and one tier easier. **Tap the generator:** its service. **Tap the hangar:** its power and the hangar reports. | The same on up to 3 more planes. **A plane is worked where it overnights:** its base, home unless its route has no home end. When a route plane goes past due on an airworthiness item it's stuck where it landed, half the time at the far end. That's a trip, with the part carried or drop-shipped. **Every leased plane is delivered to Port Adair** once it's open, so its acceptance (the records review, then the conformity inspection) is a trip there. Port Adair's hangar reports reach him only once he has worked there. |
| Electrician | **Tap a house:** its panel schedule, complaints, code dates, made-safe tags. **One IR scan or meter check a week** (from tier 2). Reading a breaker's temperature rise against its load finds a warm lug before it becomes a dead circuit; reading voltage drop against the run length finds a loose backstab. **Tap the generator:** load, fuel, transfer switch. | Each station's assets join the same alert list. **Tern Cay:** its 200 A panel, the dispenser circuit (NEC 514) and two cottages. **Port Adair:** the bay subpanel (cart chargers, GFCI tool receptacles, bay lights: NEC 513) and the hub's hangar reports. One trip a week covers a station. The dispenser feeder he runs for the opening can carry his own hidden defect. |
| Analyst | **Tap anything:** its money. Revenue, repair spend, occupancy, payback, rates, staff, the stock tied to it. **Inline moves:** approve that asset's pending card, step the nightly rate on a house, hire from a staff figure. | A **Network** desk tab: open or drop a station (capex and a payback band on the card); lease or buy (lease vs buy on the card); assign and base; fares and round trips per route; P&L per station and route; a load gauge per trade; mothball and reopen; hiring per station. |

### 1.2 A season after the Resort, week by week (three friends, good play, stage 3)

| Week | What happens |
|---|---|
| 22–23 | The Resort arrives. The Network tab shows a locked card: "After the Resort settles (2 weeks): open Tern Cay." |
| 25 | The analyst opens Tern Cay (3 taps). The card: *"$12,000 now (all of it back if you drop the project) + a crew project. With a leased twin on Home–Tern at 2 round trips a week: about +$1,440 a week once the route matures (P10–P90 +$1,260 to +$1,440), pays back about 11 weeks after opening if the twin is leased now."* $12,000 leaves the bank. The same week the analyst leases the twin: Home–Tern, based at home, 2 round trips, $90. The lease card: *"$500 a week + a $2,000 refundable deposit. Port Adair isn't open, so it's delivered at home next week and flies the week after it's accepted."* |
| 25–26 | **The three project jobs:** the mechanic picks the Tern Cay fly-away kit from the IPC by effectivity (`ipc`). The electrician flies over (the trip is in the capex) and runs the dispenser feeder in 3/4 in RMC with an EYS seal at the first fitting out of grade and a disconnect that opens every conductor, the neutral included (`conduit`, RMC). The analyst forecasts 4 weeks of cash through the capex draw. In week 26 the twin is delivered, and the mechanic has two must-dos on it: *Acceptance: records review* (the `logbook` puzzle on this plane's own records: ADs, life-limited parts, the equipment list, W&B) and *Acceptance: conformity inspection* (`inspect100`). He signs both. Tern Cay opens at week 26's resolve. |
| 27 | The first Tern guests arrive. At home, the electrician's IR scan of the island grid: the cottage-feeder breaker at 55% load reads 19 °C over ambient, where a breaker at that load should run about 6 °C. The hangar breaker beside it reads 17 °C at 92% load, which is normal for its load. He calls the feeder breaker: *"Diagnose a dead circuit at the panel"* is on his list now, one tier easier. |
| 29 | Alert: *"Guest at Tern Cay Cottage A: kitchen outlets dead."* He books the week's trip (2 taps: a seat on our own Home–Tern flight, $60 per diem, booked as travel, not his work budget). He fixes the GFCI there with parts from the stockroom he carries, and meter-checks Cottage B: all normal. |
| 30 | The mechanic's walkaround of the leased twin, all six zones in one view: "brake dust on the wheel faces" at the L main (normal), "the tread at the wear bars on the outboard shoulder" at the R main. He calls the R main: the tire job is on his list, one tier easier. |
| 33 | Home–Tern at 2 round trips is full: 12 of 12 sellable seat-legs after the guest parties' 8. $1,080 in fares; the cottages bring $2,480. The load gauge for the electrician: *"14 assets · condition −1.1 a week (4 weeks) · 3.1 jobs a week done"*. The analyst waits 3 weeks on Port Adair. |
| 34–36 | Port Adair's project ($15,000, paid when it starts): the mechanic penetrant-checks the leased jacks' lifting pads and the tow bar, the electrician wires the bay subpanel, the analyst three-way matches the fit-out invoices. It opens at week 36's resolve. |
| 37 | The twin the analyst leased in week 36 for Home–Adair at 5 round trips is delivered **to Port Adair**, the lessor's delivery point now that it's open. The mechanic flies there for its acceptance (the trip) and signs it. It flies from week 38: once the route matures, 46 passengers for 50 seats mid-season; about 75% of that while the route ramps up. |
| 38 | The analyst moves Home–Tern to 3 round trips. The trunk's 4 spare seats now carry Adair–Tern passengers connecting at home: about +$550 a week. |
| 39 | Hub report: *"Adair bay: two light fixtures out."* The mechanic worked there in week 37. It caps his jobs **at Adair** at 2 until the electrician's next Adair trip. His home work isn't touched. |
| 41 | Peak season: trunk demand is 58 for 50 seats, so the connecting passengers are bumped. The analyst raises the fare 10% to $165: 50 passengers, +$750 a week. The card shows that a second trunk twin would still lose about $1,770 a week at peak. |
| 43 | The mechanic missed a week. The Home–Tern twin's airworthiness item goes past due, and the seeded end says it's stuck **at Tern Cay**. Tern's cottages get no guests that week, about −$2,480; the card had warned *"one plane: an AOG week empties the cottages."* The mechanic books the Tern trip, and the part rides the next company flight. |
| 44 | Tern Cay has paid back (week 37). Port Adair is about a third of the way (it pays back around week 49). The crew board argues about opening Adair–Tern. The card: it would earn about +$24 a week itself and take about $640 of connecting fares off the two home legs: **net about −$600 a week.** |

---

## 2. Data model

### 2.1 Code: the station catalog (`src/sim/stations.ts`, new, A)

```ts
import type { PuzzleId } from '../puzzles/types';
import type { NpcRole, Role } from './types';

export type StationId = string; // 'home' is implicit; catalog ids: 'tern', 'adair'
export type RouteId = string; // 'home-tern', 'home-adair', 'adair-tern'
export type PlaneModelId = 'twin' | 'cargo' | 'float';

export interface Breaker {
  name: string; // 'Dispenser'
  amps: number; // 20
  awg: string; // '12 AWG Cu'
  /** its typical load at the week's mid, A (the IR scan's reading is derived from it) */
  loadA: number;
}

export interface ProjectJob {
  title: string;
  puzzle: PuzzleId;
  /** passed to the puzzle as PuzzleParams.variant (e.g. conduit 'rmc', panel 'bay') */
  variant?: string;
  /** the job is done at the station: that tech's trip that week (its cost is in the capex) */
  site?: boolean;
  /** the station asset this job builds: its score rolls a hidden defect there at opening */
  builds?: string;
}

export interface StationDef {
  id: StationId;
  /** 'Tern Cay' */
  name: string;
  /** a fictional three-letter code, for route labels: 'TRN' */
  code: string;
  kind: 'outstation' | 'hub';
  /** hangar: its hangar reports can be drawn; chargers: carts here charge; partsDesk: 4.7; delivery: the lessor delivers leased planes here while it's open */
  caps: { hangar: boolean; chargers: boolean; partsDesk?: boolean; delivery?: boolean };
  /** capex is paid when the project starts (openStation) and refunded in full by dropStation */
  open: { capex: number; project: { title: string; jobs: Record<Role, ProjectJob> } };
  /** USD a week while open (× NET.mothball while mothballed) */
  overhead: number;
  /** its contribution budget in the board grade (USD a week), from its NET.probation + 1th open week */
  budget: number;
  /** health an untouched asset of this station loses a week; absent: home's rule (ECON.decay, with A0) */
  decay?: number;
  /** its houses' nightly rate, × the island's (a quieter island rents for less) */
  rateX?: number;
  /** runway lights: false = day VFR only (14 CFR 135.229(b)): a route with an unlit end flies at most ECON.flightsPerPlane round trips a week */
  night: boolean;
  /** what opening adds: asset ids are unique across the catalog, prefixed by the station id */
  adds: { id: string; model: string; name: string }[];
  gse?: { id: string; name: string }[];
  /** stores bins added while open */
  bins?: number;
  /** the catalog kinds its assets can raise, by model. For a station asset this replaces CATALOG[].targets: a kind listed here needn't target the model at home. `title` overrides the catalog title there. */
  kinds: Partial<Record<string, { kind: string; title?: string }[]>>;
  /** the SYMPTOMS keys its assets can raise: home rows it reuses, plus its own rows (marked `only: [id]`) */
  syms: string[];
  /** a catalog kind blocked for N weeks after opening (the new dispenser feeder doesn't fail its insulation test at once) */
  after?: Record<string, number>;
  /** the IR scan's breaker schedule, per asset id */
  panels: Record<string, Breaker[]>;
  /** the standard staff hired at skill 3 when it opens (shown on the opening card; they skip STAFF.maxStaff) */
  staff?: Partial<Record<NpcRole, number>>;
  /** rooms it adds to STAFF.maxStaff while open */
  staffRoom: number;
  /** USD a trip costs in cash on top of the seat: the per diem, or a hotel */
  perDiem: number;
}

export interface RouteDef {
  id: RouteId;
  a: StationId;
  b: StationId;
  nm: number;
  /** block hours one way for the twin (the other models: × PLANE_OPS.blockX) */
  block: number;
  /** the reference fare, USD one way per seat */
  fare: number;
  /** passengers a week, both ways together (seat-legs), at the reference fare, mature, full frequency, mid-season */
  demand: number;
  /** its seasonal swing; absent: ECON.seasonAmp (0.12) */
  amp?: number;
  /** landing, parking and handling, USD per round trip */
  fees: number;
  /** USD per round trip a cargo plane earns on the route's freight contract */
  cargo: number;
}

export const STATIONS: Record<StationId, StationDef>; // 3.1, 3.2
export const ROUTES: Record<RouteId, RouteDef>; // 3.3
/** test-only: adds a station and its routes, clears every lookup this module memoizes, and returns the undo */
export function registerStation(def: StationDef, routes: RouteDef[]): () => void;
```

**Plane operating data and the network's constants** (same file; all **tune**):

```ts
export const PLANE_OPS: Record<PlaneModelId, { seats: number; fuelPerH: number; blockX: number; lease: number; price: number; word: string }> = {
  twin: { seats: 5, fuelPerH: 200, blockX: 1, lease: 500, price: 150000, word: 'Twin' },
  float: { seats: 4, fuelPerH: 110, blockX: 1.2, lease: 400, price: 115000, word: 'Float' },
  cargo: { seats: 0, fuelPerH: 260, blockX: 0.9, lease: 650, price: 195000, word: 'Cargo' },
};

export const NET = {
  minTier: 5,
  /** weeks after the Resort arrives before the first station can open */
  settle: 2,
  /** no network spend (open, lease deposit, buy) may leave spendable cash under this */
  floor: 25000,
  maxNetPlanes: 3,
  /** demand(fare) ∝ 1 / (1 + e^((fare − mid × ref) / (s × ref))); fares within min–max × ref */
  fare: { mid: 1.2, s: 0.3, min: 0.5, max: 2 },
  /** frequency drives share: demand × (base + slope × min(1, round trips on the route / full)) */
  freq: { base: 0.6, slope: 0.4, full: 5 },
  /** a new route: from × mature demand, rising to 1 over its first `weeks` flown weeks; its mature level is seeded ±mature */
  ramp: { from: 0.5, weeks: 8, mature: 0.2 },
  /** share of an unflown point-to-point route's demand that connects at home when both its legs fly */
  connect: 0.5,
  tripsPerWeek: 1,
  /** an air taxi (no company flight to ride this week): USD per nm, round trip */
  airTaxiPerNm: 4,
  leaseMinWeeks: 13,
  /** weeks of lease charged for a return before the minimum */
  leaseEarly: 4,
  /** weeks of lease held as a refundable security deposit */
  deposit: 4,
  /** a lease returned under 85 health: USD per point below (the return-condition true-up) */
  trueUp: 300,
  /** resale: share of the price on the day, less this a week, never under the floor */
  resale: { day: 0.92, perWeek: 0.001, floor: 0.55 },
  /** cost of cash tied up, a year (on the lease-vs-buy card; never charged) */
  capital: 0.08,
  /** hull insurance a year, as a share of the plane's price, on every network plane (a dry lessee insures) */
  hull: 0.015,
  /** USD a week of parts and labour the cards assume per network plane until the fleet has 8 weeks of its own (ledger.as) */
  mxCard: 150,
  mothball: 0.3,
  newPlane: { health: 85 },
  /** the station project's order tier */
  projectTier: 4,
  /** a new station's weeks out of the board grade */
  probation: 4,
  /** a network plane counts in the flights grade from this many weeks after its acceptance */
  flightsGrace: 2,
  /** route flying adds block hours × this to sinceInspection (12 flights = 100 h at home) */
  inspPerH: 0.12,
  /** a pilot's 6 flights of duty ≈ 12 h: route flying spends duty by block hours at this many hours a flight */
  hPerDutyFlight: 2,
  /** the analyst's autopilot loss guard (12.2) */
  guard: { missed: 2, weeks: 4, stationLoss: -1000, leaseLoss: -500 },
};
```

`HEAVY` is gone (17: every v1 route has a hangar end, so it never bites).

**Helpers** (pure; same file). Every system calls these and nothing else to learn a station. §14.3 has the exact signatures.

| Helper | Meaning |
|---|---|
| `stOf(a)` | `a.st ?? 'home'` |
| `isNetPlane(a)` | a fleet plane (`/^f\d+$/`). Network rules (acceptance, block-hour inspections, route-only flying) come from **where an asset came from**, never from `st` or `rt`. The home tier planes p1–p3 are never network planes, whatever they fly. |
| `isStationAsset(a)` | not a plane, with `st` set |
| `stationDef(id)`, `stationState(s, id)`, `isOpen(s, id)`, `isMothballed(s, id)` | the catalog entry; `s.net` state; `'home'` is always open |
| `routesOpen(s)` | both ends open (not mothballed) |
| `routeFare(s, r)`, `routeFreq(s, r)` | `s.net.fares[r] ?? ROUTES[r].fare`; round trips a week per plane (`s.net.freq[r]`, absent: all it can fly) |
| `opsPlanes(s)` | home's island-ops planes: home tier planes with no `rt` (today's guest flights and tours) |
| `planesAt(s, st)`, `housesAt(s, st)`, `assetsAt(s, st)` | by `stOf` |
| `deliveryStation(s)` | the open station with `caps.delivery` (Port Adair), else home |
| `aogAt(s, p)` | where a grounded plane is stuck. A route plane grounded by an alert: `rng(hashSeed(alert.seed, 'at')).pick([route.a, route.b])`. Anything else (a tag, a chain AOG, no route): its base. Derived, never stored. |
| `workStations(s, a)` | where work on it can be done. A fixed asset: `[stOf(a)]`. A network plane not yet accepted: `[deliveryStation(s)]`. A grounded plane: `[aogAt(s, a)]`. Otherwise its base: `[stOf(a)]`, where it overnights. |
| `siteOfOrder(s, o)` | the station an order's hands-on work is at: `o.report?.st`; else a project job's station if `site`; else the asset's `workStations[0]`; else home |
| `tripOf(s, role, week = s.week)`, `onSite(s, role, st)` | this week's trip; `st === 'home' \|\| tripOf(s, role)?.st === st` |
| `tripCost(s, st)` | `{ usd, how: 'seat' \| 'taxi', route? }`: a free seat on a company flight into `st` this week plus the per diem, or the air taxi (`airTaxiPerNm × nm × 2`) plus the per diem |
| `SITE_BOUND`, `siteBlock(s, role, action)` | the hands-on moves (4.6), and the words that refuse one off site ("At Tern Cay: book the trip ($60)"), or null |

### 2.2 Code: scene layouts (`src/ui/map/layouts.ts`, new, B)

Geometry is UI data, so the sim catalog has none.

```ts
import type { Box, Pt } from '../island/geo';
import type { Role } from '../../sim/types';
import type { StationId } from '../../sim/stations';

/** the closed set of art kinds B builds once; a new airport's layout picks from these */
export type PropKind = 'palms' | 'rocks' | 'drums' | 'bowser' | 'sock' | 'dispenser' | 'estop' | 'shed' | 'gate' | 'counter' | 'handhole' | 'floodlight';

export interface SceneLayout {
  id: StationId;
  /** the viewBox (home: 800 × 600) */
  w: number;
  h: number;
  /** feet per map unit (the E-stop post is placed to scale) */
  ftPerUnit: number;
  /** a station's own terrain: the coast (clockwise), beach widths, a hill; home keeps its bespoke Terrain */
  coast?: Pt[];
  beach?: number[];
  hill?: Pt[];
  runway: { a: Pt; b: Pt; w: number; lit: boolean };
  apron: Pt[];
  /** front-centre ground points; a fixture kind absent here isn't drawn or tappable */
  fixtures: Partial<Record<'hangar' | 'terminal' | 'fuel' | 'estop' | 'windsock' | 'dock' | 'office', Pt>>;
  /** each station asset's front-centre ground point, by asset id */
  pos: Record<string, Pt>;
  /** plane stands in order; `water` stands take floats. Based planes take them in fleet order (home: the stands after p1–p3's) */
  stands: { at: Pt; water?: boolean }[];
  /** where a plane stuck here stands (by stand index) */
  aog?: Pt[];
  /** cart parking and the charger outlets */
  carts: { home: Pt[]; outlet: Pt[] };
  /** feeds: an overhead pole line, or an underground run with hand holes, from the panel to asset ids */
  feeds?: { kind: 'pole' | 'underground'; path: Pt[]; to: string[] }[];
  /** "my zone" per seat at this station */
  focus: Partial<Record<Role, Box>>;
  /** on the region map (1000 × 700): the pin, and the island's outline there */
  region: { at: Pt; shape: Pt[] };
  props?: { kind: PropKind; at: Pt[] }[];
}

export const LAYOUTS: Record<StationId, SceneLayout>; // 'home' (from geo.tsx's constants), 'tern', 'adair'
export const REGION = { w: 1000, h: 700 };
```

### 2.3 What is data, and what is code

- **Data** (a new airport needs only these):
  - `STATIONS`, `ROUTES`, `PLANE_OPS`, `NET` (`stations.ts`)
  - `LAYOUTS` (`layouts.ts`)
  - station-only `SYMPTOMS` rows (`only: [id]`) and `REPORTS` rows (`only: [id]`)
  - the station's `kinds`, `syms`, `after` and `panels`
- **Code:** the art. A building whose shape isn't in `PropKind` or the existing components (`Hangar`, `Cottage`, `Substation`, `Plane`, `GpuCart`, `NpcFigure`) is a B change. §0.2.1 says so.
- **The asset models are reused:** Tern Cay's panel is a `panel` and its cottages are `cottage`s; Port Adair's bay subpanel is a `panel`. What each station's assets can raise is its own allow-list (`kinds`, `syms`), because home's distribution symptoms don't fit a 200 A cay or a leased bay subpanel (3.1, 3.2). Home is untouched: home assets keep `CATALOG[].targets` and every home `SYMPTOMS` row, and a home asset never draws an `only` row.
- **`words` and `stationWords` are gone.** A station's text comes from its own rows, not string substitution over home's text.
- **New data rows:**
  - CATALOG `accept` (the acceptance records review, 3.4)
  - CATALOG entries get an explicit `wearFrom?: number`, the health below which the kind's weight is non-zero (today it's inside the `below()` closure). The checks read it (6.4).
  - the station SYMPTOMS rows (3.1, 3.2)
  - `m?: true` on SYMPTOMS MEL items that have a maintenance (M) procedure (4.6)
  - `hazmat?: true` on items (4.7)
  - the station REPORTS rows (3.1, 3.2)

### 2.4 Stored: the new state fields (`src/sim/types.ts`, A)

Every field is optional. Absent means home only, as today.

```ts
export interface Asset {
  // …today's fields…
  /** its station (a station's buildings), or a network plane's base. Home tier assets never get one */
  st?: StationId;
  /** a plane's route. A network plane with none is parked. A home tier plane may fly a route with a home end, and stays based at home */
  rt?: RouteId;
  /** week of its last assign (one a week) */
  moved?: number;
  /** week its base last changed (that week it flies one round trip fewer: the positioning leg) */
  movedBase?: number;
  /** network planes: the week its acceptance was signed off. Absent: not accepted, so it doesn't fly */
  accepted?: number;
}

export interface GseCart {
  /** the station it lives at; absent: home */
  st?: StationId;
}
export interface Npc {
  /** a housekeeper's station; absent: home. Pilots are one network-wide pool (no st) */
  st?: StationId;
}
export interface Candidate {
  st?: StationId;
}
export interface ReportInfo {
  /** the station of the reporter's trouble (a hub hangar row, a station-only row); absent: home */
  st?: StationId;
}
export interface Alert {
  /** found early by a quick check: its job plays one order tier easier (never under 1) */
  early?: true;
}
export type AlertSrc = /* today's */ | 'check' | 'flag';

export interface StationState {
  id: StationId;
  state: 'project' | 'open' | 'mothballed';
  /** the week it entered its state */
  since: number;
  /** the week it first opened */
  opened?: number;
}

/** the deal only; after delivery the asset carries base and route */
export interface FleetEntry {
  /** the plane, once delivered ('f<n>') */
  asset?: string;
  model: PlaneModelId;
  how: 'lease' | 'buy';
  /** week of the deal; the plane joins at the next week's open */
  week: number;
  /** lease: USD a week; buy: the price paid */
  usd: number;
  /** until delivery: where it will be based and what it will fly; deleted at delivery */
  pending?: { base: StationId; route?: RouteId };
}

export interface Trip {
  role: OpsRole;
  st: StationId;
  week: number;
  /** cash paid: the per diem, plus the air taxi when no company flight served */
  usd: number;
  how: 'seat' | 'taxi' | 'project';
}

export interface NetState {
  stations: StationState[];
  fleet: FleetEntry[];
  /** USD one way per seat; absent: the route's reference fare */
  fares?: Record<RouteId, number>;
  /** round trips a week per plane on the route; absent: all it can fly */
  freq?: Record<RouteId, number>;
  /** this week's and last week's trips (pruned at week open to W − 1 … W) */
  trips?: Trip[];
}

export interface IslandState {
  // …today's fields…
  /** the airline network (docs/EXPANSION.md). Absent: home only */
  net?: NetState;
  /** week of each tech's last quick check (one a week) */
  checked?: Partial<Record<OpsRole, number>>;
  /** week of each seat's last flag (one a week) */
  flagged?: Partial<Record<Role, number>>;
  /** a station's crew project carries its station */
  project?: { tier: number; title: string; orders: Partial<Record<Role, string>>; st?: StationId } | null;
}

export interface WeekLedger {
  // …today's fields…
  /** per route: [round trips, pax (seat-legs), seat-legs, revenue, direct cost (fuel + fees), plane cost (lease + hull + pilot share + parts and labour)] */
  rt?: Record<RouteId, [number, number, number, number, number, number]>;
  /** per station: [revenue (its rentals), cost (overhead + its assets' parts and labour + housekeepers), travel to it] */
  stn?: Record<StationId, [number, number, number]>;
}

export interface WeekReport {
  costs: {
    // …today's fields…
    /** station overhead, leases, hull, route fuel and fees */
    network?: number;
  };
  /** of `revenue`: fares, freight contracts and station rentals */
  netRevenue?: number;
  /** the network's contribution this week (routes + stations + parked planes), the grade's input */
  netContribution?: number;
}

export type SpendCat = /* today's, with 'subcharter' */ | 'fuel' | 'fees' | 'lease' | 'hull' | 'travel' | 'capex';
```

- **`WEEK_BOUND` additions:** `'openStation'`, `'dropStation'`, `'mothball'`, `'fleet'`, `'fleetEnd'`, `'assign'`, `'trip'`, `'check'`, `'flag'`.
- `setRoute` is not week-bound, like `setRates`: it applies at the next resolve.
- `NetState.commit` is gone: the capex is paid when the project starts.

### 2.5 UI contract: object references (`src/ui/objects.ts`, new, A)

This is the only contract B and C share: B's map emits refs and C's sheets consume them.

```ts
export type ObjectKind =
  | 'plane' | 'house' | 'grid' | 'generator' // assets (id = asset id)
  | 'hangar' | 'office' | 'runway' | 'fuel' | 'estop' | 'dock' | 'windsock' | 'terminal' // fixtures (id = kind)
  | 'cart' // id = cart id (the GSE sheet, unchanged)
  | 'staff' // id = npc id
  | 'site' // id = build id, or 'project' (gap-zoom's builders' hit-test folds in here)
  | 'station' | 'route'; // region map (id = station / route id)
export type ObjectRef = { kind: ObjectKind; id: string; st: StationId };
export const OBJECT_LABEL: Record<ObjectKind, string>;
/** the seat whose work an asset is: planes 'mech'; houses, grids and panels 'elec'; the generator 'both' (the engine and its mounts are the mechanic's, the transfer switch the electrician's) */
export function ownerOf(a: Asset): OpsRole | 'both';
```

`DockTarget` (select.ts) gains `{ desk: 'network'; plane?: string; station?: StationId; route?: RouteId }` and `{ object: ObjectRef }`. `openTarget` routes them, so C can send the analyst to D's desk without importing D.

### 2.6 Defaults for old docs

| Field | Absent means | Written when |
|---|---|---|
| `s.net` | no stations, no network planes, no trips | the first `openStation` |
| `asset.st` | home | a station's assets on opening; a network plane on delivery |
| `asset.rt` | island ops (home tier planes) or parked (network planes) | `assign`, or delivery with a route |
| `asset.moved`, `asset.movedBase` | never moved | `assign` |
| `asset.accepted` | not accepted (network planes); not used (home planes) | the acceptance's last sign-off |
| `alert.early` | a normal alert | a quick check's right call |
| `cart.st`, `npc.st`, `cand.st`, `report.st` | home | a station's carts and staff; the station's board and reports |
| `s.checked`, `s.flagged` | never used | the first `check` / `flag` |
| `project.st` | a tier project | `openStation` |
| `ledger.rt`, `ledger.stn` | nothing flown or open | a resolve with the network open |
| `report.costs.network`, `report.netRevenue`, `report.netContribution` | 0 | a resolve with the network open |

### 2.7 Stored vs derived

| Stored (in the island doc) | Derived (code, never stored) |
|---|---|
| `s.net.stations` (id, state, weeks), `s.net.fleet` (the deals) | station definitions, route definitions, plane operating data, the layouts |
| `asset.st`, `rt`, `moved`, `movedBase`, `accepted`; the station assets and network planes themselves (assets like any other) | where a plane is worked, where a grounded plane is stuck (`aogAt`), whether a tech is on site, trip prices, the delivery station |
| `s.net.fares`, `s.net.freq` | demand (with ramp, maturity, frequency and season), load factor, cost per seat, previews, payback bands, lease vs buy |
| `s.net.trips` (two weeks) | "where the part is", the load gauge, the due list |
| `s.checked`, `s.flagged` (a week number each); `alert.early` | what a quick check shows (from the asset's wear, the catalog, the seed and the week: never `s.defects`) |
| `ledger.rt` / `ledger.stn` (26 weeks, sparse), `report.costs.network`, `report.netRevenue`, `report.netContribution` | P&L per station and route over any window, a route's ramp (flown weeks in `ledger.rt`), the region map's badges |
| each network plane's identity: nothing (the island seed + the asset id + model, as `islandAircraft` does today) | registration, S/N, logbooks, IPC, alteration and its holder |

### 2.8 Doc-size budget

- **Today:** a 52-week *three friends* game peaks at 114 KB (the history is 69 KB of it); *all good* peaks at 101 KB. `tests/docsize.test.ts` caps it at 150 KB.
- **The network may add at most 18 KB at week 52:**

| Item | Size |
|---|---|
| `s.net` (stations, fleet deals, fares, freq, up to 4 trips) | 0.7 KB |
| station assets | ~4 × 110 B |
| network planes (with `st`, `rt`, `moved`, `movedBase`, `accepted`) | ~3 × 160 B |
| carts | 2 × 100 B |
| `ledger.rt/stn` | 26 × ~170 B = 4.4 KB |
| network review lines (at most 2 per week: one "Network:" summary line, one exception line) | 26 × 2 × 110 B = 5.7 KB |
| extra alerts and orders (acceptance, station work, check write-ups) | about +4 KB |
| `s.checked`, `s.flagged`, `alert.early` | < 0.2 KB |

- **Test (T6):** a 52-week network-era game under both the good and the naive network bots (the naive one opens the most state; the maximum counts) stays under 150 KB, and its network fields under 18 KB (13.1).

---

## 3. Station content

The numbers are game money, scaled like the rest of the game (a skill-3 pilot costs $320 a week today; see 18.10). Names are fictional. The realism notes are in 3.7.

### 3.1 Tern Cay (`tern`, TRN): the outstation airstrip

A small neighbouring island, 38 nm from home. The company owns everything on it.

| Field | Value |
|---|---|
| kind / caps | outstation; no hangar; chargers (the cart charges at the fuel shed); no delivery |
| night | **false:** no runway lights, so day VFR only (14 CFR 135.229(b)); routes into it fly at most `ECON.flightsPerPlane` (4) round trips a plane a week; the card says "day VFR only" |
| capex / overhead | **$12,000** (the dispenser and its feeder, the cottages' fit-out, a GPU cart, the shed). **$650 a week:** ground lease $200, utilities $150, property insurance $120, the station agent's retainer $180. The agent is a contractor: attended fueling, bags, and opening a breaker or a disconnect when a tech asks. |
| budget / decay / rateX | contribution budget $600 a week; home's decay rule; 0.8 (a quieter island rents for less) |
| adds | `tern-panel` Tern Cay service panel (`panel`); `tern-c1` Tern Cay Cottage A (`cottage`); `tern-c2` Tern Cay Cottage B (`cottage`) |
| gse | `tern-gpu` Tern Cay GPU cart |
| kinds | `panel`: `xfmr` (*"Diagnose a dead circuit at the Tern panel"*), `feeder` (*"Find and re-splice a cottage feeder"*: the cottages are fed underground from the panel, drawn with hand holes, so `gap-feeder`'s scene fits as is), `dockrun` (*"Re-seal and re-pull the dispenser feeder"*), `panelUp` (*"Upgrade the 200 A service"*). `cottage`: every home house kind except `hottub` (no hot tubs). |
| syms | own rows (below), plus home's `E_DEAD_CIRCUIT` and every home house row except the spa rows. **Not** `E_FEEDER_DROP` (east cottages), `E_PANEL_LOAD` (a 400 A bus), `E_UTIL_SAG` (phase B: this is a 120/240 V single-phase service), `E_TAKEOFF_DOCK` (the run is new) or `E_DOCK_TRIP` (the fuel dock's pumps). |
| after | `dockrun`: 26 weeks (the new RMC run doesn't fail its insulation test for half a year) |
| panels | `tern-panel`: Main 200 A (3/0 Cu); Cottage A feeder 60 A (6 AWG); Cottage B feeder 60 A (6 AWG); Dispenser 20 A 2-pole (12 AWG; the remote disconnect opens every conductor, 514.11); Shed and counter 20 A (12 AWG); Cart charger 20 A (12 AWG); Apron floodlight 15 A (14 AWG) |
| staff | 1 housekeeper; staffRoom 2 |
| perDiem | $60 |
| the scene | a 1,900 ft strip along the lagoon with no edge lights; a small apron with two stands; the fuel shed with the dispenser; the E-stop post 50 ft from the dispenser, to scale; the two cottages on the beach, fed underground (hand holes drawn); the windsock at the threshold |

**Tern Cay's own SYMPTOMS rows** (`only: ['tern']`, A):

| Key | Text | Causes |
|---|---|---|
| `E_TERN_FEEDER` | "A cottage feeder dropped out twice last night; its breaker at the panel held." | `feeder` 3 (*"Insulation 0.4 MΩ at a buried splice by the second hand hole"*, needs a splice kit, site 60 A 6 AWG buried); `xfmr` 1 (*"The feeder breaker's lug loose and discoloured"*) |
| `E_TERN_LOAD` | "The Tern Cay service peaked at 176 A of its 200 A: plan the upgrade." | `panelUp` 1 |
| `E_DISP_TRIP` | "The dispenser pump trips its ground-fault protection at start-up." | `dockrun` 2 (*"Water in the dispenser's junction box above the seal; 0.5 MΩ to ground"*); `xfmr` 1 (*"The dispenser breaker's lug loose"*); NFF 1 (*"Rain in the pump motor's box; dried and resealed; the run tests fine"*) |
| `E_DISP_ESTOP` | "The station agent says the emergency shutoff didn't stop the pump on its monthly test." | `xfmr` 1 (*"The E-stop's contact welded in its enclosure; the shunt-trip circuit open"*), hazard |

**Tern Cay's REPORTS row** (`only: ['tern']`): *"The Tern Cay power bill runs about $90 a week over the meter's own reading."* The electrician reports it (he read the meter on a trip). The analyst fixes it with the `variance` puzzle. Effect: a leak of $90 a week until it's fixed. It's drawn only in a week after an electrician's trip there.

**Crew project:** *Open Tern Cay.*

| Seat | Job | Puzzle | Where |
|---|---|---|---|
| mech | "Tern Cay fly-away kit: pick the outstation spares from the IPC by effectivity" | `ipc` | home (paperwork) |
| elec | "Dispenser feeder in 3/4 in RMC: an EYS seal at the first fitting out of grade (514.9), a disconnect that opens every conductor including the neutral (514.11), the E-stop at 50 ft. Under the company's commercial permit (master of record)." | `conduit`, variant `rmc` (the stick is 3/4 in RMC with its bender's take-up; the connectors step is the EYS seal) | at Tern (`site`); `builds: 'tern-panel'` |
| fin | "Tern Cay opening: a 4-week cash forecast through the capex draw" | `forecast` | home |

### 3.2 Port Adair Regional (`adair`, ADR): the mainland hub

A regional airport 110 nm from home. The company leases a hangar bay and a ticket counter. The airport authority owns the terminal, the airfield lighting and the fuel farm.

| Field | Value |
|---|---|
| kind / caps | hub; hangar; chargers; parts desk; **delivery** (the lessor delivers leased planes here while it's open) |
| night | true (the authority's lit runway) |
| capex / overhead | **$15,000** (bay fit-out, tooling, a GPU cart, the counter). **$1,200 a week:** bay lease $800, counter $200, utilities and insurance $200. |
| budget / decay | contribution budget $1,000 a week; decay 1 (the landlord keeps the building) |
| adds | `adair-bay` Adair bay subpanel (`panel`) |
| gse | `adair-gpu` Adair GPU cart |
| bins | +30 |
| kinds | `panel`: `xfmr` (*"Diagnose a dead bay circuit"*), `gfci` (*"Bay GFCI tool receptacles (513.12)"*, the `wireup` puzzle). No `feeder`, `dockrun` or `panelUp`: the service and the fuel farm are the authority's. |
| syms | own rows (below), plus home's `E_DEAD_CIRCUIT` |
| panels | `adair-bay`: Sub main 100 A (3 AWG); Cart chargers 30 A (10 AWG; outside the classified area, 513.10(B)); GFCI tool receptacles 20 A (12 AWG, 513.12); Bay lights 20 A (12 AWG); Compressor 30 A (10 AWG); Counter and office 20 A (12 AWG) |
| staff | none (pilots are a network-wide pool; the hub's board adds a pilot candidate a week, 4.9); staffRoom 3 (the pilot base) |
| perDiem | $110 (a hotel) |
| the scene | the leased bay (a bigger `Hangar`, reused); a ramp with three stands; the gate building (the authority's, drawn in grey: not ours); the parts-desk door; the cart on its charger; a corner of the long runway with the authority's edge lights (drawn, never ours); the windsock |

**Port Adair's own SYMPTOMS rows** (`only: ['adair']`):

| Key | Text | Causes |
|---|---|---|
| `E_BAY_GFCI` | "The bay's tool receptacles trip their GFCI whenever the compressor runs." | `gfci` 2 (*"The receptacle GFCI fails its test: replace it"*); `xfmr` 1 (*"The compressor shares the GFCI circuit's neutral: a multiwire fault"*); NFF 1 (*"A tool cord with a cut jacket: tagged out; the GFCI works"*) |
| `E_BAY_CHARGER` | "The cart charger circuit trips at the start of a charge." | `xfmr` 2 (*"The 30 A breaker's lug loose and discoloured"*) |
| `E_BAY_LIGHTS` | "Half the bay lights are out; the breaker is on." | `xfmr` 1 (*"An open neutral at the fixture whip"*, needs a splice) |

**The hub's hangar reports:**
- The mechanic's hangar and shop REPORTS rows (hangar lights, compressor, battery charger, 28 V receptacle) can be drawn at a station with `caps.hangar`. Their `job` is `hangar` or `shop`.
- **Drawn only if the mechanic worked there in the last 2 weeks:** a trip there in week W or W − 1. Half the time it's that station (seeded `hashSeed(s.seed, 'hub-report', W)`), and then `report.st` is set.
- **Its cap binds only his jobs at that station.** `reportCap(s, 'mech', st)`: `complete` checks it against `siteOfOrder`. His home jobs are never capped by it.
- If he has no work there, it's a notice ("Adair bay: two lights out. Mia fixes it on her next Adair trip."), not a cap.
- A mothball or a drop closes it (`'dropped'`).

**Port Adair's REPORTS row** (`only: ['adair']`): *"Adair bills our landing fees at the GA rate, not our contract."* The mechanic reports it (he signs the handling tickets). The analyst fixes it with the `invoice` puzzle. Effect: a leak of $70 a week. It's drawn only while a route into Adair flies.

**Crew project:** *Open Port Adair.*

| Seat | Job | Puzzle | Where |
|---|---|---|---|
| mech | "Hangar acceptance: penetrant-check the leased jacks' lifting pads and the tow bar" | `crack` | at Adair (`site`) |
| elec | "Bay subpanel: cart chargers outside the classified area (513.10(B)), GFCI tool receptacles (513.12), bay lights. Under the company's commercial permit (master of record)." | `panel`, variant `bay` (the circuits above, not a 120/240 V island panel) | at Adair (`site`); `builds: 'adair-bay'` |
| fin | "Fit-out: three-way match the contractor's invoices" | `invoice` | home |

- The station trips for a project's `site` jobs cost no cash: they're in the capex, booked as a `project` trip. Each is still that tech's one trip that week.
- Neither station requires the other. Only one project is open at a time.

### 3.3 Routes and their money

```ts
ROUTES = {
  'home-tern':  { a: 'home',  b: 'tern',  nm: 38,  block: 0.4,  fare: 90,  demand: 24, fees: 0,  cargo: 250 },
  'home-adair': { a: 'home',  b: 'adair', nm: 110, block: 0.85, fare: 150, demand: 70, amp: 0.25, fees: 70, cargo: 550 },
  'adair-tern': { a: 'adair', b: 'tern',  nm: 125, block: 0.95, fare: 160, demand: 28, fees: 70, cargo: 300 },
};
```

**The week on a route** (`routeWeek`, resolve step 2b). A round trip is one "flight" in the game's week, as at home.

1. **Round trips per plane**, `n_p`, from step 2 (8):
   - `min(capOf(p)` after the pilots' cap, `routeFreq`, the day-VFR cap if an end is unlit`)`
   - minus 1 in a `movedBase` week
   - 0 before acceptance, while grounded, or while parked
   - `RT_r = Σ n_p`.
2. **Sellable seat-legs:** `S = Σ n_p × 2 × seats`, less:
   - 4 for each guest party booked into a station on this route (a party of 2 rides both ways; its fare is in the package, 5b)
   - 2 for each tech's trip riding it
3. **Demand**, in seat-legs:

   `D = demand × season_r(W) × curve(fare) × freqF(RT_r) × ramp_r × mature_r`, where:
   - `curve(f) = 1 / (1 + e^((f − 1.2 × ref) / (0.3 × ref)))`: 0.661 at the reference fare
   - `freqF = 0.6 + 0.4 × min(1, RT_r / 5)`: frequency drives share
   - `ramp_r = 0.5 + 0.5 × min(1, k / 8)`, where `k` is the weeks this route flew in `ledger.rt` (derived, at most 26)
   - `mature_r = 1 + 0.2 × (2u − 1)`, with `u` from `rng(hashSeed(s.seed, 'route-mature', r.id))`: a route's seeded mature level, ±20%
   - `season_r` is the island's season with the route's own `amp` (the trunk swings ±25%, so at peak it outgrows one twin)
4. **Connecting passengers:**
   - When a point-to-point route (no home end) isn't flown and both its legs through home fly, `NET.connect × D` of it (at its reference fare) connects at home.
   - They're limited by the free seat-legs on **both** legs, and pay that route's fare, split between the legs by nm.
5. **Pax:** `min(S, round(D × u))`, with `u` from `rng(hashSeed(s.seed, 'route', r.id, W)).range(0.92, 1.08)`.
6. **Revenue:** `pax × fare` + connecting fares + the cargo planes' round trips × `r.cargo`.
7. **Direct cost:**
   - fuel: `Σ n_p × 2 × r.block × blockX × fuelPerH` (booked `fuel`)
   - fees: `RT_r × r.fees` (booked `fees`)
8. **Guests:** each round trip into a station with houses brings up to one guest party there (5b).
   - Route passengers into home are day visitors and residents. They don't add home arrivals, so home stays byte-identical.
9. **Plane cost** on the route's P&L (4.10):
   - lease (or 0 if owned) + hull + the pilot's share by block hours + the plane's parts and labour this week (`ledger.as`)
   - the cards use `NET.mxCard` ($150 a week) until the fleet has 8 weeks of its own
10. **Pilots** spend duty by block hours (4.9). **Wear and the 100-hr** come in step 2 (8).

**Worked numbers.** These are mature routes at mid-season and reference fares. A skill-3 pilot is $320 ÷ 12 h ≈ $27 a block hour. A leased twin's fixed cost is lease $500 + hull $43 + parts and labour $150 = **$693 a week**. These are hand numbers from the formulas above; A reproduces every row in `balance.ts network --cards` and a test (13.1).

| Plane(s) on route | RT a week | Seat-legs / pax / LF | Revenue | Fuel + fees + pilot | Fixed | Contribution a week |
|---|---|---|---|---|---|---|
| twin, Home–Adair | 5 | 50 / 46 / 92% | $6,900 | $1,700 + $350 + $227 | $693 | **+$3,930** |
| same, at peak (demand 58) | 5 | 50 / 50 / 100% | $7,500 | same | same | +$4,530; at a 10% higher fare ($165) still 50 pax: **+$5,280** |
| a second twin there | 10 | 100 / 46 / 46% | $6,900 | ×2 | ×2 | +$961 in all: **the second twin −$2,970** (−$1,770 at peak) |
| same twin at 4 RT | 4 | 40 / 40 / 100% | $6,000 | $1,360 + $280 + $181 | $693 | +$3,486 (fewer round trips lose share) |
| twin, Home–Tern, both cottages booked | 2 | 12 sellable / 12 / 100% | $1,080 | $320 + $0 + $43 | $693 | **+$24** |
| same at 3 RT | 3 | 22 / 13 / 59% | $1,170 | $480 + $64 | $693 | −$67 alone; **+$97 with 4 connecting pax** when the trunk has 4 free seats (their $640 split by nm: $164 to this leg, $476 to the trunk) |
| same at 4 RT (the day-VFR cap) | 4 | 32 / 15 / 47% | $1,350 | $640 + $85 | $693 | −$68 |
| twin, Adair–Tern | 4 | 40 / 17 / 43% | $2,720 | $1,520 + $280 + $203 | $693 | +$24 itself, but it takes the ~4 connecting pax off both home legs (−$640): **net about −$600** (the naive trap) |
| the owned float moved to Home–Tern | 2 | 8 sellable / 8 / 100% | $720 | $211 + $0 + $51 | $0 (home's) | +$458, **but its tours at home were worth ~$3,900 a week** |
| the owned cargo plane on Home–Adair (freight) | 5 | — | $2,750 | $1,989 + $350 + $204 | $0 (home's) | +$207; it still lands at home daily, so home's bulk parts still ride it |

- **The uncertainty is on the cards.** Each route card shows a P10–P90 band from the seeded maturity (±20%) and the season, and its first 8 flown weeks at the ramp.
  - The trunk at 5 RT, mature: +$2,880 to +$4,530.
  - Home–Tern at 2 RT: −$160 to +$24.
  - While ramping (75% of mature demand on average): the trunk +$2,280, Home–Tern −$246.

**Per station, good play:**
- **Tern Cay** with a leased twin on Home–Tern at 2 round trips:

  | Line | USD a week |
  |---|---|
  | route | +$24 |
  | rentals: 2 cottages × 7 nights × $280 × 0.8 × occupancy 0.79 | +$2,477 |
  | housekeeper | −$180 |
  | overhead | −$650 |
  | its 3 assets' parts and labour (about 0.8 electrician jobs a week at home's decay, from the shared pool) | −$200 |
  | trips (a $60 per diem every other week) | −$30 |
  | **total, mature** | **about +$1,440** |
  | total while the route ramps (its first 8 flown weeks) | about +$1,170 |

  - **Payback:** capex $12,000 paid at the project's start. With the twin leased the same week (delivered at home, accepted, flying the week after the opening), it pays back **about 11 weeks after opening**.
  - At 3 round trips once the trunk flies: +$73 more on this leg and +$476 on the trunk (the connecting passengers).
- **Port Adair** with a leased twin on Home–Adair at 5 round trips (based at home):
  - trunk +$3,930; overhead −$1,200; the bay subpanel's upkeep about −$40; trips about −$50 → **about +$2,640 a week mature**, about +$990 while the route ramps
  - its first week (acceptance, no flights) about −$1,900
  - capex $15,000 → **pays back about 13 weeks after opening**
  - plus: the parts desk (4.7), the pilot base, the delivery point, and the trunk's spare seats for Tern's connecting passengers
- **Naive play:** both stations; two twins on Home–Adair and one on Home–Tern; every round trip flown; fares at 1.5×.
  - Home–Adair at $225: 19 pax for 100 seat-legs, $4,275 against $5,940 → −$1,664. The hub's overhead and upkeep, −$1,290. **Port Adair −$2,954.**
  - Home–Tern at $135 and 4 round trips: 6 pax → −$608. The Tern station +$1,417. **Tern Cay +$809.**
  - **In all about −$2,150 a week** (T3). The grade on contribution (8, step 13) turns C.

### 3.4 Fleet: lease or buy

| Model | Lease a week (13-week minimum; a 4-week refundable deposit) | Buy | Resale | Hull insurance |
|---|---|---|---|---|
| twin | $500 (about 1.45% of its value a month) | $150,000 | 92% on the day, −0.1% of the price a week, floor 55% | $43 a week |
| float | $400 | $115,000 | same | $33 |
| cargo | $650 | $195,000 | same | $56 |

**The lease-vs-buy card:** twin, as the analyst sees it.

|  | 26 weeks | 52 weeks | 104 weeks |
|---|---|---|---|
| lease | $13,000 | $26,000 | $52,000 |
| buy: value lost (price − resale) | $15,900 | $19,800 | $27,600 |
| cash tied up at 8% a year (shown, never charged) | $6,000 | $12,000 | $24,000 |
| **buy, all in** | **$21,900** | **$31,800** | **$51,600** |

- **Leasing wins inside a season; buying breaks even at about two years.** Buying also needs $150,000 of spendable cash above the $25,000 floor, which few islands have before week 40. It skips the minimum term, the deposit, the return true-up and the lessor's consent. That's why regional airlines mostly lease; the call is the analyst's.
- **Deposit:** 4 weeks of lease leaves the bank at the deal and comes back at the return, less any true-up. It counts against spendable while held.
- **Early return:** 4 weeks of lease before the minimum.
- **Return condition:** a lease returned under 85 health is charged `(85 − health) × $300` (at 60 health: $7,500). Returning one run down doesn't pay.
- **Delivery:** at the next week's open, at the **delivery station** (`deliveryStation`: Port Adair while it's open, else home, where the lessor's ferry pilot brings it), at health 85.
- **Acceptance (before it flies):** delivery raises two must-do mechanic jobs on the plane, at the delivery station:
  1. *Acceptance: records review* (CATALOG `accept`): the `logbook` puzzle on the plane's own derived records (ADs, life-limited parts, the equipment list, W&B)
  2. *Acceptance: conformity inspection* (`inspect100`, which resets `sinceInspection`)
  - The plane flies from the week after both are signed (`asset.accepted = W`).
  - At Port Adair both need the mechanic's trip.
  - Autopilot does them at 50%, so an absent mechanic doesn't park a $500-a-week lease for long.
  - The card says "flies from week W+2 if accepted at once".
- **Fly-away kit:** the plane comes with its own spares for its own effectivity: 1 tire and tube, 2 brake linings, and 2 oil filters for a piston (`starterItem(s, line, asset)`).
- **Its own records:** the seed, its asset id and model give it its own registration, logbooks, IPC effectivity and (half the time) an alteration, as `islandAircraft` does today.
  - On a network plane the alteration's holder is its previous owner (derived), not "Island Company (owner)".
  - On a leased plane, the part chain's engineering-approval step adds "and the lessor's written consent": words, and a chip on the analyst's card. The lessor doesn't decline in v1.
- **Registration:** p1–p3 keep N12xx. A network plane draws N + 3 digits + 2 letters from `hashSeed(s.seed, asset.id)`, re-drawn deterministically on a clash with any fleet registration.
- **Name:** `${word} ${the registration's last three characters}` ("Twin 7KT").
- **Two twins may take different linings:** fleet commonality becomes a real stock problem for the analyst. The stock planner already shows it by P/N.
- **Parked:** a network plane with no route is parked at its base. It flies nothing and still pays its lease and hull: "Parked: $543 a week" on its card.
  - **A network plane never flies island ops.** That closes the loophole where an unassigned leased twin sold home's tours at about +$1,250 a week (17 has the numbers).

### 3.5 Opening a station

- **Available when:**
  - `s.tier ≥ 5`, and it's the week the Resort arrived + 2 or later
  - stage 3 is released (A0's T1 met, or the owner's call: 11.2)
  - no project is open and no receivership
  - spendable cash − capex ≥ $25,000
- **Start:** `openStation`.
  - **The capex leaves the bank now** (booked `capex`). `dropStation` refunds all of it.
  - The three project orders appear (order tier 4, one per seat, like a tier project). A `site` job needs that tech at the station (a `project` trip, no cash).
- **Opens** when all three are signed off, at once (like a tier):
  - its assets through `addAsset(s, def, W, health = 60 + 30 × the crew's mean score)`. This is factored out of `addTierAssets` and used by both. It sets `inspectionUntil = W + houseInspectionWeeks` for houses, so the cottages rent in the opening week, and `sinceInspection = 0` for planes.
  - **the electrician's project score rolls a hidden defect** on the asset his job built (`builds`), at `NET.projectTier`, through `rollDefect` like any blind job (DEFECT rules by the job's kind: `dockrun` at Tern, `panelUp` at Adair). It can surface later, or the panel's IR scan can show its heat once the wear it causes is under way. Tier projects are unchanged (no defect roll), so home stays byte-identical.
  - its carts, full, on their charger
  - its standard staff at skill 3 (they skip `STAFF.maxStaff`)
  - its bins
  - the review line: "Tern Cay is open: 2 cottages, the panel, a cart."
- **Drop:** while it's a project, the analyst can drop it (`dropStation`). The orders are cancelled, their reservations released, and the capex refunded. That's the exit when a crewmate is away for weeks.
- **Mothball** (open ↔ mothballed; the analyst):
  - overhead × 0.3
  - its open alerts close `'dropped'`, its open orders are cancelled, and their reservations are released
  - **its assets are out of service** (`isMothballed(s, st)`): no alerts, no deferral rolls, no defect surfacing, no fire rolls, no storm damage, **no decay** (it's preserved)
  - no route into it flies, and no trips go there
  - it needs no plane based there or routed into it ("Move or park Twin 7KT first")
  - **reopening** is free the next week; each of its houses gets a code-prep must-do (the inspection lapsed), and its assets resume
- **Readers of `s.project`** branch on `project.st`:
  - `CrewProject` (home.tsx) reads "Crew project · open Tern Cay"
  - `describe()` (island.tsx) reads "Tern Cay under construction"
  - `growth.ts` builds no home construction for a station project (the station's own scene shows it)
  - staff.ts's builder check (`s.project.tier` against `b.tier`) skips station projects

### 3.6 What each station adds for each trade

| Trade | Tern Cay | Port Adair |
|---|---|---|
| Mechanic | A Home–Tern plane stuck here (half its airworthiness groundings strand it at this end, seeded): a trip, with the part carried or drop-shipped. A plane based here (an Adair–Tern plane): all its work is here. Its cart. The day-VFR cap on its routes. | **The acceptance of every leased plane while it's open** (delivered here). A plane stuck here, or based here. The hangar reports, once he has worked here. Its cart. The parts desk (4.7). |
| Electrician | The 200 A service panel (a dead circuit, the underground feeder re-splice, the service upgrade). The dispenser circuit (GFP trips, the E-stop test; the new RMC run can't fail its insulation test for 26 weeks). Two cottages (every house kind but the hot tub). The wiring he built for the opening can carry his own hidden defect. | The bay subpanel (a dead bay circuit, the GFCI tool receptacles, the charger circuit, the lights). The hub's hangar reports. |
| Analyst | Opening. Which plane serves it (a leased twin, or the float and its lost tours). 2 or 3 round trips (3 pays once the trunk has spare seats for connecting passengers). The fare. The housekeeper. The one-plane risk (an AOG week empties its cottages). Mothball. The power-bill report. | The trunk's fare at peak. Lease vs buy. The second-twin trap. Adair–Tern vs connecting passengers. When to lease (during the project: delivered home, no trip; after opening: delivered here). The landing-fee report. Pilots from the hub's board. |
| All three | The crew project (a job each); the station's cross-trade reports; *Report a problem* on its objects | the same |

- **Basing:** in v1, a plane on a route with a home end is best based at home (no trips), and the analyst's card says so. A base matters for a point-to-point plane (Adair–Tern: based at Adair or Tern). There's no basing incentive yet (0.4).

### 3.7 Realism notes (for the critics and the crew)

- **NEC 513, aircraft hangars** (the bay subpanel project and the charger circuit use these words):
  - Classified areas: below the floor is Class I Div 1. The hangar floor up to 18 in is Div 2, and so is within 5 ft of engines and fuel tanks, up to 5 ft above the wings (513.3).
  - Battery chargers are not to be in a classified location (513.10(B)).
  - A GPU's fixed parts sit at least 18 in above the floor, with extra-hard-usage cords that carry an EGC (513.10(C)). The 28 V DC is the cart's output: the charger plugs into a 120 V branch circuit.
  - GFCI for the receptacles where tools are used (513.12, pointing to 210.8).
- **NEC 514, motor fuel dispensing** (Tern Cay's dispenser; this spec cites **NEC 2023**, and the card says so, because the subsection letters moved between editions):
  - Div 1 inside the dispenser enclosure; Div 2 to 18 in above grade within 20 ft (Table 514.3(B)(1)).
  - RMC or IMC underground, or PVC with RMC for the last 2 ft (514.8).
  - A listed seal in each conduit entering the dispenser and at the first fitting out of grade (514.9).
  - A remote disconnect of every conductor, the grounded one included (514.11(A)).
  - Emergency shutoffs 20–100 ft from the dispenser. Tern Cay is **attended** (the station agent fuels), so the shutoff must also be readily accessible to the attendant. Earlier editions put the 20–100 ft rule under unattended self-service only.
  - Aircraft fuel servicing itself is NFPA 407. The dispenser's wiring follows the NEC's fuel-dispensing rules. The Tern project and the dispenser alerts say both.
- **The electrician's scope:**
  - Class I wiring (514) and hangar work (513) are commercial, hazardous-location work, outside a residential license in most places. Those cards say *"under the company's commercial permit (master of record)"*. The master of record is a permit signature, so no NPC does trade work.
  - His part is the supply side: the feeder, the seals, the all-conductor disconnect and the E-stop. The dispenser's internals are the vendor's.
- **No airfield series lighting:** Port Adair's lights are the authority's. Tern Cay has none (so day VFR only). The home strip's edge lights (tier 5) stay status-only on the island grid.
- **The mechanic:**
  - **Scheduled work is done where a plane overnights:** its base. A plane that breaks at an outstation gets a field repair there: the mechanic and the part fly in, as real operators do.
  - **The 100-hour inspection counts hours** (14 CFR 91.409(b)). Route flying adds block hours; the sheet shows "100-hr in 31 h, about 4 weeks". The cargo plane is on a phase inspection, and its sheet says "Phase 2 in 58 h".
  - **The per-takeoff load manifest of a multi-engine plane** (14 CFR 135.63(c)) is the pilot's or operations'. A route plane gets no mechanic load sheet, and its sheet says "Load manifest: the pilot's, before each takeoff".
  - **A Part 135 operator does a conformity inspection and a records review** (ADs, life-limited parts, the equipment list, W&B) before a plane joins the fleet and carries anyone. That is the A&P's own flow: *"I check in previous logged items on airplane / The maintenance logs."*
  - Leases bar unapproved alterations, so an STC or a field-approved 337 on a leased plane needs the lessor's written consent.
- **Pilots:** Part 135 duty and flight-time limits are in hours (135.265/.267), so route flying spends a pilot's duty by block hours.
- **The analyst:**
  - load factor, cost per seat, contribution per route and station (maintenance, hull, the pilots' hours and travel included), a capex payback with a P10–P90 band
  - new routes ramp up; frequency drives share; peaks outgrow one plane
  - connecting traffic through a hub vs point-to-point
  - lease vs buy with resale and a cost of capital
  - dry leases with a lease-rate factor near 1.5% a month, a minimum term, a security deposit, return conditions, and the lessee's hull insurance
  - landing fees at the hub, none at our own strips

---

## 4. How each existing system generalizes

### 4.1 The table

| System | Files | Change (a station lookup; otherwise unchanged) |
|---|---|---|
| Alerts | `alerts.ts` | **One pass per trade over every asset** (4.5). A station asset's candidates come from its station's `kinds` and `syms`. `wb` is never a candidate for a plane with a route. `raiseAlert`'s fallback never crosses roles: a write-up of the kind (`W_<kind>`), never `MECH[0]` on an electrician's alert. `nffExtras` stays home-only. `soleGuest` counts home's island-ops planes only (4.3). |
| The five-step job flow | `flow.ts`, `engine.ts` (`planAlert`, `complete`, `nff`, `makeSafe`, `mel`) | Planning is paperwork, done anywhere. `installCheck` adds one stop: the tech isn't on site at `siteOfOrder` ("At Tern Cay: book the trip ($60)"). It works like `gseForStart`'s blocker: the engine refuses the move with the words, and the card shows them. The other hands-on moves take the same check (`SITE_BOUND`, 4.6). |
| Stock and purchasing | `stock.ts` | One central store. **`leadOf(s, x, vendor)` is the single place a lead is computed:** `x.lead + leadAdd`, less 1 week (never under 1) when the parts desk applies (4.7). `etaOf(s, W, x, vendor)` uses it, and so do the planner's reorder points (`suggestRop`) and the forecast. POs for a station job are drop-shipped there at that ETA. `receive` checks carriers by station (4.2). `binsTotal` adds open stations' `bins`. `starterItem(s, line, asset?)` takes the plane. |
| Requisitions, receiving, three-way match, payables | `stock.ts`, `ledger.ts` | unchanged |
| Puzzles | `src/puzzles/*` | `PuzzleContext.assetModel` (new, A) replaces the name sniffing in `ipc.ts` and `logbook.ts`; `launchFor` passes it. The station projects' variants: `conduit` `rmc` (a 3/4 in RMC stick with its bender's take-up, the EYS seal as the connector step, an all-conductor disconnect on the panel step), `panel` `bay` (the bay circuits). Everything else is unchanged. |
| Blind sign-off, hidden defects, incidents traced to the signer | `engine.ts` | Unchanged, per asset. **Station projects now roll the electrician's defect on the asset his job built** (3.5). |
| Inspections finding defects | `engine.ts` `detectDefects`, `data.ts` `INSPECTS` | Unchanged. **Quick checks never read `s.defects`** (6.4). |
| Cross-trade reports | `engine.ts` `openReport`, `data.ts` | `report.st`. The hub rule (3.2). Station-only rows (`only`). **`reportCap(s, role, st?)`:** a report with `st` caps only the reporter's jobs at that station. |
| The part chain | `chain.ts`, `engine.ts` | One open chain network-wide, as today. The lookup and research are paperwork (anywhere); the install is on site. Freight words: 'the AOG boat' becomes 'the AOG charter to Tern Cay' for a plane stuck there; `'flight'` rides the next company flight into `aogAt`. On a leased plane the approval step adds the lessor's consent (3.4). |
| GSE carts | `econ.ts` (`gseCarts`, `cartOn`, `startCart`, `gseForStart`), `engine.ts` (`gseMove`, `chargeCarts`, `flightDayStart`, `hookForFlightDay`, `autoCart`) | Carts carry `st`. A cart hooks only to a plane whose `workStations` include the cart's station. A cart move needs the mechanic on site. Charging needs `powered(s, cart.st)`. The weak battery rolls over every accepted, flying plane; its first start is on a cart at its work station. `hookForFlightDay` unhooks per station. |
| NPC staff | `staff.ts` | **Pilots:** one pool; duty in hours (4.9); `pilotSeats` serves home's island-ops planes first (today's order), then route planes, then cargo. **Housekeepers:** `housekeepingCap(s, st)`, `reviewMult(s, booked, st)` by `npc.st`. The hiring board adds one candidate per open station (`cand.st`). `STAFF.maxStaff` + Σ open stations' `staffRoom`. Hard landings: never on a plane `soleGuest` is true for. |
| Finance tracking | `ledger.ts`, `engine.ts` | `book(…, { asset })` already splits by asset; the station comes from `stOf(asset)`. Travel is booked with its station. New rows `ledger.rt` / `ledger.stn`. New spend categories `fuel`, `fees`, `lease`, `hull`, `travel`, `capex`, each mapped into the Money tab's `OutCat` groups. |
| The crew board, DMs | `engine.ts`, `crewboard.tsx` | Unchanged. `openDm(role, prefill)` is exported for the inspect sheets (6.5). |
| Power | `econ.ts` | `grid(s, st = 'home')`, `generator(s, st = 'home')`, `powered(s, st = 'home')`. Home's are the assets with no `st` (4.4). |
| Houses and guests | `engine.ts` step 5, `econ.ts` | `houseRentable(s, h)` uses `powered(s, stOf(h))`. Home's booking loop is unchanged. Each open station books its own houses from its own arrivals and housekeepers (5b). |
| Flights | `engine.ts` step 2, `econ.ts` | The loop over planes is unchanged for island ops. **Route planes fly `n` round trips in step 2 itself** (wear, the 100-hr by block hours, near-miss rolls, hard landings, `flown`, `scheduled`), then go to `routeWeek` (8). `capFleet` puts home's island-ops planes first. |
| Grade | `engine.ts` step 13 | On contribution, with a probation (8, step 13). The A bonus is on home revenue only. |
| Crew projects | `engine.ts` `startProject` / `finishProjectIfDone` | `project.st` opens a station instead of a tier. The same one-job-per-seat rule, the same quality formula; `addAsset`; the defect roll. |
| Autopilot | `engine.ts` `autoRun` | The techs book a trip for urgent station work, then do that station's site moves (12.2). The analyst has the loss guard only (12.2). |
| Whose move, the Dock, End-turn checks | `select.ts` | Station words; "Trip to Tern Cay booked: 2 jobs there"; a network card waiting is the analyst's move. |

### 4.2 Every single-island assumption in the code, and what it becomes

Found by grep on `gaps` at `249988a` (`soleGuest`, `grid(s)`, `generator(s)`, `powered(s)`, `houses(s)`, `planes(s)`, `hasCargo`, hard-coded asset ids, `POS`, `focusBox`, "only guest plane"). The critique added rows 60–67.

| # | Where | Assumes | Becomes |
|---|---|---|---|
| 1 | `econ.ts` `grid`, `generator` | the first grid / generator asset | `(s, st = 'home')`: the one at that station (home: no `st`) |
| 2 | `econ.ts` `powered` | one grid | `powered(s, st = 'home')`, the same `{ gridDown, genOK, on }`. At a station with no generator: `genOK: false`, `on = !gridDown` |
| 3 | `econ.ts` `houseRentable`, `houseBlocker` | one power state | `powered(s, stOf(h))`; a mothballed station's houses: "mothballed" |
| 4 | `econ.ts` `passengerFlights`, `flightsAvailable`, `housesRentable` | one island | home: `opsPlanes(s)`, `housesAt(s, 'home')` |
| 5 | `econ.ts` `capFleet` | one fleet | home's island-ops planes first (today's order), then route guest planes, then cargo; identical without network planes |
| 6 | `econ.ts` `projectWeek` | one island | home only (the desk's pricing preview): `capFleet` over every plane, then home's ops planes; `projectNet(s, over)` in `network.ts` for the network |
| 7 | `econ.ts` `downtimeOf` | a plane's lost guests and tours | a route plane: its route contribution for the week, plus a station's rentals it alone brings; home planes unchanged |
| 8 | `econ.ts` `alertAog`, `subCharterOn`, `subCharterNeed` | `soleGuest` | unchanged (`gaps`): `soleGuest` is home's only island-ops guest plane (4.3); `subCharterOn(s)` stays home-only |
| 9 | `econ.ts` `gseCarts` | `GSE.carts` by tier | + open stations' `gse` (with `st`) |
| 10 | `econ.ts` `cartOn`, `startCart`, `gseForStart` | any cart for any plane | only carts at one of the plane's `workStations` |
| 11 | `econ.ts` `fixedNow` | tier overhead + payroll | + open stations' overhead (× mothball) + leases + hull (0 without a network) |
| 12 | `econ.ts` `orderTier` | the island tier | unchanged (station jobs play at the island's tier); `alert.early` → −1 (never under 1) |
| 13 | `alerts.ts` `soleGuest` | "the island's only non-cargo plane" | "home's only non-cargo island-ops plane": over `opsPlanes(s)`, so a network twin never makes the home twin not sole |
| 14 | `alerts.ts` `generateAlerts` | every asset in one pass | still one pass (4.5), with station candidates by `kinds`, no `wb` for route planes, and mothballed or unaccepted assets skipped |
| 15 | `alerts.ts` `nffExtras` | all assets | home assets only |
| 16 | `alerts.ts` `vars().leg` | "the villas" / "the cottages" | home rows keep it; station rows carry their own text |
| 17 | `alerts.ts` `siteOf`, `pairsFor` | every room a symptom allows | a station asset draws only its `syms` rows; `raiseAlert`'s fallback is `W_<kind>` of the same role |
| 18 | `engine.ts` `soleGuestPlane` (the chain's roll, the MEL line) | the only guest plane | `soleGuest` (home only) |
| 19 | `engine.ts` `hasCargo`; `staff.ts:779` | any cargo plane on the island | a cargo plane on island ops or on a route with a home end |
| 20 | `engine.ts` step 2, `guestSlots` / `passenger` / `cargoFlights` | every plane serves home | island-ops planes only; route planes fly their `n` in step 2, then `routeWeek` |
| 21 | `engine.ts` step 3, `receive` carriers | home's guest and cargo flights | + route flights with a home end (only when there are any) |
| 22 | `engine.ts` step 4, `powered` / `grid` | one grid | per station; the lines name the station |
| 23 | `engine.ts` step 5, `houses(s)`, `td.ferry`, `housekeepingCap` | one island | home as today; then each open station (5b) |
| 24 | `engine.ts` step 6, the charter | the island's guest planes | island-ops planes only (unchanged) |
| 25 | `engine.ts` step 9, decay | `ECON.decay` everywhere | **every plane, home or network: home's rule** (ECON.decay, with A0). A station's assets: its `decay ?? home's rule`. A mothballed station's: none. |
| 26 | `engine.ts` `complete`, the grid-down hangar cap | one grid; the global `turns.mech.done` | the job's station's power; the count of this week's done mechanic jobs **at that station** (derived from this week's orders by `siteOfOrder`) |
| 27 | `engine.ts` `rollWeakBattery` | home planes | every accepted, flying plane (its draw is unchanged when there are no network planes) |
| 28 | `engine.ts` `startProject` / `finishProjectIfDone` | projects bring tiers | `project.st` |
| 29 | `engine.ts` `addTierAssets` | home tier assets | factored into `addAsset(s, def, week, health)`, used by tiers and stations; tier assets never get `st` |
| 30 | `engine.ts` resolve step 11, cash | one island's costs | + `network` costs (overhead, leases, hull, fuel, fees); capex, deposits and travel when they happen |
| 31 | `stock.ts` `etaOf` | lead + supplier's lead | `etaOf(s, W, x, vendor)` over `leadOf` (4.7) |
| 32 | `stock.ts` `binsTotal` | the tier's bins | + open stations' `bins` |
| 33 | `staff.ts` `pilotSeats`, `charterMult` | the island's planes | home's first, then route planes, duty in hours; `charterMult` over `opsPlanes` (tours are home's) |
| 34 | `staff.ts` `housekeepingCap`, `reviewMult` | one island | `(s, st = 'home')` by `npc.st` |
| 35 | `staff.ts` `boardNeeds`, `capacityLost`, `staffEffect` | one island | per station ("Tern Cay's 2 cottages have no housekeeper") |
| 36 | `staff.ts` `staffAfterFlights` | `soleGuest` | `soleGuest` (home only) |
| 37 | `staff.ts` `COTTAGE_PLOTS` (h8, h9) | home's grove | unchanged (home only; no builds at stations in v1) |
| 38 | `chain.ts` `islandAircraft` LRU of 12 | 3 planes | unchanged (at most 6 planes) |
| 39 | `data.ts` `TIERS[].adds` ids p1–p3, h1–h7, g1, gen | home ids | unchanged; station ids are prefixed by station and network planes are `f<n>`, so they never collide |
| 40 | `data.ts` `GSE.carts` gpu1 / gpu2 | home carts | unchanged; stations add theirs |
| 41 | `data.ts` `STARTER` plane lines by model | "the island's airplane of that model" | unchanged for tier-ups; a fly-away kit uses `starterItem(s, line, asset)` |
| 42 | `data.ts` `REPORTS` hangar rows | the home hangar | may be drawn at a station with `caps.hangar` (3.2) |
| 43 | `growth.ts` `developmentOf`, `care` | the island | home assets only (a Tern panel at 45 doesn't make home look worn); no construction for a station project |
| 44 | `puzzles/ipc.ts` `ASSET_OF`, `modelFromName`; `puzzles/logbook.ts` `ASSET_OF`, `modelFrom`, `OTHER` | model ↔ p1/p2/p3 by name | `ctx.assetModel` first, then today's fallbacks (the lab keeps working) |
| 45 | `ui/island.tsx` `POS`, `AOG_SPOT`, `PLANE_ROT`, `PLANE_SIZE` by id; `p.id === 'p1'` (the hangar door); `float = planes.find(model === 'float')`; `at('g1')`, `at('gen')` | three planes with fixed spots; one grid | `LAYOUTS.home.stands` for network planes based at home; "a plane on jacks by the hangar" for the door; floats after the first moor on water stands; home's grid and generator by kind and no `st` |
| 46 | `ui/island.tsx` `planes`, `houses`, `grid`, `gen` from all of `s.assets` | one island | the scene's station's assets (home: no `st`, plus network planes based or stuck at home) |
| 47 | `ui/island.tsx` `POLES`, `SPANS`, `FEED` | home's wiring | unchanged for home; a station's `feeds` in its layout |
| 48 | `ui/island/geo.tsx` `focusBox(role, tier)`, `siteBox(s)`, `zoomOf`, `viewOf` | one zoom state | presets of the camera at home (5.3); each layout's `focus` for stations; `zoomOf` stays for the lab and old callers |
| 49 | `ui/island/gse.tsx` `CART_HOME`, `CART_OUTLET` | home spots | home's; station carts from `layout.carts` |
| 50 | `ui/home.tsx` `<Island focus onTap onCart>`, `view: 'zone' \| 'site' \| null`, the builders' hit-test, "See the island" | one scene | `<MapView>` (5): the view state becomes the preset; the builders' hit-test moves into the hotspot registry (`site` refs); "See the island" becomes ⌖ |
| 51 | `ui/select.ts` `blocks` (passenger cap, "grid down: hangar tools offline", "no rentable houses") | one island | home as today, plus station lines ("Tern Cay panel down: 2 cottages dark") |
| 52 | `ui/select.ts` `teamNumbers` (`flightsMax = planes × per`, `housesMax`) | one island | home numbers over `opsPlanes` and home houses, plus a network strip at tier 5 |
| 53 | `ui/select.ts` `soleGuest` uses (the sub-charter words) | the only guest plane | unchanged (`gaps`), home only |
| 54 | `ui/ops.tsx` "Hangar + airstrip", "Cottages + grid", `AssetChips`, `powered(s)` | one island | grouped by station (home first), each station's header with its trip chip and its own power |
| 55 | `ui/gse.tsx` `powered(s).on` (hangar power), the cart list | one hangar | grouped by station; each cart's charger power by its station |
| 56 | `ui/purchasing/model.ts` `soleGuest` (the card's sub-charter chip) | the only guest plane | unchanged, home only; a station job's card gets the drop-ship words (D) |
| 57 | `ui/flow/Investigate.tsx`, `ui/flow/words.ts` the MEL and grounding words | the only guest plane | `gaps`' words stand; a station asset's line names the station ("stuck at Tern Cay: book the trip"); a route plane's note says an AOG week empties its station's cottages |
| 58 | `ui/island.tsx` `describe()` | the island | the scene's station; a station project reads "Tern Cay under construction" |
| 59 | `islandlab.tsx` hard-coded ids | the lab | unchanged; new station and region scenes (5.7) |
| 60 | `econ.ts` `expectedDeferralCost` (the grid's downstream = every house) | one grid | the houses at the grid's station |
| 61 | `econ.ts` `houseWeekRevenue` | the island's nightly | × the station's `rateX` |
| 62 | `stock.ts` `receive()` `cargoPlane` = any cargo plane | one island | a cargo plane on island ops or a route with a home end |
| 63 | `ledger.ts` `runway()`; `spendable`'s `Pick` type; `budgetCap`; the bridge loan from `fixedNow` | tier overhead + payroll | + the network's fixed costs (overhead, leases, hull); `spendable` also nets out held deposits (the `Pick` gains `net`) |
| 64 | `engine.ts` `hookForFlightDay` unhooks every cart | one ramp | per station |
| 65 | `ui/home.tsx:424`, `:529` (the mechanic's grid-down hold) | one grid | per station, against this week's jobs at that station |
| 66 | `ui/home.tsx:404` `CrewProject`, `staff.ts:814` builder tier check | projects bring tiers | branch on `project.st` (3.5) |
| 67 | `ui/board.tsx` review rows and cost rows; `ui/flow/Inbox.tsx`, `AlertRow.tsx` | one island | the "Network:" review line and `costs.network`; a station label on each alert row |

**The island-wide helpers, decided per call site** (every direct call on `gaps` at `249988a`). The rule: **`houses(s)`, `grid(s)`, `generator(s)` and `powered(s)` keep meaning home's**, so every existing call stays correct. **`planes(s)` stays "every plane"** (identical with no network planes), and the sites that mean home's own flying switch to `opsPlanes(s)`.

| Call site | Choice |
|---|---|
| `econ.ts:84` `subCharterNeed` (rentable houses), `:175` `housesRentable`, `:357` `projectWeek` houses, `engine.ts:3007` the inspector event, `:3767` step 5 | `houses(s)` = home (unchanged) |
| `econ.ts:198` `expectedDeferralCost` | `housesAt(s, stOf(grid))` |
| `econ.ts:98` `subCharterOn`, `:165` `passengerFlights`, `:171` `flightsAvailable`, `staff.ts:361` `charterMult`, `:779` `hasCargo`, `engine.ts:3789` the clear-sky line, `select.ts:31`, `:35`, `:593` | `opsPlanes(s)` |
| `econ.ts:350` `projectWeek`, `staff.ts:302` `pilotSeats`, `:581` `capacityLost`, `:705` `flightsWith`, `:712` `fullFlights`, `engine.ts:3590` weak battery, `:3643` step 2 | `planes(s)` (every plane; home's ops planes first in `capFleet`/`pilotSeats`); route planes use their timetable in `fullFlights` |
| `econ.ts:143–144` (`powered`'s body), `select.ts:38`, `select.ts:597` (`housesMax`) | home (unchanged) |
| `econ.ts:151`, `:156` (`houseRentable`, `houseBlocker`) | `powered(s, stOf(h))` |
| `engine.ts:838` (`complete`'s grid-down cap), `home.tsx:424`, `:529` | `powered(s, siteOfOrder(s, o))` and that station's jobs |
| `engine.ts:3760–3761` step 4 | home, then each open station |
| `island.tsx:201` | the scene's station |
| `gse.tsx:207` | the cart's station |
| `ops.tsx:30`, `:244` | each station group's own |

### 4.3 The only guest plane: home only

- **`soleGuest` stays home's rule:** home's only non-cargo island-ops plane (the twin through tier 3). `gaps`' grounding and mainland sub-charter apply to it, unchanged.
- **A station's only plane grounds like any other plane.** An airworthiness item past due grounds it (`alertAog`, no exception). That week no round trip flies into its station, so the station's cottages get no guests. At Tern Cay that's about −$2,480.
  - There's no sub-charter at stations. The sub-charter exists because grounding home's only guest plane empties every house and can bankrupt the island (HANDOFF 6.5). A station's risk is one bounded week, the analyst chose it by flying one plane, and the route card says so: *"One plane: an AOG week empties the Tern cottages (about −$2,480)."*
  - No near-misses are ever flown past an airworthiness item.
- **Assigning away home's last island-ops guest plane is refused:** "Home needs a guest plane: keep one on island ops." That's a no-gridlock guard: tours and home's guests ride on it.

### 4.4 Power per station

- **Tern Cay's panel is its grid.** There's no generator. A Tern panel under 40 means its cottages are dark and its cart doesn't charge.
- **Adair's bay subpanel down** means the Adair cart doesn't charge, and the mechanic gets one hangar job at Adair that week (the grid-down cap, per station). His home jobs aren't touched.
- **A station's power never touches home's.** The review says "Tern Cay panel down (reliability 34): the Tern Cay cottages dark."

### 4.5 Alerts: one pass, the network in it

- **With no network asset, `generateAlerts` is today's code over today's assets.** The golden digests hold.
- **Once network assets exist, the same pass covers them.** Per trade:
  - `openCount` = the trade's workable orders + its open alerts with `cause ≥ 0` + its open `src: 'check'` write-ups (6.4), network included
  - the target is today's (5 open from tier 3, else 4), at most 3 new a week (today's `min(3, …)`)
  - candidates:
    - home assets by `CATALOG[].targets`, as today
    - a station asset by its station's `kinds` for its model, less the kinds its `after` still blocks
    - a network plane by `targets`, **except `wb`**
    - never a mothballed station's asset, or a plane not yet accepted (its acceptance is raised at delivery)
  - weights as today: `weight(asset, W) × (1 + (100 − health)/40)`, and the 0.4 spread on the same asset
  - must-dos jump the queue as today (weight ≥ 100, and the critical fix for an asset under 45), with today's shared cap of 8 open
- **No load sheets on route planes.** `wb` exists to gate home's day tours. A route plane sells none, and its per-takeoff load manifest is the pilot's (135.63(c)). A home tier plane on island ops keeps today's `wb`.
- **What the network adds to a trade's week:**
  - **routine work: nothing.** The same slots cover more assets, so each asset waits longer between jobs. That's the network's real cost: condition. It's what the load gauge shows (9.3).
  - **must-dos:**
    - a network plane's 100-hr, by block hours: about every 12 weeks on the trunk (8.5 h a week) and about every 60 weeks on Home–Tern at 2 round trips (1.6 h a week), so 0.1 a week per plane or less. (A plane that flies so little would meet its annual inspection first, 91.409(a); v1 counts only the 100-hr, and the acceptance inspection starts its clock.)
    - each lease's two acceptance jobs
    - the station cottages' code prep
    - a critical fix for an asset under 45
  - With the v1 maximum (3 network planes, 2 stations): about 0.3–0.5 must-dos a week per trade in steady state (T5).
- **Flags and check write-ups** count as the owner's open work (6.4, 6.5).

### 4.6 Where the work is: trips, and what needs the tech there

**Where each asset's work is done** (`workStations`):
- a station building: its station
- a plane: **where it overnights, its base** (home tier planes: always home). A plane on a route lands at both ends, but its maintenance happens at its base.
- **a grounded plane: where it's stuck** (`aogAt`)
  - A route plane grounded by an alert is stuck at one end, seeded from the alert: `rng(hashSeed(alert.seed, 'at')).pick([route.a, route.b])`.
  - So half of a Home–Tern plane's groundings strand it at Tern Cay. That's the outstation AOG: the mechanic and the part must get there.
  - A tag, a chain AOG or a plane with no route: its base.
- a network plane not yet accepted: the delivery station
- **Validation:** a base is an end of the plane's route. A network plane based away from home must have a route, or be parked there.

**What needs the tech on site** (`SITE_BOUND`, checked against `siteOfOrder` or the asset's work station):

| Move | Where | Why |
|---|---|---|
| `plan`, `repick`, `request`, `dropJob`, `melExtend`, `askBench`, `squawk`, the part chain's lookups and research | anywhere | paperwork |
| the mechanic's `tag` (ground a plane / return it) | anywhere | a grounding is a call: maintenance control makes it by phone |
| `mel` on an item with no maintenance (M) procedure | anywhere | maintenance control authorizes it by phone; the pilot does the (O) steps and hangs the placard |
| the electrician's `tag` on a station house (today's `tag` covers houses and the generator) | anywhere, **as the remote fallback** | "Ask the station agent to open the disconnect": the house closes entirely (no 75% made-safe rent) until he's there. Operating a disconnect isn't trade work. |
| `complete` (the job) | on site | the work |
| `makeSafe` (a breaker off and tagged, or a blank-off) | on site | a lockout is hands-on |
| `mel` on an item with an (M) procedure (`SYMPTOMS` MEL items marked `m: true`) | on site | the mechanic does the (M) steps |
| `nff` (close as no fault found) | on site | closing needs a look |
| `check` (a quick check) | on site | a look |
| `gse` (every cart move) | on site | the cart is there |

- **Autopilot** does a station's make-safe, (M) MEL and NFF closes only after it has booked that station's trip.
- **The home station never needs a trip.**

**Trip:** `{ t: 'trip', role, st, week }`.
- One a week per tech (`NET.tripsPerWeek`).
- **On a company flight** (any accepted, flying plane on a route between home and `st` this week): a free seat each way (2 seat-legs off that route's sellable seats) and the per diem in cash: Tern $60, Adair $110.
- **Otherwise an air taxi:** `NET.airTaxiPerNm × nm × 2` plus the per diem. Tern $304 + $60 = $364; Adair $880 + $110 = $990.
- **Booked as `travel`** (the trade's; the station's P&L), shown on the analyst's desk and in the review. **Never counted against the work budget** (`autoSpent`), so a trip never turns an in-stock job at home into a card for the analyst.
- **A trip never waits on another seat:** it goes through even with cash below its cost, as other due costs do.
- **While on the trip,** the tech can work that station and home all week (the trip is a day). It's still one outstation a week, so with two stations the tech picks which one gets them.
- A `site` project job's trip is a `project` trip: it costs no cash (it's in the capex), and it's still that tech's one trip that week.
- **Stored:** this week's and last week's trips (the hub-report rule reads last week's). "Where the tech is" is derived.

### 4.7 Where the part is: freight to stations

- **One central store.** A job's lines are reserved from it wherever the job is.
- **On a trip, the tech hand-carries** the job's reserved lines, including `bulk` ones (a wheel assembly, a case of oil, a cut length of wire: all within a seat's baggage). **Except hazmat** (items marked `hazmat: true`: wet batteries, oxygen, sealants and the like): they ride as company material on the next company flight into the station, or on the drop-ship. Building materials never go to stations in v1.
- **A part bought for a station job is drop-shipped** to that station at the PO's ETA (scheduled or AOG freight, as the card picks). Scheduled freight to an outstation adds $25 of handling to the shipment's freight.
- **The parts desk** (a station with `caps.partsDesk`, open): `leadOf` takes 1 week off (never under 1) **for a PO whose lines ride a flown Home–Adair route that week**: the route is open and an accepted plane on it isn't grounded at the PO's week. Otherwise the normal lead. It shortens shipping, not an OEM backorder: a supplier's `leadAdd` still applies in full.
- **"Where the part is"** is derived for the job card (D, `whereIsPart`):
  - "In stores: you carry it on the trip"
  - "Hazmat: it rides the next company flight to Tern Cay (Thursday)"
  - "Drop-shipped to Tern Cay: arrives week 31"
  - "Via the Adair parts desk: arrives week 30 (a week sooner)"
- **The part chain's AOG part** for a plane stuck at an outstation: `'boat'` becomes the AOG charter to that station, at the same price. `'flight'` rides the next company flight into it.

### 4.8 GSE carts per station

- Each station with `chargers` has its carts (`cart.st`). They charge on `powered(s, cart.st)`.
- A cart hooks to a plane whose work stations include the cart's station. The engine refuses otherwise: "Tern Cay GPU cart is at Tern Cay; Twin 7KT is at home."
- **Every cart move needs the mechanic on site** at the cart's station. So do autopilot's.
- **Weak battery:** the plane's first start of the day is at its work station, on a cart there.
- The GSE sheet groups carts by station (D). Tapping a cart on any scene opens it (unchanged).

### 4.9 NPC staff per station

- **Pilots** are one pool.
  - **Duty is in hours:** 12 h a week each (today's 6 flights × 2 h, so home is unchanged). An island-ops flight uses 2 h. A route round trip uses `2 × block × blockX` h (Home–Tern 0.8 h, Home–Adair 1.7 h).
  - `pilotSeats` covers home's island-ops planes first.
  - The route P&L charges the pilot's share by those hours.
  - A leased plane's card says how much pilot it needs ("about 0.7 of a pilot: the pool has 0.4 spare; hire one") and warns if no pilot can be hired (the staff cap).
  - The hub's board adds a pilot candidate a week while Port Adair is open, with skill weights shifted up (`[10, 20, 35, 25, 10]`, **tune**). Its `cand.st` is `adair` (where they were found); pilots are hired into the pool.
- **Housekeepers** have `npc.st`.
  - Opening Tern Cay hires its standard housekeeper at skill 3 ($180).
  - The board offers housekeepers per station when `capacityLost` says a station's houses sit empty.
- **The staff cap:** `STAFF.maxStaff` (10) + Σ open stations' `staffRoom` (Tern 2, Adair 3). A station's standard hires at opening skip the cap.
- **Builders:** home only in v1. They never speed up a tier or a station opening (the owner's default).
- **NPCs never do trade work.** The Tern station agent and the Adair authority are overhead, not NPCs.

### 4.10 Finance per station and per route

- **Station contribution:** its rentals, less its overhead, its housekeepers, the parts and labour booked on its assets (`ledger.as` by asset, `stOf`), and the travel to it. Stored per week in `ledger.stn`.
- **Route contribution:** fares + connecting fares + freight, less fuel and fees, less its planes' costs:
  - lease (0 if owned)
  - hull
  - the pilot's share by block hours
  - the planes' parts and labour this week (`ledger.as`)
  - Stored per week in `ledger.rt`.
- **A route belongs to its non-home station** for paybacks and the grade (Home–Tern → Tern Cay). A point-to-point route is split half to each end.
- **Parked planes** (lease, hull, parts and labour) are a "Fleet: parked" line in the network total.
- **Return true-ups and early-return fees** land on the plane's last route (or "Fleet").
- **Network contribution** = Σ routes + Σ stations + parked. It's the grade's input.
- **Payback** = the cumulative contribution of a station and its routes since opening ÷ its capex. Every card shows the lines behind it.
- **Home's P&L** is today's numbers, untouched.
- **The review:**
  - one line: "Network: 11 round trips on 2 routes, 71% full, fares $7,740, stations +$1,900, network costs $5,280, contribution +$2,410."
  - then at most one exception line: a plane stuck at an outstation, a station dark, a route under 40% for two weeks, a parked plane

### 4.11 Whose move, the Dock, the review, the crew board

- A station project's jobs are each seat's move, like a tier project.
- A trip-blocked ready job is the tech's own move: "Book the trip to Tern Cay: 2 jobs there". Never another seat's.
- A plane stuck at an outstation with its part drop-shipped is nobody's move until the part lands; then it's the mechanic's (the trip).
- The Dock's next action includes the trip.
- End-turn checks warn "2 ready jobs at Tern Cay and no trip booked".
- The mechanic's **Due list** (9.4) is on his ops panel.
- The crew board is unchanged.

---

## 5. The map camera (B)

Stage 2 ships the camera on the home scene. Stage 3 adds the station scenes and the region.

### 5.1 Two modes: the inline map and Explore

- **The inline map** (the Home screen's top card, as today):
  - **Tap an object:** its sheet (6).
  - **Tap empty ground:** toggles all ↔ my zone, as today. It fires after 250 ms, so a double tap can cancel it.
  - **Double-tap empty ground:** zoom ×2 about that point. (Stage 2 review round 3: an object too. Its first tap opens its sheet at once, so a second tap there within 300 ms and 30 px closes that sheet and zooms ×2 about the point: `map/swallow.ts armObjectDouble`.)
  - **One finger always scrolls the page** (`touch-action: pan-y` at every zoom), so Home never stops scrolling on a phone whatever the preset.
  - **Two fingers** pinch to zoom and drag to pan.
  - **A mouse** drags to pan on desktop.
  - The first time a phone zooms in, a one-time hint shows: "Two fingers to move the map · ⤢ to explore" (`localStorage`, guarded).
  - **Controls** in the map's corner, each 44 px: **+**, **−**, **⌖** (all; it replaces `gap-zoom`'s "See the island"), **⤢** (Explore). A preset chip row sits under the map.
- **Explore** (⤢): the **same `MapView` instance**, portalled into a full-screen `.overlay`. There's never a second scene; the inline slot keeps a same-height placeholder while it's out.
  - One finger pans; pinch zooms; `touch-action: none`.
  - The presets as chips across the top; ✕ to close (Esc on desktop).
  - The same camera state as inline: closing keeps where you were.

### 5.2 Gestures, taps vs drags, desktop, keyboard

- **Pointer Events** on the map's wrapper `<div>`. A pure classifier (`gestures.ts`, testable):
  - a pointer that moves more than 8 CSS px from its down point is a drag (a mouse: 4 px)
  - two pointers are a pinch
  - up within 500 ms without a drag is a tap
  - two taps within 300 ms and 24 px are a double tap
  - a drag or pinch suppresses the click that follows it (a capture-phase `click` cancel)
  - inline, a one-finger touch drag is left to the page (it never pans the map)
- **Pinch:** zoom about the two fingers' midpoint, so the point under the fingers stays under them. Pan with the midpoint.
- **Desktop:**
  - drag to pan
  - on the inline map, **Ctrl/⌘ + wheel** zooms about the cursor. A plain wheel scrolls the page; a hint "Ctrl + scroll to zoom" shows once. In Explore, a plain wheel zooms.
  - trackpad pinch (a wheel event with `ctrlKey`) zooms
  - double-click zooms ×2
- **Keyboard** (the map wrapper has `tabindex=0` and `role="application"`, with `aria-roledescription="map"` and a label):
  - arrows pan 60 map units; **+ / −** zoom ×1.5; **0** all; **M** my zone; **S** the build site; **R** the region
  - **Enter** opens *Objects on the map*: an HTML list of every hotspot in view (the keyboard and screen-reader path), each a 44 px button that opens its sheet
- **Carts** keep their own SVG buttons (focusable, Enter/Space), as today.

### 5.3 Presets (built on `gap-zoom`'s view state)

`gap-zoom`'s `view: 'zone' | 'site' | null` becomes the camera's preset id: `'zone' | 'site' | 'all' | 'region' | StationId`. `siteBox(s)` and `focusBox(role, tier)` are its boxes.

| Chip | Camera | When |
|---|---|---|
| My zone | `focusBox(role, tier)` at home; a layout's `focus[role]` at a station | always |
| Build site | `siteBox(s)` (`gaps`) | while a build is open at home (null: no chip) |
| All | k = 1 (the whole scene) | always |
| Region | the region view | stage 3: once a station is open, or a project is open |
| Tern Cay / Port Adair | that station's scene at k = 1 | stage 3: once open (also by tapping its pin) |

- **The builders' line on Home** (`gap-zoom`) still jumps to Build site, and on a phone it still scrolls the island back into view.
- The preset in use is remembered per island and seat (`localStorage`, guarded) for the next visit.

### 5.4 The region view (stage 3)

- **Its own small SVG** (1000 × 700, ≤ 400 nodes):
  - the sea
  - home's outline, and each open or project station's from `layout.region.shape`
  - the mainland coast strip on the west
  - the routes as arcs: dashed when not flown; thickness by round trips a week
  - each station's 44 px pin with badges: open alerts by trade (a wrench count for the mechanic, a bolt count for the electrician), a dark-houses icon, an AOG icon. The analyst sees the station's week in dollars instead.
- **Tapping a pin** opens the station sheet (D). A **Go there** button in it flies the camera there: the region's wrapper animates a scale into the pin over 350 ms, then the scene swaps to that station at k = 1. Reduced motion swaps at once.
- **A route arc tap** opens the route sheet (D).
- **Pinch-out to the region: only in Explore, and only in the network era.**
  - k may go down to 0.8 during that pinch.
  - At k ≤ 0.85 a hint shows: "Release to see the region".
  - Releasing there swaps to the region. If the pinch comes back above 0.95 before release, the hint hides and k springs back to 1.
  - Inline, pinch-out stops at k = 1. The **Region** chip is the main way in.
- **Only one detailed scene is mounted at a time:** the current station's, or the region.

### 5.5 Camera state, clamping, animation, reduced motion

- **Camera:** `Cam = { x, y, k }` in the scene's units: the view's centre, and the zoom (1 = the whole scene).
  - The viewport maps k = 1 to **contain**: the whole scene fits, and a portrait Explore on a phone letterboxes with the sea colour.
  - `k ∈ [1, 3.2]` (the same maximum as `zoomK`; 4 in Explore on a phone). Down to 0.8 only transiently (5.4).
  - The centre is clamped so the view stays inside the scene (as `viewCentre` does).
- **Preset changes** animate with today's 0.45 s ease on the wrapper's transform. Gestures turn the transition off (`.dragging`).
- **No momentum.** Reduced motion (the setting, or `prefers-reduced-motion`): presets and fly-to jump; gestures still work.
- **Test:** in the inline 4:3 viewport, `camForBox(focusBox(role, tier))` and `camForBox(siteBox(s))` equal `zoomOf`'s transform for every role, tier and build, so today's zoomed views look the same. In Explore, the same box is contained.

### 5.6 Performance: transform-only

- **During a gesture:**
  - rAF writes `style.transform = translate3d(…) scale(…)` on the wrapper `<div>` around the `<svg>`, with `will-change: transform`
  - **no Preact render** happens per frame
  - the ambient motion pauses: the wrapper gets `.gesturing`, which calls `svg.pauseAnimations()` and sets `animation-play-state: paused` on the island's keyframe animations (sway, bob, flicker). Chrome doesn't composite animations on SVG children, so without this the scaled layer would re-rasterize the scene every frame.
- **On gesture end**, the camera commits to state once:
  - the SVG's zoom `<g>` takes the committed transform (today's `.island-zoom`, crisp at the new scale)
  - the wrapper resets to identity in the same frame
  - the animations resume
  - bubbles re-spread for the new view (`spread(…, viewRect(cam))`)
  - the bubble scale (`1.3 / k`) and the cart and hotspot hit sizes update
- **Checks:**
  - the camera test counts renders during a scripted pinch: 0 renders until pointer-up, 1 after
  - a Playwright run with CDP CPU throttling at 4× (a mid phone) records frame times during a 1 s pinch and a 1 s drag at 390 × 844, **with the ambient motion on**, on the heaviest scenes: `beaten` and `beaten-storm-night` (B adds it if the lab lacks it). Median ≤ 16.7 ms, p95 ≤ 33 ms.
- **`useStill`** already treats pointer and wheel input as activity. The ambient motion resumes after a gesture and pauses 20 s after the last input, as today.

### 5.7 Scenes from layouts, and the node budget

- **Home** keeps its bespoke drawing (`island.tsx`), refactored:
  - it takes `cam` instead of `focus`
  - it draws only home's assets (no `st`), plus network planes based or stuck at home
  - network planes go on `LAYOUTS.home.stands`
- **`StationScene`** (B, stage 3, `src/ui/map/scene.tsx`) draws a station from its layout, reusing the art components:
  - the terrain: the coast curve, beach, plateau, hill and palms from `flora`/`rocks`; `Terrain`'s helpers take a layout's shapes
  - the runway (lit or not) and apron, `Hangar` (at the hub: scale 1.25), `Cottage`, `Substation` for a panel, the feeds (poles, or underground runs with hand holes), `Plane`, `GpuCart`, `ApronProps`, `NpcFigure`
  - the new `PropKind` shapes (2.2): the dispenser, the E-stop post, the shed, the gate building, the counter, the hand hole, the floodlight
  - the same bubbles and `spread`
  - the same light of the hour, and weather from the island's week
- **Budget:** every scene ≤ 1,500 SVG nodes at `islandlab.html?w=358`. The region ≤ 400. The camera and hotspots add **0 SVG nodes**: the controls are HTML and the hit-test is JS.
  - Today the beaten home scene is 1,390 (`gap-zoom`: unchanged).
  - B measures a network plane on a home stand (a `Plane`, its bubble and its figure) in `home-fleet`. If two don't fit under 1,500, the extra planes at home are drawn as a parked silhouette (one path each).
  - `scripts/island-shots.mjs` checks the budget for every scene id in a list: `beaten`, `beaten-storm-night`, `home-fleet`, `tern-busy`, `adair-busy`, `region`.
- **New lab scenes** (`islandlab.tsx`, B):
  - stage 2: `beaten-storm-night`
  - stage 3: `home-fleet` (tier 5 with 2 network planes based at home, one on jacks); `tern-busy` (open; one cottage closed on a hazard, the panel at 45, a plane stuck there, the cart on charge, a trip badge); `adair-busy` (two planes, one in the hangar for acceptance, the cart hooked up); `region` (3 stations, 3 routes, one not flown, badges); `tern-night` (the dispenser lamp, the dark strip)

---

## 6. Interactive objects (C)

### 6.1 The hotspot registry and hit-test (`src/ui/map/hotspots.ts`, B builds it; C consumes the refs)

```ts
export type Hotspot = { ref: ObjectRef; label: string; foot: [number, number, number, number]; z: number };
export function hotspots(s: IslandState, scene: StationId | 'region', layout: SceneLayout): Hotspot[];
/** p in map units; pxPerUnit at the current k */
export function hitTest(spots: Hotspot[], p: Pt, pxPerUnit: number): { hit: Hotspot } | { choose: [Hotspot, Hotspot] } | { zoom: true } | { empty: true };
```

- **Footprints are the true drawn extents** (`foot`): the same footprints `island.tsx` uses for bubbles (`FOOT.plane`, `hangar`, `office`, the houses, `g1`, `gen`) and the layouts' equivalents. Fixtures: the runway, the bowser or dispenser, the E-stop, the dock head, the windsock (r = 16). Staff figures: `gap-zoom`'s spots. Build sites: `siteBox`'s work sites.
  - They're never grown to 44 px. At 358 px, 44 CSS px is about 98 map units, and neighbours sit 71–100 units apart (g1 and gen 80, h1 and h2 88, p1 and p2 90, the windsock and gen 71). Growing every box would bury empty ground and let figures steal taps.
- **Resolution** of a tap at `p`:
  1. **Inside one or more footprints:** the highest `z` among them, then the smallest area. True footprints rarely overlap.
  2. **Otherwise, the footprints within 22 CSS px of `p`:**
     - exactly one: that object
     - two or more: **zoom ×2 about `p`**, one predictable tap instead of a guess. At the maximum k, a two-item chooser opens instead (the two nearest).
  3. **Nothing within 22 CSS px:** empty ground (the zone toggle and the double-tap zoom).
- **Priority `z`** (it only breaks ties between overlapping true footprints):

| z | Object |
|---|---|
| 60 | carts (they keep their own SVG buttons; the registry lists them for the keyboard list) |
| 50 | staff |
| 40 | props (fuel, E-stop, windsock, dock) |
| 30 | planes |
| 20 | buildings |
| 10 | the runway |

- A tap on a bubble goes to its asset.
- **The builders' hit-test from `gap-zoom`** (within 22 CSS px of a figure's middle) becomes the `site` hotspots, so there's one registry.

### 6.2 The inspect sheet (`src/ui/inspect/InspectSheet.tsx`, C)

- **A `Sheet`** (kit.tsx), keyboard-aware, max 80% of the height on a phone.
- **The header:**
  - the object's name and station
  - one status line in the seat's words: "Flying 5 round trips · 100-hr in 31 h, about 4 weeks"; "Rentable · inspection to week 41"
  - a health bar for assets
  - open alerts by trade (chips)
- **Then the seat's section** (6.3), then **Report a problem** (6.5).
- **One primary action per seat** at the bottom (44 px): the quick check for the techs, the object's own money move for the analyst.
- **Facts come from a pure module** (`src/ui/inspect/facts.ts`, C, tested: `facts(s, ref, role) → { lines, actions }`) over A's selectors (14.3).
- **The sheet never shows hidden state:** no alert cause, no defect. A quick check shows only what a tech would see (6.4).
- **`station` and `route` refs** go to D's sheets through A's mount (14).

### 6.3 Every object, every seat

"Read" means information. The actions are the moves the seat can make from the sheet (existing actions unless marked **new**).

| Object | Mechanic | Electrician | Analyst |
|---|---|---|---|
| **Plane** | Read: airworthiness; flying / AOG (and where it's stuck) / parked / awaiting acceptance; MEL placards with their weeks; hours since the 100-hr and "100-hr in 31 h, about 4 weeks" (the cargo plane: "Phase 2 in 58 h"); open alerts and squawks; **the logbook** (the plane's own derived records, as the `logbook` puzzle reads them; newest first); the cart on it; its base and where it's worked; a route plane's "Load manifest: the pilot's, before each takeoff". Actions: **Walkaround** (**new**, 6.4), Ground / return (`tag`), Write up (`squawk`), Ground power (the GSE sheet on this plane), an open alert (Investigate). | Read: status; an electrical check asked of him (the bench order) and where the plane is. Actions: open that check. | Read: this week's flights and revenue (tours, or its route's fares); 13 weeks of parts and labour on it (`ledger.as`); lease or owned, the weekly cost, the deposit held; its route's load factor and contribution; the downtime cost if AOG (`downtimeOf`); the pilot flying it. Actions: **approve its pending card here** (`approve`), **Fleet ▸** (D's desk on this plane: assign, base, return or sell). |
| **Hangar** | Read: power (tools on or off); the hangar reports open (lights, compressor, battery charger, 28 V) and what they cost him; the carts on charge; the stores bins used of total; the plane inside. Actions: Ground power; open a report job's status. | Read: its circuits: the reports he has to fix, the GPU charger circuit (NEC 513: the charger outside the classified area; GFCI on the tool receptacles); hangar power. Actions: open his report job. | Read: stock value, bins, the carrying charge a week, POs in receiving, the carts' power cost. Actions: Stock ▸ (the planner). |
| **House** (cottage, villa, lodge; station cottages) | Read: booked or not, and which plane brought its guests. | Read: reliability; rentable or closed and why; inspection valid to week N; open complaints and hazards; made-safe tags; **the panel schedule** (derived from the model's rooms: "Kitchen 2 × 20 A 12 AWG, GFCI + AFCI · Bath 20 A GFCI · Bedrooms 15 A AFCI · Porch 20 A GFCI, WR, in-use cover · Spa 60 A 6 AWG GFCI" where a hot tub is). Actions: **Meter check** (**new**, 6.4), Red-tag / return (`tag`), Write up (`squawk`), a hazard's alert (make safe). | Read: this week's booking; the nightly × its multiple (× the station's `rateX`); occupancy; 13 weeks of revenue and repair spend; the housekeeper turning it over (skill); an extra cottage's payback (`cottagePlan`). Actions: **the nightly-rate stepper, inline** (`setRates`: the island's nightly, ±$10, with this week's projected effect from `projectWeek`); Pricing ▸. |
| **Grid** (home substation; a station's panel) | Read: "grid down: hangar tools offline, 1 hangar job" when it is; hangar power. | Read: reliability; live or down; what it feeds (houses, hangar, office, the dock or dispenser run); the generator standing by or carrying; open alerts; the breaker schedule (rating, conductor, typical load). Actions: **IR scan** (**new**, 6.4), Write up. | Read: rental at risk on a grid-down week (Σ its houses' week); repair spend; the utility autopay report if open. |
| **Generator** (home, tier 3+) | Read: its engine (service due, open alerts, the fan report). Actions: **Walkaround** (its mounts, belt and exhaust), Write up. | Read: standing by, carrying or unreliable; the weekly test; the transfer switch as installed ("60 A on #6 THWN, backed-up load 96 A": the derived site); **fuel: "about 31 h at the backed-up load"** (derived from the tank and the load); weeks it carried in the last 4. Actions: **IR scan** (the transfer switch), Red-tag. | Read: what it protects (the rental on a grid-down week); repair spend. |
| **Runway** (home; station strips) | Read: night flights on or off (tier 5: +1 flight a plane a week while the edge lights are lit); at a station, the strip's length and "day VFR only" where it has no lights. | Read: the edge lights' feed (on the island grid, status only; Port Adair's are the authority's: "not ours"; Tern Cay: none). | Read: night flights' revenue; the day-VFR cap on a route's round trips. |
| **Fuel** (home bowser and fuel dock; Tern's dispenser; its E-stop) | Read: this week's fuel (the avgas report if open); "sumped this morning: no water" (flavour); the fuel tickets vs uplift (the landing-fee and fuel reports). | Read: the dock or dispenser circuit: open alerts; the all-conductor disconnect and the E-stop at 50 ft, attended (NEC 2023 514.11); the seals (514.9); the RMC run's age. | Read: route fuel spend (13 weeks); the avgas price report. |
| **Office** | Read: the analyst's office; its outlets report if open. | Read: the office outlets report (his to fix). | Read: cash, runway (weeks of cash), this week's P&L. Actions: Desk ▸. |
| **Build site** | Read: the build (`BuildStatus`), the crew project at that site. | the same | the same. Actions: start a cottage (`build`), buy the next unit's materials. |
| **Staff figure** | Read: name, role, skill, this week ("flies 5 on Twin N-12"). | the same | the same, plus wage. Actions: **hire the board's candidate for this role, inline** (`hire`, with the card's dollar effect); Let go (`letGo`, with the severance); Hiring board ▸. |
| **Dock and boats** | Read: the AOG boat if it came this week (the part chain). | Read: the dock run (home fuel dock) alerts. | Read: the ferry (2 guest parties a week from tier 3), the supply boat (building materials), freight spend. |
| **Windsock** | Read: this week's weather and the flights lost to it. | Read: storm damage this week (houses −6, grid −8). | Read: insurance cover vs claims this season. |
| **GSE cart** | the GSE sheet, unchanged (moves are his, on site) | the same, read-only, plus the cable's re-termination history | the same, read-only |
| **Station pin, route arc** (region) | D's sheets: for the techs, the station's assets and alerts, where to book the trip, and planes on the route with their condition | the same | D's: station and route P&L, fares, round trips, payback, mothball |

Every row also has **Report a problem** (6.5).

**Review round 2, the techs' fixtures and crew (the owner's "different for each job"):** the windsock gives the mechanic this week's wind and its crosswind on runway 09/27 against each plane's demonstrated figure (twin 22 kt, Caravan 20, amphibian 15; seeded by the week, as the weather flies: a clear week inside every figure, a windy one's gusts over every one, a flight less, a storm's far over, half the flights), and the runway says it too; the electrician in a storm reads the houses and the grid in its path, with links to their sheets. The runway's edge lights and the fuel dock have a link to their breaker on the grid's sheet (the schedule and the IR scan); the fuel dock lists its open alerts as links. A pilot's figure lists the mechanic's open squawks from him (his write-ups, his hard landings, what a crewmate passed on from him); a housekeeper's links the electrician to the house they're turning over. The house's panel schedule shows the spa only once its hot-tub circuit is in (`Asset.spa`, its breaker and wire as run: stored at the sign-off, since signed-off orders are pruned after two weeks); a later hot-tub take-off on that house re-runs that circuit. Not done: a fuel-sump water check that can write up contamination (a new job the catalog doesn't have).

### 6.4 Quick checks: reading wear that is coming

**What they do** (X7: "catch an alert's early sign before it becomes a failure"):
- A check reads the asset's **upcoming wear**: the catalog kinds that are about to be drawn for it. It **never reads `s.defects`.** A test proves it: a state with defects and one without give identical views.
- Pillar 3 stays whole. A blind job's mistake still surfaces later as an incident traced to the signer, never as a check a day later.
- Whether a check may also find hidden defects is Seb's call (18.3). The default is no.

**Rules** (engine `check`, 7):
- One a week per tech (`s.checked[role] === W` blocks), **from tier 2** (`CHECK.fromTier` = `DEFECT.blindFromTier`), on an asset the tech can check, **on site**.
- The mechanic walks around planes and the generator. The electrician IR-scans panels and grids and the generator's transfer switch, or meter-checks houses.
- **The top candidate:**
  - Among the check's in-scope kinds (below) with `weight(asset, W) > 0` and nothing of that kind open on the asset, take the highest weight (ties by catalog order).
  - It shows its tell in its zone with chance `CHECK.detect × clamp((wearFrom − health) / CHECK.depth, CHECK.minShow, 1)`, from `rng(hashSeed(s.seed, 'tell', asset.id, W))`.
  - **tune:** detect 0.7, depth 10, minShow 0.3. So the tell grows with the wear: faint just under the kind's threshold, and at 0.7 once the asset is 10 points below it.
- **Every other zone** shows a benign sign.
  - **Tells come from pools of 3 or more phrasings per kind, including mild-sounding ones.** Benign signs come from pools of 3 or more per zone, including alarming-sounding ones.
  - Both are seeded by `hashSeed(asset.id, zone, W)`.
  - So "fretting dust means call it" isn't a lookup: the words change, and the reading is the skill.
- **A right call** (the zone or item with the tell):
  - raises that kind's alert now: `raiseAlert(s, { role, asset, kind, src: 'finding', foundIn: 'walkaround' | 'IR scan' | 'meter check' })` with `due = W + its lead + 1`
  - marks it `early: true`: its job plays **one order tier easier** (never under 1)
  - it takes one of the trade's slots, as any alert does, so next week's draw is one smaller: balance-neutral in count
- **A wrong call** (a zone or item without the tell):
  - raises a write-up (`src: 'check'`, a no-fault cause) on that asset for the seat
  - **it counts in the trade's open work until it's closed** (4.5), and closing it is Investigate's no-fault-found close, on site
  - so a wrong call costs a slot and a close
- **"All serviceable" / "All normal":** nothing.
- **The review line** (blind): "Ana walked around Twin N-12 and wrote up the R main." It never says whether it was right.

**The scope** (what a check can see; data in `checks.ts`, **tune**):

| Check | In scope | Where it shows | Out of scope, and what finds it |
|---|---|---|---|
| walkaround, plane | `tires` (tread at the wear bars, a lining at its wear pin), `hydraulics` (a weeping caliper), `corrosion` (bubbled paint and white powder at the wheel-half tie bolts), `spar` (working rivets at the root: a dark ring); `oil` and `cylinder` only as a **late tell**, once the asset is 10+ points under the kind's threshold ("fresh oil on the belly aft of the cowl flap") | twin: nose gear, L main, R main, L nacelle, R nacelle, wing root/empennage. Cargo: nose gear, L main, R main, cowl and nacelle, wing root, empennage. Float: L float (gear), R float (gear), cowl, wing root, empennage. | `prop`, `wire` (behind the spinner), `alternator`, `avionics`, `wb` (paperwork), `inspect100`: the oil change's engine look, the 100-hr and the records |
| walkaround, generator | `genService` (a cracked mount rubber, belt glazing, a sooty exhaust joint) | mounts, belt, exhaust, enclosure | `transfer`, `genTest` (the electrician's) |
| IR scan, a panel or grid | `xfmr` (a breaker or lug running hot **for its load**); `panelUp` (the main above 80% of its rating, continuous: this call reads the load, not the heat) | each breaker of the panel's schedule (home: derived from the tier's feeders; stations: `StationDef.panels`) | `feeder` (a buried splice: the megger finds it), `dockrun` |
| IR scan, the generator | `transfer` (the transfer switch's lugs, for their load) | transfer switch, generator breaker | — |
| meter check, a house | `flicker` (a loose neutral: one leg sags while the other rises), `trip` (a drop too big **for the run's length**), `gfci` (the test button clicks, the receptacle stays live) | each circuit of the house's schedule | `switch3`, `storm`, `hottub`, `codeprep` |

**The walkaround** (≤ 3 taps; X7's cap):
- A plan-view outline of the plane (or the generator) with every zone's observation **in one view**, as a real walkaround circles the whole aircraft.
- He taps the zone he'd write up, then **Write up**; or **All serviceable**. The pick is said on its own line above the two buttons (*Your call: L main*: review round 2, inside the button it was cut short on a phone). (Review round 1: the call names what it writes up, apart from the sheet's squawk card; the wheels' benign signs read like their tells, a lining measured or a shoulder worn, so a line not seen before can't be called unread; the Caravan's cowl has a turbine's signs.) Review round 2: the nose wheel's halves can show corrosion like the mains' (the nose gear zone could never carry a tell); the Caravan's zone is its *Cowl* (a single has no nacelle). The empennage, the Caravan's cowl and the generator's enclosure still never carry a tell: no catalog job fits them (a tail or a turbine-engine job is a content pass); they stay because a walkaround circles the whole aircraft, and their look-alike lines are what a wrong call pays for.
- The skill is reading the signs: brake dust vs fretting dust, a breather's mist vs a weeping seal, oil-can paint vs working rivets.

**The IR scan** (≤ 3 taps):
- The screen opens on the line **"Dead front off: arc-rated PPE per NFPA 70E."**
- Each breaker shows its rating, its conductor, its load (A and % of rating) and its temperature rise over ambient.
- **Load-normalized:** a breaker's expected rise is about `20 °C × (load %)²`.
  - Normal: its expected rise, plus one offset for the scan (±1 °C: the ambient, the camera) and ±0.8 °C a breaker (review round 2: ±3 °C each read like breakers at the same load 4 °C and more apart in about one clean scan in twelve, a "probable deficiency" by the help's own NETA line with nothing to find).
  - **The tell:** 10–20 °C over its expected, **at 40–70% load**.
  - **The distractor** (one a scan, seeded): a breaker at 70–79% load reading 10–13 °C, which is normal for its load. (Review round 1: at 85–95% and 14–18 °C it sat over the 80% line the help quotes and inside NETA's probable band, so a licensed electrician applying the screen's own rules wrote it up every week.)
  - **Under 40% load:** "too light to judge", never the tell (NFPA 70B's line; it was 30%). The runway edge lights are a night load: off in an afternoon scan, never the tell or the distractor.
  - So the raw temperatures overlap (a tell reads about 13–30 °C, the distractor 10–13 °C), and only reading heat against load finds it. Physically, a loose lug heats with I²R: it shows under real load, not at a trickle.
  - **The backed-up load** (review round 2, `checks.ts backedUp`): one current a week, what the transfer switch carries: the generator's weekly test run and the island panel's *Transfer switch feed* read the same amps (they had a number each, and the take-off to upsize the switch a third). With that take-off open it's the load the take-off quotes, 64–78 A on the 60 A switch and the 60 A set (107–130%: over the rating, the tell; hot for its rating and right for its load, which the help says is an overload, not a lug); else 40–70% of the set's rating. At the Resort the island panel's feed is sized for the new switch too (200 A on 3/0 Cu: a 60 A feed breaker ahead of a 200 A ATS would trip on retransfer). The generator sheet's fuel burns at it: the tier-3 set's 36 gal belly tank, the Resort's set's 150 gal sub-base tank. Before the Resort the take-off's fix is an automatic switch rated for the backed-up load (100 A, its feed breaker and conductors to match, #3 Cu) with load management holding the 60 A set to its rating (702.4(B)(2)(b)); review round 3 corrected round 2's "sized to the set": load management sizes the standby source, never the transfer equipment. The job's switch is on record (`Asset.xfer`, with the load its take-off quoted): the schedules, both scans and the generator sheet read 100 A on #3 Cu from then on, the switch and its feed still carry the take-off's load on the utility, the set's test run 80–95% of its 60 A, and the take-off never comes back. The lot (`LOT-XFER`) is "an automatic transfer switch rated for the backed-up load, with load management for the standby set". A panel upgrade signed off is on record too (`Asset.panel`: the lot's 600 A panelboard, 2 × 500 kcmil Al), and the island panel's main reads it from then on.
  - The generator house (one current through its three loaded terminations): one shared offset of ±1 °C and ±0.8 °C each, so a healthy set reads within about 2 °C across them. Its ratings follow the Resort's upgrade: 60 A on #6 Cu before it, a 200 A automatic transfer switch on 3/0 Cu after (review round 1: the take-off to upsize the 60 A switch never comes up again, and nothing replaces the new one while its warranty runs).
- The help panel cites NFPA 70B (scan at 40% load or more) and NETA's ΔT criteria (over 15 °C against similar components: a major deficiency; 4–15 °C: probable), and says a branch's reading is its load at that moment while the main is read for its continuous load (NEC 230.42(A)).
- `panelUp`'s tell is the main at 82–95% continuous. Calling it means "plan the upgrade".
- He taps the breaker he'd open, then **Write up** (the pick said above it); or **All normal**.

**The meter check on a house** (≤ 3 taps):
- Every circuit of the house in one view.
- Each shows the voltage at a receptacle with a 12 A load on, and the run's length.
- **Expected drop:** `2 × run × 12 A × Ω/1000 ft`, NEC Chapter 9 Table 8 at 75 °C, solid copper as NM cable is (12 AWG 1.93, 14 AWG 3.07; review round 2: the 20 °C values 1.6 and 2.5 read 20–25% under an electrician's calc): a 100 ft run of 12 AWG drops about 4.6 V, a 30 ft run about 1.4 V.
  - **Each receptacle reads its leg at the panel under the load (L1 with the 12 A on) less its run's drop** (review round 2: read from the transformer, a receptacle downstream read above the leg feeding it in two clean checks in three).
  - **The `trip` tell:** 3–6 V more drop than its run predicts, on a run under 50 ft (a loose backstab).
  - **The distractor:** a 120–150 ft run at 5.5–7 V, normal for its length.
  - **The `flicker` tell:** one leg at 104–110 V while the other reads 130–136 V (a loose neutral); and then every receptacle under its own 12 A load sags by the same extra volts (review round 1: they read normal).
  - **The `gfci` tell:** "Test button: it clicks, the receptacle stays live."
- The help panel cites the 3% guideline (3.6 V at 120 V; 210.19(A) informational note) as a design guide: a long run that reads what its length predicts is as built.
- He taps a circuit, then **Write up** (the pick said above it); or **All normal**.

**Bots and balance:**
- The bots use checks (12.1), so the paper sim prices them.
- They start at tier 2, and T7 reports the standard and robust runs with checks and flags on and off.

### 6.5 Report a problem

- **On an asset another trade owns** (the generator is owned by both techs: neither flags it, and both can write it up), any seat can flag it: `flag` (**new**).
  - **From week 3** (`REPORT.fromWeek`).
  - One a week per seat. **Each trade receives at most one flag a week from the other tech and one from the analyst** (review round 1: one a week in all let a tech-to-tech flag lock the analyst out); a second from the same side sees "Mia already has a flag from a crewmate this week: message Mia instead".
  - **What it raises:** a write-up alert for the owner trade on that asset, `who` = the flagger, `by` = the flagger's seat, **passed on in its source's words** (review round 1): "Seb passed on a guest's complaint at Cottage 1: …", "Ben passed on a squawk from Hemi (the pilot) on Twin N-12: …" (`via` = the pilot), "Seb passed on the utility's log for the island grid: …". The island's feed says what went on the list, once, in the flagger's colour (review round 2: written for both seats it showed twice), and the flagger's sheet says it. A flagged airworthiness squawk gives the mechanic a week before it grounds the plane. **A flagged hazard closes its house at once, like any hazard** (review round 2: round 1's week of grace kept a reported shock rented while the sheets said it was shut; no licensed electrician keeps a unit rented on one): its due week is the week after, and the electrician can make it safe after ending the turn (`econ.ts safeAfterTurn`: a hazard passed on this week). The analyst's generator flag goes to the mechanic unless he already has this week's flag from her (her side's cap, `flaggedFrom`; review round 2: an unrelated tech-to-tech flag sent it to the electrician).
    - It's drawn only from symptom-bearing kinds a layperson could see or be told: `SYMPTOMS` rows with source `guest`, `squawk` or `utility` whose cause kind has weight above 0 on the asset, excluding `wb`, `inspect100`, `codeprep` and `gpustart`, and never a meter reading (`E_DEAD_CIRCUIT`). Never on a house closed for its renovation.
    - They're weighted by `weight × (1 + (100 − health)/40)`, as the generator does, and raised through `pairsFor`.
  - **If nothing qualifies** (a healthy asset), it's a no-fault write-up (`src: 'flag'`, cause −1), never a hazard. It holds a slot until it's closed, like a quick check's wrong call (review round 3; it took none before), and costs the owner a no-fault close; with the owner away, autopilot closes it as no fault found at the resolve before it's due.
  - **A flag takes a slot, never adds one** (review round 3): it's refused while the receiving trade's list (its open alerts, real or not, and its workable jobs) is at the week's draw target (4 open, 5 from tier 3), so it fills a slot the next draw would have filled. Never a symptom already live on the asset; every flag due the week after at the soonest. A hazard passed on after the electrician ended the turn and still open at the resolve gets autopilot's job flow there, as an away seat's would (made safe by the book with a branch breaker, never a service-neutral fault; planned by the book; signed off at 50% with its parts on the shelf: round-3 verification), and a push tells the receiver. One passed on during the electrician's turn leads the End turn sheet ("Make it safe or fix it, or Cottage 1 stays closed") and Your move. A flag never draws the kind the receiver's own quick check shows on that asset that week, nor a kind open or closed on it that week (round-3 verification: a flag and a right call raised two jobs for one fault). `balance.ts robust` has a `flag weekly` row (every seat reporting the lowest-health asset it may, every week it can).
  - **The words say what it does:** "Passes on what a guest reported about Cottage 1: one alert on Mia's list, from you, until Mia closes it. You'll see what it said."
  - The sheet shows the fixer's name: "Tell Mia about Cottage 3".
- **On a fixture** (hangar, office, runway, fuel, dock, windsock):
  - the open reports about it, with the fixer and the effect
  - a **Message <trade>** button that opens the crew board DM to that seat, prefilled "About the hangar: " (`openDm(role, prefill)`, exported by A from `crewboard.tsx`)
  - no engine change. A player-raised *report* would carry a cap or a leak on the reporter, so raising one on purpose would be self-harm or a fake (16).
- **On a plane or a house of the viewer's own trade:** today's **Write up** (`squawk`).

---

## 7. Engine actions (A)

- **The network analyst actions carry no role,** like `approve`, `buy`, `setRates` and `hire` today. The engine doesn't check the seat (the trust model), and the UI offers them to the analyst.
- Every action below except `setRoute` is in `WEEK_BOUND`.
- `check` and `flag` are stage 2; the rest are stage 3.

| Action | Validation (the error text is the UI's) | Effect |
|---|---|---|
| `{ t: 'openStation', st, week }` | `STATIONS[st]`; tier ≥ 5 and `W ≥ tierReachedWeek[5] + NET.settle`; not already in `s.net.stations`; no `s.project`; `receivership === 0`; `spendable − capex ≥ NET.floor` ("That would leave $X spendable; the floor is $25,000.") | `s.net ??= { stations: [], fleet: [] }`; push `{ id: st, state: 'project', since: W }`; cash − capex (booked `capex`); `s.project = { tier: s.tier, st, title, orders }` with a `project` order per seat (tier `NET.projectTier`); feed |
| `{ t: 'dropStation', st, week }` | the station is a `project` | its project orders cancelled and their reservations released; the entry removed; cash + capex; feed |
| `{ t: 'mothball', st, on, week }` | on: the station is open, no plane based there, no plane on a route into it ("Move or park Twin 7KT first"). Off: it's mothballed | state and `since`. On: its alerts closed `'dropped'`, its orders cancelled, their reservations released. Off (it reopens next week): a code-prep must-do on each of its houses. |
| `{ t: 'fleet', op: 'lease' \| 'buy', model, base, route?, week }` | a station open or in project; network planes (delivered + pending) < `NET.maxNetPlanes`; `route` open, or its far end the open project's station (then it's parked until the station opens); `base` an end of `route` (no route: base home or open, parked); spendable − (buy ? price : `deposit × lease`) ≥ floor; no receivership | push a `FleetEntry` with `pending: { base, route }`; buy: the price leaves the bank (`capex`); lease: the deposit leaves the bank (held); feed "Delivered at Port Adair next week; flies the week after its acceptance". If no pilot can be hired (the staff cap), the card warns; it doesn't refuse. |
| `{ t: 'fleetEnd', asset, week }` | a network plane; not the open chain's plane ("Finish or drop its part chain first") | lease: an early fee if under the minimum; the deposit back less the true-up; buy: the resale in. The asset removed; its open orders cancelled; its alerts closed `'dropped'`; reservations released; its cart unhooked; the entry removed |
| `{ t: 'assign', asset, route: RouteId \| null, base?, week }` | a plane; one assign per plane per week (`moved === W` blocks). **Home tier planes:** `route` null or a route with a home end; their base stays home. **Network planes:** `route` open and `base` one of its ends ("Adair–Tern planes are based at Adair or Tern Cay"); `route` null parks it at `base`. Home keeps at least one island-ops guest plane (4.3). | `rt`; `st` = base; `moved = W`; a base change sets `movedBase = W` (−1 round trip this week) |
| `{ t: 'setRoute', route, fare?, freq? }` | the route open; fare within 0.5–2× the reference, rounded to $5; freq 1 … the route's cap (4 into an unlit end, else `flightsPerPlane`), or null for all | `s.net.fares` / `s.net.freq` |
| `{ t: 'trip', role, st, week }` | mech or elec; the turn not ended; `st` open, or the open project's station (for a `site` job), and not home; no trip for this seat this week | push `{ role, st, week: W, usd, how }` (4.6); cash − usd (booked `travel`, trade: role, station: st; **not** `autoSpent`); allowed with cash below the cost; feed "Mia flies to Tern Cay this week (a seat on our flight, $60 per diem)" |
| `{ t: 'check', role, assetId, item: string \| null, week }` | mech or elec; tier ≥ `CHECK.fromTier`; the turn not ended; `checked[role] !== W`; the asset checkable by the seat (6.4); on site; `item` one of `checkView`'s items, or null | `checked[role] = W`; the tell's item → its alert, `early` (6.4); another item → a `src: 'check'` write-up; null → nothing; feed (blind) |
| `{ t: 'flag', role, assetId, week }` | week ≥ `REPORT.fromWeek`; the seat's turn not ended; `flagged[role] !== W`; the asset exists, isn't the seat's own trade's, and isn't the generator for a tech; its owner trade has no flag this week | `flagged[role] = W`; the owner's alert (6.5); feed |
| `hire` (today's) | `cand.st` open if set; the staff cap + open stations' `staffRoom` | `npc.st = cand.st` for a housekeeper |

**Changed actions:**
- **`complete`:** `SITE_BOUND` (the trip words); the per-station grid-down cap; `reportCap(s, role, siteOfOrder)`.
- **`nff`, `makeSafe`:** `SITE_BOUND`.
- **`mel`:** `SITE_BOUND` when the item is `m: true`.
- **`gse`:** on site; the cart's station against the plane's work station (4.8).
- **`tag`:** allowed anywhere (4.6). For a station house off site the words are "The station agent opened Cottage A's disconnect: it's closed until you're there".
- **`approve`:** a station job's card gets the drop-ship words.
- **`plan`, `repick`, `squawk`:** unchanged.

**What `resolveWeek` does with them:** 8.

---

## 8. The week, in order

Today's steps are unchanged except where marked. **Every network addition is skipped when `s.net` is absent. The checks' and flags' effects happen at the action, not at the resolve.**

| Step | What |
|---|---|
| open | **Fleet delivery:** each entry with `pending` gets its plane (`f<nextId>`, health 85, `st` = `pending.base`, `rt` = `pending.route`, the fly-away kit into stock, its two acceptance must-dos at `deliveryStation`); `pending` deleted. **Trips pruned** to W − 1 … W. **The alert pass** (4.5: one pass). Fin tasks. **Reports:** the hub rule; station-only rows while their station is open. **The hiring board:** +1 candidate per open station. **The weak battery:** every accepted, flying plane. |
| 0 | blind sign-offs settle |
| 1 | autopilot (techs: **a trip for urgent station work, then its site moves**; the analyst: **the loss guard**, 12.2) |
| 1b | standing approvals |
| 2 | **Flights.** Every plane's capacity as today; `capFleet` (home's island-ops planes first). Island-ops planes → home's guest slots and tours as today. **Route planes fly `n = min(cap after capFleet, routeFreq, the day-VFR cap)`, less 1 in a `movedBase` week, and 0 before acceptance, grounded or parked.** Their wear (`flightWear × n`), near-miss rolls, hard landings and `flown` use `n`. **The 100-hr counts hours:** `sinceInspection += n × 2 × block × blockX × NET.inspPerH`. Their `scheduled` in the grade is `min(planeCapacity(health 100), routeFreq)` (the timetable), from `NET.flightsGrace` weeks after acceptance. `pilotSeats` spends duty by those hours. |
| **2b** | **`routeWeek`** for each open route with round trips (3.3): pax, fares, connecting passengers, freight, fuel, fees, station arrivals; `ledger.rt` |
| 3 | receiving (a drop-ship is only a label: stock is central); carriers include route flights with a home end |
| 4 | power, **per station**; the carts charge on their station's power |
| 5 | houses and guests at home, as today |
| **5b** | **each open station:** its rentable houses (`powered(s, st)`), its arrivals from 2b, its housekeepers, its rentals at `rateX`; guest parties take seats (3.3); `ledger.stn` |
| 6 | charter (home only) |
| 7, 7b | deferral risk; defects surfacing. **Every asset except a mothballed station's.** |
| 8 | carry-over |
| 9 | **Decay:** every plane and every home asset by home's rule (ECON.decay, with A0); a station's assets by its `decay ?? home's rule`; a mothballed station's not at all. A0's spiral breaker: a dark house doesn't decay in a grid-down week. Storms hit every open station's houses and panels. |
| 10, 10b | money hunts; reports (a hub report's lines name Port Adair) |
| 11 | **Cash:** + `netRevenue`; − network costs (open stations' overhead, mothballed × 0.3, weekly leases, hull, route fuel and fees). Capex, deposits, buys and travel were booked when they happened. `report.costs.network`, `report.netRevenue`, `report.netContribution`. |
| 11b, 11c | replenishment; builds (home) |
| 12 | forecasts |
| 13 | **The grade.** `gRev = (home revenue + N) / (home budget + B)`, where `N` is the network contribution of stations past their `NET.probation` weeks (with their routes) and `B` is Σ their contribution budgets. A station in probation, and its routes, are out of both. **The A bonus** (`ECON.aGradeBonus`) is paid on home revenue only. Flights: island ops as today, plus route planes at their timetable after their grace. Safety: the whole fleet. |
| 14–18 | stats, XP, the tier-up / **station-opening** project check (`finishProjectIfDone`: `addAsset`, the electrician's defect roll on the built asset), stories, MVP lines |
| 19 | the ledger closes (with `rt`, `stn`) |

- **The grade in numbers:**
  - Good-play Tern Cay: +$1,440 of contribution against a $600 budget. It lifts the grade a little once it's out of probation.
  - The naive network: about −$2,150 against +$1,600 of budget. A 95% home week becomes (20,900 − 2,150) ÷ (22,000 + 1,600) = 79%, a C.
  - **So expanding badly costs the grade and the credits,** and expanding well helps only by its profit. Test: the naive bot's A-week rate is no higher than the no-network run's (T3).

---

## 9. Screens, phone first, with tap counts

**Shared rules:**
- 390 × 844 first; desktop at 1280 × 820 (the map on the left, the work on the right, as today)
- 44 px targets
- one primary action per sheet
- the keyboard never covers a sheet's action (kit.tsx `Sheet`)

### 9.1 The map (B)

| Flow | Taps |
|---|---|
| Scroll Home past the map | 0 (one finger, always) |
| Zoom and pan inline | 0 (two fingers; double-tap; Ctrl + wheel and drag on desktop) |
| My zone / All / Build site | 1 chip |
| Explore full-screen | 1 (⤢) |
| Region, then a station | 1 (Region) + 1 (pin) + 1 (Go there) |
| An object among close neighbours | 1 (the map zooms ×2) + 1 |
| Keyboard: the object list | Tab, Enter, then arrows |

### 9.2 Objects (C)

| Flow | Taps |
|---|---|
| Open any object's sheet | 1 |
| Walkaround | 1 (Walkaround) + 1 (a zone) + 1 (Write it up) = 3; or 1 + 1 (All serviceable) = 2 |
| IR scan | 1 (IR scan) + 1 (a breaker) + 1 (Open it up) = 3; or 2 (All normal) |
| Meter check | 1 + 1 + 1 = 3; or 2 |
| Report a problem (flag) | 1 (Report to Mia) + 1 (confirm) = 2 |
| Message a trade about a fixture | 1 → the DM composer |
| The analyst: approve a plane's card, step a house's nightly rate, hire from a staff figure | 1 in the sheet (+1 confirm for a hire) |

### 9.3 The Network desk (D; the analyst's desk gets a **Network** tab)

- **The tab** appears at tier 5 (stage 3). Before that, the desk shows a locked card: "After the Resort: an airline."
- **The top strip:**
  - network contribution this week and over 8 weeks
  - load factor across routes
  - planes (flying / stuck / parked / awaiting acceptance)
  - **the load gauge per trade** (`loadGauge`): "Electrician: 14 assets · condition −1.1 a week (4 weeks) · 3.1 jobs a week done · 0.4 must-dos a week". Derived from asset health over the last 4 ledger weeks, jobs signed off and the must-dos raised. The analyst reads it before opening or leasing.
- **Station cards:**
  - catalog order
  - state; capex; overhead; the payback projection at today's fares with its P10–P90 band and its assumptions (the plane it needs, round trips, the ramp, the maintenance line)
  - **Open** (disabled with the reason: tier, settle weeks, floor, a project open, stage 1's gate)
  - once open: an 8-week P&L sparkline, the grade line ("in the grade from week 31"), **Mothball** / **Reopen**
- **Route cards:**
  - the fare on the route's demand curve (D's own curve component, drawn like the Pricing tab's), with seats marked, so a peak that outgrows the plane shows where raising the fare pays
  - round trips a week (a stepper, 1 … its cap; "day VFR only" where an end is unlit)
  - planes on it; LF; cost per seat; contribution with its lines; the P10–P90 band; the ramp ("week 3 of 8 ramping up")
  - connecting passengers, when they apply
  - a warning under 45% full for 2 weeks
  - the one-plane risk line where a station's houses depend on it
- **Fleet:**
  - per plane: base, route or parked, lease or owned, weekly cost, deposit, 8-week contribution, acceptance state
  - **Assign** (a sheet: route chips, base chips limited to the route's ends)
  - **Return** / **Sell** (with the fee, the true-up or the resale)
  - **Lease or buy a plane:** a sheet with the model chips, the lease-vs-buy card, base and route chips, the delivery station, the pilot line, confirm

| Flow | Taps |
|---|---|
| Open a station | Network (1) → Open (1) → confirm (1) = 3 |
| Lease a plane | Network (1) → Lease or buy (1) → model (1) → route + base (2) → confirm (1) = 6 |
| Set a fare | Network (1) → route card (1) → drag → done (1) = 3 |
| Assign a plane | Network (1) → plane (1) → route chip (1) → confirm (1) = 4 |
| Mothball | Network (1) → station (1) → Mothball (1) → confirm (1) = 4 |

### 9.4 The techs' outstation screens (D)

- **The ops panel** groups the asset list by station (home first). Each station header has its trip state: "Trip: this week (booked)" or **Book trip · $60**.
- **The mechanic's Due list** (`dueList`, on his ops panel): each plane's next inspection in hours and weeks ("100-hr in 31 h, about 4 weeks"; the cargo plane: "Phase 2 in 58 h"); its MEL placards with their expiry; where it is (base, stuck at Tern Cay, at Port Adair for acceptance, parked). It's maintenance control on one card.
- **The job card (`JobView`):** a station line under the asset:
  - "At Tern Cay: book the trip to work here (a seat on our flight, $60 per diem)"
  - "Stuck at Tern Cay (AOG): the fix is there"
  - plus where the part is (4.7)
  - The trip button books it in 2 taps: Book → confirm.
- **`StockStep`:** "you carry it" / "hazmat: the next company flight" / "drop-shipped, week 31" beside each line.
- **The GSE sheet:** carts grouped by station.
- **The station sheet** (the region pin, for the techs): its assets and their alerts, and the trip button.

### 9.5 What's new (version-keyed; one sheet component, panels per stage)

- **One sheet component** (`src/ui/whatsnew.tsx`, A writes the shell), keyed by the release's version, **once per island and seat on this device**, like the v3 one (`localStorage`, guarded).
  - It opens on an island that played before that version.
  - A new island sees only what applies at week 1.
- **Stage 2's panels** (C, `src/ui/inspect/WhatsNewMap.tsx`):
  1. **Explore the map:** two fingers to move and zoom, double-tap, the presets, ⤢ Explore.
  2. **Tap anything:** what your seat sees and can do there.
  3. **Your quick check** (the techs; "from tier 2" on a newer island) and **Report a problem** (from week 3).
  4. The fixes in this release, in plain words.
  - A new island's week 1 shows only panel 1.
- **Stage 3's panels** (D, `src/ui/network/WhatsNewNet.tsx`): "After the Resort: an airline" (at tier 5: "Open Tern Cay from the desk"); trips; where planes are worked; the Due list.

---

## 10. Migration and the version gate

### 10.1 Versions (0.5)

- **`gaps` goes out as v4:** ENGINE_VERSION 4, DOC_VERSION 4, rules `request.resource.data.v == 4`, one deploy of hosting and rules together. That's the `gaps` integrator's bump, not this build's.
- **Stage 1 (A0)** rides in `gaps`' v4 if `gaps` hasn't deployed when A0 is ready. Otherwise it's its own bump: it changes the resolve from tier 4, and an open older client would resolve a week on the old numbers.
- **Stages 2 and 3** each bump to live + 1.
  - Stage 2 needs it: new actions (`check`, `flag`), new alert sources that the open work counts, and `alert.early`.
  - Stage 3 needs it: the network.
- If `gaps` + A0 ship as v4, stage 2 is **v5** and stage 3 **v6**.
- The code says `ENGINE_VERSION = N` once per stage. **Nothing in the spec or the code hard-wires "v4"**: the What's new sheet is keyed by the release's version (9.5).

### 10.2 `migrate()`

- **Nothing for any stage:** every field is lazy. **One exception, G0 (stage 2, 11.2a):** a doc an older engine wrote (engine < 5) at tier 4–5 gets, once (stamped `stats.g0From`), the builder's warranty dated from its Harbor and Resort buildings and the service upgrade at release; a doc this build wrote is never migrated (the golden test checks it).
- It must stay idempotent. It must not write `s.net`, `checked`, `flagged` or any asset field. The golden test (13.1) fails if it does.

### 10.3 Fixtures and skew (every stage)

- **Fixtures from the previous live commit, written by that engine**, never by hand, like `scripts/fixtures-v2.ts`:
  - `tests/fixtures/v3-bd1e1d2-*.json`: early, mid-week, late, a part chain, a repair. `gaps` already has three `v3-bd1e1d2-restricted-*`.
  - `tests/fixtures/v4-<gaps deploy commit>-*.json`, the same set. That will be the previous live commit when stage 2 ships.
  - For stage 3: `v5-<stage-2 deploy commit>-*.json` as well.
- **A extends the skew test:**
  - each fixture loads, runs every selector (the new ones must return empty or home-only on it) and plays 10 weeks, the same in memory and through JSON
  - `s.net`, `checked` and `flagged` stay absent until used
  - **network fixtures** (A's bots, `tests/fixtures/net-*.json`): a project open; Tern Cay open with a trip booked and a plane stuck there; both open with 2 leased planes, one awaiting acceptance at Port Adair; a mothballed station. Each round-trips through JSON and plays 10 weeks.
  - **reverse skew:** a build at the previous engine refuses to apply any move to a doc at the new engine ("saved by a newer version… reload"). The existing check, extended with a stage-2 and a network fixture.
- **The live probe** after each deploy: `docs/handoff/probe-gate.mts` with the old `v` → `permission-denied`, and the new `v` → `not-found`. It never writes a doc and deletes its anonymous user.

### 10.4 Telling the crew

- The deploy note says **close and reopen the app** (twice if the first open still served the cached copy), every stage.
- The What's new sheet (9.5) explains each stage.

---

## 11. Balance plan

### 11.1 Targets

| # | Run | Target |
|---|---|---|
| T0 | standard (26 wk × 30 seeds) | three friends and all average reach tier 5 at weeks 21–23 (median), 0 weeks below $0; solo, absent and nobody stay at tier 1; the pacing guard holds; the robust sweep is no worse than `gaps`' own numbers as landed (with `gap-charter` it's 93 / 360 and 76 / 360; the robust-tail levers will move them) |
| T1 (A0) | long (52 wk × 30 seeds, no network) | weeks 24–52: three friends and all average at a median of 0 weeks below $0; at most 3 of 30 games ever below $0; median dead weeks (revenue < $2,000) ≤ 2 a game; **the credits (8 straight A weeks at tier 5; from review round 1: 8 full-crew A weeks played at the Resort, none below A) reached in ≥ 50% of three-friends games by week 45**; tier medians as in T0. Proposed in review round 1, the hold line: the median three-friends game keeps ≥ 4 of 7 houses rentable at week 52, with revenue ≥ 70% of budget in weeks 40–52 |
| T2 | network (52 wk × 30 seeds), good network bot | cash at week 52 ≥ the no-network run + $20,000 (median of paired seeds); **each station opened by week 36 pays back by week 52 in ≥ 60% of the games that open it**; weeks below $0 as T1; the good bot's trunk fare differs from the reference in ≥ 30% of peak weeks (fares are a real lever) |
| T3 | network, naive bot | median cash at week 52 below the no-network run's; the naive bot's A-week rate ≤ the no-network run's (the grade can't be gamed by expanding) |
| T4 | network, one bad call (a leased twin from week 30, left parked) | ≥ 29 of 30 games never below $0 in weeks 24–52 (nobody is bankrupted by one bad call) |
| T4b | the same, with the analyst away weeks 31–33 | ≥ 28 of 30 (the loss guard, 12.2) |
| T5 | network, good bot: the load | the median health of home's assets in weeks 30–52 within 5 points of the no-network run; network must-dos ≤ 0.5 a week per trade; **the trips a week per tech reported** (the mechanic's should be above 0: acceptances, planes stuck away, hub work) |
| T6 | doc size | a 52-week network game, the maximum over the good and the naive bot, < 150 KB; its network fields < 18 KB |
| T7 | quick checks and flags on vs off | T0 holds with them on; the robust tail no worse; both runs reported, **the tier-3 unlock week** included (checks change incident counts, and tier 3 needs 0 incidents over 4 weeks) |
| T8 | robust network (`balance.ts network robust`: the robust crews, 90 seeds × 4 crews, 52 weeks) | weeks below $0 and receiverships no worse with the good network bot than without a network |
| T9 | network, the exploit bot (leases up to the cap and parks or under-flies them to hold them) | its cash at week 52 below the good bot's; there is no island-ops flying for network planes to exploit |

### 11.2 A0: a Resort that holds (stage 1)

> **Status (2026-09-29, branch `gaps`, v4): built, one balance pass, then review round 1. T1: every line met but the credits.** A0 as first built (e, g, a, b, c at 3, f; d tested and not kept) **only delayed the collapse**: about 13 weeks for three friends and 26 for all average, which the 52-week columns hid (at week 52 their houses were at health 4 and 8, 0 of 7 rentable, and 30 and 27 of 30 games went below $0 in weeks 53–78; `balance.ts long 78`). Review round 1 (DECISIONS "2026-09-29: A0 review round 1") added the lever that holds: **the electrician's helper**, an NPC the analyst hires from tier 4 who does the electrician's planned routine jobs at the resolve and lets the alert flow grow with them. Also: the credits count only weeks played at the Resort (a Harbor streak had paid out on the arrival week), grid first only at real risk and on the feed, (g) dropped (a dark house rots), a receiver who funds safety work below $0. Long run now, weeks 24–52: three friends 3/30 games below $0 (median 0 weeks, 0 dead weeks), 6 of 7 houses rentable at week 52; all average 1/30, 7 of 7, and it holds through week 78. Three friends still slide after week 52 (2 of 7 rentable at week 78, 11/30 games below $0 in weeks 53–78). The credits, counted honestly: 0/30 for both (a gate question for Seb). T0 holds (standard unchanged; robust 69 → 70 and 63 → 58 misses, 0 weeks below $0). The golden digests are re-recorded: four 26-week and four 52-week runs, every week's doc (`tests/golden.test.ts`).
>
> **Release gate (DECISIONS "2026-09-29: stage 1 release gate"):** the electrician's helper is held back (`STAFF.helper.enabled` false) until Seb decides, because it breaks rule 7 ("NPCs never do trade work"). On the release build, T1 is not met: three friends have 18 of 30 games below $0 in weeks 24–52, and all average 8 of 30. Both have 0 of 7 houses rentable at week 52. That is A0 alone. T0 is unchanged. The helper's numbers, with it on and narrowed to the routine device swaps, are in that entry.

- **The finding and the numbers are in 0.3.** A0 lands first, on top of `gaps`.
- **Order:**
  1. **Measure `gaps` as landed on the long run.** Its staggered code notices and alert throttle aim at the tier-4 electrician overload that starts the slide.
  2. **Then these levers, from tier 4, tested together** (the critic's week-1 runs show one at a time isn't enough). Each combination runs the long, standard and robust runs, and every one stays inside T0's band.
     - **(e) Grid first:** the grid under 55 is a must-do, ranked above code prep for the bots, autopilot and the Dock. The grid is the single point of failure.
     - **(g) A spiral breaker:** a dark house doesn't decay in a grid-down week. Nobody's in it.
     - (a) Code inspections every 13 weeks from tier 4 (`ECON.houseInspectionWeeks`). Rental inspections are annual in real life; 8 weeks is harsh.
     - (b) `ECON.houseWear` 2 → 1 from tier 4.
     - (c) Decay 5 → 3–4 for assets at or above 70 health from tier 4. A maintained building doesn't lose 5% a week. It applies to **every** plane and every home asset alike, so the same model wears the same wherever it flies.
     - (d) No "+1 alert tier under 50" from tier 4. It compounds the slide: harder jobs exactly when the island is failing.
     - **(f) The credits' A streak pauses on an autopilot week,** instead of resetting (engine.ts:4145). The week still doesn't count, so nobody wins alone. Today one absence wipes a 7-week streak.
  3. **Time box: one balance pass,** about a day of sim runs.
     - If T1 is met, record the levers and the numbers in `docs/DECISIONS.md`.
     - **If it isn't, stop and send Seb the table:** the best combination's numbers against T1, and the call: ship stage 3 on it anyway, or keep working A0. The network doesn't wait with no end date.
  4. **The golden digests** (13.1) are recorded **after** A0, since A0 is allowed to change play from tier 4.

### 11.2a G0: the Resort holds for 64 weeks (stage 2, v5)

> **Status (2026-09-30, branch `s2rel`, v5; DECISIONS "G0, the Resort holds for 64 weeks"): built. The 64-week line is met.** The G0 probes and their synthesis chose the upkeep structure with the electrician's helper off: **the builder's warranty** (from tier 4 new construction loses 1 a week untouched for 26 weeks), **the service upgrade** (the grid's new transformer and feeder at tier 4, the Resort's standby set at tier 5, under the same warranty), and **renovations** (the analyst's capex from tier 4 on a house at 75 or below; the builders close it for two work units, the county's permit final (the electrician's final prep, then the inspector) reopens it at 85 under a 13-week warranty; one per house every 26 weeks), with the fin bot's policy (`RENO_BOT`). Review round 2: the Resort's upgrade retires the old standby set's unfinished work, by what its alerts say (the set's weekly-run squawks, the switch's take-off and a transfer that didn't pick up, the checks' write-ups on them; never by an alert's hidden cause) and the jobs planned from them, with their reserved stock, requisitions, the lines still with the vendor and a never-started job's labour, and the old set's hidden defects (`migrate.ts retireOldSwitch`, at the tier-up and in the migration); a renovation whose last builder is let go says it waits for a builder (and the let-go says the house stays closed). The credits' goal is **one data switch** (`GOAL.rule`: `streak`, the default, or `quarter`, two months on plan at the Resort, computed from the week reports); Seb decides which ships. Live islands at tier 4–5 get a one-time migration (the warranty dated from their buildings, the upgrade granted at release). This is the one stage that migrates (10.2), and it bumps the version constants to 5 here.
>
> `balance.ts long64` (64 weeks × 30 seeds, weeks 24–64): three friends 0/30 games below $0, 0 receiverships, houses 71/63/59 at weeks 39/52/64 (e810cc5: 28/30, 28/30, 22/4/3); all average 0/30, 0, 79/74/71 (17/30, 14/30, 46/9/3). The credits by week 52: `streak` 0/30 and 0/30; `quarter` 25/30 (median week 36) and 30/30 (week 34). T0 unchanged (standard medians 8/11/16/23 and 7/12/16/23, 0 weeks below $0; solo, absent and nobody at tier 1); robust misses 61 and 39 of 360 (e810cc5: 70 and 64), the robust long column 2 and 0 of 360 games below $0 (248 and 115). After week 64 (to 91) the 26-week renovation cooldown costs three friends 4 more receiverships of 30 than a 13-week one (7 vs 3): Seb's call. Live islands switched at week 26: three friends 4/30 into receivership by week 64 (12/30 without the migration); switched later the houses are too far gone on stage 1 (week 39: 20/30).

### 11.3 Network knobs

**Where they live:**
- `STATIONS[].capex`, `overhead`, `budget`, `decay`, `rateX`, `staffRoom`
- `ROUTES[].demand`, `amp`, `fare`, `block`, `fees`, `cargo`
- `PLANE_OPS`
- `NET`: the floor, the fare curve, frequency, the ramp and maturity, connecting, trips, lease terms, the deposit and true-up, resale, capital, hull, the card's maintenance line, mothball, probation, the flights grace, the inspection and duty rates, the guard
- `CHECK` (`detect`, `depth`, `minShow`, the scopes, the IR and meter bands)

**Tuning order:**
1. route demand, `amp` and fares (T2, T3)
2. station capex and overhead (T2's payback)
3. the station budgets (T3's grade)
4. the floor, lease terms and the guard (T4, T4b)
5. `CHECK` (T7)

If T2's payback can't be met inside 52 weeks, run the network sim for 64 weeks and report both.

### 11.4 The runs (`scripts/balance.ts`, A)

| Command | What it runs |
|---|---|
| `npx tsx scripts/balance.ts long [78]` | 52 wk × 30 seeds, no network: the T1 table (weeks below $0 in weeks 24–52, dead weeks, median cash at 26/39/52, the credits' week, A-week rate) and the trajectory (houses rentable at weeks 40 and 52, house and grid health at 52, revenue against budget in weeks 40–52, the cash slope over weeks 39–52); `78` plays on and adds weeks 65 and 78 (review round 1: the 52-week window hid a delayed collapse) |
| `… network` | 52 wk × 30 seeds: three friends and all average, each with no network, the good network bot, the naive one, one bad call (± the analyst away), and the exploit bot (T2–T6, T9). Per station: opened week, payback week, contribution. Per route: LF, contribution, fare vs reference. Per trade: trips and must-dos a week, home asset health. |
| `… network --cards` | the §3.3 worked tables from the engine's own `projectNet` (a test compares them) |
| `… network robust` | T8 |
| `… robust` | unchanged, plus a `long` column |
| standard | unchanged; plus `checks=off` for T7 |

**Timing:** a 52-week sim runs in about 0.7 s. `network` is about 300 sims, about 4 minutes; `network robust` about 1,440 sims, about 17 minutes. Run them sequentially on a shared machine.

### 11.5 Proof that tier 1–5 pacing is untouched

1. **Engine identity:** the golden test (13.1). With the network never opened and checks and flags never used, 26 weeks for three friends (seeds 1–3) and all average (seed 1) produce the same JSON digest as the base recorded after A0.
2. **The network can't start before tier 5 + 2 weeks.** It's validated in `openStation` and tested, and no other network action works without an open station or project.
3. **Checks (from tier 2) and flags (from week 3) are the only new mechanics before tier 5.** T7 reports the standard and robust runs on and off. T0 must hold with them on. If the medians leave 21–23 or the tier-3 unlock week moves more than a week, lower `CHECK.detect` or start the checks at tier 3.

---

## 12. Bots and autopilot

### 12.1 Bots (`bots.ts`, A)

- **`Bot.net?: 'good' | 'naive' | 'badcall' | 'exploit'`** (the analyst), **`Bot.checks?: boolean`**, **`Bot.flags?: boolean`**. Checks and flags default to true for the standard teams, and to false in the golden test.
- **The good network policy** is written by `StationDef.kind` and projected payback, **with no station or route ids** (the grep guard covers `bots.ts`):
  - **Open** the station with the best projected payback (`projectNet`) at the first allowed week with spendable ≥ capex + $40,000.
    - An outstation first (the smaller capex).
    - A hub once the first station has had 6 weeks of positive contribution.
  - **Lease** a twin for the new station's route with a home end, **in the project's first week** if its delivery would come home and fly at the opening; otherwise after the opening.
    - Base it at home when the route has a home end.
    - Round trips and fare: a grid search over round trips (1 … cap) and fares (0.8–1.3×) by `projectNet`, including connecting passengers. Re-run weekly, so the fare rises when a peak outgrows the seats.
  - **A second plane on a route** only if its LF has been > 90% for 3 weeks and `projectNet` says the marginal plane is positive. A point-to-point route only if `projectNet` says the network gains once connecting passengers are lost.
  - **The float stays on island ops** unless its route contribution beats its home tours (`downtimeOf`).
  - **Staff:** a pilot when `capacityLost.flights > 0` (the pool in hours); a housekeeper for a station when its houses sit empty.
  - **Exits:**
    - mothball a station whose 8-week contribution averages < −$1,000 (parking its planes first)
    - return a lease under 40% LF for 4 weeks once past its minimum
    - drop a project that has waited 4 weeks
- **Naive:** opens every station as soon as allowed; leases up to the cap (two on the trunk first); flies every round trip; fares at 1.5×; never mothballs, returns or drops.
- **Bad call:** the good policy, plus a twin leased at week 30 and left parked.
- **Exploit:** leases up to the cap and holds them parked or at 1 round trip (T9).
- **Techs:**
  - **Trips:** book the week's trip to the station with the most urgent site-bound work (a grounding, a close, due this week or next, an acceptance, a hub report), before playing. Then play as today, over home and that station's jobs, with its site moves.
  - **Quick checks:** check the checkable, on-site asset with the lowest health (or the grid under 70). If the tell showed, read it right with the chance `hit(skill, tier)` and call it. Otherwise call "all serviceable", except a wrong call with chance `(1 − hit) × 0.3`.
  - **Flags:** the analyst flags the house with the most revenue at risk (health < 60, nothing open on it) to the electrician; the electrician flags a plane under 60 with nothing open to the mechanic.

### 12.2 Autopilot for a missed seat (`engine.ts`)

- **A tech's autopilot** books a trip only for grounding, closing, due-now or acceptance work at one station, the most urgent.
  - Then it does that station's site moves (make-safe, an (M) MEL item, an NFF close) and today's two jobs at 50%, over home and that station.
  - It never makes quick checks or flags.
- **The analyst's autopilot** makes no network decisions, except **the loss guard**. After `NET.guard.missed` (2) analyst weeks missed in a row, each autopilot week it:
  1. trims each route's round trips down to the best by `projectNet` (never up)
  2. returns a lease past its minimum term whose 4-week route contribution is under −$500
  3. mothballs a station whose 4-week contribution is under −$1,000, parking the planes routed into it first
  - It never opens, leases, buys, raises frequency or moves a plane to another route.
  - It posts a crew-board line each time ("While Seb was away: Home–Adair trimmed to 3 round trips; Port Adair mothballed at −$1,400 a week").
  - It still rehires a station's standard housekeeper if one leaves (as `autoStaff` does for the standard crew).

---

## 13. Test plan

### 13.1 Package A (`tests/golden.test.ts`, `contract.test.ts`, `check.test.ts`, `flag.test.ts`, `network.test.ts`, `stations.test.ts`, `site.test.ts`, the skew and docsize extensions, `whosemove`)

**Stage 1 (A0):**
- the T1 table in `balance.ts long`
- a pacing test on the long run (T1's thresholds)
- the golden digests recorded after A0

**Stage 2:**
- **Contract:** `contract.test.ts` imports every §14.3 symbol (a typecheck-only test). On a v3 fixture each returns home-only or empty values, and none throws.
- **Golden:** no network, no checks, no flags → the recorded digests (11.5).
- **Checks:**
  - 1 a week; from tier 2; on site; the blind feed words
  - **`checkView` never reads `s.defects`:** a state with and one without give identical views
  - the tell only on in-scope kinds with weight > 0; its chance grows with the wear depth
  - the pools give ≥ 3 phrasings per kind and per zone
  - the IR: the tell at 40–70% load, the distractor at 85–95%, "too light" under 30%, and raw temperatures that overlap
  - a right call raises the kind's alert with `early` (one tier easier, one week more lead)
  - a wrong call raises a `src: 'check'` write-up that counts as open work until closed
  - null does nothing
  - out-of-scope kinds never show a tell
  - UI code never imports `checkTruth` (an import guard)
- **Flags:**
  - 1 a week per seat, 1 received per trade
  - from week 3; not on your own trade's asset; the generator not for the techs
  - a healthy twin gives an NFF write-up; a twin at 70 health gives a squawk-source alert
  - **a flag never gives a load sheet, a 100-hr or code prep**

**Stage 3 (`network.test.ts`, `stations.test.ts`, `site.test.ts`):**
- **Catalog integrity:**
  - ids unique; asset ids prefixed by their station
  - routes' ends exist
  - `adds` models are in `MODELS`
  - projects' puzzles and variants are registered
  - every `syms` key exists; `only` rows are drawn only at their stations, and never at home
  - **for every station, asset and allowed kind, `pairsFor` returns at least one pair of the kind's own role**
  - `raiseAlert`'s fallback never crosses roles
- **Opening:**
  - the validation matrix (tier, settle weeks, floor, project open, receivership, twice)
  - capex out at the start, in at a drop
  - the project needs all three, and the station opens at the sign-off that completes it
  - a `site` job needs the tech there (a `project` trip, no cash)
  - `addAsset`: **a Tern cottage rents in its opening week**
  - carts, staff (skipping the cap), bins
  - **a project job scored 0.5 leaves a defect on `tern-panel`**; tier projects roll none
- **Fleet:**
  - lease: the deposit held; buy: the price out
  - delivery next week at `deliveryStation` (Port Adair open → there)
  - **no round trips before the acceptance sign-off**
  - the fly-away kit by the plane's own effectivity
  - **registrations unique over 200 seeds**; N12xx for p1–p3 only
  - the return fee before the minimum; the true-up under 85; the resale by week; `maxNetPlanes`; the floor
  - **a network plane with no route is parked: 0 flights, the lease paid**
- **Assign:**
  - home keeps an island-ops guest plane
  - an open route; **a base at a route end** ("Adair–Tern planes are based at Adair or Tern Cay")
  - home tier planes only on routes with a home end, based at home
  - one assign a week; a base change costs a round trip
  - **a home tier plane on a route keeps home's decay and its alert candidates**
- **Route week:**
  - the §3.3 table rows from `projectNet` (the `--cards` run)
  - a hand-computed case: twin, Home–Adair, 5 RT, reference fare, mature, mid-season: 46 pax, $6,900, fuel $1,700, fees $350
  - freq caps round trips; the day-VFR cap into Tern Cay
  - the ramp from 50% over 8 flown weeks; the maturity draw is stable per seed
  - connecting passengers need free seats on both legs
  - storms cut round trips as they cut flights
  - guest parties take 4 seat-legs; arrivals at Tern Cay book its cottages; no arrivals means empty cottages
  - the pilots' pool in hours takes network planes after home's (home unchanged: 6 flights = 12 h)
- **Step 2:** **a twin at freq 3 in clear weather grades A on flights and gains `sinceInspection` by block hours**; its wear and near-miss rolls use 3.
- **The 100-hr:** 3 network twins at 5 RT over 26 weeks get every 100-hr raised in time, and **raise 0 load sheets**.
- **The shared pass:**
  - the network adds no routine slots: open work per trade ≤ today's targets + must-dos
  - must-dos ≤ 8 open, shared
  - `nffExtras` home only
- **Where the work is** (`site.test.ts`):
  - `workStations` for a based plane, an unaccepted one and a stuck one
  - **`aogAt` is seeded, stable and hits both ends over seeds**
  - every `SITE_BOUND` move is refused off site with the trip words, and every remote move (the mechanic's `tag`, an (O)-only `mel`, `plan`, `request` …) is allowed
  - **the electrician's remote `tag` on a Tern cottage closes it (no 75% rent)**
  - carts need the tech on site
  - autopilot does site moves only after booking the trip
- **Trips:**
  - 1 a week; a company seat vs the air taxi; the price
  - **booking a trip never turns an in-stock home start into a card** (not `autoSpent`)
  - allowed with cash below its cost
  - two weeks kept
- **Hub reports:**
  - drawn only after a trip there in W or W − 1
  - **an open Adair report never lowers the mechanic's home job count**
  - a notice when he has no work there
- **Stations:**
  - power per station (a dark Tern Cay doesn't touch home)
  - housekeepers per station; the staff cap + `staffRoom`
  - **mothball:** overhead × 0.3; its alerts dropped and orders cancelled; **10 weeks mothballed means 0 incidents, 0 alerts and no decay there**; reopening raises code prep
- **The only guest plane:** `soleGuest` is home only; a network twin never makes the home twin not sole; **an overdue airworthiness alert on the only Tern-route plane gives 0 round trips, 0 near-misses and empty Tern cottages that week**.
- **The parts desk:** −1 week only on POs that ride a flown Home–Adair route, never under 1; the planner's reorder points use the same `leadOf`; **a PO placed while Adair is open and flown lands a week sooner**; hazmat isn't hand-carried.
- **The grade:**
  - a station's first 4 weeks are out of it
  - contribution against its budget after that
  - the A bonus on home revenue only
  - **the naive bot's A-week rate is no higher than no-network's** (T3)
- **The loss guard:** trims, returns and mothballs as 12.2, and never opens, leases or raises.
- **Growth:** the home scene's wear (`care`) ignores station assets.
- **The data-only station (ZZ):**
  - a test calls `registerStation` (it clears the module's memo caches) with `STATIONS.zz` (a panel and a cottage, **its own `syms` row**, `kinds`, `panels`) and `ROUTES['home-zz']`, then:
    - opens it through the real actions (the three project jobs via `complete`, the site job with a trip)
    - leases a twin on Home–ZZ **based at ZZ**, and signs its acceptance at home (no hub)
    - **mechanic:** an alert on the twin → plan with `stdPick` → approve → trip → complete (stock consumed, the alert closed); a walkaround
    - **electrician:** an alert from ZZ's own row on its panel → the same, plus an IR scan of ZZ's `panels`
    - **analyst:** `ledger.rt['home-zz']` and `ledger.stn.zz` exist; the station card's payback computes
    - 6 weeks of bots run with no crash; the undo restores the catalog
  - **the grep guard:** no station or route id literal (`'tern'`, `'adair'`, `'home-tern'`, …) appears in `src/sim` (**`bots.ts` included**), `src/ui/inspect` or `src/ui/network`, outside `stations.ts`
- **No role can win alone in the network era:**
  - from a tier-5 fixture, with any two seats absent for 26 weeks, no station opens
  - with only the analyst present, a project opened stays a project (and can be dropped)
  - solo teams never reach tier 5 (unchanged)
- **Skew and migration:** 10.3.
- **Doc size:** T6 (the good and the naive bot; the maximum counts).
- **A 52-week season** with the network, every team: finite cash, and these invariants hold every week:
  - every network plane's `rt` is open (or it's parked) and its `st` is an end of it or open
  - every cart's `st` is open or mothballed
  - trips hold two weeks at most
  - `ledger.rt` and `stn` have 26 weeks at most
- **Whole-season files** carry `vi.setConfig({ testTimeout: 30000 })`.

### 13.2 Package B (`tests/camera.test.ts`, `hotspots.test.ts`, `scenes.test.ts`)

- **Camera math:**
  - clamps
  - `zoomAt` keeps the point under the finger
  - `camForBox(focusBox(role, tier))` and `camForBox(siteBox(s))` equal `zoomOf` for every role, tier and build in the inline viewport
  - contain-fit in a portrait Explore
  - the pinch midpoint
- **The classifier:** the tap, drag, pinch and double-tap thresholds; a drag suppresses the click; **inline, a one-finger touch drag never pans**.
- **The inline map:** `touch-action: pan-y` at k = 1 **and at k = 3.2**.
- **Hotspots:**
  - every object on the beaten scene and on each station scene has one
  - **on the beaten scene at 358 px, sampled taps on each object's footprint resolve to it at k = 1 and at k = 3.2**
  - **every object can be opened with one tap at the preset that frames it** (my zone, build site, all)
  - two footprints within reach zoom ×2 (and at max k give the chooser)
  - **≥ 40% of the land at k = 1 is empty ground** (the zone toggle survives)
  - carts win over the plane they're beside
  - `gap-zoom`'s builder taps resolve as `site` refs
  - nothing is outside the scene
- **A layout-only test scene** (ZZ) renders under the budget in minidom, and its hotspots hit-test.
- **`island-shots.mjs`:** every listed scene ≤ 1,500 (the region ≤ 400), phone and desktop.
- **The render count** during a scripted pinch: 0 until pointer-up.
- **The Playwright perf check** (5.6), with the ambient motion on, on `beaten` and `beaten-storm-night`.
- **Explore** mounts no second scene (one `svg.island` in the DOM).

### 13.3 Package C (`tests/inspect.test.ts`)

- `facts(s, ref, role)` for every object kind × seat on tier-1, tier-5 and network fixtures: **no hidden state** (no alert cause, no defect text) in any line.
- Every sheet renders in minidom.
- Each action dispatches its action; the analyst's inline moves dispatch `approve`, `setRates` and `hire`.
- **The walkaround:** every zone from `checkView` in one view; ≤ 3 taps; the call dispatches `check` with the item.
- **The IR scan:** the PPE line, ratings, conductors, loads and rises rendered; "too light to judge"; the help panel.
- **The meter check:** circuits with volts and run lengths.
- **Report a problem:** the receive cap's words; the DM prefill through `openDm`.
- **Keyboard:** every sheet's actions reachable by Tab; Esc closes.

### 13.4 Package D (`tests/networkui.test.ts`)

- The desk model's payback (with its band), lease-vs-buy and route numbers equal the engine's (`projectNet`, `routeWeek` on a clone).
- The open, drop, lease, assign, set-route, mothball and return flows dispatch the right actions, with the floor and the reasons shown when disabled.
- **The assign sheet offers only the route's ends as bases.**
- The job card's trip blocker books the trip.
- "Where the part is" words, including hazmat.
- The GSE station groups.
- **The Due list** in hours and weeks, with MEL expiry and where each plane is.
- **The load gauge** matches `loadGauge`.
- The purchasing and staff changes: the drop-ship card words, the Money tab's new categories, the hiring board per station.
- What's new shows once per seat and version.

### 13.5 After each stage's merge (Integrate and QA)

- **`scripts/e2e.mjs`** (phone and desktop) gains a map pass on a new island (stage 2):
  - one-finger scroll past the map; two-finger pinch and pan; double-tap; the preset chips; Explore
  - tap a plane → the sheet → at tier 2 a walkaround ("All serviceable" when nothing shows)
  - tap the grid → an IR scan
  - flag a crewmate's asset
  - the keyboard object list
- **`scripts/e2e-network.mjs`** (new, stage 3, the integrator): seeds a tier-5 pass-and-play island from `tests/fixtures/net-ready.json` into the local store, then:
  - the analyst opens Tern Cay and leases a twin in the same week
  - the three project jobs are played (the electrician's with a project trip)
  - the week resolves: the twin is delivered and the mechanic signs its acceptance; Tern Cay opens
  - the analyst sets a fare
  - the electrician books a trip, fixes a Tern Cay alert and scans the Tern panel
  - the region view and fly-to
  - screenshots at every step, looked at
- **`scripts/e2e-online.mjs`** with each stage's rules on the emulator (rules probes for the old `v` and the new `v`).
- **The island lab's scenes and node counts.**
- **Scripted phone runs of every new flow**, with screenshots.

---

## 14. Work split, file ownership and the contract

### 14.1 Stages, packages and order

| Stage | A (engine) | B (map) | C (objects) | D (network desk) |
|---|---|---|---|---|
| 1 | **A0** (the levers, `balance.ts long`, the golden digests) | — | — | — |
| 2 | **A1:** the stage-2 contract commit (types, `objects.ts`, `checks.ts`, the `check`/`flag` actions, the selectors C needs, `openDm`, the What's new shell, the mounts, stubs). Then the version gate. | **B1:** the camera, gestures, hotspots, presets on `gap-zoom`'s state, Explore, the home scene on `cam`, the perf check | **C1:** the inspect sheets for home's objects, the three checks' screens, Report a problem, stage 2's What's new panels | — |
| 3 | **A2:** the stage-3 contract commit (`stations.ts` with working home-only helpers, the network types and actions, every D/B/C selector with a real implementation). **A3:** the engine (`network.ts`, the generalizations, the version gate). **A4:** bots, `balance.ts network`, tuning, fixtures, the ZZ test. | **B2:** layouts, `StationScene`, the region view, the station lab scenes | **C2:** station objects (fixtures such as the dispenser and E-stop; trip gating in sheets) | **D:** the Network desk, the outstation screens, the Due list, the purchasing and staff changes, stage 3's What's new panels |

- **B1 and C1 start at A1. B2, C2 and D start at A2.** A2 ships every symbol they consume with a working implementation (14.3), so they build against real behaviour while A3 fills in the network.
- All packages merge A's later commits into their branches before Integrate, with `git merge --no-ff`.
- **If a package needs an engine change, it doesn't make it:** it says so in its result, and the Integrate phase makes it.

### 14.2 File ownership

| Path | Owner |
|---|---|
| `src/sim/*` (every file: `types.ts`, `data.ts`, `engine.ts`, `econ.ts`, `alerts.ts`, `stock.ts`, `staff.ts`, `ledger.ts`, `flow.ts`, `chain.ts`, `migrate.ts`, `bots.ts`, `progression.ts`, `tasks.ts`, `growth.ts`, `aircraft.ts`) and the new `stations.ts`, `network.ts`, `checks.ts` | A |
| `src/puzzles/types.ts` (`assetModel`, `variant`), `ipc.ts` and `logbook.ts` (read `assetModel` first; nothing else), `conduit.ts` (the `rmc` variant), `panel.ts` (the `bay` variant) | A |
| `src/ui/select.ts`, `src/ui/objects.ts` (new), `src/ui/useIsland.ts`, `src/net/firebase.ts`, `firestore.rules` | A |
| `src/ui/flow/Investigate.tsx`, `src/ui/flow/words.ts` (station words, the grounding words), `src/ui/flow/Inbox.tsx` and `AlertRow.tsx` (station labels), `src/ui/board.tsx` (the "Network:" review line, `costs.network` rows) | A |
| `src/ui/crewboard.tsx`: the exported `openDm(role, prefill)`, in A1, nothing else | A |
| `src/ui/whatsnew.tsx` (new): the version-keyed shell | A |
| `src/ui/home.tsx`: `<MapView>` in place of `<Island>`, the inspect-sheet state and its `<Sheet>` (C's `<InspectSheet>` for every kind but station/route, D's `<NetObjectSheet>` for those), the What's new mount | A, and only A |
| `src/ui/desk.tsx`: the **Network** tab entry and the `<NetworkDesk>` mount, nothing else | A |
| `src/ui/ops.tsx`: `export` on `WriteUp` and `SafetyCall`, nothing else (then D owns it) | A |
| stubs that render today's behaviour (then their owner replaces them): `src/ui/map/MapView.tsx` (the stub renders today's `<Island>` with today's toggle), `src/ui/inspect/InspectSheet.tsx`, `src/ui/network/NetworkDesk.tsx`, `NetObjectSheet.tsx`, `TripButton.tsx` | A writes; then B, C, D own |
| `tests/*` except the files named for B, C, D; `tests/fixtures/*`; `scripts/balance.ts` | A |
| `src/ui/map/*` (`MapView.tsx`, `camera.ts`, `gestures.ts`, `hotspots.ts`, `layouts.ts`, `region.tsx`, `scene.tsx`, `controls.tsx`, `map.css`) | B |
| `src/ui/island.tsx`, `src/ui/island/*.tsx` (the geo presets, the gse spots per scene, the `PropKind` shapes) | B |
| `src/islandlab.tsx`, `scripts/island-shots.mjs`, `tests/camera.test.ts`, `hotspots.test.ts`, `scenes.test.ts` | B |
| `src/ui/inspect/*` (`InspectSheet.tsx`, `facts.ts`, `plane.tsx`, `house.tsx`, `power.tsx`, `hangar.tsx`, `office.tsx`, `fixtures.tsx`, `people.tsx`, `Walkaround.tsx`, `IrScan.tsx`, `MeterCheck.tsx`, `Report.tsx`, `WhatsNewMap.tsx`, `inspect.css`), `tests/inspect.test.ts` | C |
| `src/ui/network/*` (`NetworkDesk.tsx`, `StationCard.tsx`, `RouteCard.tsx`, `FleetSheet.tsx`, `AssignSheet.tsx`, `NetObjectSheet.tsx`, `TripButton.tsx`, `DueList.tsx`, `LoadGauge.tsx`, `WhatsNewNet.tsx`, `model.ts`, `network.css`), `tests/networkui.test.ts` | D |
| `src/ui/ops.tsx` (after A's exports: station grouping, trip chips, the Due list mount), `src/ui/gse.tsx` (station groups), `src/ui/flow/JobView.tsx` (the station line, the trip button, where the part is), `src/ui/flow/StockStep.tsx` (the carry / hazmat / drop-ship words) | D |
| `src/ui/purchasing/*` (`ApprovalCard.tsx` drop-ship words, `model.ts`, `Money.tsx` and `charts.tsx` new categories, `Needs.tsx`), `src/ui/staff/*` (`StaffDesk.tsx` per-station board, `cand.st`, `model.ts`) | D |
| `src/ui/orders.tsx` | the Integrate phase |
| `src/styles.css` | A, only for a shared token; B, C and D style in their own CSS files |
| `scripts/e2e.mjs`, `e2e-online.mjs`, `e2e-network.mjs` (new), `docs/ONBOARDING.md` (a *§12 The airline*; the map, objects and checks in §3) | the Integrate phase |
| `docs/DECISIONS.md` | A adds *## Airline network* with four subsections: *Engine and data (A)*, *The map (B)*, *Objects (C)*, *The network desk (D)*. Each package writes only in its own. |

**Ownership check at Integrate:** for each package branch, `git diff --name-only <A's base commit>..<branch>` must list only that package's paths from this table. Anything else is sent back.

**What no package does:**
- change another package's files
- store derived data in the island doc
- add an action outside `types.ts` (A defines every action up front)
- import from another package's new folder (the only exceptions are the mounts A places, and C → `openTarget` → D)

### 14.3 The contract: every cross-package symbol, exact

A1 (stage 2) and A2 (stage 3) ship these with **working implementations**, never throws: home-only where the network isn't built yet. `tests/contract.test.ts` imports them all.

```ts
// ---- src/sim/stations.ts (A2) ----
export type StationId = string;
export type RouteId = string;
export type PlaneModelId = 'twin' | 'cargo' | 'float';
export interface StationDef { /* 2.1 */ }
export interface RouteDef { /* 2.1 */ }
export interface Breaker { name: string; amps: number; awg: string; loadA: number }
export const STATIONS: Record<StationId, StationDef>;
export const ROUTES: Record<RouteId, RouteDef>;
export const PLANE_OPS: Record<PlaneModelId, { seats: number; fuelPerH: number; blockX: number; lease: number; price: number; word: string }>;
export const NET: typeof NET; // 2.1
export function registerStation(def: StationDef, routes: RouteDef[]): () => void;
export function stOf(a: Pick<Asset, 'st'>): StationId;
export function isNetPlane(a: Pick<Asset, 'id' | 'kind'>): boolean;
export function isStationAsset(a: Pick<Asset, 'kind' | 'st'>): boolean;
export function stationDef(id: StationId): StationDef | undefined; // undefined for 'home'
export function stationState(s: IslandState, id: StationId): StationState | undefined;
export function isOpen(s: IslandState, id: StationId): boolean; // 'home' → true
export function isMothballed(s: IslandState, id: StationId): boolean;
export function routesOpen(s: IslandState): RouteDef[];
export function routeFare(s: IslandState, r: RouteId): number;
export function routeFreq(s: IslandState, r: RouteId): number | null; // null: all it can fly
export function routeCap(s: IslandState, r: RouteId): number; // round trips a plane a week (the day-VFR cap)
export function opsPlanes(s: IslandState): Asset[];
export function planesAt(s: IslandState, st: StationId): Asset[];
export function housesAt(s: IslandState, st: StationId): Asset[];
export function assetsAt(s: IslandState, st: StationId): Asset[];
export function deliveryStation(s: IslandState): StationId;
export function aogAt(s: IslandState, plane: Asset): StationId | null; // null: not grounded
export function workStations(s: IslandState, a: Asset): StationId[];
export function siteOfOrder(s: IslandState, o: Order): StationId;
export function tripOf(s: IslandState, role: OpsRole, week?: number): Trip | undefined;
export function onSite(s: IslandState, role: OpsRole, st: StationId): boolean;
export function tripCost(s: IslandState, st: StationId): { usd: number; how: 'seat' | 'taxi'; route?: RouteId };
export const SITE_BOUND: ReadonlySet<Action['t']>;
export function siteBlock(s: IslandState, role: OpsRole, a: Action): string | null;

// ---- src/sim/econ.ts (A2; defaults keep every existing caller) ----
export function grid(s: IslandState, st?: StationId): Asset | undefined;
export function generator(s: IslandState, st?: StationId): Asset | undefined;
export function powered(s: IslandState, st?: StationId): { gridDown: boolean; genOK: boolean; on: boolean };
export function reportCap(s: IslandState, role: Role, st?: StationId): { order: Order; limit: number; text: string } | null;
// ---- src/sim/staff.ts ----
export function housekeepingCap(s: IslandState, st?: StationId): number;
export function reviewMult(s: IslandState, booked?: number, st?: StationId): number;
// ---- src/sim/stock.ts ----
export function leadOf(s: IslandState, x: Item, vendor: SupplierId): number;
export function etaOf(s: IslandState, W: number, x: Item, vendor: SupplierId): number;
export function starterItem(s: IslandState, l: StarterLine, asset?: Asset): ItemId | undefined;

// ---- src/sim/checks.ts (A1) ----
export const CHECK: { detect: number; depth: number; minShow: number; fromTier: number };
export type CheckKind = 'walkaround' | 'ir' | 'meter';
export interface CheckItem {
  id: string;
  label: string; // 'R main', 'Dispenser 20 A · 12 AWG', 'Kitchen (30 ft)'
  text: string; // what the tech sees: a tell and a benign sign read alike
  reading?: { riseC?: number; loadPct?: number; amps?: number; volts?: number; runFt?: number; tooLight?: boolean };
}
export interface CheckView { kind: CheckKind; assetId: string; items: CheckItem[]; help: string[]; ppe?: string }
export function checkKindFor(s: IslandState, role: OpsRole, a: Asset): CheckKind | null;
export function checkView(s: IslandState, role: OpsRole, assetId: string, week?: number): CheckView | null;
export function canCheck(s: IslandState, role: OpsRole, assetId: string): { ok: true } | { ok: false; why: string };
/** sim only (the engine's `check`); UI code never imports it (an import guard test) */
export function checkTruth(s: IslandState, role: OpsRole, assetId: string, week: number): { item: string; kind: string } | null;

// ---- src/sim/network.ts (A2 stubs home-only; A3 fills it) ----
export interface RouteProj { route: RouteId; rt: number; seats: number; pax: number; lf: number; revenue: number; direct: number; planes: number; contribution: number; band: { p10: number; p50: number; p90: number }; ramp?: { week: number; of: number }; connecting?: number }
export interface StationProj { st: StationId; revenue: number; cost: number; travel: number; contribution: number; band: { p10: number; p50: number; p90: number } }
export interface NetProj { routes: RouteProj[]; stations: StationProj[]; parked: number; total: { p10: number; p50: number; p90: number } }
export function projectNet(s: IslandState, over?: { fares?: Record<RouteId, number>; freq?: Record<RouteId, number | null>; assign?: Record<string, { route: RouteId | null; base?: StationId }>; lease?: { model: PlaneModelId; route: RouteId; base: StationId }[]; open?: StationId[] }): NetProj; // memoized per state
export function routeWeek(s: IslandState, r: RouteId, W: number): RouteProj; // pure, on a clone for previews
export function leaseVsBuy(model: PlaneModelId, weeks: number[]): { weeks: number; lease: number; lost: number; capital: number; buy: number }[];
export function payback(s: IslandState, st: StationId): { capex: number; cum: number; weeksSoFar: number; paidWeek: number | null; projected: { p10: number; p50: number; p90: number } };
export function loadGauge(s: IslandState, role: OpsRole): { assets: number; healthTrend4w: number; jobsDone4w: number; mustDoPerWeek: number };
export function dueList(s: IslandState): { plane: string; nextInspH: number; nextInspWeeks: number | null; phase: boolean; mel: { text: string; until: number }[]; at: StationId; status: 'flying' | 'stuck' | 'parked' | 'accepting' | 'aog' }[];
export function whereIsPart(s: IslandState, orderId: string): { line: ItemId; where: 'stores' | 'hazmat' | 'dropship' | 'desk'; eta?: number; words: string }[];

// ---- src/ui/select.ts (A1 for the first four, A2 for the rest) ----
export function assetPnl(s: IslandState, assetId: string, weeks: number): { revenue: number; parts: number; labour: number; lease?: number; hull?: number; fuel?: number };
export function fixtureFacts(s: IslandState, kind: ObjectKind, st: StationId, role: Role): { lines: string[] };
export function openAlertsOn(s: IslandState, assetId: string): { mech: number; elec: number };
export function flaggable(s: IslandState, role: Role, assetId: string): { ok: true; to: OpsRole } | { ok: false; why: string };
export function stationSummary(s: IslandState, st: StationId, role: Role): { lines: string[]; alerts: { mech: number; elec: number }; dark: boolean; aog: boolean; week?: number };
export type DockTarget = /* today's */ | { desk: 'network'; plane?: string; station?: StationId; route?: RouteId } | { object: ObjectRef };

// ---- src/ui/objects.ts (A1) ----
export type ObjectKind = /* 2.5 */;
export type ObjectRef = { kind: ObjectKind; id: string; st: StationId };
export const OBJECT_LABEL: Record<ObjectKind, string>;
export function ownerOf(a: Asset): OpsRole | 'both';

// ---- src/ui/crewboard.tsx (A1) ----
export function openDm(role: Role, prefill: string): void;

// ---- component props (A writes the stubs; the owner builds them) ----
export function MapView(p: { s: IslandState; role: Role | null; onObject: (r: ObjectRef) => void; onCart: (cartId: string) => void; initial?: string }): JSX.Element; // B
export function InspectSheet(p: { s: IslandState; ctl: Ctl; role: Role; target: ObjectRef; onClose: () => void }): JSX.Element; // C
export function NetObjectSheet(p: { s: IslandState; ctl: Ctl; role: Role; target: ObjectRef; onClose: () => void }): JSX.Element; // D
export function NetworkDesk(p: { s: IslandState; ctl: Ctl; focus?: { plane?: string; station?: StationId; route?: RouteId } }): JSX.Element; // D
export function TripButton(p: { s: IslandState; ctl: Ctl; role: OpsRole; st: StationId }): JSX.Element; // D
export function WhatsNew(p: { s: IslandState; role: Role; version: number; panels: { title: string; body: JSX.Element }[] }): JSX.Element | null; // A
```

**What each package uses from A:**
- **B:** `ObjectRef` / `ObjectKind` / `OBJECT_LABEL`; `StationId`, `STATIONS`, `stOf`, `isOpen`, `routesOpen`, `workStations`, `aogAt` (for stuck spots), `planesAt`, `housesAt`; `powered(s, st)`, `housekeepingCap(s, st)`; `gaps`' `siteBox`, `focusBox`, `workSites`; `stationSummary` for the region badges; the bubbles' inputs as today.
- **C:** `objects.ts`, `ownerOf`; `checkKindFor`, `checkView`, `canCheck`, `CHECK`, and the `check` and `flag` actions; `flaggable`; `onSite`, `tripOf`, `workStations`, `siteBlock`; `assetPnl`, `fixtureFacts`, `openAlertsOn`; `openTarget` with `{ desk: 'network', … }`; `openDm`; `WriteUp` and `SafetyCall` from `ops.tsx`; the GSE sheet via the mount.
- **D:** every network action; `projectNet`, `routeWeek` (on a clone, for previews), `tripCost`, `leaseVsBuy`, `payback`, `loadGauge`, `dueList`, `whereIsPart`; `ledger.rt` / `stn`; `stationSummary`; the station sheet's refs.

**The workflow:** `docs/handoff/workflows/real-job-flow.js` is the model, once per stage:
1. this spec, the critics, this revision; then the owner's decisions (18)
2. build A's contract, then the stage's UI packages in parallel worktrees (their own ports and cache dirs)
3. integrate, then 3 reviews (trades; play and UX at 390 × 844 across all three seats plus desktop; systems, migration and balance), then fix, then QA, then the deploy checklist (`HANDOFF.md` §6.4)

---

## 15. Risks and open questions

**Risks, and what this spec does about them:**
- **The long game doesn't hold today** (0.3). A0 comes first as stage 1, with its own target (T1), in a time box. If it can't reach T1 inside T0's band, Seb gets the numbers and the call (11.2).
- **The electrician is the game's bottleneck.**
  - The shared pass means the network adds no routine jobs; it spreads the same ones over more assets. The cost is condition, shown on the load gauge.
  - His station content is bounded: Tern Cay has 3 assets, Adair 1 panel plus the reports.
  - If the playtest says it's still too much, the first lever is a station weight below 1 in the shared draw (station assets drawn less often), then fewer station `kinds`.
- **The mechanic's outstation work is thin in good play.** In v1 it's the acceptances at Port Adair, planes stuck away (which need a missed week) and Adair–Tern planes. T5 reports his trips a week. If it's near 0, the next lever is basing incentives (0.4), not forced trips.
- **Tedium.**
  - Trips are 2 taps, and planes based at home need none for routine work.
  - Checks are optional, ≤ 3 taps, once a week.
  - The network desk is at most 6 taps per decision.
  - If a playtest finds trips a chore, the lever is "a trip lasts 2 weeks".
- **Gridlock.**
  - A trip never waits on another seat: it isn't in the work budget, and it goes through with cash short.
  - Hub reports cap only the work at the hub, and only after he has worked there.
  - A station project can be dropped, with the capex back.
  - Home can't lose its last island-ops guest plane; `gaps`' sub-charter covers it.
  - A mothballed station's assets can't generate unreachable work.
  - The analyst's autopilot has a loss guard.
- **Balance (Goodhart).**
  - The grade counts the network by contribution, after a probation; the A bonus is on home revenue only. T3 checks the naive bot's A-week rate.
  - The IR scan's tell and distractor overlap in raw temperature, and the phrasings come from seeded pools.
  - The paper sim's bots use checks and flags, so they're priced.
- **Doc growth.** Bounded (2.8) and tested (T6, both bots).
- **Speed.**
  - One detailed scene at a time; Explore portals it.
  - The camera is transform-only, with the ambient motion paused during a gesture; hit-tests are JS.
  - `routeWeek` is O(planes); `projectNet` is memoized per state, like the analytics.
- **Migration.** Every field is lazy. The golden test, fixtures from the previous live commit at every stage, and the network fixtures cover it.
- **Merge conflicts.** One owner per file (14.2), with an ownership check at Integrate. A places every mount first.
- **Realism, knowingly simplified:**
  - one central store
  - no crew duty-time or timetables (duty is counted in hours)
  - one route per plane
  - the authority's buildings are outside the game
  - fares flat per route (no fare classes)
  - no annual inspection for low-hour planes
  - no ferry permits or heavy checks
  - prices scaled to the game's weekly economy

**Open questions for the three of you** (defaults in brackets; 18 has the consequential ones):
1. The network opens after the Resort, and only once A0 holds (or Seb says ship it). [yes]
2. One trip a week per tech, booked as travel. [yes; 2 if it feels tight]
3. One quick check a week per tech, from tier 2, reading wear that's coming. [yes; defects in scope is 18.3]
4. Buy as well as lease? [yes; the card shows both]
5. Station names Tern Cay and Port Adair. [yes]
6. Wages at 2.5–3×, the open call (18.10). [as they are]

---

## 16. Changed direction, with reasons

| Direction point | What this spec does instead | Why |
|---|---|---|
| X3: "the network is the long game after tier 5" | The network is still after tier 5, but **A0 comes first** (0.3, 11.2) as its own stage and target, time-boxed | In the sim, the long game after tier 5 collapses in 10 of 10 games for both target crews, and the credits are reached in 0–2 of 10. Building on it would make the network look like the cause. |
| X8: "this release ships as v4" | **Three stages, each its own version bump** (0.5); `gaps` is v4, and the network is v5 or v6 | `gaps` will deploy first. One bundled release would make A0's fix for a live collapse wait for the largest engine change so far, and a slip anywhere would hold everything. |
| X5: "outstation work has a real cost (travel time or a slot, or ferrying the plane home)" | **One trip a week per tech, in money (travel, not the work budget).** A plane is worked at its base or where it's stuck. **No ferry and no HEAVY rule in v1.** | A slot means nothing for a human (there's no per-turn job cap). The one-trip rule is the scarce resource: you can't be at both outstations in a week. Every v1 route has a hangar end, so HEAVY never bites, and a ferry permit needs the mechanic's inspection on site (21.197), so it saves no trip (17). |
| X4: "planes based there … outstation AOG where the part and the mechanic must get there" | Outstation AOGs come from **where a plane breaks** (the seeded end) and **acceptances at the hub**. Basing a Home–X plane away from home buys nothing in v1. | That's where real outstation work comes from. A basing incentive would be invented economics; T5 measures the mechanic's trips, and basing incentives are the lever if they're too few (15). |
| X2: "per-station stock or transfers if any" | **One central store**, drop-ship to stations at the normal ETA, parts hand-carried on the trip (not hazmat) | Per-station bins double the analyst's stock work for no new decision. The real decisions (which planes and where) are in the fleet and routes. |
| X7: "report a problem to \<trade\>" from any object, via the existing cross-trade reports | Assets: a **flag** (a write-up alert for the owner, 1 a week, 1 received per trade, from week 3). Fixtures: the open reports, plus a **DM**. | A report row carries a cap or a leak on the reporter. A player raising one on purpose would be self-harm, or a fake problem. |
| X7: quick checks "(the analyst's view)" | The analyst gets numbers and **her own inline moves** on objects (approve, the nightly stepper, hire), and **no hidden-state check** | The analyst's hidden-state finds are already the desk puzzles (the invoice match, the bank rec, the variance hunt). A parallel check would duplicate them. |
| X7: "a quick WALKAROUND … (≤ 3 taps)" | Kept at ≤ 3 taps, by showing **every zone in one view** | A real walkaround circles the whole aircraft. The skill is reading what you see, not guessing where to look. |
| X6: "drag-pan on touch" | Inline, **two fingers** pan and one finger scrolls the page; one-finger pan in Explore | The map is Home's top card. One-finger pan inline would trap the page's scroll on a phone. |
| X6: "never breaks the existing taps (… the island tap)" | The empty-ground tap still toggles all ↔ my zone, **250 ms delayed** so a double tap can zoom instead; hit-tests use true footprints so empty ground survives | It keeps the habit and still gives double-tap zoom. Objects answer at once. |
| X4: the electrician's hub work "terminal service and panels, apron floodlights" | At Port Adair: **the leased bay's subpanel** (cart chargers, GFCI tool receptacles, bay lights: NEC 513) and the hub's hangar reports. The terminal and the airfield lighting are the authority's. Hazardous-location work runs under the company's commercial permit. | That's realistic (an airline leases space at a regional airport), it's within a residential electrician's skills with a master of record on the permit, and it bounds the busiest seat's load. Tern Cay (ours) has the panel, the dispenser and the cottages, and its apron floodlight is on the panel schedule. |
| X4: "a small terminal, a few guest rooms" at the outstation | Two cottages (the existing model), a shed with a counter drawn in the scene (no asset) | Reusing `cottage` brings every house symptom, task and puzzle for free. A terminal asset would need a new model, symptoms and tasks for little play. |
| X1: "adding another airport later must be DATA" | Data **plus a layout from the closed art set**. A building with new art is code. | The honest limit: the scene needs shapes. Everything the sim needs is data, and the ZZ test and the grep guard prove it. |

---

## 17. Rejected critique

Every blocker and major was taken; these are the points, or the parts of points, turned down, with the reason.

| Point (lens) | Proposed | Why not |
|---|---|---|
| Spec drift from `gaps` (architecture) | generalize the sub-charter to stations: `subCharterOn(s, st)`, `subCharterNeed(s, planeId, st)` | The realism critic's rule wins: a station's only plane grounds like any other. The sub-charter exists because grounding home's only guest plane can bankrupt the island (HANDOFF 6.5). A station's loss is one bounded week (about $2,480 at Tern Cay), a risk the analyst chose by flying one plane, and the card says so. `subCharterOn(s)` stays home-only and unchanged. The rest of that point (rebase on `gaps`, no "restricted" state, version-keyed What's new, the version plan) is taken. |
| Mechanic station work (game); base/AOG (realism); mechanic content (architecture) | let Adair's hangar take HEAVY work for any route plane touching Adair; a ferry permit (21.197) as the alternative to a field repair | Every v1 route has a hangar end, so HEAVY never bites (the architecture critic's own minor), and it's dropped. A special flight permit needs a certificated mechanic's inspection on site, so a ferry saves no trip and just loses a flight. Both return with heavy checks. The rest of those points (the seeded stuck end, base at a route end, outstation AOGs) is taken, plus acceptances at the hub. |
| IR and meter scope (realism); walkaround scope (realism) | `elec:oversized/undersized` read against the conductor (240.4(D)); a 240 V water-heater row and a bond-continuity row; `gpu:arc` on the walkaround; static tells for safety wire | These are all hidden-defect rules. The checks now read upcoming wear, never `s.defects` (the blocker's fix), so they don't apply in v1. The schedules still show rating and conductor, so they come back if Seb puts defects in scope (18.3). The cart's cable already has its own inspection in the GSE sheet. The walkaround zone list, the late oil tell and the out-of-scope list are taken. |
| Quick checks vs pillar 3, alternative (game) | keep defects in scope: only defects with week ≤ W − 2 and due ≤ W + 1, never the checker's own last 2 weeks, with the traced line | That's a real option, but it changes the owner's verbatim pillar ("we don't see the immediate sign that your incorrect"). So it's the owner's call (18.3), default off. |
| IR Goodhart (game) | the tell at 15–35% load, the distractor at 85–95% | A loose lug heats with I²R, less at a trickle, and NFPA 70B wants 40% load or more to judge; the realism critic said so. The overlap is kept by load-normalizing instead: the tell at 40–70% load, 10–20 °C over what that load should give; the distractor at 85–95%, normal for its load; under 30%, "too light to judge". |
| 3-look walkaround not enforced (architecture) | split `check` into `look` and `call` and stamp the zones looked at | Moot: one view shows every zone (realistic, and ≤ 3 taps), so there's nothing hidden to enforce. |
| Mothball (architecture) | "decay goes on" while mothballed | The game critic's freeze is taken instead. Nobody can work a mothballed station, and mothballing is preservation. Reopening costs code prep on every house. |
| Flags and `ownerOf` (architecture) | a flag replaces the owner's lowest-weight open routine alert on that asset | It would silently close a real alert, a problem nobody fixed. Instead the words say what a flag does, and each trade receives at most one flag a week. The generator-owned-by-both-techs part is taken. |
| The grade (game), alternative | open the network only after `creditsWeek`, with its own "Airline" credits | The credits happen in 0–2 of 10 games today, so the network would almost never open. The contribution grade and the probation fix the Goodhart without it. |
| The grade (game), detail | a station's budget counts as min(budget, trailing 4-week revenue) until its 4th week | A simpler probation is taken: its term is out of the grade for 4 weeks, then its contribution counts against a small budget. |
| Network effects (realism), second option | a Home–Adair round trip stands in for an island-ops guest arrival | It would give home's revenue a network lever and break the byte-identical home. Route passengers into home are day visitors and residents. The connecting share is taken. |
| Route and station P&L (realism) | maintenance reserves billed by the lessor per block hour | The job flow is the maintenance, so the P&L charges each plane's real parts and labour (`ledger.as`). Reserves on top would double-count line work. The return-condition true-up (also proposed) is taken, so a lease returned run down still costs. |
| Tern project jobs (realism) | the mechanic's `balance` with a short-field maxGross, whose score sets a data-only seat cap | The critic's alternative is taken: the `ipc` fly-away kit. Takeoff performance is the pilot's AFM work, and a seat cap set by a puzzle score couples a stored score to route capacity for one job. |
| Station electrical (realism) | a "weathered service-drop splice at the pole" feeder variant | The critic's other option is taken: Tern's cottages are fed underground (hand holes drawn), so `gap-feeder`'s scene fits as is, with no new puzzle scene. |
| Hub reports (architecture), alternative | give hub reports effect `leak` | The station-scoped cap is taken instead: it's the existing effect, bound to where the trouble is, and drawn only after he worked there. |
| Release shape (architecture), detail | A0 needs no version bump unless state changes | A0 changes the resolve from tier 4, so an open older client would resolve a week on the old numbers. `gap-charter` set the precedent that a resolve change bumps. If A0 rides in `gaps`' v4, there's no extra bump. |
| Maintenance control (realism), optional part | over-water equipment due dates (135.167 rafts and vests on Home–Adair) as a data task | Not in v1: a new kind of dated item for little play. The Due list is taken. |
| Absences (architecture) and autopilot (game): the guard's threshold | 3 resolved weeks (architecture) vs 2 missed weeks (game) | Took 2 missed analyst weeks (`NET.guard.missed`) with 4-week contribution tests, so a long absence is caught a week sooner. Both critics' actions are in it. |

---

## 18. Decisions the owner should know about

Each has the default the build uses unless Seb says otherwise.

1. **Three releases, not one.**
   - (1) The fix for the late game; (2) the free map, tappable objects, quick checks and *Report a problem*; (3) the airline.
   - Each is its own "close and reopen the app".
   - *Trade-off:* three restarts over a few weeks. But the map and the fix reach you weeks sooner, and a slip in the airline holds nothing else back.
   - **Default: three stages.**
2. **The late-game fix changes tiers 4–5 on every island, including live ones.**
   - The levers: the grid comes first when it's under 55; dark houses don't wear in a blackout; code inspections every 13 weeks; lighter wear above 70 health; your A streak pauses (not resets) on an autopilot week.
   - Today both target crews go broke by weeks 28–40 in 10 of 10 sim games, and reach the credits in 0–2 of 10.
   - I get one balance pass at it, then send you the numbers. If it misses, you pick: ship the airline on it, or keep fixing.
   - *Trade-off:* the late game gets more forgiving.
   - **Default: yes, time-boxed.**
3. **Quick checks read wear that's coming, not your hidden mistakes.**
   - Catch it early and the job is on your list a week sooner and one tier easier. A wrong call costs a job slot until you close it.
   - The alternative lets a check find a hidden defect too (only one 2+ weeks old, and never your own last 2 weeks). That's a "caught it" moment, but it weakens "mistakes surface later".
   - **Default: wear only.**
4. **The airline doesn't add jobs.**
   - One shared job list per trade spreads the same weekly work over more planes and buildings. The cost is condition.
   - The analyst sees a load gauge per trade before opening or leasing.
   - *Trade-off:* a big network runs your island in worse shape unless you're sharp. Nobody gets more puzzles a week.
   - **Default: one shared list.**
5. **Where the work is.**
   - A plane is worked where it sleeps (its base) or where it broke. Half the time a Home–Tern plane that's grounded is stuck at Tern Cay.
   - Leased planes are delivered to Port Adair once it's open, so the mechanic flies there for the acceptance.
   - One trip a week per tech: 2 taps, a free seat on our flight + a $60–110 per diem, booked as travel, **not** your work budget.
   - Paperwork and grounding calls work from anywhere. Hands-on work (the fix, making safe, closing no-fault, MEL items with a maintenance procedure, cart moves, checks) needs the trip.
   - *Trade-off:* the mechanic travels mainly when something breaks away from home or a plane is delivered. Basing a plane away from home buys nothing yet.
   - **Default: as described.**
6. **The money (starting numbers, tuned by a 52-week sim):**
   - a twin costs $150,000, or $500 a week to lease (13-week minimum, $2,000 refundable deposit, a condition charge if you return it run down)
   - Tern Cay costs $12,000, Port Adair $15,000
   - good play pays each back about 11–13 weeks after opening, with a P10–P90 band on every card
   - naive expansion (everything open, extra planes, high fares) loses about $2,150 a week
   - routes carry their own maintenance, pilots by the hour, fuel, fees and hull insurance
   - *Trade-off:* buying rarely beats leasing inside a season (it breaks even at about two years). That's realistic, but the Buy button will mostly be a lesson.
   - **Default: these numbers.**
7. **The grade counts the airline by profit, not revenue.**
   - A new station is out of the grade for 4 weeks, then its profit counts against a small budget.
   - The A-week bonus is paid on the island's revenue only.
   - *Trade-off:* expanding never makes the credits easier, and a loss-making network drags your grade to a C.
   - **Default: profit.**
8. **A station's only plane gets grounded like any plane,** with no sub-charter at stations. That week its cottages sit empty (about −$2,480 at Tern Cay). Home keeps `gaps`' sub-charter for its only guest plane.
   - *Trade-off:* realistic and bounded; flying one plane to a station is a risk you choose, and the card says so.
   - **Default: no station sub-charter.**
9. **Checks unlock at tier 2, *Report a problem* at week 3.** Each crewmate receives at most one flag a week, and flagging something healthy costs them a no-fault close.
   - *Trade-off:* nothing new to learn in the first teaching weeks.
   - **Default: tier 2 / week 3.**
10. **Wages ×2.5–3 (your open call) interacts with the airline.**
    - Route pilots are charged by the hour, so a trunk twin's pilot share goes from $227 to about $570–680 a week.
    - Tern Cay's housekeeper goes from $180 to $450–540.
    - Paybacks stretch from about 11–13 weeks to about 15–17. The network still pays, but it would need a retune (fares or capex).
    - The builders' default (no speed-up) also applies to opening a station.
    - **Default: wages as they are.**
