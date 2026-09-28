// The job flow's rules of what's right (docs/JOBFLOW.md 8, 11): which P/N fits
// which slot on which airplane, which device protects which room, the right
// pick for a cause (labour, bots, autopilot, migration, tests; never shown by
// the UI), the teaching warnings before commit, and the stops at the install.
// Pure: nothing here changes the island.
import { figSb, ipcFor, planeModel, plantedFor, plantRows, rowFor, type Aircraft, type AnyAta, type Ata } from './aircraft';
import { alertFlags, alertTier, causeOf, fixesOf, lowerFirst, needsOf, protectionNeeded, siteOf, symptomOf } from './alerts';
import { islandAircraft, judgePart, type PartCheck } from './chain';
import { CATALOG_BY_KIND, DEFECT, defectRule, FREIGHT, kitValue, LABOR, SUPPLIERS, type DefectRule } from './data';
import { alertAog, downtimeOf, groundsFrom, hazardOn, houseWeekRevenue, orderCost, orderTier, round10, subCharterNeed } from './econ';
import { buyUnits, itemById, lineValue, planeItemIds, priceAt } from './items';
import { aogOk, cardBuyLines, etaOf, owned, reservedFor, schedFreight, uncovered, unitCost, vendorFor } from './stock';
import { benchFor, fixedFor, laborMin, slotQty, slotsAt, taskById, type MainSlot, type Task } from './tasks';
import type { Alert, Asset, BuyChoice, EaRecord, ElecSite, Freight, IslandState, Item, ItemId, OpsRole, Order, PickLine, SupplierId, TaskId } from './types';

export const acOf = (s: IslandState, asset: Pick<Asset, 'id' | 'model' | 'kind'> | undefined | null): Aircraft | null =>
  asset && asset.kind === 'plane' ? islandAircraft(s.seed, asset) : null;

/** the engineering authorization on file for this ICA part on this airplane */
export const eaFor = (s: Pick<IslandState, 'eas'>, assetId: string, ata: string, tag: string, pn: string): EaRecord | undefined =>
  (s.eas ?? []).find((e) => e.assetId === assetId && e.ata === ata && e.tag === tag && e.pn === pn);

// ---------------------------------------------------------------------------
// Mechanic: does this P/N go in this slot on this airplane?

export type SlotCheck = PartCheck & { unapproved?: boolean };

/** the IPC part a PMA P/N replaces (the PMA holder's number carries the OEM one) */
function pmaBase(model: string, pn: string): string | undefined {
  const x = itemById(pn);
  if (!x?.pma || !planeItemIds(model).includes(pn)) return undefined;
  if (pn.startsWith('RF')) return pn.slice(2);
  if (pn.startsWith('PF')) return `DH-${pn.slice(2)}`;
  return undefined;
}

/**
 * Receiving and the install: does P/N `pn` go in slot (ata, tag) on this
 * airplane? The airplane's own paperwork decides, as for the part chain: the
 * IPC effectivity for its S/N and SB status; where an alteration replaced the
 * slot's assembly, the STC holder's parts list (its IPC part is `displaced`,
 * and its ICA part needs an engineering authorization on file, else it goes on
 * `unapproved`). A PMA part is judged as the IPC part it replaces. Only the
 * slots the alteration's parts list carries are the ICA's: a tire on an
 * airplane with a brake conversion is still the IPC's.
 */
export function judgeSlot(s: Pick<IslandState, 'eas' | 'seed'>, asset: Pick<Asset, 'id' | 'model'>, ata: AnyAta, tag: string, pn: string): SlotCheck {
  const ac = islandAircraft(s.seed, asset);
  const p = plantedFor(ac, ata, tag);
  if (p) {
    const ica = plantRows(ac.model, ata as Ata).find((x) => x.tag === tag)?.pn;
    if (pn === ica) {
      const ea = eaFor(s, asset.id, ata, tag, pn);
      return ea ? { ok: true, text: `${pn} is approved for ${ac.registration} on ${ea.ea}` } : { ok: true, unapproved: true, text: `${pn} is the ${p.holder} part, with no engineering authorization on file for ${ac.registration}` };
    }
    // the IPC's part for the replaced assembly, or anything else
    return judgePart(ac, ata as Ata, tag, pn);
  }
  const base = pmaBase(ac.model, pn);
  const bare = { ...ac, plant: undefined };
  if (base) {
    const c = judgePart(bare, ata as Ata, tag, base);
    return c.ok ? { ok: true, text: `${pn} (FAA-PMA) replaces ${base}, effective for ${ac.registration}` } : { ...c, text: c.text.replace(base, `${pn} (PMA for ${base})`) };
  }
  return judgePart(bare, ata as Ata, tag, pn);
}

/** the P/N a mechanic who works the book installs in a slot: the part in force, new for old where the book allows it (never a code-3 set); the ICA part where an alteration governs */
export function effectivePn(ac: Aircraft, ata: AnyAta, tag: string): string | undefined {
  if (plantedFor(ac, ata, tag)) return plantRows(ac.model, ata as Ata).find((x) => x.tag === tag)?.pn;
  const fig = ipcFor(ac, ata);
  let row = rowFor(fig, tag);
  if (!row) return undefined;
  for (let guard = 0; guard < 4 && row.supsdBy && row.supsdBy.code !== 3; guard++) {
    const next = fig.rows.find((x) => x.pn === row!.supsdBy!.pn);
    if (!next) break;
    row = next;
  }
  return row.pn;
}

// ---------------------------------------------------------------------------
// Slots: which line fills which slot

/** does an item belong in a slot at all (its category: a switch never goes in the GFCI slot) */
export function accepts(slot: MainSlot, x: Item | undefined): boolean {
  if (!x) return false;
  if (slot.tag) return x.slot === slot.tag;
  const sp = x.spec ?? {};
  switch (slot.accepts) {
    case 'receptacle':
      return sp.device === 'receptacle';
    case 'gfci':
      return (sp.device === 'receptacle' || sp.form === 'breaker') && !!(sp.gfci || sp.df);
    case 'protection':
      return (sp.form === 'breaker' && !!(sp.afci || sp.gfci || sp.df)) || (sp.device === 'receptacle' && !!(sp.afci || sp.df));
    case 'cover':
      return sp.device === 'cover';
    case 'element':
      return sp.device === 'element';
    case 'jumper':
      return sp.method === 'bare';
    case 'clamp':
      return sp.device === 'clamp';
    case 'switch3':
      return sp.device === 'switch3';
    case 'cable3':
      return sp.method === 'nm' && sp.conductors === 3;
    case 'box':
      return sp.device === 'box';
    case 'spa':
      return sp.device === 'spa';
    case 'feed':
      return sp.form === 'breaker' && sp.poles === 2;
    case 'thwn':
      return sp.method === 'thwn';
    case 'emt':
      return x.fam === 'emt12' || x.fam === 'emt34';
    case 'emtConn':
      return sp.device === 'connector' && sp.raceway === 'emt';
    case 'pvc':
      return x.fam === 'pvc1';
    case 'splice':
      return sp.device === 'splice';
    case 'breaker':
      return sp.form === 'breaker' && sp.poles === 1;
    case 'relay':
      return sp.device === 'relay';
    case 'hose':
      return x.id === 'HPS-HOSE-60';
    case 'isolator':
      return x.id === 'HPS-ISO-4';
  }
  return false;
}

/** the category a slot takes, loosely (the electrician's "wrong category" stop): what a line in it must at least be */
function sameCategory(slot: MainSlot, x: Item | undefined): boolean {
  if (!x) return false;
  if (slot.tag) return x.slot === slot.tag;
  const sp = x.spec ?? {};
  switch (slot.accepts) {
    // a receptacle slot takes any receptacle; a GFCI slot any GFCI or DF device (a plain receptacle there is a category error)
    case 'receptacle':
      return sp.device === 'receptacle';
    case 'protection':
      return sp.form === 'breaker' || sp.device === 'receptacle';
    case 'switch3':
      return sp.device === 'switch3';
    default:
      return accepts(slot, x);
  }
}

export type Assigned = { slots: Map<string, PickLine[]>; extras: PickLine[] };

/** each line to the slot it fills: its own `slot`, else the first slot in the task's order that takes it and has room */
export function assignSlots(task: Task, pick: PickLine[], site?: ElecSite | null, ac?: Aircraft | null): Assigned {
  const slots = new Map<string, PickLine[]>();
  const extras: PickLine[] = [];
  const main = slotsAt(task, site);
  for (const l of pick) {
    const named = l.slot ? main.find((m) => m.slot === l.slot) : undefined;
    if (named) {
      (slots.get(named.slot) ?? slots.set(named.slot, []).get(named.slot)!).push(l);
      continue;
    }
    const x = itemById(l.item);
    const room = (m: MainSlot) => (slots.get(m.slot) ?? []).reduce((n, y) => n + y.qty, 0) < slotQty(m, ac ?? null, site);
    const fit = main.find((m) => accepts(m, x) && room(m)) ?? main.find((m) => accepts(m, x));
    if (fit) (slots.get(fit.slot) ?? slots.set(fit.slot, []).get(fit.slot)!).push(l);
    else extras.push(l);
  }
  return { slots, extras };
}

// ---------------------------------------------------------------------------
// The right pick

const ampacity: Record<number, number> = { 14: 20, 12: 25, 10: 35, 8: 50, 6: 65, 3: 100 };
/** the largest breaker a conductor may have (240.4(D) for the small ones; Table 310.16 at 75 °C) */
const breakerLimit = (awg: number) => ({ 14: 15, 12: 20, 10: 30, 8: 50, 6: 65, 3: 100 })[awg] ?? 20;
/** the equipment grounding conductor a circuit needs (Table 250.122) */
const egcFor = (amps: number) => (amps <= 15 ? 14 : amps <= 20 ? 12 : amps <= 60 ? 10 : 8);
/** the hots a spa's amps need (Table 310.16 at 75 °C) */
const hotsFor = (amps: number) => (amps <= 50 ? 8 : 6);
/** THHN/THWN-2 cross sections, in² (Chapter 9, Table 5) */
const WIRE_AREA: Record<number, number> = { 14: 0.0097, 12: 0.0133, 10: 0.0211, 8: 0.0366, 6: 0.0507, 4: 0.0824, 3: 0.0973 };
/** EMT at 40% fill for over two conductors, in² (Chapter 9, Table 4) */
const EMT_SIZES: [string, number][] = [
  ['1/2', 0.122],
  ['3/4', 0.213],
  ['1', 0.346],
];
const EMT_FILL: Record<string, number> = Object.fromEntries(EMT_SIZES);
/** the standard breaker ratings (240.6(A)), for the next size up a conductor's ampacity allows (240.4(B)) */
const STD_AMPS = [15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 110, 125];
const nextStd = (a: number) => STD_AMPS.find((x) => x >= a) ?? a;

/** the device a receptacle replacement takes at this site: the cheapest set that passes every rule */
function receptacleFor(site: ElecSite, gfciSlot: boolean): { device: ItemId; protection?: ItemId } {
  const need = protectionNeeded(site);
  const upG = site.upstream === 'gfci' || site.upstream === 'df';
  const upA = site.upstream === 'afci' || site.upstream === 'df';
  const g = need.gfci && !upG;
  const a = need.afci && !upA;
  if (site.single) return { device: site.amps >= 20 ? 'KR20S' : 'KR15S', ...(g && a ? { protection: 'KP120DF' } : a ? { protection: 'KP120AF' } : g ? { protection: 'KP120GF' } : {}) };
  if (site.room === 'outdoor' || site.wet) return { device: 'KG20-TRWR' };
  if (g && a) return { device: 'KDF20-TR' };
  if (gfciSlot) return { device: a ? 'KDF20-TR' : 'KG20-TR' };
  if (a) return { device: 'KA15-TR' };
  if (g) return { device: 'KG20-TR' };
  return { device: 'KR15-TR' };
}

/**
 * The right pick for this airplane and this cause, or this site: the effective
 * P/N at the right quantity in only the slots the cause needs; the site's right
 * devices; a rare job's pre-filled line. Labour, the bots, autopilot, migration
 * and the tests use it; the UI never shows it.
 */
export function stdPick(s: IslandState, asset: Asset, task: Task, site?: ElecSite | null, needs?: string[] | null): PickLine[] {
  const ac = acOf(s, asset);
  const out: PickLine[] = [];
  if (task.fixed) return fixedFor(task, asset).map((l) => ({ ...l }));
  const main = slotsAt(task, site);
  const want = (m: MainSlot) => !m.optional || (needs ?? []).includes(m.slot) || (m.outdoor && (site?.room === 'outdoor' || !!site?.wet));
  for (const m of main) {
    if (m.tag && m.ata) {
      if (!want(m) || !ac) continue;
      const pn = effectivePn(ac, m.ata, m.tag);
      if (pn && itemById(pn)) out.push({ item: pn, qty: slotQty(m, ac, site), slot: m.slot });
      continue;
    }
    const st = site ?? { room: 'living', amps: 15, awg: 14 };
    switch (m.accepts) {
      case 'receptacle':
      case 'gfci': {
        const r = receptacleFor(st, m.accepts === 'gfci');
        out.push({ item: r.device, qty: 1, slot: m.slot });
        if (r.protection) out.push({ item: r.protection, qty: 1, slot: 'protection' });
        break;
      }
      case 'protection':
        break; // with its device, above
      case 'cover':
        if (want(m)) out.push({ item: 'WP-INUSE', qty: 1, slot: m.slot });
        break;
      case 'element':
        out.push({ item: 'WH-EL45', qty: 1, slot: m.slot });
        break;
      case 'jumper':
        out.push({ item: 'CU6-BARE', qty: slotQty(m, ac, site), slot: m.slot });
        break;
      case 'clamp':
        out.push({ item: 'BOND-CLAMP', qty: 1, slot: m.slot });
        break;
      case 'switch3':
        if (want(m)) out.push({ item: 'KS3', qty: 2, slot: m.slot });
        break;
      case 'cable3':
        if (want(m)) out.push({ item: st.awg === 14 ? 'NMB-14-3' : 'NMB-12-3', qty: 25, slot: m.slot });
        break;
      case 'box':
        if (want(m)) out.push({ item: 'BOX-OW1', qty: 1, slot: m.slot });
        break;
      case 'spa':
        out.push({ item: st.amps >= 60 ? 'SPA-60GF' : 'SPA-50GF', qty: 1, slot: m.slot });
        break;
      case 'feed':
        out.push({ item: st.amps >= 60 ? 'KP260' : 'KP250', qty: 1, slot: m.slot });
        break;
      case 'thwn':
        out.push({ item: m.slot === 'egc' ? `THWN-${egcFor(st.amps)}` : `THWN-${hotsFor(st.amps)}`, qty: slotQty(m, ac, site), slot: m.slot });
        break;
      case 'emt':
        out.push({ item: 'EMT-34', qty: 1, slot: m.slot });
        break;
      case 'emtConn':
        out.push({ item: 'EMT-C34RT', qty: 2, slot: m.slot });
        break;
      case 'pvc':
        out.push({ item: 'PVC40-1', qty: slotQty(m, ac, site), slot: m.slot });
        break;
      case 'splice':
        out.push({ item: 'DBS-2', qty: 4, slot: m.slot });
        break;
      case 'breaker':
        if (want(m)) out.push({ item: st.amps >= 20 ? 'KP120' : 'KP115', qty: 1, slot: m.slot });
        break;
      case 'relay':
        if (want(m)) out.push({ item: 'KP-TSR30', qty: 1, slot: m.slot });
        break;
      case 'hose':
        if (want(m)) out.push({ item: 'HPS-HOSE-60', qty: 1, slot: m.slot });
        break;
      case 'isolator':
        out.push({ item: 'HPS-ISO-4', qty: 4, slot: m.slot });
        break;
    }
  }
  return out;
}

/** the right pick for an alert (its cause's needs, its site) */
export function stdPickFor(s: IslandState, a: Alert, task: Task): PickLine[] {
  const asset = s.assets.find((x) => x.id === a.assetId);
  if (!asset) return [];
  return stdPick(s, asset, task, siteOf(s, a), needsOf(s, a));
}

/** lines' value at flat list price */
export const bomValue = (lines: { item: ItemId; qty: number }[]) => lines.reduce((n, l) => n + lineValue(l), 0);

/** the pick + bench lines a task draws for an asset */
export function linesFor(s: IslandState, asset: Asset, task: Task, pick: PickLine[]): { item: ItemId; qty: number }[] {
  const out: { item: ItemId; qty: number }[] = [];
  const add = (l: { item: ItemId; qty: number }) => {
    const at = out.find((x) => x.item === l.item);
    if (at) at.qty += l.qty;
    else out.push({ item: l.item, qty: l.qty });
  };
  for (const l of pick) add(l);
  for (const l of benchFor(task, acOf(s, asset), asset)) add(l);
  return out;
}

// ---------------------------------------------------------------------------
// Electrician: the pick judge (11.3)

export type ElecVerdict = { ok: true } | { ok: false; variant: ElecVariant; text: string } | { stop: string };
export type ElecVariant = 'nogfci' | 'noafci' | 'oversized' | 'undersized' | 'rating' | 'notr' | 'nowr' | 'boxfill' | 'raintight' | 'noburial';

/**
 * The electrician's lines against the site and the code. A line in the wrong
 * category for its slot stops the install (no defect); else the first rule
 * that fails is the sure defect it leaves: nogfci, noafci, oversized,
 * undersized, rating, notr, nowr, boxfill, raintight, noburial.
 */
export function judgeElecPick(task: Task, site: ElecSite | null, lines: PickLine[]): ElecVerdict {
  const st: ElecSite = site ?? { room: 'living', amps: 15, awg: 14 };
  const { slots } = assignSlots(task, lines, st);
  const main = slotsAt(task, st);
  const at = (slot: string) => (slots.get(slot) ?? []).map((l) => itemById(l.item)).filter((x): x is Item => !!x);
  // the category stop
  for (const m of main) {
    for (const l of slots.get(m.slot) ?? []) {
      const x = itemById(l.item);
      if (!sameCategory(m, x)) return { stop: `${x?.nomen ?? l.item} isn't a ${m.label.toLowerCase()}: it doesn't go there.` };
    }
  }
  // EMT the conductors can't be pulled through (40% fill, Chapter 9 Tables 4 and 5), and fittings that don't fit the stick
  const emt = at('emt')[0];
  const hots = at('wire')[0];
  const egcWire = at('egc')[0];
  if (emt?.spec?.size && hots) {
    const wires = [...Array(3).fill(hots.spec?.awg ?? 12), ...(egcWire ? [egcWire.spec?.awg ?? 10] : [])] as number[];
    const area = wires.reduce((n, g) => n + (WIRE_AREA[g] ?? 0.0133), 0);
    const cap = EMT_FILL[emt.spec.size] ?? 0.213;
    if (area > cap) {
      const words = `Three #${hots.spec?.awg}${egcWire ? ` and a #${egcWire.spec?.awg} EGC` : ''}`;
      // (in size order: an object's integer-like key '1' would come first)
      const bigger = EMT_SIZES.find(([, c]) => c >= area)?.[0];
      return { stop: `${words} (${area.toFixed(3)} in²) won’t fit ${emt.spec.size} in EMT at 40% fill (${cap.toFixed(3)} in², Chapter 9): the wall section needs ${bigger ?? '1'} in.` };
    }
  }
  const conn = at('connectors')[0];
  if (emt && conn && conn.spec?.size !== emt.spec?.size) return { stop: `${conn.nomen} don't fit ${emt.nomen}.` };

  const dev = [...at('receptacle'), ...at('gfci')][0];
  const prot = at('protection');
  const replacing = task.id === 'ref:outlet' || task.id === 'ref:gfci';
  const fail = (variant: ElecVariant, text: string): ElecVerdict => ({ ok: false, variant, text });
  if (replacing && dev) {
    const need = protectionNeeded(st);
    const all = [dev, ...prot];
    const hasG = all.some((x) => x.spec?.gfci || x.spec?.df) || st.upstream === 'gfci' || st.upstream === 'df';
    const hasA = all.some((x) => x.spec?.afci || x.spec?.df) || st.upstream === 'afci' || st.upstream === 'df';
    if (need.gfci && !hasG) return fail('nogfci', 'a receptacle with no GFCI protection where the code needs it');
    if (need.afci && !hasA) return fail('noafci', 'a replacement with no AFCI protection');
  }
  // breakers against the conductors they protect
  const limit = breakerLimit(st.awg);
  for (const b of [...prot.filter((x) => x.spec?.form === 'breaker'), ...at('breaker'), ...at('gfci').filter((x) => x.spec?.form === 'breaker')])
    if ((b.spec?.amps ?? 0) > limit) return fail('oversized', 'a breaker oversized for its wire');
  const feed = at('feed')[0];
  const spaPanel = at('spa')[0];
  // the feed: no bigger than the hots it protects allow (their ampacity, or the next standard size up: 240.4(B)), and no
  // bigger than the spa panel's listing takes as its supply (110.3(B))
  const hotsAmp = hots ? (ampacity[hots.spec?.awg ?? 12] ?? 0) : ampacity[hotsFor(st.amps)];
  // (hots too small for the tub itself: that's the mistake, and the undersized rule below names it)
  const hotsShort = hotsAmp < st.amps;
  if (feed && !hotsShort && (feed.spec?.amps ?? 0) > nextStd(hotsAmp)) return fail('oversized', `a ${feed.spec?.amps} A feed on #${hots?.spec?.awg ?? hotsFor(st.amps)} hots`);
  if (feed && spaPanel && (feed.spec?.amps ?? 0) > (spaPanel.spec?.amps ?? 0)) return fail('oversized', `a ${feed.spec?.amps} A feed on a ${spaPanel.spec?.amps} A spa panel (its listing, 110.3(B))`);
  // conductors and equipment too small for the circuit
  const cable = at('cable')[0];
  if (cable && (cable.spec?.awg ?? 12) > st.awg) return fail('undersized', `${cable.nomen} on a ${st.amps} A circuit`);
  if (hots && (ampacity[hots.spec?.awg ?? 12] ?? 0) < st.amps) return fail('undersized', `#${hots.spec?.awg} hots on a ${st.amps} A spa`);
  const egc = egcWire;
  if (egc && (egc.spec?.awg ?? 14) > egcFor(st.amps)) return fail('undersized', `a #${egc.spec?.awg} EGC on a ${st.amps} A circuit (Table 250.122)`);
  const spa = spaPanel;
  if (spa && (spa.spec?.amps ?? 0) < st.amps) return fail('undersized', `a ${spa.spec?.amps} A spa panel on a ${st.amps} A tub`);
  if (feed && (feed.spec?.amps ?? 0) < st.amps) return fail('undersized', `a ${feed.spec?.amps} A feed on a ${st.amps} A tub`);
  for (const b of at('breaker')) if ((b.spec?.amps ?? 0) < st.amps) return fail('undersized', `a ${b.spec?.amps} A breaker on a ${st.amps} A circuit`);
  if (replacing && dev) {
    if (st.single && dev.spec?.single && (dev.spec.amps ?? 15) < st.amps) return fail('rating', 'a single 15 A receptacle on a 20 A circuit');
    if (dev.spec?.device === 'receptacle' && !dev.spec.tr) return fail('notr', 'receptacles that aren’t tamper-resistant');
    if (st.room === 'outdoor' || st.wet) {
      const cover = at('cover')[0];
      if (!dev.spec?.wr || !cover?.spec?.inUse) return fail('nowr', 'an outdoor receptacle not rated or covered for a wet location');
    }
  }
  const box = at('box')[0];
  if (box) {
    const awg = cable?.spec?.awg ?? st.awg;
    const need = 9 * (awg <= 12 ? 2.25 : 2.0);
    if ((box.spec?.volume ?? 0) < need) return fail('boxfill', 'an overfilled box');
  }
  if (conn && conn.spec?.fitting === 'setscrew' && (st.wet || st.room === 'spa')) return fail('raintight', 'EMT set-screw fittings in a wet location');
  for (const x of at('splice')) if (!x.spec?.burial) return fail('noburial', 'split bolts and tape buried in the feeder trench');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Before commit: the teaching tiers' warnings (6.4)

/** tiers 0-1 only: what's wrong with the pick before it's sent, built from judgeSlot and judgeElecPick ([] at tier 2+) */
export function pickCheck(s: IslandState, alert: Alert, task: Task, pick: PickLine[], tier: number): string[] {
  if (tier >= 2) return [];
  const asset = s.assets.find((a) => a.id === alert.assetId);
  if (!asset) return [];
  const out: string[] = [];
  if (task.trade === 'mech' && asset.kind === 'plane') {
    const ac = acOf(s, asset)!;
    const { slots } = assignSlots(task, pick, null, ac);
    for (const m of task.main) {
      if (!m.ata || !m.tag) continue;
      for (const l of slots.get(m.slot) ?? []) {
        const c = judgeSlot(s, asset, m.ata, m.tag, l.item);
        if (!c.ok || c.why) out.push(`Check: ${c.text}.`);
        else if (c.unapproved) out.push(`Check: ${c.text}: research the records for the approval.`);
      }
      const need = needsOf(s, alert).includes(m.slot) || !m.optional;
      const have = (slots.get(m.slot) ?? []).reduce((n, l) => n + l.qty, 0);
      const want = slotQty(m, ac, null);
      if (need && have > 0 && have < want) out.push(`Check: the ${m.label.toLowerCase()}: ${want} needed (the AMM does ${m.tag === 'lining' ? 'both brakes' : 'the set'}), ${have} picked.`);
    }
  } else if (task.trade === 'elec') {
    const v = judgeElecPick(task, siteOf(s, alert), pick);
    if ('stop' in v) out.push(`Check: ${v.stop}`);
    else if (!v.ok) out.push(`Check: ${v.text}.`);
  }
  return out;
}

/** is a symptom's cause really a fault (not an NFF, not the wiring) */
export const realFault = (a: Alert) => a.cause >= 0 && !!causeOf(a) && causeOf(a)!.kind !== 'wiring';

/** the SB status of a task's figure on an airplane (tests, bots) */
export const postSbFor = (ac: Aircraft, ata: Ata) => ac.sbs.some((x) => x.id === figSb(ac.model, ata).id);

/** a symptom's cause's fix task on an asset (bots, autopilot, migration) */
export function fixTaskFor(s: IslandState, a: Alert): Task | undefined {
  const sym = symptomOf(a);
  const c = causeOf(a);
  if (!sym || !c?.fix) return undefined;
  const asset = s.assets.find((x) => x.id === a.assetId);
  if (!asset) return undefined;
  const id = c.fix.startsWith('ref:') || c.fix.startsWith('gsm:') ? c.fix : `amm:${planeModel(asset.model)}:${c.fix === '05-20' ? (planeModel(asset.model) === 'cargo' ? '05-20-02' : '05-20-01') : c.fix}`;
  return taskById(id);
}

/** list price of an item's unit (bots, labour) */
export const unitPrice = (id: ItemId) => {
  const x = itemById(id);
  return x ? priceAt(x) : 0;
};

// ---------------------------------------------------------------------------
// Money per job (8.3): labour plus the standard parts is today's card

/** today's card for this kind on this asset: orderCost x the model's factor, plus the kit it needed */
export function cardToday(s: Pick<IslandState, 'tier'>, kind: string, asset: Pick<Asset, 'model' | 'health'>): number {
  const c = CATALOG_BY_KIND[kind];
  if (!c) return 0;
  return round10(orderCost(kind, orderTier(kind, asset as Asset, s.tier)) * (c.costBy?.[asset.model] ?? 1)) + (c.parts ? kitValue(s.tier) : 0);
}

/**
 * A job's labour: today's card less the standard parts (the right pick for this
 * airplane and cause, or this site, and the task's bench lines, at flat list),
 * never under the task's floor (LABOR). A pick that isn't standard costs what it
 * costs: labour doesn't change.
 */
export function laborCost(s: IslandState, kind: string, task: Task, asset: Asset, site?: ElecSite | null, needs?: string[] | null): number {
  const std = bomValue(linesFor(s, asset, task, stdPick(s, asset, task, site, needs)));
  const min = laborMin(task);
  return round10(Math.min(LABOR.capX * min, Math.max(min, cardToday(s, kind, asset) - std)));
}

/** a repair's pre-filled line: RPR-{job} when its fix rule carries parts (an ipc:noteff repair carries the effective part instead) */
export function repairLine(rule: DefectRule, job: string | undefined, trade: 'mech' | 'elec'): { item: ItemId; qty: number } | null {
  if (!rule.fix.parts) return null;
  const key = rule.fix.job ?? job ?? '';
  const id = itemById(`RPR-${key}`) ? `RPR-${key}` : trade === 'elec' ? 'RPR-outlet' : 'RPR-part';
  return { item: id, qty: 1 };
}

/** a repair's labour (8.3): today's repair cost plus the kit it needed, less its pre-filled line */
export function repairLabor(s: Pick<IslandState, 'tier'>, d: { cost: number; puzzle: string; role: 'mech' | 'elec' | 'fin'; orderKind: string; variant?: string; job?: string }): number {
  const rule = defectRule(d.puzzle, d.role, d.orderKind, d.variant);
  const today = round10(Math.max(d.cost, DEFECT.minBase) * (rule.fix.cost ?? DEFECT.repairCost)) + (rule.fix.parts ? kitValue(s.tier) : 0);
  const line = repairLine(rule, d.job, d.role === 'elec' ? 'elec' : 'mech');
  return round10(Math.max(50, today - (line ? lineValue(line) : 0)));
}


// ---------------------------------------------------------------------------
// Repairs: a hidden defect's fix, planned from its alert (4.4)

/** the repair alert's defect rule (its words and its fix) */
export const repairRule = (d: { puzzle: string; role: 'mech' | 'elec' | 'fin'; orderKind: string; variant?: string; rule?: string }) => defectRule(d.puzzle, d.role, d.rule ?? d.orderKind, d.variant);

/**
 * A repair alert's task: its fix rule's puzzle and job, with the pre-filled
 * line (RPR-{job} where the fix carries parts; an `ipc:noteff` repair carries
 * the effective part the inspection found missing, the original task's right
 * pick). No Investigate or Manual step: the flow opens at Stock.
 */
export function repairTask(s: IslandState, a: Alert): Task | undefined {
  const r = a.repair;
  if (!r) return undefined;
  const d = r.defect;
  const rule = repairRule(d);
  const trade: OpsRole = d.role === 'elec' ? 'elec' : 'mech';
  let fixed: { item: ItemId; qty: number }[] | undefined;
  if (d.puzzle === 'ipc' && d.variant === 'noteff' && d.task) {
    const t = taskById(d.task);
    const asset = s.assets.find((x) => x.id === d.assetId);
    if (t && asset) fixed = stdPick(s, asset, t, null, t.main.map((m) => m.slot)).map((l) => ({ item: l.item, qty: l.qty }));
  } else {
    const line = repairLine(rule, d.job, trade);
    if (line) fixed = [line];
  }
  return {
    id: `repair:${a.id}`,
    trade,
    book: trade === 'elec' ? 'REF' : 'AMM',
    no: 'Repair',
    title: rule.fix.title,
    short: rule.fix.title,
    chapter: 'Repairs',
    kind: 'repair',
    job: rule.fix.job ?? d.job ?? d.orderKind,
    main: [],
    ...(fixed?.length ? { fixed } : {}),
    bench: [],
    tools: [],
    keywords: [],
  };
}

/** the task a plan names: a task in the manual set, or a repair alert's own task */
export function planTask(s: IslandState, a: Alert, task: TaskId): Task | undefined {
  if (task.startsWith('repair:')) return task === `repair:${a.id}` ? repairTask(s, a) : undefined;
  return taskById(task);
}

// ---------------------------------------------------------------------------
// The stage a player sees (2.4), derived

export type FlowStage = 'new' | 'bench' | 'approval' | 'parts' | 'research' | 'ready' | 'done' | 'closed';

const isOpen = (o: Order | undefined) => !!o && o.status !== 'done' && o.status !== 'cancelled';

export function flowStage(s: IslandState, a: Alert): FlowStage {
  if (a.status === 'closed') return 'closed';
  const o = a.order ? s.orders.find((x) => x.id === a.order) : undefined;
  const benchOpen = !!a.bench?.order && isOpen(s.orders.find((x) => x.id === a.bench!.order));
  if (!o || o.status === 'cancelled') return benchOpen ? 'bench' : 'new';
  if (o.status === 'done') return 'done';
  if (o.status === 'pending' || o.status === 'countered') return 'approval';
  const chainHolds = o.chain?.step === 'job' && s.chain?.id === o.chain.id && s.chain.step !== 'done' && s.chain.step !== 'install';
  if (o.flow?.queued || chainHolds) return 'research';
  if (o.status === 'ready') return 'ready';
  if (benchOpen) return 'bench';
  return 'parts';
}

// ---------------------------------------------------------------------------
// The install check (8.7): what the tech finds when the box is opened

/** a slot's label mid-sentence: "the lining", but "a GFCI device" (a label that starts with an acronym keeps it) */
const lc = (t: string) => lowerFirst(t);

/**
 * What stops a flow job at the install: a mechanic's line that isn't this
 * airplane's part (wrong, unlisted), or the IPC part of an assembly an
 * alteration replaced (research); a needed slot short or empty; an
 * electrician's line in the wrong category; a required tool not owned. A part
 * that isn't effective doesn't stop it (the mistake surfaces later).
 */
export function installCheck(s: IslandState, o: Order): { stop: string; research?: boolean } | null {
  if (!o.flow || o.flow.wired) return null;
  const a = s.alerts?.find((x) => x.id === o.flow!.alert);
  const asset = s.assets.find((x) => x.id === o.assetId);
  for (const t of o.flow.tools) if (!owned(s, t)) return { stop: `${itemById(t)?.nomen ?? t} isn't in the shop: the job waits for it.` };
  const task = a ? planTask(s, a, o.flow.task) : taskById(o.flow.task);
  if (!task || !asset) return null;
  const right = !!a && fixesOf(s, a).includes(task.id);
  const needs = a && right ? needsOf(s, a) : [];
  if (task.trade === 'mech' && asset.kind === 'plane') {
    const ac = acOf(s, asset)!;
    const tier = a ? alertTier(s, a, o.role) : 3;
    const { slots } = assignSlots(task, o.flow.pick, null, ac);
    // the research branch's part (13) goes in the slot it researched: the chain brought it, the pick never held it
    const ch = o.flow.research && o.chain && s.chain?.id === o.chain.id ? s.chain : null;
    for (const m of task.main) {
      if (!m.ata || !m.tag) continue;
      if (ch && m.tag === ch.tag) continue;
      const lines = slots.get(m.slot) ?? [];
      for (const l of lines) {
        const c = judgeSlot(s, asset, m.ata, m.tag, l.item);
        if (c.ok) continue;
        if (c.why === 'displaced') return { stop: `The ${lc(m.label)} assembly on ${asset.name} isn't the one in the IPC: it was altered. Research the records.`, research: true };
        if (c.why === 'wrong' || c.why === 'unlisted')
          return { stop: tier <= 2 ? `${l.item} isn't the ${lc(m.label)} this airplane takes: check the IPC for S/N ${ac.serial}.` : `The ${lc(m.label)} doesn't fit: check the IPC.` };
      }
      const need = !m.optional || needs.includes(m.slot);
      if (!need) continue;
      const have = lines.reduce((n, l) => n + l.qty, 0);
      const want = slotQty(m, ac, null);
      if (have === 0) {
        const f = a ? causeOf(a)?.finding : undefined;
        return { stop: `${f ? `${f.split(';')[0].replace(/\.$/, '')}: this` : 'This'} job replaces the ${lc(m.label)}, and none was picked.` };
      }
      if (have < want) {
        const short = want - have;
        const word = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'][short] ?? String(short);
        return { stop: `${word} ${lc(m.label)}${short > 1 && !/s$/.test(m.label) ? 's' : ''} short: the AMM does ${m.tag === 'lining' ? 'both brakes' : 'the set'}.` };
      }
    }
  } else if (task.trade === 'elec') {
    const site = a ? siteOf(s, a) : null;
    const v = judgeElecPick(task, site, o.flow.pick);
    if ('stop' in v) return { stop: v.stop };
    const { slots } = assignSlots(task, o.flow.pick, site);
    for (const m of slotsAt(task, site)) {
      const need = !m.optional || needs.includes(m.slot);
      if (need && !(slots.get(m.slot) ?? []).length) return { stop: `This job needs ${/^[aeiou]/i.test(m.label) ? 'an' : 'a'} ${lc(m.label)}, and none was picked.` };
    }
  }
  return null;
}

/** main-slot value covered from stock at plan time / planned (the fill rate) */
export function fillOf(s: IslandState, o: Order): [number, number] {
  if (!o.flow) return [0, 0];
  let f = 0;
  let p = 0;
  for (const l of o.flow.pick) {
    const unit = unitCost(s, l.item);
    p += l.qty * unit;
    f += Math.min(l.qty, reservedFor(s, o.id, l.item)) * unit;
  }
  return [f, p];
}

// ---------------------------------------------------------------------------
// The card (8.6): A computes, C draws

export type Arrival = { eta: number; outWeeks: number };
export type Card = {
  labour: number;
  fromStock: { item: ItemId; qty: number; value: number }[];
  toBuy: { item: ItemId; qty: number; unit: number; supplier: SupplierId; eta: number }[];
  tools: { item: ItemId; price: number }[];
  /** sched: `cost` the shipments it starts (0 when every line rides one already on its way this week: `rides` names its PO) */
  /** sched: the scheduled shipments' charge (3.6: per supplier and carrier, none for a PO riding one already on its way); `shipments` when more than one */
  freight: { sched: Arrival & { cost: number; rides?: string; shipments?: number }; aog?: Arrival & { cost: number }; pick: Freight };
  total: number;
  aog: boolean;
  /**
   * the only guest plane's job: grounded by its alert past due (`aog`), the mainland sub-charter flies its guests in,
   * `usd` a week (`flights` at `fee`; the card's downtime counts it)
   */
  sub?: { flights: number; fee: number; usd: number };
  shut: boolean;
  downtime?: { flights: number; usd: number };
  due: number;
  mel?: { until: number; ext?: boolean };
  budget: { trade: OpsRole; spent: number; of: number };
};

/** resolves the asset spends out (AOG, closed) waiting on lines that land at `eta`'s resolve (the job is done the week after) */
function outWeeks(s: IslandState, a: Alert | undefined, eta: number): number {
  if (!a) return 0;
  const f = alertFlags(s, a);
  if (!f.aw && !f.hazard) return 0;
  const from = Math.max(a.due, s.week);
  if (f.hazard && !a.safe) return Math.max(0, eta - s.week + 1);
  if (a.mel && a.mel.until >= eta) return 0;
  return Math.max(0, eta - from + 1);
}

/**
 * What a flow card shows and costs: the labour, the lines from stock and to
 * buy (a pending card's shortfall lives only on the card; an approved job's
 * uncovered shortfall), the tools to buy, both freights with what each does to
 * the asset, and the default: the AOG boat when the scheduled arrival leaves
 * the asset out longer and that downtime costs more than the boat.
 */
export function cardOf(s: IslandState, o: Order, buy?: BuyChoice): Card {
  const a = o.flow ? s.alerts?.find((x) => x.id === o.flow!.alert) : undefined;
  const asset = s.assets.find((x) => x.id === o.assetId);
  const pending = o.status === 'pending' || o.status === 'countered';
  const lines = pending ? cardBuyLines(s, o) : uncovered(s, o);
  const W = s.week;
  const fromStock = (o.flow ? [...o.flow.pick, ...o.flow.bench] : [])
    .map((l) => l.item)
    .filter((id, i, arr) => arr.indexOf(id) === i)
    .map((id) => ({ item: id, qty: reservedFor(s, o.id, id), value: Math.round(reservedFor(s, o.id, id) * unitCost(s, id) * 100) / 100 }))
    .filter((l) => l.qty > 0);
  const toBuy: Card['toBuy'] = [];
  const tools: Card['tools'] = [];
  let schedEta = W;
  let aogPossible = true;
  for (const l of lines) {
    const x = itemById(l.item);
    if (!x) continue;
    const vendor = vendorFor(x, buy);
    const unit = Math.round(priceAt(x, vendor) * 100) / 100;
    const qty = buyUnits(x, l.qty);
    const eta = etaOf(W, x, vendor);
    schedEta = Math.max(schedEta, eta);
    if (!aogOk(x, vendor)) aogPossible = false;
    if (l.tool) tools.push({ item: l.item, price: Math.round(unit * qty) });
    else toBuy.push({ item: l.item, qty, unit, supplier: vendor, eta });
  }
  const anyToBuy = toBuy.length + tools.length > 0;
  // scheduled freight: a shipment's charge for each supplier and carrier not already on its way this week (3.6)
  const ship: { cost: number; shipments?: number; rides?: string } = anyToBuy ? schedFreight(s, [...toBuy.map((l) => ({ item: l.item, vendor: l.supplier })), ...tools.map((t) => ({ item: t.item, vendor: vendorFor(itemById(t.item)!, buy) }))]) : { cost: 0 };
  const sched: Card['freight']['sched'] = {
    eta: anyToBuy ? schedEta : W,
    outWeeks: outWeeks(s, a, anyToBuy ? schedEta : W - 1),
    cost: ship.cost,
    ...(ship.rides ? { rides: ship.rides } : {}),
    ...((ship.shipments ?? 0) > 1 ? { shipments: ship.shipments } : {}),
  };
  const vendors = new Set([...toBuy.map((l) => l.supplier), ...tools.map((t) => vendorFor(itemById(t.item)!, buy))]);
  const aogCost = FREIGHT.aog * Math.max(1, vendors.size);
  const aog = anyToBuy && aogPossible ? { eta: W, outWeeks: outWeeks(s, a, W), cost: aogCost } : undefined;
  const down = asset?.kind === 'plane' ? downtimeOf(s, asset.id) : asset?.kind === 'house' ? { flights: 0, usd: Math.round(houseWeekRevenue(s, asset)) } : undefined;
  const saved = aog ? sched.outWeeks - aog.outWeeks : 0;
  const auto: Freight = aog && saved > 0 && saved * (down?.usd ?? 0) > aog.cost - sched.cost ? 'aog' : 'sched';
  const pick: Freight = buy?.freight && (buy.freight === 'sched' || aog) ? buy.freight : auto;
  const labour = pending ? o.cost : 0;
  const buyTotal = toBuy.reduce((n, l) => n + l.qty * l.unit, 0) + tools.reduce((n, t) => n + t.price, 0);
  const aogNow = asset?.kind === 'plane' ? alertAog(s, asset.id)?.id === a?.id && !!a : false;
  // the only guest plane's airworthiness job: past due it's grounded and the sub-charter flies its guests (a week of it, on a clear sky)
  const sub = asset?.kind === 'plane' && a && alertFlags(s, a).aw ? subCharterNeed(s, asset.id, 'clear', groundsFrom(s, a)) : null;
  const hz = asset?.kind === 'house' ? hazardOn(s, asset.id) : undefined;
  return {
    labour,
    fromStock,
    toBuy,
    tools,
    freight: { sched, ...(aog ? { aog } : {}), pick },
    total: Math.round(labour + buyTotal + (pick === 'aog' && aog ? aog.cost : sched.cost)),
    aog: aogNow,
    ...(sub ? { sub: { flights: sub.flights, fee: sub.fee, usd: sub.usd } } : {}),
    shut: !!hz && hz.id === a?.id && !hz.safe,
    ...(down ? { downtime: { flights: down.flights, usd: Math.round(down.usd) } } : {}),
    due: a?.due ?? W,
    ...(a?.mel ? { mel: { until: a.mel.until, ...(a.mel.ext ? { ext: true } : {}) } } : {}),
    budget: { trade: o.role === 'elec' ? 'elec' : 'mech', spent: s.autoSpent[o.role === 'elec' ? 'elec' : 'mech'] ?? 0, of: s.autoBudget[o.role === 'elec' ? 'elec' : 'mech'] ?? 0 },
  };
}

/** a supplier's words on a card line (C draws them) */
export const supplierWords = (v: SupplierId) => {
  const d = SUPPLIERS[v];
  return d.leadAdd ? `${d.short}, +${d.leadAdd} week` : d.short;
};
