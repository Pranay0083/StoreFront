import { percentOf, type Paise } from '@storefront/contracts';
import { BadRequestError } from '../../core/errors';
import type { CouponRecord } from './coupon.model';

type CouponTerms = Pick<CouponRecord, 'code' | 'type' | 'value' | 'active' | 'usedCount'> & {
  minSubtotal?: number | null;
  maxDiscount?: number | null;
  usageLimit?: number | null;
  expiresAt?: Date | null;
};

export function assertCouponRedeemable(coupon: CouponTerms, subtotal: Paise, now = new Date()): void {
  if (!coupon.active) throw new BadRequestError('Invalid coupon code');
  if (coupon.expiresAt && coupon.expiresAt < now) throw new BadRequestError('This coupon has expired');
  if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) throw new BadRequestError('This coupon has been fully redeemed');
  if (subtotal < (coupon.minSubtotal ?? 0)) {
    throw new BadRequestError(`Minimum order of ₹${coupon.minSubtotal} required for ${coupon.code}`);
  }
}

export function calculateDiscount(coupon: CouponTerms, subtotal: Paise): Paise {
  let discount = coupon.type === 'percent' ? percentOf(subtotal, coupon.value) : coupon.value;
  if (coupon.maxDiscount) discount = Math.min(discount, coupon.maxDiscount);
  return Math.min(discount, subtotal);
}
