// Tasks: what the Manual / Reference step finds and what a plan names
// (docs/JOBFLOW.md 4). A task decides the job's kind (the catalog kind: the
// card's money, the puzzle), the puzzle's scenario (`job`), the lines the tech
// picks (main slots, or a rare job's pre-filled line), the bench stock it
// draws on its own, and the shop tools it needs. Derived from the code, never
// stored: the mechanic's AMM per model, the flight manual's ground power start,
// the standby generator's service manual, and the electrician's code and
// procedure reference (NEC 2023 articles).
import { figSb, ipcFor, planeModel, plantedFor, plantRows, rowFor, type Aircraft, type AmmTaskKey, type AnyAta, type PlaneModel } from './aircraft';
import { LABOR } from './data';
import type { Asset, ElecSite, IslandState, ItemCat, ItemId, OpsRole, TaskId } from './types';

export type { TaskId };

/** mech: an IPC tag on a figure; elec (and the generator): a catalog slot the pick judge reads (11.3) */
export type MainSlot = {
  slot: string;
  /** mech */
  ata?: AnyAta;
  tag?: string;
  /** elec / generator: the catalog chapter, and a named filter the judge's categories read */
  cat?: ItemCat;
  accepts?: string;
  /** 'upa': the IPC's units per assembly x the assemblies the AMM does; 'engines': 2 on the twin; 'run': the site's feet (x 1.1) per conductor; 'runLess10': the run less the 10 ft wall section, in 10 ft sticks */
  qty: number | 'upa' | 'engines' | 'run' | 'runLess10';
  /** elec wire: N same-size conductors, each (run x 1.1) ft */
  takeoff?: { conductors: number };
  /** the cause decides whether it's needed (`needsOf`) */
  optional?: boolean;
  /** only where the site is outdoors (a cover) */
  outdoor?: boolean;
  /** words for the slot row: "Tire", "GFCI device", "Wire (L1, L2, N)" */
  label: string;
};

/** a bench line names one item, an IPC tag to resolve for this airplane, or a set of acceptable items (the card's fluid) */
export type BenchLine = { item?: ItemId; tag?: string; ata?: AnyAta; anyOf?: ItemId[]; qty: number; when?: 'postSb' };

export interface Task {
  /** 'amm:twin:32-40-02', 'afm:float:4', 'gsm:2-4', 'ref:gfci' */
  id: TaskId;
  trade: OpsRole;
  /** maintenance manual, flight manual, generator service manual, code & procedure reference */
  book: 'AMM' | 'AFM' | 'GSM' | 'REF';
  /** "32-40-02", "Section 4", "2-4", "R-GFCI" */
  no: string;
  title: string;
  /** the job's card title: "Tire and tube", "Brake linings", "Water heater repair" (8.1) */
  short: string;
  /** chip: "32 Landing gear", "Art. 210 Branch circuits", "Generator" */
  chapter: string;
  /** the catalog kind it does (card money, puzzle); absent = reference only (can't be planned) */
  kind?: string;
  /** Order.job: the puzzle scenario and the AMM card key ('brake', 'wheel', 'bleed', ...) */
  job?: string;
  /** the AMM card the Manual step shows (ammTaskFor(ac, card)) */
  card?: AmmTaskKey;
  /** the job as a noun for tracing ("water heater repair"); default the kind's `log` */
  log?: string;
  /** DEFECT_RULES_BY_KIND key for a botched sign-off; default the kind */
  rule?: string;
  /** mech planes */
  models?: PlaneModel[];
  /** elec / generator: asset models */
  targets?: string[];
  /** an inspection, AD, code notice or take-off names this task: the Manual step is filled in */
  prefilled?: boolean;
  /** what the tech picks */
  main: MainSlot[];
  /** a rare job's pre-filled line (4.4): 'byModel' resolves the engine model's exchange cylinder */
  fixed?: { item: ItemId | 'byModel'; qty: number }[];
  /** drawn on its own at plan time */
  bench: BenchLine[];
  /** required shop tools: the only source of truth (3.4) */
  tools: ItemId[];
  /** elec */
  nec?: string[];
  keywords: string[];
  /** a reference entry's rule in plain English (the Reference step shows it); the generator manual's steps */
  summary?: string;
  steps?: string[];
}

const HOUSES = ['cottage', 'villa', 'lodge'];
const MODELS: PlaneModel[] = ['twin', 'cargo', 'float'];
const engines = (m: PlaneModel) => (m === 'twin' ? 2 : 1);
const oilQt = (m: PlaneModel) => (m === 'twin' ? 12 : 11);
const FLUID = ['MIL-PRF-5606', 'MIL-PRF-83282'];

// ---------------------------------------------------------------------------
// The mechanic: the AMM per model, the AFM's Section 4, the generator manual (4.1)

function mechTasks(m: PlaneModel): Task[] {
  const e = engines(m);
  const piston = m !== 'cargo';
  const amm = (no: string, d: Omit<Task, 'id' | 'trade' | 'book' | 'no' | 'models'>): Task => ({ id: `amm:${m}:${no}`, trade: 'mech', book: 'AMM', no, models: [m], ...d });
  const out: Task[] = [];
  out.push(
    piston
      ? amm('05-20-01', {
          title: `100-hour inspection, with the oil and filter change and the hub eddy-current check (AD 2016-09-12)${m === 'twin' ? ': both engines' : ''}`,
          short: '100-hr inspection',
          chapter: '05 Time limits',
          kind: 'inspect100',
          card: 'inspection',
          prefilled: true,
          main: [],
          bench: [
            { item: 'SAE-J1899-2050', qty: oilQt(m) * e },
            { tag: 'oilFilter', ata: '79-20', qty: e },
            { item: 'AN900-10', qty: e },
            { item: 'FH-G18', qty: 12 * e },
            { item: 'MS20995C32', qty: 2 },
            { item: 'MS24665-302', qty: 2 },
            { item: 'MS28775-227', qty: 1 },
          ],
          tools: ['T-TW-IN', 'T-DIFF'],
          keywords: ['100-hour', '100hr', 'inspection', 'hundred', 'compression', 'eddy', 'current', 'hub', 'ad', 'oil', 'plugs', 'annual'],
        })
      : amm('05-20-02', {
          title: 'Phase inspection: oil filter element and chip detector checked, gear, brakes, controls, wing root',
          short: 'Phase inspection',
          chapter: '05 Time limits',
          kind: 'inspect100',
          card: 'inspection',
          prefilled: true,
          main: [],
          bench: [
            { tag: 'filterPacking', ata: '79-20', qty: 1 },
            { tag: 'detectorPacking', ata: '79-20', qty: 1 },
            { item: 'MS20995C32', qty: 2 },
            { item: 'MS24665-302', qty: 2 },
            { item: 'MS28775-227', qty: 1 },
          ],
          tools: ['T-TW-IN'],
          keywords: ['phase', 'inspection', 'chip', 'detector', 'filter', 'turbine'],
        }),
  );
  out.push(
    amm('07-10-01', { title: 'Jacking: jack points, axle jack pads, wing jacks', short: 'Jacking', chapter: '07 Lifting', main: [], bench: [], tools: [], keywords: ['jack', 'jacking', 'lift', 'axle', 'pad'] }),
    amm('12-10-01', { title: `Tires: servicing (inflation ${m === 'twin' ? '55' : m === 'cargo' ? '65' : '40'} psi, cold)`, short: 'Tire servicing', chapter: '12 Servicing', main: [], bench: [], tools: [], keywords: ['tire', 'pressure', 'inflation', 'servicing', 'psi', 'nitrogen'] }),
    amm('12-12-01', { title: piston ? 'Engine oil: level check and servicing' : 'Engine oil: level check (turbine)', short: 'Oil level check', chapter: '12 Servicing', main: [], bench: [], tools: [], keywords: ['oil', 'level', 'dipstick', 'servicing', 'quart'] }),
  );
  if (piston)
    out.push(
      amm('79-00-01', {
        title: `Engine oil and filter: change${m === 'twin' ? ' (both engines)' : ''}`,
        short: 'Oil and filter change',
        chapter: '79 Oil',
        kind: 'oil',
        job: 'oil',
        card: 'oil',
        main: [{ slot: 'oilFilter', label: 'Oil filter', ata: '79-20', tag: 'oilFilter', qty: 'engines' }],
        bench: [
          { item: 'SAE-J1899-2050', qty: oilQt(m) * e },
          { item: 'AN900-10', qty: e },
          { item: 'MS20995C32', qty: e },
        ],
        tools: ['T-TW-IN'],
        keywords: ['oil', 'change', 'filter', 'drain', 'sump', '20w-50', 'quart'],
      }),
    );
  out.push(
    amm('32-40-01', {
      title: 'Main wheel, tire and tube: removal / installation',
      short: 'Tire and tube',
      chapter: '32 Landing gear',
      kind: 'tires',
      job: 'wheel',
      card: 'wheel',
      main: [
        { slot: 'tire', label: 'Tire', ata: '32-40', tag: 'tire', qty: 1, optional: true },
        { slot: 'tube', label: 'Tube', ata: '32-40', tag: 'tube', qty: 1, optional: true },
      ],
      bench: [
        { item: 'MIL-PRF-81322', qty: 1 },
        { item: 'MS24665-302', qty: 1 },
      ],
      // wheel tie bolts torque in in-lb
      tools: ['T-TW-IN'],
      keywords: ['wheel', 'tire', 'tyre', 'tube', 'flat', 'tread', 'removal', 'installation', 'bead'],
    }),
    amm('32-40-02', {
      title: 'Main brake linings: replacement (both mains)',
      short: 'Brake linings',
      chapter: '32 Landing gear',
      kind: 'tires',
      job: 'brake',
      card: 'brake',
      main: [{ slot: 'lining', label: 'Brake linings', ata: '32-40', tag: 'lining', qty: 'upa' }],
      bench: [{ item: '105-00500', qty: 16 }],
      tools: ['T-TW-FT', 'T-RIVET'],
      keywords: ['brake', 'lining', 'linings', 'pad', 'reline', 'rivet', 'worn'],
    }),
    amm('32-40-03', {
      title: 'Main wheel halves: corrosion treatment and penetrant inspection',
      short: 'Wheel-half corrosion and penetrant',
      chapter: '32 Landing gear',
      kind: 'corrosion',
      job: 'corrosion',
      card: 'wheelhalf',
      main: [{ slot: 'tube', label: 'Tube (if chafed)', ata: '32-40', tag: 'tube', qty: 1, optional: true }],
      bench: [
        { item: 'E1417-KIT', qty: 1 },
        { item: 'MIL-DTL-5541', qty: 1 },
      ],
      // Type I fluorescent penetrant is read under UV-A
      tools: ['T-UVA'],
      keywords: ['wheel', 'half', 'corrosion', 'penetrant', 'crack', 'bead', 'seat', 'conversion', 'coating', 'ndt'],
    }),
    amm('57-10-01', {
      title: 'Wing spar lower cap and wing root: inspection',
      short: 'Wing spar inspection',
      chapter: '57 Wings',
      kind: 'spar',
      job: 'spar',
      card: 'spar',
      main: [],
      bench: [{ item: 'E1417-KIT', qty: 2 }],
      tools: ['T-UVA'],
      keywords: ['wing', 'spar', 'cap', 'root', 'rivets', 'smoking', 'penetrant', 'crack', 'ad'],
    }),
    amm('61-10-01', {
      title: 'Propeller: removal / installation, track and bolt torque',
      short: 'Propeller bolts and track',
      chapter: '61 Propellers',
      kind: 'prop',
      job: 'prop',
      card: 'prop',
      main: [{ slot: 'propBolt', label: 'Prop mounting bolts', ata: '61-10', tag: 'propBolt', qty: 6, optional: true }],
      bench: [
        { item: 'MS20995C32', qty: 1 },
        { tag: 'hubOring', ata: '61-10', qty: 1 },
        { item: 'MIL-PRF-907', qty: 1, when: 'postSb' },
      ],
      tools: ['T-TW-FT'],
      keywords: ['propeller', 'prop', 'bolt', 'torque', 'track', 'vibration', 'flange', 'removal'],
    }),
    amm('61-10-02', {
      title: 'Propeller mounting bolts: safety wiring',
      short: 'Prop bolt safety wire',
      chapter: '61 Propellers',
      kind: 'wire',
      job: 'wire',
      card: 'safetywire',
      main: [],
      bench: [{ item: 'MS20995C32', qty: 1 }],
      tools: [],
      keywords: ['safety', 'wire', 'lockwire', 'propeller', 'prop', 'bolt'],
    }),
    amm('23-10-01', {
      title: 'VHF com transceiver: removal / installation, tray and connector',
      short: 'Com radio',
      chapter: '23 Communications',
      kind: 'avionics',
      job: 'avionics',
      card: 'radio',
      main: [
        { slot: 'radio', label: 'Com transceiver', ata: '23-10', tag: 'radio', qty: 1, optional: true },
        { slot: 'connector', label: 'Connector kit', ata: '23-10', tag: 'connector', qty: 1, optional: true },
        { slot: 'lockScrew', label: 'Cam-lock screw', ata: '23-10', tag: 'lockScrew', qty: 1, optional: true },
      ],
      bench: [],
      tools: ['T-TW-IN'],
      keywords: ['com', 'radio', 'transceiver', 'vhf', 'tray', 'connector', 'avionics', 'transmit'],
    }),
    amm('24-30-01', {
      title: m === 'cargo' ? 'Starter-generator: removal / installation' : 'Alternator: removal / installation',
      short: m === 'cargo' ? 'Starter-generator' : 'Alternator',
      chapter: '24 Electrical power',
      kind: 'alternator',
      job: 'alternator',
      card: 'alternator',
      main: [{ slot: 'generator', label: m === 'cargo' ? 'Starter-generator' : 'Alternator', ata: '24-30', tag: 'generator', qty: 1 }],
      bench: [],
      tools: ['T-TW-IN'],
      keywords: m === 'cargo' ? ['starter-generator', 'generator', 'gen', 'gcu', 'brushes', 'removal'] : ['alternator', 'alt', 'output', 'charging', 'removal'],
    }),
  );
  if (piston)
    out.push(
      amm('24-30-02', {
        title: 'Alternator drive belt: tension check and replacement',
        short: 'Alternator belt',
        chapter: '24 Electrical power',
        kind: 'alternator',
        job: 'belt',
        card: 'belt',
        main: [{ slot: 'belt', label: 'V-belt', ata: '24-30', tag: 'belt', qty: 1 }],
        bench: [],
        tools: ['T-TW-IN'],
        keywords: ['belt', 'v-belt', 'alternator', 'tension', 'squeal', 'glazed'],
      }),
      amm('29-10-01', {
        title: 'Hydraulic power pack: servicing, filter, accumulator precharge',
        short: 'Hydraulic power pack service',
        chapter: '29 Hydraulic power',
        kind: 'hydraulics',
        job: 'powerpack',
        card: 'powerpack',
        main: [{ slot: 'filter', label: 'Filter element', ata: '29-10', tag: 'filter', qty: 1, optional: true }],
        bench: [
          { anyOf: FLUID, qty: 2 },
          { item: 'MS28775-228', qty: 1 },
          { item: 'MS20995C32', qty: 1 },
        ],
        tools: ['T-N2', 'T-TW-IN'],
        keywords: ['hydraulic', 'power', 'pack', 'pump', 'filter', 'accumulator', 'precharge', 'nitrogen', 'reservoir', 'gear'],
      }),
      amm('32-42-01', {
        title: 'Main brakes: bleeding',
        short: 'Brake bleed',
        chapter: '32 Landing gear',
        kind: 'hydraulics',
        job: 'bleed',
        card: 'bleed',
        main: [],
        bench: [{ anyOf: FLUID, qty: 2 }],
        tools: [],
        keywords: ['brake', 'bleed', 'bleeding', 'air', 'pedal', 'soft', 'spongy', 'hydraulic', 'fluid'],
      }),
      amm('72-30-01', {
        title: 'Cylinder: removal / installation (rare)',
        short: 'Cylinder change',
        chapter: '72 Engine',
        kind: 'cylinder',
        job: 'cylinder',
        card: 'cylinder',
        main: [],
        fixed: [{ item: 'byModel', qty: 1 }],
        bench: [
          { item: m === 'twin' ? 'BGS520-19' : 'BGS520-12', qty: 1 },
          { item: 'MIL-PRF-907', qty: 1 },
        ],
        tools: ['T-TW-FT', 'T-TW-IN', 'T-DIFF'],
        keywords: ['cylinder', 'compression', 'cht', 'piston', 'rings', 'engine', 'exchange'],
      }),
    );
  out.push({
    id: `afm:${m}:4`,
    trade: 'mech',
    book: 'AFM',
    no: 'Section 4',
    models: [m],
    title: 'Starting engine with external power',
    short: 'Ground power start',
    chapter: 'AFM / POH',
    kind: 'gpustart',
    main: [],
    bench: [],
    tools: [],
    keywords: ['ground', 'power', 'start', 'external', 'gpu', 'cart', 'battery', 'weak'],
    steps: ['Battery master as the placard says; avionics OFF.', 'Hook up the cart, plug in dead, then switch it on.', 'Start; engine running, switch the cart off, then unplug.'],
  });
  return out;
}

/** the standby generator's service manual: the mechanic works its diesel */
const GSM: Task[] = [
  {
    id: 'gsm:2-1',
    trade: 'mech',
    book: 'GSM',
    no: '2-1',
    targets: ['gen'],
    title: 'Standby generator: engine oil, filters, coolant and hoses',
    short: 'Generator service',
    chapter: 'Generator',
    kind: 'genService',
    job: 'genmount',
    main: [{ slot: 'hose', label: 'Lower coolant hose', cat: 'generator', accepts: 'hose', qty: 1, optional: true }],
    bench: [
      { item: 'API-CK4-15W40', qty: 3 },
      { item: 'HPS-OF-60', qty: 1 },
      { item: 'HPS-FF-60', qty: 1 },
      { item: 'ELC-5050', qty: 1 },
    ],
    tools: ['T-TW-FT'],
    keywords: ['generator', 'diesel', 'oil', 'filter', 'coolant', 'hose', 'service', 'weekly', 'run'],
    steps: ['Run it warm, shut it down, lock out the transfer switch.', 'Drain and refill the oil (15W-40, 3 gal); new oil and fuel filters.', 'Check the hoses; replace a soft or weeping one; top up the coolant.', 'Run it under load 30 minutes; check for leaks.'],
  },
  {
    id: 'gsm:2-4',
    trade: 'mech',
    book: 'GSM',
    no: '2-4',
    targets: ['gen'],
    title: 'Standby generator: mounts and isolators',
    short: 'Generator mounts',
    chapter: 'Generator',
    kind: 'genService',
    job: 'genmount',
    main: [{ slot: 'isolator', label: 'Mount isolators', cat: 'generator', accepts: 'isolator', qty: 4 }],
    bench: [],
    tools: ['T-TW-FT'],
    keywords: ['generator', 'mount', 'isolator', 'vibration', 'shake', 'bolts'],
    steps: ['Lock out the transfer switch.', 'Jack the set off its mounts one corner at a time.', 'Replace the isolators; torque the mount bolts in a cross pattern.', 'Run it: no walking on the pad.'],
  },
];

// ---------------------------------------------------------------------------
// The electrician: the code and procedure reference (4.2)

const ref = (key: string, d: Omit<Task, 'id' | 'trade' | 'book'>): Task => ({ id: `ref:${key}`, trade: 'elec', book: 'REF', ...d });
const ELEC_ALL = [...HOUSES, 'panel', 'gen'];

const REF: Task[] = [
  ref('outlet', {
    no: 'R-OUT',
    title: 'Dead, warm or scorched receptacle: find the fault, replace the device, protect it as the code now requires',
    short: 'Receptacle repair',
    chapter: 'Art. 406 Receptacles',
    kind: 'trip',
    targets: HOUSES,
    main: [
      { slot: 'receptacle', label: 'Receptacle', cat: 'devices', accepts: 'receptacle', qty: 1 },
      { slot: 'protection', label: 'Protection (AFCI / GFCI / DF)', cat: 'breakers', accepts: 'protection', qty: 1, optional: true },
      { slot: 'cover', label: 'Weatherproof cover', cat: 'boxes', accepts: 'cover', qty: 1, optional: true, outdoor: true },
    ],
    bench: [{ item: 'WN-ASST', qty: 1 }],
    tools: [],
    nec: ['110.14', '406.4(D)(3)', '406.4(D)(4)', '406.12', '406.9(B)(1)', '210.21(B)(1)'],
    keywords: ['receptacle', 'outlet', 'dead', 'warm', 'scorched', 'burnt', 'backstab', 'replace', 'afci', 'gfci', 'tr'],
    summary:
      'A replaced receptacle gets the protection the location needs today: AFCI in bedrooms, living areas, kitchens, laundry and halls (406.4(D)(4)); GFCI in bathrooms, kitchens, laundry and outdoors (406.4(D)(3)). An AFCI receptacle, a DF receptacle or the right breaker does it. Dwelling receptacles are tamper-resistant (406.12). A single receptacle on an individual 20 A circuit is a 20 A one (210.21(B)(1)).',
  }),
  ref('gfci', {
    no: 'R-GFCI',
    title: 'GFCI protection: test, replace, protect downstream',
    short: 'GFCI replacement',
    chapter: 'Art. 210 Branch circuits',
    kind: 'gfci',
    job: 'gfci',
    targets: HOUSES,
    main: [
      { slot: 'gfci', label: 'GFCI device', cat: 'devices', accepts: 'gfci', qty: 1 },
      { slot: 'protection', label: 'Protection (AFCI / DF)', cat: 'breakers', accepts: 'protection', qty: 1, optional: true },
      { slot: 'cover', label: 'Weatherproof cover', cat: 'boxes', accepts: 'cover', qty: 1, optional: true, outdoor: true },
    ],
    bench: [{ item: 'WN-ASST', qty: 1 }],
    tools: [],
    nec: ['210.8(A)', '406.4(D)(3)', '406.4(D)(4)', '406.12', '406.9(B)(1)'],
    keywords: ['gfci', 'gfi', 'ground-fault', 'trip', 'trips', 'reset', 'bathroom', 'kitchen', 'outdoor', 'porch', 'test'],
    summary:
      'Bathrooms, kitchens, laundry and outdoors need GFCI protection (210.8(A)); a GFCI device protects its LOAD side too. Test it: it should trip between 4 and 6 mA. A replacement in a kitchen or laundry also needs AFCI protection (a DF device does both). Outdoors: a weather-resistant device and an in-use cover (406.9(B)(1)).',
  }),
  ref('wh', {
    no: 'R-WH',
    title: 'Water heater: element shorted to its sheath, equipment ground open',
    short: 'Water heater repair',
    chapter: 'Art. 422 Appliances',
    kind: 'flicker',
    job: 'heater',
    log: 'water heater repair',
    rule: 'wh',
    targets: HOUSES,
    main: [{ slot: 'element', label: 'Heating element', cat: 'equipment', accepts: 'element', qty: 1 }],
    bench: [
      { item: 'WN-ASST', qty: 1 },
      { item: 'GRN-50', qty: 1 },
    ],
    tools: ['T-CLAMP'],
    nec: ['250.4(A)(5)', '250.110', '422.13'],
    keywords: ['water', 'heater', 'element', 'shower', 'tingle', 'shock', 'ground', 'sheath'],
    summary: 'An element leaking to its sheath puts voltage on the tank and the piping when the equipment ground is open. Meter the element to the sheath, fix the EGC at the heater’s junction box (250.4(A)(5), 250.110), replace the element.',
  }),
  ref('ground', {
    no: 'R-GRND',
    title: 'Grounding and bonding: electrodes, the water-pipe bond',
    short: 'Bonding jumper',
    chapter: 'Art. 250 Grounding and bonding',
    kind: 'flicker',
    job: 'bond',
    log: 'bonding repair',
    rule: 'bond',
    targets: HOUSES,
    main: [
      { slot: 'jumper', label: 'Bonding jumper (bare Cu)', cat: 'grounding', accepts: 'jumper', qty: 10 },
      { slot: 'clamp', label: 'Pipe clamp', cat: 'grounding', accepts: 'clamp', qty: 1 },
    ],
    bench: [],
    tools: ['T-CLAMP'],
    nec: ['250.104(A)', '250.52', '250.53', '250.66', '250.70'],
    keywords: ['ground', 'grounding', 'bond', 'bonding', 'jumper', 'water', 'pipe', 'electrode', 'tingle', 'shock'],
    summary:
      'Metal water piping is bonded to the service with a jumper sized from Table 250.102(C)(1) (8 AWG copper up to a 2 AWG service; 6 AWG is common and always fine) and a listed clamp (250.104(A)). Voltage between the valve and the drain means the bond is missing or open.',
  }),
  ref('afci', {
    no: 'R-AFCI',
    title: 'AFCI protection: bedrooms, living areas, kitchens, laundry, halls',
    short: 'AFCI protection',
    chapter: 'Art. 210 Branch circuits',
    targets: HOUSES,
    main: [],
    bench: [],
    tools: [],
    nec: ['210.12(A)', '406.4(D)(4)'],
    keywords: ['afci', 'afi', 'arc-fault', 'arc', 'bedroom', 'living', 'hall', 'kitchen', 'laundry'],
    summary: 'Dwelling bedrooms, living areas, kitchens, laundry areas and halls get AFCI protection (210.12(A)). A replaced receptacle there gets it too (406.4(D)(4)): an AFCI breaker, an outlet branch-circuit AFCI receptacle, or a DF device.',
  }),
  ref('3way', {
    no: 'R-3WAY',
    title: '3-way switching: common and travelers',
    short: '3-way switch repair',
    chapter: 'Art. 404 Switches',
    kind: 'switch3',
    job: 'switch3',
    targets: HOUSES,
    main: [
      { slot: 'switch', label: '3-way switches', cat: 'devices', accepts: 'switch3', qty: 2, optional: true },
      { slot: 'cable', label: 'Cable (3-conductor)', cat: 'cable', accepts: 'cable3', qty: 25, optional: true },
      { slot: 'box', label: 'Device box', cat: 'boxes', accepts: 'box', qty: 1, optional: true },
    ],
    bench: [{ item: 'WN-ASST', qty: 1 }],
    tools: [],
    nec: ['404.2(A)', '404.2(C)', '200.7(C)(1)', '314.16'],
    keywords: ['3-way', 'three-way', 'switch', 'traveler', 'common', 'hall', 'stairs', 'light', 'box', 'fill', 'warm'],
    summary: 'A 3-way pair has a common (the dark screw) and two travelers; the travelers run in 3-conductor cable (14/3 on a 15 A circuit, 12/3 on 20 A). Box fill (314.16): 12 AWG takes 2.25 cu in a conductor, two 12/3 cables and a device need 20.25 cu in.',
  }),
  ref('inspect', {
    no: 'R-INSP',
    title: 'Inspection readiness: directory, clearances, labels, breaker sizing',
    short: 'Code inspection prep',
    chapter: 'Art. 408 Panels',
    kind: 'codeprep',
    job: 'codeprep',
    targets: HOUSES,
    prefilled: true,
    main: [],
    bench: [{ item: 'LABELS', qty: 1 }],
    tools: ['T-TORQUE', 'T-CLAMP'],
    nec: ['408.4(A)', '110.26(A)', '110.22(A)', '240.4(D)'],
    keywords: ['inspection', 'code', 'county', 'directory', 'labels', 'clearance', 'panel', 'prep'],
    summary: 'The panel directory names every circuit (408.4(A)); 30 in wide and 3 ft deep of working space in front (110.26(A)); breakers sized to their wire (240.4(D)); lugs torqued (110.14(D)).',
  }),
  ref('storm', {
    no: 'R-STORM',
    title: 'Storm damage: replace wet branch wiring and devices (rare)',
    short: 'Storm rewire',
    chapter: 'Art. 334/340/352/358 Wiring methods',
    kind: 'storm',
    targets: HOUSES,
    main: [],
    fixed: [{ item: 'LOT-STORM', qty: 1 }],
    bench: [{ item: 'WN-ASST', qty: 2 }],
    tools: ['T-FISH', 'T-MEGGER'],
    nec: ['110.11', '334.12(B)(4)', '406.4(D)', '406.9(B)(1)'],
    keywords: ['storm', 'water', 'wet', 'flood', 'porch', 'box', 'dead', 'rooms', 'rewire', 'uf'],
    summary: 'Wiring and devices that were submerged or soaked are replaced, not dried out (110.11). NM-B isn’t permitted in wet locations: UF-B there (334.12(B)(4)). Megger the runs that stay.',
  }),
  ref('flicker', {
    no: 'R-FLICK',
    title: 'Flicker, dimming, a loose neutral at the panel or the service',
    short: 'Flicker diagnosis',
    chapter: 'Art. 110 General',
    kind: 'flicker',
    targets: HOUSES,
    main: [],
    bench: [{ item: 'WN-ASST', qty: 1 }],
    tools: ['T-CLAMP', 'T-TORQUE'],
    nec: ['110.14', '110.14(D)', '200.2'],
    keywords: ['flicker', 'flickering', 'dim', 'dimming', 'neutral', 'loose', 'lights', 'surge', 'voltage'],
    summary: 'Lights that brighten on one leg and dim on the other when a big load starts mean a loose neutral. Measure neutral-to-ground under load; torque the neutral lugs to the listing (110.14(D)).',
  }),
  ref('spa', {
    no: 'R-SPA',
    title: 'Outdoor hot tub: the feed, the spa panel, raceway and whip',
    short: 'Hot-tub circuit',
    chapter: 'Art. 680 Spas',
    kind: 'hottub',
    targets: HOUSES,
    prefilled: true,
    main: [
      { slot: 'spa', label: 'Spa panel (GFCI disconnect)', cat: 'equipment', accepts: 'spa', qty: 1 },
      { slot: 'feed', label: 'Feed breaker (2-pole)', cat: 'breakers', accepts: 'feed', qty: 1 },
      { slot: 'wire', label: 'Wire: L1, L2, N', cat: 'wire', accepts: 'thwn', qty: 'run', takeoff: { conductors: 3 } },
      { slot: 'egc', label: 'Wire: EGC', cat: 'wire', accepts: 'thwn', qty: 'run', takeoff: { conductors: 1 } },
      { slot: 'emt', label: 'EMT stick (wall section)', cat: 'conduit', accepts: 'emt', qty: 1 },
      { slot: 'connectors', label: 'EMT connectors', cat: 'conduit', accepts: 'emtConn', qty: 2 },
      { slot: 'pvc', label: 'PVC sticks (underground)', cat: 'conduit', accepts: 'pvc', qty: 'runLess10' },
    ],
    bench: [
      { item: 'PVC-FIT1', qty: 1 },
      { item: 'PVC-CEM', qty: 1 },
    ],
    tools: ['T-BEND', 'T-MEGGER', 'T-TORQUE'],
    nec: ['680.42', '680.44', '680.13', '358.42', '352', '300.5', 'Table 250.122', 'Table 310.16'],
    keywords: ['spa', 'hot', 'tub', 'hottub', 'feed', 'panel', 'disconnect', 'emt', 'pvc', 'conduit', 'take-off', 'takeoff'],
    summary:
      'A spa gets GFCI protection (680.44) and a disconnect in sight, at least 5 ft away (680.13). Size the three conductors for the tub (Table 310.16 at 75 °C: #6 for 60 A, #8 for 50 A) and the EGC from Table 250.122 (#10 up to 60 A). Outdoors, EMT fittings are raintight (358.42); underground, PVC with factory sweeps (352).',
  }),
  ref('feeder', {
    no: 'R-FEED',
    title: 'Underground feeder to the cottages: find the failed splice, re-splice',
    short: 'Feeder re-splice',
    chapter: 'Art. 334/340/352/358 Wiring methods',
    kind: 'feeder',
    targets: ['panel'],
    main: [{ slot: 'splice', label: 'Direct-burial splices (L1, L2, N, EGC)', cat: 'connectors', accepts: 'splice', qty: 4 }],
    bench: [],
    tools: ['T-MEGGER'],
    nec: ['225', 'Table 300.5', '300.5(E)', '110.14(B)', '110.7'],
    keywords: ['feeder', 'underground', 'buried', 'splice', 'megger', 'insulation', 'cottages', 'dropped', 'handhole'],
    summary:
      'Lock the feeder out and open it at the cottages. Megger it: a failed splice reads well under 1 MΩ to ground, good cable hundreds of MΩ or more. Open the hand holes and megger back to the panel to find the section, dig it up, cut the failed splice out and re-make it with the slack in the trench, a kit listed for direct burial on each conductor (300.5(E), 110.14(B)). Megger again before it goes back on (110.7): still low, the failed splice is elsewhere. Backfill to 24 in of cover (Table 300.5), with a warning ribbon above it as good practice (required on services, 300.5(D)(3)).',
  }),
  ref('panel', {
    no: 'R-PANEL',
    title: 'Island distribution panel upgrade (rare)',
    short: 'Panel upgrade',
    chapter: 'Art. 408 Panels',
    kind: 'panelUp',
    targets: ['panel'],
    prefilled: false,
    main: [],
    fixed: [{ item: 'LOT-DIST', qty: 1 }],
    bench: [{ item: 'NOALOX', qty: 1 }],
    tools: ['T-TORQUE', 'T-KO', 'T-PULL'],
    nec: ['230', '408', '250.24', '250.52(A)(5)', '250.53(A)', '110.14(D)', '312.5'],
    keywords: ['panel', 'panelboard', 'distribution', 'upgrade', 'capacity', 'load', 'service'],
    summary: 'A new distribution panelboard: two ground rods at least 6 ft apart (250.53(A)), the GEC, feeder lugs torqued to the listing (110.14(D)), unused openings closed (312.5).',
  }),
  ref('deadckt', {
    no: 'R-DEAD',
    title: 'Dead circuit at the panel: breaker, lug, bus',
    short: 'Dead circuit repair',
    chapter: 'Art. 408 Panels',
    kind: 'xfmr',
    targets: ['panel'],
    main: [{ slot: 'breaker', label: 'Breaker', cat: 'breakers', accepts: 'breaker', qty: 1, optional: true }],
    bench: [],
    tools: ['T-TORQUE', 'T-CLAMP'],
    nec: ['110.14(D)', '240', '408'],
    keywords: ['dead', 'circuit', 'breaker', 'lug', 'bus', 'sag', 'voltage', 'phase', 'hot'],
    summary: 'Breaker on, no voltage at the load: meter line and load side. Open contacts: replace the breaker with one listed for the panel, the same rating (110.3(B), 240.4(D)). A hot lug: re-terminate and torque it (110.14(D)).',
  }),
  ref('dock', {
    no: 'R-DOCK',
    title: 'Fuel dock run: landside conduit, the classified section in RMC with a seal (rare)',
    short: 'Fuel-dock run',
    chapter: 'Art. 514/555 Fuel dock',
    kind: 'dockrun',
    targets: ['panel'],
    main: [],
    fixed: [{ item: 'LOT-DOCK', qty: 1 }],
    bench: [],
    tools: ['T-BEND', 'T-MEGGER'],
    nec: ['514.8', '514.9', '501.15', '555.35', '300.5'],
    keywords: ['fuel', 'dock', 'pump', 'dispenser', 'rmc', 'seal', 'classified', 'gfpe', 'marina'],
    summary: 'Underground wiring under a dispenser runs in threaded RMC with a seal fitting where it leaves the classified area (514.8, 514.9, 501.15). Marina receptacles and feeders get ground-fault protection (555.35).',
  }),
  ref('xfer', {
    no: 'R-XFER',
    title: 'Standby generator: transfer switch and circuits (rare)',
    short: 'Transfer switch upgrade',
    chapter: 'Art. 702 Standby',
    kind: 'transfer',
    job: 'transfer',
    targets: ['gen'],
    main: [],
    fixed: [{ item: 'LOT-XFER', qty: 1 }],
    bench: [],
    tools: ['T-TORQUE', 'T-KO'],
    nec: ['702.4(B)', '702.5', '445.13'],
    keywords: ['transfer', 'switch', 'ats', 'generator', 'standby', 'backup', 'villas', 'pick', 'up'],
    summary: 'A standby system’s transfer equipment is sized for the load it carries (702.4(B)) and listed for the purpose (702.5); the generator’s conductors carry 115% of its nameplate (445.13).',
  }),
  ref('gentest', {
    no: 'R-GENT',
    title: 'Generator-backed circuits: weekly test and repair',
    short: 'Generator circuit repair',
    chapter: 'Art. 702 Standby',
    kind: 'genTest',
    targets: ['gen'],
    main: [{ slot: 'relay', label: 'Transfer-panel relay', cat: 'equipment', accepts: 'relay', qty: 1, optional: true }],
    bench: [{ item: 'WN-ASST', qty: 1 }],
    tools: ['T-CLAMP'],
    nec: ['110.3(B)', '702.4'],
    keywords: ['generator', 'test', 'weekly', 'backed', 'relay', 'coil', 'transfer', 'circuit'],
    summary: 'The weekly test runs the transfer under load. A backed-up circuit that doesn’t come on: meter its relay coil (open) and contacts; replace with the listed part (110.3(B)).',
  }),
  ref('boxfill', {
    no: 'R-BOX',
    title: 'Box fill: counting conductors, devices and grounds',
    short: 'Box fill',
    chapter: 'Art. 314 Boxes',
    targets: ELEC_ALL,
    main: [],
    bench: [],
    tools: [],
    nec: ['314.16'],
    keywords: ['box', 'fill', 'volume', 'cubic', 'inch', 'conductors', 'crammed'],
    summary: 'Each insulated conductor counts once, all the grounds together once, a device yoke twice (314.16(B)). At 12 AWG each counts 2.25 cu in, at 14 AWG 2.0.',
  }),
  ref('wet', {
    no: 'R-WET',
    title: 'Wet and damp locations',
    short: 'Wet locations',
    chapter: 'Art. 406 Receptacles',
    targets: ELEC_ALL,
    main: [],
    bench: [],
    tools: [],
    nec: ['406.9', '314.15', '358.42', '334.12(B)(4)'],
    keywords: ['wet', 'damp', 'outdoor', 'weather', 'in-use', 'raintight', 'porch'],
    summary: 'Outdoor 15 and 20 A receptacles are weather-resistant under an in-use (extra-duty) cover (406.9(B)(1)); boxes are listed for wet locations (314.15); EMT fittings raintight (358.42); no NM-B there (334.12(B)(4)).',
  }),
  ref('tr', {
    no: 'R-TR',
    title: 'Tamper-resistant receptacles',
    short: 'Tamper-resistant receptacles',
    chapter: 'Art. 406 Receptacles',
    targets: ELEC_ALL,
    main: [],
    bench: [],
    tools: [],
    nec: ['406.12', '406.4(D)(5)'],
    keywords: ['tamper', 'resistant', 'tr', 'child', 'shutters', 'receptacle'],
    summary: 'Every 15 and 20 A, 125 V receptacle in a dwelling or guest room is tamper-resistant (406.12), replacements included (406.4(D)(5)).',
  }),
];

// ---------------------------------------------------------------------------
// Lookups

const ALL_TASKS: Task[] = [...MODELS.flatMap(mechTasks), ...GSM, ...REF];
const BY_ID = new Map<TaskId, Task>(ALL_TASKS.map((t) => [t.id, t]));
export const TASKS: readonly Task[] = ALL_TASKS;

export const taskById = (id: TaskId): Task | undefined => BY_ID.get(id);

/**
 * The manual set for an asset: a plane's AMM and AFM (mechanic); the
 * generator's service manual (mechanic) or the reference (electrician); the
 * reference on houses and the grid (electrician).
 */
export function tasksFor(_s: IslandState | null, asset: Pick<Asset, 'kind' | 'model'>, role: OpsRole): Task[] {
  if (asset.kind === 'plane') return role === 'mech' ? ALL_TASKS.filter((t) => t.trade === 'mech' && t.models?.includes(planeModel(asset.model))) : [];
  return ALL_TASKS.filter((t) => t.trade === role && t.targets?.includes(asset.model));
}

/** the task a kind's work goes by on an asset, when nothing more specific names it (write-ups, migration, repairs' originals) */
const DEFAULT_NO: Record<string, string> = {
  inspect100: '05-20',
  tires: '32-40-02',
  prop: '61-10-01',
  corrosion: '32-40-03',
  avionics: '23-10-01',
  alternator: '24-30-01',
  cylinder: '72-30-01',
  spar: '57-10-01',
  wire: '61-10-02',
  oil: '79-00-01',
  hydraulics: '29-10-01',
  genService: 'gsm:2-1',
  trip: 'ref:outlet',
  gfci: 'ref:gfci',
  switch3: 'ref:3way',
  codeprep: 'ref:inspect',
  storm: 'ref:storm',
  flicker: 'ref:flicker',
  hottub: 'ref:spa',
  feeder: 'ref:feeder',
  panelUp: 'ref:panel',
  transfer: 'ref:xfer',
  xfmr: 'ref:deadckt',
  dockrun: 'ref:dock',
  genTest: 'ref:gentest',
};

/** the default task's number for a kind ('ref:outlet' for 'trip'): what a legacy (pre-flow) job goes by */
export const defaultTaskNo = (kind: string): string | undefined => DEFAULT_NO[kind];

/** the default task for a kind on an asset (undefined for kinds with no flow task: load sheets, ground power starts) */
export function defaultTask(kind: string, asset: Pick<Asset, 'kind' | 'model'>): Task | undefined {
  const no = DEFAULT_NO[kind];
  if (!no) return undefined;
  if (no.startsWith('ref:') || no.startsWith('gsm:')) return taskById(no);
  if (asset.kind !== 'plane') return undefined;
  const m = planeModel(asset.model);
  if (no === '05-20') return taskById(`amm:${m}:${m === 'cargo' ? '05-20-02' : '05-20-01'}`);
  return taskById(`amm:${m}:${no}`);
}

/** the task with this number on an asset: '32-42-01' on a plane, 'ref:gfci', 'gsm:2-4' */
export function taskOn(no: string, asset: Pick<Asset, 'kind' | 'model'>): Task | undefined {
  if (no.startsWith('ref:') || no.startsWith('gsm:')) return taskById(no);
  if (asset.kind !== 'plane') return undefined;
  const m = planeModel(asset.model);
  if (no === '05-20') return taskById(`amm:${m}:${m === 'cargo' ? '05-20-02' : '05-20-01'}`);
  return taskById(`amm:${m}:${no}`);
}

/** the floor under a task's labour (8.3): the trade's rate x the task's hours, up to the next $10 */
export function laborMin(t: Pick<Task, 'no' | 'trade' | 'book'>): number {
  const key = t.book === 'GSM' ? `GSM ${t.no}` : t.no;
  const h = LABOR.hours[key];
  return h === undefined ? LABOR.minDefault : Math.ceil((LABOR.rate[t.trade] * h) / 10) * 10;
}

/** tasks with a kind can be planned; the rest are reference */
export const plannable = (t: Task) => !!t.kind && t.kind !== 'gpustart';

// ---------------------------------------------------------------------------
// What a task draws on this airplane or site

/** the assemblies an AMM task does at once: both mains for the brake linings */
const ASSEMBLIES: Record<string, number> = { lining: 2 };

/** a slot's quantity on this airplane (an alteration's own units per assembly where it governs) or at this site */
export function slotQty(slot: MainSlot, ac: Aircraft | null, site?: ElecSite | null): number {
  if (typeof slot.qty === 'number') return slot.qty;
  if (slot.qty === 'engines') return ac ? engines(ac.model) : 1;
  if (slot.qty === 'upa') {
    if (!ac || !slot.ata || !slot.tag) return 1;
    const planted = plantedFor(ac, slot.ata, slot.tag);
    const row = planted ? plantRows(ac.model, slot.ata as never).find((x) => x.tag === slot.tag) : rowFor(ipcFor(ac, slot.ata), slot.tag);
    const upa = typeof row?.upa === 'number' ? row.upa : 1;
    return upa * (ASSEMBLIES[slot.tag] ?? 1);
  }
  const feet = site?.feet ?? 40;
  const run = Math.ceil(feet * 1.1);
  if (slot.qty === 'run') return run * (slot.takeoff?.conductors ?? 1);
  // runLess10: the run less the 10 ft wall section, in 10 ft sticks
  return Math.max(1, Math.ceil((feet - 10) / 10));
}

/** is this airplane POST SB for a figure (the anti-seize on POST SB prop bolts) */
const postSb = (ac: Aircraft, ata: AnyAta) => ata !== '79-20' && ac.sbs.some((x) => x.id === figSb(ac.model, ata).id);

/**
 * The bench lines a task draws on its own, for this airplane or asset: a tag
 * resolves to the airplane's effective P/N (fig 79-20: the oil filter), `anyOf`
 * to the card's approved fluid, `when` to the SB status of the task's figure.
 */
export function benchFor(task: Task, ac: Aircraft | null, _asset?: Pick<Asset, 'kind' | 'model'> | null): { item: ItemId; qty: number }[] {
  const out: { item: ItemId; qty: number }[] = [];
  const fig = task.main.find((x) => x.ata)?.ata ?? (task.no.startsWith('61-10') ? '61-10' : undefined);
  for (const b of task.bench) {
    if (b.when === 'postSb' && (!ac || !fig || !postSb(ac, fig))) continue;
    let item: ItemId | undefined = b.item;
    if (!item && b.tag && b.ata && ac) item = rowFor(ipcFor(ac, b.ata), b.tag)?.pn;
    // the card's approved fluid: MIL-PRF-5606 is approved on every effectivity (and the ICA's power pack)
    if (!item && b.anyOf) item = b.anyOf[0];
    if (!item) continue;
    const at = out.find((x) => x.item === item);
    if (at) at.qty += b.qty;
    else out.push({ item, qty: b.qty });
  }
  return out;
}

/** a rare job's pre-filled line on this asset (the engine model's exchange cylinder, or the supply house's lot) */
export function fixedFor(task: Task, asset: Pick<Asset, 'kind' | 'model'>): { item: ItemId; qty: number }[] {
  return (task.fixed ?? []).map((f) => ({ item: f.item === 'byModel' ? (planeModel(asset.model) === 'twin' ? 'BCY520-19X' : 'BCY520-12X') : f.item, qty: f.qty }));
}

/** the main slots a task shows at a site (a cover only outdoors) */
export const slotsAt = (task: Task, site?: ElecSite | null) => task.main.filter((x) => !x.outdoor || site?.room === 'outdoor' || !!site?.wet);
