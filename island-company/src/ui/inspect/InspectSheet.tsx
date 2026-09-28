// The inspect sheet (docs/EXPANSION.md 6.2, 6.3; package C): the contract's
// component, which home.tsx wraps in a <Sheet> for a tapped object. Its body
// (Inspect.tsx: the seat's facts, moves, quick checks and Report a problem) is a
// chunk of its own, like the job sheet, so Home's first paint doesn't carry it: it
// is fetched when the phone is idle after the first paint, and the first tap
// finds it loaded.
import type { JSX } from 'preact';
import { lazy, whenIdle } from '../lazy';
import type { InspectProps } from './Inspect';

const Body = lazy<InspectProps>(
  () => import('./Inspect').then((m) => m.InspectBody),
  () => <div class="card" style={{ minHeight: 240 }} aria-busy="true" />,
);
whenIdle(Body.preload);

export function InspectSheet(p: InspectProps): JSX.Element {
  return <Body {...p} />;
}
