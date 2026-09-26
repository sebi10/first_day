// Shared canvas plumbing for puzzles: DPR-correct stage, rAF loop, pointer
// capture, and a few drawing helpers. Keeps every puzzle at one-frame feedback.
import { C, FONT } from '../ui/theme';

export { C, FONT };

export type Stage = {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** CSS pixel size */
  w: number;
  h: number;
  onResize(cb: () => void): void;
  destroy(): void;
};

export function stage(el: HTMLElement): Stage {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;user-select:none;-webkit-user-select:none';
  el.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;
  const cbs: (() => void)[] = [];
  const s: Stage = {
    canvas,
    ctx,
    w: 0,
    h: 0,
    onResize: (cb) => cbs.push(cb),
    destroy: () => {
      ro.disconnect();
      canvas.remove();
    },
  };
  const fit = () => {
    const r = el.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    s.w = Math.max(1, r.width);
    s.h = Math.max(1, r.height);
    canvas.width = Math.round(s.w * dpr);
    canvas.height = Math.round(s.h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cbs.forEach((f) => f());
  };
  const ro = new ResizeObserver(fit);
  ro.observe(el);
  fit();
  return s;
}

/** requestAnimationFrame loop; dt in seconds (clamped). Returns stop(). */
export function loop(frame: (t: number, dt: number) => void): () => void {
  let raf = 0;
  let last = performance.now();
  let alive = true;
  const tick = (now: number) => {
    if (!alive) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    frame(now / 1000, dt);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => {
    alive = false;
    cancelAnimationFrame(raf);
  };
}

export type Pt = { x: number; y: number; id: number };

export function pointer(
  canvas: HTMLElement,
  h: { down?(p: Pt): void; move?(p: Pt): void; up?(p: Pt): void },
): () => void {
  const local = (e: PointerEvent): Pt => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, id: e.pointerId };
  };
  const down = (e: PointerEvent) => {
    e.preventDefault();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events */
    }
    h.down?.(local(e));
  };
  const move = (e: PointerEvent) => {
    e.preventDefault();
    h.move?.(local(e));
  };
  const up = (e: PointerEvent) => {
    h.up?.(local(e));
  };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  return () => {
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('pointercancel', up);
  };
}

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

export const ease = {
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
};

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function label(
  ctx: CanvasRenderingContext2D,
  str: string,
  x: number,
  y: number,
  o: { size?: number; weight?: number; color?: string; align?: CanvasTextAlign; base?: CanvasTextBaseline } = {},
) {
  ctx.font = `${o.weight ?? 600} ${o.size ?? 13}px ${FONT}`;
  ctx.fillStyle = o.color ?? C.ink;
  ctx.textAlign = o.align ?? 'center';
  ctx.textBaseline = o.base ?? 'middle';
  ctx.fillText(str, x, y);
}

/** Painterly backdrop: soft vertical gradient in sand, used behind every puzzle */
export function backdrop(ctx: CanvasRenderingContext2D, w: number, h: number, tint: string = C.sand) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, C.paper);
  g.addColorStop(1, tint);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/** Mix a hex colour toward white (amt>0) or ink (amt<0). */
export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255,
    g = (n >> 8) & 255,
    b = n & 255;
  const t = amt > 0 ? 255 : 0;
  const p = Math.abs(amt);
  r = Math.round(r + (t - r) * p);
  g = Math.round(g + (t - g) * p);
  b = Math.round(b + (t - b) * p);
  return `rgb(${r},${g},${b})`;
}
