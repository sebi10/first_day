// The technicians' "Your move" group (docs/JOBFLOW.md 17.2), at the top of
// Home's main column (A mounts it): new alerts, ready jobs and stopped jobs,
// due now first, then hazards and airworthiness, then by due week; for the
// electrician also the circuit checks the mechanic asked for. A row opens the
// job flow (through the `ic:open` contract: the ops panel hosts the sheet);
// a ready job's Start starts it. The What's new sheet shows here once.
import { liveAlerts } from '../../sim/alerts';
import { flowStage } from '../../sim/flow';
import type { Alert, OpsRole, Order } from '../../sim/types';
import { chainStepOrder, openTarget, quickCheckMove, revenueMoves, yourMoves } from '../select';
import type { Ctl } from '../useIsland';
import { Icon } from '../kit';
import { AlertRow } from './AlertRow';
import { WhatsNew } from './WhatsNew';
import { assetTitle, nameOf } from './words';
import './flow.css';

/** start a one-tap job (an inspection, code prep): the ops panel plans it and starts it */
export const startAlert = (alert: string) => window.dispatchEvent(new CustomEvent('ic:flow', { detail: { alert, start: true } }));

/** the electrician's circuit checks at an airplane the mechanic asked for (bench orders): the electrician's move */
export const benchChecks = (ctl: Pick<Ctl, 's'>, role: OpsRole): Order[] =>
  role === 'elec' ? ctl.s.orders.filter((o) => o.role === 'elec' && !!o.bench && o.status === 'ready') : [];

export function YourMove({ ctl, role }: { ctl: Ctl; role: OpsRole }) {
  const { s } = ctl;
  const rows = yourMoves(s, role);
  const checks = benchChecks(ctl, role);
  // the week's revenue work that isn't an alert: the load sheet, a ground power start
  const revenue = revenueMoves(s, role);
  const ended = !!s.turns[role]?.ended;
  // the week's quick check while it's open (review round 3): one line, to the object's sheet
  const qc = quickCheckMove(s, role);
  const n = rows.length + checks.length + revenue.length + (qc ? 1 : 0);
  // a row in the research branch opens the chain's step itself (the IPC, the logbooks), not the job sheet
  const openRow = (a: Alert) => {
    const step = flowStage(s, a) === 'research' ? chainStepOrder(s) : null;
    openTarget(step && step.who === role ? { order: step.order } : { alert: a.id });
  };
  return (
    <>
      <WhatsNew ctl={ctl} role={role} />
      {n === 0 ? (
        <div class="card jf-your empty">
          <span class="label">Your move</span>
          <span class="muted">{liveAlerts(s).some((a) => a.role === role) ? 'Nothing on you right now: your open alerts wait on a crewmate or a delivery (the inbox below).' : 'No alerts open. The next ones come when the week opens.'}</span>
        </div>
      ) : (
        <div class="card jf-your">
          <div class="row spread">
            <h3>Your move</h3>
            <span class="label num">
              {n} {ended ? '· turn over' : ''}
            </span>
          </div>
          <div class="jf-rows" role="list">
            {checks.map((o) => {
              const al = s.alerts?.find((x) => x.id === o.bench);
              return (
                <div key={o.id} class="jf-arow mine bench" role="listitem">
                  <button class="jf-arow-main" onClick={() => openTarget({ order: o.id })}>
                    <span class="jf-src utility">
                      <Icon name="meter" size={20} />
                    </span>
                    <span class="col grow" style={{ gap: 3, minWidth: 0 }}>
                      <span class="jf-arow-sym">{o.title}</span>
                      <span class="jf-arow-meta">
                        <span class="label">
                          {assetTitle(s, s.assets.find((x) => x.id === o.assetId))} · {nameOf(s, 'mech')} asked{al?.bench?.again ? ' again' : ''}
                        </span>
                      </span>
                    </span>
                    <span class="jf-move mine">Your move</span>
                  </button>
                </div>
              );
            })}
            {revenue.map(({ order: o, label, cost }) => (
              <div key={o.id} class="jf-arow mine rev" role="listitem">
                <button class="jf-arow-main" onClick={() => openTarget({ order: o.id })}>
                  <span class="jf-src due">
                    <Icon name={o.kind === 'wb' ? 'plane' : 'bolt'} size={20} />
                  </span>
                  <span class="col grow" style={{ gap: 3, minWidth: 0 }}>
                    <span class="jf-arow-sym">{label}</span>
                    <span class="jf-arow-meta">
                      <span class="label">{cost}</span>
                    </span>
                  </span>
                  <span class="jf-move mine">This week</span>
                </button>
              </div>
            ))}
            {rows.map(({ alert: a }) => (
              <AlertRow key={a.id} s={s} a={a} me={role} held={ended} quiet onOpen={() => openRow(a)} onStart={() => (a.order ? openTarget({ order: a.order }) : startAlert(a.id))} />
            ))}
            {qc && (
              <div class="jf-arow mine rev" role="listitem">
                <button class="jf-arow-main" onClick={() => openTarget({ object: qc.ref })}>
                  <span class="jf-src utility">
                    <Icon name={role === 'mech' ? 'plane' : 'meter'} size={20} />
                  </span>
                  <span class="col grow" style={{ gap: 3, minWidth: 0 }}>
                    <span class="jf-arow-sym">{qc.label}</span>
                    <span class="jf-arow-meta">
                      <span class="label">{qc.sub}</span>
                    </span>
                  </span>
                  <span class="jf-move mine">This week</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
