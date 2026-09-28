// What the tech finds when the box is opened at Start (installCheck, 8.7), or
// what stopped the job at receiving: the reason, then Repick (the Parts step,
// the stop on top) or, for an assembly an alteration replaced, Research the
// records (a repick sent to the part chain's research branch). Nothing is
// written until the tech repicks: the job stays as it is.
import type { IslandState, Order } from '../../sim/types';
import { Btn, Icon } from '../kit';
import { assetTitle } from './words';

export function StopSheet({ s, o, stop, research, onRepick, onResearch, onClose }: { s: IslandState; o: Order; stop: string; research?: boolean; onRepick(): void; onResearch(): void; onClose(): void }) {
  const asset = s.assets.find((a) => a.id === o.assetId);
  return (
    <div class="col jf-stop" style={{ gap: 12 }}>
      <div class="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <span class="jf-stop-mark" aria-hidden="true">
          <Icon name="alert" size={22} />
        </span>
        <span class="col" style={{ gap: 2 }}>
          <h2>Work stopped</h2>
          <span class="label">
            {o.title} · {assetTitle(s, asset)}
          </span>
        </span>
      </div>
      <p style={{ margin: 0, fontWeight: 700 }}>{stop}</p>
      <span class="label">Nothing is signed off and nothing leaves stock. Pick again, and the job goes on.</span>
      {research && (
        <Btn block onClick={onResearch}>
          Research the records ▸
        </Btn>
      )}
      <Btn block kind={research ? 'soft' : undefined} onClick={onRepick}>
        Repick ▸
      </Btn>
      <Btn block kind="ghost" onClick={onClose}>
        Not now
      </Btn>
    </div>
  );
}
