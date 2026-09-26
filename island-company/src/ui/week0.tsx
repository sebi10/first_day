// Week 0: the tutorial is a normal (solo) week, not a separate mode.
// Nothing here can be failed. Shared clock starts when all three finish.
import { useEffect, useState } from 'preact/hooks';
import { ROLE_LABEL, ROLE_LONG } from '../sim/data';
import { hashSeed } from '../sim/rng';
import type { PuzzleId } from '../puzzles/types';
import type { Role } from '../sim/types';
import { fx } from './feedback';
import { Island } from './island';
import { settings } from './settings';
import { Btn, Icon, usd } from './kit';
import { PuzzleHost } from './puzzlehost';
import { C, ROLE_TINT } from './theme';
import type { Ctl } from './useIsland';

const FIRST: Record<Role, PuzzleId> = { mech: 'torque', elec: 'trace', fin: 'variance' };
const SECOND: Record<Role, PuzzleId> = { mech: 'crack', elec: 'panel', fin: 'auction' };
const JOB: Record<Role, string> = {
  mech: 'Keep both planes flying. Guests and parts arrive by air.',
  elec: 'Keep the cottages powered and inspected. No power, no guests.',
  fin: 'Keep the cash from running out. You approve every big repair.',
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
  const name = s.players[role]?.name ?? ROLE_LABEL[role];

  useEffect(() => {
    if (step !== 2 || role === 'fin') return;
    const t = setTimeout(() => {
      setApproved(true);
      fx.snap();
    }, 1600);
    return () => clearTimeout(t);
  }, [step]);

  if (playing)
    return (
      <PuzzleHost
        launch={{ puzzle: playing, seed: hashSeed(s.seed, 'week0', role, playing), tier: 0, tools: [], title: 'Week 0 · practice' }}
        onResult={() => {}}
        onClose={() => {
          setPlaying(null);
          setStep((x) => x + 1);
        }}
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
          {step === 2 && role !== 'fin' && (
            <div class="card col" style={{ gap: 12 }}>
              <h2>Nobody wins alone</h2>
              <p class="muted" style={{ margin: 0 }}>
                The next job costs money, so it goes to the analyst as a card. For now, the previous owner is standing in.
              </p>
              <div class="card" style={{ background: 'var(--sand)', borderTop: `6px solid ${ROLE_TINT[role]}` }}>
                <b>{role === 'mech' ? 'Replace alternator' : 'Panel upgrade'}</b>
                <div class="label num">{usd(role === 'mech' ? 820 : 2100)} · needs approval</div>
                <div class="row" style={{ marginTop: 8, color: approved ? C.palm : C.inkSoft, fontWeight: 800 }}>
                  <Icon name={approved ? 'check' : 'clock'} size={18} /> {approved ? 'Approved by the previous owner' : 'Sent to the analyst…'}
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
                The mechanic needs money for a repair. Approve spends cash now; defer saves it but risks an incident next week.
              </p>
              <div class="card" style={{ background: 'var(--sand)', borderTop: `6px solid ${C.mech}` }}>
                <b>Tire and brake · Twin N-12</b>
                <div class="label num">$320 · expected cost of deferring $190</div>
              </div>
              {!approved ? (
                <div class="row" style={{ gap: 8 }}>
                  <Btn kind="ghost" block onClick={() => fx.bad()}>
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
                  <span style={{ color: C.palm, fontWeight: 800 }}>✓ The mechanic can do it now. On your desk, swipe right to approve.</span>
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
    </div>
  );
}
