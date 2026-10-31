import { shippingFor, type OrderStatus } from '@storefront/contracts';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { logger } from '../../core/logger';
import type { Env } from '../../core/config/env';
import { UserModel } from '../../modules/auth/user.model';
import { ProductModel } from '../../modules/catalog/product.model';
import { recordOpeningBalances } from '../../modules/inventory/opening-balances';
import { OrderModel } from '../../modules/orders/order.model';
import { ReviewModel } from '../../modules/reviews/review.model';
import { seedDemoExperiments } from './demo-experiments';
import { DEMO_PRODUCTS, slugify } from './demo-products';
import { seedDemoPromotions } from './demo-promotions';

const rand = (n: number) => Math.floor(Math.random() * n);
const pick = <T>(arr: readonly T[]): T => arr[rand(arr.length)];

async function seedAdmin(env: Pick<Env, 'ADMIN_EMAIL' | 'ADMIN_PASSWORD'>) {
  if (!env.ADMIN_PASSWORD) {
    logger.warn('ADMIN_PASSWORD is not set; skipping admin account seed');
    return;
  }
  const existing = await UserModel.findOne({ email: env.ADMIN_EMAIL });
  if (!existing) {
    await UserModel.create({
      email: env.ADMIN_EMAIL,
      name: 'Store Admin',
      role: 'admin',
      passwordHash: await bcrypt.hash(env.ADMIN_PASSWORD, 10),
    });
    logger.info('Seeded admin account');
  } else if (!(await bcrypt.compare(env.ADMIN_PASSWORD, existing.passwordHash))) {
    existing.passwordHash = await bcrypt.hash(env.ADMIN_PASSWORD, 10);
    await existing.save();
    logger.info('Rotated admin password to match ADMIN_PASSWORD');
  }
}

async function seedCustomer(email: string, name: string, password: string) {
  return (await UserModel.findOne({ email })) ?? (await UserModel.create({ email, name, passwordHash: await bcrypt.hash(password, 10) }));
}

type OrderPath = OrderStatus[];

function pickOrderPath(daysAgo: number): OrderPath {
  const roll = Math.random();
  if (roll < 0.06) return ['created'];
  if (roll < 0.12) return ['created', 'cancelled'];
  if (roll < 0.16) return ['created', 'paid', 'refund_requested', 'refunded'];
  if (daysAgo > 7) return ['created', 'paid', 'packed', 'shipped', 'delivered'];
  if (daysAgo > 3)
    return pick([
      ['created', 'paid', 'packed', 'shipped'],
      ['created', 'paid', 'packed', 'shipped'],
      ['created', 'paid', 'packed'],
    ] as OrderPath[]);
  return pick([
    ['created', 'paid'],
    ['created', 'paid'],
  ] as OrderPath[]);
}

export interface SeedResult {
  catalogSeeded: boolean;
}

/**
 * Idempotent demo seed: ensures the admin and demo customer accounts and the demo promotions (including the WELCOME10 and FLAT500 codes) exist,
 * and populates the catalog, historical orders and reviews only when the catalog is empty.
 */
export async function seedDemoData(env: Pick<Env, 'ADMIN_EMAIL' | 'ADMIN_PASSWORD'>): Promise<SeedResult> {
  await seedAdmin(env);
  const customer = await seedCustomer('customer@storefront.dev', 'Demo Customer', 'Customer@123');
  await seedDemoPromotions(mongoose.connection.db!);
  await seedDemoExperiments(mongoose.connection.db!);
  if ((await ProductModel.countDocuments()) > 0) return { catalogSeeded: false };

  const products = await ProductModel.insertMany(DEMO_PRODUCTS.map(p => ({ ...p, slug: slugify(p.title) })));
  await recordOpeningBalances(mongoose.connection.db!, 'system:seed');

  const buyerNames = ['Aarav Shah', 'Meera Iyer', 'Kabir Rao', 'Ananya Das'];
  const buyers = [customer];
  for (let i = 1; i <= buyerNames.length; i++) {
    buyers.push(await seedCustomer(`buyer${i}@demo.storefront.dev`, buyerNames[i - 1], 'Buyer@123'));
  }

  const now = Date.now();
  const orders = [];
  for (let i = 0; i < 110; i++) {
    const daysAgo = rand(35);
    const createdAt = new Date(now - daysAgo * 86_400_000 - rand(86_400_000));
    const buyer = pick(buyers);
    const items = Array.from({ length: 1 + rand(3) }, () => {
      const p = pick(products);
      const qty = 1 + rand(2);
      return {
        productId: p._id,
        title: p.title,
        image: p.images[0],
        price: p.price,
        size: pick(p.sizes).size,
        qty,
        slug: p.slug,
        markdownPerUnit: 0,
        discounts: [],
        lineTotal: p.price * qty,
      };
    });
    const subtotal = items.reduce((s, it) => s + it.price * it.qty, 0);
    const shipping = shippingFor(subtotal);
    const path = pickOrderPath(daysAgo);

    const statusHistory = [];
    let prev: string | null = null;
    let t = createdAt.getTime();
    let paidAt: Date | undefined;
    for (const st of path) {
      statusHistory.push({
        from: prev,
        to: st,
        by: prev === null ? `user:${buyer._id}` : 'system:seed',
        note: prev === null ? 'Order placed' : '',
        at: new Date(t),
      });
      if (st === 'paid') paidAt = new Date(t);
      prev = st;
      t += 3_600_000 * (4 + rand(20));
    }
    orders.push({
      orderNumber: `SF-${createdAt.getTime().toString(36).toUpperCase()}${100 + i}`,
      userId: buyer._id,
      items,
      address: {
        name: buyer.name,
        line1: `${10 + rand(90)} Residency Road`,
        city: pick(['Mumbai', 'Bengaluru', 'Delhi', 'Pune', 'Chennai']),
        state: pick(['MH', 'KA', 'DL', 'TN']),
        pincode: `5600${10 + rand(89)}`,
        phone: `98${10000000 + rand(89999999)}`,
      },
      subtotal,
      shipping,
      discount: 0,
      total: subtotal + shipping,
      status: path[path.length - 1],
      statusHistory,
      payment: { provider: 'demo', status: paidAt ? 'captured' : 'pending', razorpayPaymentId: paidAt ? `demo_seed_${i}` : undefined },
      paidAt,
      createdAt,
      updatedAt: new Date(t),
    });
  }
  await OrderModel.insertMany(orders);

  const comments = [
    'Exceptional quality — the fabric feels far above this price point.',
    'Fits true to size and the finishing is immaculate.',
    'Delivery was quick and the packaging felt premium.',
    'Subtle, versatile, and clearly built to last.',
    'Already ordered a second one in another colour.',
  ];
  for (const p of products.slice(0, 12)) {
    const reviewers = buyers.slice(0, 2 + rand(3));
    let total = 0;
    for (const b of reviewers) {
      const rating = 4 + rand(2);
      total += rating;
      await ReviewModel.create({ productId: p._id, userId: b._id, userName: b.name, rating, comment: pick(comments) });
    }
    p.rating = Math.round((total / reviewers.length) * 10) / 10;
    p.numReviews = reviewers.length;
    p.ratingSum = total;
    await p.save();
  }
  logger.info({ products: products.length, orders: orders.length }, 'Seeded demo catalog, orders and reviews');
  return { catalogSeeded: true };
}
