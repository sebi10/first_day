// Tasks (docs/JOBFLOW.md 4) and the money per job (8.3): what the Manual step
// finds, what a plan draws, and the band that keeps a job's labour plus its
// standard parts at today's card.
import { describe, expect, it, vi } from 'vitest';
import { aircraftOf, ipcFor, rowFor, type PlaneModel } from '../src/sim/aircraft';
import { needsOf, siteOf, SYMPTOMS } from '../src/sim/alerts';
import { plantFor } from '../src/sim/chain';
import { CATALOG, LABOR, MODELS } from '../src/sim/data';
import { createIsland } from '../src/sim/engine';
import { bomValue, cardToday, effectivePn, laborCost, linesFor, stdPick } from '../src/sim/flow';
import { itemById } from '../src/sim/items';
import { benchFor, defaultTask, fixedFor, laborMin, plannable, slotQty, TASKS, taskOn, tasksFor } from '../src/sim/tasks';
import type { Alert, Asset, OpsRole } from '../src/sim/types';

// whole-matrix and whole-season runs: CI runners are about 1.5x slower
vi.setConfig({ testTimeout: 30000 });

const PLANES: PlaneModel[] = ['twin', 'cargo', 'float'];
const NO_TASK = ['wb', 'gpustart', 'report', 'project'];

describe('tasks', () => {
  it('every catalog kind but load sheets and ground power starts has a task on each of its targets', () => {
    for (const c of CATALOG) {
      if (NO_TASK.includes(c.kind)) continue;
      for (const t of c.targets) {
        const asset = { kind: MODELS[t].kind, model: t };
        const found = tasksFor(null, asset, c.role as OpsRole).filter((x) => x.kind === c.kind && plannable(x));
        expect(found.length, `${c.kind} on ${t}`).toBeGreaterThan(0);
        expect(defaultTask(c.kind, asset)?.kind, `${c.kind} default on ${t}`).toBe(c.kind);
      }
    }
    // load sheets and ground power starts stay direct orders
    expect(defaultTask('wb', { kind: 'plane', model: 'twin' })).toBeUndefined();
  });

  it('task ids and numbers: one task per number per model', () => {
    const ids = TASKS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of PLANES) {
      const nos = tasksFor(null, { kind: 'plane', model: m }, 'mech').map((t) => t.no);
      expect(new Set(nos).size).toBe(nos.length);
      expect(taskOn('05-20', { kind: 'plane', model: m })!.no).toBe(m === 'cargo' ? '05-20-02' : '05-20-01');
    }
    // the electrician's reference is not the mechanic's, and the other way round
    expect(tasksFor(null, { kind: 'plane', model: 'twin' }, 'elec')).toEqual([]);
    expect(tasksFor(null, { kind: 'house', model: 'cottage' }, 'mech')).toEqual([]);
    expect(tasksFor(null, { kind: 'generator', model: 'gen' }, 'mech').map((t) => t.id)).toEqual(['gsm:2-1', 'gsm:2-4']);
  });

  it('every task that can be planned has its hours in LABOR, and every tool it names is a shop tool', () => {
    for (const t of TASKS) {
      for (const tool of t.tools) expect(itemById(tool)?.kind, `${t.id} ${tool}`).toBe('tool');
      if (!plannable(t)) continue;
      const key = t.book === 'GSM' ? `GSM ${t.no}` : t.no;
      expect(LABOR.hours[key], `${t.id} (${key})`).toBeGreaterThan(0);
      expect(laborMin(t)).toBe(Math.ceil((LABOR.rate[t.trade] * LABOR.hours[key]) / 10) * 10);
    }
  });

  it('every main slot resolves on every airplane: both S/N blocks and both SB states', () => {
    for (const m of PLANES) {
      const tasks = TASKS.filter((t) => t.models?.includes(m));
      const envs = new Map<string, Set<string>>();
      for (let seed = 1; seed <= 40; seed++) {
        const ac = aircraftOf(seed, 'p9', m);
        for (const t of tasks) {
          for (const slot of t.main) {
            if (!slot.ata || !slot.tag) continue;
            const fig = ipcFor(ac, slot.ata);
            const row = rowFor(fig, slot.tag);
            expect(row, `${m} ${seed} ${t.id} ${slot.tag}`).toBeTruthy();
            const pn = effectivePn(ac, slot.ata, slot.tag)!;
            expect(itemById(pn), `${m} ${seed} ${t.id} ${slot.tag} ${pn}`).toBeTruthy();
            expect(slotQty(slot, ac, null)).toBeGreaterThan(0);
            // the effectivity this airplane is in, for the figure
            const b = fig.rows.find((x) => x.eff === 'B');
            const c = fig.rows.find((x) => x.eff === 'C');
            const key = `${b ? (b.applies ? 'B' : 'A') : '-'}${c ? (c.applies ? 'C' : 'D') : '-'}`;
            (envs.get(slot.ata) ?? envs.set(slot.ata, new Set()).get(slot.ata)!).add(key);
          }
        }
      }
      // forty airplanes cover both blocks and both SB states of every figure a slot is in
      for (const [ata, seen] of envs) {
        const sample = [...seen][0];
        const want = (sample[0] === '-' ? 1 : 2) * (sample[1] === '-' ? 1 : 2);
        expect(seen.size, `${m} ${ata} ${[...seen].join(',')}`).toBe(want);
      }
    }
  });

  it('the brake linings: both mains (UPA 2 x 2), or the conversion’s own UPA where it governs', () => {
    const lining = TASKS.find((t) => t.id === 'amm:twin:32-40-02')!.main[0];
    expect(slotQty(lining, aircraftOf(3, 'p9', 'twin'), null)).toBe(4);
    const seed = Array.from({ length: 400 }, (_, i) => i + 1).find((x) => plantFor(x, 'p9', 'twin').plant === '32-40' && plantFor(x, 'p9', 'twin').via !== 'pma')!;
    expect(seed).toBeTruthy();
    const ac = aircraftOf(seed, 'p9', 'twin', plantFor(seed, 'p9', 'twin'));
    expect(slotQty(lining, ac, null)).toBe(8);
    expect(effectivePn(ac, '32-40', 'lining')).toBe('KA-66-19HD');
  });

  it('benchFor resolves every line for every model, and a rare job’s pre-filled line is the engine’s cylinder', () => {
    for (const t of TASKS) {
      const models: (PlaneModel | null)[] = t.models ?? [null];
      for (const m of models) {
        for (const seed of [2, 9]) {
          const ac = m ? aircraftOf(seed, 'p9', m) : null;
          const lines = benchFor(t, ac);
          for (const l of lines) {
            expect(itemById(l.item), `${t.id} ${l.item}`).toBeTruthy();
            expect(l.qty).toBeGreaterThan(0);
          }
          for (const b of t.bench) {
            if (b.when) continue;
            const want = b.item ?? (b.tag && b.ata && ac ? rowFor(ipcFor(ac, b.ata), b.tag)!.pn : b.anyOf?.[0]);
            expect(lines.some((l) => l.item === want), `${t.id} ${m} ${want}`).toBe(true);
          }
        }
      }
      if (t.fixed) for (const target of t.models ?? t.targets ?? []) for (const l of fixedFor(t, { kind: MODELS[target]?.kind ?? 'plane', model: target })) expect(itemById(l.item), `${t.id} ${l.item}`).toBeTruthy();
    }
    expect(fixedFor(TASKS.find((t) => t.id === 'amm:twin:72-30-01')!, { kind: 'plane', model: 'twin' })).toEqual([{ item: 'BCY520-19X', qty: 1 }]);
    expect(fixedFor(TASKS.find((t) => t.id === 'amm:float:72-30-01')!, { kind: 'plane', model: 'float' })).toEqual([{ item: 'BCY520-12X', qty: 1 }]);
  });
});

// ---------------------------------------------------------------------------
// The band (8.3)

const TIER_OF: Record<string, number> = { twin: 1, cottage: 1, panel: 1, cargo: 2, gen: 3, float: 4, villa: 4, lodge: 5 };
const ISLANDS = Array.from({ length: 400 }, (_, i) => i + 1);

describe('money per job', () => {
  it('labour + the standard parts is 0.85-1.25 x today’s card for every task x model x cause x tier x health (ICA picks exempt)', () => {
    const out: string[] = [];
    const exempt = new Set<string>();
    const cheap = new Set<string>();
    let n = 0;
    for (const sym of Object.values(SYMPTOMS)) {
      sym.causes.forEach((c, ci) => {
        if (!c.fix) return;
        for (const model of sym.models ?? sym.targets ?? []) {
          if (c.models && !c.models.includes(model as PlaneModel)) continue;
          const plane = MODELS[model].kind === 'plane';
          // one island with no alteration on this plane, and one per assembly an STC or field approval replaces
          const seeds = plane ? [ISLANDS.find((x) => !plantFor(x, 'p9', model).plant)!, ...[...new Set(ISLANDS.filter((x) => plantFor(x, 'p9', model).plant && plantFor(x, 'p9', model).via !== 'pma').map((x) => plantFor(x, 'p9', model).plant))].map((ata) => ISLANDS.find((x) => plantFor(x, 'p9', model).plant === ata && plantFor(x, 'p9', model).via !== 'pma')!)] : [11];
          for (const seed of seeds) {
            for (let tier = TIER_OF[model]; tier <= 5; tier++) {
              for (const health of [80, 40]) {
                for (let k = 0; k < (sym.role === 'elec' ? 6 : 1); k++) {
                  const s = createIsland({ id: 'b', name: 'B', now: 0, tz: 'UTC', seed, creator: { uid: 'a', name: 'A', role: 'mech' } });
                  s.tier = tier;
                  const asset: Asset = { id: 'p9', kind: MODELS[model].kind, model, name: 'X', health, touchedWeek: 0 };
                  s.assets.push(asset);
                  const task = taskOn(c.fix!, asset);
                  expect(task?.kind, `${sym.key}#${ci} ${c.fix} on ${model}`).toBeTruthy();
                  const a: Alert = { id: 'a1', role: sym.role, assetId: 'p9', sym: sym.key, src: sym.src, week: 1, due: 1, seed: 1000 + k * 7919 + tier, kind: c.kind, cause: ci, status: 'open' };
                  const site = siteOf(s, a);
                  const pick = stdPick(s, asset, task!, site, needsOf(s, a));
                  const std = bomValue(linesFor(s, asset, task!, pick));
                  const labor = laborCost(s, task!.kind!, task!, asset, site, needsOf(s, a));
                  const card = cardToday(s, task!.kind!, asset);
                  const ratio = (labor + std) / card;
                  const ica = pick.some((l) => itemById(l.item)?.ica);
                  // a cheap fix under a dear kind (a belt under the alternator's card): its labour stops at LABOR.capX x the book
                  const capped = labor >= LABOR.capX * laborMin(task!) && labor + std < 0.85 * card;
                  n++;
                  if (ica) exempt.add(`${task!.id} on ${model}, island seed ${seed}`);
                  else if (capped) cheap.add(`${sym.key}#${ci} ${task!.id} on ${model}: labour ${labor} (the book ${laborMin(task!)}), card ${card}`);
                  else if (ratio < 0.85 || ratio > 1.25) out.push(`${sym.key}#${ci} ${task!.id} ${model} tier ${tier} health ${health}: ${ratio.toFixed(3)} (labour ${labor}, parts ${std.toFixed(0)}, card ${card})`);
                  expect(labor).toBeGreaterThanOrEqual(laborMin(task!));
                }
              }
            }
          }
        }
      });
    }
    // the exempt list: an altered airplane's ICA part is dearer by design (CHAIN.icaMult)
    console.log(`band: ${n} combinations; ICA picks exempt:\n  ${[...exempt].sort().join('\n  ')}\ncheap fixes under a dear kind (labour capped):\n  ${[...cheap].sort().join('\n  ')}`);
    expect(out).toEqual([]);
    // only the cheap causes under a dear kind are capped (the belt, the com's connector or a write-up with no unit, a tube under the tire's card at the
    // top tiers): every other job keeps today's card
    expect([...new Set([...cheap].map((x) => `${x.split('#')[0]} ${x.split(' ')[1].split(':').pop()}`))].sort()).toEqual(['M_BELT_SQUEAL 24-30-02', 'M_COM_INTERMITTENT 23-10-01', 'M_LOW_VOLTS 24-30-02', 'M_TIRE_PRESSURE 32-40-01', 'W_avionics 23-10-01']);
    expect(n).toBeGreaterThan(1000);
  });
});
