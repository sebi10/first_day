# The real job flow, the analyst's purchasing and finance tracking, and NPC staff: implementation spec

Status: spec for the build (Engine A, Tech UI B, Analyst UI C, NPC staff D). Base commit `6c0c426` (ENGINE_VERSION 2, DOC_VERSION 2).
This document is the contract between the four work packages. Where it names a type, a function, a file or a number, build that. Where it says **tune**, the number is a starting value that the balance run may move (record the final value in `docs/DECISIONS.md`, section *Real job flow*).

**Contents.** 0 What the owner asked for · 1 What each seat does now · 2 Data model · 3 Catalog content · 4 Tasks · 5 Alerts · 6 Search · 7 Engine actions · 8 The flow on orders · 9 Inventory and purchasing · 10 MEL, make safe, AOG, closed houses · 11 Wrong choices surface later · 12 The week, in order · 13 The part chain as a branch · 14 Finance tracking · 15 NPC staff · 16 Whose move it is · 17 Screens · 18 Bots and autopilot · 19 Migration and the version gate · 20 Balance plan · 21 Test plan · 22 Work split and file ownership · 23 Risks and open questions.

**Who reads what.** A: all of it. B (technicians' screens): 0, 2, 3, 4–8, 10, 11, 16, 17.1–17.2, 22. C (the analyst's desk): 0, 2, 3, 7–9, 14, 16, 17.1, 17.3, 22. D (staff): 0, 2.6, 3.4, 5.2 (`M_HARD_LANDING`, `M_TOW`), 12, 15, 16, 22.

## 0. What the owner asked for

> "for mechanics and electrician we need new level flow such that the mechanic gets alerted to potential issues with the plane, has to search (w a search bar in IPC and manual) to find the part, then he can see if this item is already in stock (if analyst has ordered it already expecting it. so we need different parts.) the electrician is much the same, so customers will flag an issue, he will find the tools see if our inventory (new feature) and if we don't hav it he'll request analyst t buy them. make each job flow like real life as described above."

> "make the analyst be able to track finances more closely too just in passing so we can plan. so i can see which parts we [move] over time quickly vs slowly etc"

> "We also need to add a couple npc to help with expansion of the island like builders and other people that aren't gonna be supplied with other people (these are on the islands payroll and we can hire more skilled for more money etc) analyst decides on hiring."

The A&P, earlier: *"When I get a task / I get a manual / I follow manual / If part is gone or missing or damaged / IPC / If part no exist / I check in previous logged items on airplane / The maintenance logs / And then get engineering approval / To put part on airplane."*

Standing asks: everyone integral, nobody gridlocked; mistakes surface later (incidents, findings), never at once; cross-trade reports use all three jobs; ground power carts stay interactive; snappy and fun on a phone and a computer.

### 0.1 The flow in one picture

```
 MECHANIC (plane)                         ELECTRICIAN (house, grid, generator)
 ────────────────                         ────────────────────────────────────
 ALERT  pilot squawk · trend · wear ·     ALERT  guest complaint · utility reading ·
        due · AD · finding · hard landing        code notice · take-off for an install
   │ Investigate (free): a finding          │ Investigate (free): readings, the circuit
   │ No fault found → close (NFF)           │ No fault found → close (NFF)
   │ MEL: placard INOP, keep flying         │ Make safe: breaker off & tagged / blank-off
   │ Ask the electrician to meter it        │
   ▼                                        ▼
 MANUAL  search the AMM task index        REFERENCE  search the code & procedure
         (chapter chips, fuzzy search)               reference (NEC articles)
   ▼                                        ▼
 PARTS   search the airplane's IPC        MATERIALS  search the supply catalog
         (P/N, effectivity, SUPSD BY);    & TOOLS    (wire by AWG, breakers, GFCI/AFCI,
         "Not in the IPC" → the part                 TR/WR, boxes, conduit, tools)
         chain's research branch
   ▼                                        ▼
 STOCK   each line: on hand / on order + ETA / none  ←── same step, same badges
   ▼  one tap: "Pull 3 · Request 1"
 CARD    the analyst approves labour + what has to be bought (vendor, freight:
         next flight or the AOG boat); small routine cards go on petty cash
   ▼
 DELIVERY at the resolve: receiving (8130-3 paperwork, P/N vs the work order),
          into stock, reserved for the job
   ▼
 JOB     the existing puzzle is the hands-on step (fed the task card and the parts)
   ▼
 SIGN-OFF consumes what was pulled. Wrong task, wrong P/N, wrong breaker or wire:
          nothing shows now; it comes back later as an incident or an inspection find.
```

The analyst sits in the middle: stocks ahead of known demand (min/max per item), approves cards and requisitions, picks vendor and freight, watches velocity, cash tied up in stock and payroll, and hires the island's NPC staff (builders, pilots, line crew, housekeeping, groundskeeper). NPCs never do mechanic, electrician or analyst work.

### 0.2 Design principles (apply everywhere)

1. **Planning is local, one write per job.** The Investigate, Manual and Parts steps are pure UI over derived data (no engine writes, no doc growth). The engine sees one `plan` action with the chosen task and pick list. A player who leaves mid-way loses nothing stored; the UI keeps the draft in `sessionStorage` per alert.
2. **The truth is in the doc, hidden by the UI.** Each alert stores its hidden cause (`kind`) like `s.defects` does today. The UI never shows it before the job is signed off. Trust model unchanged (three friends).
3. **Derive, don't store.** Items, task indexes, search indexes, IPC rows, findings, electrical site details, forecasts, velocity classes and whose-move are functions of the seed, the code and the stored state. Stored: alerts, orders, stock lines, purchase orders, requisitions, cores, EA records, the 26-week ledger, staff, candidates, builds.
4. **Same job volume, same money per job.** Alerts are drawn with today's catalog weights and slot rules, so the number of jobs per week is unchanged. A job's labour plus its standard parts equals today's card cost (plus today's kit value for jobs that needed a kit). The balance targets are unchanged.
5. **Skill 3 NPCs reproduce today.** The standard crew at each tier, at skill 3, gives exactly today's flights, bookings and storm damage; its payroll plus the tier's new overhead equals today's fixed cost. Hiring better, worse, more or fewer staff moves the numbers from there.
6. **Old islands keep playing.** Every new field is optional. `migrate()` (v2 → v3) is pure, deterministic and idempotent, and runs inside `apply()` and in the UI's read path.
7. **Teaching tiers teach, tier 3+ tests.** Tiers 0–2 suggest (keyword chips, likely tasks, "◀ this airplane", "use 066-19600 (supersedes)"). Tier 3+ shows the book as printed: both effectivities, superseded rows, the 15 A and the 20 A device side by side, no marks. Tiers 0–1 may also flag a wrong pick before commit; tier 2+ never does.
8. **No gridlock.** MEL deferral, make-safe, petty-cash auto-approval, standing approvals at the resolve, autopilot for absent seats (techs plan the obvious fix, the analyst's autopilot approves under a cap), and the AOG boat always runs.

## 1. What each seat does now

| Seat | Before | Now |
| --- | --- | --- |
| Mechanic | Tap a generated work order, play the puzzle | Alerts arrive (squawks, trends, due items). Investigate, find the task in the AMM, find the P/N in the airplane's IPC, pull from stock or requisition, MEL-defer or ground, then play the puzzle. Inspections and repairs skip the diagnosis. Load sheets, ground power starts, reports and chain paperwork keep their flow. |
| Electrician | Same | Guest complaints, utility readings, code notices and install take-offs arrive. Investigate, find the procedure and its NEC basis, pick materials and tools from the supply catalog, pull or requisition, make safe, then play the puzzle. Meters an airplane circuit when the mechanic asks. |
| Analyst | Swipe approvals on job costs, buy generic kits, desk puzzles, pricing | Swipe approvals now carry the parts to buy (vendor, freight, new or exchange); standalone requisitions (tools, stock requests); the stock planner (min/max, velocity, forecast, flags); receiving, cores, calibration; finance tracking; hiring and payroll. Desk puzzles stay, fed real items (auction lots, three-way match on real POs). |

## 2. Data model

All new state is optional on `IslandState`. Types live in `src/sim/types.ts` (package A writes all of them up front, including the NPC types package D fills in). `ItemId` is the item's P/N or catalog number, unique across the whole catalog (a test enforces it).

### 2.1 Items (derived, never stored)

```ts
// src/sim/types.ts
export type ItemId = string;
export type ItemKind = 'part' | 'consumable' | 'rotable' | 'material' | 'tool';
export type ItemTrade = 'mech' | 'elec' | 'build';
/** chapter browse in the supply catalog and the stock planner */
export type ItemCat =
  | 'wheels' | 'brakes' | 'tires' | 'prop' | 'hydraulic' | 'avionics' | 'dcpower' | 'engine' | 'ignition' | 'airframe' | 'hardware' | 'fluids' | 'generator' // mech
  | 'cable' | 'breakers' | 'devices' | 'boxes' | 'conduit' | 'connectors' | 'grounding' | 'equipment' | 'tools' // elec
  | 'framing' | 'concrete' | 'roofing' | 'openings'; // build

export interface ElecSpec {
  amps?: number; poles?: 1 | 2; awg?: number; conductors?: number;
  gfci?: boolean; afci?: boolean; df?: boolean; gfpe?: boolean;
  tr?: boolean; wr?: boolean; inUse?: boolean; single?: boolean;
  volume?: number;                                   // box, cubic inches (314.16)
  method?: 'nm' | 'uf' | 'thwn' | 'ser' | 'bare';     // wiring method (334, 340, 310, 338)
  raceway?: 'emt' | 'pvc40' | 'pvc80' | 'rmc' | 'lfnc';
  seal?: boolean;                                    // explosionproof seal fitting (501.15, 514.9)
  length?: number;                                   // ft per unit of cable/conduit
}

export interface Item {
  id: ItemId;               // = pn
  pn: string;
  nomen: string;            // as the IPC or the catalog prints it
  trade: ItemTrade;
  kind: ItemKind;
  cat: ItemCat;
  unit: 'ea' | 'use' | 'ft' | 'qt' | 'gal' | 'set' | 'lot';
  pack: number;             // units per purchase pack (a spool of safety wire is 25 uses; NM-B is a 250 ft roll)
  packName?: string;        // 'spool' | 'roll' | 'case' | 'box' | 'bag' | 'bundle' | 'pallet' | 'kit'
  price: number;            // USD per pack at island tier 1, OEM / supply-house list
  lead: number;             // weeks by scheduled freight, >= 1
  shelf?: number;           // weeks from receipt; expired lots are scrapped at the resolve
  exch?: number;            // rotable: overhauled-exchange price per unit (with an 8130-3)
  core?: number;            // rotable: core deposit per exchange unit, refunded when the core goes back
  calEvery?: number;        // tool: weeks between calibrations
  calFee?: number;          // tool: calibration service fee
  life?: number;            // tool: jobs before it wears out
  supsdBy?: { pn: string; code: 1 | 2 | 3 };  // as the IPC prints it (mech)
  models?: ('twin' | 'cargo' | 'float')[];    // mech: planes whose IPC lists it; undefined = shop-wide
  ica?: string;             // an STC / field-approval (ICA) part: the holder
  pma?: string;             // an FAA-PMA replacement: its eligibility text
  spec?: ElecSpec;          // electrical
  nec?: string[];           // NEC basis (electrical items and tools)
  tags: string[];           // search keywords and synonyms
}
```

`src/sim/items.ts` (A) exports `itemById(id)`, `ITEMS` (static shop, electrical and building items), `planeItems(model)` (built from the IPC figures of every effectivity plus the ICA and PMA rows), `priceAt(item, tier, vendor?, cond?)` and `unitPrice(...)`. Prices rise 10% per island tier above 1 (`STOCK.perTier`, the same as `CHAIN.perTier`).

### 2.2 Stock, purchase orders, requisitions, cores, EA records (stored)

```ts
export interface StockLine {
  on: number;                     // units on hand, reserved ones included
  res?: Record<string, number>;   // orderId -> units reserved for that job
  lots?: [number, number][];      // shelf-life items only: [units, week received], oldest first (FIFO)
  rop?: number;                   // reorder point: at or below it (available + on order), the resolve reorders
  max?: number;                   // order-up-to level; rop/max absent = not auto-replenished
  avg?: number;                   // moving-average unit cost, for valuation
  owe?: number;                   // exchange units received that still owe a core
  uses?: number;                  // tool: jobs left before it wears out
  cal?: number;                   // tool: calibration due at the resolve of this week
  out?: number;                   // tool: away for calibration until the resolve of this week
}

/** purchasing suppliers (not aircraft.ts VENDORS, which are the makers' CAGE codes) */
export type SupplierId = 'oem' | 'broker' | 'supply' | 'online' | 'yard' | 'barge';
export type Freight = 'sched' | 'aog';
export type BuyChoice = { vendor?: SupplierId; freight?: Freight; cond?: 'new' | 'exch' };

export interface PoLine { item: ItemId; qty: number; unit: number /* USD paid per unit */; order?: string; req?: string; cond?: 'new' | 'exch' }
export interface PurchaseOrder {
  id: string;                     // 'po12'
  week: number;                   // placed
  vendor: SupplierId;
  freight: Freight;
  eta: number;                    // the week whose resolve delivers it
  lines: PoLine[];
  cost: number;                   // lines + freight: cash paid when placed
  freightCost: number;
  by: Role | 'auto';              // 'auto': petty cash, standing approval, replenishment, autopilot
  status: 'open' | 'held' | 'received' | 'returned';
  hold?: number;                  // receiving quarantine (no 8130-3): released at this week's resolve
  got?: number;                   // week received
  notes?: string[];               // receiving: "shipped as 066-19600 (supersedes 066-19500)", "returned: …"
}

export interface Requisition {
  id: string;                     // 'rq7'
  week: number;
  role: OpsRole;                  // who asked
  item: ItemId;
  qty: number;
  order?: string;                 // the job it is for; none = a stock or tool request
  status: 'open' | 'ordered' | 'filled' | 'cancelled';
  po?: string;
  why?: string;                   // stock requests: the tech's note ("L/H tire at 2/32 on Twin N-12")
  deferredWeek?: number;
}

export interface Core { id: string; item: ItemId; week: number; due: number; value: number; status: 'owed' | 'sent' | 'credited' | 'forfeit'; sent?: number }
export interface EaRecord { assetId: string; ata: string; tag: string; pn: string; ea: string; week: number }
```

### 2.3 Alerts (stored)

```ts
export type AlertSrc =
  | 'squawk' | 'trend' | 'wear' | 'due' | 'ad' | 'finding' | 'again' | 'landing' | 'tow'   // mech
  | 'guest' | 'utility' | 'code' | 'takeoff';                                             // elec (plus 'finding', 'again')

export interface Alert {
  id: string;                     // 'a31'
  role: OpsRole;
  assetId: string;
  sym: string;                    // SYMPTOMS key (src/sim/alerts.ts); the text, the finding and the site derive from it and `seed`
  src: AlertSrc;
  week: number;                   // raised
  due: number;                    // from this week's resolve an unfixed fault bites (== week: it bites now)
  seed: number;
  kind: string;                   // HIDDEN: the catalog kind that fixes it; 'nff' = nothing is wrong; 'repair' = a defect's repair
  status: 'open' | 'job' | 'closed';
  order?: string;                 // the job planned from it
  mel?: { cat: 'B' | 'C'; until: number; by: string };        // placarded INOP under the company MEL
  safe?: { how: 'breaker' | 'blankoff'; week: number; by: string };
  bench?: { order?: string; fault: 'unit' | 'wiring'; call?: 'unit' | 'wiring'; by?: string; week?: number; again?: boolean };
  repair?: RepairInfo;            // kind 'repair': the defect and how it came to light (today's RepairInfo)
  again?: number;                 // re-raised: the week of the sign-off or NFF close that didn't fix it
  who?: string;                   // the person the text names (a hard landing's pilot, from staff)
  closed?: { week: number; how: 'fixed' | 'nff' | 'wired' | 'dropped' };
}
// the resolve's review-line writer, shared with the staff hooks (types.ts)
export type Liner = (role: ReportLine['role'], tone: ReportLine['tone'], text: string) => void;
```

Kept: open alerts, and closed ones for 2 weeks (the UI shows "closed last week"). Hard cap 40 (oldest closed dropped first).

### 2.4 The job flow on an order (stored on `Order`)

```ts
export interface JobFlow {
  alert: string;                                  // the alert it came from
  task: TaskId;                                   // the task card chosen in the Manual / Reference step
  pick: { item: ItemId; qty: number }[];          // what the tech chose
  bench: { item: ItemId; qty: number }[];         // what the task draws on its own: consumables, and tools (qty 1, not consumed)
  reqs?: string[];                                // requisitions for the shortfall
  research?: boolean;                             // the part chain's research branch holds this job (not in the IPC)
  queued?: boolean;                               // research waits for the open chain to close
  bom: number;                                    // value of pick + bench at plan time (USD)
  stop?: string;                                  // the job stopped at install: why ("P/N 066-19500 doesn't fit: …")
}
// Order gets: flow?: JobFlow
```

The stage a player sees is derived (`flowStage(s, alert)` in `src/sim/flow.ts`), never stored:

| Stage | When |
| --- | --- |
| `new` | alert open, no job |
| `bench` | waiting on the electrician's circuit check |
| `approval` | job `pending` (a card on the desk) |
| `parts` | job `waiting_part`: requisitions open or ordered, POs in transit or held |
| `research` | the part chain's research branch holds the job (or it is queued) |
| `ready` | job `ready` |
| `done` / `closed` | job signed off / alert closed |

Flags shown beside the stage: `mel` (placarded), `safe` (made safe), `aog` (the plane is grounded by it), `shut` (the house is closed by it), `due` (week).

### 2.5 Ledger (stored, bounded) and budgets

```ts
export type SpendCat = 'parts' | 'consumables' | 'rotables' | 'materials' | 'tools' | 'building' | 'freight' | 'labor' | 'carry' | 'payroll' | 'overhead' | 'cores' | 'calibration' | 'eng';
export interface WeekLedger {
  w: number;
  rev: number;                                    // revenue, net of refunds
  cash: number;                                   // cash at week end
  sp: Partial<Record<SpendCat, number>>;          // cash out by category (cores: deposits minus refunds)
  tr: Partial<Record<'mech' | 'elec' | 'build' | 'fin', number>>;  // cash out by trade
  as?: Record<string, number>;                    // parts consumed + labour, by asset (sparse)
  use?: Record<ItemId, number>;                   // units consumed (sparse: only items that moved)
  rcv?: Record<ItemId, number>;                   // units received (sparse)
  inv: number;                                    // inventory value at week end (moving-average cost)
  loss?: number;                                  // expired, scrapped, forfeited cores (value, non-cash)
  fill?: [number, number];                        // job lines filled from stock at plan / lines planned
  wait?: number;                                  // job-weeks spent waiting on parts
  cr?: number;                                    // store credit used (the POs' cash out was that much lower than `sp`)
}
// IslandState gets: ledger?: WeekLedger[]  (last 26 weeks); spendBudget?: Partial<Record<'mech'|'elec'|'build', number>>
```

### 2.6 NPC staff (stored; package D implements the behaviour)

```ts
export type NpcRole = 'pilot' | 'housekeeper' | 'builder' | 'line' | 'grounds';
export type NpcTrait = 'steady' | 'fast' | 'careful' | 'local';
export interface Npc { id: string; name: string; role: NpcRole; skill: 1 | 2 | 3 | 4 | 5; wage: number; trait?: NpcTrait; hired: number; start?: number; morale: number; notice?: number; raised?: number }
export interface Candidate { id: string; name: string; role: NpcRole; skill: 1 | 2 | 3 | 4 | 5; ask: number; trait?: NpcTrait; start: number }
export interface StaffAsk { id: number; by: OpsRole; want: NpcRole; why: string; week: number; answer?: 'hired' | 'declined' }
/** `done`: work units done (fractional); `drawn`: units whose materials have left stock; `need`: units (BUILDS, section 15.6) */
export interface Build { id: string; what: string; tier?: number; done: number; drawn?: number; need: number; started: number; finished?: number; rework?: number; idle?: number }
// IslandState gets: staff?: Npc[]; hiring?: { week: number; cands: Candidate[] }; asks?: StaffAsk[]; builds?: Build[]
```

### 2.7 New `IslandState` fields (all optional) and what old islands read

| Field | Meaning | Absent (old island) reads as |
| --- | --- | --- |
| `alerts` | open + recently closed alerts | `[]` (the next week open raises alerts) |
| `inv` | `Record<ItemId, StockLine>`, sparse | migrated: starter stock (section 19.3) |
| `pos`, `reqs`, `cores`, `eas` | open + last 2 weeks | `[]` |
| `credit` | vendor store credit, USD (migrated in-transit kits) | `0` |
| `ledger`, `spendBudget` | finance tracking | backfilled from `history` at migration |
| `staff`, `hiring`, `asks`, `builds` | NPC staff | migrated: the standard crew for the tier |
| `parts` | **removed** (was the generic kits) | converted by `migrate()`; the type becomes optional and unused |

`Order` gets `flow?`; `Defect` gets `alert?: { sym: string; kind: string; alert: string }` (a wrong-task defect remembers the fault it left) and `puzzle` widens to `PuzzleId | 'flow' | 'elec'` (rule keys like `elec:nogfci`). `WeekReport.costs` gets optional `overhead`, `payroll`, `carry`, `freight`, `labor`, `parts` (cash out that week by category; `fixed` stays = overhead + payroll so old renderers keep working). `TierDef` gets `overhead`.

### 2.8 Stored vs derived, in one table

| Stored in the island doc | Derived every read (never stored) |
| --- | --- |
| alerts (id, sym, src, week, due, seed, hidden kind, status, MEL, make-safe, bench, repair, again) | symptom text, finding text, the electrical site (room, circuit, AWG, run), MEL category, airworthiness and hazard flags, the fix tasks, alert tier, keyword chips |
| orders' `flow` (task, pick, bench, reqs, bom, stop) | flow stage, whose move, the stepper |
| stock lines (on hand, reservations, lots, ROP/max, average cost, owed cores, tool uses/cal/out) | available, on order, ETA, velocity, turns, days of supply, fast/slow/dead, ABC, forecast, flags, suggested ROP |
| POs, requisitions, cores, EA records, store credit | inventory value, cash tied up, spend by category over time (ledger + open POs) |
| ledger (26 weeks, sparse) | charts, budget vs actual |
| staff, candidates (this week), asks, builds | payroll, capacity (flights, turnovers), effects |
| — | items, IPC rows (all figures, effectivity for this airplane), AMM task index, NEC reference, supply catalog, search indexes |

Doc growth budget: a week-52 three-friends island stays under 150 KB of JSON (today about 35 KB); the new state adds at most 45 KB (test in section 21).

## 3. Catalog content

Makers, P/Ns and CAGE codes are fictional in the aircraft.ts style; specifications (MIL, MS, AN, SAE, ASTM) and NEC articles are real. Prices are USD per pack at island tier 1 (+10% per tier), chosen to be believable to each trade and tuned so that a job's labour plus its standard parts equals today's card cost (section 8.3). `rot` = rotable (new price / overhauled-exchange price + core deposit). `use` = a consumption unit for bench stock drawn in small amounts (a spool of safety wire serves 25 jobs).

### 3.1 Mechanic, per plane: the IPC, extended (A, `src/sim/aircraft.ts`)

**Hard constraint.** Every live island's airplanes are rebuilt from the seed. Do not change `aircraftOf`'s random streams, `IPC_ATAS`, `PLANT_ATAS`, `figSb` for the five existing ATAs, the SB loop, or any existing figure row. `tests/aircraft-golden.test.ts` must pass unchanged. New figures are added beside the old ones:

```ts
export type Ata2 = '79-20' | '72-30' | '74-20' | '74-10' | '57-10' | '24-40' | '78-10';
export type AnyAta = Ata | Ata2;
export const NEW_ATAS: readonly Ata2[] = ['79-20', '72-30', '74-20', '74-10', '57-10', '24-40', '78-10'];
export const ALL_ATAS: readonly AnyAta[] = [...IPC_ATAS, ...NEW_ATAS];
/** new figures: S/N effectivity only (codes A/B from a fixed breakpoint table, no SB codes), so they need no new records */
const BRK2: Record<PlaneModel, Partial<Record<Ata2, number>>> = {
  twin:  { '79-20': 600, '72-30': 450, '74-20': 1, '74-10': 820, '57-10': 700, '24-40': 1, '78-10': 380 },
  cargo: { '79-20': 400, '24-40': 1, '57-10': 500 },
  float: { '79-20': 900, '72-30': 700, '74-20': 1, '74-10': 1100, '57-10': 800, '24-40': 1, '78-10': 600 },
};
export function ipcFor(ac: Aircraft, ata: AnyAta | string): IpcFigure   // extended: new ATAs use buildFigure2(model, ata, { snB, postSb: false })
export function figuresFor(ac: Aircraft): IpcFigure[]                     // every figure this model has (5 + its new ones), for the IPC index
```

A breakpoint of `1` means one row for all S/Ns. `ataOf` accepts the new ATAs; `findPart` keeps searching `IPC_ATAS` only (the logbook puzzle depends on it). New figure numbers: `figs2` per model (twin 79-20 → Fig 31, 72-30 → 28, 74-20 → 36, 74-10 → 35, 57-10 → 4, 24-40 → 8, 78-10 → 33; cargo 79-20 → 40, 24-40 → 13, 57-10 → 6; float 79-20 → 22, 72-30 → 19, 74-20 → 27, 74-10 → 26, 57-10 → 3, 24-40 → 7, 78-10 → 24). `k` and `fam` as in `SPECS` (twin 19 / '31', cargo 22 / '28', float 12 / '18'). New makers (fictional CAGE): Brandt Aero Engines V07BA1, Sentinel Filtration V5SF21, Fairhaven Ignition V2FH60, Stallion Magnetos V3SM44.

| Figure | Row (item · P/N · nomenclature · EFF · UPA) | twin (BIO-520-MB ×2) | cargo (NT6A-114A turbine) | float (BIO-520-D) |
| --- | --- | --- | --- | --- |
| 79-20 Oil filter and drain | 2 · FILTER, OIL, SPIN-ON (V5SF21) · A / B · 1 | SF48108-1 / SF48110-1 | — | SF48103-1 / SF48105-1 |
| | 2 · ELEMENT, OIL FILTER (with O-rings) · 1 | — | NT3031-14 (A) / NT3031-16 (B) | — |
| | 3 · PLUG, DRAIN (drilled) · 1 | AN814-8DL | NT3102-4 | AN814-8DL |
| | 4 · GASKET, CRUSH · 1 | AN900-10 | MS29513-230 (O-ring) | AN900-10 |
| | -5 · DETECTOR, CHIP (not illustrated) · 1 | — | NT3021-8 | — |
| 72-30 Cylinder | 2 · CYLINDER ASSY (with piston, rings), rot · A / B · 1 | BCY520-19A / BCY520-19B | — | BCY520-12A / BCY520-12B |
| | 3 · KIT, GASKET, CYLINDER · 1 | BGS520-19 | — | BGS520-12 |
| | 4 · NUT, CYLINDER HOLD-DOWN · 8 | AN310-7 | — | AN310-7 |
| 74-20 Spark plugs | 2 · PLUG, SPARK, MASSIVE ELECTRODE (V2FH60) · 12 | FH-M37B | — | FH-M40B |
| | 2A · PLUG, SPARK, FINE WIRE · ALT FOR 2 · 12 | FH-F37B | — | FH-F40B |
| | 3 · GASKET, SPARK PLUG, 18 MM · 12 | FH-G18 | — | FH-G18 |
| | 2 · PLUG, IGNITER (turbine) · 2 | — | NT-IP-2 | — |
| 74-10 Magneto | 2 · MAGNETO, 6 CYL, IMPULSE COUPLING (V3SM44), rot · A / B · 2 | SMG-6RN-19 / SMG-6RN-19B | — | SMG-6RN-12 / SMG-6RN-12B |
| | 3 · GASKET, MAGNETO · 1 | SMG-G6 | — | SMG-G6 |
| 57-10 Wing spar lower cap | 2 · KIT, DOUBLER, SPAR CAP (SRM) · A / B · 1 | 0531571-1 / 0531571-3 | 0528571-1 / 0528571-3 | 0518571-1 / 0518571-3 |
| | 3 · RIVET, MS20470AD5-7 · AR | MS20470AD5-7 | MS20470AD5-7 | MS20470AD5-7 |
| 24-40 External power | 2 · RECEPTACLE, EXTERNAL POWER · 1 | AN2551 | AN2551 | AN2551 |
| | 3 · RELAY, EXTERNAL POWER · 1 | 0531244-1 | 0528244-1 | 0518244-1 |
| 78-10 Exhaust | 2 · RISER, EXHAUST · A / B · 6 | BEX520-19A / BEX520-19B | — | BEX520-12A / BEX520-12B |
| | 3 · GASKET, EXHAUST · 6 | BEX-G2 | — | BEX-G2 |

The twin's two engines are two jobs: every engine alert on the twin names a side (L/H or R/H), and its job covers that engine only.

**Items from the IPC** (`planeItems(model)`): every tagged row of every figure, in both S/N blocks and both SB states (a superseded or not-effective P/N is still orderable: that is the near-miss), plus the plant ICA rows (`plantRows`) and PMA P/Ns (`pmaDef`). Kinds: rotables = com radio, alternator, starter-generator, magneto, cylinder, hydraulic power pack; consumables = O-rings, gaskets, rivets, cotter pins, crush gaskets; everything else `part`. Prices by tag at tier 1 (the same across models unless noted; ICA parts ×1.35 = `CHAIN.icaMult`; PMA parts ×0.8):

| Tag / item | Pack | Price | Lead | Notes |
| --- | --- | --- | --- | --- |
| Tire (OG- / SW- alt): 6.50-10 8 ply · 8.50-10 10 ply · 5.00-5 6 ply | ea | 285 / 410 / 120 (SW- alt 250 / 360 / 105) | 1 | twin / cargo / float |
| Tube | ea | 72 / 95 / 38 | 1 | |
| Brake lining 066-k500 (D, organic) / 066-k600 (C, metallic, SUPSD code 3) | ea | 62 / 84 | 1 | UPA 2 per brake; the AMM does both mains: 4 per job |
| Lining rivet 105-00500 | bag 50 | 18 | 1 | 4 per lining |
| Brake disc 164-0k00 (A) / 164-0k50 (B) | ea | 260 / 290 | 1 | |
| Wheel assy 40-k0A / 40-k0B (halves are NP: order the assy) | ea | 1,450 / 1,520 | 2 | |
| Tie bolt 103-0k00 · tie nut 095-0k20 | ea | 9 · 6 | 1 | 6 each per wheel |
| Bearing cone 214-0k10 · cup 213-0k10 · grease seal 154-0k01 | ea | 58 · 44 · 14 | 1 | |
| Cotter pin MS24665-302 | box 100 | 14 | 1 | shop-wide consumable |
| Brake piston O-ring MS28775-227 · filter bowl O-ring MS28775-228 | bag 10 | 22 · 22 | 1 | |
| Prop bolt B-k413-1 (D) / B-k413-3 (C, SUPSD code 2) | ea | 62 | 1 | UPA 6: a set is 6 |
| Hub O-ring MS29513-238 | ea | 9 | 1 | |
| Spinner dome / bulkhead | ea | 380 / 190 | 2 | |
| Hydraulic filter element DH-k40-10 → -11 (code 1) | ea | 110 | 1 | PMA PFk40-11: 88 |
| Reservoir cap DH-k31 → -1 (code 2) | ea | 130 | 1 | |
| Hydraulic power pack DH-k02-3 / -5, rot | ea | new 3,800 / exch 1,900 + core 900 | 2 | |
| Com transceiver TR-155-01 → -02 (code 2), rot | ea | new 1,900 / exch 950 + core 500 | 1 | ICA NX-430-00: new 3,400 / exch 1,280 + core 700 |
| Mounting tray / connector kit | ea | 240 / 85 | 1 | |
| Alternator HA-24k-2 → -4 (code 2), rot | ea | new 1,450 / exch 760 + core 350 | 1 | ICA VM-70-28-k: exch 1,030 + core 450 |
| Starter-generator HSG-250-3 → -5 (code 2), rot | ea | new 3,900 / exch 1,350 + core 900 | 1 | ICA VM-SG300-k: exch 1,820 + core 1,200 |
| V-belt HA-B(k+19) / alt B(k+19)-AX · pulley nut · brush assy / set | ea | 38 / 29 · 12 · 95 / 180 | 1 | |
| Oil filter SF481xx-1 · turbine element NT3031-1x | ea | 32 · 210 | 1 | |
| Drain plug · crush gasket AN900-10 | ea · bag 25 | 18 · 15 | 1 | |
| Cylinder assy BCY520-kA/B, rot | ea | new 2,150 / exch 1,250 + core 600 | 2 | gasket kit BGS520-k: 65 |
| Spark plug FH-M37B / FH-M40B · fine wire FH-F37B / FH-F40B | ea | 34 · 78 | 1 | gasket FH-G18: bag 50, 40 |
| Magneto SMG-6RN-k / -kB, rot | ea | new 1,650 / exch 780 + core 400 | 1 | gasket 9 |
| Igniter plug NT-IP-2 (turbine) | ea | 420 | 2 | |
| Spar cap doubler kit (SRM) 05f571-1 / -3 | kit | 850 | 2 | rivets MS20470AD5-7: bag 100, 24 |
| External power receptacle AN2551 · relay | ea | 165 · 240 | 1 | |
| Exhaust riser BEX520-kA / B · gasket BEX-G2 | ea | 680 · 8 | 2 | |

### 3.2 Mechanic, shop-wide consumables and generator parts (A, `ITEMS` in `src/sim/items.ts`)

| P/N (id) | Nomenclature | Unit / pack | Price | Lead | Shelf (wk) | Used by |
| --- | --- | --- | --- | --- | --- | --- |
| MS20995C32 | Safety wire, 0.032 in, CRES (1 lb spool) | use / 25 | 28 | 1 | | prop bolts, filter bowl, drain plug, oil filter, 100-hr |
| MS20995C41 | Safety wire, 0.041 in, CRES (1 lb spool) | use / 25 | 30 | 1 | | near-miss (larger fasteners; the IPCs call .032) |
| MS24665-283 | Cotter pin, 1/16 × 3/4 in | box 100 | 12 | 1 | | near-miss for MS24665-302 |
| MIL-PRF-5606 | Hydraulic fluid, petroleum base (red), 1 qt | qt / case 12 | 216 | 1 | | brakes, power pack |
| MIL-PRF-83282 | Hydraulic fluid, synthetic hydrocarbon (red), 1 qt | qt / case 12 | 312 | 1 | | power pack where the card allows it (POST SB) |
| SAE-J1899-50 | Aviation piston oil, SAE 50, ashless dispersant (SAE J1899), 1 qt | qt / case 12 | 84 | 1 | | oil change, 100-hr (12 qt per engine) |
| MIL-PRF-23699 | Turbine oil, 5 cSt synthetic (MIL-PRF-23699), 1 qt | qt / case 12 | 264 | 1 | | cargo oil service |
| MIL-PRF-81322 | Wheel bearing grease (MIL-PRF-81322), 14 oz tube | use / 10 | 32 | 1 | | wheel and tire |
| MIL-PRF-907 | Anti-seize thread compound, high temperature (MIL-PRF-907), 1 lb | use / 20 | 65 | 1 | | POST SB prop bolts, spark plugs |
| MIL-PRF-81733 | Sealant, corrosion inhibiting, Type IV (MIL-PRF-81733), 2.5 oz semkit | use / 1 | 48 | 1 | **26** | spar doubler, wheel-half repair |
| MIL-PRF-23377 | Primer, epoxy, corrosion inhibiting (MIL-PRF-23377), 1 qt kit | use / 4 | 85 | 1 | **26** | corrosion, spar |
| MIL-DTL-5541 | Chemical conversion coating, Type I Class 1A, 1 qt | use / 10 | 42 | 1 | **52** | wheel-half penetrant check |
| E1417-KIT | Penetrant kit, ASTM E1417 Type II Method C (cleaner, penetrant, developer) | use / 3 | 95 | 1 | **104** | wheel-half check, spar inspection |
| CW-5 | Compressor wash concentrate (desalination), 1 gal | use / 2 | 58 | 1 | | turbine hot-section job |
| HPS-OF-60 · HPS-FF-60 · HPS-FB-60 · HPS-ISO-4 | Standby generator (Harborline 60 kW diesel): oil filter · fuel filter · fan belt · mount isolator | ea | 22 · 26 · 35 · 48 | 1 | | generator service |
| API-CK4-15W40 · ELC-5050 | Diesel engine oil 15W-40 (API CK-4), 1 gal · coolant, extended life 50/50, 1 gal | gal / case 4 | 112 · 96 | 1 | | generator service |

Bench stock (safety wire, cotter pins, O-rings, gaskets, grease, anti-seize) is drawn by the task on its own (section 4.3): the mechanic never searches for it, the analyst keeps it stocked, and it shows in velocity like any other item.

### 3.3 Electrician: materials and tools with the NEC basis (A, `ITEMS`)

Fictional brand "Keystone" for devices and the island panels' breakers (breakers must be listed for the panel they go in, NEC 110.3(B): the island's panels take KP breakers only). Wire and conduit are generic. `spec` carries the fields the pick judge reads (section 11.3).

**Cable and wire**

| id | Item | Pack | Price | NEC basis |
| --- | --- | --- | --- | --- |
| NMB-14-2 | NM-B 14/2 with ground, 250 ft | roll | 95 | 334; 14 AWG max 15 A (240.4(D)) |
| NMB-12-2 | NM-B 12/2 with ground, 250 ft | roll | 140 | 334; 12 AWG max 20 A (240.4(D)) |
| NMB-12-3 | NM-B 12/3 with ground, 250 ft | roll | 230 | 3-way travelers (404.2(A)), multiwire circuits |
| NMB-10-2 | NM-B 10/2 with ground, 125 ft | roll | 190 | 30 A circuits (240.4(D)) |
| UFB-12-2 | UF-B 12/2 with ground, 250 ft | roll | 210 | direct burial and wet locations (340.10); NM-B is not permitted wet (334.12(B)(4)) |
| THWN-12 · THWN-10 · THWN-8 · THWN-6 · THWN-3 | THHN/THWN-2 Cu, black/white/green set: 12, 10 AWG (500 ft); 8, 6 AWG (250 ft); 3 AWG (100 ft) | set | 260 · 420 · 480 · 690 · 520 | in raceway, wet rated (310.10, Table 310.16 at 75 °C: 12 = 25 A, 10 = 35, 8 = 50, 6 = 65, 3 = 100) |
| SER-4/0 | SER 4/0-4/0-4/0-2/0 Al, 50 ft | coil | 380 | 200 A service entrance (338, 310.12) |
| CU6-BARE | Bare Cu 6 AWG solid, 100 ft | coil | 110 | grounding electrode conductor to rods (250.66(A)) |

**Breakers (KP, listed for the island's panels)**

| id | Breaker | Price | Basis |
| --- | --- | --- | --- |
| KP115 · KP120 | 1-pole 15 A · 20 A | 9 · 9 | protects 14 / 12 AWG (240.4(D)) |
| KP230 · KP240 · KP250 · KP260 · KP2100 | 2-pole 30 · 40 · 50 · 60 · 100 A | 22 · 24 · 26 · 28 · 85 | 240 V loads, feeders, the transfer switch |
| KP115AF · KP120AF | 1-pole 15 · 20 A AFCI (combination type) | 48 · 48 | bedrooms, living areas (210.12(A)); replacements (406.4(D)(4)) |
| KP120GF | 1-pole 20 A GFCI | 52 | 210.8(A) |
| KP115DF · KP120DF | 1-pole 15 · 20 A dual-function AFCI/GFCI | 62 · 62 | kitchens and laundry need both (210.8(A), 210.12(A)) |
| KP250GF · KP260GF | 2-pole 50 · 60 A GFCI | 130 · 140 | spa / hot tub (680.44) |
| KP230PE | 2-pole 30 A GFPE, 30 mA | 150 | dock circuits (555.35) |
| KP-40-200 | Panelboard, 200 A main breaker, 40 spaces | 420 | 230, 408; directory 408.4(A) |
| KP-TS60 · KP-TS100 | Manual transfer switch 60 A · 100 A, listed | 520 · 780 | 702.5; sized to the backed-up load (702.4(B)) |

**Receptacles and switches** (dwellings and guest rooms need tamper-resistant receptacles, 406.12; wet locations need weather-resistant ones and an in-use cover, 406.9(B)(1))

| id | Device | Pack | Price | Near-miss it sits beside |
| --- | --- | --- | --- | --- |
| KR15-TR · KR20-TR | Duplex receptacle 15 A (5-15R) · 20 A (5-20R), TR | box 10 | 28 · 42 | KR15 (not TR) |
| KR15 | Duplex receptacle 15 A, commercial grade, not TR | box 10 | 22 | wrong in a dwelling (406.12) |
| KR20-TRWR | Duplex receptacle 20 A, TR/WR | box 10 | 55 | |
| KR15S · KR20S | Single receptacle 15 A · 20 A, TR | ea | 7 · 9 | a single receptacle on an individual 20 A circuit must be 20 A (210.21(B)(1)) |
| KG15-TR · KG20-TR · KG20-TRWR | GFCI receptacle 15 A TR · 20 A TR · 20 A TR/WR | ea | 19 · 22 · 26 | a GFCI where an AFCI is due, and the other way round |
| KS1 · KS3 · KS4 | Switch single-pole · 3-way · 4-way, 15 A | box 10 / ea / ea | 15 · 4 · 12 | a 4-way where two 3-ways go |
| WP-INUSE · WP-FLIP | Cover, weatherproof in-use (extra duty) · flip-lid (not in-use) | ea | 18 · 6 | 406.9(B)(1) wants in-use |
| PLATE-BLANK | Blank cover plate (make-safe blank-off) | box 10 | 8 | |

**Boxes, conduit, connectors, grounding**

| id | Item | Pack | Price | Basis |
| --- | --- | --- | --- | --- |
| BOX-OW1 · BOX-NW1 · BOX-OW2 · BOX-4SQ | Box: 1-gang old-work 20.3 in³ · 1-gang new-work 18 in³ · 2-gang old-work 32 in³ · 4 in square 21 in³ with mud ring | box 25 / 25 / 10 / 10 | 45 · 30 · 32 · 55 | box fill (314.16): 12 AWG = 2.25 in³ per conductor |
| BOX-WP1 | Box, weatherproof, 1-gang, cast, three 1/2 in hubs | ea | 12 | wet location (314.15) |
| EMT-12 · EMT-34 | EMT 1/2 · 3/4 in × 10 ft | bundle 10 | 85 · 130 | 358 |
| EMT-C12SS · EMT-C12RT | EMT connectors 1/2 in, set-screw · compression raintight | bag 25 | 18 · 38 | wet locations need raintight fittings (358.42) |
| PVC40-1 · PVC40-114 · PVC80-1 | PVC Sch 40 1 · 1-1/4 in; Sch 80 1 in × 10 ft | bundle 10 | 55 · 75 · 95 | 352; Sch 80 where exposed to damage (352.10(F)) |
| PVC-FIT · PVC-CEM · PVC-EXP1 | PVC fittings kit (couplings, adapters, 90° sweeps) · solvent cement and primer · expansion fitting 1 in | kit · use/10 · ea | 40 · 18 · 28 | 352.44; cement shelf life **52** wk |
| RMC-34 · EYS-34 · SEAL-KIT | Rigid metal conduit 3/4 in × 10 ft · seal fitting 3/4 in · sealing compound and fiber dam | bundle 5 · ea · kit | 180 · 32 · 26 | classified area at a fuel dispenser (514.8, 514.9, 501.15); compound shelf life **52** wk |
| LFNC-34 | Liquidtight flexible nonmetallic 3/4 in, 25 ft, with fittings | coil | 58 | spa disconnect whip (356) |
| WN-ASST · LEVER-50 · NMC-38 · GRN-50 · SPLIT-4 · NOALOX | Twist-on connectors (100) · lever connectors (50) · NM cable connectors 3/8 in (25) · green ground pigtails (50) · split bolts #4 (10) · anti-oxidant 4 oz | use / 15, 10, 25, 25, 10, 20 | 22 · 38 · 12 · 14 · 24 · 9 | 110.14, 250.8; Al terminations |
| ROD-58-8 · ROD-58-4 · ACORN | Ground rod 5/8 in × 8 ft, copper-bonded · 5/8 in × 4 ft · acorn clamp, direct-burial listed (10) | ea · ea · box 10 | 22 · 14 · 30 | 250.52(A)(5): 8 ft in contact with earth; two rods 6 ft apart unless 25 Ω (250.53(A)(2), (A)(3)); 250.70 |
| SPA-60GF · SPA-50GF | Spa panel: 2-pole GFCI in a raintight disconnect, 60 A · 50 A | ea | 190 · 170 | 680.44 GFCI, 680.13 maintenance disconnect in sight |
| LABELS | Panel directory and arc-flash labels | use / 10 | 12 | 408.4(A), 110.16 |

**Tools** (kind `tool`: bought once, kept; the analyst's capex). The existing XP perks in `TOOLS` (data.ts) stay as they are: those are the player's own kit and change how a puzzle plays; shop tools are the company's equipment and gate jobs.

| id | Tool | Price | Life (jobs) | Calibration | Required by | NEC / practical basis |
| --- | --- | --- | --- | --- | --- | --- |
| T-BEND | Hand bender 1/2–3/4 in (EMT, RMC) | 95 | 40 | | dockrun, feeder (EMT/RMC runs) | bends without damage, ≤ 360° between pull points (358.24, 358.26, 344.24) |
| T-HOTBOX | PVC heat bender | 420 | 60 | | hottub, dockrun (PVC) | PVC bends only with listed bending equipment (352.24); a hand bender kinks PVC |
| T-FISH | Fish tape, 100 ft, fiberglass | 85 | 25 | | storm, trip (old-work runs) | practical |
| T-CLAMP | Clamp meter, true-RMS, CAT III 600 V | 180 | | 26 wk ($45) | flicker, xfmr, genTest, codeprep | measuring existing loads (220.87), troubleshooting |
| T-MEGGER | Insulation resistance tester 500/1000 V | 620 | | 26 wk ($95) | feeder, dockrun, hottub, storm (wet runs) | completed wiring free of shorts and ground faults (110.7) |
| T-TORQUE | Torque screwdriver 5–50 in-lb and lug torque wrench, calibrated | 260 | | 26 wk ($45) | panelUp, transfer, xfmr, flicker, hottub | a calibrated torque tool where a torque value is marked (110.14(D)) |
| T-KO | Knockout punch set 1/2–2 in, hydraulic | 540 | 80 | | panelUp, transfer | openings cut clean, unused openings closed (312.5) |
| T-PULL | Cable puller, rope, pulling lubricant | 360 | 30 | | feeder, panelUp | conductor fill and pulling (300.17, Chapter 9 Table 1) |

Starter tools on every island (and every migrated one): T-CLAMP and T-TORQUE (tier-1 jobs need them). The rest are bought when a job first needs them (a tool requisition line) or ahead of time.

### 3.4 Building materials (package D uses them; A defines the items)

Builders put up the next tier's buildings ahead of time (section 15.6); the crew project stays the three trades' part, and a tier arrives when both are done. A pack is what one work unit draws.

| id | Item | Pack | Price | Lead | Shelf (wk) |
| --- | --- | --- | --- | --- | --- |
| BLD-LUM | Framing lumber package, treated (#2 SYP) | lot | 180 | 1 | |
| BLD-PLY | Sheathing, 1/2 in CDX plywood | lot | 150 | 1 | |
| BLD-CON | Bagged concrete mix, 80 lb (pallet) | pallet | 120 | 1 | **26** (bags go hard in island humidity) |
| BLD-RB | Rebar #4 × 20 ft | bundle | 60 | 1 | |
| BLD-ROOF | Standing-seam metal roofing, hurricane rated | lot | 220 | 2 | |
| BLD-TIE | Hurricane ties and structural screws | box | 60 | 1 | |
| BLD-WIN | Windows and doors, impact rated | set | 300 | 2 | |

### 3.5 Suppliers and freight (A, `SUPPLIERS` and `FREIGHT` in `data.ts`)

| id | Supplier | Trades | Price × | Lead + | Receiving | AOG freight |
| --- | --- | --- | --- | --- | --- | --- |
| `oem` | Harbor Aero Supply (OEM distributor) | mech | 1.00 | +0 | 8130-3 missing 5% (quarantine a week) | yes |
| `broker` | Tradewind Surplus (broker) | mech | 0.80 parts and rotables, 0.90 consumables | +1 | 8130-3 missing 25% | no |
| `supply` | Mainland Electric Supply | elec | 1.00 | +0 | | yes |
| `online` | Voltbox (online) | elec | 0.85 | +1 | a line backordered one more week 10% | no |
| `yard` | Harbor Lumber & Block | build | 1.00 | +0 | | no |
| `barge` | Island barge (bulk) | build | 0.85 | +2 | | no |

- **Scheduled freight** (`sched`): free. `eta = week + item.lead + supplier.leadAdd` (the longest line sets the PO's eta). It arrives at that week's resolve if a carrier flew: a cargo flight from tier 2, a guest flight at tier 1. Nothing flew: it slips a week (a review line), as kits did.
- **AOG freight** (`aog`): the AOG boat, `FREIGHT.aog` = $350 per PO (today's `ECON.boatKit`, renamed; keep the old name as an alias for the chain code). `eta = this week`: it arrives at this week's resolve. OEM and supply house only.
- **New or exchange** (rotables): `cond: 'exch'` (default) pays the exchange price plus the core deposit; `new` pays the new price and owes no core.

## 4. Tasks: the manual, the reference, and what each task draws

`src/sim/tasks.ts` (A). A task is what the Manual / Reference step finds, and what a plan names. It decides the job kind (catalog kind), the puzzle scenario, the lines the tech must pick, the bench stock it draws on its own, and the tools it needs.

```ts
export type TaskId = string;   // 'amm:twin:32-40-02', 'afm:float:4', 'gsm:2-4', 'ref:gfci'
export interface Task {
  id: TaskId;
  trade: OpsRole;
  book: 'AMM' | 'AFM' | 'GSM' | 'REF';          // maintenance manual, flight manual, generator service manual, code & procedure reference
  no: string;                                   // "32-40-02", "Section 4", "2-4", "R-GFCI"
  title: string;
  chapter: string;                              // chip: "32 Landing gear", "61 Propellers", "Art. 210 Branch circuits", "Generator"
  kind?: string;                                // the catalog kind it does; absent = reference only (can't be planned)
  job?: string;                                 // Order.job: the puzzle scenario and the AMM card key ('brake', 'wheel', 'magneto', 'plugs', 'bleed', ...)
  models?: ('twin' | 'cargo' | 'float')[];      // mech
  targets?: string[];                           // elec / generator: asset models
  main: MainSlot[];                             // what the tech picks
  bench: BenchLine[];                           // drawn on its own at plan time
  tools?: ItemId[];                             // required shop tools (elec)
  nec?: string[];                               // elec
  keywords: string[];
}
/** mech: an IPC tag on a figure; elec: a slot the judge reads (section 11.3) */
export type MainSlot = { slot: string; ata?: AnyAta; tag?: string; cat?: ItemCat; qty: number | 'side' | 'upa' | 'feet'; optional?: boolean };
/** a bench line may name one item or a set of acceptable ones (the card's fluid) */
export type BenchLine = { item?: ItemId; anyOf?: ItemId[]; qty: number; when?: 'postSb' | 'piston' | 'turbine' };
export function tasksFor(s: IslandState, asset: Asset, role: OpsRole): Task[];   // the manual set this trade uses on this asset: a plane's AMM + AFM (mechanic); the generator manual (mechanic) or the reference (electrician) on the generator; the reference on houses and the grid (electrician)
export function taskById(id: TaskId): Task | undefined;
export function benchFor(task: Task, ac: Aircraft | null, asset: Asset): { item: ItemId; qty: number }[];  // resolves anyOf against the task card (the approved fluid), side and model
```

AMM cards: the six existing `AmmTaskKey`s keep their cards and behaviour. Add keys (with short cards: title, effectivity, warnings, cautions, tools, consumables, 5–8 steps, torques where the puzzle is card-driven): `bleed` (32-42-01, servicing lines = the powerpack's fluid lines so `manualCard` works), `wheelhalf` (32-40-03), `safetywire` (61-10-02), `oil` (79-00-01), `belt` (24-30-02), `cylinder` (72-30-01), `hotsection` (72-00-01), `plugs` (74-20-01, torque 300–360 in-lb on the plugs), `magneto` (74-10-01), `spar` (57-10-01), `inspection` (05-20-01/02). Existing `ALIASES` stay as they are (tests depend on them); new kinds resolve through the task's `job`.

### 4.1 Mechanic tasks (AMM per model, AFM, generator manual)

`upa` = the IPC's units per assembly times the assemblies the AMM does (linings: 2 per brake, both mains: 4). `side` = one (the alert's wheel or engine). Bench items resolve per model (piston or turbine oil, the card's fluid).

| Task | No. | Title | Models | Kind · job | Main picks | Bench (auto) |
| --- | --- | --- | --- | --- | --- | --- |
| `amm:*:05-20-01` | 05-20-01 (cargo 05-20-02 phase) | 100-hour inspection / phase inspection | all | inspect100 · (crack) | — | safety wire 2, cotter pin 2, spark plug gasket 12 per engine (pistons), MS28775-227 1 |
| `amm:*:12-10-01` | 12-10-01 | Tires: servicing (inflation pressure) | all | reference | | |
| `amm:*:12-12-01` | 12-12-01 | Engine oil: level check and servicing | all | reference | | |
| `amm:*:07-10-01` | 07-10-01 | Jacking | all | reference | | |
| `amm:*:79-00-01` | 79-00-01 | Engine oil and filter: change | all | oil · oil | oil filter (79-20 `oilFilter`) × 1 | piston oil 12 qt (turbine: MIL-PRF-23699 9 qt), crush gasket 1, safety wire 1 |
| `amm:*:32-40-01` | 32-40-01 | Main wheel and tire: removal / installation | all | tires · wheel | tire × 1, tube × 1 | grease 1, cotter pin 1 |
| `amm:*:32-40-02` | 32-40-02 | Main brake linings: replacement | all | tires · brake | lining × upa (4) | rivets 16 |
| `amm:*:32-40-03` | 32-40-03 | Main wheel halves: penetrant inspection | all | corrosion · corrosion | — | penetrant 1, conversion coating 1 |
| `amm:tw,fl:32-42-01` | 32-42-01 | Main brakes: bleeding | twin, float | hydraulics · bleed | — | fluid (the card's) 2 qt |
| `amm:tw,fl:29-10-01` | 29-10-01 | Hydraulic power pack: servicing, filter, accumulator precharge | twin, float | hydraulics · powerpack | filter element × 1 | fluid (the card's) 2 qt, bowl O-ring 1, safety wire 1 |
| `amm:*:61-10-01` | 61-10-01 | Propeller: removal / installation and bolt torque | all | prop · prop | — (prop bolts × 6 only when the finding says galled) | safety wire 1, hub O-ring 1, anti-seize 1 (POST SB) |
| `amm:*:61-10-02` | 61-10-02 | Propeller mounting bolts: safety wiring | all | wire · wire | — | safety wire 1 |
| `amm:*:23-10-01` | 23-10-01 | VHF com transceiver: removal / installation | all | avionics · radio | radio × 1 | — |
| `amm:*:24-30-01` | 24-30-01 | Alternator (cargo: starter-generator): removal / installation | all | alternator · alternator | generator × 1 | — |
| `amm:tw,fl:24-30-02` | 24-30-02 | Alternator drive belt: tension check and replacement | twin, float | alternator · belt | belt × 1 | — |
| `amm:tw,fl:72-30-01` | 72-30-01 | Cylinder: removal / installation | twin, float | cylinder · cylinder | cylinder × 1, gasket kit × 1 | anti-seize 1 |
| `amm:cargo:72-00-01` | 72-00-01 | Engine: compressor wash and hot-section borescope | cargo | hotsection · hotsection | — | compressor wash 1 |
| `amm:tw,fl:74-20-01` | 74-20-01 | Spark plugs: removal, service (clean, gap, rotate), installation | twin, float | ignition · plugs | spark plugs × 12, optional (only if replacing) | plug gasket 12, anti-seize 1 |
| `amm:tw,fl:74-10-01` | 74-10-01 | Magneto: removal, installation and timing | twin, float | ignition · magneto | magneto × 1 | magneto gasket 1 |
| `amm:*:57-10-01` | 57-10-01 | Wing spar lower cap and wing structure: inspection | all | spar · spar | — | penetrant 2 |
| `afm:*:4` | AFM / POH Section 4 | Starting engine with external power | all | gpustart (not alert-driven; in the index so a search finds it) | | |
| `gsm:2-1` | GSM 2-1 | Standby generator: engine oil, filters and coolant | gen | genService · genmount | — | 15W-40 3 gal (1 case of 4 = 4 gal), oil filter 1, fuel filter 1, coolant 1 gal |
| `gsm:2-4` | GSM 2-4 | Standby generator: mounts and isolators | gen | genService · genmount | isolator × 4 | — |

New catalog kinds (A, `data.ts`): `ignition` ("Spark plugs and magneto", log "ignition service", mech, teardown, tier 2, cost 300, gain 12, targets twin and float, weight `below(93, 3)`) and `hotsection` ("Compressor wash + hot-section borescope", log "compressor wash and borescope", mech, crack job `hotsection`, tier 3, cost 900, gain 24, targets cargo, weight `below(65, 8)`). `cylinder` loses the cargo from its targets (a turbine has no cylinders). New teardown assemblies (A, `src/puzzles/teardown.ts`, data only): `magneto` (cowl, P-lead grounded first, harness cap, clamps, magneto, gasket; fault: the magneto, tier 5 also the impulse coupling) and `plugs` (cowl, leads, plugs, gaskets; fault: the fouled plug). `DEFECT_RULES_BY_KIND` rows for both (section 11). `INSPECTS.oil.scope` adds `ignition`; `inspect100` stays `all`.

### 4.2 Electrician: the code and procedure reference

Targets: houses (`cottage`, `villa`, `lodge`), the grid (`panel`), the generator (`gen`). Slots are what the pick judge checks against the job's site (section 11.3).

| Task | Ref | Title | Kind · job | Main slots (qty) | Bench | Tools | NEC |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `ref:outlet` | R-OUT | Dead or scorched receptacle: find the open, replace the device | trip · (trace) | `receptacle` 1 | connectors 1 | — | 110.14, 406.4, 406.12 |
| `ref:gfci` | R-GFCI | GFCI protection: test, replace, protect downstream | gfci · gfci | `gfci` 1 (a GFCI receptacle, or a GFCI / dual-function breaker); `cover` 1 if outdoors | connectors 1 | — | 210.8(A), 406.4(D)(3), 406.12, 406.9(B)(1) |
| `ref:afci` | R-AFCI | AFCI protection for bedrooms and living areas | reference | | | | 210.12(A), 406.4(D)(4) |
| `ref:3way` | R-3WAY | 3-way switching: common and travelers | switch3 · switch3 | `switch` 2; `cable` 25 ft, optional; `box` 1, optional | connectors 1 | — | 404.2(A), 404.2(C), 200.7(C)(1), 314.16 |
| `ref:inspect` | R-INSP | Inspection readiness: directory, clearances, labels, breaker sizing | codeprep · codeprep | — | labels 1 | T-TORQUE, T-CLAMP | 408.4(A), 110.26(A), 110.22(A), 240.4(D) |
| `ref:storm` | R-STORM | Storm damage: replace wet or damaged branch wiring and devices | storm · (trace) | `cable` feet; `receptacle` 2; `box` 2; `cover` 1 (the porch) | connectors 2 | T-FISH, T-MEGGER | 110.11, 334.12(B)(4), 406.4(D), 406.9(B)(1) |
| `ref:flicker` | R-FLICK | Flicker and dimming: loose neutral, voltage drop | flicker · (meter) | — | connectors 1 | T-CLAMP, T-TORQUE | 110.14, 110.14(D), 200.2 |
| `ref:spa` | R-SPA | Outdoor hot tub: GFCI, disconnect, wiring method, bonding | hottub · (conduit) | `spa` 1; `wire` 1 set; `conduit` feet; `whip` 1 | PVC fittings 1, cement 1 | T-HOTBOX, T-MEGGER, T-TORQUE | 680.42, 680.44, 680.13, 680.42(B), 352, 300.5, Table 250.122 |
| `ref:feeder` | R-FEED | Outside feeder to the cottages: trace and repair | feeder · (trace) | `splice` 3 | — | T-MEGGER, T-PULL | 225, 300.5, 110.7 |
| `ref:panel` | R-PANEL | Service and panel upgrade to 200 A | panelUp · (panel) | `panel` 1; `service` 1; `rod` 2; `clamp` 1; `gec` 1 | anti-oxidant 1 | T-TORQUE, T-KO, T-PULL | 230, 408, 250.24, 250.52(A)(5), 250.53(A), 110.14(D), 312.5 |
| `ref:deadckt` | R-DEAD | Dead branch circuit at the panel: breaker, lug, bus | xfmr · (meter) | `breaker` 1, optional (when the finding says the breaker failed) | — | T-TORQUE, T-CLAMP | 110.14(D), 240, 408 |
| `ref:dock` | R-DOCK | Fuel dock run: classified area, seals, ground-fault protection | dockrun · (conduit) | `rmc` 1; `seal` 1; `wire` 1 set; `conduit` feet; `breaker` 1 | seal kit 1 | T-BEND, T-MEGGER | 514.8, 514.9, 501.15, 555.35, 300.5 |
| `ref:xfer` | R-XFER | Standby generator: transfer switch and circuits | transfer · transfer | `xfer` 1; `wire` 1 set; `breaker` 1 | — | T-TORQUE, T-KO | 702.4(B), 702.5, 445.13 |
| `ref:gentest` | R-GENT | Generator-backed circuits: weekly test and repair | genTest · (meter) | — | connectors 1 | T-CLAMP | 110.3(B), 702.4 |
| `ref:ground` · `ref:boxfill` · `ref:wet` · `ref:tr` | R-GRND · R-BOX · R-WET · R-TR | Grounding electrodes · box fill · wet and damp locations · tamper-resistant receptacles | reference | | | | 250.52–250.70 · 314.16 · 406.9, 314.15, 358.42, 334.12(B)(4) · 406.12, 406.4(D)(5) |

Each reference entry carries a short plain-English summary of the rule (two to four lines) that the Reference step shows, for example R-GFCI: *"Bathrooms, kitchen counters, outdoors, laundry, within 6 ft of a sink or a tub (210.8(A)). A replacement where GFCI is now required must be GFCI protected (406.4(D)(3)). Dwelling and guest-room receptacles are tamper-resistant (406.12); outdoors, weather-resistant with an in-use cover (406.9(B)(1))."* Tiers 0–2 add the answer for this job's site ("this circuit: 20 A, 12 AWG, bathroom: GFCI 20 A TR"). Tier 3+ shows the rule only.

### 4.3 Bench stock and tools at plan time

- The engine adds `benchFor(task, ac, asset)` to the plan's lines. The tech sees them in the Stock step with their badges, never picks them.
- Tools: each required tool must be owned (`inv[tool].on >= 1`) and not away for calibration. A missing tool becomes a requisition line (a capex purchase); a tool away for calibration makes the job wait until it is back.
- A job signed off with a tool past its calibration (`cal < week`) adds 0.15 to its hidden-defect chance, and the variant is `cal` (section 11.4).
- A tool with a `life` loses one use per job signed off; at 0 it is worn out (`on = 0`; feed: "The fish tape kinked: replace it.").

## 5. Alerts

`src/sim/alerts.ts` (A). Alerts are where jobs come from.

### 5.1 Generation (replaces `generateOpsOrders` for trade work on assets)

```ts
export function generateAlerts(s: IslandState, r: Rng, now: number): void;           // openWeek, where generateOpsOrders ran
export function raiseAlert(s: IslandState, o: RaiseOpts, now: number): Alert;         // also used by repairs, NFF comebacks, hard landings, tows (package D)
export type RaiseOpts = { role: OpsRole; asset: Asset; kind?: string; sym?: string; src?: AlertSrc; due?: number; repair?: RepairInfo; again?: number; seed?: number; week?: number /* the week it shows: the staff hooks raise at the resolve for next week */; who?: string };
export function symptomText(s: IslandState, a: Alert): string;                        // "L/H brake pedal soft; pulls right on the landing roll."
export function findingOf(s: IslandState, a: Alert, tier: number): { text: string; nff: boolean };  // what Investigate shows (tier ≤ 2: plain, names the fix; tier 3+: raw readings)
export function siteOf(s: IslandState, a: Alert): ElecSite | null;                     // electrical: room, circuit, AWG, run (derived from the seed)
export function fixesOf(s: IslandState, a: Alert): TaskId[];                            // HIDDEN: the tasks that fix it ([] for NFF)
export function alertTier(s: IslandState, a: Alert, role: Role): number;               // grace → 1; else clamp(1 + ⌊islandTier/2⌋ + (asset health < 50 ? 1 : 0), 1, 5); a repair: its defect's tier
export function alertFlags(s: IslandState, a: Alert): { aw: boolean; hazard: boolean; mel: 'B' | 'C' | null; bench: boolean; obvious: ItemId[] };
```

- **Same volume as today.** Per trade, the slot logic of `generateOpsOrders` is kept: target open work 4 (tier ≥ 3: 5), at most 3 new per week, must-do candidates (weight ≥ 100) first, an asset under 45 health with nothing open on it is forced, then weighted picks by `CatalogEntry.weight × (1 + (100 − health)/40)`, spread across assets. "Open work" counts open alerts plus open orders that aren't `waiting_part`. A candidate kind is skipped when an open alert on that asset has that hidden kind or an open order of that kind exists on it.
- **Each pick becomes an alert**, except `wb` (load sheets) and `gpustart` (ground power starts), which stay direct orders exactly as today. `raiseAlert` picks a symptom whose causes include that kind and fit the asset model (weighted by the cause's weight), then the cause, the lead time (`due = week + lead`), and for electrical units the bench truth.
- **NFF extras.** Per trade per week, `ALERTS.nff[role]` (0.25, tune) chance of one more alert whose cause is "no fault": a symptom with an `nff` weight, on an asset weighted by (100 − health). It doesn't take a slot.
- **The sole guest plane** (the twin through tier 3) never gets `due = week` on an airworthiness symptom: its lead is at least 1 (the chain's rule, same reason: grounding it empties every house).
- **Repairs become alerts.** `detectDefects` and a surfacing defect raise a repair alert (`kind: 'repair'`, `src: 'finding'` or `'again'`, `repair` = today's RepairInfo, `due = week`) instead of calling `addRepair` directly; `plan` on it creates the repair order through the existing `addRepair` path with the flow picks. The repair's task is derived (`repairTask(alert)`): no Investigate or Manual step, the flow opens at Parts. Redos stay direct orders (the parts are already on the asset).
- **Inspections and take-offs** (`src: 'due' | 'ad' | 'code' | 'takeoff'`) name their task: the Manual step is pre-filled (the tech confirms it), no Investigate.
- Alert ids come from `s.nextId` (`a${n}`), seeds from `hashSeed(s.seed, 'alert', id)`.

### 5.2 Mechanic symptoms

`aw`: airworthiness (no-go from the due week unless MEL-deferred). `MEL`: company MEL (Part 135) category where the plane has a redundant system. `lead`: weeks from raised to due. `bench`: an electrical unit (the electrician can meter the circuit). Causes list the hidden kind, its weight, the tasks that fix it, and the raw finding (tier ≤ 2 findings add one plain sentence naming the task, shown in quotes after the raw one where it isn't obvious).

| Key · src | Text | Models | aw · MEL · lead | Causes (kind w: fix → raw finding) | NFF w: finding |
| --- | --- | --- | --- | --- | --- |
| `M_BRAKE_SOFT` · squawk | "{side} brake pedal soft; pulls {other} on the landing roll." | all | aw · — · 0 | hydraulics 3: 32-42-01 → "Pedal sinks, then firms up after two or three pumps; reservoir at ADD; no leaks at the caliper." (twin, float) · tires 2: 32-40-02 → "{side} linings 0.06 in (limit 0.10); pedal firm; no leaks." | — |
| `M_BRAKE_CHATTER` · squawk | "Brakes chatter and grab on taxi." | all | — · — · 1–2 | tires 3: 32-40-02 → "Linings glazed; disc heat-checked, within limits." | 1: "Taxi test smooth; linings 0.18 in; disc in limits. Could not duplicate." |
| `M_TIRE_WORN` · wear | "{side} main tire at 2/32 in on the outboard shoulder: change within {lead} weeks." | all | aw · — · 1–3 · obvious: tire, tube | tires 1: 32-40-01 → "Tread 2/32 in at the shoulder, no cords; sidewall sound." | — |
| `M_TIRE_PRESSURE` · squawk | "{side} main tire loses 5 psi overnight." | all | aw · — · 1 | corrosion 3: 32-40-03 → "Soap test: bubbles at a tie-bolt hole on the outer wheel half; the tube holds." · tires 2: 32-40-01 → "Soap test: the valve core bubbles; the wheel halves are dry." | 1: "Held pressure 24 h after a top-up: a cold night. Could not duplicate." |
| `M_WHEEL_CORROSION` · finding | "Corrosion blistering on the {side} wheel half at the bead seat." | all | aw · — · 1–2 | corrosion 1: 32-40-03 | — |
| `M_HARD_LANDING` · landing | "Hard landing reported by {pilot}: inspect the gear, the tires and the wing." | all | aw · — · 0 (sole guest: 1) | tires 2: 32-40-01 → "{side} tire flat-spotted through two plies." · corrosion 1: 32-40-03 → "Penetrant: an indication at the {side} wheel-half bead seat." · spar 1: 57-10-01 → "Wing-root fairing rivets working; spar cap to be checked." | 2: "Gear, tires and wing root inspected: no damage. Nothing to order." |
| `M_TOW` · tow | "The tug clipped {plane}'s {side} wingtip on a tow: dent at the tip, the nav light lens cracked." | all | aw · — · 0 (sole guest: 1) | spar 1: 57-10-01 → "Tip rib buckled; no damage inboard of the tip; spar cap sound." | — |
| `M_PROP_VIB` · squawk | "Vibration at cruise that changes with rpm." | all | aw · — · 0 (sole guest: 1) | prop 3: 61-10-01 → "Two prop bolts below torque; fretting at the flange." · wire 2: 61-10-02 → "Safety wire broken on one bolt pair; bolts at torque." | 1: "Run-up smooth; blades and spinner undamaged. Could not duplicate." |
| `M_PROP_AD` · ad | "AD 2016-09-12 recurring hub inspection due in {lead} weeks (cargo: AD 2014-22-08 blade clamp bolt check): bolt torque check with it." | all | aw · — · 2–3 | prop 1: 61-10-01 | — |
| `M_SAFETY_WIRE` · finding | "Safety wire broken on a prop bolt pair at the preflight." | all | aw · — · 0 (sole guest: 1) | wire 1: 61-10-02 | — |
| `M_COM_DEAD` · squawk | "Com 1 dead on transmit; receive weak." | all | aw · C (twin, cargo) · 0 · bench | avionics 1: 23-10-01 → "No sidetone, no carrier on the test set; breaker holds; 27.8 V at the tray." | — |
| `M_COM_INTERMITTENT` · squawk | "Com 1 cuts out over bumps." | all | — · C · 1–2 | avionics 2: 23-10-01 → "Wiggle test at the tray: drops out; cam lock backed off, pins dull." | 2: "Ops check on ground power normal; no dropout on the wiggle test. Could not duplicate." |
| `M_LOW_VOLTS` · squawk | "Low-voltage light on {engine}; the ammeter shows a discharge." | twin, float | aw · C (twin) · 0 · bench | alternator 3: 24-30-01 → "No output at B+ at 2,000 rpm; field voltage present; belt tight." · alternator 1: 24-30-02 → "Belt glazed and slipping under load; the alternator's output normal once tensioned." | — |
| `M_GEN_OFF` · squawk | "GEN OFF light on the ground run; the starter works." | cargo | aw · — · 0 · bench | alternator 1: 24-30-01 → "No output at the GCU with the field excited; brushes at the wear line." | — |
| `M_BELT_SQUEAL` · squawk | "Squeal from the alternator belt on start-up." | twin, float | — · — · 1–2 | alternator 3: 24-30-02 → "Belt glazed; tension below the used-belt value." | 1: "Tension within the used-belt value, no glazing. Could not duplicate." |
| `M_ROUGH_MAG` · squawk | "Rough on the {side} mag check: 175 rpm drop (limit 125)." | twin, float | aw · — · 0 (sole guest: 1) | ignition 3: 74-20-01 → "#3 EGT goes cold on that mag; #3 bottom plug lead-fouled; compression 74/80." · ignition 1: 74-10-01 → "Every cylinder drops evenly on that mag; its internal timing 6° late." · cylinder 1: 72-30-01 → "#3 compression 42/80; air at the exhaust stack." | — |
| `M_CHT_TREND` · trend | "Engine monitor: #3 CHT runs 40 °F hotter than the rest, three weeks running." | twin, float | aw · — · 2–3 | cylinder 2: 72-30-01 → "#3 compression 58/80; air at the intake; intake gasket seeping." · ignition 1: 74-20-01 → "#3 top plug electrode worn to half; compression good." | 1: "A folded baffle seal at #3, straightened on the spot; CHTs even now. Nothing to order." |
| `M_OIL_IRON` · trend | "Oil analysis: iron 38 ppm, up from 12." | twin, float | aw · — · 2–4 | cylinder 3: 72-30-01 → "Borescope: #2 cylinder wall scored; compression 60/80." | 1: "Resample: iron 14 ppm. The last sample was contaminated." |
| `M_OIL_DUE` · due | "Oil change due in {lead} weeks (50 hours)." | all | — · — · 1–2 · obvious: oil filter, oil | oil 1: 79-00-01 | — |
| `M_OIL_LEAK` · squawk | "Oil on the belly after one flight." | all | aw · — · 0–1 | oil 2: 79-00-01 → "Drain plug safety wire broken, the plug backing off; filter gasket dry." · cylinder 1: 72-30-01 → "Oil weeping at #4 cylinder base." (pistons) | 1: "Overfilled by a quart; the breather blew it out. Serviced to the mark." |
| `M_GEAR_SLOW` · squawk | "Gear takes 12 s to retract (normal 6–9 s)." | twin, float | aw · — · 1 | hydraulics 3: 29-10-01 → "Filter bypass button out; fluid dark; reservoir low." | 1: "8 s on jacks on ground power: the battery was low that day." |
| `M_ACCUM` · squawk | "Brake accumulator runs down after two applications." | twin, float | aw · — · 0 (sole guest: 1) | hydraulics 1: 29-10-01 → "Precharge 450 psi against the card's value." | — |
| `M_INSP_DUE` · due | "100-hour inspection due in {n} flights." (cargo: "Phase inspection due.") | all | — (today's −6 overdue rule stays) · — · 1 · obvious: inspection bench | inspect100 1: 05-20-01 | — |
| `M_SPAR_AD` · ad | "AD 2011-20-05 spar lower cap inspection due in {lead} weeks." | twin | aw · — · 2–3 | spar 1: 57-10-01 | — |
| `M_WING_RIVETS` · squawk | "Smoking rivets at the wing root." | all | aw · — · 0 (sole guest: 1) | spar 1: 57-10-01 | — |
| `M_ITT_TREND` · trend | "Engine trend: ITT margin shrinking 8 °C a week." | cargo | aw · — · 2–3 · obvious: compressor wash | hotsection 3: 72-00-01 → "Compressor salt-fouled; CT vanes lightly eroded, in limits." | 1: "ITT bug mis-set after an instrument swap; the trend is normal." |
| `M_GEN_RUN` · squawk | "Weekly generator run: oil pressure low at start, coolant weeping at a hose." | gen | — · — · 1–2 | genService 1: gsm:2-1 | — |
| `M_GEN_SHAKE` · squawk | "The generator shakes on its weekly run." | gen | — · — · 1–2 | genService 1: gsm:2-4 → "Two isolators cracked and oil-soaked; mount bolts loose." | — |

`{side}` is L/H or R/H (a wheel, or an engine on the twin); `{other}` the other side; `{engine}` is "the {side} engine" on the twin, empty on a single. `{pilot}` is `alert.who` (the pilot who flew it, from staff; "the pilot" when it is absent).

**MEL (company MEL, Part 135)**: category C = 2 resolves, B = 1. Com 1 INOP: C on the twin and the cargo (com 2 operative); the float has one com: no MEL. One alternator INOP: C on the twin (load shed per the MEL remarks). Everything else: no MEL.

### 5.3 Electrician symptoms

`hazard`: shock or fire: the house is unrentable from the moment it's raised until made safe (then rentable at ×0.75) or fixed. The site (`ElecSite`) derives from the seed; the room list says which rooms the text can name.

| Key · src | Text | Targets · site | hazard · lead | Causes (kind w: fix → raw finding) | NFF w: finding |
| --- | --- | --- | --- | --- | --- |
| `E_DEAD_OUTLET` · guest | "Guest at {house}: the {room} outlets are dead; no breaker is tripped." | houses · kitchen, living, bedroom, laundry | — · 0–1 | trip 3: ref:outlet → "Hot open at the second receptacle; the first is backstabbed and loose." · gfci 2: ref:gfci → "A bathroom GFCI is tripped and won't reset; its LOAD side feeds these outlets." | 2: "A GFCI upstream was tripped; reset and tested fine. Nothing to replace." |
| `E_WARM_OUTLET` · guest | "Guest at {house}: an outlet in the {room} is warm and smells burnt." | houses · living, bedroom, kitchen | **hazard** · 0 | trip 3: ref:outlet → "Backstabbed receptacle; the hot conductor loose and discoloured." · gfci 1: ref:gfci → "The GFCI's LINE terminal loose and scorched." | — |
| `E_GFCI_TRIPS` · guest | "Guest at {house}: the bathroom outlet trips whenever the hair dryer runs." | houses · bath | — · 0–1 | gfci 3: ref:gfci → "Trips at 3 mA on the tester (should hold to 4–6 mA); 11 years old." · trip 1: ref:outlet → "Water in a box downstream; terminals corroded." | 2: "The GFCI tests right; the guest's hair dryer leaks 7 mA to ground. It's the dryer." |
| `E_SHOWER_TINGLE` · guest | "Guest at {house} felt a tingle at the shower valve." | houses · bath | **hazard** · 0 | gfci 2: ref:gfci → "No GFCI on the bathroom circuit; 4 V valve to drain; the heater circuit's ground open." · flicker 1: ref:flicker → "Open neutral at the service: neutral to ground 9 V; lights brighten when the AC starts." | — |
| `E_NO_GFCI` · code | "Inspector's note at {house}: no GFCI on the porch receptacle, and a flip-lid cover." | houses · outdoor (wet) | — · 2–3 | gfci 1: ref:gfci | — |
| `E_THREEWAY` · guest | "Guest at {house}: the hall light works from one switch only." | houses · hall | — · 1–2 | switch3 1: ref:3way → "A traveler landed on the common screw at the far switch." | — |
| `E_SWITCH_WARM` · guest | "Guest at {house}: a switch plate is warm." | houses · hall | — · 0–1 | switch3 2: ref:3way → "Loose traveler at the 3-way; two 12/3 cables in an 18 in³ box." · trip 1: ref:outlet → "A backstabbed receptacle in the same box, loose." | — |
| `E_CODE_DUE` · code | "County electrical inspection at {house} in {lead} weeks: directory, clearances, labels." | houses · panel | — · 2 | codeprep 1: ref:inspect | — |
| `E_STORM_DEAD` · guest | "After the storm: two rooms at {house} dead, water in the porch box." (no storm last week: "Water in the porch box at {house} after the rain.") | houses · outdoor (wet), bedroom | **hazard** · 0 | storm 3: ref:storm → "Porch box full of water, terminals corroded; the run to the bedroom wet, 0.2 MΩ." · trip 1: ref:outlet → "One receptacle failed; the rest dry, insulation good." | — |
| `E_FLICKER` · guest | "Guest at {house}: the lights flicker when the AC kicks on." | houses | — · 0–1 | flicker 3: ref:flicker → "Neutral lug at the panel loose; 112–128 V under load." | 1: "A 4% sag on the AC's start: normal inrush. Could not duplicate." |
| `E_TAKEOFF_SPA` · takeoff | "Install a {amps} A hot-tub circuit at {house}: the pad is {feet} ft from the panel." | houses · spa (60 A, 30% 50 A; 35–55 ft; buried) | — · 2–3 | hottub 1: ref:spa | — |
| `E_FEEDER_DROP` · utility | "Utility log: the feeder to the east cottages dropped out twice last night." | panel | — · 0–1 | feeder 3: ref:feeder → "Insulation 0.4 MΩ at a buried splice; the splice kit cracked." · xfmr 1: ref:deadckt → "The feeder breaker's lug loose and discoloured." | — |
| `E_UTIL_SAG` · utility | "Meter data: phase B sags to 108 V at peak." | panel | — · 1–2 | xfmr 3: ref:deadckt → "Phase B lug at the main 40 °F hot on the IR scan." | 1: "The utility transformer's tap: their side, reported to them." |
| `E_DEAD_CIRCUIT` · utility | "A dead circuit at the panel: breaker on, no voltage at the load." | panel | — · 0–1 | xfmr 1: ref:deadckt → "Breaker contacts open: 120 V line side, 0 V load side." | — |
| `E_PANEL_LOAD` · trend | "Main panel at 92% of its rating at peak: plan the upgrade." | panel | — · 3–4 · obvious: panelboard, SER | panelUp 1: ref:panel | — |
| `E_TAKEOFF_DOCK` · takeoff | "The fuel dock's old direct-burial run fails its insulation test: replace it with a conduit run." | panel · dock | — · 2–3 | dockrun 1: ref:dock | — |
| `E_DOCK_TRIP` · utility | "The fuel-dock pumps trip their ground-fault protection." | panel · dock | — · 0–1 | dockrun 2: ref:dock → "Buried run 0.3 MΩ; water in the dispenser junction." | 1: "Rain in the pump motor's box; dried and resealed; the run tests fine." |
| `E_TAKEOFF_XFER` · takeoff | "The transfer switch is too small for the houses now: install a larger one." | gen · load 70–95 A | — · 2–3 | transfer 1: ref:xfer | — |
| `E_XFER_FAIL` · utility | "In the weekly test the transfer didn't pick up the villas." | gen | — · 0–1 | transfer 2: ref:xfer · genTest 2: ref:gentest | — |
| `E_GEN_TEST` · utility | "Weekly test: a backed-up circuit didn't come on." | gen | — · 0–1 | genTest 1: ref:gentest → "Relay coil at the transfer panel open." | — |

`ElecSite` (derived; `siteOf`):

```ts
export interface ElecSite {
  room: 'bath' | 'kitchen' | 'bedroom' | 'living' | 'laundry' | 'outdoor' | 'hall' | 'dedicated' | 'panel' | 'spa' | 'dock' | 'gen';
  amps: 15 | 20 | 30 | 50 | 60 | 100;      // the circuit's breaker as it is
  awg: 14 | 12 | 10 | 8 | 6 | 3;           // its conductors as they are
  single?: boolean;                        // a single receptacle on an individual branch circuit
  wet?: boolean;
  run?: 'nm' | 'buried' | 'exposed';
  feet?: number;
  load?: number;                           // transfer: the backed-up load, amps
  classified?: boolean;                    // dock: the dispenser's classified area
}
```

Rules for sites: bathrooms are on a 20 A, 12 AWG circuit (210.11(C)(3)); kitchen counters 20 A; bedrooms, living rooms and halls 15 A / 14 AWG (70%) or 20 A / 12 AWG; `dedicated` is a 20 A single receptacle (a microwave or a window unit) on 12 AWG; outdoor is wet. The Investigate step shows the site (tier 3+: "Circuit: 20 A breaker, 12 AWG NM-B; the device feeds one more receptacle"), and the alert text names the room.

### 5.4 The bench check (electrical units on a plane)

Alerts with `bench` (M_COM_DEAD, M_LOW_VOLTS, M_GEN_OFF) store the hidden fault at raise: `wiring` with `ALERTS.wiringShare` (0.3, today's `CHAIN.wiringShare`), else `unit`. The mechanic may **Ask {elec} to meter it** (`askBench`): a `bench` order for the electrician (today's kind `bench`, meter puzzle, `job = benchJob(tag, model)`, `context.bench = { fault }`), linked by `Order.bench = alertId` (new optional field). The call:
- *The unit*: `bench.call = 'unit'`; the mechanic plans the part as usual.
- *The wiring*, fixed: the alert closes `wired`; the plane gets half the kind's gain; no part.
- Wrong calls leave today's sure defects (`meter:unit`, `meter:wiring`, `meter:radio`), traced to the electrician's check.
- Skipping the check when the fault is the wiring: the unit goes on, and at sign-off *"Ground run: still no output. The removed unit tests good on the bench."* The job doesn't sign off; a unit bought for this job goes back (credit less restocking), a pulled one back to stock; the alert gets `bench.again = true` and a bench order opens for the electrician; the job goes back to `waiting_part` with `flow.stop` set (*"Still no output with the new unit: waiting on {elec}'s circuit check"*) until the check comes back (`wiring`: the electrician's fix closes the alert `wired`, and the job is cancelled with its labour paid; `unit`: `flow.stop` clears and the job is `ready`). This is today's `missedWiring`, moved from the chain to the alert.
- Autopilot for an absent electrician calls the unit (today's rule).

The chain's random trigger no longer fires on flow jobs on 23-10 and 24-30 (the flow covers electrical units); legacy orders (no `flow`: migrated ones, and the ones the chain tests build) keep today's trigger, and chains already open keep their own bench.

### 5.5 Comebacks and escalation

- **NFF close on a real fault**: the alert closes `nff`; a hidden comeback re-raises it after `ALERTS.againMin..againMax` (1–2) weeks as `src: 'again'`, due now, same cause, text prefixed "Written up again: …". No incident: the repeat squawk and the due-now grounding are the cost.
- **An alert nobody planned**, past its due week: it rolls today's deferral risk as if it were a carried order (`deferralRisk` with its weeks past due, cost `3 × labour` of its true kind), blamed on its trade. An airworthiness alert on a plane doesn't roll (the plane is AOG instead).
- An alert on an asset that is out of service (grounded, red-tagged, AOG) doesn't roll.

## 6. Search

`src/sim/search.ts` (A): pure, deterministic, no DOM, shared by the UI (B, C), the bots and the tests.

### 6.1 Index sources

| Index | Built from | One doc per | Chapters (chips) |
| --- | --- | --- | --- |
| `manualIndex(s, asset, role)` | `tasksFor(s, asset, role)`: the model's AMM tasks and AFM Section 4 (planes), the generator manual (the mechanic on the generator), the code and procedure reference (the electrician on houses, the grid and the generator) | task | AMM: "05 Time limits", "07 Lifting", "12 Servicing", "23 Communications", "24 Electrical power", "29 Hydraulic power", "32 Landing gear", "57 Wings", "61 Propellers", "72 Engine", "74 Ignition", "79 Oil"; reference: "Art. 110 General", "Art. 210 Branch circuits", "Art. 250 Grounding", "Art. 314 Boxes", "Art. 334/340/352 Wiring methods", "Art. 404 Switches", "Art. 406 Receptacles", "Art. 408 Panels", "Art. 680 Spas", "Art. 702 Standby", "Art. 514/555 Fuel dock" |
| `ipcIndex(s, asset)` | `figuresFor(ac)`: every row of every figure for this airplane (effectivity evaluated), plus the ICA part of an alteration that has an EA on record (`s.eas`), plus PMA P/Ns with their eligibility | IPC row | "Fig 12 · 32-40 Wheels and brakes", … one per figure |
| `supplyIndex(trade)` | `ITEMS` of that trade (mech: shop consumables and every plane's parts; elec: materials and tools; build: materials) | item | `ItemCat` |

Memoized: static indexes once per module; per-airplane indexes by `${seed}|${assetId}|${eas on it}` in an LRU of 12 (like `islandAircraft`).

### 6.2 Documents and functions

```ts
export type Doc = {
  id: string;                     // TaskId, ItemId, or `${pn}@${fig}.${item}` for an IPC row
  kind: 'task' | 'ipc' | 'item';
  title: string;                  // "32-40-02 Main brake linings: replacement" · "066-19600 LINING, HEAVY DUTY (METALLIC)" · "GFCI receptacle 20 A, TR"
  sub: string;                    // "IPC Fig 12 item 21A · EFF C · UPA 2 · SUPSDS 066-19500" · "NEC 210.8(A), 406.4(D)(3)" · "20 A · TR · box of 1"
  chapter: string;
  text: string;                   // everything searchable: title, sub, nomenclature, notes, keywords, NEC articles, tags
  pn?: string;                    // normalized P/N (upper case, no spaces or dashes)
  order: number;                  // print order: figure order, then catalog order
  ref: { task?: TaskId; item?: ItemId; ata?: AnyAta; fig?: number; row?: string; eff?: string; applies?: boolean; supsdBy?: string; np?: boolean; alt?: boolean; ea?: string };
};
export type Index = { key: string; docs: Doc[]; post: Map<string, number[]>; vocab: [string, number][]; chapters: { chapter: string; n: number }[] };
export function tokenize(text: string, trade?: OpsRole): string[];
export function buildIndex(key: string, docs: Doc[]): Index;
export type Hit = { doc: Doc; score: number; matched: string[] };
export function search(ix: Index, q: string, o?: { limit?: number; chapter?: string; boost?: (d: Doc) => number }): Hit[];
export function complete(ix: Index, prefix: string, n?: number): string[];       // autocomplete chips: vocabulary tokens by frequency
export function hintsFor(s: IslandState, a: Alert, tier: number): { chips: string[]; tasks: TaskId[]; items: ItemId[] };
export function rowBadges(s: IslandState, asset: Asset, d: Doc, tier: number): string[];
```

### 6.3 Tokenizer, synonyms, ranking

- Lower case; split on spaces and punctuation, but keep a P/N token whole (letters, digits, dashes, slashes), and add it with dashes removed (`066-19600` → `066-19600`, `06619600`); strip a trailing plural `s` / `es`.
- Synonyms by trade (expanded at index time, not query time, so the query stays what was typed). Mech: pad, pads → lining; alt → alternator; gen, genny → generator, starter-generator; mag → magneto; plug → spark plug; com, radio → transceiver; oring, o ring → o-ring; tyre → tire; prop → propeller; 5606, red oil → mil-prf-5606; wire → safety wire. Elec: outlet, plug-in → receptacle; gfi → gfci; afi → afci; romex → nm-b; pipe → conduit; j-box, junction → box; ats → transfer switch; megger → insulation tester; hot tub → spa; three-way, 3 way → 3-way; df → dual-function.
- Score of a doc for query tokens `q1..qn`: per token, the best of: exact P/N 12; P/N substring (≥ 4 characters) 8; exact token in title 3; prefix in title 2; exact in text 1.5; prefix in text 1; one edit away (tokens of 5+ characters) 0.6. Sum; if a token matched nothing, the sum × 0.35 (partial matches rank below full ones). Plus `boost(doc)`. Ties: `order`, then `id`. Default limit 20.
- `complete(prefix)`: the 6 most frequent vocabulary tokens starting with it (≥ 2 characters typed), P/Ns last.

### 6.4 What each tier shows

| Tier (the alert's, section 5.1) | Suggestions | Result badges | Before commit |
| --- | --- | --- | --- |
| 0–1 | keyword chips from the symptom and the finding; the likely task pre-highlighted; in Parts, the right row pre-highlighted | "◀ this airplane", "superseded: use 066-19600 (INTCHG 2)", "not effective for S/N 310R0431", "NP: order item 2A", "for 20 A circuits", "TR required in dwellings (406.12)" | a wrong pick is flagged in the Stock step ("Check: EFF C is POST SB; this airplane is PRE SB"), not blocked |
| 2 | keyword chips only | as tiers 0–1 | nothing |
| 3–5 | none: chapter chips and the search bar | only what the book prints (EFF code, UPA, SUPSD BY, NP, ALT) or the catalog's spec line | nothing |

Keyword chips: the symptom's own nouns plus the finding's (tier ≤ 2), mapped through the synonyms (for "Pedal sinks, then firms up after two or three pumps": `brake`, `bleed`, `32-42`).

### 6.5 Near-misses (all come from the data, none are fake entries)

- **Mechanic**: both S/N blocks (A/B rows side by side); PRE/POST SB rows (a code-2 part fits new-for-old only, a code-3 part only as the SB set); NP rows (order the next higher assembly); ALT rows (a legal alternate); other models' P/Ns in the shop stock (the float's FH-M40B beside the twin's FH-M37B: different heat ranges); on an altered airplane the IPC's own part (the data plate says *Altered: STC …*): the right move is *Not in the IPC · research the records*; after an EA, the ICA part is a normal row tagged "EA 26-104".
- **Electrician**: 15 A vs 20 A (a single receptacle on an individual 20 A circuit), GFCI vs AFCI vs dual-function, TR vs not TR, WR and in-use vs flip-lid, 14 vs 12 AWG, 8 vs 6 AWG on a 60 A spa, NM-B vs UF-B or THWN-2 in a wet or buried run, an 18 in³ vs 20.3 in³ box for two 12/3 cables, a 60 A vs 100 A transfer switch, a 50 A vs 60 A spa panel, PVC vs RMC (and no seal fitting) at the fuel dispenser, a 4 ft vs 8 ft ground rod, a hand bender vs the PVC hot box.

### 6.6 Performance

An airplane's IPC index is about 250 docs, the electrical catalog about 90. Build under 20 ms, search under 2 ms on a phone (a test asserts generous bounds on CI). The UI debounces typing by 80 ms and never rebuilds an index on a keystroke.

## 7. Engine actions

Types in `types.ts`, handling in `engine.ts` (flow and purchasing), `src/sim/staff.ts` (staff: section 15). Every action below except `spendBudget` is added to `WEEK_BOUND` (stamped with the week; a stale week is refused as today). Tech actions are refused after that seat's turn ended (*"Your turn is over for this week."*); analyst actions too, except approving an AOG-critical card or requisition (today's chain rule, widened). `buyList` stays in the union and always fails: *"Parts kits are gone: buy real items from the stock planner."*

```ts
| { t: 'plan'; role: OpsRole; alert: string; task: TaskId; pick: { item: ItemId; qty: number }[]; research?: boolean; week?: number }
| { t: 'nff'; role: OpsRole; alert: string; week?: number }
| { t: 'mel'; role: 'mech'; alert: string; week?: number }
| { t: 'makeSafe'; role: 'elec'; alert: string; how: 'breaker' | 'blankoff'; week?: number }
| { t: 'askBench'; role: 'mech'; alert: string; week?: number }
| { t: 'repick'; role: OpsRole; order: string; pick: { item: ItemId; qty: number }[]; research?: boolean; week?: number }
| { t: 'dropJob'; role: OpsRole; order: string; week?: number }
| { t: 'request'; role: OpsRole; item: ItemId; qty: number; why?: string; week?: number }
| { t: 'cancelReq'; role: Role; req: string; week?: number }
| { t: 'approve'; orderId: string; week?: number; ship?: 'boat' | 'flight'; buy?: BuyChoice }   // extended
| { t: 'approveReq'; reqs: string[]; buy?: BuyChoice; week?: number }
| { t: 'deferReq'; req: string; week?: number }
| { t: 'buy'; lines: { item: ItemId; qty: number }[]; buy?: BuyChoice; week?: number }
| { t: 'setStock'; item: ItemId; rop: number | null; max: number | null; week?: number }
| { t: 'returnCore'; core: string; week?: number }
| { t: 'calibrate'; item: ItemId; week?: number }
| { t: 'scrap'; item: ItemId; qty: number; week?: number }
| { t: 'spendBudget'; trade: 'mech' | 'elec' | 'build'; amount: number }
// staff (package D, section 15.5): hire, letGo, raise, staffAsk, staffAnswer, build
```

| Action | Who | Allowed when (else the error) | Effect |
| --- | --- | --- | --- |
| `plan` | the alert's trade | week ≥ 1 (*"The week has not started yet."*); alert open, not a job (*"That alert is not open."*); `role === alert.role` (*"Not your trade."*); the task is in `tasksFor(asset, role)` (*"That task isn't in the manual set for {asset}."*) and has a kind (*"That's reference only: pick the task that does the work."*); a repair alert's task is its repair task; every item exists and is this trade's (*"Unknown item {id}."*); 1–6 lines, quantities 1–50; `research` only on a plane task with an IPC slot | Creates the job (8.1), reserves stock, raises requisitions for the shortfall, prices the card (8.3), auto-approves on petty cash when it can (8.4). `research`: opens the part chain at research for this job (13), or queues it behind the open one. The alert becomes `job`. |
| `nff` | the alert's trade | alert open, not a job; not a repair, `due`, `ad`, `code` or `takeoff` alert (*"There's a known task for this one."*) | Closes the alert `nff`. On a real fault: a hidden comeback (`flow:nff` defect, due in 1–2 weeks) re-raises it (5.5). |
| `mel` | mechanic | a plane, the symptom has an MEL category for this model (*"No MEL relief for that on {plane}."*), not already placarded, the alert not done | `alert.mel = { cat, until: week + (C ? 2 : 1), by }`. The plane flies on it until then. |
| `makeSafe` | electrician | a hazard alert, not made safe, not done | `alert.safe = { how, week, by }`. A blank-off draws a PLATE-BLANK if one is on hand (not required). The house rents at ×0.75 until fixed. |
| `askBench` | mechanic | the alert has `bench`, no call yet, no check open | A `bench` order for the electrician (ready, no cost), `Order.bench = alertId`. |
| `repick` | the job's trade | a flow job, not done or cancelled | Releases its reservations, cancels its requisitions not yet ordered (ordered ones arrive into stock unreserved), then reserves and requisitions the new pick. A pending card is re-priced; an approved job keeps its labour paid and its new requisitions go to the analyst's queue (or petty cash). Clears `flow.stop`. |
| `dropJob` | the job's trade | a flow job, not done | Releases, cancels unordered requisitions, the job `cancelled` (labour already paid stays paid), the alert back to `open`. |
| `request` | mechanic or electrician | the item is this trade's; 1–50 | A stock or tool requisition (no job). Never petty cash: the analyst's call. |
| `cancelReq` | its requester or the analyst | the requisition is `open` | `cancelled`; a job it served is re-evaluated. |
| `approve` (flow card) | analyst | as today (freeze under $2,000 except safety-critical: `isEmergency` now also counts a job whose alert grounds a plane or closes a house; receivership blocks over $800 except safety-critical) | Charges labour, places the job's open requisitions on POs (the `buy` choice, default: the item's default supplier, scheduled; a job whose alert grounds a plane or closes a house defaults to AOG), job → `waiting_part` or `ready`. XP +10 as today. |
| `approveReq` | analyst | the requisitions are `open`; the same freeze and receivership rules | Places them on POs (grouped by supplier). |
| `deferReq` | analyst | `open`, not deferred this week | `deferredWeek = week`; XP +10. |
| `buy` | analyst | 1–12 lines; not under the freeze (*"Cash under $2,000: stock orders are frozen."*); cash covers it | A stock PO (`by: 'fin'`). Quantities round up to whole packs. |
| `setStock` | analyst | 0 ≤ rop < max ≤ 500 units, or both null | Sets or clears the item's min/max. |
| `returnCore` | analyst (autopilot too) | the core is `owed` | `sent`; credited at the resolve (15% come back beyond economical repair: half the deposit). |
| `calibrate` | analyst | a calibrated tool, owned, not away | Away until this week's resolve (`out = week`), `cal = week + 1 + calEvery`, fee charged. |
| `scrap` | analyst | qty ≤ unreserved on hand | Returnable (parts, rotables, materials, tools; not expired): 75% of average cost credited. Consumables and expired lots: written off. |
| `spendBudget` | analyst | 0–20,000, step 50 | The weekly spend budget for that trade (display: budget vs actual). |
| `squawk` (changed) | mechanic or electrician | as today (one write-up a week, the kind applies to the asset, not already open) | Instead of an order, raises an alert with `src: 'finding'`, `kind` = the kind written up, `sym` = `W_{kind}` (*"Written up by Seb: brake linings worn"*, one line per catalog kind in `SYMPTOMS`), due in 2 weeks. The flow opens at the Manual step with that kind's task for the asset pre-filled (the tech confirms it, as for a `due` alert). |
| `tag` (unchanged) | mechanic or electrician | as today | A safety call still takes the asset out of service for the week; an open alert on it doesn't roll deferral risk that week. |

Order and requisition timestamps: `Order.at?: number` and `Requisition.at?: number` (ms, the `now` of the action) so the resolve can tell a card that came in after the analyst ended the turn (8.5).

## 8. The flow on orders

### 8.1 The job a plan creates

```ts
newOrder(s, {
  role, kind: task.kind /* 'repair' for a repair */, assetId: alert.assetId,
  title: CATALOG_BY_KIND[kind].title /* today's short title, "Tire and brake" (the card and the detail show the task beside it); a repair: its rule's fix title */, puzzle: puzzleFor(task) /* the catalog kind's puzzle; ignition and repairs by their job */,
  tier: orderTier(kind, asset, s.tier) /* a repair: its defect's tier */,
  cost: laborCost(...) /* 8.3 */, parts: 0, gain: CATALOG_BY_KIND[kind].gain /* a repair: addRepair's formula */,
  job: task.job ?? kind, status, at: now,
  flow: { alert: alert.id, task: task.id, pick, bench, reqs, bom },
  ...(repair ? { repair } : {}),
});
```

Everything downstream is today's machinery: `launchFor` (with the task's `job`, so `manualCard` prints the chosen task's card), blind sign-off, hidden defects, repairs and redos, lend-a-hand (for a flow job that has waited a week: the helper plays the puzzle with the parts already reserved), the chain.

### 8.2 Statuses

| Situation after `plan` | Status |
| --- | --- |
| Nothing to buy and no labour | `ready` |
| Something to buy or labour > 0, covered by petty cash | approved at once: `waiting_part` (POs) or `ready` |
| Otherwise | `pending` (a card on the analyst's desk) |
| Approved, waiting on POs, a held PO, a tool, or the research branch | `waiting_part` |
| Receiving sent a line back, or the install stopped (`flow.stop`) | `waiting_part` until the tech repicks |

Deferral risk keeps today's rules: `pending` cards carried a week roll it (the analyst's call), `waiting_part` doesn't.

### 8.3 Labour: the card costs what it costs today

```ts
export const kitValue = (tier: number) => round10(340 * (1 + 0.1 * (tier - 1)));   // today's auction fair value
export function laborCost(s: IslandState, kind: string, task: Task, asset: Asset, site?: ElecSite | null): number {
  const c = CATALOG_BY_KIND[kind];
  const ac = asset.kind === 'plane' ? islandAircraft(s.seed, asset) : null;
  const old = orderCost(kind, orderTier(kind, asset, s.tier)) + (c?.parts ? kitValue(s.tier) : 0);
  const std = bomValue(s, [...stdPick(s, asset, task, site), ...benchFor(task, ac, asset)]);
  return round10(Math.max(LABOR.min[task.id] ?? LABOR.minDefault, old - std));
}
```

- `stdPick` is the right pick for this asset (the effective P/N at the right quantity; the site's right devices; exchange for rotables); `bomValue` prices lines at the island tier (default supplier, exchange price for rotables, cores not counted: they come back).
- `LABOR.min` (tune): mechanic $85/h, electrician $75/h × hours: 32-40-01 2, 32-40-02 2.5, 32-40-03 3, 32-42-01 1.5, 29-10-01 1.5, 61-10-01 2, 61-10-02 0.75, 23-10-01 1, 24-30-01 3, 24-30-02 1, 72-30-01 8, 72-00-01 4, 74-20-01 2, 74-10-01 3, 57-10-01 4, 79-00-01 1, 05-20-01 0.6, gsm 2; outlet 1, gfci 1, 3way 1.5, inspect 1, storm 8, flicker 1, spa 6, feeder 4, panel 16, deadckt 1.5, dock 5, xfer 6, gentest 1.5. `LABOR.minDefault` $50.
- A test checks every task × model × island tier 1–5: labour + the standard parts is within 0.85–1.25 × `old`. Where it isn't, tune the item's price inside a believable range, or `LABOR.min`.
- Repairs: `labour = max(minDefault, today's repair cost − the repair's standard parts)`.
- A pick that isn't standard costs what it costs: an exchange unit instead of new, a broker's price, a spare part nobody needed. Labour doesn't change.

### 8.4 Petty cash (auto-approval) at plan time

The existing budgets become each trade's supply-house account. A card is approved at once, by the trade itself, when all hold:
- `autoSpent[role] + labour + parts to buy ≤ autoBudget[role]` (parts priced at the default supplier, scheduled freight);
- the job's tier ≤ 2, or the card's total ≤ $150;
- `cash − total ≥ ECON.freezeBelow`; not in receivership above $300;
- no AOG freight (the AOG boat is always the analyst's call, or autopilot's).

It is today's `autoApprove` rule with parts allowed, applied when the card appears instead of only at week open. The week-open `autoApprove` still runs for cards carried over.

### 8.5 Standing approvals at the resolve

Step 1b of `resolveWeek` (today's `leftoverChainCard`, widened): a flow card or a job's requisition created after the analyst ended the turn (`at > turns.fin.endedAt`), not deferred, goes through if petty cash covers it, or if its job grounds a plane or closes a house and cash covers it with AOG freight. The review says so: *"Cy had ended the turn when the parts for Tire and brake on Twin N-12 came in: they went through on the standing approval ($660, next flight)."* Anything else waits for next week (and rolls deferral risk from then, as any pending card).

### 8.6 What the card shows (package C draws it, A computes it)

```ts
export function cardOf(s: IslandState, o: Order, buy?: BuyChoice): {
  labour: number;
  fromStock: { item: ItemId; qty: number; value: number }[];      // already paid
  toBuy: { item: ItemId; qty: number; unit: number; cond?: 'new' | 'exch'; core?: number; supplier: SupplierId; eta: number }[];
  freight: number; total: number;                                 // total = cash out on approval (labour + to buy + freight; cores included, flagged refundable)
  aog: boolean;                                                   // the job grounds a plane or closes a house
  downtime?: { flights: number; usd: number };                    // a grounded plane's week (today's downtimeOf)
  due: number; mel?: { cat: 'B' | 'C'; until: number };
};
```

### 8.7 Start, the install check, and sign-off

```ts
// src/sim/flow.ts (A)
export function installCheck(s: IslandState, o: Order): { stop: string; research?: boolean } | null;
export function pickCheck(s: IslandState, alert: Alert, task: Task, pick: { item: ItemId; qty: number }[], tier: number): string[];  // tiers 0–1 only: warnings before commit (6.4); [] at tier 2+
export function stdPick(s: IslandState, asset: Asset, task: Task, site?: ElecSite | null): { item: ItemId; qty: number }[];         // the right pick (labour, bots, autopilot, migration, tests; never shown by the UI)
```

- `installCheck` is what a tech finds when the job starts and the box is opened: a mechanic line in an IPC slot that `judgePart` calls `wrong` or `unlisted` (*"066-19500 isn't the lining this brake takes: the IPC lists 066-19600 for S/N 310R0431"* at tiers ≤ 2; *"The linings don't fit the brake: check the IPC"* at tier 3+), `displaced` (`research: true`: *"The brake on this airplane isn't the one in the IPC: it was altered. Research the records."*), a slot short on quantity (*"Two linings short: the AMM does both brakes."*), an electrical line in the wrong category for its slot, a required tool not owned or away for calibration. `noteff` and wrong heat range do **not** stop: the part fits, and the mistake surfaces later (11.2).
- The tech's Start button (B) runs it first. A stop shows the stop sheet instead of the puzzle, with **Repick** (the Parts step, the stop text on top) and, for `research`, **Research the records ▸** (a `repick` with `research: true`). No action is written until the tech repicks.
- `complete` on a flow job runs it too (a bot, a stale tab): on a stop the result is dropped, `flow.stop` is set, the job goes to `waiting_part`, pulled units stay in stock, and the feed says *"Work stopped at the install on Twin N-12: …"*. It is not an error.
- At a sign-off (score ≥ `SIGNOFF`, or blind): `consume`, tools lose a use, the alert closes `fixed`, then the defect checks in this order, and only the first plants a sure defect: wrong task (11.1), `ipc:noteff` and `ignition:heat` (11.2), `judgeElecPick` (11.3), `cal` (4.3). Today's quality roll on the score runs as well; a sure defect replaces its defect, never adds a second one.
- The puzzle's launch (`launchFor`, A) passes `context.pick` (the job's lines with `pn`, `nomen`, `spec`) and the chosen task's card (`context.card` from `manualCard` keyed by the task's `job`), so the puzzle works to the task the tech chose.

## 9. Inventory and purchasing mechanics

`src/sim/stock.ts` (A). All numbers in `STOCK` (data.ts, tune): `perTier` 0.1, `carry` 0.005 per week of inventory value, `restock` 0.15 (min $40, today's `CHAIN.restock`), `returnCredit` 0.75, `coreWeeks` 4, `coreBer` 0.15, `autopilotCap` $800 a week, `keepWeeks` 2 (closed POs and requisitions kept for the invoice puzzle and the UI), `ledgerWeeks` 26.

```ts
export const available = (s: IslandState, item: ItemId) => (s.inv?.[item]?.on ?? 0) - reservedOf(s, item);
export function onOrder(s: IslandState, item: ItemId): { qty: number; eta?: number };   // open and held POs
export function reserve(s: IslandState, order: string, lines: { item: ItemId; qty: number }[]): { item: ItemId; short: number }[];
export function release(s: IslandState, order: string): void;
export function consume(s: IslandState, order: string, asset: string | null): number;   // at sign-off: reserved units leave stock (FIFO lots); returns the value, books the ledger
export function placePo(s: IslandState, lines: PoLine[], buy: BuyChoice, by: Role | 'auto', now: number): PurchaseOrder;  // cash out, ledger
export function receive(s: IslandState, W: number, carrier: boolean, line: Liner): void;          // resolve step 3
export function replenish(s: IslandState, W: number, line: Liner): void;                          // resolve step 11b
export function carryCost(s: IslandState): number;
export function expire(s: IslandState, W: number, line: Liner): void;
export function invValue(s: IslandState): number;
```

### 9.1 Reservations

A plan reserves what is available for its job (first come, first served: two plans for the last unit, the second gets a requisition). Reserved units are counted in `on` and listed in `res[order]`; `available` excludes them. A reservation is released by `repick`, `dropJob`, a cancelled job, or migration clean-up; consumed at sign-off. A job sent back for rework (`isRework`), a botched lend-a-hand, or a job stopped at the install keeps (or returns) its units unconsumed: nothing leaves stock until a sign-off.

### 9.2 Receiving (resolve, step 3; replaces the kit delivery)

For each PO with `eta ≤ W` (in id order), if a carrier flew (a cargo flight from tier 2, a guest flight at tier 1) or its freight is AOG, or it is `held` with `hold ≤ W`:
1. **Paperwork** (aircraft parts and rotables, not consumables): with the supplier's rate (OEM 5%, broker 25%) the lines come without their 8130-3 (or with an 8130-3 whose S/N doesn't match the unit's plate): `held`, `hold = W + 1`, review line *"Receiving: 2 lines on PO po14 came without their 8130-3s: quarantined until the vendor sends the paperwork (next week)."* (today's chain wording).
2. **Supersession**: a line whose item the IPC prints as superseded by code 1 or 2 ships as the superseding P/N (*"shipped as 066-19600 (supersedes 066-19500)"*). Code 3 ships as ordered.
3. **Against the work order** (a mechanic line bought for a job): `judgePart(ac, ata, tag, pn)` for that job's airplane. `wrong`, `unlisted`: sent back (credit the paid price less `STOCK.restock`), the job gets `flow.stop` with the reason and waits for a repick. `displaced` (the IPC part for an assembly an alteration replaced): sent back the same way, and the research branch opens (13). `noteff`: passes receiving (the P/N is in the book); it installs, and leaves a sure defect (11.2).
4. **Into stock**: `on += qty`, lots for shelf-life items, average cost updated, a job's lines reserved to it, requisitions `filled`, exchange units add to `owe`. A job with everything reserved (and its tools home) becomes `ready`: feed and push *"Parts for Tire and brake on Twin N-12 are in: Seb, your move."*
5. **Online backorder** (10%): the line splits off with `eta + 1`.
6. **Nothing flew**: scheduled POs slip a week (review line). A slipping PO that carries a line for a job whose alert grounds a plane or closes a house takes the boat instead (`FREIGHT.aog`, booked as freight), as today's "a mainland boat brings the most urgent kit".

### 9.3 Replenishment (resolve, step 11b)

For each item with `rop`/`max`: if `available + onOrder ≤ rop`, order `max − (available + onOrder)` rounded up to packs, from its default supplier, scheduled, one PO per supplier (`by: 'auto'`). Skipped under the freeze (review line *"Replenishment skipped: cash under $2,000."*). This is the analyst's standing policy; it runs whether or not the analyst played.

### 9.4 Carrying cost, shelf life, cores, tools, credit, dead stock

- **Carrying cost**: `round(STOCK.carry × invValue)` cash at every resolve (26% a year: capital, space, insurance, shrinkage). Review line and `costs.carry`.
- **Shelf life**: lots older than `shelf` weeks are scrapped at the resolve (unreserved units first). If that eats into a job's reservation, the job gets a new requisition for the shortfall and waits. Review line *"3 kits of MIL-PRF-81733 sealant expired on the shelf ($144)."*
- **Cores**: a rotable installed from an exchange unit (`owe > 0`) creates a `Core` (`due = W + 4`, value = the deposit at the island tier). `returnCore` sends it; the next resolve credits it (15% beyond economical repair: half). Past due unreturned: forfeit (loss). Autopilot returns cores for an absent analyst.
- **Tools**: 4.3. Calibration fees and tool purchases are booked as capex (`tools`, `calibration`).
- **Store credit** (`s.credit`, from migration): applies automatically to the next POs until used up (the PO's cash out is reduced; the ledger shows spend at full value and the credit used).
- **Dead stock** (derived, `usableOnIsland(s, item)`): a mechanic part no airplane on the island takes (its IPC rows effective for none of them and no EA), or stock with no movement for 8+ weeks. Flagged in the planner; `scrap` returns it for 75% (or writes it off).

## 10. MEL, make safe, AOG and closed houses (`econ.ts`, A)

```ts
export function alertAog(s: IslandState, planeId: string, week = s.week): Alert | undefined;   // an open or planned (not done) airworthiness alert on it, due ≤ week, not under an MEL placard that runs to ≥ week
export const isAog = (s, id) => chainAog(s, id) || !!alertAog(s, id);                         // chainAog: today's rule, but a chain opened from the flow (`PartChain.flow`) doesn't ground by itself
export function hazardOn(s: IslandState, houseId: string): Alert | undefined;                   // an open or planned hazard alert on it
export function rentFactor(s: IslandState, h: Asset): number;                                   // 0.75 while a made-safe hazard is open on it, else 1
// houseBlocker: 'hazard' when hazardOn and not made safe (so houseRentable is false); projectWeek and resolveWeek multiply the house's rent by rentFactor
```

- The review names it: *"Twin N-12 AOG: left brake pedal soft (due week 7, not fixed)."*, *"Cottage 2 closed: a guest felt a tingle at the shower valve (make it safe or fix it)."*, *"Cottage 2 rented at 75%: the bathroom circuit is off and tagged."*
- An MEL placard past its limit grounds the plane: *"Twin N-12's MEL C for com 1 ran out in week 11: grounded until the radio is replaced."*
- `downtimeOf` loses the kits: the cargo plane down costs the AOG boat for any scheduled PO due that week (else nothing).
- The island shows an alert-AOG plane at its AOG spot on jacks (today's art for a chain AOG) and a closed house with its no-entry bubble; a made-safe house shows a small tag bubble (package D owns island art; A only exposes `alertAog` and `hazardOn`).

## 11. Wrong choices surface later (the consequences)

All through the existing machinery: `s.defects` (hidden, `dueWeek`, found by an inspection in scope, or surfacing as an incident traced to the signer), repairs and redos, receiving returns with the restocking fee. New `DEFECT_RULES` rows (A, data.ts) are listed with their words. `sure: true` rows always plant a defect; its severity follows the true score (`defectSeverity`), as today.

### 11.1 Wrong task

At sign-off of a flow job whose task is not in `fixesOf(alert)` (and the alert's cause is a real fault): a sure defect `{ puzzle: 'flow', variant: 'task', alert: { alert, sym, kind }, job: the job's kind, dueWeek: W + 1..2, severity 1 }`. The job's own gain still lands (the work was done), its parts are consumed.
- It surfaces as a minor incident (1.2 × the job's labour, today's `incidentMult[0]`) with the symptom's words, *"Pilot wrote up the same soft brake pedal on Twin N-12: the linings were replaced, the air is still in the line."* and **re-raises the alert** (`src: 'again'`, due now, same cause). No repair or redo: the fix is the right task.
- An inspection in scope finds it first: the alert is re-raised as `finding`, no incident.
- Rule `flow:task`: incident [`"{a}: the same fault is back ({symptom}): the last job didn't fix it"`, same], found `"the fault the last job didn't fix"`, fix: none (re-raise).
- Planning a job on an NFF alert: no defect (the parts and labour were wasted; the gain lands as preventive work).
- `flow:nff` (an NFF close on a real fault) works the same way: re-raise, no incident.

### 11.2 Wrong part (mechanic)

| What | Caught | Consequence |
| --- | --- | --- |
| Not this item, not in this airplane's IPC, or the IPC part for an assembly an alteration replaced | bought for the job: at receiving; pulled from stock: at the install (sign-off) | Receiving: returned for credit less 15% (min $40), the job waits for a repick (`displaced`: the research branch opens). Install: the job isn't signed off (*Work stopped · wrong part*, like today's chain stop), the unit goes back to stock unconsumed, `flow.stop` says why. Nothing hidden. |
| Not effective for this S/N or SB status (a legal P/N in the book, the wrong block or a code-3 part without its set) | nobody, at the time | Installs; sure defect `ipc:noteff`: [`"A records review of {a} found a part installed that isn't effective for its S/N: it has to come off"`, `"A part not effective for {a}'s S/N or SB status failed in service"`], found `"a part installed that isn't effective for this airplane"`, fix: teardown *"Replace it with the effective part"* (the repair alert's parts step picks it). |
| Short on quantity (2 linings where the AMM does both brakes: 4) | the install | Work stopped: *"Two linings short: the AMM does both brakes."* The job waits for a repick. |
| Wrong spark plug heat range (the float's FH-M40B in the twin, or the other way) | nobody | Sure defect `ignition:heat`: [`"Engine monitor on {a}: #3 CHT spiking on the climb (plugs of the wrong heat range)"`, `"Preignition on {a}: a piston holed on the climb, engine failure, forced landing"`], fix: teardown `cylinder` *"Replace the damaged cylinder and fit the approved plugs"* (cost 1.5). |
| An unapproved ICA part on a logbook entry (the research branch's `entry` route) | nobody | Today's `ipc:unapproved`. |
| Extra or unneeded parts | nobody | Consumed: dead money only. |

### 11.3 Wrong materials or device (electrician)

`judgeElecPick(task, site, lines): { ok: true } | { ok: false; variant: string; text: string } | { stop: string }` (in `src/sim/flow.ts`). A line in the wrong category for its slot (a switch in the GFCI slot) stops the install like a mechanic's wrong part (no defect). Otherwise the first rule that fails plants a sure defect `{ puzzle: 'elec', variant }`:

| Variant | Fails when | Incident [minor, severe] | Found by an inspection | Repair (puzzle · job) |
| --- | --- | --- | --- | --- |
| `oversized` | the breaker is larger than the conductors allow (240.4(D), Table 310.16 at 75 °C) | "Callback from {a}: a circuit smells hot, its breaker oversized for the wire" · "An oversized breaker at {a} let the branch wire overheat: scorched insulation in the wall" | a breaker oversized for its wire | wireup · outlet: "Replace the scorched run and land it on the right-size breaker" |
| `undersized` | conductors too small for the circuit or load (14 AWG on 20 A; 8 AWG on a 60 A spa); a transfer switch smaller than the backed-up load (702.4(B)); a 50 A spa panel on a 60 A tub | "Callback from {a}: the {what} trips under load" · "The undersized {what} at {a} overheated: scorched insulation, the circuit dead" | undersized conductors or equipment | conduit or wireup, by job: "Replace it with the right size" |
| `nogfci` | a GFCI-required location without GFCI protection (210.8(A), 680.44), including a replacement (406.4(D)(3)) | "A guest at {a} felt a tingle from the {room} receptacle: no GFCI on it" · "A guest at {a} got a shock in the {room}: no GFCI protection" | a receptacle with no GFCI protection where the code needs it | wireup · gfci: "Fit GFCI protection and test it" |
| `noafci` | an AFCI-required room (bedroom, living, kitchen, laundry) replacement without AFCI protection (210.12(A), 406.4(D)(4)) | "The code inspection at {a} wrote up a receptacle replaced without AFCI protection" · "An arcing fault in a wall at {a} scorched a box: no AFCI on the circuit" | a replacement with no AFCI protection | wireup · outlet: "Fit AFCI protection and re-terminate" |
| `notr` | a receptacle that isn't tamper-resistant in a dwelling or guest room (406.12) | "The code inspection at {a} wrote up non-tamper-resistant receptacles" · "A child at {a} pushed a hairpin into a receptacle: a burn, the guests moved out" | receptacles that aren't tamper-resistant | wireup · outlet |
| `nowr` | outdoors without a WR receptacle and an in-use cover (406.9(B)(1)) | "The porch receptacle at {a} is corroded and tripping after the rain" · "Rain got into the porch receptacle at {a} (no in-use cover): it faulted and scorched the box" | an outdoor receptacle not rated or covered for a wet location | wireup · outlet |
| `rating` | a 15 A single receptacle on an individual 20 A circuit (210.21(B)(1)) | "The microwave's plug at {a} runs warm: a 15 A receptacle on a 20 A circuit" · "The 15 A receptacle at {a} overheated under the microwave" | a single 15 A receptacle on a 20 A circuit | wireup · outlet |
| `wetnm` | NM-B in a wet location or a buried raceway (334.12(B)(4)) | "The insulation test on the run at {a} is falling: NM-B in a wet location" · "NM-B in a wet run at {a} faulted to ground: the circuit dead" | NM-B cable in a wet location | conduit · stub: "Pull THWN-2 (or UF-B) and replace the run" |
| `boxfill` | the box is smaller than its conductors need (314.16: two 12/3 cables and a device need 20.25 in³) | "Callback from {a}: a switch plate is warm, the box crammed" · "Crammed conductors at {a} nicked and faulted in the box" | an overfilled box | wireup · switch3: "Fit a deeper box and re-terminate" |
| `noseal` | the classified section at the fuel dispenser not in RMC with a seal fitting (514.8, 514.9, 501.15) | "The fire marshal's inspection of the fuel dock wrote up the conduit: no seal at the dispenser" · "Fuel vapour came up the unsealed conduit at the fuel dock: a flash in the junction box, the dock closed" | a classified run without its seal | conduit · offset: "Re-run the dispenser section in RMC with a seal fitting" |
| `cal` | (not a pick) a torque or test tool past its calibration was used (4.3): +0.15 defect chance, this variant | "A lug at {a} torqued with an out-of-calibration driver worked loose" · "A lug at {a} torqued with an out-of-calibration driver arced and dropped the circuit" | a lug below its torque value | meter: "Find the loose lug and re-torque it" |

Rule order: category stop, then `nogfci`, `noafci`, `oversized`, `undersized`, `rating`, `notr`, `nowr`, `wetnm`, `boxfill`, `noseal`. `stdPick` for a site passes all of them (a test enumerates every site the generators can make).

### 11.4 Everything else

| Wrong choice | What happens |
| --- | --- |
| An MEL placard left past its limit | the plane is AOG until fixed |
| A hazard not made safe | the house is closed until it's made safe or fixed |
| An NFF close on a real fault | it comes back in 1–2 weeks, due now (11.1) |
| An alert ignored past due | deferral risk (5.5); a plane with an airworthiness alert goes AOG instead |
| The electrician's bench call wrong | today's `meter:unit` / `meter:wiring` / `meter:radio` |
| Stocking the wrong things | dead cash: carrying cost every week, expiry, a 25% loss to send it back |
| Buying from the broker | cheaper, a week slower, and one line in four sits a week in quarantine without its 8130-3 |
| No cores returned | the deposits are forfeit after 4 weeks |

## 12. The week, in order (`engine.ts`, A; staff hooks D)

**`openWeek`** (after today's first steps: weather, turns, modifiers, tags, story):
1. `generateAlerts(s, r, now)` (replaces `generateOpsOrders`; `wb` and `gpustart` still direct orders)
2. `generateFinTasks` (the auction task now names a lot: 17.3)
3. `generateReports` (unchanged)
4. `autoApprove` (carried cards: petty cash, as 8.4)
5. heal the open chain (unchanged); `rollWeakBattery` (unchanged)
6. `staffOpenWeek(s, r, now)` (D: this week's hiring board)

**`resolveWeek`**:
0. `settleBlind` (unchanged)
1. autopilot for missed seats (18.3), 1b. standing approvals (8.5; today's `leftoverChainCard` stays for chain cards)
2. flights: capacity per plane with `isAog` (alerts included), then `pilotCap(s)` and `turnaroundLoss(s)` (D) cap the fleet's total (flights come off cargo first, so guests keep flying); weak battery (unchanged); `staffAfterFlights(s, flown, r, W, line)` (D: hard landings and tows: wear, and `M_HARD_LANDING` / `M_TOW` alerts for next week)
3. `receive(s, W, carrier, line)` (9.2; the chain's own part keeps its rules)
4. power (unchanged); `cartsHome(s, r, line)` (D: the line crew puts carts back on the charger) before `chargeCarts`
5. houses and guests: rentable with hazards, `rentFactor`, `housekeepingCap(s)` (D) caps bookings, `reviewMult(s)` (D) multiplies occupancy
6. charter (unchanged)
7. deferral risk (unchanged) plus unplanned alerts past due (5.5)
7b. hidden defects surface (plus `flow:*` re-raises)
8. carry-over (unchanged for orders); alerts: prune closed ones older than `ALERTS.keep` weeks; 8b. the chain (unchanged plus 13)
9. decay and storm: house and grid storm damage and the storm claim × `stormMult(s)` (D)
10. money hunts (unchanged), 10b. reports (unchanged)
11. cash: revenue − overhead (`TIERS[tier].overhead`) − `payroll(s)` (D) − premium − leaks − reports − incidents − loan − power − `carryCost(s)`; 11b. `expire`, `replenish`, cores (credit / forfeit), tools back from calibration; 11c. `buildWeek(s, r, W, line)` (D: builders progress and draw materials from stock), `staffWeek(s, W, line)` (D: morale, notices, leavers)
12–18. unchanged (forecasts, grade, stats, XP, tier-up, story, MVP), with `costs.overhead`, `costs.payroll`, `costs.carry`, `costs.freight`, `costs.labor`, `costs.parts` in the report. Step 16's `finishProjectIfDone` also needs `fitoutDone(s, tier)` (D; stub `true`): a crew project whose three parts are done waits for the builders (*"Tier 4 is waiting on the builders: Villa East and Villa West need 1.5 more weeks of work."*), and the tier arrives at the first resolve where both are done
19. the ledger's week closes (revenue, cash, inventory value), trimmed to 26 weeks; then `openWeek`

## 13. The part chain as a branch of the flow

The Phase B chain (`src/sim/chain.ts`, `engine.ts` "Part chain") keeps its machinery: its steps, its cards (`part`, `eng`), the AOG boat or guest-flight freight choice, receiving with the 8130-3 roll and quarantine, restocking returns, engineering's answer, `ipc:unapproved`, the story in the review.

- **Entry from the flow.** `plan` or `repick` with `research: true` (the tech's *Not in the IPC · research the records*), or receiving that sends back a `displaced` part, opens the chain at **research** for that job: `PartChain` with `orderId` = the flow job, `flow: true` (new optional field: it doesn't ground the plane by itself; the alert does, if it is an airworthiness one), `ata` and `tag` from the task's IPC slot, `item = itemName(tag, model)`, `found` = the symptom text, step `research` (`researchStep`). The job waits (`waiting_part`, `o.chain = { id, step: 'job' }`). When a chain is already open, the job queues (`flow.queued`), and the research opens when that chain closes (checked at every resolve and every close).
- **Exit.** The chain's part comes by its own freight and receiving; at `install` the job is `ready` with the chain's part plus its bench lines from stock. When engineering approved it (`src: 'eng'`), closing the chain records `s.eas.push({ assetId, ata, tag, pn, ea: 'EA yy-nnn', week })` (the number from `hashSeed`, formatted like aircraft.ts `eaNo`). From then on the IPC index shows that ICA part as a normal row *"EA 26-104 · KA-66-19HD LINING, METALLIC (Kestner)"*, `judgePart` already accepts it, and it can be stocked like any other item: no second research on that airplane.
- **The random trigger stays** (a sign-off finds damage the job couldn't finish without: the plane is apart, so it is AOG). For flow jobs it fires only on 32-40, 61-10 and 29-10 (the flow covers electrical units, 5.4), at `CHAIN.flowChance` 0.15 (new, tune: the flow already brings part waits). Legacy orders keep today's rule and `CHAIN.chance` 0.3, so `tests/chain.test.ts`, `bench.test.ts`, `chaingse.test.ts` and `chainmoney.test.ts` keep building their chains the way they do.
- **`crossMoves`** keeps listing the chain; a flow-opened chain's banner says *"Research: the {item} on {plane} isn't in the IPC"* and doesn't say AOG unless the alert grounds it.

## 14. Finance tracking (A computes, C draws)

The owner: *"make the analyst be able to track finances more closely too just in passing so we can plan. so i can see which parts we move over time quickly vs slowly"*. Only the weekly aggregates in 2.5 are stored; everything below is derived from them, the stock lines, the open POs and `history`.

### 14.1 Recording (`src/sim/ledger.ts`, A)

```ts
export function ledgerRow(s: IslandState, W = s.week): WeekLedger;   // this week's row, created on first use
export function book(s: IslandState, cat: SpendCat, usd: number, o?: { trade?: 'mech' | 'elec' | 'build' | 'fin'; asset?: string | null }): void;
export function bookUse(s: IslandState, item: ItemId, qty: number, value: number, asset: string | null): void;
export function bookRcv(s: IslandState, item: ItemId, qty: number): void;
export function bookLoss(s: IslandState, usd: number): void;
export function bookFill(s: IslandState, filled: number, lines: number): void;
export function closeLedger(s: IslandState, W: number, revenue: number): void;   // resolve step 19
```

| Event (caller) | What it books |
| --- | --- |
| `placePo` (stock.ts) | each line at the price paid, to `parts` / `consumables` / `rotables` / `materials` / `tools` / `building` by the item's kind and trade; freight to `freight`; core deposits to `cores`; trade = the item's trade (`build` for building materials); store credit used to `cr` |
| a flow card approved (engine) | its labour to `labor`, trade = the job's, and to `as[asset]` |
| `consume` at a sign-off (stock.ts) | `use[item] += qty`; `as[asset] += value` at average cost |
| builders draw a unit (D, through `takeStock`) | `use[item] += qty`; `as['build:' + id] += value` |
| `receive` (stock.ts) | `rcv[item] += qty` |
| `plan` (engine) | `fill`: lines covered from stock at plan time / lines planned (bench lines count) |
| resolve step 8 (engine) | `wait += 1` for every job `waiting_part` on a requisition, a PO or a tool |
| resolve step 11 (engine, D's `payroll`) | `overhead`, `payroll`, `carry`; credits (scrap, receiving returns) as negative amounts in their own category; core refunds as negative `cores` |
| expiry, write-offs, forfeited cores | `loss` (value, no cash) |
| calibration fee, engineering fee | `calibration` (trade elec) / `eng` (trade mech) |
| resolve step 19 | `rev`, `cash`, `inv = invValue(s)`; rows older than 26 weeks dropped |

The ledger doesn't copy what `history` already holds (insurance, incidents, refunds, leaks, the loan, power); the series in 14.2 merge the two.

### 14.2 Derived analytics (pure; memoized per state object with a `WeakMap`)

```ts
// src/sim/stock.ts
export type Velocity = {
  item: ItemId;
  series: number[];          // units used per week, the last 12 weeks, oldest first (0 where nothing moved)
  perWeek: number;           // mean of the last 8 weeks
  sd: number;                // standard deviation of the last 8 weeks
  lastMove: number | null;   // last week it was used or received
  turns: number;             // annualized: 52 × (value used over the last 8 weeks ÷ 8) ÷ the item's inventory value (0 with none on hand)
  dos: number | null;        // days of supply: available ÷ perWeek × 7 (null when perWeek is 0)
};
export function velocity(s: IslandState, item: ItemId): Velocity;
export type MoveClass = 'fast' | 'slow' | 'dead' | 'new';
export function moveClass(s: IslandState, item: ItemId): MoveClass;
export function abc(s: IslandState): Record<ItemId, 'A' | 'B' | 'C'>;
export function knownDemand(s: IslandState, item: ItemId): { week: number; qty: number; why: string }[];
export function forecast(s: IslandState, item: ItemId, h?: number): { base: number[]; known: number[] };   // h = 4 weeks
export function suggestRop(s: IslandState, item: ItemId): { rop: number; max: number; why: string };
export type StockFlag = { item: ItemId; kind: 'order' | 'stop' | 'expiring' | 'norop' | 'core' | 'cal'; text: string; urgent: boolean };
export function stockFlags(s: IslandState): StockFlag[];
export function onOrderValue(s: IslandState): number;
export function auctionLot(s: IslandState, r: Rng): { lines: { item: ItemId; qty: number }[]; fair: number; list: number } | null;   // 17.3
export function invoiceContext(s: IslandState): PuzzleContext['invoice'] | undefined;                                                 // 17.3
// src/sim/ledger.ts
export type OutCat = 'parts' | 'labor' | 'freight' | 'carry' | 'payroll' | 'overhead' | 'tools' | 'insurance' | 'incidents' | 'other';
export function spendSeries(s: IslandState, weeks?: number): { w: number; rev: number; out: Record<OutCat, number>; cash: number }[];   // 12 by default
export function tradeSpend(s: IslandState, weeks?: number): Record<'mech' | 'elec' | 'build' | 'fin', number>;                          // 4
export function assetSpend(s: IslandState, weeks?: number): { asset: string; usd: number }[];                                          // 13, largest first
export function budgetVsActual(s: IslandState, weeks?: number): { trade: 'mech' | 'elec' | 'build'; budget: number; actual: number[] }[];
export function fillRate(s: IslandState, weeks?: number): number | null;   // 8
export function waitWeeks(s: IslandState, weeks?: number): number;         // 8
export function runway(s: IslandState): { weekly: number; weeks: number };  // overhead + payroll + premium + loan, and the weeks of it the cash covers
```

- **Classes.** `new`: first received under 4 weeks ago and never used. `dead`: on hand with no use for 8+ weeks, or `usableOnIsland` is false (9.4). `fast`: used in 4 or more of the last 8 weeks. `slow`: the rest that is on hand or was used.
- **ABC** by value used over the last 13 weeks: the items making the first 80% of it are A, the next 15% B, the rest (and items with no use) C.
- **Known demand**: reservations of open jobs and open requisitions (this week); the `obvious` items of open alerts nobody has planned (their due week); the bench lines of inspections coming due (a plane within two weeks of its 100-hour at its flights a week; a house whose inspection runs out within 2 weeks); the open build's next two units (building materials); the tool a take-off's task needs.
- **Forecast**: `base` = simple exponential smoothing of the weekly use (α = 0.3, started at the 8-week mean), flat over the horizon; `known` = known demand by week. Units.
- **Suggested ROP / max** (continuous review, 90% cycle service): `L` = the item's lead + its default supplier's lead add + 1 (the week to the next resolve); `rop = ceil(perWeek × L + 1.28 × sd × √L + known demand within L)`; `max = rop + max(one pack, ceil(perWeek × 4))`. `why` says it in words: *"Uses 1.5 a week, lead 1 week: reorder at 4, order up to 10."*
- **Flags.** `order`: available + on order − known demand within `L` is under the ROP (or, with no ROP, under zero): *"Order 1 × SF48108-1 oil filter: the oil change on Twin N-12 is due week 9 and none is on hand."* (`urgent` when a job is waiting on it). `stop`: dead, or slow with a max set and no forecast or known demand for 8 weeks: *"Stop stocking KR15: no use in 9 weeks ($22 on the shelf)."* `expiring`: a lot expires within 2 weeks. `norop`: a fast mover with no ROP. `core`: a core is due back within a week. `cal`: a tool's calibration is due within 2 weeks.

### 14.3 What the analyst sees (C; screens in 17.3)

Two places, both readable in seconds: one big number per card, one sparkline or bar, at most three chips; a tap opens the detail.

1. **Money tab, Cash card**: cash now; a 12-week line of week-end cash over revenue (bars up) and cash out (bars down); chips: runway (*"fixed costs covered 3.4 weeks"*), this week vs the spend budgets, forecast revenue.
2. **Money tab, Where it went** (4 weeks, 12 on tap): a stacked bar per week by `OutCat`, the trade split (mech, elec, build, analyst), and the top three assets by spend over 13 weeks (*"Twin N-12 $4,210 · Cottage 2 $1,380 · Island grid $920"*).
3. **Money tab, Stock card**: inventory value and cash tied up (on hand + on order), turns, fill rate from stock (8 weeks), job-weeks waiting on parts (8 weeks); then the fastest movers (sparkline, units a week) and the slow and dead stock (value, weeks since it moved). Each row opens the item in the planner.
4. **Stock tab rows** carry the item's own velocity (17.3).

### 14.4 Budgets

`spendBudget` (7) sets a weekly spend budget per trade (mech, elec, build). It blocks nothing: the Money tab shows actual against it, and the approval card says *"Mech this week: $1,240 of $1,500"*. The petty-cash budgets (`autoBudget`) stay as they are.

### 14.5 Old islands

`migrate()` backfills `ledger` rows from `history` (up to 26 weeks): `rev`, `cash`, and `sp.overhead` / `sp.payroll` (that week's `fixed` split by the standard payroll), nothing item-level. Every item starts `new`; the planner says *"Velocity builds up from this week: suggestions start after 4 weeks of use."*

## 15. NPC staff (package D; A writes the types, the constants and the stubs)

The owner: *"a couple npc to help with expansion of the island like builders and other people that aren't gonna be supplied with other people (these are on the islands payroll and we can hire more skilled for more money etc) analyst decides on hiring."*

NPCs never do mechanic, electrician or analyst work: they don't plan, search, sign off, approve or buy. Unlocks still need the full crew (autopilot weeks don't count toward them), so solo and absent teams stay at tier 1 whatever the staff.

### 15.1 Roles

| Role | Does | Effect (hook) | Wage at skill 3, USD/wk |
| --- | --- | --- | --- |
| `pilot` | flies the guest, charter and cargo runs | the fleet's flights are capped by duty (`pilotCap`); hard landings by skill (`staffAfterFlights` → `M_HARD_LANDING`) | 320 |
| `housekeeper` | housekeeping and front desk: turnovers between guests, reviews | bookings capped by turnovers (`housekeepingCap`); occupancy × `reviewMult` | 180 |
| `builder` | puts up the next tier's buildings ahead of time; optional extra cottages | `buildWeek`: progress, materials drawn from stock, rework | 260 |
| `line` | line service: fuel, tow, wash, marshal; carts back on the charger | carts home (`cartsHome`); from tier 3 no line crew costs a flight a week (`turnaroundLoss`); tows by skill (`M_TOW`) | 220 |
| `grounds` | groundskeeper: storm prep, gardens | storm damage × `stormMult` | 160 |

### 15.2 The numbers (`STAFF` in `src/sim/staff.ts`; tune)

```ts
export const STAFF = {
  wage: { pilot: 320, housekeeper: 180, builder: 260, line: 220, grounds: 160 } as Record<NpcRole, number>,
  skillWage: [0.7, 0.85, 1, 1.2, 1.45],            // × wage, skill 1..5
  severanceWeeks: 2,
  raises: { 5: 8, 10: 15, 15: 22 },                 // raise % → morale points
  raiseEvery: 4,                                    // weeks between raises for one person
  morale: { start: 70, low: 30, quit: 15, lowMult: 0.8, noticeWeeks: 2, steadyFloor: 40 },
  duty: [5, 6, 6, 6, 6],                            // flights a pilot flies a week (skill 1: supervised line flying)
  hardLanding: [0.06, 0.045, 0.03, 0.02, 0.01],     // per flight
  hardLandingHit: 2,                                // health
  turnovers: [2, 3, 4, 5, 6],                       // houses a housekeeper turns over a week
  review: 0.025,                                    // occupancy × (1 + review × (mean housekeeper skill − 3)), clamped 0.95..1.05; no housekeeper: 0.9
  cartHome: [0.65, 0.75, 0.85, 0.95, 1],            // a cart left on a plane goes back on the charger at the resolve
  tow: [0.12, 0.08, 0.05, 0.03, 0.015],             // a week: a wingtip hit on a tow (no line crew: 0.05 at tiers 1–2, 0.12 from tier 3)
  output: [0.6, 0.8, 1, 1.25, 1.5],                 // builder work units a week
  rework: [0.2, 0.12, 0.06, 0.03, 0.01],            // a builder-week fails the inspector's check
  storm: [1.1, 1.05, 1, 0.9, 0.8],                  // storm damage × by the groundskeeper's skill
  maxStaff: 12,
  standard: [                                       // the standard crew by tier, all skill 3
    { pilot: 1, housekeeper: 1, builder: 1 },                        // $760
    { pilot: 2, housekeeper: 1, builder: 1 },                        // $1,080
    { pilot: 2, housekeeper: 1, builder: 1, line: 1 },               // $1,300
    { pilot: 2, housekeeper: 2, builder: 1, line: 1, grounds: 1 },   // $1,640
    { pilot: 3, housekeeper: 2, builder: 1, line: 1, grounds: 1 },   // $1,960
  ] as Partial<Record<NpcRole, number>>[],
};
export const standardPayroll = (tier: number): number;   // 760, 1,080, 1,300, 1,640, 1,960
// data.ts: TierDef.overhead = fixed − standardPayroll = 740, 1,220, 1,700, 5,360, 7,540 (`fixed` stays for old readers and tests)
```

The standard crew at skill 3 reproduces today: its pilots fly 6, 12, 12, 12 and 18 flights a week against 4, 8, 8, 12 and 15 scheduled; its housekeepers turn over 4, 4, 4, 8 and 8 houses against 2, 4, 4, 6 and 7; tier 3 has line crew (no turnaround loss); tiers 4–5 have a groundskeeper at skill 3 (storm × 1); its builder finishes each tier's buildings well before the crew project (15.6); payroll + overhead = today's fixed cost. Hard landings and tows raise alerts that take slots from the week's alert picks (5.1), so the job volume doesn't change, and the hard-landing wear is netted against the standard expectation (15.4).

### 15.3 People

- **Names**: first name and last initial from a fixed list of 60 island names (*Marta K., Keanu P., Aroha T., Joaquín R., Lina M., Dev S., Noor A., Tomasi F., …*), by `hashSeed(s.seed, 'npc', id)`, unique among the staff and this week's candidates. Ids `n1`, `n2`, … from `s.nextId`.
- **Traits** (40% have one): `steady` (morale never below 40), `fast` (a pilot flies 1 more flight, a housekeeper turns 1 more house, a builder +0.25 output, line crew +0.1 cart chance), `careful` (hard landing, tow and rework chances halved), `local` (asks 10% less and starts the week they're hired).
- **Morale** (0–100, starts at 70), each resolve in `staffWeek`: drifts 10% toward 70; −4 for a pilot or housekeeper who worked at the cap while flights or bookings were lost to it; −3 for a builder waiting on materials; +2 for everyone in an A week; −5 for everyone the week someone is let go. Under 30: duty, turnovers, output and cart chance × 0.8. Under 15: gives notice (`notice = W + 2`): *"Marta K. (housekeeper) gave notice: she leaves after week 14. A raise could keep her."* A raise that lifts morale to 30 or more withdraws it; otherwise they leave at the resolve of the notice week (no severance).
- **Wage**: the ask when hired; raises compound, rounded to $10.
- **Start**: skill 1–3 or `local` start the week they're hired; skill 4–5 the week after (they give notice where they are). They count from the resolve of their start week.

### 15.4 Hooks (A writes each with the stub in brackets; D implements)

```ts
export function staffOpenWeek(s: IslandState, r: Rng, now: number): void;                      // [no-op] this week's hiring board (15.7)
export function pilotCap(s: IslandState): number;                                               // [Infinity]
export function turnaroundLoss(s: IslandState): number;                                         // [0]
export function staffAfterFlights(s: IslandState, flown: { plane: Asset; n: number }[], r: Rng, W: number, line: Liner): void;  // [no-op]
export function cartsHome(s: IslandState, r: Rng, line: Liner): void;                           // [no-op]
export function housekeepingCap(s: IslandState): number;                                        // [Infinity]
export function reviewMult(s: IslandState): number;                                             // [1]
export function stormMult(s: IslandState): number;                                              // [1]
export function payroll(s: IslandState): number;                                                // [standardPayroll(s.tier)]
export function fitoutDone(s: IslandState, tier: number): boolean;                              // [true]
export function buildWeek(s: IslandState, r: Rng, W: number, line: Liner): void;                // [no-op]
export function staffWeek(s: IslandState, W: number, line: Liner): void;                        // [no-op] morale, notices, leavers
export function staffAction(s: IslandState, prev: IslandState, a: StaffAction, now: number): ApplyResult;  // [fail: "Hiring opens with the staff update."]
export function botStaff(s: IslandState, bot: Bot, r: Rng, now: number): IslandState;           // [returns s]
export function autoStaff(s: IslandState): void;                                                // [no-op] an absent analyst's autopilot
export function migrateStaff(s: IslandState): void;                                             // [full: the standard crew and the builds (15.9); A writes it, D may refine]
export function newIslandStaff(s: IslandState): void;                                           // [full: the tier-1 standard crew and the tier-2 build, for createIsland]
```

With the stubs, A's build plays exactly as today apart from the job flow (fixed cost = overhead + standard payroll). D's behaviour, exactly:

- `pilotCap`: Σ over pilots working this week of `duty[skill − 1]` (+1 `fast`) × (morale under 30 ? 0.8 : 1), floored. Resolve step 2 (A) cuts the fleet's total to `pilotCap − turnaroundLoss`, taking flights off the cargo plane first, then the guest plane with the lowest charter multiple: *"2 flights lost: 2 pilots fly 12 a week. Hire a pilot?"* Those flights stay on the schedule (the on-time grade counts them).
- `turnaroundLoss`: 1 from tier 3 when no line crew is working, else 0: *"1 flight lost to slow turnarounds: no line crew (the pilots fueled and towed)."*
- `staffAfterFlights`: pilots are assigned best first to the guest planes, then cargo. Each flight rolls `hardLanding[skill − 1]` (halved for `careful`): a hard landing takes `hardLandingHit` from the plane and raises `M_HARD_LANDING` for next week (`week: W + 1`, `src: 'landing'`, `who` = the pilot, due `W + 1`, the sole guest plane `W + 2`). Every flight flown also gets back the standard allowance `hardLanding[2] × hardLandingHit` (0.06 health), so the standard crew's expected wear is today's. One tow roll a week (the best line crew's `tow`; no line crew: 0.05 at tiers 1–2, 0.12 from tier 3) raises `M_TOW` on a plane that flew. Both alerts count as open work in next week's slots (5.1).
- `cartsHome` (step 4, before `chargeCarts`): a cart hooked to a plane that isn't this week's weak-battery plane goes back on the charger with the best line crew's `cartHome` chance: *"Line crew put GPU 1 back on the charger."* Without line crew nothing happens (the mechanic's job, as today).
- `housekeepingCap` and `reviewMult` (step 5): `booked = rentable.slice(0, min(arrivals, housekeepingCap(s)))`; *"1 house empty: housekeeping turns over 4 a week. Hire a housekeeper?"*; occupancy × `reviewMult(s)`.
- `stormMult` (step 9): with a groundskeeper `min(base, storm[skill − 1])`, where `base` is 1 at tiers 1–3 and 1.2 at tiers 4–5 (the resort's grounds need looking after); without one, `base`.
- `payroll` (step 11): Σ wages of the staff whose start week has come; `costs.payroll`; `costs.fixed = overhead + payroll`.
- `fitoutDone` / `buildWeek`: 15.6. `staffWeek`: morale and notices (15.3).

### 15.5 Actions (D; types in `types.ts` by A; all in `WEEK_BOUND`)

```ts
export type StaffAction =
  | { t: 'hire'; cand: string; week?: number }
  | { t: 'letGo'; npc: string; week?: number }
  | { t: 'raise'; npc: string; pct: 5 | 10 | 15; week?: number }
  | { t: 'staffAsk'; role: 'mech' | 'elec'; want: NpcRole; why: string; week?: number }
  | { t: 'staffAnswer'; ask: number; answer: 'declined'; week?: number }
  | { t: 'build'; what: 'cottage'; week?: number };   // COULD (15.8)
```

| Action | Who | Allowed when (else the error) | Effect |
| --- | --- | --- | --- |
| `hire` | analyst, turn not ended | on this week's board (*"That candidate took another job."*); staff under 12 (*"No room on the island for more staff."*); not in receivership (*"In receivership: no new hires."*) | adds the `Npc` (`wage` = ask, morale 70, `hired = W`, `start`), removes the candidate, answers an open ask for that role `hired`; feed, and a push to the asker |
| `letGo` | analyst, turn not ended | on staff; cash covers the severance (*"Not enough cash for the severance ($640)."*) | pays `severanceWeeks × wage` now (booked to `payroll`), removes them, morale −5 for the rest |
| `raise` | analyst, turn not ended | on staff; no raise in the last 4 weeks (*"Raised in week 9: wait until week 13."*) | wage × (1 + pct/100), rounded to $10; morale +8 / +15 / +22 (max 100); a notice is withdrawn at 30+ |
| `staffAsk` | mechanic or electrician, turn not ended | `why` 1–120 characters; one open ask per seat (*"You already have an ask open."*) | adds a `StaffAsk`; feed, and a push to the analyst |
| `staffAnswer` | analyst (also after the turn ended) | the ask is open | `declined`; feed to the asker. Hiring for that role answers `hired` on its own |
| `build` | analyst, turn not ended | 15.8 | queues an optional cottage |

### 15.6 Builds: builders put up the next tier

The crew project (one job per trade) stays exactly as today and still decides when a tier can arrive; the builders decide whether its buildings are up. A tier arrives at the first resolve where its crew project is done **and** its build is finished (`fitoutDone`; 12). Builds draw building materials from stock (3.4), so the analyst buys those too.

```ts
export interface BuildDef { id: string; what: string; tier?: number; units: Partial<Record<ItemId, number>>[] }
export const BUILDS: BuildDef[] = [
  { id: 't2', tier: 2, what: 'Cottages 3 and 4 and the cargo apron',
    units: [{ 'BLD-CON': 1, 'BLD-RB': 1 }, { 'BLD-LUM': 1, 'BLD-TIE': 1 }, { 'BLD-ROOF': 1 }] },                              // 3 units, $640 at tier-1 prices
  { id: 't3', tier: 3, what: 'The generator house',
    units: [{ 'BLD-CON': 1, 'BLD-RB': 1 }, { 'BLD-ROOF': 1 }] },                                                             // 2 units, $400
  { id: 't4', tier: 4, what: 'Villa East, Villa West and the seaplane dock',
    units: [{ 'BLD-CON': 1, 'BLD-RB': 1 }, { 'BLD-LUM': 2 }, { 'BLD-ROOF': 1, 'BLD-TIE': 1 }, { 'BLD-WIN': 1 }] },            // 4 units, $1,120
  { id: 't5', tier: 5, what: 'The Lodge',
    units: [{ 'BLD-CON': 1, 'BLD-RB': 1 }, { 'BLD-LUM': 1, 'BLD-PLY': 1 }, { 'BLD-ROOF': 1 }, { 'BLD-WIN': 1 }] },             // 4 units, $1,030
];
```

- **The queue.** A new island starts with the tier-2 build open. When a build finishes, the next tier's opens at once: builders work ahead, one build at a time, in tier order. Optional builds (15.8) queue behind the tier builds.
- **A week of work** (`buildWeek`, step 11c): each builder working this week adds `output[skill − 1]` (+0.25 `fast`, × 0.8 under 30 morale) to the first open build. Before work starts on unit *k* (`drawn ≤ k`), that unit's materials leave stock all at once (`takeStock(s, lines, 'build:' + id)`, A: all or nothing, books the use): if any line is short, work stops at the unit boundary, `idle += 1`, morale −3, and the review says *"Builders idle on the villa site: waiting on 1 × BLD-ROOF (on order, week 13)."* `done` never passes `drawn`. Rework: each builder-week rolls `rework[skill − 1]` (halved for `careful`): that week's work is lost and the current unit's materials are drawn again (*"The inspector failed Keanu's roof framing: redo it."*).
- **Finished** (`done ≥ need`): `finished = W`; feed *"The villas are up: they open with tier 4."*. The next build opens.
- **Standard timing**: one skill-3 builder with materials bought on time finishes the tier-2 build around week 4, tier 3 around week 7, tier 4 around week 12 and tier 5 around week 17, ahead of the crew projects (median weeks 8, 11, 16, 22 today). A skill-1 builder (0.6 a week) runs late from tier 4, and no builder means no progress: that is what the analyst's hiring and buying change.
- **The island** (D): a build site shows the further of the crew project's stage and the build's (`min(2, ⌊3 × done / need⌋)`), with the builders on it.
- **Tier progress** (`nextTierProgress`, A): a line *"Buildings up (builders): 2.5 of 4"* beside the existing unlock lines.
- **Home** (A mounts, D fills): the crew-project card shows *"Builders: 2.5 of 4 · next: 1 × BLD-WIN, on order for week 14"* (`BuildStatus`).

### 15.7 The hiring board

- Drawn at every week open (`staffOpenWeek`) from `hashSeed(s.seed, 'hire', W)`: 3 candidates (4 from tier 3). The board is replaced every week.
- The first candidates cover needs, in this order: a role below the standard crew for the tier; a pilot if flights were lost to the pilot cap last week; a housekeeper if bookings were; a builder if the open build is behind (units left > 4 × the builders' output); line crew from tier 3 if there is none. The rest are random, weighted pilot 3, housekeeper 3, builder 3, line crew 2, groundskeeper 1.
- Skill 1–5 with weights 25 / 30 / 25 / 15 / 5 %. Ask = round10(`wage[role] × skillWage[skill − 1] × r.range(0.95, 1.1)`), × 0.9 for `local`. Start as in 15.3.

### 15.8 Optional cottages (COULD; only if the island's node budget and spots allow)

From tier 3 the analyst can start up to two extra cottages (`h8`, `h9`) as investments: $6,500 paid at the start (the shell, by a mainland contractor, booked to `building`) plus a 5-unit build ({BLD-CON 1, BLD-RB 1}, {BLD-LUM 2, BLD-TIE 1}, {BLD-PLY 1, BLD-ROOF 1}, {BLD-WIN 1}, {BLD-LUM 1}: about $1,500). When finished, a cottage asset joins (health 80, inspection 8 weeks), rents like the others, needs a housekeeper's turnover and a guest arrival, and brings its own electrician alerts. Payback is roughly 8 weeks at tier-3 rates. The bots never build them (so the balance targets hold without them). If the node budget or the island's spots don't allow it, this is dropped and the `build` action is refused (*"No plot is ready for another cottage."*).

### 15.9 Old islands and new islands

- `migrateStaff` (called by `migrate`, 19): `staff` = the standard crew for the tier, skill 3, morale 70, standard wages, hired and started this week, names from the seed; builds for tiers up to `tier + 1` finished (an open crew project finishes exactly as it would have); the build for `tier + 2` (up to 5) open with nothing done; no board and no asks until the next week open.
- `newIslandStaff` (createIsland): the tier-1 standard crew and the tier-2 build open.

### 15.10 NPC figures on the island (D: `src/ui/island/staff.tsx`)

- Up to 10 figures, each one `<use>` of a symbol: the existing `#i-guy`, plus new symbols with a hard hat (builders), a cap (line crew), an apron (housekeepers), a white shirt (pilots) and a straw hat (the groundskeeper), defined once in `LifeDefs`. Placement: builders on the open build's site (one each, up to 3); line crew by a cart or a plane on the apron (up to 2); one pilot by the lead guest plane; a housekeeper at a booked house (up to 2); the groundskeeper in the gardens.
- None in a storm or at night, except one figure at the office window. A two-frame hammer bob for builders when motion is on; otherwise static.
- D also draws what A exposes (10): the alert-AOG plane at its AOG spot, the closed-house no-entry bubble, and a small tag bubble on a made-safe house.
- **Node budget**: the beaten island-lab scene stays at or under 1,500 SVG nodes (1,365 today; the crew adds at most 12, plus the symbols). New island-lab scenes: `staff` (tier 3, builders on the villa site, line crew with a cart) and `staff-night`.

### 15.11 The hiring UI (D: `src/ui/staff/`)

- `StaffDesk.tsx`, the analyst's Staff tab (A mounts it in `desk.tsx`; C places it in the Staff tab): (1) a payroll strip: payroll and overhead a week, runway, the week's projected net (red when negative); (2) the crew: one row each (role icon, name, skill dots, wage, morale bar, trait and notice chips); a tap opens raise (5 / 10 / 15%, with the new wage and morale) and let go (the severance, confirm); (3) the hiring board: a card per candidate (role, name, skill, ask, start, trait) with **Hire**, which opens a confirm sheet with the payroll after: *"Payroll $1,300 → $1,620 a week. This week projects +$410 (was +$730)."*; (4) the crew's asks with **Hire** (scrolls to a matching candidate) and **Decline**; (5) the open build: its units, each unit's materials (on hand / on order with ETA / missing) and **Buy the next unit** (dispatches `buy` for the shortfall, scheduled, from the yard).
- `StaffAsk.tsx`, the techs' ask card (A mounts it in `ops.tsx`): role chips, preset reasons (*"We need a second builder for the villa site."*, *"Line crew keeps leaving carts on planes."*, *"Turnarounds are eating a flight a week."*, *"Flights are being cancelled for lack of pilots."*, *"Houses aren't being turned over in time."*, *"The storm prep isn't getting done."*), a short note, and the ask's status.
- `BuildStatus.tsx` (A mounts it in `home.tsx`'s crew-project card): 15.6.
- Tap sequence, hiring: Staff tab (1) → **Hire** on a candidate (2) → confirm (3).

### 15.12 Staff bots and autopilot (D: `botStaff`, `autoStaff`)

- **The fin bot** (not naive): keeps the standard crew. For a role below the standard count, or one that lost capacity last week, it hires the best candidate with skill ≥ 3 and an ask ≤ 1.25 × the skill-3 wage (never more than standard + 1 per role); buys the open build's next two units' materials; raises anyone under notice by 10%; declines an ask it can't afford (cash − 4 × the added payroll under its reserve).
- **The naive analyst**: hires every candidate with skill ≥ 4 while payroll is under 1.8 × standard (over-hires), never raises, never replaces a leaver from tier 3 (under-hires), buys build materials only when the builders are idle.
- **Autopilot** (an absent analyst): replaces a leaver in a standard role with the best candidate of skill ≥ 2, raises anyone under notice by 5%, buys the next build unit's materials within the autopilot cap, answers no asks.

## 16. Whose move it is

Today `crossMoves` lists the cross-trade moves (a crewmate's report, the part chain), and the crew strip, the waiting and blocking cards, the end-turn check and the pushes all read it. The flow and the staff asks join the same list, so every surface counts them the same way.

```ts
// src/ui/select.ts (A)
export type CrossMove = { key: string; kind: 'report' | 'chain' | 'flow' | 'staff'; who: Role; waits: Role; text: string; what: string; short: string };
export function flowMove(s: IslandState, a: Alert): { who: Role | null; chip: string; text: string };   // one alert's next move: the inbox chip and the stepper's "next" line
export function flowMoves(s: IslandState): CrossMove[];                                                  // the cross-trade ones, inside crossMoves
export function dueNow(s: IslandState, role: OpsRole): Alert[];                                          // this trade's open alerts due this week that nobody planned
```

`flowMove` by stage (2.4):

| Stage | who | Chip | Text |
| --- | --- | --- | --- |
| `new` | the trade | *Your move* (due now: *Due now*) | "find the fix for the soft brake pedal on Twin N-12" |
| `bench` | electrician | *Ana: meter it* | "meter com 1 on Twin N-12" |
| `approval` | analyst | *Cy: approve* | "approve Tire and brake on Twin N-12 ($660)" |
| `parts`, requisitions open | analyst | *Cy: buy* | "buy 2 lines for Tire and brake ($370)" |
| `parts`, all ordered | nobody | *Parts wk 9* · *Held: paperwork* · *Backorder wk 10* · *Tool at cal* | "the linings come week 9 (next flight)" |
| `parts`, stopped | the trade | *Repick* | "repick the linings: they don't fit" |
| `research` | the chain's mover | the chain's chip | the chain's text |
| `ready` | the trade | *Ready* | "do Tire and brake on Twin N-12" |
| `done` / `closed` | nobody | *Done* / *Closed* | |

`flowMoves` (only when both seats are held, as today): a pending flow card not deferred this week (who: analyst, waits: the trade, key `flow:card:{order}`); an open requisition (analyst, the requester, `flow:req:{id}`); a bench check asked (electrician, mechanic, `flow:bench:{alert}`); a ready job whose alert grounds a plane or closes a house (the trade, the analyst, `flow:aog:{order}`: *"Twin N-12 is AOG: do the brake bleed"*); an open staff ask (kind `staff`: analyst, the asker, `staff:ask:{id}`).

- **Crew strip and cards** (`blocks`): flow and staff moves are counted per pair of seats in one line, *"2 cards and 1 requisition waiting ($1,240)"* (it replaces today's *"N approvals waiting"*); a move for a grounded plane or a closed house gets its own line. The line about kits stuck on a grounded cargo plane becomes *"cargo plane grounded: 2 POs waiting for a flight"*.
- **Pushes** (`pushes`): a new card or requisition goes to the analyst (*"Seb sent Tire and brake on Twin N-12: $660 (parts $370, labour $290)."*); a bench ask to the electrician; a staff ask to the analyst, and a hire back to the asker; the week-resolved push adds *"Parts in: Tire and brake (Seb)."* and *"Due now: soft brake pedal on Twin N-12 (AOG if not fixed)."* A stop pushes nothing: the tech sees it at the start.
- **End-turn check** (today's confirm, `owedBy`): the analyst: *"2 cards and 1 requisition wait on you (Seb, Ana). After you end your turn they go through only on petty cash or, for a grounded plane or a closed house, on the standing approval."* A tech: *"Twin N-12's soft brake pedal is due this week: if nobody plans it, the plane is AOG."* (`dueNow`).
- **Where it shows**: the inbox chips and the stepper (B), the approval cards (C), the Staff tab's asks (D), the Home crew strip (unchanged code reading `blocks`), the pushes, the end-turn check.

## 17. Screens (phone first: 390 × 844; desktop 1280 × 820)

### 17.1 Shared rules

- Targets are 44 px; one thumb. Sheets rise from the bottom on a phone and open as a 480 px right-hand panel on a desktop.
- Search inputs debounce 80 ms, render at most 20 rows, and never hide the results behind the keyboard (the list scrolls above it). No index is built on a keystroke (6.6).
- A job-flow draft (`{ step, task, pick, query }`) lives in `sessionStorage` under `jf:{islandId}:{alertId}`, every access in try/catch; closing the sheet keeps it.
- Each package styles its own components in its own file (`src/ui/flow/flow.css`, `src/ui/purchasing/purchasing.css`, `src/ui/staff/staff.css`), imported by the component. Only A edits `src/styles.css` (a shared token, if any) and `src/ui/kit.tsx`; A adds the icons all packages need to `kit.tsx` up front (squawk, trend, wear, calendar, guest, meter, take-off, box, truck, boat, tag, placard, hard hat, people).
- Words: the trade's own (IPC, AMM, EFF, SUPSD, NP, 8130-3, MEL, INOP; breaker, GFCI, AFCI, TR, WR, AWG, NM-B, THWN-2, box fill); money in the analyst's (PO, ROP, lead time, carrying cost, capex, core).

### 17.2 Technicians (B: `src/ui/flow/`, `ops.tsx`, `orders.tsx`, `manual.tsx`, `chain.tsx`, `puzzlehost.tsx`)

**The ops panel.** The asset list stays (a plane's line shows *AOG*, *MEL*, a house's *closed* or *safe*). The "parts N · N in transit" label becomes a **Stock** chip (*"Stock: 2 low"*) that opens this trade's stock read-only with **Request** per item (`request`). Under the assets and the ground power card comes the **inbox** (`AlertInbox`), in four groups:
1. *Your move*: new alerts, ready jobs, stopped jobs. Due now first, then hazards and airworthiness, then by due week.
2. *Waiting*: approval, parts, bench, research, each with its chip saying on whom or until when.
3. *Other work*: today's order cards for load sheets, ground power starts, reports, redos, legacy orders and the crew project.
4. *Closed this week* (collapsed).

A row (56 px or more): the source icon; the symptom on one line (ellipsis); under it the asset, the due chip (*due now* in rust, *due wk 9*), the flags (*MEL C to wk 9*, *SAFE*, *AOG*, *SHUT*); on the right the whose-move chip (16). The `StaffAsk` card (D) sits under the inbox.

**The job-flow sheet** (`JobFlow`): header (asset and registration or house; the symptom; due; flags) and a five-dot stepper, *Investigate · Manual · Parts · Stock · Send* (electrician: *Investigate · Reference · Materials · Stock · Send*). Steps that don't apply are skipped: repairs open at Parts; `due`, `ad`, `code`, `takeoff` and write-ups open at the Manual step with the task filled in; a task with no main slots goes from the Manual to Stock.

- **Investigate**: the finding at the alert's tier; the site for the electrician (room, breaker, AWG, run); for a plane its data-plate line (and *Altered: STC …* where an alteration touches the task's ATA). Then the decisions: **Make safe** (breaker off and tag, or blank-off; hazards only, first and in rust), **MEL {cat}: placard INOP until week N** (where allowed), **Ask {elec} to meter it** (bench alerts), **No fault found · close** (with a confirm: *"If it comes back, it's due at once."*), and the primary **Find the task ▸** / **Find the procedure ▸**.
- **Manual / Reference**: the `SearchBar`: input, keyword chips (tiers 0–2), chapter chips, results (number and title, a sub line with the models; tiers 0–1 mark the hint tasks *likely*). A tap opens the card preview (today's `TaskCard` for AMM keys, new cards included; `RefCard` for a reference entry: its summary, its NEC articles and, at tiers 0–2, the answer for this site), then **Use this task ▸**.
- **Parts / Materials**: one row per main slot (*"Tire × 1 · pick from the IPC"*; optional slots marked). A tap opens that slot's search: for the IPC, the slot's figure, rows in print order with EFF, UPA, SUPSD BY, NP and ALT as printed and the badges of 6.4; for the catalog, the slot's category with each item's spec line. A tap on a row fills the slot and comes back. **Not in the IPC · research the records** sits under every IPC slot at every tier (the player decides). **Add a line** adds an extra item (6 lines at most). Tiers 3+: a *Recent on this airplane* chip row with the last 5 P/Ns the crew picked for it, unmarked.
- **Stock**: every line, the picks and the task's own bench lines (marked *card*), with its badge: *4 on hand* with a check mark (palm), *2 on hand · need 4* (amber; the rest is requested), *0 · on order wk 9* (sea), *none* (rust; requested), for tools *owned*, *away for calibration until wk 9*, *not owned: request (capex $620)*. Tiers 0–1 show `pickCheck` warnings on top (*"Check: EFF C is POST SB; this airplane is PRE SB."*). The summary *"Pull 3 · request 1 · labour $290"* and the primary **Send ▸** (`plan`).
- **After Send**, a toast says what happened: *"Ready: start it now"* / *"On petty cash: the parts come week 9"* / *"Card sent to Cy: $660"* / *"Requested 1 line: Cy's move"*.

**Order detail** for a flow job (`orders.tsx`): the task; each line's state (reserved, on order with its ETA, held, sent back); the POs; the stop with **Repick ▸**; **Drop the job** (confirm). **Start** on a ready flow job runs `installCheck` first (8.7) and shows the stop sheet or launches the puzzle. The puzzles `wireup`, `conduit` and `panel` label the chosen device, wire and raceway from `context.pick` (display only; scoring unchanged).

**Tap counts for a known answer** (a tap is one touch; nothing needs typing):

| Case | Taps | Per search step |
| --- | --- | --- |
| Mechanic, tier 1, *L/H brake pedal soft* (the fix: bleed) | row (1) → Find the task (2) → 32-42-01, marked *likely* (3) → Use this task (4) → no slots, so Stock: 2 qt of MIL-PRF-5606 on hand → Send (5) | Manual: 2 |
| Mechanic, tier 3, *tire at 2/32* on Cargo C-7 | row (1) → Find the task (2) → chip *32 Landing gear* (3) → 32-40-01 (4) → Use (5) → slot Tire (6) → the row for this S/N (7) → slot Tube (8) → its row (9) → Send (10) | Manual: 3; each part: 2 |
| Electrician, tier 1, *bathroom outlet trips with the hair dryer* (the fix: GFCI) | row (1) → Find the procedure (2) → R-GFCI, marked (3) → Use (4) → slot GFCI device (5) → KG20-TR, badge *this circuit: 20 A, TR* (6) → Send (7) | Reference: 2; device: 2 |
| Electrician, *tingle at the shower valve* (hazard) | row (1) → Make safe · breaker (2), then as above | |
| Mechanic, MEL a dead com on the twin | row (1) → MEL C (2) | |

### 17.3 The analyst (C: `src/ui/purchasing/`, `desk.tsx`, `board.tsx`, `src/puzzles/auction.ts`, `src/puzzles/invoice.ts`)

**The desk.** The cash card stays on top. Under it a segmented control: **Approvals · Stock · Money · Staff**, with a count on Approvals (cards and requisitions waiting), a dot on Stock (urgent flags) and a count on Staff (asks and notices). It opens on Approvals when something waits, else on Stock.

**Approvals**: flow cards, then requisitions, then legacy cards (today's), then desk work (today's list).
- `ApprovalCard`: the job title, asset, the trade's avatar and *for Seb*; the symptom (one line) and the task (*"32-40-02 Main brake linings: replacement"*); the lines: *From stock: 3 lines, $86 (already paid)*, *To buy: 4 × 066-19600 LINING, $62 · OEM · next flight, week 7*, *Labour $290*; the total; chips: *AOG*, *house closed*, *due now*, *MEL to wk 9*, *waiting a week costs about $1,120* (`expectedDeferralCost`, counting a grounded plane's downtime or a closed house's rent), and the trade's spend against its budget. Swipe right to approve, left to defer (today's gesture), or the buttons. A tap expands it: per line the supplier (*OEM* | *Broker −20%, +1 week, 1 in 4 held for paperwork*) and for rotables the condition (*Exchange $760 + $350 core, refunded* | *New $1,450*); the freight (*Next flight* | *AOG boat +$350: here at this week's resolve*). The total follows `cardOf(s, o, buy)`.
- `ReqQueue`: *"Seb asks for 1 × T-MEGGER insulation tester ($620, a tool: capex) · 'the dock run needs it'"*; **Defer** / **Approve**; select several for **Approve 3 ($890)** (`approveReq`, one PO per supplier).

**Stock** (`StockPlanner`):
- the flags strip (urgent first), each with its one-tap action (**Order 2**, **Stop**, **Return core**, **Send for calibration**);
- *Known demand* (collapsible): the open alerts with certain items and the planned jobs waiting, by due week (what the techs' alerts tell the analyst);
- filter chips *All · Flags · Fast · Slow · Dead · Mech · Elec · Build · Tools* and a filter input over the supply index (A's `search()`);
- a row per item: P/N and nomenclature; *"4 on hand · 2 free · 1 on order wk 9"*; a 12-week sparkline; class, ABC, days of supply; ROP/max;
- `ItemSheet`: the 12-week velocity chart, the 4-week forecast (base and known), the suggestion with **Use 4 / 10**, ROP/max steppers (`setStock`), **Buy** (packs, supplier, freight; `buy`), lots and expiry, **Scrap**, cores owed, calibration;
- *Receiving* at the bottom: held POs (*"po14: 2 lines wait for their 8130-3s, released next week"*), open POs with ETA and freight, cores owed (**Return**), tools due for calibration (**Send**).

**Money**: the cards of 14.3; spend budgets per trade (`spendBudget`); the petty-cash budgets (today's `setBudget`); pricing (today's); insurance (today's). The parts-kit block and `buyList` are gone.

**Staff**: `StaffDesk` (D), in the tab C draws.

**The week's review** (`board.tsx`): the costs block adds payroll, overhead, carrying, freight, labour and parts when present.

**The auction** (A's `auctionLot`; C's `auction.ts`): the task comes at most every 2 weeks, when a lot exists: 2–4 lines of items the island uses (velocity or known demand) that are under their max or not stocked, *new surplus with 8130-3s from a broker's liquidation*. `fair` = the lot at the broker's price × 0.85; `low` = 0.6 × fair; `high` = 1.3 × fair; `cap` = min(0.92 × the lot at OEM price, cash − $2,000). The puzzle's intro card lists the lot (`context.lot`); its result keeps today's shape (`kits` 1 or 0, `spent`): a win places a PO (`vendor: 'broker'`, scheduled, `cost = spent`, each line at its share).

**The invoice match** (A's `invoiceContext`; C's `invoice.ts`): when a PO was received last week, the three-way match uses that PO's real lines (P/N, nomenclature, PO quantity and price, received quantity), its vendor and its freight; the discrepancy is seeded as today. With no such PO, today's generated card.

**Tap counts**:

| Case | Taps |
| --- | --- |
| Approve a card as the tech sent it | swipe (1) |
| Approve it on the AOG boat | card (1) → AOG boat (2) → Approve (3) |
| Act on *Order 1 × tire* | Stock (1) → **Order 1** on the flag (2) → confirm (3) |
| Take the suggested min/max | Stock (1) → the row (2) → **Use 4 / 10** (3) |
| Hire | Staff (1) → **Hire** (2) → confirm (3) |

### 17.4 NPC staff (D)

15.10 and 15.11.

## 18. Bots and autopilot

### 18.1 Technician bots (A, `bots.ts`)

They call the same reducer as a phone. They don't run the search: a hit rate stands for it.

```ts
const hit = (skill: number, alertTier: number) => clamp(0.55 + 0.45 * skill - 0.08 * Math.max(0, alertTier - 2), 0.3, 0.97);
```

- Each turn, before playing jobs, every open alert of the bot's trade (due first): a hazard is made safe when its fix needs something not in stock; an MEL item is placarded when the plane is the only guest plane and the part isn't in stock; a bench alert gets the electrician's check when that seat is a bot that isn't absent. Then the plan: with `hit` the task is one of `fixesOf` (else a sibling task in the same chapter); an NFF alert is closed NFF with `hit` (else its most common cause's task is planned); a real fault is wrongly closed NFF with (1 − hit) × 0.25. Each slot gets the `stdPick` line with `hit`, else a near-miss from the slot's own rows (the other S/N block, the superseded P/N, the other amperage or protection).
- A stopped job is repicked with `stdPick` on the next turn.
- Then ready jobs are played as today (per-turn limits, carts, reports first).
- Speed: bots never build a search index; a 26-week sim stays under 1.5 s (about 0.4 s today).

### 18.2 The fin bot (A; staff through D's `botStaff`)

- **Cards**: today's rule (approve when the expected cost of waiting is at least 0.6 × the card or it is critical, keeping the reserve), with freight: the AOG boat when the job's alert grounds a plane or closes a house and a week of that costs more than $350; otherwise scheduled. The broker only for consumables, when cash − cost is under the reserve.
- **Requisitions**: approved when cash − cost ≥ the reserve, or at once for a job that grounds a plane or closes a house; a tool a job needs, always.
- **Reorder policy**: every turn the `order` flags (urgent first) are bought up to the suggestion (whole packs, scheduled); once an item has 4 weeks of use its ROP/max is set to `suggestRop` when that differs by 2 units or more (at most 6 a turn); the open build's next two units are bought; owed cores go back; tools due within a week go for calibration; dead stock worth $100 or more with no known demand is scrapped.
- **The naive analyst**: approves everything (today), never sets a min/max (only the starter stock replenishes), buys 3 random items of its trades each week while cash is over $8,000 (dead stock and carrying cost), never returns cores.
- Desk tasks as today; the auction bids on its lot.

### 18.3 Autopilot for a missed seat (engine, resolve step 1)

- **A technician**: makes hazards safe (breaker), placards MEL items whose fix needs a part not in stock, plans the alerts due now that ground a plane or close a house with the right task (`fixesOf`) and `stdPick` (autopilot keeps to the manual: no hidden defects, as today), and plays up to 2 ready jobs at 50% (today). No NFF closes, no asks.
- **The analyst**: today's rule (up to 2 cards above the $4,000 floor; a job that grounds a plane or closes a house whenever the cash is there, on the AOG boat), plus requisitions and urgent stock flags within `STOCK.autopilotCap` ($800 a week); owed cores returned; due tools sent for calibration; `autoStaff` (15.12). Replenishment runs whoever plays (it is the analyst's standing policy, 9.3).
- The standing approvals (8.5) run after autopilot.

## 19. Migration and the version gate (A)

### 19.1 Versions

- `ENGINE_VERSION` 3 (`engine.ts`), `DOC_VERSION` 3 (`src/net/firebase.ts`), and `firestore.rules` accepts only `request.resource.data.v == 3`. The rules and the hosting build deploy together, as for v2 (*Deploy log* in DECISIONS.md): an old tab's writes are refused with permission-denied and it reloads (today's code); `apply()` still refuses a doc saved by a newer engine.
- A v1 or v2 doc is read by the new build and migrated in memory; its first write stores it as v3.

### 19.2 `migrate(s)` (`src/sim/migrate.ts`)

Pure and deterministic (its random stream is `hashSeed(s.seed, 'migrate')`), idempotent field by field (each step runs only while its field is absent), and cheap. It runs at the top of `apply()` right after the newer-engine refusal (before `healChain`), in `useIsland`'s read path (`migrate(structuredClone(doc))`, display only, so a doc nobody has written since the deploy renders on the new screens), and in the tests.

1. **Stock.** `inv` = the starter stock for the island's tier (19.3). `credit` = (`parts.stock` + `parts.inTransit`) × `kitValue(tier)`: store credit at the vendors, used by the next POs (9.4). `parts` = `{ stock: 0, inTransit: 0 }` (the field stays for old readers).
2. **Orders.**
   - A trade order `waiting_part` on kits (`parts > 0`, no chain) becomes a flow job with the same id: `flow` with the kind's default task for the asset, `stdPick` and the bench lines; a linked alert (`src: 'finding'`, `status: 'job'`, `kind`, `sym: 'W_{kind}'`). What stock covers is reserved; the rest become **open** requisitions (*"carried over from the parts kits"*), which the store credit pays for when they are approved (petty cash and autopilot included).
   - A `pending` trade order with `parts > 0` becomes a flow card the same way, re-priced (labour 8.3, plus what has to be bought).
   - Every other open order stays as it is: ready jobs, pending jobs without parts, load sheets, ground power starts, reports, repairs, redos, crew projects, desk tasks. A **legacy order** (no `flow`) approves, plays and signs off exactly as today and draws nothing from stock.
3. **Part chains.** Unchanged: no `flow` flag, so an open chain grounds its plane as today; its cards, freight, receiving and self-heal work as today.
4. **Alerts.** `alerts = []`. The next week open raises alerts; the legacy orders count as open work in its slots, so there is no flood.
5. **Staff and builds.** `migrateStaff` (15.9).
6. **Ledger.** Backfilled from `history` (14.5).
7. `pos`, `cores`, `eas` = `[]`; `reqs` = the requisitions of step 2; `engine = 3`.

A mid-week doc keeps its turns: a seat that hasn't played this week sees its legacy orders and any converted jobs; alerts start with the next week.

**Guarantees** (tested, 21.1): cash unchanged; `credit` = kits × kit value; no order lost (every open order is still open, or converted with the same id); open chains run to the end; a second `migrate` changes nothing; the doc stays under the size budget.

### 19.3 Starter stock (`STARTER` in `data.ts`; new and migrated islands)

A new island gets the tier-1 lines at `createIsland`; a migrated island gets the lines up to its tier. Plane lines resolve to the effective P/N for that airplane (the task's `stdPick`), so each shelf fits its own planes. Quantities in units; *ROP / max* where replenishment should keep the line up.

| Tier | Lines: on hand · ROP / max |
| --- | --- |
| 1: the twin, two cottages, the grid | **Twin**: oil filter 2 · 1/3; piston oil SAE-J1899-50 24 qt · 12/36; crush gaskets AN900-10 25 · 5/25; safety wire .032 25 · 5/25; cotter pins MS24665-302 100 · 10/100; O-rings MS28775-227 10 · 2/10; wheel bearing grease 10 · 2/10; MIL-PRF-5606 12 qt · 4/12; brake linings 4 · 0/4; lining rivets 50 · 16/50; a main tire 1 and a tube 1. **Electrician**: KR15-TR 10 · 4/10; KR20-TR 10 · 4/10; KG20-TR 2 · 1/4; KG15-TR 1; KP115 4 · 2/6; KP120 4 · 2/6; KP120AF 1; NMB-14-2 1 roll; NMB-12-2 1 roll; twist-on connectors 15 · 5/15; BOX-OW1 25 · 5/25; WP-INUSE 2; PLATE-BLANK 10; LABELS 10. **Tools**: T-CLAMP and T-TORQUE (calibration due week 26). |
| 2 adds: the cargo plane | turbine oil MIL-PRF-23699 12 qt · 9/24; its filter element 1; its tire and tube 1 each |
| 3 adds: the generator | the generator's oil and fuel filters 1 each; 15W-40 one case |
| 4 adds: the float and the villas | the float's oil filter 2 · 1/3 and linings 4 · 0/4; KP120DF 2; KG20-TRWR 2 |

At tier-1 prices that is about $1,800 of stock and $440 of tools on a new island (today it starts with 3 kits, about $1,020).

### 19.4 Fixtures (written by the base engine, never by hand)

- Make a worktree of `6c0c426` in the scratchpad (`git worktree add <scratch>/base-6c0c426 6c0c426`, `node_modules` symlinked), copy `scripts/fixtures-v2.ts` into it and run it there with `npx tsx`: it plays the base engine's own bots and writes the docs below. Commit the script and the six files to `tests/fixtures/`; list the seed and week chosen for each at the top of `tests/migrate.test.ts`.

| File | The doc |
| --- | --- |
| `v2-6c0c426-early.json` | tier 1, start of week 4, 3 kits in stock |
| `v2-6c0c426-kits.json` | mid-week, kits in transit, 2 or more orders `waiting_part` on kits |
| `v2-6c0c426-chain-transit.json` | an open chain with its part in transit (the plane AOG) |
| `v2-6c0c426-chain-review.json` | an open chain waiting on engineering's answer |
| `v2-6c0c426-midweek.json` | tier 3: the mechanic ended the turn, the electrician part way, the analyst not started, cards pending |
| `v2-6c0c426-late.json` | tier 4 or 5, week 20 or later, storm season |

- The script searches seeds and weeks for each state (the base bots with `TEAMS['three friends']`), so it needs no changes to the base code.
- The existing `live-79f806b-*` and `skew-79f806b-*` fixtures go through the same migration and keep passing.

## 20. Balance plan

### 20.1 Targets (unchanged)

- Three friends and all average: tier 5 at a median of week 21–23, and **0 weeks below $0**, in the standard run (26 weeks × 30 seeds).
- Solo and absent teams stay at tier 1.
- The pacing guard stays (`tests/engine.test.ts`: three friends reach tier 5 by week 26 in at least 75% of seeds 1–30).
- The robust sweep (`npm run balance -- robust`) is reported with the change (median week to tier 5, misses, weeks below $0, minimum cash) beside the Phase B table in DECISIONS.md.

### 20.2 Where the money moves, and the neutral point

| Change | Neutral point | Effect |
| --- | --- | --- |
| Labour + standard parts per job | today's card + today's kit value (8.3), tested within 0.85–1.25 | neutral |
| Alert volume | today's order volume ±10% (5.1) | neutral |
| No-fault-found alerts | 0.25 extra per trade-week, outside the slots | a little more work; a wrong plan wastes parts |
| Starter stock | about $1,800 of stock and $440 of tools vs 3 kits (about $1,020) | slightly positive |
| Carrying cost | 0.5% a week of stock value ($10–60 a week) | slightly negative |
| Electrician's tools (capex) | about $2,100 over a game (megger, fish tape, benders, knockout set, puller) plus calibration | negative |
| Builds' materials | about $3,200 at tier-1 prices (about $3,600 at tier prices) over a game | negative |
| Freight | the AOG boat for grounding and closing alerts, as today's chain boat | watch |
| Staff | the standard crew's payroll + overhead = today's fixed cost (15.2) | neutral; hard landings and tows take alert slots |
| Store credit, cores, returns | refunds | neutral |

The new capex (tools and builds, about $5,700 over 26 weeks) is the one real drain. Expect it to push tier 5 later by up to a week before tuning.

### 20.3 Knobs (starting values; record the final ones in `docs/DECISIONS.md`, *Real job flow · Balance*)

- Alerts: `ALERTS.nff` 0.25 per trade-week; cause and NFF weights (5.2, 5.3); leads; `ALERTS.wiringShare` 0.3; `ALERTS.againMin`–`againMax` 1–2; `ALERTS.keep` 2.
- Money per job: `kitValue` (340 at tier 1, +10% a tier); `LABOR.min` per task; item prices (3.x); `STOCK.perTier` 0.1.
- Stock: `STOCK.carry` 0.005; `restock` 0.15 (min $40); `returnCredit` 0.75; `coreWeeks` 4; `coreBer` 0.15; `autopilotCap` $800; `STARTER` (19.3).
- Freight and suppliers: `FREIGHT.aog` $350; supplier price multipliers, lead adds and paperwork rates (3.5).
- Chain: `CHAIN.flowChance` 0.15 (flow jobs); `CHAIN.chance` 0.3 (legacy).
- Staff: `STAFF` (15.2); `BUILDS` quantities; `TIERS[].overhead`.
- Bots: the `hit` formula (18.1).

### 20.4 What to watch (three friends, standard run)

| Metric | Expected |
| --- | --- |
| Alerts per trade-week | 2.5–3.5 (today's orders per week ±10%) |
| No-fault-found share of alerts | 12–20% |
| Fill rate from stock, weeks 8–26 | 55–80% |
| Job-weeks waiting on parts, per week | 1.5 or less |
| Plane-weeks AOG per game | today's chain AOG weeks + 2 or less |
| House-weeks closed by a hazard per game | 3 or less |
| Inventory value at week 26 | $4,000–12,000 |
| Payroll at week 26 | within ±15% of the standard crew's |
| Tiers whose buildings were late (after the crew project) | none in 90% of games |
| Hidden defects per week | today's + 0.05 or less (the bots' wrong tasks and picks) |
| Minimum cash | $1,500 or more (today $2,273) |

### 20.5 `scripts/balance.ts` (A)

- The summary table adds `fill%`, `wait/wk`, `AOG wk`, `inv@26`, `payroll@26` and `late bld`; the robust sweep adds `fill%` and `AOG wk`.
- `detail` adds, per week: alerts raised / planned / NFF-closed, POs placed / received, inventory value, payroll.
- A new mode, `flow` (`npm run balance -- flow [team] [seed]`), prints the first 40 alerts of one game: the symptom, the hidden cause, the bot's task and pick, the verdict (right, wrong task, near-miss, stop) and what came of it, to tune the symptom weights.

### 20.6 Tuning order

1. **A, with the staff stubs**: alert volume and the money per job first (5.1, 8.3); then the week to each tier within ±1 of today for every team, before anything else changes.
2. **Stock**: the starter stock and the fin bot's policy, for fill rate and waits; then the naive analyst (it should end up with dead stock and carrying cost, not a collapse).
3. **D**: the standard crew within ±0.5 week of A's numbers; then the naive analyst's over- and under-hiring.
4. If the three friends' tier 5 slips past week 23 or any week goes below $0: first lower `TIERS[].overhead` by up to $150 a week at tiers 2–5 (it offsets the new capex), then the `BUILDS` quantities, then `kitValue` (lower labour), then tool prices. The lesson recorded in DECISIONS.md (*Balance*) still holds: the margins are thin at tier 4, so every change gets a full run.

## 21. Test plan

Whole-season sim tests keep `vi.setConfig({ testTimeout: 30000 })` (CI runners are about 1.5 × slower).

### 21.1 Package A

- `tests/items.test.ts`: ids unique across `ITEMS` and every model's `planeItems`; every item has a price over 0, a lead of 1 or more, a pack of 1 or more and tags; every electrical item and tool has an NEC basis; every row of the new IPC figures has an item; prices by tag match 3.1.
- `tests/aircraft-golden.test.ts` unchanged. `tests/aircraft2.test.ts`: the new figures pinned for three island seeds (P/Ns by S/N block); `figuresFor` counts; `findPart` and the logbook puzzle unaffected.
- `tests/tasks.test.ts`: every catalog kind but `wb`, `gpustart`, `report` and `project` has a task for each of its target models; every main slot resolves for each model, both S/N blocks and both SB states; `benchFor` resolves; `laborCost` + the standard parts is within 0.85–1.25 × today's cost for every task × model × tier 1–5; every task with a kind has a `LABOR.min`.
- `tests/alerts.test.ts`: over 30 seeds × 26 weeks, alerts per trade within ±10% of the orders the base engine generated (a table recorded from `6c0c426`); every cause's tasks fit the symptom's models; NFF share 12–20%; the sole guest plane never gets an airworthiness alert due the week it is raised; a hazard closes its house until made safe (then × 0.75) or fixed; MEL categories and limits; the bench fault share about 0.3; NFF comebacks re-raise.
- `tests/search.test.ts`: every task in the top 3 for its title's words; every IPC row first for its exact P/N (with and without dashes) and in the top 5 for its nomenclature; the synonyms (*pads* → linings, *gfi* → GFCI, *romex* → NM-B, *mag* → magneto); for every symptom × cause the tier 0–2 chips put a fixing task in the top 3; `hintsFor` gives no chips at tier 3+; deterministic; building an airplane's index under 60 ms and a search under 6 ms on CI.
- `tests/flow.test.ts`: every action's validation and error string (7, 15.5 stubs); the week stamps; petty cash at plan (8.4); standing approvals at the resolve (8.5); reservations first come, first served; `repick` and `dropJob` release; `installCheck` stops (wrong P/N, short quantity, a missing tool) and `complete` on a stopped job drops the result; a sign-off consumes, a rework doesn't; `cardOf` totals; the statuses (8.2); the changed `squawk`.
- `tests/stock.test.ts`: receiving (the 8130-3 roll and quarantine, supersession codes 1/2/3, each `judgePart` outcome, online backorders, a slip when nothing flew, the AOG take-over); replenishment and the freeze; carrying cost; expiry (FIFO, eating a reservation); cores (credit, half for BER, forfeit); calibration; scrap; store credit; the analytics (velocity, classes, ABC, forecast, `suggestRop`, flags) on hand-built ledgers; `auctionLot` and `invoiceContext`.
- `tests/consequences.test.ts` (extended): a wrong task re-raises through an incident or an inspection; `ipc:noteff`; `ignition:heat`; every electrical variant on a built site; `stdPick` passes the judge for every site the generators make (enumerated over seeds); the NFF comeback; `cal`.
- `tests/chain.test.ts` (extended): research from `plan` with `research: true`; research queued behind an open chain; a `displaced` part at receiving opens research; an EA record becomes an IPC row and `judgePart` accepts it; a flow chain doesn't ground the plane by itself; the flow trigger only on 32-40, 61-10 and 29-10. The existing chain, bench, chain-GSE and chain-money tests pass unchanged (legacy orders).
- `tests/migrate.test.ts`: for each v2 fixture (19.4): the selectors run; `migrate` is idempotent; cash unchanged and credit = kits × kit value; no order lost; open chains finish; ten weeks of bots give the same doc in memory and through JSON; `engine === 3`.
- `tests/skew.test.ts` (extended): the live and skew fixtures migrate and play; the doc and rules versions are 3.
- `tests/docsize.test.ts`: a 52-week three-friends island is under 150 KB of JSON; the ledger holds at most 26 rows; alerts at most 40.
- `tests/engine.test.ts`: the exit tests unchanged (sensible play never ends a week under $0; solo players never leave tier 1; the pacing guard; every tier reachable). Rewritten: *approve spends cash and reserves parts* (a flow card), *parts are capped at 6* (the `buy` validation), *auction result adds parts in transit* (the lot's PO), the squawk test (an alert). `tests/chainmoney.test.ts`: the `downtimeOf` line that used kits in transit uses a scheduled PO due that week.
- `tests/staffstub.test.ts`: with the stubs, `costs.fixed` equals today's `TIERS[].fixed` every week, and flights, bookings and storm damage are today's.

### 21.2 Package B

- `tests/flowui.test.ts` (the minidom, like `blind.test.ts`): the pure step model in `src/ui/flow/steps.ts` (which steps an alert shows, the draft reducer, what Send dispatches) and the tap-count table of 17.2 (a known answer takes at most 3 taps per search step at tiers 1 and 3).
- In the browser (Playwright scripts in the scratchpad, 390 × 844 and 1280 × 820, screenshots looked at): the mechanic and the electrician each take an alert to a signed-off job through the search; MEL, make safe, NFF, the bench ask, the stop sheet and a repick, the research link; the draft survives closing the sheet.

### 21.3 Package C

- `tests/purchasing.test.ts`: the pure view model in `src/ui/purchasing/model.ts` (card lines from `cardOf`, requisitions grouped by supplier, planner rows sorted and filtered, the Money cards' numbers from a hand-built ledger), and the adapted puzzles (the auction reads a lot, the invoice card reads a real PO). C doesn't edit A's existing test files.
- In the browser: approve a card on the AOG boat; approve requisitions together; act on a flag; take a suggested min/max; receiving and cores; the Money tab on a phone.

### 21.4 Package D

- `tests/staff.test.ts`: with the random staff effects off (a test flag), the standard crew's weeks equal the stub run's; with them on, the three friends' tier 5 within ±1 week; every action's validation; payroll and severance; raises, morale and notices; builds with and without materials, rework, and a tier waiting on its build; `migrateStaff` and `newIslandStaff`; `botStaff` (the naive analyst over-hires); the board covers needs first.
- The island: `scripts/island-shots.mjs`: the beaten scene at or under 1,500 nodes; the new scenes render; screenshots looked at.

### 21.5 After the merge (the Integrate and QA phases)

`npx tsc --noEmit -p .`; `npx vitest run`; `npm run balance` and `npm run balance -- robust`; `scripts/e2e.mjs` on a phone and a desktop (updated for the flow); `scripts/e2e-online.mjs`; the migration on the v2 fixtures, looking for lost orders or money.

## 22. Work split and file ownership

A lands first, in one commit, with everything B, C and D build on: all the types, the engine, the data and the aircraft extension, search, flow, stock, ledger and migration, whose-move, the staff constants and stubs, the UI mount stubs, the bots, the tests green and the balance run. B, C and D then start from A's commit in parallel and edit only their own files. If one of them needs an engine change, it doesn't make it: it says so in its result, and the Integrate phase makes it.

| Path | Owner |
| --- | --- |
| `src/sim/types.ts`, `data.ts`, `engine.ts`, `econ.ts`, `chain.ts`, `aircraft.ts`, `bots.ts`, `progression.ts` | A |
| `src/sim/items.ts`, `tasks.ts`, `alerts.ts`, `search.ts`, `flow.ts`, `stock.ts`, `ledger.ts`, `migrate.ts` (new) | A |
| `src/sim/staff.ts` (new) | A writes the constants, the stubs, `migrateStaff` and `newIslandStaff`; then D owns it |
| `src/puzzles/types.ts` (context `pick`, `lot`, `invoice`), `src/puzzles/teardown.ts` (the magneto and plug assemblies, data only) | A |
| `src/ui/select.ts`, `src/ui/useIsland.ts`, `src/ui/kit.tsx` (icons), `src/net/firebase.ts`, `firestore.rules` | A |
| `src/ui/home.tsx` | A (the `<BuildStatus>` mount in the crew-project card only) |
| `src/ui/staff/StaffDesk.tsx`, `StaffAsk.tsx`, `BuildStatus.tsx` | A writes stubs that render nothing, then D owns them |
| the mounts: `<StaffDesk ctl={ctl} />` in `desk.tsx`, `<StaffAsk ctl={ctl} role={role} />` in `ops.tsx` | A adds the lines; C and B keep them (C moves `StaffDesk` into its Staff tab) |
| `tests/*` (except the files named for B, C, D), `tests/fixtures/v2-6c0c426-*.json`, `scripts/balance.ts`, `scripts/fixtures-v2.ts` | A |
| `src/ui/flow/*` (new: `Inbox`, `JobFlow`, `Search`, `ManualView`, `IpcView`, `SupplyView`, `StockStep`, `StockBadge`, `steps.ts`, `flow.css`), `src/ui/ops.tsx`, `orders.tsx`, `manual.tsx`, `chain.tsx`, `puzzlehost.tsx`, `src/puzzles/wireup.ts`, `conduit.ts`, `panel.ts`, `tests/flowui.test.ts` | B |
| `src/ui/purchasing/*` (new: `ApprovalCard`, `ReqQueue`, `StockPlanner`, `ItemSheet`, `BuySheet`, `Receiving`, `Money`, `model.ts`, `purchasing.css`), `src/ui/desk.tsx`, `src/ui/board.tsx`, `src/puzzles/auction.ts`, `invoice.ts`, `tests/purchasing.test.ts` | C |
| `src/sim/staff.ts` (after A), `src/ui/staff/*` (after A), `src/ui/island.tsx`, `src/ui/island/*` (new `staff.tsx`), `src/islandlab.tsx`, `scripts/island-shots.mjs`, `tests/staff.test.ts` | D |
| `src/styles.css` | A, only for a shared token; B, C and D style in their own CSS files |
| `scripts/e2e.mjs`, `scripts/e2e-online.mjs`, `docs/ONBOARDING.md` | the Integrate phase (from B's, C's and D's *how to play*) |
| `docs/DECISIONS.md` | A adds *## Real job flow* with four subsections (*Engine and data (A)*, *Technicians' screens (B)*, *The analyst's desk (C)*, *Staff (D)*), each with a placeholder line; each package writes only in its own |

**What each package uses from A** (so it can start without waiting):
- **B**: `s.alerts`; `flowStage`, `flowMove`, `symptomText`, `findingOf`, `siteOf`, `alertFlags`, `alertTier`, `hintsFor`; `manualIndex`, `ipcIndex`, `supplyIndex`, `search`, `complete`, `rowBadges`; `tasksFor`, `taskById`, `benchFor`; `available`, `onOrder`; `cardOf`, `pickCheck`, `installCheck`; `itemById`, `priceAt`; the actions `plan`, `nff`, `mel`, `makeSafe`, `askBench`, `repick`, `dropJob`, `request`, `cancelReq`; `manualCard` for the new keys; `context.pick` in `launchFor`.
- **C**: `cardOf`; `s.reqs`, `s.pos`, `s.cores`; `stockFlags`, `velocity`, `moveClass`, `abc`, `forecast`, `knownDemand`, `suggestRop`, `invValue`, `onOrderValue`; `spendSeries`, `tradeSpend`, `assetSpend`, `budgetVsActual`, `fillRate`, `waitWeeks`, `runway`; `SUPPLIERS`, `FREIGHT`, `priceAt`, `unitPrice`; `search` over `supplyIndex`; `auctionLot`, `invoiceContext`; the actions `approve` (with `buy`), `approveReq`, `deferReq`, `buy`, `setStock`, `returnCore`, `calibrate`, `scrap`, `spendBudget`.
- **D**: the `STAFF`, `BUILDS` and stub signatures (15.4); `raiseAlert`; `takeStock`; `book`; the `Liner` type; the staff actions in the `Action` union and `WEEK_BOUND`; `fitoutDone` wired into `finishProjectIfDone`; the hooks called from `resolveWeek` and `openWeek`; `crossMoves` reading `s.asks`; `alertAog` and `hazardOn` for the island.

**What no package does**: change another package's files; store derived data in the island doc; add an action outside `types.ts` (A defines every action up front, D's included); import from another package's new folder (B, C and D import from A's modules, `kit.tsx` and their own; the only exceptions are the three staff mounts A places).

## 23. Risks and open questions

**Risks, and what this spec does about them**

- **Tedium on a phone.** Every trade job now has search steps. Kept to 2–3 taps per step (17.2) with chips at tiers 0–2, the IPC figure opened from the slot, bench stock drawn on its own, drafts that survive closing the sheet, and *Recent on this airplane* at tier 3+. If playtests still find it slow, the first lever is to open the Manual step with the chapter chip already set from the symptom at tier 3 too.
- **Gridlock.** MEL, make safe, petty cash at plan time, standing approvals at the resolve, autopilot within a cap, the AOG boat that always runs, legacy orders that keep working, and a stop that never blocks (repick or research).
- **Balance.** New capex (tools and builds, about $5,700 over a game) and the staff's random effects. The knobs and the order are in 20.
- **Doc growth.** Only bounded aggregates are stored; closed alerts, POs and requisitions are kept 2 weeks; tested at week 52 (21.1).
- **Speed.** An airplane's IPC index is built once per airplane state (LRU of 12); analytics are memoized per state; bots never search.
- **The truth sits in the doc.** An alert's hidden cause, like a hidden defect, is readable with developer tools. Acceptable for three friends (the trust model already says so).
- **Migration.** Legacy orders run beside flow jobs; a mid-week doc keeps its turns; six base-engine fixtures and the live ones prove it (19.4).
- **Merge conflicts.** One owner per file (22); A lands first; mounts and icons are placed by A.
- **Realism, knowingly simplified.** Prices are scaled to the game's weekly economy; lead times are counted in weeks; one supplier and one alternative per trade; no sales tax; makers and P/Ns are fictional in the aircraft.ts style; the NEC references are the 2023 edition.

**Open questions for the three of you** (defaults in brackets)

1. At tier 3+, should tapping a part slot open the IPC at the task's figure (a real AMM task points to its figure), or at the IPC's front? [the figure]
2. Is a *Recent on this airplane* chip row at tier 3+ a fair memory aid, or too much help? [keep it, unmarked]
3. Do you want the optional cottages (an investment the analyst can make from tier 3)? [only if the island art has room]
4. Wages: a skill-3 pilot at $320 a week and a builder at $260 are game money, scaled like the rest. Too cheap to matter, or about right? [as is; tune after a playtest]
5. How often should hard landings happen with an average pilot? [3% of flights, about one every 4 weeks at tier 2]
