import type { Paise } from '@storefront/contracts';

export type GatewayName = 'razorpay' | 'demo';

export interface PaymentSessionRequest {
  orderId: string;
  orderNumber: string;
  amount: Paise;
}

export interface PaymentSession {
  provider: GatewayName;
  /** Provider-side order id, absent for providers without a server-side order object. */
  gatewayOrderId?: string;
  amount: Paise;
  currency: 'INR';
}

export interface PaymentVerification {
  gatewayOrderId: string;
  paymentId: string;
  signature: string;
}

export interface RefundRequest {
  paymentId: string;
  amount: Paise;
  orderId: string;
  orderNumber: string;
  /** Our id for this refund; an order can be refunded in several parts. */
  refundId: string;
}

export interface RefundResult {
  refundId: string;
  /** `processed` settles synchronously; `pending` settles later via a refund webhook. */
  status: 'processed' | 'pending' | 'failed';
}

/** Error from the payment provider that retrying will not fix (e.g. a rejected refund). */
export class PermanentGatewayError extends Error {}

/** Strategy interface implemented by each payment provider. */
export interface PaymentGateway {
  readonly name: GatewayName;
  publicConfig(): { mode: GatewayName; keyId: string | null };
  createPayment(request: PaymentSessionRequest): Promise<PaymentSession>;
  verifyPayment(input: PaymentVerification): boolean;
  refund(request: RefundRequest): Promise<RefundResult>;
  verifyWebhook(rawBody: Buffer, signature: string): boolean;
}
