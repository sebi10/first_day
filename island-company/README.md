# Island Company

A 3-player asynchronous co-op management game for three friends: a mechanic keeps two planes flying, an electrician keeps four cottages powered, an analyst keeps the cash from running out. One island week resolves every real day at 20:00. Nobody wins alone.

It runs on **phones and computers** as an installable web app (PWA): no App Store and no hosting bill. Progress lives on a free Firebase project and follows your seat across devices.

## Play it in 60 seconds (one device, no setup)

```bash
cd island-company
npm install
npm run dev          # open the printed URL on your phone (same Wi-Fi) or computer
```

Start screen → **New island** → **1 device · pass & play**. All three seats live on that device; tap **Pass** to hand it over. Good for testing, for playing in the same room, and for learning the puzzles.

## Play online (three phones and/or computers), free

**Live project: `islandgame-efc37`** → <https://islandgame-efc37.web.app> once deployed. Steps 1–4 below are already done for it: Anonymous auth is on, Firestore exists, and the web config is committed in `.env.production` (with `.firebaserc` pointing at the project). What remains is step 5, by either route:

- **Auto-deploy from GitHub (recommended, repeatable):** create a service-account key with the *Firebase Admin* role (Google Cloud console → IAM & Admin → Service accounts → project islandgame-efc37 → Create → role *Firebase Admin* → Keys → Add key → JSON). In GitHub → sebi10/first_day → Settings → Secrets and variables → Actions, add it as **`FIREBASE_SERVICE_ACCOUNT`** (paste the whole JSON). Then Actions → *Deploy island* → Run workflow. From then on every push that touches `island-company/` tests, builds and deploys hosting + `firestore.rules`.
- **One-off from your computer:** `cd island-company && npm ci && npm run build && npx firebase-tools login && npx firebase-tools deploy --only hosting,firestore:rules`.
- **Always deploy hosting and `firestore.rules` together.** The rules accept island writes of one document version (`v`, `DOC_VERSION` in `src/net/firebase.ts`), so a tab or an installed phone app still running an older build is refused instead of writing with an older engine, and reloads to the new one. An open page also reloads when a new service worker takes over.

For a different project, do it once, about 5 minutes. Firebase's **Spark plan is free** and has no card on file. Three players use roughly 0.1% of the free Firestore quota.

1. **Create the project.** Go to <https://console.firebase.google.com> → *Add project*. Analytics is not needed.
2. **Auth.** *Build → Authentication → Get started →* enable **Anonymous**.
3. **Database.** *Build → Firestore Database → Create database* (production mode, any region near you).
4. **Web config.** *Project settings → Your apps → Web `</>`*. Copy the values into `island-company/.env.local` (template: `.env.example`):
   ```
   VITE_FB_API_KEY=...
   VITE_FB_AUTH_DOMAIN=your-project.firebaseapp.com
   VITE_FB_PROJECT_ID=your-project
   VITE_FB_APP_ID=...
   ```
   These values are public by design. The security rules in `firestore.rules` do the protecting.
5. **Deploy hosting and rules** (also free):
   ```bash
   npm run build
   npx firebase-tools login
   npx firebase-tools deploy --project your-project   # uploads dist/ + firestore.rules
   ```
6. Share `https://your-project.web.app`. Each friend opens it, taps **Join with a code**, and picks a seat.

Other hosting options: any static host works (Netlify, Cloudflare Pages, GitHub Pages) as long as you upload `dist/`. If you skip step 4, each device can paste the config at *Start → Online setup* instead.

### Install on each device

| Device | How |
| --- | --- |
| iPhone / iPad | Safari → Share → **Add to Home Screen** |
| Android | Chrome menu → **Install app** |
| Mac / Windows / Linux | Chrome or Edge → install icon in the address bar. The page also works as a normal tab. |

Once installed it runs full screen and works offline. Puzzle results queue while offline and sync on reconnect.

### Same seat on phone and computer

*Me → Crew and devices* shows your **island code** and a private **seat code**. On the other device: *Join with a code* → island code → pick your seat → enter the seat code. Both devices now play the same seat, and progress carries over through the server.

A pass-and-play island can be moved online with its progress intact: *Me → Move this island online*.

### Notifications (optional, free)

Install the [ntfy](https://ntfy.sh) app, subscribe to a topic, and save the same topic in *Me → Notifications*. The whole crew then gets pinged when someone ends a turn, when a week resolves, when a crewmate reports a problem or closes one out, when a grounded plane's part moves on to someone's move, and when a counter-offer arrives. Quiet hours are 22:00–08:00.

## How a week works

- Each player takes one 5–10 minute turn: 2–4 hands-on puzzles plus 1–2 decisions, then **End turn**.
- The week resolves at 20:00 in the creator's time zone, or as soon as all three have ended their turn. Whichever phone notices first resolves it, inside a Firestore transaction, so it happens exactly once. There's no server code to run.
- A missed turn runs on autopilot at 50%. Autopilot weeks never lose progress, but they don't count toward unlocks, because nobody wins alone.
- Each new tier is a **crew project**: one real job per trade, and the tier opens when all three are done. See [docs/ONBOARDING.md](docs/ONBOARDING.md) for the full crew briefing.
- The mechanic runs the **ground power carts** (one, two from tier 3): charge them on the hangar charger, hook one up to a plane before a ground power start or radio work (its ops check runs the bus on ground power), inspect the cables. Tap a cart on the island or the *Ground power* card. About one week in three a plane's battery is weak: a charged cart hooked up to it before the week resolves starts it, or its first flight is lost (no job slot, just the chore). An inspection is a close look at the plug end, and the call is yours: serviceable, or tagged out for the electrician's new plug. A low cart sags under the start; a worn cable called serviceable quietly damages a plane's receptacle.
- Resolution is deterministic: the three turns plus a seeded incident roll. The seed is shown on the board review, so any week can be replayed.

## Puzzles (19: nine for the mechanic, five each for the electrician and the analyst, all modelled on the real job)

| Mechanic | Electrician | Analyst |
| --- | --- | --- |
| Torque sequence (star pattern, click band) | Circuit trace (breaker → outlet, find the fault) | Variance find (budget vs actual drivers) |
| Crack hunt (UV penetrant: one tap circles an indication, swab for bleed-back) | Panel load (balance L1/L2, 240 V double-poles) | Parts auction (2 AI bidders, walk-away cap) |
| Engine teardown (order, failed part, rebuild) | Wire-up (strip, loop, land hot/neutral/ground) | Cash forecast (draw 4 weeks, scored vs outcome) |
| Weight and balance (CG envelope) | Multimeter diagnosis (open neutral, MWBC; on the part chain, a 28 V DC circuit on the airplane) | Bank reconciliation (timing items, transpositions) |
| Safety wire (tightening direction, twists/inch) | Conduit bending (offsets, saddles, 360° rule) | Three-way match (PO / receipt / invoice) |
| Hydraulic servicing (discharge the accumulator, placard fluid to FULL, nitrogen precharge, bleed; the crew's bucket truck boom and company van on the same bench) | | |
| Ground power start (cart set to the placard, plug seated, volts checked; turbine ITT from tier 4; the island's cart, as charged as it is) | | |
| IPC lookup (part chain: the P/N for this S/N and SB status, or "not in the IPC") | | |
| Logbook research (part chain: how the assembly got there, and the engineering request) | | |

Difficulty comes from the order's tier (1–5), which climbs as the island grows. It never depends on your level. Levels unlock **tools** that change how a puzzle plays (for example the click-type wrench, non-aqueous developer, clamp meter and driver tree): convenience or raw readings to interpret, never the answer. From tier 3 the teaching aids are gone, so real trade knowledge is what separates the three of you.

**The manual.** Every mechanic job on a plane opens with its AMM task card: the airplane's data plate (S/N, SBs complied with, its alteration) and the card's torques, servicing values and consumables with both effectivities printed. Tiers 0–2 mark this airplane's line; from tier 3 you match the S/N and SB status yourself. On an assembly an STC or a field approval replaced, the alteration's ICA governs: its values are printed first, the airframe manual's stay printed (marked replaced at tiers 0–2), and an SB on the removed assembly reads *n/a* on the plate. The torque and hydraulic puzzles use the card's values. Working to the other effectivity's value, or to the airframe manual's on an altered assembly, leaves a hidden defect. A ground power start shows the flight manual's Section 4 procedure and the plane's own placard.

**The part chain** (from week 3 at tier 2). Sometimes a job on a plane finds a part it can't be finished without. The plane is grounded until it's fixed. The mechanic looks the part up in the IPC for that S/N, and the analyst approves the AOG purchase: the card shows the part, the freight (the AOG boat on the PO when the cargo plane is the one down, or the next guest flight free a week later) and what the downtime costs. If the part isn't in the IPC (on an altered plane it mostly isn't), the mechanic researches the logbooks (an STC or a field-approved 337), and the analyst pays engineering, whose answer comes when the week resolves. On an electrical unit (a com radio, an alternator or a starter-generator) the electrician meters its circuit at the airplane first, beside the lookup: the unit, or its wiring? The unit is only bought on that call, and a wiring fault is fixed there and then, no part. When the part arrives, receiving checks its 8130-3 (now and then one waits a week in quarantine for its paperwork) and its P/N, and the mechanic installs it and finishes the original job. A wrong P/N goes back for its price less a 15% restocking fee. A good unit bought for a wiring fault makes no difference at the install and goes back the same way. A part put on without engineering approval turns up at a later records audit or inspection. See [docs/ONBOARDING.md](docs/ONBOARDING.md) §5 and *The manual and the part chain* in [docs/DECISIONS.md](docs/DECISIONS.md).

**Whose move it is.** A part chain's next step and a crewmate's open report count the same way everywhere: the crew strip (*waiting on you* / *blocking you*), the cards at the top of the island screen, the end-turn check (*Seb is waiting on you: …*) and the pings.

From puzzle tier 2 a real work order is **signed off blind**, whatever the puzzle (hydraulic servicing and the ground power start included): no score, no ✓/✗, no "wrong" while you work and no reveal at the end. What the instruments and the part show stays (a gauge needle, fluid spilling over, sparks from a live plug). Careless work can leave a hidden defect that surfaces weeks later as a write-up or a failure, traced back to whoever signed it off; then comes a repair and the original job again. See [docs/ONBOARDING.md](docs/ONBOARDING.md) and the *Consequences* section of [docs/DECISIONS.md](docs/DECISIONS.md).

## Development

```bash
npm test             # engine + puzzle model tests (vitest)
npm run balance      # paper sim: 10 scripted teams x 26 weeks x 30 seeds
npm run typecheck
npm run build        # dist/ with an offline service worker
open http://localhost:5173/lab.html?p=torque&tier=3&seed=1   # puzzle lab (&blind=1: as a real job, no verdict)
#   &card=1&job=prop              torque / hydraulics on the island plane's AMM task card (both effectivities)
#   &chain=lookup&plant=32-40     the part chain's IPC lookup on a plane with an STC on its brakes (&via=field: a 337)
#   p=logbook&chain=research&plant=32-40   the chain's logbook research
#   p=meter&job=altField&fault=wiring      the chain's circuit check (&job=sgField|comPower, &fault=unit)
#   p=gpu&asset=Float%20F-3                a ground power start on the island's own plane (its placard)
open "http://localhost:5173/lab.html?p=hydraulics&tier=2&job=boom"   # &job=van, wireup &job=gpuCable, meter &job=hangar, variance &job=gpu; gpu &charge=30
open "http://localhost:5173/islandlab.html?w=358&only=gse-zoom"      # the island in fixed scenes (gse, gse-zoom, gse-night …)
node scripts/e2e.mjs shots/          # scripted playtest (phone); add `desktop` for 1280x820
```

| Path | What |
| --- | --- |
| `src/sim/` | Pure, deterministic engine: `engine.ts` (reducer + weekly resolution, the part chain's steps), `econ.ts` (demand curves, risk), `data.ts` (**every tunable number**), `bots.ts` (paper-sim players), `aircraft.ts` (each plane's seeded records, IPC, AMM task cards and ICA values), `chain.ts` (the part chain's airplane side: what's found, which P/N fits, prices, whose move) |
| `src/puzzles/` | 17 canvas puzzles, each a pure `generate/score` model plus a view |
| `src/net/` | `local.ts` (this device), `firebase.ts` (Firestore single-doc transactions + offline outbox), `session.ts` |
| `src/ui/` | Preact screens: island SVG, role panels, analyst desk, board review, week 0 |
| `docs/DECISIONS.md` | Where and why this build departs from the original spec |
