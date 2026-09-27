// The part chain on screen: a banner every seat sees (the plane is down, whose
// move it is), and the stepper on the job and its steps. What the chain knows
// that the players don't (whether a P/N or a request is right) never shows:
// that comes back at receiving, from engineering, or as an incident.
// A chain the job flow opened (its research branch: the part isn't in the IPC)
// says so, and says AOG only when the job's alert grounds the plane (13).
import { benchMove, chainMove, chainSteps, isAre, needsFreight, openChain } from '../sim/chain';
import { ECON, ROLE_LABEL } from '../sim/data';
import { alertAog } from '../sim/econ';
import type { IslandState, Order, PartChain, Role } from '../sim/types';
import { Icon, usd } from './kit';
import { C, ROLE_TINT } from './theme';

const nameOf = (s: IslandState, r: Role) => s.players[r]?.name ?? ROLE_LABEL[r];

/** does this chain ground its plane: every legacy chain does; a flow-opened one only when the job's alert grounds it */
export function chainGrounds(s: IslandState, c: PartChain): boolean {
  if (!c.flow) return true;
  const job = s.orders.find((o) => o.id === c.orderId);
  const al = job?.flow ? s.alerts?.find((a) => a.id === job.flow!.alert) : undefined;
  return !!al && alertAog(s, c.assetId)?.id === al.id;
}

/** Found → IPC → (Logbooks → Engineering) → Buy → Delivery → Install */
export function ChainStepper({ c }: { c: PartChain }) {
  const steps = chainSteps(c);
  return (
    <ol class="chain-steps" aria-label="Part chain">
      {steps.map((x) => (
        <li key={x.key} class={x.state} aria-current={x.state === 'now' ? 'step' : undefined}>
          <i>{x.state === 'done' ? '✓' : ''}</i>
          <span>{x.label}</span>
        </li>
      ))}
    </ol>
  );
}

/** "Waiting on Cy: approve the part" as a chip, tinted by whose move it is. */
export function ChainChip({ s, c, me }: { s: IslandState; c: PartChain; me?: Role }) {
  const m = chainMove(s, c);
  const mine = !!me && m.who === me;
  return (
    <span class={`chip chain-chip ${mine ? 'ink' : ''}`} style={{ background: m.who && !mine ? `${ROLE_TINT[m.who]}88` : undefined }}>
      {mine ? `Your move: ${m.short}` : m.chip}
    </span>
  );
}

/** Every seat, top of the island screen: the plane is down, why, and whose move it is. */
export function ChainBanner({ s, role }: { s: IslandState; role: Role }) {
  const c = openChain(s);
  if (!c) return null;
  const asset = s.assets.find((a) => a.id === c.assetId);
  const m = chainMove(s, c);
  const mine = m.who === role;
  // the electrician's check runs beside the lookup or the research: a second move, another seat's
  const bm = benchMove(s, c);
  const grounds = chainGrounds(s, c);
  return (
    <div class="card col chain-banner" style={{ gap: 8, borderLeft: `6px solid ${mine ? C.rust : C.mech}` }}>
      <div class="row" style={{ gap: 8, alignItems: 'flex-start' }}>
        <Icon name="plane" size={20} color={grounds ? C.rust : C.ink} />
        <span class="col grow" style={{ gap: 2 }}>
          <b>
            {c.flow ? `Research: the ${c.item} on ${asset?.name ?? 'the plane'} isn't in the IPC` : `${asset?.name} AOG: ${c.item}`}
          </b>
          <span class="label">
            {c.flow ? `From ${c.title} in week ${c.week}` : `Found on ${c.title} in week ${c.week}`}
            {!grounds
              ? ': the job waits for the part; the plane keeps flying'
              : c.aogWeeks
                ? ` · grounded ${c.aogWeeks} week${c.aogWeeks > 1 ? 's' : ''} so far`
                : c.wired
                  ? ' · no flights until the job is finished'
                  : ' · no flights until the part is on'}
          </span>
        </span>
      </div>
      <ChainStepper c={c} />
      {c.back && <span class="label">{c.back}</span>}
      <span style={{ fontSize: 15 }}>
        {m.who ? (
          mine ? (
            <b class="fault">Your move: {m.text}.</b>
          ) : (
            <>
              Waiting on <b>{nameOf(s, m.who)}</b>: {m.text}.
            </>
          )
        ) : (
          <>{m.text.charAt(0).toUpperCase() + m.text.slice(1)}.</>
        )}
      </span>
      {bm && (
        <span style={{ fontSize: 15 }}>
          {bm.who === role ? (
            <b class="fault">Your move too: {bm.text}</b>
          ) : (
            <>
              And <b>{nameOf(s, 'elec')}</b>: {bm.text}
            </>
          )}
        </span>
      )}
    </div>
  );
}

/** On the job and its steps: what the chain is and where it stands. */
export function ChainOrigin({ s, o, me }: { s: IslandState; o: Order; me?: Role }) {
  const c = s.chain && o.chain && s.chain.id === o.chain.id ? s.chain : null;
  if (!c) return null;
  const asset = s.assets.find((a) => a.id === c.assetId);
  const m = chainMove(s, c);
  const done = c.step === 'done';
  const step = o.chain!.step;
  const what =
    step === 'job'
      ? done
        ? c.wired
          ? 'The fault was in the wiring: fixed, and the job signed off.'
          : 'The part is on and the job signed off.'
        : c.step === 'install'
          ? c.wired
            ? `${nameOf(s, 'elec')}'s check found the fault in the wiring and fixed it: no part needed. Finish the job.`
            : `The part is here: install ${c.pn}, then finish the job. It counts as the job itself.`
          : c.step === 'check'
            ? `The part is looked up. It's bought once ${nameOf(s, 'elec')}'s check says the ${c.item} ${isAre(c.item)} really bad.`
            : c.flow
              ? `The ${c.item} isn't in this airplane's IPC: the research branch finds in the records how it got there and gets it approved. The job waits for that part${chainGrounds(s, c) ? `, and ${asset?.name ?? 'the plane'} is grounded until it's on` : ''}.`
              : `This job found a part it can't be finished without. ${asset?.name ?? 'The plane'} is grounded until it's on.`
      : step === 'lookup'
        ? 'Find the part in the IPC for this airplane (its S/N and SB status) and order it, or, if it isn’t in the IPC, send it for research.'
        : step === 'research'
          ? 'The IPC doesn’t have the part on this airplane. Find in the logbooks how it got there, and ask engineering to approve it (or say what the records show).'
          : step === 'bench'
            ? c.bench?.again
              ? `The new ${c.item} made no difference, so the unit is ruled out: meter the circuit again and find the fault in the wiring.`
              : `Meter the ${c.item} circuit at the airplane, under the mechanic's supervision (14 CFR 43.3(d)): is the ${c.item} really bad, or is the fault in its wiring? The part waits on your call. Fix the wiring where you find it.`
            : step === 'buy'
              ? needsFreight(s, c)
                ? `The part for ${asset?.name ?? 'the plane'}. The cargo plane is the one down: the AOG boat brings it when the week resolves (+${usd(ECON.boatKit)} on the PO), or the next guest flight carries it free a week later. The plane earns nothing until it's on.`
                : `The part for ${asset?.name ?? 'the plane'}: it rides the next cargo flight once approved.${chainGrounds(s, c) ? " The plane earns nothing until it's on." : ''}`
              : 'Engineering reviews the request the mechanic sent: the answer comes a week later, when the week resolves.';
  return (
    <div class="card col" style={{ gap: 8, background: 'var(--sand)', boxShadow: 'none', borderLeft: `6px solid ${done ? C.palm : C.rust}` }}>
      <span class="label">Part chain · {c.item}</span>
      {c.found && <span style={{ fontSize: 15 }}>“{c.found}”</span>}
      <ChainStepper c={c} />
      {c.back && !done && <span class="label">{c.back}</span>}
      <span>{what}</span>
      {!done && (
        <span class="label">
          {m.who ? (m.who === me ? `Your move: ${m.text}.` : `Waiting on ${nameOf(s, m.who)}: ${m.text}.`) : `${m.text.charAt(0).toUpperCase() + m.text.slice(1)}.`}
          {c.spent ? ` So far: ${usd(c.spent)}.` : ''}
        </span>
      )}
      {done && c.story && <span class="label">{c.story}</span>}
    </div>
  );
}
