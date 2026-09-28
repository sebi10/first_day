// The island's NPC staff at work (docs/JOBFLOW.md 15.10): builders on the open
// build's site, a pilot by the lead guest plane and one by the cargo plane, a
// housekeeper at a booked house. Up to 8 figures, each one <use> of a symbol
// drawn once in the defs (the same little figure as #i-guy, dressed for the
// job): a hard hat and hi-vis, a housekeeper's apron, a pilot's white shirt and
// cap. None in a storm or at night, when one figure works late at the office
// window. The builders swing a hammer (two frames) when motion is on.
import type { JSX } from 'preact';
import './staff.css';

export function StaffDefs() {
  return (
    <>
      <symbol id="i-npc-builder" overflow="visible">
        <ellipse cx="2.5" cy=".6" rx="4" ry="1.4" fill="rgba(20,50,30,.3)" />
        <path d="M-1.6 0v-4M1.6 0v-4" stroke="#3b4650" stroke-width="1.7" stroke-linecap="round" />
        <path d="M-3 -4v-4.6a3 3 0 0 1 6 0v4.6z" fill="#ff8c42" />
        <path d="M-3 -6.4h6" stroke="#fff27a" stroke-width="1" />
        <circle cy="-11" r="2.6" fill="#f2c7a0" />
        <path d="M-3 -12.4a3 3 0 0 1 6 0h1v1h-8v-1z" fill="#ffd23f" />
      </symbol>
      <symbol id="i-npc-keeper" overflow="visible">
        <ellipse cx="2.5" cy=".6" rx="4" ry="1.4" fill="rgba(20,50,30,.3)" />
        <path d="M-1.6 0v-4M1.6 0v-4" stroke="#3b4650" stroke-width="1.7" stroke-linecap="round" />
        <path d="M-3 -4v-4.6a3 3 0 0 1 6 0v4.6z" fill="#7a5ea8" />
        <path d="M-2 -8.2h4v4.6h-4z" fill="#ffffff" />
        <circle cy="-11" r="2.6" fill="#c98f62" />
        <path d="M-2.6 -11.6a2.6 2.6 0 0 1 5.2 0z" fill="#2b1d14" />
        <circle cx="-2.4" cy="-12.6" r="1.3" fill="#2b1d14" />
      </symbol>
      <symbol id="i-npc-pilot" overflow="visible">
        <ellipse cx="2.5" cy=".6" rx="4" ry="1.4" fill="rgba(20,50,30,.3)" />
        <path d="M-1.6 0v-4M1.6 0v-4" stroke="#1f3550" stroke-width="1.7" stroke-linecap="round" />
        <path d="M-3 -4v-4.6a3 3 0 0 1 6 0v4.6z" fill="#f6f7f9" />
        <path d="M0 -8.6v3" stroke="#1f3550" stroke-width=".8" />
        <path d="M-3 -8.2l1.6 .4M3 -8.2l-1.6 .4" stroke="#d9a520" stroke-width=".9" />
        <circle cy="-11" r="2.6" fill="#f2c7a0" />
        <path d="M-2.9 -12.2a2.9 2.2 0 0 1 5.8 0z" fill="#1f3550" />
        <path d="M-.4 -12.2h4" stroke="#1f3550" stroke-width="1" stroke-linecap="round" />
      </symbol>
    </>
  );
}

export type NpcKind = 'builder' | 'keeper' | 'pilot';
const r1 = (n: number) => Math.round(n * 10) / 10;

/** one member of staff at a ground point (x, y); a builder swings a hammer when motion is on */
export function NpcFigure({ kind, x, y, flip, motion }: { kind: NpcKind; x: number; y: number; flip?: boolean; motion?: boolean }): JSX.Element {
  const t = `translate(${r1(x)} ${r1(y)})${flip ? ' scale(-1 1)' : ''}`;
  if (kind !== 'builder') return <use href={`#i-npc-${kind}`} transform={t} />;
  return (
    <g transform={t}>
      <use href="#i-npc-builder" />
      {/* the hammer arm pivots at the shoulder: two frames, up and down */}
      <g transform="translate(2.6 -7.6)">
        <g class={motion ? 'npc-hammer' : undefined}>
          <path d="M0 0l3.4 -2.6" stroke="#6b4a2a" stroke-width="1.1" stroke-linecap="round" />
          <path d="M2.4 -4.2l2.2 2.8" stroke="#4d5358" stroke-width="1.8" stroke-linecap="round" />
        </g>
      </g>
    </g>
  );
}

/** at night, someone works late at the office: head and shoulders in the lit window (sloping shoulders, the head apart: never a padlock) */
export function OfficeLate({ x, y }: { x: number; y: number }) {
  return <path d={`M${r1(x - 3.6)} ${r1(y)}c0 -2.2 1.4 -3.1 3.6 -3.1s3.6 .9 3.6 3.1zM${r1(x + 0.3)} ${r1(y - 4.9)}m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0`} fill="#3a2a1c" opacity=".78" />;
}
