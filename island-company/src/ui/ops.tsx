// Mechanic hangar / electrician cottages: the assets (folded into one chip
// row), the ground power carts, the inbox (the job flow's waiting alerts, the
// other work, what closed), covering, and the job flow's sheets.
import { useState } from 'preact/hooks';
import { ECON, MODELS } from '../sim/data';
import { isChainStep } from '../sim/chain';
import { soleGuest } from '../sim/alerts';
import { chainAog, gseForStart, hangarJobs, hazardOn, houseBlocker, isAog, isTagged, orderCost, orderTier, planeCapacity, powered, startCart, SUB_FEE, subCharterOn } from '../sim/econ';
import { squawkable } from '../sim/engine';
import { installCheck } from '../sim/flow';
import type { Asset, IslandState, Order, Role } from '../sim/types';
import { FlowHost } from './flow/FlowHost';
import { Inbox } from './flow/Inbox';
import { local } from './flow/words';
import { GroundPowerCard } from './gse';
import { Btn, Health, Icon, Sheet, TierDots, toast, usd } from './kit';
import { hasManual, ManualSection } from './manual';
import { OrderCard, OrderDetail } from './orders';
import { capNow, healthMarks } from './select';
import type { Ctl } from './useIsland';

export function OpsPanel({ ctl, role, onPlay, onGse }: { ctl: Ctl; role: 'mech' | 'elec'; onPlay(o: Order, cover?: boolean): void; /** open the ground power sheet (on one cart) */ onGse?(cart: string | null): void }) {
  const { s } = ctl;
  const [sel, setSel] = useState<Order | null>(null);
  const [writeUp, setWriteUp] = useState<Asset | null>(null);
  const foldKey = `ic.jf.assets.${role}`;
  const [assetsOpen, setAssetsOpen] = useState(() => local.get(foldKey) === '1');
  const turn = s.turns[role];
  const canWrite = s.week >= 1 && !turn?.ended && s.squawked?.[role] !== s.week;
  const pw = powered(s);
  // grid down: one hangar job a turn (the part chain's paperwork needs no hangar tools, so it never counts or waits)
  const gridCapped = role === 'mech' && pw.gridDown && !!turn && hangarJobs(turn) >= 1;
  // a crewmate hasn't fixed what this seat reported: fewer jobs per turn
  const cap = capNow(s, role);
  const cappedFor = (o: Order) => !!cap?.full || (gridCapped && !isChainStep(o));

  // a repair, a redo or a crewmate's report opens its story first (why it exists), with a Start button;
  // a job on a plane opens its manual (the task card) first; a ground power start with no charged
  // cart hooked up opens its card first: it says what's missing
  const open = (o: Order) => {
    if (o.status === 'ready' && !turn?.ended && !cappedFor(o) && !hasOrigin(o) && !hasManual(s, o) && !gseForStart(s, o).blocker) onPlay(o);
    else setSel(o);
  };

  const heldWhy = (o: Order): string | null =>
    cappedFor(o) ? (gridCapped && !isChainStep(o) ? 'Grid down: hangar tools offline, 1 hangar job this week.' : (cap?.text ?? 'You’ve hit this turn’s job limit.')) : null;
  const toggleAssets = () => {
    local.set(foldKey, assetsOpen ? '0' : '1');
    setAssetsOpen(!assetsOpen);
  };

  return (
    <>
      <div class="card col" style={{ gap: 4 }}>
        <button class="jf-fold" aria-expanded={assetsOpen} onClick={toggleAssets}>
          <span class="col grow" style={{ gap: 4, minWidth: 0 }}>
            <h3>{role === 'mech' ? 'Hangar + airstrip' : 'Cottages + grid'}</h3>
            <AssetChips s={s} role={role} />
          </span>
          <span class="jf-fold-caret" aria-hidden="true">
            {assetsOpen ? '▴' : '▾'}
          </span>
        </button>
        {assetsOpen && role === 'mech' &&
          s.assets
            .filter((a) => a.kind === 'plane')
            .map((p) => {
              const aog = isAog(s, p.id);
              const cap = aog ? 0 : planeCapacity(p, s.tier, s.weather);
              const grounded = !!s.tags?.[p.id];
              // the only guest plane down: the mainland sub-charter flies its guests (grounding it by the safety call too)
              const sub = subCharterOn(s);
              const subbed = sub?.plane.id === p.id;
              return (
                <div class="asset" key={p.id} style={{ gridTemplateColumns: '26px 1fr auto auto' }}>
                  <Icon name="plane" size={22} />
                  <button class="asset-tap" onClick={() => setWriteUp(p)} aria-label={`${p.name}: details and write-up`}>
                    <Health value={p.health} label={`${p.name} · ${MODELS[p.model].label}`} marks={healthMarks(s, p)} />
                  </button>
                  <span class="col" style={{ gap: 0, alignItems: 'flex-end' }}>
                    <b class={`num ${cap === 0 && !grounded ? 'fault' : ''}`}>{grounded ? 'GND' : cap === 0 ? 'AOG' : `${cap} fl`}</b>
                    {/* short in the column (a 360 px phone): why it's down; the sub-charter gets its own line below the row */}
                    {aog && !subbed && <span class="label fault">{chainAog(s, p.id) ? 'for a part' : 'past due'}</span>}
                    <span class="label num">{p.sinceInspection ?? 0}/{ECON.planeInspectionFlights} insp</span>
                  </span>
                  <SafetyCall ctl={ctl} role={role} id={p.id} on={grounded} word="Ground" sub={soleGuest(s, p.id)} />
                  {subbed && (
                    <span class="label fault asset-note">
                      Its guests fly in on a mainland sub-charter{sub!.flights ? ` (${sub!.flights} × $${sub!.fee} this week)` : ''} until it's back in service.
                    </span>
                  )}
                </div>
              );
            })}
        {assetsOpen && role === 'elec' &&
          s.assets
            .filter((a) => a.kind !== 'plane')
            .map((h) => {
              const why = h.kind === 'house' ? houseBlocker(s, h) : null;
              const label =
                h.kind === 'grid' ? `${h.name} · ${pw.gridDown ? 'DOWN' : 'live'}` : h.kind === 'generator' ? `${h.name} · ${h.health >= 50 ? 'ready' : 'unreliable'}` : `${h.name}`;
              const tagged = !!s.tags?.[h.id];
              return (
                <div class="asset" key={h.id} style={{ gridTemplateColumns: '26px 1fr auto auto' }}>
                  <Icon name={h.kind === 'house' ? 'house' : 'bolt'} size={22} />
                  <button class="asset-tap" onClick={() => setWriteUp(h)} aria-label={`${h.name}: details and write-up`}>
                    <Health value={h.health} label={label} marks={healthMarks(s, h)} />
                  </button>
                  <span class="col" style={{ gap: 0, alignItems: 'flex-end' }}>
                    {h.kind === 'house' ? (
                      <>
                        <b class={why ? 'fault' : ''} style={{ fontSize: 13 }}>
                          {why ? '⚠ closed' : 'rentable'}
                        </b>
                        <span class="label num">insp wk {h.inspectionUntil}</span>
                      </>
                    ) : (
                      <span class="label">{h.kind === 'grid' ? 'feeds all' : 'backup'}</span>
                    )}
                  </span>
                  {h.kind === 'grid' ? <span /> : <SafetyCall ctl={ctl} role={role} id={h.id} on={tagged} word="Red-tag" />}
                </div>
              );
            })}
      </div>

      <GroundPowerCard ctl={ctl} role={role} onOpen={(id) => onGse?.(id)} />

      <span class="label" style={{ padding: '0 4px' }}>
        {canWrite ? 'Open the list and tap an asset to write up what it needs (1 write-up a week): it comes back as an alert with its task filled in.' : s.squawked?.[role] === s.week ? 'Write-up done this week.' : ''}
      </span>

      {gridCapped && (
        <div class="card" style={{ borderLeft: '6px solid var(--rust)' }}>
          <b class="fault">Grid down:</b> hangar tools offline, 1 hangar job max this week (the part chain's paperwork still goes through).
        </div>
      )}
      {cap && <CapNotice cap={cap} />}

      <Inbox ctl={ctl} role={role} onOrder={open} held={cappedFor} />

      <CoverSection ctl={ctl} role={role} onPlay={onPlay} />

      <FlowHost ctl={ctl} role={role} onPlay={onPlay} onOrder={open} heldWhy={heldWhy} />

      <Sheet open={!!writeUp} onClose={() => setWriteUp(null)} label="Write up">
        {writeUp && <WriteUp ctl={ctl} role={role} asset={writeUp} can={canWrite} onDone={() => setWriteUp(null)} />}
      </Sheet>

      <Sheet open={!!sel} onClose={() => setSel(null)} label="Order">
        {sel && (
          <div class="col" style={{ gap: 14 }}>
            <OrderDetail s={s} o={s.orders.find((x) => x.id === sel.id) ?? sel} role={role} />
            {sel.status === 'countered' && sel.counter && (
              <>
                <div class="card" style={{ background: 'var(--sand)' }}>
                  Analyst offers a patch: <b class="num">{usd(sel.counter.cost)}</b> instead of <span class="num">{usd(sel.cost)}</span>, restores{' '}
                  <b>+{sel.counter.gain}</b> instead of +{sel.gain}.
                </div>
                <div class="row" style={{ gap: 8 }}>
                  <Btn
                    kind="ghost"
                    block
                    onClick={async () => {
                      await ctl.dispatch({ t: 'rejectCounter', orderId: sel.id });
                      setSel(null);
                    }}
                  >
                    Push back
                  </Btn>
                  <Btn
                    block
                    onClick={async () => {
                      await ctl.dispatch({ t: 'acceptCounter', orderId: sel.id });
                      setSel(null);
                    }}
                  >
                    Accept
                  </Btn>
                </div>
              </>
            )}
            {sel.status === 'ready' && (turn?.ended || cappedFor(sel)) && (
              <p class="muted" style={{ margin: 0 }}>
                {turn?.ended ? 'Your turn is over; this carries to next week.' : gridCapped ? 'Hangar tools offline until the grid is back.' : cap?.text}
              </p>
            )}
            {sel.kind === 'gpustart' && sel.status === 'ready' && gseForStart(s, sel).blocker && (
              <Btn
                kind="soft"
                block
                onClick={() => {
                  setSel(null);
                  onGse?.(gseForStart(s, sel).cart?.id ?? startCart(s, sel.assetId)?.id ?? null);
                }}
              >
                <Icon name="bolt" size={18} /> Ground power carts ▸
              </Btn>
            )}
            {sel.status === 'ready' && sel.role === role && !turn?.ended && !cappedFor(sel) && !gseForStart(s, sel).blocker && (
              <Btn
                block
                onClick={() => {
                  const o = sel;
                  setSel(null);
                  onPlay(o);
                }}
              >
                Start the job ▸
              </Btn>
            )}
            {/* the task card: read it before the job (the puzzle works to its numbers) */}
            {sel.status !== 'done' && sel.status !== 'cancelled' && <ManualSection s={s} o={s.orders.find((x) => x.id === sel.id) ?? sel} />}
            <Btn kind="soft" block onClick={() => setSel(null)}>
              Close
            </Btn>
          </div>
        )}
      </Sheet>
    </>
  );
}

/** The assets in one chip row: what's down, placarded, made safe or shut (a tap on the row opens today's list). */
function AssetChips({ s, role }: { s: IslandState; role: 'mech' | 'elec' }) {
  const chips: { text: string; tone?: string }[] = [];
  if (role === 'mech') {
    const planes = s.assets.filter((a) => a.kind === 'plane');
    const aog = planes.filter((p) => isAog(s, p.id)).length;
    const gnd = planes.filter((p) => isTagged(s, p.id)).length;
    // the only guest plane on the ground: a mainland sub-charter flies the guests this week
    const sub = subCharterOn(s);
    const mel = (s.alerts ?? []).filter((a) => a.status !== 'closed' && a.mel && a.mel.until >= s.week).length;
    const low = planes.filter((p) => p.health < 40).length;
    chips.push({ text: `${planes.length} plane${planes.length === 1 ? '' : 's'}` });
    if (aog) chips.push({ text: `AOG ${aog}`, tone: 'rust' });
    if (gnd) chips.push({ text: `GND ${gnd}`, tone: 'rust' });
    if (sub) chips.push({ text: sub.flights ? `sub-charter ${sub.flights} × $${sub.fee}` : 'sub-charter', tone: 'rust' });
    if (mel) chips.push({ text: `MEL ${mel}`, tone: 'sea' });
    if (low) chips.push({ text: `under 40: ${low}`, tone: 'rust' });
  } else {
    const houses = s.assets.filter((a) => a.kind === 'house');
    const shut = houses.filter((h) => !!houseBlocker(s, h)).length;
    const safe = houses.filter((h) => hazardOn(s, h.id)?.safe).length;
    const tagged = s.assets.filter((a) => a.kind !== 'plane' && isTagged(s, a.id)).length;
    chips.push({ text: `${houses.length} house${houses.length === 1 ? '' : 's'}` });
    if (shut) chips.push({ text: `closed ${shut}`, tone: 'rust' });
    if (safe) chips.push({ text: `SAFE ${safe}`, tone: 'palm' });
    if (tagged) chips.push({ text: `red-tag ${tagged}`, tone: 'rust' });
    if (powered(s).gridDown) chips.push({ text: 'grid down', tone: 'rust' });
  }
  const pos = (s.pos ?? []).filter((p) => p.status === 'open' || p.status === 'held').length;
  if (pos) chips.push({ text: `${pos} PO${pos > 1 ? 's' : ''} open` });
  return (
    <span class="row wrap" style={{ gap: 4 }}>
      {chips.map((c) => (
        <span key={c.text} class={`jf-flag ${c.tone ?? ''}`}>
          {c.text}
        </span>
      ))}
    </span>
  );
}

/** Orders whose detail explains why they exist: open it before the puzzle. */
export const hasOrigin = (o: Order) => !!(o.repair || o.redo || o.report || o.chain);

/** A crewmate's unfixed report holds this seat to fewer jobs: say so before a puzzle is wasted. */
export function CapNotice({ cap }: { cap: NonNullable<ReturnType<typeof capNow>> }) {
  const [head, ...rest] = cap.text.split(': ');
  return (
    <div class="card col" style={{ gap: 2, borderLeft: '6px solid var(--rust)' }}>
      <span>
        <b class="fault">{head}:</b> {rest.join(': ')}
      </span>
      <span class="label num">
        {cap.full ? 'Used up this turn. Lend a hand still works.' : `${cap.done} of ${cap.limit} used this turn.`}
      </span>
    </div>
  );
}

/** Squawk: the trade judges what an asset needs and writes it up. Knowing which job fits is the skill. */
function WriteUp({ ctl, role, asset, can, onDone }: { ctl: Ctl; role: Role; asset: Asset; can: boolean; onDone(): void }) {
  const { s } = ctl;
  const a = s.assets.find((x) => x.id === asset.id) ?? asset;
  const openKinds = new Set(s.orders.filter((o) => o.assetId === a.id && o.status !== 'done' && o.status !== 'cancelled').map((o) => o.kind));
  const jobs = squawkable(role, a);
  return (
    <div class="col" style={{ gap: 10 }}>
      <h2>{a.name}</h2>
      <span class="muted">
        Health {Math.round(a.health)}
        {a.kind === 'plane' ? ` · ${a.sinceInspection ?? 0}/${ECON.planeInspectionFlights} flights since inspection` : ''}
        {a.kind === 'house' ? ` · inspection good to week ${a.inspectionUntil}` : ''}
      </span>
      <span class="label">{can ? 'Write up one job this week. Paperwork is automatic; this is for work you judge it needs.' : 'You’ve written up this week’s squawk (or your turn is over).'}</span>
      {jobs.map((c) => {
        const tier = orderTier(c.kind, a, s.tier);
        const cost = orderCost(c.kind, tier);
        const already = openKinds.has(c.kind);
        return (
          <div class="card row" key={c.kind} style={{ gap: 10 }}>
            <span class="col grow" style={{ gap: 2 }}>
              <b>{c.title}</b>
              <span class="row wrap label" style={{ gap: 6 }}>
                <TierDots tier={tier} /> {cost ? usd(cost) : 'no cost'}
                {c.parts ? ' + parts' : ''} · +{c.gain}
              </span>
            </span>
            <Btn
              small
              kind={already ? 'ghost' : 'soft'}
              disabled={!can || already}
              onClick={async () => {
                if (await ctl.dispatch({ t: 'squawk', role, assetId: a.id, kind: c.kind })) onDone();
              }}
            >
              {already ? 'Open' : 'Write up'}
            </Btn>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Safety call: ground a plane / red-tag a house for this week. Out of service = no flights or guests, but nothing can
 * fail in service. `sub`: the only guest plane, whose guests a mainland sub-charter flies while it's grounded (at a price)
 */
function SafetyCall({ ctl, role, id, on, word, sub }: { ctl: Ctl; role: Role; id: string; on: boolean; word: string; sub?: boolean }) {
  const ended = !!ctl.s.turns[role]?.ended;
  return (
    <button
      class={`chip ${on ? 'rust' : ''}`}
      style={{ border: 0, minHeight: 34, minWidth: 64, justifyContent: 'center' }}
      disabled={ended || ctl.s.week < 1}
      aria-pressed={on}
      title={on ? 'Return to service' : sub ? `${word} for this week: a mainland sub-charter flies the guests at $${SUB_FEE} a flight, and no in-service failures` : `${word} for this week: no flights/guests, but no in-service failures`}
      onClick={() => void ctl.dispatch({ t: 'tag', role, assetId: id, on: !on })}
    >
      {on ? '↺ Undo' : word}
    </button>
  );
}

/** Lend a hand: one try per week at another trade's job. Real know-how is the gate. */
export function CoverSection({ ctl, role, onPlay }: { ctl: Ctl; role: Role; onPlay(o: Order, cover?: boolean): void }) {
  const { s } = ctl;
  const me = s.players[role];
  if (!me || s.week < 1 || s.turns[role]?.ended) return null;
  const allowance = 1;
  const used = s.coversUsed[role] ?? 0;
  // only jobs that have already waited a week: it relieves gridlock, it doesn't steal work.
  // Never your own report: the trade you reported it to has to fix it (the third trade can help)
  const orders = s.orders.filter((o) => o.role !== role && o.status === 'ready' && o.deferrals >= 1 && o.report?.by !== role);
  if (!orders.length) return null;
  return (
    <div class="card col" style={{ gap: 8 }}>
      <div class="row spread">
        <h3>Lend a hand</h3>
        <span class="label num">
          {Math.max(0, allowance - used)}/{allowance} left this week
        </span>
      </div>
      <span class="label">
        A job that's waited a week? Try it at expert level, no hints. Your tools stay home, and under 60% botches it: the asset takes −6 and the job stays open.
      </span>
      {used < allowance &&
        orders
          .sort((a, b) => b.deferrals - a.deferrals || b.tier - a.tier)
          .slice(0, 3)
          .map((o) => (
            <OrderCard
              key={o.id}
              s={s}
              o={o}
              onOpen={() => {
                // a job-flow job runs its install check first, for whoever starts it
                const stop = o.flow ? installCheck(s, o) : null;
                if (stop) return void toast(`At the start: ${stop.stop}`);
                onPlay(o, true);
              }}
            />
          ))}
      {used >= allowance && <span class="muted">You already lent a hand this week.</span>}
      <span class="label">Only if you actually know the trade.</span>
    </div>
  );
}
