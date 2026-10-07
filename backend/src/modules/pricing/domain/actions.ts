import { formatINR, percentOf, type ActionType, type Paise, type ProductSelector } from '@storefront/contracts';
import type { PricingLine } from './pricing-line';
import { describeSelector, matchesSelector, type SelectableProduct } from './selector';

const DAY_MS = 86_400_000;

abstract class PromotionActionBase {
  abstract readonly type: ActionType;
  abstract summary(): string;
  /** Selectors this action targets; an empty list means it is cart-wide. */
  abstract selectors(): ProductSelector[];

  touches(product: SelectableProduct): boolean {
    const selectors = this.selectors();
    return selectors.length === 0 || selectors.some(s => matchesSelector(s, product));
  }
}

// ---------- Markdown stage: transparent, item-level dynamic pricing ----------

export abstract class MarkdownAction extends PromotionActionBase {
  /** Percentage off the unit price for this line (0 when it does not apply). */
  abstract percentFor(line: PricingLine, now: Date): number;
}

export class FlashMarkdownAction extends MarkdownAction {
  readonly type = 'markdown';

  constructor(
    readonly selector: ProductSelector,
    readonly percentOff: number,
  ) {
    super();
  }

  percentFor(line: PricingLine): number {
    return matchesSelector(this.selector, line) ? this.percentOff : 0;
  }

  summary(): string {
    return `${this.percentOff}% off ${describeSelector(this.selector)}`;
  }

  selectors(): ProductSelector[] {
    return [this.selector];
  }
}

export class ClearanceAction extends MarkdownAction {
  readonly type = 'clearance';

  constructor(
    readonly selector: ProductSelector | undefined,
    readonly percentOff: number,
    readonly minStock: number,
    readonly minAgeDays: number,
  ) {
    super();
  }

  percentFor(line: PricingLine, now: Date): number {
    const ageDays = (now.getTime() - line.productCreatedAt.getTime()) / DAY_MS;
    const eligible = matchesSelector(this.selector, line) && line.stock >= this.minStock && ageDays >= this.minAgeDays;
    return eligible ? this.percentOff : 0;
  }

  summary(): string {
    return `Clearance: ${this.percentOff}% off long-stocked ${describeSelector(this.selector)}`;
  }

  selectors(): ProductSelector[] {
    return this.selector ? [this.selector] : [];
  }
}

// ---------- Bundle stage: offers that consume specific units ----------

export interface Slot {
  selector: ProductSelector;
  qty: number;
}

export abstract class ConsumingAction extends PromotionActionBase {
  abstract slots(): Slot[];
  /** Savings for one application given the effective unit prices it consumes. */
  abstract savings(unitPrices: readonly Paise[]): Paise;

  get unitsPerApplication(): number {
    return this.slots().reduce((s, slot) => s + slot.qty, 0);
  }

  selectors(): ProductSelector[] {
    return this.slots().map(s => s.selector);
  }
}

const sum = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0);

export class FixedBundlePriceAction extends ConsumingAction {
  readonly type = 'fixedBundle';

  constructor(
    readonly components: readonly Slot[],
    readonly price: Paise,
  ) {
    super();
  }

  slots(): Slot[] {
    return [...this.components];
  }

  savings(unitPrices: readonly Paise[]): Paise {
    return Math.max(0, sum(unitPrices) - this.price);
  }

  summary(): string {
    const parts = this.components.map(c => `${c.qty > 1 ? `${c.qty} × ` : ''}${describeSelector(c.selector)}`);
    return `${parts.join(' + ')} for ${formatINR(this.price)}`;
  }
}

export class MixAndMatchAction extends ConsumingAction {
  readonly type = 'mixAndMatch';

  constructor(
    readonly selector: ProductSelector,
    readonly quantity: number,
    readonly price: Paise,
  ) {
    super();
  }

  slots(): Slot[] {
    return [{ selector: this.selector, qty: this.quantity }];
  }

  savings(unitPrices: readonly Paise[]): Paise {
    return Math.max(0, sum(unitPrices) - this.price);
  }

  summary(): string {
    return `Any ${this.quantity} of ${describeSelector(this.selector)} for ${formatINR(this.price)}`;
  }
}

export class BuyXGetYAction extends ConsumingAction {
  readonly type = 'buyXGetY';

  constructor(
    readonly selector: ProductSelector,
    readonly buyQty: number,
    readonly getQty: number,
    readonly percentOff: number,
  ) {
    super();
  }

  slots(): Slot[] {
    return [{ selector: this.selector, qty: this.buyQty + this.getQty }];
  }

  /** The cheapest `getQty` units in the group receive the discount. */
  savings(unitPrices: readonly Paise[]): Paise {
    const cheapest = [...unitPrices].sort((a, b) => a - b).slice(0, this.getQty);
    return percentOf(sum(cheapest), this.percentOff);
  }

  summary(): string {
    const reward = this.percentOff === 100 ? 'free' : `at ${this.percentOff}% off`;
    return `Buy ${this.buyQty}, get ${this.getQty} ${reward} on ${describeSelector(this.selector)} (cheapest item${this.getQty > 1 ? 's' : ''})`;
  }
}

// ---------- Cart / code stage: order-level discounts ----------

export abstract class CartDiscountAction extends PromotionActionBase {
  abstract readonly selector: ProductSelector | undefined;

  /**
   * @param scopeAmount what is still payable on in-scope lines after earlier discounts
   * @param scopeSubtotal in-scope merchandise subtotal before promotions (drives thresholds)
   */
  abstract discount(scopeAmount: Paise, scopeSubtotal: Paise): Paise;

  selectors(): ProductSelector[] {
    return this.selector ? [this.selector] : [];
  }

  protected scopeLabel(): string {
    return this.selector ? describeSelector(this.selector) : 'your order';
  }
}

export class PercentOffAction extends CartDiscountAction {
  readonly type = 'percentOff';

  constructor(
    readonly selector: ProductSelector | undefined,
    readonly percent: number,
    readonly maxDiscount?: Paise,
  ) {
    super();
  }

  discount(scopeAmount: Paise): Paise {
    const raw = percentOf(scopeAmount, this.percent);
    return Math.min(scopeAmount, this.maxDiscount === undefined ? raw : Math.min(raw, this.maxDiscount));
  }

  summary(): string {
    return `${this.percent}% off ${this.scopeLabel()}${this.maxDiscount ? ` (up to ${formatINR(this.maxDiscount)})` : ''}`;
  }
}

export class FlatOffAction extends CartDiscountAction {
  readonly type = 'flatOff';

  constructor(
    readonly selector: ProductSelector | undefined,
    readonly amount: Paise,
  ) {
    super();
  }

  discount(scopeAmount: Paise): Paise {
    return Math.min(scopeAmount, this.amount);
  }

  summary(): string {
    return `${formatINR(this.amount)} off ${this.scopeLabel()}`;
  }
}

export interface Tier {
  minSubtotal: Paise;
  percentOff?: number;
  amountOff?: Paise;
}

export class TieredAction extends CartDiscountAction {
  readonly type = 'tiered';

  constructor(
    readonly selector: ProductSelector | undefined,
    readonly tiers: readonly Tier[],
  ) {
    super();
  }

  tierFor(scopeSubtotal: Paise): Tier | undefined {
    return [...this.tiers].reverse().find(t => scopeSubtotal >= t.minSubtotal);
  }

  nextTier(scopeSubtotal: Paise): Tier | undefined {
    return this.tiers.find(t => t.minSubtotal > scopeSubtotal);
  }

  discountAtTier(tier: Tier, scopeAmount: Paise): Paise {
    const raw = tier.percentOff !== undefined ? percentOf(scopeAmount, tier.percentOff) : (tier.amountOff ?? 0);
    return Math.min(scopeAmount, raw);
  }

  discount(scopeAmount: Paise, scopeSubtotal: Paise): Paise {
    const tier = this.tierFor(scopeSubtotal);
    return tier ? this.discountAtTier(tier, scopeAmount) : 0;
  }

  static describeReward(tier: Tier): string {
    return tier.percentOff !== undefined ? `${tier.percentOff}% off` : `${formatINR(tier.amountOff ?? 0)} off`;
  }

  static describeTier(tier: Tier): string {
    return `${TieredAction.describeReward(tier)} over ${formatINR(tier.minSubtotal)}`;
  }

  summary(): string {
    return `Spend more, save more: ${this.tiers.map(TieredAction.describeTier).join(', ')}${this.selector ? ` on ${describeSelector(this.selector)}` : ''}`;
  }
}

// ---------- Shipping stage ----------

export class FreeShippingAction extends PromotionActionBase {
  readonly type = 'freeShipping';

  summary(): string {
    return 'Free shipping';
  }

  selectors(): ProductSelector[] {
    return [];
  }
}

export type PromotionAction = MarkdownAction | ConsumingAction | CartDiscountAction | FreeShippingAction;
