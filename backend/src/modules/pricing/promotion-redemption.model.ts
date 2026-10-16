import mongoose, { Schema, type Types } from 'mongoose';
import type { Session } from '../../core/persistence/transaction';

export interface RedeemedPromotion {
  promotionId: Types.ObjectId;
  version: number;
  name: string;
  code?: string;
  amount: number;
}

export interface PromotionRedemptionRecord {
  _id: Types.ObjectId;
  orderId: Types.ObjectId;
  userId: Types.ObjectId;
  promotions: RedeemedPromotion[];
  status: 'reserved' | 'released';
  releasedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** One row per order that used promotions, so usage counting and release are idempotent per order. */
const redemptionSchema = new Schema<PromotionRedemptionRecord>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    promotions: [
      {
        _id: false,
        promotionId: { type: Schema.Types.ObjectId, ref: 'Promotion', required: true },
        version: { type: Number, required: true },
        name: { type: String, required: true },
        code: String,
        amount: { type: Number, required: true },
      },
    ],
    status: { type: String, enum: ['reserved', 'released'], default: 'reserved', required: true },
    releasedAt: Date,
  },
  { timestamps: true, versionKey: false },
);

redemptionSchema.index({ 'promotions.promotionId': 1, status: 1 });
redemptionSchema.index({ userId: 1, createdAt: -1 });

export const PromotionRedemptionModel = mongoose.model<PromotionRedemptionRecord>(
  'PromotionRedemption',
  redemptionSchema,
  'promotion_redemptions',
);

export class PromotionRedemptionRepository {
  async record(
    redemption: { orderId: string; userId: string; promotions: Array<Omit<RedeemedPromotion, 'promotionId'> & { promotionId: string }> },
    session: Session,
  ): Promise<void> {
    await PromotionRedemptionModel.create([redemption], { session });
  }

  /** Marks the order's redemption released; returns it only if this caller won the release. */
  release(orderId: string, session: Session): Promise<PromotionRedemptionRecord | null> {
    return PromotionRedemptionModel.findOneAndUpdate(
      { orderId, status: 'reserved' },
      { $set: { status: 'released', releasedAt: new Date() } },
      { session, new: true },
    ).lean<PromotionRedemptionRecord>();
  }

  findByOrder(orderId: string): Promise<PromotionRedemptionRecord | null> {
    return PromotionRedemptionModel.findOne({ orderId }).lean<PromotionRedemptionRecord>();
  }

  countReserved(promotionId: string): Promise<number> {
    return PromotionRedemptionModel.countDocuments({ 'promotions.promotionId': promotionId, status: 'reserved' });
  }
}
