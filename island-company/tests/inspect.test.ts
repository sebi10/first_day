// The inspect sheets (docs/EXPANSION.md 6.2-6.5, 9.2, 13.3; package C): what each
// seat sees on every object and the moves it makes there, the three quick checks'
// screens, Report a problem, What's new. The facts are a pure model (facts.ts); the
// sheets are Preact components, mounted here on a small DOM of this file's own.
//
// - facts for every object kind x seat on a tier-1 island, a tier-5 one the paper
//   crew played, and the docs the live build wrote: they never read hidden state
//   (the same with the defects, the no-fault flags, the early flags and the cable
//   wear changed; no alert's hidden finding in any line)
// - every sheet renders; each move dispatches its action (the analyst's approve,
//   setRates and hire among them)
// - the walkaround shows every zone in one view and makes its call in 3 taps; the IR
//   scan its PPE line, ratings, conductors, loads and rises, "too light to judge" and
//   its help; the meter check its circuits with their volts and run lengths
// - Report a problem: 2 taps; the one-received cap's words and the DM with its message started
// - the keyboard: every move is a button (Tab reaches it); Esc closes the sheet
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { alertShort, findingOf, liveAlerts, raiseAlert, SYMPTOMS } from '../src/sim/alerts';
import { botTurn, TEAMS, type Team } from '../src/sim/bots';
import { CHECK_ROWS, checkRowKey } from '../src/sim/checkdata';
import { checkView, type CheckView } from '../src/sim/checks';
import { TIERS } from '../src/sim/data';
import { apply, createIsland } from '../src/sim/engine';
import { gseCarts } from '../src/sim/econ';
import { fixTaskFor, stdPickFor } from '../src/sim/flow';
import { migrate } from '../src/sim/migrate';
import { hashSeed, rng } from '../src/sim/rng';
import { crewOf, staffEffect } from '../src/sim/staff';
import { addStarter } from '../src/sim/stock';
import { ROLES, type Action, type Alert, type IslandState, type OpsRole, type Role } from '../src/sim/types';
import { facts, factsText, type Facts } from '../src/ui/inspect/facts';
import { inspectLabel } from '../src/ui/select';
import { InspectBody } from '../src/ui/inspect/Inspect';
import { InspectSheet } from '../src/ui/inspect/InspectSheet';
import { IrScan } from '../src/ui/inspect/IrScan';
import { MeterCheck } from '../src/ui/inspect/MeterCheck';
import { Walkaround } from '../src/ui/inspect/Walkaround';
import { whatsNewMapPanels } from '../src/ui/inspect/WhatsNewMap';
import { assetRef, FIXTURE_KINDS, fixtureRef, HOME, type ObjectKind, type ObjectRef } from '../src/ui/objects';
import { settings } from '../src/ui/settings';
import type { Ctl } from '../src/ui/useIsland';

vi.setConfig({ testTimeout: 30000 });

// ---------------------------------------------------------------------------
// A small DOM, enough for Preact to mount and patch the sheets and for a click to bubble

type Listener = { f: (e: Ev) => void; capture: boolean };
type Ev = { type: string; target: Node_; currentTarget: Node_ | null; key?: string; detail?: unknown; defaultPrevented: boolean; preventDefault(): void; stopPropagation(): void; _stop?: boolean };
const XHTML = 'http://www.w3.org/1999/xhtml';

class Node_ {
  parentNode: El | null = null;
  childNodes: Node_[] = [];
  nodeType = 1;
  get firstChild() {
    return this.childNodes[0] ?? null;
  }
  get nextSibling(): Node_ | null {
    const p = this.parentNode;
    if (!p) return null;
    return p.childNodes[p.childNodes.indexOf(this) + 1] ?? null;
  }
  get textContent(): string {
    return this.childNodes.map((c) => c.textContent).join('');
  }
}
class Text_ extends Node_ {
  nodeType = 3;
  constructor(public data: string) {
    super();
  }
  get textContent() {
    return String(this.data);
  }
}
const EVENTS = ['onclick', 'onkeydown', 'oninput', 'onchange', 'onpointerdown', 'onpointerup', 'onfocus', 'onblur', 'onsubmit', 'ontoggle'];
class El extends Node_ {
  attrs = new Map<string, string>();
  listeners = new Map<string, Listener[]>();
  style: Record<string, string> & { setProperty(k: string, v: string): void; cssText: string } = Object.assign(Object.create(null), {
    cssText: '',
    setProperty(this: Record<string, string>, k: string, v: string) {
      this[k] = v;
    },
  });
  value = '';
  constructor(
    public localName: string,
    public namespaceURI = XHTML,
  ) {
    super();
    for (const e of EVENTS) (this as unknown as Record<string, null>)[e] = null;
  }
  get tagName() {
    return this.localName.toUpperCase();
  }
  get disabled() {
    return this.attrs.has('disabled');
  }
  set disabled(v: boolean) {
    if (v) this.attrs.set('disabled', '');
    else this.attrs.delete('disabled');
  }
  insertBefore(n: Node_, ref: Node_ | null) {
    if (n.parentNode) n.parentNode.removeChild(n);
    n.parentNode = this;
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(n);
    else this.childNodes.splice(i, 0, n);
    return n;
  }
  appendChild(n: Node_) {
    return this.insertBefore(n, null);
  }
  removeChild(n: Node_) {
    this.childNodes = this.childNodes.filter((c) => c !== n);
    n.parentNode = null;
    return n;
  }
  remove() {
    this.parentNode?.removeChild(this);
  }
  setAttribute(k: string, v: unknown) {
    this.attrs.set(k, String(v));
  }
  getAttribute(k: string) {
    return this.attrs.get(k) ?? null;
  }
  removeAttribute(k: string) {
    this.attrs.delete(k);
  }
  hasAttribute(k: string) {
    return this.attrs.has(k);
  }
  addEventListener(type: string, f: (e: Ev) => void, capture?: boolean) {
    (this.listeners.get(type) ?? this.listeners.set(type, []).get(type)!).push({ f, capture: !!capture });
  }
  removeEventListener(type: string, f: (e: Ev) => void) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((l) => l.f !== f),
    );
  }
  focus() {}
  blur() {}
  scrollIntoView() {}
  scrollTo() {}
  getBoundingClientRect() {
    return { top: 0, left: 0, width: 390, height: 40, right: 390, bottom: 40 };
  }
}

/** inside a disabled button (a click there goes nowhere, as in a browser) */
function inDisabled(el: El): boolean {
  for (let n: El | null = el; n; n = n.parentNode) if (n.localName === 'button' && n.disabled) return true;
  return false;
}

/** a click (or any event) on `el`, bubbling up; a disabled button takes none */
function fire(el: El, type = 'click', init: Partial<Ev> = {}) {
  if (type === 'click' && inDisabled(el)) return;
  const ev: Ev = {
    type,
    target: el,
    currentTarget: null,
    defaultPrevented: false,
    ...init,
    preventDefault() {
      ev.defaultPrevented = true;
    },
    stopPropagation() {
      ev._stop = true;
    },
  };
  for (let n: El | null = el; n && !ev._stop; n = n.parentNode) {
    ev.currentTarget = n;
    for (const l of [...(n.listeners.get(type) ?? [])]) l.f.call(n, ev);
  }
}

const walk = (n: Node_, out: El[] = []): El[] => {
  for (const c of n.childNodes) if (c instanceof El) out.push(c), walk(c, out);
  return out;
};
const textOf = (n: Node_) => n.textContent.replace(/\s+/g, ' ').trim();
const buttons = (root: El) => walk(root).filter((e) => e.localName === 'button');
/** the first button whose text (or aria-label) includes `t` */
function button(root: El, t: string | RegExp): El {
  const b = buttons(root).find((e) => {
    const s = `${textOf(e)} ${e.getAttribute('aria-label') ?? ''}`;
    return typeof t === 'string' ? s.includes(t) : t.test(s);
  });
  if (!b) throw new Error(`no button "${t}" in: ${buttons(root).map(textOf).join(' | ')}`);
  return b;
}
const hasButton = (root: El, t: string) => buttons(root).some((e) => `${textOf(e)} ${e.getAttribute('aria-label') ?? ''}`.includes(t));

// the globals the sheets reach for: document, window's events, storage, a frame
const saved: Record<string, unknown> = {};
const winEvents = new EventTarget();
const docEvents = new EventTarget();
const store = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, String(v)), removeItem: (k: string) => void m.delete(k), clear: () => m.clear() };
};
beforeAll(() => {
  const g = globalThis as Record<string, unknown>;
  for (const k of ['document', 'window', 'localStorage', 'sessionStorage', 'requestAnimationFrame']) saved[k] = g[k];
  g.document = {
    createElement: (t: string) => new El(t),
    createElementNS: (ns: string, t: string) => new El(t, ns),
    createTextNode: (t: string) => new Text_(t),
    addEventListener: docEvents.addEventListener.bind(docEvents),
    removeEventListener: docEvents.removeEventListener.bind(docEvents),
    dispatchEvent: docEvents.dispatchEvent.bind(docEvents),
    getElementById: () => null,
  };
  g.window = Object.assign(Object.create(globalThis), {
    addEventListener: winEvents.addEventListener.bind(winEvents),
    removeEventListener: winEvents.removeEventListener.bind(winEvents),
    dispatchEvent: winEvents.dispatchEvent.bind(winEvents),
    setTimeout,
    clearTimeout,
    scrollTo() {},
  });
  g.localStorage = store();
  g.sessionStorage = store();
  g.requestAnimationFrame = (f: () => void) => setTimeout(f, 0);
  settings.set({ haptics: false, sound: false });
});
afterAll(() => {
  const g = globalThis as Record<string, unknown>;
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete g[k];
    else g[k] = v;
  }
});

/** the events the sheet sends to the rest of Home (openTarget, openDm) */
function listen(): { seen: { type: string; detail: unknown }[]; stop(): void } {
  const seen: { type: string; detail: unknown }[] = [];
  const on = (e: Event) => seen.push({ type: e.type, detail: (e as CustomEvent).detail });
  for (const t of ['ic:open', 'ic:dm', 'ic:flow']) winEvents.addEventListener(t, on);
  return { seen, stop: () => ['ic:open', 'ic:dm', 'ic:flow'].forEach((t) => winEvents.removeEventListener(t, on)) };
}

type Mounted = { root: El; calls: Action[]; closed: () => number; rerender(s?: IslandState): Promise<void>; unmount(): void };
/** InspectSheet on `ref` for `role`, with a ctl that records what it dispatches (and applies it, so the sheet moves on) */
async function mount(s0: IslandState, role: Role, ref: ObjectRef): Promise<Mounted> {
  const root = new El('div');
  const calls: Action[] = [];
  let closes = 0;
  let s = s0;
  const ctl = (): Ctl => ({
    s,
    ref: { id: s.id, mode: 'local', passAndPlay: true, role } as unknown as Ctl['ref'],
    uid: null,
    role,
    sync: { online: true, queued: 0 } as unknown as Ctl['sync'],
    async dispatch(a: Action) {
      calls.push(a);
      const r = apply(s, a, NOW + calls.length);
      if (r.error) return false;
      s = r.s;
      await draw();
      return true;
    },
  });
  const onClose = () => void closes++;
  const draw = () => act(() => render(h(InspectBody, { s, ctl: ctl(), role, target: ref, onClose }), root as unknown as Element));
  await draw();
  return {
    root,
    calls,
    closed: () => closes,
    async rerender(next?: IslandState) {
      if (next) s = next;
      await draw();
    },
    unmount: () => render(null, root as unknown as Element),
  };
}
const click = async (el: El) => act(async () => fire(el));

// ---------------------------------------------------------------------------
// Islands

const NOW = Date.UTC(2026, 8, 28, 10);

/** a started island: the three seats, week `week` at `tier`, every tier's buildings up to it at `health` */
function island(week = 5, tier = 2, health = 70, seed = 7): IslandState {
  let s = createIsland({ id: `in${week}${tier}${seed}`, name: 'Inspect Isle', now: NOW, tz: 'Europe/Paris', seed, creator: { uid: 'a', name: 'Ana', role: 'mech' } });
  s = apply(s, { t: 'join', uid: 'b', name: 'Ben', role: 'elec' }, NOW).s;
  s = apply(s, { t: 'join', uid: 'c', name: 'Cy', role: 'fin' }, NOW).s;
  for (const r of ROLES) s = apply(s, { t: 'week0Done', role: r }, NOW).s;
  s.week = week;
  s.tier = tier;
  s.cash = 30000;
  for (const t of TIERS.slice(1, tier))
    for (const a of t.adds)
      if (!s.assets.some((x) => x.id === a.id))
        s.assets.push({ id: a.id, kind: a.model === 'gen' ? 'generator' : ['twin', 'cargo', 'float'].includes(a.model) ? 'plane' : 'house', model: a.model, name: a.name, health, touchedWeek: 0 });
  addStarter(s, tier);
  for (const a of s.assets) {
    a.health = health;
    if (a.kind === 'house') a.inspectionUntil = week + 8;
    if (a.kind === 'plane') a.sinceInspection = 3;
  }
  s.orders = [];
  s.alerts = [];
  for (const p of Object.values(s.players)) if (p) p.graceUntil = 0;
  return s;
}

/** the paper crew plays a season until the Resort (tier 5): staff, builds, alerts, ledger, the lot */
function played(): IslandState {
  const t = TEAMS['three friends'];
  const crew: Team = { mech: { ...t.mech, miss: 0, checks: false, flags: false }, elec: { ...t.elec, miss: 0, checks: false, flags: false }, fin: { ...t.fin, miss: 0, checks: false, flags: false } };
  let now = NOW;
  let s = createIsland({ id: 'inplay', name: 'Played Isle', now, tz: 'Europe/Paris', seed: hashSeed('inspect', 1), creator: { uid: 'a', name: 'Ana', role: 'mech' } });
  s = apply(s, { t: 'join', uid: 'b', name: 'Ben', role: 'elec' }, now).s;
  s = apply(s, { t: 'join', uid: 'c', name: 'Cy', role: 'fin' }, now).s;
  for (const r of ROLES) s = apply(s, { t: 'week0Done', role: r }, now).s;
  for (let w = 0; w < 30 && s.tier < 5; w++) {
    const W = s.week;
    for (const role of ROLES) {
      s = botTurn(s, role, crew[role], rng(hashSeed('inspect', role, W)), now);
      s = apply(s, { t: 'endTurn', role, week: W }, now).s;
      now += 60_000;
    }
    if (s.week === W) s = apply(s, { t: 'resolve', week: W }, (s.deadline ?? now) + 1000).s;
    now = (s.deadline ?? now) - 86400_000;
  }
  return s;
}

const dir = resolve(import.meta.dirname, 'fixtures');
// the live builds' docs as the app shows them (migrated): the job flow's (bd1e1d2, v3) and stage 1's (e810cc5, v4)
const LIVE = readdirSync(dir)
  .filter((f) => (f.startsWith('v3-bd1e1d2-') || f.startsWith('v4-e810cc5-')) && f.endsWith('.json'))
  .map((f) => migrate(JSON.parse(readFileSync(resolve(dir, f), 'utf8')) as IslandState));

/** every object on the island as the map would send it (the station and route refs are stage 3's) */
function refs(s: IslandState): ObjectRef[] {
  return [
    ...s.assets.map(assetRef),
    ...FIXTURE_KINDS.map((k) => fixtureRef(k)),
    ...gseCarts(s).map((c) => ({ kind: 'cart' as ObjectKind, id: c.id, st: HOME })),
    ...crewOf(s).map((n) => ({ kind: 'staff' as ObjectKind, id: n.id, st: HOME })),
    { kind: 'site', id: 'project', st: HOME },
    ...(s.builds ?? []).map((b) => ({ kind: 'site' as ObjectKind, id: b.id, st: HOME })),
    { kind: 'station', id: 'zz', st: 'zz' },
    { kind: 'route', id: 'home-zz', st: HOME },
  ];
}

/** the same island with every hidden thing changed: defects, the no-fault flags, the early flags, the cables' wear */
function perturbed(s: IslandState): IslandState {
  const d = structuredClone(s);
  d.defects = [
    ...(d.defects ?? []).slice(1),
    ...d.assets.map((a, i) => ({ id: `dx${i}`, orderKind: 'tires', job: 'tires', log: 'SECRET defect log', puzzle: 'torque' as const, title: 'SECRET job', assetId: a.id, role: (a.kind === 'plane' ? 'mech' : 'elec') as Role, by: 'mech' as Role, name: 'Ana', week: 1, dueWeek: 99, severity: 1 as const, cost: 100, tier: 1, gain: 5, redo: false })),
  ];
  for (const a of d.alerts ?? []) {
    a.looksNff = !a.looksNff;
    // an early catch prices a planned card a tier lower (the card shows its price): flip it only where nothing's planned
    if (!a.order) a.early ? delete a.early : (a.early = true);
  }
  for (const c of d.gse ?? []) c.wear = (c.wear + 47) % 100;
  return d;
}

// ---------------------------------------------------------------------------

describe('facts: every object kind x every seat (6.3, 13.3)', () => {
  const t1 = island(1, 1);
  const t5 = played();
  const states: [string, IslandState][] = [['tier 1', t1], ['tier 5, played', t5], ...LIVE.map((s, i): [string, IslandState] => [`live doc ${i}`, s])];

  it('the played island is at the Resort with its staff, builds and alerts (the fixture is what it says)', () => {
    expect(t5.tier).toBe(5);
    expect(t5.assets.map((a) => a.kind)).toEqual(expect.arrayContaining(['plane', 'house', 'grid', 'generator']));
    expect((t5.staff ?? []).length).toBeGreaterThan(3);
  });

  for (const [name, s] of states)
    it(`${name}: every sheet's facts, and none reads hidden state`, () => {
      const hidden = perturbed(s);
      const findings = liveAlerts(s)
        .filter((a) => a.cause >= 0 || a.looksNff)
        .map((a) => findingOf(s, a, 5).text)
        .filter((t) => t.length > 12);
      for (const ref of refs(s))
        for (const role of ROLES) {
          const f: Facts = facts(s, ref, role);
          expect(f.name.length, `${ref.kind}:${ref.id}`).toBeGreaterThan(1);
          expect(f.status.length).toBeGreaterThan(1);
          const text = factsText(f);
          // the same with every hidden thing changed
          expect(factsText(facts(hidden, ref, role)), `${ref.kind}:${ref.id} as ${role}`).toBe(text);
          expect(text).not.toContain('SECRET');
          for (const fnd of findings) expect(text, `${ref.kind}:${ref.id} as ${role}`).not.toContain(fnd);
          // the check is only the techs', only on what they check
          if (role === 'fin') expect(f.primary?.t).not.toBe('check');
        }
    });

  it("the sheet's dialog name (home.tsx: select.ts inspectLabel, in Home's chunk) is its header's name, for every object", () => {
    for (const [, s] of states)
      for (const ref of refs(s)) {
        if (ref.kind === 'station' || ref.kind === 'route') continue;
        expect(inspectLabel(s, ref), `${ref.kind}:${ref.id}`).toBe(facts(s, ref, 'fin').name);
      }
  });

  it('each seat sees what it cares about on the same plane, house and grid', () => {
    const s = island(6, 3);
    const plane = (r: Role) => facts(s, assetRef(s.assets.find((a) => a.id === 'p1')!), r);
    expect(factsText(plane('mech'))).toMatch(/100-hr inspection in about \d+ h/);
    expect(plane('mech').blocks.map((b) => b.t)).toEqual(expect.arrayContaining(['plate', 'log']));
    expect(plane('mech').primary).toMatchObject({ t: 'check', kind: 'walkaround' });
    expect(factsText(plane('elec'))).toMatch(/No electrical check asked of you/);
    expect(factsText(plane('fin'))).toMatch(/Repairs over 13 weeks|No repair spend/);
    expect(factsText(plane('fin'))).toMatch(/guests and tours ride on it/);
    const house = (r: Role) => facts(s, assetRef(s.assets.find((a) => a.id === 'h1')!), r);
    expect(house('elec').primary).toMatchObject({ t: 'check', kind: 'meter' });
    expect(house('elec').blocks.find((b) => b.t === 'schedule')).toBeTruthy();
    expect(factsText(house('elec'))).toMatch(/GFCI \+ AFCI/);
    expect(house('fin').primary).toMatchObject({ t: 'rates' });
    expect(factsText(house('mech'))).toMatch(/Booked|Empty|Closed/);
    const grid = (r: Role) => facts(s, assetRef(s.assets.find((a) => a.id === 'g1')!), r);
    expect(grid('elec').primary).toMatchObject({ t: 'check', kind: 'ir' });
    expect(factsText(grid('fin'))).toMatch(/of rent/);
    expect(factsText(grid('mech'))).toMatch(/hangar tools/i);
    const gen = (r: Role) => facts(s, assetRef(s.assets.find((a) => a.id === 'gen')!), r);
    expect(gen('mech').primary).toMatchObject({ t: 'check', kind: 'walkaround' });
    expect(gen('elec').primary).toMatchObject({ t: 'check', kind: 'ir' });
    expect(factsText(gen('elec'))).toMatch(/Transfer switch 60 A/);
    // the generator is both techs': each writes it up, neither flags it; the analyst can
    expect(gen('mech').report).toMatchObject({ t: 'own' });
    expect(gen('elec').report).toMatchObject({ t: 'own' });
    expect(gen('fin').report?.t).toBe('flag');
    // the analyst's desk links, the hangar's ground power for the mechanic
    expect(facts(s, fixtureRef('hangar'), 'fin').primary).toMatchObject({ t: 'desk', desk: 'stock' });
    expect(facts(s, fixtureRef('office'), 'fin').primary).toMatchObject({ t: 'desk', desk: 'approvals' });
    expect(facts(s, fixtureRef('hangar'), 'mech').primary).toMatchObject({ t: 'gse', cart: null });
  });

  it('checks from tier 2, flags from week 3: the sheet says why not before then', () => {
    const s = island(2, 1);
    const p = facts(s, assetRef(s.assets.find((a) => a.id === 'p1')!), 'mech');
    // (review round 1) no disabled footer at tier 1: one line says when the check comes
    expect(p.primary).toBeNull();
    expect(p.lines.map((l) => l.text)).toContain('The walkaround (one quick check a week) opens at tier 2.');
    const h = facts(s, assetRef(s.assets.find((a) => a.id === 'h1')!), 'fin');
    expect(h.report).toMatchObject({ t: 'flag', ok: false, why: 'Report a problem opens in week 3.' });
  });
});

describe('the sheets render and their moves dispatch (6.2, 9.2)', () => {
  it("home's InspectSheet loads the body as its own chunk, then shows the object", async () => {
    const s = island(6, 3);
    const root = new El('div');
    const props = { s, ctl: { s, dispatch: async () => true } as unknown as Ctl, role: 'mech' as Role, target: assetRef(s.assets.find((a) => a.id === 'p1')!), onClose: () => undefined };
    await act(() => render(h(InspectSheet, props), root as unknown as Element));
    for (let i = 0; i < 20 && !textOf(root).includes('Twin N-12'); i++) await act(async () => void (await new Promise((r) => setTimeout(r, 5))));
    expect(textOf(root)).toContain('Twin N-12');
    expect(textOf(root)).toContain('Walkaround');
    render(null, root as unknown as Element);
  });

  it('every object kind x seat renders on a played island, with its name and status', async () => {
    const s = played();
    for (const ref of refs(s))
      for (const role of ROLES) {
        const m = await mount(s, role, ref);
        const f = facts(s, ref, role);
        if (ref.kind !== 'cart') expect(textOf(m.root), `${ref.kind}:${ref.id} as ${role}`).toContain(f.name);
        else expect(textOf(m.root)).toContain('Ground power');
        m.unmount();
      }
  });

  it("the analyst's inline moves: approve a plane's card, step the nightly rate, hire from a staff figure", async () => {
    // a card: the oil change, all on the shelf, the mechanic's work budget spent
    let s = island(6, 3);
    s.autoSpent.mech = s.autoBudget.mech - 10;
    const p1 = s.assets.find((a) => a.id === 'p1')!;
    const al = raiseAlert(s, { role: 'mech', asset: p1, sym: 'M_OIL_DUE', cause: 0 }, NOW);
    const task = fixTaskFor(s, al)!;
    s = apply(s, { t: 'plan', role: 'mech', alert: al.id, task: task.id, pick: stdPickFor(s, al, task), week: s.week }, NOW).s;
    const card = s.orders.find((o) => o.flow?.alert === al.id)!;
    expect(card.status).toBe('pending');
    let m = await mount(s, 'fin', assetRef(p1));
    await click(button(m.root, 'Approve'));
    expect(m.calls).toEqual([{ t: 'approve', orderId: card.id }]);
    m.unmount();
    // the nightly rate, ±$10 a tap
    m = await mount(s, 'fin', assetRef(s.assets.find((a) => a.id === 'h1')!));
    const n = s.rates.nightly;
    await click(button(m.root, 'Nightly rate up'));
    await click(button(m.root, 'Nightly rate down'));
    expect(m.calls).toEqual([
      { t: 'setRates', nightly: n + 10, charter: s.rates.charter },
      { t: 'setRates', nightly: n, charter: s.rates.charter },
    ]);
    m.unmount();
    // hire: this week's candidate for the figure's role, then one confirm; a spare that brings no new income is no
    // solid Hire (review round 1), only the Hiring board
    const pilot = crewOf(s).find((x) => x.role === 'pilot')!;
    s.hiring = { week: s.week, cands: [{ id: 'cx1', name: 'Kai L.', role: 'pilot', skill: 4, ask: 380, start: s.week + 1 }] };
    m = await mount(s, 'fin', { kind: 'staff', id: pilot.id, st: HOME });
    expect(staffEffect(s, s.hiring.cands[0], 'hire').net).toBeLessThanOrEqual(0);
    expect(hasButton(m.root, 'Hire Kai L.')).toBe(false);
    expect(textOf(m.root)).toMatch(/Another pilot wouldn't pay for their wage this week \(\$380 a week · net about −\$\d+ a week\)/);
    expect(hasButton(m.root, 'Hiring board')).toBe(true);
    m.unmount();
    // a hire that pays (a cheap housekeeper: the reviews' lift covers her) is the sheet's Hire
    const hk = crewOf(s).find((x) => x.role === 'housekeeper')!;
    s.hiring = { week: s.week, cands: [{ id: 'cx1', name: 'Kai L.', role: 'housekeeper', skill: 4, ask: 40, start: s.week + 1 }] };
    expect(staffEffect(s, s.hiring.cands[0], 'hire').net).toBeGreaterThan(0);
    m = await mount(s, 'fin', { kind: 'staff', id: hk.id, st: HOME });
    await click(button(m.root, 'Hire Kai L.'));
    expect(m.calls).toEqual([]);
    await click(button(m.root, 'Confirm the hire'));
    expect(m.calls).toEqual([{ t: 'hire', cand: 'cx1' }]);
    m.unmount();
  });

  it("the analyst's deep links: a house to Pricing on the Money tab, a staff figure to the hiring board, the build site to Site work", async () => {
    const s = island(6, 3);
    const ev = listen();
    const pilot = crewOf(s).find((x) => x.role === 'pilot')!;
    const cases: [ObjectRef, string, unknown][] = [
      [assetRef(s.assets.find((a) => a.id === 'h1')!), 'Pricing', { desk: 'money', at: 'pricing' }],
      [{ kind: 'staff', id: pilot.id, st: HOME }, 'Hiring board', { desk: 'staff', at: 'hiring' }],
      [{ kind: 'site', id: 'project', st: HOME }, 'Site work', { desk: 'staff', at: 'site-work' }],
    ];
    for (const [ref, label, detail] of cases) {
      const m = await mount(s, 'fin', ref);
      await click(button(m.root, label));
      expect(ev.seen.at(-1), label).toEqual({ type: 'ic:open', detail });
      expect(m.closed()).toBe(1);
      m.unmount();
    }
    ev.stop();
  });

  it("the techs' moves: the safety call, an alert's job sheet, the cart sheet, Stores", async () => {
    const s = island(6, 3);
    const p1 = s.assets.find((a) => a.id === 'p1')!;
    const al = raiseAlert(s, { role: 'mech', asset: p1, sym: 'M_TIRE_WORN', cause: 0 }, NOW);
    const ev = listen();
    let m = await mount(s, 'mech', assetRef(p1));
    await click(button(m.root, 'Ground'));
    expect(m.calls).toEqual([{ t: 'tag', role: 'mech', assetId: 'p1', on: true }]);
    await click(button(m.root, /main tire/i));
    expect(ev.seen.at(-1)).toEqual({ type: 'ic:open', detail: { alert: al.id } });
    expect(m.closed()).toBe(1);
    // ground power opens the cart sheet in place, back to the plane after
    await click(button(m.root, 'Ground power'));
    expect(textOf(m.root)).toContain('A ground power start needs a cart hooked up');
    await click(button(m.root, '◂'));
    expect(textOf(m.root)).toContain(inspectionLine(textOf(m.root)));
    m.unmount();
    m = await mount(s, 'mech', fixtureRef('hangar'));
    await click(button(m.root, 'Stores'));
    expect(ev.seen.at(-1)).toEqual({ type: 'ic:flow', detail: { stores: true } });
    m.unmount();
    // the electrician red-tags a house from its sheet
    m = await mount(s, 'elec', assetRef(s.assets.find((a) => a.id === 'h1')!));
    await click(button(m.root, 'Red-tag'));
    expect(m.calls).toEqual([{ t: 'tag', role: 'elec', assetId: 'h1', on: true }]);
    m.unmount();
    ev.stop();
  });
});
const inspectionLine = (t: string) => (/100-hr inspection/.test(t) ? '100-hr inspection' : 'Airworthiness');

// ---------------------------------------------------------------------------

/** an island (seed) whose check on this asset shows items, at tier 2+ in week 5 */
const checkIsland = (tier = 3) => island(5, tier, 62, 21);

describe('the walkaround (6.4): every zone in one view, the call in 3 taps', () => {
  for (const id of ['p1', 'p2', 'gen'])
    it(`${id}: the view's zones on the drawing and in the list; zone, Write it up`, async () => {
      const s = checkIsland(4);
      const a = s.assets.find((x) => x.id === id)!;
      const view = checkView(s, 'mech', id)!;
      const m = await mount(s, 'mech', assetRef(a));
      // 1: the sheet's primary
      await click(button(m.root, 'Walkaround'));
      const items = walk(m.root).filter((e) => (e.getAttribute('class') ?? '').split(' ').includes('qc-item'));
      expect(items.map((e) => textOf(e))).toEqual(view.items.map((i, n) => `${n + 1}${i.label}${i.text}`));
      const marks = walk(m.root).filter((e) => e.getAttribute('class')?.startsWith('mk'));
      expect(marks).toHaveLength(view.items.length);
      // the call waits for a zone
      expect(button(m.root, 'Write up').disabled).toBe(true);
      // 2: a zone (on the drawing), 3: the call
      const zone = view.items[view.items.length - 1];
      await click(marks[marks.length - 1]);
      expect(items[items.length - 1].getAttribute('aria-pressed')).toBe('true');
      // (review round 1: the call names what it writes up, apart from the sheet's squawk card; review round 2: on its own
      // line above the buttons, where a long label wraps instead of being cut short on a phone)
      expect(textOf(button(m.root, 'Write up'))).toBe('Write up');
      expect(button(m.root, 'Write up').getAttribute('aria-label')).toBe(`Write up: ${zone.label}`);
      expect(textOf(walk(m.root).find((e) => (e.getAttribute('class') ?? '').split(' ').includes('qc-pick'))!)).toBe(`Your call: ${zone.label}`);
      await click(button(m.root, 'Write up'));
      expect(m.calls).toEqual([{ t: 'check', role: 'mech', assetId: id, item: zone.id, week: s.week }]);
      // blind: the words say it's on the list, never whether it was right
      const t = textOf(m.root);
      expect(t).toContain(`you wrote up the ${CHECK_ROWS[checkRowKey('walkaround', zone.id)].word}`);
      expect(t).not.toMatch(/right call|wrong call|correct|no fault/i);
      // one a week
      expect(button(m.root, 'Walkaround').disabled).toBe(true);
      m.unmount();
    });

  it('All serviceable is 2 taps and raises nothing', async () => {
    const s = checkIsland();
    const m = await mount(s, 'mech', assetRef(s.assets.find((x) => x.id === 'p1')!));
    await click(button(m.root, 'Walkaround'));
    await click(button(m.root, 'All serviceable'));
    expect(m.calls).toEqual([{ t: 'check', role: 'mech', assetId: 'p1', item: null, week: s.week }]);
    expect(textOf(m.root)).toContain('all serviceable. Nothing written up.');
    m.unmount();
  });

  it('the week closes under an open check: it goes back to the sheet with a word, nothing written up (review round 1)', async () => {
    const s = checkIsland(4);
    const a = s.assets.find((x) => x.id === 'p1')!;
    const m = await mount(s, 'mech', assetRef(a));
    await click(button(m.root, 'Walkaround'));
    expect(hasButton(m.root, 'All serviceable')).toBe(true);
    await m.rerender({ ...s, week: s.week + 1 });
    await m.rerender();
    expect(hasButton(m.root, 'All serviceable')).toBe(false);
    expect(textOf(m.root)).toContain("The week closed before your call: nothing was written up. This week's check is open.");
    expect(m.calls).toEqual([]);
    m.unmount();
  });

  it('the component alone: a tap on a list item picks it; the call carries it', async () => {
    const s = checkIsland();
    const view = checkView(s, 'mech', 'p1')!;
    const root = new El('div');
    const got: (string | null)[] = [];
    await act(() => render(h(Walkaround, { a: s.assets.find((x) => x.id === 'p1')!, view, onCall: (i: string | null) => void got.push(i) }), root as unknown as Element));
    await click(button(root, view.items[1].label));
    await click(button(root, 'Write up'));
    expect(got).toEqual([view.items[1].id]);
    render(null, root as unknown as Element);
  });
});

/** a scan with a breaker too light to judge and one at a real load (seeded: look over the weeks) */
function irView(): { s: IslandState; view: CheckView } {
  for (let w = 3; w < 60; w++) {
    const s = island(w, 5, 62, 21);
    const view = checkView(s, 'elec', 'g1')!;
    if (view.items.some((i) => i.reading?.tooLight)) return { s, view };
  }
  throw new Error('no light breaker in 60 weeks');
}

describe('the IR scan (6.4)', () => {
  it('opens on the PPE line; every breaker with its rating, conductor, load and rise; "too light to judge"; the help', async () => {
    const { s, view } = irView();
    const root = new El('div');
    const got: (string | null)[] = [];
    await act(() => render(h(IrScan, { s, a: s.assets.find((x) => x.id === 'g1')!, view, onCall: (i: string | null) => void got.push(i) }), root as unknown as Element));
    const t = textOf(root);
    expect(t.indexOf('Dead front off: arc-rated PPE per NFPA 70E.')).toBeGreaterThanOrEqual(0);
    expect(t.indexOf('Dead front off')).toBeLessThan(t.indexOf(view.items[0].label));
    for (const i of view.items) {
      expect(t).toContain(i.label); // "Hangar 60 A · #6 Cu": the rating and the conductor
      expect(t).toContain(`+${i.reading!.riseC!.toFixed(1)} °C`);
      if (i.id !== 'main') expect(t).toContain(`${i.reading!.amps} A · ${i.reading!.loadPct}% of its rating`);
    }
    expect(t).toContain('too light to judge');
    expect(t).toContain('NFPA 70B');
    expect(t).toContain('NETA');
    // the thermal image paints by temperature: ambient + rise at each lug
    expect(t).toMatch(/ambient \d\d °C/);
    await click(button(root, view.items[2].label));
    await click(button(root, 'Write up'));
    await click(button(root, 'All normal'));
    expect(got).toEqual([view.items[2].id, null]);
    render(null, root as unknown as Element);
  });

  it("the generator's scan is its transfer switch on the weekly test run", async () => {
    const s = checkIsland(3);
    const m = await mount(s, 'elec', assetRef(s.assets.find((x) => x.id === 'gen')!));
    await click(button(m.root, 'IR scan'));
    const t = textOf(m.root);
    expect(t).toContain('Transfer switch, generator-side lugs');
    expect(t).toContain('weekly test run');
    m.unmount();
  });
});

describe('the meter check (6.4)', () => {
  it('every circuit with its volts under the 12 A load and its run length, the GFCI results, the service legs', async () => {
    const s = checkIsland(4);
    for (const id of ['h1', 'h5']) {
      const view = checkView(s, 'elec', id)!;
      const root = new El('div');
      const got: (string | null)[] = [];
      await act(() => render(h(MeterCheck, { a: s.assets.find((x) => x.id === id)!, view, onCall: (i: string | null) => void got.push(i) }), root as unknown as Element));
      const t = textOf(root);
      for (const i of view.items) {
        expect(t).toContain(i.label); // "Kitchen counter A (30 ft)": the run length
        expect(t).toContain(i.reading!.volts!.toFixed(1));
      }
      expect(t).toMatch(/GFCI: /);
      expect(t).toMatch(/L1 \d{3}\.\d/);
      await click(button(root, view.items[0].label));
      await click(button(root, 'Write up'));
      expect(got).toEqual([view.items[0].id]);
      render(null, root as unknown as Element);
    }
  });
});

describe('Report a problem (6.5)', () => {
  it("a flag on another trade's asset: 2 taps, with what it does in words", async () => {
    const s = island(6, 3);
    const m = await mount(s, 'fin', assetRef(s.assets.find((a) => a.id === 'h1')!));
    await click(button(m.root, 'Report a problem to Ben'));
    expect(textOf(m.root)).toContain(
      "Passes on what a guest reported about Cottage 1: one alert on Ben's list, from you, in a slot the week's draw would have filled, until Ben closes it. You'll see what it said. A reported shock or burning smell closes the house at once, until Ben makes it safe.",
    );
    expect(m.calls).toEqual([]);
    await click(button(m.root, 'Report it'));
    expect(m.calls).toEqual([{ t: 'flag', role: 'fin', assetId: 'h1', week: s.week }]);
    m.unmount();
    // (review round 1) then the sheet says what went on the list in your name, in its source's words
    const after = apply(s, { t: 'flag', role: 'fin', assetId: 'h1', week: s.week }, NOW).s;
    const al = after.alerts!.find((a) => a.src === 'flag')!;
    const m2 = await mount(after, 'fin', assetRef(after.assets.find((a) => a.id === 'h2')!));
    expect(textOf(m2.root)).toContain(`This week you passed on a guest's complaint at Cottage 1 to Ben: ${alertShort(after, al)}.`);
    m2.unmount();
  });

  it("the one-a-week cap's words, and the DM with its message started", async () => {
    let s = island(6, 3);
    s = apply(s, { t: 'flag', role: 'mech', assetId: 'h1', week: s.week }, NOW).s;
    const ev = listen();
    const m = await mount(s, 'mech', assetRef(s.assets.find((a) => a.id === 'h2')!));
    expect(textOf(m.root)).toContain('One report a week: yours is used. Message them instead.');
    expect(hasButton(m.root, 'Report a problem')).toBe(false);
    await click(button(m.root, 'Message Ben'));
    expect(ev.seen.at(-1)).toEqual({ type: 'ic:dm', detail: { role: 'elec', prefill: 'About Cottage 2: ' } });
    m.unmount();
    // a fixture: the DM to the other seats, "About the hangar: "
    const f = await mount(s, 'mech', fixtureRef('hangar'));
    await click(button(f.root, 'Message Cy'));
    expect(ev.seen.at(-1)).toEqual({ type: 'ic:dm', detail: { role: 'fin', prefill: 'About the hangar: ' } });
    f.unmount();
    ev.stop();
  });

  it('your own trade: the write-up, in the sheet', async () => {
    const s = island(6, 3);
    const m = await mount(s, 'elec', assetRef(s.assets.find((a) => a.id === 'h1')!));
    await click(button(m.root, 'Write it up'));
    const t = textOf(m.root);
    expect(t).toContain('Write up one job this week');
    const first = buttons(m.root).find((b) => textOf(b) === 'Write up')!;
    await click(first);
    expect(m.calls[0]).toMatchObject({ t: 'squawk', role: 'elec', assetId: 'h1' });
    m.unmount();
  });
});

describe('the keyboard (13.3)', () => {
  it('every move is a button (Tab reaches it; the drawing only repeats the list), and Esc closes the sheet', async () => {
    const s = played();
    for (const ref of refs(s).filter((r) => r.kind !== 'station' && r.kind !== 'route'))
      for (const role of ROLES) {
        const m = await mount(s, role, ref);
        for (const e of walk(m.root)) {
          if (!e.listeners.get('click')?.length) continue;
          // a clickable thing is a button, a folded panel's summary, or the drawing's marker (aria-hidden: its list item is the button)
          const ok = e.localName === 'button' || e.localName === 'summary' || e.getAttribute('aria-hidden') === 'true';
          expect(ok, `${ref.kind}:${ref.id} as ${role}: <${e.localName} class="${e.getAttribute('class')}">`).toBe(true);
        }
        for (const b of buttons(m.root)) expect(b.getAttribute('tabindex')).not.toBe('-1');
        const before = m.closed();
        await act(() => void docEvents.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' })));
        expect(m.closed()).toBe(before + 1);
        m.unmount();
      }
  });

  it('in a check too: Esc closes', async () => {
    const s = checkIsland();
    const m = await mount(s, 'mech', assetRef(s.assets.find((x) => x.id === 'p1')!));
    await click(button(m.root, 'Walkaround'));
    await act(() => void docEvents.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' })));
    expect(m.closed()).toBe(1);
    m.unmount();
  });
});

describe("stage 2's What's new (9.5)", () => {
  it("a new island's week 1 shows only the map; later, the four panels for the seat", async () => {
    const s = island(1, 1);
    expect(whatsNewMapPanels(s, 'mech').map((p) => p.title)).toEqual(['Explore the island']);
    const t = island(6, 1);
    for (const role of ROLES) {
      const panels = whatsNewMapPanels(t, role);
      expect(panels).toHaveLength(4);
      const root = new El('div');
      await act(() => render(h('div', null, panels.map((p) => p.body)), root as unknown as Element));
      const words = textOf(root);
      expect(words).toContain('Two fingers');
      expect(words).toContain('Report a problem');
      // a tier-1 island's techs learn when their check opens
      if (role !== 'fin') expect(words).toContain('It opens at tier 2.');
      else expect(words).not.toContain('walk round');
      render(null, root as unknown as Element);
    }
    expect(whatsNewMapPanels(island(2, 3), 'elec').length).toBe(4);
  });
});

describe('the house sheet after its renovation (stage 2 review round 3)', () => {
  it('renovated recently: the Renovation card is the cooldown line alone, no hypothetical case above it', async () => {
    const s = island(31, 5, 60);
    s.assets.push({ id: 'h6', kind: 'house', model: 'villa', name: 'Villa West', health: 70, touchedWeek: 0, inspectionUntil: 40 });
    s.builds = [...(s.builds ?? []), { id: 'reno-villa-h6-27', what: 'Renovate Villa West', reno: 'h6', done: 2, drawn: 2, need: 2, started: 27, finished: 28, signed: 29 }];
    const m = await mount(s, 'fin', assetRef(s.assets.find((a) => a.id === 'h6')!));
    const words = textOf(m.root);
    expect(words).toContain('Villa West was renovated recently: one renovation per house every 26 weeks (again from week 53).');
    expect(words).not.toMatch(/Doesn't pay back|Pays back in about|closed about|about \$[\d,]+ of rent gained/);
    expect(buttons(m.root).some((b) => /Renovate/.test(textOf(b)))).toBe(false);
  });
});

// the symptom rows the tests raise exist (a rename breaks here, not in a confusing place)
it('the symptom rows used here exist', () => {
  for (const k of ['M_OIL_DUE', 'M_TIRE_WORN']) expect(SYMPTOMS[k], k).toBeTruthy();
  void (null as unknown as Alert);
  void (null as unknown as OpsRole);
});
