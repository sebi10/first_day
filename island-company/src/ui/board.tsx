// Board tab: last review, next-tier checklist, story cards, history, feed.
// Plus the Review overlay shown once after each resolution.
import { useState } from 'preact/hooks';
import { PUZZLES } from '../puzzles';
import type { PuzzleId } from '../puzzles/types';
import { ROLE_LABEL } from '../sim/data';
import { hashSeed } from '../sim/rng';
import { toolsFor } from '../sim/progression';
import { tierDef } from '../sim/econ';
import { nextTierProgress } from '../sim/progression';
import { ROLES, type Grade, type IslandState, type Role, type WeekReport } from '../sim/types';
import { fx } from './feedback';
import { Btn, Icon, Seg, TierDots, usd } from './kit';
import { PuzzleHost, type PuzzleLaunch } from './puzzlehost';
import { shareWeek } from './share';
import { C, ROLE_TINT } from './theme';
import type { Ctl } from './useIsland';

const GRADE_COLOR: Record<Grade, string> = { A: C.palm, B: C.sea, C: '#C9A86A', D: C.rust };

export function GradeBadge({ g, size = 92 }: { g: Grade; size?: number }) {
  return (
    <div class="grade" style={{ background: GRADE_COLOR[g], width: size, height: size, fontSize: size * 0.6 }} aria-label={`Grade ${g}`}>
      {g}
    </div>
  );
}

export function Board({ ctl, onReview }: { ctl: Ctl; onReview(r: WeekReport): void }) {
  const { s } = ctl;
  const last = s.history[s.history.length - 1];
  const next = nextTierProgress(s);
  return (
    <div class="screen single">
      <div class="topbar">
        <h1 class="grow">Board</h1>
        <span class="chip ink">
          Tier {s.tier} · {tierDef(s.tier).name}
        </span>
      </div>
      {last ? (
        <button class="card row" style={{ border: 0, textAlign: 'left', gap: 14 }} onClick={() => onReview(last)}>
          <GradeBadge g={last.grade} size={72} />
          <span class="col grow" style={{ gap: 2 }}>
            <b>Week {last.week} review</b>
            <span class="label num">
              {usd(last.revenue)} revenue · {last.flightsFlown}/{last.flightsScheduled} flights · {last.incidents.length} incidents
            </span>
            <span class="label">Tap for the full review</span>
          </span>
        </button>
      ) : (
        <div class="card muted">The first board review lands when week 1 resolves.</div>
      )}

      {s.story && !s.story.chosen && <StoryCard ctl={ctl} />}

      {next && (
        <div class="card col" style={{ gap: 8 }}>
          <h3>Next: tier {s.tier + 1} · {next.name}</h3>
          {next.items.map((i) => (
            <div class="row" key={i.label}>
              <span style={{ color: i.ok ? C.palm : C.inkSoft }}>
                <Icon name={i.ok ? 'check' : 'clock'} size={18} />
              </span>
              <span class="num">{i.label}</span>
            </div>
          ))}
          <span class="label">Autopilot weeks don't count: nobody wins alone.</span>
        </div>
      )}
      {!next && (
        <div class="card col" style={{ gap: 4 }}>
          <h3>Endgame</h3>
          <span class="num">
            {s.creditsWeek ? `Beaten in week ${s.creditsWeek}. ` : ''}A-grade streak {Math.min(8, s.stats.aStreak ?? 0)}/8
          </span>
        </div>
      )}

      <Challenge ctl={ctl} />

      {s.history.length > 1 && <History s={s} />}

      <div class="card col" style={{ gap: 8 }}>
        <h3>Island log</h3>
        {[...s.feed]
          .reverse()
          .slice(0, 25)
          .map((f) => (
            <div class="feed-item" key={f.id}>
              <span class="pip" style={{ background: f.tone === 'bad' ? C.rust : f.role === 'all' ? C.ink : ROLE_TINT[f.role] }} />
              <span class="grow">
                {f.text} <span class="label">wk {f.week}</span>
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}

function History({ s }: { s: IslandState }) {
  const h = s.history.slice(-12);
  const W = 320;
  const H = 90;
  const cash = h.map((r) => r.cashEnd);
  const lo = Math.min(0, ...cash);
  const hi = Math.max(...cash, 1);
  const X = (i: number) => (h.length === 1 ? W / 2 : (i / (h.length - 1)) * (W - 20) + 10);
  const Y = (v: number) => H - 10 - ((v - lo) / (hi - lo || 1)) * (H - 24);
  return (
    <div class="card col" style={{ gap: 6 }}>
      <div class="row spread">
        <h3>Last {h.length} weeks</h3>
        <span class="label num">cash {usd(s.cash)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 90 }} aria-label="Cash history">
        {lo < 0 && <line x1={0} x2={W} y1={Y(0)} y2={Y(0)} stroke={C.rust} stroke-dasharray="3 3" opacity=".6" />}
        <path d={cash.map((v, i) => `${i ? 'L' : 'M'}${X(i)} ${Y(v)}`).join(' ')} stroke={C.sea} stroke-width="2.5" fill="none" />
        {cash.map((v, i) => (
          <circle key={i} cx={X(i)} cy={Y(v)} r={3} fill={C.sea} />
        ))}
      </svg>
      <div class="row" style={{ gap: 4, justifyContent: 'space-between' }}>
        {h.map((r) => (
          <span key={r.week} class="col center" style={{ gap: 0, fontSize: 11 }}>
            <b style={{ color: GRADE_COLOR[r.grade] }}>{r.grade}</b>
            <span class="label" style={{ fontSize: 10 }}>
              {r.week}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

function StoryCard({ ctl }: { ctl: Ctl }) {
  const card = ctl.s.story!;
  return (
    <div class="card col" style={{ gap: 10, borderTop: `6px solid ${C.fin}` }}>
      <span class="chip ink" style={{ alignSelf: 'flex-start' }}>
        Story · 3-week streak
      </span>
      <h2>{card.title}</h2>
      <span class="muted">{card.body}</span>
      {card.options.map((o) => (
        <button
          key={o.key}
          class="card"
          style={{ border: 0, textAlign: 'left', background: 'var(--sand)' }}
          onClick={() => {
            fx.snap();
            void ctl.dispatch({ t: 'story', key: o.key });
          }}
        >
          <b>{o.label}</b>
          <div class="label">{o.effect}</div>
        </button>
      ))}
    </div>
  );
}

export function Review({ s, r, onClose }: { s: IslandState; r: WeekReport; onClose(): void }) {
  const comp = [
    { k: 'Revenue', g: r.components.revenue, v: usd(r.revenue), sub: `${Math.round((r.revenue / r.budget) * 100)}% of ${usd(r.budget)} budget`, w: '40%' },
    { k: 'On-time flights', g: r.components.flights, v: `${r.flightsFlown}/${r.flightsScheduled}`, sub: `${Math.round((r.flightsFlown / Math.max(1, r.flightsScheduled)) * 100)}%`, w: '30%' },
    { k: 'Safety', g: r.components.safety, v: `${r.incidents.length}`, sub: `incidents${r.nearMisses ? ` · ${r.nearMisses} near-miss` : ''}`, w: '30%' },
  ];
  const bad = r.lines.filter((l) => l.tone === 'bad');
  const rest = r.lines.filter((l) => l.tone !== 'bad');
  return (
    <div class="overlay" role="dialog" aria-label={`Week ${r.week} review`}>
      <div class="overlay-inner" style={{ overflow: 'auto' }}>
        <div class="screen" style={{ paddingBottom: 40 }}>
          <div class="row spread">
            <span class="label">
              {s.name} · week {r.week} · {r.weather}
            </span>
            <button class="btn soft small" onClick={onClose} aria-label="Close" style={{ padding: '0 12px' }}>
              <Icon name="x" />
            </button>
          </div>
          <div class="row" style={{ gap: 16 }}>
            <GradeBadge g={r.grade} />
            <div class="col" style={{ gap: 2 }}>
              <h1>Board review</h1>
              <span class="muted num">
                Cash {usd(r.cashStart)} → {usd(r.cashEnd)}
              </span>
              {r.tierUp && <span class="chip palm">Tier {r.tierUp} unlocked: {tierDef(r.tierUp).name}!</span>}
              {s.creditsWeek === r.week && <span class="chip palm">You beat Island Company!</span>}
            </div>
          </div>
          <div class="numbers">
            {comp.map((c) => (
              <div class="stat" key={c.k} style={{ ['--tint' as string]: GRADE_COLOR[c.g] }}>
                <div class="l">
                  {c.k} · {c.w}
                </div>
                <div class="v">{c.v}</div>
                <div class="l">
                  <b style={{ color: GRADE_COLOR[c.g] }}>{c.g}</b> · {c.sub}
                </div>
              </div>
            ))}
          </div>
          {s.creditsWeek === r.week && (
            <div class="card col center" style={{ gap: 8, borderTop: `6px solid ${C.palm}` }}>
              <h2>Credits</h2>
              <span class="muted">Eight straight A weeks at the Resort, after {s.stats.totalWeeks} weeks together.</span>
              {ROLES.map((role) => (
                <b key={role}>
                  {s.players[role]?.name} · {ROLE_LABEL[role]}
                </b>
              ))}
              <span class="label">The island keeps running. Chase the next streak.</span>
            </div>
          )}
          <div class="card col" style={{ gap: 6 }}>
            <h3>What moved it</h3>
            {[...bad, ...rest].slice(0, 9).map((l, i) => (
              <div class="feed-item" key={i}>
                <span class="pip" style={{ background: l.tone === 'bad' ? C.rust : l.tone === 'good' ? C.palm : l.role === 'all' ? C.ink : ROLE_TINT[l.role] }} />
                <span>
                  {l.role !== 'all' && <b>{ROLE_LABEL[l.role]}: </b>}
                  {l.text}
                </span>
              </div>
            ))}
            {r.lines.length === 0 && <span class="muted">A clean, quiet week.</span>}
          </div>
          <div class="card col" style={{ gap: 6 }}>
            <h3>MVP lines</h3>
            {ROLES.map((role) => (
              <div class="row" key={role} style={{ alignItems: 'flex-start' }}>
                <span class="avatar" style={{ ['--tint' as string]: ROLE_TINT[role], width: 26, height: 26, fontSize: 12 }}>
                  {(s.players[role]?.name ?? ROLE_LABEL[role])[0]}
                </span>
                <span>
                  <b>{s.players[role]?.name ?? ROLE_LABEL[role]}</b>
                  {r.autoRun.includes(role) && <span class="label"> · covered</span>}
                  <div class="label num">{r.mvp[role]}</div>
                </span>
              </div>
            ))}
          </div>
          <div class="card col" style={{ gap: 4 }}>
            <h3>Costs</h3>
            <span class="label num">
              Fixed {usd(r.costs.fixed)} · insurance {usd(r.costs.insurance)} · leakage {usd(r.costs.leak)} · incidents {usd(r.costs.incidents)} · refunds{' '}
              {usd(r.costs.refunds)}
            </span>
            <span class="label num">Incident roll seed {r.seed} — every outcome is replayable.</span>
          </div>
          <div class="row" style={{ gap: 8 }}>
            <Btn kind="ghost" block onClick={() => shareWeek(s, r)}>
              <Icon name="share" size={18} /> Share
            </Btn>
            <Btn block onClick={onClose}>
              Onward
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Weekly crew challenge: every puzzle, same seed for all three this week. No XP: bragging only. */
function Challenge({ ctl }: { ctl: Ctl }) {
  const { s, role } = ctl;
  const [group, setGroup] = useState<Role>(role ?? 'mech');
  const [tier, setTier] = useState(Math.min(5, Math.max(1, s.tier + 1)));
  const [play, setPlay] = useState<{ launch: PuzzleLaunch; id: PuzzleId } | null>(null);
  if (!role || s.week < 1) return null;
  const scores = s.challenge?.week === s.week ? s.challenge.scores : {};
  const defs = Object.values(PUZZLES).filter((d) => d.role === group);
  const me = s.players[role]!;
  return (
    <div class="card col" style={{ gap: 10 }}>
      <div class="row spread">
        <h3>Weekly challenge</h3>
        <span class="label">same seed for all three · no XP</span>
      </div>
      <span class="label">Try any job, even the other roles'. Teach each other.</span>
      <Seg<Role> value={group} onChange={setGroup} options={ROLES.map((r) => ({ v: r, label: ROLE_LABEL[r] }))} />
      <div class="row spread">
        <span class="label">Difficulty</span>
        <span class="row" style={{ gap: 6 }}>
          {[1, 2, 3, 4, 5].map((t) => (
            <button
              key={t}
              class={`chip ${t === tier ? 'ink' : ''}`}
              style={{ border: 0, minWidth: 36, minHeight: 32, justifyContent: 'center' }}
              onClick={() => setTier(t)}
              aria-pressed={t === tier}
            >
              T{t}
            </button>
          ))}
        </span>
      </div>
      {defs.map((d) => {
        const row = scores[`${d.id}:${tier}`] ?? {};
        const best = me.best?.[d.id];
        return (
          <div class="row" key={d.id} style={{ gap: 10 }}>
            <span class="col grow" style={{ gap: 2 }}>
              <b style={{ fontSize: 15 }}>{d.title}</b>
              <span class="row wrap" style={{ gap: 8 }}>
                {ROLES.map((r) => (
                  <span key={r} class="label num" style={{ color: row[r] !== undefined ? C.ink : undefined }}>
                    <i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: ROLE_TINT[r], marginRight: 4 }} />
                    {row[r] !== undefined ? Math.round(row[r]! * 100) : '—'}
                  </span>
                ))}
                {best !== undefined && <span class="label">· your best {Math.round(best * 100)}</span>}
              </span>
            </span>
            <Btn
              small
              kind="soft"
              onClick={() =>
                setPlay({
                  id: d.id,
                  launch: {
                    puzzle: d.id,
                    seed: hashSeed(s.seed, 'challenge', s.week, d.id, tier),
                    tier,
                    tools: d.role === role ? toolsFor(role, me.xp) : [],
                    title: `Challenge · ${d.title}`,
                    subtitle: `week ${s.week}`,
                  },
                })
              }
            >
              Play
            </Btn>
          </div>
        );
      })}
      <span class="label">
        <TierDots tier={tier} /> Scores reset each week. Your own jobs count toward personal bests too.
      </span>
      {play && (
        <PuzzleHost
          launch={play.launch}
          onResult={(r) => void ctl.dispatch({ t: 'practice', role, puzzle: play.id, tier, score: r.score })}
          onClose={() => setPlay(null)}
        />
      )}
    </div>
  );
}
