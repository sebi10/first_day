// The technicians' "Your move" group (docs/JOBFLOW.md 17.2): new alerts, ready
// jobs and stopped jobs, due now first. Package A mounts it at the top of
// Home's main column for the techs; package B draws it (select.ts's
// yourMoves / flowMove / dockNext have the data). Until then it renders nothing.
import type { OpsRole } from '../../sim/types';
import type { Ctl } from '../useIsland';

export function YourMove(_props: { ctl: Ctl; role: OpsRole }) {
  return null;
}
