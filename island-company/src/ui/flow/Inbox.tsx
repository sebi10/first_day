// The rest of a tech's inbox in the ops panel (Your move sits on top of Home):
//  1. Waiting: approval, parts, the electrician's check, research, each with a
//     chip saying on whom or until when;
//  2. Other work: today's order cards (load sheets, ground power starts,
//     reports, redos, legacy orders, the part chain's paperwork);
//  3. Closed (collapsed): alerts closed this week and last, jobs done this week.
// The Stores chip opens this trade's stock, read-only, with Request.
import { useState } from 'preact/hooks';
import type { OpsRole, Order } from '../../sim/types';
import { Icon } from '../kit';
import { OrderCard } from '../orders';
import { flowMove, openOrders, openTarget } from '../select';
import type { Ctl } from '../useIsland';
import { AlertRow } from './AlertRow';
import { openStores } from './FlowHost';
import { lowLines } from './StockView';

export function Inbox({ ctl, role, onOrder, held }: { ctl: Ctl; role: OpsRole; onOrder(o: Order): void; held(o: Order): boolean }) {
  const { s } = ctl;
  const [closedOpen, setClosedOpen] = useState(false);
  const mine = (s.alerts ?? []).filter((a) => a.role === role);
  const waiting = mine
    .filter((a) => a.status !== 'closed')
    .filter((a) => {
      const m = flowMove(s, a);
      return m.who !== role && m.chip !== 'Done';
    })
    .sort((x, y) => x.due - y.due);
  const other = openOrders(s, role).filter((o) => !o.flow && o.kind !== 'project' && !(o.bench && o.status === 'ready') && o.status !== 'done');
  const closed = mine.filter((a) => a.status === 'closed').sort((x, y) => (y.closed?.week ?? 0) - (x.closed?.week ?? 0));
  const doneOrders = openOrders(s, role).filter((o) => !o.flow && o.status === 'done' && o.kind !== 'project');
  const low = lowLines(s, role).length;
  const turn = s.turns[role];
  return (
    <>
      <div class="row spread jf-inbox-head">
        <h2>Inbox</h2>
        <button class={`chip jf-stores ${low ? 'low' : ''}`} onClick={openStores} aria-label={`Stores${low ? `: ${low} low` : ''}`}>
          <Icon name="box" size={14} /> Stores{low ? `: ${low} low` : ''}
        </button>
      </div>
      {waiting.length > 0 && (
        <div class="card jf-group">
          <div class="row spread">
            <h3>Waiting</h3>
            <span class="label num">{waiting.length}</span>
          </div>
          <div class="jf-rows" role="list">
            {waiting.map((a) => (
              <AlertRow key={a.id} s={s} a={a} me={role} onOpen={() => openTarget({ alert: a.id })} />
            ))}
          </div>
        </div>
      )}
      <div class="col" style={{ gap: 8 }}>
        <div class="row spread" style={{ padding: '0 4px' }}>
          <h3>Other work</h3>
          <span class="label">{other.filter((o) => o.status === 'ready').length} ready</span>
        </div>
        {other.length === 0 && <div class="card muted">Nothing else waiting.</div>}
        {other.map((o) => (
          <OrderCard key={o.id} s={s} o={o} onOpen={onOrder} held={held(o) || !!turn?.ended} me={role} />
        ))}
      </div>
      {closed.length + doneOrders.length > 0 && (
        <details class="card jf-group jf-closed" open={closedOpen} onToggle={(e) => setClosedOpen((e.target as HTMLDetailsElement).open)}>
          <summary>
            <h3>Closed</h3>
            <span class="label num">{closed.length + doneOrders.length}</span>
          </summary>
          <div class="jf-rows" role="list">
            {closed.map((a) => (
              <AlertRow key={a.id} s={s} a={a} me={role} onOpen={() => openTarget({ alert: a.id })} />
            ))}
            {doneOrders.map((o) => (
              <OrderCard key={o.id} s={s} o={o} onOpen={onOrder} me={role} />
            ))}
          </div>
        </details>
      )}
    </>
  );
}
