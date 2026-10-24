import type { Migration } from '../migration';

/** Every listing sort ends in `_id` (deterministic keyset cursors), optionally behind a category or featured filter. */
const LISTING_INDEXES = [
  { createdAt: -1, _id: -1 },
  { category: 1, createdAt: -1, _id: -1 },
  { featured: 1, createdAt: -1, _id: -1 },
  { price: 1, _id: 1 },
  { category: 1, price: 1, _id: 1 },
  { rating: -1, _id: -1 },
  { category: 1, rating: -1, _id: -1 },
] as const;

export const catalogListingIndexes: Migration = {
  id: '080-catalog-listing-indexes',
  description: 'Index each catalog sort so listings and cursor pages stop scanning and sorting in memory',
  async up(db) {
    const products = db.collection('products');
    for (const keys of LISTING_INDEXES) await products.createIndex({ ...keys });
    // Superseded by { category, price, _id }, which serves the same filters and range queries.
    if (await products.indexExists('category_1_price_1')) await products.dropIndex('category_1_price_1');
  },
};
