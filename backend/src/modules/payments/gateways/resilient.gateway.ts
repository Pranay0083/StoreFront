import { CircuitBreaker, CircuitOpenError } from '../../../core/resilience/circuit-breaker';
import { isConnectionError, isTransientError, withRetry, type RetryOptions } from '../../../core/resilience/retry';
import {
  PermanentGatewayError,
  type PaymentGateway,
  type PaymentSession,
  type PaymentSessionRequest,
  type PaymentVerification,
  type RefundRequest,
  type RefundResult,
} from './payment-gateway';

export type GatewayRetryPolicy = Omit<RetryOptions, 'shouldRetry'>;

export const DEFAULT_GATEWAY_RETRY: GatewayRetryPolicy = { retries: 2, baseDelayMs: 200, maxDelayMs: 2_000, jitter: 'full' };

/** A rejection (bad request, auth, permanent refund error) means the provider is up; only outages trip the breaker. */
export const isGatewayOutage = (err: unknown): boolean =>
  !(err instanceof PermanentGatewayError) && (isConnectionError(err) || isTransientError(err) || statusOf(err) === undefined);

const statusOf = (err: unknown) => (err as { statusCode?: number })?.statusCode;

export function gatewayBreaker(name: string, onStateChange?: ConstructorParameters<typeof CircuitBreaker>[0]['onStateChange']) {
  return new CircuitBreaker({ name, failureThreshold: 5, resetTimeoutMs: 30_000, isFailure: isGatewayOutage, onStateChange });
}

/**
 * Decorator adding retries and a circuit breaker around provider calls. Order creation is safe to
 * retry on any transient failure; refunds are not idempotent at the provider, so they are only
 * retried when the request provably never left this process (connection errors).
 */
export class ResilientPaymentGateway implements PaymentGateway {
  constructor(
    private readonly inner: PaymentGateway,
    readonly breaker: CircuitBreaker,
    private readonly retry: GatewayRetryPolicy = DEFAULT_GATEWAY_RETRY,
  ) {}

  get name() {
    return this.inner.name;
  }

  publicConfig() {
    return this.inner.publicConfig();
  }

  verifyPayment(input: PaymentVerification): boolean {
    return this.inner.verifyPayment(input);
  }

  verifyWebhook(rawBody: Buffer, signature: string): boolean {
    return this.inner.verifyWebhook(rawBody, signature);
  }

  createPayment(request: PaymentSessionRequest): Promise<PaymentSession> {
    return withRetry(() => this.breaker.execute(() => this.inner.createPayment(request)), {
      ...this.retry,
      shouldRetry: err => !(err instanceof CircuitOpenError) && isTransientError(err),
    });
  }

  refund(request: RefundRequest): Promise<RefundResult> {
    return withRetry(() => this.breaker.execute(() => this.inner.refund(request)), {
      ...this.retry,
      shouldRetry: err => !(err instanceof CircuitOpenError) && isConnectionError(err),
    });
  }
}
