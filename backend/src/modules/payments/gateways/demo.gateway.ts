import type { PaymentGateway, PaymentSession, PaymentSessionRequest, RefundRequest, RefundResult } from './payment-gateway';
import { verifyHmacSignature } from './signature';

/** Keyless gateway that exercises the same order, payment and refund lifecycle as a real provider. */
export class DemoGateway implements PaymentGateway {
  readonly name = 'demo' as const;

  constructor(private readonly webhookSecret = '') {}

  publicConfig() {
    return { mode: this.name, keyId: null };
  }

  async createPayment(request: PaymentSessionRequest): Promise<PaymentSession> {
    return { provider: this.name, amount: request.amount, currency: 'INR' };
  }

  verifyPayment(): boolean {
    return false;
  }

  async refund(request: RefundRequest): Promise<RefundResult> {
    return { refundId: `demo_rfnd_${request.refundId}`, status: 'processed' };
  }

  verifyWebhook(rawBody: Buffer, signature: string): boolean {
    return verifyHmacSignature(this.webhookSecret, rawBody, signature);
  }
}
