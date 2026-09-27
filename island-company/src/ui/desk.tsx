// The analyst's desk: a game, not a form (docs/JOBFLOW.md 17.3). The cash card
// on top, then four tabs: Approvals (the flow cards with their parts, supplier
// and freight; the requests; today's cards; the desk work), Stock (the planner,
// needs, receiving), Money (cash, where it went, the stock card, the budgets,
// pricing, insurance, overhead and payroll) and Staff (the island's payroll:
// package D's hiring desk). Flow cards and requests stay approvable after End turn.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { needsFreight, openChain } from '../sim/chain';
import { ECON, INSURANCE, ROLE_LABEL } from '../sim/data';
import { chainCardCost } from '../sim/engine';
import { charterLoad, downtimeOf, expectedDeferralCost, fixedNow, isAog, logistic, occupancy, openReports, projectWeek, rateBounds, season } from '../sim/econ';
import { committed, spendable } from '../sim/ledger';
import { NPC_ROLES, STAFF } from '../sim/staff';
import { urgentJob } from '../sim/stock';
import type { Insurance, IslandState, Order } from '../sim/types';
import { fx } from './feedback';
import { Btn, Seg, Sheet, TierDots, toast, usd } from './kit';
import { StaffDesk } from './staff/StaffDesk';
import { CapNotice, CoverSection, hasOrigin } from './ops';
import { OrderCard, OrderDetail } from './orders';
import { FlowCards } from './purchasing/ApprovalCard';
import { deskCounts, deskTaskLine, flowQueue, legacyQueue, openingTab, openRoles, payrollLines, reqQueue, type DeskTab } from './purchasing/model';
import { Money } from './purchasing/Money';
import { ReqQueue } from './purchasing/ReqQueue';
import { StockPlanner, type PlannerFocus } from './purchasing/StockPlanner';
import { WhatsNew } from './purchasing/WhatsNew';
import './purchasing/purchasing.css';
import { capNow, openOrders, type DockTarget } from './select';
import { C, ROLE_TINT } from './theme';
import type { Ctl } from './useIsland';

const TAB_KEY = (island: string) => `ic.desk.tab.${island}`;
function savedTab(island: string): DeskTab | null {
  try {
    const v = sessionStorage.getItem(TAB_KEY(island));
    return v === 'approvals' || v === 'stock' || v === 'money' || v === 'staff' ? v : null;
  } catch {
    return null;
  }
}

export function Desk({ ctl, onPlay }: { ctl: Ctl; onPlay(o: Order, cover?: boolean): void }) {
  const { s } = ctl;
  const ended = !!s.turns.fin?.ended;
  const proj = projectWeek(s);
  const delta = s.cash - s.openCash;
  const spend = spendable(s);
  const owed = committed(s);
  // open 'leak' reports cost cash every week until someone fixes them
  const leaks = openReports(s).filter((o) => o.report!.effect === 'leak');
  const leakTotal = leaks.reduce((n, o) => n + o.report!.amount, 0);
  // it opens on Approvals when something waits, else on Stock (the tab chosen this session sticks)
  const [tab, setTabState] = useState<DeskTab>(() => savedTab(ctl.ref.id) ?? openingTab(s));
  // where the tab bar sits in the page: a tab picked while the bar is stuck opens at its top, not mid-page
  const tabTop = useRef<HTMLDivElement>(null);
  const setTab = (t: DeskTab) => {
    setTabState(t);
    try {
      sessionStorage.setItem(TAB_KEY(ctl.ref.id), t);
    } catch {
      /* a private window: the desk opens where it would */
    }
    const a = tabTop.current;
    const bar = a?.nextElementSibling;
    if (a && bar) {
      const stuck = bar.getBoundingClientRect().top;
      const y = a.getBoundingClientRect().top - parseFloat(getComputedStyle(bar).paddingTop);
      if (y < stuck) window.scrollBy({ top: y - stuck });
    }
  };
  const [focus, setFocus] = useState<PlannerFocus | null>(null);
  // the Dock's Next (and anything else) opens the desk's Approvals or Stock (select.ts openTarget)
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<DockTarget>).detail;
      if (d && 'desk' in d) setTab(d.desk === 'stock' ? 'stock' : 'approvals');
    };
    window.addEventListener('ic:open', on);
    return () => window.removeEventListener('ic:open', on);
  }, []);
  const counts = deskCounts(s);
  const tabs: { v: DeskTab; label: string; n?: number; dot?: boolean; alert?: boolean }[] = [
    // the count turns rust when a card or a request is for a job that grounds a plane or closes a house
    { v: 'approvals', label: 'Approvals', n: counts.approvals, alert: flowQueue(s).some((o) => urgentJob(s, o)) || reqQueue(s).some((r) => r.urgent) },
    { v: 'stock', label: 'Stock', dot: counts.stockDot },
    { v: 'money', label: 'Money' },
    { v: 'staff', label: 'Staff', n: counts.staff },
  ];
  return (
    <div class="pdesk col" style={{ gap: 12 }}>
      <div class="card col" style={{ gap: 6, ['--tint' as string]: C.fin }}>
        <div class="row spread">
          <span class="label">Cash</span>
          <span class="label num">{delta === 0 ? 'no change this week' : `${usd(delta, true)} this week`}</span>
        </div>
        <div class="row wrap" style={{ alignItems: 'baseline', gap: '4px 14px' }}>
          <span style={{ fontSize: 40, fontWeight: 900, letterSpacing: '-0.02em', color: s.cash < ECON.freezeBelow ? C.rust : C.ink }}>{usd(s.cash)}</span>
          <span class="col" style={{ gap: 0 }}>
            <span class="label">Spendable</span>
            <b class="num" style={{ fontSize: 18, color: spend < ECON.freezeBelow ? C.rust : C.ink }}>{usd(spend)}</b>
          </span>
          {owed > 0 && (
            <span class="col" style={{ gap: 0 }}>
              <span class="label">Committed</span>
              <b class="num" style={{ fontSize: 18 }}>{usd(owed)}</b>
            </span>
          )}
        </div>
        <div class="row wrap" style={{ gap: 6 }}>
          <span class="chip sea num">Forecast revenue {usd(proj.revenue)}</span>
          <span class={`chip num ${proj.revenue >= proj.budget ? 'palm' : ''}`}>
            {Math.round((proj.revenue / proj.budget) * 100)}% of {usd(proj.budget)} budget
          </span>
          <span class="chip num">Fixed −{usd(fixedNow(s))}</span>
          {leakTotal > 0 && <span class="chip rust num">Open reports −{usd(leakTotal)}/wk</span>}
        </div>
        {leaks.map((o) => (
          <span class="label" key={o.id} style={{ color: C.rust }}>
            <b>{o.title}:</b> <span style={{ whiteSpace: 'nowrap' }}>−{usd(o.report!.amount)}</span> every week until {o.role === 'fin' ? 'you fix it' : `${s.players[o.role]?.name ?? ROLE_LABEL[o.role]} fixes it`}.
          </span>
        ))}
        {spend < ECON.freezeBelow && <span class="fault">Spendable under $2,000: only safety-critical work is approved, and stock orders are frozen.</span>}
        {s.loan && <span class="label">Bridge loan: {usd(s.loan.left)} left · {usd(s.loan.weekly)}/week</span>}
        {s.receivership > 0 && <span class="fault">Receivership · {s.receivership} wk: rates capped, spend over $800 blocked, grade capped at C.</span>}
      </div>

      {s.pendingBonus && <Bonus ctl={ctl} />}

      <div class="pd-anchor" id="approvals" ref={tabTop} />
      <div class="pd-tabs-wrap">
        <nav class="pd-tabs" aria-label="The desk">
          {tabs.map((t) => (
            <button
              key={t.v}
              class={tab === t.v ? 'on' : ''}
              aria-current={tab === t.v}
              onClick={() => {
                fx.tap();
                setTab(t.v);
              }}
            >
              {t.label}
              {t.n ? <span class={`n ${t.alert ? 'alert' : ''}`}>{t.n}</span> : null}
              {t.dot ? <span class="dot" aria-label="needs a look" /> : null}
            </button>
          ))}
        </nav>
      </div>

      {tab === 'approvals' && <ApprovalsTab ctl={ctl} onPlay={onPlay} />}
      {tab === 'stock' && <StockPlanner ctl={ctl} focus={focus} />}
      {tab === 'money' && (
        <Money
          ctl={ctl}
          onFamily={(fam) => {
            setTab('stock');
            setFocus({ fam, n: Date.now() });
          }}
        >
          <h2 style={{ marginTop: 4 }}>Pricing</h2>
          <Pricing ctl={ctl} />
          <h2 style={{ marginTop: 4 }}>Insurance</h2>
          <Insurance ctl={ctl} />
        </Money>
      )}
      {tab === 'staff' && <StaffTab ctl={ctl} />}

      <CoverSection ctl={ctl} role="fin" onPlay={onPlay} />
      <WhatsNew island={ctl.ref.id} since={s.flowSince ?? 1} />
      {ended && <span class="label center">Your turn is over. Cards and requests stay open: approve or defer them any time this week.</span>}
    </div>
  );
}

/** Approvals: the flow cards, the requests, today's cards (legacy orders, the part chain), then the desk work */
function ApprovalsTab({ ctl, onPlay }: { ctl: Ctl; onPlay(o: Order, cover?: boolean): void }) {
  const { s } = ctl;
  const ended = !!s.turns.fin?.ended;
  const tasks = openOrders(s, 'fin');
  // a crewmate hasn't fixed what the analyst reported: fewer desk tasks per turn
  const cap = capNow(s, 'fin');
  // a crewmate's report opens its story first (who reported it and what it costs), with a Start button
  const [sel, setSel] = useState<Order | null>(null);
  const flow = flowQueue(s).length;
  const reqs = reqQueue(s).length;
  const legacy = legacyQueue(s).length;
  const deferred = s.orders.filter((o) => o.flow && o.status === 'pending' && o.lastDeferredWeek === s.week).length;
  return (
    <>
      {flow + reqs + legacy === 0 && (
        <div class="card muted">
          No cards waiting. A job whose parts are on the shelf goes ahead on its trade's work budget; a card that comes in after you end your turn goes through on your standing limit.
          {deferred ? ` ${deferred} deferred to next week.` : ''}
        </div>
      )}
      <FlowCards ctl={ctl} keys={true} />
      <ReqQueue ctl={ctl} />
      {legacy > 0 && (
        <>
          {flow + reqs > 0 && <h3 style={{ marginTop: 4 }}>Other cards</h3>}
          <Approvals ctl={ctl} disabled={ended} keys={flow === 0} />
        </>
      )}

      <h2 style={{ marginTop: 4 }}>Desk work</h2>
      {cap && <CapNotice cap={cap} />}
      {tasks.length === 0 && <div class="card muted">Nothing on the desk.</div>}
      {tasks.map((o) => {
        const line = o.status === 'ready' ? deskTaskLine(s, o) : null;
        return (
          <div key={o.id} class="col" style={{ gap: 4 }}>
            <OrderCard
              s={s}
              o={o}
              me="fin"
              held={ended || !!cap?.full}
              onOpen={(x) => {
                if (hasOrigin(x)) return setSel(x);
                if (x.status !== 'ready' || ended) return;
                if (cap?.full) return toast(cap.text);
                onPlay(x);
              }}
            />
            {line && (
              <span class="label" style={{ padding: '0 8px' }}>
                {line}
              </span>
            )}
          </div>
        );
      })}
      <Sheet open={!!sel} onClose={() => setSel(null)} label="Desk task">
        {sel && (
          <div class="col" style={{ gap: 14 }}>
            <OrderDetail s={s} o={s.orders.find((x) => x.id === sel.id) ?? sel} role="fin" />
            {sel.status === 'ready' && (ended || cap?.full) && (
              <p class="muted" style={{ margin: 0 }}>
                {ended ? 'Your turn is over; this carries to next week.' : cap?.text}
              </p>
            )}
            {sel.status === 'ready' && !ended && !cap?.full && (
              <Btn
                block
                onClick={() => {
                  const o = sel;
                  setSel(null);
                  onPlay(o);
                }}
              >
                Start ▸
              </Btn>
            )}
            <Btn kind="soft" block onClick={() => setSel(null)}>
              Close
            </Btn>
          </div>
        )}
      </Sheet>
    </>
  );
}

/**
 * The Staff tab: package D's hiring desk (StaffDesk). Until it draws something,
 * the crew on the payroll, read-only, so the tab is never empty.
 */
function StaffTab({ ctl }: { ctl: Ctl }) {
  const box = useRef<HTMLDivElement>(null);
  const [empty, setEmpty] = useState(false);
  useLayoutEffect(() => {
    const e = !!box.current && box.current.childElementCount === 0;
    if (e !== empty) setEmpty(e);
  });
  const { s } = ctl;
  const staff = s.staff ?? [];
  const open = openRoles(s);
  const std = STAFF.standard[Math.max(1, Math.min(5, s.tier)) - 1];
  const pay = payrollLines(s);
  // what the week's payroll charges beyond the staff at work (an open post of the standard crew, today)
  const beyond = pay.lines.length > NPC_ROLES.filter((r) => staff.some((n) => n.role === r && n.start <= s.week)).length ? pay.lines[pay.lines.length - 1] : null;
  return (
    <>
      <div ref={box} class="col" style={{ gap: 12 }}>
        <StaffDesk ctl={ctl} />
      </div>
      {empty && (
        <div class="card col" style={{ gap: 8 }}>
          <div class="row spread">
            <h3>The island's staff</h3>
            <b class="num">{usd(pay.total)}/wk</b>
          </div>
          <span class="pd-note">Pilots fly the planes, housekeepers turn the houses over, builders do the site work for new buildings. They're on the island's payroll, and hiring is your call.</span>
          {NPC_ROLES.map((r) => {
            const of = staff.filter((n) => n.role === r);
            return (
              <div key={r} class="col" style={{ gap: 2 }}>
                <span class="label">
                  {r === 'pilot' ? 'Pilots' : r === 'housekeeper' ? 'Housekeepers' : 'Builders'} · {of.length} of the standard {std[r] ?? 0}
                </span>
                {of.map((n) => (
                  <div class="pd-line" key={n.id}>
                    <span>
                      {n.name} <span class="pd-muted">· skill {'●'.repeat(n.skill)}{'○'.repeat(5 - n.skill)}</span>
                    </span>
                    <span class="v">{usd(n.wage)}/wk</span>
                  </div>
                ))}
              </div>
            );
          })}
          {beyond && (
            <div class="pd-line">
              <span>{beyond.label}</span>
              <span class="v">{usd(beyond.usd)}/wk</span>
            </div>
          )}
          {open > 0 && <span class="chip amber" style={{ alignSelf: 'flex-start' }}>{open} short of the standard crew</span>}
          <span class="pd-note">Hiring opens with the staff update.</span>
        </div>
      )}
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

/** today's cards: legacy orders (no job flow) and the part chain's; flow cards are FlowCards' */
function Approvals({ ctl, disabled, keys }: { ctl: Ctl; disabled: boolean; keys: boolean }) {
  const { s } = ctl;
  const queue = legacyQueue(s);
  const top = queue[0];
  const next = queue[1];
  const [drag, setDrag] = useState({ x: 0, y: 0, on: false, leaving: '' as '' | 'left' | 'right' | 'up' });
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  // a grounded plane's part: the AOG boat now, or the guest flight a week later (the analyst's call)
  const [ship, setShip] = useState<'boat' | 'flight'>('boat');
  const chain = top?.chain ? openChain(s) : null;
  const freight = !!chain && chain.stepId === top?.id && top?.chain?.step === 'buy' && needsFreight(s, chain);
  // after End turn a grounded plane's card can still be approved (the plane shouldn't wait on play order)
  const locked = disabled && !top?.chain;
  // each card starts on the boat
  useEffect(() => setShip('boat'), [top?.id]);

  const decide = async (dir: 'left' | 'right' | 'up') => {
    if (!top || locked || (disabled && dir !== 'right')) return;
    fx.swipe();
    setDrag({ x: 0, y: 0, on: false, leaving: dir });
    await new Promise((r) => setTimeout(r, 180));
    const ok =
      dir === 'right'
        ? await ctl.dispatch({ t: 'approve', orderId: top.id, ...(freight ? { ship } : {}) })
        : dir === 'left'
          ? await ctl.dispatch({ t: 'defer', orderId: top.id, reason: s.cash - top.cost < ECON.freezeBelow + 1000 ? 'cash' : 'priority' })
          : await ctl.dispatch({ t: 'counter', orderId: top.id });
    if (ok) dir === 'right' ? fx.snap() : fx.good();
    setDrag({ x: 0, y: 0, on: false, leaving: '' });
  };

  // desktop: ← defer, → approve, ↑ counter (the flow cards take the keys while there are any)
  useEffect(() => {
    if (!keys) return;
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

  if (!top) return null;

  const exp = expectedDeferralCost(s, top);
  const asset = s.assets.find((a) => a.id === top.assetId);
  // what the plane on the ground costs: a guest plane's week of revenue, or the cargo plane's kits by boat
  const down = top.chain && asset ? downtimeOf(s, asset.id) : null;
  const cost = top.chain ? chainCardCost(s, top, freight ? ship : undefined) : top.cost;
  // a part or an engineering fee has no cheaper fix
  const counterUsed = !!top.pushedBack || !!top.chain;
  const off = drag.leaving === 'right' ? 'translate(420px, 0) rotate(18deg)' : drag.leaving === 'left' ? 'translate(-420px, 0) rotate(-18deg)' : drag.leaving === 'up' ? 'translate(0, -320px)' : '';
  const tf = off || `translate(${drag.x}px, ${Math.min(0, drag.y)}px) rotate(${drag.x / 18}deg)`;
  const hint = drag.x > 50 ? 'APPROVE' : drag.x < -50 ? 'DEFER' : drag.y < -50 && !counterUsed ? 'COUNTER' : '';

  return (
    <div class="col" style={{ gap: 8 }}>
      <div class={`swipe-stack ${top.chain ? 'tall' : ''}`}>
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
            if (locked) return;
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
          aria-label={`Approval card: ${top.title}, ${usd(cost)}`}
        >
          <div class="row spread">
            <span class="row" style={{ gap: 6, minWidth: 0 }}>
              <span class="chip" style={{ background: `${ROLE_TINT[top.role]}55` }}>
                {s.players[top.role]?.name ?? ROLE_LABEL[top.role]} · {ROLE_LABEL[top.role]}
              </span>
              {/* a known defect is still in service: the card has no room for the story, the owner's detail has it */}
              {top.repair && <span class="chip ink">Repair</span>}
              {top.chain && <span class="chip rust">AOG</span>}
            </span>
            <span style={{ flex: 'none' }}>
              <TierDots tier={top.tier} />
            </span>
          </div>
          <h2 style={{ fontSize: 22 }}>{top.title}</h2>
          <span class="muted">
            {asset?.name} · health {Math.round(asset?.health ?? 0)}
            {top.parts ? ` · needs ${top.parts} kit` : ''}
          </span>
          <div class="row approve-row" style={{ gap: 16, marginTop: 'auto' }}>
            <div class="col" style={{ gap: 0 }}>
              <span class="label">Approve</span>
              <b class="num" style={{ fontSize: 24 }}>{usd(cost)}</b>
              {/* the freight is on the PO: the analyst sees what the boat adds */}
              {freight && <span class="label num">{ship === 'boat' ? `part ${usd(top.cost)} + boat ${usd(ECON.boatKit)}` : `part ${usd(top.cost)}, no boat`}</span>}
            </div>
            {top.chain && chain?.flow && asset && !isAog(s, asset.id) ? (
              // a part the job flow's research found doesn't ground the plane by itself: its job waits, the plane flies
              <div class="col grow" style={{ gap: 0, minWidth: 0 }}>
                <span class="label">If it waits</span>
                <b style={{ fontSize: 15, lineHeight: 1.2 }}>{s.orders.find((o) => o.id === chain.orderId)?.title ?? 'Its job'} waits a week</b>
                <span class="label wrap-text">{asset.name} flies meanwhile</span>
              </div>
            ) : top.chain ? (
              // a grounded plane's part never rolls an incident: what deferring costs is the plane on the ground
              <div class="col grow" style={{ gap: 0, minWidth: 0 }}>
                <span class="label">If it waits</span>
                <b class="fault" style={{ fontSize: 15, lineHeight: 1.2 }}>
                  {asset?.name ?? 'The plane'} stays grounded
                </b>
                <span class="label wrap-text">
                  {down?.cargo
                    ? `${down.flights} cargo flights/wk off: ${bulkWaiting(s) ? `${bulkWaiting(s)} PO${bulkWaiting(s) > 1 ? 's' : ''} waiting on it` : 'no POs waiting on it now'}`
                    : down
                      ? `${down.flights} flights/wk ≈ ${usd(down.usd)} of revenue lost`
                      : 'no flights until the part is on'}
                  {top.chain.step === 'fee' ? '. Engineering answers a week after it’s paid' : ''}
                </span>
              </div>
            ) : (
              <div class="col" style={{ gap: 0 }}>
                <span class="label">Expected cost of deferring</span>
                <b class={`num ${exp.cost > top.cost ? 'fault' : ''}`} style={{ fontSize: 24 }}>
                  {usd(exp.cost)}
                </b>
                <span class="label num">{Math.round(exp.p * 100)}% incident risk next week</span>
              </div>
            )}
          </div>
          {chain && (chain.spent > 0 || chain.aogWeeks > 0) && (
            <span class="label num">
              This part so far: {usd(chain.spent)} spent · {chain.aogWeeks ? `${chain.aogWeeks} wk down${chain.downtime ? ` (≈ ${usd(chain.downtime)} of downtime)` : ''}` : 'down since this week'}
            </span>
          )}
          {top.repair && <span class="chip rust">Known defect{top.repair.via === 'incident' ? ' · failed in service' : ' · found by an inspection'}</span>}
          {top.squawk && <span class="chip">✎ Written up by {top.squawk}: their call that it needs this</span>}
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
      {freight && (
        <div class="col" style={{ gap: 4 }}>
          <Seg<'boat' | 'flight'>
            value={ship}
            options={[
              { v: 'boat', label: `AOG boat +${usd(ECON.boatKit)}` },
              { v: 'flight', label: 'Guest flight, +1 wk' },
            ]}
            onChange={(v) => setShip(v)}
          />
          <span class="label">
            {down?.cargo
              ? `The cargo plane is the one down. The boat brings it at the resolve; the guest flight carries it free, a week later${bulkWaiting(s) ? ` (the bulk POs waiting meanwhile slip, or come on the AOG boat for a job that grounds its asset)` : ''}.`
              : `The boat brings it at the resolve; the guest flight carries it free, a week later (≈ ${usd(down?.usd ?? 0)} more downtime).`}
          </span>
        </div>
      )}
      <div class="swipe-hint">
        <span>{disabled ? '' : '← defer'}</span>
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
        <Btn small block disabled={locked} onClick={() => decide('right')}>
          Approve
        </Btn>
      </div>
      {disabled && top.chain && <span class="label center">Your turn is over, but a grounded plane's card can still go through.</span>}
      <span class="label center">
        {queue.length} waiting · {usd(queue.reduce((n, o) => n + (o === top ? cost : o.chain ? chainCardCost(s, o, 'boat') : o.cost), 0))} total
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

/** bulk POs due and waiting for a cargo flight */
const bulkWaiting = (s: IslandState) => (s.pos ?? []).filter((p) => (p.status === 'open' || p.status === 'held') && p.carrier === 'bulk' && p.eta <= s.week).length;

function Insurance({ ctl }: { ctl: Ctl }) {
  const { s } = ctl;
  const ended = !!s.turns.fin?.ended;
  return (
    <div class="card col" style={{ gap: 12 }}>
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
