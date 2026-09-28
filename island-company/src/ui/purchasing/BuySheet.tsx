// A stock buy (docs/JOBFLOW.md 9, 17.3): how many (whole packs; wire by the
// foot), from which supplier, by which freight, what it costs and when it
// lands. It commits now and is paid at the payment run a week after it lands.
import { useState } from 'preact/hooks';
import { FREIGHT, SUPPLIERS } from '../../sim/data';
import { itemById } from '../../sim/items';
import type { Freight, ItemId, SupplierId } from '../../sim/types';
import { fx } from '../feedback';
import { Btn, Seg, toast } from '../kit';
import type { Ctl } from '../useIsland';
import { buyQuote, itemVM, qtyWords, SUPPLIER_PAIR, supplierNote, usd } from './model';
import './purchasing.css';

export function Stepper({ value, min, max, step = 1, onChange, label, format }: { value: number; min: number; max: number; step?: number; onChange(v: number): void; label: string; format?(v: number): string }) {
  const set = (v: number) => {
    fx.tick();
    onChange(Math.max(min, Math.min(max, v)));
  };
  return (
    <span class="stepper" role="group" aria-label={label}>
      <button aria-label={`${label}: less`} disabled={value <= min} onClick={() => set(value - step)}>
        −
      </button>
      <output aria-live="polite">{format ? format(value) : value}</output>
      <button aria-label={`${label}: more`} disabled={value >= max} onClick={() => set(value + step)}>
        +
      </button>
    </span>
  );
}

/** the first buy the sheet offers: up to the max (or the suggestion's), at least one pack */
export function startQty(ctlS: Ctl['s'], id: ItemId): number {
  const vm = itemVM(ctlS, id);
  const x = itemById(id);
  if (!vm || !x) return 1;
  const want = (vm.max ?? vm.suggest.max) - vm.position;
  const step = x.cut ? 10 : Math.max(1, x.pack);
  return Math.max(step, Math.ceil(Math.max(1, want) / step) * step);
}

export function BuySheet({ ctl, item, onDone, onBack }: { ctl: Ctl; item: ItemId; onDone(): void; onBack?(): void }) {
  const { s } = ctl;
  const x = itemById(item);
  const [qty, setQty] = useState(() => startQty(s, item));
  const [vendor, setVendor] = useState<SupplierId>(() => (x ? SUPPLIER_PAIR[x.trade][0] : 'oem'));
  const [freight, setFreight] = useState<Freight>('sched');
  const [busy, setBusy] = useState(false);
  if (!x) return null;
  const q = buyQuote(s, item, qty, { vendor, freight });
  // the scheduled choice's freight (per shipment: its own, or riding one already on its way)
  const qs = freight === 'sched' ? q : buyQuote(s, item, qty, { vendor, freight: 'sched' });
  const step = x.cut ? 10 : Math.max(1, x.pack);
  const packWord = x.cut ? `${x.unit} (cut to length)` : x.pack > 1 ? `${x.packName ?? 'pack'} of ${qtyWords(x, x.pack)}` : 'each';
  const buy = async () => {
    if (q.block || busy) return;
    setBusy(true);
    const ok = await ctl.dispatch({ t: 'buy', lines: [{ item, qty: q.units }], buy: { vendor, freight: q.aogOk ? freight : 'sched' } });
    setBusy(false);
    if (ok) {
      fx.snap();
      toast(`Ordered ${qtyWords(x, q.units)} ${x.pn}: ${usd(q.total)}, ${q.etaText}`);
      onDone();
    }
  };
  return (
    <div class="col" style={{ gap: 12 }}>
      <div class="col" style={{ gap: 2 }}>
        <span class="label">Buy stock</span>
        <h2 style={{ fontSize: 20 }}>{x.pn}</h2>
        <span class="pd-muted">{x.nomen}</span>
      </div>
      <div class="pd-field">
        <span>
          Quantity
          <div class="pd-note">Sold by the {packWord}</div>
        </span>
        <Stepper value={qty} min={step} max={500} step={step} onChange={setQty} label="Quantity" format={(v) => qtyWords(x, v)} />
      </div>
      <div class="pd-choice">
        <Seg<SupplierId> value={vendor} options={SUPPLIER_PAIR[x.trade].map((v) => ({ v, label: SUPPLIERS[v].short }))} onChange={(v) => setVendor(v)} />
        <span class="pd-note">{supplierNote(vendor)}</span>
        {q.aogOk && (
          <Seg<Freight>
            value={freight}
            options={[
              { v: 'sched', label: qs.freight > 0 ? `Scheduled · +${usd(qs.freight)}` : 'Scheduled · no extra' },
              { v: 'aog', label: `AOG boat · +${usd(FREIGHT.aog)}` },
            ]}
            onChange={setFreight}
          />
        )}
      </div>
      <div class="pd-lines">
        <div class="pd-line">
          <span>
            {qtyWords(x, q.units)} at {usd(q.value / Math.max(1, q.units))}
            {x.cut || x.pack <= 1 ? '' : ` (${q.packs} ${x.packName ?? 'pack'}${q.packs === 1 ? '' : 's'})`}
          </span>
          <span class="v">{usd(q.value)}</span>
        </div>
        {(q.freight > 0 || q.ship) && (
          <div class="pd-line">
            <span>{freight === 'aog' && q.aogOk ? 'AOG boat' : 'Freight'}</span>
            <span class="v">{usd(q.freight)}</span>
            {q.ship && <span class="sub">{q.ship}</span>}
          </div>
        )}
        <div class="pd-line total">
          <span>Committed now</span>
          <span class="v">{usd(q.total)}</span>
          <span class="sub">
            {q.etaText} · {SUPPLIERS[q.vendor].name} · paid at the payment run a week after it lands
          </span>
        </div>
      </div>
      {q.block && <span class="fault">{q.block}</span>}
      <div class="pd-actions">
        {onBack && (
          <Btn kind="ghost" onClick={onBack}>
            Back
          </Btn>
        )}
        <Btn disabled={!!q.block || busy} onClick={() => void buy()}>
          Buy · {usd(q.total)}
        </Btn>
      </div>
    </div>
  );
}
