import type { ProductListQuery, ProductSort } from '@storefront/contracts';
import type { FilterQuery, SortOrder } from 'mongoose';
import { decodeCursor, keysetFilter, SORT_FIELDS } from './product-cursor';
import type { ProductRecord } from './product.model';

export interface ProductQuery {
  filter: FilterQuery<ProductRecord>;
  /** The filter without the keyset condition, for totals. */
  countFilter: FilterQuery<ProductRecord>;
  sort: Record<string, SortOrder>;
  skip: number;
  limit: number;
}

/** `_id` breaks ties so pagination is deterministic (and keyset cursors are exact). */
const sortSpec = (sort: ProductSort): Record<string, SortOrder> => {
  const { field, direction } = SORT_FIELDS[sort];
  return { [field]: direction, _id: direction };
};

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Fluent builder that turns catalog search criteria into a single Mongo query spec. */
export class ProductQueryBuilder {
  private readonly filter: FilterQuery<ProductRecord> = {};
  private sortName: ProductSort = 'newest';
  private cursorFilter?: FilterQuery<ProductRecord>;
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
      .page(q.page, q.limit)
      .after(q.cursor);
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
    this.sortName = sort && SORT_FIELDS[sort] ? sort : fallback;
    return this;
  }

  get sort(): ProductSort {
    return this.sortName;
  }

  /** Keyset pagination: continue after the cursor instead of skipping (call after sortBy). */
  after(cursor?: string): this {
    if (!cursor) return this;
    this.cursorFilter = keysetFilter(decodeCursor(cursor, this.sortName));
    this.skipCount = 0;
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
    const countFilter = { ...this.filter };
    const filter = this.cursorFilter ? { ...countFilter, $and: [this.cursorFilter] } : countFilter;
    return { filter, countFilter, sort: sortSpec(this.sortName), skip: this.skipCount, limit: this.limitCount };
  }
}
