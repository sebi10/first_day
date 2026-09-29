// The technicians' job flow, as a pure model (docs/JOBFLOW.md 17.2): which of
// the five steps an alert shows (Investigate · Manual · Parts · Stock · Send;
// the electrician's Reference and Materials), the draft a tech builds while
// planning (the task, the pick, the search) and its reducer, what the Parts
// and Stock steps list, what Send dispatches, and what it will come to.
//
// Planning is local: nothing here writes to the island. The only write is the
// one `plan` (or `repick`) action Send dispatches. Everything is derived from
// the island and the alert (the seed, the code, the stored state), and nothing
// here reads an alert's hidden cause except what the teaching tiers already
// show (A's hintsFor and pickCheck). The UI keeps the draft in sessionStorage.
import { alertFlags, alertTier, causeOf, lowerFirst, prefilledTask, protectionNeeded, siteOf } from '../../sim/alerts';
import { ECON, ROLE_LABEL } from '../../sim/data';
import { gridFirstAlert } from '../../sim/econ';
import { acOf, earlyLess, judgeSlot, laborCost, planTask, repairLabor, stdPickFor } from '../../sim/flow';
import { buyUnits, itemById, priceAt, unitWords } from '../../sim/items';
import { hintsFor, ipcIndex, manualIndex, search, supplyIndex, type Doc } from '../../sim/search';
import { available, isSafetyJob, onOrderFree, owned, reservedFor, schedFreight, spendable, toolComing, vendorFor } from '../../sim/stock';
import { lateSafeAlert, standingWords } from '../select';
import { benchFor, fixedFor, plannable, slotQty, slotsAt, taskById, tasksFor, type MainSlot, type Task } from '../../sim/tasks';
import type { Action, Alert, Asset, ElecSite, IslandState, Item, ItemId, OpsRole, Order, PickLine, TaskId } from '../../sim/types';

// ---------------------------------------------------------------------------
// The five steps

export type StepKey = 'investigate' | 'manual' | 'parts' | 'stock' | 'send';
export const STEPS: readonly StepKey[] = ['investigate', 'manual', 'parts', 'stock', 'send'];

/** the step's word in the trade's own terms: the mechanic's Manual and Parts, the electrician's Reference and Materials */
export function stepLabel(k: StepKey, trade: OpsRole): string {
  if (k === 'manual') return trade === 'elec' ? 'Reference' : 'Manual';
  if (k === 'parts') return trade === 'elec' ? 'Materials' : 'Parts';
  return k === 'investigate' ? 'Investigate' : k === 'stock' ? 'Stock' : 'Send';
}

export const assetOf = (s: IslandState, a: Pick<Alert, 'assetId'>): Asset | undefined => s.assets.find((x) => x.id === a.assetId);

/** the alert's tier for its own trade: what the flow teaches (0-2) or tests (3+) */
export const tierOf = (s: IslandState, a: Alert): number => alertTier(s, a, a.role);

/** the task an alert opens with: a repair's own task, or the one a due item, an AD, a code notice, a take-off or a write-up names */
export function preTask(s: IslandState, a: Alert): TaskId | undefined {
  if (a.repair) return `repair:${a.id}`;
  return prefilledTask(s, a);
}

/** a task in the manual set for this alert (or its repair task), else undefined */
export function taskFor(s: IslandState, a: Alert, id: TaskId | undefined): Task | undefined {
  if (!id) return undefined;
  const t = planTask(s, a, id);
  if (!t) return undefined;
  if (id.startsWith('repair:')) return t;
  const asset = assetOf(s, a);
  return asset && tasksFor(s, asset, a.role).some((x) => x.id === t.id) ? t : undefined;
}

/** the main slots a task shows for this alert (a cover only outdoors) */
export const slotsFor = (s: IslandState, a: Alert, t: Task | undefined): MainSlot[] => (t ? slotsAt(t, siteOf(s, a)) : []);

/** the Parts step applies: a task with slots to pick, or a rare job's pre-filled line (a repair opens at Stock) */
export const hasParts = (s: IslandState, a: Alert, t: Task | undefined): boolean => !!t && !a.repair && (slotsFor(s, a, t).length > 0 || !!t.fixed);

/**
 * One tap: a pre-filled task with no main slots and no pre-filled line (the
 * 100-hour and phase inspections, code prep, a spar AD, a safety-wire write-up)
 * skips the flow. The row's button is Start: the bench lines are reserved at
 * Start, and a shortfall shows the stop sheet.
 */
export function isOneTap(s: IslandState, a: Alert): boolean {
  if (a.repair || a.status !== 'open') return false;
  const t = taskFor(s, a, prefilledTask(s, a));
  return !!t && plannable(t) && slotsFor(s, a, t).length === 0 && !t.fixed;
}

/** does a step apply to this alert, given the task the draft has chosen (if any) */
export function applies(s: IslandState, a: Alert, k: StepKey, task?: Task): boolean {
  switch (k) {
    case 'investigate':
      return !a.repair && !preTask(s, a);
    case 'manual':
      return !a.repair;
    case 'parts':
      return task ? hasParts(s, a, task) : !a.repair;
    default:
      return true;
  }
}

/** where a fresh draft opens: a repair at Stock, a take-off at Materials, other pre-filled alerts at the Manual step, else Investigate */
export function startStep(s: IslandState, a: Alert): StepKey {
  if (a.repair) return 'stock';
  const pre = preTask(s, a);
  if (!pre) return 'investigate';
  const t = taskFor(s, a, pre);
  if (a.src === 'takeoff' && t) return hasParts(s, a, t) ? 'parts' : 'stock';
  return 'manual';
}

/** after "Use this task": the Parts step, or straight to Stock for a task with nothing to pick */
export const nextAfterTask = (s: IslandState, a: Alert, t: Task): StepKey => (hasParts(s, a, t) ? 'parts' : 'stock');

export type StepState = 'done' | 'now' | 'todo' | 'skip';

/** the stepper's five dots: what's done, where the draft is, what's left, what doesn't apply */
export function stepper(s: IslandState, a: Alert, d: Pick<Draft, 'step' | 'task'> & Partial<Pick<Draft, 'pick' | 'research'>>): { key: StepKey; label: string; state: StepState }[] {
  const task = taskFor(s, a, d.task);
  const at = STEPS.indexOf(d.step);
  // Materials isn't done while a required slot is empty (Stock and Send say which)
  const short = d.pick ? missingSlot(s, a, { task: d.task, pick: d.pick, research: d.research }) : null;
  return STEPS.map((key, i) => ({
    key,
    label: stepLabel(key, a.role),
    state: !applies(s, a, key, task) ? 'skip' : i < at ? (key === 'parts' && short ? 'todo' : 'done') : i === at ? 'now' : 'todo',
  }));
}

/**
 * The first required slot the pick leaves empty (not "if needed"; an outdoor cover counts: it only shows outdoors),
 * or null. It reads the task and the site, never the alert's hidden cause: an "if needed" slot the fault needs is
 * the install check's to catch, as it is on a real job
 */
export function missingSlot(s: IslandState, a: Alert, d: Pick<Draft, 'task' | 'pick'> & Partial<Pick<Draft, 'research'>>): MainSlot | null {
  const t = taskFor(s, a, d.task);
  if (!t || t.fixed || a.repair) return null;
  return slotsFor(s, a, t).find((m) => (!m.optional || m.outdoor) && !filled({ pick: d.pick, research: d.research }, m)) ?? null;
}

/** "Pick the GFCI device ▸": Send's label while a required slot is empty */
export const pickFirstWords = (m: MainSlot) => `Pick the ${lowerFirst(m.label)}`;

// ---------------------------------------------------------------------------
// The draft

/** what a tech has chosen so far: kept per alert in sessionStorage (`jf:{island}:{alert}`) */
export type Draft = {
  v: 1;
  step: StepKey;
  /** the task chosen in the Manual / Reference step */
  task?: TaskId;
  /** the pick: one line per slot filled (with its `slot`), and extra lines */
  pick: PickLine[];
  /** the Manual / Reference step's search box, and its chapter chip */
  query: string;
  chapter?: string;
  /** the task whose card is open in the Manual step */
  preview?: TaskId;
  /** the slot whose search is open in the Parts step ('+': add a line) */
  slot?: string;
  /** the IPC slot sent to research: Not in the IPC · research the records */
  research?: string;
  /** a repick of this job (a stop, or a change of mind) */
  order?: string;
};

/** a fresh draft for an alert, or a repick draft for its job (the job's task and pick, at the Parts step) */
export function newDraft(s: IslandState, a: Alert, o?: Order): Draft {
  if (o?.flow) {
    const task = taskFor(s, a, o.flow.task);
    return {
      v: 1,
      step: task && hasParts(s, a, task) ? 'parts' : 'stock',
      task: o.flow.task,
      pick: o.flow.pick.map((l) => ({ ...l })),
      query: '',
      ...(o.flow.research && o.flow.researchSlot ? { research: o.flow.researchSlot } : {}),
      order: o.id,
    };
  }
  const pre = preTask(s, a);
  const step = startStep(s, a);
  return { v: 1, step, ...(pre ? { task: pre } : {}), pick: [], query: '', ...(pre && step === 'manual' ? { preview: pre } : {}) };
}

/** a stored draft still fits the alert: its task is still in the manual set, its job still open; else a fresh one */
export function checkDraft(s: IslandState, a: Alert, d: Draft | null | undefined): Draft | null {
  if (!d || d.v !== 1 || !STEPS.includes(d.step) || !Array.isArray(d.pick)) return null;
  if (d.order) {
    const o = s.orders.find((x) => x.id === d.order);
    if (!o?.flow || o.flow.alert !== a.id || o.status === 'done' || o.status === 'cancelled') return null;
  } else if (a.status !== 'open') return null;
  if (d.task && !taskFor(s, a, d.task)) return null;
  const pick = d.pick.filter((l) => !!itemById(l.item) && l.qty >= 1).slice(0, 10);
  return { ...d, pick, query: typeof d.query === 'string' ? d.query : '' };
}

export type DraftAct =
  | { t: 'go'; step: StepKey }
  | { t: 'query'; q: string }
  | { t: 'chapter'; chapter?: string }
  | { t: 'preview'; task?: TaskId }
  | { t: 'useTask'; task: TaskId }
  | { t: 'openSlot'; slot?: string }
  | { t: 'fill'; slot: string; item: ItemId; qty?: number }
  | { t: 'clear'; slot: string }
  | { t: 'qty'; index: number; qty: number }
  | { t: 'add'; item: ItemId; qty?: number }
  | { t: 'remove'; index: number }
  | { t: 'research'; slot?: string };

const MAX_LINES = 10;
const clampQty = (x: Item | undefined, q: number) => Math.max(1, Math.min(x?.cut ? 500 : x?.kind === 'tool' ? 1 : 500, Math.round(q)));

/**
 * The draft reducer. `useTask` moves on to Parts (or straight to Stock for a
 * task with nothing to pick); a changed task clears the pick. `fill` puts an
 * item in a slot at the slot's quantity for this airplane or site and comes
 * back from the slot's search; when the pick is complete it moves on to Stock
 * (see `afterFill`).
 */
export function reduceDraft(s: IslandState, a: Alert, d: Draft, act: DraftAct): Draft {
  switch (act.t) {
    case 'go':
      return { ...d, step: act.step, slot: undefined };
    case 'query':
      return { ...d, query: act.q.slice(0, 80), chapter: act.q.trim() ? undefined : d.chapter, preview: undefined };
    case 'chapter':
      return { ...d, chapter: act.chapter, query: act.chapter ? '' : d.query, preview: undefined };
    case 'preview':
      return { ...d, preview: act.task };
    case 'useTask': {
      const t = taskFor(s, a, act.task);
      if (!t || !plannable(t)) return d;
      const same = d.task === t.id;
      return { ...d, task: t.id, preview: undefined, step: nextAfterTask(s, a, t), slot: undefined, ...(same ? {} : { pick: [], research: undefined }) };
    }
    case 'openSlot':
      return { ...d, slot: act.slot };
    case 'fill': {
      const t = taskFor(s, a, d.task);
      const m = slotsFor(s, a, t).find((x) => x.slot === act.slot);
      const x = itemById(act.item);
      if (!m || !x) return { ...d, slot: undefined };
      const asset = assetOf(s, a);
      const qty = clampQty(x, act.qty ?? slotQty(m, acOf(s, asset), siteOf(s, a)));
      const pick = [...d.pick.filter((l) => l.slot !== m.slot), { item: x.id, qty, slot: m.slot }];
      // keep the slots in the task's order (the Stock step lists them that way)
      const order = slotsFor(s, a, t).map((z) => z.slot);
      pick.sort((p, q) => (p.slot ? order.indexOf(p.slot) : 99) - (q.slot ? order.indexOf(q.slot) : 99));
      const next: Draft = { ...d, pick: pick.slice(0, MAX_LINES), slot: undefined, research: d.research === m.slot ? undefined : d.research };
      return { ...next, step: afterFill(s, a, next) };
    }
    case 'clear':
      return { ...d, pick: d.pick.filter((l) => l.slot !== act.slot), research: d.research === act.slot ? undefined : d.research };
    case 'qty': {
      const l = d.pick[act.index];
      if (!l) return d;
      const pick = d.pick.slice();
      pick[act.index] = { ...l, qty: clampQty(itemById(l.item), act.qty) };
      return { ...d, pick };
    }
    case 'add': {
      const x = itemById(act.item);
      if (!x || d.pick.length >= MAX_LINES) return { ...d, slot: undefined };
      const at = d.pick.findIndex((l) => !l.slot && l.item === x.id);
      const pick = d.pick.slice();
      if (at >= 0) pick[at] = { ...pick[at], qty: clampQty(x, pick[at].qty + (act.qty ?? 1)) };
      else pick.push({ item: x.id, qty: clampQty(x, act.qty ?? 1) });
      return { ...d, pick, slot: undefined };
    }
    case 'remove':
      return { ...d, pick: d.pick.filter((_, i) => i !== act.index) };
    case 'research':
      return { ...d, research: act.slot, pick: act.slot ? d.pick.filter((l) => l.slot !== act.slot) : d.pick, slot: undefined };
  }
}

/** a slot has a line, or was sent to research */
const filled = (d: Pick<Draft, 'pick' | 'research'>, m: MainSlot) => d.pick.some((l) => l.slot === m.slot) || d.research === m.slot;

/**
 * After a slot is filled: on to Stock when the pick is complete, else back to
 * Parts. Complete: every required slot filled (an outdoor cover counts as
 * required: it only shows outdoors) and, at the teaching tiers, the protection
 * the room needs met; a task whose slots are all "if needed" is complete when
 * all of them are filled (the tech can still go on with Check stock).
 */
export function afterFill(s: IslandState, a: Alert, d: Draft): StepKey {
  const t = taskFor(s, a, d.task);
  const slots = slotsFor(s, a, t);
  if (!slots.length) return 'stock';
  const required = slots.filter((m) => !m.optional || m.outdoor);
  if (required.some((m) => !filled(d, m))) return 'parts';
  if (!required.length) return slots.every((m) => filled(d, m)) ? 'stock' : 'parts';
  return protection(s, a, d).unmet ? 'parts' : 'stock';
}

/**
 * The protection a replaced receptacle needs where it sits (210.8(A), 210.12(A),
 * 406.4(D)(3)-(4)), read from the site (derived, shown on Investigate) and the
 * pick: what the room needs, and whether the device or the protection slot
 * gives it. The Materials step highlights the slot at tiers 0-2 while unmet.
 */
export function protection(s: IslandState, a: Alert, d: Pick<Draft, 'task' | 'pick'>): { gfci: boolean; afci: boolean; unmet: boolean; highlight: boolean; words: string } {
  const none = { gfci: false, afci: false, unmet: false, highlight: false, words: '' };
  const t = taskFor(s, a, d.task);
  const site = siteOf(s, a);
  if (!t || !site || !slotsFor(s, a, t).some((m) => m.slot === 'protection')) return none;
  const need = protectionNeeded(site);
  const upG = site.upstream === 'gfci' || site.upstream === 'df';
  const upA = site.upstream === 'afci' || site.upstream === 'df';
  const specs = d.pick.map((l) => itemById(l.item)?.spec ?? {});
  const hasG = upG || specs.some((x) => x.gfci || x.df);
  const hasA = upA || specs.some((x) => x.afci || x.df);
  const gfci = need.gfci && !upG;
  const afci = need.afci && !upA;
  const unmet = (gfci && !hasG) || (afci && !hasA);
  const words = [afci && 'AFCI', gfci && 'GFCI'].filter(Boolean).join(' + ');
  // the protection slot lights up once the device is chosen and still doesn't give it (before that, the note says where it can come from)
  const chosen = slotsFor(s, a, t).every((m) => m.slot === 'protection' || (m.optional && !m.outdoor) || d.pick.some((l) => l.slot === m.slot));
  const teach = tierOf(s, a) <= 2;
  return { gfci, afci, unmet: teach && unmet, highlight: teach && (gfci || afci) && unmet && chosen, words };
}

// ---------------------------------------------------------------------------
// The Parts / Materials step

export type SlotRow = {
  slot: MainSlot;
  /** "Tire × 1", "Wire: L1, L2, N · 3 × 61 ft" */
  label: string;
  /** the line in it, if any (and its index in the pick) */
  line?: PickLine;
  index?: number;
  /** "if needed" */
  optional: boolean;
  /** IPC slot (mech) or catalog slot */
  ipc: boolean;
  /** sent to research */
  research: boolean;
  /** tiers 0-2: the protection this room needs, still missing */
  highlight: boolean;
  /** a take-off: feet per conductor and how many conductors */
  takeoff?: { feet: number; conductors: number };
};

export function slotRows(s: IslandState, a: Alert, d: Draft): SlotRow[] {
  const t = taskFor(s, a, d.task);
  const site = siteOf(s, a);
  const ac = acOf(s, assetOf(s, a));
  const prot = protection(s, a, d);
  return slotsFor(s, a, t).map((m) => {
    const index = d.pick.findIndex((l) => l.slot === m.slot);
    const q = slotQty(m, ac, site);
    const takeoff = m.takeoff ? { feet: Math.ceil((site?.feet ?? 40) * 1.1), conductors: m.takeoff.conductors } : undefined;
    return {
      slot: m,
      label: takeoff ? `${m.label} · ${takeoff.conductors > 1 ? `${takeoff.conductors} × ` : ''}${takeoff.feet} ft` : `${m.label} × ${q}`,
      ...(index >= 0 ? { line: d.pick[index], index } : {}),
      optional: !!m.optional && !m.outdoor,
      ipc: !!m.ata && !!m.tag,
      research: d.research === m.slot,
      highlight: m.slot === 'protection' && prot.highlight,
      ...(takeoff ? { takeoff } : {}),
    };
  });
}

/** the extra lines (Add a line), with their index in the pick */
export const extraLines = (d: Draft) => d.pick.map((l, index) => ({ l, index })).filter((x) => !x.l.slot);

/** a rare job's pre-filled line, or a repair's: nothing to search */
export function fixedLines(s: IslandState, a: Alert, t: Task | undefined): { item: ItemId; qty: number }[] {
  const asset = assetOf(s, a);
  return t?.fixed && asset ? fixedFor(t, asset) : [];
}

/** a line in words: "4 × 066-19600 LINING, HEAVY DUTY (METALLIC)", "183 ft · THHN/THWN-2 Cu, 6 AWG" */
export function lineWords(item: ItemId, qty: number): string {
  const x = itemById(item);
  if (!x) return `${qty} × ${item}`;
  const name = x.trade === 'mech' ? `${x.pn} ${x.nomen}` : x.nomen;
  return x.unit === 'ea' ? `${qty} × ${name}` : `${unitWords(x, qty)} · ${name}`;
}

// ---------------------------------------------------------------------------
// The Stock step

export type Badge = 'ok' | 'short' | 'order' | 'none' | 'owned' | 'tool' | 'toolOrder';

export type StockRow = {
  item: ItemId;
  qty: number;
  /** where the line comes from: the tech's pick (and its slot), the task's own bench stock ("card"), a pre-filled line, a tool */
  from: 'pick' | 'bench' | 'fixed' | 'tool';
  slot?: string;
  /** units this plan can take off the shelf now (a safety plan also counts what it can take from a card that isn't safety work) */
  have: number;
  /** units still to buy (0 when covered) */
  buy: number;
  badge: Badge;
  /** free stock on order and when the first lands */
  onOrder?: { qty: number; eta?: number };
  /** list value of what's still to buy (tools: capex) */
  value: number;
};

/** is the alert safety work (airworthiness, a hazard, a repair, an inspection or code prep): ready past the work budget, first to the shelf */
export function safetyWork(s: IslandState, a: Alert, t: Task | undefined): boolean {
  if (t?.kind === 'inspect100' || t?.kind === 'codeprep' || a.repair) return true;
  const f = alertFlags(s, a);
  return f.aw || f.hazard;
}

/** units a safety plan may take from pending cards that aren't safety work (their soft reservations, 9.2) */
function softFor(s: IslandState, item: ItemId, except?: string): number {
  const res = s.inv?.[item]?.res ?? {};
  let n = 0;
  for (const [id, q] of Object.entries(res)) {
    if (id === except) continue;
    const o = s.orders.find((x) => x.id === id);
    if (o && o.status === 'pending' && o.flow && !isSafetyJob(s, o)) n += q;
  }
  return n;
}

/** the lines a plan draws: the pick (or the pre-filled line), then the task's bench lines, then its tools */
export function planLines(s: IslandState, a: Alert, d: Draft): { item: ItemId; qty: number; from: StockRow['from']; slot?: string }[] {
  const t = taskFor(s, a, d.task);
  if (!t) return [];
  const asset = assetOf(s, a);
  const o = d.order ? s.orders.find((x) => x.id === d.order) : undefined;
  if (o?.flow?.wired) return [];
  const out: { item: ItemId; qty: number; from: StockRow['from']; slot?: string }[] = [];
  if (t.fixed) for (const l of fixedLines(s, a, t)) out.push({ ...l, from: 'fixed' });
  else for (const l of d.pick) if (!(d.research && l.slot === d.research)) out.push({ item: l.item, qty: l.qty, from: 'pick', ...(l.slot ? { slot: l.slot } : {}) });
  for (const l of benchFor(t, acOf(s, asset), asset)) out.push({ ...l, from: 'bench' });
  for (const tool of t.tools) out.push({ item: tool, qty: 1, from: 'tool' });
  return out;
}

/**
 * The Stock step's rows, each with its badge. The shelf holds near-miss stock,
 * so a badge says what's on the shelf, never whether the pick is right.
 * Demand for the same item across rows is counted once (the pick first).
 */
export function stockRows(s: IslandState, a: Alert, d: Draft): StockRow[] {
  const t = taskFor(s, a, d.task);
  const safety = safetyWork(s, a, t);
  const left = new Map<ItemId, number>();
  const pool = (item: ItemId) => {
    if (!left.has(item)) left.set(item, available(s, item) + (d.order ? reservedFor(s, d.order, item) : 0) + (safety ? softFor(s, item, d.order) : 0));
    return left.get(item)!;
  };
  return planLines(s, a, d).map((l) => {
    const x = itemById(l.item);
    if (l.from === 'tool') {
      const has = owned(s, l.item);
      const coming = !has && toolComing(s, l.item);
      const eta = coming ? onOrderFree(s, l.item).eta : undefined;
      return { item: l.item, qty: 1, from: 'tool', have: has ? 1 : 0, buy: has || coming ? 0 : 1, badge: has ? 'owned' : coming ? 'toolOrder' : 'tool', value: has || coming || !x ? 0 : Math.round(priceAt(x, vendorFor(x))), ...(coming ? { onOrder: { qty: 1, ...(eta !== undefined ? { eta } : {}) } } : {}) };
    }
    const avail = pool(l.item);
    const take = Math.min(avail, l.qty);
    left.set(l.item, avail - take);
    const buy = l.qty - take;
    const free = onOrderFree(s, l.item);
    const badge: Badge = buy === 0 ? 'ok' : take > 0 ? 'short' : free.qty > 0 ? 'order' : 'none';
    return {
      item: l.item,
      qty: l.qty,
      from: l.from,
      ...(l.slot ? { slot: l.slot } : {}),
      have: take,
      buy,
      badge,
      ...(free.qty > 0 ? { onOrder: free } : {}),
      // what the card will pay: whole packs (cut-to-length lines by the foot) at the default supplier's price
      value: x && buy > 0 ? Math.round(priceAt(x, vendorFor(x)) * buyUnits(x, buy) * 100) / 100 : 0,
    };
  });
}

// ---------------------------------------------------------------------------
// What Send will come to, and what it dispatches

export type Preview = {
  outcome: 'ready' | 'card' | 'research' | 'reqs' | 'repriced' | 'incomplete';
  /** lines fully on the shelf, lines with something to buy, tools to buy */
  pull: number;
  buy: number;
  tools: number;
  /** labour: the job's (an approved job keeps its labour paid) */
  labour: number;
  safety: boolean;
  budget: { spent: number; of: number };
  /** the summary above Send */
  text: string;
  /** the analyst has ended the turn: a late card goes through tonight on the standing approval (up to the limit) */
  late?: string;
};

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const nameOf = (s: IslandState, r: 'mech' | 'elec' | 'fin') => s.players[r]?.name ?? ROLE_LABEL[r];

/** the standing limit a week (8.5): absent, the two work budgets' sum */
export const standingLimit = (s: IslandState) => s.standing ?? (s.autoBudget.mech ?? 0) + (s.autoBudget.elec ?? 0);

/**
 * The labour the job will carry. A repair's is its defect's (as the engine
 * prices it). A plan's is today's card less the standard parts for the slots
 * the tech has filled: nothing here reads the alert's hidden needs, so the
 * number never says which slots the fault needs.
 */
export function labourOf(s: IslandState, a: Alert, d: Draft): number {
  const t = taskFor(s, a, d.task);
  const asset = assetOf(s, a);
  if (!t || !asset) return 0;
  const o = d.order ? s.orders.find((x) => x.id === d.order) : undefined;
  if (o) return o.approvedWeek !== undefined ? 0 : o.cost;
  if (a.repair) {
    const x = a.repair.defect;
    return repairLabor(s, { cost: x.cost, puzzle: x.puzzle, role: x.role, orderKind: x.rule ?? x.orderKind, variant: x.variant, job: x.job });
  }
  if (!t.kind) return 0;
  const slots = [...new Set(d.pick.map((l) => l.slot).filter((z): z is string => !!z)), ...(d.research ? [d.research] : [])];
  // (a quick check's early catch is priced a tier lower, as the engine prices it: stage 2)
  return laborCost(s, t.kind, t, asset, siteOf(s, a), slots, earlyLess(a));
}

/** Send's summary: what comes off the shelf, what goes on a card, the labour, and what will happen */
export function preview(s: IslandState, a: Alert, d: Draft): Preview {
  const t = taskFor(s, a, d.task);
  const rows = stockRows(s, a, d);
  const role = a.role;
  const safety = safetyWork(s, a, t);
  const labour = labourOf(s, a, d);
  const spent = s.autoSpent[role] ?? 0;
  const of = s.autoBudget[role] ?? 0;
  const parts = rows.filter((r) => r.from !== 'tool');
  const pull = parts.filter((r) => r.buy === 0).length;
  const buy = parts.filter((r) => r.buy > 0).length;
  const tools = rows.filter((r) => r.from === 'tool' && r.buy > 0).length;
  const onHand = buy === 0 && rows.every((r) => r.from !== 'tool' || r.badge === 'owned');
  const fin = nameOf(s, 'fin');
  const base = { pull, buy, tools, labour, safety, budget: { spent, of } };
  const o = d.order ? s.orders.find((x) => x.id === d.order) : undefined;
  // a required slot left empty: nothing to send yet (the start would stop on it)
  const gap = missingSlot(s, a, d);
  if (gap) return { ...base, outcome: 'incomplete', text: `${pickFirstWords(gap)} first: this job needs ${/^[aeiou]/i.test(gap.label) ? 'an' : 'a'} ${lowerFirst(gap.label)}, and none is picked.` };
  // the card's total as the analyst will see it (labour, the lines to buy, the tools, a shipment's freight), and the
  // standing approval's own rule for it: over the limit it waits, unless it's safety work due this week or next
  const bought = rows.reduce((n, r) => n + (r.buy > 0 ? r.value : 0), 0);
  const freight = buy + tools > 0 ? schedFreight(s, rows.filter((r) => r.buy > 0).map((r) => ({ item: r.item }))).cost : 0;
  const total = labour + bought + freight;
  const lateWords = standingWords(s, total, safety, lateSafeAlert(s, a), gridFirstAlert(s, a)) ?? undefined;
  if (d.research) {
    const others = pull + buy ? ` The rest: pull ${pull}${buy ? ` · buy ${buy}` : ''}.` : '';
    return { ...base, outcome: 'research', text: `Not in the IPC: the job waits on the research branch (next, the airplane's logbooks).${others}` };
  }
  if (o && o.approvedWeek !== undefined) {
    if (onHand) return { ...base, outcome: 'ready', text: 'All on hand: ready again (the labour is already paid).' };
    return { ...base, outcome: 'reqs', text: `Pull ${pull} · request ${buy + tools}: the new line${buy + tools > 1 ? 's go' : ' goes'} to ${fin} as a requisition (the labour is already paid).` };
  }
  if (o) return { ...base, outcome: 'repriced', text: `The card for ${fin} is re-priced: pull ${pull}${buy ? ` · buy ${buy}` : ''}${tools ? ` · ${tools} tool${tools > 1 ? 's' : ''}` : ''} · labour ${usd(labour)}.`, ...(lateWords ? { late: lateWords } : {}) };
  const within = spent + labour <= of;
  const cashOk = spendable(s) - labour >= (safety ? 0 : ECON.freezeBelow);
  const recvOk = !(s.receivership > 0 && labour > 300 && !safety);
  if (onHand && (within || safety) && cashOk && recvOk) {
    const text = within
      ? `All on hand: ready now on your work budget (labour ${usd(labour)}, ${usd(spent + labour)} of ${usd(of)} used).`
      : `All on hand: ready now. Safety work may run past the work budget (labour ${usd(labour)}, ${usd(spent + labour)} of ${usd(of)} used).`;
    return { ...base, outcome: 'ready', text };
  }
  let text: string;
  if (onHand && !cashOk) text = `All on hand, but spendable cash is under ${usd(ECON.freezeBelow)}: a labour-only card for ${fin} (${usd(labour)}).`;
  else if (onHand) text = `All on hand, but over your work budget (${usd(spent + labour)} of ${usd(of)}): a labour-only card for ${fin} (${usd(labour)}).`;
  else text = `Pull ${pull} · buy ${buy}${tools ? ` · ${tools} tool${tools > 1 ? 's' : ''}` : ''} · labour ${usd(labour)}${freight ? ` · freight ${usd(freight)}` : ''}: a card for ${fin}, about ${usd(total)} in all.`;
  return { ...base, outcome: 'card', text, ...(lateWords ? { late: lateWords } : {}) };
}

/** what Send dispatches: `plan` for an open alert, `repick` for its job; or why it can't be sent yet */
export function sendAction(s: IslandState, a: Alert, d: Draft): Action | { error: string } {
  const t = taskFor(s, a, d.task);
  if (!t) return { error: a.role === 'elec' ? 'Find the procedure first.' : 'Find the task first.' };
  if (!plannable(t) && !a.repair) return { error: "That's reference only: pick the task that does the work." };
  const gap = missingSlot(s, a, d);
  if (gap) return { error: `${pickFirstWords(gap)} first: this job needs one.` };
  const pick = t.fixed ? [] : d.pick.filter((l) => !(d.research && l.slot === d.research)).map((l) => ({ item: l.item, qty: l.qty, ...(l.slot ? { slot: l.slot } : {}) }));
  const research = d.research ? { research: true } : {};
  if (d.order) return { t: 'repick', role: a.role, order: d.order, pick, ...research };
  return { t: 'plan', role: a.role, alert: a.id, task: t.id, pick, ...research };
}

/** the one-tap Start (an inspection, code prep): what's short on the shelf for its bench lines and tools, if anything */
export function oneTapShort(s: IslandState, a: Alert): StockRow[] {
  const d = newDraft(s, a);
  return stockRows(s, a, d).filter((r) => r.buy > 0);
}

// ---------------------------------------------------------------------------
// What the searches show before anything is typed (the tap counts of 17.2)

/**
 * The Manual / Reference step before anything is typed. Tiers 0-2: the
 * keyword chips from the symptom and the finding, and the tasks they find
 * (tiers 0-1 mark the likely one and put it first). Tier 3+: nothing listed,
 * only the chapter chips and the search bar.
 */
export function manualDefault(s: IslandState, a: Alert): { chips: string[]; chapters: string[]; results: TaskId[]; likely: TaskId[] } {
  const asset = assetOf(s, a);
  if (!asset) return { chips: [], chapters: [], results: [], likely: [] };
  const ix = manualIndex(s, asset, a.role);
  const tier = tierOf(s, a);
  const h = hintsFor(s, a, tier);
  const chapters = ix.chapters.map((c) => c.chapter);
  if (tier >= 3 || !h.chips.length) return { chips: [], chapters, results: [], likely: [] };
  const likely = tier <= 1 ? h.tasks : [];
  const hits = search(ix, h.chips.join(' '), { limit: 12, boost: (doc) => (likely.includes(doc.id) ? 50 : 0) }).map((x) => x.doc.id);
  return { chips: h.chips, chapters, results: hits, likely };
}

/** taps to reach "Use this task" for a task, with nothing typed: its row in the default list and Use (2), or a chip first (3) */
export function manualTaps(s: IslandState, a: Alert, task: TaskId): number {
  const asset = assetOf(s, a);
  if (!asset) return Infinity;
  const ix = manualIndex(s, asset, a.role);
  const m = manualDefault(s, a);
  if (m.results.slice(0, 8).includes(task)) return 2;
  for (const c of m.chips) if (search(ix, c, { limit: 8 }).some((h) => h.doc.id === task)) return 3;
  for (const c of m.chapters) if (search(ix, '', { chapter: c, limit: 20 }).some((h) => h.doc.id === task)) return 3;
  return Infinity;
}

/**
 * A slot's search as it opens: the IPC at the slot's figure (rows in print
 * order, PMA rows and approved ICA rows after them), or the catalog at the
 * slot's category (a trade's tools aren't picked: they come with the task).
 */
export function slotDocs(s: IslandState, a: Alert, m: MainSlot): { chapter: string; docs: Doc[] } {
  const asset = assetOf(s, a);
  if (!asset) return { chapter: '', docs: [] };
  if (m.ata && asset.kind === 'plane') {
    const ix = ipcIndex(s, asset);
    const docs = ix.docs.filter((x) => x.ref.ata === m.ata);
    return { chapter: docs.find((x) => !x.ref.pma && !x.ref.ea)?.chapter ?? docs[0]?.chapter ?? '', docs };
  }
  const trade = a.role === 'elec' ? 'elec' : 'mech';
  const ix = supplyIndex(trade);
  const first = ix.docs.find((x) => itemById(x.ref.item ?? '')?.cat === m.cat);
  const chapter = first?.chapter ?? '';
  return { chapter, docs: ix.docs.filter((x) => x.chapter === chapter && itemById(x.ref.item ?? '')?.kind !== 'tool') };
}

/**
 * Tiers 0-1: the rows a slot's search marks "likely": the alert's standard
 * pick for that slot (the connectors slot marks the connector, not the EMT
 * stick beside it in the same category). No slot (Add a line): every line of
 * the standard pick. Tier 2+: none.
 */
export function likelyItems(s: IslandState, a: Alert, slot?: string): Set<ItemId> {
  const tier = tierOf(s, a);
  if (tier > 1) return new Set();
  const h = hintsFor(s, a, tier);
  const task = h.tasks[0] ? taskById(h.tasks[0]) : undefined;
  if (!h.items.length || !task) return new Set();
  if (slot === undefined) return new Set(h.items);
  return new Set(stdPickFor(s, a, task).filter((l) => l.slot === slot).map((l) => l.item));
}

/** taps to fill a slot with an item, with nothing typed: the slot (1) and its row in the list the slot opens at (1) */
export function slotTaps(s: IslandState, a: Alert, m: MainSlot, item: ItemId): number {
  const { docs } = slotDocs(s, a, m);
  return docs.some((x) => (x.ref.item ?? x.id.split('@')[0]) === item) ? 2 : Infinity;
}

// ---------------------------------------------------------------------------
// Small reads for the screens

/** tier 3+: the last tasks done on this asset (task numbers, never P/Ns: the IPC stays the lookup) */
export function recentTasks(s: IslandState, assetId: string, n = 5): { task: TaskId; no: string; week: number }[] {
  const out: { task: TaskId; no: string; week: number }[] = [];
  const done = s.orders.filter((o) => o.assetId === assetId && o.status === 'done' && o.flow && !o.flow.wired).sort((x, y) => (y.result?.week ?? 0) - (x.result?.week ?? 0));
  for (const o of done) {
    const t = taskById(o.flow!.task);
    if (!t || out.some((x) => x.task === t.id)) continue;
    out.push({ task: t.id, no: t.no, week: o.result?.week ?? 0 });
    if (out.length >= n) break;
  }
  return out;
}

/** the electrical site in a line: "Bathroom · 20 A breaker, 12 AWG NM-B · downstream of a GFCI" */
export function siteWords(site: ElecSite | null, takeoff = false): string {
  if (!site) return '';
  // a take-off is a new circuit: no conductors to read yet (the conductors are the take-off's answer), so the
  // equipment it feeds and the run's length; a repair reads the breaker and the wire that are there
  if (takeoff) {
    if (site.room === 'spa') return `Spa: 240 V, needs a ${site.amps} A GFCI disconnect · pad ${site.feet ?? 40} ft from the panel`;
    if (site.room === 'dock') return `Fuel dock pump: 240 V, ${site.amps} A · ${site.feet ?? 80} ft underground from the panel`;
    if (site.room === 'gen') return `Transfer switch: ${site.amps} A today · the houses back up ${site.load ?? site.amps} A`;
  }
  const room = { bath: 'Bathroom', kitchen: 'Kitchen', bedroom: 'Bedroom', living: 'Living room', laundry: 'Laundry', outdoor: 'Porch (wet location)', hall: 'Hall', panel: 'Distribution panel', spa: 'Spa pad (outdoors)', dock: 'Fuel dock', gen: 'Generator house' }[site.deviceRoom ?? site.room];
  // a non-breaking hyphen: "NM-B" never splits at the end of a line
  const wire = site.run === 'buried' ? 'underground' : site.run === 'nm' ? 'NM\u2011B' : '';
  // the circuit's own equipment when it isn't the room's (the water heater's 2-pole, not the bathroom's)
  const parts = [site.what ?? room, `${site.amps} A ${site.poles === 2 ? '2\u2011pole ' : ''}breaker, ${site.awg} AWG${wire ? ` ${wire}` : ''}`];
  if (site.single) parts.push(`an individual circuit${site.appliance ? ` (the ${site.appliance})` : ''}`);
  if (site.upstream === 'gfci') parts.push('downstream of a GFCI');
  if (site.upstream === 'afci') parts.push('on an AFCI breaker');
  if (site.upstream === 'df') parts.push('on a dual-function breaker');
  if (site.feet) parts.push(`${site.feet} ft run`);
  if (site.load) parts.push(`${site.load} A backed-up load`);
  return parts.join(' · ');
}

/** the service-neutral warning (10): shown at tiers 0-2, where the finding already says it */
export const neutralWarning = (s: IslandState, a: Alert) => tierOf(s, a) <= 2 && !a.looksNff && !!causeOf(a)?.neutral;

/**
 * The teaching tiers' answer for this job's site on a reference entry (17.2:
 * "this circuit: 20 A, 12 AWG, kitchen: DF protection, 20 A TR"). Built from
 * the site (derived from the seed, shown on Investigate) and the code; the
 * Reference step shows it at tiers 0-2 only.
 */
export function siteAnswer(s: IslandState, a: Alert, t: Task): string | undefined {
  const site = siteOf(s, a);
  if (!site) return undefined;
  const room = siteWords({ ...site, feet: undefined, load: undefined }).split(' · ')[0].toLowerCase();
  const tr = `${site.amps} A TR${site.wet || site.room === 'outdoor' ? '/WR under an in-use cover' : ''}`;
  switch (t.id) {
    case 'ref:outlet':
    case 'ref:gfci': {
      const need = protectionNeeded(site);
      const upG = site.upstream === 'gfci' || site.upstream === 'df';
      const upA = site.upstream === 'afci' || site.upstream === 'df';
      const g = need.gfci && !upG;
      const f = need.afci && !upA;
      const prot = g && f ? 'AFCI + GFCI protection (a DF device, or the device and a DF breaker)' : f ? 'AFCI protection (an AFCI receptacle or breaker)' : g ? 'GFCI protection (a GFCI device or breaker)' : upG ? 'no more protection: a GFCI upstream already covers it' : 'no AFCI or GFCI protection';
      return `this circuit: ${site.amps} A, ${site.awg} AWG, ${room}${site.single ? ', an individual circuit: a single receptacle rated for it' : ''}: ${prot}, ${tr}.`;
    }
    case 'ref:spa': {
      const hots = site.amps <= 50 ? 8 : 6;
      const egc = site.amps <= 60 ? 10 : 8;
      const run = Math.ceil((site.feet ?? 40) * 1.1);
      return `this tub: ${site.amps} A, ${site.feet ?? 40} ft: #${hots} THWN-2 for L1, L2 and N, a #${egc} EGC (Table 250.122), ${run} ft of each; a ${site.amps} A spa panel and a 2-pole ${site.amps} A feed; 3/4 in EMT with raintight connectors on the wall; 1 in Sch 40 PVC underground.`;
    }
    case 'ref:3way':
      return `this circuit: ${site.amps} A, ${site.awg} AWG: ${site.awg === 14 ? '14/3' : '12/3'} for the travelers; two 12/3 cables and a device need 20.25 cu in of box.`;
    case 'ref:deadckt':
      return `this circuit: ${site.amps} A, ${site.awg} AWG: if it's the breaker, a 1-pole ${site.amps} A KP breaker (listed for the panel).`;
    case 'ref:feeder':
      return 'four direct-burial splice kits: L1, L2, N and the EGC (split bolts and tape are not listed for burial).';
    case 'ref:ground':
      return 'a 6 AWG bare copper jumper and a listed pipe clamp, bonded to the service (250.104(A)).';
    default:
      return undefined;
  }
}

/**
 * "Research the records" after a stop (the install found the IPC part of an
 * assembly an alteration replaced): the repick sends the job to the research
 * branch, with the rest of the pick and without the displaced line.
 */
export function researchRepick(s: IslandState, o: Order): Action | null {
  if (!o.flow) return null;
  const a = s.alerts?.find((x) => x.id === o.flow!.alert);
  const asset = s.assets.find((x) => x.id === o.assetId);
  const t = a ? taskFor(s, a, o.flow.task) : undefined;
  if (!a || !t || !asset || asset.kind !== 'plane') return null;
  const displaced = (l: PickLine) => {
    const m = t.main.find((x) => x.slot === l.slot);
    return !!m?.ata && !!m.tag && judgeSlot(s, asset, m.ata, m.tag, l.item).why === 'displaced';
  };
  return { t: 'repick', role: a.role, order: o.id, pick: o.flow.pick.filter((l) => !displaced(l)), research: true };
}
