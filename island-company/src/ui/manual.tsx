// The manual: a mechanic job on a plane opens with its AMM task card, the way
// the A&P works ("When I get a task I get a manual. I follow manual."). The
// plane's data plate (registration, model, S/N, SBs complied with), then the
// card: task number, effectivity, warnings and cautions, the procedure, and
// the torques and servicing values with BOTH effectivities printed as the
// manual prints them. Tiers 0-2 mark the line for this airplane; from tier 3
// matching the S/N and the SB status is the mechanic's job.
import { fmtDate, fmtTorque, type Aircraft, type AmmTask } from '../sim/aircraft';
import { islandAircraft, taskCardFor } from '../sim/chain';
import { launchTier } from '../sim/econ';
import type { IslandState, Order } from '../sim/types';

/** The plate: what a mechanic reads off the airplane and its records before the job. */
export function DataPlate({ ac }: { ac: Aircraft }) {
  const sbs = ac.sbs.filter((x) => x.ipcAta);
  return (
    <div class="plate-card">
      <div class="plate-row">
        <b class="mono">{ac.registration}</b>
        <span>
          {ac.designation} · S/N <b class="mono">{ac.serial}</b> · {ac.year}
        </span>
      </div>
      <div class="label">
        SBs complied with:{' '}
        {sbs.length ? sbs.map((x, i) => (
          <span key={x.id}>
            {i ? ', ' : ''}
            {x.id} ({fmtDate(x.date)})
          </span>
        )) : 'none of the IPC figure SBs'}
      </div>
    </div>
  );
}

function Mark({ on, marked }: { on: boolean; marked: boolean }) {
  if (!marked) return null;
  return on ? <span class="chip palm eff-mark">◀ this airplane</span> : <span class="label eff-off">not this airplane</span>;
}

/** One effectivity line as printed: code, what it covers, the value. */
function EffLine({ eff, effText, children, applies, marked }: { eff?: string; effText?: string; children: preact.ComponentChildren; applies: boolean; marked: boolean }) {
  return (
    <div class={`eff-line ${marked && !applies ? 'dim' : ''}`}>
      <div class="eff-head">
        <span class="eff-code">{eff ?? 'ALL'}</span>
        <span class="label grow">{effText ?? 'all airplanes'}</span>
        <Mark on={applies} marked={marked} />
      </div>
      <div class="eff-val">{children}</div>
    </div>
  );
}

/** The task card as the manual prints it. */
export function TaskCard({ t, marked }: { t: AmmTask; marked: boolean }) {
  return (
    <div class="col task-card" style={{ gap: 8 }}>
      <div class="row spread" style={{ alignItems: 'baseline' }}>
        <b>
          {t.manual.replace(' Maintenance Manual', ' MM')} {t.taskNo}
        </b>
        <span class="label">page block {t.pageBlock}</span>
      </div>
      <span style={{ fontWeight: 700 }}>{t.title}</span>
      <span class="label">Effectivity: {t.effectivity}</span>
      {t.warnings.map((w) => (
        <div class="amm-warn" key={w}>
          <b>WARNING</b> {w}
        </div>
      ))}
      {t.cautions.length > 0 && (
        <div class="amm-caut">
          <b>CAUTION</b>
          {t.cautions.map((c) => (
            <div key={c}>{c}</div>
          ))}
        </div>
      )}
      {t.torques.length > 0 && (
        <div class="col" style={{ gap: 4 }}>
          <span class="label">Torques</span>
          {t.torques.map((q, i) => (
            <EffLine key={i} eff={q.eff} effText={q.effText} applies={q.applies} marked={marked && !!q.eff}>
              {q.what}: <b class="num">{fmtTorque(q)}</b>
              {q.note ? <span class="label"> · {q.note}</span> : null}
            </EffLine>
          ))}
        </div>
      )}
      {t.servicing.length > 0 && (
        <div class="col" style={{ gap: 4 }}>
          <span class="label">Servicing</span>
          {t.servicing.map((x, i) => (
            <EffLine key={i} eff={x.eff} effText={x.effText} applies={x.applies} marked={marked}>
              {x.what}: <b>{x.text}</b>
            </EffLine>
          ))}
        </div>
      )}
      {t.consumables.length > 0 && (
        <div class="col" style={{ gap: 4 }}>
          <span class="label">Consumables</span>
          {t.consumables.map((c, i) => (
            <EffLine key={i} eff={c.eff} effText={c.effText} applies={c.applies} marked={marked && !!c.eff}>
              {c.text}
            </EffLine>
          ))}
        </div>
      )}
      {t.effNotes.length > 0 && (
        <div class="col" style={{ gap: 4 }}>
          <span class="label">Effectivity notes</span>
          {t.effNotes.map((c, i) => (
            <EffLine key={i} eff={c.eff} effText={c.effText} applies={c.applies} marked={marked && !!c.eff}>
              {c.text}
            </EffLine>
          ))}
        </div>
      )}
      <details class="amm-steps">
        <summary>Procedure · {t.steps.length} steps</summary>
        <ol>
          {t.steps.map((s) => (
            <li key={s.n}>
              <span class="label">{s.phase}</span> {s.text}
              {s.torque ? <span class="label"> (torque: see the table)</span> : null}
            </li>
          ))}
        </ol>
      </details>
      <span class="label">{t.notes.join(' ')}</span>
    </div>
  );
}

/** The Manual section of a mechanic job on a plane: its data plate and task card (none for jobs the manual module has no card for). */
export function ManualSection({ s, o }: { s: IslandState; o: Order }) {
  const asset = s.assets.find((a) => a.id === o.assetId);
  if (!asset || asset.kind !== 'plane' || o.role !== 'mech') return null;
  const ac = islandAircraft(s.seed, asset);
  const t = taskCardFor(ac, o.job ?? o.kind);
  // teaching tiers mark the line for this airplane; the tier is the one this job plays at
  const marked = launchTier(s, o, 'mech') <= 2;
  return (
    <details class="card manual" open>
      <summary>
        <span class="label">Manual</span> <b>{t ? `${t.taskNo} · ${t.title}` : `${ac.registration} records`}</b>
      </summary>
      <div class="col" style={{ gap: 10, marginTop: 8 }}>
        <DataPlate ac={ac} />
        {t ? <TaskCard t={t} marked={marked} /> : <span class="label">No task card for this job in the manual set on the island: the data plate and the records are what you work from.</span>}
        {t && !marked && <span class="label">Both effectivities are printed. The data plate and the SB record say which one is this airplane's.</span>}
      </div>
    </details>
  );
}

/** Mechanic jobs on a plane open their detail first: read the manual, then start. */
export function hasManual(s: IslandState, o: Order) {
  const asset = s.assets.find((a) => a.id === o.assetId);
  return !!asset && asset.kind === 'plane' && o.role === 'mech';
}
