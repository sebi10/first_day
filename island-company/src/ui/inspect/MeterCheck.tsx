// The electrician's meter check on a house (docs/EXPANSION.md 6.4): a plug-in
// tester with a 12 A load at every receptacle circuit, all in one view, and both
// service legs at the panel. Each circuit shows its voltage under the load, its run
// length, its breaker and wire; a GFCI circuit what its test button did. He taps a
// circuit, then Write up: <the zone>; or All normal. At most 3 taps from the sheet.
//
// Reading it is the skill: the expected drop is 2 × run × 12 A × ohms per 1,000 ft,
// so a long porch run sags as far as a short run with a loose backstab; one leg
// sagging while the other rises is a loose neutral; a GFCI that clicks and stays
// live has failed. Nothing here marks which circuit is off, and nothing says
// whether the call was right.
import { useState } from 'preact/hooks';
import type { CheckItem, CheckView } from '../../sim/checks';
import type { Asset } from '../../sim/types';
import { CheckFoot, Help } from './parts';

/** the parts of an item's reading: its volts, its breaker and wire, what the GFCI did (the view's own words) */
function partsOf(it: CheckItem): { volts: string; rating: string; gfci: string | null; legs: [string, string] | null } {
  const legs = /L1 ([\d.]+) V · L2 ([\d.]+) V/.exec(it.text);
  if (legs) return { volts: legs[1], rating: '', gfci: null, legs: [legs[1], legs[2]] };
  const p = it.text.split(' · ');
  return { volts: it.reading?.volts !== undefined ? it.reading.volts.toFixed(1) : (p[0] ?? '').replace(/ V.*$/, ''), rating: p[1] ?? '', gfci: p[2] ?? null, legs: null };
}

/** the tester on the picked receptacle: its reading big, the load it puts on */
export function Tester({ it }: { it: CheckItem | undefined }) {
  const p = it ? partsOf(it) : null;
  const main = p ? (p.legs ? `${p.legs[0]} / ${p.legs[1]}` : p.volts) : '---.-';
  return (
    <svg class="qc-art" viewBox="0 0 320 112" role="img" aria-label={it ? `Tester on ${it.label}: ${it.text}` : 'Tester: pick a circuit'}>
      <rect x="0" y="0" width="320" height="112" rx="12" fill="#e9e3d5" />
      {/* the receptacle and the tester plugged into it */}
      <rect x="18" y="20" width="58" height="72" rx="8" fill="#f7f4ec" stroke="#3a3f42" stroke-width="1.6" />
      {[38, 68].map((y) => (
        <g key={y}>
          <rect x="34" y={y - 8} width="4" height="10" rx="1" fill="#26292b" />
          <rect x="54" y={y - 8} width="4" height="12" rx="1" fill="#26292b" />
          <path d={`M44 ${y + 6} a3 3 0 0 1 6 0 v3 h-6 z`} fill="#26292b" />
        </g>
      ))}
      <path d="M76 56 L100 56" stroke="#26292b" stroke-width="6" stroke-linecap="round" />
      <rect x="100" y="16" width="204" height="80" rx="14" fill="#f4d35e" stroke="#3a3f42" stroke-width="1.6" />
      <rect x="112" y="26" width="180" height="46" rx="6" fill="#aab59a" stroke="#6d7a62" />
      <text x="284" y="60" text-anchor="end" font-size={p?.legs ? 20 : 28} font-weight="800" fill="#1c2418" font-family="ui-monospace, Menlo, monospace">
        {main} V
      </text>
      <text x="120" y="38" font-size="9" font-weight="800" fill="#34402c" font-family="ui-monospace, Menlo, monospace">
        {p?.legs ? 'L1 / L2' : 'LOAD 12 A'}
      </text>
      <text x="112" y="88" font-size="10.5" font-weight="800" fill="#3a3f42">
        {it ? it.label : 'Tap a circuit to plug in'}
      </text>
    </svg>
  );
}

function Receptacle({ gfci }: { gfci: boolean }) {
  return (
    <svg width="30" height="40" viewBox="0 0 30 40" aria-hidden="true" style={{ flex: 'none' }}>
      <rect x="1" y="1" width="28" height="38" rx="5" fill="#fbf5e9" stroke="#3a3f42" stroke-width="1.4" />
      {(gfci ? [12] : [12, 28]).map((y) => (
        <g key={y}>
          <rect x="8" y={y - 4} width="2.4" height="6" fill="#26292b" />
          <rect x="19.6" y={y - 4} width="2.4" height="7" fill="#26292b" />
          <path d={`M13 ${y + 4} a2 2 0 0 1 4 0 v2 h-4 z`} fill="#26292b" />
        </g>
      ))}
      {gfci && (
        <>
          <rect x="6" y="23" width="8" height="5" rx="1" fill="#c7502f" />
          <rect x="16" y="23" width="8" height="5" rx="1" fill="#1f2a30" />
          <rect x="8" y="30" width="14" height="7" rx="2" fill="none" stroke="#3a3f42" />
        </>
      )}
    </svg>
  );
}

function MeterRow({ it, on, onPick }: { it: CheckItem; on: boolean; onPick(): void }) {
  const p = partsOf(it);
  return (
    <button class={`qc-item mc-row ${on ? 'on' : ''}`} aria-pressed={on} aria-label={`${it.label}: ${it.text}`} onClick={onPick}>
      {p.legs ? (
        <svg width="30" height="40" viewBox="0 0 30 40" aria-hidden="true" style={{ flex: 'none' }}>
          <rect x="1" y="1" width="28" height="38" rx="3" fill="#8d969b" stroke="#3a3f42" stroke-width="1.4" />
          {[9, 17, 25, 33].map((y) => (
            <rect key={y} x="7" y={y - 3} width="16" height="4" rx="1" fill="#26292b" />
          ))}
        </svg>
      ) : (
        <Receptacle gfci={!!p.gfci} />
      )}
      <span class="body">
        <span class="top">
          <b>{it.label}</b>
          {p.legs ? (
            <span class="mc-legs">
              <span class="mc-lcd">L1 {p.legs[0]}</span>
              <span class="mc-lcd">L2 {p.legs[1]}</span>
            </span>
          ) : (
            <span class="mc-lcd">{p.volts} V</span>
          )}
        </span>
        <span class="label">{p.legs ? 'Both legs under the 12 A load on L1' : `${p.rating} · with 12 A on`}</span>
        {p.gfci && <span class="t">GFCI: {p.gfci}</span>}
      </span>
    </button>
  );
}

export function MeterCheck({ a, view, busy, onCall }: { a: Pick<Asset, 'name'>; view: CheckView; busy?: boolean; onCall(item: string | null): void }) {
  const [pick, setPick] = useState<string | null>(null);
  const toggle = (id: string) => setPick((p) => (p === id ? null : id));
  const picked = view.items.find((i) => i.id === pick);
  return (
    <div class="col qc">
      <p class="qc-lead">Every receptacle circuit in {a.name}, read with the tester's 12 A load on, and the service at the panel. Tap the one you'd write up, or call it all normal.</p>
      <Tester it={picked} />
      <div class="qc-items">
        {view.items.map((it) => (
          <MeterRow key={it.id} it={it} on={pick === it.id} onPick={() => toggle(it.id)} />
        ))}
      </div>
      <Help lines={view.help} />
      <CheckFoot none="All normal" call="Write up" pick={pick} pickLabel={picked?.label} busy={busy} onCall={onCall} />
    </div>
  );
}
