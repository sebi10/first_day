// Stage 2's What's new panels (docs/EXPANSION.md 9.5; package C writes them):
// explore the map, tap anything, your quick check and Report a problem, the
// fixes in plain words. THIS IS PACKAGE A's STUB: no panels, so the version-keyed
// shell (../whatsnew.tsx, mounted by home.tsx) shows nothing yet. C owns it.
import type { IslandState, Role } from '../../sim/types';
import type { WhatsNewPanel } from '../whatsnew';

/** the panels for this seat on this island (a new island's week 1: only what applies then) */
export function whatsNewMapPanels(s: IslandState, role: Role): WhatsNewPanel[] {
  void s;
  void role;
  return [];
}
