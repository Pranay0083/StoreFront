import type { ProductListQuery, ProductSort } from '@storefront/contracts';
import type { FilterQuery, SortOrder } from 'mongoose';
import type { ProductRecord } from './product.model';

export interface ProductQuery {
  filter: FilterQuery<ProductRecord>;
  sort: Record<string, SortOrder>;
  skip: number;
  limit: number;
}

const SORTS: Record<ProductSort, Record<string, SortOrder>> = {
  'price-asc': { price: 1 },
  'price-desc': { price: -1 },
  newest: { createdAt: -1 },
  rating: { rating: -1 },
};

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Fluent builder that turns catalog search criteria into a single Mongo query spec. */
export class ProductQueryBuilder {
  private readonly filter: FilterQuery<ProductRecord> = {};
  private sortSpec: Record<string, SortOrder> = SORTS.newest;
  private skipCount = 0;
  private limitCount = 24;

  static fromListQuery(q: ProductListQuery): ProductQueryBuilder {
    return new ProductQueryBuilder()
      .inCategory(q.category)
      .featuredOnly(q.featured)
      .withSizeInStock(q.size)
      .priceBetween(q.minPrice, q.maxPrice)
      .matchingText(q.q)
      .sortBy(q.sort)
      .page(q.page, q.limit);
  }

  inCategory(category?: string): this {
    if (category) this.filter.category = category;
    return this;
  }

  featuredOnly(featured?: boolean): this {
    if (featured) this.filter.featured = true;
    return this;
  }

  withSizeInStock(size?: string): this {
    if (size) this.filter.sizes = { $elemMatch: { size, stock: { $gt: 0 } } };
    return this;
  }

  priceBetween(min?: number, max?: number): this {
    if (!min && !max) return this;
    this.filter.price = { ...(min ? { $gte: min } : {}), ...(max ? { $lte: max } : {}) };
    return this;
  }

  matchingText(q?: string): this {
    if (q) this.filter.$text = { $search: q };
    return this;
  }

  titleMatchingAnyWord(q?: string): this {
    const words = q?.trim().split(/\s+/).filter(Boolean).map(escapeRegex) ?? [];
    if (words.length) this.filter.title = { $regex: words.join('|'), $options: 'i' };
    return this;
  }

  sortBy(sort?: ProductSort, fallback: ProductSort = 'newest'): this {
    this.sortSpec = SORTS[sort ?? fallback] ?? SORTS[fallback];
    return this;
  }

  page(page: number, limit: number): this {
    this.limitCount = limit;
    this.skipCount = (page - 1) * limit;
    return this;
  }

  take(limit: number): this {
    this.limitCount = limit;
    this.skipCount = 0;
    return this;
  }

  build(): ProductQuery {
    return { filter: { ...this.filter }, sort: { ...this.sortSpec }, skip: this.skipCount, limit: this.limitCount };
  }
}
