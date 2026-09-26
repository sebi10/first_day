// Parts lookup (IPC): the mechanic's workflow on real conventions. The answer
// is what the book gives for THIS airplane (S/N + SB status), after NP and
// SUPSD BY, plus what the AMM task calls for with it; a wrong part is a latent
// defect, an old part that still fits is legal but not current; tiers 0-2
// teach and 3+ do not; from tier 4 (and only then) an STC may have replaced
// the assembly, and then the part is only in the ICA and needs an engineering
// approval citing the logbook.
import { describe, expect, it, vi } from 'vitest';
import { IPC_CASES, generateIpc, icaParts, lineFault, perfectAttempt, reachedFrom, scoreIpc, solveItem, wouldReveal, baseItem, type IpcAttempt, type IpcModel } from '../src/puzzles/ipc';
import { aircraftOf, fmtDate, ipcFor, IPC_ATAS, type PlaneModel } from '../src/sim/aircraft';
import { PASS, PERFECT } from '../src/puzzles/types';

// each case builds whole airplanes (logbooks included): give a loaded CI box room
vi.setConfig({ testTimeout: 30000 });

const ASSETS = ['Twin N-12', 'Cargo C-7', 'Float F-3'];
const all = (tiers: number[], seeds = 24) => {
  const out: IpcModel[] = [];
  for (const tier of tiers) for (const assetName of ASSETS) for (let seed = 1; seed <= seeds; seed++) out.push(generateIpc(seed, tier, [], { assetName }));
  return out;
};
const models = all([0, 1, 2, 3, 4, 5], 10);
const plain = models.filter((m) => !m.planted);
const withLine = (m: IpcModel, pn: string, qty = m.expect[0].qty, src: 'ipc' | 'ica' = 'ipc'): IpcAttempt => ({ lines: [{ pn, qty, src }], marks: { ...m.marks } });
/** the clean order with its first line swapped for another P/N / qty */
const swapMain = (m: IpcModel, pn: string, qty = m.expect[0].qty): IpcAttempt => {
  const a = perfectAttempt(m);
  a.lines[0] = { ...a.lines[0], pn, qty };
  return a;
};
/** the clean order without its AMM lines */
const noAmm = (m: IpcModel): IpcAttempt => ({ ...perfectAttempt(m), lines: perfectAttempt(m).lines.filter((_, i) => m.expect[i].role !== 'amm') });

describe('ipc model', () => {
  it('is deterministic from the seed', () => {
    expect(generateIpc(42, 3, [], { assetName: 'Twin N-12' })).toEqual(generateIpc(42, 3, [], { assetName: 'Twin N-12' }));
    expect(generateIpc(9, 5)).toEqual(generateIpc(9, 5));
  });

  it('every job is drawn on its figure, for every type it applies to', () => {
    for (const c of IPC_CASES) {
      for (const model of (c.models ?? ['twin', 'cargo', 'float']) as PlaneModel[]) {
        const fig = ipcFor(aircraftOf(1, 'p', model), c.ata);
        expect(fig.art.some((a) => a.item === c.item), `${c.key} ${model}`).toBe(true);
        expect(fig.rows.some((r) => baseItem(r.item) === c.item), `${c.key} ${model}`).toBe(true);
      }
    }
  });

  it('the answer is orderable: never NP, never superseded, and effective unless reached through SUPSD BY', () => {
    for (const m of plain) {
      for (const e of m.expect) {
        const row = m.fig.rows.find((r) => r.pn === e.pn)!;
        expect(row, `${m.caseKey} ${e.pn}`).toBeDefined();
        expect(row.np).toBeUndefined();
        expect(row.supsdBy).toBeUndefined();
        expect(row.upa).not.toBe('RF');
        if (!row.applies) expect(m.features.sup, `${m.caseKey}: ${e.pn} is not effective and no supersession led there`).toBeGreaterThan(1);
        expect(e.qty).toBeGreaterThan(0);
      }
      // the squawked part itself is the first link of the chain
      expect(baseItem(m.fig.rows.find((r) => r.pn === m.path[0])!.item)).toBe(m.item);
    }
  });

  it('a clean order is perfect, on every tier and type (planted ones included)', () => {
    for (const m of models) {
      const s = scoreIpc(m, perfectAttempt(m));
      expect(s.fault, `${m.caseKey} t${m.tier}`).toBeNull();
      expect(s.score, `${m.caseKey} t${m.tier} ${s.summary}`).toBe(1);
    }
  });

  it('brake linings: both main wheels (UPA x 2), new rivets, and a pre-SB airplane orders the code-3 set', () => {
    const linings = all([3, 5], 30).filter((m) => m.caseKey === 'lining' && !m.planted);
    expect(linings.length).toBeGreaterThan(3);
    for (const m of linings) {
      expect(m.mult).toBe(2);
      expect(m.multWhy).toMatch(/both main wheels/);
      expect(m.expect[0].qty).toBe(4);
      // UPA 4 rivets per lining, 2 linings per brake, both brakes
      const riv = m.expect.find((e) => e.role === 'amm')!;
      expect(riv.pn).toBe('105-00500');
      expect(riv.qty).toBe(16);
      expect(riv.qtyWhy).toMatch(/UPA 4 per lining × 2 linings × 2/);
      if (m.marks.cd === 'D') {
        expect(m.features.set).toBe(true);
        expect(m.expect.map((e) => e.item)).toEqual(['21A', '23A', '22']);
        // new linings on the old back plates: a latent defect
        const half = scoreIpc(m, { ...perfectAttempt(m), lines: perfectAttempt(m).lines.filter((l) => l.pn !== m.expect[1].pn) });
        expect(half.fault).toMatch(/code 3/i);
        expect(half.score).toBeLessThan(PASS);
        // doing the SB is logged and changes the procedure
        expect(m.sb?.note).toMatch(/incorporates SB .*POST-SB/);
        expect(m.why.join(' ')).toContain(m.sb!.note);
      } else expect(m.expect.map((e) => e.role)).toEqual(['main', 'amm']);
    }
    expect(linings.some((m) => m.marks.cd === 'D')).toBe(true);
  });

  it('the AMM parts: required from tier 3, credited but optional below; bearing cups always go with the cones', () => {
    const byTier = (tiers: number[]) => all(tiers, 30).filter((m) => !m.planted);
    const hi = byTier([3, 4, 5]);
    const want: Record<string, string> = { propBolt: 'O-RING, HUB TO FLANGE', hub: 'O-RING, HUB TO FLANGE', filter: 'O-RING, FILTER BOWL', lining: 'RIVET, LINING' };
    for (const [key, nomen] of Object.entries(want)) {
      const ms = hi.filter((m) => m.caseKey === key);
      expect(ms.length, key).toBeGreaterThan(0);
      for (const m of ms) {
        const amm = m.expect.find((e) => e.role === 'amm')!;
        expect(amm.nomen, key).toBe(nomen);
        expect(m.ammHot.some((x) => x.length > 0)).toBe(true);
        // "you forgot the O-ring": a pass, never perfect, never a wrong part
        const s = scoreIpc(m, noAmm(m));
        expect(s.fault).toBeNull();
        expect(s.score, key).toBeGreaterThanOrEqual(PASS);
        expect(s.score).toBeLessThan(PERFECT);
        expect(s.notes.some((n) => !n.ok && n.text.includes(amm.pn))).toBe(true);
      }
    }
    // teaching tiers: optional, and ordering it costs nothing
    const lo = byTier([0, 1, 2]).filter((m) => m.optional.length);
    expect(lo.length).toBeGreaterThan(5);
    for (const m of lo) {
      expect(scoreIpc(m, perfectAttempt(m)).score).toBe(1);
      const withOpt = perfectAttempt(m);
      withOpt.lines.push(...m.optional.map((e) => ({ pn: e.pn, qty: e.qty, src: 'ipc' as const })));
      const s = scoreIpc(m, withOpt);
      expect(s.score).toBe(1);
      expect(s.notes.some((n) => n.ok && !n.soft && n.text.includes(m.optional[0].pn))).toBe(true);
    }
    // wheel jobs: a new cotter pin is bench stock, credited at every tier
    expect(hi.filter((m) => m.caseKey === 'tire').every((m) => m.optional.some((e) => e.pn === 'MS24665-302'))).toBe(true);
    // the matched set holds at every tier: cones without their cups is a pass, not perfect
    const bearings = [1, 2].flatMap((tier) => ASSETS.flatMap((assetName) => Array.from({ length: 30 }, (_, i) => generateIpc(i + 1, tier, [], { assetName, job: 'tires' })))).filter((x) => x.caseKey === 'bearing');
    expect(bearings.length).toBeGreaterThan(2);
    for (const m of bearings) {
      expect(m.expect.map((e) => e.nomen)).toEqual(['CONE, BEARING', 'CUP, BEARING']);
      expect(m.expect.map((e) => e.qty)).toEqual([2, 2]);
      const s = scoreIpc(m, noAmm(m));
      expect(s.score).toBeGreaterThanOrEqual(PASS);
      expect(s.score).toBeLessThan(PERFECT);
    }
  });
});

describe('ipc scoring: wrong parts are latent defects', () => {
  it('ordering an NP part fails; its next higher assembly passes', () => {
    const nps = plain.filter((m) => m.features.np);
    expect(nps.length).toBeGreaterThan(5);
    for (const m of nps) {
      const s = scoreIpc(m, withLine(m, m.path[0]));
      expect(s.fault, m.caseKey).toMatch(/NP/);
      expect(s.score).toBeLessThan(PASS);
    }
  });

  it('a variant for the other effectivity fails', () => {
    let n = 0;
    for (const m of plain) {
      const wrong = m.fig.rows.find((r) => baseItem(r.item) === baseItem(m.expect[0].item) && r.eff && !r.applies && !m.expect.some((e) => e.accept.includes(r.pn)) && !r.np);
      if (!wrong) continue;
      n++;
      const s = scoreIpc(m, withLine(m, wrong.pn));
      expect(s.fault, `${m.caseKey} ${wrong.pn}`).not.toBeNull();
      expect(s.score).toBeLessThan(PASS);
    }
    expect(n).toBeGreaterThan(10);
  });

  it('an old part that still fits this airplane is legal but not current, whatever its code; old for new is a wrong part', () => {
    const codes = new Set<number>();
    for (const m of all([2, 3, 4, 5], 30).filter((x) => !x.planted)) {
      const old = m.expect[0].old;
      if (!old) continue;
      codes.add(old.code);
      expect(m.fig.rows.find((r) => r.pn === old.pn)!.applies).toBe(true);
      // same airplane, same config: it goes back on without the SB set
      const a = swapMain(m, old.pn, old.qty);
      a.lines = a.lines.filter((_, i) => m.expect[i].role !== 'set');
      const s = scoreIpc(m, a);
      expect(s.fault, `${m.caseKey} ${old.pn}`).toBeNull();
      expect(s.score, `${m.caseKey} code ${old.code}`).toBeGreaterThanOrEqual(PASS);
      expect(s.score).toBeLessThan(PERFECT);
      expect(s.notes.some((n) => !n.ok && n.text.includes(`superseded by ${m.expect[0].pn} (code ${old.code}`))).toBe(true);
      // the old part next to the new SB set part it cannot mix with
      const set = m.expect.find((e) => e.role === 'set');
      if (set) expect(scoreIpc(m, { ...a, lines: [...a.lines, { pn: set.pn, qty: set.qty, src: 'ipc' }] }).fault).toMatch(/code 3/);
    }
    expect([...codes].sort()).toEqual([1, 2, 3]);
    // old for new: a PRE-SB part on a POST-SB airplane (codes 2 and 3 say no)
    let n = 0;
    for (const m of plain.filter((x) => x.marks.cd === 'C')) {
      const pre = m.fig.rows.find((r) => baseItem(r.item) === m.item && r.supsdBy && r.supsdBy.code > 1 && !r.applies);
      if (!pre) continue;
      n++;
      const s = scoreIpc(m, swapMain(m, pre.pn));
      expect(s.fault, `${m.caseKey} ${pre.pn}`).toMatch(/old part may not replace the new/);
      expect(s.score).toBeLessThan(PASS);
    }
    expect(n).toBeGreaterThan(2);
  });

  it('a code-2 SB part is legal on a PRE-SB airplane: new for old, and not dimmed as "not this airplane"', () => {
    const m = all([3, 4, 5], 40).find((x) => !x.planted && x.caseKey === 'propBolt' && x.marks.cd === 'D')!;
    expect(m).toBeDefined();
    const bolt = m.expect[0];
    expect(bolt.old?.code).toBe(2);
    expect(scoreIpc(m, perfectAttempt(m)).notes.some((n) => n.soft && n.text.includes(m.sb!.id))).toBe(true);
    expect(m.sb!.note).toMatch(/MIL-PRF-907/);
    const via = reachedFrom(m.fig, (r) => r.applies);
    const i = m.fig.rows.findIndex((r) => r.pn === bolt.pn);
    expect(via.get(i)).toEqual({ from: '12', code: 2, set: false });
    expect(lineFault(m, { pn: bolt.pn, qty: 6, src: 'ipc' })).toBeNull();
  });

  it('an IPC alternate is as good as the part; the wrong quantity or a skipped effectivity check that matters still passes, not perfect', () => {
    const alts = plain.filter((m) => m.features.alt);
    expect(alts.length).toBeGreaterThan(0);
    for (const m of alts) expect(scoreIpc(m, swapMain(m, m.expect[0].accept[1])).score).toBe(1);
    for (const m of plain) {
      const q = scoreIpc(m, swapMain(m, m.expect[0].pn, m.expect[0].qty + 1));
      expect(q.score).toBeGreaterThanOrEqual(PASS);
      expect(q.score).toBeLessThan(PERFECT);
      const e = scoreIpc(m, { ...perfectAttempt(m), marks: {} });
      if (m.features.effAB || m.features.effCD) {
        expect(e.score).toBeGreaterThanOrEqual(PASS);
        expect(e.score).toBeLessThan(PERFECT);
      } else expect(e.score, `${m.caseKey}: no code limits this part`).toBe(1);
    }
  });

  it('effectivity scores only the codes the answer depends on; a wrong mark elsewhere is a small slip', () => {
    const abOnly = plain.filter((m) => m.features.effAB && !m.features.effCD);
    expect(abOnly.length).toBeGreaterThan(3);
    for (const m of abOnly) {
      expect(scoreIpc(m, { ...perfectAttempt(m), marks: { ab: m.marks.ab } }).score).toBe(1);
      const wrongCd = scoreIpc(m, { ...perfectAttempt(m), marks: { ab: m.marks.ab, cd: m.marks.cd === 'C' ? 'D' : 'C' } });
      expect(wrongCd.score).toBeGreaterThan(0.9);
      expect(wrongCd.score).toBeLessThan(1);
      const wrongAb = scoreIpc(m, { ...perfectAttempt(m), marks: { ab: m.marks.ab === 'A' ? 'B' : 'A', cd: m.marks.cd } });
      expect(wrongAb.score).toBeLessThanOrEqual(0.7 + 1e-9);
    }
  });

  it('the wrong item entirely is not a pass, and an empty request is never zero-by-crash', () => {
    const m = plain.find((x) => x.expect.length === 1 && x.ata === '32-40' && !x.features.effAB && !x.features.effCD)!;
    const other = m.fig.rows.find((r) => r.applies && !r.np && !r.supsdBy && r.upa !== 'RF' && baseItem(r.item) !== m.item && !m.expect.some((e) => e.accept.includes(r.pn)) && !m.optional.some((e) => e.accept.includes(r.pn)))!;
    expect(lineFault(m, { pn: other.pn, qty: 1, src: 'ipc' })).toBeNull();
    expect(scoreIpc(m, withLine(m, other.pn)).score).toBeLessThan(PASS);
    const none = scoreIpc(m, { lines: [], marks: {} });
    expect(none.score).toBeGreaterThan(0);
    expect(none.score).toBeLessThan(0.1);
  });
});

describe('ipc tiers', () => {
  it('tiers 0-2 teach, from tier 3 only what a mechanic really sees', () => {
    for (const m of models) {
      expect(m.teach).toBe(m.tier <= 2);
      expect(m.circled).toBe(m.tier <= 2);
      expect(m.premarked).toBe(m.tier <= 1);
      expect(m.compliance).toBe(m.tier <= 4);
      // a squawk never gives away the callout or a part number
      for (const r of m.fig.rows) expect(m.squawk.includes(r.pn), `${m.squawk} ${r.pn}`).toBe(false);
      expect(m.squawk).not.toMatch(/\bitem\b|\bP\/N\b|\bfig/i);
    }
  });

  it('difficulty ramps: plain parts at tier 0, NP / supersession / sets from tier 2', () => {
    const avg = (t: number) => {
      const xs = plain.filter((m) => m.tier === t);
      return xs.reduce((n, m) => n + m.difficulty, 0) / xs.length;
    };
    expect(plain.filter((m) => m.tier === 0).every((m) => m.difficulty === 0)).toBe(true);
    expect(plain.filter((m) => m.tier === 1).every((m) => m.difficulty === 1)).toBe(true);
    expect(avg(2)).toBeGreaterThan(avg(1));
    expect(avg(3)).toBeGreaterThan(avg(1) + 1);
    const seen = new Set(plain.filter((m) => m.tier >= 3).map((m) => m.caseKey));
    expect(seen.size).toBeGreaterThan(8);
  });

  it('only tier 4+ plants an STC-replaced assembly', () => {
    expect(models.filter((m) => m.planted).every((m) => m.tier >= 4)).toBe(true);
    const t5 = all([5], 40);
    expect(t5.filter((m) => m.planted).length).toBeGreaterThan(t5.length * 0.2);
    expect(t5.filter((m) => !m.planted).length).toBeGreaterThan(t5.length * 0.2);
  });

  it('the work order picks the assembly; the island airplane is used as it is', () => {
    const jobs: Record<string, string> = { tires: '32-40', corrosion: '32-40', prop: '61-10', wire: '61-10', hydraulic: '29-10', avionics: '23-10', alternator: '24-30' };
    for (const [job, ata] of Object.entries(jobs)) for (const seed of [1, 2, 3]) expect(generateIpc(seed, 3, [], { assetName: 'Cargo C-7', job }).ata).toBe(ata);
    const ac = aircraftOf(77, 'p3', 'float');
    const m = generateIpc(5, 5, [], { aircraft: ac, job: 'prop' });
    expect(m.ac).toBe(ac);
    expect(m.planted).toBe(false);
  });

  it("the island's STC airplane: below tier 4 never the STC case, and a job on a part the STC left alone stays that job", () => {
    const jobOf: Record<string, string> = { '32-40': 'tires', '61-10': 'prop', '29-10': 'hydraulic', '23-10': 'avionics', '24-30': 'alternator' };
    let stayed = 0;
    let moved = 0;
    for (const model of ['twin', 'cargo', 'float'] as PlaneModel[])
      for (const ata of IPC_ATAS) {
        const bad = aircraftOf(77, 'p1', model, { plant: ata });
        for (const tier of [0, 1, 2, 3])
          for (const seed of [1, 2, 3, 4])
            for (const ctx of [{}, { job: jobOf[ata] }]) {
              const pm = generateIpc(seed, tier, [], { aircraft: bad, ...ctx });
              expect(pm.ac).toBe(bad);
              expect(pm.planted, `${model} ${ata} t${tier}`).toBe(false);
              // nothing the STC took off the airplane is ever the answer
              for (const e of [...pm.expect, ...pm.optional]) expect(pm.displaced.includes(baseItem(e.item)), `${model} ${ata} ${e.pn}`).toBe(false);
              expect(scoreIpc(pm, perfectAttempt(pm)).score).toBe(1);
              if ('job' in ctx) {
                if (pm.ata === ata) stayed++;
                else moved++;
              }
            }
      }
    expect(stayed).toBeGreaterThan(10);
    expect(moved).toBeGreaterThan(10);
    // a tires job on a brake-STC twin stays a wheel job, and the IPC brake parts are wrong parts there
    const brakes = aircraftOf(31, 'p1', 'twin', { plant: '32-40' });
    for (const tier of [0, 1, 2, 3]) {
      const pm = generateIpc(3, tier, [], { aircraft: brakes, job: 'tires' });
      expect(pm.ata).toBe('32-40');
      expect(pm.task.key).toBe('wheel');
      const lining = pm.fig.rows.find((r) => r.tag === 'lining' && r.applies)!;
      expect(lineFault(pm, { pn: lining.pn, qty: 4, src: 'ipc' })).toMatch(/STC .* replaced/);
    }
    // from tier 4 the island's STC is the case some of the time, and only on its own assembly
    const t45 = [4, 5].flatMap((tier) => Array.from({ length: 16 }, (_, i) => generateIpc(i + 1, tier, [], { aircraft: brakes })));
    expect(t45.some((x) => x.planted)).toBe(true);
    expect(t45.some((x) => !x.planted)).toBe(true);
    for (const x of t45.filter((y) => y.planted)) {
      expect(x.ata).toBe('32-40');
      expect(scoreIpc(x, perfectAttempt(x)).score).toBe(1);
    }
  });
});

describe('ipc: "if part no exist" — logbook, ICA, engineering approval', () => {
  const planted = all([4, 5], 30).filter((m) => m.planted);

  it('the IPC part comes back from the airplane; the ICA part needs the installation entry cited', () => {
    expect(planted.length).toBeGreaterThan(10);
    expect(new Set(planted.map((m) => m.ata)).size).toBe(5);
    for (const m of planted) {
      const p = m.ac.plant!;
      expect(m.fig.rows.some((r) => r.pn === p.neededPn)).toBe(false);
      expect(m.expect[0].pn).toBe(p.neededPn);
      // the book's own answer: the mechanic finds at the airplane that it does not fit
      const ipcOrder = withLine(m, p.ipcPn);
      expect(wouldReveal(m, ipcOrder)).toBe(true);
      expect(scoreIpc(m, ipcOrder).fault).toMatch(/STC/);
      // no approval, no install
      const noCite = { lines: [{ pn: p.neededPn, qty: m.expect[0].qty, src: 'ica' as const }], marks: {} };
      expect(wouldReveal(m, noCite)).toBe(false);
      expect(scoreIpc(m, noCite).score).toBeLessThan(PASS);
      // a later entry that only cites the STC is not the installation record
      if (p.laterEntryIds.length) expect(scoreIpc(m, { ...noCite, cite: p.laterEntryIds[0] }).score).toBeLessThan(PASS);
      const ok = scoreIpc(m, { ...noCite, cite: p.entryId });
      expect(ok.score).toBe(1);
      expect(ok.notes.some((n) => n.ok && n.text.includes(fmtDate(p.form337)))).toBe(true);
      // found out the hard way, then did it right: a pass, never perfect
      const late = scoreIpc(m, { ...noCite, cite: p.entryId, revealed: true });
      expect(late.score).toBeGreaterThanOrEqual(PASS);
      expect(late.score).toBeLessThan(PERFECT);
    }
  });

  it('only the displaced part comes back "doesn\'t fit"; any other IPC line is scored as it is', () => {
    let n = 0;
    for (const m of planted) {
      const other = m.fig.rows.find((r) => r.applies && !r.np && r.upa !== 'RF' && !r.supsdBy && !m.displaced.includes(baseItem(r.item)));
      if (!other) continue;
      n++;
      const a = withLine(m, other.pn, 1);
      expect(wouldReveal(m, a), `${m.ata} ${other.pn}`).toBe(false);
      expect(scoreIpc(m, a).score).toBeLessThan(PASS);
      // another IPC part the STC took off: a wrong part, not a second chance
      const gone = m.fig.rows.find((r) => r.applies && !r.np && r.upa !== 'RF' && m.displaced.includes(baseItem(r.item)) && baseItem(r.item) !== m.item);
      if (gone) {
        expect(wouldReveal(m, withLine(m, gone.pn, 1))).toBe(false);
        expect(scoreIpc(m, withLine(m, gone.pn, 1)).fault).toMatch(/STC/);
      }
    }
    expect(n).toBeGreaterThan(3);
  });

  it('every alteration has an ICA to open: the STC that replaced the assembly lists its parts, the others their own', () => {
    for (const m of planted.slice(0, 12)) {
      for (const a of m.ac.alterations) {
        const parts = icaParts(a);
        if (a.displaces) expect(parts).toBe(a.parts);
        if (!a.stc) expect(parts).toEqual([]);
        // a part from another alteration's ICA is legal hardware, just not this job's part
        for (const r of parts) expect(lineFault(m, { pn: r.pn, qty: 1, src: 'ica' })).toBeNull();
      }
      expect(m.ac.alterations.filter((a) => !a.displaces && a.stc).some((a) => icaParts(a).length)).toBe(true);
    }
  });

  it('the reasoning names the STC, the 337 and the entry', () => {
    const m = planted[0];
    expect(m.why.join(' ')).toContain(m.ac.plant!.stc);
    expect(m.why.join(' ')).toContain(fmtDate(m.ac.plant!.form337));
  });

  it('the records an IA reads: AD entries state the method of compliance, a field approval names its applicant', () => {
    for (const model of ['twin', 'cargo', 'float'] as PlaneModel[]) {
      const ac = aircraftOf(12, 'p', model);
      for (const ad of ac.ads) expect(ad.moc, ad.id).toMatch(/per paragraph \(g\)/);
      // every AD sentence in the books, inspection entries included
      const said = ac.log.flatMap((e) => e.text.match(/AD \d{4}-\d\d-\d\d \([^)]*\) complied with[^.]*/g) ?? []);
      expect(said.length, model).toBeGreaterThan(0);
      for (const x of said) expect(x).toMatch(/complied with by .*paragraph \(g\)/);
    }
    const fields = [1, 2, 3, 4, 5, 6, 7, 8].flatMap((i) => aircraftOf(i, 'p', 'twin').alterations.filter((a) => a.kind === 'field'));
    expect(fields.length).toBeGreaterThan(0);
    for (const a of fields) expect(a.title).not.toMatch(/extinguisher/i);
  });

  it('solveItem follows NP to the effective next higher assembly', () => {
    for (const model of ['twin', 'cargo', 'float'] as PlaneModel[]) {
      const ac = aircraftOf(3, 'p', model);
      const fig = ipcFor(ac, '32-40');
      const s = solveItem(fig, '6', 1);
      const wheel = fig.rows.find((r) => r.tag === 'wheel' && r.applies)!;
      expect(s.expect[0].pn).toBe(wheel.pn);
      expect(s.features.np).toBe(true);
      expect(s.features.effAB).toBe(true);
    }
  });
});
