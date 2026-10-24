import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectDB, disconnectDB } from '../../core/config/db';
import { catalogListingIndexes } from './080-catalog-listing-indexes';

const db = () => mongoose.connection.db!;

const plan = (filter: object, sort: Record<string, 1 | -1>) =>
  db().collection('products').find(filter).sort(sort).limit(24).explain('executionStats') as Promise<{
    queryPlanner: { winningPlan: unknown };
    executionStats: { totalDocsExamined: number };
  }>;

describe('080-catalog-listing-indexes', () => {
  beforeAll(() => connectDB(process.env.MONGO_URL!, process.env.DB_NAME!));
  beforeEach(async () => {
    await db().dropDatabase();
    const categories = ['Men', 'Women', 'Footwear', 'Accessories'];
    await db()
      .collection('products')
      .insertMany(
        Array.from({ length: 400 }, (_, i) => ({
          slug: `p-${i}`,
          category: categories[i % 4],
          price: 10_000 + ((i * 7919) % 400) * 100,
          rating: (i * 13) % 50,
          featured: i % 10 === 0,
          createdAt: new Date(Date.UTC(2026, 0, 1) + i * 60_000),
        })),
      );
    await db().collection('products').createIndex({ category: 1, price: 1 });
  });
  afterAll(async () => {
    await db().dropDatabase();
    await disconnectDB();
  });

  it('serves every listing sort from an index instead of an in-memory sort', async () => {
    await catalogListingIndexes.up(db());
    const cases: Array<[object, Record<string, 1 | -1>]> = [
      [{}, { createdAt: -1, _id: -1 }],
      [{ category: 'Men' }, { createdAt: -1, _id: -1 }],
      [{ featured: true }, { createdAt: -1, _id: -1 }],
      [{}, { price: 1, _id: 1 }],
      [{ category: 'Women' }, { price: -1, _id: -1 }],
      [{}, { rating: -1, _id: -1 }],
      [{ category: 'Footwear' }, { rating: -1, _id: -1 }],
    ];
    for (const [filter, sort] of cases) {
      const explained = await plan(filter, sort);
      expect(JSON.stringify(explained.queryPlanner.winningPlan), JSON.stringify({ filter, sort })).not.toContain('"SORT"');
      expect(explained.executionStats.totalDocsExamined).toBeLessThanOrEqual(24);
    }
  });

  it('replaces the old category/price index and can be re-run', async () => {
    await catalogListingIndexes.up(db());
    await catalogListingIndexes.up(db());
    const names = (await db().collection('products').indexes()).map(i => i.name);
    expect(names).not.toContain('category_1_price_1');
    expect(names).toContain('category_1_price_1__id_1');
  });
});
