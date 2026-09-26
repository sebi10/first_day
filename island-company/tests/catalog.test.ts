// Wiring checks between the game catalog (src/sim/data.ts) and the puzzle
// registry: every job and tool points at a registered puzzle of its own trade,
// and every tool id is one its puzzle actually reads.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PUZZLES } from '../src/puzzles';
import { CATALOG, CATALOG_BY_KIND, FIN_TASKS, MODELS, PROJECTS, TOOLS } from '../src/sim/data';
import type { Asset } from '../src/sim/types';

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

  it('every mechanic puzzle is on the work-order catalog', () => {
    const used = new Set(CATALOG.filter((c) => c.role === 'mech').map((c) => c.puzzle));
    for (const d of Object.values(PUZZLES)) if (d.role === 'mech') expect(used.has(d.id), d.id).toBe(true);
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
