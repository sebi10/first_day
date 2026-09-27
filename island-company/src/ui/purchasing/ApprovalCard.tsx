// The analyst's approval cards for flow jobs (docs/JOBFLOW.md 8.6, 17.3): the
// labour, the lines pulled from stock and the lines to buy, the supplier (OEM or
// broker, supply house or online) and the freight (scheduled or the AOG boat,
// with what each does to the asset), the chips that say what waiting costs.
// Swipe right to approve, left to defer, or use the buttons. There is no
// counter-offer on a flow card (MEL, make-safe or a cheaper pick is the cheaper
// fix), and no End-turn lock: a card stays approvable all week.
import { useEffect, useRef, useState } from 'preact/hooks';
import { ECON, ROLE_LABEL, SUPPLIERS } from '../../sim/data';
import { cardOf } from '../../sim/flow';
import { spendable } from '../../sim/ledger';
import type { BuyChoice, Freight, SupplierId } from '../../sim/types';
import { fx } from '../feedback';
import { Btn, Seg, TierDots, toast } from '../kit';
import { C, ROLE_TINT } from '../theme';
import type { Ctl } from '../useIsland';
import { cardVM, flowQueue, lowerFirst, usd, type CardVM, type ChipVM } from './model';
import './purchasing.css';

/** "1 × OG-65010-8 main tire", "12 qt MIL-PRF-5606 hydraulic fluid" */
export const lineText = (qtyText: string, pn: string, nomen: string) => `${/^\d+$/.test(qtyText) ? `${qtyText} ×` : qtyText} ${pn} ${lowerFirst(nomen)}`;

export function Chip({ c }: { c: ChipVM }) {
  return <span class={`chip ${c.tone}`}>{c.text}</span>;
}

type Swipe = { x: number; on: boolean; leaving: '' | 'left' | 'right' };

/** a horizontal swipe on a card that still scrolls vertically (touch-action: pan-y); taps on its buttons stay taps */
function useSwipe(decide: (dir: 'left' | 'right') => void) {
  const [sw, setSw] = useState<Swipe>({ x: 0, on: false, leaving: '' });
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const handlers = {
    onPointerDown(e: PointerEvent) {
      if ((e.target as HTMLElement).closest('button, a, input, select, textarea, [role="radio"]')) return;
      start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
      setSw({ x: 0, on: true, leaving: '' });
    },
    onPointerMove(e: PointerEvent) {
      const st = start.current;
      if (!st || st.id !== e.pointerId) return;
      const dx = e.clientX - st.x;
      const dy = e.clientY - st.y;
      // a vertical move is the page scrolling: let it go
      if (Math.abs(dy) > Math.abs(dx) + 8 && Math.abs(dx) < 24) {
        start.current = null;
        setSw({ x: 0, on: false, leaving: '' });
        return;
      }
      if (Math.abs(dx) > 6) (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      setSw({ x: dx, on: true, leaving: '' });
    },
    onPointerUp() {
      const x = sw.x;
      start.current = null;
      if (x > 90) decide('right');
      else if (x < -90) decide('left');
      else setSw({ x: 0, on: false, leaving: '' });
    },
    onPointerCancel() {
      start.current = null;
      setSw({ x: 0, on: false, leaving: '' });
    },
  };
  return { sw, setSw, handlers };
}

/** the card's body: what it buys and why, and the supplier and freight choice */
export function ApprovalCard({
  vm,
  open,
  setOpen,
  buy,
  setBuy,
  onExtend,
}: {
  vm: CardVM;
  open: boolean;
  setOpen(v: boolean): void;
  buy: BuyChoice;
  setBuy(b: BuyChoice): void;
  onExtend(): void;
}) {
  const buying = vm.toBuy.length + vm.tools.length > 0;
  const boat = vm.freight.pick === 'aog' && !!vm.freight.aog;
  return (
    <>
      <div class="row spread" style={{ gap: 6 }}>
        <span class="chip" style={{ background: `${ROLE_TINT[vm.role]}66` }}>
          for {vm.who} · {ROLE_LABEL[vm.role]}
        </span>
        <TierDots tier={vm.tier} />
      </div>
      <h3>{vm.title}</h3>
      <span class="pc-sym">
        <b style={{ color: C.ink }}>{vm.asset}</b>
        {vm.symptom ? ` · ${vm.symptom}` : ''}
      </span>
      <span class="pc-task">{vm.task}</span>
      <div class="pd-lines">
        {vm.fromStock.length > 0 && (
          <div class="pd-line">
            <span>
              From stock · {vm.fromStock.length} line{vm.fromStock.length > 1 ? 's' : ''}
            </span>
            <span class="v">{usd(vm.fromStockValue)}</span>
            {open && <span class="sub">{vm.fromStock.map((l) => lineText(l.qtyText, l.pn, l.nomen)).join(' · ')}</span>}
          </div>
        )}
        {vm.toBuy.map((l) => (
          <div class="pd-line" key={l.item}>
            <span class="pd-wrap">To buy: {lineText(l.qtyText, l.pn, l.nomen)}</span>
            <span class="v">{usd(l.value)}</span>
            <span class="sub">
              {SUPPLIERS[l.supplier].short} · {boat ? 'AOG boat, here tonight' : l.etaText}
            </span>
          </div>
        ))}
        {vm.tools.map((l) => (
          <div class="pd-line" key={l.item}>
            <span class="pd-wrap">
              Tool: {l.pn} {lowerFirst(l.nomen)}
            </span>
            <span class="v">{usd(l.value)}</span>
            <span class="sub">
              capex (kept for the shop) · {SUPPLIERS[l.supplier].short} · {boat ? 'AOG boat, here tonight' : l.etaText}
            </span>
          </div>
        ))}
        {vm.labour > 0 && (
          <div class="pd-line">
            <span>Labour</span>
            <span class="v">{usd(vm.labour)}</span>
          </div>
        )}
        {boat && (
          <div class="pd-line">
            <span>AOG boat</span>
            <span class="v">{usd(vm.freight.aog!.cost ?? 0)}</span>
          </div>
        )}
      </div>
      <div class="pc-total">
        <span class="label">{vm.labour > 0 ? 'Approve' : 'Buy'}</span>
        <b>{usd(vm.total)}</b>
      </div>
      <div class="pd-chips">
        {vm.chips.map((c) => (
          <Chip key={c.text} c={c} />
        ))}
        <span class="chip outline">{vm.budget}</span>
      </div>
      {vm.late && <div class="pd-late">{vm.late}</div>}
      {vm.mel?.canExtend && (
        <Btn small kind="soft" onClick={onExtend}>
          Extend the MEL placard a week (to wk {Math.max(vm.mel.until, 0) + 1})
        </Btn>
      )}
      {buying && (
        <button class="pd-link" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Hide supplier and freight ▴' : 'Supplier and freight ▾'}
        </button>
      )}
      {buying && open && (
        <div class="pd-choice">
          <Seg<SupplierId> value={vm.vendor} options={vm.vendors.map((v) => ({ v: v.v, label: v.label }))} onChange={(v) => setBuy({ ...buy, vendor: v })} />
          <span class="pd-note">{vm.vendors.find((v) => v.v === vm.vendor)?.note}</span>
          {vm.freight.aog ? (
            <>
              <Seg<Freight>
                value={vm.freight.pick}
                options={[
                  { v: 'sched', label: vm.freight.sched.text },
                  { v: 'aog', label: vm.freight.aog.text },
                ]}
                onChange={(v) => setBuy({ ...buy, freight: v })}
              />
              <span class="pd-note">
                {vm.freight.pick === 'aog' ? vm.freight.aog.out || 'Here at this week’s resolve, whatever flew.' : vm.freight.sched.out || 'Rides the week’s carrier: no freight charge.'}
              </span>
            </>
          ) : (
            <span class="pd-note">
              {vm.freight.sched.text}
              {vm.freight.sched.out ? ` · ${vm.freight.sched.out}` : ''}
              {SUPPLIERS[vm.vendor].aog ? ' (the boat is no faster)' : ' (no AOG boat from this supplier)'}
            </span>
          )}
        </div>
      )}
    </>
  );
}

/** the flow cards on the desk: one at a time, the next one peeking, the rest listed with the running total */
export function FlowCards({ ctl, keys }: { ctl: Ctl; keys: boolean }) {
  const { s } = ctl;
  const queue = flowQueue(s);
  const [focus, setFocus] = useState<string | null>(null);
  const top = queue.find((o) => o.id === focus) ?? queue[0];
  const next = queue.find((o) => o !== top);
  const [buy, setBuy] = useState<BuyChoice>({});
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setBuy({});
    setOpen(false);
  }, [top?.id]);
  const decide = async (dir: 'left' | 'right') => {
    if (!top) return;
    fx.swipe();
    setSw({ x: 0, on: false, leaving: dir });
    await new Promise((r) => setTimeout(r, 180));
    const vm = cardVM(s, top, buy);
    const ok =
      dir === 'right'
        ? await ctl.dispatch({ t: 'approve', orderId: top.id, ...(buy.vendor || buy.freight ? { buy } : {}) })
        : await ctl.dispatch({ t: 'defer', orderId: top.id, reason: spendable(s) - vm.total < ECON.freezeBelow + 1000 ? 'cash' : 'priority' });
    if (ok) {
      if (dir === 'right') {
        fx.snap();
        const slip = vm.freight.pick !== 'aog' && vm.toBuy.find((l) => l.etaText.startsWith('slips'));
        toast(`Approved ${vm.title}: ${usd(vm.total)}${vm.toBuy.length + vm.tools.length ? ` · ${vm.freight.pick === 'aog' ? 'on the AOG boat, here tonight' : slip ? slip.etaText : vm.freight.sched.eta <= s.week ? 'here tonight' : `here wk ${vm.freight.sched.eta}`}` : ' · ready to start'}`);
      } else {
        fx.good();
        toast(`Deferred ${vm.title} a week`);
      }
      setFocus(null);
    }
    setSw({ x: 0, on: false, leaving: '' });
  };
  const { sw, setSw, handlers } = useSwipe((d) => void decide(d));
  // desktop: ← defer, → approve
  useEffect(() => {
    if (!keys || !top) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea, select') || document.querySelector('.overlay, .sheet')) return;
      if (e.key === 'ArrowRight') void decide('right');
      else if (e.key === 'ArrowLeft') void decide('left');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  if (!top) return null;
  const vm = cardVM(s, top, buy);
  const off = sw.leaving === 'right' ? 'translate(440px, 0) rotate(14deg)' : sw.leaving === 'left' ? 'translate(-440px, 0) rotate(-14deg)' : '';
  const tf = off || `translate(${sw.x}px, 0) rotate(${sw.x / 24}deg)`;
  const hint = sw.x > 50 ? 'APPROVE' : sw.x < -50 ? 'DEFER' : '';
  const total = queue.reduce((n, o) => n + (o === top ? vm.total : cardOf(s, o).total), 0);
  return (
    <div class="col" style={{ gap: 8 }}>
      <div class="pc-stack">
        {next && <div class="pc pc-behind" style={{ ['--tint' as string]: ROLE_TINT[next.role] }} aria-hidden="true" />}
        <div
          class="pc"
          style={{ ['--tint' as string]: ROLE_TINT[vm.role], transform: tf, transition: sw.on ? 'none' : 'transform .22s cubic-bezier(.2,.8,.2,1)' }}
          {...handlers}
          role="group"
          aria-label={`Approval card: ${vm.title} on ${vm.asset}, ${usd(vm.total)}`}
        >
          <ApprovalCard
            vm={vm}
            open={open}
            setOpen={setOpen}
            buy={buy}
            setBuy={setBuy}
            onExtend={() => vm.mel && void ctl.dispatch({ t: 'melExtend', alert: vm.mel.alert }).then((ok) => ok && toast(`MEL placard extended to week ${vm.mel!.until + 1}`))}
          />
          {hint && (
            <div class="pc-hint" style={{ right: hint === 'APPROVE' ? 14 : undefined, left: hint === 'DEFER' ? 14 : undefined, color: hint === 'APPROVE' ? C.palm : C.inkSoft }}>
              {hint}
            </div>
          )}
        </div>
      </div>
      <div class="pd-actions">
        <Btn kind="ghost" small onClick={() => void decide('left')}>
          Defer
        </Btn>
        <Btn small onClick={() => void decide('right')}>
          Approve {usd(vm.total)}
        </Btn>
      </div>
      <div class="swipe-hint">
        <span>← defer</span>
        <span class="num">
          {queue.length} card{queue.length > 1 ? 's' : ''} · {usd(total)} in all
        </span>
        <span>approve →</span>
      </div>
      {queue.length > 1 && (
        <ul class="pc-queue" aria-label="Cards waiting">
          {queue
            .filter((o) => o !== top)
            .map((o) => {
              const c = cardOf(s, o);
              const asset = s.assets.find((a) => a.id === o.assetId)?.name;
              return (
                <li key={o.id}>
                  <button onClick={() => setFocus(o.id)}>
                    <span class="pd-ell">
                      <b>{o.title}</b>
                      <span class="pd-muted">
                        {asset ? ` · ${asset}` : ''} · {s.players[o.role]?.name ?? ROLE_LABEL[o.role]}
                      </span>
                    </span>
                    <span class="num" style={{ fontWeight: 800 }}>
                      {usd(c.total)}
                    </span>
                  </button>
                </li>
              );
            })}
        </ul>
      )}
    </div>
  );
}
