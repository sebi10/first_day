// An item's sheet (docs/JOBFLOW.md 17.3): its family's 26 weeks of use, what's
// on hand, reserved, free and on order, the lead time, known demand ahead, the
// forecast, turnover and days of supply, the carrying and capital cost; the
// suggested min/max with one tap to take it, steppers to set your own (setStock);
// Buy, and Return / write off (scrap).
import { useEffect, useState } from 'preact/hooks';
import { itemById } from '../../sim/items';
import type { ItemId } from '../../sim/types';
import { fx } from '../feedback';
import { Btn, toast } from '../kit';
import type { Ctl } from '../useIsland';
import { BuySheet, Stepper } from './BuySheet';
import { Columns, VIZ } from './charts';
import { itemVM, qtyWords, usd } from './model';
import './purchasing.css';

export type SheetMode = 'view' | 'buy' | 'scrap';

const CLASS_WORD: Record<string, string> = { fast: 'fast mover', steady: 'steady', slow: 'slow mover', dead: 'dead stock', new: 'new line' };

export function ItemSheet({ ctl, item, mode: start = 'view', onClose }: { ctl: Ctl; item: ItemId; mode?: SheetMode; onClose(): void }) {
  const { s } = ctl;
  const [mode, setMode] = useState<SheetMode>(start);
  useEffect(() => setMode(start), [item, start]);
  const vm = itemVM(s, item);
  const x = itemById(item);
  const [rop, setRop] = useState(vm?.rop ?? vm?.suggest.rop ?? 0);
  const [max, setMax] = useState(vm?.max ?? Math.max((vm?.suggest.rop ?? 0) + 1, vm?.suggest.max ?? 1));
  const [scrap, setScrap] = useState(1);
  useEffect(() => {
    setRop(vm?.rop ?? vm?.suggest.rop ?? 0);
    setMax(vm?.max ?? Math.max((vm?.suggest.rop ?? 0) + 1, vm?.suggest.max ?? 1));
    setScrap(1);
  }, [item, vm?.rop, vm?.max]);
  if (!vm || !x) return null;
  if (mode === 'buy') return <BuySheet ctl={ctl} item={item} onDone={onClose} onBack={() => setMode('view')} />;
  const setStock = async (r: number | null, m: number | null, words: string) => {
    const ok = await ctl.dispatch({ t: 'setStock', item, rop: r, max: m });
    if (ok) {
      fx.good();
      toast(words);
    }
  };
  const sg = vm.suggest;
  const suggested = sg.max > sg.rop;
  const same = vm.rop === sg.rop && vm.max === sg.max;
  const blocked = vm.newBin && vm.binsFree <= 0;
  if (mode === 'scrap') {
    const credit = Math.round(scrap * vm.credit * 100) / 100;
    const loss = Math.round(scrap * vm.loss * 100) / 100;
    return (
      <div class="col" style={{ gap: 12 }}>
        <div class="col" style={{ gap: 2 }}>
          <span class="label">{vm.returnable ? 'Return to the vendor' : 'Write off'}</span>
          <h2 style={{ fontSize: 20 }}>{vm.pn}</h2>
          <span class="pd-muted">{vm.nomen}</span>
        </div>
        {vm.free <= 0 ? (
          <span class="pd-note">Nothing free to {vm.returnable ? 'return' : 'write off'}: every unit on the shelf is reserved for a job.</span>
        ) : (
          <>
            <div class="pd-field">
              <span>
                How many
                <div class="pd-note">{qtyWords(x, vm.free)} free on the shelf</div>
              </span>
              <Stepper value={scrap} min={1} max={vm.free} onChange={setScrap} label="How many" format={(v) => qtyWords(x, v)} />
            </div>
            <div class="pd-lines">
              {vm.returnable ? (
                <>
                  <div class="pd-line">
                    <span>Store credit (75% of average cost), at the next payment run</span>
                    <span class="v">{usd(credit)}</span>
                  </div>
                  <div class="pd-line">
                    <span>Lost (restocking)</span>
                    <span class="v">{usd(loss)}</span>
                  </div>
                </>
              ) : (
                <div class="pd-line">
                  <span>Written off (a consumable can't go back)</span>
                  <span class="v">{usd(loss)}</span>
                </div>
              )}
            </div>
            <span class="pd-note">Frees its bin once the shelf is empty and there's no min/max on it.</span>
          </>
        )}
        <div class="pd-actions">
          <Btn kind="ghost" onClick={() => setMode('view')}>
            Back
          </Btn>
          <Btn
            kind="ink"
            disabled={vm.free <= 0}
            onClick={() =>
              void ctl.dispatch({ t: 'scrap', item, qty: scrap }).then((ok) => {
                if (!ok) return;
                fx.good();
                toast(vm.returnable ? `Returned ${qtyWords(x, scrap)} ${vm.pn}: ${usd(credit)} credit` : `Wrote off ${qtyWords(x, scrap)} ${vm.pn}`);
                onClose();
              })
            }
          >
            {vm.returnable ? 'Return' : 'Write off'} {qtyWords(x, scrap)}
          </Btn>
        </div>
      </div>
    );
  }
  const cols = vm.series.map((v, i) => ({ key: String(vm.weeks[i] ?? i), label: String(vm.weeks[i] ?? ''), up: [{ v, color: VIZ.one, name: 'used' }], read: `Week ${vm.weeks[i] ?? i + 1}: ${qtyWords(x, v)} used (the family)` }));
  return (
    <div class="col" style={{ gap: 12 }}>
      <div class="col" style={{ gap: 2 }}>
        <span class="label">
          {vm.famLabel}
          {vm.tool ? ' · tool' : ''}
        </span>
        <h2 style={{ fontSize: 20 }}>{vm.pn}</h2>
        <span class="pd-muted">{vm.nomen}</span>
        <span class="pd-chips" style={{ marginTop: 4 }}>
          {vm.cls && <span class={`cls ${vm.cls}`}>{CLASS_WORD[vm.cls]}</span>}
          {vm.abc && <span class="abc" title="ABC by value moved">{vm.abc}</span>}
          {vm.spare && <span class="chip sea">insurance spare</span>}
          {vm.bin && <span class="chip outline">holds a bin</span>}
          {vm.supsd && <span class="chip outline">{vm.supsd}</span>}
        </span>
      </div>
      {!vm.tool && vm.series.length > 0 && (
        <div class="col" style={{ gap: 2 }}>
          <span class="label">Use a week, the family (every P/N that fills its slot)</span>
          <Columns cols={cols} height={96} label={`${vm.famLabel}: use per week`} readTitle="Latest:" />
        </div>
      )}
      <div class="pd-kv">
        <div>
          <div class="k">On hand</div>
          <div class="val num">{qtyWords(x, vm.onHand)}</div>
          <div class="s">
            {vm.reserved ? `${qtyWords(x, vm.reserved)} reserved for jobs · ` : ''}
            {qtyWords(x, vm.free)} free
          </div>
        </div>
        <div>
          <div class="k">On order</div>
          <div class="val num">{qtyWords(x, vm.onOrder)}</div>
          <div class="s">{vm.onOrder ? (vm.eta !== undefined ? (vm.eta <= s.week ? 'here tonight' : `first here wk ${vm.eta}`) : '') : 'nothing on the way'}</div>
        </div>
        <div>
          <div class="k">Position</div>
          <div class="val num">{vm.position}</div>
          <div class="s">on hand − reserved + on order − asked for</div>
        </div>
        <div>
          <div class="k">Value</div>
          <div class="val num">{usd(vm.value)}</div>
          <div class="s">avg {usd(vm.avg)} · carrying ~{usd(vm.carry)}/wk</div>
        </div>
      </div>
      <div class="pd-lines">
        <div class="pd-line">
          <span>Lead time</span>
          <span class="v">{vm.leadText}</span>
        </div>
        {!vm.tool && (
          <div class="pd-line">
            <span>Turnover · days of supply</span>
            <span class="v">
              {vm.turns === null ? '—' : `${vm.turns}×/yr`} · {vm.days === null ? 'no use yet' : `${vm.days} days`}
            </span>
          </div>
        )}
        <div class="pd-line">
          <span class="pd-wrap">{vm.forecast}</span>
        </div>
        {vm.known.map((d, i) => (
          <div class="pd-line" key={i}>
            <span class="pd-wrap">Known: {d.why}</span>
            <span class="v">
              {qtyWords(x, d.qty)} · wk {d.week}
            </span>
          </div>
        ))}
        {vm.since !== undefined && !vm.tool && (
          <div class="pd-line">
            <span>On the shelf since</span>
            <span class="v">wk {vm.since}</span>
          </div>
        )}
        {vm.value > 0 && (
          <div class="pd-line">
            <span>Cash tied up</span>
            <span class="v">
              {usd(vm.value)} · ~{usd(vm.capital)}/wk of capital
            </span>
          </div>
        )}
      </div>
      {vm.minmaxOk && (
        <div class="card col" style={{ gap: 8, background: 'var(--sand)', boxShadow: 'none' }}>
          <b>Min / max {vm.rop !== undefined ? `· now ${vm.rop} / ${vm.max}` : '· not set (not replenished)'}</b>
          {suggested && <span class="pd-note">{sg.why}</span>}
          {suggested && !same && (
            <Btn small disabled={blocked} onClick={() => void setStock(sg.rop, sg.max, `${vm.pn}: min ${sg.rop}, max ${sg.max}`)}>
              Use {sg.rop} / {sg.max}
            </Btn>
          )}
          <div class="pd-field">
            <span>Reorder at</span>
            <Stepper value={rop} min={0} max={Math.max(0, max - 1)} onChange={setRop} label="Reorder point" />
          </div>
          <div class="pd-field">
            <span>Order up to</span>
            <Stepper value={max} min={rop + 1} max={500} onChange={setMax} label="Order up to" />
          </div>
          <div class="pd-actions">
            {vm.rop !== undefined && (
              <Btn small kind="ghost" onClick={() => void setStock(null, null, `${vm.pn}: min/max cleared, no more replenishment`)}>
                Clear
              </Btn>
            )}
            <Btn small kind="soft" disabled={blocked || (rop === vm.rop && max === vm.max)} onClick={() => void setStock(rop, max, `${vm.pn}: min ${rop}, max ${max}`)}>
              Save {rop} / {max}
            </Btn>
          </div>
          <span class="pd-note">
            Replenishment orders up to the max whenever the position falls to the reorder point, at the resolve, on scheduled freight. {blocked ? `Stores are full (${vm.binsFree} bins free): a new line needs a bin.` : vm.newBin ? 'A new line takes a stores bin.' : ''}
          </span>
        </div>
      )}
      <div class="pd-actions">
        {(vm.free > 0 || vm.onHand > 0) && !vm.tool && (
          <Btn kind="ghost" onClick={() => setMode('scrap')}>
            {vm.returnable ? 'Return…' : 'Write off…'}
          </Btn>
        )}
        {!(vm.tool && vm.onHand >= 1) && <Btn onClick={() => setMode('buy')}>Buy…</Btn>}
      </div>
    </div>
  );
}
