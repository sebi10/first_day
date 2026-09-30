// A house on its inspect sheet (docs/EXPANSION.md 6.3): the analyst's own money
// move, the nightly-rate stepper inline (the island's nightly, ±$10 a tap, with
// this week's projected effect either way, `setRates`). The electrician's panel
// schedule is power.tsx's Schedule. Package C.
import type { Ctl } from '../useIsland';
import { fx } from '../feedback';
import { usd } from '../kit';
import type { Act } from './facts';

export function RatesStepper({ ctl, a }: { ctl: Ctl; a: Extract<Act, { t: 'rates' }> }) {
  const step = (d: number) => {
    const v = Math.max(a.min, Math.min(a.max, a.nightly + d));
    if (v === a.nightly) return;
    fx.tick();
    void ctl.dispatch({ t: 'setRates', nightly: v, charter: a.charter });
  };
  const delta = (v: number) => (v === 0 ? 'no change' : `${usd(v, true)} this week`);
  return (
    <div class="col" style={{ gap: 4, width: '100%' }}>
      <div class="insp-rates">
        <button disabled={!a.ok || a.nightly <= a.min} onClick={() => step(-a.step)} aria-label={`Nightly rate down $${a.step}: ${delta(a.down)}`}>
          −
        </button>
        <span class="mid" aria-live="polite">
          <span class="label">Nightly rate · every house</span>
          <b>{usd(a.nightly)}</b>
          <span class="label num">this week about {usd(a.revenue)}</span>
        </span>
        <button disabled={!a.ok || a.nightly >= a.max} onClick={() => step(a.step)} aria-label={`Nightly rate up $${a.step}: ${delta(a.up)}`}>
          +
        </button>
      </div>
      <span class="label num center" style={{ textAlign: 'center' }}>
        {a.ok ? `−$${a.step}: ${delta(a.down)} · +$${a.step}: ${delta(a.up)}` : a.why}
      </span>
    </div>
  );
}
