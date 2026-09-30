// Week 0: the tutorial is a normal (solo) week, not a separate mode.
// Nothing here can be failed. Shared clock starts when all three finish.
// The techs' second step walks one scripted alert through the job flow
// (docs/JOBFLOW.md 17.5): the worn tire on the twin, the bathroom GFCI that
// trips. It is raised on a copy of the island and nothing is written: Send
// says what would happen in a real week. The analyst's second step is the desk's
// intro: the mechanic's plan for that tire, as the real approval card (the
// labour, the line pulled from stock, the tire to buy, the freight), approved or
// deferred on the copy, then what the desk holds from week 1.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { raiseAlert } from '../sim/alerts';
import { ROLE_LABEL, ROLE_LONG } from '../sim/data';
import { apply } from '../sim/engine';
import { fixTaskFor, stdPickFor } from '../sim/flow';
import { hashSeed } from '../sim/rng';
import type { PuzzleId } from '../puzzles/types';
import type { Alert, BuyChoice, IslandState, OpsRole, Order, Role } from '../sim/types';
import { fx } from './feedback';
import { AlertRow } from './flow/AlertRow';
import { JobFlow } from './flow/JobFlow';
import type { Preview } from './flow/steps';
import { whatsNewKey } from './flow/WhatsNew';
import { local, session } from './flow/words';
import { Island } from './island';
import { settings } from './settings';
import { Btn, Icon, usd } from './kit';
import { ApprovalCard } from './purchasing/ApprovalCard';
import { cardVM } from './purchasing/model';
import { PuzzleHost } from './puzzlehost';
import { C, ROLE_TINT } from './theme';
import type { Ctl } from './useIsland';

/** week 0's scripted alert for a tech: raised on a copy of the island (the real one is never written) */
export function demoAlert(s: IslandState, role: OpsRole): { s: IslandState; alert: Alert } | null {
  try {
    const copy = JSON.parse(JSON.stringify(s)) as IslandState;
    const asset = copy.assets.find((a) => (role === 'mech' ? a.kind === 'plane' : a.kind === 'house'));
    if (!asset) return null;
    const alert = raiseAlert(copy, { role, asset, sym: role === 'mech' ? 'M_TIRE_WORN' : 'E_GFCI_TRIPS', cause: 0, due: copy.week + 3 }, 0);
    return { s: copy, alert };
  } catch {
    return null;
  }
}

/**
 * week 0's card for the analyst: the mechanic's plan for the worn tire, on a copy of the island at week 1 (the
 * real one is never written). The tube comes off the shelf; the tire isn't stocked, so it's a card.
 */
export function demoCard(s: IslandState): { s: IslandState; order: Order } | null {
  try {
    const d = demoAlert(s, 'mech');
    if (!d) return null;
    const copy = d.s;
    copy.week = Math.max(1, copy.week);
    const task = fixTaskFor(copy, d.alert);
    if (!task) return null;
    const pick = stdPickFor(copy, d.alert, task);
    const main = pick.find((l) => l.slot === 'tire') ?? pick[0];
    if (main && copy.inv?.[main.item]) copy.inv[main.item] = { ...copy.inv[main.item], on: 0 };
    const r = apply(copy, { t: 'plan', role: 'mech', alert: d.alert.id, task: task.id, pick, week: copy.week }, 1);
    const order = r.error ? undefined : r.s.orders.find((o) => o.flow?.alert === d.alert.id && o.status === 'pending');
    return order ? { s: r.s, order } : null;
  } catch {
    return null;
  }
}

const FIRST: Record<Role, PuzzleId> = { mech: 'torque', elec: 'trace', fin: 'variance' };
const SECOND: Record<Role, PuzzleId> = { mech: 'crack', elec: 'panel', fin: 'auction' };
const JOB: Record<Role, string> = {
  mech: 'Keep the planes flying. Guests and parts arrive by air.',
  elec: 'Keep the cottages powered and inspected. No power, no guests.',
  fin: 'Keep the cash flowing. Big repairs need your approval.',
};
const NUMBER: Record<Role, string> = {
  mech: 'Flights available this week',
  elec: 'Houses rentable this week',
  fin: 'Repair budget approved',
};

export function Week0({ ctl, role }: { ctl: Ctl; role: Role }) {
  const { s } = ctl;
  // the step survives a remount (online, a sync blip can re-render the screen from the top): a per-viewer convenience
  const stepKey = `ic.w0.${s.id}.${role}`;
  const [step, setStepState] = useState(() => Math.max(0, Math.min(4, session.get<number>(stepKey) ?? 0)));
  const setStep = (x: number | ((y: number) => number)) =>
    setStepState((prev) => {
      const next = typeof x === 'function' ? x(prev) : x;
      session.set(stepKey, next);
      return next;
    });
  const [playing, setPlaying] = useState<PuzzleId | null>(null);
  const [approved, setApproved] = useState(false);
  const [deferred, setDeferred] = useState(false);
  const name = s.players[role]?.name ?? ROLE_LABEL[role];
  // the techs' walk-through: one alert, on a copy of the island
  const demo = useMemo(() => (role === 'fin' ? null : demoAlert(s, role)), [role]);
  // the analyst's walk-through: the same tire, as the card it becomes
  const card = useMemo(() => (role === 'fin' ? demoCard(s) : null), [role]);
  const [buy, setBuy] = useState<BuyChoice>({});
  const [cardOpen, setCardOpen] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [sent, setSent] = useState<Preview | null>(null);
  const analyst = s.players.fin && s.players.fin.name !== ROLE_LABEL.fin ? s.players.fin.name : 'the analyst';
  const mechanic = s.players.mech && s.players.mech.name !== ROLE_LABEL.mech ? s.players.mech.name : 'The mechanic';

  useEffect(() => {
    if (step !== 2 || role === 'fin' || demo) return;
    const t = setTimeout(() => {
      setApproved(true);
      fx.snap();
    }, 1600);
    return () => clearTimeout(t);
  }, [step]);

  if (playing)
    return (
      <PuzzleHost
        launch={{ puzzle: playing, seed: hashSeed(s.seed, 'week0', role, playing), tier: 0, tools: [], title: 'Week 0 · practice', seat: role }}
        onResult={() => {}}
        onClose={() => {
          setPlaying(null);
          setStep((x) => x + 1);
        }}
        onCancel={() => setPlaying(null)}
      />
    );

  return (
    <div class="overlay" role="dialog" aria-label="Week 0">
      <div class="overlay-inner" style={{ overflow: 'auto' }}>
        <div class="screen" style={{ paddingBottom: 40, justifyContent: 'center', minHeight: '100%' }}>
          <div class="island-wrap" style={{ aspectRatio: '16 / 9' }}>
            <Island s={s} focus={step === 0 ? null : role} reduceMotion={settings.get().reduceMotion} />
          </div>
          <div class="row">
            {[0, 1, 2, 3, 4].map((i) => (
              <i key={i} style={{ flex: 1, height: 5, borderRadius: 9, background: i <= step ? C.sea : 'rgba(31,42,48,.12)' }} />
            ))}
          </div>
          {step === 0 && (
            <div class="card col" style={{ gap: 12, borderTop: `6px solid ${ROLE_TINT[role]}` }}>
              <span class="chip ink" style={{ alignSelf: 'flex-start' }}>
                Week 0 · {s.name}
              </span>
              <h1>Hi {name}. You're the {ROLE_LONG[role].replace(/^[A-Z](?=[a-z])/, (m) => m.toLowerCase())}.</h1>
              <p style={{ margin: 0 }}>{JOB[role]}</p>
              <p class="muted" style={{ margin: 0 }}>
                One real day = one island week. Your crew watches one number: <b>{NUMBER[role]}</b>.
              </p>
              <Btn block onClick={() => setStep(1)}>
                Try a job
              </Btn>
            </div>
          )}
          {step === 1 && (
            <div class="card col" style={{ gap: 12 }}>
              <h2>Your first work order</h2>
              <p class="muted" style={{ margin: 0 }}>
                Every job is a hands-on puzzle using the real procedure. This one has no timer.
              </p>
              <Btn block onClick={() => setPlaying(FIRST[role])}>
                Start
              </Btn>
            </div>
          )}
          {step === 2 && role !== 'fin' && demo && (
            <div class="card col" style={{ gap: 12 }}>
              <h2>Work comes in as alerts</h2>
              <p class="muted" style={{ margin: 0 }}>
                {role === 'mech'
                  ? "A pilot squawk, a trend, a wear limit. Look first; then find the task in the AMM, pick the parts in this airplane's IPC, check stock and send it."
                  : 'A guest complaint, a utility reading, a code notice. Look first; then find the procedure in the reference, pick the materials in the catalog, check stock and send it.'}
              </p>
              <div class="jf-rows" role="list">
                <AlertRow s={demo.s} a={demo.alert} me={role} quiet onOpen={() => setDemoOpen(true)} />
              </div>
              {sent ? (
                <>
                  <div class="jf-note ok" role="status">
                    {sent.text}
                  </div>
                  <span class="label">
                    Week 0 is a walk-through: nothing was written. From week 1 your alerts land in Your move on Home. A job that needs parts bought, or runs past your work budget, goes to {analyst} as a card.
                  </span>
                  <Btn block onClick={() => setStep(3)}>
                    Next
                  </Btn>
                </>
              ) : (
                <Btn block onClick={() => setDemoOpen(true)}>
                  Open the alert
                </Btn>
              )}
            </div>
          )}
          {step === 2 && role !== 'fin' && !demo && (
            <div class="card col" style={{ gap: 12 }}>
              <h2>Nobody wins alone</h2>
              <p class="muted" style={{ margin: 0 }}>
                This job costs money, so it goes to {analyst} as a card.
              </p>
              <div class="card" style={{ background: 'var(--sand)', borderTop: `6px solid ${ROLE_TINT[role]}` }}>
                <b>{role === 'mech' ? 'Replace alternator' : 'Panel upgrade'}</b>
                <div class="label num">{usd(role === 'mech' ? 820 : 2100)} · needs approval</div>
                <div class="row" style={{ marginTop: 8, color: approved ? C.palm : C.inkSoft, fontWeight: 800 }}>
                  <Icon name={approved ? 'check' : 'clock'} size={18} /> {approved ? `Approved (week 0: signed so nobody waits)` : `Sent to ${analyst}…`}
                </div>
              </div>
              <Btn block disabled={!approved} onClick={() => setPlaying(SECOND[role])}>
                Do the job
              </Btn>
            </div>
          )}
          {step === 2 && role === 'fin' && card && (
            <div class="card col" style={{ gap: 12 }}>
              <h2>Nobody wins alone</h2>
              <p class="muted" style={{ margin: 0 }}>
                {mechanic} found a tire worn to the cord and planned the fix. The tube is on the shelf; the tire isn’t, so it comes to you as a card: the labour, what’s pulled from stock, what you buy and how it ships.
              </p>
              <div class="pc" style={{ ['--tint' as string]: ROLE_TINT.mech }} role="group" aria-label="Week 0 approval card">
                <ApprovalCard vm={cardVM(card.s, card.order, buy)} open={cardOpen} setOpen={setCardOpen} buy={buy} setBuy={setBuy} onExtend={() => {}} />
              </div>
              {!approved ? (
                <div class="row" style={{ gap: 8 }}>
                  <Btn
                    kind="ghost"
                    block
                    onClick={() => {
                      fx.good();
                      setDeferred(true);
                      setApproved(true);
                    }}
                  >
                    Defer
                  </Btn>
                  <Btn
                    block
                    onClick={() => {
                      fx.snap();
                      setApproved(true);
                    }}
                  >
                    Approve
                  </Btn>
                </div>
              ) : (
                <>
                  <div class="jf-note ok" role="status">
                    {deferred
                      ? `Deferred a week: the tire waits, and the chips say what waiting costs. Both calls can be right.`
                      : `Approved: the tire rides the week’s carrier and ${mechanic === 'The mechanic' ? 'the mechanic' : mechanic} fits it. Week 0 is a walk-through: nothing was written.`}
                  </div>
                  <span class="label">
                    From week 1 your desk has four tabs. <b>Approvals</b>: cards like this one (swipe right to approve, left to defer) and the techs’ stock requests. <b>Stock</b>: what moves, and a min/max that refills a line at the resolve. <b>Money</b>: cash, budgets and where it went. <b>Staff</b>: pilots, housekeepers and builders.
                  </span>
                  <Btn block onClick={() => setPlaying(SECOND[role])}>
                    Next: buy a part
                  </Btn>
                </>
              )}
            </div>
          )}
          {step === 2 && role === 'fin' && !card && (
            <div class="card col" style={{ gap: 12 }}>
              <h2>Nobody wins alone</h2>
              <p class="muted" style={{ margin: 0 }}>
                A repair that buys parts comes to you as a card: approve it (swipe right) or defer it a week (swipe left).
              </p>
              {!approved ? (
                <Btn
                  block
                  onClick={() => {
                    fx.snap();
                    setApproved(true);
                  }}
                >
                  Approve
                </Btn>
              ) : (
                <Btn block onClick={() => setPlaying(SECOND[role])}>
                  Next: buy a part
                </Btn>
              )}
            </div>
          )}
          {step === 3 && (
            <div class="card col" style={{ gap: 12 }}>
              <h2>How a week works</h2>
              <ul style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6 }}>
                <li>Do 2–4 jobs, make 1–2 calls, end your turn.</li>
                <li>Week resolves at 20:00 island time, or once all three are in.</li>
                <li>Missed a day? Autopilot runs your role at 50%. Never a punishment.</li>
                <li>Nothing can fail until week 3.</li>
              </ul>
              <Btn block onClick={() => setStep(4)}>
                Got it
              </Btn>
            </div>
          )}
          {step === 4 && (
            <div class="card col" style={{ gap: 12 }}>
              <h2>Ready</h2>
              <p class="muted" style={{ margin: 0 }}>
                The shared clock starts when all three finish week 0. Turn on pings in <b>Me → Notifications</b> so you know when someone is waiting on you.
              </p>
              <Btn
                block
                onClick={async () => {
                  fx.flourish();
                  await ctl.dispatch({ t: 'week0Done', role });
                  // a later player in this seat (a hire mid-season) starts week 0 from the top
                  session.del(stepKey);
                }}
              >
                Finish week 0
              </Btn>
            </div>
          )}
        </div>
      </div>
      {demoOpen && demo && role !== 'fin' && (
        <JobFlow
          ctl={{ ...ctl, s: demo.s }}
          alert={demo.alert}
          onClose={() => setDemoOpen(false)}
          onStart={() => {}}
          demo={{
            onSent: (p) => {
              setSent(p);
              setDemoOpen(false);
              // a crew that walked the flow here doesn't need the What's new sheet
              local.set(whatsNewKey(s.id, role), '1');
            },
          }}
        />
      )}
    </div>
  );
}
