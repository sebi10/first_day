// The v2 -> v3 migration (docs/JOBFLOW.md 19.2): an island saved before the job
// flow gets the starter stock, its kits as store credit, its kit-waiting jobs
// as flow jobs (with an automatic PO for what the shelf doesn't cover), the
// standard NPC crew and a ledger backfilled from its week reports. Pure,
// deterministic and idempotent field by field: each step runs only while its
// field is absent. It runs at the top of apply() and in the UI's read path.
import { SYMPTOMS } from './alerts';
import { islandAircraft } from './chain';
import { kitValue, STOCK, TIERS } from './data';
import { bomValue, laborCost, repairLabor, repairTask, stdPick } from './flow';
import { hashSeed } from './rng';
import { migrateStaff } from './staff';
import { addStarter, allOnHand, jobLines, placePo, reserve, toolsToBuy } from './stock';
import { benchFor, defaultTask } from './tasks';
import type { Alert, IslandState, Order, WeekLedger } from './types';
import { needsOf, siteOf } from './alerts';

const open = (o: Order) => o.status !== 'done' && o.status !== 'cancelled';

export function migrate(s: IslandState): IslandState {
  const W = Math.max(0, s.week);
  // 1. stock: the starter shelf up to the island's tier; the kits become store credit at the vendors
  if (!s.inv) {
    s.inv = {};
    for (let t = 1; t <= Math.max(1, s.tier); t++) addStarter(s, t);
    const kits = (s.parts?.stock ?? 0) + (s.parts?.inTransit ?? 0);
    s.credit = (s.credit ?? 0) + kits * kitValue(s.tier);
    if (s.parts) s.parts = { stock: 0, inTransit: 0 };
  }
  s.pos ??= [];
  s.reqs ??= [];
  s.eas ??= [];
  // 2. orders: no legacy order waits on kits after this step (4. alerts start empty)
  if (!s.alerts) {
    s.alerts = [];
    convertOrders(s, W);
  }
  // 5. staff and builds
  migrateStaff(s);
  // 6. ledger, from the week reports
  if (!s.ledger) s.ledger = backfill(s);
  // 7. the teaching weeks start now
  s.flowSince ??= W;
  return s;
}

function convertOrders(s: IslandState, W: number) {
  for (const o of s.orders) {
    if (!open(o) || o.flow) continue;
    const kit = (o.parts ?? 0) > 0;
    if (!kit || o.chain || o.kind === 'project' || o.role === 'fin') {
      // its kit was consumed at approval, or is in the credit: a legacy order plays as before
      o.parts = 0;
      continue;
    }
    if (o.status === 'ready') {
      o.parts = 0;
      continue;
    }
    const asset = s.assets.find((a) => a.id === o.assetId);
    if (!asset || (o.role !== 'mech' && o.role !== 'elec')) {
      o.parts = 0;
      continue;
    }
    // the linked alert: a write-up of its kind, or the repair's
    const id = `a${s.nextId++}`;
    const sym = o.repair ? 'R_REPAIR' : `W_${o.kind}`;
    if (!SYMPTOMS[sym]) {
      o.parts = 0;
      continue;
    }
    const a: Alert = {
      id,
      role: o.role,
      assetId: asset.id,
      sym,
      src: 'finding',
      week: W,
      due: W + (o.repair ? 0 : 2),
      seed: hashSeed(s.seed, 'alert', id),
      kind: o.repair ? 'repair' : o.kind,
      cause: 0,
      status: 'job',
      order: o.id,
      ...(o.repair ? { repair: o.repair } : {}),
    };
    s.alerts!.push(a);
    const task = o.repair ? repairTask(s, a) : defaultTask(o.kind, asset);
    if (!task) {
      a.status = 'open';
      delete a.order;
      o.parts = 0;
      continue;
    }
    a.task = task.id;
    const ac = asset.kind === 'plane' ? islandAircraft(s.seed, asset) : null;
    const site = siteOf(s, a);
    const pick = task.fixed ? stdPick(s, asset, task) : stdPick(s, asset, task, site, needsOf(s, a));
    const bench = benchFor(task, ac, asset);
    o.flow = { alert: id, task: task.id, pick, bench, tools: [...task.tools], bom: 0 };
    o.flow.bom = Math.round(bomValue(jobLines(o)) * 100) / 100;
    o.parts = 0;
    o.job = task.job ?? o.job ?? o.kind;
    if (o.status === 'waiting_part') {
      // approved and paid: what the shelf has is reserved, the rest comes on an automatic PO, landing this week's resolve
      reserve(s, o.id, jobLines(o));
      const short = jobLines(o)
        .map((l) => ({ item: l.item, qty: l.qty - (s.inv?.[l.item]?.res?.[o.id] ?? 0), order: o.id }))
        .filter((l) => l.qty > 0);
      const tools = toolsToBuy(s, o).map((t) => ({ item: t, qty: 1, order: o.id }));
      if (short.length || tools.length) {
        const pos = placePo(s, [...short, ...tools], {}, 'auto', 0);
        for (const p of pos) p.eta = W;
      }
      if (allOnHand(s, o)) o.status = 'ready';
    } else {
      // a card: re-priced (labour, and what's to buy), soft reservations; a counter-offer is gone
      o.status = 'pending';
      delete o.counter;
      o.pushedBack = false;
      reserve(s, o.id, jobLines(o));
      o.cost = o.repair
        ? repairLabor(s, { cost: o.repair.defect.cost, puzzle: o.repair.defect.puzzle, role: o.repair.defect.role, orderKind: o.repair.defect.orderKind, variant: o.repair.defect.variant, job: o.repair.defect.job })
        : laborCost(s, o.kind, task, asset, site, needsOf(s, a));
    }
  }
}

/** the ledger from the week reports (the weeks before this one, leaving room for its row): revenue, cash, and the fixed cost split into overhead and the standard payroll (nothing item-level) */
function backfill(s: IslandState): WeekLedger[] {
  return s.history.slice(-(STOCK.ledgerWeeks - 1)).map((h) => {
    const t = TIERS[Math.max(1, Math.min(5, h.tier)) - 1];
    const payroll = t.fixed - t.overhead;
    return { w: h.week, rev: h.revenue, cash: h.cashEnd, sp: { overhead: h.costs.fixed - payroll, payroll }, tr: {}, inv: 0 };
  });
}
