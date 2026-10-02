import type { CouponInput, CouponUpdate, Paise } from '@storefront/contracts';
import { BadRequestError, ConflictError, NotFoundError } from '../../core/errors';
import { logger } from '../../core/logger';
import type { CouponRecord } from './coupon.model';
import { assertCouponRedeemable, calculateDiscount } from './coupon.policy';
import type { CouponRepository } from './coupon.repository';

export interface CouponQuote {
  coupon: CouponRecord;
  discount: Paise;
}

export class CouponService {
  constructor(private readonly coupons: CouponRepository) {}

  async quote(code: string, subtotal: Paise): Promise<CouponQuote> {
    const coupon = await this.coupons.findByCode(code);
    if (!coupon) throw new BadRequestError('Invalid coupon code');
    assertCouponRedeemable(coupon, subtotal);
    return { coupon, discount: calculateDiscount(coupon, subtotal) };
  }

  recordRedemption(code: string): Promise<void> {
    return this.coupons.incrementUsage(code);
  }

  list(): Promise<CouponRecord[]> {
    return this.coupons.list();
  }

  async create(input: CouponInput, actorId: string): Promise<CouponRecord> {
    if (await this.coupons.existsByCode(input.code)) throw new ConflictError('A coupon with this code already exists');
    const coupon = await this.coupons.create(input);
    logger.info({ adminId: actorId, couponCode: coupon.code }, 'Coupon created');
    return coupon;
  }

  async update(id: string, patch: CouponUpdate, actorId: string): Promise<CouponRecord> {
    const coupon = await this.coupons.update(id, patch);
    if (!coupon) throw new NotFoundError('Coupon not found');
    logger.info({ adminId: actorId, couponId: id }, 'Coupon updated');
    return coupon;
  }

  async delete(id: string, actorId: string): Promise<void> {
    if (!(await this.coupons.delete(id))) throw new NotFoundError('Coupon not found');
    logger.info({ adminId: actorId, couponId: id }, 'Coupon deleted');
  }
}
