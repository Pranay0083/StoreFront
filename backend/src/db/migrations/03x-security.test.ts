import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectDB, disconnectDB } from '../../core/config/db';
import { loginThrottle } from './031-login-throttle';
import { cartLines } from './032-cart-lines';

const db = () => mongoose.connection.db!;

describe('auth & security migrations', () => {
  beforeAll(() => connectDB(process.env.MONGO_URL!, process.env.DB_NAME!));
  beforeEach(() => db().dropDatabase());
  afterAll(async () => {
    await db().dropDatabase();
    await disconnectDB();
  });

  it('031 clears legacy lockouts and makes throttle keys unique and expiring', async () => {
    const attempts = db().collection('loginattempts');
    await attempts.createIndex({ identifier: 1 });
    await attempts.insertOne({ identifier: 'victim@test.dev', count: 5, lockedUntil: new Date(Date.now() + 60_000) });

    await loginThrottle.up(db());

    expect(await attempts.countDocuments()).toBe(0);
    const indexes = await attempts.indexes();
    expect(indexes.find(i => i.key.identifier)).toMatchObject({ unique: true });
    expect(indexes.find(i => i.key.expireAt)).toMatchObject({ expireAfterSeconds: 0 });
  });

  it('031 also runs on a database that never had login attempts', async () => {
    await expect(loginThrottle.up(db())).resolves.toBeUndefined();
  });

  it('032 keeps only references in stored carts', async () => {
    const productId = new mongoose.Types.ObjectId();
    await db()
      .collection('carts')
      .insertOne({
        userId: new mongoose.Types.ObjectId(),
        items: [{ _id: new mongoose.Types.ObjectId(), productId, size: 'M', qty: 2, title: 'x', image: 'y', price: 1, slug: 'z' }],
      });
    await db().collection('carts').insertOne({ userId: new mongoose.Types.ObjectId(), items: [] });

    await cartLines.up(db());

    const [cart] = await db()
      .collection('carts')
      .find({ 'items.0': { $exists: true } })
      .toArray();
    expect(cart.items).toEqual([{ productId, size: 'M', qty: 2 }]);
  });
});
