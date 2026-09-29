// Alerts: where jobs come from (docs/JOBFLOW.md 5). A pilot's squawk, an
// engine trend, a wear limit, a due item, an AD, a guest's complaint, a
// utility reading, a code notice, a take-off for an install. Each alert
// stores its hidden cause (the catalog kind that fixes it, and which of its
// symptom's causes it is), like s.defects does: the UI never shows it before
// the job is signed off. Its text, the finding Investigate shows, the
// electrical site and the fix all derive from the symptom, the cause and the
// alert's seed.
import { planeModel, type PlaneModel } from './aircraft';
import { islandAircraft, manualCard } from './chain';
import { ALERTS, CATALOG, CATALOG_BY_KIND, LATE, MODELS } from './data';
import { FEED_KINDS, gridFirst } from './econ';
import { hashSeed, rng, type Rng } from './rng';
import { helperJobs, pilotOf, squawkNff, wearMult } from './staff';
import { defaultTask, taskOn, type Task } from './tasks';
import type { Alert, AlertSrc, Asset, ElecSite, IslandState, OpsRole, RepairInfo, Role, TaskId } from './types';

type Room = ElecSite['room'];
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export type Cause = {
  /** the catalog kind that fixes it; 'wiring': the electrician's fix at the airplane (5.4) */
  kind: string;
  w: number;
  /** the fixing task: an AMM task number ('32-42-01'; '05-20' is the model's inspection), 'ref:gfci', 'gsm:2-1' */
  fix?: string;
  /** the raw finding Investigate shows */
  finding?: string;
  /**
   * the only guest plane's early sign (5.6): the same cause caught before it is a no-go item, a condition still
   * within limits (a pilot flying it wouldn't be flying an unairworthy plane). Investigate shows it when the alert
   * was raised with the sole wording
   */
  soleFinding?: string;
  /** the main slots it requires (the task's other slots are optional) */
  needs?: string[];
  /** elec: only in these rooms */
  rooms?: Room[];
  /** mech: only on these models */
  models?: PlaneModel[];
  /** the site this cause implies (a 20 A hall circuit, a GFCI upstream) */
  site?: Partial<ElecSite>;
  /** a service-neutral fault: a branch breaker doesn't isolate it (10) */
  neutral?: boolean;
};

export type Symptom = {
  key: string;
  role: OpsRole;
  src: AlertSrc;
  /** {side} {other} {Eng} {pilot} {plane} {h} {n} {lead} {house} {room} {appliance} {amps} {feet} {leg} */
  text: string | Partial<Record<PlaneModel, string>>;
  /** E_STORM_DEAD with no storm last week */
  alt?: string;
  models?: PlaneModel[];
  targets?: string[];
  rooms?: Room[];
  aw?: boolean;
  hazard?: boolean;
  /** the models with company MEL relief (category C) */
  mel?: PlaneModel[];
  lead: [number, number];
  bench?: boolean;
  intermittent?: boolean;
  causes: Cause[];
  nff?: { w: number; finding: string; rooms?: Room[] }[];
  /** the only guest plane: the early-sign wording and its lead; 'none': never raised there */
  sole?: { text: string; lead: [number, number] } | 'none';
  /** the task the Manual step opens with (due items, ADs, code notices, take-offs, write-ups) */
  prefilled?: boolean;
  /** raised only by something that happened (a hard landing), never drawn by the week's slots */
  auto?: boolean;
  /** a write-up (the squawk action): the catalog kind it names */
  writeUp?: string;
};

const ALL: PlaneModel[] = ['twin', 'cargo', 'float'];
const PISTONS: PlaneModel[] = ['twin', 'float'];
const HOUSES = ['cottage', 'villa', 'lodge'];

const MECH: Symptom[] = [
  {
    key: 'M_BRAKE_SOFT',
    role: 'mech',
    src: 'squawk',
    text: '{side} brake pedal soft; pulls {other} on the landing roll.',
    models: ALL,
    aw: true,
    lead: [0, 0],
    causes: [
      {
        kind: 'hydraulics',
        w: 3,
        fix: '32-42-01',
        models: PISTONS,
        finding: 'Pedal sinks, then firms up after two or three pumps; reservoir at ADD; no leaks at the caliper.',
        soleFinding: 'Pedal firm after one pump, a little more travel than the other side; reservoir just under FULL; no leaks at the caliper.',
      },
      {
        kind: 'tires',
        w: 2,
        fix: '32-40-02',
        finding: '{side} linings 0.06 in (limit 0.10); pedal firm; no leaks.',
        soleFinding: '{side} linings 0.12 in (limit 0.10): at this wear, at the limit in about two weeks. Pedal firm; no leaks.',
        needs: ['lining'],
      },
    ],
    sole: { text: '{side} brake pedal travel increasing; firm at the stop.', lead: [1, 2] },
  },
  {
    key: 'M_BRAKE_CHATTER',
    role: 'mech',
    src: 'squawk',
    text: 'Brakes chatter and grab on taxi.',
    models: ALL,
    lead: [1, 2],
    causes: [{ kind: 'tires', w: 3, fix: '32-40-02', finding: 'Linings glazed; disc heat-checked, within limits.', needs: ['lining'] }],
    nff: [{ w: 1, finding: 'Taxi test smooth; linings 0.18 in; disc in limits. Could not duplicate.' }],
  },
  {
    key: 'M_TIRE_WORN',
    role: 'mech',
    src: 'wear',
    text: '{side} main tire at 2/32 in on the outboard shoulder: change within {lead} weeks.',
    models: ALL,
    aw: true,
    lead: [1, 3],
    causes: [{ kind: 'tires', w: 1, fix: '32-40-01', finding: 'Tread 2/32 in at the shoulder, no cords; sidewall sound.', needs: ['tire', 'tube'] }],
  },
  {
    key: 'M_TIRE_PRESSURE',
    role: 'mech',
    src: 'squawk',
    text: '{side} main tire loses 5 psi overnight.',
    models: ALL,
    aw: true,
    intermittent: true,
    lead: [1, 1],
    causes: [
      { kind: 'tires', w: 3, fix: '32-40-01', finding: 'Soap test: a pinhole in the tube at the valve stem base; the wheel halves are dry.', needs: ['tube'] },
      { kind: 'corrosion', w: 1, fix: '32-40-03', finding: "Tire off: the tube chafed through over a corrosion pit at the outer half's bead seat.", needs: ['tube'] },
    ],
    nff: [{ w: 1, finding: 'Held pressure 24 h after a top-up: a cold night. Could not duplicate.' }],
  },
  {
    key: 'M_WHEEL_CORROSION',
    role: 'mech',
    src: 'finding',
    text: 'Corrosion blistering on the {side} wheel half at the bead seat (tire off at the last change).',
    models: ALL,
    aw: true,
    lead: [1, 2],
    causes: [{ kind: 'corrosion', w: 1, fix: '32-40-03', finding: 'Blistered at the bead seat, pitting under the paint. Strip, treat, penetrant-inspect, coat and refit.' }],
  },
  {
    key: 'M_HARD_LANDING',
    role: 'mech',
    src: 'landing',
    text: 'Hard landing reported by {pilot} on {plane}: inspect the gear, the tires and the wing root.',
    models: ALL,
    aw: true,
    lead: [0, 0],
    auto: true,
    causes: [
      { kind: 'tires', w: 2, fix: '32-40-01', finding: '{side} tire sidewall cut by the rim on touchdown; the wheel undamaged.', needs: ['tire', 'tube'] },
      { kind: 'spar', w: 1, fix: '57-10-01', finding: 'Wing-root fairing rivets working; spar cap to be checked.' },
    ],
    nff: [{ w: 2, finding: 'Gear, tires and wing root inspected: no damage. Nothing to order.' }],
    sole: 'none',
  },
  {
    key: 'M_PROP_VIB',
    role: 'mech',
    src: 'squawk',
    text: 'Vibration at cruise that changes with rpm.',
    models: ALL,
    aw: true,
    lead: [0, 0],
    causes: [
      {
        kind: 'prop',
        w: 3,
        fix: '61-10-01',
        finding: 'Torque stripes moved on two prop bolts; no fretting at the flange: re-torque them.',
        soleFinding: 'Two prop bolts at the bottom of the torque band, stripes intact, no fretting at the flange.',
      },
      {
        kind: 'prop',
        w: 1,
        fix: '61-10-01',
        finding: 'Blade track 3/16 in out (limit 1/16): the prop sits cocked on its flange.',
        soleFinding: 'Blade track 1/16 in out, at the limit; the prop sits true on its flange.',
      },
    ],
    nff: [{ w: 1, finding: 'Run-up smooth; blades and spinner undamaged. Could not duplicate.' }],
    sole: { text: 'A light vibration at cruise, smooth at other rpm.', lead: [1, 2] },
  },
  {
    key: 'M_PROP_AD',
    role: 'mech',
    src: 'ad',
    text: 'AD 2014-22-08 blade clamp bolt torque check due in {lead} weeks.',
    models: ['cargo'],
    aw: true,
    lead: [2, 3],
    prefilled: true,
    causes: [{ kind: 'prop', w: 1, fix: '61-10-01' }],
  },
  {
    key: 'M_SAFETY_WIRE',
    role: 'mech',
    src: 'finding',
    text: 'Safety wire broken on a prop bolt pair at the preflight.',
    models: ALL,
    aw: true,
    lead: [0, 0],
    causes: [
      {
        kind: 'wire',
        w: 1,
        fix: '61-10-02',
        finding: 'The wire parted at the twist; both bolts still at their torque stripes.',
        soleFinding: 'The wire is nicked at the twist, not parted: still tight; both bolts at their torque stripes.',
      },
    ],
    sole: { text: 'Safety wire on a prop bolt pair nicked at the preflight; still tight.', lead: [1, 1] },
  },
  {
    key: 'M_COM_DEAD',
    role: 'mech',
    src: 'squawk',
    text: 'Com 1 dead on transmit.',
    models: ALL,
    aw: true,
    mel: ['twin', 'cargo'],
    lead: [0, 0],
    bench: true,
    causes: [
      { kind: 'avionics', w: 7, fix: '23-10-01', finding: 'No sidetone, no carrier on the test set; 27.8 V at the tray, keyed or not.', needs: ['radio'] },
      { kind: 'wiring', w: 3, finding: '27.8 V at the tray unkeyed, 20 V keyed: a loose power pin sags under the transmit load; the radio transmits on the bench.' },
    ],
  },
  {
    key: 'M_COM_INTERMITTENT',
    role: 'mech',
    src: 'squawk',
    text: 'Com 1 cuts out over bumps.',
    models: ALL,
    mel: ['twin', 'cargo'],
    intermittent: true,
    lead: [1, 2],
    causes: [{ kind: 'avionics', w: 2, fix: '23-10-01', finding: 'Wiggle test at the tray: drops out; cam lock backed off, connector pins dull.', needs: ['connector'] }],
    nff: [{ w: 2, finding: 'Ops check on ground power normal; no dropout on the wiggle test. Could not duplicate.' }],
  },
  {
    key: 'M_LOW_VOLTS',
    role: 'mech',
    src: 'squawk',
    text: { twin: '{Eng}low-voltage light; its loadmeter reads zero.', float: 'Low-voltage light; the ammeter shows a discharge.' },
    models: PISTONS,
    aw: true,
    mel: ['twin'],
    lead: [0, 0],
    bench: true,
    causes: [
      { kind: 'alternator', w: 3, fix: '24-30-01', finding: 'No output at B+ at 2,000 rpm; field voltage present; belt tight.', needs: ['generator'] },
      { kind: 'alternator', w: 1, fix: '24-30-02', finding: 'Belt glazed and slipping under load; output normal once tensioned.', needs: ['belt'] },
      { kind: 'wiring', w: 1, finding: '0 V at the field terminal with the master on; the alternator puts out on the bench.' },
    ],
  },
  {
    key: 'M_GEN_OFF',
    role: 'mech',
    src: 'squawk',
    text: 'GEN OFF light on the ground run; the starter works.',
    models: ['cargo'],
    aw: true,
    lead: [0, 0],
    bench: true,
    causes: [
      { kind: 'alternator', w: 3, fix: '24-30-01', finding: 'No output at the GCU with the field excited; brushes at the wear line.', needs: ['generator'] },
      { kind: 'wiring', w: 1, finding: '0 V field at the GCU connector with the GEN switch on; the starter-generator puts out on the test stand.' },
    ],
    sole: 'none',
  },
  {
    key: 'M_BELT_SQUEAL',
    role: 'mech',
    src: 'squawk',
    text: '{Eng}squeal from the alternator belt on start-up.',
    models: PISTONS,
    lead: [1, 2],
    causes: [{ kind: 'alternator', w: 3, fix: '24-30-02', finding: 'Belt glazed; tension below the used-belt value.', needs: ['belt'] }],
    nff: [{ w: 1, finding: 'Tension within the used-belt value, no glazing. Could not duplicate.' }],
  },
  {
    key: 'M_CHT_TREND',
    role: 'mech',
    src: 'trend',
    text: '{Eng}the engine monitor shows #3 CHT 40 °F hotter than the rest, three weeks running.',
    models: PISTONS,
    aw: true,
    intermittent: true,
    lead: [2, 3],
    causes: [{ kind: 'cylinder', w: 2, fix: '72-30-01', finding: "#3 38/80 against a master orifice of 46; air at the exhaust stack; borescope: the exhaust valve eroded at 3 o'clock." }],
    nff: [{ w: 1, finding: 'A folded baffle seal at #3, straightened on the spot; CHTs even now. Nothing to order.' }],
  },
  {
    key: 'M_OIL_IRON',
    role: 'mech',
    src: 'trend',
    text: '{Eng}oil analysis: iron 38 ppm, up from 12.',
    models: PISTONS,
    aw: true,
    lead: [2, 4],
    causes: [{ kind: 'cylinder', w: 3, fix: '72-30-01', finding: '#2: the borescope shows the barrel scored in the ring travel; 52/80, air at the breather; fine iron in the filter media.' }],
    nff: [{ w: 1, finding: 'Resample: iron 14 ppm. The last sample was contaminated.' }],
  },
  {
    key: 'M_OIL_DUE',
    role: 'mech',
    src: 'due',
    text: 'Oil change due in {lead} weeks (50 hours).',
    models: PISTONS,
    lead: [1, 2],
    prefilled: true,
    causes: [{ kind: 'oil', w: 1, fix: '79-00-01', needs: ['oilFilter'] }],
  },
  {
    key: 'M_OIL_LEAK',
    role: 'mech',
    src: 'squawk',
    text: '{Eng}oil on the belly after one flight.',
    models: PISTONS,
    aw: true,
    lead: [0, 1],
    causes: [
      {
        kind: 'oil',
        w: 2,
        fix: '79-00-01',
        finding: 'Drain plug safety wire broken, the plug backing off; filter gasket dry.',
        soleFinding: 'Drain-plug safety wire loose; the plug is tight; filter gasket dry.',
        needs: ['oilFilter'],
      },
      { kind: 'cylinder', w: 1, fix: '72-30-01', finding: 'Oil weeping at the #4 cylinder base.', soleFinding: 'The #4 cylinder base is damp with oil: no drip, the base nuts at torque.' },
    ],
    nff: [{ w: 1, finding: 'Overfilled by a quart; the breather blew it out. Serviced to the mark.' }],
    sole: { text: 'A little oil on the belly after each flight; the level holds.', lead: [1, 1] },
  },
  {
    key: 'M_GEAR_SLOW',
    role: 'mech',
    src: 'squawk',
    text: 'Gear takes 12 s to retract (normal 6–9 s).',
    models: PISTONS,
    aw: true,
    lead: [1, 1],
    causes: [{ kind: 'hydraulics', w: 3, fix: '29-10-01', finding: 'Filter bypass button out; fluid dark; reservoir low.', needs: ['filter'] }],
    nff: [{ w: 1, finding: '8 s on jacks on ground power: the battery was low that day.' }],
  },
  {
    key: 'M_ACCUM',
    role: 'mech',
    src: 'squawk',
    text: 'Brake accumulator runs down after two applications.',
    models: PISTONS,
    aw: true,
    lead: [0, 0],
    causes: [
      {
        kind: 'hydraulics',
        w: 1,
        fix: '29-10-01',
        finding: 'Precharge 450 psi (card: {pc} psi ±25 at 70 °F).',
        soleFinding: 'Precharge {pcLow} psi (card: {pc} psi ±25 at 70 °F): at the low end, bleeding down slowly; it still holds five brake applications.',
      },
    ],
    sole: { text: "Accumulator precharge near the card's minimum at the preflight check.", lead: [1, 1] },
  },
  {
    key: 'M_INSP_DUE',
    role: 'mech',
    src: 'due',
    text: { twin: '100-hour inspection due in about {h} hours ({n} flights).', float: '100-hour inspection due in about {h} hours ({n} flights).', cargo: 'Phase inspection due in about {h} hours.' },
    models: ALL,
    lead: [1, 1],
    prefilled: true,
    causes: [{ kind: 'inspect100', w: 1, fix: '05-20' }],
  },
  {
    key: 'M_SPAR_AD',
    role: 'mech',
    src: 'ad',
    text: 'AD 2011-20-05 spar lower cap inspection due in {lead} weeks.',
    models: ['twin'],
    aw: true,
    lead: [2, 3],
    prefilled: true,
    causes: [{ kind: 'spar', w: 1, fix: '57-10-01' }],
  },
  {
    key: 'M_WING_RIVETS',
    role: 'mech',
    src: 'squawk',
    text: 'Smoking rivets at the wing root.',
    models: ALL,
    aw: true,
    lead: [0, 0],
    causes: [
      {
        kind: 'spar',
        w: 1,
        fix: '57-10-01',
        finding: 'Black streaks behind four root rivets; the fairing moves under hand pressure.',
        soleFinding: 'Paint cracked at two root rivets; no black streaks yet, the fairing firm under hand pressure.',
      },
    ],
    sole: { text: 'Paint cracked around two wing-root rivets.', lead: [2, 2] },
  },
  {
    key: 'M_GEN_RUN',
    role: 'mech',
    src: 'squawk',
    text: 'Weekly generator run: oil pressure low at start, coolant weeping at the lower hose.',
    targets: ['gen'],
    lead: [1, 2],
    causes: [{ kind: 'genService', w: 1, fix: 'gsm:2-1', finding: 'Oil 2 qt low and black; the lower hose soft and weeping at its clamp.', needs: ['hose'] }],
  },
  {
    key: 'M_GEN_SHAKE',
    role: 'mech',
    src: 'squawk',
    text: 'The generator shakes on its weekly run.',
    targets: ['gen'],
    lead: [1, 2],
    causes: [{ kind: 'genService', w: 1, fix: 'gsm:2-4', finding: 'Two isolators cracked and oil-soaked; mount bolts loose.', needs: ['isolator'] }],
  },
];

const ELEC: Symptom[] = [
  {
    key: 'E_DEAD_OUTLET',
    role: 'elec',
    src: 'guest',
    text: 'Guest at {house}: the {room} outlets are dead.',
    targets: HOUSES,
    rooms: ['kitchen', 'living', 'bedroom', 'laundry'],
    lead: [0, 1],
    causes: [
      { kind: 'trip', w: 3, fix: 'ref:outlet', finding: 'Hot open at the second receptacle; the first is backstabbed and loose.' },
      { kind: 'gfci', w: 2, fix: 'ref:gfci', rooms: ['kitchen', 'laundry'], finding: "The {room} GFCI upstream is tripped and won't reset; its LOAD side feeds these outlets." },
    ],
    nff: [
      { w: 2, rooms: ['kitchen', 'laundry'], finding: 'A GFCI upstream was tripped; reset and tested fine. Nothing to replace.' },
      { w: 2, rooms: ['living', 'bedroom'], finding: 'The AFCI breaker had tripped (a vacuum cleaner); reset, holds, tested. Nothing to replace.' },
    ],
  },
  {
    key: 'E_WARM_OUTLET',
    role: 'elec',
    src: 'guest',
    text: 'Guest at {house}: an outlet in the {room} is warm and smells burnt.',
    targets: HOUSES,
    rooms: ['living', 'bedroom', 'kitchen'],
    hazard: true,
    lead: [0, 0],
    causes: [
      { kind: 'trip', w: 3, fix: 'ref:outlet', finding: 'Backstabbed receptacle; the hot conductor loose and discoloured.' },
      { kind: 'gfci', w: 1, fix: 'ref:gfci', rooms: ['kitchen'], finding: "The GFCI's LINE terminal loose and scorched." },
    ],
  },
  {
    key: 'E_APPLIANCE',
    role: 'elec',
    src: 'guest',
    text: "Guest at {house}: the {appliance}'s plug runs warm.",
    targets: HOUSES,
    rooms: ['kitchen', 'bedroom'],
    lead: [0, 1],
    causes: [{ kind: 'trip', w: 1, fix: 'ref:outlet', finding: 'A 15 A single receptacle on the 20 A individual circuit; its contacts loose and discoloured.', site: { single: true, amps: 20, awg: 12 } }],
  },
  {
    key: 'E_GFCI_TRIPS',
    role: 'elec',
    src: 'guest',
    text: 'Guest at {house}: the bathroom outlet trips whenever the hair dryer runs.',
    targets: HOUSES,
    rooms: ['bath'],
    intermittent: true,
    lead: [0, 1],
    causes: [
      { kind: 'gfci', w: 3, fix: 'ref:gfci', finding: 'Trips at 3 mA on the tester (should hold to 4–6 mA); 11 years old.' },
      { kind: 'trip', w: 1, fix: 'ref:outlet', finding: "Water in a box downstream, on the GFCI's LOAD side; terminals corroded.", site: { upstream: 'gfci' } },
    ],
    nff: [{ w: 2, finding: "The GFCI tests right; the guest's hair dryer leaks 7 mA to ground. It's the dryer." }],
  },
  {
    key: 'E_SHOWER_TINGLE',
    role: 'elec',
    src: 'guest',
    text: 'Guest at {house} felt a tingle at the shower valve.',
    targets: HOUSES,
    rooms: ['bath'],
    hazard: true,
    lead: [0, 0],
    causes: [
      {
        kind: 'flicker',
        w: 2,
        fix: 'ref:wh',
        finding: "Water heater element 40 kΩ to its sheath; the heater's EGC open at its junction box; 4 V valve to drain.",
        needs: ['element'],
        // the heater's own circuit, not the bathroom's: the make-safe tags this breaker
        site: { what: 'Water heater', amps: 30, awg: 10, poles: 2 },
      },
      { kind: 'flicker', w: 1, fix: 'ref:ground', finding: 'No bonding jumper on the water piping (250.104(A)); 4 V valve to drain with the heater off.', needs: ['jumper', 'clamp'] },
      {
        kind: 'flicker',
        w: 1,
        fix: 'ref:flicker',
        neutral: true,
        finding: 'Neutral to ground 9 V at the panel; lights brighten when the microwave runs: the service neutral is loose at the meter base.',
      },
    ],
  },
  {
    key: 'E_NO_GFCI',
    role: 'elec',
    src: 'code',
    text: "Inspector's note at {house}: no GFCI on the porch receptacle, and a flip-lid cover.",
    targets: HOUSES,
    rooms: ['outdoor'],
    lead: [2, 3],
    prefilled: true,
    causes: [{ kind: 'gfci', w: 1, fix: 'ref:gfci' }],
  },
  {
    key: 'E_THREEWAY',
    role: 'elec',
    src: 'guest',
    text: 'Guest at {house}: the hall light works from one switch only.',
    targets: HOUSES,
    rooms: ['hall'],
    lead: [1, 2],
    causes: [{ kind: 'switch3', w: 1, fix: 'ref:3way', finding: 'A traveler landed on the common screw at the far switch.' }],
  },
  {
    key: 'E_SWITCH_WARM',
    role: 'elec',
    src: 'guest',
    text: 'Guest at {house}: a switch plate in the hall is warm.',
    targets: HOUSES,
    rooms: ['hall'],
    lead: [0, 1],
    causes: [
      { kind: 'switch3', w: 2, fix: 'ref:3way', finding: 'Loose traveler at the 3-way; two 12/3 cables and the device in an 18 in³ box.', needs: ['box'], site: { amps: 20, awg: 12 } },
      { kind: 'trip', w: 1, fix: 'ref:outlet', finding: 'A backstabbed receptacle in the same box, loose.' },
    ],
  },
  {
    key: 'E_CODE_DUE',
    role: 'elec',
    src: 'code',
    text: 'County electrical inspection at {house} in {lead} weeks: directory, clearances, labels.',
    targets: HOUSES,
    rooms: ['panel'],
    lead: [2, 2],
    prefilled: true,
    causes: [{ kind: 'codeprep', w: 1, fix: 'ref:inspect' }],
  },
  {
    key: 'E_STORM_DEAD',
    role: 'elec',
    src: 'guest',
    text: 'After the storm: two rooms at {house} dead, water in the porch box.',
    alt: 'Water in the porch box at {house} after the rain.',
    targets: HOUSES,
    rooms: ['outdoor', 'bedroom'],
    hazard: true,
    lead: [0, 0],
    causes: [
      { kind: 'storm', w: 3, fix: 'ref:storm', finding: 'Porch box full of water, terminals corroded; the run to the bedroom wet, 0.2 MΩ.' },
      { kind: 'trip', w: 1, fix: 'ref:outlet', rooms: ['outdoor'], finding: 'The porch receptacle failed; the rest dry, insulation good.' },
    ],
  },
  {
    key: 'E_FLICKER',
    role: 'elec',
    src: 'guest',
    text: 'Guest at {house}: the lights flicker when the AC kicks on.',
    targets: HOUSES,
    rooms: ['living'],
    intermittent: true,
    lead: [0, 1],
    causes: [{ kind: 'flicker', w: 6, fix: 'ref:flicker', finding: 'Neutral lug at the panel loose; 112–128 V under load.' }],
    nff: [{ w: 2, finding: "A 4% sag on the AC's start: normal inrush. Could not duplicate." }],
  },
  {
    key: 'E_TAKEOFF_SPA',
    role: 'elec',
    src: 'takeoff',
    text: 'Install a {amps} A hot-tub circuit at {house}: the pad is {feet} ft from the panel.',
    targets: HOUSES,
    rooms: ['spa'],
    lead: [2, 3],
    prefilled: true,
    causes: [{ kind: 'hottub', w: 1, fix: 'ref:spa' }],
  },
  {
    key: 'E_FEEDER_DROP',
    role: 'elec',
    src: 'utility',
    text: 'Utility log: the feeder to the east cottages dropped out twice last night.',
    targets: ['panel'],
    rooms: ['panel'],
    lead: [0, 1],
    causes: [
      { kind: 'feeder', w: 3, fix: 'ref:feeder', finding: 'Insulation 0.4 MΩ at a buried splice: split bolts and tape, cracked.', needs: ['splice'], site: { amps: 100, awg: 3, run: 'buried' } },
      { kind: 'xfmr', w: 1, fix: 'ref:deadckt', finding: "The feeder breaker's lug loose and discoloured." },
    ],
  },
  {
    key: 'E_UTIL_SAG',
    role: 'elec',
    src: 'utility',
    text: 'Meter data: phase B sags to 108 V at peak.',
    targets: ['panel'],
    rooms: ['panel'],
    lead: [1, 2],
    causes: [{ kind: 'xfmr', w: 3, fix: 'ref:deadckt', finding: 'Phase B lug at the main 40 °F hot on the IR scan.' }],
    nff: [{ w: 1, finding: "The utility transformer's tap: their side, reported to them." }],
  },
  {
    key: 'E_DEAD_CIRCUIT',
    role: 'elec',
    src: 'utility',
    text: 'A dead circuit at the panel: breaker on, no voltage at the load.',
    targets: ['panel'],
    rooms: ['panel'],
    lead: [0, 1],
    causes: [{ kind: 'xfmr', w: 1, fix: 'ref:deadckt', finding: 'Breaker contacts open: 120 V line side, 0 V load side.', needs: ['breaker'] }],
  },
  {
    key: 'E_PANEL_LOAD',
    role: 'elec',
    src: 'trend',
    text: "The island's distribution panel ran at 92% of its rating at peak: plan the upgrade.",
    targets: ['panel'],
    rooms: ['panel'],
    lead: [3, 4],
    causes: [{ kind: 'panelUp', w: 1, fix: 'ref:panel', finding: 'Peak demand 368 A on a 400 A bus; the lugs are at their limit.' }],
  },
  {
    key: 'E_TAKEOFF_DOCK',
    role: 'elec',
    src: 'takeoff',
    text: "The fuel dock's old direct-burial run fails its insulation test: replace it with a conduit run.",
    targets: ['panel'],
    rooms: ['dock'],
    lead: [2, 3],
    prefilled: true,
    causes: [{ kind: 'dockrun', w: 1, fix: 'ref:dock' }],
  },
  {
    key: 'E_DOCK_TRIP',
    role: 'elec',
    src: 'utility',
    text: 'The fuel-dock pumps trip their ground-fault protection.',
    targets: ['panel'],
    rooms: ['dock'],
    lead: [0, 1],
    causes: [{ kind: 'dockrun', w: 2, fix: 'ref:dock', finding: 'Buried run 0.3 MΩ; water in the dispenser junction.' }],
    nff: [{ w: 1, finding: "Rain in the pump motor's box; dried and resealed; the run tests fine." }],
  },
  {
    key: 'E_TAKEOFF_XFER',
    role: 'elec',
    src: 'takeoff',
    text: 'The houses now back up {load} A on the {amps} A transfer switch: install a larger one (702.4(B)).',
    targets: ['gen'],
    rooms: ['gen'],
    lead: [2, 3],
    prefilled: true,
    causes: [{ kind: 'transfer', w: 1, fix: 'ref:xfer' }],
  },
  {
    key: 'E_XFER_FAIL',
    role: 'elec',
    src: 'utility',
    text: "In the weekly test the transfer didn't pick up {leg}.",
    targets: ['gen'],
    rooms: ['gen'],
    lead: [0, 1],
    causes: [
      { kind: 'transfer', w: 2, fix: 'ref:xfer', finding: "The transfer switch's contacts pitted and burnt on the leg to {leg}." },
      { kind: 'genTest', w: 2, fix: 'ref:gentest', finding: "{Leg}' transfer-panel relay coil reads open.", needs: ['relay'] },
    ],
  },
  {
    key: 'E_GEN_TEST',
    role: 'elec',
    src: 'utility',
    text: "Weekly test: a backed-up circuit didn't come on.",
    targets: ['gen'],
    rooms: ['gen'],
    lead: [0, 1],
    causes: [{ kind: 'genTest', w: 1, fix: 'ref:gentest', finding: "The transfer-panel relay's coil reads open.", needs: ['relay'] }],
  },
];

/** a trade's write-up names a job (the squawk action): one line per catalog kind (7).
 *  `needs` overrides the task's required slots when every slot is optional but
 *  the write-up names the unit (a com radio swap needs the radio) */
const WRITE_UP: Record<string, { what: string; rooms?: Room[]; needs?: string[] }> = {
  inspect100: { what: 'the 100-hour inspection' },
  tires: { what: 'brake linings worn' },
  prop: { what: 'prop bolts due a torque check' },
  corrosion: { what: 'corrosion at a wheel-half bead seat' },
  avionics: { what: 'the com radio weak on transmit', needs: ['radio'] },
  alternator: { what: 'alternator output low' },
  cylinder: { what: 'a cylinder low on compression' },
  spar: { what: 'the wing spar due an inspection' },
  wire: { what: 'prop bolt safety wire worn' },
  oil: { what: 'the oil change' },
  hydraulics: { what: 'the hydraulic power pack due its service' },
  genService: { what: 'the generator engine due its service' },
  trip: { what: 'dead outlets in the {room}', rooms: ['kitchen', 'living', 'bedroom', 'laundry'] },
  gfci: { what: "a GFCI in the {room} that won't hold", rooms: ['bath', 'kitchen', 'laundry', 'outdoor'] },
  switch3: { what: 'a hall 3-way that works from one end only', rooms: ['hall'] },
  codeprep: { what: 'the code inspection coming up', rooms: ['panel'] },
  storm: { what: 'storm damage in the wiring', rooms: ['outdoor', 'bedroom'] },
  flicker: { what: 'flickering lights', rooms: ['living'] },
  hottub: { what: 'the hot-tub circuit', rooms: ['spa'] },
  feeder: { what: 'the cottage feeder', rooms: ['panel'] },
  panelUp: { what: 'the distribution panel near capacity', rooms: ['panel'] },
  transfer: { what: 'the transfer switch', rooms: ['gen'] },
  xfmr: { what: 'a dead circuit at the panel', rooms: ['panel'] },
  dockrun: { what: 'the fuel-dock run', rooms: ['dock'] },
  genTest: { what: 'the generator-backed circuits', rooms: ['gen'] },
};

function writeUps(): Symptom[] {
  const out: Symptom[] = [];
  for (const c of CATALOG) {
    const w = WRITE_UP[c.kind];
    if (!w) continue;
    const plane = MODELS[c.targets[0]]?.kind === 'plane';
    const any = c.targets[0];
    const task = defaultTask(c.kind, { kind: MODELS[any].kind, model: any });
    const needs = w.needs ?? (task ? task.main.filter((x) => !x.optional).map((x) => x.slot) : []);
    out.push({
      key: `W_${c.kind}`,
      role: c.role,
      src: 'finding',
      text: w.what,
      ...(plane ? { models: c.targets.filter((t) => MODELS[t]?.kind === 'plane').map((t) => planeModel(t)) } : { targets: c.targets }),
      ...(w.rooms ? { rooms: w.rooms } : {}),
      lead: [2, 2],
      prefilled: true,
      auto: true,
      writeUp: c.kind,
      causes: [{ kind: c.kind, w: 1, fix: DEFAULT_FIX[c.kind], ...(needs.length ? { needs } : {}) }],
    });
  }
  return out;
}

/** the fix each write-up opens with (the kind's default task) */
const DEFAULT_FIX: Record<string, string> = {
  inspect100: '05-20',
  tires: '32-40-02',
  prop: '61-10-01',
  corrosion: '32-40-03',
  avionics: '23-10-01',
  alternator: '24-30-01',
  cylinder: '72-30-01',
  spar: '57-10-01',
  wire: '61-10-02',
  oil: '79-00-01',
  hydraulics: '29-10-01',
  genService: 'gsm:2-1',
  trip: 'ref:outlet',
  gfci: 'ref:gfci',
  switch3: 'ref:3way',
  codeprep: 'ref:inspect',
  storm: 'ref:storm',
  flicker: 'ref:flicker',
  hottub: 'ref:spa',
  feeder: 'ref:feeder',
  panelUp: 'ref:panel',
  transfer: 'ref:xfer',
  xfmr: 'ref:deadckt',
  dockrun: 'ref:dock',
  genTest: 'ref:gentest',
};

/** a repair alert (a hidden defect found or surfaced): its words are the defect's */
const REPAIR: Symptom = { key: 'R_REPAIR', role: 'mech', src: 'finding', text: '{problem}', lead: [0, 0], causes: [{ kind: 'repair', w: 1 }], auto: true };

export const SYMPTOMS: Record<string, Symptom> = Object.fromEntries([...MECH, ...ELEC, ...writeUps(), REPAIR].map((x) => [x.key, x]));
export const symptomOf = (a: Pick<Alert, 'sym'>): Symptom | undefined => SYMPTOMS[a.sym];

// ---------------------------------------------------------------------------
// Pure reads of an alert

/** the island's only non-cargo plane (the twin through tier 3): grounding it would empty every house */
export function soleGuest(s: Pick<IslandState, 'assets'>, planeId: string): boolean {
  const p = s.assets.find((a) => a.id === planeId);
  if (!p || p.kind !== 'plane' || MODELS[p.model]?.cargo) return false;
  return !s.assets.some((a) => a.kind === 'plane' && a.id !== p.id && !MODELS[a.model]?.cargo);
}

const assetOf = (s: IslandState, a: Pick<Alert, 'assetId'>) => s.assets.find((x) => x.id === a.assetId);

/** the cause the alert was raised with (null: no fault found is the truth) */
export function causeOf(a: Pick<Alert, 'sym' | 'cause'>): Cause | null {
  const sym = SYMPTOMS[a.sym];
  if (!sym || a.cause < 0) return null;
  return sym.causes[a.cause] ?? null;
}

/** the flags a row shows beside the stage: airworthiness, hazard, MEL relief, the electrician's check, intermittent */
export function alertFlags(s: IslandState, a: Alert): { aw: boolean; hazard: boolean; mel: 'C' | null; bench: boolean; intermittent: boolean } {
  const sym = SYMPTOMS[a.sym];
  const asset = assetOf(s, a);
  const model = asset?.kind === 'plane' ? planeModel(asset.model) : undefined;
  return {
    aw: !!sym?.aw && a.kind !== 'repair',
    hazard: !!sym?.hazard,
    mel: model && sym?.mel?.includes(model) ? 'C' : null,
    bench: !!sym?.bench,
    intermittent: !!sym?.intermittent,
  };
}

/**
 * The alert's tier (what the flow teaches or tests): tier 1 in the first two
 * weeks of the flow on an island and during a player's grace; else
 * 1 + island tier / 2, one more on an asset under 50 (A0's lever d, tried and
 * not kept, would stop that from tier 4: LATE.lowHealthTierBump); a repair, its defect's.
 */
export function alertTier(s: IslandState, a: Pick<Alert, 'assetId' | 'repair'>, role: Role): number {
  if (a.repair) return clamp(a.repair.defect.tier, 1, 5);
  if (s.week < (s.flowSince ?? 1) + ALERTS.teachWeeks) return 1;
  const p = s.players[role];
  if (p && s.week <= p.graceUntil) return 1;
  const asset = s.assets.find((x) => x.id === a.assetId);
  const bump = !!asset && asset.health < 50 && (LATE.lowHealthTierBump || s.tier < LATE.fromTier);
  return clamp(1 + Math.floor(s.tier / 2) + (bump ? 1 : 0), 1, 5);
}

/** words that fill a symptom's text, derived from the alert's seed */
function vars(s: IslandState, a: Alert): Record<string, string> {
  const r = rng(hashSeed(a.seed, 'words'));
  const side = r.pick(['L/H', 'R/H']);
  const eng = r.pick(['L/H', 'R/H']);
  const asset = assetOf(s, a);
  const site = siteOf(s, a);
  const lead = Math.max(0, a.due - a.week);
  const flightsToGo = asset?.kind === 'plane' ? Math.max(1, 12 - (asset.sinceInspection ?? 10)) : 2;
  const villas = s.assets.some((x) => x.model === 'villa');
  const leg = villas ? 'the villas' : 'the cottages';
  return {
    side,
    other: side === 'L/H' ? 'right' : 'left',
    Eng: asset && planeModel(asset.model) === 'twin' && asset.kind === 'plane' ? `${eng} engine: ` : '',
    pilot: a.who ?? 'the pilot',
    plane: asset?.name ?? 'the plane',
    h: String(Math.max(5, Math.round((flightsToGo * 8.3) / 5) * 5)),
    n: String(flightsToGo),
    lead: String(Math.max(1, lead)),
    house: asset?.name ?? 'the house',
    room: site ? roomWord(site.deviceRoom ?? site.room) : 'house',
    appliance: site?.appliance ?? 'appliance',
    amps: String(site?.amps ?? 60),
    feet: String(site?.feet ?? 40),
    load: String(site?.load ?? 90),
    leg,
    Leg: leg.charAt(0).toUpperCase() + leg.slice(1),
    problem: a.repair?.problem ?? 'a known defect',
  };
}

const roomWord = (r: Room) => ({ bath: 'bathroom', kitchen: 'kitchen', bedroom: 'bedroom', living: 'living room', laundry: 'laundry', outdoor: 'porch', hall: 'hall', panel: 'panel', spa: 'spa pad', dock: 'fuel dock', gen: 'generator house' })[r];

function fill(text: string, v: Record<string, string>): string {
  let out = text.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? `{${k}}`);
  // "{Eng}the engine monitor …" on a single: the sentence starts with the rest
  out = out.charAt(0).toUpperCase() + out.slice(1);
  // "due in {lead} weeks" a week out, "(1 flights)" a flight out
  return out.replace(/\b1 weeks\b/g, '1 week').replace(/\b1 flights\b/g, '1 flight');
}

/** the accumulator precharge this airplane's card prints (its S/N block), for a finding's {pc}: the twin 800 or 900 psi */
function cardPrecharge(s: IslandState, a: Pick<Alert, 'assetId'>): number | undefined {
  const asset = assetOf(s, a);
  if (!asset || asset.kind !== 'plane') return undefined;
  return manualCard(islandAircraft(s.seed, asset), 'powerpack', 'hydraulics', false)?.precharge?.lines.find((l) => l.applies)?.psi;
}

/** a sentence's first letter in lower case, mid-sentence: never an acronym or a side ("GFCI …", "R/H main tire", "N-12") */
export function lowerFirst(t: string): string {
  return /^([A-Z0-9]{2}|[A-Z]\/[A-Z]|[A-Z]-)/.test(t) ? t : t.charAt(0).toLowerCase() + t.slice(1);
}

/** "L/H brake pedal soft; pulls right on the landing roll." (a pilot's squawk carries the pilot's name; a comeback says so) */
export function symptomText(s: IslandState, a: Alert): string {
  const sym = SYMPTOMS[a.sym];
  if (!sym) return 'An alert from an older version.';
  const asset = assetOf(s, a);
  const v = vars(s, a);
  if (a.repair) {
    const r = a.repair;
    const base = r.via === 'incident' && r.incident ? r.incident : `${r.foundBy ?? 'An inspection'}'s ${r.foundIn ?? 'inspection'} found ${r.problem}`;
    return fill(base, v);
  }
  const model = asset?.kind === 'plane' ? planeModel(asset.model) : undefined;
  let raw = typeof sym.text === 'string' ? sym.text : ((model && sym.text[model]) ?? Object.values(sym.text)[0]!);
  if (a.sole && sym.sole && sym.sole !== 'none') raw = sym.sole.text;
  // "after the storm" only when the week before it was raised had one
  if (sym.alt && s.history.find((h) => h.week === a.week - 1)?.weather !== 'storm') raw = sym.alt;
  let text = fill(raw, v);
  if (sym.writeUp) text = `Written up by ${a.who ?? 'the crew'}: ${lowerFirst(text)}`;
  else if (a.who && sym.src === 'squawk') text = `Written up by ${a.who}: ${lowerFirst(text)}`;
  if (a.again !== undefined) text = `Written up again: ${lowerFirst(text)}`;
  return text;
}

/**
 * The alert in a few words, for review lines, the feed and the analyst's needs (no P/N): the symptom's first
 * clause without who noticed it ("Guest at Cottage 1:", "Utility log:"), the twin's engine said at the end
 * ("low-voltage light (L/H engine)"), lower case unless it opens on an acronym ("GEN OFF light on the ground run").
 */
export function alertShort(s: IslandState, a: Alert): string {
  let t = symptomText(s, a).replace(/^Written up (again|by [^:]+): /i, '');
  let eng = '';
  const m = /^(L\/H|R\/H) engine: /i.exec(t);
  if (m) {
    eng = ` (${m[1]} engine)`;
    t = t.slice(m[0].length);
  }
  t = t.replace(/^(Guest at [^:]+|Inspector's note at [^:]+|Utility log|Meter data|After the storm|Weekly test|Weekly generator run): /i, '');
  const first = t.split(/[;:]|\.(?=\s|$)/)[0].trim();
  return lowerFirst(first) + eng;
}

/** the site of an electrical job (derived from the seed): room, circuit, AWG, run, protection upstream */
export function siteOf(s: IslandState, a: Pick<Alert, 'seed' | 'sym' | 'cause' | 'role' | 'assetId'>): ElecSite | null {
  const sym = SYMPTOMS[a.sym];
  if (!sym || a.role !== 'elec') return null;
  const r = rng(hashSeed(a.seed, 'site'));
  const cause = a.cause >= 0 ? sym.causes[a.cause] : undefined;
  const nffRooms = a.cause < 0 ? [...new Set((sym.nff ?? []).flatMap((n) => n.rooms ?? []))] : [];
  const rooms: Room[] = cause?.rooms ?? (nffRooms.length ? nffRooms : (sym.rooms ?? ['living']));
  const room = r.pick(rooms);
  const site: ElecSite = siteFor(room, r);
  if (cause?.site) Object.assign(site, cause.site);
  if (site.single) site.appliance = room === 'kitchen' ? 'microwave' : 'window unit';
  // the E_DEAD_OUTLET GFCI and the E_STORM_DEAD porch are in their own rooms; a bath receptacle downstream of the GFCI is in the bath
  void s;
  return site;
}

function siteFor(room: Room, r: Rng): ElecSite {
  switch (room) {
    case 'bath':
    case 'kitchen':
    case 'laundry':
      return { room, amps: 20, awg: 12, run: 'nm' };
    case 'outdoor':
      return { room, amps: 20, awg: 12, wet: true, run: 'nm' };
    case 'bedroom':
    case 'living':
    case 'hall':
      return r.chance(0.7) ? { room, amps: 15, awg: 14, run: 'nm' } : { room, amps: 20, awg: 12, run: 'nm' };
    case 'spa': {
      const amps = r.chance(0.7) ? 60 : 50;
      return { room, amps, awg: amps === 60 ? 6 : 8, wet: true, run: 'buried', feet: r.int(35, 55) };
    }
    case 'panel':
      return r.chance(0.6) ? { room, amps: 20, awg: 12 } : { room, amps: 15, awg: 14 };
    case 'dock':
      return { room, amps: 30, awg: 10, wet: true, run: 'buried', feet: r.int(60, 120) };
    case 'gen':
      // the transfer switch as it is (60 A on #6), and the houses' backed-up load (a larger switch carries it, 702.4(B))
      return { room, amps: 60, awg: 6, load: r.int(72, 140) };
  }
}

/** the protection a replaced receptacle needs where it sits (210.8(A), 210.12(A), 406.4(D)(3)-(4)) */
export function protectionNeeded(site: ElecSite): { gfci: boolean; afci: boolean } {
  const room = site.deviceRoom ?? site.room;
  return {
    gfci: ['bath', 'kitchen', 'laundry', 'outdoor', 'spa'].includes(room),
    afci: ['bedroom', 'living', 'kitchen', 'laundry', 'hall'].includes(room),
  };
}

/** the breaker a make-safe tags at a site, in words: "the water heater's 30 A 2-pole breaker", "the bathroom's 20 A breaker" */
export function breakerOf(site: ElecSite | null | undefined): string {
  if (!site) return 'the circuit breaker';
  const who = site.what ? site.what.toLowerCase() : roomWord(site.deviceRoom ?? site.room);
  return `the ${who}'s ${site.amps} A ${site.poles === 2 ? '2-pole ' : ''}breaker`;
}

/** the task that fixes the cause on this asset */
function fixTask(s: IslandState, a: Alert, c: Cause | null): Task | undefined {
  const asset = assetOf(s, a);
  if (!asset || !c?.fix) return undefined;
  return taskOn(c.fix, asset);
}

/** HIDDEN: the tasks that fix it ([] for no fault and for a wiring cause) */
export function fixesOf(s: IslandState, a: Alert): TaskId[] {
  if (a.repair) return [`repair:${a.id}`];
  const t = fixTask(s, a, causeOf(a));
  return t ? [t.id] : [];
}

/** HIDDEN: the main slots its cause needs (stdPick, the install check); a receptacle job needs its device (and a cover outdoors) */
export function needsOf(s: IslandState, a: Alert): string[] {
  const c = causeOf(a);
  if (!c) return [];
  if (c.fix === 'ref:outlet' || c.fix === 'ref:gfci') {
    const site = siteOf(s, a);
    const dev = c.fix === 'ref:outlet' ? 'receptacle' : 'gfci';
    return site?.room === 'outdoor' || site?.wet ? [dev, 'cover'] : [dev];
  }
  return c.needs ?? [];
}

/** the prefilled task an alert opens with (a due item, an AD, a code notice, a take-off, a write-up) */
export function prefilledTask(s: IslandState, a: Alert): TaskId | undefined {
  if (a.task) return a.task;
  const sym = SYMPTOMS[a.sym];
  if (!sym?.prefilled) return undefined;
  return fixTask(s, a, causeOf(a) ?? sym.causes[0])?.id;
}

/**
 * What Investigate shows: the cause's finding (the NFF one when the fault
 * hides: `looksNff`, or no fault at all), and at alert tier 2 or below one
 * plain sentence that names the fix.
 */
export function findingOf(s: IslandState, a: Alert, tier: number): { text: string; nff: boolean } {
  const sym = SYMPTOMS[a.sym];
  if (!sym) return { text: '', nff: false };
  const v = vars(s, a);
  if (a.repair) return { text: fill(a.repair.problem, v), nff: false };
  const c = causeOf(a);
  const site = siteOf(s, a);
  const room = site ? (site.deviceRoom ?? site.room) : undefined;
  if (!c || a.looksNff) {
    const pool = (sym.nff ?? []).filter((n) => !n.rooms || (room && n.rooms.includes(room)));
    const n = pool[0] ?? sym.nff?.[0];
    return { text: n ? fill(n.finding, v) : 'Nothing found on the ground: could not duplicate.', nff: true };
  }
  // the only guest plane's early sign reads as what it is: a condition still within limits (5.6)
  const raw = a.sole && c.soleFinding ? c.soleFinding : c.finding;
  if (raw?.includes('{pc')) {
    const pc = cardPrecharge(s, a) ?? 800;
    v.pc = String(pc);
    v.pcLow = String(pc - 20);
  }
  let text = raw ? fill(raw, v) : fill(typeof sym.text === 'string' ? sym.text : Object.values(sym.text)[0]!, v);
  if (tier <= 2) {
    const elec = s.players.elec?.name ?? 'the electrician';
    const t = fixTask(s, a, c);
    if (c.kind === 'wiring') text += ` It's the wiring: ask ${elec} to meter it.`;
    else if (sym.bench) text += ` It's the unit: ${t ? `${t.book} ${t.no}` : 'replace it'}.`;
    else if (c.neutral) text += " A branch breaker won't isolate a service neutral: leave the house closed until it's fixed.";
    else if (t) text += ` The fix: ${lowerFirst(t.short)} (${t.book === 'REF' ? t.no : `${t.book} ${t.no}`}).`;
    if (site && (c.fix === 'ref:outlet' || c.fix === 'ref:gfci')) {
      const need = protectionNeeded(site);
      const up = site.upstream === 'gfci' ? ' (a GFCI upstream already protects it)' : '';
      const words = [need.afci && 'AFCI', need.gfci && site.upstream !== 'gfci' && 'GFCI'].filter(Boolean).join(' and ');
      text += ` This circuit: ${site.amps} A, ${site.awg} AWG${site.single ? ', an individual circuit' : ''}${words ? `: a replacement here needs ${words} protection` : ''}${up}.`;
    }
  }
  return { text, nff: false };
}

/** the MEL words for an alert on a plane (company MEL, Part 135, category C) */
export const melOf = (s: IslandState, a: Alert) => alertFlags(s, a).mel;

// ---------------------------------------------------------------------------
// Raising alerts

export type RaiseOpts = {
  role: OpsRole;
  asset: Asset;
  kind?: string;
  sym?: string;
  cause?: number;
  src?: AlertSrc;
  due?: number;
  repair?: RepairInfo;
  again?: number;
  seed?: number;
  /** the week it shows: the staff hook raises at the resolve for next week */
  week?: number;
  who?: string;
};

/** does a symptom fit an asset (its model, or its targets) */
function fits(sym: Symptom, asset: Asset): boolean {
  if (asset.kind === 'plane') return !!sym.models?.includes(planeModel(asset.model));
  return !!sym.targets?.includes(asset.model);
}

/**
 * The (symptom, cause) pairs a kind can be raised as on an asset, weighted by the cause. A symptom that has a
 * cause of this kind brings its wiring causes along (5.4: the electrician's fix at the airplane), with their own
 * weights: the com radio's dead transmit is the wiring 3 in 10, the alternator's no output 1 in 5, the
 * starter-generator's 1 in 4. The alert still fills the kind's slot (`slotKind`).
 */
function pairsFor(kind: string, asset: Asset, sole: boolean): { sym: Symptom; cause: number; w: number }[] {
  const out: { sym: Symptom; cause: number; w: number }[] = [];
  const onModel = (c: Cause) => !(c.models && asset.kind === 'plane' && !c.models.includes(planeModel(asset.model)));
  for (const sym of Object.values(SYMPTOMS)) {
    if (sym.auto || !fits(sym, asset)) continue;
    if (sole && sym.sole === 'none') continue;
    if (!sym.causes.some((c) => c.kind === kind && onModel(c))) continue;
    sym.causes.forEach((c, i) => {
      if ((c.kind === kind || c.kind === 'wiring') && onModel(c)) out.push({ sym, cause: i, w: c.w });
    });
  }
  return out;
}

/** the catalog kind an alert fills a slot of: its cause's kind, a wiring cause its symptom's unit's (M_COM_DEAD's wiring is an 'avionics' alert) */
export function slotKind(a: Pick<Alert, 'sym' | 'kind'>): string {
  if (a.kind !== 'wiring') return a.kind;
  return SYMPTOMS[a.sym]?.causes.find((c) => c.kind !== 'wiring')?.kind ?? a.kind;
}

/** a new alert (also used by repairs, NFF comebacks, write-ups and hard landings) */
export function raiseAlert(s: IslandState, o: RaiseOpts, _now: number): Alert {
  const id = `a${s.nextId++}`;
  const W = o.week ?? s.week;
  const seed = o.seed ?? hashSeed(s.seed, 'alert', id);
  const r = rng(hashSeed(seed, 'raise'));
  const asset = o.asset;
  const sole = asset.kind === 'plane' && soleGuest(s, asset.id);
  let sym: Symptom;
  let cause: number;
  let kind: string;
  if (o.repair) {
    sym = REPAIR;
    cause = 0;
    kind = 'repair';
  } else if (o.sym && SYMPTOMS[o.sym]) {
    sym = SYMPTOMS[o.sym];
    if (o.cause !== undefined) cause = o.cause;
    else {
      const pool = sym.causes.map((c, i) => ({ c, i })).filter((x) => !o.kind || x.c.kind === o.kind);
      cause = (r.weighted(pool, (x) => x.c.w) ?? pool[0] ?? { i: 0 }).i;
    }
    kind = cause >= 0 ? sym.causes[cause].kind : 'nff';
  } else {
    const pairs = pairsFor(o.kind ?? '', asset, sole);
    const pick = r.weighted(pairs, (x) => x.w) ?? pairs[0];
    if (!pick) {
      // nothing in the tables names this kind on this asset: a write-up of the kind itself
      sym = SYMPTOMS[`W_${o.kind}`] ?? MECH[0];
      cause = 0;
    } else {
      sym = pick.sym;
      cause = pick.cause;
    }
    kind = sym.causes[cause]?.kind ?? o.kind ?? 'nff';
  }
  // a pilot's squawk from a green pilot is no fault found more often (D: squawkNff)
  const who = o.who ?? (asset.kind === 'plane' && (sym.src === 'squawk' || sym.src === 'landing') ? pilotOf(s, asset.id)?.name : undefined);
  if (!o.repair && o.cause === undefined && asset.kind === 'plane' && sym.src === 'squawk' && sym.nff?.length && r.chance(squawkNff(s, asset.id))) {
    cause = -1;
    kind = 'nff';
  }
  const soleWords = sole && sym.sole && sym.sole !== 'none';
  const lead = soleWords ? (sym.sole as { lead: [number, number] }).lead : sym.lead;
  // the teaching weeks (17.5): a crew new to the flow gets a week to act on everything it raises (nothing grounds a plane
  // or closes a house before anyone could have planned it)
  const teaching = W < (s.flowSince ?? 1) + ALERTS.teachWeeks;
  const due = o.due ?? Math.max(W + r.int(lead[0], lead[1]), teaching ? W + 1 : 0);
  const a: Alert = {
    id,
    role: o.role,
    assetId: asset.id,
    sym: sym.key,
    src: o.src ?? sym.src,
    week: W,
    due,
    seed,
    kind,
    cause,
    status: 'open',
    ...(o.repair ? { repair: o.repair } : {}),
    ...(o.again !== undefined ? { again: o.again } : {}),
    ...(who ? { who } : {}),
    ...(soleWords ? { sole: true } : {}),
  };
  // an intermittent fault may hide at tier 3+: the finding shows nothing wrong (stored at raise)
  if (sym.intermittent && cause >= 0 && alertTier(s, a, o.role) >= 3 && r.chance(ALERTS.looksNff)) a.looksNff = true;
  const pre = prefilledTask(s, a);
  if (pre) a.task = pre;
  (s.alerts ??= []).push(a);
  pruneAlerts(s);
  return a;
}

/** keep open alerts and closed ones for ALERTS.keep weeks; hard cap (oldest closed dropped first) */
export function pruneAlerts(s: IslandState) {
  const list = s.alerts ?? [];
  let keep = list.filter((a) => a.status !== 'closed' || (a.closed?.week ?? a.week) >= s.week - ALERTS.keep);
  if (keep.length > ALERTS.cap) {
    const closed = keep.filter((a) => a.status === 'closed').sort((x, y) => (x.closed?.week ?? 0) - (y.closed?.week ?? 0));
    const drop = new Set(closed.slice(0, keep.length - ALERTS.cap).map((a) => a.id));
    keep = keep.filter((a) => !drop.has(a.id));
  }
  s.alerts = keep;
}

const OPS: OpsRole[] = ['mech', 'elec'];
const openOrder = (o: IslandState['orders'][number]) => o.status !== 'done' && o.status !== 'cancelled';
/** alerts not closed (open, or a job not signed off yet) */
export const liveAlerts = (s: IslandState) => (s.alerts ?? []).filter((a) => a.status !== 'closed');

/**
 * The week's trade work (openWeek, where generateOpsOrders ran): today's slot
 * logic, so the number of jobs a week is unchanged. Each pick becomes an alert;
 * load sheets and ground power starts stay direct orders (`direct`). Then, now
 * and then, one alert whose cause is no fault (outside the slots).
 */
export function generateAlerts(s: IslandState, r: Rng, now: number, direct: (kind: string, asset: Asset) => void): void {
  const W = s.week;
  for (const role of OPS) {
    const openOrders = s.orders.filter((o) => o.role === role && openOrder(o));
    // jobs stuck waiting for parts don't count: the trade always has something it can do by hand
    const workable = openOrders.filter((o) => o.status !== 'waiting_part');
    // a no-fault alert doesn't take a slot (5.1), and doesn't count as work on its asset
    const openAlerts = (s.alerts ?? []).filter((a) => a.role === role && a.status === 'open' && a.cause >= 0);
    const live = liveAlerts(s);
    // the electrician's helper (review round 1) walks the houses too: their rounds write up as much more as they do
    const extra = role === 'elec' ? helperJobs(s) : 0;
    const target = (s.tier >= 3 ? 5 : 4) + extra;
    let openCount = workable.length + openAlerts.length;
    let slots = Math.max(0, Math.min(3 + extra, target - openCount));
    const cands: { kind: string; asset: Asset; w: number }[] = [];
    for (const asset of s.assets) {
      for (const c of CATALOG) {
        if (c.role !== role || !c.targets.includes(asset.model)) continue;
        if (openOrders.some((o) => o.kind === c.kind && o.assetId === asset.id)) continue;
        if (live.some((a) => a.assetId === asset.id && slotKind(a) === c.kind)) continue;
        let w = c.weight(asset, W);
        // better pilots wear the brakes and tires less (D: wearMult)
        if (w > 0 && c.kind === 'tires' && asset.kind === 'plane') w *= wearMult(s, asset.id);
        if (w > 0) cands.push({ kind: c.kind, asset, w });
      }
    }
    // an asset in critical shape with nothing open on it always gets a job; so does the grid at real risk from tier 4
    // (A0 e: grid first, the island's single point of failure): a feed job, and it goes first among the must-dos
    const first = (a: Asset) => a.kind === 'grid' && gridFirst(s, a);
    for (const asset of s.assets) {
      if ((asset.health >= 45 && !first(asset)) || workable.some((o) => o.assetId === asset.id) || openAlerts.some((a) => a.assetId === asset.id)) continue;
      const feedOnly = asset.health >= 45 && first(asset);
      const fix = cands
        .filter((c) => c.asset.id === asset.id && c.w < 100 && (!feedOnly || FEED_KINDS.has(c.kind)))
        .sort((a, b) => (CATALOG_BY_KIND[a.kind]?.parts ?? 0) - (CATALOG_BY_KIND[b.kind]?.parts ?? 0) || b.w - a.w)[0];
      if (fix) fix.w = 100;
    }
    const issue = (kind: string, asset: Asset) => {
      if (kind === 'wb' || kind === 'gpustart') direct(kind, asset);
      else raiseAlert(s, { role, asset, kind }, now);
    };
    // must-do work (inspections, critical repairs) jumps the queue, capped at 8 open per role (the grid first, A0 e)
    for (const m of cands.filter((c) => c.w >= 100).sort((a, b) => Number(first(b.asset) && FEED_KINDS.has(b.kind)) - Number(first(a.asset) && FEED_KINDS.has(a.kind)))) {
      if (openCount >= 8) break;
      issue(m.kind, m.asset);
      openCount++;
      slots = Math.max(0, slots - 1);
      cands.splice(cands.indexOf(m), 1);
    }
    while (slots > 0 && cands.length && openCount < 6) {
      const pick = r.weighted(cands, (c) => c.w * (1 + (100 - c.asset.health) / 40));
      if (!pick) break;
      issue(pick.kind, pick.asset);
      openCount++;
      // spread work across assets: other jobs on the same asset get less likely
      cands.splice(cands.indexOf(pick), 1);
      for (const c of cands) if (c.asset.id === pick.asset.id) c.w *= 0.4;
      slots--;
    }
  }
  nffExtras(s, now);
}

/** one more alert whose cause is no fault, now and then (it doesn't take a slot): the call is the tech's */
function nffExtras(s: IslandState, now: number) {
  for (const role of OPS) {
    const r = rng(hashSeed(s.seed, 'nff', role, s.week));
    if (!r.chance(ALERTS.nff[role])) continue;
    const assets = s.assets.filter((a) => (role === 'mech' ? a.kind === 'plane' || a.kind === 'generator' : a.kind !== 'plane'));
    const asset = r.weighted(assets, (a) => 100 - a.health + 5);
    if (!asset) continue;
    const sole = asset.kind === 'plane' && soleGuest(s, asset.id);
    const syms = Object.values(SYMPTOMS).filter((x) => x.role === role && !x.auto && !x.prefilled && x.nff?.length && fits(x, asset) && !(sole && x.sole === 'none'));
    const live = liveAlerts(s);
    const pool = syms.filter((x) => !live.some((a) => a.assetId === asset.id && a.sym === x.key));
    const sym = r.weighted(pool, (x) => (x.nff ?? []).reduce((n, e) => n + e.w, 0));
    if (!sym) continue;
    raiseAlert(s, { role, asset, sym: sym.key, cause: -1 }, now);
  }
}
