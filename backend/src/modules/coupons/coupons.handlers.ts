import type { EventBus } from '../../core/events/event-bus';
import type { TransactionRunner } from '../../core/persistence/transaction';
import type { CouponService } from './coupons.service';

export function registerCouponHandlers(bus: EventBus, deps: { coupons: CouponService; tx: TransactionRunner }): void {
  bus.subscribe('OrderCancelled', 'coupons.release-redemption', async event => {
    if (!event.payload.couponCode) return;
    await deps.tx.run(session => deps.coupons.releaseRedemption(event.payload.orderId, session));
  });
}
