// The stock planner (docs/JOBFLOW.md 14.2, 17.3): the flags strip with its
// one-tap actions, Needs, filter chips and the supply-catalog search, a row per
// item family (on hand, free, on order; 26 weeks of use; its class, ABC by value,
// turnover and days of supply) that opens to its P/Ns, the shop's tools, and
// Receiving at the bottom. A P/N opens its sheet: min/max, buy, return.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ItemId } from '../../sim/types';
import { fx } from '../feedback';
import { Btn, Sheet, toast } from '../kit';
import type { Ctl } from '../useIsland';
import { Spark } from './charts';
import { ItemSheet, type SheetMode } from './ItemSheet';
import { catalogHits, FILTERS, flagsVM, plannerRows, qtyWords, storesLine, toolRows, usd, type FamRowVM, type FlagVM, type ItemRowVM, type PlannerFilter } from './model';
import { Needs } from './Needs';
import { Receiving } from './Receiving';
import { itemById } from '../../sim/items';
import './purchasing.css';

const CLASS_WORD: Record<string, string> = { fast: 'fast', steady: 'steady', slow: 'slow', dead: 'dead', new: 'new' };

/** where the Money tab or a flag sends the planner: a family opened, a filter, receiving */
export type PlannerFocus = { fam?: string; item?: ItemId; filter?: PlannerFilter; receiving?: boolean; n: number };

function Flags({ ctl, onGo }: { ctl: Ctl; onGo(f: FlagVM): void }) {
  const { s } = ctl;
  const flags = flagsVM(s);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  if (!flags.length) return null;
  const shown = all ? flags : flags.slice(0, Math.max(3, flags.filter((f) => f.urgent).length));
  const run = async (f: FlagVM) => {
    if (!f.act || busy) return;
    setBusy(f.key);
    let ok = true;
    for (const a of f.act.acts) ok = (await ctl.dispatch(a)) && ok;
    setBusy(null);
    if (ok) {
      fx.snap();
      toast(f.act.done);
    }
  };
  return (
    <div class="card col" style={{ gap: 0 }} aria-label="Stock flags">
      {shown.map((f) => (
        <div class={`pd-flag ${f.urgent ? 'urgent' : ''}`} key={f.key}>
          <span class="pip" />
          <span class="pd-wrap" style={{ fontSize: 14.5, fontWeight: f.urgent ? 800 : 600 }}>
            {f.text}
          </span>
          {f.act ? (
            <Btn small kind={f.urgent ? 'primary' : 'soft'} disabled={busy === f.key} onClick={() => void run(f)}>
              {f.act.label}
            </Btn>
          ) : f.go ? (
            <Btn small kind="soft" onClick={() => onGo(f)}>
              {f.go.label}
            </Btn>
          ) : null}
        </div>
      ))}
      {flags.length > shown.length && (
        <button class="pd-link" style={{ alignSelf: 'flex-start' }} onClick={() => setAll(true)}>
          Show all {flags.length} flags
        </button>
      )}
    </div>
  );
}

function ItemLine({ it, onOpen }: { it: ItemRowVM; onOpen(id: ItemId): void }) {
  const x = itemById(it.id);
  const q = (n: number) => qtyWords(x, n);
  return (
    <button class="item" onClick={() => onOpen(it.id)} aria-label={`${it.pn}: ${q(it.onHand)} on hand`}>
      <span class="col" style={{ gap: 1, minWidth: 0 }}>
        <b class="pd-ell">
          {it.pn} <span class="pd-muted" style={{ fontWeight: 600 }}>{it.nomen}</span>
        </b>
        <span class="d">
          {it.tool
            ? it.status
            : `${q(it.onHand)} on hand${it.reserved ? ` (${q(it.reserved)} reserved)` : ''}${it.onOrder ? ` · ${q(it.onOrder)} on order${it.eta !== undefined ? ` wk ${it.eta}` : ''}` : ''}${it.rop !== undefined ? ` · min ${it.rop} / max ${it.max}` : ' · no min/max'}${it.bin ? ' · bin' : ''}`}
        </span>
        {it.supsd && <span class="d">{it.supsd}</span>}
      </span>
      <span class="chev">›</span>
    </button>
  );
}

function FamRow({ r, open, toggle, onOpen }: { r: FamRowVM; open: boolean; toggle(): void; onOpen(id: ItemId): void }) {
  const x = r.items[0] ? itemById(r.items[0].id) : undefined;
  const q = (n: number) => qtyWords(x, n);
  return (
    <div id={`fam-${r.fam}`} style={{ scrollMarginTop: 72 }}>
      <button class="fam" onClick={toggle} aria-expanded={open}>
        <span class="name">
          <span>{r.label}</span>
        </span>
        <span class="side">
          <span class="row" style={{ gap: 4 }}>
            {r.cls && <span class={`cls ${r.cls}`}>{CLASS_WORD[r.cls]}</span>}
            {r.abc && <span class="abc">{r.abc}</span>}
          </span>
          <Spark series={r.series} label={`${r.label}: ${r.used} used in ${r.series.length} weeks`} />
        </span>
        <span class="nums">
          {r.urgent && <span class="chip rust">a job waits</span>} <span class="nw">{q(r.onHand)} on hand</span> · <span class="nw">{q(r.free)} free</span>
          {r.onOrder ? (
            <>
              {' · '}
              <span class="nw">
                {q(r.onOrder)} on order{r.etaText ? `, ${r.etaText}` : ''}
              </span>
            </>
          ) : null}
        </span>
        <span class="meta">
          {r.sinceText}
          {r.turns !== null ? ` · ${r.turns} turns/yr` : ''}
          {r.days !== null ? ` · ${r.days} days of supply` : ''}
          {r.forecast ? ` · next 4 wk ~${r.forecast}${r.known ? ` (${r.known} known)` : ''}` : ''}
          {r.spare ? ' · insurance spare' : ''}
          {r.flags.includes('stop') ? ' · flagged: stop' : ''}
          {r.flags.includes('order') && !r.urgent ? ' · flagged: reorder' : ''}
          {r.value ? ` · ${usd(r.value)} on the shelf` : ''}
        </span>
      </button>
      {open && (
        <div class="items">
          {r.items.map((it) => (
            <ItemLine key={it.id} it={it} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  );
}

export function StockPlanner({ ctl, focus }: { ctl: Ctl; focus?: PlannerFocus | null }) {
  const { s } = ctl;
  const [filter, setFilter] = useState<PlannerFilter>('all');
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [openFam, setOpenFam] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ item: ItemId; mode: SheetMode } | null>(null);
  const [limit, setLimit] = useState(24);
  const timer = useRef(0);
  // the search waits 80 ms after the last keystroke (never an index built on a key)
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setDq(q.trim()), 80);
    return () => clearTimeout(timer.current);
  }, [q]);
  // the Money tab or a flag sent us somewhere
  useEffect(() => {
    if (!focus) return;
    if (focus.filter) setFilter(focus.filter);
    if (focus.fam) {
      setFilter('all');
      setOpenFam(focus.fam);
      setLimit(999);
      setTimeout(() => document.getElementById(`fam-${focus.fam}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    }
    if (focus.item) setSheet({ item: focus.item, mode: 'view' });
    if (focus.receiving) setTimeout(() => document.getElementById('receiving')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }, [focus?.n]);
  const st = storesLine(s);
  const rows = filter === 'tools' ? [] : plannerRows(s, filter);
  const tools = filter === 'tools' ? toolRows(s) : [];
  const hits = dq.length >= 2 ? catalogHits(s, dq, filter) : null;
  const go = (f: FlagVM) => {
    const g = f.go;
    if (!g) return;
    if (g.item) setSheet({ item: g.item, mode: f.kind === 'stop' ? 'scrap' : 'view' });
    else if (g.fam) {
      setOpenFam(g.fam);
      setTimeout(() => document.getElementById(`fam-${g.fam}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    }
    if (g.filter) setFilter(g.filter);
    if (g.receiving) document.getElementById('receiving')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  return (
    <div class="pd-sec">
      <div class="card col" style={{ gap: 4 }}>
        <div class="pd-stores">
          <span class={st.total - st.bins < 3 ? 'fault' : ''}>
            Stores {st.bins}/{st.total} bins
          </span>
          <span>{usd(st.value)} on the shelf</span>
          <span>
            {st.open} PO{st.open === 1 ? '' : 's'} on the way{st.onOrder ? ` (${usd(st.onOrder)})` : ''}
          </span>
        </div>
        <span class="pd-note">A min/max refills a line at the resolve; every stocked line holds a bin. Families rank by how often they moved over the ledger's weeks.</span>
      </div>
      <Flags ctl={ctl} onGo={go} />
      <Needs ctl={ctl} />
      <div class="fchips" role="toolbar" aria-label="Filter the planner">
        {FILTERS.map((f) => (
          <button
            key={f.v}
            class="fchip"
            aria-pressed={filter === f.v}
            onClick={() => {
              fx.tap();
              setFilter(f.v);
              setLimit(24);
            }}
          >
            {f.label}
          </button>
        ))}
      </div>
      <input class="pd-search" type="search" value={q} placeholder="Search the supply catalog: P/N, name, NEC…" aria-label="Search the supply catalog" onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
      {hits ? (
        <div class="card col" style={{ gap: 0 }}>
          <span class="label">{hits.length ? `${hits.length} in the catalog` : 'Nothing in the catalog matches.'}</span>
          {hits.map((it) => (
            <ItemLine key={it.id} it={it} onOpen={(id) => setSheet({ item: id, mode: 'view' })} />
          ))}
        </div>
      ) : filter === 'tools' ? (
        <div class="card col" style={{ gap: 0 }}>
          <span class="pd-note">Tools are the shop's: bought once (capex), never used up, no bin. A job that needs one the shop doesn't own waits for it.</span>
          {tools.map((it) => (
            <ItemLine key={it.id} it={it} onOpen={(id) => setSheet({ item: id, mode: 'view' })} />
          ))}
        </div>
      ) : (
        <div class="card col" style={{ gap: 0 }}>
          {!rows.length && <span class="pd-empty">No families here yet.</span>}
          {rows.slice(0, limit).map((r) => (
            <FamRow key={r.fam} r={r} open={openFam === r.fam} toggle={() => setOpenFam(openFam === r.fam ? null : r.fam)} onOpen={(id) => setSheet({ item: id, mode: 'view' })} />
          ))}
          {rows.length > limit && (
            <button class="pd-link" onClick={() => setLimit(999)}>
              Show all {rows.length} families
            </button>
          )}
        </div>
      )}
      <Receiving ctl={ctl} />
      <Sheet open={!!sheet} onClose={() => setSheet(null)} label="Item">
        {sheet && <ItemSheet ctl={ctl} item={sheet.item} mode={sheet.mode} onClose={() => setSheet(null)} />}
      </Sheet>
    </div>
  );
}
