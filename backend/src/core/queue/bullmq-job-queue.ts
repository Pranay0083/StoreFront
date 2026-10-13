import { Queue, Worker, type Job } from 'bullmq';
import type { Logger } from 'pino';
import { pingRedis, type Redis } from '../redis';
import type { DeadLetterStore } from './dead-letter.store';
import {
  DEFAULT_ATTEMPTS,
  DEFAULT_BACKOFF_MS,
  QUEUE_NAMES,
  UnknownJobError,
  safeJobId,
  type EnqueueOptions,
  type JobDefinition,
  type JobEnvelope,
  type JobQueue,
  type QueueCounts,
  type QueueName,
} from './job-queue';
import { deadLetter, envelope, runJob, type JobObserver } from './job-runner';

export interface BullMqJobQueueOptions {
  prefix?: string;
  observer?: JobObserver;
}

/** Redis-backed queue: jobs survive restarts and are shared by any number of worker processes. */
export class BullMqJobQueue implements JobQueue {
  readonly kind = 'bullmq' as const;
  private readonly definitions = new Map<string, JobDefinition>();
  private readonly queues = new Map<QueueName, Queue>();
  private workers: Worker[] = [];
  private readonly prefix: string;

  constructor(
    private readonly connection: Redis,
    private readonly deadLetters: DeadLetterStore,
    private readonly logger: Logger,
    private readonly options: BullMqJobQueueOptions = {},
  ) {
    this.prefix = options.prefix ?? 'storefront';
  }

  register<T>(definition: JobDefinition<T>): void {
    this.definitions.set(definition.name, definition as JobDefinition);
  }

  definition(name: string): JobDefinition | undefined {
    return this.definitions.get(name);
  }

  async enqueue<T>(name: string, data: T, options: EnqueueOptions = {}): Promise<void> {
    const definition = this.require(name);
    await this.queue(definition.queue).add(name, envelope(data), {
      ...(options.jobId && { jobId: safeJobId(options.jobId) }),
      ...(options.delayMs && { delay: options.delayMs }),
      attempts: definition.attempts ?? DEFAULT_ATTEMPTS,
      backoff: { type: 'exponential', delay: definition.backoffMs ?? DEFAULT_BACKOFF_MS },
      removeOnComplete: { age: 3_600, count: 1_000 },
      removeOnFail: { age: 24 * 3_600, count: 1_000 },
    });
  }

  async schedule<T>(name: string, data: T, every: { everyMs: number }): Promise<void> {
    const definition = this.require(name);
    await this.queue(definition.queue).upsertJobScheduler(
      `schedule_${name}`,
      { every: every.everyMs },
      { name, data: envelope(data), opts: { attempts: definition.attempts ?? 1, removeOnComplete: true, removeOnFail: { count: 100 } } },
    );
  }

  async start(): Promise<void> {
    if (this.workers.length) return;
    const byQueue = new Map<QueueName, JobDefinition[]>();
    for (const d of this.definitions.values()) byQueue.set(d.queue, [...(byQueue.get(d.queue) ?? []), d]);
    for (const [queueName, definitions] of byQueue) {
      const worker = new Worker<JobEnvelope>(queueName, job => this.process(job), {
        connection: this.connection,
        prefix: this.prefix,
        concurrency: Math.max(1, ...definitions.map(d => d.concurrency ?? 1)),
      });
      worker.on('failed', (job, err) => void this.onFailed(job, err));
      worker.on('error', err => this.logger.error({ err, queue: queueName }, 'Queue worker error'));
      this.workers.push(worker);
    }
    await Promise.all(this.workers.map(w => w.waitUntilReady()));
  }

  async stop(): Promise<void> {
    await Promise.all(this.workers.map(w => w.close()));
    this.workers = [];
    await Promise.all([...this.queues.values()].map(q => q.close()));
    this.queues.clear();
  }

  async counts(): Promise<QueueCounts[]> {
    return Promise.all(
      QUEUE_NAMES.map(async queue => {
        const c = await this.queue(queue).getJobCounts('waiting', 'prioritized', 'paused', 'active', 'delayed', 'failed');
        return {
          queue,
          waiting: (c.waiting ?? 0) + (c.prioritized ?? 0) + (c.paused ?? 0),
          active: c.active ?? 0,
          delayed: c.delayed ?? 0,
          failed: c.failed ?? 0,
        };
      }),
    );
  }

  ping(): Promise<boolean> {
    return pingRedis(this.connection);
  }

  private require(name: string): JobDefinition {
    const definition = this.definitions.get(name);
    if (!definition) throw new UnknownJobError(name);
    return definition;
  }

  private queue(name: QueueName): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, { connection: this.connection, prefix: this.prefix });
      this.queues.set(name, queue);
    }
    return queue;
  }

  private async process(job: Job<JobEnvelope>): Promise<void> {
    const definition = this.require(job.name);
    const started = Date.now();
    await runJob(definition, job.data, {
      jobId: job.id ?? 'unknown',
      name: job.name,
      attempt: job.attemptsMade + 1,
      maxAttempts: job.opts.attempts ?? 1,
    });
    this.options.observer?.onCompleted?.(job.name, Date.now() - started);
  }

  private async onFailed(job: Job<JobEnvelope> | undefined, error: Error): Promise<void> {
    if (!job) return;
    const final = job.attemptsMade >= (job.opts.attempts ?? 1);
    this.options.observer?.onFailed?.(job.name, final);
    if (!final) {
      this.logger.warn({ err: error, job: job.name, jobId: job.id, attempt: job.attemptsMade }, 'Job failed, will retry');
      return;
    }
    const definition = this.definitions.get(job.name);
    await deadLetter(this.deadLetters, this.logger, {
      queue: definition?.queue ?? 'unknown',
      name: job.name,
      jobId: job.id ?? 'unknown',
      job: job.data,
      error,
      attempts: job.attemptsMade,
    });
  }
}
