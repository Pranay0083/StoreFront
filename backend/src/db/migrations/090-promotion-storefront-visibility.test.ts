import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectDB, disconnectDB } from '../../core/config/db';
import { promotionStorefrontVisibility } from './090-promotion-storefront-visibility';

const db = () => mongoose.connection.db!;

describe('090-promotion-storefront-visibility', () => {
  beforeAll(() => connectDB(process.env.MONGO_URL!, process.env.DB_NAME!));
  beforeEach(() => db().dropDatabase());
  afterAll(async () => {
    await db().dropDatabase();
    await disconnectDB();
  });

  it('advertises automatic offers, keeps codes private and leaves explicit choices alone', async () => {
    await db()
      .collection('promotions')
      .insertMany([
        { name: 'Weekend Uniform', activation: 'auto' },
        { name: 'WELCOME10', activation: 'code', code: 'WELCOME10' },
        { name: 'Hidden bundle', activation: 'auto', showOnStorefront: false },
        { name: 'Advertised code', activation: 'code', code: 'SHOWN', showOnStorefront: true },
        { name: 'Legacy' },
      ]);

    await promotionStorefrontVisibility.up(db());
    await promotionStorefrontVisibility.up(db());

    const rows = await db().collection('promotions').find({}).toArray();
    expect(Object.fromEntries(rows.map(r => [r.name, r.showOnStorefront]))).toEqual({
      'Advertised code': true,
      'Hidden bundle': false,
      Legacy: true,
      WELCOME10: false,
      'Weekend Uniform': true,
    });
  });
});
