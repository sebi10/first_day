// Logbook research: the part the job needs is not the one the IPC lists, the
// logbook entry explains why (STC, field-approved 337, SB, PMA, or nothing at
// all), and the approval path follows from it. A clean run is perfect; asking
// engineering for data that is already on file is partial; putting a part on
// without the approval it needs is a serious fault.
import { describe, expect, it } from 'vitest';
import {
  FIELDS_FOR,
  generateLogbook,
  idealAnswer,
  reviewLogbook,
  rightValues,
  routeOutcome,
  scoreLogbook,
  type LbAnswer,
  type LbCase,
  type LbModel,
} from '../src/puzzles/logbook';
import { aircraftOf, fmtDate, ipcFor, searchLog } from '../src/sim/aircraft';
import { PASS, PERFECT } from '../src/puzzles/types';

const ASSETS = ['Twin N-12', 'Cargo C-7', 'Float F-3'];
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

const models: LbModel[] = [];
for (const tier of [0, 1, 2, 3, 4, 5]) for (const seed of SEEDS) models.push(generateLogbook(seed, tier, [], { assetName: ASSETS[seed % 3] }));
const byCase = (k: LbCase) => models.filter((m) => m.kase === k);
const perfectRun = (m: LbModel): LbAnswer => ({ ...idealAnswer(m), returns: 0, submitted: true });

describe('logbook research: the cases', () => {
  it('is the same job every time for a seed', () => {
    expect(generateLogbook(7, 3, [], { assetName: 'Float F-3' })).toEqual(generateLogbook(7, 3, [], { assetName: 'Float F-3' }));
  });

  it('tiers 0–2 teach with the easier cases; every case turns up by tier 4', () => {
    expect(models.filter((m) => m.tier === 0).every((m) => m.kase === 'stc')).toBe(true);
    expect(models.filter((m) => m.tier === 1).every((m) => m.kase === 'stc' || m.kase === 'sb')).toBe(true);
    expect(models.filter((m) => m.tier <= 3).some((m) => m.kase === 'none')).toBe(false);
    const late = new Set(models.filter((m) => m.tier >= 4).map((m) => m.kase));
    for (const k of ['stc', 'field', 'sb', 'pma', 'none'] as const) expect(late.has(k), k).toBe(true);
  });

  it('the part on the airplane is not the one the IPC lists, and the answer entry says why', () => {
    for (const m of models) {
      const fig = ipcFor(m.ac, m.ata);
      const e = m.ac.log.find((x) => x.id === m.answer);
      const why = `${m.tier} ${m.kase} ${m.ata}`;
      if (m.kase === 'sb') {
        // both rows are in the book; only the SB entry says which applies
        expect(m.rows.map((r) => r.pn)).toContain(m.found);
        expect(m.rows.map((r) => r.pn)).toContain(m.issued);
        expect(m.found).not.toBe(m.issued);
        expect(e!.kind).toBe('sb');
        expect(e!.text).toContain(m.found);
        continue;
      }
      expect(fig.rows.some((r) => r.pn === m.found), why).toBe(false);
      if (m.kase === 'none') {
        expect(m.answer).toBe('none');
        expect(searchLog(m.ac, m.found)).toEqual([]);
        expect(m.ac.alterations.some((a) => a.displaces)).toBe(false);
        continue;
      }
      expect(e, why).toBeDefined();
      expect(e!.text).toContain(m.found.split('/')[0].slice(0, 6));
      if (m.kase === 'stc') expect(e!.text).toContain(`STC ${m.ac.plant!.stc}`);
      if (m.kase === 'field') expect(e!.text).toContain(`Form 337 dated ${fmtDate(m.ac.plant!.form337)}, field approved`);
      if (m.kase === 'pma') expect(e!.text).toContain(`FAA-PMA P/N ${m.found}`);
      if (m.kase === 'stc' || m.kase === 'field') expect(e!.date).toBe(m.ac.plant!.form337);
    }
  });

  it('propeller work is in the propeller logbook', () => {
    const prop = models.filter((m) => m.ata === '61-10' && m.answer !== 'none');
    expect(prop.length).toBeGreaterThan(0);
    for (const m of prop) expect(m.ac.log.find((e) => e.id === m.answer)!.book).toBe('propeller');
  });

  it('the job and the airplane come from the order when it says', () => {
    expect(generateLogbook(3, 2, [], { job: 'avionics', assetName: 'Twin N-12' }).ata).toBe('23-10');
    expect(generateLogbook(3, 2, [], { job: 'tires', assetName: 'Twin N-12' }).ata).toBe('32-40');
    expect(generateLogbook(3, 2, [], { job: 'prop', assetName: 'Cargo C-7' }).ac.model).toBe('cargo');
    expect(generateLogbook(3, 2, [], { assetName: 'Float F-3' }).ac.designation).toBe('IC-185F');
    // an order that hands over the plane's records uses them as they are
    const given = aircraftOf(99, 'p2', 'cargo', { plant: '29-10', via: 'field' });
    const m = generateLogbook(5, 4, [], { aircraft: given });
    expect(m.ac).toBe(given);
    expect(m.kase).toBe('field');
    expect(m.ata).toBe('29-10');
  });
});

describe('logbook research: the paperwork', () => {
  it('every choice list carries the right answer once, from the airplane’s own records', () => {
    for (const m of models) {
      const ideal = idealAnswer(m);
      for (const f of FIELDS_FOR[ideal.route]) {
        const ids = m.opts[f].map((o) => o.id);
        expect(new Set(ids).size, `${m.kase} ${f}`).toBe(ids.length);
        expect(ids, `${m.tier} ${m.kase} ${f}`).toContain(ideal.values[f]);
      }
      expect(m.opts.aircraft.find((o) => o.id === 'ac')!.label).toBe(`${m.ac.registration} · S/N ${m.ac.serial}`);
    }
  });

  it('the mechanic’s path is perfect in every case', () => {
    for (const m of models) {
      const a = perfectRun(m);
      const s = scoreLogbook(m, a);
      expect(s.score, `${m.tier} ${m.kase}`).toBe(1);
      expect(s.score).toBeGreaterThanOrEqual(PERFECT);
      const v = reviewLogbook(m, a.route!, a.values, a.entry).verdict;
      expect(v).toBe(m.kase === 'sb' || m.kase === 'pma' ? 'signed' : 'approved');
    }
    // "then get engineering approval to put part on airplane": STC and field approvals go through engineering
    for (const m of [...byCase('stc'), ...byCase('field')]) expect(idealAnswer(m).route).toBe('eng');
    for (const m of byCase('none')) expect(idealAnswer(m).route).toBe('new');
    for (const m of byCase('sb')) expect(idealAnswer(m).route).toBe('ipc');
  });

  it('installing without the approval the part needs is a serious fault', () => {
    for (const m of [...byCase('stc'), ...byCase('field'), ...byCase('none')]) {
      for (const route of ['ipc', 'pma'] as const) {
        const values = { ...idealAnswer(m).values, pn: m.found, ref: rightValues(m, route, 'ref')[0] };
        const s = scoreLogbook(m, { entry: m.answer, route, values, returns: 0, submitted: true });
        expect(s.serious).toBe(true);
        expect(s.score).toBeLessThanOrEqual(0.2);
        expect(reviewLogbook(m, route, values, m.answer).verdict).toBe('serious');
      }
    }
    for (const m of byCase('sb')) {
      // stores pulled the pre-SB part: not the IPC part in force for this airplane
      const values = { ...idealAnswer(m).values, pn: m.issued! };
      expect(routeOutcome(m, 'ipc', values)).toBe('serious');
      expect(scoreLogbook(m, { entry: m.answer, route: 'ipc', values, returns: 0, submitted: true }).score).toBeLessThanOrEqual(0.2);
      // and no PMA covers it
      expect(routeOutcome(m, 'pma', idealAnswer(m).values)).toBe('serious');
    }
    // an unsigned entry installed nothing: no serious fault yet
    const m = byCase('stc')[0];
    expect(scoreLogbook(m, { entry: m.answer, route: 'ipc', values: {}, returns: 0, submitted: false }).serious).toBe(false);
  });

  it('asking engineering when approved data is already on file costs time: partial', () => {
    for (const m of [...byCase('stc'), ...byCase('field')]) {
      const values = { ...idealAnswer(m).values };
      const s = scoreLogbook(m, { entry: m.answer, route: 'new', values, returns: 0, submitted: true });
      expect(reviewLogbook(m, 'new', values, m.answer).verdict).toBe('costly');
      expect(s.score).toBeGreaterThanOrEqual(PASS);
      expect(s.score).toBeLessThan(PERFECT);
    }
    for (const m of [...byCase('sb'), ...byCase('pma')]) {
      const values = { ...idealAnswer(m).values };
      expect(reviewLogbook(m, 'eng', values, m.answer).verdict).toBe('unneeded');
      const s = scoreLogbook(m, { entry: m.answer, route: 'eng', values, returns: 0, submitted: true });
      expect(s.score).toBeGreaterThanOrEqual(PASS);
      expect(s.score).toBeLessThan(PERFECT);
    }
    // a PMA part may also be swapped back to the IPC part with a plain entry
    for (const m of byCase('pma')) {
      const values = { ...idealAnswer(m).values, pn: m.ipcRow.pn, ref: `ipc:${m.ipcRow.item}` };
      expect(scoreLogbook(m, { entry: m.answer, route: 'ipc', values, returns: 0, submitted: true }).score).toBe(1);
    }
  });

  it('engineering sends a bad request back; each return costs, and a field approval is cited by its 337', () => {
    const f = byCase('field')[0];
    const ideal = idealAnswer(f);
    const viaStc = { ...ideal.values, data: 'basis' };
    const rv = reviewLogbook(f, 'eng', viaStc, f.answer);
    expect(f.opts.data.map((o) => o.id)).toContain('basis');
    expect(rv.verdict).toBe('returned');
    expect(rv.problems.map((p) => p.field)).toEqual(['data']);
    expect(rv.problems[0].msg).toMatch(/does not list|approved model list|field-approved Form 337/);
    const fixed = scoreLogbook(f, { entry: f.answer, route: 'eng', values: ideal.values, returns: 1, submitted: true });
    expect(fixed.score).toBeCloseTo(0.92, 5);
    // never fixed: not approved, the job stays open
    expect(scoreLogbook(f, { entry: f.answer, route: 'eng', values: viaStc, returns: 3, submitted: true }).score).toBeLessThan(PASS);
    // the wrong airframe S/N and a later entry that only cites the STC come back too
    const s = byCase('stc').find((m) => m.partial.length)!;
    const r2 = reviewLogbook(s, 'eng', { ...idealAnswer(s).values, aircraft: 'engine' }, s.partial[0]);
    expect(r2.problems.map((p) => p.field)).toEqual(['aircraft']);
    const unrelated = s.ac.log.find((e) => e.id !== s.answer && !s.partial.includes(e.id))!.id;
    const r3 = reviewLogbook(s, 'eng', { ...idealAnswer(s).values, aircraft: 'engine' }, unrelated);
    expect(r3.problems.map((p) => p.field).sort()).toEqual(['aircraft', 'entry']);
  });

  it('nothing in the books: no approved data can be cited, it is a major', () => {
    for (const m of byCase('none')) {
      const values = { ...idealAnswer(m).values, data: m.opts.data[0]?.id, date: m.opts.date[0]?.id };
      const rv = reviewLogbook(m, 'eng', values, 'none');
      expect(rv.verdict).toBe('returned');
      expect(rv.problems.some((p) => p.field === 'data')).toBe(true);
      expect(rightValues(m, 'eng', 'data')).toEqual([]);
      // highlighting some entry instead of flagging it is wrong research
      const other = m.ac.log[m.ac.log.length - 1].id;
      expect(scoreLogbook(m, { ...perfectRun(m), entry: other }).entry).toBe(0);
    }
  });

  it('research credit: the installation record is full marks, a later entry that cites it is part', () => {
    const m = byCase('stc').find((x) => x.partial.length)!;
    const later = scoreLogbook(m, { ...perfectRun(m), entry: m.partial[0] });
    expect(later.entry).toBeCloseTo(0.6, 5);
    expect(later.score).toBeGreaterThanOrEqual(PASS);
    expect(later.score).toBeLessThan(PERFECT);
    expect(scoreLogbook(m, { ...perfectRun(m), entry: 'none' }).entry).toBe(0);
  });

  it('out of time: scored as it stands, never zero once the entry is found', () => {
    for (const m of models.slice(0, 20)) {
      const t = scoreLogbook(m, { entry: m.answer, route: null, values: {}, returns: 0, submitted: false });
      expect(t.score).toBeGreaterThan(0);
      expect(t.score).toBeLessThan(PASS);
      const nearly = scoreLogbook(m, { ...perfectRun(m), submitted: false });
      expect(nearly.score).toBeLessThan(1);
    }
  });
});

describe('logbook research: tiers', () => {
  it('0–2 teach; from 3 only what a mechanic would really see', () => {
    for (const m of models) {
      if (m.tier <= 2) {
        expect(m.teach.hint).toBeTruthy();
        expect(m.teach.showApplies).toBe(true);
        expect(m.opts.ata.every((o) => o.sub)).toBe(true);
      } else {
        expect(m.teach.hint).toBeUndefined();
        expect(m.teach.markEntry || m.teach.starYear || m.teach.showApplies).toBe(false);
        expect(Object.keys(m.teach.fieldHints)).toEqual([]);
        // bare ATA codes and serial numbers: knowing 32-40 from 32-10 is the job
        expect(m.opts.ata.some((o) => o.sub)).toBe(false);
        expect(m.opts.aircraft.some((o) => o.sub)).toBe(false);
        expect(m.opts.aircraft.length).toBe(5);
        expect(m.prefill).toEqual({});
      }
    }
    const t0 = models.find((m) => m.tier === 0)!;
    expect(t0.teach.markEntry && t0.teach.starYear).toBe(true);
    expect(Object.keys(t0.prefill).sort()).toEqual(['aircraft', 'ata', 'work']);
  });
});
