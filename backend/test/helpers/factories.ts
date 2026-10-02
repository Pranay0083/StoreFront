import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { UserModel as User } from '../../src/modules/auth/user.model';
import { ProductModel as Product } from '../../src/modules/catalog/product.model';
import { CouponModel as Coupon } from '../../src/modules/coupons/coupon.model';

export async function createUser(overrides: { email?: string; password?: string; name?: string; role?: 'customer' | 'admin' } = {}) {
  const password = overrides.password ?? 'Password@123';
  const user = await User.create({
    email: overrides.email ?? `user-${randomUUID().slice(0, 8)}@test.dev`,
    name: overrides.name ?? 'Test User',
    role: overrides.role ?? 'customer',
    passwordHash: await bcrypt.hash(password, 4),
  });
  const token = jwt.sign({ sub: String(user._id), email: user.email, type: 'access' }, process.env.JWT_SECRET!, { expiresIn: '15m' });
  return { user, password, token, id: String(user._id) };
}

export async function createProduct(overrides: Record<string, unknown> = {}) {
  const title = (overrides.title as string) ?? `Product ${randomUUID().slice(0, 6)}`;
  return Product.create({
    title,
    slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    category: 'Men',
    price: 100_000,
    images: ['https://images.unsplash.com/photo-1'],
    sizes: [
      { size: 'M', stock: 10 },
      { size: 'L', stock: 2 },
    ],
    ...overrides,
  });
}

export async function createCoupon(overrides: Record<string, unknown> = {}) {
  return Coupon.create({
    code: 'WELCOME10',
    type: 'percent',
    value: 10,
    minSubtotal: 100_000,
    maxDiscount: 50_000,
    active: true,
    ...overrides,
  });
}

export const ADDRESS = {
  name: 'Asha Verma',
  line1: '12 Residency Road',
  city: 'Bengaluru',
  state: 'KA',
  pincode: '560025',
  phone: '9876543210',
};
