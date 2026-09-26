// Planes (seen from above, squashed for the 3/4 view) and boats.
import { K } from './paint';

export type PlaneModel = 'twin' | 'cargo' | 'float';
const LIVERY: Record<PlaneModel, string> = { twin: '#2f7fd8', cargo: '#f29a2e', float: '#17a39c' };

const WING = (s: number, c0: number, c1: number) => `M${c0 + 1} ${-s}H${c1 - 1}Q${c1} ${-s} ${c1} ${-s + 2}V${s - 2}Q${c1} ${s} ${c1 - 1} ${s}H${c0 + 1}Q${c0} ${s} ${c0} ${s - 2}V${-s + 2}Q${c0} ${-s} ${c0 + 1} ${-s}Z`;

/** silhouette pieces in local space (nose toward +x) */
function parts(m: PlaneModel) {
  const fw = m === 'cargo' ? 5.5 : 4;
  const len = m === 'cargo' ? 26 : 25;
  const fus = `M${-len} ${-fw * 0.55}Q${-len * 0.2} ${-fw} ${len * 0.6} ${-fw}Q${len} ${-fw} ${len} 0Q${len} ${fw} ${len * 0.6} ${fw}Q${-len * 0.2} ${fw} ${-len} ${fw * 0.55}Z`;
  const span = m === 'cargo' ? 30 : m === 'float' ? 28 : 27;
  const wing = WING(span, m === 'twin' ? -3 : -1, m === 'twin' ? 8 : 9);
  const tail = WING(m === 'cargo' ? 11 : 10, -len, -len + 6);
  return { fus, wing, tail, len, fw, span };
}

export function Plane({ model, x, y, rot, jacks, service, chocks, flying, mood = 1, size = 1 }: { model: PlaneModel; x: number; y: number; rot: number; jacks?: boolean; service?: boolean; chocks?: boolean; flying?: boolean; mood?: number; size?: number }) {
  const p = parts(model);
  const liv = LIVERY[model];
  const body = mood < 1 ? '#e9e6de' : '#fbfbf7';
  const sil = p.wing + p.fus + p.tail;
  const lift = jacks ? 5 : 0;
  const open = jacks || service;
  return (
    <g transform={`translate(${x} ${y}) scale(${Math.round(138 * size) / 100})`}>
      {!flying && <path d={sil} fill="rgba(20,40,40,.3)" transform={`translate(6 ${5 + lift}) scale(1 .72) rotate(${rot})`} />}
      <g transform={`translate(0 ${-lift}) scale(1 .72) rotate(${rot})`}>
        {model === 'float' && <path d={`M-18 -12.5h30q6 0 8 2.5q-2 2.5 -8 2.5h-30zM-18 7.5h30q6 0 8 2.5q-2 2.5 -8 2.5h-30z`} fill="#c9d0d4" stroke="#8e999f" stroke-width=".8" />}
        <path d={p.wing} fill={body} stroke="#7d878c" stroke-width=".9" />
        <path d={`M${model === 'twin' ? 5 : 6} ${-p.span}h2v6h-2zM${model === 'twin' ? 5 : 6} ${p.span - 6}h2v6h-2z`} fill={liv} />
        {model === 'twin' && (
          <>
            <path d="M-2 -14h13q3 0 3 2.5q0 2.5 -3 2.5h-13zM-2 9.5h13q3 0 3 2.5q0 2.5 -3 2.5h-13z" fill={open ? '#56606a' : '#e2e4e0'} stroke="#b8bbb4" stroke-width=".6" />
            {!open && <path d="M15 -17v10M15 7v10" stroke="#7d868c" stroke-width="1.6" stroke-linecap="round" opacity=".7" />}
          </>
        )}
        <path d={p.fus} fill={body} stroke="#7d878c" stroke-width=".9" />
        <path d={`M${-p.len + 3} 0H${p.len * 0.45}`} stroke={liv} stroke-width={p.fw * 0.55} stroke-linecap="round" />
        <path d={p.tail} fill={body} stroke="#7d878c" stroke-width=".9" />
        <path d={`M${-p.len} 0h8`} stroke={liv} stroke-width="3.2" stroke-linecap="round" />
        <path d={`M${p.len * 0.5} ${-p.fw * 0.7}q${p.fw * 1.3} ${p.fw * 0.7} 0 ${p.fw * 1.4}z`} fill="#2d4d66" />
        {model !== 'twin' && !open && <path d={`M${p.len + 1} -6v12`} stroke="#7d868c" stroke-width="1.8" stroke-linecap="round" opacity=".75" />}
        {open && model !== 'twin' && <path d={`M${p.len * 0.55} ${-p.fw}h${p.len * 0.45}v${p.fw * 2}h${-p.len * 0.45}z`} fill="#56606a" />}
      </g>
      {jacks && (
        <g fill="#f2c230" stroke="#6d5a1c" stroke-width=".6">
          <path d="M-3 -16l3 11l3 -11zM-3 8l3 9l3 -9z" />
          <path d="M-21 -2l2 7l2 -7z" />
        </g>
      )}
      {jacks && (
        <g>
          <rect x={16} y={10} width={9} height={5} rx={1} fill={K.red} />
          <rect x={17.5} y={8.4} width={6} height={2} rx={1} fill="#8a2a22" />
          <path d="M-30 14l12 -3l2 4l-12 3z" fill="#aeb6ba" />
        </g>
      )}
      {chocks && (
        <g>
          <path d="M-6 8h4v3h-4zM3 8h4v3h-4zM20 2h4v3h-4z" fill={K.yellow} stroke="#7a6010" stroke-width=".5" />
          {[
            [-34, -4], [30, -18], [28, 14],
          ].map(([cx, cy], i) => (
            <g key={i} transform={`translate(${cx} ${cy})`}>
              <path d="M-4 2h8l-3 -9h-2z" fill="#ff7a1f" />
              <path d="M-3 -1h6" stroke="#fff" stroke-width="1.4" />
            </g>
          ))}
        </g>
      )}
    </g>
  );
}

/** the fly-by: a plane silhouette high up with its shadow far below */
export function FlyingPlane() {
  const p = parts('twin');
  return (
    <g>
      <path d={p.wing + p.fus + p.tail} fill="rgba(20,50,90,.22)" transform="translate(26 60) scale(.8 .6)" />
      <g transform="scale(.9 .7)">
        <path d={p.wing} fill="#fff" />
        <path d="M-2 -14h13q3 0 3 2.5q0 2.5 -3 2.5h-13zM-2 9.5h13q3 0 3 2.5q0 2.5 -3 2.5h-13z" fill="#e2e4e0" />
        <path d={p.fus} fill="#fff" />
        <path d={p.tail} fill="#fff" />
        <path d={`M${-p.len + 3} 0H${p.len * 0.45}`} stroke={LIVERY.twin} stroke-width="2.2" stroke-linecap="round" />
        <path d="M13 -3q5 3 0 6z" fill="#2d4d66" />
      </g>
    </g>
  );
}

/** a small wooden boat pulled up on the sand */
export function Dinghy({ x, y, rot, hull }: { x: number; y: number; rot: number; hull: string }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`}>
      <ellipse cx={4} cy={4} rx={18} ry={6} fill="rgba(150,100,40,.3)" />
      <path d="M-18 0Q-14 -8 4 -8Q16 -8 20 0Q16 8 4 8Q-14 8 -18 0Z" fill={hull} />
      <path d="M-15 0Q-12 -5.5 4 -5.5Q14 -5.5 17 0Q14 5.5 4 5.5Q-12 5.5 -15 0Z" fill={K.woodLight} />
      <path d="M-4 -5.5v11M7 -5.5v11" stroke={K.woodDark} stroke-width="2.2" />
      <path d="M-8 -2l22 -9" stroke="#8a5a30" stroke-width="1.4" />
    </g>
  );
}

/** sailboat standing on the water */
export function Sailboat({ sail = '#ffffff', stripe = K.blue }: { sail?: string; stripe?: string }) {
  return (
    <g>
      <path d="M-26 6q8 -3 16 0M14 8q8 -3 16 0" stroke="#fff" stroke-width="1.6" fill="none" opacity=".7" />
      <path d="M-16 0h30l-5 7h-21z" fill="#fff" />
      <path d="M-16 0h30l-1 2h-28z" fill={stripe} />
      <path d="M-1 -1V-34" stroke="#8a6a4a" stroke-width="1.6" />
      <path d="M0 -33L16 -3H0Z" fill={sail} />
      <path d="M-2 -30L-14 -3H-2Z" fill={sail} opacity=".85" />
      <path d="M0 -33L16 -3" stroke="#dbe6ee" stroke-width="1" />
    </g>
  );
}

export function Yacht() {
  return (
    <g>
      <path d="M-40 8q10 -3 20 0M22 10q10 -3 20 0" stroke="#fff" stroke-width="1.8" fill="none" opacity=".75" />
      <ellipse cx={4} cy={6} rx={36} ry={4} fill="rgba(10,50,110,.25)" />
      <path d="M-34 -6H30Q38 -6 40 -2L32 6H-30Z" fill="#fff" />
      <path d="M-33 -1H37" stroke="#1d4f8c" stroke-width="2" />
      <path d="M-20 -6V-14H14L22 -6Z" fill="#f4f6f7" />
      <path d="M-16 -8V-12H12L16 -8Z" fill="#2d4d66" />
      <path d="M-10 -14V-19H6L10 -14Z" fill="#e6eaec" />
      <path d="M-7 -15.5h12" stroke="#2d4d66" stroke-width="2" />
      <path d="M0 -19V-26" stroke="#b8c2c8" stroke-width="1.2" />
    </g>
  );
}
