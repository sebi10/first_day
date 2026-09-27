// The job-flow sheet (docs/JOBFLOW.md 17.2): the header (the asset and its
// registration or the house, the symptom, the flags) and the five-dot stepper
// (Investigate · Manual · Parts · Stock · Send; the electrician's Reference and
// Materials). Steps that don't apply are skipped. The draft lives in
// sessionStorage per alert; the one write is Send (`plan`, or `repick`). An
// alert that has a job shows the job instead: where it stands and whose move.
import { useEffect, useState } from 'preact/hooks';
import { symptomText } from '../../sim/alerts';
import { cardOf } from '../../sim/flow';
import type { Action, Alert, Order } from '../../sim/types';
import { fx } from '../feedback';
import { Btn, Icon, toast, usd } from '../kit';
import type { Ctl } from '../useIsland';
import { FlowSheet } from './FlowSheet';
import { Investigate } from './Investigate';
import { JobView } from './JobView';
import { ManualView } from './ManualView';
import { PartsStep } from './PartsStep';
import { StockStep } from './StockStep';
import { applies, assetOf, checkDraft, newDraft, preview, reduceDraft, researchRepick, sendAction, stepper, STEPS, taskFor, tierOf, type Draft, type DraftAct, type Preview, type StepKey } from './steps';
import { assetTitle, draftKey, flagsOf, nameOf, session, SRC_ICON, SRC_WORDS } from './words';

export type JobFlowProps = {
  ctl: Ctl;
  alert: Alert;
  /** open the job's pick again (a stop, or a change of mind) */
  repick?: boolean;
  onClose(): void;
  /** start a ready job (the host runs the install check first) */
  onStart(o: Order): void;
  /** week 0's walk-through: nothing is dispatched, Send says what would happen */
  demo?: { onSent(p: Preview): void };
};

export function JobFlow({ ctl, alert: a, repick, onClose, onStart, demo }: JobFlowProps) {
  const { s } = ctl;
  const key = draftKey(s.id, a.id);
  const o = a.order ? s.orders.find((x) => x.id === a.order && x.status !== 'cancelled') : undefined;
  const [d, setD] = useState<Draft>(() => {
    if (demo) return newDraft(s, a);
    const saved = checkDraft(s, a, session.get<Draft>(key));
    if (repick && o) return saved?.order === o.id ? saved : newDraft(s, a, o);
    return saved && !saved.order ? saved : newDraft(s, a);
  });
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const act = (x: DraftAct) =>
    setD((prev) => {
      const next = reduceDraft(s, a, prev, x);
      if (!demo) session.set(key, next);
      return next;
    });
  const asset = assetOf(s, a);
  const role = a.role;
  const ended = !demo && !!s.turns[role]?.ended;
  const fin = nameOf(s, 'fin');

  // after Send: say what happened, from the island as it is now (ready, a card, research, requisitions)
  useEffect(() => {
    if (sentAt === null) return;
    const job = a.order ? s.orders.find((x) => x.id === a.order && x.status !== 'cancelled') : undefined;
    if (!job) return;
    let msg: string;
    if (job.status === 'ready') msg = 'Ready: start it now.';
    else if (job.status === 'pending') {
      const total = cardOf(s, job).total;
      msg = `Card sent to ${fin}: ${usd(total)}.${s.turns.fin?.ended ? ` ${fin} has ended the turn: it goes through tonight on the standing approval unless deferred.` : ''}`;
    } else if (job.flow?.research || job.flow?.queued) msg = job.flow.queued ? 'Research queued: it opens when the part chain in progress closes.' : "Research: next, the airplane's logbooks (your move).";
    else {
      const reqs = (s.reqs ?? []).filter((r) => r.order === job.id && r.status === 'open').length;
      msg = reqs ? `Requested ${reqs} line${reqs > 1 ? 's' : ''}: ${fin}'s move.` : 'Waiting on parts.';
    }
    // a toast says what happened (17.2), and the banner keeps it on the job while the sheet stays open
    setBanner(msg);
    toast(msg);
    setSentAt(null);
  }, [s, sentAt]);

  const run = async (x: Action, done?: string): Promise<boolean> => {
    if (demo) {
      toast('Week 0 is a walk-through: in a real week this is written to the island.');
      return false;
    }
    setBusy(true);
    const ok = await ctl.dispatch(x);
    setBusy(false);
    if (ok && done) {
      fx.good();
      toast(done);
    }
    return ok;
  };

  const send = async () => {
    const x = sendAction(s, a, d);
    if ('error' in x) {
      fx.bad();
      toast(x.error);
      return;
    }
    if (demo) {
      fx.good();
      demo.onSent(preview(s, a, d));
      return;
    }
    setBusy(true);
    const ok = await ctl.dispatch(x);
    setBusy(false);
    if (!ok) return;
    fx.good();
    session.del(key);
    setD(newDraft(s, a));
    setSentAt(Date.now());
  };

  /** a repick from the job view: the Parts step with the job's pick; "research": straight to the research branch */
  const startRepick = (research?: boolean) => {
    if (!o?.flow) return;
    if (research) {
      // the line an alteration displaced goes to research; the rest of the pick stays
      const x = researchRepick(s, o);
      if (x) void run(x, 'Sent to research the records.');
      return;
    }
    const fresh = newDraft(s, a, o);
    session.set(key, fresh);
    setD(fresh);
    setBanner(null);
  };

  if (!asset) {
    return (
      <FlowSheet open onClose={onClose} label="Alert">
        <p class="muted">That asset is gone.</p>
      </FlowSheet>
    );
  }

  const planning = !!demo ? true : d.order ? !!o && o.id === d.order && o.status !== 'done' : a.status === 'open';
  const tier = tierOf(s, a);
  const t = taskFor(s, a, d.task);
  // a job: the steps it went through; closed with no job (no fault found): only the look
  const jobTask = t ?? (o?.flow ? taskFor(s, a, o.flow.task) : undefined);
  const labels = stepper(s, a, d);
  const dots = planning
    ? labels
    : STEPS.map((k) => ({
        key: k,
        label: labels.find((x) => x.key === k)!.label,
        state: (!o ? (k === 'investigate' ? 'done' : 'skip') : applies(s, a, k, jobTask) ? (k === 'send' ? 'now' : 'done') : 'skip') as 'done' | 'now' | 'skip',
      }));
  const prevStep = (): StepKey | null => {
    const at = STEPS.indexOf(d.step);
    for (let i = at - 1; i >= 0; i--) if (applies(s, a, STEPS[i], t)) return STEPS[i];
    return null;
  };
  const back = prevStep();
  const flags = flagsOf(s, a);
  const stepWord = (k: StepKey) => dots.find((x) => x.key === k)?.label ?? k;

  const head = (
    <>
      <div class="jf-top">
        <span class={`jf-src ${a.src}`}>
          <Icon name={SRC_ICON[a.src]} size={20} />
        </span>
        <span class="col grow" style={{ gap: 2, minWidth: 0 }}>
          <span class="label jf-where">
            {SRC_WORDS[a.src]} · {assetTitle(s, asset)}
          </span>
          <b class="jf-sym">{symptomText(s, a)}</b>
        </span>
        <button class="jf-x" aria-label="Close" onClick={onClose}>
          <Icon name="x" size={20} />
        </button>
      </div>
      {(flags.length > 0 || demo) && (
        <div class="jf-flags">
          {demo && <span class="jf-flag sea">walk-through</span>}
          {flags.map((f) => (
            <span key={f.text} class={`jf-flag ${f.tone ?? ''}`}>
              {f.text}
            </span>
          ))}
          <span class="jf-tier label">{tier <= 1 ? 'teaching: hints on' : tier === 2 ? 'hints: keywords' : 'no hints'}</span>
        </div>
      )}
      <ol class="jf-dots" aria-label="Steps">
        {dots.map((x) => (
          <li key={x.key} class={x.state}>
            <button disabled={!planning || x.state !== 'done'} aria-current={x.state === 'now' ? 'step' : undefined} onClick={() => act({ t: 'go', step: x.key })}>
              <i>{x.state === 'done' ? '✓' : ''}</i>
              <span>{x.label}</span>
            </button>
          </li>
        ))}
      </ol>
    </>
  );

  let body = null;
  let foot = null;
  if (!planning) {
    body = o ? (
      <>
        {banner && (
          <div class="jf-note ok" role="status">
            {banner}
          </div>
        )}
        <JobView s={s} a={a} o={o} run={run} ended={ended} onStart={onStart} onRepick={startRepick} />
      </>
    ) : (
      <ClosedView ctl={ctl} a={a} />
    );
  } else {
    if (ended && !demo) body = <div class="jf-note warn">Your turn is over for this week: you can look and plan, and send it next week.</div>;
    const stop = d.order && o?.flow?.stop ? o.flow.stop : null;
    const stepBody =
      d.step === 'investigate' ? (
        <Investigate s={s} a={a} run={run} demo={!!demo} ended={ended} />
      ) : d.step === 'manual' ? (
        <ManualView s={s} a={a} d={d} act={act} />
      ) : d.step === 'parts' ? (
        <PartsStep s={s} a={a} d={d} act={act} />
      ) : (
        <StockStep s={s} a={a} d={d} />
      );
    body = (
      <>
        {body}
        {stop && d.step === 'parts' && (
          <div class="jf-note warn">
            <b>Work stopped:</b> {stop}
          </div>
        )}
        {stepBody}
      </>
    );
    const backBtn = back && !(d.step === 'parts' && d.slot) && !(d.step === 'manual' && d.preview && !d.order) && (
      <button class="jf-backbtn" aria-label={`Back to ${stepWord(back)}`} onClick={() => act({ t: 'go', step: back })}>
        ◂
      </button>
    );
    if (d.step === 'investigate')
      foot = (
        <Btn block onClick={() => act({ t: 'go', step: 'manual' })}>
          {role === 'elec' ? 'Find the procedure ▸' : 'Find the task ▸'}
        </Btn>
      );
    else if (d.step === 'manual' && d.preview) {
      const pt = taskFor(s, a, d.preview);
      foot = (
        <div class="row" style={{ gap: 8 }}>
          {back && (
            <button class="jf-backbtn" aria-label={`Back to ${stepWord(back)}`} onClick={() => act({ t: 'go', step: back })}>
              ◂
            </button>
          )}
          <Btn block disabled={!pt?.kind || pt.kind === 'gpustart'} onClick={() => act({ t: 'useTask', task: d.preview! })}>
            Use this task ▸
          </Btn>
        </div>
      );
    } else if (d.step === 'manual') foot = backBtn ? <div class="row" style={{ gap: 8 }}>{backBtn}<span class="label grow">Tap a task to read its card.</span></div> : <span class="label">Tap a task to read its card.</span>;
    else if (d.step === 'parts' && !d.slot)
      foot = (
        <div class="row" style={{ gap: 8 }}>
          {backBtn}
          <Btn block onClick={() => act({ t: 'go', step: 'stock' })}>
            Check stock ▸
          </Btn>
        </div>
      );
    else if (d.step === 'stock') {
      const p = preview(s, a, d);
      foot = (
        <div class="row" style={{ gap: 8 }}>
          {backBtn}
          <Btn block disabled={busy || ended} onClick={send}>
            {p.outcome === 'ready' ? 'Send ▸ ready now' : p.outcome === 'card' ? `Send ▸ card for ${fin}` : 'Send ▸'}
          </Btn>
        </div>
      );
    }
  }

  return (
    <FlowSheet open raised={!!demo} onClose={onClose} label={`Alert: ${symptomText(s, a)}`} head={head} foot={foot} bodyKey={`${planning ? d.step : 'job'}:${d.preview ?? ''}:${d.slot ?? ''}`}>
      {body}
    </FlowSheet>
  );
}

/** an alert that's closed: how it closed, and when */
function ClosedView({ ctl, a }: { ctl: Ctl; a: Alert }) {
  const { s } = ctl;
  const how = a.closed?.how;
  const name = s.assets.find((x) => x.id === a.assetId)?.name ?? 'the asset';
  const words = how === 'nff' ? 'Closed: no fault found.' : how === 'wired' ? 'Closed: the fault was in the wiring, fixed and signed back into service.' : how === 'dropped' ? 'Closed.' : 'Closed: fixed and signed off.';
  const later =
    how === 'nff'
      ? `If there was a fault after all, it comes back as a new alert on ${name}, due at once.`
      : `How good the work was shows up later: in ${name}'s health, an inspection, or the same fault coming back.`;
  return (
    <div class="col jf-step" style={{ gap: 10 }}>
      <div class="jf-stage closed">
        <b>{words}</b>
        {a.closed && <span>Week {a.closed.week}.</span>}
      </div>
      <span class="label">{later}</span>
    </div>
  );
}
