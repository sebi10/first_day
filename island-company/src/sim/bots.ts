// Scripted players for the paper sim (scripts/balance.ts) and tests.
// They call the same reducer as real phones, so balance numbers are real.
import { planeModel, type Ata } from './aircraft';
import { alertFlags, alertTier, causeOf, fixesOf, liveAlerts, needsOf, siteOf, symptomOf } from './alerts';
import { botChainData, islandAircraft, needsFreight, openChain, wrongPn } from './chain';
import { ECON, GSE, STOCK, TIERS } from './data';
import { apply, createIsland, forecastContext } from './engine';
import { cableBand, charterLoad, downtimeOf, expectedDeferralCost, fixedNow, gseCarts, logistic, needsCart, occupancy, startCart, urgency } from './econ';
import { cardOf, judgeSlot, planTask, repairTask, stdPick } from './flow';
import { allItems, buyUnits, itemById, priceAt } from './items';
import { spendable } from './ledger';
import { hashSeed, rng, type Rng } from './rng';
import { botStaff, buildDef } from './staff';
import { available, binsInUse, binsTotal, dueJob, families, insuranceSpare, isSafetyJob, knownDemand, moveClass, needsNewBin, position, stockFlags, suggestRop, urgentJob, velocity } from './stock';
import { tasksFor, type Task } from './tasks';
import { ROLES, type Action, type Alert, type GseCart, type IslandState, type Order, type PickLine, type Role } from './types';

export type Bot = {
  skill: number;
  absent?: boolean;
  naive?: boolean;
  perTurn?: number;
  miss?: number;
  /** skill lost per island tier as jobs get harder */
  tierDrop?: number;
  /** absences come in streaks (holidays, busy weeks), not independent rolls */
  streak?: boolean;
  /** the analyst starts an extra cottage at tier 4 when spendable is over $40,000 (the balance run's `cottages` variant, 20.5) */
  cottages?: boolean;
};
export type Team = Record<Role, Bot>;

const good: Bot = { skill: 0.88 };
export const TEAMS: Record<string, Team> = {
  'all good': { mech: good, elec: good, fin: good },
  'all average': { mech: { skill: 0.72, perTurn: 3, miss: 0.1 }, elec: { skill: 0.72, perTurn: 3, miss: 0.1 }, fin: { skill: 0.72, miss: 0.1 } },
  'naive analyst': { mech: good, elec: good, fin: { skill: 0.8, naive: true } },
  // closest to three real friends: harder jobs cost skill, absences come in runs
  'three friends': {
    mech: { skill: 0.82, tierDrop: 0.05, perTurn: 3, miss: 0.08, streak: true },
    elec: { skill: 0.82, tierDrop: 0.05, perTurn: 3, miss: 0.08, streak: true },
    fin: { skill: 0.82, tierDrop: 0.04, miss: 0.08, streak: true },
  },
  'mech absent': { mech: { skill: 0, absent: true }, elec: good, fin: good },
  'elec absent': { mech: good, elec: { skill: 0, absent: true }, fin: good },
  'fin absent': { mech: good, elec: good, fin: { skill: 0, absent: true } },
  'solo mech': { mech: good, elec: { skill: 0, absent: true }, fin: { skill: 0, absent: true } },
  'solo elec': { mech: { skill: 0, absent: true }, elec: good, fin: { skill: 0, absent: true } },
  'solo fin': { mech: { skill: 0, absent: true }, elec: { skill: 0, absent: true }, fin: good },
  'nobody': { mech: { skill: 0, absent: true }, elec: { skill: 0, absent: true }, fin: { skill: 0, absent: true } },
};

function step(s: IslandState, a: Action, now: number) {
  return apply(s, a, now).s;
}

function score(r: Rng, skill: number) {
  const v = Math.min(1, Math.max(0, skill + r.range(-0.15, 0.15)));
  return v >= 0.95 ? 1 : v;
}

/** Revenue-maximising rate by grid search over the logistic demand curve */
export function bestRates(s: IslandState) {
  let bestN = ECON.baseNightly;
  let bestV = -1;
  for (let n = ECON.baseNightly * ECON.rateFloor; n <= ECON.baseNightly * ECON.rateCap; n += 5) {
    const v = n * occupancy(s, n);
    if (v > bestV) {
      bestV = v;
      bestN = n;
    }
  }
  let bestC = ECON.baseCharter;
  let bestCV = -1;
  for (let c = ECON.baseCharter * ECON.rateFloor; c <= ECON.baseCharter * ECON.rateCap; c += 10) {
    const v = c * charterLoad(s, c);
    if (v > bestCV) {
      bestCV = v;
      bestC = c;
    }
  }
  return { nightly: bestN, charter: bestC };
}

/** The cart a bot would use for a start: as the mechanic picks it (econ startCart). */
const botCart = (s: IslandState, o: Order): GseCart | null => startCart(s, o.assetId);

function playOps(s: IslandState, role: 'mech' | 'elec', bot: Bot, r: Rng, now: number) {
  // the crew backs the analyst's story call (bots agree; people may not)
  if (s.story && !s.story.chosen) s = step(s, { t: 'story', key: s.story.options[s.cash > 12000 ? 0 : 1].key, role }, now);
  for (const o of s.orders.filter((x) => x.role === role && x.status === 'countered')) s = step(s, { t: 'acceptCounter', orderId: o.id }, now);
  const skill0 = bot.skill - (bot.tierDrop ?? 0) * (s.tier - 1);
  if (role === 'mech') {
    // last week's flight-day cart comes back off the plane and onto the charger
    for (const c of gseCarts(s)) if (c.hookedTo) s = step(s, { t: 'gse', role, cart: c.id, op: 'charge' }, now);
    // the ground power cables get a look about once a month. A plug end well inside its band is an easy call
    // (a clean boot, or burnt pins); near the edge of cracked it is right by skill
    for (const c of gseCarts(s)) {
      if (c.inspected && s.week - c.inspected.week < 4) continue;
      const worn = cableBand(c.wear) !== 'good';
      const clear = Math.abs(c.wear - GSE.cracked) >= 10;
      const right = r.chance(clear ? 0.97 : Math.min(0.97, Math.max(0.2, 0.25 + 0.7 * skill0)));
      s = step(s, { t: 'gse', role, cart: c.id, op: 'inspect', call: worn === right ? 'tag' : 'ok' }, now);
    }
  }
  // the job flow: stopped jobs repicked, then every open alert of the trade called and planned (18.1)
  s = flowTurn(s, role, bot, r, now);
  const ready = s.orders.filter((o) => o.role === role && o.status === 'ready').sort((a, b) => urgency(s, b) - urgency(s, a));
  const skill = bot.skill - (bot.tierDrop ?? 0) * (s.tier - 1);
  // a crewmate's report is a favour done on top of the usual jobs (people make time when a friend is stuck);
  // repairs and redos are real jobs and take a slot. A ground power start with no charged cart to hand when
  // its turn comes (an earlier start may have used it up) waits, and the slot goes to the next job.
  const play = (o: (typeof ready)[number]): boolean => {
    // tow a charged cart over for a start or radio work (off the charger, or off a plane that isn't flying;
    // a flat or tagged-out one on that plane goes back on the charger first), and put it back on the charger after
    const cart = needsCart(o.kind) ? botCart(s, o) : null;
    if (needsCart(o.kind) && !cart) return false;
    if (cart && cart.hookedTo !== o.assetId) {
      const on = gseCarts(s).find((c) => c.hookedTo === o.assetId);
      if (on) s = step(s, { t: 'gse', role, cart: on.id, op: 'charge' }, now);
      s = step(s, { t: 'gse', role, cart: cart.id, op: 'hook', assetId: o.assetId! }, now);
    }
    const sc = score(r, skill);
    s = step(s, { t: 'complete', role, orderId: o.id, score: sc, perfect: sc >= 0.95, data: chainData(s, o, skill, r) }, now);
    if (cart) s = step(s, { t: 'gse', role, cart: cart.id, op: 'charge' }, now);
    return true;
  };
  // the electrician's check on a flow alert's unit is a quick meter job a plane is waiting on: done on top, like a report
  for (const o of ready) if (o.kind === 'report' || o.bench) play(o);
  let jobs = 0;
  for (const o of ready) if (o.kind !== 'report' && !o.bench && jobs < (bot.perTurn ?? 4) && play(o)) jobs++;
  // a job that found a part: the IPC lookup comes straight after it, if there's a slot left (the plane is down)
  let extra = Math.max(1, (bot.perTurn ?? 4) - jobs);
  for (let guard = 0; guard < 3 && extra > 0; guard++) {
    const c = openChain(s);
    const o = c?.stepId ? s.orders.find((x) => x.id === c.stepId && x.role === role && x.status === 'ready') : undefined;
    // the electrician's check on an electrical unit
    const b = !o && c?.bench && !c.bench.call ? s.orders.find((x) => x.id === c.bench!.id && x.role === role && x.status === 'ready') : undefined;
    if (!o && !b) break;
    play((o ?? b)!);
    extra--;
  }
  // a flight day on a weak battery: a charged cart goes on that plane before the turn ends
  if (role === 'mech') s = hookFlightDay(s, now);
  return s;
}

/** The weak-battery plane gets the best charged cart hooked up to it (off the charger, or off a plane that isn't flying). */
function hookFlightDay(s: IslandState, now: number): IslandState {
  const wb = s.weakBattery;
  if (!wb || wb.week !== s.week) return s;
  const pick = startCart(s, wb.assetId);
  if (!pick || pick.hookedTo === wb.assetId) return s;
  const on = gseCarts(s).find((c) => c.hookedTo === wb.assetId);
  if (on) s = step(s, { t: 'gse', role: 'mech', cart: on.id, op: 'charge' }, now);
  return step(s, { t: 'gse', role: 'mech', cart: pick.id, op: 'hook', assetId: wb.assetId }, now);
}

/** A part chain's lookup, research or circuit check: what the bot hands in, by its skill (src/sim/chain.ts). */
function chainData(s: IslandState, o: IslandState['orders'][number], skill: number, r: Rng): Record<string, unknown> | undefined {
  const c = openChain(s);
  if (!c || !o.chain || c.id !== o.chain.id || (o.chain.step !== 'lookup' && o.chain.step !== 'research' && o.chain.step !== 'bench')) return undefined;
  const asset = s.assets.find((a) => a.id === c.assetId);
  if (!asset) return undefined;
  return botChainData(islandAircraft(s.seed, asset), c, o.chain.step, skill, r);
}

function playFin(s: IslandState, bot: Bot, r: Rng, now: number) {
  if (!bot.naive) s = step(s, { t: 'setRates', ...bestRates(s) }, now);
  if (s.pendingBonus) s = step(s, { t: 'allocateBonus', choice: 'reserve' }, now);
  if (s.story && !s.story.chosen) s = step(s, { t: 'story', key: s.story.options[s.cash > 12000 ? 0 : 1].key, role: 'fin' }, now);

  const reserve = 1500 + fixedNow(s);
  const pend = s.orders.filter((o) => o.status === 'pending').sort((a, b) => urgency(s, b) - urgency(s, a));
  for (const o of pend) {
    if (bot.naive) {
      s = step(s, { t: 'approve', orderId: o.id }, now);
      continue;
    }
    if (o.flow) {
      s = finCard(s, o, reserve, now);
      continue;
    }
    const asset = s.assets.find((a) => a.id === o.assetId);
    const exp = expectedDeferralCost(s, o).cost;
    // a known defect's repair is safety work: the defect is still in service
    // so is a part for a plane that's down, and engineering's fee to get it approved
    const critical = (asset && asset.health < 70) || o.kind === 'inspect100' || o.kind === 'codeprep' || o.kind === 'repair' || !!o.chain || o.deferrals >= 2;
    const worth = exp >= o.cost * 0.6 || critical;
    // like a person would: cheap safety-critical work gets approved even when cash is tight
    const cheapCritical = critical && o.cost <= 600 && s.cash - o.cost >= ECON.freezeBelow;
    // the part for a grounded plane is what gets the revenue back: find the money. Its freight, when the plane
    // that would carry it is the one down: the AOG boat if a week of downtime costs more than the boat, else the guest flight
    const c = o.chain ? openChain(s) : null;
    const freight = !!c && o.chain!.step === 'buy' && needsFreight(s, c);
    const ship: 'boat' | 'flight' | undefined = freight ? (downtimeOf(s, c!.assetId).usd > ECON.boatKit ? 'boat' : 'flight') : undefined;
    const aog = !!o.chain && s.cash - o.cost - (ship === 'boat' ? ECON.boatKit : 0) >= 0;
    if ((worth && s.cash - o.cost >= reserve) || cheapCritical || aog) s = step(s, { t: 'approve', orderId: o.id, ...(ship ? { ship } : {}) }, now);
    else if (o.lastDeferredWeek !== s.week) s = step(s, { t: 'defer', orderId: o.id, reason: s.cash - o.cost < reserve ? 'cash' : 'priority' }, now);
  }
  const skill = bot.skill - (bot.tierDrop ?? 0) * (s.tier - 1);
  // a crewmate's report first (it costs them every week), then the biggest money hunt
  // (when a report caps the desk, only the first one gets done)
  const tasks = s.orders
    .filter((x) => x.role === 'fin' && x.status === 'ready')
    .sort((a, b) => Number(b.kind === 'report') - Number(a.kind === 'report') || (b.leak ?? 0) - (a.leak ?? 0));
  for (const o of tasks) {
    const sc = score(r, skill);
    if (o.kind === 'auction') {
      // the lot at the broker's price: a good bid wins it under fair, when the cash is there
      const fair = o.lot?.fair ?? (ECON.partMarket.low + ECON.partMarket.high) / 2;
      const bid = Math.round(fair * (1.15 - sc * 0.25));
      const win = sc > 0.5 && !!o.lot && spendable(s) - bid > reserve;
      s = step(s, { t: 'complete', role: 'fin', orderId: o.id, score: sc, perfect: sc >= 0.95, data: { kits: win ? 1 : 0, spent: win ? bid : 0 } }, now);
    } else if (o.kind === 'forecast') {
      const ctx = forecastContext(s);
      const pts = ctx.projection.map((p) => Math.round(p * (1 + r.range(-0.1, 0.1) * (1 - sc))));
      s = step(s, { t: 'complete', role: 'fin', orderId: o.id, score: sc, perfect: sc >= 0.95, data: { points: pts } }, now);
    } else s = step(s, { t: 'complete', role: 'fin', orderId: o.id, score: sc, perfect: sc >= 0.95 }, now);
  }
  // requisitions, needs, the reorder policy (18.2); the staff through D's botStaff
  s = bot.naive ? naiveStock(s, r, now) : finStock(s, reserve, now);
  s = botStaff(s, bot, r, now);
  // the growth project (15.6): refused until the staff update, then the builders' extra cottage
  if (bot.cottages && s.tier >= 4 && spendable(s) > 40000 && !(s.builds ?? []).some((b) => b.id.startsWith('cottage') && b.finished === undefined))
    s = step(s, { t: 'build', what: 'cottage', week: s.week }, now);
  return s;
}

// ---------------------------------------------------------------------------
// The job flow's bots (docs/JOBFLOW.md 18)

const clamp01 = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** the chance a bot gets a call right: its skill, less at the higher alert tiers */
export const hit = (skill: number, alertTier: number) => clamp01(0.55 + 0.45 * skill - 0.08 * Math.max(0, alertTier - 2), 0.3, 0.97);
/**
 * How often a miss turns into a wrong move (tuned, docs/DECISIONS.md "Real job flow · Balance"): the bots stand
 * for players who search, and the search puts a fixing task and the book's line in the top three at tiers 0-2.
 * One roll for the diagnosis and one for the whole pick (a miss swaps one slot for its near-miss), so a job with
 * four slots isn't four times as likely to go wrong as a job with one.
 */
export const BOT_MISS = { task: 0.15, pick: 0.15, nff: 0.1, looksNff: 0.3 };
/** the most the fin bot keeps on the shelf as a first insurance spare (one job's worth), USD */
export const BOT_SPARE_MAX = 400;
const open = (o: Order) => o.status !== 'done' && o.status !== 'cancelled';

/** a near-miss for a slot: the other effectivity's or block's P/N, the IPC part on an altered assembly, the other amperage or protection */
const ELEC_MISS: Record<string, string> = {
  'KDF20-TR': 'KR20-TR',
  'KG20-TR': 'KR20-TR',
  'KG20-TRWR': 'KR20-TRWR',
  'KA15-TR': 'KR15-TR',
  'KR15-TR': 'KR15',
  'KR20S': 'KR15S',
  'KP120DF': 'KP120',
  'KP120AF': 'KP120',
  'KP120GF': 'KP120',
  'WP-INUSE': 'WP-FLIP',
  'NMB-12-3': 'NMB-14-3',
  'SPA-60GF': 'SPA-50GF',
  'KP260': 'KP270',
  'THWN-6': 'THWN-8',
  'THWN-10': 'THWN-12',
  'EMT-C34RT': 'EMT-C34SS',
  'DBS-2': 'SPLIT-4',
  KP120: 'KP115',
};
function nearMiss(s: IslandState, al: Alert, task: Task, l: PickLine): PickLine {
  const asset = s.assets.find((a) => a.id === al.assetId);
  const m = task.main.find((x) => x.slot === l.slot);
  if (asset?.kind === 'plane' && m?.ata && m.tag && m.ata !== '79-20') {
    const pn = wrongPn(islandAircraft(s.seed, asset), m.ata as Ata, m.tag);
    return pn && itemById(pn) ? { ...l, item: pn } : l;
  }
  const alt = ELEC_MISS[l.item];
  return alt && itemById(alt) ? { ...l, item: alt } : l;
}

/** a plausible wrong diagnosis: the fix for another of the symptom's causes, else a task in the same chapter (none: the fix) */
function siblingTask(s: IslandState, al: Alert, fix: Task, r: Rng): Task {
  const asset = s.assets.find((a) => a.id === al.assetId)!;
  const sym = symptomOf(al);
  const others = (sym?.causes ?? [])
    .filter((c) => c.fix && c.kind !== 'wiring')
    .map((c) => planTask(s, al, c.fix!.startsWith('ref:') || c.fix!.startsWith('gsm:') ? c.fix! : `amm:${planeModel(asset.model)}:${c.fix === '05-20' ? (planeModel(asset.model) === 'cargo' ? '05-20-02' : '05-20-01') : c.fix}`))
    .filter((t): t is Task => !!t && t.id !== fix.id && !!t.kind);
  if (others.length) return r.pick(others);
  const same = tasksFor(s, asset, al.role).filter((t) => t.kind && t.kind !== 'gpustart' && t.id !== fix.id && t.chapter === fix.chapter && !t.fixed);
  return same.length ? r.pick(same) : fix;
}

/** the right pick with the bot's hit rate per needed slot (a near-miss otherwise); research on an altered assembly */
function botPick(s: IslandState, al: Alert, task: Task, h: number, r: Rng): { pick: PickLine[]; research: boolean } {
  const asset = s.assets.find((a) => a.id === al.assetId)!;
  if (task.fixed) return { pick: [], research: false };
  const std = stdPick(s, asset, task, siteOf(s, al), needsOf(s, al));
  let research = false;
  // one roll for the pick: a miss swaps one of the slots' lines for its near-miss
  const miss = r.chance((1 - h) * BOT_MISS.pick) ? r.int(0, Math.max(0, std.length - 1)) : -1;
  const pick = std.map((l, i) => {
    const m = task.main.find((x) => x.slot === l.slot);
    // an ICA part with no EA on file: the right move is the research branch
    if (asset.kind === 'plane' && m?.ata && m.tag && judgeSlot(s, asset, m.ata, m.tag, l.item).unapproved && r.chance(h)) research = true;
    return i === miss ? nearMiss(s, al, task, l) : l;
  });
  return { pick, research };
}

/**
 * A tech bot's flow turn (18.1): stopped jobs repicked; hazards made safe and
 * MEL items placarded when their fix needs a line not on hand; a bench alert
 * gets the electrician's check; then every open alert planned (due first),
 * with the right task and pick at the bot's hit rate.
 */
function flowTurn(s: IslandState, role: 'mech' | 'elec', bot: Bot, r: Rng, now: number): IslandState {
  if (s.turns[role]?.ended) return s;
  const skill = bot.skill - (bot.tierDrop ?? 0) * (s.tier - 1);
  // a stopped job: repicked with the right pick (research when the part is an altered assembly's)
  for (const o of s.orders.filter((x) => x.role === role && x.flow?.stop && open(x) && !x.flow.wired)) {
    const al = liveAlerts(s).find((a) => a.id === o.flow!.alert);
    const task = al ? planTask(s, al, o.flow!.task) : undefined;
    if (!al || !task) continue;
    const asset = s.assets.find((a) => a.id === al.assetId)!;
    const pick = task.fixed ? [] : stdPick(s, asset, task, siteOf(s, al), needsOf(s, al));
    s = step(s, { t: 'repick', role, order: o.id, pick, ...(o.flow!.stopResearch ? { research: true } : {}), week: s.week }, now);
  }
  const alerts = liveAlerts(s)
    .filter((a) => a.role === role)
    .sort((a, b) => a.due - b.due || (a.id < b.id ? -1 : 1));
  for (const a0 of alerts) {
    const al = liveAlerts(s).find((x) => x.id === a0.id);
    if (!al) continue;
    const asset = s.assets.find((x) => x.id === al.assetId);
    if (!asset) continue;
    const f = alertFlags(s, al);
    const h = hit(skill, alertTier(s, al, role));
    const fix = al.repair ? repairTask(s, al) : fixesOf(s, al)[0] ? planTask(s, al, fixesOf(s, al)[0]) : undefined;
    const needsBuy = !!fix && !fix.fixed && stdPick(s, asset, fix, siteOf(s, al), needsOf(s, al)).some((l) => available(s, l.item) < l.qty);
    // the calls first
    if (role === 'elec' && f.hazard && !al.safe) {
      if (causeOf(al)?.neutral) {
        // a service neutral: leave the house closed (right with the bot's hit rate), else the branch breaker
        if (!r.chance(h)) s = step(s, { t: 'makeSafe', role, alert: al.id, how: 'breaker', week: s.week }, now);
      } else s = step(s, { t: 'makeSafe', role, alert: al.id, how: 'breaker', week: s.week }, now);
    }
    if (role === 'mech' && f.mel === 'C' && !al.mel && needsBuy && al.status !== 'closed') s = step(s, { t: 'mel', role: 'mech', alert: al.id, week: s.week }, now);
    const cur = liveAlerts(s).find((x) => x.id === al.id);
    if (!cur || cur.status !== 'open') continue;
    // a bench alert: the electrician's check when that seat is held. At the teaching tiers the finding says which it is
    // in plain words ("It's the unit."), and a player reads it: the unit is planned at once, the wiring goes to the electrician
    if (role === 'mech' && f.bench && !cur.bench?.call) {
      if (cur.bench?.order) continue;
      const plain = alertTier(s, cur, role) <= 2;
      if (s.players.elec && (!plain || causeOf(cur)?.kind === 'wiring')) {
        s = step(s, { t: 'askBench', role: 'mech', alert: cur.id, week: s.week }, now);
        continue;
      }
    }
    const nff = cur.cause < 0;
    const closable = !cur.repair && !['due', 'ad', 'code', 'takeoff'].includes(cur.src) && !symptomOf(cur)?.writeUp;
    if (nff && closable) {
      if (r.chance(h)) {
        s = step(s, { t: 'nff', role, alert: cur.id, week: s.week }, now);
        continue;
      }
      // replaced on suspicion: the most common cause's task
      const sym = symptomOf(cur)!;
      const top = [...sym.causes].filter((c) => c.fix).sort((a, b) => b.w - a.w)[0];
      const t = top ? planTask(s, cur, top.fix!.startsWith('ref:') || top.fix!.startsWith('gsm:') ? top.fix! : `amm:${planeModel(asset.model)}:${top.fix === '05-20' ? (planeModel(asset.model) === 'cargo' ? '05-20-02' : '05-20-01') : top.fix}`) : undefined;
      if (!t || !t.kind) continue;
      const pick = t.fixed ? [] : stdPick(s, asset, t, siteOf(s, cur), top.needs ?? []);
      s = step(s, { t: 'plan', role, alert: cur.id, task: t.id, pick, week: s.week }, now);
      continue;
    }
    // a real fault wrongly closed as nothing (more often when the finding hides it)
    if (!nff && closable && cur.kind !== 'wiring' && r.chance((1 - h) * (cur.looksNff ? BOT_MISS.looksNff : BOT_MISS.nff))) {
      s = step(s, { t: 'nff', role, alert: cur.id, week: s.week }, now);
      continue;
    }
    if (!fix) {
      // the wiring with nobody to meter it: the unit, as the symptom reads
      const unit = symptomOf(cur)?.causes.find((c) => c.kind !== 'wiring' && c.fix);
      const t = unit ? planTask(s, cur, `amm:${planeModel(asset.model)}:${unit.fix}`) : undefined;
      if (!t) continue;
      s = step(s, { t: 'plan', role, alert: cur.id, task: t.id, pick: stdPick(s, asset, t, null, unit!.needs ?? []), week: s.week }, now);
      continue;
    }
    // a due item, an AD, a code notice, a take-off or a write-up names its task: nothing to diagnose
    const task = cur.repair || cur.task || !r.chance((1 - h) * BOT_MISS.task) ? fix : siblingTask(s, cur, fix, r);
    const { pick, research } = task === fix ? botPick(s, cur, task, h, r) : { pick: task.fixed ? [] : stdPick(s, asset, task, siteOf(s, cur), task.main.filter((m) => !m.optional).map((m) => m.slot)), research: false };
    s = step(s, { t: 'plan', role, alert: cur.id, task: task.id, pick, ...(research ? { research: true } : {}), week: s.week }, now);
  }
  return s;
}

/** a flow card by the fin bot's rule (18.2): approve when waiting costs at least 0.6 x the card or it is critical, keeping the reserve; default freight */
function finCard(s: IslandState, o: Order, reserve: number, now: number): IslandState {
  const card = cardOf(s, o);
  const asset = s.assets.find((a) => a.id === o.assetId);
  const exp = expectedDeferralCost(s, o).cost + (card.aog || card.restricted || card.shut ? (card.downtime?.usd ?? 0) : 0);
  const urgent = dueJob(s, o);
  const critical = urgent || isSafetyJob(s, o) || o.kind === 'inspect100' || o.kind === 'codeprep' || (asset && asset.health < 70) || o.deferrals >= 2;
  const worth = exp >= card.total * 0.6 || critical;
  const room = spendable(s) - card.total;
  if ((worth && room >= reserve) || (critical && room >= ECON.freezeBelow) || (urgent && room >= 0)) return step(s, { t: 'approve', orderId: o.id, buy: { freight: card.freight.pick }, week: s.week }, now);
  if (o.lastDeferredWeek !== s.week) return step(s, { t: 'defer', orderId: o.id, reason: room < reserve ? 'cash' : 'priority', week: s.week }, now);
  return s;
}

/** an item drawn at a sign-off in the ledger's weeks */
const usedItem = (s: IslandState, id: string) => (s.ledger ?? []).some((r) => (r.use?.[id] ?? 0) > 0);

/** the fin bot's stock (18.2): requisitions, needs, the order flags, min/max from use, dead stock, the builders' materials */
function finStock(s: IslandState, reserve: number, now: number): IslandState {
  // requisitions: a grounding job's at once, a tool a job needs always, the rest keeping the reserve
  for (const q of (s.reqs ?? []).filter((x) => x.status === 'open')) {
    const x = itemById(q.item);
    const o = q.order ? s.orders.find((y) => y.id === q.order) : undefined;
    const cost = x ? x.price * Math.ceil(q.qty / Math.max(1, x.cut ? 1 : x.pack)) : 0;
    const urgent = !!o && urgentJob(s, o);
    if (urgent || (x?.kind === 'tool' && o) || spendable(s) - cost >= reserve) s = step(s, { t: 'approveReq', reqs: [q.id], week: s.week }, now);
  }
  // an MEL placard running out (this week, or at the last resolve) on a plane whose fix isn't ready: the one extension
  for (const a of liveAlerts(s).filter((x) => x.mel && !x.mel.ext && (x.mel.until === s.week || x.mel.until === s.week - 1))) {
    const o = a.order ? s.orders.find((y) => y.id === a.order) : undefined;
    if (!o || o.status !== 'ready') s = step(s, { t: 'melExtend', alert: a.id, week: s.week }, now);
  }
  // nudge the unplanned airworthiness and hazard alerts due within a week
  for (const a of liveAlerts(s).filter((x) => x.status === 'open' && x.due <= s.week + 1 && x.nudged !== s.week)) {
    const f = alertFlags(s, a);
    if (f.aw || f.hazard) s = step(s, { t: 'nudge', alert: a.id, week: s.week }, now);
  }
  // the order flags, urgent first, each through its one-tap action (a stock buy up to the suggestion, whole packs, scheduled).
  // A card goes by the card rule above; a job's requisition is approved (it is what the job waits on)
  const flags = stockFlags(s).filter((f) => f.kind === 'order' && f.act && f.act.t !== 'approve');
  for (const f of flags.slice(0, 6)) {
    if (f.act!.t === 'approveReq') {
      if (spendable(s) > ECON.freezeBelow) s = step(s, { ...f.act!, week: s.week } as Action, now);
      continue;
    }
    if (spendable(s) < reserve) break;
    if (f.item && needsNewBin(s, f.item) && binsInUse(s) >= binsTotal(s)) continue;
    const l = f.item ? s.inv?.[f.item] : undefined;
    // up to the line's max from where its position stands (what's on order counts)
    const want = l?.max !== undefined ? Math.max(1, l.max - Math.max(0, position(s, f.item!))) : 1;
    if (f.item) s = step(s, { t: 'buy', lines: [{ item: f.item, qty: want }], week: s.week }, now);
  }
  // min/max from use once a family has 3 uses (at most 6 changes a turn); insurance spares keep one job's worth
  let changed = 0;
  for (const fam of families(s)) {
    if (changed >= 6) break;
    const v = velocity(s, fam.fam);
    const uses = v.series.reduce((a, b) => a + b, 0);
    const spare = insuranceSpare(s, fam.fam);
    if (uses < 3 && !spare) continue;
    for (const id of fam.items) {
      const l = s.inv?.[id];
      // only a line that moved: the family's other P/Ns (the near-miss beside it on the shelf) get no min/max
      if (!usedItem(s, id)) continue;
      if (spare && uses < 3) {
        // an insurance spare the island has needed once: one job's worth on the shelf, reordered when it's drawn.
        // Not a rotable worth hundreds (a radio, an alternator): the placard and a lead-1 order cover those
        const worth = fam.fam.startsWith('lining') ? 4 : 1;
        const x = itemById(id);
        if (!x || worth * priceAt(x) > BOT_SPARE_MAX) continue;
        if (l?.rop === 0 && l.max === worth) continue;
        if (needsNewBin(s, id) && binsInUse(s) >= binsTotal(s)) continue;
        s = step(s, { t: 'setStock', item: id, rop: 0, max: worth, week: s.week }, now);
        if (++changed >= 6) break;
        continue;
      }
      if (!l || l.on <= 0) continue;
      const sug = suggestRop(s, id);
      if (sug.max <= 0 || sug.rop >= sug.max) continue;
      if (l.rop !== undefined && Math.abs(l.rop - sug.rop) < 2 && Math.abs((l.max ?? 0) - sug.max) < 2) continue;
      if (needsNewBin(s, id) && binsInUse(s) >= binsTotal(s)) continue;
      s = step(s, { t: 'setStock', item: id, rop: sug.rop, max: sug.max, week: s.week }, now);
      if (++changed >= 6) break;
    }
  }
  // dead stock worth $100 or more that isn't an insurance spare and nobody needs goes back to the vendor
  for (const fam of families(s)) {
    if (moveClass(s, fam.fam) !== 'dead' || insuranceSpare(s, fam.fam)) continue;
    for (const id of fam.items) {
      const free = available(s, id);
      const x = itemById(id);
      if (!x || free <= 0 || knownDemand(s, id).length) continue;
      if (free * (s.inv?.[id]?.avg ?? x.price / x.pack) < 100) continue;
      s = step(s, { t: 'scrap', item: id, qty: free, week: s.week }, now);
    }
  }
  // the builders' next two units
  s = buyBuildUnits(s, 2, now);
  return s;
}

/**
 * The open build's next units' materials, when they aren't on the shelf or on order, once the
 * builders are at it (they have drawn a unit, or stood idle for want of one): a build nobody works
 * on (the staff stubs) never ties up cash in the yard.
 */
function buyBuildUnits(s: IslandState, units: number, now: number): IslandState {
  const b = (s.builds ?? []).find((x) => x.finished === undefined);
  const def = b ? buildDef(b.id) : undefined;
  if (!b || !def || !((b.drawn ?? 0) > 0 || (b.idle ?? 0) > 0)) return s;
  const from = Math.floor(b.drawn ?? 0);
  const need = new Map<string, number>();
  for (const u of def.units.slice(from, from + units)) for (const [id, q] of Object.entries(u)) need.set(id, (need.get(id) ?? 0) + (q ?? 0));
  const lines: { item: string; qty: number }[] = [];
  for (const [id, q] of need) {
    const onOrder = (s.pos ?? []).filter((p) => p.status === 'open' || p.status === 'held').reduce((n, p) => n + p.lines.filter((l) => l.item === id && l.got === undefined).reduce((m, l) => m + l.qty, 0), 0);
    const short = q - available(s, id) - onOrder;
    if (short > 0) lines.push({ item: id, qty: short });
  }
  if (!lines.length || spendable(s) < ECON.freezeBelow + 500) return s;
  return step(s, { t: 'buy', lines, week: s.week }, now);
}

/** the naive analyst (18.2): never sets a min/max, buys 3 random items of its trades a week while spendable is over $8,000, never nudges */
function naiveStock(s: IslandState, r: Rng, now: number): IslandState {
  for (const q of (s.reqs ?? []).filter((x) => x.status === 'open')) s = step(s, { t: 'approveReq', reqs: [q.id], week: s.week }, now);
  if (spendable(s) > 8000) {
    const pool = allItems().filter((x) => (x.trade === 'mech' || x.trade === 'elec') && x.kind !== 'tool' && x.price <= 400);
    for (let i = 0; i < 3; i++) {
      if (binsInUse(s) >= binsTotal(s)) break;
      const x = r.pick(pool);
      s = step(s, { t: 'buy', lines: [{ item: x.id, qty: buyUnits(x, 1) }], week: s.week }, now);
    }
  }
  // the builders get materials only when they're idle
  const b = (s.builds ?? []).find((x) => x.finished === undefined);
  if (b && (b.idle ?? 0) > 0) s = buyBuildUnits(s, 1, now);
  void STOCK;
  void TIERS;
  return s;
}

/** One seat's turn as a bot plays it: the sim's week loop, and tests that start from an island they set up. */
export function botTurn(s: IslandState, role: Role, bot: Bot, r: Rng, now: number) {
  return role === 'fin' ? playFin(s, bot, r, now) : playOps(s, role, bot, r, now);
}

export type SimWeek = {
  week: number;
  tier: number;
  grade: string;
  revenue: number;
  cash: number;
  incidents: number;
  /** of which: hidden defects that surfaced */
  defects: number;
  flights: string;
  houses: string;
};

/** `salt` re-rolls the crew's weeks (who shows up, how each job goes) for robustness checks; '' is the standard run. */
export function simulate(team: Team, weeks: number, seed: number, trace?: (s: IslandState) => void, salt = '') {
  let now = Date.UTC(2026, 8, 1, 12);
  let s = createIsland({ id: `sim-${seed}`, name: 'Sim Island', now, tz: 'Europe/Paris', seed: hashSeed('sim', seed), creator: { uid: 'u-mech', name: 'M', role: 'mech' } });
  s = step(s, { t: 'join', uid: 'u-elec', name: 'E', role: 'elec' }, now);
  s = step(s, { t: 'join', uid: 'u-fin', name: 'F', role: 'fin' }, now);
  for (const role of ROLES) s = step(s, { t: 'week0Done', role }, now);
  // Who shows up (and in what order) has its own stream, and each seat's week of
  // play has its own stream too: a rule that adds or removes a job shifts only
  // that seat's week, never the whole run's absences, so before/after balance
  // runs compare the same crew weeks.
  const away = rng(hashSeed('bots-away', seed, salt));
  const awayLast: Record<Role, boolean> = { mech: false, elec: false, fin: false };
  const out: SimWeek[] = [];
  let minCash = s.cash;
  for (let w = 0; w < weeks; w++) {
    const week = s.week;
    const order = away.shuffle([...ROLES]);
    for (const role of order) {
      const bot = team[role];
      const missed = bot.absent || (bot.miss ? away.chance(bot.streak && awayLast[role] ? 0.5 : bot.miss) : false);
      awayLast[role] = !!missed;
      if (missed) continue;
      s = botTurn(s, role, bot, rng(hashSeed('bots', seed, salt, role, week)), now);
      s = step(s, { t: 'endTurn', role }, now);
      // each seat plays at its own time (a card that comes in after the analyst ended the turn goes through on the standing approval)
      now += 60_000;
    }
    if (s.week === week) {
      now = (s.deadline ?? now) + 1000;
      s = step(s, { t: 'resolve', week }, now);
    } else now += 86400_000;
    const h = s.history[s.history.length - 1];
    trace?.(s);
    minCash = Math.min(minCash, h.cashEnd);
    out.push({
      week: h.week,
      tier: h.tier,
      grade: h.grade,
      revenue: h.revenue,
      cash: h.cashEnd,
      incidents: h.incidents.length,
      defects: h.incidents.filter((i) => i.kind === 'defect').length,
      flights: `${h.flightsFlown}/${h.flightsScheduled}`,
      houses: `${h.housesBooked}/${h.housesRentable}`,
    });
  }
  return { weeks: out, final: s, minCash };
}

export { logistic };
