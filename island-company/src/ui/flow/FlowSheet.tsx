// The job-flow sheet's frame: it rises from the bottom on a phone and opens as
// a 480 px panel on the right of a desktop. A fixed head (the asset, the
// symptom, the stepper), a body that scrolls, and a foot for the step's main
// button. It rides above the on-screen keyboard (the visual viewport), so a
// search's results scroll in what's left and are never hidden behind it.
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import './flow.css';

export function FlowSheet({
  open,
  onClose,
  label,
  head,
  foot,
  children,
  bodyKey,
  raised,
}: {
  open: boolean;
  onClose(): void;
  label: string;
  head?: ComponentChildren;
  foot?: ComponentChildren;
  children: ComponentChildren;
  /** a new step or view: the body scrolls back to the top */
  bodyKey?: string;
  /** above a full-screen overlay (week 0's walk-through) */
  raised?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    const vv = window.visualViewport;
    if (!open || !el || !vv) return;
    const fit = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      const up = kb > 80;
      el.style.bottom = up ? `${kb}px` : '';
      el.style.height = up ? `${Math.max(240, vv.height - 6)}px` : '';
      el.classList.toggle('kb', up);
    };
    vv.addEventListener('resize', fit);
    vv.addEventListener('scroll', fit);
    fit();
    return () => {
      vv.removeEventListener('resize', fit);
      vv.removeEventListener('scroll', fit);
    };
  }, [open]);
  // a new step or view starts at the top (before the children's own effects: a slot's search scrolls to its rows)
  useLayoutEffect(() => {
    if (body.current) body.current.scrollTop = 0;
  }, [bodyKey]);
  if (!open) return null;
  return (
    <>
      <div class={`scrim jf-scrim ${raised ? 'raised' : ''}`} onClick={onClose} />
      <div class={`jf-sheet ${raised ? 'raised' : ''}`} role="dialog" aria-label={label} ref={ref}>
        {head && <div class="jf-head">{head}</div>}
        <div class="jf-body" ref={body}>
          {children}
        </div>
        {foot && <div class="jf-foot">{foot}</div>}
      </div>
    </>
  );
}
