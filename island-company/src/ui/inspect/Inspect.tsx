// The inspect sheet's body (docs/EXPANSION.md 6.2, 6.3; package C): what a tap
// on anything on the island opens. InspectSheet.tsx (the contract's component,
// mounted by home.tsx in a <Sheet>) loads it as a chunk of its own, fetched when
// the phone is idle after the first paint; a ground power cart's ref opens the
// cart sheet (gse.tsx) inside it, unchanged.
//
// - The header: the object's name and where it is, one status line in the seat's
//   words, a health bar for assets, and its open alerts by trade.
// - Then the seat's own section: what this seat cares about there (facts.ts), its
//   records (a plane's logbook, a panel schedule), and its moves, each a deep link
//   into an existing flow (the alert's job sheet, the cart sheet, Stores, the desk)
//   or an existing move (ground / red-tag, approve, the nightly rate, hire).
// - Then Report a problem (Report.tsx).
// - One primary action at the bottom: the seat's quick check for a tech (the
//   walkaround, the IR scan or the meter check: Walkaround.tsx, IrScan.tsx,
//   MeterCheck.tsx), the object's own money move for the analyst.
//
// It never shows hidden state: no alert cause, no defect, no quick check's truth.
// A check's call is blind: "written up, it's on your list", never right or wrong.
// Esc closes it; every move is a button, so Tab reaches them all.
import { useEffect, useRef, useState } from 'preact/hooks';
import { CHECK_ROWS, checkRowKey } from '../../sim/checkdata';
import { checkView } from '../../sim/checks';
import type { IslandState, OpsRole, Role } from '../../sim/types';
import { fx } from '../feedback';
import { openStores } from '../flow/FlowHost';
import { GseSheet } from '../gse';
import { Btn, Health, Icon, toast } from '../kit';
import { ASSET_KINDS, type ObjectRef } from '../objects';
import { WriteUp, SafetyCall } from '../ops';
import { healthMarks, openTarget } from '../select';
import { C, ROLE_TINT } from '../theme';
import type { Ctl } from '../useIsland';
import { facts, type Act, type Block, type Facts } from './facts';
import { KindBadge } from './fixtures';
import { CartsBlock } from './hangar';
import { RatesStepper } from './house';
import { IrScan } from './IrScan';
import { MeterCheck } from './MeterCheck';
import { StatsBlock } from './office';
import { BuildCard, HireCard, LetGoCard, PersonBlock, ProjectBlock } from './people';
import { LogBlock, PlateBlock } from './plane';
import { Schedule } from './power';
import { DmButton, Report } from './Report';
import { Walkaround } from './Walkaround';
import { RenoCard } from '../staff/Reno';
import './inspect.css';

type Mode = { t: 'info' } | { t: 'check'; week: number } | { t: 'writeUp'; assetId: string } | { t: 'gse'; cart: string | null };

const CHECK_WORD = { walkaround: 'Walkaround', ir: 'IR scan', meter: 'Meter check' } as const;
/** the records (a data plate, the logbook, a schedule) come after the seat's moves */
const RECORD = new Set<Block['t']>(['plate', 'log', 'schedule']);
/** a person's week and the office's numbers come first, above the lines */
const TOP = new Set<Block['t']>(['person', 'stats']);

export type InspectProps = { s: IslandState; ctl: Ctl; role: Role; target: ObjectRef; onClose: () => void };

export function InspectBody({ s, ctl, role, target, onClose }: InspectProps) {
  // a new target (openTarget({ object }) while the sheet is open) starts fresh
  return <Inspect key={`${target.kind}:${target.id}:${target.st}`} s={s} ctl={ctl} role={role} target={target} onClose={onClose} />;
}

function Inspect({ s, ctl, role, target, onClose }: { s: IslandState; ctl: Ctl; role: Role; target: ObjectRef; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>({ t: 'info' });
  const [did, setDid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // Esc closes the sheet (the Sheet itself only closes on its scrim)
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // handled: the app's Esc (app.tsx) must not close Explore under it too (review round 1)
      e.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  // the keyboard starts inside the sheet
  useEffect(() => {
    box.current?.focus?.();
  }, []);
  // a check, a write-up or the carts open at their top, and so does the sheet coming back from one
  useEffect(() => {
    (box.current?.closest?.('.sheet') as HTMLElement | null | undefined)?.scrollTo?.({ top: 0 });
  }, [mode.t]);
  // the week closed under an open check: its readings were last week's, so it closes with a word (review round 1: it
  // re-rendered with the next week's readings, the pick still set)
  useEffect(() => {
    if (mode.t === 'check' && mode.week !== s.week) {
      setMode({ t: 'info' });
      setDid(`The week closed before your call: nothing was written up. This week's check is open.`);
    }
  }, [s.week]);

  // a cart's ref is the ground power sheet, unchanged; the other seats get the cart's report job and a word to the mechanic
  if (target.kind === 'cart') {
    const cf = role === 'mech' ? null : facts(s, target, role);
    // (above the cart sheet, whose own Close stays last)
    return (
      <div class="col insp" ref={box} tabIndex={-1}>
        {cf && cf.actions.length > 0 && (
          <div class="insp-acts">
            {cf.actions.map((a, i) => (
              <ActView key={i} a={a} ctl={ctl} role={role} run={(x) => act(x, { ctl, role, onClose, setMode })} />
            ))}
          </div>
        )}
        {cf && <Report s={s} ctl={ctl} role={role} report={cf.report} onWriteUp={() => undefined} />}
        <GseSheet ctl={ctl} focus={target.id || null} onClose={onClose} />
      </div>
    );
  }
  if (mode.t === 'gse')
    return (
      <div class="col insp" ref={box} tabIndex={-1}>
        <BackTo label={facts(s, target, role).name} onBack={() => setMode({ t: 'info' })} />
        <GseSheet ctl={ctl} focus={mode.cart} onClose={() => setMode({ t: 'info' })} />
      </div>
    );

  const f = facts(s, target, role);
  const asset = s.assets.find((a) => a.id === target.id && a.kind === target.kind);

  if (mode.t === 'writeUp' && asset)
    return (
      <div class="col insp" ref={box} tabIndex={-1}>
        <BackTo label={f.name} onBack={() => setMode({ t: 'info' })} />
        <WriteUp ctl={ctl} role={role} asset={asset} can={f.report?.t === 'own' && f.report.ok} onDone={() => setMode({ t: 'info' })} />
      </div>
    );

  if (mode.t === 'check' && mode.week === s.week && asset && role !== 'fin') {
    const view = checkView(s, role as OpsRole, asset.id);
    if (view) {
      const call = async (item: string | null) => {
        setBusy(true);
        const ok = await ctl.dispatch({ t: 'check', role: role as OpsRole, assetId: asset.id, item, week: s.week });
        setBusy(false);
        if (!ok) return;
        fx.tap();
        const word = CHECK_WORD[view.kind];
        // the write-up's own words, as the feed and the review say them ("the kitchen counter A circuit")
        const label = item ? (CHECK_ROWS[checkRowKey(view.kind, item)]?.word ?? view.items.find((i) => i.id === item)?.label) : undefined;
        // blind: the words never say whether the call was right (Investigate shows what it is)
        setDid(
          item
            ? `${word} done: you wrote up the ${label}. It's on your alert list; a closer look at Investigate shows what it is.`
            : `${word} done: ${view.kind === 'walkaround' ? 'all serviceable' : 'all normal'}. Nothing written up.`,
        );
        toast(item ? `Written up: the ${label}. It's on your list.` : `${word}: noted.`);
        setMode({ t: 'info' });
      };
      return (
        <div class="col insp" ref={box} tabIndex={-1} aria-label={`${CHECK_WORD[view.kind]} of ${asset.name}`}>
          <BackTo label={f.name} onBack={() => setMode({ t: 'info' })} />
          <h2 style={{ margin: 0 }}>
            {CHECK_WORD[view.kind]} · {asset.name}
          </h2>
          {view.kind === 'walkaround' && <Walkaround a={asset} view={view} busy={busy} onCall={call} />}
          {view.kind === 'ir' && <IrScan s={s} a={asset} view={view} busy={busy} onCall={call} />}
          {view.kind === 'meter' && <MeterCheck a={asset} view={view} busy={busy} onCall={call} />}
        </div>
      );
    }
  }

  const run = (a: Act) => act(a, { ctl, role, onClose, setMode });
  return (
    <div class="col insp" ref={box} tabIndex={-1}>
      <Header s={s} f={f} kind={target.kind} onClose={onClose} />
      {did && (
        <div class="insp-done" role="status">
          <Icon name="check" size={18} color={C.palm} />
          <span>{did}</span>
        </div>
      )}
      {f.blocks.filter((b) => TOP.has(b.t)).map((b, i) => (
        <BlockView key={`t${b.t}${i}`} b={b} />
      ))}
      {f.lines.length > 0 && (
        <ul class="insp-lines">
          {f.lines.map((l, i) => (
            <li key={i} class={l.tone ?? ''}>
              {l.text}
            </li>
          ))}
        </ul>
      )}
      {/* the carts and the crew project under the lines; then the moves; then the records */}
      {f.blocks.filter((b) => !RECORD.has(b.t) && !TOP.has(b.t)).map((b, i) => (
        <BlockView key={`${b.t}${i}`} b={b} />
      ))}
      {f.primary?.t === 'hire' && <HireCard ctl={ctl} a={f.primary} onDone={() => undefined} />}
      {f.primary?.t === 'build' && <BuildCard ctl={ctl} a={f.primary} />}
      {f.actions.length > 0 && (
        <div class="insp-acts">
          {f.actions.map((a, i) => (
            <ActView key={i} a={a} ctl={ctl} role={role} run={run} />
          ))}
        </div>
      )}
      {f.blocks.filter((b) => RECORD.has(b.t)).map((b, i) => (
        <BlockView key={`r${b.t}${i}`} b={b} />
      ))}
      <Report s={s} ctl={ctl} role={role} report={f.report} onWriteUp={(id) => setMode({ t: 'writeUp', assetId: id })} />
      <Primary f={f} ctl={ctl} run={run} onCheck={() => setMode({ t: 'check', week: s.week })} />
    </div>
  );
}

function BackTo({ label, onBack }: { label: string; onBack(): void }) {
  return (
    <button class="qc-back" onClick={onBack}>
      ◂ {label}
    </button>
  );
}

function Header({ s, f, kind, onClose }: { s: IslandState; f: Facts; kind: ObjectRef['kind']; onClose(): void }) {
  const al = f.alerts;
  return (
    <>
      <div class="insp-head">
        <KindBadge kind={kind} />
        <span class="col grow" style={{ gap: 2 }}>
          <h2>{f.name}</h2>
          <span class="label">{f.where}</span>
        </span>
        <button class="insp-x" aria-label="Close" onClick={onClose}>
          <Icon name="x" size={20} />
        </button>
      </div>
      <span class={`insp-status ${f.tone ?? ''}`}>{f.status}</span>
      {/* the same tick marks as the asset lists' bars (stage 1: the late game's thresholds) */}
      {f.health && <Health value={f.health.value} label={f.health.label} marks={ASSET_KINDS.includes(kind) ? healthMarks(s, { kind: kind as 'plane' | 'house' | 'grid' | 'generator' }) : undefined} />}
      {al && al.mech + al.elec > 0 && (
        <div class="insp-chips" aria-label="Open alerts by trade">
          {(['mech', 'elec'] as OpsRole[])
            .filter((r) => al[r] > 0)
            .map((r) => (
              <span key={r} class="insp-chip">
                <i style={{ background: ROLE_TINT[r] }}>{al[r]}</i>
                open · {s.players[r]?.name ?? (r === 'mech' ? 'mechanic' : 'electrician')}
              </span>
            ))}
        </div>
      )}
    </>
  );
}

function BlockView({ b }: { b: Block }) {
  switch (b.t) {
    case 'plate':
      return <PlateBlock b={b} />;
    case 'log':
      return <LogBlock b={b} />;
    case 'schedule':
      return <Schedule b={b} />;
    case 'person':
      return <PersonBlock b={b} />;
    case 'project':
      return <ProjectBlock b={b} />;
    case 'carts':
      return <CartsBlock b={b} />;
    case 'stats':
      return <StatsBlock b={b} />;
  }
}

type Run = (a: Act) => void;

/** what a deep link or a move does from the sheet */
function act(a: Act, x: { ctl: Ctl; role: Role; onClose(): void; setMode(m: Mode): void }) {
  switch (a.t) {
    case 'alert':
      x.onClose();
      openTarget({ alert: a.alert });
      return;
    case 'order':
      x.onClose();
      openTarget({ order: a.order });
      return;
    case 'gse':
      x.setMode({ t: 'gse', cart: a.cart });
      return;
    case 'stores':
      x.onClose();
      openStores();
      return;
    case 'desk':
      x.onClose();
      openTarget({ desk: a.desk, ...(a.at ? { at: a.at } : {}) });
      // the desk sits below Home's map on a phone: bring its tabs into view (a section asked for: the desk scrolls to it)
      if (!a.at) requestAnimationFrame(() => document.getElementById('approvals')?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }));
      return;
    case 'approve':
      void x.ctl.dispatch({ t: 'approve', orderId: a.order }).then((ok) => {
        if (ok) {
          fx.snap();
          toast(`${a.label.replace(/^Approve /, 'Approved ')}.`);
        }
      });
      return;
    case 'buy':
      void x.ctl.dispatch({ t: 'buy', lines: a.lines, buy: { vendor: 'yard' } }).then((ok) => ok && toast(`Ordered from the yard (${a.label.split('· ')[1] ?? ''}): on the supply boat.`));
      return;
    case 'writeUp':
      x.setMode({ t: 'writeUp', assetId: a.assetId });
      return;
    case 'object':
      // (a new target starts the sheet fresh: InspectBody's key)
      openTarget({ object: a.ref });
      return;
    default:
      return;
  }
}

/** a secondary move's row */
function ActView({ a, ctl, role, run }: { a: Act; ctl: Ctl; role: Role; run: Run }) {
  switch (a.t) {
    case 'tag':
      return (
        <div class="insp-tag">
          <span>{a.text}</span>
          <SafetyCall ctl={ctl} role={role} id={a.assetId} on={a.on} word={a.word} sub={a.sub} />
        </div>
      );
    case 'dm':
      return <DmButton a={a} />;
    case 'letGo':
      return <LetGoCard ctl={ctl} a={a} onDone={() => undefined} />;
    case 'build':
      return <BuildCard ctl={ctl} a={a} />;
    case 'hire':
      return <HireCard ctl={ctl} a={a} onDone={() => undefined} />;
    case 'rates':
      return <RatesStepper ctl={ctl} a={a} />;
    case 'reno':
      return <RenoCard ctl={ctl} id={a.assetId} onHire={() => run({ t: 'desk', desk: 'staff', label: 'Hiring board', at: 'hiring' })} />;
    case 'check':
      return null;
    default: {
      const label = 'label' in a ? a.label : '';
      const sub = 'sub' in a ? a.sub : '';
      return (
        <button class="insp-act" onClick={() => run(a)}>
          <span class="col" style={{ gap: 1, minWidth: 0 }}>
            <b>{label}</b>
            {sub && <span class="label">{sub}</span>}
          </span>
          <span class="chev" aria-hidden="true">
            ›
          </span>
        </button>
      );
    }
  }
}

/** the seat's one primary action, in the sheet's sticky footer (a hire or a cottage is a card in the body instead) */
function Primary({ f, ctl, run, onCheck }: { f: Facts; ctl: Ctl; run: Run; onCheck(): void }) {
  const p = f.primary;
  if (!p || p.t === 'hire' || p.t === 'build') return null;
  if (p.t === 'rates')
    return (
      <div class="sheet-actions">
        <RatesStepper ctl={ctl} a={p} />
      </div>
    );
  if (p.t === 'check')
    return (
      <div class="sheet-actions col" style={{ gap: 4 }}>
        <Btn block disabled={!p.ok} onClick={onCheck}>
          <Icon name={p.kind === 'walkaround' ? 'wrench' : 'meter'} size={18} /> {p.label}
        </Btn>
        {!p.ok && <span class="label center" style={{ textAlign: 'center' }}>{p.why}</span>}
      </div>
    );
  const label = 'label' in p ? p.label : '';
  const sub = 'sub' in p ? p.sub : '';
  return (
    <div class="sheet-actions col" style={{ gap: 4 }}>
      <Btn block onClick={() => run(p)}>
        {label}
      </Btn>
      {sub && <span class="label center" style={{ textAlign: 'center' }}>{sub}</span>}
    </div>
  );
}
