// Aircraft paperwork: the records the mechanic researches (identity, logbooks,
// IPC, AMM task cards) are deterministic, internally consistent, follow real
// conventions, and can carry exactly one planted "part not in the IPC because
// of a logbook-recorded STC" case.
import { describe, expect, it } from 'vitest';
import {
  AMM_TASKS,
  IPC_ATAS,
  aircraftOf,
  ammTaskFor,
  approvalBasis,
  fmtDate,
  findPart,
  ipcFor,
  ipcLines,
  orderFor,
  reviewRequest,
  rowFor,
  searchLog,
  specOf,
  taskKeyFor,
  torqueFor,
  type Aircraft,
  type PlaneModel,
} from '../src/sim/aircraft';

const PLANES: [string, PlaneModel][] = [
  ['p1', 'twin'],
  ['p2', 'cargo'],
  ['p3', 'float'],
];
const SEEDS = [1, 2, 3, 7, 42, 99, 1234, 777777];
const each = (f: (ac: Aircraft, seed: number) => void) => {
  for (const seed of SEEDS) for (const [id, model] of PLANES) f(aircraftOf(seed, id, model), seed);
};

describe('aircraft identity', () => {
  it('is the same airplane every time, and a different one on another island', () => {
    expect(aircraftOf(7, 'p1', 'twin')).toEqual(aircraftOf(7, 'p1', 'twin'));
    expect(aircraftOf(7, 'p3', 'float', { plant: '61-10' })).toEqual(aircraftOf(7, 'p3', 'float', { plant: '61-10' }));
    const a = aircraftOf(7, 'p1', 'twin');
    const b = aircraftOf(8, 'p1', 'twin');
    expect(a.serial === b.serial && a.registration === b.registration).toBe(false);
  });

  it('has a valid N-number, a serial in the type range and a plausible year', () => {
    each((ac) => {
      expect(ac.registration).toMatch(/^N[1-9][0-9]{0,4}[A-HJ-NP-Z]{0,2}$/);
      expect(ac.registration.length).toBeLessThanOrEqual(6);
      const want = { twin: ['IC-310R', '310R'], cargo: ['IC-208C', '208C'], float: ['IC-185F', '185F'] }[ac.model];
      expect(ac.designation).toBe(want[0]);
      expect(ac.serial.startsWith(want[1])).toBe(true);
      expect(ac.year).toBeGreaterThanOrEqual(1978);
      expect(ac.year).toBeLessThanOrEqual(2016);
      expect(ac.engines.length).toBe(ac.model === 'twin' ? 2 : 1);
      expect(ac.tach).toBeCloseTo(ac.tt - ac.tachOffset, 1);
    });
    expect(aircraftOf(5, 'p1', 'twin').registration.startsWith('N12')).toBe(true);
  });
});

describe('logbooks', () => {
  it('are in date order, time only goes up, and tach = TT - offset', () => {
    each((ac) => {
      for (let i = 1; i < ac.log.length; i++) {
        expect(ac.log[i].date >= ac.log[i - 1].date).toBe(true);
        expect(ac.log[i].tt).toBeGreaterThanOrEqual(ac.log[i - 1].tt);
      }
      for (const e of ac.log) {
        expect(e.tach).toBeCloseTo(e.tt - ac.tachOffset, 1);
        expect(e.date >= ac.logStart && e.date <= ac.asOf).toBe(true);
      }
      expect(new Set(ac.log.map((e) => e.id)).size).toBe(ac.log.length);
    });
  });

  it('every entry is signed with a certificate number; annuals by an IA', () => {
    each((ac) => {
      for (const e of ac.log) {
        expect(e.signature).toMatch(/^\/s\/ .+(A&P \d{7}|CRS [A-Z]{3}R\d{3}[A-Z])/);
        expect(e.ref.length).toBeGreaterThan(5);
        if (e.kind === 'annual') {
          expect(e.signer.kind).toBe('A&P/IA');
          expect(e.signature.endsWith(' IA')).toBe(true);
        }
        if (e.kind === 'annual' || e.kind === '100hr' || e.kind === 'phase') expect(e.cert).toMatch(/^I certify that this aircraft has been inspected/);
      }
    });
  });

  it('100-hour inspections are never more than 110 hr apart; the turbine flies 200-hr phases', () => {
    each((ac) => {
      const insp = ac.log.filter((e) => e.kind === 'annual' || e.kind === '100hr' || e.kind === 'phase');
      expect(insp.length).toBeGreaterThan(5);
      for (let i = 1; i < insp.length; i++) expect(insp[i].tt - insp[i - 1].tt).toBeLessThanOrEqual(ac.model === 'cargo' ? 212 : 110);
      if (ac.model !== 'cargo') {
        const years = new Set(insp.filter((e) => e.kind === 'annual').map((e) => e.date.slice(0, 4)));
        expect(years.size).toBeGreaterThanOrEqual(3);
      } else expect(insp.every((e) => e.kind === 'phase')).toBe(true);
    });
  });

  it('carries plenty of ordinary noise to read through', () => {
    each((ac) => {
      expect(ac.log.length).toBeGreaterThanOrEqual(40);
      const kinds = new Set(ac.log.map((e) => e.kind));
      for (const k of ['tire', 'brake', 'check', 'elt', 'repair'] as const) expect(kinds.has(k)).toBe(true);
      if (ac.model !== 'cargo') expect(kinds.has('oil')).toBe(true);
      expect(ac.log.some((e) => /AD \d{4}-\d{2}-\d{2}/.test(e.text))).toBe(true);
    });
  });

  it('names the part numbers the IPC had in force on that date', () => {
    each((ac) => {
      for (const e of ac.log) {
        if (!e.ata || !(IPC_ATAS as readonly string[]).includes(e.ata)) continue;
        for (const p of e.pns ?? []) for (const pn of [p.on, p.off]) if (pn) expect(findPart(ac, pn).ipc.length, `${e.id} ${pn}`).toBeGreaterThan(0);
      }
      // the latest lining change used the lining the IPC lists for this S/N and SB status now
      const sb = ac.sbs.find((x) => x.ipcAta === '32-40');
      const last = [...ac.log].reverse().find((e) => e.kind === 'brake');
      if (last && (!sb || sb.date <= last.date)) expect(last.text).toContain(rowFor(ipcFor(ac, '32-40'), 'lining')!.pn);
    });
  });
});

describe('Illustrated Parts Catalog', () => {
  it('has all five assemblies for every type, in the ATA column layout', () => {
    each((ac) => {
      for (const ata of IPC_ATAS) {
        const fig = ipcFor(ac, ata);
        expect(fig.chapter).toBe(`${ata}-00`);
        expect(fig.rows[0].upa).toBe('RF');
        expect(new Set(fig.rows.map((r) => r.item)).size).toBe(fig.rows.length);
        for (const r of fig.rows) {
          expect(r.text.startsWith('. '.repeat(r.indent) + r.nomen)).toBe(true);
          expect(r.item).toMatch(/^-?\d+A?$/);
          if (r.vendor) expect(r.text).toContain(`(${r.vendor})`);
        }
        expect(fig.effCodes.map((c) => c.code)).toEqual(['A', 'B', 'C', 'D']);
        expect(fig.effCodes.filter((c) => c.applies).length).toBe(2);
        expect(fig.art.length).toBeGreaterThan(4);
        for (const a of fig.art) expect(a.x >= 0 && a.x <= 1 && a.y >= 0 && a.y <= 1).toBe(true);
      }
    });
  });

  it('exactly one effectivity variant of each split part applies to this aircraft', () => {
    each((ac) => {
      for (const ata of IPC_ATAS) {
        const fig = ipcFor(ac, ata);
        const tags = new Set(fig.rows.filter((r) => r.eff && r.tag).map((r) => r.tag!));
        for (const t of tags) expect(fig.rows.filter((r) => r.tag === t && r.eff && r.applies).length, `${ata} ${t}`).toBe(1);
      }
    });
  });

  it('effectivity follows S/N and the SB record', () => {
    each((ac) => {
      const fig = ipcFor(ac, '32-40');
      const post = ac.sbs.some((s) => s.id === fig.effCodes[2].text.replace('POST ', ''));
      expect(rowFor(fig, 'lining')!.eff).toBe(post ? 'C' : 'D');
      const b = fig.effCodes[1];
      expect(rowFor(fig, 'wheel')!.eff).toBe(b.applies ? 'B' : 'A');
      expect(b.text).toBe(`S/N ${ac.serial.slice(0, 4)}${String(specOf(ac.model).brk['32-40']).padStart(ac.serial.length - 4, '0')} AND ON`);
      expect(ac.snNum >= specOf(ac.model).brk['32-40']).toBe(b.applies);
    });
  });

  it('supersession, interchangeability codes, NP and ALT resolve to something you can order', () => {
    each((ac) => {
      for (const ata of IPC_ATAS) {
        const fig = ipcFor(ac, ata);
        for (const r of fig.rows) {
          if (r.supsdBy) {
            expect([1, 2, 3]).toContain(r.supsdBy.code);
            expect(fig.rows.find((x) => x.pn === r.supsdBy!.pn)?.supsds).toBe(r.pn);
            expect(r.notes).toContain(`SUPSD BY ${r.supsdBy.pn} (INTCHG CODE ${r.supsdBy.code})`);
          }
          if (r.np) {
            const o = orderFor(fig, r.pn)!;
            expect(o.pn).not.toBe(r.pn);
            expect(fig.rows.find((x) => x.pn === o.pn)!.np).toBeUndefined();
          }
          if (r.alt) expect(fig.rows.some((x) => x.pn === r.alt)).toBe(true);
        }
      }
    });
    // a pre-SB lining is code 3: ordering it means the SB set
    const ac = aircraftOf(1, 'p1', 'twin');
    const fig = ipcFor(ac, '32-40');
    const old = fig.rows.find((r) => r.tag === 'lining' && r.eff === 'D')!;
    expect(orderFor(fig, old.pn)).toMatchObject({ asSet: true, path: [old.pn, old.supsdBy!.pn] });
  });

  it('prints ATTACHING PARTS blocks, closed with the star line', () => {
    each((ac) => {
      for (const ata of IPC_ATAS) {
        const lines = ipcLines(ipcFor(ac, ata));
        const open = lines.filter((l) => l === 'ATTACHING PARTS').length;
        expect(open).toBeGreaterThan(0);
        expect(lines.filter((l) => l === '- - - * - - -').length).toBe(open);
      }
    });
  });
});

describe('maintenance manual task cards', () => {
  it('ATA task numbers, and every torque step has exactly one value for this aircraft', () => {
    each((ac) => {
      for (const key of AMM_TASKS) {
        const t = ammTaskFor(ac, key);
        expect(t.taskNo).toMatch(/^\d\d-\d\d-\d\d$/);
        expect(t.taskNo.startsWith(t.ata)).toBe(true);
        expect(t.ref).toBe(`IAW ${ac.designation.slice(0, 6)} MM ${t.taskNo}`);
        expect(t.steps.length).toBeGreaterThan(5);
        for (const s of t.steps) if (s.torque) expect(t.torques.filter((q) => q.key === s.torque && q.applies).length, `${key} ${s.torque}`).toBe(1);
        for (const q of t.torques) expect(q.lo).toBeLessThan(q.hi);
        expect(t.notes.some((n) => n.includes('STC'))).toBe(true);
      }
    });
  });

  it('torques and consumables change with SB status and S/N', () => {
    const pre = SEEDS.map((s) => aircraftOf(s, 'p1', 'twin')).find((a) => !a.sbs.some((x) => x.ipcAta === '61-10'))!;
    const post = SEEDS.map((s) => aircraftOf(s, 'p1', 'twin')).find((a) => a.sbs.some((x) => x.ipcAta === '61-10'))!;
    const a = ammTaskFor(pre, 'prop');
    const b = ammTaskFor(post, 'prop');
    expect(torqueFor(a, 'propBolt')!.lo).toBeLessThan(torqueFor(b, 'propBolt')!.lo);
    expect(a.consumables.filter((c) => c.applies).length).toBeLessThan(b.consumables.filter((c) => c.applies).length);
    const early = SEEDS.flatMap((s) => [aircraftOf(s, 'p1', 'twin'), aircraftOf(s, 'p3', 'float')]);
    const tie = new Set(early.map((ac) => torqueFor(ammTaskFor(ac, 'tires'), 'tieNut')!.eff));
    expect(tie.size).toBe(2);
  });

  it('catalog job kinds and ATA codes find their task', () => {
    expect(taskKeyFor('tires')).toBe('wheel');
    expect(taskKeyFor('prop')).toBe('prop');
    expect(taskKeyFor('wire')).toBe('prop');
    expect(taskKeyFor('avionics')).toBe('radio');
    expect(taskKeyFor('alternator')).toBe('alternator');
    expect(taskKeyFor('32-40-02')).toBe('brake');
    expect(taskKeyFor('29-10')).toBe('powerpack');
    expect(taskKeyFor('cylinder')).toBeUndefined();
    expect(ammTaskFor(aircraftOf(1, 'p2', 'cargo'), 'alternator').title).toMatch(/Starter-Generator/);
  });

  it('logged torques are the manual value for this configuration', () => {
    each((ac) => {
      const sb = ac.sbs.find((x) => x.ipcAta === '32-40');
      const last = [...ac.log].reverse().find((e) => e.kind === 'brake');
      if (!last || (sb && sb.date > last.date)) return;
      const q = torqueFor(ammTaskFor(ac, 'brake'), 'backPlateBolt')!;
      expect(last.text).toContain(`${q.lo}-${q.hi} ${q.unit}`);
    });
  });
});

describe('planted alteration: the part is not in the IPC', () => {
  it('a plain aircraft has no alteration that replaced an IPC assembly', () => {
    each((ac) => {
      expect(ac.plant).toBeUndefined();
      expect(ac.alterations.some((a) => a.displaces)).toBe(false);
      expect(ac.alterations.length).toBeGreaterThanOrEqual(2);
      for (const a of ac.alterations) {
        expect(a.form337 <= ac.asOf).toBe(true);
        if (a.kind === 'stc') expect(a.stc).toMatch(/^SA0\d{4}[A-Z]{2}$/);
      }
    });
  });

  it('planting adds exactly one, recorded in the logbook with its STC and 337, and nothing else changes', () => {
    for (const seed of SEEDS.slice(0, 5)) {
      for (const [id, model] of PLANES) {
        const base = aircraftOf(seed, id, model);
        for (const ata of IPC_ATAS) {
          const ac = aircraftOf(seed, id, model, { plant: ata });
          const p = ac.plant!;
          const why = `${seed} ${model} ${ata}`;
          expect(ac.alterations.filter((a) => a.displaces).length, why).toBe(1);
          const alt = ac.alterations.find((a) => a.displaces)!;
          expect(alt.displaces).toBe(ata);
          // the IPC lists the OEM part for this aircraft, never the one on it
          const fig = ipcFor(ac, ata);
          expect(fig.rows.some((r) => r.pn === p.neededPn), why).toBe(false);
          expect(fig.rows.find((r) => r.pn === p.ipcPn)?.applies, why).toBe(true);
          expect(alt.parts!.some((r) => r.pn === p.neededPn)).toBe(true);
          // the trail: the logbook entry names the STC and the 337 date
          const entry = ac.log.find((e) => e.id === p.entryId)!;
          expect(entry.kind).toBe('stc');
          expect(entry.text).toContain(`STC ${p.stc}`);
          expect(entry.text).toContain(fmtDate(p.form337));
          expect(entry.text).toContain(p.ica);
          expect(entry.pns!.some((x) => x.on === p.neededPn)).toBe(true);
          expect(searchLog(ac, p.stc)[0].id).toBe(p.entryId);
          // after the alteration nobody logs the OEM part for that item again
          for (const e of ac.log) if (e.date > entry.date && e.ata === ata) expect(e.text.includes(p.ipcPn), `${why} ${e.id}`).toBe(false);
          for (const lid of p.laterEntryIds) expect(ac.log.find((e) => e.id === lid)!.date > entry.date).toBe(true);
          // the rest of the airplane is the same airplane
          expect({ ...ac, log: 0, alterations: 0, ads: 0, plant: 0 }).toEqual({ ...base, log: 0, alterations: 0, ads: 0, plant: 0 });
          const planted = new Map(ac.log.map((e) => [e.id, e]));
          for (const e of base.log) {
            if (e.date < entry.date) expect(planted.get(e.id), `${why} ${e.id}`).toEqual(e);
            else if (!(e.kind === 'ad' && e.ata === ata)) expect(planted.get(e.id)?.tt, `${why} ${e.id}`).toBe(e.tt);
          }
          expect(ac.log.length).toBeGreaterThan(base.log.length - 8);
        }
      }
    }
  });

  it("the mechanic's path: IPC says no, the logbook says STC, engineering approves on that data", () => {
    for (const [id, model] of PLANES) {
      for (const ata of IPC_ATAS) {
        const base = aircraftOf(11, id, model);
        const ac = aircraftOf(11, id, model, { plant: ata });
        const p = ac.plant!;
        expect(approvalBasis(ac, ata, p.ipcPn).basis).toBe('ipc');
        expect(approvalBasis(ac, ata, p.neededPn)).toMatchObject({ basis: 'alteration', entry: { id: p.entryId } });
        expect(approvalBasis(base, ata, p.neededPn).basis).toBe('none');
        const req = { ata, pn: p.neededPn, stc: p.stc, form337: fmtDate(p.form337), entryId: p.entryId };
        expect(reviewRequest(ac, req)).toEqual({ approved: true, problems: [] });
        expect(reviewRequest(ac, { ...req, form337: '01/01/2001' }).approved).toBe(false);
        expect(reviewRequest(ac, { ...req, entryId: ac.log[0].id }).approved).toBe(false);
        expect(reviewRequest(ac, { ...req, pn: p.ipcPn }).approved).toBe(false);
        expect(reviewRequest(base, req).approved).toBe(false);
      }
    }
  });

  it('ADs against the removed assembly are marked not applicable', () => {
    const ac = aircraftOf(3, 'p3', 'float', { plant: '61-10' });
    const hub = ac.ads.find((a) => a.ata === '61-10')!;
    expect(hub.note).toMatch(/^N\/A since/);
    expect(hub.nextDue).toBeUndefined();
    const plain = aircraftOf(3, 'p3', 'float').ads.find((a) => a.ata === '61-10')!;
    expect(plain.nextDue).toBeGreaterThan(plain.last.tt);
  });
});
