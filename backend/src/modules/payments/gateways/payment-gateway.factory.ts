import { DemoGateway } from './demo.gateway';
import type { PaymentGateway } from './payment-gateway';
import { RazorpayGateway, type RazorpayConfig } from './razorpay.gateway';

/** Picks the live provider when its credentials are configured, otherwise the demo gateway. */
export class PaymentGatewayFactory {
  static create(config: RazorpayConfig): PaymentGateway {
    if (config.keyId && config.keySecret) return new RazorpayGateway(config);
    return new DemoGateway(config.webhookSecret);
  }
}
