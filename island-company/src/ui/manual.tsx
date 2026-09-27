// The manual: a mechanic job on a plane opens with its AMM task card, the way
// the A&P works ("When I get a task I get a manual. I follow manual."). The
// plane's data plate (registration, model, S/N, SBs complied with), then the
// card: task number, effectivity, warnings and cautions, the procedure, and
// the torques and servicing values with BOTH effectivities printed as the
// manual prints them. Tiers 0-2 mark the line for this airplane; from tier 3
// matching the S/N and the SB status is the mechanic's job. On an assembly an
// STC or a field approval replaced, the alteration's ICA governs: its values are
// printed first, and the airframe manual's are kept, marked replaced.
import { externalPower, fmtDate, fmtTorque, icaCardFor, type Aircraft, type AmmTask, type IcaCard } from '../sim/aircraft';
import { islandAircraft, openChain, taskCardFor } from '../sim/chain';
import { launchTier } from '../sim/econ';
import type { IslandState, Order } from '../sim/types';

/** the alteration on this airplane whose ICA replaces an assembly (an STC or a field approval; a PMA part alters nothing) */
const alterationOf = (ac: Aircraft) => (ac.plant && ac.plant.via !== 'pma' ? icaCardFor(ac, ac.plant.ata) : undefined);

/** The plate: what a mechanic reads off the airplane and its records before the job. */
export function DataPlate({ ac }: { ac: Aircraft }) {
  const sbs = ac.sbs.filter((x) => x.ipcAta);
  const alt = alterationOf(ac);
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
        {sbs.length
          ? sbs.map((x, i) => (
              <span key={x.id}>
                {i ? ', ' : ''}
                {x.id} ({fmtDate(x.date)})
                {/* an SB on an assembly the alteration took off the airplane no longer applies */}
                {alt && x.ipcAta === alt.ata ? (
                  <b class="sb-na">
                    {' '}
                    n/a: {alt.removed.replace(/ removed$/, '')} removed by {alt.approval}
                  </b>
                ) : null}
              </span>
            ))
          : 'none of the IPC figure SBs'}
      </div>
      {alt && (
        <div class="label">
          Altered: <b>{alt.approval}</b> ({alt.holder}), {alt.title}. ICA: {alt.doc}.
        </div>
      )}
    </div>
  );
}

function Mark({ on, marked, off }: { on: boolean; marked: boolean; off?: string }) {
  if (!marked) return null;
  return on ? <span class="chip palm eff-mark">◀ this airplane</span> : <span class="label eff-off">{off ?? 'not this airplane'}</span>;
}

/** One effectivity line as printed: code, what it covers, the value. `off`: why it isn't this airplane's (an assembly replaced). */
function EffLine({ eff, effText, children, applies, marked, off }: { eff?: string; effText?: string; children: preact.ComponentChildren; applies: boolean; marked: boolean; off?: string }) {
  return (
    <div class={`eff-line ${marked && !applies ? 'dim' : ''}`}>
      <div class="eff-head">
        <span class="eff-code">{eff ?? 'ALL'}</span>
        <span class="label grow">{effText ?? 'all airplanes'}</span>
        <Mark on={applies} marked={marked} off={off} />
      </div>
      <div class="eff-val">{children}</div>
    </div>
  );
}

/** The alteration's ICA values: this airplane's on the assembly it replaced. */
function IcaBlock({ ica, marked }: { ica: IcaCard; marked: boolean }) {
  const effText = `${ica.doc} · ${ica.approval}`;
  return (
    <div class="col ica-block" style={{ gap: 4 }}>
      <span class="label">
        ICA for the alteration · {ica.holder}: {ica.title}
      </span>
      {ica.torques.map((q) => (
        <EffLine key={q.key} eff="ICA" effText={effText} applies marked={marked}>
          {q.what}: <b class="num">{fmtTorque(q)}</b>
          {q.note ? <span class="label"> · {q.note}</span> : null}
        </EffLine>
      ))}
      {ica.fluids && (
        <EffLine eff="ICA" effText={effText} applies marked={marked}>
          Hydraulic fluid: <b>{ica.fluids.join(' or ')} only</b>
        </EffLine>
      )}
      {ica.notes.slice(0, 2).map((n) => (
        <span class="label" key={n}>
          {n}
        </span>
      ))}
    </div>
  );
}

/** The task card as the manual prints it. `ica`: the alteration that replaced this card's assembly on this airplane. */
export function TaskCard({ t, marked, ica }: { t: AmmTask; marked: boolean; ica?: IcaCard }) {
  // the airframe manual's lines for what the alteration replaced: printed, never this airplane's
  const off = ica ? `not this airplane: assembly replaced by ${ica.approval}` : undefined;
  const tqReplaced = (key: string) => !!ica?.torques.some((q) => q.key === key);
  const flReplaced = (key: string) => key === 'fluid' && !!ica?.fluids;
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
      {ica && <IcaBlock ica={ica} marked={marked} />}
      {t.torques.length > 0 && (
        <div class="col" style={{ gap: 4 }}>
          <span class="label">Torques{ica && t.torques.some((q) => tqReplaced(q.key)) ? ' (airframe manual)' : ''}</span>
          {t.torques.map((q, i) => {
            const gone = tqReplaced(q.key);
            return (
              <EffLine key={i} eff={q.eff} effText={q.effText} applies={gone ? false : q.applies} marked={marked && (!!q.eff || gone)} off={gone ? off : undefined}>
                {q.what}: <b class="num">{fmtTorque(q)}</b>
                {q.note ? <span class="label"> · {q.note}</span> : null}
              </EffLine>
            );
          })}
        </div>
      )}
      {t.servicing.length > 0 && (
        <div class="col" style={{ gap: 4 }}>
          <span class="label">Servicing</span>
          {t.servicing.map((x, i) => {
            const gone = flReplaced(x.key);
            return (
              <EffLine key={i} eff={x.eff} effText={x.effText} applies={gone ? false : x.applies} marked={marked} off={gone ? off : undefined}>
                {x.what}: <b>{x.text}</b>
              </EffLine>
            );
          })}
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

/** The part chain's steps work to the part's own task card (the brake linings' card, not the wheel's). */
const PART_TASK: Record<string, string> = { lining: 'brake', propBolt: 'prop', filter: 'powerpack', resCap: 'powerpack', radio: 'radio', generator: 'alternator' };

/** A ground power start: the flight manual's procedure and this airplane's external power placard. */
function ExternalPowerCard({ ac, marked }: { ac: Aircraft; marked: boolean }) {
  const ep = externalPower(ac);
  const gen = ep.turbine ? 'Generator' : 'Alternator';
  const steps = [
    'Avionics master OFF',
    `Battery ${ep.turbine ? 'switch' : 'master'} ${ep.battery === 'on' ? 'ON' : 'OFF'} (placard)`,
    `${gen} OFF`,
    `Cart output ${ep.volts} V DC`,
    ...(ep.ampMax ? [`Cart current limit ${ep.ampMax} A, not over`] : []),
    'Plug in, push until fully seated (the external power relay closes on the short pin)',
    'Cart ON; check the voltage on the bus',
    ep.turbine ? 'Starter ON; fuel ON at the N1 the AFM gives; starter OFF at idle; watch ITT' : 'Start: let go of the key when it fires',
    'Cart OFF, unplug, cable back on the cart; the cart back on the charger',
    `${gen} ON, avionics master ON`,
  ];
  return (
    <div class="col task-card" style={{ gap: 8 }}>
      <div class="row spread" style={{ alignItems: 'baseline' }}>
        <b>
          {ac.designation} {ep.manual}
        </b>
        <span class="label">normal procedures</span>
      </div>
      <span style={{ fontWeight: 700 }}>Starting engine with external power</span>
      <div class="ep-placard mono">{ep.placard}</div>
      <div class="col" style={{ gap: 4 }}>
        <EffLine eff="ALL" effText="this airplane's placard" applies marked={false}>
          Voltage: <b class="num">{ep.volts} V DC</b>
        </EffLine>
        <EffLine eff="ALL" effText="this airplane's placard" applies marked={false}>
          Start current limit: <b class="num">{ep.ampMax ? `${ep.ampMax} A max` : 'not placarded (piston)'}</b>
        </EffLine>
        <EffLine eff="ALL" effText="this airplane's placard" applies marked={false}>
          Battery {ep.turbine ? 'switch' : 'master'}: <b>{ep.battery === 'on' ? 'ON' : 'OFF'}</b> for the start
        </EffLine>
      </div>
      {marked ? (
        <details class="amm-steps">
          <summary>Procedure · {steps.length} steps</summary>
          <ol>
            {steps.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ol>
        </details>
      ) : (
        <span class="label">The procedure is in the {ep.manual} on board: the placard by the receptacle is what the cart is set to.</span>
      )}
    </div>
  );
}

/** The Manual section of a mechanic job on a plane: its data plate and task card (none for jobs the manual module has no card for). */
export function ManualSection({ s, o }: { s: IslandState; o: Order }) {
  const asset = s.assets.find((a) => a.id === o.assetId);
  if (!asset || asset.kind !== 'plane' || o.role !== 'mech') return null;
  const ac = islandAircraft(s.seed, asset);
  // a part chain's lookup, research, check or card: the part's own task, not the card of the job that found it
  const ch = o.chain && o.chain.step !== 'job' ? openChain(s) : null;
  const part = ch && ch.id === o.chain!.id ? PART_TASK[ch.tag] : undefined;
  const t = taskCardFor(ac, part ?? o.job ?? o.kind);
  const gpu = o.kind === 'gpustart';
  const alt = alterationOf(ac);
  const ica = t && alt && alt.ata === t.ata ? alt : undefined;
  // teaching tiers mark the line for this airplane; the tier is the one this job plays at
  const marked = launchTier(s, o, 'mech') <= 2;
  const head = t ? `${t.taskNo} · ${t.title}` : gpu ? `${externalPower(ac).manual} · Starting with external power` : `${ac.registration} records`;
  return (
    <details class="card manual" open>
      <summary>
        <span class="label">Manual</span> <b>{head}</b>
      </summary>
      <div class="col" style={{ gap: 10, marginTop: 8 }}>
        <DataPlate ac={ac} />
        {t ? (
          <TaskCard t={t} marked={marked} ica={ica} />
        ) : gpu ? (
          <ExternalPowerCard ac={ac} marked={marked} />
        ) : (
          <span class="label">No task card for this job in the manual set on the island: the data plate and the records are what you work from.</span>
        )}
        {t && !marked && (
          <span class="label">
            Both effectivities are printed. The data plate and the SB record say which one is this airplane's{ica ? ', and on an altered assembly the ICA governs' : ''}.
          </span>
        )}
      </div>
    </details>
  );
}

/** Mechanic jobs on a plane open their detail first: read the manual, then start. */
export function hasManual(s: IslandState, o: Order) {
  const asset = s.assets.find((a) => a.id === o.assetId);
  return !!asset && asset.kind === 'plane' && o.role === 'mech';
}
