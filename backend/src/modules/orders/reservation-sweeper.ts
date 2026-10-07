import type { Logger } from 'pino';
import type { OrdersService } from './orders.service';

/** Releases stock held by unpaid orders once their payment window passes. Swappable for a queue-scheduled job. */
export interface ReservationExpiryScheduler {
  start(): void;
  stop(): Promise<void>;
  sweep(now?: Date): Promise<number>;
}

export class IntervalReservationSweeper implements ReservationExpiryScheduler {
  private timer?: NodeJS.Timeout;
  private running?: Promise<number>;

  constructor(
    private readonly orders: OrdersService,
    private readonly intervalMs: number,
    private readonly logger: Logger,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (!this.running) this.sweep().catch(err => this.logger.error({ err }, 'Reservation sweep failed'));
    }, this.intervalMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.running;
  }

  sweep(now = new Date()): Promise<number> {
    this.running = this.orders.sweepExpiredReservations(now).finally(() => {
      this.running = undefined;
    });
    return this.running;
  }
}
