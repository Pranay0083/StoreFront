export interface RetryOptions {
  /** Attempts after the first one. */
  retries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** `full` jitter spreads synchronized retries from many callers across the whole backoff window. */
  jitter?: 'full' | 'none';
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** Exponential backoff for the n-th retry (1-based), capped and optionally jittered. */
export function backoffDelay(retry: number, options: Pick<RetryOptions, 'baseDelayMs' | 'maxDelayMs' | 'jitter' | 'random'>): number {
  const ceiling = Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** Math.max(0, retry - 1));
  if (options.jitter === 'none') return ceiling;
  return Math.floor((options.random ?? Math.random)() * ceiling);
}

export async function withRetry<T>(fn: (attempt: number) => Promise<T>, options: RetryOptions): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      const retry = attempt;
      if (retry > options.retries || (options.shouldRetry && !options.shouldRetry(err, attempt))) throw err;
      const delay = backoffDelay(retry, options);
      options.onRetry?.(err, attempt, delay);
      await sleep(delay);
    }
  }
}

/** Decorator form: returns a function with the same signature whose calls are retried. */
export function retrying<A extends unknown[], T>(fn: (...args: A) => Promise<T>, options: RetryOptions): (...args: A) => Promise<T> {
  return (...args: A) => withRetry(() => fn(...args), options);
}

const TRANSIENT_NETWORK_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'EPIPE', 'UND_ERR_SOCKET']);

/** True for failures where the request most likely never reached the remote side. */
export function isConnectionError(err: unknown): boolean {
  const code = (err as { code?: string; cause?: { code?: string } })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
  return typeof code === 'string' && TRANSIENT_NETWORK_CODES.has(code);
}

/** Connection errors, throttling and 5xx responses: worth retrying for idempotent calls. */
export function isTransientError(err: unknown): boolean {
  if (isConnectionError(err)) return true;
  const status = (err as { statusCode?: number; status?: number })?.statusCode ?? (err as { status?: number })?.status;
  return typeof status === 'number' && (status === 429 || status >= 500);
}
