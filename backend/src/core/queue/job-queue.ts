/** Queues group jobs that share a worker pool, so a backlog of e-mails never delays payment processing. */
export const QUEUE_NAMES = ['events', 'payments', 'notifications', 'maintenance'] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

export interface JobContext {
  jobId: string;
  name: string;
  /** 1-based attempt number. */
  attempt: number;
  maxAttempts: number;
  requestId?: string;
}

export type JobHandler<T = unknown> = (data: T, ctx: JobContext) => Promise<void>;

export interface JobDefinition<T = unknown> {
  name: string;
  queue: QueueName;
  handler: JobHandler<T>;
  /** Total attempts before the job is dead-lettered. */
  attempts?: number;
  /** Base delay of the exponential backoff between attempts. */
  backoffMs?: number;
  concurrency?: number;
}

export interface EnqueueOptions {
  delayMs?: number;
  /** Deduplicates: a job with the same id that is still queued is not enqueued twice. */
  jobId?: string;
}

export interface QueueCounts {
  queue: QueueName;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
}

/** Correlation metadata carried with every job so its logs join the request that caused it. */
export interface JobMeta {
  requestId?: string;
  enqueuedAt: string;
}

export interface JobEnvelope<T = unknown> {
  data: T;
  meta: JobMeta;
}

/**
 * Producer + consumer facade. Every process registers all job definitions (so it can enqueue
 * them); only processes that call `start()` consume. Implementations: in-memory and BullMQ.
 */
export interface JobQueue {
  readonly kind: 'memory' | 'bullmq';
  register<T>(definition: JobDefinition<T>): void;
  enqueue<T>(name: string, data: T, options?: EnqueueOptions): Promise<void>;
  /** Idempotent: re-registering a schedule replaces it rather than adding a second one. */
  schedule<T>(name: string, data: T, every: { everyMs: number }): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  counts(): Promise<QueueCounts[]>;
  ping(): Promise<boolean>;
  definition(name: string): JobDefinition | undefined;
}

export const DEFAULT_ATTEMPTS = 5;
export const DEFAULT_BACKOFF_MS = 2_000;

export class UnknownJobError extends Error {
  constructor(name: string) {
    super(`No job definition registered for "${name}"`);
  }
}

/** Some backends reserve ':' in custom ids. */
export const safeJobId = (id: string) => id.replace(/:/g, '_');
