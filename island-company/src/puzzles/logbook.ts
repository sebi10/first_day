// Mechanic · Logbook research. The mechanic's own words: "When I get a task I
// get a manual. I follow manual. If part is gone or missing or damaged: IPC. If
// part no exist, I check in previous logged items on airplane, the maintenance
// logs, and then get engineering approval to put part on airplane."
//
// So the job starts where the manual and the IPC run out: the part on the
// airplane is not the one the IPC (or stores) says. Flip through the airframe,
// engine and propeller logs (dated pages, tabs by year, a lot of ordinary
// entries; a twin has a book per engine and per propeller), swipe the
// highlighter over the entry that explains the configuration (or say nothing
// does), pick how the replacement gets approved, and fill the engineering
// request or the logbook entry.
//
// The shop is a charter operator: its GMM (4.7, parts eligibility) is the
// parts-control rule the mechanic works to, and the records show it at work:
//  (a) an IPC part effective for the S/N and SB status goes on with a 43.9 entry
//  (b) an FAA-PMA part whose eligibility covers the model: same, citing the PMA
//  (c) any other part (an STC or field-approved 337's ICA parts list) goes on
//      only after company engineering issues an EA adding that P/N to the
//      tail's approved parts list (earlier ICA parts in the books cite theirs)
//  (d) no approved data on file: a major; engineering gets new data first
//
// Cases (all from src/sim/aircraft.ts, the island's real paper trail):
//  stc   an STC replaced the assembly: cite the STC, its Form 337 and the
//        holder's ICA parts list; engineering issues the EA for this tail
//  field the same kit went on under an FSDO field approval: the 337 is the
//        approval, not the STC whose data it used
//  sb    a service bulletin changed the part: the IPC lists both by effectivity
//        and the SB entry says which applies; stores pulled the pre-SB part
//  sbpre the other way round (tier 4+): no SB on record, the pre-SB lining is
//        on, and stores pulled the post-SB lining (INTCHG code 3: SB set only)
//  pma   the last replacement used an FAA-PMA part: its eligibility approves it
//  none  nothing in the books (or the 337 file) explains the part: an
//        unrecorded alteration, a major that needs new approved data (DER
//        8110-3 on a 337, or a field approval) before the airplane flies
// Asking engineering when approved data already exists costs time (partial);
// installing without the approval the part needs is a serious fault; a
// logbook entry the records don't support is sent back by the inspector.
// Tiers 0–2 teach (the entry outlined, year starred, hints on effectivity and
// on which entry matters, specific return notes); from tier 3 only what a
// mechanic would really see: the whole IPC figure, bare codes, generic returns.
// Blind sign-off (a real job from tier 2, params.blind): the paperwork goes in
// once. No engineering review or inspector buy-back, no returns, no ✓/✗, no
// verdict stamp or sounds: you see the request you sent or the entry you
// signed, stamped as handed in, whatever it scored.
import {
  ATA_TITLE,
  IPC_ATAS,
  PMA_ATAS,
  aircraftOf,
  ammTaskFor,
  bookFor,
  bookSerial,
  figSb,
  fmtDate,
  ipcFor,
  plantPart,
  plantRows,
  propAt,
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
  type Pos,
} from '../sim/aircraft';
import { hashSeed, rng, type Rng } from '../sim/rng';
import { C, FONT, settle } from './kit';
import { result, type PuzzleContext, type PuzzleDef, type PuzzleResult } from './types';

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

/**
 * oem (the part chain only): the IPC lookup said "not in the IPC", but nothing
 * replaced the assembly: the records show the OEM part, and the IPC part in
 * force is the answer (a logbook entry citing the IPC; engineering would say
 * it isn't needed).
 */
export type LbCase = 'stc' | 'field' | 'sb' | 'sbpre' | 'pma' | 'none' | 'oem';
/**
 * ipc  Maintenance: IPC part, logbook entry (14 CFR 43.9)
 * pma  FAA-PMA part, logbook entry citing its eligibility (GMM 4.7(b): no EA)
 * eng  Engineering: EA on approved data already on file (STC / field-approved 337)
 * new  Major: no approved data on file, engineering gets new data (DER 8110-3 on a 337, or an FSDO field approval)
 */
export type LbRoute = 'ipc' | 'pma' | 'eng' | 'new';
export type FieldId = 'aircraft' | 'ata' | 'work' | 'pn' | 'ref' | 'data' | 'date';
export type Opt = { id: string; label: string; sub?: string };

/** the route cards: the full rule while the game teaches (tiers 0–2), then only what each produces */
export const ROUTES: { id: LbRoute; title: string; teach: string; short: string; form: 'entry' | 'request' }[] = [
  {
    id: 'ipc',
    title: 'Maintenance: IPC part, logbook entry (43.9)',
    teach: 'The part is listed and effective in the IPC for this S/N and SB status. Install IAW the MM; the 43.9 entry cites the IPC.',
    short: '43.9 logbook entry citing the IPC.',
    form: 'entry',
  },
  {
    id: 'pma',
    title: 'FAA-PMA part, logbook entry (43.9)',
    teach: 'GMM 4.7(b): an FAA-PMA part whose eligibility list covers this model needs no EA. The 43.9 entry cites the PMA.',
    short: '43.9 logbook entry citing the PMA.',
    form: 'entry',
  },
  {
    id: 'eng',
    title: 'Engineering: EA on approved data on file',
    teach: 'An STC or a field-approved Form 337 covers the part. Company engineering issues an EA adding the ICA part to this tail’s approved parts list (GMM 4.7(c)).',
    short: 'Engineering request → EA, then install IAW the ICA.',
    form: 'request',
  },
  {
    id: 'new',
    title: 'Engineering: new approved data (major)',
    teach: 'Nothing on file approves the part: DER data (8110-3) on a Form 337, or an FSDO field approval. The aircraft stays down.',
    short: 'Engineering request → EO; aircraft AOG until data is approved.',
    form: 'request',
  },
];

/** the shop's parts-control rule, as printed in the GMM (the Manual sheet shows it) */
export const GMM: { id: string; text: string }[] = [
  { id: '(a)', text: 'A part listed and effective in the manufacturer’s IPC for the aircraft S/N and SB status: install IAW the MM; 43.9 entry citing the IPC.' },
  { id: '(b)', text: 'An FAA-PMA part whose eligibility list covers the aircraft model: install; 43.9 entry citing the PMA. No EA required.' },
  { id: '(c)', text: 'Any other part (an STC or field-approved Form 337 ICA parts list): Engineering issues an EA adding the P/N to the tail’s approved parts list before installation.' },
  { id: '(d)', text: 'No approved data on file for a part installed: a major alteration. Engineering obtains approved data (DER 8110-3 on a Form 337, or FSDO field approval). Aircraft remains out of service.' },
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
  ref: 'Reference (part eligibility)',
  data: 'Approved data on file',
  date: 'Form 337 date',
};

/** `from` (the part chain): the job that found it, who and when, and what the IPC lookup said */
export type LbJob = { wo: string; title: string; squawk: string; from?: string };

/** one logbook as the shop keeps it: the airframe's, and one per engine and per propeller */
export type LbBook = { key: string; book: LogBook; pos?: Pos; name: string; entries: LogEntry[] };

export type LbModel = {
  tier: number;
  kase: LbCase;
  ac: Aircraft;
  ata: Ata;
  /** IPC tag of the part the job replaces */
  tag: string;
  item: string;
  job: LbJob;
  /** a twin's job on one engine / propeller: whose */
  jobPos?: Pos;
  /** P/N stamped on the part that came off */
  found: string;
  /** stores pulled this one (sb: the pre-SB row; sbpre: the post-SB row) */
  issued?: string;
  /** what stores pulled for the job (the IPC's part unless the case says otherwise) */
  stores: string;
  ipc: IpcFigure;
  /** the figure rows for this part (every effectivity) */
  rows: IpcRow[];
  task: AmmTask;
  /** the books, airframe first */
  books: LbBook[];
  /** the entry that explains the configuration, or 'none' */
  answer: string;
  /** the same record in the other unit's book (a twin's RH engine or propeller): full credit too */
  same: string[];
  /** entries that point at the answer (cite the approval, or show the part in force): part credit */
  partial: string[];
  /** P/Ns a replacement may legally be (for a logbook-entry route) */
  eligible: string[];
  /** the IPC row in force for this part on this airplane */
  ipcRow: IpcRow;
  pmaPn?: string;
  pmaText?: string;
  /** what the approval is called in records: "STC SA0…", "Form 337 dated … (field approval)", the SB */
  approvalRef?: string;
  /** a rotable's serials for the entry: the unit that came off, the exchange unit going on */
  offSn?: string;
  onSn?: string;
  /** your mechanic certificate number, for the signature */
  cert: string;
  opts: Record<FieldId, Opt[]>;
  prefill: Partial<Record<FieldId, string>>;
  teach: {
    /** tier 0: the answer entry is outlined */
    markEntry: boolean;
    /** tiers 0–1: the answer's year tab carries a star */
    starYear: boolean;
    /** tiers 0–2: IPC shows which S/N effectivity applies, only this part's rows, and a "not in fig" stamp */
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
  /** paperwork sent back (engineering, or the inspector for a logbook entry) */
  returns: number;
  /** the routes of the paperwork that came back, in order */
  returnedRoutes?: LbRoute[];
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
/** units that go out on exchange: the entry records the serial off and on */
const ROTABLE = new Set(['generator', 'radio']);

/** ATA chapter-sections a tired mechanic might write instead (code, title) */
const ATA_NEAR: Record<Ata, [string, string][]> = {
  '32-40': [['32-10', 'Main gear and doors'], ['32-30', 'Extension and retraction'], ['32-60', 'Position and warning'], ['32-00', 'Landing gear, general']],
  '61-10': [['61-20', 'Propeller controlling'], ['61-00', 'Propellers, general'], ['61-40', 'Propeller indicating'], ['72-00', 'Engine (turbine / turboprop)']],
  '29-10': [['29-30', 'Hydraulic indicating'], ['29-20', 'Auxiliary hydraulic power'], ['32-30', 'Extension and retraction'], ['29-00', 'Hydraulic power, general']],
  '23-10': [['23-50', 'Audio integrating'], ['34-50', 'Dependent position determining'], ['23-00', 'Communications, general'], ['34-20', 'Attitude and direction']],
  '24-30': [['24-20', 'AC generation'], ['24-60', 'DC electrical load distribution'], ['80-10', 'Starting: cranking'], ['24-00', 'Electrical power, general']],
};

type JobText = {
  title: string;
  squawk: string;
  /** work statements for the work order / request, imperative: [0] is right, the rest are the classic mistakes */
  work: string[];
  why: string[];
  /** the same statements as a logbook entry writes them (past tense), given the P/N installed and the rotable serials */
  past: ((pn: string, found: string, off: string, on: string) => string)[];
  /** the ops check and return-to-service line of the entry */
  check: string;
};

/** work order text, the work statements (imperative for the WO, past tense for the entry); `side`: a twin's engine-side job */
function jobText(model: PlaneModel, tag: string, insp: string, side: Pos = 'LH'): JobText {
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
          'Replace LH and RH brake linings and discs',
        ],
        why: [
          '',
          'MM caution: replace the linings on both main wheels together.',
          'The work order is for the linings, not the brake assemblies.',
          'That describes installing an alteration, not replacing a part in it.',
          'The work order is for the linings; the discs are replaced only when worn below limits.',
        ],
        past: [
          (pn) => `Removed and replaced LH and RH main brake linings (worn below minimum) with P/N ${pn}`,
          (pn) => `Removed and replaced LH main brake linings (worst side) with P/N ${pn}`,
          (pn) => `Removed and replaced LH and RH main brake assemblies with P/N ${pn}`,
          (pn) => `Installed heavy-duty brake conversion, P/N ${pn}`,
          (pn) => `Removed and replaced LH and RH main brake linings and discs with P/N ${pn}`,
        ],
        check: 'Linings riveted and conditioned; brake operation normal on taxi check.',
      };
    case 'propBolt':
      return {
        title: 'Propeller mounting bolts',
        squawk: `Propeller off for spinner bulkhead repair${twin ? ` (${side})` : ''}. Two mounting bolts with galled threads. New bolt set at reinstallation.`,
        work: [
          'Replace propeller mounting bolts (full set) at reinstallation',
          'Replace the propeller assembly',
          'Install four-blade propeller conversion',
          'Chase the threads and reuse the mounting bolts',
          'Replace the two galled mounting bolts only',
        ],
        why: [
          '',
          'The work order is for the mounting bolts, not the propeller.',
          'That describes installing an alteration, not replacing a part in it.',
          'Galled bolts are replaced, never chased and reused.',
          'The work order calls for a new set: galling on two bolts makes the set suspect.',
        ],
        past: [
          (pn) => `Replaced ${twin ? `${side} ` : ''}propeller mounting bolts (full set; two galled) with P/N ${pn} at reinstallation`,
          (pn) => `Replaced the ${twin ? `${side} ` : ''}propeller assembly, P/N ${pn}`,
          (pn) => `Installed four-blade propeller conversion, P/N ${pn}`,
          (pn) => `Chased the threads and reused the ${twin ? `${side} ` : ''}propeller mounting bolts, P/N ${pn}`,
          (pn) => `Replaced the two galled ${twin ? `${side} ` : ''}propeller mounting bolts with P/N ${pn}`,
        ],
        check: 'Bolts torqued in 3 stages and safety wired; track within limits, ground run normal.',
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
          'Reset the bypass indicator and return to service',
        ],
        why: [
          '',
          'The work order is for the filter element, not the power pack.',
          'That describes installing an alteration, not replacing a part in it.',
          'The element is disposable: it is replaced, not cleaned.',
          'An extended bypass indicator means the element is loaded: replace it, then reset.',
        ],
        past: [
          (pn) => `Replaced hydraulic filter element (bypass indicator extended) with P/N ${pn}; bypass indicator reset`,
          (pn) => `Replaced the hydraulic power pack, P/N ${pn}`,
          (pn) => `Installed replacement power pack (conversion), P/N ${pn}`,
          (pn) => `Cleaned and reinstalled the hydraulic filter element, P/N ${pn}`,
          (pn) => `Reset the filter bypass indicator; element P/N ${pn} left in place`,
        ],
        check: 'Bowl torqued and safety wired; gear swing on jacks normal, no leaks.',
      };
    case 'resCap':
      return {
        title: 'Reservoir filler cap',
        squawk: 'Hydraulic reservoir filler cap cracked, seeping at the vent. Replace.',
        work: [
          'Replace hydraulic reservoir filler cap (cracked)',
          'Replace the reservoir',
          'Replace the hydraulic power pack',
          'Seal the crack and reinstall the cap',
          'Replace the filler cap O-ring only',
        ],
        why: [
          '',
          'The work order is for the filler cap, not the reservoir.',
          'The work order is for the filler cap, not the power pack.',
          'A cracked cap is replaced, not sealed.',
          'The cap itself is cracked: an O-ring will not stop the seep.',
        ],
        past: [
          (pn) => `Replaced hydraulic reservoir filler cap (cracked) with P/N ${pn}`,
          (pn) => `Replaced the hydraulic reservoir, P/N ${pn}`,
          (pn) => `Replaced the hydraulic power pack, P/N ${pn}`,
          (pn) => `Sealed the crack and reinstalled the filler cap, P/N ${pn}`,
          (pn) => `Replaced the filler cap O-ring; cap P/N ${pn} reinstalled`,
        ],
        check: 'Reservoir level checked; gear swing normal, no leaks at the vent.',
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
          'Reseat the radio in its tray and return to service',
        ],
        why: [
          '',
          'That describes a new installation (an alteration), not a replacement.',
          'The work order is for the radio, not the tray.',
          'Avionics internals go to a certificated repair station, not the hangar bench.',
          'Transmit is dead, not intermittent: reseating is troubleshooting, not the replacement ordered.',
        ],
        past: [
          (pn, found, off, on) => `Com 1 transmit inoperative: removed com radio P/N ${found} S/N ${off}; installed exchange unit P/N ${pn} S/N ${on}`,
          (pn) => `Installed GPS/NAV/COM (new installation), P/N ${pn}`,
          (pn) => `Replaced the mounting tray and connector; radio P/N ${pn}`,
          (pn) => `Repaired the com radio on the bench in house, P/N ${pn}`,
          (pn) => `Reseated com radio P/N ${pn} in its tray`,
        ],
        check: 'Ops check good on ground and tower frequencies.',
      };
    default: {
      const sg = model === 'cargo';
      const unit = sg ? 'starter-generator' : 'alternator';
      const who = twin ? `${side} alternator` : sg ? 'starter-generator' : 'alternator';
      return {
        title: sg ? 'Starter-generator' : 'Alternator',
        squawk: `${twin ? `${side} alternator` : sg ? 'Starter-generator' : 'Alternator'} no output on the ground run. Replace with an exchange unit.`,
        work: [
          `Replace ${twin ? `${side} ` : ''}${unit} with exchange unit (no output)`,
          `Install ${unit} conversion`,
          sg ? 'Replace the generator control unit' : 'Replace the voltage regulator',
          'Replace the drive belt only',
          `Repair the ${unit} on the bench in house`,
        ],
        why: [
          '',
          'That describes installing an alteration, not replacing a part in it.',
          `The work order is for the ${unit}.`,
          `The work order is for the ${unit}.`,
          `A ${unit} is repaired by a certificated repair station; the work order is an exchange unit.`,
        ],
        past: [
          (pn, found, off, on) => `${who.charAt(0).toUpperCase() + who.slice(1)} no output: removed P/N ${found} S/N ${off}; installed exchange unit P/N ${pn} S/N ${on}`,
          (pn) => `Installed ${unit} conversion, P/N ${pn}`,
          (pn) => `Replaced the ${sg ? 'generator control unit' : 'voltage regulator'}; ${unit} P/N ${pn}`,
          (pn) => `Replaced the drive belt only; ${unit} P/N ${pn}`,
          (pn) => `Repaired the ${unit} P/N ${pn} on the bench in house`,
        ],
        check: 'Ground run: output normal.',
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
  return ['stc', 'sb', 'field', 'pma', 'none', 'sbpre'];
}

const sbEntries = (ac: Aircraft, ata: Ata) => {
  const id = figSb(ac.model, ata).id;
  return ac.log.filter((e) => e.kind === 'sb' && e.ref === `IAW ${id}`);
};

/** the entries that show the OEM configuration was on the airplane during these books (P/Ns in the figure, its SB or AD, the OEM maker) */
function oemEvidence(ac: Aircraft, ata: Ata): LogEntry[] {
  const pns = new Set(ipcFor(ac, ata).rows.map((x) => x.pn));
  return ac.log.filter(
    (e) => e.ata === ata && e.kind !== 'tire' && (e.kind === 'sb' || e.kind === 'ad' || /Beaumont/.test(e.text) || !!e.pns?.some((p) => (p.on && pns.has(p.on)) || (p.off && pns.has(p.off)))),
  );
}

/** the latest lining entries with the pre-SB lining (sbpre: the configuration on the airplane now) */
const preSbLinings = (ac: Aircraft, pn: string) => ac.log.filter((e) => e.kind === 'brake' && e.ata === '32-40' && e.pns?.some((p) => p.on === pn));

/** build the airplane for one case, or undefined when this airplane's records can't carry it */
function buildCase(kase: LbCase, seed: number, assetId: string, model: PlaneModel, ata: Ata): Aircraft | undefined {
  if (kase === 'stc' || kase === 'field') return aircraftOf(seed, assetId, model, { plant: ata, via: kase });
  if (kase === 'pma') {
    if (!PMA_ATAS.includes(ata)) return undefined;
    const ac = aircraftOf(seed, assetId, model, { plant: ata, via: 'pma' });
    return ac.plant ? ac : undefined;
  }
  const ac = aircraftOf(seed, assetId, model);
  if (kase === 'sb') return sbEntries(ac, ata).length ? ac : undefined;
  if (kase === 'sbpre') {
    // only the lining's supersession is INTCHG code 3 (the SB set); the airplane must be pre-SB with a lining change on record
    if (ata !== '32-40' || ac.sbs.some((x) => x.id === figSb(model, ata).id)) return undefined;
    return preSbLinings(ac, rowFor(ipcFor(ac, ata), 'lining')!.pn).length ? ac : undefined;
  }
  // none: the OEM part has to be on record in these books, so the kit went on since, unrecorded
  return oemEvidence(ac, ata).length ? ac : undefined;
}

/** the books as the shop keeps them: airframe, each engine, each propeller */
function booksOf(ac: Aircraft): LbBook[] {
  const out: LbBook[] = [];
  const add = (book: LogBook, pos: Pos | undefined, name: string) => {
    const entries = ac.log.filter((e) => e.book === book && e.pos === pos);
    out.push({ key: pos ? `${book}:${pos}` : book, book, pos, name, entries });
  };
  add('airframe', undefined, 'Airframe');
  const twin = ac.model === 'twin';
  for (const pos of twin ? (['LH', 'RH'] as const) : [undefined]) add('engine', pos, pos ? `${pos} engine` : 'Engine');
  for (const pos of twin ? (['LH', 'RH'] as const) : [undefined]) add('propeller', pos, pos ? `${pos} prop` : 'Propeller');
  return out;
}

/** the key of the book an entry is in */
export const bookKeyOf = (e: Pick<LogEntry, 'book' | 'pos'>) => (e.pos ? `${e.book}:${e.pos}` : e.book);

const reEsc = (x: string) => x.replace(/[.*+?^$|()[\]{}\\]/g, '\\$&');
const SN_PREFIX: Record<string, string> = { HSG: 'H', HA: 'H', TR: 'T', VM: 'VM', NX: 'NX' };

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
  // the part chain researches this airplane's own records for its own part, whatever they show
  const chainTag = context?.chain?.step === 'research' ? context.chain.tag : undefined;
  if (given && chainTag && fixedAta && (!given.plant || given.plant.via === 'pma' || given.plant.ata !== fixedAta)) {
    kase = 'oem';
    ata = fixedAta;
    ac = given;
  } else if (given?.plant) {
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
  const tag = kase === 'oem' ? chainTag! : kase === 'sb' || kase === 'sbpre' ? SB_TAG[ata] : kase === 'pma' ? PMA_TAG[ata] : plantPart(model, ata).tag;
  const rows = ipc.rows.filter((x) => x.tag === tag);
  const ipcRow = rowFor(ipc, tag)!;
  const insp = model === 'cargo' ? 'phase inspection' : '100-hour';
  // the part chain: the work order is the finding of the job that found it (its words, its side), and says who and where
  const chain = context?.chain?.step === 'research' ? context.chain : undefined;
  const side: Pos | undefined = chain?.found.startsWith('R/H') ? 'RH' : chain?.found.startsWith('L/H') ? 'LH' : undefined;
  const jt = jobText(model, tag, insp, side);
  const woNo = `WO ${ac.asOf.slice(2, 4)}-${String(r.int(120, 980)).padStart(4, '0')}`;
  const finding = chain?.found.replace(/\s*On the airplane:.*$/, '').trim();
  const job: LbJob = {
    wo: woNo,
    title: jt.title,
    squawk: finding || jt.squawk,
    ...(chain
      ? { from: `Found${chain.from ? ` on “${chain.from}”` : ''}${chain.by ? ` by ${chain.by}` : ''}${chain.week ? `, week ${chain.week}` : ''}. IPC lookup: not in the IPC.` }
      : {}),
  };
  // a twin's propeller and alternator jobs are on one side: the chain's, else LH (the work order says so)
  const jobPos: Pos | undefined = model === 'twin' && bookFor(ata) !== 'airframe' ? (side ?? 'LH') : undefined;

  // what came off the airplane, what the answer entry is, and what else points at it
  let found = ipcRow.pn;
  let issued: string | undefined;
  let answer = 'none';
  let same: string[] = [];
  let partial: string[] = [];
  let eligible: string[] = [];
  let pmaPn: string | undefined;
  let pmaText: string | undefined;
  let approvalRef: string | undefined;
  if ((kase === 'stc' || kase === 'field') && plant) {
    found = plant.neededPn;
    answer = plant.entryId;
    same = plant.alsoEntryIds;
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
    const sbs = sbEntries(ac, ata);
    const e = sbs.find((x) => x.pos === jobPos) ?? sbs[0];
    answer = e.id;
    same = sbs.filter((x) => x.id !== e.id).map((x) => x.id);
    partial = ac.log.filter((x) => x.date > e.date && x.ata === ata && x.pns?.some((p) => p.on === post.pn)).map((x) => x.id);
    eligible = [post.pn];
    approvalRef = figSb(model, ata).id;
  } else if (kase === 'sbpre') {
    // pre-SB airplane: the D lining is on and in force; stores pulled the code-3 C lining
    const post = rows.find((x) => x.eff === 'C')!;
    found = ipcRow.pn;
    issued = post.pn;
    const lin = preSbLinings(ac, found);
    answer = lin[lin.length - 1].id;
    partial = lin.slice(0, -1).map((x) => x.id);
    eligible = [found];
    approvalRef = figSb(model, ata).id;
  } else if (kase === 'oem') {
    // the OEM part is on the airplane: the last time it (or the part it supersedes) was logged going on says so
    found = ipcRow.pn;
    const forward = rows.filter((x) => x.pn === found || x.supsdBy?.pn === found || (x.applies && x.supsdBy && x.supsdBy.code !== 3)).map((x) => x.pn);
    eligible = [...new Set([found, ...rows.filter((x) => x.applies && x.supsdBy && x.supsdBy.code !== 3).map((x) => x.supsdBy!.pn)])];
    const onAta = ac.log.filter((e) => e.ata === ata);
    const logged = onAta.filter((e) => e.pns?.some((q) => q.on && (forward.includes(q.on) || eligible.includes(q.on))));
    const pick = logged[logged.length - 1] ?? sbEntries(ac, ata).pop() ?? onAta[onAta.length - 1];
    answer = pick?.id ?? 'none';
    partial = onAta.filter((e) => e.id !== answer).map((e) => e.id);
    approvalRef = `IPC Fig ${ipc.fig} item ${ipcRow.item}`;
  } else {
    // none: the kit's part is on the airplane and nothing in the books says how
    found = plantPart(model, ata).pn;
  }
  const stores = issued ?? ipcRow.pn;

  const books = booksOf(ac);

  // a rotable goes out on exchange: the serial that came off (the last one logged on, if any) and the tag on the exchange unit
  let offSn: string | undefined;
  let onSn: string | undefined;
  if (ROTABLE.has(tag)) {
    const pre = SN_PREFIX[found.split('-')[0]] ?? 'S';
    // the unit on the airplane: the last one logged going on (exchanged, or bench-repaired and reinstalled)
    const q = reEsc(found);
    const onRe = new RegExp('installed (?:exchange unit )?P/N ' + q + ' S/N (\\w+)|P/N ' + q + ' S/N (\\w+); bench repaired and reinstalled');
    const logged = [...ac.log].reverse().find((e) => e.ata === ata && e.pos === jobPos && onRe.test(e.text));
    const hit = logged ? onRe.exec(logged.text) : null;
    offSn = hit?.[1] ?? hit?.[2] ?? `${pre}${rng(hashSeed(ac.registration, found, 'off')).int(10000, 99999)}`;
    onSn = `${pre}${rng(hashSeed(ac.registration, found, 'xchg', seed)).int(10000, 99999)}`;
  }
  const cert = String(rng(hashSeed('you', islandSeed)).int(2100000, 3899999));

  // ---- the form's choices, drawn from this airplane's own paperwork ----
  const n = tier <= 1 ? 3 : tier === 2 ? 4 : 5;
  const titles = tier <= 2;
  const take = (right: Opt[], wrong: Opt[], count = n) => r.shuffle([...right, ...r.shuffle(wrong).slice(0, Math.max(0, count - right.length))]);

  const [otherId, otherModel] = OTHER[model];
  const other = aircraftOf(islandSeed, otherId, otherModel);
  // the propeller S/N printed at the head of the propeller logbook: the classic slip for the airframe's
  const propSn = propAt(ac, jobPos ?? 'LH', ac.asOf).serial;
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
  );

  // part numbers: what is on it, what the IPC lists, the other effectivity, the kit, a detail part
  const pnRight = new Set<string>([found]);
  if (kase === 'pma') pnRight.add(ipcRow.pn);
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
    addPn(plantRows(model, ata).find((x) => x.indent >= 2 && x.pn !== found)?.pn, 'kit detail part');
  } else addPn(kit.pn, `${kit.holder} (STC kit part)`);
  if ((kase === 'sb' || kase === 'sbpre' || kase === 'pma' || kase === 'oem') && (tag === 'lining' || tag === 'filter')) {
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
  // the SB cases' trap is what stores pulled: it is always on the list
  const trap = issued ? pnAll.filter((o) => o.id === issued) : [];
  const pnOpts = r.shuffle([
    ...trap,
    ...take(
      pnAll.filter((o) => pnRight.has(o.id)),
      pnAll.filter((o) => !pnRight.has(o.id) && o.id !== issued),
      n - trap.length,
    ),
  ]);

  // logbook-entry reference: IPC rows (in force or not), PMA eligibility, and classic non-approvals
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

  // approved data on file: every alteration in the records (plus the STC a field approval borrowed from),
  // padded with what sits next to it in a records room: another airplane's STC, the kit's ICA
  const altLabel = (a: Aircraft['alterations'][number]) =>
    a.stc ? { label: `STC ${a.stc}`, sub: titles ? `${a.holder}: ${a.title}` : undefined } : { label: 'Form 337 (field approval)', sub: titles ? a.title : `dated ${fmtDate(a.form337)}` };
  const dataRight: Opt[] = [];
  const dataWrong: Opt[] = [];
  for (const a of ac.alterations) {
    const o = { id: `alt:${a.id}`, ...altLabel(a) };
    if (a.displaces && (kase === 'stc' || kase === 'field')) dataRight.push(o);
    else dataWrong.push(o);
  }
  // a field approval's trap is the STC whose data it used: always on the list
  const dataTrap: Opt[] = plant?.basisStc ? [{ id: 'basis', label: `STC ${plant.basisStc}`, sub: titles ? `${plant.holder}: ${plant.ata} kit (basis data)` : undefined }] : [];
  dataWrong.push({ id: 'ica', label: kit.ica, sub: titles ? `${kit.holder} ICA (parts list)` : undefined });
  for (const a of other.alterations) dataWrong.push({ id: `x:${a.id}`, ...altLabel(a) });
  dataWrong.push({ id: 'sb', label: figSb(model, ata).id, sub: titles ? 'service bulletin' : undefined });
  const dataOpts = r.shuffle([...dataTrap, ...take(dataRight, dataWrong, n - dataTrap.length)]);

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
    field: "This kit went on under a field approval: the FSDO approved the Form 337 itself (block 3). Find that entry. The 337 is the approval, not the STC whose data it used.",
    sb: `IPC items ${rows.map((x) => x.item).join(' and ')} differ by effectivity: C is post-SB, D pre-SB. Only the logbook says whether this airplane had ${figSb(model, ata).id}.`,
    sbpre: `The post-SB lining is INTCHG code 3: it goes on only with the SB set. Is ${figSb(model, ata).id} on record? The last lining change says what is on the airplane.`,
    pma: 'An FAA-PMA part replaces an OEM part and carries its own eligibility list. Find the entry where it went on.',
    none: 'If nothing in the books (or the 337 file) explains a part, it is an unrecorded alteration.',
    oem: `Sent here from the IPC lookup. Is there an alteration on ${ata} in the records at all? If the books only ever show the IPC part going on, the IPC part is the answer.`,
  };
  const where = bookHint(ata, kase, jobPos);
  const fieldHints: Partial<Record<FieldId, string>> =
    tier <= 1
      ? {
          aircraft: 'Airframe S/N: the data plate, not the engine or propeller.',
          pn: kase === 'sb' || kase === 'sbpre' ? 'The IPC row in force for this airplane’s SB status.' : 'Order what the approved data lists for the part that is installed.',
          ref: 'Cite what makes the part eligible for this airplane.',
          data: 'Cite the approval named in the entry you highlighted.',
          date: 'The Form 337 date is in that entry.',
          work: kase === 'sb' || kase === 'sbpre' || kase === 'pma' || kase === 'oem' ? 'Say what the work order asks for, the way the manual words it.' : 'Replacing a part in an alteration is maintenance, not a new alteration.',
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
    jobPos,
    found,
    issued,
    stores,
    ipc,
    rows,
    task: ammTaskFor(ac, TASK_OF[ata]),
    books,
    answer,
    same,
    partial,
    eligible,
    ipcRow,
    pmaPn,
    pmaText,
    approvalRef,
    offSn,
    onSn,
    cert,
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

function bookHint(ata: Ata, kase: LbCase, pos?: Pos): string {
  if (kase === 'none') return 'Check the 337 file (Manual sheet) as well as the books.';
  const b = bookFor(ata);
  if (b === 'airframe') return 'Look in the airframe logbook.';
  return b === 'propeller' ? `Propeller work goes in the ${pos ? `${pos} ` : ''}propeller logbook.` : `Engine accessories go in the ${pos ? `${pos} ` : ''}engine logbook.`;
}

// ---------------------------------------------------------------------------
// Judging: engineering's review, the inspector's sign-off, and the score
// ---------------------------------------------------------------------------

export type Outcome = 'right' | 'costly' | 'unneeded' | 'wrong' | 'serious';

/**
 * Is the route itself sound for this airplane (given the part chosen)? A
 * logbook entry relying on "nothing explains it" can never be sound: you
 * declared the configuration unrecorded, then signed it off.
 */
export function routeOutcome(m: LbModel, route: LbRoute, values: Partial<Record<FieldId, string>>, entry?: string | null): Outcome {
  const k = m.kase;
  if (route === 'ipc' || route === 'pma') {
    // a logbook entry puts the part on now: only a part the airplane's approval already covers
    if (route === 'pma' && k !== 'pma') return 'serious';
    if (k === 'sb' || k === 'sbpre' || k === 'pma' || k === 'oem') {
      if (!values.pn || !m.eligible.includes(values.pn)) return 'serious';
      // (oem: the books show nothing but the IPC part: "nothing explains it" is a fair reading of them)
      return entry === 'none' && k !== 'oem' ? 'serious' : 'right';
    }
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
      if (m.kase === 'oem') return m.eligible;
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

/** the entry explains the configuration (or the same record in the other unit's book) */
const isAnswer = (m: LbModel, entry: string | null) => !!entry && (entry === m.answer || m.same.includes(entry));
/** the records support the paperwork: the answer, or an entry that points at it */
export const supports = (m: LbModel, entry: string | null) => isAnswer(m, entry) || (!!entry && m.partial.includes(entry));

export function entryScore(m: LbModel, entry: string | null): number {
  if (!entry) return 0;
  if (isAnswer(m, entry)) return 1;
  if (m.partial.includes(entry)) return m.kase === 'sb' || m.kase === 'sbpre' ? 0.5 : 0.6;
  return 0;
}

export type Problem = { field: FieldId | 'entry' | 'route'; msg: string };

export type Review = {
  /** approved / returned by engineering or the inspector; signed / serious for a logbook entry */
  verdict: 'approved' | 'returned' | 'unneeded' | 'costly' | 'signed' | 'serious';
  /** what the serious fault is: the part is unairworthy, or it was never shown to be eligible */
  fault?: 'unairworthy' | 'ineligible' | 'records';
  problems: Problem[];
  /** engineering's or the inspector's note */
  note: string;
};

export const ROUTE_WORD: Record<LbRoute, string> = { ipc: 'IPC part', pma: 'PMA part', eng: 'data on file', new: 'new data' };

/** the stamp on a verdict */
export function stampOf(rv: Review, route: LbRoute, final: boolean): string {
  switch (rv.verdict) {
    case 'approved':
      return route === 'new' ? 'Accepted · AOG' : 'EA issued';
    case 'returned':
      return final ? (route === 'ipc' || route === 'pma' ? 'Not signed off' : 'Not approved') : 'Returned';
    case 'unneeded':
      return 'Not needed';
    case 'costly':
      return 'Data on file';
    case 'signed':
      return 'Returned to service';
    case 'serious':
      return rv.fault === 'unairworthy' ? 'Not airworthy' : rv.fault === 'records' ? 'Records fault' : 'Not eligible';
  }
}

/** What happens to the paperwork you hand in. */
export function reviewLogbook(m: LbModel, route: LbRoute, values: Partial<Record<FieldId, string>>, entry: string | null): Review {
  const o = routeOutcome(m, route, values, entry);
  const generic = m.tier >= 3;
  const plant = m.ac.plant;
  const reg = m.ac.registration;
  const problems: Problem[] = [];
  const answerEntry = m.ac.log.find((e) => e.id === m.answer);
  const when = answerEntry ? fmtDate(answerEntry.date) : '';
  const book = answerEntry ? `${answerEntry.pos ? `${answerEntry.pos} ` : ''}${answerEntry.book}` : 'airframe';

  const check = (f: FieldId) => {
    const v = values[f];
    if (v !== undefined && rightValues(m, route, f).includes(v)) return;
    problems.push({ field: f, msg: fieldMsg(m, route, f, v, generic) });
  };

  if (route === 'ipc' || route === 'pma') {
    for (const f of FIELDS_FOR[route]) check(f);
    if (o === 'serious') return { verdict: 'serious', problems, ...seriousOf(m, route, values, entry) };
    // the inspector buys back the work only when the records show the part is the right one for this airplane
    // (oem: an IPC part in force needs no record behind it beyond the figure)
    if (!supports(m, entry) && m.kase !== 'oem') {
      problems.push({ field: 'entry', msg: generic ? 'Inspector: the entry you rely on does not establish this part for this airplane.' : entryTeach(m) });
      return { verdict: 'returned', problems, note: 'Inspector: not signed off. Show the record the part rests on.' };
    }
    const cite =
      route === 'pma'
        ? `FAA-PMA ${values.pn}, ${m.pmaText}`
        : `IPC Fig ${m.ipc.fig} item ${m.ipcRow.item}${m.kase === 'sb' ? ` (post ${m.approvalRef})` : m.kase === 'sbpre' ? ` (pre ${m.approvalRef})` : ''}`;
    return { verdict: 'signed', problems, note: `${values.pn} installed ${m.task.ref}; ${cite}. Returned to service.` };
  }

  // engineering
  if (o === 'unneeded') {
    for (const f of FIELDS_FOR.new) check(f);
    const why =
      m.kase === 'pma'
        ? `FAA-PMA ${m.found} is eligible (${m.pmaText}), logged ${when}: GMM 4.7(b), no EA`
        : m.kase === 'sbpre'
          ? `${m.found} is IPC Fig ${m.ipc.fig} item ${m.ipcRow.item}, in force pre-${m.approvalRef} (no SB on record; last lining change ${when})`
          : m.kase === 'oem'
            ? `${m.found} is IPC Fig ${m.ipc.fig} item ${m.ipcRow.item}, in the IPC for this aircraft; nothing in its records replaced it`
            : `${m.found} is IPC Fig ${m.ipc.fig} item ${m.ipcRow.item}, effective after ${m.approvalRef} (${book} log, ${when})`;
    return { verdict: 'unneeded', problems, note: `Not needed: ${why}. A logbook entry would have done. One day lost.` };
  }
  if (o === 'costly') {
    for (const f of FIELDS_FOR.new) check(f);
    return {
      verdict: 'costly',
      problems,
      note: `Engineering found ${plant?.ref} in the ${book} log (${when}): the approved data was on file. No DER package needed; EA issued on that data after 4 days AOG.`,
    };
  }
  for (const f of FIELDS_FOR[route]) check(f);
  // the entry the request relies on: a later entry that cites the approval still leads engineering to it
  // (research credit is partial); an unrelated one, or none, does not
  // (a request for an EA on data "on file" that relies on "nothing on record" contradicts itself)
  if (route === 'eng' && (entry === 'none' || !supports(m, entry)))
    problems.push({
      field: 'entry',
      msg: generic
        ? 'Entry cited does not support the request.'
        : entry === 'none'
          ? 'You declared that nothing on record explains the part: then there is no approved data on file to cite.'
          : !entry
            ? 'Attach the logbook entry that recorded the installation.'
            : 'The entry you cite does not record this approval.',
    });
  if (route === 'new' && entry !== 'none' && entry)
    problems.push({ field: 'entry', msg: generic ? 'Entry cited does not support the request.' : "The entry you cite doesn't record how this part got on the airplane." });
  if (problems.length) return { verdict: 'returned', problems, note: `Returned: ${problems.length} item${problems.length > 1 ? 's' : ''} to fix.` };
  const ea = `EA ${m.ac.asOf.slice(2, 4)}-${String((hashSeed(m.ac.registration, m.ata) % 800) + 100)}`;
  if (route === 'new')
    return {
      verdict: 'approved',
      problems,
      note: `${ea.replace('EA', 'EO')}: unrecorded ${kitHolder(m)} parts on ${reg}. Aircraft grounded until DER data (8110-3) on a Form 337 or an FSDO field approval covers them, or ${m.ata} goes back to type design.`,
    };
  return {
    verdict: 'approved',
    problems,
    note: `${ea}: P/N ${values.pn} added to ${reg}'s approved parts list (GMM 4.7(c)) on ${plant?.ref}, ${plant?.ica} parts list. Install IAW the ICA; cite ${ea} in the entry.`,
  };
}

/** tiers 0–2: what the inspector tells you when the entry you rely on doesn't carry the part */
function entryTeach(m: LbModel): string {
  if (m.kase === 'sb') return `Inspector: that entry doesn't show whether ${m.approvalRef} is complied with. The SB record decides which IPC row applies.`;
  if (m.kase === 'sbpre') return `Inspector: that entry doesn't show which lining is on the airplane. Find the last lining change (and whether ${m.approvalRef} is on record).`;
  return 'Inspector: that entry doesn’t show where the PMA part came from or what makes it eligible.';
}

/** a serious fault, said as what it is */
function seriousOf(m: LbModel, route: LbRoute, values: Partial<Record<FieldId, string>>, entry: string | null): { fault: Review['fault']; note: string } {
  const reg = m.ac.registration;
  const plant = m.ac.plant;
  const pn = values.pn ?? 'that part';
  const answerEntry = m.ac.log.find((e) => e.id === m.answer);
  const when = answerEntry ? fmtDate(answerEntry.date) : '';
  const oem = m.rows.some((x) => x.pn === values.pn);
  const refLabel = values.ref ? (m.opts.ref.find((o) => o.id === values.ref)?.label ?? values.ref) : 'the reference cited';
  const k = m.kase;
  if ((k === 'sb' || k === 'sbpre' || k === 'pma') && entry === 'none' && values.pn && m.eligible.includes(values.pn))
    return { fault: 'records', note: `You declared that nothing in the records explains the part on ${reg}, then returned it to service on a logbook entry. Its eligibility was never established.` };
  if (k === 'stc' || k === 'field') {
    if (oem)
      return {
        fault: 'unairworthy',
        note: `Not airworthy: the ${m.ata} assembly on ${reg} was replaced per ${plant?.ref} (${when}). An OEM part in the ${plant?.holder} assembly: it no longer conforms to the 337.`,
      };
    if (route === 'pma') return { fault: 'ineligible', note: `Not eligible: no FAA-PMA eligibility covers ${pn} on ${reg}.` };
    return {
      fault: 'ineligible',
      note: `Not eligible under the reference cited (${refLabel}): the IPC does not list ${pn}. A part the IPC does not list goes on ${reg} only once engineering adds it to the tail's approved parts list (EA, GMM 4.7(c)).`,
    };
  }
  if (k === 'none') return { fault: 'unairworthy', note: `Not airworthy: nothing in the records approves the ${kitHolder(m)} parts on ${reg}. Installing into an unrecorded alteration.` };
  if (route === 'pma') return { fault: 'ineligible', note: `Not eligible: no FAA-PMA eligibility covers ${pn} on ${reg}.` };
  if (k === 'sb' && values.pn === m.issued)
    return { fault: 'unairworthy', note: `Not airworthy: ${pn} is the pre-SB part; ${reg} is post ${m.approvalRef} (complied ${when}). The IPC part in force is ${m.found}.` };
  if (k === 'sbpre' && values.pn === m.issued)
    return {
      fault: 'unairworthy',
      note: `Not airworthy: ${pn} is INTCHG code 3: it goes on only with the ${m.approvalRef} back plates, as a set. ${reg} is pre-SB (no SB on record; last lining change ${when}).`,
    };
  return { fault: 'ineligible', note: `Not eligible: ${pn} is not the part in force for this item on ${reg}.` };
}

const kitHolder = (m: LbModel) => plantPart(m.ac.model, m.ata).holder;

function fieldMsg(m: LbModel, route: LbRoute, f: FieldId, v: string | undefined, generic: boolean): string {
  if (v === undefined) return `${FIELD_LABEL[f]}: blank.`;
  const reg = m.ac.registration;
  switch (f) {
    case 'aircraft':
      if (generic) return "Aircraft: S/N doesn't match this airframe's data plate.";
      return v === 'engine' ? "Aircraft: that is the engine's S/N; the airframe S/N is on the data plate." : v === 'prop' ? "Aircraft: that is the propeller's S/N (the propeller logbook's)." : v === 'other' ? 'Aircraft: that registration and S/N are another airplane.' : "Aircraft: S/N doesn't match the data plate.";
    case 'ata':
      return `ATA: the part is in IPC Fig ${m.ipc.fig}, chapter ${generic ? 'shown there' : m.ata}.`;
    case 'work': {
      const why = jobText(m.ac.model, m.tag, '').why[Number(v.slice(1))] ?? '';
      return generic ? "Work statement doesn't match the work order." : `Work: ${why}`;
    }
    case 'pn': {
      if (route === 'new') return generic ? 'P/N cited is not the part on the airplane.' : 'P/N: the request is for the part that is on the airplane.';
      if (route === 'eng') {
        if (generic) return 'P/N cited is not the item the work order replaces on this airplane.';
        const kit = plantPart(m.ac.model, m.ata);
        const inIca = plantRows(m.ac.model, m.ata).some((x) => x.pn === v);
        if (v === kit.kit) return 'P/N: that is the conversion kit, not the item the work order replaces.';
        if (inIca) return 'P/N: that is a detail part in the ICA parts list, not the item the work order replaces.';
        if (m.rows.some((x) => x.pn === v) || m.ipc.rows.some((x) => x.pn === v)) return 'P/N: that is an OEM part from the IPC; it does not belong in the altered assembly.';
        return 'P/N: not in the parts list of the approval you cite.';
      }
      return `P/N is not the part the ${ROUTE_WORD[route]} basis covers for this airplane.`;
    }
    case 'ref':
      return v === '8130'
        ? 'Reference: an 8130-3 shows the part was made right, not that it is eligible for this airplane.'
        : v === 'same'
          ? 'Reference: "same as removed" does not establish eligibility.'
          : 'Reference does not make that part eligible for this airplane.';
    case 'data': {
      if (generic) return m.kase === 'stc' || m.kase === 'field' ? `Approved data cited does not cover P/N ${m.found} on ${reg}.` : 'No approval found for the data cited.';
      if (m.kase === 'none') return 'Approved data: nothing on file covers this part. It needs new data (major).';
      if (v === 'basis') return `Approved data: STC ${m.ac.plant?.basisStc} does not list ${m.ac.designation}; the approval for this airplane is the field-approved Form 337.`;
      if (v === 'ica') return 'Approved data: an ICA is maintenance instructions, not the approval. Cite the STC or 337 that approved the alteration.';
      if (v.startsWith('x:')) return `Approved data: that is in another airplane's records, not ${reg}'s.`;
      if (v === 'sb') return 'Approved data: the service bulletin changes the OEM parts; it does not cover the parts on this assembly.';
      const a = m.ac.alterations.find((x) => `alt:${x.id}` === v);
      return a ? `Approved data: ${a.stc ? `STC ${a.stc}` : `the Form 337 of ${fmtDate(a.form337)}`} covers ATA ${a.ata}, not ${m.ata}.` : 'Approved data: not found in the records.';
    }
    case 'date':
      if (generic) return 'Form 337 date does not match the approved data on file.';
      return m.kase === 'stc' || m.kase === 'field' ? "Form 337 date doesn't match the 337 on file." : 'No Form 337 on file covers this part.';
  }
}

export type LbScore = { score: number; entry: number; route: number; fields: number; serious: boolean; outcome: Outcome | null; summary: string };

const ROUTE_CREDIT: Record<Outcome, number> = { right: 1, costly: 0.5, unneeded: 0.5, wrong: 0.15, serious: 0 };
/** what each piece of paperwork sent back costs: a lesson at tiers 0–2, real time lost after */
export const returnCost = (tier: number) => (tier >= 3 ? 0.15 : 0.08);

/**
 * 30% research, 35% approval path, 35% paperwork; each return costs 8% (tiers 0–2) or 15% (3+).
 * A serious fault caps at 20%; paperwork never approved / signed caps at 45–50%;
 * from tier 3, switching path after a return caps at 75% (the return told you something).
 */
export function scoreLogbook(m: LbModel, a: LbAnswer): LbScore {
  const entry = entryScore(m, a.entry);
  const outcome = a.route ? routeOutcome(m, a.route, a.values, a.entry) : null;
  // an unsigned logbook entry installed nothing: not serious, but no route credit either
  const serious = outcome === 'serious' && a.submitted;
  const route = outcome ? ROUTE_CREDIT[outcome] : 0;
  const judged = a.route ? fieldsJudged(m, a.route) : [];
  const ok = judged.filter((f) => {
    const v = a.values[f];
    return v !== undefined && rightValues(m, a.route!, f).includes(v);
  }).length;
  const fields = judged.length ? ok / judged.length : 0;
  let score = 0.3 * entry + 0.35 * route + 0.35 * fields - returnCost(m.tier) * a.returns;
  if (serious) score = Math.min(score, 0.2);
  // paperwork that never got approved (or an entry the inspector never signed) leaves the job open
  let open = false;
  if (a.route && a.submitted && !serious && reviewLogbook(m, a.route, a.values, a.entry).verdict === 'returned') {
    open = true;
    score = Math.min(score, a.route === 'ipc' || a.route === 'pma' ? 0.45 : 0.5);
  }
  if (m.tier >= 3 && a.route && (a.returnedRoutes ?? []).some((x) => x !== a.route)) score = Math.min(score, 0.75);
  if (!a.submitted) score *= 0.8;
  score = Math.max(0, Math.min(1, Math.round(score * 1000) / 1000));
  return { score, entry, route, fields, serious, outcome, summary: summarize(m, a, entry, outcome, fields, serious, open) };
}

function summarize(m: LbModel, a: LbAnswer, entry: number, outcome: Outcome | null, fields: number, serious: boolean, open: boolean): string {
  const found = entry === 1 ? (m.answer === 'none' ? 'no record, rightly flagged' : `found the ${caseWord(m.kase)} entry`) : entry > 0 ? 'found a later entry that points to it' : m.answer === 'none' ? 'missed that nothing records it' : `missed the ${caseWord(m.kase)} entry`;
  const parts = [found];
  if (serious) parts.push(a.entry === 'none' && m.answer !== 'none' && a.values.pn && m.eligible.includes(a.values.pn) ? 'signed off a part it called unrecorded (serious)' : 'installed without approval (serious)');
  else if (open) parts.push(a.route === 'ipc' || a.route === 'pma' ? 'entry never signed off' : 'request never approved');
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
  return k === 'stc' ? 'STC' : k === 'field' ? 'field-approval' : k === 'sb' ? 'SB' : k === 'sbpre' ? 'lining' : k === 'pma' ? 'PMA' : k === 'oem' ? 'part' : 'installation';
}

/** the answer a perfect mechanic hands in (tests, and the lab's cheat) */
export function idealAnswer(m: LbModel): { entry: string; route: LbRoute; values: Partial<Record<FieldId, string>> } {
  const route: LbRoute = m.kase === 'stc' || m.kase === 'field' ? 'eng' : m.kase === 'none' ? 'new' : m.kase === 'pma' ? 'pma' : 'ipc';
  // (oem: the IPC part in force, on a logbook entry citing the figure)
  const values: Partial<Record<FieldId, string>> = {};
  for (const f of FIELDS_FOR[route]) values[f] = rightValues(m, route, f)[0];
  return { entry: m.answer, route, values };
}

/** the entry you sign, as a mechanic writes it: past tense, serials off and on, ops check, return to service */
export function entryTextOf(m: LbModel, values: Partial<Record<FieldId, string>>): string {
  const jt = jobText(m.ac.model, m.tag, '');
  const w = Number((values.work ?? 'w0').slice(1));
  const pn = values.pn ?? '';
  const ref = values.ref ? (m.opts.ref.find((o) => o.id === values.ref)?.label ?? values.ref) : '';
  const past = (jt.past[w] ?? jt.past[0])(pn, m.found, m.offSn ?? '', m.onSn ?? '');
  return `${past}. ${jt.check} ${m.task.ref}${ref ? `; ${ref}` : ''}. Aircraft returned to service.`;
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
.lb{position:absolute;inset:0;display:flex;flex-direction:column;font-variant-ligatures:none;font-feature-settings:'liga' 0,'calt' 0;touch-action:pan-y;overscroll-behavior:none;font-family:var(--font,${FONT});color:${C.ink};background:linear-gradient(${C.paper},${C.sand});overflow:hidden;-webkit-user-select:none;user-select:none}
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
.lb-from{margin-top:6px;font-size:12.5px;color:#5b6475;line-height:1.35}
.lb-path{display:flex;flex-direction:column;gap:8px;padding:12px 14px}
.lb-pi{display:grid;grid-template-columns:28px 1fr;gap:8px;align-items:start;font-size:14px;line-height:1.35}
.lb-pi i{font-style:normal;width:28px;height:28px;border-radius:50%;display:grid;place-items:center;font-weight:900;font-size:14px;background:rgba(31,42,48,.08)}
.lb-pi i.ok{background:${C.palm};color:#fff}.lb-pi i.no{background:${C.rust};color:#fff}.lb-pi i.go{background:${C.sea};color:#fff}
.lb-pn{font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-weight:800;background:rgba(31,42,48,.07);padding:0 4px;border-radius:4px;white-space:nowrap}
.lb-logs{gap:0}
.lb-books{display:flex;gap:6px;padding:4px 8px 0;flex:none}
.lb-bk{flex:1;min-height:44px;border:0;border-radius:10px 10px 4px 4px;color:#f6efe0;font-weight:800;font-size:13.5px;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.1;opacity:.72;transform:translateY(4px);transition:transform .15s,opacity .15s;box-shadow:inset 0 -3px 0 rgba(0,0,0,.2)}
.lb-bk small{font-size:10.5px;font-weight:700;opacity:.8}
.lb-books.five{gap:4px;padding:4px 6px 0}.lb-books.five .lb-bk{font-size:11.5px;letter-spacing:-.2px;padding:0 2px;white-space:nowrap}.lb-books.five .lb-bk small{font-size:9.5px}
.lb-bk.on{opacity:1;transform:none;box-shadow:inset 0 -3px 0 rgba(0,0,0,.25),0 -2px 8px rgba(0,0,0,.15)}
.lb-clue{flex:none;min-height:44px;border:0;display:flex;align-items:center;gap:6px;padding:4px 10px;font-size:12.5px;font-weight:700;color:#f6efe0;cursor:pointer;text-align:left;line-height:1.25}
.lb-clue .lb-pn{background:rgba(255,255,255,.14);color:#fff}
.lb-wrap{flex:1;min-height:0;position:relative;overflow:hidden}
.lb-scroll{position:absolute;inset:0;overflow-y:auto;overscroll-behavior:contain;padding:10px 0 90px;-webkit-overflow-scrolling:touch}
.lb-page{position:relative;margin:0 44px 14px 7px;border-radius:2px 7px 7px 2px;padding:8px 8px 10px 6px;background-color:#f4e8cb;background-image:${GRAIN},radial-gradient(120% 90% at 50% 40%,rgba(255,250,235,.55),rgba(214,186,130,.28) 80%,rgba(170,130,70,.32)),repeating-linear-gradient(transparent 0 23px,rgba(70,110,140,.13) 23px 24px);box-shadow:0 1px 0 rgba(0,0,0,.1),0 8px 16px rgba(20,10,0,.28)}
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
.lb-tabs{position:absolute;right:0;top:10px;bottom:84px;width:44px;display:flex;flex-direction:column;gap:4px;z-index:4;pointer-events:none}
.lb-tab{pointer-events:auto;position:relative;flex:0 1 54px;min-height:44px;max-height:58px;width:44px;border:0;padding:0 11px 0 0;background:transparent;display:flex;align-items:center;justify-content:center;writing-mode:vertical-rl;font-weight:900;font-size:13px;letter-spacing:.5px;color:#3b3325;cursor:pointer;transition:padding .15s}
.lb-tab::before{content:'';position:absolute;top:0;bottom:0;left:0;right:11px;border-radius:0 9px 9px 0;background:var(--tint);box-shadow:2px 2px 4px rgba(0,0,0,.25),inset 4px 0 5px rgba(0,0,0,.16);filter:saturate(.7) brightness(.9);transition:right .15s,filter .15s}
.lb-tab>span{position:relative}
.lb-tab.on{padding-right:4px}
.lb-tab.on::before{right:4px;filter:none;box-shadow:3px 3px 7px rgba(0,0,0,.35),inset 2px 0 0 rgba(255,255,255,.5)}
.lb-tab .st{writing-mode:horizontal-tb;font-size:11px;color:${C.seaDeep}}
.lb-flip{position:absolute;inset:0 44px 0 0;pointer-events:none;background-color:#efe0bd;background-image:${GRAIN},linear-gradient(90deg,rgba(0,0,0,.18),rgba(0,0,0,0) 30%,rgba(255,255,255,.2) 70%,rgba(0,0,0,.12));transform-origin:0 50%;opacity:0;z-index:3}
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
.lb-ipc td:nth-child(2):not(.n){white-space:nowrap}
.lb-ipc td{overflow-wrap:anywhere}
.lb-ipc td.n{font-size:10px;color:${C.inkSoft};padding-top:0;white-space:normal}
.lb-ipc tr.att td{font-size:9.5px;font-weight:800;letter-spacing:.6px;color:${C.inkSoft};text-align:center;border-bottom:0;padding:5px 3px 1px}
.lb-ipc tr.hit td{background:rgba(255,222,56,.28)}
.lb-rec{display:grid;grid-template-columns:auto 1fr;gap:3px 8px;font-size:12px;line-height:1.35;margin-top:6px}
.lb-rec b{font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-size:11px;white-space:nowrap}
.lb-gmm{font-size:12px;line-height:1.4;margin:4px 0 0;padding-left:0;list-style:none}
.lb-gmm li{display:grid;grid-template-columns:24px 1fr;gap:2px;margin-top:3px}
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
  // three books to search by year tab (five on the twin) and a form of 4–6 fields: a little more than the usual budget, within 120 s
  seconds: (tier) => Math.min(120, 90 + tier * 6),
  mount(host, p) {
    const m = generateLogbook(p.seed, p.tier, p.tools, p.context);
    const { ac } = m;
    const blind = !!p.blind;
    const r = rng(hashSeed('lb-ui', p.seed));
    const bare = m.tier >= 3;
    const sbLike = m.kase === 'sb' || m.kase === 'sbpre';
    const oem = m.kase === 'oem';
    type Screen = 'intro' | 'logs' | 'approve';
    let screen: Screen = 'intro';
    const bookOf = new Map(m.books.map((b) => [b.key, b]));
    const answerKey = (() => {
      const e = ac.log.find((x) => x.id === m.answer);
      return e ? bookKeyOf(e) : 'airframe';
    })();
    // the first lessons open the book the answer is in; after that the airframe log is on top
    let book: string = m.tier <= 1 ? answerKey : 'airframe';
    let entry: string | null = null;
    let route: LbRoute | null = null;
    const values: Partial<Record<FieldId, string>> = { ...m.prefill };
    let returns = 0;
    const returnedRoutes: LbRoute[] = [];
    let bad = new Set<string>();
    let finished = false;
    /** the result, fixed the moment the paperwork is handed in (the clock stops there) */
    let locked: PuzzleResult | null = null;
    let noteOpen = !!m.teach.hint;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (ms: number, f: () => void) => timers.push(setTimeout(f, ms));
    const clearTimers = () => {
      timers.forEach(clearTimeout);
      timers.length = 0;
    };

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
      return e ? `${fmtDate(e.date)} · ${(bookOf.get(bookKeyOf(e))?.name ?? e.book).replace(/^(Airframe|Engine|Propeller)/, (x) => x.toLowerCase())} log` : '';
    };

    function renderTrail() {
      const canApprove = entry !== null;
      const step = (id: string, title: string, sub: string, cls: string, disabled = false) =>
        `<button class="lb-step ${cls}" data-step="${id}"${disabled ? ' disabled' : ''}><b>${title}</b><small>${sub}</small></button>`;
      trail.innerHTML =
        step('manual', 'Manual', `✓ MM ${m.task.taskNo}`, '') +
        step('ipc', 'IPC', bare ? `Fig ${m.ipc.fig}` : sbLike || oem ? `? Fig ${m.ipc.fig}` : `✗ Fig ${m.ipc.fig}`, bare || sbLike || oem ? '' : 'no') +
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
    // tiers 0–2 say what the IPC shows; from tier 3 the mechanic has the part in hand, the stores slip, and the figure
    // the part chain: nothing came from stores; the IPC lookup sent it here (tiers 3+: check the figure yourself)
    const chained = !!p.context?.chain;
    const ipcLine = chained
      ? bare
        ? `Sent here from the IPC lookup as “not in the IPC”. On the airplane: <span class="lb-pn">${esc(m.found)}</span>${m.kase === 'pma' ? ', marked FAA-PMA' : ''}. Check Fig ${m.ipc.fig}, then: what do the records say?`
        : `Sent here from the IPC lookup as “not in the IPC”. Fig ${m.ipc.fig} lists <span class="lb-pn">${esc(m.ipcRow.pn)}</span> (item ${esc(m.ipcRow.item)}). On the airplane: <span class="lb-pn">${esc(m.found)}</span>${m.kase === 'pma' ? ', marked FAA-PMA' : ''}. What do the records say?`
      : bare
      ? `The part that came off is stamped <span class="lb-pn">${esc(m.found)}</span>. Stores pulled <span class="lb-pn">${esc(m.stores)}</span> per Fig ${m.ipc.fig}. Check the figure before it goes on.`
      : oem
        ? `Sent here from the IPC lookup as “not in the IPC”. Fig ${m.ipc.fig} lists <span class="lb-pn">${esc(m.ipcRow.pn)}</span> (item ${esc(m.ipcRow.item)}). On the airplane: <span class="lb-pn">${esc(m.found)}</span>. What do the records say?`
      : sbLike
        ? `Fig ${m.ipc.fig} lists ${m.rows.map((x) => `<span class="lb-pn">${esc(x.pn)}</span> (item ${esc(x.item)}, eff ${esc(x.eff || 'all')})`).join(' and ')}. Stores pulled <span class="lb-pn">${esc(m.issued!)}</span>. On the airplane: <span class="lb-pn">${esc(m.found)}</span>. Which one applies?`
        : `Fig ${m.ipc.fig} lists <span class="lb-pn">${esc(m.ipcRow.pn)}</span> (item ${esc(m.ipcRow.item)}). On the airplane: <span class="lb-pn">${esc(m.found)}</span>${m.kase === 'pma' ? ', marked FAA-PMA' : ''}. <b>Not in the IPC.</b>`;
    intro.innerHTML = `
<div class="lb-card lb-wo">
  <div class="lb-lbl">${esc(m.job.wo)} · ${esc(ac.registration)} · ${esc(ac.designation)}</div>
  <h2>${esc(m.job.title)}</h2>
  <div class="lb-sq">“${esc(m.job.squawk)}”</div>${m.job.from ? `\n  <div class="lb-from">${esc(m.job.from)}</div>` : ''}
</div>
<div class="lb-card lb-path">
  <div class="lb-pi"><i class="ok">✓</i><div><b>Manual.</b> ${esc(m.task.ref.replace('IAW ', ''))}: ${esc(m.task.title)}. <span style="color:${C.inkSoft}">“${esc(m.task.notes[1])}”</span></div></div>
  <div class="lb-pi"><i class="${bare || sbLike || oem ? 'go' : 'no'}">${bare || sbLike || oem ? '?' : '✗'}</i><div><b>IPC.</b> ${ipcLine}</div></div>
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
      chained
        ? `<span>On the airplane: <span class="lb-pn">${esc(m.found)}</span> · IPC lookup: not in the IPC · Fig ${m.ipc.fig} ▸</span>`
        : bare || sbLike
        ? `<span>Removed: <span class="lb-pn">${esc(m.found)}</span> · stores: <span class="lb-pn">${esc(m.stores)}</span> · Fig ${m.ipc.fig} ▸</span>`
        : `<span>On the airplane: <span class="lb-pn">${esc(m.found)}</span> · IPC Fig ${m.ipc.fig}: <span class="lb-pn">${esc(m.ipcRow.pn)}</span> ▸</span>`;
    clue.addEventListener('click', () => {
      if (finished || host.paused()) return;
      host.fx.tap();
      openIpc();
    });

    const pageStart: Record<string, number> = Object.fromEntries(m.books.map((b) => [b.key, b.book === 'airframe' ? r.int(18, 60) : b.book === 'engine' ? r.int(9, 40) : r.int(3, 16)]));
    const PER_PAGE = 5;
    /** pages of one book; a propeller changed by STC starts a new book (its own S/N at the head of the page) */
    const bookHtml = (key: string) => {
      const b = bookOf.get(key)!;
      const head = (sn: string, pno: number | null) =>
        `<div class="lb-ph"><span>${esc(b.name.replace(/prop$/, 'propeller'))} log · ${esc(ac.registration)} · S/N ${esc(sn)}</span>${pno === null ? '' : `<span>p. ${pno}</span>`}</div>`;
      if (!b.entries.length) return `<div class="lb-page">${head(bookSerial(ac, b.book, b.pos, ac.asOf), null)}<p class="lb-p" style="padding:18px 4px;opacity:.6">No entries in this book since ${fmtDate(ac.logStart)}.</p></div>`;
      const runs: { sn: string; list: LogEntry[] }[] = [];
      for (const e of b.entries) {
        const sn = bookSerial(ac, b.book, b.pos, e.date);
        if (runs[runs.length - 1]?.sn === sn) runs[runs.length - 1].list.push(e);
        else runs.push({ sn, list: [e] });
      }
      let html = '';
      runs.forEach((run, ri) => {
        for (let i = 0; i < run.list.length; i += PER_PAGE) {
          const page = run.list.slice(i, i + PER_PAGE);
          const pno = (ri ? 1 : pageStart[key]) + i / PER_PAGE;
          const stain = hashSeed('stain', ac.registration, key, ri, pno) % 6 === 0 ? ` stain" style="--sy:${20 + (pno * 37) % 55}%` : '';
          html += `<div class="lb-page${stain}">${head(run.sn, pno)}
<div class="lb-ch"><span>Date / time</span><span>Description of work · reference · signature</span></div>${page.map((e) => entryHtml(e, ac.model)).join('')}</div>`;
        }
      });
      return html;
    };

    const answerEntry = entryById.get(m.answer);
    const renderBooks = () => {
      books.classList.toggle('five', m.books.length > 3);
      books.innerHTML = m.books
        .map((b) => `<button class="lb-bk${b.key === book ? ' on' : ''}" data-book="${b.key}" style="background:${BOOK[b.book].cloth}">${esc(b.name)}<small>${b.entries.length} ${b.entries.length === 1 ? 'entry' : 'entries'}</small></button>`)
        .join('');
      const cur = bookOf.get(book)!.book;
      logs.style.background = BOOK[cur].edge;
      clue.style.background = BOOK[cur].cloth;
    };
    books.addEventListener('click', (ev) => {
      const b = (ev.target as HTMLElement).closest('[data-book]') as HTMLElement | null;
      if (!b || finished || host.paused() || b.dataset.book === book) return;
      host.fx.tap();
      book = b.dataset.book!;
      showBook(true);
    });

    let years: string[] = [];
    function showBook(animate: boolean) {
      renderBooks();
      scroll.innerHTML = bookHtml(book);
      years = [...new Set(bookOf.get(book)!.entries.map((e) => e.date.slice(0, 4)))];
      const star = m.teach.starYear && answerEntry && answerKey === book ? answerEntry.date.slice(0, 4) : '';
      tabs.innerHTML = years
        .map((y, i) => `<button class="lb-tab" data-year="${y}" aria-label="${y}" style="--tint:${TAB_TINTS[(i + years.length) % TAB_TINTS.length]}"><span>’${y.slice(2)}</span>${y === star ? '<span class="st">★</span>' : ''}</button>`)
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
        if (finished || drag !== d || d.mode !== 'wait') return;
        d.mode = 'scroll'; // consumed
        commit(d.was ? null : d.id);
        if (!d.was) host.fx.snap();
      }, 520);
      timers.push(d.lp);
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
${ROUTES.map((x) => `<button class="lb-route${route === x.id ? ' on' : ''}" data-route="${x.id}"><i>${ICON[x.id]}</i><div><b>${esc(x.title)}</b><span>${esc(bare ? x.short : x.teach)}</span></div></button>`).join('')}`;
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
  <button class="lb-btn${req ? '' : ' ink'}" data-submit style="margin-top:12px"${filled < fields.length ? ' disabled' : ''}>${req ? (returns ? 'Resend to engineering' : 'Send to engineering') : returns ? 'Sign the entry again' : 'Sign the entry'}</button>
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
      const props = (ac.model === 'twin' ? (['LH', 'RH'] as const) : [undefined])
        .map((pos) => {
          const u = propAt(ac, pos, ac.asOf);
          return `${pos ? `${pos} propeller` : 'Propeller'} ${esc(u.maker)} ${esc(u.model)} S/N ${esc(u.serial)}`;
        })
        .join('<br>');
      // the FAA 337 file from the records: every major alteration, including the ones older than these logbooks
      const alts = [...ac.alterations].sort((a, b) => a.form337.localeCompare(b.form337));
      const records = `<div class="lb-doc"><div class="lb-lbl">Aircraft records · FAA Form 337 file · ${esc(ac.registration)}</div>
<div class="lb-rec">${alts
        .map((a) => `<b>${fmtDate(a.form337)}</b><span>${a.stc ? `STC ${esc(a.stc)} · ${esc(a.holder)}` : `Field approval (block 3) · ${esc(a.holder)} data`}: ${esc(a.title)}</span>`)
        .join('')}</div><div style="font-size:11px;margin-top:6px;color:${C.inkSoft}">${alts.length} Form 337s on file. Current logbooks open ${fmtDate(ac.logStart)}; earlier books archived.</div></div>`;
      openSheet(
        'Work order and manual',
        `<div class="lb-doc"><div class="lb-lbl">${esc(m.job.wo)} · ${esc(ac.registration)}</div><h4 style="margin-top:4px">${esc(m.job.title)}</h4><div class="lb-sq">“${esc(m.job.squawk)}”</div></div>
<div class="lb-plate">${esc(MAKER)}<br>MODEL ${esc(ac.designation)} · TC ${esc(ac.typeCert)}<br>SERIAL NO. ${esc(ac.serial)}<br>MFD ${ac.year}</div>
<div class="lb-doc" style="font-size:12.5px"><b>${esc(ac.registration)}</b> · ${esc(ac.description)}<br>${eng}<br>${props}</div>
${records}
<div class="lb-doc"><div class="lb-lbl">Island Company GMM 4.7 · parts eligibility</div><ul class="lb-gmm">${GMM.map((g) => `<li><b>${esc(g.id)}</b><span>${esc(g.text)}</span></li>`).join('')}</ul></div>
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
      // a long assembly P/N may break after its '/', nowhere else
      const row = (x: IpcRow) =>
        `<tr><td>${esc(x.item)}</td><td><b>${esc(x.pn).replace(/\//g, '/<wbr>')}</b></td><td>${esc(x.text)}</td><td>${esc(x.eff || '')}</td><td>${x.upa}</td></tr>${x.notes.length ? `<tr><td></td><td colspan="4" class="n">${x.notes.map(esc).join(' · ')}</td></tr>` : ''}`;
      let rows: string;
      if (bare) {
        // from tier 3 the whole figure, as printed: find the part, read NP / SUPSD BY / ATTACHING PARTS yourself
        const att = (t: string) => `<tr class="att"><td colspan="5">${t}</td></tr>`;
        let inAtt: string | undefined;
        rows = f.rows
          .map((x) => {
            let pre = '';
            if (x.attachingFor !== inAtt) {
              if (inAtt) pre += att('- - - * - - -');
              if (x.attachingFor) pre += att('ATTACHING PARTS');
              inAtt = x.attachingFor;
            }
            return pre + row(x);
          })
          .join('');
        if (inAtt) rows += att('- - - * - - -');
      } else rows = m.rows.map(row).join('');
      const stamp = bare
        ? ''
        : sbLike
          ? `<div class="lb-doc">Stores pulled <span class="lb-pn">${esc(m.issued!)}</span>. On the airplane: <span class="lb-pn">${esc(m.found)}</span>. Which row applies depends on the SB record.</div>`
          : `<div style="text-align:center;padding:4px 0"><span class="lb-stamp" style="color:${C.rust}">${esc(m.found)} · not in Fig ${f.fig}</span></div>`;
      const notes = bare ? f.notes : [f.notes[3]];
      openSheet(
        `IPC Fig ${f.fig} · ${f.chapter}`,
        `<div class="lb-doc"><div class="lb-lbl">${esc(f.catalog)}</div><h4 style="margin-top:3px">FIG ${f.fig} ${esc(f.title)}</h4>
<div class="lb-eff">${eff}</div>
<table class="lb-ipc" style="margin-top:8px"><tr><th>ITEM</th><th>PART NO.</th><th>NOMENCLATURE</th><th>EFF</th><th>UPA</th></tr>${rows}</table>
${notes.map((x) => `<div style="font-size:10.5px;margin-top:6px;color:${C.inkSoft}" class="lb-mono">${esc(x)}</div>`).join('')}</div>${stamp}`,
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
      const req = ROUTES.find((x) => x.id === route)!.form === 'request';
      if (blind) return handIn(req);
      const rv = reviewLogbook(m, route, values, entry);
      if (rv.verdict === 'returned') {
        returns++;
        returnedRoutes.push(route);
      }
      const final = rv.verdict !== 'returned' || returns > MAX_RETURNS;
      bad = new Set(rv.problems.map((x) => x.field));
      host.fx.snap();
      // engineering answers item by item; the inspector who won't sign says why
      const refused = !req && rv.verdict === 'returned';
      const lines = req ? reviewLines(rv) : refused ? rv.problems.map((x) => ({ ok: false, text: x.msg })) : [];
      const word = stampOf(rv, route, final);
      const color = rv.verdict === 'approved' || rv.verdict === 'signed' ? C.palm : rv.verdict === 'returned' || rv.verdict === 'serious' ? C.rust : C.seaDeep;
      const jobBook = bookOf.get(bookFor(m.ata) + (m.jobPos ? `:${m.jobPos}` : ''))?.name ?? 'Airframe';
      const who = req ? `Engineering · ${esc(ac.registration)} · ${esc(m.job.wo)}` : `${esc(ac.registration)} · ${esc(jobBook.replace(/^(Airframe|Engine|Propeller)/, (x) => x.toLowerCase()))} log · ${fmtDate(ac.asOf)}`;
      const newEntry = req
        ? ''
        : `<div class="lb-newe"><p class="lb-p">${esc(entryTextOf(m, values))}</p><div class="lb-sg"><em>You</em><span>A&amp;P ${esc(m.cert)}</span></div></div>`;
      const paperwork = rv.problems.filter((x) => x.field !== 'entry');
      rev.innerHTML = `<div class="lb-memo"><h3>${req ? 'ENGINEERING REVIEW' : refused ? 'INSPECTOR · BUY-BACK' : 'YOUR LOGBOOK ENTRY'}</h3><div class="meta">${who}</div>
${newEntry}
${lines.map((l, i) => `<div class="lb-ln ${l.ok ? 'ok' : 'bad'}" style="animation-delay:${120 + i * 110}ms"><i>${l.ok ? '✓' : '✗'}</i><span>${esc(l.text)}</span></div>`).join('')}
${!req && paperwork.length && rv.verdict !== 'serious' ? `<div class="lb-ln bad" style="animation-delay:${200 + lines.length * 110}ms"><i>!</i><span>Paperwork: ${esc(paperwork.map((x) => x.msg).join(' '))}</span></div>` : ''}
<p style="opacity:0;animation:lbline .3s ease forwards;animation-delay:${200 + lines.length * 110}ms">${esc(rv.note)}</p>
<div class="lb-bigstamp" style="color:${color}">${esc(word)}</div>
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
        // handed in: the result is fixed now and the host's clock stops; the stamp and flourish play out after
        finished = true;
        const res = (locked = finalResult(true));
        settle(host, res, stampAt + 450 + 2200);
        later(stampAt + 450, () => {
          if (res.perfect) host.fx.flourish();
        });
        status(`${word}: ${res.summary}`);
        return;
      }
      later(stampAt + 300, () => {
        const act = rev.querySelector('[data-actions]')!;
        act.innerHTML = `<button class="lb-btn ghost" data-path style="flex:.8;font-size:14.5px;padding:0 10px">Change path</button><button class="lb-btn" data-fix style="font-size:15px;padding:0 10px">${req ? 'Fix, resend' : 'Fix, sign again'} (${MAX_RETURNS + 1 - returns} left)</button>`;
        act.querySelector('[data-fix]')!.addEventListener('click', () => {
          if (finished) return;
          host.fx.tap();
          rev.classList.remove('open');
          renderApprove();
        });
        act.querySelector('[data-path]')!.addEventListener('click', () => {
          if (finished) return;
          host.fx.tap();
          rev.classList.remove('open');
          formOpen = false;
          renderApprove();
        });
      });
      renderApprove();
    }

    /** blind: the paperwork as handed in (your request, or the entry you signed), stamped, and the job closes */
    function handIn(req: boolean) {
      finished = true;
      const res = (locked = finalResult(true));
      const jobBook = bookOf.get(bookFor(m.ata) + (m.jobPos ? `:${m.jobPos}` : ''))?.name ?? 'Airframe';
      const who = req ? `${esc(ac.registration)} · ${esc(m.job.wo)} · ${fmtDate(ac.asOf)}` : `${esc(ac.registration)} · ${esc(jobBook.replace(/^(Airframe|Engine|Propeller)/, (x) => x.toLowerCase()))} log · ${fmtDate(ac.asOf)}`;
      const body = req
        ? `${FIELDS_FOR[route!].map((f) => `<div class="lb-ln"><i>·</i><span>${esc(FIELD_LABEL[f])}: ${esc(valueLabel(f)?.label ?? '')}</span></div>`).join('')}
<div class="lb-ln"><i>·</i><span>Logbook entry relied on: ${esc(relLabel())}</span></div>`
        : `<div class="lb-newe"><p class="lb-p">${esc(entryTextOf(m, values))}</p><div class="lb-sg"><em>You</em><span>A&amp;P ${esc(m.cert)}</span></div></div>
<div class="lb-ln"><i>·</i><span>Relied on: ${esc(relLabel())}</span></div>`;
      const word = req ? 'Sent to engineering' : 'Signed';
      rev.innerHTML = `<div class="lb-memo"><h3>${req ? 'YOUR ENGINEERING REQUEST' : 'YOUR LOGBOOK ENTRY'}</h3><div class="meta">${who}</div>
${body}
<div class="lb-bigstamp" style="color:${C.seaDeep}">${esc(word)}</div></div>`;
      rev.classList.add('open');
      const stampAt = 320;
      later(stampAt, () => {
        rev.querySelector('.lb-bigstamp')?.classList.add('go');
        host.fx.snap();
      });
      // the same hand-in time whatever the result
      settle(host, res, stampAt + 1600);
      host.status(req ? 'Request sent to engineering' : 'Entry signed');
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

    function answer(submitted: boolean): LbAnswer {
      return { entry, route, values: { ...values }, returns, returnedRoutes: [...returnedRoutes], submitted };
    }
    function finalResult(submitted: boolean): PuzzleResult {
      const s = scoreLogbook(m, answer(submitted));
      return result(s.score, s.summary, { kase: m.kase, ata: m.ata, entry: s.entry, route: s.route, fields: s.fields, serious: s.serious, returns, ...chainOut(submitted) });
    }
    /**
     * Part chain: what goes to engineering (or onto the airplane with a logbook
     * entry). Engineering's answer is the review a real one would give, and it
     * arrives when the week resolves, not now.
     */
    function chainOut(submitted: boolean): Record<string, unknown> {
      if (!p.context?.chain) return {};
      if (!submitted || !route) return { chain: { route: null } };
      const rv = reviewLogbook(m, route, values, entry);
      const data = values.data ? m.opts.data.find((o) => o.id === values.data)?.label : undefined;
      const cite = data ? `${data}${values.date ? `, Form 337 dated ${fmtDate(values.date)}` : ''}` : undefined;
      return { chain: { route, verdict: rv.verdict, reason: rv.problems[0]?.msg ?? rv.note, pn: values.pn ?? null, ...(cite ? { cite } : {}) } };
    }

    function status(text?: string) {
      if (text) return host.status(text);
      if (screen === 'logs') {
        const y = tabs.querySelector('.lb-tab.on') as HTMLElement | null;
        host.status(`${bookOf.get(book)!.name} log${y ? ` · ${y.dataset.year}` : ''}${entry ? ` · ${entry === 'none' ? 'no record' : `relying on ${relLabel()}`}` : ''}`);
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
        // paperwork already handed in keeps its result; otherwise score it as it stands
        finished = true;
        clearTimers();
        drag = null;
        return locked ?? (locked = finalResult(false));
      },
      destroy() {
        finished = true;
        clearTimers();
        drag = null;
        cancelAnimationFrame(syncRaf);
        root.remove();
      },
    };
  },
};

