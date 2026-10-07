import mongoose, { Schema, type Types } from 'mongoose';

export interface CouponRedemptionRecord {
  _id: Types.ObjectId;
  couponCode: string;
  orderId: Types.ObjectId;
  userId: Types.ObjectId;
  status: 'reserved' | 'released';
  createdAt: Date;
  updatedAt: Date;
}

/** One row per order that used a coupon, so usage counting and release are idempotent per order. */
const redemptionSchema = new Schema<CouponRedemptionRecord>(
  {
    couponCode: { type: String, required: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['reserved', 'released'], default: 'reserved', required: true },
  },
  { timestamps: true, versionKey: false },
);

redemptionSchema.index({ couponCode: 1, userId: 1 });

export const CouponRedemptionModel = mongoose.model<CouponRedemptionRecord>('CouponRedemption', redemptionSchema, 'couponredemptions');
