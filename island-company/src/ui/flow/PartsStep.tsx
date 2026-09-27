// The Parts step (the electrician's Materials): one row per main slot of the
// chosen task ("Tire × 1 · pick from the IPC"; "if needed" slots marked), a
// rare job's pre-filled line, "Not in the IPC · research the records" under
// every IPC slot, extra lines, and at tier 3+ the recent tasks on this
// airplane. A tap on a slot opens its search (the IPC, or the catalog).
import { itemById } from '../../sim/items';
import type { Alert, IslandState } from '../../sim/types';
import { fx } from '../feedback';
import { Icon } from '../kit';
import { IpcView } from './IpcView';
import { StockBadge } from './StockBadge';
import { SupplyView } from './SupplyView';
import { assetOf, extraLines, fixedLines, lineWords, protection, recentTasks, siteWords, slotRows, stockRows, taskFor, tierOf, type Draft, type DraftAct } from './steps';
import { siteOf } from '../../sim/alerts';

export function PartsStep({ s, a, d, act, readOnly }: { s: IslandState; a: Alert; d: Draft; act(x: DraftAct): void; readOnly?: boolean }) {
  const t = taskFor(s, a, d.task);
  const asset = assetOf(s, a);
  if (!t || !asset) return null;
  const tier = tierOf(s, a);
  const rows = slotRows(s, a, d);
  const open = d.slot ? rows.find((r) => r.slot.slot === d.slot)?.slot : undefined;
  if (d.slot === '+')
    return <SupplyView s={s} a={a} slot={null} title="Add a line" onBack={() => act({ t: 'openSlot', slot: undefined })} onPick={(item) => act({ t: 'add', item })} />;
  if (open) {
    const back = () => act({ t: 'openSlot', slot: undefined });
    const fill = (item: string) => act({ t: 'fill', slot: open.slot, item });
    return open.ata && open.tag && asset.kind === 'plane' ? <IpcView s={s} a={a} slot={open} onBack={back} onPick={fill} /> : <SupplyView s={s} a={a} slot={open} onBack={back} onPick={fill} />;
  }
  const stock = stockRows(s, a, d);
  const badgeFor = (item: string, slot?: string) => stock.find((r) => r.item === item && r.slot === slot && r.from !== 'bench' && r.from !== 'tool');
  const prot = protection(s, a, d);
  const fixed = fixedLines(s, a, t);
  const site = siteOf(s, a);
  const recent = tier >= 3 && asset.kind === 'plane' ? recentTasks(s, asset.id) : [];
  const extras = extraLines(d);
  return (
    <div class="col jf-step" style={{ gap: 10 }}>
      <button class="jf-taskline" onClick={() => act({ t: 'go', step: 'manual' })} disabled={readOnly}>
        <span class="label">{t.book === 'REF' ? 'Reference' : t.book}</span> <b>{t.no}</b> {t.title}
      </button>
      {site && a.role === 'elec' && <span class="label">Site: {siteWords(site)}</span>}
      {prot.unmet && (
        <div class="jf-note warn">
          This room needs <b>{prot.words}</b> protection on a replacement: {prot.words.includes('+') ? 'a DF device, or the device and a DF breaker' : 'from the device, or a breaker in the protection slot'}.
        </div>
      )}
      {fixed.length > 0 && (
        <div class="jf-slot filled">
          <span class="col grow" style={{ gap: 2 }}>
            <span class="label">Pre-filled: {t.book === 'REF' ? "the supply house's quote for the take-off" : "the engine maker's exchange unit"}</span>
            {fixed.map((l) => (
              <b key={l.item}>{lineWords(l.item, l.qty)}</b>
            ))}
          </span>
        </div>
      )}
      {rows.map((r) => {
        const x = r.line ? itemById(r.line.item) : undefined;
        const b = r.line ? badgeFor(r.line.item, r.slot.slot) : undefined;
        return (
          <div key={r.slot.slot} class={`jf-slot ${r.line ? 'filled' : ''} ${r.highlight ? 'hl' : ''} ${r.research ? 'research' : ''}`}>
            <button class="jf-slot-main" disabled={readOnly} onClick={() => act({ t: 'openSlot', slot: r.slot.slot })} aria-label={`${r.slot.label}: ${r.line ? 'change' : 'pick'}`}>
              <span class="col grow" style={{ gap: 2, minWidth: 0 }}>
                <span class="row" style={{ gap: 6 }}>
                  <b>{r.label}</b>
                  {r.optional && <span class="label">if needed</span>}
                  {r.highlight && <span class="chip rust">needed here</span>}
                </span>
                {r.research ? (
                  <span class="jf-fill">Not in the IPC: sent to research the records</span>
                ) : x && r.line ? (
                  <span class="jf-fill">
                    {r.takeoff ? `${lineWords(x.id, r.line.qty)}` : x.trade === 'mech' ? (
                      <>
                        <b class="mono">{x.pn}</b> {x.nomen}
                      </>
                    ) : (
                      <>
                        {x.nomen} <span class="mono label">{x.pn}</span>
                      </>
                    )}
                  </span>
                ) : (
                  <span class="jf-fill empty">{r.ipc ? 'Pick from the IPC ▸' : `Pick from the catalog ▸`}</span>
                )}
              </span>
              {!r.line && !r.research && <Icon name="box" size={20} />}
            </button>
            {r.line && x && !readOnly && (
              <div class="row jf-slot-ctl">
                {b && <StockBadge row={b} week={s.week} />}
                <span class="grow" />
                <Qty value={r.line.qty} unit={x.unit} onChange={(q) => act({ t: 'qty', index: r.index!, qty: q })} />
                <button class="jf-x" aria-label={`Clear ${r.slot.label}`} onClick={() => act({ t: 'clear', slot: r.slot.slot })}>
                  <Icon name="x" size={16} />
                </button>
              </div>
            )}
            {r.ipc && !r.research && !readOnly && (
              <button class="jf-link" onClick={() => act({ t: 'research', slot: r.slot.slot })}>
                Not in the IPC · research the records
              </button>
            )}
            {r.research && !readOnly && (
              <button class="jf-link" onClick={() => act({ t: 'research', slot: undefined })}>
                Undo: it's in the IPC after all
              </button>
            )}
          </div>
        );
      })}
      {extras.map(({ l, index }) => {
        const x = itemById(l.item);
        const b = stock.find((r) => r.item === l.item && r.from === 'pick' && !r.slot);
        return (
          <div key={`x${index}`} class="jf-slot filled">
            <span class="col grow" style={{ gap: 2 }}>
              <span class="label">Extra line</span>
              <span class="jf-fill">{x ? (x.trade === 'mech' ? `${x.pn} ${x.nomen}` : x.nomen) : l.item}</span>
            </span>
            {!readOnly && (
              <div class="row jf-slot-ctl">
                {b && <StockBadge row={b} week={s.week} />}
                <span class="grow" />
                <Qty value={l.qty} unit={x?.unit ?? 'ea'} onChange={(q) => act({ t: 'qty', index, qty: q })} />
                <button class="jf-x" aria-label="Remove the line" onClick={() => act({ t: 'remove', index })}>
                  <Icon name="x" size={16} />
                </button>
              </div>
            )}
          </div>
        );
      })}
      {!readOnly && d.pick.length < 10 && !t.fixed && (
        <button class="jf-link" onClick={() => act({ t: 'openSlot', slot: '+' })}>
          + Add a line
        </button>
      )}
      {recent.length > 0 && (
        <div class="col" style={{ gap: 6 }}>
          <span class="label">Recent on this airplane</span>
          <div class="row wrap" style={{ gap: 6 }}>
            {recent.map((x) => (
              <span key={x.task} class="chip">
                {x.no} · wk {x.week}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** a quantity stepper: − n + (feet step by 5) */
export function Qty({ value, unit, onChange }: { value: number; unit: string; onChange(q: number): void }) {
  const step = unit === 'ft' ? 5 : 1;
  const words = unit === 'ea' ? String(value) : unit === 'use' ? `${value} use${value === 1 ? '' : 's'}` : `${value} ${unit}`;
  return (
    <span class="jf-qty">
      <button
        aria-label="Fewer"
        disabled={value <= 1}
        onClick={() => {
          fx.tick();
          onChange(Math.max(1, value - step));
        }}
      >
        −
      </button>
      <b class="num">{words}</b>
      <button
        aria-label="More"
        onClick={() => {
          fx.tick();
          onChange(value + step);
        }}
      >
        +
      </button>
    </span>
  );
}
