// Mechanic · Logbook research. The mechanic's own words: "When I get a task I
// get a manual. I follow manual. If part is gone or missing or damaged: IPC. If
// part no exist, I check in previous logged items on airplane, the maintenance
// logs, and then get engineering approval to put part on airplane."
//
// So the job starts where the manual and the IPC run out: the part on the
// airplane is not the one the IPC lists for it. Flip through the airframe,
// engine and propeller logs (dated pages, tabs by year, a lot of ordinary
// entries), swipe the highlighter over the entry that explains the
// configuration (or say nothing does), pick how the replacement gets approved,
// and fill the engineering request or the logbook entry.
//
// Cases (all from src/sim/aircraft.ts, the island's real paper trail):
//  stc   an STC replaced the assembly: cite the STC, its Form 337 and the
//        holder's ICA parts list; engineering approves the part for this tail
//  field the same kit went on under an FSDO field approval because this model
//        is not on the STC's list: the 337 is the approval, not the STC
//  sb    a service bulletin changed the part: the IPC lists both by effectivity
//        and the SB entry says which applies; minor, logbook entry, no engineering
//  pma   the last replacement used an FAA-PMA part: its eligibility approves it
//  none  nothing in the books explains the part: an unrecorded alteration, a
//        major that needs new approved data (DER 8110-3 on a 337 or a field
//        approval) before the airplane flies
// Asking engineering when approved data already exists costs time (partial);
// installing without the approval the part needs is a serious fault.
// Tiers 0–2 teach (the entry outlined, year starred, hints on effectivity and
// on which entry matters); from tier 3 only what a mechanic would really see.
import {
  ATA_TITLE,
  IPC_ATAS,
  PMA_ATAS,
  aircraftOf,
  ammTaskFor,
  figSb,
  fmtDate,
  ipcFor,
  plantPart,
  MAKER,
  rowFor,
  taskKeyFor,
  type Aircraft,
  type AmmTask,
  type Ata,
  type IpcFigure,
  type IpcRow,
  type LogBook,
  type LogEntry,
  type PlaneModel,
} from '../sim/aircraft';
import { hashSeed, rng, type Rng } from '../sim/rng';
import { C, FONT, settle } from './kit';
import { result, type PuzzleContext, type PuzzleDef, type PuzzleResult } from './types';

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export type LbCase = 'stc' | 'field' | 'sb' | 'pma' | 'none';
/**
 * ipc  Minor: IPC part, logbook entry (14 CFR 43.9)
 * pma  FAA-PMA part, logbook entry citing its eligibility
 * eng  Engineering approval on approved data already on file (STC / field-approved 337)
 * new  Major: no approved data on file, engineering gets new data (DER 8110-3 on a 337, or an FSDO field approval)
 */
export type LbRoute = 'ipc' | 'pma' | 'eng' | 'new';
export type FieldId = 'aircraft' | 'ata' | 'work' | 'pn' | 'ref' | 'data' | 'date';
export type Opt = { id: string; label: string; sub?: string };

export const ROUTES: { id: LbRoute; title: string; text: string; form: 'entry' | 'request' }[] = [
  { id: 'ipc', title: 'Minor: IPC part', text: 'Listed and effective in the IPC for this S/N and SB status. Install IAW the MM, logbook entry (43.9).', form: 'entry' },
  { id: 'pma', title: 'FAA-PMA part', text: 'A PMA replacement whose eligibility list covers this installation. Logbook entry citing the PMA.', form: 'entry' },
  { id: 'eng', title: 'Engineering: approved data on file', text: 'An STC or a field-approved Form 337 covers it. Cite it and the ICA parts list; engineering approves the part for this tail.', form: 'request' },
  { id: 'new', title: 'Engineering: new approved data (major)', text: 'Nothing on file covers it. DER data (8110-3) on a Form 337 or an FSDO field approval. Aircraft stays down.', form: 'request' },
];

export const FIELDS_FOR: Record<LbRoute, FieldId[]> = {
  ipc: ['aircraft', 'ata', 'work', 'pn', 'ref'],
  pma: ['aircraft', 'ata', 'work', 'pn', 'ref'],
  eng: ['aircraft', 'ata', 'work', 'pn', 'data', 'date'],
  new: ['aircraft', 'ata', 'work', 'pn'],
};

export const FIELD_LABEL: Record<FieldId, string> = {
  aircraft: 'Aircraft (reg · S/N)',
  ata: 'ATA chapter',
  work: 'Work (what and why)',
  pn: 'Part number to install',
  ref: 'Reference (approved data)',
  data: 'Approved data on file',
  date: 'Form 337 date',
};

export type LbJob = { wo: string; title: string; squawk: string };

export type LbModel = {
  tier: number;
  kase: LbCase;
  ac: Aircraft;
  ata: Ata;
  /** IPC tag of the part the job replaces */
  tag: string;
  item: string;
  job: LbJob;
  /** P/N stamped on the part that came off */
  found: string;
  /** stores pulled this one (sb case: the pre-SB row) */
  issued?: string;
  ipc: IpcFigure;
  /** the figure rows for this part (every effectivity) */
  rows: IpcRow[];
  task: AmmTask;
  /** entries per book, oldest first */
  books: Record<LogBook, LogEntry[]>;
  /** the entry that explains the configuration, or 'none' */
  answer: string;
  /** entries that point at the answer (cite the approval, or show the part after the SB): part credit */
  partial: string[];
  /** P/Ns a replacement may legally be (for a logbook-entry route) */
  eligible: string[];
  /** the IPC row in force for this part on this airplane */
  ipcRow: IpcRow;
  pmaPn?: string;
  pmaText?: string;
  /** what the approval is called in records: "STC SA0…", "Form 337 dated … (field approval)" */
  approvalRef?: string;
  opts: Record<FieldId, Opt[]>;
  prefill: Partial<Record<FieldId, string>>;
  teach: {
    /** tier 0: the answer entry is outlined */
    markEntry: boolean;
    /** tiers 0–1: the answer's year tab carries a star */
    starYear: boolean;
    /** tiers 0–2: IPC shows which S/N effectivity applies */
    showApplies: boolean;
    /** research hint for the sticky note (tiers 0–2) */
    hint?: string;
    /** field hints under the form rows (tiers 0–1) */
    fieldHints: Partial<Record<FieldId, string>>;
  };
};

export type LbAnswer = {
  /** highlighted entry id, 'none' (nothing explains it) or null */
  entry: string | null;
  route: LbRoute | null;
  values: Partial<Record<FieldId, string>>;
  /** requests engineering sent back */
  returns: number;
  /** paperwork handed in (request approved / entry signed / final verdict) */
  submitted: boolean;
};

const PMA_TAG: Record<string, string> = { '32-40': 'lining', '29-10': 'filter' };
const SB_TAG: Record<Ata, string> = { '32-40': 'lining', '61-10': 'propBolt', '29-10': 'resCap', '23-10': 'radio', '24-30': 'generator' };
/** parts next to the one the job needs, in the same IPC figure */
const RELATED: Record<string, string[]> = {
  lining: ['backPlate', 'rivet', 'disc'],
  propBolt: ['hubOring', 'spinnerScrew', 'blade'],
  filter: ['bowlOring', 'resCap', 'reservoir'],
  resCap: ['capOring', 'reservoir', 'filter'],
  radio: ['tray', 'lockScrew', 'connector'],
  generator: ['brushes', 'pulleyNut', 'belt', 'qad', 'vband'],
};
const TASK_OF: Record<Ata, string> = { '32-40': 'brake', '61-10': 'prop', '29-10': 'powerpack', '23-10': 'radio', '24-30': 'alternator' };

/** ATA chapter-sections a tired mechanic might write instead (code, title) */
const ATA_NEAR: Record<Ata, [string, string][]> = {
  '32-40': [['32-10', 'Main gear and doors'], ['32-30', 'Extension and retraction'], ['32-60', 'Position and warning'], ['32-00', 'Landing gear, general']],
  '61-10': [['61-20', 'Propeller controlling'], ['61-00', 'Propellers, general'], ['61-40', 'Propeller indicating'], ['72-00', 'Engine (turbine / turboprop)']],
  '29-10': [['29-30', 'Hydraulic indicating'], ['29-20', 'Auxiliary hydraulic power'], ['32-30', 'Extension and retraction'], ['29-00', 'Hydraulic power, general']],
  '23-10': [['23-50', 'Audio integrating'], ['34-50', 'Dependent position determining'], ['23-00', 'Communications, general'], ['34-20', 'Attitude and direction']],
  '24-30': [['24-20', 'AC generation'], ['24-60', 'DC electrical load distribution'], ['80-10', 'Starting: cranking'], ['24-00', 'Electrical power, general']],
};

type JobText = { title: string; squawk: string; work: string[]; why: string[] };

/** work order text and the work statements: [0] is right, the rest are the classic mistakes */
function jobText(model: PlaneModel, tag: string, insp: string): JobText {
  const twin = model === 'twin';
  switch (tag) {
    case 'lining':
      return {
        title: 'Main brake linings',
        squawk: `LH and RH main brake linings below minimum thickness at the ${insp}. Replace.`,
        work: [
          'Replace LH and RH main brake linings, worn below minimum',
          'Replace LH main brake linings only (worst side)',
          'Replace LH and RH main brake assemblies',
          'Install heavy-duty brake conversion',
        ],
        why: ['', 'MM caution: replace the linings on both main wheels together.', 'The work order is for the linings, not the brake assemblies.', 'That describes installing an alteration, not replacing a part in it.'],
      };
    case 'propBolt':
      return {
        title: 'Propeller mounting bolts',
        squawk: `Propeller off for spinner bulkhead repair${twin ? ' (LH)' : ''}. Two mounting bolts with galled threads. New bolt set at reinstallation.`,
        work: [
          'Replace propeller mounting bolts (full set) at reinstallation',
          'Replace the propeller assembly',
          'Install four-blade propeller conversion',
          'Chase the threads and reuse the mounting bolts',
        ],
        why: ['', 'The work order is for the mounting bolts, not the propeller.', 'That describes installing an alteration, not replacing a part in it.', 'Galled bolts are replaced, never chased and reused.'],
      };
    case 'filter':
      return {
        title: 'Hydraulic filter element',
        squawk: 'Filter bypass indicator extended after the gear swing. Replace the filter element.',
        work: [
          'Replace hydraulic filter element (bypass indicator extended)',
          'Replace the hydraulic power pack',
          'Install replacement power pack (conversion)',
          'Clean and reinstall the filter element',
        ],
        why: ['', 'The work order is for the filter element, not the power pack.', 'That describes installing an alteration, not replacing a part in it.', 'The element is disposable: it is replaced, not cleaned.'],
      };
    case 'resCap':
      return {
        title: 'Reservoir filler cap',
        squawk: 'Hydraulic reservoir filler cap cracked, seeping at the vent. Replace.',
        work: ['Replace hydraulic reservoir filler cap (cracked)', 'Replace the reservoir', 'Replace the hydraulic power pack', 'Seal the crack and reinstall the cap'],
        why: ['', 'The work order is for the filler cap, not the reservoir.', 'The work order is for the filler cap, not the power pack.', 'A cracked cap is replaced, not sealed.'],
      };
    case 'radio':
      return {
        title: 'Com radio',
        squawk: 'Com 1 transmit inoperative. Replace with an exchange unit.',
        work: [
          'Replace com radio with exchange unit (transmit inoperative)',
          'Install GPS/NAV/COM (new installation)',
          'Replace the mounting tray and connector',
          'Repair the radio on the bench in house',
        ],
        why: ['', 'That describes a new installation (an alteration), not a replacement.', 'The work order is for the radio, not the tray.', 'Avionics internals go to a certificated repair station, not the hangar bench.'],
      };
    default: {
      const sg = model === 'cargo';
      const unit = sg ? 'starter-generator' : 'alternator';
      return {
        title: sg ? 'Starter-generator' : 'Alternator',
        squawk: `${twin ? 'LH alternator' : sg ? 'Starter-generator' : 'Alternator'} no output on the ground run. Replace with an exchange unit.`,
        work: [
          `Replace ${twin ? 'LH ' : ''}${unit} with exchange unit (no output)`,
          `Install ${unit} conversion`,
          sg ? 'Replace the generator control unit' : 'Replace the voltage regulator',
          'Replace the drive belt only',
        ],
        why: ['', 'That describes installing an alteration, not replacing a part in it.', `The work order is for the ${unit}.`, `The work order is for the ${unit}.`],
      };
    }
  }
}

function swapDigits(sn: string, r: Rng): string {
  const d = [...sn];
  const idx = d.map((c, i) => (/\d/.test(c) ? i : -1)).filter((i) => i >= 0);
  for (let k = 0; k < 8; k++) {
    const i = idx[r.int(Math.max(0, idx.length - 3), idx.length - 2)];
    if (d[i] !== d[i + 1] && /\d/.test(d[i + 1] ?? '')) {
      [d[i], d[i + 1]] = [d[i + 1], d[i]];
      return d.join('');
    }
  }
  const last = idx[idx.length - 1];
  d[last] = String((Number(d[last]) + 3) % 10);
  return d.join('');
}

const OTHER: Record<PlaneModel, [string, PlaneModel]> = { twin: ['p2', 'cargo'], cargo: ['p3', 'float'], float: ['p1', 'twin'] };
const ASSET_OF: Record<PlaneModel, string> = { twin: 'p1', cargo: 'p2', float: 'p3' };

function modelFrom(ctx: PuzzleContext | undefined, r: Rng): PlaneModel {
  const n = `${ctx?.assetName ?? ''}`.toLowerCase();
  if (n.includes('cargo')) return 'cargo';
  if (n.includes('float')) return 'float';
  if (n.includes('twin')) return 'twin';
  return r.pick(['twin', 'cargo', 'float'] as const);
}

function jobAta(job: string | undefined): Ata | undefined {
  if (!job) return undefined;
  const key = taskKeyFor(job);
  if (!key) return undefined;
  const hit = (Object.keys(TASK_OF) as Ata[]).find((a) => TASK_OF[a] === key || (key === 'wheel' && a === '32-40'));
  return hit;
}

function casePool(tier: number): LbCase[] {
  if (tier <= 0) return ['stc'];
  if (tier === 1) return ['stc', 'sb'];
  if (tier === 2) return ['stc', 'sb', 'field'];
  if (tier === 3) return ['stc', 'sb', 'field', 'pma'];
  return ['stc', 'sb', 'field', 'pma', 'none'];
}

const sbEntry = (ac: Aircraft, ata: Ata) => {
  const id = figSb(ac.model, ata).id;
  return ac.log.find((e) => e.kind === 'sb' && e.ref === `IAW ${id}`);
};

/** build the airplane for one case, or undefined when this airplane's records can't carry it */
function buildCase(kase: LbCase, seed: number, assetId: string, model: PlaneModel, ata: Ata): Aircraft | undefined {
  if (kase === 'stc' || kase === 'field') return aircraftOf(seed, assetId, model, { plant: ata, via: kase });
  if (kase === 'pma') {
    if (!PMA_ATAS.includes(ata)) return undefined;
    const ac = aircraftOf(seed, assetId, model, { plant: ata, via: 'pma' });
    return ac.plant ? ac : undefined;
  }
  const ac = aircraftOf(seed, assetId, model);
  if (kase === 'sb') return sbEntry(ac, ata) ? ac : undefined;
  return ac;
}

export function generateLogbook(seed: number, tier: number, _tools: string[] = [], context?: PuzzleContext): LbModel {
  const r = rng(hashSeed('logbook', seed, tier));
  const given = context?.aircraft;
  const model = given ? given.model : modelFrom(context, r);
  const islandSeed = given ? given.islandSeed : hashSeed('island', seed);
  const assetId = given ? given.assetId : ASSET_OF[model];
  const fixedAta = jobAta(context?.job);

  let kase: LbCase | undefined;
  let ata: Ata | undefined;
  let ac: Aircraft | undefined;
  if (given?.plant) {
    kase = given.plant.via;
    ata = given.plant.ata;
    ac = given;
  } else {
    const pool = casePool(tier);
    const first = r.pick(pool);
    const cases = [first, ...r.shuffle(pool.filter((c) => c !== first))];
    const atas = fixedAta ? [fixedAta] : r.shuffle([...IPC_ATAS]);
    search: for (const k of cases) {
      for (const a of atas) {
        const built = buildCase(k, islandSeed, assetId, model, a);
        if (built) {
          kase = k;
          ata = a;
          ac = built;
          break search;
        }
      }
    }
    // stc is always possible
    if (!ac || !kase || !ata) {
      kase = 'stc';
      ata = atas[0];
      ac = aircraftOf(islandSeed, assetId, model, { plant: ata });
    }
  }

  const ipc = ipcFor(ac, ata);
  const plant = ac.plant;
  const tag = kase === 'sb' ? SB_TAG[ata] : kase === 'pma' ? PMA_TAG[ata] : plantPart(model, ata).tag;
  const rows = ipc.rows.filter((x) => x.tag === tag);
  const ipcRow = rowFor(ipc, tag)!;
  const insp = model === 'cargo' ? 'phase inspection' : '100-hour';
  const jt = jobText(model, tag, insp);
  const woNo = `WO ${ac.asOf.slice(2, 4)}-${String(r.int(120, 980)).padStart(4, '0')}`;
  const job: LbJob = { wo: woNo, title: jt.title, squawk: jt.squawk };

  // what came off the airplane, what the answer entry is, and what else points at it
  let found = ipcRow.pn;
  let issued: string | undefined;
  let answer = 'none';
  let partial: string[] = [];
  let eligible: string[] = [];
  let pmaPn: string | undefined;
  let pmaText: string | undefined;
  let approvalRef: string | undefined;
  if ((kase === 'stc' || kase === 'field') && plant) {
    found = plant.neededPn;
    answer = plant.entryId;
    partial = plant.laterEntryIds;
    eligible = [];
    approvalRef = plant.ref;
  } else if (kase === 'pma' && plant) {
    found = plant.neededPn;
    answer = plant.entryId;
    pmaPn = plant.neededPn;
    pmaText = plant.ica;
    eligible = [plant.neededPn, ipcRow.pn];
    approvalRef = plant.ref;
  } else if (kase === 'sb') {
    const pre = rows.find((x) => x.eff === 'D') ?? rows[0];
    const post = rows.find((x) => x.eff === 'C') ?? ipcRow;
    found = post.pn;
    issued = pre.pn;
    const e = sbEntry(ac, ata)!;
    answer = e.id;
    partial = ac.log.filter((x) => x.date > e.date && x.ata === ata && x.pns?.some((p) => p.on === post.pn)).map((x) => x.id);
    eligible = [post.pn];
    approvalRef = figSb(model, ata).id;
  } else {
    // none: the kit's part is on the airplane and nothing in the books says how
    found = plantPart(model, ata).pn;
  }

  const books: Record<LogBook, LogEntry[]> = { airframe: [], engine: [], propeller: [] };
  for (const e of ac.log) books[e.book].push(e);

  // ---- the form's choices, drawn from this airplane's own paperwork ----
  const n = tier <= 1 ? 3 : tier === 2 ? 4 : 5;
  const titles = tier <= 2;
  const take = (right: Opt[], wrong: Opt[], count = n) => r.shuffle([...right, ...r.shuffle(wrong).slice(0, Math.max(0, count - right.length))]);

  const [otherId, otherModel] = OTHER[model];
  const other = aircraftOf(islandSeed, otherId, otherModel);
  const propSn = /S\/N (FN\d+)/.exec(books.propeller.map((e) => e.text).join(' '))?.[1] ?? `FN${r.int(10000, 99999)}`;
  const aircraftOpts = take(
    [{ id: 'ac', label: `${ac.registration} · S/N ${ac.serial}`, sub: titles ? `${ac.designation} airframe` : undefined }],
    [
      { id: 'engine', label: `${ac.registration} · S/N ${ac.engines[0].serial}`, sub: titles ? `${ac.engines[0].model} engine` : undefined },
      { id: 'other', label: `${other.registration} · S/N ${other.serial}`, sub: titles ? `${other.designation} airframe` : undefined },
      { id: 'swap', label: `${ac.registration} · S/N ${swapDigits(ac.serial, r)}` },
      { id: 'prop', label: `${ac.registration} · S/N ${propSn}`, sub: titles ? 'propeller' : undefined },
    ],
  );
  const ataOpts = take(
    [{ id: ata, label: ata, sub: titles ? ATA_TITLE[ata] : undefined }],
    ATA_NEAR[ata].map(([code, t]) => ({ id: code, label: code, sub: titles ? t : undefined })),
  );
  const workOpts = take(
    [{ id: 'w0', label: jt.work[0] }],
    jt.work.slice(1).map((label, i) => ({ id: `w${i + 1}`, label })),
    Math.min(4, n),
  );

  // part numbers: what is on it, what the IPC lists, the other effectivity, the kit, a detail part
  const pnRight = new Set<string>();
  if (kase === 'stc' || kase === 'field' || kase === 'none') pnRight.add(found);
  if (kase === 'sb') pnRight.add(found);
  if (kase === 'pma') pnRight.add(found).add(ipcRow.pn);
  const pnPool = new Map<string, string | undefined>();
  const addPn = (pn: string | undefined, sub?: string) => {
    if (pn && !pnPool.has(pn)) pnPool.set(pn, titles ? sub : undefined);
  };
  // only the first lessons say which one came off the airplane
  if (tier <= 1) addPn(found, 'on the airplane');
  else addPn(found);
  addPn(ipcRow.pn, `IPC item ${ipcRow.item}`);
  for (const x of rows) addPn(x.pn, `IPC item ${x.item}`);
  const kit = plantPart(model, ata);
  if (kase === 'stc' || kase === 'field' || kase === 'none') {
    addPn(kit.kit, 'conversion kit');
    const detail = ac.alterations.find((a) => a.displaces)?.parts?.find((x) => x.indent >= 2 && x.pn !== found)?.pn;
    addPn(detail, 'kit detail part');
  } else addPn(kit.pn, `${kit.holder} (STC kit part)`);
  if ((kase === 'sb' || kase === 'pma') && (tag === 'lining' || tag === 'filter')) {
    // a PMA part for the other effectivity: right maker, wrong configuration
    const otherRow = rows.find((x) => x.pn !== ipcRow.pn) ?? ipcRow;
    addPn(tag === 'lining' ? `RF${otherRow.pn}` : `PF${otherRow.pn.replace(/^DH-/, '')}`, 'PMA, other effectivity');
  }
  // neighbours in the same figure: the parts a hurried look lands on
  for (const t of RELATED[tag] ?? []) {
    const x = rowFor(ipc, t);
    if (x) addPn(x.pn, `IPC item ${x.item} (${x.nomen.toLowerCase()})`);
  }
  const pnAll = [...pnPool.entries()].map(([pn, sub]) => ({ id: pn, label: pn, sub }));
  const pnOpts = take(
    pnAll.filter((o) => pnRight.has(o.id) && (kase !== 'pma' || o.id === found || o.id === ipcRow.pn)),
    pnAll.filter((o) => !pnRight.has(o.id)),
  );

  // logbook-entry reference: IPC rows (in force or not), PMA eligibility, and two classic non-approvals
  const refOpts = take(
    [
      { id: `ipc:${ipcRow.item}`, label: `IPC Fig ${ipc.fig}, item ${ipcRow.item}`, sub: `${ipcRow.pn}${ipcRow.eff ? ` · eff ${ipcRow.eff}` : ''}` },
      ...(pmaText ? [{ id: 'pma', label: `FAA-PMA ${pmaPn}`, sub: pmaText }] : []),
    ],
    [
      ...rows.filter((x) => x.item !== ipcRow.item).map((x) => ({ id: `ipc:${x.item}`, label: `IPC Fig ${ipc.fig}, item ${x.item}`, sub: `${x.pn}${x.eff ? ` · eff ${x.eff}` : ''}` })),
      { id: '8130', label: 'FAA 8130-3 tag on the new part', sub: titles ? 'airworthiness release' : undefined },
      { id: 'same', label: 'Same P/N as the part removed', sub: titles ? 'like for like' : undefined },
      ...(!pmaText ? [{ id: 'pmaX', label: 'FAA-PMA: supplier cross-reference', sub: titles ? 'parts catalog listing' : undefined }] : []),
    ],
    Math.max(n, pmaText ? 4 : 3),
  );

  // approved data on file: every alteration in the records (plus the STC a field approval borrowed from)
  const altLabel = (a: Aircraft['alterations'][number]) =>
    a.stc ? { label: `STC ${a.stc}`, sub: titles ? `${a.holder}: ${a.title}` : undefined } : { label: 'Form 337 (field approval)', sub: titles ? a.title : `dated ${fmtDate(a.form337)}` };
  const dataRight: Opt[] = [];
  const dataWrong: Opt[] = [];
  for (const a of ac.alterations) {
    const o = { id: `alt:${a.id}`, ...altLabel(a) };
    if (a.displaces && (kase === 'stc' || kase === 'field')) dataRight.push(o);
    else dataWrong.push(o);
  }
  if (plant?.basisStc) dataWrong.push({ id: 'basis', label: `STC ${plant.basisStc}`, sub: titles ? `${plant.holder}: ${plant.ata} kit (basis data)` : undefined });
  const dataOpts = take(dataRight, dataWrong, Math.max(n, Math.min(5, dataRight.length + dataWrong.length)));

  // Form 337 dates: the right one, the other 337s, and dates that sit next to it in the books
  const dateRight: Opt[] = [];
  const dateWrong = new Map<string, Opt>();
  if (plant && plant.form337) dateRight.push({ id: plant.form337, label: fmtDate(plant.form337) });
  for (const a of ac.alterations) if (!a.displaces) dateWrong.set(a.form337, { id: a.form337, label: fmtDate(a.form337) });
  const near = ac.log.filter((e) => e.kind === 'annual' || e.kind === 'phase' || e.kind === '100hr' || e.ata === ata);
  for (const e of r.shuffle(near).slice(0, 6)) if (e.date !== plant?.form337) dateWrong.set(e.date, { id: e.date, label: fmtDate(e.date) });
  const dateOpts = take(dateRight, [...dateWrong.values()]).sort((a, b) => a.id.localeCompare(b.id));

  const opts: Record<FieldId, Opt[]> = { aircraft: aircraftOpts, ata: ataOpts, work: workOpts, pn: pnOpts, ref: refOpts, data: dataOpts, date: dateOpts };
  const prefill: Partial<Record<FieldId, string>> = tier <= 0 ? { aircraft: 'ac', ata, work: 'w0' } : tier === 1 ? { aircraft: 'ac', ata } : {};

  const hint: Record<LbCase, string> = {
    stc: "The IPC is the maker's book: it never lists parts an STC put on. Find the entry that changed this assembly: it names the STC and the Form 337.",
    field: 'This kit went on under a field approval: when a model is not on the STC\'s list, the FSDO approves a Form 337 instead. Find that entry. The 337 is the approval, not the STC it borrowed data from.',
    sb: `IPC items ${rows.map((x) => x.item).join(' and ')} differ by effectivity: C is post-SB, D pre-SB. Only the logbook says whether this airplane had ${figSb(model, ata).id}.`,
    pma: 'An FAA-PMA part replaces an OEM part and carries its own eligibility list. Find the entry where it went on.',
    none: 'If nothing in the books explains a part, it is an unrecorded alteration.',
  };
  const where = bookHint(ata, kase);
  const fieldHints: Partial<Record<FieldId, string>> =
    tier <= 1
      ? {
          aircraft: 'Airframe S/N: the data plate, not the engine or propeller.',
          pn: kase === 'sb' ? 'The IPC row in force for this airplane’s SB status.' : 'Order what the approved data lists for the part that is installed.',
          ref: 'Cite the approval the part rests on.',
          data: 'Cite the approval named in the entry you highlighted.',
          date: 'The Form 337 date is in that entry.',
          work: kase === 'sb' || kase === 'pma' ? 'Say what the work order asks for, the way the manual words it.' : 'Replacing a part in an alteration is maintenance, not a new alteration.',
        }
      : {};

  return {
    tier,
    kase,
    ac,
    ata,
    tag,
    item: jt.title,
    job,
    found,
    issued,
    ipc,
    rows,
    task: ammTaskFor(ac, TASK_OF[ata]),
    books,
    answer,
    partial,
    eligible,
    ipcRow,
    pmaPn,
    pmaText,
    approvalRef,
    opts,
    prefill,
    teach: {
      markEntry: tier <= 0,
      starYear: tier <= 1 && answer !== 'none',
      showApplies: tier <= 2,
      hint: tier <= 2 ? `${hint[kase]}${where ? ` ${where}` : ''}` : undefined,
      fieldHints,
    },
  };
}

function bookHint(ata: Ata, kase: LbCase): string {
  if (kase === 'none') return '';
  return ata === '61-10' ? 'Propeller work goes in the propeller logbook.' : 'Look in the airframe logbook.';
}


// ---------------------------------------------------------------------------
// Judging: engineering's review, the logbook sign-off, and the score
// ---------------------------------------------------------------------------

export type Outcome = 'right' | 'costly' | 'unneeded' | 'wrong' | 'serious';

/** Is the route itself sound for this airplane (given the part chosen)? */
export function routeOutcome(m: LbModel, route: LbRoute, values: Partial<Record<FieldId, string>>): Outcome {
  const k = m.kase;
  if (route === 'ipc' || route === 'pma') {
    // a logbook entry puts the part on now: only a part the airplane's approval already covers
    if (route === 'pma' && k !== 'pma') return 'serious';
    if (k === 'sb' || k === 'pma') return values.pn && m.eligible.includes(values.pn) ? 'right' : 'serious';
    return 'serious';
  }
  if (route === 'eng') {
    if (k === 'stc' || k === 'field') return 'right';
    if (k === 'none') return 'wrong';
    return 'unneeded';
  }
  if (k === 'none') return 'right';
  if (k === 'stc' || k === 'field') return 'costly';
  return 'unneeded';
}

/** the value(s) a field should hold on this route */
export function rightValues(m: LbModel, route: LbRoute, f: FieldId): string[] {
  switch (f) {
    case 'aircraft':
      return ['ac'];
    case 'ata':
      return [m.ata];
    case 'work':
      return ['w0'];
    case 'pn':
      if (m.kase === 'pma') return route === 'pma' ? [m.found] : route === 'ipc' ? [m.ipcRow.pn] : [m.found, m.ipcRow.pn];
      return [m.found];
    case 'ref':
      return route === 'pma' ? ['pma'] : [`ipc:${m.ipcRow.item}`];
    case 'data':
      return m.kase === 'stc' || m.kase === 'field' ? ['alt:ALT-P'] : [];
    case 'date':
      return m.ac.plant?.form337 && (m.kase === 'stc' || m.kase === 'field') ? [m.ac.plant.form337] : [];
  }
}

/** fields that count on this route (a request engineering calls unneeded is judged on the common four) */
export function fieldsJudged(m: LbModel, route: LbRoute): FieldId[] {
  const o = routeOutcome(m, route, {});
  if (route === 'eng' && (o === 'unneeded' || o === 'wrong')) return FIELDS_FOR.new;
  return FIELDS_FOR[route];
}

export function entryScore(m: LbModel, entry: string | null): number {
  if (!entry) return 0;
  if (entry === m.answer) return 1;
  if (m.partial.includes(entry)) return m.kase === 'sb' ? 0.5 : 0.6;
  return 0;
}

export type Problem = { field: FieldId | 'entry' | 'route'; msg: string };

export type Review = {
  /** approved / returned by engineering; signed / serious for a logbook entry */
  verdict: 'approved' | 'returned' | 'unneeded' | 'costly' | 'signed' | 'serious';
  problems: Problem[];
  /** engineering's or the inspector's note */
  note: string;
};

const ROUTE_WORD: Record<LbRoute, string> = { ipc: 'IPC part', pma: 'PMA part', eng: 'data on file', new: 'new data' };

/** What happens to the paperwork you hand in. */
export function reviewLogbook(m: LbModel, route: LbRoute, values: Partial<Record<FieldId, string>>, entry: string | null): Review {
  const o = routeOutcome(m, route, values);
  const generic = m.tier >= 3;
  const plant = m.ac.plant;
  const reg = m.ac.registration;
  const problems: Problem[] = [];
  const answerEntry = m.ac.log.find((e) => e.id === m.answer);
  const when = answerEntry ? fmtDate(answerEntry.date) : '';
  const book = answerEntry?.book ?? 'airframe';

  const check = (f: FieldId) => {
    const v = values[f];
    if (v !== undefined && rightValues(m, route, f).includes(v)) return;
    problems.push({ field: f, msg: fieldMsg(m, route, f, v, generic) });
  };

  if (route === 'ipc' || route === 'pma') {
    for (const f of FIELDS_FOR[route]) check(f);
    if (o === 'serious') {
      let note: string;
      if (m.kase === 'stc' || m.kase === 'field')
        note = `Not airworthy: the ${m.ata} assembly on ${reg} was replaced per ${plant?.ref ?? 'an alteration'} (${book} log, ${when}). A part that is not in the IPC goes on only with engineering approval on that data.`;
      else if (m.kase === 'none') note = `Not airworthy: nothing in the records approves the ${kitHolder(m)} parts on ${reg}. Installing into an unrecorded alteration.`;
      else if (route === 'pma') note = `Not airworthy: no FAA-PMA eligibility covers ${values.pn ?? 'that part'} on ${reg}.`;
      else note = `Not airworthy: ${values.pn ?? 'that part'} is not the IPC part in force for ${reg}${m.kase === 'sb' ? ` (${m.approvalRef} complied ${when})` : ''}.`;
      return { verdict: 'serious', problems, note };
    }
    const cite = route === 'pma' ? `FAA-PMA ${values.pn}, ${m.pmaText}` : `IPC Fig ${m.ipc.fig} item ${m.ipcRow.item}${m.kase === 'sb' ? ` (post ${m.approvalRef})` : ''}`;
    return { verdict: 'signed', problems, note: `${values.pn} installed ${m.task.ref}; ${cite}. Returned to service.` };
  }

  // engineering
  if (o === 'unneeded') {
    for (const f of FIELDS_FOR.new) check(f);
    const why =
      m.kase === 'pma'
        ? `FAA-PMA ${m.found} is eligible (${m.pmaText}), logged ${when}`
        : `${m.found} is IPC Fig ${m.ipc.fig} item ${m.ipcRow.item}, effective after ${m.approvalRef} (${book} log, ${when})`;
    return { verdict: 'unneeded', problems, note: `Not needed: ${why}. A logbook entry would have done. One day lost.` };
  }
  if (o === 'costly') {
    for (const f of FIELDS_FOR.new) check(f);
    return {
      verdict: 'costly',
      problems,
      note: `Engineering found ${plant?.ref} in the ${book} log (${when}): the approved data was on file. No DER package needed; approved on that data after 4 days AOG.`,
    };
  }
  for (const f of FIELDS_FOR[route]) check(f);
  // the entry the request relies on
  // a later entry that cites the approval still leads engineering to it (research credit is partial);
  // an unrelated one, or none, does not
  if (route === 'eng' && entry !== m.answer && !(entry && m.partial.includes(entry)))
    problems.push({
      field: 'entry',
      msg: !entry || entry === 'none' ? 'Attach the logbook entry that recorded the installation.' : 'The entry you cite does not record this approval.',
    });
  if (route === 'new' && entry !== 'none' && entry)
    problems.push({ field: 'entry', msg: "The entry you cite doesn't record how this part got on the airplane." });
  if (problems.length) return { verdict: 'returned', problems, note: `Returned: ${problems.length} item${problems.length > 1 ? 's' : ''} to fix.` };
  const ea = `EA ${m.ac.asOf.slice(2, 4)}-${String(hashSeed(m.ac.registration, m.ata) % 900 + 100)}`;
  if (route === 'new')
    return {
      verdict: 'approved',
      problems,
      note: `${ea.replace('EA', 'EO')}: unrecorded ${kitHolder(m)} parts on ${reg}. Aircraft grounded until DER data (8110-3) on a Form 337 or an FSDO field approval covers them, or ${m.ata} goes back to type design.`,
    };
  return { verdict: 'approved', problems, note: `${ea}: P/N ${values.pn} approved for ${reg} per ${plant?.ref}, parts list of the ${plant?.ica}. Added to the aircraft's parts list.` };
}

const kitHolder = (m: LbModel) => plantPart(m.ac.model, m.ata).holder;

function fieldMsg(m: LbModel, route: LbRoute, f: FieldId, v: string | undefined, generic: boolean): string {
  if (v === undefined) return `${FIELD_LABEL[f]}: blank.`;
  switch (f) {
    case 'aircraft':
      if (generic) return "Aircraft: S/N doesn't match this airframe's data plate.";
      return v === 'engine' ? "Aircraft: that is the engine's S/N; the airframe S/N is on the data plate." : v === 'prop' ? "Aircraft: that is the propeller's S/N." : v === 'other' ? 'Aircraft: that registration and S/N are another airplane.' : "Aircraft: S/N doesn't match the data plate.";
    case 'ata':
      return `ATA: the part is in IPC Fig ${m.ipc.fig}, chapter ${generic ? 'shown there' : m.ata}.`;
    case 'work': {
      const why = jobText(m.ac.model, m.tag, '').why[Number(v.slice(1))] ?? '';
      return generic ? "Work statement doesn't match the work order." : `Work: ${why}`;
    }
    case 'pn':
      if (route === 'eng') return `P/N is not in the parts list of the approval you cite.`;
      if (route === 'new') return 'P/N: the request is for the part that is on the airplane.';
      return `P/N is not the part the ${ROUTE_WORD[route]} basis covers for this airplane.`;
    case 'ref':
      return v === '8130' ? 'Reference: an 8130-3 shows the part was made right, not that it is approved for this airplane.' : v === 'same' ? 'Reference: "same as removed" is not approved data.' : 'Reference does not approve that part for this airplane.';
    case 'data': {
      if (m.kase === 'none') return 'Approved data: nothing on file covers this part. It needs new data (major).';
      if (v === 'basis') return `Approved data: STC ${m.ac.plant?.basisStc} does not list ${m.ac.designation}; the approval for this airplane is the field-approved Form 337.`;
      const a = m.ac.alterations.find((x) => `alt:${x.id}` === v);
      return a ? `Approved data: ${a.stc ? `STC ${a.stc}` : `the Form 337 of ${fmtDate(a.form337)}`} covers ATA ${a.ata}, not ${m.ata}.` : 'Approved data: not found in the records.';
    }
    case 'date':
      return m.kase === 'stc' || m.kase === 'field' ? "Form 337 date doesn't match the 337 on file." : 'No Form 337 on file covers this part.';
  }
}

export type LbScore = { score: number; entry: number; route: number; fields: number; serious: boolean; outcome: Outcome | null; summary: string };

const ROUTE_CREDIT: Record<Outcome, number> = { right: 1, costly: 0.5, unneeded: 0.5, wrong: 0.15, serious: 0 };

/** 30% research, 35% approval path, 35% paperwork; −8% per request engineering sent back. Serious fault caps at 20%. */
export function scoreLogbook(m: LbModel, a: LbAnswer): LbScore {
  const entry = entryScore(m, a.entry);
  const outcome = a.route ? routeOutcome(m, a.route, a.values) : null;
  // an unsigned logbook entry installed nothing: not serious, but no route credit either
  const serious = outcome === 'serious' && a.submitted;
  const route = outcome ? (outcome === 'serious' ? 0 : ROUTE_CREDIT[outcome]) : 0;
  const judged = a.route ? fieldsJudged(m, a.route) : [];
  const ok = judged.filter((f) => {
    const v = a.values[f];
    return v !== undefined && rightValues(m, a.route!, f).includes(v);
  }).length;
  const fields = judged.length ? ok / judged.length : 0;
  let score = 0.3 * entry + 0.35 * route + 0.35 * fields - 0.08 * a.returns;
  if (serious) score = Math.min(score, 0.2);
  // a request that never got approved leaves the job open
  if (a.route && (a.route === 'eng' || a.route === 'new') && a.submitted && reviewLogbook(m, a.route, a.values, a.entry).verdict === 'returned') score = Math.min(score, 0.5);
  if (!a.submitted) score *= 0.8;
  score = Math.max(0, Math.min(1, Math.round(score * 1000) / 1000));
  return { score, entry, route, fields, serious, outcome, summary: summarize(m, a, entry, outcome, fields, serious) };
}

function summarize(m: LbModel, a: LbAnswer, entry: number, outcome: Outcome | null, fields: number, serious: boolean): string {
  const found = entry === 1 ? (m.answer === 'none' ? 'no record, rightly flagged' : `found the ${caseWord(m.kase)} entry`) : entry > 0 ? 'found a later entry that cites it' : m.answer === 'none' ? 'missed that nothing records it' : `missed the ${caseWord(m.kase)} entry`;
  const parts = [found];
  if (serious) parts.push('installed without approval (serious)');
  else if (outcome === 'costly') parts.push('asked for new data when approved data was on file');
  else if (outcome === 'unneeded') parts.push('engineering not needed');
  else if (outcome === 'right') parts.push(a.route === 'eng' || a.route === 'new' ? 'right approval path' : 'right path, logbook entry');
  else if (outcome === 'wrong') parts.push('cited data that does not cover it');
  else parts.push('no approval path chosen');
  if (outcome && !serious) parts.push(fields >= 1 ? 'paperwork clean' : `paperwork ${Math.round(fields * 100)}%`);
  if (a.returns) parts.push(`${a.returns} return${a.returns > 1 ? 's' : ''}`);
  return parts.join(', ');
}

function caseWord(k: LbCase): string {
  return k === 'stc' ? 'STC' : k === 'field' ? 'field-approval' : k === 'sb' ? 'SB' : k === 'pma' ? 'PMA' : 'installation';
}

/** the answer a perfect mechanic hands in (tests, and the lab's cheat) */
export function idealAnswer(m: LbModel): { entry: string; route: LbRoute; values: Partial<Record<FieldId, string>> } {
  const route: LbRoute = m.kase === 'stc' || m.kase === 'field' ? 'eng' : m.kase === 'none' ? 'new' : m.kase === 'pma' ? 'pma' : 'ipc';
  const values: Partial<Record<FieldId, string>> = {};
  for (const f of FIELDS_FOR[route]) values[f] = rightValues(m, route, f)[0];
  return { entry: m.answer, route, values };
}

// ---------------------------------------------------------------------------
// The paper: an aged logbook you flip and mark, then the request / entry form
// ---------------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const BOOK: Record<LogBook, { name: string; cloth: string; edge: string }> = {
  airframe: { name: 'Airframe', cloth: '#2f5a44', edge: '#23443a' },
  engine: { name: 'Engine', cloth: '#6a3b2c', edge: '#4f2b20' },
  propeller: { name: 'Propeller', cloth: '#27435f', edge: '#1d3349' },
};
/** ballpoint inks: each signer writes with their own pen */
const INKS = ['#1f3a8c', '#23272d', '#253d6e', '#2b2f5e', '#1c4a5c'];
const TAB_TINTS = ['#f3c9a0', '#bfe0cf', '#f6e39a', '#c8d8f0', '#efc3cf', '#d9ccef'];
const STICKER = new Set(['annual', '100hr', 'phase']);
const MAX_RETURNS = 2;

// fine paper grain, drawn once by the browser from an SVG turbulence filter
const GRAIN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .45  0 0 0 0 .35  0 0 0 0 .2  0 0 0 .09 0'/></filter><rect width='160' height='160' filter='url(%23n)'/></svg>\")";

function css(): string {
  return `
.lb{position:absolute;inset:0;display:flex;flex-direction:column;touch-action:pan-y;overscroll-behavior:none;font-family:var(--font,${FONT});color:${C.ink};background:linear-gradient(${C.paper},${C.sand});overflow:hidden;-webkit-user-select:none;user-select:none}
:where(.lb) button{font:inherit;color:inherit;-webkit-tap-highlight-color:transparent}
.lb-trail{display:flex;align-items:stretch;gap:4px;padding:6px 8px 4px;flex:none}
.lb-step{flex:1;min-width:0;min-height:44px;border:0;border-radius:12px;background:rgba(31,42,48,.06);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;padding:2px 4px;cursor:pointer;position:relative}
.lb-step b{font-size:12.5px;font-weight:800;letter-spacing:.1px}
.lb-step small{font-size:10.5px;font-weight:700;color:${C.inkSoft};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.lb-step.on{background:${C.sea};color:#fff}.lb-step.on small{color:rgba(255,255,255,.85)}
.lb-step.no small{color:${C.rust}}
.lb-step[disabled]{opacity:.45;cursor:default}
.lb-step+.lb-step::before{content:'';position:absolute;left:-5px;top:50%;width:6px;height:2px;background:rgba(31,42,48,.25)}
.lb-main{flex:1;min-height:0;position:relative}
.lb-scr{position:absolute;inset:0;display:none;flex-direction:column}
.lb[data-s=intro] .lb-intro,.lb[data-s=logs] .lb-logs,.lb[data-s=approve] .lb-ap{display:flex;animation:lbin .22s ease}
@keyframes lbin{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.lb-card{background:${C.paper};border-radius:16px;box-shadow:0 1px 0 rgba(31,42,48,.08),0 8px 22px rgba(80,60,20,.12)}
.lb-lbl{font-size:11px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:${C.inkSoft}}
.lb-mono{font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace}
.lb-btn{min-height:48px;border:0;border-radius:999px;padding:0 18px;font-weight:800;font-size:16px;background:${C.sea};color:#fff;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;transition:transform .08s,opacity .15s}
.lb-btn:active{transform:scale(.97)}.lb-btn[disabled]{opacity:.4;pointer-events:none}
.lb-btn.ghost{background:transparent;color:${C.seaDeep};box-shadow:inset 0 0 0 2px rgba(46,124,147,.35)}
.lb-btn.ghost.on{background:rgba(46,124,147,.14);box-shadow:inset 0 0 0 2px ${C.sea}}
.lb-btn.ink{background:${C.ink}}
.lb-intro{overflow-y:auto;padding:6px 12px 14px;gap:10px}
.lb-wo{padding:12px 14px;display:flex;flex-direction:column;gap:6px}
.lb-wo h2{margin:0;font-size:21px;line-height:1.15}
.lb-sq{font-style:italic;font-weight:600;color:#253d6e;font-size:15px;line-height:1.35}
.lb-path{display:flex;flex-direction:column;gap:8px;padding:12px 14px}
.lb-pi{display:grid;grid-template-columns:28px 1fr;gap:8px;align-items:start;font-size:14px;line-height:1.35}
.lb-pi i{font-style:normal;width:28px;height:28px;border-radius:50%;display:grid;place-items:center;font-weight:900;font-size:14px;background:rgba(31,42,48,.08)}
.lb-pi i.ok{background:${C.palm};color:#fff}.lb-pi i.no{background:${C.rust};color:#fff}.lb-pi i.go{background:${C.sea};color:#fff}
.lb-pn{font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-weight:800;background:rgba(31,42,48,.07);padding:0 4px;border-radius:4px;white-space:nowrap}
.lb-logs{gap:0}
.lb-books{display:flex;gap:6px;padding:4px 8px 0;flex:none}
.lb-bk{flex:1;min-height:44px;border:0;border-radius:10px 10px 4px 4px;color:#f6efe0;font-weight:800;font-size:13.5px;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.1;opacity:.72;transform:translateY(4px);transition:transform .15s,opacity .15s;box-shadow:inset 0 -3px 0 rgba(0,0,0,.2)}
.lb-bk small{font-size:10.5px;font-weight:700;opacity:.8}
.lb-bk.on{opacity:1;transform:none;box-shadow:inset 0 -3px 0 rgba(0,0,0,.25),0 -2px 8px rgba(0,0,0,.15)}
.lb-clue{flex:none;min-height:40px;border:0;display:flex;align-items:center;gap:6px;padding:4px 10px;font-size:12.5px;font-weight:700;color:#f6efe0;cursor:pointer;text-align:left;line-height:1.25}
.lb-clue .lb-pn{background:rgba(255,255,255,.14);color:#fff}
.lb-wrap{flex:1;min-height:0;position:relative;overflow:hidden}
.lb-scroll{position:absolute;inset:0;overflow-y:auto;overscroll-behavior:contain;padding:10px 0 90px;-webkit-overflow-scrolling:touch}
.lb-page{position:relative;margin:0 40px 14px 7px;border-radius:2px 7px 7px 2px;padding:8px 8px 10px 6px;background-color:#f4e8cb;background-image:${GRAIN},radial-gradient(120% 90% at 50% 40%,rgba(255,250,235,.55),rgba(214,186,130,.28) 80%,rgba(170,130,70,.32)),repeating-linear-gradient(transparent 0 23px,rgba(70,110,140,.13) 23px 24px);box-shadow:0 1px 0 rgba(0,0,0,.1),0 8px 16px rgba(20,10,0,.28)}
.lb-page::before{content:'';position:absolute;left:66px;top:0;bottom:0;width:1.5px;background:rgba(196,120,110,.45)}
.lb-page.stain::after{content:'';position:absolute;width:92px;height:92px;right:14px;top:var(--sy,40%);border-radius:50%;pointer-events:none;background:radial-gradient(circle,transparent 58%,rgba(140,90,40,.16) 62%,rgba(140,90,40,.07) 66%,transparent 71%);transform:rotate(20deg) scaleX(1.06)}
.lb-ph{display:flex;justify-content:space-between;align-items:baseline;gap:6px;font-size:10px;font-weight:800;letter-spacing:.8px;color:#6b5a3e;border-bottom:3px double rgba(107,90,62,.45);padding:0 2px 3px;margin-bottom:2px;text-transform:uppercase}
.lb-ch{display:grid;grid-template-columns:60px 1fr;gap:8px;font-size:8.5px;font-weight:800;letter-spacing:.5px;color:#8a7552;text-transform:uppercase;padding:2px 2px 4px;border-bottom:1px solid rgba(107,90,62,.3)}
.lb-e{display:grid;grid-template-columns:60px 1fr;gap:8px;padding:7px 2px 8px;border-bottom:1px solid rgba(107,90,62,.28);touch-action:pan-y;position:relative;outline:none;cursor:pointer}
.lb-e:last-child{border-bottom:0}
.lb-e:focus-visible{box-shadow:inset 0 0 0 2px ${C.sea}}
.lb-dc{color:var(--ink);font-style:italic;display:flex;flex-direction:column;line-height:1.15;transform:rotate(var(--rot))}
.lb-dc b{font-size:14px;font-weight:800}.lb-dc em{font-size:11.5px;font-weight:700;font-style:italic}
.lb-dc span{font-size:9.5px;font-weight:700;opacity:.8;margin-top:2px;font-style:normal;font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;letter-spacing:-.4px}
.lb-tx{min-width:0;transform:rotate(var(--rot));transform-origin:left top}
.lb-p{margin:0;color:var(--ink);font-style:italic;font-weight:560;font-size:14px;line-height:1.42;letter-spacing:.05px;overflow-wrap:anywhere}
.lb-e.caps .lb-p{text-transform:uppercase;font-size:12.4px;letter-spacing:.3px;font-weight:640}
.lb-rf{font-size:.9em;opacity:.86}
.lb.hand .lb-e:not(.caps) .lb-tx>.lb-p,.lb.hand .lb-newe .lb-p{font-family:var(--hand);font-style:normal;font-weight:400;font-size:14.5px;line-height:1.36}
.lb.hand .lb-sg em,.lb.hand .lb-dc b,.lb.hand .lb-dc em{font-family:var(--hand);font-style:normal;transform:none}
.lb-mk{background-image:linear-gradient(transparent 8%,rgba(255,222,56,.66) 8%,rgba(255,226,70,.6) 90%,transparent 90%);background-repeat:no-repeat;background-size:0% 100%;-webkit-box-decoration-break:clone;box-decoration-break:clone;padding:0 1px}
.lb-e.hl .lb-mk{background-size:100% 100%;transition:background-size .22s ease-out}
.lb-e.fade .lb-mk{transition:background-size .25s ease-in}
.lb-sg{margin-top:3px;display:flex;flex-wrap:wrap;align-items:baseline;justify-content:flex-end;column-gap:6px;color:var(--ink)}
.lb-sg em{font-weight:800;font-size:15px;transform:skewX(-14deg);display:inline-block;letter-spacing:-.2px}
.lb-sg span{font-size:10.5px;font-weight:700;opacity:.85}
.lb-stk{background:#fbf8ef;border:1px solid rgba(90,80,60,.35);border-radius:2px;padding:5px 6px 4px;box-shadow:0 1px 2px rgba(0,0,0,.12);transform:rotate(calc(var(--rot) * -1.4))}
.lb-stk .lb-p{font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-style:normal;font-weight:600;font-size:10.6px;line-height:1.45;color:#2a2a2a;letter-spacing:-.15px;text-transform:uppercase;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:4;line-clamp:4;overflow:hidden}
.lb-stk.open .lb-p{display:block;-webkit-line-clamp:unset;line-clamp:none}
.lb-stk .lb-more{display:block;font-size:10px;font-weight:800;color:${C.seaDeep};text-align:right;padding-top:1px}
.lb-cert{display:block;margin-top:3px;font-weight:800}
.lb-shop{display:inline-block;margin-top:4px;border:2px solid #5b4f8f;color:#5b4f8f;border-radius:4px;padding:1px 6px;font-size:9.5px;font-weight:900;letter-spacing:.4px;text-transform:uppercase;transform:rotate(-2deg);opacity:.85;font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace}
.lb-e.mark{box-shadow:0 0 0 2px ${C.sea} inset;border-radius:6px;animation:lbpulse 1.6s ease-in-out infinite}
@keyframes lbpulse{50%{box-shadow:0 0 0 4px rgba(46,124,147,.35) inset}}
.lb-tabs{position:absolute;right:0;top:10px;bottom:84px;width:40px;display:flex;flex-direction:column;gap:5px;z-index:4;pointer-events:none}
.lb-tab{pointer-events:auto;flex:0 1 54px;min-height:44px;max-height:58px;border:0;border-radius:0 9px 9px 0;margin-left:0;width:33px;display:flex;align-items:center;justify-content:center;writing-mode:vertical-rl;font-weight:900;font-size:13px;letter-spacing:.5px;color:#3b3325;box-shadow:2px 2px 4px rgba(0,0,0,.25),inset 4px 0 5px rgba(0,0,0,.16);cursor:pointer;transition:width .15s,filter .15s;filter:saturate(.7) brightness(.9)}
.lb-tab.on{width:40px;filter:none;box-shadow:3px 3px 7px rgba(0,0,0,.35),inset 2px 0 0 rgba(255,255,255,.5)}
.lb-tab .st{writing-mode:horizontal-tb;font-size:11px;color:${C.seaDeep}}
.lb-flip{position:absolute;inset:0 40px 0 0;pointer-events:none;background-color:#efe0bd;background-image:${GRAIN},linear-gradient(90deg,rgba(0,0,0,.18),rgba(0,0,0,0) 30%,rgba(255,255,255,.2) 70%,rgba(0,0,0,.12));transform-origin:0 50%;opacity:0;z-index:3}
.lb-flip.go{animation:lbflip .32s ease-in forwards}
@keyframes lbflip{0%{opacity:1;transform:perspective(900px) rotateY(0)}100%{opacity:.1;transform:perspective(900px) rotateY(-95deg)}}
.lb-note{position:absolute;left:10px;bottom:92px;z-index:6;max-width:236px;background:#fde68a;color:#3b3325;border-radius:2px;padding:9px 10px 10px;font-size:12.5px;line-height:1.35;font-weight:700;box-shadow:0 8px 16px rgba(0,0,0,.25);transform:rotate(-1.6deg);border:0;text-align:left;cursor:pointer}
.lb-note b{display:block;font-size:10.5px;letter-spacing:.6px;text-transform:uppercase;margin-bottom:3px;color:#7a5b12}
.lb-note.min{max-width:none;padding:6px 10px;font-size:12px}
.lb-bar{position:absolute;left:0;right:0;bottom:0;z-index:5;padding:14px 10px 10px;background:linear-gradient(rgba(242,227,198,0),${C.sand} 22px);display:flex;flex-direction:column;gap:6px}
.lb-rel{font-size:12.5px;font-weight:700;color:${C.inkSoft};text-align:center;min-height:17px}
.lb-rel b{color:${C.ink}}
.lb-row{display:flex;gap:8px}.lb-row>*{flex:1}
.lb-ap{overflow-y:auto;padding:4px 12px 16px;gap:10px}
.lb-h{margin:2px 2px 0;font-size:18px;line-height:1.2}
.lb-sub{font-size:13px;color:${C.inkSoft};font-weight:600;margin:0 2px}
.lb-route{border:0;text-align:left;display:grid;grid-template-columns:40px 1fr;gap:10px;align-items:center;padding:11px 12px;min-height:64px;cursor:pointer;background:${C.paper};border-radius:14px;box-shadow:0 1px 0 rgba(31,42,48,.08),0 4px 12px rgba(80,60,20,.1)}
.lb-route i{font-style:normal;width:40px;height:40px;border-radius:12px;display:grid;place-items:center;font-size:20px;background:rgba(224,164,88,.25)}
.lb-route b{display:block;font-size:15px;margin-bottom:2px}
.lb-route span{font-size:12.5px;line-height:1.3;color:${C.inkSoft};font-weight:600}
.lb-route.on{box-shadow:inset 0 0 0 2.5px ${C.sea},0 4px 12px rgba(80,60,20,.1)}
.lb-form{padding:12px 12px 14px;background-color:#fbf7ec;background-image:${GRAIN};border-radius:6px;box-shadow:0 1px 0 rgba(0,0,0,.08),0 10px 24px rgba(80,60,20,.16);display:flex;flex-direction:column}
.lb-ft{display:flex;justify-content:space-between;gap:8px;align-items:baseline;border-bottom:2px solid ${C.ink};padding-bottom:5px;margin-bottom:2px}
.lb-ft b{font-size:13px;letter-spacing:.8px;font-weight:900}
.lb-ft span{font-size:11px;font-weight:700;color:${C.inkSoft};white-space:nowrap}
.lb-f{border:0;background:transparent;text-align:left;display:grid;grid-template-columns:1fr auto;align-items:center;column-gap:8px;min-height:52px;padding:5px 2px;border-bottom:1px solid rgba(31,42,48,.14);cursor:pointer;width:100%}
.lb-f .k{font-size:10.5px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:${C.inkSoft}}
.lb-f .v{font-size:15px;font-weight:700;font-style:italic;color:#1f3a8c;line-height:1.25;overflow-wrap:anywhere}
.lb-f .v.empty{color:${C.seaDeep};font-style:normal;font-weight:800;font-size:13.5px}
.lb-f .v small{display:block;font-size:11.5px;font-style:normal;font-weight:600;color:${C.inkSoft}}
.lb-f .x{font-size:18px;font-weight:900;width:22px;text-align:center}
.lb-f.bad .x{color:${C.rust}}.lb-f.bad .k{color:${C.rust}}
.lb-f .h{grid-column:1/3;font-size:11.5px;color:#7a5b12;font-weight:700;margin-top:2px}
.lb-f.ro{cursor:pointer}
.lb-f .v.in{animation:lbink .35s ease}
@keyframes lbink{from{opacity:0;clip-path:inset(0 100% 0 0)}to{opacity:1;clip-path:inset(0 0 0 0)}}
.lb-sheet{position:absolute;inset:0;z-index:20;display:none;flex-direction:column;justify-content:flex-end;background:rgba(31,42,48,.38)}
.lb-sheet.open{display:flex;animation:lbfade .18s ease}
@keyframes lbfade{from{opacity:0}to{opacity:1}}
.lb-sh{background:${C.paper};border-radius:18px 18px 0 0;max-height:88%;display:flex;flex-direction:column;box-shadow:0 -8px 24px rgba(0,0,0,.2);animation:lbup .22s ease}
@keyframes lbup{from{transform:translateY(40px)}to{transform:none}}
.lb-shh{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 10px 6px 16px;flex:none}
.lb-shh b{font-size:16px}
.lb-x{min-width:44px;min-height:44px;border:0;border-radius:50%;background:rgba(31,42,48,.08);font-size:18px;font-weight:900;cursor:pointer}
.lb-shb{overflow-y:auto;padding:0 14px 16px;display:flex;flex-direction:column;gap:8px}
.lb-opt{border:0;text-align:left;min-height:52px;padding:8px 12px;border-radius:12px;background:#fff;box-shadow:inset 0 0 0 1.5px rgba(31,42,48,.14);cursor:pointer;display:flex;flex-direction:column;justify-content:center;gap:1px}
.lb-opt b{font-size:15px;font-weight:800;overflow-wrap:anywhere}
.lb-opt span{font-size:12px;color:${C.inkSoft};font-weight:600;line-height:1.3}
.lb-opt.on{box-shadow:inset 0 0 0 2.5px ${C.sea};background:rgba(46,124,147,.08)}
.lb-hint{font-size:12.5px;font-weight:700;color:#7a5b12;background:#fdf1c2;border-radius:10px;padding:8px 10px;line-height:1.35}
.lb-plate{background:linear-gradient(135deg,#d9dde0,#aeb6bb 45%,#dfe3e5 55%,#9aa4a9);border-radius:6px;padding:9px 22px;color:#2b3236;font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-size:11.5px;font-weight:800;letter-spacing:.4px;line-height:1.5;text-transform:uppercase;box-shadow:inset 0 1px 0 rgba(255,255,255,.6),inset 0 -1px 0 rgba(0,0,0,.2);position:relative}
.lb-plate::before,.lb-plate::after{content:'';position:absolute;top:7px;width:7px;height:7px;border-radius:50%;background:radial-gradient(#8a9499,#5d676c)}
.lb-plate::before{left:6px}.lb-plate::after{right:6px}
.lb-doc{background:#fff;border-radius:6px;padding:10px 11px;box-shadow:inset 0 0 0 1px rgba(31,42,48,.14);font-size:13px;line-height:1.4}
.lb-doc h4{margin:0 0 4px;font-size:13px;letter-spacing:.3px}
.lb-warn{border-left:4px solid ${C.rust};padding:4px 8px;margin:6px 0;font-size:12.5px;background:rgba(199,80,47,.06)}
.lb-caut{border-left:4px solid ${C.mech};padding:4px 8px;margin:6px 0;font-size:12.5px;background:rgba(224,164,88,.12)}
.lb-ipc{width:100%;border-collapse:collapse;font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-size:11px}
.lb-ipc th{text-align:left;font-size:9.5px;color:${C.inkSoft};border-bottom:1.5px solid ${C.ink};padding:3px 3px}
.lb-ipc td{padding:4px 3px;border-bottom:1px solid rgba(31,42,48,.12);vertical-align:top}
.lb-ipc td:nth-child(2){white-space:nowrap}
.lb-ipc td.n{font-size:10px;color:${C.inkSoft};padding-top:0}
.lb-eff{display:grid;grid-template-columns:auto 1fr auto;gap:2px 6px;font-size:11px;font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;align-items:baseline}
.lb-stamp{display:inline-block;border:3px solid currentColor;border-radius:6px;padding:3px 10px;font-weight:900;font-size:13px;letter-spacing:1px;text-transform:uppercase;transform:rotate(-4deg)}
.lb-rev{position:absolute;inset:0;z-index:30;display:none;align-items:flex-end;justify-content:center;background:rgba(31,42,48,.42);padding:10px}
.lb-rev.open{display:flex;animation:lbfade .2s ease}
.lb-memo{width:100%;max-width:440px;max-height:100%;overflow-y:auto;background-color:#fbf7ec;background-image:${GRAIN};border-radius:10px;padding:14px 14px 12px;box-shadow:0 12px 32px rgba(0,0,0,.35);position:relative;animation:lbup .28s ease}
.lb-memo h3{margin:0;font-size:13px;letter-spacing:1px}
.lb-memo .meta{font-size:11px;color:${C.inkSoft};font-weight:700;margin:2px 0 8px}
.lb-ln{display:grid;grid-template-columns:22px 1fr;gap:6px;font-size:13px;line-height:1.35;padding:3px 0;opacity:0;animation:lbline .25s ease forwards}
.lb-ln i{font-style:normal;font-weight:900;text-align:center}
.lb-ln.ok i{color:${C.palm}}.lb-ln.bad i{color:${C.rust}}
@keyframes lbline{from{opacity:0;transform:translateX(-6px)}to{opacity:1;transform:none}}
.lb-memo p{margin:8px 0 0;font-size:13.5px;line-height:1.4;font-weight:600}
.lb-bigstamp{display:block;width:max-content;margin:10px 6px 0 auto;border:4px solid currentColor;border-radius:8px;padding:4px 12px;font-weight:900;font-size:20px;letter-spacing:1.5px;text-transform:uppercase;opacity:0;transform:rotate(-7deg) scale(2.2)}
.lb-bigstamp.go{animation:lbstamp .3s cubic-bezier(.2,1.6,.4,1) forwards}
@keyframes lbstamp{to{opacity:.92;transform:rotate(-7deg) scale(1)}}
.lb-newe{margin-top:8px;border-radius:4px;padding:8px 8px 6px;background-color:#f4e8cb;background-image:${GRAIN},repeating-linear-gradient(transparent 0 23px,rgba(70,110,140,.13) 23px 24px)}
.lb-newe .lb-p{color:#1f3a8c}
@media (prefers-reduced-motion: reduce){.lb *{animation-duration:.01s !important;transition-duration:.01s !important}}
`;
}

/** a signer writes the same way every time: ink, slant, caps */
function handOf(name: string) {
  const h = hashSeed('hand', name);
  return { ink: INKS[h % INKS.length], caps: h % 3 === 0 };
}

/** a handwriting face the device already has, if any (no download: the game works offline) */
function handFont(): string | null {
  try {
    const c = document.createElement('canvas').getContext('2d');
    if (!c) return null;
    const sample = 'Replaced LH and RH brake linings 0123456789';
    for (const f of ['Noteworthy', 'Segoe Print', 'Bradley Hand']) {
      c.font = '20px monospace';
      const a = c.measureText(sample).width;
      c.font = `20px '${f}', monospace`;
      if (Math.abs(c.measureText(sample).width - a) > 1) return f;
    }
  } catch {
    /* no canvas: stay on the slanted face */
  }
  return null;
}

function signatureHtml(e: LogEntry): string {
  const s = e.signer;
  const [f, ...l] = s.name.split(' ');
  const short = `${f[0]}. ${l.join(' ')}`;
  if (s.kind === 'CRS') return `<em>${esc(short)}</em><span>for ${esc(s.shop ?? '')}</span>`;
  return `<em>${esc(short)}</em><span>A&amp;P ${esc(s.cert)}${s.kind === 'A&P/IA' ? ' IA' : ''}</span>`;
}

function entryHtml(e: LogEntry, model: PlaneModel): string {
  const hand = handOf(e.signer.name);
  const rot = (((hashSeed('rot', e.id) % 100) / 100) * 0.9 - 0.45).toFixed(2);
  const [y, mo, d] = e.date.split('-');
  const meter = model === 'cargo' ? 'HOBBS' : 'TACH';
  const typed = STICKER.has(e.kind) || e.signer.kind === 'CRS';
  const text = `${esc(e.text)}${e.cert ? `<span class="lb-cert">${esc(e.cert)}</span>` : ''}<br><span class="lb-rf">${esc(e.ref)}</span>`;
  const body = typed
    ? `<div class="lb-stk"><p class="lb-p"><span class="lb-mk">${text}</span></p><span class="lb-more">more ▾</span>${e.signer.kind === 'CRS' ? `<span class="lb-shop">${esc(e.signer.shop ?? '')} · CRS ${esc(e.signer.cert)}</span>` : ''}</div>`
    : `<p class="lb-p"><span class="lb-mk">${text}</span></p>`;
  return `<article class="lb-e${hand.caps && !typed ? ' caps' : ''}" tabindex="0" data-id="${esc(e.id)}" data-y="${y}" style="--ink:${hand.ink};--rot:${rot}deg">
<div class="lb-dc"><b>${mo}/${d}</b><em>${y}</em><span>${meter} ${e.tach.toFixed(1)}</span><span>TT ${e.tt.toFixed(1)}</span></div>
<div class="lb-tx">${body}<div class="lb-sg">${signatureHtml(e)}</div></div></article>`;
}

const ICON: Record<LbRoute, string> = { ipc: '🔧', pma: '🏷️', eng: '📎', new: '📐' };

export const logbook: PuzzleDef = {
  id: 'logbook',
  role: 'mech',
  title: 'Logbook research',
  gesture: 'Flip pages + swipe to highlight',
  howTo: 'Part not in the IPC? Find the entry, then get it approved.',
  term: 'Logbooks: the airplane’s legal record. STCs, Form 337s and SBs are all in there.',
  seconds: (tier) => 80 + tier * 8,
  mount(host, p) {
    const m = generateLogbook(p.seed, p.tier, p.tools, p.context);
    const { ac } = m;
    const r = rng(hashSeed('lb-ui', p.seed));
    type Screen = 'intro' | 'logs' | 'approve';
    let screen: Screen = 'intro';
    let book: LogBook = m.ata === '61-10' && m.tier <= 1 ? 'propeller' : 'airframe';
    let entry: string | null = null;
    let route: LbRoute | null = null;
    const values: Partial<Record<FieldId, string>> = { ...m.prefill };
    let returns = 0;
    let bad = new Set<string>();
    let finished = false;
    let noteOpen = !!m.teach.hint;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (ms: number, f: () => void) => timers.push(setTimeout(f, ms));

    const root = document.createElement('div');
    root.className = 'lb';
    root.dataset.s = 'intro';
    const hf = handFont();
    if (hf) {
      root.classList.add('hand');
      root.style.setProperty('--hand', `'${hf}', ${FONT}`);
    }
    const style = document.createElement('style');
    style.textContent = css();
    root.appendChild(style);
    host.el.appendChild(root);

    // ---- trail: the mechanic's own order of work ----
    const trail = document.createElement('div');
    trail.className = 'lb-trail';
    root.appendChild(trail);
    const main = document.createElement('div');
    main.className = 'lb-main';
    root.appendChild(main);

    const entryById = new Map(ac.log.map((e) => [e.id, e]));
    const relLabel = () => {
      if (entry === 'none') return 'No record explains it';
      const e = entry ? entryById.get(entry) : undefined;
      return e ? `${fmtDate(e.date)} · ${BOOK[e.book].name.toLowerCase()} log` : '';
    };

    function renderTrail() {
      const canApprove = entry !== null;
      const step = (id: string, title: string, sub: string, cls: string, disabled = false) =>
        `<button class="lb-step ${cls}" data-step="${id}"${disabled ? ' disabled' : ''}><b>${title}</b><small>${sub}</small></button>`;
      trail.innerHTML =
        step('manual', 'Manual', `✓ MM ${m.task.taskNo}`, '') +
        step('ipc', 'IPC', m.kase === 'sb' ? `? Fig ${m.ipc.fig}` : `✗ Fig ${m.ipc.fig}`, m.kase === 'sb' ? '' : 'no') +
        step('logs', 'Logs', entry ? (entry === 'none' ? 'no record' : `🖍 ${fmtDate(entryById.get(entry)!.date)}`) : 'research', screen === 'logs' ? 'on' : '') +
        step('approve', 'Approval', route ? ROUTE_WORD[route] : 'choose path', screen === 'approve' ? 'on' : '', !canApprove);
    }
    trail.addEventListener('click', (ev) => {
      const b = (ev.target as HTMLElement).closest('[data-step]') as HTMLElement | null;
      if (!b || finished || host.paused()) return;
      const s = b.dataset.step!;
      host.fx.tap();
      if (s === 'manual') openManual();
      else if (s === 'ipc') openIpc();
      else if (s === 'logs') go('logs');
      else if (s === 'approve' && entry !== null) go('approve');
    });

    // ---- screen 1: the job card (manual → IPC → not there) ----
    const intro = document.createElement('section');
    intro.className = 'lb-scr lb-intro';
    main.appendChild(intro);
    const ipcLine =
      m.kase === 'sb'
        ? `Fig ${m.ipc.fig} lists ${m.rows.map((x) => `<span class="lb-pn">${esc(x.pn)}</span> (item ${esc(x.item)}, eff ${esc(x.eff || 'all')})`).join(' and ')}. Stores pulled <span class="lb-pn">${esc(m.issued!)}</span>. On the airplane: <span class="lb-pn">${esc(m.found)}</span>. Which one applies?`
        : `Fig ${m.ipc.fig} lists <span class="lb-pn">${esc(m.ipcRow.pn)}</span> (item ${esc(m.ipcRow.item)}). On the airplane: <span class="lb-pn">${esc(m.found)}</span>${m.kase === 'pma' ? ', marked FAA-PMA' : ''}. <b>Not in the IPC.</b>`;
    intro.innerHTML = `
<div class="lb-card lb-wo">
  <div class="lb-lbl">${esc(m.job.wo)} · ${esc(ac.registration)} · ${esc(ac.designation)}</div>
  <h2>${esc(m.job.title)}</h2>
  <div class="lb-sq">“${esc(m.job.squawk)}”</div>
</div>
<div class="lb-card lb-path">
  <div class="lb-pi"><i class="ok">✓</i><div><b>Manual.</b> ${esc(m.task.ref.replace('IAW ', ''))}: ${esc(m.task.title)}. <span style="color:${C.inkSoft}">“${esc(m.task.notes[1])}”</span></div></div>
  <div class="lb-pi"><i class="${m.kase === 'sb' ? 'go' : 'no'}">${m.kase === 'sb' ? '?' : '✗'}</i><div><b>IPC.</b> ${ipcLine}</div></div>
  <div class="lb-pi"><i class="go">3</i><div><b>Logs.</b> Find the entry that explains what is on the airplane, and swipe the highlighter across it. If nothing does, say so.</div></div>
  <div class="lb-pi"><i>4</i><div><b>Approval.</b> Choose how the replacement gets approved and fill the paperwork.</div></div>
</div>
<button class="lb-btn" data-go="logs" style="flex:none">Open the logbooks</button>`;
    intro.querySelector('[data-go]')!.addEventListener('click', () => {
      if (finished || host.paused()) return;
      host.fx.tap();
      go('logs');
    });

    // ---- screen 2: the logbooks ----
    const logs = document.createElement('section');
    logs.className = 'lb-scr lb-logs';
    main.appendChild(logs);
    const books = document.createElement('div');
    books.className = 'lb-books';
    const clue = document.createElement('button');
    clue.className = 'lb-clue';
    const wrap = document.createElement('div');
    wrap.className = 'lb-wrap';
    const scroll = document.createElement('div');
    scroll.className = 'lb-scroll';
    const tabs = document.createElement('div');
    tabs.className = 'lb-tabs';
    const flip = document.createElement('div');
    flip.className = 'lb-flip';
    const note = document.createElement('button');
    note.className = 'lb-note';
    const bar = document.createElement('div');
    bar.className = 'lb-bar';
    wrap.append(scroll, flip, tabs, bar);
    if (m.teach.hint) wrap.appendChild(note);
    logs.append(books, clue, wrap);
    clue.innerHTML =
      m.kase === 'sb'
        ? `<span>Stores: <span class="lb-pn">${esc(m.issued!)}</span> · on the airplane: <span class="lb-pn">${esc(m.found)}</span> ▸</span>`
        : `<span>On the airplane: <span class="lb-pn">${esc(m.found)}</span> · IPC Fig ${m.ipc.fig}: <span class="lb-pn">${esc(m.ipcRow.pn)}</span> ▸</span>`;
    clue.addEventListener('click', () => {
      if (finished || host.paused()) return;
      host.fx.tap();
      openIpc();
    });

    const pageStart: Record<LogBook, number> = { airframe: r.int(18, 60), engine: r.int(9, 40), propeller: r.int(3, 16) };
    const PER_PAGE = 5;
    const bookHtml = (b: LogBook) => {
      const list = m.books[b];
      if (!list.length) return `<div class="lb-page"><div class="lb-ph"><span>${BOOK[b].name} log · ${esc(ac.registration)}</span></div><p class="lb-p" style="padding:18px 4px;opacity:.6">No entries in this book since ${fmtDate(ac.logStart)}.</p></div>`;
      let html = '';
      for (let i = 0; i < list.length; i += PER_PAGE) {
        const page = list.slice(i, i + PER_PAGE);
        const pno = pageStart[b] + i / PER_PAGE;
        const stain = hashSeed('stain', ac.registration, b, pno) % 6 === 0 ? ` stain" style="--sy:${20 + (pno * 37) % 55}%` : '';
        html += `<div class="lb-page${stain}"><div class="lb-ph"><span>${BOOK[b].name} log · ${esc(ac.registration)} · S/N ${esc(b === 'airframe' ? ac.serial : b === 'engine' ? ac.engines[0].serial : ac.prop.hub)}</span><span>p. ${pno}</span></div>
<div class="lb-ch"><span>Date / time</span><span>Description of work · reference · signature</span></div>${page.map((e) => entryHtml(e, ac.model)).join('')}</div>`;
      }
      return html;
    };

    const answerEntry = entryById.get(m.answer);
    const renderBooks = () => {
      books.innerHTML = (['airframe', 'engine', 'propeller'] as LogBook[])
        .map((b) => `<button class="lb-bk${b === book ? ' on' : ''}" data-book="${b}" style="background:${BOOK[b].cloth}">${BOOK[b].name}<small>${m.books[b].length} ${m.books[b].length === 1 ? 'entry' : 'entries'}</small></button>`)
        .join('');
      logs.style.background = BOOK[book].edge;
      clue.style.background = BOOK[book].cloth;
    };
    books.addEventListener('click', (ev) => {
      const b = (ev.target as HTMLElement).closest('[data-book]') as HTMLElement | null;
      if (!b || finished || host.paused() || b.dataset.book === book) return;
      host.fx.tap();
      book = b.dataset.book as LogBook;
      showBook(true);
    });

    let years: string[] = [];
    function showBook(animate: boolean) {
      renderBooks();
      scroll.innerHTML = bookHtml(book);
      years = [...new Set(m.books[book].map((e) => e.date.slice(0, 4)))];
      const star = m.teach.starYear && answerEntry && answerEntry.book === book ? answerEntry.date.slice(0, 4) : '';
      tabs.innerHTML = years
        .map((y, i) => `<button class="lb-tab" data-year="${y}" style="background:${TAB_TINTS[(i + years.length) % TAB_TINTS.length]}">’${y.slice(2)}${y === star ? '<span class="st">★</span>' : ''}</button>`)
        .join('');
      applyMarks();
      // a logbook opens at its latest page
      scroll.scrollTop = scroll.scrollHeight;
      if (animate) pageFlip();
      syncTab();
      status();
    }
    function applyMarks() {
      scroll.querySelectorAll<HTMLElement>('.lb-e').forEach((a) => {
        a.classList.toggle('hl', a.dataset.id === entry);
        a.classList.toggle('mark', m.teach.markEntry && a.dataset.id === m.answer);
      });
    }
    function pageFlip() {
      if (p.reducedMotion) return;
      flip.classList.remove('go');
      void flip.offsetWidth;
      flip.classList.add('go');
    }
    tabs.addEventListener('click', (ev) => {
      const t = (ev.target as HTMLElement).closest('[data-year]') as HTMLElement | null;
      if (!t || finished || host.paused()) return;
      const first = scroll.querySelector<HTMLElement>(`.lb-e[data-y="${t.dataset.year}"]`);
      if (!first) return;
      host.fx.tick();
      pageFlip();
      const pg = first.closest('.lb-page') as HTMLElement;
      const target = pg.querySelector('.lb-e') === first ? pg.offsetTop - 8 : first.offsetTop + pg.offsetTop - 6;
      scroll.scrollTop = Math.max(0, target);
      syncTab();
    });
    let syncRaf = 0;
    function syncTab() {
      cancelAnimationFrame(syncRaf);
      syncRaf = requestAnimationFrame(() => {
        const sr = scroll.getBoundingClientRect();
        const top = sr.top + Math.min(160, sr.height * 0.25);
        let yr = years[0];
        for (const a of scroll.querySelectorAll<HTMLElement>('.lb-e')) {
          if (a.getBoundingClientRect().bottom > top) {
            yr = a.dataset.y!;
            break;
          }
        }
        tabs.querySelectorAll<HTMLElement>('.lb-tab').forEach((t) => t.classList.toggle('on', t.dataset.year === yr));
      });
    }
    scroll.addEventListener('scroll', () => {
      syncTab();
      if (noteOpen && scroll.scrollTop < scroll.scrollHeight - scroll.clientHeight - 200) setNote(false);
    });

    function setNote(open: boolean) {
      if (!m.teach.hint) return;
      noteOpen = open;
      note.classList.toggle('min', !open);
      note.innerHTML = open ? `<b>Lead’s note</b>${esc(m.teach.hint)}` : '📝 Lead’s note';
    }
    setNote(noteOpen);
    note.addEventListener('click', () => {
      if (finished || host.paused()) return;
      host.fx.tap();
      setNote(!noteOpen);
    });

    // ---- the highlighter: swipe → across the entry you rely on (long-press works too) ----
    type Drag = { el: HTMLElement; id: string; x0: number; y0: number; t0: number; pid: number; mode: 'wait' | 'swipe' | 'scroll'; prog: number; was: boolean; lp?: ReturnType<typeof setTimeout> };
    let drag: Drag | null = null;
    const mk = (a: HTMLElement) => a.querySelector<HTMLElement>('.lb-mk')!;
    const setProg = (a: HTMLElement, v: number) => {
      const s = mk(a).style;
      s.transition = 'none';
      s.backgroundSize = `${(v * 100).toFixed(1)}% 100%`;
    };
    function commit(id: string | null) {
      const prev = entry;
      entry = id;
      bad.delete('entry');
      scroll.querySelectorAll<HTMLElement>('.lb-e').forEach((a) => {
        const s = mk(a).style;
        s.transition = '';
        s.backgroundSize = '';
        a.classList.remove('fade');
        if (a.dataset.id === prev && prev !== id) a.classList.add('fade');
      });
      applyMarks();
      if (id) host.fx.pencil();
      renderBar();
      renderTrail();
      status();
    }
    scroll.addEventListener('pointerdown', (ev) => {
      if (finished || host.paused()) return;
      const a = (ev.target as HTMLElement).closest('.lb-e') as HTMLElement | null;
      if (!a) return;
      drag = { el: a, id: a.dataset.id!, x0: ev.clientX, y0: ev.clientY, t0: performance.now(), pid: ev.pointerId, mode: 'wait', prog: 0, was: a.dataset.id === entry };
      const d = drag;
      d.lp = setTimeout(() => {
        if (drag !== d || d.mode !== 'wait') return;
        d.mode = 'scroll'; // consumed
        commit(d.was ? null : d.id);
        if (!d.was) host.fx.snap();
      }, 520);
    });
    scroll.addEventListener('pointermove', (ev) => {
      const d = drag;
      if (!d || ev.pointerId !== d.pid) return;
      const dx = ev.clientX - d.x0;
      const dy = ev.clientY - d.y0;
      if (d.mode === 'wait') {
        if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.3) {
          d.mode = 'swipe';
          clearTimeout(d.lp);
          try {
            d.el.setPointerCapture(ev.pointerId);
          } catch {
            /* synthetic */
          }
        } else if (Math.abs(dy) > 10 || Math.abs(dx) > 12) {
          d.mode = 'scroll';
          clearTimeout(d.lp);
        }
      }
      if (d.mode !== 'swipe') return;
      ev.preventDefault();
      const w = Math.max(120, d.el.getBoundingClientRect().width * 0.5);
      d.prog = d.was ? Math.max(0, Math.min(1, 1 + dx / w)) : Math.max(0, Math.min(1, dx / w));
      setProg(d.el, d.prog);
      if (Math.round(d.prog * 10) !== Math.round((d.prog - 0.05) * 10)) host.fx.tick();
    });
    const end = (ev: PointerEvent) => {
      const d = drag;
      if (!d || ev.pointerId !== d.pid) return;
      drag = null;
      clearTimeout(d.lp);
      // the browser took the touch for a scroll: neither a tap nor a stroke
      if (ev.type === 'pointercancel' && d.mode !== 'swipe') return;
      if (d.mode === 'swipe') {
        if (!d.was && d.prog >= 0.5) {
          commit(d.id);
          host.fx.snap();
        } else if (d.was && d.prog <= 0.5) commit(null);
        else {
          const s = mk(d.el).style;
          s.transition = 'background-size .18s';
          s.backgroundSize = '';
        }
        return;
      }
      if (d.mode === 'wait' && performance.now() - d.t0 < 450) {
        // a tap: open a typed sticker; otherwise remind how the marker works
        const stk = (ev.target as HTMLElement).closest('.lb-stk');
        if (stk) {
          stk.classList.toggle('open');
          stk.querySelector('.lb-more')!.textContent = stk.classList.contains('open') ? 'less ▴' : 'more ▾';
          host.fx.tap();
        } else if (!d.was) {
          rel.innerHTML = '<b>Swipe →</b> across an entry to highlight it';
        }
      }
    };
    scroll.addEventListener('pointerup', end);
    scroll.addEventListener('pointercancel', end);
    scroll.addEventListener('keydown', (ev) => {
      const a = (ev.target as HTMLElement).closest('.lb-e') as HTMLElement | null;
      if (!a || finished || (ev.key !== 'Enter' && ev.key !== ' ')) return;
      ev.preventDefault();
      commit(a.dataset.id === entry ? null : a.dataset.id!);
    });

    const rel = document.createElement('div');
    rel.className = 'lb-rel';
    const barRow = document.createElement('div');
    barRow.className = 'lb-row';
    bar.append(rel, barRow);
    function renderBar() {
      rel.innerHTML = entry === 'none' ? '<b>Declared:</b> nothing in the books explains it' : entry ? `Relying on <b>${esc(relLabel())}</b>` : '<b>Swipe →</b> across the entry you rely on';
      barRow.innerHTML = `<button class="lb-btn ghost${entry === 'none' ? ' on' : ''}" data-act="none" style="font-size:14px;padding:0 10px">${entry === 'none' ? '✓ ' : ''}No record explains it</button><button class="lb-btn" data-act="next"${entry === null ? ' disabled' : ''}>Approval →</button>`;
    }
    barRow.addEventListener('click', (ev) => {
      const b = (ev.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!b || finished || host.paused()) return;
      if (b.dataset.act === 'none') {
        host.fx.tap();
        commit(entry === 'none' ? null : 'none');
      } else if (entry !== null) {
        host.fx.tap();
        go('approve');
      }
    });

    // ---- screen 3: approval path and the paperwork ----
    const ap = document.createElement('section');
    ap.className = 'lb-scr lb-ap';
    main.appendChild(ap);
    let formOpen = false;

    function renderApprove() {
      if (!formOpen || !route) {
        ap.innerHTML = `<h3 class="lb-h">How does the replacement get approved?</h3>
<p class="lb-sub">${esc(m.job.title)} · on the airplane <span class="lb-pn">${esc(m.found)}</span> · relying on <b>${esc(relLabel())}</b></p>
${ROUTES.map((x) => `<button class="lb-route${route === x.id ? ' on' : ''}" data-route="${x.id}"><i>${ICON[x.id]}</i><div><b>${esc(x.title)}</b><span>${esc(x.text)}</span></div></button>`).join('')}`;
        return;
      }
      const R = ROUTES.find((x) => x.id === route)!;
      const req = R.form === 'request';
      const fields = FIELDS_FOR[route];
      const filled = fields.filter((f) => values[f] !== undefined).length;
      const relBad = bad.has('entry');
      ap.innerHTML = `<button class="lb-btn ghost" data-back style="align-self:flex-start;min-height:44px;font-size:13.5px;padding:0 14px">◂ ${ICON[route]} ${esc(R.title)}</button>
<div class="lb-form">
  <div class="lb-ft"><b>${req ? 'ENGINEERING REQUEST' : 'MAINTENANCE RECORD ENTRY'}</b><span>${esc(m.job.wo)} · ${fmtDate(ac.asOf)}</span></div>
  ${fields.map((f) => fieldRow(f)).join('')}
  <button class="lb-f ro${relBad ? ' bad' : ''}" data-rel><div><div class="k">Logbook entry relied on</div><div class="v">${esc(relLabel())}</div></div><span class="x">${relBad ? '✗' : '▸'}</span></button>
  <button class="lb-btn${req ? '' : ' ink'}" data-submit style="margin-top:12px"${filled < fields.length ? ' disabled' : ''}>${req ? (returns ? 'Resend to engineering' : 'Send to engineering') : 'Sign the entry'}</button>
</div>`;
      host.status(`${req ? 'Engineering request' : 'Logbook entry'} · ${filled}/${fields.length} filled${returns ? ` · ${returns} returned` : ''}`);
    }
    function valueLabel(f: FieldId): { label: string; sub?: string } | undefined {
      const v = values[f];
      if (v === undefined) return undefined;
      const o = m.opts[f].find((x) => x.id === v);
      return o ? { label: o.label, sub: f === 'ata' || f === 'aircraft' ? undefined : o.sub } : { label: v };
    }
    let justFilled: FieldId | null = null;
    function fieldRow(f: FieldId): string {
      const v = valueLabel(f);
      const isBad = bad.has(f);
      const hint = m.teach.fieldHints[f];
      return `<button class="lb-f${isBad ? ' bad' : ''}" data-field="${f}"><div><div class="k">${esc(FIELD_LABEL[f])}</div>${
        v ? `<div class="v${justFilled === f ? ' in' : ''}">${esc(v.label)}${v.sub ? `<small>${esc(v.sub)}</small>` : ''}</div>` : '<div class="v empty">Tap to fill</div>'
      }</div><span class="x">${isBad ? '✗' : v ? '' : '▸'}</span>${hint && !v ? `<div class="h">${esc(hint)}</div>` : ''}</button>`;
    }
    ap.addEventListener('click', (ev) => {
      const t = ev.target as HTMLElement;
      if (finished || host.paused()) return;
      const rb = t.closest('[data-route]') as HTMLElement | null;
      if (rb) {
        host.fx.tap();
        const next = rb.dataset.route as LbRoute;
        if (next !== route) bad = new Set();
        route = next;
        rb.classList.add('on');
        later(140, () => {
          formOpen = true;
          renderApprove();
          renderTrail();
          ap.scrollTop = 0;
        });
        return;
      }
      if (t.closest('[data-back]')) {
        host.fx.tap();
        formOpen = false;
        renderApprove();
        return;
      }
      if (t.closest('[data-rel]')) {
        host.fx.tap();
        go('logs');
        return;
      }
      const fb = t.closest('[data-field]') as HTMLElement | null;
      if (fb) {
        host.fx.tap();
        openPicker(fb.dataset.field as FieldId);
        return;
      }
      if (t.closest('[data-submit]')) submit();
    });

    // ---- bottom sheets: manual, IPC, pickers ----
    const sheet = document.createElement('div');
    sheet.className = 'lb-sheet';
    main.appendChild(sheet);
    let onPick: ((id: string) => void) | null = null;
    function openSheet(title: string, body: string, pick?: (id: string) => void) {
      onPick = pick ?? null;
      sheet.innerHTML = `<div class="lb-sh"><div class="lb-shh"><b>${esc(title)}</b><button class="lb-x" data-close aria-label="Close">✕</button></div><div class="lb-shb">${body}</div></div>`;
      sheet.classList.add('open');
    }
    const closeSheet = () => {
      sheet.classList.remove('open');
      onPick = null;
    };
    sheet.addEventListener('click', (ev) => {
      const t = ev.target as HTMLElement;
      if (t === sheet || t.closest('[data-close]')) {
        host.fx.tap();
        closeSheet();
        return;
      }
      const o = t.closest('[data-opt]') as HTMLElement | null;
      if (o && onPick && !finished && !host.paused()) onPick(o.dataset.opt!);
    });

    function openManual() {
      const t = m.task;
      const eng = ac.engines.map((e) => `${e.position === 'Engine' ? 'Engine' : e.position + ' engine'} ${e.model} S/N ${e.serial}`).join('<br>');
      openSheet(
        'Work order and manual',
        `<div class="lb-doc"><div class="lb-lbl">${esc(m.job.wo)} · ${esc(ac.registration)}</div><h4 style="margin-top:4px">${esc(m.job.title)}</h4><div class="lb-sq">“${esc(m.job.squawk)}”</div></div>
<div class="lb-plate">${esc(MAKER)}<br>MODEL ${esc(ac.designation)} · TC ${esc(ac.typeCert)}<br>SERIAL NO. ${esc(ac.serial)}<br>MFD ${ac.year}</div>
<div class="lb-doc" style="font-size:12.5px"><b>${esc(ac.registration)}</b> · ${esc(ac.description)}<br>${eng}<br>Propeller ${esc(ac.propMaker)} ${esc(ac.prop.hub)}</div>
<div class="lb-doc"><div class="lb-lbl">${esc(t.manual)} · ${esc(t.taskNo)} · page block ${t.pageBlock}</div><h4 style="margin-top:4px">${esc(t.title)}</h4>
${t.warnings.map((w) => `<div class="lb-warn"><b>WARNING</b> ${esc(w)}</div>`).join('')}
${t.cautions.map((w) => `<div class="lb-caut"><b>CAUTION</b> ${esc(w)}</div>`).join('')}
${t.notes.map((w) => `<div style="font-size:12.5px;margin-top:4px"><b>NOTE</b> ${esc(w)}</div>`).join('')}
<ol style="margin:8px 0 0;padding-left:20px;font-size:12.5px">${t.steps.slice(0, 5).map((s) => `<li>${esc(s.text)}</li>`).join('')}<li style="list-style:none;color:${C.inkSoft}">…</li></ol></div>`,
      );
    }

    function openIpc() {
      const f = m.ipc;
      const eff = f.effCodes
        .map((c) => {
          const mark = m.teach.showApplies && (c.code === 'A' || c.code === 'B' || m.tier <= 0) ? (c.applies ? `<b style="color:${C.palm}">✓</b>` : '<span style="opacity:.4">–</span>') : '';
          return `<b>${c.code}</b><span>${esc(c.text)}</span><span>${mark}</span>`;
        })
        .join('');
      const rows = m.rows
        .map(
          (x) =>
            `<tr><td>${esc(x.item)}</td><td><b>${esc(x.pn)}</b></td><td>${esc(x.text)}</td><td>${esc(x.eff || '')}</td><td>${x.upa}</td></tr>${x.notes.length ? `<tr><td></td><td colspan="4" class="n">${x.notes.map(esc).join(' · ')}</td></tr>` : ''}`,
        )
        .join('');
      const stamp =
        m.kase === 'sb'
          ? `<div class="lb-doc">Stores pulled <span class="lb-pn">${esc(m.issued!)}</span>. On the airplane: <span class="lb-pn">${esc(m.found)}</span>. Which row applies depends on the SB record.</div>`
          : `<div style="text-align:center;padding:4px 0"><span class="lb-stamp" style="color:${C.rust}">${esc(m.found)} · not in Fig ${f.fig}</span></div>`;
      openSheet(
        `IPC Fig ${f.fig} · ${f.chapter}`,
        `<div class="lb-doc"><div class="lb-lbl">${esc(f.catalog)}</div><h4 style="margin-top:3px">FIG ${f.fig} ${esc(f.title)}</h4>
<div class="lb-eff">${eff}</div>
<table class="lb-ipc" style="margin-top:8px"><tr><th>ITEM</th><th>PART NO.</th><th>NOMENCLATURE</th><th>EFF</th><th>UPA</th></tr>${rows}</table>
<div style="font-size:10.5px;margin-top:6px;color:${C.inkSoft}" class="lb-mono">${esc(f.notes[3])}</div></div>${stamp}`,
      );
    }

    function openPicker(f: FieldId) {
      const hint = m.teach.fieldHints[f];
      const list = m.opts[f];
      openSheet(
        FIELD_LABEL[f],
        `${hint ? `<div class="lb-hint">${esc(hint)}</div>` : ''}${list
          .map((o) => `<button class="lb-opt${values[f] === o.id ? ' on' : ''}" data-opt="${esc(o.id)}"><b${f === 'pn' || f === 'aircraft' ? ' class="lb-mono"' : ''}>${esc(o.label)}</b>${o.sub ? `<span>${esc(o.sub)}</span>` : ''}</button>`)
          .join('')}`,
        (id) => {
          values[f] = id;
          bad.delete(f);
          justFilled = f;
          host.fx.pencil();
          closeSheet();
          renderApprove();
          justFilled = null;
        },
      );
    }

    // ---- hand it in: engineering reviews it, or you sign the logbook ----
    const rev = document.createElement('div');
    rev.className = 'lb-rev';
    main.appendChild(rev);

    function submit() {
      if (!route || finished) return;
      const fields = FIELDS_FOR[route];
      if (fields.some((f) => values[f] === undefined)) return;
      const rv = reviewLogbook(m, route, values, entry);
      const req = ROUTES.find((x) => x.id === route)!.form === 'request';
      if (rv.verdict === 'returned') returns++;
      const final = rv.verdict !== 'returned' || returns > MAX_RETURNS;
      bad = new Set(rv.problems.map((x) => x.field));
      host.fx.snap();
      const lines = req ? reviewLines(rv) : [];
      const stamp: Record<Review['verdict'], [string, string]> = {
        approved: route === 'new' ? ['Accepted · AOG', C.seaDeep] : ['Approved', C.palm],
        returned: [final ? 'Not approved' : 'Returned', C.rust],
        unneeded: ['Not needed', C.seaDeep],
        costly: ['Data on file', C.seaDeep],
        signed: ['Returned to service', C.palm],
        serious: ['Not airworthy', C.rust],
      };
      const [word, color] = stamp[rv.verdict];
      const who = req ? `Engineering · ${esc(ac.registration)} · ${esc(m.job.wo)}` : `${esc(ac.registration)} · ${BOOK[m.ata === '61-10' ? 'propeller' : 'airframe'].name.toLowerCase()} log · ${fmtDate(ac.asOf)}`;
      const newEntry = req ? '' : `<div class="lb-newe"><p class="lb-p">${esc(entryText())}</p><div class="lb-sg"><em>You</em><span>A&amp;P</span></div></div>`;
      rev.innerHTML = `<div class="lb-memo"><h3>${req ? 'ENGINEERING REVIEW' : 'YOUR LOGBOOK ENTRY'}</h3><div class="meta">${who}</div>
${lines.map((l, i) => `<div class="lb-ln ${l.ok ? 'ok' : 'bad'}" style="animation-delay:${120 + i * 110}ms"><i>${l.ok ? '✓' : '✗'}</i><span>${esc(l.text)}</span></div>`).join('')}
${newEntry}
${!req && rv.problems.length && rv.verdict !== 'serious' ? `<div class="lb-ln bad" style="animation-delay:200ms"><i>!</i><span>Paperwork: ${esc(rv.problems.map((x) => x.msg).join(' '))}</span></div>` : ''}
<p style="opacity:0;animation:lbline .3s ease forwards;animation-delay:${200 + lines.length * 110}ms">${esc(rv.note)}</p>
<div class="lb-bigstamp" style="color:${color}">${word}</div>
<div class="lb-row" data-actions style="margin-top:12px"></div></div>`;
      rev.classList.add('open');
      const stampAt = 320 + lines.length * 110;
      later(stampAt, () => {
        rev.querySelector('.lb-bigstamp')?.classList.add('go');
        if (rv.verdict === 'approved' || rv.verdict === 'signed') host.fx.good();
        else if (rv.verdict === 'returned' || rv.verdict === 'serious') host.fx.bad();
        else host.fx.thunk();
      });
      if (final) {
        finished = true;
        const res = finalResult(true);
        later(stampAt + 450, () => {
          if (res.perfect) host.fx.flourish();
          settle(host, res, 2200);
        });
        status(`${word}: ${res.summary}`);
        return;
      }
      later(stampAt + 300, () => {
        const act = rev.querySelector('[data-actions]')!;
        act.innerHTML = `<button class="lb-btn ghost" data-path style="flex:.8;font-size:14.5px;padding:0 10px">Change path</button><button class="lb-btn" data-fix style="font-size:15px;padding:0 10px">Fix, resend (${MAX_RETURNS + 1 - returns} left)</button>`;
        act.querySelector('[data-fix]')!.addEventListener('click', () => {
          host.fx.tap();
          rev.classList.remove('open');
          renderApprove();
        });
        act.querySelector('[data-path]')!.addEventListener('click', () => {
          host.fx.tap();
          rev.classList.remove('open');
          formOpen = false;
          renderApprove();
        });
      });
      renderApprove();
    }

    function reviewLines(rv: Review): { ok: boolean; text: string }[] {
      // a request engineering calls unneeded is still checked on the basics
      const short = rv.verdict === 'unneeded' || rv.verdict === 'costly';
      const fields = short ? FIELDS_FOR.new : route ? FIELDS_FOR[route] : [];
      const out = fields.map((f) => {
        const pr = rv.problems.find((x) => x.field === f);
        return pr ? { ok: false, text: pr.msg } : { ok: true, text: `${FIELD_LABEL[f]}: ${valueLabel(f)?.label ?? ''}` };
      });
      if (short) return out;
      const pe = rv.problems.find((x) => x.field === 'entry');
      out.push(pe ? { ok: false, text: pe.msg } : { ok: true, text: `Logbook entry: ${relLabel()}` });
      return out;
    }

    function entryText(): string {
      const w = valueLabel('work')?.label ?? '';
      const pn = values.pn ?? '';
      const ref = valueLabel('ref')?.label ?? '';
      return `${w}. Installed P/N ${pn}. ${m.task.ref}; ${ref}.`;
    }

    function answer(submitted: boolean): LbAnswer {
      return { entry, route, values: { ...values }, returns, submitted };
    }
    function finalResult(submitted: boolean): PuzzleResult {
      const s = scoreLogbook(m, answer(submitted));
      return result(s.score, s.summary, { kase: m.kase, ata: m.ata, entry: s.entry, route: s.route, fields: s.fields, serious: s.serious, returns });
    }

    function status(text?: string) {
      if (text) return host.status(text);
      if (screen === 'logs') {
        const y = tabs.querySelector('.lb-tab.on') as HTMLElement | null;
        host.status(`${BOOK[book].name} log${y ? ` · ${y.dataset.year}` : ''}${entry ? ` · ${entry === 'none' ? 'no record' : `relying on ${relLabel()}`}` : ''}`);
      } else if (screen === 'intro') host.status(`${m.job.wo} · ${ac.registration} · ${m.job.title}`);
      else if (!formOpen) host.status('Pick the approval path');
      else renderApprove();
    }

    function go(s: Screen) {
      screen = s;
      root.dataset.s = s;
      closeSheet();
      if (s === 'logs') {
        if (!scroll.childElementCount) showBook(false);
        renderBar();
      }
      if (s === 'approve') renderApprove();
      renderTrail();
      status();
    }

    renderTrail();
    status();

    return {
      timeUp(): PuzzleResult {
        finished = true;
        return finalResult(false);
      },
      destroy() {
        finished = true;
        timers.forEach(clearTimeout);
        cancelAnimationFrame(syncRaf);
        root.remove();
      },
    };
  },
};

