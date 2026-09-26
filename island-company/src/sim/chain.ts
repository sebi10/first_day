// The part chain: the A&P's own workflow, built as a game system across all
// three seats. In his words: "When I get a task I get a manual. I follow
// manual. If part is gone or missing or damaged: IPC. If part no exist, I
// check in previous logged items on airplane, the maintenance logs, and then
// get engineering approval to put part on airplane."
//
// Pure helpers (no state changes): which planes carry an alteration, what a
// job finds, whether a P/N is the right one for this airplane, prices, whose
// move it is, the task card numbers a puzzle works to, and what the paper-sim
// bots hand in. The state machine itself lives in engine.ts ("Part chain").
//
// Nothing here is stored in the island doc: the airplane (identity, logbooks,
// IPC, AMM, its alteration) is derived from the island seed every time.
import type { ManualCard } from '../puzzles/types';
import {
  aircraftOf,
  ammTaskFor,
  figSb,
  fmtDate,
  ipcFor,
  planeModel,
  plantPart,
  plantRows,
  rowFor,
  taskKeyFor,
  IPC_ATAS,
  MAKER,
  VENDORS,
  type Aircraft,
  type AircraftOpts,
  type AmmTask,
  type AmmTaskKey,
  type Ata,
  type IpcFigure,
  type IpcRow,
} from './aircraft';
import { CATALOG_BY_KIND, CHAIN, ROLE_LABEL } from './data';
import { hashSeed, rng, type Rng } from './rng';
import type { Asset, IslandState, Order, PartChain, Role } from './types';

// ---------------------------------------------------------------------------
// The island's airplanes

/** The ATAs a job on this model can open a chain on (the cargo single has no brake hydraulics job). */
function reachable(model: string): Ata[] {
  const atas = new Set<Ata>();
  for (const [kind, ata] of Object.entries(CHAIN.kinds)) if (CATALOG_BY_KIND[kind]?.targets.includes(model)) atas.add(ata as Ata);
  return IPC_ATAS.filter((a) => atas.has(a));
}

/**
 * About half the island's planes carry one alteration that replaced an IPC
 * assembly (an STC, or the same kit on a field-approved Form 337). Decided
 * from the island seed, per plane: the same on every device, never stored.
 */
export function plantFor(islandSeed: number, assetId: string, model: string): AircraftOpts {
  const m = planeModel(model);
  const r = rng(hashSeed('island-plant', islandSeed, assetId, m));
  if (!r.chance(CHAIN.plantShare)) return {};
  const ata = r.pick(reachable(m));
  return { plant: ata, via: r.chance(CHAIN.fieldShare) ? 'field' : 'stc' };
}

const fleet = new Map<string, Aircraft>();
/**
 * The island's own airplane: identity, logbooks, IPC, AMM and its alteration,
 * derived from the island seed and the asset. Building one writes years of
 * logbooks (a few ms), so each is built once per device and kept.
 */
export function islandAircraft(seed: number, asset: Pick<Asset, 'id' | 'model'>): Aircraft {
  const key = `${seed}|${asset.id}|${asset.model}`;
  let ac = fleet.get(key);
  if (!ac) {
    // a device only ever sees a few islands: a small cap keeps a long session bounded
    if (fleet.size >= 12) fleet.clear();
    fleet.set(key, (ac = aircraftOf(seed, asset.id, asset.model, plantFor(seed, asset.id, asset.model))));
  }
  return ac;
}

export const chainAtaOf = (kind: string): Ata | undefined => CHAIN.kinds[kind] as Ata | undefined;

/** The alteration that replaced this assembly (the right lookup answer is then "not in the IPC"). */
export const plantedOn = (ac: Aircraft, ata: string) => (ac.plant && ac.plant.via !== 'pma' && ac.plant.ata === ata ? ac.plant : undefined);

// ---------------------------------------------------------------------------
// What a job finds

/** The part a chain can be about, per assembly (the logbook research knows each of them). */
const TAGS: Record<Ata, string[]> = { '32-40': ['lining'], '61-10': ['propBolt'], '29-10': ['filter', 'resCap'], '23-10': ['radio'], '24-30': ['generator'] };
/** the assembly the part is in: what the mechanic sees on the airplane */
const ASSY: Record<string, string> = { lining: 'brake', propBolt: 'propeller', filter: 'powerPack', resCap: 'powerPack', radio: 'radio', generator: 'generator' };

type ItemDef = { name: (model: string) => string; how: PartChain['how']; found: string; sided?: 'wheel' | 'engine' };
const ITEMS: Record<string, ItemDef> = {
  lining: { name: () => 'brake linings', how: 'damaged', found: 'worn below minimum, rivets exposed', sided: 'wheel' },
  propBolt: { name: () => 'prop mounting bolts', how: 'damaged', found: 'damaged: two with galled threads, and the AMM calls for a new set', sided: 'engine' },
  filter: { name: () => 'hydraulic filter element', how: 'damaged', found: 'damaged: bypass button extended, the element loaded with metal' },
  resCap: { name: () => 'hydraulic reservoir filler cap', how: 'missing', found: 'missing: the reservoir was left open under the panel' },
  radio: { name: () => 'com radio', how: 'gone', found: 'gone: dead on transmit, and the avionics shop calls it beyond economical repair' },
  generator: { name: (m) => (m === 'cargo' ? 'starter-generator' : 'alternator'), how: 'gone', found: 'gone: no output, armature open', sided: 'engine' },
};

export const itemName = (tag: string, model: string) => ITEMS[tag]?.name(model) ?? 'part';

const CAGE_NAME: Record<string, string> = Object.fromEntries(Object.values(VENDORS).map((v) => [v.cage, v.name]));
const lc = (x: string) => x.charAt(0).toLowerCase() + x.slice(1).toLowerCase();

/** What the job found: which part, and what is on the airplane (the maker's plate on the assembly). */
export function chainFind(ac: Aircraft, ata: Ata, r: Rng): { tag: string; item: string; how: PartChain['how']; found: string } {
  const p = plantedOn(ac, ata);
  const tag = p ? plantPart(ac.model, ata).tag : r.pick(TAGS[ata]);
  const d = ITEMS[tag];
  const side = d.sided === 'wheel' || (d.sided === 'engine' && ac.model === 'twin') ? `${r.pick(['L/H', 'R/H'])} ` : '';
  const name = d.name(ac.model);
  // what a mechanic reads on the assembly at the airplane: the IPC's, or an STC holder's
  let assy: IpcRow | undefined;
  let maker: string;
  if (p) {
    assy = plantRows(ac.model, ata).find((x) => x.tag === ASSY[tag]) ?? plantRows(ac.model, ata)[1];
    maker = p.holder;
  } else {
    assy = rowFor(ipcFor(ac, ata), ASSY[tag]);
    maker = assy?.vendor ? (CAGE_NAME[assy.vendor] ?? MAKER) : MAKER;
  }
  const plate = assy ? ` On the airplane: ${lc(assy.nomen.split(',')[0])} P/N ${assy.pn} (${maker}).` : '';
  const said = `${side}${name} ${d.found}.${plate}`;
  const found = said.charAt(0).toUpperCase() + said.slice(1);
  return { tag, item: name, how: d.how, found };
}

// ---------------------------------------------------------------------------
// Is a P/N the right one for this airplane? (only what the paperwork can tell)

/** the P/N a mechanic who works the book orders: the part in force, then new for old where the book allows it (never a code-3 set) */
export function rightPn(ac: Aircraft, ata: Ata, tag: string): string {
  const p = plantedOn(ac, ata);
  if (p) return p.neededPn;
  const fig = ipcFor(ac, ata);
  let row = rowFor(fig, tag)!;
  for (let guard = 0; guard < 4 && row.supsdBy && row.supsdBy.code !== 3; guard++) {
    const next = fig.rows.find((x) => x.pn === row.supsdBy!.pn);
    if (!next) break;
    row = next;
  }
  return row.pn;
}

export type PartCheck = { ok: boolean; why?: 'displaced' | 'noteff' | 'wrong' | 'unlisted'; text: string };

const effWords = (fig: IpcFigure, eff: string) => [...eff].map((c) => fig.effCodes.find((e) => e.code === c)?.text ?? c).join(', ');

/**
 * Receiving at the airplane: does this P/N go on for this item? The airplane's
 * own paperwork decides (derived from the seed): the IPC effectivity for its
 * S/N and SB status, or, on an assembly an alteration replaced, the STC
 * holder's parts list. `text` is what the mechanic finds when it doesn't.
 */
export function judgePart(ac: Aircraft, ata: Ata, tag: string, pn: string): PartCheck {
  const p = plantedOn(ac, ata);
  const name = itemName(tag, ac.model);
  if (p) {
    if (pn === p.neededPn) return { ok: true, text: `${pn} is the ${p.holder} part` };
    const oem = ipcFor(ac, ata).rows.some((x) => x.pn === pn);
    const assy = plantRows(ac.model, ata).find((x) => x.tag === ASSY[tag]) ?? plantRows(ac.model, ata)[1];
    return oem
      ? {
          ok: false,
          why: 'displaced',
          text: `P/N ${pn} doesn't fit ${ac.registration}: its ${lc(assy.nomen.split(',')[0])} is ${p.holder} P/N ${assy.pn}, and the ${name} for it is ${p.neededPn}, a part the IPC doesn't list`,
        }
      : { ok: false, why: 'wrong', text: `P/N ${pn} isn't the ${name} on ${ac.registration}` };
  }
  const fig = ipcFor(ac, ata);
  const row = fig.rows.find((x) => x.pn === pn);
  if (!row) return { ok: false, why: 'unlisted', text: `P/N ${pn} isn't in IPC Fig ${fig.fig} for ${ac.registration}` };
  if (row.tag !== tag) return { ok: false, why: 'wrong', text: `P/N ${pn} is the ${lc(row.nomen)}, not the ${name}` };
  if (row.np) return { ok: false, why: 'wrong', text: `P/N ${pn} is not procurable (NP): the vendor sent back the next higher assembly's quote` };
  if (row.applies || row.alt) return { ok: true, text: `${pn} is effective for ${ac.registration}` };
  // new for old (INTCHG code 1 or 2) from a part in force is legal; a code-3 part only with its SB set
  const from = fig.rows.find((x) => x.applies && x.supsdBy?.pn === pn);
  if (from && from.supsdBy!.code !== 3) return { ok: true, text: `${pn} supersedes ${from.pn} (INTCHG code ${from.supsdBy!.code})` };
  const ab = [...row.eff].some((c) => c === 'A' || c === 'B');
  return {
    ok: false,
    why: 'noteff',
    text: ab
      ? `P/N ${pn} is not effective for S/N ${ac.serial} (EFF ${row.eff}: ${effWords(fig, row.eff)})`
      : `P/N ${pn} is not effective for ${ac.registration}'s SB status (EFF ${row.eff}: ${effWords(fig, row.eff)}${from ? '; INTCHG code 3, only as the SB set' : ''})`,
  };
}

/** a plausible wrong answer (for the bots): the IPC part on an altered assembly, else the other effectivity's row */
export function wrongPn(ac: Aircraft, ata: Ata, tag: string): string | null {
  const fig = ipcFor(ac, ata);
  if (plantedOn(ac, ata)) return rowFor(fig, tag)?.pn ?? null;
  const same = fig.rows.filter((x) => x.tag === tag && !judgePart(ac, ata, tag, x.pn).ok);
  return same[0]?.pn ?? null;
}

/** "LINING, HEAVY DUTY (METALLIC)" for a P/N, as its parts list prints it */
export function nomenOf(ac: Aircraft, ata: Ata, pn: string): string {
  const row = ipcFor(ac, ata).rows.find((x) => x.pn === pn) ?? plantRows(ac.model, ata).find((x) => x.pn === pn);
  return row?.nomen ?? 'PART';
}

// ---------------------------------------------------------------------------
// Money

const tierMult = (tier: number) => 1 + CHAIN.perTier * (Math.max(1, tier) - 1);
const round10 = (v: number) => Math.round(v / 10) * 10;

/** what the part costs: an STC holder's part more than the OEM one */
export function partPrice(tier: number, ac: Aircraft, ata: Ata, tag: string, pn: string): number {
  const base = CHAIN.price[tag === 'generator' && ac.model === 'cargo' ? 'sg' : tag] ?? 300;
  const ica = plantRows(ac.model, ata).some((x) => x.pn === pn) && !ipcFor(ac, ata).rows.some((x) => x.pn === pn);
  return round10(base * (ica ? CHAIN.icaMult : 1) * tierMult(tier));
}

export const engineeringFee = (tier: number) => round10(CHAIN.fee + CHAIN.feePerTier * Math.max(0, tier - 2));
export const restockFee = (price: number) => Math.max(CHAIN.restockMin, round10(price * CHAIN.restock));

// ---------------------------------------------------------------------------
// Whose move it is

/** who: whose move (null: engineering or the delivery); text: the move in a sentence; short: in a word or two; chip: "Waiting on Cy: approve the part" */
export type ChainMove = { who: Role | null; text: string; short: string; chip: string };

/** the open chain (not the last closed one) */
export const openChain = (s: IslandState) => (s.chain && s.chain.step !== 'done' ? s.chain : null);

/** Where the chain stands, said so every seat knows whose move it is. */
export function chainMove(s: IslandState, c: PartChain): ChainMove {
  const name = (r: Role) => s.players[r]?.name ?? ROLE_LABEL[r];
  const step = c.stepId ? s.orders.find((o) => o.id === c.stepId) : undefined;
  const asset = s.assets.find((a) => a.id === c.assetId);
  const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
  const wait = (r: Role, short: string, text: string): ChainMove => ({ who: r, text, short, chip: `Waiting on ${name(r)}: ${short}` });
  switch (c.step) {
    case 'lookup':
      return wait('mech', 'IPC lookup', `look up the ${c.item} in the IPC`);
    case 'research':
      return wait('mech', 'logbook research', `research the ${c.item} in ${asset?.name ?? 'the plane'}'s logbooks`);
    case 'buy':
      return wait('fin', 'approve the part', `approve the part${c.pn ? ` (${c.pn}${step ? `, ${usd(step.cost)}` : ''})` : ''}`);
    case 'fee':
      return wait('fin', 'approve the engineering fee', `approve the engineering review fee${step ? ` (${usd(step.cost)})` : ''}`);
    case 'review':
      return { who: null, text: 'engineering is reviewing the request: the answer comes when the week resolves', short: 'engineering review', chip: 'Engineering review: answer next week' };
    case 'transit': {
      const cargo = s.assets.find((a) => a.model === 'cargo');
      const carrier = cargo ? 'cargo' : 'guest';
      // the plane that would carry it is the one that's down: a boat brings it
      const boat = cargo ? cargo.id === c.assetId : true;
      return {
        who: null,
        text: boat ? `the part comes by boat when the week resolves` : `the part rides the next ${carrier} flight`,
        short: 'delivery',
        chip: boat ? 'Part on the boat: arrives when the week resolves' : `Part on the next ${carrier} flight`,
      };
    }
    case 'install':
      return wait('mech', 'install the part', `install ${c.pn}, then finish ${c.title}`);
    case 'done':
      return { who: null, text: 'installed', short: 'installed', chip: 'Part installed' };
  }
}

/** The steps as the stepper draws them (the research and engineering steps only when the IPC didn't have it). */
export function chainSteps(c: PartChain): { key: string; label: string; state: 'done' | 'now' | 'todo' }[] {
  const research = c.step === 'research' || c.step === 'fee' || c.step === 'review' || c.src === 'eng' || c.src === 'entry' || c.rejects > 0;
  const keys: [string, string][] = [
    ['found', 'Found'],
    ['lookup', 'IPC'],
    ...(research
      ? ([
          ['research', 'Logbooks'],
          ['review', 'Engineering'],
        ] as [string, string][])
      : []),
    ['buy', 'Buy'],
    ['transit', 'Delivery'],
    ['install', 'Install'],
  ];
  const at: Record<string, number> = { lookup: 1, research: 2, fee: research ? 3 : 2, review: 3, buy: research ? 4 : 2, transit: research ? 5 : 3, install: research ? 6 : 4, done: 99 };
  const now = at[c.step];
  return keys.map(([key, label], i) => ({ key, label, state: i < now ? 'done' : i === now ? 'now' : 'todo' }));
}

// ---------------------------------------------------------------------------
// The manual: the task card a job works to

/** the fastener a job's torque step is about, by task card */
const TORQUE_STEP: Record<AmmTaskKey, (model: string) => string> = {
  wheel: () => 'tieNut',
  brake: () => 'backPlateBolt',
  prop: () => 'propBolt',
  powerpack: () => 'filterBowl',
  radio: () => 'lockScrew',
  alternator: (m) => (m === 'cargo' ? 'vband' : 'pulleyNut'),
};

/** The AMM task card for a mechanic job on a plane (by its kind or its puzzle's job), or undefined. */
export function taskCardFor(ac: Aircraft, job: string): AmmTask | undefined {
  if (!taskKeyFor(job)) return undefined;
  // an inspection's card is the wheel task only by alias; the 100-hr isn't a wheel job
  if (job === 'inspect100') return undefined;
  return ammTaskFor(ac, job);
}

/** The card's numbers for a card-driven puzzle (torque, hydraulic servicing), both effectivities as printed. */
export function manualCard(ac: Aircraft, job: string, puzzle: string, marked: boolean): ManualCard | undefined {
  const t = taskCardFor(ac, job);
  if (!t) return undefined;
  const card: ManualCard = {
    reg: ac.registration,
    serial: ac.serial,
    task: `AMM ${t.taskNo}`,
    marked,
    // the SB this card's C/D lines turn on first
    sbs: ac.sbs
      .filter((x) => x.ipcAta)
      .sort((a, b) => Number(b.ipcAta === t.ata) - Number(a.ipcAta === t.ata))
      .map((x) => x.id),
  };
  if (puzzle === 'torque') {
    const key = TORQUE_STEP[t.key](ac.model);
    const lines = t.torques.filter((q) => q.key === key);
    if (!lines.length) return undefined;
    card.torque = { key, what: lines[0].what, lines: lines.map((q) => ({ eff: q.eff, effText: q.effText, lo: q.lo, hi: q.hi, unit: q.unit, note: q.note, applies: q.applies })) };
  } else if (puzzle === 'hydraulics') {
    const pc = t.servicing.filter((x) => x.key === 'precharge');
    const fl = t.servicing.filter((x) => x.key === 'fluid');
    if (pc.length) card.precharge = { what: pc[0].what, lines: pc.map((x) => ({ eff: x.eff, effText: x.effText, psi: x.psi!, refTemp: x.refTemp!, applies: x.applies })) };
    if (fl.length) card.fluid = { lines: fl.map((x) => ({ eff: x.eff, effText: x.effText, fluids: x.fluids!, applies: x.applies })) };
    if (!pc.length && !fl.length) return undefined;
  } else return undefined;
  return card;
}

/** "SB IC310-32-07 complied 03/14/2021" or "not complied", for the data plate */
export function sbStatus(ac: Aircraft, ata: Ata): string {
  const id = figSb(ac.model, ata).id;
  const sb = ac.sbs.find((x) => x.id === id);
  return sb ? `${id} complied ${fmtDate(sb.date)}` : `${id} not complied`;
}

// ---------------------------------------------------------------------------
// The paper-sim bots play the chain too

/**
 * What a bot hands in for a chain step, given its skill: the lookup's P/N (or
 * "not in the IPC"), the research's engineering request. Right with a chance
 * that grows with skill; the wrong answers are the ones people really make.
 */
export function botChainData(ac: Aircraft, c: PartChain, step: 'lookup' | 'research', skill: number, r: Rng): Record<string, unknown> {
  const ata = c.ata as Ata;
  const right = r.chance(Math.min(0.97, Math.max(0.2, 0.25 + 0.7 * skill)));
  const p = plantedOn(ac, ata);
  if (step === 'lookup') {
    if (right) return { chain: p ? { outcome: 'notipc' } : { outcome: 'pn', pn: rightPn(ac, ata, c.tag) } };
    const w = wrongPn(ac, ata, c.tag);
    return { chain: w ? { outcome: 'pn', pn: w } : { outcome: 'notipc' } };
  }
  if (p) {
    if (right) return { chain: { route: 'eng', verdict: 'approved', pn: p.neededPn, cite: p.ref } };
    // most slips go to engineering and come back; some sign the ICA part on with a logbook entry
    return r.chance(0.8)
      ? { chain: { route: 'eng', verdict: 'returned', reason: 'Entry cited does not support the request.', pn: p.neededPn } }
      : { chain: { route: 'ipc', verdict: 'serious', pn: p.neededPn } };
  }
  const pn = rightPn(ac, ata, c.tag);
  if (right) return { chain: { route: 'ipc', verdict: 'signed', pn } };
  return { chain: { route: 'eng', verdict: 'unneeded', reason: `Not needed: ${pn} is in the IPC for this aircraft.`, pn } };
}

/** chain step orders are paperwork on the chain, not work on the asset */
export const isChainStep = (o: Pick<Order, 'chain'>) => !!o.chain && o.chain.step !== 'job';
