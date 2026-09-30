// The power objects' records on their inspect sheets (docs/EXPANSION.md 6.3, the
// electrician's rows): a panel or breaker schedule as a table (the island grid's
// breakers at this tier, a house's receptacle circuits), rating, conductor and what
// each feeds or how it's protected. The IR scan and the meter check read the same
// breakers and circuits. Package C.
import type { Block } from './facts';

export function Schedule({ b }: { b: Extract<Block, { t: 'schedule' }> }) {
  // folded: the checks read the same circuits, and a phone's sheet stays short (Tab and Enter open it)
  return (
    <details class="qc-help insp-sched-wrap">
      <summary>
        {b.title} · {b.rows.length} circuits
      </summary>
      <table class="insp-sched">
        <caption class="sr-only">{b.title}</caption>
        <thead>
          <tr>
            <th scope="col">Circuit</th>
            <th scope="col">Breaker</th>
            <th scope="col">{b.rows.some((r) => /GFCI|AFCI/.test(r.note)) ? 'Protection' : 'Feeds'}</th>
          </tr>
        </thead>
        <tbody>
          {b.rows.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              <td class="n">
                {r.rating}
                <br />
                <span class="label">{r.wire}</span>
              </td>
              <td class="note">{r.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {b.foot && (
        <p class="label" style={{ margin: '6px 0 10px' }}>
          {b.foot}
        </p>
      )}
    </details>
  );
}
