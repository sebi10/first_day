// The quick checks' data (docs/EXPANSION.md 6.4, stage 2): what each check can
// see, where on the asset it shows, the pools of look-alike phrasings, the home
// panel's breaker schedule and the houses' circuits. Pure data, and import-light
// on purpose: alerts.ts folds the write-up rows below into SYMPTOMS, so this
// file never imports alerts.ts at run time (only its types). The logic that
// reads it is checks.ts. Tune here.
import type { PlaneModel } from './aircraft';
import type { Cause, Symptom } from './alerts';

export type CheckKind = 'walkaround' | 'ir' | 'meter';

// ---------------------------------------------------------------------------
// The walkaround (the mechanic): zones per airframe, and the generator's

export type WalkZone = 'nose' | 'lmain' | 'rmain' | 'lnac' | 'rnac' | 'cowl' | 'root' | 'tail' | 'lfloat' | 'rfloat' | 'mounts' | 'belt' | 'exhaust' | 'enclosure';

/** the zones in walkaround order (a real walkaround circles the whole aircraft), with their labels on this airframe */
export const WALK_ZONES: Record<PlaneModel | 'gen', { id: WalkZone; label: string }[]> = {
  twin: [
    { id: 'nose', label: 'Nose gear' },
    { id: 'lmain', label: 'L main' },
    { id: 'lnac', label: 'L nacelle' },
    { id: 'root', label: 'Wing root' },
    { id: 'rnac', label: 'R nacelle' },
    { id: 'rmain', label: 'R main' },
  ],
  cargo: [
    { id: 'nose', label: 'Nose gear' },
    { id: 'cowl', label: 'Cowl and nacelle' },
    { id: 'lmain', label: 'L main' },
    { id: 'root', label: 'Wing root' },
    { id: 'tail', label: 'Empennage' },
    { id: 'rmain', label: 'R main' },
  ],
  float: [
    { id: 'cowl', label: 'Cowl' },
    { id: 'lfloat', label: 'L float (gear)' },
    { id: 'root', label: 'Wing root' },
    { id: 'tail', label: 'Empennage' },
    { id: 'rfloat', label: 'R float (gear)' },
  ],
  gen: [
    { id: 'mounts', label: 'Mounts' },
    { id: 'belt', label: 'Belt' },
    { id: 'exhaust', label: 'Exhaust' },
    { id: 'enclosure', label: 'Enclosure' },
  ],
};

/** the words for a zone mid-sentence ("the L main", "the generator's belt") */
export const ZONE_WORD: Record<WalkZone, string> = {
  nose: 'nose gear',
  lmain: 'L main',
  rmain: 'R main',
  lnac: 'L nacelle',
  rnac: 'R nacelle',
  cowl: 'cowl',
  root: 'wing root',
  tail: 'empennage',
  lfloat: 'L float gear',
  rfloat: 'R float gear',
  mounts: "generator's mounts",
  belt: "generator's belt",
  exhaust: "generator's exhaust",
  enclosure: "generator's enclosure",
};

/**
 * What a walkaround can see (6.4 scope), by catalog kind: the zones it shows in and its tells, one variant per fix
 * (a tire's tread and a lining's wear pin are both `tires`, with different tasks). `late`: only once the asset is
 * CHECK.depth points under the kind's threshold (the oil change's and the cylinder's engine look is inside the
 * cowling; a walkaround sees only what reaches the belly). Out of scope: prop, wire, alternator, avionics, wb,
 * inspect100 (the 100-hr and the records find those).
 */
export const WALK_SCOPE: Record<string, { zones: WalkZone[]; late?: boolean; tells: { cause: Omit<Cause, 'w' | 'kind'>; texts: string[] }[] }> = {
  tires: {
    zones: ['lmain', 'rmain', 'lfloat', 'rfloat'],
    tells: [
      {
        cause: { fix: '32-40-01', needs: ['tire', 'tube'], finding: 'Tread at 2/32 in on the outboard shoulder, no cords showing; the sidewall sound. Change the tire and tube.' },
        texts: ['The outboard shoulder is worn to the bottom of the groove.', 'The outboard shoulder is worn smooth; the grooves just show.', 'Shoulder tread flush with the wear bar on one side.'],
      },
      {
        cause: { fix: '32-40-02', needs: ['lining'], finding: 'Linings 0.06 in (limit 0.10); the disc within limits. Replace the linings.' },
        // (review round 1: these airframes' brakes are Cleveland-type: the lining is measured, there's no wear pin)
        texts: ['Linings about 1/16 in at the caliper.', 'The linings look thin at the caliper: about a sixteenth left.', 'Lining thickness at the caliper about 0.06 in, both pucks.'],
      },
    ],
  },
  hydraulics: {
    zones: ['lmain', 'rmain', 'lfloat', 'rfloat'],
    tells: [
      {
        cause: { fix: '32-42-01', models: ['twin', 'float'], finding: 'A caliper piston seal weeping; the reservoir at ADD. Service the brake hydraulics and bleed them.' },
        texts: ['The caliper is wet below the piston; a drop hangs from it.', 'A damp film of red fluid on the caliper housing.', 'Red fluid weeping at the caliper piston boot.'],
      },
    ],
  },
  corrosion: {
    zones: ['lmain', 'rmain', 'lfloat', 'rfloat'],
    tells: [
      {
        cause: { fix: '32-40-03', finding: 'Blistered paint and pitting at the wheel-half tie bolts. Strip, treat, penetrant-inspect, coat and refit.' },
        texts: ['Bubbled paint and white powder around the wheel-half tie bolts.', 'A little white powder at two tie-bolt heads.', 'Paint lifting in a ring along the wheel-half seam.'],
      },
    ],
  },
  spar: {
    zones: ['root'],
    tells: [
      {
        cause: { fix: '57-10-01', finding: 'Black streaks behind four root rivets; the fairing moves under hand pressure. Inspect the spar cap.' },
        texts: ['A dark ring around two rivets at the wing root.', 'Grey streaks trailing aft of a few root rivets.', 'Paint cracked in a circle round a root rivet head.'],
      },
    ],
  },
  oil: {
    zones: ['lnac', 'rnac', 'cowl'],
    late: true,
    tells: [
      {
        cause: { fix: '79-00-01', models: ['twin', 'float'], needs: ['oilFilter'], finding: 'Drain-plug safety wire broken, the plug backing off; the filter gasket dry. Oil and filter change, and re-safety it.' },
        texts: ['Fresh oil on the belly aft of the cowl flap.', 'An oily streak along the belly skin behind the cowling.', 'Oil drips from the cowl flap after the run.'],
      },
    ],
  },
  cylinder: {
    zones: ['lnac', 'rnac', 'cowl'],
    late: true,
    tells: [
      {
        cause: { fix: '72-30-01', models: ['twin', 'float'], finding: 'Oil weeping at the #4 cylinder base; 52/80 on the differential compression test, air at the breather. Change the cylinder.' },
        texts: ['Oil wet at a cylinder base, seen through the cowl flap.', "Fresh oil around one cylinder's base nuts.", 'Oil staining at the back of the engine around a cylinder base.'],
      },
    ],
  },
  genService: {
    zones: ['mounts', 'belt', 'exhaust'],
    tells: [
      {
        cause: { fix: 'gsm:2-4', needs: ['isolator'], finding: 'Two isolators cracked and oil-soaked; the mount bolts loose. Replace the isolators.' },
        texts: ['One mount rubber cracked through and oil-soaked.', 'An isolator bulged and split at one corner.', 'The set sits lower on one corner; the rubber there is cracked.'],
      },
      {
        cause: { fix: 'gsm:2-1', finding: 'Belt glazed and slipping; the lower hose beside it soft and weeping at its clamp; the oil 2 qt low. Service the set.' },
        texts: ["The belt's sides are glazed and shiny.", 'Belt glazed; black dust under the guard.', 'The belt deflects twice what the decal allows.'],
      },
      {
        cause: { fix: 'gsm:2-1', finding: 'Soot at the exhaust manifold joint; the oil 2 qt low and black. Service the set.' },
        texts: ['Soot fanned out around the exhaust manifold joint.', 'Black streaks at the manifold gasket.', 'A sooty ring at the exhaust flange.'],
      },
    ],
  },
};
/**
 * the turbine Caravan's cowl (review round 1): a PT6 has no cowl flaps and no sump drain on the engine; its benign
 * signs are its own (the stack, the accessory-gearbox breather, the fuel purge)
 */
export const WALK_BENIGN_TURBINE: Partial<Record<WalkZone, string[]>> = {
  cowl: ['Soot on the exhaust stacks; the stack welds sound.', 'A light oil film at the accessory gearbox breather.', 'A drop of fuel at the fuel nozzle drain after shutdown.', 'Oil streak along the lower cowl from the last start, dry.'],
};

/** a generator tell's variant is its zone's (the mount isolators, the belt, the exhaust) */
export const GEN_TELL_ZONE: WalkZone[] = ['mounts', 'belt', 'exhaust'];

/**
 * what a zone shows when nothing is coming: three or more phrasings each, some of them alarming-sounding (all within
 * limits). Review round 1: the wheels' lines read like the tells, a measurement or a look to judge against the limit
 * (the linings at 1/8 in against 1/16, a dry old dye stain against a wet film, a shoulder worn but its groove clear),
 * so a line a player hasn't seen yet can't be called a tell unread
 */
export const WALK_BENIGN: Record<WalkZone, string[]> = {
  nose: ['Oleo extension within the placard; a film of oil on the chrome.', 'Nose tire tread even; two small cuts under the limit.', 'Torque links: a little play at the bushing, within limits.', 'Shimmy damper rod wet with a thin film, no drip.'],
  lmain: [
    'Brake dust on the wheel face; the disc bright where the linings ride.',
    "A shallow cut in the tire's sidewall, not into the cords.",
    'Fine heat-check lines on the brake disc face.',
    'Linings about 1/8 in at the caliper.',
    'The outboard shoulder is worn more than the inboard; its groove still clear.',
    'An old film of red dye on the caliper housing, dry to the touch.',
  ],
  rmain: [
    'Brake dust on the wheel face; the disc bright where the linings ride.',
    "A shallow cut in the tire's sidewall, not into the cords.",
    'Fine heat-check lines on the brake disc face.',
    'Linings about 3/16 in at the caliper, both pucks.',
    'Tread even across the crown; the grooves clear at the shoulder.',
    'Old red dye stain on the strut, dry to the touch.',
  ],
  lfloat: ['Pump-out cups dry; a cupful of water in one compartment.', 'Keel strip scuffed from the ramp.', 'Brake dust on the retractable wheel.', "A shallow cut in the tire's sidewall, not into the cords.", 'Linings about 1/8 in at the caliper.'],
  rfloat: ['Pump-out cups dry; a cupful of water in one compartment.', 'Keel strip scuffed from the ramp.', 'Brake dust on the retractable wheel.', "A shallow cut in the tire's sidewall, not into the cords.", 'An old film of red dye on the caliper housing, dry to the touch.'],
  lnac: ['A light oil mist at the breather tube outlet.', 'Exhaust soot streaks along the lower cowl.', 'A drop of fuel at the sump drain after sumping.', 'An oil smudge on the cowl flap hinge from the last oil change.'],
  rnac: ['A light oil mist at the breather tube outlet.', 'Exhaust soot streaks along the lower cowl.', 'A drop of fuel at the sump drain after sumping.', 'An oil smudge on the cowl flap hinge from the last oil change.'],
  cowl: ['A light oil mist at the breather tube outlet.', 'Exhaust soot streaks along the lower cowl.', 'A drop of fuel at the sump drain after sumping.', 'An oil smudge on the cowl flap hinge from the last oil change.'],
  root: ["Paint chipped along the fairing's leading edge.", 'The skin panel near the root oil-cans and pops back.', 'A hairline crack in the paint along a fairing seam; the rivets tight.', 'Fairing screws all present; one a little loose in its dimple.'],
  tail: ['Elevator hinge play within limits.', 'One static wick frayed, still attached.', 'Light surface rust on the tail tie-down ring.', 'Bird droppings on the stabilizer; the skin sound underneath.'],
  mounts: ['The isolators weathered on the surface, firm under a bar.', "A mount bolt's paint cracked at the washer; the bolt tight.", 'Rust bloom on the base frame.'],
  belt: ['Belt tension right; a little dust on the guard.', "A few frayed threads at the belt's edge.", "The test log: the belt squealed for a second at last week's start, then went quiet."],
  exhaust: ['A light soot film at the rain cap.', 'Heat discoloration on the muffler shell.', 'Surface rust on the flex section.'],
  enclosure: ['Louvres clear; a wasp nest in one corner.', 'Door seal worn; the enclosure dry inside.', 'A puddle of rainwater by the door; the floor dry under the set.'],
};

// ---------------------------------------------------------------------------
// The IR scan (the electrician): the home panel's breaker schedule by tier, and the transfer switch

export type IrBreaker = { id: string; label: string; amps: number; awg: string; from: number };

/**
 * the island's distribution panel (home: derived from the tier's feeders; 6.4). Every conductor at its 75 °C ampacity
 * (NEC Table 310.16) for its breaker. The main: two parallel sets of 250 kcmil Al (205 A each, 410 A), not a single
 * run: 500 kcmil Al is 310 A, and Table 310.12's 600 kcmil Al for 400 A is a dwelling's service (this panel feeds the
 * hangar, the office and the fuel dock too; under 310.16 600 kcmil Al is 340 A)
 */
export const HOME_PANEL: IrBreaker[] = [
  { id: 'main', label: 'Main', amps: 400, awg: '2 × 250 kcmil Al', from: 1 },
  { id: 'cfeedE', label: 'East cottages feeder', amps: 100, awg: '#3 Cu', from: 1 },
  { id: 'hangar', label: 'Hangar', amps: 60, awg: '#6 Cu', from: 1 },
  { id: 'office', label: 'Office', amps: 30, awg: '#10 Cu', from: 1 },
  { id: 'dock', label: 'Fuel dock', amps: 30, awg: '#10 Cu', from: 1 },
  { id: 'cfeedW', label: 'West cottages feeder', amps: 100, awg: '#3 Cu', from: 2 },
  { id: 'xfer', label: 'Transfer switch feed', amps: 60, awg: '#6 Cu', from: 3 },
  { id: 'villas', label: 'Villas feeder', amps: 125, awg: '#1 Cu', from: 4 },
  { id: 'lodge', label: 'Lodge feeder', amps: 150, awg: '1/0 Cu', from: 5 },
  { id: 'edge', label: 'Runway edge lights', amps: 20, awg: '#12 Cu', from: 5 },
];

/**
 * the generator house, scanned during the weekly test run (the set carrying the backed-up load). The transfer switch as
 * installed is 60 A on #6 (the electrician's `transfer` job finds the houses have outgrown it); the generator's main
 * breaker feeding it is 60 A too: a switch is rated at least the breaker ahead of it
 */
export const GEN_PANEL: IrBreaker[] = [
  { id: 'xferG', label: 'Transfer switch, generator-side lugs', amps: 60, awg: '#6 Cu', from: 3 },
  { id: 'xferL', label: 'Transfer switch, load-side lugs', amps: 60, awg: '#6 Cu', from: 3 },
  { id: 'genbrk', label: 'Generator main breaker', amps: 60, awg: '#6 Cu', from: 3 },
  { id: 'xferU', label: 'Transfer switch, utility-side lugs (open)', amps: 60, awg: '#6 Cu', from: 3 },
];

/**
 * the Resort's service upgrade (G0, WARRANTY.service.gen): a bigger standby set and a 200 A automatic transfer switch on
 * 3/0 Cu (200 A at 75 °C, Table 310.16), the set's main breaker to match. Review round 1: the upgrade changed nothing the
 * electrician read; the IR scan and the generator sheet still showed the 60 A switch
 */
export const GEN_UPGRADE = { amps: 200, awg: '3/0 Cu', words: 'a 200 A automatic transfer switch' };
/** the generator house's schedule as installed: before the Resort's upgrade, or after it */
export const genPanel = (upgraded: boolean): IrBreaker[] => (upgraded ? GEN_PANEL.map((b) => ({ ...b, amps: GEN_UPGRADE.amps, awg: GEN_UPGRADE.awg })) : GEN_PANEL);

/** the IR scan's scope: which breakers a kind's tell can show on */
export const IR_SCOPE: Record<string, { on: 'branch' | 'main' | 'xfer' }> = {
  xfmr: { on: 'branch' },
  panelUp: { on: 'main' },
  transfer: { on: 'xfer' },
};

/**
 * the bands (6.4, tune): a healthy breaker's rise over ambient is about riseFull x (load share)^2. Review round 1: the
 * look-alike stays under the 80% line the help quotes (70-79%, 10-13 °C: warm, and right for its load; at 85-95% and
 * 14-18 °C a licensed electrician applying the screen's own rules wrote it up every week); a reading under NFPA 70B's
 * 40% is marked too light to judge (it said 40 and marked 30); the generator's three terminations carry one current, so
 * a healthy set reads within about 2 °C across them (one shared offset, then ±genEach each; ±3 each read 4 °C apart in
 * one scan in ten)
 */
export const IR = {
  riseFull: 20,
  normal: 3,
  tell: [10, 20] as [number, number],
  tellLoad: [40, 70] as [number, number],
  distractorLoad: [70, 79] as [number, number],
  distractorRise: [10, 13] as [number, number],
  tooLight: 40,
  panelUp: [82, 95] as [number, number],
  genShared: 1,
  genEach: 0.8,
};
/** the branches no tell or look-alike shows on in an afternoon scan: the runway edge lights are a night load, off by day */
export const IR_DAY_OFF = ['edge'];

// ---------------------------------------------------------------------------
// The meter check (the electrician): a house's circuits, with a 12 A load on

export type Circuit = { id: string; label: string; room: 'kitchen' | 'bath' | 'bedroom' | 'living' | 'laundry' | 'outdoor' | 'hall'; amps: 15 | 20; awg: 12 | 14; gfci: boolean; run: [number, number]; models?: string[] };

export const HOUSE_CIRCUITS: Circuit[] = [
  { id: 'kitchen1', label: 'Kitchen counter A', room: 'kitchen', amps: 20, awg: 12, gfci: true, run: [15, 35] },
  { id: 'kitchen2', label: 'Kitchen counter B', room: 'kitchen', amps: 20, awg: 12, gfci: true, run: [20, 45] },
  { id: 'bath', label: 'Bath', room: 'bath', amps: 20, awg: 12, gfci: true, run: [25, 48] },
  { id: 'laundry', label: 'Laundry', room: 'laundry', amps: 20, awg: 12, gfci: true, run: [25, 48], models: ['villa', 'lodge'] },
  { id: 'bedroom', label: 'Bedroom', room: 'bedroom', amps: 15, awg: 14, gfci: false, run: [40, 80] },
  { id: 'bedroom2', label: 'Bedroom 2', room: 'bedroom', amps: 15, awg: 14, gfci: false, run: [45, 85], models: ['villa', 'lodge'] },
  { id: 'living', label: 'Living room', room: 'living', amps: 15, awg: 14, gfci: false, run: [35, 70] },
  { id: 'hall', label: 'Hall', room: 'hall', amps: 15, awg: 14, gfci: false, run: [30, 48] },
  // the long run: 120-150 ft of 12 AWG out to the porch, normal for its length (the meter check's distractor)
  { id: 'porch', label: 'Porch', room: 'outdoor', amps: 20, awg: 12, gfci: true, run: [120, 150] },
];
/** the service at the panel: both legs under the load (a loose neutral: one sags, the other rises) */
export const SERVICE_ID = 'service';

/** ohms per 1,000 ft of copper, and the bands (6.4, tune) */
export const METER = { ohms: { 12: 1.6, 14: 2.5 } as Record<12 | 14, number>, load: 12, tripDrop: [5, 9] as [number, number], tripRunUnder: 50, flickerLow: [104, 110] as [number, number], flickerHigh: [130, 136] as [number, number] };

export const METER_SCOPE: Record<string, { on: 'short' | 'gfci' | 'service' }> = {
  trip: { on: 'short' },
  gfci: { on: 'gfci' },
  flicker: { on: 'service' },
};

export const GFCI_OK = ['test button trips it; the reset holds', 'test button trips it with a loud snap; the reset holds', 'trips on the tester at 6 mA; resets'];
export const GFCI_TELL = ['test button clicks; the receptacle stays live', "test button clicks; the tester's lights stay on", 'a click on test, and the radio plugged in keeps playing'];

// ---------------------------------------------------------------------------
// The write-up rows: one symptom per check item (right and wrong calls raise the same row, so the alert reads the
// same until Investigate). Folded into SYMPTOMS by alerts.ts; `auto`: never drawn by the week's slots.

const PLANE_ZONES: Partial<Record<WalkZone, PlaneModel[]>> = {
  nose: ['twin', 'cargo'],
  lmain: ['twin', 'cargo'],
  rmain: ['twin', 'cargo'],
  lnac: ['twin'],
  rnac: ['twin'],
  cowl: ['cargo', 'float'],
  root: ['twin', 'cargo', 'float'],
  tail: ['cargo', 'float'],
  lfloat: ['float'],
  rfloat: ['float'],
};

/** the causes a walkaround row carries: every in-scope tell variant that shows in its zone */
function walkCauses(zone: WalkZone): Cause[] {
  const out: Cause[] = [];
  for (const [kind, sc] of Object.entries(WALK_SCOPE)) {
    if (!sc.zones.includes(zone)) continue;
    sc.tells.forEach((t, i) => {
      // the generator's variants are one per zone
      if (kind === 'genService' && GEN_TELL_ZONE[i] !== zone) return;
      out.push({ kind, w: 1, ...t.cause });
    });
  }
  return out;
}

/** the row key of a check item: `K_walk:lmain`, `K_ir:hangar`, `K_meter:kitchen1` */
export const checkRowKey = (kind: CheckKind, item: string) => `K_${kind === 'walkaround' ? 'walk' : kind}:${item}`;

/** each row's check and its words, for the feed and the review */
export const CHECK_ROWS: Record<string, { kind: CheckKind; item: string; word: string }> = {};

function walkRows(): Symptom[] {
  const out: Symptom[] = [];
  for (const zone of Object.keys(ZONE_WORD) as WalkZone[]) {
    const key = checkRowKey('walkaround', zone);
    const word = ZONE_WORD[zone];
    CHECK_ROWS[key] = { kind: 'walkaround', item: zone, word };
    const gen = zone === 'mounts' || zone === 'belt' || zone === 'exhaust' || zone === 'enclosure';
    out.push({
      key,
      role: 'mech',
      src: 'check',
      text: `Written up at {who}'s walkaround: the ${word}.`,
      short: `the ${word} ({who}'s walkaround)`,
      ...(gen ? { targets: ['gen'] } : { models: PLANE_ZONES[zone] ?? [], aw: true }),
      lead: [1, 2],
      auto: true,
      causes: walkCauses(zone),
      nff: [{ w: 1, finding: `A closer look at the ${word}: nothing out of limits. Close it as no fault found.` }],
    });
  }
  return out;
}

function irRows(): Symptom[] {
  const out: Symptom[] = [];
  for (const b of HOME_PANEL) {
    const key = checkRowKey('ir', b.id);
    const word = `${midWord(b.label)} breaker`;
    CHECK_ROWS[key] = { kind: 'ir', item: b.id, word };
    const causes: Cause[] =
      b.id === 'main'
        ? [{ kind: 'panelUp', w: 1, fix: 'ref:panel', finding: 'Logged over the afternoon: the main carries 82-95% of its rating for three hours and more; the bus lugs are at their limit. Plan the panel upgrade.' }]
        : [{ kind: 'xfmr', w: 1, fix: 'ref:deadckt', finding: `The ${midWord(b.label)} breaker's lug is loose and discoloured, running hot for its load. Re-terminate it; check the breaker.` }];
    out.push({
      key,
      role: 'elec',
      src: 'check',
      text: `Written up on {who}'s IR scan: the ${word}.`,
      short: `the ${word} ({who}'s IR scan)`,
      targets: ['panel'],
      rooms: ['panel'],
      lead: [1, 2],
      auto: true,
      causes,
      nff: [{ w: 1, finding: `Re-scanned at the same load: the ${word} runs as its load predicts. Nothing to open up.` }],
    });
  }
  for (const b of GEN_PANEL) {
    const key = checkRowKey('ir', b.id);
    const word = midWord(b.label).replace(/ \(open\)$/, '');
    CHECK_ROWS[key] = { kind: 'ir', item: b.id, word };
    const causes: Cause[] =
      b.id === 'xferG' || b.id === 'xferL'
        ? [{ kind: 'transfer', w: 1, fix: 'ref:xfer', finding: `The transfer switch's ${b.id === 'xferG' ? 'generator-side' : 'load-side'} lugs pitted and discoloured, hot for the load they carry. Replace the transfer switch.` }]
        : [];
    out.push({
      key,
      role: 'elec',
      src: 'check',
      text: `Written up on {who}'s IR scan: the ${word}.`,
      short: `the ${word} ({who}'s IR scan)`,
      targets: ['gen'],
      rooms: ['gen'],
      lead: [1, 2],
      auto: true,
      causes,
      nff: [{ w: 1, finding: `Re-scanned during the next test run: the ${word} runs as it should for its load. Nothing to open up.` }],
    });
  }
  return out;
}

/** "Kitchen counter A" mid-sentence: "kitchen counter A" */
const midWord = (label: string) => label.charAt(0).toLowerCase() + label.slice(1);

function meterRows(): Symptom[] {
  const out: Symptom[] = [];
  for (const c of HOUSE_CIRCUITS) {
    const key = checkRowKey('meter', c.id);
    const word = `${midWord(c.label)} circuit`;
    CHECK_ROWS[key] = { kind: 'meter', item: c.id, word };
    // the job's site is the circuit the meter read (its breaker and conductors)
    const site = { amps: c.amps, awg: c.awg };
    const causes: Cause[] = [{ kind: 'trip', w: 1, fix: 'ref:outlet', rooms: [c.room], site, finding: `A backstabbed receptacle on the ${midWord(c.label)} run, loose and discoloured: the volts drop under load. Replace it.` }];
    if (c.gfci) causes.push({ kind: 'gfci', w: 1, fix: 'ref:gfci', rooms: [c.room], site, finding: `The ${midWord(c.label)} GFCI doesn't open on its test button: failed. Replace it.` });
    out.push({
      key,
      role: 'elec',
      src: 'check',
      text: `Written up on {who}'s meter check: the ${word}.`,
      short: `the ${word} ({who}'s meter check)`,
      targets: ['cottage', 'villa', 'lodge'],
      rooms: [c.room],
      lead: [1, 2],
      auto: true,
      causes,
      nff: [{ w: 1, rooms: [c.room], finding: `Re-tested with the load on: the ${word} reads as its run should. Nothing to replace.` }],
    });
  }
  const key = checkRowKey('meter', SERVICE_ID);
  CHECK_ROWS[key] = { kind: 'meter', item: SERVICE_ID, word: 'service legs' };
  out.push({
    key,
    role: 'elec',
    src: 'check',
    text: "Written up on {who}'s meter check: the service legs.",
    short: "the service legs ({who}'s meter check)",
    targets: ['cottage', 'villa', 'lodge'],
    rooms: ['living'],
    lead: [1, 2],
    auto: true,
    causes: [{ kind: 'flicker', w: 1, fix: 'ref:flicker', rooms: ['living'], finding: 'The neutral lug at the panel loose: under load one leg sags to 106 V while the other rises to 133 V. Re-terminate the neutral.' }],
    nff: [{ w: 1, rooms: ['living'], finding: 'Both legs re-read under load within 2 V of each other. Nothing to fix.' }],
  });
  return out;
}

/** every quick-check write-up row (SYMPTOMS keys `K_…`) */
export const CHECK_SYMPTOMS: Symptom[] = [...walkRows(), ...irRows(), ...meterRows()];
