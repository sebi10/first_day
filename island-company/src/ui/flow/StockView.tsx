// Stores, for a tech (read-only): this trade's lines on the shelf (on hand,
// free, reserved for jobs, on order and when), its shop tools, a search over
// the trade's catalog, and Request per item: a stock or tool requisition the
// analyst decides on. The tech's open requests, with Cancel.
import { useState } from 'preact/hooks';
import { itemById, unitWords } from '../../sim/items';
import { CAT_LABEL, search, supplyIndex } from '../../sim/search';
import { available, onHand, onOrderFree, owned, reservedOf, toolComing } from '../../sim/stock';
import type { IslandState, Item, ItemId, OpsRole } from '../../sim/types';
import { fx } from '../feedback';
import { Btn, Icon, usd } from '../kit';
import type { Ctl } from '../useIsland';
import { Qty } from './PartsStep';
import { SearchBar } from './Search';
import { landsWords, nameOf } from './words';

/** this trade's shelf lines under their reorder point (the analyst's min): the Stores chip's "2 low" */
export function lowLines(s: IslandState, trade: OpsRole): ItemId[] {
  return Object.entries(s.inv ?? {})
    .filter(([id, l]) => itemById(id)?.trade === trade && l.rop !== undefined && available(s, id) <= l.rop)
    .map(([id]) => id);
}

const reqCap = (x: Item) => (x.kind === 'tool' ? 1 : x.cut ? 500 : 50);

export function StockView({ ctl, role, onClose }: { ctl: Ctl; role: OpsRole; onClose(): void }) {
  const { s } = ctl;
  const ix = supplyIndex(role);
  const [q, setQ] = useState('');
  const [ask, setAsk] = useState<{ item: ItemId; qty: number; why: string } | null>(null);
  const ended = !!s.turns[role]?.ended;
  const lines = Object.entries(s.inv ?? {})
    .map(([id, l]) => ({ id, l, x: itemById(id) }))
    .filter((r): r is { id: string; l: NonNullable<IslandState['inv']>[string]; x: Item } => !!r.x && r.x.trade === role && r.x.kind !== 'tool' && (r.l.on > 0 || r.l.rop !== undefined))
    .sort((a, b) => (a.x.cat < b.x.cat ? -1 : a.x.cat > b.x.cat ? 1 : a.x.pn < b.x.pn ? -1 : 1));
  const tools = ix.docs.map((d) => itemById(d.ref.item ?? '')).filter((x): x is Item => !!x && x.kind === 'tool');
  const hits = q ? search(ix, q, { limit: 20 }).map((h) => itemById(h.doc.ref.item ?? '')).filter((x): x is Item => !!x) : [];
  const mine = (s.reqs ?? []).filter((r) => r.role === role && (r.status === 'open' || r.status === 'ordered' || r.closed === s.week));
  const send = async () => {
    if (!ask) return;
    const ok = await ctl.dispatch({ t: 'request', role, item: ask.item, qty: ask.qty, ...(ask.why.trim() ? { why: ask.why.trim() } : {}) });
    if (ok) {
      fx.good();
      setAsk(null);
    }
  };
  const row = (x: Item) => {
    const on = onHand(s, x.id);
    const free = available(s, x.id);
    const res = reservedOf(s, x.id);
    const ord = onOrderFree(s, x.id);
    const line = s.inv?.[x.id];
    return (
      <div key={x.id} class="jf-inv-row" role="listitem">
        <span class="col grow" style={{ gap: 2, minWidth: 0 }}>
          <b class="jf-row-title">{x.trade === 'mech' ? `${x.pn} ${x.nomen}` : x.nomen}</b>
          <span class="label">
            {x.trade === 'elec' ? `${x.pn} · ` : ''}
            {CAT_LABEL[x.cat]}
            {line?.rop !== undefined ? ` · min ${line.rop} / max ${line.max}` : ''}
          </span>
          <span class="row wrap" style={{ gap: 4 }}>
            <span class={`jf-badge ${free > 0 ? 'ok' : on > 0 ? 'short' : 'none'}`}>
              {on === 0 ? 'none on hand' : free > 0 ? `${unitWords(x, on)} on hand${res ? ` · ${res} for jobs` : ''}` : `${unitWords(x, on)} on hand · all for jobs`}
            </span>
            {ord.qty > 0 && <span class="jf-badge coming">{unitWords(x, ord.qty)} on order{ord.eta !== undefined ? `, ${landsWords(s.week, ord.eta)}` : ''}</span>}
          </span>
        </span>
        <Btn small kind="soft" disabled={ended} onClick={() => setAsk({ item: x.id, qty: 1, why: '' })}>
          Request
        </Btn>
      </div>
    );
  };
  if (ask) {
    const x = itemById(ask.item)!;
    return (
      <div class="col" style={{ gap: 12 }}>
        <button class="jf-back" onClick={() => setAsk(null)}>
          ◂ Stores
        </button>
        <h2>Ask {nameOf(s, 'fin')} for it</h2>
        <b>{x.trade === 'mech' ? `${x.pn} ${x.nomen}` : x.nomen}</b>
        <span class="label">
          {usd(x.price)} a {x.packName ?? (x.unit === 'ea' ? 'unit' : x.unit)}
          {x.pack > 1 ? ` of ${x.pack}` : ''} at list{x.kind === 'tool' ? ' · a tool: capex, kept for good' : ''}
        </span>
        {x.kind !== 'tool' && (
          <div class="row spread">
            <span>How many</span>
            <Qty value={ask.qty} unit={x.unit} onChange={(n) => setAsk({ ...ask, qty: Math.min(reqCap(x), n) })} />
          </div>
        )}
        <label class="col" style={{ gap: 4 }}>
          <span class="label">Why (optional: the analyst sees it)</span>
          <input class="jf-text" maxLength={120} value={ask.why} placeholder={role === 'mech' ? 'e.g. the L/H tire is close to the limit' : 'e.g. the villas need spare GFCIs'} onInput={(e) => setAsk({ ...ask, why: (e.target as HTMLInputElement).value })} />
        </label>
        <Btn block disabled={ended} onClick={send}>
          Send the request to {nameOf(s, 'fin')} ▸
        </Btn>
        <span class="label">It's {nameOf(s, 'fin')}'s call: a requisition waits on the desk until it's bought or deferred.</span>
      </div>
    );
  }
  return (
    <div class="col" style={{ gap: 12 }}>
      <div class="row spread">
        <h2>Stores · {role === 'mech' ? 'hangar' : 'electrical'}</h2>
        <button class="jf-x" aria-label="Close" onClick={onClose}>
          <Icon name="x" size={18} />
        </button>
      </div>
      <span class="label">Read-only: {nameOf(s, 'fin')} buys and sets the minimums. Near-miss stock sits on these shelves too: on hand doesn't mean it fits.</span>
      <SearchBar ix={ix} value={q} onQuery={setQ} label="Search the catalog" placeholder="Search the catalog to request anything…" />
      {q ? (
        <div class="col" role="list" style={{ gap: 0 }}>
          {!hits.length && <p class="muted jf-empty">Nothing in the catalog for “{q}”.</p>}
          {hits.map(row)}
        </div>
      ) : (
        <>
          {mine.length > 0 && (
            <div class="col" style={{ gap: 6 }}>
              <span class="label">Your requests</span>
              {mine.map((r) => {
                const x = itemById(r.item);
                return (
                  <div key={r.id} class="jf-inv-row">
                    <span class="col grow" style={{ gap: 2, minWidth: 0 }}>
                      <b class="jf-row-title">
                        {r.qty} × {x?.pn ?? r.item}
                      </b>
                      <span class="label">
                        {r.status === 'open' ? `waiting on ${nameOf(s, 'fin')}${r.deferredWeek === s.week ? ' (deferred this week)' : ''}` : r.status === 'ordered' ? `ordered${r.po ? ` on ${r.po}` : ''}` : r.status}
                        {r.why ? ` · “${r.why}”` : ''}
                        {r.order ? ' · for a job' : ''}
                      </span>
                    </span>
                    {r.status === 'open' && (
                      <Btn small kind="ghost" disabled={ended} onClick={() => void ctl.dispatch({ t: 'cancelReq', role, req: r.id })}>
                        Cancel
                      </Btn>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <span class="label">On the shelf</span>
          <div class="col" role="list" style={{ gap: 0 }}>
            {lines.length ? lines.map((r) => row(r.x)) : <p class="muted jf-empty">Nothing of yours on the shelf.</p>}
          </div>
          <span class="label">Shop tools</span>
          <div class="col" role="list" style={{ gap: 0 }}>
            {tools.map((x) => (
              <div key={x.id} class="jf-inv-row" role="listitem">
                <span class="col grow" style={{ gap: 2, minWidth: 0 }}>
                  <b class="jf-row-title">{x.nomen}</b>
                  <span class="label">
                    {x.pn} · {usd(x.price)}
                  </span>
                </span>
                {owned(s, x.id) ? (
                  <span class="jf-badge ok">owned ✓</span>
                ) : toolComing(s, x.id) ? (
                  <span class="jf-badge coming">on order</span>
                ) : (
                  <Btn small kind="soft" disabled={ended} onClick={() => setAsk({ item: x.id, qty: 1, why: '' })}>
                    Request
                  </Btn>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
