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
| Your zone | Hangar, airstrip, 2 planes (1 at tier 1) | 4 cottages (2 at tier 1), the grid, later a generator | The office: cash, prices, approvals, parts |
| Your number | Flights available | Houses rentable | Repairs approved |
| If you slip | No flights → no guests, no parts | No power / closed houses → no revenue, hangar tools offline | Undecided cards become deferrals → incident risk for everyone |
| Your jobs (puzzles) | Torque sequence, crack hunt (UV penetrant, one tap circles an indication), engine teardown, weight and balance, safety wire, hydraulic servicing, ground power start; when a part is missing: the IPC lookup and logbook research | Circuit trace, panel load, wire-up, multimeter diagnosis, conduit bending | Variance find, parts auction, cash forecast, bank reconciliation, three-way match |

Every puzzle follows the real procedure. Tiers 0–2 teach; from tier 3 the hints are gone and your real-world know-how does the work.

## 3. A week (one real day, 5–10 min each)

1. Open the app. Read the 2–3 "since you left" lines.
2. Do 2–4 jobs. Each job is a 60–120 s puzzle; the clock starts on your first touch. The better the work, the more the asset recovers: a bare pass (60%) restores 81% of the job, a clean one 105%, and perfect runs add a small permanent bonus. On an easy job (tier 1) you see your score, and under 40% it comes back as **rework** with a fresh fault. From tier 2 you don't see a score at all (see *No one tells you you're wrong*).
3. Make your calls:
   - **Analyst:** swipe cards (→ approve, ← defer, ↑ cheaper fix), then set prices on the demand curve.
   - **Mechanic / electrician:** accept or push back on a cheaper fix, and make **safety calls**: ground a plane or red-tag a house for the week if you wouldn't trust it (it earns nothing, but it can't have an incident). Once a week you can also **write up a squawk**: tap one of your assets and pick the job you judge it needs; it lands on the analyst's desk with your name on it.
4. Tap **End turn**.

The week resolves at **20:00 island time**, or as soon as all three have ended their turn. Everyone gets the board review. Miss a day and your role runs on autopilot at 50%: nothing is lost, but that week doesn't count toward unlocks.

## 4. No one tells you you're wrong

On the job, nobody grades you. From tier 2 every real work order is **signed off blind**:

- **While you work:** nothing says "wrong". A bolt torqued out of sequence is taken. Safety wire pulled the loosening way stays that way. A ring you put round a scratch stays a ring. The wrong can of hydraulic fluid pours like any other, and a ground power plug pushed in live just sparks. Your multimeter call and the spot where you open the wall are final. An invoice is simply paid or held. What real instruments show is still there: the gauge needle, the voltage, the tester's 120/0, the UV glow, fluid in the sight glass (and over the top), the ITT needle climbing, a part that won't come off.
- **When you finish:** you get a logbook entry, a closed work order or a filed task. No score, no ✓. The asset's health moves by a standard amount, and the real result lands quietly when the week resolves.
- **Later:** careless work can leave a **hidden defect**. A few weeks later it becomes an incident, like a pilot write-up, a callback from a guest, or a failure in service. It costs money and health, counts against the safety grade, and the review traces it back: *"Pilot wrote up a vibration on Twin N-12: prop bolts found loose. Traced to the prop bolt re-torque Seb signed off in week 6."*
- **Your chance to catch it:** a passed inspection finds what your trade left in the work it looks at. The 100-hr inspection and code inspection prep check everything; an oil change looks at the engine and the prop; a wheel-half check has the wheel and brake off, so it sees a brake hydraulic service gone wrong; an outlet trace opens the house's boxes. A defect you find is *not airworthy / not safe until repaired*: ground or red-tag the asset, or it counts as a near-miss.
- **Then you fix it:** a found or failed defect becomes a **repair** for the same trade (a sensible corrective job on a different puzzle, which the analyst approves). What went wrong decides it: the wrong hydraulic fluid means a flush and new seals, a plug pulled live means a new external power receptacle, a hot start means a hot-section inspection. When it's done, the **original job comes back as a redo**, already paid. A botched repair or redo can leave another defect.

Tier 1 jobs, week 0, the weekly challenge and Lend a hand still show your score. They're for learning.

## 5. Mechanic: the manual, and when a part is missing

**Every job on a plane starts with the manual.** Tap the job: under *Start the job* is the **Manual**. At the top is the airplane's data plate: registration, model, **S/N**, year, and the **SBs complied with**. Below it is the AMM task card: task number, effectivity, warnings and cautions, the procedure, and the torques, servicing values and consumables. The card prints **both effectivities**, as a real manual does, for example the wheel tie-bolt nuts at *A · S/N 208C00001 THRU 208C00309: 190–200 in-lb* and *B · S/N 208C00310 AND ON: 170–180 in-lb*, or the hydraulic fluid *PRE SB IC208-29-03: MIL-PRF-5606 only* and *POST SB: MIL-PRF-5606 or MIL-PRF-83282*.

- Up to tier 2 the card marks your airplane's line (◀ this airplane).
- From tier 3 nothing is marked. Read the S/N off the plate and check the SB record, the way you would on the ramp.
- The torque wrench, the hydraulic fluid and the nitrogen precharge in the puzzle use this card's numbers. From tier 3 both lines are offered. Work to the other effectivity's value and the job signs off as normal, but it leaves a hidden defect for sure.

**When a job finds a part (the part chain, from week 3 at tier 2).** Sometimes, when you sign off a job on a plane, you find a part that is gone or damaged. The screen says **Work stopped · Part needed**, and the plane is **grounded (AOG)** until the part is on. Everyone sees a banner on the island screen with the plane, the part, the steps, and whose move it is.

1. **IPC lookup** (mechanic). The squawk tells you what's on the airplane (*"brake assy P/N 30-86A (Clearwater Wheel & Brake)"*). Find the part for **this S/N and SB status** in the IPC and order it. If the assembly on the airplane isn't in the IPC at all, tap **Not in the IPC · research the records**.
2. **Buy** (analyst). An AOG card lands on the desk. No counter-offer: "if it waits, the plane stays grounded". The part rides the next cargo flight, or the boat.
3. If it wasn't in the IPC: **logbook research** (mechanic). Find in the logbooks how that assembly got there (an STC, or a field-approved Form 337). Then ask engineering to approve the part, citing it.
4. **Engineering fee** (analyst, a few hundred dollars). Engineering answers when the week resolves. It either approves the part, and a Buy card for it comes to the analyst, or returns the request with a reason, and you research again.
5. **Install** (mechanic). *Install <P/N>, then finish <the job>*. This is the original job; it pays once, and the plane is back in service.

Nothing tells you a P/N is wrong when you order it. A part that isn't effective for the airplane is caught **at receiving** when it arrives: it goes back with a restocking fee, and you look it up again. A part put on from a logbook entry alone, without engineering's approval, flies, and a later inspection finds it. The board review tells the whole story: how long the plane sat, why, and what it cost.

You get one chain at a time, with a breather after each. It never falls on the island's only guest plane: that one keeps its spares on the shelf.

## 6. Crewmates' problems (cross-trade reports)

From week 3 the island throws up problems one trade has and another has to fix. All three of you report and all three fix:

- The mechanic: "the hangar work lights are dead" (electrician), "the parts vendor put us on credit hold" (analyst).
- The electrician: "the trencher drive belt snapped" (mechanic), "utility autopay is drafting more than the bills" (analyst).
- The analyst: "office outlets go dead when the printer runs" (electrician), "the van wheel is wobbling" (mechanic).

A report lands on the fixer's list, ready, no approval. While it's open it either **slows the reporter down** (2 jobs a turn, or 1 desk task) or **costs cash every week**. Tap it to see who's waiting on you, then *Start*. A fix that doesn't hold comes back a week or two later. A money leak that comes back also charges the weeks it only looked fixed. Autopilot patches a slow-down, but a money leak waits for a person.

## 7. Lend a hand

Once a week you can try another trade's job that has already waited a week (*Lend a hand* on your panel). It's always expert difficulty: no tools, no rule text, and you do see the score. Under 60% botches it: the asset takes −6 and the job stays open for its owner. You can't fix your own report this way: the trade you reported it to has to (the third crewmate can help). Only do it if you actually know how.

## 8. Getting better together

- **Board → Weekly challenge:** the same puzzle and seed for all three this week. Try each other's trades and compare. No XP; bragging only.
- **Streaks:** every third B+ week in a row brings a story card. Two of three votes decide it.
- **Grade A** pays a bonus, and the analyst chooses what to do with it: reserve, capex, or +150 XP each (unspent, it goes to reserve).
- **Crew board** (top of the Board tab): a message board that stays. Post plans, heads-ups ("don't approve the alternator, I'll squawk it"), trash talk; pin up to 5 notes like house rules. The **✉ tabs** are direct messages with one crewmate (only you two see them in the game). The Board tab shows a badge for messages you haven't read, and ntfy pings the crew if you've set it up.
- **Crew projects:** qualifying for the next tier (tier 2: 4 full-crew B+ weeks) opens one job per trade. The tier arrives when all three are done, and your average score sets how healthy the new buildings start. Nobody can do your part for you.
- **Cash trouble:** under $2,000 only safety-critical work gets approved. Two weeks below zero puts the island in receivership, with one bridge loan to climb out.

## 9. What to test and report

After each of your first 3 days, send one message in the group chat:

- **Bugs:** anything stuck, blank, or a job you couldn't finish. Include a screenshot and your role.
- **Realism:** "a real mechanic/electrician/analyst would never…". This is the most valuable feedback, and it matters most for the incidents and repairs: tell us when the failure, the find or the fix isn't what would really happen.
- **Difficulty:** name any puzzle that was too easy or too hard at its tier.
- **Waiting:** any time you felt blocked by a teammate, and for how long.
- **Fun:** the best moment and the most boring moment.
