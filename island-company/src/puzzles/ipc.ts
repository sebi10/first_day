// Mechanic · Parts lookup (IPC). The mechanic's own workflow: "When I get a
// task I get a manual. I follow manual. If part is gone or missing or damaged:
// IPC. If part no exist, I check in previous logged items on airplane, the
// maintenance logs, and then get engineering approval to put part on airplane."
//
// A squawk names a worn or broken part. Find it on the exploded view (pinch,
// drag, tap a callout), read its rows in the parts list, decide which
// effectivity codes fit THIS airplane (S/N on the data plate, SB status in the
// records), follow SUPSD BY (interchangeability codes 1/2/3) and NP (order the
// next higher assembly or kit), set the quantity (units per assembly x the
// assemblies the AMM says to do) and Order. From tier 4 the assembly may have
// been replaced by an STC: the part is not in the IPC at all, and the only
// trail is the logbook entry, the Form 337 and the STC holder's ICA parts list,
// cited on an engineering-approval request.
//
// Tiers 0-2 teach (the callout is circled, effectivity is explained, notes are
// spelled out, the record entry that matters is flagged). From tier 3 the
// player gets only what a mechanic really gets: a squawk, the book and the
// airplane's records.
import { hashSeed, rng } from '../sim/rng';
import {
  aircraftOf,
  ammTaskFor,
  fmtDate,
  ipcFor,
  orderFor,
  reviewRequest,
  searchLog,
  taskKeyFor,
  INTCHG,
  IPC_ATAS,
  type Aircraft,
  type Alteration,
  type AmmTask,
  type AmmTaskKey,
  type ArtItem,
  type ArtShape,
  type Ata,
  type IpcFigure,
  type IpcRow,
  type LogEntry,
  type PlaneModel,
} from '../sim/aircraft';
import { C, FONT, clamp, loop, markInput, pointer, settle, stage } from './kit';
import { result, type PuzzleContext, type PuzzleDef, type PuzzleResult } from './types';

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

type CaseDef = {
  key: string;
  ata: Ata;
  /** the figure callout of the damaged part (variants add "A") */
  item: string;
  /** plain name for teaching lines */
  name: string;
  task: AmmTaskKey;
  models?: PlaneModel[];
  /** the squawk names a side: a main wheel, or an engine on the twin */
  sided?: 'wheel' | 'engine';
  /** assemblies the job covers when the AMM says so (both mains together) */
  mult?: number;
  /** the squawk does not name the part: the AMM does */
  manual?: boolean;
  squawk: (side: string) => string;
};

/** The jobs a squawk can bring to the IPC. Every one is illustrated on its figure. */
export const IPC_CASES: CaseDef[] = [
  // 32-40 main wheels and brakes
  { key: 'tire', ata: '32-40', item: '13', name: 'main tire', task: 'wheel', sided: 'wheel', squawk: (s) => `${s}main tire worn to the cord on the outboard shoulder.` },
  { key: 'bearing', ata: '32-40', item: '8', name: 'bearing cones', task: 'wheel', sided: 'wheel', squawk: (s) => `${s}main wheel bearing cones pitted and heat-discolored; cups serviceable.` },
  { key: 'seal', ata: '32-40', item: '10', name: 'grease seals', task: 'wheel', sided: 'wheel', squawk: (s) => `${s}main wheel grease seals torn; grease slung onto the brake.` },
  { key: 'tieNut', ata: '32-40', item: '5', name: 'tie-bolt nuts', task: 'wheel', sided: 'wheel', squawk: (s) => `${s}main wheel: every tie-bolt nut turns on by hand at the tire change.` },
  { key: 'disc', ata: '32-40', item: '12', name: 'brake disc', task: 'brake', sided: 'wheel', squawk: (s) => `${s}brake disc worn below minimum thickness and heat-checked.` },
  { key: 'halfOuter', ata: '32-40', item: '6', name: 'outer wheel half', task: 'wheel', sided: 'wheel', squawk: (s) => `${s}main wheel outer half cracked at a tie-bolt hole (found at the tire change).` },
  { key: 'halfInner', ata: '32-40', item: '7', name: 'inner wheel half', task: 'wheel', sided: 'wheel', squawk: (s) => `${s}main wheel inner half cracked in the bead-seat radius.` },
  { key: 'lining', ata: '32-40', item: '21', name: 'brake linings', task: 'brake', sided: 'wheel', mult: 2, squawk: (s) => `${s}main brake linings worn below minimum, rivets exposed.` },
  { key: 'anchor', ata: '32-40', item: '24', name: 'anchor bolts', task: 'brake', sided: 'wheel', squawk: (s) => `${s}brake anchor bolts grooved; the cylinder binds on them.` },
  // 61-10 propeller
  { key: 'propBolt', ata: '61-10', item: '12', name: 'prop mounting bolts', task: 'prop', sided: 'engine', squawk: (s) => `${s}propeller off for a hub O-ring leak; mounting bolt threads galled. Replace all six.` },
  { key: 'hub', ata: '61-10', item: '3', name: 'propeller hub', task: 'prop', sided: 'engine', squawk: (s) => `${s}propeller hub arm cracked at the AD inspection; hub not repairable.` },
  { key: 'bulkhead', ata: '61-10', item: '8', name: 'forward spinner bulkhead', task: 'prop', sided: 'engine', squawk: (s) => `${s}spinner forward bulkhead cracked at three screw holes.` },
  { key: 'dome', ata: '61-10', item: '7', name: 'spinner dome', task: 'prop', sided: 'engine', squawk: (s) => `${s}spinner dome cracked at the tip.` },
  { key: 'hubOring', ata: '61-10', item: '14', name: 'hub O-ring', task: 'prop', sided: 'engine', manual: true, squawk: (s) => `${s}propeller goes back on after the engine change.` },
  // 29-10 hydraulic power pack
  { key: 'filter', ata: '29-10', item: '9', name: 'filter element', task: 'powerpack', squawk: () => 'Hydraulic filter bypass button extended at the inspection.' },
  { key: 'resCap', ata: '29-10', item: '6', name: 'reservoir filler cap', task: 'powerpack', squawk: () => 'Hydraulic reservoir filler cap cracked; fluid weeping at the cap.' },
  { key: 'relief', ata: '29-10', item: '11', name: 'relief valve', task: 'powerpack', squawk: () => 'Power pack relief valve cracks below limits on the bench.' },
  { key: 'motor', ata: '29-10', item: '3', name: 'pump motor', task: 'powerpack', squawk: () => 'Power pack motor stalls under load; commutator burnt.' },
  { key: 'pswitch', ata: '29-10', item: '12', name: 'pressure switch', task: 'powerpack', squawk: () => 'Power pack pressure switch fails to cut out; the pump runs on.' },
  { key: 'isolator', ata: '29-10', item: '18', name: 'shock-mount isolators', task: 'powerpack', squawk: () => 'Power pack shock-mount isolators cracked and oil-soaked, all of them.' },
  // 23-10 VHF com
  { key: 'radio', ata: '23-10', item: '2', name: 'com transceiver', task: 'radio', squawk: () => 'Com 1 dead on transmit; the avionics shop reports it beyond economical repair.' },
  { key: 'backplate', ata: '23-10', item: '6', name: 'tray backplate', task: 'radio', squawk: () => 'Com mounting tray backplate cracked at the connector mount.' },
  { key: 'lockScrew', ata: '23-10', item: '5', name: 'cam-lock screw', task: 'radio', squawk: () => 'Com cam-lock screw stripped; the unit will not seat.' },
  { key: 'connector', ata: '23-10', item: '4', name: 'tray connector', task: 'radio', squawk: () => 'Com tray connector: pins 3 and 4 burnt.' },
  { key: 'tray', ata: '23-10', item: '3', name: 'mounting tray', task: 'radio', squawk: () => 'Com mounting tray guide rails bent; the unit binds going in.' },
  // 24-30 alternator (piston) / starter-generator (turbine)
  { key: 'alternator', ata: '24-30', item: '2', name: 'alternator', task: 'alternator', models: ['twin', 'float'], sided: 'engine', squawk: (s) => `${s}alternator no output: open diodes; the shop recommends replacement.` },
  { key: 'rectifier', ata: '24-30', item: '7', name: 'rectifier', task: 'alternator', models: ['twin', 'float'], sided: 'engine', squawk: (s) => `${s}alternator bench test: rectifier failed.` },
  { key: 'belt', ata: '24-30', item: '8', name: 'V-belt', task: 'alternator', models: ['twin', 'float'], sided: 'engine', squawk: (s) => `${s}alternator belt glazed and cracked.` },
  { key: 'arm', ata: '24-30', item: '9', name: 'adjusting arm', task: 'alternator', models: ['twin', 'float'], sided: 'engine', squawk: (s) => `${s}alternator adjusting arm cracked at the slot.` },
  { key: 'pulleyNut', ata: '24-30', item: '5', name: 'pulley nut', task: 'alternator', models: ['twin', 'float'], sided: 'engine', squawk: (s) => `${s}alternator pulley nut threads damaged at removal.` },
  { key: 'brushes', ata: '24-30', item: '6', name: 'brush assembly', task: 'alternator', models: ['twin', 'float'], sided: 'engine', squawk: (s) => `${s}alternator brushes worn below minimum length.` },
  { key: 'sg', ata: '24-30', item: '2', name: 'starter-generator', task: 'alternator', models: ['cargo'], squawk: () => 'Starter-generator: no generator output, armature open.' },
  { key: 'shaft', ata: '24-30', item: '4', name: 'drive shaft', task: 'alternator', models: ['cargo'], squawk: () => 'Starter-generator drive shaft shear section twisted.' },
  { key: 'qad', ata: '24-30', item: '6', name: 'QAD adapter', task: 'alternator', models: ['cargo'], squawk: () => 'Starter-generator QAD adapter cracked at a stud boss.' },
  { key: 'sgBrushes', ata: '24-30', item: '3', name: 'brush set', task: 'alternator', models: ['cargo'], squawk: () => 'Starter-generator brushes at the wear limit.' },
  { key: 'vband', ata: '24-30', item: '7', name: 'V-band clamp', task: 'alternator', models: ['cargo'], squawk: () => 'Starter-generator V-band clamp: T-bolt threads stripped.' },
];

export type Expected = {
  pn: string;
  qty: number;
  /** figure item (or ICA item) it is listed under */
  item: string;
  nomen: string;
  /** P/Ns that fill this line (the part and its IPC alternates) */
  accept: string[];
  /** INTCHG CODE 1 predecessor: legal, but not the current P/N */
  old?: string;
};

export type IpcFeatures = {
  /** the answer depends on the S/N (codes A/B) */
  effAB: boolean;
  /** the answer depends on SB status (codes C/D) */
  effCD: boolean;
  /** highest interchangeability code on the way (0 = none) */
  sup: 0 | 1 | 2 | 3;
  np: boolean;
  set: boolean;
  alt: boolean;
  mult: boolean;
  manual: boolean;
};

export type IpcModel = {
  tier: number;
  ac: Aircraft;
  ata: Ata;
  fig: IpcFigure;
  task: AmmTask;
  caseKey: string;
  /** callout of the damaged part */
  item: string;
  name: string;
  squawk: string;
  /** assemblies the job covers */
  mult: number;
  /** the AMM line that sets mult */
  multWhy?: string;
  /** the part-number chain the book leads through: fitting row -> NP / SUPSD BY -> order */
  path: string[];
  expect: Expected[];
  features: IpcFeatures;
  difficulty: number;
  /** effectivity codes that fit this airplane */
  marks: { ab: 'A' | 'B'; cd: 'C' | 'D' };
  /** step-by-step reasoning, for teaching and the verdict */
  why: string[];
  /** the part is not in the IPC: an STC replaced the assembly */
  planted: boolean;
  alteration?: Alteration;
  // teaching (tiers 0-2)
  teach: boolean;
  circled: boolean;
  premarked: boolean;
  /** a current SB compliance list is in the records (tier 5: logbooks only) */
  compliance: boolean;
};

const ASSET_OF: Record<PlaneModel, string> = { twin: 'p1', cargo: 'p2', float: 'p3' };

function modelFromName(name?: string): PlaneModel | undefined {
  const n = (name ?? '').toLowerCase();
  if (n.includes('cargo')) return 'cargo';
  if (n.includes('float')) return 'float';
  if (n.includes('twin')) return 'twin';
  return undefined;
}

const upaOf = (r: IpcRow) => (typeof r.upa === 'number' ? r.upa : 1);
export const baseItem = (item: string) => item.replace(/A$/, '');

/** Work one callout through the book: the row that fits, then NP / SUPSD BY to what can be ordered. */
export function solveItem(fig: IpcFigure, item: string, mult: number) {
  const rowOf = (pn: string) => fig.rows.find((r) => r.pn === pn)!;
  const vars = fig.rows.filter((r) => baseItem(r.item) === item && !r.alt);
  const start = vars.find((r) => r.applies) ?? vars[0];
  const o = orderFor(fig, start.pn)!;
  const final = rowOf(o.pn);
  const pathRows = o.path.map(rowOf);
  const accept = [final.pn, ...fig.rows.filter((r) => r.alt === final.pn).map((r) => r.pn)];
  let sup: 0 | 1 | 2 | 3 = 0;
  for (const r of pathRows) if (r.supsdBy && r.supsdBy.code > sup) sup = r.supsdBy.code;
  const main: Expected = { pn: final.pn, qty: upaOf(final) * mult, item: final.item, nomen: final.nomen, accept };
  if (start.supsdBy?.code === 1 && start.supsdBy.pn === final.pn) main.old = start.pn;
  const expect = [main];
  let companion: IpcRow | undefined;
  if (o.asSet) {
    const note = pathRows.flatMap((r) => r.notes).find((n) => /AS A SET WITH ITEM/.test(n));
    const it = note ? /ITEM (\w+)/.exec(note)?.[1] : undefined;
    companion = it ? fig.rows.find((r) => r.item === it) : undefined;
    if (companion) expect.push({ pn: companion.pn, qty: upaOf(companion) * mult, item: companion.item, nomen: companion.nomen, accept: [companion.pn] });
  }
  const has = (codes: string) => [...vars, ...pathRows].some((r) => [...r.eff].some((c) => codes.includes(c)));
  const features: IpcFeatures = {
    effAB: has('AB'),
    effCD: has('CD'),
    sup,
    np: pathRows.some((r) => r.np),
    set: expect.length > 1,
    alt: accept.length > 1,
    mult: mult > 1,
    manual: false,
  };
  return { start, path: o.path, pathRows, expect, features, companion };
}

export function difficultyOf(f: IpcFeatures): number {
  return (f.effAB ? 1 : 0) + (f.effCD ? 1 : 0) + f.sup + (f.np ? 2 : 0) + (f.set ? 1 : 0) + (f.mult ? 1 : 0) + (f.manual ? 1 : 0);
}

/** difficulty band each tier draws from */
const BAND: [number, number][] = [
  [0, 0],
  [1, 1],
  [2, 3],
  [3, 5],
  [3, 7],
  [4, 9],
];

const CODE_SHORT: Record<1 | 2 | 3, string> = { 1: 'two-way', 2: 'one-way, new for old only', 3: 'only as a set, after the SB' };

const effText = (fig: IpcFigure, code: string) => fig.effCodes.find((e) => e.code === code)?.text ?? code;

/** effectivity codes that fit, in words: "S/N 310R0938: code B (S/N 310R0520 AND ON)" */
export function effReasons(m: Pick<IpcModel, 'ac' | 'fig' | 'marks'>): { ab: string; cd: string } {
  const sbId = effText(m.fig, 'C').replace(/^POST /, '');
  const sb = m.ac.sbs.find((s) => s.id === sbId);
  return {
    ab: `S/N ${m.ac.serial} → ${m.marks.ab} (${effText(m.fig, m.marks.ab)})`,
    cd: sb ? `${sbId} complied ${fmtDate(sb.date)} → C` : `${sbId} not complied → D`,
  };
}

/** every job this assembly can bring, worked through the book for this airplane */
function solveCases(ac: Aircraft, ata: Ata) {
  const fig = ipcFor(ac, ata);
  const drawn = new Set(fig.art.map((a) => a.item));
  return IPC_CASES.filter((c) => c.ata === ata && (!c.models || c.models.includes(ac.model)) && drawn.has(c.item) && fig.rows.some((x) => baseItem(x.item) === c.item)).map((c) => {
    const task = ammTaskFor(ac, c.task);
    const mult = c.mult ?? 1;
    const s = solveItem(fig, c.item, mult);
    s.features.manual = !!c.manual;
    return { c, task, mult, s, d: difficultyOf(s.features) };
  });
}

export function generateIpc(seed: number, tier: number, _tools: string[] = [], ctx: PuzzleContext = {}): IpcModel {
  const t = clamp(Math.round(tier), 0, 5);
  const r = rng(hashSeed('ipc', seed, t));
  const given = ctx.aircraft;
  const model: PlaneModel = given?.model ?? modelFromName(ctx.assetName) ?? r.pick(['twin', 'cargo', 'float'] as const);
  const assetId = given?.assetId ?? ASSET_OF[model];
  const islandSeed = given?.islandSeed ?? hashSeed('ipc-island', seed) % 1000003;
  let ac = given ?? aircraftOf(islandSeed, assetId, model);
  const [lo, hi] = BAND[t];
  const off = (d: number) => (d < lo ? lo - d : d > hi ? d - hi : 0);
  // "If part no exist": from tier 4 an STC may have replaced the assembly. The island's
  // own airplane (context) is used as it is; a seeded one is planted here.
  const plantRoll = r.next();
  const plantIt = !given && t >= 4 && plantRoll < (t >= 5 ? 0.5 : 0.35);
  // the assembly: the work order's, else the one an island STC replaced, else one with a job at this tier
  const key = ctx.job ? taskKeyFor(ctx.job) : undefined;
  let ata: Ata;
  if (key) ata = ammTaskFor(ac, key).ata;
  else if (given?.plant) ata = given.plant.ata;
  else if (plantIt) ata = r.pick(IPC_ATAS);
  else {
    const fits = IPC_ATAS.filter((a) => solveCases(ac, a).some((x) => off(x.d) === 0));
    ata = r.pick(fits.length ? fits : IPC_ATAS);
  }
  let planted = !!given?.plant && given.plant.ata === ata;
  if (plantIt) {
    ac = aircraftOf(islandSeed, assetId, model, { plant: ata });
    planted = true;
  }
  const fig = ipcFor(ac, ata);
  const solved = solveCases(ac, ata);
  let pick: (typeof solved)[number];
  if (planted) {
    const item = baseItem(fig.rows.find((x) => x.pn === ac.plant!.ipcPn)!.item);
    pick = solved.find((x) => x.c.item === item)!;
  } else {
    // teaching tiers stay on their one idea; from tier 2 a near miss can still come up, so a
    // mechanic who gets the same kind of work order does not always get the same part
    const best = Math.min(...solved.map((x) => off(x.d)));
    pick =
      t <= 1
        ? r.pick(solved.filter((x) => off(x.d) === best))
        : r.weighted(solved, (x) => [1, 0.3, 0.06][off(x.d) - best] ?? 0)!;
  }
  const { c, task, mult, s } = pick;
  const side = r.pick(['L/H', 'R/H'] as const);
  const prefix = c.sided === 'wheel' || (c.sided === 'engine' && ac.model === 'twin') ? `${side} ` : '';
  const sq = c.squawk(prefix);
  const squawk = sq.charAt(0).toUpperCase() + sq.slice(1);
  const multWhy = mult > 1 ? task.cautions.find((x) => /both main wheels/i.test(x)) : undefined;
  const marks = {
    ab: fig.effCodes.find((e) => (e.code === 'A' || e.code === 'B') && e.applies)!.code as 'A' | 'B',
    cd: fig.effCodes.find((e) => (e.code === 'C' || e.code === 'D') && e.applies)!.code as 'C' | 'D',
  };

  let expect = s.expect;
  let alteration: Alteration | undefined;
  const why: string[] = [];
  const effLine = (row: IpcRow) => (row.eff ? ` (EFF ${row.eff}: ${[...row.eff].map((x) => effText(fig, x)).join(', ')})` : '');
  if (planted) {
    alteration = ac.alterations.find((a) => a.displaces === ata)!;
    const p = ac.plant!;
    const row = alteration.parts!.find((x) => x.pn === p.neededPn)!;
    expect = [{ pn: row.pn, qty: upaOf(row) * mult, item: row.item, nomen: row.nomen, accept: [row.pn] }];
    why.push(`${ac.registration} carries STC ${p.stc} (${p.holder}), Form 337 dated ${fmtDate(p.form337)}: ${alteration.title.toLowerCase()}.`);
    why.push(`The IPC lists ${p.ipcPn}; the ${p.item.toLowerCase()} really installed is ${p.neededPn}, listed only in ${p.ica}.`);
    why.push(`Engineering approves it on the STC, the 337 and the logbook entry of ${fmtDate(alteration.date)}.`);
  } else {
    why.push(`The squawked part is item ${s.start.item}, ${s.start.pn} (${s.start.nomen.toLowerCase()})${effLine(s.start)}.`);
    for (let i = 1; i < s.pathRows.length; i++) {
      const prev = s.pathRows[i - 1];
      const row = s.pathRows[i];
      if (prev.np) why.push(`${prev.pn} is NP: order item ${row.item}, ${row.pn}${effLine(row)}.`);
      else if (prev.supsdBy) why.push(`${prev.pn} SUPSD BY ${row.pn}, INTCHG CODE ${prev.supsdBy.code} (${CODE_SHORT[prev.supsdBy.code]}): order ${row.pn}.`);
    }
    if (s.companion) why.push(`Code 3: order it as a set with item ${s.companion.item}, ${s.companion.pn}.`);
  }
  const e0 = expect[0];
  const upa = e0.qty / mult;
  why.push(`Qty ${e0.qty}: UPA ${upa}${mult > 1 ? ` × ${mult} (AMM: ${(multWhy ?? 'both sides').replace(/\.$/, '').toLowerCase()})` : ''}.`);

  return {
    tier: t,
    ac,
    ata,
    fig,
    task,
    caseKey: c.key,
    item: c.item,
    name: c.name,
    squawk,
    mult,
    multWhy,
    path: s.path,
    expect,
    features: s.features,
    difficulty: planted ? 7 : pick.d,
    marks,
    why,
    planted,
    alteration,
    teach: t <= 2,
    circled: t <= 2,
    premarked: t <= 1,
    compliance: t <= 4,
  };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export type OrderLine = { pn: string; qty: number; src: 'ipc' | 'ica' };
export type IpcAttempt = {
  lines: OrderLine[];
  marks: { ab?: 'A' | 'B'; cd?: 'C' | 'D' };
  /** logbook entry cited on the engineering-approval request (ICA parts) */
  cite?: string;
  /** planted case: an IPC part already came back "not the part on this airplane" */
  revealed?: boolean;
};
export type IpcNote = { ok: boolean; text: string };
export type IpcScore = {
  score: number;
  /** the order would put a wrong part on the airplane (latent defect) */
  fault: string | null;
  notes: IpcNote[];
  summary: string;
  parts: { pn: number; qty: number; reason: number };
};

/** Why a line is a wrong part for this airplane, or null. */
export function lineFault(m: IpcModel, l: OrderLine): string | null {
  if (l.src === 'ica') return m.planted ? null : `${l.pn} is not approved for this airplane`;
  const r = m.fig.rows.find((x) => x.pn === l.pn);
  if (!r) return `${l.pn} is not in IPC Fig ${m.fig.fig}`;
  if (m.planted && baseItem(r.item) === m.item) return `${l.pn} is the IPC part, but STC ${m.alteration!.stc} replaced that assembly`;
  if (r.np) return `${r.pn} is NP: ${r.notes.find((n) => n.startsWith('NP'))!.replace('NP — ', '').replace(/^ORDER/, 'order')}`;
  if (r.upa === 'RF') return `${r.pn} is the installation reference, not a part`;
  if (r.supsdBy && r.supsdBy.code !== 1) return `${r.pn} is superseded by ${r.supsdBy.pn} (INTCHG CODE ${r.supsdBy.code})`;
  if (!r.applies) return `${r.pn} is EFF ${r.eff}: not for this airplane`;
  return null;
}

/** planted case: an IPC order comes back from the airplane as "part no exist" */
export function wouldReveal(m: IpcModel, a: Pick<IpcAttempt, 'lines' | 'revealed'>): boolean {
  return m.planted && !a.revealed && a.lines.some((l) => l.src === 'ipc');
}

export function scoreIpc(m: IpcModel, a: IpcAttempt): IpcScore {
  const notes: IpcNote[] = [];
  let fault: string | null = null;
  const used = new Set<number>();
  const w = m.expect.length > 1 ? [0.7, 0.3] : [1];
  let pn = 0;
  let qty = 0;
  const hit: boolean[] = [];
  m.expect.forEach((e, i) => {
    let li = a.lines.findIndex((l, j) => !used.has(j) && e.accept.includes(l.pn) && l.src === (m.planted ? 'ica' : 'ipc'));
    let credit = 1;
    if (li < 0 && e.old) {
      li = a.lines.findIndex((l, j) => !used.has(j) && l.pn === e.old);
      credit = 0.5;
    }
    hit[i] = li >= 0;
    if (li < 0) {
      notes.push({ ok: false, text: `Needed ${e.pn} × ${e.qty} (${m.planted ? 'ICA' : 'Fig ' + m.fig.fig} item ${e.item}, ${e.nomen.toLowerCase()})` });
      return;
    }
    used.add(li);
    const l = a.lines[li];
    pn += w[i] * credit;
    if (credit < 1) notes.push({ ok: false, text: `${l.pn} is superseded by ${e.pn} (code 1, two-way): legal, but order the current P/N` });
    else notes.push({ ok: true, text: `${l.pn}: ${e.nomen.toLowerCase()}${i > 0 ? ' (the code-3 set)' : ''}` });
    if (l.qty === e.qty) {
      qty += 1 / m.expect.length;
      notes.push({ ok: true, text: `Qty ${l.qty}` });
    } else notes.push({ ok: false, text: `Qty ${l.qty}: needs ${e.qty} (${m.why[m.why.length - 1].replace(/^Qty \d+: /, '').replace(/\.$/, '')})` });
  });
  let extras = 0;
  a.lines.forEach((l, j) => {
    if (used.has(j)) return;
    const why = lineFault(m, l);
    if (why) {
      fault = fault ?? why;
      notes.push({ ok: false, text: why });
    } else extras++;
  });
  if (!m.planted && m.expect.length > 1 && hit[0] && !hit[1]) {
    const f = `${m.expect[0].pn} is INTCHG code 3: only as a set with ${m.expect[1].pn}`;
    fault = fault ?? f;
  }
  let reason = 0;
  if (m.planted) {
    const e = m.expect[0];
    if (hit[0]) {
      const alt = m.alteration!;
      const rv = reviewRequest(m.ac, { ata: m.ata, pn: e.pn, stc: alt.stc!, form337: alt.form337, entryId: a.cite ?? '' });
      reason = rv.approved ? 1 : 0;
      if (rv.approved) notes.push({ ok: true, text: `Engineering approved: STC ${alt.stc}, 337 of ${fmtDate(alt.form337)}` });
      else notes.push({ ok: false, text: a.cite ? rv.problems[0] : 'No logbook entry cited: engineering holds the part' });
    }
  } else {
    const okAB = a.marks.ab === m.marks.ab;
    const okCD = a.marks.cd === m.marks.cd;
    reason = (okAB ? 0.5 : 0) + (okCD ? 0.5 : 0);
    const ex = effReasons(m);
    if (okAB && okCD) notes.push({ ok: true, text: `Effectivity ${m.marks.ab} · ${m.marks.cd}` });
    else notes.push({ ok: false, text: `Effectivity: ${[okAB ? '' : ex.ab, okCD ? '' : ex.cd].filter(Boolean).join('; ')}` });
  }
  if (a.revealed) notes.push({ ok: false, text: 'The first order was the IPC part and it did not fit: check the records before you order' });
  let s = 0.5 * pn + 0.2 * qty + 0.3 * reason - 0.04 * Math.max(0, extras - 1);
  if (m.planted && hit[0] && reason < 1) s = Math.min(s, 0.55);
  if (a.revealed) s = Math.min(s, 0.8);
  if (fault) s = Math.min(s, 0.35);
  s = clamp(Math.max(s, a.lines.length || a.marks.ab || a.marks.cd ? 0.05 : 0.02), 0, 1);
  const got = m.expect.filter((_, i) => hit[i]);
  const shortPn = got.map((e) => `${e.pn} ×${a.lines.find((l) => e.accept.includes(l.pn) || l.pn === e.old)?.qty ?? 0}`).join(' + ');
  let summary: string;
  if (fault) summary = `Wrong part: ${fault}`;
  else if (!a.lines.length) summary = 'Nothing ordered';
  else if (!got.length) summary = `Not the part: needed ${m.expect[0].pn}`;
  else if (m.planted && reason < 1) summary = `${shortPn}, held: no engineering approval`;
  else if (s >= 0.95) summary = `${shortPn} · right part, qty and ${m.planted ? 'approval' : 'effectivity'}`;
  else if (a.revealed && s >= 0.75) summary = `${shortPn} · approved, after an IPC part that did not fit`;
  else summary = `${shortPn} · ${notes.filter((n) => !n.ok).map((n) => n.text.split(':')[0]).join(', ')}`;
  return { score: s, fault, notes, summary, parts: { pn, qty, reason } };
}

/** the order a mechanic who works the book correctly puts in */
export function perfectAttempt(m: IpcModel): IpcAttempt {
  return {
    lines: m.expect.map((e) => ({ pn: e.pn, qty: e.qty, src: m.planted ? 'ica' : 'ipc' })),
    marks: { ...m.marks },
    cite: m.planted ? m.ac.plant!.entryId : undefined,
  };
}

// ---------------------------------------------------------------------------
// Exploded-view drawing (technical line art on the page)
// ---------------------------------------------------------------------------

type Box = { x: number; y: number; w: number; h: number };
type Mat = 'metal' | 'rubber' | 'friction' | 'dark';
type Look = { body: string; face: string; line: string; hole: string; lw: number };

const K = 0.17; // perspective: ellipse width / height for faces seen at an angle

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

const MATS: Record<Mat, [string, string]> = {
  metal: ['#c3cbce', '#eef1f2'],
  rubber: ['#3d474c', '#5d6a70'],
  friction: ['#9b8568', '#c7b393'],
  dark: ['#34444c', '#56646b'],
};

function lookFor(mat: Mat, state: 'n' | 'sel' | 'hot', lw: number): Look {
  const [b, f] = MATS[mat];
  if (state === 'sel') return { body: mix(b, C.sea, 0.45), face: mix(f, C.sea, 0.35), line: C.seaDeep, hole: C.paper, lw: lw * 1.4 };
  return { body: b, face: f, line: C.ink, hole: C.paper, lw };
}

function matOf(nomen: string, shape: ArtShape): Mat {
  if (/LINING/.test(nomen)) return 'friction';
  if (/TIRE|TUBE|SEAL|O-RING|PACKING|GASKET|ISOLATOR|BELT/.test(nomen)) return 'rubber';
  if (shape === 'radio' || shape === 'cable' || shape === 'connector') return 'dark';
  return 'metal';
}

function ell(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number) {
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(0.6, rx), Math.max(0.6, ry), 0, 0, Math.PI * 2);
}

function paint(ctx: CanvasRenderingContext2D, fill: string, lk: Look) {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = lk.line;
  ctx.lineWidth = lk.lw;
  ctx.stroke();
}

/** A solid of revolution on the x axis between L and R: body, front face, optional bore. */
function drum(ctx: CanvasRenderingContext2D, L: number, R: number, cy: number, ry: number, lk: Look, hole = 0, r2 = ry) {
  const rx = Math.min(ry * K, Math.max(1, (R - L) * 0.5));
  const rx2 = (rx * r2) / ry;
  const x0 = L + rx;
  const x1 = Math.max(x0 + 1.2, R - rx2);
  ctx.beginPath();
  ctx.moveTo(x0, cy - ry);
  ctx.lineTo(x1, cy - r2);
  ctx.ellipse(x1, cy, Math.max(0.6, rx2), r2, 0, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(x0, cy + ry);
  ctx.closePath();
  paint(ctx, lk.body, lk);
  ell(ctx, x0, cy, rx, ry);
  paint(ctx, lk.face, lk);
  if (hole > 0) {
    ell(ctx, x0, cy, rx * hole, ry * hole);
    paint(ctx, lk.hole, lk);
  }
  return { x0, x1, rx };
}

function hexNut(ctx: CanvasRenderingContext2D, b: Box, lk: Look) {
  const ry = b.h / 2;
  const cy = b.y + ry;
  const rx = Math.min(ry * 0.45, b.w * 0.45);
  const x0 = b.x + rx;
  const x1 = Math.max(x0 + 1, b.x + b.w - rx);
  ctx.beginPath();
  ctx.rect(x0, cy - ry, x1 - x0, ry * 2);
  paint(ctx, lk.body, lk);
  ctx.beginPath();
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
    ctx.lineTo(x0 + Math.cos(a) * rx, cy + Math.sin(a) * ry);
  }
  ctx.closePath();
  paint(ctx, lk.face, lk);
  ell(ctx, x0, cy, rx * 0.45, ry * 0.45);
  paint(ctx, lk.hole, lk);
  ctx.beginPath();
  ctx.moveTo(x0, cy - ry * 0.5);
  ctx.lineTo(x1, cy - ry * 0.5);
  ctx.moveTo(x0, cy + ry * 0.5);
  ctx.lineTo(x1, cy + ry * 0.5);
  ctx.lineWidth = lk.lw * 0.6;
  ctx.stroke();
}

function block(ctx: CanvasRenderingContext2D, b: Box, lk: Look, depth = 0.22) {
  const d = Math.min(b.w, b.h) * depth;
  const fx = b.x;
  const fy = b.y + d;
  const fw = b.w - d;
  const fh = b.h - d;
  // top and side faces, then the front
  ctx.beginPath();
  ctx.moveTo(fx, fy);
  ctx.lineTo(fx + d, fy - d);
  ctx.lineTo(fx + fw + d, fy - d);
  ctx.lineTo(fx + fw, fy);
  ctx.closePath();
  paint(ctx, lk.face, lk);
  ctx.beginPath();
  ctx.moveTo(fx + fw, fy);
  ctx.lineTo(fx + fw + d, fy - d);
  ctx.lineTo(fx + fw + d, fy + fh - d);
  ctx.lineTo(fx + fw, fy + fh);
  ctx.closePath();
  paint(ctx, lk.body, lk);
  ctx.beginPath();
  ctx.rect(fx, fy, fw, fh);
  paint(ctx, mix(lk.face.startsWith('#') ? lk.face : '#e9edee', '#c3cbce', 0.35), lk);
  return { fx, fy, fw, fh, d };
}

function drawShape(ctx: CanvasRenderingContext2D, shape: ArtShape, b: Box, lk: Look, mat: Mat) {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const R = b.x + b.w;
  const ry = b.h / 2;
  switch (shape) {
    case 'tire': {
      const d = drum(ctx, b.x, R, cy, ry, lk, 0.56);
      ctx.strokeStyle = lk.line;
      ctx.lineWidth = lk.lw * 0.7;
      ell(ctx, d.x0, cy, d.rx * 0.82, ry * 0.82);
      ctx.stroke();
      for (const f of [-0.93, 0.93]) {
        for (let k = 1; k < 4; k++) {
          const x = d.x0 + ((d.x1 - d.x0) * k) / 4;
          ctx.beginPath();
          ctx.moveTo(x, cy + f * ry);
          ctx.lineTo(x, cy + f * ry * 0.86);
          ctx.stroke();
        }
      }
      break;
    }
    case 'wheelHalf': {
      drum(ctx, b.x + b.w * 0.35, R, cy, ry * 0.3, lk, 0.5);
      drum(ctx, b.x, b.x + b.w * 0.45, cy, ry, lk, 0.3);
      ctx.strokeStyle = lk.line;
      ctx.lineWidth = lk.lw * 0.6;
      const rx = Math.min(ry * K, b.w * 0.22);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        ell(ctx, b.x + rx + Math.cos(a) * rx * 0.62, cy + Math.sin(a) * ry * 0.62, Math.max(0.8, rx * 0.08), ry * 0.05);
        ctx.stroke();
      }
      break;
    }
    case 'disc':
    case 'bulkhead':
      drum(ctx, b.x, R, cy, ry, lk, shape === 'disc' ? 0.62 : 0.45);
      break;
    case 'seal':
      drum(ctx, b.x, R, cy, ry, lk, 0.72);
      break;
    case 'ring':
    case 'belt':
      drum(ctx, b.x, R, cy, ry, lk, shape === 'belt' ? 0.9 : 0.84);
      break;
    case 'washer':
      drum(ctx, b.x, R, cy, ry, lk, 0.5);
      break;
    case 'bearing': {
      const d = drum(ctx, b.x, R, cy, ry * 0.72, lk, 0.62, ry);
      ctx.strokeStyle = lk.line;
      ctx.lineWidth = lk.lw * 0.6;
      for (const f of [-0.84, -0.6, 0.6, 0.84]) {
        ctx.beginPath();
        ctx.moveTo(d.x0 + 1, cy + f * ry * 0.72);
        ctx.lineTo(d.x1, cy + f * ry);
        ctx.stroke();
      }
      break;
    }
    case 'plate': {
      const d = drum(ctx, b.x, R, cy, ry, lk, 0.38);
      for (const f of [-0.72, 0.72]) {
        ell(ctx, d.x0, cy + f * ry, d.rx * 0.18, ry * 0.07);
        paint(ctx, lk.hole, lk);
      }
      break;
    }
    case 'lining': {
      const rx = Math.min(ry * K, b.w * 0.5);
      const x0 = b.x + rx;
      const x1 = Math.max(x0 + 1.2, R - rx);
      ctx.beginPath();
      ctx.roundRect(x0 - rx, cy - ry, x1 - x0 + rx * 2, ry * 2, rx);
      paint(ctx, lk.body, lk);
      ctx.beginPath();
      ctx.roundRect(x0 - rx, cy - ry, rx * 2, ry * 2, rx);
      paint(ctx, lk.face, lk);
      for (let k = -2; k <= 2; k++) {
        ell(ctx, x0, cy + k * ry * 0.34, Math.max(0.8, rx * 0.2), ry * 0.045);
        paint(ctx, lk.hole, lk);
      }
      break;
    }
    case 'cylinder': {
      const f = block(ctx, b, lk, 0.24);
      ell(ctx, f.fx + f.fw * 0.5, f.fy + f.fh * 0.5, f.fw * 0.28, f.fh * 0.3);
      paint(ctx, lk.hole, lk);
      ell(ctx, f.fx + f.fw * 0.5, f.fy + f.fh * 0.5, f.fw * 0.18, f.fh * 0.2);
      paint(ctx, lk.body, lk);
      break;
    }
    case 'hub': {
      ctx.beginPath();
      ctx.rect(cx - b.w * 0.12, b.y, b.w * 0.24, b.h);
      paint(ctx, lk.body, lk);
      drum(ctx, b.x, R, cy, ry * 0.55, lk, 0.3);
      break;
    }
    case 'blade': {
      ctx.beginPath();
      for (const sgn of [-1, 1]) {
        ctx.moveTo(cx - b.w * 0.12, cy + sgn * ry * 0.12);
        ctx.bezierCurveTo(cx - b.w * 0.55, cy + sgn * ry * 0.4, cx - b.w * 0.32, cy + sgn * ry * 0.9, cx - b.w * 0.05, cy + sgn * ry);
        ctx.bezierCurveTo(cx + b.w * 0.3, cy + sgn * ry * 0.8, cx + b.w * 0.4, cy + sgn * ry * 0.35, cx + b.w * 0.12, cy + sgn * ry * 0.12);
        ctx.closePath();
      }
      paint(ctx, lk.face, lk);
      ell(ctx, cx, cy, b.w * 0.16, ry * 0.12);
      paint(ctx, lk.body, lk);
      break;
    }
    case 'spinner': {
      const rx = Math.min(ry * K, b.w * 0.3);
      const bx = R - rx;
      ctx.beginPath();
      ctx.moveTo(b.x, cy);
      ctx.bezierCurveTo(b.x + b.w * 0.2, cy - ry * 0.9, bx - b.w * 0.25, cy - ry, bx, cy - ry);
      ctx.ellipse(bx, cy, rx, ry, 0, -Math.PI / 2, Math.PI / 2);
      ctx.bezierCurveTo(bx - b.w * 0.25, cy + ry, b.x + b.w * 0.2, cy + ry * 0.9, b.x, cy);
      ctx.closePath();
      paint(ctx, lk.face, lk);
      ctx.beginPath();
      ctx.moveTo(b.x + b.w * 0.25, cy - ry * 0.55);
      ctx.bezierCurveTo(b.x + b.w * 0.45, cy - ry * 0.75, bx - b.w * 0.2, cy - ry * 0.8, bx - rx * 0.3, cy - ry * 0.8);
      ctx.strokeStyle = C.white;
      ctx.lineWidth = lk.lw * 1.5;
      ctx.stroke();
      break;
    }
    case 'tray': {
      const f = block(ctx, b, lk, 0.2);
      ctx.beginPath();
      ctx.rect(f.fx + f.fw * 0.1, f.fy + f.fh * 0.14, f.fw * 0.8, f.fh * 0.72);
      paint(ctx, lk.hole, lk);
      ctx.beginPath();
      ctx.moveTo(f.fx + f.fw * 0.1, f.fy + f.fh * 0.5);
      ctx.lineTo(f.fx + f.fw * 0.9, f.fy + f.fh * 0.5);
      ctx.strokeStyle = lk.line;
      ctx.lineWidth = lk.lw * 0.6;
      ctx.stroke();
      break;
    }
    case 'radio': {
      const f = block(ctx, b, lookFor('metal', lk.line === C.ink ? 'n' : 'sel', lk.lw), 0.2);
      ctx.beginPath();
      ctx.rect(f.fx, f.fy, f.fw, f.fh);
      paint(ctx, lk.face, lk);
      ctx.beginPath();
      ctx.rect(f.fx + f.fw * 0.3, f.fy + f.fh * 0.25, f.fw * 0.4, f.fh * 0.3);
      paint(ctx, '#9fb8a8', lk);
      for (const kx of [0.14, 0.86]) {
        ell(ctx, f.fx + f.fw * kx, f.fy + f.fh * 0.62, f.fw * 0.07, f.fw * 0.07);
        paint(ctx, lk.body, lk);
      }
      break;
    }
    case 'motor':
    case 'reservoir':
    case 'filter': {
      if (shape === 'motor') drum(ctx, R - b.w * 0.22, R, cy, ry * 0.18, lk);
      const d = drum(ctx, b.x, R - (shape === 'motor' ? b.w * 0.14 : 0), cy, ry * (shape === 'filter' ? 1 : 0.9), lk);
      ctx.strokeStyle = lk.line;
      ctx.lineWidth = lk.lw * 0.6;
      if (shape === 'filter')
        for (let k = 1; k < 6; k++) {
          const x = d.x0 + ((d.x1 - d.x0) * k) / 6;
          ctx.beginPath();
          ctx.moveTo(x, cy - ry);
          ctx.lineTo(x, cy + ry);
          ctx.stroke();
        }
      else {
        ctx.beginPath();
        ctx.rect(d.x0 + (d.x1 - d.x0) * 0.35, cy - ry * 0.9 - ry * 0.28, (d.x1 - d.x0) * 0.3, ry * 0.28);
        paint(ctx, lk.face, lk);
      }
      break;
    }
    case 'pump':
    case 'box':
    case 'connector': {
      const f = block(ctx, b, lk, 0.25);
      if (shape === 'connector') {
        ctx.fillStyle = lk.hole;
        for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) ctx.fillRect(f.fx + f.fw * (0.2 + i * 0.25), f.fy + f.fh * (0.3 + j * 0.3), 1.5, 1.5);
      } else {
        ell(ctx, f.fx + f.fw * 0.5, f.fy + f.fh * 0.5, f.fw * 0.18, f.fh * 0.18);
        paint(ctx, lk.body, lk);
      }
      break;
    }
    case 'valve':
    case 'nut':
      hexNut(ctx, shape === 'valve' ? { x: b.x, y: b.y + b.h * 0.25, w: b.w * 0.6, h: b.h * 0.6 } : b, lk);
      if (shape === 'valve') {
        ctx.beginPath();
        ctx.rect(b.x + b.w * 0.55, cy - b.h * 0.08, b.w * 0.45, b.h * 0.16);
        paint(ctx, lk.body, lk);
      }
      break;
    case 'cap':
      drum(ctx, b.x, R, cy, ry, lk);
      break;
    case 'pulley':
      drum(ctx, R - b.w * 0.3, R, cy, ry, lk);
      drum(ctx, b.x + b.w * 0.25, R - b.w * 0.25, cy, ry * 0.62, lk);
      drum(ctx, b.x, b.x + b.w * 0.34, cy, ry, lk, 0.2);
      break;
    case 'fan': {
      const d = drum(ctx, b.x, R, cy, ry, lk, 0.22);
      ctx.strokeStyle = lk.line;
      ctx.lineWidth = lk.lw * 0.6;
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(d.x0 + Math.cos(a) * d.rx * 0.25, cy + Math.sin(a) * ry * 0.25);
        ctx.lineTo(d.x0 + Math.cos(a + 0.25) * d.rx * 0.95, cy + Math.sin(a + 0.25) * ry * 0.95);
        ctx.stroke();
      }
      break;
    }
    case 'bracket': {
      const t = Math.max(3, b.h * 0.26);
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x + t, b.y);
      ctx.lineTo(b.x + t, b.y + b.h - t);
      ctx.lineTo(R, b.y + b.h - t);
      ctx.lineTo(R, b.y + b.h);
      ctx.lineTo(b.x, b.y + b.h);
      ctx.closePath();
      paint(ctx, lk.face, lk);
      ell(ctx, b.x + (R - b.x) * 0.65, b.y + b.h - t / 2, t * 0.3, t * 0.3);
      paint(ctx, lk.hole, lk);
      break;
    }
    case 'bolt':
    case 'screw': {
      const head = Math.max(3, b.w * 0.2);
      ctx.beginPath();
      ctx.rect(b.x + head, cy - b.h * 0.26, b.w - head, b.h * 0.52);
      paint(ctx, lk.body, lk);
      ctx.strokeStyle = lk.line;
      ctx.lineWidth = lk.lw * 0.5;
      for (let x = R - b.w * 0.35; x < R - 1; x += 2.5) {
        ctx.beginPath();
        ctx.moveTo(x, cy - b.h * 0.26);
        ctx.lineTo(x + 1.2, cy + b.h * 0.26);
        ctx.stroke();
      }
      if (shape === 'bolt') hexNut(ctx, { x: b.x, y: b.y - b.h * 0.1, w: head + 2, h: b.h * 1.2 }, lk);
      else {
        drum(ctx, b.x, b.x + head, cy, b.h * 0.55, lk);
      }
      break;
    }
    case 'pin': {
      ctx.beginPath();
      ctx.rect(b.x + b.w * 0.2, cy - Math.max(0.8, b.h * 0.3), b.w * 0.8, Math.max(1.6, b.h * 0.6));
      paint(ctx, lk.body, lk);
      ell(ctx, b.x + b.w * 0.15, cy, Math.max(1.2, b.w * 0.12), Math.max(2, b.h * 0.9));
      paint(ctx, lk.face, lk);
      break;
    }
    case 'cable': {
      ctx.strokeStyle = lk.line;
      ctx.lineWidth = Math.max(2.5, b.h * 0.45);
      ctx.beginPath();
      ctx.moveTo(b.x + b.w * 0.12, cy);
      ctx.bezierCurveTo(b.x + b.w * 0.4, cy - b.h * 1.4, b.x + b.w * 0.6, cy + b.h * 1.4, R - b.w * 0.12, cy);
      ctx.stroke();
      ctx.strokeStyle = mat === 'dark' ? '#56646b' : lk.body;
      ctx.lineWidth = Math.max(1.2, b.h * 0.25);
      ctx.stroke();
      for (const x of [b.x, R - b.w * 0.14]) {
        ctx.beginPath();
        ctx.rect(x, cy - b.h * 0.6, b.w * 0.14, b.h * 1.2);
        paint(ctx, MATS.metal[1], lk);
      }
      break;
    }
    case 'clamp': {
      drum(ctx, b.x, R, cy, ry, lk, 0.86);
      ctx.beginPath();
      ctx.rect(b.x - 1, cy - ry - b.w * 0.5, b.w + 2, b.w * 0.6);
      paint(ctx, lk.body, lk);
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Page styles
// ---------------------------------------------------------------------------

const MONO = `ui-monospace, 'SF Mono', 'Roboto Mono', Menlo, Consolas, monospace`;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const CSS = `
.ipcz{position:absolute;inset:0;display:flex;flex-direction:column;background:${C.paper};color:${C.ink};font-family:${FONT};font-size:13px;line-height:1.3;overflow:hidden;-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none}
.ipcz *{box-sizing:border-box}
.ipcz button{font:inherit;color:inherit;border:0;background:none;cursor:pointer;touch-action:manipulation;padding:0}
.ipcz .job{padding:6px 10px 6px;background:linear-gradient(${C.sand},${C.paper});border-bottom:1px solid rgba(31,42,48,.12);display:flex;flex-direction:column;gap:5px}
.ipcz .jtop{display:flex;gap:6px}
.ipcz .jb{flex:1 1 0;min-width:0;min-height:44px;border-radius:12px;line-height:1.15;background:${C.white};box-shadow:0 1px 0 rgba(31,42,48,.12),inset 0 0 0 1px rgba(31,42,48,.1);display:flex;flex-direction:column;align-items:flex-start;justify-content:center;padding:4px 10px;text-align:left}
.ipcz .jb b{font-size:13.5px;font-weight:800;letter-spacing:.2px;white-space:nowrap}
.ipcz .jb small{font-size:10.5px;color:${C.inkSoft};font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.ipcz .jb.tail{background:${C.ink};color:${C.paper};flex:1.15 1 0}
.ipcz .jb.tail small{color:${C.sandDeep}}
.ipcz .jb.on{box-shadow:inset 0 0 0 2px ${C.sea}}
.ipcz .jb .dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:${C.sea};margin-left:5px;vertical-align:1px}
.ipcz .sq{display:flex;gap:7px;align-items:flex-start;font-size:13px;font-weight:700;line-height:1.28}
.ipcz .sq b{flex:none;font-size:9.5px;letter-spacing:.8px;background:${C.rust};color:${C.white};border-radius:6px;padding:2px 5px;margin-top:1px}
.ipcz .coach{font-size:11.5px;color:${C.seaDeep};font-weight:700;line-height:1.3;padding-left:2px}
.ipcz .fh{display:flex;align-items:center;gap:5px;padding:3px 6px 3px 10px;background:${C.white};border-bottom:1px solid rgba(31,42,48,.1);min-height:40px}
.ipcz .fht{flex:1;min-width:0;font-size:11px;font-weight:800;letter-spacing:.3px;color:${C.inkSoft};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ipcz .fht b{color:${C.ink}}
.ipcz .effpill{flex:none;height:34px;border-radius:17px;padding:0 10px;font-size:12px;font-weight:800;background:${C.sand};box-shadow:inset 0 0 0 1px rgba(31,42,48,.14)}
.ipcz .zbtn{flex:none;width:38px;height:34px;border-radius:17px;background:${C.paper};box-shadow:inset 0 0 0 1px rgba(31,42,48,.14);font-size:19px;font-weight:800;line-height:34px}
.ipcz .effpill.set{background:${C.seaDeep};color:${C.white}}
.ipcz .fig{position:relative;flex:0 0 33%;min-height:150px;transition:flex-basis .22s ease;background:${C.white};border-bottom:1px solid rgba(31,42,48,.16)}
.ipcz.lf .fig{flex-basis:24%}
.ipcz.rm .fig{transition:none}
.ipcz .plate{position:absolute;inset:10px 14px;border-radius:10px;background:linear-gradient(135deg,#dfe4e6,#aab4b8 55%,#cfd6d8);box-shadow:0 6px 18px rgba(31,42,48,.35),inset 0 0 0 1px rgba(255,255,255,.6);display:none;flex-direction:column;justify-content:center;padding:14px 22px;font-family:${MONO};color:#26343b;text-shadow:0 1px 0 rgba(255,255,255,.55)}
.ipcz .plate.on{display:flex}
.ipcz .plate .pt{font-family:${FONT};font-weight:900;font-size:13px;letter-spacing:1.4px;text-align:center;margin-bottom:8px}
.ipcz .plate .pl{display:flex;justify-content:space-between;gap:10px;font-size:13px;font-weight:700;padding:3px 0;border-bottom:1px dashed rgba(38,52,59,.25)}
.ipcz .plate .pl span{font-size:10px;letter-spacing:1px;font-family:${FONT};font-weight:800;opacity:.75;padding-top:2px}
.ipcz .plate .rv{position:absolute;width:9px;height:9px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#fff,#7d888c)}
.ipcz .list{position:relative;flex:1 1 0;min-height:0;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;touch-action:pan-y;background:${C.white}}
.ipcz .effbox{padding:8px 10px 6px;background:${C.paper};border-bottom:1px solid rgba(31,42,48,.1)}
.ipcz .effh{font-size:10.5px;font-weight:800;letter-spacing:.6px;color:${C.inkSoft};margin:0 2px 6px}
.ipcz .effg{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.ipcz .ec{min-height:44px;border-radius:10px;background:${C.white};box-shadow:inset 0 0 0 1px rgba(31,42,48,.16);display:flex;align-items:center;gap:8px;padding:4px 8px;text-align:left}
.ipcz .ec b{flex:none;width:24px;height:24px;border-radius:12px;background:${C.sand};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:900}
.ipcz .ec span{font-size:11px;font-weight:700;line-height:1.2;color:${C.ink};min-width:0}
.ipcz .ec.on{box-shadow:inset 0 0 0 2px ${C.sea};background:rgba(46,124,147,.08)}
.ipcz .ec.on b{background:${C.sea};color:${C.white}}
.ipcz .ec.off{opacity:.5}
.ipcz .ec.off span{text-decoration:line-through}
.ipcz .ec[disabled]{cursor:default}
.ipcz .effx{font-size:11.5px;color:${C.seaDeep};font-weight:700;margin:6px 2px 0;line-height:1.35}
.ipcz .effbox.mini{display:flex;gap:8px;align-items:center;padding:6px 10px}
.ipcz .effbox.mini .ec{flex:none;min-height:34px;padding:2px 8px 2px 4px}
.ipcz .effbox.mini .effx{margin:0;flex:1;min-width:0;font-size:11px}
.ipcz .th{position:sticky;top:0;z-index:2;display:grid;grid-template-columns:34px 92px minmax(0,1fr) 26px 30px;gap:6px;padding:6px 10px;background:${C.ink};color:${C.paper};font-size:10px;font-weight:800;letter-spacing:.5px}
.ipcz .th span:nth-child(4),.ipcz .th span:nth-child(5){text-align:center}
.ipcz .r{border-bottom:1px solid rgba(31,42,48,.08);transition:background .15s}
.ipcz .rg{display:grid;grid-template-columns:34px 92px minmax(0,1fr) 26px 30px;gap:6px;padding:8px 10px 3px;align-items:start;min-height:34px}
.ipcz .ri{font-weight:800;font-size:12px}
.ipcz .rp{font-family:${MONO};font-weight:700;font-size:11.5px;word-break:break-all;line-height:1.25}
.ipcz .rn{font-size:11.5px;font-weight:600;line-height:1.25;color:${C.ink}}
.ipcz .rn i{font-style:normal;color:${C.inkSoft};letter-spacing:1px}
.ipcz .rn em{font-style:normal;font-size:10px;color:${C.inkSoft};font-weight:700;white-space:nowrap}
.ipcz .re{text-align:center;font-weight:900;font-size:12px}
.ipcz .ru{text-align:center;font-weight:700;font-size:12px}
.ipcz .rnote{padding:0 10px 7px 50px;font-size:11px;color:${C.inkSoft};font-weight:600;line-height:1.35}
.ipcz .rnote b{color:${C.ink};font-weight:800}
.ipcz .rnote:empty{display:none}
.ipcz .lk{color:${C.seaDeep};font-weight:800;text-decoration:underline;text-underline-offset:2px;padding:6px 2px;margin:-6px 0}
.ipcz .r.grp{background:rgba(46,124,147,.07);box-shadow:inset 3px 0 0 ${C.sea}}
.ipcz .r.sel{background:rgba(46,124,147,.14);box-shadow:inset 4px 0 0 ${C.seaDeep}}
.ipcz .r.dim .rg,.ipcz .r.dim .rnote{opacity:.38}
.ipcz .r.dim .rp{text-decoration:line-through}
.ipcz .r.flash{animation:ipcflash .9s ease}
@keyframes ipcflash{0%{background:rgba(224,164,88,.45)}100%{background:transparent}}
.ipcz .rx{display:none;padding:0 10px 10px 50px}
.ipcz .r.sel .rx{display:block}
.ipcz .tip{font-size:11.5px;font-weight:700;color:${C.seaDeep};background:rgba(46,124,147,.08);border-radius:8px;padding:6px 8px;margin-bottom:8px;line-height:1.35}
.ipcz .add{width:100%;min-height:44px;border-radius:12px;background:${C.sea};color:${C.white};font-weight:800;font-size:14px}
.ipcz .add[disabled]{background:${C.sandDeep};color:${C.inkSoft}}
.ipcz .att{padding:5px 10px 5px 50px;font-size:10px;font-weight:900;letter-spacing:1.2px;color:${C.inkSoft};background:${C.paper}}
.ipcz .fnotes{padding:10px 12px 16px;font-size:10.5px;color:${C.inkSoft};font-weight:600;line-height:1.45;background:${C.paper}}
.ipcz .slip{flex:none;display:grid;grid-template-columns:minmax(0,1fr) 92px;gap:8px;padding:8px 10px calc(8px + env(safe-area-inset-bottom));background:${C.sand};border-top:2px dashed rgba(31,42,48,.22);position:relative}
.ipcz .slh{grid-column:1/-1;display:flex;justify-content:space-between;font-size:10px;font-weight:900;letter-spacing:1px;color:${C.inkSoft};margin-bottom:-2px}
.ipcz .lines{display:flex;flex-direction:column;gap:6px;min-width:0}
.ipcz .empty{font-size:12px;font-weight:700;color:${C.inkSoft};min-height:44px;display:flex;align-items:center;line-height:1.3}
.ipcz .ln{display:flex;align-items:center;gap:4px;background:${C.white};border-radius:12px;padding:2px 2px 2px 10px;min-height:48px;box-shadow:0 1px 0 rgba(31,42,48,.1)}
.ipcz .ln.ica{box-shadow:inset 0 0 0 2px ${C.mech}}
.ipcz .lpn{flex:1;min-width:0;display:flex;flex-direction:column}
.ipcz .lpn b{font-family:${MONO};font-size:12.5px;word-break:break-all;line-height:1.2}
.ipcz .lpn small{font-size:10.5px;color:${C.inkSoft};font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ipcz .qs{display:flex;align-items:center}
.ipcz .qs button{width:38px;height:44px;border-radius:10px;font-size:20px;font-weight:800;background:${C.paper}}
.ipcz .qs span{min-width:26px;text-align:center;font-size:17px;font-weight:900;font-variant-numeric:tabular-nums}
.ipcz .lx{width:34px;height:44px;font-size:16px;color:${C.inkSoft}}
.ipcz .iorder{align-self:stretch;min-height:48px;border-radius:14px;background:${C.seaDeep};color:${C.white};font-size:16px;font-weight:900;letter-spacing:.3px;box-shadow:0 2px 0 rgba(0,0,0,.18)}
.ipcz .iorder[disabled]{background:${C.sandDeep};color:rgba(31,42,48,.45);box-shadow:none}
.ipcz .apr{grid-column:1/-1;display:flex;align-items:center;gap:8px;background:${C.white};border-radius:12px;padding:4px 4px 4px 10px;box-shadow:inset 0 0 0 2px ${C.mech}}
.ipcz .apr div{flex:1;min-width:0;display:flex;flex-direction:column}
.ipcz .apr b{font-size:11px;letter-spacing:.6px}
.ipcz .apr small{font-size:11px;font-weight:700;color:${C.inkSoft};line-height:1.3}
.ipcz .apr button{flex:none;min-height:44px;border-radius:10px;padding:0 12px;background:${C.mech};font-weight:800;font-size:13px}
.ipcz .shade{position:absolute;inset:0;background:rgba(31,42,48,.34);opacity:0;pointer-events:none;transition:opacity .2s;z-index:8}
.ipcz .shade.on{opacity:1;pointer-events:auto}
.ipcz .isheet{position:absolute;left:0;right:0;bottom:0;top:14%;z-index:9;background:${C.paper};border-radius:18px 18px 0 0;box-shadow:0 -6px 24px rgba(31,42,48,.25);display:flex;flex-direction:column;transform:translateY(105%);transition:transform .24s cubic-bezier(.2,.8,.2,1)}
.ipcz .isheet.on{transform:none}
.ipcz .shtop{display:flex;align-items:center;gap:8px;padding:8px 8px 6px 14px}
.ipcz .shtitle{flex:1;min-width:0;font-weight:900;font-size:15px;line-height:1.2}
.ipcz .shtitle small{display:block;font-size:11px;color:${C.inkSoft};font-weight:700}
.ipcz .shx{flex:none;width:44px;height:44px;border-radius:22px;background:${C.sand};font-size:18px;font-weight:900}
.ipcz .itabs{display:flex;gap:6px;padding:0 10px 8px}
.ipcz .tab{flex:1;min-height:40px;border-radius:12px;background:${C.white};font-weight:800;font-size:13px;box-shadow:inset 0 0 0 1px rgba(31,42,48,.12)}
.ipcz .tab.on{background:${C.ink};color:${C.paper}}
.ipcz .shb{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;touch-action:pan-y;padding:0 10px 18px}
.ipcz .icard{background:${C.white};border-radius:12px;padding:10px 12px;margin-bottom:8px;box-shadow:0 1px 0 rgba(31,42,48,.08)}
.ipcz .icard h4{margin:0 0 4px;font-size:13px;font-weight:900}
.ipcz .icard p{margin:0 0 4px;font-size:12px;line-height:1.4}
.ipcz .icard .mt{font-size:11px;font-weight:700;color:${C.inkSoft}}
.ipcz .icard.hint{box-shadow:inset 0 0 0 2px ${C.sea}}
.ipcz .warn{border-left:5px solid ${C.rust}}
.ipcz .caut{border-left:5px solid ${C.mech}}
.ipcz .hl{background:rgba(46,124,147,.14);border-radius:4px;padding:0 3px;font-weight:800}
.ipcz .srch{display:flex;gap:6px;margin-bottom:8px;position:sticky;top:0;background:${C.paper};padding:2px 0 6px;z-index:1;flex-wrap:wrap}
.ipcz .srch input{flex:1 1 100%;min-width:0;height:44px;border-radius:12px;border:1px solid rgba(31,42,48,.2);padding:0 12px;font:inherit;font-size:16px;background:${C.white};color:${C.ink};user-select:text;-webkit-user-select:text}
.ipcz .ichip{flex:1;min-height:36px;border-radius:18px;background:${C.white};font-weight:800;font-size:12px;box-shadow:inset 0 0 0 1px rgba(31,42,48,.14);padding:0 8px}
.ipcz .ichip.on{background:${C.seaDeep};color:${C.white}}
.ipcz .le{font-size:12px}
.ipcz .le .lh{display:flex;justify-content:space-between;gap:6px;font-size:11px;font-weight:800;color:${C.inkSoft};margin-bottom:3px}
.ipcz .le .lh b{color:${C.ink}}
.ipcz .le .lt{font-size:12px;line-height:1.4;margin:0 0 4px}
.ipcz .le .lr{font-size:11px;color:${C.inkSoft};font-weight:700}
.ipcz .le .ls{font-family:${MONO};font-size:10.5px;color:${C.inkSoft};margin-top:3px}
.ipcz .cite{margin-top:8px;width:100%;min-height:44px;border-radius:10px;background:${C.mech};font-weight:800}
.ipcz .cite.done{background:${C.palm};color:${C.white}}
.ipcz .tbl{width:100%;border-collapse:collapse;font-size:11.5px}
.ipcz .tbl td{padding:5px 4px;border-bottom:1px solid rgba(31,42,48,.08);vertical-align:top}
.ipcz .tbl td:first-child{font-family:${MONO};font-weight:700;white-space:nowrap}
.ipcz .tbl tr.hint td{background:rgba(46,124,147,.12)}
.ipcz .open{margin-top:8px;min-height:44px;width:100%;border-radius:10px;background:${C.ink};color:${C.paper};font-weight:800}
.ipcz .vd{position:absolute;inset:0;z-index:12;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(251,245,233,.75);opacity:0;pointer-events:none;transition:opacity .2s}
.ipcz .vd.on{opacity:1;pointer-events:auto}
.ipcz .vc{width:100%;max-width:380px;background:${C.white};border-radius:18px;padding:16px 16px 14px;box-shadow:0 10px 30px rgba(31,42,48,.3);transform:scale(.92);transition:transform .25s cubic-bezier(.2,1.4,.4,1)}
.ipcz .vd.on .vc{transform:none}
.ipcz .istamp{display:inline-block;font-weight:900;font-size:22px;letter-spacing:2px;border:3px solid currentColor;border-radius:8px;padding:2px 10px;transform:rotate(-4deg);margin:2px 0 10px}
.ipcz .vn{display:flex;gap:8px;font-size:13px;font-weight:700;line-height:1.35;margin:5px 0}
.ipcz .vn i{flex:none;font-style:normal;font-weight:900;width:16px}
.ipcz .vwhy{margin-top:10px;padding-top:8px;border-top:1px dashed rgba(31,42,48,.2);font-size:11.5px;color:${C.inkSoft};font-weight:600;line-height:1.4}
.ipcz .vbtns{display:flex;gap:8px;margin-top:12px}
.ipcz .vbtns button{flex:1;min-height:46px;border-radius:12px;font-weight:900;background:${C.sand}}
.ipcz .vbtns button.pri{background:${C.seaDeep};color:${C.white}}
`;

// ---------------------------------------------------------------------------
// The puzzle
// ---------------------------------------------------------------------------

type Lane = 0 | 1;
type Ball = { item: string; x: number; ax: number; ay: number; lane: Lane };

export const ipc: PuzzleDef = {
  id: 'ipc',
  role: 'mech',
  title: 'Parts lookup (IPC)',
  gesture: 'Pinch the figure, tap rows',
  howTo: 'Find the part, check effectivity, follow notes, order.',
  term: 'IPC: Illustrated Parts Catalog. Exploded views and the P/N for your serial.',
  seconds: (tier) => 72 + tier * 9,
  mount(host, p) {
    const m = generateIpc(p.seed, p.tier, p.tools, p.context);
    const { ac, fig } = m;
    const rm = p.reducedMotion;

    // ---- state
    const marks: IpcAttempt['marks'] = m.premarked ? { ...m.marks } : {};
    const lines: (OrderLine & { item: string; nomen: string })[] = [];
    let cite: string | undefined;
    let revealed = false;
    let selRow = -1; // index into fig.rows
    let selItem: string | null = null;
    let finished = false;
    let sheet: null | { kind: 'amm' | 'rec' | 'ica'; tab?: 'sb' | 'alt' | 'log'; citeMode?: boolean } = null;
    let logQuery = '';
    let logChip: 'all' | 'ata' | 'sb' | 'stc' = 'all';
    let visitedRecords = false;
    let flourishAt = 0;

    // ---- DOM
    const root = document.createElement('div');
    root.className = rm ? 'ipcz rm' : 'ipcz';
    const style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);
    host.el.appendChild(root);

    const sbFig = effText(fig, 'C').replace(/^POST /, '');
    const ammNo = `${m.task.taskNo}`;
    const job = document.createElement('div');
    job.className = 'job';
    job.innerHTML = `
      <div class="jtop">
        <button class="jb tail" data-act="plate" aria-label="Data plate"><b>${esc(ac.registration)}</b><small>${esc(ac.designation)} · data plate</small></button>
        <button class="jb" data-act="amm"><b>AMM${m.teach && m.mult > 1 ? '<i class="dot"></i>' : ''}</b><small>${esc(ammNo)}</small></button>
        <button class="jb" data-act="rec"><b>Records</b><small>SBs · 337s · logs</small></button>
      </div>
      <div class="sq"><b>SQUAWK</b><span>${esc(m.squawk)}</span></div>
      <div class="coach"></div>`;
    root.appendChild(job);
    const coachEl = job.querySelector('.coach') as HTMLElement;
    if (!m.teach) coachEl.remove();

    const fh = document.createElement('div');
    fh.className = 'fh';
    fh.innerHTML = `<span class="fht"><b>FIG ${fig.fig}</b> · ${esc(fig.title)}</span><button class="effpill" data-act="eff"></button><button class="zbtn" data-z="-1" aria-label="Zoom out">−</button><button class="zbtn" data-z="1" aria-label="Zoom in">+</button>`;
    root.appendChild(fh);
    const effPill = fh.querySelector('.effpill') as HTMLButtonElement;

    const figEl = document.createElement('div');
    figEl.className = 'fig';
    root.appendChild(figEl);

    const list = document.createElement('div');
    list.className = 'list';
    root.appendChild(list);

    const slip = document.createElement('div');
    slip.className = 'slip';
    root.appendChild(slip);

    const shade = document.createElement('div');
    shade.className = 'shade';
    root.appendChild(shade);
    const sheetEl = document.createElement('div');
    sheetEl.className = 'isheet';
    root.appendChild(sheetEl);
    const vd = document.createElement('div');
    vd.className = 'vd';
    root.appendChild(vd);

    // ---- data plate (peek)
    const st = stage(figEl);
    const plate = document.createElement('div');
    plate.className = 'plate';
    plate.innerHTML = `
      <i class="rv" style="left:8px;top:8px"></i><i class="rv" style="right:8px;top:8px"></i><i class="rv" style="left:8px;bottom:8px"></i><i class="rv" style="right:8px;bottom:8px"></i>
      <div class="pt">${esc(ac.maker.toUpperCase())}</div>
      <div class="pl"><span>MODEL</span>${esc(ac.designation)}</div>
      <div class="pl"><span>SERIAL NO.</span>${esc(ac.serial)}</div>
      <div class="pl"><span>TYPE CERT.</span>${esc(ac.typeCert)}</div>
      <div class="pl"><span>DATE MFD.</span>${ac.year}</div>`;
    figEl.appendChild(plate);

    // ---- parts list
    const rowsHtml = (rows: IpcRow[], src: 'ipc' | 'ica') => {
      const out: string[] = [];
      let att: string | undefined;
      rows.forEach((r, i) => {
        if (r.attachingFor !== att) {
          if (att) out.push(`<div class="att">- - - * - - -</div>`);
          if (r.attachingFor) out.push(`<div class="att">ATTACHING PARTS</div>`);
          att = r.attachingFor;
        }
        const dots = '. '.repeat(r.indent);
        const noteBits = r.notes.map((n) => {
          const sup = /^SUPSD BY (\S+) (\(INTCHG CODE \d\))$/.exec(n);
          if (sup) return `SUPSD BY <button class="lk" data-go="${esc(sup[1])}">${esc(sup[1])}</button> <b>${esc(sup[2])}</b>`;
          const sups = /^SUPSDS (\S+)$/.exec(n);
          if (sups) return `SUPSDS <button class="lk" data-go="${esc(sups[1])}">${esc(sups[1])}</button>`;
          const alt = /^ALT FOR (\S+)$/.exec(n);
          if (alt) return `ALT FOR <button class="lk" data-go="${esc(alt[1])}">${esc(alt[1])}</button>`;
          if (n.startsWith('NP')) return `<b>${esc(n)}</b>`;
          return esc(n);
        });

        const upa = typeof r.upa === 'number' ? String(r.upa) : r.upa;
        out.push(`<div class="r" data-src="${src}" data-i="${i}" data-item="${esc(baseItem(r.item))}">
          <div class="rg"><span class="ri">${esc(r.item)}</span><span class="rp">${esc(r.pn)}</span><span class="rn"><i>${dots}</i>${esc(r.nomen)}${r.vendor ? ` <em>(${esc(r.vendor)})</em>` : ''}</span><span class="re">${esc(r.eff || '')}</span><span class="ru">${esc(upa)}</span></div>
          <div class="rnote">${noteBits.join(' · ')}</div>
          <div class="rx"></div>
        </div>`);
      });
      if (att) out.push(`<div class="att">- - - * - - -</div>`);
      return out.join('');
    };
    list.innerHTML = `
      ${
        m.premarked
          ? `<div class="effbox mini">${fig.effCodes
              .filter((e) => e.applies)
              .map((e) => `<button class="ec on" data-code="${e.code}" disabled><b>${e.code}</b></button>`)
              .join('')}<div class="effx"></div></div>`
          : `<div class="effbox">
        <div class="effh">EFFECTIVITY CODES — MARK THE ONES THAT FIT THIS AIRPLANE</div>
        <div class="effg">${fig.effCodes.map((e) => `<button class="ec" data-code="${e.code}"><b>${e.code}</b><span>${esc(e.text)}</span></button>`).join('')}</div>
        ${m.teach ? `<div class="effx"></div>` : ''}
      </div>`
      }
      <div class="th"><span>ITEM</span><span>PART NO.</span><span>NOMENCLATURE</span><span>EFF</span><span>UPA</span></div>
      <div class="rows">${rowsHtml(fig.rows, 'ipc')}</div>
      <div class="fnotes">${fig.notes.map(esc).join('<br>')}</div>`;
    const rowEls = [...list.querySelectorAll<HTMLElement>('.r')];
    const effBtns = [...list.querySelectorAll<HTMLButtonElement>('.ec')];
    const effX = list.querySelector('.effx') as HTMLElement | null;

    const conflicts = (r: IpcRow) =>
      [...r.eff].some((c) => ((c === 'A' || c === 'B') && marks.ab && c !== marks.ab) || ((c === 'C' || c === 'D') && marks.cd && c !== marks.cd));

    const tipFor = (r: IpcRow): string => {
      if (!m.teach) return '';
      const t: string[] = [];
      if (r.upa === 'RF') t.push('RF: the installation this figure shows, for reference. Order the parts under it.');
      if (r.np) t.push(`NP: not sold on its own. ${m.tier <= 1 ? `Order what the note names (${r.notes.find((n) => n.startsWith('NP'))!.replace('NP — ', '').toLowerCase()}), the one whose EFF fits.` : 'Order the next higher assembly or kit the note names.'}`);
      if (r.supsdBy) {
        const c = r.supsdBy.code;
        t.push(`Code ${c}: ${INTCHG[c]} ${c === 3 ? 'Order the new part together with the set the note names.' : `Order the current P/N, ${r.supsdBy.pn}.`}`);
      }
      if (r.alt) t.push(`ALT: an approved alternate for ${r.alt}. Either is a right order.`);
      if (r.eff && !r.applies && m.tier <= 1) t.push(`EFF ${r.eff} is ${[...r.eff].map((c) => effText(fig, c)).join(' and ')}: not this airplane.`);
      if (typeof r.upa === 'number' && m.tier === 0) t.push(`UPA ${r.upa}: units per assembly, per ${r.indent > 1 ? 'the assembly above it' : 'installation'}.`);
      return t.map((x) => `<div class="tip">${esc(x)}</div>`).join('');
    };

    function refreshList() {
      fig.rows.forEach((r, i) => {
        const el = rowEls[i];
        el.classList.toggle('dim', conflicts(r));
        el.classList.toggle('grp', selItem !== null && baseItem(r.item) === selItem && i !== selRow);
        el.classList.toggle('sel', i === selRow);
        if (i === selRow) {
          const rx = el.querySelector('.rx') as HTMLElement;
          const canAdd = r.upa !== 'RF' && !finished;
          rx.innerHTML = `${tipFor(r)}<button class="add" data-add="${i}" ${canAdd ? '' : 'disabled'}>${r.upa === 'RF' ? 'Reference only' : `+ Add ${esc(r.pn)} to request`}</button>`;
        }
      });
      effBtns.forEach((b) => {
        const code = b.dataset.code!;
        const on = marks.ab === code || marks.cd === code;
        const pair = code === 'A' || code === 'B' ? marks.ab : marks.cd;
        b.classList.toggle('on', on);
        b.classList.toggle('off', !!pair && !on);
      });
      effPill.textContent = `EFF ${marks.ab ?? '?'} · ${marks.cd ?? '?'}`;
      effPill.classList.toggle('set', !!(marks.ab && marks.cd));
      if (effX) {
        const ex = effReasons(m);
        effX.innerHTML = m.premarked
          ? `This airplane: ${esc(ex.ab)}.<br>${esc(ex.cd)}.`
          : `A/B: compare the S/N on the data plate. C/D: is <b>${esc(sbFig)}</b> in the records?`;
      }
    }

    function scrollToRow(i: number, flash = true) {
      const el = rowEls[i];
      if (!el) return;
      const th = (list.querySelector('.th') as HTMLElement).offsetHeight;
      const top = el.offsetTop - th - Math.max(8, (list.clientHeight - th - el.offsetHeight) * 0.3);
      list.scrollTo({ top: Math.max(0, top), behavior: rm ? 'auto' : 'smooth' });
      if (flash) {
        el.classList.remove('flash');
        void el.offsetWidth;
        el.classList.add('flash');
      }
    }

    function selectRow(i: number, from: 'list' | 'fig' | 'link') {
      selRow = i;
      selItem = i >= 0 ? baseItem(fig.rows[i].item) : selItem;
      refreshList();
      coach();
      if (from !== 'list') scrollToRow(i);
      if (from !== 'fig' && selItem) focusItem(selItem);
    }

    function selectItem(item: string) {
      selItem = item;
      const vars = fig.rows.map((r, i) => ({ r, i })).filter((x) => baseItem(x.r.item) === item);
      // land on the first variant; the whole group lights up
      selRow = vars[0]?.i ?? -1;
      refreshList();
      coach();
      if (selRow >= 0) scrollToRow(selRow);
      const nm = vars[0]?.r.nomen;
      host.status(nm ? `Item ${item}: ${nm.toLowerCase()}` : `Item ${item}`);
    }

    // ---- order slip
    function refreshSlip() {
      const ica = lines.some((l) => l.src === 'ica');
      const lh = lines
        .map(
          (l, i) => `<div class="ln${l.src === 'ica' ? ' ica' : ''}">
            <div class="lpn"><b>${esc(l.pn)}</b><small>${l.src === 'ica' ? 'ICA' : `Fig ${fig.fig}`}-${esc(l.item)} · ${esc(l.nomen.toLowerCase())}</small></div>
            <div class="qs"><button data-q="-1" data-l="${i}" aria-label="Fewer">−</button><span>${l.qty}</span><button data-q="1" data-l="${i}" aria-label="More">+</button></div>
            <button class="lx" data-rm="${i}" aria-label="Remove">✕</button>
          </div>`,
        )
        .join('');
      const alt = m.alteration;
      const citeEntry = cite ? ac.log.find((e) => e.id === cite) : undefined;
      const apr =
        ica && alt
          ? `<div class="apr"><div><b>ENGINEERING APPROVAL</b><small>STC ${esc(alt.stc!)} · Form 337 ${fmtDate(alt.form337)} · Log: ${citeEntry ? `${fmtDate(citeEntry.date)} ✓` : '—'}</small></div><button data-act="cite">${citeEntry ? 'Change' : 'Cite entry'}</button></div>`
          : '';
      slip.innerHTML = `
        <div class="slh"><span>PARTS REQUEST</span><span>${esc(ac.registration)} · ${esc(m.ata)}</span></div>
        <div class="lines">${lh || `<div class="empty">${m.tier === 0 ? 'Tap the part’s row, then “Add to request”.' : 'Empty. Select a row, then Add.'}</div>`}</div>
        <button class="iorder" data-act="order" ${lines.length && !finished ? '' : 'disabled'}>Order</button>
        ${apr}`;
    }

    function addLine(src: 'ipc' | 'ica', r: IpcRow) {
      if (finished) return;
      const have = lines.find((l) => l.pn === r.pn && l.src === src);
      if (have) {
        host.fx.tap();
        flashSlip();
        return;
      }
      if (lines.length >= 3) {
        host.fx.bad();
        host.status('Three lines max on one request');
        return;
      }
      lines.push({ pn: r.pn, qty: 1, src, item: r.item, nomen: r.nomen });
      host.fx.snap();
      refreshSlip();
      flashSlip();
      coach();
      host.status(`Request: ${lines.map((l) => `${l.pn} ×${l.qty}`).join(' + ')}`);
    }
    function flashSlip() {
      if (rm) return;
      slip.animate?.([{ transform: 'translateY(0)' }, { transform: 'translateY(-4px)' }, { transform: 'translateY(0)' }], { duration: 220, easing: 'ease-out' });
    }

    // ---- teaching line
    function coach() {
      if (!m.teach) return;
      let t: string;
      const onTarget = selItem === m.item;
      const inReq = lines.length > 0;
      if (!onTarget && !inReq) t = m.tier === 2 ? 'Tap the circled callout. Then decide which rows fit this airplane.' : 'Find the circled callout on the figure and tap it (pinch to zoom).';
      else if (!inReq) {
        if (!m.premarked && (!marks.ab || !marks.cd)) t = `Mark the effectivity codes first: S/N from the data plate, ${sbFig} from the Records.`;
        else if (m.features.np || m.features.sup) t = 'Read the notes: NP → order the next higher assembly; SUPSD BY → order the new P/N.';
        else t = 'Pick the row whose EFF fits, then Add it to the request.';
      } else if (m.tier <= 1) t = `Set the quantity: UPA × assemblies${m.mult > 1 ? ' (the AMM says both main wheels)' : ''}. Then Order.`;
      else t = m.mult > 1 ? 'Quantity: check the AMM cautions. Then Order.' : 'Check the quantity, then Order.';
      coachEl.textContent = t;
    }

    // ---- sheets: AMM, records, ICA
    function openSheet(s: NonNullable<typeof sheet>) {
      sheet = s;
      renderSheet();
      shade.classList.add('on');
      sheetEl.classList.add('on');
      host.fx.swipe();
    }
    function closeSheet() {
      sheet = null;
      shade.classList.remove('on');
      sheetEl.classList.remove('on');
    }

    const hintSb = (id: string) => m.teach && !m.premarked && id === sbFig;

    function logEntryHtml(e: LogEntry, citeMode: boolean) {
      const hi = m.teach && e.kind === 'sb' && e.text.includes(sbFig);
      const book = e.book === 'airframe' ? 'Airframe' : e.book === 'engine' ? 'Engine' : 'Propeller';
      return `<div class="icard le${hi ? ' hint' : ''}">
        <div class="lh"><span><b>${fmtDate(e.date)}</b> · ${book}</span><span>TT ${e.tt.toFixed(1)} · ${ac.meter} ${e.tach.toFixed(1)}</span></div>
        <p class="lt">${esc(e.text)}</p>
        <div class="lr">${esc(e.ref)}</div>
        ${e.cert ? `<div class="lr" style="margin-top:3px;font-style:italic">${esc(e.cert)}</div>` : ''}
        <div class="ls">${esc(e.signature)}</div>
        ${citeMode ? `<button class="cite${cite === e.id ? ' done' : ''}" data-cite="${esc(e.id)}">${cite === e.id ? 'Cited on the request ✓' : 'Cite this entry'}</button>` : ''}
      </div>`;
    }

    function renderLog() {
      const body = sheetEl.querySelector('.logs') as HTMLElement | null;
      if (!body) return;
      let es = logQuery.trim() ? searchLog(ac, logQuery) : ac.log;
      if (logChip === 'ata') es = es.filter((e) => e.ata?.startsWith(m.ata));
      if (logChip === 'sb') es = es.filter((e) => e.kind === 'sb');
      if (logChip === 'stc') es = es.filter((e) => e.kind === 'stc');
      const shown = [...es].reverse();
      body.innerHTML = shown.length ? shown.map((e) => logEntryHtml(e, !!sheet?.citeMode)).join('') : `<div class="icard"><p>No entries match.</p></div>`;
      sheetEl.querySelectorAll<HTMLButtonElement>('.ichip').forEach((b) => b.classList.toggle('on', b.dataset.chip === logChip));
    }

    function renderSheet() {
      if (!sheet) return;
      let title = '';
      let tabs = '';
      let body = '';
      if (sheet.kind === 'amm') {
        const t = m.task;
        title = `${esc(t.manual)} ${esc(t.taskNo)}<small>${esc(t.title)} · page block ${t.pageBlock} · ${esc(t.effectivity)}</small>`;
        const hot = (x: string) => m.teach && ((m.multWhy && x === m.multWhy) || (m.features.manual && /hub O-ring/i.test(x)));
        body = `
          ${t.warnings.map((w) => `<div class="icard warn"><h4>WARNING</h4><p>${esc(w)}</p></div>`).join('')}
          ${t.cautions.length ? `<div class="icard caut"><h4>CAUTION</h4>${t.cautions.map((c) => `<p>${hot(c) ? `<span class="hl">${esc(c)}</span>` : esc(c)}</p>`).join('')}</div>` : ''}
          <div class="icard"><h4>NOTES</h4>${t.notes.map((n) => `<p>${esc(n)}</p>`).join('')}</div>
          <div class="icard"><h4>EFFECTIVITY NOTES</h4>${t.effNotes.map((n) => `<p><b>${n.eff ?? ''}</b> ${esc(n.text)}</p>`).join('')}</div>
          <div class="icard"><h4>PROCEDURE</h4>${t.steps.map((s) => `<p><b>${s.n}.</b> <span class="mt">${esc(s.phase)}</span> ${esc(s.text)}</p>`).join('')}</div>`;
      } else if (sheet.kind === 'rec') {
        const tab = sheet.tab ?? 'sb';
        title = `${esc(ac.registration)} records<small>${esc(ac.designation)} S/N ${esc(ac.serial)} · TT ${ac.tt.toFixed(1)} · as of ${fmtDate(ac.asOf)}</small>`;
        tabs = `<div class="itabs"><button class="tab${tab === 'sb' ? ' on' : ''}" data-tab="sb">SB / AD</button><button class="tab${tab === 'alt' ? ' on' : ''}" data-tab="alt">337s</button><button class="tab${tab === 'log' ? ' on' : ''}" data-tab="log">Logbooks</button></div>`;
        if (tab === 'sb') {
          if (!m.compliance)
            body = `<div class="icard"><h4>SB compliance record</h4><p>Not kept current on this airplane. Search the logbooks for “Complied with”.</p></div>`;
          else
            body = `
              <div class="icard"><h4>Service bulletins complied with</h4><table class="tbl">${ac.sbs.map((s) => `<tr class="${hintSb(s.id) ? 'hint' : ''}"><td>${esc(s.id)}</td><td>${esc(s.title)}<br><span class="mt">${fmtDate(s.date)} · TT ${s.tt.toFixed(1)}</span></td></tr>`).join('')}</table></div>
              <div class="icard"><h4>Service bulletins open</h4><table class="tbl">${ac.sbsOpen.map((s) => `<tr class="${hintSb(s.id) ? 'hint' : ''}"><td>${esc(s.id)}</td><td>${esc(s.title)}</td></tr>`).join('') || '<tr><td>—</td><td>none</td></tr>'}</table></div>
              <div class="icard"><h4>Airworthiness directives</h4><table class="tbl">${ac.ads.map((a) => `<tr><td>${esc(a.id)}</td><td>${esc(a.subject)}<br><span class="mt">${esc(a.note)}${a.nextDue ? ` · next due ${a.nextDue.toFixed(1)} TT` : ''}</span></td></tr>`).join('')}</table></div>`;
        } else if (tab === 'alt') {
          body = [...ac.alterations]
            .reverse()
            .map(
              (a) => `<div class="icard"><h4>${a.stc ? `STC ${esc(a.stc)}` : 'Field approval'} · ${esc(a.holder)}</h4>
                <p>${esc(a.title)}</p>
                <div class="mt">ATA ${esc(a.ata)} · Form 337 dated ${fmtDate(a.form337)} · TT ${a.tt.toFixed(1)}</div>
                <div class="mt">ICA: ${esc(a.ica)}</div>
                ${a.parts?.length ? `<button class="open" data-ica="${esc(a.id)}">Open the ICA parts list</button>` : ''}
              </div>`,
            )
            .join('');
        } else {
          body = `<div class="srch"><input type="search" enterkeyhint="search" placeholder="Search: SB, STC, P/N, 32-40…" value="${esc(logQuery)}"><button class="ichip" data-chip="all">All</button><button class="ichip" data-chip="ata">${esc(m.ata)}</button><button class="ichip" data-chip="sb">SBs</button><button class="ichip" data-chip="stc">STCs</button></div>
            ${sheet.citeMode ? `<div class="icard hint"><p><b>Engineering approval:</b> cite the entry that recorded the installation of STC ${esc(m.alteration?.stc ?? '')}.</p></div>` : ''}
            <div class="logs"></div>`;
        }
      } else {
        const a = ac.alterations.find((x) => x.displaces)!;
        title = `${esc(a.ica)}<small>Supplemental parts list · STC ${esc(a.stc!)} · ${esc(a.holder)}</small>`;
        body = `<div class="icard" style="padding:0;overflow:hidden"><div class="th" style="position:static"><span>ITEM</span><span>PART NO.</span><span>NOMENCLATURE</span><span>EFF</span><span>UPA</span></div><div class="icarows">${rowsHtml(a.parts!, 'ica')}</div></div>
          <div class="icard"><h4>ICA notes</h4>${(a.icaNotes ?? []).map((n) => `<p>${esc(n)}</p>`).join('')}</div>`;
      }
      sheetEl.innerHTML = `<div class="shtop"><div class="shtitle">${title}</div><button class="shx" data-act="close" aria-label="Close">✕</button></div>${tabs}<div class="shb">${body}</div>`;
      if (sheet.kind === 'rec' && (sheet.tab ?? 'sb') === 'log') {
        renderLog();
        const inp = sheetEl.querySelector('input') as HTMLInputElement;
        inp.addEventListener('input', () => {
          logQuery = inp.value;
          renderLog();
        });
      }
      if (sheet.kind === 'rec' && sheet.tab === 'alt') visitedRecords = true;
    }

    // ---- verdict / reveal
    function showCard(html: string) {
      vd.innerHTML = `<div class="vc">${html}</div>`;
      vd.classList.add('on');
    }

    function attempt(): IpcAttempt {
      return { lines: lines.map(({ pn, qty, src }) => ({ pn, qty, src })), marks: { ...marks }, cite, revealed };
    }

    function order() {
      if (finished || !lines.length || host.paused()) return;
      const a = attempt();
      if (wouldReveal(m, a)) {
        revealed = true;
        const alt = m.alteration!;
        const main = alt.parts![1] ?? alt.parts![0];
        host.fx.thunk();
        lines.length = 0;
        refreshSlip();
        showCard(`
          <div class="istamp" style="color:${C.mech}">DOESN’T FIT</div>
          <div class="vn"><i>!</i><span>At the airplane: the unit installed is ${esc(alt.holder)} P/N ${esc(main.pn)}, ${esc(main.nomen.toLowerCase())}. IPC Fig ${fig.fig} does not list it.</span></div>
          <div class="vn"><i>→</i><span>The part does not exist in this book. Check the logged history of this airplane, then get engineering approval.</span></div>
          <div class="vbtns"><button data-act="vclose">Back to the IPC</button><button class="pri" data-act="vlogs">Open the logbooks</button></div>`);
        host.status('Not in the IPC: research the records');
        return;
      }
      finish(a);
    }

    function finish(a: IpcAttempt) {
      finished = true;
      const sc = scoreIpc(m, a);
      const res = result(sc.score, sc.summary, { pn: sc.parts.pn, qty: sc.parts.qty, reason: sc.parts.reason, fault: sc.fault, case: m.caseKey, planted: m.planted });
      const stampTxt = sc.fault ? 'WRONG PART' : m.planted && sc.parts.pn > 0 && sc.parts.reason < 1 ? 'HELD' : res.score >= 0.6 ? 'PULLED' : 'NOT RIGHT';
      const col = sc.fault || res.score < 0.6 ? C.rust : C.palm;
      showCard(`
        <div class="istamp" style="color:${col}">${stampTxt}</div>
        ${sc.notes
          .slice(0, 6)
          .map((n) => `<div class="vn"><i style="color:${n.ok ? C.palm : C.rust}">${n.ok ? '✓' : '✗'}</i><span>${esc(n.text)}</span></div>`)
          .join('')}
        ${res.perfect ? '' : `<div class="vwhy">${m.why.map(esc).join('<br>')}</div>`}`);
      refreshSlip();
      refreshList();
      if (res.perfect) {
        flourishAt = performance.now();
        host.fx.flourish();
      } else if (res.score >= 0.6) host.fx.good();
      else host.fx.bad();
      host.status(sc.summary);
      settle(host, res, res.perfect ? 2200 : 3000);
    }

    // ---- figure: pan / zoom / callouts
    const LANE = 30;
    let z = 1;
    let px = 0;
    let py = 0;
    let tz = 1;
    let tpx = 0;
    let tpy = 0;
    let gesture = false;
    const geo = () => {
      const w = st.w;
      const h = st.h;
      // keep the drawing's proportions within reason when the panel shrinks or grows
      const availW = w - 24;
      const availH = Math.max(60, h - 2 * LANE - 12);
      const aw = Math.min(availW, availH * 2.7);
      const ah = Math.min(availH, aw / 1.7);
      return { w, h, ax: (w - aw) / 2, ay: LANE + 6 + (availH - ah) / 2, aw, ah };
    };
    const clampPan = () => {
      const g = geo();
      px = clamp(px, g.aw * (1 - z), 0);
      py = clamp(py, g.ah * (1 - z), 0);
    };
    const clampTarget = () => {
      const g = geo();
      tpx = clamp(tpx, g.aw * (1 - tz), 0);
      tpy = clamp(tpy, g.ah * (1 - tz), 0);
    };
    const boxOf = (a: ArtItem): Box => {
      const g = geo();
      const w = a.w * g.aw * z;
      const h = a.h * g.ah * z;
      const cx = g.ax + px + a.x * g.aw * z;
      const cy = g.ay + py + a.y * g.ah * z;
      return { x: cx - w / 2, y: cy - h / 2, w, h };
    };
    const rowByItem = new Map<string, IpcRow>();
    for (const r of fig.rows) if (!rowByItem.has(baseItem(r.item))) rowByItem.set(baseItem(r.item), r);

    // lanes: hardware stays on its own side; the big parts alternate to spread callouts
    const laneOf = new Map<string, Lane>();
    {
      const count = [0, 0];
      for (const a of fig.art) if (a.y < 0.3 || a.y > 0.7) laneOf.set(a.item, a.y < 0.3 ? 0 : 1);
      const main = fig.art.filter((a) => !laneOf.has(a.item)).sort((x, y) => x.x - y.x);
      for (const a of fig.art) if (laneOf.has(a.item)) count[laneOf.get(a.item)!]++;
      let flip: Lane = count[0] > count[1] ? 1 : 0;
      for (const a of main) {
        const near = (l: Lane) => fig.art.filter((o) => laneOf.get(o.item) === l && Math.abs(o.x - a.x) < 0.08).length;
        const l: Lane = near(0) === near(1) ? flip : near(0) < near(1) ? 0 : 1;
        laneOf.set(a.item, l);
        flip = (1 - l) as Lane;
      }
    }

    function balloons(): Ball[] {
      const g = geo();
      const out: Ball[] = [];
      for (const a of fig.art) {
        const b = boxOf(a);
        const lane = laneOf.get(a.item) ?? 0;
        const ax = b.x + b.w / 2;
        if (ax < -8 || ax > g.w + 8) continue;
        const ay = lane === 0 ? Math.max(LANE + 2, b.y) : Math.min(g.h - LANE - 2, b.y + b.h);
        out.push({ item: a.item, x: ax, ax, ay, lane });
      }
      for (const lane of [0, 1] as Lane[]) {
        const ls = out.filter((o) => o.lane === lane).sort((x, y) => x.ax - y.ax);
        if (!ls.length) continue;
        const gap = ls.length > 1 ? Math.min(29, (g.w - 30) / (ls.length - 1)) : 29;
        for (let i = 0; i < ls.length; i++) ls[i].x = Math.max(ls[i].ax, i ? ls[i - 1].x + gap : 15);
        for (let i = ls.length - 1; i >= 0; i--) ls[i].x = Math.min(ls[i].x, i < ls.length - 1 ? ls[i + 1].x - gap : g.w - 15);
        for (let i = 0; i < ls.length; i++) ls[i].x = Math.max(ls[i].x, i ? ls[i - 1].x + gap * 0.999 : 15);
      }
      return out;
    }

    function focusItem(item: string) {
      const a = fig.art.find((x) => x.item === item);
      if (!a) return;
      const g = geo();
      if (tz < 1.05) return; // everything is already in view
      tpx = g.aw / 2 - a.x * g.aw * tz;
      tpy = g.ah / 2 - a.y * g.ah * tz;
      clampTarget();
    }

    function zoomAt(f: number, sx: number, sy: number) {
      const g = geo();
      const nz = clamp(tz * f, 1, 4.5);
      const fx = (sx - g.ax - tpx) / (g.aw * tz);
      const fy = (sy - g.ay - tpy) / (g.ah * tz);
      tz = nz;
      tpx = sx - g.ax - fx * g.aw * tz;
      tpy = sy - g.ay - fy * g.ah * tz;
      clampTarget();
    }

    function hitTest(x: number, y: number): string | null {
      let best: string | null = null;
      let bd = 22;
      for (const b of balloons()) {
        const by = b.lane === 0 ? LANE / 2 + 2 : st.h - LANE / 2 - 2;
        const d = Math.hypot(x - b.x, y - by);
        if (d < bd) {
          bd = d;
          best = b.item;
        }
      }
      if (best) return best;
      let area = Infinity;
      for (const a of fig.art) {
        const b = boxOf(a);
        const padX = Math.max(0, (26 - b.w) / 2);
        const padY = Math.max(0, (26 - b.h) / 2);
        if (x >= b.x - padX && x <= b.x + b.w + padX && y >= b.y - padY && y <= b.y + b.h + padY && b.w * b.h < area) {
          area = b.w * b.h;
          best = a.item;
        }
      }
      return best;
    }

    const ptrs = new Map<number, { x: number; y: number; x0: number; y0: number; t0: number }>();
    let pinch: { d0: number; z0: number; fx: number; fy: number } | null = null;
    let moved = false;
    let lastTap = { t: 0, x: 0, y: 0 };
    const mid = () => {
      const v = [...ptrs.values()];
      return { x: (v[0].x + v[1].x) / 2, y: (v[0].y + v[1].y) / 2, d: Math.hypot(v[0].x - v[1].x, v[0].y - v[1].y) };
    };
    const offPtr = pointer(st.canvas, {
      down(pt) {
        if (finished) return;
        ptrs.set(pt.id, { x: pt.x, y: pt.y, x0: pt.x, y0: pt.y, t0: performance.now() });
        gesture = true;
        if (ptrs.size === 1) moved = false;
        if (ptrs.size === 2) {
          const g = geo();
          const mm = mid();
          pinch = { d0: Math.max(10, mm.d), z0: z, fx: (mm.x - g.ax - px) / (g.aw * z), fy: (mm.y - g.ay - py) / (g.ah * z) };
          moved = true;
        }
      },
      move(pt) {
        const q = ptrs.get(pt.id);
        if (!q || finished) return;
        const dx = pt.x - q.x;
        const dy = pt.y - q.y;
        q.x = pt.x;
        q.y = pt.y;
        if (Math.hypot(pt.x - q.x0, pt.y - q.y0) > 8) moved = true;
        const g = geo();
        if (ptrs.size >= 2 && pinch) {
          const mm = mid();
          z = clamp((pinch.z0 * mm.d) / pinch.d0, 1, 4.5);
          px = mm.x - g.ax - pinch.fx * g.aw * z;
          py = mm.y - g.ay - pinch.fy * g.ah * z;
          clampPan();
        } else if (moved && z > 1.01) {
          px += dx;
          py += dy;
          clampPan();
        }
        tz = z;
        tpx = px;
        tpy = py;
      },
      up(pt) {
        const q = ptrs.get(pt.id);
        ptrs.delete(pt.id);
        if (ptrs.size < 2) pinch = null;
        if (!ptrs.size) gesture = false;
        if (!q || finished || moved || ptrs.size) return;
        const now = performance.now();
        if (now - q.t0 > 450) return;
        if (now - lastTap.t < 320 && Math.hypot(pt.x - lastTap.x, pt.y - lastTap.y) < 30) {
          // double tap: zoom in there, or back out
          lastTap.t = 0;
          if (tz > 1.3) {
            tz = 1;
            tpx = 0;
            tpy = 0;
          } else zoomAt(2.4, pt.x, pt.y);
          return;
        }
        lastTap = { t: now, x: pt.x, y: pt.y };
        const it = hitTest(pt.x, pt.y);
        if (it) {
          host.fx.tap();
          selectItem(it);
        }
      },
    });

    // ---- drawing
    const stop = loop((t, dt) => {
      if (!gesture) {
        const k = rm ? 1 : 1 - Math.exp(-dt * 14);
        z += (tz - z) * k;
        px += (tpx - px) * k;
        py += (tpy - py) * k;
        if (Math.abs(tz - z) < 0.001) z = tz;
      }
      draw(t);
    });

    function draw(t: number) {
      const ctx = st.ctx;
      const g = geo();
      ctx.clearRect(0, 0, g.w, g.h);
      ctx.fillStyle = C.white;
      ctx.fillRect(0, 0, g.w, g.h);
      // faint drafting grid
      ctx.strokeStyle = 'rgba(46,124,147,0.06)';
      ctx.lineWidth = 1;
      const step = 18 * z;
      for (let x = ((px % step) + step) % step; x < g.w; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, g.h);
        ctx.stroke();
      }
      for (let y = ((py % step) + step) % step; y < g.h; y += step) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(g.w, y);
        ctx.stroke();
      }
      const lw = clamp(1 * Math.sqrt(z), 1, 1.8);
      // exploded axis: dash-dot centre line
      const main = fig.art.filter((a) => a.y > 0.3 && a.y < 0.7);
      if (main.length) {
        const y = g.ay + py + 0.5 * g.ah * z;
        const x0 = boxOf(main.reduce((a, b) => (a.x < b.x ? a : b))).x - 10;
        const x1 = (() => {
          const bb = boxOf(main.reduce((a, b) => (a.x > b.x ? a : b)));
          return bb.x + bb.w + 10;
        })();
        ctx.setLineDash([14, 4, 3, 4]);
        ctx.strokeStyle = 'rgba(31,42,48,0.45)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // hardware installation lines
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = 'rgba(31,42,48,0.35)';
      ctx.lineWidth = 0.8;
      for (const a of fig.art) {
        if (a.y > 0.3 && a.y < 0.7) continue;
        const b = boxOf(a);
        const cx = b.x + b.w / 2;
        const yAxis = g.ay + py + 0.5 * g.ah * z;
        ctx.beginPath();
        ctx.moveTo(cx, a.y < 0.5 ? b.y + b.h : b.y);
        ctx.lineTo(cx, yAxis + (a.y < 0.5 ? -g.ah * z * 0.12 : g.ah * z * 0.12));
        ctx.stroke();
      }
      ctx.setLineDash([]);
      // parts, back to front (right to left)
      const order = [...fig.art].sort((a, b) => b.x - a.x);
      for (const a of order) {
        const b = boxOf(a);
        if (b.x > g.w + 4 || b.x + b.w < -4) continue;
        const r = rowByItem.get(a.item);
        const mat = matOf(r?.nomen ?? '', a.shape);
        const state = selItem === a.item ? 'sel' : 'n';
        drawShape(ctx, a.shape, b, lookFor(mat, state, lw), mat);
      }
      // teaching: circle the damaged part
      const pulse = rm ? 0.5 : 0.5 + 0.5 * Math.sin(t * 4);
      if (m.circled) {
        const a = fig.art.find((x) => x.item === m.item);
        if (a) {
          const b = boxOf(a);
          ctx.strokeStyle = C.rust;
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 4]);
          ell(ctx, b.x + b.w / 2, b.y + b.h / 2, Math.max(12, b.w / 2 + 8), Math.max(12, b.h / 2 + 8));
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      // callouts
      const bs = balloons();
      for (const bl of bs) {
        const by = bl.lane === 0 ? LANE / 2 + 2 : g.h - LANE / 2 - 2;
        const sel = selItem === bl.item;
        ctx.strokeStyle = sel ? C.seaDeep : 'rgba(31,42,48,0.55)';
        ctx.lineWidth = sel ? 1.4 : 0.8;
        ctx.beginPath();
        ctx.moveTo(bl.x, by + (bl.lane === 0 ? 11 : -11));
        ctx.lineTo(bl.ax, bl.ay);
        ctx.stroke();
        ctx.fillStyle = ctx.strokeStyle;
        ctx.beginPath();
        ctx.arc(bl.ax, bl.ay, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
      for (const bl of bs) {
        const by = bl.lane === 0 ? LANE / 2 + 2 : g.h - LANE / 2 - 2;
        const sel = selItem === bl.item;
        const hot = m.circled && bl.item === m.item;
        if (hot) {
          ctx.strokeStyle = C.rust;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(bl.x, by, 14 + 3 * pulse, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(bl.x, by, 11.5, 0, Math.PI * 2);
        ctx.fillStyle = sel ? C.seaDeep : C.white;
        ctx.fill();
        ctx.strokeStyle = hot ? C.rust : C.ink;
        ctx.lineWidth = 1.3;
        ctx.stroke();
        ctx.font = `800 ${bl.item.length > 2 ? 9.5 : 11}px ${FONT}`;
        ctx.fillStyle = sel ? C.white : C.ink;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(bl.item, bl.x, by + 0.5);
      }
      if (flourishAt) {
        const k = clamp((performance.now() - flourishAt) / 900, 0, 1);
        if (k < 1) {
          ctx.globalAlpha = 0.4 * (1 - k);
          ctx.fillStyle = C.palm;
          ctx.fillRect(0, 0, g.w, g.h);
          ctx.globalAlpha = 1;
        }
      }
    }

    // ---- DOM events (one delegated handler)
    let plateHold = 0;
    const onDown = (e: PointerEvent) => {
      markInput();
      const el = (e.target as HTMLElement).closest('[data-act="plate"]');
      if (el) plateHold = performance.now();
    };
    const onClick = (e: MouseEvent) => {
      markInput();
      const t = e.target as HTMLElement;
      const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act === 'vclose' || act === 'vlogs') {
        vd.classList.remove('on');
        if (act === 'vlogs') openSheet({ kind: 'rec', tab: 'log' });
        return;
      }
      if (finished && act !== 'plate' && act !== 'amm' && act !== 'rec' && act !== 'close') return;
      if (act === 'plate') {
        plate.classList.toggle('on');
        (t.closest('[data-act]') as HTMLElement).classList.toggle('on', plate.classList.contains('on'));
        host.fx.tap();
        return;
      }
      if (act === 'amm') return openSheet({ kind: 'amm' });
      if (act === 'rec') return openSheet({ kind: 'rec', tab: m.teach && !m.premarked && !m.compliance ? 'log' : 'sb' });
      if (act === 'close') return closeSheet();
      if (act === 'eff') {
        list.scrollTo({ top: 0, behavior: rm ? 'auto' : 'smooth' });
        const box = list.querySelector('.effbox') as HTMLElement;
        box.animate?.([{ background: 'rgba(224,164,88,.45)' }, { background: C.paper }], { duration: 900 });
        return;
      }
      if (act === 'order') return order();
      if (act === 'cite') return openSheet({ kind: 'rec', tab: 'log', citeMode: true });
      const zbtn = t.closest<HTMLElement>('[data-z]');
      if (zbtn) {
        const g = geo();
        zoomAt(zbtn.dataset.z === '1' ? 1.6 : 1 / 1.6, g.w / 2, g.ay + g.ah / 2);
        host.fx.tick();
        return;
      }
      const ec = t.closest<HTMLButtonElement>('.ec');
      if (ec && !m.premarked) {
        const code = ec.dataset.code as 'A' | 'B' | 'C' | 'D';
        if (code === 'A' || code === 'B') marks.ab = marks.ab === code ? undefined : code;
        else marks.cd = marks.cd === code ? undefined : code;
        host.fx.pencil();
        host.fx.tap();
        refreshList();
        coach();
        return;
      }
      const go = t.closest<HTMLElement>('[data-go]');
      if (go) {
        const pn = go.dataset.go!;
        const inIca = !!t.closest('.icarows');
        if (!inIca) {
          const i = fig.rows.findIndex((r) => r.pn === pn);
          if (i >= 0) {
            host.fx.tap();
            selectRow(i, 'link');
          }
        }
        return;
      }
      const add = t.closest<HTMLElement>('[data-add]');
      if (add) {
        const icaRow = t.closest('.icarows');
        if (icaRow) {
          const a = ac.alterations.find((x) => x.displaces)!;
          addLine('ica', a.parts![Number(add.dataset.add)]);
          closeSheet();
        } else addLine('ipc', fig.rows[Number(add.dataset.add)]);
        return;
      }
      const q = t.closest<HTMLElement>('[data-q]');
      if (q) {
        const l = lines[Number(q.dataset.l)];
        if (l) {
          l.qty = clamp(l.qty + Number(q.dataset.q), 1, 48);
          host.fx.tick();
          refreshSlip();
          host.status(`Request: ${lines.map((x) => `${x.pn} ×${x.qty}`).join(' + ')}`);
        }
        return;
      }
      const rmv = t.closest<HTMLElement>('[data-rm]');
      if (rmv) {
        const l = lines.splice(Number(rmv.dataset.rm), 1)[0];
        if (l?.src === 'ica' && !lines.some((x) => x.src === 'ica')) cite = undefined;
        host.fx.swipe();
        refreshSlip();
        coach();
        return;
      }
      const tab = t.closest<HTMLElement>('[data-tab]');
      if (tab && sheet?.kind === 'rec') {
        sheet.tab = tab.dataset.tab as 'sb' | 'alt' | 'log';
        host.fx.tap();
        renderSheet();
        return;
      }
      const chip = t.closest<HTMLElement>('[data-chip]');
      if (chip) {
        logChip = chip.dataset.chip as typeof logChip;
        host.fx.tap();
        renderLog();
        return;
      }
      const ica = t.closest<HTMLElement>('[data-ica]');
      if (ica) {
        host.fx.tap();
        openSheet({ kind: 'ica' });
        return;
      }
      const ct = t.closest<HTMLElement>('[data-cite]');
      if (ct) {
        cite = ct.dataset.cite;
        host.fx.pencil();
        host.fx.snap();
        closeSheet();
        refreshSlip();
        host.status('Log entry cited on the approval request');
        return;
      }
      const row = t.closest<HTMLElement>('.r');
      if (row) {
        const i = Number(row.dataset.i);
        if (row.dataset.src === 'ica') {
          // ICA rows: select to reveal the add button
          sheetEl.querySelectorAll<HTMLElement>('.icarows .r').forEach((x) => {
            const on = x === row;
            x.classList.toggle('sel', on);
            const rx = x.querySelector('.rx') as HTMLElement;
            const a = ac.alterations.find((y) => y.displaces)!;
            const r = a.parts![Number(x.dataset.i)];
            rx.innerHTML = on ? `<button class="add" data-add="${x.dataset.i}" ${r.upa === 'RF' ? 'disabled' : ''}>${r.upa === 'RF' ? 'Reference only' : `+ Add ${esc(r.pn)} to request`}</button>` : '';
          });
          host.fx.tap();
          return;
        }
        host.fx.tap();
        selectRow(i === selRow ? -1 : i, 'list');
        if (i !== selRow) selItem = null;
        refreshList();
        return;
      }
      if (t === shade) closeSheet();
    };
    const onUp = () => {
      // press-and-hold peeks the plate; a quick tap toggles it (click handler)
      if (plateHold && performance.now() - plateHold > 380 && plate.classList.contains('on')) {
        setTimeout(() => plate.classList.remove('on'), 0);
      }
      plateHold = 0;
    };
    const onPlate = () => {
      plate.classList.remove('on');
      job.querySelector('[data-act="plate"]')?.classList.remove('on');
    };
    // the panel the thumb is working in gets the room: the list while reading rows, the figure while hunting callouts
    const onListDown = () => root.classList.add('lf');
    const onFigDown = () => root.classList.remove('lf');
    list.addEventListener('pointerdown', onListDown);
    figEl.addEventListener('pointerdown', onFigDown);
    root.addEventListener('pointerdown', onDown, { capture: true });
    root.addEventListener('click', onClick);
    root.addEventListener('pointerup', onUp);
    plate.addEventListener('click', onPlate);

    // automation hook (lab / playtests): where a callout sits on screen
    (root as HTMLElement & { __ipc?: unknown }).__ipc = {
      callout(item: string) {
        const b = balloons().find((x) => x.item === item);
        if (!b) return null;
        const r = st.canvas.getBoundingClientRect();
        return { x: r.left + b.x, y: r.top + (b.lane === 0 ? LANE / 2 + 2 : st.h - LANE / 2 - 2) };
      },
      model: m,
    };

    refreshList();
    refreshSlip();
    coach();
    host.status(`${ac.registration} · IPC Fig ${fig.fig}`);
    void visitedRecords;

    return {
      timeUp(): PuzzleResult {
        if (finished) return result(scoreIpc(m, attempt()).score, 'Time');
        finished = true;
        const sc = scoreIpc(m, attempt());
        return result(sc.score, sc.summary, { pn: sc.parts.pn, qty: sc.parts.qty, reason: sc.parts.reason, fault: sc.fault, case: m.caseKey, planted: m.planted, timeUp: true });
      },
      destroy() {
        stop();
        offPtr();
        root.removeEventListener('pointerdown', onDown, { capture: true });
        list.removeEventListener('pointerdown', onListDown);
        figEl.removeEventListener('pointerdown', onFigDown);
        root.removeEventListener('click', onClick);
        root.removeEventListener('pointerup', onUp);
        st.destroy();
        root.remove();
      },
    };
  },
};
