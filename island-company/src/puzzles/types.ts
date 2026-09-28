import type { Aircraft } from '../sim/aircraft';
import type { InvoiceContext } from '../sim/stock';
import type { ElecSpec } from '../sim/types';
import type { Fx } from '../ui/feedback';

export type PuzzleId =
  | 'torque'
  | 'crack'
  | 'teardown'
  | 'trace'
  | 'panel'
  | 'wireup'
  | 'variance'
  | 'auction'
  | 'forecast'
  // real-life wave 2
  | 'balance'
  | 'safetywire'
  | 'meter'
  | 'conduit'
  | 'reconcile'
  | 'invoice'
  // mechanic wave 3
  | 'hydraulics'
  | 'gpu'
  // aircraft paperwork
  | 'ipc'
  | 'logbook';

export type PuzzleRole = 'mech' | 'elec' | 'fin';

/** an alert's circuit for the electrician's puzzles: "Hall", 20 A, the device the complaint is about, what's wrong */
export type PuzzleSite = {
  /** the room as a label ("Hall", "Living room"); none for a panel, a generator or a pad */
  room?: string;
  amps: number;
  /** an individual circuit: one receptacle for one appliance */
  single?: boolean;
  appliance?: string;
  /** the device the complaint is about (a warm switch plate) */
  device?: 'outlet' | 'switch';
  fault: 'dead' | 'warm' | 'neutral';
};

export interface PuzzleContext {
  /** auction: market range for one parts kit, and the analyst's walk-away cap */
  market?: { low: number; high: number; fair: number; cap: number };
  /** forecast: week-end cash history, oldest first; last entry = cash now */
  cashHistory?: number[];
  /** forecast: the desk model's projection for the next 4 week-ends */
  projection?: number[];
  /** forecast: short hints the player can use ("Storm week 12", "Tier 2 fixed costs") */
  hints?: string[];
  /** variance: size of the leak hidden in the ledger (USD) */
  leak?: number;
  /** free-form label, e.g. the asset name the order targets ("Twin N-12") */
  assetName?: string;
  /** the work-order kind that launched it (e.g. "alternator", "cylinder") so a puzzle can pick the real procedure */
  job?: string;
  /**
   * the airplane's paper trail (src/sim/aircraft.ts aircraftOf): identity, logbooks, IPC, AMM
   * and alterations. Paperwork puzzles use it as-is; without it they build one from the seed.
   */
  aircraft?: Aircraft;
  /** the task card's values for this airplane (card-driven torque and hydraulic servicing) */
  card?: ManualCard;
  /**
   * launched by the part chain (src/sim/chain.ts): the IPC lookup or the logbook research for this
   * part; `found` is what the job found (the squawk), `from` the job that found it, `by` and `week` who and when
   */
  chain?: { step: 'lookup' | 'research'; tag: string; item: string; found: string; from?: string; by?: string; week?: number };
  /**
   * ground power start: the cart hooked up to the plane (the island's GSE state).
   * `charge` 0..100: a low cart's output sags under the start load.
   */
  cart?: { name: string; charge: number };
  /** ground power start: the island's plane, by its external power placard (the airframe the start is on) */
  plane?: { name: string; reg: string; designation: string; turbine: boolean; floats: boolean; ampMax: number; wing: 'high' | 'low'; battery: 'on' | 'off' };
  /** the part chain's circuit check (the meter on the airplane): what is really wrong, the unit or its wiring */
  bench?: { fault: 'unit' | 'wiring' };
  /**
   * the job flow (docs/JOBFLOW.md 8.7): the lines the tech chose for this job, so the puzzle labels
   * what is going in (the device, the stick size, the panelboard). Display only: scoring is unchanged
   */
  pick?: { pn: string; nomen: string; qty: number; slot?: string; spec?: ElecSpec }[];
  /**
   * the job flow's electrical site (docs/JOBFLOW.md 6): the alert's room, its breaker, one device on an individual
   * circuit, and what the complaint is (a dead run, a warm termination, a loose neutral that shows under load), so
   * the trace and the meter play that circuit, not a stock one
   */
  site?: PuzzleSite;
  /** the parts auction (17.3): the broker's lot a win buys, at list and the broker's fair price */
  lot?: { lines: { pn: string; nomen: string; qty: number; list: number }[]; fair: number; list: number };
  /** the three-way match (17.3): the POs received at the last resolve and not paid yet (their real lines) */
  invoice?: InvoiceContext;
}

/** One value as the manual prints it, with the effectivity it applies to. */
export type CardLine = {
  /** effectivity code (A/B by S/N, C/D by SB; 'ICA': the alteration's own value); none = all */
  eff?: string;
  /** "S/N 310R0001 THRU 310R0519", "POST Beaumont SB 219", "Seaboard ICA SPC-61-4, Rev B · STC SA02971SE" */
  effText?: string;
  /** true on the line for this airplane's S/N and SB status (on an altered assembly: the ICA's line) */
  applies: boolean;
  /** the ICA's line for an assembly an alteration replaced (it governs over the airframe manual's) */
  ica?: boolean;
  /** an airframe-manual line for an assembly an alteration replaced: what replaced it ("STC SA02971SE") */
  replaced?: string;
};

/**
 * The AMM task card's numbers for this airplane, both effectivities printed as
 * the manual prints them. Tiers 0-2 mark the one that applies (`marked`); from
 * tier 3, matching the S/N and SB status is the mechanic's job.
 */
export type ManualCard = {
  reg: string;
  serial: string;
  /** "AMM 32-40-01" */
  task: string;
  marked: boolean;
  /** SBs complied with on this airplane (the records the card's C/D lines depend on) */
  sbs: string[];
  /** the alteration that replaced this card's assembly, as the records name it ("STC SA02971SE, Seaboard Propeller Conversions"); its ICA line governs */
  alteration?: string;
  torque?: { key: string; what: string; lines: (CardLine & { lo: number; hi: number; unit: string; note?: string })[] };
  precharge?: { what: string; lines: (CardLine & { psi: number; refTemp: number })[] };
  fluid?: { lines: (CardLine & { fluids: string[] })[] };
};

export interface PuzzleParams {
  seed: number;
  /** 0 = tutorial (no timer, forgiving), 1..5 = order tier */
  tier: number;
  /** tool ids unlocked on the player's role track; change how the puzzle plays */
  tools: string[];
  reducedMotion: boolean;
  context?: PuzzleContext;
  /**
   * Blind sign-off (a real job at tier 2+): no verdict while you work or when
   * you finish. Wrong moves are accepted silently (still scored), no ✓/✗,
   * no hint of the right answer, no end-of-job reveal. What real instruments
   * show stays: a gauge needle, a voltage, a tester's 120/0, a UV glow, a part
   * that won't come off.
   */
  blind?: boolean;
}

export interface PuzzleResult {
  /** 0..1. >= 0.6 is a pass (full order credit), >= 0.95 is perfect */
  score: number;
  perfect: boolean;
  /** one short line for the result card, e.g. "5/6 bolts in band, 1 overshoot" */
  summary: string;
  data?: Record<string, unknown>;
}

export interface PuzzleHost {
  /** the puzzle owns everything inside this element; it is sized by the host */
  el: HTMLElement;
  fx: Fx;
  /** call exactly once when the attempt is complete */
  done(result: PuzzleResult): void;
  /** lock in a result now (the clock stops) and deliver it after a short finish animation */
  hold?(result: PuzzleResult, ms: number): void;
  /** short status line shown by the host, e.g. "Bolt 3 of 6" */
  status(text: string): void;
  /** true while the help overlay is open or the app is backgrounded */
  paused(): boolean;
}

export interface PuzzleInstance {
  /** timer ran out: score the current state as-is (partial credit, never zero by default) */
  timeUp(): PuzzleResult;
  destroy(): void;
}

export interface PuzzleDef {
  id: PuzzleId;
  role: PuzzleRole;
  title: string;
  /** the one physical gesture, e.g. "Rotate dial + tap" */
  gesture: string;
  /** first-encounter overlay text, max 12 words */
  howTo: string;
  /** plain-language tooltip for the real term, max ~15 words */
  term: string;
  /** the job's own term when the context changes the scenario (an airplane's 28 V DC circuit on the meter) */
  termFor?(context?: PuzzleContext): string | undefined;
  /** the scene's own name and first-encounter line when the job makes it a different place (the trace's underground feeder) */
  titleFor?(context?: PuzzleContext): string | undefined;
  howToFor?(context?: PuzzleContext): string | undefined;
  /** time budget in seconds for a tier (tier 0 is untimed and ignored); the context when the job changes it (a turbine start) */
  seconds(tier: number, context?: PuzzleContext): number;
  mount(host: PuzzleHost, params: PuzzleParams): PuzzleInstance;
}

export const PASS = 0.6;
export const PERFECT = 0.95;

export function result(score: number, summary: string, data?: Record<string, unknown>): PuzzleResult {
  const s = Math.max(0, Math.min(1, score));
  return { score: s, perfect: s >= PERFECT, summary, data };
}
