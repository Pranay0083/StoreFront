import type { Category, ProductInput, ProductListQuery } from '@storefront/contracts';
import { CacheNamespace, type CacheObserver, type CacheProvider } from '../../core/cache/cache';
import type { EventBus } from '../../core/events/event-bus';
import { NotFoundError } from '../../core/errors';
import type { CatalogService } from './catalog.service';
import type { ProductRecord } from './product.model';

/** What the HTTP layer needs from the catalog; implemented by the service and by its caching decorator. */
export type Catalog = Pick<CatalogService, 'list' | 'categories' | 'getBySlug' | 'findBySlug' | 'search' | 'create' | 'update' | 'delete'>;

const stableKey = (value: Record<string, unknown>) =>
  Object.keys(value)
    .filter(k => value[k] !== undefined)
    .sort()
    .map(k => `${k}=${String(value[k])}`)
    .join('&');

/**
 * Decorator that serves catalog reads cache-aside. Every write, and every domain event that moves
 * stock, bumps the namespace generation so no page can show stale prices or availability for
 * longer than it takes the event to be delivered; the TTL is only a backstop.
 */
export class CachingCatalog implements Catalog {
  private readonly namespace: CacheNamespace;

  constructor(
    private readonly inner: CatalogService,
    cache: CacheProvider,
    ttlSeconds: number,
    observer?: CacheObserver,
  ) {
    this.namespace = new CacheNamespace(cache, 'catalog', ttlSeconds, observer);
  }

  list(query: ProductListQuery): ReturnType<CatalogService['list']> {
    return this.namespace.getOrLoad(`list:${stableKey(query as Record<string, unknown>)}`, () => this.inner.list(query));
  }

  categories(): Promise<Category[]> {
    return this.namespace.getOrLoad('categories', () => this.inner.categories());
  }

  async getBySlug(slug: string): Promise<ProductRecord> {
    const product = await this.findBySlug(slug);
    if (!product) throw new NotFoundError('Product not found');
    return product;
  }

  findBySlug(slug: string): Promise<ProductRecord | null> {
    return this.namespace.getOrLoad(`slug:${slug}`, () => this.inner.findBySlug(slug));
  }

  search(...args: Parameters<CatalogService['search']>): ReturnType<CatalogService['search']> {
    return this.inner.search(...args);
  }

  async create(input: ProductInput, actorId: string): Promise<ProductRecord> {
    const product = await this.inner.create(input, actorId);
    await this.invalidate();
    return product;
  }

  async update(id: string, patch: Partial<ProductInput>, actorId: string): Promise<ProductRecord> {
    const product = await this.inner.update(id, patch, actorId);
    await this.invalidate();
    return product;
  }

  async delete(id: string, actorId: string): Promise<void> {
    await this.inner.delete(id, actorId);
    await this.invalidate();
  }

  invalidate(): Promise<void> {
    return this.namespace.invalidate();
  }

  /** Stock changes happen inside order transactions, so the cache hears about them through events. */
  registerInvalidation(bus: EventBus): void {
    const bump = async () => this.invalidate();
    bus.subscribe('OrderPlaced', 'catalog.cache-invalidate-reserved', bump);
    bus.subscribe('OrderCancelled', 'catalog.cache-invalidate-released', bump);
    bus.subscribe('RefundCompleted', 'catalog.cache-invalidate-restocked', bump);
  }
}
