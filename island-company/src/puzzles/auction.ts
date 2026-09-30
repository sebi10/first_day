// Analyst · Parts auction. A live ascending (English) auction against two
// mainland buyers. You set a walk-away limit with one thumb and can change
// it as the clock runs. Tiers 0–2 print a fair-value marker; from tier 3 you
// get three comparable sales instead and value the lot yourself.
//
// On a real island the lot is real (docs/JOBFLOW.md 17.3): a broker's
// liquidation of 2–4 lines the island uses, new surplus with traceability
// (context.lot). Its market comes from the lot: fair is the broker's price
// less 15%, the range 0.6–1.3 × fair, the walk-away cap 92% of the lot at
// list (and never below the freeze line: see lotMarket). A win places the lot
// on a broker PO at what was bid. Week 0 and the lab still auction one parts
// kit on today's market.
import { itemById, priceAt } from '../sim/items';
import { rng } from '../sim/rng';
import { C, FONT, backdrop, clamp, fitLabel, label, loop, pointer, roundRect, settle, stage } from './kit';
import { result, type PuzzleContext, type PuzzleDef, type PuzzleResult } from './types';

type Bot = { name: string; value: number; delay: number };
export type Lot = { bots: Bot[]; start: number };
export type AuctionModel = {
  low: number;
  high: number;
  fair: number;
  cap: number;
  step: number;
  tickMs: number;
  lots: Lot[];
  showFair: boolean;
  comps: number[];
  /** the broker's real lot, when the island has one: what a win buys */
  lot?: { lines: { pn: string; nomen: string; qty: number; list: number }[]; list: number };
};

/**
 * The market for a real lot. A market passed for the lot itself (its fair is the
 * lot's) is used as it is. Otherwise the desk passed today's one-kit market with
 * the lot: its cap is min(92% of the kit at list, cash − $2,000), which is under
 * 1.2 × its fair only when the cash side binds (the kit's own side is 1.24 × fair
 * at every tier), so that is when it caps the lot too.
 */
export function lotMarket(lot: NonNullable<PuzzleContext['lot']>, market?: PuzzleContext['market']): { low: number; high: number; fair: number; cap: number } {
  if (market && market.fair === lot.fair) return market;
  const fair = Math.max(20, lot.fair);
  let cap = Math.round(lot.list * 0.92);
  if (market && market.cap < 1.2 * market.fair) cap = Math.min(cap, market.cap);
  const low = Math.round(fair * 0.6);
  const high = Math.round(Math.max(fair * 1.3, cap * 1.08, low + 60));
  return { low, high, fair, cap: Math.max(0, cap) };
}

export function generateAuction(seed: number, tier: number, _tools: string[] = [], market?: PuzzleContext['market'], lot?: PuzzleContext['lot']): AuctionModel {
  const r = rng(seed);
  const mk = lot ? lotMarket(lot, market) : market;
  const low = mk?.low ?? 220;
  const high = mk?.high ?? 460;
  const fair = mk?.fair ?? Math.round((low + high) / 2 - 10);
  const cap = mk?.cap ?? Math.round(fair * 1.15);
  const spread = (high - low) * clamp(0.38 - 0.05 * tier, 0.12, 0.38); // thinner at higher tiers
  const names = ['Harbor Hops', 'Mainland Marine', 'Gull Air', 'Cay Freight'];
  // a real lot is one PO: one lot at every tier
  const lotCount = tier >= 5 && !lot ? 2 : 1;
  const lots: Lot[] = [];
  for (let k = 0; k < lotCount; k++) {
    const bots: Bot[] = r
      .shuffle([...names])
      .slice(0, 2)
      .map((name) => ({
        name,
        // private valuations cluster around fair value; sometimes one runs hot
        value: Math.round(clamp(fair + r.range(-1, 1) * spread + (r.chance(0.25) ? spread * 0.6 : 0), low + 20, high)),
        delay: r.range(0.15, 0.5),
      }));
    // opening bid: a third of the way from the floor to fair value
    lots.push({ bots, start: Math.round((low + (fair - low) * r.range(0.25, 0.4)) / 10) * 10 });
  }
  const comps = [0, 1, 2].map(() => Math.round(fair * r.range(0.92, 1.08)));
  return {
    low,
    high,
    fair,
    cap,
    // a small lot bids in $5 steps, so it isn't over in a few ticks
    step: lot && high - low < 200 ? 5 : 10,
    tickMs: Math.round(clamp(950 - tier * 120, 330, 950)),
    lots,
    showFair: tier <= 2,
    comps,
    // each line at list from the catalog's unit price (the lot's own total is priced the same way)
    ...(lot ? { lot: { lines: lot.lines.map((l) => ({ ...l, list: lineList(l) })), list: lot.list } } : {}),
  };
}

function lineList(l: { pn: string; qty: number; list: number }): number {
  const x = itemById(l.pn);
  return x ? Math.round(priceAt(x) * l.qty) : l.list;
}

/** a lot line on the card, in the packs it comes in: "AN900-10 gasket · a bag of 25", "3 × KR20S single receptacle 20 A" */
export function lotLine(l: { pn: string; nomen: string; qty: number }): string {
  const first = l.nomen.split(',')[0];
  const name = `${l.pn} ${/^[A-Z][a-z]/.test(first) ? first.charAt(0).toLowerCase() + first.slice(1) : first}`;
  const x = itemById(l.pn);
  if (!x || x.cut || x.pack <= 1 || l.qty % x.pack) return `${l.qty} × ${name}`;
  const packs = l.qty / x.pack;
  const unit = x.unit === 'ea' ? '' : ` ${x.unit === 'use' ? 'uses' : x.unit}`;
  return `${name} · ${packs === 1 ? 'a' : packs} ${x.packName ?? 'pack'}${packs > 1 ? 's' : ''} of ${x.pack}${unit}`;
}

/** Score one lot: won at `price`, or lost when a rival cleared at `clear`. */
export function lotScore(m: Pick<AuctionModel, 'low' | 'fair' | 'cap'>, won: boolean, price: number) {
  const { low, fair, cap } = m;
  if (won) {
    if (price <= fair) return clamp(0.86 + 0.14 * ((fair - price) / Math.max(1, 0.25 * (fair - low))), 0, 1);
    if (price <= cap) return 0.75 - 0.35 * ((price - fair) / Math.max(1, cap - fair));
    return 0.15;
  }
  // walking away is a valid win when the kit cleared above fair value
  return price > fair ? 1 : 0.45;
}

export function scoreAuction(m: AuctionModel, outcomes: { won: boolean; price: number }[]) {
  if (!outcomes.length) return 0;
  return outcomes.reduce((n, o) => n + lotScore(m, o.won, o.price), 0) / outcomes.length;
}

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

export const auction: PuzzleDef = {
  id: 'auction',
  role: 'fin',
  title: 'Parts auction',
  gesture: 'Timed slider',
  howTo: 'Set your walk-away limit. Win under value, or walk away.',
  term: 'English auction: price climbs until one bidder is left. Winner’s curse: overpaying to win.',
  seconds: (tier) => (tier >= 5 ? 90 : 60),
  mount(host, p) {
    const m = generateAuction(p.seed, p.tier, p.tools, p.context?.market, p.context?.lot);
    const scanner = p.tools.includes('marketScanner');
    const memory = p.tools.includes('bidMemory');
    const st = stage(host.el);
    const { ctx } = st;
    let lotIdx = 0;
    let price = m.lots[0].start;
    let limit = Math.round(m.showFair ? m.fair : (m.low + m.high) / 2);
    let running = false;
    let countdown = 0;
    let tickAcc = 0;
    let youIn = true;
    const inMap = new Map<string, boolean>();
    const hesitate = new Map<string, number>();
    const outcomes: { won: boolean; price: number; who: string }[] = [];
    let finished = false;
    let dragging = false;
    let flash = 0;
    const lastRaise = new Map<string, number>();

    const resetLot = () => {
      const lot = m.lots[lotIdx];
      price = lot.start;
      youIn = true;
      inMap.clear();
      lot.bots.forEach((b) => inMap.set(b.name, true));
      running = false;
      countdown = 0;
      host.status(
        m.lot
          ? `Broker lot · ${m.lot.lines.length} lines, ${usd(m.lot.list)} at list · your cap ${usd(m.cap)}`
          : `Lot ${lotIdx + 1} of ${m.lots.length} · market ${usd(m.low)}–${usd(m.high)} · your cap ${usd(m.cap)}`,
      );
    };
    resetLot();

    // a real lot is listed on a card across the top; the auction works in the space under it
    const lotH = m.lot ? 34 + m.lot.lines.length * 18 : 0;
    const geo = () => {
      const w = st.w;
      const top = lotH;
      const h = st.h - top;
      const y = (f: number) => top + h * f;
      return { w, h: st.h, top, inner: h, y, trackY: y(0.36), x0: 28, x1: w - 28, sliderY: y(0.74), btnY: st.h - 70 };
    };
    const px = (v: number) => {
      const g = geo();
      return g.x0 + ((v - m.low) / (m.high - m.low)) * (g.x1 - g.x0);
    };
    const val = (x: number) => {
      const g = geo();
      return m.low + clamp((x - g.x0) / (g.x1 - g.x0), 0, 1) * (m.high - m.low);
    };

    const endLot = (won: boolean, at: number, who: string) => {
      running = false;
      outcomes.push({ won, price: at, who });
      const sc = lotScore(m, won, at);
      if (won) sc >= 0.86 ? host.fx.good() : host.fx.bad();
      else sc >= 1 ? host.fx.good() : host.fx.tap();
      flash = performance.now();
      if (lotIdx + 1 < m.lots.length) {
        setTimeout(() => {
          lotIdx++;
          resetLot();
        }, 1400);
      } else setTimeout(finish, 1100);
    };

    const step = () => {
      const lot = m.lots[lotIdx];
      const next = price + m.step;
      for (const b of lot.bots) {
        if (!inMap.get(b.name)) continue;
        if (next > b.value) {
          inMap.set(b.name, false);
          host.fx.tick();
        } else {
          lastRaise.set(b.name, b.delay * (next > b.value - 25 ? 3 : 1));
          if (next > b.value - 25) hesitate.set(b.name, performance.now());
        }
      }
      if (youIn && next > limit) youIn = false;
      const rivals = lot.bots.filter((b) => inMap.get(b.name));
      const count = rivals.length + (youIn ? 1 : 0);
      if (count <= 1) {
        if (youIn) return endLot(true, price, 'You');
        if (rivals.length === 1) return endLot(false, Math.max(price, Math.min(next, rivals[0].value)), rivals[0].name);
        // everyone dropped on the same tick: last price stands, rival with highest value takes it
        const top = [...lot.bots].sort((a, b) => b.value - a.value)[0];
        return endLot(false, price, top.name);
      }
      price = next;
      host.fx.tick();
    };

    const offPtr = pointer(st.canvas, {
      down(pt) {
        if (finished || host.paused()) return;
        const g = geo();
        if (Math.abs(pt.y - g.sliderY) < 40) {
          dragging = true;
          limit = Math.round(val(pt.x) / 5) * 5;
          host.fx.tick();
          return;
        }
        if (pt.y > g.btnY - 10 && pt.y < g.btnY + 54) {
          if (!running && countdown === 0 && outcomes.length === lotIdx) {
            countdown = performance.now();
            host.fx.tap();
          } else if (running && youIn) {
            youIn = false; // walk away now
            host.fx.swipe();
          }
        }
      },
      move(pt) {
        if (!dragging || finished) return;
        const before = limit;
        limit = Math.round(val(pt.x) / 5) * 5;
        if (Math.floor(before / 20) !== Math.floor(limit / 20)) host.fx.tick();
      },
      up() {
        dragging = false;
      },
    });

    const stop = loop((_t, dt) => {
      if (!host.paused() && !finished) {
        if (countdown && !running && performance.now() - countdown > 1500) {
          running = true;
          countdown = 0;
        }
        if (running) {
          tickAcc += dt * 1000;
          // once you're out, the rivals finish quickly
          if (tickAcc >= (youIn ? m.tickMs : m.tickMs / 3)) {
            tickAcc = 0;
            step();
          }
        }
      }
      draw();
    }, { live: true }); // the price ticks on its own: keep full frame rate

    function draw() {
      const g = geo();
      backdrop(ctx, g.w, g.h);
      const lot = m.lots[lotIdx];
      // price
      if (m.lot) drawLot(g);
      label(ctx, running || outcomes.length > lotIdx ? 'Current bid' : 'Opening', g.w / 2, g.y(0.06), { size: 13, color: C.inkSoft });
      label(ctx, usd(price), g.w / 2, g.y(0.13), { size: 44, weight: 900 });
      if (countdown) label(ctx, `Starting in ${Math.ceil((1500 - (performance.now() - countdown)) / 500)}…`, g.w / 2, g.y(0.19), { size: 14, color: C.sea, weight: 800 });

      // track
      ctx.lineCap = 'round';
      ctx.lineWidth = 10;
      ctx.strokeStyle = 'rgba(31,42,48,.1)';
      ctx.beginPath();
      ctx.moveTo(g.x0, g.trackY);
      ctx.lineTo(g.x1, g.trackY);
      ctx.stroke();
      ctx.strokeStyle = C.fin;
      ctx.beginPath();
      ctx.moveTo(g.x0, g.trackY);
      ctx.lineTo(px(clamp(price, m.low, m.high)), g.trackY);
      ctx.stroke();
      label(ctx, usd(m.low), g.x0, g.trackY + 20, { size: 11, color: C.inkSoft, align: 'left' });
      label(ctx, usd(m.high), g.x1, g.trackY + 20, { size: 11, color: C.inkSoft, align: 'right' });
      const mark = (v: number, text: string, color: string, up: boolean) => {
        const x = px(v);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, g.trackY - 14);
        ctx.lineTo(x, g.trackY + 14);
        ctx.stroke();
        label(ctx, text, x, g.trackY + (up ? -24 : 34), { size: 11, weight: 800, color });
      };
      if (m.showFair) mark(m.fair, `fair ${usd(m.fair)}`, C.palm, true);
      mark(m.cap, `cap ${usd(m.cap)}`, C.ink, false);
      if (!m.showFair) label(ctx, `Recent sales: ${m.comps.map(usd).join(' · ')}`, g.w / 2, g.trackY - 34, { size: 12, color: C.inkSoft, weight: 700 });

      // bidders
      const rows = [{ name: 'You', in: youIn, tint: C.fin }, ...lot.bots.map((b) => ({ name: b.name, in: !!inMap.get(b.name), tint: C.sandDeep }))];
      rows.forEach((row, i) => {
        const y = g.y(0.47) + i * 44;
        const bw = g.w - 56;
        roundRect(ctx, 28, y, bw, 36, 12);
        ctx.fillStyle = row.in ? C.paper : 'rgba(31,42,48,.06)';
        ctx.fill();
        ctx.fillStyle = row.tint;
        ctx.beginPath();
        ctx.arc(46, y + 18, 7, 0, Math.PI * 2);
        ctx.fill();
        const bot = lot.bots.find((b) => b.name === row.name);
        const hes = bot && hesitate.get(bot.name) && performance.now() - hesitate.get(bot.name)! < 700 && row.in;
        label(ctx, row.name + (hes ? ' …' : ''), 62, y + 18, { size: 14, weight: 800, align: 'left', color: row.in ? C.ink : C.inkSoft });
        let right = row.in ? 'in' : 'out';
        if (bot && scanner) right = `${row.in ? 'in' : 'out'} · appetite ~${usd(Math.round(bot.value / 25) * 25)}±25`;
        if (bot && memory && lastRaise.has(bot.name)) right += ` · ${Math.round(lastRaise.get(bot.name)! * 1000)}ms`;
        label(ctx, right, 28 + bw - 12, y + 18, { size: 12, weight: 700, align: 'right', color: row.in ? C.sea : C.inkSoft });
      });

      // limit slider
      label(ctx, `Your walk-away limit ${usd(limit)}`, g.w / 2, g.sliderY - 28, { size: 14, weight: 800 });
      ctx.lineWidth = 8;
      ctx.strokeStyle = C.sandDeep;
      ctx.beginPath();
      ctx.moveTo(g.x0, g.sliderY);
      ctx.lineTo(g.x1, g.sliderY);
      ctx.stroke();
      if (limit > m.cap) {
        ctx.strokeStyle = C.rust;
        ctx.beginPath();
        ctx.moveTo(px(m.cap), g.sliderY);
        ctx.lineTo(px(limit), g.sliderY);
        ctx.stroke();
      }
      ctx.fillStyle = C.sea;
      ctx.beginPath();
      ctx.arc(px(clamp(limit, m.low, m.high)), g.sliderY, 15, 0, Math.PI * 2);
      ctx.fill();

      // button
      const bw = 220;
      roundRect(ctx, g.w / 2 - bw / 2, g.btnY, bw, 50, 25);
      const ended = outcomes.length > lotIdx;
      ctx.fillStyle = ended ? 'rgba(31,42,48,.15)' : running ? (youIn ? C.ink : 'rgba(31,42,48,.25)') : C.sea;
      ctx.fill();
      label(ctx, ended ? 'Sold' : running ? (youIn ? 'Walk away now' : 'You’re out') : countdown ? 'Get ready…' : 'Start auction', g.w / 2, g.btnY + 25, {
        size: 16,
        weight: 800,
        color: C.white,
      });

      // result flash
      const last = outcomes[lotIdx];
      if (last) {
        const t = clamp((performance.now() - flash) / 400, 0, 1);
        ctx.globalAlpha = t;
        const good = lotScore(m, last.won, last.price) >= 0.86;
        label(ctx, last.won ? `Won at ${usd(last.price)}` : `${last.who} won at ${usd(last.price)}`, g.w / 2, g.y(0.24), {
          size: 18,
          weight: 900,
          color: good ? C.palm : last.won && last.price > m.cap ? C.rust : C.ink,
        });
        ctx.globalAlpha = 1;
      }
    }

    /** the broker's lot: what a win buys, at list */
    function drawLot(g: ReturnType<typeof geo>) {
      const lot = m.lot!;
      const x = 16;
      const w = g.w - 32;
      roundRect(ctx, x, 6, w, lotH - 12, 12);
      ctx.fillStyle = C.paper;
      ctx.fill();
      ctx.strokeStyle = 'rgba(31,42,48,.12)';
      ctx.lineWidth = 1;
      ctx.stroke();
      const total = `${usd(lot.list)} at list`;
      ctx.font = `800 12px ${FONT}`;
      const tw = ctx.measureText(total).width;
      fitLabel(ctx, 'Broker lot · new surplus, with traceability', x + 12, 20, w - 36 - tw, { size: 12, weight: 800, color: C.inkSoft, align: 'left' });
      label(ctx, total, x + w - 12, 20, { size: 12, weight: 800, color: C.ink, align: 'right' });
      lot.lines.forEach((l, i) => {
        const ly = 38 + i * 18;
        fitLabel(ctx, lotLine(l), x + 12, ly, w - 90, { size: 13, weight: 700, align: 'left' });
        label(ctx, usd(l.list), x + w - 12, ly, { size: 12, weight: 700, color: C.inkSoft, align: 'right' });
      });
    }

    function outcomeResult(): PuzzleResult {
      const done = outcomes.map((o) => ({ won: o.won, price: o.price }));
      const sc = scoreAuction(m, done.length ? done : [{ won: false, price: m.low }]);
      const kits = outcomes.filter((o) => o.won).length;
      const spent = outcomes.filter((o) => o.won).reduce((n, o) => n + o.price, 0);
      const what = m.lot ? `the lot (${usd(m.lot.list)} at list)` : '';
      const summary = outcomes.length
        ? outcomes.map((o) => (o.won ? `Won ${what ? `${what} ` : ''}at ${usd(o.price)}` : `Walked away (${o.who} paid ${usd(o.price)})`)).join(' · ') + ` · cap ${usd(m.cap)}`
        : 'No bids placed';
      return result(outcomes.length ? sc : 0.3, summary, { kits, spent });
    }

    function finish() {
      if (finished) return;
      finished = true;
      const res = outcomeResult();
      if (res.perfect) host.fx.flourish();
      settle(host, res, res.perfect ? 800 : 300);
    }

    return {
      timeUp() {
        finished = true;
        running = false;
        return outcomeResult();
      },
      destroy() {
        stop();
        offPtr();
        st.destroy();
      },
    };
  },
};
