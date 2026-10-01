import { ProductListQuerySchema } from '@storefront/contracts';
import { describe, expect, it } from 'vitest';
import { ProductQueryBuilder } from './product-query.builder';

describe('ProductQueryBuilder', () => {
  it('builds an unfiltered newest-first query by default', () => {
    expect(new ProductQueryBuilder().build()).toEqual({ filter: {}, sort: { createdAt: -1 }, skip: 0, limit: 24 });
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
    expect(ProductQueryBuilder.fromListQuery(query).build()).toEqual({
      filter: {
        category: 'Men',
        featured: true,
        sizes: { $elemMatch: { size: 'M', stock: { $gt: 0 } } },
        price: { $gte: 1000, $lte: 5000 },
        $text: { $search: 'linen' },
      },
      sort: { price: -1 },
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
    expect(new ProductQueryBuilder().sortBy(undefined, 'rating').build().sort).toEqual({ rating: -1 });
  });
});
