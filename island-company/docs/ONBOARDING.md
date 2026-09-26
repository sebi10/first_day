# Crew briefing: first day on the island

About 10 minutes to read and set up. One person (the "host") does the setup once; the other two just open a link.

## 0. Host setup (once, ~5 min, free)

Follow README → *Play online*: create a Firebase project, turn on Anonymous auth, create Firestore, put the web config in `.env.local`, then `npm run build` and `npx firebase-tools deploy`. You get a URL like `https://your-project.web.app`.

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
| Your jobs (puzzles) | Torque sequence, crack hunt (UV penetrant), engine teardown, weight and balance, safety wire | Circuit trace, panel load, wire-up, multimeter diagnosis, conduit bending | Variance find, parts auction, cash forecast, bank reconciliation, three-way match |

Every puzzle follows the real procedure. Tiers 0–2 teach; from tier 3 the hints are gone and your real-world know-how does the work.

## 3. A week (one real day, 5–10 min each)

1. Open the app. Read the 2–3 "since you left" lines.
2. Do 2–4 jobs. Each job is a 60–120 s puzzle, and there's only one attempt: a pass is full credit, a perfect run adds a small permanent bonus.
3. Make your calls:
   - **Analyst:** swipe cards (→ approve, ← defer, ↑ cheaper fix), then set prices on the demand curve.
   - **Mechanic / electrician:** accept or push back on a cheaper fix.
4. Tap **End turn**.

The week resolves at **20:00 island time**, or as soon as all three have ended their turn. Everyone gets the board review. Miss a day and your role runs on autopilot at 50%: nothing is lost, but that week doesn't count toward unlocks.

## 4. Lend a hand

Once a week you can try another trade's ready job (*Lend a hand* on your panel). Your own tools stay home. Under 40% botches it: the asset takes −6 and the job stays open for its owner. Only do it if you actually know how.

## 5. Getting better together

- **Board → Weekly challenge:** the same puzzle and seed for all three this week. Try each other's trades and compare. No XP; bragging only.
- **Streaks:** every third B+ week in a row brings a story card, and any of you can make the call.
- **Grade A** pays a bonus, and the analyst chooses what to do with it: reserve, capex, or +150 XP each.
- **Unlocks:** tier 2 comes after 4 full-crew B+ weeks; the island shows faint outlines of what's coming.

## 6. What to test and report

After each of your first 3 days, send one message in the group chat:

- **Bugs:** anything stuck, blank, or a job you couldn't finish. Include a screenshot and your role.
- **Realism:** "a real mechanic/electrician/analyst would never…". This is the most valuable feedback.
- **Difficulty:** name any puzzle that was too easy or too hard at its tier.
- **Waiting:** any time you felt blocked by a teammate, and for how long.
- **Fun:** the best moment and the most boring moment.
