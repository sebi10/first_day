// The job flow's host in the ops panel: it listens for `ic:open` (the Dock's
// Next, Your move's rows: an alert opens its job-flow sheet, an order starts
// or opens) and `ic:flow` (a one-tap Start, the Stores chip), and owns the
// sheets: the job flow, the stop sheet, the one-tap shortfall, Stores. Start
// on a flow job runs the install check first: a stop shows the stop sheet,
// never the puzzle.
import { useEffect, useRef, useState } from 'preact/hooks';
import { installCheck } from '../../sim/flow';
import { itemById, unitWords } from '../../sim/items';
import type { Order, OpsRole } from '../../sim/types';
import { fx } from '../feedback';
import { Btn, Sheet, toast } from '../kit';
import type { DockTarget } from '../select';
import type { Ctl } from '../useIsland';
import { JobFlow } from './JobFlow';
import { newDraft, oneTapShort, researchRepick, sendAction } from './steps';
import { StockView } from './StockView';
import { StopSheet } from './StopSheet';
import { nameOf, shortOf } from './words';

export type FlowHostProps = {
  ctl: Ctl;
  role: OpsRole;
  /** launch a job's puzzle (the ground power check and the rest are the caller's) */
  onPlay(o: Order): void;
  /** open an order that isn't a flow job (a load sheet, a report, a legacy order, a circuit check): the ops panel's own sheet */
  onOrder(o: Order): void;
  /** why this seat can't start a job now (grid down, a report's cap), or null */
  heldWhy(o: Order): string | null;
};

export function FlowHost({ ctl, role, onPlay, onOrder, heldWhy }: FlowHostProps) {
  const { s } = ctl;
  const [open, setOpen] = useState<{ alert: string; repick?: boolean } | null>(null);
  const [stop, setStop] = useState<{ order: string; stop: string; research?: boolean } | null>(null);
  const [short, setShort] = useState<string | null>(null);
  const [stores, setStores] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const live = useRef({ s, ctl, onPlay, onOrder, heldWhy });
  live.current = { s, ctl, onPlay, onOrder, heldWhy };

  /** Start a job: the turn, the per-turn limits, then the install check (a stop shows the stop sheet) */
  const start = (o: Order) => {
    const { s: st, onPlay: play, heldWhy: why } = live.current;
    const cur = st.orders.find((x) => x.id === o.id) ?? o;
    if (st.turns[role]?.ended) return void toast('Your turn is over for this week.');
    const held = why(cur);
    if (held) return void toast(held);
    if (cur.status !== 'ready') return void setOpen(cur.flow ? { alert: cur.flow.alert } : null);
    const c = cur.flow ? installCheck(st, cur) : null;
    setOpen(null);
    if (c) {
      fx.bad();
      setStop({ order: cur.id, stop: c.stop, research: !!c.research });
      return;
    }
    play(cur);
  };

  const openOrder = (id: string) => {
    const { s: st, onOrder: other } = live.current;
    const o = st.orders.find((x) => x.id === id);
    if (!o) return;
    if (o.flow) {
      if (o.status === 'ready') return start(o);
      setOpen({ alert: o.flow.alert });
      return;
    }
    other(o);
  };

  /** the one-tap Start (an inspection, code prep): plan it, then start it once it's ready; short on the shelf, say so first */
  const oneTap = (id: string) => {
    const { s: st, ctl: c } = live.current;
    const a = st.alerts?.find((x) => x.id === id);
    if (!a || a.status !== 'open') return;
    if (st.turns[role]?.ended) return void toast('Your turn is over for this week.');
    if (oneTapShort(st, a).length) return void setShort(id);
    const x = sendAction(st, a, newDraft(st, a));
    if ('error' in x) return void toast(x.error);
    void c.dispatch(x).then((ok) => ok && setPending(id));
  };

  useEffect(() => {
    const onOpen = (e: Event) => {
      const t = (e as CustomEvent<DockTarget>).detail;
      if (!t) return;
      if ('alert' in t) {
        const a = live.current.s.alerts?.find((x) => x.id === t.alert);
        if (a && a.role === role) setOpen({ alert: t.alert });
      } else if ('order' in t) openOrder(t.order);
    };
    const onFlow = (e: Event) => {
      const t = (e as CustomEvent<{ alert?: string; start?: boolean; stores?: boolean }>).detail;
      if (t?.start && t.alert) oneTap(t.alert);
      if (t?.stores) setStores(true);
    };
    window.addEventListener('ic:open', onOpen);
    window.addEventListener('ic:flow', onFlow);
    return () => {
      window.removeEventListener('ic:open', onOpen);
      window.removeEventListener('ic:flow', onFlow);
    };
  }, [role]);

  // a one-tap plan landed: start it if it's ready, else say where it went
  useEffect(() => {
    if (!pending) return;
    const a = s.alerts?.find((x) => x.id === pending);
    const o = a?.order ? s.orders.find((x) => x.id === a.order) : undefined;
    if (!o) return;
    setPending(null);
    if (o.status === 'ready') start(o);
    else toast(o.status === 'pending' ? `Card sent to ${nameOf(s, 'fin')}.` : 'Planned: waiting on parts.');
  }, [s, pending]);

  const alert = open ? s.alerts?.find((x) => x.id === open.alert) : undefined;
  const stopOrder = stop ? s.orders.find((x) => x.id === stop.order) : undefined;
  const shortAlert = short ? s.alerts?.find((x) => x.id === short) : undefined;
  const shortRows = shortAlert ? oneTapShort(s, shortAlert) : [];
  return (
    <>
      {open && alert && <JobFlow key={`${open.alert}:${open.repick ? 'r' : ''}`} ctl={ctl} alert={alert} repick={open.repick} onClose={() => setOpen(null)} onStart={start} />}
      <Sheet open={!!stop && !!stopOrder} onClose={() => setStop(null)} label="Work stopped">
        {stop && stopOrder && (
          <StopSheet
            s={s}
            o={stopOrder}
            stop={stop.stop}
            research={stop.research}
            onClose={() => setStop(null)}
            onRepick={() => {
              setStop(null);
              if (stopOrder.flow) setOpen({ alert: stopOrder.flow.alert, repick: true });
            }}
            onResearch={() => {
              const x = researchRepick(s, stopOrder);
              setStop(null);
              if (x) void ctl.dispatch(x).then((ok) => ok && toast("Sent to research: next, the airplane's logbooks."));
            }}
          />
        )}
      </Sheet>
      <Sheet open={!!shortAlert} onClose={() => setShort(null)} label="Short on the shelf">
        {shortAlert && (
          <div class="col" style={{ gap: 12 }}>
            <h2>Short on the shelf</h2>
            <span class="label">{shortOf(s, shortAlert)}: the task's own stock isn't all there.</span>
            {shortRows.map((r) => {
              const x = itemById(r.item);
              return (
                <b key={r.item}>
                  {x ? `${unitWords(x, r.buy)} of ${x.kind === 'tool' ? x.nomen : x.nomen.split(',')[0]}` : r.item} short
                </b>
              );
            })}
            <Btn
              block
              onClick={() => {
                const a = shortAlert;
                setShort(null);
                const x = sendAction(s, a, newDraft(s, a));
                if (!('error' in x)) void ctl.dispatch(x).then((ok) => ok && toast(`Card sent to ${nameOf(s, 'fin')}: it's bought, and it lands at the resolve.`));
              }}
            >
              Send it to {nameOf(s, 'fin')} as a card ▸
            </Btn>
            <Btn
              block
              kind="soft"
              onClick={() => {
                const id = shortAlert.id;
                setShort(null);
                setOpen({ alert: id });
              }}
            >
              Open the job
            </Btn>
            <Btn block kind="ghost" onClick={() => setShort(null)}>
              Not now
            </Btn>
          </div>
        )}
      </Sheet>
      <Sheet open={stores} onClose={() => setStores(false)} label="Stores">
        {stores && <StockView ctl={ctl} role={role} onClose={() => setStores(false)} />}
      </Sheet>
    </>
  );
}

/** open Stores (the tech's read-only stock view) */
export const openStores = () => window.dispatchEvent(new CustomEvent('ic:flow', { detail: { stores: true } }));
