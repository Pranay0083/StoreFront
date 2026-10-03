import type { ConditionSpec } from '@storefront/contracts';
import { describe, expect, it } from 'vitest';
import { buildCondition, subtotalThresholds } from './condition.factory';
import { CartContains, MinSubtotal } from './conditions';
import { context, line } from './test-fixtures';

const shirt = line({ slug: 'oxford-cotton-shirt', qty: 2, unitPrice: 249_900 });
const scarf = line({ slug: 'silk-scarf', category: 'Accessories', unitPrice: 229_900 });
const ctx = context([shirt, scarf]);

describe('leaf conditions', () => {
  it('counts matching quantities for cartContains', () => {
    expect(buildCondition({ type: 'cartContains', selector: { categories: ['Men'] }, minQty: 2 }).evaluate(ctx).ok).toBe(true);
    const result = buildCondition({ type: 'cartContains', selector: { categories: ['Accessories'] }, minQty: 3 }).evaluate(ctx);
    expect(result).toEqual({ ok: false, reason: 'Add 2 more items from Accessories items' });
  });

  it('checks the merchandise subtotal', () => {
    expect(new MinSubtotal(700_000).evaluate(ctx).ok).toBe(true);
    expect(new MinSubtotal(800_000).evaluate(ctx)).toEqual({ ok: false, reason: 'Minimum order of ₹8,000 required' });
  });

  it('distinguishes customer segments', () => {
    const first = context([shirt], { customer: { id: 'u', signedIn: true, isFirstOrder: true } });
    const guest = context([shirt], { customer: { signedIn: false, isFirstOrder: false } });
    const firstOrder = buildCondition({ type: 'customerSegment', segment: 'firstOrder' });
    expect(firstOrder.evaluate(first).ok).toBe(true);
    expect(firstOrder.evaluate(ctx).ok).toBe(false);
    expect(firstOrder.evaluate(guest).ok).toBe(false);
    expect(buildCondition({ type: 'customerSegment', segment: 'guest' }).evaluate(guest).ok).toBe(true);
    expect(buildCondition({ type: 'customerSegment', segment: 'returning' }).evaluate(ctx).ok).toBe(true);
  });

  it('evaluates date windows, weekdays and hours in IST', () => {
    // 2026-10-30T06:30Z is Friday 12:00 IST.
    expect(buildCondition({ type: 'dateWindow', daysOfWeek: [5], hours: { start: 11, end: 13 } }).evaluate(ctx).ok).toBe(true);
    expect(buildCondition({ type: 'dateWindow', daysOfWeek: [6] }).evaluate(ctx).ok).toBe(false);
    expect(buildCondition({ type: 'dateWindow', hours: { start: 13, end: 20 } }).evaluate(ctx).ok).toBe(false);
    expect(buildCondition({ type: 'dateWindow', to: '2026-10-30T06:00:00Z' }).evaluate(ctx).ok).toBe(false);
    expect(buildCondition({ type: 'dateWindow', from: '2026-10-29T00:00:00Z', to: '2026-11-01T00:00:00Z' }).evaluate(ctx).ok).toBe(true);
  });

  it('requires a matching payment method', () => {
    const upiOnly = buildCondition({ type: 'paymentMethod', methods: ['upi'] });
    expect(upiOnly.evaluate(ctx)).toEqual({ ok: false, reason: 'Pay with UPI to use this offer' });
    expect(upiOnly.evaluate({ ...ctx, paymentMethod: 'upi' }).ok).toBe(true);
  });
});

describe('composite conditions', () => {
  it('combines with all / any / not and reports the first failing reason', () => {
    const spec: ConditionSpec = {
      type: 'all',
      conditions: [
        { type: 'minSubtotal', amount: 100_000 },
        { type: 'not', condition: { type: 'customerSegment', segment: 'guest' } },
        {
          type: 'any',
          conditions: [
            { type: 'paymentMethod', methods: ['upi'] },
            { type: 'cartContains', selector: { slugs: ['silk-scarf'] }, minQty: 1 },
          ],
        },
      ],
    };
    const condition = buildCondition(spec);
    expect(condition.evaluate(ctx).ok).toBe(true);
    expect(condition.evaluate(context([shirt])).reason).toBe('Requires paying with UPI or 1 or more of Silk Scarf');
    expect(subtotalThresholds(spec)).toEqual([100_000]);
  });

  it('supports the fluent specification API', () => {
    const rule = new MinSubtotal(100_000).and(new CartContains({ categories: ['Accessories'] }, 1).not());
    expect(rule.isSatisfiedBy(context([shirt]))).toBe(true);
    expect(rule.isSatisfiedBy(ctx)).toBe(false);
    expect(buildCondition(undefined).isSatisfiedBy(ctx)).toBe(true);
  });
});
