// Requisitions (docs/JOBFLOW.md 17.3): the techs' standalone requests (stock,
// a tool) and an approved job's new shortfall, grouped the way they'll be
// ordered (one PO per supplier and carrier). Tick the ones to buy, choose the
// suppliers and the freight, and approve them together with the running total;
// or defer one a week.
import { useEffect, useState } from 'preact/hooks';
import { FREIGHT } from '../../sim/data';
import { fx } from '../feedback';
import { Btn, Seg, toast } from '../kit';
import { ROLE_TINT } from '../theme';
import type { Ctl } from '../useIsland';
import { lineText } from './ApprovalCard';
import { reqActions, reqGroups, reqQueue, reqQuote, usd, type ReqChoice } from './model';
import './purchasing.css';

export function ReqQueue({ ctl }: { ctl: Ctl }) {
  const { s } = ctl;
  const q = reqQueue(s);
  const ids = q.map((r) => r.id).join(',');
  // every request starts ticked: the usual move is to buy them all
  const [off, setOff] = useState<Set<string>>(new Set());
  const [choice, setChoice] = useState<ReqChoice>({ cheaper: false, aog: false });
  const [busy, setBusy] = useState(false);
  useEffect(() => setOff(new Set()), [ids]);
  if (!q.length) return null;
  const groups = reqGroups(s, q);
  const picked = q.filter((r) => !off.has(r.id)).map((r) => r.id);
  const quote = reqQuote(s, picked, choice);
  const urgent = q.some((r) => r.urgent);
  const approve = async () => {
    if (!picked.length || busy) return;
    setBusy(true);
    let n = 0;
    for (const a of reqActions(s, picked, choice)) if (await ctl.dispatch(a)) n++;
    setBusy(false);
    if (n) {
      fx.snap();
      toast(`Ordered ${picked.length} request${picked.length > 1 ? 's' : ''}: ${usd(quote.total)}${choice.aog && quote.freight ? ' · on the AOG boat, here tonight' : ''}`);
    }
  };
  return (
    <div class="card pd-sec" aria-label="Requests">
      <div class="row spread">
        <h3>
          Requests · {q.length}
          {urgent && <span class="chip rust" style={{ marginLeft: 8 }}>A job waits</span>}
        </h3>
        <span class="label num">{usd(q.reduce((n, r) => n + r.value, 0))}</span>
      </div>
      {groups.map((g) => (
        <div class="rq-group" key={g.key}>
          <div class="rq-group-h">
            <span class="pd-ell">
              {g.vendorName} · {g.carrierText}
            </span>
            <span class="num">{usd(g.total)}</span>
          </div>
          {g.reqs.map((r) => {
            const on = !off.has(r.id);
            return (
              <div class="rq-row" key={r.id}>
                <button
                  class="rq-tick"
                  role="checkbox"
                  aria-checked={on}
                  aria-label={`Include ${r.pn}`}
                  onClick={() => {
                    fx.tap();
                    const n = new Set(off);
                    if (on) n.add(r.id);
                    else n.delete(r.id);
                    setOff(n);
                  }}
                >
                  <i>{on ? '✓' : ''}</i>
                </button>
                <span class="rq-main">
                  <span>
                    <span class="avatar" style={{ ['--tint' as string]: ROLE_TINT[r.role], width: 20, height: 20, fontSize: 10, display: 'inline-grid', marginRight: 6, verticalAlign: 'middle', boxShadow: `0 0 0 2px ${ROLE_TINT[r.role]}` }}>
                      {r.who[0]}
                    </span>
                    <b>{r.who}:</b> {lineText(r.qtyText, r.pn, r.nomen)}
                  </span>
                  <span class="pd-note">
                    {r.tool ? 'a tool (capex, kept for the shop)' : r.job ? `for ${r.job}` : 'stock'}
                    {r.why ? ` · “${r.why}”` : ''}
                    {r.age > 0 ? ` · waiting ${r.age} wk` : ''}
                  </span>
                  {r.urgent && <span class="chip rust" style={{ alignSelf: 'flex-start' }}>Its job grounds or closes an asset</span>}
                  {r.late && <span class="pd-late">{r.late}</span>}
                  <button class="pd-link" onClick={() => void ctl.dispatch({ t: 'deferReq', req: r.id }).then((ok) => ok && toast(`Deferred ${r.pn} a week`))}>
                    Defer a week
                  </button>
                </span>
                <span class="v">{usd(r.value)}</span>
              </div>
            );
          })}
        </div>
      ))}
      <div class="pd-choice">
        <Seg<'default' | 'cheaper'>
          value={choice.cheaper ? 'cheaper' : 'default'}
          options={[
            { v: 'default', label: 'OEM / supply house' },
            { v: 'cheaper', label: 'Broker / online' },
          ]}
          onChange={(v) => setChoice({ cheaper: v === 'cheaper', aog: v === 'cheaper' ? false : choice.aog })}
        />
        <span class="pd-note">{choice.cheaper ? 'Broker −20% on parts (−10% consumables), online −15%: a week slower, no AOG boat, and one broker line in four held a week for traceability.' : 'List price, the week’s carrier (a lead-1 line lands tonight).'}</span>
        {!choice.cheaper && (quote.aogOk || choice.aog) && (
          <Seg<'sched' | 'aog'>
            value={choice.aog ? 'aog' : 'sched'}
            options={[
              { v: 'sched', label: 'Scheduled' },
              { v: 'aog', label: `AOG boat · +${usd(FREIGHT.aog)} a PO` },
            ]}
            onChange={(v) => setChoice({ ...choice, aog: v === 'aog' })}
          />
        )}
      </div>
      <Btn block disabled={!picked.length || busy} onClick={() => void approve()}>
        Approve {picked.length} · {usd(quote.total)}
        {quote.freight ? ` (freight ${usd(quote.freight)})` : ''}
      </Btn>
      <span class="label center">
        {quote.pos} PO{quote.pos === 1 ? '' : 's'}: one per supplier and carrier (scheduled freight is per shipment: a PO riding one already on its way adds none). Committed now, paid a week after it lands.
      </span>
    </div>
  );
}
