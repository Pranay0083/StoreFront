import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { ActivePromotionCache } from './active-promotion.cache';
import type { PromotionRecord } from './promotion.model';

const record = (name: string, action: PromotionRecord['action'], priority = 100): PromotionRecord =>
  ({
    _id: new Types.ObjectId(),
    name,
    description: '',
    status: 'active',
    activation: 'auto',
    priority,
    exclusive: false,
    action,
    usedCount: 0,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as PromotionRecord;

const shirt = { productId: 'p-shirt', slug: 'oxford-cotton-shirt', category: 'Men' };
const scarf = { productId: 'p-scarf', slug: 'silk-scarf', category: 'Accessories' };

function fakeSource(records: PromotionRecord[]) {
  const source = { calls: 0, records, findActive: async () => (source.calls++, source.records) };
  return source;
}

describe('ActivePromotionCache', () => {
  it('indexes promotions by product, slug and category, keeping cart-wide ones global', async () => {
    const source = fakeSource([
      record('Men any 3', { type: 'mixAndMatch', selector: { categories: ['Men'] }, quantity: 3, price: 1 }),
      record('Scarf combo', { type: 'fixedBundle', components: [{ selector: { slugs: ['silk-scarf'] }, qty: 1 }], price: 1 }, 200),
      record('Pinned', { type: 'markdown', selector: { productIds: ['p-shirt'] }, percentOff: 5 }),
      record('Sitewide', { type: 'percentOff', percent: 5 }, 50),
    ]);
    const index = await new ActivePromotionCache(source).index();
    expect(index.candidatesFor([shirt]).map(p => p.name)).toEqual(expect.arrayContaining(['Men any 3', 'Pinned', 'Sitewide']));
    expect(index.candidatesFor([shirt])).toHaveLength(3);
    expect(index.candidatesFor([scarf]).map(p => p.name)).toEqual(['Scarf combo', 'Sitewide']);
    expect(index.touching(scarf).map(p => p.name)).toEqual(['Scarf combo']);
  });

  it('serves from memory within the TTL and reloads after invalidation or expiry', async () => {
    let now = 0;
    const source = fakeSource([record('A', { type: 'freeShipping' })]);
    const cache = new ActivePromotionCache(source, 1_000, () => now);
    await Promise.all([cache.index(), cache.index()]);
    expect(source.calls).toBe(1);
    now = 500;
    await cache.index();
    expect(source.calls).toBe(1);
    cache.invalidate();
    source.records = [];
    expect((await cache.index()).promotions).toHaveLength(0);
    expect(source.calls).toBe(2);
    now = 5_000;
    await cache.index();
    expect(source.calls).toBe(3);
  });
});
