// What's new, keyed by the release's version (docs/EXPANSION.md 9.5): one sheet
// component, each stage passes its own panels (stage 2: C's WhatsNewMap; stage 3:
// D's WhatsNewNet). It opens once per island and seat on this device
// (localStorage, guarded: a private window just shows it again), from week 1,
// and never on top of the job flow's own What's new (that one goes first), nor
// while `hold` (the week's review, the Harbor sheet) is up.
import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { IslandState, Role } from '../sim/types';
import { Btn, Sheet } from './kit';

export type WhatsNewPanel = { title: string; body: JSX.Element };

export const whatsNewKey = (island: string, role: string, version: number) => `ic.new.v${version}.${island}.${role}`;

const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* a private window: it shows again next time */
    }
  },
};

/** read a key; undefined when storage throws (a private window: the older sheets don't show there either) */
const peek = (k: string): string | null | undefined => {
  try {
    return localStorage.getItem(k);
  } catch {
    return undefined;
  }
};

/**
 * the job flow's What's new still to show for this seat: this one waits for it. The techs' is flow/WhatsNew.tsx; the
 * analyst's is the desk's (purchasing/WhatsNew.tsx: review round 1, on an island migrated from v2 she got both at once)
 */
export const flowNewPending = (s: IslandState, role: Role) => {
  if ((s.flowSince ?? 1) <= 1) return false;
  const v = peek(role === 'fin' ? `ic.whatsnew.jobflow.fin.${s.id}` : `ic.jf.new.${s.id}.${role}`);
  return v === null;
};

/** a one-time sheet closed (the job flow's or the desk's What's new): the next one can open now, not on the next tap */
export const WHATS_NEW_CLOSED = 'ic:whatsnew-closed';
export const whatsNewClosed = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(WHATS_NEW_CLOSED));
};

export function WhatsNew({ s, role, version, panels, hold }: { s: IslandState; role: Role; version: number; panels: WhatsNewPanel[]; hold?: boolean }): JSX.Element | null {
  const key = whatsNewKey(s.id, role, version);
  const [seen, setSeen] = useState(() => !!store.get(key));
  const [page, setPage] = useState(0);
  // re-read when an older one-time sheet closes (review round 1: it opened over the next thing tapped instead)
  const [, bump] = useState(0);
  useEffect(() => {
    const on = () => bump((n) => n + 1);
    window.addEventListener(WHATS_NEW_CLOSED, on);
    return () => window.removeEventListener(WHATS_NEW_CLOSED, on);
  }, []);
  // held while another one-time sheet or the review is up; it opens on the render after they close
  const open = panels.length > 0 && s.week >= 1 && !seen && !hold && !flowNewPending(s, role);
  if (!open) return null;
  const done = () => {
    store.set(key, '1');
    setSeen(true);
  };
  const p = panels[Math.min(page, panels.length - 1)];
  const last = page >= panels.length - 1;
  return (
    <Sheet open={open} onClose={done} label="What's new">
      <div class="col" style={{ gap: 12 }}>
        <span class="label">What's new</span>
        <h2>{p.title}</h2>
        <div>{p.body}</div>
        {panels.length > 1 && (
          <div class="row" style={{ gap: 6, justifyContent: 'center' }} aria-hidden="true">
            {panels.map((_, i) => (
              <i key={i} class={`jf-dot ${i === page ? 'on' : ''}`} />
            ))}
          </div>
        )}
        {/* (sticky: a long panel keeps Skip and Next in reach at 390 x 844, review round 1) */}
        <div class="row sheet-actions" style={{ gap: 8 }}>
          <Btn kind="ghost" block onClick={done}>
            Skip
          </Btn>
          <Btn block onClick={() => (last ? done() : setPage(page + 1))}>
            {last ? 'Got it' : 'Next'}
          </Btn>
        </div>
      </div>
    </Sheet>
  );
}
