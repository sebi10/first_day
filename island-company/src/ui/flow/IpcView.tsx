// A mechanic's part slot: the airplane's own IPC, opened at the task's figure
// (the rows in print order, with EFF, UPA, SUPSD BY and its INTCHG code, NP and
// ALT as printed), then the FAA-PMA and engineering-approved rows for it. A
// search covers every figure. Tiers 0-2 add the badges built from the
// airplane's paperwork ("◀ this airplane", "SUPSD: order …"), tiers 0-1 mark
// the right row; tier 3+ shows the book as printed. The shelf badge says only
// what's on the shelf (near-miss stock sits there too).
import { useEffect, useRef, useState } from 'preact/hooks';
import { ipcFor, type AnyAta, type IpcRow } from '../../sim/aircraft';
import { islandAircraft } from '../../sim/chain';
import { ipcIndex, rowBadges, search, type Doc } from '../../sim/search';
import type { MainSlot } from '../../sim/tasks';
import type { Alert, IslandState, ItemId } from '../../sim/types';
import { fx } from '../feedback';
import { toast } from '../kit';
import { DataPlate } from '../manual';
import { Chip, ChipRow, SearchBar } from './Search';
import { ShelfBadge } from './StockBadge';
import { assetOf, likelyItems, slotDocs, tierOf } from './steps';

export function IpcView({ s, a, slot, onPick, onBack }: { s: IslandState; a: Alert; slot: MainSlot; onPick(item: ItemId): void; onBack(): void }) {
  const asset = assetOf(s, a)!;
  const ac = islandAircraft(s.seed, asset);
  const ix = ipcIndex(s, asset);
  const tier = tierOf(s, a);
  const open = slotDocs(s, a, slot).chapter;
  const [fig, setFig] = useState(open);
  const [q, setQ] = useState('');
  const hints = likelyItems(s, a, slot.slot);
  const list = useRef<HTMLDivElement>(null);
  // open at the slot's rows in its figure (the tire rows, the lining rows): the P/N among them is the tech's call
  useEffect(() => {
    if (q || fig !== open) return;
    const el = list.current?.querySelector<HTMLElement>(`[data-tag="${slot.tag}"]`);
    el?.scrollIntoView({ block: 'center' });
  }, [fig, q]);
  const docs = ix.docs.filter((x) => x.chapter === fig);
  const ata = docs.find((x) => x.ref.ata)?.ref.ata as AnyAta | undefined;
  const figure = ata ? ipcFor(ac, ata) : undefined;
  const byRow = new Map(docs.filter((x) => x.ref.row !== undefined).map((x) => [x.ref.row!, x]));
  const extra = docs.filter((x) => x.ref.pma || x.ref.ea);
  const pick = (doc: Doc) => {
    if (!doc.ref.item) {
      fx.bad();
      toast(doc.ref.np ? 'NP: not procurable. Order the next higher assembly.' : 'That line is the assembly: order its parts.');
      return;
    }
    fx.snap();
    onPick(doc.ref.item);
  };
  const hits = q ? search(ix, q, { limit: 20 }).map((h) => h.doc) : [];
  return (
    <div class="col jf-step" style={{ gap: 10 }}>
      <button class="jf-back" onClick={onBack}>
        ◂ {slot.label}
      </button>
      <SearchBar ix={ix} value={q} onQuery={setQ} label={`Search ${ac.registration}'s IPC`} placeholder="Search the IPC: P/N or name…" />
      <ChipRow label="Figures" lead="Figures">
        {ix.chapters.map((c) => (
          <Chip
            key={c.chapter}
            on={fig === c.chapter && !q}
            onClick={() => {
              setQ('');
              setFig(c.chapter);
            }}
          >
            {c.chapter.replace(/^Fig \d+ · /, '')}
          </Chip>
        ))}
      </ChipRow>
      <details class="jf-plate">
        <summary>
          <span class="label">Data plate</span> <b class="mono">{ac.registration}</b> · S/N <b class="mono">{ac.serial}</b>
        </summary>
        <DataPlate ac={ac} />
      </details>
      {q ? (
        <div class="jf-list" role="list">
          {!hits.length && <p class="muted jf-empty">Nothing in this airplane's IPC for “{q}”.</p>}
          {hits.map((doc) => (
            <IpcLine key={doc.id} s={s} a={a} doc={doc} tier={tier} hint={!!doc.ref.item && hints.has(doc.ref.item) && doc.ref.tag === slot.tag} onPick={pick} showFig />
          ))}
        </div>
      ) : (
        figure && (
          <div class="jf-ipc" ref={list}>
            <div class="jf-fig-head">
              <b>
                Fig {figure.fig} · {figure.chapter} {figure.title}
              </b>
              <span class="label">{figure.catalog}</span>
              {figure.effCodes.length > 0 && (
                <div class="jf-eff">
                  {figure.effCodes.map((e) => (
                    <span key={e.code}>
                      <b class="mono">{e.code}</b> {e.text}
                      {tier <= 2 && e.applies ? <span class="jf-mark"> ◀</span> : null}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div role="list">
              {figure.rows.map((row) => {
                const doc = byRow.get(row.item);
                if (!doc) return null;
                return <IpcLine key={doc.id} s={s} a={a} doc={doc} row={row} tier={tier} hint={!!doc.ref.item && hints.has(doc.ref.item) && row.tag === slot.tag} onPick={pick} />;
              })}
            </div>
            {extra.length > 0 && (
              <>
                <span class="label jf-sub">FAA-PMA supplements and engineering authorizations</span>
                <div role="list">
                  {extra.map((doc) => (
                    <IpcLine key={doc.id} s={s} a={a} doc={doc} tier={tier} hint={!!doc.ref.item && hints.has(doc.ref.item) && doc.ref.tag === slot.tag} onPick={pick} />
                  ))}
                </div>
              </>
            )}
          </div>
        )
      )}
      <span class="label">Tap a row to put it in the slot. The shelf badge is only what's in stores: it doesn't say the part fits.</span>
    </div>
  );
}

/** one IPC line as the book prints it: item, P/N, nomenclature (with its indent), EFF, UPA, remarks; then the tier's badges and the shelf */
function IpcLine({ s, a, doc, row, tier, hint, onPick, showFig }: { s: IslandState; a: Alert; doc: Doc; row?: IpcRow; tier: number; hint: boolean; onPick(d: Doc): void; showFig?: boolean }) {
  const asset = assetOf(s, a)!;
  const badges = rowBadges(s, asset, doc, tier).filter((b) => !(tier >= 3 && /^EFF /.test(b)));
  const pn = doc.id.split('@')[0];
  const nomen = row ? row.text : doc.title.slice(pn.length + 1);
  const item = row ? row.item : doc.ref.pma ? 'PMA' : doc.ref.ea ? 'EA' : doc.ref.row ?? '';
  const procurable = !!doc.ref.item;
  return (
    <button role="listitem" class={`jf-row jf-ipc-row ${hint ? 'likely' : ''} ${procurable ? '' : 'np'} ${row?.indent === 0 ? 'assy' : ''}`} data-tag={doc.ref.tag ?? ''} onClick={() => onPick(doc)}>
      <span class="jf-item mono">{item}</span>
      <span class="col grow" style={{ gap: 2, minWidth: 0 }}>
        <b class="mono jf-pn">{pn}</b>
        <span class="jf-nomen">{nomen}</span>
        <span class="label">
          {row ? [row.eff ? `EFF ${row.eff}` : 'EFF ALL', `UPA ${row.upa}`, ...row.notes].join(' · ') : doc.sub}
          {showFig ? ` · ${doc.chapter}` : ''}
        </span>
        {(badges.length > 0 || procurable) && (
          <span class="row wrap" style={{ gap: 4 }}>
            {tier <= 2 && badges.map((b) => <span key={b} class={`jf-badge ${/this airplane|legal|approved/.test(b) ? 'ok' : /not effective|Altered|ICA part|NP/.test(b) ? 'none' : 'info'}`}>{b}</span>)}
            {procurable && <ShelfBadge s={s} item={doc.ref.item!} />}
          </span>
        )}
      </span>
    </button>
  );
}
