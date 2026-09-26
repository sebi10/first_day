// Crew board: a persistent message board for the three of you, plus direct
// messages between any two seats. It lives in the island itself, so it syncs to
// every phone and computer and works offline.
import { useEffect, useState } from 'preact/hooks';
import { sessions, type IslandRef } from '../net/session';
import { ROLE_LABEL } from '../sim/data';
import { BOARD } from '../sim/engine';
import { ROLES, type BoardPost, type IslandState, type Role } from '../sim/types';
import { fx } from './feedback';
import { Btn } from './kit';
import { ROLE_TINT } from './theme';
import type { Ctl } from './useIsland';

/** 'crew' is the shared board; a role is the DM thread with that seat. */
type Thread = 'crew' | Role;

const dmKey = (me: Role, other: Role) => `${me}>${other}`;

function inThread(p: BoardPost, me: Role, t: Thread) {
  if (t === 'crew') return !p.to;
  return (p.role === me && p.to === t) || (p.role === t && p.to === me);
}

function seenFor(ref: IslandRef, me: Role, t: Thread) {
  const r = sessions.ref(ref.id) ?? ref;
  return t === 'crew' ? (r.lastSeenBoard?.[me] ?? 0) : (r.lastSeenDm?.[dmKey(me, t)] ?? 0);
}

function unreadIn(s: IslandState, ref: IslandRef, me: Role, t: Thread) {
  const seen = seenFor(ref, me, t);
  return (s.board ?? []).filter((p) => p.id > seen && p.role !== me && inThread(p, me, t)).length;
}

/** Messages to this seat (crew board + DMs) this device hasn't seen yet. */
export function unreadBoard(s: IslandState, ref: IslandRef, role: Role | null) {
  if (!role) return 0;
  return (['crew', ...ROLES.filter((r) => r !== role)] as Thread[]).reduce((n, t) => n + unreadIn(s, ref, role, t), 0);
}

function when(at: number, now = Date.now()) {
  const m = Math.round((now - at) / 60_000);
  if (m < 1) return 'now';
  if (m < 60) return `${m} min`;
  const d = new Date(at);
  const sameDay = new Date(now).toDateString() === d.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return sameDay ? time : `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`;
}

export function CrewBoard({ ctl }: { ctl: Ctl }) {
  const { s, role, ref } = ctl;
  const me = role!;
  const [thread, setThread] = useState<Thread>('crew');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [all, setAll] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const others = ROLES.filter((r) => r !== me && s.players[r]);
  const posts = (s.board ?? []).filter((p) => inThread(p, me, thread));
  const pinned = thread === 'crew' ? posts.filter((p) => p.pinned) : [];
  const recent = posts.filter((p) => !p.pinned).reverse();
  const shown = all ? recent : recent.slice(0, 6);
  const newest = posts.reduce((n, p) => Math.max(n, p.id), 0);
  const peer = thread === 'crew' ? null : s.players[thread];

  // reading a thread marks it seen for this seat on this device
  useEffect(() => {
    if (!role || newest <= seenFor(ref, me, thread)) return;
    const cur = sessions.ref(ref.id);
    if (thread === 'crew') sessions.patch(ref.id, { lastSeenBoard: { ...(cur?.lastSeenBoard ?? {}), [me]: newest } });
    else sessions.patch(ref.id, { lastSeenDm: { ...(cur?.lastSeenDm ?? {}), [dmKey(me, thread)]: newest } });
  }, [newest, role, thread]);

  const post = async () => {
    if (!role || !text.trim() || busy) return;
    setBusy(true);
    const ok = await ctl.dispatch({ t: 'post', role, text, ...(thread === 'crew' ? {} : { to: thread }) });
    setBusy(false);
    if (ok) {
      setText('');
      fx.tap();
    }
  };

  const Item = ({ p }: { p: BoardPost }) => (
    <div class={`post ${p.pinned ? 'pinned' : ''}`}>
      <span class="avatar" style={{ ['--tint' as string]: ROLE_TINT[p.role], width: 30, height: 30, fontSize: 13 }}>
        {p.name[0]}
      </span>
      <div class="col grow" style={{ gap: 2, minWidth: 0 }}>
        <div class="row" style={{ gap: 6, alignItems: 'baseline' }}>
          <b style={{ fontSize: 14 }}>{p.name}</b>
          <span class="label">
            {ROLE_LABEL[p.role]} · {when(p.at)} · wk {p.week}
          </span>
        </div>
        <div class="post-text">{p.text}</div>
        <div class="row" style={{ gap: 12 }}>
          {!p.to && (
            <button class="linkish" onClick={() => void ctl.dispatch({ t: 'pin', role: me, id: p.id, on: !p.pinned })}>
              {p.pinned ? 'Unpin' : 'Pin'}
            </button>
          )}
          {p.role === me &&
            (confirmDelete === p.id ? (
              <button
                class="linkish fault"
                onClick={() => {
                  setConfirmDelete(null);
                  void ctl.dispatch({ t: 'unpost', role: me, id: p.id });
                }}
              >
                {p.to ? 'Delete for both of you?' : 'Delete for everyone?'}
              </button>
            ) : (
              <button class="linkish" onClick={() => setConfirmDelete(p.id)}>
                Delete
              </button>
            ))}
        </div>
      </div>
    </div>
  );

  const Tab = ({ t, label }: { t: Thread; label: string }) => {
    const n = unreadIn(s, ref, me, t);
    return (
      <button
        role="tab"
        aria-selected={thread === t}
        class={`chip ${thread === t ? 'ink' : ''}`}
        style={{ border: 0, minHeight: 34, gap: 6, ...(t !== 'crew' ? { ['--tint' as string]: ROLE_TINT[t] } : {}) }}
        onClick={() => {
          fx.tap();
          setThread(t);
          setAll(false);
          setConfirmDelete(null);
        }}
      >
        {label}
        {n > 0 && <span class="badge-inline">{n}</span>}
      </button>
    );
  };

  return (
    <div class="card col" style={{ gap: 10 }} id="crew-board">
      <div class="row spread">
        <h3>Crew board</h3>
        <span class="label">{thread === 'crew' ? 'Plans, heads-ups, trash talk' : `Just you and ${peer?.name}`}</span>
      </div>
      {others.length > 0 && (
        <div class="row wrap" role="tablist" aria-label="Board or direct messages" style={{ gap: 6 }}>
          <Tab t="crew" label="Crew" />
          {others.map((r) => (
            <Tab key={r} t={r} label={`✉ ${s.players[r]!.name}`} />
          ))}
        </div>
      )}
      {pinned.length > 0 && (
        <div class="col" style={{ gap: 8 }}>
          {pinned.map((p) => (
            <Item key={p.id} p={p} />
          ))}
        </div>
      )}
      <div class="composer">
        <textarea
          value={text}
          maxLength={BOARD.maxLength}
          rows={2}
          placeholder={peer ? `Message ${peer.name} privately…` : `Message the crew as ${s.players[me]?.name ?? 'you'}…`}
          aria-label={peer ? `Message ${peer.name}` : 'Message the crew'}
          onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
          onKeyDown={(e) => {
            // Enter posts on a computer; Shift+Enter adds a line
            if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) {
              e.preventDefault();
              void post();
            }
          }}
        />
        <Btn small disabled={!text.trim() || busy} onClick={post}>
          {peer ? 'Send' : 'Post'}
        </Btn>
      </div>
      {text.length > BOARD.maxLength - 80 && <span class="label num">{BOARD.maxLength - text.length} characters left</span>}
      {peer && (
        <span class="label">
          Only you and {peer.name} see this thread in the game. It is stored with the island (not end-to-end encrypted), so keep it friendly.
        </span>
      )}
      {recent.length === 0 && pinned.length === 0 && (
        <span class="muted">{peer ? `No messages with ${peer.name} yet.` : 'Nothing yet. Say hi, or pin the house rules.'}</span>
      )}
      <div class="col" style={{ gap: 8 }}>
        {shown.map((p) => (
          <Item key={p.id} p={p} />
        ))}
      </div>
      {recent.length > 6 && (
        <button class="linkish" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${recent.length}`}
        </button>
      )}
    </div>
  );
}
