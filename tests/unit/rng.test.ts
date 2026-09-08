import { describe, expect, it } from 'vitest';
import { rngInt, rngNext, rngRange, seedRng } from '../../src/sim/core/rng';

describe('rng', () => {
  it('same seed produces identical sequences', () => {
    const a = { rngState: seedRng(42) };
    const b = { rngState: seedRng(42) };
    for (let i = 0; i < 100; i++) {
      expect(rngNext(a)).toBe(rngNext(b));
    }
  });

  it('different seeds diverge', () => {
    const a = { rngState: seedRng(1) };
    const b = { rngState: seedRng(2) };
    const seqA = Array.from({ length: 10 }, () => rngNext(a));
    const seqB = Array.from({ length: 10 }, () => rngNext(b));
    expect(seqA).not.toEqual(seqB);
  });

  it('rngNext stays within [0, 1)', () => {
    const s = { rngState: seedRng(7) };
    for (let i = 0; i < 1000; i++) {
      const v = rngNext(s);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('rngInt respects inclusive bounds', () => {
    const s = { rngState: seedRng(9) };
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const v = rngInt(s, 3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
      seen.add(v);
    }
    expect(seen.size).toBe(5);
  });

  it('rngRange respects [min, max)', () => {
    const s = { rngState: seedRng(11) };
    for (let i = 0; i < 1000; i++) {
      const v = rngRange(s, -2.5, 4);
      expect(v).toBeGreaterThanOrEqual(-2.5);
      expect(v).toBeLessThan(4);
    }
  });

  it('seed 0 is still valid (falls back to a nonzero state)', () => {
    const s = { rngState: seedRng(0) };
    expect(rngNext(s)).toBeGreaterThanOrEqual(0);
  });
});
