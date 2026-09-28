// The fixtures' badge on their inspect sheets (docs/EXPANSION.md 6.3): the hangar,
// the office, the runway, the fuel dock and its E-stop, the dock and boats, the
// windsock, a terminal. Their facts are select.ts's fixtureFacts plus the seat's
// own lines (facts.ts); what's wrong with one is a report on its fixer, told by a
// DM (Report.tsx), never raised from the sheet. Package C.
import type { ObjectKind } from '../objects';
import { Icon } from '../kit';
import { C } from '../theme';

const ICON: Partial<Record<ObjectKind, string>> = {
  hangar: 'wrench',
  office: 'chart',
  runway: 'plane',
  fuel: 'box',
  estop: 'alert',
  dock: 'boat',
  windsock: 'wind',
  terminal: 'people',
  cart: 'bolt',
  staff: 'user',
  site: 'hardhat',
  plane: 'plane',
  house: 'house',
  grid: 'bolt',
  generator: 'gear',
};

/** the object's icon in a sand disc, beside its name */
export function KindBadge({ kind }: { kind: ObjectKind }) {
  return (
    <span aria-hidden="true" style={{ width: 44, height: 44, flex: 'none', borderRadius: 999, background: 'var(--sand)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={ICON[kind] ?? 'island'} size={22} color={C.seaDeep} />
    </span>
  );
}
