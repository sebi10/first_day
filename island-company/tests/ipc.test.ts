// Parts lookup (IPC): the mechanic's workflow on real conventions. The answer
// is what the book gives for THIS airplane (S/N + SB status), after NP and
// SUPSD BY; a wrong part is a latent defect; tiers 0-2 teach and 3+ do not;
// from tier 4 an STC may have replaced the assembly, and then the part is only
// in the ICA and needs an engineering approval citing the logbook.
import { describe, expect, it, vi } from 'vitest';
import { IPC_CASES, generateIpc, lineFault, perfectAttempt, scoreIpc, solveItem, wouldReveal, baseItem, type IpcAttempt, type IpcModel } from '../src/puzzles/ipc';
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

  it('brake linings: both main wheels (UPA x 2), and a pre-SB airplane orders the code-3 set', () => {
    const linings = all([3, 5], 30).filter((m) => m.caseKey === 'lining' && !m.planted);
    expect(linings.length).toBeGreaterThan(3);
    for (const m of linings) {
      expect(m.mult).toBe(2);
      expect(m.multWhy).toMatch(/both main wheels/);
      expect(m.expect[0].qty).toBe(4);
      if (m.marks.cd === 'D') {
        expect(m.features.set).toBe(true);
        expect(m.expect.map((e) => e.item)).toEqual(['21A', '23A']);
        // new linings on the old back plates: a latent defect
        const half = scoreIpc(m, withLine(m, m.expect[0].pn));
        expect(half.fault).toMatch(/code 3/i);
        expect(half.score).toBeLessThan(PASS);
      } else expect(m.expect.length).toBe(1);
    }
    expect(linings.some((m) => m.marks.cd === 'D')).toBe(true);
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

  it('superseded one-way (code 2) or set-only (code 3) parts fail; a code-1 old part is legal but not perfect', () => {
    let hard = 0;
    let soft = 0;
    for (const m of plain) {
      const old = m.fig.rows.find((r) => r.pn === m.path[0]);
      if (!old?.supsdBy) continue;
      const s = scoreIpc(m, withLine(m, old.pn));
      if (old.supsdBy.code === 1) {
        soft++;
        expect(s.fault).toBeNull();
        expect(s.score).toBeGreaterThanOrEqual(PASS);
        expect(s.score).toBeLessThan(PERFECT);
      } else {
        hard++;
        expect(s.fault, `${m.caseKey} ${old.pn}`).toMatch(/superseded/);
        expect(s.score).toBeLessThan(PASS);
      }
    }
    expect(hard).toBeGreaterThan(3);
    expect(soft).toBeGreaterThan(0);
  });

  it('an IPC alternate is as good as the part; the wrong quantity or no effectivity check still passes, not perfect', () => {
    const alts = plain.filter((m) => m.features.alt);
    expect(alts.length).toBeGreaterThan(0);
    for (const m of alts) expect(scoreIpc(m, withLine(m, m.expect[0].accept[1])).score).toBe(1);
    for (const m of plain.filter((x) => x.expect.length === 1)) {
      const q = scoreIpc(m, withLine(m, m.expect[0].pn, m.expect[0].qty + 1));
      expect(q.score).toBeGreaterThanOrEqual(PASS);
      expect(q.score).toBeLessThan(PERFECT);
      const e = scoreIpc(m, { ...withLine(m, m.expect[0].pn), marks: {} });
      expect(e.score).toBeGreaterThanOrEqual(PASS);
      expect(e.score).toBeLessThan(PERFECT);
    }
  });

  it('the wrong item entirely is not a pass, and an empty request is never zero-by-crash', () => {
    const m = plain.find((x) => x.expect.length === 1 && x.ata === '32-40')!;
    const other = m.fig.rows.find((r) => r.applies && !r.np && !r.supsdBy && r.upa !== 'RF' && baseItem(r.item) !== m.item && !m.expect[0].accept.includes(r.pn))!;
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

  it('only tier 4+ plants an STC-replaced assembly (when the island does not hand over its airplane)', () => {
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
    for (const ata of IPC_ATAS) {
      const bad = aircraftOf(77, 'p1', 'twin', { plant: ata });
      const pm = generateIpc(5, 3, [], { aircraft: bad });
      expect(pm.ata).toBe(ata);
      expect(pm.planted).toBe(true);
      expect(scoreIpc(pm, perfectAttempt(pm)).score).toBe(1);
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

  it('the reasoning names the STC, the 337 and the entry', () => {
    const m = planted[0];
    expect(m.why.join(' ')).toContain(m.ac.plant!.stc);
    expect(m.why.join(' ')).toContain(fmtDate(m.ac.plant!.form337));
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
