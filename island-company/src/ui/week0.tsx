// Week 0: the tutorial is a normal (solo) week, not a separate mode.
// Nothing here can be failed. Shared clock starts when all three finish.
// The techs' second step walks one scripted alert through the job flow
// (docs/JOBFLOW.md 17.5): the worn tire on the twin, the bathroom GFCI that
// trips. It is raised on a copy of the island and nothing is written: Send
// says what would happen in a real week.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { raiseAlert } from '../sim/alerts';
import { ROLE_LABEL, ROLE_LONG } from '../sim/data';
import { hashSeed } from '../sim/rng';
import type { PuzzleId } from '../puzzles/types';
import type { Alert, IslandState, OpsRole, Role } from '../sim/types';
import { fx } from './feedback';
import { AlertRow } from './flow/AlertRow';
import { JobFlow } from './flow/JobFlow';
import type { Preview } from './flow/steps';
import { whatsNewKey } from './flow/WhatsNew';
import { local } from './flow/words';
import { Island } from './island';
import { settings } from './settings';
import { Btn, Icon, usd } from './kit';
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
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState<PuzzleId | null>(null);
  const [approved, setApproved] = useState(false);
  const [deferred, setDeferred] = useState(false);
  const name = s.players[role]?.name ?? ROLE_LABEL[role];
  // the techs' walk-through: one alert, on a copy of the island
  const demo = useMemo(() => (role === 'fin' ? null : demoAlert(s, role)), [role]);
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
          {step === 2 && role === 'fin' && (
            <div class="card col" style={{ gap: 12 }}>
              <h2>Nobody wins alone</h2>
              <p class="muted" style={{ margin: 0 }}>
                {mechanic} needs money for a repair. Approve now, or defer and risk it.
              </p>
              <div class="card" style={{ background: 'var(--sand)', borderTop: `6px solid ${C.mech}` }}>
                <b>Tire and brake · Twin N-12</b>
                <div class="label num">$320 · expected cost of deferring $190</div>
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
                  <span style={{ color: C.palm, fontWeight: 800 }}>
                    {deferred ? '✓ Saved $320 this week; a 10% incident risk rides on it. Both calls can be right.' : `✓ ${mechanic} can do it now. On your desk, swipe right.`}
                  </span>
                  <Btn block onClick={() => setPlaying(SECOND[role])}>
                    Next: buy a part
                  </Btn>
                </>
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
