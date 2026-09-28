# The airline network, the free map, and per-trade island interactions: implementation spec

Status: the spec for the build, before the critique round. It covers four packages: A (engine), B (map), C (objects) and D (network desk).
- **Base:** `1f92356`. The live build is `bd1e1d2` (ENGINE_VERSION 3, DOC_VERSION 3, rules `v == 3`).
- **Builds on branch `gaps`**, once it lands. `gaps` brings v4 plus:
  - the grounded sole guest plane and a mainland sub-charter
  - the feeder re-splice scene
  - the builders' zoom box `siteBox(s)`
  - the robust-tail levers: staggered code notices and an alert throttle
- **This document is the contract between the four packages.** Where it names a type, a function, a file or a number, build that.
- **Tune** marks a starting value that the balance run may move. Record the final value in `docs/DECISIONS.md`, section *Airline network*.

**Contents.**
- 0 What the owner asked for, and the finding that comes first
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
- 14 Work split and file ownership
- 15 Risks and open questions
- 16 Changed direction, with reasons
- 17 Decisions the owner should know about

**Who reads what.**
- **A:** all of it.
- **B (the map):** 0, 1, 2.2, 2.5, 3.1–3.2 (what's drawn), 4.2 (UI rows), 5, 6.1, 9.1, 13.2, 14, 16.
- **C (objects):** 0, 1, 2.5, 4.3, 4.6, 4.8, 6, 7 (`check`, `flag`, `trip`), 9.2, 13.3, 14, 16.
- **D (the network desk and the techs' outstation screens):** 0, 1, 2, 3, 4, 7, 9.3–9.5, 10.4, 11.3, 12, 13.4, 14, 16.

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

The island becomes the home station of a small airline. After the Resort (tier 5), the analyst can open two more stations as crew projects, each needing one job from every seat plus a capex decision:
- **Tern Cay:** an outstation airstrip on a neighbouring island, with two guest cottages, a service panel and a self-serve fuel dispenser.
- **Port Adair Regional:** the mainland hub. It has a leased hangar bay (heavy maintenance, a GPU cart), a parts desk (long-lead parts come a week sooner) and a pilot base.

Planes fly **routes** between stations. The analyst leases or buys them, assigns them and sets fares and frequency. Every existing system works on an asset at any station, because the station is just a field on the asset: alerts, the job flow, stock, purchasing, puzzles, blind sign-off and defects, reports, the part chain, carts, staff and finance. Techs make **one trip a week** to an outstation when there is work there, and the parts go with them. Most planes never need a trip, because a plane on a route through home is worked at home. The map becomes a **free camera** (pinch, drag, wheel, double-tap, presets, a region view of the network). **Every meaningful object is tappable**, and what a tap shows depends on the seat. Each tech gets **one quick check a week** that can catch a hidden defect early:
- the mechanic: a walkaround
- the electrician: an IR scan or a meter check

### 0.2 Rules that apply everywhere

1. **A station is context, not a code path.**
   - An asset's station is `asset.st` (absent = home).
   - Every system asks for the station through one helper and otherwise runs unchanged.
   - Adding an airport later is a `StationDef` entry, a `RouteDef` or two, and a `SceneLayout`. No engine code. A test proves it (13.1, the *ZZ* station).
2. **Home is byte-identical until the network opens.**
   - An island that never opens a station resolves byte-for-byte as the `gaps` build does, given the same moves. A golden test proves it.
   - New fields are written only when first used, never initialized.
   - New random draws use their own streams (`hashSeed(s.seed, 'net', …)`), never the week's `r`.
   - That is the proof that tier 1–5 pacing doesn't move (11.5).
3. **The trades' time is the scarce resource.**
   - A tech does about 3 jobs a week.
   - The network's routine work comes from a separate, capped alert pass: at most 1 new routine alert a week per trade, network-wide, plus must-do safety work capped at 3 open (4.5).
   - More stations mean the same slots spread over more assets. The analyst sizes the network knowing that. A load gauge shows it (9.3).
4. **Stored vs derived.**
   - **Stored:** what is open, the fleet deals, fares and frequencies, this week's trips, the weekly quick-check and flag stamps, and 26 weeks of sparse route and station numbers.
   - **Derived:** everything else (2.7).
5. **Old docs load and play.**
   - Every new field is optional, and absent means home only.
   - `migrate()` adds nothing for the network.
   - v4 goes with `gaps` (10).
6. **No role wins alone. NPCs never do trade work.**
   - A station opens only when all three seats have done their project job.
   - NPCs fly, clean and build.
   - The airport authority maintains the Port Adair terminal and airfield. That is a landlord outside the game, not an NPC.
7. **Money decisions show their numbers.** Every network card states its weekly effect and its payback in dollars and weeks, with the assumptions written on the card (3.3–3.5).
8. **Phones first.**
   - 44 px targets, 360–390 px widths, keyboard-aware sheets. Desktop at 1280 px too.
   - The camera never re-renders per frame (5.6).

### 0.3 The finding that comes first: the long game after the Resort doesn't hold today

The direction (X3) makes the network "the long game after tier 5". The paper sim says that long game is broken today, and the 26-week balance window hides it. These are scratch probes on `1f92356`: 10 seeds × 52 weeks, the real reducer, the scripts in this session's scratchpad. No code was committed.

| Team | Games below $0 in weeks 24–52 | Weeks below $0 (of 290) | Dead weeks (revenue < $2,000) | Cash at week 52, median | Credits (8 straight A at tier 5) |
|---|---|---|---|---|---|
| three friends | 10 / 10 | 141 | 214 | −$187,000 | 0 / 10 |
| all average | 10 / 10 | 134 | 211 | −$183,000 | 0 / 10 |
| all good (skill 0.88, 4 jobs/turn, never absent) | 0 / 10 | 0 | 1 | +$416,000 | — |

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

**Levers applied only after tier 5 aren't enough**, because the slide starts in tier 4:

| Change after tier 5 | all average: games below $0 | three friends: games below $0 |
|---|---|---|
| decay 3, inspections every 13 weeks, houseWear 1 | 5 / 10 | 9 / 10 |
| decay 1, the same | 1 / 10 | 4 / 10 |
| decay 0 (the upper bound) | 1 / 10 | 2 / 10 |

**Consequence for this spec:**
- **Package A starts with A0, "a Resort that holds"** (11.2). It lands on top of `gaps`, whose robust-tail levers (staggered code notices, the alert throttle) aim at exactly this tier-4 overload.
- A0 has its own target on a 52-week run.
- The network is built on A0. Building an airline on an island that sinks by week 35 would make the network look like the cause.
- Trade-off: the network ships a little later, on ground that holds.

### 0.4 What's in v1 and what waits

| Area | v1 (this build) | Later |
|---|---|---|
| Stations | Tern Cay (outstation), Port Adair Regional (hub); open, mothball, reopen | more airports (data only); selling a station |
| Routes | Home–Tern, Home–Adair, Adair–Tern; fare and round trips a week per route; one route per plane | multi-leg rotations, timetables, codeshare, connecting guests |
| Fleet | lease (13-week minimum) or buy the three existing models; return or sell; base and route | new models (a turbine twin), wet lease, heavy checks by an outside MRO |
| Travel | one trip a week per tech, paid from the work budget; parts hand-carried | per-station line kits, crew duty-time |
| Stock | one central stockroom; drop-ship to a station at the normal ETA; Port Adair's parts desk takes a week off long leads | per-station inventory and transfers |
| Map | free camera, presets, region view, one detailed scene at a time | animated route traffic, a day/night clock per station |
| Objects | every object tappable, per-seat sheets, one quick check a week per tech, *Report a problem* | quick checks for the analyst, per-object history timelines |

---

## 1. How it feels, seat by seat

### 1.1 The three seats in the network era

| Seat | Today (tier 5) | With the network |
|---|---|---|
| Mechanic | Alerts on 3 planes and the generator; the job flow; carts; the part chain | The same, on up to 3 more planes. Planes on a route through home are worked at home. A plane based away (an Adair–Tern plane) or AOG at an outstation needs a trip, with the part drop-shipped there. Port Adair's hangar takes heavy work. Tern Cay has no hangar: line work only, unless the plane is AOG (a field repair). One walkaround a week can catch a defect before it fails. |
| Electrician | Alerts on 7 houses, the grid and the generator | The same, plus each station's assets. Tern Cay: its service panel, the fuel-dispenser circuit (NEC 514) and two cottages. Port Adair: the leased hangar bay's panel, the GPU-charger and 28 V circuits (NEC 513), and the hub's hangar reports. One trip a week covers a station. One IR scan or meter check a week catches a loose lug or a loose neutral before it arcs. |
| Analyst | Approvals, stock, money, hiring, pricing | A **Network** desk tab. It opens stations (capex and payback on the card), leases or buys planes (lease vs buy on the card), assigns them to routes, and sets fares and round trips from the route's demand curve. It shows P&L per station and route: load factor, cost per seat, contribution, payback. It holds the hiring board per station (a Tern housekeeper, pilots at the hub), a load gauge per trade, and mothball / reopen. |

### 1.2 A season after the Resort, week by week (three friends, good play)

| Week | What happens |
|---|---|
| 22–23 | The Resort arrives. The Network tab shows a locked card: "After the Resort settles (2 weeks): open Tern Cay." What's new tells the techs the map now zooms and everything is tappable. |
| 25 | The analyst opens Tern Cay (3 taps). The card says: "$24,000 when it opens + a crew project. With a leased twin on Home–Tern at 3 round trips a week: about +$1,300 a week, pays back in about 19 weeks." Three project cards appear, one per seat. |
| 26 | The jobs: the mechanic's short-field load sheet for the 1,900 ft strip, the electrician's dispenser feeder in RMC with a sealing fitting and an emergency shutoff, the analyst's 4-week cash forecast. The electrician's is last. Tern Cay opens at the resolve: two cottages and the panel at 60 + 30 × the crew's quality, a cart, a housekeeper hired at skill 3 ($180/wk). |
| 27 | The analyst leases a twin: base home, Home–Tern, 3 round trips, $90 fare. It arrives at week 28 with a fly-away kit and its 100-hr due in 4 flights: the mechanic's first job on it. |
| 29 | Alert: "Guest at Tern Cay Cottage A: kitchen outlets dead". The electrician books the week's trip ($150, from his work budget), investigates, and fixes the GFCI there with parts from the stockroom. He IR-scans the Tern Cay panel. The dispenser breaker runs 19 °C over its neighbours at a quarter of the load, so he opens it: a loose lug. It is found early, and a repair alert follows. |
| 30 | The mechanic walks around the leased twin. Brake dust on the wheels (normal). He writes nothing up. |
| 33 | Home–Tern: load factor 53%, $1,440 a week in fares, cottages $2,500 a week. The analyst eyes Port Adair. The mechanic's load gauge reads "3.4 jobs a week needed, 3.1 done". The analyst holds off on a third plane. |
| 36 | Port Adair opens. Long-lead parts are a week sooner for everyone. A second leased twin on Home–Adair at 5 round trips runs about 84% full. |
| 40 | The Adair–Tern route opens, but at 45% full it would lose $240 a week. The analyst skips it. That is the naive trap the card shows. |
| 44 | Tern Cay has paid back. Port Adair is at 60%. The crew board argues over a fare cut. |

---

## 2. Data model

### 2.1 Code: the station catalog (`src/sim/stations.ts`, new, A)

```ts
import type { PuzzleId } from '../puzzles/types';
import type { ElecSite, NpcRole, Role } from './types';

export type StationId = string; // 'home' is implicit; catalog ids: 'tern', 'adair'
export type RouteId = string; // 'home-tern', 'home-adair', 'adair-tern'
export type PlaneModelId = 'twin' | 'cargo' | 'float';

export interface StationDef {
  id: StationId;
  /** 'Tern Cay' */
  name: string;
  /** a fictional three-letter code, for route labels: 'TRN' */
  code: string;
  kind: 'outstation' | 'hub';
  /** hangar: HEAVY work can be done here; chargers: carts here charge; partsDesk: supplier lead −1 week network-wide while open */
  caps: { hangar: boolean; chargers: boolean; partsDesk?: boolean };
  /** capex is committed when the project starts and paid when the station opens */
  open: { capex: number; project: { title: string; jobs: Record<Role, { title: string; puzzle: PuzzleId }> } };
  /** USD a week while open (× NET.mothball while mothballed) */
  overhead: number;
  /** added to the week's revenue budget for the board grade while open */
  budget: number;
  /** health an untouched asset of this station loses a week (home: ECON.decay) */
  decay: number;
  /** its houses' nightly rate, × the island's (a quieter island rents for less) */
  rateX?: number;
  /** what opening adds: asset ids are unique across the catalog, prefixed by the station id */
  adds: { id: string; model: string; name: string }[];
  gse?: { id: string; name: string }[];
  /** stores bins added while open */
  bins?: number;
  /** the rooms its panel's alerts may draw (a symptom cause outside them is skipped here); none: every room */
  rooms?: ElecSite['room'][];
  /** phrase map for alert text, card titles and incident text on its assets ('the fuel dock' → 'the fuel dispenser') */
  words?: Record<string, string>;
  /** the standard staff hired at skill 3 when it opens (shown on the opening card) */
  staff?: Partial<Record<NpcRole, number>>;
  /** USD on top of the seat (the route's fare) for a tech's trip here: the per diem, or a hotel */
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
  /** passengers a week, both ways together, at the reference fare's demand point (see routeWeek) */
  demand: number;
  /** landing, parking and handling, USD per round trip */
  fees: number;
  /** USD per round trip a cargo plane earns on the route's freight contract */
  cargo: number;
}

export const STATIONS: Record<StationId, StationDef>; // 3.1, 3.2
export const ROUTES: Record<RouteId, RouteDef>; // 3.3
```

**Plane operating data and the network's constants** (same file; all **tune**):

```ts
export const PLANE_OPS: Record<PlaneModelId, { seats: number; fuelPerH: number; blockX: number; lease: number; price: number; word: string }> = {
  twin: { seats: 5, fuelPerH: 200, blockX: 1, lease: 1000, price: 58000, word: 'Twin' },
  float: { seats: 4, fuelPerH: 110, blockX: 1.2, lease: 800, price: 44000, word: 'Float' },
  cargo: { seats: 0, fuelPerH: 260, blockX: 0.9, lease: 1250, price: 76000, word: 'Cargo' },
};

export const NET = {
  minTier: 5,
  /** weeks after the Resort arrives before the first station can open */
  settle: 2,
  /** no network spend (open, lease, buy) may leave spendable cash under this */
  floor: 25000,
  maxNetPlanes: 3,
  /** demand(fare) = demand × season × 1 / (1 + e^((fare − mid × ref) / (s × ref))) */
  fareMid: 1.2,
  fareS: 0.3,
  fareMin: 0.5,
  fareMax: 2,
  /** the network alert pass, per trade: open alerts it keeps, new routine alerts a week, must-do alerts open at most */
  alerts: { target: 2, perWeek: 1, mustDo: 3, nff: 0.15 },
  /** health a network plane loses in a week it wasn't worked on (home planes: ECON.decay) */
  planeDecay: 2,
  tripsPerWeek: 1,
  /** a trip with no route flight to ride this week: an air taxi at this multiple of (fare + per diem) */
  airTaxi: 2.5,
  leaseMinWeeks: 13,
  /** weeks of lease charged for a return before the minimum */
  leaseEarly: 4,
  /** resale: share of the price on the day, less this a week, never under the floor */
  resale: { day: 0.8, perWeek: 0.005, floor: 0.45 },
  mothball: 0.3,
  /** a new plane: its health, and flights since its last 100-hr (the acceptance inspection comes due in 4 flights) */
  newPlane: { health: 85, sinceInspection: 8 },
  /** the station project's order tier */
  projectTier: 4,
};

/** jobs that need a hangar (company GMM: inspections and major repairs at a maintenance base), unless the plane is AOG (a field repair) */
export const HEAVY = ['inspect100', 'cylinder', 'spar', 'corrosion'] as const;
```

**Helpers** (pure; same file; every system calls these and nothing else to learn a station):

```ts
export const stOf = (a: Pick<Asset, 'st'>): StationId => a.st ?? 'home';
/** a network asset: a station's, or a network plane (every asset before v4, and every home tier asset, has no st) */
export const isNet = (a: Pick<Asset, 'st'>) => a.st !== undefined;
export function stationDef(id: StationId): StationDef | undefined; // undefined for 'home'
export function stationState(s, id): StationState | undefined; // from s.net
export const isOpen = (s, id) => id === 'home' || stationState(s, id)?.state === 'open';
/** the stations where a plane can be worked this week: its base, and while it flies a route both ends (it lands there every day); AOG: its base only */
export function workStations(s, a: Asset): StationId[];
/** fixed assets: [stOf(a)] */
export function assetsAt(s, st: StationId): Asset[];
export function routesOpen(s): RouteDef[]; // both ends open (not mothballed)
export function routeFare(s, r: RouteId): number; // s.net.fares[r] ?? ROUTES[r].fare
export function tripOf(s, role: OpsRole): Trip | undefined; // this week's
/** the tech can work there this week without booking anything */
export const onSite = (s, role, st) => st === 'home' || tripOf(s, role)?.st === st;
/** the trip's price: the cheapest open route's fare between home and st + per diem, or the air taxi when no plane on it flies this week */
export function tripCost(s, st: StationId): number;
/** the words at a station ('the fuel dock' → 'the fuel dispenser') */
export function stationWords(s, assetId: string | null, text: string): string;
```

### 2.2 Code: scene layouts (`src/ui/map/layouts.ts`, new, B)

Geometry is UI data, so the sim catalog has none.

```ts
import type { Box, Pt } from '../island/geo';
import type { Role } from '../../sim/types';

export interface SceneLayout {
  id: StationId;
  /** the viewBox (home: 800 × 600) */
  w: number;
  h: number;
  /** a station's own terrain: the coast (clockwise), beach widths, a hill; home keeps its bespoke Terrain */
  coast?: Pt[];
  beach?: number[];
  hill?: Pt[];
  runway: { a: Pt; b: Pt; w: number };
  apron: Pt[];
  /** front-centre ground points */
  hangar?: Pt;
  /** the station building: Tern Cay's shed with its counter, Port Adair's gate */
  terminal?: Pt;
  fuel?: Pt;
  windsock: Pt;
  dock?: Pt;
  /** each station asset's front-centre ground point, by asset id */
  pos: Record<string, Pt>;
  /** plane stands, in order: based network planes take them in fleet order (home: the stands after p1–p3's) */
  stands: Pt[];
  /** each station plane's AOG spot (by stand index) */
  aog?: Pt[];
  /** cart parking and the charger outlets */
  carts: { home: Pt[]; outlet: Pt[] };
  /** overhead lines: from a pole to the asset ids it feeds */
  poles?: { at: Pt; to: string[] }[];
  /** "my zone" per seat at this station */
  focus: Partial<Record<Role, Box>>;
  /** on the region map (1000 × 700): the pin, and the island's outline there */
  region: { at: Pt; shape: Pt[] };
  props?: { kind: 'palms' | 'rocks' | 'drums' | 'bowser' | 'sock'; at: Pt[] }[];
}

export const LAYOUTS: Record<StationId, SceneLayout>; // 'home' (from geo.tsx's constants), 'tern', 'adair'
export const REGION = { w: 1000, h: 700 };
```

### 2.3 Code: what the station catalog is, and isn't

- `STATIONS`, `ROUTES`, `PLANE_OPS`, `NET` and `HEAVY` are code. `LAYOUTS` is UI code. Balance passes touch `stations.ts` only.
- The asset models are reused: Tern Cay's panel is a `panel` and its cottages are `cottage`s; Port Adair's bay panel is a `panel`. That's why every catalog kind, symptom, task, puzzle and defect rule already applies. **No new asset model, kind, symptom or task is needed for v1.** Station flavour comes from `rooms`, `words`, `rateX` and the layout.
- `MODELS`, `CATALOG`, `SYMPTOMS` and `TASKS` are untouched. If a future airport wants a new model (a terminal building), that is a data addition to `MODELS` plus the catalog `targets` arrays, and it's out of scope here.

### 2.4 Stored: the new state fields (`src/sim/types.ts`, A)

Every field is optional. Absent means home only, as today.

```ts
export interface Asset {
  // …today's fields…
  /** its station (a station's buildings), or a network plane's base. Absent: home (every asset before v4, every tier asset) */
  st?: StationId;
  /** a plane's route; absent: island ops at home (today's guest flights and tours), or not a plane */
  rt?: RouteId;
  /** the week its base last changed (that week it flies one flight fewer: the ferry leg) */
  moved?: number;
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
  /** where the reporter's trouble is (a hub hangar report); absent: home */
  st?: StationId;
}

export interface StationState {
  id: StationId;
  state: 'project' | 'open' | 'mothballed';
  /** the week it entered its state */
  since: number;
  /** the week it first opened */
  opened?: number;
}

export interface FleetEntry {
  /** the plane, once delivered ('f<n>'); undefined until the week opens */
  asset?: string;
  model: PlaneModelId;
  how: 'lease' | 'buy';
  /** week of the deal; the plane joins at the next week's open */
  week: number;
  /** lease: USD a week; buy: the price paid */
  usd: number;
  base: StationId;
  route?: RouteId;
}

export interface Trip {
  role: OpsRole;
  st: StationId;
  week: number;
  usd: number;
}

export interface NetState {
  stations: StationState[];
  fleet: FleetEntry[];
  /** USD one way per seat; absent: the route's reference fare */
  fares?: Record<RouteId, number>;
  /** round trips a week per plane on the route; absent: all it can fly */
  freq?: Record<RouteId, number>;
  /** this week's trips (cleared at week open) */
  trips?: Trip[];
  /** capex committed to the open station project (paid when it opens) */
  commit?: number;
}

export interface IslandState {
  // …today's fields…
  /** the airline network (docs/EXPANSION.md). Absent: home only */
  net?: NetState;
  /** week of each tech's last quick check (one a week) */
  checked?: Partial<Record<OpsRole, number>>;
  /** week of each seat's last flag ("report a problem": one a week) */
  flagged?: Partial<Record<Role, number>>;
  /** a station's crew project carries its station */
  project?: { tier: number; title: string; orders: Partial<Record<Role, string>>; st?: StationId } | null;
}

export interface WeekLedger {
  // …today's fields…
  /** per route: [round trips, pax, seats, revenue, direct cost (fuel + fees)] */
  rt?: Record<RouteId, [number, number, number, number, number]>;
  /** per station: [revenue (its rentals), cost (overhead + its assets' parts and labour)] */
  stn?: Record<StationId, [number, number]>;
}

export interface WeekReport {
  costs: {
    // …today's fields…
    /** station overhead, leases, route fuel and fees */
    network?: number;
  };
  /** of `revenue`: fares, freight contracts and station rentals */
  netRevenue?: number;
}

export type SpendCat = /* today's */ | 'fuel' | 'fees' | 'lease' | 'travel' | 'capex';
```

**The `WEEK_BOUND` additions:** `'openStation'`, `'dropStation'`, `'mothball'`, `'fleet'`, `'fleetEnd'`, `'assign'`, `'trip'`, `'check'`, `'flag'`. `setRoute` is not week-bound, like `setRates`: it applies at the next resolve.

### 2.5 UI contract: object references (`src/ui/objects.ts`, new, A)

This is the only contract B and C share: B's map emits refs and C's sheets consume them.

```ts
export type ObjectKind =
  | 'plane' | 'house' | 'grid' | 'generator' // assets (id = asset id)
  | 'hangar' | 'office' | 'runway' | 'fuel' | 'dock' | 'windsock' // fixtures (id = kind)
  | 'cart' // id = cart id (the GSE sheet, unchanged)
  | 'staff' // id = npc id
  | 'site' // id = build id, or 'project'
  | 'station' | 'route'; // region map (id = station / route id)
export type ObjectRef = { kind: ObjectKind; id: string; st: StationId };
export const OBJECT_LABEL: Record<ObjectKind, string>;
/** the seat that owns an asset's work: planes 'mech'; houses and grids 'elec'; the generator both (the one with the heavier alert weight on it now) */
export function ownerOf(s: IslandState, a: Asset): OpsRole;
```

`DockTarget` (select.ts) gains `{ desk: 'network'; plane?: string; station?: StationId; route?: RouteId }` and `{ object: ObjectRef }`. `openTarget` routes them, so C can send the analyst to D's desk without importing D.

### 2.6 Defaults for old docs

| Field | Absent means | Written when |
|---|---|---|
| `s.net` | no stations, no network planes, no trips | the first `openStation` |
| `asset.st` | home | a station's assets on opening; a network plane on delivery |
| `asset.rt` | island ops at home | `assign`, or delivery with a route |
| `asset.moved` | never moved | a base change |
| `cart.st`, `npc.st`, `cand.st`, `report.st` | home | a station's carts and staff; the hub's board and reports |
| `s.checked`, `s.flagged` | never used | the first `check` / `flag` |
| `project.st` | a tier project | `openStation` |
| `ledger.rt`, `ledger.stn` | nothing flown or open | a resolve with the network open |
| `report.costs.network`, `report.netRevenue` | 0 | a resolve with the network open |

### 2.7 Stored vs derived

| Stored (in the island doc) | Derived (code, never stored) |
|---|---|
| `s.net.stations` (id, state, weeks), `s.net.fleet` (the deals) | station definitions, route definitions, plane operating data, the layouts |
| `asset.st`, `asset.rt`, `asset.moved`; the station assets and network planes themselves (they are assets like any other) | which stations a plane is worked at, whether a tech is on site, trip prices |
| `s.net.fares`, `s.net.freq` | demand, load factor, cost per seat, revenue previews, payback, lease vs buy |
| `s.net.trips` (this week only), `s.net.commit` | "where the part is", the load gauge |
| `s.checked`, `s.flagged` (a week number each) | what a walkaround or IR scan shows (from `s.defects`, the seed and the week) |
| `ledger.rt` / `ledger.stn` (26 weeks, sparse), `report.costs.network`, `report.netRevenue` | P&L per station and route over any window, the region map's badges |
| each network plane's identity: nothing (the island seed + the asset id + model, as `islandAircraft` does today) | registration, S/N, logbooks, IPC, alteration |

### 2.8 Doc-size budget

- **Today:** a 52-week *three friends* game peaks at 114 KB (the history is 69 KB of it); *all good* peaks at 101 KB. `tests/docsize.test.ts` caps it at 150 KB.
- **The network may add at most 18 KB at week 52:**

| Item | Size |
|---|---|
| `s.net` | 0.6 KB |
| station assets | ~5 × 110 B |
| network planes | ~3 × 130 B |
| carts | 2 × 100 B |
| `ledger.rt/stn` | 26 × ~150 B = 3.9 KB |
| network review lines (at most 2 per week: one "Network:" summary line, one exception line) | 26 × 2 × 110 B = 5.7 KB |
| extra alerts and orders | about +4 KB |

- **Test:** a 52-week network-era game with the good network bot stays under 150 KB, and its network fields under 18 KB (13.1).

---

## 3. Station content

The numbers are game money, scaled like the rest of the game (a skill-3 pilot costs $320 a week today; see 17, decision 9). Names are fictional; the realism notes are in 3.7.

### 3.1 Tern Cay (`tern`, TRN): the outstation airstrip

A small neighbouring island, 38 nm from home. The company owns everything on it.

| Field | Value |
|---|---|
| kind / caps | outstation; no hangar; chargers yes (the cart charges at the fuel shed) |
| capex / overhead | $24,000; $650 a week (ground lease $200, utilities $150, property insurance $120, the station agent's retainer $180: a contractor who fuels and handles bags, not staff) |
| budget / decay / rateX | $2,500 a week; 2; 0.8 (a quieter island rents for less) |
| adds | `tern-panel` Tern Cay panel (`panel`); `tern-c1` Tern Cay Cottage A (`cottage`); `tern-c2` Tern Cay Cottage B (`cottage`) |
| gse | `tern-gpu` Tern Cay GPU cart |
| rooms / words | `['panel', 'dock']` (the dispenser circuit uses the fuel-dock symptoms); `{ 'the fuel dock': 'the fuel dispenser', 'fuel-dock': 'fuel-dispenser', 'fuel dock': 'fuel dispenser', 'the cottages': 'the Tern Cay cottages' }` |
| staff | 1 housekeeper |
| perDiem | $60 |
| the scene | a 1,900 ft strip along the lagoon, a small apron with two stands, the fuel shed with the self-serve dispenser and its emergency-shutoff post, the two cottages on the beach, a pole line from the panel, the windsock at the threshold |

**Crew project:** *Open Tern Cay*.

| Seat | Job | Puzzle |
|---|---|---|
| mech | "Tern Cay strip: the first short-field load sheet (1,900 ft at 30 °C)" | `balance` |
| elec | "Fuel dispenser feeder: RMC, a sealing fitting at the dispenser, the emergency shutoff" | `conduit` |
| fin | "Tern Cay business case: 4-week cash forecast" | `forecast` |

### 3.2 Port Adair Regional (`adair`, ADR): the mainland hub

A regional airport 110 nm from home. The company leases a hangar bay and a ticket counter. The airport authority owns the terminal, the airfield lighting and the fuel farm.

| Field | Value |
|---|---|
| kind / caps | hub; hangar yes; chargers yes; parts desk yes |
| capex / overhead | $26,000 (bay fit-out, tooling, a GPU cart, the counter); $1,700 a week (bay lease $1,200, counter $250, utilities and insurance $250) |
| budget / decay | $5,000 a week; 1 (the landlord keeps the building) |
| adds | `adair-bay` Adair hangar bay panel (`panel`) |
| gse | `adair-gpu` Adair GPU cart |
| bins | +30 |
| rooms / words | `['panel']` (no dock: the fuel farm is the airport's); `{ 'the island grid': 'the hangar bay panel', 'Island grid': 'Adair hangar bay panel' }` |
| staff | none (pilots are a network-wide pool; the hub's board adds a pilot candidate a week, 4.9) |
| perDiem | $110 (a hotel) |
| the scene | the leased bay (a bigger Hangar, reused), a ramp with three stands, the gate building (the authority's, drawn in grey: not ours), the parts-desk door, the cart on its charger, a corner of the long runway with the authority's edge lights (drawn, never ours), the windsock |
| also | the hub's hangar reports. While Port Adair is open, a drawn mechanic report whose `job` is `hangar` or `shop` (hangar lights, compressor, battery charger, 28 V receptacle) is at the hub half the time (seeded): `report.st = 'adair'`, and the electrician needs a trip to fix it. |

**Crew project:** *Open Port Adair*.

| Seat | Job | Puzzle |
|---|---|---|
| mech | "Hangar acceptance: penetrant-check the leased jacks' lifting pads and the tow bar" | `crack` |
| elec | "Hangar bay panel: the GPU charger and 28 V circuits outside the classified areas (NEC 513)" | `panel` |
| fin | "Fit-out: three-way match the contractor's invoices" | `invoice` |

Neither station requires the other (`after` isn't needed in v1). Only one project is open at a time.

### 3.3 Routes and their money

```ts
ROUTES = {
  'home-tern':  { a: 'home',  b: 'tern',  nm: 38,  block: 0.4,  fare: 90,  demand: 24, fees: 0,  cargo: 250 },
  'home-adair': { a: 'home',  b: 'adair', nm: 110, block: 0.85, fare: 150, demand: 64, fees: 70, cargo: 550 },
  'adair-tern': { a: 'adair', b: 'tern',  nm: 125, block: 0.95, fare: 160, demand: 28, fees: 70, cargo: 300 },
};
```

**The week on a route** (`routeWeek`, resolve step 2b). A "flight" in the game is a round trip, as it is at home.

1. **Round trips:** each plane on route *r* flies `n_p = min(capOf(p) after the pilots' cap, freq_r ?? ∞)`, less 1 in a week its base changed.
2. **Seats:** `S = Σ n_p × 2 × PLANE_OPS[model].seats`.
3. **Demand:** `D = r.demand × season(W) × 1/(1 + e^((fare − 1.2 × r.fare)/(0.3 × r.fare)))`. At the reference fare that is 0.661 × `r.demand`, and fare × demand is flat from 0.9× to 1.0× the reference.
4. **Pax:** `min(S, round(D × u))`, with `u` from `rng(hashSeed(s.seed, 'route', r.id, W)).range(0.92, 1.08)`.
5. **Revenue:** `pax × fare` + (the cargo planes' round trips × `r.cargo`).
6. **Direct cost:**
   - fuel: `Σ n_p × 2 × r.block × blockX × fuelPerH` (booked `fuel`)
   - fees: round trips × `r.fees` (booked `fees`)
7. **Guests:** each guest round trip into a station other than home brings one guest party there (4.10). Route flights into home don't add home arrivals, so home stays byte-identical. Home isn't short of arrivals at tier 5 anyway: 12 arrivals for 7 houses.
8. **Pilots and staff:** the pilots' duty is the network-wide pool (`pilotCap`), with home's planes first (4.9).

**Worked numbers at tier 5** (5 round trips a plane a week; reference fares; the analyst's decision table):

| Plane on route | Seats / pax / LF | Revenue | Fuel + fees | Lease + a pilot | Contribution a week |
|---|---|---|---|---|---|
| twin, Home–Adair, 5 RT | 50 / 42 / 84% | $6,300 | $1,700 + $350 | $1,000 + $320 | **+$2,930** |
| a 2nd twin there | 100 / 42 / 42% | $6,300 | ×2 | ×2 | −$440 in all (the 2nd twin: **−$3,370**) |
| twin, Home–Tern, 5 RT | 50 / 16 / 32% | $1,440 | $800 | $1,320 | −$680 (fares only) |
| twin, Home–Tern, 3 RT | 30 / 16 / 53% | $1,440 | $480 | $1,320 | −$360 (fares only) |
| the owned float moved to Home–Tern | 40 / 16 / 40% | $1,440 | $528 | $0 (already paid) | +$912, **but its tours at home were worth ~$3,900 a week** |
| twin, Adair–Tern, 4 RT | 40 / 18 / 45% | $2,880 | $1,520 + $280 | $1,320 | **−$240** (the naive trap) |
| the owned cargo plane on Home–Adair (freight) | — | $2,750 | $1,989 + $350 | $0 | +$411 (it still lands at home daily, so home's bulk parts still ride it) |

**Per station, good play:**
- **Tern Cay with a leased twin at 3 RT:**
  - fares −$360
  - rentals: 2 cottages × 7 × $280 × 0.8 × occupancy 0.79 = +$2,480
  - housekeeper −$180
  - overhead −$650
  - **total: about +$1,290 a week.** The capex of $24,000 pays back in about 19 weeks.
- **Port Adair with one twin on the trunk:**
  - +$2,930 − $1,700 overhead = **+$1,230 a week.** The capex of $26,000 pays back in about 21 weeks.
  - Plus the parts desk: long-lead parts a week sooner (fewer AOG-boat calls and fewer AOG weeks), the heavy hangar, and the pilot base.
- **Naive play:** both stations open, the three network planes as two twins on Home–Adair and one on Home–Tern, every round trip flown, fares at 1.5×.
  - Home–Adair: at $225 demand is 17 pax for 100 seats, so $3,825 in fares against $6,740 of fuel, fees, leases and pilots, less the hub's $1,700: −$4,615.
  - Tern Cay: about +$400.
  - **In all it loses about $4,200 a week** (11.1 target T3).

### 3.4 Fleet: lease or buy

| Model | Lease a week (13-week minimum) | Buy | Resale |
|---|---|---|---|
| twin | $1,000 | $58,000 | 80% on the day, −0.5% of the price a week, floor 45% |
| float | $800 | $44,000 | same |
| cargo | $1,250 | $76,000 | same |

**The lease-vs-buy card:** twin, as the analyst sees it.

|  | 26 weeks | 52 weeks |
|---|---|---|
| lease | $26,000 | $52,000 |
| buy | $58,000 − $38,860 resale = $19,140 | $58,000 − $31,320 = $26,680 |
| cash tied up at 26%/yr (shown, never charged, as the Money tab does) | $7,540 | $15,080 |
| buy, all in | $26,680 | $41,760 |

That's near-equal at 26 weeks and buy wins at 52, **if** the cash is there. The FP&A call is the analyst's.

- **Early return:** 4 weeks of lease, before the minimum.
- **Delivery:** the plane arrives at the next week's open, at health 85, with 8 flights since its last 100-hr (the acceptance inspection is due in 4 flights: the mechanic's first job on it).
- **Fly-away kit:** the plane comes with its own spares, for its own effectivity: 1 tire and tube, 2 brake linings, and 2 oil filters for a piston (`starterItem` for its asset).
- **Its own records:** the seed, its asset id and model give it its own registration, logbooks, IPC effectivity and (half the time) an alteration, exactly as `islandAircraft` does today.
- **Two twins may take different linings:** fleet commonality becomes a real stock problem for the analyst. That's realistic, and the stock planner already shows it by P/N.
- **Name:** `${PLANE_OPS[model].word} ${reg}` with the registration's last three characters ("Twin 47K"). The IPC and logbook puzzles now take the model from `PuzzleContext.assetModel` (4.2, row 44), never from the name.

### 3.5 Opening a station

- **Available when:**
  - `s.tier ≥ 5`, and it's the week the Resort arrived + 2 or later
  - A0 holds (11.2; this is a build gate, not a runtime rule)
  - no project is open and no receivership
  - spendable cash − capex ≥ $25,000
- **Start:** `openStation`.
  - The capex is **committed** (spendable drops; the bank doesn't move yet).
  - The three project orders appear (order tier 4, one per seat, like a tier project).
- **Opens** when all three are signed off, at once (like a tier):
  - the capex is paid
  - the assets are added at `60 + 30 × the crew's mean score`
  - its carts arrive full on their charger
  - its standard staff are hired at skill 3
  - its bins are added
  - the review line: "Tern Cay is open: 2 cottages, the panel, a cart."
- **Drop:** while it's a project, the analyst can drop it (`dropStation`). The orders are cancelled and the commitment is released. That's the exit when a crewmate is away for weeks.
- **Mothball** (open ↔ mothballed; the analyst):
  - overhead × 0.3
  - its houses closed, its routes not flown, no trips there
  - its assets decay at the station's rate
  - reopening is free the next week

### 3.6 What each station adds for each trade

| Trade | Tern Cay | Port Adair |
|---|---|---|
| Mechanic | planes on Home–Tern are worked at home; a Tern-based plane, or one AOG there, needs a trip, with the part drop-shipped; no hangar, so HEAVY work waits for home or Adair unless the plane is AOG; its cart | the hangar for HEAVY work on Adair-based planes (a trip); its cart; the parts desk (long leads a week sooner); a plane AOG at Adair |
| Electrician | the service panel (feeder, dead circuit, utility sag, load trend: the `panel` symptoms); the dispenser circuit (the dock take-off and trip symptoms, as the fuel dispenser); two cottages (every house symptom); the cart charger outlet | the bay panel (the `panel` symptoms, no dock); the hub's hangar reports (lights, compressor, battery charger GFCI, 28 V receptacle) half the time; the GPU charger circuit |
| Analyst | the opening decision; which plane serves it (a leased twin, or moving the float and losing its tours); fare and round trips on a thin route; the housekeeper; mothball if it doesn't pay | the trunk's fare and capacity; lease vs buy; the second-plane trap; the Adair–Tern trap; pilots from the hub's board |
| All three | the crew project (a job each); the network's cross-trade reports; *Report a problem* on its objects | the same |

### 3.7 Realism notes (for the critics)

- **NEC 513, aircraft hangars:**
  - Classified areas: below the floor is Class I Div 1. The hangar floor up to 18 in is Div 2, and so is within 5 ft of engines and fuel tanks, up to 5 ft above the wings (513.3).
  - Battery chargers are not in a classified location (513.10(B)).
  - Energizers (a GPU) have fixed parts at least 18 in above the floor and extra-hard-usage cords with an EGC (513.10(C)).
  - GFCI for the receptacles (513.12, pointing to 210.8).
  - The bay panel project and the charger circuit use these words.
- **NEC 514, fuel dispensing:**
  - Div 1 inside the dispenser enclosure; Div 2 to 18 in above grade within 20 ft (Table 514.3(B)(1)).
  - A listed seal in each conduit entering the dispenser (514.9).
  - A remote disconnect of every conductor, the grounded one included (514.11(A)), and an emergency shutoff 20–100 ft away (514.11(B)).
  - RMC or IMC underground, or PVC with RMC at the last 2 ft (514.8).
  - Aircraft fuel servicing itself is NFPA 407. The dispenser's wiring follows the NEC's rules for fuel dispensing. The Tern project and the dispenser alerts say so.
- **No airfield series lighting:** Port Adair's lights are the authority's. The home strip's edge lights (tier 5) stay status-only on the island grid.
- **The mechanic:**
  - Line maintenance at an outstation is normal Part 135 practice. HEAVY work at a maintenance base is company policy (the GMM), not an FAR, and it says so on the card.
  - A plane AOG at an outstation gets a field repair (the mechanic and the part fly there), as real operators do.
  - An acceptance inspection and records review on a leased plane is normal. Here it is the 100-hr due in 4 flights, with the plane's own logbooks for the part chain.
- **The analyst:**
  - load factor, cost per seat, contribution per route and station, capex payback
  - lease vs buy with resale and the cost of capital
  - dry leases with a minimum term and a return fee
  - landing fees at the hub, none at our own strips

---

## 4. How each existing system generalizes

### 4.1 The table

| System | Files | Change (a station lookup, otherwise unchanged) |
|---|---|---|
| Alerts | `alerts.ts` | `generateAlerts` = the **home pass** (assets with no `st`, exactly today's code and draws) + the **network pass** (assets with `st`: `NET.alerts`, its own rng stream). `nffExtras` stays home only; the network pass has its own NFF chance (`NET.alerts.nff`). `raiseAlert` reads `soleFor`. The text and short text go through `stationWords`. The site's rooms are filtered by `StationDef.rooms` (4.5). |
| The five-step job flow | `flow.ts`, `engine.ts` (`planAlert`, `complete`) | Plan anywhere (planning is paperwork). `installCheck` adds two stops. **(1)** the tech isn't on site: "Book the trip to Tern Cay ($150)". **(2)** a HEAVY kind on a plane with no hangar among its `workStations` and not AOG: "Needs a hangar: home or Port Adair". Both work like `gseForStart`'s blocker: the engine refuses `complete` with the words, and the card shows them. |
| Stock and purchasing | `stock.ts` | One central store. `etaOf` takes a week off an item's lead (never under 1) while a parts-desk station is open. POs for a station job are drop-shipped there at the normal ETA; `receive` is unchanged. `binsTotal` adds open stations' `bins`. |
| Requisitions, receiving, three-way match, payables | `stock.ts`, `ledger.ts` | unchanged |
| Puzzles | `src/puzzles/*` | unchanged. `PuzzleContext.assetModel` (new, A) replaces the name sniffing in `ipc.ts` and `logbook.ts`; `launchFor` passes it. |
| Blind sign-off, hidden defects, incidents traced to the signer | `engine.ts` | unchanged (per asset). `incidentText` goes through `stationWords`. |
| Inspections finding defects | `engine.ts` `detectDefects`, `data.ts` `INSPECTS` | unchanged. The quick checks reuse `addRepair(…, 'inspection', …)` (6.4). |
| Cross-trade reports | `engine.ts` `openReport`, `data.ts` | A hub report may carry `report.st` (3.2). Its fixer's order is a station job (it needs the trip). Effects unchanged. |
| The part chain | `chain.ts`, `engine.ts` | One open chain network-wide, as today. The lookup and research are paperwork (anywhere). The install needs the mechanic on site. Freight words: 'the AOG boat' becomes 'the AOG charter to Tern Cay'; `'flight'` rides the next route flight into the plane's base. |
| GSE carts | `econ.ts` (`gseCarts`, `cartOn`, `startCart`, `gseForStart`), `engine.ts` (`gseMove`, `chargeCarts`, `flightDayStart`, `hookForFlightDay`, `autoCart`) | Carts carry `st`. A cart hooks only to a plane whose `workStations` include the cart's station. Charging needs `powered(s, cart.st)`. The weak battery rolls network-wide, and its cart must be at that plane's base. |
| NPC staff | `staff.ts` | Pilots: one pool; `pilotSeats` serves home's guest planes, then route guest planes, then cargo. Housekeepers: `housekeepingCap(s, st)` and `reviewMult(s, booked, st)` by `npc.st`. The hiring board adds one candidate per open station (`cand.st`). Hard landings: never on a plane `soleFor` is non-empty for. |
| Finance tracking | `ledger.ts`, `engine.ts` | `book(…, { asset })` already splits by asset. The station comes from `stOf(asset)`. New `ledger.rt` / `ledger.stn` rows. New spend categories `fuel`, `fees`, `lease`, `travel`, `capex`. |
| The crew board, DMs | `engine.ts` | unchanged. *Report a problem* on a fixture is a DM (6.5). |
| Power | `econ.ts` | `grid(s, st)`, `generator(s, st)`, `powered(s, st = 'home')`. Home's are the assets with no `st` (4.4). |
| Houses and guests | `engine.ts` step 5, `econ.ts` | per station: `houseRentable` uses `powered(s, stOf(h))`. Home's booking loop is unchanged. Each open station books its own houses from its own arrivals and housekeepers (5b). |
| Flights | `engine.ts` step 2, `econ.ts` | the loop over planes is unchanged. Island-ops planes make home's guest slots and tours as today. Route planes go to `routeWeek`. `capFleet` puts home first. |
| Grade | `engine.ts` step 13 | budget += open stations' budgets. `revenue` includes `netRevenue`. Flights and safety count the whole fleet. |
| Crew projects | `engine.ts` `startProject` / `finishProjectIfDone` | `project.st` opens a station instead of a tier. The same one-job-per-seat rule, the same quality formula. |
| Autopilot | `engine.ts` `autoRun` | techs book a trip for urgent station work (12.2); the analyst never makes network decisions |
| Whose move, the Dock, End-turn checks | `select.ts` | station words; "Trip to Tern Cay booked: 2 jobs there"; a network card waiting is the analyst's move |

### 4.2 Every single-island assumption in the code, and what it becomes

Found by grep on `1f92356` (`soleGuest`, `grid(s)`, `generator(s)`, `powered(s)`, `houses(s)`, `planes(s)`, `hasCargo`, hard-coded asset ids, `POS`, `focusBox`, "only guest plane").

| # | Where | Assumes | Becomes |
|---|---|---|---|
| 1 | `econ.ts` `grid`, `generator` | the first grid / generator asset | `(s, st = 'home')`: the one at that station (home: no `st`) |
| 2 | `econ.ts` `powered` | one grid | `powered(s, st = 'home')` |
| 3 | `econ.ts` `houseRentable`, `houseBlocker` | one power state | `powered(s, stOf(h))` |
| 4 | `econ.ts` `passengerFlights`, `flightsAvailable`, `housesRentable` | one island | home-only by default; `netFlights(s)` for the network |
| 5 | `econ.ts` `capFleet` | one fleet | home planes first (today's order), then route guest planes, then cargo; identical without network planes |
| 6 | `econ.ts` `projectWeek` | one island | home only (the desk's pricing preview); `projectNet(s, overrides)` in `network.ts` for the network |
| 7 | `econ.ts` `downtimeOf` | a plane's lost guests and tours | a route plane: its route contribution for the week; home planes unchanged |
| 8 | `econ.ts` `alertAog`, `restrictedBy` | `soleGuest` | `soleFor(s, planeId).length > 0` (4.3; with `gaps`' grounded + sub-charter) |
| 9 | `econ.ts` `gseCarts` | `GSE.carts` by tier | + open stations' `gse` (with `st`) |
| 10 | `econ.ts` `cartOn`, `startCart`, `gseForStart` | any cart for any plane | only carts at one of the plane's `workStations` |
| 11 | `econ.ts` `fixedNow` | tier overhead + payroll | + open stations' overhead (× mothball) + leases (0 without a network) |
| 12 | `econ.ts` `orderTier` | the island tier | unchanged: station jobs play at the island's tier |
| 13 | `alerts.ts` `soleGuest` | "the island's only non-cargo plane" | `soleFor(s, planeId): StationId[]`, the stations for which it is the only guest plane; `soleGuest = soleFor(…).length > 0` keeps its callers |
| 14 | `alerts.ts` `generateAlerts` | every asset in one pass | the home pass (no `st`), then the network pass (4.5) |
| 15 | `alerts.ts` `nffExtras` | all assets | home assets only; the network pass has its own |
| 16 | `alerts.ts` `vars().leg` | "the villas" / "the cottages" | `stationWords` |
| 17 | `alerts.ts` `siteOf` rooms | every room a symptom allows | for a station's panel, filtered by `StationDef.rooms` (Adair: no dock: the fuel farm is the airport's) |
| 18 | `engine.ts` `soleGuestPlane` (the chain's roll) | the only guest plane | `soleFor` |
| 19 | `engine.ts` `hasCargo` | any cargo plane on the island | a cargo plane on island ops or on a route through home |
| 20 | `engine.ts` step 2, `guestSlots` / `passenger` / `cargoFlights` | every plane serves home | island-ops planes only; route planes → `routeWeek` |
| 21 | `engine.ts` step 3, `receive` carriers | home's guest and cargo flights | + route flights through home (only when there are any) |
| 22 | `engine.ts` step 4, `powered` / `grid` | one grid | per station; the lines name the station |
| 23 | `engine.ts` step 5, `houses(s)`, `td.ferry`, `housekeepingCap` | one island | home as today; then each open station |
| 24 | `engine.ts` step 6, the charter | the island's guest planes | island-ops planes only (unchanged) |
| 25 | `engine.ts` step 9, decay | `ECON.decay` everywhere | home assets `ECON.decay`; a station's assets its `decay`; network planes `NET.planeDecay` |
| 26 | `engine.ts` `complete`, the grid-down hangar cap | one grid | the job's station's power |
| 27 | `engine.ts` `rollWeakBattery` | home planes | every flying plane (its draw unchanged when there are no network planes) |
| 28 | `engine.ts` `startProject` / `finishProjectIfDone` | projects bring tiers | `project.st` |
| 29 | `engine.ts` `addTierAssets` | home tier assets | unchanged (never gets `st`) |
| 30 | `engine.ts` resolve step 11, cash | one island's costs | + `network` costs (overhead, leases, fuel, fees); capex at opening; trips at booking |
| 31 | `stock.ts` `etaOf` | lead + supplier's lead | − 1 week while a parts-desk station is open (never under 1) |
| 32 | `stock.ts` `binsTotal` | the tier's bins | + open stations' `bins` |
| 33 | `staff.ts` `pilotSeats`, `charterMult` | the island's planes | home's first, then route planes; `charterMult` home only |
| 34 | `staff.ts` `housekeepingCap`, `reviewMult` | one island | `(s, st = 'home')` by `npc.st` |
| 35 | `staff.ts` `boardNeeds`, `capacityLost`, `staffEffect` | one island | per station ("Tern Cay's 2 cottages have no housekeeper") |
| 36 | `staff.ts` `staffAfterFlights` | `soleGuest` | `soleFor` |
| 37 | `staff.ts` `COTTAGE_PLOTS` (h8, h9) | home's grove | unchanged (home only; no builds at stations in v1) |
| 38 | `chain.ts` `islandAircraft` LRU of 12 | 3 planes | unchanged (at most 6 planes) |
| 39 | `data.ts` `TIERS[].adds` ids p1–p3, h1–h7, g1, gen | home ids | unchanged; station ids are prefixed by station and network planes are `f<n>`, so they never collide |
| 40 | `data.ts` `GSE.carts` gpu1 / gpu2 | home carts | unchanged; stations add theirs |
| 41 | `data.ts` `STARTER` plane lines by model | "the island's airplane of that model" | unchanged (tier-ups only, home); a fly-away kit uses `starterItem` for the new asset |
| 42 | `data.ts` `REPORTS` hangar rows | the home hangar | may be drawn at the hub (`report.st`) |
| 43 | `growth.ts` `developmentOf` | the island | home only (flourishes are the home scene's) |
| 44 | `puzzles/ipc.ts` `ASSET_OF`, `modelFromName`; `puzzles/logbook.ts` `ASSET_OF`, `modelFrom`, `OTHER` | model ↔ p1/p2/p3 by name | `ctx.assetModel` first, then today's fallbacks (the lab keeps working) |
| 45 | `ui/island.tsx` `POS`, `AOG_SPOT`, `PLANE_ROT`, `PLANE_SIZE` by id; `p.id === 'p1'` (the hangar door); `float = planes.find(model === 'float')`; `at('g1')`, `at('gen')` | three planes with fixed spots; one grid | the home layout's stands for network planes based at home (`LAYOUTS.home.stands`); "a plane on jacks by the hangar" for the door; floats after the first moor on `LAYOUTS.home.stands`' water spots; home's grid and generator by kind |
| 46 | `ui/island.tsx` `planes`, `houses`, `grid`, `gen` from all of `s.assets` | one island | the scene's station's assets (home: no `st`) |
| 47 | `ui/island.tsx` `POLES`, `SPANS`, `FEED` | home's wiring | unchanged for home; a station's `poles` in its layout |
| 48 | `ui/island/geo.tsx` `focusBox(role, tier)`, `zoomOf`, `viewOf` | one zoom state | the camera's "my zone" preset for home; each layout's `focus` for stations; `zoomOf` stays for the lab and old callers |
| 49 | `ui/island/gse.tsx` `CART_HOME`, `CART_OUTLET` | home spots | home's; station carts from `layout.carts` |
| 50 | `ui/home.tsx` `<Island focus onTap onCart>` and the "tap to zoom to your zone" hint | one scene, one toggle | `<MapView>` (5), `onObject` → the inspect sheet (6) |
| 51 | `ui/select.ts` `blocks` (passenger cap, "grid down: hangar tools offline", "no rentable houses") | one island | station words ("Tern Cay panel down: 2 cottages dark") |
| 52 | `ui/select.ts` `teamNumbers` (`flightsMax = planes × per`, `housesMax`) | one island | home numbers, plus a network strip at tier 5 |
| 53 | `ui/select.ts` `soleGuest` uses (restricted words) | the only guest plane | `soleFor` with the station name |
| 54 | `ui/ops.tsx` "Hangar + airstrip", "Cottages + grid", `AssetChips` | one island | grouped by station (home first), each station's header with its trip chip |
| 55 | `ui/gse.tsx` `powered(s).on` (hangar power), the cart list | one hangar | grouped by station; each cart's charger power by its station |
| 56 | `ui/purchasing/model.ts` `soleGuest` (the card's "flies restricted") | the only guest plane | `soleFor` |
| 57 | `ui/flow/Investigate.tsx` the MEL words | the only guest plane | `gaps` fixes the words; A adds the station ("the only guest plane to Tern Cay") |
| 58 | `ui/island.tsx` `describe()` | the island | the scene's station |
| 59 | `islandlab.tsx` hard-coded ids | the lab | unchanged; new station and region scenes (5.7) |

### 4.3 The only guest plane, per station

```ts
/** the stations whose guests this plane alone brings: home's island-ops guest planes (non-cargo, no rt), and, for a station with houses, the guest planes on routes into it */
export function soleFor(s, planeId: string): StationId[];
```

- **For home:** the rule reads as today (`soleGuest`), so it's byte-identical without a network.
- **With `gaps`:** a sole guest plane past its MEL due is grounded, and a mainland sub-charter flies the guests. A generalizes `gaps`' sub-charter to take the station: `subCharter(s, st)`, at a price by the station's route distance. A plane sole for two stations charters for both.
- **Assigning away home's last guest plane is refused:** "Home needs a guest plane: lease one first." That's a no-gridlock guard. Tours are home's revenue, and the analyst must replace the plane before moving it.

### 4.4 Power per station

- Tern Cay's panel is its grid. There's no generator: a Tern panel under 40 means its cottages are dark and its cart doesn't charge.
- Adair's bay panel down means the Adair cart doesn't charge, and there's one hangar job at Adair that week (the grid-down cap, per station).
- A station's power never touches home's. The review says "Tern Cay panel down (reliability 34): the Tern Cay cottages dark."

### 4.5 Alerts: the home pass, the network pass, the load cap

- **The home pass** is today's `generateAlerts` body over `s.assets.filter(a => !isNet(a))`, the home orders and home alerts. It keeps the week's `r`, so its draws are identical.
- **The network pass** runs after it, only when a network asset exists. It uses `rng(hashSeed(s.seed, 'net-alerts', W))`, per trade:
  - `open` = the trade's open alerts and workable orders on network assets
  - must-do candidates (weight ≥ 100: a 100-hr due, an asset under 45) are raised first, while must-do open < `NET.alerts.mustDo` (3)
  - then, while `open < NET.alerts.target` (2): at most `NET.alerts.perWeek` (1) routine alert, drawn with today's weights × `(1 + (100 − health)/40)`
  - a station's cause rooms are filtered by `StationDef.rooms`
  - then the network NFF extra at `NET.alerts.nff` (0.15)
- **The load this adds**, derived and shown on the gauge (9.3):
  - a network plane: about 0.8–1.0 mechanic jobs a week (its 100-hr every ~2.5 weeks at 5 round trips, and wear)
  - a station's fixed assets: about 0.3–0.5 electrician jobs a week (decay 2)
  - the cap keeps routine network work at 1 a week per trade; safety work isn't capped below 3 open
  - with the v1 maximum (3 network planes, 2 stations), the network adds at most ~1.3 mechanic jobs and ~1.0 electrician job a week (11.1 target T5)
- **Flagged and written-up alerts** count as open in whichever pass their asset is in, so a flag redirects work rather than adding it (6.5).

### 4.6 Where the work is: trips

- **When a trip is needed:** a job, check or install on an asset is possible when the tech is on site at one of its work stations (`workStations`).
  - A fixed asset's work station is its station.
  - A plane's are its base and, while it flies a route, both ends of the route. It lands at both every day.
  - An AOG plane's is its base only.
  - So: planes on a route through home never need a trip, and the analyst can base every network plane at home. Trips are for station buildings, hub reports, Adair–Tern planes, and outstation AOGs.
- **Trip:** `{ t: 'trip', role, st }`.
  - one a week per tech (`NET.tripsPerWeek`)
  - costs `tripCost` (Tern: $90 + $60 = $150; Adair: $150 + $110 = $260), paid at once, booked `travel`, and counted against the trade's work budget (`autoSpent`)
  - over the budget, it still goes through and the review tells the analyst ("trips $410 over the electrician's work budget"). A trip never waits on another seat.
  - with no plane flying a route into that station this week, it's an air taxi at 2.5× (it still goes)
- **While on the trip,** the tech can work that station and home all week (the trip is a day). It's still one outstation a week, so with two outstations the tech chooses which one gets them.
- **Nothing is stored beyond the trip.** "Where the tech is" is derived.

### 4.7 Where the part is: freight to stations

- **One central store.** A job's lines are reserved from it wherever the job is.
- **On a trip, the tech hand-carries** the job's reserved lines. That includes `bulk` ones (a wheel assembly, a case of oil, a cut length of wire: all within a seat's baggage). Building materials never go to stations in v1 (no builds there).
- **A part bought for a station job is drop-shipped to that station at the PO's normal ETA** (scheduled or AOG freight, as the card picks). Scheduled freight to an outstation adds $25 of handling to the shipment's freight.
- **"Where the part is"** is derived for the job card (D):
  - "In stores: you carry it on the trip"
  - "Drop-shipped to Tern Cay: arrives week 31"
  - "At the Adair parts desk"
- **The part chain's AOG part** for a plane AOG at an outstation: `'boat'` becomes the AOG charter to that station, at the same price. `'flight'` rides the next route flight into the plane's base.

### 4.8 GSE carts per station

- Each station with `chargers` has its carts (`cart.st`). They charge on `powered(s, cart.st)`.
- A cart hooks to a plane whose work stations include the cart's station (the engine refuses otherwise: "Tern Cay GPU cart is at Tern Cay; Twin 47K is at home").
- The mechanic's cart moves at a station need him on site there. Autopilot's cart moves do too.
- Weak battery: the plane's first start is on a cart at its base.
- The GSE sheet groups carts by station (D). Tapping a cart on any scene opens it (unchanged).

### 4.9 NPC staff per station

- **Pilots** are one pool (duty 6 flights a week each). `pilotCap` covers home's planes first.
  - A network plane needs about one more pilot (the lease card says so).
  - The hub's board adds a pilot candidate a week while Port Adair is open, with skill weights shifted up (`[10, 20, 35, 25, 10]`, **tune**). Its `cand.st` is `adair` (where they were found); pilots are hired into the pool.
- **Housekeepers** have `npc.st`.
  - Opening Tern Cay hires its standard housekeeper at skill 3 ($180).
  - The board offers housekeepers per station when `capacityLost` says a station's houses sit empty.
- **Builders:** home only in v1. They never speed up a tier or a station opening (the owner's default).
- **NPCs never do trade work.** The Tern station agent and the Adair authority are overhead, not NPCs.

### 4.10 Finance per station and per route

- **Station P&L:** its rentals, less its overhead and the parts and labour booked on its assets (`ledger.as` by asset, `stOf`). Stored per week in `ledger.stn`.
- **Route P&L:** fares + freight, less fuel and fees, then less the leases and a pilot share of the planes on it (derived: leases from `s.net.fleet`, a pilot share by flights). Stored per week in `ledger.rt`.
- **Network contribution** = Σ routes + Σ stations. Payback = the cumulative contribution since opening ÷ capex.
- **Home's P&L** is today's numbers, untouched.
- **The review:** one line "Network: 11 round trips on 2 routes, 71% full, fares $7,740, stations +$1,900, network costs $5,280." Then at most one exception line (AOG at an outstation, a station dark, a route under 40% for two weeks).

### 4.11 Whose move, the Dock, the review, the crew board

- A station project's jobs are each seat's move, like a tier project.
- A trip-blocked ready job is the tech's own move: "Book the trip to Tern Cay: 2 jobs there". Never another seat's.
- A plane AOG at an outstation, with its part drop-shipped, is nobody's move until the resolve.
- The Dock's next action includes the trip.
- End-turn checks warn "2 ready jobs at Tern Cay and no trip booked".
- The crew board is unchanged.

---

## 5. The map camera (B)

### 5.1 Two modes: the inline map and Explore

- **The inline map** (the Home screen's top card, as today):
  - Tap an object: its sheet (6).
  - Tap empty ground: toggles all ↔ my zone, as today. It fires after 250 ms so a double tap can cancel it.
  - Double-tap empty ground: zoom ×2 about that point.
  - Pinch: zoom. Once zoomed in (k > 1), one finger pans.
  - At k = 1, a one-finger vertical drag scrolls the page (`touch-action: pan-y`), so the Home screen still scrolls on a phone. At k > 1, `touch-action: none`.
  - Controls in the map's corner, each 44 px: **+**, **−**, **⌖** (reset: all), and **⤢** (Explore). A preset chip row sits under the map.
- **Explore** (⤢): the map full-screen in an `.overlay` (the ambient animation pauses under it, as for any overlay).
  - Every gesture, `touch-action: none`.
  - The presets as chips across the top; ✕ to close (Esc on desktop).
  - The same camera state as inline: closing keeps where you were.

### 5.2 Gestures, taps vs drags, desktop, keyboard

- **Pointer Events** on the map's wrapper `<div>`. A pure classifier (`gestures.ts`, testable):
  - a pointer that moves more than 8 CSS px from its down point is a drag (a mouse: 4 px)
  - two pointers are a pinch
  - up within 500 ms without a drag is a tap
  - two taps within 300 ms and 24 px are a double tap
  - a drag or pinch suppresses the click that follows it (capture-phase `click` cancel)
- **Pinch:** zoom about the two fingers' midpoint, so the point under the fingers stays under them. Pan with the midpoint.
- **Desktop:**
  - drag to pan
  - on the inline map, **Ctrl/⌘ + wheel** zooms about the cursor (a plain wheel scrolls the page; a hint "Ctrl + scroll to zoom" shows once). In Explore, a plain wheel zooms.
  - trackpad pinch (a wheel event with `ctrlKey`) zooms
  - double-click zooms ×2
- **Keyboard** (the map wrapper has `tabindex=0` and `role="application"`, with `aria-roledescription="map"` and a label):
  - arrows pan 60 map units; **+ / −** zoom ×1.5; **0** all; **M** my zone; **S** the build site; **R** the region
  - **Enter** opens *Objects on the map*: an HTML list of every hotspot in view (the keyboard and screen-reader path), each a 44 px button that opens its sheet
- **Carts** keep their own SVG buttons (focusable, Enter/Space), as today.

### 5.3 Presets

| Chip | Camera | When |
|---|---|---|
| My zone | `focusBox(role, tier)` at home (today's); a layout's `focus[role]` at a station | always |
| Build site | `gaps`' `siteBox(s)` | while a build is open at home |
| All | k = 1 (the whole scene) | always |
| Region | the region view | once a station is open, or a project is open |
| Tern Cay / Port Adair | that station's scene at k = 1 | once open (also by tapping its pin) |

The preset in use is remembered per island and seat (`localStorage`, guarded) for the next visit.

### 5.4 The region view

- **Its own small SVG** (1000 × 700, ≤ 400 nodes):
  - the sea
  - each open or project station's outline from `layout.region.shape`, and home's
  - the mainland coast strip on the west
  - the routes as arcs: dashed when not flown; the thickness by round trips a week
  - each station's 44 px pin with badges: open alerts by trade (a wrench count for the mechanic, a bolt count for the electrician); a dark-houses icon; an AOG icon; the analyst sees the station's week in dollars instead
- **Tapping a pin** opens the station sheet (D). A **Go there** button in it flies the camera there: the region's wrapper animates a scale into the pin over 350 ms, then the scene swaps to that station at k = 1. Reduced motion swaps at once.
- **A route arc tap** opens the route sheet (D).
- **Pinch out** below k = 0.9 on any scene, in the network era, swaps to the region view. Before the network, pinch-out stops at k = 1.
- **Only one detailed scene is mounted at a time:** the current station's, or the region.

### 5.5 Clamping, animation, reduced motion

- **Camera:** `Cam = { x, y, k }` in the scene's units (the view's centre, and the zoom: 1 = the whole scene).
  - `k ∈ [1, 3.2]` (the same maximum as `zoomK`; 4 in Explore on a phone).
  - The centre is clamped so the view stays inside the scene (as `viewCentre` does).
- **Preset changes** animate with today's 0.45 s ease on the wrapper's transform. Gestures turn the transition off (`.dragging`).
- **No momentum.** Reduced motion (the setting, or `prefers-reduced-motion`): presets and fly-to jump; gestures still work.
- `camForBox(focusBox(role, tier))` equals `zoomOf`'s transform for every role and tier, so today's zoomed views look the same (a test).

### 5.6 Performance: transform-only

- **During a gesture**, rAF writes `style.transform = translate3d(…) scale(…)` on the wrapper `<div>` around the `<svg>`, with `will-change: transform`. The browser moves the rasterized layer on the GPU. **No Preact render** happens per frame, and the SVG isn't repainted.
- **On gesture end**, the camera commits to state once:
  - the SVG's zoom `<g>` takes the committed transform (today's `.island-zoom`, crisp at the new scale)
  - the wrapper resets to identity in the same frame
  - bubbles re-spread for the new view (`spread(…, viewRect(cam))`)
  - the bubble scale (`1.3 / k`) and the cart and hotspot hit sizes (44 CSS px at k) update
- **Checks:**
  - the camera test counts renders during a scripted pinch: 0 renders until pointer-up, 1 after
  - a Playwright run with CDP CPU throttling at 4× (a mid phone) records frame times during a 1 s pinch and a 1 s drag on the beaten scene at 390 × 844: median ≤ 16.7 ms, p95 ≤ 33 ms
- **`useStill`** already treats pointer and wheel input as activity. Gestures keep the ambient motion awake, and it pauses 20 s after the last one.

### 5.7 Scenes from layouts, and the node budget

- **Home** keeps its bespoke drawing (`island.tsx`), refactored:
  - it takes `cam` instead of `focus`
  - it draws only home's assets (no `st`)
  - network planes based at home go on `LAYOUTS.home.stands`
- **`StationScene`** (B, `src/ui/map/scene.tsx`) draws a station from its layout, reusing the art components:
  - the terrain: the coast curve, beach, plateau, hill and palms from `flora`/`rocks`; `Terrain`'s helpers take a layout's shapes
  - the runway and apron, `Hangar` (at the hub: scale 1.25), `Cottage`, `Substation` for a panel, `Pole` lines, `Plane`, `GpuCart`, `ApronProps`, the bowser, the dispenser (a new small shape), the windsock, `NpcFigure`
  - the same bubbles and `spread`
  - the same light of the hour, and weather from the island's week
- **Budget:** every scene ≤ 1,500 SVG nodes at `islandlab.html?w=358`. The region ≤ 400. The camera and hotspots add **0 SVG nodes** (the controls are HTML, the hit-test is JS).
  - Today the beaten home scene is 1,390. `gaps`' site box may add a few. B measures a network plane on a home stand (a `Plane`, its bubble and its figure) in `home-fleet`. If two don't fit under 1,500, the extra planes at home are drawn as a parked silhouette (one path each).
  - `scripts/island-shots.mjs` checks the budget for every scene id in a list: `beaten`, `home-fleet`, `tern-busy`, `adair-busy`, `region`.
- **New lab scenes** (`islandlab.tsx`, B):
  - `home-fleet`: tier 5 with 2 network planes based at home, one on jacks
  - `tern-busy`: open; one cottage closed on a hazard, the panel at 45, a Tern-based plane AOG, the cart on charge, a trip badge
  - `adair-busy`: two based planes, one in the hangar, the cart hooked up
  - `region`: 3 stations, 3 routes (one not flown), badges
  - `tern-night`: lights, the dispenser lamp

---

## 6. Interactive objects (C)

### 6.1 The hotspot registry and hit-test (`src/ui/map/hotspots.ts`, B builds it; C consumes the refs)

```ts
export type Hotspot = { ref: ObjectRef; label: string; box: [number, number, number, number]; z: number };
export function hotspots(s: IslandState, scene: StationId | 'region', layout: SceneLayout): Hotspot[];
/** the smallest-box, highest-z hotspot containing p (map units), with every box grown to at least `min` map units (44 CSS px at the current zoom) */
export function hitTest(spots: Hotspot[], p: Pt, min: number): Hotspot | null;
```

- **Boxes:** from the same footprints `island.tsx` uses for bubbles: `FOOT.plane`, `hangar`, `office`, the houses, `g1`, `gen`, and the layouts' equivalents. Fixtures: the runway box, the bowser or dispenser, the dock head, the windsock (r = 16); staff figures' spots; build sites.
- **Priority `z`:**

| z | Object |
|---|---|
| 60 | carts (they keep their own SVG buttons; the registry lists them for the keyboard list) |
| 50 | staff |
| 40 | props (fuel, windsock, dock) |
| 30 | planes |
| 20 | buildings |
| 10 | the runway |

- A tap resolves in JS from the tap point in map units. A tap on a bubble goes to its asset.
- The inline map's empty-ground tap is the preset toggle (5.1).

### 6.2 The inspect sheet (`src/ui/inspect/InspectSheet.tsx`, C)

- **A `Sheet`** (kit.tsx), keyboard-aware, max 80% of the height on a phone.
- **The header:**
  - the object's name and station
  - one status line in the seat's words: "Flying 5 round trips · 100-hr in 3 flights"; "Rentable · inspection to week 41"
  - a health bar for assets
  - open alerts by trade (chips)
- **Then the seat's section** (6.3), then **Report a problem** (6.5).
- **One primary action per seat** at the bottom (44 px): the quick check for the techs, the object's money move for the analyst.
- **Facts come from a pure module** (`src/ui/inspect/facts.ts`, C, tested: `facts(s, ref, role) → { lines, actions }`) over A's selectors.
- **The sheet never shows hidden state** (an alert's cause, a defect). The quick check shows only what a tech would see (6.4).
- **`station` and `route` refs** go to D's sheets through A's mount (14).

### 6.3 Every object, every seat

"Read" means information; the actions are the moves the seat can make from the sheet (existing actions unless marked **new**).

| Object | Mechanic | Electrician | Analyst |
|---|---|---|---|
| **Plane** | Read: airworthiness; flying / AOG / grounded / restricted; MEL placards with their weeks; flights since the 100-hr and "next 100-hr in N flights (~W weeks)"; open alerts and squawks; *Recent on this airplane* (the last 3 tasks signed off and who); the cart on it; its base and where it can be worked. Actions: **Walkaround** (**new**, 6.4), Ground / return (`tag`), Write up (`squawk`), Ground power (the GSE sheet on this plane), an open alert (Investigate). | Read: status; an electrical check asked of him (the bench order) and where the plane is. Actions: open that check. | Read: this week's flights and revenue (tours, or its route's fares); 13 weeks of parts and labour on it (`ledger.as`); lease or owned and the weekly cost; its route's load factor and contribution; downtime cost if AOG (`downtimeOf`); the pilot flying it. Actions: **Fleet ▸** (D's desk on this plane: assign, base, return or sell), its pending card (approve), nudge an unplanned alert. |
| **Hangar** | Read: power (tools on or off); the hangar reports open (lights, compressor, battery charger, 28 V) and what they cost him; the carts on charge; the stores bins used of total; the plane inside. Actions: Ground power; open a report job's status. | Read: its circuits: the reports he has to fix, the GPU charger circuit (NEC 513: charger outside the classified area, a GFCI); hangar power. Actions: open his report job. | Read: stock value, bins, the carrying charge a week, POs in receiving, the carts' power cost. Actions: Stock ▸ (the planner). |
| **House** (cottage, villa, lodge; station cottages) | Read: booked or not, and which plane brought its guests. | Read: reliability; rentable or closed and why; inspection valid to week N; open complaints and hazards; made-safe tags; **the panel schedule** (derived from the model's rooms: "Kitchen 20 A 12 AWG, GFCI + AFCI · Bath 20 A GFCI · Bedrooms 15 A AFCI · Porch 20 A WR, in-use cover · Spa 60 A 6 AWG GFCI" where a hot tub is). Actions: **Meter check** (**new**, 6.4), Red-tag / return (`tag`), Write up (`squawk`), a hazard's alert (make safe). | Read: this week's booking; nightly × its multiple (× the station's `rateX`); occupancy; 13 weeks of revenue and repair spend; the housekeeper turning it over (skill); an extra cottage's payback (`cottagePlan`). Actions: Pricing ▸. |
| **Grid** (home substation; a station's panel) | Read: "grid down: hangar tools offline, 1 hangar job" when it is; hangar power. | Read: reliability; live or down; what it feeds (houses, hangar, office, the dock or dispenser run); the generator standing by or carrying; open alerts. Actions: **IR scan** (**new**, 6.4), Write up. | Read: rental at risk on a grid-down week (Σ its houses' week); repair spend; the utility autopay report if open. |
| **Generator** (home, tier 3+) | Read: its engine (service due, open alerts, the fan report). Actions: **Walkaround** (its mounts, fan, belts and exhaust), Write up. | Read: standing by, carrying or unreliable; the weekly test; the transfer switch as installed ("60 A on #6 THWN, backed-up load 96 A": the derived site); weeks it carried in the last 4. Actions: **IR scan** (the transfer switch), Red-tag. | Read: what it protects (the rental on a grid-down week); repair spend. |
| **Runway** (home; station strips) | Read: night flights on or off (tier 5: +1 flight a plane a week while the edge lights are lit); the strip's length at a station (Tern: 1,900 ft: the load sheet's short field). | Read: the edge lights' feed (on the island grid, status only; Port Adair's are the authority's: "not ours"). | Read: night flights' revenue. |
| **Fuel** (home bowser and fuel dock; Tern's dispenser) | Read: this week's fuel (the avgas report if open); "sumped this morning: no water" (flavour). | Read: the dock or dispenser circuit: open alerts; the disconnect and emergency shutoff (NEC 514.11); the seal at the dispenser (514.9). | Read: route fuel spend (13 weeks); the avgas price report. |
| **Office** | Read: the analyst's office; its outlets report if open. | Read: the office outlets report (his to fix). | Read: cash, runway (weeks of cash), this week's P&L. Actions: Desk ▸. |
| **Build site** | Read: the build (`BuildStatus`), the crew project at that site. | the same | the same. Actions: start a cottage (`build`), buy the next unit's materials. |
| **Staff figure** | Read: name, role, skill, this week ("flies 5 on Twin N-12"). | the same | the same, plus wage. Actions: Let go (`letGo`, with the severance), Hiring board ▸. |
| **Dock and boats** | Read: the AOG boat if it came this week (the part chain). | Read: the dock run (home fuel dock) alerts. | Read: the ferry (2 guest parties a week from tier 3), the supply boat (building materials), freight spend. |
| **Windsock** | Read: this week's weather and the flights lost to it. | Read: storm damage this week (houses −6, grid −8). | Read: insurance cover vs claims this season. |
| **GSE cart** | the GSE sheet, unchanged (moves are his) | the same, read-only, plus the cable's re-termination history | the same, read-only |
| **Station pin, route arc** (region) | D's sheets: for the techs, the station's assets and alerts, where to book the trip, and planes on the route with their condition | the same | D's: station and route P&L, fares, round trips, payback, mothball |

Every row also has **Report a problem** (6.5).

### 6.4 Quick checks

**Rules** (engine `check`, 7):
- One a week per tech (`s.checked[role] === W` blocks), on an asset the tech can check, while on site.
- The mechanic checks planes and the generator (a walkaround). The electrician checks panels and grids and the generator's transfer switch (an IR scan), or houses (a meter check).
- The check never gives a verdict (blind). What it can do is **catch a hidden defect before its due week**:
  - if the tech calls the zone the defect is in, and the tell showed, the defect becomes a repair alert via `'inspection'` (`addRepair`, `foundIn: 'walkaround' | 'IR scan' | 'meter check'`)
  - the review line then says "caught before it failed"
- Calling a zone with nothing wrong raises an NFF write-up for that trade. It closes in one tap later, so a wrong call costs a little, later.
- **Where the tell is:** a defect's zone is derived by `zoneOf(d)` from its job kind and `hashSeed(d.id, 'zone')`.
- **Whether it shows** this week: `rng(hashSeed(d.id, 'tell', W)).chance(CHECK.detect)`, **tune** 0.7. Looking again next week re-rolls it; the same week never does.
- **The scope** (what a check can see, **tune**):

| Check | Can see |
|---|---|
| walkaround | `tires`, `prop`, `wire`, `oil`, `cylinder`, `hydraulics`, `spar`, `wb` (hard-landing damage), `genService`, and the `gpu:arc` variant |
| IR scan | `xfmr`, `feeder`, `panelUp`, `transfer`, and the `elec:oversized` / `elec:undersized` flow rules |
| meter check | `meter` / `flicker` (a loose neutral), `trip` (a loose backstab), `gfci`, `wireup`, `switch3`, `storm`, and the flow rules `elec:rating` / `wh` / `bond` |

- **Out of scope** (the 100-hr, code prep and the records reviews find those): an avionics tray latch, an alternator belt, the exhaust riser behind the cowl, records findings (`ipc:*`), hot sections.

**The mechanic's walkaround** (3 looks, ≤ 5 taps):
- A plan-view outline of the plane with 6 zones:
  - twin: L main gear, R main gear, L engine, R engine, belly, wing root
  - cargo: L main, R main, prop, cowl, belly, external power receptacle
  - float: L float, R float, prop, cowl, belly, wing root
  - generator: mounts, fan, belts, exhaust
- **He taps up to 3 zones.** Each shows what he sees, from `checkView` (A, pure):
  - the tell if it showed: from `CHECK_TELLS[kind]`, e.g. tires: "black fretting dust weeping from two wheel through-bolt heads"; hydraulics: "a wet film along the caliper's lower edge"; oil: "the drain-plug safety wire slack, pulling the wrong way"; spar: "paint cracked at three root rivets, a dark streak aft of one"
  - or a benign sign from `CHECK_BENIGN[zone]`: "brake dust on the wheel face"; "a light oil mist at the breather: normal for this engine"; "exhaust staining aft of the stack"
  - or "nothing to note"
- *Recent on this airplane* is shown on the sheet, so where to look is real A&P judgment: look where someone last worked.
- Then he calls one zone (**Write it up**) or **All serviceable**.

**The electrician's IR scan** (≤ 3 taps): one look shows the whole panel.
- **The panel's breakers**, derived per asset:
  - home grid: main, the cottage feeders, the villa feeder (tier 4), dock run, hangar, office
  - Tern: main, cottages, dispenser, shed, apron lights
  - Adair: main, chargers, lights, compressor, 28 V
  - the generator: transfer switch, generator breaker
- **Each shows its temperature and its load** (amps, from the schedule):
  - normal: 28–36 °C in proportion to load
  - the benign distractor: a heavily loaded breaker, +5 to +8 °C, at 80% load
  - the tell: +12 to +35 °C **at a light load**
- **Reading ΔT against load is the trade knowledge.** A hot spot at a light load is resistance (I²R): a loose lug. NETA's criteria are printed on the screen's help: ΔT > 15 °C between similar components is a major deficiency; 4–15 °C is probable.
- He taps the breaker he'd open, then **Open it up**, or **All normal**.

**The electrician's meter check on a house** (≤ 5 taps):
- The house's circuits (from the model's rooms). He picks up to 3.
- **Each shows the voltage at a receptacle with a 12 A load on:**
  - normal: a drop of 2–4 V
  - a loose terminal or backstab: 8–12 V
  - a loose neutral: the other leg swings (120 → 104 V here, 136 V on the other)
- Then he calls one circuit or **All normal**.

**Bots and balance:**
- Bots use checks (12.1), so the paper sim prices them.
- They are available from week 1, for every island. They affect tier 1–5 play slightly, measured in 11.5.

### 6.5 Report a problem

- **On an asset another trade owns,** any seat can flag it: `flag` (**new**), one a week per seat.
  - It raises a write-up alert for the owner trade on that asset: the kind with the highest current catalog weight there, drawn as the generator would (`pairsFor`), `who` = the flagger, "Flagged by Seb: …".
  - If nothing on it is due (every weight 0), it's an NFF alert (cause −1), so flagging a healthy asset costs the owner a one-tap NFF close.
  - It counts as open in the owner's pass, so it redirects work rather than adding it.
  - The sheet shows the fixer's name: "Tell Mia about Cottage 3".
- **On a fixture** (hangar, office, runway, fuel, dock, windsock):
  - the open reports about it, with the fixer and the effect
  - a **Message <trade>** button that opens the crew board DM to that seat, prefilled "About the hangar: "
  - no engine change. A player-raised *report* would carry a cap or a leak on the reporter, so raising one on purpose would be self-harm or a fake (16).
- **On a plane or a house for the owner trade itself:** today's **Write up** (`squawk`).

---

## 7. Engine actions (A)

All network analyst actions carry no role, like `approve`, `buy`, `setRates` and `hire` today: the engine doesn't check the seat (the trust model), and the UI offers them to the analyst. Every action below except `setRoute` is in `WEEK_BOUND`.

| Action | Validation (the error text is the UI's) | Effect |
|---|---|---|
| `{ t: 'openStation', st, week }` | `STATIONS[st]`; tier ≥ 5 and `W ≥ tierReachedWeek[5] + NET.settle`; not already in `s.net.stations`; no `s.project`; `receivership === 0`; `spendable − capex ≥ NET.floor` ("That would leave $X spendable; the floor is $25,000.") | `s.net ??= { stations: [], fleet: [] }`; push `{ id: st, state: 'project', since: W }`; `commit = capex`; `s.project = { tier: s.tier, st, title, orders }` with a `project` order per seat (tier `NET.projectTier`); feed |
| `{ t: 'dropStation', st, week }` | the station is a `project` | its project orders cancelled; the entry removed; `commit` released; feed |
| `{ t: 'mothball', st, on, week }` | the station is open (on) or mothballed (off); on: no network plane based there, and no plane on a route into it ("Move Twin 47K first") | state and `since`; its houses shut (a blocker 'mothballed'); its routes not flown |
| `{ t: 'fleet', op: 'lease' \| 'buy', model, base, route?, week }` | a station is open; network planes < `NET.maxNetPlanes`; `base` home or open; `route` open, if given; spendable − (buy ? price : 4 × lease) ≥ floor; no receivership | push a `FleetEntry` (no asset yet); buy: the price leaves the bank now (`capex`); feed "arrives week W+1" |
| `{ t: 'fleetEnd', asset, week }` | a network plane; not the open chain's plane ("Finish or drop its part chain first"); not hooked to a cart (the engine unhooks it) | lease: an early fee if under the minimum; buy: the resale in; the asset removed; its open orders cancelled; its alerts closed `'dropped'`; reservations released; the entry removed |
| `{ t: 'assign', asset, route: RouteId \| null, base?, week }` | a plane; the route open, if given; home keeps at least one island-ops guest plane (4.3); one change per plane per week (`moved === W` blocks) | `rt`; `st` = base (a base change sets `moved = W`: −1 flight this week) |
| `{ t: 'setRoute', route, fare?, freq? }` | the route open; fare within 0.5–2× the reference, rounded to $5; freq 1…`flightsPerPlane`, or null for all | `s.net.fares` / `s.net.freq` |
| `{ t: 'trip', role, st, week }` | mech or elec; the turn not ended; `st` open and not home; no trip for this seat this week; cash ≥ the cost | push `{ role, st, week: W, usd }`; cash −; book `travel` (trade: role); `autoSpent[role] += usd`; feed "Mia flies to Tern Cay this week ($150)" |
| `{ t: 'check', role, assetId, zone: string \| null, week }` | mech or elec; week ≥ 1; the turn not ended; `checked[role] !== W`; the asset checkable by the seat (6.4); on site; `zone` one of `checkView`'s zones, or null | `checked[role] = W`; a defect whose zone is `zone`, in scope, tell shown → `addRepair` via `'inspection'` (removed from `s.defects`); a zone with nothing → an NFF write-up alert for the seat on that asset; null → nothing; feed (blind: "Ana walked around Twin N-12 and wrote up the L main gear") |
| `{ t: 'flag', role, assetId, week }` | week ≥ 1; the seat's turn not ended; `flagged[role] !== W`; the asset exists and isn't the seat's own trade's | `flagged[role] = W`; the owner's alert (6.5); feed |
| `hire` (today's) | `cand.st` open if set | `npc.st = cand.st` for a housekeeper |

**Changed actions:**
- `complete`: the site blocker and the HEAVY blocker (4.1); the per-station grid-down cap.
- `gse`: the cart's station vs the plane's (4.8).
- `plan`, `repick`: unchanged.
- `approve`: a station job's card gets the drop-ship words.
- `squawk` / `tag`: unchanged.

**What `resolveWeek` does with them:** 8.

---

## 8. The week, in order

Today's steps are unchanged except where marked. **Every network addition is skipped when `s.net` is absent.**

| Step | What |
|---|---|
| open | **Fleet delivery**: each entry without an asset gets its plane (`f<nextId>`; health 85; `sinceInspection` 8; `st` = base, `rt` = route; the fly-away kit into stock); **trips cleared**; alerts (the home pass as today, then the **network pass**); fin tasks; reports (a hangar row may go to the hub); the hiring board (**+1 candidate per open station**); the weak battery (network-wide) |
| 0 | blind sign-offs settle |
| 1 | autopilot (techs: **a trip for urgent station work**, 12.2) |
| 1b | standing approvals |
| 2 | flights: every plane's capacity as today; `capFleet` (home first); island-ops planes → home's guest slots and tours; **route planes → 2b** |
| **2b** | **`routeWeek`** for each open, flown route (3.3): pax, fares, freight, fuel, fees, station arrivals; `ledger.rt` |
| 3 | receiving (drop-ship to stations is only a label; stock is central) |
| 4 | power, **per station**; the carts charge on their station's power |
| 5 | houses and guests at home, as today |
| **5b** | **each open station**: its rentable houses (`powered(s, st)`), its arrivals, its housekeepers, its rentals at `rateX`; `ledger.stn` |
| 6 | charter (home only) |
| 7, 7b | deferral risk, defects (every asset) |
| 8 | carry-over |
| 9 | decay: **per asset** (home `ECON.decay`, a station's `decay`, a network plane `NET.planeDecay`); storms hit every station's houses and panels |
| 10, 10b | money hunts; reports (a hub report's lines name Port Adair) |
| 11 | cash: + `netRevenue`, − **network costs** (open stations' overhead, mothballed × 0.3, weekly leases, route fuel and fees); `report.costs.network`, `report.netRevenue` |
| 11b, 11c | replenishment; builds (home) |
| 12 | forecasts |
| 13 | grade: budget + open stations' `budget`; revenue with the network; flights and safety of the whole fleet |
| 14–18 | stats, XP, the tier-up / **station-opening** project check (`finishProjectIfDone`), stories, MVP lines |
| 19 | the ledger closes (with `rt`, `stn`) |

---

## 9. Screens, phone first, with tap counts

Shared rules: 390 × 844 first; desktop 1280 × 820 (the map left, the work right, as today); 44 px targets; one primary action per sheet; the keyboard never covers a sheet's action (kit.tsx `Sheet`).

### 9.1 The map (B)

| Flow | Taps |
|---|---|
| Zoom and pan | 0 (pinch, drag, double-tap) |
| My zone / All / Build site | 1 chip |
| Explore full-screen | 1 (⤢) |
| Region, then a station | 1 (Region) + 1 (pin) + 1 (Go there) |
| Keyboard: the object list | Tab, Enter, then arrows |

### 9.2 Objects (C)

| Flow | Taps |
|---|---|
| Open any object's sheet | 1 |
| Walkaround | 1 (Walkaround) + 1–3 (zones) + 1 (call) = 3–5 |
| IR scan | 1 (IR scan) + 1 (breaker) + 1 (Open it up / All normal) = 2–3 |
| Meter check | 1 + 1–3 + 1 = 3–5 |
| Report a problem (flag) | 1 (Report to Mia) + 1 (confirm) = 2 |
| Message a trade about a fixture | 1 → the DM composer |

### 9.3 The Network desk (D; the analyst's desk gets a **Network** tab)

- **The tab** appears at tier 5. Before that, the desk shows a locked card: "After the Resort: an airline."
- **The top strip:**
  - network contribution this week and over 8 weeks
  - load factor across routes
  - planes (flying / AOG)
  - **the load gauge per trade:** "Mechanic: 3.4 jobs/week needed · 3.1 done (4 weeks)", derived from the network pass's must-dos, the decay budget and the average gain
- **Station cards:**
  - catalog order
  - state; capex; overhead; the payback projection at today's fares with its assumptions
  - **Open** (disabled with the reason: tier, settle weeks, floor, a project open)
  - once open: an 8-week P&L sparkline, **Mothball** / **Reopen**
- **Route cards:**
  - the fare on the route's demand curve (D's own curve component, drawn like the Pricing tab's)
  - round trips a week (a stepper, 1…5)
  - planes on it; LF; cost per seat; contribution
  - a warning under 45% full for 2 weeks
- **Fleet:**
  - per plane: base, route or island ops, lease or owned, weekly cost, 8-week contribution
  - **Assign** (a sheet: route chips, base chips)
  - **Return** / **Sell** (with the fee or the resale)
  - **Lease or buy a plane**: a sheet with the model chips, the lease-vs-buy card, base and route chips, confirm

| Flow | Taps |
|---|---|
| Open a station | Network (1) → Open (1) → confirm (1) = 3 |
| Lease a plane | Network (1) → Lease or buy (1) → model (1) → base + route (2) → confirm (1) = 6 |
| Set a fare | Network (1) → route card (1) → drag → done (1) = 3 |
| Assign a plane | Network (1) → plane (1) → route chip (1) → confirm (1) = 4 |
| Mothball | Network (1) → station (1) → Mothball (1) → confirm (1) = 4 |

### 9.4 The techs' outstation screens (D)

- **The ops panel** groups the asset list by station (home first). Each station header has its trip state: "Trip: Thu (booked)" or **Book trip · $150**.
- **The job card (`JobView`):** a station line under the asset:
  - "At Tern Cay: book the trip to work here ($150 from your work budget)"
  - "Needs a hangar: home or Port Adair"
  - plus where the part is (4.7)
  - The trip button books it in 2 taps: Book → confirm.
- **`StockStep`:** "you carry it" / "drop-shipped, week 31" beside each line.
- **The GSE sheet:** carts grouped by station.
- **The station sheet** (the region pin, for the techs): its assets and their alerts, and the trip button.

### 9.5 What's new in v4 (D, `src/ui/network/WhatsNew4.tsx`)

- **A one-time sheet per island and seat on this device**, like the v3 one (`localStorage`, guarded). Three panels:
  1. **Explore the map:** pinch, drag, double-tap, presets, Explore full-screen.
  2. **Tap anything:** what your seat sees; your quick check this week (the techs); "the Network tab after the Resort" (the analyst).
  3. **The fixes in this release** (the `gaps` list, in plain words), plus "After the Resort: an airline" (at tier 5: "Open Tern Cay from the desk").
- **It opens on an island that played before v4.** New islands see it at week 1.

---

## 10. Migration and the version gate

### 10.1 Versions

- **v4 goes out with `gaps`:** ENGINE_VERSION 4, DOC_VERSION 4, rules `request.resource.data.v == 4`, one deploy of hosting and rules together.
- If `gaps` ships v4 alone first, this build is **v5**, with the same steps.

### 10.2 `migrate()`

- **Nothing for the network:** every field is lazy.
- It must stay idempotent. It must not write `s.net`, `checked` or `flagged`: the golden test (13.1) fails if it does.

### 10.3 Fixtures and skew

- **`gaps` writes fixtures from the live build** (`tests/fixtures/v3-bd1e1d2-*.json`: early, mid-week, late, a part chain, a repair; written by the base engine, never by hand, like `scripts/fixtures-v2.ts`). A extends the skew test:
  - each loads, runs every selector (with the new network selectors, which must return empty or home-only on them) and plays 10 weeks, the same in memory and through JSON
  - `s.net` stays absent
  - a v4 doc with the network open (written by A's bots: `tests/fixtures/v4-network-*.json`: a project open, Tern open with a trip booked, both open with 2 leased planes) round-trips through JSON and plays 10 weeks
  - **reverse skew:** a build at engine 3 refuses to apply any move to a doc at engine 4 ("saved by a newer version… reload"). The existing check, extended with a v4 network fixture.
- **The live probe** after the deploy: `docs/handoff/probe-gate.mts` with the old `v` 3 → `permission-denied`, and the new `v` 4 → `not-found`. It never writes a doc and deletes its anonymous user.

### 10.4 Telling the crew

- The deploy note says **close and reopen the app** (twice if the first open still served the cached copy).
- The What's new sheet (9.5) explains the map and the objects.

---

## 11. Balance plan

### 11.1 Targets

| # | Run | Target |
|---|---|---|
| T0 | standard (26 wk × 30 seeds) | three friends and all average reach tier 5 at weeks 21–23 (median), 0 weeks below $0; solo, absent and nobody stay at tier 1; the pacing guard holds; the robust sweep no worse than `gaps`' numbers |
| T1 (A0) | long (52 wk × 30 seeds, no network) | weeks 24–52: three friends and all average median 0 weeks below $0; at most 3 of 30 games ever below $0; median dead weeks (revenue < $2,000) ≤ 2 a game; tier medians as in T0 |
| T2 | network (52 wk × 30 seeds), good network bot | cash at week 52 ≥ the no-network run + $20,000 (median of paired seeds); each opened station's cumulative contribution ≥ its capex within 26 weeks of opening in ≥ 60% of the games that open it; weeks below $0 as T1 |
| T3 | network, naive bot | median cash at week 52 below the no-network run's (naive expansion loses money) |
| T4 | network, one bad call (an idle leased twin from week 30) | ≥ 29 of 30 games never below $0 in weeks 24–52 (nobody bankrupted by one bad call) |
| T5 | network, good bot | the network adds ≤ 1.3 mechanic and ≤ 1.0 electrician jobs a week (median, weeks 30–52: jobs signed off on network assets) |
| T6 | doc size | a 52-week network game < 150 KB; its network fields < 18 KB |
| T7 | quick checks on | T0 still holds; the robust tail no worse than with them off |

### 11.2 A0: a Resort that holds

- **The finding and the numbers are in 0.3.** A0 lands first in package A, on top of `gaps`.
- **Order:**
  1. **Measure `gaps` as landed on the long run.** Its staggered code notices and alert throttle aim at the tier-4 electrician overload that starts the slide.
  2. **If T1 fails, the next levers, in order.** Each is tested on the long run and the standard run. Each stays inside T0's band.
     - (a) Code inspections every 13 weeks from tier 4 (`ECON.houseInspectionWeeks`). Rental inspections are annual in real life; 8 weeks is harsh.
     - (b) `ECON.houseWear` 2 → 1 from tier 4.
     - (c) Decay 5 → 3–4 for assets at or above 70 health from tier 4. A maintained building doesn't lose 5% a week.
     - (d) An "asset under 50: +1 alert tier" softening from tier 4. It compounds the slide: harder jobs exactly when the island is failing.
     - (e) A grid-first rule: the grid under 55 is a must-do alert, and the bots and autopilot rank it first. The grid is the single point of failure.
  3. **Record the result and the chosen levers in `docs/DECISIONS.md`.** The golden digests (13.1) are recorded **after** A0, since A0 is allowed to change play from tier 4.
- **Scratch evidence:** post-tier-5 levers alone (decay 1, inspections every 13 weeks, houseWear 1) got *all average* to 1 of 10 games below $0 but *three friends* only to 4 of 10. So some of (a)–(e) must act from tier 4.

### 11.3 Network knobs

**Where they live:** `STATIONS[].capex`, `overhead`, `budget`, `decay`, `rateX`; `ROUTES[].demand`, `fare`, `block`, `fees`, `cargo`; `PLANE_OPS`; `NET` (the floor, the fare curve, the network alert pass, `planeDecay`, trips, lease terms, resale, mothball); `CHECK.detect` and the scopes.

**Tuning order:**
1. route demand and fares (T2, T3)
2. station capex and overhead (T2's payback)
3. `NET.alerts` and `planeDecay` (T5)
4. the floor and lease terms (T4)
5. `CHECK.detect` (T7)

### 11.4 The runs (`scripts/balance.ts`, A)

| Command | What it runs |
|---|---|
| `npx tsx scripts/balance.ts long` | 52 wk × 30 seeds, no network: the T1 table (weeks below $0 in weeks 24–52, dead weeks, median cash at 26/39/52, credits reached) |
| `… network` | 52 wk × 30 seeds: three friends and all average, each with no network, a good network bot, a naive one, and one bad call (T2–T5); per station: opened week, payback week, contribution; per route: LF, contribution |
| `… robust` | unchanged, plus a `long` column |
| standard | unchanged |

**Timing:** a 52-week sim runs in about 0.7 s. `network` is about 240 sims, about 3 minutes.

### 11.5 Proof that tier 1–5 pacing is untouched

1. **Engine identity:** the golden test (13.1). With the network never opened and no new actions, 26 weeks for three friends (seeds 1–3) and all average (seed 1) produce the same JSON digest as the base recorded in A1, after A0.
2. **The network can't start before tier 5 + 2 weeks.** It's validated in `openStation`, tested, and no other network action works without an open station.
3. **The quick checks are the only new mechanic before tier 5.** The standard and robust runs with the check bots on vs off are both reported. T0 must hold with them on. Expected effect: a few incidents fewer. If the medians leave 21–23, lower `CHECK.detect` or start the checks at tier 2.

---

## 12. Bots and autopilot

### 12.1 Bots (`bots.ts`, A)

- **`Bot.net?: 'good' | 'naive' | 'badcall'`** (the analyst) and **`Bot.checks?: boolean`**. `checks` defaults to true for the standard teams; false in the golden test.
- **Good network policy** (the analyst):
  - **Tern Cay:** open it at the first allowed week with spendable ≥ capex + $40,000. Lease a twin for Home–Tern, based at home. Set the round trips to the smallest that fills the station's houses (arrivals ≥ rentable houses). Set the fare at the revenue maximum of the route curve (a grid search, like `bestRates`).
  - **Port Adair:** open it when Tern Cay has had 6 weeks of positive contribution and spendable ≥ capex + $40,000. Lease a twin on Home–Adair at 5 round trips.
  - **Planes:** lease a second plane on a route only if its LF has been > 85% for 3 weeks. Never Adair–Tern unless its projected contribution is > 0 (`projectNet`). Never move the float off home unless its route contribution beats its home tours (`downtimeOf`).
  - **Staff:** hire a pilot when `capacityLost.flights > 0`, and a housekeeper for a station when its houses sit empty.
  - **Mothball** a station whose 8-week contribution averages < −$1,000; reopen when a projection says otherwise.
  - **Exits:** return a lease whose route has been under 40% LF for 4 weeks. Drop a project that has waited 4 weeks.
- **Naive:** opens every station as soon as allowed; leases network planes up to the cap (two on the trunk first); flies every round trip; fares at 1.5×; never mothballs, returns or drops.
- **Bad call:** the good policy, plus a twin leased at week 30 and never assigned.
- **Techs:**
  - **Trips:** book the week's trip to the station with the most urgent ready or due work (grounding, closing, due this week or next, a hub report), before playing. Then play as today, over home and that station's jobs.
  - **Quick checks:**
    - the mechanic walks around the plane (or generator) with his most recent sign-off in the last 3 weeks. He picks the right zone with the chance `hit(skill, tier)` (the bots stand for players who look where the last job was), and calls it if the tell shows.
    - the electrician scans the panel or house with his most recent in-scope sign-off. He reads the ΔT right by `hit`, or checks the grid if nothing was signed off.
  - **Flags:** the analyst bot flags the grid to the electrician when it's under 55 and nothing is open on it (the cross-trade play the flag exists for).

### 12.2 Autopilot for a missed seat (`engine.ts`)

- **A tech's autopilot** books a trip only for grounding, closing or due-now work at one station, the most urgent. It never makes quick checks or flags. Then it does today's two jobs at 50%, over home and that station.
- **The analyst's autopilot** makes no network decisions:
  - no opening, leasing, assigning, fares, mothballing or dropping
  - the leases and overhead are paid at the resolve anyway
  - it does keep hiring a station's standard housekeeper if one leaves (as `autoStaff` does for the standard crew)

---

## 13. Test plan

### 13.1 Package A (`tests/network.test.ts`, `stations.test.ts`, `golden.test.ts`, `check.test.ts`, the skew and docsize extensions, `whosemove`)

- **Catalog integrity:**
  - ids unique; asset ids prefixed by their station
  - routes' ends exist
  - `adds` models are in `MODELS`
  - `rooms` are valid `ElecSite` rooms
  - projects' puzzles are registered
  - `words` apply
- **Golden:** no network, no new actions → the recorded digests (11.5).
- **Opening:**
  - the validation matrix (tier, settle weeks, floor, project open, receivership, twice)
  - the project needs all three; the station opens at the sign-off that completes it
  - capex committed then paid
  - assets at 60 + 30 × quality
  - carts, staff, bins
  - `dropStation` releases the commitment
- **Fleet:**
  - lease / buy / delivery next week / the fly-away kit
  - its own aircraft identity (a registration that differs from p1's)
  - the return fee before the minimum; the resale by week
  - `maxNetPlanes`; the floor
- **Assign:**
  - home keeps a guest plane
  - an open route
  - one change a week
  - a base change costs a flight
- **Route week:**
  - a hand-computed case (twin, Home–Adair, 5 RT, reference fare: 42 pax, $6,300, fuel $1,700, fees $350)
  - freq caps round trips; LF; demand by fare
  - storms cut round trips as they cut flights
  - arrivals at Tern Cay book its cottages; no arrivals means empty cottages
  - the pilots' cap takes network planes after home's
- **Stations:**
  - power per station (a dark Tern Cay doesn't touch home)
  - housekeepers per station
  - mothball: overhead × 0.3, houses shut, routes not flown
- **The only guest plane:** `soleFor` per station; home reads as today; `gaps`' sub-charter at a station.
- **Alerts:**
  - the home pass is identical (the golden)
  - the network pass keeps ≤ 1 new routine alert a week per trade and ≤ 3 must-do open
  - the network NFF extra; `rooms` filter; station words in text and titles
- **Trips:**
  - 1 a week; the price; the work budget; the air taxi when no plane flies
  - `complete` refused off site with the words
  - on-site jobs play; carts need the tech on site
  - autopilot books for urgent work only
- **HEAVY:** refused at a station with no hangar unless AOG.
- **The parts desk:** −1 week on leads of 2+ while Port Adair is open, never under 1.
- **Checks:**
  - 1 a week; blind feed words
  - the seeded tell; a right call finds and removes the defect and raises its repair alert via inspection
  - a wrong zone raises an NFF write-up; null does nothing
  - out-of-scope defects are never found
  - on-site needed
- **Flags:**
  - 1 a week; the owner trade; counts as open
  - an NFF on a healthy asset
  - not on your own trade's asset
- **The data-only station (ZZ):**
  - a test registers `STATIONS.zz` (a panel and a cottage) and `ROUTES['home-zz']` with a helper that adds and removes catalog entries, then:
    - opens it through the real actions (the three project jobs via `complete`)
    - leases a twin on Home–ZZ based at ZZ
    - **mechanic:** an alert on the twin → plan with `stdPick` → approve → trip → complete (stock consumed, the alert closed)
    - **electrician:** an alert on ZZ's panel → the same, plus a quick check
    - **analyst:** `ledger.rt['home-zz']` and `ledger.stn.zz` exist
    - 6 weeks of bots run with no crash
  - **and a grep guard:** no station or route id literal (`'tern'`, `'adair'`, `'home-tern'`…) appears in `src/sim` outside `stations.ts`
- **No role can win alone in the network era:**
  - from a tier-5 v4 fixture, with any two seats absent for 26 weeks, no station opens
  - with only the analyst present, a project opened stays a project (and can be dropped)
  - solo teams never reach tier 5 (unchanged)
- **Skew and migration:** 10.3.
- **Doc size:** T6.
- **A 52-week season** with the network, every team: finite cash, and these invariants hold every week:
  - every network plane's `rt` is open and its `st` is home or open
  - every cart's `st` is open
  - trips are cleared weekly
  - `ledger.rt` and `stn` have 26 weeks at most
- **Whole-season files** carry `vi.setConfig({ testTimeout: 30000 })`.

### 13.2 Package B (`tests/camera.test.ts`, `hotspots.test.ts`, `scenes.test.ts`)

- **Camera math:**
  - clamps
  - `zoomAt` keeps the point under the finger
  - `camForBox(focusBox(role, tier))` equals `zoomOf` for every role and tier
  - the pinch midpoint
- **The classifier:** the tap, drag, pinch and double-tap thresholds; a drag suppresses the click.
- **The inline map:** vertical drags at k = 1 leave `touch-action: pan-y`.
- **Hotspots:**
  - every object on the beaten scene and on each station scene has one
  - every box is ≥ 44 CSS px at k = 1 and 3.2
  - carts win over the plane they're beside
  - nothing is outside the scene
- **A layout-only test scene** (ZZ) renders under the budget in minidom, and its hotspots hit-test.
- **`island-shots.mjs`:** every listed scene ≤ 1,500 (the region ≤ 400), phone and desktop.
- **The render count** during a scripted pinch: 0 until pointer-up.
- **The Playwright perf check** (5.6).

### 13.3 Package C (`tests/inspect.test.ts`)

- `facts(s, ref, role)` for every object kind × seat on tier-1, tier-5 and network fixtures: no hidden state (no alert cause, no defect text) in any line.
- Every sheet renders in minidom.
- Each action dispatches its action.
- **The walkaround:** zones from `checkView`; the 3-look limit; the call dispatches `check` with the zone.
- **The IR scan:** temperatures and loads rendered; the NETA help present.
- **The meter check:** circuits rendered.
- **Keyboard:** every sheet's actions reachable by Tab; Esc closes.

### 13.4 Package D (`tests/networkui.test.ts`)

- The desk model's payback, lease-vs-buy and route numbers equal the engine's (`projectNet`, `routeWeek` on a clone).
- The open, lease, assign, set-route, mothball and return flows dispatch the right actions, with the floor and the reasons shown when disabled.
- The job card's trip blocker books the trip.
- "Where the part is" words.
- The GSE station groups.
- What's new shows once per seat.

### 13.5 After the merge (Integrate and QA)

- **`scripts/e2e.mjs`** (phone and desktop) gains a map pass on a new island:
  - pinch, drag, double-tap, the preset chips, Explore
  - tap a plane → the sheet → a walkaround (tier 1: a plane with nothing to find: All serviceable)
  - tap the grid → an IR scan
  - the keyboard object list
- **`scripts/e2e-network.mjs`** (new, the integrator): seeds a tier-5 pass-and-play island from `tests/fixtures/v4-network-ready.json` into the local store, then:
  - the analyst opens Tern Cay
  - the three project jobs are played
  - the week resolves, and it's open
  - the analyst leases a twin and sets a fare
  - the electrician books a trip, fixes a Tern Cay alert, and scans the Tern panel
  - the region view and fly-to
  - screenshots at every step, looked at
- **`scripts/e2e-online.mjs`** with the v4 rules on the emulator (rules probes for v 3 and v 4).
- **The island lab's scenes and node counts.**
- **Scripted phone runs of every new flow**, with screenshots.

---

## 14. Work split and file ownership

**A lands first, as three commits that each pass the checks:**
- **A1, A0 and the contract:**
  - A0's levers, if `gaps` isn't enough, and the golden digests
  - `types.ts`, `stations.ts` (the catalog, `NET`, `PLANE_OPS`, `HEAVY`, the helpers), `checks.ts` (`CHECK`, zones, tells, benign signs, `checkView`, `zoneOf`)
  - `src/ui/objects.ts`, the `DockTarget` additions, the stubs and mounts
- **A2, the engine:**
  - `network.ts` (actions, `routeWeek`, the station week, `projectNet`, `soleFor`, trips, checks, flags)
  - the changes in `engine.ts`, `econ.ts`, `alerts.ts`, `stock.ts`, `staff.ts`, `ledger.ts`, `flow.ts`, `chain.ts`, `migrate.ts`
  - `puzzles/types.ts` (`assetModel`), `ipc.ts` and `logbook.ts` (read it)
  - the selectors in `select.ts`
  - the version gate with `gaps`
- **A3:** the bots, `scripts/balance.ts` (`long`, `network`), the tuning, the fixtures `v4-network-*`, and `DECISIONS.md` *Airline network → Engine and data (A)*.

**When the others start:**
- **B may start at A1** (the camera, scenes and hotspots need only the types, `objects.ts` and the catalog).
- **C and D start at A2.**
- All three merge A3 into their branches before the Integrate phase, with `git merge --no-ff`.
- **If a package needs an engine change, it doesn't make it:** it says so in its result, and the Integrate phase makes it.

| Path | Owner |
|---|---|
| `src/sim/types.ts`, `data.ts`, `engine.ts`, `econ.ts`, `alerts.ts`, `stock.ts`, `staff.ts`, `ledger.ts`, `flow.ts`, `chain.ts`, `migrate.ts`, `bots.ts`, `progression.ts`, `tasks.ts` | A |
| `src/sim/stations.ts`, `network.ts`, `checks.ts` (new) | A |
| `src/puzzles/types.ts` (`assetModel`), `src/puzzles/ipc.ts` and `logbook.ts` (read `assetModel` first; nothing else) | A |
| `src/ui/select.ts`, `src/ui/objects.ts` (new), `src/ui/useIsland.ts`, `src/net/firebase.ts`, `firestore.rules` | A |
| `src/ui/home.tsx`: `<MapView>` in place of `<Island>`, the inspect-sheet state and its `<Sheet>` (C's `<InspectSheet>` for every kind but station/route, D's `<NetObjectSheet>` for those), the `<WhatsNew4>` mount | A, and only A |
| `src/ui/desk.tsx`: the **Network** tab entry and the `<NetworkDesk>` mount, nothing else | A |
| `src/ui/ops.tsx`: `export` on `WriteUp` and `SafetyCall`, nothing else (then D owns it) | A |
| stubs that render nothing (then their owner replaces them): `src/ui/map/MapView.tsx` (the stub renders today's `<Island>` with today's toggle), `src/ui/inspect/InspectSheet.tsx`, `src/ui/network/NetworkDesk.tsx`, `NetObjectSheet.tsx`, `WhatsNew4.tsx`, `TripButton.tsx` | A writes; then B, C, D own |
| `tests/*` except the files named for B, C, D; `tests/fixtures/*`; `scripts/balance.ts` | A |
| `src/ui/map/*` (`MapView.tsx`, `camera.ts`, `gestures.ts`, `hotspots.ts`, `layouts.ts`, `region.tsx`, `scene.tsx`, `controls.tsx`, `map.css`) | B |
| `src/ui/island.tsx`, `src/ui/island/*.tsx` (geo presets, the gse spots per scene, new small shapes: dispenser, gate building, shed) | B |
| `src/islandlab.tsx`, `scripts/island-shots.mjs`, `tests/camera.test.ts`, `hotspots.test.ts`, `scenes.test.ts` | B |
| `src/ui/inspect/*` (`InspectSheet.tsx`, `facts.ts`, `plane.tsx`, `house.tsx`, `power.tsx`, `hangar.tsx`, `office.tsx`, `fixtures.tsx`, `people.tsx`, `Walkaround.tsx`, `IrScan.tsx`, `MeterCheck.tsx`, `Report.tsx`, `inspect.css`), `tests/inspect.test.ts` | C |
| `src/ui/network/*` (`NetworkDesk.tsx`, `StationCard.tsx`, `RouteCard.tsx`, `FleetSheet.tsx`, `AssignSheet.tsx`, `NetObjectSheet.tsx`, `TripButton.tsx`, `WhatsNew4.tsx`, `model.ts`, `network.css`), `tests/networkui.test.ts` | D |
| `src/ui/ops.tsx` (after A's exports: station grouping, trip chips), `src/ui/gse.tsx` (station groups), `src/ui/flow/JobView.tsx` (the station line, the trip button, where the part is), `src/ui/flow/StockStep.tsx` (the carry / drop-ship words) | D |
| `src/styles.css` | A, only for a shared token; B, C and D style in their own CSS files |
| `scripts/e2e.mjs`, `e2e-online.mjs`, `e2e-network.mjs` (new), `docs/ONBOARDING.md` (a *§12 The airline*, and the map and objects in §3) | the Integrate phase |
| `docs/DECISIONS.md` | A adds *## Airline network* with four subsections: *Engine and data (A)*, *The map (B)*, *Objects (C)*, *The network desk (D)*. Each package writes only in its own. |

**What each package uses from A:**
- **B:**
  - `ObjectRef` / `ObjectKind` / `OBJECT_LABEL` (`objects.ts`)
  - `StationId`, `STATIONS`, `stOf`, `isOpen`, `routesOpen`, `workStations` (for AOG spots)
  - `soleFor`, `powered(s, st)`, `housekeepingCap(s, st)`
  - `gaps`' `siteBox`
  - the bubbles' inputs as today
- **C:**
  - `objects.ts`, `ownerOf`
  - `checkView`, `CHECK`, and the `check` and `flag` actions
  - `onSite`, `tripOf`, `workStations`
  - the selectors `assetPnl`, `fixtureFacts`, `openAlertsOn`, `recentOn`
  - `openTarget` with `{ desk: 'network', … }`
  - `WriteUp` and `SafetyCall` from `ops.tsx`
  - the GSE sheet's `setGse` via the mount
- **D:**
  - every network action
  - `projectNet`, `routeWeek` (on a clone, for previews), `tripCost`, `leaseVsBuy`, `payback`, `loadGauge`, `whereIsPart`
  - `ledger.rt` / `stn`, `stationWords`, `soleFor`
  - the station sheet's refs

**What no package does:**
- change another package's files
- store derived data in the island doc
- add an action outside `types.ts` (A defines every action up front)
- import from another package's new folder (the only exceptions are the mounts A places, and C → `openTarget` → D)

**The workflow:** `docs/handoff/workflows/real-job-flow.js` is the model:
1. this spec, then 2 read-only critics (trade realism: an A&P/IA, a licensed electrician on NEC 513/514, an FP&A and airline-network analyst; game design: gridlock, tedium, clarity, learning curve, Goodhart, live-migration risk)
2. revise, then the owner's decisions (17)
3. build A, then B, C and D in parallel worktrees (their own ports and cache dirs)
4. integrate, then 3 reviews (trades; play and UX at 390 × 844 across all three seats plus desktop; systems, migration and balance), then fix, then QA, then the deploy checklist (`HANDOFF.md` §6.4)

---

## 15. Risks and open questions

**Risks, and what this spec does about them:**
- **The long game doesn't hold today** (0.3). A0 comes first, with its own target (T1). If A0 can't reach T1 inside T0's band, the network waits, and the owner hears it with the numbers.
- **The electrician is the game's bottleneck.** At tier 4–5 he's already over capacity in the sim. The network adds at most 1 routine job a week (the cap). His station content is bounded (Tern: 3 assets; Adair: 1 panel plus the reports). The gauge makes the load visible. If the playtest says it's still too much, the first lever is `NET.alerts.perWeek` 1 → 0 for the electrician (station assets then get only must-dos and flags).
- **Tedium.**
  - Trips are 2 taps and rare: planes through home need none.
  - Checks are optional, 3–5 taps, once a week.
  - The network desk is at most 5 taps per decision.
  - If a playtest finds trips a chore, the lever is "a trip lasts 2 weeks".
- **Gridlock.**
  - A trip never waits on another seat (it's in the work budget).
  - A station project can be dropped.
  - Home can't lose its last guest plane.
  - `gaps`' sub-charter covers a grounded sole plane.
  - Drop-shipped parts don't add a week.
- **Balance (Goodhart).** The grade's revenue budget grows with each station's `budget`. An analyst who opens stations to inflate revenue meets their costs, which aren't in the grade: watch the "A weeks" rate in the network run. If it rises while cash falls, grade on contribution instead.
- **Doc growth.** Bounded (2.8) and tested (T6).
- **Speed.**
  - One detailed scene at a time; the camera is transform-only; hit-tests are JS.
  - `routeWeek` is O(planes).
  - `projectNet` is memoized per state, like the analytics.
- **Migration.** Every field is lazy. The golden test, the skew fixtures from the live build, and a v4 network fixture cover it.
- **Merge conflicts.** One owner per file (14). A places every mount first.
- **Realism, knowingly simplified:**
  - one central store
  - no crew duty-time or timetables
  - one route per plane
  - route demand is not linked to home's guests
  - the authority's buildings are outside the game
  - fares flat per route (no fare classes)
  - prices scaled to the game's weekly economy

**Open questions for the three of you** (defaults in brackets):
1. The network opens after the Resort, and only once A0 holds. [yes]
2. One trip a week per tech, paid from the work budget. [yes; tune to 2 if it feels tight]
3. One quick check a week per tech, available from week 1. [yes; from tier 2 if it moves the pacing]
4. Buy as well as lease? [yes; the card shows both]
5. The network adds at most 1 routine job a week per trade. [yes; 0 for the electrician if the playtest says so]
6. Station names Tern Cay and Port Adair. [yes]
7. Wages: at 2.5–3× (the open call), a network plane's pilot costs $800–$960 a week.
   - The trunk twin's contribution drops from about $2,930 to $2,290–$2,450 a week.
   - Port Adair's payback stretches from about 21 weeks to 35–44.
   - Tern Cay's goes from about 19 weeks to 44–83 (its housekeeper costs more too).
   - The home overhead cut that comes with that call doesn't cover the stations, so the network would barely pay and its fares or capex would need a retune.
   - [wages as they are]

---

## 16. Changed direction, with reasons

| Direction point | What this spec does instead | Why |
|---|---|---|
| X3: "the network is the long game after tier 5" | The network is still after tier 5, but **A0 comes first** (0.3, 11.2), with its own target | In the sim, the long game after tier 5 collapses in 10 of 10 games for both target crews. Building on it would make the network look like the cause. |
| X5: "outstation work has a real cost (travel time or a slot, or ferrying the plane home)" | **One trip a week per tech, in money**, and a plane is worked at either end of its route. There is no ferry action. Heavy work goes to a hangar end of the route, or is a field repair if AOG. | A slot means nothing for a human (there is no per-turn job cap). The one-trip rule is the scarce resource: you can't be at both outstations in a week. Working a plane at either end of its route is how it really works, since it lands there every day, and it removes most of the travel. |
| X2: "per-station stock or transfers if any" | **One central store**, drop-ship to stations at the normal ETA, parts hand-carried on the trip | Per-station bins double the analyst's stock work for no new decision. The real decisions (which planes and where) are in the fleet and routes. |
| X7: "report a problem to \<trade\>" from any object, via the existing cross-trade reports | Assets: a **flag** (a write-up alert for the owner, 1 a week, counted in their slots). Fixtures: the open reports, plus a **DM**. | A report row carries a cap or a leak on the reporter. A player raising one on purpose would be self-harm, or a fake problem. The flag redirects the owner's work instead of adding it. |
| X7: quick checks "(the analyst's view)" | The analyst gets numbers and money moves on every object, and **no hidden-state check** | The analyst's hidden-state finds are already the desk puzzles (the invoice match, the bank rec, the variance hunt). A parallel check would duplicate them. |
| X6: "never breaks the existing taps (… the island tap)" | The empty-ground tap still toggles all ↔ my zone, **250 ms delayed** so a double tap can zoom instead | It keeps the habit and still gives double-tap zoom. Objects answer at once. |
| X4: the electrician's hub work "terminal service and panels, apron floodlights" | At Port Adair: **the leased hangar bay's panel, the GPU charger and 28 V circuits, the hub's hangar reports**. The terminal and the airfield lighting are the authority's. | That's realistic (an airline leases space at a regional airport), and it bounds the busiest seat's load. Tern Cay (ours) has the panel, the dispenser and the cottages. |
| X4: "a small terminal, a few guest rooms" at the outstation | Two cottages (the existing model) and a shed drawn in the scene (no asset) | Reusing `cottage` brings every house symptom, task and puzzle for free (rule 1). A terminal asset would need a new model, symptoms and tasks for little play. |

---

## 17. Decisions the owner should know about

1. **Today's game after the Resort doesn't hold, so it gets fixed first.**
   - In the paper sim, both target crews go broke between weeks 28 and 40 in 10 of 10 games. The electrician can't keep up with 7 houses, the grid and the generator; the grid rots and the island goes dark.
   - The 26-week balance run never showed it.
   - Package A starts with "A0", on top of `gaps`' robust-tail levers, and must pass a 52-week target before the network goes on top.
   - *Trade-off:* the airline ships a little later, on an island that doesn't sink.
2. **The network opens only after the Resort, as crew projects, so tiers 1–5 are untouched.**
   - Each station needs a job from each of you, plus the analyst's capex.
   - An island that never opens one plays byte-for-byte as before (a test proves it).
   - *Trade-off:* nobody sees the airline before about week 25.
3. **Your time is the scarce resource, and the analyst sizes the airline to it.**
   - The network adds at most one routine job a week per trade, plus safety work. More stations means the same jobs spread thinner, not more puzzles.
   - The analyst sees a load gauge per trade.
   - *Trade-off:* a big network runs in worse condition unless you're sharp. That's the decision, not a chore.
4. **Travel is one trip a week per tech, two taps, from your work budget, and the parts come with you.**
   - Planes on a route through home are worked at home, so trips are mainly for Tern Cay's and Port Adair's buildings and for an outstation AOG.
   - You can't be at both outstations in one week.
   - *Trade-off:* simpler than real crew logistics (no duty-time, no timetables).
5. **One stockroom for the whole airline.**
   - Parts for a station job are drop-shipped there at the normal lead time.
   - Port Adair's parts desk makes long-lead parts a week faster everywhere.
   - *Trade-off:* no per-station stock game, in exchange for no double stock work.
6. **Real money on every card, with honest traps.**
   - The first twin on the mainland trunk makes about $2,900 a week. A second one on the same route loses about $3,400 a week, and Adair–Tern loses about $240.
   - Tern Cay pays back in about 19 weeks, Port Adair in about 21.
   - Lease ($1,000 a week, 13-week minimum) vs buy ($58,000, resale 80% falling to 45%) is on the card.
   - No network spend can take spendable cash under $25,000, so one bad call can't bankrupt you.
7. **Quick checks: one a week per tech, and they test real knowledge.**
   - The mechanic's walkaround: where to look (where the last job was), and fretting dust vs brake dust.
   - The electrician's IR scan: a hot spot at a light load is a loose lug, a warm breaker at full load is normal.
   - A right call catches a hidden defect before it fails. A wrong call becomes a write-up that closes as nothing found later.
   - They're available from week 1 for everyone, measured in the balance run.
8. **"Report a problem" from any object.**
   - On a crewmate's asset, it's a write-up for them: one a week. It takes one of their job slots rather than adding one, and flagging something healthy costs them a one-tap "nothing found".
   - On a building like the hangar, it's a crew-board message.
   - *Trade-off:* you can't invent a crewmate's cross-trade report; those still come from the game.
9. **Wages interact with the airline.**
   - The route numbers assume today's wages (a pilot $320 a week).
   - If you pick ×2.5–3 wages, each network plane's pilot costs about $480–640 a week more.
   - Port Adair's payback stretches from about 21 weeks to 35–44, and Tern Cay's from about 19 to 44–83.
   - The network would then need a retune (fares, or capex).
   - The builders' default (no speed-up) also applies to opening a station.
10. **The map changes a habit.**
    - Tapping empty ground still toggles your zone, but a double tap now zooms, and objects open their own sheet.
    - The inline map keeps the page scrolling on a phone. ⤢ opens a full-screen Explore mode for free roaming, and zooming out past the island shows the region with your stations and routes.
    - *Trade-off:* one more thing to learn, covered by the What's new sheet.
