// Stage 2 review round 2 (docs/DECISIONS.md "2026-09-30: stage 2 review round 2"): one test per fix, on the reviewers'
// repros where they gave one.
//   - Report a problem: said once in the island's feed; the analyst's generator flag routed by her own side's cap; a
//     flagged hazard closes its house at once and can be made safe after the turn; the relayed words
//   - G0: the old standby set's unfinished work retired at the Resort's upgrade (jobs, stock, requisitions, PO lines,
//     defects); the transfer switch's one backed-up load everywhere; the fuel; a renovation with no builder left; the
//     county's final and its prep
//   - the checks' physics: the island panel's IR spread, the meter's legs and Table 8; the walkaround's nose gear
//   - the sheets: the spa circuit on record, a plane under 40, the fixed costs, the renovation case, the cottage's
//     button, the techs' fixtures and crew; What's new; the map's hit test, touches and narrow controls
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { alertShort, liveAlerts, needsOf, raiseAlert, siteOf, symptomText, SYMPTOMS } from '../src/sim/alerts';
import { simulate, TEAMS } from '../src/sim/bots';
import { CHECK_SYMPTOMS, HOME_PANEL, METER, WALK_SCOPE, WALK_ZONES } from '../src/sim/checkdata';
import { backedUp, checkTruth, checkView, flagCheck, flagPick, raiseFlag } from '../src/sim/checks';
import { CATALOG_BY_KIND, TIERS } from '../src/sim/data';
import { closingHazard, fixedNow, genUpgraded, hazardOn, houseBlocker, houseRentable, isAog, planeCapacity, renovating } from '../src/sim/econ';
import { apply, createIsland } from '../src/sim/engine';
import { cardOf, fixTaskFor, stdPick } from '../src/sim/flow';
import { itemById } from '../src/sim/items';
import { runway } from '../src/sim/ledger';
import { migrate } from '../src/sim/migrate';
import { cottagePlan, staffEffect } from '../src/sim/staff';
import { addStarter } from '../src/sim/stock';
import { taskById } from '../src/sim/tasks';
import { ROLES, type Action, type IslandState, type Npc } from '../src/sim/types';
import { COTTAGE_PAYS_WITHIN, DEMO_XWIND, facts, factsText, gridSchedule, houseSchedule, weekWind } from '../src/ui/inspect/facts';
import { whatsNewMapPanels } from '../src/ui/inspect/WhatsNewMap';
import { allCam, frameOf, HOME_SCENE, limitsFor } from '../src/ui/map/camera';
import { fingersOn } from '../src/ui/map/gestures';
import { SEA_FAR } from '../src/ui/island/geo';
import { hitTest, hotspots } from '../src/ui/map/hotspots';
import { PILOT_ASIDE } from '../src/ui/map/place';
import { assetRef, fixtureRef, HOME } from '../src/ui/objects';
import { renoStatus } from '../src/ui/staff/model';
import { RENO_RULE } from '../src/ui/staff/Reno';

vi.setConfig({ testTimeout: 120000 });

const NOW = Date.UTC(2026, 8, 30, 12);
let clock = NOW;
const load = (name: string): IslandState => JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures', `${name}.json`), 'utf8'));
const ok = (s: IslandState, a: Action) => {
  const r = apply(s, a, ++clock);
  expect(r.error, JSON.stringify(a)).toBeUndefined();
  return r.s;
};
const house = (s: IslandState, id: string) => s.assets.find((a) => a.id === id && a.kind === 'house')!;

/** a fresh island at `tier`, every asset at `health`, week 6 (the reviewers' helper) */
function island(seed = 5, health = 70, tier = 3): IslandState {
  let s = createIsland({ id: `r2-${seed}`, name: 'Review Isle', now: NOW, tz: 'Europe/Paris', seed, creator: { uid: 'a', name: 'Ana', role: 'mech' } });
  s = apply(s, { t: 'join', uid: 'b', name: 'Ben', role: 'elec' }, NOW).s;
  s = apply(s, { t: 'join', uid: 'c', name: 'Cy', role: 'fin' }, NOW).s;
  for (const r of ROLES) s = apply(s, { t: 'week0Done', role: r }, NOW).s;
  s.week = 6;
  s.tier = tier;
  s.cash = 20000;
  for (const t of TIERS.slice(1, tier))
    for (const a of t.adds)
      if (!s.assets.some((x) => x.id === a.id))
        s.assets.push({ id: a.id, kind: a.model === 'gen' ? 'generator' : ['twin', 'cargo', 'float'].includes(a.model) ? 'plane' : a.model === 'panel' ? 'grid' : 'house', model: a.model, name: a.name, health, touchedWeek: 0 });
  addStarter(s, tier);
  for (const a of s.assets) {
    a.health = health;
    if (a.kind === 'house') a.inspectionUntil = 40;
    if (a.kind === 'plane') a.sinceInspection = 0;
  }
  s.orders = [];
  s.alerts = [];
  for (const p of Object.values(s.players)) if (p) p.graceUntil = 0;
  return s;
}

/** a live doc read and moved once on this build (G0's migration runs), as the reviewers set it up */
function firstMove(name: string): { doc: IslandState; s: IslandState } {
  const doc = load(name);
  const role = (['mech', 'elec', 'fin'] as const).find((r) => !doc.turns[r]?.ended)!;
  const r = apply(doc, { t: 'endTurn', role, week: doc.week }, doc.updatedAt + 1);
  expect(r.error).toBeUndefined();
  return { doc, s: r.s };
}

/** a preact vnode's text (the What's new panels: plain components, no hooks) */
function vtext(v: unknown): string {
  if (v == null || typeof v === 'boolean') return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(vtext).join('');
  const n = v as { type: unknown; props?: { children?: unknown } };
  if (typeof n.type === 'function') return vtext((n.type as (p: unknown) => unknown)(n.props ?? {}));
  return vtext(n.props?.children);
}

// ---------------------------------------------------------------------------

describe('Report a problem', () => {
  it("a flag is said once in the island's feed, in the flagger's colour (the feed is shared: written for both seats it showed twice)", () => {
    let s = island(2, 55, 2);
    s.week = 10;
    const n = s.feed.length;
    s = ok(s, { t: 'flag', role: 'elec', assetId: 'p1', week: s.week });
    const a = s.alerts!.find((x) => x.src === 'flag')!;
    const added = s.feed.slice(n - s.feed.length).filter((f) => f.text.includes('passed on'));
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ role: 'elec', text: `Ben passed on a squawk from ${a.via} (the pilot) on Twin N-12 to Ana: ${alertShort(s, a)}.` });
  });

  it("the analyst's generator flag goes by her own side's cap: a tech-to-tech flag on a plane leaves it the mechanic's (the reviewers' R2-3)", () => {
    let s = island();
    expect(flagCheck(s, 'fin', 'gen')).toEqual({ ok: true, to: 'mech' });
    s = ok(s, { t: 'flag', role: 'elec', assetId: 'p1', week: s.week });
    expect(flagCheck(s, 'fin', 'gen')).toEqual({ ok: true, to: 'mech' });
  });

  it('a flagged hazard closes its house at once, every sheet says so, and the card says the house is closed (trades major, systems minor)', () => {
    // the reviewers' repro: the live tier-4 island, a guest's shock at Cottage 3 passed on by the analyst
    const s = migrate(load('v4-e810cc5-t4'));
    const h3 = house(s, 'h3');
    const al = raiseFlag(s, 'fin', h3, 'elec', { sym: 'E_SHOWER_TINGLE', cause: 0 }, NOW);
    expect(al.due).toBe(s.week + 1);
    expect(closingHazard(s, 'h3')?.id).toBe(al.id);
    expect(houseRentable(s, h3)).toBe(false);
    expect(houseBlocker(s, h3)).toBe('hazard');
    const elec = facts(s, assetRef(h3), 'elec');
    expect(elec.status).toBe('Closed: hazard');
    expect(elec.lines.map((l) => l.text)).toContain("Hazard open: A tingle at the shower valve. The house is shut until it's made safe or fixed.");
    expect(facts(s, assetRef(h3), 'fin').status).toMatch(/^Closed this week \(hazard\): no rent$/);
    // the words: the guest's, once (review round 2: "guest at Cottage 3 felt a tingle", the name twice)
    expect(symptomText(s, al)).toBe("Cy passed on a guest's complaint at Cottage 3: a tingle at the shower valve.");
  });

  it('the card on a flagged hazard: "House closed", as the house is (the reviewers\' island: seed 1, tier 3, week 6, every asset at 45)', () => {
    let s = island(1, 45, 3);
    s = ok(s, { t: 'flag', role: 'fin', assetId: 'h1', week: s.week });
    const al = s.alerts!.find((a) => a.src === 'flag')!;
    expect(SYMPTOMS[al.sym].hazard).toBe(true);
    expect(houseRentable(s, house(s, 'h1'))).toBe(false);
    // the electrician plans the fix with nothing on the shelf: a card for the analyst
    s.inv = {};
    const task = fixTaskFor(s, al)!;
    s = ok(s, { t: 'plan', role: 'elec', alert: al.id, task: task.id, pick: stdPick(s, house(s, 'h1'), task, siteOf(s, al), needsOf(s, al)), week: s.week } as Action);
    const o = s.orders.find((x) => x.flow?.alert === al.id)!;
    expect(o.status).toBe('pending');
    expect(cardOf(s, o).shut).toBe(true);
    expect(houseRentable(s, house(s, 'h1'))).toBe(false);
  });

  it("a hazard passed on after the electrician's turn can be made safe that night; a drawn one still waits for the turn", () => {
    let found = 0;
    for (let seed = 1; seed <= 300 && !found; seed++) {
      let s = island(seed, 45, 3);
      const h = house(s, 'h1');
      const pick = flagPick(s, 'fin', h, 'elec');
      if (!pick || !SYMPTOMS[pick.sym].hazard || pick.cause < 0) continue;
      found++;
      // a drawn hazard on another house, open before the turn ended
      const other = raiseAlert(s, { role: 'elec', asset: house(s, 'h2'), sym: pick.sym, cause: pick.cause }, NOW);
      s = ok(s, { t: 'endTurn', role: 'elec', week: s.week });
      s = ok(s, { t: 'flag', role: 'fin', assetId: h.id, week: s.week });
      const al = s.alerts!.find((a) => a.src === 'flag')!;
      expect(apply(s, { t: 'makeSafe', role: 'elec', alert: other.id, how: 'breaker' }, ++clock).error).toBe('Your turn is over for this week.');
      s = ok(s, { t: 'makeSafe', role: 'elec', alert: al.id, how: 'breaker' });
      expect(hazardOn(s, h.id)?.safe?.by).toBe('Ben');
      expect(houseRentable(s, house(s, h.id))).toBe(true);
      // made safe, nothing more after the turn: the fix waits for it
      expect(apply(s, { t: 'makeSafe', role: 'elec', alert: al.id, how: 'blankoff' }, ++clock).error).toBe('Your turn is over for this week.');
    }
    expect(found).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe("G0: the Resort's upgrade retires the old set's unfinished work (code major)", () => {
  for (const name of ['v4-e810cc5-credits', 'v4-e810cc5-t5-carry', 'v4-e810cc5-t5-carry-mid'])
    it(`${name}: the old switch's job, its alert, its lot on the boat and its labour; said once`, () => {
      const { doc, s } = firstMove(name);
      const gen = s.assets.find((a) => a.kind === 'generator')!;
      expect(genUpgraded(s)).toBe(true);
      const job = s.orders.find((o) => o.id === 'o437')!;
      expect(doc.orders.find((o) => o.id === 'o437')!.status).toBe('waiting_part');
      expect(job.status).toBe('cancelled');
      expect(s.alerts!.find((a) => a.id === 'a431')!.closed).toEqual({ week: doc.week, how: 'dropped' });
      // nothing about the old switch left open on the generator, the circuits' own alert kept
      expect(liveAlerts(s).filter((a) => a.assetId === gen.id).map((a) => a.sym)).toEqual(liveAlerts(doc).filter((a) => a.assetId === gen.id && a.sym === 'E_GEN_TEST').map((a) => a.sym));
      // the lot still on the boat: cancelled with the vendor (the PO gone, nothing committed for it)
      expect((s.pos ?? []).some((p) => p.lines.some((l) => l.item === 'LOT-XFER'))).toBe(false);
      // the tool already received for it stays the island's
      expect((s.pos ?? []).find((p) => p.lines.some((l) => l.item === 'T-KO'))!.status).toBe('received');
      // the labour of a job never started comes back ($1,130)
      expect(s.cash - doc.cash).toBe(1130);
      expect(Object.values(s.inv ?? {}).some((l) => l.res?.o437)).toBe(false);
      const said = s.feed.filter((f) => /work on the old set is dropped/.test(f.text));
      expect(said).toHaveLength(1);
      expect(said[0].text).toBe('The Resort’s new standby set and its 200 A automatic transfer switch are in: the work on the old set is dropped (a job cancelled; $1,130 of labour back, $900 of parts cancelled with the vendor).');
      // and the generator's sheet no longer lists it
      expect(factsText(facts(s, assetRef(gen), 'elec'))).not.toMatch(/didn't pick up/);
    });

  it('v4-e810cc5-t5: a relay job planned from a transfer that failed on the old switch is dropped too (by what the alert says, never by its hidden cause)', () => {
    const { s } = firstMove('v4-e810cc5-t5');
    expect(s.orders.find((o) => o.id === 'o463')!.status).toBe('cancelled');
    expect(s.alerts!.find((a) => a.id === 'a458')!.status).toBe('closed');
    // its relay, received for it, is free stock again
    expect(s.inv?.['KP-TSR30']?.res?.o463).toBeUndefined();
  });

  it("new islands: no work on the old set is open once the Resort arrives (the reviewers' tier-up seeds: three friends 22 and 25, all average 10 and 30)", () => {
    let arrived = 0;
    for (const [team, seed] of [
      ['three friends', 22],
      ['three friends', 25],
      ['all average', 10],
      ['all average', 30],
    ] as const) {
      let prev = 0;
      simulate(TEAMS[team], 26, seed, (s) => {
        const g = s.assets.find((a) => a.kind === 'generator');
        if (s.tier === 5 && prev === 4 && g) {
          arrived++;
          expect(s.orders.filter((o) => o.assetId === g.id && o.status !== 'done' && o.status !== 'cancelled' && (o.kind === 'transfer' || o.kind === 'genService')), `${team} ${seed}`).toEqual([]);
          expect(liveAlerts(s).filter((a) => a.assetId === g.id && /^(E_TAKEOFF_XFER|E_XFER_FAIL|M_GEN_RUN|M_GEN_SHAKE|K_walk:|K_ir:)/.test(a.sym)), `${team} ${seed}`).toEqual([]);
        }
        prev = s.tier;
      });
    }
    expect(arrived).toBe(4);
  });
});

describe("G0: the transfer switch's one backed-up load (trades major)", () => {
  it("at the Resort the island panel's transfer-switch feed is sized for the 200 A switch and carries the generator test run's current", () => {
    const { s } = firstMove('v4-e810cc5-t5');
    const grid = checkView(s, 'elec', 'g1')!.items.find((i) => i.id === 'xfer')!;
    const gen = checkView(s, 'elec', 'gen')!.items.find((i) => i.id === 'xferG')!;
    expect(grid.label).toBe('Transfer switch feed 200 A · 3/0 Cu');
    expect(gen.label).toBe('Transfer switch, generator-side lugs 200 A · 3/0 Cu');
    expect(grid.reading!.amps).toBe(gen.reading!.amps);
    expect(grid.reading!.amps).toBe(backedUp(s)!.amps);
    expect(gridSchedule(s).rows.find((r) => r.label === 'Transfer switch feed')).toMatchObject({ rating: '200 A', wire: '3/0 Cu' });
    // before the Resort: the 60 A feed, as installed
    expect(HOME_PANEL.find((b) => b.id === 'xfer')).toMatchObject({ amps: 60, awg: '#6 Cu' });
  });

  it('before it, with the take-off open: the load it quotes is what the test run and the panel read (over the 60 A rating: the tell), 107-130%', () => {
    const s = island(4, 70, 3);
    const gen = s.assets.find((a) => a.kind === 'generator')!;
    const t = raiseAlert(s, { role: 'elec', asset: gen, sym: 'E_TAKEOFF_XFER' }, NOW);
    const load = siteOf(s, t)!.load!;
    expect(load).toBeGreaterThanOrEqual(64);
    expect(load).toBeLessThanOrEqual(78);
    expect(symptomText(s, t)).toBe(`The houses now back up ${load} A on the 60 A transfer switch and the 60 A set: fit an automatic switch with load shed, sized to the set (702.4(B)(2)(b)).`);
    const g = checkView(s, 'elec', gen.id)!.items;
    expect(g.find((i) => i.id === 'xferG')!.reading).toMatchObject({ amps: load, loadPct: Math.round((100 * load) / 60) });
    expect(checkView(s, 'elec', 'g1')!.items.find((i) => i.id === 'xfer')!.reading!.amps).toBe(load);
    // without it: a share of the set's rating, never too light, the same number on both scans
    s.alerts = [];
    for (let W = 1; W <= 30; W++) {
      const b = backedUp(s, W)!;
      expect(b.amps).toBeGreaterThanOrEqual(24);
      expect(b.amps).toBeLessThanOrEqual(42);
      expect(checkView(s, 'elec', 'g1', W)!.items.find((i) => i.id === 'xfer')!.reading!.amps).toBe(b.amps);
      expect(checkView(s, 'elec', gen.id, W)!.items.find((i) => i.id === 'genbrk')!.reading!.amps).toBe(b.amps);
    }
  });

  it("the set's fuel burns at the test run's load: the Resort's set on its own sub-base tank; the lot is an automatic switch sized to the set", () => {
    const { s } = firstMove('v4-e810cc5-t5');
    const amps = backedUp(s)!.amps;
    const hours = Math.round(150 / (0.3 + 0.07 * ((amps * 240) / 1000)));
    expect(factsText(facts(s, assetRef(s.assets.find((a) => a.kind === 'generator')!), 'elec'))).toContain(`Fuel: the 150 gal sub-base tank topped up after each test run: about ${hours} h at this week's test-run load (${amps} A).`);
    const t3 = island(4, 70, 3);
    expect(factsText(facts(t3, assetRef(t3.assets.find((a) => a.kind === 'generator')!), 'elec'))).toMatch(/Fuel: the 36 gal belly tank topped up after each test run: about \d+ h at this week's test-run load \(\d+ A\)\./);
    expect(itemById('LOT-XFER')!.nomen).toMatch(/^Transfer switch lot: automatic transfer switch sized to the standby set, with load shed/);
    expect(itemById('LOT-XFER')!.nomen).not.toMatch(/manual/);
  });
});

describe('G0: renovations', () => {
  it('the last builder let go mid-renovation: "waiting for a builder", never "the builders are on it", and the let-go says the house stays closed (the reviewers’ R2-2)', () => {
    let s = simulate(TEAMS['all good'], 30, 2).final;
    s.cash = 100_000;
    for (const h of s.assets.filter((a) => a.kind === 'house')) {
      h.health = h.id === 'h1' ? 45 : 90;
      delete h.warrantyUntil;
    }
    s.builds = (s.builds ?? []).filter((b) => !b.reno);
    const kai: Npc = { id: `n${s.nextId++}`, name: 'Kai M.', role: 'builder', skill: 3, wage: 260, hired: s.week - 5, start: s.week - 5 };
    s.staff = [...(s.staff ?? []).filter((n) => n.role !== 'builder'), kai];
    const now = (s.deadline ?? NOW) - 3600_000;
    s = apply(s, { t: 'build', what: 'reno', asset: 'h1', week: s.week }, now).s;
    Object.assign(s.builds!.find((b) => b.reno === 'h1')!, { drawn: 1, done: 1 });
    expect(renovating(s, 'h1')).toBe(true);
    expect(houseBlocker(s, house(s, 'h1'))).toBe('renovation: the builders are on it');
    expect(staffEffect(s, kai, 'letGo').need).toContain('Cottage 1 stays closed until a builder is hired: its renovation is under way');
    s = apply(s, { t: 'letGo', npc: kai.id, week: s.week }, now).s;
    expect(houseBlocker(s, house(s, 'h1'))).toBe('renovation: waiting for a builder (none on the payroll)');
    expect(renoStatus(s, house(s, 'h1'), 'fin')!.text).toBe('Closed for its renovation, waiting for a builder: none on the payroll (hire one on the Staff desk), 1 of 2 units done. No guests until a builder finishes it and it passes its final.');
    expect(renoStatus(s, house(s, 'h1'), 'elec')!.text).toMatch(/^Closed for its renovation, waiting for a builder: none on the payroll, 1 of 2 units done\./);
  });

  it("the county passes the final; the electrician's part is the final prep; the package is the builders' (no plumbing fixtures)", () => {
    const s = migrate(load('v4-e810cc5-t4-mid'));
    const h = house(s, 'h5');
    s.builds = [...(s.builds ?? []), { id: 'reno-x', what: 'Renovate', reno: 'h5', done: 2, drawn: 2, need: 2, started: s.week - 3, finished: s.week - 1 }];
    expect(houseBlocker(s, h)).toBe('renovation: waiting on its county final');
    expect(RENO_RULE).toContain("the electrician's final prep and the inspector's visit");
    expect(RENO_RULE).not.toMatch(/trim-out/);
    expect(SYMPTOMS.E_RENO_FINAL.text).toContain('your final prep (the panel directory');
    expect(readFileSync(resolve(import.meta.dirname, '../src/ui/staff/Reno.tsx'), 'utf8')).not.toMatch(/plumbing fixtures|trim-out|\$\{elec\}'s final/);
  });
});

// ---------------------------------------------------------------------------

describe("the checks' physics (trades minors)", () => {
  it("the island panel's IR: like breakers at about the same load read within about 2 °C in a clean scan (0 of the pairs 4 °C apart; 122 of 1,455 before)", () => {
    let pairs = 0;
    let wide = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const s = island(seed, 95, 3 + (seed % 3));
      for (const W of [5, 9, 13]) {
        if (checkTruth(s, 'elec', 'g1', W)) continue;
        const v = checkView(s, 'elec', 'g1', W)!;
        const like = (a: string, b: string) => {
          const x = v.items.find((i) => i.id === a)?.reading;
          const y = v.items.find((i) => i.id === b)?.reading;
          if (!x || !y || x.tooLight || y.tooLight || Math.abs(x.loadPct! - y.loadPct!) > 5) return;
          pairs++;
          if (Math.abs(x.riseC! - y.riseC!) >= 4) wide++;
        };
        like('cfeedE', 'cfeedW');
        like('office', 'dock');
      }
    }
    expect(pairs).toBeGreaterThan(200);
    expect(wide).toBe(0);
    // the reviewers' repro: seed 20, week 9
    const s = island(20, 95, 3);
    s.week = 9;
    const v = checkView(s, 'elec', 'g1')!.items;
    const [o, d] = ['office', 'dock'].map((id) => v.find((i) => i.id === id)!.reading!);
    if (Math.abs(o.loadPct! - d.loadPct!) <= 5) expect(Math.abs(o.riseC! - d.riseC!)).toBeLessThan(2.5);
  });

  it("the meter check: a receptacle reads its leg under the load less its run's drop (never above the leg feeding it); NEC Table 8 at 75 °C", () => {
    expect(METER.ohms).toEqual({ 12: 1.93, 14: 3.07 });
    let checks = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const s = island(seed, 95, 3);
      for (const W of [5, 8, 11]) {
        const v = checkView(s, 'elec', 'h3', W)!;
        const l1 = v.items.find((i) => i.id === 'service')!.reading!.volts!;
        for (const i of v.items.filter((x) => x.id !== 'service')) expect(i.reading!.volts!, `seed ${seed} ${i.id}`).toBeLessThanOrEqual(l1);
        checks++;
      }
    }
    expect(checks).toBe(600);
    expect(checkView(island(1, 95, 3), 'elec', 'h3')!.help.join(' ')).toContain('NEC Chapter 9 Table 8, solid copper at 75 °C: 12 AWG 1.93, 14 AWG 3.07');
  });

  it("the walkaround: the nose wheel's halves can show corrosion (the nose gear zone could never carry a tell); the Caravan's zone is its cowl", () => {
    expect(WALK_SCOPE.corrosion.zones).toContain('nose');
    expect(CHECK_SYMPTOMS.find((x) => x.key === 'K_walk:nose')!.causes.map((c) => c.kind)).toContain('corrosion');
    expect(WALK_ZONES.cargo.find((z) => z.id === 'cowl')!.label).toBe('Cowl');
    // a nose tell shows up in play
    let nose = 0;
    for (let seed = 1; seed <= 300 && !nose; seed++) {
      const s = island(seed, 60, 3);
      for (let W = 5; W <= 20 && !nose; W++) if (checkTruth(s, 'mech', 'p1', W)?.item === 'nose') nose++;
    }
    expect(nose).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe('the words the techs read (trades minors)', () => {
  it('the utility sag in °C; a hot lug\'s job is a panel repair, not "a dead circuit"', () => {
    expect(SYMPTOMS.E_UTIL_SAG.causes[0].finding).toBe('Phase B lug at the main +22 °C over its neighbours on the IR scan.');
    expect(CATALOG_BY_KIND.xfmr.title).toBe('Repair a breaker or a lug at the panel');
    expect(taskById('ref:deadckt')!.short).toBe('Panel breaker or lug repair');
  });
});

describe("the house's spa circuit, on record (trades minor)", () => {
  it('no spa row until its hot-tub job is signed off; then its own breaker and wire; a later take-off is a re-run of that circuit', () => {
    const s = island(7, 70, 3);
    const h = house(s, 'h1');
    expect(houseSchedule(h).rows.some((r) => r.label === 'Spa (hot tub)')).toBe(false);
    const t = raiseAlert(s, { role: 'elec', asset: h, sym: 'E_TAKEOFF_SPA' }, NOW);
    const site = siteOf(s, t)!;
    expect(houseSchedule(h, true).rows.find((r) => r.label === 'Spa (hot tub)')!.note).toMatch(/not wired yet/);
    // the record, as its sign-off writes it (engine.ts spaIn: the job's site)
    h.spa = { amps: site.amps, awg: site.awg, week: s.week };
    expect(houseSchedule(h).rows.find((r) => r.label === 'Spa (hot tub)')).toMatchObject({ rating: `${site.amps} A`, wire: `${site.awg} AWG Cu` });
    t.status = 'closed';
    const again = raiseAlert(s, { role: 'elec', asset: h, sym: 'E_TAKEOFF_SPA' }, NOW);
    expect(symptomText(s, again)).toMatch(/^Re-run the hot-tub circuit at Cottage 1: the buried run to the pad \(\d+ ft\) fails its insulation test\.$/);
    expect(siteOf(s, again)).toMatchObject({ amps: site.amps, awg: site.awg });
  });

  it('the paper-sim crew: a hot-tub job signed off leaves the house its spa record', () => {
    let seen = false;
    simulate(TEAMS['three friends'], 26, 1, (s) => {
      if (s.assets.some((a) => a.spa)) seen = true;
    });
    expect(seen).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('the sheets (play-fun minors)', () => {
  it('a plane under 40 (not AOG, not tagged): the mechanic reads why it flies nothing, and the houses never name it as their guests’ plane', () => {
    const s = migrate(load('v4-e810cc5-t5-late'));
    const p3 = s.assets.find((a) => a.id === 'p3')!;
    p3.health = 0;
    s.alerts = (s.alerts ?? []).filter((a) => a.assetId !== 'p3');
    expect(isAog(s, 'p3')).toBe(false);
    expect(planeCapacity(p3, s.tier, s.weather)).toBe(0);
    const f = facts(s, assetRef(p3), 'mech');
    expect(f.status).toBe('AOG: condition 0, under 40: no flights this week');
    expect(f.tone).toBe('rust');
    expect(facts(s, assetRef(p3), 'fin').status).toBe('On the ground this week: condition under 40');
    for (const h of s.assets.filter((a) => a.kind === 'house')) expect(factsText(facts(s, assetRef(h), 'mech'))).not.toContain('Float F-3');
  });

  it("the analyst's figures: one 'fixed' (overhead and payroll) on Home, the Staff desk and the office; the office adds the insurance to it", () => {
    const { s } = firstMove('v4-e810cc5-t5');
    const f = facts(s, fixtureRef('office'), 'fin');
    const rw = runway(s);
    const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
    expect(f.status).toBe(`This week: about ${f.status.match(/about (\$[\d,]+) in/)![1]} in, ${money(rw.weekly)} out`);
    expect(f.lines[0].text).toBe(`Out a week: ${money(fixedNow(s))} fixed (overhead and payroll) + ${money(rw.weekly - fixedNow(s))} insurance = ${money(rw.weekly)}. Spendable covers ${rw.weeks} weeks of it.`);
    expect(factsText(f)).not.toContain('fixed costs out');
  });

  it("the renovation case says its rent is a normal week's, net of the other houses; an AOG plane's sheet says its loss once", () => {
    const src = readFileSync(resolve(import.meta.dirname, '../src/ui/staff/Reno.tsx'), 'utf8');
    expect(src).toContain("a normal week, net of the guests the other houses take");
    expect(src).toContain('if a builder starts this week');
    const { s } = firstMove('v4-e810cc5-t5');
    const p1 = s.assets.find((a) => a.id === 'p1')!;
    s.alerts = [...(s.alerts ?? []), { id: 'aZ', role: 'mech', assetId: 'p1', sym: 'M_TIRE_WORN', src: 'wear', week: s.week - 2, due: s.week - 1, seed: 1, kind: 'tires', cause: 0, status: 'open' }];
    expect(isAog(s, 'p1')).toBe(true);
    const f = facts(s, assetRef(p1), 'fin');
    expect(f.status).toMatch(/^AOG this week: about \$[\d,]+ of guests and tours lost$/);
    expect(factsText(f)).not.toContain('ride on it');
  });

  it('the build site: an extra cottage is the big move only when it pays back within a year', () => {
    const s = migrate(load('v4-e810cc5-t4-mid'));
    const plan = cottagePlan(s);
    const site = facts(s, { kind: 'site', id: 'project', st: HOME }, 'fin');
    const b = [site.primary, ...site.actions].find((a) => a?.t === 'build') as { plain?: boolean } | undefined;
    expect(plan.plot).toBeTruthy();
    expect(b).toBeDefined();
    // the reviewers' repro: it pays back in about 101 weeks, so it's a plain row, never the sheet's big move
    expect(plan.payback === null || plan.payback > COTTAGE_PAYS_WITHIN).toBe(true);
    expect(site.primary?.t).not.toBe('build');
    expect(b!.plain).toBe(true);
  });

  it("the techs' fixtures and crew: the windsock's crosswind against each plane's figure, the edge lights' and the fuel dock's breakers, a pilot's squawks, a housekeeper's house", () => {
    const { s } = firstMove('v4-e810cc5-t5');
    for (const weather of ['clear', 'wind', 'storm'] as const) {
      s.weather = weather;
      const w = weekWind(s);
      const over = s.assets.filter((a) => a.kind === 'plane').filter((p) => w.cross > DEMO_XWIND[p.model === 'twin' ? 'twin' : p.model === 'cargo' ? 'cargo' : 'float']);
      // as the weather flies: a clear week inside every plane's figure, a windy one or a storm over every one
      expect(over.length, weather).toBe(weather === 'clear' ? 0 : s.assets.filter((a) => a.kind === 'plane').length);
      const lines = facts(s, fixtureRef('windsock'), 'mech').lines.map((l) => l.text);
      expect(lines[0]).toMatch(/^Wind \d{3}° at \d+ kt(, gusting \d+)?: \d+ kt across runway 09\/27/);
      expect(lines.filter((l) => /demonstrated \d+ kt across/.test(l))).toHaveLength(3);
    }
    // (the crew is drawn in fair weather only)
    s.weather = 'clear';
    const runwayElec = facts(s, fixtureRef('runway'), 'elec');
    expect(runwayElec.actions).toContainEqual(expect.objectContaining({ t: 'object', ref: assetRef(s.assets.find((a) => a.kind === 'grid')!) }));
    expect(facts(s, fixtureRef('fuel'), 'elec').actions.some((a) => a.t === 'object')).toBe(true);
    const pilot = hotspots(s).find((h) => h.ref.kind === 'staff' && /^Pilot/.test(h.label))!;
    expect(factsText(facts(s, pilot.ref, 'mech'))).toMatch(/No squawk of .* open on your list\.|Written up by|passed on/);
    const keeper = hotspots(s).find((h) => h.ref.kind === 'staff' && /^Housekeeper/.test(h.label))!;
    expect(facts(s, keeper.ref, 'elec').actions.some((a) => a.t === 'object' && a.ref.kind === 'house')).toBe(true);
  });

  it("What's new: Report a problem as it works now (relayed; one a week from each side), and a plane's condition", () => {
    const s = migrate(load('v4-e810cc5-early'));
    for (const role of ROLES) {
      const text = whatsNewMapPanels(s, role).map((p) => vtext(p.body)).join(' ');
      expect(text).toContain("as what its source said (a guest's complaint, the pilot's squawk, the utility's log), passed on by you");
      expect(text).toContain('a trade takes one a week from the other tech and one from the analyst');
      expect(text).not.toMatch(/in your name|receives at most one a week/);
      if (role === 'mech') expect(text).toContain('its condition, the next 100-hr');
      if (role === 'elec') expect(text).toContain('you can still make it safe after your turn');
    }
  });
});

// ---------------------------------------------------------------------------

describe('the map (play-fun and code minors)', () => {
  it('a pilot beside a hooked-up cart stands clear of it: a tap on him opens him, at the whole island and at the most zoom (v4-e810cc5-t5)', () => {
    const s = migrate(load('v4-e810cc5-t5'));
    const spots = hotspots(s);
    const pilot = spots.find((h) => h.ref.kind === 'staff' && /^Pilot/.test(h.label))!;
    const cart = spots.find((h) => h.ref.kind === 'cart' && h.ref.id === 'gpu2')!;
    const overlap = (a: number[], b: number[]) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
    expect(overlap(pilot.foot, cart.foot)).toBe(false);
    for (const [fx, fy] of [
      [0.5, 0.5],
      [0.5, 0.2],
      [0.5, 0.85],
    ])
      for (const ppu of [0.45, 1.8]) {
        const p: [number, number] = [pilot.foot[0] + (pilot.foot[2] - pilot.foot[0]) * fx, pilot.foot[1] + (pilot.foot[3] - pilot.foot[1]) * fy];
        const r = hitTest(spots, p, ppu);
        expect('hit' in r && r.hit.label, `${fx},${fy} at ${ppu}`).toBe(pilot.label);
      }
    // the cart is still the cart
    const c = hitTest(spots, [(cart.foot[0] + cart.foot[2]) / 2, (cart.foot[1] + cart.foot[3]) / 2], 1.8);
    expect('hit' in c && c.hit.ref.kind).toBe('cart');
    expect(PILOT_ASIDE).toBeGreaterThan(24);
  });

  it("two fingers on the map count as two whatever SVG node each lands on (TouchEvent.targetTouches counted only the target's own)", () => {
    const inside = new Set(['path1', 'path2', 'g']);
    const on = { contains: (n: Node | null) => inside.has(n as unknown as string) };
    const t = (target: string) => ({ target: target as unknown as EventTarget });
    expect(fingersOn([t('path1'), t('path2')], on)).toBe(2);
    // a thumb resting elsewhere on the screen isn't the map's
    expect(fingersOn([t('path1'), t('button')], on)).toBe(1);
    expect(fingersOn([], on)).toBe(0);
  });

  it('a narrow touch phone shows only Explore in the map corner (+ − ⌖ hidden inline: two fingers zoom, the All chip is the whole island)', () => {
    const css = readFileSync(resolve(import.meta.dirname, '../src/ui/map/map.css'), 'utf8');
    expect(css).toMatch(/@media \(max-width: 374px\) and \(pointer: coarse\) \{\s*\.map-ctl:not\(\.map-ctl-x\) \.map-zoom \{\s*display: none;/);
    const view = readFileSync(resolve(import.meta.dirname, '../src/ui/map/MapView.tsx'), 'utf8');
    expect(view.match(/class="map-btn map-zoom"/g)).toHaveLength(3);
  });

  it("Explore's whole island on a portrait phone (All, ⌖): the sea is drawn out to the screen's edges, no flat bands of another blue", () => {
    // a 390 x 724 Explore viewport at the whole island (the contain fit): the drawing's region covers the whole view
    const vp = { w: 390, h: 724 };
    const lim = limitsFor('explore', vp);
    const cam = allCam(vp, HOME_SCENE, lim);
    const f = frameOf(cam, vp, HOME_SCENE, 2);
    expect(f.view[1]).toBeLessThan(-400);
    expect(f.region[1]).toBeLessThanOrEqual(f.view[1]);
    expect(f.region[3]).toBeGreaterThanOrEqual(f.view[3]);
    expect(SEA_FAR).toBeGreaterThanOrEqual(-f.view[1]);
    // and the sea and every light over it are drawn that far, their gradients pinned to the old frame
    for (const file of ['../src/ui/island/terrain.tsx', '../src/ui/island/life.tsx']) {
      const src = readFileSync(resolve(import.meta.dirname, file), 'utf8');
      expect(src, file).not.toMatch(/x=\{-60\} y=\{-60\}/);
      for (const m of src.matchAll(/<(radial|linear)Gradient id="i-(sea|nightvig|stormvig|dawn|dawnsun|golden|goldsun|stormtop)"[^>]*>/g)) expect(m[0], m[2]).toMatch(/gradientUnits="userSpaceOnUse" gradientTransform=/);
    }
  });
});
