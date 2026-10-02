import type { mongo } from 'mongoose';
import type { Migration } from '../migration';

export const ensureIndexes: Migration = {
  id: '001-ensure-indexes',
  description: 'Create the indexes the application queries rely on',
  async up(db: mongo.Db) {
    await db.collection('users').createIndex({ email: 1 }, { unique: true });
    await db.collection('products').createIndex({ slug: 1 }, { unique: true });
    await db.collection('products').createIndex({ category: 1, price: 1 });
    await db.collection('products').createIndex({ title: 'text', description: 'text' });
    await db.collection('orders').createIndex({ orderNumber: 1 }, { unique: true });
    await db.collection('orders').createIndex({ userId: 1, createdAt: -1 });
    await db.collection('orders').createIndex({ status: 1, createdAt: -1 });
    await db.collection('orders').createIndex({ 'payment.razorpayOrderId': 1 });
    await db.collection('carts').createIndex({ userId: 1 }, { unique: true });
    await db.collection('reviews').createIndex({ productId: 1, userId: 1 }, { unique: true });
    await db.collection('coupons').createIndex({ code: 1 }, { unique: true });
    await db.collection('webhookevents').createIndex({ eventId: 1 }, { unique: true });
    await db.collection('conversations').createIndex({ sessionId: 1 }, { unique: true });
    await db.collection('conversations').createIndex({ updatedAt: -1 });
    await db.collection('loginattempts').createIndex({ identifier: 1 });
  },
};
