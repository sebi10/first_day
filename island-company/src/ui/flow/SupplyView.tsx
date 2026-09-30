// A materials slot (the electrician's, and the generator's parts): the supply
// catalog, opened at the slot's category with each item's spec line, a search
// over the trade's whole catalog, and chapter chips to browse. Tiers 0-2 add
// the catalog's teaching badges ("for 20 A circuits", "not TR: TR is required
// in dwellings"), tiers 0-1 mark the right device. Also "Add a line" for either
// trade (any item of the trade; tools come with the task, never as a pick).
import { useState } from 'preact/hooks';
import { itemById } from '../../sim/items';
import { rowBadges, search, specLine, supplyIndex, type Doc } from '../../sim/search';
import type { MainSlot } from '../../sim/tasks';
import type { Alert, IslandState, ItemId } from '../../sim/types';
import { fx } from '../feedback';
import { toast } from '../kit';
import { Chip, ChipRow, SearchBar } from './Search';
import { ShelfBadge } from './StockBadge';
import { assetOf, likelyItems, slotDocs, tierOf } from './steps';

export function SupplyView({ s, a, slot, onPick, onBack, title }: { s: IslandState; a: Alert; slot: MainSlot | null; onPick(item: ItemId): void; onBack(): void; title?: string }) {
  const asset = assetOf(s, a)!;
  const trade = a.role === 'elec' ? 'elec' : 'mech';
  const ix = supplyIndex(trade);
  const tier = tierOf(s, a);
  const open = slot ? slotDocs(s, a, slot).chapter : '';
  const [chapter, setChapter] = useState(open);
  const [q, setQ] = useState('');
  const hints = likelyItems(s, a, slot?.slot);
  const docs: Doc[] = q ? search(ix, q, { limit: 20 }).map((h) => h.doc) : chapter ? ix.docs.filter((x) => x.chapter === chapter) : [];
  const pick = (doc: Doc) => {
    const x = itemById(doc.ref.item ?? '');
    if (!x) return;
    if (x.kind === 'tool') {
      fx.bad();
      toast('Tools come with the task (the Stock step lists them). To get one for the shop, ask from Stores.');
      return;
    }
    fx.snap();
    onPick(x.id);
  };
  return (
    <div class="col jf-step" style={{ gap: 10 }}>
      <button class="jf-back" onClick={onBack}>
        ◂ {title ?? slot?.label ?? 'Back'}
      </button>
      <SearchBar ix={ix} value={q} onQuery={setQ} label="Search the supply catalog" placeholder={trade === 'elec' ? 'Search the catalog: GFCI 20, 12/3, raintight…' : 'Search: P/N, part, O-ring, oil…'} />
      <ChipRow label="Categories" lead="Categories">
        {ix.chapters.map((c) => (
          <Chip
            key={c.chapter}
            on={chapter === c.chapter && !q}
            onClick={() => {
              setQ('');
              setChapter(chapter === c.chapter ? '' : c.chapter);
            }}
          >
            {c.chapter}
          </Chip>
        ))}
      </ChipRow>
      {!q && !chapter && <p class="muted jf-empty">Search the catalog, or pick a category.</p>}
      {q && !docs.length && <p class="muted jf-empty">Nothing in the catalog for “{q}”.</p>}
      <div class="jf-list" role="list">
        {docs.map((doc) => {
          const x = itemById(doc.ref.item ?? '');
          if (!x) return null;
          const badges = rowBadges(s, asset, doc, tier);
          const spec = specLine(x);
          const hint = hints.has(x.id);
          return (
            <button key={doc.id} role="listitem" class={`jf-row ${hint ? 'likely' : ''} ${x.kind === 'tool' ? 'np' : ''}`} onClick={() => pick(doc)}>
              <span class="col grow" style={{ gap: 2, minWidth: 0 }}>
                <span class="jf-row-title">{doc.title}</span>
                <span class="label">
                  <span class="mono">{x.pn}</span>
                  {spec && x.trade === 'elec' ? ` · ${spec}` : x.trade === 'mech' ? ` · ${doc.sub.split(' · ')[0]}` : ''}
                  {x.kind === 'tool' ? ' · tool' : ''}
                </span>
                <span class="row wrap" style={{ gap: 4 }}>
                  {tier <= 2 && badges.filter((b) => b !== spec).map((b) => <span key={b} class={`jf-badge ${/^not |dry locations/.test(b) ? 'none' : 'info'}`}>{b}</span>)}
                  <ShelfBadge s={s} item={x.id} />
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
