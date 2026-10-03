import type { mongo } from 'mongoose';
import { recordOpeningBalances } from '../../modules/inventory/opening-balances';
import type { Migration } from '../migration';

export const inventoryLedger: Migration = {
  id: '010-inventory-ledger',
  description: 'Create inventory ledger/reservation indexes and record opening balances for existing stock',
  async up(db: mongo.Db) {
    await db.collection('inventorymovements').createIndex({ productId: 1, size: 1, createdAt: -1 });
    await db.collection('inventorymovements').createIndex({ orderId: 1 });
    await db.collection('stockreservations').createIndex({ orderId: 1 }, { unique: true });
    await db.collection('stockreservations').createIndex({ status: 1, expiresAt: 1 });
    await recordOpeningBalances(db, 'system:migration');
  },
};
