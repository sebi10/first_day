// Wiring checks between the game catalog (src/sim/data.ts) and the puzzle
// registry: every job and tool points at a registered puzzle of its own trade,
// and every tool id is one its puzzle actually reads.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PUZZLES } from '../src/puzzles';
import type { PuzzleId } from '../src/puzzles/types';
import { aircraftOf } from '../src/sim/aircraft';
import { CATALOG, CATALOG_BY_KIND, FIN_TASKS, MODELS, PROJECTS, TOOLS } from '../src/sim/data';
import { createIsland } from '../src/sim/engine';
import type { Asset, Order } from '../src/sim/types';
import { islandAircraft, launchFor } from '../src/ui/select';

const plane = (model: string, health: number): Asset =>
  ({ id: 'x', kind: 'plane', model, name: 'X', health, touchedWeek: 0, sinceInspection: 0 }) as unknown as Asset;

describe('catalog wiring', () => {
  it('every job, crew-project job and analyst task launches a registered puzzle of its own trade', () => {
    for (const c of CATALOG) {
      expect(PUZZLES[c.puzzle], c.kind).toBeDefined();
      expect(PUZZLES[c.puzzle].role, c.kind).toBe(c.role);
      for (const t of c.targets) expect(MODELS[t], `${c.kind} → ${t}`).toBeDefined();
    }
    for (const p of Object.values(PROJECTS))
      for (const [role, j] of Object.entries(p.jobs)) expect(PUZZLES[j.puzzle].role, j.title).toBe(role);
    for (const t of Object.values(FIN_TASKS)) expect(PUZZLES[t.puzzle].role).toBe('fin');
  });

  // the paperwork puzzles are not work orders of their own: the part chain (a squawk → the
  // IPC → the logbooks and an engineering approval) launches them on the job it belongs to
  const CHAIN: ReadonlySet<PuzzleId> = new Set<PuzzleId>(['ipc', 'logbook']);

  it('every mechanic puzzle is on the work-order catalog (the part-chain puzzles are launched by the chain)', () => {
    const used = new Set(CATALOG.filter((c) => c.role === 'mech').map((c) => c.puzzle));
    for (const d of Object.values(PUZZLES)) if (d.role === 'mech' && !CHAIN.has(d.id)) expect(used.has(d.id), d.id).toBe(true);
    // a chain puzzle is a registered mechanic puzzle, and not a catalog job as well
    for (const id of CHAIN) {
      expect(PUZZLES[id].role, id).toBe('mech');
      expect(used.has(id), id).toBe(false);
    }
  });

  it('every tool belongs to its trade and is read by its puzzle', () => {
    for (const [role, tools] of Object.entries(TOOLS)) {
      const levels = tools.map((t) => t.level);
      expect(new Set(levels).size, `${role} tool levels`).toBe(levels.length);
      for (const t of tools) {
        expect(PUZZLES[t.puzzle].role, t.id).toBe(role);
        const src = readFileSync(resolve(import.meta.dirname, `../src/puzzles/${t.puzzle}.ts`), 'utf8');
        expect(src.includes(`'${t.id}'`), `${t.id} in ${t.puzzle}.ts`).toBe(true);
      }
    }
  });

  it('hydraulic servicing and ground power start are ordinary, parts-free mechanic jobs', () => {
    const hyd = CATALOG_BY_KIND.hydraulics;
    const gpu = CATALOG_BY_KIND.gpustart;
    expect(hyd.puzzle).toBe('hydraulics');
    expect(gpu.puzzle).toBe('gpu');
    for (const c of [hyd, gpu]) {
      expect(c.parts).toBe(0);
      expect(c.gain).toBeGreaterThan(0);
      // never a must-do: they share the weekly slots with the other repairs
      expect(c.weight(plane(c.targets[0], 50), 1)).toBeGreaterThan(0);
      expect(c.weight(plane(c.targets[0], 50), 1)).toBeLessThan(100);
      expect(c.weight(plane(c.targets[0], 100), 1)).toBe(0);
    }
    // power brakes with an accumulator: the twin and the amphibian floats
    expect(hyd.targets).toEqual(['twin', 'float']);
    // the ground power puzzle models single-engine airframes only
    expect(gpu.targets.every((t) => !/twin/i.test(MODELS[t].label))).toBe(true);
    expect(gpu.cost).toBeLessThan(Math.min(...CATALOG.filter((c) => c.role === 'mech' && c.cost > 0 && c !== gpu).map((c) => c.cost)));
  });
});

describe('launch wiring', () => {
  it("a paperwork puzzle on a plane gets the island's own airplane, built once; other jobs don't pay for it", () => {
    const base = createIsland({ id: 'lw', name: 'Launch Isle', now: 1_700_000_000_000, tz: 'UTC', seed: 4242, creator: { uid: 'a', name: 'Ana', role: 'mech' } });
    const cargo = { id: 'p2', kind: 'plane', model: 'cargo', name: 'Cargo C-7', health: 70, touchedWeek: 0, sinceInspection: 0 } as Asset;
    const s = { ...base, assets: [cargo] };
    const order = (puzzle: string, kind: string) => ({ id: `o-${puzzle}`, kind, role: 'mech', puzzle, assetId: 'p2', title: 'Job', seed: 9, status: 'ready', tier: 2, gain: 10, cost: 0 }) as unknown as Order;
    for (const puzzle of ['ipc', 'logbook']) {
      const a = launchFor(s, order(puzzle, 'tires'), 'mech').context!.aircraft!;
      expect(a.model, puzzle).toBe('cargo');
      expect(a.assetId).toBe('p2');
      expect(a.islandSeed).toBe(4242);
      // derived from the seed: the same records aircraftOf builds, and the same object every launch
      expect(a.registration).toBe(aircraftOf(4242, 'p2', 'cargo').registration);
      expect(launchFor(s, order(puzzle, 'tires'), 'mech').context!.aircraft).toBe(a);
      expect(islandAircraft(4242, cargo)).toBe(a);
    }
    expect(launchFor(s, order('torque', 'tires'), 'mech').context!.aircraft).toBeUndefined();
    // the island doc never carries it
    expect(JSON.stringify(s)).not.toContain('registration');
  });
});
