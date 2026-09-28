// Search (docs/JOBFLOW.md 6): the manual / reference task search, the
// airplane's IPC and the supply catalog; the teaching tiers' chips, marks and
// badges, which never recommend what receiving or the install would reject.
import { describe, expect, it } from 'vitest';
import { figuresFor } from '../src/sim/aircraft';
import { fixesOf, raiseAlert, SYMPTOMS } from '../src/sim/alerts';
import { islandAircraft, judgePart } from '../src/sim/chain';
import { MODELS, TIERS } from '../src/sim/data';
import { createIsland } from '../src/sim/engine';
import { judgeSlot, pickCheck, stdPickFor } from '../src/sim/flow';
import { complete, hintsFor, ipcIndex, likely, manualIndex, rowBadges, search, supplyIndex, tokenize } from '../src/sim/search';
import { taskById, TASKS, tasksFor } from '../src/sim/tasks';
import type { Asset, IslandState, OpsRole } from '../src/sim/types';

function island(tier: number, seed = 7): IslandState {
  const s = createIsland({ id: 't', name: 'T', now: 0, tz: 'UTC', seed, creator: { uid: 'm', name: 'Mia', role: 'mech' } });
  s.players.elec = { ...s.players.mech!, uid: 'e', name: 'Eli', role: 'elec' };
  for (let t = 2; t <= tier; t++)
    for (const a of TIERS[t - 1].adds) if (!s.assets.some((x) => x.id === a.id)) s.assets.push({ id: a.id, kind: MODELS[a.model].kind, model: a.model, name: a.name, health: 80, touchedWeek: 0 });
  s.tier = tier;
  s.week = 6;
  s.flowSince = 1;
  return s;
}

const ASSETS: { asset: Pick<Asset, 'kind' | 'model'>; role: OpsRole }[] = [
  { asset: { kind: 'plane', model: 'twin' }, role: 'mech' },
  { asset: { kind: 'plane', model: 'cargo' }, role: 'mech' },
  { asset: { kind: 'plane', model: 'float' }, role: 'mech' },
  { asset: { kind: 'generator', model: 'gen' }, role: 'mech' },
  { asset: { kind: 'house', model: 'cottage' }, role: 'elec' },
  { asset: { kind: 'grid', model: 'panel' }, role: 'elec' },
  { asset: { kind: 'generator', model: 'gen' }, role: 'elec' },
];

describe('tokens', () => {
  it('keeps a P/N whole, adds it without dashes, strips a plural', () => {
    expect(tokenize('066-19500 Linings, BRAKE')).toEqual(['066-19500', '06619500', '066', '19500', 'lining', 'brake']);
    expect(tokenize('O-rings')).toContain('o-ring');
    expect(tokenize('MS20995C32')).toEqual(['ms20995c32']);
  });
});

describe('the manual search', () => {
  it('every task is in the top 3 for its title', () => {
    for (const { asset, role } of ASSETS) {
      const ix = manualIndex(null, asset, role);
      for (const t of tasksFor(null, asset, role)) {
        const hits = search(ix, t.title, { limit: 3 }).map((h) => h.doc.id);
        expect(hits, `${asset.model} ${t.id}: "${t.title}"`).toContain(t.id);
      }
    }
  });

  it('synonyms: pads find the linings, gfi the GFCI, df the dual-function device, romex the NM-B', () => {
    const twin = manualIndex(null, { kind: 'plane', model: 'twin' }, 'mech');
    expect(search(twin, 'brake pads')[0].doc.id).toBe('amm:twin:32-40-02');
    expect(search(twin, 'alt belt')[0].doc.id).toBe('amm:twin:24-30-02');
    const house = manualIndex(null, { kind: 'house', model: 'cottage' }, 'elec');
    expect(search(house, 'gfi')[0].doc.id).toBe('ref:gfci');
    const elec = supplyIndex('elec');
    expect(search(elec, 'romex 12/2', { limit: 3 }).map((h) => h.doc.id)).toContain('NMB-12-2');
    expect(search(elec, 'df 20', { limit: 3 }).map((h) => h.doc.id)).toContain('KDF20-TR');
    expect(search(elec, 'gfi', { limit: 5 }).every((h) => /GFCI|ground-fault|dual/i.test(`${h.doc.title} ${h.doc.text}`))).toBe(true);
    const mech = supplyIndex('mech');
    expect(search(mech, 'brake pads', { limit: 5 }).some((h) => /LINING/.test(h.doc.title))).toBe(true);
  });

  it('autocomplete offers words first, P/Ns last', () => {
    const ix = supplyIndex('mech');
    const c = complete(ix, 'lin');
    expect(c[0]).toMatch(/^lin/);
    expect(complete(ix, 'l')).toEqual([]);
  });
});

describe('the IPC search', () => {
  it('every row is first for its exact P/N, with or without dashes, and in the top 5 for its nomenclature', () => {
    for (const seed of [7, 42, 1234]) {
      for (const [id, model] of [
        ['p1', 'twin'],
        ['p2', 'cargo'],
        ['p3', 'float'],
      ]) {
        const s = { seed, eas: [] };
        const ix = ipcIndex(s, { id, model });
        const ac = islandAircraft(seed, { id, model });
        for (const fig of figuresFor(ac)) {
          for (const row of fig.rows) {
            const first = search(ix, row.pn, { limit: 1 })[0];
            expect(first.doc.id.split('@')[0], `${model} ${row.pn}`).toBe(row.pn);
            const bare = search(ix, row.pn.replace(/-/g, ''), { limit: 1 })[0];
            expect(bare.doc.id.split('@')[0], `${model} ${row.pn} without dashes`).toBe(row.pn);
            if (!row.tag) continue;
            const top = search(ix, row.nomen, { limit: 5 }).map((h) => h.doc.title.replace(/^\S+ /, ''));
            expect(top, `${model} "${row.nomen}"`).toContain(row.nomen);
          }
        }
      }
    }
  });

  it('is deterministic, cached per airplane state, and fast', () => {
    const s = { seed: 99, eas: [] };
    const t0 = performance.now();
    const ix = ipcIndex(s, { id: 'p1', model: 'twin' });
    const built = performance.now() - t0;
    expect(ipcIndex(s, { id: 'p1', model: 'twin' })).toBe(ix);
    const a = search(ix, 'brake lining');
    const t1 = performance.now();
    const b = search(ix, 'brake lining');
    const took = performance.now() - t1;
    expect(b).toEqual(a);
    // an EA on file is another airplane state: its own index
    const withEa = ipcIndex({ seed: 99, eas: [{ assetId: 'p1', ata: '32-40', tag: 'lining', pn: 'KA-66-19HD', ea: 'EA 26-104', week: 3 }] }, { id: 'p1', model: 'twin' });
    expect(withEa).not.toBe(ix);
    expect(search(withEa, 'KA-66-19HD', { limit: 1 })[0].doc.ref.ea).toBe('EA 26-104');
    // CI runners are about 1.5 x slower than a developer machine; the airplane itself is built once per device
    expect(built).toBeLessThan(250);
    expect(took).toBeLessThan(6);
    const t2 = performance.now();
    ipcIndex({ seed: 99, eas: [] }, { id: 'p9', model: 'cargo' });
    islandAircraft(99, { id: 'p8', model: 'float' });
    const t3 = performance.now();
    ipcIndex({ seed: 99, eas: [] }, { id: 'p8', model: 'float' });
    expect(performance.now() - t3, 'index an airplane already built').toBeLessThan(60);
    expect(t3 - t2).toBeGreaterThan(0);
  });
});

describe('what each tier shows', () => {
  it('for every symptom x cause, the chips put a fixing task in the top 3 at tiers 0-2; nothing at tier 3+', () => {
    const s = island(5);
    for (const sym of Object.values(SYMPTOMS)) {
      if (sym.key === 'R_REPAIR') continue;
      sym.causes.forEach((c, ci) => {
        if (!c.fix) return;
        for (const asset of s.assets) {
          const fits = asset.kind === 'plane' ? sym.models?.includes(asset.model as never) && (!c.models || c.models.includes(asset.model as never)) : sym.targets?.includes(asset.model);
          if (!fits) continue;
          const a = raiseAlert(s, { role: sym.role, asset, sym: sym.key, cause: ci }, 0);
          const fix = fixesOf(s, a)[0];
          expect(fix).toBeTruthy();
          const ix = manualIndex(s, asset, sym.role);
          for (const tier of [0, 1, 2]) {
            const h = hintsFor(s, a, tier);
            expect(h.chips.length, `${sym.key}#${ci}`).toBeGreaterThan(0);
            const any = h.chips.some((chip) => search(ix, chip, { limit: 3 }).some((x) => x.doc.id === fix));
            expect(any, `${sym.key}#${ci} on ${asset.model}: chips ${h.chips.join(', ')} miss ${fix}`).toBe(true);
            expect(h.tasks).toEqual(tier <= 1 ? [fix] : []);
            expect(likely(s, a, fix, tier)).toBe(tier <= 1);
          }
          expect(hintsFor(s, a, 3)).toEqual({ chips: [], tasks: [], items: [] });
          s.alerts = [];
        }
      });
    }
  });

  it('no tier 0-1 badge, likely row or pick recommends a P/N that receiving rejects (every figure row x airplane of three islands)', () => {
    for (const seed of [7, 42, 1234]) {
      const s = island(5, seed);
      for (const asset of s.assets.filter((a) => a.kind === 'plane')) {
        const ac = islandAircraft(seed, asset);
        const ix = ipcIndex(s, asset);
        for (const d of ix.docs) {
          for (const tier of [0, 1]) {
            const badges = rowBadges(s, asset, d, tier);
            const pn = d.id.split('@')[0];
            const good = badges.some((b) => /^◀ this airplane|legal alternate|legal replacement|approved for this airplane/.test(b));
            if (good) {
              const v = judgeSlot(s, asset, d.ref.ata!, d.ref.tag!, pn);
              expect(v.ok && !v.unapproved, `${seed} ${asset.model} ${pn}: ${badges.join(' | ')} but ${v.text}`).toBe(true);
              if (!ac.plant || ac.plant.via === 'pma' || ac.plant.ata !== d.ref.ata) if (!d.ref.pma) expect(judgePart({ ...ac, plant: undefined }, d.ref.ata as never, d.ref.tag!, pn).ok).toBe(true);
            }
            for (const b of badges) {
              const next = /^SUPSD: order (\S+)/.exec(b)?.[1];
              if (next) expect(judgeSlot(s, asset, d.ref.ata!, d.ref.tag!, next).ok, `${seed} ${asset.model} ${pn} -> ${next}`).toBe(true);
            }
          }
          // tier 3+: only what the book prints
          expect(rowBadges(s, asset, d, 3).some((b) => /◀ this airplane|legal|Research|not effective/.test(b))).toBe(false);
        }
        // the likely rows (tier 0-1 hints) and the right pick pass receiving and raise no warning
        for (const sym of Object.values(SYMPTOMS).filter((x) => x.role === 'mech' && x.models?.includes(asset.model as never))) {
          sym.causes.forEach((c, ci) => {
            if (!c.fix || (c.models && !c.models.includes(asset.model as never))) return;
            const a = raiseAlert(s, { role: 'mech', asset, sym: sym.key, cause: ci }, 0);
            const task = taskById(fixesOf(s, a)[0])!;
            const pick = stdPickFor(s, a, task);
            expect(hintsFor(s, a, 1).items).toEqual(pick.map((l) => l.item));
            for (const l of pick) {
              const slot = task.main.find((m) => m.slot === l.slot);
              if (!slot?.ata || !slot.tag) continue;
              expect(judgeSlot(s, asset, slot.ata, slot.tag, l.item).ok).toBe(true);
            }
            const warn = pickCheck(s, a, task, pick, 1);
            // the only warning the right pick can carry: an ICA part with no engineering authorization (research first)
            for (const w of warn) expect(w, `${seed} ${asset.model} ${task.id}`).toMatch(/research the records/);
            s.alerts = [];
          });
        }
      }
    }
  });

  it('pickCheck warns about a part that isn’t effective and a short quantity at tiers 0-1, and says nothing at tier 2+', () => {
    const s = island(1, 7);
    const twin = s.assets.find((a) => a.model === 'twin')!;
    const a = raiseAlert(s, { role: 'mech', asset: twin, sym: 'M_BRAKE_CHATTER', cause: 0 }, 0);
    const task = taskById('amm:twin:32-40-02')!;
    const right = stdPickFor(s, a, task);
    expect(right[0].qty).toBe(4);
    expect(pickCheck(s, a, task, right, 1)).toEqual([]);
    const short = [{ ...right[0], qty: 2 }];
    expect(pickCheck(s, a, task, short, 1).join(' ')).toMatch(/4 needed/);
    expect(pickCheck(s, a, task, short, 2)).toEqual([]);
    // the other lining (the code-3 SB set, or the pre-SB one) is a near-miss on this airplane
    const other = right[0].item === '066-19500' ? '066-19600' : '066-19500';
    expect(pickCheck(s, a, task, [{ item: other, qty: 4, slot: 'lining' }], 0).length).toBeGreaterThan(0);
  });

  it('the task list covers what the Manual step searches, for each trade', () => {
    expect(TASKS.filter((t) => t.trade === 'elec').every((t) => t.book === 'REF')).toBe(true);
    expect(manualIndex(null, { kind: 'house', model: 'villa' }, 'elec').docs.length).toBe(tasksFor(null, { kind: 'house', model: 'villa' }, 'elec').length);
  });
});
