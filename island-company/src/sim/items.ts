// Items: everything the island buys, stocks, draws and installs (docs/JOBFLOW.md 2.1, 3).
// Derived from the code, never stored: the shop's consumables, the electrical
// supply catalog, job lots, tools and building materials are static here; each
// plane model's parts come from its IPC figures (every procurable row, both S/N
// blocks and both SB states: a superseded or not-effective P/N is still
// orderable, and that is the near-miss), plus the STC holders' ICA parts and
// the FAA-PMA replacements. Makers and P/Ns are fictional in the aircraft.ts
// style; specifications and NEC articles are real (2023 edition).
//
// List prices are flat across island tiers (labour carries the tier scaling).
import { figureRows, planeModel, plantPart, plantRows, pmaParts, type AnyAta, type Ata, type IpcRow, type PlaneModel } from './aircraft';
import { CHAIN, DEFAULT_SUPPLIER, SUPPLIERS } from './data';
import type { ElecSpec, Item, ItemCat, ItemId, ItemKind, SupplierId } from './types';

const MODELS: PlaneModel[] = ['twin', 'cargo', 'float'];
const r2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Mechanic: shop consumables, generator parts, rare-job and repair lines (3.2)

type Def = Omit<Item, 'id' | 'pn' | 'tags' | 'fam' | 'lead'> & { tags?: string[]; fam?: string; lead?: number };
const item = (pn: string, d: Def): Item => ({ id: pn, pn, lead: 1, fam: d.fam ?? pn, ...d, tags: d.tags ?? [] });

const MECH_SHOP: Item[] = [
  item('MS20995C32', { nomen: 'Safety wire, 0.032 in, CRES (1 lb spool)', trade: 'mech', kind: 'consumable', cat: 'hardware', unit: 'use', pack: 25, packName: 'spool', price: 28, tags: ['safety', 'wire', 'lockwire', '032', 'cres'] }),
  item('MS20995C41', { nomen: 'Safety wire, 0.041 in, CRES (1 lb spool)', trade: 'mech', kind: 'consumable', cat: 'hardware', unit: 'use', pack: 25, packName: 'spool', price: 30, tags: ['safety', 'wire', 'lockwire', '041', 'cres'] }),
  item('MS24665-302', { nomen: 'Pin, cotter, 3/32 x 1 in', trade: 'mech', kind: 'consumable', cat: 'hardware', unit: 'ea', pack: 100, packName: 'box', price: 14, tags: ['cotter', 'pin', 'axle'] }),
  item('MS24665-283', { nomen: 'Pin, cotter, 1/16 x 3/4 in', trade: 'mech', kind: 'consumable', cat: 'hardware', unit: 'ea', pack: 100, packName: 'box', price: 12, tags: ['cotter', 'pin'] }),
  item('MS28775-227', { nomen: 'O-ring, brake piston', trade: 'mech', kind: 'consumable', cat: 'brakes', unit: 'ea', pack: 10, packName: 'bag', price: 22, tags: ['o-ring', 'oring', 'packing', 'brake', 'piston', 'seal'] }),
  item('MS28775-228', { nomen: 'O-ring, filter bowl', trade: 'mech', kind: 'consumable', cat: 'hydraulic', unit: 'ea', pack: 10, packName: 'bag', price: 22, tags: ['o-ring', 'oring', 'packing', 'filter', 'bowl', 'seal'] }),
  item('MS28775-230', { nomen: 'O-ring, filter bowl (Marlin power pack)', trade: 'mech', kind: 'consumable', cat: 'hydraulic', unit: 'ea', pack: 10, packName: 'bag', price: 22, tags: ['o-ring', 'oring', 'packing', 'filter', 'bowl', 'seal'] }),
  item('MS29513-116', { nomen: 'O-ring, reservoir filler cap', trade: 'mech', kind: 'consumable', cat: 'hydraulic', unit: 'ea', pack: 10, packName: 'bag', price: 22, tags: ['o-ring', 'oring', 'packing', 'cap', 'reservoir', 'seal'] }),
  item('MS29513-238', { nomen: 'O-ring, hub to flange', trade: 'mech', kind: 'consumable', cat: 'prop', unit: 'ea', pack: 1, price: 9, tags: ['o-ring', 'oring', 'hub', 'flange', 'propeller', 'seal'] }),
  item('MS29513-240', { nomen: 'O-ring, hub to flange (composite propeller)', trade: 'mech', kind: 'consumable', cat: 'prop', unit: 'ea', pack: 1, price: 9, tags: ['o-ring', 'oring', 'hub', 'flange', 'propeller', 'seal'] }),
  item('MS28778-6', { nomen: 'Packing, boss', trade: 'mech', kind: 'consumable', cat: 'hydraulic', unit: 'ea', pack: 10, packName: 'bag', price: 18, tags: ['packing', 'o-ring', 'boss', 'seal'] }),
  item('AN900-10', { nomen: 'Gasket, crush (oil drain plug)', trade: 'mech', kind: 'consumable', cat: 'engine', unit: 'ea', pack: 25, packName: 'bag', price: 15, tags: ['gasket', 'crush', 'drain', 'oil', 'washer'] }),
  item('AN814-8DL', { nomen: 'Plug, drain (drilled)', trade: 'mech', kind: 'part', cat: 'engine', unit: 'ea', pack: 1, price: 18, tags: ['plug', 'drain', 'oil', 'sump'] }),
  item('105-00500', { nomen: 'Rivet, lining', trade: 'mech', kind: 'consumable', cat: 'brakes', unit: 'ea', pack: 50, packName: 'bag', price: 18, tags: ['rivet', 'lining', 'brake'] }),
  item('MIL-PRF-5606', { nomen: 'Hydraulic fluid, petroleum base (red), 1 qt', trade: 'mech', kind: 'consumable', cat: 'fluids', unit: 'qt', pack: 12, packName: 'case', price: 216, bulk: true, tags: ['hydraulic', 'fluid', '5606', 'red', 'oil'] }),
  item('MIL-PRF-83282', { nomen: 'Hydraulic fluid, synthetic hydrocarbon (red), 1 qt', trade: 'mech', kind: 'consumable', cat: 'fluids', unit: 'qt', pack: 12, packName: 'case', price: 312, bulk: true, tags: ['hydraulic', 'fluid', '83282', 'red', 'synthetic'] }),
  item('SAE-J1899-2050', { nomen: 'Aviation piston oil, SAE J1899 20W-50, ashless dispersant, 1 qt', trade: 'mech', kind: 'consumable', cat: 'fluids', unit: 'qt', pack: 12, packName: 'case', price: 96, bulk: true, tags: ['oil', 'engine', '20w-50', '20w50', 'multigrade', 'ashless', 'dispersant', 'j1899'] }),
  item('SAE-J1899-50', { nomen: 'Aviation piston oil, SAE J1899 straight 50, 1 qt', trade: 'mech', kind: 'consumable', cat: 'fluids', unit: 'qt', pack: 12, packName: 'case', price: 90, bulk: true, tags: ['oil', 'engine', '50', 'straight', 'ashless', 'j1899'] }),
  item('MIL-PRF-23699', { nomen: 'Turbine oil, 5 cSt synthetic, 1 qt', trade: 'mech', kind: 'consumable', cat: 'fluids', unit: 'qt', pack: 12, packName: 'case', price: 264, bulk: true, tags: ['oil', 'turbine', 'synthetic', '23699'] }),
  item('MIL-PRF-81322', { nomen: 'Wheel bearing grease, 14 oz tube', trade: 'mech', kind: 'consumable', cat: 'wheels', unit: 'use', pack: 10, packName: 'tube', price: 32, tags: ['grease', 'bearing', 'wheel', '81322'] }),
  item('MIL-PRF-907', { nomen: 'Anti-seize thread compound, high temperature, 1 lb', trade: 'mech', kind: 'consumable', cat: 'hardware', unit: 'use', pack: 20, packName: 'can', price: 65, tags: ['anti-seize', 'antiseize', 'thread', 'compound', '907'] }),
  item('FH-G18', { nomen: 'Gasket, spark plug, 18 mm, copper', trade: 'mech', kind: 'consumable', cat: 'engine', unit: 'ea', pack: 50, packName: 'bag', price: 40, tags: ['gasket', 'spark', 'plug', 'copper'] }),
  item('E1417-KIT', {
    nomen: 'Penetrant kit, ASTM E1417 Type I fluorescent, Method C solvent-removable, sensitivity level 2, non-aqueous developer',
    trade: 'mech',
    kind: 'consumable',
    cat: 'airframe',
    unit: 'use',
    pack: 3,
    packName: 'kit',
    price: 95,
    tags: ['penetrant', 'dye', 'fluorescent', 'crack', 'ndt', 'e1417'],
  }),
  item('MIL-DTL-5541', { nomen: 'Chemical conversion coating, Type I Class 1A, 1 qt', trade: 'mech', kind: 'consumable', cat: 'airframe', unit: 'use', pack: 10, packName: 'qt', price: 42, tags: ['conversion', 'coating', 'alodine', 'corrosion', '5541'] }),
  item('HPS-OF-60', { nomen: 'Standby generator (Harborline 60 kW diesel): oil filter', trade: 'mech', kind: 'part', cat: 'generator', unit: 'ea', pack: 1, price: 22, tags: ['generator', 'oil', 'filter', 'diesel'] }),
  item('HPS-FF-60', { nomen: 'Standby generator (Harborline 60 kW diesel): fuel filter', trade: 'mech', kind: 'part', cat: 'generator', unit: 'ea', pack: 1, price: 26, tags: ['generator', 'fuel', 'filter', 'diesel'] }),
  item('HPS-FB-60', { nomen: 'Standby generator (Harborline 60 kW diesel): fan belt', trade: 'mech', kind: 'part', cat: 'generator', unit: 'ea', pack: 1, price: 35, tags: ['generator', 'fan', 'belt'] }),
  item('HPS-ISO-4', { nomen: 'Standby generator (Harborline 60 kW diesel): mount isolator', trade: 'mech', kind: 'part', cat: 'generator', unit: 'ea', pack: 1, price: 48, tags: ['generator', 'mount', 'isolator', 'vibration'] }),
  item('HPS-HOSE-60', { nomen: 'Standby generator (Harborline 60 kW diesel): lower coolant hose with clamps', trade: 'mech', kind: 'part', cat: 'generator', unit: 'ea', pack: 1, price: 38, tags: ['generator', 'coolant', 'hose', 'radiator'] }),
  item('API-CK4-15W40', { nomen: 'Diesel engine oil 15W-40 (API CK-4), 1 gal', trade: 'mech', kind: 'consumable', cat: 'fluids', unit: 'gal', pack: 4, packName: 'case', price: 112, bulk: true, tags: ['oil', 'diesel', '15w-40', '15w40', 'generator'] }),
  item('ELC-5050', { nomen: 'Coolant, extended life 50/50, 1 gal', trade: 'mech', kind: 'consumable', cat: 'fluids', unit: 'gal', pack: 4, packName: 'case', price: 96, bulk: true, tags: ['coolant', 'antifreeze', 'generator'] }),
  item('BCY520-19X', { nomen: 'Cylinder assy with piston and rings, overhauled exchange: BIO-520-MB (Brandt parts catalog)', trade: 'mech', kind: 'rotable', cat: 'engine', unit: 'ea', pack: 1, price: 1250, bulk: true, models: ['twin'], tags: ['cylinder', 'piston', 'rings', 'engine', 'brandt', 'exchange'], fam: 'cylinder:twin' }),
  item('BCY520-12X', { nomen: 'Cylinder assy with piston and rings, overhauled exchange: BIO-520-D (Brandt parts catalog)', trade: 'mech', kind: 'rotable', cat: 'engine', unit: 'ea', pack: 1, price: 1250, bulk: true, models: ['float'], tags: ['cylinder', 'piston', 'rings', 'engine', 'brandt', 'exchange'], fam: 'cylinder:float' }),
  item('BGS520-19', { nomen: 'Kit, gasket, cylinder: BIO-520-MB', trade: 'mech', kind: 'consumable', cat: 'engine', unit: 'ea', pack: 1, price: 65, models: ['twin'], tags: ['gasket', 'kit', 'cylinder', 'engine'] }),
  item('BGS520-12', { nomen: 'Kit, gasket, cylinder: BIO-520-D', trade: 'mech', kind: 'consumable', cat: 'engine', unit: 'ea', pack: 1, price: 65, models: ['float'], tags: ['gasket', 'kit', 'cylinder', 'engine'] }),
];

/** The repair lines: one per repair fix job, priced at today's kit money (4.4) */
export const RPR_JOBS: Record<string, { trade: 'mech' | 'elec'; what: string }> = {
  exhaust: { trade: 'mech', what: 'a cracked exhaust riser' },
  wheelhalf: { trade: 'mech', what: 'a wheel half and tire' },
  sparcap: { trade: 'mech', what: 'a spar-cap doubler repair (SRM kit)' },
  brake: { trade: 'mech', what: 'brake piston O-rings and a flush' },
  receptacle: { trade: 'mech', what: 'an external power receptacle and relay contacts' },
  avionics: { trade: 'mech', what: 'a com radio (exchange)' },
  alternator: { trade: 'mech', what: 'an alternator bracket and hardware' },
  hotsection: { trade: 'mech', what: 'hot-section inspection parts' },
  wire: { trade: 'mech', what: 'safety wire and hardware' },
  part: { trade: 'mech', what: 'a serviceable replacement part' },
  outlet: { trade: 'elec', what: 'devices, a box and a run of cable' },
};
const RPR: Item[] = Object.entries(RPR_JOBS).map(([job, d]) =>
  item(`RPR-${job}`, {
    nomen: `Parts for the repair: ${d.what}`,
    trade: d.trade,
    kind: 'part',
    cat: d.trade === 'mech' ? 'repair' : 'lots',
    unit: 'lot',
    pack: 1,
    price: 340,
    ...(d.trade === 'elec' ? { nec: ['110.12', 'practice: like-for-like devices, box and cable for the repair'] } : {}),
    tags: ['repair', 'parts', job],
  }),
);

// ---------------------------------------------------------------------------
// Electrician: materials with the NEC basis (3.3)

type EDef = Omit<Def, 'trade'> & { spec?: ElecSpec };
const el = (pn: string, d: EDef): Item => item(pn, { trade: 'elec', ...d });

const WIRE: Item[] = [
  ...(
    [
      [12, 0.2, 500, 20],
      [10, 0.32, 500, 30],
      [8, 0.65, 500, 50],
      [6, 1.0, 500, 65],
      [3, 2.2, 250, 100],
    ] as const
  ).map(([awg, ft, pack, amps]) =>
    el(`THWN-${awg}`, {
      nomen: `THHN/THWN-2 Cu, ${awg} AWG, cut to length`,
      kind: 'material',
      cat: 'wire',
      unit: 'ft',
      pack,
      packName: 'spool',
      cut: true,
      price: r2(ft * pack),
      fam: `thwn${awg}`,
      spec: { method: 'thwn', awg, conductors: 1, amps },
      nec: ['310.10', 'Table 310.16', 'Table 250.122'],
      tags: ['wire', 'thhn', 'thwn', 'thwn-2', 'conductor', 'copper', `${awg}awg`, `#${awg}`],
    }),
  ),
  ...(
    [
      ['NMB-14-2', 14, 2, 250, 95],
      ['NMB-14-3', 14, 3, 250, 160],
      ['NMB-12-2', 12, 2, 250, 140],
      ['NMB-12-3', 12, 3, 250, 230],
      ['NMB-10-2', 10, 2, 125, 190],
    ] as const
  ).map(([pn, awg, c, pack, price]) =>
    el(pn, {
      nomen: `NM-B ${awg}/${c} with ground, ${pack} ft roll`,
      kind: 'material',
      cat: 'cable',
      unit: 'ft',
      pack,
      packName: 'roll',
      price,
      fam: `nm${awg}-${c}`,
      spec: { method: 'nm', awg, conductors: c },
      nec: ['334', '240.4(D)', ...(c === 3 ? ['404.2(A)'] : [])],
      tags: ['cable', 'nm-b', 'nmb', 'romex', `${awg}/${c}`, `${awg}-${c}`],
    }),
  ),
  el('UFB-12-2', { nomen: 'UF-B 12/2 with ground, 250 ft roll', kind: 'material', cat: 'cable', unit: 'ft', pack: 250, packName: 'roll', price: 210, fam: 'uf12-2', spec: { method: 'uf', awg: 12, conductors: 2 }, nec: ['340.10', '334.12(B)(4)'], tags: ['cable', 'uf-b', 'ufb', 'underground', 'burial', 'wet'] }),
  el('CU6-BARE', { nomen: 'Bare Cu 6 AWG solid, cut to length', kind: 'material', cat: 'grounding', unit: 'ft', pack: 100, packName: 'coil', cut: true, price: 110, fam: 'bare6', spec: { method: 'bare', awg: 6 }, nec: ['250.66(A)', '250.104(A)'], tags: ['bare', 'copper', 'ground', 'grounding', 'bonding', 'jumper', 'gec', '6awg'] }),
  el('DBS-2', { nomen: 'Direct-burial splice kit, heat-shrink, #8 to #2, listed for direct burial', kind: 'material', cat: 'connectors', unit: 'ea', pack: 1, price: 45, fam: 'splice', spec: { device: 'splice', burial: true }, nec: ['300.5(E)', '110.14(B)'], tags: ['splice', 'direct', 'burial', 'underground', 'heat-shrink', 'feeder'] }),
  el('SPLIT-4', { nomen: 'Split bolts #4 with rubber and vinyl tape (not listed for direct burial)', kind: 'material', cat: 'connectors', unit: 'use', pack: 10, packName: 'bag', price: 24, fam: 'splice', spec: { device: 'splice', burial: false }, nec: ['110.14(B)'], tags: ['splice', 'split', 'bolt', 'tape'] }),
];

const BREAKERS: Item[] = [
  el('KP115', { nomen: 'Breaker, 1-pole 15 A (KP)', kind: 'material', cat: 'breakers', unit: 'ea', pack: 1, price: 9, fam: 'brk15', spec: { form: 'breaker', amps: 15, poles: 1 }, nec: ['240.4(D)', '110.3(B)'], tags: ['breaker', 'circuit', '15a', '1-pole', 'single-pole'] }),
  el('KP120', { nomen: 'Breaker, 1-pole 20 A (KP)', kind: 'material', cat: 'breakers', unit: 'ea', pack: 1, price: 9, fam: 'brk20', spec: { form: 'breaker', amps: 20, poles: 1 }, nec: ['240.4(D)', '110.3(B)'], tags: ['breaker', 'circuit', '20a', '1-pole', 'single-pole'] }),
  ...([30, 40, 50, 60, 70] as const).map((a, i) =>
    el(`KP2${a}`, {
      nomen: `Breaker, 2-pole ${a} A (KP)`,
      kind: 'material',
      cat: 'breakers',
      unit: 'ea',
      pack: 1,
      price: [22, 24, 26, 28, 32][i],
      fam: 'brk2p',
      spec: { form: 'breaker', amps: a, poles: 2 },
      nec: ['240.4', '110.3(B)', 'Table 310.16'],
      tags: ['breaker', 'circuit', `${a}a`, '2-pole', 'double-pole', '240v'],
    }),
  ),
  el('KP115AF', { nomen: 'Breaker, 1-pole 15 A AFCI (combination type)', kind: 'material', cat: 'breakers', unit: 'ea', pack: 1, price: 48, fam: 'afci15', spec: { form: 'breaker', amps: 15, poles: 1, afci: true }, nec: ['210.12(A)', '406.4(D)(4)'], tags: ['breaker', 'afci', 'arc-fault', 'arc', '15a'] }),
  el('KP120AF', { nomen: 'Breaker, 1-pole 20 A AFCI (combination type)', kind: 'material', cat: 'breakers', unit: 'ea', pack: 1, price: 48, fam: 'afci20', spec: { form: 'breaker', amps: 20, poles: 1, afci: true }, nec: ['210.12(A)', '406.4(D)(4)'], tags: ['breaker', 'afci', 'arc-fault', 'arc', '20a'] }),
  el('KP120GF', { nomen: 'Breaker, 1-pole 20 A GFCI', kind: 'material', cat: 'breakers', unit: 'ea', pack: 1, price: 52, fam: 'gfciBrk20', spec: { form: 'breaker', amps: 20, poles: 1, gfci: true }, nec: ['210.8(A)'], tags: ['breaker', 'gfci', 'ground-fault', '20a'] }),
  el('KP115DF', { nomen: 'Breaker, 1-pole 15 A dual-function AFCI/GFCI', kind: 'material', cat: 'breakers', unit: 'ea', pack: 1, price: 62, fam: 'df15', spec: { form: 'breaker', amps: 15, poles: 1, afci: true, gfci: true, df: true }, nec: ['210.8(A)', '210.12(A)'], tags: ['breaker', 'dual-function', 'df', 'afci', 'gfci', '15a'] }),
  el('KP120DF', { nomen: 'Breaker, 1-pole 20 A dual-function AFCI/GFCI', kind: 'material', cat: 'breakers', unit: 'ea', pack: 1, price: 62, fam: 'df20', spec: { form: 'breaker', amps: 20, poles: 1, afci: true, gfci: true, df: true }, nec: ['210.8(A)', '210.12(A)'], tags: ['breaker', 'dual-function', 'df', 'afci', 'gfci', '20a'] }),
];

const recep = (pn: string, nomen: string, pack: number, price: number, fam: string, spec: ElecSpec, nec: string[], tags: string[], packName?: string) =>
  el(pn, { nomen, kind: 'material', cat: 'devices', unit: 'ea', pack, ...(packName ? { packName } : {}), price, fam, spec: { device: 'receptacle', form: 'receptacle', ...spec }, nec, tags: ['receptacle', 'outlet', ...tags] });

const DEVICES: Item[] = [
  recep('KR15-TR', 'Duplex receptacle 15 A (5-15R), tamper-resistant', 10, 28, 'recep15', { amps: 15, tr: true }, ['406.12'], ['duplex', '15a', 'tr', 'tamper-resistant'], 'box'),
  recep('KR20-TR', 'Duplex receptacle 20 A (5-20R), tamper-resistant', 10, 42, 'recep20', { amps: 20, tr: true }, ['406.12'], ['duplex', '20a', 'tr', 'tamper-resistant'], 'box'),
  recep('KR15', 'Duplex receptacle 15 A, commercial grade, not tamper-resistant', 10, 22, 'recep15', { amps: 15 }, ['406.12'], ['duplex', '15a', 'commercial'], 'box'),
  recep('KR20-TRWR', 'Duplex receptacle 20 A, tamper- and weather-resistant', 10, 55, 'recepWr20', { amps: 20, tr: true, wr: true }, ['406.9(B)(1)', '406.12'], ['duplex', '20a', 'tr', 'wr', 'weather-resistant', 'outdoor'], 'box'),
  recep('KR15S', 'Single receptacle 15 A, tamper-resistant', 1, 7, 'single15', { amps: 15, tr: true, single: true }, ['210.21(B)(1)', '406.12'], ['single', '15a', 'tr']),
  recep('KR20S', 'Single receptacle 20 A, tamper-resistant', 1, 9, 'single20', { amps: 20, tr: true, single: true }, ['210.21(B)(1)', '406.12'], ['single', '20a', 'tr', 'microwave', 'dedicated']),
  recep('KA15-TR', 'Outlet branch-circuit AFCI receptacle 15 A, tamper-resistant', 1, 36, 'afci15', { amps: 15, tr: true, afci: true }, ['406.4(D)(4)', '210.12(A)'], ['afci', 'arc-fault', '15a', 'tr', 'obc']),
  recep('KA20-TR', 'Outlet branch-circuit AFCI receptacle 20 A, tamper-resistant', 1, 38, 'afci20', { amps: 20, tr: true, afci: true }, ['406.4(D)(4)', '210.12(A)'], ['afci', 'arc-fault', '20a', 'tr', 'obc']),
  recep('KG15-TR', 'GFCI receptacle 15 A, tamper-resistant', 1, 19, 'gfci15', { amps: 15, tr: true, gfci: true }, ['210.8(A)', '406.4(D)(3)'], ['gfci', 'ground-fault', '15a', 'tr']),
  recep('KG20-TR', 'GFCI receptacle 20 A, tamper-resistant', 1, 22, 'gfci20', { amps: 20, tr: true, gfci: true }, ['210.8(A)', '406.4(D)(3)'], ['gfci', 'ground-fault', '20a', 'tr']),
  recep('KG20-TRWR', 'GFCI receptacle 20 A, tamper- and weather-resistant', 1, 26, 'gfci20', { amps: 20, tr: true, wr: true, gfci: true }, ['210.8(A)', '406.9(B)(1)'], ['gfci', 'ground-fault', '20a', 'tr', 'wr', 'weather-resistant', 'outdoor']),
  recep('KDF20-TR', 'Dual-function (AFCI + GFCI) receptacle 20 A, tamper-resistant', 1, 44, 'df20', { amps: 20, tr: true, afci: true, gfci: true, df: true }, ['210.8(A)', '210.12(A)', '406.4(D)(3)', '406.4(D)(4)'], ['dual-function', 'df', 'afci', 'gfci', '20a', 'tr', 'kitchen']),
  el('KS1', { nomen: 'Switch, single-pole, 15 A', kind: 'material', cat: 'devices', unit: 'ea', pack: 10, packName: 'box', price: 15, fam: 'switch1', spec: { device: 'switch1', amps: 15 }, nec: ['404'], tags: ['switch', 'single-pole', 'toggle'] }),
  el('KS3', { nomen: 'Switch, 3-way, 15 A', kind: 'material', cat: 'devices', unit: 'ea', pack: 1, price: 4, fam: 'switch3', spec: { device: 'switch3', amps: 15 }, nec: ['404.2(A)'], tags: ['switch', '3-way', 'three-way', 'traveler'] }),
  el('KS4', { nomen: 'Switch, 4-way, 15 A', kind: 'material', cat: 'devices', unit: 'ea', pack: 1, price: 12, fam: 'switch4', spec: { device: 'switch4', amps: 15 }, nec: ['404.2(A)'], tags: ['switch', '4-way', 'four-way', 'traveler'] }),
  el('WP-INUSE', { nomen: 'Cover, weatherproof in-use (extra duty)', kind: 'material', cat: 'boxes', unit: 'ea', pack: 1, price: 18, fam: 'wpcover', spec: { device: 'cover', inUse: true, wr: true }, nec: ['406.9(B)(1)'], tags: ['cover', 'weatherproof', 'in-use', 'bubble', 'outdoor', 'wet'] }),
  el('WP-FLIP', { nomen: 'Cover, weatherproof flip-lid (not in-use)', kind: 'material', cat: 'boxes', unit: 'ea', pack: 1, price: 6, fam: 'wpcover', spec: { device: 'cover', inUse: false }, nec: ['406.9(A)'], tags: ['cover', 'weatherproof', 'flip-lid', 'outdoor'] }),
  el('PLATE-BLANK', { nomen: 'Blank cover plate (make-safe blank-off)', kind: 'material', cat: 'boxes', unit: 'ea', pack: 10, packName: 'box', price: 8, spec: { device: 'plate' }, nec: ['314.25'], tags: ['blank', 'plate', 'cover', 'make-safe'] }),
];

const BOXES: Item[] = [
  el('BOX-OW1', { nomen: 'Box, 1-gang old-work, 20.3 cu in', kind: 'material', cat: 'boxes', unit: 'ea', pack: 25, packName: 'box', price: 45, fam: 'box1g', spec: { device: 'box', volume: 20.3 }, nec: ['314.16'], tags: ['box', 'old-work', 'remodel', '1-gang', 'device'] }),
  el('BOX-NW1', { nomen: 'Box, 1-gang new-work, 18 cu in', kind: 'material', cat: 'boxes', unit: 'ea', pack: 25, packName: 'box', price: 30, fam: 'box1g', spec: { device: 'box', volume: 18 }, nec: ['314.16'], tags: ['box', 'new-work', 'nail-on', '1-gang', 'device'] }),
  el('BOX-OW2', { nomen: 'Box, 2-gang old-work, 32 cu in', kind: 'material', cat: 'boxes', unit: 'ea', pack: 10, packName: 'box', price: 32, fam: 'box2g', spec: { device: 'box', volume: 32 }, nec: ['314.16'], tags: ['box', 'old-work', '2-gang'] }),
  el('BOX-4SQ', { nomen: 'Box, 4 in square, 21 cu in, with mud ring', kind: 'material', cat: 'boxes', unit: 'ea', pack: 10, packName: 'box', price: 55, fam: 'box4sq', spec: { device: 'box', volume: 21 }, nec: ['314.16'], tags: ['box', '4-square', 'junction', 'j-box'] }),
  el('BOX-WP1', { nomen: 'Box, weatherproof, 1-gang, cast, three 1/2 in hubs', kind: 'material', cat: 'boxes', unit: 'ea', pack: 1, price: 12, fam: 'boxWp', spec: { device: 'box', volume: 18, wr: true }, nec: ['314.15'], tags: ['box', 'weatherproof', 'cast', 'outdoor', 'wet', 'fs'] }),
  el('EMT-12', { nomen: 'EMT 1/2 in, 10 ft stick', kind: 'material', cat: 'conduit', unit: 'ea', pack: 10, packName: 'bundle', price: 85, bulk: true, fam: 'emt12', spec: { raceway: 'emt', size: '1/2' }, nec: ['358', 'Chapter 9'], tags: ['emt', 'conduit', 'pipe', 'stick', '1/2', 'thinwall'] }),
  el('EMT-34', { nomen: 'EMT 3/4 in, 10 ft stick', kind: 'material', cat: 'conduit', unit: 'ea', pack: 10, packName: 'bundle', price: 130, bulk: true, fam: 'emt34', spec: { raceway: 'emt', size: '3/4' }, nec: ['358', 'Chapter 9'], tags: ['emt', 'conduit', 'pipe', 'stick', '3/4', 'thinwall'] }),
  el('EMT-C12SS', { nomen: 'EMT connectors, set-screw, 1/2 in', kind: 'material', cat: 'conduit', unit: 'ea', pack: 25, packName: 'bag', price: 18, fam: 'emtConn', spec: { device: 'connector', raceway: 'emt', size: '1/2', fitting: 'setscrew' }, nec: ['358.42'], tags: ['connector', 'emt', 'set-screw', 'setscrew', 'fitting', '1/2'] }),
  el('EMT-C12RT', { nomen: 'EMT connectors, compression raintight, 1/2 in', kind: 'material', cat: 'conduit', unit: 'ea', pack: 25, packName: 'bag', price: 38, fam: 'emtConn', spec: { device: 'connector', raceway: 'emt', size: '1/2', fitting: 'raintight' }, nec: ['358.42'], tags: ['connector', 'emt', 'compression', 'raintight', 'fitting', '1/2', 'outdoor'] }),
  el('EMT-C34SS', { nomen: 'EMT connectors, set-screw, 3/4 in', kind: 'material', cat: 'conduit', unit: 'ea', pack: 25, packName: 'bag', price: 26, fam: 'emtConn', spec: { device: 'connector', raceway: 'emt', size: '3/4', fitting: 'setscrew' }, nec: ['358.42'], tags: ['connector', 'emt', 'set-screw', 'setscrew', 'fitting', '3/4'] }),
  el('EMT-C34RT', { nomen: 'EMT connectors, compression raintight, 3/4 in', kind: 'material', cat: 'conduit', unit: 'ea', pack: 25, packName: 'bag', price: 45, fam: 'emtConn', spec: { device: 'connector', raceway: 'emt', size: '3/4', fitting: 'raintight' }, nec: ['358.42'], tags: ['connector', 'emt', 'compression', 'raintight', 'fitting', '3/4', 'outdoor'] }),
  el('PVC40-1', { nomen: 'PVC Sch 40, 1 in, 10 ft stick', kind: 'material', cat: 'conduit', unit: 'ea', pack: 10, packName: 'bundle', price: 55, bulk: true, fam: 'pvc1', spec: { raceway: 'pvc40', size: '1' }, nec: ['352', '300.5'], tags: ['pvc', 'conduit', 'pipe', 'sch40', 'schedule', 'underground', '1in'] }),
  el('PVC80-1', { nomen: 'PVC Sch 80, 1 in, 10 ft stick', kind: 'material', cat: 'conduit', unit: 'ea', pack: 10, packName: 'bundle', price: 95, bulk: true, fam: 'pvc1', spec: { raceway: 'pvc80', size: '1' }, nec: ['352.10(F)'], tags: ['pvc', 'conduit', 'pipe', 'sch80', 'schedule', 'physical-damage', '1in'] }),
  el('PVC-FIT1', { nomen: 'PVC fittings kit 1 in (factory 90° sweeps, couplings, adapters)', kind: 'material', cat: 'conduit', unit: 'ea', pack: 1, packName: 'kit', price: 40, spec: { raceway: 'pvc40', size: '1' }, nec: ['352.24'], tags: ['pvc', 'fittings', 'sweep', 'elbow', 'coupling', 'adapter'] }),
  el('PVC-CEM', { nomen: 'PVC solvent cement and primer', kind: 'consumable', cat: 'conduit', unit: 'use', pack: 10, packName: 'can', price: 18, nec: ['352.48'], tags: ['pvc', 'cement', 'glue', 'primer'] }),
  el('WN-ASST', { nomen: 'Twist-on wire connectors, assorted (100)', kind: 'consumable', cat: 'connectors', unit: 'use', pack: 15, packName: 'box', price: 22, spec: { device: 'connector' }, nec: ['110.14'], tags: ['connector', 'wire-nut', 'wirenut', 'twist-on', 'splice'] }),
  el('LEVER-50', { nomen: 'Lever wire connectors (50)', kind: 'consumable', cat: 'connectors', unit: 'use', pack: 10, packName: 'box', price: 38, spec: { device: 'connector' }, nec: ['110.14'], tags: ['connector', 'lever', 'splice'] }),
  el('NMC-38', { nomen: 'NM cable connectors 3/8 in (25)', kind: 'consumable', cat: 'connectors', unit: 'use', pack: 25, packName: 'bag', price: 12, spec: { device: 'connector' }, nec: ['314.17'], tags: ['connector', 'clamp', 'romex', 'nm'] }),
  el('GRN-50', { nomen: 'Green ground pigtails (50)', kind: 'consumable', cat: 'grounding', unit: 'use', pack: 25, packName: 'bag', price: 14, nec: ['250.8', '250.148'], tags: ['ground', 'pigtail', 'green', 'grounding'] }),
  el('NOALOX', { nomen: 'Anti-oxidant compound, 4 oz', kind: 'consumable', cat: 'connectors', unit: 'use', pack: 20, packName: 'tube', price: 9, nec: ['110.14'], tags: ['anti-oxidant', 'noalox', 'aluminum', 'termination'] }),
  el('ROD-58-8', { nomen: 'Ground rod 5/8 x 8 ft, copper-bonded', kind: 'material', cat: 'grounding', unit: 'ea', pack: 1, price: 22, fam: 'groundRod', spec: { device: 'rod' }, nec: ['250.52(A)(5)', '250.53(A)'], tags: ['ground', 'rod', 'electrode', 'grounding'] }),
  el('ROD-58-4', { nomen: 'Ground rod 5/8 x 4 ft', kind: 'material', cat: 'grounding', unit: 'ea', pack: 1, price: 14, fam: 'groundRod', spec: { device: 'rod' }, nec: ['250.52(A)(5)'], tags: ['ground', 'rod', 'electrode', 'short'] }),
  el('ACORN', { nomen: 'Acorn clamp, listed for direct burial (10)', kind: 'material', cat: 'grounding', unit: 'ea', pack: 10, packName: 'box', price: 30, fam: 'groundClamp', spec: { device: 'clamp', burial: true }, nec: ['250.70'], tags: ['clamp', 'acorn', 'ground', 'rod'] }),
  el('BOND-CLAMP', { nomen: 'Water-pipe bonding clamp, listed, 1/2 to 1 in', kind: 'material', cat: 'grounding', unit: 'ea', pack: 1, price: 9, fam: 'groundClamp', spec: { device: 'clamp' }, nec: ['250.104(A)', '250.70'], tags: ['clamp', 'bonding', 'bond', 'water', 'pipe', 'ground'] }),
  el('SPA-60GF', { nomen: 'Spa panel: 2-pole 60 A GFCI in a raintight disconnect, with a 6 ft 3/4 in LFNC whip kit', kind: 'material', cat: 'equipment', unit: 'ea', pack: 1, price: 190, fam: 'spaPanel', spec: { device: 'spa', amps: 60, poles: 2, gfci: true }, nec: ['680.44', '680.13', '680.42(A)'], tags: ['spa', 'hot', 'tub', 'panel', 'disconnect', 'gfci', '60a', 'whip'] }),
  el('SPA-50GF', { nomen: 'Spa panel: 2-pole 50 A GFCI in a raintight disconnect, with a 6 ft 3/4 in LFNC whip kit', kind: 'material', cat: 'equipment', unit: 'ea', pack: 1, price: 170, fam: 'spaPanel', spec: { device: 'spa', amps: 50, poles: 2, gfci: true }, nec: ['680.44', '680.13', '680.42(A)'], tags: ['spa', 'hot', 'tub', 'panel', 'disconnect', 'gfci', '50a', 'whip'] }),
  el('WH-EL45', { nomen: 'Water heater element, 4,500 W 240 V, screw-in, with gasket', kind: 'material', cat: 'equipment', unit: 'ea', pack: 1, price: 22, fam: 'whElement', spec: { device: 'element' }, nec: ['422.13'], tags: ['water', 'heater', 'element', '4500w'] }),
  el('KP-TSR30', { nomen: 'Transfer panel relay, 30 A contacts, 120 V coil', kind: 'material', cat: 'equipment', unit: 'ea', pack: 1, price: 38, fam: 'relay', spec: { device: 'relay', amps: 30 }, nec: ['702'], tags: ['relay', 'transfer', 'coil', 'standby', 'generator'] }),
  el('LABELS', { nomen: 'Panel directory labels', kind: 'consumable', cat: 'equipment', unit: 'use', pack: 10, packName: 'pack', price: 12, nec: ['408.4(A)'], tags: ['labels', 'directory', 'panel', 'circuit'] }),
];

/** job lots for the rare jobs: the supply house's quote for the take-off (4.4) */
const LOTS: Item[] = [
  el('LOT-STORM', { nomen: 'Storm repair lot: 50 ft UF-B 12/2, two 20 A TR/WR receptacles, two weatherproof boxes, an in-use cover, connectors', kind: 'lot', cat: 'lots', unit: 'lot', pack: 1, price: 260, nec: ['110.11', '334.12(B)(4)', '406.9(B)(1)'], tags: ['storm', 'lot', 'uf-b', 'weatherproof'] }),
  el('LOT-DIST', { nomen: 'Distribution panel upgrade lot: 400 A distribution panelboard, feeder lugs, two ground rods, the GEC and clamps', kind: 'lot', cat: 'lots', unit: 'lot', pack: 1, price: 1400, lead: 2, bulk: true, nec: ['408', '250.52(A)(5)', '250.53(A)'], tags: ['panel', 'panelboard', 'distribution', 'upgrade', 'lot', '400a'] }),
  el('LOT-XFER', { nomen: 'Transfer switch upgrade lot: 100 A manual transfer switch (listed), conductors and breakers', kind: 'lot', cat: 'lots', unit: 'lot', pack: 1, price: 900, lead: 2, bulk: true, nec: ['702.4(B)', '702.5'], tags: ['transfer', 'switch', 'ats', 'generator', 'standby', 'lot'] }),
  el('LOT-DOCK', { nomen: 'Fuel dock run lot: RMC and a seal fitting with compound for the classified section, THWN-2 by the foot, a 2-pole 30 A GFPE breaker', kind: 'lot', cat: 'lots', unit: 'lot', pack: 1, price: 420, nec: ['514.8', '514.9', '555.35'], tags: ['fuel', 'dock', 'rmc', 'seal', 'gfpe', 'classified', 'lot'] }),
];

// ---------------------------------------------------------------------------
// Tools, both trades (3.4): owned or not, never consumed, no stores bin

const tool = (pn: string, trade: 'mech' | 'elec', nomen: string, price: number, basis: string[], tags: string[]): Item =>
  item(pn, { nomen, trade, kind: 'tool', cat: trade === 'mech' ? 'hardware' : 'tools', unit: 'ea', pack: 1, price, nec: basis, tags: ['tool', ...tags] });

const TOOLS: Item[] = [
  tool('T-TW-IN', 'mech', 'Torque wrench, click type, 20-200 in-lb', 180, ['AC 43.13-1B 7-40'], ['torque', 'wrench', 'in-lb', 'click']),
  tool('T-TW-FT', 'mech', 'Torque wrench 20-150 ft-lb with crowfoot adapters', 240, ['AC 43.13-1B 7-40'], ['torque', 'wrench', 'ft-lb', 'crowfoot']),
  tool('T-DIFF', 'mech', 'Differential compression tester with master orifice', 210, ['AC 43.13-1B 8-14'], ['compression', 'tester', 'differential', 'leakdown']),
  tool('T-N2', 'mech', 'Nitrogen charging kit: regulator, hose and gauge', 480, ['AMM 29-10-01 accumulator precharge'], ['nitrogen', 'n2', 'charging', 'accumulator', 'precharge', 'gauge']),
  tool('T-CLAMP', 'elec', 'Clamp meter, true-RMS, CAT III 600 V', 180, ['NFPA 70E 110.8', 'UL 61010-1'], ['meter', 'clamp', 'amps', 'multimeter', 'true-rms']),
  tool('T-TORQUE', 'elec', 'Torque screwdriver 5-50 in-lb and lug torque wrench', 260, ['110.14(D)'], ['torque', 'screwdriver', 'lug', 'termination']),
  tool('T-MEGGER', 'elec', 'Insulation resistance tester 500/1000 V', 620, ['110.7'], ['megger', 'insulation', 'tester', 'megohm', 'resistance']),
  tool('T-BEND', 'elec', 'Hand bender, 1/2 and 3/4 in EMT', 95, ['358.24'], ['bender', 'emt', 'conduit', 'hand']),
  tool('T-FISH', 'elec', 'Fish tape, 100 ft, fiberglass', 85, ['practice: pulling in finished walls'], ['fish', 'tape', 'pull']),
  tool('T-KO', 'elec', 'Knockout punch set 1/2-2 in, hydraulic', 540, ['312.5'], ['knockout', 'punch', 'ko', 'hydraulic']),
  tool('T-PULL', 'elec', 'Cable puller, rope and pulling lubricant', 360, ['practice: feeder pulls'], ['puller', 'rope', 'pull', 'lubricant']),
  tool('T-HOTBOX', 'elec', 'PVC heat bender', 420, ['352.24'], ['bender', 'pvc', 'heat', 'hot', 'box']),
];

// ---------------------------------------------------------------------------
// Building materials: the builders' site work (3.5; package D uses them)

const bld = (pn: string, nomen: string, packName: string, price: number, lead = 1): Item =>
  item(pn, { nomen, trade: 'build', kind: 'material', cat: 'site', unit: 'lot', pack: 1, packName, price, lead, bulk: true, tags: ['building', 'site', ...nomen.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3)] });

const BUILD: Item[] = [
  bld('BLD-FTG', 'Pier footings for one building: bagged concrete, rebar, anchor bolts', 'lot', 180),
  bld('BLD-DECK', 'Deck and steps: treated framing, decking, galvanized hardware', 'lot', 180),
  bld('BLD-TIE', 'Hurricane ties and structural screws', 'box', 60),
  bld('BLD-FLASH', 'Roof flashing, drip edge and trim for a prefab shell', 'lot', 220),
  bld('BLD-TRIM', 'Finish lot: trim, caulk, paint', 'lot', 150),
  bld('BLD-SHUT', 'Storm shutters and screens for one building', 'set', 300, 2),
  bld('BLD-PILE', 'Treated marine pilings (CCA 2.5), a set of 6', 'set', 360, 2),
  bld('BLD-MDECK', 'Marine decking, stringers and galvanized hardware (dock)', 'lot', 220),
];

/** the static catalog: shop, repair lines, electrical, lots, tools, building */
export const ITEMS: readonly Item[] = [...MECH_SHOP, ...RPR, ...WIRE, ...BREAKERS, ...DEVICES, ...BOXES, ...LOTS, ...TOOLS, ...BUILD];
const STATIC = new Map<ItemId, Item>(ITEMS.map((x) => [x.id, x]));

// ---------------------------------------------------------------------------
// Plane parts, from each model's IPC (3.1)

type TagDef = {
  kind?: ItemKind;
  cat: ItemCat;
  /** per model [twin, cargo, float], or one price; by row: the ALT row, the B block, the POST SB row */
  price: number | [number, number, number];
  alt?: number | [number, number, number];
  /** the second row of a pair (S/N block B, or the POST SB P/N) */
  second?: number;
  lead?: number;
  bulk?: boolean;
  pack?: number;
  packName?: string;
  unit?: Item['unit'];
  words: string[];
};

const TAG: Record<string, TagDef> = {
  // 32-40 wheels and brakes
  wheel: { kind: 'rotable', cat: 'wheels', price: 1450, second: 1520, lead: 2, bulk: true, words: ['wheel', 'assembly', 'rim'] },
  tieBolt: { cat: 'wheels', price: 9, words: ['tie', 'bolt', 'wheel'] },
  tieNut: { cat: 'wheels', price: 6, words: ['tie', 'nut', 'wheel', 'self-locking'] },
  bearing: { cat: 'wheels', price: 58, words: ['bearing', 'cone', 'wheel'] },
  cup: { cat: 'wheels', price: 44, words: ['bearing', 'cup', 'race'] },
  seal: { cat: 'wheels', price: 14, words: ['grease', 'seal', 'wheel'] },
  disc: { cat: 'brakes', price: 260, second: 290, words: ['brake', 'disc', 'rotor'] },
  tire: { cat: 'tires', price: [285, 410, 120], alt: [250, 360, 105], words: ['tire', 'tyre', 'main', 'tube-type'] },
  tube: { cat: 'tires', price: [72, 95, 38], words: ['tube', 'inner', 'tire'] },
  brake: { cat: 'brakes', price: 620, second: 780, words: ['brake', 'assembly', 'caliper'] },
  lining: { cat: 'brakes', price: 62, second: 84, words: ['lining', 'brake', 'pad', 'pads'] },
  backPlate: { cat: 'brakes', price: 95, second: 110, words: ['back', 'plate', 'brake'] },
  backPlateBolt: { cat: 'brakes', price: 8, words: ['back', 'plate', 'bolt', 'brake'] },
  axleNut: { cat: 'wheels', price: 24, words: ['axle', 'nut'] },
  // 61-10 propeller
  propeller: { kind: 'rotable', cat: 'prop', price: 8400, lead: 2, bulk: true, words: ['propeller', 'prop', 'assembly', 'exchange'] },
  blade: { cat: 'prop', price: 2100, lead: 2, bulk: true, words: ['blade', 'propeller', 'prop'] },
  spinner: { cat: 'prop', price: 740, lead: 2, bulk: true, words: ['spinner', 'assembly', 'prop'] },
  bulkhead: { cat: 'prop', price: 190, lead: 2, words: ['spinner', 'bulkhead', 'forward', 'prop'] },
  spinnerScrew: { cat: 'prop', price: 2, words: ['spinner', 'screw'] },
  propBolt: { cat: 'prop', price: 62, words: ['propeller', 'prop', 'mounting', 'bolt'] },
  // 29-10 hydraulic power pack
  powerPack: { kind: 'rotable', cat: 'hydraulic', price: 1900, lead: 2, bulk: true, words: ['hydraulic', 'power', 'pack', 'pump', 'exchange'] },
  motor: { cat: 'hydraulic', price: 640, words: ['motor', 'electric', 'hydraulic'] },
  reservoir: { cat: 'hydraulic', price: 280, words: ['reservoir', 'hydraulic'] },
  resCap: { cat: 'hydraulic', price: 130, words: ['filler', 'cap', 'reservoir', 'vented'] },
  filter: { cat: 'hydraulic', price: 110, words: ['filter', 'element', 'hydraulic', '10', 'micron'] },
  pressureSwitch: { cat: 'hydraulic', price: 180, words: ['pressure', 'switch', 'hydraulic'] },
  mountBolt: { cat: 'hydraulic', price: 3, words: ['mount', 'bolt'] },
  // 23-10 com
  radio: { kind: 'rotable', cat: 'avionics', price: 950, bulk: true, words: ['transceiver', 'com', 'radio', 'vhf', 'exchange'] },
  tray: { cat: 'avionics', price: 240, words: ['tray', 'mounting', 'radio'] },
  connector: { cat: 'avionics', price: 85, words: ['connector', 'kit', 'pin', 'radio'] },
  lockScrew: { cat: 'avionics', price: 12, words: ['cam', 'lock', 'screw', 'radio'] },
  coax: { cat: 'avionics', price: 120, words: ['coax', 'antenna', 'cable'] },
  breaker: { cat: 'avionics', price: 38, words: ['circuit', 'breaker', 'com'] },
  // 24-30 DC generation
  generator: { kind: 'rotable', cat: 'dcpower', price: [760, 1350, 760], bulk: true, words: ['alternator', 'generator', 'starter-generator', 'exchange'] },
  pulleyNut: { cat: 'dcpower', price: 12, words: ['pulley', 'nut', 'alternator'] },
  brushes: { cat: 'dcpower', price: [95, 180, 95], words: ['brush', 'brushes', 'alternator', 'generator'] },
  belt: { cat: 'dcpower', price: 38, alt: 29, words: ['belt', 'v-belt', 'alternator', 'drive'] },
  arm: { cat: 'dcpower', price: 85, second: 95, words: ['adjusting', 'arm', 'alternator'] },
  pivotBolt: { cat: 'dcpower', price: 6, words: ['pivot', 'bolt', 'alternator'] },
  armBolt: { cat: 'dcpower', price: 4, words: ['adjusting', 'arm', 'bolt'] },
  qad: { cat: 'dcpower', price: 220, words: ['quick', 'attach', 'adapter', 'qad', 'starter-generator'] },
  vband: { cat: 'dcpower', price: 65, words: ['v-band', 'clamp', 'starter-generator'] },
  qadNut: { cat: 'dcpower', price: 2, words: ['nut', 'self-locking', 'qad'] },
  // 79-20 oil
  oilFilter: { cat: 'engine', price: 30, alt: 26, words: ['oil', 'filter', 'spin-on', 'engine'] },
  oilElement: { cat: 'engine', price: 210, words: ['oil', 'filter', 'element', 'turbine'] },
  filterPacking: { kind: 'consumable', cat: 'engine', price: 18, words: ['packing', 'set', 'filter', 'housing', 'o-ring'] },
  chipDetector: { cat: 'engine', price: 140, words: ['chip', 'detector', 'magnetic', 'plug'] },
  detectorPacking: { kind: 'consumable', cat: 'engine', price: 6, words: ['packing', 'chip', 'detector', 'o-ring'] },
};

/** untagged rows: a price by what the nomenclature says (hardware, and the few assemblies the price table names) */
function untagged(nomen: string): Pick<TagDef, 'cat' | 'price' | 'kind' | 'lead' | 'bulk'> & { words: string[] } {
  const n = nomen.toUpperCase();
  const words = nomen.toLowerCase().split(/[^a-z0-9-]+/).filter((w) => w.length > 2);
  if (n.startsWith('DOME, SPINNER')) return { cat: 'prop', price: 380, lead: 2, words };
  if (n.startsWith('BULKHEAD, AFT')) return { cat: 'prop', price: 170, lead: 2, words };
  if (/^CYLINDER, PITCH|^RING, BETA/.test(n)) return { cat: 'prop', price: 620, words };
  if (n.startsWith('WASHER')) return { cat: 'hardware', price: 1, words };
  if (/^NUT/.test(n)) return { cat: 'hardware', price: 2, words };
  if (/^SCREW/.test(n)) return { cat: 'hardware', price: 2, words };
  if (/^BOLT/.test(n)) return { cat: 'hardware', price: 5, words };
  if (/^CLAMP, HOSE/.test(n)) return { cat: 'hardware', price: 3, words };
  if (/^PACKING|^GASKET|^O-RING/.test(n)) return { kind: 'consumable', cat: 'hardware', price: 6, words };
  if (/^RING, SEAL/.test(n)) return { cat: 'wheels', price: 12, words };
  if (/^CYLINDER ASSY/.test(n)) return { cat: 'brakes', price: 240, words };
  if (/^PISTON/.test(n)) return { cat: 'brakes', price: 60, words };
  if (/^SCREW, BLEEDER/.test(n)) return { cat: 'brakes', price: 9, words };
  if (/^PLATE, PRESSURE/.test(n)) return { cat: 'brakes', price: 70, words };
  if (/^CAP, HUB/.test(n)) return { cat: 'wheels', price: 30, words };
  if (/^KIT, ANCHOR/.test(n)) return { cat: 'brakes', price: 38, words };
  if (/^PUMP/.test(n)) return { cat: 'hydraulic', price: 520, words };
  if (/^DIPSTICK/.test(n)) return { cat: 'hydraulic', price: 25, words };
  if (/^VALVE/.test(n)) return { cat: 'hydraulic', price: 340, words };
  if (/^ISOLATOR/.test(n)) return { cat: 'hydraulic', price: 28, words };
  if (/^RAIL/.test(n)) return { cat: 'avionics', price: 18, words };
  if (/^CONNECTOR, BNC/.test(n)) return { cat: 'avionics', price: 8, words };
  if (/^PULLEY/.test(n)) return { cat: 'dcpower', price: 65, words };
  if (/^FAN/.test(n)) return { cat: 'dcpower', price: 45, words };
  if (/^BRACKET/.test(n)) return { cat: 'dcpower', price: 120, words };
  if (/^DUCT/.test(n)) return { cat: 'dcpower', price: 140, words };
  if (/^UNIT, GENERATOR CONTROL/.test(n)) return { cat: 'dcpower', price: 1400, bulk: true, words };
  if (/^ANTENNA/.test(n)) return { cat: 'avionics', price: 240, words };
  return { cat: 'airframe', price: 50, words };
}

const priceBy = (p: number | [number, number, number], model: PlaneModel) => (typeof p === 'number' ? p : p[MODELS.indexOf(model)]);
/** consumables sold by the bag: O-rings, packings, gaskets, rivets (a P/N the shop list already carries keeps its shop item) */
const BAG = /^(MS28775|MS29513|MS28778|MS9068|AN900|NAS1149)/;

/** the item for one IPC row of one model (the row's P/N may be printed in several figures and models: the first one wins its slot) */
function rowItem(model: PlaneModel, ata: AnyAta, row: IpcRow, second: boolean, ica?: string): Item {
  const d = row.tag ? TAG[row.tag] : undefined;
  const u = d ?? untagged(row.nomen);
  // an ICA part is the heavy-duty version: priced from the dearer of the pair (the metallic lining, the B disc), x CHAIN.icaMult
  const base = d?.alt !== undefined && row.alt ? priceBy(d.alt, model) : d?.second !== undefined && (second || ica) ? d.second : priceBy(u.price, model);
  const icaPrice = ica ? (base * CHAIN.icaMult >= 100 ? Math.round((base * CHAIN.icaMult) / 10) * 10 : Math.ceil(base * CHAIN.icaMult)) : base;
  const kind: ItemKind = u.kind ?? (row.tag ? TAG[row.tag]?.kind : undefined) ?? (BAG.test(row.pn) ? 'consumable' : 'part');
  const bag = kind === 'consumable' && BAG.test(row.pn);
  const words = d?.words ?? u.words;
  return {
    id: row.pn,
    pn: row.pn,
    nomen: row.nomen,
    trade: 'mech',
    kind,
    cat: u.cat,
    fam: '',
    unit: 'ea',
    pack: bag ? 10 : 1,
    ...(bag ? { packName: 'bag' } : {}),
    price: bag ? icaPrice * 10 : icaPrice,
    lead: d?.lead ?? u.lead ?? 1,
    ...((d?.bulk ?? u.bulk) ? { bulk: true } : {}),
    ...(row.supsdBy ? { supsdBy: { ...row.supsdBy } } : {}),
    models: [model],
    ...(ica ? { ica } : {}),
    tags: [...new Set([...(row.tag ? [row.tag.toLowerCase()] : []), ...words])],
    ...(row.tag ? { slot: row.tag } : {}),
    ata,
  };
}

/** P/N -> the second of a pair: the B-block row (item "12A" beside "12") or the POST SB row */
function isSecond(rows: IpcRow[], row: IpcRow): boolean {
  if (!/A$/.test(row.item) || row.alt) return false;
  return rows.some((x) => x.item === row.item.replace(/A$/, '') && x.tag === row.tag);
}

/** the plant ATAs a model's airplanes can carry (chain.ts PLANT_ATAS: the cargo single has no brake hydraulics) */
const plantAtas = (m: PlaneModel): Ata[] => (m === 'cargo' ? ['32-40', '61-10', '23-10', '24-30'] : ['32-40', '61-10', '29-10', '23-10', '24-30']);

const rawMemo = new Map<PlaneModel, Item[]>();
const planeMemo = new Map<PlaneModel, Item[]>();
/**
 * A model's parts: every procurable row (indent 1 and deeper, not NP) of every
 * figure in both S/N blocks and both SB states, the ICA rows of every
 * alteration its airplanes can carry, and the PMA P/Ns. Shop items keep their
 * shop entry (MS O-rings, safety wire, cotter pins, crush gaskets, drain plugs).
 * The catalog's own objects (a P/N several models print is one item).
 */
export function planeItems(model: string): Item[] {
  const m = planeModel(model);
  const hit = planeMemo.get(m);
  if (hit) return hit;
  const list = rawPlane(m).map((x) => all().get(x.id)!);
  planeMemo.set(m, list);
  return list;
}

function rawPlane(m: PlaneModel): Item[] {
  const hit = rawMemo.get(m);
  if (hit) return hit;
  const out = new Map<ItemId, Item>();
  const add = (x: Item) => {
    if (STATIC.has(x.id)) return;
    if (!out.has(x.id)) out.set(x.id, x);
  };
  for (const ata of ['23-10', '24-30', '29-10', '32-40', '61-10', '79-20'] as AnyAta[]) {
    const rows = figureRows(m, ata);
    for (const row of rows) if (row.indent >= 1 && !row.np) add(rowItem(m, ata, row, isSecond(rows, row)));
  }
  for (const ata of plantAtas(m)) {
    const holder = plantPart(m, ata).holder;
    for (const row of plantRows(m, ata)) {
      if (row.indent < 1 || STATIC.has(row.pn)) continue;
      // standard hardware on an ICA list (an MS O-ring) is still a standard part
      const std = /^(MS|AN|NAS)/.test(row.pn);
      add(rowItem(m, ata, row, false, std ? undefined : holder));
    }
  }
  for (const p of pmaParts(m)) {
    const base = out.get(p.replaces);
    if (!base) continue;
    add({ ...base, id: p.pn, pn: p.pn, nomen: `${base.nomen} (FAA-PMA, ${p.holder})`, price: Math.round(base.price * 0.8), pma: p.eligibility, supsdBy: undefined, tags: [...base.tags, 'pma'] });
  }
  const list = [...out.values()].map((x) => (x.supsdBy ? x : (({ supsdBy: _s, ...rest }) => rest as Item)(x)));
  rawMemo.set(m, list);
  return list;
}

// ---------------------------------------------------------------------------
// The whole catalog, and families

let ALL: Map<ItemId, Item> | null = null;
/** every item the game knows, by id: static items, then each model's plane parts (a P/N in several models is one item) */
function all(): Map<ItemId, Item> {
  if (ALL) return ALL;
  const map = new Map<ItemId, Item>(STATIC);
  const models = new Map<ItemId, Set<PlaneModel>>();
  for (const m of MODELS) {
    for (const x of rawPlane(m)) {
      const cur = map.get(x.id);
      if (!cur) map.set(x.id, { ...x, models: [m] });
      else if (cur.trade === 'mech' && cur.models) cur.models = [...new Set([...cur.models, m])];
      (models.get(x.id) ?? models.set(x.id, new Set()).get(x.id)!).add(m);
    }
  }
  // families: plane parts by slot x model (every P/N that fills the slot on the model: both blocks, both SB states, the
  // ALTs, the ICA and PMA parts), or by slot alone when the P/Ns are shared by every model (the com radio);
  // consumables, lots, tools and building materials: the item itself
  for (const x of map.values()) {
    if (x.fam) continue;
    if (x.kind === 'consumable' || !x.slot) x.fam = x.id;
    else x.fam = (x.models?.length ?? 0) > 1 ? x.slot : `${x.slot}:${x.models![0]}`;
  }
  // a P/N shared by the models (TR-155-01) sits in the shared family; per-model ICA or PMA P/Ns of that slot join it
  const shared = new Set([...map.values()].filter((x) => x.slot && (x.models?.length ?? 0) > 1 && x.kind !== 'consumable').map((x) => x.slot!));
  for (const x of map.values()) if (x.slot && shared.has(x.slot) && x.kind !== 'consumable' && x.fam.includes(':')) x.fam = x.slot;
  ALL = map;
  return map;
}

/** the item ids a model's IPC, ICA lists and PMA supplements carry */
export const planeItemIds = (model: string): ItemId[] => rawPlane(planeModel(model)).map((x) => x.id);

export function allItems(): Item[] {
  return [...all().values()];
}

export function itemById(id: ItemId): Item | undefined {
  return all().get(id);
}

export const famOf = (id: ItemId): string => itemById(id)?.fam ?? id;

/** the supplier an item is bought from by default: its trade's */
export const defaultSupplier = (x: Item): SupplierId => DEFAULT_SUPPLIER[x.trade];

/** can this supplier sell this item (its trade's suppliers only) */
export const sells = (vendor: SupplierId, x: Item) => SUPPLIERS[vendor].trade === x.trade;

/** USD per unit at list (flat), or at a supplier's price */
export function priceAt(x: Item, vendor?: SupplierId): number {
  const unit = x.price / x.pack;
  const v = vendor ? SUPPLIERS[vendor] : undefined;
  if (!v) return unit;
  const k = x.kind === 'rotable' ? (v.mult.rotables ?? v.mult.parts ?? v.mult.rest) : x.kind === 'part' ? (v.mult.parts ?? v.mult.rest) : x.kind === 'consumable' ? (v.mult.consumables ?? v.mult.rest) : v.mult.rest;
  return unit * k;
}

/** a line's value at list unit price */
export function lineValue(line: { item: ItemId; qty: number }): number {
  const x = itemById(line.item);
  return x ? priceAt(x) * line.qty : 0;
}

/** the units a purchase delivers for `qty` wanted: whole packs, or any quantity for cut-to-length items */
export function buyUnits(x: Item, qty: number): number {
  if (x.cut || x.pack <= 1) return Math.max(0, Math.ceil(qty));
  return Math.ceil(qty / x.pack) * x.pack;
}

/** "4 on hand" words: a unit label for a quantity */
export function unitWords(x: Item, qty: number): string {
  const u = x.unit === 'use' ? (qty === 1 ? 'use' : 'uses') : x.unit === 'ea' ? '' : x.unit;
  return u ? `${qty} ${u}` : String(qty);
}
