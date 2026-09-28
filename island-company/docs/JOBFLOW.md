# The real job flow, the analyst's purchasing and finance tracking, and NPC staff: implementation spec

Status: spec for the build, revised after the critique round (Engine A, Tech UI B, Analyst UI C, NPC staff D). Base commit `6c0c426` (ENGINE_VERSION 2, DOC_VERSION 2).
This document is the contract between the four work packages. Where it names a type, a function, a file or a number, build that. Where it says **tune**, the number is a starting value that the balance run may move (record the final value in `docs/DECISIONS.md`, section *Real job flow*).

**What the critique round changed** (for anyone who read the first draft):
- **v1 is smaller** (0.3). The full search-and-stock flow covers the high-volume jobs; rare jobs carry one pre-filled material line. Deferred to v2: the ignition and hot-section kinds, six of the seven new IPC figures, cores, calibration, tool wear, shelf life, FIFO lots, online backorders, ABC classes, spend budgets, line crew, the groundskeeper, morale, raises, traits and staff asks.
- **No gridlock, by rule** (0.2 rule 8, 8.4, 8.5, 9.4). In stock → do it now at any tier, on the trade's work budget. Cards stay approvable after the analyst's End turn. A standing limit approves late cards at the resolve. A lead-1 part rides this week's carrier. The only guest plane goes AOG past due like any plane, and a mainland sub-charter flies its guests meanwhile, automatically (10; 2026-09-28).
- **Money per job is verified** (8.3). Every v1 task × model × island tier × health band lands at 0.96–1.16 × today's card. A scratch script checked this against the real `orderCost`, `orderTier` and catalog, with the spec's prices. Wire is sold by the foot, the twin's inspection and oil change cost more (two engines), and so does the cargo plane's starter-generator.
- **Stock can't give the answer away** (0.2 rule 7, 6.4, 9, 14). There is near-miss stock on the shelf, the analyst's screens show no effectivity, and needs for unplanned alerts carry no P/N. Supersession badges are built from `judgePart`.
- **Inventory is FP&A-correct** (9, 14). The spec now has one inventory-position formula, an allocation rule, soft reservations, stores bins, and commitments with payables (net 7, matched before payment). Velocity is measured per item family over 26 weeks, and insurance spares are never flagged to stop.
- **Trade realism fixes** (3, 4, 5, 11). The oil figure now matches the logbooks. There is a tube-type tire leak, a real shower-tingle diagnosis, receptacle replacement rules with a protection slot, a spa take-off that matches the conduit puzzle, bench findings that agree with the fault, a mechanic return to service after a wiring fix, and MEL C at one resolve.
- **NPC staff v1** (15) has pilots, housekeepers and builders, with hire, let go and skill. Every card states what the hire does for this island. Builders no longer gate a tier: they set how new buildings start, and they build optional cottages.
- **Sharper split** (22). A owns the Dock and the End-turn check; B and C own what they open. Week 0 and the What's new sheets have owners. A lands as three commits.

**Contents.** 0 What the owner asked for · 1 What each seat does now · 2 Data model · 3 Catalog content · 4 Tasks · 5 Alerts · 6 Search · 7 Engine actions · 8 The flow on orders · 9 Inventory and purchasing · 10 MEL, make safe, AOG, closed houses · 11 Wrong choices surface later · 12 The week, in order · 13 The part chain as a branch · 14 Finance tracking · 15 NPC staff · 16 Whose move it is · 17 Screens · 18 Bots and autopilot · 19 Migration and the version gate · 20 Balance plan · 21 Test plan · 22 Work split and file ownership · 23 Risks and open questions · 24 Rejected critique · 25 Decisions the owner should know about.

**Who reads what.** A: all of it. B (technicians' screens): 0, 2, 3, 4–8, 10, 11, 16, 17.1, 17.2, 17.5, 21.2, 22, 24. C (the analyst's desk): 0, 2, 3, 7–9, 14, 16, 17.1, 17.3, 17.5, 21.3, 22, 24. D (staff): 0, 2.6, 3.5, 5.2 (`M_HARD_LANDING`), 10, 12, 15, 16, 17.4, 20.6, 21.4, 22, 24.

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
   │ MEL C: placard INOP, keep flying       │ Make safe: breaker off & tagged / blank-off
   │ Ask the electrician to meter it        │
   ▼                                        ▼
 MANUAL  search the AMM task index        REFERENCE  search the code & procedure
         (chapter chips, fuzzy search)               reference (NEC articles)
   ▼                                        ▼
 PARTS   search the airplane's IPC        MATERIALS  search the supply catalog
         (P/N, effectivity, SUPSD BY);    & TOOLS    (wire by the foot, breakers, GFCI/AFCI/
         "Not in the IPC" → the part                 DF, TR/WR, boxes, conduit, tools)
         chain's research branch
   ▼                                        ▼
 STOCK   each line: on hand / on order + ETA / none  ←── same step, same badges
   ▼  everything on hand: READY now, on the trade's work budget (any tier)
   ▼  anything missing: a CARD / requisition for the analyst (vendor, freight)
 DELIVERY at the resolve: this week's carrier (lead 1), paperwork, P/N vs the
          work order, into stock, allocated to the waiting job
   ▼
 JOB     the existing puzzle is the hands-on step (fed the task card and the parts)
   ▼
 SIGN-OFF consumes what was pulled. Wrong task, wrong P/N, wrong breaker or wire:
          nothing shows now; it comes back later as an incident or an inspection find.
```

The analyst sits in the middle. They stock ahead of demand (min/max per item, stores bins), buy what the techs request, pick vendor and freight, set the trades' work budgets and the standing limit, watch which item families move fast or slow, what the stock ties up and what's committed and payable, and hire the island's NPC staff (pilots, housekeepers, builders). NPCs never do mechanic, electrician or analyst work.

### 0.2 Design principles (apply everywhere)

1. **Planning is local, one write per job.** The Investigate, Manual and Parts steps are pure UI over derived data (no engine writes, no doc growth). The engine sees one `plan` action with the chosen task and pick list. A player who leaves mid-way loses nothing stored; the UI keeps the draft in `sessionStorage` per alert.
2. **The truth is in the doc, hidden by the UI.** Each alert stores its hidden cause (`kind`, `cause`) like `s.defects` does today. The UI never shows it before the job is signed off. Trust model unchanged (three friends).
3. **Derive, don't store.** Items, task indexes, search indexes, IPC rows, findings, electrical sites, forecasts, families and their velocity classes, inventory position and whose-move are functions of the seed, the code and the stored state. Stored: alerts, orders, stock lines, purchase orders, requisitions, EA records, the 26-week ledger, staff, this week's candidates, builds.
4. **Same job volume, same money per job.** Alerts are drawn with today's catalog weights and slot rules, so the number of jobs per week is unchanged. A job's labour plus its standard parts equals today's card cost (plus today's kit value for jobs that needed a kit), within 0.85–1.25. There are three deliberate exceptions, where the airplane really costs more: the twin's 100-hour and oil change (two engines) and the cargo plane's starter-generator. ICA parts on altered airplanes are dearer by design (8.3).
5. **The standard crew reproduces today.** The standard NPC crew for each tier, at skill 3, gives exactly today's flights and bookings. Its payroll plus the tier's overhead equals today's fixed cost. New buildings start at today's health when the builders have finished the site work. Hiring better, worse, more or fewer staff moves the numbers from there.
6. **Old islands keep playing.** Every new field is optional. `migrate()` (v2 → v3) is pure, deterministic and idempotent, and runs inside `apply()` and in the UI's read path. Players get two weeks of teaching-level hints after the update (17.5).
7. **Teaching tiers teach, tier 3+ tests, and stock never answers the test.** Tiers 0–2 suggest: keyword chips, likely tasks, "◀ this airplane", and supersession badges built from `judgePart` ("SUPSD: order TR-155-02 (INTCHG 2)", "SUPSD BY 066-19600 only as the SB set: this airplane takes 066-19500"). Tiers 0–1 may also flag a wrong pick before commit; tier 2+ never does. From alert tier 2, nothing on the analyst's screens names an effectivity. The shelf holds near-miss stock beside the right P/Ns, so "on hand" never means "right" (9.8, 19.3). Needs for alerts nobody has planned carry no P/N (14.2). Tier 3+ shows the book as printed.
8. **No gridlock, written as rules and tested** (21.1):
   - *One session per seat per week keeps a stocked plane flying.* A plan whose lines are all on hand goes straight to Ready on the trade's work budget, at any tier. Airworthiness and hazard work may run past the budget. The tech plays it in the same session.
   - *A part ordered the week its alert appears arrives that week's resolve* (lead 1: `eta = week + lead + leadAdd − 1`). The analyst's approval is never the bottleneck: cards and requisitions stay approvable after the analyst's End turn, and at the resolve a standing limit approves what came in after it (8.5).
   - *The only guest plane is grounded past due like any plane, and nobody has to act for its guests.* It gets no no-go squawks (the early-sign wording, 5.6). Past due it's AOG, and a mainland sub-charter flies the guests in at the island's cost (10; 2026-09-28, it used to fly restricted).
   - MEL C, make-safe, autopilot for absent seats, and the AOG boat stay as backstops.

### 0.3 What's in v1 and what waits for v2

| Area | v1 (this build) | v2 (not in this build) |
| --- | --- | --- |
| Mechanic jobs | Full flow (Investigate, AMM search, IPC search, stock, card) for inspections, oil, tires and brakes, prop and safety wire, hydraulics, com radio, alternator/starter-generator, generator service: about 90% of the mechanic's jobs. The rare cylinder job keeps its task search, with its part as one pre-filled line. | The ignition kinds (plugs, magneto: the critique's prices in 24), the hot-section kind, figures 72-30, 74-10, 74-20, 57-10, 24-40, 78-10 (with the engine maker's parts catalog for 72-30 and 74-xx). |
| IPC | The five existing figures plus a new **79-20 Oil filter and drain** that matches the logbooks | the six figures above |
| Electrician jobs | Full flow with slots for outlet, GFCI, water heater, bonding, 3-way, code prep, flicker, hot tub, feeder, dead circuit, generator test: about 88% of the electrician's jobs. The rare jobs (storm, panel, transfer switch, fuel dock) carry one pre-filled job-lot line each. | slot-level take-offs for the rare jobs (THWN by the foot, 60 vs 100 A transfer switch, RMC and seal at the dispenser) |
| Stock | on hand, reservations (soft before approval), allocation, min/max, replenishment, stores bins, near-miss stock, receiving paperwork, broker quarantine, scrap, store credit | cores and deposits, calibration, tool wear, shelf life and FIFO lots, online backorders |
| Tools | owned or not (both trades); a missing tool goes on the job's card, or on a standalone request | calibration program (mechanic torque wrenches, the N2 gauge, the electrician's torque tool, 52 weeks) |
| Money | commitments, payables net 7 after the three-way match, a small carrying charge (0.1% a week), the cost of cash tied up as an analytic, work budgets per trade, the standing limit | spend budgets, ABC classes |
| Finance tracking | the ledger; families ranked fast/steady/slow/dead over 26 weeks; stock built vs used; where the money went; fill rate by value | per-P/N forecasting |
| Staff | pilots, housekeepers, builders: hire, let go, skill; the hiring board with effect statements; builds (site work); optional cottages | line crew (turnarounds and tows only, never carts: tows then need a 57-30-01 wing-tip task), groundskeeper, morale, raises, traits, staff asks |

## 1. What each seat does now

| Seat | Before | Now |
| --- | --- | --- |
| Mechanic | Tap a generated work order, play the puzzle | Alerts arrive (squawks, trends, wear, due items, ADs, hard landings). Investigate, find the task in the AMM, find the P/N in the airplane's IPC. If it's all on hand, the job is ready at once; if not, it goes to the analyst as a card. He can also MEL-defer, ground the plane, or ask the electrician to meter a unit, and then plays the puzzle. Inspections skip straight to Start; ADs and write-ups open with the task filled in. Load sheets, ground power starts, reports and chain paperwork keep their flow. |
| Electrician | Same | Guest complaints, utility readings, code notices and install take-offs arrive. Investigate, find the procedure and its NEC basis, pick materials (including the AFCI/GFCI protection a replacement needs) and tools, and make the site safe. On hand: ready at once; missing: a card or a requisition. Then play the puzzle. He also meters an airplane circuit when the mechanic asks. |
| Analyst | Swipe approvals on job costs, buy generic kits, desk puzzles, pricing | Swipe approvals now carry the parts to buy (vendor, freight). Standalone requisitions (tools, stock requests). The stock planner: families fast/slow, min/max, bins, the needs of unplanned alerts with a Nudge. Receiving, payables and commitments. Work budgets and the standing limit. Finance tracking. Hiring and payroll. Desk puzzles stay, fed real items (auction lots, a three-way match on real POs before they're paid). |

## 2. Data model

All new state is optional on `IslandState`. Types live in `src/sim/types.ts`: package A writes all of them up front, including the NPC types package D fills in. `ItemId` is the item's P/N or catalog number, unique across the whole catalog (a test enforces it).

### 2.1 Items (derived, never stored)

```ts
// src/sim/types.ts
export type ItemId = string;
export type ItemKind = 'part' | 'consumable' | 'rotable' | 'material' | 'lot' | 'tool';
export type ItemTrade = 'mech' | 'elec' | 'build';
/** chapter browse in the supply catalog and the stock planner */
export type ItemCat =
  | 'wheels' | 'brakes' | 'tires' | 'prop' | 'hydraulic' | 'avionics' | 'dcpower' | 'engine' | 'airframe' | 'hardware' | 'fluids' | 'generator' | 'repair' // mech
  | 'wire' | 'cable' | 'breakers' | 'devices' | 'boxes' | 'conduit' | 'connectors' | 'grounding' | 'equipment' | 'lots' | 'tools' // elec
  | 'site'; // build

export interface ElecSpec {
  amps?: number; poles?: 1 | 2; awg?: number; conductors?: number;
  gfci?: boolean; afci?: boolean; df?: boolean; gfpe?: boolean;   // a DF device is both
  form?: 'receptacle' | 'breaker' | 'panel';                      // where the protection sits
  tr?: boolean; wr?: boolean; inUse?: boolean; single?: boolean;
  volume?: number;                                   // box, cubic inches (314.16)
  method?: 'nm' | 'uf' | 'thwn' | 'bare';            // wiring method (334, 340, 310)
  raceway?: 'emt' | 'pvc40' | 'lfnc';
  size?: '1/2' | '3/4' | '1';                        // raceway trade size
  fitting?: 'setscrew' | 'raintight';                // EMT connectors (358.42)
  burial?: boolean;                                  // splice listed for direct burial (300.5(E), 110.14(B))
}

export interface Item {
  id: ItemId;               // = pn
  pn: string;
  nomen: string;            // as the IPC or the catalog prints it
  trade: ItemTrade;
  kind: ItemKind;
  cat: ItemCat;
  fam: string;              // the family (14.2): 'tire:twin', 'lining:cargo', 'oilFilter:float', 'gfci20', 'thwn6', 'site:deck'
  unit: 'ea' | 'use' | 'ft' | 'qt' | 'gal' | 'set' | 'lot';
  pack: number;             // units per purchase pack (a spool of safety wire is 25 uses; #6 THWN-2 is a 500 ft spool, cut to length)
  packName?: string;        // 'spool' | 'roll' | 'case' | 'box' | 'bag' | 'bundle' | 'stick' | 'kit' | 'lot'
  cut?: boolean;            // sold cut to length: buy any number of units, not whole packs (wire by the foot)
  price: number;            // USD per pack at list, flat (list prices don't rise with the island tier); a unit costs price / pack
  lead: number;             // weeks by scheduled freight, >= 1 (1 = this week's carrier)
  bulk?: boolean;           // rides the cargo plane (from tier 2), not a guest flight's hold: cases, coils, bundles, rotables, wheel assemblies
  supsdBy?: { pn: string; code: 1 | 2 | 3 };  // as the IPC prints it (mech)
  models?: ('twin' | 'cargo' | 'float')[];    // mech: planes whose IPC lists it; undefined = shop-wide
  ica?: string;             // an STC / field-approval (ICA) part: the holder
  pma?: string;             // an FAA-PMA replacement: its eligibility text
  spec?: ElecSpec;          // electrical
  nec?: string[];           // NEC basis (electrical items and tools)
  tags: string[];           // search keywords and synonyms
}
```

`src/sim/items.ts` (A) exports `itemById(id)`, `ITEMS` (static shop, electrical, lot, tool and building items), `planeItems(model)` (built from the IPC figures of every effectivity plus the ICA and PMA rows), `famOf(id)`, `priceAt(item, vendor?)` and `lineValue(line)`. **List prices are flat.** Labour carries the tier scaling through today's `orderCost` (8.3), so the velocity and average-cost charts never step at a tier-up. (The part chain keeps `CHAIN.perTier` for its own card; that's legacy money, 13.)

### 2.2 Stock, purchase orders, requisitions, EA records (stored)

```ts
export interface StockLine {
  on: number;                     // units on hand, reserved ones included
  res?: Record<string, number>;   // orderId -> units reserved for that job (soft while the job's card is pending: 9.2)
  rop?: number;                   // reorder point on inventory position (9.1); rop/max absent = not auto-replenished
  max?: number;                   // order-up-to level
  avg?: number;                   // moving-average unit cost, for valuation
  got?: number;                   // week the line was first received (the 'new' class)
}

/** purchasing suppliers (not aircraft.ts VENDORS, which are the makers' CAGE codes) */
export type SupplierId = 'oem' | 'broker' | 'supply' | 'online' | 'yard' | 'barge';
export type Freight = 'sched' | 'aog';
export type BuyChoice = { vendor?: SupplierId; freight?: Freight };

export interface PoLine { item: ItemId; qty: number; unit: number /* USD per unit */; order?: string; req?: string; hold?: string /* the document missing */ }
export interface PurchaseOrder {
  id: string;                     // 'po12'
  week: number;                   // placed (committed)
  vendor: SupplierId;
  freight: Freight;
  eta: number;                    // the week whose resolve delivers it
  lines: PoLine[];
  cost: number;                   // lines + freight: committed when placed, paid at the payment run after receipt (9.7)
  freightCost: number;
  by: Role | 'auto';              // 'auto': work budget, standing approval, replenishment, autopilot, migration
  status: 'open' | 'held' | 'received' | 'paid' | 'returned';
  hold?: number;                  // receiving quarantine: released at this week's resolve
  got?: number;                   // week received
  paid?: number;                  // week paid
  caught?: number;                // USD the three-way match withheld (an overbilling it found)
  notes?: string[];               // receiving: "shipped as TR-155-02 (supersedes TR-155-01, INTCHG 2)", "held: no 8130-3 with the exchange unit"
}

export interface Requisition {
  id: string;                     // 'rq7'
  week: number;
  at: number;                     // ms, the `now` of the action (standing approvals, 8.5)
  role: OpsRole;                  // who asked
  item: ItemId;
  qty: number;
  order?: string;                 // the job it is for; none = a stock or tool request
  status: 'open' | 'ordered' | 'filled' | 'cancelled';
  po?: string;
  why?: string;                   // stock requests: the tech's note ("L/H tire at 2/32 on Twin N-12")
  deferredWeek?: number;
}

export interface EaRecord { assetId: string; ata: string; tag: string; pn: string; ea: string; week: number }
```

### 2.3 Alerts (stored)

```ts
export type AlertSrc =
  | 'squawk' | 'trend' | 'wear' | 'due' | 'ad' | 'finding' | 'again' | 'landing'   // mech
  | 'guest' | 'utility' | 'code' | 'takeoff';                                     // elec (plus 'finding', 'again')

export interface Alert {
  id: string;                     // 'a31'
  role: OpsRole;
  assetId: string;
  sym: string;                    // SYMPTOMS key (src/sim/alerts.ts); the text, the finding and the site derive from it and `seed`
  src: AlertSrc;
  week: number;                   // raised
  due: number;                    // from this week's resolve an unfixed fault bites (== week: it bites now)
  seed: number;
  kind: string;                   // HIDDEN: the catalog kind that fixes it; 'nff' = nothing wrong; 'wiring' = the electrician's fix (5.4); 'repair'
  cause: number;                  // HIDDEN: the cause's index in the symptom (its finding and what it needs derive from it)
  looksNff?: boolean;             // HIDDEN: a real fault whose Investigate shows the NFF finding (tier 3+ intermittents, 5.1)
  status: 'open' | 'job' | 'closed';
  order?: string;                 // the job planned from it
  mel?: { until: number; by: string; ext?: boolean };           // placarded INOP under the company MEL (category C, 10)
  safe?: { how: 'breaker' | 'blankoff'; week: number; by: string };
  bench?: { order?: string; call?: 'unit' | 'wiring'; by?: string; week?: number; again?: boolean };
  repair?: RepairInfo;            // kind 'repair': the defect and how it came to light (today's RepairInfo)
  again?: number;                 // re-raised: the week of the sign-off or NFF close that didn't fix it
  who?: string;                   // the pilot who wrote it up or landed hard (from staff)
  nudged?: number;                // the week the analyst last nudged the trade about it
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
  pick: { item: ItemId; qty: number }[];          // what the tech chose (a rare job's pre-filled line counts as a pick)
  bench: { item: ItemId; qty: number }[];         // what the task draws on its own: consumables
  tools: ItemId[];                                // the task's shop tools (owned or requisitioned; never consumed)
  reqs?: string[];                                // requisitions for an approved job's new shortfall (a pending card's shortfall lives on the card: 8.6)
  research?: boolean;                             // the part chain's research branch holds this job (not in the IPC)
  queued?: boolean;                               // research waits for the open chain to close
  bom: number;                                    // value of pick + bench at plan time (USD)
  stop?: string;                                  // the job stopped at receiving or the install: why ("P/N 066-19500 doesn't fit: …")
}
// Order gets: flow?: JobFlow; at?: number (ms, created); bench?: string (an electrician's bench order: its alert)
```

The stage a player sees is derived (`flowStage(s, alert)` in `src/sim/flow.ts`), never stored:

| Stage | When |
| --- | --- |
| `new` | alert open, no job |
| `bench` | waiting on the electrician's circuit check |
| `approval` | job `pending` (a card on the desk) |
| `parts` | job `waiting_part`: POs in transit or held, a tool on order, requisitions of an approved job open |
| `research` | the part chain's research branch holds the job (or it is queued) |
| `ready` | job `ready` |
| `done` / `closed` | job signed off / alert closed |

Flags shown beside the stage: `mel` (placarded), `safe` (made safe), `aog` (the plane is grounded by it; on the only guest plane also `sub-charter`: its guests fly in on the mainland sub-charter), `shut` (the house is closed by it), `due` (week).

### 2.5 Ledger (stored, bounded) and budgets

```ts
export type SpendCat = 'parts' | 'consumables' | 'rotables' | 'materials' | 'tools' | 'building' | 'freight' | 'labor' | 'carry' | 'payroll' | 'overhead' | 'eng';
export interface WeekLedger {
  w: number;
  rev: number;                                    // revenue, net of refunds
  cash: number;                                   // cash at week end
  sp: Partial<Record<SpendCat, number>>;          // cash out by category (POs at payment, 9.7)
  tr: Partial<Record<'mech' | 'elec' | 'build' | 'fin', number>>;  // cash out by trade
  as?: Record<string, number>;                    // parts consumed + labour, by asset (sparse)
  use?: Record<ItemId, number>;                   // units consumed (sparse: only items that moved)
  usedV?: number;                                 // value consumed at average cost (stock used)
  rcvV?: number;                                  // value received into stock (stock built)
  inv: number;                                    // inventory value at week end (moving-average cost)
  loss?: number;                                  // written off: scrapped consumables, the 25% lost on a return (value, non-cash)
  fill?: [number, number];                        // main-slot value covered from stock at plan / main-slot value planned
  wait?: number;                                  // job-weeks spent waiting on parts
  cr?: number;                                    // store credit used at payment
  aog?: Partial<Record<'stock' | 'approval' | 'plan' | 'carrier', number>>;  // plane-weeks AOG on an alert, by cause (20.5)
}
// IslandState gets: ledger?: WeekLedger[]  (last 26 weeks); standing?: number (the standing limit, 8.5)
```

`autoBudget` (today's petty-cash budget per trade) is renamed **work budget** in the UI and keeps its field. It is a delegated approval limit (a maintenance lead's spending authority), not a cash box: it covers the labour of jobs whose lines are all on hand (8.4).

### 2.6 NPC staff (stored; package D implements the behaviour)

```ts
export type NpcRole = 'pilot' | 'housekeeper' | 'builder';
export interface Npc { id: string; name: string; role: NpcRole; skill: 1 | 2 | 3 | 4 | 5; wage: number; hired: number; start: number }
export interface Candidate { id: string; name: string; role: NpcRole; skill: 1 | 2 | 3 | 4 | 5; ask: number; start: number }
/** `done`: work units done (fractional); `drawn`: units whose materials have left stock; `need`: units (BUILDS, 15.5) */
export interface Build { id: string; what: string; tier?: number; cottage?: string; done: number; drawn?: number; need: number; started: number; finished?: number; rework?: number; idle?: number }
// IslandState gets: staff?: Npc[]; hiring?: { week: number; cands: Candidate[] }; builds?: Build[]
```

### 2.7 New `IslandState` fields (all optional) and what old islands read

| Field | Meaning | Absent (old island) reads as |
| --- | --- | --- |
| `alerts` | open + recently closed alerts | `[]` (the next week open raises alerts) |
| `inv` | `Record<ItemId, StockLine>`, sparse | migrated: starter stock with near-miss lines (19.3) |
| `pos`, `reqs`, `eas` | open, unpaid and last-2-weeks ones | `[]` |
| `credit` | vendor store credit, USD (migrated kits) | `0` |
| `standing` | the standing limit a week (8.5) | the two work budgets' sum |
| `ledger` | finance tracking | backfilled from `history` at migration |
| `staff`, `hiring`, `builds` | NPC staff | migrated: the standard crew for the tier (15.8) |
| `flowSince` | the week the job flow started on this island (17.5) | migrated: the migration week; new islands: 1 |
| `parts` | **retired** (was the generic kits) | converted by `migrate()`; the type becomes optional and unused |

`Order` gets `flow?`, `at?`, `bench?`. `Defect` gets `alert?: { sym: string; kind: string; alert: string }` (a wrong-task defect remembers the fault it left), and `puzzle` widens to `PuzzleId | 'flow' | 'elec'` (rule keys like `elec:nogfci`). `WeekReport.costs` gets optional `overhead`, `payroll`, `carry`, `freight`, `labor`, `parts` (cash out that week by category); `fixed` stays = overhead + payroll so old renderers keep working. `TierDef` gets `overhead` and `bins`.

### 2.8 Stored vs derived, in one table

| Stored in the island doc | Derived every read (never stored) |
| --- | --- |
| alerts (id, sym, src, week, due, seed, hidden kind and cause, status, MEL, make-safe, bench, repair, again, who, nudged) | symptom text, finding text, the electrical site, MEL category, airworthiness and hazard flags, the fix tasks, alert tier, keyword chips, whether the plane is grounded and the sub-charter flies its guests |
| orders' `flow` (task, pick, bench, tools, reqs, bom, stop) | flow stage, whose move, the stepper, soft vs hard reservations |
| stock lines (on hand, reservations, ROP/max, average cost, first received) | available, inventory position, on order, ETA, bins in use, families, velocity, classes, insurance spares, suggested ROP, flags, needs |
| POs, requisitions, EA records, store credit, the standing limit | inventory value, committed, payable, spendable cash, cost of cash tied up, spend by category over time |
| ledger (26 weeks, sparse) | charts, stock built vs used, fill rate, waits |
| staff, this week's candidates, builds | payroll, capacity (flights, turnovers), effects, effect statements, fixed cost now |
| — | items, IPC rows (all figures, effectivity for this airplane), AMM task index, NEC reference, supply catalog, search indexes |

Doc growth budget: a week-52 three-friends island stays under 150 KB of JSON (today about 35 KB); the new state adds at most 40 KB (test in section 21).

## 3. Catalog content

Makers, P/Ns and CAGE codes are fictional in the aircraft.ts style; specifications (MIL, MS, AN, SAE, ASTM) and NEC articles (2023 edition) are real. Prices are USD at list, **flat across island tiers**, chosen to be believable to each trade and checked so that a job's labour plus its standard parts lands on today's card (8.3). Rotables are priced at the overhauled-exchange price: the core goes back in the exchange unit's box (no deposit, nothing to track). `use` = a consumption unit for bench stock drawn in small amounts (a spool of safety wire serves 25 jobs). `bulk` lines ride the cargo plane (3.6).

### 3.1 Mechanic, per plane: the IPC, plus one new figure (A, `src/sim/aircraft.ts`)

**Hard constraint.** Every live island's airplanes are rebuilt from the seed. Do not change `aircraftOf`'s random streams, `IPC_ATAS`, `PLANT_ATAS`, `figSb` for the five existing ATAs, the SB loop, or any existing figure row. `tests/aircraft-golden.test.ts` must pass unchanged. v1 adds one figure beside the old ones:

```ts
export type Ata2 = '79-20';
export type AnyAta = Ata | Ata2;
export const ALL_ATAS: readonly AnyAta[] = [...IPC_ATAS, '79-20'];
export function ipcFor(ac: Aircraft, ata: AnyAta | string): IpcFigure   // extended: '79-20' builds fig7920(model) (no effectivity codes: one row per item)
export function figuresFor(ac: Aircraft): IpcFigure[]                     // every figure this model has (the 5 + 79-20), in ATA order, for the IPC index
```

`ataOf` accepts `'79-20'`; `findPart` keeps searching `IPC_ATAS` only (the logbook puzzle depends on it). **Figure numbers** follow the existing ones in ATA order: twin 79-20 → Fig 58, cargo → Fig 60, float → Fig 46; a test checks figure numbers are unique per model. New maker (fictional CAGE): Sentinel Filtration V5SF21 (the alternate filter). Brandt Aero Engines (V07BA1) is already the engine maker.

**Fig 79-20** matches what the logbooks already record (`aircraft.ts` `oilEvents`: *"12 qt SAE J1899 20W-50 … filter P/N BAE-481k"*, 11 qt on the float; none on the turbine, whose phase entries say *"Oil level and chip detector checked"*):

| Item | twin: Fig 58, OIL FILTER AND DRAIN (TYPICAL LH AND RH) | cargo: Fig 60, OIL FILTER AND CHIP DETECTOR | float: Fig 46, OIL FILTER AND DRAIN | UPA |
| --- | --- | --- | --- | --- |
| 1 | 0531900-1 OIL SYSTEM INSTL | 0528900-5 OIL SYSTEM INSTL | 0518900-1 OIL SYSTEM INSTL | RF |
| 2 | BAE-48119 FILTER, OIL (V07BA1) | NT3031-14 ELEMENT, OIL FILTER | BAE-48112 FILTER, OIL (V07BA1) | 1 |
| 2A | SF48119-1 FILTER, OIL · ALT FOR BAE-48119 (V5SF21) | — | SF48112-1 FILTER, OIL · ALT FOR BAE-48112 | 1 |
| 3 | AN814-8DL PLUG, DRAIN (DRILLED) | NT3031-PK PACKING SET, FILTER HOUSING | AN814-8DL | 1 |
| 4 | AN900-10 GASKET, CRUSH | NT3021-8 DETECTOR, CHIP | AN900-10 | 1 |
| 5 | MS20995C32 WIRE, SAFETY, 0.032 IN | MS9068-012 PACKING, CHIP DETECTOR | MS20995C32 | AR |

Tags: `oilFilter` (items 2, 2A on the pistons), `drainGasket`, `oilElement`, `filterPacking`, `chipDetector`, `detectorPacking`. The near-misses are the other model's filter (the float's BAE-48112 is not in the twin's book: *unlisted*) and straight SAE 50 oil on the shelf (3.2), since the card and the logbooks say 20W-50.

**Items from the IPC** (`planeItems(model)`): every tagged row of every figure, in both S/N blocks and both SB states (a superseded or not-effective P/N is still orderable: that is the near-miss), plus the plant ICA rows (`plantRows`) and PMA P/Ns (`pmaDef`). Kinds: rotables = com radio, alternator, starter-generator, hydraulic power pack, wheel assembly; consumables = O-rings, gaskets, rivets, cotter pins, crush gaskets, packings; everything else `part`. `fam` = tag + model (`'lining:twin'`): every P/N that fills the same slot on the same model, whatever its block, SB state or ALT (14.2). Prices by tag (flat; ICA parts ×1.35 = `CHAIN.icaMult`; PMA ×0.8):

| Tag / item | Pack | Price | Lead | Notes |
| --- | --- | --- | --- | --- |
| Tire OG- / SW- (ALT): 6.50-10 8 ply · 8.50-10 10 ply · 5.00-5 6 ply | ea | 285 / 410 / 120 (SW- 250 / 360 / 105) | 1 | twin / cargo / float; TUBE TYPE on every model |
| Tube | ea | 72 / 95 / 38 | 1 | |
| Brake lining 066-k500 (EFF D, organic) / 066-k600 (EFF C, metallic) | ea | 62 / 84 | 1 | 066-k500 SUPSD BY 066-k600 **INTCHG CODE 3**: only as the SB set with back plate 069-k450. UPA 2 per brake; the AMM does both mains: 4 |
| Lining rivet 105-00500 | bag 50 | 18 | 1 | 4 per lining |
| Brake disc 164-0k00 (A) / 164-0k50 (B) | ea | 260 / 290 | 1 | |
| Wheel assy 40-k0A / 40-k0B (halves NP: order the assy) | ea | 1,450 / 1,520 | 2 | bulk, rotable |
| Tie bolt 103-0k00 · tie nut 095-0k20 | ea | 9 · 6 | 1 | 6 each per wheel |
| Bearing cone · cup · grease seal 154-0k00 → -01 (code 1) | ea | 58 · 44 · 14 | 1 | |
| Cotter pin MS24665-302 | box 100 | 14 | 1 | shop-wide |
| O-rings MS28775-227 (brake piston) · MS28775-228 (filter bowl) · MS29513-116 (filler cap) | bag 10 | 22 | 1 | |
| Prop bolt B-k413-1 (EFF D) → B-k413-3 (EFF C, **code 2**) | ea | 62 | 1 | UPA 6; a real code-2 pair |
| Hub O-ring MS29513-238 | ea | 9 | 1 | |
| Spinner dome · fwd bulkhead (A/B) · aft bulkhead | ea | 380 · 190 · 170 | 2 | |
| Hydraulic filter element DH-k40-10 → -11 (code 1) | ea | 110 | 1 | PMA PFk40-11: 88 |
| Reservoir cap DH-k31 → -1 (code 2) | ea | 130 | 1 | |
| Hydraulic power pack DH-k02-3 (A) / -5 (B) | ea | exchange 1,900 | 2 | bulk, rotable |
| Com transceiver TR-155-01 (EFF D) → TR-155-02 (EFF C, **code 2**) | ea | exchange 950 | 1 | bulk, rotable; ICA NX-430-00: exchange 1,280 |
| Tray TR-155-MT (A) / MT2 (B) · connector kit TR-155-CK · cam-lock screw TR-155-LS | ea | 240 · 85 · 12 | 1 | |
| Alternator HA-24k-2 → -4 (code 2) | ea | exchange 760 | 1 | bulk, rotable; ICA VM-70-28-k: exchange 1,030 |
| Starter-generator HSG-250-3 → -5 (code 2) (cargo) | ea | exchange 1,350 | 1 | bulk, rotable; ICA VM-SG300-k: exchange 1,820 |
| V-belt HA-B(k+19) / ALT B(k+19)-AX · pulley nut · brush assy / set | ea | 38 / 29 · 12 · 95 / 180 | 1 | |
| Oil filter BAE-481k / ALT SF481k-1 (pistons) | ea | 30 / 26 | 1 | |
| Drain plug AN814-8DL · crush gasket AN900-10 | ea · bag 25 | 18 · 15 | 1 | |
| Oil filter element NT3031-14 · packing set NT3031-PK · chip detector NT3021-8 · detector packing MS9068-012 (cargo) | ea | 210 · 18 · 140 · 6 | 1 | |

### 3.2 Mechanic: shop consumables, generator parts, rare-job and repair lines (A, `ITEMS`)

| P/N (id) | Nomenclature | Unit / pack | Price (pack) | Bulk | Used by |
| --- | --- | --- | --- | --- | --- |
| MS20995C32 | Safety wire, 0.032 in, CRES (1 lb spool) | use / 25 | 28 | | prop bolts, filter bowl, drain plug, oil filter, inspections |
| MS20995C41 | Safety wire, 0.041 in, CRES (1 lb spool) | use / 25 | 30 | | near-miss (the IPCs call .032) |
| MS24665-283 | Cotter pin, 1/16 × 3/4 in | box 100 | 12 | | near-miss for MS24665-302 |
| MIL-PRF-5606 | Hydraulic fluid, petroleum base (red), 1 qt | qt / case 12 | 216 | bulk | brakes, power pack |
| MIL-PRF-83282 | Hydraulic fluid, synthetic hydrocarbon (red), 1 qt | qt / case 12 | 312 | bulk | power pack where the card allows it (POST SB) |
| SAE-J1899-2050 | Aviation piston oil, SAE J1899 20W-50, ashless dispersant, 1 qt | qt / case 12 | 96 | bulk | oil change and 100-hour: 12 qt per twin engine, 11 on the float |
| SAE-J1899-50 | Aviation piston oil, SAE J1899 straight 50, 1 qt | qt / case 12 | 90 | bulk | near-miss: the card and the logbooks say 20W-50 |
| MIL-PRF-23699 | Turbine oil, 5 cSt synthetic, 1 qt | qt / case 12 | 264 | bulk | the cargo's top-ups (no v1 job line) |
| MIL-PRF-81322 | Wheel bearing grease, 14 oz tube | use / 10 | 32 | | wheel and tire |
| MIL-PRF-907 | Anti-seize thread compound, high temperature, 1 lb | use / 20 | 65 | | POST SB prop bolts, cylinder |
| FH-G18 | Gasket, spark plug, 18 mm, copper | bag 50 | 40 | | 100-hour (plugs out, cleaned, gapped and rotated: new gaskets) |
| E1417-KIT | Penetrant kit, ASTM E1417 Type I fluorescent, Method C solvent-removable, sensitivity level 2, non-aqueous developer | use / 3 | 95 | | wheel-half check, spar inspection |
| MIL-DTL-5541 | Chemical conversion coating, Type I Class 1A, 1 qt | use / 10 | 42 | | wheel-half check |
| HPS-OF-60 · HPS-FF-60 · HPS-FB-60 · HPS-ISO-4 · HPS-HOSE-60 | Standby generator (Harborline 60 kW diesel): oil filter · fuel filter · fan belt · mount isolator · lower coolant hose with clamps | ea | 22 · 26 · 35 · 48 · 38 | | generator service |
| API-CK4-15W40 · ELC-5050 | Diesel engine oil 15W-40 (API CK-4), 1 gal · coolant, extended life 50/50, 1 gal | gal / case 4 | 112 · 96 | bulk | generator service |
| BCY520-19X · BCY520-12X | Cylinder assy with piston and rings, overhauled exchange: BIO-520-MB (twin) · BIO-520-D (float) (Brandt parts catalog) | ea | 1,250 | bulk | 72-30-01's pre-filled line |
| BGS520-19 · BGS520-12 | Kit, gasket, cylinder | ea | 65 | | 72-30-01 bench |
| RPR-{job} | *Parts for: {fix title}*: one line per repair fix job (exhaust, wheelhalf, sparcap, brake, receptacle, avionics, alternator, hotsection, wire, outlet) | ea | 340 (today's kit money) | | a repair whose `DEFECT_RULES` fix has `parts: 1` (4.4) |

Bench stock (safety wire, cotter pins, O-rings, gaskets, grease, anti-seize, oil, fluid) is drawn by the task on its own (4.3). The mechanic never searches for it. The analyst keeps it stocked, and it shows in velocity like any other item.

### 3.3 Electrician: materials with the NEC basis (A, `ITEMS`)

Fictional brand "Keystone" for devices and the island panels' breakers (breakers must be listed for the panel they go in, NEC 110.3(B): the island's panels take KP breakers only). Wire and conduit are generic. `spec` carries the fields the pick judge reads (11.3).

**Wire and cable.** THHN/THWN-2 is sold **by the foot**, cut to length from the spool the way supply houses do (`cut: true`). The colors are cut from the same size (black and red hots, white neutral, green EGC), so one item per size. NM-B and UF-B come by the roll.

| id | Item | Unit / pack | Price | NEC basis |
| --- | --- | --- | --- | --- |
| THWN-12 · THWN-10 · THWN-8 · THWN-6 · THWN-3 | THHN/THWN-2 Cu, 12 · 10 · 8 · 6 · 3 AWG | ft (cut) / spool 500 (3 AWG: 250) | 0.20 · 0.32 · 0.65 · 1.00 · 2.20 per ft | in raceway, wet rated (310.10); Table 310.16 at 75 °C: 12 = 25 A, 10 = 35, 8 = 50, 6 = 65, 3 = 100; EGC by Table 250.122 (50–60 A: 10 AWG) |
| NMB-14-2 · NMB-14-3 · NMB-12-2 · NMB-12-3 · NMB-10-2 | NM-B with ground 14/2, 14/3, 12/2, 12/3 (250 ft); 10/2 (125 ft) | ft / roll | 95 · 160 · 140 · 230 · 190 per roll | 334; 240.4(D); 14/3 and 12/3 carry the 3-way travelers (404.2(A)) |
| UFB-12-2 | UF-B 12/2 with ground, 250 ft | ft / roll | 210 per roll | direct burial and wet locations (340.10); NM-B isn't permitted wet (334.12(B)(4)) |
| CU6-BARE | Bare Cu 6 AWG solid | ft (cut) / coil 100 | 1.10 per ft | grounding electrode conductor (250.66(A)); water-pipe bonding jumper (250.104(A)) |
| DBS-2 | Direct-burial splice kit, heat-shrink, #8 to #2, listed for direct burial | ea | 45 | 300.5(E), 110.14(B) |
| SPLIT-4 | Split bolts #4 with rubber and vinyl tape (not listed for direct burial) | use / 10 | 24 | near-miss for DBS-2 in the ground |

**Breakers (KP, listed for the island's panels)**

| id | Breaker | Price | Basis |
| --- | --- | --- | --- |
| KP115 · KP120 | 1-pole 15 A · 20 A | 9 · 9 | protects 14 / 12 AWG (240.4(D)) |
| KP230 · KP240 · KP250 · KP260 · KP270 | 2-pole 30 · 40 · 50 · 60 · 70 A | 22 · 24 · 26 · 28 · 32 | 240 V loads, the spa feed (a 70 A on #6 is the oversized near-miss) |
| KP115AF · KP120AF | 1-pole 15 · 20 A AFCI (combination type) | 48 · 48 | 210.12(A); a replacement's protection (406.4(D)(4)(3)) |
| KP120GF | 1-pole 20 A GFCI | 52 | 210.8(A) |
| KP115DF · KP120DF | 1-pole 15 · 20 A dual-function AFCI/GFCI | 62 · 62 | kitchens and laundry need both (210.8(A), 210.12(A)) |

**Receptacles and switches** (dwellings and guest rooms need tamper-resistant receptacles, 406.12; wet locations need weather-resistant ones and an in-use cover, 406.9(B)(1); a replaced receptacle gets the GFCI and AFCI protection the location now requires, 406.4(D)(3) and (D)(4))

| id | Device | Pack | Price | Near-miss it sits beside |
| --- | --- | --- | --- | --- |
| KR15-TR · KR20-TR | Duplex receptacle 15 A (5-15R) · 20 A (5-20R), TR | box 10 | 28 · 42 | KR15 (not TR) |
| KR15 | Duplex receptacle 15 A, commercial grade, not TR | box 10 | 22 | wrong in a dwelling (406.12) |
| KR20-TRWR | Duplex receptacle 20 A, TR/WR | box 10 | 55 | |
| KR15S · KR20S | Single receptacle 15 A · 20 A, TR | ea | 7 · 9 | a single receptacle on an individual 20 A circuit must be 20 A (210.21(B)(1)) |
| KA15-TR · KA20-TR | Outlet branch-circuit AFCI receptacle 15 A · 20 A, TR | ea | 36 · 38 | the usual field fix for a single replacement (406.4(D)(4)(1)); protects downstream too |
| KG15-TR · KG20-TR · KG20-TRWR | GFCI receptacle 15 A TR · 20 A TR · 20 A TR/WR | ea | 19 · 22 · 26 | a GFCI where an AFCI is due, and the other way round |
| KDF20-TR | Dual-function (AFCI + GFCI) receptacle 20 A, TR | ea | 44 | a kitchen or laundry replacement |
| KS1 · KS3 · KS4 | Switch single-pole · 3-way · 4-way, 15 A | box 10 / ea / ea | 15 · 4 · 12 | a 4-way where two 3-ways go |
| WP-INUSE · WP-FLIP | Cover, weatherproof in-use (extra duty) · flip-lid (not in-use) | ea | 18 · 6 | 406.9(B)(1) wants in-use |
| PLATE-BLANK | Blank cover plate (make-safe blank-off) | box 10 | 8 | |

**Boxes, conduit, connectors, grounding, equipment**

| id | Item | Pack | Price | Basis |
| --- | --- | --- | --- | --- |
| BOX-OW1 · BOX-NW1 · BOX-OW2 · BOX-4SQ | Box: 1-gang old-work 20.3 in³ · 1-gang new-work 18 in³ · 2-gang old-work 32 in³ · 4 in square 21 in³ with mud ring | box 25 / 25 / 10 / 10 | 45 · 30 · 32 · 55 | box fill (314.16): 12 AWG = 2.25 in³ per conductor; two 12/3 and a device = 20.25 in³ |
| BOX-WP1 | Box, weatherproof, 1-gang, cast, three 1/2 in hubs | ea | 12 | wet location (314.15) |
| EMT-12 · EMT-34 | EMT 1/2 · 3/4 in, 10 ft stick | stick / bundle 10 | 8.50 · 13 per stick | 358; four #6 THWN don't fit 1/2 in (Chapter 9), three #6 and a #10 fit 3/4 in |
| EMT-C12SS · EMT-C12RT · EMT-C34SS · EMT-C34RT | EMT connectors, set-screw · compression raintight: 1/2 · 3/4 in | bag 25 | 18 · 38 · 26 · 45 | outdoors needs raintight fittings (358.42) |
| PVC40-1 · PVC80-1 | PVC Sch 40 · Sch 80, 1 in, 10 ft stick | stick / bundle 10 | 5.50 · 9.50 per stick | 352; Sch 80 where exposed to damage (352.10(F)) |
| PVC-FIT1 · PVC-CEM | PVC fittings kit 1 in (factory 90° sweeps, couplings, adapters) · solvent cement and primer | kit · use / 10 | 40 · 18 | 352.24 (factory sweeps: no field bends) |
| WN-ASST · LEVER-50 · NMC-38 · GRN-50 · NOALOX | Twist-on connectors (100) · lever connectors (50) · NM cable connectors 3/8 in (25) · green ground pigtails (50) · anti-oxidant 4 oz | use / 15, 10, 25, 25, 20 | 22 · 38 · 12 · 14 · 9 | 110.14, 250.8; Al terminations |
| ROD-58-8 · ROD-58-4 · ACORN · BOND-CLAMP | Ground rod 5/8 × 8 ft copper-bonded · 5/8 × 4 ft · acorn clamp, direct-burial listed (10) · water-pipe bonding clamp, listed, 1/2–1 in | ea · ea · box 10 · ea | 22 · 14 · 30 · 9 | 250.52(A)(5), 250.53(A), 250.70, 250.104(A) |
| SPA-60GF · SPA-50GF | Spa panel: 2-pole GFCI in a raintight disconnect, 60 A · 50 A, with a 6 ft 3/4 in LFNC whip kit | ea | 190 · 170 | 680.44 GFCI, 680.13 maintenance disconnect in sight; LFNC at the spa (680.42(A)) |
| WH-EL45 | Water heater element, 4,500 W 240 V, screw-in, with gasket | ea | 22 | |
| KP-TSR30 | Transfer panel relay, 30 A contacts, 120 V coil | ea | 38 | 702 |
| LABELS | Panel directory labels | use / 10 | 12 | 408.4(A) (dwellings carry no arc-flash label: 110.16 doesn't apply) |

**Job lots for the rare jobs** (one pre-filled line each: the supply house's quote for the take-off, 4.4)

| id | Lot | Price | Lead | For |
| --- | --- | --- | --- | --- |
| LOT-STORM | Storm repair: 50 ft UF-B 12/2, two 20 A TR/WR receptacles, two weatherproof boxes, an in-use cover, connectors | 260 | 1 | ref:storm |
| LOT-DIST | Distribution panel upgrade: 400 A distribution panelboard, feeder lugs, two ground rods, the GEC and clamps | 1,400 | 2 | ref:panel |
| LOT-XFER | Transfer switch upgrade: 100 A manual transfer switch (listed), conductors and breakers | 900 | 2 | ref:xfer |
| LOT-DOCK | Fuel dock run: RMC and a seal fitting with compound for the classified section, THWN-2 by the foot, a 2-pole 30 A GFPE breaker | 420 | 1 | ref:dock |

### 3.4 Tools, both trades (A, `ITEMS`, kind `tool`)

Tools are the company's shop equipment: bought once, kept, **owned or not** (no calibration, no wear in v1). A task's `tools` list is the only source of truth for what a job needs (4.3). The existing XP perks in `TOOLS` (data.ts) are unrelated: those are the player's own kit and change how a puzzle plays.

| id | Tool | Trade | Price | On every island (starter) | Required by (the tasks' `tools`) |
| --- | --- | --- | --- | --- | --- |
| T-TW-IN | Torque wrench, click type, 20–200 in-lb | mech | 180 | yes | 05-20-01/02, 79-00-01, 29-10-01, 23-10-01, 24-30-01, 24-30-02, 72-30-01 |
| T-TW-FT | Torque wrench 20–150 ft-lb with crowfoot adapters | mech | 240 | yes | 32-40-01, 32-40-02, 61-10-01, 72-30-01, gsm 2-1, gsm 2-4 |
| T-DIFF | Differential compression tester with master orifice | mech | 210 | yes | 05-20-01, 72-30-01 |
| T-N2 | Nitrogen charging kit: regulator, hose and gauge | mech | 480 | no | 29-10-01 (the accumulator precharge) |
| T-CLAMP | Clamp meter, true-RMS, CAT III 600 V | elec | 180 | yes | ref:inspect, ref:flicker, ref:deadckt, ref:gentest, ref:wh, ref:ground |
| T-TORQUE | Torque screwdriver 5–50 in-lb and lug torque wrench | elec | 260 | yes | ref:inspect, ref:flicker, ref:spa, ref:deadckt, ref:panel, ref:xfer |
| T-MEGGER | Insulation resistance tester 500/1000 V | elec | 620 | no | ref:spa, ref:feeder, ref:storm, ref:dock |
| T-BEND | Hand bender, 1/2 and 3/4 in EMT | elec | 95 | no | ref:spa, ref:dock |
| T-FISH | Fish tape, 100 ft, fiberglass | elec | 85 | no | ref:storm |
| T-KO | Knockout punch set 1/2–2 in, hydraulic | elec | 540 | no | ref:panel, ref:xfer |
| T-PULL | Cable puller, rope and pulling lubricant | elec | 360 | no | ref:panel |
| T-HOTBOX | PVC heat bender | elec | 420 | no | none: the spa's underground run uses factory sweeps, so this is a purchase nobody needs (a near-miss) |

### 3.5 Building materials: the builders' site work (package D uses them; A defines the items)

The shells of new buildings are prefab, set by the mainland contractor (paid in the tier's overhead). The island's builders do the site work: piers and footings, decks and steps, roof flashing and trim, shutters, and the seaplane dock (15.5). A lot is what one work unit draws. Building materials are `bulk` and come on the **weekly supply boat**, whether or not anything flew, and never on the AOG boat.

| id | Item | Pack | Price | Lead |
| --- | --- | --- | --- | --- |
| BLD-FTG | Pier footings for one building: bagged concrete, rebar, anchor bolts | lot | 180 | 1 |
| BLD-DECK | Deck and steps: treated framing, decking, galvanized hardware | lot | 180 | 1 |
| BLD-TIE | Hurricane ties and structural screws | box | 60 | 1 |
| BLD-FLASH | Roof flashing, drip edge and trim for a prefab shell | lot | 220 | 1 |
| BLD-TRIM | Finish lot: trim, caulk, paint | lot | 150 | 1 |
| BLD-SHUT | Storm shutters and screens for one building | set | 300 | 2 |
| BLD-PILE | Treated marine pilings (CCA 2.5), a set of 6 | set | 360 | 2 |
| BLD-MDECK | Marine decking, stringers and galvanized hardware (dock) | lot | 220 | 1 |

### 3.6 Suppliers, freight and carriers (A, `SUPPLIERS` and `FREIGHT` in `data.ts`)

| id | Supplier | Trades | Price × | Lead + | AOG boat |
| --- | --- | --- | --- | --- | --- |
| `oem` | Harbor Aero Supply (OEM distributor) | mech | 1.00 | +0 | yes |
| `broker` | Tradewind Surplus (broker) | mech | 0.80 parts and rotables, 0.90 consumables | +1 | no |
| `supply` | Mainland Electric Supply | elec | 1.00 | +0 | yes |
| `online` | Voltbox (online) | elec | 0.85 | +1 | no |
| `yard` | Harbor Lumber & Block | build | 1.00 | +0 | no |
| `barge` | Island barge (bulk) | build | 0.85 | +1 | no |

- **Scheduled freight** (`sched`): charged per shipment, `FREIGHT.sched` = $35 a mechanic's shipment, $25 an electrician's, $0 for building materials (the yard's price is delivered). A shipment is one supplier's lines on one carrier class landing the same week, whoever bought them and on however many POs: the week's buys and the replenishment run consolidate for $0 extra, and a PO that rides a shipment already on its way adds nothing. The card, the buy sheet and the request queue show it ("+$35 freight: its own shipment"); a broker's auction lot (its price is delivered) and the POs that replaced the old kits (migration) carry none (fix round 1). `eta = week + item.lead + supplier.leadAdd − 1` (the longest line sets the PO's eta). So a lead-1 line bought this week rides **this week's carrier** and arrives at this week's resolve, as kits and chain parts do today. A PO arrives at the resolve of its eta week when its carrier ran that week:
  - small lines (not `bulk`): any flight flown that week, guest or cargo (a part fits in a guest flight's hold);
  - `bulk` lines (cases, coils, bundles, rotables, wheel assemblies): a cargo flight from tier 2, a guest flight's hold at tier 1 (today's kit rule);
  - building materials: the weekly supply boat, which always runs.
  `placePo` splits a buy into one PO per supplier × carrier class. A PO whose carrier didn't run slips a week (review line). A slipping PO with a line for a job whose alert grounds a plane (the only guest plane too) or closes a house takes the AOG boat instead (booked as freight), as today's "a mainland boat brings the most urgent kit".
- **AOG freight** (`aog`): the AOG boat, `FREIGHT.aog` = $350 per PO (today's `ECON.boatKit`, renamed; keep the old name as an alias for the chain code). `eta = this week`: it arrives at this week's resolve whatever flew. OEM and supply house only; never building materials. With the eta rule above, the boat matters for lead-2 lines (rotables, wheel assemblies, lots), broker and online lines (+1), and weeks when the carrier doesn't fly.

### 3.7 Receiving paperwork (9.4 step 1)

| Line | Document checked | Fails (held a week, `hold = W + 1`) |
| --- | --- | --- |
| OEM, new part | the maker's certificate of conformance | 2% |
| OEM, exchange rotable | an FAA 8130-3 matching the unit's data plate | 8% |
| Broker, part or rotable | traceability to the maker or an approved repair station (AC 20-62E) | 25% |
| Consumables, supply-house and yard items | none | — |

The review names the document: *"Receiving: the exchange alternator on po14 came without its 8130-3: quarantined until the vendor sends it (next week)."*, *"… the broker's tire has no traceability paperwork: quarantined a week."* The part chain keeps its own `CHAIN.noPaperwork` for its part (13).

## 4. Tasks: the manual, the reference, and what each task draws

`src/sim/tasks.ts` (A). A task is what the Manual / Reference step finds, and what a plan names. It decides the job kind (catalog kind), the puzzle scenario, the lines the tech must pick (or, for a rare job, the pre-filled line), the bench stock it draws on its own, and the tools it needs.

```ts
export type TaskId = string;   // 'amm:twin:32-40-02', 'afm:float:4', 'gsm:2-4', 'ref:gfci'
export interface Task {
  id: TaskId;
  trade: OpsRole;
  book: 'AMM' | 'AFM' | 'GSM' | 'REF';          // maintenance manual, flight manual, generator service manual, code & procedure reference
  no: string;                                   // "32-40-02", "Section 4", "2-4", "R-GFCI"
  title: string;
  short: string;                                // the job's card title: "Tire and tube", "Brake linings", "Water heater repair" (8.1)
  chapter: string;                              // chip: "32 Landing gear", "Art. 210 Branch circuits", "Generator"
  kind?: string;                                // the catalog kind it does (card money, puzzle); absent = reference only (can't be planned)
  job?: string;                                 // Order.job: the puzzle scenario and the AMM card key ('brake', 'wheel', 'oil', 'bleed', ...)
  log?: string;                                 // the job as a noun for tracing ("water heater repair"); default the kind's `log`
  rule?: string;                                // DEFECT_RULES_BY_KIND key for a botched sign-off; default the kind (R-WH uses 'wh', R-GRND 'bond')
  models?: ('twin' | 'cargo' | 'float')[];      // mech
  targets?: string[];                           // elec / generator: asset models
  prefilled?: boolean;                          // an inspection, AD, code notice or take-off names this task: the Manual step is filled in
  main: MainSlot[];                             // what the tech picks
  fixed?: { item: ItemId | 'byModel'; qty: number }[];   // a rare job's pre-filled line (4.4)
  bench: BenchLine[];                           // drawn on its own at plan time
  tools: ItemId[];                              // required shop tools: the only source of truth (3.4)
  nec?: string[];                               // elec
  keywords: string[];
}
/** mech: an IPC tag on a figure; elec: a slot the judge reads (11.3) */
export type MainSlot = {
  slot: string;
  ata?: AnyAta; tag?: string;                   // mech
  cat?: ItemCat; accepts?: string;              // elec: the category, and a named filter ('receptacle', 'protection', 'wire', ...)
  qty: number | 'upa' | 'engines' | 'run' | 'runLess10';
  takeoff?: { conductors: number; egc: boolean }; // elec wire: N same-size conductors plus one EGC line, each (run × 1.1) ft
  optional?: boolean;                           // the cause decides whether it's needed (`needs`, 5.2)
};
/** a bench line names one item, an IPC tag to resolve for this airplane, or a set of acceptable items (the card's fluid) */
export type BenchLine = { item?: ItemId; tag?: string; anyOf?: ItemId[]; qty: number | 'engines' | 'perEngine'; when?: 'postSb' | 'piston' | 'turbine' };
export function tasksFor(s: IslandState, asset: Asset, role: OpsRole): Task[];   // a plane's AMM + AFM (mechanic); the generator manual (mechanic) or the reference (electrician) on the generator; the reference on houses and the grid (electrician)
export function taskById(id: TaskId): Task | undefined;
export function benchFor(task: Task, ac: Aircraft | null, asset: Asset): { item: ItemId; qty: number }[];  // resolves tags (fig 79-20), anyOf (the approved fluid), engines and model
```

`engines` = 2 on the twin (both engines together, as the logbooks record them), 1 otherwise; `perEngine` multiplies a quantity by it. `run` = the site's feet; `runLess10` = the run less the 10 ft wall section, in 10 ft sticks.

AMM cards: the six existing `AmmTaskKey`s keep their cards and behaviour. Add keys with short cards (title, effectivity, warnings, cautions, tools, consumables, 5–8 steps, torques where the puzzle is card-driven): `bleed` (32-42-01), `wheelhalf` (32-40-03), `safetywire` (61-10-02), `oil` (79-00-01: 20W-50, 12 qt per engine on the twin, 11 on the float, the filter's torque, safety wire), `belt` (24-30-02), `cylinder` (72-30-01), `spar` (57-10-01), `inspection` (05-20-01/02, with the AD 2016-09-12 hub eddy-current check on the twin and the float), `genmount` (gsm 2-1, 2-4). Existing `ALIASES` stay as they are (tests depend on them); new keys resolve through the task's `job`.

### 4.1 Mechanic tasks (AMM per model, AFM, generator manual)

`upa` = the IPC's units per assembly times the assemblies the AMM does (linings: 2 per brake, both mains: 4).

| Task | No. | Title | Models | Kind · job | Main picks | Bench (auto) | Tools |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `amm:*:05-20-01` · `amm:cargo:05-20-02` | 05-20-01 (cargo: 05-20-02 phase) | 100-hour inspection, with the oil and filter change and the hub eddy-current check (AD 2016-09-12, pistons) / phase inspection (oil filter element and chip detector checked) | all | inspect100 · (crack) | — (prefilled: one tap on Start, 17.2) | pistons: 20W-50 12 qt per engine (float 11), oil filter per engine (`oilFilter`), crush gasket per engine, spark plug gasket 12 per engine, safety wire 2, cotter pin 2, MS28775-227 1 · cargo: filter housing packing set 1, chip detector packing 1, safety wire 2, cotter pin 2, MS28775-227 1 | T-TW-IN; T-DIFF (pistons) |
| `amm:*:12-10-01` · `12-12-01` · `07-10-01` | | Tires: servicing · Engine oil: level check · Jacking | all | reference | | | |
| `amm:tw,fl:79-00-01` | 79-00-01 | Engine oil and filter: change (both engines on the twin) | twin, float | oil · oil | oil filter (79-20 `oilFilter`) × engines | 20W-50 12 qt per engine (float 11), crush gasket per engine, safety wire per engine | T-TW-IN |
| `amm:*:32-40-01` | 32-40-01 | Main wheel, tire and tube: removal / installation | all | tires · wheel | tire × 1 (optional), tube × 1 (optional) | grease 1, cotter pin 1 | T-TW-FT |
| `amm:*:32-40-02` | 32-40-02 | Main brake linings: replacement (both mains) | all | tires · brake | lining × upa (4) | rivets 16 | T-TW-FT |
| `amm:*:32-40-03` | 32-40-03 | Main wheel halves: corrosion treatment and penetrant inspection | all | corrosion · corrosion | tube × 1 (optional) | penetrant 1, conversion coating 1 | — |
| `amm:tw,fl:32-42-01` | 32-42-01 | Main brakes: bleeding | twin, float | hydraulics · bleed | — | fluid (the card's) 2 qt | — |
| `amm:tw,fl:29-10-01` | 29-10-01 | Hydraulic power pack: servicing, filter, accumulator precharge | twin, float | hydraulics · powerpack | filter element × 1 (optional) | fluid (the card's) 2 qt, bowl O-ring 1, safety wire 1 | T-N2, T-TW-IN |
| `amm:*:61-10-01` | 61-10-01 | Propeller: removal / installation, track and bolt torque | all | prop · prop | prop bolts × 6 (optional) | safety wire 1, hub O-ring 1, anti-seize 1 (POST SB) | T-TW-FT |
| `amm:*:61-10-02` | 61-10-02 | Propeller mounting bolts: safety wiring | all | wire · wire | — | safety wire 1 | — |
| `amm:*:23-10-01` | 23-10-01 | VHF com transceiver: removal / installation, tray and connector | all | avionics · radio | radio × 1 (optional), connector kit × 1 (optional), cam-lock screw × 1 (optional) | — | T-TW-IN |
| `amm:*:24-30-01` | 24-30-01 | Alternator (cargo: starter-generator): removal / installation | all | alternator · alternator | generator × 1 | — | T-TW-IN |
| `amm:tw,fl:24-30-02` | 24-30-02 | Alternator drive belt: tension check and replacement | twin, float | alternator · belt | belt × 1 | — | T-TW-IN |
| `amm:tw,fl:72-30-01` | 72-30-01 | Cylinder: removal / installation (rare) | twin, float | cylinder · cylinder | fixed: the exchange cylinder for this engine model × 1 | gasket kit 1, anti-seize 1 | T-TW-FT, T-TW-IN, T-DIFF |
| `amm:*:57-10-01` | 57-10-01 | Wing spar lower cap and wing root: inspection | all | spar · spar | — | penetrant 2 | — |
| `afm:*:4` | AFM / POH Section 4 | Starting engine with external power | all | gpustart (not alert-driven; in the index so a search finds it) | | | |
| `gsm:2-1` | GSM 2-1 | Standby generator: engine oil, filters, coolant and hoses | gen | genService · genmount | coolant hose × 1 (optional) | 15W-40 3 gal, oil filter 1, fuel filter 1, coolant 1 gal | T-TW-FT |
| `gsm:2-4` | GSM 2-4 | Standby generator: mounts and isolators | gen | genService · genmount | isolator × 4 | — | T-TW-FT |

**`CATALOG` changes** (A, data.ts): `cylinder` and `oil` lose the cargo plane from `targets` (a turbine has no cylinders, and its logbooks record no 50-hour oil changes). `CatalogEntry` gets `costBy?: Partial<Record<string, number>>`, a per-model factor on today's card: `inspect100: { twin: 1.6 }`, `oil: { twin: 1.8 }` (two engines), `alternator: { cargo: 1.3 }` (the starter-generator). No new catalog kinds in v1.

### 4.2 Electrician: the code and procedure reference

Targets: houses (`cottage`, `villa`, `lodge`), the grid (`panel`), the generator (`gen`). Slots are what the pick judge checks against the job's site (11.3). The `protection` slot shows at every tier; choosing the right device in it is the test.

| Task | Ref | Title | Kind · job | Main slots (qty) | Bench | Tools | NEC |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `ref:outlet` | R-OUT | Dead, warm or scorched receptacle: find the fault, replace the device, protect it as the code now requires | trip · (trace) | `receptacle` 1 (any receptacle: TR, single, AFCI, GFCI, DF, WR); `protection` 1, optional (an AFCI, GFCI or DF breaker, or an upstream AFCI or DF receptacle); `cover` 1 where outdoors | connectors 1 | — | 110.14, 406.4(D)(3), 406.4(D)(4), 406.12, 406.9(B)(1), 210.21(B)(1) |
| `ref:gfci` | R-GFCI | GFCI protection: test, replace, protect downstream | gfci · gfci | `gfci` 1 (a GFCI or DF receptacle, or a GFCI or DF breaker); `protection` 1, optional; `cover` 1 where outdoors | connectors 1 | — | 210.8(A), 406.4(D)(3), 406.4(D)(4), 406.12, 406.9(B)(1) |
| `ref:wh` | R-WH | Water heater: element shorted to its sheath, equipment ground open | flicker · (meter, `heater`) | `element` 1 | connectors 1, green pigtail 1 | T-CLAMP | 250.4(A)(5), 250.110, 422.13 |
| `ref:ground` | R-GRND | Grounding and bonding: electrodes, the water-pipe bond | flicker · (meter, `bond`) | `jumper` 10 ft (bare Cu), `clamp` 1 | — | T-CLAMP | 250.104(A), 250.52–250.70 |
| `ref:afci` | R-AFCI | AFCI protection: bedrooms, living areas, kitchens, laundry, halls | reference | | | | 210.12(A), 406.4(D)(4) |
| `ref:3way` | R-3WAY | 3-way switching: common and travelers | switch3 · switch3 | `switch` 2, optional; `cable` 25 ft, optional (14/3 on a 15 A circuit, 12/3 on 20 A); `box` 1, optional | connectors 1 | — | 404.2(A), 404.2(C), 200.7(C)(1), 314.16 |
| `ref:inspect` | R-INSP | Inspection readiness: directory, clearances, labels, breaker sizing | codeprep · codeprep | — (prefilled: one tap on Start) | labels 1 | T-TORQUE, T-CLAMP | 408.4(A), 110.26(A), 110.22(A), 240.4(D) |
| `ref:storm` | R-STORM | Storm damage: replace wet branch wiring and devices (rare) | storm · (trace) | fixed: LOT-STORM 1 | connectors 2 | T-FISH, T-MEGGER | 110.11, 334.12(B)(4), 406.4(D), 406.9(B)(1) |
| `ref:flicker` | R-FLICK | Flicker, dimming, a loose neutral at the panel or the service | flicker · (meter) | — | connectors 1 | T-CLAMP, T-TORQUE | 110.14, 110.14(D), 200.2 |
| `ref:spa` | R-SPA | Outdoor hot tub: the feed, the spa panel, raceway and whip | hottub · (conduit) | `spa` 1 (spa panel with its whip kit); `feed` 1 (the 2-pole breaker at the house panel); `wire` take-off: 3 same-size conductors (L1, L2, N) and the EGC line, (run × 1.1) ft each; `emt` 1 stick (3/4 in, the wall section the puzzle bends); `connectors` 2 (3/4 in); `pvc` (run − 10 ft) in sticks (1 in Sch 40, underground) | PVC fittings kit 1 (factory sweeps), cement 1 | T-BEND, T-MEGGER, T-TORQUE | 680.42, 680.44, 680.13, 358.42, 352, 300.5, Table 250.122, Table 310.16 |
| `ref:feeder` | R-FEED | Underground feeder to the cottages: find the failed splice, re-make it with the slack in the trench | feeder · (trace, its underground feeder scene) | `splice` 4 (one per conductor: L1, L2, N, EGC; one splice re-made, not a length spliced in) | — | T-MEGGER | 225, Table 300.5, 300.5(E), 110.14(B), 110.7 |
| `ref:panel` | R-PANEL | Island distribution panel upgrade (rare) | panelUp · (panel) | fixed: LOT-DIST 1 | anti-oxidant 1 | T-TORQUE, T-KO, T-PULL | 230, 408, 250.24, 250.52(A)(5), 250.53(A), 110.14(D), 312.5 |
| `ref:deadckt` | R-DEAD | Dead circuit at the panel: breaker, lug, bus | xfmr · (meter) | `breaker` 1, optional | — | T-TORQUE, T-CLAMP | 110.14(D), 240, 408 |
| `ref:dock` | R-DOCK | Fuel dock run: landside conduit, the classified section in RMC with a seal (rare) | dockrun · (conduit) | fixed: LOT-DOCK 1 | — | T-BEND, T-MEGGER | 514.8, 514.9, 501.15, 555.35, 300.5 |
| `ref:xfer` | R-XFER | Standby generator: transfer switch and circuits (rare) | transfer · transfer | fixed: LOT-XFER 1 | — | T-TORQUE, T-KO | 702.4(B), 702.5, 445.13 |
| `ref:gentest` | R-GENT | Generator-backed circuits: weekly test and repair | genTest · (meter) | `relay` 1, optional | connectors 1 | T-CLAMP | 110.3(B), 702.4 |
| `ref:boxfill` · `ref:wet` · `ref:tr` | R-BOX · R-WET · R-TR | Box fill · wet and damp locations · tamper-resistant receptacles | reference | | | | 314.16 · 406.9, 314.15, 358.42, 334.12(B)(4) · 406.12, 406.4(D)(5) |

Each reference entry carries a short plain-English summary of the rule (two to four lines) that the Reference step shows, for example R-OUT: *"A replaced receptacle gets the protection the location needs today: AFCI in bedrooms, living areas, kitchens, laundry and halls (406.4(D)(4)); GFCI in bathrooms, kitchens, laundry and outdoors (406.4(D)(3)). An AFCI receptacle, a DF receptacle or the right breaker does it. Dwelling receptacles are tamper-resistant (406.12). A single receptacle on an individual 20 A circuit is a 20 A one (210.21(B)(1))."* Tiers 0–2 add the answer for this job's site (*"this circuit: 20 A, 12 AWG, kitchen: DF protection, 20 A TR"*) and highlight the protection slot when the room needs it. Tier 3+ shows the rule only.

**The spa run matches the conduit puzzle.** The puzzle bends the 3/4 in EMT wall section between the house panel and the spa panel on the outside wall, with the 3/4 in bender's 6 in take-up (B: `conduit.ts` takes the stick size from `context.pick`, 1/2 in: 5 in, 3/4 in: 6 in; it labels the stick, connectors and wire only when the pick is EMT). From the spa panel the run goes underground in 1 in PVC Sch 40 with the kit's factory sweeps, then the whip. The fuel dock's lot has no EMT pick, so its puzzle (the landside run) keeps today's unlabeled 1/2 in stick, and the classified section stays RMC with its seal, outside the puzzle.

### 4.3 Bench stock and tools at plan time

- The engine adds `benchFor(task, ac, asset)` to the plan's lines. The tech sees them in the Stock step marked *card*, with their badges, and never picks them.
- Tools: each tool in `task.tools` must be owned (`inv[tool].on ≥ 1`). A missing tool becomes a line on the job's card (capex); the job waits for it like a part. Tools are never consumed and take no stores bin.

### 4.4 Rare jobs and repairs: pre-filled lines

- **Rare jobs** (cylinder, and the electrician's storm, panel, transfer switch and fuel dock) are still found by search: which task fixes the alert is the diagnosis. Their Parts / Materials step shows the task's `fixed` line (the exchange cylinder for this engine model, or the supply house's job lot) instead of slots. The Stock step, the card, the requisition and the allocation treat it like any pick. No v1 judge rule reads a lot.
- **Repairs** (a hidden defect found or surfaced): the repair's task is derived (`repairTask(alert)`): its fix rule's puzzle and job. There is no Investigate or Manual step: the flow opens at Stock. When the fix rule has `parts: 1`, the repair carries one pre-filled line, `RPR-{job}` (3.2), priced at today's kit money, so it costs what it costs today. An `ipc:noteff` repair carries the original task's `stdPick` lines instead (the effective P/N the inspection found missing). Redos stay direct orders (the parts are already on the asset).

## 5. Alerts

`src/sim/alerts.ts` (A). Alerts are where jobs come from.

### 5.1 Generation (replaces `generateOpsOrders` for trade work on assets)

```ts
export function generateAlerts(s: IslandState, r: Rng, now: number): void;           // openWeek, where generateOpsOrders ran
export function raiseAlert(s: IslandState, o: RaiseOpts, now: number): Alert;         // also used by repairs, NFF comebacks and hard landings (package D)
export type RaiseOpts = { role: OpsRole; asset: Asset; kind?: string; sym?: string; cause?: number; src?: AlertSrc; due?: number; repair?: RepairInfo; again?: number; seed?: number; week?: number /* the week it shows: the staff hook raises at the resolve for next week */; who?: string };
export function symptomText(s: IslandState, a: Alert): string;                        // "L/H brake pedal soft; pulls right on the landing roll."
export function findingOf(s: IslandState, a: Alert, tier: number): { text: string; nff: boolean };  // what Investigate shows: the cause's finding (the NFF one when `looksNff`); tier ≤ 2 adds the plain sentence
export function siteOf(s: IslandState, a: Alert): ElecSite | null;                     // electrical: room, circuit, AWG, run, protection upstream (derived from the seed)
export function fixesOf(s: IslandState, a: Alert): TaskId[];                            // HIDDEN: the tasks that fix it ([] for NFF and for a wiring cause)
export function needsOf(s: IslandState, a: Alert): string[];                           // HIDDEN: the main slots its cause needs (stdPick, the install check)
export function alertTier(s: IslandState, a: Alert, role: Role): number;               // 1 in the first 2 weeks from s.flowSince and during a player's grace; else clamp(1 + ⌊islandTier/2⌋ + (asset health < 50 ? 1 : 0), 1, 5); a repair: its defect's tier
export function alertFlags(s: IslandState, a: Alert): { aw: boolean; hazard: boolean; mel: 'C' | null; bench: boolean; intermittent: boolean };
export const soleGuest = (s: IslandState, planeId: string): boolean;                   // the island's only non-cargo plane (the twin through tier 3)
```

- **Same volume as today.** Per trade, the slot logic of `generateOpsOrders` is kept: target open work 4 (tier ≥ 3: 5), at most 3 new per week, must-do candidates (weight ≥ 100) first, an asset under 45 health with nothing open on it is forced, then weighted picks by `CatalogEntry.weight × (1 + (100 − health)/40)`, spread across assets. On a plane, the `tires` kind's weight is multiplied by its pilots' `wearMult` (D, 15.3; stub 1). "Open work" counts open alerts plus open orders that aren't `waiting_part`. A candidate kind is skipped when an open alert on that asset has that hidden kind or an open order of that kind exists on it.
- **Each pick becomes an alert**, except `wb` (load sheets) and `gpustart` (ground power starts), which stay direct orders exactly as today. `raiseAlert` picks a symptom whose causes include that kind and fit the asset (model, room, the only-guest-plane rule of 5.6), weighted by the cause's weight. Then it sets the cause, the lead (`due = week + lead`), the pilot who wrote it up (`who`, from D's `pilotOf`; stub: none), and `looksNff`.
- **NFF is a call, not a chore.** At alert tier 3+, an *intermittent* symptom (marked in 5.2 and 5.3) with a real cause shows the NFF finding 30% of the time (`ALERTS.looksNff`, seeded, stored at raise). Closing it NFF brings it back (5.5); replacing on suspicion costs parts and labour on the real NFF ones. Pilot squawks from a skill 1–2 pilot add D's `squawkNff` to the symptom's NFF weight.
- **NFF extras.** Per week, `ALERTS.nff` (mechanic 0.125, electrician 0.25; tune) chance of one more alert whose cause is "no fault": a symptom with an NFF weight, on an asset weighted by (100 − health). It doesn't take a slot.
- **Repairs become alerts.** `detectDefects` and a surfacing defect raise a repair alert (`kind: 'repair'`, `src: 'finding'` or `'again'`, `repair` = today's RepairInfo, `due = week`) instead of calling `addRepair` directly. `plan` on it creates the repair order through the existing `addRepair` path with the flow's lines (4.4). Redos stay direct orders.
- **Prefilled alerts** (`src: 'due' | 'ad' | 'code' | 'takeoff'`) name their task: the Manual step is filled in and there is no Investigate. With no main slots (inspections, code prep), the flow is one tap on Start (17.2); a take-off opens at Materials with its site on top.
- Alert ids come from `s.nextId` (`a${n}`), seeds from `hashSeed(s.seed, 'alert', id)`.

### 5.2 Mechanic symptoms

`aw`: airworthiness (no-go from the due week unless MEL-deferred). `MEL`: company MEL (Part 135) category where the plane has a redundant system. `lead`: weeks from raised to due. `bench`: an electrical unit (the electrician can meter the circuit, 5.4). *Intermittent*: 5.1. Causes list the hidden kind, its weight, the task that fixes it, the raw finding, and what it **needs** (the main slots it requires; the task's other slots are optional). Tier ≤ 2 findings add one plain sentence naming the task (`findingOf`). *Only guest plane*: the wording raised there instead (5.6).

| Key · src | Text | Models | aw · MEL · lead | Causes (kind w: fix → raw finding · needs) | NFF w: finding | Only guest plane |
| --- | --- | --- | --- | --- | --- | --- |
| `M_BRAKE_SOFT` · squawk | "{side} brake pedal soft; pulls {other} on the landing roll." | all | aw · — · 0 | hydraulics 3 (twin, float): 32-42-01 → "Pedal sinks, then firms up after two or three pumps; reservoir at ADD; no leaks at the caliper." · tires 2: 32-40-02 → "{side} linings 0.06 in (limit 0.10); pedal firm; no leaks." · needs lining | — | "{side} brake pedal travel increasing; firm at the stop." lead 1–2 |
| `M_BRAKE_CHATTER` · squawk | "Brakes chatter and grab on taxi." | all | — · — · 1–2 | tires 3: 32-40-02 → "Linings glazed; disc heat-checked, within limits." · needs lining | 1: "Taxi test smooth; linings 0.18 in; disc in limits. Could not duplicate." | as is |
| `M_TIRE_WORN` · wear | "{side} main tire at 2/32 in on the outboard shoulder: change within {lead} weeks." | all | aw · — · 1–3 | tires 1: 32-40-01 → "Tread 2/32 in at the shoulder, no cords; sidewall sound." · needs tire, tube (a new tube with a new tire) | — | as is |
| `M_TIRE_PRESSURE` · squawk, intermittent | "{side} main tire loses 5 psi overnight." | all | aw · — · 1 | tires 3: 32-40-01 → "Soap test: a pinhole in the tube at the valve stem base; the wheel halves are dry." · needs tube · corrosion 1: 32-40-03 → "Tire off: the tube chafed through over a corrosion pit at the outer half's bead seat; penetrant shows no crack." · needs tube | 1: "Held pressure 24 h after a top-up: a cold night. Could not duplicate." | as is |
| `M_WHEEL_CORROSION` · finding | "Corrosion blistering on the {side} wheel half at the bead seat (tire off at the last change)." | all | aw · — · 1–2 | corrosion 1: 32-40-03 → "Blistered at the bead seat; penetrant: no crack. Treat, coat and refit." | — | as is |
| `M_HARD_LANDING` · landing | "Hard landing reported by {pilot} on {plane}: inspect the gear, the tires and the wing root." | all | aw · — · 0 | tires 2: 32-40-01 → "{side} tire sidewall cut by the rim on touchdown; the wheel undamaged." · needs tire, tube · spar 1: 57-10-01 → "Wing-root fairing rivets working; spar cap to be checked." | 2: "Gear, tires and wing root inspected: no damage. Nothing to order." | not raised |
| `M_PROP_VIB` · squawk | "Vibration at cruise that changes with rpm." | all | aw · — · 0 | prop 3: 61-10-01 → "Two prop bolts below torque; fretting at the flange." · prop 1: 61-10-01 → "Blade track 3/16 in out (limit 1/16): the prop sits cocked on its flange." | 1: "Run-up smooth; blades and spinner undamaged. Could not duplicate." | "A light vibration at cruise, smooth at other rpm." lead 1–2 |
| `M_PROP_AD` · ad | "AD 2014-22-08 blade clamp bolt torque check due in {lead} weeks." | cargo | aw · — · 2–3 | prop 1: 61-10-01 | — | — |
| `M_SAFETY_WIRE` · finding | "Safety wire broken on a prop bolt pair at the preflight." | all | aw · — · 0 | wire 1: 61-10-02 | — | "Safety wire on a prop bolt pair nicked at the preflight; still tight." lead 1 |
| `M_COM_DEAD` · squawk | "Com 1 dead on transmit; receive weak." | all | aw · C (twin, cargo) · 0 · bench | avionics 7: 23-10-01 → "No sidetone, no carrier on the test set; 27.8 V at the tray." · needs radio · wiring 3 (5.4) → "0 V at tray pin 1 with the breaker in; the radio powers up on the bench supply." | — | as is (MEL C: com 2 works) |
| `M_COM_INTERMITTENT` · squawk, intermittent | "Com 1 cuts out over bumps." | all | — · C · 1–2 | avionics 2: 23-10-01 → "Wiggle test at the tray: drops out; cam lock backed off, connector pins dull." · needs connector | 2: "Ops check on ground power normal; no dropout on the wiggle test. Could not duplicate." | as is |
| `M_LOW_VOLTS` · squawk | twin: "{Eng}low-voltage light; its loadmeter reads zero." float: "Low-voltage light; the ammeter shows a discharge." | twin, float | aw · C (twin) · 0 · bench | alternator 3: 24-30-01 → "No output at B+ at 2,000 rpm; field voltage present; belt tight." · needs generator · alternator 1: 24-30-02 → "Belt glazed and slipping under load; output normal once tensioned." · needs belt · wiring 1 (5.4) → "0 V at the field terminal with the master on; the alternator puts out on the bench." | — | as is (MEL C: the other alternator carries the load) |
| `M_GEN_OFF` · squawk | "GEN OFF light on the ground run; the starter works." | cargo | aw · — · 0 · bench | alternator 3: 24-30-01 → "No output at the GCU with the field excited; brushes at the wear line." · needs generator · wiring 1 (5.4) → "0 V field at the GCU connector with the GEN switch on; the starter-generator puts out on the test stand." | — | — |
| `M_BELT_SQUEAL` · squawk | "{Eng}squeal from the alternator belt on start-up." | twin, float | — · — · 1–2 | alternator 3: 24-30-02 → "Belt glazed; tension below the used-belt value." · needs belt | 1: "Tension within the used-belt value, no glazing. Could not duplicate." | as is |
| `M_CHT_TREND` · trend, intermittent | "{Eng}the engine monitor shows #3 CHT 40 °F hotter than the rest, three weeks running." | twin, float | aw · — · 2–3 | cylinder 2: 72-30-01 → "#3 compression 58/80; air at the intake; intake gasket seeping." | 1: "A folded baffle seal at #3, straightened on the spot; CHTs even now. Nothing to order." | as is |
| `M_OIL_IRON` · trend | "{Eng}oil analysis: iron 38 ppm, up from 12." | twin, float | aw · — · 2–4 | cylinder 3: 72-30-01 → "#2 compression 60/80; fine iron in the filter media." | 1: "Resample: iron 14 ppm. The last sample was contaminated." | as is |
| `M_OIL_DUE` · due | "Oil change due in {lead} weeks (50 hours)." | twin, float | — · — · 1–2 | oil 1: 79-00-01 · needs oilFilter | — | as is |
| `M_OIL_LEAK` · squawk | "{Eng}oil on the belly after one flight." | twin, float | aw · — · 0–1 | oil 2: 79-00-01 → "Drain plug safety wire broken, the plug backing off; filter gasket dry." · needs oilFilter · cylinder 1: 72-30-01 → "Oil weeping at the #4 cylinder base." | 1: "Overfilled by a quart; the breather blew it out. Serviced to the mark." | "A little oil on the belly after each flight; the level holds." lead 1 |
| `M_GEAR_SLOW` · squawk | "Gear takes 12 s to retract (normal 6–9 s)." | twin, float | aw · — · 1 | hydraulics 3: 29-10-01 → "Filter bypass button out; fluid dark; reservoir low." · needs filter | 1: "8 s on jacks on ground power: the battery was low that day." | as is |
| `M_ACCUM` · squawk | "Brake accumulator runs down after two applications." | twin, float | aw · — · 0 | hydraulics 1: 29-10-01 → "Precharge 450 psi against the card's value." · needs nothing (nitrogen, T-N2) | — | "Accumulator precharge near the card's minimum at the preflight check." lead 1 |
| `M_INSP_DUE` · due | "100-hour inspection due in about {h} hours ({n} flights)." (cargo: "Phase inspection due in about {h} hours.") | all | — (today's −6 overdue rule stays) · — · 1 | inspect100 1: 05-20-01 (cargo 05-20-02) | — | as is |
| `M_SPAR_AD` · ad | "AD 2011-20-05 spar lower cap inspection due in {lead} weeks." | twin | aw · — · 2–3 | spar 1: 57-10-01 | — | as is |
| `M_WING_RIVETS` · squawk | "Smoking rivets at the wing root." | all | aw · — · 0 | spar 1: 57-10-01 | — | "Paint cracked around two wing-root rivets." lead 2 |
| `M_GEN_RUN` · squawk | "Weekly generator run: oil pressure low at start, coolant weeping at the lower hose." | gen | — · — · 1–2 | genService 1: gsm 2-1 → "Oil 2 qt low and black; the lower hose soft and weeping at its clamp." · needs hose | — | — |
| `M_GEN_SHAKE` · squawk | "The generator shakes on its weekly run." | gen | — · — · 1–2 | genService 1: gsm 2-4 → "Two isolators cracked and oil-soaked; mount bolts loose." · needs isolator | — | — |

`{side}` is L/H or R/H (a main wheel); `{other}` the other side. `{Eng}` prefixes the twin's engine symptoms with the engine (*"L/H engine: low-voltage light; …"*; the text after it starts lower case) and is empty on a single; that job covers that engine (the oil change and the 100-hour do both, as the logbooks record). `{pilot}` is `alert.who` ("the pilot" when absent). `{h}` = flights to go × 8.3 hours, rounded to 5. Pilot squawks carry the pilot's name: *"Written up by Marta K.: com 1 cuts out over bumps."*

v1 has no kind for ignition or the hot section: the first draft's `M_ROUGH_MAG` and `M_ITT_TREND` wait for v2 (24), and `M_TOW` waits for line crew.

**MEL (company MEL, Part 135)**: category C only in v1. A placard covers the resolve of the week it's placarded (about the 10 calendar days of a real category C); the analyst may extend it once by a week (`melExtend`, 7). Com 1 INOP: C on the twin and the cargo plane (com 2 operative); the float has one com: no MEL. One alternator INOP: C on the twin (load shed per the MEL remarks). Everything else: no MEL.

### 5.3 Electrician symptoms

`hazard`: shock or fire. The house is unrentable from the moment the alert is raised until it's made safe (then it rents at ×0.75) or fixed (10). The site (`ElecSite`) derives from the seed; the rooms column says which rooms the text can name, and a cause marked `[rooms]` applies only there.

| Key · src | Text | Targets · rooms | hazard · lead | Causes (kind w [rooms]: fix → raw finding · needs) | NFF w: finding |
| --- | --- | --- | --- | --- | --- |
| `E_DEAD_OUTLET` · guest | "Guest at {house}: the {room} outlets are dead." | houses · kitchen, living, bedroom, laundry | — · 0–1 | trip 3: ref:outlet → "Hot open at the second receptacle; the first is backstabbed and loose." · gfci 2 [kitchen, laundry]: ref:gfci → "The {room} GFCI upstream is tripped and won't reset; its LOAD side feeds these outlets." | 2 [kitchen, laundry]: "A GFCI upstream was tripped; reset and tested fine. Nothing to replace." · [living, bedroom]: "The AFCI breaker had tripped (a vacuum cleaner); reset, holds, tested. Nothing to replace." |
| `E_WARM_OUTLET` · guest | "Guest at {house}: an outlet in the {room} is warm and smells burnt." | houses · living, bedroom, kitchen | **hazard** · 0 | trip 3: ref:outlet → "Backstabbed receptacle; the hot conductor loose and discoloured." · gfci 1 [kitchen]: ref:gfci → "The GFCI's LINE terminal loose and scorched." | — |
| `E_APPLIANCE` · guest | "Guest at {house}: the {appliance}'s plug runs warm." (the microwave in the kitchen; the window unit in the bedroom) | houses · kitchen, bedroom (`single`: an individual 20 A circuit, 12 AWG) | — · 0–1 | trip 1: ref:outlet → "A 15 A single receptacle on the 20 A individual circuit; its contacts loose and discoloured." | — |
| `E_GFCI_TRIPS` · guest, intermittent | "Guest at {house}: the bathroom outlet trips whenever the hair dryer runs." | houses · bath | — · 0–1 | gfci 3: ref:gfci → "Trips at 3 mA on the tester (should hold to 4–6 mA); 11 years old." · trip 1: ref:outlet → "Water in a box downstream, on the GFCI's LOAD side; terminals corroded." (site `upstream: 'gfci'`) | 2: "The GFCI tests right; the guest's hair dryer leaks 7 mA to ground. It's the dryer." |
| `E_SHOWER_TINGLE` · guest | "Guest at {house} felt a tingle at the shower valve." | houses · bath | **hazard** · 0 | flicker 2: ref:wh → "Water heater element 40 kΩ to its sheath; the heater's EGC open at its junction box; 4 V valve to drain." · flicker 1: ref:ground → "No bonding jumper on the water piping (250.104(A)); 4 V valve to drain with the heater off." · flicker 1: ref:flicker → "Neutral to ground 9 V at the panel; lights brighten when the microwave runs: the service neutral is loose at the meter base." (tier ≤ 2 adds: *"A branch breaker won't isolate a service neutral: leave the house closed until it's fixed."*, 10) | — |
| `E_NO_GFCI` · code | "Inspector's note at {house}: no GFCI on the porch receptacle, and a flip-lid cover." | houses · outdoor (wet) | — · 2–3 | gfci 1: ref:gfci | — |
| `E_THREEWAY` · guest | "Guest at {house}: the hall light works from one switch only." | houses · hall | — · 1–2 | switch3 1: ref:3way → "A traveler landed on the common screw at the far switch." (re-land it: nothing to buy) | — |
| `E_SWITCH_WARM` · guest | "Guest at {house}: a switch plate in the hall is warm." | houses · hall | — · 0–1 | switch3 2: ref:3way → "Loose traveler at the 3-way; two 12/3 cables and the device in an 18 in³ box." · needs box · trip 1: ref:outlet → "A backstabbed receptacle in the same box, loose." | — |
| `E_CODE_DUE` · code | "County electrical inspection at {house} in {lead} weeks: directory, clearances, labels." | houses · panel | — · 2 | codeprep 1: ref:inspect | — |
| `E_STORM_DEAD` · guest | "After the storm: two rooms at {house} dead, water in the porch box." (no storm last week: "Water in the porch box at {house} after the rain.") | houses · outdoor (wet), bedroom | **hazard** · 0 | storm 3: ref:storm → "Porch box full of water, terminals corroded; the run to the bedroom wet, 0.2 MΩ." · trip 1 [outdoor]: ref:outlet → "The porch receptacle failed; the rest dry, insulation good." | — |
| `E_FLICKER` · guest, intermittent | "Guest at {house}: the lights flicker when the AC kicks on." | houses | — · 0–1 | flicker 6: ref:flicker → "Neutral lug at the panel loose; 112–128 V under load." | 2: "A 4% sag on the AC's start: normal inrush. Could not duplicate." |
| `E_TAKEOFF_SPA` · takeoff | "Install a {amps} A hot-tub circuit at {house}: the pad is {feet} ft from the panel." | houses · spa (60 A, 30% 50 A; 35–55 ft; underground past the wall) | — · 2–3 | hottub 1: ref:spa | — |
| `E_FEEDER_DROP` · utility | "Utility log: the feeder to the east cottages dropped out twice last night." | panel | — · 0–1 | feeder 3: ref:feeder → "Insulation 0.4 MΩ at a buried splice: split bolts and tape, cracked." · xfmr 1: ref:deadckt → "The feeder breaker's lug loose and discoloured." | — |
| `E_UTIL_SAG` · utility | "Meter data: phase B sags to 108 V at peak." | panel | — · 1–2 | xfmr 3: ref:deadckt → "Phase B lug at the main 40 °F hot on the IR scan." | 1: "The utility transformer's tap: their side, reported to them." |
| `E_DEAD_CIRCUIT` · utility | "A dead circuit at the panel: breaker on, no voltage at the load." | panel | — · 0–1 | xfmr 1: ref:deadckt → "Breaker contacts open: 120 V line side, 0 V load side." · needs breaker | — |
| `E_PANEL_LOAD` · trend | "The island's distribution panel ran at 92% of its rating at peak: plan the upgrade." | panel | — · 3–4 | panelUp 1: ref:panel | — |
| `E_TAKEOFF_DOCK` · takeoff | "The fuel dock's old direct-burial run fails its insulation test: replace it with a conduit run." | panel · dock | — · 2–3 | dockrun 1: ref:dock | — |
| `E_DOCK_TRIP` · utility | "The fuel-dock pumps trip their ground-fault protection." | panel · dock | — · 0–1 | dockrun 2: ref:dock → "Buried run 0.3 MΩ; water in the dispenser junction." | 1: "Rain in the pump motor's box; dried and resealed; the run tests fine." |
| `E_TAKEOFF_XFER` · takeoff | "The transfer switch is too small for the houses now: install a larger one." | gen | — · 2–3 | transfer 1: ref:xfer | — |
| `E_XFER_FAIL` · utility | "In the weekly test the transfer didn't pick up the villas." | gen | — · 0–1 | transfer 2: ref:xfer → "The transfer switch's contacts pitted and burnt on the villas' leg." · genTest 2: ref:gentest → "The villas' transfer-panel relay coil reads open." · needs relay | — |
| `E_GEN_TEST` · utility | "Weekly test: a backed-up circuit didn't come on." | gen | — · 0–1 | genTest 1: ref:gentest → "The transfer-panel relay's coil reads open." · needs relay | — |

For `ref:outlet` and `ref:gfci` the needs are implicit: the receptacle or GFCI slot, plus whatever protection the site's room requires, plus a cover outdoors. `stdPick` fills the cheapest compliant set (a bedroom: an AFCI receptacle; a kitchen: a DF receptacle; a microwave's individual circuit: a 20 A single receptacle plus a DF breaker; a bath downstream of a GFCI: a TR receptacle).

`ElecSite` (derived; `siteOf`):

```ts
export interface ElecSite {
  room: 'bath' | 'kitchen' | 'bedroom' | 'living' | 'laundry' | 'outdoor' | 'hall' | 'panel' | 'spa' | 'dock' | 'gen';
  deviceRoom?: ElecSite['room'];           // where the device the fix replaces sits, when it isn't the complaint's room (default: room)
  amps: 15 | 20 | 30 | 50 | 60 | 100;      // the circuit's breaker as it is
  awg: 14 | 12 | 10 | 8 | 6 | 3;           // its conductors as they are
  single?: boolean;                        // an individual branch circuit with a single receptacle (a microwave, a window unit)
  upstream?: 'gfci' | 'afci' | 'df';       // protection already there upstream (the device is on a GFCI's LOAD side; an AFCI breaker)
  wet?: boolean;
  run?: 'nm' | 'buried' | 'exposed';
  feet?: number;
  load?: number;                           // transfer: the backed-up load, amps
}
```

Rules for sites: bathrooms are on a 20 A, 12 AWG circuit (210.11(C)(3)); kitchens and laundry 20 A; bedrooms, living rooms and halls 15 A / 14 AWG (70%) or 20 A / 12 AWG; `single` sites are 20 A on 12 AWG; outdoor is wet, 20 A. The protection a replaced receptacle needs is derived from `deviceRoom`: AFCI in bedrooms, living rooms, kitchens, laundry and halls (210.12(A), 406.4(D)(4)); GFCI in bathrooms, kitchens, laundry and outdoors (210.8(A), 406.4(D)(3)); `upstream` protection counts. The Investigate step shows the site (tier 3+: *"Circuit: 20 A breaker, 12 AWG NM-B; the device feeds one more receptacle"*; tiers ≤ 2 add *"a replacement here needs AFCI and GFCI protection"*), and the alert text names the room.

### 5.4 The bench check (electrical units on a plane)

`M_COM_DEAD`, `M_LOW_VOLTS` and `M_GEN_OFF` have a **wiring cause** (hidden kind `wiring`) beside the unit causes. The fault is never rolled apart from the cause: the finding the mechanic reads always agrees with it (*"No sidetone, no carrier on the test set; 27.8 V at the tray, keyed or not"* = the unit; *"27.8 V at the tray unkeyed, 20 V keyed: a loose power pin sags under the transmit load; the radio transmits on the bench"* = the wiring: the radio still receives, so the squawk is *"the com radio dead on transmit; it receives fine"*, fix round 1). At tier 3+ the finding is raw readings that agree; tier ≤ 2 adds *"It's the wiring: ask {elec} to meter it."* or *"It's the unit."* The share of wiring causes replaces `CHAIN.wiringShare` for flow alerts (weights in 5.2: 3 in 10 on the com, 1 in 5 on an alternator, 1 in 4 on the starter-generator).

- **Ask {elec} to meter it** (`askBench`, at Investigate, on any bench alert): a `bench` order for the electrician (today's kind `bench`, meter puzzle, `job = benchJob(tag, model)`, `context.bench = { fault }` from the cause), linked by `Order.bench = alertId`.
- The call *the unit*: `bench.call = 'unit'`; the mechanic plans the part as usual.
- The call *the wiring*, fixed: no part. The mechanic still signs the airplane back into service (an electrician can't approve an aircraft for return to service, 14 CFR 43.3 and 43.7). The engine turns the alert's job, or a new flow job with the kind's task and no lines, into **"Finish {title}: the fault was in the wiring (inspect the splice per AC 43.13-1B, ops check, sign off)"**, ready at LABOR.min. Any reserved unit is released. The alert closes `wired` at that sign-off (today's chain does the same).
- A wrong *the wiring* call on a dead unit leaves today's sure defect (`meter:wiring`, `meter:radio`), traced to the electrician's check. A wrong *the unit* call on a wiring fault plants nothing: it shows at the install, as below (fix round 1: the check that missed it gets a second look, it doesn't leave a hidden defect behind a job that can't sign off anyway).
- The generator raises the wiring causes (`pairsFor` gives each bench symptom its unit and wiring pairs), so the crews meet them: about 1 bench alert in 4 is the wiring in the paper sim. `tests/flowbench.test.ts` covers both calls, the missed wiring and the return to service, with the electrician present and away.
- **Skipping the check when the cause is the wiring**: the unit goes on, and at sign-off: *"Ground run: still no output. The removed unit tests good on the bench."* The job doesn't sign off. A unit bought for this job goes back (credit less restocking); a pulled one goes back to stock. The alert gets `bench.again = true`, a bench order opens for the electrician, and the job waits in `waiting_part` with `flow.stop` (*"Still no output with the new unit: waiting on {elec}'s circuit check"*). The check's *wiring* call turns it into the return-to-service step above. This is today's `missedWiring`, moved from the chain to the alert.
- Autopilot for an absent electrician calls the unit (today's rule).

### 5.5 Comebacks and escalation

- **NFF close**: only on a finding that reads "could not duplicate" (the NFF cause, or a real intermittent that hides at tier 3+, `looksNff`). A finding that shows the fault can't be closed as nothing: the engine refuses (*"The finding shows the fault: fix it, placard it or make it safe."*) and Investigate has no button for it (fix round 1: an IA doesn't sign "could not duplicate" over a failed test-set reading, and an electrician doesn't close a guest's shock complaint). The finding already says which case it is, so the gate leaks nothing.
- **NFF close on a real intermittent**: the alert closes `nff`; a hidden comeback (`flow:nff` defect) re-raises it after `ALERTS.againMin..againMax` (1–2) weeks as `src: 'again'`, due now, same cause, text prefixed "Written up again: …". No incident: the repeat squawk and the due-now grounding are the cost.
- **An alert nobody planned**, past its due week: it rolls today's deferral risk as if it were a carried order (`deferralRisk` with its weeks past due, cost `3 × labour` of its true kind), blamed on its trade. An airworthiness alert on a plane doesn't roll: the plane is AOG instead, the only guest plane too (its guests on the mainland sub-charter, 10).
- An alert on an asset that is out of service (grounded, red-tagged, AOG) doesn't roll.

### 5.6 The only guest plane

Through tier 3 the twin is the island's only guest plane. Grounding it empties every house, which is why DECISIONS.md already keeps the part chain off it. `soleGuest(s, planeId)` is true for it until a second non-cargo plane arrives (the float, tier 4). On the only guest plane:
- a symptom with an *Only guest plane* wording (5.2) is raised in that wording, with its lead (the deferrable early sign of the same fault: travel increasing, a nicked safety wire, a light vibration). The no-go wording isn't raised there, and neither is the no-go finding: each such cause has a `soleFinding` that is still within limits (*"Two prop bolts at the bottom of the torque band, stripes intact, no fretting at the flange"*, *"linings 0.12 in (limit 0.10)"*, *"the wire is nicked at the twist, not parted"*), so what the mechanic reads is a squawk an IA would let fly to its due week (fix round 1). Hard landings aren't rolled on it (15.3). Its MEL C items keep their placards;
- past due, it goes alert-AOG like any plane (flying past the due week or the MEL interval isn't legal), and a **mainland sub-charter** flies its guests in until the fix is signed off, so the houses stay booked (10; 2026-09-28: it used to fly restricted, half its flights with a near-miss each);
- everything else (the flow, the parts, the money) is as for any plane.

## 6. Search

`src/sim/search.ts` (A): pure, deterministic, no DOM, shared by the UI (B, C), the bots and the tests.

### 6.1 Index sources

| Index | Built from | One doc per | Chapters (chips) |
| --- | --- | --- | --- |
| `manualIndex(s, asset, role)` | `tasksFor(s, asset, role)`: the model's AMM tasks and AFM Section 4 (planes), the generator manual (the mechanic on the generator), the code and procedure reference (the electrician on houses, the grid and the generator) | task | AMM: "05 Time limits", "07 Lifting", "12 Servicing", "23 Communications", "24 Electrical power", "29 Hydraulic power", "32 Landing gear", "57 Wings", "61 Propellers", "72 Engine", "79 Oil"; reference: "Art. 110 General", "Art. 210 Branch circuits", "Art. 250 Grounding and bonding", "Art. 314 Boxes", "Art. 334/340/352/358 Wiring methods", "Art. 404 Switches", "Art. 406 Receptacles", "Art. 408 Panels", "Art. 422 Appliances", "Art. 680 Spas", "Art. 702 Standby", "Art. 514/555 Fuel dock" |
| `ipcIndex(s, asset)` | `figuresFor(ac)`: every row of every figure for this airplane (effectivity evaluated), plus the ICA part of an alteration that has an EA on record (`s.eas`), plus PMA P/Ns with their eligibility | IPC row | "Fig 12 · 32-40 Wheels and brakes", … one per figure, in ATA order |
| `supplyIndex(trade)` | `ITEMS` of that trade (mech: shop consumables, lines, tools and every plane's parts; elec: materials, lots and tools; build: materials) | item | `ItemCat` |

Memoized: static indexes once per module; per-airplane indexes by `${seed}|${assetId}|${eas on it}` in an LRU of 12 (like `islandAircraft`).

### 6.2 Documents and functions

```ts
export type Doc = {
  id: string;                     // TaskId, ItemId, or `${pn}@${fig}.${item}` for an IPC row
  kind: 'task' | 'ipc' | 'item';
  title: string;                  // "32-40-02 Main brake linings: replacement" · "066-19600 LINING, HEAVY DUTY (METALLIC)" · "Dual-function receptacle 20 A, TR"
  sub: string;                    // "IPC Fig 12 item 21A · EFF C · UPA 2 · SUPSDS 066-19500" · "NEC 406.4(D)(3), 406.4(D)(4)" · "20 A · TR · AFCI + GFCI"
  chapter: string;
  text: string;                   // everything searchable: title, sub, nomenclature, notes, keywords, NEC articles, tags
  pn?: string;                    // normalized P/N (upper case, no spaces or dashes)
  order: number;                  // print order: figure order, then catalog order
  ref: { task?: TaskId; item?: ItemId; ata?: AnyAta; fig?: number; row?: string; eff?: string; applies?: boolean; supsdBy?: { pn: string; code: 1 | 2 | 3 }; np?: boolean; alt?: boolean; ea?: string };
};
export type Index = { key: string; docs: Doc[]; post: Map<string, number[]>; vocab: [string, number][]; chapters: { chapter: string; n: number }[] };
export function tokenize(text: string, trade?: OpsRole): string[];
export function buildIndex(key: string, docs: Doc[]): Index;
export type Hit = { doc: Doc; score: number; matched: string[] };
export function search(ix: Index, q: string, o?: { limit?: number; chapter?: string; boost?: (d: Doc) => number }): Hit[];
export function complete(ix: Index, prefix: string, n?: number): string[];       // autocomplete chips: vocabulary tokens by frequency
export function hintsFor(s: IslandState, a: Alert, tier: number): { chips: string[]; tasks: TaskId[]; items: ItemId[] };
export function rowBadges(s: IslandState, asset: Asset, d: Doc, tier: number): string[];   // built from rightPn / judgePart for this airplane (6.4)
```

### 6.3 Tokenizer, synonyms, ranking

- Lower case; split on spaces and punctuation, but keep a P/N token whole (letters, digits, dashes, slashes), and add it with dashes removed (`066-19600` → `066-19600`, `06619600`); strip a trailing plural `s` / `es`.
- Synonyms by trade (expanded at index time, not query time, so the query stays what was typed). Mech: pad, pads → lining; alt → alternator; gen, genny → generator, starter-generator; com, radio → transceiver; oring, o ring → o-ring; tyre → tire; prop → propeller; 5606, red oil → mil-prf-5606; wire → safety wire; oil filter → filter, oil. Elec: outlet, plug-in → receptacle; gfi → gfci; afi → afci; df, dual function → dual-function; romex → nm-b; pipe → conduit; j-box, junction → box; ats → transfer switch; megger → insulation tester; hot tub → spa; three-way, 3 way → 3-way; tingle, shock → bonding, ground; water heater → heater, element.
- Score of a doc for query tokens `q1..qn`: per token, the best of: exact P/N 12; P/N substring (≥ 4 characters) 8; exact token in title 3; prefix in title 2; exact in text 1.5; prefix in text 1; one edit away (tokens of 5+ characters) 0.6. Sum; if a token matched nothing, the sum × 0.35 (partial matches rank below full ones). Plus `boost(doc)`. Ties: `order`, then `id`. Default limit 20.
- `complete(prefix)`: the 6 most frequent vocabulary tokens starting with it (≥ 2 characters typed), P/Ns last.

### 6.4 What each tier shows

Every badge, *likely* mark and `pickCheck` warning is built from `rightPn(ac, ata, tag)` and `judgePart(ac, ata, tag, pn)` for this airplane, so a hint never recommends a P/N the install or receiving would reject. A test enumerates every figure row × airplane × tier 0–1 to check this (21.1).

| Tier (the alert's, 5.1) | Suggestions | Result badges | Before commit |
| --- | --- | --- | --- |
| 0–1 | keyword chips from the symptom and the finding; the likely task pre-highlighted; in Parts, the right row pre-highlighted; in Materials, the protection slot highlighted when the room needs it | "◀ this airplane"; INTCHG code 1 or 2: "SUPSD: order TR-155-02 (INTCHG 2)"; code 3: "SUPSD BY 066-19600 only as the SB set: this airplane takes 066-19500"; "not effective for S/N 310R0431"; "NP: order item 2A"; "ALT: a legal alternate"; "for 20 A circuits"; "TR required in dwellings (406.12)"; "AFCI + GFCI: kitchen replacements" | a wrong pick is flagged in the Stock step (*"Check: 066-19600 is only for POST SB brakes; this airplane is PRE SB."*), not blocked |
| 2 | keyword chips only; the protection slot still highlighted | as tiers 0–1 | nothing |
| 3–5 | none: chapter chips and the search bar | only what the book prints (EFF code, UPA, SUPSD BY with its INTCHG code, NP, ALT) or the catalog's spec line | nothing |

Keyword chips: the symptom's own nouns plus the finding's (tier ≤ 2), mapped through the synonyms (for *"Pedal sinks, then firms up after two or three pumps"*: `brake`, `bleed`, `32-42`).

### 6.5 Near-misses (all come from the data, none are fake entries)

- **Mechanic**: both S/N blocks (A/B rows side by side: brake discs, wheel assemblies, trays, power packs, spinner bulkheads); PRE/POST SB rows (a code-2 part fits new-for-old: TR-155-01 → -02, B-k413-1 → -3, DH-k31 → -1; a code-3 part only as the SB set: 066-k500 → 066-k600); NP rows (order the next higher assembly); ALT rows (a legal alternate: SW- tires, B-AX belts, SF oil filters); other models' P/Ns in the shop stock (the float's BAE-48112 filter beside the twin's BAE-48119; the cargo's 8.50-10 tire); straight 50 oil beside 20W-50; .041 safety wire beside .032. On an altered airplane the IPC's own part is a near-miss (the data plate says *Altered: STC …*): the right move is *Not in the IPC · research the records*. After an EA, the ICA part is a normal row tagged "EA 26-104".
- **Electrician**: 15 A vs 20 A (a single receptacle on an individual 20 A circuit); a plain TR receptacle vs AFCI, GFCI or DF protection (receptacle or breaker) on a replacement; TR vs not TR; WR and in-use vs flip-lid; 14/3 vs 12/3 for a 3-way; #8 vs #6 hots on a 60 A spa, a #12 EGC vs #10; a 50 A vs a 60 A spa panel; a 70 A feed breaker on #6; set-screw vs raintight EMT connectors outdoors; an 18 in³ vs a 20.3 in³ box for two 12/3 cables; split bolts and tape vs a direct-burial splice kit in the ground; a hand bender vs the PVC hot box (a tool nobody needs).

### 6.6 Performance

An airplane's IPC index is about 160 docs, the electrical catalog about 100. Build under 20 ms, search under 2 ms on a phone (a test asserts generous bounds on CI). The UI debounces typing by 80 ms and never rebuilds an index on a keystroke.

## 7. Engine actions

Types in `types.ts`, handling in `engine.ts` (flow and purchasing), `src/sim/staff.ts` (staff: 15). Every action below except `setStanding` is added to `WEEK_BOUND` (stamped with the week; a stale week is refused as today). **Tech actions** (`plan`, `nff`, `mel`, `makeSafe`, `askBench`, `repick`, `dropJob`, `request`) are refused after that seat's turn ended (*"Your turn is over for this week."*), like today's `squawk` and `tag`. **Analyst actions keep today's engine rule: no turn lock.** Approving, deferring and buying stay open after the analyst's End turn, and the desk shows them (17.3). `buyList` stays in the union and always fails: *"Parts kits are gone: buy real items from the stock planner."* `counter` on a flow card fails: *"MEL, make-safe or a cheaper pick is the cheaper fix: approve or defer."* (the desk hides the gesture on flow cards).

```ts
| { t: 'plan'; role: OpsRole; alert: string; task: TaskId; pick: { item: ItemId; qty: number }[]; research?: boolean; week?: number }
| { t: 'nff'; role: OpsRole; alert: string; week?: number }
| { t: 'mel'; role: 'mech'; alert: string; week?: number }
| { t: 'melExtend'; alert: string; role?: Role; week?: number }                     // the mechanic asks, the analyst approves
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
| { t: 'scrap'; item: ItemId; qty: number; week?: number }
| { t: 'nudge'; alert: string; week?: number }                                        // analyst
| { t: 'setStanding'; amount: number }                                                // analyst
// staff (package D, 15.9): hire, letGo, build
```

| Action | Who | Allowed when (else the error) | Effect |
| --- | --- | --- | --- |
| `plan` | the alert's trade | week ≥ 1 (*"The week has not started yet."*); alert open, not a job (*"That alert is not open."*); `role === alert.role` (*"Not your trade."*); the task is in `tasksFor(asset, role)` (*"That task isn't in the manual set for {asset}."*) and has a kind (*"That's reference only: pick the task that does the work."*); a repair alert's task is its repair task; a rare job's pick is its `fixed` line; every item exists and is this trade's (*"Unknown item {id}."*); 1–10 lines, quantities 1–500 (wire by the foot); `research` only on a plane task with an IPC slot | Creates the job (8.1), reserves stock (9.2), prices the card (8.3, 8.6). All on hand: approved at once on the work budget (8.4); else a card for the analyst. `research`: opens the part chain at research for this job (13), or queues it behind the open one. The alert becomes `job`. |
| `nff` | the alert's trade | alert open, not a job; not a repair, `due`, `ad`, `code` or `takeoff` alert (*"There's a known task for this one."*); the finding at the alert's tier reads "could not duplicate" (*"The finding shows the fault: fix it, placard it or make it safe."*) | Closes the alert `nff`. On a real intermittent: a hidden comeback (`flow:nff`, due in 1–2 weeks) re-raises it (5.5). |
| `mel` | mechanic | a plane, the symptom has MEL C for this model (*"No MEL relief for that on {plane}."*), not already placarded, the alert not done | `alert.mel = { until: max(week, due), by }`: the plane flies on it through its due week's resolve (a placard put on early isn't spent before it's needed; 10). |
| `melExtend` | the mechanic asks (`role: 'mech'`, turn not ended), then the analyst approves | a placarded alert, not extended yet (*"The MEL allows one extension."*), `mel.until ≥ week − 1` (*"That placard has run out."*); the analyst only once asked (*"Ana asks for the extension first (the maintenance side's call)."*) | The ask: `mel.ask = { week, by }`, a line on the analyst's desk and the card. The approval: `mel.until = max(until, week − 1) + 1`, `mel.ext = true`; feed *"Cy approved Ana's MEL C extension on Twin N-12 for com 1: it flies on the placard to week 9."* The extension is the maintenance side's call (a Part 135 operator's Director of Maintenance, under its MEL extension authority); the analyst approves what the downtime and the fix cost (fix round 1). |
| `makeSafe` | electrician | a hazard alert, not made safe, not done | `alert.safe = { how, week, by }`. A blank-off draws a PLATE-BLANK if one is on hand (not required). The house rents at ×0.75 until fixed. On a service-neutral cause, a branch breaker leaves the hidden `elec:isolation` defect (10). |
| `askBench` | mechanic | the alert has `bench`, no call yet, no check open | A `bench` order for the electrician (ready, no cost), `Order.bench = alertId`. |
| `repick` | the job's trade | a flow job, not done or cancelled | Releases its reservations, cancels its requisitions not yet ordered (ordered lines arrive into stock, untied), reserves and prices the new pick. A pending card is re-priced; an approved job keeps its labour paid, and its new shortfall becomes requisitions for the analyst. Clears `flow.stop`. Runs the allocation (9.3). |
| `dropJob` | the job's trade | a flow job, not done | Releases, cancels unordered requisitions, the job `cancelled`, the alert back to `open`. A job never started gives its labour back (a negative `labor` line; the work budget's spend too): dropping a wrong task to plan the right one doesn't pay twice. A part already bought for it lands as free stock (fix round 1). |
| `request` | mechanic or electrician | the item is this trade's; 1–50 (tools: 1); at most `STOCK.maxReqs` (12) open per trade (*"12 requests are already waiting on Cy: cancel one, or wait for the desk."*) | A stock or tool requisition (no job): the analyst's call. A repeat request for the same line folds into the open one (a tool: *"Already asked: Cy decides on it."*). |
| `cancelReq` | its requester or the analyst | the requisition is `open` | `cancelled`. |
| `approve` (flow card) | analyst | as today (the freeze, with `spendable` for cash: under $2,000 only safety-critical; `isEmergency` now also counts a job whose alert grounds a plane (the only guest plane too) or closes a house; receivership blocks over $800 except safety-critical) | Charges the labour (cash), places the card's lines to buy on POs (committed, 9.7) with the `buy` choice (default: 8.6), makes soft reservations hard; the job → `waiting_part` or `ready`. XP +10 as today. |
| `approveReq` | analyst | the requisitions are `open`; the same freeze and receivership rules; a new stock line needs a free bin, as for `buy` | Places them on POs (grouped by supplier and carrier). |
| `deferReq` | analyst | `open`, not deferred this week | `deferredWeek = week`; XP +10. |
| `buy` | analyst | 1–12 lines; not under the freeze (*"Spendable cash under $2,000: stock orders are frozen."*); spendable covers it; bins (*"Stores full: 40 of 40 bins. Use up, scrap or return a line first."*, 9.6) | A stock PO (`by: 'fin'`). Quantities round up to whole packs (cut-to-length items: any quantity). |
| `setStock` | analyst | 0 ≤ rop < max ≤ 500 units, or both null; a new line needs a free bin | Sets or clears the item's min/max. |
| `scrap` | analyst | qty ≤ unreserved on hand | Returnable (parts, rotables, materials, lots, tools): 75% of average cost credited at the next payment run, 25% booked as loss. Consumables: written off. |
| `nudge` | analyst | an open alert with no job, not nudged this week | `alert.nudged = week`; a push to its trade (16). |
| `setStanding` | analyst | 0–5,000, step 50 | The standing limit a week (8.5). |
| `squawk` (changed) | mechanic or electrician | as today (one write-up a week, the kind applies to the asset, not already open) | Instead of an order, raises an alert with `src: 'finding'`, `kind` = the kind written up, `sym` = `W_{kind}` (*"Written up by Seb: brake linings worn"*, one line per catalog kind in `SYMPTOMS`, cause needs = the kind's default task's slots), due in 2 weeks. The flow opens at the Manual step with that kind's task for the asset filled in (the tech confirms it, as for a `due` alert). |
| `tag` (unchanged) | mechanic or electrician | as today | A safety call still takes the asset out of service for the week; an open alert on it doesn't roll deferral risk that week. |

Order and requisition timestamps (`Order.at`, `Requisition.at`: ms, the `now` of the action) tell the resolve which card came in after the analyst ended the turn (8.5).

## 8. The flow on orders

### 8.1 The job a plan creates

```ts
newOrder(s, {
  role, kind: task.kind /* 'repair' for a repair */, assetId: alert.assetId,
  title: task.short /* "Tire and tube", "Water heater repair"; a repair: its rule's fix title */,
  puzzle: puzzleFor(task) /* the catalog kind's puzzle; repairs by their fix */,
  tier: orderTier(kind, asset, s.tier) /* a repair: its defect's tier */,
  cost: laborCost(...) /* 8.3 */, parts: 0, gain: CATALOG_BY_KIND[kind].gain /* a repair: addRepair's formula */,
  job: task.job ?? kind, status, at: now,
  flow: { alert: alert.id, task: task.id, pick, bench, tools, bom },
  ...(repair ? { repair } : {}),
});
```

Everything downstream is today's machinery: `launchFor` (with the task's `job`, so `manualCard` prints the chosen task's card), blind sign-off, hidden defects (traced with `task.log`, worded by `task.rule`), repairs and redos, lend-a-hand (for a flow job that has waited a week: the helper plays the puzzle with the parts already reserved), the chain.

### 8.2 Statuses

| Situation after `plan` | Status |
| --- | --- |
| Every line and tool on hand, and the labour fits the trade's work budget, or the alert is airworthiness or a hazard | approved at once on the work budget: `ready` |
| Every line on hand, over the work budget (not safety work) | `pending`: a labour-only card |
| Something to buy (a part, a line, a tool) | `pending`: a card with the lines to buy |
| Approved, waiting on POs, a held PO, a tool, or the research branch | `waiting_part` |
| Receiving sent a line back, or the install stopped (`flow.stop`) | `waiting_part` until the tech repicks |

Deferral risk keeps today's rules: `pending` cards carried a week roll it (the analyst's call), `waiting_part` doesn't.

### 8.3 Labour: the card costs what it costs today

```ts
export const kitValue = (tier: number) => round10(340 * (1 + 0.1 * (tier - 1)));   // today's auction fair value
/** today's card for this kind on this asset: orderCost × the model's factor, plus the kit it needed */
export function cardToday(s: IslandState, kind: string, asset: Asset): number {
  const c = CATALOG_BY_KIND[kind];
  return orderCost(kind, orderTier(kind, asset, s.tier)) * (c.costBy?.[asset.model] ?? 1) + (c.parts ? kitValue(s.tier) : 0);
}
export function laborCost(s: IslandState, kind: string, task: Task, asset: Asset, site?: ElecSite | null, cause?: number): number {
  const ac = asset.kind === 'plane' ? islandAircraft(s.seed, asset) : null;
  const std = bomValue(s, [...stdPick(s, asset, task, site, cause), ...benchFor(task, ac, asset)]);
  return round10(Math.max(LABOR.min[task.id] ?? LABOR.minDefault, cardToday(s, kind, asset) - std));
}
```

- `stdPick` is the right pick for this airplane and this cause (the effective P/N at the right quantity, only the slots the cause needs; the site's right devices; a rare job's `fixed` line). `bomValue` prices lines at flat list, default supplier.
- `LABOR.min` (tune): mechanic $85/h, electrician $75/h × hours: 05-20 0.6, 79-00-01 1, 32-40-01 2, 32-40-02 2.5, 32-40-03 3, 32-42-01 1.5, 29-10-01 1.5, 61-10-01 2, 61-10-02 0.75, 23-10-01 1, 24-30-01 3, 24-30-02 1, 72-30-01 8, 57-10-01 4, gsm 2; outlet 0.75, gfci 1, wh 1, ground 1, 3way 1.5, inspect 1, storm 8, flicker 1, spa 4, feeder 4, panel 12, deadckt 1.5, dock 5, xfer 6, gentest 1.5. `LABOR.minDefault` $50.
- **The band, checked.** Labour + the standard parts ÷ `cardToday` for every v1 task × model × cause × island tier 1–5 (from the tier its asset exists) × health above and below 50. A scratch model with the real `orderCost`, `orderTier` and the prices of section 3 gives:

| Task | Standard parts (list) | Ratio |
| --- | --- | --- |
| 05-20-01 twin (`costBy` 1.6) · float · 05-20-02 cargo | $277 · $133 · $29 | 0.99–1.14 |
| 79-00-01 twin (`costBy` 1.8) · float | $255 · $120 | 0.99–1.10 |
| 32-40-01 tire and tube · tube only | $161–508 · $41–98 | 0.99–1.03 |
| 32-40-02 linings (EFF D · EFF C) | $254 · $342 | 1.00–1.01 |
| 32-40-03 with a tube | $74–131 | 1.00–1.01 |
| 32-42-01 · 29-10-01 with the filter | $36 · $149 | 0.98–1.07 |
| 61-10-01 · 61-10-02 | $13 · $1 | 1.00–1.01 |
| 23-10-01 radio · connector kit and cam-lock screw | $950 · $97 | 1.00–1.06 |
| 24-30-01 alternator · starter-generator (`costBy` 1.3) · 24-30-02 belt | $760 · $1,350 · $38 | 1.00–1.15 |
| 72-30-01 (the pre-filled cylinder) · 57-10-01 | $1,318 · $63 | 1.00 |
| gsm 2-1 · gsm 2-4 | $194 · $192 | 1.00–1.01 |
| ref:outlet (a bath receptacle downstream … a microwave's 20 A single plus a DF breaker) | $6–72 | 0.96–1.10 |
| ref:gfci (a bath GFCI … a TR receptacle plus a DF breaker) | $23–68 | 0.98–1.02 |
| ref:wh · ref:ground | $24 · $20 | 1.00–1.16 |
| ref:3way (every optional slot filled) · ref:inspect · ref:flicker | $29 · $1 · $1 | 1.00–1.02 |
| ref:spa (50–60 A, 35–55 ft) | $359–506 | 1.00–1.01 |
| ref:feeder (four direct-burial kits) · ref:deadckt · ref:gentest | $180 · $9 · $39 | 0.99–1.14 |
| lots: storm · panel · transfer · dock | $260 · $1,400 · $900 · $420 | 1.00 |

  `tests/tasks.test.ts` repeats it (0.85–1.25). **Exempt**: a pick of an ICA part (an altered airplane's assembly, after an EA), which is dearer by design (`CHAIN.icaMult`). A records the exempted task × model × seed list in DECISIONS.md, *Real job flow*. The `costBy` factors are deliberate: a twin's 100-hour and oil change really cost more than a single's, and so does a turbine starter-generator. They raise maintenance spend by about $1,400 a game (20.2).
- **Repairs**: labour = max(`LABOR.minDefault`, today's repair cost + (`fix.parts` ? `kitValue` : 0) − the repair's pre-filled lines (an `RPR-{job}` line is $340)). A repair costs what it costs today.
- A pick that isn't standard costs what it costs: a broker's price, an extra part nobody needed, a whole tire for a leaking tube. Labour doesn't change.

### 8.4 The work budget: in stock, do it now

This is the owner's own flow: *in stock, do it; not in stock, ask the analyst to buy.* The existing per-trade budget (`autoBudget`, today's petty cash) becomes the trade's **work budget**: a delegated approval limit on labour. A plan whose lines and tools are all on hand is approved at once by the trade itself, at **any tier**, when:
- `autoSpent[role] + labour ≤ autoBudget[role]`, **or** the alert is airworthiness or a hazard (safety work isn't held for sign-off: it may run past the budget, and still counts against it);
- `spendable − labour ≥ ECON.freezeBelow` (safety work: ≥ 0); in receivership, labour ≤ $300 unless it's safety work.

Everything else is a card for the analyst: anything to buy, or in-stock work over the budget. The week-open `autoApprove` runs the same rule for cards carried over (a card whose shortfall the allocation filled is all-on-hand now). The analyst sets each work budget on the Money tab (today's `setBudget`, capped at `budgetCap = min(3000, fixedNow(s))`).

### 8.5 Standing approvals at the resolve

Weeks last 12–36 hours and each seat usually plays once, so half the time the analyst has played before the tech's plan exists. Step 1b of `resolveWeek` (today's `leftoverChainCard`, widened) closes that gap. When the analyst has ended the turn, every flow card and requisition that came in after it (`at > turns.fin.endedAt`), not deferred this week, goes through, most urgent first (airworthiness and hazards, then due week), with the card's default freight (8.6). Two limits apply: up to the **standing limit** (`s.standing`, default the two work budgets' sum; the analyst sets it on the Money tab), and while `spendable − total ≥ freeze` (safety work: ≥ 0). **Safety work due this week or next** (`lateSafe`: an airworthiness item on a plane or a hazard, due by next week) goes through whatever the limit, down to $0 spendable, and doesn't use the limit up: in pass-and-play the analyst often plays first, and a limit set for stock shouldn't ground a plane for a week (fix round 1). The Stock step's preview says which it will be before Send (*"Cy has ended the turn: it goes through tonight on the standing approval whatever the limit (safety work due this week or next)."* / *"… it's over the standing limit ($0): it waits for Cy's approval."*), the analyst's End turn warns that the techs play later (*"Ana and Ben haven't played yet: a card over $1,000 that isn't safety work due this week or next will wait a week. Raise the limit …"*) with a one-tap raise on Home, and a request that waits gets its review line too (why: over the limit, the freeze, or full stores). It runs before receiving (step 3), so a lead-1 line lands in the same resolve. The review says so: *"Cy had ended the turn when Seb's card for the tire on Twin N-12 came in: it went through on the standing approval ($660, next flight, here tonight)."* Anything over the limit waits for the analyst (and rolls deferral risk from next week, as any pending card). The chain's own `leftoverChainCard` stays for chain cards. An absent analyst is autopilot's (18.3), which runs first.

### 8.6 What the card shows (package C draws it, A computes it)

```ts
export function cardOf(s: IslandState, o: Order, buy?: BuyChoice): {
  labour: number;
  fromStock: { item: ItemId; qty: number; value: number }[];      // on the shelf, reserved (soft until approved)
  toBuy: { item: ItemId; qty: number; unit: number; supplier: SupplierId; eta: number }[];
  tools: { item: ItemId; price: number }[];                        // tools to buy (capex)
  freight: { sched: Arrival; aog?: Arrival & { cost: number }; pick: Freight };
  total: number;                                                   // labour (cash now) + to buy + tools + freight (committed)
  aog: boolean; shut: boolean;                                     // what the job's alert does to its asset now
  sub?: { flights: number; fee: number; usd: number };               // the only guest plane's airworthiness job: a week of the sub-charter once it's grounded
  downtime?: { flights: number; usd: number };                     // a week of it (today's downtimeOf)
  due: number; mel?: { until: number; ext?: boolean };
  budget: { trade: OpsRole; spent: number; of: number };           // the trade's work budget this week
};
type Arrival = { eta: number; outWeeks: number };                  // outWeeks: resolves the asset spends AOG / closed with this freight
```

- **A pending card's shortfall lives only on the card**; there are no requisition objects for it. Requisitions are standalone requests and the new shortfall of an approved job (after a repick, or a line sent back at receiving).
- **Default freight.** The AOG boat when the scheduled arrival leaves the asset out (AOG or closed) for more resolves than the boat would, and the difference × a week's downtime is more than `FREIGHT.aog`; otherwise scheduled. The card says both: *"Scheduled: here wk 9 · N-12 AOG wk 8 (~$3,100 of guests) | AOG boat +$350: here wk 8"*. The fin bot, autopilot and the standing approval use the same test.

### 8.7 Start, the install check, and sign-off

```ts
// src/sim/flow.ts (A)
export function installCheck(s: IslandState, o: Order): { stop: string; research?: boolean } | null;
export function pickCheck(s: IslandState, alert: Alert, task: Task, pick: { item: ItemId; qty: number }[], tier: number): string[];  // tiers 0–1 only: warnings before commit (6.4), built from judgePart and judgeElecPick; [] at tier 2+
export function stdPick(s: IslandState, asset: Asset, task: Task, site?: ElecSite | null, cause?: number): { item: ItemId; qty: number }[];   // the right pick (labour, bots, autopilot, migration, tests; never shown by the UI)
```

- `installCheck` is what a tech finds when the job starts and the box is opened. Mechanic stops: a line in an IPC slot that `judgePart` calls `wrong` or `unlisted` (*"066-19500 isn't the lining this brake takes: check the IPC for S/N 310R0431"* at tiers ≤ 2; *"The linings don't fit the brake: check the IPC"* at tier 3+); `displaced` (`research: true`: *"The brake on this airplane isn't the one in the IPC: it was altered. Research the records."*); a slot short on quantity (*"Two linings short: the AMM does both brakes."*); a slot the cause needs left empty (*"The tire is at 2/32: this job replaces it, and none was picked."*). Electrician stops: a line in the wrong category for its slot (a switch in the GFCI slot). Either trade: a required tool not owned. `noteff` does **not** stop: the part fits, and the mistake surfaces later (11.2).
- The tech's Start button (B) runs it first. A stop shows the stop sheet instead of the puzzle, with **Repick** (the Parts step, the stop text on top) and, for `research`, **Research the records ▸** (a `repick` with `research: true`). No action is written until the tech repicks.
- `complete` on a flow job runs it too (a bot, a stale tab): on a stop the result is dropped, `flow.stop` is set, the job goes to `waiting_part`, pulled units stay in stock, and the feed says *"Work stopped at the install on Twin N-12: …"*. It is not an error.
- At a sign-off (score ≥ `SIGNOFF`, or blind): `consume`, the alert closes `fixed`, then the defect checks in this order, and only the first plants a sure defect: wrong task (11.1), `ipc:noteff` (11.2), `judgeElecPick` (11.3). Today's quality roll on the score runs as well; a sure defect replaces its defect, never adds a second one.
- The puzzle's launch (`launchFor`, A) passes `context.pick` (the job's lines with `pn`, `nomen`, `spec`) and the chosen task's card (`context.card` from `manualCard` keyed by the task's `job`), so the puzzle works to the task the tech chose.

## 9. Inventory and purchasing mechanics

`src/sim/stock.ts` (A). All numbers in `STOCK` (data.ts, tune): `carry` 0.001 a week (cash: storage and insurance), `capital` 0.005 a week (the cost of cash tied up: shown, not charged), `restock` 0.15 (min $40, today's `CHAIN.restock`), `returnCredit` 0.75, `autopilotCap` $800 a week, `keepWeeks` 2 (closed POs and requisitions kept for the invoice puzzle and the UI), `ledgerWeeks` 26, `z` 1.28 (90% cycle service). Stores bins by tier: `TierDef.bins` 40, 50, 60, 75, 90.

```ts
export const available = (s: IslandState, item: ItemId) => (s.inv?.[item]?.on ?? 0) - reservedOf(s, item);   // soft reservations count as reserved
export function onOrderFree(s: IslandState, item: ItemId): { qty: number; eta?: number };   // open and held PO lines not tied to a job
export function position(s: IslandState, item: ItemId): number;                             // 9.1
export function reserve(s: IslandState, order: string, lines: { item: ItemId; qty: number }[]): { item: ItemId; short: number }[];
export function release(s: IslandState, order: string): void;
export function allocate(s: IslandState, line?: Liner): void;                               // 9.3
export function consume(s: IslandState, order: string, asset: string | null): number;       // at sign-off: reserved units leave stock; returns the value, books the ledger
export function placePo(s: IslandState, lines: PoLine[], buy: BuyChoice, by: Role | 'auto', now: number): PurchaseOrder[];  // one PO per supplier × carrier class; committed
export function receive(s: IslandState, W: number, flew: { guest: number; cargo: number }, line: Liner): void;   // resolve step 3
export function payRun(s: IslandState, W: number, line: Liner): number;                    // resolve step 11 (9.7)
export function replenish(s: IslandState, W: number, line: Liner): void;                    // resolve step 11b
export function binsInUse(s: IslandState): number;
export function committed(s: IslandState): number;                                          // cash still owed on POs ordered and not yet paid, after the store credit that will pay them
export function payable(s: IslandState): number;
export const spendable = (s: IslandState) => s.cash - committed(s);
export function carryCost(s: IslandState): number;
export function invValue(s: IslandState): number;
```

### 9.1 Inventory position and known demand (one formula everywhere)

- **Inventory position** `IP = on hand − reserved + on order not tied to a job − open demand not yet ordered`. The last term is open requisitions plus pending cards' lines to buy. Reservations are counted once (in `reserved`), and a PO line bought for a job is never free supply.
- **Known demand** (item level) is only demand nobody has covered yet and that doesn't depend on a diagnosis: the bench lines of inspections coming due (a plane within two weeks of its 100-hour at its flights a week; a house whose inspection runs out within 2 weeks), the open build's next two units (building materials), the tools a take-off's task needs. Unplanned alerts' needs have no item (14.2).
- **ROP and max** (continuous review): `L` = the item's lead + its default supplier's lead add (weeks to arrival, the resolve included); `rop = ceil(perWeek × L + z × σ × √L)`, with no reservations inside it; `max = rop + max(one pack, ceil(perWeek × 4))`. `perWeek` and `σ` are the item's **family** rate (14.2) for plane parts, its own for consumables and materials.
- **Order flag**: `IP − known demand within L < rop` (no ROP set: `< 0`).

### 9.2 Reservations

A plan reserves what is available for its job, first come, first served. Reservations on a **pending** card are soft: a later airworthiness or hazard plan takes them from a card that isn't safety work, and that card's line goes back on its list to buy (re-priced). Approval makes them hard. Reserved units are counted in `on` and listed in `res[order]`; `available` excludes them. A reservation is released by `repick`, `dropJob`, a cancelled job, or migration clean-up; consumed at sign-off. A job sent back for rework (`isRework`), a botched lend-a-hand, or a job stopped at the install keeps (or returns) its units unconsumed: nothing leaves stock until a sign-off.

### 9.3 Allocation: stock goes to the job that waits for it

`allocate(s)` runs after receiving (step 3), after every `buy`, `scrap`, `repick`, `dropJob` and `cancelReq`, at the end of step 11b, and at week open. Jobs with a shortfall are taken in order: airworthiness and hazard alerts first, then the oldest. Each gets the available units of its short items: hard for approved jobs, soft for pending cards. A requisition it fills becomes `filled` (a PO line already ordered for it becomes free stock when it lands); a pending card's list to buy shrinks. An approved job with every line reserved and its tools owned becomes `ready`: feed and push *"Parts for Tire and tube on Twin N-12 are in: Seb, your move."* So stock that arrives on a replenishment or a stock buy reaches the waiting job without a second purchase. Replenishment counts open requisitions as demand (9.1).

### 9.4 Receiving (resolve, step 3; replaces the kit delivery)

For each PO with `eta ≤ W` (in id order) whose carrier ran (3.6), or AOG freight, or `held` with `hold ≤ W`:
1. **Paperwork** (3.7), per line: a line that fails is held a week (`held`, `hold = W + 1`); the review line names the document.
2. **Supersession**: a line whose item the IPC prints as superseded by code 1 or 2 ships as the superseding P/N (*"shipped as TR-155-02 (supersedes TR-155-01, INTCHG 2)"*). Code 3 ships as ordered. A job's pick line is split: what is already reserved for it stays the old P/N (it's on the shelf), the rest becomes the new P/N (a job short 4 of 6 bolts with 2 old ones held keeps 2 old + 4 new; fix round 1).
3. **Against the work order** (a mechanic line bought for a job): `judgePart(ac, ata, tag, pn)` for that job's airplane. `wrong`, `unlisted`: sent back (credited at the payment run, less `STOCK.restock`), the job gets `flow.stop` with the reason and waits for a repick. `displaced` (the IPC part for an assembly an alteration replaced): sent back the same way, and the research branch opens (13). `noteff`: passes receiving (the P/N is in the book); it installs, and leaves a sure defect (11.2).
4. **Into stock**: `on += qty`, average cost updated, a job's lines reserved to it, requisitions `filled`; the PO becomes `received` (payable, 9.7). Then `allocate`.
5. **Not carried**: scheduled POs slip a week (review line). The mainland sub-charter's flights carry POs as guest flights do. A slipping PO with a line for a job whose alert grounds a plane or closes a house takes the AOG boat instead (`FREIGHT.aog`, booked as freight).

### 9.5 Replenishment (resolve, step 11b)

For each item with `rop`/`max`: if `IP ≤ rop`, order `max − IP` rounded up to packs, from its default supplier, scheduled, one PO per supplier and carrier (`by: 'auto'`). Skipped under the freeze (review line *"Replenishment skipped: spendable cash under $2,000."*). This is the analyst's standing policy; it runs whether or not the analyst played. It only refills lines that hold a bin.

### 9.6 Stores bins, carrying charge, the cost of cash

- **Bins.** The stores room has `TierDef.bins` bin locations (40, 50, 60, 75, 90). A line takes a bin while it holds free units or has a min/max set; new lines on open stock POs count too. Job lines (staged with the job), tools (on the tool board) and building materials (in the yard) take none. A `buy` or a `setStock` that needs a new bin when all are taken is refused. Units coming back from a job (a repick, a drop) always go back on the shelf, and bins can run over only that way; buys wait until they're back under. The Stock card shows *"Stores 34/40"*. This is what makes "stock everything" a real trade-off: every insurance spare holds a bin.
- **Carrying charge**: `round(STOCK.carry × invValue)` cash at every resolve (storage and insurance, 0.1% a week), `costs.carry`.
- **The cost of cash tied up** at 26% a year (`STOCK.capital`) is shown on the Money tab but never charged. It's an analytic, as in real FP&A. The cash in stock is the inventory value less what the vendors are still owed for what came in (`cashInStock`: they finance it until the payment run); open POs aren't cash out yet and show apart as *Committed, not yet paid* (fix round 1: the old figure counted received-unpaid stock twice and open POs as cash, about 40% over).

### 9.7 Commitments, payables and the three-way match

- A PO is **committed** when placed (approval, `buy`, replenishment, standing approval, autopilot, migration). Nothing leaves the bank then.
- It is **received** at the resolve that delivers it (step 3), with the vendor's invoice.
- It is **paid** at the next resolve's payment run (step 11: net 7), less the overbilling the analyst's three-way match found that week. The invoice task (17.3) matches the POs received at the last resolve before they're paid. The vendors overbill about 3% of that spend (at least $60; AP error rates run 1–3%), plus one plainly bad invoice ($100–240) in about 2 weeks of 5, seeded per week. The overbilling sits on the POs (`PO.over`, shared by line value) and the match's result sets `PO.caught`, so the payable and the payment run drop by what it found; a skipped match pays all of it (fix round 1). Store credit applies at payment. A line returned at receiving is credited at the same run (off the unpaid invoice).
- `spendable = cash − committed`, where `committed` is the cash still owed on open, held and received-unpaid POs after the store credit that will pay them (credit pays PO lines first; a new PO may also use credit no PO has claimed yet). Every "can we afford it" check reads it: approve, approveReq, buy, the work budget, standing approvals, autopilot and the freeze. The bank balance (`s.cash`) still decides receivership, the bridge loan and the grade, as today.
- The ledger books POs at payment (cash basis); the Money tab shows committed and payable beside cash.

### 9.8 Scrap, store credit, near-miss stock, dead stock

- **Scrap** (7): a return to the vendor for 75% of average cost (credited at the payment run; the 25% is booked `loss`), or a write-off for consumables.
- **Store credit** (`s.credit`, from migration): applies automatically to the next payment runs until used up (the ledger shows spend at full value and `cr`).
- **Near-miss stock** (19.3): the starter shelf and the migrated shelf hold, beside each plane line whose book prints a near-miss, a few units of it: the other SB state's P/N, the other S/N block's, a straight-50 case beside the 20W-50. So "4 on hand ✓" in the Stock step doesn't tell the tech he picked right. It is honest dead stock: the analyst finds it slow or dead, and can scrap it or keep it for a bin's worth of cost.
- **Dead stock** is movement only: an item family with no use in 26 weeks (14.2). There is no effectivity test, so nothing on the analyst's screens reveals which P/N fits which airplane from alert tier 2.

## 10. MEL, make safe, AOG, the sub-charter, closed houses (`econ.ts`, A)

```ts
export function alertAog(s: IslandState, planeId: string, week = s.week): Alert | undefined;       // an open or planned (not done) airworthiness alert on it, due ≤ week, not placarded through ≥ week; every plane
export function subCharterOn(s: IslandState, week = s.week, weather = s.weather);                    // the only guest plane out of service (alert AOG, chain AOG, this week's tag): { plane, alert?, flights, cap, fee, usd }
export function subCharterNeed(s: IslandState, planeId: string, weather?, week?);                    // what a week of it would fly and cost (the cards' "from wk N"); null unless it's the only guest plane
export const isAog = (s, id) => chainAog(s, id) || !!alertAog(s, id);                             // chainAog: today's rule, but a chain opened from the flow (`PartChain.flow`) doesn't ground by itself
export function hazardOn(s: IslandState, houseId: string): Alert | undefined;                       // an open or planned hazard alert on it
export function rentFactor(s: IslandState, h: Asset): number;                                       // 0.75 while a made-safe hazard is open on it, else 1
// houseBlocker: 'hazard' when hazardOn and not made safe (so houseRentable is false); projectWeek and resolveWeek multiply the house's rent by rentFactor
```

- **AOG.** An alert-AOG plane flies nothing and is off the week's schedule, as today's chain AOG (DECISIONS.md, *Pacing*). The review names it: *"Twin N-12 AOG: left brake pedal soft (due week 7, not fixed)."*
- **The only guest plane: grounded, and the mainland sub-charter (2026-09-28).** Past due it's AOG like any plane, until the fix is signed off: *"Twin N-12 AOG: brake pedal travel increasing (due week 7, not fixed): 4 flights cancelled."* An outside Part 135 operator's plane and crew fly the island's guests in meanwhile, automatically: the guests who need a seat (the houses that can rent and the housekeepers can turn over, less the ferry's parties), up to what the twin itself would have flown in service that week (its schedule at its real airworthiness in that weather, as the island's pilots crew it: a twin at 50 is covered for 2 flights of 4, one under 40 for none; fix round 1, so grounding it or leaving its item unfixed never pays better than flying it), no day tours. The island pays `SUB_FEE` a flight ($270: its own $180 a flight × the operator's 1.5), booked as `subcharter` spend and `costs.subCharter`: *"Twin N-12 stayed on the ground: a mainland sub-charter flew the guests in (2 flights at $270, $540)."* The twin's schedule stays on the on-time grade's books (0 of 4: the operator's flights aren't the island's); no near-miss is counted, since nothing flew an unairworthy plane. Its flights carry POs as guest flights do. The mechanic's safety call (`tag`) on it brings the sub-charter too. From tier 4 the float shares the guests, so the twin is grounded with no sub-charter, like any plane. Every seat sees it coming: Investigate, the MEL words, the card's chip (*"From wk 7: sub-charter ~$540/wk"*), the Needs row and the End turn line say what a week of it costs. The old rule (half its flights, a near-miss each) flew a plane past its interval, which an A&P won't sign; the pillar it served (grounding it must never empty every house) is kept by the sub-charter.
- **MEL C.** `mel.until = max(the week placarded, the due week)`: the placard covers the item through its due week's resolve (a placard put on early isn't spent before it's needed). The one extension adds a week (`melExtend`): the mechanic asks for it from the placard row (Investigate, the sent job's sheet and the End turn line, fix round 1: *"Ask Cy to authorize the one-time extension"*; the analyst stands in for the certificate holder's management, whose call and cost it is), the analyst approves it on the card or the Needs list (*"Approve Ana's MEL extension (to wk 9)"*); it can still be asked the week after the placard ran out, before that week's flights. Past it: *"Twin N-12's MEL C for com 1 ran out in week 11: grounded until the radio is replaced."* (the only guest plane too, its guests on the sub-charter; the weeks it flies on the placard the review says so: *"Fix it by then, or it is grounded: a mainland sub-charter flies the guests at about $540 a week (2 flights at $270)."*). The mechanic's End turn says what the MEL still allows: *"Fix it or placard it (MEL C) this week, or from this resolve Cargo C-7 is AOG"*, *"Fix it this week (no MEL relief), or from this resolve …"* (a safety call grounds it too, so it's no way out), *"The MEL placard ran out: ask Cy to authorize the one-time extension, or fix it"* with the ask as a button on the line, *"Cy hasn't authorized the MEL extension yet"* (fix round 1). An MEL item that isn't an airworthiness item (the intermittent com) grounds nothing past its placard: it's an open write-up again, with deferral risk.
- **Make safe.** Breaker off and tagged, or a blank-off: the house rents at ×0.75 (*"Cottage 2 rented at 75%: the bathroom circuit is off and tagged."*). A hazard not made safe closes the house (*"Cottage 2 closed: a guest felt a tingle at the shower valve (make it safe or fix it)."*). **A branch breaker doesn't isolate a service-neutral fault** (the tingle's neutral cause): `makeSafe` with `breaker` there plants a sure hidden `elec:isolation` defect (due W+1..2), removed if the alert is fixed first; else it surfaces as a shock incident (11.4) and re-raises the alert due now. The right move is to leave the house closed (the main off) until the neutral is fixed. Tiers ≤ 2 say so in the finding; tier 3+ doesn't.
- `downtimeOf` loses the kits: the cargo plane down holds its bulk POs due that week (the AOG boat's price for any that carry a line for a grounding job, else nothing).
- The island shows an alert-AOG plane at its AOG spot on jacks (today's art for a chain AOG; the only guest plane too), a plane on an MEL placard with a small placard bubble, a closed house with its no-entry bubble, a made-safe house with a small tag bubble (package D owns island art; A exposes `alertAog`, `melOn`, `subCharterOn` and `hazardOn`).

## 11. Wrong choices surface later (the consequences)

All through the existing machinery: `s.defects` (hidden, `dueWeek`, found by an inspection in scope, or surfacing as an incident traced to the signer), repairs and redos, receiving returns with the restocking fee. New `DEFECT_RULES` rows (A, data.ts) are listed with their words. `sure: true` rows always plant a defect; its severity follows the true score (`defectSeverity`), as today.

### 11.1 Wrong task

At sign-off of a flow job whose task is not in `fixesOf(alert)` (and the alert's cause is a real fault): a sure defect `{ puzzle: 'flow', variant: 'task', alert: { alert, sym, kind }, job: the job's kind, dueWeek: W + 1..2, severity 1 }`. The job's own gain still lands (the work was done), its parts are consumed.
- It surfaces as a minor incident (1.2 × the job's labour, today's `incidentMult[0]`) with the symptom's words, *"Pilot wrote up the same soft brake pedal on Twin N-12: the linings were replaced, the air is still in the line."*, and **re-raises the alert** (`src: 'again'`, due now, same cause). No repair or redo: the fix is the right task.
- An inspection in scope finds it first: the alert is re-raised as `finding`, no incident.
- Rule `flow:task`: incident [`"{a}: the same fault is back ({symptom}): the last job didn't fix it"`, same], found `"the fault the last job didn't fix"`, fix: none (re-raise).
- Planning a job on an NFF alert: no defect (the parts and labour were wasted; the gain lands as preventive work).
- `flow:nff` (an NFF close on a real fault) works the same way: re-raise, no incident.

### 11.2 Wrong part (mechanic)

| What | Caught | Consequence |
| --- | --- | --- |
| Not this item, not in this airplane's IPC, or the IPC part for an assembly an alteration replaced | bought for the job: at receiving; pulled from stock: at the install | Receiving: returned for credit less 15% (min $40), the job waits for a repick (`displaced`: the research branch opens). Install: the job isn't signed off (*Work stopped · wrong part*), the unit goes back to stock unconsumed, `flow.stop` says why. Nothing hidden. |
| Not effective for this S/N or SB status (a legal P/N in the book, the wrong block, or a code-3 part without its set) | nobody, at the time | Installs; sure defect `ipc:noteff`: [`"A records review of {a} found a part installed that isn't effective for its S/N or SB status: it has to come off"`, `"A part not effective for {a} failed in service"`], found `"a part installed that isn't effective for this airplane"`, fix: teardown *"Replace it with the effective part"* (the repair carries the effective P/N, 4.4). |
| Short on quantity, or a slot the cause needs left empty | the install | Work stopped (*"Two linings short: the AMM does both brakes."*). The job waits for a repick. |
| An unapproved ICA part on a logbook entry (the research branch's `entry` route) | nobody | Today's `ipc:unapproved`. |
| Extra or unneeded parts (a tire for a leaking tube) | nobody | Consumed: dead money only. |

### 11.3 Wrong materials or device (electrician)

`judgeElecPick(task, site, lines): { ok: true } | { ok: false; variant: string; text: string } | { stop: string }` (in `src/sim/flow.ts`). A line in the wrong category for its slot stops the install like a mechanic's wrong part (no defect). Otherwise the first rule that fails plants a sure defect `{ puzzle: 'elec', variant }`:

| Variant | Fails when | Incident [minor, severe] | Found by an inspection | Repair (puzzle · job) |
| --- | --- | --- | --- | --- |
| `nogfci` | a GFCI-required location (210.8(A), 680.44) without GFCI protection from the device, the protection slot or `upstream`, including a replacement (406.4(D)(3)) | "A guest at {a} felt a tingle from the {room} receptacle: no GFCI on it" · "A guest at {a} got a shock in the {room}: no GFCI protection" | a receptacle with no GFCI protection where the code needs it | wireup · gfci: "Fit GFCI protection and test it" |
| `noafci` | an AFCI location (bedroom, living, kitchen, laundry, hall) replacement without AFCI protection from the device, the protection slot or `upstream` (210.12(A), 406.4(D)(4)) | "The code inspection at {a} wrote up a receptacle replaced without AFCI protection" · "An arcing fault in a wall at {a} scorched a box: no AFCI on the circuit" | a replacement with no AFCI protection | wireup · outlet: "Fit AFCI protection and re-terminate" |
| `oversized` | a breaker larger than the conductors allow (240.4(D), Table 310.16 at 75 °C): a 70 A feed on #6 | "Callback from {a}: a circuit smells hot, its breaker oversized for the wire" · "An oversized breaker at {a} let the wire overheat: scorched insulation" | a breaker oversized for its wire | wireup · outlet: "Replace the scorched run and land it on the right-size breaker" |
| `undersized` | conductors too small for the circuit or load (14/3 on a 20 A 3-way; #8 hots on a 60 A spa); an EGC under Table 250.122; a 50 A spa panel or feed on a 60 A tub | "Callback from {a}: the {what} trips under load" · "The undersized {what} at {a} overheated: scorched insulation, the circuit dead" | undersized conductors or equipment | conduit or wireup, by job: "Replace it with the right size" |
| `rating` | a 15 A single receptacle on an individual 20 A circuit (210.21(B)(1)) | "The microwave's plug at {a} runs warm: a 15 A receptacle on a 20 A circuit" · "The 15 A receptacle at {a} overheated under the microwave" | a single 15 A receptacle on a 20 A circuit | wireup · outlet |
| `notr` | a receptacle that isn't tamper-resistant in a dwelling or guest room (406.12) | "The code inspection at {a} wrote up non-tamper-resistant receptacles" · "A child at {a} pushed a hairpin into a receptacle: a burn, the guests moved out" | receptacles that aren't tamper-resistant | wireup · outlet |
| `nowr` | outdoors without a WR receptacle and an in-use cover (406.9(B)(1)) | "The porch receptacle at {a} is corroded and tripping after the rain" · "Rain got into the porch receptacle at {a} (no in-use cover): it faulted and scorched the box" | an outdoor receptacle not rated or covered for a wet location | wireup · outlet |
| `boxfill` | the box is smaller than its conductors need (314.16: two 12/3 cables and a device need 20.25 in³) | "Callback from {a}: a switch plate is warm, the box crammed" · "Crammed conductors at {a} nicked and faulted in the box" | an overfilled box | wireup · switch3: "Fit a deeper box and re-terminate" |
| `raintight` | set-screw EMT connectors on the outdoor spa run (358.42) | "Water in the spa feed at {a}: set-screw connectors outdoors, the GFCI trips in the rain" · "Water ran down the spa feed into the panel at {a}: corroded bus, the house closed" | EMT set-screw fittings in a wet location | conduit: "Refit the run with raintight connectors" |
| `noburial` | a splice in the ground not listed for direct burial (300.5(E), 110.14(B)) | "The east cottages flicker again: the feeder splice in the ground is failing" · "The buried feeder splice at {a} failed: two cottages dark" | split bolts and tape buried in the feeder trench | trace, the underground feeder scene (job `feeder`): "Cut it out and re-splice with a direct-burial kit" |

Rule order: category stop, then `nogfci`, `noafci`, `oversized`, `undersized`, `rating`, `notr`, `nowr`, `boxfill`, `raintight`, `noburial`. `stdPick` for a site passes all of them (a test enumerates every site the generators can make).

### 11.4 Everything else

| Wrong choice | What happens |
| --- | --- |
| An MEL placard left past its limit | the plane is AOG until fixed (the only guest plane too: the sub-charter flies its guests, at a price) |
| A hazard not made safe | the house is closed until it's made safe or fixed |
| A service-neutral fault "made safe" at a branch breaker | rule `elec:isolation`: [`"A guest at {a} felt the tingle again: a branch breaker doesn't isolate a loose service neutral"`, `"A guest at {a} was shocked at the shower valve: the service neutral was never isolated"`], found `"a service-neutral fault made safe at a branch breaker"`, fix: none (re-raise, due now) |
| An NFF close on a real fault | it comes back in 1–2 weeks, due now (11.1) |
| An alert ignored past due | deferral risk (5.5); a plane with an airworthiness alert goes AOG (the only guest plane too: the sub-charter flies its guests, at a price) |
| The electrician's bench call wrong | today's `meter:unit` / `meter:wiring` / `meter:radio` |
| Stocking the wrong things | bins held, a small carrying charge, a 25% loss to send it back |
| Buying from the broker | cheaper, a week slower, and one line in four held a week without traceability |

## 12. The week, in order (`engine.ts`, A; staff hooks D)

**`openWeek`** (after today's first steps: weather, turns, modifiers, tags, story):
1. `allocate(s)` (9.3)
2. `generateAlerts(s, r, now)` (replaces `generateOpsOrders`; `wb` and `gpustart` still direct orders)
3. `generateFinTasks` (the auction names a lot; the invoice match covers the POs received at the last resolve: 17.3)
4. `generateReports` (unchanged)
5. `autoApprove` (carried cards on the work budget, 8.4)
6. heal the open chain (unchanged); `rollWeakBattery` (unchanged)
7. `staffOpenWeek(s, r, now)` (D: this week's hiring board)

**`resolveWeek`**:
0. `settleBlind` (unchanged)
1. autopilot for missed seats (18.3); 1b. standing approvals (8.5), and today's `leftoverChainCard` for chain cards
2. flights: capacity per plane with `isAog` (alerts included, the only guest plane too). The only guest plane out of service: `subCharterOn` flies its guests (they count as arrivals and as guest flights for receiving; the fee is paid at step 11). Then the pilots' caps (`pilotCap(s)`, D) cut the fleet's total, taking flights off the cargo plane first so guests keep flying. Weak battery (unchanged). `staffAfterFlights(s, flown, r, W, line)` (D: hard landings raise `M_HARD_LANDING` for next week)
3. `receive(s, W, flew, line)` (9.4; the chain's own part keeps its rules), then `allocate`
4. power (unchanged); `chargeCarts` (unchanged: the carts stay the mechanic's)
5. houses and guests: rentable with hazards, rent × `rentFactor`; `housekeepingCap(s)` (D) caps bookings; occupancy × `reviewMult(s)` (D)
6. charter, load × `charterMult(s)` (D)
7. deferral risk (unchanged) plus unplanned alerts past due (5.5); the week's AOG plane-weeks booked by cause (14.1)
7b. hidden defects surface (plus the `flow:*` re-raises and `elec:isolation`)
8. carry-over (unchanged for orders); alerts: prune closed ones older than `ALERTS.keep` weeks; 8b. the chain (unchanged plus 13)
9. decay and storm (unchanged)
10. money hunts (unchanged; the invoice match's catch on real POs, 9.7), 10b. reports (unchanged)
11. cash: revenue − overhead (`TIERS[tier].overhead`) − `payroll(s)` (D) − premium − leaks − reports − incidents − loan − power − `carryCost(s)` − `payRun(s, W, line)` (the POs received at earlier resolves, less what the match caught; 9.7). 11b. `replenish`, then `allocate`. 11c. `buildWeek(s, r, W, line)` (D: builders progress and draw materials from stock)
12–18. unchanged (forecasts, grade, stats, XP, tier-up, story, MVP), with `costs.overhead`, `costs.payroll`, `costs.carry`, `costs.freight`, `costs.labor`, `costs.parts` in the report. Step 16's `finishProjectIfDone` gives the new tier's buildings their starting health from the crew project's quality **and** the builders' share of the site work done (15.5); the crew project alone still decides when a tier arrives
19. the ledger's week closes (revenue, cash, inventory value), trimmed to 26 weeks; then `openWeek`

`fixedNow(s) = TIERS[tier].overhead + payroll(s)` (A, `econ.ts`) replaces `TierDef.fixed` everywhere it's read today: `budgetCap`, the bridge loan's size, the desk's *Fixed* chip, `forecastContext`'s baseline, and `runway`.

## 13. The part chain as a branch of the flow

The Phase B chain (`src/sim/chain.ts`, `engine.ts` "Part chain") keeps its machinery: its steps, its cards (`part`, `eng`), the AOG boat or guest-flight freight choice, receiving with its 8130-3 roll and quarantine, restocking returns, engineering's answer, `ipc:unapproved`, the story in the review.

- **Entry from the flow, and only from the flow's research.** `plan` or `repick` with `research: true` (the tech's *Not in the IPC · research the records*), or a `displaced` part at receiving or the install, opens the chain at **research** for that job: `PartChain` with `orderId` = the flow job, `flow: true` (new optional field: it doesn't ground the plane by itself; the alert does, if it is an airworthiness one), `ata` and `tag` from the task's IPC slot, `item = itemName(tag, model)`, `found` = the symptom text, step `research` (`researchStep`). The job waits (`waiting_part`, `o.chain = { id, step: 'job' }`). When a chain is already open, the job queues (`flow.queued`), and the research opens when that chain closes (checked at every resolve and every close).
- **Exit.** The chain's part comes by its own freight and receiving; at `install` the job is `ready` with the chain's part plus its bench lines from stock. When engineering approved it (`src: 'eng'`), closing the chain records `s.eas.push({ assetId, ata, tag, pn, ea: 'EA yy-nnn', week })` (the number from `hashSeed`, formatted like aircraft.ts `eaNo`). From then on the IPC index shows that ICA part as a normal row *"EA 26-104 · KA-66-19HD LINING, METALLIC (Kestner)"*, `judgePart` accepts it, and it can be stocked like any other item: no second research on that airplane.
- **No random trigger on flow jobs** (`CHAIN.flowChance` 0). The flow's Parts step is the IPC lookup, so the chain's IPC-lookup puzzle would ask the same question twice and add another multi-week AOG source. Legacy orders (no `flow`: migrated ones, and the ones the chain tests build) keep today's trigger and `CHAIN.chance` 0.3, so `tests/chain.test.ts`, `bench.test.ts`, `chaingse.test.ts` and `chainmoney.test.ts` keep building their chains the way they do. Chains already open keep their own bench.
- **`crossMoves`** keeps listing the chain; a flow-opened chain's banner says *"Research: the {item} on {plane} isn't in the IPC"* and doesn't say AOG unless the alert grounds it.

## 14. Finance tracking (A computes, C draws)

The owner: *"make the analyst be able to track finances more closely too just in passing so we can plan. so i can see which parts we move over time quickly vs slowly"*. Only the weekly aggregates in 2.5 are stored; everything below is derived from them, the stock lines, the POs and `history`.

**What the data can support.** Today's engine gives the three friends about 1.6 mechanic trade jobs a week (41 a game, 16 of them 100-hour inspections) and 2.7 electrician jobs (measured over 30 seeds × 26 weeks). Those jobs are spread over a couple of hundred item ids: the twin's tire and tube move less than once a game. So movement is measured **per item family over 26 weeks**, not per P/N per week, and the classes rank families against each other.

### 14.1 Recording (`src/sim/ledger.ts`, A)

```ts
export function ledgerRow(s: IslandState, W = s.week): WeekLedger;   // this week's row, created on first use
export function book(s: IslandState, cat: SpendCat, usd: number, o?: { trade?: 'mech' | 'elec' | 'build' | 'fin'; asset?: string | null }): void;
export function bookUse(s: IslandState, item: ItemId, qty: number, value: number, asset: string | null): void;
export function bookRcv(s: IslandState, value: number): void;
export function bookLoss(s: IslandState, usd: number): void;
export function bookFill(s: IslandState, filled: number, planned: number): void;   // main-slot value
export function bookAog(s: IslandState, cause: 'stock' | 'approval' | 'plan' | 'carrier'): void;
export function closeLedger(s: IslandState, W: number, revenue: number): void;   // resolve step 19
```

| Event (caller) | What it books |
| --- | --- |
| `payRun` (stock.ts) | each PO line at the price paid, to `parts` / `consumables` / `rotables` / `materials` (lots too) / `tools` / `building` by the item's kind and trade; freight to `freight`; trade = the item's trade (`build` for building materials); store credit used to `cr`; the match's catch comes off |
| a flow job approved (the analyst, the work budget, the standing approval) | its labour to `labor`, trade = the job's, and to `as[asset]` |
| `consume` at a sign-off (stock.ts) | `use[item] += qty`; `usedV += value`; `as[asset] += value`, at average cost |
| builders draw a unit (D, through `takeStock`) | `use`, `usedV`; `as['build:' + id] += value` |
| `receive` (stock.ts) | `rcvV += value` (stock built) |
| `plan` (engine) | `fill`: main-slot value covered from stock at plan time / main-slot value planned |
| resolve step 8 (engine) | `wait += 1` for every job `waiting_part` on a requisition, a PO or a tool |
| resolve step 7 (engine) | `aog[cause] += 1` per plane-week AOG on an alert: `stock` (its fix needed a line not on hand when planned), `approval` (planned, the card pending), `plan` (nobody planned it), `carrier` (ordered, not delivered in time) |
| resolve step 11 (engine, D's `payroll`) | `overhead`, `payroll`, `carry`; credits (returns, scrap) as negative amounts in their own category |
| returns and scrap | `loss`: the 25% not credited; written-off consumables |
| engineering fee | `eng` (trade mech) |
| resolve step 19 | `rev`, `cash`, `inv = invValue(s)`; rows older than 26 weeks dropped |

The ledger doesn't copy what `history` already holds (insurance, incidents, refunds, leaks, the loan, power); the series in 14.2 merge the two.

### 14.2 Derived analytics (pure; memoized per state object with a `WeakMap`; computed once per bot turn)

```ts
// src/sim/stock.ts
export type Family = { fam: string; label: string; trade: ItemTrade; group: 'parts' | 'consumables' | 'materials'; items: ItemId[] };
export function families(s: IslandState): Family[];               // families with stock, use, open POs or known demand on this island
export type Velocity = {
  fam: string;
  series: number[];          // units used per week, the ledger's weeks (at most 26), oldest first
  weeksUsed: number;         // weeks with any use
  perWeek: number; sd: number;
  valueMoved: number;        // value consumed over those weeks
  lastUsed: number | null;   // week
  onHand: number; value: number;
  turns: number | null;      // annualized: 52 × weekly value used ÷ the family's inventory value (null with none on hand)
};
export function velocity(s: IslandState, fam: string): Velocity;
export type MoveClass = 'fast' | 'steady' | 'slow' | 'dead' | 'new';
export function moveClass(s: IslandState, fam: string): MoveClass | null;   // null: under 8 weeks of ledger
export function insuranceSpare(s: IslandState, fam: string): boolean;
export function knownDemand(s: IslandState, item: ItemId): { week: number; qty: number; why: string }[];   // 9.1
export function needs(s: IslandState): { alert: string; trade: OpsRole; asset: string; text: string; due: number; aw: boolean; nudged?: number }[];
export function suggestRop(s: IslandState, item: ItemId): { rop: number; max: number; why: string };
export type StockFlag = { item?: ItemId; fam?: string; kind: 'order' | 'stop' | 'norop' | 'bins' | 'held'; text: string; urgent: boolean; act?: Action };
export function stockFlags(s: IslandState): StockFlag[];
export function onOrderValue(s: IslandState): number;
export function auctionLot(s: IslandState, r: Rng): { lines: { item: ItemId; qty: number }[]; fair: number; list: number } | null;   // 17.3
export function invoiceContext(s: IslandState): PuzzleContext['invoice'] | undefined;                                                 // 17.3
// src/sim/ledger.ts
export type OutCat = 'parts' | 'labor' | 'freight' | 'carry' | 'payroll' | 'overhead' | 'tools' | 'building' | 'insurance' | 'incidents' | 'other';
export function spendSeries(s: IslandState, weeks?: number): { w: number; rev: number; out: Record<OutCat, number>; cash: number }[];   // 12 by default
export function tradeSpend(s: IslandState, weeks?: number): Record<'mech' | 'elec' | 'build' | 'fin', number>;                          // 4
export function assetSpend(s: IslandState, weeks?: number): { asset: string; usd: number }[];                                          // 13, largest first
export function stockBuiltUsed(s: IslandState, weeks?: number): { w: number; built: number; used: number }[];                          // 12
export function fillRate(s: IslandState, weeks?: number): number | null;   // 8: main-slot value covered from stock ÷ planned
export function waitWeeks(s: IslandState, weeks?: number): number;         // 8
export function runway(s: IslandState): { weekly: number; weeks: number };  // fixedNow + premium + loan, and the weeks of it spendable cash covers
export function cashInStock(s: IslandState): number;                        // inventory value less payables (the vendor still finances what came in unpaid)
export function capitalCost(s: IslandState): number;                        // cashInStock × STOCK.capital, a week (open POs are committed, not cash out yet)
```

- **Families.** Plane parts: tag × model (every P/N that fills that slot on that model: both S/N blocks, both SB states, the ALTs), so a family's numbers never reveal an effectivity. Consumables and lots: the item. Electrical devices: category × rating (*GFCI receptacles 20 A*, *AFCI protection 15 A*, *THWN-2 #6*, *spa panels*). Building materials: the item. Tools have no class.
- **Classes**, over the flow's weeks on the ledger (`flowRows`: the rows from `flowSince` on, at most 26; a migrated island's backfilled rows carry no item use and don't count): rank the families used at least once by `weeksUsed` (ties: value moved). The top third is **fast**, the bottom third **slow**, the rest **steady**. **dead**: on hand, no use in the last 25 flow weeks (only once there are 25; fix round 1: a migrated island's stock isn't called dead on week one). **new**: first received under 8 weeks ago and never used. With under 8 flow weeks (a new or migrated island) the planner shows use counts only: *"Velocity builds up from week N: classes start after 8 weeks."* The item sheet's *"used in N weeks"* and *"since"* read the same flow weeks.
- **Insurance spares**: a family that an airworthiness or hazard cause needs, on a model or house type the island has (main tires and tubes, linings, the hydraulic filter, com radios, alternators; GFCI, DF and AFCI devices; not the spa panel, which is install material with its own lead). A spare's bench consumables count with it (the rivets a relining needs). It is effectivity-blind (the family, not the P/N). The planner never flags one Stop, the fin bot never scraps one, and `suggestRop` keeps at least one job's worth (4 linings; a tire and a tube; one radio).
- **Suggested ROP / max**: 9.1, with the family's `perWeek` and `sd` for plane parts. `why` says it in words: *"Twin main tires: 2 used in 26 weeks, lead 1 week: keep 1, order up to 2 (an insurance spare)."*
- **Flags.** `order` (9.1): `urgent` when a job waits on it, and then its one-tap action approves that job's requisition or card (never a second, untied stock buy). `stop`: dead, or slow with a min/max set and no known demand for 8 weeks, and not an insurance spare; never while the forecast, an open job, a part chain or an open PO draws the family, and never on a slow family not yet used (fix round 1): *"Stop stocking KR15: no use in 26 weeks ($22 on the shelf, a bin)."* `norop`: an item of a fast family with no ROP. `bins`: under 3 free bins. `held`: a PO in quarantine.
- **Needs** (unplanned alerts): *"Twin N-12: main tire worn, due wk 9 · Seb hasn't planned it"*, with a one-tap **Nudge**. A scheduled item (a due inspection, a code or AD item with its pre-filled task) reads *"scheduled: Seb starts it"* with no nudge. There is no P/N and no effectivity: P/Ns reach the analyst only from plans and requisitions, so the tech's early plan is the information share.

### 14.3 What the analyst sees (C; screens in 17.3)

Two places, both readable in seconds: one big number per card, one sparkline or bar, at most three chips; a tap opens the detail.

1. **Money tab, Cash card**: cash now, spendable, committed, payable at the next resolve; a 12-week line of week-end cash over revenue (bars up) and cash out (bars down); chips: runway (*"fixed costs covered 3.4 weeks"*), the work budgets used this week, forecast revenue.
2. **Money tab, Cash out, 4 weeks** (12 on tap; it was *Where it went*: stock bought is working capital, not opex): a stacked bar per week by `OutCat`, with the labour line named *Shop charges (overtime, call-outs, outside help)* and one line saying so (the island's own tech and electrician aren't paid per job), the trade split (mech, elec, build, analyst), and the top three assets by spend over 13 weeks (*"Twin N-12 $4,210 · Cottage 2 $1,380 · Island grid $920"*).
3. **Money tab, Stock card**: inventory value; stock built vs used (12 weeks); cash in stock and its capital cost, and what's committed on open POs; fill rate by value (8 weeks); job-weeks waiting on parts (8 weeks); bins. Then two short lists, **parts** and **consumables** apart, ranked by value moved: the fast families, and the slow and dead ones with *"last used 11 weeks ago"*. Each row opens the family in the planner.
4. **Stock tab rows** carry their family's velocity (17.3).
5. **Money tab, Overhead and payroll**: the tier's overhead in lines (leases 35%, utilities 25%, property insurance 15%, admin 15%, licences and fees 10%), and the payroll (15), each a weekly cost to the company.

### 14.4 Budgets

The trades' work budgets (8.4) and the standing limit (8.5). The approval card says *"Mech work budget this week: $240 of $500"*. There are no spend budgets in v1.

### 14.5 Old islands

`migrate()` backfills `ledger` rows from `history` (up to 26 weeks): `rev`, `cash`, and `sp.overhead` / `sp.payroll` (that week's `fixed` split by the standard payroll), nothing item-level. Classes start 8 weeks after migration.

## 15. NPC staff (package D; A writes the types, the constants and the stubs)

The owner: *"a couple npc to help with expansion of the island like builders and other people that aren't gonna be supplied with other people (these are on the islands payroll and we can hire more skilled for more money etc) analyst decides on hiring."*

NPCs never do mechanic, electrician or analyst work: they don't plan, search, sign off, approve or buy. Unlocks still need the full crew (autopilot weeks don't count toward them), so solo and absent teams stay at tier 1 whatever the staff. In v1 the decision is **hire, let go and skill**. Every hire states what it buys (15.7). There is no morale, no raises, no traits and no staff asks (the crew board is where the techs ask).

### 15.1 Roles

| Role | Does | Effect (hook) | Wage at skill 3 (weekly cost to the company) |
| --- | --- | --- | --- |
| `pilot` | flies the guest, charter and cargo runs | the fleet's flights are capped by duty (`pilotCap`); the guest planes need skill 3+ (company policy: a new pilot builds time on the cargo runs, as feeder operators do); tours sell better with a better pilot (`charterMult`); brake and tire wear (`wearMult`); hard landings (`staffAfterFlights`); their write-ups' quality (`squawkNff`); their name on their squawks (`pilotOf`) | $320 |
| `housekeeper` | turnovers between guests, the front desk | bookings capped by turnovers (`housekeepingCap`); occupancy × `reviewMult` | $180 |
| `builder` | the site work for the next tier's buildings; optional cottages | `buildWeek`: progress, materials drawn from stock, rework; the new buildings' starting health (15.5) | $260 |

Line crew and the groundskeeper wait for v2 (0.3). Without line crew there are no tows, and the carts stay the mechanic's chore.

### 15.2 The numbers (`STAFF` in `src/sim/staff.ts`; tune)

```ts
export const STAFF = {
  wage: { pilot: 320, housekeeper: 180, builder: 260 } as Record<NpcRole, number>,
  skillWage: [0.7, 0.85, 1, 1.2, 1.45],             // × wage, skill 1..5
  severanceWeeks: 2,
  duty: 6,                                           // flights a pilot flies a week
  guestMinSkill: 3,                                  // skill 1–2 fly the cargo runs only
  charter: 0.04,                                     // charter load × (1 + charter × (mean skill of the guest planes' pilots − 3))
  wear: [1.3, 1.15, 1, 0.9, 0.8],                    // the `tires` kind's alert weight on the planes a pilot flies
  hardLanding: [0.008, 0.005, 0.003, 0.002, 0.001],  // per flight; never on the only guest plane
  hardLandingHit: 2,                                 // health
  squawkNff: [0.1, 0.05, 0, 0, 0],                   // added to the NFF share of their pilot squawks
  turnovers: [2, 3, 4, 5, 6],                        // houses a housekeeper turns over a week
  review: 0.025,                                     // occupancy × (1 + review × (mean housekeeper skill − 3)), clamped 0.95..1.05
  output: [0.6, 0.8, 1, 1.25, 1.5],                  // builder work units a week
  rework: [0.2, 0.12, 0.06, 0.03, 0.01],             // a builder-week fails the inspector's check
  maxStaff: 10,
  standard: [                                        // the standard crew by tier, all skill 3
    { pilot: 1, housekeeper: 1, builder: 1 },        // $760
    { pilot: 2, housekeeper: 1, builder: 1 },        // $1,080
    { pilot: 2, housekeeper: 1, builder: 1 },        // $1,080
    { pilot: 2, housekeeper: 2, builder: 1 },        // $1,260
    { pilot: 3, housekeeper: 2 },                    // $1,320: the Lodge's site work is done before tier 5
  ] as Partial<Record<NpcRole, number>>[],
};
export const standardPayroll = (tier: number): number;   // 760, 1,080, 1,080, 1,260, 1,320
// data.ts: TierDef.overhead = fixed − standardPayroll = 740, 1,220, 1,920, 5,740, 8,180 (`fixed` stays for old readers and tests)
```

**The standard crew at skill 3 reproduces today.** Its pilots fly 6, 12, 12, 12 and 18 flights a week against 4, 8, 8, 12 and 15 scheduled, all of them guest-qualified. Its housekeepers turn over 4, 4, 4, 8 and 8 houses against 2, 4, 4, 6 and 7. Charter, review, wear and write-up quality are ×1 at skill 3. Its builder finishes each tier's site work before the crew project (15.5), so new buildings start at today's health. Payroll + overhead = today's fixed cost. Hard landings (0.3% a flight at skill 3: about one every 28 weeks at 12 flights a week, never on the only guest plane) raise alerts that take a slot from the week's picks (5.1), so the job volume doesn't change. The staff test turns them off to compare with the stub run (21.4).

### 15.3 People and what their skill does

- **Names**: first name and last initial from a fixed list of 60 island names (*Marta K., Keanu P., Aroha T., Joaquín R., Lina M., Dev S., Noor A., Tomasi F., …*), by `hashSeed(s.seed, 'npc', id)`, unique among the staff and this week's candidates. Ids `n1`, `n2`, … from `s.nextId`.
- **Wage**: the ask when hired. It doesn't change in v1.
- **Start**: skill 1–3 start the week they're hired; skill 4–5 the week after (they give notice where they are). They count from the resolve of their start week.
- **Effects, exactly** (D):
  - `pilotCap(s)` = `{ guest: Σ duty of working pilots with skill ≥ 3, total: Σ duty of all working pilots }`. Resolve step 2 caps the guest planes' flights at `guest` and all flights at `total`, taking flights off the cargo plane first: *"2 flights lost: 2 pilots fly 12 a week. Hire a pilot?"* Those flights stay on the schedule (the on-time grade counts them).
  - `pilotOf(s, planeId)`: pilots are assigned best first to the guest planes, then to the cargo plane; the plane's pilot is the one who flies most of its flights.
  - `charterMult(s)` = 1 + 0.04 × (mean skill of the guest planes' pilots − 3): a skill-5 pair sells 8% more tours.
  - `wearMult(s, planeId)` = `wear[skill − 1]` of that plane's pilot.
  - `staffAfterFlights`: each flight flown rolls its pilot's `hardLanding` (not on the only guest plane). A hard landing takes `hardLandingHit` from the plane and raises `M_HARD_LANDING` for next week (`week: W + 1`, `src: 'landing'`, `who` = the pilot, due `W + 1`). It counts as open work in next week's slots (5.1).
  - `squawkNff(s, planeId)` = `squawkNff[skill − 1]` of that plane's pilot (5.1).
  - `housekeepingCap(s)` = Σ `turnovers` of working housekeepers; step 5: `booked = rentable.slice(0, min(arrivals, cap))`: *"1 house empty: housekeeping turns over 4 a week. Hire a housekeeper?"* No housekeeper: nothing is booked.
  - `reviewMult(s, booked?)` = 1 + 0.025 × (the skill of the housekeepers who turn the week's bookings over − 3), clamped 0.95..1.05: the best first, each up to their turnovers (the contractor's cleaners in a tier's first week at skill 3). A spare who turns nothing over moves no review (fix round 1: the hiring board no longer says a skill-2 spare costs reviews).
  - `payroll(s)`: Σ wages of the staff whose start week has come; `costs.payroll`; `costs.fixed = overhead + payroll`.

### 15.4 Hooks (A writes each with the stub in brackets; D implements)

```ts
export function staffOpenWeek(s: IslandState, r: Rng, now: number): void;                      // [no-op] this week's hiring board (15.7)
export function pilotCap(s: IslandState): { guest: number; total: number };                     // [{ guest: Infinity, total: Infinity }]
export function pilotOf(s: IslandState, planeId: string): Npc | undefined;                      // [undefined]
export function charterMult(s: IslandState): number;                                            // [1]
export function wearMult(s: IslandState, planeId: string): number;                              // [1]
export function squawkNff(s: IslandState, planeId: string): number;                             // [0]
export function staffAfterFlights(s: IslandState, flown: { plane: Asset; n: number }[], r: Rng, W: number, line: Liner): void;  // [no-op]
export function housekeepingCap(s: IslandState): number;                                        // [Infinity]
export function reviewMult(s: IslandState, booked?: number): number;                            // [1]
export function payroll(s: IslandState): number;                                                // [standardPayroll(s.tier)]
export function builtShare(s: IslandState, tier: number): number;                               // [1] the share of that tier's site work done
export function buildWeek(s: IslandState, r: Rng, W: number, line: Liner): void;                // [no-op]
export function staffAction(s: IslandState, prev: IslandState, a: StaffAction, now: number): ApplyResult;  // [fail: "Hiring opens with the staff update."]
export type StaffEffect = { does: string; need: string; money: string; net: number; payback?: number };
export function staffEffect(s: IslandState, who: Candidate | Npc, change: 'hire' | 'letGo'): StaffEffect;   // [a stub text] (15.7)
export function botStaff(s: IslandState, bot: Bot, r: Rng, now: number): IslandState;           // [returns s]
export function autoStaff(s: IslandState): void;                                                // [no-op] an absent analyst's autopilot
export function migrateStaff(s: IslandState): void;                                             // [full: the standard crew and the builds (15.8); A writes it, D may refine]
export function newIslandStaff(s: IslandState): void;                                           // [full: the tier-1 standard crew and the t2 build, for createIsland]
```

With the stubs, A's build plays exactly as today apart from the job flow (fixed cost = overhead + standard payroll; new buildings at today's health). `projectWeek` (A, `econ.ts`) applies `pilotCap`, `housekeepingCap`, `reviewMult` and `charterMult` the same way `resolveWeek` does, so the desk's projection and the hire sheet see what a staff change does. Today's `projectWeek` knows no caps, so a pilot hired to win back lost flights would look like pure cost.

### 15.5 Builds: the builders' site work

The prefab shells of a tier's new buildings come with the tier (the mainland contractor, in overhead). The island's builders do the site work: piers and footings, decks and steps, roof flashing, trim and shutters, and the seaplane dock. **The crew project alone still decides when a tier arrives.** The builders decide how good its new buildings are: the new houses and the generator house start at

`health = 60 + 30 × project quality − 15 × (1 − builtShare(s, tier))`

With the site work done, that is exactly today's `60 + 30 × quality`; with none done, 15 lower, which is two to three weeks of the electrician's upkeep on each new building. Planes and the grid keep today's formula.

```ts
export interface BuildDef { id: string; what: string; tier?: number; units: Partial<Record<ItemId, number>>[] }
export const BUILDS: BuildDef[] = [
  { id: 't2', tier: 2, what: 'Set cottages 3 and 4: piers, decks and trim',
    units: [{ 'BLD-FTG': 1 }, { 'BLD-DECK': 1, 'BLD-TIE': 1 }, { 'BLD-FLASH': 1 }] },                                  // 3 units, $640
  { id: 't3', tier: 3, what: 'The generator house: pad, piers and roof flashing',
    units: [{ 'BLD-FTG': 1 }, { 'BLD-FLASH': 1 }] },                                                                   // 2 units, $400
  { id: 't4', tier: 4, what: 'Set the villas and build the seaplane dock',
    units: [{ 'BLD-FTG': 1 }, { 'BLD-PILE': 1 }, { 'BLD-MDECK': 1, 'BLD-TIE': 1 }, { 'BLD-SHUT': 1 }] },                // 4 units, $1,120
  { id: 't5', tier: 5, what: 'Set the Lodge: piers, decks, trim and shutters',
    units: [{ 'BLD-FTG': 1 }, { 'BLD-DECK': 1, 'BLD-TRIM': 1 }, { 'BLD-FLASH': 1 }, { 'BLD-SHUT': 1 }] },              // 4 units, $1,030
];
export const COTTAGE: BuildDef = { id: 'cottage', what: 'An extra cottage: piers, deck, flashing, trim and shutters',
  units: [{ 'BLD-FTG': 1 }, { 'BLD-DECK': 1, 'BLD-TIE': 1 }, { 'BLD-FLASH': 1 }, { 'BLD-TRIM': 1 }, { 'BLD-SHUT': 1 }] };  // 5 units, $1,090 + the shell
```

- **The queue.** A new island starts with t2 open. When a build finishes, the next one opens: the tier builds in order, then any cottages the analyst queued. The builders always work the first open build.
- **A week of work** (`buildWeek`, step 11c): each builder working this week adds `output[skill − 1]` to the first open build. Before work starts on unit *k* (`drawn ≤ k`), that unit's materials leave stock all at once (`takeStock(s, lines, 'build:' + id)`, A: all or nothing, books the use). If any line is short, work stops at the unit boundary and `idle += 1`: *"Builders idle on the villa site: waiting on 1 × BLD-SHUT (on the supply boat, week 13)."* `done` never passes `drawn`. Rework: each builder-week rolls `rework[skill − 1]`; that week's work is lost and one more BLD-TIE box is drawn (*"The inspector failed Keanu's deck framing: redo the connections."*).
- **Finished** (`done ≥ need`): `finished = W`; feed *"The villas' site work is done: they open with tier 4 in good shape."* The next build opens.
- **Standard timing** (each unit's materials bought when it opens: lead 1 on the supply boat): a skill-3 builder finishes t2 around week 3, t3 week 5, t4 week 9 and t5 week 13. That's well before the crew projects (median weeks 8, 11, 16, 22). A skill-1 builder (0.6 a week) takes to about weeks 5, 9, 15 and 22: the Lodge's site work sometimes misses tier 5. With no builder nothing progresses, and the new buildings start 15 lower.
- **The island** (D): a build site shows the further of the crew project's stage and the build's (`min(2, ⌊3 × done / need⌋)`), with the builders on it.
- **Tier progress** (`nextTierProgress`, A): a line *"Site work (builders): 2.5 of 4"* beside the existing unlock lines.
- **Home** (A mounts `BuildStatus` for the whole game, outside the crew-project card; D fills it): *"Builders: 2 of 3 units on cottages 3 and 4 · next 1 × BLD-FLASH, on the supply boat wk 6"*, or *"Builders: no site work open · start a cottage?"*. With a build open, the line is a button: it zooms the island to the builders' site (`siteBox` in `src/ui/island/geo.tsx`), as does a tap on a builder; *See the island* goes back (docs/DECISIONS.md, 2026-09-28).

### 15.6 Optional cottages: the builders' growth project (only if the island art has room)

- From tier 3 the analyst can start up to two extra cottages (`build`; assets `h8`, `h9`). The prefab shell costs `COTTAGE_SHELL` $17,000 (the mainland contractor), paid at the start and booked to `building`, plus the `COTTAGE` build. When it finishes, the cottage joins (health 80, inspection in 8 weeks). It rents like the others, needs a housekeeper's turnover and a guest arrival, and brings its own electrician alerts.
- It's priced for a **payback of about 26 weeks** at the tier's rates (tune). It's an investment for an island that keeps playing, weighed against the $60,000 tier-5 target, not a dominant move. The start sheet shows the payback at a normal week's rates: the flights and bookings averaged over the last 8 weeks, so a week with two planes due-now AOG doesn't price a $17,000 shell at $11 a week (fix round 1).
- The bots don't build them in the standard run. The balance run has a variant that does (20.5).
- If the island art has no plot for it, this is dropped and `build` is refused (*"No plot is ready for another cottage."*).

### 15.7 The hiring board and the effect statements

- Drawn at every week open (`staffOpenWeek`) from `hashSeed(s.seed, 'hire', W)`: 3 candidates (4 from tier 3). The board is replaced every week.
- The first candidates cover needs, in this order: a role below the standard crew for the tier (a builder only while a build is open); a pilot if flights were lost to the pilot cap last week; a housekeeper if bookings were; a builder if a build is open and no builder works. The rest are random, weighted pilot 3, housekeeper 3, builder 2.
- Skill 1–5 with weights 25 / 30 / 25 / 15 / 5 %. Ask = round10(`wage[role] × skillWage[skill − 1] × r.range(0.95, 1.1)`). Start as in 15.3.
- **Effect statements** (`staffEffect`, D; computed from `projectWeek` with and without the change). Every candidate card and every crew row states what the change does against this island's need, in the island's own numbers, then in money:
  - a pilot: *"flies 6 a week · guest planes OK · you're losing 2 flights a week: +2 flights (~$900 of tours, 1 more house booked)"*, *"tours +4% (~$60 a week)"*, *"a hard landing about once in 55 weeks"*. A skill 1–2 pilot: *"flies the cargo runs only: you have no cargo plane (0 flights)"*.
  - a housekeeper: *"turns over 2 a week · you book 4: 2 houses would sit empty (−$2,000 a week)"*.
  - a builder: *"0.6 units a week: the villa site done wk 15 (a skill 3: wk 12) · new villas start at 81 instead of 84"*.
  - the money: *"$380 a week (weekly cost to the company) · net about +$580 a week"*. For a let-go: *"saves $260 a week after $520 severance: pays back in 2 weeks · the Lodge's site work stops"*.

### 15.8 Old islands and new islands

- `migrateStaff` (called by `migrate`, 19): `staff` = the standard crew for the tier, skill 3, standard wages, hired and started this week, names from the seed. Builds for tiers up to `tier + 1` are finished (`builtShare` 1, so an open crew project finishes exactly as it would have), and the build for `tier + 2` (up to 5) is open with nothing done. There's no board until the next week open.
- `newIslandStaff` (createIsland): the tier-1 standard crew and the t2 build open.

### 15.9 Actions (D; types in `types.ts` by A; all in `WEEK_BOUND`; no turn lock, like every analyst action)

```ts
export type StaffAction =
  | { t: 'hire'; cand: string; week?: number }
  | { t: 'letGo'; npc: string; week?: number }
  | { t: 'build'; what: 'cottage'; week?: number };
```

| Action | Who | Allowed when (else the error) | Effect |
| --- | --- | --- | --- |
| `hire` | analyst | on this week's board (*"That candidate took another job."*); staff under 10 (*"No room on the island for more staff."*); not in receivership (*"In receivership: no new hires."*) | adds the `Npc` (`wage` = ask, `hired = W`, `start`), removes the candidate; feed |
| `letGo` | analyst | on staff; spendable covers the severance (*"Not enough cash for the severance ($640)."*) | pays `severanceWeeks × wage` now (booked to `payroll`), removes them; feed |
| `build` | analyst | tier ≥ 3 (*"Extra cottages open at tier 3."*); a plot free (*"No plot is ready for another cottage."*); at most two (*"Two extra cottages is all the island has room for."*); spendable covers the shell (*"Not enough cash for the shell ($17,000)."*) | pays the shell, queues the cottage build |

### 15.10 NPC figures on the island (D: `src/ui/island/staff.tsx`)

- Up to 8 figures, each one `<use>` of a symbol: the existing `#i-guy`, plus new symbols with a hard hat (builders), an apron (housekeepers) and a white shirt (pilots), defined once in `LifeDefs`. Placement: builders on the open build's site (one each, up to 3; on the villas and the seaplane dock, at the site of the unit they work: `workSites` in `src/ui/island/geo.tsx`); a pilot by the lead guest plane and one by the cargo plane (up to 2); a housekeeper at a booked house (up to 2).
- None in a storm or at night, except one figure at the office window. A two-frame hammer bob for builders when motion is on; otherwise static.
- D also draws what A exposes (10): the alert-AOG plane at its AOG spot, the placard bubble of a plane on its MEL placard, the closed-house no-entry bubble, and a small tag bubble on a made-safe house.
- **Node budget**: the beaten island-lab scene stays at or under 1,500 SVG nodes (1,365 today; the crew adds at most 8, plus the symbols). New island-lab scenes: `staff` (tier 3, builders on the villa site, a pilot by the twin) and `staff-night`.

### 15.11 The hiring UI (D: `src/ui/staff/`)

- `StaffDesk.tsx`, the analyst's Staff tab (A mounts it in `desk.tsx`; C places it in the Staff tab):
  1. A payroll strip: payroll and overhead a week (weekly cost to the company), runway, the week's projected net (red when negative).
  2. The crew: one row each (role icon, name, skill dots, wage, what they do now: *"flies 6: twin 4, cargo 2"*), with **Let go** (its effect statement, confirm).
  3. The hiring board: a card per candidate (role, name, skill, ask, start, its effect statement) with **Hire**. Hire opens a confirm sheet with the payroll after and the capacity and money change: *"Payroll $1,080 → $1,460 a week. +2 flights a week (~$900 of tours + 1 house booked): net about +$580 a week."*
  4. The builds: the open build's units, each unit's materials (on hand / on order with ETA / missing), and **Buy the next unit** (dispatches `buy` for the shortfall, scheduled, from the yard). From tier 3 there's also **Start a cottage** (the shell's price and the payback).
- `BuildStatus.tsx` (A mounts it in `home.tsx`, outside the crew-project card): 15.5.
- Tap sequence, hiring: Staff tab (1) → **Hire** on a candidate (2) → confirm (3).

### 15.12 Staff bots and autopilot (D: `botStaff`, `autoStaff`)

- **The fin bot** (not naive) keeps the standard crew for the tier, so the balance run stays at the neutral point (it lets the builder go at tier 5, where the standard crew has none; an idle builder at tier 4 is a saving left to people). For a role below the standard count, or one that lost capacity last week, it hires the best candidate with skill ≥ 3 for pilots (≥ 2 for the others) and an ask ≤ 1.25 × the skill-3 wage. It buys the open build's next two units' materials.
- **The naive analyst** hires every candidate with skill ≥ 4 while payroll is under 1.8 × standard (over-hires). It lets the most expensive staff member go whenever spendable cash dips under $4,000 (under-hires in a crunch), and buys build materials only when the builders are idle.
- **Autopilot** (an absent analyst) fills an empty standard role with the best candidate of skill ≥ 2 (pilots: ≥ 3). It buys the next build unit's materials within the autopilot cap and never lets anyone go.

## 16. Whose move it is

Today `crossMoves` lists the cross-trade moves (a crewmate's report, the part chain), and the crew strip, the waiting and blocking cards, the End-turn check and the pushes all read it. The flow joins the same list, so every surface counts it the same way.

```ts
// src/ui/select.ts (A)
export type CrossMove = { key: string; kind: 'report' | 'chain' | 'flow'; who: Role; waits: Role; text: string; what: string; short: string };
export function flowMove(s: IslandState, a: Alert): { who: Role | null; chip: string; text: string };   // one alert's next move: the inbox chip and the stepper's "next" line
export function flowMoves(s: IslandState): CrossMove[];                                                  // the cross-trade ones, inside crossMoves
export function dueNow(s: IslandState, role: OpsRole): Alert[];                                          // this trade's open alerts due this week with no job signed off
export type DockTarget = { alert: string } | { order: string } | { desk: 'approvals' | 'stock' };
export function dockNext(s: IslandState, role: Role): { label: string; target: DockTarget } | null;      // the Dock's primary button
export function endTurnChecks(s: IslandState, role: Role): { text: string; urgent: boolean; standing?: boolean }[];   // the End-turn confirm
export function revenueMoves(s: IslandState, role: Role): { order: Order; label: string; cost: string }[];            // the week's revenue work (a load sheet, a GPU start): Your move and the Dock
export function chainStepOrder(s: IslandState): { order: string; who: Role; label: string } | null;                 // the part chain's step a tap opens ('Open the logbooks ▸', 'Open the IPC ▸', 'Meter the circuit ▸')
export function chainTag(s: IslandState, c: PartChain): string;                                                       // "Cargo C-7 is AOG" / "flies on its MEL placard to wk 9" / "flies meanwhile"
export function openTarget(t: DockTarget): void;   // window.dispatchEvent(new CustomEvent('ic:open', { detail: t })): B's ops panel and C's desk listen
```

`flowMove` by stage (2.4):

| Stage | who | Chip | Text |
| --- | --- | --- | --- |
| `new` | the trade | *Your move* (due now: *Due now*) | "find the fix for the soft brake pedal on Twin N-12" |
| `bench` | electrician | *Ana: meter it* | "meter com 1 on Twin N-12" |
| `approval` | analyst | *Cy: approve* | "approve Tire and tube on Twin N-12 ($660)" |
| `parts`, an approved job's requisitions open | analyst | *Cy: buy* | "buy 2 lines for Tire and tube ($370)" |
| `parts`, all ordered | nobody | *Parts wk 9* · *Held: paperwork* · *Tool on order* | "the tube comes week 9 (next flight)" |
| `parts`, stopped | the trade | *Repick* | "repick the linings: they don't fit" |
| `research` | the chain's mover | the chain's chip (the viewer's own: *Your move: logbooks*) | the chain's text; a tap opens the chain's step (the logbooks, the IPC, the circuit check) from the job, the chain banner, the Dock and Your move |
| `ready` | the trade | *Ready* | "do Tire and tube on Twin N-12" |
| `done` / `closed` | nobody | *Done* / *Closed* | |

`flowMoves` (only when both seats are held, as today):
- a pending flow card not deferred this week (who: analyst, waits: the trade, key `flow:card:{order}`);
- a standalone requisition or an approved job's new shortfall, not deferred this week (analyst, the requester, `flow:req:{id}`). A pending card's shortfall is on the card, never counted twice;
- a bench check asked (electrician, mechanic, `flow:bench:{alert}`);
- a ready job whose alert grounds a plane or closes a house (the trade, the analyst, `flow:aog:{order}`: *"Twin N-12 is AOG (its guests on the sub-charter): do the brake bleed"*).

- **Crew strip and cards** (`blocks`): a seat that hasn't ended its turn reads *"you wait on Ben"* in a neutral tone; *waiting on you* and a seat that has ended stay rust (fix round 1: "blocking you" in red before a friend had played read as blame). Flow moves are counted per pair of seats in one line, *"2 cards and 1 requisition waiting ($1,240)"* (it replaces today's *"N approvals waiting"*). A move for a grounded plane or a closed house gets its own line. The line about kits stuck on a grounded cargo plane becomes *"cargo plane grounded: 2 POs waiting for a flight"*.
- **Pushes** (`pushes`):
  - A new card or requisition goes to the analyst: *"Seb sent Tire and tube on Twin N-12: $660 (parts $370, labour $290)."* If the analyst has already ended the turn, the push adds *"It goes through tonight on your standing approval unless you defer it."*
  - A bench ask goes to the electrician; a nudge goes to the trade: *"Cy: Twin N-12's main tire is due week 9. Plan it so the parts come in time."*
  - The week-resolved push adds *"Parts in: Tire and tube (Seb)."* and *"Due now: soft brake pedal on Twin N-12 (fix it or placard it this week)."*
  - A stop pushes nothing: the tech sees it at the start.
- **The Dock** (A, `home.tsx`, from `dockNext`). The tech's primary button opens JobFlow on the first *Your move* row, due now first (*"Next: soft brake pedal · Twin N-12 ▸"*); a ready job opens its start, as today, and a job the per-turn cap would refuse is skipped. A research step opens the chain's step (*"Open the logbooks · Cargo C-7 ▸"*). The week's revenue work (the charter load sheet, a ground power start) shows first when the top row isn't due this week, in Your move too (*"This week"*), with what skipping it costs. The analyst's reads *"Review 2 cards · 1 requisition ▸"* and opens the desk's Approvals (fix round 1).
- **End-turn check** (today's confirm, from `endTurnChecks`):
  - A tech gets every unplanned alert (*"Plan it now so the parts come in time: main tire worn on Twin N-12 (due wk 9)."*), and every due-now alert with no sign-off: *"Fix it or placard it this week, or Twin N-12 is AOG."* (the only guest plane: *"… or Twin N-12 is grounded and a mainland sub-charter flies the guests (about $540 a week)."*); a hazard: *"Make it safe or fix it, or Cottage 2 stays closed."*. Planning alone doesn't save the plane: `alertAog` counts planned alerts too. Today's ready jobs, owed cross-trade moves and carts stay in the list.
  - The analyst gets: *"2 cards and 1 requisition wait on you (Seb, Ana). After you end your turn, anything that comes in goes through tonight up to your standing limit ($1,000); the rest waits for next week."* When a tech hasn't played yet: *"Ana and Ben haven't played yet: a card over $1,000 that isn't safety work due this week or next will wait a week. Raise the limit …"*, with a one-tap *"Raise the standing limit to $2,000"* on Home.
  - A tech's revenue work: *"No load sheet: half of Twin N-12's charters stay on the ramp."* The MEL lines say what the MEL still allows (10).
- **The chain's words** (`chainTag`): a chain's plane is *AOG* only when it is grounded (an airworthiness item due now, not placarded); otherwise it *flies on its MEL placard to wk N* or *flies meanwhile*. The pushes, the banner, the crew strip and the desk's chip read it (fix round 1: "Cargo C-7 AOG" on a job not due for two weeks was false).
- **Where it shows**: the inbox chips and the stepper (B), the approval cards (C), the Home crew strip (unchanged code reading `blocks`), the Dock and the End-turn check (A), the pushes.

## 17. Screens (phone first: 390 × 844; desktop 1280 × 820)

### 17.1 Shared rules

- Targets are 44 px; one thumb. Sheets rise from the bottom on a phone and open as a 480 px right-hand panel on a desktop.
- Search inputs debounce 80 ms, render at most 20 rows, and never hide the results behind the keyboard (the list scrolls above it). No index is built on a keystroke (6.6).
- A job-flow draft (`{ step, task, pick, query }`) lives in `sessionStorage` under `jf:{islandId}:{alertId}`, every access in try/catch; closing the sheet keeps it.
- Each package styles its own components in its own file (`src/ui/flow/flow.css`, `src/ui/purchasing/purchasing.css`, `src/ui/staff/staff.css`), imported by the component. Only A edits `src/styles.css` (a shared token, if any) and `src/ui/kit.tsx`. A adds the icons all packages need to `kit.tsx` up front (squawk, trend, wear, calendar, guest, meter, take-off, box, truck, boat, tag, placard, hard hat, people, bin).
- Words: the trade's own (IPC, AMM, EFF, SUPSD, INTCHG, NP, 8130-3, MEL, INOP; breaker, GFCI, AFCI, DF, TR, WR, AWG, NM-B, THWN-2, EGC, box fill); money in the analyst's (PO, committed, payable, spendable, ROP, lead time, carrying cost, capex, fill rate, bins).

### 17.2 Technicians (B: `src/ui/flow/`, `ops.tsx`, `orders.tsx`, `manual.tsx`, `chain.tsx`, `puzzlehost.tsx`, `week0.tsx`)

**Your move comes first.** A mounts B's `YourMove` (the inbox's *Your move* group) at the top of Home's main column for the techs, above the waiting cards, the story card, the chain banner and the crew project. On a phone it sits right under the crew strip's numbers, not several screens down.

**The ops panel.** The asset list folds into one chip row (*AOG 1 · MEL 1 · sub-charter 2 × $270 · SAFE 1 · closed 1*; a tap expands it to today's list). Then the ground power card, and the rest of the inbox (`AlertInbox`):
1. *Waiting*: approval, parts, bench, research, each with its chip saying on whom or until when.
2. *Other work*: today's order cards for load sheets, ground power starts, reports, redos, legacy orders and the crew project.
3. *Closed this week* (collapsed).

The *Your move* rows: new alerts, ready jobs, stopped jobs; due now first, then hazards and airworthiness, then by due week. A row (56 px or more): the source icon; the symptom on one line (ellipsis); under it the asset, the due chip (*due now* in rust, *due wk 9*), the flags (*MEL C to wk 9*, *SAFE*, *AOG*, *sub-charter*, *SHUT*); on the right the whose-move chip (16). The Stock chip (*"Stock: 2 low"*) opens this trade's stock read-only with **Request** per item.

**The job-flow sheet** (`JobFlow`): header (asset and registration or house; the symptom; due; flags) and a five-dot stepper, *Investigate · Manual · Parts · Stock · Send* (electrician: *Investigate · Reference · Materials · Stock · Send*). Steps that don't apply are skipped:
- repairs open at Stock;
- a prefilled task with **no main slots** (100-hour and phase inspections, code prep) skips the flow: the row's button is **Start**. The bench lines are reserved at Start; a shortfall shows the stop sheet (*"3 qt of 20W-50 short: request it"*);
- take-offs open at Materials with the task filled in and the site on top;
- other prefilled alerts (ADs, write-ups) open at the Manual step with the task filled in;
- a task with no main slots goes from the Manual to Stock.

- **Investigate**: the finding at the alert's tier; the site for the electrician (room, breaker, AWG, run, what protection a replacement needs at tiers ≤ 2); for a plane its data-plate line (and *Altered: STC …* where an alteration touches the task's ATA). Then the decisions:
  - **Make safe** (breaker off and tag, or blank-off; hazards only, first, in rust). At tiers ≤ 2, when the finding is a service neutral, its sheet says a branch breaker won't isolate it.
  - **MEL C: placard INOP** (where allowed; the sheet says it runs to this week's resolve, extendable once by the analyst).
  - **Ask {elec} to meter it** (bench alerts).
  - **No fault found · close** (with a confirm: *"If it comes back, it's due at once."*).
  - The primary: **Find the task ▸** / **Find the procedure ▸**.
- **Manual / Reference**: the `SearchBar`: input, keyword chips (tiers 0–2), chapter chips, results (number and title, a sub line with the models; tiers 0–1 mark the hint tasks *likely*). A tap opens the card preview: today's `TaskCard` for AMM keys, new cards included; `RefCard` for a reference entry, with its summary, its NEC articles and, at tiers 0–2, the answer for this site. Then **Use this task ▸**.
- **Parts / Materials**: one row per main slot (*"Tire × 1 · pick from the IPC"*; optional slots marked *if needed*).
  - A tap opens that slot's search. For the IPC: the slot's figure, rows in print order with EFF, UPA, SUPSD BY (with its INTCHG code), NP and ALT as printed, and the badges of 6.4. For the catalog: the slot's category, with each item's spec line. A tap on a row fills the slot and comes back.
  - The electrician's **protection** slot shows at every tier (highlighted at tiers 0–2 when the room needs it).
  - A **take-off** slot (the spa's wire) picks the size of the three conductors and the EGC, and shows the feet: *"3 × #6 THWN-2 (L1, L2, N) + 1 × #10 EGC, 61 ft each"*.
  - A rare job shows its pre-filled line, with nothing to search.
  - **Not in the IPC · research the records** sits under every IPC slot at every tier (the player decides).
  - **Add a line** adds an extra item (10 lines at most).
  - At tier 3+, a *Recent on this airplane* chip row shows the last 5 **tasks** done on it (not P/Ns: the IPC stays the lookup).
- **Stock**: every line, the picks and the task's own bench lines (marked *card*), with its badge:
  - parts: *4 on hand* with a check mark (palm), *2 on hand · need 4* (amber; the rest goes on the card), *0 · on order wk 9* (sea), *none* (rust; goes on the card);
  - tools: *owned*, *not owned: goes on the card (capex $620)*.
  - Tiers 0–1 show the `pickCheck` warnings on top (*"Check: 066-19600 is only for POST SB brakes; this airplane is PRE SB."*).
  - The shelf holds near-miss stock, so *on hand* isn't a verdict on the pick.
  - The summary and the primary **Send ▸** (`plan`): *"All on hand: ready now on your work budget (labour $290, $240 of $500 used)"*, or *"Pull 3 · buy 1 · labour $290: a card for Cy"*.
- **After Send**, the sheet's banner says what happened (no toast: it covered the sheet's title and said the same thing; fix round 1):
  - *"Ready: start it now"*;
  - *"Card sent to Cy: $660"*, and before Send the Stock step already says whether it will go through tonight on the standing approval (8.5);
  - *"Requested 1 line: Cy's move"*.
- **An empty required slot** (a GFCI job with no GFCI device picked): Materials isn't ticked, the Stock step names it (*"Pick the GFCI device first: this job needs a GFCI device, and none is picked."*) with a **Pick the GFCI device ▸** button back to the slot, and Send refuses (fix round 1).
- **The site line** reads the breaker and the wire for a repair on an existing circuit, where reading them is the job. A take-off (a new circuit: the spa, the fuel dock pump, the transfer switch) shows the equipment and the run, never the conductors, which are the take-off's answer: *"Spa: 240 V, needs a 60 A GFCI disconnect · pad 43 ft from the panel"*, *"Fuel dock pump: 240 V, 30 A · 85 ft underground from the panel"*, *"Transfer switch: 60 A today · the houses back up 110 A"* (fix round 1). A heater cause's site is the heater's own circuit (*"Water heater · 30 A 2-pole, 10 AWG"*), and the make-safe button names the breaker it tags.
- **The job's puzzle is the alert's site** (`PuzzleContext.site`, from `puzzleSite` in `launchFor`): the trace names the alert's room and breaker, a receptacle on an individual circuit is one outlet, a warm plate or plug is an IR-thermometer hunt among live devices, and a flicker is the meter's loose-neutral case under load (fix round 1: the puzzle used to be a random dead run anywhere).
- **Stores** (the techs' view) shows on hand and on order, never the analyst's min/max, which would point at the effective P/N beside a near-miss (fix round 1).

**Order detail** for a flow job (`orders.tsx`): the task; each line's state (reserved, on order with its ETA, held with the document named, sent back); the POs; the stop with **Repick ▸**; **Drop the job** (confirm). **Start** on a ready flow job runs `installCheck` first (8.7) and shows the stop sheet or launches the puzzle.

**The puzzles** label what the tech chose from `context.pick` (display only; scoring unchanged):
- `wireup`: the device.
- `conduit`: the stick size, connectors and wire, only when the pick is EMT. The bender's take-up follows the stick: 1/2 in: 5 in, 3/4 in: 6 in (the spa). `TAKE_UP` becomes `takeUp(size)`, and `tests/conduit.test.ts` covers both sizes.
- `panel`: the panelboard.
- `meter` gets two `PLACES` entries (data): `heater` (the bath, the hall, the heater closet's junction box, the water heater) and `bond` (the panel's ground bar, the water entrance, the heater's piping).

**Tap counts for a known answer** (a tap is one touch; nothing needs typing):

| Case | Taps | Per search step |
| --- | --- | --- |
| Mechanic, tier 1, *L/H brake pedal soft* (the fix: bleed) | row (1) → Find the task (2) → 32-42-01, marked *likely* (3) → Use this task (4) → no slots, so Stock: 2 qt of MIL-PRF-5606 on hand → Send (5): ready → Start (6) | Manual: 2 |
| Mechanic, tier 3, *tire at 2/32* on Cargo C-7 | row (1) → Find the task (2) → chip *32 Landing gear* (3) → 32-40-01 (4) → Use (5) → slot Tire (6) → the row (7) → slot Tube (8) → its row (9) → Send (10) | Manual: 3; each part: 2 |
| Mechanic, *100-hour inspection due* | row's Start (1) | — |
| Electrician, tier 1, *bathroom outlet trips with the hair dryer* (the fix: GFCI) | row (1) → Find the procedure (2) → R-GFCI, marked (3) → Use (4) → slot GFCI device (5) → KG20-TR, badge *this circuit: 20 A, TR* (6) → Send (7) | Reference: 2; device: 2 |
| Electrician, tier 2, *bedroom outlets dead* (the fix: a new receptacle with AFCI protection) | row (1) → Find the procedure (2) → R-OUT (3) → Use (4) → slot Receptacle (5) → KA15-TR (6) → Send (7); the protection slot stays empty: the AFCI receptacle protects itself | Reference: 2; device: 2 |
| Electrician, *tingle at the shower valve* (hazard) | row (1) → Make safe · breaker (2), then as above | |
| Mechanic, MEL a dead com on the twin | row (1) → MEL C (2) | |

### 17.3 The analyst (C: `src/ui/purchasing/`, `desk.tsx`, `board.tsx`, `src/puzzles/auction.ts`, `src/puzzles/invoice.ts`)

**The desk.** The cash card stays on top, now with *spendable* beside cash. Under it a segmented control: **Approvals · Stock · Money · Staff**, with a count on Approvals (cards and requisitions waiting), a dot on Stock (urgent flags and needs due within a week) and a count on Staff (open roles below the standard crew). It opens on Approvals when something waits, else on Stock.

**Approvals stay live after End turn.** Today's desk locks non-chain cards once the analyst has ended the turn (`desk.tsx`: `locked = disabled && !top?.chain`). C removes that lock for flow cards and requisitions (the engine never refused them). A card that came in after the turn ended is marked *"came after you ended: goes through tonight on the standing approval unless you defer it"*.

**Approvals**: flow cards, then requisitions, then legacy cards (today's), then desk work (today's list).
- `ApprovalCard`:
  - The header: the job title, asset, the trade's avatar and *for Seb*; the symptom (one line) and the task (*"32-40-01 Main wheel, tire and tube"*).
  - The lines: *From stock: 3 lines, $86*, *To buy: 1 × OG-65010-8 TIRE, $285 · OEM · next flight, here tonight*, *Labour $290*; then the total.
  - Chips: *AOG*, *Sub-charter ~$540/wk* (before it happens: *From wk 9: sub-charter ~$540/wk*), *house closed*, *due now*, *MEL to wk 9*, *waiting a week costs about $1,120* (`expectedDeferralCost`, counting a grounded plane's downtime or a closed house's rent), and the trade's work budget.
  - Swipe right to approve, left to defer (today's gesture), or the buttons. There's **no counter gesture on flow cards**.
  - A tap expands it: per line the supplier (*OEM* | *Broker −20%, +1 week, 1 in 4 held for traceability*), and the freight with what it does to the asset (*"Scheduled: here wk 9 · N-12 AOG wk 8 (~$3,100 of guests)"* | *"AOG boat +$350: here wk 8"*). The total follows `cardOf(s, o, buy)`.
- `ReqQueue`: standalone requests and approved jobs' new shortfalls: *"Seb asks for 1 × T-N2 nitrogen charging kit ($480, a tool: capex) · 'the accumulator job needs it'"*. **Defer** / **Approve**; select several for **Approve 3 ($890)** (`approveReq`, one PO per supplier and carrier).

**Stock** (`StockPlanner`):
- the flags strip (urgent first), each with its one-tap action (**Approve Seb's request**, **Order 2**, **Stop**, **Free a bin**);
- **Needs** (collapsible): the open alerts nobody has planned, by due week, with no P/N (*"Twin N-12: main tire worn, due wk 9 · Seb hasn't planned it"*) and a **Nudge** each; the planned jobs waiting, with their lines;
- filter chips *All · Flags · Fast · Steady · Slow · Dead · Parts · Consumables · Mech · Elec · Build · Tools* and a filter input over the supply index (A's `search()`);
- a row per family, expandable to its items: the family's name; *"4 on hand · 2 free · 1 on order wk 9"*; a 26-week bar of use; its class and *last used N weeks ago*; for an item, its ROP/max and bin;
- `ItemSheet`: the family's 26-week chart, the suggestion with **Use 1 / 2**, ROP/max steppers (`setStock`), **Buy** (packs, or feet for cut items; supplier; freight; `buy`), **Scrap**;
- *Receiving* at the bottom: held POs (*"po14: the exchange alternator waits for its 8130-3, released next week"*), open POs with ETA and carrier, and payables due at the next resolve.

**Money**: the cards of 14.3; the work budgets per trade (`setBudget`) and the standing limit (`setStanding`), each with one line saying what it does; pricing (today's); insurance (today's). The parts-kit block and `buyList` are gone.

**Staff**: `StaffDesk` (D), in the tab C draws.

**The week's review** (`board.tsx`): the costs block adds payroll, overhead, carrying, freight, labour and parts when present.

**The auction** (A's `auctionLot`; C's `auction.ts`): the task comes at most every 2 weeks, when a lot exists. A lot is 2–4 lines of items the island uses (by family velocity or known demand) that are under their max or not stocked, sold as *new surplus with traceability from a broker's liquidation*. `fair` = the lot at the broker's price × 0.85; `low` = 0.6 × fair; `high` = 1.3 × fair; `cap` = min(0.92 × the lot at OEM price, spendable − $2,000). The puzzle's intro card lists the lot (`context.lot`); its result keeps today's shape (`kits` 1 or 0, `spent`): a win places a PO (`vendor: 'broker'`, scheduled, `cost = spent`, each line at its share).

**The invoice match** (A's `invoiceContext`; C's `invoice.ts`): the POs received at the last resolve, not yet paid: the three-way match uses their real lines (P/N, nomenclature, PO quantity and price, received quantity), vendor and freight. The discrepancy is seeded as today, and what the match finds is withheld from this week's payment run (9.7). With no such PO, today's generated card.

**Tap counts**:

| Case | Taps |
| --- | --- |
| Approve a card as the tech sent it | swipe (1) |
| Approve it on the AOG boat | card (1) → AOG boat (2) → Approve (3) |
| Act on an urgent flag (a job waits on a tire) | Stock (1) → **Approve Seb's request** on the flag (2) |
| Nudge a tech about an unplanned alert | Stock (1) → **Nudge** (2) |
| Take the suggested min/max | Stock (1) → the row (2) → **Use 1 / 2** (3) |
| Hire | Staff (1) → **Hire** (2) → confirm (3) |

### 17.4 NPC staff (D)

15.10 and 15.11.

### 17.5 Learning the new flow (A, B, C)

Live islands meet the flow mid-game, and the founding players have no grace period left.
- **Two teaching weeks** (A). `migrate()` stores `flowSince` = the migration week (new islands: 1). For the first 2 weeks from it, and during any player's grace, `alertTier` is 1: the likely task is marked and `pickCheck` warns.
- **What's new** (B for the techs, C for the analyst): a one-time sheet of 3 panels per seat on the first open after the update. Techs: alert → manual and IPC → stock and the card. The analyst: approvals → stock and needs → money and staff. It's remembered per island and seat in `localStorage` (a per-viewer convenience, every access in try/catch).
- **Week 0** (B, `week0.tsx`): a tech's week 0 replaces one practice puzzle with one scripted alert taken through Investigate → Manual → Parts → Stock → Send. It's a local walk-through on derived data with no engine writes: a worn twin tire for the mechanic, a tripping bathroom GFCI for the electrician. The analyst's second step is the desk's intro: the mechanic's plan for that tire as the real approval card, on a copy of the island (the tube from stock, the tire to buy, the labour, the freight), approved or deferred there, then what the four desk tabs hold (fix round 1: a new island's analyst saw the legacy practice card and no intro; What's new is for islands that played before the flow).

## 18. Bots and autopilot

### 18.1 Technician bots (A, `bots.ts`)

They call the same reducer as a phone. They don't run the search: a hit rate stands for it.

```ts
const hit = (skill: number, alertTier: number) => clamp(0.55 + 0.45 * skill - 0.08 * Math.max(0, alertTier - 2), 0.3, 0.97);
```

- **First, the calls.** A hazard is made safe when its fix needs a line not on hand. On a service-neutral cause the bot leaves the house closed with `hit`; else it makes it safe at the branch breaker. An MEL C item is placarded when its fix needs a part not on hand, or while it waits on the electrician's check (fix round 1: a com radio's wiring fault on the only guest plane kept it restricted for weeks while the check came round; since 2026-09-28 it would sit grounded on the sub-charter). A placard running out with the fix not ready: the mechanic asks for the one extension and the fin bot approves it. A bench alert gets the electrician's check when that seat is a bot that isn't absent; otherwise the bot reads the finding right with `hit`.
- **Then it plans every open alert of its trade at once** (due first). A bot plans early, so parts come in time. With `hit` the task is one of `fixesOf`, else a sibling task in the same chapter. An NFF alert is closed NFF with `hit`, else its most common cause's task is planned. A real fault is wrongly closed NFF only when its finding hides it (`looksNff`, tier 3+), with (1 − hit) × `BOT_MISS.looksNff` (the engine refuses an NFF close over a finding that shows the fault). Each slot the cause needs gets the `stdPick` line with `hit`, else a near-miss from the slot's own rows (the other S/N block, the code-3 P/N without its set, the other amperage or protection).
- A stopped job is repicked with `stdPick` on the next turn.
- Then ready jobs are played as today (per-turn limits, carts, reports first).
- **Speed**: bots never build a search index, and `stockFlags` and velocity are computed once per turn. A 26-week sim stays at or under 0.5 s (about 0.2 s today, measured), so the robust sweep stays around 6 minutes.

### 18.2 The fin bot (A; staff through D's `botStaff`)

- **Cards**: today's rule (approve when the expected cost of waiting is at least 0.6 × the card or it is critical, keeping the reserve), with the default freight (8.6). The broker only for consumables, when spendable − cost is under the reserve.
- **Requisitions**: approved when spendable − cost ≥ the reserve, or at once for a job whose alert grounds a plane (the only guest plane too) or closes a house; a tool a job needs, always.
- **Needs**: nudges every unplanned airworthiness or hazard need due within a week.
- **Reorder policy**, once per turn:
  - The `order` flags are worked urgent first, each through its one-tap action; stock buys go up to the suggestion (whole packs, scheduled, within the bins).
  - Once a family has 3 or more uses in the ledger, its items' ROP/max are set to `suggestRop` when that differs by 2 units or more (at most 6 a turn).
  - Insurance spares are kept at one job's worth. Dead stock worth $100 or more that isn't an insurance spare and has no known demand is scrapped.
  - The open build's next two units are bought.
- **Settings**: the work budgets and the standing limit stay at their defaults.
- **The naive analyst**: approves everything; never sets a min/max (only the starter stock replenishes); buys 3 random items of its trades each week while spendable is over $8,000, bins permitting (dead stock, full bins); never nudges; staff as 15.12.
- Desk tasks as today; the auction bids on its lot.

### 18.3 Autopilot for a missed seat (engine, resolve step 1)

- **A technician**:
  - makes hazards safe (breaker; on a service-neutral cause it leaves the house closed: autopilot keeps to the manual);
  - placards MEL items whose fix needs a part not in stock or that wait on the electrician's check, and asks for the one extension when a placard runs out with the fix not ready;
  - plans the alerts due now or next week that ground a plane (the only guest plane too) or close a house, with the right task (`fixesOf`) and `stdPick` (autopilot keeps to the manual: no hidden defects, as today);
  - plays up to 2 ready jobs at 50% (today). No NFF closes.
- **The analyst**: today's rule (up to 2 cards above the $4,000 floor; a job whose alert grounds a plane (the only guest plane too) or closes a house whenever spendable covers it, with the default freight). Plus requisitions and urgent stock flags within `STOCK.autopilotCap` ($800 a week), and `autoStaff` (15.12). Replenishment runs whoever plays (it is the analyst's standing policy, 9.5).
- The standing approvals (8.5) run after autopilot, and only when the analyst ended the turn.

## 19. Migration and the version gate (A)

### 19.1 Versions

- `ENGINE_VERSION` 3 (`engine.ts`), `DOC_VERSION` 3 (`src/net/firebase.ts`), and `firestore.rules` accepts only `request.resource.data.v == 3`. The rules and the hosting build deploy together, as for v2 (*Deploy log* in DECISIONS.md, *Phase B review fixes*). An old tab's writes are refused with permission-denied and it reloads (today's code); `apply()` still refuses a doc saved by a newer engine.
- A v1 or v2 doc is read by the new build and migrated in memory; its first write stores it as v3.

### 19.2 `migrate(s)` (`src/sim/migrate.ts`)

Pure and deterministic (its random stream is `hashSeed(s.seed, 'migrate')`), idempotent field by field (each step runs only while its field is absent), and cheap. It runs at the top of `apply()` right after the newer-engine refusal (before `healChain`), in `useIsland`'s read path (`migrate(structuredClone(doc))`, display only, so a doc nobody has written since the deploy renders on the new screens), and in the tests.

1. **Stock.** `inv` = the starter stock for the island's tier, near-miss lines included (19.3). `credit` = (`parts.stock` + `parts.inTransit`) × `kitValue(tier)`: store credit at the vendors. `parts` = `{ stock: 0, inTransit: 0 }` (the field stays for old readers).
2. **Orders. No legacy order can wait on kits after this step.**
   - An approved order waiting on kits (`waiting_part`, `parts > 0`, no chain), **repairs included**, becomes a flow job with the same id. Its task is the kind's default task for the asset (a repair: `repairTask` with its defect's job), with `stdPick` and the bench lines, and it gets a linked alert (`src: 'finding'`, `status: 'job'`, the kind, `sym: 'W_{kind}'` or the repair's). What the starter stock covers is reserved. The rest goes on an **automatic PO**: default supplier, scheduled, `by: 'auto'`, paid from the credit, `eta` = this week. So it lands at this week's resolve, when the kit in transit would have. Nobody re-approves a job that was already approved and paid.
   - A `pending` or `countered` order with `parts > 0`, repairs included, becomes a pending flow card the same way, re-priced (labour 8.3, plus what has to be bought). A countered one loses its counter.
   - Every other open order keeps its status with `parts = 0` (its kit was consumed at approval or is in the credit): ready jobs, pending jobs without parts, load sheets, ground power starts, reports, redos, crew projects, desk tasks. A **legacy order** (no `flow`) approves, plays and signs off exactly as today and draws nothing from stock.
3. **Part chains.** Unchanged: no `flow` flag, so an open chain grounds its plane as today; its cards, freight, receiving and self-heal work as today.
4. **Alerts.** `alerts = []`. The next week open raises alerts; the legacy orders count as open work in its slots, so there is no flood.
5. **Staff and builds.** `migrateStaff` (15.8).
6. **Ledger.** Backfilled from `history` (14.5).
7. `flowSince = week` (17.5); `pos` = the automatic POs; `reqs`, `eas` = `[]`; `engine = 3`.

The `surplus:buy` story changes in the engine (not in the migration): *"Tradewind Surplus offers a lot of your shop's own consumables at 40% off"*: $600 buys a broker PO (scheduled) of the island's consumables worth about $1,000 at list.

A mid-week doc keeps its turns: a seat that hasn't played this week sees its legacy orders and any converted jobs; alerts start with the next week.

**Guarantees** (tested, 21.1): cash unchanged; `credit` = kits × kit value, less what the automatic POs drew; no order lost (every open order is still open, or converted with the same id); no open order has `parts > 0`; open chains run to the end; a second `migrate` changes nothing; the doc stays under the size budget.

### 19.3 Starter stock (`STARTER` in `data.ts`; new and migrated islands)

A new island gets the tier-1 lines at `createIsland`; a migrated island gets the lines up to its tier. Plane lines resolve to the effective P/N for that airplane (its `stdPick`), so each shelf fits its own planes. **Beside each plane line whose book prints a near-miss, a few units of the near-miss**, left by the previous operator. So "on hand" never tells a tech he picked right, and the analyst has honest slow stock to judge. Quantities in units; *ROP / max* where replenishment should keep the line up.

| Tier | Lines: on hand · ROP / max |
| --- | --- |
| 1: the twin, two cottages, the grid | **Twin**: 20W-50 24 qt · 12/36; oil filter BAE-48119 2 · 2/4; crush gaskets AN900-10 25 · 5/25; spark plug gaskets FH-G18 50 · 24/50; safety wire .032 25 uses · 5/25; cotter pins MS24665-302 100 · 10/100; O-rings MS28775-227 10 · 2/10; wheel bearing grease 10 · 2/10; MIL-PRF-5606 12 qt · 4/12; brake linings (the effective P/N) 4 · 0/4; lining rivets 50 · 16/50; a main tire and a tube 1 each. **Near-miss**: 4 linings of the other SB state's P/N; a case of straight SAE 50; a spool of .041 safety wire. **Electrician**: KR15-TR 10 · 4/10; KR20-TR 10 · 4/10; KA15-TR 2 · 1/3; KG20-TR 2 · 1/4; KG15-TR 1; KDF20-TR 1 · 1/2; KP115 4 · 2/6; KP120 4 · 2/6; KP120AF 1; NMB-14-2 1 roll; NMB-12-2 1 roll; twist-on connectors 15 · 5/15; BOX-OW1 25 · 5/25; WP-INUSE 2; PLATE-BLANK 10; LABELS 10. **Near-miss**: a box of KR15 (not TR); 2 WP-FLIP covers. **Tools**: T-TW-IN, T-TW-FT, T-DIFF, T-CLAMP, T-TORQUE. |
| 2 adds: the cargo plane | its tire and tube 1 each; filter housing packing set 2 · 1/2; chip detector packing 2 · 1/2; near-miss: a box of MS24665-283 cotter pins |
| 3 adds: the generator | its oil filter and fuel filter 1 each; a case of 15W-40; a case of coolant |
| 4 adds: the float and the villas | the float's oil filter BAE-48112 2 · 1/2 (the twin's BAE-48119 already sits beside it); its linings (the effective P/N) 4 · 0/4; its tire and tube 1 each; KG20-TRWR 2; KDF20-TR +1 |

At list prices that is about $2,450 of stock (the near-miss lines included, 34 of the 40 tier-1 bins) and $1,070 of tools on a new island; today it starts with 3 kits, about $1,020.

### 19.4 Fixtures (written by the base engine, never by hand)

- Make a worktree of `6c0c426` in the scratchpad (`git worktree add <scratch>/base-6c0c426 6c0c426`, `node_modules` symlinked), copy `scripts/fixtures-v2.ts` into it and run it there with `npx tsx`: it plays the base engine's own bots and writes the docs below. Commit the script and the eight files to `tests/fixtures/`; list the seed and week chosen for each at the top of `tests/migrate.test.ts`.

| File | The doc |
| --- | --- |
| `v2-6c0c426-early.json` | tier 1, start of week 4, 3 kits in stock |
| `v2-6c0c426-kits.json` | mid-week, kits in transit, 2 or more orders `waiting_part` on kits |
| `v2-6c0c426-countered.json` | a countered order that carries a kit |
| `v2-6c0c426-repair.json` | a pending repair with parts (a `DEFECT_RULES` fix with `parts: 1`) |
| `v2-6c0c426-chain-transit.json` | an open chain with its part in transit (the plane AOG) |
| `v2-6c0c426-chain-review.json` | an open chain waiting on engineering's answer |
| `v2-6c0c426-midweek.json` | tier 3: the mechanic ended the turn, the electrician part way, the analyst not started, cards pending |
| `v2-6c0c426-late.json` | tier 4 or 5, week 20 or later, storm season |

- The script searches seeds and weeks for each state (the base bots with `TEAMS['three friends']`), so it needs no changes to the base code.
- The existing `live-79f806b-*` and `skew-79f806b-*` fixtures go through the same migration and keep passing.

## 20. Balance plan

### 20.1 Targets

- Three friends and all average: tier 5 at a median of week 21–23, and **0 weeks below $0**, in the standard run (26 weeks × 30 seeds). Unchanged.
- Solo and absent teams stay at tier 1. Unchanged.
- The pacing guard stays (`tests/engine.test.ts`: three friends reach tier 5 by week 26 in at least 75% of seeds 1–30).
- **Latency**: weeks from an alert to its sign-off, three friends: today's order-to-sign-off plus at most 0.25 week. This is the gridlock test in numbers.
- The robust sweep (`npm run balance -- robust`) is reported with the change (median week to tier 5, misses, weeks below $0, minimum cash, latency, AOG weeks) beside the Phase B table in DECISIONS.md.

### 20.2 Where the money moves, and the neutral point

| Change | Neutral point | Effect |
| --- | --- | --- |
| Labour + standard parts per job | today's card (8.3), checked 0.96–1.16 | neutral |
| The `costBy` models: the twin's 100-hour ×1.6 and oil change ×1.8, the cargo plane's starter-generator ×1.3 | — | about −$1,400 a game (a twin and a turbine cost more to keep) |
| Alert volume | today's order volume ±10% (5.1) | neutral |
| No-fault-found alerts | mechanic 0.125, electrician 0.25 extra a week, outside the slots | a little more work; a wrong plan wastes parts |
| Starter stock | about $2,450 of stock and $1,070 of tools vs 3 kits (about $1,020) | positive (value given, not cash) |
| Carrying charge | 0.1% a week of stock value ($3–12 a week) | negligible |
| Payables net 7 | the same outflows, a week later | neutral (timing) |
| Tools bought | about $2,100 over a game if every job type comes up (N2 kit, megger, bender, fish tape, knockout set, puller) | negative |
| Builds' materials | about $3,200 over a game at flat prices | negative |
| Freight | the AOG boat when scheduled freight would miss an airworthiness or hazard due week, as today's chain boat | watch |
| Staff | the standard crew's payroll + overhead = today's fixed cost (15.2) | neutral; hard landings take alert slots |
| Returns, scrap, store credit | refunds | neutral |

The real drain is about $6,700 over 26 weeks (`costBy` $1,400, tools $2,100, builds $3,200). Expect it to push tier 5 later by up to a week before tuning.

### 20.3 Knobs (starting values; record the final ones in `docs/DECISIONS.md`, *Real job flow · Balance*)

- Alerts: `ALERTS.nff` (mechanic 0.125, electrician 0.25); `ALERTS.looksNff` 0.3; cause and NFF weights (5.2, 5.3); leads; `ALERTS.againMin`–`againMax` 1–2; `ALERTS.keep` 2.
- Money per job: `kitValue` (340 at tier 1, +10% a tier); `LABOR.min` per task; `costBy`; item prices (3.x).
- Stock: `STOCK.carry` 0.001; `capital` 0.005 (display); `restock` 0.15 (min $40); `returnCredit` 0.75; `autopilotCap` $800; `TierDef.bins`; `STARTER` (19.3).
- Approvals: the work budget default ($500); the standing limit default (the budgets' sum).
- Freight and suppliers: `FREIGHT.aog` $350; `FREIGHT.sched` $35 / $25 / $0 a shipment (mechanic / electrician / building, fix round 1); supplier price multipliers, lead adds and paperwork rates (3.6, 3.7).
- Chain: `CHAIN.flowChance` 0 (flow jobs); `CHAIN.chance` 0.3 (legacy).
- Staff: `STAFF` (15.2); `BUILDS` quantities; `COTTAGE_SHELL`; `TIERS[].overhead`.
- Bots: the `hit` formula (18.1).

### 20.4 What to watch (three friends, standard run)

| Metric | Expected |
| --- | --- |
| Alerts a week | mechanic about 1.6 + 0.125 NFF; electrician about 2.7 + 0.25 NFF (today's orders ±10%) |
| No-fault-found share of alerts | 10–20% |
| Weeks from alert to sign-off | today's order-to-sign-off + 0.25 or less |
| Plane-weeks AOG on alerts per game | today's chain AOG weeks + 2 or less, reported by cause (not stocked, waiting on approval, not planned, carrier) |
| Weeks the mainland sub-charter flies the only guest plane's guests (it's grounded), per game | 2 or less |
| House-weeks closed by a hazard per game | 3 or less |
| Fill rate by value, weeks 8–26 | 45–80% |
| Job-weeks waiting on parts, per week | 1.5 or less |
| Inventory value at week 26 | $4,000–12,000, with 60–95% of the bins used |
| Payroll at week 26 | within ±15% of the standard crew's |
| New tier buildings that started below today's health | none in 90% of games |
| Hidden defects per week | today's + 0.05 or less (the bots' wrong tasks and picks) |
| Minimum cash | $1,500 or more (today $2,273) |
| Paper-sim time | 0.5 s or less per 26-week sim |

### 20.5 `scripts/balance.ts` (A)

- The summary table adds `latency`, `AOG wk` (split stock / approval / plan / carrier), `sub` (was `restricted`: weeks on the mainland sub-charter), `fill%`, `wait/wk`, `inv@26`, `bins@26`, `payroll@26` and `late bld`; the robust sweep adds `latency`, `AOG wk` and `fill%`.
- `detail` adds, per week: alerts raised / planned / NFF-closed, POs placed / received / paid, inventory value, payroll.
- A new mode, `flow` (`npm run balance -- flow [team] [seed]`), prints the first 40 alerts of one game: the symptom, the hidden cause, the bot's task and pick, the verdict (right, wrong task, near-miss, stop) and what came of it, to tune the symptom weights.
- A new variant, `cottages`: the three friends with a fin bot that starts a cottage at tier 4 when spendable is over $40,000, so the optional cottages are tested too.

### 20.6 Tuning order

1. **A, with the staff stubs**: alert volume and the money per job first (5.1, 8.3); then latency and AOG weeks by cause (the gridlock rules); then the week to each tier within ±1 of today for every team, before anything else changes.
2. **Stock**: the starter stock, the bins and the fin bot's policy, for fill rate and waits; then the naive analyst (it should end up with dead stock and full bins, not a collapse).
3. **D**: the standard crew within ±0.5 week of A's numbers; then the naive analyst's over- and under-hiring; then the `cottages` variant.
4. If the three friends' tier 5 slips past week 23 or any week goes below $0: first lower `TIERS[].overhead` by up to $150 a week at tiers 2–5 (it offsets the new capex), then the `BUILDS` quantities, then `kitValue` (lower labour), then tool prices. The lesson recorded in DECISIONS.md (*Balance*) still holds: the margins are thin at tier 4, so every change gets a full run.

## 21. Test plan

Whole-season sim tests keep `vi.setConfig({ testTimeout: 30000 })` (CI runners are about 1.5 × slower).

### 21.1 Package A

- `tests/items.test.ts`: ids unique across `ITEMS` and every model's `planeItems`; every item has a price over 0, a lead of 1 or more, a pack of 1 or more, a family and tags; every electrical item and tool has an NEC or practical basis; every row of fig 79-20 has an item; prices by tag match 3.1.
- `tests/aircraft-golden.test.ts` unchanged. `tests/aircraft2.test.ts`: fig 79-20 pinned for three island seeds; figure numbers unique per model and in ATA order; **each piston model's IPC oil filter P/N appears in that airplane's logbook oil entries**; `findPart` and the logbook puzzle unaffected.
- `tests/tasks.test.ts`: every catalog kind but `wb`, `gpustart`, `report` and `project` has a task for each of its target models; every main slot resolves for each model, both S/N blocks and both SB states; `benchFor` resolves; **the band**: `laborCost` + the standard parts is within 0.85–1.25 × `cardToday` for every task × model × cause × island tier 1–5 × health band, ICA picks exempt (the exempt list printed); every task with a kind has a `LABOR.min`; every task's `tools` exist.
- `tests/alerts.test.ts`: over 30 seeds × 26 weeks, alerts per trade within ±10% of the orders the base engine generated (a table recorded from `6c0c426`); every cause's tasks fit the symptom's models and rooms; NFF share 10–20%; **the only guest plane never gets a no-go wording or a hard landing**; a hazard closes its house until made safe (then × 0.75) or fixed; MEL C limits and the one extension; the bench fault always agrees with its finding; `looksNff` only at tier 3+ on intermittents; NFF comebacks re-raise.
- `tests/search.test.ts`: every task in the top 3 for its title's words; every IPC row first for its exact P/N (with and without dashes) and in the top 5 for its nomenclature; the synonyms (*pads* → linings, *gfi* → GFCI, *romex* → NM-B, *df* → dual-function); for every symptom × cause the tier 0–2 chips put a fixing task in the top 3; `hintsFor` gives no chips at tier 3+; **no tier 0–1 badge, *likely* mark or `pickCheck` text recommends a P/N that `judgePart` rejects for that airplane** (every figure row × airplane of three seeds); deterministic; building an airplane's index under 60 ms and a search under 6 ms on CI.
- `tests/flow.test.ts`:
  - every action's validation and error string (7, the 15.9 stubs), and the week stamps;
  - **the gridlock rules** (0.2 rule 8). A stocked lead-0 airworthiness alert, with the seats playing mechanic-first and analyst-first: not AOG. An unstocked lead-1 alert planned in week W, with the analyst playing before (the standing approval) or after (an approval): the part lands at W's resolve, the job is done in W+1, not AOG. Cards and requisitions stay approvable after the analyst's End turn;
  - the work budget at every tier and safety work past it (8.4);
  - reservations first come, first served; soft reservations taken by a safety plan; `repick` and `dropJob` release;
  - `installCheck` stops (wrong P/N, short quantity, a needed slot empty, a missing tool), and `complete` on a stopped job drops the result;
  - a sign-off consumes, a rework doesn't; `cardOf` totals and the default freight; the statuses (8.2); the changed `squawk`; `counter` refused on flow cards.
- `tests/stock.test.ts`:
  - receiving: the carriers (small lines on any flight, bulk on the cargo plane, building materials on the supply boat), the paperwork by line type, supersession codes 1/2/3, each `judgePart` outcome, a slip, the AOG take-over;
  - the eta rule (a lead-1 line arrives this week's resolve);
  - **inventory position and the allocation**: a hand-built reservation is counted once; a replenishment that lands fills a waiting job's requisition with no second PO;
  - replenishment and the freeze; bins (a buy refused when full, returns over the cap); the carrying charge; commitments, the payment run, net 7 and the match's catch; scrap; store credit;
  - the analytics (families, velocity, classes, insurance spares, `suggestRop`, flags, needs without P/Ns) on hand-built ledgers; `auctionLot` and `invoiceContext`.
- `tests/consequences.test.ts` (extended): a wrong task re-raises through an incident or an inspection; `ipc:noteff`; every electrical variant on a built site; `stdPick` passes the judge for every site the generators make (enumerated over seeds); the NFF comeback; `elec:isolation`.
- `tests/chain.test.ts` (extended): research from `plan` with `research: true`; research queued behind an open chain; a `displaced` part at receiving opens research; an EA record becomes an IPC row and `judgePart` accepts it; a flow chain doesn't ground the plane by itself; no random trigger on flow jobs. The existing chain, bench, chain-GSE and chain-money tests pass unchanged (legacy orders).
- `tests/migrate.test.ts`: for each v2 fixture (19.4): the selectors run; `migrate` is idempotent; cash unchanged and credit as 19.2; no order lost and none with `parts > 0`; the countered kit order becomes a pending card; the pending repair with parts becomes a flow card with its `RPR` line; kits in transit arrive on the automatic PO at this week's resolve; open chains finish; ten weeks of bots give the same doc in memory and through JSON; `engine === 3`; `flowSince` set.
- `tests/skew.test.ts` (extended): the live and skew fixtures migrate and play; the doc and rules versions are 3.
- `tests/docsize.test.ts`: a 52-week three-friends island is under 150 KB of JSON; the ledger holds at most 26 rows; alerts at most 40.
- `tests/engine.test.ts`: the exit tests unchanged (sensible play never ends a week under $0; solo players never leave tier 1; the pacing guard; every tier reachable). Rewritten on alerts or hand-built legacy orders: *approve spends cash and reserves parts* (a flow card), *parts are capped at 6* (becomes the `buy` validation and the bins), *auction result adds parts in transit* (the lot's PO), the squawk test (an alert), the counter-offer test (a hand-built legacy order). `tests/chainmoney.test.ts`: the `downtimeOf` line that used kits in transit uses a bulk PO due that week.
- `tests/staffstub.test.ts`: with the stubs, `costs.fixed` equals today's `TIERS[].fixed` every week, and flights, bookings, charter and new buildings' health are today's.
- `scripts/balance.ts`: a 26-week sim at or under 0.5 s on a developer machine (a timing line in the output, not a test).

### 21.2 Package B

- `tests/flowui.test.ts` (the minidom, like `blind.test.ts`): the pure step model in `src/ui/flow/steps.ts` (which steps an alert shows, including the one-tap Start for prefilled tasks with no slots; the draft reducer; what Send dispatches) and the tap-count table of 17.2 (a known answer takes at most 3 taps per search step at tiers 1 and 3).
- `tests/conduit.test.ts`: the take-up by stick size (1/2 in: 5 in, 3/4 in: 6 in); labels only for an EMT pick.
- In the browser (Playwright scripts in the scratchpad, 390 × 844 and 1280 × 820, screenshots looked at): the mechanic and the electrician each take an alert to a signed-off job through the search; an all-on-hand plan goes straight to Ready; MEL, make safe (the neutral warning at tier 1), NFF, the bench ask and the return-to-service step, the stop sheet and a repick, the research link; the Dock's Next opens the right alert; *Your move* is on the first phone screen; the draft survives closing the sheet; week 0's scripted alert; the What's new sheet shows once.

### 21.3 Package C

- `tests/purchasing.test.ts`: the pure view model in `src/ui/purchasing/model.ts` (card lines and freight options from `cardOf`, requisitions grouped by supplier and carrier, planner rows by family sorted and filtered, needs with no P/N, the Money cards' numbers from a hand-built ledger), and the adapted puzzles (the auction reads a lot, the invoice card reads real unpaid POs). C doesn't edit A's existing test files.
- In the browser: approve a card on the AOG boat; approve a card after End turn (no lock); approve requisitions together; act on an urgent flag (it approves the job's requisition); nudge; take a suggested min/max; bins full; receiving and payables; the Money tab on a phone.

### 21.4 Package D

- `tests/staff.test.ts`: with hard landings off (a test flag), the standard crew's weeks equal the stub run's; with them on, the three friends' tier 5 within ±1 week; every action's validation; payroll and severance; the pilot caps, the guest-plane skill rule, charter and wear; the housekeeping cap; builds with and without materials, rework, `builtShare` and the new buildings' health; cottages; `staffEffect` for every role on a hand-built island (the numbers match `projectWeek` with and without); `migrateStaff` and `newIslandStaff`; `botStaff` (the naive analyst over-hires); the board covers needs first.
- The island: `scripts/island-shots.mjs`: the beaten scene at or under 1,500 nodes; the new scenes render; screenshots looked at.

### 21.5 After the merge (the Integrate and QA phases)

`npx tsc --noEmit -p .`; `npx vitest run`; `npm run balance` and `npm run balance -- robust`; `scripts/e2e.mjs` on a phone and a desktop (updated for the flow); `scripts/e2e-online.mjs`; the migration on the v2 fixtures, looking for lost orders or money.

## 22. Work split and file ownership

**A lands first, as three commits that each pass the checks**, with everything B, C and D build on:
- **A1, the pure modules**: types, items, fig 79-20, tasks, search, the symptom tables, the judge, with their tests.
- **A2, the engine**: alerts, the flow, stock and purchasing, payables, the ledger, migration and the version gate, whose-move, the Dock, the staff constants and stubs, the UI mount stubs.
- **A3**: the bots, the balance run and its tuning, and the DECISIONS.md section.

B, C and D then start from A3 in parallel and edit only their own files. If one of them needs an engine change, it doesn't make it: it says so in its result, and the Integrate phase makes it.

| Path | Owner |
| --- | --- |
| `src/sim/types.ts`, `data.ts`, `engine.ts`, `econ.ts`, `chain.ts`, `aircraft.ts` (fig 79-20 only), `bots.ts`, `progression.ts` | A |
| `src/sim/items.ts`, `tasks.ts`, `alerts.ts`, `search.ts`, `flow.ts`, `stock.ts`, `ledger.ts`, `migrate.ts` (new) | A |
| `src/sim/staff.ts` (new) | A writes the constants, the stubs, `migrateStaff` and `newIslandStaff`; then D owns it |
| `src/puzzles/types.ts` (context `pick`, `lot`, `invoice`) | A |
| `src/ui/select.ts` (`flowMoves`, `dockNext`, `endTurnChecks`, `openTarget`), `src/ui/useIsland.ts` (`migrate` in the read path), `src/ui/kit.tsx` (icons), `src/net/firebase.ts`, `firestore.rules` | A |
| `src/ui/home.tsx` | A, and only A: the Dock (from `dockNext` and `endTurnChecks`), the `<YourMove>` mount at the top of the main column (techs), the `<BuildStatus>` mount (the whole game) |
| `src/ui/flow/YourMove.tsx`, `src/ui/staff/StaffDesk.tsx`, `BuildStatus.tsx` | A writes stubs that render nothing; then B owns `YourMove` and D the staff ones |
| the mount `<StaffDesk ctl={ctl} />` in `desk.tsx` | A adds the line; C keeps it (moves it into its Staff tab) |
| `tests/*` (except the files named for B, C, D), `tests/fixtures/v2-6c0c426-*.json`, `scripts/balance.ts`, `scripts/fixtures-v2.ts` | A |
| `src/ui/flow/*` (new: `YourMove`, `Inbox`, `JobFlow`, `Search`, `ManualView`, `IpcView`, `SupplyView`, `StockStep`, `StockBadge`, `StopSheet`, `WhatsNew`, `steps.ts`, `flow.css`), `src/ui/ops.tsx` (the asset chip row, the inbox, the `ic:open` listener), `orders.tsx`, `manual.tsx`, `chain.tsx`, `puzzlehost.tsx`, `week0.tsx`, `src/puzzles/wireup.ts`, `conduit.ts`, `panel.ts`, `meter.ts` (two `PLACES` entries), `tests/flowui.test.ts`, `tests/conduit.test.ts` | B |
| `src/ui/purchasing/*` (new: `ApprovalCard`, `ReqQueue`, `StockPlanner`, `Needs`, `ItemSheet`, `BuySheet`, `Receiving`, `Money`, `WhatsNew`, `model.ts`, `purchasing.css`), `src/ui/desk.tsx` (the segments, the End-turn lock removed for flow cards, the `ic:open` listener), `src/ui/board.tsx`, `src/puzzles/auction.ts`, `invoice.ts`, `tests/purchasing.test.ts` | C |
| `src/sim/staff.ts` (after A), `src/ui/staff/*` (after A), `src/ui/island.tsx`, `src/ui/island/*` (new `staff.tsx`; the placard, closed and made-safe bubbles), `src/islandlab.tsx`, `scripts/island-shots.mjs`, `tests/staff.test.ts` | D |
| `src/styles.css` | A, only for a shared token; B, C and D style in their own CSS files |
| `scripts/e2e.mjs`, `scripts/e2e-online.mjs`, `docs/ONBOARDING.md` | the Integrate phase (from B's, C's and D's *how to play*) |
| `docs/DECISIONS.md` | A adds *## Real job flow* with four subsections (*Engine and data (A)*, *Technicians' screens (B)*, *The analyst's desk (C)*, *Staff (D)*), each with a placeholder line; each package writes only in its own |

**What each package uses from A** (so it can start without waiting):
- **B**:
  - state and alerts: `s.alerts`, `s.flowSince`; `flowStage`, `flowMove`, `symptomText`, `findingOf`, `siteOf`, `alertFlags`, `alertTier`, `hintsFor`;
  - search and tasks: `manualIndex`, `ipcIndex`, `supplyIndex`, `search`, `complete`, `rowBadges`; `tasksFor`, `taskById`, `benchFor`;
  - stock and the card: `available`, `onOrderFree`; `cardOf`, `pickCheck`, `installCheck`; `itemById`, `priceAt`, `famOf`;
  - the actions `plan`, `nff`, `mel`, `makeSafe`, `askBench`, `repick`, `dropJob`, `request`, `cancelReq`;
  - `manualCard` for the new keys; `context.pick` in `launchFor`; the `ic:open` contract (`DockTarget`).
- **C**:
  - the card and the queues: `cardOf`; `s.reqs`, `s.pos`;
  - stock: `stockFlags`, `needs`, `families`, `velocity`, `moveClass`, `insuranceSpare`, `knownDemand`, `suggestRop`, `position`, `binsInUse`, `invValue`, `onOrderValue`;
  - money: `committed`, `payable`, `spendable`, `capitalCost`, `fixedNow`; `spendSeries`, `tradeSpend`, `assetSpend`, `stockBuiltUsed`, `fillRate`, `waitWeeks`, `runway`;
  - suppliers and search: `SUPPLIERS`, `FREIGHT`, `priceAt`; `search` over `supplyIndex`; `auctionLot`, `invoiceContext`;
  - the actions `approve` (with `buy`), `approveReq`, `deferReq`, `buy`, `setStock`, `scrap`, `nudge`, `melExtend`, `setStanding`, `setBudget`; the `ic:open` contract.
- **D**: the `STAFF`, `BUILDS` and `COTTAGE` constants and the stub signatures (15.4); `raiseAlert`; `takeStock`; `book`; the `Liner` type; the staff actions in the `Action` union and `WEEK_BOUND`; `builtShare` wired into `finishProjectIfDone`; the hooks called from `resolveWeek`, `openWeek` and `projectWeek`; `alertAog`, `hazardOn` (and, since 2026-09-28, `subCharterOn` in place of `restrictedBy`) for the island.

**What no package does**:
- change another package's files;
- store derived data in the island doc;
- add an action outside `types.ts` (A defines every action up front, D's included);
- import from another package's new folder: B, C and D import from A's modules, `kit.tsx` and their own. The only exceptions are the mounts A places;
- open another package's screen except through `openTarget`.

## 23. Risks and open questions

**Risks, and what this spec does about them**

- **Tedium on a phone.** Every trade job now has search steps. They're kept to 2–3 taps per step (17.2), with chips at tiers 0–2. Inspections and code prep are one tap. The IPC figure opens from the slot, bench stock is drawn on its own, drafts survive closing the sheet, and *Your move* is on the first screen. If playtests still find it slow, the first lever is to open the Manual step with the chapter chip already set from the symptom at tier 3 too.
- **Gridlock.** Written as rules (0.2 rule 8), with a test for each (21.1) and latency and AOG-by-cause in the balance run (20.4).
- **Balance.** About $6,700 of new drain over a game (20.2). The knobs and the order are in 20.
- **Doc growth.** Only bounded aggregates are stored; closed alerts, POs and requisitions are kept 2 weeks; tested at week 52 (21.1).
- **Speed.** An airplane's IPC index is built once per airplane state (LRU of 12); analytics are memoized per state and computed once per bot turn; bots never search; 0.5 s per sim.
- **The truth sits in the doc.** An alert's hidden cause, like a hidden defect, is readable with developer tools. Acceptable for three friends (the trust model already says so).
- **Migration.** No legacy order waits on kits; eight base-engine fixtures and the live ones prove it (19.4); two teaching weeks and a What's new sheet (17.5).
- **Merge conflicts.** One owner per file (22). A lands first and places the mounts, the icons, the Dock and the `ic:open` contract.
- **Realism, knowingly simplified.**
  - Prices are scaled to the game's weekly economy and flat.
  - Lead times are counted in weeks.
  - Rotables are priced at exchange, with the core assumed returned.
  - There's no calibration, shelf life or tool wear in v1, and the rare jobs come as job lots.
  - One supplier and one alternative per trade; no sales tax.
  - Makers and P/Ns are fictional in the aircraft.ts style; the NEC references are the 2023 edition.

**Open questions for the three of you** (defaults in brackets)

1. At tier 3+, should tapping a part slot open the IPC at the task's figure (a real AMM task points to its figure), or at the IPC's front? [the figure]
2. The *Recent on this airplane* row at tier 3+ now lists recent tasks, not P/Ns (so the IPC stays the lookup). Useful, or drop it? [keep it]
3. Do you want the optional cottages (an investment from tier 3, about 26 weeks to pay back)? [only if the island art has room]
4. Wages: a skill-3 pilot at $320 a week and a builder at $260 (weekly cost to the company) are game money, scaled like the rest. Too cheap to matter, or about right? [as is; tune after a playtest]
5. Hard landings at 0.3% of flights for an average pilot: about one every 28 weeks at 12 flights a week. Right for island flying? [yes]
6. Should skill 1–2 pilots be kept off the guest planes (a company policy, so cheap pilots fly cargo)? [yes]
7. The standing limit approves up to $1,000 a week of late cards on the analyst's behalf by default. Too trusting? [keep it; the analyst can set it to 0]

## 24. Rejected critique

Every blocker and major is resolved in the sections above. These points were rejected, deferred or changed on the way in, with the reason.

| Point (lens, severity) | What we did instead | Why |
| --- | --- | --- |
| Put the mechanic's torque wrenches, N2 gauge and compression tester in a 52-week calibration program; make the electrician's torque tool annual and drop calibration from his meters (realism, major) | The mechanic's shop tools are in (3.4: T-TW-IN, T-TW-FT, T-DIFF, T-N2), **owned or not**. Calibration is deferred for both trades. | The scope finding (game, major) holds: in v1 calibration is a chore with no decision (always send it), and forgetting it can take the torque tool away in the week code prep is due. When calibration comes back in v2, it is the critique's version: the mechanic's torque wrenches and N2 gauge and the electrician's torque tool at 52 weeks, with *"every job torqued since is suspect"*, and no meters. |
| Split `ignition` into `plugs` (tier 2, cost 300, parts 0) and `magneto` (tier 2, cost ~620, parts 1); present 72-30 and 74-xx as the engine maker's parts catalog; a scenario for the wash-and-borescope job (realism, blocker and minors) | The ignition and hot-section kinds and the six extra figures are deferred (0.3); `M_ROUGH_MAG` and `M_ITT_TREND` with them. The rare cylinder job's pre-filled line is named from the Brandt catalog. | Scope (game, major): they serve rare jobs and put `aircraft-golden` at risk. The critique's split and prices are recorded here for v2; they pass the band. |
| Add a wing-tip task 57-30-01 and a 33-40 nav light figure for `M_TOW` (realism, major) | No `M_TOW` in v1: line crew is deferred, so there are no tows. | Moot in v1. A tow symptom may not return without that task. |
| "Petty cash covers parts only" (realism, minor) | The per-trade budget is renamed the **work budget**: a delegated approval limit that covers the labour of jobs whose lines are all on hand. | The gridlock fix (game, blocker) needs in-stock jobs to start without the analyst. A maintenance lead's spending authority is how that works in real shops, and it removes the accounting oddity of labour paid from a supply-house cash box. |
| Pilot skill should also move the CHT-trend weight and the turbine's hot-start risk (realism, major) | Pilot skill moves: the guest-plane rule, tours sold, brake and tire wear, hard landings, write-up quality, and the pilot's name on the squawk. | Cylinder jobs come about 0.3 a game, so a CHT weight would be invisible. No hot-start roll exists for the pilots' own starts, and adding one is a new failure system. |
| "Let skill 1–2 pilots fly cargo only (Part 135 PIC minimums, 135.243)" (realism, major) | Kept as **company policy** ("a new pilot builds time on the cargo runs"). | 135.243's minimums apply to cargo PICs too, so it isn't a rule that splits cargo from passengers. As policy it's realistic and gives the same trade-off. |
| Assign the Dock to B (tech side) and C (analyst side) (game, major) | A owns `home.tsx` and the Dock; the labels and the End-turn list come from `select.ts` (`dockNext`, `endTurnChecks`); a `CustomEvent` opens B's JobFlow or C's desk. | One owner per file. Two packages editing one component in parallel is the merge conflict the split exists to avoid. |
| New buildings start at `60 + 15 × quality + 15 × builtShare` (game, major) | `60 + 30 × quality − 15 × (1 − builtShare)` | The same ±15 lever for the builders, but exactly today's number when the standard builder finishes on time. Principle 5 (the standard crew reproduces today) and the stub test need that. |
| Make overstocking cost more: bins by tier (30–70) **or** a carrying charge of about 2% a week (game, minor) | Bins (40, 50, 60, 75, 90) and a 0.1% a week cash charge, with the 26% a year cost of capital shown but not charged. | The FP&A critique (realism, minor) is right that the capital part of carrying cost isn't a payment. Bins make "which insurance spares to hold" a real choice without a fake cash drain. The starter stock alone takes 34 bins at tier 1, so the critique's 30 was too tight. |
| Keep the cargo plane for bulk, including building materials (game, minor) | Building materials come on the weekly supply boat, whatever flew; bulk parts ride the cargo plane; small lines ride any flight. | The builds critique (realism, major) is right: 20 ft rebar and a pallet don't fit a cargo single. |
| "An LFNC whip no longer than 6 ft (680.42(A)(1))" (realism, major) | The spa panel comes with a 6 ft LFNC whip kit; the reference cites 680.42(A) for LFNC at the spa. | We aren't certain the 2023 edition still prints a length limit there, and the spec cites the 2023 edition. The electrician should confirm before a limit is printed as code. |
| "The correct isolation is the main off, with the house closed" (realism, major) | No new make-safe option: on a service-neutral cause the right call is to leave the house closed, and a branch breaker leaves the hidden `elec:isolation` defect. | A hazard that isn't made safe already closes the house, so "main off" and "leave it closed" are the same move in the game. |
| The tire-pressure fix could use "valve core bubbles"; the hard landing "sidewall cut, wheel flange cracked"; the vibration "a cracked spinner bulkhead" (realism, major and minor) | A pinhole in the tube; a sidewall cut with the wheel undamaged; a blade track out of limits. | A valve core would need its own task; a wheel assembly ($1,450) or a spinner bulkhead breaks the tire and prop cards' money band. The chosen findings are all real and fit. |
| THWN take-offs for the transfer switch and the 240 V dock pumps (realism, major) | The spa's wire is a real take-off by the foot (L1, L2, N and a 250.122 EGC). The transfer switch and the fuel dock are rare jobs with one job-lot line in v1. | Scope (game, major): 0.5 and 0.7 jobs a game. The take-off model is built once for the spa and reused when those jobs get slots in v2. |
| "Keep `life` only on the fish tape and the pulling rope" (realism, minor) | No tool wear in v1. | Scope (game, major): wear is a chore with no decision. |
| MEL "B = fix this week" (realism, minor) | Only category C in v1. | No v1 symptom has a category B item. |
| "The test flag also turns the hard-landing allowance off, or the allowance applies only when random effects are on" (game, minor) | The allowance is gone. | At 0.3% a flight, and never on the only guest plane, the standard crew has about one hard landing every two games (2 health on one plane), so there is nothing to give back. The test flag turns hard landings off (21.4). |
| Pilot skill should pay back its wage premium at every tier (game, major) | Every card states the pay-back against this island's need; a skilled pilot pays through tours, which grow with the charter volume. | At tiers 2–3 the twin has few spare flights to sell, so paying more for a pilot there *should* look poor. The effect statement shows that honestly instead of tuning it away. |

## 25. Decisions the owner should know about

1. **v1 is a smaller game than the first draft, on purpose.** The full "alert → manual → IPC → stock → buy" flow covers the jobs that make up about 90% of the work: inspections, oil, tires and brakes, props, hydraulics, radios, alternators, outlets, GFCIs, 3-ways, the hot tub, the feeder. Rare jobs keep the diagnosis but come with their parts filled in. Ignition, the turbine hot section, calibration, cores, shelf life, line crew and morale wait for v2. *Trade-off:* less realism on rare jobs for now, in exchange for a build that can land on live islands without breaking them.
2. **In stock means "do it now"; missing means "ask the analyst".** That's your own flow. A job whose parts and tools are all on the shelf starts at once, paid from the trade's weekly work budget, at any tier. Safety work may go over the budget. The analyst's approvals are for buying, and for bigger jobs over the budget. *Trade-off:* the analyst swipes fewer cards and steers through budgets and stock instead. Stocking well becomes the analyst's main lever on how fast the planes fly again.
3. **Nobody can hold the island hostage by playing at the wrong time.** Cards stay approvable after the analyst ends the turn. A card that comes in after the analyst has played goes through at the week's resolve, up to a standing limit the analyst sets. A part with a one-week lead time, ordered this week, arrives at this week's resolve. *Trade-off:* the analyst gives up some control (they can set the limit to $0). In return a plane isn't grounded just because the analyst played first.
4. **The island's only guest plane is grounded past due like any plane, and a mainland sub-charter flies its guests** (changed 2026-09-28; it used to fly half its flights with a near-miss each). It still gets early warning signs instead of no-go squawks. Overdue, it's AOG until the fix, and an outside operator flies the guests in automatically, at $270 a flight against the island's own $180, so the houses stay booked and the cost is real. Nobody has to act; every seat sees the cost before it happens. *Trade-off:* the island pays a premium and loses the day tours for those weeks, instead of flying an unairworthy plane with near-misses. Grounding the only guest plane still never empties every house, which is the same reason the part chain leaves that plane alone. See docs/DECISIONS.md, 2026-09-28.
5. **Jobs cost what they cost today, with three honest exceptions.** A job's labour plus its parts equals today's card, checked for every job. The exceptions are the twin's 100-hour and oil change (two engines) and the cargo plane's starter-generator: those cost more, about $1,400 over a game. *Trade-off:* a little more maintenance spend, in exchange for prices a mechanic believes.
6. **Mistakes stay hidden, and the shelf can't give the answer away.** A wrong task, a part for the wrong serial number, or a wrong breaker or missing AFCI protection shows up weeks later, as a repeat squawk, an incident or an inspection find. A part that simply doesn't fit stops the job at the install. The stockroom holds some near-miss parts left by "the previous operator", so "4 on hand" never tells the mechanic he picked right, and the analyst's screens never show which P/N fits which plane. *Trade-off:* a little dead stock on every island, for a test that stays a test.
7. **"Which parts move fast or slow" is answered by family, over 26 weeks.** Tires, linings, oil filters, GFCI devices, 20 A breakers are ranked against each other, not single part numbers week by week: there isn't enough demand for per-part weekly numbers to mean anything (the twin's tire is used less than once a game). Safety spares are marked "insurance" and never flagged to stop. Money follows real FP&A: orders are commitments, and bills are paid a week after delivery once the three-way match has run. *Trade-off:* fewer, broader numbers, but ones that are true and useful for planning.
8. **The analyst hires pilots, housekeepers and builders, and every candidate says what they're worth.** The choice is hire, let go and skill level, with no morale or raises in v1. Each card spells out the effect on this island: "flies 6 a week, you're losing 2 flights", "turns over 2 houses, you book 4: 2 would sit empty", "villa site done week 15 instead of 12". Better pilots sell more tours and wear the brakes and tires less. Low-skill pilots fly cargo only. *Trade-off:* a simpler staff game, but every hire is a real decision you can read in dollars.
9. **Builders make the island better, not later.** Tiers still arrive when the crew project is done. Builders decide how good the new buildings start: up to 15 points of condition, about two to three weeks of the electrician's upkeep each. They can also build extra cottages as a long-term investment (about 26 weeks to pay back). *Trade-off:* builders can't block your progress, but they also can't speed a tier up.
10. **Live islands are carried over carefully.** Every island gets a starter shelf of real parts and tools for its tier. Parts kits already bought, on the shelf or on the way, become store credit at the vendors. A job that was approved and waiting on a kit gets its real parts at this week's resolve, paid from that credit, so nobody pays twice and no approved job waits longer. Everyone gets two weeks of teaching-level hints and a one-time "What's new" sheet. *Trade-off:* the first two weeks after the update are easier than normal.
