import { AppError } from '../errors';

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerOptions {
  name: string;
  /** Consecutive failures that trip the breaker. */
  failureThreshold: number;
  /** How long the breaker stays open before letting a trial call through. */
  resetTimeoutMs: number;
  halfOpenMaxCalls?: number;
  /** Errors that prove the dependency is healthy (e.g. a 4xx rejection) should not count as failures. */
  isFailure?: (err: unknown) => boolean;
  onStateChange?: (state: CircuitState, name: string) => void;
  clock?: () => number;
}

export class CircuitOpenError extends AppError {
  constructor(
    readonly circuit: string,
    readonly retryAfterMs: number,
  ) {
    super(503, `${circuit} is temporarily unavailable, please try again shortly`, undefined, 'CIRCUIT_OPEN');
  }
}

/**
 * Closed → open after `failureThreshold` consecutive failures; open → half-open after
 * `resetTimeoutMs`; a successful trial closes it again, a failed one re-opens it.
 */
export class CircuitBreaker {
  private current: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private openedAt = 0;
  private trialsInFlight = 0;
  private readonly clock: () => number;

  constructor(private readonly options: CircuitBreakerOptions) {
    this.clock = options.clock ?? Date.now;
  }

  get name(): string {
    return this.options.name;
  }

  get state(): CircuitState {
    if (this.current === 'open' && this.clock() - this.openedAt >= this.options.resetTimeoutMs) this.transition('half_open');
    return this.current;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const state = this.state;
    if (state === 'open') throw new CircuitOpenError(this.name, this.options.resetTimeoutMs - (this.clock() - this.openedAt));
    const trial = state === 'half_open';
    if (trial) {
      if (this.trialsInFlight >= (this.options.halfOpenMaxCalls ?? 1)) throw new CircuitOpenError(this.name, this.options.resetTimeoutMs);
      this.trialsInFlight++;
    }
    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (err) {
      if (this.options.isFailure?.(err) ?? true) this.recordFailure();
      else this.recordSuccess();
      throw err;
    } finally {
      if (trial) this.trialsInFlight--;
    }
  }

  /** Decorator form: wraps a function so every call goes through the breaker. */
  wrap<A extends unknown[], T>(fn: (...args: A) => Promise<T>): (...args: A) => Promise<T> {
    return (...args: A) => this.execute(() => fn(...args));
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    if (this.current !== 'closed') this.transition('closed');
  }

  private recordFailure(): void {
    this.consecutiveFailures++;
    if (this.current === 'half_open' || this.consecutiveFailures >= this.options.failureThreshold) {
      this.openedAt = this.clock();
      if (this.current !== 'open') this.transition('open');
    }
  }

  private transition(next: CircuitState): void {
    this.current = next;
    this.options.onStateChange?.(next, this.name);
  }
}
