import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
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
} from './job-queue';
import { deadLetter, envelope, runJob, type JobObserver } from './job-runner';

interface PendingJob {
  id: string;
  name: string;
  job: JobEnvelope;
  attempt: number;
  runAt: number;
}

export interface MemoryJobQueueOptions {
  clock?: () => number;
  observer?: JobObserver;
}

/**
 * In-process queue for single-instance deployments and tests: same retry, backoff, delay,
 * dedupe and dead-letter semantics as the BullMQ queue, without persistence across restarts.
 */
export class MemoryJobQueue implements JobQueue {
  readonly kind = 'memory' as const;
  private readonly definitions = new Map<string, JobDefinition>();
  private pending: PendingJob[] = [];
  private readonly schedules = new Map<string, NodeJS.Timeout>();
  private running = false;
  private wakeTimer?: NodeJS.Timeout;
  private draining?: Promise<number>;
  private readonly active = new Map<string, number>();
  private readonly failed = new Map<string, number>();
  private readonly clock: () => number;

  constructor(
    private readonly deadLetters: DeadLetterStore,
    private readonly logger: Logger,
    private readonly options: MemoryJobQueueOptions = {},
  ) {
    this.clock = options.clock ?? Date.now;
  }

  register<T>(definition: JobDefinition<T>): void {
    this.definitions.set(definition.name, definition as JobDefinition);
  }

  definition(name: string): JobDefinition | undefined {
    return this.definitions.get(name);
  }

  async enqueue<T>(name: string, data: T, options: EnqueueOptions = {}): Promise<void> {
    if (!this.definitions.has(name)) throw new UnknownJobError(name);
    const id = options.jobId ? safeJobId(options.jobId) : randomUUID();
    if (options.jobId && this.pending.some(p => p.id === id)) return;
    this.pending.push({ id, name, job: envelope(data), attempt: 1, runAt: this.clock() + (options.delayMs ?? 0) });
    this.wake();
  }

  async schedule<T>(name: string, data: T, every: { everyMs: number }): Promise<void> {
    if (!this.definitions.has(name)) throw new UnknownJobError(name);
    clearInterval(this.schedules.get(name));
    const timer = setInterval(() => {
      if (this.running) void this.enqueue(name, data, { jobId: `schedule:${name}` });
    }, every.everyMs);
    timer.unref();
    this.schedules.set(name, timer);
  }

  async start(): Promise<void> {
    this.running = true;
    this.wake();
  }

  async stop(): Promise<void> {
    this.running = false;
    for (const timer of this.schedules.values()) clearInterval(timer);
    this.schedules.clear();
    clearTimeout(this.wakeTimer);
    await this.draining;
  }

  /** Runs every job that is due now, including retries that become due while draining. */
  drain(): Promise<number> {
    if (this.draining) return this.draining.then(() => this.drain());
    this.draining = this.drainLoop().finally(() => {
      this.draining = undefined;
      this.armTimer();
    });
    return this.draining;
  }

  async counts(): Promise<QueueCounts[]> {
    const now = this.clock();
    return QUEUE_NAMES.map(queue => {
      const jobs = this.pending.filter(p => this.definitions.get(p.name)?.queue === queue);
      return {
        queue,
        waiting: jobs.filter(j => j.runAt <= now).length,
        delayed: jobs.filter(j => j.runAt > now).length,
        active: this.active.get(queue) ?? 0,
        failed: this.failed.get(queue) ?? 0,
      };
    });
  }

  async ping(): Promise<boolean> {
    return true;
  }

  get size(): number {
    return this.pending.length + [...this.active.values()].reduce((a, b) => a + b, 0);
  }

  private bump(map: Map<string, number>, queue: string, delta: number): void {
    map.set(queue, (map.get(queue) ?? 0) + delta);
  }

  private wake(): void {
    if (!this.running) return;
    if (this.draining) return;
    setImmediate(() => {
      if (this.running && !this.draining) void this.drain();
    });
  }

  private armTimer(): void {
    clearTimeout(this.wakeTimer);
    if (!this.running || !this.pending.length) return;
    const next = Math.min(...this.pending.map(p => p.runAt));
    this.wakeTimer = setTimeout(() => this.wake(), Math.max(0, next - this.clock()));
    this.wakeTimer.unref();
  }

  private async drainLoop(): Promise<number> {
    let processed = 0;
    for (;;) {
      const now = this.clock();
      const index = this.pending.findIndex(p => p.runAt <= now);
      if (index === -1) return processed;
      const [job] = this.pending.splice(index, 1);
      processed++;
      await this.process(job);
    }
  }

  private async process(pending: PendingJob): Promise<void> {
    const definition = this.definitions.get(pending.name)!;
    const maxAttempts = definition.attempts ?? DEFAULT_ATTEMPTS;
    this.bump(this.active, definition.queue, 1);
    const started = this.clock();
    try {
      await runJob(definition, pending.job, { jobId: pending.id, name: pending.name, attempt: pending.attempt, maxAttempts });
      this.options.observer?.onCompleted?.(pending.name, this.clock() - started);
    } catch (error) {
      const final = pending.attempt >= maxAttempts;
      this.options.observer?.onFailed?.(pending.name, final);
      if (final) {
        this.bump(this.failed, definition.queue, 1);
        await deadLetter(this.deadLetters, this.logger, {
          queue: definition.queue,
          name: pending.name,
          jobId: pending.id,
          job: pending.job,
          error,
          attempts: pending.attempt,
        });
      } else {
        const backoff = (definition.backoffMs ?? DEFAULT_BACKOFF_MS) * 2 ** (pending.attempt - 1);
        this.logger.warn({ err: error, job: pending.name, jobId: pending.id, attempt: pending.attempt }, 'Job failed, will retry');
        this.pending.push({ ...pending, attempt: pending.attempt + 1, runAt: this.clock() + backoff });
      }
    } finally {
      this.bump(this.active, definition.queue, -1);
    }
  }
}
