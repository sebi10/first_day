// Logbook research: the part the job needs is not the one the IPC (or stores)
// says, the logbook entry explains why (STC, field-approved 337, SB either way
// round, PMA, or nothing at all), and the approval path follows from it, under
// the shop's GMM parts-control rule. A clean run is perfect; asking engineering
// for data that is already on file is partial; putting a part on without the
// approval it needs is a serious fault; a logbook entry the records don't
// support is sent back by the inspector.
import { describe, expect, it } from 'vitest';
import {
  FIELDS_FOR,
  GMM,
  ROUTES,
  entryTextOf,
  generateLogbook,
  idealAnswer,
  returnCost,
  reviewLogbook,
  rightValues,
  routeOutcome,
  scoreLogbook,
  stampOf,
  type LbAnswer,
  type LbCase,
  type LbModel,
} from '../src/puzzles/logbook';
import { aircraftOf, bookFor, fmtDate, ipcFor, searchLog } from '../src/sim/aircraft';
import { PASS, PERFECT } from '../src/puzzles/types';

const ASSETS = ['Twin N-12', 'Cargo C-7', 'Float F-3'];
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

const models: LbModel[] = [];
for (const tier of [0, 1, 2, 3, 4, 5]) for (const seed of SEEDS) models.push(generateLogbook(seed, tier, [], { assetName: ASSETS[seed % 3] }));
// a wider late-tier sample for the properties that must hold everywhere the game is hard
const late: LbModel[] = [];
for (const tier of [3, 4, 5]) for (let seed = 1; seed <= 30; seed++) for (const a of ASSETS) late.push(generateLogbook(seed, tier, [], { assetName: a }));
const all = [...models, ...late];
const byCase = (k: LbCase, list = all) => list.filter((m) => m.kase === k);
const perfectRun = (m: LbModel): LbAnswer => ({ ...idealAnswer(m), returns: 0, submitted: true });
const entryOf = (m: LbModel, id: string) => m.ac.log.find((e) => e.id === id)!;

describe('logbook research: the cases', () => {
  it('is the same job every time for a seed', () => {
    expect(generateLogbook(7, 3, [], { assetName: 'Float F-3' })).toEqual(generateLogbook(7, 3, [], { assetName: 'Float F-3' }));
  });

  it('tiers 0–2 teach with the easier cases; every case turns up by tier 4', () => {
    expect(models.filter((m) => m.tier === 0).every((m) => m.kase === 'stc')).toBe(true);
    expect(models.filter((m) => m.tier === 1).every((m) => m.kase === 'stc' || m.kase === 'sb')).toBe(true);
    expect(all.filter((m) => m.tier <= 3).some((m) => m.kase === 'none' || m.kase === 'sbpre')).toBe(false);
    const hard = new Set(all.filter((m) => m.tier >= 4).map((m) => m.kase));
    for (const k of ['stc', 'field', 'sb', 'sbpre', 'pma', 'none'] as const) expect(hard.has(k), k).toBe(true);
  });

  it('the part on the airplane is not the one the IPC (or stores) says, and the answer entry says why', () => {
    for (const m of all) {
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
      if (m.kase === 'sbpre') {
        // pre-SB airplane: the D lining is on and in force; stores pulled the code-3 C lining (SB set only)
        expect(m.ata).toBe('32-40');
        expect(m.found).toBe(m.ipcRow.pn);
        expect(m.ipcRow.eff).toBe('D');
        const c = m.rows.find((r) => r.pn === m.issued)!;
        expect(c.eff).toBe('C');
        expect(m.rows.find((r) => r.pn === m.found)!.supsdBy).toEqual({ pn: m.issued, code: 3 });
        expect(m.ac.sbs.some((x) => x.ipcAta === '32-40')).toBe(false);
        expect(e!.kind).toBe('brake');
        expect(e!.text).toContain(m.found);
        // the latest lining change: nothing after it changed the linings
        expect(m.ac.log.filter((x) => x.kind === 'brake' && x.date > e!.date)).toEqual([]);
        continue;
      }
      expect(fig.rows.some((r) => r.pn === m.found), why).toBe(false);
      if (m.kase === 'none') {
        expect(m.answer).toBe('none');
        expect(searchLog(m.ac, m.found)).toEqual([]);
        // the 337 file has no kit either, and the books show the OEM configuration was on the airplane in this period
        expect(m.ac.alterations.some((a) => a.displaces)).toBe(false);
        expect(m.ac.log.some((x) => x.ata === m.ata && x.kind !== 'tire' && (x.kind === 'sb' || x.kind === 'ad' || /Beaumont/.test(x.text) || !!x.pns?.length)), why).toBe(true);
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

  it('the answer is in the book the work goes in; a twin writes it in each unit’s book', () => {
    for (const m of all.filter((x) => x.answer !== 'none' && x.kase !== 'pma')) {
      const e = entryOf(m, m.answer);
      expect(e.book).toBe(bookFor(m.ata));
      if (m.ac.model === 'twin' && e.book !== 'airframe') {
        expect(e.pos, `${m.kase} ${m.ata}`).toBe('LH');
        expect(m.same.map((id) => entryOf(m, id).pos)).toEqual(['RH']);
        // either book's copy is the record
        expect(scoreLogbook(m, { ...perfectRun(m), entry: m.same[0] }).score).toBe(1);
      } else expect(m.same).toEqual([]);
    }
    const twinProp = all.find((m) => m.ac.model === 'twin' && m.ata === '61-10' && m.kase === 'stc');
    expect(twinProp).toBeDefined();
    expect(entryOf(twinProp!, twinProp!.answer).text).toMatch(/^Removed LH propeller P\/N .* S\/N FN\d{5}\./);
  });

  it('the records match the parts-control rule: nobody has put the job’s ICA part on since the kit, other ICA parts cite an EA', () => {
    for (const m of [...byCase('stc'), ...byCase('field')]) {
      const inst = entryOf(m, m.answer);
      const later = m.ac.log.filter((e) => e.date > inst.date);
      expect(later.filter((e) => e.pns?.some((p) => p.on === m.found)).map((e) => e.id), `${m.kase} ${m.ata}`).toEqual([]);
      const ica = new Set(m.ac.alterations.find((a) => a.displaces)!.parts!.filter((x) => !x.pn.startsWith('MS')).map((x) => x.pn));
      for (const e of later) for (const p of e.pns ?? []) if (p.on && ica.has(p.on)) expect(e.text, e.id).toMatch(/P\/N eligibility per EA \d\d-\d{3} \(Engineering\)/);
    }
  });

  it('propeller work is in the propeller logbook, and the book is not empty', () => {
    const prop = all.filter((m) => m.ata === '61-10' && m.answer !== 'none');
    expect(prop.length).toBeGreaterThan(0);
    for (const m of prop) expect(entryOf(m, m.answer).book).toBe('propeller');
    for (const m of all) for (const b of m.books.filter((x) => x.book === 'propeller')) expect(b.entries.length, `${m.ac.model} ${b.key}`).toBeGreaterThanOrEqual(10);
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
  it('every choice list carries the right answer once, from the airplane’s own records; five choices from tier 3', () => {
    for (const m of all) {
      const ideal = idealAnswer(m);
      for (const f of FIELDS_FOR[ideal.route]) {
        const ids = m.opts[f].map((o) => o.id);
        expect(new Set(ids).size, `${m.kase} ${f}`).toBe(ids.length);
        expect(ids, `${m.tier} ${m.kase} ${f}`).toContain(ideal.values[f]);
      }
      if (m.tier >= 3) for (const f of Object.keys(m.opts) as (keyof LbModel['opts'])[]) expect(m.opts[f].length, `${m.tier} ${m.kase} ${f}`).toBe(5);
      expect(m.opts.aircraft.find((o) => o.id === 'ac')!.label).toBe(`${m.ac.registration} · S/N ${m.ac.serial}`);
    }
  });

  it('the traps are always offered: what stores pulled, and the STC a field approval borrowed from', () => {
    for (const m of [...byCase('sb'), ...byCase('sbpre')]) expect(m.opts.pn.map((o) => o.id), m.kase).toContain(m.issued);
    for (const m of byCase('field')) expect(m.opts.data.map((o) => o.id)).toContain('basis');
    // the propeller S/N decoy is the one printed at the head of the propeller logbook
    for (const m of all) {
      const prop = m.opts.aircraft.find((o) => o.id === 'prop');
      if (prop) expect(m.ac.props.map((u) => u.serial)).toContain(prop.label.split('S/N ')[1]);
    }
  });

  it('the mechanic’s path is perfect in every case', () => {
    for (const m of all) {
      const a = perfectRun(m);
      const s = scoreLogbook(m, a);
      expect(s.score, `${m.tier} ${m.kase}`).toBe(1);
      expect(s.score).toBeGreaterThanOrEqual(PERFECT);
      const v = reviewLogbook(m, a.route!, a.values, a.entry).verdict;
      expect(v).toBe(m.kase === 'sb' || m.kase === 'sbpre' || m.kase === 'pma' ? 'signed' : 'approved');
    }
    // "then get engineering approval to put part on airplane": STC and field approvals go through engineering
    for (const m of [...byCase('stc'), ...byCase('field')]) expect(idealAnswer(m).route).toBe('eng');
    for (const m of byCase('none')) expect(idealAnswer(m).route).toBe('new');
    for (const m of [...byCase('sb'), ...byCase('sbpre')]) expect(idealAnswer(m).route).toBe('ipc');
    // engineering's approval is an EA adding the part to this tail's approved parts list
    const s = byCase('stc')[0];
    expect(reviewLogbook(s, 'eng', idealAnswer(s).values, s.answer).note).toMatch(/^EA \d\d-\d{3}: P\/N .* added to .* approved parts list \(GMM 4\.7\(c\)\)/);
  });

  it('installing without the approval the part needs is a serious fault, said as what it is', () => {
    for (const m of [...byCase('stc'), ...byCase('field'), ...byCase('none')]) {
      for (const route of ['ipc', 'pma'] as const) {
        const values = { ...idealAnswer(m).values, pn: m.found, ref: rightValues(m, route, 'ref')[0] };
        const s = scoreLogbook(m, { entry: m.answer, route, values, returns: 0, submitted: true });
        expect(s.serious).toBe(true);
        expect(s.score).toBeLessThanOrEqual(0.2);
        const rv = reviewLogbook(m, route, values, m.answer);
        expect(rv.verdict).toBe('serious');
        if (m.kase !== 'none') {
          // the kit's part cited to an IPC item: a records fault, not eligible under the reference
          expect(rv.fault).toBe('ineligible');
          expect(stampOf(rv, route, true)).toBe('Not eligible');
          if (route === 'ipc') expect(rv.note).toMatch(/^Not eligible under the reference cited/);
        }
      }
      if (m.kase === 'none') continue;
      // the OEM part back into the altered assembly: it no longer conforms to the 337
      const oem = reviewLogbook(m, 'ipc', { ...idealAnswer(m).values, pn: m.ipcRow.pn, ref: `ipc:${m.ipcRow.item}` }, m.answer);
      expect(oem.fault).toBe('unairworthy');
      expect(stampOf(oem, 'ipc', true)).toBe('Not airworthy');
      expect(oem.note).toMatch(/no longer conforms to the 337/);
    }
    for (const m of [...byCase('sb'), ...byCase('sbpre')]) {
      // stores pulled the part for the other SB status: not the IPC part in force for this airplane
      const values = { ...idealAnswer(m).values, pn: m.issued! };
      expect(routeOutcome(m, 'ipc', values, m.answer)).toBe('serious');
      expect(scoreLogbook(m, { entry: m.answer, route: 'ipc', values, returns: 0, submitted: true }).score).toBeLessThanOrEqual(0.2);
      if (m.kase === 'sbpre') expect(reviewLogbook(m, 'ipc', values, m.answer).note).toMatch(/INTCHG code 3/);
      // and no PMA covers it
      expect(routeOutcome(m, 'pma', idealAnswer(m).values)).toBe('serious');
    }
    // an unsigned logbook entry installed nothing: no serious fault yet
    const m = byCase('stc')[0];
    expect(scoreLogbook(m, { entry: m.answer, route: 'ipc', values: {}, returns: 0, submitted: false }).serious).toBe(false);
  });

  it('a logbook entry needs research behind it: the inspector sends back an entry the records don’t support', () => {
    for (const m of [...byCase('sb'), ...byCase('sbpre'), ...byCase('pma')]) {
      const ideal = idealAnswer(m);
      // declaring nothing explains the part, then signing it off: serious
      const none = scoreLogbook(m, { entry: 'none', route: ideal.route, values: ideal.values, returns: 0, submitted: true });
      expect(none.serious, m.kase).toBe(true);
      expect(stampOf(reviewLogbook(m, ideal.route, ideal.values, 'none'), ideal.route, true)).toBe('Records fault');
      // relying on an unrelated entry: returned by the inspector, and never fixed it stays below a pass
      const unrelated = m.ac.log.find((e) => e.id !== m.answer && !m.same.includes(e.id) && !m.partial.includes(e.id))!.id;
      const rv = reviewLogbook(m, ideal.route, ideal.values, unrelated);
      expect(rv.verdict).toBe('returned');
      expect(rv.problems.map((p) => p.field)).toEqual(['entry']);
      const open = scoreLogbook(m, { entry: unrelated, route: ideal.route, values: ideal.values, returns: 3, submitted: true });
      expect(open.score).toBeLessThan(0.5);
      expect(scoreLogbook(m, { entry: unrelated, route: ideal.route, values: ideal.values, returns: 0, submitted: true }).score).toBeLessThanOrEqual(0.45);
    }
    // a later entry that shows the part in force still supports it
    const sb = byCase('sb').find((m) => m.partial.length)!;
    expect(reviewLogbook(sb, 'ipc', idealAnswer(sb).values, sb.partial[0]).verdict).toBe('signed');
  });

  it('asking engineering when approved data is already on file costs time: partial', () => {
    for (const m of [...byCase('stc'), ...byCase('field')]) {
      const values = { ...idealAnswer(m).values };
      const s = scoreLogbook(m, { entry: m.answer, route: 'new', values, returns: 0, submitted: true });
      expect(reviewLogbook(m, 'new', values, m.answer).verdict).toBe('costly');
      expect(s.score).toBeGreaterThanOrEqual(PASS);
      expect(s.score).toBeLessThan(PERFECT);
    }
    for (const m of [...byCase('sb'), ...byCase('sbpre'), ...byCase('pma')]) {
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
    for (const f of [byCase('field', models).find((m) => m.tier <= 2)!, byCase('field').find((m) => m.tier >= 3)!]) {
      const ideal = idealAnswer(f);
      const viaStc = { ...ideal.values, data: 'basis' };
      const rv = reviewLogbook(f, 'eng', viaStc, f.answer);
      expect(rv.verdict).toBe('returned');
      expect(rv.problems.map((p) => p.field)).toEqual(['data']);
      if (f.tier <= 2) expect(rv.problems[0].msg).toMatch(/does not list|field-approved Form 337/);
      else expect(rv.problems[0].msg).toBe(`Approved data cited does not cover P/N ${f.found} on ${f.ac.registration}.`);
      const fixed = scoreLogbook(f, { entry: f.answer, route: 'eng', values: ideal.values, returns: 1, returnedRoutes: ['eng'], submitted: true });
      expect(fixed.score).toBeCloseTo(1 - returnCost(f.tier), 5);
      // never fixed: not approved, the job stays open
      expect(scoreLogbook(f, { entry: f.answer, route: 'eng', values: viaStc, returns: 3, submitted: true }).score).toBeLessThan(PASS);
    }
    expect(returnCost(2)).toBe(0.08);
    expect(returnCost(3)).toBe(0.15);
    // the wrong airframe S/N and a later entry that only cites the STC come back too
    const s = byCase('stc').find((m) => m.partial.length)!;
    const r2 = reviewLogbook(s, 'eng', { ...idealAnswer(s).values, aircraft: 'engine' }, s.partial[0]);
    expect(r2.problems.map((p) => p.field)).toEqual(['aircraft']);
    const unrelated = s.ac.log.find((e) => e.id !== s.answer && !s.partial.includes(e.id) && !s.same.includes(e.id))!.id;
    const r3 = reviewLogbook(s, 'eng', { ...idealAnswer(s).values, aircraft: 'engine' }, unrelated);
    expect(r3.problems.map((p) => p.field).sort()).toEqual(['aircraft', 'entry']);
  });

  it('from tier 3 a return says what is wrong, never what is right', () => {
    const tells = /field-approved|new data|major|nothing on file|No Form 337|approved model list|Form 337 of|covers ATA|STC SA0|record(ed|s) (the|this) (installation|approval)|SB/;
    for (const m of all.filter((x) => x.tier >= 3)) {
      const ideal = idealAnswer(m);
      const base = { ...ideal.values, pn: m.found };
      for (const d of m.opts.data)
        for (const date of m.opts.date.slice(0, 2)) {
          const rv = reviewLogbook(m, 'eng', { ...base, data: d.id, date: date.id }, m.ac.log[2].id);
          for (const p of rv.problems) expect(p.msg, `${m.kase} ${d.id}`).not.toMatch(tells);
        }
      const rv = reviewLogbook(m, 'new', { ...base }, m.ac.log[2].id);
      for (const p of rv.problems) expect(p.msg).not.toMatch(tells);
    }
    // the none case learned from a return and a path change: costly, capped
    const n = byCase('none')[0];
    const ideal = idealAnswer(n);
    const s = scoreLogbook(n, { entry: 'none', route: 'new', values: ideal.values, returns: 1, returnedRoutes: ['eng'], submitted: true });
    expect(s.score).toBeLessThanOrEqual(0.75);
    expect(s.score).toBeGreaterThanOrEqual(PASS);
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

  it('research credit: the installation record is full marks, a later entry that points to it is part', () => {
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

  it('your entry reads like the ones around it: past tense, serials off and on for a rotable, return to service', () => {
    for (const m of all) {
      const t = entryTextOf(m, idealAnswer(m).values);
      expect(t).not.toMatch(/^Replace |^Install /);
      expect(t).toMatch(/Aircraft returned to service\.$/);
      expect(t).toContain(m.task.ref);
      if (m.tag === 'generator' || m.tag === 'radio') expect(t).toMatch(/removed .*P\/N \S+ S\/N \w+; installed exchange unit P\/N \S+ S\/N \w+/);
    }
    // the unit that came off is the one the books last put on
    const rot = all.find((m) => m.tag === 'generator' && m.kase === 'sb' && m.ac.log.some((e) => e.ata === '24-30' && e.pos === m.jobPos && e.text.includes(`installed exchange unit P/N ${m.found} S/N ${m.offSn}`)));
    if (rot) expect(rot.offSn).toMatch(/^H\d{5}$/);
  });
});

describe('logbook research: tiers', () => {
  it('0–2 teach; from 3 only what a mechanic would really see', () => {
    for (const m of all) {
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

  it('the route cards teach the rule early, then only say what each path produces; the GMM states the PMA policy', () => {
    for (const r of ROUTES) expect(r.short).not.toMatch(/STC|337 covers|Nothing on file|eligibility list covers|effective/);
    expect(ROUTES.find((r) => r.id === 'ipc')!.title).toBe('Maintenance: IPC part, logbook entry (43.9)');
    expect(ROUTES.find((r) => r.id === 'pma')!.teach).toMatch(/GMM 4\.7\(b\).*needs no EA/);
    expect(GMM.map((g) => g.id)).toEqual(['(a)', '(b)', '(c)', '(d)']);
    expect(GMM[1].text).toMatch(/PMA.*No EA required/);
  });
});
