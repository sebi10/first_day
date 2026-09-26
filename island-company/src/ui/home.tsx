// The island screen: header, island view, crew, numbers, role panel, dock.
// Mobile: one column, thumb-zone dock. Desktop: island left, work right.
import { useEffect, useState } from 'preact/hooks';
import { sessions, type IslandRef } from '../net/session';
import type { PuzzleResult } from '../puzzles/types';
import { ROLE_LABEL } from '../sim/data';
import { powered, tierDef, urgency } from '../sim/econ';
import { ROLES, type IslandState, type Order, type Role, type WeekReport } from '../sim/types';
import { fmtCountdown } from '../sim/time';
import { Board, Review } from './board';
import { Desk } from './desk';
import { fx } from './feedback';
import { Btn, Icon, Sheet, toast, useNow, usd } from './kit';
import { unreadBoard } from './crewboard';
import { Island } from './island';
import { Me, inviteUrl } from './me';
import { OpsPanel } from './ops';
import { PuzzleHost, type PuzzleLaunch } from './puzzlehost';
import { blocks, launchFor, mateStatus, teamNumbers } from './select';
import { settings } from './settings';
import { shareText } from './share';
import { C, ROLE_TINT } from './theme';
import { useIsland, type Ctl } from './useIsland';
import { Week0 } from './week0';

type Tab = 'island' | 'board' | 'me';

export function IslandScreen({ islandRef }: { islandRef: IslandRef }) {
  const { s, uid, role, sync, dispatch } = useIsland(islandRef);
  const [tab, setTab] = useState<Tab>('island');
  const [play, setPlay] = useState<{ launch: PuzzleLaunch; order: Order; cover: boolean; week: number } | null>(null);
  const [review, setReview] = useState<WeekReport | null>(null);
  const [handoff, setHandoff] = useState<Role | null>(null);
  const reduce = settings.get().reduceMotion;

  // auto-open the newest board review once, but never on top of a running puzzle
  const lastWeek = s?.history[s.history.length - 1]?.week ?? 0;
  useEffect(() => {
    if (!s || !lastWeek || play) return;
    const seen = sessions.ref(islandRef.id)?.lastSeenReview ?? 0;
    if (lastWeek > seen) {
      setReview(s.history[s.history.length - 1]);
      fx.pulse();
    }
  }, [lastWeek, !!play]);
  // the deadline passed mid-puzzle: say so now, not after the player hands in
  useEffect(() => {
    if (play && s && s.week !== play.week) toast(`Week ${play.week} just closed and autopilot filed this job. This run won't count.`);
  }, [s?.week]);

  if (s === undefined) return <Loading text="Loading island…" />;
  if (s === null) return <Loading text="Island not found." back />;
  if (!role) return uid ? <NoSeat s={s} /> : <Loading text="Connecting…" />;

  const ctl: Ctl = { s, ref: islandRef, uid, role, sync, dispatch };
  const me = s.players[role]!;

  if (!me.week0Done) return <Week0 ctl={ctl} role={role} />;

  const onPlay = (o: Order, cover = false) => {
    fx.tap();
    setPlay({ launch: launchFor(s, o, role, cover), order: o, cover, week: s.week });
  };
  const onResult = (o: Order, cover: boolean, week: number) => (r: PuzzleResult) => {
    void dispatch({ t: 'complete', role, orderId: o.id, score: r.score, perfect: r.perfect, summary: r.summary, data: r.data, cover, week });
  };

  const switchSeat = (r: Role) => {
    sessions.patch(islandRef.id, { role: r });
    setHandoff(null);
    toast(`Now playing: ${s.players[r]?.name ?? ROLE_LABEL[r]}`);
  };

  const lefty = settings.get().leftHanded ? 'lefty' : '';

  return (
    <div class={`${reduce ? 'reduce-motion' : ''} ${lefty}`}>
      {tab === 'island' && <Home ctl={ctl} onPlay={onPlay} onSeat={() => setHandoff(role)} />}
      {tab === 'board' && <Board ctl={ctl} onReview={setReview} />}
      {tab === 'me' && <Me ctl={ctl} onLeave={() => (location.hash = '#/')} />}

      <Dock ctl={ctl} tab={tab} setTab={setTab} single={tab !== 'island'} onPlay={onPlay} onSeat={() => setHandoff(role)} />

      {play && (
        <PuzzleHost
          launch={{ ...play.launch, seat: role }}
          onResult={onResult(play.order, play.cover, play.week)}
          onClose={() => setPlay(null)}
          onCancel={() => setPlay(null)}
        />
      )}
      {review && (
        <Review
          s={s}
          r={review}
          onClose={() => {
            sessions.patch(islandRef.id, { lastSeenReview: Math.max(review.week, sessions.ref(islandRef.id)?.lastSeenReview ?? 0) });
            setReview(null);
          }}
        />
      )}
      <Sheet open={!!handoff} onClose={() => setHandoff(null)} label="Switch seat">
        <div class="col" style={{ gap: 10 }}>
          <h2>Pass the phone</h2>
          <span class="muted">Hand it to the next player. Seats on this device:</span>
          {ROLES.map((r) => (
            <button
              key={r}
              class="card row"
              style={{ border: 0, textAlign: 'left', boxShadow: r === role ? 'inset 0 0 0 3px var(--sea)' : undefined }}
              onClick={() => switchSeat(r)}
            >
              <span class="avatar" style={{ ['--tint' as string]: ROLE_TINT[r] }}>
                {(s.players[r]?.name ?? '?')[0]}
              </span>
              <span class="col grow" style={{ gap: 0 }}>
                <b>{s.players[r]?.name}</b>
                <span class="label">
                  {ROLE_LABEL[r]} · {s.turns[r]?.ended ? 'turn ended' : s.players[r]?.week0Done ? 'playing' : 'week 0'}
                </span>
              </span>
            </button>
          ))}
        </div>
      </Sheet>
    </div>
  );
}

/** This device can read the island but holds no seat: never joined, or its sign-in was reset. */
function NoSeat({ s }: { s: IslandState }) {
  return (
    <div class="screen single" style={{ paddingTop: 48 }}>
      <div class="card col" style={{ gap: 10 }}>
        <h2>Relink this device</h2>
        <span class="muted">
          This device isn't linked to a seat on {s.name}. That happens when its sign-in is reset (browser storage cleared, or its account removed in Firebase). Your progress
          is safe on the island.
        </span>
        <span class="muted">
          Get your <b>seat code</b> from any crewmate's <b>Me → Crew and devices</b> (or your other device), then relink.
        </span>
        <Btn block onClick={() => (location.hash = `#/join/${s.id}`)}>
          Relink with my seat code
        </Btn>
        <Btn block kind="ghost" onClick={() => (location.hash = '#/')}>
          Back to start
        </Btn>
      </div>
    </div>
  );
}

function Loading({ text, back }: { text: string; back?: boolean }) {
  return (
    <div class="screen single" style={{ paddingTop: 80, alignItems: 'center', textAlign: 'center' }}>
      <div class="island-wrap" style={{ width: '100%', opacity: 0.5 }} />
      <p class="muted">{text}</p>
      {back && (
        <Btn kind="ghost" onClick={() => (location.hash = '#/')}>
          Back to start
        </Btn>
      )}
    </div>
  );
}

function Home({ ctl, onPlay, onSeat }: { ctl: Ctl; onPlay(o: Order, cover?: boolean): void; onSeat(): void }) {
  const { s, role, ref, sync } = ctl;
  const r = role!;
  const [zoom, setZoom] = useState(false);
  const now = useNow(30_000);
  const nums = teamNumbers(s);
  const bl = blocks(s);
  const mine = bl.filter((b) => b.from === r);
  const waitingOn = bl.filter((b) => b.to === r);
  const lastSeen = sessions.ref(ref.id)?.lastSeenFeed;
  const fresh = s.feed.filter((f) => lastSeen === undefined || f.id > lastSeen);
  const highlights = [...fresh.filter((f) => f.tone === 'bad'), ...fresh.filter((f) => f.tone === 'good'), ...fresh.filter((f) => f.tone === 'info')].slice(0, 3);
  const lobby = s.week === 0;

  return (
    <div class="screen home">
      <div class="side">
        <div class="topbar">
          <a href="#/" aria-label="All islands" class="btn soft small" style={{ padding: '0 12px' }}>
            <Icon name="island" size={18} />
          </a>
          <div class="col grow" style={{ gap: 0, minWidth: 0 }}>
            <span class="title">{s.name}</span>
            <span class="label">
              {lobby ? 'Week 0 · crew assembling' : `Week ${s.week} · tier ${s.tier} ${tierDef(s.tier).name}`}
              {!sync.online && ' · offline'}
              {sync.queued > 0 && ` · ${sync.queued} queued`}
            </span>
          </div>
          {!lobby && s.deadline && (
            <span class="chip num" title="Week resolves">
              <Icon name="clock" size={14} /> {fmtCountdown(s.deadline - now)}
            </span>
          )}
          <span class={`chip num ${s.cash < 2000 ? 'rust' : ''}`}>{usd(s.cash)}</span>
        </div>

        <div class="island-wrap" style={{ cursor: 'pointer' }}>
          <Island
            s={s}
            focus={zoom ? r : null}
            reduceMotion={settings.get().reduceMotion}
            onTap={() => {
              fx.tap();
              setZoom((z) => !z);
            }}
          />
          <span class="island-hint">
            {s.weather === 'clear' ? '☀' : s.weather === 'wind' ? '〰 wind' : '⛈ storm'} · tap to {zoom ? 'see the island' : 'zoom to your zone'}
          </span>
        </div>

        <div class="team">
          {ROLES.map((x) => {
            const p = s.players[x];
            const st = mateStatus(s, x);
            const dot = { done: C.palm, playing: C.sea, waiting: '#C9A86A', empty: 'rgba(31,42,48,.2)', week0: C.fin }[st];
            const blocking = mine.some((b) => b.to === x) || waitingOn.some((b) => b.from === x);
            return (
              <button
                class="mate"
                key={x}
                style={{ border: 0, textAlign: 'left', boxShadow: x === r ? `inset 0 0 0 2px ${ROLE_TINT[x]}` : undefined }}
                onClick={() => ref.passAndPlay && onSeat()}
                aria-label={`${p?.name ?? 'Open seat'}, ${ROLE_LABEL[x]}, ${st}`}
              >
                <span class="avatar" style={{ ['--tint' as string]: ROLE_TINT[x] }}>
                  {p ? p.name[0].toUpperCase() : '+'}
                  <span class="dot" style={{ background: dot }}>
                    {st === 'done' ? '✓' : ''}
                  </span>
                </span>
                <span class="who">
                  <b>{p?.name ?? 'Open'}</b>
                  <span class="label" style={{ fontSize: 11, color: blocking && x !== r ? C.rust : undefined }}>
                    {blocking && x !== r ? (mine.some((b) => b.to === x) ? 'waiting on you' : 'blocking you') : ROLE_LABEL[x]}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {!lobby && (
          <div class="numbers">
            <div class="stat" style={{ ['--tint' as string]: C.mech }}>
              <div class="v">
                {nums.flights}
                <span class="label">/{nums.flightsMax}</span>
              </div>
              <div class="l">flights available</div>
            </div>
            <div class="stat" style={{ ['--tint' as string]: C.elec }}>
              <div class="v">
                {nums.houses}
                <span class="label">/{nums.housesMax}</span>
              </div>
              <div class="l">houses rentable</div>
            </div>
            <div class="stat" style={{ ['--tint' as string]: C.fin }}>
              <div class="v">{usd(nums.budget)}</div>
              <div class="l">repairs approved</div>
            </div>
          </div>
        )}

        {highlights.length > 0 && !lobby && (
          <div class="card col" style={{ gap: 4, padding: '10px 14px' }}>
            <div class="row spread">
              <span class="label">Since you left</span>
              <button
                class="btn soft small"
                style={{ minHeight: 44, padding: '0 14px', fontSize: 13 }}
                onClick={() => {
                  fx.tap();
                  sessions.patch(ref.id, { lastSeenFeed: s.feed[s.feed.length - 1]?.id ?? 0 });
                }}
              >
                Got it
              </button>
            </div>
            {highlights.map((f) => (
              <div class="feed-item" key={f.id} style={{ fontSize: 14 }}>
                <span class="pip" style={{ background: f.tone === 'bad' ? C.rust : f.tone === 'good' ? C.palm : f.role === 'all' ? C.ink : ROLE_TINT[f.role] }} />
                <span>{f.text}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div class="main">
        {ref.passAndPlay && (
          <button class="card row" style={{ border: 0, textAlign: 'left', ['--tint' as string]: ROLE_TINT[r] }} onClick={onSeat}>
            <span class="avatar" style={{ ['--tint' as string]: ROLE_TINT[r] }}>
              {s.players[r]?.name[0]}
            </span>
            <span class="grow">
              Playing as <b>{s.players[r]?.name}</b>
              {s.players[r]?.name !== ROLE_LABEL[r] ? ` · ${ROLE_LABEL[r]}` : ''}
            </span>
            <span class="chip sea">
              <Icon name="swap" size={14} /> Pass
            </span>
          </button>
        )}

        {lobby ? (
          <Lobby ctl={ctl} onPass={onSeat} />
        ) : (
          <>
            {waitingOn.map((b, i) => (
              <div class="card row" key={`w${i}`} style={{ gap: 10 }}>
                <Icon name="clock" size={20} color={C.inkSoft} />
                <span>
                  Waiting on <b>{s.players[b.from]?.name ?? ROLE_LABEL[b.from]}</b>: {b.text}
                </span>
              </div>
            ))}
            {mine.length > 0 && (
              <div class="card row" style={{ gap: 10, borderLeft: `6px solid ${C.rust}`, alignItems: 'flex-start' }}>
                <Icon name="alert" size={20} color={C.rust} />
                <span class="col" style={{ gap: 2 }}>
                  {mine.map((b, i) => (
                    <span key={i}>
                      You're blocking <b>{s.players[b.to]?.name ?? ROLE_LABEL[b.to]}</b>: {b.text}
                    </span>
                  ))}
                </span>
              </div>
            )}
            {s.story && !s.story.chosen && (
              <div class="card row" style={{ gap: 10, borderLeft: `6px solid ${C.fin}` }}>
                <Icon name="star" size={20} color={C.sea} />
                <span>
                  Story card waiting on the Board: <b>{s.story.title}</b>
                </span>
              </div>
            )}
            <CrewProject ctl={ctl} onPlay={onPlay} />
            {r === 'fin' ? <Desk ctl={ctl} onPlay={onPlay} /> : <OpsPanel ctl={ctl} role={r} onPlay={onPlay} />}
          </>
        )}
      </div>
    </div>
  );
}

/** The next tier is built together: one job per trade, shown to everyone. */
export function CrewProject({ ctl, onPlay }: { ctl: Ctl; onPlay?(o: Order): void }) {
  const { s, role } = ctl;
  const p = s.project;
  if (!p) return null;
  const parts = ROLES.map((r) => ({ r, o: s.orders.find((x) => x.id === p.orders[r]) }));
  const mine = parts.find((x) => x.r === role)?.o;
  return (
    <div class="card col" style={{ gap: 10, borderTop: `6px solid ${C.palm}` }}>
      <span class="chip palm" style={{ alignSelf: 'flex-start' }}>
        Crew project · tier {p.tier} {tierDef(p.tier).name}
      </span>
      <h3>{p.title}</h3>
      {parts.map(({ r, o }) => (
        <div class="row" key={r} style={{ gap: 10 }}>
          <span class="avatar" style={{ ['--tint' as string]: ROLE_TINT[r], width: 28, height: 28, fontSize: 12 }}>
            {(s.players[r]?.name ?? '?')[0]}
          </span>
          <span class="grow" style={{ fontSize: 15 }}>
            {o?.title ?? '—'}
            <div class="label">{s.players[r]?.name ?? ROLE_LABEL[r]}</div>
          </span>
          {o?.status === 'done' ? (
            <b style={{ color: C.palm }}>✓ {Math.round((o.result?.score ?? 0) * 100)}%</b>
          ) : (
            <span class="label">to do</span>
          )}
        </div>
      ))}
      {mine && mine.status === 'ready' && onPlay && !s.turns[role!]?.ended && (
        <Btn block onClick={() => onPlay(mine)}>
          Do your part ▸
        </Btn>
      )}
      <span class="label">
        Tier {p.tier} opens the moment all three are done. Each of you does your own part: autopilot and lend-a-hand can't. New buildings start at 60–90 health, set by
        your average score.
      </span>
    </div>
  );
}

function Lobby({ ctl, onPass }: { ctl: Ctl; onPass(): void }) {
  const { s, ref } = ctl;
  const open = ROLES.filter((r) => !s.players[r]);
  const notDone = ROLES.filter((r) => s.players[r] && !s.players[r]!.week0Done);
  return (
    <div class="card col" style={{ gap: 10 }}>
      <h2>Crew assembling</h2>
      <span class="muted">
        The shared clock starts when all three seats are filled and everyone has played week 0.
        {open.length ? ` Open: ${open.map((r) => ROLE_LABEL[r]).join(', ')}.` : ''}
        {notDone.length ? ` Still in week 0: ${notDone.map((r) => s.players[r]!.name).join(', ')}.` : ''}
      </span>
      {ref.passAndPlay && notDone.length > 0 && (
        <Btn block onClick={onPass}>
          <Icon name="swap" size={18} /> Pass to {s.players[notDone[0]]!.name} for week 0
        </Btn>
      )}
      {!ref.passAndPlay && (
        <>
          <div class="row spread">
            <span class="col" style={{ gap: 0 }}>
              <span class="label">Island code</span>
              <b class="code">{s.id}</b>
            </span>
            <Btn small onClick={() => shareText(s.name, `Join ${s.name} on Island Company. Open seat: ${open.map((r) => ROLE_LABEL[r]).join(' or ') || 'none'}.`, inviteUrl(s.id))}>
              <Icon name="share" size={16} /> Invite
            </Btn>
          </div>
          <span class="label">Friends can join from a phone or a computer. Everything syncs through the server.</span>
        </>
      )}
    </div>
  );
}

function Dock({
  ctl,
  tab,
  setTab,
  single,
  onPlay,
  onSeat,
}: {
  ctl: Ctl;
  tab: Tab;
  setTab(t: Tab): void;
  single: boolean;
  onPlay(o: Order): void;
  onSeat(): void;
}) {
  const { s, role } = ctl;
  const r = role!;
  const [confirm, setConfirm] = useState(false);
  const turn = s.turns[r];
  const readyList = s.orders.filter((o) => o.role === r && o.status === 'ready').sort((a, b) => urgency(s, b) - urgency(s, a));
  const ready = readyList.length;
  const approvals = r === 'fin' ? s.orders.filter((o) => o.status === 'pending' && o.role !== 'fin' && o.lastDeferredWeek !== s.week).length : 0;
  const gridCapped = r === 'mech' && powered(s).gridDown && (turn?.done ?? 0) >= 1;
  // the next useful thing, always under the thumb
  const next: { label: string; go(): void } | null = turn?.ended
    ? null
    : approvals > 0
      ? {
          label: `Review ${approvals} approval${approvals > 1 ? 's' : ''} ▸`,
          go: () => document.getElementById('approvals')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
        }
      : ready > 0 && !gridCapped
        ? { label: `Next: ${readyList[0].title} ▸`, go: () => onPlay(readyList[0]) }
        : null;
  const waiting = ROLES.filter((x) => !s.turns[x]?.ended && x !== r).map((x) => s.players[x]?.name ?? ROLE_LABEL[x]);
  const reviewBadge = (s.story && !s.story.chosen ? 1 : 0) + unreadBoard(s, ctl.ref, r);
  const end = async () => {
    setConfirm(false);
    const ok = await ctl.dispatch({ t: 'endTurn', role: r });
    if (ok) {
      fx.good();
      if (ctl.ref.passAndPlay) toast('Turn ended. Pass the phone.');
    }
  };
  return (
    <>
    <div class={`dock ${single ? 'single' : ''}`}>
      <div class="dock-inner">
        <div class="dock-slot">
          {tab === 'island' && s.week >= 1 && (
            <div class="primary">
              {turn?.ended ? (
                ctl.ref.passAndPlay && waiting.length ? (
                  <Btn block onClick={onSeat}>
                    <Icon name="swap" size={18} /> Pass to {waiting[0]} ▸
                  </Btn>
                ) : (
                  <Btn block kind="soft" disabled>
                    <Icon name="check" size={18} /> Turn ended{waiting.length ? ` · waiting on ${waiting.join(', ')}` : ''}
                  </Btn>
                )
              ) : next ? (
                <div class="row" style={{ gap: 8 }}>
                  <Btn block onClick={next.go} style={{ flex: '1 1 auto', minWidth: 0 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{next.label}</span>
                  </Btn>
                  <Btn kind="ink" onClick={() => (ready > 0 ? setConfirm(true) : void end())} style={{ flex: 'none', padding: '0 16px' }}>
                    End turn
                  </Btn>
                </div>
              ) : (
                <Btn block kind="ink" onClick={() => (ready > 0 ? setConfirm(true) : void end())}>
                  End turn{ready ? ` · ${ready} job${ready > 1 ? 's' : ''} left` : ''}
                </Btn>
              )}
            </div>
          )}
          <nav class="tabs" aria-label="Sections">
            {(
              [
                ['island', 'island', 'Island'],
                ['board', 'board', 'Board'],
                ['me', 'user', 'Me'],
              ] as const
            ).map(([t, icon, label]) => (
              <button
                key={t}
                class={tab === t ? 'on' : ''}
                aria-current={tab === t}
                onClick={() => {
                  fx.tap();
                  setTab(t);
                  window.scrollTo({ top: 0 });
                }}
              >
                <Icon name={icon} size={20} />
                {label}
                {t === 'board' && reviewBadge > 0 && <span class="badge">{reviewBadge}</span>}
              </button>
            ))}
          </nav>
        </div>
      </div>
    </div>
      <Sheet open={confirm} onClose={() => setConfirm(false)} label="End turn">
        <div class="col" style={{ gap: 12 }}>
          <h2>End your turn?</h2>
          <span class="muted">
            {ready} ready job{ready > 1 ? 's' : ''} will carry to next week and pick up deferral risk.
          </span>
          <div class="row" style={{ gap: 8 }}>
            <Btn kind="ghost" block onClick={() => setConfirm(false)}>
              Keep working
            </Btn>
            <Btn kind="ink" block onClick={end}>
              End turn
            </Btn>
          </div>
        </div>
      </Sheet>
    </>
  );
}
