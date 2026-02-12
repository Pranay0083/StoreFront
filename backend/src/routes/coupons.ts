import { Router } from 'express';
import { z } from 'zod';
import { ApiError, requireAuth, validate } from '../middleware';
import { Coupon } from '../models';

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

const router = Router();

const validateSchema = z.object({
  code: z.string().min(2).max(30),
  subtotal: z.number().positive(),
});

router.post('/validate', requireAuth, validate(validateSchema), async (req, res, next) => {
  try {
    const { coupon, discount } = await applyCoupon(req.body.code, req.body.subtotal);
    res.json({ code: coupon.code, type: coupon.type, value: coupon.value, discount });
  } catch (e) { next(e); }
});

export default router;
