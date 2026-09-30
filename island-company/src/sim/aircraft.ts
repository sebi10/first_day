// Aircraft paperwork: the records a real A&P works from. Pure and seeded (no DOM).
//
// How the mechanic works a job, in his words: "When I get a task I get a
// manual. I follow manual. If part is gone or missing or damaged: IPC. If part
// no exist, I check in previous logged items on airplane, the maintenance
// logs, and then get engineering approval to put part on airplane."
//
// So every plane on the island carries:
//  - an identity (N-number, type-certificate data, serial number, engines, props)
//  - a compliance record (service bulletins and ADs complied with, STCs / FAA
//    Form 337 major alterations)
//  - logbooks (airframe, engine, propeller; the twin keeps one per engine and
//    one per propeller, headed with that unit's S/N): dated, tach / total
//    time, a 43.9 description, the reference it was done to, and a signature
//    with a certificate number, with plenty of ordinary noise to read through.
//    Each inspection is written in every book; the alternator / starter-
//    generator is an engine accessory and goes in the engine book.
//  - an Illustrated Parts Catalog per assembly (ipcFor): figure art for an
//    exploded view and ATA-style parts-list rows (fig-item, part number,
//    indented nomenclature, effectivity code, units per assembly, SUPSD BY /
//    interchangeability code, NP, ALT, ATTACHING PARTS)
//  - maintenance-manual task cards (ammTaskFor) whose torques and consumables
//    change with serial number and SB status.
//
// Makers, part numbers, STC and AD numbers are fictional; the conventions are
// real. aircraftOf(..., { plant: ata }) adds exactly one logbook-recorded STC
// that swapped an assembly, so the part the job needs is NOT in the
// manufacturer's IPC for this aircraft: the only trail is the logbook entry,
// the Form 337 and the STC holder's ICA parts list (see Plant).
// { plant, via: 'field' } puts the same kit on under an FSDO field approval
// (the 337 is the approval; the STC it borrowed data from does not list this
// model), and { plant, via: 'pma' } makes the last lining / filter change an
// FAA-PMA part instead (no alteration at all). The operator's parts control
// shows in the books: after a kit goes on, each ICA part replaced since went
// on under a company engineering authorization ("P/N eligibility per EA
// 24-114"), and the part the job needs has not been replaced since the kit.
import { hashSeed, rng, type Rng } from './rng';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PlaneModel = 'twin' | 'cargo' | 'float';
/** the assemblies with an IPC figure and AMM tasks */
export type Ata = '32-40' | '61-10' | '29-10' | '23-10' | '24-30';
export const IPC_ATAS: readonly Ata[] = ['32-40', '61-10', '29-10', '23-10', '24-30'];
export const ATA_TITLE: Record<Ata, string> = {
  '32-40': 'Wheels and brakes',
  '61-10': 'Propeller assembly',
  '29-10': 'Main hydraulic power',
  '23-10': 'Speech communications (VHF com)',
  '24-30': 'DC generation',
};

/** the figures the job flow adds beside the five (docs/JOBFLOW.md 3.1): the oil filter and drain. The five above never change */
export type Ata2 = '79-20';
export type AnyAta = Ata | Ata2;
/** every figure, in ATA order within the IPC index */
export const ALL_ATAS: readonly AnyAta[] = [...IPC_ATAS, '79-20'];
export const ATA2_TITLE: Record<Ata2, string> = { '79-20': 'Oil system: filter and drain' };
export const ataTitle = (ata: AnyAta) => (ata === '79-20' ? ATA2_TITLE[ata] : ATA_TITLE[ata]);

export type LogBook = 'airframe' | 'engine' | 'propeller';
/** a twin's engines and propellers each have their own logbook */
export type Pos = 'LH' | 'RH';
export type LogKind =
  | 'annual'
  | '100hr'
  | 'phase'
  | 'oil'
  | 'ad'
  | 'sb'
  | 'stc'
  | 'tire'
  | 'brake'
  | 'component'
  | 'check'
  | 'elt'
  | 'repair';

export type Signer = {
  name: string;
  /** FAA certificate number (mechanic) or air-agency number (repair station) */
  cert: string;
  kind: 'A&P' | 'A&P/IA' | 'CRS';
  shop?: string;
};

export type LogEntry = {
  /** stable across planting: book letter + date + kind (+ n) */
  id: string;
  /** ISO yyyy-mm-dd (display with fmtDate) */
  date: string;
  book: LogBook;
  /** twin engine / propeller books: whose book (each engine and each propeller has its own) */
  pos?: Pos;
  kind: LogKind;
  /** tach time (piston) or Hobbs (turbine) at the entry */
  tach: number;
  /** airframe total time in service */
  tt: number;
  /** ATA chapter-section the work touched, when it touched one */
  ata?: string;
  /** what was done (14 CFR 43.9 description) */
  text: string;
  /** what it was done to: "IAW IC-310 MM 32-40-01", "per STC SA01234CH, Form 337 dated ..." */
  ref: string;
  /** part numbers removed / installed, for search */
  pns?: { off?: string; on?: string }[];
  /** 43.11 inspection statement, inspections only */
  cert?: string;
  signer: Signer;
  /** the signature line as written: "/s/ D. Okafor  A&P 3548127 IA" */
  signature: string;
};

export type SbRecord = {
  id: string;
  title: string;
  ata: string;
  /** complied with on */
  date: string;
  tt: number;
  /** changes the IPC effectivity (PRE / POST SB) for this ATA */
  ipcAta?: Ata;
};

export type AdRecord = {
  id: string;
  subject: string;
  ata: string;
  method: 'one-time' | 'recurring';
  /** recurring interval, hours in service */
  every?: number;
  last: { date: string; tt: number };
  /** next due (airframe TT), recurring only */
  nextDue?: number;
  note: string;
  /** method of compliance as the record states it (14 CFR 91.417(a)(2)(v)) */
  moc: string;
};

export type Alteration = {
  id: string;
  kind: 'stc' | 'field';
  /** STC number (SA0xxxxCH style) or the field-approval 337 block text */
  stc?: string;
  /** STC holder, or the applicant of a field approval */
  holder: string;
  title: string;
  ata: string;
  date: string;
  tt: number;
  /** date of the FAA Form 337 that recorded it */
  form337: string;
  /** Instructions for Continued Airworthiness document */
  ica: string;
  /** set only on the planted case: this alteration replaced the IPC assembly */
  displaces?: Ata;
  /** STC holder's supplemental parts list (ICA), same row format as the IPC */
  parts?: IpcRow[];
  /** ICA differences that matter on the ramp (torques, consumables) */
  icaNotes?: string[];
  weightLb: number;
};

/** how the planted part got onto the airplane legally */
export type PlantVia = 'stc' | 'field' | 'pma';

export type Plant = {
  ata: Ata;
  /**
   * 'stc': an STC swapped the assembly (default).
   * 'field': the same kit went on under an FAA field approval (Form 337 block 3),
   *   using the STC holder's data as the basis because this model is not on the
   *   STC's approved model list: the approval is the 337, not the STC.
   * 'pma': the last replacement used an FAA-PMA part (no alteration at all).
   */
  via: PlantVia;
  /** how a record cites the approval: "STC SA02507SE", "Form 337 dated 04/10/2023 (field approval)", "FAA-PMA RF066-19600" */
  ref: string;
  /** '' for pma */
  alterationId: string;
  /** '' unless via = 'stc' */
  stc: string;
  /** field approval: the STC whose data was the basis (not approved for this model) */
  basisStc?: string;
  holder: string;
  ica: string;
  /** '' for pma */
  form337: string;
  /** logbook entry that recorded the installation (a twin: the LH unit's book) */
  entryId: string;
  /** the same installation recorded in the other unit's book (a twin's RH engine / propeller) */
  alsoEntryIds: string[];
  /** later entries that cite the STC / ICA */
  laterEntryIds: string[];
  /** plain name of the part the job needs, e.g. "Brake lining" */
  item: string;
  /** what the manufacturer's IPC lists for that item on this aircraft (wrong here) */
  ipcPn: string;
  /** what is really installed and has to be ordered */
  neededPn: string;
};

export type EngineRec = { position: string; model: string; serial: string; tsmoh: number; tbo: number };
/** one propeller that is or was on the airplane during these books */
export type PropUnit = {
  position: 'LH' | 'RH' | 'Prop';
  maker: string;
  /** hub / blade model, as the data plate reads */
  model: string;
  serial: string;
  /** ISO date it went on, when that is in these books (a planted propeller STC) */
  installed?: string;
};

export type Aircraft = {
  assetId: string;
  model: PlaneModel;
  islandSeed: number;
  registration: string;
  maker: string;
  designation: string;
  typeCert: string;
  description: string;
  serial: string;
  snNum: number;
  year: number;
  meter: 'Tach' | 'Hobbs';
  /** tach reading = tt - tachOffset (the tach was replaced long ago) */
  tachOffset: number;
  tt: number;
  tach: number;
  /** date of the latest logbook entry: "today" for this airframe */
  asOf: string;
  /** first entry date of the current logbooks (earlier books are archived) */
  logStart: string;
  engineMaker: string;
  engines: EngineRec[];
  propMaker: string;
  prop: { hub: string; blades: string; count: number };
  /** every propeller in these books, oldest first per position (propAt picks the one for a date) */
  props: PropUnit[];
  /** manufacturer's maintenance manual / IPC titles */
  manual: string;
  ipcTitle: string;
  sbs: SbRecord[];
  /** SBs that apply by effectivity but are not complied with */
  sbsOpen: { id: string; title: string; ata: string }[];
  ads: AdRecord[];
  alterations: Alteration[];
  /** every entry of all three books, oldest first */
  log: LogEntry[];
  plant?: Plant;
};

// ---------------------------------------------------------------------------
// IPC types
// ---------------------------------------------------------------------------

/** Interchangeability codes used in SUPSD BY / SUPSDS notes. */
export const INTCHG: Record<1 | 2 | 3, string> = {
  1: 'Fully interchangeable: either part may replace the other.',
  2: 'One-way: the new part may replace the old one; the old part may not replace the new one.',
  3: 'Not interchangeable alone: install only as a set / after the SB modification.',
};

export type IpcRow = {
  /** figure item: "12", "12A" (added variant), "-12" (not illustrated) */
  item: string;
  pn: string;
  /** nomenclature indent level: 0 = the assembly, 1 = ". part", 2 = ". . detail" */
  indent: number;
  nomen: string;
  /** nomenclature as printed: ". . LINING, BRAKE (V33214)" */
  text: string;
  /** CAGE code of the maker when not the airframe maker */
  vendor?: string;
  /** effectivity code letter(s) from the figure header; '' = all */
  eff: string;
  upa: number | 'AR' | 'RF';
  /** printed remarks: "SUPSD BY 066-10600 (INTCHG CODE 3)", "NP", "ALT FOR ..." */
  notes: string[];
  np?: boolean;
  supsdBy?: { pn: string; code: 1 | 2 | 3 };
  supsds?: string;
  alt?: string;
  /** hardware in an ATTACHING PARTS block for this item */
  attachingFor?: string;
  /** a stable key for the part's job ("lining", "tieBolt"): lets puzzles find a row */
  tag?: string;
  /** effectivity evaluated for this aircraft (S/N and SB status) */
  applies: boolean;
};

export type ArtShape =
  | 'tire' | 'wheelHalf' | 'disc' | 'bearing' | 'seal' | 'ring' | 'bolt' | 'nut' | 'washer' | 'plate'
  | 'lining' | 'cylinder' | 'hub' | 'blade' | 'spinner' | 'bulkhead' | 'tray' | 'radio' | 'connector'
  | 'motor' | 'reservoir' | 'pump' | 'valve' | 'filter' | 'cap' | 'pulley' | 'belt' | 'fan'
  | 'bracket' | 'screw' | 'cable' | 'pin' | 'clamp' | 'box';

/** one drawn part in the exploded view; box in a 0..1 frame, centre (x, y) */
export type ArtItem = { item: string; shape: ArtShape; x: number; y: number; w: number; h: number };

export type IpcFigure = {
  ata: AnyAta;
  /** chapter-section-subject of the figure, e.g. "32-40-00" */
  chapter: string;
  fig: number;
  title: string;
  catalog: string;
  effCodes: { code: string; text: string; applies: boolean }[];
  rows: IpcRow[];
  art: ArtItem[];
  /** exploded-view axis: parts spread along it */
  axis: 'x' | 'y';
  notes: string[];
};

// ---------------------------------------------------------------------------
// Type data (one type certificate per island model)
// ---------------------------------------------------------------------------

export const MAKER = 'Iverson-Cole Aircraft Co.';

/** vendor CAGE codes printed after the nomenclature, "(V33214)" */
export const VENDORS = {
  clearwater: { name: 'Clearwater Wheel & Brake', cage: 'V33214' },
  beaumont: { name: 'Beaumont Propeller Co.', cage: 'V73551' },
  delmar: { name: 'Delmar Hydraulics', cage: 'V81140' },
  tern: { name: 'Tern Avionics', cage: 'V2T018' },
  halden: { name: 'Halden Electric', cage: 'V60213' },
  oceangrip: { name: 'Ocean-Grip Tire', cage: 'V4GT12' },
} as const;

type Spec = {
  model: PlaneModel;
  designation: string;
  /** manual family, "IC-310" (MM / IPC titles, log refs) */
  family: string;
  /** SB number prefix, "IC310" */
  sbPrefix: string;
  typeCert: string;
  description: string;
  snPrefix: string;
  snDigits: number;
  snMax: number;
  years: [number, number];
  engineMaker: string;
  engineModel: string;
  engineCount: number;
  tbo: number;
  meter: 'Tach' | 'Hobbs';
  propHub: string;
  propBlades: string;
  bladeCount: number;
  /** hours flown per year on the island (charter / freight) */
  util: [number, number];
  /** airframe TT when the current logbook was opened */
  ttStart: [number, number];
  spanYears: number;
  inspection: '100hr' | 'phase';
  ifr: boolean;
  /** part-number family code for vendor parts on this type */
  k: number;
  /** OEM drawing-number prefix */
  fam: string;
  tire: { size: string; ply: number; psi: number };
  /** S/N effectivity breakpoint per figure: code A = below, B = this S/N and on */
  brk: Record<Ata, number>;
  figs: Record<Ata, number>;
  /** what the hydraulic power pack drives */
  hydraulics: string;
};

const SPECS: Record<PlaneModel, Spec> = {
  twin: {
    model: 'twin',
    designation: 'IC-310R',
    family: 'IC-310',
    sbPrefix: 'IC310',
    typeCert: 'A21IC',
    description: '6-seat piston twin, retractable gear',
    snPrefix: '310R',
    snDigits: 4,
    snMax: 1180,
    years: [1978, 1996],
    engineMaker: 'Brandt Aero Engines',
    engineModel: 'BIO-520-MB',
    engineCount: 2,
    tbo: 1700,
    meter: 'Tach',
    propHub: 'BHC-C3YF-2UF',
    propBlades: 'FC7663DB-2R',
    bladeCount: 3,
    util: [360, 480],
    ttStart: [3400, 7200],
    spanYears: 4,
    inspection: '100hr',
    ifr: true,
    k: 19,
    fam: '31',
    tire: { size: '6.50-10', ply: 8, psi: 55 },
    brk: { '32-40': 520, '61-10': 300, '29-10': 760, '23-10': 640, '24-30': 410 },
    figs: { '29-10': 9, '23-10': 5, '24-30': 7, '32-40': 12, '61-10': 44 },
    hydraulics: 'landing gear',
  },
  cargo: {
    model: 'cargo',
    designation: 'IC-208C',
    family: 'IC-208',
    sbPrefix: 'IC208',
    typeCert: 'A44IC',
    description: 'turbine cargo single, retractable gear',
    snPrefix: '208C',
    snDigits: 5,
    snMax: 860,
    years: [1999, 2016],
    engineMaker: 'Norwell Turbine',
    engineModel: 'NT6A-114A',
    engineCount: 1,
    tbo: 3600,
    meter: 'Hobbs',
    propHub: 'BHC-B3TN-3D',
    propBlades: 'T10282NS+4',
    bladeCount: 3,
    util: [520, 680],
    ttStart: [5200, 11800],
    spanYears: 3,
    inspection: 'phase',
    ifr: true,
    k: 22,
    fam: '28',
    tire: { size: '8.50-10', ply: 10, psi: 65 },
    brk: { '32-40': 310, '61-10': 450, '29-10': 220, '23-10': 520, '24-30': 380 },
    figs: { '29-10': 14, '23-10': 6, '24-30': 11, '32-40': 21, '61-10': 52 },
    hydraulics: 'landing gear',
  },
  float: {
    model: 'float',
    designation: 'IC-185F',
    family: 'IC-185',
    sbPrefix: 'IC185',
    typeCert: 'A13IC',
    description: 'amphibian floatplane, 6 seats',
    snPrefix: '185F',
    snDigits: 4,
    snMax: 1420,
    years: [1981, 2004],
    engineMaker: 'Brandt Aero Engines',
    engineModel: 'BIO-520-D',
    engineCount: 1,
    tbo: 1700,
    meter: 'Tach',
    propHub: 'BHC-C3YF-1BF',
    propBlades: 'F8468A-6R',
    bladeCount: 3,
    util: [240, 360],
    ttStart: [2600, 6200],
    spanYears: 5,
    inspection: '100hr',
    ifr: false,
    k: 12,
    fam: '18',
    tire: { size: '5.00-5', ply: 6, psi: 40 },
    brk: { '32-40': 700, '61-10': 560, '29-10': 900, '23-10': 1010, '24-30': 480 },
    figs: { '29-10': 8, '23-10': 4, '24-30': 6, '32-40': 15, '61-10': 38 },
    hydraulics: 'amphibious float gear',
  },
};

export const specOf = (model: PlaneModel) => SPECS[model];
export function planeModel(model: string): PlaneModel {
  return model === 'cargo' || model === 'float' ? model : 'twin';
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const DAY_MS = 86400000;
export const dayOf = (iso: string) => Math.round(Date.parse(iso + 'T00:00:00Z') / DAY_MS);
export const isoOf = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);
/** logbook style, "03/14/2023" */
export function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
}
const r1 = (n: number) => Math.round(n * 10) / 10;
const hrs = (n: number) => n.toFixed(1);
const pad = (n: number, w: number) => String(n).padStart(w, '0');

export function serialOf(model: PlaneModel, n: number): string {
  const s = SPECS[model];
  return s.snPrefix + pad(n, s.snDigits);
}

export const fmtTorque = (t: { lo: number; hi: number; unit: string }) => `${t.lo}–${t.hi} ${t.unit}`;

const FIRST = ['Dana', 'Luis', 'Marisol', 'Tomas', 'Keoni', 'Priya', 'Walt', 'Renee', 'Ibrahim', 'Colette', 'Ansel', 'Jonah', 'Mika', 'Tavita', 'Rosa', 'Grant', 'Noelani', 'Emeka'];
const LAST = ['Okafor', 'Delacroix', 'Kealoha', 'Brennan', 'Tan', 'Moreau', 'Vasquez', 'Lindqvist', 'Palakiko', 'Hendricks', 'Quon', 'Adeyemi', 'Sorensen', 'Iwasaki', 'Fairweather', 'Mahoe', 'Castellano', 'Ruiz'];
const SHOPS = ['Harbor Aero Services', 'Leeward Aviation', 'Tradewind Aircraft Maintenance', 'Reef Air Repair'];
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // N-numbers never use I or O
const letter = (r: Rng) => LETTERS[r.int(0, LETTERS.length - 1)];

function mechanic(r: Rng, ia: boolean): Signer {
  const name = `${r.pick(FIRST)} ${r.pick(LAST)}`;
  return { name, cert: String(r.int(2100000, 3899999)), kind: ia ? 'A&P/IA' : 'A&P' };
}

function station(r: Rng): Signer {
  const shop = r.pick(SHOPS);
  const cert = `${letter(r)}${letter(r)}${letter(r)}R${r.int(100, 999)}${letter(r)}`;
  return { name: `${r.pick(FIRST)} ${r.pick(LAST)}`, cert, kind: 'CRS', shop };
}

export function signatureOf(s: Signer): string {
  const [f, ...l] = s.name.split(' ');
  const short = `${f[0]}. ${l.join(' ')}`;
  if (s.kind === 'CRS') return `/s/ ${short} for ${s.shop}, CRS ${s.cert}`;
  return `/s/ ${short}  A&P ${s.cert}${s.kind === 'A&P/IA' ? ' IA' : ''}`;
}

function registrationOf(r: Rng, model: PlaneModel): string {
  // the twin's tail number is where the island's name for it ("Twin N-12") came from
  if (model === 'twin') return `N12${letter(r)}${letter(r)}`;
  if (model === 'cargo') return `N${r.int(100, 999)}${letter(r)}${letter(r)}`;
  return `N${r.int(1000, 9999)}${r.chance(0.5) ? letter(r) : ''}`;
}

// ---------------------------------------------------------------------------
// Illustrated Parts Catalog
// ---------------------------------------------------------------------------

/** configuration a figure is printed for: S/N side of the breakpoint and SB status */
type Env = { snB: boolean; postSb: boolean };

/** the service bulletin that splits each figure's effectivity into PRE / POST (codes D / C) */
export function figSb(model: PlaneModel, ata: Ata): { id: string; title: string } {
  const s = SPECS[model];
  switch (ata) {
    case '32-40':
      return { id: `SB ${s.sbPrefix}-32-07`, title: 'Main wheel brakes: heavy-duty linings with new back plates' };
    case '61-10':
      return { id: `Beaumont SB ${200 + s.k}`, title: 'Propeller mounting bolts: improved-fatigue bolt' };
    case '29-10':
      return { id: `SB ${s.sbPrefix}-29-03`, title: 'Hydraulic power pack: vented reservoir filler cap' };
    case '23-10':
      return { id: `SB ${s.sbPrefix}-23-02`, title: 'VHF com: 8.33 kHz transceiver TR-155-02' };
    case '24-30':
      return model === 'cargo'
        ? { id: `Halden SB HSG-${s.k}`, title: 'Starter-generator: long-life brush set' }
        : { id: `Halden SB HA-${s.k + 2}`, title: 'Alternator: improved pulley nut and rectifier' };
  }
}

type R = {
  item: string;
  pn: string;
  ind: number;
  nomen: string;
  upa: IpcRow['upa'];
  eff?: string;
  v?: string;
  /** not procurable: what to order instead */
  np?: string;
  sup?: [string, 1 | 2 | 3];
  sups?: string;
  alt?: string;
  att?: string;
  tag?: string;
  shape?: ArtShape;
  /** exploded-view order along the axis (default: catalog order) */
  ord?: number;
  /** hardware: draw it next to this item */
  near?: string;
  note?: string;
};

function effOk(eff: string, env: Env): boolean {
  for (const c of eff) {
    if (c === 'A' && env.snB) return false;
    if (c === 'B' && !env.snB) return false;
    if (c === 'C' && !env.postSb) return false;
    if (c === 'D' && env.postSb) return false;
  }
  return true;
}

function rowFrom(x: R, env: Env): IpcRow {
  const notes: string[] = [];
  if (x.np) notes.push(`NP — ${x.np}`);
  if (x.sup) notes.push(`SUPSD BY ${x.sup[0]} (INTCHG CODE ${x.sup[1]})`);
  if (x.sups) notes.push(`SUPSDS ${x.sups}`);
  if (x.alt) notes.push(`ALT FOR ${x.alt}`);
  if (x.note) notes.push(x.note);
  const row: IpcRow = {
    item: x.item,
    pn: x.pn,
    indent: x.ind,
    nomen: x.nomen,
    text: '. '.repeat(x.ind) + x.nomen + (x.v ? ` (${x.v})` : ''),
    eff: x.eff ?? '',
    upa: x.upa,
    notes,
    applies: effOk(x.eff ?? '', env),
  };
  if (x.v) row.vendor = x.v;
  if (x.np) row.np = true;
  if (x.sup) row.supsdBy = { pn: x.sup[0], code: x.sup[1] };
  if (x.sups) row.supsds = x.sups;
  if (x.alt) row.alt = x.alt;
  if (x.att) row.attachingFor = x.att;
  if (x.tag) row.tag = x.tag;
  return row;
}

const ART_SIZE: Record<ArtShape, [number, number]> = {
  tire: [0.15, 0.9], wheelHalf: [0.07, 0.66], disc: [0.03, 0.6], bearing: [0.05, 0.24], seal: [0.02, 0.3],
  ring: [0.015, 0.32], bolt: [0.1, 0.04], nut: [0.035, 0.06], washer: [0.012, 0.07], plate: [0.03, 0.36],
  lining: [0.03, 0.3], cylinder: [0.08, 0.3], hub: [0.16, 0.36], blade: [0.08, 0.9], spinner: [0.14, 0.44],
  bulkhead: [0.03, 0.5], tray: [0.26, 0.34], radio: [0.24, 0.28], connector: [0.05, 0.12], motor: [0.16, 0.3],
  reservoir: [0.16, 0.36], pump: [0.1, 0.2], valve: [0.06, 0.1], filter: [0.05, 0.2], cap: [0.06, 0.06],
  pulley: [0.04, 0.3], belt: [0.05, 0.5], fan: [0.03, 0.4], bracket: [0.09, 0.16], screw: [0.06, 0.03],
  cable: [0.22, 0.05], pin: [0.04, 0.02], clamp: [0.04, 0.34], box: [0.1, 0.1],
};
const SMALL = new Set<ArtShape>(['bolt', 'nut', 'washer', 'screw', 'pin', 'connector', 'valve', 'cap', 'box', 'cable']);

/**
 * Exploded view along x: the big parts on the centre line in assembly order,
 * spaced by their own widths; hardware above / below the part it attaches to.
 */
function artFrom(list: R[]): ArtItem[] {
  const round = (v: number) => Math.round(v * 1000) / 1000;
  const drawn = list.filter((x) => x.shape && /^\d+$/.test(x.item));
  const main = drawn
    .filter((x) => !SMALL.has(x.shape!))
    .map((x, i) => ({ x, ord: x.ord ?? i }))
    .sort((a, b) => a.ord - b.ord);
  const gap = 0.025;
  const total = main.reduce((n, m) => n + ART_SIZE[m.x.shape!][0], 0) + gap * Math.max(0, main.length - 1);
  const k = Math.min(1, 0.9 / total);
  let cur = 0.05 + (0.9 - total * k) / 2;
  const at = new Map<string, number>();
  const art: ArtItem[] = [];
  for (const { x: d } of main) {
    const [w, h] = ART_SIZE[d.shape!];
    const cx = cur + (w * k) / 2;
    at.set(d.item, cx);
    art.push({ item: d.item, shape: d.shape!, x: round(cx), y: 0.5, w: round(w * k), h });
    cur += (w + gap) * k;
  }
  // hardware alternates above / below its part; slide along the row until it has room for its callout
  const count = new Map<string, number>();
  const rows: Record<string, number[]> = { top: [], bottom: [] };
  let prev = main[0]?.x.item ?? '';
  for (const d of drawn) {
    if (!SMALL.has(d.shape!)) {
      prev = d.item;
      continue;
    }
    const anchor = d.near ?? (d.att && at.has(d.att) ? d.att : prev);
    const n = count.get(anchor) ?? 0;
    count.set(anchor, n + 1);
    const row = n % 2 ? rows.bottom : rows.top;
    let x = Math.max(0.04, Math.min(0.96, at.get(anchor) ?? 0.5));
    for (let tries = 0; tries < 24 && row.some((o) => Math.abs(o - x) < 0.07); tries++) x = x + 0.07 > 0.96 ? 0.04 + (tries % 3) * 0.02 : x + 0.07;
    row.push(x);
    const [w, h] = ART_SIZE[d.shape!];
    art.push({ item: d.item, shape: d.shape!, x: round(x), y: n % 2 ? 0.86 : 0.14, w, h });
  }
  return art;
}

const FIG_NOTES = [
  'ITEMS NOT ILLUSTRATED ARE PRECEDED BY A DASH (-).',
  'NP = NOT PROCURABLE SEPARATELY: ORDER THE NEXT HIGHER ASSEMBLY.',
  'INTCHG CODE 1 = TWO-WAY, 2 = ONE-WAY (NEW FOR OLD ONLY), 3 = AS A SET / AFTER SB ONLY.',
  'PARTS INSTALLED BY STC OR FIELD APPROVAL (FAA FORM 337) ARE NOT COVERED BY THIS CATALOG. REFER TO THE ICA FOR THE ALTERATION.',
];

function figure(model: PlaneModel, ata: Ata, env: Env, title: string, list: R[]): IpcFigure {
  const s = SPECS[model];
  const sb = figSb(model, ata);
  const brk = s.brk[ata];
  return {
    ata,
    chapter: `${ata}-00`,
    fig: s.figs[ata],
    title,
    catalog: `${s.family} ILLUSTRATED PARTS CATALOG`,
    effCodes: [
      { code: 'A', text: `S/N ${serialOf(model, 1)} THRU ${serialOf(model, brk - 1)}`, applies: !env.snB },
      { code: 'B', text: `S/N ${serialOf(model, brk)} AND ON`, applies: env.snB },
      { code: 'C', text: `POST ${sb.id}`, applies: env.postSb },
      { code: 'D', text: `PRE ${sb.id}`, applies: !env.postSb },
    ],
    rows: list.map((x) => rowFrom(x, env)),
    art: artFrom(list),
    axis: 'x',
    notes: FIG_NOTES,
  };
}

const CW = VENDORS.clearwater.cage;
const BP = VENDORS.beaumont.cage;

function fig3240(model: PlaneModel, env: Env): IpcFigure {
  const { k, fam, tire } = SPECS[model];
  const tc = tire.size.replace(/[.-]/g, '');
  const brakeA = `30-${k + 64}A`;
  const brakeB = `30-${k + 64}B`;
  const list: R[] = [
    { item: '1', pn: `05${fam}200-5`, ind: 0, nomen: 'WHEEL AND BRAKE INSTL, MAIN', upa: 'RF', note: model === 'float' ? 'MAIN WHEELS IN FLOATS, LH AND RH' : 'LH AND RH' },
    { item: '2', pn: `40-${k}0A`, ind: 1, nomen: 'WHEEL ASSY', upa: 1, v: CW, eff: 'A', tag: 'wheel' },
    { item: '2A', pn: `40-${k}0B`, ind: 1, nomen: 'WHEEL ASSY', upa: 1, v: CW, eff: 'B', tag: 'wheel' },
    { item: '3', pn: `103-0${k}00`, ind: 2, nomen: 'BOLT, TIE', upa: 6, v: CW, tag: 'tieBolt', shape: 'bolt', near: '7' },
    { item: '4', pn: 'AN960-516', ind: 2, nomen: 'WASHER', upa: 12, shape: 'washer', near: '7' },
    { item: '5', pn: `095-0${k}20`, ind: 2, nomen: 'NUT, SELF-LOCKING, TIE BOLT', upa: 6, v: CW, tag: 'tieNut', shape: 'nut', near: '6' },
    { item: '6', pn: `161-0${k}50`, ind: 2, nomen: 'WHEEL HALF, OUTER', upa: 1, v: CW, np: 'ORDER ITEM 2 OR 2A', tag: 'halfOuter', shape: 'wheelHalf', ord: 2 },
    { item: '7', pn: `162-0${k}50`, ind: 2, nomen: 'WHEEL HALF, INNER', upa: 1, v: CW, np: 'ORDER ITEM 2 OR 2A', tag: 'halfInner', shape: 'wheelHalf', ord: 5 },
    { item: '8', pn: `214-0${k}10`, ind: 2, nomen: 'CONE, BEARING', upa: 2, v: CW, tag: 'bearing', shape: 'bearing', ord: 1 },
    { item: '9', pn: `213-0${k}10`, ind: 2, nomen: 'CUP, BEARING', upa: 2, v: CW, tag: 'cup' },
    { item: '10', pn: `154-0${k}00`, ind: 2, nomen: 'SEAL, GREASE', upa: 2, v: CW, sup: [`154-0${k}01`, 1], tag: 'seal', shape: 'seal', ord: 6 },
    { item: '10A', pn: `154-0${k}01`, ind: 2, nomen: 'SEAL, GREASE', upa: 2, v: CW, sups: `154-0${k}00`, tag: 'seal' },
    { item: '11', pn: `069-0${k}05`, ind: 2, nomen: 'RING, SEAL RETAINING', upa: 2, v: CW, shape: 'ring', ord: 7 },
    { item: '12', pn: `164-0${k}00`, ind: 2, nomen: 'DISC, BRAKE', upa: 1, v: CW, eff: 'A', tag: 'disc', shape: 'disc', ord: 10 },
    { item: '12A', pn: `164-0${k}50`, ind: 2, nomen: 'DISC, BRAKE (0.345 IN)', upa: 1, v: CW, eff: 'B', tag: 'disc' },
    { item: '13', pn: `OG-${tc}-${tire.ply}`, ind: 1, nomen: `TIRE, ${tire.size}, ${tire.ply} PLY, TUBE TYPE`, upa: 1, v: VENDORS.oceangrip.cage, tag: 'tire', shape: 'tire', ord: 3 },
    { item: '13A', pn: `SW-${tc}-${tire.ply}`, ind: 1, nomen: `TIRE, ${tire.size}, ${tire.ply} PLY, TUBE TYPE`, upa: 1, alt: `OG-${tc}-${tire.ply}`, tag: 'tire' },
    { item: '14', pn: `OG-T${tc}`, ind: 1, nomen: `TUBE, ${tire.size}`, upa: 1, v: VENDORS.oceangrip.cage, tag: 'tube', shape: 'ring', ord: 4 },
    { item: '15', pn: brakeA, ind: 1, nomen: 'BRAKE ASSY', upa: 1, v: CW, eff: 'D', sup: [brakeB, 3], tag: 'brake' },
    { item: '15A', pn: brakeB, ind: 1, nomen: 'BRAKE ASSY, HEAVY DUTY', upa: 1, v: CW, eff: 'C', sups: brakeA, tag: 'brake' },
    { item: '16', pn: `10-${k}400`, ind: 2, nomen: 'CYLINDER ASSY', upa: 1, v: CW, shape: 'cylinder', ord: 13 },
    { item: '17', pn: `071-0${k}30`, ind: 3, nomen: 'PISTON', upa: 1, v: CW, shape: 'plate', ord: 12 },
    { item: '18', pn: 'MS28775-227', ind: 3, nomen: 'O-RING', upa: 1, tag: 'pistonOring' },
    { item: '19', pn: '079-00200', ind: 3, nomen: 'SCREW, BLEEDER', upa: 1, v: CW, shape: 'screw', near: '16' },
    { item: '20', pn: `080-${k}100`, ind: 2, nomen: 'PLATE, PRESSURE', upa: 1, v: CW, shape: 'plate', ord: 11 },
    { item: '21', pn: `066-${k}500`, ind: 2, nomen: 'LINING', upa: 2, v: CW, eff: 'D', sup: [`066-${k}600`, 3], tag: 'lining', note: `REPLACE AS A SET WITH ITEM 23A PER ${figSb(model, '32-40').id}`, shape: 'lining', ord: 9 },
    { item: '21A', pn: `066-${k}600`, ind: 2, nomen: 'LINING, HEAVY DUTY (METALLIC)', upa: 2, v: CW, eff: 'C', sups: `066-${k}500`, tag: 'lining' },
    { item: '22', pn: '105-00500', ind: 3, nomen: 'RIVET, LINING', upa: 4, v: CW, tag: 'rivet', shape: 'pin', near: '21' },
    { item: '23', pn: `069-${k}400`, ind: 2, nomen: 'PLATE, BACK', upa: 1, v: CW, eff: 'D', tag: 'backPlate', shape: 'plate', ord: 8 },
    { item: '23A', pn: `069-${k}450`, ind: 2, nomen: 'PLATE, BACK', upa: 1, v: CW, eff: 'C', tag: 'backPlate' },
    { item: '24', pn: `069-${k}800`, ind: 2, nomen: 'BOLT, ANCHOR', upa: 2, v: CW, np: 'ORDER KIT, ITEM -25', tag: 'anchorBolt', shape: 'pin', near: '16' },
    { item: '-25', pn: `199-${k}100`, ind: 2, nomen: 'KIT, ANCHOR BOLT (INCLUDES ITEM 24)', upa: 1, v: CW },
    { item: '26', pn: `103-${k}050`, ind: 1, nomen: 'BOLT, BACK PLATE', upa: 4, v: CW, att: '15', tag: 'backPlateBolt', shape: 'bolt', near: '23' },
    { item: '27', pn: 'AN960-516L', ind: 1, nomen: 'WASHER', upa: 4, att: '15', shape: 'washer', near: '23' },
    { item: '28', pn: `05${fam}112-1`, ind: 1, nomen: 'NUT, AXLE', upa: 1, att: '2', tag: 'axleNut', shape: 'nut', near: '8' },
    { item: '29', pn: 'MS24665-302', ind: 1, nomen: 'PIN, COTTER', upa: 1, att: '2', tag: 'cotter', shape: 'pin', near: '8' },
    { item: '30', pn: `05${fam}201-1`, ind: 1, nomen: 'CAP, HUB', upa: 1, shape: 'cap', near: '8' },
  ];
  return figure(model, '32-40', env, 'MAIN WHEEL AND BRAKE ASSEMBLY', list);
}

function fig6110(model: PlaneModel, env: Env): IpcFigure {
  const { k, fam, propHub, propBlades, bladeCount } = SPECS[model];
  const twin = model === 'twin';
  const turbine = model === 'cargo';
  const list: R[] = [
    { item: '1', pn: `05${fam}500-3`, ind: 0, nomen: 'PROPELLER INSTL', upa: 'RF', note: twin ? 'LH AND RH ENGINE' : undefined },
    { item: '2', pn: propHub + '/' + propBlades.replace(/\+.*$/, ''), ind: 1, nomen: `PROPELLER ASSY, ${bladeCount} BLADE${turbine ? ', REVERSING' : twin ? ', FULL FEATHERING' : ''}`, upa: 1, v: BP, tag: 'propeller' },
    { item: '3', pn: `B-${k}610`, ind: 2, nomen: 'HUB UNIT', upa: 1, v: BP, np: 'OVERHAUL ITEM: ORDER ITEM 2 OR EXCHANGE', shape: 'hub', ord: 4 },
    { item: '4', pn: propBlades, ind: 2, nomen: 'BLADE', upa: bladeCount, v: BP, tag: 'blade', shape: 'blade', ord: 5 },
    { item: '5', pn: `B-${k}640`, ind: 2, nomen: turbine ? 'RING, BETA FEEDBACK' : 'CYLINDER, PITCH CHANGE', upa: 1, v: BP, shape: turbine ? 'ring' : 'cylinder', ord: 3 },
    { item: '6', pn: `05${fam}231-3`, ind: 1, nomen: 'SPINNER ASSY', upa: 1, tag: 'spinner' },
    { item: '7', pn: `05${fam}231-1`, ind: 2, nomen: 'DOME, SPINNER', upa: 1, shape: 'spinner', ord: 1 },
    { item: '8', pn: `05${fam}230-2`, ind: 2, nomen: 'BULKHEAD, FWD', upa: 1, eff: 'A', tag: 'bulkhead', shape: 'bulkhead', ord: 2 },
    { item: '8A', pn: `05${fam}230-6`, ind: 2, nomen: 'BULKHEAD, FWD', upa: 1, eff: 'B', tag: 'bulkhead' },
    { item: '9', pn: `05${fam}230-4`, ind: 2, nomen: 'BULKHEAD, AFT', upa: 1, shape: 'bulkhead', ord: 6 },
    { item: '10', pn: 'MS27039-0808', ind: 2, nomen: 'SCREW, SPINNER', upa: 12, tag: 'spinnerScrew', shape: 'screw', near: '7' },
    { item: '11', pn: 'NAS1149F0863P', ind: 2, nomen: 'WASHER', upa: 12, shape: 'washer', near: '7' },
    { item: '12', pn: `B-${k}413-1`, ind: 1, nomen: 'BOLT, PROPELLER MOUNTING', upa: 6, v: BP, eff: 'D', att: '2', sup: [`B-${k}413-3`, 2], tag: 'propBolt', shape: 'bolt', near: '14' },
    { item: '12A', pn: `B-${k}413-3`, ind: 1, nomen: 'BOLT, PROPELLER MOUNTING', upa: 6, v: BP, eff: 'C', att: '2', sups: `B-${k}413-1`, tag: 'propBolt' },
    { item: '13', pn: `B-${k}416`, ind: 1, nomen: 'WASHER, BOLT', upa: 6, v: BP, att: '2', shape: 'washer', near: '14' },
    { item: '14', pn: 'MS29513-238', ind: 1, nomen: 'O-RING, HUB TO FLANGE', upa: 1, att: '2', tag: 'hubOring', shape: 'seal', ord: 7 },
    { item: '15', pn: 'MS20995C32', ind: 1, nomen: 'WIRE, SAFETY, 0.032 IN', upa: 'AR', att: '2', tag: 'safetyWire' },
  ];
  return figure(model, '61-10', env, twin ? 'PROPELLER AND SPINNER INSTALLATION (TYPICAL LH AND RH)' : 'PROPELLER AND SPINNER INSTALLATION', list);
}

function fig2910(model: PlaneModel, env: Env): IpcFigure {
  const { k, fam, hydraulics } = SPECS[model];
  const DH = VENDORS.delmar.cage;
  const list: R[] = [
    { item: '1', pn: `05${fam}600-1`, ind: 0, nomen: `POWER PACK INSTL, HYDRAULIC (${hydraulics.toUpperCase()})`, upa: 'RF' },
    { item: '2', pn: `DH-${k}02-3`, ind: 1, nomen: 'POWER PACK ASSY, 28 VDC', upa: 1, v: DH, eff: 'A', tag: 'powerPack' },
    { item: '2A', pn: `DH-${k}02-5`, ind: 1, nomen: 'POWER PACK ASSY, 28 VDC', upa: 1, v: DH, eff: 'B', tag: 'powerPack' },
    { item: '3', pn: `DH-${k}10`, ind: 2, nomen: 'MOTOR, ELECTRIC', upa: 1, v: DH, tag: 'motor', shape: 'motor' },
    { item: '4', pn: `DH-${k}20`, ind: 2, nomen: 'PUMP, GEAR', upa: 1, v: DH, shape: 'pump' },
    { item: '5', pn: `DH-${k}30-2`, ind: 2, nomen: 'RESERVOIR', upa: 1, v: DH, tag: 'reservoir', shape: 'reservoir' },
    { item: '6', pn: `DH-${k}31`, ind: 3, nomen: 'CAP, FILLER', upa: 1, v: DH, eff: 'D', sup: [`DH-${k}31-1`, 2], tag: 'resCap', shape: 'cap' },
    { item: '6A', pn: `DH-${k}31-1`, ind: 3, nomen: 'CAP, FILLER, VENTED', upa: 1, v: DH, eff: 'C', sups: `DH-${k}31`, tag: 'resCap' },
    { item: '7', pn: 'MS29513-116', ind: 3, nomen: 'O-RING, FILLER CAP', upa: 1, tag: 'capOring' },
    { item: '8', pn: `DH-${k}32`, ind: 3, nomen: 'DIPSTICK', upa: 1, v: DH },
    { item: '9', pn: `DH-${k}40-10`, ind: 2, nomen: 'ELEMENT, FILTER, 10 MICRON', upa: 1, v: DH, sup: [`DH-${k}40-11`, 1], tag: 'filter', shape: 'filter' },
    { item: '9A', pn: `DH-${k}40-11`, ind: 2, nomen: 'ELEMENT, FILTER, 10 MICRON', upa: 1, v: DH, sups: `DH-${k}40-10`, tag: 'filter' },
    { item: '10', pn: 'MS28775-228', ind: 2, nomen: 'O-RING, FILTER BOWL', upa: 1, tag: 'bowlOring', shape: 'seal' },
    { item: '11', pn: `DH-${k}50`, ind: 2, nomen: 'VALVE, RELIEF (FACTORY SET)', upa: 1, v: DH, np: 'ORDER ITEM 2 OR 2A', shape: 'valve' },
    { item: '12', pn: `DH-${k}60`, ind: 2, nomen: 'SWITCH, PRESSURE', upa: 1, v: DH, tag: 'pressureSwitch', shape: 'connector' },
    { item: '13', pn: `DH-${k}70`, ind: 2, nomen: 'VALVE, SELECTOR, SOLENOID', upa: 1, v: DH, shape: 'valve' },
    { item: '-14', pn: 'MS28778-6', ind: 2, nomen: 'PACKING, BOSS', upa: 4 },
    { item: '15', pn: 'AN4-5A', ind: 1, nomen: 'BOLT', upa: 4, att: '2', tag: 'mountBolt', shape: 'bolt', near: '18' },
    { item: '16', pn: 'AN960-416', ind: 1, nomen: 'WASHER', upa: 8, att: '2', shape: 'washer', near: '18' },
    { item: '17', pn: 'MS21042L4', ind: 1, nomen: 'NUT, SELF-LOCKING', upa: 4, att: '2', shape: 'nut', near: '18' },
    { item: '18', pn: `05${fam}615-1`, ind: 1, nomen: 'ISOLATOR, SHOCK MOUNT', upa: 4, att: '2', shape: 'ring' },
  ];
  return figure(model, '29-10', env, 'HYDRAULIC POWER PACK INSTALLATION', list);
}

function fig2310(model: PlaneModel, env: Env): IpcFigure {
  const { fam } = SPECS[model];
  const TN = VENDORS.tern.cage;
  const list: R[] = [
    { item: '1', pn: `05${fam}700-7`, ind: 0, nomen: 'VHF COM INSTL', upa: 'RF' },
    { item: '2', pn: 'TR-155-01', ind: 1, nomen: 'TRANSCEIVER, VHF COM, 25 KHZ', upa: 1, v: TN, eff: 'D', sup: ['TR-155-02', 2], tag: 'radio', shape: 'radio' },
    { item: '2A', pn: 'TR-155-02', ind: 1, nomen: 'TRANSCEIVER, VHF COM, 8.33/25 KHZ', upa: 1, v: TN, eff: 'C', sups: 'TR-155-01', tag: 'radio' },
    { item: '3', pn: 'TR-155-MT', ind: 1, nomen: 'TRAY, MOUNTING', upa: 1, v: TN, eff: 'A', tag: 'tray', shape: 'tray' },
    { item: '3A', pn: 'TR-155-MT2', ind: 1, nomen: 'TRAY, MOUNTING', upa: 1, v: TN, eff: 'B', tag: 'tray' },
    { item: '4', pn: 'TR-155-CK', ind: 2, nomen: 'CONNECTOR KIT, 25 PIN', upa: 1, v: TN, tag: 'connector', shape: 'connector' },
    { item: '5', pn: 'TR-155-LS', ind: 2, nomen: 'SCREW, CAM LOCK', upa: 1, v: TN, tag: 'lockScrew', shape: 'screw' },
    { item: '6', pn: 'TR-155-BP', ind: 2, nomen: 'BACKPLATE', upa: 1, v: TN, np: 'ORDER ITEM 3 OR 3A', shape: 'plate' },
    { item: '7', pn: 'TR-155-RL', ind: 2, nomen: 'RAIL, GUIDE', upa: 2, v: TN },
    { item: '8', pn: `05${fam}720-3`, ind: 1, nomen: 'CABLE ASSY, ANTENNA (COAX)', upa: 1, tag: 'coax', shape: 'cable' },
    { item: '-9', pn: 'UG-88/U', ind: 2, nomen: 'CONNECTOR, BNC', upa: 2 },
    { item: '10', pn: `05${fam}730-5`, ind: 1, nomen: 'CIRCUIT BREAKER, 5 A (COM)', upa: 1, tag: 'breaker', shape: 'box' },
    { item: '11', pn: 'MS24693-C274', ind: 1, nomen: 'SCREW', upa: 4, att: '3', shape: 'screw' },
    { item: '12', pn: 'AN960C6L', ind: 1, nomen: 'WASHER', upa: 4, att: '3' },
    { item: '13', pn: 'MS21042L06', ind: 1, nomen: 'NUT, SELF-LOCKING', upa: 4, att: '3', shape: 'nut' },
  ];
  return figure(model, '23-10', env, 'VHF COMMUNICATION TRANSCEIVER INSTALLATION', list);
}

function fig2430(model: PlaneModel, env: Env): IpcFigure {
  const { k, fam } = SPECS[model];
  const HE = VENDORS.halden.cage;
  if (model === 'cargo') {
    const list: R[] = [
      { item: '1', pn: `05${fam}300-5`, ind: 0, nomen: 'STARTER-GENERATOR INSTL', upa: 'RF' },
      { item: '2', pn: 'HSG-250-3', ind: 1, nomen: 'STARTER-GENERATOR, 28 V 250 A', upa: 1, v: HE, eff: 'D', sup: ['HSG-250-5', 2], tag: 'generator', shape: 'motor' },
      { item: '2A', pn: 'HSG-250-5', ind: 1, nomen: 'STARTER-GENERATOR, 28 V 250 A', upa: 1, v: HE, eff: 'C', sups: 'HSG-250-3', tag: 'generator' },
      { item: '3', pn: 'HSG-250-BS', ind: 2, nomen: 'BRUSH SET', upa: 1, v: HE, tag: 'brushes', shape: 'box', near: '2' },
      { item: '4', pn: 'HSG-250-SS', ind: 2, nomen: 'SHAFT, DRIVE (SHEAR SECTION)', upa: 1, v: HE, np: 'ORDER ITEM 2 OR 2A (OVERHAUL)', tag: 'shaft', shape: 'pin', near: '2' },
      { item: '5', pn: 'HSG-250-FN', ind: 2, nomen: 'FAN, COOLING', upa: 1, v: HE, shape: 'fan' },
      { item: '6', pn: `HSG-QAD-${k}`, ind: 1, nomen: 'ADAPTER, QUICK ATTACH (QAD)', upa: 1, v: HE, eff: 'A', tag: 'qad', shape: 'plate' },
      { item: '6A', pn: `HSG-QAD-${k}B`, ind: 1, nomen: 'ADAPTER, QUICK ATTACH (QAD)', upa: 1, v: HE, eff: 'B', tag: 'qad' },
      { item: '7', pn: `HSG-VB-${k}`, ind: 1, nomen: 'CLAMP, V-BAND', upa: 1, v: HE, tag: 'vband', shape: 'clamp' },
      { item: '8', pn: `HSG-G${k}`, ind: 1, nomen: 'GASKET', upa: 1, v: HE, shape: 'seal' },
      { item: '9', pn: `05${fam}330-2`, ind: 1, nomen: 'DUCT, COOLING AIR', upa: 1, shape: 'cable' },
      { item: '-10', pn: 'MS35842-12', ind: 1, nomen: 'CLAMP, HOSE', upa: 2 },
      { item: '11', pn: 'MS21042L5', ind: 1, nomen: 'NUT, SELF-LOCKING', upa: 6, att: '6', tag: 'qadNut', shape: 'nut' },
      { item: '12', pn: 'AN960-516', ind: 1, nomen: 'WASHER', upa: 6, att: '6', shape: 'washer' },
    ];
    return figure(model, '24-30', env, 'STARTER-GENERATOR INSTALLATION', list);
  }
  const list: R[] = [
    { item: '1', pn: `05${fam}300-3`, ind: 0, nomen: 'ALTERNATOR INSTL', upa: 'RF', note: model === 'twin' ? 'LH AND RH ENGINE' : undefined },
    { item: '2', pn: `HA-24${k}-2`, ind: 1, nomen: 'ALTERNATOR, 28 V 70 A', upa: 1, v: HE, eff: 'D', sup: [`HA-24${k}-4`, 2], tag: 'generator', shape: 'motor' },
    { item: '2A', pn: `HA-24${k}-4`, ind: 1, nomen: 'ALTERNATOR, 28 V 70 A', upa: 1, v: HE, eff: 'C', sups: `HA-24${k}-2`, tag: 'generator' },
    { item: '3', pn: `HA-24${k}-P`, ind: 2, nomen: 'PULLEY', upa: 1, v: HE, shape: 'pulley' },
    { item: '4', pn: `HA-24${k}-F`, ind: 2, nomen: 'FAN', upa: 1, v: HE, shape: 'fan' },
    { item: '5', pn: `HA-24${k}-N`, ind: 2, nomen: 'NUT, PULLEY', upa: 1, v: HE, tag: 'pulleyNut', shape: 'nut' },
    { item: '6', pn: `HA-24${k}-B`, ind: 2, nomen: 'BRUSH ASSY', upa: 1, v: HE, tag: 'brushes', shape: 'box', near: '2' },
    { item: '7', pn: `HA-24${k}-R`, ind: 2, nomen: 'RECTIFIER', upa: 1, v: HE, np: 'ORDER ITEM 2 OR 2A', tag: 'rectifier', shape: 'box', near: '2' },
    { item: '8', pn: `HA-B${k + 19}`, ind: 1, nomen: 'BELT, V', upa: 1, v: HE, tag: 'belt', shape: 'belt' },
    { item: '8A', pn: `B${k + 19}-AX`, ind: 1, nomen: 'BELT, V', upa: 1, alt: `HA-B${k + 19}`, tag: 'belt' },
    { item: '9', pn: `05${fam}310-1`, ind: 1, nomen: 'ARM, ADJUSTING', upa: 1, eff: 'A', tag: 'arm', shape: 'bracket' },
    { item: '9A', pn: `05${fam}310-3`, ind: 1, nomen: 'ARM, ADJUSTING', upa: 1, eff: 'B', tag: 'arm' },
    { item: '10', pn: `05${fam}311-2`, ind: 1, nomen: 'BRACKET, MOUNTING', upa: 1, shape: 'bracket' },
    { item: '11', pn: 'AN5-21A', ind: 1, nomen: 'BOLT, PIVOT', upa: 1, att: '2', tag: 'pivotBolt', shape: 'bolt' },
    { item: '12', pn: 'AN4-7A', ind: 1, nomen: 'BOLT, ADJUSTING ARM', upa: 1, att: '2', tag: 'armBolt', shape: 'bolt' },
    { item: '13', pn: 'AN960-516', ind: 1, nomen: 'WASHER', upa: 2, att: '2', shape: 'washer' },
    { item: '14', pn: 'AN960-416', ind: 1, nomen: 'WASHER', upa: 2, att: '2' },
    { item: '15', pn: 'MS21042L5', ind: 1, nomen: 'NUT, SELF-LOCKING', upa: 1, att: '2', shape: 'nut' },
    { item: '16', pn: 'MS21042L4', ind: 1, nomen: 'NUT, SELF-LOCKING', upa: 1, att: '2' },
  ];
  return figure(model, '24-30', env, 'ALTERNATOR INSTALLATION', list);
}

function buildFigure(model: PlaneModel, ata: Ata, env: Env): IpcFigure {
  switch (ata) {
    case '32-40':
      return fig3240(model, env);
    case '61-10':
      return fig6110(model, env);
    case '29-10':
      return fig2910(model, env);
    case '23-10':
      return fig2310(model, env);
    case '24-30':
      return fig2430(model, env);
  }
}

/** figure numbers for 79-20, after each model's existing figures in ATA order (a test keeps them unique) */
const FIG_7920: Record<PlaneModel, number> = { twin: 58, cargo: 60, float: 46 };
/** Sentinel Filtration: the alternate oil filter's maker */
const SENTINEL = 'V5SF21';
/** Brandt Aero Engines, the piston engine maker (the oil filter carries its number) */
const BRANDT = 'V07BA1';

/**
 * Fig 79-20, the oil filter and drain. It matches what the logbooks already
 * record ("12 qt SAE J1899 20W-50 … filter P/N BAE-481k"; 11 qt on the float; the
 * turbine's phase entries check the level and the chip detector). One row per
 * item: no effectivity codes.
 */
function fig7920(model: PlaneModel): IpcFigure {
  const { k, fam, family } = SPECS[model];
  const env: Env = { snB: false, postSb: false };
  const list: R[] =
    model === 'cargo'
      ? [
          { item: '1', pn: `05${fam}900-5`, ind: 0, nomen: 'OIL SYSTEM INSTL', upa: 'RF' },
          { item: '2', pn: 'NT3031-14', ind: 1, nomen: 'ELEMENT, OIL FILTER', upa: 1, tag: 'oilElement', shape: 'filter' },
          { item: '3', pn: 'NT3031-PK', ind: 1, nomen: 'PACKING SET, FILTER HOUSING', upa: 1, tag: 'filterPacking', shape: 'seal' },
          { item: '4', pn: 'NT3021-8', ind: 1, nomen: 'DETECTOR, CHIP', upa: 1, tag: 'chipDetector', shape: 'pin' },
          { item: '5', pn: 'MS9068-012', ind: 1, nomen: 'PACKING, CHIP DETECTOR', upa: 1, tag: 'detectorPacking', shape: 'ring' },
        ]
      : [
          { item: '1', pn: `05${fam}900-1`, ind: 0, nomen: 'OIL SYSTEM INSTL', upa: 'RF', note: model === 'twin' ? 'LH AND RH ENGINE' : undefined },
          { item: '2', pn: `BAE-481${k}`, ind: 1, nomen: 'FILTER, OIL', upa: 1, v: BRANDT, tag: 'oilFilter', shape: 'filter' },
          { item: '2A', pn: `SF481${k}-1`, ind: 1, nomen: 'FILTER, OIL', upa: 1, v: SENTINEL, alt: `BAE-481${k}`, tag: 'oilFilter' },
          { item: '3', pn: 'AN814-8DL', ind: 1, nomen: 'PLUG, DRAIN (DRILLED)', upa: 1, tag: 'drainPlug', shape: 'bolt' },
          { item: '4', pn: 'AN900-10', ind: 1, nomen: 'GASKET, CRUSH', upa: 1, tag: 'drainGasket', shape: 'washer', near: '3' },
          { item: '5', pn: 'MS20995C32', ind: 1, nomen: 'WIRE, SAFETY, 0.032 IN', upa: 'AR', tag: 'safetyWire' },
        ];
  const title = model === 'cargo' ? 'OIL FILTER AND CHIP DETECTOR' : model === 'twin' ? 'OIL FILTER AND DRAIN (TYPICAL LH AND RH)' : 'OIL FILTER AND DRAIN';
  return {
    ata: '79-20',
    chapter: '79-20-00',
    fig: FIG_7920[model],
    title,
    catalog: `${family} ILLUSTRATED PARTS CATALOG`,
    effCodes: [],
    rows: list.map((x) => rowFrom(x, env)),
    art: artFrom(list),
    axis: 'x',
    notes: FIG_NOTES,
  };
}

/**
 * Every row a figure prints for this model, in print order, whatever the
 * airplane: both S/N blocks and both SB states are on the page (`applies` here
 * is for block A, PRE SB: evaluate it per airplane with ipcFor).
 */
export function figureRows(model: string, ata: AnyAta): IpcRow[] {
  const m = planeModel(model);
  return ata === '79-20' ? fig7920(m).rows : buildFigure(m, ata, { snB: false, postSb: false }).rows;
}

/** The figure number an ATA has for a model (the IPC index's chapter chips) */
export const figNumber = (model: string, ata: AnyAta) => (ata === '79-20' ? FIG_7920[planeModel(model)] : SPECS[planeModel(model)].figs[ata]);

/**
 * The row for a tag that this configuration really has: effective, not an ALT,
 * and not superseded by another effective row (a code-1 SUPSD part is used up).
 */
export function rowFor(fig: IpcFigure, tag: string): IpcRow | undefined {
  const rows = fig.rows.filter((r) => r.tag === tag && r.applies);
  const live = rows.filter((r) => !r.alt && !(r.supsdBy && rows.some((o) => o.pn === r.supsdBy!.pn)));
  return live[0] ?? rows[0];
}

/** The figure as printed, one line per row, with the ATTACHING PARTS brackets. */
export function ipcLines(fig: IpcFigure): string[] {
  const out: string[] = [];
  let inAtt: string | undefined;
  for (const r of fig.rows) {
    if (r.attachingFor !== inAtt) {
      if (inAtt) out.push('- - - * - - -');
      if (r.attachingFor) out.push('ATTACHING PARTS');
      inAtt = r.attachingFor;
    }
    const upa = typeof r.upa === 'number' ? String(r.upa) : r.upa;
    out.push([r.item, r.pn, r.text, r.eff || '-', upa, ...r.notes].join(' | '));
  }
  if (inAtt) out.push('- - - * - - -');
  return out;
}

// ---------------------------------------------------------------------------
// Compliance catalogs: service bulletins, ADs, STCs
// ---------------------------------------------------------------------------

function otherSbs(model: PlaneModel): { id: string; title: string; ata: string }[] {
  const p = SPECS[model].sbPrefix;
  const list = [
    { id: `SB ${p}-28-04`, title: 'Fuel selector valve detent spring inspection', ata: '28-20' },
    { id: `SB ${p}-52-02`, title: 'Cabin door upper latch pin replacement', ata: '52-10' },
    { id: `SB ${p}-55-01`, title: 'Elevator trim tab hinge pin inspection', ata: '55-20' },
    { id: `SB ${p}-57-05`, title: 'Wing attach fitting corrosion inspection', ata: '57-10' },
  ];
  if (model === 'cargo') list.push({ id: 'Norwell SB 1837', title: 'Compressor wash procedure and interval', ata: '72-00' });
  else list.push({ id: 'Brandt SB 18-3', title: 'Engine-driven fuel pump drive coupling inspection', ata: '73-10' });
  return list;
}

/** moc: the method of compliance a record states, with the AD paragraph (and the SB it calls up) */
type AdDef = { id: string; subject: string; ata: string; moc: string; every?: number; atInspection?: boolean };

function adsOf(model: PlaneModel): AdDef[] {
  const s = SPECS[model];
  const hub = `Beaumont ${s.propHub.split('-').slice(0, 2).join('-')}`;
  if (model === 'cargo') {
    return [
      { id: 'AD 2014-22-08', subject: `${hub} hub: blade clamp bolt torque check`, ata: '61-10', moc: 'torque check of the blade clamp bolts per paragraph (g)(1)', every: 400 },
      { id: 'AD 2020-11-02', subject: 'Flap actuator jackscrew lubrication and end-play check', ata: '27-50', moc: 'lubrication and end-play check per paragraph (g)', every: 200, atInspection: true },
      { id: 'AD 2018-03-04', subject: `${s.engineMaker} ${s.engineModel}: compressor turbine blade inspection`, ata: '72-00', moc: 'borescope inspection per paragraph (g)' },
      { id: 'AD 2017-06-15', subject: 'Halden HSG-250 starter-generator: drive shaft shear section inspection', ata: '24-30', moc: 'visual inspection of the shear section per paragraph (g)' },
    ];
  }
  const list: AdDef[] = [
    { id: 'AD 2016-09-12', subject: `${hub} hub: hub arm crack inspection`, ata: '61-10', moc: 'eddy-current inspection of the hub arms per paragraph (g)(1)', every: 100, atInspection: true },
    { id: 'AD 2012-07-22', subject: 'Pilot and copilot seat rail and seat stop inspection', ata: '25-10', moc: 'visual inspection of the seat rails and stops per paragraph (g)', every: 100, atInspection: true },
    { id: 'AD 2019-14-03', subject: `Halden HA-24${s.k} alternator: pulley nut and rectifier inspection`, ata: '24-30', moc: `inspection per paragraph (g), IAW Halden SB HA-${s.k + 2} Part I` },
  ];
  if (model === 'twin') list.push({ id: 'AD 2011-20-05', subject: `${s.designation} wing spar lower cap inspection`, ata: '57-10', moc: 'visual inspection per paragraph (g)', every: 500 });
  if (model === 'float') list.push({ id: 'AD 2015-18-06', subject: 'Float attach fittings and spreader bars (seaplane operation)', ata: '32-00', moc: 'visual inspection per paragraph (g)', every: 100, atInspection: true });
  return list;
}

type StcDef = { title: string; holder: string; ata: string; weightLb: number; field?: boolean };

function stcPool(model: PlaneModel): StcDef[] {
  const pool: StcDef[] = [
    { title: 'LED landing and taxi lights', holder: 'Brightline Aviation Lighting', ata: '33-40', weightLb: -1.2 },
    { title: 'Engine monitor (EGT / CHT / fuel flow)', holder: 'Sentry Instruments', ata: '77-20', weightLb: 1.9 },
    { title: 'Vortex generator kit', holder: 'Airflow Dynamics', ata: '57-00', weightLb: 1.1 },
    { title: 'Inertia-reel shoulder harnesses', holder: 'SafeRest Restraints', ata: '25-10', weightLb: 3.4 },
    { title: 'Flap and aileron gap seal kit', holder: 'Slick Surfaces Inc.', ata: '57-50', weightLb: 2.2 },
    { title: 'Belly-mounted com 2 antenna on an external skin doubler', holder: 'Island Company (owner)', ata: '53-10', weightLb: 0.6, field: true },
  ];
  if (model === 'cargo') pool.push({ title: 'Cargo tie-down rails and barrier net', holder: 'Freightline Interiors', ata: '25-50', weightLb: 14.6 });
  if (model === 'float') pool.push({ title: 'Water rudder retract handle and cable upgrade', holder: 'Pontoon Works', ata: '27-20', weightLb: 0.7 });
  return pool;
}

const OFFICES = ['CH', 'WI', 'SW', 'NM', 'LA', 'CE', 'SE', 'AT', 'NE'];
const stcNumber = (r: Rng) => `SA0${r.int(1000, 4999)}${r.pick(OFFICES)}`;

/** A torque as an ICA prints it: the AMM torque key it stands in for. */
export type IcaTorque = { key: string; what: string; lo: number; hi: number; unit: 'in-lb' | 'ft-lb'; note?: string };

/** One STC that swaps an IPC assembly for the STC holder's parts. */
type PlantDef = {
  holder: string;
  cage: string;
  title: string;
  icaDoc: string;
  item: string;
  /** IPC tag of the part the job needs */
  tag: string;
  rows: R[];
  icaNotes: string[];
  /**
   * The ICA's own values for the fasteners of the assembly it replaced (by the
   * AMM torque key they stand in for): on this airplane they govern, not the
   * airframe manual's.
   */
  icaTorques: IcaTorque[];
  /** the ICA's approved hydraulic fluid (a hydraulic kit), by specification */
  icaFluids?: string[];
  weightLb: number;
  /** why an AD on the old assembly no longer applies: "Beaumont propeller removed" */
  removed: string;
  /** words for the logbook entry: what came off, what went on (pos: one side of a twin, in that unit's book) */
  off: (fig: IpcFigure, pos?: Pos) => string;
  on: (pos?: Pos) => string;
};

function plantDef(model: PlaneModel, ata: Ata): PlantDef {
  const { k, bladeCount } = SPECS[model];
  const twin = model === 'twin';
  const off = (tags: string[], label: string, one?: string) => (fig: IpcFigure, pos?: Pos) =>
    `${pos && one ? `${pos} ${one}` : label} P/N ${tags.map((t) => rowFor(fig, t)?.pn).filter(Boolean).join(', ')}`;
  switch (ata) {
    case '32-40': {
      const v = 'V5KA31';
      return {
        holder: 'Kestner Aero Conversions',
        cage: v,
        title: 'Heavy-duty main wheel brake conversion (dual piston)',
        icaDoc: 'Kestner ICA KA-32-1, Rev C',
        item: 'Brake lining',
        tag: 'lining',
        rows: [
          { item: '1', pn: `KA-${k}30-K`, ind: 0, nomen: 'KIT, BRAKE CONVERSION', upa: 'RF' },
          { item: '2', pn: `KA-${k}31`, ind: 1, nomen: 'BRAKE ASSY, DUAL PISTON', upa: 1, v, tag: 'brake' },
          { item: '3', pn: `KA-66-${k}HD`, ind: 2, nomen: 'LINING, METALLIC', upa: 4, v, tag: 'lining' },
          { item: '4', pn: 'KA-105-6', ind: 3, nomen: 'RIVET, LINING', upa: 24, v, tag: 'rivet' },
          { item: '5', pn: `KA-${k}35`, ind: 2, nomen: 'PLATE, BACK', upa: 1, v, tag: 'backPlate' },
          { item: '6', pn: `KA-${k}32`, ind: 1, nomen: 'DISC, BRAKE, VENTED', upa: 1, v, tag: 'disc' },
          { item: '7', pn: `KA-${k}36`, ind: 1, nomen: 'BOLT, BACK PLATE', upa: 6, v, att: '2', tag: 'backPlateBolt' },
        ],
        icaNotes: ['Back plate bolts: 110–120 in-lb (ICA value, not the airframe MM)', 'Replace linings at 0.125 in minimum thickness', 'Condition new metallic linings: 2 firm stops from 30–35 kt'],
        icaTorques: [{ key: 'backPlateBolt', what: 'Brake back plate bolts (dual-piston brake)', lo: 110, hi: 120, unit: 'in-lb', note: 'Dry threads' }],
        weightLb: 2.4,
        removed: 'OEM brakes removed',
        off: off(['brake', 'disc'], 'main brake assemblies and discs'),
        on: () => `Kestner heavy-duty brake kit P/N KA-${k}30-K (brakes KA-${k}31, vented discs KA-${k}32, linings KA-66-${k}HD)`,
      };
    }
    case '61-10': {
      const v = 'V6SP02';
      return {
        holder: 'Seaboard Propeller Conversions',
        cage: v,
        title: `Four-blade composite propeller conversion (replaces ${bladeCount}-blade metal propeller)`,
        icaDoc: 'Seaboard ICA SPC-61-4, Rev B',
        item: 'Propeller mounting bolt',
        tag: 'propBolt',
        rows: [
          { item: '1', pn: `SPC-4${k}-K`, ind: 0, nomen: 'KIT, PROPELLER CONVERSION', upa: 'RF' },
          { item: '2', pn: `SPC-4${k}H/SC${k}4`, ind: 1, nomen: 'PROPELLER ASSY, 4 BLADE, COMPOSITE', upa: 1, v, tag: 'propeller' },
          { item: '3', pn: `SC${k}4`, ind: 2, nomen: 'BLADE, COMPOSITE', upa: 4, v, tag: 'blade' },
          { item: '4', pn: `SPC-${k}S`, ind: 1, nomen: 'SPINNER ASSY', upa: 1, v, tag: 'spinner' },
          { item: '5', pn: `SPC-4413-${k}L`, ind: 1, nomen: 'BOLT, PROPELLER MOUNTING (LONG)', upa: 6, v, att: '2', tag: 'propBolt' },
          { item: '6', pn: 'SPC-4416', ind: 1, nomen: 'WASHER, BOLT', upa: 6, v, att: '2' },
          { item: '7', pn: 'MS29513-240', ind: 1, nomen: 'O-RING, HUB TO FLANGE', upa: 1, att: '2', tag: 'hubOring' },
        ],
        icaNotes: ['Mounting bolts: 80–85 ft-lb, threads lubricated (ICA value)', 'Blade track within 1/8 in', 'Composite blades: erosion shield inspection each 100 hr'],
        icaTorques: [
          { key: 'propBolt', what: 'Propeller mounting bolts (long)', lo: 80, hi: 85, unit: 'ft-lb', note: 'Threads lubricated; cross pattern in 3 stages; then safety wire' },
          { key: 'spinnerScrew', what: 'Spinner dome screws', lo: 20, hi: 25, unit: 'in-lb' },
        ],
        weightLb: -6.8,
        removed: 'Beaumont propeller removed',
        off: off(['propeller'], twin ? 'LH and RH propellers' : 'propeller', 'propeller'),
        on: (pos) => `${twin && !pos ? 'LH and RH ' : ''}Seaboard 4-blade composite propeller${twin && !pos ? 's' : ''} P/N SPC-4${k}H/SC${k}4 with mounting bolts SPC-4413-${k}L`,
      };
    }
    case '29-10': {
      const v = 'V3MH77';
      return {
        holder: 'Marlin Hydraulics',
        cage: v,
        title: 'Replacement electro-hydraulic power pack',
        icaDoc: 'Marlin ICA MH-29-300, Rev A',
        item: 'Hydraulic filter element',
        tag: 'filter',
        rows: [
          { item: '1', pn: `MH-300-${k}K`, ind: 0, nomen: 'KIT, POWER PACK REPLACEMENT', upa: 'RF' },
          { item: '2', pn: `MH-300-${k}`, ind: 1, nomen: 'POWER PACK ASSY, 28 VDC', upa: 1, v, tag: 'powerPack' },
          { item: '3', pn: 'MH-300-F10', ind: 2, nomen: 'ELEMENT, FILTER, 10 MICRON', upa: 1, v, tag: 'filter' },
          { item: '4', pn: 'MS28775-230', ind: 2, nomen: 'O-RING, FILTER BOWL', upa: 1, tag: 'bowlOring' },
          { item: '5', pn: 'MH-300-C', ind: 2, nomen: 'CAP, FILLER, VENTED', upa: 1, v, tag: 'resCap' },
          { item: '6', pn: 'MH-300-IS', ind: 1, nomen: 'ISOLATOR, SHOCK MOUNT', upa: 3, v, att: '2' },
        ],
        icaNotes: ['Fluid MIL-PRF-5606 only; reservoir 1.1 qt', 'Filter bowl: 70–80 in-lb, safety wired', 'Gear-up pump run time 6–9 s'],
        icaTorques: [
          { key: 'filterBowl', what: 'Filter bowl', lo: 70, hi: 80, unit: 'in-lb', note: 'Safety wire after torque' },
          { key: 'mountBolt', what: 'Power pack mounting bolts (through the shock isolators)', lo: 40, hi: 50, unit: 'in-lb' },
        ],
        icaFluids: ['MIL-PRF-5606'],
        weightLb: -1.6,
        removed: 'Delmar power pack removed',
        off: off(['powerPack'], 'hydraulic power pack'),
        on: () => `Marlin power pack P/N MH-300-${k} (kit MH-300-${k}K)`,
      };
    }
    case '23-10': {
      const v = 'V8NX15';
      return {
        holder: 'Nexus Avionics',
        cage: v,
        title: 'GPS / NAV / COM installation (approved model list STC)',
        icaDoc: 'Nexus ICA NX-430-23, Rev D',
        item: 'Com radio (GPS/NAV/COM unit)',
        tag: 'radio',
        rows: [
          { item: '1', pn: 'NX-430-K', ind: 0, nomen: 'KIT, GPS/NAV/COM INSTALLATION', upa: 'RF' },
          { item: '2', pn: 'NX-430-00', ind: 1, nomen: 'UNIT, GPS/NAV/COM, 8.33/25 KHZ', upa: 1, v, tag: 'radio' },
          { item: '3', pn: 'NX-430-MT', ind: 1, nomen: 'TRAY, MOUNTING', upa: 1, v, tag: 'tray' },
          { item: '4', pn: 'NX-430-CK', ind: 2, nomen: 'CONNECTOR KIT, 2 X 78 PIN', upa: 1, v, tag: 'connector' },
          { item: '5', pn: 'NX-430-LS', ind: 2, nomen: 'SCREW, CAM LOCK', upa: 1, v, tag: 'lockScrew' },
          { item: '6', pn: 'NX-ANT-7', ind: 1, nomen: 'ANTENNA, GPS', upa: 1, v },
        ],
        icaNotes: ['Cam lock: seat the unit, then 1/4 turn more; 12 in-lb max', 'Check the navigation database is current before return to service'],
        icaTorques: [
          { key: 'lockScrew', what: 'Unit cam-lock screw (seat, then 1/4 turn more)', lo: 9, hi: 12, unit: 'in-lb', note: '12 in-lb max' },
          { key: 'trayScrew', what: 'Mounting tray screws', lo: 10, hi: 12, unit: 'in-lb' },
        ],
        weightLb: 1.3,
        removed: 'Tern com removed',
        off: off(['radio', 'tray'], 'VHF com and mounting tray'),
        on: () => 'Nexus GPS/NAV/COM P/N NX-430-00 in tray NX-430-MT, GPS antenna NX-ANT-7',
      };
    }
    case '24-30': {
      const v = 'V9VM40';
      if (model === 'cargo')
        return {
          holder: 'Voltmark Power Systems',
          cage: v,
          title: 'Brushless starter-generator conversion',
          icaDoc: 'Voltmark ICA VM-24-SG, Rev B',
          item: 'Starter-generator',
          tag: 'generator',
          rows: [
            { item: '1', pn: `VM-SG${k}K`, ind: 0, nomen: 'KIT, STARTER-GENERATOR CONVERSION', upa: 'RF' },
            { item: '2', pn: `VM-SG300-${k}`, ind: 1, nomen: 'STARTER-GENERATOR, BRUSHLESS, 28 V 300 A', upa: 1, v, tag: 'generator' },
            { item: '3', pn: 'VM-GCU-3', ind: 1, nomen: 'UNIT, GENERATOR CONTROL', upa: 1, v },
            { item: '4', pn: `VM-QAD-${k}`, ind: 1, nomen: 'ADAPTER, QUICK ATTACH', upa: 1, v, tag: 'qad' },
            { item: '5', pn: `VM-VB-${k}`, ind: 1, nomen: 'CLAMP, V-BAND', upa: 1, v, tag: 'vband' },
          ],
          icaNotes: ['V-band clamp: 55–60 in-lb, tap around and re-torque (ICA value)', 'No brushes: omit brush-wear inspection; check GCU fault log'],
          icaTorques: [
            { key: 'vband', what: 'V-band clamp nut', lo: 55, hi: 60, unit: 'in-lb', note: 'Tap the clamp all round with a soft mallet and re-torque' },
            { key: 'qadNut', what: 'Quick-attach adapter nuts', lo: 110, hi: 130, unit: 'in-lb' },
          ],
          weightLb: -4.1,
          removed: 'Halden starter-generator removed',
          off: off(['generator'], 'starter-generator'),
          on: () => `Voltmark brushless starter-generator P/N VM-SG300-${k} with GCU VM-GCU-3`,
        };
      return {
        holder: 'Voltmark Power Systems',
        cage: v,
        title: 'Lightweight internally regulated alternator conversion',
        icaDoc: 'Voltmark ICA VM-24-70, Rev C',
        item: 'Alternator',
        tag: 'generator',
        rows: [
          { item: '1', pn: `VM-${k}K`, ind: 0, nomen: 'KIT, ALTERNATOR CONVERSION', upa: 'RF' },
          { item: '2', pn: `VM-70-28-${k}`, ind: 1, nomen: 'ALTERNATOR, 28 V 70 A, INTERNALLY REGULATED', upa: 1, v, tag: 'generator' },
          { item: '3', pn: `VM-${k}-PN`, ind: 2, nomen: 'NUT, PULLEY', upa: 1, v, tag: 'pulleyNut' },
          { item: '4', pn: `VM-B${k + 19}`, ind: 1, nomen: 'BELT, V', upa: 1, v, tag: 'belt' },
          { item: '5', pn: `VM-${k}-BR`, ind: 1, nomen: 'BRACKET, MOUNTING', upa: 1, v },
        ],
        icaNotes: ['Internally regulated: the external regulator is removed and placarded INOP', 'Pulley nut 450–550 in-lb (ICA value)'],
        icaTorques: [
          { key: 'pulleyNut', what: 'Alternator pulley nut', lo: 450, hi: 550, unit: 'in-lb' },
          { key: 'beltNew', what: 'Belt tension, new belt (slip torque at pulley nut)', lo: 11, hi: 13, unit: 'ft-lb' },
          { key: 'beltUsed', what: 'Belt tension, used belt (slip torque at pulley nut)', lo: 7, hi: 9, unit: 'ft-lb' },
        ],
        weightLb: -3.2,
        removed: 'Halden alternator removed',
        off: off(['generator'], twin ? 'LH and RH alternators' : 'alternator', 'alternator'),
        on: (pos) => `Voltmark alternator${twin && !pos ? 's' : ''} P/N VM-70-28-${k} (kit VM-${k}K)`,
      };
    }
  }
}

/**
 * The part an STC kit puts on the airplane for this job, without building an
 * aircraft: what a mechanic finds stamped on the removed part when the kit is
 * there (with or without the paperwork to show for it).
 */
export function plantPart(model: PlaneModel, ata: Ata): { holder: string; title: string; ica: string; item: string; tag: string; pn: string; kit: string } {
  const d = plantDef(model, ata);
  return { holder: d.holder, title: d.title, ica: d.icaDoc, item: d.item, tag: d.tag, pn: d.rows.find((x) => x.tag === d.tag)!.pn, kit: d.rows[0].pn };
}

/**
 * The ICA for the alteration that replaced this assembly on this airplane (an
 * STC, or the same kit on a field-approved 337): who holds it, the document and
 * its revision, what it approves, and its own values. Where the airframe
 * manual's task card and the ICA differ, the ICA governs. Undefined when the
 * assembly is the manufacturer's (or only a PMA part went on).
 */
export type IcaCard = {
  ata: Ata;
  holder: string;
  /** "Seaboard ICA SPC-61-4, Rev B" */
  doc: string;
  /** "STC SA02971SE", "Form 337 dated 04/10/2023 (field approval)" */
  approval: string;
  title: string;
  /** "Beaumont propeller removed" */
  removed: string;
  torques: IcaTorque[];
  fluids?: string[];
  notes: string[];
};

export function icaCardFor(ac: Pick<Aircraft, 'model' | 'plant'>, ata: Ata | string): IcaCard | undefined {
  const p = ac.plant;
  if (!p || p.via === 'pma' || p.ata !== ata) return undefined;
  const d = plantDef(ac.model, p.ata);
  return { ata: p.ata, holder: d.holder, doc: d.icaDoc, approval: p.ref, title: d.title, removed: d.removed, torques: d.icaTorques, ...(d.icaFluids ? { fluids: d.icaFluids } : {}), notes: d.icaNotes };
}

/**
 * The external power placard by the receptacle, as the flight manual's ground
 * power start (AFM / POH Section 4) has it for this airplane: 28 V DC on all
 * three types; the turbine placards its start current limit; a high wing's
 * battery master closes the external power relay, so it is ON for the start.
 * The amphibian sits on its float wheels on the ramp. Derived from the seed.
 */
export type ExternalPower = {
  volts: 28;
  /** turbine: maximum start current, amps; 0 = not placarded */
  ampMax: number;
  battery: 'on' | 'off';
  wing: 'high' | 'low';
  turbine: boolean;
  floats: boolean;
  /** "AFM Section 4", "POH Section 4" */
  manual: string;
  /** as the placard reads */
  placard: string;
};

export function externalPower(ac: Pick<Aircraft, 'model' | 'islandSeed' | 'assetId'>): ExternalPower {
  if (ac.model === 'cargo') {
    const ampMax = rng(hashSeed('ext-power', ac.islandSeed, ac.assetId)).pick([800, 900, 1000]);
    return { volts: 28, ampMax, battery: 'on', wing: 'high', turbine: true, floats: false, manual: 'AFM Section 4', placard: `EXTERNAL POWER 28 V DC · ${ampMax} A MAX · BATTERY SWITCH ON` };
  }
  if (ac.model === 'float')
    return { volts: 28, ampMax: 0, battery: 'on', wing: 'high', turbine: false, floats: true, manual: 'POH Section 4', placard: 'EXTERNAL POWER 28 VOLTS DC · BATTERY MASTER ON' };
  return { volts: 28, ampMax: 0, battery: 'on', wing: 'low', turbine: false, floats: false, manual: 'POH Section 4', placard: 'EXTERNAL POWER 28 VOLTS DC · BATTERY MASTER ON' };
}

/**
 * The alteration that governs one slot on this airplane: an STC or field
 * approval on its ATA whose ICA parts list carries the slot's tag. A tire on an
 * airplane with a brake conversion is still the IPC's; its linings are not.
 */
export function plantedFor(ac: Pick<Aircraft, 'model' | 'plant'>, ata: string, tag: string): Plant | undefined {
  const p = ac.plant;
  if (!p || p.via === 'pma' || p.ata !== ata) return undefined;
  return plantDef(ac.model, p.ata).rows.some((x) => x.tag === tag) ? p : undefined;
}

/** The STC holder's ICA parts list for the kit that replaces this assembly (same row format as the IPC). */
export function plantRows(model: PlaneModel, ata: Ata): IpcRow[] {
  return plantDef(model, ata).rows.map((x) => rowFrom(x, { snB: true, postSb: true }));
}

/** An FAA-PMA replacement for one IPC part: the PMA holder's number carries the OEM number it replaces. */
type PmaDef = { holder: string; item: string; tag: string; key: string; pn(ipcPn: string): string; eligibility: string };

export const PMA_ATAS: readonly Ata[] = ['32-40', '29-10'];

function pmaDef(model: PlaneModel, ata: Ata): PmaDef | undefined {
  const s = SPECS[model];
  if (ata === '32-40')
    return {
      holder: 'Rimrock Friction Products',
      item: 'Brake lining',
      tag: 'lining',
      key: 'lining',
      pn: (ipc) => `RF${ipc}`,
      eligibility: `Rimrock PMA supplement RF-${s.k}, eligibility list includes ${s.designation}`,
    };
  if (ata === '29-10')
    return {
      holder: 'Pacific Filtration Co.',
      item: 'Hydraulic filter element',
      tag: 'filter',
      key: 'hyd',
      pn: (ipc) => `PF${ipc.replace(/^DH-/, '')}`,
      eligibility: `Pacific Filtration PMA supplement PF-${s.k + 3}, eligibility list includes ${s.designation}`,
    };
  return undefined;
}

// ---------------------------------------------------------------------------
// Torque tables (shared by the task cards and the logbook text)
// ---------------------------------------------------------------------------

export type TorqueSpec = {
  key: string;
  what: string;
  lo: number;
  hi: number;
  unit: 'in-lb' | 'ft-lb';
  /** effectivity code of the figure (A/B by S/N, C/D by SB); none = all */
  eff?: 'A' | 'B' | 'C' | 'D';
  /** the effectivity in words, as the manual prints it */
  effText?: string;
  note?: string;
  /** true when this row is the one for this aircraft */
  applies: boolean;
};

type TorqueDef = Omit<TorqueSpec, 'applies' | 'effText'>;

function torqueDefs(model: PlaneModel, ata: Ata): TorqueDef[] {
  const pick = (twin: number, cargo: number, float: number) => (model === 'twin' ? twin : model === 'cargo' ? cargo : float);
  const band = (lo: number, w = 10) => [lo, lo + w] as const;
  switch (ata) {
    case '32-40': {
      const [ta, tah] = band(pick(150, 190, 90));
      const [tb, tbh] = band(pick(120, 170, 75));
      const [bd, bdh] = band(pick(75, 90, 60), 5);
      const [bc, bch] = band(pick(90, 110, 70), 5);
      return [
        { key: 'tieNut', what: 'Wheel tie-bolt nuts', lo: ta, hi: tah, unit: 'in-lb', eff: 'A', note: 'Dry threads; tighten in a cross pattern' },
        { key: 'tieNut', what: 'Wheel tie-bolt nuts', lo: tb, hi: tbh, unit: 'in-lb', eff: 'B', note: 'Dry threads; tighten in a cross pattern' },
        { key: 'backPlateBolt', what: 'Brake back plate bolts', lo: bd, hi: bdh, unit: 'in-lb', eff: 'D' },
        { key: 'backPlateBolt', what: 'Brake back plate bolts', lo: bc, hi: bch, unit: 'in-lb', eff: 'C' },
        { key: 'hubCap', what: 'Hub cap screws', lo: 20, hi: 25, unit: 'in-lb' },
      ];
    }
    case '61-10': {
      const [d, dh] = band(pick(60, 90, 60), 5);
      const [c, ch] = band(pick(70, 100, 70), 5);
      return [
        { key: 'propBolt', what: 'Propeller mounting bolts', lo: d, hi: dh, unit: 'ft-lb', eff: 'D', note: 'Dry threads; cross pattern in 3 stages; then safety wire' },
        { key: 'propBolt', what: 'Propeller mounting bolts', lo: c, hi: ch, unit: 'ft-lb', eff: 'C', note: 'Threads lubricated (MIL-PRF-907); cross pattern in 3 stages; then safety wire' },
        { key: 'spinnerScrew', what: 'Spinner dome screws', lo: 20, hi: 25, unit: 'in-lb' },
      ];
    }
    case '29-10':
      return [
        { key: 'filterBowl', what: 'Filter bowl', lo: 100, hi: 120, unit: 'in-lb', eff: 'A', note: 'Safety wire after torque' },
        { key: 'filterBowl', what: 'Filter bowl', lo: 140, hi: 160, unit: 'in-lb', eff: 'B', note: 'Safety wire after torque' },
        { key: 'mountBolt', what: 'Power pack mounting bolts (AN4)', lo: 50, hi: 70, unit: 'in-lb' },
      ];
    case '23-10':
      return [
        { key: 'lockScrew', what: 'Radio cam-lock screw (final seat)', lo: 6, hi: 8, unit: 'in-lb', eff: 'A' },
        { key: 'lockScrew', what: 'Radio cam-lock screw (final seat)', lo: 9, hi: 11, unit: 'in-lb', eff: 'B' },
        { key: 'trayScrew', what: 'Mounting tray screws', lo: 12, hi: 15, unit: 'in-lb' },
      ];
    case '24-30':
      if (model === 'cargo')
        return [
          { key: 'vband', what: 'V-band clamp nut', lo: 50, hi: 55, unit: 'in-lb', eff: 'A', note: 'Tap the clamp all round with a soft mallet and re-torque' },
          { key: 'vband', what: 'V-band clamp nut', lo: 60, hi: 65, unit: 'in-lb', eff: 'B', note: 'Tap the clamp all round with a soft mallet and re-torque' },
          { key: 'qadNut', what: 'QAD adapter nuts (5/16)', lo: 100, hi: 140, unit: 'in-lb' },
        ];
      return [
        { key: 'pulleyNut', what: 'Alternator pulley nut', lo: 350, hi: 400, unit: 'in-lb', eff: 'D' },
        { key: 'pulleyNut', what: 'Alternator pulley nut', lo: 450, hi: 500, unit: 'in-lb', eff: 'C' },
        { key: 'pivotBolt', what: 'Pivot bolt (AN5)', lo: 100, hi: 140, unit: 'in-lb' },
        { key: 'armBolt', what: 'Adjusting arm bolt (AN4)', lo: 50, hi: 70, unit: 'in-lb' },
        { key: 'beltNew', what: 'Belt tension, new belt (slip torque at pulley nut)', lo: 11, hi: 13, unit: 'ft-lb' },
        { key: 'beltUsed', what: 'Belt tension, used belt (slip torque at pulley nut)', lo: 7, hi: 9, unit: 'ft-lb' },
      ];
  }
}

function torquesAt(model: PlaneModel, ata: Ata, env: Env): TorqueSpec[] {
  const fig = buildFigure(model, ata, env);
  return torqueDefs(model, ata).map((t) => ({
    ...t,
    effText: t.eff ? fig.effCodes.find((e) => e.code === t.eff)!.text : undefined,
    applies: effOk(t.eff ?? '', env),
  }));
}

const torqueOf = (model: PlaneModel, ata: Ata, env: Env, key: string) => torquesAt(model, ata, env).find((t) => t.key === key && t.applies)!;

// ---------------------------------------------------------------------------
// Time: hours flown per day, busier in the island's high season (Dec–Apr)
// ---------------------------------------------------------------------------

type Clock = { ttAt(day: number): number; dayAt(tt: number): number };

function makeClock(r: Rng, startDay: number, endDay: number, ttStart: number, util: number): Clock {
  const MONTH = 30.44;
  const SEASON = [1.25, 1.25, 1.2, 1.1, 0.9, 0.8, 0.85, 0.8, 0.75, 0.8, 0.95, 1.2];
  const n = Math.ceil((endDay - startDay) / MONTH) + 30;
  const cum = [0];
  for (let i = 0; i < n; i++) {
    const month = new Date((startDay + i * MONTH) * DAY_MS).getUTCMonth();
    cum.push(cum[i] + (util / 12) * SEASON[month] * r.range(0.7, 1.3));
  }
  const ttAt = (day: number) => {
    const f = Math.max(0, (day - startDay) / MONTH);
    const i = Math.min(n - 1, Math.floor(f));
    return ttStart + cum[i] + (cum[i + 1] - cum[i]) * (f - i);
  };
  const dayAt = (tt: number) => {
    let lo = startDay;
    let hi = startDay + Math.floor(n * MONTH) - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ttAt(mid) >= tt) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  };
  return { ttAt, dayAt };
}

/** stc: the STC number; field: '' (basis holds the STC whose data the field approval used) */
type PlantState = { ata: Ata; day: number; via: 'stc' | 'field'; stc: string; basis: string; def: PlantDef; alt: Alteration };
/** the last replacement of one part used an FAA-PMA part */
type PmaState = { ata: Ata; day: number; def: PmaDef; pn: string; replaces: string };

/** everything the logbook text needs to know about the airframe's configuration over time */
type Ctx = {
  m: PlaneModel;
  s: Spec;
  snB: Record<Ata, boolean>;
  /** day each figure SB was complied with (before the log for older ones) */
  sbDay: Partial<Record<Ata, number>>;
  clock: Clock;
  alts: Alteration[];
  plant?: PlantState;
  pma?: PmaState;
  /** propeller serials per position ('LH' / 'RH' on the twin, 'Prop' otherwise): the OEM unit, and the STC unit a planted 61-10 conversion puts on */
  propSn: Record<string, { oem: string; stc: string }>;
};

const envAt = (c: Ctx, ata: Ata, day: number): Env => ({ snB: c.snB[ata], postSb: c.sbDay[ata] !== undefined && day >= c.sbDay[ata]! });
const figAt = (c: Ctx, ata: Ata, day: number) => buildFigure(c.m, ata, envAt(c, ata, day));
const pnAt = (c: Ctx, ata: Ata, day: number, tag: string) => rowFor(figAt(c, ata, day), tag)!.pn;
const plantedAt = (c: Ctx, ata: Ata, day: number) => (c.plant && c.plant.ata === ata && day >= c.plant.day ? c.plant : undefined);
const plantPn = (p: PlantState, tag: string) => p.def.rows.find((x) => x.tag === tag)?.pn;
const pmaAt = (c: Ctx, ata: Ata, day: number) => (c.pma && c.pma.ata === ata && day === c.pma.day ? c.pma : undefined);
const tq = (t: { lo: number; hi: number; unit: string }) => `${t.lo}-${t.hi} ${t.unit}`;

// ---------------------------------------------------------------------------
// Logbook events. Each kind of event has its own random stream, so planting an
// alteration adds entries and rewrites later text for that one ATA, and leaves
// every other entry exactly as it was.
// ---------------------------------------------------------------------------

type Who = 'ia' | 'crew' | 'shop' | 'avionics';
type Body = { text: string; ref: string; pns?: LogEntry['pns']; cert?: string };
type Ev = {
  day: number;
  book: LogBook;
  kind: LogKind;
  ata?: string;
  key: string;
  who: Who;
  /**
   * twin engine / propeller books: whose book. Unset (or 'both') writes the
   * entry in each unit's book, the way a shop logs work done to both engines.
   */
  pos?: Pos | 'both';
  /** crew signer stream: entries that share it are signed by the same mechanic (one inspection, three books) */
  sig?: string;
  body(c: Ctx, pos?: Pos): Body;
};

/**
 * Which logbook an ATA chapter goes in: propeller (61), engine (71-85, and the
 * engine-driven alternator / starter-generator, 24-30), or airframe.
 */
export const bookFor = (ata: string): LogBook => (ata.startsWith('61') ? 'propeller' : /^(7[1-9]|8[0-5])/.test(ata) || ata.startsWith('24-3') ? 'engine' : 'airframe');
const mm = (c: Ctx, task: string) => `IAW ${c.s.family} MM ${task}`;
/** the propeller serial for a position on a date (after a planted propeller STC, the new unit) */
const propSnAt = (c: Ctx, day: number, pos?: Pos) => {
  const u = c.propSn[pos ?? 'Prop'] ?? Object.values(c.propSn)[0];
  return plantedAt(c, '61-10', day) ? u.stc : u.oem;
};
/**
 * The company engineering authorization that added one ICA part to this tail's
 * approved parts list (GMM parts control for a part the IPC does not list).
 * One per part number: every later replacement of that P/N cites the same EA.
 */
const eaNo = (p: PlantState, pn: string) => `EA ${isoOf(p.day).slice(2, 4)}-${pad(100 + (hashSeed(p.basis, pn, 'ea') % 800), 3)}`;
const eaLine = (ea: string) => `P/N eligibility per ${ea} (Engineering).`;
/** how a record cites the approval the planted assembly rests on */
const approvalCite = (p: PlantState) => (p.via === 'stc' ? `STC ${p.stc}` : `Form 337 dated ${fmtDate(p.alt.form337)} (field approval)`);
const icaRef = (p: PlantState) => (p.via === 'stc' ? `IAW ${p.def.icaDoc} (STC ${p.stc})` : `IAW ICA attached to ${approvalCite(p)}`);

function adText(c: Ctx, day: number, ad: AdDef, tt: number): string {
  const p = IPC_ATAS.includes(ad.ata as Ata) ? plantedAt(c, ad.ata as Ata, day) : undefined;
  if (p) return `${ad.id} N/A: ${p.def.removed} per ${approvalCite(p)}.`;
  return ad.every ? `${ad.id} (${ad.subject}) complied with by ${ad.moc}, next due ${hrs(tt + ad.every)} TT.` : `${ad.id} (${ad.subject}) complied with by ${ad.moc}.`;
}

const altInspected = (a: Alteration) =>
  a.stc ? `STC ${a.stc} installation inspected per ${a.ica}.` : `Field-approved alteration (Form 337 dated ${fmtDate(a.form337)}) inspected per block 8.`;

function compression(seed: number): string {
  const r = rng(seed);
  return Array.from({ length: 6 }, () => r.int(68, 78)).join('/');
}

/** alterations installed before this day whose ICA inspection goes in this book (the book that recorded the installation) */
const altsIn = (c: Ctx, day: number, book: LogBook) => c.alts.filter((a) => dayOf(a.date) < day && (a.displaces ? bookFor(a.ata) : 'airframe') === book);

function inspBody(c: Ctx, day: number, type: 'annual' | '100hr', over: number): Body {
  const { s, m } = c;
  const tt = c.clock.ttAt(day);
  const out = [
    `${type === 'annual' ? 'Annual' : '100-hour'} inspection IAW 14 CFR Part 43 App. D and ${s.family} MM Chapter 5 inspection guide.`,
  ];
  if (over) out.push(`Inspection was ${hrs(over)} hr overdue: flown to the maintenance base IAW 14 CFR 91.409(b); the overflight counts toward the next 100 hr.`);
  for (const ad of adsOf(m)) if (ad.atInspection && bookFor(ad.ata) === 'airframe') out.push(adText(c, day, ad, tt));
  if (type === 'annual') {
    out.push('ELT inspected IAW 14 CFR 91.207(d).');
    for (const a of altsIn(c, day, 'airframe')) out.push(altInspected(a));
  }
  out.push(`${m === 'twin' ? 'Engines and propellers' : 'Engine and propeller'}: see engine and propeller logbooks.`);
  return {
    text: out.join(' '),
    ref: `IAW ${s.family} MM Ch. 5; 14 CFR 43 App. D`,
    cert: `I certify that this aircraft has been inspected in accordance with ${type === 'annual' ? 'an annual' : 'a 100-hour'} inspection and was determined to be in airworthy condition.`,
  };
}

/** the engine's part of an annual / 100-hour, in that engine's logbook */
function engineInspBody(c: Ctx, day: number, type: 'annual' | '100hr', pos?: Pos): Body {
  const { s, m } = c;
  const q = rng(hashSeed(day, 'eng-insp', pos ?? 'E'));
  const extra = q.shuffle([
    'Magneto timing checked, 22° BTC.',
    'Spark plugs cleaned, gapped and rotated.',
    'Induction and exhaust systems inspected, no leaks.',
    'Engine mounts and baffles inspected.',
    `Fuel injector nozzles cleaned; unmetered fuel pressure within limits.`,
  ]).slice(0, 2);
  const out = [
    `${type === 'annual' ? 'Annual' : '100-hour'} inspection of ${pos ? `${pos} engine` : 'engine'} IAW 14 CFR Part 43 App. D and the ${s.engineMaker} ${s.engineModel} maintenance manual.`,
    `Compression ${compression(hashSeed(day, pos ? pos[0] : 'E'))} (/80).`,
    `Oil and filter changed (${m === 'twin' ? 12 : 11} qt SAE J1899 20W-50); filter opened, no metal.`,
    ...extra,
  ];
  if (type === 'annual') for (const a of altsIn(c, day, 'engine')) out.push(altInspected(a));
  return {
    text: out.join(' '),
    ref: `IAW ${s.engineMaker} ${s.engineModel} MM; 14 CFR 43 App. D`,
    cert: `I certify that this engine has been inspected in accordance with ${type === 'annual' ? 'an annual' : 'a 100-hour'} inspection and was determined to be in airworthy condition.`,
  };
}

/** the propeller's part of an inspection, in that propeller's logbook */
function propInspBody(c: Ctx, day: number, type: 'annual' | '100hr' | 'phase', pos?: Pos, n = 0): Body {
  const { s, m } = c;
  const tt = c.clock.ttAt(day);
  const p = plantedAt(c, '61-10', day);
  const unit = `${pos ? `${pos} propeller` : 'propeller'} S/N ${propSnAt(c, day, pos)}`;
  const out = [
    type === 'phase'
      ? `Phase ${n} inspection, ${unit}, IAW ${s.family} MM Chapter 5 and the approved aircraft inspection program.`
      : `${type === 'annual' ? 'Annual' : '100-hour'} inspection of ${unit} IAW 14 CFR Part 43 App. D.`,
  ];
  const q = rng(hashSeed(day, 'prop-insp', pos ?? 'P'));
  if (p) out.push(`Composite blades, erosion shields and blade retention inspected per ICA; spinner and bulkheads secure. Track within 1/8 in.`);
  else if (m === 'cargo') out.push(q.pick(['Blades inspected, leading-edge erosion dressed within limits.', 'Blades inspected, no nicks.']) + ' Beta feedback ring and carbon block inspected; spinner and bulkhead secure.');
  else out.push(q.pick(['Blades inspected, two leading-edge nicks dressed within limits.', 'Blades inspected, no nicks or erosion beyond limits.', 'Blades inspected, erosion dressed and touched up.']) + ' Hub, spinner and bulkheads inspected; mounting bolt safety wire secure.');
  for (const ad of adsOf(m)) if (ad.atInspection && bookFor(ad.ata) === 'propeller') out.push(adText(c, day, ad, tt));
  if (type === 'annual' || (type === 'phase' && n === 1)) for (const a of altsIn(c, day, 'propeller')) out.push(altInspected(a));
  const what = type === 'phase' ? `Phase ${n} of the approved aircraft inspection program` : type === 'annual' ? 'an annual inspection' : 'a 100-hour inspection';
  return {
    text: out.join(' '),
    ref: p ? `${icaRef(p)}; 14 CFR 43 App. D` : `IAW ${s.family} MM Ch. 5; Beaumont propeller manual 61-00`,
    cert: `I certify that this propeller has been inspected in accordance with ${what} and was determined to be in airworthy condition.`,
  };
}

function phaseBody(c: Ctx, day: number, n: number): Body {
  const tt = c.clock.ttAt(day);
  const out = [`Phase ${n} inspection IAW ${c.s.family} MM Chapter 5, approved aircraft inspection program (14 CFR 91.409(f)).`];
  for (const ad of adsOf(c.m)) if (ad.atInspection && bookFor(ad.ata) === 'airframe') out.push(adText(c, day, ad, tt));
  if (n === 1) for (const a of altsIn(c, day, 'airframe')) out.push(altInspected(a));
  out.push('Engine and propeller: see engine and propeller logbooks.');
  return {
    text: out.join(' '),
    ref: `IAW ${c.s.family} MM Ch. 5 (AAIP Phase ${n})`,
    cert: `I certify that this aircraft has been inspected in accordance with Phase ${n} of the approved aircraft inspection program and was determined to be in airworthy condition.`,
  };
}

/** the turbine's engine items of a phase, in the engine logbook */
function phaseEngineBody(c: Ctx, day: number, n: number): Body {
  const { s } = c;
  const out = [
    `Phase ${n} inspection, engine, IAW ${s.engineMaker} ${s.engineModel} maintenance manual and the approved aircraft inspection program.`,
    'Oil level and chip detector checked: clean. Compressor wash accomplished.',
    n % 2 ? 'Engine mounts, fuel and oil lines inspected; no leaks.' : 'Igniter plugs and fuel nozzles inspected; start and generator output normal on the ground run.',
  ];
  if (n === 1) for (const a of altsIn(c, day, 'engine')) out.push(altInspected(a));
  return {
    text: out.join(' '),
    ref: `IAW ${s.engineMaker} ${s.engineModel} MM; AAIP Phase ${n}`,
    cert: `I certify that this engine has been inspected in accordance with Phase ${n} of the approved aircraft inspection program and was determined to be in airworthy condition.`,
  };
}

/** annual + 100-hour (carried for hire, 14 CFR 91.409(b)); the turbine flies a 4-phase AAIP at 200 hr */
function inspectionEvents(c: Ctx, r: Rng, startDay: number, endDay: number, ttStart: number): { evs: Ev[]; insp: { day: number; tt: number }[] } {
  const { clock } = c;
  const evs: Ev[] = [];
  const insp: { day: number; tt: number }[] = [];
  // one inspection, recorded in each book: airframe, engine(s), propeller(s), signed by the same mechanic
  const trio = (day: number, kind: 'annual' | '100hr' | 'phase', who: Who, af: (cx: Ctx) => Body, eng: (cx: Ctx, pos?: Pos) => Body, prop: (cx: Ctx, pos?: Pos) => Body) => {
    const sig = `insp${day}`;
    evs.push({ day, book: 'airframe', kind, ata: '05-20', key: kind, who, sig, body: af });
    evs.push({ day, book: 'engine', kind, ata: '05-20', key: kind, who, sig, body: eng });
    evs.push({ day, book: 'propeller', kind, ata: '61-10', key: kind, who, sig, body: prop });
  };
  if (c.s.inspection === 'phase') {
    let phase = r.int(1, 4);
    let last = ttStart - r.range(20, 180);
    for (;;) {
      const day = clock.dayAt(last + 200 - r.range(0.5, 12));
      if (day > endDay) break;
      const n = phase;
      trio(day, 'phase', r.chance(0.5) ? 'shop' : 'ia', (cx) => phaseBody(cx, day, n), (cx) => phaseEngineBody(cx, day, n), (cx, pos) => propInspBody(cx, day, 'phase', pos, n));
      last = clock.ttAt(day);
      insp.push({ day, tt: last });
      phase = (phase % 4) + 1;
    }
    return { evs, insp };
  }
  const annMonth = r.int(1, 12);
  const annDate = r.int(3, 26);
  const anniversary = (year: number) => dayOf(`${year}-${pad(annMonth, 2)}-${pad(annDate, 2)}`);
  let year = new Date(startDay * DAY_MS).getUTCFullYear();
  let nextAnnual = anniversary(year);
  while (nextAnnual < startDay) nextAnnual = anniversary(++year);
  // hours at the last inspection as the regulation counts them (an overflight is not a fresh start)
  let last = ttStart - r.range(8, 85);
  for (;;) {
    let target = last + 100 - r.range(0.5, 7);
    let over = 0;
    if (r.chance(0.07)) {
      over = r1(r.range(1.5, 9));
      target = last + 100 + over;
    }
    const d100 = clock.dayAt(target);
    if (nextAnnual <= d100) {
      if (nextAnnual > endDay) break;
      const day = nextAnnual;
      trio(day, 'annual', 'ia', (cx) => inspBody(cx, day, 'annual', 0), (cx, pos) => engineInspBody(cx, day, 'annual', pos), (cx, pos) => propInspBody(cx, day, 'annual', pos));
      last = clock.ttAt(day);
      insp.push({ day, tt: last });
      nextAnnual = anniversary(++year);
    } else {
      if (d100 > endDay) break;
      const day = d100;
      const o = over;
      trio(day, '100hr', r.chance(0.3) ? 'ia' : 'crew', (cx) => inspBody(cx, day, '100hr', o), (cx, pos) => engineInspBody(cx, day, '100hr', pos), (cx, pos) => propInspBody(cx, day, '100hr', pos));
      last = over ? last + 100 : clock.ttAt(day);
      insp.push({ day, tt: clock.ttAt(day) });
    }
  }
  return { evs, insp };
}

/** piston engines: oil and filter at 50 hr between inspections (the inspection itself changes it too) */
function oilEvents(c: Ctx, r: Rng, insp: { day: number; tt: number }[], endDay: number): Ev[] {
  if (c.s.inspection === 'phase') return [];
  const evs: Ev[] = [];
  const qt = c.m === 'twin' ? 12 : 11;
  for (let i = 0; i < insp.length; i++) {
    const next = i + 1 < insp.length ? insp[i + 1].tt : c.clock.ttAt(endDay) + 60;
    const target = insp[i].tt + r.range(46, 54);
    if (target > next - 12) continue;
    const day = c.clock.dayAt(target);
    if (day > endDay) continue;
    evs.push({
      day,
      book: 'engine',
      kind: 'oil',
      ata: '79-00',
      key: 'oil',
      who: 'crew',
      sig: `oil${day}`,
      body: () => ({
        text: `Oil and filter changed: ${qt} qt SAE J1899 20W-50 ashless dispersant; filter P/N BAE-481${c.s.k} opened and inspected, no metal. Oil screens clean.`,
        ref: `IAW ${c.s.engineMaker} ${c.s.engineModel} maintenance manual, oil servicing`,
        pns: [{ on: `BAE-481${c.s.k}` }],
      }),
    });
  }
  return evs;
}

/** repeat by hours: first at start + [a0, a1], then every [i0, i1] hours */
function everyHours(c: Ctx, r: Rng, ttStart: number, endDay: number, first: [number, number], gap: [number, number]): number[] {
  const days: number[] = [];
  let h = ttStart + r.range(...first);
  for (;;) {
    const day = c.clock.dayAt(h);
    if (day > endDay) return days;
    days.push(day);
    h += r.range(...gap);
  }
}

const sn = (seed: number, prefix: string) => `${prefix}${rng(seed).int(10000, 99999)}`;

function componentEvents(c: Ctx, r: (tag: string) => Rng, startDay: number, endDay: number, ttStart: number): Ev[] {
  const { m, s } = c;
  const evs: Ev[] = [];
  const span = endDay - startDay;
  const sideOf = (day: number, both = true) => rng(hashSeed(day, 'side')).pick(both ? ['LH', 'RH', 'LH and RH'] : ['LH', 'RH']);

  // tires: a main tire every 170-320 hr of charter work
  for (const day of everyHours(c, r('tires'), ttStart, endDay, [30, 220], [170, 320])) {
    evs.push({
      day, book: 'airframe', kind: 'tire', ata: '32-40', key: 'tire', who: 'crew',
      body: (cx) => {
        const env = envAt(cx, '32-40', day);
        const fig = buildFigure(m, '32-40', env);
        const alt = rng(hashSeed(day, 'alt-tire')).chance(0.25);
        const tire = alt ? fig.rows.find((x) => x.tag === 'tire' && x.alt)!.pn : rowFor(fig, 'tire')!.pn;
        const tube = rowFor(fig, 'tube')!.pn;
        const side = sideOf(day);
        const where = m === 'float' ? ` (${side === 'LH and RH' ? 'both floats' : side + ' float'})` : '';
        return {
          text: `${side} main tire${side.includes('and') ? 's' : ''} worn to the wear-indicator groove${where}. Replaced with P/N ${tire}${alt ? ' (IPC alternate)' : ''}, new tube P/N ${tube}. Wheel halves inspected, bearings cleaned, inspected and repacked (MIL-PRF-81322). Tie-bolt nuts torqued ${tq(torqueOf(m, '32-40', env, 'tieNut'))}. Inflated to ${s.tire.psi} psi.`,
          ref: mm(cx, '32-40-01'),
          pns: [{ on: tire }, { on: tube }],
        };
      },
    });
  }

  // brake linings
  for (const day of everyHours(c, r('linings'), ttStart, endDay, [80, 520], [420, 700])) {
    evs.push({
      day, book: 'airframe', kind: 'brake', ata: '32-40', key: 'lining', who: 'crew',
      body: (cx) => {
        const p = plantedAt(cx, '32-40', day);
        if (p) {
          // metallic linings outlast the OEM ones: since the kit went on they have only been measured,
          // and the ICA parts replaced so far went on by company engineering authorization (GMM parts control)
          const q = rng(hashSeed(day, 'kit-brake'));
          const side = q.pick(['LH', 'RH']);
          const worn = Math.max(0.15, 0.3 - (cx.clock.ttAt(day) - cx.clock.ttAt(p.day)) * 0.00016 - q.range(0, 0.02));
          const lin = `Linings measured ${worn.toFixed(2).replace(/^0/, '')} in (ICA minimum .125 in).`;
          if (q.chance(0.5))
            return {
              text: `${side} brake chattering on taxi. Back plate bolts P/N ${plantPn(p, 'backPlateBolt')} found below torque; re-torqued 110-120 in-lb per ICA. ${lin} Discs within ICA limits. Taxi check normal.`,
              ref: icaRef(p),
            };
          const ea = eaNo(p, plantPn(p, 'disc')!);
          return {
            text: `${side} vented disc worn below ICA minimum thickness. Replaced ${side} disc with P/N ${plantPn(p, 'disc')}; new back plate bolts P/N ${plantPn(p, 'backPlateBolt')} torqued 110-120 in-lb per ICA. ${lin} ${eaLine(ea)}`,
            ref: `${icaRef(p)}; ${ea}`,
            pns: [{ on: plantPn(p, 'disc') }, { on: plantPn(p, 'backPlateBolt') }],
          };
        }
        const env = envAt(cx, '32-40', day);
        const fig = buildFigure(m, '32-40', env);
        const lining = rowFor(fig, 'lining')!.pn;
        const q = pmaAt(cx, '32-40', day);
        if (q)
          return {
            text: `Brake linings worn to 0.100 in. Replaced LH and RH main brake linings with FAA-PMA P/N ${q.pn} (${q.def.holder}; replaces ${lining}; ${q.def.eligibility}), riveted with P/N ${rowFor(fig, 'rivet')!.pn}. Discs measured within limits. Back plate bolts torqued ${tq(torqueOf(m, '32-40', env, 'backPlateBolt'))}. Linings conditioned per MM.`,
            ref: `${mm(cx, '32-40-02')}; FAA-PMA ${q.pn}`,
            pns: [{ on: q.pn }],
          };
        return {
          text: `Brake linings worn to 0.100 in. Replaced LH and RH main brake linings with P/N ${lining}, riveted with P/N ${rowFor(fig, 'rivet')!.pn}. Discs measured within limits. Back plate bolts torqued ${tq(torqueOf(m, '32-40', env, 'backPlateBolt'))}. Linings conditioned per MM.`,
          ref: mm(cx, '32-40-02'),
          pns: [{ on: lining }],
        };
      },
    });
  }

  // propeller: piston props come off for overhaul on the calendar limit
  const pr = r('prop');
  if (s.inspection !== 'phase' && pr.chance(0.6)) {
    const day = startDay + pr.int(Math.round(span * 0.1), Math.round(span * 0.95));
    const pos = m === 'twin' ? (sideOf(day, false) as Pos) : undefined;
    evs.push({
      day, book: 'propeller', kind: 'component', ata: '61-10', key: 'prop', who: 'crew', pos,
      body: (cx) => {
        const p = plantedAt(cx, '61-10', day);
        const unit = `${pos ? `${pos} propeller` : 'Propeller'} S/N ${propSnAt(cx, day, pos)}`;
        if (p) {
          // the bolts came off with it and went back on: the new bolt set the job needs is their first replacement
          if (rng(hashSeed(day, 'kit-prop')).chance(0.5)) {
            const ea = eaNo(p, plantPn(p, 'spinner')!);
            return {
              text: `${unit} removed: spinner dome cracked at two screw holes. Replaced spinner assembly with P/N ${plantPn(p, 'spinner')} per ICA. ${eaLine(ea)} Propeller reinstalled; mounting bolts P/N ${plantPn(p, 'propBolt')} inspected serviceable and reused, torqued 80-85 ft-lb and safety wired. Track within 1/8 in.`,
              ref: `${icaRef(p)}; ${ea}`,
              pns: [{ on: plantPn(p, 'spinner') }],
            };
          }
          return {
            text: `${unit} removed for blade erosion shield repair per ICA (composite blades). Reinstalled with new hub O-ring P/N ${plantPn(p, 'hubOring')}; mounting bolts P/N ${plantPn(p, 'propBolt')} inspected serviceable and reused, torqued 80-85 ft-lb and safety wired. Track within 1/8 in.`,
            ref: icaRef(p),
          };
        }
        const env = envAt(cx, '61-10', day);
        const fig = buildFigure(m, '61-10', env);
        const prop = rowFor(fig, 'propeller')!.pn;
        const bolt = rowFor(fig, 'propBolt')!.pn;
        return {
          text: `${unit} removed and sent for overhaul (calendar limit); overhauled by a Beaumont-authorized repair station (8130-3 on file) and reinstalled, 0.0 hr since overhaul. New hub O-ring P/N ${rowFor(fig, 'hubOring')!.pn}. Mounting bolts P/N ${bolt} torqued ${tq(torqueOf(m, '61-10', env, 'propBolt'))} and safety wired. Track within 1/16 in; dynamic balance 0.07 ips.`,
          ref: mm(cx, '61-10-01'),
          pns: [{ on: prop }, { on: bolt }],
        };
      },
    });
  }
  // propeller: dynamic balance and spinner work between inspections
  const pb = r('prop-balance');
  for (let i = pb.int(1, 3); i > 0; i--) {
    const day = startDay + pb.int(20, span - 10);
    const pos = m === 'twin' ? (pb.pick(['LH', 'RH']) as Pos) : undefined;
    const before = r1(pb.range(0.25, 0.6));
    const after = r1(pb.range(0.03, 0.09) * 10) / 10;
    const weights = pb.int(1, 3);
    evs.push({
      day, book: 'propeller', kind: 'repair', ata: '61-10', key: 'balance', who: 'crew', pos,
      body: (cx) => {
        const p = plantedAt(cx, '61-10', day);
        return {
          text: `${pos ? `${pos} propeller` : 'Propeller'} S/N ${propSnAt(cx, day, pos)}: vibration in cruise reported. Dynamic balance ${before.toFixed(2)} ips; ${weights} balance weight${weights > 1 ? 's' : ''} added at the spinner bulkhead, ${after.toFixed(2)} ips after. Spinner screws torqued 20-25 in-lb.`,
          ref: p ? icaRef(p) : mm(cx, '61-10-02'),
        };
      },
    });
  }

  // alternator / starter-generator changes: engine accessories, in the engine logbook
  const ar = r('alternator');
  for (let i = ar.int(0, 2); i > 0; i--) {
    const day = startDay + ar.int(30, span - 5);
    const pos = m === 'twin' ? (sideOf(day, false) as Pos) : undefined;
    evs.push({
      day, book: bookFor('24-30'), kind: 'component', ata: '24-30', key: 'alt', who: 'crew', pos,
      body: (cx) => {
        const p = plantedAt(cx, '24-30', day);
        const side = pos ? `${pos} ` : '';
        if (p) {
          // the converted unit itself has not failed yet: the ICA parts replaced so far went on by engineering authorization
          const ea = eaNo(p, m === 'cargo' ? 'VM-GCU-3' : plantPn(p, 'belt')!);
          if (m === 'cargo')
            return {
              text: `Repeated GEN OV trips; GCU fault log reviewed per ICA. Replaced generator control unit P/N ${p.def.rows.find((x) => x.pn.startsWith('VM-GCU'))!.pn}. ${eaLine(ea)} Ground run: start and generator output normal, no faults logged.`,
              ref: `${icaRef(p)}; ${ea}`,
              pns: [{ on: p.def.rows.find((x) => x.pn.startsWith('VM-GCU'))!.pn }],
            };
          return {
            text: `${side}alternator belt glazed and slipping. Replaced V-belt with P/N ${plantPn(p, 'belt')} per ICA, tensioned 11-13 ft-lb slip (new belt). ${eaLine(ea)} Ground run 28.2 V.`,
            ref: `${icaRef(p)}; ${ea}`,
            pns: [{ on: plantPn(p, 'belt') }],
          };
        }
        const env = envAt(cx, '24-30', day);
        const pn = rowFor(buildFigure(m, '24-30', env), 'generator')!.pn;
        const a = sn(hashSeed(day, 'a1'), 'H');
        const b = sn(hashSeed(day, 'a2'), 'H');
        if (m === 'cargo')
          return {
            text: `Starter-generator brushes at wear limit. Removed S/G P/N ${pn} S/N ${a}, installed exchange unit P/N ${pn} S/N ${b}. Drive spline lubricated, V-band clamp torqued ${tq(torqueOf(m, '24-30', env, 'vband'))}. Ground run: start and generator output normal.`,
            ref: mm(cx, '24-30-01'),
            pns: [{ off: pn, on: pn }],
          };
        return {
          text: `${side}alternator no output (open diode). Removed P/N ${pn} S/N ${a}, installed exchange unit P/N ${pn} S/N ${b}. Pulley nut torqued ${tq(torqueOf(m, '24-30', env, 'pulleyNut'))}, used belt tensioned 7-9 ft-lb slip. Ground run 28.1 V.`,
          ref: mm(cx, '24-30-01'),
          pns: [{ off: pn, on: pn }],
        };
      },
    });
  }

  // com radio sent out for repair
  const rr = r('radio');
  for (let i = rr.int(0, 2); i > 0; i--) {
    const day = startDay + rr.int(30, span - 5);
    evs.push({
      day, book: 'airframe', kind: 'component', ata: '23-10', key: 'radio', who: 'avionics',
      body: (cx) => {
        const p = plantedAt(cx, '23-10', day);
        if (p) {
          if (rng(hashSeed(day, 'kit-radio')).chance(0.5)) {
            const ea = eaNo(p, plantPn(p, 'connector')!);
            return {
              text: `GPS/NAV/COM transmit intermittent. Unit P/N ${plantPn(p, 'radio')} pulled; two bent pins in the tray connector. Replaced connector kit with P/N ${plantPn(p, 'connector')} per ICA. ${eaLine(ea)} Unit reinstalled, cam lock seated per ICA. Ops check good.`,
              ref: `${icaRef(p)}; ${ea}`,
              pns: [{ on: plantPn(p, 'connector') }],
            };
          }
          return {
            text: `GPS/NAV/COM P/N ${plantPn(p, 'radio')} removed for navigation database update and reinstalled; cam lock seated per ICA. Ops check good.`,
            ref: icaRef(p),
          };
        }
        const radio = pnAt(cx, '23-10', day, 'radio');
        return {
          text: `Com transmit intermittent. Removed VHF com P/N ${radio} S/N ${sn(hashSeed(day, 'com'), 'T')}; bench repaired and reinstalled. Tray connector pins inspected, good. Ops check good on ground and tower frequencies.`,
          ref: mm(cx, '23-10-01'),
          pns: [{ off: radio, on: radio }],
        };
      },
    });
  }

  // hydraulic power pack service
  for (const day of everyHours(c, r('hydraulic'), ttStart, endDay, [100, 500], [450, 650])) {
    evs.push({
      day, book: 'airframe', kind: 'component', ata: '29-10', key: 'hyd', who: 'crew',
      body: (cx) => {
        const p = plantedAt(cx, '29-10', day);
        if (p) {
          // the element is on condition (bypass indicator) in the ICA: it has not been due since the conversion
          const run = rng(day).int(6, 9);
          if (rng(hashSeed(day, 'kit-hyd')).chance(0.5)) {
            const ea = eaNo(p, plantPn(p, 'resCap')!);
            return {
              text: `Power pack serviced per ICA: fluid sample clean; filter bypass indicator not extended (element on condition per ICA). Vented filler cap cracked; replaced with P/N ${plantPn(p, 'resCap')}. ${eaLine(ea)} Reservoir filled, MIL-PRF-5606. Gear swing on jacks normal, pump run ${run} s.`,
              ref: `${icaRef(p)}; ${ea}`,
              pns: [{ on: plantPn(p, 'resCap') }],
            };
          }
          return {
            text: `Power pack serviced per ICA: fluid sample clean; filter bypass indicator not extended (element on condition per ICA). Reservoir filled, MIL-PRF-5606. Gear swing on jacks normal, pump run ${run} s.`,
            ref: icaRef(p),
          };
        }
        const env = envAt(cx, '29-10', day);
        const fig = buildFigure(m, '29-10', env);
        const filter = rowFor(fig, 'filter')!.pn;
        const q = pmaAt(cx, '29-10', day);
        if (q)
          return {
            text: `Hydraulic power pack serviced: filter element replaced with FAA-PMA P/N ${q.pn} (${q.def.holder}; replaces ${filter}; ${q.def.eligibility}), bowl O-ring P/N ${rowFor(fig, 'bowlOring')!.pn}; bowl torqued ${tq(torqueOf(m, '29-10', env, 'filterBowl'))} and safety wired. Reservoir filled to FULL with MIL-PRF-5606. Gear swing on jacks normal, pump run ${rng(day).int(6, 9)} s.`,
            ref: `${mm(cx, '29-10-01')}; FAA-PMA ${q.pn}`,
            pns: [{ on: q.pn }],
          };
        return {
          text: `Hydraulic power pack serviced: filter element replaced with P/N ${filter}, bowl O-ring P/N ${rowFor(fig, 'bowlOring')!.pn}; bowl torqued ${tq(torqueOf(m, '29-10', env, 'filterBowl'))} and safety wired. Reservoir filled to FULL with MIL-PRF-5606. Gear swing on jacks normal, pump run ${rng(day).int(6, 9)} s.`,
          ref: mm(cx, '29-10-01'),
          pns: [{ on: filter }],
        };
      },
    });
  }

  // pitot-static / transponder (IFR: 91.411 + 91.413; VFR: transponder only), every 24 calendar months
  const cr = r('checks');
  for (let day = startDay + cr.int(20, 700); day <= endDay; day += cr.int(690, 725)) {
    evs.push({
      day, book: 'airframe', kind: 'check', ata: '34-10', key: 'check', who: 'avionics',
      body: () => ({
        text: s.ifr
          ? `Altimeter, static system and altitude reporting tested IAW 14 CFR 91.411 and Part 43 App. E to 20,000 ft; transponder tested IAW 91.413 and App. F. No discrepancies.`
          : `Transponder and altitude reporting tested IAW 14 CFR 91.413 and Part 43 App. F. No discrepancies.`,
        ref: s.ifr ? '14 CFR 91.411 / 91.413' : '14 CFR 91.413',
      }),
    });
  }

  // ELT battery
  const er = r('elt');
  const eltDay = startDay + er.int(40, span - 20);
  evs.push({
    day: eltDay, book: 'airframe', kind: 'elt', ata: '25-60', key: 'elt', who: 'crew',
    body: () => ({
      text: `ELT battery replaced (P/N BA-406-${s.k}), new expiration ${pad(new Date(eltDay * DAY_MS).getUTCMonth() + 1, 2)}/${new Date(eltDay * DAY_MS).getUTCFullYear() + 6}. ELT tested IAW 14 CFR 91.207(d); registration current.`,
      ref: '14 CFR 91.207',
      pns: [{ on: `BA-406-${s.k}` }],
    }),
  });

  // ordinary squawks
  const pool: [string, string][] = [
    ['33-40', 'LH nav light lens cracked. Replaced lens; light checks good.'],
    ['52-10', 'Cabin door seal torn. Replaced seal; door closes and latches normally.'],
    ['28-10', 'RH fuel cap O-ring hard and cracked. Replaced O-ring; no leaks.'],
    ['25-10', 'Seat 3 cushion upholstery torn. Repaired.'],
    ['33-40', 'Taxi light inoperative. Replaced lamp; ops check good.'],
    ['23-50', 'Intercom jack at seat 4 intermittent. Replaced jack; ops check good.'],
    ['24-60', 'Wire bundle ties behind panel broken. Replaced ties; no chafing found.'],
    ['56-10', 'Windshield fairing screw grommets cracked. Replaced.'],
    ['71-10', 'Lower cowl skin crack 0.4 in at fastener. Stop-drilled 1/8 in, within MM limits.'],
    ['32-60', 'Gear-down light intermittent. Cleaned and adjusted down-lock switch; indication normal on gear swing.'],
    ['21-40', m === 'cargo' ? 'Cabin heat valve sticky. Cleaned and lubricated.' : 'Heater shroud inspected (cabin CO test 0 ppm). No cracks.'],
    ['31-20', 'Cabin clock / OAT display dim. Replaced display lamp.'],
    ['79-20', m === 'cargo' ? 'Oil cooler hose clamp loose. Re-torqued; no leak on run.' : 'Oil cooler hose seeping. Replaced hose; no leak on run.'],
  ];
  const sr = r('squawks');
  const count = sr.int(6, 11);
  const picks = sr.shuffle([...pool.keys()]).slice(0, count);
  for (const i of picks) {
    const [ata, text] = pool[i];
    const day = startDay + sr.int(10, span - 3);
    const pos = m === 'twin' && bookFor(ata) === 'engine' ? (sideOf(day, false) as Pos) : undefined;
    evs.push({ day, book: bookFor(ata), kind: 'repair', ata, key: 'repair', who: 'crew', pos, body: (cx) => ({ text, ref: mm(cx, `${ata}-00`) }) });
  }
  return evs;
}

// ---------------------------------------------------------------------------
// The aircraft record
// ---------------------------------------------------------------------------

export type AircraftOpts = {
  /** plant exactly one logbook-recorded STC that replaced this assembly */
  plant?: Ata;
  /**
   * how the planted part got there: 'stc' (default), 'field' (the same kit on a
   * field-approved Form 337), or 'pma' (the last replacement used an FAA-PMA
   * part; 32-40 linings and 29-10 filter elements only, and only when the log
   * has such a replacement: otherwise `plant` stays unset).
   */
  via?: PlantVia;
};

const FIG_SB_TAGS: Record<Ata, string[]> = {
  '32-40': ['brake', 'lining', 'backPlate'],
  '61-10': ['propBolt'],
  '29-10': ['resCap'],
  '23-10': ['radio'],
  '24-30': ['generator'],
};

const holderCode = (holder: string) =>
  holder
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .replace(/[^A-Z]/g, '')
    .slice(0, 3);

/**
 * The stable record for one plane on one island. Same inputs, same airplane.
 * `opts.plant` adds one STC (with its logbook entry, Form 337 and ICA parts
 * list) that replaced the assembly for that ATA; everything else is unchanged.
 */
export function aircraftOf(islandSeed: number, assetId: string, model: string, opts: AircraftOpts = {}): Aircraft {
  const m = planeModel(model);
  const s = SPECS[m];
  const base = hashSeed('aircraft', islandSeed, assetId, m);
  const R = (tag: string) => rng(hashSeed(base, tag));

  // identity
  const id = R('identity');
  const registration = registrationOf(id, m);
  const snNum = id.int(12, s.snMax - 8);
  const year = Math.min(s.years[1], s.years[0] + Math.floor((snNum / s.snMax) * (s.years[1] - s.years[0] + 1)));
  const engines: EngineRec[] = Array.from({ length: s.engineCount }, (_, i) => ({
    position: s.engineCount === 2 ? (i === 0 ? 'LH' : 'RH') : 'Engine',
    model: s.engineModel,
    serial: m === 'cargo' ? `NTE-${id.int(20000, 69999)}` : `${id.int(100000, 999999)}-R`,
    tsmoh: r1(id.range(200, s.tbo * 0.85)),
    tbo: s.tbo,
  }));
  const builtDay = dayOf(`${year}-${pad(id.int(1, 12), 2)}-15`);

  // time
  const t = R('time');
  const asOfDay = dayOf('2026-02-01') + t.int(0, 150);
  const startDay = asOfDay - Math.round(s.spanYears * 365.25);
  const span = asOfDay - startDay;
  const ttStart = r1(t.range(...s.ttStart));
  const util = t.range(...s.util);
  const clock = makeClock(t, startDay, asOfDay, ttStart, util);
  const tachOffset = r1(t.range(0.2, 0.7) * ttStart);
  // before the current logbook: hours grew from zero at delivery to ttStart
  const ttOf = (day: number) => r1(day >= startDay ? clock.ttAt(day) : Math.max(1, (ttStart * (day - builtDay)) / (startDay - builtDay)));

  const snB = Object.fromEntries(IPC_ATAS.map((a) => [a, snNum >= s.brk[a]])) as Record<Ata, boolean>;
  // propeller serials: the OEM units, and the ones a planted propeller STC would put on
  const psr = R('props');
  const propSn = Object.fromEntries((m === 'twin' ? ['LH', 'RH'] : ['Prop']).map((p) => [p, { oem: `FN${psr.int(10000, 99999)}`, stc: `SP${psr.int(10000, 99999)}` }]));
  const ctx: Ctx = { m, s, snB, sbDay: {}, clock, alts: [], propSn };
  const evs: Ev[] = [];
  /** 40% of old compliance happened before the current logbook was opened */
  const whenDone = (r: Rng, lateFrac: number) =>
    r.chance(0.4) ? Math.max(builtDay + 30, startDay - r.int(60, 2400)) : startDay + r.int(20, Math.round(span * lateFrac));

  // service bulletins: the five figure SBs change IPC effectivity; the rest are noise
  const sbr = R('sbs');
  const sbs: SbRecord[] = [];
  const sbsOpen: Aircraft['sbsOpen'] = [];
  for (const ata of IPC_ATAS) {
    const sb = figSb(m, ata);
    if (!sbr.chance(0.55)) {
      sbsOpen.push({ id: sb.id, title: sb.title, ata });
      continue;
    }
    const day = whenDone(sbr, 0.6);
    ctx.sbDay[ata] = day;
    sbs.push({ id: sb.id, title: sb.title, ata, date: isoOf(day), tt: ttOf(day), ipcAta: ata });
    evs.push({
      day, book: bookFor(ata), kind: 'sb', ata, key: 'sb', who: 'crew',
      body: () => {
        const pre = buildFigure(m, ata, { snB: snB[ata], postSb: false });
        const post = buildFigure(m, ata, { snB: snB[ata], postSb: true });
        const tags = FIG_SB_TAGS[ata];
        const off = tags.map((x) => rowFor(pre, x)!.pn);
        const on = tags.map((x) => rowFor(post, x)!.pn);
        return {
          text: `Complied with ${sb.id} (${sb.title}). Removed P/N ${off.join(', ')}; installed P/N ${on.join(', ')}.`,
          ref: `IAW ${sb.id}`,
          pns: tags.map((_, i) => ({ off: off[i], on: on[i] })),
        };
      },
    });
  }
  for (const sb of otherSbs(m)) {
    if (!sbr.chance(0.6)) {
      sbsOpen.push(sb);
      continue;
    }
    const day = whenDone(sbr, 0.95);
    sbs.push({ ...sb, date: isoOf(day), tt: ttOf(day) });
    evs.push({ day, book: bookFor(sb.ata), kind: 'sb', ata: sb.ata, key: 'sb', who: 'crew', body: () => ({ text: `Complied with ${sb.id} (${sb.title}): inspected, no defects found.`, ref: `IAW ${sb.id}` }) });
  }
  sbs.sort((a, b) => a.date.localeCompare(b.date));

  // STCs and field approvals already on the airframe (none of them touch an IPC assembly)
  const str = R('stcs');
  const alterations: Alteration[] = str
    .shuffle(stcPool(m))
    .slice(0, str.int(2, 3))
    .map((d, i) => {
      const day = str.chance(0.5) ? Math.max(builtDay + 60, startDay - str.int(100, 3000)) : startDay + str.int(20, span - 20);
      const stc = d.field ? undefined : stcNumber(str);
      const a: Alteration = {
        id: `ALT-${i + 1}`,
        kind: d.field ? 'field' : 'stc',
        holder: d.holder,
        title: d.title,
        ata: d.ata,
        date: isoOf(day),
        tt: ttOf(day),
        form337: isoOf(day),
        ica: d.field ? 'Form 337 block 8 (ICA)' : `${d.holder.split(' ')[0]} ICA ${holderCode(d.holder)}-${d.ata.slice(0, 2)}, Rev ${'ABC'[str.int(0, 2)]}`,
        weightLb: d.weightLb,
      };
      if (stc) a.stc = stc;
      const w = `${d.weightLb > 0 ? '+' : ''}${d.weightLb} lb`;
      evs.push({
        day, book: 'airframe', kind: 'stc', ata: d.ata, key: 'stc', who: 'ia',
        body: () => ({
          text: `Installed ${/^[A-Z][a-z]/.test(d.title) ? d.title.charAt(0).toLowerCase() + d.title.slice(1) : d.title} IAW ${stc ? `STC ${stc} (${d.holder})` : 'FAA Form 337 field approval'}. Weight and balance revised (${w}), equipment list updated, ${a.ica} inserted in aircraft records. See FAA Form 337 dated ${fmtDate(a.form337)}.`,
          ref: stc ? `per STC ${stc}, Form 337 dated ${fmtDate(a.form337)}` : `per FAA Form 337 (field approval) dated ${fmtDate(a.form337)}`,
        }),
      });
      return a;
    });

  // the planted case: one STC (or the same kit on a field-approved 337) that replaced an IPC assembly
  let plant: PlantState | undefined;
  const via: PlantVia = opts.via ?? 'stc';
  if (opts.plant && via !== 'pma') {
    const ata = opts.plant;
    const pr = R(`plant:${ata}`);
    let lo = startDay + Math.round(span * 0.15);
    const hi = asOfDay - Math.round(span * 0.2);
    const sd = ctx.sbDay[ata];
    if (sd !== undefined && sd + 14 > lo) lo = sd + 14;
    const day = pr.int(lo, Math.max(lo, hi));
    const def = plantDef(m, ata);
    const stc = stcNumber(pr);
    const field = via === 'field';
    const d337 = fmtDate(isoOf(day));
    const alt: Alteration = {
      id: 'ALT-P',
      kind: field ? 'field' : 'stc',
      holder: def.holder,
      title: def.title,
      ata,
      date: isoOf(day),
      tt: ttOf(day),
      form337: isoOf(day),
      ica: field ? `ICA attached to Form 337 dated ${d337}` : def.icaDoc,
      displaces: ata,
      parts: def.rows.map((x) => rowFrom(x, { snB: true, postSb: true })),
      icaNotes: def.icaNotes,
      weightLb: def.weightLb,
    };
    if (!field) alt.stc = stc;
    plant = { ata, day, via, stc: field ? '' : stc, basis: stc, def, alt };
    alterations.push(alt);
    // a twin's propellers and alternators are both converted: one 337, an entry in each unit's book
    const both = m === 'twin' && bookFor(ata) !== 'airframe';
    const lb = (n: number) => `${n > 0 ? '+' : ''}${r1(n)} lb`;
    const w = both ? `${lb(def.weightLb * 2)}, LH and RH` : lb(def.weightLb);
    evs.push({
      day, book: bookFor(ata), kind: 'stc', ata, key: 'plant', who: 'ia',
      body: (cx, pos) => {
        const before = figAt(cx, ata, day - 1);
        const sns = ata === '61-10' ? { off: ` S/N ${cx.propSn[pos ?? 'Prop'].oem}`, on: ` New propeller S/N ${cx.propSn[pos ?? 'Prop'].stc}.` } : { off: '', on: '' };
        const swap = `Removed ${def.off(before, pos)}${sns.off}. Installed ${def.on(pos)}`;
        return {
          // a field approval: the 337 is the approval (block 3); the STC holder's data is only the data it approved
          text: field
            ? `${swap} IAW FAA Form 337 dated ${d337}, field approved by the Honolulu FSDO (block 3); ${def.holder} STC ${stc} data used as acceptable data with the holder's permission letter.${sns.on} Weight and balance revised (${w}), equipment list updated, ICA attached to the Form 337 and inserted in aircraft records.`
            : `${swap} IAW STC ${stc} (${def.holder}) and ${def.icaDoc}.${sns.on} Weight and balance revised (${w}), equipment list updated, ICA inserted in aircraft records. See FAA Form 337 dated ${d337}.`,
          ref: field ? `per FAA Form 337 (field approval) dated ${d337}` : `per STC ${stc}, Form 337 dated ${d337}`,
          pns: [{ off: rowFor(before, def.tag)?.pn, on: def.rows.find((x) => x.tag === def.tag)!.pn }],
        };
      },
    });
  }
  ctx.plant = plant;
  ctx.alts = alterations;
  alterations.sort((a, b) => a.date.localeCompare(b.date));

  // inspections, oil, components, checks and squawks
  const ins = inspectionEvents(ctx, R('inspections'), startDay, asOfDay, ttStart);
  evs.push(...ins.evs, ...oilEvents(ctx, R('oil'), ins.insp, asOfDay), ...componentEvents(ctx, R, startDay, asOfDay, ttStart));

  // the PMA case: the last replacement of that part in these books used an FAA-PMA part
  if (opts.plant && via === 'pma') {
    const ata = opts.plant;
    const def = pmaDef(m, ata);
    // an SB that changes the part (32-40 linings) must be behind it, or the SB set is what is installed
    const sd = def && FIG_SB_TAGS[ata].includes(def.tag) ? ctx.sbDay[ata] : undefined;
    const last = def
      ? evs
          .filter((e) => e.key === def.key && e.ata === ata && e.day >= startDay && e.day <= asOfDay && (sd === undefined || e.day > sd))
          .sort((a, b) => a.day - b.day)
          .pop()
      : undefined;
    if (def && last) {
      const replaces = pnAt(ctx, ata, last.day, def.tag);
      ctx.pma = { ata, day: last.day, def, pn: def.pn(replaces), replaces };
    }
  }

  // airworthiness directives
  const adr = R('ads');
  const ads: AdRecord[] = [];
  for (const ad of adsOf(m)) {
    const na = IPC_ATAS.includes(ad.ata as Ata) && plant?.ata === ad.ata ? plant : undefined;
    let done: { day: number; tt: number }[];
    if (ad.atInspection) done = ins.insp.map((x) => ({ day: x.day, tt: x.tt }));
    else if (ad.every) {
      const all = everyHours(ctx, adr, ttStart, asOfDay, [0, ad.every], [ad.every - 15, ad.every - 1]);
      const firstNa = na ? all.findIndex((d) => d >= na.day) : -1;
      const days = firstNa >= 0 ? all.slice(0, firstNa + 1) : all;
      for (const day of days) evs.push({ day, book: bookFor(ad.ata), kind: 'ad', ata: ad.ata, key: 'ad', who: 'crew', body: (cx) => ({ text: adText(cx, day, ad, cx.clock.ttAt(day)) + (plantedAt(cx, ad.ata as Ata, day) ? '' : ' Recurring inspection: no cracks or defects found.'), ref: `IAW ${ad.id}` }) });
      done = days.map((day) => ({ day, tt: clock.ttAt(day) }));
      if (!done.length) done = [{ day: startDay - 30, tt: ttStart - adr.range(10, ad.every * 0.6) }];
    } else {
      const day = whenDone(adr, 0.5);
      if (day >= startDay)
        evs.push({ day, book: bookFor(ad.ata), kind: 'ad', ata: ad.ata, key: 'ad', who: 'crew', body: (cx) => ({ text: plantedAt(cx, ad.ata as Ata, day) ? adText(cx, day, ad, 0) : `${ad.id} (${ad.subject}) complied with by ${ad.moc}, no defects found. One-time AD; no repetitive action.`, ref: `IAW ${ad.id}` }) });
      done = [{ day, tt: ttOf(day) }];
    }
    const before = na ? done.filter((d) => d.day < na.day) : done;
    const last = before[before.length - 1] ?? done[0];
    const rec: AdRecord = {
      id: ad.id,
      subject: ad.subject,
      ata: ad.ata,
      method: ad.every ? 'recurring' : 'one-time',
      moc: ad.moc,
      last: { date: isoOf(last.day), tt: r1(last.tt) },
      note: na
        ? `N/A since ${fmtDate(isoOf(na.day))}: assembly replaced per ${approvalCite(na)}`
        : ad.every
          ? `Recurring every ${ad.every} hr in service`
          : 'One-time; no repetitive action',
    };
    if (ad.every) rec.every = ad.every;
    if (ad.every && !na) rec.nextDue = r1(last.tt + ad.every);
    ads.push(rec);
  }

  // print the books
  const cr = R('crew');
  const crew = [mechanic(cr, true)];
  while (crew.length < 3) {
    const next = mechanic(cr, false);
    if (!crew.some((x) => x.name.split(' ')[1] === next.name.split(' ')[1] || x.name[0] === next.name[0])) crew.push(next);
  }
  const shop = station(cr);
  const avionics = station(cr);
  const inLog = evs.filter((e) => e.day >= startDay && e.day <= asOfDay).sort((a, b) => a.day - b.day);
  const seen = new Map<string, number>();
  // a twin's engines and propellers each have their own book: work on both is written in each
  const unitsOf = (e: Ev): (Pos | undefined)[] => (m === 'twin' && e.book !== 'airframe' ? (e.pos === 'LH' || e.pos === 'RH' ? [e.pos] : ['LH', 'RH']) : [undefined]);
  const log: LogEntry[] = inLog.flatMap((e) =>
    unitsOf(e).map((pos) => {
      const iso = isoOf(e.day);
      const stem = `${e.book[0].toUpperCase()}${pos ? pos[0] : ''}${iso.replace(/-/g, '')}-${e.key}`;
      const n = (seen.get(stem) ?? 0) + 1;
      seen.set(stem, n);
      const eid = n > 1 ? `${stem}-${n}` : stem;
      const sig = e.sig ?? `${e.book}${iso}${e.key}${n}`;
      const who = e.who === 'ia' ? crew[0] : e.who === 'shop' ? shop : e.who === 'avionics' ? avionics : rng(hashSeed(base, 'sig', sig)).pick(crew);
      const b = e.body(ctx, pos);
      const tt = r1(clock.ttAt(e.day));
      const entry: LogEntry = { id: eid, date: iso, book: e.book, kind: e.kind, tach: r1(tt - tachOffset), tt, text: b.text, ref: b.ref, signer: who, signature: signatureOf(who) };
      if (pos) entry.pos = pos;
      if (e.ata) entry.ata = e.ata;
      if (b.pns) entry.pns = b.pns;
      if (b.cert) entry.cert = b.cert;
      return entry;
    }),
  );

  const ttNow = r1(clock.ttAt(asOfDay));
  const ac: Aircraft = {
    assetId,
    model: m,
    islandSeed,
    registration,
    maker: MAKER,
    designation: s.designation,
    typeCert: s.typeCert,
    description: s.description,
    serial: serialOf(m, snNum),
    snNum,
    year,
    meter: s.meter,
    tachOffset,
    tt: ttNow,
    tach: r1(ttNow - tachOffset),
    asOf: isoOf(asOfDay),
    logStart: isoOf(startDay),
    engineMaker: s.engineMaker,
    engines,
    propMaker: VENDORS.beaumont.name,
    prop: { hub: s.propHub, blades: s.propBlades, count: s.bladeCount },
    props: Object.entries(propSn).flatMap(([position, u]) => {
      const oem: PropUnit = { position: position as PropUnit['position'], maker: VENDORS.beaumont.name, model: `${s.propHub}/${s.propBlades}`, serial: u.oem };
      if (plant?.ata !== '61-10') return [oem];
      const k = s.k;
      return [oem, { position: position as PropUnit['position'], maker: plant.def.holder, model: `SPC-4${k}H/SC${k}4`, serial: u.stc, installed: isoOf(plant.day) }];
    }),
    manual: `${s.family} Maintenance Manual`,
    ipcTitle: `${s.family} Illustrated Parts Catalog`,
    sbs,
    sbsOpen,
    ads,
    alterations,
    log,
  };
  if (plant) {
    const installs = log.filter((e) => e.id.endsWith('-plant'));
    const entry = installs[0];
    const current = buildFigure(m, plant.ata, envAt(ctx, plant.ata, asOfDay));
    // later records cite the STC number, or for a field approval the 337 by its date
    const cite = plant.via === 'stc' ? plant.stc : `Form 337 dated ${fmtDate(plant.alt.form337)}`;
    ac.plant = {
      ata: plant.ata,
      via: plant.via,
      ref: approvalCite(plant),
      alterationId: plant.alt.id,
      stc: plant.stc,
      holder: plant.def.holder,
      ica: plant.alt.ica,
      form337: plant.alt.form337,
      entryId: entry.id,
      alsoEntryIds: installs.slice(1).map((e) => e.id),
      laterEntryIds: log.filter((e) => e.date > entry.date && (e.text.includes(cite) || e.ref.includes(cite))).map((e) => e.id),
      item: plant.def.item,
      ipcPn: rowFor(current, plant.def.tag)!.pn,
      neededPn: plant.def.rows.find((x) => x.tag === plant!.def.tag)!.pn,
    };
    if (plant.via === 'field') ac.plant.basisStc = plant.basis;
  } else if (ctx.pma) {
    const q = ctx.pma;
    const entry = log.find((e) => e.date === isoOf(q.day) && e.ata === q.ata && e.pns?.some((x) => x.on === q.pn))!;
    const current = buildFigure(m, q.ata, envAt(ctx, q.ata, asOfDay));
    ac.plant = {
      ata: q.ata,
      via: 'pma',
      ref: `FAA-PMA ${q.pn}`,
      alterationId: '',
      stc: '',
      holder: q.def.holder,
      ica: q.def.eligibility,
      form337: '',
      entryId: entry.id,
      alsoEntryIds: [],
      laterEntryIds: [],
      item: q.def.item,
      ipcPn: rowFor(current, q.def.tag)!.pn,
      neededPn: q.pn,
    };
  }
  return ac;
}

// ---------------------------------------------------------------------------
// Lookups a puzzle uses
// ---------------------------------------------------------------------------

/** the propeller at a position on a date ('LH' / 'RH' on the twin; anything else means the only one) */
export function propAt(ac: Aircraft, pos: string | undefined, date: string): PropUnit {
  const units = ac.props.filter((u) => (ac.model === 'twin' ? u.position === (pos ?? 'LH') : true));
  return [...units].reverse().find((u) => !u.installed || u.installed <= date) ?? units[0];
}

/** the serial number a logbook is kept for: the airframe, one engine, or one propeller (on that date) */
export function bookSerial(ac: Aircraft, book: LogBook, pos: Pos | undefined, date: string): string {
  if (book === 'airframe') return ac.serial;
  if (book === 'engine') return (ac.engines.find((e) => e.position === pos) ?? ac.engines[0]).serial;
  return propAt(ac, pos, date).serial;
}

/** "32-40", "32-40-01", "ATA 32-40", "79-20" -> the figure's ATA */
export function ataOf(x: string): AnyAta {
  const m = /(\d\d)-(\d\d)/.exec(x);
  const a = m ? `${m[1]}-${m[2]}` : '';
  if (!(ALL_ATAS as readonly string[]).includes(a)) throw new Error(`no IPC figure for "${x}" (have ${ALL_ATAS.join(', ')})`);
  return a as AnyAta;
}

const envOf = (ac: Aircraft, ata: Ata): Env => ({
  snB: ac.snNum >= SPECS[ac.model].brk[ata],
  postSb: ac.sbs.some((x) => x.id === figSb(ac.model, ata).id),
});

/**
 * The manufacturer's IPC figure for an assembly, with effectivity evaluated for
 * this aircraft's S/N and SB status. Like the real book, it knows nothing
 * about STCs: a planted alteration's parts are only in its ICA.
 */
export function ipcFor(ac: Aircraft, ata: AnyAta | string): IpcFigure {
  const a = ataOf(ata);
  // 79-20 has one row per item and no effectivity: the same page on every airplane of the model
  if (a === '79-20') return fig7920(ac.model);
  return buildFigure(ac.model, a, envOf(ac, a));
}

/** Every figure this airplane's IPC has (the five and 79-20), in ATA order: the IPC index */
export function figuresFor(ac: Aircraft): IpcFigure[] {
  return [...ALL_ATAS].sort().map((a) => ipcFor(ac, a));
}

export type OrderAnswer = {
  /** what to put on the parts request */
  pn: string;
  /** the chain followed: NP -> next higher assembly, SUPSD BY -> ... */
  path: string[];
  /** interchangeability code 3 somewhere on the way: order / install as a set or after the SB */
  asSet: boolean;
};

/** Follow NP and SUPSD BY from a part number in a figure to what you can order. */
export function orderFor(fig: IpcFigure, pn: string): OrderAnswer | undefined {
  let row: IpcRow | undefined = fig.rows.find((x) => x.pn === pn);
  if (!row) return undefined;
  const path = [row.pn];
  let asSet = false;
  for (let guard = 0; guard < 8; guard++) {
    if (row.np) {
      const np: string = row.notes.find((n) => n.startsWith('NP')) ?? '';
      const item: string | undefined = /ITEM (-?\d+)/.exec(np)?.[1];
      const cands: IpcRow[] = fig.rows.filter((x) => item !== undefined && (x.item === item || x.item === `${item}A`));
      const next: IpcRow | undefined = cands.find((x) => x.applies) ?? cands[0];
      if (!next) break;
      row = next;
      path.push(row.pn);
    } else if (row.supsdBy) {
      if (row.supsdBy.code === 3) asSet = true;
      const next = fig.rows.find((x) => x.pn === row!.supsdBy!.pn);
      if (!next) break;
      row = next;
      path.push(row.pn);
    } else break;
  }
  return { pn: row.pn, path, asSet };
}

export type PartHit = {
  /** manufacturer IPC rows with this P/N (applies = effective for this aircraft) */
  ipc: { ata: Ata; fig: number; item: string; applies: boolean }[];
  /** alterations whose ICA parts list carries it */
  alterations: Alteration[];
  /** logbook entries that name it */
  entries: LogEntry[];
};

/** Where a part number shows up in this aircraft's paperwork. */
export function findPart(ac: Aircraft, pn: string): PartHit {
  const ipc: PartHit['ipc'] = [];
  for (const ata of IPC_ATAS) {
    const fig = ipcFor(ac, ata);
    for (const r of fig.rows) if (r.pn === pn) ipc.push({ ata, fig: fig.fig, item: r.item, applies: r.applies });
  }
  return {
    ipc,
    alterations: ac.alterations.filter((a) => a.parts?.some((r) => r.pn === pn)),
    entries: ac.log.filter((e) => e.text.includes(pn) || e.pns?.some((x) => x.on === pn || x.off === pn)),
  };
}

/** the logbook entry that recorded an alteration's installation */
const installEntry = (ac: Aircraft, alt: Alteration) => ac.log.find((e) => e.kind === 'stc' && e.date === alt.date && e.ata === alt.ata);

/**
 * Where the approval to install `pn` comes from, the way the mechanic works it:
 * the IPC first; if the part "does not exist" there, the logbooks for the
 * alteration that put it on the airplane (STC or field-approved 337), then
 * engineering approval on that data. An FAA-PMA part logged at its last
 * replacement is approved by its PMA eligibility.
 */
export function approvalBasis(
  ac: Aircraft,
  ata: Ata | string,
  pn: string,
): { basis: 'ipc' | 'ipc-not-effective' | 'alteration' | 'pma' | 'none'; alteration?: Alteration; entry?: LogEntry } {
  const a = ataOf(ata);
  const rows = ipcFor(ac, a).rows.filter((r) => r.pn === pn);
  if (rows.some((r) => r.applies)) return { basis: 'ipc' };
  const alt = ac.alterations.find((x) => x.displaces === a && x.parts?.some((r) => r.pn === pn));
  if (alt) return { basis: 'alteration', alteration: alt, entry: installEntry(ac, alt) };
  if (ac.plant?.via === 'pma' && ac.plant.ata === a && ac.plant.neededPn === pn) return { basis: 'pma', entry: ac.log.find((e) => e.id === ac.plant!.entryId) };
  if (rows.length) return { basis: 'ipc-not-effective' };
  return { basis: 'none' };
}

export type EngineeringRequest = {
  ata: Ata | string;
  /** the part to install */
  pn: string;
  /** approved data the request cites: an STC number, or '' / "FIELD" / "337" for a field-approved Form 337 */
  stc: string;
  /** Form 337 date, ISO or MM/DD/YYYY */
  form337: string;
  /** the logbook entry that recorded the alteration */
  entryId: string;
};

const isoDate = (d: string) => (d.includes('/') ? d.replace(/^(\d\d)\/(\d\d)\/(\d{4})$/, '$3-$1-$2') : d);

/** Engineering's review of a request to install a part the IPC does not list. */
export function reviewRequest(ac: Aircraft, req: EngineeringRequest): { approved: boolean; problems: string[] } {
  const problems: string[] = [];
  const a = ataOf(req.ata);
  const basis = approvalBasis(ac, a, req.pn);
  if (basis.basis === 'ipc') problems.push('Part is in the IPC for this aircraft: no engineering approval needed.');
  const cited = req.stc.trim().toUpperCase();
  const d = isoDate(req.form337.trim());
  // an STC number (SA03372CE) can contain "337": only a cite that is not one names the field 337
  const fieldCite = !cited || (!/^S[AR]\d/.test(cited) && /337|FIELD/.test(cited));
  const alt = fieldCite ? ac.alterations.find((x) => x.kind === 'field' && x.form337 === d) : ac.alterations.find((x) => x.stc === cited);
  if (!alt) {
    if (fieldCite) problems.push(`No field-approved Form 337 dated ${fmtDate(d)} in this aircraft's records.`);
    else if (ac.plant?.basisStc === cited)
      problems.push(`STC ${cited} does not list ${ac.designation} on its approved model list: this airplane's approval is the field-approved Form 337.`);
    else problems.push(`No STC ${req.stc} in this aircraft's records.`);
  } else {
    const name = alt.stc ? `STC ${alt.stc}` : `Form 337 dated ${fmtDate(alt.form337)}`;
    if (alt.ata !== a) problems.push(`${name} does not cover ATA ${a}.`);
    if (!alt.parts?.some((r) => r.pn === req.pn)) problems.push(`P/N ${req.pn} is not in the ${alt.ica} parts list.`);
    if (d !== alt.form337) problems.push(`Form 337 date does not match the one on file (${fmtDate(alt.form337)}).`);
    const e = ac.log.find((x) => x.id === req.entryId);
    if (!e || e.id !== installEntry(ac, alt)?.id) problems.push('Logbook entry cited does not record the installation of this alteration.');
  }
  return { approved: problems.length === 0, problems };
}

/** entries whose text, reference or part numbers match every word of the query (case-insensitive) */
export function searchLog(ac: Aircraft, query: string): LogEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return ac.log.filter((e) => {
    const hay = `${e.date} ${fmtDate(e.date)} ${e.ata ?? ''} ${e.text} ${e.ref} ${(e.pns ?? []).map((p) => `${p.off ?? ''} ${p.on ?? ''}`).join(' ')}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

// ---------------------------------------------------------------------------
// Maintenance manual task cards
// ---------------------------------------------------------------------------

export type AmmTaskKey = 'wheel' | 'brake' | 'prop' | 'powerpack' | 'radio' | 'alternator' | AmmTaskKey2;
/** the job flow's task cards (docs/JOBFLOW.md 4): short cards beside the six; they resolve by their own key (a task's `job`) */
export type AmmTaskKey2 = 'bleed' | 'wheelhalf' | 'safetywire' | 'oil' | 'belt' | 'cylinder' | 'spar' | 'inspection';

export type AmmStep = {
  n: number;
  phase: string;
  text: string;
  /** key into the task's torque table (TorqueSpec.key) */
  torque?: string;
};

export type Effective = { eff?: string; effText?: string; text: string; applies: boolean };

export type AmmTask = {
  key: AmmTaskKey;
  /** the task's chapter-section ("32-40"; the job flow's cards: "32-42", "79-00", "05-20"): its task number starts with it */
  ata: string;
  /** the IPC figure its parts are in, when there is one */
  fig?: AnyAta;
  /** chapter-section-subject, e.g. "32-40-01" */
  taskNo: string;
  /** ATA page block: 201 maintenance practices, 301 servicing, 401 removal/installation */
  pageBlock: number;
  title: string;
  manual: string;
  /** how a logbook entry cites it: "IAW IC-310 MM 32-40-01" */
  ref: string;
  effectivity: string;
  effNotes: Effective[];
  warnings: string[];
  cautions: string[];
  notes: string[];
  tools: string[];
  consumables: Effective[];
  steps: AmmStep[];
  /** every torque the task uses, both effectivities printed; applies marks this aircraft's */
  torques: TorqueSpec[];
  /** servicing values (accumulator precharge, approved fluid), both effectivities printed; applies marks this aircraft's */
  servicing: ServiceSpec[];
  ipcFig: number;
};

/** A servicing value the card prints by effectivity: a nitrogen precharge, the approved fluids. */
export type ServiceSpec = {
  key: 'precharge' | 'fluid';
  what: string;
  /** as printed: "800 psi at 70°F", "MIL-PRF-5606 only" */
  text: string;
  /** precharge: psi at `refTemp` °F */
  psi?: number;
  refTemp?: number;
  /** fluid: the specifications approved ('MIL-PRF-5606', 'MIL-PRF-83282') */
  fluids?: string[];
  eff?: 'A' | 'B' | 'C' | 'D';
  effText?: string;
  applies: boolean;
};

/** Brake / gear accumulator nitrogen precharge by S/N block (psi at 70°F): [A, B] */
const PRECHARGE: Record<PlaneModel, [number, number]> = { twin: [800, 900], cargo: [900, 1000], float: [750, 850] };

const TASKS: Record<Exclude<AmmTaskKey, AmmTaskKey2>, { ata: Ata; sub: string; block: number }> = {
  wheel: { ata: '32-40', sub: '01', block: 401 },
  brake: { ata: '32-40', sub: '02', block: 201 },
  prop: { ata: '61-10', sub: '01', block: 401 },
  powerpack: { ata: '29-10', sub: '01', block: 301 },
  radio: { ata: '23-10', sub: '01', block: 401 },
  alternator: { ata: '24-30', sub: '01', block: 401 },
};
export const AMM_TASKS = Object.keys(TASKS) as AmmTaskKey[];

/** the job flow's cards: the task's chapter-section, its number, the page block, and the figure its parts are in (none: no IPC figure in v1) */
const TASKS2: Record<AmmTaskKey2, { chap: string; sub: string; block: number; fig?: AnyAta }> = {
  bleed: { chap: '32-42', sub: '01', block: 301, fig: '29-10' },
  wheelhalf: { chap: '32-40', sub: '03', block: 201, fig: '32-40' },
  safetywire: { chap: '61-10', sub: '02', block: 201, fig: '61-10' },
  oil: { chap: '79-00', sub: '01', block: 301, fig: '79-20' },
  belt: { chap: '24-30', sub: '02', block: 201, fig: '24-30' },
  cylinder: { chap: '72-30', sub: '01', block: 401 },
  spar: { chap: '57-10', sub: '01', block: 601 },
  inspection: { chap: '05-20', sub: '01', block: 601, fig: '79-20' },
};
export const AMM_TASKS2 = Object.keys(TASKS2) as AmmTaskKey2[];
const JOB_KEYS2: ReadonlySet<string> = new Set(['bleed', 'wheelhalf', 'safetywire', 'belt', 'inspection']);

const ALIASES: Record<string, AmmTaskKey> = {
  tires: 'wheel', tire: 'wheel', wheel: 'wheel', corrosion: 'wheel', inspect100: 'wheel',
  brake: 'brake', brakes: 'brake', lining: 'brake', linings: 'brake',
  prop: 'prop', propeller: 'prop', wire: 'prop',
  hydraulic: 'powerpack', hydraulics: 'powerpack', powerpack: 'powerpack', gear: 'powerpack',
  avionics: 'radio', radio: 'radio', com: 'radio',
  alternator: 'alternator', generator: 'alternator', starter: 'alternator',
};

/** a catalog job kind ("tires", "prop", "avionics", "alternator"), a task key or an ATA code -> task key */
export function taskKeyFor(job: string): AmmTaskKey | undefined {
  if (ALIASES[job]) return ALIASES[job];
  // the job flow's card keys, where they aren't also a catalog kind (a cylinder, oil or spar job keeps no card by its kind:
  // the flow reaches those cards through its task's `card`, and ammTaskFor takes the key itself)
  if (JOB_KEYS2.has(job)) return job as AmmTaskKey2;
  const m = /(\d\d-\d\d)(?:-(\d\d))?/.exec(job);
  if (!m) return undefined;
  const hit = (AMM_TASKS as Exclude<AmmTaskKey, AmmTaskKey2>[]).find((k) => TASKS[k].ata === m[1] && (!m[2] || TASKS[k].sub === m[2]));
  return hit;
}

const eff = (env: Env, fig: IpcFigure, code: 'A' | 'B' | 'C' | 'D' | undefined, text: string): Effective => ({
  eff: code,
  effText: code ? fig.effCodes.find((e) => e.code === code)!.text : undefined,
  text,
  applies: effOk(code ?? '', env),
});

type Card = Pick<AmmTask, 'title' | 'warnings' | 'cautions' | 'tools'> & {
  steps: [string, string, string?][];
  consumables: [('A' | 'B' | 'C' | 'D')?, string?][];
  effNotes: [('A' | 'B' | 'C' | 'D')?, string?][];
  /** servicing values by effectivity: a precharge in psi at 70°F, or the approved fluid specs */
  servicing?: ['A' | 'B' | 'C' | 'D', 'precharge' | 'fluid', number | string[]][];
};

function servicingOf(env: Env, fig: IpcFigure, c: Card): ServiceSpec[] {
  return (c.servicing ?? []).map(([code, key, v]) => {
    const base = { eff: code, effText: fig.effCodes.find((e) => e.code === code)!.text, applies: effOk(code, env) };
    if (key === 'precharge') {
      const psi = v as number;
      return { key, what: 'Brake accumulator nitrogen precharge (hydraulic side at 0 psi)', text: `${psi} psi at 70°F`, psi, refTemp: 70, ...base };
    }
    const fluids = v as string[];
    return { key, what: 'Hydraulic fluid', text: fluids.length > 1 ? fluids.join(' or ') : `${fluids[0]} only`, fluids, ...base };
  });
}

function card(model: PlaneModel, key: AmmTaskKey): Card {
  const s = SPECS[model];
  const twin = model === 'twin';
  switch (key) {
    case 'bleed':
      return {
        title: 'Main Brakes — Bleeding',
        warnings: ['Hydraulic fluid is flammable and slippery: no open flame, wipe spills at once.'],
        cautions: [
          'Only the fluid the effectivity lists (red: petroleum or synthetic hydrocarbon base). Never phosphate-ester (Skydrol) or automotive brake fluid.',
          'Keep the reservoir above ADD while you bleed: air drawn in means starting over.',
        ],
        tools: ['Pressure bleeder pot', 'Clear bleed hose and catch bottle', 'Wrench for the bleeder screw'],
        consumables: [['D', 'Hydraulic fluid: MIL-PRF-5606 only (PRE SB)'], ['C', 'Hydraulic fluid: MIL-PRF-5606 or MIL-PRF-83282 (POST SB)']],
        effNotes: [['D', 'PRE SB: MIL-PRF-5606 only.'], ['C', 'POST SB: MIL-PRF-83282 approved as an alternate fluid.']],
        servicing: [
          ['D', 'fluid', ['MIL-PRF-5606']],
          ['C', 'fluid', ['MIL-PRF-5606', 'MIL-PRF-83282']],
        ],
        steps: [
          ['Preparation', 'Chock the wheels; release the parking brake.'],
          ['Preparation', 'Fill the pressure pot with the approved fluid and connect it to the caliper bleeder screw.'],
          ['Bleeding', 'Open the bleeder and push fluid up through the brake to the reservoir until the vent line runs clear of bubbles.'],
          ['Bleeding', 'Close the bleeder; disconnect the pot and cap the bleeder.'],
          ['Servicing', 'Top the reservoir up to FULL with the gear down.'],
          ['Test', 'Pump the pedal: firm within a third of its travel, no sinking under steady pressure.'],
          ['Bleeding', 'Repeat on the other main brake.'],
          ['Test', 'Taxi check: both brakes even, no pull.'],
        ],
      };
    case 'wheelhalf':
      return {
        title: 'Main Wheel Halves — Corrosion Treatment and Penetrant Inspection',
        warnings: ['Deflate the tire completely before you loosen a tie bolt. A pressurized wheel can come apart with lethal force.'],
        cautions: ['No abrasive blasting on the bead seat.', 'Penetrant materials from one family only (ASTM E1417 Type I, Method C).'],
        tools: ['Penetrant kit and UV-A lamp', 'Nylon bristle brushes', 'Torque wrench, 20-200 in-lb'],
        consumables: [[undefined, 'Penetrant kit ASTM E1417 Type I, Method C'], [undefined, 'Conversion coating MIL-DTL-5541 Type I Class 1A'], [undefined, 'Tube per IPC if chafed']],
        effNotes: [['A', 'Wheels 40-xx0A: the A tie-bolt torque on reassembly.'], ['B', 'Wheels 40-xx0B: the B tie-bolt torque on reassembly.']],
        steps: [
          ['Removal', 'Remove the wheel and split the halves (AMM 32-40-01).'],
          ['Cleaning', 'Clean the corrosion from the bead seat with a nylon brush and solvent; no abrasive blasting.'],
          ['Inspection', 'Penetrant: apply, dwell 10 minutes, remove the excess, develop.'],
          ['Inspection', 'Inspect under UV-A: any linear indication at the bead seat is a crack. A cracked half is scrap: order the wheel assembly.'],
          ['Treatment', 'No crack: treat the bare metal with conversion coating, then prime and paint.'],
          ['Assembly', 'Fit a new tube if the old one chafed; join the halves and torque the tie-bolt nuts.', 'tieNut'],
          ['Installation', 'Install the wheel (AMM 32-40-01).'],
        ],
      };
    case 'safetywire':
      return {
        title: 'Propeller Mounting Bolts — Safety Wiring',
        warnings: [`${model === 'cargo' ? 'Battery OFF and disconnected' : 'Magnetos OFF, mixture IDLE CUTOFF'}: treat the propeller as live.`],
        cautions: ['Never re-use safety wire.', 'The wire must pull each bolt in the tightening direction.'],
        tools: ['Safety-wire pliers', 'Diagonal cutters'],
        consumables: [[undefined, 'Safety wire MS20995C32 (0.032 in)']],
        effNotes: [],
        steps: [
          ['Preparation', 'Remove the spinner dome.'],
          ['Removal', 'Cut and remove the broken or nicked wire; check each bolt has not turned (torque stripe).'],
          ['Installation', 'Run new wire through the first bolt of the pair so it pulls the bolt tight.'],
          ['Installation', 'Twist 6-8 turns per inch to the next bolt; through it, in the tightening direction.'],
          ['Installation', 'Finish with a 3-6 twist pigtail bent back toward the part.'],
          ['Installation', 'Repeat on each pair; install the dome.'],
          ['Test', 'Record the work in the propeller logbook.'],
        ],
      };
    case 'oil':
      return {
        title: `Engine Oil and Filter — Change${twin ? ' (both engines)' : ''}`,
        warnings: ['Hot oil burns: let it cool below 150°F before you open the drain.'],
        cautions: ['Cut the old filter open and look for metal before you throw it away.', 'A new crush gasket on the drain plug every time.'],
        tools: ['Torque wrench, 20-200 in-lb', 'Filter can cutter', 'Safety-wire pliers'],
        consumables: [
          [undefined, `Oil: SAE J1899 20W-50 ashless dispersant, ${twin ? '12 qt per engine' : '11 qt'}`],
          [undefined, 'Oil filter per IPC Fig (79-20)'],
          [undefined, 'Crush gasket AN900-10'],
          [undefined, 'Safety wire MS20995C32'],
        ],
        effNotes: [],
        steps: [
          ['Preparation', 'Run the engine to warm the oil; shut down, master OFF.'],
          ['Drain', 'Remove the drain plug and drain the sump; fit a new crush gasket.'],
          ['Drain', 'Install the drain plug, torque it and safety wire it.'],
          ['Filter', 'Remove the filter; cut it open and inspect the media for metal.'],
          ['Filter', 'Install the new filter, torque it and safety wire it.'],
          ['Servicing', `Fill with ${twin ? '12 qt per engine' : '11 qt'} of the approved oil.`],
          ['Test', 'Run the engine: oil pressure in the green in 30 s; check for leaks; recheck the level.'],
        ],
      };
    case 'belt':
      return {
        title: 'Alternator Drive Belt — Tension Check and Replacement',
        warnings: ['Master OFF, magnetos OFF: the propeller is live.'],
        cautions: ['Pry only on the alternator front housing, never on the case.', 'Replace a cracked or glazed belt; check the pulleys for wear.'],
        tools: ['Torque wrench, 0-25 ft-lb', 'Torque wrench, 20-200 in-lb'],
        consumables: [[undefined, 'V-belt per IPC (an ALT belt is a legal alternate)']],
        effNotes: [],
        steps: [
          ['Inspection', 'Check the belt for cracks, glazing and fraying.'],
          ['Removal', 'Loosen the adjusting arm bolt and the pivot bolt; swing the alternator in and remove the belt.'],
          ['Installation', 'Fit the new belt over the pulleys.'],
          ['Installation', 'Tension the belt: turn the pulley nut with a torque wrench until the belt slips.', 'beltNew'],
          ['Installation', 'Torque the adjusting arm bolt.', 'armBolt'],
          ['Installation', 'Torque the pivot bolt.', 'pivotBolt'],
          ['Test', 'Run-up: bus voltage in limits, no squeal.'],
          ['Test', 'After 10 hours, re-check the tension at the used-belt value.', 'beltUsed'],
        ],
      };
    case 'cylinder':
      return {
        title: 'Cylinder — Removal / Installation',
        warnings: ['Magnetos OFF and grounded, mixture IDLE CUTOFF: treat the propeller as live.'],
        cautions: ['Tighten the base nuts in the engine maker’s sequence, in stages.', 'Keep the piston square: a cocked piston scores the barrel.'],
        tools: ['Torque wrench, 20-150 ft-lb, with crowfoot', 'Torque wrench, 20-200 in-lb', 'Differential compression tester', 'Ring compressor'],
        consumables: [[undefined, 'Cylinder assembly: the engine maker’s overhauled exchange unit'], [undefined, 'Gasket kit for the cylinder'], [undefined, 'Anti-seize MIL-PRF-907 on the base nut threads']],
        effNotes: [],
        steps: [
          ['Removal', 'Remove the cowling, the baffles, the intake and exhaust from the cylinder.'],
          ['Removal', 'Remove the rocker cover, the rockers and the pushrods.'],
          ['Removal', 'Bring the piston to top dead center; remove the base nuts and the cylinder.'],
          ['Installation', 'Fit the new cylinder over the piston with a new base seal.'],
          ['Installation', 'Torque the base nuts in sequence, in stages.'],
          ['Installation', 'Install the pushrods, the rockers, the intake and exhaust, new gaskets throughout.'],
          ['Test', 'Differential compression and a ground run; check for leaks at the base.'],
          ['Test', 'Break-in per the engine maker: the logbook entry names the cylinder’s serial number.'],
        ],
      };
    case 'spar':
      return {
        title: 'Wing Spar Lower Cap and Wing Root — Inspection',
        warnings: ['Support the wing at the jack points before you open the root fairing.'],
        cautions: ['Penetrant materials from one family only.', 'Any crack indication at the lower cap: stop and call for the SRM repair.'],
        tools: ['Penetrant kit and UV-A lamp', 'Inspection mirror and 10x glass'],
        consumables: [[undefined, 'Penetrant kit ASTM E1417 Type I, Method C (2 uses)']],
        effNotes: [],
        steps: [
          ['Access', 'Remove the wing root fairing and the lower access panels.'],
          ['Cleaning', 'Clean the lower spar cap and the root fitting to bare paint.'],
          ['Inspection', 'Look over the root rivets: smoking (black streaks) means a working joint.'],
          ['Inspection', 'Penetrant on the lower cap at the root fitting: dwell, remove the excess, develop.'],
          ['Inspection', 'Inspect under UV-A with the glass.'],
          ['Close-up', 'No findings: refit the panels and the fairing; record the inspection.'],
        ],
      };
    case 'inspection':
      return {
        title: model === 'cargo' ? 'Phase Inspection' : '100-Hour Inspection',
        warnings: ['Magnetos OFF, master OFF before any work forward of the firewall.'],
        cautions: ['Work the checklist in order; an item found is written up before the airplane is returned to service.'],
        tools: model === 'cargo' ? ['Torque wrench, 20-200 in-lb', 'Inspection mirror and light'] : ['Torque wrench, 20-200 in-lb', 'Differential compression tester', 'Eddy-current probe (AD 2016-09-12 hub check)'],
        consumables:
          model === 'cargo'
            ? [[undefined, 'Filter housing packing set, chip detector packing'], [undefined, 'Safety wire MS20995C32'], [undefined, 'Cotter pins MS24665-302']]
            : [
                [undefined, `Oil and filter: SAE J1899 20W-50, ${twin ? '12 qt per engine' : '11 qt'}`],
                [undefined, 'Spark plug gaskets, 12 per engine'],
                [undefined, 'Crush gaskets, safety wire, cotter pins'],
              ],
        effNotes: [],
        steps:
          model === 'cargo'
            ? [
                ['Records', 'Review the records: ADs, life limits, open write-ups.'],
                ['Engine', 'Oil level and chip detector checked; filter element inspected.'],
                ['Engine', 'Compressor wash per the phase card; borescope if the trend calls for it.'],
                ['Airframe', 'Landing gear, brakes and tires; flight controls and cables.'],
                ['Airframe', 'Wing root and lower spar cap area.'],
                ['Close-up', 'Safety wire and cotter pins where disturbed; ground run; return to service.'],
              ]
            : [
                ['Records', 'Review the records: ADs, life limits, open write-ups.'],
                ['Engine', 'Differential compression on every cylinder.'],
                ['Engine', 'Oil and filter change (AMM 79-00-01); filter cut open for metal.'],
                ['Engine', 'Spark plugs out, cleaned, gapped and rotated; new gaskets.'],
                ['Propeller', 'Hub eddy-current check per AD 2016-09-12.'],
                ['Airframe', 'Landing gear, brakes and tires; flight controls and cables.'],
                ['Close-up', 'Safety wire and cotter pins where disturbed; run-up; return to service.'],
              ],
      };

    case 'wheel':
      return {
        title: 'Main Wheel and Tire — Removal / Installation',
        warnings: ['Deflate the tire completely before you loosen a tie bolt. A pressurized wheel can come apart with lethal force.'],
        cautions: ['Keep each bearing cone with its cup as a matched set.', 'Replace any self-locking nut that turns onto its bolt by hand.', 'Never use a hammer on a wheel half.'],
        tools: ['Jack and axle jack pad', 'Torque wrench, 20-200 in-lb', 'Valve core tool', 'Bead breaker', 'Bearing packer'],
        consumables: [[undefined, 'Wheel bearing grease: MIL-PRF-81322'], [undefined, 'Tire talc (tube)'], [undefined, 'Cotter pin MS24665-302: new at every installation']],
        effNotes: [['A', 'Wheels 40-xx0A: 1/4 in tie bolts. Use the A torque.'], ['B', 'Wheels 40-xx0B: redesigned halves. Use the B torque; halves do not interchange with A wheels.']],
        steps: [
          ['Removal', 'Chock the other wheels; jack this wheel clear of the ramp (MM 07-10-00).'],
          ['Removal', 'Remove the hub cap, cotter pin and axle nut.'],
          ['Removal', 'Remove the brake back plate bolts; let the back plate and linings hang free.'],
          ['Removal', 'Slide the wheel off the axle, keeping the bearing cones with it.'],
          ['Disassembly', 'Deflate the tire completely: remove the valve core.'],
          ['Disassembly', 'Break both beads loose; remove the tie-bolt nuts and separate the wheel halves.'],
          ['Assembly', 'Clean and inspect bearings, cups and seals; repack the cones with grease.'],
          ['Assembly', "Talc the tube; fit tube and tire on the outer half with the tire's balance dot at the valve."],
          ['Assembly', 'Join the halves without pinching the tube; install tie bolts, washers and nuts.'],
          ['Assembly', 'Torque the tie-bolt nuts in a cross pattern.', 'tieNut'],
          ['Assembly', `Inflate to seat the beads, deflate, then inflate to ${s.tire.psi} psi. Re-check after 12 hours.`],
          ['Installation', 'Slide the wheel onto the axle; install the back plate and its bolts.', 'backPlateBolt'],
          ['Installation', 'Tighten the axle nut while turning the wheel to seat the bearings, back it off, then snug it to a slight bearing drag. Line up the next slot and fit a new cotter pin.'],
          ['Installation', 'Install the hub cap.', 'hubCap'],
          ['Installation', 'Lower the aircraft; check brake action on the first taxi.'],
        ],
      };
    case 'brake':
      return {
        title: 'Main Brake Linings — Replacement',
        warnings: ['Do not blow brake dust off with shop air; vacuum or wipe it.'],
        cautions: ['Replace the linings on both main wheels together.', 'Never mix organic and metallic linings on one airplane.'],
        tools: ['Rivet tool (punch and flaring set)', 'Torque wrench, 20-200 in-lb', 'Micrometer'],
        consumables: [[undefined, 'Lining rivets per IPC'], [undefined, 'Brake fluid MIL-PRF-5606 (bleed only if the cylinder was opened)'], ['D', 'Organic linings per IPC (PRE SB)'], ['C', 'Metallic heavy-duty linings per IPC (POST SB)']],
        effNotes: [['D', 'PRE SB: condition organic linings with 6 light stops from 25-40 mph.'], ['C', 'POST SB: condition metallic linings with 2 firm stops from 30-35 kt.']],
        steps: [
          ['Removal', 'Remove the back plate bolts; remove the back plate and outboard lining.'],
          ['Removal', 'Slide the cylinder off the anchor bolts; remove the pressure plate and inboard lining.'],
          ['Inspection', 'Measure lining thickness (replace at 0.100 in) and disc thickness against the disc limit for the installed disc.'],
          ['Relining', 'Punch out the old rivets; do not drill into the plates.'],
          ['Relining', 'Rivet the new linings: a rolled head with no cracks at the flare.'],
          ['Installation', 'Slide the cylinder onto the anchor bolts; install pressure plate, back plate and bolts.', 'backPlateBolt'],
          ['Test', 'Pump the pedal: firm, no leaks. Bleed if the cylinder was opened.'],
          ['Test', 'Condition the new linings (see effectivity).'],
        ],
      };
    case 'prop':
      return {
        title: 'Propeller — Removal / Installation',
        warnings: [`${model === 'cargo' ? 'Battery OFF and disconnected, ignition OFF' : 'Magnetos OFF, mixture IDLE CUTOFF, master OFF'}: treat the propeller as live and stay out of its arc.`],
        cautions: ['Do not lift the propeller by a blade tip.', 'A new hub O-ring at every installation.', twin ? 'LH and RH propellers rotate the same way; do not swap spinners between sides.' : 'Check the propeller is the one listed for this engine.'],
        tools: ['Torque wrench, 20-150 ft-lb, with crowfoot', 'Safety-wire pliers', 'Propeller sling or a second person', 'Track stand'],
        consumables: [[undefined, 'Safety wire MS20995C32 (0.032 in)'], [undefined, 'O-ring lubricant: MIL-PRF-83282, light film'], ['C', 'Anti-seize MIL-PRF-907 on mounting bolt threads (POST SB bolts only)']],
        effNotes: [['D', 'PRE SB bolts: dry threads.'], ['C', 'POST SB bolts: threads lubricated with MIL-PRF-907 before torque.']],
        steps: [
          ['Removal', 'Remove the spinner dome screws and the dome.'],
          ['Removal', 'Cut and remove the safety wire from the mounting bolts.'],
          ['Removal', 'Support the propeller; loosen the mounting bolts evenly, then remove them.'],
          ['Removal', 'Pull the propeller straight off the flange.'],
          ['Installation', 'Clean both flange faces; install a new hub O-ring, lubricated.'],
          ['Installation', 'Line the propeller up on the flange dowels and push it home.'],
          ['Installation', 'Install the bolts and washers finger tight.'],
          ['Installation', 'Torque the mounting bolts in a cross pattern, in three stages.', 'propBolt'],
          ['Installation', 'Safety wire the bolts in pairs, double twist, so the wire pulls each bolt tight.'],
          ['Test', 'Check blade track: within 1/16 in.'],
          ['Installation', 'Install the aft bulkhead and the dome; torque the spinner screws.', 'spinnerScrew'],
          ['Test', 'Run-up: check for vibration; record in the propeller logbook.'],
        ],
      };
    case 'powerpack':
      return {
        title: 'Hydraulic Power Pack — Servicing and Filter Replacement',
        warnings: [`Aircraft on jacks with the ${s.hydraulics} DOWN and locked; pull the GEAR PUMP breaker before opening the pack.`],
        cautions: [
          'Only the fluid the effectivity lists (red: petroleum or synthetic hydrocarbon base). Never phosphate-ester (Skydrol) or automotive brake fluid.',
          'Relieve system pressure before removing the filter bowl.',
          'Charge the accumulator with dry nitrogen only. Never shop air or oxygen.',
        ],
        tools: ['Jacks', 'Torque wrench, 20-200 in-lb', 'Safety-wire pliers', 'Clean container', 'Nitrogen charging kit and gauge'],
        consumables: [
          ['D', 'Hydraulic fluid: MIL-PRF-5606 only (PRE SB)'],
          ['C', 'Hydraulic fluid: MIL-PRF-5606 or MIL-PRF-83282 (POST SB)'],
          [undefined, 'Safety wire MS20995C32'],
          [undefined, 'Nitrogen, dry (BB-N-411)'],
          ['A', 'Reservoir capacity 1.3 qt (DH-xx02-3)'],
          ['B', 'Reservoir capacity 1.6 qt (DH-xx02-5)'],
        ],
        effNotes: [
          ['C', 'POST SB: vented filler cap; do not plug the vent. MIL-PRF-83282 approved as an alternate fluid.'],
          ['D', 'PRE SB: solid filler cap; check it for fluid seepage in turbulence reports. MIL-PRF-5606 only.'],
          ['A', 'Accumulator precharge: the A value (smaller accumulator).'],
          ['B', 'Accumulator precharge: the B value (larger accumulator).'],
        ],
        servicing: [
          ['A', 'precharge', PRECHARGE[model][0]],
          ['B', 'precharge', PRECHARGE[model][1]],
          ['D', 'fluid', ['MIL-PRF-5606']],
          ['C', 'fluid', ['MIL-PRF-5606', 'MIL-PRF-83282']],
        ],
        steps: [
          ['Preparation', 'Pull the GEAR PUMP circuit breaker; open the access panel.'],
          ['Preparation', 'Relieve residual pressure through the emergency release valve.'],
          ['Accumulator', 'Pump the brakes until the hydraulic gauge reads 0 (accumulator discharged).'],
          ['Accumulator', 'Check the nitrogen precharge; set it to the effectivity value, corrected for the ramp temperature (gas law, absolute temperature).'],
          ['Filter', 'Cut the safety wire; remove the filter bowl.'],
          ['Filter', 'Replace the filter element and the bowl O-ring (per IPC).'],
          ['Filter', 'Reinstall the bowl and torque it.', 'filterBowl'],
          ['Filter', 'Safety wire the bowl.'],
          ['Servicing', 'Remove the filler cap; fill to FULL on the dipstick with the gear down.'],
          ['Test', 'Reset the breaker; cycle the gear 3 times on jacks. Check pump run time and look for leaks.'],
          ['Test', 'Recheck the fluid level; close the access panel.'],
        ],
      };
    case 'radio':
      return {
        title: 'VHF Com Transceiver — Removal / Installation',
        warnings: [],
        cautions: ['ESD: wear a wrist strap and hold the unit by its case.', 'Never force the unit into the tray: the cam lock draws it onto the connector.'],
        tools: ['3/32 in hex driver', 'Torque screwdriver, 5-20 in-lb', 'ESD wrist strap'],
        consumables: [[undefined, 'Contact cleaner, non-residue']],
        effNotes: [['D', 'PRE SB: TR-155-01, 25 kHz channel spacing only.'], ['C', 'POST SB: TR-155-02: set 8.33 / 25 kHz spacing per the unit installation manual.'], ['A', 'Tray TR-155-MT: cam lock seats at the A torque.'], ['B', 'Tray TR-155-MT2: longer cam; seats at the B torque.']],
        steps: [
          ['Removal', 'Avionics master and battery master OFF.'],
          ['Removal', 'Pull the COM circuit breaker.'],
          ['Removal', 'Turn the cam-lock screw counterclockwise until the unit releases.'],
          ['Removal', 'Slide the unit out of the tray.'],
          ['Inspection', 'Inspect the tray connector pins and the coax connector.'],
          ['Installation', 'Slide the replacement unit onto the rails until it touches the connector.'],
          ['Installation', 'Turn the cam-lock screw clockwise to draw the unit onto the connector and seat it.', 'lockScrew'],
          ['Test', 'Reset the breaker and power up; check the channel spacing setting.'],
          ['Test', 'Ops check: transmit and receive on ground frequency; check sidetone.'],
        ],
      };
    case 'alternator':
      if (model === 'cargo')
        return {
          title: 'Starter-Generator — Removal / Installation',
          warnings: ['Battery OFF and disconnected, external power unplugged: the starter-generator can motor the engine.'],
          cautions: ['Support the unit (about 25 lb) while the V-band clamp is loose.', 'Replace the unit if the drive shaft shear section shows any twist.'],
          tools: ['Torque wrench, 20-200 in-lb', 'Soft mallet', 'Spline gauge'],
          consumables: [['A', 'Spline lubricant: MIL-PRF-81322 (QAD adapter HSG-QAD-xx)'], ['B', 'Spline lubricant: Halden HSG-SL paste (QAD adapter HSG-QAD-xxB)']],
          effNotes: [['A', 'Early QAD adapter: lower V-band torque.'], ['B', 'Later QAD adapter: higher V-band torque.']],
          steps: [
            ['Removal', 'Battery and external power disconnected.'],
            ['Removal', 'Remove the engine cowling.'],
            ['Removal', 'Tag and disconnect the cables (B+, E, A, field).'],
            ['Removal', 'Remove the cooling duct.'],
            ['Removal', 'Loosen the V-band clamp and lift the unit off the QAD adapter.'],
            ['Inspection', 'Inspect the adapter and drive spline; lubricate the spline.'],
            ['Installation', 'If the adapter was removed, torque its nuts.', 'qadNut'],
            ['Installation', 'Engage the spline and seat the unit on the QAD adapter.'],
            ['Installation', 'Install the V-band clamp and torque it; tap it all round and re-torque.', 'vband'],
            ['Installation', 'Reconnect the cables and the cooling duct.'],
            ['Test', 'Ground run: starter engages and cuts out; generator on line at 28.0-28.5 V.'],
          ],
        };
      return {
        title: 'Alternator — Removal / Installation',
        warnings: ['Battery master OFF and the negative battery lead disconnected before touching the B+ terminal.'],
        cautions: ['Tag each lead before you disconnect it.', 'Pry only on the front housing to tension the belt, never on the case.'],
        tools: ['Torque wrench, 20-600 in-lb and 0-25 ft-lb', 'Pulley holding tool'],
        consumables: [[undefined, 'V-belt per IPC: replace if cracked or glazed']],
        effNotes: [['D', 'PRE SB alternators: lower pulley nut torque.'], ['C', 'POST SB alternators: new pulley nut, higher torque.']],
        steps: [
          ['Removal', 'Master OFF; disconnect the battery negative lead.'],
          ['Removal', 'Remove the upper cowling.'],
          ['Removal', 'Tag and disconnect the B+ (output), field and ground leads.'],
          ['Removal', 'Loosen the adjusting arm bolt.'],
          ['Removal', 'Loosen the pivot bolt, swing the alternator in and remove the belt.'],
          ['Removal', 'Remove the pivot bolt and the alternator.'],
          ['Installation', 'Transfer the pulley and fan if the new unit came without them.', 'pulleyNut'],
          ['Installation', 'Hang the alternator on the pivot bolt and fit the belt.'],
          ['Installation', 'Tension the belt: turn the pulley nut with a torque wrench until the belt slips.', 'beltNew'],
          ['Installation', 'Torque the adjusting arm bolt.', 'armBolt'],
          ['Installation', 'Torque the pivot bolt.', 'pivotBolt'],
          ['Installation', 'Reconnect the leads and the battery.'],
          ['Test', 'Run-up: bus 27.5-28.5 V, ammeter shows a charge.'],
          ['Test', 'After 10 hours, re-check the tension at the used-belt value.', 'beltUsed'],
        ],
      };
  }
}

/**
 * The task card for a job on this aircraft. `task` is a task key, a catalog job
 * kind ("tires", "prop", "avionics", "alternator", "hydraulic") or an ATA code.
 * Torques and consumables are printed for every effectivity, with `applies`
 * marking the ones for this S/N and SB status.
 */
export function ammTaskFor(ac: Aircraft, task: string): AmmTask {
  if ((AMM_TASKS2 as string[]).includes(task)) return shortTask(ac, task as AmmTaskKey2);
  const key = taskKeyFor(task);
  if (!key) throw new Error(`no AMM task for "${task}" (have ${[...AMM_TASKS, ...AMM_TASKS2].join(', ')})`);
  if ((AMM_TASKS2 as string[]).includes(key)) return shortTask(ac, key as AmmTaskKey2);
  const s = SPECS[ac.model];
  const { ata, sub, block } = TASKS[key as Exclude<AmmTaskKey, AmmTaskKey2>];
  const env = envOf(ac, ata);
  const fig = buildFigure(ac.model, ata, env);
  const c = card(ac.model, key);
  const used = new Set(c.steps.map((x) => x[2]).filter(Boolean));
  const taskNo = `${ata}-${sub}`;
  return {
    key,
    ata,
    fig: ata,
    taskNo,
    pageBlock: block,
    title: c.title,
    manual: `${s.family} Maintenance Manual`,
    ref: `IAW ${s.family} MM ${taskNo}`,
    effectivity: `${s.designation}, ALL`,
    effNotes: c.effNotes.map(([code, text]) => eff(env, fig, code, text!)),
    warnings: c.warnings,
    cautions: c.cautions,
    notes: [
      `Part numbers: ${s.family} IPC Figure ${fig.fig}.`,
      'An airplane altered by STC or field approval (FAA Form 337) may differ from this task: check the aircraft records and use the ICA for the alteration.',
    ],
    tools: c.tools,
    consumables: c.consumables.map(([code, text]) => eff(env, fig, code, text!)),
    steps: c.steps.map(([phase, text, torque], i) => (torque ? { n: i + 1, phase, text, torque } : { n: i + 1, phase, text })),
    torques: torquesAt(ac.model, ata, env).filter((t) => used.has(t.key)),
    servicing: servicingOf(env, fig, c),
    ipcFig: fig.fig,
  };
}

/** the torque this aircraft needs for a step key ("tieNut", "propBolt") */
export function torqueFor(t: AmmTask, key: string): TorqueSpec | undefined {
  return t.torques.find((x) => x.key === key && x.applies);
}

/** The job flow's short cards (docs/JOBFLOW.md 4): the same shape, the effectivity of the figure their parts are in */
function shortTask(ac: Aircraft, key: AmmTaskKey2): AmmTask {
  const s = SPECS[ac.model];
  const d = TASKS2[key];
  const sub = key === 'inspection' && ac.model === 'cargo' ? '02' : d.sub;
  const taskNo = `${d.chap}-${sub}`;
  const figAta = d.fig;
  const fig = figAta ? ipcFor(ac, figAta) : undefined;
  const env: Env = figAta && figAta !== '79-20' ? envOf(ac, figAta) : { snB: false, postSb: false };
  const c = card(ac.model, key);
  const used = new Set(c.steps.map((x) => x[2]).filter(Boolean));
  // an effectivity line needs its figure's code (79-20 prints none): lines without one apply to all
  const effOf = (code: 'A' | 'B' | 'C' | 'D' | undefined, text: string): Effective => {
    const e = code ? fig?.effCodes.find((x) => x.code === code) : undefined;
    return { eff: e ? code : undefined, effText: e?.text, text, applies: e ? effOk(code!, env) : true };
  };
  return {
    key,
    ata: d.chap,
    ...(figAta ? { fig: figAta } : {}),
    taskNo,
    pageBlock: d.block,
    title: c.title,
    manual: `${s.family} Maintenance Manual`,
    ref: `IAW ${s.family} MM ${taskNo}`,
    effectivity: `${s.designation}, ALL`,
    effNotes: c.effNotes.map(([code, text]) => effOf(code, text!)),
    warnings: c.warnings,
    cautions: c.cautions,
    notes: [
      fig ? `Part numbers: ${s.family} IPC Figure ${fig.fig}.` : key === 'cylinder' ? `Part numbers: ${s.engineMaker} parts catalog (${s.engineModel}).` : 'No parts are replaced by this task: findings are written up on their own task.',
      'An airplane altered by STC or field approval (FAA Form 337) may differ from this task: check the aircraft records and use the ICA for the alteration.',
    ],
    tools: c.tools,
    consumables: c.consumables.map(([code, text]) => effOf(code, text!)),
    steps: c.steps.map(([phase, text, torque], i) => (torque ? { n: i + 1, phase, text, torque } : { n: i + 1, phase, text })),
    torques: figAta && figAta !== '79-20' ? torquesAt(ac.model, figAta, env).filter((t) => used.has(t.key)) : [],
    servicing: fig && figAta !== '79-20' ? servicingOf(env, fig, c) : [],
    ipcFig: fig?.fig ?? 0,
  };
}

/**
 * The FAA-PMA replacements the market sells for this model: the PMA holder's
 * number for each IPC P/N of its item (brake linings, hydraulic filter
 * elements), with the eligibility the holder publishes. Derived, never stored.
 */
export function pmaParts(model: string): { pn: string; replaces: string; holder: string; eligibility: string; tag: string; ata: Ata }[] {
  const m = planeModel(model);
  const out: { pn: string; replaces: string; holder: string; eligibility: string; tag: string; ata: Ata }[] = [];
  for (const ata of PMA_ATAS) {
    const d = pmaDef(m, ata);
    if (!d) continue;
    for (const r of figureRows(m, ata)) if (r.tag === d.tag && !r.np) out.push({ pn: d.pn(r.pn), replaces: r.pn, holder: d.holder, eligibility: d.eligibility, tag: d.tag, ata });
  }
  return out;
}
