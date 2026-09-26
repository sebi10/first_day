// Full-screen puzzle frame: timer, first-encounter overlay, one help pause,
// background pause (10 min grace), and the result card. The puzzle itself
// only draws and reports a score.
import { useEffect, useRef, useState } from 'preact/hooks';
import { PUZZLES } from '../puzzles';
import { PASS, type PuzzleContext, type PuzzleId, type PuzzleInstance, type PuzzleResult } from '../puzzles/types';
import { fx } from './feedback';
import { Btn, Icon, TierDots } from './kit';
import { settings } from './settings';
import { C } from './theme';

export type PuzzleLaunch = {
  puzzle: PuzzleId;
  seed: number;
  tier: number;
  tools: string[];
  title: string;
  subtitle?: string;
  context?: PuzzleContext;
  /** e.g. "+18 airworthiness on Twin N-12" */
  reward?: string;
};

const SEEN = 'ic.seen.';

export function PuzzleHost({ launch, onResult, onClose }: { launch: PuzzleLaunch; onResult(r: PuzzleResult): void; onClose(): void }) {
  const def = PUZZLES[launch.puzzle];
  const bodyRef = useRef<HTMLDivElement>(null);
  const inst = useRef<PuzzleInstance | null>(null);
  const [status, setStatus] = useState('');
  const [res, setRes] = useState<PuzzleResult | null>(null);
  const firstTime = !safeGet(SEEN + launch.puzzle);
  const [howto, setHowto] = useState<'first' | 'help' | null>(firstTime ? 'first' : null);
  const [helpUsed, setHelpUsed] = useState(false);
  const pausedRef = useRef(firstTime);
  const hiddenAt = useRef<number | null>(null);
  const timed = launch.tier > 0;
  const total = def.seconds(launch.tier) * (settings.get().timerBoost ? 1.5 : 1) * 1000;
  const [left, setLeft] = useState(1);
  const elapsed = useRef(0);
  const finished = useRef(false);

  const finish = (r: PuzzleResult) => {
    if (finished.current) return;
    finished.current = true;
    setRes(r);
    onResult(r);
  };

  useEffect(() => {
    if (!bodyRef.current) return;
    const el = document.createElement('div');
    el.className = 'pz';
    bodyRef.current.appendChild(el);
    inst.current = def.mount(
      {
        el,
        fx,
        done: (r) => finish(r),
        status: setStatus,
        paused: () => pausedRef.current || finished.current,
      },
      { seed: launch.seed, tier: launch.tier, tools: launch.tools, reducedMotion: settings.get().reduceMotion, context: launch.context },
    );
    return () => {
      inst.current?.destroy();
      el.remove();
    };
  }, []);

  // first-encounter overlay auto-dismisses after 3 s
  useEffect(() => {
    if (howto !== 'first') return;
    const t = setTimeout(() => dismissHowto(), 3200);
    return () => clearTimeout(t);
  }, [howto]);

  // timer
  useEffect(() => {
    if (!timed) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      if (!pausedRef.current && !finished.current) {
        elapsed.current += dt;
        const l = Math.max(0, 1 - elapsed.current / total);
        setLeft(l);
        if (l <= 0 && inst.current) {
          fx.bad();
          finish(inst.current.timeUp());
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // background pause: resume the same state within 10 min, else score as-is
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) {
        hiddenAt.current = Date.now();
        pausedRef.current = true;
      } else {
        const away = hiddenAt.current ? Date.now() - hiddenAt.current : 0;
        hiddenAt.current = null;
        if (away > 10 * 60_000 && inst.current && !finished.current) finish(inst.current.timeUp());
        pausedRef.current = howto !== null;
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [howto]);

  function dismissHowto() {
    safeSet(SEEN + launch.puzzle);
    setHowto(null);
    pausedRef.current = false;
  }

  const verdict = res ? (res.perfect ? 'Perfect' : res.score >= PASS ? 'Pass' : 'Partial') : '';
  const credit = res ? Math.round(Math.min(1, res.score / PASS) * 100) : 0;

  return (
    <div class="overlay" role="dialog" aria-label={def.title}>
      <div class="overlay-inner">
        <div class="phost-top">
          <div class="row spread">
            <div class="col" style={{ gap: 0, minWidth: 0 }}>
              <h3 style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{launch.title}</h3>
              <span class="label">
                {def.title} · <TierDots tier={launch.tier} />
                {launch.subtitle ? ` · ${launch.subtitle}` : ''}
              </span>
            </div>
            <div class="row" style={{ gap: 6 }}>
              <button
                class="btn soft small"
                aria-label="Help"
                disabled={helpUsed && howto === null}
                onClick={() => {
                  if (howto) return dismissHowto();
                  fx.tap();
                  setHelpUsed(true);
                  pausedRef.current = true;
                  setHowto('help');
                }}
                style={{ padding: '0 12px' }}
              >
                <Icon name="help" />
              </button>
              {res === null && (
                <button
                  class="btn soft small"
                  aria-label="Stop and score"
                  onClick={() => {
                    if (inst.current) finish(inst.current.timeUp());
                  }}
                  style={{ padding: '0 12px' }}
                >
                  <Icon name="x" />
                </button>
              )}
            </div>
          </div>
          {timed ? (
            <div class="timer" aria-hidden="true">
              <i style={{ transform: `scaleX(${left})`, background: left < 0.2 ? C.rust : C.sea }} />
            </div>
          ) : (
            <span class="label">Practice — no timer</span>
          )}
          <span class="label num" style={{ minHeight: 17 }}>
            {status}
          </span>
        </div>
        <div class="phost-body" ref={bodyRef}>
          {howto && (
            <div class="howto" onClick={dismissHowto}>
              <span class="chip ink">{def.gesture}</span>
              <h2>{def.howTo}</h2>
              <p class="muted" style={{ margin: 0, maxWidth: 320 }}>
                {def.term}
              </p>
              {launch.tools.length > 0 && (
                <p class="label" style={{ margin: 0 }}>
                  Tools: {launch.tools.join(', ')}
                </p>
              )}
              <span class="label">{howto === 'help' ? 'Clock paused · tap to resume' : 'Tap to start'}</span>
            </div>
          )}
          {res && (
            <div class="result">
              <div class="card col" style={{ gap: 10 }}>
                <div class="row" style={{ gap: 14 }}>
                  <div class="stamp" style={{ color: res.perfect ? C.palm : res.score >= PASS ? C.sea : C.ink }}>
                    {Math.round(res.score * 100)}
                  </div>
                  <div class="col" style={{ gap: 2 }}>
                    <h2>{verdict}</h2>
                    <span class="muted">{res.summary}</span>
                  </div>
                </div>
                <div class="label">
                  {credit >= 100 ? 'Full order credit' : `${credit}% order credit`}
                  {res.perfect ? ' · +1% permanent bonus' : ''}
                  {launch.reward ? ` · ${launch.reward}` : ''}
                </div>
                <Btn block onClick={onClose}>
                  Continue
                </Btn>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function safeGet(k: string) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function safeSet(k: string) {
  try {
    localStorage.setItem(k, '1');
  } catch {
    /* ignore */
  }
}
