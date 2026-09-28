// The office on its inspect sheet (docs/EXPANSION.md 6.3, the analyst's row): the
// week at a glance, in three numbers: cash, spendable and the runway in weeks of
// fixed costs. The Desk ▸ button (the sheet's primary) opens the desk itself.
// Package C.
import type { Block } from './facts';

export function StatsBlock({ b }: { b: Extract<Block, { t: 'stats' }> }) {
  return (
    <div class="insp-stats">
      {b.items.map((x) => (
        <div key={x.label}>
          <span class="label">{x.label}</span>
          <b class={x.tone === 'rust' ? 'fault' : ''}>{x.value}</b>
        </div>
      ))}
    </div>
  );
}
