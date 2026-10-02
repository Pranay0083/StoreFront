import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectDB, disconnectDB } from '../../core/config/db';
import { UserModel } from '../../modules/auth/user.model';
import { ProductModel } from '../../modules/catalog/product.model';
import { CouponModel } from '../../modules/coupons/coupon.model';
import { OrderModel } from '../../modules/orders/order.model';
import { seedDemoData } from './demo-seeder';

describe('seedDemoData', () => {
  beforeAll(() => connectDB(process.env.MONGO_URL!, process.env.DB_NAME!));
  afterAll(async () => {
    await mongoose.connection.db!.dropDatabase();
    await disconnectDB();
  });

  it('populates an empty database once and is idempotent afterwards', async () => {
    const env = { ADMIN_EMAIL: 'admin@test.dev', ADMIN_PASSWORD: 'Admin@12345' };
    expect(await seedDemoData(env)).toEqual({ catalogSeeded: true });
    const counts = async () => ({
      products: await ProductModel.countDocuments(),
      orders: await OrderModel.countDocuments(),
      coupons: await CouponModel.countDocuments(),
      users: await UserModel.countDocuments(),
    });
    const first = await counts();
    expect(first.products).toBeGreaterThan(20);
    expect(first.orders).toBe(110);
    expect(await UserModel.exists({ email: 'admin@test.dev', role: 'admin' })).not.toBeNull();

    expect(await seedDemoData(env)).toEqual({ catalogSeeded: false });
    expect(await counts()).toEqual(first);
  });

  it('skips the admin account when no password is configured', async () => {
    await seedDemoData({ ADMIN_EMAIL: 'other-admin@test.dev', ADMIN_PASSWORD: undefined });
    expect(await UserModel.exists({ email: 'other-admin@test.dev' })).toBeNull();
  });
});
