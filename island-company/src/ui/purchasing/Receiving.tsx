// Receiving (docs/JOBFLOW.md 9.4, 9.7, 17.3): what's held for its paperwork
// (the 8130-3, the maker's certificate, a broker's traceability), what's on
// the way and on which carrier, each PO's packing slip (supersession, a line
// sent back, an exchange unit's core), and the payables the next payment run
// pays after the three-way match.
import { useState } from 'preact/hooks';
import type { Ctl } from '../useIsland';
import { heldWords, lowerFirst, receivingVM, usd, type PoVM } from './model';
import './purchasing.css';

function Po({ p, open, toggle }: { p: PoVM; open: boolean; toggle(): void }) {
  return (
    <div class="need" style={{ gridTemplateColumns: '1fr' }}>
      <button class="pd-fold" onClick={toggle} aria-expanded={open} style={{ minHeight: 44 }}>
        <span class="col" style={{ gap: 1, minWidth: 0 }}>
          <span class="pd-wrap">
            <b>{p.id}</b> · {p.vendorShort} · {p.lines.length} line{p.lines.length > 1 ? 's' : ''}
            {p.jobs.length ? ` · for ${p.jobs.join(', ')}` : ''}
          </span>
          <span class="d">{p.status === 'held' ? heldWords(p).replace(`${p.id}: `, '') : p.statusText}</span>
        </span>
        <span class="col" style={{ gap: 0, alignItems: 'flex-end' }}>
          <b class="num">{usd(p.status === 'received' ? p.owed : p.cost)}</b>
          <span class="chev">{open ? '▴' : '▾'}</span>
        </span>
      </button>
      {open && (
        <div class="col" style={{ gap: 2, paddingBottom: 6 }}>
          <span class="label">Packing slip · {p.vendorName} · ordered by {p.by}</span>
          {p.lines.map((l, i) => (
            <span class="d" key={i}>
              {l.qty} × {l.pn} {lowerFirst(l.nomen)}
              {l.note ? <b style={{ color: 'var(--ink)' }}> · {l.note}</b> : null}
            </span>
          ))}
          {p.notes
            .filter((n) => !n.startsWith('held: no'))
            .map((n, i) => (
              <span class="d" key={`n${i}`}>
                Note: {n}
              </span>
            ))}
          {p.cores.map((c, i) => (
            <span class="d" key={`c${i}`}>
              Core: {c}
            </span>
          ))}
          {p.capex > 0 && <span class="d">Capex: {usd(p.capex)} of tools (kept for the shop)</span>}
        </div>
      )}
    </div>
  );
}

export function Receiving({ ctl }: { ctl: Ctl }) {
  const { s } = ctl;
  const v = receivingVM(s);
  const [open, setOpen] = useState<string | null>(null);
  const [paid, setPaid] = useState(false);
  const toggle = (id: string) => setOpen(open === id ? null : id);
  const any = v.held.length + v.open.length + v.payable.length + v.paid.length;
  return (
    <div class="card pd-sec" id="receiving" style={{ scrollMarginTop: 72 }}>
      <div class="row spread">
        <h3>Receiving</h3>
        <span class="label num">
          committed {usd(v.committed)}
          {v.credit ? ` · store credit ${usd(v.credit)}` : ''}
        </span>
      </div>
      {!any && <span class="pd-empty">No purchase orders open. What you buy shows here until it's paid.</span>}
      {v.held.length > 0 && (
        <div class="col" style={{ gap: 0 }}>
          <span class="label">Held at receiving: no paperwork, no install</span>
          {v.held.map((p) => (
            <Po key={p.id} p={p} open={open === p.id} toggle={() => toggle(p.id)} />
          ))}
        </div>
      )}
      {v.open.length > 0 && (
        <div class="col" style={{ gap: 0 }}>
          <span class="label">On the way</span>
          {v.open.map((p) => (
            <Po key={p.id} p={p} open={open === p.id} toggle={() => toggle(p.id)} />
          ))}
        </div>
      )}
      {v.payable.length > 0 && (
        <div class="col" style={{ gap: 0 }}>
          <span class="label">
            Payable at the next payment run: {usd(v.payableTotal)} (net 7, after the three-way match)
          </span>
          {v.payable.map((p) => (
            <Po key={p.id} p={p} open={open === p.id} toggle={() => toggle(p.id)} />
          ))}
        </div>
      )}
      {v.paid.length > 0 && (
        <>
          <button class="pd-link" style={{ alignSelf: 'flex-start' }} onClick={() => setPaid(!paid)} aria-expanded={paid}>
            {paid ? 'Hide' : 'Show'} paid in the last two weeks ({v.paid.length})
          </button>
          {paid && v.paid.map((p) => <Po key={p.id} p={p} open={open === p.id} toggle={() => toggle(p.id)} />)}
        </>
      )}
    </div>
  );
}
