import type { PriceBreakdown } from '@storefront/contracts';
import mongoose from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pricingIndexes } from '../src/db/migrations/020-pricing-indexes';
import { DEMO_PROMOTIONS, seedDemoPromotions } from '../src/db/seed/demo-promotions';
import { seedDemoData } from '../src/db/seed/demo-seeder';
import { ProductModel } from '../src/modules/catalog/product.model';
import { breakdownInvariantViolations } from '../src/modules/pricing/domain/test-fixtures';
import { API, useTestApp } from './helpers/app';

const t = useTestApp();

beforeEach(async () => {
  const db = mongoose.connection.db!;
  await pricingIndexes.up(db);
  await seedDemoData({ ADMIN_EMAIL: 'admin@test.dev', ADMIN_PASSWORD: undefined });
  t.container.services.promotionCache.invalidate();
});

afterEach(() => {
  vi.useRealTimers();
});

async function quote(slugs: string[], codes: string[] = []): Promise<PriceBreakdown> {
  const products = await ProductModel.find({ slug: { $in: slugs } }).lean();
  expect(products).toHaveLength(slugs.length);
  const items = products.map(p => ({ productId: String(p._id), size: p.sizes[0].size, qty: 1 }));
  const res = await t.http().post(`${API}/pricing/quote`).send({ items, codes }).expect(200);
  const breakdown = res.body.breakdown as PriceBreakdown;
  expect(breakdownInvariantViolations(breakdown)).toEqual([]);
  return breakdown;
}

describe('demo promotions seed', () => {
  it('seeds every demo promotion once, each with a version-1 snapshot', async () => {
    await seedDemoPromotions(mongoose.connection.db!);
    const db = mongoose.connection.db!;
    expect(await db.collection('promotions').countDocuments()).toBe(DEMO_PROMOTIONS.length);
    expect(await db.collection('promotion_versions').countDocuments({ version: 1 })).toBe(DEMO_PROMOTIONS.length);
  });

  it('finds the combination greedy misses on the seeded catalog', async () => {
    const b = await quote(['oxford-cotton-shirt', 'selvedge-denim-jeans', 'breton-linen-shirt', 'twill-overshirt', 'ribbed-knit-top']);
    expect(
      b.applied
        .filter(a => a.stage === 'bundle')
        .map(a => a.name)
        .sort(),
    ).toEqual(['Any 3 shirts & tops', 'Weekend Uniform']);
    expect(b.optimizer).toMatchObject({ strategy: 'branch-and-bound', bundleSavings: 319_700, greedySavings: 259_800 });
    expect(b.explanations).toContain(
      'Our optimizer found a bundle combination that saves ₹599 more than applying the single biggest offer first.',
    );
  });

  it('keeps the better of the tiered offer and WELCOME10, and explains it', async () => {
    const b = await quote(['oxford-cotton-shirt', 'selvedge-denim-jeans', 'breton-linen-shirt', 'twill-overshirt'], ['WELCOME10']);
    expect(b).toMatchObject({ listSubtotal: 1_319_600, bundleDiscount: 259_800, cartDiscount: 52_990, codeDiscount: 0, total: 1_006_810 });
    expect(b.rejectedCodes).toEqual([{ code: 'WELCOME10', reason: 'Another offer gives you a better price on this cart' }]);
    expect(b.explanations).toContain(
      'Applied "Spend more, save more" instead of "WELCOME10": only one order-discount offer can be used per order, and this one saves ₹29.90 more.',
    );
  });

  it.each([
    ['Desk to dinner', ['unstructured-linen-blazer', 'tapered-wool-trousers'], 199_900],
    ['The suiting set', ['oversized-wool-blazer', 'wide-leg-trousers'], 189_900],
    ['Weekend away', ['waxed-canvas-backpack', 'canvas-low-top-sneakers', 'washed-cotton-cap'], 169_800],
    ['Derby & belt', ['leather-derby-shoes', 'full-grain-leather-belt'], 129_900],
    ['Any 2 knits', ['brushed-mohair-sweater', 'fair-isle-yoke-cardigan'], 249_900],
    // The cheapest tee is free; the description advertises the best case (three Breton tees, ₹1,799).
    ['Buy 2 tees, get 1 free', ['heavyweight-cotton-tee', 'garment-dyed-cotton-tee', 'breton-stripe-tee'], 129_900, 179_900],
  ])('applies the "%s" combo for the saving its description advertises', async (name, slugs, saving, advertisedSaving = saving) => {
    // A Saturday, so "Footwear Friday" markdowns cannot change the bundle saving on the footwear combos.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-31T06:30:00Z') });
    const b = await quote(slugs);
    expect(b.applied.filter(a => a.stage === 'bundle').map(a => a.name)).toEqual([name]);
    expect(b.bundleDiscount).toBe(saving);
    const advertised = DEMO_PROMOTIONS.find(p => p.name === name)!.description!;
    expect(advertised).toContain(`₹${(advertisedSaving / 100).toLocaleString('en-IN')}`);
  });

  it('nudges toward a free accessory', async () => {
    const b = await quote(['full-grain-leather-belt', 'ribbed-wool-beanie']);
    expect(b.suggestions[0]).toMatchObject({ kind: 'add-item', slug: 'ribbed-wool-beanie', addedCost: 129_900, extraSavings: 129_900 });
  });
});
