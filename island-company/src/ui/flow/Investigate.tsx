// Investigate (free: nothing is written until a decision): the finding at the
// alert's tier, the electrical site, the airplane's data plate; then the calls
// a tech makes before (or instead of) a job: make it safe (hazards, first),
// placard it under the MEL, ask the electrician to meter it, or close it with
// no fault found. The main button goes on to the book.
import { useState } from 'preact/hooks';
import { alertFlags, breakerOf, findingOf, siteOf, symptomOf } from '../../sim/alerts';
import { islandAircraft } from '../../sim/chain';
import { groundsFrom, subCharterNeed, subCharterWords } from '../../sim/econ';
import type { Action, Alert, IslandState } from '../../sim/types';
import { Btn, Icon } from '../kit';
import { DataPlate } from '../manual';
import { assetOf, neutralWarning, siteWords, tierOf } from './steps';
import { nameOf, upperFirst } from './words';

export function Investigate({ s, a, run, demo, ended }: { s: IslandState; a: Alert; run(x: Action, done?: string): Promise<boolean>; demo?: boolean; ended?: boolean }) {
  const asset = assetOf(s, a);
  const [ask, setAsk] = useState<'safe' | 'nff' | 'mel' | null>(null);
  if (!asset) return null;
  const tier = tierOf(s, a);
  const f = alertFlags(s, a);
  const sym = symptomOf(a);
  const finding = findingOf(s, a, tier);
  const site = siteOf(s, a);
  const benchOrder = a.bench?.order ? s.orders.find((o) => o.id === a.bench!.order) : undefined;
  const benchOpen = !!benchOrder && benchOrder.status !== 'done' && benchOrder.status !== 'cancelled';
  const known = !!a.repair || ['due', 'ad', 'code', 'takeoff'].includes(a.src) || !!sym?.writeUp;
  const open = a.status === 'open';
  const elec = nameOf(s, 'elec');
  const fin = nameOf(s, 'fin');
  const can = !demo && !ended;
  // what past due does to the plane (an airworthiness item): grounded until the fix, any plane. The only guest plane's
  // guests then fly in on a mainland sub-charter, at the island's cost (a week of it, as the island books today)
  const aw = f.aw && asset.kind === 'plane';
  const sub = aw ? subCharterNeed(s, asset.id, 'clear', groundsFrom(s, a)) : null;
  const subText = sub ? `, and a mainland sub-charter flies the guests at ${subCharterWords(sub)}` : '';
  const signed = !!a.order && s.orders.some((o) => o.id === a.order && o.status === 'done');
  return (
    <div class="col jf-step" style={{ gap: 10 }}>
      <div class="card jf-finding">
        <span class="label">Finding{tier <= 2 ? '' : ' (as found)'}</span>
        <p style={{ margin: 0 }}>{finding.text}</p>
        {site && <span class="label">Site: {siteWords(site, a.src === 'takeoff')}</span>}
      </div>
      {asset.kind === 'plane' && <DataPlate ac={islandAircraft(s.seed, asset)} />}
      {a.bench?.call && (
        <div class="jf-note">
          <b>{a.bench.by ?? elec}</b> metered it (week {a.bench.week}): {a.bench.call === 'unit' ? "the wiring checks good, it's the unit." : 'the fault was in the wiring, fixed at the airplane.'}
        </div>
      )}
      {benchOpen && !a.bench?.call && (
        <div class="jf-note">
          <Icon name="meter" size={16} /> Waiting on <b>{elec}</b> to meter the circuit: the unit, or its wiring?
        </div>
      )}
      {a.mel && (
        <div class="jf-note">
          <b>MEL C:</b> placarded INOP by {a.mel.by}, covers week {a.mel.until}
          {a.mel.ext ? ' (extended once)' : a.mel.ask ? ` · ${a.mel.ask.by} asked ${fin} for the one extension` : ''}. {a.mel.until < s.week ? `It ran out: ${asset.name} is grounded until the fix` : `Past it, ${asset.name} is grounded until the fix`}
          {subText}.
        </div>
      )}
      {aw && !a.mel && a.status !== 'closed' && !signed && (
        <div class="jf-note">
          <b>Airworthiness item</b>, due week {a.due}: {a.due < s.week ? `past due, ${asset.name} is grounded until it's signed off` : `${a.due === s.week ? "from this week's resolve" : `from week ${a.due}`}, ${asset.name} is grounded until it's signed off`}
          {subText}.
        </div>
      )}
      {a.role === 'mech' && a.mel && !a.mel.ext && !a.mel.ask && a.mel.until <= s.week && a.mel.until >= s.week - 1 && a.status !== 'closed' && (
        <Btn block kind="soft" disabled={!can} onClick={() => void run({ t: 'melExtend', role: 'mech', alert: a.id }, `Asked ${fin} to approve the one MEL extension.`)}>
          <Icon name="placard" size={18} /> Ask {fin} to extend the MEL (once)
        </Btn>
      )}
      {a.safe && (
        <div class="jf-note">
          <b>Made safe</b> by {a.safe.by} in week {a.safe.week}: {a.safe.how === 'breaker' ? 'the circuit off and tagged' : 'a blank-off'}. The house rents at 75% until the fix.
        </div>
      )}
      {open && f.hazard && !a.safe && (
        <div class="col" style={{ gap: 8 }}>
          <Btn block kind="danger" disabled={!can} onClick={() => setAsk(ask === 'safe' ? null : 'safe')}>
            <Icon name="tag" size={18} /> Make it safe
          </Btn>
          {ask === 'safe' && (
            <div class="card col jf-ask" style={{ gap: 8 }}>
              <span class="label">The house closes while it's a hazard. Made safe, it rents at 75% until the fix.</span>
              {neutralWarning(s, a) && <span class="fault">A branch breaker won't isolate a loose service neutral: leave the house closed until it's fixed.</span>}
              <Btn block kind="soft" onClick={() => void run({ t: 'makeSafe', role: 'elec', alert: a.id, how: 'breaker' }, `Made safe: ${breakerOf(site)} is off and tagged.`).then(() => setAsk(null))}>
                {upperFirst(breakerOf(site))}: off and tag it
              </Btn>
              <Btn block kind="soft" onClick={() => void run({ t: 'makeSafe', role: 'elec', alert: a.id, how: 'blankoff' }, 'Made safe: blanked off.').then(() => setAsk(null))}>
                Blank it off (a blank plate)
              </Btn>
            </div>
          )}
        </div>
      )}
      {a.role === 'mech' && f.mel === 'C' && !a.mel && a.status !== 'closed' && (
        <>
          <Btn block kind="soft" disabled={!can} onClick={() => setAsk(ask === 'mel' ? null : 'mel')}>
            <Icon name="placard" size={18} /> MEL C: placard it INOP
          </Btn>
          {ask === 'mel' && (
            <div class="card col jf-ask" style={{ gap: 8 }}>
              <span class="label">
                Company MEL, category C: the plane flies with it placarded INOP through {Math.max(s.week, a.due) > s.week ? `week ${Math.max(s.week, a.due)} (its due week)` : "this week's resolve"}. You can ask {fin} to extend it once by a week. Past that, it's grounded until the fix{subText}.
              </span>
              <Btn block onClick={() => void run({ t: 'mel', role: 'mech', alert: a.id }, 'Placarded INOP (MEL C).').then(() => setAsk(null))}>
                Placard it
              </Btn>
            </div>
          )}
        </>
      )}
      {a.role === 'mech' && f.bench && !a.bench?.call && !benchOpen && a.status !== 'closed' && (
        <Btn block kind="soft" disabled={!can} onClick={() => void run({ t: 'askBench', role: 'mech', alert: a.id }, `Asked ${elec} to meter it.`)}>
          <Icon name="meter" size={18} /> Ask {elec} to meter it
        </Btn>
      )}
      {open && !known && finding.nff && (
        <>
          <Btn block kind="ghost" disabled={!can} onClick={() => setAsk(ask === 'nff' ? null : 'nff')}>
            No fault found · close
          </Btn>
          {ask === 'nff' && (
            <div class="card col jf-ask" style={{ gap: 8 }}>
              <span>If it comes back, it's due at once.</span>
              <Btn block kind="ink" onClick={() => void run({ t: 'nff', role: a.role, alert: a.id }, 'Closed: no fault found.').then(() => setAsk(null))}>
                Close it: no fault found
              </Btn>
            </div>
          )}
        </>
      )}
      {demo && <span class="label">In a real week you could also make it safe or placard it first, or close it with no fault found when the finding can't duplicate it.</span>}
    </div>
  );
}
