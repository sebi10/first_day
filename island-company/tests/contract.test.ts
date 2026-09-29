// The stage-2 contract (docs/EXPANSION.md 14.3): every symbol packages B (the map)
// and C (the objects) build on, imported here so a rename breaks the typecheck, and
// run on docs the live builds wrote: each returns home-only or empty values, and
// none throws. Stage 3's symbols (stations.ts, network.ts, D's sheets) are A2's.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CHECK, canCheck, checkKindFor, checkTruth, checkView, type CheckItem, type CheckKind, type CheckView } from '../src/sim/checks';
import { migrate } from '../src/sim/migrate';
import { cloneState } from '../src/sim/engine';
import { ROLES, type IslandState, type OpsRole, type Role } from '../src/sim/types';
import { openDm } from '../src/ui/crewboard';
import { InspectSheet } from '../src/ui/inspect/InspectSheet';
import { whatsNewMapPanels } from '../src/ui/inspect/WhatsNewMap';
import { MapView } from '../src/ui/map/MapView';
import { ASSET_KINDS, FIXTURE_KINDS, HOME, OBJECT_LABEL, assetRef, ownerOf, type ObjectKind, type ObjectRef, type StationId } from '../src/ui/objects';
import { assetPnl, fixtureFacts, flaggable, openAlertsOn, openTarget, takeDeskAsked, takeDeskAt, type DockTarget } from '../src/ui/select';
import { WhatsNew } from '../src/ui/whatsnew';

vi.setConfig({ testTimeout: 30000 });

const dir = resolve(import.meta.dirname, 'fixtures');
const FIXTURES = readdirSync(dir).filter((f) => f.startsWith('v3-bd1e1d2-') && f.endsWith('.json'));
const load = (f: string): IslandState => migrate(JSON.parse(readFileSync(resolve(dir, f), 'utf8')) as IslandState);

describe('the stage-2 contract (14.3)', () => {
  it('every symbol is there with its shape', () => {
    const kinds: CheckKind[] = ['walkaround', 'ir', 'meter'];
    expect(kinds).toHaveLength(3);
    expect(CHECK).toMatchObject({ detect: expect.any(Number), depth: expect.any(Number), minShow: expect.any(Number), fromTier: 2 });
    for (const f of [canCheck, checkKindFor, checkTruth, checkView, assetPnl, fixtureFacts, flaggable, openAlertsOn, openDm, ownerOf, MapView, InspectSheet, WhatsNew, whatsNewMapPanels]) expect(typeof f).toBe('function');
    // every object kind has its label
    const all: ObjectKind[] = ['plane', 'house', 'grid', 'generator', 'hangar', 'office', 'runway', 'fuel', 'estop', 'dock', 'windsock', 'terminal', 'cart', 'staff', 'site', 'station', 'route'];
    for (const k of all) expect(OBJECT_LABEL[k].length).toBeGreaterThan(1);
    expect(Object.keys(OBJECT_LABEL).sort()).toEqual([...all].sort());
    const ref: ObjectRef = { kind: 'plane', id: 'p1', st: HOME };
    const st: StationId = ref.st;
    expect(st).toBe('home');
    const t: DockTarget = { object: ref };
    expect('object' in t).toBe(true);
    // shapes C reads
    const item: CheckItem = { id: 'x', label: 'L', text: 'T', reading: { riseC: 1, loadPct: 2, amps: 3, volts: 4, runFt: 5, tooLight: true } };
    const view: CheckView = { kind: 'ir', assetId: 'g1', items: [item], help: [], ppe: 'p' };
    expect(view.items[0].id).toBe('x');
  });

  it('ownerOf: planes the mechanic, houses and the grid the electrician, the generator both', () => {
    expect(ownerOf({ kind: 'plane' })).toBe('mech');
    expect(ownerOf({ kind: 'house' })).toBe('elec');
    expect(ownerOf({ kind: 'grid' })).toBe('elec');
    expect(ownerOf({ kind: 'generator' })).toBe('both');
  });

  it('openDm and openTarget({ object }) send their events (home and the crew board listen)', () => {
    const seen: { type: string; detail: unknown }[] = [];
    const w = globalThis as unknown as { window?: unknown };
    const had = w.window;
    w.window = { dispatchEvent: (e: CustomEvent) => seen.push({ type: e.type, detail: e.detail }) };
    try {
      openDm('elec', 'About the hangar: ');
      openTarget({ object: { kind: 'hangar', id: 'hangar', st: HOME } });
      // the sheets' Pricing and Hiring board links: a desk tab and a section of it, kept for a desk still loading
      openTarget({ desk: 'money', at: 'pricing' });
      expect([takeDeskAsked(), takeDeskAt()]).toEqual(['money', 'pricing']);
      expect([takeDeskAsked(), takeDeskAt()]).toEqual([null, null]);
      openTarget({ desk: 'staff' });
      expect([takeDeskAsked(), takeDeskAt()]).toEqual(['staff', null]);
    } finally {
      w.window = had;
    }
    expect(seen).toEqual([
      { type: 'ic:dm', detail: { role: 'elec', prefill: 'About the hangar: ' } },
      { type: 'ic:open', detail: { object: { kind: 'hangar', id: 'hangar', st: 'home' } } },
      { type: 'ic:open', detail: { desk: 'money', at: 'pricing' } },
      { type: 'ic:open', detail: { desk: 'staff' } },
    ]);
  });

  for (const f of FIXTURES) {
    it(`${f}: every stage-2 selector runs on a doc the live build wrote, home only, and none throws`, () => {
      const s = load(f);
      const before = JSON.stringify(s);
      for (const a of s.assets) {
        const ref = assetRef(a);
        expect(ref.st).toBe('home');
        expect(ASSET_KINDS).toContain(ref.kind);
        const n = openAlertsOn(s, a.id);
        expect(n.mech + n.elec).toBeGreaterThanOrEqual(0);
        const p = assetPnl(s, a.id, 13);
        for (const v of [p.revenue, p.parts, p.labour]) expect(Number.isFinite(v) && v >= 0).toBe(true);
        for (const role of ROLES) {
          const fl = flaggable(s, role, a.id);
          expect(fl.ok || fl.why.length > 0).toBe(true);
          if (role === 'fin') continue;
          const r = role as OpsRole;
          const k = checkKindFor(s, r, a);
          const v = checkView(s, r, a.id);
          expect(v === null).toBe(k === null);
          if (v) {
            expect(v.items.length).toBeGreaterThan(0);
            for (const i of v.items) expect(i.label.length && i.text.length).toBeTruthy();
          }
          const c = canCheck(s, r, a.id);
          expect(c.ok || c.why.length > 0).toBe(true);
        }
      }
      for (const kind of FIXTURE_KINDS)
        for (const role of ROLES as Role[]) {
          expect(Array.isArray(fixtureFacts(s, kind, HOME, role).lines)).toBe(true);
          // a station: nothing yet (stage 3)
          expect(fixtureFacts(s, kind, 'tern', role).lines).toEqual([]);
        }
      // stage 2's What's new (C's panels): every seat gets at least the map's panel, each with a title and a body
      for (const role of ROLES as Role[]) {
        const panels = whatsNewMapPanels(s, role);
        expect(panels.length).toBeGreaterThan(0);
        for (const p of panels) {
          expect(typeof p.title === 'string' && p.title.length > 0).toBe(true);
          expect(p.body).toBeTruthy();
        }
      }
      // reading never writes
      expect(JSON.stringify(s)).toBe(before);
      // nothing stage 2 on the live docs
      expect(s.checked).toBeUndefined();
      expect(s.flagged).toBeUndefined();
      expect(JSON.stringify(migrate(cloneState(s)))).toBe(before);
    });
  }
});
