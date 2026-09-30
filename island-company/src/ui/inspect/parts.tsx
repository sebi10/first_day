// Small shared pieces of the inspect sheet and the three quick checks
// (docs/EXPANSION.md 6.2, 6.4): the "how to read it" panel, the check's two-button
// footer, the skill dots. Package C.
import type { ComponentChildren } from 'preact';
import { Btn } from '../kit';

/** the check's reference notes, folded (a details element: Tab and Enter open it) */
export function Help({ lines, title = 'How to read it' }: { lines: string[]; title?: string }) {
  if (!lines.length) return null;
  return (
    <details class="qc-help">
      <summary>{title}</summary>
      <ul>
        {lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
    </details>
  );
}

/**
 * The check's call, in the sheet's sticky footer: "All serviceable" / "All normal" (one tap: nothing raised), or the
 * picked item's write-up (enabled once an item is picked). Blind: neither says whether the call is right. Review round 2:
 * the pick is said on its own line above the buttons ("Your call: Living room (42 ft)"), where it wraps: inside the
 * button it was cut to "Write up: Living ro…" on a phone
 */
export function CheckFoot({ none, call, pick, pickLabel, busy, onCall }: { none: string; call: string; pick: string | null; pickLabel?: string; busy?: boolean; onCall(item: string | null): void }) {
  return (
    <div class="sheet-actions qc-foot">
      <span class={`qc-pick ${pick ? 'on' : ''}`} aria-live="polite">
        {pick && pickLabel ? (
          <>
            Your call: <b>{pickLabel}</b>
          </>
        ) : (
          `Tap the one you'd write up, or call it ${none.toLowerCase()}.`
        )}
      </span>
      <div class="qc-btns">
        <Btn kind="ghost" disabled={busy} onClick={() => onCall(null)}>
          {none}
        </Btn>
        <Btn disabled={!pick || busy} onClick={() => pick && onCall(pick)} label={pick && pickLabel ? `${call}: ${pickLabel}` : undefined}>
          {call}
        </Btn>
      </div>
    </div>
  );
}

/** skill 1-5 as dots */
export function Dots({ skill }: { skill: number }) {
  return (
    <span class="insp-dots" aria-label={`skill ${skill} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <i key={i} class={i <= skill ? 'on' : ''} />
      ))}
    </span>
  );
}

/** a small section with its caption */
export function Sec({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <div class="insp-sec">
      <span class="label">{label}</span>
      {children}
    </div>
  );
}
