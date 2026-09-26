// Haptics + synthesized sound. No audio files: every sound is generated with
// WebAudio so the install stays tiny and nothing has to load.
import { settings } from './settings';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function audio(): AudioContext | null {
  if (!settings.get().sound) return null;
  if (!ctx) {
    try {
      // iOS 17+: respect the silent switch and duck under calls.
      const nav = navigator as Navigator & { audioSession?: { type: string } };
      if (nav.audioSession) nav.audioSession.type = 'ambient';
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.3, slideTo?: number, delay = 0) {
  const a = audio();
  if (!a || !master) return;
  const t0 = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

let noiseBuf: AudioBuffer | null = null;
function noise(dur: number, vol = 0.25, filterFreq = 2000, q = 1, delay = 0) {
  const a = audio();
  if (!a || !master) return;
  if (!noiseBuf) {
    noiseBuf = a.createBuffer(1, a.sampleRate * 0.5, a.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t0 = a.currentTime + delay;
  const src = a.createBufferSource();
  src.buffer = noiseBuf;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = filterFreq;
  f.Q.value = q;
  const g = a.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

// iOS Safari has no Vibration API. Toggling a native <input switch> fires the
// system haptic on iOS 18+, so we keep one hidden and click its label.
let iosLabel: HTMLLabelElement | null = null;
function iosTick() {
  if (!iosLabel) {
    const id = 'ic-haptic-switch';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.setAttribute('switch', '');
    input.style.cssText = 'position:fixed;left:-100px;top:-100px;opacity:0;pointer-events:none';
    iosLabel = document.createElement('label');
    iosLabel.htmlFor = id;
    iosLabel.style.cssText = 'position:fixed;left:-100px;top:-100px;opacity:0;pointer-events:none';
    document.body.append(input, iosLabel);
  }
  iosLabel.click();
}

const canVibrate = typeof navigator !== 'undefined' && 'vibrate' in navigator;
function buzz(pattern: number | number[]) {
  if (!settings.get().haptics) return;
  if (canVibrate) {
    try {
      navigator.vibrate(pattern);
    } catch {
      /* ignore */
    }
  } else if (typeof document !== 'undefined') {
    const pulses = Array.isArray(pattern) ? Math.ceil(pattern.length / 2) : 1;
    iosTick();
    if (pulses > 1) setTimeout(iosTick, 90);
  }
}

export const fx = {
  /** light tap on select */
  tap() {
    buzz(8);
    tone(1400, 0.03, 'sine', 0.12);
  },
  /** medium: something seated / landed / approved */
  snap() {
    buzz(18);
    noise(0.04, 0.35, 3200, 2);
    tone(520, 0.06, 'triangle', 0.2);
  },
  /** ratchet click (torque wrench, dial detents) */
  tick() {
    buzz(4);
    noise(0.015, 0.18, 5000, 4);
  },
  /** breaker thunk */
  thunk() {
    buzz(22);
    tone(110, 0.12, 'sine', 0.45, 60);
    noise(0.05, 0.2, 800, 1);
  },
  /** pencil on paper */
  pencil() {
    noise(0.05, 0.05, 6000, 0.7);
  },
  /** rigid double: fault found */
  fault() {
    buzz([20, 60, 20]);
    tone(880, 0.07, 'square', 0.12);
    tone(1175, 0.09, 'square', 0.12, undefined, 0.08);
  },
  /** wrong input: feels wrong, never punishes */
  bad() {
    buzz([12, 40, 12]);
    tone(180, 0.14, 'sawtooth', 0.12, 120);
  },
  good() {
    buzz(14);
    tone(660, 0.08, 'triangle', 0.18);
    tone(990, 0.12, 'triangle', 0.18, undefined, 0.07);
  },
  /** perfect-run flourish */
  flourish() {
    buzz([10, 50, 10, 50, 30]);
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, 'triangle', 0.16, undefined, i * 0.07));
  },
  /** soft pulse: week resolved */
  pulse() {
    buzz(30);
    tone(392, 0.4, 'sine', 0.2, 523);
  },
  swipe() {
    noise(0.08, 0.08, 1500, 0.5);
  },
};

export type Fx = typeof fx;
