import type { Category, ProductInput, ProductListQuery } from '@storefront/contracts';
import { ConflictError, NotFoundError } from '../../core/errors';
import { logger } from '../../core/logger';
import { domainEvent } from '../../core/events/domain-events';
import type { OutboxStore } from '../../core/events/outbox.store';
import type { Session, TransactionRunner } from '../../core/persistence/transaction';
import type { InventoryService } from '../inventory/inventory.service';
import type { ProductRecord } from './product.model';
import { encodeCursor } from './product-cursor';
import { ProductQueryBuilder } from './product-query.builder';
import type { ProductRepository } from './product.repository';

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

/** Full-text search port, implemented by the search module (Mongo text or Meilisearch). */
export interface ProductSearch {
  search(query: ProductListQuery & { q: string }): Promise<{ items: ProductRecord[]; total: number; facets: unknown }>;
}

export class CatalogService {
  constructor(
    private readonly products: ProductRepository,
    private readonly inventory: InventoryService,
    private readonly tx: TransactionRunner,
    private readonly outbox: OutboxStore,
    private readonly searchEngine?: ProductSearch,
  ) {}

  private changed(productId: string, change: 'created' | 'updated' | 'deleted', session: Session) {
    return this.outbox.append([domainEvent('ProductChanged', productId, { productId, change })], session);
  }

  async list(
    query: ProductListQuery,
  ): Promise<{ items: ProductRecord[]; total: number; page: number; pages: number; nextCursor: string | null; facets?: unknown }> {
    if (query.q && this.searchEngine) {
      const found = await this.searchEngine.search({ ...query, q: query.q });
      return { ...found, page: query.page, pages: Math.ceil(found.total / query.limit), nextCursor: null };
    }
    const builder = ProductQueryBuilder.fromListQuery(query);
    const spec = builder.build();
    const [items, total] = await Promise.all([this.products.find(spec), this.products.count(spec.countFilter)]);
    const last = items.at(-1);
    const nextCursor = last && items.length === query.limit ? encodeCursor(builder.sort, last) : null;
    return { items, total, page: query.page, pages: Math.ceil(total / query.limit), nextCursor };
  }

  search(builder: ProductQueryBuilder): Promise<ProductRecord[]> {
    return this.products.find(builder.build());
  }

  categories(): Promise<Category[]> {
    return this.products.categoryCounts();
  }

  findBySlug(slug: string): Promise<ProductRecord | null> {
    return this.products.findBySlug(slug);
  }

  async getBySlug(slug: string): Promise<ProductRecord> {
    const product = await this.products.findBySlug(slug);
    if (!product) throw new NotFoundError('Product not found');
    return product;
  }

  async create(input: ProductInput, actorId: string): Promise<ProductRecord> {
    const slug = input.slug || slugify(input.title);
    if (await this.products.existsBySlug(slug)) throw new ConflictError('Slug already exists');
    const product = await this.tx.run(async session => {
      const created = await this.products.create({ ...input, slug }, session);
      await this.inventory.recordOpeningStock(String(created._id), created.sizes, `admin:${actorId}`, session);
      await this.changed(String(created._id), 'created', session);
      return created;
    });
    logger.info({ adminId: actorId, productId: product._id, slug }, 'Product created');
    return product;
  }

  async update(id: string, patch: Partial<ProductInput>, actorId: string): Promise<ProductRecord> {
    const product = await this.tx.run(async session => {
      if (patch.sizes) await this.inventory.setStockLevels(id, patch.sizes, `admin:${actorId}`, session);
      const updated = await this.products.update(id, patch, session);
      if (updated) await this.changed(id, 'updated', session);
      return updated;
    });
    if (!product) throw new NotFoundError('Product not found');
    logger.info({ adminId: actorId, productId: id }, 'Product updated');
    return product;
  }

  async delete(id: string, actorId: string): Promise<void> {
    const deleted = await this.tx.run(async session => {
      if (!(await this.products.delete(id, session))) return false;
      await this.changed(id, 'deleted', session);
      return true;
    });
    if (!deleted) throw new NotFoundError('Product not found');
    logger.info({ adminId: actorId, productId: id }, 'Product deleted');
  }
}
