// The mechanic's walkaround (docs/EXPANSION.md 6.4): the plane in plan view (or
// the generator side on, its door open) with every zone's observation in one view,
// as a real walkaround circles the whole aircraft. He taps the zone he'd write up,
// then Write it up; or All serviceable. At most 3 taps from the sheet: Walkaround,
// a zone, the call.
//
// The skill is reading the signs: brake dust vs fretting dust, a breather's mist vs
// a weeping seal, oil-can paint vs working rivets. Nothing here reads which zone
// holds a tell (the view's words are all it has, and a tell and a benign sign read
// alike); nothing says whether the call was right. Drawn in the ground power
// sheet's style (gse.tsx's plug close-up).
import { useState } from 'preact/hooks';
import { planeModel, type PlaneModel } from '../../sim/aircraft';
import type { CheckView } from '../../sim/checks';
import type { Asset } from '../../sim/types';
import { fx } from '../feedback';
import { C } from '../theme';
import { CheckFoot, Help } from './parts';

type Pt = [number, number];
/** a zone's marker on the drawing: where the badge sits and the spot it points at */
type Mark = { at: Pt; spot: Pt };
type Art = 'twin' | 'cargo' | 'float' | 'gen';

const MARKS: Record<Art, Record<string, Mark>> = {
  twin: {
    nose: { at: [204, 30], spot: [162, 33] },
    lmain: { at: [52, 146], spot: [98, 124] },
    lnac: { at: [50, 50], spot: [98, 74] },
    root: { at: [160, 146], spot: [160, 118] },
    rnac: { at: [270, 50], spot: [222, 74] },
    rmain: { at: [268, 146], spot: [222, 124] },
  },
  cargo: {
    cowl: { at: [110, 22], spot: [156, 26] },
    nose: { at: [210, 50], spot: [162, 44] },
    lmain: { at: [64, 150], spot: [112, 128] },
    root: { at: [102, 112], spot: [143, 88] },
    tail: { at: [212, 200], spot: [168, 192] },
    rmain: { at: [256, 150], spot: [208, 128] },
  },
  float: {
    cowl: { at: [210, 22], spot: [164, 26] },
    lfloat: { at: [62, 166], spot: [112, 150] },
    root: { at: [96, 52], spot: [143, 80] },
    tail: { at: [210, 204], spot: [166, 196] },
    rfloat: { at: [258, 166], spot: [208, 150] },
  },
  gen: {
    mounts: { at: [30, 184], spot: [70, 162] },
    belt: { at: [24, 64], spot: [56, 98] },
    exhaust: { at: [200, 18], spot: [152, 26] },
    enclosure: { at: [292, 64], spot: [270, 92] },
  },
};

const INK = '#3a3f42';
const SKIN = '#f7f4ec';
const DETAIL = '#8d969b';

function TwinArt() {
  return (
    <g stroke={INK} stroke-width="1.6" stroke-linejoin="round">
      {/* wings and stabilizer under the fuselage */}
      <path d="M144 84 L26 92 Q18 93 18 100 L20 108 Q21 113 27 113 L144 111 Z" fill={SKIN} />
      <path d="M176 84 L294 92 Q302 93 302 100 L300 108 Q299 113 293 113 L176 111 Z" fill={SKIN} />
      <path d="M146 182 L110 188 L110 199 L146 197 Z" fill={SKIN} />
      <path d="M174 182 L210 188 L210 199 L174 197 Z" fill={SKIN} />
      {/* the nacelles and their props */}
      {[98, 222].map((x) => (
        <g key={x}>
          <rect x={x - 11} y="62" width="22" height="72" rx="10" fill="#efebe1" />
          <line x1={x - 26} y1="60" x2={x + 26} y2="60" stroke="#26292b" stroke-width="3" stroke-linecap="round" />
          <circle cx={x} cy="60" r="4" fill="#26292b" />
          <ellipse cx={x} cy="124" rx="6" ry="9" fill="none" stroke={DETAIL} stroke-dasharray="3 2" />
        </g>
      ))}
      <path d="M160 14 C171 14 175 30 176 50 L178 150 C178 168 170 190 164 204 L156 204 C150 190 142 168 142 150 L144 50 C145 30 149 14 160 14 Z" fill={SKIN} />
      <path d="M150 42 Q160 33 170 42 L169 54 Q160 49 151 54 Z" fill="#5b7f8f" stroke="none" />
      <line x1="160" y1="176" x2="160" y2="208" stroke="#26292b" stroke-width="4" stroke-linecap="round" />
      <ellipse cx="160" cy="33" rx="5" ry="7" fill="none" stroke={DETAIL} stroke-dasharray="3 2" />
    </g>
  );
}

function CargoArt() {
  return (
    <g stroke={INK} stroke-width="1.6" stroke-linejoin="round">
      <path d="M142 70 L20 76 Q12 77 12 84 L14 92 Q15 97 21 97 L142 97 Z" fill={SKIN} />
      <path d="M178 70 L300 76 Q308 77 308 84 L306 92 Q305 97 299 97 L178 97 Z" fill={SKIN} />
      <path d="M144 180 L104 186 L104 198 L144 196 Z" fill={SKIN} />
      <path d="M176 180 L216 186 L216 198 L176 196 Z" fill={SKIN} />
      {/* the spring-steel main gear out to the sides */}
      <path d="M142 118 L114 126" stroke="#26292b" stroke-width="3" />
      <path d="M178 118 L206 126" stroke="#26292b" stroke-width="3" />
      <ellipse cx="112" cy="128" rx="6" ry="10" fill="#3b4043" stroke="none" />
      <ellipse cx="208" cy="128" rx="6" ry="10" fill="#3b4043" stroke="none" />
      <path d="M160 12 C170 12 174 22 175 36 L178 60 L178 160 C177 176 170 194 164 206 L156 206 C150 194 143 176 142 160 L142 60 L145 36 C146 22 150 12 160 12 Z" fill={SKIN} />
      <path d="M146 30 L174 30 L177 52 L143 52 Z" fill="#dcd6c9" stroke="none" />
      <line x1="126" y1="10" x2="194" y2="10" stroke="#26292b" stroke-width="3" stroke-linecap="round" />
      <circle cx="160" cy="11" r="4" fill="#26292b" stroke="none" />
      {/* the belly cargo pod, seen through */}
      <rect x="149" y="70" width="22" height="84" rx="6" fill="none" stroke={DETAIL} stroke-dasharray="4 3" />
      <line x1="160" y1="176" x2="160" y2="210" stroke="#26292b" stroke-width="4" stroke-linecap="round" />
      <ellipse cx="162" cy="44" rx="5" ry="7" fill="none" stroke={DETAIL} stroke-dasharray="3 2" />
    </g>
  );
}

function FloatArt() {
  const float = (x: number) => `M${x} 22 C${x + 8} 22 ${x + 12} 42 ${x + 12} 62 L${x + 12} 180 C${x + 12} 190 ${x + 6} 198 ${x} 198 C${x - 6} 198 ${x - 12} 190 ${x - 12} 180 L${x - 12} 62 C${x - 12} 42 ${x - 8} 22 ${x} 22 Z`;
  return (
    <g stroke={INK} stroke-width="1.6" stroke-linejoin="round">
      {/* the amphibious floats under the airframe, their spreader bars and retractable wheels */}
      <path d={float(112)} fill="#ece6d8" />
      <path d={float(208)} fill="#ece6d8" />
      <line x1="112" y1="66" x2="208" y2="66" stroke={DETAIL} stroke-width="2" />
      <line x1="112" y1="146" x2="208" y2="146" stroke={DETAIL} stroke-width="2" />
      <ellipse cx="112" cy="150" rx="5" ry="8" fill="none" stroke="#26292b" stroke-dasharray="3 2" />
      <ellipse cx="208" cy="150" rx="5" ry="8" fill="none" stroke="#26292b" stroke-dasharray="3 2" />
      <path d="M142 66 L20 72 Q12 73 12 80 L14 88 Q15 93 21 93 L142 93 Z" fill={SKIN} />
      <path d="M178 66 L300 72 Q308 73 308 80 L306 88 Q305 93 299 93 L178 93 Z" fill={SKIN} />
      <path d="M160 14 C170 14 174 24 175 38 L177 60 L176 158 C175 174 170 190 164 200 L156 200 C150 190 145 174 144 158 L143 60 L145 38 C146 24 150 14 160 14 Z" fill={SKIN} />
      <path d="M147 30 L173 30 L176 50 L144 50 Z" fill="#dcd6c9" stroke="none" />
      <line x1="130" y1="12" x2="190" y2="12" stroke="#26292b" stroke-width="3" stroke-linecap="round" />
      <path d="M146 178 L112 184 L112 194 L146 192 Z" fill={SKIN} />
      <path d="M174 178 L208 184 L208 194 L174 192 Z" fill={SKIN} />
      <line x1="160" y1="174" x2="160" y2="206" stroke="#26292b" stroke-width="4" stroke-linecap="round" />
    </g>
  );
}

function GenArt() {
  return (
    <g stroke={INK} stroke-width="1.6" stroke-linejoin="round">
      <line x1="8" y1="176" x2="312" y2="176" stroke="#9a8c6f" stroke-width="2" />
      {/* the enclosure, its door swung open */}
      <rect x="22" y="40" width="276" height="136" rx="8" fill="#d7d9d2" />
      <path d="M296 44 L316 58 L316 168 L296 172" fill="#c8cbc3" />
      <rect x="30" y="48" width="260" height="120" rx="4" fill="#bfc4bf" stroke="none" />
      {/* the stack through the roof, its rain cap */}
      <rect x="146" y="22" width="12" height="42" fill="#6d6259" />
      <path d="M138 22 L166 22 L160 16 L144 16 Z" fill="#4a4540" />
      <rect x="112" y="56" width="80" height="16" rx="7" fill="#7a6d62" />
      {/* the radiator and fan end, the belt */}
      <rect x="36" y="70" width="18" height="84" rx="2" fill="#6b6f70" />
      <circle cx="58" cy="98" r="14" fill="#4b5053" />
      <circle cx="86" cy="130" r="7" fill="#4b5053" />
      <path d="M58 84 L88 123 M44 98 L79 130" stroke="#1d2022" stroke-width="3.5" stroke-linecap="round" />
      {/* the engine block and the alternator end */}
      <rect x="70" y="82" width="100" height="64" rx="6" fill="#7b858a" />
      <rect x="78" y="74" width="84" height="12" rx="4" fill="#5e676c" />
      <rect x="170" y="90" width="84" height="56" rx="12" fill="#4f6b78" />
      {[184, 198, 212, 226, 240].map((x) => (
        <line key={x} x1={x} y1="96" x2={x} y2="140" stroke="#3e5661" stroke-width="2" />
      ))}
      {/* the base frame on its isolators */}
      <rect x="48" y="146" width="222" height="10" rx="2" fill="#44484a" />
      {[62, 154, 246].map((x) => (
        <rect key={x} x={x} y="156" width="16" height="9" rx="3" fill="#1f2224" stroke="none" />
      ))}
      <rect x="258" y="70" width="26" height="40" rx="3" fill="#e9e3d5" />
      <line x1="262" y1="80" x2="280" y2="80" stroke={DETAIL} />
      <line x1="262" y1="88" x2="280" y2="88" stroke={DETAIL} />
    </g>
  );
}

const ART: Record<Art, { vb: string; draw: () => preact.JSX.Element; caption: string }> = {
  twin: { vb: '0 0 320 222', draw: TwinArt, caption: 'plan view, nose up' },
  cargo: { vb: '0 0 320 222', draw: CargoArt, caption: 'plan view, nose up' },
  float: { vb: '0 0 320 222', draw: FloatArt, caption: 'plan view, nose up' },
  gen: { vb: '0 0 320 202', draw: GenArt, caption: 'side on, door open, locked out' },
};

export const artOf = (a: Pick<Asset, 'kind' | 'model'>): Art => (a.kind === 'generator' ? 'gen' : (planeModel(a.model) as PlaneModel));

/** the drawing with a numbered marker per zone (the walk's order); a tap on a marker picks its zone */
export function WalkArt({ a, view, pick, onPick }: { a: Pick<Asset, 'kind' | 'model' | 'name'>; view: CheckView; pick: string | null; onPick(id: string): void }) {
  const art = artOf(a);
  const marks = MARKS[art];
  const A = ART[art];
  const [, , w, h] = A.vb.split(' ').map(Number);
  return (
    <svg class="qc-art" viewBox={A.vb} role="img" aria-label={`${a.name}, ${A.caption}: ${view.items.length} zones`}>
      <rect x="0" y="0" width={w} height={h} rx="12" fill="#e9e3d5" />
      {art !== 'gen' && [40, 110, 180].map((y) => <line key={y} x1="0" y1={y} x2={w} y2={y} stroke="#ddd5c4" stroke-width="1" />)}
      <A.draw />
      {view.items.map((it, i) => {
        const m = marks[it.id];
        if (!m) return null;
        const on = pick === it.id;
        return (
          <g
            key={it.id}
            class={`mk ${on ? 'on' : ''}`}
            aria-hidden="true"
            onClick={() => {
              fx.tap();
              onPick(it.id);
            }}
          >
            <line x1={m.at[0]} y1={m.at[1]} x2={m.spot[0]} y2={m.spot[1]} stroke="#5b6475" stroke-width="1.3" stroke-dasharray="3 2" />
            <circle cx={m.spot[0]} cy={m.spot[1]} r="3" fill={C.ink} />
            {on && <circle class="pulse" cx={m.at[0]} cy={m.at[1]} r="15" fill={C.sea} />}
            <circle class="ring" cx={m.at[0]} cy={m.at[1]} r="14" fill={on ? C.sea : C.paper} stroke={on ? C.seaDeep : C.ink} stroke-width="2" />
            <text x={m.at[0]} y={m.at[1] + 4.5} text-anchor="middle" font-size="13" font-weight="900" fill={on ? C.white : C.ink}>
              {i + 1}
            </text>
            {/* the tap target: 44 CSS px on a 358 px phone */}
            <circle cx={m.at[0]} cy={m.at[1]} r="22" fill="transparent" />
          </g>
        );
      })}
      <text x={art === 'gen' ? 308 : 12} y={art === 'gen' ? 196 : h - 8} text-anchor={art === 'gen' ? 'end' : 'start'} font-size="10.5" font-weight="700" fill="#5b6475">
        {A.caption}
      </text>
    </svg>
  );
}

export function Walkaround({ a, view, busy, onCall }: { a: Pick<Asset, 'kind' | 'model' | 'name'>; view: CheckView; busy?: boolean; onCall(item: string | null): void }) {
  const [pick, setPick] = useState<string | null>(null);
  const toggle = (id: string) => setPick((p) => (p === id ? null : id));
  const picked = view.items.find((i) => i.id === pick);
  const gen = a.kind === 'generator';
  return (
    <div class="col qc">
      <p class="qc-lead">
        {gen ? 'Round the set, shut down and locked out.' : `Round ${a.name}, every zone in one view.`} Tap what you'd write up, or call it all serviceable.
      </p>
      <WalkArt a={a} view={view} pick={pick} onPick={toggle} />
      <div class="qc-items">
        {view.items.map((it, i) => (
          <button key={it.id} class={`qc-item ${pick === it.id ? 'on' : ''}`} aria-pressed={pick === it.id} onClick={() => toggle(it.id)}>
            <span class="qc-num" aria-hidden="true">
              {i + 1}
            </span>
            <span class="col" style={{ gap: 2 }}>
              <b>{it.label}</b>
              <span class="t">{it.text}</span>
            </span>
          </button>
        ))}
      </div>
      <Help lines={view.help} />
      <CheckFoot none="All serviceable" call="Write it up" pick={pick} pickLabel={picked?.label} busy={busy} onCall={onCall} />
    </div>
  );
}
