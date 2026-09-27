// Ground power: the mechanic's carts. A card on the ops panel and a sheet (also
// opened by tapping a cart on the island): each cart's charge, where it is, its
// cable as last inspected, and the moves (plug in, hook up, unhook, inspect).
// An inspection is a close look at the plug end: the mechanic reads the tells
// (a crazed or cracked boot, heat discoloration, pitted contacts) and calls it
// serviceable or tags it out. The other seats see the same card read-only.
import { useState } from 'preact/hooks';
import { CABLE_BAND, CABLE_REPORT, GSE, ROLE_LABEL } from '../sim/data';
import { cableReport, cartOn, gseCarts, isAog, powered } from '../sim/econ';
import { hashSeed, rng } from '../sim/rng';
import type { GseCart, GseOp, IslandState, Role } from '../sim/types';
import { fx } from './feedback';
import { Btn, Icon } from './kit';
import { C } from './theme';
import type { Ctl } from './useIsland';

/** This week's weak-battery plane (its first start is on ground power), and whether a charged cart in service is on it. */
export function weakBatteryNow(s: IslandState): { name: string; ready: boolean; cart?: GseCart } | null {
  const wb = s.weakBattery;
  if (!wb || wb.week !== s.week) return null;
  const p = s.assets.find((a) => a.id === wb.assetId);
  if (!p) return null;
  const cart = cartOn(s, p.id);
  return { name: p.name, cart, ready: !!cart && cart.charge >= GSE.minStart && !cableReport(s, cart.id) };
}

/** a start needs 30%: green from 60, amber from 30, rust below */
export const chargeColor = (charge: number) => (charge >= 60 ? C.palm : charge >= GSE.minStart ? '#C9A86A' : C.rust);

/** "On charge", "Hooked to Twin N-12", "Hooked to Cargo C-7 (AOG)", "Parked" */
export function cartWhere(s: IslandState, c: GseCart) {
  // a plane down for a part isn't flying: its cart is the first one to tow over for another plane's start
  if (c.hookedTo) return `Hooked to ${s.assets.find((a) => a.id === c.hookedTo)?.name ?? 'a plane'}${isAog(s, c.hookedTo) ? ' (AOG)' : ''}`;
  return c.charging ? 'On charge' : 'Parked';
}

/** the cable as last seen: never a live readout of the hidden wear */
export function cableWords(c: GseCart) {
  const i = c.inspected;
  if (!i) return 'Cable not inspected yet';
  if (i.fixed) return `Cable re-terminated by ${i.by}, week ${i.week}`;
  // an inspection is the mechanic's call on the plug end, not a readout
  if (i.band === 'good') return `Cable called serviceable by ${i.by}, week ${i.week}`;
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

/** The weak battery this week, as a line on the card and the sheet. */
function WeakBattery({ s }: { s: IslandState }) {
  const wb = weakBatteryNow(s);
  if (!wb) return null;
  return wb.ready ? (
    <span class="label">
      ✓ {wb.name}'s battery is weak this week: {wb.cart!.name} is on it for the first start ({Math.round(wb.cart!.charge)}%).
    </span>
  ) : (
    <span class="fault" style={{ fontWeight: 700, fontSize: 14 }}>
      {wb.name}'s battery is weak this week: hook a charged cart up to it before the week resolves, or its first flight is lost.
    </span>
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
      <WeakBattery s={s} />
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

/**
 * The plug end up close, as an inspection sees it. The tells grow with the
 * cable's wear: weathered crazing on the boot (harmless), then cracks through
 * the insulation near the plug, then heat discoloration and pitted, burnt
 * contacts. The drawing varies by cart and week; the call is the mechanic's.
 */
export function PlugCloseUp({ c, week }: { c: GseCart; week: number }) {
  const r = rng(hashSeed('plug-look', c.id, week));
  const w = c.wear;
  const crazes = w >= 22 ? Math.min(7, 2 + Math.floor((w - 22) / 6)) : 0;
  const cracks = w >= GSE.cracked ? Math.min(5, 1 + Math.floor((w - GSE.cracked) / 9)) : 0;
  const heat = w >= GSE.arcFrom ? Math.min(1, (w - GSE.arcFrom) / 30) : 0;
  const pits = w >= GSE.pitted ? Math.min(9, 3 + Math.floor((w - GSE.pitted) / 5)) : 0;
  const melt = w >= GSE.arcSevere;
  // the boot runs x 96..150 (y 52..108): crazing is fine and short, a crack is dark, jagged and opens up
  const craze = Array.from({ length: crazes }, () => {
    const x = r.range(100, 146);
    const y = r.range(58, 102);
    return `M${x.toFixed(1)} ${y.toFixed(1)} l${r.range(-6, 6).toFixed(1)} ${r.range(3, 7).toFixed(1)}`;
  });
  const crack = Array.from({ length: cracks }, () => {
    const x = r.range(102, 142);
    let y = r.pick([54, 56]);
    let d = `M${x.toFixed(1)} ${y}`;
    for (let i = 0; i < 4; i++) {
      y += r.range(9, 14);
      d += ` L${(x + r.range(-5, 5)).toFixed(1)} ${Math.min(106, y).toFixed(1)}`;
    }
    return d;
  });
  const pit = Array.from({ length: pits }, () => {
    const big = r.chance(0.6);
    const [cx, cy, rr] = big ? (r.chance(0.5) ? [236, 62, 15] : [236, 104, 15]) : [276, 83, 7];
    const a = r.range(0, Math.PI * 2);
    return { x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr, r: r.range(1.2, 2.6) };
  });
  return (
    <svg class="plug-look" viewBox="0 0 320 170" role="img" aria-label={`${c.name}'s plug end, close up`}>
      <rect x="0" y="0" width="320" height="170" rx="12" fill="#e9e3d5" />
      {/* the cable, the boot and the plug body, side on */}
      <rect x="-4" y="66" width="104" height="28" rx="10" fill="#26292b" />
      <path d="M96 60 Q124 50 150 52 L150 108 Q124 110 96 100 Z" fill="#3a3f42" />
      {craze.map((d, i) => (
        <path key={`z${i}`} d={d} stroke="#6d7478" stroke-width="0.9" fill="none" />
      ))}
      {crack.map((d, i) => (
        <path key={`k${i}`} d={d} stroke="#0d0f10" stroke-width={2.2} fill="none" stroke-linejoin="round" />
      ))}
      <rect x="150" y="44" width="40" height="72" rx="6" fill="#8d969b" />
      <rect x="156" y="50" width="28" height="60" rx="4" fill="#a7b0b4" />
      {heat > 0 && <rect x="150" y="44" width="40" height="72" rx="6" fill="#7a4a1c" opacity={0.18 + heat * 0.35} />}
      {/* the face: two big sockets (+, −) and the small interlock socket */}
      <circle cx="250" cy="83" r="58" fill="#2e3336" />
      <circle cx="250" cy="83" r="54" fill="#4a5155" />
      {heat > 0 && <circle cx="236" cy="62" r="24" fill="#8a4b16" opacity={0.2 + heat * 0.5} />}
      {[
        [236, 62, 13, '+'],
        [236, 104, 13, '−'],
        [276, 83, 6, ''],
      ].map(([x, y, rr, m]) => (
        <g key={`${x}-${y}`}>
          <circle cx={x as number} cy={y as number} r={(rr as number) + 3} fill={heat > 0.5 ? '#6b4a2a' : '#c9a86a'} />
          <circle cx={x as number} cy={y as number} r={rr as number} fill="#111" />
          {m && (
            <text x={(x as number) - 26} y={(y as number) + 5} font-size="14" font-weight="800" fill="#e9e3d5">
              {m as string}
            </text>
          )}
        </g>
      ))}
      {pit.map((q, i) => (
        <circle key={`p${i}`} cx={q.x} cy={q.y} r={q.r} fill="#1b1410" />
      ))}
      {melt && <path d="M224 50 q6 -8 14 -2 q8 6 2 12 q-6 6 -12 2 z" fill="#3b2a1c" opacity="0.9" />}
      <text x="12" y="160" font-size="11" font-weight="700" fill="#5b6475">
        boot and insulation
      </text>
      <text x="206" y="160" font-size="11" font-weight="700" fill="#5b6475">
        contact face
      </text>
    </svg>
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
  // the cart whose plug end is up close (the inspection's call is next)
  const [look, setLook] = useState<string | null>(null);
  const go = async (c: GseCart, op: GseOp, assetId?: string, call?: 'ok' | 'tag') => {
    if (await ctl.dispatch({ t: 'gse', role: 'mech', cart: c.id, op, ...(assetId ? { assetId } : {}), ...(call ? { call } : {}) })) fx.tap();
  };
  return (
    <div class="col" style={{ gap: 12 }}>
      <div class="row spread">
        <h2>Ground power</h2>
        <Icon name="bolt" size={22} color={C.mech} />
      </div>
      <WeakBattery s={s} />
      {list.map((c) => {
        const rep = cableReport(s, c.id);
        const fixer = rep ? (s.players[rep.role]?.name ?? ROLE_LABEL[rep.role]) : '';
        const inspectedNow = c.inspected?.week === s.week && !c.inspected.fixed;
        const fixedNow = c.inspected?.week === s.week && !!c.inspected.fixed;
        return (
          <div key={c.id} class="card col" style={{ gap: 8, background: 'var(--sand)', boxShadow: 'none', borderLeft: `6px solid ${rep ? C.rust : chargeColor(c.charge)}` }}>
            <div class="row spread" style={{ gap: 8 }}>
              <b style={{ fontSize: 17, whiteSpace: 'nowrap' }}>{c.name}</b>
              {/* "Hooked to Cargo C-7 (AOG)" can be long: it wraps, the name doesn't */}
              <span class={`chip ${c.charging ? 'sea' : c.hookedTo ? 'ink' : ''}`} style={{ whiteSpace: 'normal', textAlign: 'right', borderRadius: 12 }}>
                {cartWhere(s, c)}
              </span>
            </div>
            <div class="row spread">
              <span class="label">Charge</span>
              <b class={`num ${c.charge < GSE.minStart ? 'fault' : ''}`}>{Math.round(c.charge)}%</b>
            </div>
            <ChargeBar c={c} big />
            <span style={{ fontSize: 14 }}>{cableWords(c)}.</span>
            {rep && (
              <span class="fault" style={{ fontWeight: 700 }}>
                Tagged out: {CABLE_REPORT[rep.report?.band ?? 'cracked'].tag}. No ground power starts on it until {fixer} fits a new plug.
              </span>
            )}
            {can && look === c.id && !rep && (
              <div class="col plug-call" style={{ gap: 8 }}>
                <PlugCloseUp c={c} week={s.week} />
                <span class="label">Look for cracks through the boot or the insulation near the plug, heat discoloration, and pitted or burnt contacts. Weathered crazing on the rubber is not a crack.</span>
                <div class="row" style={{ gap: 8 }}>
                  <Btn
                    small
                    block
                    kind="soft"
                    onClick={() => {
                      setLook(null);
                      void go(c, 'inspect', undefined, 'ok');
                    }}
                  >
                    Serviceable
                  </Btn>
                  <Btn
                    small
                    block
                    kind="danger"
                    onClick={() => {
                      setLook(null);
                      void go(c, 'inspect', undefined, 'tag');
                    }}
                  >
                    Tag it out
                  </Btn>
                </div>
              </div>
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
                {!rep && look !== c.id && (
                  <Btn
                    small
                    kind="ghost"
                    disabled={inspectedNow || fixedNow}
                    onClick={() => {
                      fx.tap();
                      setLook(c.id);
                    }}
                  >
                    {inspectedNow ? 'Inspected this week' : fixedNow ? 'New plug: look next week' : 'Inspect the cable'}
                  </Btn>
                )}
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
