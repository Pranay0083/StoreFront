import { ApiError } from '../middleware';
import { Coupon } from '../models';

/**
 * Shared helper to apply a coupon code against a subtotal.
 * Validates expiration, usage limits, and minimum subtotal requirements.
 * Returns the computed discount amount and the coupon document.
 */
export async function applyCoupon(codeRaw: string, subtotal: number) {
  const code = codeRaw.trim().toUpperCase();
  const coupon = await Coupon.findOne({ code });
  if (!coupon || !coupon.active) throw new ApiError(400, 'Invalid coupon code');
  if (coupon.expiresAt && coupon.expiresAt < new Date()) throw new ApiError(400, 'This coupon has expired');
  if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) throw new ApiError(400, 'This coupon has been fully redeemed');
  if (subtotal < (coupon.minSubtotal || 0)) throw new ApiError(400, `Minimum order of ₹${coupon.minSubtotal} required for ${code}`);
  let discount = coupon.type === 'percent' ? Math.floor((subtotal * coupon.value) / 100) : coupon.value;
  if (coupon.maxDiscount) discount = Math.min(discount, coupon.maxDiscount);
  discount = Math.min(discount, subtotal);
  return { coupon, discount };
}

/**
 * Validates a coupon code from the client and returns the discount value.
 */
export const validateCoupon = async (req: any, res: any, next: any) => {
  try {
    const { coupon, discount } = await applyCoupon(req.body.code, req.body.subtotal);
    res.json({ code: coupon.code, type: coupon.type, value: coupon.value, discount });
  } catch (e) { next(e); }
};
