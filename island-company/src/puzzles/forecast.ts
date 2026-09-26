// Analyst · Cash forecast. Sketch the next 4 week-end cash balances with one
// finger. Tiers 0–2 draw a dotted run-rate guide; from tier 3 you only get the
// history and the desk notes (pending approvals, season, storms) and build the
// forecast yourself, like a real 13-week cash view in miniature.
import { C, backdrop, clamp, label, loop, pointer, roundRect, stage } from './kit';
import { result, type PuzzleContext, type PuzzleDef, type PuzzleResult } from './types';

export type ForecastModel = {
  history: number[];
  projection: number[];
  hints: string[];
  showGuide: boolean;
  yMin: number;
  yMax: number;
};

export function generateForecast(_seed: number, tier: number, _tools: string[] = [], ctx?: PuzzleContext): ForecastModel {
  const history = ctx?.cashHistory?.length ? ctx.cashHistory.slice(-6) : [8000, 8600, 9100, 8700, 9800];
  const last = history[history.length - 1];
  const projection = ctx?.projection?.length === 4 ? ctx.projection : [1, 2, 3, 4].map((i) => Math.round(last + i * 650));
  // axis from history + a wide symmetric band, so the bounds don't leak the answer
  const moves = history.slice(1).map((v, i) => Math.abs(v - history[i]));
  const avgMove = moves.length ? moves.reduce((a, b) => a + b, 0) / moves.length : 1500;
  let half = Math.max(6000, avgMove * 7, (Math.max(...history) - Math.min(...history)) * 1.2);
  const need = Math.max(...projection.map((p) => Math.abs(p - last))) * 1.25;
  if (need > half) half = need;
  return { history, projection, hints: ctx?.hints ?? ['Season: flat'], showGuide: tier <= 2, yMin: last - half, yMax: last + half };
}

/** per point: within 10% is full marks (tapering to 0.95), then falls off */
export function pointScore(pred: number, actual: number) {
  const err = Math.abs(pred - actual) / Math.max(5000, Math.abs(actual));
  return err <= 0.1 ? 1 - err * 0.5 : clamp(0.95 - (err - 0.1) * 3, 0, 1);
}

export function scoreForecast(m: ForecastModel, points: (number | null)[]) {
  const s = m.projection.map((p, i) => (points[i] == null ? 0 : pointScore(points[i]!, p)));
  return s.reduce((a, b) => a + b, 0) / s.length;
}

const usdK = (n: number) => `${n < 0 ? '−' : ''}$${(Math.abs(n) / 1000).toFixed(1)}k`;

export const forecast: PuzzleDef = {
  id: 'forecast',
  role: 'fin',
  title: 'Cash forecast',
  gesture: 'Draw a curve',
  howTo: 'Draw next 4 week-end cash balances with one finger.',
  term: 'Forecast: expected cash, from run-rate plus known one-offs and seasonality.',
  seconds: (tier) => 60 + tier * 8,
  mount(host, p) {
    const m = generateForecast(p.seed, p.tier, p.tools, p.context);
    const seasonal = p.tools.includes('seasonality');
    const st = stage(host.el);
    const { ctx } = st;
    const pts: (number | null)[] = [null, null, null, null];
    let drawing = false;
    let finished = false;
    let reveal = 0;
    let lastPencil = 0;

    const geo = () => {
      const w = st.w;
      const h = st.h;
      const top = 70;
      const bottom = h * 0.66;
      const left = 44;
      const right = w - 16;
      const n = m.history.length + 4;
      const colW = (right - left) / (n - 1);
      return { w, h, top, bottom, left, right, n, colW, splitX: left + (m.history.length - 1) * colW };
    };
    const X = (i: number) => geo().left + i * geo().colW;
    const Y = (v: number) => {
      const g = geo();
      return g.bottom - ((v - m.yMin) / (m.yMax - m.yMin)) * (g.bottom - g.top);
    };
    const V = (y: number) => {
      const g = geo();
      return m.yMin + ((g.bottom - y) / (g.bottom - g.top)) * (m.yMax - m.yMin);
    };

    const setFromPointer = (x: number, y: number) => {
      const g = geo();
      const hist = m.history.length - 1;
      for (let k = 0; k < 4; k++) {
        const cx = X(hist + 1 + k);
        if (Math.abs(x - cx) < g.colW * 0.55) {
          const v = Math.round(clamp(V(clamp(y, g.top, g.bottom)), m.yMin, m.yMax) / 50) * 50;
          if (pts[k] !== v) {
            pts[k] = v;
            const now = performance.now();
            if (now - lastPencil > 60) {
              host.fx.pencil();
              lastPencil = now;
            }
          }
        }
      }
      const n = pts.filter((v) => v !== null).length;
      host.status(n < 4 ? `${n}/4 weeks drawn · now ${usdK(m.history[m.history.length - 1])}` : `Forecast ready · ${pts.map((v) => usdK(v!)).join(' → ')}`);
    };

    const offPtr = pointer(st.canvas, {
      down(pt) {
        if (finished || host.paused()) return;
        const g = geo();
        if (pts.every((v) => v !== null) && pt.y > g.h - 76) return submit();
        if (pt.x > g.splitX + g.colW * 0.4 && pt.y > g.top - 30 && pt.y < g.bottom + 30) {
          drawing = true;
          setFromPointer(pt.x, pt.y);
        }
      },
      move(pt) {
        if (drawing && !finished) setFromPointer(pt.x, pt.y);
      },
      up() {
        drawing = false;
      },
    });

    host.status(`0/4 weeks drawn · now ${usdK(m.history[m.history.length - 1])}`);

    const stop = loop(() => draw());

    function draw() {
      const g = geo();
      backdrop(ctx, g.w, g.h);
      // future zone
      ctx.fillStyle = 'rgba(143,184,222,.18)';
      ctx.fillRect(g.splitX + g.colW * 0.5, g.top - 20, g.right - g.splitX - g.colW * 0.5 + 8, g.bottom - g.top + 40);
      label(ctx, 'draw here →', g.splitX + (g.right - g.splitX) / 2 + g.colW * 0.25, g.top - 32, { size: 12, color: C.sea, weight: 800 });
      // gridlines
      ctx.strokeStyle = 'rgba(31,42,48,.08)';
      ctx.lineWidth = 1;
      for (let k = 0; k <= 4; k++) {
        const v = m.yMin + ((m.yMax - m.yMin) * k) / 4;
        const y = Y(v);
        ctx.beginPath();
        ctx.moveTo(g.left, y);
        ctx.lineTo(g.right, y);
        ctx.stroke();
        label(ctx, usdK(v), g.left - 6, y, { size: 10, align: 'right', color: C.inkSoft });
      }
      if (m.yMin < 0) {
        ctx.strokeStyle = C.rust;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(g.left, Y(0));
        ctx.lineTo(g.right, Y(0));
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // x labels
      for (let i = 0; i < g.n; i++) {
        const rel = i - (m.history.length - 1);
        label(ctx, rel === 0 ? 'now' : rel < 0 ? `${rel}` : `+${rel}`, X(i), g.bottom + 16, { size: 10, color: rel > 0 ? C.sea : C.inkSoft, weight: 700 });
      }
      // seasonality band (tool)
      const hist = m.history.length - 1;
      const last = m.history[hist];
      const runRate = m.history.length > 2 ? (last - m.history[Math.max(0, hist - 3)]) / Math.min(3, hist) : 0;
      if (seasonal) {
        ctx.fillStyle = 'rgba(78,138,90,.12)';
        ctx.beginPath();
        for (let k = 0; k <= 4; k++) ctx.lineTo(X(hist + k), Y(last + runRate * k + 1500 + k * 250));
        for (let k = 4; k >= 0; k--) ctx.lineTo(X(hist + k), Y(last + runRate * k - 1500 - k * 250));
        ctx.fill();
      }
      // run-rate guide (teaching tiers only)
      if (m.showGuide) {
        ctx.strokeStyle = C.inkSoft;
        ctx.setLineDash([3, 5]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(X(hist), Y(last));
        ctx.lineTo(X(hist + 4), Y(last + runRate * 4));
        ctx.stroke();
        ctx.setLineDash([]);
        label(ctx, 'run-rate', X(hist + 4) - 4, Y(last + runRate * 4) - 10, { size: 10, align: 'right', color: C.inkSoft });
      }
      // history
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 3;
      ctx.beginPath();
      m.history.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
      ctx.stroke();
      m.history.forEach((v, i) => {
        ctx.fillStyle = C.ink;
        ctx.beginPath();
        ctx.arc(X(i), Y(v), 3.5, 0, Math.PI * 2);
        ctx.fill();
      });
      // your forecast
      ctx.strokeStyle = C.sea;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(X(hist), Y(last));
      pts.forEach((v, k) => v !== null && ctx.lineTo(X(hist + 1 + k), Y(v)));
      ctx.stroke();
      pts.forEach((v, k) => {
        if (v === null) return;
        ctx.fillStyle = C.sea;
        ctx.beginPath();
        ctx.arc(X(hist + 1 + k), Y(v), 6, 0, Math.PI * 2);
        ctx.fill();
      });
      // reveal the model after submit
      if (finished) {
        const t = clamp((performance.now() - reveal) / 600, 0, 1);
        ctx.globalAlpha = t;
        ctx.strokeStyle = C.palm;
        ctx.lineWidth = 2.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(X(hist), Y(last));
        m.projection.forEach((v, k) => ctx.lineTo(X(hist + 1 + k), Y(v)));
        ctx.stroke();
        ctx.setLineDash([]);
        label(ctx, 'desk model', X(hist + 4) - 4, Y(m.projection[3]) + 14, { size: 11, weight: 800, color: C.palm, align: 'right' });
        ctx.globalAlpha = 1;
      }
      // desk notes
      const ny = g.bottom + 40;
      label(ctx, 'Desk notes', 16, ny, { size: 12, weight: 800, align: 'left', color: C.inkSoft });
      m.hints.slice(0, 4).forEach((h, i) => {
        roundRect(ctx, 16, ny + 12 + i * 30, g.w - 32, 24, 8);
        ctx.fillStyle = C.paper;
        ctx.fill();
        label(ctx, h, 26, ny + 24 + i * 30, { size: 12, align: 'left', weight: 700 });
      });
      // submit
      if (pts.every((v) => v !== null) && !finished) {
        roundRect(ctx, g.w / 2 - 110, g.h - 66, 220, 50, 25);
        ctx.fillStyle = C.sea;
        ctx.fill();
        label(ctx, 'Submit forecast', g.w / 2, g.h - 41, { size: 16, weight: 800, color: C.white });
      }
    }

    function submit() {
      if (finished) return;
      finished = true;
      reveal = performance.now();
      const res = makeResult();
      if (res.perfect) host.fx.flourish();
      else host.fx.good();
      setTimeout(() => host.done(res), 1100);
    }

    function makeResult(): PuzzleResult {
      const sc = scoreForecast(m, pts);
      const errs = m.projection.map((v, k) => (pts[k] == null ? 1 : Math.abs(pts[k]! - v) / Math.max(5000, Math.abs(v))));
      const avg = errs.reduce((a, b) => a + b, 0) / 4;
      const filled = pts.map((v, k) => v ?? m.history[m.history.length - 1] + (k + 1) * 0);
      return result(sc, `Forecast within ${Math.round(avg * 100)}% avg`, { points: filled });
    }

    return {
      timeUp() {
        finished = true;
        return makeResult();
      },
      destroy() {
        stop();
        offPtr();
        st.destroy();
      },
    };
  },
};
