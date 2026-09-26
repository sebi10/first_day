// Crew board: a persistent message board for the three of you. It lives in the
// island itself, so it syncs to every phone and computer and works offline.
import { useEffect, useState } from 'preact/hooks';
import { sessions, type IslandRef } from '../net/session';
import { ROLE_LABEL } from '../sim/data';
import { BOARD } from '../sim/engine';
import type { BoardPost, IslandState, Role } from '../sim/types';
import { fx } from './feedback';
import { Btn } from './kit';
import { ROLE_TINT } from './theme';
import type { Ctl } from './useIsland';

/** Messages from the other seats this device hasn't seen yet. */
export function unreadBoard(s: IslandState, ref: IslandRef, role: Role | null) {
  if (!role) return 0;
  const seen = sessions.ref(ref.id)?.lastSeenBoard?.[role] ?? 0;
  return (s.board ?? []).filter((p) => p.id > seen && p.role !== role).length;
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
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [all, setAll] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const posts = s.board ?? [];
  const pinned = posts.filter((p) => p.pinned);
  const recent = posts.filter((p) => !p.pinned).reverse();
  const shown = all ? recent : recent.slice(0, 6);
  const newest = posts.reduce((n, p) => Math.max(n, p.id), 0);

  // reading the board marks it seen for this seat on this device
  useEffect(() => {
    if (!role) return;
    const seen = sessions.ref(ref.id)?.lastSeenBoard ?? {};
    if (newest > (seen[role] ?? 0)) sessions.patch(ref.id, { lastSeenBoard: { ...seen, [role]: newest } });
  }, [newest, role]);

  const post = async () => {
    if (!role || !text.trim() || busy) return;
    setBusy(true);
    const ok = await ctl.dispatch({ t: 'post', role, text });
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
          <button class="linkish" onClick={() => void ctl.dispatch({ t: 'pin', role: role!, id: p.id, on: !p.pinned })}>
            {p.pinned ? 'Unpin' : 'Pin'}
          </button>
          {p.role === role &&
            (confirmDelete === p.id ? (
              <button
                class="linkish fault"
                onClick={() => {
                  setConfirmDelete(null);
                  void ctl.dispatch({ t: 'unpost', role: role!, id: p.id });
                }}
              >
                Delete for everyone?
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

  return (
    <div class="card col" style={{ gap: 10 }} id="crew-board">
      <div class="row spread">
        <h3>Crew board</h3>
        <span class="label">{posts.length ? `${posts.length} message${posts.length > 1 ? 's' : ''}` : 'Plans, heads-ups, trash talk'}</span>
      </div>
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
          placeholder={`Message the crew as ${s.players[role!]?.name ?? 'you'}…`}
          aria-label="Message the crew"
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
          Post
        </Btn>
      </div>
      {text.length > BOARD.maxLength - 80 && <span class="label num">{BOARD.maxLength - text.length} characters left</span>}
      {recent.length === 0 && pinned.length === 0 && <span class="muted">Nothing yet. Say hi, or pin the house rules.</span>}
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
