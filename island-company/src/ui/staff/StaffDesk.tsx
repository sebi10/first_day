// The analyst's Staff desk (docs/JOBFLOW.md 15.11): the island's payroll, the
// crew (with Let go), this week's hiring board (each candidate says what they'd
// do for this island, in its own numbers and then in money) and the builders'
// site work (Buy the next unit, Start a cottage). Hire: Staff (1) → Hire (2) →
// confirm (3). Staff moves are the analyst's and aren't locked by End turn.
import { useState } from 'preact/hooks';
import { fixedNow, projectWeek, tierDef } from '../../sim/econ';
import { runway, spendable } from '../../sim/ledger';
import { buildSite, commissioning, cottagePlan, COTTAGE_SHELL, crewOf, helperOn, NPC_ROLES, openBuild, payroll, severanceOf, STAFF, staffEffect, standardCount, working } from '../../sim/staff';
import type { Candidate, Npc } from '../../sim/types';
import { fx } from '../feedback';
import { Btn, Icon, Sheet, toast, usd } from '../kit';
import { C } from '../theme';
import type { Ctl } from '../useIsland';
import { buildBuy, buildRows, cashGate, crewCounts, doingNow, materialName, ROLE_ICON, ROLE_PLURAL, ROLE_WORD } from './model';
import './staff.css';

type Pick = { kind: 'hire'; c: Candidate } | { kind: 'letGo'; n: Npc } | { kind: 'cottage' } | null;

export function StaffDesk({ ctl }: { ctl: Ctl }) {
  const { s } = ctl;
  const [pick, setPick] = useState<Pick>(null);
  const crew = crewOf(s);
  const helpers = crew.filter((n) => n.role === 'helper').length;
  const [more, setMore] = useState(false);
  // the board by what each hire does for the week's money (best first); the ones that would cost more than they
  // bring fold away behind "more", so the real choices are on top
  const board = (s.hiring?.week === s.week ? s.hiring.cands : []).map((c) => ({ c, net: staffEffect(s, c, 'hire').net })).sort((a, b) => b.net - a.net);
  const good = board.filter((x) => x.net >= 0);
  const costly = board.filter((x) => x.net < 0);
  const close = () => setPick(null);
  return (
    <section class="staff col" aria-label="Staff and payroll">
      <h2 id="staff" style={{ marginTop: 4 }}>
        Staff and payroll
      </h2>
      <Payroll ctl={ctl} />

      <div class="st-h">
        <h3>The crew</h3>
        <span class="label">
          {crewCounts(s).map((c) => `${c.have}/${c.std} ${ROLE_PLURAL[c.role]}`).join(' · ')}
          {helpers > 0 ? ` · ${helpers} ${helpers === 1 ? ROLE_WORD.helper.toLowerCase() : ROLE_PLURAL.helper}` : ''}
        </span>
      </div>
      <div class="card st-list">
        {crew.length === 0 && <span class="muted">Nobody on the payroll: no flights, no turnovers, no site work.</span>}
        {crew.map((n) => (
          <CrewRow key={n.id} ctl={ctl} n={n} onLetGo={() => setPick({ kind: 'letGo', n })} />
        ))}
        <span class="label st-foot">Standard crew for tier {s.tier}: {crewCounts(s).filter((c) => c.std > 0).map((c) => `${c.std} ${c.std === 1 ? ROLE_WORD[c.role].toLowerCase() : ROLE_PLURAL[c.role]}`).join(', ') || 'none'}, all skill 3.</span>
        {/* the week a tier arrives the contractor covers the new crew places, this week only */}
        {NPC_ROLES.map((r) => {
          const short = standardCount(s.tier, r) - crew.filter((n) => n.role === r).length;
          if (commissioning(s, r) <= 0 || short <= 0) return null;
          return (
            <span key={r} class="label st-warn">
              Tier {s.tier} arrived: {r === 'pilot' ? "the contractor's ferry pilot flies the new plane" : "the contractor's cleaners turn over the new houses"} this week only. From week {s.week + 1} that's your crew:{' '}
              {short === 1 ? `one more ${ROLE_WORD[r].toLowerCase()}` : `${short} more ${ROLE_PLURAL[r]}`}.
            </span>
          );
        })}
      </div>

      <div class="st-h">
        <h3 id="hiring" style={{ scrollMarginTop: 72 }}>
          Hiring board · week {s.week}
        </h3>
        <span class="label">new names every week</span>
      </div>
      {board.length === 0 && <div class="card muted">{s.week < 1 ? 'The board opens with week 1.' : 'Nobody new this week: the board fills again when the next week opens.'}</div>}
      {s.receivership > 0 && board.length > 0 && <div class="card fault">In receivership: no new hires until it ends.</div>}
      {good.map(({ c }) => (
        <CandCard key={c.id} ctl={ctl} c={c} onHire={() => setPick({ kind: 'hire', c })} />
      ))}
      {costly.length > 0 && (good.length === 0 || more) && costly.map(({ c }) => <CandCard key={c.id} ctl={ctl} c={c} onHire={() => setPick({ kind: 'hire', c })} />)}
      {costly.length > 0 && good.length > 0 && (
        <button class="pd-link" style={{ alignSelf: 'flex-start' }} onClick={() => setMore(!more)} aria-expanded={more}>
          {more ? 'Hide the ones that cost more than they bring ▴' : `${costly.length} more who'd cost more than they bring ▾`}
        </button>
      )}

      <Builds ctl={ctl} onCottage={() => setPick({ kind: 'cottage' })} />

      <Sheet open={!!pick} onClose={close} label={pick?.kind === 'hire' ? 'Hire' : pick?.kind === 'letGo' ? 'Let go' : 'Start a cottage'}>
        {pick?.kind === 'hire' && <HireSheet ctl={ctl} c={pick.c} onDone={close} />}
        {pick?.kind === 'letGo' && <LetGoSheet ctl={ctl} n={pick.n} onDone={close} />}
        {pick?.kind === 'cottage' && <CottageSheet ctl={ctl} onDone={close} />}
      </Sheet>
    </section>
  );
}

// ---------------------------------------------------------------------------

function Payroll({ ctl }: { ctl: Ctl }) {
  const { s } = ctl;
  const pay = payroll(s);
  const over = tierDef(s.tier).overhead;
  const rw = runway(s);
  const net = projectWeek(s).revenue - rw.weekly;
  const later = crewOf(s).filter((n) => n.start > s.week);
  return (
    <div class="card st-pay">
      <div class="row spread">
        <span class="label">Payroll a week</span>
        <b class="num st-big">{usd(pay)}</b>
      </div>
      <div class="st-sum num">
        <span>Overhead {usd(over)}</span>
        <span>+ payroll {usd(pay)}</span>
        <span>= fixed {usd(fixedNow(s))}</span>
      </div>
      <div class="row wrap" style={{ gap: 6 }}>
        <span class={`chip num st-chip ${net < 0 ? 'rust' : 'palm'}`}>This week {usd(net, true)} before jobs and parts</span>
        <span class="chip num">Runway {rw.weeks} wk</span>
      </div>
      {later.length > 0 && <span class="label">From week {Math.min(...later.map((n) => n.start))}: +{usd(later.reduce((t, n) => t + n.wage, 0))} ({later.map((n) => n.name).join(', ')}, giving notice).</span>}
      <span class="label">
        Weekly cost to the company. Pilots fly, housekeepers turn the houses over, builders do the site work
        {helperOn(s) ? `, an electrician's helper puts in ${s.players.elec?.name ?? 'the electrician'}'s planned routine jobs` : ''}. Nobody here diagnoses, plans or signs for a trade.
      </span>
    </div>
  );
}

function Dots({ skill }: { skill: number }) {
  return (
    <span class="st-dots" aria-label={`skill ${skill} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <i key={i} class={i <= skill ? 'on' : ''} />
      ))}
    </span>
  );
}

function CrewRow({ ctl, n, onLetGo }: { ctl: Ctl; n: Npc; onLetGo(): void }) {
  const { s } = ctl;
  const idle = n.start <= s.week && !working(s).some((x) => x.id === n.id);
  return (
    <div class="st-row">
      <span class="st-ico" aria-hidden="true">
        <Icon name={ROLE_ICON[n.role]} size={18} color={C.seaDeep} />
      </span>
      <span class="col grow" style={{ gap: 1 }}>
        <span class="row" style={{ gap: 8 }}>
          <b class="st-name">{n.name}</b>
          <Dots skill={n.skill} />
        </span>
        <span class="label">
          {ROLE_WORD[n.role]} · {usd(n.wage)}/wk{idle ? '' : ''}
        </span>
        <span class="st-doing">{doingNow(s, n)}</span>
      </span>
      <Btn small kind="ghost" onClick={onLetGo} label={`Let ${n.name} go`}>
        Let go
      </Btn>
    </div>
  );
}

function CandCard({ ctl, c, onHire }: { ctl: Ctl; c: Candidate; onHire(): void }) {
  const { s } = ctl;
  const e = staffEffect(s, c, 'hire');
  return (
    <div class="card st-cand">
      <div class="row" style={{ alignItems: 'flex-start' }}>
        <span class="st-ico" aria-hidden="true">
          <Icon name={ROLE_ICON[c.role]} size={18} color={C.seaDeep} />
        </span>
        <span class="col grow" style={{ gap: 2 }}>
          <span class="row wrap" style={{ gap: 8 }}>
            <b>{ROLE_WORD[c.role]}</b>
            <span class="st-name">{c.name}</span>
            <Dots skill={c.skill} />
          </span>
          <span class="label num">
            asks {usd(c.ask)}/wk · {c.start > s.week ? `starts wk ${c.start} (gives notice)` : 'starts this week'}
          </span>
        </span>
      </div>
      <span class="st-does">{e.does}</span>
      <span class="st-need">{e.need}</span>
      <div class="row spread" style={{ gap: 8 }}>
        <span class={`st-money num ${e.net >= 0 ? 'good' : 'bad'}`}>{e.money}</span>
        <Btn small onClick={onHire} disabled={s.receivership > 0}>
          Hire
        </Btn>
      </div>
    </div>
  );
}

function HireSheet({ ctl, c, onDone }: { ctl: Ctl; c: Candidate; onDone(): void }) {
  const { s } = ctl;
  const e = staffEffect(s, c, 'hire');
  const now = payroll(s);
  const later = c.start > s.week;
  return (
    <div class="col" style={{ gap: 12 }}>
      <h2>
        Hire {c.name} as {/^[aeiou]/i.test(ROLE_WORD[c.role]) ? 'an' : 'a'} {ROLE_WORD[c.role].toLowerCase()}?
      </h2>
      <div class="row" style={{ gap: 8 }}>
        <Dots skill={c.skill} />
        <span class="label">
          skill {c.skill} · asks {usd(c.ask)} a week · {later ? `starts week ${c.start}` : 'starts this week'}
        </span>
      </div>
      <div class="card st-confirm num">
        <span>
          Payroll {usd(now)} → <b>{usd(now + c.ask)}</b> a week{later ? ` from week ${c.start}` : ''}
        </span>
        <span>{e.does}</span>
        <span>{e.need}</span>
        <b class={e.net >= 0 ? 'st-good' : 'st-bad'}>{e.money}</b>
      </div>
      <span class="label">A hire you withdraw the same week costs nothing; after that, letting someone go costs {STAFF.severanceWeeks} weeks' wages.</span>
      <div class="sheet-actions col" style={{ gap: 8 }}>
        <Btn
          block
          onClick={async () => {
            onDone();
            if (await ctl.dispatch({ t: 'hire', cand: c.id })) {
              fx.good();
              toast(`${c.name} is on the payroll${later ? ` from week ${c.start}` : ''}.`);
            }
          }}
        >
          Hire {c.name} · {usd(c.ask)}/wk
        </Btn>
        <Btn block kind="soft" onClick={onDone}>
          Not now
        </Btn>
      </div>
    </div>
  );
}

function LetGoSheet({ ctl, n, onDone }: { ctl: Ctl; n: Npc; onDone(): void }) {
  const { s } = ctl;
  const e = staffEffect(s, n, 'letGo');
  const sev = severanceOf(s, n);
  const short = sev > 0 && spendable(s) < sev;
  return (
    <div class="col" style={{ gap: 12 }}>
      <h2>Let {n.name} go?</h2>
      <span class="label">
        {ROLE_WORD[n.role]} · skill {n.skill} · {usd(n.wage)} a week · {doingNow(s, n)}
      </span>
      <div class="card st-confirm num">
        <span>{e.need}</span>
        <b class={e.net >= 0 ? 'st-good' : 'st-bad'}>{e.money}</b>
        <span>
          Payroll {usd(payroll(s))} → <b>{usd(payroll(s) - (n.start <= s.week ? n.wage : 0))}</b> a week
        </span>
      </div>
      {short && <span class="fault">Not enough spendable cash for the severance ({usd(sev)}).</span>}
      <div class="sheet-actions col" style={{ gap: 8 }}>
        <Btn
          block
          kind="danger"
          disabled={short}
          onClick={async () => {
            onDone();
            if (await ctl.dispatch({ t: 'letGo', npc: n.id })) toast(sev ? `${n.name} left the island: ${usd(sev)} severance.` : `${n.name}'s hire withdrawn.`);
          }}
        >
          {sev ? `Let go · ${usd(sev)} severance` : 'Withdraw the hire · no cost'}
        </Btn>
        <Btn block kind="soft" onClick={onDone}>
          Keep {n.name}
        </Btn>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The builders' site work

function Builds({ ctl, onCottage }: { ctl: Ctl; onCottage(): void }) {
  const { s } = ctl;
  const b = openBuild(s);
  const builders = crewOf(s).filter((n) => n.role === 'builder');
  const out = working(s)
    .filter((n) => n.role === 'builder')
    .reduce((t, n) => t + (STAFF.output[n.skill - 1] ?? 0), 0);
  const plan = s.tier >= 3 ? cottagePlan(s) : null;
  const queued = (s.builds ?? []).filter((x) => x.cottage && x.finished === undefined && x !== b);
  const done = (s.builds ?? []).filter((x) => x.finished !== undefined && x.cottage);
  const buy = (count: number) => {
    if (!b) return;
    const r = buildBuy(s, b, count);
    if (!r.lines.length) return toast('Those materials are on the shelf or on order already.');
    void ctl.dispatch({ t: 'buy', lines: r.lines, buy: { vendor: 'yard' } }).then((ok) => ok && toast(`Ordered from the yard: ${r.lines.map((l) => `${l.qty} × ${materialName(l.item)}`).join(', ')} (${usd(r.cost)}), on the supply boat.`));
  };
  const next = b ? buildBuy(s, b, 1) : null;
  const rest = b ? buildBuy(s, b, b.need) : null;
  const gate = b && b.tier !== undefined && b.tier > s.tier + 1 ? cashGate(s) : null;
  const rows = b ? buildRows(s, b) : [];
  const etaWeeks = b && out > 0 ? Math.max(0, Math.ceil((b.need - b.done) / out - 1e-9)) : null;
  return (
    <>
      <div class="st-h">
        <h3 id="site-work" style={{ scrollMarginTop: 72 }}>
          Site work
        </h3>
        <span class="label">{builders.length ? `${builders.length} builder${builders.length > 1 ? 's' : ''} · ${out ? `${out % 1 ? out.toFixed(2).replace(/0$/, '') : out} unit${out === 1 ? '' : 's'} a week` : 'starting next week'}` : 'no builder'}</span>
      </div>
      {!b && (
        <div class="card col" style={{ gap: 6 }}>
          <span>{s.tier >= 5 ? 'Every tier’s site work is done.' : 'No site work open.'}</span>
          {builders.length > 0 && <span class="label">The builders have nothing to build{plan?.plot ? ': start a cottage below, or let them go.' : '.'}</span>}
        </div>
      )}
      {b && (
        <div class="card st-build">
          <div class="row spread" style={{ alignItems: 'baseline' }}>
            <b>{b.cottage ? buildSite(b) : b.what.split(':')[0]}</b>
            <span class="label num">{b.tier ? `for tier ${b.tier}` : 'extra cottage'}</span>
          </div>
          <div class="bar" role="meter" aria-valuenow={b.done} aria-valuemin={0} aria-valuemax={b.need} aria-label="Site work done">
            <i style={{ width: `${(100 * b.done) / b.need}%`, background: C.palm }} />
          </div>
          <span class="label num">
            {Number.isInteger(b.done) ? b.done : b.done.toFixed(1)} of {b.need} units done
            {etaWeeks !== null ? ` · about ${etaWeeks} more week${etaWeeks === 1 ? '' : 's'} with the materials there` : builders.length ? '' : ' · nobody on it: hire a builder'}
            {b.idle ? ` · held up ${b.idle} week${b.idle > 1 ? 's' : ''} waiting on materials` : ''}
          </span>
          <ol class="st-units">
            {rows.map((u) => (
              <li key={u.k} class={u.state}>
                <span class="st-tick" aria-hidden="true">{u.state === 'done' ? '✓' : u.state === 'working' ? '◐' : u.k + 1}</span>
                <span class="grow">{u.lines.map((l) => `${l.qty > 1 ? `${l.qty} × ` : ''}${l.name}`).join(' + ')}</span>
                <span class="label num">{u.state === 'done' ? 'done' : u.state === 'working' ? 'on site' : u.stock?.at === 'shelf' ? 'on the shelf' : u.stock?.at === 'boat' ? (u.stock.eta <= s.week ? 'boat this week' : `boat wk ${u.stock.eta}`) : `to buy · ${usd(u.stock?.at === 'buy' ? u.stock.cost : 0)}`}</span>
              </li>
            ))}
          </ol>
          {b.tier !== undefined && <span class="label">New buildings start up to 15 lower if the tier comes before its site work is done.</span>}
          {gate && rest && rest.cost > 0 && (
            <span class="label st-warn">
              Tier {gate.tier} asks for {usd(gate.need)} in cash (you have {usd(gate.have)}): {usd(rest.cost)} of materials now puts that further off. This site is for tier {b.tier}.
            </span>
          )}
          {!gate && b.tier !== undefined && b.tier > s.tier + 2 && rest && rest.cost > 0 && (
            <span class="label st-warn">
              This site is for tier {b.tier}, {b.tier - s.tier} tiers away: the builders ran ahead. Its materials can wait; the cash for the tiers in between comes first.
            </span>
          )}
          {next && next.lines.length > 0 && (
            <div class="row wrap" style={{ gap: 8 }}>
              <Btn small onClick={() => buy(1)}>
                Buy the next unit · {usd(next.cost)}
              </Btn>
              {rest && rest.units > 1 && rest.cost > next.cost && (
                <Btn small kind="soft" onClick={() => buy(b.need)}>
                  All of it · {usd(rest.cost)}
                </Btn>
              )}
            </div>
          )}
        </div>
      )}
      {queued.length > 0 && <span class="label">Queued after it: {queued.map((x) => buildSite(x)).join(', ')}.</span>}
      {s.tier >= 3 && (
        <div class="card col st-cottage" style={{ gap: 8 }}>
          <div class="row spread">
            <b>Extra cottages</b>
            <span class="label">{done.length + queued.length + (b?.cottage ? 1 : 0)} of 2</span>
          </div>
          {plan?.plot ? (
            <>
              <span class="st-need">
                {plan.plot.name} in the lagoon grove: {usd(COTTAGE_SHELL)} prefab shell + {usd(plan.cost - COTTAGE_SHELL)} of site work.{' '}
                {plan.rent > 0
                  ? `Rents about ${usd(plan.rent)} a week (a normal week's flights and bookings, averaged over the last 8 weeks)${plan.housekeeper ? `, with another housekeeper to turn it over (${usd(STAFF.wage.housekeeper)}/wk)` : ''}.`
                  : `At this week’s bookings it would sit empty: ${projectWeek(s).booked} of ${projectWeek(s).rentable} houses are booked.`}
              </span>
              <span class="label">{plan.payback ? `Pays back in about ${plan.payback} weeks.` : 'More guests (more flights) would fill it.'} The builders start it after the tier’s own site work.</span>
              <Btn small kind="soft" onClick={onCottage} disabled={spendable(s) < COTTAGE_SHELL || s.receivership > 0}>
                Start a cottage · {usd(COTTAGE_SHELL)}
              </Btn>
              {spendable(s) < COTTAGE_SHELL && <span class="label">Needs {usd(COTTAGE_SHELL)} of spendable cash (you have {usd(spendable(s))}).</span>}
            </>
          ) : (
            <span class="label">Both plots are taken.</span>
          )}
        </div>
      )}
    </>
  );
}

function CottageSheet({ ctl, onDone }: { ctl: Ctl; onDone(): void }) {
  const { s } = ctl;
  const plan = cottagePlan(s);
  const b = openBuild(s);
  if (!plan.plot) return <span class="muted">Both plots are taken.</span>;
  return (
    <div class="col" style={{ gap: 12 }}>
      <h2>Start {plan.plot.name}?</h2>
      <div class="card st-confirm num">
        <span>
          Prefab shell <b>{usd(COTTAGE_SHELL)}</b> now (the mainland contractor)
        </span>
        <span>Site work {usd(plan.cost - COTTAGE_SHELL)} of materials, bought as the builders go (5 units)</span>
        <span>
          {plan.rent > 0
            ? `Rents about ${usd(plan.rent)} a week (a normal week's flights and bookings, averaged over the last 8 weeks)${plan.housekeeper ? `, once another housekeeper (${usd(STAFF.wage.housekeeper)}/wk) turns it over` : ''}`
            : `Rents nothing at this week’s bookings: ${projectWeek(s).booked} of ${projectWeek(s).rentable} houses are booked`}
        </span>
        <span>
          Upkeep about {usd(plan.upkeep)} a week in parts and labour, and one more house on {s.players.elec?.name ?? 'the electrician'}'s list ({plan.open} alert{plan.open === 1 ? '' : 's'} open now)
        </span>
        <b class={plan.payback ? 'st-good' : 'st-bad'}>{plan.payback ? `Pays back in about ${plan.payback} weeks, after the upkeep` : 'No payback at this week’s bookings'}</b>
      </div>
      <span class="label">
        {b && !b.cottage ? `The builders finish ${buildSite(b)} first. ` : ''}Cash now {usd(s.cash)} → {usd(s.cash - COTTAGE_SHELL)}. It joins the island at health 80 and brings its own electrical work
        {plan.open >= 6 ? `: with ${plan.open} alerts open already, a house nobody gets to closes, and then it pays back nothing` : ''}.
      </span>
      <div class="sheet-actions col" style={{ gap: 8 }}>
        <Btn
          block
          onClick={async () => {
            onDone();
            if (await ctl.dispatch({ t: 'build', what: 'cottage' })) {
              fx.good();
              toast(`${plan.plot!.name} ordered: the shell is on its way.`);
            }
          }}
        >
          Start {plan.plot.name} · {usd(COTTAGE_SHELL)}
        </Btn>
        <Btn block kind="soft" onClick={onDone}>
          Not now
        </Btn>
      </div>
    </div>
  );
}
