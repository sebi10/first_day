// Report a problem (docs/EXPANSION.md 6.5), at the foot of every inspect sheet:
// - on an asset another trade owns: "Report a problem to Mia" (a flag: one a week
//   per seat, from week 3, one received per trade), then a confirm that says what it
//   does: 2 taps. Or message them instead.
// - on an asset of your own trade (the generator: both techs'): write it up.
// - on a fixture, a cart, a staff figure or a build site: the crew board DM to the
//   seat whose it is, a message started (openDm): 1 tap.
import { useState } from 'preact/hooks';
import type { IslandState, Role } from '../../sim/types';
import { openDm } from '../crewboard';
import { fx } from '../feedback';
import { Btn, toast } from '../kit';
import type { Ctl } from '../useIsland';
import type { Act, Report as ReportFacts } from './facts';

/** a DM act as its button: the crew board's DM thread to that seat, the message started */
export function DmButton({ a, kind = 'soft' }: { a: Extract<Act, { t: 'dm' }>; kind?: 'soft' | 'ghost' }) {
  return (
    <Btn small kind={kind} onClick={() => openDm(a.to, a.prefill)}>
      {a.label}
    </Btn>
  );
}

export function Report({ s, ctl, role, report, onWriteUp }: { s: IslandState; ctl: Ctl; role: Role; report: ReportFacts | null; onWriteUp(assetId: string): void }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!report) return null;
  const dms = (report.t === 'flag' || report.t === 'dm' ? report.dms : []).filter((d): d is Extract<Act, { t: 'dm' }> => d.t === 'dm');
  return (
    <section class="insp-report" aria-label="Report a problem">
      <h3>{report.head}</h3>
      {report.t === 'own' && (
        <>
          <span class="label">{report.ok ? 'Judge what it needs and write it up (one write-up a week): it comes back as an alert with its task filled in.' : report.why}</span>
          <Btn small kind="soft" disabled={!report.ok} onClick={() => onWriteUp(report.assetId)}>
            Write it up
          </Btn>
        </>
      )}
      {report.t === 'flag' && report.ok && !confirm && (
        <div class="row" style={{ gap: 8 }}>
          <Btn small kind="soft" onClick={() => setConfirm(true)}>
            Report a problem to {report.toName}
          </Btn>
          {dms.map((d) => (
            <DmButton key={d.to} a={d} kind="ghost" />
          ))}
        </div>
      )}
      {report.t === 'flag' && report.ok && confirm && (
        <>
          <span>{report.words}</span>
          <div class="row" style={{ gap: 8 }}>
            <Btn
              small
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const ok = await ctl.dispatch({ t: 'flag', role, assetId: report.assetId, week: s.week });
                setBusy(false);
                setConfirm(false);
                if (ok) {
                  fx.good();
                  toast(`Reported: it's on ${report.toName}'s alert list.`);
                }
              }}
            >
              Report it
            </Btn>
            <Btn small kind="ghost" onClick={() => setConfirm(false)}>
              Not now
            </Btn>
          </div>
        </>
      )}
      {report.t === 'flag' && !report.ok && (
        <>
          <span class="label">{report.why}</span>
          {dms.length > 0 && (
            <div class="row" style={{ gap: 8 }}>
              {dms.map((d) => (
                <DmButton key={d.to} a={d} />
              ))}
            </div>
          )}
        </>
      )}
      {report.t === 'dm' && (
        <div class="row" style={{ gap: 8 }}>
          {dms.map((d) => (
            <DmButton key={d.to} a={d} />
          ))}
        </div>
      )}
    </section>
  );
}
