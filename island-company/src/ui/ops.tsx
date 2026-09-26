// Mechanic hangar / electrician cottages: assets, work orders, covering.
import { useState } from 'preact/hooks';
import { ECON, MODELS } from '../sim/data';
import { houseBlocker, orderCost, orderTier, planeCapacity, powered } from '../sim/econ';
import { squawkable } from '../sim/engine';
import type { Asset, Order, Role } from '../sim/types';
import { Btn, Health, Icon, Sheet, TierDots, usd } from './kit';
import { OrderCard, OrderDetail } from './orders';
import { capNow, openOrders } from './select';
import type { Ctl } from './useIsland';

export function OpsPanel({ ctl, role, onPlay }: { ctl: Ctl; role: 'mech' | 'elec'; onPlay(o: Order, cover?: boolean): void }) {
  const { s } = ctl;
  const [sel, setSel] = useState<Order | null>(null);
  const [writeUp, setWriteUp] = useState<Asset | null>(null);
  const orders = openOrders(s, role);
  const turn = s.turns[role];
  const canWrite = s.week >= 1 && !turn?.ended && s.squawked?.[role] !== s.week;
  const pw = powered(s);
  const gridCapped = role === 'mech' && pw.gridDown && (turn?.done ?? 0) >= 1;
  // a crewmate hasn't fixed what this seat reported: fewer jobs per turn
  const cap = capNow(s, role);
  const capped = gridCapped || !!cap?.full;

  // a repair, a redo or a crewmate's report opens its story first (why it exists), with a Start button
  const open = (o: Order) => {
    if (o.status === 'ready' && !turn?.ended && !capped && !hasOrigin(o)) onPlay(o);
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
              const grounded = !!s.tags?.[p.id];
              return (
                <div class="asset" key={p.id} style={{ gridTemplateColumns: '26px 1fr auto auto' }}>
                  <Icon name="plane" size={22} />
                  <button class="asset-tap" onClick={() => setWriteUp(p)} aria-label={`${p.name}: details and write-up`}>
                    <Health value={p.health} label={`${p.name} · ${MODELS[p.model].label}`} />
                  </button>
                  <span class="col" style={{ gap: 0, alignItems: 'flex-end' }}>
                    <b class={`num ${cap === 0 && !grounded ? 'fault' : ''}`}>{grounded ? 'GND' : cap === 0 ? 'AOG' : `${cap} fl`}</b>
                    <span class="label num">{p.sinceInspection ?? 0}/{ECON.planeInspectionFlights} insp</span>
                  </span>
                  <SafetyCall ctl={ctl} role={role} id={p.id} on={grounded} word="Ground" />
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
              const tagged = !!s.tags?.[h.id];
              return (
                <div class="asset" key={h.id} style={{ gridTemplateColumns: '26px 1fr auto auto' }}>
                  <Icon name={h.kind === 'house' ? 'house' : 'bolt'} size={22} />
                  <button class="asset-tap" onClick={() => setWriteUp(h)} aria-label={`${h.name}: details and write-up`}>
                    <Health value={h.health} label={label} />
                  </button>
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
                  {h.kind === 'grid' ? <span /> : <SafetyCall ctl={ctl} role={role} id={h.id} on={tagged} word="Red-tag" />}
                </div>
              );
            })}
      </div>

      <span class="label" style={{ padding: '0 4px' }}>
        {canWrite ? 'Tap an asset to write up what it needs (1 squawk a week). The analyst decides if it’s worth the money.' : s.squawked?.[role] === s.week ? 'Squawk written up this week.' : ''}
      </span>

      {gridCapped && (
        <div class="card" style={{ borderLeft: '6px solid var(--rust)' }}>
          <b class="fault">Grid down:</b> hangar tools offline, 1 order max this week.
        </div>
      )}
      {cap && <CapNotice cap={cap} />}

      <div class="row spread" style={{ marginTop: 4 }}>
        <h2>Work orders</h2>
        <span class="label">{orders.filter((o) => o.status === 'ready').length} ready</span>
      </div>
      {orders.length === 0 && <div class="card muted">Queue clear. Nice.</div>}
      {orders.map((o) => (
        <OrderCard key={o.id} s={s} o={o} onOpen={open} held={capped || !!turn?.ended} />
      ))}

      <CoverSection ctl={ctl} role={role} onPlay={onPlay} />

      <Sheet open={!!writeUp} onClose={() => setWriteUp(null)} label="Write up">
        {writeUp && <WriteUp ctl={ctl} role={role} asset={writeUp} can={canWrite} onDone={() => setWriteUp(null)} />}
      </Sheet>

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
                {turn?.ended ? 'Your turn is over; this carries to next week.' : gridCapped ? 'Hangar tools offline until the grid is back.' : cap?.text}
              </p>
            )}
            {sel.status === 'ready' && sel.role === role && !turn?.ended && !capped && (
              <Btn
                block
                onClick={() => {
                  const o = sel;
                  setSel(null);
                  onPlay(o);
                }}
              >
                Start the job ▸
              </Btn>
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

/** Orders whose detail explains why they exist: open it before the puzzle. */
export const hasOrigin = (o: Order) => !!(o.repair || o.redo || o.report);

/** A crewmate's unfixed report holds this seat to fewer jobs: say so before a puzzle is wasted. */
export function CapNotice({ cap }: { cap: NonNullable<ReturnType<typeof capNow>> }) {
  const [head, ...rest] = cap.text.split(': ');
  return (
    <div class="card col" style={{ gap: 2, borderLeft: '6px solid var(--rust)' }}>
      <span>
        <b class="fault">{head}:</b> {rest.join(': ')}
      </span>
      <span class="label num">
        {cap.full ? 'Used up this turn. Lend a hand still works.' : `${cap.done} of ${cap.limit} used this turn.`}
      </span>
    </div>
  );
}

/** Squawk: the trade judges what an asset needs and writes it up. Knowing which job fits is the skill. */
function WriteUp({ ctl, role, asset, can, onDone }: { ctl: Ctl; role: Role; asset: Asset; can: boolean; onDone(): void }) {
  const { s } = ctl;
  const a = s.assets.find((x) => x.id === asset.id) ?? asset;
  const openKinds = new Set(s.orders.filter((o) => o.assetId === a.id && o.status !== 'done' && o.status !== 'cancelled').map((o) => o.kind));
  const jobs = squawkable(role, a);
  return (
    <div class="col" style={{ gap: 10 }}>
      <h2>{a.name}</h2>
      <span class="muted">
        Health {Math.round(a.health)}
        {a.kind === 'plane' ? ` · ${a.sinceInspection ?? 0}/${ECON.planeInspectionFlights} flights since inspection` : ''}
        {a.kind === 'house' ? ` · inspection good to week ${a.inspectionUntil}` : ''}
      </span>
      <span class="label">{can ? 'Write up one job this week. Paperwork is automatic; this is for work you judge it needs.' : 'You’ve written up this week’s squawk (or your turn is over).'}</span>
      {jobs.map((c) => {
        const tier = orderTier(c.kind, a, s.tier);
        const cost = orderCost(c.kind, tier);
        const already = openKinds.has(c.kind);
        return (
          <div class="card row" key={c.kind} style={{ gap: 10 }}>
            <span class="col grow" style={{ gap: 2 }}>
              <b>{c.title}</b>
              <span class="row wrap label" style={{ gap: 6 }}>
                <TierDots tier={tier} /> {cost ? usd(cost) : 'no cost'} · +{c.gain}
                {c.parts ? ` · ${c.parts} kit` : ''}
              </span>
            </span>
            <Btn
              small
              kind={already ? 'ghost' : 'soft'}
              disabled={!can || already}
              onClick={async () => {
                if (await ctl.dispatch({ t: 'squawk', role, assetId: a.id, kind: c.kind })) onDone();
              }}
            >
              {already ? 'Open' : 'Write up'}
            </Btn>
          </div>
        );
      })}
    </div>
  );
}

/** Safety call: ground a plane / red-tag a house for this week. Out of service = no flights or guests, but nothing can fail in service. */
function SafetyCall({ ctl, role, id, on, word }: { ctl: Ctl; role: Role; id: string; on: boolean; word: string }) {
  const ended = !!ctl.s.turns[role]?.ended;
  return (
    <button
      class={`chip ${on ? 'rust' : ''}`}
      style={{ border: 0, minHeight: 34, minWidth: 64, justifyContent: 'center' }}
      disabled={ended || ctl.s.week < 1}
      aria-pressed={on}
      title={on ? 'Return to service' : `${word} for this week: no flights/guests, but no in-service failures`}
      onClick={() => void ctl.dispatch({ t: 'tag', role, assetId: id, on: !on })}
    >
      {on ? '↺ Undo' : word}
    </button>
  );
}

/** Lend a hand: one try per week at another trade's job. Real know-how is the gate. */
export function CoverSection({ ctl, role, onPlay }: { ctl: Ctl; role: Role; onPlay(o: Order, cover?: boolean): void }) {
  const { s } = ctl;
  const me = s.players[role];
  if (!me || s.week < 1 || s.turns[role]?.ended) return null;
  const allowance = 1;
  const used = s.coversUsed[role] ?? 0;
  // only jobs that have already waited a week: it relieves gridlock, it doesn't steal work.
  // Never your own report: the trade you reported it to has to fix it (the third trade can help)
  const orders = s.orders.filter((o) => o.role !== role && o.status === 'ready' && o.deferrals >= 1 && o.report?.by !== role);
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
        A job that's waited a week? Try it at expert level, no hints. Your tools stay home, and under 60% botches it: the asset takes −6 and the job stays open.
      </span>
      {used < allowance &&
        orders
          .sort((a, b) => b.deferrals - a.deferrals || b.tier - a.tier)
          .slice(0, 3)
          .map((o) => (
            <OrderCard key={o.id} s={s} o={o} onOpen={() => onPlay(o, true)} />
          ))}
      {used >= allowance && <span class="muted">You already lent a hand this week.</span>}
      <span class="label">Only if you actually know the trade.</span>
    </div>
  );
}
