import type { Aircraft } from '../sim/aircraft';
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
}

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
  /** time budget in seconds for a tier (tier 0 is untimed and ignored) */
  seconds(tier: number): number;
  mount(host: PuzzleHost, params: PuzzleParams): PuzzleInstance;
}

export const PASS = 0.6;
export const PERFECT = 0.95;

export function result(score: number, summary: string, data?: Record<string, unknown>): PuzzleResult {
  const s = Math.max(0, Math.min(1, score));
  return { score: s, perfect: s >= PERFECT, summary, data };
}
