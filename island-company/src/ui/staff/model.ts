// What the staff screens say (docs/JOBFLOW.md 15.11): pure reads of the island
// for the analyst's Staff desk and the builders' line on Home. No engine writes.
import { RENO, WARRANTY } from '../../sim/data';
import { underWarranty } from '../../sim/econ';
import { helperQueues } from '../../sim/engine';
import { itemById, priceAt } from '../../sim/items';
import { nextTierProgress } from '../../sim/progression';
import { buildDef, buildSite, crewOf, nextUnit, openBuild, pilotSeats, renoAgainFrom, renoOpen, STAFF, unitLines, working } from '../../sim/staff';
import type { Asset, Build, IslandState, ItemId, Npc, NpcRole, Role } from '../../sim/types';

/** building materials by their short names (the catalog's are the yard's full descriptions) */
export const MATERIAL: Record<string, string> = {
  'BLD-FTG': 'pier footings',
  'BLD-DECK': 'deck and steps',
  'BLD-TIE': 'hurricane ties',
  'BLD-FLASH': 'roof flashing',
  'BLD-TRIM': 'trim, caulk, paint',
  'BLD-SHUT': 'storm shutters',
  'BLD-PILE': 'marine pilings',
  'BLD-MDECK': 'dock decking',
};
export const materialName = (id: ItemId) => MATERIAL[id] ?? itemById(id)?.nomen.split(':')[0] ?? id;

export const ROLE_ICON: Record<NpcRole, string> = { pilot: 'plane', housekeeper: 'house', builder: 'hardhat', helper: 'bolt' };
export const ROLE_WORD: Record<NpcRole, string> = { pilot: 'Pilot', housekeeper: 'Housekeeper', builder: 'Builder', helper: "Electrician's helper" };
export const ROLE_PLURAL: Record<NpcRole, string> = { pilot: 'pilots', housekeeper: 'housekeepers', builder: 'builders', helper: "electrician's helpers" };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const units = (n: number) => (Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1));

/** what a crew member does this week, in a few words ("flies 6: Twin N-12 4 · Cargo C-7 2") */
export function doingNow(s: IslandState, n: Npc): string {
  if (n.start > s.week) return `starts week ${n.start} (giving notice)`;
  if (n.role === 'pilot') {
    const seats = pilotSeats(s);
    const parts: string[] = [];
    let total = 0;
    for (const p of s.assets.filter((a) => a.kind === 'plane')) {
      const k = (seats.get(p.id) ?? []).find((x) => x.npc.id === n.id)?.n ?? 0;
      if (k) parts.push(`${p.name} ${k}`);
      total += k;
    }
    if (!total) return n.skill < STAFF.guestMinSkill && !s.assets.some((a) => a.kind === 'plane' && a.model === 'cargo') ? 'cargo runs only: no cargo plane yet' : 'a spare: every flight has a pilot';
    return `flies ${total}: ${parts.join(' · ')}`;
  }
  if (n.role === 'housekeeper') return `turns over ${plural(STAFF.turnovers[n.skill - 1] ?? 0, 'house')} a week`;
  if (n.role === 'helper') {
    // the planned routine jobs they'd put in at the resolve if nobody else does them (review round 1): theirs, in the
    // resolve's order (the release gate: each helper's line listed the whole crew's queue)
    const elec = s.players.elec?.name ?? 'the electrician';
    const jobs = STAFF.helper.jobs[n.skill - 1] ?? 1;
    const tonight = helperQueues(s).get(n.id) ?? [];
    return tonight.length
      ? `${plural(jobs, 'job')} a week of ${elec}'s plans · tonight: ${tonight.map((o) => `${o.title}${s.assets.find((a) => a.id === o.assetId) ? ` (${s.assets.find((a) => a.id === o.assetId)!.name})` : ''}`).join(', ')}`
      : `${plural(jobs, 'job')} a week of ${elec}'s plans · nothing planned for them tonight`;
  }
  const b = openBuild(s);
  const out = STAFF.output[n.skill - 1] ?? 0;
  return b ? `on ${buildSite(b, s)} · ${units(out)} unit${out === 1 ? '' : 's'} a week` : 'no site work open';
}

/** the island's crew by role against the standard crew for its tier ("2 of 2 pilots") */
export function crewCounts(s: IslandState): { role: NpcRole; have: number; std: number }[] {
  const crew = crewOf(s);
  const std = STAFF.standard[Math.max(1, Math.min(5, s.tier)) - 1];
  return (['pilot', 'housekeeper', 'builder'] as NpcRole[]).map((role) => ({ role, have: crew.filter((n) => n.role === role).length, std: std[role] ?? 0 }));
}

export type UnitRow = {
  k: number;
  state: 'done' | 'working' | 'next' | 'later';
  lines: { item: ItemId; qty: number; name: string }[];
  /** the materials of a unit not started yet: on the shelf, on the supply boat (the week it lands), or still to buy (at list) */
  stock?: { at: 'shelf' } | { at: 'boat'; eta: number } | { at: 'buy'; cost: number };
};

/** the open build's units in order, each with its state and where its materials are (the shelf and the boat are shared out unit by unit) */
export function buildRows(s: IslandState, b: Build): UnitRow[] {
  const def = buildDef(b.id);
  if (!def) return [];
  const shelf = new Map<ItemId, number>();
  const boat = new Map<ItemId, { qty: number; eta: number }[]>();
  const free = (item: ItemId) => {
    if (!shelf.has(item)) shelf.set(item, Math.max(0, (s.inv?.[item]?.on ?? 0) - Object.values(s.inv?.[item]?.res ?? {}).reduce((t, v) => t + v, 0)));
    if (!boat.has(item)) {
      const lots: { qty: number; eta: number }[] = [];
      for (const p of s.pos ?? []) if (p.status === 'open' || p.status === 'held') for (const l of p.lines) if ((l.as ?? l.item) === item && !l.order && l.got === undefined && !l.back) lots.push({ qty: l.qty, eta: p.status === 'held' ? (p.hold ?? p.eta) : p.eta });
      boat.set(item, lots.sort((x, y) => x.eta - y.eta));
    }
  };
  return def.units.map((_, k) => {
    const done = b.done >= k + 1 - 1e-9;
    const drawn = (b.drawn ?? 0) > k;
    const state: UnitRow['state'] = done ? 'done' : drawn ? 'working' : k === (b.drawn ?? 0) ? 'next' : 'later';
    const lines = unitLines(b, k).map((l) => ({ ...l, name: materialName(l.item) }));
    if (drawn) return { k, state, lines };
    let eta = 0;
    let cost = 0;
    for (const l of lines) {
      free(l.item);
      let need = l.qty;
      const onShelf = Math.min(need, shelf.get(l.item)!);
      shelf.set(l.item, shelf.get(l.item)! - onShelf);
      need -= onShelf;
      for (const lot of boat.get(l.item)!) {
        if (need <= 0) break;
        const take = Math.min(need, lot.qty);
        lot.qty -= take;
        need -= take;
        eta = Math.max(eta, lot.eta);
      }
      const x = itemById(l.item);
      if (need > 0) cost += x ? priceAt(x) * need : 0;
    }
    const stock: UnitRow['stock'] = cost > 0 ? { at: 'buy', cost: Math.round(cost) } : eta ? { at: 'boat', eta } : { at: 'shelf' };
    return { k, state, lines, stock };
  });
}

/** a buy for some of the open build's units, less what's free on the shelf or already on order: the lines and their cost */
export function buildBuy(s: IslandState, b: Build, count: number): { lines: { item: ItemId; qty: number }[]; cost: number; units: number } {
  const from = b.drawn ?? 0;
  const need = new Map<ItemId, number>();
  let n = 0;
  for (let k = from; k < Math.min(b.need, from + count); k++) {
    n++;
    for (const l of unitLines(b, k)) need.set(l.item, (need.get(l.item) ?? 0) + l.qty);
  }
  const lines: { item: ItemId; qty: number }[] = [];
  for (const [item, q] of need) {
    const short = q - freeAndComing(s, item);
    if (short > 0) lines.push({ item, qty: short });
  }
  const cost = lines.reduce((t, l) => t + (itemById(l.item) ? priceAt(itemById(l.item)!) * l.qty : 0), 0);
  return { lines, cost: Math.round(cost), units: n };
}

function freeAndComing(s: IslandState, item: ItemId): number {
  const on = s.inv?.[item]?.on ?? 0;
  const res = Object.values(s.inv?.[item]?.res ?? {}).reduce((t, v) => t + v, 0);
  let coming = 0;
  for (const p of s.pos ?? []) if (p.status === 'open' || p.status === 'held') for (const l of p.lines) if ((l.as ?? l.item) === item && !l.order && l.got === undefined && !l.back) coming += l.qty;
  return Math.max(0, on - res) + coming;
}

/** the cash the next tier asks for, while the island hasn't got it (from the tier checklist): a build ahead spends from it */
export function cashGate(s: IslandState): { tier: number; need: number; have: number } | null {
  if (s.project) return null;
  const p = nextTierProgress(s);
  const item = p?.items.find((i) => /^Cash /.test(i.label) && !i.ok);
  if (!item) return null;
  const m = /\/ \$([\d,]+)/.exec(item.label);
  return m ? { tier: s.tier + 1, need: Number(m[1].replace(/,/g, '')), have: s.cash } : null;
}

/** the builders' line for Home ("Builders: 2 of 3 units on cottages 3 and 4 · next 1 × roof flashing, on the supply boat wk 6") */
export function buildLine(s: IslandState): { text: string; tone: 'ok' | 'wait' | 'none'; buy?: { lines: { item: ItemId; qty: number }[]; cost: number } } | null {
  const b = openBuild(s);
  const builders = working(s).filter((n) => n.role === 'builder');
  const hired = crewOf(s).filter((n) => n.role === 'builder');
  if (!b) {
    if (!hired.length) return null;
    return { text: `Builders: no site work open${s.tier >= 3 ? ' · start a cottage?' : ''}`, tone: 'none' };
  }
  const site = buildSite(b, s);
  const head = `${units(b.done)} of ${b.need} units on ${site}`;
  if (!hired.length) return { text: `No builder on the payroll: the site work on ${site} waits (${head.replace(` on ${site}`, '')} done). Hire one on the desk.`, tone: 'wait' };
  const u = nextUnit(s, b);
  if (!u) return { text: `Builders: ${head} · the last unit's materials are on site`, tone: 'ok' };
  const missing = u.lines.filter((l) => l.free < l.qty);
  if (!missing.length) return { text: `Builders: ${head} · next unit's materials on the shelf`, tone: 'ok' };
  const coming = missing.every((l) => l.free + l.coming >= l.qty);
  const words = missing.map((l) => `${l.qty} × ${materialName(l.item)}`).join(', ');
  if (coming) {
    const eta = Math.max(...missing.map((l) => l.eta ?? s.week));
    return { text: `Builders: ${head} · next ${words}, on ${eta <= s.week ? "this week's supply boat" : `the supply boat wk ${eta}`}`, tone: 'ok' };
  }
  // a site two or more tiers ahead (before the next tier's crew project is under way) can wait: no one-tap buy here
  if (b.tier !== undefined && b.tier > s.tier + 1 && s.project?.tier !== b.tier - 1)
    return { text: `Builders: ${head} (for tier ${b.tier}) · next ${words}: not ordered. Buy it on the desk when the cash allows.`, tone: 'wait' };
  const buy = buildBuy(s, b, 1);
  return { text: `Builders: ${head} · next ${words}: not ordered${builders.length ? '' : ' (their start is next week)'}`, tone: 'wait', buy };
}

// ---------------------------------------------------------------------------
// G0: the builder's warranty and renovations, in words every seat reads the same

export type Said = { text: string; tone: 'rust' | 'sea' | 'palm' | 'amber' | '' };

/**
 * A building's warranty line (G0): a house or the generator the builders put up from the Harbor on, a renovated house,
 * or the grid and the generator after their service upgrade. While it runs it loses WARRANTY.decay a week untouched;
 * an ended one is said for 26 weeks, then dropped
 */
export function warrantyLine(s: IslandState, a: Asset): Said | null {
  if (a.warrantyUntil === undefined) return null;
  const who = a.kind === 'house' ? "Builder's warranty" : a.kind === 'grid' ? 'The new transformer and feeder are under warranty' : a.kind === 'generator' ? 'The standby set is under warranty' : 'Under warranty';
  if (underWarranty(s, a))
    return { text: `${who} to week ${a.warrantyUntil}: it loses ${WARRANTY.decay} a week untouched instead of the usual. Guests' wear, storms and incidents still hit it.`, tone: 'palm' };
  if (a.warrantyUntil >= s.week - 26) return { text: `${a.kind === 'house' ? "Its builder's warranty" : 'Its warranty'} ended in week ${a.warrantyUntil}: it wears at the usual rate now.`, tone: '' };
  return null;
}

/** where a house's renovation stands, if it has one on the list or had one recently (null: neither) */
export function renoStatus(s: IslandState, h: Asset, me?: Role): Said | null {
  const elec = me === 'elec' ? 'you' : (s.players.elec?.name ?? 'the electrician');
  const b = renoOpen(s, h.id);
  if (b) {
    if (b.finished !== undefined)
      return {
        text: `The builders finished its renovation in week ${b.finished}. It stays closed until ${elec} ${me === 'elec' ? 'sign' : 'signs'} off the permit final (devices, GFCI and AFCI, labels, the panel directory); then it opens at ${RENO.health} with a ${RENO.warranty}-week warranty.`,
        tone: 'rust',
      };
    if ((b.drawn ?? 0) > 0) return { text: `Closed for its renovation: the builders are on it (${units(b.done)} of ${b.need} units). No guests meanwhile, and it doesn't wear.`, tone: 'rust' };
    const ahead = openBuild(s);
    return { text: `Renovation ordered in week ${b.started}: it stays open until the builders start${ahead && ahead.id !== b.id ? `, after ${buildSite(ahead, s)}` : ', when its materials are in'}.`, tone: 'sea' };
  }
  const last = (s.builds ?? []).filter((x) => x.reno === h.id && x.signed !== undefined).sort((x, y) => y.signed! - x.signed!)[0];
  const again = renoAgainFrom(s, h.id);
  if (last && again > s.week) return { text: `Renovated: its final was signed in week ${last.signed}. One renovation per house every ${RENO.cooldown} weeks: again from week ${again}.`, tone: 'palm' };
  return null;
}
