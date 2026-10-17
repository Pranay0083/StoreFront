import type { Logger } from 'pino';
import type { JobQueue } from '../../core/queue/job-queue';
import type { UserRepository } from '../auth/user.repository';
import type { CartRepository } from '../cart/cart.repository';
import type { ProductRepository } from '../catalog/product.repository';
import type { NotificationDispatcher } from './notification.service';

export const SCAN_ABANDONED_CARTS_JOB = 'notifications.scan-abandoned-carts';

export interface AbandonedCartOptions {
  idleHours: number;
  scanIntervalMs: number;
  frontendUrl: string;
  /** Carts older than this are stale; reminding about them reads as spam. */
  maxAgeDays?: number;
  batchSize?: number;
}

/**
 * Repeatable job that reminds signed-in shoppers about carts they stopped touching. The reminder
 * key includes the cart's last-modified time, so each version of a cart is reminded about at most
 * once and editing the cart re-arms the reminder.
 */
export class AbandonedCartReminder {
  constructor(
    private readonly carts: CartRepository,
    private readonly users: UserRepository,
    private readonly products: ProductRepository,
    private readonly dispatcher: NotificationDispatcher,
    private readonly logger: Logger,
    private readonly options: AbandonedCartOptions,
  ) {}

  register(jobs: JobQueue): void {
    jobs.register({ name: SCAN_ABANDONED_CARTS_JOB, queue: 'maintenance', attempts: 1, handler: () => this.scan().then(() => undefined) });
  }

  start(jobs: JobQueue): void {
    jobs
      .schedule(SCAN_ABANDONED_CARTS_JOB, {}, { everyMs: this.options.scanIntervalMs })
      .catch(err => this.logger.error({ err }, 'Could not schedule the abandoned-cart scan'));
  }

  async scan(now = new Date()): Promise<number> {
    const updatedBefore = new Date(now.getTime() - this.options.idleHours * 3_600_000);
    const updatedAfter = new Date(now.getTime() - (this.options.maxAgeDays ?? 7) * 86_400_000);
    const carts = await this.carts.findIdle({ updatedBefore, updatedAfter }, this.options.batchSize ?? 500);
    let queued = 0;
    for (const cart of carts) {
      const user = await this.users.findById(String(cart.userId));
      if (!user?.email || !cart.updatedAt) continue;
      const products = await this.products.findManyByIds(cart.items.map(i => String(i.productId)));
      const titles = new Map(products.map(p => [String(p._id), p.title]));
      const items = cart.items
        .filter(i => titles.has(String(i.productId)))
        .map(i => ({ title: titles.get(String(i.productId))!, qty: i.qty, size: i.size }));
      if (!items.length) continue;
      await this.dispatcher.notify({
        key: `abandoned-cart:${cart._id}:${cart.updatedAt.getTime()}`,
        template: 'abandonedCart',
        data: { name: user.name, items, cartUrl: `${this.options.frontendUrl}/cart` },
        to: { email: user.email },
      });
      queued++;
    }
    if (queued) this.logger.info({ queued }, 'Abandoned-cart reminders queued');
    return queued;
  }
}
