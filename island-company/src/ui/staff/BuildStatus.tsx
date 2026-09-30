// The builders' site work on Home, for the whole crew (docs/JOBFLOW.md 15.5):
// "Builders: 2 of 3 units on cottages 3 and 4 · next 1 × roof flashing, on the
// supply boat wk 6", or "Builders: no site work open · start a cottage?". The
// analyst can buy the next unit from here in one tap. With a site open, the line
// is a button: it zooms the island to the builders' site (geo.tsx siteBox).
import { Btn, Icon, toast, usd } from '../kit';
import { C } from '../theme';
import type { Ctl } from '../useIsland';
import { buildLine, materialName } from './model';
import './staff.css';

export function BuildStatus({ ctl, onSee }: { ctl: Ctl; /** zoom the island to the builders' site */ onSee?: () => void }) {
  const { s, role } = ctl;
  const l = buildLine(s, role ?? undefined);
  if (!l || s.week < 1) return null;
  const buy = role === 'fin' && l.buy && l.buy.lines.length ? l.buy : null;
  const line = (
    <>
      <Icon name="hardhat" size={20} color={l.tone === 'wait' ? C.inkSoft : C.seaDeep} />
      <span class="grow">{l.text}</span>
    </>
  );
  return (
    <div class={`card st-status ${l.tone}`} role="status">
      {onSee ? (
        <button class="st-see" onClick={onSee}>
          {line}
          <span class="sr-only"> See the site on the island.</span>
          <span class="st-chev" aria-hidden="true">
            ›
          </span>
        </button>
      ) : (
        line
      )}
      {buy && (
        <Btn
          small
          kind="soft"
          label={`Buy the next unit's materials, ${usd(buy.cost)}`}
          onClick={async () => {
            if (await ctl.dispatch({ t: 'buy', lines: buy.lines, buy: { vendor: 'yard' } }))
              toast(`Ordered from the yard: ${buy.lines.map((x) => `${x.qty} × ${materialName(x.item)}`).join(', ')} (${usd(buy.cost)}), on the supply boat.`);
          }}
        >
          Buy · {usd(buy.cost)}
        </Btn>
      )}
    </div>
  );
}
