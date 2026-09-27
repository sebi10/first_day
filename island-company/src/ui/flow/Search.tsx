// The search bar the Manual, Reference, IPC and catalog steps share: an input
// debounced 80 ms (no index is ever built on a keystroke: the indexes are A's,
// memoized), autocomplete chips from the index's vocabulary, and chip rows
// (keyword chips, chapter chips) that scroll sideways on a phone. Enter hides
// the keyboard so the results have the whole sheet.
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { complete, type Index } from '../../sim/search';
import { fx } from '../feedback';
import { Icon } from '../kit';

/** a value that follows another after `ms` of quiet */
export function useDebounced<T>(value: T, ms = 80): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const lastToken = (q: string) => q.split(/\s+/).pop() ?? '';

/**
 * The input and its autocomplete chips. `value` is the stored query (the
 * draft's); what's typed shows at once and reaches `onQuery` 80 ms later.
 */
export function SearchBar({ ix, value, onQuery, placeholder, label }: { ix: Index; value: string; onQuery(q: string): void; placeholder: string; label: string }) {
  const [text, setText] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  const q = useDebounced(text, 80);
  // the draft's query changed from outside (a chip, a chapter): show it
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (q !== value) onQuery(q);
  }, [q]);
  const tok = lastToken(text);
  const comps = tok.length >= 2 ? complete(ix, tok, 6) : [];
  const pickComp = (w: string) => {
    fx.tap();
    const parts = text.split(/\s+/);
    parts[parts.length - 1] = w;
    const next = `${parts.join(' ')} `;
    setText(next);
    onQuery(next.trim());
    input.current?.focus();
  };
  return (
    <div class="jf-search">
      <div class="jf-input">
        <svg class="jf-glass" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.5 15.5 21 21" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
        </svg>
        <input
          ref={input}
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCapitalize="off"
          spellcheck={false}
          aria-label={label}
          placeholder={placeholder}
          value={text}
          onInput={(e) => setText((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              onQuery(text.trim());
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        {text && (
          <button
            class="jf-clear"
            aria-label="Clear the search"
            onClick={() => {
              fx.tap();
              setText('');
              onQuery('');
            }}
          >
            <Icon name="x" size={18} />
          </button>
        )}
      </div>
      {comps.length > 0 && (
        <ChipRow label="Suggestions">
          {comps.map((w) => (
            <button key={w} class="jf-chip comp" onClick={() => pickComp(w)}>
              {w}
            </button>
          ))}
        </ChipRow>
      )}
    </div>
  );
}

/** a row of chips that scrolls sideways (one line on a phone); the selected chip is scrolled into view */
export function ChipRow({ label, children, lead }: { label: string; children: ComponentChildren; /** a caption before the chips */ lead?: string }) {
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = row.current;
    const on = el?.querySelector<HTMLElement>('.jf-chip.on');
    if (!el || !on) return;
    const left = on.offsetLeft - el.offsetLeft;
    if (left < el.scrollLeft || left + on.offsetWidth > el.scrollLeft + el.clientWidth) el.scrollLeft = Math.max(0, left - 24);
  }, []);
  return (
    <div class="jf-chips" role="group" aria-label={label} ref={row}>
      {lead && <span class="jf-chips-lead">{lead}</span>}
      {children}
    </div>
  );
}

/** a chip button: tap to select, tap again to clear */
export function Chip({ on, onClick, children, tone }: { on?: boolean; onClick(): void; children: ComponentChildren; tone?: 'hint' }) {
  return (
    <button
      class={`jf-chip ${on ? 'on' : ''} ${tone ?? ''}`}
      aria-pressed={!!on}
      onClick={() => {
        fx.tap();
        onClick();
      }}
    >
      {children}
    </button>
  );
}
