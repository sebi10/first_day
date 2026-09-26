// Work-order cards: the universal container (same radius, shadow, grammar).
import { defectRule, ECON, ROLE_LABEL } from '../sim/data';
import { deferralRisk, expectedDeferralCost } from '../sim/econ';
import { isEmergency, tracedTo } from '../sim/engine';
import type { IslandState, Order, Role } from '../sim/types';
import { Icon, TierDots, usd } from './kit';
import { capWords, reportSaid } from './select';
import { C, ROLE_TINT } from './theme';

const nameOf = (s: IslandState, r: Role) => s.players[r]?.name ?? ROLE_LABEL[r];

const PUZZLE_ICON: Record<Role, string> = { mech: 'wrench', elec: 'bolt', fin: 'chart' };

export function statusChip(s: IslandState, o: Order) {
  switch (o.status) {
    case 'ready':
      return <span class="chip sea">Ready</span>;
    case 'pending':
      return o.pushedBack ? <span class="chip">Pushed back · analyst</span> : <span class="chip">Needs approval</span>;
    case 'countered':
      return <span class="chip ink">Cheaper fix offered</span>;
    case 'waiting_part':
      return (
        <span class="chip">
          <Icon name="box" size={13} /> Waiting for part
        </span>
      );
    case 'done':
      // blind sign-off: no score, no verdict (how good it was shows up later)
      if (o.result?.blind) return <span class="chip">Signed off</span>;
      return <span class="chip palm">Done · {Math.round((o.result?.score ?? 0) * 100)}%{o.result?.perfect ? ' ★' : ''}</span>;
    default:
      return null;
  }
  void s;
}

/** Where a job came from: a repair for an earlier sign-off, the redo after it, or a crewmate's report. */
function OriginChips({ s, o }: { s: IslandState; o: Order }) {
  const rep = o.report;
  return (
    <>
      {o.repair && <span class="chip ink">Repair · from week {o.repair.defect.week}</span>}
      {o.redo && <span class="chip ink">Redo · week {o.redo.week} sign-off</span>}
      {rep && (
        <span class="chip" style={{ background: `${ROLE_TINT[rep.by]}66` }}>
          Reported by {nameOf(s, rep.by)}
        </span>
      )}
    </>
  );
}

/** While a report is open, what it costs the crew. */
function ReportEffect({ s, o }: { s: IslandState; o: Order }) {
  const rep = o.report;
  if (!rep || o.status === 'done' || o.status === 'cancelled') return null;
  return (
    <>
      <span class="chip rust">{rep.effect === 'cap' ? `${nameOf(s, rep.by)}: ${capWords(rep.by)}` : `−${usd(rep.amount)}/week`}</span>
      {rep.again && <span class="chip">Came back · week {rep.again} fix didn't hold</span>}
    </>
  );
}

export function OrderCard({ s, o, onOpen }: { s: IslandState; o: Order; onOpen(o: Order): void }) {
  const asset = s.assets.find((a) => a.id === o.assetId);
  // reports carry forward but never roll deferral incidents: their cost is the effect chip
  const carried = o.deferrals > 0 && o.status !== 'done' && o.kind !== 'report';
  const risk = carried ? deferralRisk(o, o.lastDeferredWeek === s.week ? 0 : 1) : 0;
  const cls = `card order ${o.status === 'ready' ? 'ready' : ''} ${o.status === 'done' ? 'done' : ''}`;
  return (
    <button
      class={cls}
      style={{ border: 0, textAlign: 'left', width: '100%', ['--tint' as string]: ROLE_TINT[o.role] }}
      onClick={() => onOpen(o)}
      aria-label={`${o.title}${asset ? ` on ${asset.name}` : ''}, ${o.status.replace('_', ' ')}`}
    >
      <span class="ico" style={{ background: `${ROLE_TINT[o.role]}44` }}>
        <Icon name={PUZZLE_ICON[o.role]} size={22} />
      </span>
      <span class="col grow" style={{ gap: 4 }}>
        <span class="row spread" style={{ alignItems: 'flex-start' }}>
          <b style={{ fontSize: 16, lineHeight: 1.2 }}>{o.title}</b>
          {o.cost > 0 && <span class="num" style={{ fontWeight: 800, fontSize: 15 }}>{usd(o.cost)}</span>}
        </span>
        <span class="row wrap" style={{ gap: 6 }}>
          <span class="label">{asset?.name ?? (o.report ? 'Cross-trade report' : o.leak ? `${usd(o.leak)} at stake` : 'Desk')}</span>
          <TierDots tier={o.tier} />
          {o.parts > 0 && <span class="label">· {o.parts} kit</span>}
          {o.redo && o.cost === 0 && <span class="label">· already paid</span>}
        </span>
        <span class="row wrap" style={{ gap: 6 }}>
          {o.kind === 'project' && <span class="chip palm">Crew project</span>}
          {o.squawk && <span class="chip">✎ {o.squawk}</span>}
          <OriginChips s={s} o={o} />
          {statusChip(s, o)}
          <ReportEffect s={s} o={o} />
          {carried && (
            <span class={`chip ${risk >= 0.3 ? 'rust' : ''}`}>
              ⚠ carried {o.deferrals} wk · {Math.round(risk * 100)}% risk
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

export function OrderDetail({ s, o, role }: { s: IslandState; o: Order; role: Role }) {
  const asset = s.assets.find((a) => a.id === o.assetId);
  const e = expectedDeferralCost(s, o);
  return (
    <div class="col" style={{ gap: 10 }}>
      <div class="row spread">
        <h2>{o.title}</h2>
        <TierDots tier={o.tier} />
      </div>
      <span class="muted">
        {asset
          ? `${asset.name} · health ${Math.round(asset.health)}${o.status === 'done' ? '' : ` → up to ${Math.min(100, Math.round(asset.health + o.gain))}`}`
          : o.report
            ? `Cross-trade report · ${nameOf(s, o.report.by)} (${ROLE_LABEL[o.report.by]}) → ${nameOf(s, o.role)}`
            : o.kind === 'project'
              ? 'Crew project part'
              : 'Analyst desk task'}
      </span>
      <div class="row wrap" style={{ gap: 6 }}>
        <OriginChips s={s} o={o} />
        {statusChip(s, o)}
        {o.cost > 0 && <span class="chip">{o.report ? 'Paid' : 'Cost'} {usd(o.cost)}</span>}
        {o.parts > 0 && <span class="chip">Needs {o.parts} parts kit</span>}
      </div>
      <Origin s={s} o={o} />
      {o.status === 'pending' && (
        <p class="muted" style={{ margin: 0 }}>
          {role === 'fin'
            ? 'Swipe it on your desk.'
            : `Waiting on the analyst. If it slips a week: ${Math.round(e.p * 100)}% incident risk, expected cost ${usd(e.cost)}.`}
        </p>
      )}
      {o.status === 'waiting_part' && (
        <p class="muted" style={{ margin: 0 }}>
          Approved. The kit rides the next {s.assets.some((a) => a.model === 'cargo') ? 'cargo' : 'guest'} flight ({s.parts.inTransit} in transit, {s.parts.stock} in stock).
          {s.parts.inTransit === 0 ? ` Nothing is in transit: ${ROLE_LABEL.fin} needs to buy one.` : ''}
        </p>
      )}
      {o.status === 'done' && o.result?.blind && (
        <p class="muted" style={{ margin: 0 }}>
          Signed off by {nameOf(s, o.result.by)} in week {o.result.week}. No verdict: how good it was shows up later
          {asset ? `, in ${asset.name}'s health, an inspection, or an incident.` : o.report ? `, if the fix doesn't hold.` : '.'}
        </p>
      )}
      {o.status === 'done' && o.result && !o.result.blind && (
        <p class="muted" style={{ margin: 0 }}>
          {Math.round(o.result.score * 100)}% · {Math.round(Math.min(1.15, o.result.credit) * 100)}% credit{o.result.auto ? ' · autopilot' : ''}
          {o.result.covered ? ' · covered by a teammate' : ''}
          {o.result.summary ? ` · ${o.result.summary}` : ''}
        </p>
      )}
      {o.repair && o.status === 'pending' && s.cash >= ECON.freezeBelow && (
        <span class="label">Safety-critical: a known defect is still in service. It can be approved even through a cash freeze.</span>
      )}
      {s.cash < ECON.freezeBelow && o.status === 'pending' && (
        <p class="fault" style={{ margin: 0 }}>
          Cash under $2,000: {isEmergency(s, o) ? 'safety-critical, so it can still be approved.' : 'frozen until cash recovers.'}
        </p>
      )}
    </div>
  );
}

/** Why this job exists: the repair's trace, the redo's history, or the crewmate's report. */
function Origin({ s, o }: { s: IslandState; o: Order }) {
  const asset = s.assets.find((a) => a.id === o.assetId);
  const on = asset ? ` on ${asset.name}` : '';
  if (o.repair) {
    const r = o.repair;
    const d = r.defect;
    const rule = defectRule(d.puzzle, d.role);
    return (
      <div class="card col" style={{ gap: 6, background: 'var(--sand)', boxShadow: 'none', borderLeft: `6px solid ${r.via === 'incident' ? C.rust : C.palm}` }}>
        <span class="label">{r.via === 'incident' ? 'Failed in service' : 'Caught by an inspection'}</span>
        <span>
          {r.via === 'incident' ? (
            <>
              {rule.incident}
              {on}, traced to {tracedTo(d)}.
            </>
          ) : (
            <>
              {r.foundBy}'s {r.foundIn} found {r.problem}
              {on}, left by {tracedTo(d)}.
            </>
          )}
        </span>
        <b style={{ fontSize: 15 }}>
          {o.status === 'done'
            ? d.redo
              ? 'Repaired. Now the original job gets redone (already paid).'
              : 'Repaired and closed.'
            : d.redo
              ? 'Repair first, then redo the original job (already paid).'
              : 'Repair it and it’s closed.'}
        </b>
      </div>
    );
  }
  if (o.redo) {
    return (
      <div class="card col" style={{ gap: 6, background: 'var(--sand)', boxShadow: 'none', borderLeft: `6px solid ${C.ink}` }}>
        <span class="label">Redo</span>
        <span>
          The original job again, now the repair is done: {o.redo.name}'s week {o.redo.week} sign-off didn't hold. Already paid, so no cost and no approval.
        </span>
      </div>
    );
  }
  if (o.report) {
    const rep = o.report;
    const by = nameOf(s, rep.by);
    const open = o.status !== 'done' && o.status !== 'cancelled';
    return (
      <div class="card col" style={{ gap: 6, background: 'var(--sand)', boxShadow: 'none', borderLeft: `6px solid ${ROLE_TINT[rep.by]}` }}>
        <span>
          <b>{by} reports:</b> {reportSaid(o)}.
        </span>
        {rep.again && <span>It came back: the fix from week {rep.again} didn't hold.</span>}
        {open && (
          <span class="fault" style={{ fontWeight: 700 }}>
            {rep.effect === 'cap'
              ? `Until it's fixed, ${by} is held to ${capWords(rep.by).replace(' max', '')} a turn.`
              : `Costs ${usd(rep.amount)} every week it stays open.`}
          </span>
        )}
        {open && (
          <span class="label">
            {o.cost > 0 ? `${usd(o.cost)} out of pocket, already paid: no approval needed. ` : 'No approval needed. '}
            It never rolls an incident, but the effect lasts until it's fixed.
          </span>
        )}
      </div>
    );
  }
  return null;
}
