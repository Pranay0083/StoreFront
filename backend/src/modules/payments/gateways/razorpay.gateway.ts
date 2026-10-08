import Razorpay from 'razorpay';
import {
  PermanentGatewayError,
  type PaymentGateway,
  type PaymentSession,
  type PaymentSessionRequest,
  type PaymentVerification,
  type RefundRequest,
  type RefundResult,
} from './payment-gateway';
import { verifyHmacSignature } from './signature';

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
}

/** The subset of the Razorpay SDK this gateway uses; injectable for tests. */
export interface RazorpayClient {
  orders: { create(params: Record<string, unknown>): Promise<{ id: string; amount: number | string }> };
  payments: { refund(paymentId: string, params: Record<string, unknown>): Promise<{ id: string; status: string }> };
}

export class RazorpayGateway implements PaymentGateway {
  readonly name = 'razorpay' as const;
  private readonly client: RazorpayClient;

  constructor(
    private readonly config: RazorpayConfig,
    client?: RazorpayClient,
  ) {
    this.client = client ?? (new Razorpay({ key_id: config.keyId, key_secret: config.keySecret }) as unknown as RazorpayClient);
  }

  publicConfig() {
    return { mode: this.name, keyId: this.config.keyId };
  }

  async createPayment(request: PaymentSessionRequest): Promise<PaymentSession> {
    const order = await this.client.orders.create({
      amount: request.amount,
      currency: 'INR',
      receipt: request.orderNumber.slice(0, 40),
      payment_capture: true,
      notes: { orderId: request.orderId },
    });
    return { provider: this.name, gatewayOrderId: order.id, amount: Number(order.amount), currency: 'INR' };
  }

  verifyPayment(input: PaymentVerification): boolean {
    return verifyHmacSignature(this.config.keySecret, `${input.gatewayOrderId}|${input.paymentId}`, input.signature);
  }

  async refund(request: RefundRequest): Promise<RefundResult> {
    try {
      const refund = await this.client.payments.refund(request.paymentId, {
        amount: request.amount,
        speed: 'normal',
        receipt: `rf_${request.orderNumber}`.slice(0, 40),
        notes: { orderId: request.orderId },
      });
      const status = refund.status === 'processed' || refund.status === 'failed' ? refund.status : 'pending';
      return { refundId: refund.id, status };
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode && statusCode >= 400 && statusCode < 500) {
        const description = (err as { error?: { description?: string } }).error?.description;
        throw new PermanentGatewayError(description ?? `Refund rejected by Razorpay (${statusCode})`);
      }
      throw err;
    }
  }

  verifyWebhook(rawBody: Buffer, signature: string): boolean {
    return verifyHmacSignature(this.config.webhookSecret, rawBody, signature);
  }
}
