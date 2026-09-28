// Small charts for the analyst's desk, in the repo's style (board.tsx's cash
// history): SVG in a 320-wide viewBox that scales to the card, thin marks, a
// hairline baseline, values in ink, the brand blue for a single series. Every
// chart has a readout that a tap (or keyboard focus) fills, and the cards that
// hold them offer the same numbers as a table.
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';

export const VIZ = { one: 'var(--viz-1)', two: 'var(--viz-2)', three: 'var(--viz-3)', ctx: 'var(--viz-ctx)', grid: 'var(--viz-grid)' };

/** a bar with rounded data ends (r 3) and a square end at the baseline */
function bar(x: number, y: number, w: number, h: number, top: boolean, bottom: boolean): string {
  const r = Math.min(3, w / 2, Math.abs(h) / 2);
  if (h <= 0.5) return '';
  const rt = top ? r : 0;
  const rb = bottom ? r : 0;
  return `M${x} ${y + rt}${rt ? ` Q${x} ${y} ${x + rt} ${y}` : ''} L${x + w - rt} ${y}${rt ? ` Q${x + w} ${y} ${x + w} ${y + rt}` : ''} L${x + w} ${y + h - rb}${rb ? ` Q${x + w} ${y + h} ${x + w - rb} ${y + h}` : ''} L${x + rb} ${y + h}${rb ? ` Q${x} ${y + h} ${x} ${y + h - rb}` : ''} Z`;
}

/** 26 weeks of use in one line: a bar a week, the newest on the right, an empty week a hairline tick */
export function Spark({ series, label, weeks = 26 }: { series: number[]; label: string; weeks?: number }) {
  const W = 104;
  const H = 22;
  const step = W / weeks;
  const bw = Math.max(1.5, step - 1);
  const max = Math.max(1, ...series);
  const off = weeks - series.length;
  return (
    <svg class="spark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <line x1={0} x2={W} y1={H - 0.5} y2={H - 0.5} stroke={VIZ.grid} stroke-width={1} />
      {series.map((v, i) => {
        const x = (off + i) * step;
        if (v <= 0) return null;
        const h = Math.max(3, (v / max) * (H - 2));
        return <path key={i} d={bar(x, H - h, bw, h, true, false)} fill={VIZ.one} />;
      })}
    </svg>
  );
}

export type Seg = { v: number; color: string; name: string };
export type Col = { key: string; label: string; up: Seg[]; down?: Seg[]; tick?: number; read: string };

/**
 * Columns a week: a stack up from the baseline (revenue, or cash out by group), and
 * optionally one down (cash out under revenue: two sides of one baseline). A 2 px
 * gap separates stacked segments; `tick` marks a target on the up stack (the week's
 * revenue budget). Tap or focus a week for its numbers.
 */
export function Columns({ cols, height = 120, label, readTitle }: { cols: Col[]; height?: number; label: string; readTitle?: string }) {
  const [pick, setPick] = useState<number | null>(null);
  const W = 320;
  const H = height;
  const axis = 16;
  const n = Math.max(1, cols.length);
  const slot = W / n;
  const bw = Math.min(24, slot * 0.62);
  const maxUp = Math.max(1, ...cols.map((c) => Math.max(c.up.reduce((a, s) => a + s.v, 0), c.tick ?? 0)));
  const maxDown = Math.max(0, ...cols.map((c) => (c.down ?? []).reduce((a, s) => a + s.v, 0)));
  const plot = H - axis - 6;
  const scale = plot / (maxUp + maxDown);
  const base = 4 + maxUp * scale;
  const shown = pick !== null && cols[pick] ? cols[pick] : cols[cols.length - 1];
  return (
    <div class="col" style={{ gap: 4 }}>
      <div class="chart-read" aria-live="polite">
        {readTitle && pick === null ? <span class="pd-muted">{readTitle} </span> : null}
        {shown?.read}
      </div>
      <svg class="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} style={{ height: `${H}px` }}>
        {cols.map((c, i) => {
          const x = i * slot + (slot - bw) / 2;
          let y = base;
          const up = c.up.filter((s) => s.v > 0);
          const down = (c.down ?? []).filter((s) => s.v > 0);
          return (
            <g key={c.key}>
              {pick === i && <rect class="sel" x={i * slot + 1} y={0} width={slot - 2} height={H - axis + 2} rx={4} />}
              {up.map((s, k) => {
                const h = s.v * scale;
                y -= h;
                const gap = k > 0 ? 2 : 0;
                return <path key={`u${k}`} d={bar(x, y, bw, h - gap, k === up.length - 1, false)} fill={s.color} />;
              })}
              {(() => {
                let yd = base;
                return down.map((s, k) => {
                  const h = s.v * scale;
                  const gap = k > 0 ? 2 : 0;
                  const d = bar(x, yd + gap, bw, h - gap, false, k === down.length - 1);
                  yd += h;
                  return <path key={`d${k}`} d={d} fill={s.color} />;
                });
              })()}
              {c.tick !== undefined && c.tick > 0 && <line x1={x - 3} x2={x + bw + 3} y1={base - c.tick * scale} y2={base - c.tick * scale} stroke="var(--ink)" stroke-width={1.5} />}
              {(n <= 8 || i % 2 === (n - 1) % 2) && (
                <text x={i * slot + slot / 2} y={H - 3} text-anchor="middle">
                  {c.label}
                </text>
              )}
              <rect
                class="hit"
                x={i * slot}
                y={0}
                width={slot}
                height={H}
                tabIndex={0}
                aria-label={c.read}
                onPointerEnter={(e) => e.pointerType === 'mouse' && setPick(i)}
                onClick={() => setPick(pick === i ? null : i)}
                onFocus={() => setPick(i)}
              />
            </g>
          );
        })}
        <line x1={0} x2={W} y1={base} y2={base} stroke="var(--ink)" stroke-opacity={0.25} stroke-width={1} />
      </svg>
    </div>
  );
}

/** one series over the weeks: week-end cash, its last value labelled; a reference line where it matters (the $2,000 freeze) */
export function Line({ points, labels, label, refLine, format }: { points: number[]; labels: string[]; label: string; refLine?: { v: number; text: string }; format(n: number): string }) {
  const [pick, setPick] = useState<number | null>(null);
  const W = 320;
  const H = 86;
  const pad = 10;
  const lo = Math.min(...points, refLine?.v ?? Infinity, 0);
  const hi = Math.max(...points, 1);
  const X = (i: number) => (points.length === 1 ? W / 2 : pad + (i / (points.length - 1)) * (W - pad * 2 - 40));
  const Y = (v: number) => 8 + (1 - (v - lo) / (hi - lo || 1)) * (H - 20);
  const i = pick ?? points.length - 1;
  return (
    <div class="col" style={{ gap: 4 }}>
      <div class="chart-read" aria-live="polite">
        <span class="pd-muted">{labels[i]}: </span>
        <b>{format(points[i] ?? 0)}</b>
      </div>
      <svg class="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} style={{ height: `${H}px` }}>
        {lo < 0 && <line x1={0} x2={W - 36} y1={Y(0)} y2={Y(0)} stroke="var(--ink)" stroke-opacity={0.25} />}
        {refLine && refLine.v > lo && refLine.v < hi && (
          <g>
            <line x1={0} x2={W - 36} y1={Y(refLine.v)} y2={Y(refLine.v)} stroke="var(--rust)" stroke-width={1} />
            <text x={0} y={Y(refLine.v) - 3}>
              {refLine.text}
            </text>
          </g>
        )}
        <path d={points.map((v, k) => `${k ? 'L' : 'M'}${X(k).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ')} stroke={VIZ.one} stroke-width={2} fill="none" stroke-linejoin="round" stroke-linecap="round" />
        {points.length > 0 && (
          <g>
            <circle cx={X(i)} cy={Y(points[i])} r={4} fill={VIZ.one} stroke="var(--paper)" stroke-width={2} />
            {pick === null && (
              <text x={X(points.length - 1) + 8} y={Y(points[points.length - 1]) + 4} style={{ fill: 'var(--ink)' }}>
                {format(points[points.length - 1])}
              </text>
            )}
          </g>
        )}
        {points.map((_, k) => (
          <rect
            key={k}
            class="hit"
            x={X(k) - (W - 40) / Math.max(1, points.length) / 2}
            y={0}
            width={(W - 40) / Math.max(1, points.length)}
            height={H}
            tabIndex={0}
            aria-label={`${labels[k]}: ${format(points[k])}`}
            onPointerEnter={(e) => e.pointerType === 'mouse' && setPick(k)}
            onClick={() => setPick(pick === k ? null : k)}
            onFocus={() => setPick(k)}
          />
        ))}
      </svg>
    </div>
  );
}

/** a legend: a swatch (or a line key) and the name, with a value */
export function Legend({ items }: { items: { color: string; name: string; value?: string; line?: boolean }[] }) {
  return (
    <div class="legend">
      {items.map((x) => (
        <span key={x.name}>
          <i class={x.line ? 'line' : ''} style={{ background: x.color }} />
          {x.name}
          {x.value ? <b style={{ marginLeft: 4 }}>{x.value}</b> : null}
        </span>
      ))}
    </div>
  );
}

/** a ranked list of magnitudes: one hue, the value at the end */
export function BarRows({ rows, lead }: { rows: { key: string; label: ComponentChildren; value: number; text: string; onClick?(): void }[]; lead?: ComponentChildren }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <div class="col" style={{ gap: 0 }}>
      {lead}
      {rows.map((r) => {
        const body = (
          <>
            <span class="pd-wrap">{r.label}</span>
            <span class="v">{r.text}</span>
            <span class="track">
              <i style={{ width: `${Math.max(0, (Math.abs(r.value) / max) * 100)}%` }} />
            </span>
          </>
        );
        return r.onClick ? (
          <button key={r.key} class="barrow tap" onClick={r.onClick}>
            {body}
          </button>
        ) : (
          <div key={r.key} class="barrow">
            {body}
          </div>
        );
      })}
    </div>
  );
}

/** a card's numbers as a table (the charts' accessible twin) */
export function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div class="pd-tablewrap">
      <table class="pd-table">
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, k) => (
                <td key={k}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
