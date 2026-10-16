import { randomUUID } from 'node:crypto';
import { Meilisearch } from 'meilisearch';
import pino from 'pino';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { domainEvent } from '../src/core/events/domain-events';
import { EventBus } from '../src/core/events/event-bus';
import { MongoDeadLetterStore } from '../src/core/queue/dead-letter.store';
import { MemoryJobQueue } from '../src/core/queue/memory-job-queue';
import { ProductModel } from '../src/modules/catalog/product.model';
import { ProductRepository } from '../src/modules/catalog/product.repository';
import { MeilisearchProvider } from '../src/modules/search/meilisearch.search';
import { MongoTextSearch } from '../src/modules/search/mongo-text.search';
import type { SearchProvider } from '../src/modules/search/search.provider';
import { SearchService } from '../src/modules/search/search.service';
import { createProduct } from './helpers/factories';
import { API, useTestApp } from './helpers/app';

const t = useTestApp();
const MEILI_URL = process.env.TEST_MEILI_URL;
const MEILI_KEY = process.env.TEST_MEILI_KEY;

async function seedCatalog() {
  await createProduct({ title: 'Breton Linen Shirt', description: 'Breathable summer linen', category: 'Men', price: 249_900 });
  await createProduct({ title: 'Linen Wrap Dress', description: 'Relaxed linen dress', category: 'Women', price: 389_900 });
  await createProduct({
    title: 'Linen Camp Collar',
    description: 'Boxy linen shirt',
    category: 'Men',
    price: 199_900,
    sizes: [{ size: 'XL', stock: 0 }],
  });
  await createProduct({ title: 'Selvedge Denim Jeans', description: 'Raw denim', category: 'Men', price: 499_900 });
  return ProductModel.find().lean();
}

const titlesOf = async (service: SearchService, q: string, extra: Record<string, unknown> = {}) =>
  (await service.search({ q, page: 1, limit: 24, featured: false, ...extra })).items.map(p => p.title);

function providerContract(name: string, make: () => SearchProvider, enabled = true) {
  describe.skipIf(!enabled)(`${name} search provider contract`, () => {
    let service: SearchService;
    let provider: SearchProvider;

    beforeEach(async () => {
      provider = make();
      service = new SearchService(provider, new ProductRepository());
      await provider.configure();
      await provider.index(await seedCatalog());
    });

    it('finds products by text and counts facets within the results', async () => {
      const res = await service.search({ q: 'linen', page: 1, limit: 24, featured: false });
      expect(res.items.map(p => p.title).sort()).toEqual(['Breton Linen Shirt', 'Linen Camp Collar', 'Linen Wrap Dress']);
      expect(res.total).toBe(3);
      expect(res.facets.categories).toEqual([
        { value: 'Men', count: 2 },
        { value: 'Women', count: 1 },
      ]);
      expect(res.facets.sizes.find(f => f.value === 'XL')).toBeUndefined();
    });

    it('applies filters and explicit sort orders', async () => {
      expect(await titlesOf(service, 'linen', { category: 'Men', sort: 'price-asc' })).toEqual(['Linen Camp Collar', 'Breton Linen Shirt']);
      expect(await titlesOf(service, 'linen', { maxPrice: 300_000, sort: 'price-desc' })).toEqual([
        'Breton Linen Shirt',
        'Linen Camp Collar',
      ]);
      expect(await titlesOf(service, 'linen', { size: 'XL' })).toEqual([]);
    });

    it('suggests titles from a prefix for autocomplete', async () => {
      const suggestions = await service.suggest('lin', 5);
      expect(suggestions.map(s => s.title)).toEqual(expect.arrayContaining(['Linen Wrap Dress', 'Linen Camp Collar']));
      expect(suggestions[0]).toEqual({
        slug: expect.any(String),
        title: expect.any(String),
        category: expect.any(String),
        price: expect.any(Number),
      });
      expect(await service.suggest('   ', 5)).toEqual([]);
    });
  });
}

providerContract('mongo', () => new MongoTextSearch());

const meiliIndexes: string[] = [];
providerContract(
  'meilisearch',
  () => {
    const uid = `test_products_${randomUUID().slice(0, 8)}`;
    meiliIndexes.push(uid);
    return new MeilisearchProvider({ host: MEILI_URL!, apiKey: MEILI_KEY }, uid, true);
  },
  Boolean(MEILI_URL),
);

describe.skipIf(!MEILI_URL)('meilisearch specifics', () => {
  it('tolerates typos and keeps the index in sync through catalog events', async () => {
    const uid = `test_products_${randomUUID().slice(0, 8)}`;
    meiliIndexes.push(uid);
    const provider = new MeilisearchProvider({ host: MEILI_URL!, apiKey: MEILI_KEY }, uid, true);
    const service = new SearchService(provider, new ProductRepository());
    await provider.configure();
    await provider.index(await seedCatalog());

    expect((await titlesOf(service, 'lnen shrt')).at(0)).toBe('Breton Linen Shirt');

    const bus = new EventBus();
    const jobs = new MemoryJobQueue(new MongoDeadLetterStore(), pino({ level: 'silent' }));
    service.registerIndexing(bus, jobs, t.container.repositories.orders);
    const added = await createProduct({ title: 'Linen Bucket Hat', category: 'Accessories' });
    const [handler] = bus.handlersFor('ProductChanged');
    await handler.run(domainEvent('ProductChanged', String(added._id), { productId: String(added._id), change: 'created' }), {
      attempt: 1,
      maxAttempts: 1,
    });
    await jobs.drain();
    expect(await titlesOf(service, 'bucket')).toEqual(['Linen Bucket Hat']);

    await ProductModel.deleteOne({ _id: added._id });
    await handler.run(domainEvent('ProductChanged', String(added._id), { productId: String(added._id), change: 'deleted' }), {
      attempt: 1,
      maxAttempts: 1,
    });
    await jobs.drain();
    expect(await titlesOf(service, 'bucket')).toEqual([]);
  });

  afterAll(async () => {
    const client = new Meilisearch({ host: MEILI_URL!, ...(MEILI_KEY && { apiKey: MEILI_KEY }) });
    await Promise.all(meiliIndexes.map(uid => client.deleteIndex(uid).waitTask()));
  });
});

describe('search over HTTP', () => {
  it('serves autocomplete suggestions and faceted text search', async () => {
    await seedCatalog();
    const suggest = await t.http().get(`${API}/products/suggest?q=Lin&limit=2`).expect(200);
    expect(suggest.body.suggestions).toHaveLength(2);
    await t.http().get(`${API}/products/suggest`).expect(400);

    const res = await t.http().get(`${API}/products?q=linen&category=Men`).expect(200);
    expect(res.body.total).toBe(2);
    expect(res.body.facets.categories).toEqual([{ value: 'Men', count: 2 }]);
    expect(res.body.nextCursor).toBeNull();
  });

  it('emits ProductChanged through the outbox on catalog writes', async () => {
    const product = await createProduct({ title: 'Event Tee' });
    const { OutboxModel } = await import('../src/core/events/outbox.model');
    await t.container.services.catalog.update(String(product._id), { price: 120_000 }, 'admin-1');
    await t.container.services.catalog.delete(String(product._id), 'admin-1');
    const events = await OutboxModel.find({ name: 'ProductChanged' }).sort({ occurredAt: 1 }).lean();
    expect(events.map(e => (e.payload as { change: string }).change)).toEqual(['updated', 'deleted']);
  });
});
