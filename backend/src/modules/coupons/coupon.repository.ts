import type { CouponInput, CouponUpdate } from '@storefront/contracts';
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

  async incrementUsage(code: string): Promise<void> {
    await CouponModel.updateOne({ code }, { $inc: { usedCount: 1 } });
  }
}
