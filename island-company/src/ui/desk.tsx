// The analyst's desk: a game, not a form. Swipe approvals, price against a
// live demand curve, set repair budgets, buy parts, run the money hunts.
import { useEffect, useRef, useState } from 'preact/hooks';
import { ECON, INSURANCE, ROLE_LABEL } from '../sim/data';
import { budgetCap, listPrice } from '../sim/engine';
import { charterLoad, expectedDeferralCost, logistic, occupancy, projectWeek, rateBounds, season, tierDef, urgency } from '../sim/econ';
import type { Insurance, Order } from '../sim/types';
import { fx } from './feedback';
import { Btn, Icon, Seg, TierDots, usd } from './kit';
import { CoverSection } from './ops';
import { OrderCard } from './orders';
import { openOrders } from './select';
import { C, ROLE_TINT } from './theme';
import type { Ctl } from './useIsland';

export function Desk({ ctl, onPlay }: { ctl: Ctl; onPlay(o: Order, cover?: boolean): void }) {
  const { s } = ctl;
  const ended = !!s.turns.fin?.ended;
  const tasks = openOrders(s, 'fin');
  const proj = projectWeek(s);
  const delta = s.cash - s.openCash;
  return (
    <>
      <div class="card col" style={{ gap: 6, ['--tint' as string]: C.fin }}>
        <div class="row spread">
          <span class="label">Cash</span>
          <span class="label num">{delta === 0 ? 'no change this week' : `${usd(delta, true)} this week`}</span>
        </div>
        <div class="num" style={{ fontSize: 40, fontWeight: 900, letterSpacing: '-0.02em', color: s.cash < ECON.freezeBelow ? C.rust : C.ink }}>
          {usd(s.cash)}
        </div>
        <div class="row wrap" style={{ gap: 6 }}>
          <span class="chip sea num">Forecast revenue {usd(proj.revenue)}</span>
          <span class={`chip num ${proj.revenue >= proj.budget ? 'palm' : ''}`}>
            {Math.round((proj.revenue / proj.budget) * 100)}% of {usd(proj.budget)} budget
          </span>
          <span class="chip num">Fixed −{usd(tierDef(s.tier).fixed)}</span>
        </div>
        {s.cash < ECON.freezeBelow && <span class="fault">Under $2,000: every approval is frozen.</span>}
        {s.receivership > 0 && <span class="fault">Receivership · {s.receivership} wk: rates capped, spend over $800 blocked, grade capped at C.</span>}
      </div>

      {s.pendingBonus && <Bonus ctl={ctl} />}

      <h2 style={{ marginTop: 4 }}>Approvals</h2>
      <Approvals ctl={ctl} disabled={ended} />

      <h2 style={{ marginTop: 4 }}>Desk work</h2>
      {tasks.length === 0 && <div class="card muted">Nothing on the desk.</div>}
      {tasks.map((o) => (
        <OrderCard key={o.id} s={s} o={o} onOpen={(x) => x.status === 'ready' && !ended && onPlay(x)} />
      ))}

      <h2 style={{ marginTop: 4 }}>Pricing</h2>
      <Pricing ctl={ctl} />

      <h2 style={{ marginTop: 4 }}>Budgets, parts, insurance</h2>
      <Budgets ctl={ctl} />
      <CoverSection ctl={ctl} role="fin" onPlay={onPlay} />
    </>
  );
}

function Bonus({ ctl }: { ctl: Ctl }) {
  const b = ctl.s.pendingBonus ?? 0;
  return (
    <div class="card col" style={{ gap: 10, borderLeft: `6px solid ${C.palm}` }}>
      <h3>A-grade bonus: {usd(b)}</h3>
      <span class="muted">Your call, 20 seconds.</span>
      <div class="row" style={{ gap: 6 }}>
        <Btn small block kind="soft" onClick={() => ctl.dispatch({ t: 'allocateBonus', choice: 'reserve' })}>
          Reserve
        </Btn>
        <Btn small block kind="soft" onClick={() => ctl.dispatch({ t: 'allocateBonus', choice: 'capex' })}>
          Capex +8
        </Btn>
        <Btn small block kind="soft" onClick={() => ctl.dispatch({ t: 'allocateBonus', choice: 'split' })}>
          +150 XP each
        </Btn>
      </div>
    </div>
  );
}

// --- swipe approvals --------------------------------------------------------

function Approvals({ ctl, disabled }: { ctl: Ctl; disabled: boolean }) {
  const { s } = ctl;
  const queue = s.orders
    .filter((o) => o.status === 'pending' && o.role !== 'fin' && o.lastDeferredWeek !== s.week)
    .sort((a, b) => urgency(s, b) - urgency(s, a));
  const top = queue[0];
  const next = queue[1];
  const [drag, setDrag] = useState({ x: 0, y: 0, on: false, leaving: '' as '' | 'left' | 'right' | 'up' });
  const start = useRef<{ x: number; y: number; id: number } | null>(null);

  const decide = async (dir: 'left' | 'right' | 'up') => {
    if (!top || disabled) return;
    fx.swipe();
    setDrag({ x: 0, y: 0, on: false, leaving: dir });
    await new Promise((r) => setTimeout(r, 180));
    const ok =
      dir === 'right'
        ? await ctl.dispatch({ t: 'approve', orderId: top.id })
        : dir === 'left'
          ? await ctl.dispatch({ t: 'defer', orderId: top.id, reason: s.cash - top.cost < ECON.freezeBelow + 1000 ? 'cash' : 'priority' })
          : await ctl.dispatch({ t: 'counter', orderId: top.id });
    if (ok) dir === 'right' ? fx.snap() : fx.good();
    setDrag({ x: 0, y: 0, on: false, leaving: '' });
  };

  // desktop: ← defer, → approve, ↑ counter
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || document.querySelector('.overlay, .sheet')) return;
      if (e.key === 'ArrowRight') void decide('right');
      else if (e.key === 'ArrowLeft') void decide('left');
      else if (e.key === 'ArrowUp') {
        e.preventDefault();
        void decide('up');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!top)
    return (
      <div class="card muted">
        No cards waiting. {s.autoBudget.mech + s.autoBudget.elec > 0 ? 'Small jobs are auto-approved from your repair budgets.' : ''}
      </div>
    );

  const exp = expectedDeferralCost(s, top);
  const asset = s.assets.find((a) => a.id === top.assetId);
  const counterUsed = !!top.pushedBack;
  const off = drag.leaving === 'right' ? 'translate(420px, 0) rotate(18deg)' : drag.leaving === 'left' ? 'translate(-420px, 0) rotate(-18deg)' : drag.leaving === 'up' ? 'translate(0, -320px)' : '';
  const tf = off || `translate(${drag.x}px, ${Math.min(0, drag.y)}px) rotate(${drag.x / 18}deg)`;
  const hint = drag.x > 50 ? 'APPROVE' : drag.x < -50 ? 'DEFER' : drag.y < -50 && !counterUsed ? 'COUNTER' : '';

  return (
    <div class="col" style={{ gap: 8 }}>
      <div class="swipe-stack">
        {next && (
          <div class="swipe-card behind" style={{ ['--tint' as string]: ROLE_TINT[next.role] }}>
            <b>{next.title}</b>
          </div>
        )}
        <div
          class="swipe-card"
          style={{
            ['--tint' as string]: ROLE_TINT[top.role],
            transform: tf,
            transition: drag.on ? 'none' : 'transform .22s cubic-bezier(.2,.8,.2,1)',
          }}
          onPointerDown={(e) => {
            if (disabled) return;
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
            setDrag({ x: 0, y: 0, on: true, leaving: '' });
          }}
          onPointerMove={(e) => {
            if (!start.current || start.current.id !== e.pointerId) return;
            setDrag({ x: e.clientX - start.current.x, y: e.clientY - start.current.y, on: true, leaving: '' });
          }}
          onPointerUp={() => {
            const d = drag;
            start.current = null;
            if (d.x > 90) void decide('right');
            else if (d.x < -90) void decide('left');
            else if (d.y < -90 && !counterUsed) void decide('up');
            else setDrag({ x: 0, y: 0, on: false, leaving: '' });
          }}
          onPointerCancel={() => {
            start.current = null;
            setDrag({ x: 0, y: 0, on: false, leaving: '' });
          }}
          role="group"
          aria-label={`Approval card: ${top.title}, ${usd(top.cost)}`}
        >
          <div class="row spread">
            <span class="chip" style={{ background: `${ROLE_TINT[top.role]}55` }}>
              {s.players[top.role]?.name ?? ROLE_LABEL[top.role]} · {ROLE_LABEL[top.role]}
            </span>
            <TierDots tier={top.tier} />
          </div>
          <h2 style={{ fontSize: 22 }}>{top.title}</h2>
          <span class="muted">
            {asset?.name} · health {Math.round(asset?.health ?? 0)}
            {top.parts ? ` · needs ${top.parts} kit` : ''}
          </span>
          <div class="row" style={{ gap: 16, marginTop: 'auto' }}>
            <div class="col" style={{ gap: 0 }}>
              <span class="label">Approve</span>
              <b class="num" style={{ fontSize: 24 }}>{usd(top.cost)}</b>
            </div>
            <div class="col" style={{ gap: 0 }}>
              <span class="label">Expected cost of deferring</span>
              <b class={`num ${exp.cost > top.cost ? 'fault' : ''}`} style={{ fontSize: 24 }}>
                {usd(exp.cost)}
              </b>
              <span class="label num">{Math.round(exp.p * 100)}% incident risk next week</span>
            </div>
          </div>
          {top.pushedBack && <span class="chip ink">Owner pushed back on the cheap fix</span>}
          {hint && (
            <div
              style={{
                position: 'absolute',
                top: 14,
                right: hint === 'APPROVE' ? 14 : undefined,
                left: hint === 'DEFER' ? 14 : hint === 'COUNTER' ? '50%' : undefined,
                transform: hint === 'COUNTER' ? 'translateX(-50%)' : undefined,
                border: `3px solid ${hint === 'APPROVE' ? C.palm : hint === 'DEFER' ? C.rust : C.sea}`,
                color: hint === 'APPROVE' ? C.palm : hint === 'DEFER' ? C.rust : C.sea,
                fontWeight: 900,
                padding: '2px 10px',
                borderRadius: 8,
                rotate: '-8deg',
              }}
            >
              {hint}
            </div>
          )}
        </div>
      </div>
      <div class="swipe-hint">
        <span>← defer</span>
        <span>{counterUsed ? '' : '↑ counter-offer'}</span>
        <span>approve →</span>
      </div>
      <div class="row" style={{ gap: 8 }}>
        <Btn kind="ghost" small block disabled={disabled} onClick={() => decide('left')}>
          Defer
        </Btn>
        <Btn kind="soft" small block disabled={disabled || counterUsed} onClick={() => decide('up')}>
          Counter
        </Btn>
        <Btn small block disabled={disabled} onClick={() => decide('right')}>
          Approve
        </Btn>
      </div>
      <span class="label center">
        {queue.length} waiting · {usd(queue.reduce((n, o) => n + o.cost, 0))} total
      </span>
    </div>
  );
}

// --- pricing ------------------------------------------------------------------

function Curve({ min, max, value, mid, sd, dots, unit, occ, showRevenue }: { min: number; max: number; value: number; mid: number; sd: number; dots: number; unit: string; occ: number; showRevenue: boolean }) {
  const W = 320;
  const H = 110;
  const xs = Array.from({ length: 41 }, (_, i) => min + ((max - min) * i) / 40);
  const occF = (r: number) => logistic(r, mid, sd);
  const rev = xs.map((r) => r * occF(r));
  const maxRev = Math.max(...rev);
  const X = (r: number) => ((r - min) / (max - min)) * W;
  const occPath = xs.map((r, i) => `${i ? 'L' : 'M'}${X(r).toFixed(1)} ${(H - 8 - occF(r) * (H - 20)).toFixed(1)}`).join(' ');
  const revPath = `M0 ${H - 8} ` + xs.map((r, i) => `L${X(r).toFixed(1)} ${(H - 8 - (rev[i] / maxRev) * (H - 28)).toFixed(1)}`).join(' ') + ` L${W} ${H - 8} Z`;
  const filled = Math.round(dots * occ);
  return (
    <div class="demand">
      <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        {showRevenue && <path d={revPath} fill={C.palm} opacity=".16" />}
        <path d={occPath} stroke={C.sea} stroke-width="2.5" fill="none" />
        <line x1={X(value)} x2={X(value)} y1={4} y2={H - 8} stroke={C.ink} stroke-width="2" stroke-dasharray="3 3" />
        <line x1={0} x2={W} y1={H - 8} y2={H - 8} stroke={C.ink} opacity=".2" />
      </svg>
      <div class="row spread" style={{ marginTop: 2 }}>
        <span class="row" style={{ gap: 3 }} aria-label={`${filled} of ${dots} ${unit} filled`}>
          {Array.from({ length: dots }, (_, i) => (
            <i key={i} style={{ width: 12, height: 12, borderRadius: 3, background: i < filled ? C.sea : 'rgba(31,42,48,.12)', display: 'inline-block' }} />
          ))}
        </span>
        <span class="label">
          <span style={{ color: C.sea }}>━ demand</span>
          {showRevenue && (
            <>
              {' · '}
              <span style={{ color: C.palm }}>▇ revenue</span>
            </>
          )}
        </span>
      </div>
    </div>
  );
}

function Pricing({ ctl }: { ctl: Ctl }) {
  const { s } = ctl;
  const [n, setN] = useState(s.rates.nightly);
  const [c, setC] = useState(s.rates.charter);
  useEffect(() => {
    setN(s.rates.nightly);
    setC(s.rates.charter);
  }, [s.rates.nightly, s.rates.charter]);
  const rb = rateBounds(ECON.baseNightly, s.receivership > 0);
  const cb = rateBounds(ECON.baseCharter, s.receivership > 0);
  const occ = occupancy(s, n);
  const load = charterLoad(s, c);
  const proj = projectWeek(s, { nightly: n, charter: c });
  const commit = (nightly: number, charter: number) => ctl.dispatch({ t: 'setRates', nightly, charter });
  const ended = !!s.turns.fin?.ended;
  let lastTick = 0;
  const tick = () => {
    const t = performance.now();
    if (t - lastTick > 40) fx.tick();
    lastTick = t;
  };
  return (
    <div class="card col" style={{ gap: 10 }}>
      <div class="row spread">
        <b>Nightly rate · cottage</b>
        <b class="num">{usd(n)}</b>
      </div>
      <Curve min={rb.min} max={rb.max} value={n} mid={ECON.nightlyMid * season(s.week, s.seed)} sd={ECON.nightlyS} dots={7} unit="nights" occ={occ} showRevenue={s.tier <= 2} />
      <input
        type="range"
        min={rb.min}
        max={rb.max}
        step={5}
        value={n}
        disabled={ended}
        aria-label="Nightly rate"
        onInput={(e) => {
          setN(Number((e.target as HTMLInputElement).value));
          tick();
        }}
        onChange={(e) => commit(Number((e.target as HTMLInputElement).value), c)}
      />
      <span class="label num">
        {Math.round(occ * 100)}% occupancy · {usd(7 * n * occ)} per cottage-week · {proj.booked} of {proj.rentable} houses get guests
      </span>
      <div class="divider" />
      <div class="row spread">
        <b>Charter rate · day tour</b>
        <b class="num">{usd(c)}</b>
      </div>
      <Curve min={cb.min} max={cb.max} value={c} mid={ECON.charterMid * season(s.week, s.seed)} sd={ECON.charterS} dots={6} unit="seats" occ={load} showRevenue={s.tier <= 2} />
      <input
        type="range"
        min={cb.min}
        max={cb.max}
        step={10}
        value={c}
        disabled={ended}
        aria-label="Charter rate"
        onInput={(e) => {
          setC(Number((e.target as HTMLInputElement).value));
          tick();
        }}
        onChange={(e) => commit(n, Number((e.target as HTMLInputElement).value))}
      />
      <span class="label num">
        {Math.round(load * 100)}% load · {proj.spareFlights} spare flight{proj.spareFlights === 1 ? '' : 's'} for tours · capped at 2× base
      </span>
      <div class="row spread" style={{ background: 'var(--sand)', borderRadius: 12, padding: '8px 12px' }}>
        <span class="label">This week at these prices</span>
        <b class="num">
          {usd(proj.rental)} + {usd(proj.charter)} = {usd(proj.revenue)}
        </b>
      </div>
    </div>
  );
}

function Budgets({ ctl }: { ctl: Ctl }) {
  const { s } = ctl;
  const ended = !!s.turns.fin?.ended;
  const room = ECON.maxParts - s.parts.stock - s.parts.inTransit;
  const price = listPrice(s);
  return (
    <div class="card col" style={{ gap: 12 }}>
      {(['mech', 'elec'] as const).map((r) => (
        <BudgetRow key={r} ctl={ctl} role={r} disabled={ended} />
      ))}
      <div class="divider" />
      <div class="row spread">
        <span class="col" style={{ gap: 0 }}>
          <b>Parts kits</b>
          <span class="label num">
            {s.parts.stock} in stock · {s.parts.inTransit} in transit · max {ECON.maxParts}
          </span>
        </span>
        <Btn small kind="soft" disabled={ended || room <= 0} onClick={() => ctl.dispatch({ t: 'buyList' })}>
          <Icon name="box" size={16} /> Buy at list {usd(price)}
        </Btn>
      </div>
      <div class="row" style={{ gap: 4 }}>
        {Array.from({ length: ECON.maxParts }, (_, i) => (
          <i
            key={i}
            style={{
              flex: 1,
              height: 10,
              borderRadius: 4,
              background: i < s.parts.stock ? C.sea : i < s.parts.stock + s.parts.inTransit ? C.fin : 'rgba(31,42,48,.1)',
            }}
          />
        ))}
      </div>
      <span class="label">Auctions beat list price. Kits ride the next {s.assets.some((a) => a.model === 'cargo') ? 'cargo flight (3 per flight)' : 'guest flight (1 per flight)'}.</span>
      <div class="divider" />
      <b>Insurance</b>
      <Seg<Insurance>
        value={s.insurance}
        onChange={(v) => !ended && ctl.dispatch({ t: 'setInsurance', tier: v })}
        options={(Object.keys(INSURANCE) as Insurance[]).map((k) => ({
          v: k,
          label: `${INSURANCE[k].label}${INSURANCE[k].premium ? ` $${Math.round(INSURANCE[k].premium * (1 + 0.25 * (s.tier - 1)))}` : ''}`,
        }))}
      />
      <span class="label">Covers {Math.round(INSURANCE[s.insurance].cover * 100)}% of incident costs. Premium is charged weekly.</span>
    </div>
  );
}

function BudgetRow({ ctl, role, disabled }: { ctl: Ctl; role: 'mech' | 'elec'; disabled: boolean }) {
  const { s } = ctl;
  const [v, setV] = useState(s.autoBudget[role]);
  useEffect(() => setV(s.autoBudget[role]), [s.autoBudget[role]]);
  return (
    <div class="col" style={{ gap: 0 }}>
      <div class="row spread">
        <b>{ROLE_LABEL[role]} auto-approve</b>
        <b class="num">{usd(v)}/wk</b>
      </div>
      <input
        type="range"
        min={0}
        max={s.receivership > 0 ? 300 : budgetCap(s)}
        step={50}
        value={v}
        disabled={disabled}
        aria-label={`${ROLE_LABEL[role]} auto-approve budget`}
        onInput={(e) => setV(Number((e.target as HTMLInputElement).value))}
        onChange={(e) => ctl.dispatch({ t: 'setBudget', role, amount: Number((e.target as HTMLInputElement).value) })}
      />
      <span class="label num">Used {usd(s.autoSpent[role])}. Petty cash for routine, parts-free jobs; bigger work comes to you as cards.</span>
    </div>
  );
}
