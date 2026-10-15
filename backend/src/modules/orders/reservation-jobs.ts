import type { Logger } from 'pino';
import type { EventBus } from '../../core/events/event-bus';
import type { JobQueue } from '../../core/queue/job-queue';
import type { OrderRepository } from './order.repository';
import type { OrdersService } from './orders.service';
import type { ReservationExpiryScheduler } from './reservation-sweeper';

export const EXPIRE_RESERVATION_JOB = 'orders.expire-reservation';
export const SWEEP_RESERVATIONS_JOB = 'orders.sweep-reservations';

/** Fired a moment after the window closes so it never races a payment captured on the last second. */
const GRACE_MS = 1_000;

export interface ReservationJobOptions {
  ttlMs: number;
  sweepIntervalMs: number;
}

/**
 * Each unpaid order gets a delayed job that expires exactly its own reservation; a slow periodic
 * sweep remains as a safety net for jobs lost to a Redis flush or orders placed before deploy.
 */
export class QueuedReservationScheduler implements ReservationExpiryScheduler {
  constructor(
    private readonly orders: OrdersService,
    private readonly orderRecords: OrderRepository,
    private readonly jobs: JobQueue,
    private readonly logger: Logger,
    private readonly options: ReservationJobOptions,
    private readonly clock: () => number = Date.now,
  ) {}

  register(bus: EventBus): void {
    this.jobs.register<{ orderId: string }>({
      name: EXPIRE_RESERVATION_JOB,
      queue: 'maintenance',
      attempts: 5,
      backoffMs: 5_000,
      handler: ({ orderId }) => this.expire(orderId),
    });
    this.jobs.register({
      name: SWEEP_RESERVATIONS_JOB,
      queue: 'maintenance',
      attempts: 1,
      handler: () => this.sweep().then(() => undefined),
    });
    bus.subscribe('OrderPlaced', 'orders.schedule-reservation-expiry', event =>
      this.scheduleExpiry(event.payload.orderId, this.options.ttlMs + GRACE_MS),
    );
  }

  start(): void {
    this.jobs
      .schedule(SWEEP_RESERVATIONS_JOB, {}, { everyMs: this.options.sweepIntervalMs })
      .catch(err => this.logger.error({ err }, 'Could not schedule the reservation sweep'));
  }

  async stop(): Promise<void> {}

  sweep(now = new Date()): Promise<number> {
    return this.orders.sweepExpiredReservations(now);
  }

  async expire(orderId: string): Promise<void> {
    const order = await this.orderRecords.findById(orderId);
    if (!order || order.status !== 'created') return;
    const remaining = order.reservedUntil ? order.reservedUntil.getTime() - this.clock() : 0;
    if (remaining > 0) return this.scheduleExpiry(orderId, remaining + GRACE_MS);
    await this.orders.expireReservation(orderId);
  }

  private scheduleExpiry(orderId: string, delayMs: number): Promise<void> {
    return this.jobs.enqueue(EXPIRE_RESERVATION_JOB, { orderId }, { jobId: `expire:${orderId}:${Math.ceil(delayMs / 1000)}`, delayMs });
  }
}
