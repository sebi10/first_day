// Ground power: the mechanic's carts. A card on the ops panel and a sheet (also
// opened by tapping a cart on the island): each cart's charge, where it is, its
// cable as last inspected, and the moves (plug in, hook up, unhook, inspect).
// The other seats see the same card read-only.
import { CABLE_BAND, GSE, ROLE_LABEL } from '../sim/data';
import { cableReport, gseCarts, powered } from '../sim/econ';
import type { GseCart, GseOp, IslandState, Role } from '../sim/types';
import { fx } from './feedback';
import { Btn, Icon } from './kit';
import { C } from './theme';
import type { Ctl } from './useIsland';

/** a start needs 30%: green from 60, amber from 30, rust below */
export const chargeColor = (charge: number) => (charge >= 60 ? C.palm : charge >= GSE.minStart ? '#C9A86A' : C.rust);

/** "On charge", "Hooked to Twin N-12", "Parked" */
export function cartWhere(s: IslandState, c: GseCart) {
  if (c.hookedTo) return `Hooked to ${s.assets.find((a) => a.id === c.hookedTo)?.name ?? 'a plane'}`;
  return c.charging ? 'On charge' : 'Parked';
}

/** the cable as last seen: never a live readout of the hidden wear */
export function cableWords(c: GseCart) {
  const i = c.inspected;
  if (!i) return 'Cable not inspected yet';
  if (i.fixed) return `Cable re-terminated by ${i.by}, week ${i.week}`;
  return `Cable: ${CABLE_BAND[i.band]} (inspected week ${i.week})`;
}

function ChargeBar({ c, big }: { c: GseCart; big?: boolean }) {
  const v = Math.round(c.charge);
  return (
    <div class="bar" role="meter" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} aria-label={`${c.name} charge`} style={big ? { height: 12 } : undefined}>
      <i style={{ width: `${v}%`, background: chargeColor(v) }} />
    </div>
  );
}

/** Ops panel card: every cart at a glance. Tapping one opens the sheet on it. */
export function GroundPowerCard({ ctl, role, onOpen }: { ctl: Ctl; role: Role; onOpen(cart: string): void }) {
  const { s } = ctl;
  const carts = gseCarts(s);
  const mine = role === 'mech';
  return (
    <div class="card col" style={{ gap: 4 }}>
      <div class="row spread">
        <h3>Ground power</h3>
        <span class="label">{mine ? 'GPU carts' : 'the mechanic’s carts · read-only'}</span>
      </div>
      {carts.map((c) => {
        const tagged = !!cableReport(s, c.id);
        return (
          <button key={c.id} class="asset-tap gse-row" onClick={() => onOpen(c.id)} aria-label={`${c.name}: ${cartWhere(s, c)}, ${Math.round(c.charge)}% charge${tagged ? ', tagged out' : ''}. ${cableWords(c)}`}>
            <span class="row" style={{ gap: 10, alignItems: 'center' }}>
              <Icon name="bolt" size={20} color={chargeColor(c.charge)} />
              <span class="col grow" style={{ gap: 3, minWidth: 0 }}>
                <span class="row spread">
                  <span class="label">
                    <b style={{ color: C.ink }}>{c.name}</b> · {cartWhere(s, c)}
                    {tagged && <b class="fault"> · tagged out</b>}
                  </span>
                  <span class={`num ${c.charge < GSE.minStart ? 'fault' : ''}`} style={{ fontWeight: 800, fontSize: 14 }}>
                    {Math.round(c.charge)}%
                  </span>
                </span>
                <ChargeBar c={c} />
                <span class="label" style={{ fontSize: 12 }}>
                  {cableWords(c)}
                </span>
              </span>
            </span>
          </button>
        );
      })}
      <span class="label">
        {mine ? 'Tap a cart to charge it, hook it up to a plane or inspect its cable.' : 'Only the mechanic moves the carts. A start needs one hooked up and charged.'}
      </span>
    </div>
  );
}

/** The sheet: each cart, the focused one first, with the mechanic's moves. */
export function GseSheet({ ctl, focus, onClose }: { ctl: Ctl; focus: string | null; onClose(): void }) {
  const { s, role } = ctl;
  const carts = gseCarts(s);
  const list = focus ? [...carts.filter((c) => c.id === focus), ...carts.filter((c) => c.id !== focus)] : carts;
  const planes = s.assets.filter((a) => a.kind === 'plane');
  const turnOver = !!s.turns.mech?.ended;
  const can = role === 'mech' && s.week >= 1 && !turnOver;
  const hangar = powered(s).on;
  const go = async (c: GseCart, op: GseOp, assetId?: string) => {
    if (await ctl.dispatch({ t: 'gse', role: 'mech', cart: c.id, op, ...(assetId ? { assetId } : {}) })) fx.tap();
  };
  return (
    <div class="col" style={{ gap: 12 }}>
      <div class="row spread">
        <h2>Ground power</h2>
        <Icon name="bolt" size={22} color={C.mech} />
      </div>
      {list.map((c) => {
        const rep = cableReport(s, c.id);
        const fixer = rep ? (s.players[rep.role]?.name ?? ROLE_LABEL[rep.role]) : '';
        const inspectedNow = c.inspected?.week === s.week && !c.inspected.fixed;
        return (
          <div key={c.id} class="card col" style={{ gap: 8, background: 'var(--sand)', boxShadow: 'none', borderLeft: `6px solid ${rep ? C.rust : chargeColor(c.charge)}` }}>
            <div class="row spread">
              <b style={{ fontSize: 17 }}>{c.name}</b>
              <span class={`chip ${c.charging ? 'sea' : c.hookedTo ? 'ink' : ''}`}>{cartWhere(s, c)}</span>
            </div>
            <div class="row spread">
              <span class="label">Charge</span>
              <b class={`num ${c.charge < GSE.minStart ? 'fault' : ''}`}>{Math.round(c.charge)}%</b>
            </div>
            <ChargeBar c={c} big />
            <span style={{ fontSize: 14 }}>{cableWords(c)}.</span>
            {rep && (
              <span class="fault" style={{ fontWeight: 700 }}>
                Tagged out: its cable is cracked at the plug. No ground power starts on it until {fixer} fits a new plug.
              </span>
            )}
            {can && (
              <div class="row wrap" style={{ gap: 8 }}>
                {c.charging ? (
                  <Btn small kind="soft" onClick={() => go(c, 'unplug')}>
                    Unplug
                  </Btn>
                ) : (
                  <Btn small kind={c.charge < 100 ? 'primary' : 'soft'} onClick={() => go(c, 'charge')}>
                    Plug in to charge
                  </Btn>
                )}
                {planes.map((p) => {
                  const other = carts.find((x) => x.id !== c.id && x.hookedTo === p.id);
                  if (c.hookedTo === p.id) return null;
                  return (
                    <Btn key={p.id} small kind="soft" disabled={!!other || !!rep} onClick={() => go(c, 'hook', p.id)} label={other ? `${other.name} is on ${p.name}` : undefined}>
                      Hook up to {p.name}
                    </Btn>
                  );
                })}
                {c.hookedTo && (
                  <Btn small kind="ghost" onClick={() => go(c, 'unhook')}>
                    Unhook
                  </Btn>
                )}
                <Btn small kind="ghost" disabled={inspectedNow} onClick={() => go(c, 'inspect')}>
                  {inspectedNow ? 'Inspected this week' : 'Inspect the cable'}
                </Btn>
              </div>
            )}
          </div>
        );
      })}
      <span class="label">
        A ground power start needs a cart hooked up to that plane with {GSE.minStart}% or more. On the hangar charger a cart gains up to {GSE.chargePerWeek}% when the week resolves, while the hangar has power
        (about ${GSE.powerPerPoint.toFixed(2)} of electricity per 1%). Every start wears the cable; only an inspection shows how it’s holding up.
      </span>
      {!hangar && <span class="fault">No hangar power right now: the charger is dead until the grid or the generator is back.</span>}
      {role !== 'mech' && <span class="muted">Only the mechanic moves the carts.</span>}
      {role === 'mech' && turnOver && <span class="muted">Your turn is over: the carts stay as they are until next week.</span>}
      <Btn kind="soft" block onClick={onClose}>
        Close
      </Btn>
    </div>
  );
}
