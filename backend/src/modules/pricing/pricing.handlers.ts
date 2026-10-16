import type { EventBus } from '../../core/events/event-bus';
import type { TransactionRunner } from '../../core/persistence/transaction';
import type { PricingEngine } from './pricing.service';

/** Promotion uses go back when an order is cancelled before payment or refunded in full; partial refunds keep them. */
export function registerPricingHandlers(bus: EventBus, deps: { pricing: PricingEngine; tx: TransactionRunner }): void {
  bus.subscribe('OrderCancelled', 'pricing.release-redemption', async event => {
    await deps.tx.run(session => deps.pricing.release(event.payload.orderId, session));
  });
  bus.subscribe('RefundCompleted', 'pricing.release-on-full-refund', async event => {
    if (!event.payload.fullyRefunded) return;
    await deps.tx.run(session => deps.pricing.release(event.payload.orderId, session));
  });
}
