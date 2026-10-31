import {
  OFFER_KINDS,
  offerKindOf,
  type CustomerSegment,
  type Offer,
  type OfferExample,
  type OfferProduct,
  type OffersResponse,
  type PriceBreakdown,
} from '@storefront/contracts';
import { CacheNamespace, type CacheObserver, type CacheProvider } from '../../core/cache/cache';
import type { EventBus } from '../../core/events/event-bus';
import type { logger as appLogger } from '../../core/logger';
import { TieredAction } from '../pricing/domain/actions';
import { GUEST, type CustomerProfile } from '../pricing/domain/pricing-line';
import { CompiledPromotion } from '../pricing/domain/promotion';
import type { PricingService } from '../pricing/pricing.service';
import type { CatalogProduct } from '../pricing/pricing.ports';
import type { PromotionRecord } from '../pricing/promotion.model';
import { toDefinition } from '../pricing/promotion.repository';
import type { OfferCatalog } from './offer-catalog';
import { bundleCarts, type ExampleCart, firstSize, multiUnitCarts, singleCarts, toItems } from './offer-examples';
import { liveByTime, nextBoundary } from './offer-schedule';
import { minSpendOf, offerHeadline, offerTerms, paymentMethodOf, segmentOf } from './offer-words';

const MAX_PIECES = 48;
const SLOT_CANDIDATES = 6;
const POOL = 12;
const DAY_MS = 86_400_000;

const PROFILES: Record<CustomerSegment, CustomerProfile> = {
  guest: GUEST,
  signedIn: { id: 'offer-example', signedIn: true, isFirstOrder: false },
  returning: { id: 'offer-example', signedIn: true, isFirstOrder: false },
  firstOrder: { id: 'offer-example', signedIn: true, isFirstOrder: true },
};

export interface OfferSource {
  findActive(): Promise<PromotionRecord[]>;
}

type Logger = Pick<typeof appLogger, 'warn'>;

interface CachedOffers extends OffersResponse {
  /** The read model is only valid until the next scheduled start or stop. */
  validUntil?: string;
}

const toPiece = (p: CatalogProduct, minStock = 1): OfferProduct | undefined => {
  const size = firstSize(p, minStock);
  return (
    size && {
      productId: p.id,
      slug: p.slug,
      title: p.title,
      ...(p.image && { image: p.image }),
      category: p.category,
      price: p.price,
      size: size.size,
      stock: size.stock,
    }
  );
};

const unique = (products: readonly CatalogProduct[]) => [...new Map(products.map(p => [p.id, p])).values()];

/**
 * The public offers read model: every promotion that is live right now and advertised, with the
 * in-stock pieces it applies to and a worked example priced by the real pricing service, so the
 * saving a shopper reads on the home page is the saving the bag then gives. Cached in the shared
 * cache; any promotion, product or stock event drops it, and it expires on its own at the next
 * scheduled start or stop.
 */
export class OffersService {
  private readonly namespace: CacheNamespace;

  constructor(
    private readonly promotions: OfferSource,
    private readonly catalog: OfferCatalog,
    private readonly pricing: Pick<PricingService, 'price'>,
    cache: CacheProvider,
    private readonly logger: Logger,
    ttlSeconds = 300,
    observer?: CacheObserver,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.namespace = new CacheNamespace(cache, 'offers', ttlSeconds, observer);
  }

  async live(): Promise<OffersResponse> {
    let cached = await this.namespace.getOrLoad<CachedOffers>('live', () => this.build());
    if (cached.validUntil && new Date(cached.validUntil) <= this.clock()) {
      await this.invalidate();
      cached = await this.namespace.getOrLoad<CachedOffers>('live', () => this.build());
    }
    const { validUntil: _validUntil, ...response } = cached;
    return response;
  }

  invalidate(): Promise<void> {
    return this.namespace.invalidate();
  }

  /** Promotions, products and stock all change what is on offer. */
  registerInvalidation(bus: EventBus): void {
    const drop = async () => this.invalidate();
    bus.subscribe('PromotionChanged', 'offers.cache-invalidate-promotion', drop);
    bus.subscribe('ProductChanged', 'offers.cache-invalidate-product', drop);
    bus.subscribe('OrderPlaced', 'offers.cache-invalidate-reserved', drop);
    bus.subscribe('OrderCancelled', 'offers.cache-invalidate-released', drop);
    bus.subscribe('RefundCompleted', 'offers.cache-invalidate-restocked', drop);
  }

  async build(now = this.clock()): Promise<CachedOffers> {
    const records = await this.promotions.findActive();
    const boundaries = records.map(r => nextBoundary(r, now)).filter((d): d is Date => Boolean(d));
    const nextChangeAt = boundaries.length ? new Date(Math.min(...boundaries.map(d => d.getTime()))) : undefined;

    const live = records
      .map(r => new CompiledPromotion(toDefinition(r)))
      .filter(p => p.def.showOnStorefront && p.isLive(now) && liveByTime({ conditions: p.def.conditions }, now))
      .sort(CompiledPromotion.compare);
    const offers = (
      await Promise.all(
        live.map(p =>
          this.toOffer(p, now).catch(err => {
            this.logger.warn({ err, promotionId: p.id }, 'Could not build the storefront offer');
            return undefined;
          }),
        ),
      )
    ).filter((o): o is Offer => Boolean(o));
    offers.sort((a, b) => OFFER_KINDS.indexOf(a.kind) - OFFER_KINDS.indexOf(b.kind));

    return {
      offers,
      generatedAt: now.toISOString(),
      ...(nextChangeAt && { nextChangeAt: nextChangeAt.toISOString(), validUntil: nextChangeAt.toISOString() }),
    };
  }

  private async toOffer(promo: CompiledPromotion, now: Date): Promise<Offer | undefined> {
    const { def } = promo;
    const action = def.action;
    const minSpend = minSpendOf(def.conditions);
    const { pieces, carts } = await this.candidates(promo, now, minSpend);
    const consuming = Boolean(promo.consumingAction());
    if ((consuming || action.type === 'markdown' || action.type === 'clearance') && !pieces.length) return undefined;

    const example = await this.example(promo, carts);
    // A bundle nobody can buy right now (no set in stock that the optimizer would apply) is not advertised.
    if (consuming && !example) return undefined;

    return {
      id: def.id,
      version: def.version,
      name: def.name,
      description: def.description,
      kind: offerKindOf({ activation: def.activation, action, hasMinSpend: minSpend !== undefined }),
      actionType: action.type,
      summary: promo.action.summary(),
      headline: offerHeadline(action),
      terms: offerTerms(def.conditions),
      ...(def.endsAt && { endsAt: def.endsAt.toISOString() }),
      ...(def.code && { code: def.code }),
      pieces,
      ...(example && { example }),
      ...(action.type === 'tiered' && {
        tiers: action.tiers.map(t => ({ ...t, reward: TieredAction.describeReward(t) })),
      }),
      ...('percentOff' in action && { percentOff: action.percentOff }),
      ...(action.type === 'percentOff' && { percentOff: action.percent }),
    };
  }

  /** The pieces an offer applies to, and the bags its worked example may be priced on. */
  private async candidates(
    promo: CompiledPromotion,
    now: Date,
    minSpend?: number,
  ): Promise<{ pieces: OfferProduct[]; carts: ExampleCart[] }> {
    const action = promo.def.action;
    const pieces = (products: readonly CatalogProduct[], minStock = 1) =>
      unique(products)
        .flatMap(p => toPiece(p, minStock) ?? [])
        .slice(0, MAX_PIECES);
    switch (action.type) {
      case 'fixedBundle': {
        const slots = await Promise.all(
          action.components.map(async c => ({ qty: c.qty, products: await this.catalog.matching(c.selector, SLOT_CANDIDATES) })),
        );
        return { pieces: pieces(slots.flatMap(s => s.products)), carts: bundleCarts(slots, action.price) };
      }
      case 'mixAndMatch': {
        const products = await this.catalog.matching(action.selector, MAX_PIECES);
        return { pieces: pieces(products), carts: multiUnitCarts(products.slice(0, POOL), action.quantity, action.price) };
      }
      case 'buyXGetY': {
        const products = await this.catalog.matching(action.selector, MAX_PIECES);
        return { pieces: pieces(products), carts: multiUnitCarts(products.slice(0, POOL), action.buyQty + action.getQty) };
      }
      case 'markdown': {
        const products = await this.catalog.matching(action.selector, MAX_PIECES);
        return { pieces: pieces(products), carts: singleCarts(products) };
      }
      case 'clearance': {
        const query = { minStock: action.minStock, createdBefore: new Date(now.getTime() - action.minAgeDays * DAY_MS) };
        const products = await this.catalog.matching(action.selector, MAX_PIECES, query);
        return { pieces: pieces(products, action.minStock), carts: singleCarts(products, { minStock: action.minStock }) };
      }
      case 'percentOff':
      case 'flatOff': {
        const products = await this.catalog.matching(action.selector, MAX_PIECES);
        return { pieces: action.selector ? pieces(products) : [], carts: singleCarts(products, { minSpend }) };
      }
      case 'tiered':
      case 'freeShipping':
        // Thresholds and delivery terms are stated in words; there is no single bag that shows them best.
        return { pieces: [], carts: [] };
    }
  }

  /**
   * Prices candidate bags through the pricing service, exactly as the bag would (all live offers,
   * the optimizer choosing), and keeps the first one in which this offer is actually applied.
   */
  private async example(promo: CompiledPromotion, carts: readonly ExampleCart[]): Promise<OfferExample | undefined> {
    const segment = segmentOf(promo.def.conditions);
    const paymentMethod = paymentMethodOf(promo.def.conditions);
    for (const cart of carts) {
      const breakdown = await this.pricing.price(
        { items: toItems(cart), codes: promo.def.code ? [promo.def.code] : [], ...(paymentMethod && { paymentMethod }) },
        {},
        { customer: PROFILES[segment ?? 'guest'] },
      );
      const applied = breakdown.applied.find(a => a.promotionId === promo.id);
      if (!applied || applied.amount <= 0) continue;
      return toExample(cart, breakdown, promo.id, segment);
    }
    return undefined;
  }
}

function toExample(cart: ExampleCart, b: PriceBreakdown, promotionId: string, segment?: CustomerSegment): OfferExample {
  const shipping = b.shipping - b.shippingDiscount;
  const total = b.total - shipping;
  const offerSaving = b.applied.filter(a => a.promotionId === promotionId).reduce((s, a) => s + a.amount, 0);
  return {
    lines: cart.map(l => ({ ...toPiece(l.product)!, size: l.size, stock: l.stock, qty: l.qty })),
    listTotal: b.listSubtotal,
    total,
    saving: b.listSubtotal - total,
    offerSaving,
    shipping,
    alsoApplied: b.applied.filter(a => a.promotionId !== promotionId && a.stage !== 'shipping').map(a => a.name),
    ...(segment && segment !== 'guest' && { pricedFor: segment }),
  };
}
