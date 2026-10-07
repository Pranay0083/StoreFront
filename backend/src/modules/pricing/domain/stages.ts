import { shippingFor } from '@storefront/contracts';
import type { BundleApplication } from './bundle-optimizer';
import type { MarkdownResult } from './markdown';
import type { PricingState } from './pricing-state';
import type { CompiledPromotion } from './promotion';

/** Chain of Responsibility: each stage prices one concern, then hands the state to the next. */
export abstract class PricingStage {
  private next?: PricingStage;

  then(next: PricingStage): PricingStage {
    this.next = next;
    return next;
  }

  handle(state: PricingState): PricingState {
    this.process(state);
    return this.next ? this.next.handle(state) : state;
  }

  protected abstract process(state: PricingState): void;

  static chain(...stages: PricingStage[]): PricingStage {
    stages.reduce((prev, stage) => prev.then(stage));
    return stages[0];
  }
}

/** Records markdowns already folded into each line's effective unit price. */
export class MarkdownStage extends PricingStage {
  constructor(private readonly markdowns: MarkdownResult) {
    super();
  }

  protected process(state: PricingState): void {
    for (const [promo, { amount }] of this.markdowns.applied) state.record(promo, 'markdown', amount);
  }
}

export class BundleStage extends PricingStage {
  constructor(private readonly plan: readonly BundleApplication<CompiledPromotion>[]) {
    super();
  }

  protected process(state: PricingState): void {
    for (const app of this.plan) {
      const indexes = app.lineUnits.map(u => u.lineIndex);
      const weights = app.lineUnits.map(u => u.units * state.lines[u.lineIndex].line.effectiveUnitPrice);
      state.discountLines(app.promotion, 'bundle', app.savings, indexes, weights);
    }
  }
}

/** Order-level percentage, flat and tiered discounts, applied in priority order on what is still payable. */
export class CartDiscountStage extends PricingStage {
  constructor(
    private readonly promotions: readonly CompiledPromotion[],
    private readonly stage: 'cart' | 'code',
  ) {
    super();
  }

  protected process(state: PricingState): void {
    for (const promo of this.promotions) {
      const action = promo.cartAction();
      if (!action) continue;
      const scope = state.scope(action.selector);
      const amount = action.discount(scope.amount, scope.subtotal);
      if (amount <= 0) continue;
      state.discountLines(
        promo,
        this.stage,
        amount,
        scope.indexes,
        scope.indexes.map(i => state.lines[i].amount),
      );
    }
  }
}

/** The free-shipping threshold uses the list subtotal so that a markdown can never make an order cost more. */
export class ShippingStage extends PricingStage {
  constructor(private readonly freeShipping: readonly CompiledPromotion[]) {
    super();
  }

  protected process(state: PricingState): void {
    state.shipping = shippingFor(state.listSubtotal);
    const promo = this.freeShipping[0];
    if (promo && state.shipping > 0) {
      state.shippingDiscount = state.shipping;
      state.record(promo, 'shipping', state.shipping);
    }
  }
}
