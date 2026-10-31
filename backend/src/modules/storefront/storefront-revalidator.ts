import type { EventBus } from '../../core/events/event-bus';
import type { logger as appLogger } from '../../core/logger';
import { UnrecoverableJobError, type JobQueue } from '../../core/queue/job-queue';
import type { ProductRepository } from '../catalog/product.repository';
import { nextBoundary, SCHEDULE_HORIZON_MS, type Scheduled } from '../offers/offer-schedule';
import type { OrderRepository } from '../orders/order.repository';

export const REVALIDATE_STOREFRONT_JOB = 'storefront.revalidate';
export const OFFER_BOUNDARY_JOB = 'storefront.offer-boundary';
/** The storefront's tag for everything built from `GET /offers` (home offers, /offers, offer lines on cards). */
export const OFFERS_TAG = 'offers';
/** Coalesces bursts (e.g. a run of checkouts on one product) into a single revalidation. */
const COALESCE_MS = 5_000;
/** Fire a moment after the boundary so the API's clock has certainly passed it when the page refetches. */
const BOUNDARY_GRACE_MS = 1_000;

export interface StorefrontRevalidatorConfig {
  url: string;
  secret: string;
}

export interface RevalidateJob {
  productIds?: string[];
  tags?: string[];
}

export interface OfferBoundaryJob {
  promotionId: string;
  version: number;
  /** False for a horizon checkpoint that only looks for the next boundary again. */
  revalidate: boolean;
}

type ScheduledPromotion = Scheduled & { _id: unknown; version: number };

export interface PromotionSchedule {
  findById(id: string): Promise<ScheduledPromotion | null>;
  findActive(): Promise<ScheduledPromotion[]>;
}

type Logger = Pick<typeof appLogger, 'debug' | 'warn'>;

/** Tells the Next.js storefront which cached pages are stale; best-effort, pages also expire on their own. */
export class StorefrontRevalidator {
  private jobs?: JobQueue;
  private promotions?: PromotionSchedule;

  constructor(
    private readonly config: StorefrontRevalidatorConfig,
    private readonly products: Pick<ProductRepository, 'findById'>,
    private readonly logger: Logger,
    private readonly http: typeof fetch = fetch,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** Product ids become listing, id and slug tags; any product change also refreshes offers, whose pieces it may be. */
  async tagsFor(productIds: readonly string[], extra: readonly string[] = []): Promise<string[]> {
    const tags = new Set(extra);
    if (productIds.length) tags.add('products').add(OFFERS_TAG);
    for (const id of new Set(productIds)) {
      tags.add(`product-id:${id}`);
      const product = await this.products.findById(id);
      if (product) tags.add(`product:${product.slug}`);
    }
    return [...tags].sort();
  }

  async revalidate(tags: string[]): Promise<void> {
    const res = await this.http(this.config.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-revalidate-secret': this.config.secret },
      body: JSON.stringify({ tags }),
      signal: AbortSignal.timeout(5_000),
    });
    if (res.ok) return;
    if (res.status >= 400 && res.status < 500) throw new UnrecoverableJobError(`Storefront rejected revalidation with ${res.status}`);
    throw new Error(`Storefront revalidation failed with ${res.status}`);
  }

  register(bus: EventBus, jobs: JobQueue, orders: Pick<OrderRepository, 'findById'>, promotions: PromotionSchedule): void {
    this.jobs = jobs;
    this.promotions = promotions;
    jobs.register<RevalidateJob>({
      name: REVALIDATE_STOREFRONT_JOB,
      queue: 'maintenance',
      attempts: 3,
      backoffMs: 5_000,
      handler: async ({ productIds = [], tags: extra = [] }) => {
        const tags = await this.tagsFor(productIds, extra);
        if (!tags.length) return;
        await this.revalidate(tags);
        this.logger.debug({ tags }, 'Storefront cache revalidated');
      },
    });
    jobs.register<OfferBoundaryJob>({
      name: OFFER_BOUNDARY_JOB,
      queue: 'maintenance',
      attempts: 3,
      backoffMs: 5_000,
      handler: async ({ promotionId, version, revalidate }) => {
        const promotion = await promotions.findById(promotionId);
        // A newer version scheduled its own boundaries; this one is stale.
        if (!promotion || promotion.version !== version) return;
        if (revalidate) {
          await this.revalidate([OFFERS_TAG]);
          this.logger.debug({ promotionId, version }, 'Offer started or stopped on schedule; storefront revalidated');
        }
        await this.schedule(promotion);
      },
    });

    const orderItems = async (orderId: string) => (await orders.findById(orderId))?.items.map(i => String(i.productId)) ?? [];
    bus.subscribe('ProductChanged', 'storefront.revalidate-product', e => this.enqueue({ productIds: [e.payload.productId] }));
    bus.subscribe('OrderPlaced', 'storefront.revalidate-reserved-stock', e =>
      this.enqueue({ productIds: e.payload.items.map(i => i.productId) }),
    );
    bus.subscribe('OrderCancelled', 'storefront.revalidate-released-stock', async e =>
      this.enqueue({ productIds: await orderItems(e.payload.orderId) }),
    );
    bus.subscribe('RefundCompleted', 'storefront.revalidate-restocked', async e =>
      this.enqueue({ productIds: await orderItems(e.payload.orderId) }),
    );
    bus.subscribe('PromotionChanged', 'storefront.revalidate-offers', () => this.enqueue({ tags: [OFFERS_TAG] }));
    bus.subscribe('PromotionChanged', 'storefront.schedule-offer-boundaries', async e => {
      const promotion = await promotions.findById(e.payload.promotionId);
      if (promotion && promotion.version === e.payload.version) await this.schedule(promotion);
    });
  }

  /** Re-arms every active promotion's next boundary, e.g. after an in-memory queue lost its delayed jobs on restart. */
  async start(): Promise<void> {
    if (!this.promotions) return;
    for (const promotion of await this.promotions.findActive()) {
      await this.schedule(promotion).catch(err =>
        this.logger.warn({ err, promotionId: String(promotion._id) }, 'Could not schedule offer boundary'),
      );
    }
  }

  enqueue({ productIds = [], tags = [] }: RevalidateJob): Promise<void> {
    if (!this.jobs || (!productIds.length && !tags.length)) return Promise.resolve();
    const ids = [...new Set(productIds)].sort();
    const extra = [...new Set(tags)].sort();
    return this.jobs.enqueue(
      REVALIDATE_STOREFRONT_JOB,
      { productIds: ids, tags: extra },
      { delayMs: COALESCE_MS, jobId: `revalidate:${ids.join(',')}|${extra.join(',')}` },
    );
  }

  /**
   * Time passing fires no event, so a promotion's next start or stop (its window, or a recurring
   * day/hour window) is a delayed job that revalidates the offers tag and then arms the one after.
   * Boundaries beyond the horizon get a checkpoint that looks again, keeping every delay short.
   */
  async schedule(promotion: ScheduledPromotion): Promise<void> {
    if (!this.jobs) return;
    const now = this.clock();
    const promotionId = String(promotion._id);
    const at = nextBoundary(promotion, now);
    const later = [promotion.startsAt, promotion.endsAt].some(d => d && d.getTime() > now.getTime() + SCHEDULE_HORIZON_MS);
    const runAt = at ?? (later ? new Date(now.getTime() + SCHEDULE_HORIZON_MS) : undefined);
    if (!runAt) return;
    await this.jobs.enqueue<OfferBoundaryJob>(
      OFFER_BOUNDARY_JOB,
      { promotionId, version: promotion.version, revalidate: Boolean(at) },
      {
        delayMs: runAt.getTime() - now.getTime() + BOUNDARY_GRACE_MS,
        jobId: `offer-boundary:${promotionId}:${promotion.version}:${runAt.getTime()}`,
      },
    );
  }
}
