// The Manual step (the mechanic's AMM, AFM and the generator manual) and the
// Reference step (the electrician's code and procedure reference): the search
// bar, the keyword chips at the teaching tiers, the chapter chips, the results,
// and a result's card before "Use this task".
import { islandAircraft } from '../../sim/chain';
import { manualIndex, search, type Doc } from '../../sim/search';
import { plannable } from '../../sim/tasks';
import type { Alert, IslandState } from '../../sim/types';
import { fx } from '../feedback';
import { alterationOf, cardForTask, DataPlate, ExternalPowerCard, GsmCard, RefCard, TaskCard, TaskDraws } from '../manual';
import { Chip, ChipRow, SearchBar } from './Search';
import { assetOf, manualDefault, preTask, siteAnswer, taskFor, tierOf, type Draft, type DraftAct } from './steps';

export function ManualView({ s, a, d, act }: { s: IslandState; a: Alert; d: Draft; act(x: DraftAct): void }) {
  const asset = assetOf(s, a);
  if (!asset) return null;
  const tier = tierOf(s, a);
  const elec = a.role === 'elec';
  if (d.preview) return <Preview s={s} a={a} d={d} act={act} />;
  const ix = manualIndex(s, asset, a.role);
  const def = manualDefault(s, a);
  const q = d.query.trim();
  const likely = new Set(def.likely);
  const boost = (doc: Doc) => (likely.has(doc.id) ? 50 : 0);
  const hits: Doc[] = q
    ? search(ix, q, { limit: 20, boost }).map((h) => h.doc)
    : d.chapter
      ? search(ix, '', { chapter: d.chapter, limit: 20 }).map((h) => h.doc)
      : def.results.map((id) => ix.docs.find((x) => x.id === id)!).filter(Boolean);
  const book = elec ? 'the reference' : asset.kind === 'generator' ? 'the generator manual' : 'the AMM';
  return (
    <div class="col jf-step" style={{ gap: 10 }}>
      <SearchBar
        ix={ix}
        value={d.query}
        onQuery={(x) => act({ t: 'query', q: x })}
        label={`Search ${book}`}
        placeholder={elec ? 'Search the reference: GFCI, 406.4, spa…' : asset.kind === 'generator' ? 'Search the manual: oil, hose, mounts…' : 'Search the AMM: brake, 32-42, bleed…'}
      />
      {def.chips.length > 0 && (
        <ChipRow label="From the alert" lead="From the alert">
          {def.chips.map((c) => (
            <Chip key={c} tone="hint" on={q === c} onClick={() => act({ t: 'query', q: q === c ? '' : c })}>
              {c}
            </Chip>
          ))}
        </ChipRow>
      )}
      <ChipRow label="Chapters" lead={elec ? 'Articles' : 'Chapters'}>
        {def.chapters.map((c) => (
          <Chip key={c} on={d.chapter === c && !q} onClick={() => act({ t: 'chapter', chapter: d.chapter === c ? undefined : c })}>
            {c}
          </Chip>
        ))}
      </ChipRow>
      {!q && !d.chapter && !hits.length && (
        <p class="muted jf-empty">
          {elec ? 'Search the code and procedure reference, or pick an article.' : 'Search the manual, or pick a chapter.'} The finding says what's wrong; the book says which task fixes it.
        </p>
      )}
      {(q || d.chapter) && !hits.length && <p class="muted jf-empty">Nothing in {book} for that. Try the part or the system: “{elec ? 'receptacle' : 'brake'}”, a chapter number.</p>}
      {!q && !d.chapter && hits.length > 0 && <span class="label">{tier <= 1 ? 'Found from the alert’s words (the likely one first):' : 'Found from the alert’s words:'}</span>}
      <div class="jf-list" role="list">
        {hits.map((doc) => {
          const t = taskFor(s, a, doc.id);
          const ref = !t || !plannable(t);
          const num = doc.title.split(' ')[0];
          return (
            <button
              key={doc.id}
              role="listitem"
              class={`jf-row ${likely.has(doc.id) ? 'likely' : ''}`}
              onClick={() => {
                fx.tap();
                act({ t: 'preview', task: doc.id });
              }}
            >
              <span class="col grow" style={{ gap: 2 }}>
                <span class="jf-row-title">
                  <b class="mono">{num}</b> {doc.title.slice(num.length + 1)}
                </span>
                <span class="label">
                  {doc.chapter}
                  {ref ? ' · reference only' : ''}
                </span>
              </span>
              {likely.has(doc.id) && <span class="chip palm">likely</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A result's card: the AMM task card (this airplane's lines marked at tiers 0-2), the reference entry, the generator manual's steps. */
function Preview({ s, a, d, act }: { s: IslandState; a: Alert; d: Draft; act(x: DraftAct): void }) {
  const t = taskFor(s, a, d.preview);
  const asset = assetOf(s, a);
  const tier = tierOf(s, a);
  if (!t || !asset) return null;
  const pre = preTask(s, a) === t.id;
  const marked = tier <= 2;
  let card = null;
  if (t.book === 'REF') card = <RefCard t={t} answer={marked ? siteAnswer(s, a, t) : undefined} />;
  else if (t.book === 'GSM') card = <GsmCard t={t} />;
  else if (asset.kind === 'plane') {
    const ac = islandAircraft(s.seed, asset);
    if (t.book === 'AFM') card = <ExternalPowerCard ac={ac} marked={marked} />;
    else {
      const c = cardForTask(ac, t);
      const alt = alterationOf(ac);
      const ica = c && alt && alt.ata === c.ata ? alt : undefined;
      card = (
        <>
          <DataPlate ac={ac} />
          {c ? (
            <TaskCard t={c} marked={marked} ica={ica} />
          ) : (
            <div class="col task-card" style={{ gap: 6 }}>
              <b>AMM {t.no}</b>
              <span style={{ fontWeight: 700 }}>{t.title}</span>
              <span class="label">Reference: servicing values and procedures. No parts, no job of its own.</span>
            </div>
          )}
        </>
      );
    }
  }
  return (
    <div class="col jf-step" style={{ gap: 10 }}>
      {!pre && (
        <button class="jf-back" onClick={() => act({ t: 'preview', task: undefined })}>
          ◂ Results
        </button>
      )}
      {pre && (
        <div class="jf-note">
          <b>{a.src === 'due' ? 'Due item' : a.src === 'ad' ? 'AD' : a.src === 'code' ? 'Code notice' : a.src === 'takeoff' ? 'Take-off' : a.repair ? 'Repair' : 'Write-up'}:</b> this task is named. Read it, then use it.
        </div>
      )}
      <div class="row spread" style={{ alignItems: 'baseline' }}>
        <h3 style={{ margin: 0 }}>
          {t.book === 'REF' ? t.no : `${t.book} ${t.no}`} · {t.short}
        </h3>
      </div>
      {card}
      {plannable(t) ? <TaskDraws s={s} a={a} t={t} /> : <span class="label fault">Reference only: pick the task that does the work.</span>}
      {pre && (
        <button class="jf-link" onClick={() => act({ t: 'preview', task: undefined })}>
          Search the book instead
        </button>
      )}
    </div>
  );
}
