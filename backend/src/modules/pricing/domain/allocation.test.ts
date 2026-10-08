import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { allocate } from './allocation';
import { describeSelector, matchesSelector } from './selector';

describe('allocate (largest remainder)', () => {
  it('splits proportionally and hands leftover paise to the largest remainders', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(10, [3, 0, 7])).toEqual([3, 0, 7]);
    expect(allocate(0, [5, 5])).toEqual([0, 0]);
  });

  it('always sums exactly and never exceeds a weight', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 5_000_000 }), { minLength: 1, maxLength: 12 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (weights, ratio) => {
          const sum = weights.reduce((s, w) => s + w, 0);
          fc.pre(sum > 0);
          const total = Math.floor(sum * ratio);
          const parts = allocate(total, weights);
          expect(parts.reduce((s, p) => s + p, 0)).toBe(total);
          parts.forEach((p, i) => {
            expect(Number.isInteger(p)).toBe(true);
            expect(p).toBeGreaterThanOrEqual(0);
            expect(p).toBeLessThanOrEqual(weights[i]);
          });
        },
      ),
    );
  });

  it('rejects impossible allocations', () => {
    expect(() => allocate(5, [0, 0])).toThrow(RangeError);
    expect(() => allocate(-1, [1])).toThrow(RangeError);
  });
});

describe('selectors', () => {
  const tee = { productId: 'p1', slug: 'oxford-cotton-shirt', category: 'Men' };

  it('matches by product id, slug or category, and treats a missing selector as the whole cart', () => {
    expect(matchesSelector(undefined, tee)).toBe(true);
    expect(matchesSelector({ productIds: ['p1'] }, tee)).toBe(true);
    expect(matchesSelector({ slugs: ['oxford-cotton-shirt'] }, tee)).toBe(true);
    expect(matchesSelector({ categories: ['Women'] }, tee)).toBe(false);
  });

  it('describes selectors for humans', () => {
    expect(describeSelector({ slugs: ['oxford-cotton-shirt'], categories: ['Accessories'] })).toBe(
      'Oxford Cotton Shirt or Accessories items',
    );
    expect(describeSelector(undefined)).toBe('any item');
  });
});
