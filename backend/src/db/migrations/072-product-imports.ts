import type { Migration } from '../migration';

export const productImportsIndexes: Migration = {
  id: '072-product-imports',
  description: 'Index CSV product imports by content hash (idempotency) and recency',
  async up(db) {
    await db.collection('product_imports').createIndex({ sha256: 1 }, { unique: true });
    await db.collection('product_imports').createIndex({ createdAt: -1 });
  },
};
