// The Stock step: every line the plan draws (the picks, a pre-filled line,
// the task's own bench stock marked "card", its tools) with its shelf badge;
// at tiers 0-1 the warnings before commit (pickCheck) on top; then what Send
// will come to. On hand is never a verdict: the shelf holds near-miss stock.
import { pickCheck } from '../../sim/flow';
import { itemById } from '../../sim/items';
import type { Alert, IslandState } from '../../sim/types';
import { StockBadge } from './StockBadge';
import { lineWords, preview, slotRows, stockRows, taskFor, tierOf, type Draft } from './steps';

export function StockStep({ s, a, d }: { s: IslandState; a: Alert; d: Draft }) {
  const t = taskFor(s, a, d.task);
  if (!t) return null;
  const tier = tierOf(s, a);
  const rows = stockRows(s, a, d);
  const checks = tier <= 1 && !a.repair ? pickCheck(s, a, t, d.pick.filter((l) => l.slot !== d.research), tier) : [];
  const labels = new Map(slotRows(s, a, d).map((r) => [r.slot.slot, r.slot.label]));
  const p = preview(s, a, d);
  const book = t.book === 'REF' ? 'Reference' : t.book === 'AMM' && a.repair ? 'Repair' : t.book;
  const parts = rows.filter((r) => r.from !== 'tool');
  const tools = rows.filter((r) => r.from === 'tool');
  const empty = rows.filter((r) => r.from === 'pick' || r.from === 'fixed').length === 0;
  return (
    <div class="col jf-step" style={{ gap: 10 }}>
      <div class="jf-taskline static">
        <span class="label">{book}</span> {t.no !== book && <b>{t.no}</b>} {t.title}
      </div>
      {checks.length > 0 && (
        <div class="jf-note warn" role="status">
          {checks.map((c) => (
            <div key={c}>{c}</div>
          ))}
        </div>
      )}
      {d.research && (
        <div class="jf-note">
          Not in the IPC: the {labels.get(d.research)?.toLowerCase() ?? 'part'} goes to the research branch (the airplane's logbooks, then engineering), not on this pick.
        </div>
      )}
      {empty && !d.research && !t.fixed && t.main.length > 0 && p.outcome !== 'incomplete' && <div class="jf-note">Nothing picked: the job goes with the task's own stock only.</div>}
      <div class="jf-lines" role="list">
        {parts.map((r, i) => {
          const x = itemById(r.item);
          const tag = r.from === 'bench' ? 'task card' : r.from === 'fixed' ? 'pre-filled' : r.slot ? (labels.get(r.slot) ?? r.slot) : 'extra';
          return (
            <div key={`${r.item}${i}`} role="listitem" class="jf-line">
              <span class="col grow" style={{ gap: 2, minWidth: 0 }}>
                <span class="row" style={{ gap: 6 }}>
                  <span class={`jf-tag ${r.from === 'bench' ? 'bench' : ''}`}>{tag}</span>
                </span>
                <span class="jf-line-text">{x ? lineWords(r.item, r.qty) : r.item}</span>
              </span>
              <StockBadge row={r} week={s.week} />
            </div>
          );
        })}
        {tools.map((r) => {
          const x = itemById(r.item);
          return (
            <div key={r.item} role="listitem" class="jf-line">
              <span class="col grow" style={{ gap: 2, minWidth: 0 }}>
                <span class="jf-tag tool">tool</span>
                <span class="jf-line-text">{x?.nomen ?? r.item}</span>
              </span>
              <StockBadge row={r} week={s.week} />
            </div>
          );
        })}
      </div>
      <div class={`jf-summary ${p.outcome}`}>{p.text}</div>
      {p.late && <span class="label">{p.late}</span>}
    </div>
  );
}
