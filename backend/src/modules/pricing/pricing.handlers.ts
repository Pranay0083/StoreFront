import type { EventBus } from '../../core/events/event-bus';
import type { TransactionRunner } from '../../core/persistence/transaction';
import type { PricingEngine } from './pricing.service';

/** Promotion uses go back when an order is cancelled before payment. */
export function registerPricingHandlers(bus: EventBus, deps: { pricing: PricingEngine; tx: TransactionRunner }): void {
  bus.subscribe('OrderCancelled', 'pricing.release-redemption', async event => {
    await deps.tx.run(session => deps.pricing.release(event.payload.orderId, session));
  });
}
