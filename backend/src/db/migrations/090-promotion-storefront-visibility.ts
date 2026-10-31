import type { Migration } from '../migration';

/**
 * Promotions gained `showOnStorefront`. Existing ones take their activation's default: automatic
 * offers are advertised, code offers stay private. Version snapshots are history and stay untouched
 * (a version without the field reads with the same default). Idempotent: only missing values are set.
 */
export const promotionStorefrontVisibility: Migration = {
  id: '090-promotion-storefront-visibility',
  description: 'Backfill showOnStorefront on promotions: true for automatic offers, false for code offers',
  async up(db) {
    const promotions = db.collection('promotions');
    await promotions.updateMany({ showOnStorefront: { $exists: false }, activation: 'code' }, { $set: { showOnStorefront: false } });
    await promotions.updateMany({ showOnStorefront: { $exists: false } }, { $set: { showOnStorefront: true } });
  },
};
