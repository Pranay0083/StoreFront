import type { CouponInput, CouponUpdate, Paise } from '@storefront/contracts';
import { BadRequestError, ConflictError, NotFoundError } from '../../core/errors';
import { logger } from '../../core/logger';
import type { Session } from '../../core/persistence/transaction';
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

  /** Reserves one use of the coupon for an order inside the checkout transaction. */
  async redeem(code: string, orderId: string, userId: string, session: Session): Promise<void> {
    if (!(await this.coupons.tryIncrementUsage(code, session))) throw new BadRequestError('This coupon has been fully redeemed');
    await this.coupons.recordRedemption({ couponCode: code, orderId, userId }, session);
  }

  /** Gives the use back when an unpaid order is cancelled. Idempotent per order. */
  async releaseRedemption(orderId: string, session: Session): Promise<boolean> {
    const code = await this.coupons.releaseRedemption(orderId, session);
    if (!code) return false;
    await this.coupons.decrementUsage(code, session);
    return true;
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
