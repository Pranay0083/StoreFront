import { formatINR, PromotionInputSchema, type PromotionInput } from '@storefront/contracts';
import type { mongo } from 'mongoose';
import type { Migration } from '../migration';

interface LegacyCoupon {
  _id: mongo.ObjectId;
  code: string;
  type: 'percent' | 'flat';
  value: number;
  minSubtotal?: number | null;
  maxDiscount?: number | null;
  usageLimit?: number | null;
  usedCount?: number;
  active?: boolean;
  expiresAt?: Date | null;
}

interface LegacyRedemption {
  orderId: mongo.ObjectId;
  userId: mongo.ObjectId;
  couponCode: string;
  status: 'reserved' | 'released';
  createdAt?: Date;
  updatedAt?: Date;
}

type MappingOutcome = 'created' | 'existing' | 'invalid';

const ACTOR = 'system:migration';

function describe(c: LegacyCoupon): string {
  const off = c.type === 'percent' ? `${c.value}% off` : `${formatINR(c.value)} off`;
  const cap = c.type === 'percent' && c.maxDiscount ? ` (up to ${formatINR(c.maxDiscount)})` : '';
  const min = c.minSubtotal ? ` on orders of ${formatINR(c.minSubtotal)} or more` : '';
  return `${off}${cap}${min}.`;
}

/** The code promotion equivalent to a legacy coupon: same code, discount, minimum, cap, limit and expiry. */
export function promotionFromCoupon(c: LegacyCoupon): PromotionInput {
  return PromotionInputSchema.parse({
    name: `Coupon ${c.code}`,
    description: describe(c),
    status: c.active === false ? 'paused' : 'active',
    activation: 'code',
    code: c.code,
    stackGroup: 'order-discount',
    ...(c.minSubtotal ? { conditions: { type: 'minSubtotal', amount: c.minSubtotal } } : {}),
    action:
      c.type === 'percent'
        ? { type: 'percentOff', percent: c.value, ...(c.maxDiscount ? { maxDiscount: c.maxDiscount } : {}) }
        : { type: 'flatOff', amount: c.value },
    ...(c.expiresAt ? { endsAt: c.expiresAt.toISOString() } : {}),
    ...(c.usageLimit ? { usageLimit: c.usageLimit } : {}),
  });
}

async function exists(db: mongo.Db, name: string): Promise<boolean> {
  return (await db.listCollections({ name }, { nameOnly: true }).toArray()).length > 0;
}

async function retire(db: mongo.Db, name: string): Promise<void> {
  if (!(await exists(db, name)) || (await exists(db, `${name}_legacy`))) return;
  await db.collection(name).rename(`${name}_legacy`);
}

/**
 * Coupons become code promotions. Each coupon maps to a new promotion (or to an existing promotion
 * with the same code, e.g. the demo WELCOME10), recorded in `coupon_promotion_map`. Coupon
 * redemptions move to the promotion redemption ledger so cancelling or refunding a legacy order
 * still gives its use back, and the old collections are kept as `*_legacy` rather than dropped.
 */
export const couponsToPromotions: Migration = {
  id: '041-coupons-to-promotions',
  description: 'Convert coupons into equivalent code promotions and move coupon redemptions to the promotion ledger',
  async up(db: mongo.Db) {
    const promotions = db.collection('promotions');
    const versions = db.collection('promotion_versions');
    const mapping = db.collection('coupon_promotion_map');
    const now = new Date();

    if (await exists(db, 'coupons')) {
      for (const coupon of await db.collection<LegacyCoupon>('coupons').find().toArray()) {
        if (await mapping.findOne({ _id: coupon._id })) continue;
        const code = coupon.code.trim().toUpperCase();
        const existing = await promotions.findOne<{ _id: mongo.ObjectId }>({ code });
        let outcome: MappingOutcome = 'existing';
        let promotionId = existing?._id;
        let error: string | undefined;

        if (!existing) {
          try {
            const input = promotionFromCoupon({ ...coupon, code });
            const { startsAt, endsAt, ...rest } = input;
            const doc = {
              ...rest,
              ...(startsAt && { startsAt: new Date(startsAt) }),
              ...(endsAt && { endsAt: new Date(endsAt) }),
              usedCount: coupon.usedCount ?? 0,
              version: 1,
              migratedFrom: { kind: 'coupon', couponId: coupon._id, code },
              createdBy: ACTOR,
              updatedBy: ACTOR,
              createdAt: now,
              updatedAt: now,
            };
            promotionId = (await promotions.insertOne(doc)).insertedId;
            const { usedCount: _used, createdAt: _c, updatedAt: _u, ...snapshot } = doc;
            await versions.insertOne({ promotionId, version: 1, snapshot, changedBy: ACTOR, createdAt: now });
            outcome = 'created';
          } catch (e) {
            outcome = 'invalid';
            error = e instanceof Error ? e.message : String(e);
          }
        }
        await mapping.insertOne({
          _id: coupon._id,
          code,
          outcome,
          ...(promotionId && { promotionId }),
          ...(error && { error }),
          migratedAt: now,
        });
      }
    }

    if (await exists(db, 'couponredemptions')) {
      const ledger = db.collection('promotion_redemptions');
      for (const r of await db.collection<LegacyRedemption>('couponredemptions').find().toArray()) {
        if (await ledger.findOne({ orderId: r.orderId })) continue;
        const map = await mapping.findOne<{ promotionId?: mongo.ObjectId; outcome: MappingOutcome }>({ code: r.couponCode });
        if (!map?.promotionId) continue;
        const promotion = await promotions.findOne<{ name: string; version: number }>({ _id: map.promotionId });
        const order = await db.collection('orders').findOne<{ discount?: number }>({ _id: r.orderId }, { projection: { discount: 1 } });
        await ledger.insertOne({
          orderId: r.orderId,
          userId: r.userId,
          promotions: [
            {
              promotionId: map.promotionId,
              version: promotion?.version ?? 1,
              name: promotion?.name ?? r.couponCode,
              code: r.couponCode,
              amount: order?.discount ?? 0,
            },
          ],
          status: r.status,
          ...(r.status === 'released' && { releasedAt: r.updatedAt ?? now }),
          createdAt: r.createdAt ?? now,
          updatedAt: r.updatedAt ?? now,
        });
        // A coupon's usedCount already includes its reserved redemptions; an existing promotion's does not.
        if (r.status === 'reserved' && map.outcome === 'existing') {
          await promotions.updateOne({ _id: map.promotionId }, { $inc: { usedCount: 1 } });
        }
      }
    }

    await retire(db, 'coupons');
    await retire(db, 'couponredemptions');
  },
};
