import mongoose, { Schema } from 'mongoose';

const couponSchema = new Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  type: { type: String, enum: ['percent', 'flat'], required: true },
  value: { type: Number, required: true },
  minSubtotal: { type: Number, default: 0 },
  maxDiscount: { type: Number },
  usageLimit: { type: Number },
  usedCount: { type: Number, default: 0 },
  active: { type: Boolean, default: true },
  expiresAt: Date,
}, { timestamps: true });

export const Coupon = mongoose.model('Coupon', couponSchema);
