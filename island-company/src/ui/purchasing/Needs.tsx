// Needs (docs/JOBFLOW.md 14.2, 17.3): the open alerts nobody has planned, by
// due week, with no P/N (the tech's plan is where a P/N comes from) and a
// Nudge each; the MEL placards and their one extension; the approved jobs
// waiting on parts, line by line.
import { useState } from 'preact/hooks';
import { fx } from '../feedback';
import { Btn, toast } from '../kit';
import type { Ctl } from '../useIsland';
import { lowerFirst, needsVM } from './model';
import './purchasing.css';

export function Needs({ ctl }: { ctl: Ctl }) {
  const { s } = ctl;
  const n = needsVM(s);
  const soon = n.unplanned.some((x) => x.soon) || n.placards.some((p) => p.runsOut && p.canExtend);
  const [open, setOpen] = useState<boolean | null>(null);
  const shown = open ?? soon;
  const count = n.unplanned.length + n.placards.length + n.waiting.length;
  if (!count) return null;
  return (
    <div class="card pd-sec">
      <button class="pd-fold" onClick={() => setOpen(!shown)} aria-expanded={shown}>
        <h3>
          Needs · {n.unplanned.length} unplanned
          {n.placards.length ? ` · ${n.placards.length} placard${n.placards.length > 1 ? 's' : ''}` : ''}
          {n.waiting.length ? ` · ${n.waiting.length} waiting` : ''}
        </h3>
        <span class="chev">{shown ? '▴' : '▾'}</span>
      </button>
      {shown && (
        <>
          {n.unplanned.length > 0 && (
            <div class="col" style={{ gap: 0 }}>
              <span class="pd-note">Nobody has planned these yet, so nothing names a part. The tech's plan brings the P/N: nudge them to plan early, and the parts come in time.</span>
              {n.unplanned.map((x) => (
                <div class={`need ${x.aw ? 'aw' : ''}`} key={x.alert}>
                  <span class="col" style={{ gap: 1, minWidth: 0 }}>
                    <span class="pd-wrap">{x.text}</span>
                    <span class="d">
                      <b>{x.dueText}</b>
                      {x.aw ? ` · ${x.sub ? `grounds it ${x.sub}` : 'grounds or closes it when due'}` : ''}
                    </span>
                  </span>
                  {x.scheduled ? (
                    <span class="chip">Scheduled</span>
                  ) : x.nudged ? (
                    <span class="chip">Nudged</span>
                  ) : (
                    <Btn
                      small
                      kind="soft"
                      onClick={() =>
                        void ctl.dispatch({ t: 'nudge', alert: x.alert }).then((ok) => {
                          if (!ok) return;
                          fx.good();
                          toast(`Nudged ${x.who}`);
                        })
                      }
                    >
                      Nudge
                    </Btn>
                  )}
                </div>
              ))}
            </div>
          )}
          {n.placards.length > 0 && (
            <div class="col" style={{ gap: 0 }}>
              <span class="label">MEL placards (category C)</span>
              {n.placards.map((p) => (
                <div class="need" key={p.alert}>
                  <span class="col" style={{ gap: 1, minWidth: 0 }}>
                    <span class="pd-wrap">{p.text}</span>
                    <span class="d">
                      {p.runsOut ? <b>{p.when}</b> : p.when}
                      {p.ext ? ' · extended once (the MEL allows one)' : p.asked ? ` · ${p.askedBy ?? 'the mechanic'} asks for the one extension` : ''}
                    </span>
                  </span>
                  {p.canExtend ? (
                    <Btn small kind="soft" onClick={() => void ctl.dispatch({ t: 'melExtend', role: 'fin', alert: p.alert }).then((ok) => ok && toast(`MEL extension approved: the placard runs to week ${Math.max(p.until, s.week - 1) + 1}`))}>
                      {p.askedBy ? `Approve ${p.askedBy}’s extension` : 'Approve the extension'}
                    </Btn>
                  ) : (
                    <span class="chip">{p.ext ? 'Extended' : p.until < s.week - 1 ? 'Ran out' : `${s.players.mech?.name ?? 'The mechanic'} asks first`}</span>
                  )}
                </div>
              ))}
            </div>
          )}
          {n.waiting.length > 0 && (
            <div class="col" style={{ gap: 0 }}>
              <span class="label">Approved jobs waiting on parts</span>
              {n.waiting.map((w) => (
                <div class="need" key={w.order} style={{ gridTemplateColumns: '1fr' }}>
                  <b>
                    {w.title}
                    {w.asset ? ` · ${w.asset}` : ''} <span class="pd-muted">({w.who})</span>
                  </b>
                  {w.lines.map((l) => (
                    <span class="d" key={l.pn} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span>
                        {l.qty === 'tool' ? 'tool' : l.qty} × {l.pn} {lowerFirst(l.nomen)}
                      </span>
                      <span class={`chip ${l.tone}`}>{l.state}</span>
                    </span>
                  ))}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
