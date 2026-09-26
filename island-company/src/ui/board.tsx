// Board tab: last review, next-tier checklist, story cards, history, feed.
// Plus the Review overlay shown once after each resolution.
import { ROLE_LABEL } from '../sim/data';
import { tierDef } from '../sim/econ';
import { nextTierProgress } from '../sim/progression';
import { ROLES, type Grade, type IslandState, type WeekReport } from '../sim/types';
import { fx } from './feedback';
import { Btn, Icon, usd } from './kit';
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
      {!next && <div class="card">Resort tier reached. Endgame: hold an A for 8 weeks straight.</div>}

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
