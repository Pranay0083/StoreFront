import type { CouponInput, CouponUpdate } from '@storefront/contracts';
import type { Session } from '../../core/persistence/transaction';
import { CouponRedemptionModel } from './coupon-redemption.model';
import { CouponModel, type CouponRecord } from './coupon.model';

export class CouponRepository {
  findByCode(code: string): Promise<CouponRecord | null> {
    return CouponModel.findOne({ code: code.trim().toUpperCase() }).lean<CouponRecord>();
  }

  async existsByCode(code: string): Promise<boolean> {
    return (await CouponModel.exists({ code })) !== null;
  }

  list(): Promise<CouponRecord[]> {
    return CouponModel.find().sort({ createdAt: -1 }).lean<CouponRecord[]>();
  }

  async create(input: CouponInput): Promise<CouponRecord> {
    const doc = await CouponModel.create(input);
    return doc.toObject() as CouponRecord;
  }

  update(id: string, patch: CouponUpdate): Promise<CouponRecord | null> {
    return CouponModel.findByIdAndUpdate(id, patch, { new: true }).lean<CouponRecord>();
  }

  async delete(id: string): Promise<boolean> {
    return (await CouponModel.findByIdAndDelete(id)) !== null;
  }

  /** Counts one use only while the coupon is under its usage limit; false when the limit is reached. */
  async tryIncrementUsage(code: string, session: Session): Promise<boolean> {
    const res = await CouponModel.updateOne(
      {
        code,
        active: true,
        $or: [{ usageLimit: { $in: [null, 0] } }, { $expr: { $lt: ['$usedCount', '$usageLimit'] } }],
      },
      { $inc: { usedCount: 1 } },
      { session },
    );
    return res.modifiedCount === 1;
  }

  async decrementUsage(code: string, session: Session): Promise<void> {
    await CouponModel.updateOne({ code, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } }, { session });
  }

  async recordRedemption(redemption: { couponCode: string; orderId: string; userId: string }, session: Session): Promise<void> {
    await CouponRedemptionModel.create([redemption], { session });
  }

  /** Releases the order's redemption once; returns the coupon code if this call released it. */
  async releaseRedemption(orderId: string, session: Session): Promise<string | null> {
    const row = await CouponRedemptionModel.findOneAndUpdate(
      { orderId, status: 'reserved' },
      { $set: { status: 'released' } },
      { session, new: true },
    ).lean();
    return row?.couponCode ?? null;
  }
}
