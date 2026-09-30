// A plane alert's MEL and airworthiness words, and the mechanic's one ask for
// the MEL extension (fix round 1, 2026-09-28). Investigate shows them while the
// alert is planned; the job's sheet shows them once it's sent, so a placard
// that runs out while the job waits on parts still offers the ask (before, it
// was only on Investigate, which a sent job never shows).
//
// Only an airworthiness item grounds its plane past due (alertAog). An MEL item
// that isn't one (the intermittent com) goes back to an open write-up when its
// placard runs out: it picks up deferral risk, it doesn't ground anything.
import { alertFlags } from '../../sim/alerts';
import { groundsFrom, subCharterNeed, subCharterWords } from '../../sim/econ';
import type { Action, Alert, IslandState } from '../../sim/types';
import { Btn, Icon } from '../kit';
import { canAskMel } from '../select';
import { nameOf } from './words';

/** ", and a mainland sub-charter flies the guests at about $540 a week (2 flights at $270)": the only guest plane, grounded on an airworthiness item */
export function subClause(s: IslandState, a: Alert): string {
  const asset = s.assets.find((x) => x.id === a.assetId);
  if (!asset || asset.kind !== 'plane' || !alertFlags(s, a).aw) return '';
  const sub = subCharterNeed(s, asset.id, 'clear', groundsFrom(s, a));
  return sub ? `, and a mainland sub-charter flies the guests at ${subCharterWords(sub)}` : '';
}

/** what happens once the placard runs out, as the MEL words put it ("Twin N-12 is grounded until the fix, and …" or "it's an open write-up again: …") */
export function pastPlacard(s: IslandState, a: Alert): string {
  const asset = s.assets.find((x) => x.id === a.assetId);
  if (!asset) return '';
  return alertFlags(s, a).aw ? `${asset.name} is grounded until the fix${subClause(s, a)}` : "it's an open write-up again: fix it, or it picks up deferral risk each week";
}

export function MelNote({ s, a, run, can }: { s: IslandState; a: Alert; run(x: Action, done?: string): Promise<boolean>; can: boolean }) {
  const asset = s.assets.find((x) => x.id === a.assetId);
  if (!asset || asset.kind !== 'plane') return null;
  const f = alertFlags(s, a);
  const fin = nameOf(s, 'fin');
  const signed = !!a.order && s.orders.some((o) => o.id === a.order && o.status === 'done');
  const due = a.due === s.week ? "at this week's resolve" : `at week ${a.due}'s resolve`;
  return (
    <>
      {a.mel && a.status !== 'closed' && (
        <div class="jf-note">
          <b>MEL C:</b> placarded INOP by {a.mel.by}, covers week {a.mel.until}
          {a.mel.ext ? ' (extended once)' : a.mel.ask ? ` · ${a.mel.ask.by} asked ${fin} to authorize the one extension` : ''}. {a.mel.until < s.week ? `It ran out: ${pastPlacard(s, a)}` : `Past it, ${pastPlacard(s, a)}`}.
        </div>
      )}
      {f.aw && !a.mel && a.status !== 'closed' && !signed && (
        <div class="jf-note">
          <b>Airworthiness item</b>, due week {a.due}: {a.due < s.week ? `past due, ${asset.name} is grounded until it's signed off` : `${due}, ${asset.name} is grounded unless it's signed off by then`}
          {subClause(s, a)}.
        </div>
      )}
      {canAskMel(s, a) && (
        <Btn block kind="soft" disabled={!can} onClick={() => void run({ t: 'melExtend', role: 'mech', alert: a.id }, `Asked ${fin} to authorize the one-time MEL extension.`)}>
          <Icon name="placard" size={18} /> Ask {fin} to authorize the one-time extension
        </Btn>
      )}
      {canAskMel(s, a) && <span class="label">The company's call and its cost: {fin} signs for the island, as an operator's management would.</span>}
    </>
  );
}
