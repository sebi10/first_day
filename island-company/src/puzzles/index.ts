import { auction } from './auction';
import { balance } from './balance';
import { conduit } from './conduit';
import { invoice } from './invoice';
import { meter } from './meter';
import { reconcile } from './reconcile';
import { safetywire } from './safetywire';
import { crack } from './crack';
import { forecast } from './forecast';
import { hydraulics } from './hydraulics';
import { gpu } from './gpu';
import { panel } from './panel';
import { teardown } from './teardown';
import { torque } from './torque';
import { trace } from './trace';
import type { PuzzleDef, PuzzleId } from './types';
import { variance } from './variance';
import { wireup } from './wireup';

export const PUZZLES: Record<PuzzleId, PuzzleDef> = {
  torque,
  crack,
  teardown,
  trace,
  panel,
  wireup,
  variance,
  auction,
  forecast,
  balance,
  safetywire,
  meter,
  conduit,
  reconcile,
  invoice,
  hydraulics,
  gpu,
};
