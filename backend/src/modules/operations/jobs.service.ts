import type { OutboxRelay } from '../../core/events/outbox-relay';
import type { OutboxStore } from '../../core/events/outbox.store';
import { NotFoundError } from '../../core/errors';
import { logger } from '../../core/logger';
import type { DeadLetterStore } from '../../core/queue/dead-letter.store';
import type { JobQueue, QueueCounts } from '../../core/queue/job-queue';

export type DeadLetterSource = 'job' | 'event';

export interface DeadLetterView {
  source: DeadLetterSource;
  id: string;
  name: string;
  queue: string;
  error: string;
  attempts: number;
  failedAt: Date | null;
  requestId?: string;
  data: unknown;
}

export interface JobsOverview {
  backend: JobQueue['kind'];
  queues: QueueCounts[];
  outbox: Record<string, number>;
  deadLetters: { jobs: number; events: number };
}

/**
 * Operator view over both places work can get stuck: queue jobs that exhausted their retries and
 * outbox events the polling relay gave up on. Retrying puts the work back with a fresh budget.
 */
export class JobsAdminService {
  constructor(
    private readonly queue: JobQueue,
    private readonly deadLetters: DeadLetterStore,
    private readonly outbox: OutboxStore,
    private readonly relay: OutboxRelay,
  ) {}

  async overview(): Promise<JobsOverview> {
    const [queues, outbox, jobs, events] = await Promise.all([
      this.queue.counts(),
      this.outbox.countByStatus(),
      this.deadLetters.count(),
      this.outbox.listDead(1_000).then(r => r.length),
    ]);
    return { backend: this.queue.kind, queues, outbox, deadLetters: { jobs, events } };
  }

  async list(filter: { source?: DeadLetterSource; limit: number }): Promise<DeadLetterView[]> {
    const [jobs, events] = await Promise.all([
      filter.source === 'event' ? [] : this.deadLetters.list({ limit: filter.limit }),
      filter.source === 'job' ? [] : this.outbox.listDead(filter.limit),
    ]);
    const views: DeadLetterView[] = [
      ...jobs.map(j => ({
        source: 'job' as const,
        id: String(j._id),
        name: j.name,
        queue: j.queue,
        error: j.error,
        attempts: j.attempts,
        failedAt: j.failedAt,
        ...(j.requestId && { requestId: j.requestId }),
        data: j.data,
      })),
      ...events.map(e => ({
        source: 'event' as const,
        id: e._id,
        name: e.name,
        queue: 'outbox',
        error: e.lastError ?? 'unknown error',
        attempts: e.attempts,
        failedAt: e.processedAt ?? null,
        ...(e.requestId && { requestId: e.requestId }),
        data: e.payload,
      })),
    ];
    return views.sort((a, b) => (b.failedAt?.getTime() ?? 0) - (a.failedAt?.getTime() ?? 0)).slice(0, filter.limit);
  }

  async retry(source: DeadLetterSource, id: string, actorId: string): Promise<void> {
    if (source === 'event') {
      if (!(await this.outbox.revive(id))) throw new NotFoundError('Dead-lettered event not found');
      this.relay.notify();
    } else {
      const entry = await this.deadLetters.find(id);
      if (!entry) throw new NotFoundError('Dead-lettered job not found');
      await this.queue.enqueue(entry.name, entry.data);
      await this.deadLetters.remove(id);
    }
    logger.info({ source, id, actorId }, 'Dead-lettered work re-queued');
  }

  async discard(source: DeadLetterSource, id: string, actorId: string): Promise<void> {
    const removed = source === 'event' ? await this.outbox.discard(id) : await this.deadLetters.remove(id);
    if (!removed) throw new NotFoundError('Dead-lettered item not found');
    logger.warn({ source, id, actorId }, 'Dead-lettered work discarded');
  }
}
