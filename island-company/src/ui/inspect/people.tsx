// People and building on the inspect sheets (docs/EXPANSION.md 6.3): a staff
// figure (name, role, skill, what they do this week; the analyst sees the wage too
// and can hire this week's candidate for the role inline, or let someone go, each
// with its dollar effect and one confirm), and a build site (the builders' site
// work, the crew project and each seat's job in it; the analyst can buy the next
// unit's materials or start an extra cottage). Package C.
import { useState } from 'preact/hooks';
import { ROLE_TINT } from '../theme';
import { Btn, toast, usd } from '../kit';
import { fx } from '../feedback';
import type { Ctl } from '../useIsland';
import type { Act, Block } from './facts';
import { Dots } from './parts';

/** this week, for a crew member (the sheet's header has the name, the job and the skill) */
export function PersonBlock({ b }: { b: Extract<Block, { t: 'person' }> }) {
  return (
    <div class="insp-person">
      <Dots skill={b.skill} />
      <span class="who">
        <span style={{ fontSize: 15, fontWeight: 700 }}>{b.doing.charAt(0).toUpperCase() + b.doing.slice(1)}</span>
        {b.wage !== undefined && <span class="label num">{usd(b.wage)} a week</span>}
      </span>
    </div>
  );
}

export function ProjectBlock({ b }: { b: Extract<Block, { t: 'project' }> }) {
  return (
    <div class="insp-card">
      <b>Crew project: {b.title}</b>
      {b.rows.map((r) => (
        <span key={r.role} class="row" style={{ gap: 8, alignItems: 'baseline' }}>
          <i style={{ width: 10, height: 10, borderRadius: 99, background: ROLE_TINT[r.role], flex: 'none' }} />
          <span>
            <b>{r.mine ? 'You' : r.who}</b>: {r.job} · <span class="label">{r.state}</span>
          </span>
        </span>
      ))}
    </div>
  );
}

/** the analyst's inline hire: the candidate's dollar effect, then one confirm */
export function HireCard({ ctl, a, onDone }: { ctl: Ctl; a: Extract<Act, { t: 'hire' }>; onDone(): void }) {
  const [sure, setSure] = useState(false);
  const later = a.start > ctl.s.week;
  return (
    <div class="insp-card">
      <span class="row spread">
        <b>
          Hire {a.name}, {a.role.toLowerCase()}
        </b>
        <Dots skill={a.skill} />
      </span>
      <span class="label num">
        asks {usd(a.ask)} a week · {later ? `starts week ${a.start}` : 'starts this week'}
      </span>
      <span>{a.does}</span>
      <span class="label">{a.need}</span>
      <b class={a.net >= 0 ? 'good' : 'bad'}>{a.money}</b>
      {!a.ok && <span class="label">{a.why}</span>}
      {a.ok && !sure && (
        <Btn small onClick={() => setSure(true)}>
          Hire {a.name} · {usd(a.ask)}/wk
        </Btn>
      )}
      {a.ok && sure && (
        <div class="row" style={{ gap: 8 }}>
          <Btn
            small
            onClick={async () => {
              if (await ctl.dispatch({ t: 'hire', cand: a.cand })) {
                fx.good();
                toast(`${a.name} is on the payroll${later ? ` from week ${a.start}` : ''}.`);
                onDone();
              }
            }}
          >
            Confirm the hire
          </Btn>
          <Btn small kind="ghost" onClick={() => setSure(false)}>
            Not now
          </Btn>
        </div>
      )}
    </div>
  );
}

export function LetGoCard({ ctl, a, onDone }: { ctl: Ctl; a: Extract<Act, { t: 'letGo' }>; onDone(): void }) {
  const [sure, setSure] = useState(false);
  return (
    <div class="insp-card">
      {!sure ? (
        <Btn small kind="ghost" disabled={!a.ok} onClick={() => setSure(true)}>
          {a.severance ? `Let ${a.name} go · ${usd(a.severance)} severance` : `Withdraw ${a.name}'s hire · no cost`}
        </Btn>
      ) : (
        <>
          <span>{a.need}</span>
          <b class="bad">{a.money}</b>
          <div class="row" style={{ gap: 8 }}>
            <Btn
              small
              kind="danger"
              onClick={async () => {
                if (await ctl.dispatch({ t: 'letGo', npc: a.npc })) {
                  toast(a.severance ? `${a.name} left the island: ${usd(a.severance)} severance.` : `${a.name}'s hire withdrawn.`);
                  onDone();
                }
              }}
            >
              {a.severance ? 'Let go' : 'Withdraw'}
            </Btn>
            <Btn small kind="ghost" onClick={() => setSure(false)}>
              Keep {a.name}
            </Btn>
          </div>
        </>
      )}
      {!a.ok && <span class="label">{a.why}</span>}
    </div>
  );
}

/** the analyst's extra cottage from the build site: its numbers, then one confirm */
export function BuildCard({ ctl, a }: { ctl: Ctl; a: Extract<Act, { t: 'build' }> }) {
  const [sure, setSure] = useState(false);
  return (
    <div class="insp-card">
      <span>{a.text}</span>
      {!a.ok && <span class="label">{a.why}</span>}
      {a.ok && !sure && (
        <Btn small kind={a.plain ? 'ghost' : 'soft'} onClick={() => setSure(true)}>
          {a.label}
        </Btn>
      )}
      {a.ok && sure && (
        <div class="row" style={{ gap: 8 }}>
          <Btn
            small
            onClick={async () => {
              setSure(false);
              if (await ctl.dispatch({ t: 'build', what: 'cottage' })) {
                fx.good();
                toast('Ordered: the prefab shell is on its way.');
              }
            }}
          >
            Confirm · {usd(a.usd)}
          </Btn>
          <Btn small kind="ghost" onClick={() => setSure(false)}>
            Not now
          </Btn>
        </div>
      )}
    </div>
  );
}
