import { COUPON_TYPES } from '@storefront/contracts';
import mongoose, { Schema, type InferSchemaType, type Types } from 'mongoose';

const couponSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    type: { type: String, enum: COUPON_TYPES, required: true },
    value: { type: Number, required: true },
    minSubtotal: { type: Number, default: 0 },
    maxDiscount: { type: Number },
    usageLimit: { type: Number },
    usedCount: { type: Number, default: 0, required: true },
    active: { type: Boolean, default: true, required: true },
    expiresAt: Date,
  },
  { timestamps: true },
);

export type CouponRecord = InferSchemaType<typeof couponSchema> & { _id: Types.ObjectId };

export const CouponModel = mongoose.model('Coupon', couponSchema);
