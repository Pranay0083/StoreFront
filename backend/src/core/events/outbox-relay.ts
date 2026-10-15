import type { Logger } from 'pino';
import { requestContext } from '../observability/request-context';
import type { EventBus } from './event-bus';
import { OutboxStore } from './outbox.store';
import type { OutboxRecord } from './outbox.model';

/** Delivers committed outbox events to subscribers. Swappable (e.g. for a BullMQ-backed relay). */
export interface OutboxRelay {
  start(): void;
  stop(): Promise<void>;
  /** Hint that new events were committed; a running relay drains promptly instead of waiting for the next poll. */
  notify(): void;
  /** Processes every event that is due at `now`; returns how many events were attempted. */
  drain(now?: Date): Promise<number>;
}

export interface PollingRelayOptions {
  pollIntervalMs: number;
  leaseMs: number;
  maxAttempts: number;
  baseBackoffMs: number;
}

export const DEFAULT_RELAY_OPTIONS: PollingRelayOptions = {
  pollIntervalMs: 1_000,
  leaseMs: 30_000,
  maxAttempts: 8,
  baseBackoffMs: 2_000,
};

export class PollingOutboxRelay implements OutboxRelay {
  private timer?: NodeJS.Timeout;
  private running = false;
  private draining?: Promise<number>;
  private readonly options: PollingRelayOptions;

  constructor(
    private readonly store: OutboxStore,
    private readonly bus: EventBus,
    private readonly logger: Logger,
    options: Partial<PollingRelayOptions> = {},
  ) {
    this.options = { ...DEFAULT_RELAY_OPTIONS, ...options };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => this.notify(), this.options.pollIntervalMs);
    this.timer.unref();
    this.notify();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    await this.draining;
  }

  notify(): void {
    if (!this.running || this.draining) return;
    this.drain().catch(err => this.logger.error({ err }, 'Outbox relay drain failed'));
  }

  drain(now?: Date): Promise<number> {
    if (this.draining) return this.draining.then(() => this.drain(now));
    this.draining = this.drainLoop(now).finally(() => {
      this.draining = undefined;
    });
    return this.draining;
  }

  backoff(attempt: number): number {
    return this.options.baseBackoffMs * 2 ** Math.max(0, attempt - 1);
  }

  private async drainLoop(fixedNow?: Date): Promise<number> {
    let processed = 0;
    const claimedThisRun = new Set<string>();
    for (;;) {
      const now = fixedNow ?? new Date();
      const record = await this.store.claimNext(now, this.options.leaseMs, [...claimedThisRun]);
      if (!record) return processed;
      claimedThisRun.add(record._id);
      processed++;
      await this.deliver(record, now);
    }
  }

  private async deliver(record: OutboxRecord, now: Date): Promise<void> {
    const event = OutboxStore.toEvent(record);
    const ctx = { attempt: record.attempts, maxAttempts: this.options.maxAttempts };
    const errors: string[] = [];
    for (const sub of this.bus.handlersFor(event.name)) {
      if (record.handlersDone.includes(sub.id)) continue;
      try {
        await requestContext.run({ requestId: record.requestId ?? record._id }, () => sub.run(event, ctx));
        await this.store.markHandlerDone(record._id, sub.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`${sub.id}: ${message}`);
        this.logger.warn({ err, eventId: record._id, event: record.name, handler: sub.id, attempt: ctx.attempt }, 'Event handler failed');
      }
    }
    if (!errors.length) return this.store.complete(record._id, now);
    const error = errors.join('; ');
    if (record.attempts >= this.options.maxAttempts) {
      this.logger.error({ eventId: record._id, event: record.name, error }, 'Event moved to dead letter after max attempts');
      return this.store.deadLetter(record._id, error, now);
    }
    await this.store.reschedule(record._id, error, new Date(now.getTime() + this.backoff(record.attempts)));
  }
}
