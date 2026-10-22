import { describe, expect, it } from 'vitest';
import { mineAssociations } from './association';

const loose = { minPairCount: 1, minConfidence: 0, minLift: 0, maxPerItem: 10 };

describe('mineAssociations', () => {
  it('computes support, confidence and lift for co-purchased pairs', () => {
    const baskets = [['shirt', 'jeans'], ['shirt', 'jeans'], ['shirt', 'belt'], ['jeans'], ['belt', 'socks']];
    const rules = mineAssociations(baskets, loose);
    const shirtJeans = rules.get('shirt')!.find(r => r.productId === 'jeans')!;
    expect(shirtJeans.pairCount).toBe(2);
    expect(shirtJeans.support).toBeCloseTo(2 / 5);
    expect(shirtJeans.confidence).toBeCloseTo(2 / 3);
    expect(shirtJeans.lift).toBeCloseTo(2 / 3 / (3 / 5));
    const jeansShirt = rules.get('jeans')!.find(r => r.productId === 'shirt')!;
    expect(jeansShirt.confidence).toBeCloseTo(2 / 3);
  });

  it('ranks by lift so niche-but-strong pairings beat popular ones', () => {
    const baskets = [
      ...Array.from({ length: 6 }, () => ['tee', 'bestseller']),
      ...Array.from({ length: 10 }, () => ['bestseller']),
      ['tee', 'scarf'],
      ['tee', 'scarf'],
      ['scarf', 'other'],
    ];
    const ranked = mineAssociations(baskets, loose)
      .get('tee')!
      .map(r => r.productId);
    expect(ranked[0]).toBe('scarf');
    expect(ranked).toContain('bestseller');
  });

  it('applies count, confidence and lift thresholds and caps per item', () => {
    const baskets = [['a', 'b'], ['a', 'b'], ['a', 'c'], ['b'], ['c'], ['d', 'e']];
    const rules = mineAssociations(baskets, { minPairCount: 2, minConfidence: 0.5, minLift: 1, maxPerItem: 1 });
    expect(rules.get('a')).toEqual([expect.objectContaining({ productId: 'b', pairCount: 2 })]);
    expect(rules.has('c')).toBe(false);
    expect(rules.has('d')).toBe(false);
  });

  it('ignores duplicate lines and empty baskets', () => {
    const rules = mineAssociations([['a', 'a', 'b'], [], ['a', 'b']], loose);
    expect(rules.get('a')![0]).toMatchObject({ productId: 'b', pairCount: 2, support: 1, confidence: 1, lift: 1 });
  });
});
