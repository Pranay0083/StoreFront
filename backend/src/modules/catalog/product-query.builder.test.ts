import { ProductListQuerySchema } from '@storefront/contracts';
import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { decodeCursor, encodeCursor } from './product-cursor';
import { ProductQueryBuilder } from './product-query.builder';

describe('ProductQueryBuilder', () => {
  it('builds an unfiltered newest-first query by default', () => {
    expect(new ProductQueryBuilder().build()).toEqual({
      filter: {},
      countFilter: {},
      sort: { createdAt: -1, _id: -1 },
      skip: 0,
      limit: 24,
    });
  });

  it('maps parsed list queries onto filters, sort and pagination', () => {
    const query = ProductListQuerySchema.parse({
      category: 'Men',
      size: 'M',
      minPrice: '1000',
      maxPrice: '5000',
      q: 'linen',
      sort: 'price-desc',
      featured: 'true',
      page: '3',
      limit: '10',
    });
    const filter = {
      category: 'Men',
      featured: true,
      sizes: { $elemMatch: { size: 'M', stock: { $gt: 0 } } },
      price: { $gte: 1000, $lte: 5000 },
      $text: { $search: 'linen' },
    };
    expect(ProductQueryBuilder.fromListQuery(query).build()).toEqual({
      filter,
      countFilter: filter,
      sort: { price: -1, _id: -1 },
      skip: 20,
      limit: 10,
    });
  });

  it('clamps pagination and ignores unknown sorts', () => {
    const query = ProductListQuerySchema.parse({ sort: 'bogus', page: '-4', limit: '500' });
    expect(ProductQueryBuilder.fromListQuery(query).build()).toMatchObject({ sort: { createdAt: -1 }, skip: 0, limit: 48 });
  });

  it('supports one-sided price ranges', () => {
    expect(new ProductQueryBuilder().priceBetween(undefined, 2000).build().filter).toEqual({ price: { $lte: 2000 } });
    expect(new ProductQueryBuilder().priceBetween(500).build().filter).toEqual({ price: { $gte: 500 } });
  });

  it('escapes regex metacharacters in title fallback search', () => {
    const { filter } = new ProductQueryBuilder().titleMatchingAnyWord('silk (dress)+').build();
    expect(filter.title).toEqual({ $regex: 'silk|\\(dress\\)\\+', $options: 'i' });
  });

  it('falls back to the provided default sort', () => {
    expect(new ProductQueryBuilder().sortBy(undefined, 'rating').build().sort).toEqual({ rating: -1, _id: -1 });
  });

  it('continues after a keyset cursor without skipping, keeping totals unfiltered', () => {
    const id = new Types.ObjectId();
    const cursor = encodeCursor('price-asc', { _id: id, price: 2_000, createdAt: new Date(), rating: 4 });
    const q = new ProductQueryBuilder().inCategory('Men').sortBy('price-asc').page(5, 10).after(cursor).build();
    expect(q.skip).toBe(0);
    expect(q.countFilter).toEqual({ category: 'Men' });
    expect(q.filter).toEqual({ category: 'Men', $and: [{ $or: [{ price: { $gt: 2_000 } }, { price: 2_000, _id: { $gt: id } }] }] });
  });

  it('rejects tampered cursors and cursors from a different sort', () => {
    const cursor = encodeCursor('newest', { _id: new Types.ObjectId(), price: 1, createdAt: new Date('2026-01-01'), rating: 0 });
    expect(decodeCursor(cursor, 'newest').v).toBe('2026-01-01T00:00:00.000Z');
    expect(() => new ProductQueryBuilder().sortBy('price-asc').after(cursor)).toThrow('Invalid cursor for this sort order');
    expect(() => new ProductQueryBuilder().after('not-base64-json')).toThrow('Invalid cursor');
  });
});
