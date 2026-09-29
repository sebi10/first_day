// The inspect sheet (docs/EXPANSION.md 6.2, 6.3; package C builds it). THIS IS
// PACKAGE A's STUB, the stage-2 contract: a plain sheet that proves the wiring
// end to end (home.tsx's <Sheet> wraps it). It shows the object's name and a
// status line, the seat's quick check (every item in one view, then one call),
// and Report a problem. It never shows hidden state (no alert cause, no defect,
// no quick check's truth). C owns this file from here and replaces all of it.
import { useState } from 'preact/hooks';
import { checkKindFor, checkView, canCheck } from '../../sim/checks';
import { ROLE_LABEL } from '../../sim/data';
import type { IslandState, OpsRole, Role } from '../../sim/types';
import { fx } from '../feedback';
import { Btn, toast } from '../kit';
import { OBJECT_LABEL, isAssetRef, type ObjectRef } from '../objects';
import { fixtureFacts, flaggable, openAlertsOn } from '../select';
import type { Ctl } from '../useIsland';

const CHECK_WORD = { walkaround: 'Walkaround', ir: 'IR scan', meter: 'Meter check' } as const;

export function InspectSheet({ s, ctl, role, target, onClose }: { s: IslandState; ctl: Ctl; role: Role; target: ObjectRef; onClose: () => void }) {
  const [checking, setChecking] = useState(false);
  const [pick, setPick] = useState<string | null>(null);
  const [confirmFlag, setConfirmFlag] = useState(false);
  const a = isAssetRef(target) ? s.assets.find((x) => x.id === target.id) : undefined;
  const name = a?.name ?? OBJECT_LABEL[target.kind];
  const tech = role !== 'fin' ? (role as OpsRole) : null;
  const ck = a && tech ? checkKindFor(s, tech, a) : null;
  const can = a && tech && ck ? canCheck(s, tech, a.id) : null;
  const view = checking && a && tech ? checkView(s, tech, a.id) : null;
  const flag = a ? flaggable(s, role, a.id) : null;
  const alerts = a ? openAlertsOn(s, a.id) : null;
  const facts = a ? [] : fixtureFacts(s, target.kind, target.st, role).lines;
  const call = async (item: string | null) => {
    if (!a || !tech) return;
    if (await ctl.dispatch({ t: 'check', role: tech, assetId: a.id, item, week: s.week })) {
      fx.tap();
      toast(item ? 'Written up: it’s on your alert list.' : 'Noted.');
      setChecking(false);
      setPick(null);
      onClose();
    }
  };
  return (
    <div class="col" style={{ gap: 10 }}>
      <h2>{name}</h2>
      {a && (
        <span class="muted">
          {a.kind === 'plane' ? 'Airworthiness' : 'Reliability'} {Math.round(a.health)}
          {alerts && alerts.mech + alerts.elec > 0 ? ` · open alerts: ${alerts.mech ? `${alerts.mech} mechanic` : ''}${alerts.mech && alerts.elec ? ', ' : ''}${alerts.elec ? `${alerts.elec} electrician` : ''}` : ''}
        </span>
      )}
      {facts.map((l, i) => (
        <span key={i}>{l}</span>
      ))}
      {ck && can && !view && (
        <Btn block kind="soft" disabled={!can.ok} onClick={() => setChecking(true)}>
          {CHECK_WORD[ck]}
          {!can.ok ? ` · ${can.why}` : ''}
        </Btn>
      )}
      {view && (
        <div class="col" style={{ gap: 8 }}>
          {view.ppe && <b>{view.ppe}</b>}
          {view.items.map((i) => (
            <button key={i.id} class="card col" style={{ border: 0, textAlign: 'left', gap: 2, boxShadow: pick === i.id ? 'inset 0 0 0 3px var(--sea)' : undefined }} onClick={() => setPick(pick === i.id ? null : i.id)} aria-pressed={pick === i.id}>
              <b>{i.label}</b>
              <span>{i.text}</span>
            </button>
          ))}
          <div class="row" style={{ gap: 8 }}>
            <Btn block kind="ghost" onClick={() => void call(null)}>
              {view.kind === 'walkaround' ? 'All serviceable' : 'All normal'}
            </Btn>
            <Btn block disabled={!pick} onClick={() => void call(pick)}>
              {view.kind === 'ir' ? 'Open it up' : 'Write it up'}
            </Btn>
          </div>
          {view.help.map((h, i) => (
            <span key={i} class="label">
              {h}
            </span>
          ))}
        </div>
      )}
      {flag?.ok && !confirmFlag && (
        <Btn block kind="soft" onClick={() => setConfirmFlag(true)}>
          Report a problem to {s.players[flag.to]?.name ?? ROLE_LABEL[flag.to]}
        </Btn>
      )}
      {flag?.ok && confirmFlag && (
        <div class="col" style={{ gap: 8 }}>
          <span>Adds one alert for {s.players[flag.to]?.name ?? ROLE_LABEL[flag.to]} now. It counts in their open work, so next week's draw is one smaller.</span>
          <Btn
            block
            onClick={async () => {
              if (a && (await ctl.dispatch({ t: 'flag', role, assetId: a.id, week: s.week }))) {
                fx.tap();
                onClose();
              }
            }}
          >
            Report it
          </Btn>
        </div>
      )}
      {flag && !flag.ok && <span class="label">{flag.why}</span>}
      <Btn block kind="ghost" onClick={onClose}>
        Close
      </Btn>
    </div>
  );
}
