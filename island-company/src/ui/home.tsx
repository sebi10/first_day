// The island screen: header, island view, crew, numbers, role panel, dock.
// Mobile: one column, thumb-zone dock. Desktop: island left, work right.
import { Fragment } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { sessions, type IslandRef } from '../net/session';
import type { PuzzleResult } from '../puzzles/types';
import { ROLE_LABEL } from '../sim/data';
import { gseCarts, gseForStart, hangarJobs, needsCart, onSchedule, powered, projectCoverWeek, startCart, tierDef, urgency } from '../sim/econ';
import { ROLES, type IslandState, type OpsRole, type Order, type Role, type WeekReport } from '../sim/types';
import { fmtCountdown } from '../sim/time';
import { Board, Review } from './board';
import { ChainBanner } from './chain';
import { GseSheet, weakBatteryNow } from './gse';
import { fx } from './feedback';
import { Btn, Icon, Sheet, toast, useNow, usd } from './kit';
import { unreadBoard } from './crewboard';
import { Island } from './island';
import { siteBox } from './island/geo';
import { Me, inviteUrl } from './me';
import { OpsPanel } from './ops';
import { PuzzleHost, type PuzzleLaunch } from './puzzlehost';
import { blocks, capNow, dockNext, endTurnChecks, launchFor, mateStatus, openTarget, owedBy, standingLimit, teamNumbers } from './select';
import { settings } from './settings';
import { shareText } from './share';
import { C, ROLE_TINT } from './theme';
import { useIsland, type Ctl } from './useIsland';
import { YourMove } from './flow/YourMove';
import { lazy } from './lazy';
import { BuildStatus } from './staff/BuildStatus';

// each seat's own screens are chunks of their own (lazy.tsx): the analyst's desk, and week 0 (played once)
const Desk = lazy(() => import('./desk').then((m) => m.Desk), () => <div class="card" style={{ minHeight: 240 }} aria-busy="true" />);
const Week0 = lazy(() => import('./week0').then((m) => m.Week0), () => <Loading text="Loading week 0…" />);

type Tab = 'island' | 'board' | 'me';

export function IslandScreen({ islandRef }: { islandRef: IslandRef }) {
  const { s, uid, role, sync, dispatch } = useIsland(islandRef);
  const [tab, setTab] = useState<Tab>('island');
  const [play, setPlay] = useState<{ launch: PuzzleLaunch; order: Order; cover: boolean; week: number } | null>(null);
  const [review, setReview] = useState<WeekReport | null>(null);
  const [handoff, setHandoff] = useState<Role | null>(null);
  // the ground power sheet: closed (undefined), all carts (null), or one cart first
  const [gse, setGse] = useState<string | null | undefined>(undefined);
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
    // a ground power start needs a charged cart hooked up first: say so and show the carts, never a puzzle that can't count
    const g = gseForStart(s, o);
    if (g.blocker) {
      fx.bad();
      toast(`${g.blocker}.`);
      // on the cart that's there, else the one to tow over (it may be on a plane that's down for a part)
      setGse(g.cart?.id ?? startCart(s, o.assetId)?.id ?? null);
      return;
    }
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
      {tab === 'island' && <Home ctl={ctl} onPlay={onPlay} onSeat={() => setHandoff(role)} onGse={setGse} />}
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
      <Sheet open={gse !== undefined} onClose={() => setGse(undefined)} label="Ground power">
        {gse !== undefined && <GseSheet ctl={ctl} focus={gse} onClose={() => setGse(undefined)} />}
      </Sheet>
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

function Home({ ctl, onPlay, onSeat, onGse }: { ctl: Ctl; onPlay(o: Order, cover?: boolean): void; onSeat(): void; onGse(cart: string | null): void }) {
  const { s, role, ref, sync } = ctl;
  const r = role!;
  // the island's zoom: the seat's own zone, the builders' site (docs/JOBFLOW.md 15.5), or the whole island
  const [view, setView] = useState<'zone' | 'site' | null>(null);
  const site = siteBox(s);
  const zoom = view === 'site' && !site ? null : view;
  const wrap = useRef<HTMLDivElement>(null);
  const seeSite = () => {
    fx.tap();
    setView('site');
    // on a phone the island is up the page: bring it into view
    wrap.current?.scrollIntoView?.({ behavior: settings.get().reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
  };
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

        <div class="island-wrap" style={{ cursor: 'pointer' }} ref={wrap}>
          <Island
            s={s}
            focus={zoom === 'zone' ? r : zoom}
            reduceMotion={settings.get().reduceMotion}
            onTap={() => {
              fx.tap();
              setView(zoom ? null : 'zone');
            }}
            onCart={(id) => {
              fx.tap();
              onGse(id);
            }}
            onBuilders={site && zoom !== 'site' ? seeSite : undefined}
          />
          {zoom === 'site' ? (
            <button
              class="island-back"
              onClick={() => {
                fx.tap();
                setView(null);
              }}
            >
              <Icon name="island" size={16} /> See the island
            </button>
          ) : (
            <span class="island-hint">
              {s.weather === 'clear' ? '☀' : s.weather === 'wind' ? '〰 wind' : '⛈ storm'} · tap to {zoom ? 'see the island' : 'zoom to your zone'}
              {/* a builder figure is a tap target of its own (fix round 1: a tap near one opened the site unannounced) */}
              {site && !zoom ? ' · a builder: the site' : ''}
            </span>
          )}
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
                  {/* a crewmate who hasn't played yet isn't blocking anyone: neutral until their turn is over */}
                  <span class="label" style={{ fontSize: 11, color: blocking && x !== r && (mine.some((b) => b.to === x) || s.turns[x]?.ended) ? C.rust : undefined }}>
                    {blocking && x !== r ? (mine.some((b) => b.to === x) ? 'waiting on you' : s.turns[x]?.ended ? 'blocking you' : `you wait on ${p?.name ?? ROLE_LABEL[x]}`) : ROLE_LABEL[x]}
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
              <div class="l">{nums.subFlights ? `flights · +${nums.subFlights} sub-charter` : 'flights available'}</div>
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
            {/* the job flow's Your move comes first for the techs (B draws it; docs/JOBFLOW.md 17.2) */}
            {r !== 'fin' && (
              <div id="your-move">
                <YourMove ctl={ctl} role={r as OpsRole} />
              </div>
            )}
            {/* the part chain's move is on its own banner below (with the stepper); the crew strip counts it with the rest */}
            {waitingOn.filter((b) => b.kind !== 'chain').map((b, i) => (
              <div class="card row" key={`w${i}`} style={{ gap: 10 }}>
                <Icon name="clock" size={20} color={C.inkSoft} />
                <span>
                  Waiting on <b>{s.players[b.from]?.name ?? ROLE_LABEL[b.from]}</b>: {b.text}
                </span>
              </div>
            ))}
            {mine.some((b) => b.kind !== 'chain') && (
              <div class="card row" style={{ gap: 10, borderLeft: `6px solid ${C.rust}`, alignItems: 'flex-start' }}>
                <Icon name="alert" size={20} color={C.rust} />
                <span class="col" style={{ gap: 2 }}>
                  {mine.filter((b) => b.kind !== 'chain').map((b, i) => (
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
            <ChainBanner s={s} role={r} />
            <CrewProject ctl={ctl} onPlay={onPlay} />
            {/* the builders' site work, the whole game (D draws it; docs/JOBFLOW.md 15.5) */}
            <BuildStatus ctl={ctl} onSee={site ? seeSite : undefined} />
            {r === 'fin' ? <Desk ctl={ctl} onPlay={onPlay} /> : <OpsPanel ctl={ctl} role={r} onPlay={onPlay} onGse={onGse} />}
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
  // the same per-turn limits as any other job: grid down (hangar), or a crewmate's unfixed report
  const held = !!role && ((role === 'mech' && powered(s).gridDown && (s.turns.mech?.done ?? 0) >= 1) || !!capNow(s, role)?.full);
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
            o.result?.blind ? (
              <b style={{ color: C.inkSoft, fontSize: 14, whiteSpace: 'nowrap' }}>✓ Signed off</b>
            ) : (
              <b style={{ color: C.palm }}>✓ {Math.round((o.result?.score ?? 0) * 100)}%</b>
            )
          ) : (
            <span class="label" style={{ textAlign: 'right' }}>
              to do
              {/* the resolve autopilot does it at 50% if that seat is away every week till then (a seat played in the last month) */}
              {projectCoverWeek(s, r) !== null && r !== role && <div>{coverWords(s, r)}</div>}
              {o?.rebid === s.week && <div>outbid this week</div>}
            </span>
          )}
        </div>
      ))}
      {mine && mine.status === 'ready' && onPlay && !s.turns[role!]?.ended && !held && mine.rebid !== s.week && (
        <Btn block onClick={() => onPlay(mine)}>
          Do your part ▸
        </Btn>
      )}
      {mine && mine.status === 'ready' && mine.rebid === s.week && (
        <span class="label fault">Outbid this week: nothing was bought, and the next floatplane comes up at next week’s auction.</span>
      )}
      {mine && mine.status === 'ready' && onPlay && !s.turns[role!]?.ended && held && (
        <span class="label fault">You've hit this turn's job limit: your part waits for next turn.</span>
      )}
      <span class="label">
        Tier {p.tier} opens the moment all three are done. Each of you does your own part (lend-a-hand can't). If someone is away two weeks running, their
        part is done by autopilot at 50% at the second week's resolve, so nobody waits for good, but it lowers the new buildings. They start at 60–90 health,
        set by your average score.
        {mine && mine.status === 'ready' && projectCoverWeek(s, role!) !== null &&
          (projectCoverWeek(s, role!)! <= s.week
            ? ` Yours: you were away last week, so if this week's turn isn't ended, autopilot does it at 50% at this resolve (it lowers the new buildings).`
            : ` Yours: if you're away every week till then, autopilot does it at 50% at week ${projectCoverWeek(s, role!)}'s resolve (it lowers the new buildings).`)}
      </span>
    </div>
  );
}

/** "autopilot at this resolve if away" / "autopilot wk 9 if away": when a crewmate's part is covered if they're away till then */
function coverWords(s: IslandState, r: Role): string {
  const w = projectCoverWeek(s, r);
  return w === null ? '' : w <= s.week ? 'autopilot this resolve if away' : `autopilot wk ${w} if away till then`;
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
  // a ground power start waiting on a cart isn't something to start yet
  // (nor is the floatplane auction lost this week: the next sale is next week's)
  const readyList = s.orders.filter((o) => o.role === r && o.status === 'ready' && !gseForStart(s, o).blocker && o.rebid !== s.week).sort((a, b) => urgency(s, b) - urgency(s, a));
  const ready = readyList.length;
  // legacy cards (no job flow) keep today's count; the flow's cards and requisitions come from dockNext
  const approvals = r === 'fin' ? s.orders.filter((o) => o.status === 'pending' && o.role !== 'fin' && o.lastDeferredWeek !== s.week && !o.flow).length : 0;
  // the job flow's next move (docs/JOBFLOW.md 16): the first Your move row, or the analyst's cards and requisitions
  const flowNext = dockNext(s, r);
  const checks = turn?.ended ? [] : endTurnChecks(s, r);
  const gridCapped = (r === 'mech' && powered(s).gridDown && !!turn && hangarJobs(turn) >= 1) || !!capNow(s, r)?.full;
  // jobs this seat could still start this turn (none once a per-turn limit is used up)
  const playable = gridCapped ? 0 : ready;
  // a crewmate waiting on this seat (a report to fix, the part chain's next step): ending the turn says so first
  const owed = owedBy(s, r);
  // the mechanic's carts: this week's weak-battery plane needs a charged one on it; any other one left on a plane
  // sits off the charger (it runs down) until someone plugs it back in
  const weak = r === 'mech' ? weakBatteryNow(s) : null;
  const weakUnready = !!weak && !weak.ready;
  const leftOn = r === 'mech' ? gseCarts(s).filter((c) => c.hookedTo && c.hookedTo !== s.weakBattery?.assetId && !s.orders.some((o) => o.status === 'ready' && needsCart(o.kind) && o.assetId === c.hookedTo)) : [];
  const ask = playable > 0 || owed.length > 0 || weakUnready || leftOn.length > 0 || checks.length > 0;
  // a report or a chain step carried over never rolls an incident: only the other jobs pick up deferral risk (the
  // week's load sheet and ground power start are named by what skipping them costs, not counted here)
  // (a flow job planned ahead of its alert's due week is on schedule: it picks up no deferral risk until it's due)
  // (nor does a crew project part: it waits for the crew, then for autopilot)
  const risky = readyList.filter((o) => o.kind !== 'report' && o.kind !== 'project' && !o.chain && o.kind !== 'wb' && o.kind !== 'gpustart' && !onSchedule(s, o, s.week)).length;
  const early = readyList.filter((o) => o.kind !== 'wb' && o.kind !== 'gpustart' && onSchedule(s, o, s.week)).length;
  const carried = readyList.filter((o) => o.kind !== 'wb' && o.kind !== 'gpustart').length;
  // the analyst's one-tap raise when the techs haven't played yet (the engine takes 0-5,000)
  const raised = Math.min(5000, standingLimit(s) + 1000);
  // the next useful thing, always under the thumb
  const next: { label: string; go(): void } | null = turn?.ended
    ? null
    : flowNext
      ? {
          label: flowNext.label,
          go: () => {
            const t = flowNext.target;
            if ('order' in t) {
              const o = s.orders.find((x) => x.id === t.order);
              // a job-flow job starts through the ops panel's host: the install check first (a stop shows its sheet,
              // never the puzzle), then the per-turn limits and the carts, as Your move's Start does
              if (o?.flow) return openTarget(t);
              if (o && !gridCapped) return onPlay(o);
            }
            openTarget(t);
            const at = 'desk' in t ? 'approvals' : 'your-move';
            document.getElementById(at)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          },
        }
      : approvals > 0
      ? {
          label: `${approvals} to approve ▸`,
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
                  <Btn kind="ink" onClick={() => (ask ? setConfirm(true) : void end())} style={{ flex: 'none', padding: '0 16px' }}>
                    End turn
                  </Btn>
                </div>
              ) : (
                <Btn block kind="ink" onClick={() => (ask ? setConfirm(true) : void end())}>
                  End turn{playable ? ` · ${playable} job${playable > 1 ? 's' : ''} left` : ready ? ' · limit reached' : ''}
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
          {checks.map((c, i) => (
            <Fragment key={`c${i}`}>
              <span class={c.urgent ? 'fault' : 'muted'} style={c.urgent ? { fontWeight: 700 } : undefined}>
                {c.text}
              </span>
              {c.melAsk && (
                <Btn
                  kind="soft"
                  onClick={() =>
                    void ctl.dispatch({ t: 'melExtend', role: 'mech', alert: c.melAsk! }).then((ok) => ok && toast(`Asked ${s.players.fin?.name ?? 'the analyst'} to authorize the one-time MEL extension.`))
                  }
                >
                  <Icon name="placard" size={18} /> Ask {s.players.fin?.name ?? 'the analyst'} to authorize the one-time extension
                </Btn>
              )}
            </Fragment>
          ))}
          {checks.some((c) => c.standing) && standingLimit(s) < 5000 && (
            <Btn
              kind="soft"
              onClick={() =>
                void ctl.dispatch({ t: 'setStanding', amount: raised }).then((ok) => ok && toast(`Standing limit raised to $${raised.toLocaleString('en-US')} (the desk's Money tab sets it back).`))
              }
            >
              Raise the standing limit to ${raised.toLocaleString('en-US')}
            </Btn>
          )}
          {owed.filter((m) => m.kind !== 'flow').map((m) => (
            <span key={m.key} class="fault" style={{ fontWeight: 700 }}>
              {s.players[m.waits]?.name ?? ROLE_LABEL[m.waits]} is waiting on you: {m.text}.
            </span>
          ))}
          {weakUnready && (
            <span class="fault" style={{ fontWeight: 700 }}>
              {weak!.name}'s battery is weak this week and no charged cart is hooked up to it: its first flight will be lost.
            </span>
          )}
          {leftOn.map((c) => (
            <span key={c.id} class="muted">
              {c.name} is still on {s.assets.find((a) => a.id === c.hookedTo)?.name ?? 'a plane'} ({Math.round(c.charge)}%), off the charger: plug it back in.
            </span>
          ))}
          {carried > 0 && (
            <span class="muted">
              {carried} ready job{carried > 1 ? 's' : ''} will carry to next week
              {risky && risky < carried
                ? `: ${risky} of them pick${risky > 1 ? '' : 's'} up deferral risk`
                : risky
                  ? ' and pick up deferral risk'
                  : early
                    ? ': none picks up deferral risk before its due week'
                    : ''}
              .
            </span>
          )}
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
