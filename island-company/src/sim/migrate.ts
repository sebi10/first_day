// The v2 -> v3 migration (docs/JOBFLOW.md 19.2): an island saved before the job
// flow gets the starter stock, its kits as store credit, its kit-waiting jobs
// as flow jobs (with an automatic PO for what the shelf doesn't cover), the
// standard NPC crew and a ledger backfilled from its week reports. Pure,
// deterministic and idempotent field by field: each step runs only while its
// field is absent. It runs at the top of apply() and in the UI's read path.
import { SYMPTOMS } from './alerts';
import { islandAircraft } from './chain';
import { GEN_UPGRADE } from './checkdata';
import { kitValue, STOCK, TIERS, WARRANTY } from './data';
import { bomValue, laborCost, repairLabor, repairTask, stdPick } from './flow';
import { hashSeed } from './rng';
import { migrateStaff } from './staff';
import { book } from './ledger';
import { addStarter, allOnHand, jobLines, placePo, release, reserve, toolsToBuy } from './stock';
import { benchFor, defaultTask } from './tasks';
import type { Alert, Asset, IslandState, OpsRole, Order, WeekLedger } from './types';
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
  // 7. the teaching weeks start now (a week-0 island starts with the flow in week 1, like a new one)
  s.flowSince ??= Math.max(1, W);
  // 8. the v4 update (the stage 1 release gate, 2026-09-29), on a doc an older engine wrote last (read before apply()
  // sets engine to 4, and in the UI's read path): the week v4 takes over (the weeks before it were resolved by the old
  // rules: the Board rings no pause there), and the credits streak the old rule had earned, kept (it counted Harbor
  // weeks; v4 counts only the Resort's). A new island (engine 4 from its first move, in week 0) never has either.
  if ((s.engine ?? 0) < 4 && W > 0 && s.stats.v4From === undefined) {
    s.stats.v4From = W;
    if ((s.stats.aStreak ?? 0) > 0) s.stats.aCarry = s.stats.aStreak;
  }
  // 9. G0, the upkeep structure (stage 2, v5), once, on a doc an older engine wrote at the Harbor or the Resort (read
  // before apply() sets engine to 5, and in the UI's read path). A new island gets these as its tiers arrive; this
  // island's Harbor and Resort went up before they existed. Stamped (stats.g0From) so it runs once.
  if ((s.engine ?? 0) < G0_ENGINE && W > 0 && s.tier >= 4 && s.stats.g0From === undefined) {
    s.stats.g0From = W;
    upkeepMigrate(s, W);
  }
  return s;
}

/** the engine that brought G0 (ENGINE_VERSION 5): a doc an older one wrote last gets step 9 */
export const G0_ENGINE = 5;

/**
 * G0's one-time migration (step 9), fair and no gift:
 * - the builder's warranty dated from when the buildings went up: the Harbor's and the Resort's new houses and every
 *   extra cottage the builders finished from the Harbor on, WARRANTY.weeks from that week, only where it still runs
 * - the service upgrade a new island gets with its tier, granted now: at the Harbor the grid (a new pad-mount
 *   transformer and feeder) at 80 or better, at the Resort the generator (a bigger standby set and transfer switch)
 *   too, under the warranty from this week
 */
function upkeepMigrate(s: IslandState, W: number): void {
  const reached = s.stats.tierReachedWeek;
  const running = (from: number) => from + WARRANTY.weeks >= W;
  for (let t = Math.max(WARRANTY.fromTier, 1); t <= Math.min(s.tier, TIERS.length); t++) {
    const at = reached[t];
    if (at === undefined || !running(at)) continue;
    for (const add of TIERS[t - 1].adds) {
      const a = s.assets.find((x) => x.id === add.id);
      if (a && (a.kind === 'house' || a.kind === 'generator') && a.warrantyUntil === undefined) a.warrantyUntil = at + WARRANTY.weeks;
    }
  }
  const harbor = reached[4];
  if (harbor !== undefined && WARRANTY.fromTier <= 4)
    for (const b of s.builds ?? []) {
      if (!b.cottage || b.finished === undefined || b.finished < harbor || !running(b.finished)) continue;
      const a = s.assets.find((x) => x.id === b.cottage);
      if (a && a.warrantyUntil === undefined) a.warrantyUntil = b.finished + WARRANTY.weeks;
    }
  const lines: string[] = [];
  const upgrade = (kind: 'grid' | 'generator', what: string) => {
    const a = s.assets.find((x) => x.kind === kind);
    if (!a) return;
    a.health = Math.max(a.health, UPGRADE_HEALTH);
    a.warrantyUntil = W + WARRANTY.weeks;
    lines.push(what);
  };
  if (WARRANTY.service.grid) upgrade('grid', 'the Harbor’s new pad-mount transformer and feeder');
  if (s.tier >= 5 && WARRANTY.service.gen) {
    upgrade('generator', `the Resort’s bigger standby set with ${GEN_UPGRADE.words}`);
    const gen = s.assets.find((x) => x.kind === 'generator');
    if (gen) retireOldSwitch(s, gen);
  }
  if (lines.length) {
    const id = (s.feed[s.feed.length - 1]?.id ?? 0) + 1;
    s.feed.push({
      id,
      week: s.week,
      role: 'all',
      tone: 'good',
      text: `This update brings ${lines.join(', and ')}: in at ${UPGRADE_HEALTH} or better, under warranty to week ${W + WARRANTY.weeks}.`,
      at: s.updatedAt,
    });
    if (s.feed.length > 60) s.feed.splice(0, s.feed.length - 60);
  }
}

/** the old standby set's work the Resort's upgrade makes moot: its transfer switch (the electrician's) and its engine service (the mechanic's) */
const OLD_SET_KINDS = new Set(['transfer', 'genService']);
/**
 * the alerts about the old set and switch, by what they say (never by an alert's hidden cause, which would tell the
 * crew what it was): the set's weekly-run squawks, the take-off to upsize the switch, a transfer that didn't pick up, and
 * the quick checks' write-ups on the set and the switch. A backed-up circuit that didn't come on (E_GEN_TEST) is the
 * circuits', not the set's: it stays
 */
const OLD_SET_SYMS = new Set(['M_GEN_RUN', 'M_GEN_SHAKE', 'E_TAKEOFF_XFER', 'E_XFER_FAIL']);
const kindOfWork = (x: { kind: string; repair?: { defect: { job?: string; orderKind: string } } }) => (x.repair ? (x.repair.defect.job ?? x.repair.defect.orderKind) : x.kind);
const oldSetAlert = (a: Alert) => (a.repair ? OLD_SET_KINDS.has(kindOfWork(a)) : OLD_SET_SYMS.has(a.sym) || /^K_(walk|ir):/.test(a.sym));

/** the old set's live alerts and unfinished jobs (its alerts' jobs, and its own kinds' orders: a legacy one, a redo) */
export function oldSetWork(s: IslandState, gen: Asset): { alerts: Alert[]; jobs: Order[] } {
  const alerts = (s.alerts ?? []).filter((a) => a.assetId === gen.id && a.status !== 'closed' && oldSetAlert(a));
  const ids = new Set(alerts.map((a) => a.order).filter((x): x is string => !!x));
  const jobs = s.orders.filter((o) => o.assetId === gen.id && open(o) && (ids.has(o.id) || (!o.flow && OLD_SET_KINDS.has(kindOfWork(o))) || (o.repair && OLD_SET_KINDS.has(kindOfWork(o)))));
  return { alerts, jobs };
}

/**
 * G0: the Resort's bigger standby set and its new 200 A automatic transfer switch are in (with the tier, or by the
 * migration of a live tier-5 island), so the work on the old set is moot. Review round 1 closed its open alerts; review
 * round 2 retires its unfinished jobs too: a job already planned (a card, an approved job waiting on its parts, a ready
 * one, a redo) was left open, and the crew paid about $2,000 to swap the brand-new switch for the old one's lot. Now,
 * for the transfer switch and the set's engine (the alerts by what they say, their jobs, and those kinds' repairs): the alerts close as dropped, the jobs are
 * cancelled (reserved stock released, the labour of a job never started comes back, the requisitions close), the lines
 * still with the vendor are cancelled (a line already received and held lands as free stock), and the old set's hidden
 * defects go with it (the equipment they were in is gone). Said once in the feed
 */
export function retireOldSwitch(s: IslandState, gen: Asset): void {
  const W = s.week;
  const { alerts, jobs } = oldSetWork(s, gen);
  let labour = 0;
  let parts = 0;
  for (const o of jobs) {
    release(s, o.id);
    // the labour of a job never started comes back (as the job flow's Drop does)
    const refund = o.approvedWeek !== undefined && !o.result ? o.cost : 0;
    if (refund > 0) {
      s.cash += refund;
      book(s, 'labor', -refund, { trade: o.role as OpsRole, asset: o.assetId });
      if (o.autoApproved && o.approvedWeek === W) s.autoSpent[o.role as OpsRole] = Math.max(0, (s.autoSpent[o.role as OpsRole] ?? 0) - refund);
      labour += refund;
    }
    for (const r of s.reqs ?? []) {
      if (r.order !== o.id) continue;
      if (r.status === 'open') {
        r.status = 'cancelled';
        r.closed = W;
      } else if (r.status === 'ordered') delete r.order;
    }
    for (const p of s.pos ?? []) {
      for (const l of p.lines) {
        if (l.order !== o.id || l.got !== undefined) continue;
        if (p.status === 'open') {
          // still with the vendor: cancelled, and its requisition with it
          p.cost = Math.round((p.cost - l.qty * l.unit) * 100) / 100;
          parts += l.qty * l.unit;
          l.qty = 0;
          for (const r of s.reqs ?? []) if (l.req && r.id === l.req && r.status !== 'filled') Object.assign(r, { status: 'cancelled', closed: W });
        } else delete l.order;
      }
      p.lines = p.lines.filter((l) => l.qty > 0);
    }
    o.status = 'cancelled';
  }
  // a PO left with nothing on it: the vendor's shipment is cancelled, its freight with it
  if (s.pos) s.pos = s.pos.filter((p) => p.lines.length > 0 || p.status !== 'open');
  for (const a of alerts) {
    a.status = 'closed';
    a.closed = { week: W, how: 'dropped' };
  }
  const defects = (s.defects ?? []).filter((d) => d.assetId === gen.id && OLD_SET_KINDS.has(d.job ?? d.orderKind));
  if (defects.length) s.defects = (s.defects ?? []).filter((d) => !defects.includes(d));
  if (!alerts.length && !jobs.length) return;
  const n = jobs.length;
  const back = [labour > 0 ? `$${Math.round(labour).toLocaleString('en-US')} of labour back` : '', parts > 0 ? `$${Math.round(parts).toLocaleString('en-US')} of parts cancelled with the vendor` : ''].filter(Boolean).join(', ');
  s.feed.push({
    id: (s.feed[s.feed.length - 1]?.id ?? 0) + 1,
    week: W,
    role: 'all',
    tone: 'info',
    text: `The Resort’s new standby set and ${GEN_UPGRADE.words.replace(/^a /, 'its ')} are in: the work on the old set is dropped (${n ? `${n === 1 ? 'a job' : `${n} jobs`} cancelled` : `${alerts.length === 1 ? 'an alert' : `${alerts.length} alerts`} closed`}${back ? `; ${back}` : ''}).`,
    at: s.updatedAt,
  });
  if (s.feed.length > 60) s.feed.splice(0, s.feed.length - 60);
}

/** the service upgrade's condition on a live island (the synthesis's release grant: a new transformer and feeder, a new standby set) */
const UPGRADE_HEALTH = 80;

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
        // (the kits were paid for: no freight on what replaces them)
        const pos = placePo(s, [...short, ...tools], {}, 'auto', 0, { noFreight: true });
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
