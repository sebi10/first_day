import { describe, expect, it } from 'vitest';
import {
  ROW_FREIGHT,
  ROW_NUM,
  bandMax,
  detectIssue,
  generateInvoice,
  judgeInvoice,
  lineInTolerance,
  playInvoice,
  scoreInvoice,
  solveInvoice,
  type InvDecision,
} from '../src/puzzles/invoice';

const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);

describe('three-way match model', () => {
  it('is deterministic per seed', () => {
    expect(generateInvoice(42, 3)).toEqual(generateInvoice(42, 3));
    expect(generateInvoice(42, 5, ['poLookup'], { leak: 900 })).toEqual(generateInvoice(42, 5, ['poLookup'], { leak: 900 }));
    expect(generateInvoice(42, 3)).not.toEqual(generateInvoice(43, 3));
  });

  it('a clean run (right holds, right reasons, discounts cash allows) is perfect on every tier', () => {
    for (let t = 0; t <= 5; t++)
      for (const seed of SEEDS) {
        const m = generateInvoice(seed, t);
        const p = playInvoice(m, solveInvoice(m));
        expect(p.score).toBeGreaterThanOrEqual(0.95);
        expect(p.found).toBe(m.cards.length);
        expect(p.wrong).toBe(0);
      }
  });

  it('every card carries exactly the problem it was dealt (an auditor would find the same)', () => {
    for (let t = 0; t <= 5; t++)
      for (const seed of SEEDS) {
        const m = generateInvoice(seed, t);
        for (const c of m.cards) expect(detectIssue(m, c)).toBe(c.issue?.kind ?? null);
      }
  });

  it('scales from 3 invoices to 8, with subtler problems', () => {
    const counts = [0, 1, 2, 3, 4, 5].map((t) => generateInvoice(5, t).cards.length);
    expect(counts[1]).toBe(3);
    expect(counts[5]).toBe(8);
    for (let t = 1; t < counts.length; t++) expect(counts[t]).toBeGreaterThanOrEqual(counts[t - 1]);
    for (const seed of SEEDS) {
      const m5 = generateInvoice(seed, 5);
      const dupe = m5.cards.find((c) => c.issue?.kind === 'dupe')!;
      expect(dupe.number).not.toBe(dupe.last.number); // resent with a "fixed" number
      expect(dupe.last.po).toBe(dupe.po);
      expect(dupe.last.amount).toBeCloseTo(dupe.total, 2);
      expect(m5.cards.some((c) => c.scenario === 'discountLate')).toBe(true);
    }
  });

  it('price tolerance is ≤2% of the line or ≤$10, whichever is more', () => {
    const tol = { tolPct: 0.02, tolAbs: 10 };
    expect(lineInTolerance(tol, { item: 'x', poQty: 4, poPrice: 20, rcvd: 4, qty: 4, price: 22.5 })).toBe(true); // +$10
    expect(lineInTolerance(tol, { item: 'x', poQty: 4, poPrice: 20, rcvd: 4, qty: 4, price: 22.51 })).toBe(false);
    expect(lineInTolerance(tol, { item: 'x', poQty: 10, poPrice: 100, rcvd: 10, qty: 10, price: 102 })).toBe(true); // 2%
    expect(bandMax(tol, { item: 'x', poQty: 4, poPrice: 20, rcvd: 4, qty: 4, price: 20 })).toBeCloseTo(22.5, 2);
    for (const seed of SEEDS) {
      const m = generateInvoice(seed, 5);
      for (const c of m.cards) {
        if (c.scenario === 'tolerance') expect(c.lines.every((l) => lineInTolerance(m, l))).toBe(true);
        if (c.issue?.kind === 'price') expect(c.lines.some((l) => !lineInTolerance(m, l))).toBe(true);
      }
    }
  });

  it('money at stake is about context.leak (default 500)', () => {
    for (let t = 1; t <= 5; t++) {
      const r = SEEDS.map((seed) => generateInvoice(seed, t).money / 500).sort((a, b) => a - b);
      expect(r[Math.floor(r.length / 2)]).toBeGreaterThan(0.9);
      expect(r[Math.floor(r.length / 2)]).toBeLessThan(1.1);
    }
  });

  it('2/10 net 30: take it inside the window when cash allows, never otherwise', () => {
    for (const seed of SEEDS) {
      const m4 = generateInvoice(seed, 4);
      const tight = m4.cards.find((c) => c.scenario === 'discountCash')!;
      const i = m4.cards.indexOf(tight);
      const ds: InvDecision[] = solveInvoice(m4);
      expect(ds[i].action).toBe('pay');
      ds[i] = { action: 'early' };
      expect(playInvoice(m4, ds).verdicts[i]!.wrong).toBe(true); // would dip below the floor
      const m5 = generateInvoice(seed, 5);
      const late = m5.cards.find((c) => c.scenario === 'discountLate')!;
      expect(judgeInvoice(m5, late, { action: 'early' }, m5.cash).wrong).toBe(true);
      const ok = m5.cards.find((c) => c.scenario === 'discount')!;
      const missed = judgeInvoice(m5, ok, { action: 'pay' }, m5.cash);
      expect(missed.wrong).toBe(false);
      expect(missed.credit).toBeLessThan(1);
    }
  });

  it('bad play scores low: pay everything, hold everything, or hold with the wrong reason', () => {
    for (let t = 1; t <= 5; t++)
      for (const seed of SEEDS) {
        const m = generateInvoice(seed, t);
        expect(scoreInvoice(m, m.cards.map(() => ({ action: 'pay' })))).toBeLessThan(0.6);
        expect(scoreInvoice(m, m.cards.map(() => ({ action: 'hold', row: 0 })))).toBeLessThan(0.6);
        const wrongReason = solveInvoice(m).map((d) => (d.action === 'hold' ? { action: 'hold' as const, row: d.row === ROW_NUM ? 0 : ROW_NUM } : d));
        expect(scoreInvoice(m, wrongReason)).toBeLessThan(0.95);
      }
  });

  it('from tier 3 an outsider eyeballing mismatches fails', () => {
    const outsider = (seed: number, t: number) => {
      const m = generateInvoice(seed, t);
      return scoreInvoice(
        m,
        m.cards.map((c) => {
          const i = c.lines.findIndex((l) => l.rcvd < l.qty || l.qty !== l.poQty || l.price !== l.poPrice);
          if (i >= 0) return { action: 'hold', row: i };
          if (c.freight > 0) return { action: 'hold', row: ROW_FREIGHT };
          return { action: 'pay' };
        }),
      );
    };
    for (let t = 3; t <= 5; t++) for (const seed of SEEDS) expect(outsider(seed, t)).toBeLessThan(0.6);
  });

  it('at tier 3+ the model exposes no answer-revealing hints', () => {
    for (let t = 3; t <= 5; t++)
      for (const seed of SEEDS.slice(0, 10)) {
        const m = generateInvoice(seed, t);
        expect(m.teach).toBe(false);
        expect(m.band).toBe(false);
        expect(m.showWindow).toBe(false);
        // the PO lookup shows unit prices (a raw lookup) but never the tolerance band
        expect(generateInvoice(seed, t, ['poLookup']).band).toBe(false);
        expect(generateInvoice(seed, t, ['poLookup']).unitPrice).toBe(true);
      }
    expect(generateInvoice(1, 2).band).toBe(true);
  });

  it('timeUp mid-batch gives partial credit', () => {
    const m = generateInvoice(9, 5);
    const ds = solveInvoice(m).slice(0, 4);
    const p = playInvoice(m, ds);
    expect(p.decided).toBe(4);
    expect(p.score).toBeCloseTo(0.5, 5);
  });
});
