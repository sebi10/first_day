// Work-order cards: the universal container (same radius, shadow, grammar).
import { ECON, ROLE_LABEL } from '../sim/data';
import { deferralRisk, expectedDeferralCost } from '../sim/econ';
import type { IslandState, Order, Role } from '../sim/types';
import { Icon, TierDots, usd } from './kit';
import { ROLE_TINT } from './theme';

const PUZZLE_ICON: Record<Role, string> = { mech: 'wrench', elec: 'bolt', fin: 'chart' };

export function statusChip(s: IslandState, o: Order) {
  switch (o.status) {
    case 'ready':
      return <span class="chip sea">Ready</span>;
    case 'pending':
      return o.pushedBack ? <span class="chip">Pushed back · analyst</span> : <span class="chip">Needs approval</span>;
    case 'countered':
      return <span class="chip ink">Cheaper fix offered</span>;
    case 'waiting_part':
      return (
        <span class="chip">
          <Icon name="box" size={13} /> Waiting for part
        </span>
      );
    case 'done':
      return <span class="chip palm">Done · {Math.round((o.result?.score ?? 0) * 100)}%{o.result?.perfect ? ' ★' : ''}</span>;
    default:
      return null;
  }
  void s;
}

export function OrderCard({ s, o, onOpen }: { s: IslandState; o: Order; onOpen(o: Order): void }) {
  const asset = s.assets.find((a) => a.id === o.assetId);
  const carried = o.deferrals > 0 && o.status !== 'done';
  const risk = carried ? deferralRisk(o, o.lastDeferredWeek === s.week ? 0 : 1) : 0;
  const cls = `card order ${o.status === 'ready' ? 'ready' : ''} ${o.status === 'done' ? 'done' : ''}`;
  return (
    <button
      class={cls}
      style={{ border: 0, textAlign: 'left', width: '100%', ['--tint' as string]: ROLE_TINT[o.role] }}
      onClick={() => onOpen(o)}
      aria-label={`${o.title}${asset ? ` on ${asset.name}` : ''}, ${o.status.replace('_', ' ')}`}
    >
      <span class="ico" style={{ background: `${ROLE_TINT[o.role]}44` }}>
        <Icon name={PUZZLE_ICON[o.role]} size={22} />
      </span>
      <span class="col grow" style={{ gap: 4 }}>
        <span class="row spread" style={{ alignItems: 'flex-start' }}>
          <b style={{ fontSize: 16, lineHeight: 1.2 }}>{o.title}</b>
          {o.cost > 0 && <span class="num" style={{ fontWeight: 800, fontSize: 15 }}>{usd(o.cost)}</span>}
        </span>
        <span class="row wrap" style={{ gap: 6 }}>
          <span class="label">{asset?.name ?? (o.leak ? `${usd(o.leak)} at stake` : 'Desk')}</span>
          <TierDots tier={o.tier} />
          {o.parts > 0 && <span class="label">· {o.parts} kit</span>}
        </span>
        <span class="row wrap" style={{ gap: 6 }}>
          {statusChip(s, o)}
          {carried && (
            <span class={`chip ${risk >= 0.3 ? 'rust' : ''}`}>
              ⚠ carried {o.deferrals} wk · {Math.round(risk * 100)}% risk
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

export function OrderDetail({ s, o, role }: { s: IslandState; o: Order; role: Role }) {
  const asset = s.assets.find((a) => a.id === o.assetId);
  const e = expectedDeferralCost(s, o);
  return (
    <div class="col" style={{ gap: 10 }}>
      <div class="row spread">
        <h2>{o.title}</h2>
        <TierDots tier={o.tier} />
      </div>
      <span class="muted">
        {asset ? `${asset.name} · health ${Math.round(asset.health)} → up to ${Math.min(100, Math.round(asset.health + o.gain))}` : 'Analyst desk task'}
      </span>
      <div class="row wrap" style={{ gap: 6 }}>
        {statusChip(s, o)}
        {o.cost > 0 && <span class="chip">Cost {usd(o.cost)}</span>}
        {o.parts > 0 && <span class="chip">Needs {o.parts} parts kit</span>}
      </div>
      {o.status === 'pending' && (
        <p class="muted" style={{ margin: 0 }}>
          {role === 'fin'
            ? 'Swipe it on your desk.'
            : `Waiting on the analyst. If it slips a week: ${Math.round(e.p * 100)}% incident risk, expected cost ${usd(e.cost)}.`}
        </p>
      )}
      {o.status === 'waiting_part' && (
        <p class="muted" style={{ margin: 0 }}>
          Approved. The kit rides the next {s.assets.some((a) => a.model === 'cargo') ? 'cargo' : 'guest'} flight ({s.parts.inTransit} in transit, {s.parts.stock} in stock).
          {s.parts.inTransit === 0 ? ` Nothing is in transit: ${ROLE_LABEL.fin} needs to buy one.` : ''}
        </p>
      )}
      {o.status === 'done' && o.result && (
        <p class="muted" style={{ margin: 0 }}>
          {Math.round(o.result.score * 100)}% · {Math.round(Math.min(1.15, o.result.credit) * 100)}% credit{o.result.auto ? ' · autopilot' : ''}
          {o.result.covered ? ' · covered by a teammate' : ''}
          {o.result.summary ? ` · ${o.result.summary}` : ''}
        </p>
      )}
      {s.cash < ECON.freezeBelow && o.status === 'pending' && <p class="fault" style={{ margin: 0 }}>Cash under $2,000: approvals are frozen.</p>}
    </div>
  );
}
