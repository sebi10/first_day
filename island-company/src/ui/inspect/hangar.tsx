// The hangar on its inspect sheet (docs/EXPANSION.md 6.3, the mechanic's row): the
// ground power carts at a glance, each with its charge, where it is and its cable
// as last inspected (never the cable's hidden wear). A tap on the sheet's Ground
// power opens the cart sheet itself (gse.tsx, unchanged). Package C.
import { chargeColor } from '../gse';
import type { Block } from './facts';

export function CartsBlock({ b }: { b: Extract<Block, { t: 'carts' }> }) {
  return (
    <div class="insp-carts">
      {b.rows.map((c) => (
        <div key={c.id} class="insp-cart">
          <b>
            {c.name} · <span class="label">{c.where}</span>
          </b>
          <b class={`num ${c.charge < 30 ? 'fault' : ''}`}>{c.charge}%</b>
          <div class="bar" role="meter" aria-valuenow={c.charge} aria-valuemin={0} aria-valuemax={100} aria-label={`${c.name} charge`}>
            <i style={{ width: `${c.charge}%`, background: chargeColor(c.charge) }} />
          </div>
          <span class="label" style={{ gridColumn: '1 / -1' }}>
            {c.cable}
            {c.tagged ? ' · tagged out' : ''}
          </span>
        </div>
      ))}
    </div>
  );
}
