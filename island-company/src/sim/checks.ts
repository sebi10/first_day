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
import { drawWeight, fits, flagSource, liveAlerts, nameMid, pairsFor, raiseAlert, siteOf, slotKind, soleGuest, SYMPTOMS, type Symptom } from './alerts';
import {
  CHECK_ROWS,
  checkRowKey,
  genPanel,
  GEN_TELL_ZONE,
  GEN_UPGRADE,
  GFCI_OK,
  GFCI_TELL,
  homePanel,
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
import { genUpgraded, renovating } from './econ';
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
  reading?: { riseC?: number; loadPct?: number; amps?: number; volts?: number; runFt?: number; tooLight?: boolean };
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

/** what the check could show on this asset: in-scope kinds with weight now, nothing of the kind open on it (catalog order) */
function candidates(s: IslandState, a: Asset, ck: CheckKind, W: number): { c: CatalogEntry; w: number; from: number }[] {
  const scope = scopeOf(ck);
  const live = liveAlerts(s);
  const out: { c: CatalogEntry; w: number; from: number }[] = [];
  for (const c of CATALOG) {
    if (!(c.kind in scope) || !c.targets.includes(a.model)) continue;
    const w = drawWeight(s, c, a, W);
    const from = wearFromOf(c.kind);
    if (!(w > 0) || from === null) continue;
    // a late tell (the engine's oil and cylinders) shows only once it's well under way
    if (ck === 'walkaround' && WALK_SCOPE[c.kind].late && a.health > from - CHECK.depth) continue;
    if (s.orders.some((o) => openOrder(o) && o.kind === c.kind && o.assetId === a.id)) continue;
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

const panelOf = (s: IslandState, a: Asset): IrBreaker[] => (a.kind === 'generator' ? genPanel(genUpgraded(s)) : homePanel(genUpgraded(s))).filter((b) => b.from <= Math.max(1, s.tier));

/**
 * The backed-up load this week (A at 240 V): what the transfer switch carries. Review round 2: the generator's weekly test
 * run, the island panel's transfer-switch feed and the take-off to upsize the switch each had a number of their own
 * (37 A on the feed against 106 A through the Resort's switch; "137 A on the 60 A switch" against 28 A on the test run).
 * Now one number: with the old switch's take-off open, the load it quotes (over the 60 A rating: that's the tell);
 * else a share of the standby set's rating (the old 60 A set, or the Resort's 200 A one), seeded by the week. null: no
 * standby set yet (tier 3). The IR scans read it; the generator sheet's fuel line burns at it
 */
export function backedUp(s: IslandState, W = s.week): { amps: number; rating: number; over: boolean } | null {
  const gen = s.assets.find((a) => a.kind === 'generator');
  if (!gen || s.tier < 3) return null;
  const up = genUpgraded(s);
  const rating = up ? GEN_UPGRADE.amps : 60;
  if (!up) {
    const take = liveAlerts(s).find((x) => x.assetId === gen.id && x.sym === 'E_TAKEOFF_XFER');
    const load = take ? siteOf(s, take)?.load : undefined;
    if (load) return { amps: load, rating, over: load > rating };
  }
  const pct = rng(hashSeed(s.seed, 'backedup', W)).range(IR.backedUp[0], IR.backedUp[1]);
  return { amps: Math.round((pct / 100) * rating), rating, over: false };
}
function irTargets(s: IslandState, a: Asset, kind: string): IrBreaker[] {
  const on = IR_SCOPE[kind]?.on;
  const panel = panelOf(s, a);
  if (a.kind === 'generator') return on === 'xfer' ? panel.filter((b) => b.id === 'xferG' || b.id === 'xferL') : [];
  if (on === 'main') return panel.filter((b) => b.id === 'main');
  if (on === 'branch') return panel.filter((b) => b.id !== 'main' && !IR_DAY_OFF.includes(b.id));
  return [];
}
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
  'The transfer-switch feed carries the backed-up load, the same current the generator carries on its weekly test run.',
  'The runway edge lights are a night load: off in an afternoon scan.',
];
const GEN_IR_HELP = [
  'Scanned during the weekly test run, the set carrying the backed-up load (the same current the island panel\'s transfer-switch feed carries on the utility): the generator-side lugs, the load-side lugs and the generator main carry the same current, so compare them: healthy, they read within a degree or two.',
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
  if (a.kind === 'generator') {
    // the weekly test run: the set carries the backed-up load through the generator-side and load-side lugs alike (the
    // same current as the island panel's transfer-switch feed: backedUp, review round 2)
    const r = rng(hashSeed(s.seed, 'ir', a.id, 'test', W));
    const amps = backedUp(s, W)?.amps ?? 0;
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
  // one look-alike a scan: a branch at 70-79% load, reading 10-13 °C: warm, and right for its load (never the
  // transfer-switch feed: its load is the week's backed-up load)
  const branches = panel.filter((b) => b.id !== 'main' && b.id !== 'xfer' && b.id !== tell?.item && !IR_DAY_OFF.includes(b.id));
  const distractor = branches.length ? rng(hashSeed(s.seed, 'irx', a.id, W)).pick(branches).id : null;
  // one offset for the scan (the ambient, the camera), then a little each (review round 2: ±3 each read like breakers
  // at the same load 4 °C and more apart)
  const shared = rng(hashSeed(s.seed, 'ir', a.id, 'scan', W)).range(-IR.genShared, IR.genShared);
  const each = (rb: Rng) => shared + rb.range(-IR.genEach, IR.genEach);
  const bu = backedUp(s, W);
  for (const b of panel) {
    const rb = rng(hashSeed(s.seed, 'ir', a.id, b.id, W));
    if (b.id === 'main') {
      // the main is read for its load: continuous and peak over the afternoon
      const cont = Math.round(tell?.item === 'main' ? rb.range(IR.panelUp[0], IR.panelUp[1]) : rb.range(40, 70));
      const peak = Math.min(99, cont + Math.round(tell?.item === 'main' ? rb.range(2, 5) : rb.range(8, 16)));
      const amps = Math.round((cont / 100) * b.amps);
      const rise = r1(Math.max(0.5, expRise(cont) + each(rb)));
      items.push({
        id: b.id,
        label: `${b.label} ${b.amps} A · ${b.awg}`,
        text: `${amps} A continuous (${cont}%), peak ${peak}% · +${rise} °C over ambient`,
        reading: { riseC: rise, loadPct: cont, amps },
      });
      continue;
    }
    let pct: number;
    let rise: number;
    // the transfer-switch feed carries the week's backed-up load (review round 2), a hot lug on it or not
    const xferAmps = b.id === 'xfer' && bu ? bu.amps : null;
    if (IR_DAY_OFF.includes(b.id)) {
      // a night load in an afternoon scan: off, or a trickle (the photocell's own draw)
      pct = Math.round(rb.range(0, 3));
      rise = r1(rb.range(0, 0.6));
    } else if (tell?.item === b.id) {
      pct = xferAmps !== null ? Math.round((100 * xferAmps) / b.amps) : Math.round(rb.range(IR.tellLoad[0], IR.tellLoad[1]));
      rise = r1(expRise(pct) + shared + rb.range(IR.tell[0], IR.tell[1]));
    } else if (b.id === distractor) {
      pct = Math.round(rb.range(IR.distractorLoad[0], IR.distractorLoad[1]));
      rise = r1(clamp(expRise(pct) + each(rb), IR.distractorRise[0], IR.distractorRise[1]));
    } else {
      pct = xferAmps !== null ? Math.round((100 * xferAmps) / b.amps) : Math.round(rb.range(12, 76));
      rise = r1(Math.max(0.5, expRise(pct) + each(rb)));
    }
    items.push(irItem(b, xferAmps ?? Math.round((pct / 100) * b.amps), pct, rise));
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
  /** weeks before a flagged airworthiness squawk grounds its plane; a flagged hazard's due week (it closes its house at once, review round 2) */
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
    const pairs = pairsFor(c.kind, a, sole, s).filter((p) => p.sym.role === to && FLAG.srcs.includes(p.sym.src) && !FLAG.neverSym.includes(p.sym.key));
    if (pairs.length) out.push({ kind: c.kind, w: w * (1 + (100 - a.health) / 40), pairs });
  }
  return out;
}

/**
 * A trade's open work as the week's draw counts it (alerts.ts generateAlerts, 4.5): its workable jobs, its open alerts
 * with a real cause, and its quick-check write-ups not closed yet; and the draw's target (5 open from tier 3, else 4).
 * A flag on a trade at or over its target is work on top; under it, it fills a slot the draw would have filled.
 */
export function openWork(s: IslandState, role: OpsRole): { open: number; target: number } {
  const workable = s.orders.filter((o) => o.role === role && openOrder(o) && o.status !== 'waiting_part').length;
  const alerts = (s.alerts ?? []).filter((a) => a.role === role && a.status === 'open' && (a.cause >= 0 || a.src === 'check')).length;
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

/** whether the seat can flag the asset now (from week 3, one a week, one received per trade from each side, never its own trade's, never a house closed for its renovation), and to whom */
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
  return { ok: true, to };
}

/**
 * What a flag raises (6.5): a symptom a layperson could see or be told (a guest's, a pilot's squawk, a utility log) of
 * a kind with weight on the asset, weighted as the week's draw; nothing coming (a healthy asset): a no-fault write-up of
 * such a symptom, which takes no slot but costs the owner a close. A flag never names a load sheet, a 100-hr or code
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
 * the flag's alert for the owner trade (the engine's `flag` move). An airworthiness squawk a crewmate flags gives the
 * mechanic a week to act: raised mid-week with its row's lead of 0 it grounded the plane at once, maybe after his turn
 * had ended (a crewmate's report is a heads-up, not a grounding). A flagged hazard closes its house at once like any
 * hazard (a reported shock: review round 2); its due week is the week after, and the electrician can make it safe after
 * the turn (econ.ts safeAfterTurn). The flagger passes on what its source said: the
 * alert keeps the flagger's seat (`by`) and a plane's pilot whose squawk it was (`via`), and reads as relayed
 */
export function raiseFlag(s: IslandState, role: Role, a: Asset, to: OpsRole, pick: { sym: string; cause: number }, now: number): Alert {
  const al = raiseAlert(s, { role: to, asset: a, sym: pick.sym, cause: pick.cause, src: 'flag', who: nameOf(s, role) }, now);
  const sym = SYMPTOMS[al.sym];
  if ((sym?.aw || sym?.hazard) && al.due < s.week + FLAG.awLead) al.due = s.week + FLAG.awLead;
  al.by = role;
  const pilot = a.kind === 'plane' && sym?.src === 'squawk' ? pilotOf(s, a.id)?.name : undefined;
  if (pilot) al.via = pilot;
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
