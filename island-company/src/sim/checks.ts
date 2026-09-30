// Quick checks and Report a problem (docs/EXPANSION.md 6.4, 6.5; stage 2).
//
// A quick check reads the asset's UPCOMING wear: the catalog kinds about to be
// drawn for it (in scope for the check, weight > 0, nothing of the kind open on
// the asset). It never reads s.defects: pillar 3 stays whole, a blind job's
// mistake still surfaces later, never as a check a day later. The top kind shows
// its tell in one zone with a chance that grows with the wear depth; every other
// zone shows a benign sign. Tells and benign signs come from seeded pools of
// look-alike phrasings, so reading them is the skill, not a lookup.
//
// A right call and a wrong call raise the same write-up row (`K_…` in
// checkdata.ts), so nothing on screen says which it was until Investigate: a
// right call carries the kind's cause (its job one order tier easier, a week
// sooner: `early`), a wrong call a no-fault cause that holds a slot until it's
// closed on site. The engine's `check` and `flag` moves (engine.ts) call these.
//
// `checkTruth` is for the sim only (the engine, the bots). UI code never imports
// it: tests/check.test.ts guards that.
import { planeModel } from './aircraft';
import { drawWeight, fits, flagSource, installedHome, liveAlerts, nameMid, pairsFor, raiseAlert, siteOf, slotKind, soleGuest, SYMPTOMS, type Symptom } from './alerts';
import {
  CHECK_ROWS,
  checkRowKey,
  FEEDS,
  genPanel,
  GEN_TELL_ZONE,
  GEN_UPGRADE,
  GFCI_OK,
  GFCI_TELL,
  HOUSE_CIRCUITS,
  IR,
  IR_DAY_OFF,
  IR_SCOPE,
  METER,
  METER_SCOPE,
  SERVICE_ID,
  WALK_BENIGN,
  WALK_BENIGN_TURBINE,
  WALK_SCOPE,
  WALK_ZONES,
  type CheckKind,
  type IrBreaker,
  type WalkZone,
} from './checkdata';
import { CATALOG, CATALOG_BY_KIND, DEFECT, MODELS, REPORT, ROLE_LABEL, type CatalogEntry } from './data';
import { genUpgraded, houseRentable, powered, renovating } from './econ';
import { hashSeed, rng, type Rng } from './rng';
import { pilotOf } from './staff';
import type { Alert, Asset, IslandState, OpsRole, ReportLine, Role } from './types';

export type { CheckKind };

/** tune (docs/EXPANSION.md 6.4, 11.3): the tell's chance is detect x clamp((wearFrom - health) / depth, minShow, 1); checks open at fromTier */
export const CHECK = { detect: 0.5, depth: 10, minShow: 0.3, fromTier: DEFECT.blindFromTier };

export interface CheckItem {
  id: string;
  /** 'R main', 'Hangar 60 A · #6 Cu', 'Kitchen counter A (30 ft)' */
  label: string;
  /** what the tech sees: a tell and a benign sign read alike */
  text: string;
  reading?: { riseC?: number; loadPct?: number; amps?: number; volts?: number; runFt?: number; tooLight?: boolean; peakAmps?: number };
}
export interface CheckView {
  kind: CheckKind;
  assetId: string;
  items: CheckItem[];
  help: string[];
  /** the IR scan's opening line */
  ppe?: string;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const r1 = (v: number) => Math.round(v * 10) / 10;
const openOrder = (o: IslandState['orders'][number]) => o.status !== 'done' && o.status !== 'cancelled';
const nameOf = (s: IslandState, r: Role) => s.players[r]?.name ?? ROLE_LABEL[r];

/** which check a seat makes on an asset: the mechanic walks around planes and the generator; the electrician IR-scans the grid and the generator's transfer switch, and meter-checks houses */
export function checkKindFor(s: IslandState, role: OpsRole, a: Asset): CheckKind | null {
  void s;
  if (role === 'mech') return a.kind === 'plane' || a.kind === 'generator' ? 'walkaround' : null;
  if (role === 'elec') return a.kind === 'house' ? 'meter' : a.kind === 'grid' || a.kind === 'generator' ? 'ir' : null;
  return null;
}

/** whether the seat can make its quick check on the asset now (one a week, from tier 2, its turn open), or why not */
export function canCheck(s: IslandState, role: OpsRole, assetId: string): { ok: true } | { ok: false; why: string } {
  if (role !== 'mech' && role !== 'elec') return { ok: false, why: 'Only the techs make quick checks.' };
  if (s.week < 1) return { ok: false, why: 'The week has not started yet.' };
  if (s.tier < CHECK.fromTier) return { ok: false, why: `Quick checks open at tier ${CHECK.fromTier}.` };
  if (s.turns[role]?.ended) return { ok: false, why: 'Your turn is over for this week.' };
  if (s.checked?.[role] === s.week) return { ok: false, why: 'One quick check a week: yours is done. Next week.' };
  const a = s.assets.find((x) => x.id === assetId);
  if (!a) return { ok: false, why: 'No such asset.' };
  if (!checkKindFor(s, role, a)) return { ok: false, why: role === 'mech' ? 'The walkaround is for the planes and the generator.' : 'The IR scan is for the grid and the generator; the meter check for the houses.' };
  // (a house closed for its renovation has nothing in service to read: its final covers the electrical side)
  if (a.kind === 'house' && renovating(s, a.id)) return { ok: false, why: `${a.name} is closed for its renovation: nothing in service to meter until its final.` };
  // nothing energized, nothing to read (review round 3: a dark island's meter read a normal 120 V under load, a down
  // grid's panel its usual afternoon, an unreliable set a normal test run)
  const pw = powered(s);
  if (role === 'elec' && a.kind === 'house' && !pw.on) return { ok: false, why: `${a.name} has no power (the grid is down${s.assets.some((x) => x.kind === 'generator') ? " and the generator can't carry it" : ''}): nothing to meter under load.` };
  if (role === 'elec' && a.kind === 'grid' && pw.gridDown) return { ok: false, why: "The utility feed is down: nothing on the island panel is energized to scan. Scan it when it's back." };
  if (role === 'elec' && a.kind === 'generator' && a.health < 50) return { ok: false, why: "The weekly test run failed to pick up the load (the set is under 50): nothing loaded to scan." };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The wear that is coming

const wearMemo = new Map<string, number | null>();
/** the health below which a kind's weight is non-zero: the catalog's `wearFrom`, else read off its weight function */
export function wearFromOf(kind: string): number | null {
  const c = CATALOG_BY_KIND[kind] as CatalogEntry | undefined;
  if (!c) return null;
  if (c.wearFrom !== undefined) return c.wearFrom;
  if (wearMemo.has(kind)) return wearMemo.get(kind)!;
  const model = c.targets[0];
  const probe: Asset = { id: 'probe', kind: MODELS[model]?.kind ?? 'plane', model, name: '', health: 100, touchedWeek: 0 };
  let h = 101;
  while (h > 0 && c.weight({ ...probe, health: h - 1 }, 1) === 0) h--;
  const v = h === 0 || h > 100 ? null : h;
  wearMemo.set(kind, v);
  return v;
}

function scopeOf(ck: CheckKind): Record<string, unknown> {
  return ck === 'walkaround' ? WALK_SCOPE : ck === 'ir' ? IR_SCOPE : METER_SCOPE;
}

/**
 * the alerts and jobs a week's tell reads as "open on the asset": as they stood when the week opened (review round 3).
 * A crewmate's flag or a check write-up raised this week (and a job planned from one) doesn't count, and an alert or a
 * job closed this week still does, so the tell holds all week whatever the crew does meanwhile: a flag on the same plane
 * moved it in 29% of same-week pairs, and the tech's call on what he saw landed as a no-fault write-up, silently
 */
function weekOpen(s: IslandState, W: number) {
  const fresh = (x: Alert) => x.week === W && (x.src === 'flag' || x.src === 'check');
  const alerts = (s.alerts ?? []).filter((x) => !fresh(x) && (x.status !== 'closed' || x.closed?.week === W));
  const skip = new Set((s.alerts ?? []).filter(fresh).map((x) => x.id));
  const orders = s.orders.filter((o) => !(o.flow && skip.has(o.flow.alert)) && (openOrder(o) || (o.status === 'done' && o.result?.week === W)));
  return { alerts, orders };
}

/** what the check could show on this asset: in-scope kinds with weight now, nothing of the kind open on it (catalog order) */
function candidates(s: IslandState, a: Asset, ck: CheckKind, W: number): { c: CatalogEntry; w: number; from: number }[] {
  const scope = scopeOf(ck);
  const wk = weekOpen(s, W);
  const live = wk.alerts;
  const out: { c: CatalogEntry; w: number; from: number }[] = [];
  for (const c of CATALOG) {
    if (!(c.kind in scope) || !c.targets.includes(a.model)) continue;
    const w = drawWeight(s, c, a, W);
    const from = wearFromOf(c.kind);
    if (!(w > 0) || from === null) continue;
    // a late tell (the engine's oil and cylinders) shows only once it's well under way
    if (ck === 'walkaround' && WALK_SCOPE[c.kind].late && a.health > from - CHECK.depth) continue;
    if (wk.orders.some((o) => o.kind === c.kind && o.assetId === a.id)) continue;
    if (live.some((x) => x.assetId === a.id && slotKind(x) === c.kind)) continue;
    // a tell needs somewhere to show on this asset
    if (ck === 'walkaround' && !walkTells(a, c.kind).length) continue;
    if (ck === 'ir' && !irTargets(s, a, c.kind).length) continue;
    out.push({ c, w, from });
  }
  return out;
}

type Tell = { item: string; kind: string; cause: number; text?: string };

/** the walkaround's tell variants for a kind on this airframe: [zone, variant index] */
function walkTells(a: Asset, kind: string): { zone: WalkZone; v: number }[] {
  const sc = WALK_SCOPE[kind];
  if (!sc) return [];
  const model = a.kind === 'plane' ? planeModel(a.model) : null;
  const zones = WALK_ZONES[model ?? 'gen'].map((z) => z.id).filter((z) => sc.zones.includes(z));
  const out: { zone: WalkZone; v: number }[] = [];
  sc.tells.forEach((t, v) => {
    if (model && t.cause.models && !t.cause.models.includes(model)) return;
    if (kind === 'genService') {
      if (zones.includes(GEN_TELL_ZONE[v])) out.push({ zone: GEN_TELL_ZONE[v], v });
      return;
    }
    for (const zone of zones) out.push({ zone, v });
  });
  return out;
}

/** the generator house's schedule as installed: the set's 60 A switch, a transfer job's (Asset.xfer), or the Resort's 200 A */
export const genSchedule = (s: IslandState): IrBreaker[] => genPanel(genUpgraded(s), s.assets.find((a) => a.kind === 'generator')?.xfer).filter((b) => b.from <= Math.max(1, s.tier));
/** the island panel's schedule as installed at this tier (a panel upgrade's 600 A main, the transfer-switch feed as its switch is) */
export const homeSchedule = (s: IslandState): IrBreaker[] => installedHome(s).filter((b) => b.from <= Math.max(1, s.tier));
const panelOf = (s: IslandState, a: Asset): IrBreaker[] => (a.kind === 'generator' ? genSchedule(s) : homeSchedule(s));

/**
 * the share of a feeder's houses open this week (review round 3: a feeder carried 50-86 A to houses that were all
 * closed and empty); 1 for a branch that isn't a house feeder. The builders' extra cottages are on the west feeder
 */
export function feedShare(s: IslandState, id: string): number {
  const fed = FEEDS[id];
  if (!fed) return 1;
  const listed = new Set(Object.values(FEEDS).flat());
  const houses = s.assets.filter((h) => h.kind === 'house' && (fed.includes(h.id) || (id === 'cfeedW' && !listed.has(h.id))));
  return houses.length ? houses.filter((h) => houseRentable(s, h)).length / houses.length : 0;
}

/**
 * The backed-up load this week (A at 240 V): what the transfer switch carries. Review round 2: the generator's weekly test
 * run, the island panel's transfer-switch feed and the take-off to upsize the switch each had a number of their own
 * (37 A on the feed against 106 A through the Resort's switch; "137 A on the 60 A switch" against 28 A on the test run).
 * Now one load: with the old switch's take-off open, the load it quotes (over the 60 A rating: that's the tell); after a
 * transfer job, that load still, through its new switch (review round 3); else a share of the standby set's rating (the
 * old 60 A set, or the Resort's 200 A one), seeded by the week. `amps` is what the switch and its feed carry on the
 * utility (the island panel's scan), `test` what the set carries on its weekly test run (the generator's scan and its
 * fuel): the same, but where load management holds the set to its rating. `rating`: the switch's. null: no standby set
 * yet (tier 3)
 */
export function backedUp(s: IslandState, W = s.week): { amps: number; rating: number; test: number; over: boolean } | null {
  const gen = s.assets.find((a) => a.kind === 'generator');
  if (!gen || s.tier < 3) return null;
  const up = genUpgraded(s);
  // the standby set's rating (the old 60 A set, or the Resort's 200 A one) and the switch's (a transfer job's: Asset.xfer)
  const set = up ? GEN_UPGRADE.amps : 60;
  const rating = up ? GEN_UPGRADE.amps : (gen.xfer?.amps ?? 60);
  const pct = rng(hashSeed(s.seed, 'backedup', W)).range(IR.backedUp[0], IR.backedUp[1]);
  if (!up && !gen.xfer) {
    const take = liveAlerts(s).find((x) => x.assetId === gen.id && x.sym === 'E_TAKEOFF_XFER');
    const load = take ? siteOf(s, take)?.load : undefined;
    if (load) return { amps: load, rating, test: load, over: load > rating };
  }
  // review round 3: after a transfer job the houses still back up what its take-off quoted, through the new switch and
  // its feed on the utility (load management sizes the set, never the switch: round 2's scan read the load halved); on
  // the weekly test run the load management holds the 60 A set to 80-95% of its rating
  if (!up && gen.xfer?.load) {
    const amps = Math.round(gen.xfer.load * (0.94 + ((pct - IR.backedUp[0]) / (IR.backedUp[1] - IR.backedUp[0])) * 0.1));
    const test = Math.min(amps, Math.round(set * rng(hashSeed(s.seed, 'shed', W)).range(0.8, 0.95)));
    return { amps, rating, test, over: amps > rating };
  }
  const amps = Math.round((pct / 100) * set);
  return { amps, rating, test: amps, over: false };
}
function irTargets(s: IslandState, a: Asset, kind: string): IrBreaker[] {
  const on = IR_SCOPE[kind]?.on;
  const panel = panelOf(s, a);
  if (a.kind === 'generator') return on === 'xfer' ? panel.filter((b) => b.id === 'xferG' || b.id === 'xferL') : [];
  // the main's tell (over 80% continuous) only where the feeders under it can carry that much (review round 3: at tiers
  // 1-2 the feeder breakers total less than a 400 A main's 80%)
  if (on === 'main') return mainCanRun(panel) ? panel.filter((b) => b.id === 'main') : [];
  if (on === 'branch') return panel.filter((b) => b.id !== 'main' && !IR_DAY_OFF.includes(b.id));
  return [];
}
/** the feeders under the main (the day loads, each under its 80% line) can carry the main's tell: from tier 4 on the 400 A main */
const mainCanRun = (panel: IrBreaker[]) => {
  const main = panel.find((b) => b.id === 'main');
  const feeders = panel.filter((b) => b.id !== 'main' && !IR_DAY_OFF.includes(b.id)).reduce((n, b) => n + b.amps, 0);
  return !!main && 0.79 * feeders >= (IR.panelUp[0] / 100) * main.amps;
};
const circuitsOf = (a: Asset) => HOUSE_CIRCUITS.filter((c) => !c.models || c.models.includes(a.model));
const runOf = (s: IslandState, a: Asset, id: string, run: [number, number]) => rng(hashSeed(s.seed, 'run', a.id, id)).int(run[0], run[1]);

/** the index of the row's cause that a tell fills */
function causeIndex(key: string, kind: string, fix?: string): number {
  const sym = SYMPTOMS[key];
  return sym ? sym.causes.findIndex((c) => c.kind === kind && (!fix || c.fix === fix)) : -1;
}

/** the top candidate and whether its tell shows this week, and where (the sim's truth: never shown) */
function tellOf(s: IslandState, a: Asset, ck: CheckKind, W: number): Tell | null {
  const cands = candidates(s, a, ck, W);
  if (!cands.length) return null;
  // the kind that's coming, drawn as the week's draw would weigh it (seeded per asset and week, so the view holds all
  // week). Tuned (T7, docs/DECISIONS.md "Airline network"): the spec's "highest weight" surfaced the heaviest kinds (a
  // panel upgrade, a spar, a wheel half) every week and cost the target crews a week of pacing
  const top = rng(hashSeed(s.seed, 'tellkind', a.id, W)).weighted(cands, (x) => x.w) ?? cands[0];
  const p = CHECK.detect * clamp((top.from - a.health) / CHECK.depth, CHECK.minShow, 1);
  if (!rng(hashSeed(s.seed, 'tell', a.id, W)).chance(p)) return null;
  const r = rng(hashSeed(s.seed, 'tellat', a.id, W));
  const kind = top.c.kind;
  if (ck === 'walkaround') {
    const opts = walkTells(a, kind);
    const at = r.pick(opts);
    const t = WALK_SCOPE[kind].tells[at.v];
    const key = checkRowKey('walkaround', at.zone);
    return { item: at.zone, kind, cause: causeIndex(key, kind, t.cause.fix), text: pickSeeded(s, a, at.zone, W, t.texts) };
  }
  if (ck === 'ir') {
    const b = r.pick(irTargets(s, a, kind));
    // a hot lug on a feeder whose houses are all closed carries nothing to show it (review round 3)
    if (a.kind === 'grid' && feedShare(s, b.id) === 0) return null;
    return { item: b.id, kind, cause: causeIndex(checkRowKey('ir', b.id), kind) };
  }
  const on = METER_SCOPE[kind].on;
  if (on === 'service') return { item: SERVICE_ID, kind, cause: causeIndex(checkRowKey('meter', SERVICE_ID), kind) };
  const pool = circuitsOf(a).filter((c) => (on === 'gfci' ? c.gfci : runOf(s, a, c.id, c.run) < METER.tripRunUnder));
  if (!pool.length) return null;
  const c = r.pick(pool);
  return { item: c.id, kind, cause: causeIndex(checkRowKey('meter', c.id), kind) };
}

/** a phrasing from a pool, seeded by the asset, the zone and the week (the words change week to week) */
function pickSeeded(s: IslandState, a: Asset, zone: string, W: number, pool: string[]): string {
  return rng(hashSeed(s.seed, a.id, zone, W)).pick(pool);
}

/** sim only: the item that shows the tell this week and its kind, or null (nothing coming, or it doesn't show yet) */
export function checkTruth(s: IslandState, role: OpsRole, assetId: string, week: number): { item: string; kind: string } | null {
  const a = s.assets.find((x) => x.id === assetId);
  const ck = a ? checkKindFor(s, role, a) : null;
  if (!a || !ck) return null;
  const t = tellOf(s, a, ck, week);
  return t && t.cause >= 0 ? { item: t.item, kind: t.kind } : null;
}

// ---------------------------------------------------------------------------
// The view: what the tech sees, every zone / breaker / circuit in one view

const WALK_HELP = [
  'Circle the whole aircraft: every zone is in this one view.',
  "Write up what you wouldn't sign for. An early sign and a normal one can read alike: judge what you see.",
  "Out of a walkaround's reach: the prop's torque and safety wire, the electrics, the load sheet and the records (the 100-hr finds those).",
];
const GEN_WALK_HELP = ['Walk round the set with it shut down and locked out: the mounts, the belt, the exhaust, the enclosure.', "Write up what you'd service now. Its transfer switch and weekly test are the electrician's."];
const IR_HELP = [
  `NFPA 70B: scan at 40% of the rated load or more. A reading under ${IR.tooLight}% is marked too light to judge.`,
  "Read heat against load: a healthy termination's rise over ambient grows with the square of its load, about +5 °C at half load, +11 °C at three quarters and +20 °C at full. A loose lug runs hot for its load (I²R).",
  'NETA: ΔT against similar components under similar load, 4–15 °C probable, over 15 °C a major deficiency.',
  "A branch's reading is its load at the moment of the scan: judge it by its heat for that load. The main is read for its load over the afternoon: over 80% of its rating continuous (three hours or more) means plan the upgrade (NEC 230.42(A): service conductors at 125% of the continuous load).",
  "Over 100% of its rating is an overload, not a bad termination: it runs hot for its rating and right for its load. The fix is the load or the equipment, never the lug.",
  "The transfer-switch feed carries the backed-up load on the utility: the current the generator carries on its weekly test run, or more where load management holds the set to its rating.",
  "The main carries what the branches carry together: its afternoon continuous a little under their sum, its peak at or over it. A feeder carries what its houses draw: light when they're closed.",
  'The runway edge lights are a night load: off in an afternoon scan.',
];
const GEN_IR_HELP = [
  "Scanned during the weekly test run, the set carrying the backed-up load (what the island panel's transfer-switch feed carries on the utility, or less where load management holds the set to its rating): the generator-side lugs, the load-side lugs and the generator main carry the same current, so compare them: healthy, they read within a degree or two.",
  'Over 100% of the rating is an overload: the load outgrew the switch and the set. Hot for the rating, right for the load: the fix is the load, not a lug.',
  "Read heat against load: a healthy termination's rise over ambient grows with the square of its load, about +5 °C at half load and +20 °C at full.",
  'NETA: ΔT against similar components under similar load, 4–15 °C probable, over 15 °C a major deficiency.',
];
const METER_HELP = [
  'Each receptacle read with a 12 A load plugged in.',
  'Expected drop: 2 × run × 12 A × ohms per 1,000 ft (NEC Chapter 9 Table 8, solid copper at 75 °C: 12 AWG 1.93, 14 AWG 3.07): about 4.6 V on 100 ft of 12 AWG.',
  "A receptacle reads its leg at the panel under the load (L1 with the 12 A on) less its own run's drop: never more than the leg that feeds it.",
  'The 3% guideline is 3.6 V at 120 V (NEC 210.19(A) informational note). It is a design guide: a long run that reads what its length predicts is as built, not a fault.',
  'Both service legs should read about the same under load. One sagging while the other rises is a loose neutral, and then every receptacle under its load sags by the same extra volts, whatever its run.',
  'A GFCI must open on its test button (210.8).',
];
export const IR_PPE = 'Dead front off: arc-rated PPE per NFPA 70E.';

/** the check's view on this asset this week (null: not this seat's check). Derived from the asset's wear, the catalog, the seed and the week: never s.defects */
export function checkView(s: IslandState, role: OpsRole, assetId: string, week = s.week): CheckView | null {
  const a = s.assets.find((x) => x.id === assetId);
  const ck = a ? checkKindFor(s, role, a) : null;
  if (!a || !ck) return null;
  const tell = tellOf(s, a, ck, week);
  if (ck === 'walkaround') return walkView(s, a, week, tell);
  if (ck === 'ir') return irView(s, a, week, tell);
  return meterView(s, a, week, tell);
}

function walkView(s: IslandState, a: Asset, W: number, tell: Tell | null): CheckView {
  const zones = WALK_ZONES[a.kind === 'plane' ? planeModel(a.model) : 'gen'];
  const items = zones.map((z) => ({
    id: z.id,
    label: z.label,
    text: tell && tell.item === z.id && tell.text ? tell.text : pickSeeded(s, a, z.id, W, (a.kind === 'plane' && planeModel(a.model) === 'cargo' ? WALK_BENIGN_TURBINE[z.id] : undefined) ?? WALK_BENIGN[z.id]),
  }));
  return { kind: 'walkaround', assetId: a.id, items, help: a.kind === 'plane' ? WALK_HELP : GEN_WALK_HELP };
}

const expRise = (pct: number) => IR.riseFull * (pct / 100) ** 2;

function irView(s: IslandState, a: Asset, W: number, tell: Tell | null): CheckView {
  const panel = panelOf(s, a);
  const items: CheckItem[] = [];
  const bu = backedUp(s, W);
  if (a.kind === 'generator') {
    // the weekly test run: the set carries the backed-up load through the generator-side and load-side lugs alike (the
    // island panel's transfer-switch feed carries it on the utility: backedUp, review round 2; with load management the
    // set carries no more than its rating, review round 3)
    const r = rng(hashSeed(s.seed, 'ir', a.id, 'test', W));
    const amps = bu?.test ?? 0;
    // one current through every loaded termination: one shared offset (the room, the camera), then a little each
    const shared = r.range(-IR.genShared, IR.genShared);
    for (const b of panel) {
      const rb = rng(hashSeed(s.seed, 'ir', a.id, b.id, W));
      const open = b.id === 'xferU';
      const bAmps = open ? 0 : amps;
      const pct = Math.round((100 * bAmps) / b.amps);
      const rise = open
        ? r1(rb.range(0, 1))
        : tell?.item === b.id
          ? r1(expRise(pct) + shared + rb.range(IR.tell[0], IR.tell[1]))
          : r1(Math.max(0.5, expRise(pct) + shared + rb.range(-IR.genEach, IR.genEach)));
      items.push(irItem(b, bAmps, pct, rise));
    }
    return { kind: 'ir', assetId: a.id, items, help: GEN_IR_HELP, ppe: IR_PPE };
  }
  // The island panel (review round 3: the feeders carried more than the main they hang off, 401 A under a 164 A main).
  // Every branch's load at the moment of the scan first, a house feeder's following its open houses; the main is read
  // from them: its afternoon continuous about their sum less a little diversity, its peak at or over that sum. When the
  // main's tell (over 80% continuous) is drawn, the day's branches run up towards it; else they're scaled down to keep
  // the main under its 70% line. The main's peak is never under what the branches carry together
  // one look-alike a scan: a branch at 70-79% load, reading 10-13 °C: warm, and right for its load (never the
  // transfer-switch feed: its load is the week's backed-up load; never a feeder whose houses are all closed)
  const branches = panel.filter((b) => b.id !== 'main' && b.id !== 'xfer' && b.id !== tell?.item && !IR_DAY_OFF.includes(b.id) && feedShare(s, b.id) > 0);
  const distractor = branches.length ? rng(hashSeed(s.seed, 'irx', a.id, W)).pick(branches).id : null;
  // one offset for the scan (the ambient, the camera), then a little each (review round 2: ±3 each read like breakers
  // at the same load 4 °C and more apart)
  const shared = rng(hashSeed(s.seed, 'ir', a.id, 'scan', W)).range(-IR.genShared, IR.genShared);
  const each = (rb: Rng) => shared + rb.range(-IR.genEach, IR.genEach);
  type Row = { b: IrBreaker; rb: Rng; amps: number; fixed: boolean; kind: 'off' | 'tell' | 'look' | 'xfer' | 'free' };
  const rows: Row[] = [];
  for (const b of panel) {
    if (b.id === 'main') continue;
    const rb = rng(hashSeed(s.seed, 'ir', a.id, b.id, W));
    // a load drawn in a band of the rating, in whole amps that still read inside the band
    const band = (lo: number, hi: number) => clamp(Math.round((rb.range(lo, hi) / 100) * b.amps), Math.ceil((lo / 100) * b.amps), Math.floor((hi / 100) * b.amps));
    if (IR_DAY_OFF.includes(b.id)) rows.push({ b, rb, amps: band(0, 3), fixed: true, kind: 'off' });
    else if (b.id === 'xfer' && bu) rows.push({ b, rb, amps: bu.amps, fixed: true, kind: tell?.item === b.id ? 'tell' : 'xfer' });
    else if (tell?.item === b.id) rows.push({ b, rb, amps: band(IR.tellLoad[0], IR.tellLoad[1]), fixed: true, kind: 'tell' });
    else if (b.id === distractor) rows.push({ b, rb, amps: band(IR.distractorLoad[0], IR.distractorLoad[1]), fixed: true, kind: 'look' });
    else {
      // a house feeder carries its open houses' load, and a trickle for the closed ones (fridges, standby)
      const share = feedShare(s, b.id);
      const trickle = rb.range(3, 8);
      rows.push({ b, rb, amps: Math.round(((share * rb.range(12, 76) + (1 - share) * trickle) / 100) * b.amps), fixed: false, kind: 'free' });
    }
  }
  const main = panel.find((b) => b.id === 'main')!;
  const rm = rng(hashSeed(s.seed, 'ir', a.id, 'main', W));
  const sum = () => rows.reduce((n, x) => n + x.amps, 0);
  const fixedSum = () => rows.filter((x) => x.fixed).reduce((n, x) => n + x.amps, 0);
  /** scale the free branches so the branches together carry `to` A (each between a trickle and 79% of its rating: no branch reads over the 80% line, review round 1) */
  const fit = (to: number) => {
    const free = rows.filter((x) => !x.fixed);
    const fs = free.reduce((n, x) => n + x.amps, 0);
    if (!fs) return;
    const k = Math.max(0, to - fixedSum()) / fs;
    for (const x of free) x.amps = Math.max(Math.round(0.02 * x.b.amps), Math.min(Math.floor(0.79 * x.b.amps), Math.round(x.amps * k)));
  };
  let cont: number;
  let peakA: number;
  if (tell?.item === 'main') {
    cont = Math.round(rm.range(IR.panelUp[0], IR.panelUp[1]));
    const contA = (cont / 100) * main.amps;
    // the scan's afternoon sits near the logged continuous load: the day's branches run up towards it
    fit(contA * rm.range(0.92, 1));
    peakA = Math.max(sum(), contA * (1 + rm.range(0.02, 0.05)));
  } else {
    const d = rm.range(0.85, 0.97);
    // under the 80% line with room: scaled down to 70% continuous at most (a fixed load alone may take it to 79%)
    const cap = Math.max(0.7 * main.amps, Math.min(0.79 * main.amps, fixedSum() * d)) / d;
    if (sum() > cap) fit(cap);
    cont = Math.round((100 * sum() * d) / main.amps);
    peakA = sum() * rm.range(1.03, 1.15);
  }
  const contAmps = Math.round((cont / 100) * main.amps);
  const peak = Math.min(99, Math.max(cont + 1, Math.ceil((100 * peakA) / main.amps)));
  const mainRise = r1(Math.max(0.5, expRise(cont) + each(rm)));
  // (a light island's main, a third of its rating, is too light to judge by the help's own NFPA 70B line)
  const mainLight = cont < IR.tooLight;
  items.push({
    id: main.id,
    label: `${main.label} ${main.amps} A · ${main.awg}`,
    text: `${contAmps} A continuous (${cont}%), peak ${peak}% · +${mainRise} °C over ambient${mainLight ? ' · too light to judge' : ''}`,
    reading: { riseC: mainRise, loadPct: cont, amps: contAmps, peakAmps: Math.round((peak / 100) * main.amps), ...(mainLight ? { tooLight: true } : {}) },
  });
  for (const x of rows) {
    const pct = Math.round((100 * x.amps) / x.b.amps);
    let rise: number;
    if (x.kind === 'off') rise = r1(x.rb.range(0, 0.6));
    else if (x.kind === 'tell') rise = r1(expRise(pct) + shared + x.rb.range(IR.tell[0], IR.tell[1]));
    else if (x.kind === 'look') rise = r1(clamp(expRise(pct) + each(x.rb), IR.distractorRise[0], IR.distractorRise[1]));
    else rise = r1(Math.max(0.5, expRise(pct) + each(x.rb)));
    items.push(irItem(x.b, x.amps, pct, rise));
  }
  return { kind: 'ir', assetId: a.id, items, help: IR_HELP, ppe: IR_PPE };
}

function irItem(b: IrBreaker, amps: number, pct: number, rise: number): CheckItem {
  const tooLight = pct < IR.tooLight;
  return {
    id: b.id,
    label: `${b.label} ${b.amps} A · ${b.awg}`,
    text: `${amps} A (${pct}%) · +${rise} °C over ambient${tooLight ? ' · too light to judge' : ''}`,
    reading: { riseC: rise, loadPct: pct, amps, ...(tooLight ? { tooLight: true } : {}) },
  };
}

function meterView(s: IslandState, a: Asset, W: number, tell: Tell | null): CheckView {
  const r = rng(hashSeed(s.seed, 'meter', a.id, W));
  const source = r.range(121, 123.5);
  const items: CheckItem[] = [];
  const loose = tell?.item === SERVICE_ID;
  const l1 = r1(loose ? r.range(METER.flickerLow[0], METER.flickerLow[1]) : source - r.range(0.3, 2.2));
  const l2 = r1(loose ? r.range(METER.flickerHigh[0], METER.flickerHigh[1]) : source - r.range(0, 1.6));
  // Each receptacle is read under its own 12 A load: its leg at the panel under that load (L1's reading: the same 12 A)
  // less its run's drop (review round 2: read from the source, a receptacle downstream read above the leg feeding it in
  // two clean checks in three). A loose service neutral (review round 1) sags the loaded leg, so every receptacle sags
  // with it
  for (const c of circuitsOf(a)) {
    const rc = rng(hashSeed(s.seed, 'meter', a.id, c.id, W));
    const run = runOf(s, a, c.id, c.run);
    const expected = (2 * run * METER.load * METER.ohms[c.awg]) / 1000;
    const drop = tell?.item === c.id && tell.kind === 'trip' ? expected + rc.range(METER.tripExtra[0], METER.tripExtra[1]) : Math.max(0, expected + rc.range(-0.2, 0.2));
    const volts = r1(l1 - drop);
    const gfci = c.gfci ? ` · ${pickSeeded(s, a, c.id, W, tell?.item === c.id && tell.kind === 'gfci' ? GFCI_TELL : GFCI_OK)}` : '';
    items.push({
      id: c.id,
      label: `${c.label} (${run} ft)`,
      text: `${volts.toFixed(1)} V with 12 A on · ${c.amps} A, ${c.awg} AWG${gfci}`,
      reading: { volts, runFt: run, amps: METER.load },
    });
  }
  items.push({ id: SERVICE_ID, label: 'Service at the panel (L1 / L2)', text: `L1 ${l1.toFixed(1)} V · L2 ${l2.toFixed(1)} V with the 12 A load on L1`, reading: { volts: l1, amps: METER.load } });
  return { kind: 'meter', assetId: a.id, items, help: METER_HELP };
}

// ---------------------------------------------------------------------------
// The call (the engine's `check` move)

/** "walked around Twin N-12", "IR-scanned the island grid", "meter-checked Cottage 1" */
export function checkDid(kind: CheckKind, a: Pick<Asset, 'name' | 'kind'>): string {
  const n = nameMid(a);
  return kind === 'walkaround' ? `walked around ${n}` : kind === 'ir' ? `IR-scanned ${n}` : `meter-checked ${n}`;
}

/**
 * The write-up a call raises (6.4): the item's row, right call or wrong, due the row's lead + 1 week. A right call
 * carries the tell's cause and `early`; a wrong call a no-fault cause (it holds a slot until it's closed on site).
 */
export function raiseCheckWriteUp(s: IslandState, role: OpsRole, a: Asset, kind: CheckKind, item: string, who: string, now: number): Alert {
  const key = checkRowKey(kind, item);
  const sym = SYMPTOMS[key];
  const truth = tellOf(s, a, kind, s.week);
  const right = !!truth && truth.item === item && truth.cause >= 0;
  const r = rng(hashSeed(s.seed, 'checkup', role, a.id, s.week));
  const due = s.week + r.int(sym.lead[0], sym.lead[1]) + 1;
  const al = raiseAlert(s, { role, asset: a, sym: key, cause: right ? truth!.cause : -1, src: 'check', due, who }, now);
  if (right) al.early = true;
  return al;
}

/** the row key a check item writes up */
export { checkRowKey };

// ---------------------------------------------------------------------------
// Report a problem (6.5)

/**
 * the sources a layperson's report can come from (a guest's complaint, a pilot's squawk, a utility or test log: the
 * flagger passes it on, in its own source's name), the kinds it never names, and the rows nobody but a tech could have
 * read (a dead circuit's "breaker on, no voltage at the load" is a meter reading: review round 1)
 */
export const FLAG = {
  srcs: ['guest', 'squawk', 'utility'] as string[],
  never: ['wb', 'inspect100', 'codeprep', 'gpustart'],
  neverSym: ['E_DEAD_CIRCUIT'] as string[],
  /** a flag's due week, at the soonest (review round 3: every flag; a flagged airworthiness squawk grounds its plane from it; a flagged hazard closes its house at once, review round 2) */
  awLead: 1,
};

/** the trade whose work the asset is (the generator: both techs'; stage 2's twin of objects.ts ownerOf) */
const ownerKind = (a: Asset): OpsRole | 'both' => (a.kind === 'plane' ? 'mech' : a.kind === 'generator' ? 'both' : 'elec');

/** a trade's flaggable kinds on the asset, weighted: weight x (1 + (100 - health) / 40), each with its layperson symptom pairs */
function flagKinds(s: IslandState, to: OpsRole, a: Asset, W: number) {
  const sole = a.kind === 'plane' && soleGuest(s, a.id);
  const live = liveAlerts(s);
  const out: { kind: string; w: number; pairs: { sym: Symptom; cause: number; w: number }[] }[] = [];
  for (const c of CATALOG) {
    if (c.role !== to || !c.targets.includes(a.model) || FLAG.never.includes(c.kind)) continue;
    const w = drawWeight(s, c, a, W);
    if (!(w > 0)) continue;
    if (s.orders.some((o) => openOrder(o) && o.kind === c.kind && o.assetId === a.id)) continue;
    if (live.some((x) => x.assetId === a.id && slotKind(x) === c.kind)) continue;
    // (review round 3: never a symptom already live on the asset: E_FEEDER_DROP is both the feeder's and the xfmr's, and a
    // flag raised the utility's own open line a second time)
    const pairs = pairsFor(c.kind, a, sole, s).filter((p) => p.sym.role === to && FLAG.srcs.includes(p.sym.src) && !FLAG.neverSym.includes(p.sym.key) && !live.some((x) => x.assetId === a.id && x.sym === p.sym.key));
    if (pairs.length) out.push({ kind: c.kind, w: w * (1 + (100 - a.health) / 40), pairs });
  }
  return out;
}

/**
 * A trade's list as every seat sees it (Your move, the sheets): its workable jobs and its open alerts, real or not
 * (which is which stays hidden until Investigate), against the week's draw's target (5 open from tier 3, else 4).
 * Review round 3: a flag fits only under the target (flagCheck), so it takes a slot the week's draw would have filled
 * and never lands on top (a crew flagging every week slowed its island by weeks: the flags pulled wear forward on top
 * of the draw). The draw counts no more than this (a stage-1 no-fault alert takes no slot there), so a list under the
 * target here is under it for the draw too, and a refusal never says which of the alerts are real.
 */
export function openWork(s: IslandState, role: OpsRole): { open: number; target: number } {
  const workable = s.orders.filter((o) => o.role === role && openOrder(o) && o.status !== 'waiting_part').length;
  const alerts = (s.alerts ?? []).filter((a) => a.role === role && a.status === 'open').length;
  return { open: workable + alerts, target: s.tier >= 3 ? 5 : 4 };
}

/** a flag's flagger was the analyst (its seat, or on a doc without it, its name) */
const byFin = (s: IslandState, x: Alert) => (x.by ? x.by === 'fin' : x.who === nameOf(s, 'fin'));
/**
 * a trade already has this week's flag from this side: one from a tech and one from the analyst (review round 1: a
 * tech-to-tech flag used to lock the analyst out, and once each tech had flagged the other she could report nothing)
 */
const flaggedFrom = (s: IslandState, to: OpsRole, fin: boolean) => (s.alerts ?? []).some((x) => x.src === 'flag' && x.role === to && x.week === s.week && byFin(s, x) === fin);

/**
 * who receives a flag on this asset: its trade. The generator is both techs' (only the analyst flags it): the tech
 * who already has it on their list (an open alert on it, as every seat's sheet shows it), else the mechanic (the
 * engine is what a passer-by sees and hears), or the electrician when the mechanic already has this week's flag.
 * Only what the flagger can see decides it, never what is coming (the wear, an alert's hidden cause): the sheet
 * names the receiver before the flag, and it must not tell the analyst which trade's wear is ahead.
 */
export function flagTo(s: IslandState, a: Asset): OpsRole {
  const own = ownerKind(a);
  if (own !== 'both') return own;
  const on = (r: OpsRole) => liveAlerts(s).some((x) => x.assetId === a.id && x.role === r);
  const m = on('mech');
  const e = on('elec');
  if (m !== e) return m ? 'mech' : 'elec';
  // only the analyst flags the generator: the tie-break reads her side's cap (review round 2: a tech-to-tech flag on a
  // plane sent her generator report to the electrician though the mechanic had none from her)
  return flaggedFrom(s, 'mech', true) && !flaggedFrom(s, 'elec', true) ? 'elec' : 'mech';
}

/** whether the seat can flag the asset now (from week 3, one a week, one received per trade from each side, only under the trade's open-work target, never its own trade's, never a house closed for its renovation), and to whom */
export function flagCheck(s: IslandState, role: Role, assetId: string): { ok: true; to: OpsRole } | { ok: false; why: string } {
  if (s.week < REPORT.fromWeek) return { ok: false, why: `Report a problem opens in week ${REPORT.fromWeek}.` };
  if (s.turns[role]?.ended) return { ok: false, why: 'Your turn is over for this week.' };
  if (s.flagged?.[role] === s.week) return { ok: false, why: 'One report a week: yours is used. Message them instead.' };
  const a = s.assets.find((x) => x.id === assetId);
  if (!a) return { ok: false, why: 'No such asset.' };
  const own = ownerKind(a);
  if (role !== 'fin' && own === 'both') return { ok: false, why: "The generator is both techs': write it up instead." };
  if (role === own) return { ok: false, why: "It's your trade's: write it up instead." };
  if (a.kind === 'house' && renovating(s, a.id)) return { ok: false, why: `${a.name} is closed for its renovation: nobody's in it to report anything.` };
  const to = flagTo(s, a);
  if (flaggedFrom(s, to, role === 'fin')) return { ok: false, why: `${nameOf(s, to)} already has a flag from ${role === 'fin' ? 'you' : 'a crewmate'} this week: message ${nameOf(s, to)} instead.` };
  // a flag takes a slot, never adds one (review round 3): a full list gets a message, and a report once it's worked down
  const w = openWork(s, to);
  if (w.open >= w.target) return { ok: false, why: `${nameOf(s, to)}'s list is full (${w.open} open): a report now would be work on top. Message ${nameOf(s, to)} instead, or report it once the list is worked down.` };
  return { ok: true, to };
}

/**
 * What a flag raises (6.5): a symptom a layperson could see or be told (a guest's, a pilot's squawk, a utility log) of
 * a kind with weight on the asset, weighted as the week's draw; nothing coming (a healthy asset): a no-fault write-up of
 * such a symptom, which holds a slot until it's closed (as a quick check's wrong call does: review round 3) and costs
 * the owner a close. A flag never names a load sheet, a 100-hr or code
 * prep. The no-fault pool never holds a hazard (review round 1: a flagged hazard on a sound house read as a real one
 * and closed it that night). Rows with no no-fault finding of their own stay in it (the generator's are all such, and
 * an empty pool would tell the analyst nothing's coming): they read "could not duplicate" at Investigate.
 */
export function flagPick(s: IslandState, role: Role, a: Asset, to: OpsRole, W = s.week): { sym: string; cause: number } | null {
  const r = rng(hashSeed(s.seed, 'flag', role, a.id, W));
  const kinds = flagKinds(s, to, a, W);
  const k = r.weighted(kinds, (x) => x.w);
  if (k) {
    const p = r.weighted(k.pairs, (x) => x.w) ?? k.pairs[0];
    return { sym: p.sym.key, cause: p.cause };
  }
  const sole = a.kind === 'plane' && soleGuest(s, a.id);
  const live = liveAlerts(s);
  const pool = Object.values(SYMPTOMS).filter(
    (x) =>
      x.role === to &&
      !x.auto &&
      !x.prefilled &&
      !x.hazard &&
      FLAG.srcs.includes(x.src) &&
      !FLAG.neverSym.includes(x.key) &&
      fits(x, a) &&
      !(sole && x.sole === 'none') &&
      !live.some((y) => y.assetId === a.id && y.sym === x.key),
  );
  const sym = r.weighted(pool, (x) => 1 + (x.nff ?? []).reduce((n, e) => n + e.w, 0));
  return sym ? { sym: sym.key, cause: -1 } : null;
}

/**
 * the flag's alert for the owner trade (the engine's `flag` move). Any flag gives its trade a week to act (an
 * airworthiness squawk raised mid-week with its row's lead of 0 grounded the plane at once, maybe after his turn had
 * ended: a crewmate's report is a heads-up, not a grounding; review round 3: every flag, not only those). A flagged hazard closes its house at once like any
 * hazard (a reported shock: review round 2); its due week is the week after, and the electrician can make it safe after
 * the turn (econ.ts safeAfterTurn). The flagger passes on what its source said: the
 * alert keeps the flagger's seat (`by`) and a plane's pilot whose squawk it was (`via`), and reads as relayed
 */
export function raiseFlag(s: IslandState, role: Role, a: Asset, to: OpsRole, pick: { sym: string; cause: number }, now: number): Alert {
  const al = raiseAlert(s, { role: to, asset: a, sym: pick.sym, cause: pick.cause, src: 'flag', who: nameOf(s, role) }, now);
  const sym = SYMPTOMS[al.sym];
  // every flag is due next week at the soonest (review round 3: a utility row's lead of 0 had it past due one resolve
  // sooner than the techs' own, maybe after the receiver's turn had ended)
  if (al.due < s.week + FLAG.awLead) al.due = s.week + FLAG.awLead;
  al.by = role;
  const pilot = a.kind === 'plane' && sym?.src === 'squawk' ? pilotOf(s, a.id)?.name : undefined;
  if (pilot) al.via = pilot;
  // after the receiver's turn (review round 3): a hazard they don't come back to is made safe by the book at the resolve
  if (s.turns[to]?.ended) al.late = true;
  return al;
}

// ---------------------------------------------------------------------------
// The review (resolve step 17b): this week's check write-ups and flags, blind

export function checkReviewLines(s: IslandState, W: number): ReportLine[] {
  const out: ReportLine[] = [];
  for (const al of s.alerts ?? []) {
    if (al.week !== W || (al.src !== 'check' && al.src !== 'flag')) continue;
    const a = s.assets.find((x) => x.id === al.assetId);
    if (!a) continue;
    if (al.src === 'check') {
      const row = CHECK_ROWS[al.sym];
      if (row) out.push({ role: al.role, tone: 'info', text: `${al.who ?? nameOf(s, al.role)} ${checkDid(row.kind, a)} and wrote up the ${row.word}.` });
    } else out.push({ role: al.by ?? al.role, tone: 'info', text: `${al.who ?? 'A crewmate'} passed on ${flagSource(s, al)} to ${nameOf(s, al.role)}.` });
  }
  return out;
}

/** the tech bot's call (12.1): the tell read right with the chance `hit`, else "all serviceable", except a wrong call with chance (1 - hit) x 0.3 */
export function botCall(s: IslandState, role: OpsRole, assetId: string, hit: number, r: Rng): string | null {
  const truth = checkTruth(s, role, assetId, s.week);
  if (truth && r.chance(hit)) return truth.item;
  if (!r.chance((1 - hit) * 0.3)) return null;
  const items = (checkView(s, role, assetId)?.items ?? []).filter((i) => i.id !== truth?.item);
  return items.length ? r.pick(items).id : null;
}
