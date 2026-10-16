import type { PricingMetrics } from '../../core/observability/metrics';
import { PricingService } from './pricing.service';

/**
 * Decorator-by-subclass: times every pricing run (quotes, quote verification, simulations all go
 * through `price`) and reports the optimizer strategy, without touching pricing logic.
 */
export class InstrumentedPricingService extends PricingService {
  private metrics?: PricingMetrics;

  withMetrics(metrics: PricingMetrics): this {
    this.metrics = metrics;
    return this;
  }

  override async price(...args: Parameters<PricingService['price']>): ReturnType<PricingService['price']> {
    const started = performance.now();
    const breakdown = await super.price(...args);
    this.metrics?.observeQuote(breakdown.optimizer, performance.now() - started);
    return breakdown;
  }
}
