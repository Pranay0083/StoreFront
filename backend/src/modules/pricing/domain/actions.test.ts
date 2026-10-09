import { describe, expect, it } from 'vitest';
import { buildAction } from './action.factory';
import {
  BuyXGetYAction,
  ClearanceAction,
  FixedBundlePriceAction,
  FlashMarkdownAction,
  MixAndMatchAction,
  PercentOffAction,
  TieredAction,
} from './actions';
import { CompiledPromotion, type PromotionDefinition } from './promotion';
import { line } from './test-fixtures';

describe('consuming actions', () => {
  it('prices a fixed bundle as the sum of its units minus the bundle price', () => {
    const combo = new FixedBundlePriceAction(
      [
        { selector: { slugs: ['shirt'] }, qty: 1 },
        { selector: { slugs: ['jeans'] }, qty: 1 },
      ],
      599_900,
    );
    expect(combo.unitsPerApplication).toBe(2);
    expect(combo.savings([249_900, 459_900])).toBe(109_900);
    expect(combo.savings([100_000, 100_000])).toBe(0);
    expect(combo.summary()).toBe('Shirt + Jeans for ₹5,999');
  });

  it('prices mix-and-match sets', () => {
    const any3 = new MixAndMatchAction({ categories: ['Men'] }, 3, 499_900);
    expect(any3.slots()).toEqual([{ selector: { categories: ['Men'] }, qty: 3 }]);
    expect(any3.savings([249_900, 249_900, 199_900])).toBe(199_800);
    expect(any3.summary()).toBe('Any 3 of Men items for ₹4,999');
  });

  it('discounts the cheapest units in a buy-x-get-y group', () => {
    const bogo = new BuyXGetYAction({ categories: ['Accessories'] }, 2, 1, 100);
    expect(bogo.unitsPerApplication).toBe(3);
    expect(bogo.savings([229_900, 129_900, 179_900])).toBe(129_900);
    expect(new BuyXGetYAction({ categories: ['Accessories'] }, 1, 1, 50).savings([100_001, 300_000])).toBe(50_000);
    expect(bogo.summary()).toBe('Buy 2, get 1 free on Accessories items (cheapest item)');
  });
});

describe('cart-level actions', () => {
  it('caps percentage discounts and never exceeds the scope amount', () => {
    const tenPct = new PercentOffAction(undefined, 10, 50_000);
    expect(tenPct.discount(200_000)).toBe(20_000);
    expect(tenPct.discount(900_000)).toBe(50_000);
    expect(buildAction({ type: 'flatOff', amount: 50_000 }).summary()).toBe('₹500 off your order');
  });

  it('picks the highest tier reached by the pre-promotion subtotal', () => {
    const tiers = new TieredAction(undefined, [
      { minSubtotal: 1_000_000, percentOff: 5 },
      { minSubtotal: 2_000_000, percentOff: 10 },
      { minSubtotal: 3_000_000, amountOff: 400_000 },
    ]);
    expect(tiers.discount(900_000, 900_000)).toBe(0);
    expect(tiers.discount(1_200_000, 1_500_000)).toBe(60_000);
    expect(tiers.discount(2_000_000, 2_500_000)).toBe(200_000);
    expect(tiers.discount(100_000, 3_500_000)).toBe(100_000);
    expect(tiers.nextTier(1_500_000)?.minSubtotal).toBe(2_000_000);
    expect(tiers.summary()).toBe('5% off over ₹10,000, 10% off over ₹20,000, ₹4,000 off over ₹30,000');
  });
});

describe('markdown actions', () => {
  it('applies flash markdowns to matching items only', () => {
    const flash = new FlashMarkdownAction({ categories: ['Footwear'] }, 15);
    expect(flash.percentFor(line({ category: 'Footwear' }))).toBe(15);
    expect(flash.percentFor(line({ category: 'Men' }))).toBe(0);
  });

  it('marks down long-stocked, slow items for clearance', () => {
    const clearance = new ClearanceAction(undefined, 20, 15, 60);
    const now = new Date('2026-10-30T00:00:00Z');
    const old = new Date('2026-07-01T00:00:00Z');
    expect(clearance.percentFor(line({ stock: 20, productCreatedAt: old }), now)).toBe(20);
    expect(clearance.percentFor(line({ stock: 5, productCreatedAt: old }), now)).toBe(0);
    expect(clearance.percentFor(line({ stock: 20, productCreatedAt: new Date('2026-10-01T00:00:00Z') }), now)).toBe(0);
  });
});

describe('compiled promotions', () => {
  const base: PromotionDefinition = {
    id: 'p1',
    version: 1,
    name: 'Welcome',
    description: '',
    status: 'active',
    activation: 'code',
    code: 'WELCOME10',
    priority: 100,
    exclusive: false,
    action: { type: 'percentOff', percent: 10 },
    usedCount: 0,
  };

  it('derives its pricing stage from the action and activation', () => {
    expect(new CompiledPromotion(base).stage).toBe('code');
    expect(new CompiledPromotion({ ...base, activation: 'auto', code: undefined }).stage).toBe('cart');
    expect(new CompiledPromotion({ ...base, action: { type: 'freeShipping' } }).stage).toBe('shipping');
    expect(new CompiledPromotion({ ...base, action: { type: 'markdown', selector: { categories: ['Men'] }, percentOff: 5 } }).stage).toBe(
      'markdown',
    );
  });

  it('reports why it is not live', () => {
    const now = new Date('2026-10-30T00:00:00Z');
    expect(new CompiledPromotion(base).isLive(now)).toBe(true);
    expect(new CompiledPromotion({ ...base, status: 'paused' }).liveness(now).reason).toBe('This offer is not active');
    expect(new CompiledPromotion({ ...base, endsAt: new Date('2026-10-01') }).liveness(now).reason).toBe('This offer has expired');
    expect(new CompiledPromotion({ ...base, usageLimit: 3, usedCount: 3 }).liveness(now).reason).toBe('This offer has been fully redeemed');
  });
});
