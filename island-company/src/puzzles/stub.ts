// Placeholder used until a puzzle is implemented: tap anywhere to finish.
import { result, type PuzzleDef, type PuzzleId, type PuzzleRole } from './types';

export function stubPuzzle(id: PuzzleId, role: PuzzleRole, title: string): PuzzleDef {
  return {
    id,
    role,
    title,
    gesture: 'Tap',
    howTo: 'Tap to finish.',
    term: title,
    seconds: () => 60,
    mount(host) {
      const b = document.createElement('button');
      b.textContent = `${title} (stub) — tap to finish`;
      b.style.cssText = 'margin:40px auto;display:block;padding:16px';
      b.onclick = () => host.done(result(0.8, 'stub'));
      host.el.appendChild(b);
      return { timeUp: () => result(0.5, 'stub'), destroy: () => b.remove() };
    },
  };
}
