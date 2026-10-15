import type { Logger } from 'pino';
import { requestContext } from '../observability/request-context';
import type { PubSub } from '../pubsub';
import type { JobContext, JobQueue } from '../queue/job-queue';
import type { EventBus } from './event-bus';
import { DEFAULT_RELAY_OPTIONS, type OutboxRelay, type PollingRelayOptions } from './outbox-relay';
import { OutboxStore } from './outbox.store';
import type { OutboxRecord } from './outbox.model';

export const OUTBOX_HANDLER_JOB = 'outbox.handle-event';
export const OUTBOX_NOTIFY_CHANNEL = 'storefront:outbox:notify';

export interface OutboxHandlerJob {
  eventId: string;
  handlerId: string;
}

/**
 * Outbox relay that fans committed events out to one queue job per handler. Mongo stays the
 * source of truth: a record is only marked `dispatched` after its jobs are enqueued, and handler
 * jobs re-check `handlersDone`, so a crash at any point leads to redelivery, never loss.
 */
export class QueueOutboxRelay implements OutboxRelay {
  private timer?: NodeJS.Timeout;
  private running = false;
  private draining?: Promise<number>;
  private readonly options: PollingRelayOptions;

  constructor(
    private readonly store: OutboxStore,
    private readonly bus: EventBus,
    private readonly queue: JobQueue,
    private readonly pubsub: PubSub,
    private readonly logger: Logger,
    options: Partial<PollingRelayOptions> = {},
  ) {
    this.options = { ...DEFAULT_RELAY_OPTIONS, ...options };
    queue.register<OutboxHandlerJob>({
      name: OUTBOX_HANDLER_JOB,
      queue: 'events',
      attempts: this.options.maxAttempts,
      backoffMs: this.options.baseBackoffMs,
      concurrency: 8,
      handler: (job, ctx) => this.handle(job, ctx),
    });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.pubsub.subscribe(OUTBOX_NOTIFY_CHANNEL, () => this.kick());
    this.timer = setInterval(() => this.kick(), this.options.pollIntervalMs);
    this.timer.unref();
    this.kick();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    await this.draining;
  }

  /** Wakes whichever process runs the relay (often a separate worker) instead of waiting for its next poll. */
  notify(): void {
    this.pubsub.publish(OUTBOX_NOTIFY_CHANNEL, '1').catch(err => this.logger.warn({ err }, 'Outbox notify publish failed'));
    this.kick();
  }

  drain(now?: Date): Promise<number> {
    if (this.draining) return this.draining.then(() => this.drain(now));
    this.draining = this.dispatchLoop(now).finally(() => {
      this.draining = undefined;
    });
    return this.draining;
  }

  /** Runs one handler for one event; the queue owns retries and dead-lettering. */
  async handle({ eventId, handlerId }: OutboxHandlerJob, ctx: JobContext): Promise<void> {
    const record = await this.store.find(eventId);
    if (!record || record.handlersDone.includes(handlerId)) return;
    const subscription = this.bus.handlersFor(record.name as never).find(s => s.id === handlerId);
    if (!subscription) {
      this.logger.warn({ eventId, handlerId, event: record.name }, 'No subscriber for dispatched event handler');
      return;
    }
    await subscription.run(OutboxStore.toEvent(record), { attempt: ctx.attempt, maxAttempts: ctx.maxAttempts });
    await this.store.markHandlerDone(eventId, handlerId);
    const handlerIds = this.bus.handlersFor(record.name as never).map(s => s.id);
    await this.store.completeIfAllHandled(eventId, handlerIds, new Date());
  }

  private kick(): void {
    if (!this.running || this.draining) return;
    this.drain().catch(err => this.logger.error({ err }, 'Outbox dispatch failed'));
  }

  private async dispatchLoop(fixedNow?: Date): Promise<number> {
    let dispatched = 0;
    const seen = new Set<string>();
    for (;;) {
      const now = fixedNow ?? new Date();
      const record = await this.store.claimNext(now, this.options.leaseMs, [...seen]);
      if (!record) return dispatched;
      seen.add(record._id);
      dispatched++;
      await this.dispatch(record, now);
    }
  }

  private async dispatch(record: OutboxRecord, now: Date): Promise<void> {
    const pending = this.bus.handlersFor(record.name as never).filter(s => !record.handlersDone.includes(s.id));
    if (!pending.length) return this.store.complete(record._id, now);
    try {
      await requestContext.run({ requestId: record.requestId ?? record._id }, async () => {
        for (const sub of pending) {
          await this.queue.enqueue<OutboxHandlerJob>(
            OUTBOX_HANDLER_JOB,
            { eventId: record._id, handlerId: sub.id },
            { jobId: `evt:${record._id}:${sub.id}` },
          );
        }
      });
      await this.store.markDispatched(record._id, now);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.warn({ err, eventId: record._id }, 'Could not enqueue event handlers; will retry');
      await this.store.reschedule(record._id, error, new Date(now.getTime() + this.options.baseBackoffMs * 2 ** (record.attempts - 1)));
    }
  }
}
