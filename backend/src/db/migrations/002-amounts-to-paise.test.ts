import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectDB, disconnectDB } from '../../core/config/db';
import { amountsToPaise } from './002-amounts-to-paise';

describe('002-amounts-to-paise', () => {
  beforeAll(() => connectDB(process.env.MONGO_URL!, process.env.DB_NAME!));
  afterAll(async () => {
    await mongoose.connection.db!.dropDatabase();
    await disconnectDB();
  });

  it('scales rupee amounts to paise without inventing missing fields', async () => {
    const db = mongoose.connection.db!;
    await db.collection('products').insertMany([
      { slug: 'a', price: 2499, compareAtPrice: 3299 },
      { slug: 'b', price: 999 },
    ]);
    await db.collection('orders').insertOne({
      orderNumber: 'SF-1',
      subtotal: 2000,
      shipping: 99,
      total: 2099,
      items: [{ title: 'x', price: 1000, qty: 2 }],
    });
    await db.collection('carts').insertOne({ items: [{ price: 2499 }, { title: 'legacy without price' }] });
    await db.collection('coupons').insertMany([
      { code: 'PCT', type: 'percent', value: 10, minSubtotal: 1000, maxDiscount: 500 },
      { code: 'FLAT', type: 'flat', value: 500, minSubtotal: 2999 },
    ]);

    await amountsToPaise.up(db);

    const products = await db.collection('products').find().sort({ slug: 1 }).toArray();
    expect(products.map(p => [p.price, p.compareAtPrice])).toEqual([
      [249_900, 329_900],
      [99_900, undefined],
    ]);
    const order = await db.collection('orders').findOne({ orderNumber: 'SF-1' });
    expect(order).toMatchObject({ subtotal: 200_000, shipping: 9_900, total: 209_900, items: [{ price: 100_000, qty: 2 }] });
    expect(order).not.toHaveProperty('discount');
    const cart = await db.collection('carts').findOne();
    expect(cart!.items).toEqual([{ price: 249_900 }, { title: 'legacy without price' }]);
    const coupons = await db.collection('coupons').find().sort({ code: 1 }).toArray();
    expect(coupons.map(c => [c.code, c.value, c.minSubtotal, c.maxDiscount])).toEqual([
      ['FLAT', 50_000, 299_900, undefined],
      ['PCT', 10, 100_000, 50_000],
    ]);
  });
});
