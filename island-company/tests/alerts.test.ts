// Alerts (docs/JOBFLOW.md 5): the symptom tables, the hidden cause, the only
// guest plane, the teaching findings, and the right pick for every site the
// tables make. The week-by-week parts (volume, NFF share, hazards, MEL,
// comebacks) are in tests/flow.test.ts and tests/consequences.test.ts.
import { describe, expect, it, vi } from 'vitest';
import { plantFor } from '../src/sim/chain';
import { alertTier, causeOf, findingOf, fixesOf, needsOf, prefilledTask, protectionNeeded, raiseAlert, siteOf, slotKind, soleGuest, symptomOf, symptomText, SYMPTOMS } from '../src/sim/alerts';
import { planeModel, type PlaneModel } from '../src/sim/aircraft';
import { CATALOG, MODELS, TIERS } from '../src/sim/data';
import { createIsland } from '../src/sim/engine';
import { judgeElecPick, judgeSlot, stdPick } from '../src/sim/flow';
import { taskOn } from '../src/sim/tasks';
import type { Alert, Asset, IslandState, OpsRole } from '../src/sim/types';

/** an island at a tier, with every asset the tiers so far add */
function island(tier: number, seed = 7): IslandState {
  const s = createIsland({ id: 't', name: 'T', now: 0, tz: 'UTC', seed, creator: { uid: 'm', name: 'Mia', role: 'mech' } });
  s.players.elec = { ...s.players.mech!, uid: 'e', name: 'Eli', role: 'elec' };
  s.players.fin = { ...s.players.mech!, uid: 'f', name: 'Fay', role: 'fin' };
  for (let t = 2; t <= tier; t++)
    for (const a of TIERS[t - 1].adds) if (!s.assets.some((x) => x.id === a.id)) s.assets.push({ id: a.id, kind: MODELS[a.model].kind, model: a.model, name: a.name, health: 80, touchedWeek: 0 });
  s.tier = tier;
  s.week = 6;
  s.flowSince = 1;
  return s;
}

// thousands of raised alerts and 30 islands' picks: the CI runner is about 1.5x slower than a dev box
vi.setConfig({ testTimeout: 30000 });

const NO_ALERT = ['wb', 'gpustart'];
const assetFor = (s: IslandState, model: string) => s.assets.find((a) => a.model === model)!;

describe('the symptom tables', () => {
  it('every cause’s task fits the symptom’s models and rooms, and what it needs are the task’s slots', () => {
    for (const sym of Object.values(SYMPTOMS)) {
      if (sym.rooms) for (const n of sym.nff ?? []) for (const r of n.rooms ?? []) expect(sym.rooms, sym.key).toContain(r);
      sym.causes.forEach((c, i) => {
        if (sym.rooms && c.rooms) for (const r of c.rooms) expect(sym.rooms, `${sym.key}#${i}`).toContain(r);
        if (!c.fix) {
          // no fix task: the wiring (the electrician meters it), or a repair (its defect's fix)
          expect(['wiring', 'repair'], `${sym.key}#${i}`).toContain(c.kind);
          return;
        }
        const targets = sym.models ? sym.models.filter((m) => !c.models || c.models.includes(m)) : (sym.targets ?? []);
        expect(targets.length, `${sym.key}#${i}`).toBeGreaterThan(0);
        for (const t of targets) {
          const task = taskOn(c.fix, { kind: MODELS[t].kind, model: t });
          expect(task, `${sym.key}#${i} ${c.fix} on ${t}`).toBeTruthy();
          expect(task!.trade).toBe(sym.role);
          expect(task!.kind, `${sym.key}#${i}`).toBe(c.kind);
          if (MODELS[t].kind === 'plane') expect(task!.models).toContain(planeModel(t));
          else expect(task!.targets).toContain(t);
          for (const n of c.needs ?? []) expect(task!.main.map((m) => m.slot), `${sym.key}#${i} needs ${n}`).toContain(n);
        }
      });
    }
  });

  it('every kind can be raised on each of its targets as a real symptom, the only guest plane included', () => {
    for (const c of CATALOG) {
      if (NO_ALERT.includes(c.kind)) continue;
      for (const t of c.targets) {
        const s = island(MODELS[t].kind === 'plane' && t !== 'twin' ? 4 : 5);
        const asset = assetFor(s, t);
        for (let k = 0; k < 6; k++) {
          const a = raiseAlert(s, { role: c.role as OpsRole, asset, kind: c.kind }, 0);
          // a bench symptom's wiring cause fills its unit's slot (5.4)
          expect(slotKind(a), `${c.kind} on ${t}`).toBe(c.kind);
          expect([c.kind, 'wiring'], `${c.kind} on ${t}`).toContain(a.kind);
          expect(a.sym.startsWith('W_'), `${c.kind} on ${t}: ${a.sym}`).toBe(false);
          expect(symptomOf(a)!.auto).toBeFalsy();
        }
      }
    }
    // the only guest plane: every twin kind still has a symptom there
    const s = island(1);
    expect(soleGuest(s, 'p1')).toBe(true);
    for (const c of CATALOG.filter((x) => x.targets.includes('twin') && !NO_ALERT.includes(x.kind))) {
      const a = raiseAlert(s, { role: 'mech', asset: assetFor(s, 'twin'), kind: c.kind }, 0);
      expect(slotKind(a)).toBe(c.kind);
      expect(a.sym.startsWith('W_'), `${c.kind}: ${a.sym}`).toBe(false);
    }
  });

  it('symptom texts and findings fill every blank, for every target and cause', () => {
    for (const tier of [1, 5]) {
      const s = island(tier);
      for (const sym of Object.values(SYMPTOMS)) {
        if (sym.key === 'R_REPAIR') continue;
        for (const t of sym.models ?? sym.targets ?? []) {
          const asset = s.assets.find((a) => (a.kind === 'plane' ? planeModel(a.model) === t : a.model === t));
          if (!asset) continue;
          for (let ci = -1; ci < sym.causes.length; ci++) {
            if (ci < 0 && !sym.nff?.length) continue;
            const a = raiseAlert(s, { role: sym.role, asset, sym: sym.key, cause: ci }, 0);
            const text = symptomText(s, a);
            expect(text, `${sym.key} on ${t}`).not.toMatch(/[{}]|undefined|NaN/);
            for (const tt of [1, 3]) expect(findingOf(s, a, tt).text, `${sym.key}#${ci} on ${t}`).not.toMatch(/[{}]|undefined|NaN/);
          }
        }
      }
    }
  });

  it('a due item, an AD, a code notice or a take-off opens with its task', () => {
    const s = island(5);
    const due = raiseAlert(s, { role: 'mech', asset: assetFor(s, 'cargo'), sym: 'M_INSP_DUE' }, 0);
    expect(due.task).toBe('amm:cargo:05-20-02');
    expect(prefilledTask(s, due)).toBe('amm:cargo:05-20-02');
    const code = raiseAlert(s, { role: 'elec', asset: assetFor(s, 'villa'), sym: 'E_CODE_DUE' }, 0);
    expect(code.task).toBe('ref:inspect');
    const squawk = raiseAlert(s, { role: 'mech', asset: assetFor(s, 'twin'), sym: 'M_BRAKE_CHATTER', cause: 0 }, 0);
    expect(squawk.task).toBeUndefined();
    expect(fixesOf(s, squawk)).toEqual(['amm:twin:32-40-02']);
    expect(needsOf(s, squawk)).toEqual(['lining']);
  });
});

describe('the only guest plane', () => {
  it('never gets a no-go wording or a hard landing; its early-sign wording is deferrable', () => {
    const s = island(3);
    const twin = assetFor(s, 'twin');
    expect(soleGuest(s, twin.id)).toBe(true);
    expect(soleGuest(s, assetFor(s, 'cargo').id)).toBe(false);
    const kinds = CATALOG.filter((x) => x.targets.includes('twin') && !NO_ALERT.includes(x.kind)).map((x) => x.kind);
    let soleWords = 0;
    for (let i = 0; i < 600; i++) {
      const a = raiseAlert(s, { role: 'mech', asset: twin, kind: kinds[i % kinds.length] }, 0);
      const sym = symptomOf(a)!;
      expect(sym.key).not.toBe('M_HARD_LANDING');
      expect(sym.sole).not.toBe('none');
      // airworthiness with no MEL relief: never due the week it's raised
      if (sym.aw && !sym.mel?.includes('twin')) expect(a.due, `${sym.key}`).toBeGreaterThan(a.week);
      if (sym.sole) {
        expect(a.sole).toBe(true);
        // the early-sign wording, not the no-go one
        expect(symptomText(s, a)).not.toBe(symptomText(s, { ...a, sole: undefined }));
        soleWords++;
      }
      s.alerts = [];
    }
    expect(soleWords).toBeGreaterThan(20);
    // once the float arrives the twin isn't the only guest plane: the no-go wording comes back
    const t4 = island(4);
    expect(soleGuest(t4, 'p1')).toBe(false);
    const a = raiseAlert(t4, { role: 'mech', asset: assetFor(t4, 'twin'), sym: 'M_BRAKE_SOFT', cause: 1 }, 0);
    expect(a.sole).toBeUndefined();
    expect(a.due).toBe(a.week);
  });
});

describe('the wiring share (5.4)', () => {
  // generateAlerts raises trade work by catalog kind; a bench symptom's wiring
  // cause rides along with its unit's kind, so the electrician's circuit check
  // really does find the wiring about as often as the spec says
  it('a bench symptom rolls the wiring about as often as the spec says: com 3 in 10, alternator 1 in 5, starter-generator 1 in 4', () => {
    const want: { key: string; kind: string; model: string; share: number }[] = [
      { key: 'M_COM_DEAD', kind: 'avionics', model: 'twin', share: 0.3 },
      { key: 'M_COM_DEAD', kind: 'avionics', model: 'cargo', share: 0.3 },
      { key: 'M_LOW_VOLTS', kind: 'alternator', model: 'twin', share: 0.2 },
      { key: 'M_GEN_OFF', kind: 'alternator', model: 'cargo', share: 0.25 },
    ];
    for (const w of want) {
      const s = island(5);
      const asset = assetFor(s, w.model);
      let n = 0;
      let wiring = 0;
      for (let k = 0; k < 900; k++) {
        const a = raiseAlert(s, { role: 'mech', asset, kind: w.kind }, 0);
        expect(slotKind(a)).toBe(w.kind);
        if (a.sym !== w.key) continue;
        n++;
        if (a.kind === 'wiring') wiring++;
      }
      expect(n, `${w.key} on ${w.model}`).toBeGreaterThan(250);
      expect(Math.abs(wiring / n - w.share), `${w.key} on ${w.model}: ${wiring}/${n}`).toBeLessThan(0.08);
    }
  });
});

describe('findings', () => {
  it('the bench fault always agrees with its finding: the wiring, or the unit', () => {
    const s = island(4);
    for (const sym of Object.values(SYMPTOMS).filter((x) => x.bench)) {
      for (const m of sym.models ?? []) {
        const asset = s.assets.find((a) => a.kind === 'plane' && planeModel(a.model) === m)!;
        sym.causes.forEach((c, ci) => {
          if (c.models && !c.models.includes(m as PlaneModel)) return;
          const a = raiseAlert(s, { role: 'mech', asset, sym: sym.key, cause: ci }, 0);
          const f1 = findingOf(s, a, 1).text;
          const f3 = findingOf(s, a, 3).text;
          if (c.kind === 'wiring') {
            expect(f1, `${sym.key}#${ci}`).toContain("It's the wiring");
            expect(fixesOf(s, a)).toEqual([]);
            // a reading on the airplane, and the unit good on the bench
            expect(f3).toMatch(/\d V/);
            expect(f3).toMatch(/on the bench|on the test stand/);
          } else {
            expect(f1, `${sym.key}#${ci}`).toContain("It's the unit");
            expect(f3).not.toMatch(/on the bench/);
          }
          // tier 3+: the raw finding only
          expect(f3).not.toMatch(/It's the|The fix:/);
        });
      }
    }
  });

  it('tier 2 and below name the fix in one plain sentence; tier 3 and up never do', () => {
    const s = island(5);
    const a = raiseAlert(s, { role: 'mech', asset: assetFor(s, 'twin'), sym: 'M_TIRE_WORN', cause: 0 }, 0);
    expect(findingOf(s, a, 2).text).toContain('(AMM 32-40-01)');
    expect(findingOf(s, a, 3).text).not.toContain('32-40-01');
    const e = raiseAlert(s, { role: 'elec', asset: assetFor(s, 'cottage'), sym: 'E_DEAD_OUTLET', cause: 0 }, 0);
    expect(findingOf(s, e, 1).text).toMatch(/This circuit: \d+ A, \d+ AWG/);
    // the service-neutral fault: a warning, not a breaker
    const n = raiseAlert(s, { role: 'elec', asset: assetFor(s, 'cottage'), sym: 'E_SHOWER_TINGLE', cause: 2 }, 0);
    expect(causeOf(n)!.neutral).toBe(true);
    expect(findingOf(s, n, 1).text).toContain("won't isolate a service neutral");
  });

  it('an intermittent fault hides (looksNff) only at alert tier 3 and up', () => {
    let hidden = 0;
    for (const tier of [1, 2, 3, 4, 5]) {
      const s = island(tier, 11);
      for (let i = 0; i < 300; i++) {
        const sym = Object.values(SYMPTOMS).filter((x) => x.intermittent)[i % 4];
        const asset = s.assets.find((a) => (a.kind === 'plane' ? sym.models?.includes(planeModel(a.model)) : sym.targets?.includes(a.model)))!;
        if (!asset) continue;
        asset.health = i % 2 ? 80 : 40;
        const a = raiseAlert(s, { role: sym.role, asset, sym: sym.key }, 0);
        if (a.looksNff) {
          hidden++;
          expect(sym.intermittent).toBe(true);
          expect(a.cause).toBeGreaterThanOrEqual(0);
          expect(alertTier(s, a, sym.role)).toBeGreaterThanOrEqual(3);
          expect(findingOf(s, a, 3).nff).toBe(true);
        } else if (a.cause >= 0) expect(findingOf(s, a, 3).nff).toBe(false);
        s.alerts = [];
      }
    }
    expect(hidden).toBeGreaterThan(0);
    // not intermittent: never hides
    const s = island(5);
    for (let i = 0; i < 100; i++) expect(raiseAlert(s, { role: 'mech', asset: assetFor(s, 'twin'), sym: 'M_TIRE_WORN' }, 0).looksNff).toBeUndefined();
  });
});

describe('the right pick', () => {
  it('stdPick passes the electrician’s judge for every site the tables make', () => {
    const s = island(5);
    let n = 0;
    for (const sym of Object.values(SYMPTOMS).filter((x) => x.role === 'elec')) {
      sym.causes.forEach((c, ci) => {
        if (!c.fix) return;
        for (const t of sym.targets ?? []) {
          const asset = assetFor(s, t);
          const task = taskOn(c.fix!, asset)!;
          for (let k = 0; k < 40; k++) {
            const a: Alert = { id: `x${k}`, role: 'elec', assetId: asset.id, sym: sym.key, src: sym.src, week: 6, due: 6, seed: 9000 + k * 131 + ci, kind: c.kind, cause: ci, status: 'open' };
            const site = siteOf(s, a);
            const pick = stdPick(s, asset, task, site, needsOf(s, a));
            const v = judgeElecPick(task, site, pick);
            expect(v, `${sym.key}#${ci} ${task.id} ${JSON.stringify(site)} ${JSON.stringify(pick)}`).toEqual({ ok: true });
            n++;
          }
        }
      });
    }
    expect(n).toBeGreaterThan(1000);
  });

  it('the spa take-off judge: conduit fill from Chapter 9 for what was picked, the next standard size (240.4(B)) and the spa panel’s listing (110.3(B))', () => {
    const task = taskOn('ref:spa', { kind: 'house', model: 'villa' } as never) ?? taskOn('ref:spa', assetFor(island(5), 'villa'))!;
    const tub50 = { room: 'spa', amps: 50, awg: 8, wet: true, run: 'buried', feet: 41 } as never;
    const tub60 = { room: 'spa', amps: 60, awg: 6, wet: true, run: 'buried', feet: 35 } as never;
    const pick50 = [
      { slot: 'spa', item: 'SPA-50GF', qty: 1 },
      { slot: 'feed', item: 'KP250', qty: 1 },
      { slot: 'wire', item: 'THWN-8', qty: 138 },
      { slot: 'egc', item: 'THWN-10', qty: 46 },
      { slot: 'emt', item: 'EMT-34', qty: 1 },
      { slot: 'connectors', item: 'EMT-C34RT', qty: 2 },
      { slot: 'pvc', item: 'PVC40-1', qty: 4 },
    ];
    const swap = (p: typeof pick50, slot: string, item: string) => p.map((l) => (l.slot === slot ? { ...l, item } : l));
    expect(judgeElecPick(task, tub50, pick50)).toEqual({ ok: true });
    // three #8 and a #10 EGC in 1/2 in EMT: 0.131 in² against 0.122 at 40%
    const half = swap(swap(pick50, 'emt', 'EMT-12'), 'connectors', 'EMT-C12RT');
    expect(judgeElecPick(task, tub50, half)).toEqual({ stop: 'Three #8 and a #10 EGC (0.131 in²) won’t fit 1/2 in EMT at 40% fill (0.122 in², Chapter 9): the wall section needs 3/4 in.' });
    // a 60 A feed on #8 hots for a 50 A tub: oversized (their 50 A is a standard size)
    expect(judgeElecPick(task, tub50, swap(pick50, 'feed', 'KP260'))).toMatchObject({ ok: false, variant: 'oversized', text: 'a 60 A feed on #8 hots' });
    // #6 hots (65 A) may take the next standard size, 70 A (240.4(B)), but not over the 60 A spa panel's listing
    const pick60 = swap(swap(swap(swap(pick50, 'spa', 'SPA-60GF'), 'feed', 'KP260'), 'wire', 'THWN-6'), 'egc', 'THWN-10');
    expect(judgeElecPick(task, tub60, pick60)).toEqual({ ok: true });
    expect(judgeElecPick(task, tub60, swap(pick60, 'feed', 'KP270'))).toMatchObject({ ok: false, variant: 'oversized', text: 'a 70 A feed on a 60 A spa panel (its listing, 110.3(B))' });
    // #8 hots on a 60 A tub: undersized
    expect(judgeElecPick(task, tub60, swap(pick60, 'wire', 'THWN-8'))).toMatchObject({ ok: false, variant: 'undersized' });
  });

  it('stdPick passes receiving’s judge for every mechanic’s cause on every airplane of 30 islands', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s = island(5, seed);
      for (const sym of Object.values(SYMPTOMS).filter((x) => x.role === 'mech')) {
        sym.causes.forEach((c, ci) => {
          if (!c.fix) return;
          for (const asset of s.assets) {
            if (asset.kind === 'plane' ? !sym.models?.includes(planeModel(asset.model)) || (c.models && !c.models.includes(planeModel(asset.model))) : !sym.targets?.includes(asset.model)) continue;
            const task = taskOn(c.fix!, asset)!;
            const a: Alert = { id: 'x', role: 'mech', assetId: asset.id, sym: sym.key, src: sym.src, week: 6, due: 6, seed: seed * 17 + ci, kind: c.kind, cause: ci, status: 'open' };
            const pick = stdPick(s, asset, task, null, needsOf(s, a));
            for (const need of needsOf(s, a)) expect(pick.some((l) => l.slot === need), `${sym.key}#${ci} ${task.id} needs ${need}`).toBe(true);
            for (const l of pick) {
              const slot = task.main.find((m) => m.slot === l.slot);
              if (!slot?.ata || !slot.tag) continue;
              const v = judgeSlot(s, asset, slot.ata, slot.tag, l.item);
              const altered = !!plantFor(seed, asset.id, asset.model).plant;
              // the ICA part on an altered airplane with no EA on file is legal only after research: the bots plan it with research
              expect(v.ok, `${seed} ${asset.model} ${task.id} ${l.item}: ${v.text}`).toBe(true);
              if (v.unapproved) expect(altered).toBe(true);
            }
          }
        });
      }
    }
  });

  it('the protection a replaced receptacle needs (210.8(A), 210.12(A))', () => {
    expect(protectionNeeded({ room: 'kitchen', amps: 20, awg: 12 })).toEqual({ gfci: true, afci: true });
    expect(protectionNeeded({ room: 'bath', amps: 20, awg: 12 })).toEqual({ gfci: true, afci: false });
    expect(protectionNeeded({ room: 'bedroom', amps: 15, awg: 14 })).toEqual({ gfci: false, afci: true });
    expect(protectionNeeded({ room: 'bath', amps: 20, awg: 12, deviceRoom: 'hall' })).toEqual({ gfci: false, afci: true });
  });

  it('a site is derived from the alert’s seed: the same every time', () => {
    const s = island(5);
    const a: Alert = { id: 'x', role: 'elec', assetId: 'h1', sym: 'E_DEAD_OUTLET', src: 'guest', week: 6, due: 6, seed: 424242, kind: 'trip', cause: 0, status: 'open' };
    expect(siteOf(s, a)).toEqual(siteOf(structuredClone(s), { ...a }));
    expect(siteOf(s, { ...a, role: 'mech' })).toBeNull();
    const asset: Asset = assetFor(s, 'cottage');
    expect(asset.kind).toBe('house');
  });
});
