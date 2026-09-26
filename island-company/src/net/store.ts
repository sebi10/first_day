// One interface, two backends:
//  - local:    everything on this device (pass-and-play, offline demo, tests)
//  - firebase: one Firestore document per island, shared by three phones
// Both run the same pure reducer, so the game logic never forks.
import type { Action, IslandState, Role } from '../sim/types';

export type Mode = 'local' | 'firebase';

export type SyncStatus = { online: boolean; queued: number; error?: string };

export interface IslandStore {
  mode: Mode;
  /** stable id for this device/player */
  uid(): Promise<string>;
  create(o: { name: string; role: Role; playerName: string; passAndPlay?: boolean }): Promise<string>;
  load(id: string): Promise<IslandState | null>;
  subscribe(id: string, cb: (s: IslandState | null) => void): () => void;
  dispatch(id: string, a: Action): Promise<{ error?: string }>;
  status(cb: (s: SyncStatus) => void): () => void;
}

export function newIslandId(): string {
  // 10 chars of Crockford base32 ≈ 50 bits: the link is the key
  const alphabet = '0123456789abcdefghjkmnpqrstvwxyz';
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % 32]).join('');
}

export const PP_UID: Record<Role, string> = { mech: 'pp-mech', elec: 'pp-elec', fin: 'pp-fin' };
