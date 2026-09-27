// One alert as a row (56 px or more): the source icon, the symptom on one
// line, the asset with the due chip and the flags under it, and the whose-move
// chip on the right; a ready job (or a one-tap inspection) gets its Start.
import type { Alert, IslandState, Order, Role } from '../../sim/types';
import { Icon } from '../kit';
import { ROLE_TINT } from '../theme';
import { isOneTap } from './steps';
import { assetTitle, flagsOf, moveChip, shortOf, SRC_ICON, SRC_WORDS } from './words';

export function AlertRow({ s, a, me, onOpen, onStart, held, quiet }: { s: IslandState; a: Alert; me: Role; onOpen(): void; onStart?(): void; /** the seat can't start anything now (turn over, a per-turn limit) */ held?: boolean; /** in the Your move group: a plain "Your move" chip says nothing new */ quiet?: boolean }) {
  const asset = s.assets.find((x) => x.id === a.assetId);
  const o: Order | undefined = a.order ? s.orders.find((x) => x.id === a.order && x.status !== 'cancelled') : undefined;
  const m = moveChip(s, a, me);
  const flags = flagsOf(s, a);
  const ready = m.mine && o?.status === 'ready';
  const oneTap = m.mine && !o && isOneTap(s, a);
  const start = (ready || oneTap) && !!onStart && !held;
  const tint = m.who && !m.mine ? { background: `${ROLE_TINT[m.who]}99` } : undefined;
  return (
    <div class={`jf-arow ${m.mine ? 'mine' : ''} ${a.status === 'closed' ? 'closed' : ''}`} role="listitem">
      <button class="jf-arow-main" onClick={onOpen} aria-label={`${SRC_WORDS[a.src]}: ${shortOf(s, a)} on ${asset?.name ?? 'the asset'}. ${m.chip}`}>
        <span class={`jf-src ${a.src}`}>
          <Icon name={SRC_ICON[a.src]} size={20} />
        </span>
        <span class="col grow" style={{ gap: 3, minWidth: 0 }}>
          <span class="jf-arow-sym">{o && o.status !== 'done' ? `${o.title}` : shortOf(s, a)}</span>
          <span class="jf-arow-meta">
            <span class="label">{o && o.status !== 'done' ? `${shortOf(s, a)} · ` : ''}{assetTitle(s, asset)}</span>
            {flags.map((f) => (
              <span key={f.text} class={`jf-flag ${f.tone ?? ''}`}>
                {f.text}
              </span>
            ))}
          </span>
        </span>
        {!start && !(quiet && m.chip === 'Your move') && (
          <span class={`jf-move ${m.mine ? 'mine' : ''} ${m.chip === 'Due now' ? 'due' : ''}`} style={tint}>
            {m.chip}
          </span>
        )}
        {!start && quiet && m.chip === 'Your move' && (
          <span class="jf-chev" aria-hidden="true">
            ›
          </span>
        )}
      </button>
      {start && (
        <button class="btn small jf-start" onClick={onStart}>
          Start
        </button>
      )}
    </div>
  );
}
