import {
  percentOf,
  type AppliedPromotion,
  type BundleOffer,
  type BundleOfferComponent,
  type PaymentMethod,
  type PriceBreakdown,
  type PriceQuote,
  type PricingItem,
} from '@storefront/contracts';
import { createHash, randomUUID } from 'node:crypto';
import { AppError, BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../core/errors';
import type { ActivePromotionCache } from './active-promotion.cache';
import { BuyXGetYAction, FixedBundlePriceAction, MixAndMatchAction } from './domain/actions';
import { type CustomerProfile, GUEST, type PricingLine } from './domain/pricing-line';
import type { CompiledPromotion } from './domain/promotion';
import { PromotionEngine } from './domain/promotion-engine';
import { matchesSelector } from './domain/selector';
import type { CatalogProduct, CustomerHistory, PricingCatalog } from './pricing.ports';
import type { PromotionRepository } from './promotion.repository';
import type { QuoteRepository } from './quote.model';

export interface PricingCart {
  items: readonly PricingItem[];
  codes?: readonly string[];
  paymentMethod?: PaymentMethod;
}

export interface PricingCaller {
  userId?: string;
}

/** The contract checkout depends on: quote a cart, then verify the quote when the order is placed. */
export interface PricingEngine {
  quote(cart: PricingCart, caller: PricingCaller): Promise<PriceQuote>;
  /** Re-prices the cart and returns the breakdown only if it still matches the quote. */
  verifyQuote(quoteId: string, cart: PricingCart, caller: PricingCaller): Promise<PriceBreakdown>;
  /** Counts usage of the applied promotions; all-or-nothing against usage limits. */
  redeem(applied: readonly AppliedPromotion[]): Promise<void>;
  release(applied: readonly AppliedPromotion[]): Promise<void>;
}

export interface PriceOverrides {
  promotions?: readonly CompiledPromotion[];
  customer?: CustomerProfile;
  now?: Date;
}

export class QuoteExpiredError extends AppError {
  constructor() {
    super(410, 'This price quote has expired. Please review your cart again.', undefined, 'QUOTE_EXPIRED');
  }
}

export class PriceChangedError extends AppError {
  constructor() {
    super(409, 'Prices or offers changed since you were quoted. Please review your cart.', undefined, 'PRICE_CHANGED');
  }
}

const QUOTE_TTL_MS = 10 * 60 * 1000;
const POOL_SIZE = 12;
const MAX_UNITS_FOR_SUGGESTIONS = 30;

const sortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(k => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
};
const sha256 = (value: unknown) => createHash('sha256').update(JSON.stringify(sortKeys(value))).digest('hex');

/** Merges duplicate variants and sorts lines so the same cart always prices (and hashes) identically. */
function normalizeItems(items: readonly PricingItem[]): PricingItem[] {
  const merged = new Map<string, PricingItem>();
  for (const item of items) {
    const key = `${item.productId}::${item.size}`;
    const prev = merged.get(key);
    merged.set(key, { ...item, qty: (prev?.qty ?? 0) + item.qty });
  }
  return [...merged.values()].sort((a, b) => a.productId.localeCompare(b.productId) || a.size.localeCompare(b.size));
}

export function hashCart(cart: PricingCart, caller: PricingCaller): string {
  return sha256({
    items: normalizeItems(cart.items)
      .map(i => [i.productId, i.size, i.qty])
      .sort(),
    codes: [...new Set((cart.codes ?? []).map(c => c.trim().toUpperCase()))].sort(),
    paymentMethod: cart.paymentMethod ?? null,
    userId: caller.userId ?? null,
  });
}

/** Hash of everything that affects what the customer pays (not explanations or suggestions). */
export function hashBreakdown(b: PriceBreakdown): string {
  return sha256({
    lines: b.lines.map(l => ({
      productId: l.productId,
      size: l.size,
      qty: l.qty,
      unitPrice: l.unitPrice,
      markdownPerUnit: l.markdownPerUnit,
      discounts: l.discounts,
      lineTotal: l.lineTotal,
    })),
    applied: b.applied.map(a => ({ id: a.promotionId, version: a.version, amount: a.amount, times: a.times, stage: a.stage })),
    shipping: b.shipping,
    shippingDiscount: b.shippingDiscount,
    total: b.total,
  });
}

const toLine = (p: CatalogProduct, size: { size: string; stock: number }, qty: number): PricingLine => ({
  productId: p.id,
  slug: p.slug,
  title: p.title,
  ...(p.image && { image: p.image }),
  category: p.category,
  size: size.size,
  qty,
  unitPrice: p.price,
  stock: size.stock,
  productCreatedAt: p.createdAt,
});

const toComponent = (p: CatalogProduct): BundleOfferComponent => ({
  productId: p.id,
  slug: p.slug,
  title: p.title,
  ...(p.image && { image: p.image }),
  price: p.price,
});

export class PricingService implements PricingEngine {
  constructor(
    private readonly catalog: PricingCatalog,
    private readonly history: CustomerHistory,
    private readonly cache: ActivePromotionCache,
    private readonly promotions: PromotionRepository,
    private readonly quotes: QuoteRepository,
    private readonly engine = new PromotionEngine(),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async price(cart: PricingCart, caller: PricingCaller, overrides: PriceOverrides = {}): Promise<PriceBreakdown> {
    const lines = await this.hydrate(cart.items);
    const codes = cart.codes ?? [];
    const customer = overrides.customer ?? (await this.customerProfile(caller.userId));
    const promotions = overrides.promotions ?? (await this.cache.index()).candidatesFor(lines, codes);
    const suggestionPool = await this.suggestionPool(promotions, lines);
    return this.engine.price(
      { lines, customer, paymentMethod: cart.paymentMethod, codes, now: overrides.now ?? this.clock(), suggestionPool },
      promotions,
    );
  }

  async quote(cart: PricingCart, caller: PricingCaller): Promise<PriceQuote> {
    const breakdown = await this.price(cart, caller);
    const quoteId = randomUUID();
    const contentHash = hashBreakdown(breakdown);
    const expiresAt = new Date(this.clock().getTime() + QUOTE_TTL_MS);
    await this.quotes.create({ _id: quoteId, userId: caller.userId ?? null, cartHash: hashCart(cart, caller), contentHash, breakdown, expiresAt });
    return { quoteId, contentHash, expiresAt: expiresAt.toISOString(), breakdown };
  }

  async verifyQuote(quoteId: string, cart: PricingCart, caller: PricingCaller): Promise<PriceBreakdown> {
    const stored = await this.quotes.findById(quoteId);
    if (!stored || stored.expiresAt <= this.clock()) throw new QuoteExpiredError();
    if (stored.userId !== (caller.userId ?? null)) throw new ForbiddenError('This quote belongs to a different customer');
    if (stored.cartHash !== hashCart(cart, caller)) throw new ConflictError('Your cart changed since this price was quoted');
    const fresh = await this.price(cart, caller);
    if (hashBreakdown(fresh) !== stored.contentHash) throw new PriceChangedError();
    return fresh;
  }

  async redeem(applied: readonly AppliedPromotion[]): Promise<void> {
    const done: AppliedPromotion[] = [];
    for (const promo of applied) {
      if (!(await this.promotions.tryRedeem(promo.promotionId))) {
        await this.release(done);
        this.cache.invalidate();
        throw new ConflictError(`"${promo.name}" has just been fully redeemed. Please review your cart.`);
      }
      done.push(promo);
    }
  }

  async release(applied: readonly AppliedPromotion[]): Promise<void> {
    await Promise.all(applied.map(p => this.promotions.releaseRedemption(p.promotionId)));
  }

  /** "Bought together" offers a product page can advertise. */
  async bundlesForProduct(productId: string): Promise<BundleOffer[]> {
    const [product] = await this.catalog.findByIds([productId]);
    if (!product) throw new NotFoundError('Product not found');
    const now = this.clock();
    const selectable = { productId: product.id, slug: product.slug, category: product.category };
    const offers: BundleOffer[] = [];

    for (const promo of (await this.cache.index()).touching(selectable)) {
      const action = promo.consumingAction();
      if (!action || promo.requiresCode || !promo.isLive(now)) continue;
      const base = { promotionId: promo.id, name: promo.name, description: promo.def.description, actionType: promo.def.action.type, summary: action.summary() };

      if (action instanceof FixedBundlePriceAction) {
        const components = await this.resolveComponents(action, product);
        if (!components) continue;
        const listPrice = components.reduce((s, c) => s + c.price, 0);
        if (listPrice <= action.price) continue;
        offers.push({ ...base, components, bundlePrice: action.price, listPrice, savings: listPrice - action.price });
      } else if (action instanceof MixAndMatchAction) {
        const listPrice = product.price * action.quantity;
        offers.push({ ...base, bundlePrice: action.price, listPrice, savings: Math.max(0, listPrice - action.price) });
      } else if (action instanceof BuyXGetYAction) {
        const listPrice = product.price * (action.buyQty + action.getQty);
        const savings = percentOf(product.price * action.getQty, action.percentOff);
        offers.push({ ...base, bundlePrice: listPrice - savings, listPrice, savings });
      }
    }
    return offers;
  }

  private async resolveComponents(action: FixedBundlePriceAction, product: CatalogProduct): Promise<BundleOfferComponent[] | null> {
    const selectable = { productId: product.id, slug: product.slug, category: product.category };
    const components: BundleOfferComponent[] = [];
    let usedSelf = false;
    for (const slot of action.components) {
      let pick: CatalogProduct | undefined;
      if (!usedSelf && matchesSelector(slot.selector, selectable)) {
        pick = product;
        usedSelf = true;
      } else {
        pick = (await this.catalog.findMatching([slot.selector], 2)).find(p => p.id !== product.id);
      }
      if (!pick) return null;
      for (let i = 0; i < slot.qty; i++) components.push(toComponent(pick));
    }
    return components;
  }

  private async hydrate(items: readonly PricingItem[]): Promise<PricingLine[]> {
    const normalized = normalizeItems(items);
    const products = new Map((await this.catalog.findByIds([...new Set(normalized.map(i => i.productId))])).map(p => [p.id, p]));
    return normalized.map(item => {
      const product = products.get(item.productId);
      if (!product) throw new BadRequestError(`Product not found: ${item.productId}`);
      const variant = product.sizes.find(s => s.size === item.size);
      if (!variant) throw new BadRequestError(`Size ${item.size} not available for ${product.title}`);
      return toLine(product, variant, item.qty);
    });
  }

  private async customerProfile(userId?: string): Promise<CustomerProfile> {
    if (!userId) return GUEST;
    return { id: userId, signedIn: true, isFirstOrder: (await this.history.completedOrderCount(userId)) === 0 };
  }

  private async suggestionPool(promotions: readonly CompiledPromotion[], lines: readonly PricingLine[]): Promise<PricingLine[]> {
    if (lines.reduce((s, l) => s + l.qty, 0) > MAX_UNITS_FOR_SUGGESTIONS) return [];
    const selectors = promotions.flatMap(p => p.consumingAction()?.selectors() ?? []);
    if (!selectors.length) return [];
    const products = await this.catalog.findMatching(selectors, POOL_SIZE);
    return products
      .filter(p => !lines.some(l => l.productId === p.id))
      .flatMap(p => {
        const size = p.sizes.find(s => s.stock > 0);
        return size ? [toLine(p, size, 1)] : [];
      });
  }
}
