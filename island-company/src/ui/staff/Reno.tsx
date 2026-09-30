// The analyst's renovations (G0, stage 2): the Renovate card on the Staff desk next to the extra cottages, and the
// same case on a house's inspect sheet. A renovation is capex: the mainland package is paid when it's ordered, the
// materials as the builders go; the builders (carpentry, roofing, finishes: never licensed work) close the house for
// their two work units, and it opens again at 85 under a 13-week warranty when it passes the county's final (the
// electrician's trim-out and the inspector's visit). Only a
// house at 75 or below, one per house every 26 weeks. Renovate: Staff (1) → Renovate (2) → confirm (3); on the
// house's sheet: Renovate (1) → confirm (2).
import { useState } from 'preact/hooks';
import { RENO } from '../../sim/data';
import { buildSite, openBuild, renoOpen, renoPlan, type RenoPlan } from '../../sim/staff';
import type { Asset, IslandState } from '../../sim/types';
import { fx } from '../feedback';
import { Btn, toast, usd } from '../kit';
import type { Ctl } from '../useIsland';
import { renoStatus } from './model';
import './staff.css';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** the rule, in one line: the same words on the desk, the house's sheet and the confirm */
export const RENO_RULE = `The builders renovate a house at ${RENO.maxHealth} or below: carpentry, roofing and finishes, with the house closed while they work. It opens again at ${RENO.health} with a ${RENO.warranty}-week warranty when it passes the county's final (the electrician's trim-out and the inspector's visit). One renovation per house every ${RENO.cooldown} weeks.`;

/** the case's weeks closed, in words: at the builders' output, or with one skill-3 builder once one is hired */
const closedWords = (p: RenoPlan, elec: string) =>
  p.planned
    ? `With one skill-3 builder it's closed about ${plural(p.weeksClosed, 'week')} (2 units at 1 a week, then ${elec}'s final), counted from when they start`
    : `Closed about ${plural(p.weeksClosed, 'week')}: the builders' 2 units at ${p.out % 1 ? p.out.toFixed(2).replace(/0$/, '') : p.out} a week, then ${elec}'s final`;

/** the verdict line: the payback, or that it doesn't pay back on rent alone */
export const paybackWords = (p: RenoPlan) =>
  p.payback
    ? `Pays back in about ${plural(p.payback, 'week')}${p.planned ? ' from when a builder starts' : ''}: the rent it gains covers the package, the materials and the rent lost`
    : `Doesn't pay back on rent alone: about ${usd(p.gain)} of rent gained against ${usd(p.total + p.rentLost)}`;

/** the no-builder lead: hire one first (the desk's Hiring board) */
function NoBuilder({ onHire }: { onHire?: () => void }) {
  return (
    <span class="st-bad">
      No builder on the payroll: hire one first{onHire ? ' ' : '.'}
      {onHire && (
        <button class="linkish st-hire-link" onClick={onHire}>
          Hiring board ›
        </button>
      )}
    </span>
  );
}

/** the case for one house: the money, the weeks closed, the rent lost, what it gains, the payback and the cooldown */
export function RenoNumbers({ s, h, onHire }: { s: IslandState; h: Asset; onHire?: () => void }) {
  const p = renoPlan(s, h);
  const elec = s.players.elec?.name ?? 'the electrician';
  const size = RENO.size[h.model] ?? 1;
  return (
    <div class="card st-confirm num st-reno-num">
      {p.planned && <NoBuilder onHire={onHire} />}
      <span>
        Package <b>{usd(p.pkg)}</b> now (the mainland: roofing membrane, flooring, plumbing fixtures, paint, the permit)
      </span>
      <span>
        Materials {usd(p.materials)} at list, bought as the builders go: 2 units ({size > 1 ? `${size} × ` : ''}roof flashing and trim, then {size > 1 ? `${size} × ` : ''}deck and shutters)
      </span>
      <span>{closedWords(p, elec)}</span>
      {p.hazard && <span class="st-bad">A hazard is open on it: the final waits until {elec} makes it safe or fixes it.</span>}
      {p.warrantyUntil !== null && <span>Under its builder's warranty to week {p.warrantyUntil}: the renovation keeps it (its own {RENO.warranty} weeks end sooner).</span>}
      <span>
        {p.rentLost > 0
          ? `Rent lost about ${usd(p.rentLost)} (${usd(p.rentNow)} a week while it's closed)`
          : p.closedNow
            ? `No rent lost: it earns nothing now (closed: ${p.closedNow})`
            : 'No rent lost: at these bookings the other houses take its guests'}
      </span>
      <span>
        Left as it is: {p.closesIn > 0 ? `under 40 and closed in about ${plural(p.closesIn, 'week')} (it loses about ${Math.round(p.wear)} a booked week)` : 'it earns nothing now'}.
      </span>
      <span>
        Renovated: open about {plural(p.life, 'week')} after its final before it's under 40 again{p.rent > 0 ? `, about ${plural(p.gained, 'more open week')} than left as it is, about ${usd(p.gain)} of rent at ${usd(p.rent)} a week` : ': at these bookings the other houses take its guests either way'}.
      </span>
      <span>
        Back to {RENO.health}: {p.restore} points, about {plural(p.jobs, 'routine job')} of {elec}'s on it saved.
      </span>
      <b class={p.payback ? 'st-good' : 'st-bad'}>{paybackWords(p)}</b>
      <span class="label">
        Then not again before week {s.week + RENO.cooldown}: one renovation per house every {RENO.cooldown} weeks.
      </span>
    </div>
  );
}

/** the confirm (the desk's sheet, and the house sheet's inline card) */
function Confirm({ ctl, h, onDone, compact, onHire }: { ctl: Ctl; h: Asset; onDone(): void; compact?: boolean; onHire?: () => void }) {
  const { s } = ctl;
  const p = renoPlan(s, h);
  const ahead = openBuild(s);
  return (
    <div class="col" style={{ gap: 10 }}>
      {!compact && <h2>Renovate {h.name}?</h2>}
      <RenoNumbers s={s} h={h} onHire={onHire} />
      <span class="label">
        Cash now {usd(s.cash)} → {usd(s.cash - p.pkg)}.{' '}
        {p.planned
          ? 'It waits for a builder'
          : ahead
            ? `The builders start it after ${buildSite(ahead, s)}`
            : 'The builders start it when its first materials are in (Site work)'}
        {p.closedNow ? '; it stays closed meanwhile.' : '; it stays open until they start.'}
      </span>
      <div class={compact ? 'row wrap' : 'sheet-actions col'} style={{ gap: 8 }}>
        <Btn
          block={!compact}
          small={compact}
          disabled={!!p.blocker}
          onClick={async () => {
            onDone();
            if (await ctl.dispatch({ t: 'build', what: 'reno', asset: h.id })) {
              fx.good();
              toast(`${h.name}'s renovation ordered: ${usd(p.pkg)} package paid.${p.planned ? ' It waits for a builder.' : ''}`);
            }
          }}
        >
          Renovate {h.name} · {usd(p.pkg)}
        </Btn>
        <Btn block={!compact} small={compact} kind={compact ? 'ghost' : 'soft'} onClick={onDone}>
          Not now
        </Btn>
      </div>
      {p.blocker && <span class="label">{p.blocker}</span>}
    </div>
  );
}

/** the Staff desk's hiring board, brought into view */
const toHiring = () => requestAnimationFrame(() => document.getElementById('hiring')?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }));

/** the desk's confirm sheet body */
export function RenoSheet({ ctl, id, onDone }: { ctl: Ctl; id: string; onDone(): void }) {
  const h = ctl.s.assets.find((a) => a.id === id && a.kind === 'house');
  if (!h) return <span class="muted">No such house.</span>;
  return (
    <Confirm
      ctl={ctl}
      h={h}
      onDone={onDone}
      onHire={() => {
        onDone();
        toHiring();
      }}
    />
  );
}

/** the house sheet's card: the state, then Renovate (1) → the case and confirm (2); `onHire`: the desk's Hiring board */
export function RenoCard({ ctl, id, onHire }: { ctl: Ctl; id: string; onHire?: () => void }) {
  const { s } = ctl;
  const [open, setOpen] = useState(false);
  const h = s.assets.find((a) => a.id === id && a.kind === 'house');
  if (!h) return null;
  const p = renoPlan(s, h);
  const onList = !!renoOpen(s, h.id);
  if (onList) return null;
  return (
    <div class="insp-card">
      <b>Renovation</b>
      {!open && (
        <>
          {h.health <= RENO.maxHealth && p.planned && <NoBuilder onHire={onHire} />}
          <span>
            {h.health > RENO.maxHealth
              ? `In good shape (${Math.round(h.health)}): the builders renovate a house at ${RENO.maxHealth} or below.`
              : `${usd(p.pkg)} package + ${usd(p.materials)} materials; closed about ${plural(p.weeksClosed, 'week')}${p.planned ? ' once a builder starts' : ''}. ${paybackWords(p)}.`}
          </span>
          {p.blocker && h.health <= RENO.maxHealth && <span class="label">{p.blocker}</span>}
          {!p.blocker && (
            <Btn small kind="soft" onClick={() => setOpen(true)}>
              Renovate · {usd(p.pkg)}
            </Btn>
          )}
        </>
      )}
      {open && <Confirm ctl={ctl} h={h} compact onDone={() => setOpen(false)} onHire={onHire} />}
    </div>
  );
}

/** the Staff desk's Renovations card (from tier 4): every house, the worn ones first, with its state or a Renovate */
export function Renovations({ ctl, onPick }: { ctl: Ctl; onPick(id: string): void }) {
  const { s } = ctl;
  if (s.tier < RENO.fromTier) return null;
  const houses = s.assets.filter((a) => a.kind === 'house').sort((a, b) => a.health - b.health || (a.id < b.id ? -1 : 1));
  const worn = houses.filter((h) => h.health <= RENO.maxHealth || renoStatus(s, h));
  const fine = houses.length - worn.length;
  return (
    <div class="card col st-reno" style={{ gap: 8 }} id="renovations">
      <div class="row spread">
        <b>Renovations</b>
        <span class="label">{RENO.maxHealth} or below</span>
      </div>
      <span class="label">{RENO_RULE}</span>
      {worn.length === 0 && <span class="st-need">Every house is above {RENO.maxHealth}: nothing for the builders to renovate.</span>}
      {worn.map((h) => {
        const st = renoStatus(s, h);
        const p = renoPlan(s, h);
        return (
          <div key={h.id} class="st-reno-row col" style={{ gap: 4 }}>
            <div class="row spread" style={{ alignItems: 'baseline', gap: 8 }}>
              <b>{h.name}</b>
              <span class="label num">reliability {Math.round(h.health)}{p.rent > 0 ? ` · ${usd(p.rent)}/wk renovated` : ''}</span>
            </div>
            {st && <span class={`label st-reno-st ${st.tone}`}>{st.text}</span>}
            {!st && (
              <>
                {p.planned && <NoBuilder onHire={toHiring} />}
                <span class="label num">
                  {usd(p.pkg)} + {usd(p.materials)} materials · closed about {plural(p.weeksClosed, 'week')}
                  {p.planned ? ' once a builder starts' : ''}
                  {p.rentLost > 0 ? ` · ${usd(p.rentLost)} rent lost` : ''}
                  {p.payback ? ` · pays back in about ${plural(p.payback, 'week')}` : " · doesn't pay back on rent alone"}
                </span>
                <Btn small kind="soft" disabled={!!p.blocker} onClick={() => onPick(h.id)}>
                  Renovate {h.name} · {usd(p.pkg)}
                </Btn>
                {p.blocker && <span class="label">{p.blocker}</span>}
              </>
            )}
          </div>
        );
      })}
      {fine > 0 && <span class="label">{plural(fine, 'house')} above {RENO.maxHealth}: in good shape.</span>}
    </div>
  );
}
