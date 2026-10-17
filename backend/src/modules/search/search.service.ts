import type { ProductListQuery } from '@storefront/contracts';
import type { EventBus } from '../../core/events/event-bus';
import type { JobQueue } from '../../core/queue/job-queue';
import type { ProductRecord } from '../catalog/product.model';
import type { ProductRepository } from '../catalog/product.repository';
import type { OrderRepository } from '../orders/order.repository';
import type { SearchFacets, SearchProvider, Suggestion } from './search.provider';

export const INDEX_PRODUCTS_JOB = 'search.index-products';

export interface SearchResults {
  items: ProductRecord[];
  total: number;
  facets: SearchFacets;
}

export class SearchService {
  constructor(
    readonly provider: SearchProvider,
    private readonly products: ProductRepository,
  ) {}

  /** Runs the query on the provider, then loads the products from Mongo in the provider's order. */
  async search(query: ProductListQuery & { q: string }): Promise<SearchResults> {
    const hits = await this.provider.search({
      q: query.q,
      category: query.category,
      size: query.size,
      minPrice: query.minPrice,
      maxPrice: query.maxPrice,
      featured: query.featured,
      sort: query.sort,
      limit: query.limit,
      offset: (query.page - 1) * query.limit,
    });
    const found = new Map((await this.products.findManyByIds(hits.ids)).map(p => [String(p._id), p]));
    return {
      items: hits.ids.map(id => found.get(id)).filter((p): p is ProductRecord => Boolean(p)),
      total: hits.total,
      facets: hits.facets,
    };
  }

  suggest(prefix: string, limit: number): Promise<Suggestion[]> {
    return this.provider.suggest(prefix, limit);
  }

  /** Upserts products that still exist and removes the rest. */
  async indexProducts(productIds: string[]): Promise<void> {
    const ids = [...new Set(productIds)];
    const found = await this.products.findManyByIds(ids);
    const present = new Set(found.map(p => String(p._id)));
    await this.provider.index(found);
    await this.provider.remove(ids.filter(id => !present.has(id)));
  }

  async reindexAll(batchSize = 500): Promise<number> {
    await this.provider.configure();
    let indexed = 0;
    let after: string | undefined;
    for (;;) {
      const batch = await this.products.findPage(after, batchSize);
      if (!batch.length) return indexed;
      await this.provider.index(batch);
      indexed += batch.length;
      after = String(batch.at(-1)!._id);
    }
  }

  /** Keeps an external index in sync with catalog edits and stock moves; a no-op for the Mongo provider. */
  registerIndexing(bus: EventBus, jobs: JobQueue, orders: OrderRepository): void {
    if (!this.provider.requiresIndexing) return;
    jobs.register<{ productIds: string[] }>({
      name: INDEX_PRODUCTS_JOB,
      queue: 'maintenance',
      attempts: 8,
      backoffMs: 10_000,
      handler: ({ productIds }) => this.indexProducts(productIds),
    });
    const enqueue = (productIds: string[]) => (productIds.length ? jobs.enqueue(INDEX_PRODUCTS_JOB, { productIds }) : Promise.resolve());
    const orderItems = async (orderId: string) => (await orders.findById(orderId))?.items.map(i => String(i.productId)) ?? [];

    bus.subscribe('ProductChanged', 'search.index-changed-product', e => enqueue([e.payload.productId]));
    bus.subscribe('OrderPlaced', 'search.index-reserved-stock', e => enqueue(e.payload.items.map(i => i.productId)));
    bus.subscribe('OrderCancelled', 'search.index-released-stock', async e => enqueue(await orderItems(e.payload.orderId)));
    bus.subscribe('RefundCompleted', 'search.index-restocked', async e => enqueue(await orderItems(e.payload.orderId)));
  }
}
