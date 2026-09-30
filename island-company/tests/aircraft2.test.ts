// Fig 79-20 and the any-ATA helpers (docs/JOBFLOW.md 3.1). The five existing
// figures and every island's airplanes stay exactly as they were
// (tests/aircraft-golden.test.ts, unchanged).
import { describe, expect, it } from 'vitest';
import { aircraftOf, ALL_ATAS, ammTaskFor, AMM_TASKS2, figuresFor, findPart, ipcFor, IPC_ATAS } from '../src/sim/aircraft';

const SEEDS = [7, 42, 1234];
const MODELS = ['twin', 'cargo', 'float'] as const;

describe('fig 79-20: the oil filter and drain', () => {
  it('is pinned for three island seeds', () => {
    for (const seed of SEEDS) {
      const twin = ipcFor(aircraftOf(seed, 'p1', 'twin'), '79-20');
      expect(twin.fig).toBe(58);
      expect(twin.title).toBe('OIL FILTER AND DRAIN (TYPICAL LH AND RH)');
      expect(twin.rows.map((r) => `${r.item} ${r.pn} ${r.upa}`)).toEqual(['1 0531900-1 RF', '2 BAE-48119 1', '2A SF48119-1 1', '3 AN814-8DL 1', '4 AN900-10 1', '5 MS20995C32 AR']);
      const cargo = ipcFor(aircraftOf(seed, 'p2', 'cargo'), '79-20');
      expect(cargo.fig).toBe(60);
      expect(cargo.rows.map((r) => r.pn)).toEqual(['0528900-5', 'NT3031-14', 'NT3031-PK', 'NT3021-8', 'MS9068-012']);
      const float = ipcFor(aircraftOf(seed, 'p3', 'float'), '79-20');
      expect(float.fig).toBe(46);
      expect(float.rows.map((r) => r.pn)).toEqual(['0518900-1', 'BAE-48112', 'SF48112-1', 'AN814-8DL', 'AN900-10', 'MS20995C32']);
      // one row per item: no effectivity codes, every row applies
      expect(float.effCodes).toEqual([]);
      expect(float.rows.every((r) => r.applies)).toBe(true);
      expect(twin.rows.find((r) => r.item === '2A')!.alt).toBe('BAE-48119');
    }
  });

  it('figure numbers are unique per model and in ATA order', () => {
    for (const m of MODELS) {
      const figs = figuresFor(aircraftOf(1, 'p9', m));
      expect(figs.map((f) => f.ata)).toEqual([...ALL_ATAS].sort());
      const nums = figs.map((f) => f.fig);
      expect(new Set(nums).size).toBe(nums.length);
      expect([...nums].sort((a, b) => a - b)).toEqual(nums);
    }
  });

  it("each piston model's IPC oil filter P/N is the one its logbook oil entries record", () => {
    for (const seed of SEEDS) {
      for (const [id, m] of [
        ['p1', 'twin'],
        ['p3', 'float'],
      ] as const) {
        const ac = aircraftOf(seed, id, m);
        const filter = ipcFor(ac, '79-20').rows.find((r) => r.tag === 'oilFilter' && !r.alt)!.pn;
        const oil = ac.log.filter((e) => e.kind === 'oil');
        expect(oil.length).toBeGreaterThan(0);
        for (const e of oil) expect(e.text).toContain(filter);
      }
    }
  });

  it('findPart and the logbook puzzle keep searching the five figures only', () => {
    const ac = aircraftOf(42, 'p1', 'twin');
    expect(findPart(ac, 'BAE-48119').ipc).toEqual([]);
    expect(IPC_ATAS).toEqual(['32-40', '61-10', '29-10', '23-10', '24-30']);
  });

  it('the job flow’s short task cards print for every model', () => {
    for (const m of MODELS) {
      const ac = aircraftOf(3, 'p9', m);
      // the cargo turbine has no V-belt, no brake power pack task and no cylinders (tasks.ts gives those to the pistons)
      for (const key of AMM_TASKS2.filter((k) => m !== 'cargo' || !['belt', 'bleed', 'cylinder'].includes(k))) {
        const t = ammTaskFor(ac, key);
        expect(t.taskNo).toMatch(/^\d\d-\d\d-\d\d$/);
        expect(t.taskNo.startsWith(t.ata)).toBe(true);
        expect(t.steps.length).toBeGreaterThanOrEqual(5);
        for (const st of t.steps) if (st.torque) expect(t.torques.filter((q) => q.key === st.torque && q.applies).length, `${m} ${key} ${st.torque}`).toBe(1);
      }
      expect(ammTaskFor(ac, 'inspection').taskNo).toBe(m === 'cargo' ? '05-20-02' : '05-20-01');
    }
    // the bleed card prints the approved fluid by the power pack's SB, for the hydraulic puzzle
    const t = ammTaskFor(aircraftOf(5, 'p1', 'twin'), 'bleed');
    expect(t.servicing.filter((x) => x.key === 'fluid').length).toBe(2);
    expect(t.servicing.filter((x) => x.applies).length).toBe(1);
  });
});
