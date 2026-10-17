import type { Logger } from 'pino';
import { requestContext } from '../observability/request-context';
import type { DeadLetterStore } from './dead-letter.store';
import type { JobContext, JobDefinition, JobEnvelope, JobMeta } from './job-queue';

export function envelope<T>(data: T): JobEnvelope<T> {
  const meta: JobMeta = { enqueuedAt: new Date().toISOString() };
  const requestId = requestContext.requestId();
  if (requestId) meta.requestId = requestId;
  return { data, meta };
}

export interface JobObserver {
  onCompleted?(name: string, durationMs: number): void;
  onFailed?(name: string, final: boolean): void;
}

/** Runs a handler inside the originating request's correlation context. */
export function runJob(definition: JobDefinition, job: JobEnvelope, ctx: Omit<JobContext, 'requestId'>): Promise<void> {
  const requestId = job.meta?.requestId;
  return requestContext.run({ requestId: requestId ?? ctx.jobId, jobId: ctx.jobId }, () =>
    definition.handler(job.data, { ...ctx, ...(requestId && { requestId }) }),
  );
}

export async function deadLetter(
  store: DeadLetterStore,
  logger: Logger,
  entry: { queue: string; name: string; jobId: string; job: JobEnvelope; error: unknown; attempts: number },
): Promise<void> {
  const error = entry.error instanceof Error ? entry.error.message : String(entry.error);
  logger.error({ job: entry.name, jobId: entry.jobId, attempts: entry.attempts, error }, 'Job moved to the dead-letter queue');
  try {
    await store.record({
      queue: entry.queue,
      name: entry.name,
      jobId: entry.jobId,
      data: entry.job.data,
      error,
      attempts: entry.attempts,
      ...(entry.job.meta?.requestId && { requestId: entry.job.meta.requestId }),
    });
  } catch (err) {
    logger.error({ err, job: entry.name, jobId: entry.jobId }, 'Failed to record dead-lettered job');
  }
}
