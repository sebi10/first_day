// A line's stock badge (docs/JOBFLOW.md 17.2): what's on the shelf for it,
// never whether it's the right part (the shelf holds near-miss stock too).
//   parts: "4 on hand ✓" (palm) · "2 on hand · need 4" (amber) · "0 · on order, lands tonight" (sea) · "none" (rust)
//   tools: "owned" · "not owned: on the card (capex $620)" · "on order, lands next week"
import { itemById, unitWords } from '../../sim/items';
import { available, onOrderFree, owned, toolComing } from '../../sim/stock';
import type { IslandState, ItemId } from '../../sim/types';
import type { StockRow } from './steps';
import { landsWords } from './words';

const qtyWords = (item: ItemId, n: number) => {
  const x = itemById(item);
  return x ? unitWords(x, n) : String(n);
};

export function StockBadge({ row, week }: { row: StockRow; week: number }) {
  const on = row.onOrder?.eta !== undefined ? ` · on order, ${landsWords(week, row.onOrder.eta)}` : row.onOrder?.qty ? ' · on order' : '';
  switch (row.badge) {
    case 'ok':
      return <span class="jf-badge ok">{qtyWords(row.item, row.have)} on hand ✓</span>;
    case 'short':
      return (
        <span class="jf-badge short">
          {qtyWords(row.item, row.have)} on hand · need {qtyWords(row.item, row.qty)}
          {on}
        </span>
      );
    case 'order':
      return <span class="jf-badge coming">0{on}</span>;
    case 'none':
      return <span class="jf-badge none">none</span>;
    case 'owned':
      return <span class="jf-badge ok">owned ✓</span>;
    case 'toolOrder':
      return <span class="jf-badge coming">on order{row.onOrder?.eta !== undefined ? `, ${landsWords(week, row.onOrder.eta)}` : ''}</span>;
    case 'tool':
      return <span class="jf-badge none">not owned: on the card (capex ${Math.round(row.value).toLocaleString('en-US')})</span>;
  }
}

/** a search result's stock at a glance: "3 on hand", "on order, lands tonight", "none in stores" (a tool: owned, or nothing) */
export function ShelfBadge({ s, item }: { s: IslandState; item: ItemId }) {
  const x = itemById(item);
  if (!x) return null;
  if (x.kind === 'tool') {
    if (owned(s, item)) return <span class="jf-badge ok">owned</span>;
    if (toolComing(s, item)) return <span class="jf-badge coming">on order</span>;
    return null;
  }
  const n = available(s, item);
  if (n > 0) return <span class="jf-badge ok">{unitWords(x, n)} on hand</span>;
  const o = onOrderFree(s, item);
  if (o.qty > 0) return <span class="jf-badge coming">on order{o.eta !== undefined ? `, ${landsWords(s.week, o.eta)}` : ''}</span>;
  return <span class="jf-badge quiet">none in stores</span>;
}
