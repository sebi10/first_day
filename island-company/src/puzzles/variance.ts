// Analyst · Variance find. Budget vs actual for the week; tap the lines that
// drive the miss. Tiers 0–2 print the variance columns; from tier 3 you get
// Budget / Actual / Last week / Volume and do the analysis yourself, like a
// real month-end review: materiality, price vs volume, equal-and-opposite
// reclasses, and tiny lines with scary percentages.
import { rng } from '../sim/rng';
import { C, clamp, settle } from './kit';
import { result, type PuzzleDef, type PuzzleResult } from './types';

export type VLine = {
  name: string;
  group: 'Ops' | 'People' | 'Fixed';
  unit: string;
  budget: number;
  actual: number;
  last: number;
  unitsB: number;
  unitsA: number;
  kind: 'normal' | 'driver' | 'herring' | 'reclass';
};

export type VarianceModel = {
  lines: VLine[];
  drivers: number[]; // indexes
  miss: number; // actual - budget, total (unfavourable > 0)
  showVariance: boolean; // teaching columns (tiers 0-2)
};

const CATALOG: { name: string; group: VLine['group']; unit: string; lo: number; hi: number }[] = [
  { name: 'Aviation fuel', group: 'Ops', unit: 'gal', lo: 900, hi: 1800 },
  { name: 'Parts and kits', group: 'Ops', unit: 'kits', lo: 500, hi: 1300 },
  { name: 'Crew payroll', group: 'People', unit: 'hrs', lo: 1200, hi: 2400 },
  { name: 'Utilities', group: 'Fixed', unit: 'kWh', lo: 350, hi: 800 },
  { name: 'Insurance', group: 'Fixed', unit: 'policy', lo: 200, hi: 500 },
  { name: 'Cleaning turns', group: 'People', unit: 'turns', lo: 250, hi: 600 },
  { name: 'Card fees', group: 'Ops', unit: 'bookings', lo: 90, hi: 220 },
  { name: 'Maintenance contracts', group: 'Fixed', unit: 'visits', lo: 300, hi: 700 },
  { name: 'Laundry', group: 'Ops', unit: 'loads', lo: 120, hi: 260 },
  { name: 'Marketing', group: 'Fixed', unit: 'ads', lo: 150, hi: 400 },
  { name: 'Water', group: 'Ops', unit: 'k gal', lo: 60, hi: 140 },
];

const r10 = (v: number) => Math.round(v / 10) * 10;

export function generateVariance(seed: number, tier: number, _tools: string[] = [], leak = 500): VarianceModel {
  const r = rng(seed);
  const rows = tier <= 0 ? 4 : tier <= 3 ? 6 : tier === 4 ? 7 : 8;
  const pool = r.shuffle([...CATALOG]).slice(0, rows);
  const lines: VLine[] = pool.map((c) => {
    const budget = r10(r.range(c.lo, c.hi));
    const unitPrice = r.range(2, 12);
    const unitsB = Math.max(1, Math.round(budget / unitPrice));
    const noise = r.range(-0.02, 0.025);
    const actual = r10(budget * (1 + noise));
    return {
      name: c.name,
      group: c.group,
      unit: c.unit,
      budget,
      actual,
      last: r10(budget * r.range(0.93, 1.05)),
      unitsB,
      unitsA: Math.max(1, Math.round(unitsB * (actual / budget) * r.range(0.99, 1.01))),
      kind: 'normal',
    };
  });

  // drivers: 2-3 material lines carry the leak (big cost lines drive real misses)
  const k = tier <= 1 ? 2 : r.chance(0.5) ? 2 : 3;
  const bySize = lines.map((_, i) => i).sort((a, b) => lines[b].budget - lines[a].budget);
  const material = r.shuffle(bySize.slice(0, Math.max(k, Math.ceil(lines.length * 0.6))));
  const drivers = material.slice(0, k);
  const cand = [...drivers, ...r.shuffle(bySize.filter((i) => !drivers.includes(i)))];
  const weights = drivers.map(() => r.range(0.8, 1.4));
  const wsum = weights.reduce((a, b) => a + b, 0);
  drivers.forEach((i, j) => {
    const L = lines[i];
    const over = r10((leak * weights[j]) / wsum);
    L.actual = L.budget + over;
    L.kind = 'driver';
    // volume vs price: half the drivers are volume (more units), half price (same units)
    const volume = r.chance(0.5);
    L.unitsA = volume ? Math.round(L.unitsB * (L.actual / L.budget)) : L.unitsB;
    L.last = r10(L.budget * r.range(0.95, 1.03));
  });

  let rest = cand.slice(k).sort((a, b) => lines[a].budget - lines[b].budget);
  // red herring (tier >= 2): the smallest line gets a scary percentage, immaterial dollars
  if (tier >= 2 && rest.length) {
    const i = rest[0];
    rest = rest.slice(1);
    const L = lines[i];
    L.budget = r10(r.range(20, 45));
    L.actual = L.budget + Math.min(r10(leak * 0.1), r10(L.budget * r.range(1.3, 2)));
    L.last = r10(L.budget * r.range(0.9, 1.1));
    L.unitsB = Math.max(1, Math.round(L.budget / 5));
    L.unitsA = Math.round(L.unitsB * (L.actual / L.budget));
    L.kind = 'herring';
  }
  // reclass (tier >= 4): equal and opposite, a mis-posting, not a driver of the net miss
  if (tier >= 4 && rest.length >= 2) {
    const [a, b] = rest.slice(-2);
    const x = r10(leak * r.range(0.55, 0.8));
    lines[a].actual = lines[a].budget + x;
    lines[b].actual = lines[b].budget - x;
    lines[a].unitsA = lines[a].unitsB;
    lines[b].unitsA = lines[b].unitsB;
    lines[a].kind = 'reclass';
    lines[b].kind = 'reclass';
  }

  // shuffle display order, remap driver indexes
  const order = r.shuffle(lines.map((_, i) => i));
  const shuffled = order.map((i) => lines[i]);
  const drv = shuffled.map((l, i) => (l.kind === 'driver' ? i : -1)).filter((i) => i >= 0);
  const miss = shuffled.reduce((n, l) => n + l.actual - l.budget, 0);
  return { lines: shuffled, drivers: drv, miss, showVariance: tier <= 2 };
}

export function scoreVariance(m: VarianceModel, selected: number[], taps: number) {
  const set = new Set(selected);
  const found = m.drivers.filter((i) => set.has(i)).length;
  const wrong = selected.filter((i) => !m.drivers.includes(i)).length;
  const churn = Math.max(0, taps - (m.drivers.length + 1));
  const score = clamp(found / m.drivers.length - 0.25 * wrong - 0.03 * churn, 0, 1);
  return { score, found, wrong };
}

const usd = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

export const variance: PuzzleDef = {
  id: 'variance',
  role: 'fin',
  title: 'Variance find',
  gesture: 'Tap cells',
  howTo: 'Tap the lines that drive this week’s miss, then submit.',
  term: 'Variance: actual minus budget. Material, unfavourable lines explain the miss.',
  seconds: (tier) => 60 + tier * 10,
  mount(host, p) {
    const m = generateVariance(p.seed, p.tier, p.tools, p.context?.leak ?? 500);
    const grouped = p.tools.includes('driverTree');
    const canSort = p.tools.includes('pivot');
    let sortByActual = false;
    const selected = new Set<number>();
    let taps = 0;
    let finished = false;

    const root = document.createElement('div');
    root.style.cssText = `position:absolute;inset:0;display:flex;flex-direction:column;gap:10px;padding:10px 12px 14px;overflow:auto;font-variant-numeric:tabular-nums;background:linear-gradient(${C.paper},${C.sand})`;
    host.el.appendChild(root);

    const head = document.createElement('div');
    const table = document.createElement('div');
    const foot = document.createElement('div');
    root.append(head, table, foot);

    const tb = m.lines.reduce((n, l) => n + l.budget, 0);
    const ta = m.lines.reduce((n, l) => n + l.actual, 0);
    head.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:8px">
        <div><div style="font-size:12px;font-weight:700;color:${C.inkSoft}">Week budget → actual</div>
        <div style="font-size:20px;font-weight:800">${usd(tb)} → ${usd(ta)}</div></div>
        <div style="text-align:right"><div style="font-size:12px;font-weight:700;color:${C.inkSoft}">Miss</div>
        <div style="font-size:22px;font-weight:900;color:${m.miss > 0 ? C.rust : C.palm}">${m.miss > 0 ? '−' : '+'}${usd(Math.abs(m.miss))}</div></div>
      </div>
      <div style="font-size:13px;color:${C.inkSoft};margin-top:4px">${
        m.showVariance ? 'Unfavourable variances are rust. Pick the lines that explain the miss.' : 'No variance columns at this level: read budget, actual, last week and volume.'
      }</div>`;

    const cols = m.showVariance ? ['Budget', 'Actual', 'Var $', 'Var %'] : ['Budget', 'Actual', 'Last wk', 'Vol a/b'];

    const render = () => {
      table.innerHTML = '';
      const hdr = document.createElement('div');
      hdr.style.cssText = `display:grid;grid-template-columns:minmax(0,1.5fr) repeat(4,minmax(0,1fr));gap:4px;font-size:11px;font-weight:800;color:${C.inkSoft};padding:0 8px`;
      hdr.innerHTML = `<span>Line</span>${cols.map((c) => `<span style="text-align:right">${c}</span>`).join('')}`;
      table.appendChild(hdr);
      let idx = m.lines.map((_, i) => i);
      if (sortByActual) idx.sort((a, b) => m.lines[b].actual - m.lines[a].actual);
      const groups: (VLine['group'] | null)[] = grouped ? ['Ops', 'People', 'Fixed'] : [null];
      for (const g of groups) {
        const ids = g ? idx.filter((i) => m.lines[i].group === g) : idx;
        if (g && ids.length) {
          const sb = ids.reduce((n, i) => n + m.lines[i].budget, 0);
          const sa = ids.reduce((n, i) => n + m.lines[i].actual, 0);
          const gh = document.createElement('div');
          gh.style.cssText = `display:flex;justify-content:space-between;font-size:12px;font-weight:800;margin:8px 8px 2px;color:${C.ink}`;
          gh.innerHTML = `<span>${g}</span><span>${usd(sb)} → ${usd(sa)}</span>`;
          table.appendChild(gh);
        }
        for (const i of ids) table.appendChild(row(i));
      }
      const n = selected.size;
      host.status(`Miss ${usd(m.miss)} · ${n} line${n === 1 ? '' : 's'} selected`);
      submit.disabled = n === 0 || finished;
      submit.style.opacity = submit.disabled ? '0.45' : '1';
    };

    const row = (i: number) => {
      const L = m.lines[i];
      const v = L.actual - L.budget;
      const pct = L.budget ? (v / L.budget) * 100 : 0;
      const on = selected.has(i);
      const el = document.createElement('button');
      el.setAttribute('aria-pressed', String(on));
      el.style.cssText = `appearance:none;border:0;text-align:left;width:100%;display:grid;grid-template-columns:minmax(0,1.5fr) repeat(4,minmax(0,1fr));gap:4px;align-items:center;min-height:48px;padding:6px 8px;border-radius:12px;font:inherit;font-size:13px;color:${C.ink};background:${on ? 'rgba(46,124,147,.16)' : C.paper};box-shadow:${on ? `inset 0 0 0 2px ${C.sea}` : '0 1px 0 rgba(31,42,48,.06)'};transition:transform .08s`;
      const cells = m.showVariance
        ? [usd(L.budget), usd(L.actual), `<b style="color:${v > 0 ? C.rust : C.palm}">${v > 0 ? '+' : ''}${usd(v)}</b>`, `<span style="color:${v > 0 ? C.rust : C.inkSoft}">${pct > 0 ? '+' : ''}${pct.toFixed(0)}%</span>`]
        : [usd(L.budget), `<b>${usd(L.actual)}</b>`, usd(L.last), `${L.unitsA}/${L.unitsB}`];
      el.innerHTML = `<span style="font-weight:700;line-height:1.15">${on ? '✓ ' : ''}${L.name}<br><span style="font-size:10px;color:${C.inkSoft};font-weight:600">${L.unit}</span></span>${cells
        .map((c) => `<span style="text-align:right">${c}</span>`)
        .join('')}`;
      el.onclick = () => {
        if (finished || host.paused()) return;
        taps++;
        if (selected.has(i)) selected.delete(i);
        else selected.add(i);
        host.fx.snap();
        el.style.transform = 'scale(0.98)';
        setTimeout(() => render(), 60);
      };
      return el;
    };

    foot.style.cssText = 'display:flex;gap:8px;margin-top:auto;padding-top:6px';
    let sortBtn: HTMLButtonElement | null = null;
    if (canSort) {
      sortBtn = document.createElement('button');
      sortBtn.textContent = 'Sort by actual';
      sortBtn.className = 'btn soft small';
      sortBtn.onclick = () => {
        sortByActual = !sortByActual;
        sortBtn!.textContent = sortByActual ? 'Original order' : 'Sort by actual';
        host.fx.tap();
        render();
      };
      foot.appendChild(sortBtn);
    }
    const submit = document.createElement('button');
    submit.className = 'btn block';
    submit.textContent = 'Submit drivers';
    submit.style.flex = '1';
    submit.onclick = () => finish();
    foot.appendChild(submit);

    function summarize() {
      const r = scoreVariance(m, [...selected], taps);
      const parts = [`${r.found}/${m.drivers.length} drivers`];
      if (r.wrong) parts.push(`${r.wrong} wrong`);
      return { r, text: parts.join(', ') };
    }

    function finish() {
      if (finished) return;
      finished = true;
      const { r, text } = summarize();
      const res: PuzzleResult = result(r.score, text, { found: r.found, drivers: m.drivers.length, wrongTaps: r.wrong });
      // reveal: stamp the real drivers
      [...table.querySelectorAll('button')].forEach((b) => ((b as HTMLButtonElement).disabled = true));
      table.querySelectorAll('button').forEach((b, k) => {
        const i = sortByActual ? [...m.lines.keys()].sort((a, c) => m.lines[c].actual - m.lines[a].actual)[k] : k;
        if (grouped) return;
        if (m.drivers.includes(i)) (b as HTMLElement).style.boxShadow = `inset 0 0 0 3px ${C.palm}`;
      });
      if (res.perfect) host.fx.flourish();
      else host.fx.good();
      settle(host, res, res.perfect ? 900 : 400);
    }

    render();
    return {
      timeUp() {
        finished = true;
        const { r, text } = summarize();
        return result(r.score, text, { found: r.found, drivers: m.drivers.length, wrongTaps: r.wrong });
      },
      destroy() {
        root.remove();
      },
    };
  },
};
