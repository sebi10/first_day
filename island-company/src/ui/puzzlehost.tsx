// Full-screen puzzle frame: timer, first-encounter overlay, help, background
// pause (10 min grace), and the result card. The puzzle itself only draws and
// reports a score.
//  - The clock starts on your first touch, never while you're reading.
//  - Back (before you touch anything) leaves the job untouched.
//  - Handing in early asks first; one attempt per job, as always.
import { useEffect, useRef, useState } from 'preact/hooks';
import { PUZZLES } from '../puzzles';
import { PASS, type PuzzleContext, type PuzzleId, type PuzzleInstance, type PuzzleResult } from '../puzzles/types';
import { REWORK_BELOW, workCredit } from '../sim/econ';
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
  /** outside your trade: no rule text in the overlay */
  expert?: boolean;
  /** seat playing it: "seen this puzzle" is per seat, so pass-and-play works */
  seat?: string;
  /** an owner's trade job: under 40% it isn't signed off and stays open */
  rework?: boolean;
};

const SEEN = 'ic.seen.';

export function PuzzleHost({
  launch,
  onResult,
  onClose,
  onCancel,
}: {
  launch: PuzzleLaunch;
  onResult(r: PuzzleResult): void;
  onClose(): void;
  /** leave without an attempt (only before the first touch) */
  onCancel?(): void;
}) {
  const def = PUZZLES[launch.puzzle];
  const bodyRef = useRef<HTMLDivElement>(null);
  const inst = useRef<PuzzleInstance | null>(null);
  const [status, setStatus] = useState('');
  const [res, setRes] = useState<PuzzleResult | null>(null);
  const seenKey = `${SEEN}${launch.seat ?? 'any'}.${launch.puzzle}`;
  const firstTime = !safeGet(seenKey);
  const [howto, setHowto] = useState<'first' | 'help' | null>(firstTime ? 'first' : null);
  const [started, setStarted] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [oops, setOops] = useState(0);
  const pausedRef = useRef(true);
  const startedRef = useRef(false);
  const hiddenAt = useRef<number | null>(null);
  const timed = launch.tier > 0;
  const total = def.seconds(launch.tier) * (settings.get().timerBoost ? 1.5 : 1) * 1000;
  const [left, setLeft] = useState(1);
  const elapsed = useRef(0);
  const finished = useRef(false);
  /** a solved puzzle's result, locked in while its finish animation plays */
  const held = useRef<PuzzleResult | null>(null);
  // time-up, hand-in or backgrounding: a locked-in result wins over a re-score
  const settleNow = () => {
    if (held.current) finish(held.current);
    else if (inst.current) finish(inst.current.timeUp());
  };

  const finish = (r: PuzzleResult) => {
    if (finished.current) return;
    finished.current = true;
    setConfirm(false);
    setRes(r);
    onResult(r);
  };

  // wrong input must feel wrong without sound too: shake + a short caption
  const hostFx = {
    ...fx,
    bad() {
      fx.bad();
      setOops(performance.now());
      setTimeout(() => setOops(0), 450);
    },
  };

  useEffect(() => {
    if (!bodyRef.current) return;
    const el = document.createElement('div');
    el.className = 'pz';
    bodyRef.current.appendChild(el);
    // first touch inside the puzzle starts the clock
    const onDown = () => {
      if (startedRef.current || howtoRef.current) return;
      startedRef.current = true;
      pausedRef.current = false;
      setStarted(true);
    };
    el.addEventListener('pointerdown', onDown, { capture: true });
    inst.current = def.mount(
      {
        el,
        fx: hostFx,
        done: (r) => finish(held.current ?? r),
        hold: (r, ms) => {
          if (finished.current || held.current) return;
          held.current = r;
          setTimeout(() => finish(r), ms);
        },
        status: setStatus,
        paused: () => (pausedRef.current && startedRef.current) || !!howtoRef.current || finished.current,
      },
      { seed: launch.seed, tier: launch.tier, tools: launch.tools, reducedMotion: settings.get().reduceMotion, context: launch.context },
    );
    return () => {
      el.removeEventListener('pointerdown', onDown, { capture: true });
      inst.current?.destroy();
      el.remove();
    };
  }, []);

  const howtoRef = useRef(howto);
  howtoRef.current = howto;

  // timer: runs only after the first touch, and never while help is open
  useEffect(() => {
    if (!timed) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      if (startedRef.current && !pausedRef.current && !howtoRef.current && !finished.current && !held.current) {
        elapsed.current += dt;
        const l = Math.max(0, 1 - elapsed.current / total);
        setLeft(l);
        if (l <= 0 && inst.current) {
          fx.bad();
          settleNow();
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
        if (away > 10 * 60_000 && startedRef.current && inst.current && !finished.current) settleNow();
        pausedRef.current = !startedRef.current;
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  function dismissHowto() {
    safeSet(seenKey);
    setHowto(null);
  }

  const leave = () => {
    if (res) return onClose();
    if (!started) {
      fx.tap();
      return (onCancel ?? onClose)();
    }
    setConfirm(true);
  };

  const botched = !!res && !!launch.expert && res.score < PASS;
  const reworked = !!res && !!launch.rework && res.score < REWORK_BELOW;
  const verdict = res ? (res.perfect ? 'Perfect' : res.score >= PASS ? 'Pass' : botched ? 'Botched' : reworked ? 'Rework' : 'Partial') : '';
  const credit = res ? Math.round(workCredit(res.score) * 100) : 0;
  const creditLine = botched
    ? 'Under 60% outside your trade: the asset takes −6 and the job stays open for its owner'
    : reworked
      ? 'Under 40%: not signed off. The job stays open with a fresh fault'
      : credit >= 100
        ? 'Full work credit'
        : `${credit}% work credit`;
  const shaking = oops && performance.now() - oops < 400;

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
                onClick={() => {
                  if (howto) return dismissHowto();
                  fx.tap();
                  setHowto('help');
                }}
                style={{ padding: '0 12px' }}
              >
                <Icon name="help" />
              </button>
              {res === null && (
                <button class="btn soft small" aria-label={started ? 'Hand in' : 'Back'} data-esc onClick={leave} style={{ padding: '0 12px' }}>
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
          <span class="label num" style={{ minHeight: 17, color: shaking ? C.rust : undefined }}>
            {shaking ? '✕ Not quite. ' : ''}
            {!started && !howto && timed ? 'Clock starts on your first touch. ' : ''}
            {status}
          </span>
        </div>
        <div class={`phost-body ${shaking ? 'shake' : ''}`} ref={bodyRef}>
          {howto && (
            <div class="howto" onClick={dismissHowto}>
              <span class="chip ink">{def.gesture}</span>
              <h2>{def.howTo}</h2>
              <p class="muted" style={{ margin: 0, maxWidth: 320 }}>
                {launch.expert ? 'Outside your trade: no hints. Under 60% is a botch.' : def.term}
              </p>
              {launch.tools.length > 0 && (
                <p class="label" style={{ margin: 0 }}>
                  Tools: {launch.tools.join(', ')}
                </p>
              )}
              <span class="btn small" style={{ marginTop: 6 }}>
                {howto === 'help' ? 'Back to the job (clock paused)' : 'Got it'}
              </span>
            </div>
          )}
          {confirm && !res && (
            <div class="result">
              <div class="card col" style={{ gap: 10 }}>
                <h3>Hand it in now?</h3>
                <span class="muted">One attempt per job: your score counts as it stands.</span>
                <div class="row" style={{ gap: 8 }}>
                  <Btn kind="ghost" block onClick={() => setConfirm(false)}>
                    Keep working
                  </Btn>
                  <Btn kind="ink" block onClick={settleNow}>
                    Hand in now
                  </Btn>
                </div>
              </div>
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
                  {creditLine}
                  {res.perfect ? ' · perfect: +1% bonus, and it holds a week longer' : ''}
                  {launch.reward && !botched && !reworked ? ` · ${launch.reward}` : ''}
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
