// The item catalog (docs/JOBFLOW.md 2.1, 3): every item the island buys,
// stocks, draws and installs, derived from the code and each model's IPC.
import { describe, expect, it } from 'vitest';
import { figureRows } from '../src/sim/aircraft';
import { allItems, buyUnits, famOf, ITEMS, itemById, lineValue, planeItems, priceAt } from '../src/sim/items';

const MODELS = ['twin', 'cargo', 'float'] as const;
const price = (id: string) => itemById(id)!.price / itemById(id)!.pack;

describe('the catalog', () => {
  it('ids are unique across the static items and every model’s plane parts; a P/N several models print is one item', () => {
    const all = allItems();
    expect(new Set(all.map((x) => x.id)).size).toBe(all.length);
    expect(new Set(ITEMS.map((x) => x.id)).size).toBe(ITEMS.length);
    for (const m of MODELS) {
      const ids = planeItems(m).map((x) => x.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const x of planeItems(m)) {
        expect(itemById(x.id)).toBe(x);
        expect(x.models).toContain(m);
      }
    }
    // the com radio is the same P/N on every model: one item, one family
    expect(itemById('TR-155-01')!.models!.sort()).toEqual(['cargo', 'float', 'twin']);
    expect(famOf('TR-155-01')).toBe(famOf('TR-155-02'));
  });

  it('every item has a price, a lead of a week or more, a pack, a family and search words', () => {
    for (const x of allItems()) {
      expect(x.price, x.id).toBeGreaterThan(0);
      expect(x.lead, x.id).toBeGreaterThanOrEqual(1);
      expect(x.pack, x.id).toBeGreaterThanOrEqual(1);
      expect(x.fam, x.id).toBeTruthy();
      expect(x.tags.length, x.id).toBeGreaterThan(0);
      expect(x.pn).toBe(x.id);
    }
  });

  it('every electrical item and every tool has an NEC or practical basis', () => {
    for (const x of allItems()) if (x.trade === 'elec' || x.kind === 'tool') expect(x.nec?.length ?? 0, x.id).toBeGreaterThan(0);
  });

  it('every row of fig 79-20 has an item', () => {
    for (const m of MODELS) for (const r of figureRows(m, '79-20')) if (r.indent >= 1) expect(itemById(r.pn), `${m} ${r.pn}`).toBeTruthy();
  });

  it('prices by tag match the spec (3.1), flat across tiers', () => {
    // tires and tubes per model, the ALT tire cheaper
    expect([price('OG-65010-8'), price('OG-85010-10'), price('OG-5005-6')]).toEqual([285, 410, 120]);
    expect([price('SW-65010-8'), price('SW-85010-10'), price('SW-5005-6')]).toEqual([250, 360, 105]);
    expect([price('OG-T65010'), price('OG-T85010'), price('OG-T5005')]).toEqual([72, 95, 38]);
    // linings: organic (EFF D) and metallic (EFF C); the PMA lining 0.8x; the ICA lining dearer
    expect([price('066-19500'), price('066-19600')]).toEqual([62, 84]);
    expect(price('RF066-19500')).toBe(50);
    expect(price('KA-66-19HD')).toBeGreaterThan(84);
    expect(itemById('105-00500')).toMatchObject({ pack: 50, price: 18 });
    expect([price('164-01900'), price('164-01950')]).toEqual([260, 290]);
    expect(itemById('40-190A')).toMatchObject({ price: 1450, lead: 2, bulk: true, kind: 'rotable' });
    expect(price('40-190B')).toBe(1520);
    expect([price('103-01900'), price('095-01920')]).toEqual([9, 6]);
    expect([price('214-01910'), price('213-01910'), price('154-01900')]).toEqual([58, 44, 14]);
    expect(itemById('MS24665-302')).toMatchObject({ pack: 100, price: 14 });
    expect(itemById('MS28775-227')).toMatchObject({ pack: 10, price: 22 });
    // propeller
    expect([price('B-19413-1'), price('B-19413-3'), price('MS29513-238')]).toEqual([62, 62, 9]);
    expect([price('0531231-1'), price('0531230-2'), price('0531230-4')]).toEqual([380, 190, 170]);
    // hydraulic power pack
    expect([price('DH-1940-10'), price('PF1940-11'), price('DH-1931'), price('DH-1902-3')]).toEqual([110, 88, 130, 1900]);
    // com: exchange 950, the ICA unit 1,280
    expect([price('TR-155-01'), price('NX-430-00'), price('TR-155-MT'), price('TR-155-CK'), price('TR-155-LS')]).toEqual([950, 1280, 240, 85, 12]);
    // DC generation: alternator 760 (ICA 1,030), starter-generator 1,350 (ICA 1,820)
    expect([price('HA-2419-2'), price('VM-70-28-19'), price('HSG-250-3'), price('VM-SG300-22')]).toEqual([760, 1030, 1350, 1820]);
    expect([price('HA-B38'), price('B38-AX'), price('HA-2419-N'), price('HA-2419-B'), price('HSG-250-BS')]).toEqual([38, 29, 12, 95, 180]);
    // 79-20
    expect([price('BAE-48119'), price('SF48119-1'), price('AN814-8DL'), price('NT3031-14'), price('NT3031-PK'), price('NT3021-8'), price('MS9068-012')]).toEqual([30, 26, 18, 210, 18, 140, 6]);
    expect(itemById('AN900-10')).toMatchObject({ pack: 25, price: 15 });
  });

  it('the electrical catalog: wire by the foot, the protection devices, lots and tools', () => {
    expect(itemById('THWN-6')).toMatchObject({ cut: true, unit: 'ft', pack: 500 });
    expect(priceAt(itemById('THWN-6')!)).toBeCloseTo(1.0);
    expect(priceAt(itemById('THWN-3')!)).toBeCloseTo(2.2);
    expect(itemById('KDF20-TR')!.spec).toMatchObject({ afci: true, gfci: true, df: true, tr: true, amps: 20 });
    expect(itemById('KR15')!.spec?.tr).toBeFalsy();
    expect(itemById('SPLIT-4')!.spec?.burial).toBe(false);
    expect(itemById('DBS-2')!.spec?.burial).toBe(true);
    expect(itemById('LOT-DIST')).toMatchObject({ price: 1400, lead: 2 });
    expect(itemById('T-MEGGER')).toMatchObject({ kind: 'tool', price: 620 });
    expect(itemById('BLD-SHUT')).toMatchObject({ trade: 'build', lead: 2, price: 300 });
  });

  it('units: whole packs, or any length of wire', () => {
    expect(buyUnits(itemById('THWN-6')!, 183)).toBe(183);
    expect(buyUnits(itemById('NMB-12-3')!, 25)).toBe(250);
    expect(buyUnits(itemById('MS28775-227')!, 3)).toBe(10);
    expect(lineValue({ item: 'MS28775-227', qty: 3 })).toBeCloseTo(6.6);
  });

  it('families: every P/N that fills a slot on a model (both blocks, both SB states, ALT, ICA, PMA)', () => {
    expect(new Set(['066-19500', '066-19600', 'KA-66-19HD', 'RF066-19500'].map(famOf)).size).toBe(1);
    expect(famOf('066-19500')).toBe('lining:twin');
    expect(famOf('066-22500')).toBe('lining:cargo');
    expect(famOf('OG-65010-8')).toBe(famOf('SW-65010-8'));
    expect(famOf('BAE-48119')).not.toBe(famOf('BAE-48112'));
    // consumables and lots: the item itself
    expect(famOf('MS20995C32')).toBe('MS20995C32');
    expect(famOf('KG20-TR')).toBe('gfci20');
  });
});
