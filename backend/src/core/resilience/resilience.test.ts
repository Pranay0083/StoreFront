import { describe, expect, it, vi } from 'vitest';
import { CircuitBreaker, CircuitOpenError, type CircuitState } from './circuit-breaker';
import { backoffDelay, isConnectionError, isTransientError, retrying, withRetry } from './retry';

const noSleep = () => Promise.resolve();

describe('withRetry', () => {
  it('retries until success and reports each retry with its backoff', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('a')).mockRejectedValueOnce(new Error('b')).mockResolvedValue('ok');
    const onRetry = vi.fn();
    const result = await withRetry(fn, { retries: 3, baseDelayMs: 100, maxDelayMs: 1_000, jitter: 'none', sleep: noSleep, onRetry });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry.mock.calls.map(c => c[2])).toEqual([100, 200]);
  });

  it('gives up after the retry budget and rethrows the last error', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('down'));
    await expect(withRetry(fn, { retries: 2, baseDelayMs: 1, maxDelayMs: 1, sleep: noSleep })).rejects.toThrow('down');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry errors the predicate rejects', async () => {
    const fn = vi.fn().mockRejectedValue(Object.assign(new Error('bad request'), { statusCode: 400 }));
    await expect(
      withRetry(fn, { retries: 5, baseDelayMs: 1, maxDelayMs: 1, sleep: noSleep, shouldRetry: isTransientError }),
    ).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('caps exponential backoff and applies full jitter within the window', () => {
    const opts = { baseDelayMs: 100, maxDelayMs: 500, jitter: 'none' as const };
    expect([1, 2, 3, 4, 5].map(n => backoffDelay(n, opts))).toEqual([100, 200, 400, 500, 500]);
    expect(backoffDelay(3, { ...opts, jitter: 'full', random: () => 0.5 })).toBe(200);
  });

  it('decorates a function without changing its signature', async () => {
    let calls = 0;
    const flaky = retrying(
      async (a: number, b: number) => {
        if (++calls < 2) throw new Error('once');
        return a + b;
      },
      { retries: 1, baseDelayMs: 1, maxDelayMs: 1, sleep: noSleep },
    );
    expect(await flaky(2, 3)).toBe(5);
  });

  it('classifies transient failures', () => {
    expect(isConnectionError(Object.assign(new Error(), { code: 'ECONNREFUSED' }))).toBe(true);
    expect(isConnectionError({ cause: { code: 'ECONNRESET' } })).toBe(true);
    expect(isTransientError({ statusCode: 503 })).toBe(true);
    expect(isTransientError({ statusCode: 429 })).toBe(true);
    expect(isTransientError({ statusCode: 404 })).toBe(false);
  });
});

describe('CircuitBreaker', () => {
  function setup(overrides: Partial<ConstructorParameters<typeof CircuitBreaker>[0]> = {}) {
    let now = 0;
    const states: CircuitState[] = [];
    const breaker = new CircuitBreaker({
      name: 'gateway',
      failureThreshold: 3,
      resetTimeoutMs: 1_000,
      clock: () => now,
      onStateChange: s => states.push(s),
      ...overrides,
    });
    return { breaker, states, advance: (ms: number) => (now += ms) };
  }
  const fail = () => Promise.reject(new Error('boom'));
  const ok = () => Promise.resolve('ok');

  it('opens after consecutive failures and fails fast while open', async () => {
    const { breaker, states } = setup();
    for (let i = 0; i < 3; i++) await expect(breaker.execute(fail)).rejects.toThrow('boom');
    expect(breaker.state).toBe('open');
    const spy = vi.fn(ok);
    await expect(breaker.execute(spy)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(spy).not.toHaveBeenCalled();
    expect(states).toEqual(['open']);
  });

  it('a success resets the consecutive failure count', async () => {
    const { breaker } = setup();
    await expect(breaker.execute(fail)).rejects.toThrow();
    await expect(breaker.execute(fail)).rejects.toThrow();
    await breaker.execute(ok);
    await expect(breaker.execute(fail)).rejects.toThrow();
    expect(breaker.state).toBe('closed');
  });

  it('half-opens after the reset timeout, closing on a good trial and re-opening on a bad one', async () => {
    const { breaker, states, advance } = setup();
    for (let i = 0; i < 3; i++) await expect(breaker.execute(fail)).rejects.toThrow();
    advance(1_000);
    expect(breaker.state).toBe('half_open');
    await expect(breaker.execute(fail)).rejects.toThrow('boom');
    expect(breaker.state).toBe('open');
    advance(1_000);
    expect(await breaker.execute(ok)).toBe('ok');
    expect(states).toEqual(['open', 'half_open', 'open', 'half_open', 'closed']);
  });

  it('admits only a limited number of concurrent trial calls', async () => {
    const { breaker, advance } = setup();
    for (let i = 0; i < 3; i++) await expect(breaker.execute(fail)).rejects.toThrow();
    advance(1_000);
    let release!: () => void;
    const slow = breaker.execute(() => new Promise<string>(r => (release = () => r('ok'))));
    await expect(breaker.execute(ok)).rejects.toBeInstanceOf(CircuitOpenError);
    release();
    expect(await slow).toBe('ok');
    expect(breaker.state).toBe('closed');
  });

  it('ignores errors that prove the dependency is reachable', async () => {
    const { breaker } = setup({ isFailure: err => !(err instanceof TypeError) });
    for (let i = 0; i < 5; i++) await expect(breaker.execute(() => Promise.reject(new TypeError('4xx')))).rejects.toThrow();
    expect(breaker.state).toBe('closed');
  });
});
