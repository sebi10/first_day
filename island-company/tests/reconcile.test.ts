import { describe, expect, it } from 'vitest';
import {
  applyRec,
  exactMatches,
  generateReconcile,
  movesLeft,
  newRecState,
  recDiff,
  scoreReconcile,
  solveReconcile,
  type RecModel,
  type RecState,
} from '../src/puzzles/reconcile';
import { rng } from '../src/sim/rng';

const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);

function playClean(m: RecModel): RecState {
  const s = newRecState(m);
  for (const a of solveReconcile(m)) expect(applyRec(m, s, a).result).toBe('ok');
  return s;
}

/** A smart outsider: exact amounts, shared words, subset sums, then coin-flips what is left. */
function outsider(m: RecModel, coin: number): number {
  const s = newRecState(m);
  const r = rng(coin);
  const words = (t: string) => t.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4);
  const bank = m.lines.filter((l) => l.side === 'bank');
  const book = m.lines.filter((l) => l.side === 'book');
  const open = (id: number) => !s.cleared[id];
  for (const b of bank)
    for (const k of book)
      if (open(b.id) && open(k.id) && Math.abs(b.amount - k.amount) < 0.005) applyRec(m, s, { t: 'pair', a: b.id, b: k.id });
  for (const b of bank)
    for (const k of book)
      if (open(b.id) && open(k.id) && words(b.text).some((w) => words(k.text).includes(w)))
        applyRec(m, s, { t: 'pair', a: b.id, b: k.id });
  for (const b of bank) {
    const ks = book.filter((k) => open(k.id));
    for (let i = 0; i < ks.length && open(b.id); i++)
      for (let j = i + 1; j < ks.length && open(b.id); j++)
        for (let k = j + 1; k < ks.length && open(b.id); k++)
          if (Math.abs(ks[i].amount + ks[j].amount + ks[k].amount - b.amount) < 0.005)
            for (const id of [ks[i].id, ks[j].id, ks[k].id]) applyRec(m, s, { t: 'pair', a: b.id, b: id });
  }
  for (const l of m.lines)
    if (open(l.id) && movesLeft(m, s)) applyRec(m, s, { t: 'bin', line: l.id, bin: r.chance(0.5) ? 'timing' : 'adjust' });
  return scoreReconcile(m, s);
}

describe('bank reconciliation model', () => {
  it('is deterministic per seed', () => {
    expect(generateReconcile(42, 3)).toEqual(generateReconcile(42, 3));
    expect(generateReconcile(42, 5, ['autoMatch'], { leak: 800 })).toEqual(generateReconcile(42, 5, ['autoMatch'], { leak: 800 }));
    expect(generateReconcile(42, 3)).not.toEqual(generateReconcile(43, 3));
  });

  it('a clean run reconciles to $0.00 and scores perfect on every tier', () => {
    for (let t = 0; t <= 5; t++)
      for (const seed of SEEDS) {
        const m = generateReconcile(seed, t);
        const s = playClean(m);
        expect(recDiff(m, s)).toBeCloseTo(0, 2);
        expect(s.itemDone.every(Boolean)).toBe(true);
        expect(movesLeft(m, s)).toBe(false);
        expect(scoreReconcile(m, s)).toBeGreaterThanOrEqual(0.95);
      }
  });

  it('the money the rec explains is about context.leak (default 500)', () => {
    for (let t = 0; t <= 5; t++) {
      for (const seed of SEEDS.slice(0, 10)) {
        expect(generateReconcile(seed, t).money / 500).toBeGreaterThan(0.85);
        expect(generateReconcile(seed, t).money / 500).toBeLessThan(1.15);
        expect(generateReconcile(seed, t, [], { leak: 1200 }).money / 1200).toBeGreaterThan(0.85);
      }
    }
  });

  it('gets bigger and nastier with tier', () => {
    const lines = [0, 1, 2, 3, 4, 5].map((t) => generateReconcile(7, t).lines.length);
    for (let t = 1; t < lines.length; t++) expect(lines[t]).toBeGreaterThanOrEqual(lines[t - 1]);
    expect(lines[1]).toBe(6);
    expect(lines[5]).toBeGreaterThanOrEqual(14);
    const kinds = (t: number) => new Set(generateReconcile(7, t).items.map((i) => i.kind));
    expect(kinds(1).has('transpose')).toBe(false);
    expect(kinds(2).has('transpose')).toBe(true);
    expect(kinds(3).has('split')).toBe(true);
    expect(kinds(4).has('dupe')).toBe(true);
    expect(kinds(5).has('net') && kinds(5).has('fx')).toBe(true);
  });

  it('a transposition leaves a difference divisible by 9', () => {
    for (const seed of SEEDS) {
      const m = generateReconcile(seed, 3);
      const it = m.items.find((i) => i.kind === 'transpose')!;
      const d = Math.round(Math.abs(m.lines[it.bank[0]].amount - m.lines[it.book[0]].amount) * 100);
      expect(d).toBeGreaterThan(0);
      expect(d % 900).toBe(0);
    }
  });

  it('tier 4+ plants an exact-amount cheque that is not the ACH debit', () => {
    for (const seed of SEEDS) {
      const m = generateReconcile(seed, 4);
      const tr = m.items.find((i) => i.kind === 'transpose')!;
      const ach = m.lines[tr.bank[0]];
      const chq = m.lines[m.items.find((i) => i.kind === 'outstanding')!.book[0]];
      expect(chq.amount).toBeCloseTo(ach.amount, 2);
      expect(chq.day).toBeGreaterThan(ach.day);
      const s = newRecState(m);
      expect(applyRec(m, s, { t: 'pair', a: ach.id, b: chq.id }).result).toBe('wrong');
    }
  });

  it('bad play scores low; wrong pairs bounce, misfiles commit from tier 3', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      // teaching tier: a misfile bounces back so it can be retried
      const m1 = generateReconcile(seed, 1);
      const s1 = newRecState(m1);
      const chq = m1.lines[m1.items.find((i) => i.kind === 'outstanding')!.book[0]];
      const bounce = applyRec(m1, s1, { t: 'bin', line: chq.id, bin: 'adjust' });
      expect(bounce.result).toBe('wrong');
      expect(s1.cleared[chq.id]).toBe(false);
      expect(applyRec(m1, s1, { t: 'bin', line: chq.id, bin: 'timing' }).result).toBe('ok');
      // dumping every line into Adjust
      for (const t of [1, 3, 5]) {
        const m = generateReconcile(seed, t);
        const s = newRecState(m);
        for (const l of m.lines) applyRec(m, s, { t: 'bin', line: l.id, bin: 'adjust' });
        expect(scoreReconcile(m, s)).toBeLessThan(0.3);
      }
      const m3 = generateReconcile(seed, 3);
      const s3 = newRecState(m3);
      const fee = m3.lines[m3.items.find((i) => i.kind === 'fee')!.bank[0]];
      const out = applyRec(m3, s3, { t: 'bin', line: fee.id, bin: 'timing' });
      expect(out.result).toBe('wrong');
      expect(s3.cleared[fee.id] && s3.botched[fee.id]).toBe(true);
      expect(applyRec(m3, s3, { t: 'bin', line: fee.id, bin: 'adjust' }).result).toBe('ignored');
    }
  });

  it('from tier 3 an outsider mostly guesses and fails; an analyst with a slip passes', () => {
    for (let t = 3; t <= 5; t++) {
      const out = SEEDS.map((seed) => outsider(generateReconcile(seed, t), seed * 7 + 1));
      expect(out.reduce((a, b) => a + b, 0) / out.length).toBeLessThan(0.6);
      for (const seed of SEEDS.slice(0, 10)) {
        const m = generateReconcile(seed, t);
        const s = newRecState(m);
        const b = m.lines.find((l) => l.side === 'bank')!;
        const k = m.lines.find((l) => l.side === 'book' && l.item !== b.item)!;
        applyRec(m, s, { t: 'pair', a: b.id, b: k.id });
        for (const a of solveReconcile(m)) applyRec(m, s, a);
        expect(scoreReconcile(m, s)).toBeGreaterThanOrEqual(0.8);
      }
    }
  });

  it('at tier 3+ the model exposes no answer-revealing hints', () => {
    for (let t = 3; t <= 5; t++)
      for (const seed of SEEDS.slice(0, 10)) {
        const m = generateReconcile(seed, t);
        expect(m.teach).toBe(false);
        expect(m.nineHint).toBe(false);
        expect(m.suggest).toEqual([]);
        expect(m.strict).toBe(true);
        // statements speak bank: no bank descriptor simply repeats the book's wording
        for (const b of m.lines.filter((l) => l.side === 'bank'))
          for (const k of m.lines.filter((l) => l.side === 'book')) expect(b.text).not.toBe(k.text);
      }
    expect(generateReconcile(1, 2).teach).toBe(true);
  });

  it('autoMatch only suggests pairs that are really the same transaction', () => {
    for (let t = 0; t <= 5; t++)
      for (const seed of SEEDS) {
        const m = generateReconcile(seed, t, ['autoMatch']);
        expect(m.suggest).toEqual(exactMatches(m));
        for (const [a, b] of m.suggest) expect(m.lines[a].item).toBe(m.lines[b].item);
      }
  });

  it('timeUp mid-rec gives partial credit', () => {
    const m = generateReconcile(3, 5);
    const s = newRecState(m);
    const acts = solveReconcile(m);
    for (const a of acts.slice(0, Math.ceil(acts.length / 2))) applyRec(m, s, a);
    const sc = scoreReconcile(m, s);
    expect(sc).toBeGreaterThan(0.2);
    expect(sc).toBeLessThan(0.95);
  });
});
