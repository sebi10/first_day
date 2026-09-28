// A plane's records on its inspect sheet (docs/EXPANSION.md 6.3, the mechanic's
// row): the data plate with its external power placard (the one the ground power
// start reads), and the logbook, newest first: this season's sign-offs on the
// island, then the airplane's own derived records as the logbook puzzle reads them
// (43.9 entries, tach and total time, the signature). Package C.
import { useState } from 'preact/hooks';
import type { Block } from './facts';

export function PlateBlock({ b }: { b: Extract<Block, { t: 'plate' }> }) {
  return (
    <div class="plate-card">
      <div class="plate-row">
        <b class="mono">{b.reg}</b>
        <span>{b.text}</span>
      </div>
      <div class="insp-placard" aria-label={`External power placard: ${b.placard}`}>
        {b.placard}
      </div>
      <span class="label">External power per {b.manual}: the ground power start reads it.</span>
    </div>
  );
}

export function LogBlock({ b }: { b: Extract<Block, { t: 'log' }> }) {
  const [all, setAll] = useState(false);
  const entries = all ? b.entries : b.entries.slice(0, 2);
  return (
    <div class="col" style={{ gap: 6 }}>
      <span class="label">Logbook, newest first</span>
      <div class="insp-log" role="list" aria-label="Logbook, newest first">
        {b.season.map((e, i) => (
          <div key={`w${e.week}${e.text}${i}`} class="ent season" role="listitem">
            <span class="meta">
              <span>Week {e.week} · this season</span>
            </span>
            <span>
              {e.text}: signed off by <span class="sig">{e.by}</span>
            </span>
          </div>
        ))}
        {entries.map((e) => (
          <div key={e.id} class="ent" role="listitem">
            <span class="meta">
              <span>{e.date}</span>
              <span>{e.book}</span>
              <span>{e.meter}</span>
            </span>
            <span>{e.text}</span>
            <span class="label" style={{ fontSize: 11.5 }}>
              {e.ref}
            </span>
            <span class="sig">{e.sig}</span>
          </div>
        ))}
      </div>
      {b.entries.length > 2 && (
        <button class="insp-log-more" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? 'Fewer entries' : `${b.entries.length - 2} more logbook entries`}
        </button>
      )}
    </div>
  );
}
