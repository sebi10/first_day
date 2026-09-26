import { useEffect, useRef, useState } from 'preact/hooks';
import { ntfy } from '../net/notify';
import { sessions, storeFor, type IslandRef } from '../net/session';
import type { SyncStatus } from '../net/store';
import { ROLE_LABEL } from '../sim/data';
import { canResolve, seatOf } from '../sim/engine';
import { ROLES, WEEK_BOUND, type Action, type IslandState, type Role } from '../sim/types';
import { fx } from './feedback';
import { toast, useNow } from './kit';

export type Ctl = {
  s: IslandState;
  ref: IslandRef;
  uid: string | null;
  role: Role | null;
  sync: SyncStatus;
  dispatch(a: Action): Promise<boolean>;
};

export function useIsland(ref: IslandRef) {
  const store = storeFor(ref.mode);
  const [s, setS] = useState<IslandState | null | undefined>(undefined);
  const [uid, setUid] = useState<string | null>(null);
  const [sync, setSync] = useState<SyncStatus>({ online: true, queued: 0 });
  const latest = useRef<IslandState | null>(null);
  latest.current = s ?? null;

  useEffect(() => store.subscribe(ref.id, setS), [ref.id, ref.mode]);
  useEffect(() => store.status(setSync), [ref.mode]);
  // offline moves the server refused once back online (usually: the week closed first)
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ id: string; errors: string[] }>).detail;
      if (d.id !== ref.id || !d.errors.length) return;
      toast(d.errors.length === 1 ? `Didn't sync: ${d.errors[0]}` : `${d.errors.length} offline moves didn't sync: ${d.errors[0]}`);
      fx.bad();
    };
    window.addEventListener('ic:dropped', on);
    return () => window.removeEventListener('ic:dropped', on);
  }, [ref.id]);
  // a session re-created after it died has a new id: follow it
  useEffect(() => store.onUid?.(setUid), [ref.mode]);
  useEffect(() => {
    store
      .uid()
      .then(setUid)
      .catch((e) => {
        setUid(null);
        setSync((x) => ({ ...x, error: String(e?.message ?? e) }));
      });
  }, [ref.mode]);

  const role: Role | null = ref.passAndPlay ? ref.role : s && uid ? seatOf(s, uid) : null;

  const dispatch = async (a: Action): Promise<boolean> => {
    const before = latest.current;
    // stamp the week so a move queued offline can't land in the next one
    if (before && (WEEK_BOUND as readonly string[]).includes(a.t) && (a as { week?: number }).week == null) a = { ...a, week: before.week } as Action;
    const r = await store.dispatch(ref.id, a);
    if (r.error) {
      if (a.t !== 'resolve') {
        toast(r.error);
        fx.bad();
      }
      return false;
    }
    const after = await store.load(ref.id);
    if (before && after) notifyAfter(before, after, a);
    return true;
  };

  // Any phone that notices the deadline resolves the week (idempotent).
  const now = useNow(15_000);
  useEffect(() => {
    if (s && canResolve(s, Date.now())) void dispatch({ t: 'resolve', week: s.week });
  }, [s?.week, s?.deadline, now]);

  // keep the session's display name/role in sync
  useEffect(() => {
    if (s && s.name !== ref.name) sessions.patch(ref.id, { name: s.name });
    if (s && !ref.passAndPlay && role && role !== ref.role) sessions.patch(ref.id, { role });
  }, [s?.name, role]);

  return { s, uid, role, sync, dispatch, store };
}

function notifyAfter(before: IslandState, after: IslandState, a: Action) {
  const topic = after.ntfy;
  if (!topic) return;
  if (after.week > before.week && after.history.length) {
    const h = after.history[after.history.length - 1];
    void ntfy(topic, `${after.name}: week ${h.week} resolved`, `Grade ${h.grade}. Revenue $${h.revenue.toLocaleString('en-US')}, ${h.flightsFlown}/${h.flightsScheduled} flights, ${h.incidents.length} incidents.`);
    return;
  }
  if (a.t === 'endTurn') {
    const waiting = ROLES.filter((r) => !after.turns[r]?.ended).map((r) => after.players[r]?.name ?? ROLE_LABEL[r]);
    const who = after.players[a.role]?.name ?? ROLE_LABEL[a.role];
    if (waiting.length) void ntfy(topic, after.name, `${who} ended their turn. Waiting on ${waiting.join(' and ')}.`);
  }
  if (a.t === 'post') {
    const who = after.players[a.role]?.name ?? ROLE_LABEL[a.role];
    void ntfy(topic, `${who} on the ${after.name} crew board`, a.text.trim().slice(0, 180));
  }
  if (a.t === 'counter') {
    const o = after.orders.find((x) => x.id === a.orderId);
    if (o) void ntfy(topic, after.name, `${after.players[o.role]?.name ?? ROLE_LABEL[o.role]}: the analyst offered a cheaper fix on ${o.title}.`);
  }
}
