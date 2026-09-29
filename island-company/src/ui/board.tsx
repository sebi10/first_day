// Board tab: last review, next-tier checklist, story cards, history, feed.
// Plus the Review overlay shown once after each resolution.
import { useState } from 'preact/hooks';
import { PUZZLES } from '../puzzles';
import type { PuzzleId } from '../puzzles/types';
import { ROLE_LABEL } from '../sim/data';
import { hashSeed } from '../sim/rng';
import { toolsFor } from '../sim/progression';
import { carriedStreak, creditsStreak, onV4, pausedWeek, storyEffect, tierDef } from '../sim/econ';
import { nextTierProgress } from '../sim/progression';
import { ROLES, type Grade, type Incident, type IslandState, type ReportLine, type Role, type WeekReport } from '../sim/types';
import { fx } from './feedback';
import { Btn, Icon, Seg, TierDots, usd } from './kit';
import { CrewBoard } from './crewboard';
import { CrewProject } from './home';
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
      <CrewBoard ctl={ctl} />
      <CrewProject ctl={ctl} />

      {next && (
        <div class="card col" style={{ gap: 8 }}>
          <h3>Next: tier {s.tier + 1} · {next.name}</h3>
          {next.items.map((i) => (
            <div class="row" key={i.label}>
              <span style={{ color: i.ok ? C.palm : C.inkSoft }}>
                <Icon name={i.info ? 'hardhat' : i.ok ? 'check' : 'clock'} size={18} />
              </span>
              <span class="num">
                {i.label}
                {/* the builders' site work sets how the tier's new buildings start, never when it comes */}
                {i.info && <span class="label"> · {i.ok ? 'done: the new buildings start in good shape' : 'if the tier comes first, its new buildings start up to 15 lower'}</span>}
              </span>
            </div>
          ))}
          <span class="label">Autopilot weeks don't count. When you qualify, the tier is built as a crew project: one job each.</span>
          {/* the release gate: a live island's streak from before the update is kept (it counted Harbor weeks) */}
          {carriedStreak(s) && (
            <span class="label">
              Your A-grade streak from before this update counts: {Math.min(8, creditsStreak(s, s.week))}/8. An A week holds it until the Resort, where each full-crew A adds one; a week below A ends it, and from then on only Resort weeks count.
            </span>
          )}
        </div>
      )}
      {!next && (
        <div class="card col" style={{ gap: 4 }}>
          <h3>Endgame</h3>
          <span class="num">
            {s.creditsWeek ? `Beaten in week ${s.creditsWeek}. ` : ''}A-grade streak {Math.min(8, creditsStreak(s, s.week))}/8
          </span>
          {/* review round 1: the rule, so a row of A's next to a lower count reads right */}
          <span class="label">Full-crew A weeks at the Resort count toward the eight. An A with a seat on autopilot holds the streak; a week below A resets it.</span>
          {/* the release gate: a live island's streak from before the update is kept (it counted Harbor weeks) */}
          {carriedStreak(s) && <span class="label">Your streak from before this update counts: {Math.min(8, creditsStreak(s, s.week))}/8. Once it ends, only Resort weeks count.</span>}
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
          <span key={r.week} class="col center" style={{ gap: 0, fontSize: 11 }} title={pausedWeek(s, r) ? `Week ${r.week}: A with autopilot covering a seat, so it held the streak` : undefined}>
            {/* an A with a seat on autopilot at the Resort held the credits' streak: a ringed A (review round 1) */}
            <b style={{ color: GRADE_COLOR[r.grade], ...(pausedWeek(s, r) ? { boxShadow: `inset 0 0 0 1.5px ${GRADE_COLOR.A}`, borderRadius: 4, padding: '0 3px', color: C.inkSoft } : {}) }}>{r.grade}</b>
            <span class="label" style={{ fontSize: 10 }}>
              {r.week}
            </span>
          </span>
        ))}
      </div>
      {h.some((r) => pausedWeek(s, r)) && <span class="label">A ringed: a seat was on autopilot, so the week held the streak instead of counting.</span>}
    </div>
  );
}

function StoryCard({ ctl }: { ctl: Ctl }) {
  const card = ctl.s.story!;
  const role = ctl.role;
  const votes = card.votes ?? {};
  return (
    <div class="card col" style={{ gap: 10, borderTop: `6px solid ${C.fin}` }}>
      <span class="chip ink" style={{ alignSelf: 'flex-start' }}>
        Story · crew vote, two of three decide
      </span>
      <h2>{card.title}</h2>
      <span class="muted">{card.body}</span>
      {card.options.map((o) => {
        const voters = ROLES.filter((r) => votes[r] === o.key);
        const mine = role && votes[role] === o.key;
        return (
          <button
            key={o.key}
            class="card"
            style={{ border: 0, textAlign: 'left', background: 'var(--sand)', boxShadow: mine ? `inset 0 0 0 3px ${C.sea}` : undefined }}
            onClick={() => {
              if (!role) return;
              fx.snap();
              void ctl.dispatch({ t: 'story', key: o.key, role });
            }}
          >
            <div class="row spread">
              <b>{o.label}</b>
              <span class="row" style={{ gap: 4 }}>
                {voters.map((r) => (
                  <span key={r} class="avatar" style={{ ['--tint' as string]: ROLE_TINT[r], width: 22, height: 22, fontSize: 11 }}>
                    {(ctl.s.players[r]?.name ?? '?')[0]}
                  </span>
                ))}
              </span>
            </div>
            <div class="label">{storyEffect(ctl.s, card.id, o)}</div>
          </button>
        );
      })}
      <span class="label">Undecided for two weeks? The safe option wins.</span>
    </div>
  );
}

export function Review({ s, r, onClose }: { s: IslandState; r: WeekReport; onClose(): void }) {
  const comp = [
    { k: 'Revenue', g: r.components.revenue, v: usd(r.revenue), sub: `${Math.round((r.revenue / r.budget) * 100)}% of ${usd(r.budget)} budget`, w: '40%' },
    { k: 'On-time flights', g: r.components.flights, v: `${r.flightsFlown}/${r.flightsScheduled}`, sub: `${Math.round((r.flightsFlown / Math.max(1, r.flightsScheduled)) * 100)}%`, w: '30%' },
    { k: 'Safety', g: r.components.safety, v: `${r.incidents.length}`, sub: `incidents${r.nearMisses ? ` · ${r.nearMisses} near-miss` : ''}`, w: '30%' },
  ];
  // blind sign-offs coming back: failures traced to the job, and what inspections caught first
  const defects = r.incidents.filter((i) => i.kind === 'defect');
  const traced = new Map<Incident, ReportLine | undefined>(defects.map((i) => [i, r.lines.find((l) => l.text.startsWith(`${i.title}. Traced to `))]));
  const caught = r.lines.filter((l) => l.tone === 'good' && l.text.endsWith('caught before it failed.'));
  // the credits' streak held by an autopilot A at the Resort: said up top, not lost past the list's nine lines (review round 1)
  const streak = r.lines.find((l) => l.role === 'all' && /toward the eight/.test(l.text));
  // what the electrician's helper put in (or didn't) at the resolve: pinned too, never cut by the nine (the release gate)
  const helper = r.lines.filter((l) => l.role === 'elec' && /\(electrician's helpers?\)/.test(l.text));
  // the receiver's week in plain numbers: said up top too, never cut by the nine (the release gate)
  const recv = r.lines.find((l) => l.role === 'all' && l.text.startsWith('Receivership, cash '));
  const shown = new Set<ReportLine>([...traced.values(), ...caught, ...(streak ? [streak] : []), ...(recv ? [recv] : []), ...helper].filter((l): l is ReportLine => !!l));
  const bad = r.lines.filter((l) => l.tone === 'bad' && !shown.has(l));
  const rest = r.lines.filter((l) => l.tone !== 'bad' && !shown.has(l));
  return (
    <div class="overlay" role="dialog" aria-label={`Week ${r.week} review`}>
      <div class="overlay-inner" style={{ overflow: 'auto' }}>
        <div class="screen" style={{ paddingBottom: 40 }}>
          <div class="row spread">
            <span class="label">
              {s.name} · week {r.week} · {r.weather}
            </span>
            <button class="btn soft small" onClick={onClose} aria-label="Close" data-esc style={{ padding: '0 12px' }}>
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
              {streak && <span class="label">{streak.text}</span>}
              {recv && (
                <span class="label" style={{ color: C.rust }}>
                  {recv.text}
                </span>
              )}
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
              {/* (a week an older engine resolved keeps its own words: that rule counted Harbor weeks; the release gate) */}
              <span class="muted">
                {onV4(s, r.week) ? 'Eight full-crew A weeks at the Resort, none below A' : 'Eight straight A weeks at the Resort'}, after {s.stats.totalWeeks} weeks together.
              </span>
              {ROLES.map((role) => (
                <b key={role}>
                  {s.players[role]?.name} · {ROLE_LABEL[role]}
                </b>
              ))}
              <span class="label">The island keeps running. Chase the next streak.</span>
            </div>
          )}
          {(defects.length > 0 || caught.length > 0) && (
            <div class="card col" style={{ gap: 12, borderTop: `6px solid ${defects.length ? C.rust : C.palm}` }}>
              <div class="col" style={{ gap: 2 }}>
                <h3>Earlier sign-offs</h3>
                <span class="label">No verdict on the day: this is where signed-off work shows up.</span>
              </div>
              {defects.map((i, k) => {
                const f = i.from;
                const to = f?.traced ? `${f.traced}.` : f ? `“${f.title}”, signed off by ${f.name} in week ${f.week}.` : '';
                const next = afterIncident(s, i);
                return (
                  <div class="col" key={`d${k}`} style={{ gap: 4 }}>
                    <span class="row wrap" style={{ gap: 6 }}>
                      <span class="chip rust">Incident</span>
                      <span class="label">
                        {ROLE_LABEL[i.role]} · −{usd(i.cost)} before insurance
                      </span>
                    </span>
                    <b style={{ lineHeight: 1.3 }}>{i.title}</b>
                    {to && (
                      <span style={{ lineHeight: 1.35 }}>
                        <span class="label">Traced to </span>
                        {to}
                      </span>
                    )}
                    {next && <span class="label">{next}</span>}
                  </div>
                );
              })}
              {caught.map((l, k) => (
                <div class="col" key={`c${k}`} style={{ gap: 4 }}>
                  <span class="row wrap" style={{ gap: 6 }}>
                    <span class="chip palm">Caught</span>
                    {l.role !== 'all' && <span class="label">{ROLE_LABEL[l.role]}</span>}
                  </span>
                  <span style={{ lineHeight: 1.35 }}>{l.text}</span>
                </div>
              ))}
            </div>
          )}
          {helper.length > 0 && (
            <div class="card col" style={{ gap: 6 }}>
              <h3>The electrician's helper</h3>
              <span class="label">Put in to {s.players.elec?.name ?? 'the electrician'}'s plans, under their licence.</span>
              {helper.map((l, i) => (
                <div class="feed-item" key={i}>
                  <span class="pip" style={{ background: l.tone === 'bad' ? C.rust : l.tone === 'good' ? C.palm : ROLE_TINT.elec }} />
                  <span>{l.text}</span>
                </div>
              ))}
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
            {r.lines.length > 0 && bad.length + rest.length === 0 && <span class="muted">Nothing else of note.</span>}
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
            <div class="row wrap" style={{ gap: '2px 14px' }}>
              {costLines(r).map(([k, v]) => (
                <span key={k} class="label num" style={{ whiteSpace: 'nowrap' }}>
                  {k} <b style={{ color: C.ink }}>{usd(v)}</b>
                </span>
              ))}
            </div>
            {/* money in, not a cost: the receiver's advances and a bridge loan (the release gate: the week's walk shows them) */}
            {!!r.costs.financing && <span class="label num">Financing in +{usd(r.costs.financing)}: the receiver, onto the bridge loan.</span>}
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

/**
 * The week's costs, as the review lists them: the fixed cost split into overhead and
 * payroll where the week recorded them, then what the job flow paid (labour on
 * approved cards, the POs paid at the payment run and their freight, the carrying
 * charge on stock), then insurance, leakage, incidents, refunds and the rest (the mainland
 * sub-charter that flew the guests while the only guest plane was grounded, last). A cost
 * that was nothing that week isn't listed; the fixed cost always is.
 */
export function costLines(r: WeekReport): [string, number][] {
  const c = r.costs;
  const fixed: [string, number][] = c.overhead !== undefined || c.payroll !== undefined ? [['Overhead', c.overhead ?? 0], ['Payroll', c.payroll ?? 0]] : [['Fixed', c.fixed]];
  const rest: [string, number | undefined][] = [
    ['Labour', c.labor],
    ['Parts and stock', c.parts],
    ['Freight', c.freight],
    ['Carrying', c.carry],
    ['Insurance', c.insurance],
    ['Leakage', c.leak],
    ['Incidents', c.incidents],
    ['Refunds', c.refunds],
    ['Loan', c.loan],
    ['Open reports', c.reports],
    ['GPU charging', c.power],
    ['Mainland sub-charter', c.subCharter],
  ];
  return [...fixed, ...rest.filter((x): x is [string, number] => !!x[1])];
}

/** What happens next after a defect incident: the repair (waiting on the analyst, or auto-approved), then the redo if there is one. */
function afterIncident(s: IslandState, i: Incident) {
  const f = i.from;
  if (!f) return '';
  const rep = f.repairId ? s.orders.find((o) => o.id === f.repairId) : undefined;
  const then = f.redo ? ', then the original job gets redone (already paid)' : '';
  if (!rep) return `A repair was written up${then}.`;
  const who = s.players[rep.role]?.name ?? ROLE_LABEL[rep.role];
  if (rep.status === 'done') return `${who} has done the repair${f.redo ? '; the original job gets redone next' : ''}.`;
  if (rep.status === 'pending' || rep.status === 'countered') return `Repair “${rep.title}” is waiting on the analyst${then}.`;
  return `Repair “${rep.title}” ${rep.autoApproved ? 'was auto-approved from the trade budget' : 'is approved'} and is ${who}'s${then}.`;
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
              style={{ border: 0, minWidth: 44, minHeight: 44, justifyContent: 'center' }}
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
                    seat: role,
                    expert: d.role !== role,
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
        <TierDots tier={tier} /> Scores reset each week. Your own jobs count toward personal bests too, except blind sign-offs.
      </span>
      {play && (
        <PuzzleHost
          launch={play.launch}
          onResult={(r) => void ctl.dispatch({ t: 'practice', role, puzzle: play.id, tier, score: r.score })}
          onClose={() => setPlay(null)}
          onCancel={() => setPlay(null)}
        />
      )}
    </div>
  );
}
