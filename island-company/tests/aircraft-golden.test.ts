// The island's airplanes are derived from the island seed on every read, never
// stored (src/sim/chain.ts islandAircraft). A live island's open part chain keeps
// the ATA, the tag and the P/N it was working on, and they are judged against this
// airplane: so the airplane must come out the same after any later edit. If one of
// these changes, it re-rolls live islands' airplanes. Treat that as a data
// migration (and change the pin on purpose), never as a test to update in passing.
import { describe, expect, it } from 'vitest';
import { islandAircraft, plantFor, rightPn } from '../src/sim/chain';
import type { Ata } from '../src/sim/aircraft';

const GOLDEN: Record<string, { reg: string; serial: string; sbs: string; plant: string; pns: string }> = {
    '7 p1': {reg: 'N12KX', serial: '310R0431', sbs: 'SB IC310-28-04, SB IC310-57-05, Brandt SB 18-3, SB IC310-52-02, Halden SB HA-21, SB IC310-29-03, SB IC310-23-02, SB IC310-55-01', plant: '', pns: '066-19500 B-19413-3 DH-1940-11 TR-155-02 HA-2419-4'},
    '7 p2': {reg: 'N949PX', serial: '208C00307', sbs: 'SB IC208-55-01, SB IC208-23-02, SB IC208-28-04, Beaumont SB 222, SB IC208-52-02, Halden SB HSG-22', plant: '61-10 field Form 337 dated 02/05/2025 (field approval) → SPC-4413-22L', pns: '066-22500 SPC-4413-22L TR-155-02 HSG-250-5'},
    '7 p3': {reg: 'N4203', serial: '185F0533', sbs: 'SB IC185-29-03, SB IC185-55-01, SB IC185-28-04, SB IC185-57-05, SB IC185-23-02, Beaumont SB 212', plant: '23-10 field Form 337 dated 04/07/2024 (field approval) → NX-430-00', pns: '066-12500 B-12413-3 DH-1240-11 NX-430-00 HA-2412-4'},
    '1234 p1': {reg: 'N12LV', serial: '310R1053', sbs: 'SB IC310-55-01, SB IC310-52-02, SB IC310-57-05, SB IC310-23-02, SB IC310-28-04', plant: '61-10 stc STC SA04445CE → SPC-4413-19L', pns: '066-19500 SPC-4413-19L DH-1940-11 TR-155-02 HA-2419-4'},
    '1234 p2': {reg: 'N131RQ', serial: '208C00206', sbs: 'Norwell SB 1837, SB IC208-28-04, SB IC208-57-05, SB IC208-55-01, Halden SB HSG-22', plant: '', pns: '066-22500 B-22413-3 TR-155-02 HSG-250-5'},
    '1234 p3': {reg: 'N1821', serial: '185F1079', sbs: 'SB IC185-55-01, Beaumont SB 212, SB IC185-29-03, SB IC185-32-07, SB IC185-23-02, SB IC185-52-02, SB IC185-28-04', plant: '', pns: '066-12600 B-12413-3 DH-1240-11 TR-155-02 HA-2412-4'},
    '98765 p1': {reg: 'N12WP', serial: '310R0351', sbs: 'Brandt SB 18-3, SB IC310-29-03, SB IC310-28-04, SB IC310-32-07, SB IC310-55-01', plant: '', pns: '066-19600 B-19413-3 DH-1940-11 TR-155-02 HA-2419-4'},
    '98765 p2': {reg: 'N221CX', serial: '208C00064', sbs: 'Beaumont SB 222, SB IC208-29-03, Norwell SB 1837, SB IC208-55-01', plant: '32-40 field Form 337 dated 02/23/2024 (field approval) → KA-66-22HD', pns: 'KA-66-22HD B-22413-3 TR-155-02 HSG-250-5'},
    '98765 p3': {reg: 'N4016', serial: '185F0041', sbs: 'Halden SB HA-14, SB IC185-55-01, Brandt SB 18-3, SB IC185-57-05, SB IC185-32-07, SB IC185-28-04, SB IC185-29-03', plant: '32-40 stc STC SA04089NE → KA-66-12HD', pns: 'KA-66-12HD B-12413-3 DH-1240-11 TR-155-02 HA-2412-4'},
    '424242 p1': {reg: 'N12CY', serial: '310R1069', sbs: 'SB IC310-55-01, SB IC310-57-05, Halden SB HA-21, Brandt SB 18-3, SB IC310-29-03', plant: '24-30 field Form 337 dated 06/12/2024 (field approval) → VM-70-28-19', pns: '066-19500 B-19413-3 DH-1940-11 TR-155-02 VM-70-28-19'},
    '424242 p2': {reg: 'N347WV', serial: '208C00454', sbs: 'SB IC208-23-02, SB IC208-55-01, SB IC208-57-05, Beaumont SB 222, SB IC208-28-04', plant: '', pns: '066-22500 B-22413-3 TR-155-02 HSG-250-5'},
    '424242 p3': {reg: 'N3938', serial: '185F0591', sbs: 'SB IC185-32-07, Halden SB HA-14, Beaumont SB 212, SB IC185-57-05, SB IC185-29-03, SB IC185-52-02, Brandt SB 18-3, SB IC185-55-01', plant: '', pns: '066-12600 B-12413-3 DH-1240-11 TR-155-02 HA-2412-4'},
};

const PLANES = [
  ['p1', 'twin'],
  ['p2', 'cargo'],
  ['p3', 'float'],
] as const;

describe('the derived airplanes are stable (golden)', () => {
  it('registration, serial, SBs, the alteration and the P/Ns for a few island seeds', () => {
    const got: typeof GOLDEN = {};
    for (const seed of [7, 1234, 98765, 424242]) {
      for (const [id, model] of PLANES) {
        const ac = islandAircraft(seed, { id, model });
        got[`${seed} ${id}`] = {
          reg: ac.registration,
          serial: ac.serial,
          sbs: ac.sbs.map((x) => x.id).join(', '),
          plant: ac.plant ? `${ac.plant.ata} ${ac.plant.via} ${ac.plant.ref} → ${ac.plant.neededPn}` : '',
          pns: ['32-40:lining', '61-10:propBolt', '29-10:filter', '23-10:radio', '24-30:generator']
            .filter((k) => !(model === 'cargo' && k.startsWith('29-10')))
            .map((k) => {
              const [ata, tag] = k.split(':');
              return rightPn(ac, ata as Ata, tag);
            })
            .join(' '),
        };
      }
    }
    expect(got).toEqual(GOLDEN);
  });

  it("the alteration comes from the seed and a fixed per-model ATA list, not from the catalog's jobs or the chain's tuning", () => {
    // a plane's plant, over many seeds: the shares the fixed list gives (about half altered; the cargo single never on 29-10)
    const count = { twin: 0, cargo: 0, float: 0 };
    for (let seed = 1; seed <= 400; seed++) {
      for (const [id, model] of PLANES) {
        const p = plantFor(seed, id, model);
        expect(plantFor(seed, id, model)).toEqual(p);
        if (p.plant) count[model]++;
        if (model === 'cargo') expect(p.plant).not.toBe('29-10');
      }
    }
    for (const n of Object.values(count)) {
      expect(n / 400).toBeGreaterThan(0.38);
      expect(n / 400).toBeLessThan(0.62);
    }
  });
});
