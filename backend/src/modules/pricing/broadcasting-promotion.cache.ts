import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { PubSub } from '../../core/pubsub';
import { ActivePromotionCache, type ActivePromotionSource } from './active-promotion.cache';

export const PROMOTIONS_CHANGED_CHANNEL = 'storefront:pricing:promotions-changed';

/**
 * Each API instance compiles active promotions into its own memory. When one instance changes a
 * promotion it invalidates locally and broadcasts, so every other instance drops its copy too
 * instead of serving the old price until its TTL runs out.
 */
export class BroadcastingPromotionCache extends ActivePromotionCache {
  private readonly origin = randomUUID();
  /** Resolves once this instance is subscribed and will hear peers' invalidations. */
  readonly ready: Promise<void>;

  constructor(
    source: ActivePromotionSource,
    private readonly pubsub: PubSub,
    private readonly logger: Logger,
    ttlMs?: number,
  ) {
    super(source, ttlMs);
    this.ready = pubsub
      .subscribe(PROMOTIONS_CHANGED_CHANNEL, origin => {
        if (origin !== this.origin) super.invalidate();
      })
      .catch(err => this.logger.error({ err }, 'Could not subscribe to promotion invalidations'));
  }

  override invalidate(): void {
    super.invalidate();
    this.pubsub
      .publish(PROMOTIONS_CHANGED_CHANNEL, this.origin)
      .catch(err => this.logger.warn({ err }, 'Promotion invalidation broadcast failed'));
  }
}
