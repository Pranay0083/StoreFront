import type { AppliedPromotion, Paise, PricingStageName, ProductSelector } from '@storefront/contracts';
import { allocate } from './allocation';
import type { EffectiveLine } from './pricing-line';
import type { CompiledPromotion } from './promotion';
import { matchesSelector } from './selector';

export interface LineState {
  line: EffectiveLine;
  /** Still payable on this line after the discounts applied so far. */
  amount: Paise;
  discounts: Map<string, Paise>;
}

export interface Scope {
  indexes: number[];
  amount: Paise;
  subtotal: Paise;
}

/** Mutable working state threaded through one run of the pricing pipeline. */
export class PricingState {
  readonly lines: LineState[];
  readonly applied = new Map<string, AppliedPromotion>();
  readonly stageTotals: Record<PricingStageName, Paise> = { markdown: 0, bundle: 0, cart: 0, code: 0, shipping: 0 };
  shipping: Paise = 0;
  shippingDiscount: Paise = 0;

  constructor(lines: readonly EffectiveLine[]) {
    this.lines = lines.map(line => ({ line, amount: line.effectiveUnitPrice * line.qty, discounts: new Map() }));
  }

  get listSubtotal(): Paise {
    return this.lines.reduce((s, l) => s + l.line.unitPrice * l.line.qty, 0);
  }

  get merchandiseSubtotal(): Paise {
    return this.lines.reduce((s, l) => s + l.line.effectiveUnitPrice * l.line.qty, 0);
  }

  get payableMerchandise(): Paise {
    return this.lines.reduce((s, l) => s + l.amount, 0);
  }

  get total(): Paise {
    return this.payableMerchandise + this.shipping - this.shippingDiscount;
  }

  scope(selector: ProductSelector | undefined): Scope {
    const indexes = this.lines.flatMap((l, i) => (matchesSelector(selector, l.line) ? [i] : []));
    return {
      indexes,
      amount: indexes.reduce((s, i) => s + this.lines[i].amount, 0),
      subtotal: indexes.reduce((s, i) => s + this.lines[i].line.effectiveUnitPrice * this.lines[i].line.qty, 0),
    };
  }

  /** Spreads `amount` over the given lines in proportion to `weights` and records it against the promotion. */
  discountLines(promo: CompiledPromotion, stage: PricingStageName, amount: Paise, indexes: number[], weights: number[], times = 1): void {
    if (amount <= 0) return;
    const shares = allocate(amount, weights);
    indexes.forEach((lineIndex, k) => {
      if (!shares[k]) return;
      const ls = this.lines[lineIndex];
      ls.amount -= shares[k];
      ls.discounts.set(promo.id, (ls.discounts.get(promo.id) ?? 0) + shares[k]);
    });
    this.record(promo, stage, amount, times);
  }

  record(promo: CompiledPromotion, stage: PricingStageName, amount: Paise, times = 1): void {
    if (amount <= 0) return;
    this.stageTotals[stage] += amount;
    const existing = this.applied.get(promo.id);
    if (existing) {
      existing.amount += amount;
      existing.times += times;
      return;
    }
    this.applied.set(promo.id, {
      promotionId: promo.id,
      version: promo.def.version,
      name: promo.name,
      actionType: promo.def.action.type,
      stage,
      ...(promo.def.code && { code: promo.def.code }),
      amount,
      times,
      description: promo.action.summary(),
    });
  }
}
