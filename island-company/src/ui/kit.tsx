// Small shared UI building blocks.
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { fx } from './feedback';
import { C } from './theme';

export const usd = (n: number, sign = false) => {
  const v = Math.round(n);
  const s = `$${Math.abs(v).toLocaleString('en-US')}`;
  return v < 0 ? `−${s}` : sign && v > 0 ? `+${s}` : s;
};

export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const P: Record<string, string> = {
  plane: 'M12 2c.8 0 1.3.9 1.3 2v5l7.7 4.5v2l-7.7-2.3V18l2.2 1.7V21L12 20l-3.5 1v-1.3L10.7 18v-4.8L3 15.5v-2L10.7 9V4c0-1.1.5-2 1.3-2z',
  house: 'M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  bolt: 'M13 2 4 14h6l-1 8 9-12h-6z',
  cash: 'M3 6h18v12H3zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM6 9v6M18 9v6',
  wrench: 'M14.7 6.3a4 4 0 0 0-5.4 5.1L3 17.7 6.3 21l6.3-6.3a4 4 0 0 0 5.1-5.4l-2.6 2.6-2.4-.6-.6-2.4z',
  check: 'M4 12.5 9.5 18 20 6.5',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4v5l3 2',
  alert: 'M12 3 2 20h20zM12 9v5M12 17h.01',
  box: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  island: 'M2 18c3-2 7-3 10-3s7 1 10 3M12 15V6M12 6c-2-2-5-2-7 0 2 0 4 1 7 0zm0 0c2-2 5-2 7 0-2 0-4 1-7 0z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-8 9a8 8 0 0 1 16 0',
  board: 'M4 4h16v16H4zM8 9h8M8 13h8M8 17h5',
  share: 'M12 3v12M7 8l5-5 5 5M5 14v6h14v-6',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7M12 17h.01',
  x: 'M6 6l12 12M18 6 6 18',
  swap: 'M7 7h12l-3-3M17 17H5l3 3',
  storm: 'M7 15a4 4 0 1 1 1-7.9A5 5 0 0 1 18 9a3.5 3.5 0 0 1-1 6.9M11 13l-2 4h4l-2 4',
  wind: 'M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7',
  sun: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 1v3M12 20v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M1 12h3M20 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1',
  gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm8 3-2-.6-.6-1.5 1-1.8-1.5-1.5-1.8 1-1.5-.6L13 4h-2l-.6 2-1.5.6-1.8-1-1.5 1.5 1 1.8L6 10.4 4 11v2l2 .6.6 1.5-1 1.8 1.5 1.5 1.8-1 1.5.6.6 2h2l.6-2 1.5-.6 1.8 1 1.5-1.5-1-1.8.6-1.5 2-.6z',
  star: 'M12 3l2.8 5.8 6.2.9-4.5 4.4 1 6.2L12 17.4 6.5 20.3l1-6.2L3 9.7l6.2-.9z',
  pen: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  // the job flow (docs/JOBFLOW.md 17.1): alert sources, purchasing, stores and staff
  squawk: 'M4 5h16v10H9l-5 4zM8 9h8M8 12h5',
  trend: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  wear: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 3v5M12 16v5M3 12h5M16 12h5',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  guest: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-6 9a6 6 0 0 1 12 0M17 10h4v7h-4zM18 10V8h2v2',
  meter: 'M6 3h12v18H6zM9 6h6v4H9zM12 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  takeoff: 'M8 3h8v3H8zM6 4.5H4V21h16V4.5h-2M8 11h8M8 15h8M8 18h4',
  truck: 'M2 7h11v9H2zM13 10h4l4 3v3h-8M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm11 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  boat: 'M3 15h18l-3 5H6zM12 3v12M12 4l6 8h-6',
  tag: 'M3 12V3h9l9 9-9 9zM7.5 7.5h.01',
  placard: 'M4 4h16v10H4zM12 14v6M8 20h8M8 8h8M8 11h5',
  hardhat: 'M3 17h18v2.5H3zM5 17a7 7 0 0 1 14 0M10 6h4v5h-4z',
  people: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20a6 6 0 0 1 12 0M13 20a5.5 5.5 0 0 1 9 0',
  bin: 'M3 8h18v12H3zM5 4h14l2 4H3zM9 13h6',
};

/** every icon name kit.tsx draws (the packages pick from these) */
export const ICON_NAMES = Object.keys(P);

export function Icon({ name, size = 20, color = 'currentColor', stroke = 2 }: { name: string; size?: number; color?: string; stroke?: number }) {
  const fill = name === 'plane' || name === 'house' || name === 'bolt' || name === 'star';
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flex: 'none' }}>
      <path
        d={P[name] ?? ''}
        fill={fill ? color : 'none'}
        stroke={fill ? 'none' : color}
        stroke-width={stroke}
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

export const healthColor = (h: number) => (h >= 80 ? C.sea : h >= 60 ? C.palm : h >= 40 ? '#C9A86A' : C.rust);

/** a tick on a health bar: the line where a rule changes (70: the lighter wear from tier 4; the grid's 55 and 40) */
export type BarMark = { at: number; title: string };

export function Health({ value, label, marks }: { value: number; label?: string; marks?: BarMark[] }) {
  const v = Math.round(value);
  return (
    <div class="col" style={{ gap: 4, minWidth: 0 }}>
      <div class="row spread">
        <span class="label">{label}</span>
        <span class={`num ${v < 40 ? 'fault' : ''}`} style={{ fontWeight: 800, fontSize: 14 }}>
          {v < 40 && '⚠ '}
          {v}
        </span>
      </div>
      <div class={`bar ${marks?.length ? 'marked' : ''}`} role="meter" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <i style={{ width: `${v}%`, background: healthColor(v) }} />
        {marks?.map((m) => <b key={m.at} class="bar-mark" style={{ left: `${m.at}%` }} title={m.title} aria-hidden="true" />)}
      </div>
    </div>
  );
}

export function TierDots({ tier }: { tier: number }) {
  return (
    <span class="tierdots" aria-label={`Tier ${tier}`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <i key={i} class={i <= tier ? 'on' : ''} />
      ))}
    </span>
  );
}

export function Sheet({ open, onClose, children, label }: { open: boolean; onClose(): void; children: ComponentChildren; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // Phones: the on-screen keyboard covers a bottom sheet (iOS doesn't shrink the
  // layout viewport), hiding the field you're typing in and the button under it.
  // Ride above the keyboard using the visual viewport, and keep the focused field in view.
  useEffect(() => {
    const el = ref.current;
    const vv = window.visualViewport;
    if (!open || !el || !vv) return;
    const fit = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      el.style.bottom = kb > 40 ? `${kb}px` : '';
      el.style.maxHeight = kb > 40 ? `${vv.height - 8}px` : '';
    };
    const onFocus = (e: FocusEvent) => {
      const t = e.target as HTMLElement;
      if (t.matches('input, textarea')) setTimeout(() => t.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);
    };
    vv.addEventListener('resize', fit);
    vv.addEventListener('scroll', fit);
    el.addEventListener('focusin', onFocus);
    fit();
    return () => {
      vv.removeEventListener('resize', fit);
      vv.removeEventListener('scroll', fit);
      el.removeEventListener('focusin', onFocus);
    };
  }, [open]);
  if (!open) return null;
  return (
    <>
      <div class="scrim" onClick={onClose} />
      <div class="sheet" role="dialog" aria-label={label} ref={ref}>
        <div class="grip" />
        {children}
      </div>
    </>
  );
}

// --- toast ---------------------------------------------------------------
let toastSet: ((t: string | null) => void) | null = null;
let toastTimer = 0;
export function toast(text: string) {
  toastSet?.(text);
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastSet?.(null), 2600);
}
export function Toaster() {
  const [t, setT] = useState<string | null>(null);
  useEffect(() => {
    toastSet = setT;
    return () => {
      toastSet = null;
    };
  }, []);
  return t ? (
    <div class="toast" role="status" onClick={() => setT(null)}>
      {t}
    </div>
  ) : null;
}

export function Btn(p: {
  children: ComponentChildren;
  onClick?: () => void;
  kind?: 'primary' | 'ghost' | 'soft' | 'danger' | 'ink';
  small?: boolean;
  block?: boolean;
  disabled?: boolean;
  label?: string;
  style?: Record<string, string | number>;
}) {
  const cls = ['btn', p.kind && p.kind !== 'primary' ? p.kind : '', p.small ? 'small' : '', p.block ? 'block' : ''].join(' ');
  return (
    <button
      class={cls}
      disabled={p.disabled}
      aria-label={p.label}
      style={p.style}
      onClick={() => {
        fx.tap();
        p.onClick?.();
      }}
    >
      {p.children}
    </button>
  );
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: { v: T; label: string }[]; onChange(v: T): void }) {
  return (
    <div class="seg" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.v}
          role="radio"
          aria-checked={o.v === value}
          class={o.v === value ? 'on' : ''}
          onClick={() => {
            fx.tap();
            onChange(o.v);
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ label, value, onChange, hint }: { label: string; value: boolean; onChange(v: boolean): void; hint?: string }) {
  return (
    <label class="row spread" style={{ minHeight: 44 }}>
      <span class="col" style={{ gap: 0 }}>
        <span style={{ fontWeight: 700 }}>{label}</span>
        {hint && <span class="label">{hint}</span>}
      </span>
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => {
          fx.tap();
          onChange((e.target as HTMLInputElement).checked);
        }}
        style={{ width: 26, height: 26, accentColor: C.sea }}
      />
    </label>
  );
}
