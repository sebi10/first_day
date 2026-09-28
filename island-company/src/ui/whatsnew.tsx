// What's new, keyed by the release's version (docs/EXPANSION.md 9.5): one sheet
// component, each stage passes its own panels (stage 2: C's WhatsNewMap; stage 3:
// D's WhatsNewNet). It opens once per island and seat on this device
// (localStorage, guarded: a private window just shows it again), from week 1,
// and never on top of the job flow's own What's new (that one goes first).
import { useState } from 'preact/hooks';
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

/** the job flow's What's new (flow/WhatsNew.tsx) still to show for this seat: this one waits for it */
const flowNewPending = (s: IslandState, role: Role) => role !== 'fin' && (s.flowSince ?? 1) > 1 && !store.get(`ic.jf.new.${s.id}.${role}`);

export function WhatsNew({ s, role, version, panels }: { s: IslandState; role: Role; version: number; panels: WhatsNewPanel[] }): JSX.Element | null {
  const key = whatsNewKey(s.id, role, version);
  const [open, setOpen] = useState(() => panels.length > 0 && s.week >= 1 && !store.get(key) && !flowNewPending(s, role));
  const [page, setPage] = useState(0);
  if (!open || !panels.length) return null;
  const done = () => {
    store.set(key, '1');
    setOpen(false);
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
        <div class="row" style={{ gap: 8 }}>
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
