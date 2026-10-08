import { describe, expect, it } from 'vitest';
import { ConditionSpecSchema, PricingQuoteRequestSchema, PromotionInputSchema } from './pricing';

const bundle = { type: 'mixAndMatch', selector: { categories: ['Men'] }, quantity: 3, price: 499_900 } as const;

describe('promotion contracts', () => {
  it('accepts nested composite conditions', () => {
    const spec = {
      type: 'all',
      conditions: [
        { type: 'minSubtotal', amount: 100_000 },
        { type: 'not', condition: { type: 'customerSegment', segment: 'guest' } },
        {
          type: 'any',
          conditions: [
            { type: 'paymentMethod', methods: ['upi'] },
            { type: 'dateWindow', daysOfWeek: [5] },
          ],
        },
      ],
    };
    expect(ConditionSpecSchema.parse(spec)).toEqual(spec);
  });

  it('requires a code exactly when activation is code', () => {
    expect(PromotionInputSchema.safeParse({ name: 'Any 3', action: bundle, activation: 'code' }).success).toBe(false);
    expect(PromotionInputSchema.safeParse({ name: 'Any 3', action: bundle, code: 'X3X' }).success).toBe(false);
    const parsed = PromotionInputSchema.parse({ name: 'Welcome', action: bundle, activation: 'code', code: ' welcome10 ' });
    expect(parsed.code).toBe('WELCOME10');
    expect(parsed.status).toBe('draft');
  });

  it('rejects empty selectors and unordered tiers', () => {
    expect(PromotionInputSchema.safeParse({ name: 'Bad', action: { ...bundle, selector: {} } }).success).toBe(false);
    const tiers = [
      { minSubtotal: 200_000, percentOff: 10 },
      { minSubtotal: 100_000, percentOff: 5 },
    ];
    expect(PromotionInputSchema.safeParse({ name: 'Tiers', action: { type: 'tiered', tiers } }).success).toBe(false);
  });

  it('normalises quote request codes', () => {
    const req = PricingQuoteRequestSchema.parse({ items: [{ productId: 'p1', size: 'M', qty: 1 }], codes: [' welcome10'] });
    expect(req.codes).toEqual(['WELCOME10']);
  });
});
