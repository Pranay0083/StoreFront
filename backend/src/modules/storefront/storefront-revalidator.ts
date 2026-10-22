import type { EventBus } from '../../core/events/event-bus';
import type { logger as appLogger } from '../../core/logger';
import { UnrecoverableJobError, type JobQueue } from '../../core/queue/job-queue';
import type { ProductRepository } from '../catalog/product.repository';
import type { OrderRepository } from '../orders/order.repository';

export const REVALIDATE_STOREFRONT_JOB = 'storefront.revalidate';
/** Coalesces bursts (e.g. a run of checkouts on one product) into a single revalidation. */
const COALESCE_MS = 5_000;

export interface StorefrontRevalidatorConfig {
  url: string;
  secret: string;
}

type Logger = Pick<typeof appLogger, 'debug' | 'warn'>;

/** Tells the Next.js storefront which cached pages are stale; best-effort, pages also expire on their own. */
export class StorefrontRevalidator {
  constructor(
    private readonly config: StorefrontRevalidatorConfig,
    private readonly products: Pick<ProductRepository, 'findById'>,
    private readonly logger: Logger,
    private readonly http: typeof fetch = fetch,
  ) {}

  async tagsFor(productIds: string[]): Promise<string[]> {
    const tags = new Set(['products']);
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

  register(bus: EventBus, jobs: JobQueue, orders: Pick<OrderRepository, 'findById'>): void {
    jobs.register<{ productIds: string[] }>({
      name: REVALIDATE_STOREFRONT_JOB,
      queue: 'maintenance',
      attempts: 3,
      backoffMs: 5_000,
      handler: async ({ productIds }) => {
        const tags = await this.tagsFor(productIds);
        await this.revalidate(tags);
        this.logger.debug({ tags }, 'Storefront cache revalidated');
      },
    });
    const enqueue = (productIds: string[]) => {
      if (!productIds.length) return Promise.resolve();
      const ids = [...new Set(productIds)].sort();
      return jobs.enqueue(REVALIDATE_STOREFRONT_JOB, { productIds: ids }, { delayMs: COALESCE_MS, jobId: `revalidate:${ids.join(',')}` });
    };
    const orderItems = async (orderId: string) => (await orders.findById(orderId))?.items.map(i => String(i.productId)) ?? [];

    bus.subscribe('ProductChanged', 'storefront.revalidate-product', e => enqueue([e.payload.productId]));
    bus.subscribe('OrderPlaced', 'storefront.revalidate-reserved-stock', e => enqueue(e.payload.items.map(i => i.productId)));
    bus.subscribe('OrderCancelled', 'storefront.revalidate-released-stock', async e => enqueue(await orderItems(e.payload.orderId)));
    bus.subscribe('RefundCompleted', 'storefront.revalidate-restocked', async e => enqueue(await orderItems(e.payload.orderId)));
  }
}
