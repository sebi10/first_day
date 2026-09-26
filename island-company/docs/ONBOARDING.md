# Crew briefing: first day on the island

About 10 minutes to read and set up. One person (the "host") does the setup once; the other two just open a link.

## 0. Host setup (once, ~5 min, free)

The live project is `islandgame-efc37`: the game is at <https://islandgame-efc37.web.app> once it has been deployed (README → *Play online*, step 5: a GitHub secret enables auto-deploy on every push).

Short on time? Anyone can try the whole game alone first with *New island → 1 device · pass & play*.

## 1. Join (each of you, 1 min)

1. Open the URL on your phone. On iPhone: Safari → Share → **Add to Home Screen**, then open it from the icon.
2. Enter your name.
3. Host: **New island → 3 devices · online →** pick your seat → *Found the island*. Tap **Invite** and drop the link in the group chat.
4. The other two open the link → pick their seat → *Join*.
5. Optional: also play on your computer. Go to *Me → Crew and devices* and copy your **seat code**. On the computer, open the URL → *Join with a code* → island code → your seat → seat code.

## 2. Who does what

| | Mechanic | Electrician | Analyst |
| --- | --- | --- | --- |
| Your zone | Hangar, airstrip, 2 planes (1 at tier 1), the ground power carts | 4 cottages (2 at tier 1), the grid, later a generator | The office: cash, prices, approvals, parts |
| Your number | Flights available | Houses rentable | Repairs approved |
| If you slip | No flights → no guests, no parts | No power / closed houses → no revenue, hangar tools offline | Undecided cards become deferrals → incident risk for everyone |
| Your jobs (puzzles) | Torque sequence, crack hunt (UV penetrant, one tap circles an indication), engine teardown, weight and balance, safety wire, hydraulic servicing, ground power start | Circuit trace, panel load, wire-up, multimeter diagnosis, conduit bending | Variance find, parts auction, cash forecast, bank reconciliation, three-way match |

Every puzzle follows the real procedure. Tiers 0–2 teach; from tier 3 the hints are gone and your real-world know-how does the work.

## 3. A week (one real day, 5–10 min each)

1. Open the app. Read the 2–3 "since you left" lines.
2. Do 2–4 jobs. Each job is a 60–120 s puzzle; the clock starts on your first touch. The better the work, the more the asset recovers: a bare pass (60%) restores 81% of the job, a clean one 105%, and perfect runs add a small permanent bonus. On an easy job (tier 1) you see your score, and under 40% it comes back as **rework** with a fresh fault. From tier 2 you don't see a score at all (see *No one tells you you're wrong*).
3. Make your calls:
   - **Analyst:** swipe cards (→ approve, ← defer, ↑ cheaper fix), then set prices on the demand curve.
   - **Mechanic / electrician:** accept or push back on a cheaper fix, and make **safety calls**: ground a plane or red-tag a house for the week if you wouldn't trust it (it earns nothing, but it can't have an incident). Once a week you can also **write up a squawk**: tap one of your assets and pick the job you judge it needs; it lands on the analyst's desk with your name on it.
4. Tap **End turn**.

**Mechanic: the ground power carts.** A *Ground power start* job needs a charged cart hooked up to that plane first. Tap a yellow cart on the island (or the *Ground power* card on your panel) to plug it in on the hangar charger, hook it up to a plane, unhook it, or inspect its cable. Its light is green from 60%, amber from 30%, red below: a start needs 30% and takes about a quarter (a turbine nearly half). A cart only charges when the week resolves, on the charger, while the hangar has power, so put it back after a start. A run-down cart shows in the start itself: its voltmeter sags under the load. Every start wears the cable, and only an inspection tells you how it's holding up. A cracked one is tagged out and goes to the electrician for a new plug; a start through burnt pins can quietly damage the plane's receptacle. Hooked up during an avionics job, a cart gives the radio a steady bus.

The week resolves at **20:00 island time**, or as soon as all three have ended their turn. Everyone gets the board review. Miss a day and your role runs on autopilot at 50%: nothing is lost, but that week doesn't count toward unlocks.

## 4. No one tells you you're wrong

On the job, nobody grades you. From tier 2 every real work order is **signed off blind**:

- **While you work:** nothing says "wrong". A bolt torqued out of sequence is taken. Safety wire pulled the loosening way stays that way. A ring you put round a scratch stays a ring. The wrong can of hydraulic fluid pours like any other, and a ground power plug pushed in live just sparks. Your multimeter call and the spot where you open the wall are final. An invoice is simply paid or held. What real instruments show is still there: the gauge needle, the voltage, the tester's 120/0, the UV glow, fluid in the sight glass (and over the top), the ITT needle climbing, a part that won't come off.
- **When you finish:** you get a logbook entry, a closed work order or a filed task. No score, no ✓. The asset's health moves by a standard amount, and the real result lands quietly when the week resolves.
- **Later:** careless work can leave a **hidden defect**. A few weeks later it becomes an incident, like a pilot write-up, a callback from a guest, or a failure in service. It costs money and health, counts against the safety grade, and the review traces it back: *"Pilot wrote up a vibration on Twin N-12: prop bolts found loose. Traced to the prop bolt re-torque Seb signed off in week 6."*
- **Your chance to catch it:** a passed inspection finds what your trade left in the work it looks at. The 100-hr inspection and code inspection prep check everything; an oil change looks at the engine and the prop; a wheel-half check has the wheel and brake off, so it sees a brake hydraulic service gone wrong; an outlet trace opens the house's boxes. A defect you find is *not airworthy / not safe until repaired*: ground or red-tag the asset, or it counts as a near-miss.
- **Then you fix it:** a found or failed defect becomes a **repair** for the same trade (a sensible corrective job on a different puzzle, which the analyst approves). What went wrong decides it: the wrong hydraulic fluid means a flush and new seals, a plug pulled live means a new external power receptacle, a hot start means a hot-section inspection. When it's done, the **original job comes back as a redo**, already paid. A botched repair or redo can leave another defect.

Tier 1 jobs, week 0, the weekly challenge and Lend a hand still show your score. They're for learning.

## 5. Crewmates' problems (cross-trade reports)

From week 3 the island throws up problems one trade has and another has to fix. All three of you report and all three fix:

- The mechanic: "the hangar work lights are dead", "the hangar's 28 V ground power keeps going dead", "the GPU cart cable is cracked at the plug" (electrician); "the parts vendor put us on credit hold", "GPU starts never make it onto the charter invoices" (analyst).
- The electrician: "the trencher drive belt snapped", "the bucket truck boom creeps down: oil at the lift cylinder" (mechanic); "utility autopay is drafting more than the bills" (analyst).
- The analyst: "office outlets go dead when the printer runs" (electrician), "the van wheel is wobbling", "the van's brake pedal is soft" (mechanic).

The two vehicles use the hydraulic bench with their own rules. The bucket truck takes the AW hydraulic oil on its decal, not aviation 5606, and the boom comes down onto its rest before anything on the lift cylinder is opened. The van's brakes take DOT 3/4 brake fluid (a glycol); mineral fluid swells its seals.

A report lands on the fixer's list, ready, no approval. While it's open it either **slows the reporter down** (2 jobs a turn, or 1 desk task), **costs cash every week**, or (the GPU cable) **keeps that cart tagged out**. Tap it to see who's waiting on you, then *Start*. A fix that doesn't hold comes back a week or two later. A money leak that comes back also charges the weeks it only looked fixed. Autopilot patches a slow-down, but a money leak waits for a person.

## 6. Lend a hand

Once a week you can try another trade's job that has already waited a week (*Lend a hand* on your panel). It's always expert difficulty: no tools, no rule text, and you do see the score. Under 60% botches it: the asset takes −6 and the job stays open for its owner. You can't fix your own report this way: the trade you reported it to has to (the third crewmate can help). Only do it if you actually know how.

## 7. Getting better together

- **Board → Weekly challenge:** the same puzzle and seed for all three this week. Try each other's trades and compare. No XP; bragging only.
- **Streaks:** every third B+ week in a row brings a story card. Two of three votes decide it.
- **Grade A** pays a bonus, and the analyst chooses what to do with it: reserve, capex, or +150 XP each (unspent, it goes to reserve).
- **Crew board** (top of the Board tab): a message board that stays. Post plans, heads-ups ("don't approve the alternator, I'll squawk it"), trash talk; pin up to 5 notes like house rules. The **✉ tabs** are direct messages with one crewmate (only you two see them in the game). The Board tab shows a badge for messages you haven't read, and ntfy pings the crew if you've set it up.
- **Crew projects:** qualifying for the next tier (tier 2: 4 full-crew B+ weeks) opens one job per trade. The tier arrives when all three are done, and your average score sets how healthy the new buildings start. Nobody can do your part for you.
- **Cash trouble:** under $2,000 only safety-critical work gets approved. Two weeks below zero puts the island in receivership, with one bridge loan to climb out.

## 8. What to test and report

After each of your first 3 days, send one message in the group chat:

- **Bugs:** anything stuck, blank, or a job you couldn't finish. Include a screenshot and your role.
- **Realism:** "a real mechanic/electrician/analyst would never…". This is the most valuable feedback, and it matters most for the incidents and repairs: tell us when the failure, the find or the fix isn't what would really happen.
- **Difficulty:** name any puzzle that was too easy or too hard at its tier.
- **Waiting:** any time you felt blocked by a teammate, and for how long.
- **Fun:** the best moment and the most boring moment.
