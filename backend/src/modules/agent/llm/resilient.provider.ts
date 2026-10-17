import { CircuitBreaker } from '../../../core/resilience/circuit-breaker';
import { isTransientError, withRetry } from '../../../core/resilience/retry';
import type { GenerateOptions, LLMProvider, LLMRequest, LLMResponse } from './llm.types';

export interface ResilienceOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  breaker?: CircuitBreaker;
  sleep?: (ms: number) => Promise<void>;
}

const isAbort = (err: unknown) =>
  (err as { name?: string })?.name === 'AbortError' || (err as { name?: string })?.name === 'APIUserAbortError';

/**
 * Decorator adding retry with backoff and a circuit breaker. A streamed call is only retried
 * while no text has reached the caller, so a client never sees duplicated tokens.
 */
export class ResilientLLMProvider implements LLMProvider {
  readonly breaker: CircuitBreaker;

  constructor(
    private readonly inner: LLMProvider,
    private readonly options: ResilienceOptions = {},
  ) {
    this.breaker =
      options.breaker ??
      new CircuitBreaker({
        name: `llm:${inner.name}`,
        failureThreshold: 5,
        resetTimeoutMs: 30_000,
        isFailure: err => isTransientError(err) && !isAbort(err),
      });
  }

  get name() {
    return this.inner.name;
  }

  get model() {
    return this.inner.model;
  }

  generate(request: LLMRequest, options: GenerateOptions = {}): Promise<LLMResponse> {
    let streamed = false;
    const tracked: GenerateOptions = options.onText
      ? {
          ...options,
          onText: delta => {
            streamed = true;
            options.onText!(delta);
          },
        }
      : options;
    return withRetry(() => this.breaker.execute(() => this.inner.generate(request, tracked)), {
      retries: this.options.retries ?? 2,
      baseDelayMs: this.options.baseDelayMs ?? 500,
      maxDelayMs: this.options.maxDelayMs ?? 4_000,
      shouldRetry: err => !streamed && !isAbort(err) && !options.signal?.aborted && isTransientError(err),
      sleep: this.options.sleep,
    });
  }
}
