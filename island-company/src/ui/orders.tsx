// Work-order cards: the universal container (same radius, shadow, grammar).
// A job-flow job (docs/JOBFLOW.md 17.2) adds its alert on the card, and in the
// detail its task, each line's state, the POs carrying them and the stop; the
// tech's own job opens in the job-flow sheet (Repick, Drop the job, Start).
import { alertShort } from '../sim/alerts';
import { CABLE_REPORT, defectRule, ECON, GSE, incidentText, ROLE_LABEL, SUPPLIERS } from '../sim/data';
import { deferralRisk, expectedDeferralCost, gseForStart, needsCart } from '../sim/econ';
import { isEmergency, tracedTo } from '../sim/engine';
import { flowStage, installCheck } from '../sim/flow';
import { itemById } from '../sim/items';
import { taskById } from '../sim/tasks';
import type { IslandState, Order, Role } from '../sim/types';
import { ChainChip, ChainOrigin, chainGrounds } from './chain';
import { jobLineStates } from './flow/JobView';
import { lineWords } from './flow/steps';
import { landsWords } from './flow/words';
import { Btn, Icon, TierDots, usd } from './kit';
import { capWords, openTarget, reportSaid } from './select';
import { C, ROLE_TINT } from './theme';

const nameOf = (s: IslandState, r: Role) => s.players[r]?.name ?? ROLE_LABEL[r];
const cartName = (s: IslandState, id?: string) => s.gse?.find((c) => c.id === id)?.name ?? 'the GPU cart';

const PUZZLE_ICON: Record<Role, string> = { mech: 'wrench', elec: 'bolt', fin: 'chart' };

export function statusChip(s: IslandState, o: Order, me?: Role) {
  // the part chain says where it stands (and whose move it is), not "waiting for part"
  const c = s.chain && o.chain && s.chain.id === o.chain.id && s.chain.step !== 'done' ? s.chain : null;
  if (c && o.status !== 'done' && o.status !== 'cancelled' && (o.status !== 'ready' || o.chain!.step === 'job')) {
    if (o.chain!.step === 'job' && o.status === 'ready') return <span class="chip sea">Ready · install the part</span>;
    return <ChainChip s={s} c={c} me={me} />;
  }
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
      {o.chain && (s.chain?.id === o.chain.id && !chainGrounds(s, s.chain) ? <span class="chip">Research · part chain</span> : <span class="chip rust">AOG · part chain</span>)}
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
      <span class="chip rust">
        {rep.effect === 'cap' ? `${nameOf(s, rep.by)}: ${capWords(rep.by)}` : rep.effect === 'gse' ? `${cartName(s, rep.cart)} tagged out` : `−${usd(rep.amount)}/week`}
      </span>
      {rep.again && <span class="chip">Came back · week {rep.again} fix didn't hold</span>}
    </>
  );
}

/** A ground power start (or radio work, its ops check on the bus): the cart it needs, or what's missing (the card says so before anyone starts it). */
function GpuChip({ s, o }: { s: IslandState; o: Order }) {
  if (!needsCart(o.kind) || !o.assetId || o.status === 'done' || o.status === 'cancelled') return null;
  const g = gseForStart(s, o);
  // short enough for one chip on a phone; the card's detail says it in full
  if (g.blocker) return <span class="chip rust">⚡ {g.cart && g.cart.charge < GSE.minStart ? 'Cart too low: charge it' : g.cart ? 'Cart tagged out' : 'Hook up a charged cart first'}</span>;
  return (
    <span class="chip sea">
      ⚡ {g.cart!.name} hooked up · {Math.round(g.cart!.charge)}%
    </span>
  );
}

/** `held`: this seat can't start anything right now (turn over, or a per-turn limit): a ready card isn't highlighted. */
export function OrderCard({ s, o, onOpen, held, me }: { s: IslandState; o: Order; onOpen(o: Order): void; held?: boolean; /** the seat looking at it ("Your move") */ me?: Role }) {
  const asset = s.assets.find((a) => a.id === o.assetId);
  // reports carry forward but never roll deferral incidents: their cost is the effect chip
  // (a part chain's steps never roll one either: the grounded plane is the cost)
  const carried = o.deferrals > 0 && o.status !== 'done' && o.kind !== 'report' && !o.chain;
  const risk = carried ? deferralRisk(o, o.lastDeferredWeek === s.week ? 0 : 1) : 0;
  const cls = `card order ${o.status === 'ready' && !held ? 'ready' : ''} ${o.status === 'done' ? 'done' : ''} ${o.status === 'ready' && held ? 'held' : ''}`;
  // a job-flow job: the alert it answers, in its short words
  const al = o.flow ? s.alerts?.find((x) => x.id === o.flow!.alert) : undefined;
  const flowAlert = al ? capFirst(alertShort(s, al)) : null;
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
        {flowAlert && <span class="label" style={{ lineHeight: 1.3 }}>{flowAlert}</span>}
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
          {statusChip(s, o, me)}
          <GpuChip s={s} o={o} />
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
          ? `${asset.name} · health ${Math.round(asset.health)}${o.status === 'done' || o.gain <= 0 ? '' : ` → up to ${Math.min(100, Math.round(asset.health + o.gain))}`}`
          : o.report
            ? `Cross-trade report · ${nameOf(s, o.report.by)} (${ROLE_LABEL[o.report.by]}) → ${nameOf(s, o.role)}`
            : o.kind === 'project'
              ? 'Crew project part'
              : 'Analyst desk task'}
      </span>
      <div class="row wrap" style={{ gap: 6 }}>
        <OriginChips s={s} o={o} />
        {statusChip(s, o, role)}
        {o.cost > 0 && <span class="chip">{o.report ? 'Paid' : 'Cost'} {usd(o.cost)}</span>}
        {o.parts > 0 && <span class="chip">Needs {o.parts} parts kit</span>}
      </div>
      <Origin s={s} o={o} />
      {o.flow && <FlowDetail s={s} o={o} role={role} />}
      <ChainOrigin s={s} o={o} me={role} />
      {needsCart(o.kind) && o.assetId && o.status !== 'done' && o.status !== 'cancelled' && (
        <p class={gseForStart(s, o).blocker ? 'fault' : 'muted'} style={{ margin: 0, fontWeight: 700 }}>
          {gseForStart(s, o).blocker
            ? `${gseForStart(s, o).blocker}.${o.kind === 'gpustart' ? ' A ground power start runs off a charged cart hooked up to the plane.' : /ops check/.test(gseForStart(s, o).blocker!) ? '' : ' The radio’s ops check runs the bus on ground power.'}`
            : o.kind === 'gpustart'
              ? `${gseForStart(s, o).cart!.name} is hooked up at ${Math.round(gseForStart(s, o).cart!.charge)}%: a start on ${s.assets.find((a) => a.id === o.assetId)?.model === 'cargo' ? 'the turbine takes nearly half of it' : 'a piston takes about a quarter of it'}. Put it back on the charger after.`
              : `${gseForStart(s, o).cart!.name} is hooked up at ${Math.round(gseForStart(s, o).cart!.charge)}%: the ops check takes a little. Put it back on the charger after.`}
        </p>
      )}
      {o.status === 'pending' && !o.chain && (
        <p class="muted" style={{ margin: 0 }}>
          {role === 'fin'
            ? 'Swipe it on your desk.'
            : `Waiting on the analyst. If it slips a week: ${Math.round(e.p * 100)}% incident risk, expected cost ${usd(e.cost)}.`}
        </p>
      )}
      {o.status === 'pending' && o.chain && role === 'fin' && <p class="muted" style={{ margin: 0 }}>A grounded plane waits on it: approve it on your desk (it goes through a cash freeze).</p>}
      {o.status === 'waiting_part' && !o.chain && !o.flow && (
        <p class="muted" style={{ margin: 0 }}>
          {`Approved. Waiting on its parts: ${(s.pos ?? []).filter((p) => (p.status === 'open' || p.status === 'held') && p.lines.some((l) => l.order === o.id && l.got === undefined)).map((p) => `${p.id} week ${p.eta}`).join(', ') || `a request to ${ROLE_LABEL.fin}`}.`}
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
      {o.repair && o.status !== 'done' && o.status !== 'cancelled' && (
        <span class="label">
          {o.repair.via === 'inspection'
            ? asset?.kind === 'plane'
              ? 'Not airworthy until it’s repaired: ground it, or it flies with a known defect (a near-miss on the safety grade). '
              : 'Not safe until it’s repaired: red-tag it, or it stays in service with a known defect (a near-miss on the safety grade). '
            : ''}
          {o.status === 'pending' ? 'Safety-critical: it can be approved even through a cash freeze.' : ''}
        </span>
      )}
      {s.cash < ECON.freezeBelow && o.status === 'pending' && (
        <p class="fault" style={{ margin: 0 }}>
          Cash under $2,000: {isEmergency(s, o) ? 'safety-critical, so it can still be approved.' : 'frozen until cash recovers.'}
        </p>
      )}
    </div>
  );
}

const capFirst = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * A job-flow job in the order detail: the task, each line as it stands
 * (reserved, on a PO and when it lands, held at receiving with the document
 * named, sent back, requested), the POs carrying its lines, and the stop. The
 * tech whose job it is opens it in the job-flow sheet: Repick, Drop the job,
 * and Start (which runs the install check first).
 */
function FlowDetail({ s, o, role }: { s: IslandState; o: Order; role: Role }) {
  const f = o.flow!;
  const t = taskById(f.task);
  const al = s.alerts?.find((x) => x.id === f.alert);
  const lines = jobLineStates(s, o);
  const pos = (s.pos ?? []).filter((p) => p.lines.some((l) => l.order === o.id));
  const check = o.status === 'ready' ? installCheck(s, o) : null;
  const stage = al ? flowStage(s, al) : null;
  const mine = role === o.role && o.status !== 'done' && o.status !== 'cancelled' && !!al;
  return (
    <div class="card col" style={{ gap: 8, background: 'var(--sand)', boxShadow: 'none' }}>
      {t && (
        <span>
          <span class="label">{t.book === 'REF' ? 'Reference' : al?.repair ? 'Repair' : t.book}</span> <b>{t.no}</b> {t.title}
        </span>
      )}
      {al && <span class="label">For: {capFirst(alertShort(s, al))}</span>}
      {f.wired && <span>{nameOf(s, 'elec')}'s check found the fault in the wiring and fixed it: no part.</span>}
      {lines.length > 0 && (
        <div class="col" style={{ gap: 4 }}>
          {lines.map((l) => (
            <span key={l.item} class="row spread" style={{ gap: 8, alignItems: 'flex-start' }}>
              <span style={{ minWidth: 0 }}>{itemById(l.item)?.kind === 'tool' ? itemById(l.item)!.nomen : lineWords(l.item, l.qty)}</span>
              <b class={l.tone === 'none' ? 'fault' : ''} style={{ flex: 'none', maxWidth: '48%', textAlign: 'right', fontSize: 13, ...(l.tone === 'ok' ? { color: C.palm } : {}) }}>
                {l.words}
              </b>
            </span>
          ))}
        </div>
      )}
      {pos.length > 0 && (
        <div class="col" style={{ gap: 2 }}>
          <span class="label">Purchase orders</span>
          {pos.map((p) => (
            <span key={p.id} class="label">
              {p.id} · {SUPPLIERS[p.vendor].short}
              {p.freight === 'aog' ? ' · AOG boat' : ''} ·{' '}
              {p.status === 'open' ? landsWords(s.week, p.eta) : p.status === 'held' ? `held at receiving${p.notes?.length ? `: ${p.notes[p.notes.length - 1]}` : ''}` : p.status === 'returned' ? 'sent back' : `received week ${p.got ?? p.eta}`}
            </span>
          ))}
        </div>
      )}
      {f.stop && (
        <span class="fault" style={{ fontWeight: 700 }}>
          Work stopped: {f.stop}
        </span>
      )}
      {check && !f.stop && (
        <span class="fault" style={{ fontWeight: 700 }}>
          At the start: {check.stop}
        </span>
      )}
      {stage === 'research' && <span class="label">In research: the airplane's logbooks, then engineering.</span>}
      {mine && (
        <Btn small kind="soft" onClick={() => openTarget({ alert: al!.id })}>
          Open the job ▸
        </Btn>
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
    // what happened, as the review told it (older saves: rebuilt from the rule)
    const happened = r.incident ?? incidentText(defectRule(d.puzzle, d.role, d.orderKind, d.variant), d.severity, asset?.name ?? 'the asset');
    return (
      <div class="card col" style={{ gap: 6, background: 'var(--sand)', boxShadow: 'none', borderLeft: `6px solid ${r.via === 'incident' ? C.rust : C.palm}` }}>
        <span class="label">{r.via === 'incident' ? 'Failed in service' : 'Caught by an inspection'}</span>
        <span>
          {r.via === 'incident' ? (
            <>
              {happened}. Traced to {tracedTo(d)}.
            </>
          ) : (
            <>
              {r.foundBy}'s {r.foundIn}
              {on} found {r.problem}, left by {tracedTo(d)}.
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
        {rep.again && (
          <span>
            It came back: the {o.role === 'fin' ? 'correction' : 'fix'} from week {rep.again} didn't {o.role === 'fin' ? 'stick' : 'hold'}.
            {rep.owed ? ` It cost ${usd(rep.owed)} while it only looked fixed; that's charged when this week resolves.` : ''}
          </span>
        )}
        {open && (
          <span class="fault" style={{ fontWeight: 700 }}>
            {rep.effect === 'cap'
              ? `Until it's fixed, ${by} is held to ${capWords(rep.by).replace(' max', '')} a turn.`
              : rep.effect === 'gse'
                ? `Until it's fixed, ${cartName(s, rep.cart)} is tagged out: no ground power starts on it. ${CABLE_REPORT[rep.band ?? 'cracked'].fix}`
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
