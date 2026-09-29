// Test helper: a paper-sim crew as it played before stage 2 (docs/EXPANSION.md 11.5): no quick checks, no flags.
// For the claims about the base game that a stage-2 move would reshuffle (the sim is chaotic: one extra alert shifts
// every later seed), and for the golden identity with the base build.
import type { Team } from '../src/sim/bots';

export const baseCrew = (t: Team): Team => ({
  mech: { ...t.mech, checks: false, flags: false },
  elec: { ...t.elec, checks: false, flags: false },
  fin: { ...t.fin, checks: false, flags: false },
});
