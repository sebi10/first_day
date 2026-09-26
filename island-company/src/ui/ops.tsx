// Mechanic hangar / electrician cottages: assets, work orders, covering.
import { useState } from 'preact/hooks';
import { ECON, MODELS, ROLE_LABEL } from '../sim/data';
import { houseBlocker, planeCapacity, powered } from '../sim/econ';
import { isMentor } from '../sim/progression';
import type { Order, Role } from '../sim/types';
import { Btn, Health, Icon, Sheet, usd } from './kit';
import { OrderCard, OrderDetail } from './orders';
import { openOrders } from './select';
import type { Ctl } from './useIsland';

export function OpsPanel({ ctl, role, onPlay }: { ctl: Ctl; role: 'mech' | 'elec'; onPlay(o: Order, cover?: boolean): void }) {
  const { s } = ctl;
  const [sel, setSel] = useState<Order | null>(null);
  const orders = openOrders(s, role);
  const turn = s.turns[role];
  const pw = powered(s);
  const capped = role === 'mech' && pw.gridDown && (turn?.done ?? 0) >= 1;

  const open = (o: Order) => {
    if (o.status === 'ready' && !turn?.ended && !capped) onPlay(o);
    else setSel(o);
  };

  return (
    <>
      <div class="card col" style={{ gap: 4 }}>
        <div class="row spread">
          <h3>{role === 'mech' ? 'Hangar + airstrip' : 'Cottages + grid'}</h3>
          <span class="label">
            <Icon name="box" size={14} /> parts {s.parts.stock} · {s.parts.inTransit} in transit
          </span>
        </div>
        {role === 'mech' &&
          s.assets
            .filter((a) => a.kind === 'plane')
            .map((p) => {
              const cap = planeCapacity(p, s.tier, s.weather);
              return (
                <div class="asset" key={p.id}>
                  <Icon name="plane" size={22} />
                  <Health value={p.health} label={`${p.name} · ${MODELS[p.model].label}`} />
                  <span class="col" style={{ gap: 0, alignItems: 'flex-end' }}>
                    <b class={`num ${cap === 0 ? 'fault' : ''}`}>{cap === 0 ? 'AOG' : `${cap} fl`}</b>
                    <span class="label num">{p.sinceInspection ?? 0}/{ECON.planeInspectionFlights} insp</span>
                  </span>
                </div>
              );
            })}
        {role === 'elec' &&
          s.assets
            .filter((a) => a.kind !== 'plane')
            .map((h) => {
              const why = h.kind === 'house' ? houseBlocker(s, h) : null;
              const label =
                h.kind === 'grid' ? `${h.name} · ${pw.gridDown ? 'DOWN' : 'live'}` : h.kind === 'generator' ? `${h.name} · ${h.health >= 50 ? 'ready' : 'unreliable'}` : `${h.name}`;
              return (
                <div class="asset" key={h.id}>
                  <Icon name={h.kind === 'house' ? 'house' : 'bolt'} size={22} />
                  <Health value={h.health} label={label} />
                  <span class="col" style={{ gap: 0, alignItems: 'flex-end' }}>
                    {h.kind === 'house' ? (
                      <>
                        <b class={why ? 'fault' : ''} style={{ fontSize: 13 }}>
                          {why ? '⚠ closed' : 'rentable'}
                        </b>
                        <span class="label num">insp wk {h.inspectionUntil}</span>
                      </>
                    ) : (
                      <span class="label">{h.kind === 'grid' ? 'feeds all' : 'backup'}</span>
                    )}
                  </span>
                </div>
              );
            })}
      </div>

      {capped && (
        <div class="card" style={{ borderLeft: '6px solid var(--rust)' }}>
          <b class="fault">Grid down:</b> hangar tools offline, 1 order max this week.
        </div>
      )}

      <div class="row spread" style={{ marginTop: 4 }}>
        <h2>Work orders</h2>
        <span class="label">{orders.filter((o) => o.status === 'ready').length} ready</span>
      </div>
      {orders.length === 0 && <div class="card muted">Queue clear. Nice.</div>}
      {orders.map((o) => (
        <OrderCard key={o.id} s={s} o={o} onOpen={open} />
      ))}

      <CoverSection ctl={ctl} role={role} onPlay={onPlay} />

      <Sheet open={!!sel} onClose={() => setSel(null)} label="Order">
        {sel && (
          <div class="col" style={{ gap: 14 }}>
            <OrderDetail s={s} o={s.orders.find((x) => x.id === sel.id) ?? sel} role={role} />
            {sel.status === 'countered' && sel.counter && (
              <>
                <div class="card" style={{ background: 'var(--sand)' }}>
                  Analyst offers a patch: <b class="num">{usd(sel.counter.cost)}</b> instead of <span class="num">{usd(sel.cost)}</span>, restores{' '}
                  <b>+{sel.counter.gain}</b> instead of +{sel.gain}.
                </div>
                <div class="row" style={{ gap: 8 }}>
                  <Btn
                    kind="ghost"
                    block
                    onClick={async () => {
                      await ctl.dispatch({ t: 'rejectCounter', orderId: sel.id });
                      setSel(null);
                    }}
                  >
                    Push back
                  </Btn>
                  <Btn
                    block
                    onClick={async () => {
                      await ctl.dispatch({ t: 'acceptCounter', orderId: sel.id });
                      setSel(null);
                    }}
                  >
                    Accept
                  </Btn>
                </div>
              </>
            )}
            {sel.status === 'ready' && (turn?.ended || capped) && (
              <p class="muted" style={{ margin: 0 }}>
                {turn?.ended ? 'Your turn is over; this carries to next week.' : 'Hangar tools offline until the grid is back.'}
              </p>
            )}
            <Btn kind="soft" block onClick={() => setSel(null)}>
              Close
            </Btn>
          </div>
        )}
      </Sheet>
    </>
  );
}

/** Lend a hand: one try per week at another trade's job. Real know-how is the gate. */
export function CoverSection({ ctl, role, onPlay }: { ctl: Ctl; role: Role; onPlay(o: Order, cover?: boolean): void }) {
  const { s } = ctl;
  const me = s.players[role];
  if (!me || s.week < 1 || s.turns[role]?.ended) return null;
  const allowance = isMentor(me) ? 2 : 1;
  const used = s.coversUsed[role] ?? 0;
  const orders = s.orders.filter((o) => o.role !== role && o.status === 'ready');
  if (!orders.length) return null;
  return (
    <div class="card col" style={{ gap: 8 }}>
      <div class="row spread">
        <h3>Lend a hand</h3>
        <span class="label num">
          {Math.max(0, allowance - used)}/{allowance} left this week
        </span>
      </div>
      <span class="label">
        Try another trade's job. Your tools stay home, and under 40% botches it: the asset takes −6 and the job stays open for its owner. Only do it if you actually know how.
      </span>
      {used < allowance &&
        orders
          .sort((a, b) => b.deferrals - a.deferrals || b.tier - a.tier)
          .slice(0, 3)
          .map((o) => (
            <OrderCard key={o.id} s={s} o={o} onOpen={() => onPlay(o, true)} />
          ))}
      {used >= allowance && <span class="muted">You already lent a hand this week.</span>}
      <span class="label">{ROLE_LABEL[role]}s can't take tools across trades. Mentors (level 30) get 2 tries.</span>
    </div>
  );
}
