import { shippingFor } from '@storefront/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type PricingLine } from './pricing-line';
import { PromotionEngine, type PriceRequest } from './promotion-engine';
import { breakdownInvariantViolations, line, promo } from './test-fixtures';

const FRIDAY_NOON_IST = new Date('2026-10-30T06:30:00Z');
const SATURDAY_NOON_IST = new Date('2026-10-31T06:30:00Z');

const shirt = line({ slug: 'oxford-cotton-shirt', title: 'Oxford Cotton Shirt', unitPrice: 249_900 });
const jeans = line({ slug: 'selvedge-denim-jeans', title: 'Selvedge Denim Jeans', unitPrice: 459_900 });
const belt = line({ slug: 'leather-belt', title: 'Leather Belt', category: 'Accessories', unitPrice: 179_900 });
const beanie = line({ slug: 'wool-beanie', title: 'Wool Beanie', category: 'Accessories', unitPrice: 129_900 });
const cardHolder = line({ slug: 'card-holder', title: 'Card Holder', category: 'Accessories', unitPrice: 149_900 });
const sneakers = line({ slug: 'court-sneakers', title: 'Court Sneakers', category: 'Footwear', unitPrice: 549_900 });
const coat = line({ slug: 'wool-coat', title: 'Wool Coat', category: 'Women', unitPrice: 1_299_900 });

const engine = new PromotionEngine();
const request = (lines: PricingLine[], extra: Partial<PriceRequest> = {}): PriceRequest => ({
  lines,
  customer: { id: 'u1', signedIn: true, isFirstOrder: false },
  now: FRIDAY_NOON_IST,
  ...extra,
});
const qty = (l: PricingLine, n: number): PricingLine => ({ ...l, qty: n });

const combo = promo({
  id: 'weekend-uniform',
  name: 'Weekend Uniform',
  action: {
    type: 'fixedBundle',
    components: [
      { selector: { slugs: ['oxford-cotton-shirt'] }, qty: 1 },
      { selector: { slugs: ['selvedge-denim-jeans'] }, qty: 1 },
    ],
    price: 599_900,
  },
});
const tiered = promo({
  id: 'spend-more',
  name: 'Spend more, save more',
  stackGroup: 'order-discount',
  action: {
    type: 'tiered',
    tiers: [
      { minSubtotal: 1_000_000, percentOff: 5 },
      { minSubtotal: 2_000_000, percentOff: 10 },
    ],
  },
});
const welcome = promo({
  id: 'welcome10',
  name: 'Welcome 10',
  code: 'WELCOME10',
  stackGroup: 'order-discount',
  conditions: { type: 'minSubtotal', amount: 100_000 },
  action: { type: 'percentOff', percent: 10, maxDiscount: 50_000 },
});
const bogo = promo({
  id: 'b2g1',
  name: 'Buy 2 get 1 free',
  action: { type: 'buyXGetY', selector: { categories: ['Accessories'] }, buyQty: 2, getQty: 1, percentOff: 100 },
});

describe('PromotionEngine', () => {
  it('prices a cart with no promotions, charging shipping below the threshold', () => {
    const b = engine.price(request([shirt]), []);
    expect(b).toMatchObject({ listSubtotal: 249_900, discountTotal: 0, shipping: 9_900, total: 259_800, applied: [] });
    expect(b.optimizer.strategy).toBe('branch-and-bound');
  });

  it('applies the fixed bundle and allocates its saving across both lines', () => {
    const b = engine.price(request([shirt, jeans]), [combo]);
    expect(b.bundleDiscount).toBe(109_900);
    expect(b.total).toBe(599_900);
    // 109,900 × (2,49,900 | 4,59,900) / 7,09,800 = 38,692.65 | 71,207.35 → the stray paisa goes to the larger remainder.
    expect(b.lines.map(l => l.discounts[0].amount)).toEqual([38_693, 71_207]);
    expect(b.applied[0]).toMatchObject({ promotionId: 'weekend-uniform', stage: 'bundle', times: 1, version: 1 });
    expect(b.explanations[0]).toBe('Weekend Uniform: Oxford Cotton Shirt + Selvedge Denim Jeans for ₹5,999 — saves ₹1,099.');
    expect(breakdownInvariantViolations(b)).toEqual([]);
  });

  it('explains when the optimizer beats biggest-offer-first', () => {
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(slug => line({ slug, unitPrice: 100_000 }));
    const pair = (id: string, x: string, y: string) =>
      promo({
        id,
        action: {
          type: 'fixedBundle',
          components: [
            { selector: { slugs: [x] }, qty: 1 },
            { selector: { slugs: [y] }, qty: 1 },
          ],
          price: 140_000,
        },
      });
    const big = promo({ id: 'any-2-ab', action: { type: 'mixAndMatch', selector: { slugs: ['a', 'b'] }, quantity: 2, price: 110_000 } });
    const result = engine.price(request([a, b, c, d]), [big, pair('a+c', 'a', 'c'), pair('b+d', 'b', 'd')]);
    expect(result.bundleDiscount).toBe(120_000);
    expect(result.optimizer).toMatchObject({ bundleSavings: 120_000, greedySavings: 90_000 });
    expect(result.explanations).toContain('Our optimizer found a bundle combination that saves ₹300 more than applying the single biggest offer first.');
  });

  it('keeps only the better offer from a stack group and says why', () => {
    const b = engine.price(request([coat], { codes: ['welcome10'] }), [tiered, welcome]);
    expect(b.applied.map(a => a.promotionId)).toEqual(['spend-more']);
    expect(b.cartDiscount).toBe(64_995);
    expect(b.rejectedCodes).toEqual([{ code: 'WELCOME10', reason: 'Another offer gives you a better price on this cart' }]);
    expect(b.explanations).toContain(
      'Applied "Spend more, save more" instead of "Welcome 10": only one order-discount offer can be used per order, and this one saves ₹149.95 more.',
    );

    const small = engine.price(request([qty(shirt, 2)], { codes: ['WELCOME10'] }), [tiered, welcome]);
    expect(small.applied).toMatchObject([{ promotionId: 'welcome10', stage: 'code', code: 'WELCOME10', amount: 49_980 }]);
    expect(small.rejectedCodes).toEqual([]);
  });

  it('compares an exclusive offer against the best combination', () => {
    const mega = promo({ id: 'mega', name: 'Mega sale', exclusive: true, action: { type: 'percentOff', percent: 20 } });
    const b = engine.price(request([shirt, jeans]), [combo, tiered, mega]);
    expect(b.applied.map(a => a.promotionId)).toEqual(['mega']);
    expect(b.total).toBe(567_840);
    expect(b.explanations).toContain('"Mega sale" can\'t be combined with other offers, and on its own it saves ₹320.60 more than the best combination.');

    const weak = promo({ id: 'weak', name: 'Weak sale', exclusive: true, action: { type: 'percentOff', percent: 5 } });
    const c = engine.price(request([shirt, jeans]), [combo, weak]);
    expect(c.applied.map(a => a.promotionId)).toEqual(['weekend-uniform']);
    expect(c.explanations).toContain('"Weak sale" can\'t be combined with other offers; the combination applied saves ₹744.10 more.');
  });

  it('applies time-boxed markdowns before code discounts', () => {
    const footwearFriday = promo({
      id: 'footwear-friday',
      name: 'Footwear Friday',
      conditions: { type: 'dateWindow', daysOfWeek: [5] },
      action: { type: 'markdown', selector: { categories: ['Footwear'] }, percentOff: 15 },
    });
    const flat = promo({ id: 'flat500', code: 'FLAT500', action: { type: 'flatOff', amount: 50_000 } });
    const friday = engine.price(request([sneakers], { codes: ['FLAT500'] }), [footwearFriday, flat]);
    expect(friday.lines[0]).toMatchObject({ markdownPerUnit: 82_485, effectiveUnitPrice: 467_415, lineTotal: 417_415 });
    expect(friday).toMatchObject({ markdownTotal: 82_485, codeDiscount: 50_000, shipping: 0, total: 417_415, totalSavings: 132_485 });
    expect(breakdownInvariantViolations(friday)).toEqual([]);

    const saturday = engine.price(request([sneakers], { codes: ['FLAT500'], now: SATURDAY_NOON_IST }), [footwearFriday, flat]);
    expect(saturday.markdownTotal).toBe(0);
    expect(saturday.total).toBe(499_900);
  });

  it('gives first orders free shipping via a customer segment rule', () => {
    const firstShip = promo({ id: 'first-ship', name: 'First order ships free', conditions: { type: 'customerSegment', segment: 'firstOrder' }, action: { type: 'freeShipping' } });
    const first = engine.price(request([shirt], { customer: { id: 'u2', signedIn: true, isFirstOrder: true } }), [firstShip]);
    expect(first).toMatchObject({ shipping: 9_900, shippingDiscount: 9_900, total: 249_900 });
    expect(engine.price(request([shirt]), [firstShip]).shippingDiscount).toBe(0);
  });

  it('reports why codes were rejected', () => {
    const strict = promo({ ...welcome.def, conditions: { type: 'minSubtotal', amount: 200_000 } });
    const expired = promo({ id: 'old', code: 'OLD', endsAt: new Date('2026-01-01'), action: { type: 'flatOff', amount: 10_000 } });
    const b = engine.price(request([beanie], { codes: ['welcome10', 'nope', 'old'] }), [strict, expired]);
    expect(b.rejectedCodes).toEqual([
      { code: 'NOPE', reason: 'This code is not valid' },
      { code: 'OLD', reason: 'This offer has expired' },
      { code: 'WELCOME10', reason: 'Minimum order of ₹2,000 required' },
    ]);
    expect(b.discountTotal).toBe(0);
  });

  it('suggests adding an item only when the extra saving covers its cost', () => {
    const b = engine.price(request([belt, beanie], { suggestionPool: [cardHolder] }), [bogo]);
    expect(b.suggestions).toEqual([
      {
        kind: 'add-item',
        promotionId: 'b2g1',
        message: 'Add 1 × Wool Beanie (₹1,299) to unlock "Buy 2 get 1 free" — it\'s effectively free.',
        productId: beanie.productId,
        slug: 'wool-beanie',
        size: 'M',
        qty: 1,
        addedCost: 129_900,
        extraSavings: 129_900,
      },
    ]);
  });

  it('nudges customers who are close to a tier or free shipping', () => {
    const tier = engine.price(request([qty(jeans, 2)]), [tiered]);
    expect(tier.suggestions).toEqual([
      { kind: 'spend-more', promotionId: 'spend-more', message: 'Spend ₹802 more to get 5% off with "Spend more, save more".', addedCost: 80_200, extraSavings: 50_000 },
    ]);
    const ship = engine.price(request([qty(beanie, 2)]), []);
    expect(ship.suggestions).toEqual([{ kind: 'spend-more', message: 'Add ₹401 more to get free shipping.', addedCost: 40_100, extraSavings: 9_900 }]);
  });
});

const CATALOG = [shirt, jeans, belt, beanie, cardHolder, sneakers, coat];
const PROMOS = [
  combo,
  tiered,
  welcome,
  bogo,
  promo({ id: 'any3-men', action: { type: 'mixAndMatch', selector: { categories: ['Men'] }, quantity: 3, price: 699_900 } }),
  promo({ id: 'acc-10', stackGroup: 'order-discount', action: { type: 'percentOff', selector: { categories: ['Accessories'] }, percent: 10 } }),
  promo({ id: 'flat-1000', exclusive: true, action: { type: 'flatOff', amount: 100_000 } }),
  promo({ id: 'free-ship', conditions: { type: 'minSubtotal', amount: 150_000 }, action: { type: 'freeShipping' } }),
  promo({ id: 'flash', action: { type: 'markdown', selector: { categories: ['Footwear', 'Women'] }, percentOff: 15 } }),
  promo({ id: 'clearance', action: { type: 'clearance', percentOff: 20, minStock: 8, minAgeDays: 30 } }),
];

describe('PromotionEngine properties', () => {
  it('always reconciles to the paisa, never goes negative and never raises the price', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ product: fc.nat(CATALOG.length - 1), qty: fc.integer({ min: 1, max: 3 }), stock: fc.integer({ min: 0, max: 20 }) }), {
          minLength: 1,
          maxLength: 6,
        }),
        fc.subarray(PROMOS),
        fc.subarray(['WELCOME10', 'BOGUS']),
        (picks, promos, codes) => {
          const lines = picks.map((p, i) => ({ ...CATALOG[p.product], size: `S${i}`, qty: p.qty, stock: p.stock }));
          const req = request(lines, { codes });
          const b = engine.price(req, promos);
          expect(breakdownInvariantViolations(b)).toEqual([]);
          const list = lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);
          expect(b.total).toBeLessThanOrEqual(list + shippingFor(list));
          expect(JSON.stringify(engine.price(req, promos))).toBe(JSON.stringify(b));
        },
      ),
      { numRuns: Number(process.env.FC_RUNS ?? 200) },
    );
  });
});
