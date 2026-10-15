import { describe, expect, it, vi } from 'vitest';
import { DemoGateway } from './demo.gateway';
import { PermanentGatewayError } from './payment-gateway';
import { PaymentGatewayFactory } from './payment-gateway.factory';
import { RazorpayGateway, type RazorpayClient } from './razorpay.gateway';
import { hmacSha256Hex, timingSafeEqualStr, verifyHmacSignature } from './signature';

const config = { keyId: 'rzp_test_key', keySecret: 'key-secret', webhookSecret: 'hook-secret' };

function fakeClient(overrides: Partial<{ create: unknown; refund: unknown }> = {}): RazorpayClient {
  return {
    orders: { create: vi.fn((overrides.create as never) ?? (async () => ({ id: 'order_rzp_1', amount: 209_900 }))) },
    payments: { refund: vi.fn((overrides.refund as never) ?? (async () => ({ id: 'rfnd_1', status: 'pending' }))) },
  };
}

describe('signature helpers', () => {
  it('compares in constant time and rejects mismatched lengths', () => {
    expect(timingSafeEqualStr('abc', 'abc')).toBe(true);
    expect(timingSafeEqualStr('abc', 'abd')).toBe(false);
    expect(timingSafeEqualStr('abc', 'abcd')).toBe(false);
  });

  it('refuses to verify without a secret or signature', () => {
    expect(verifyHmacSignature('', 'data', hmacSha256Hex('', 'data'))).toBe(false);
    expect(verifyHmacSignature('s', 'data', undefined)).toBe(false);
    expect(verifyHmacSignature('s', 'data', hmacSha256Hex('s', 'data'))).toBe(true);
  });
});

describe('PaymentGatewayFactory', () => {
  it('selects Razorpay only when both keys are configured', () => {
    expect(PaymentGatewayFactory.create(config).name).toBe('razorpay');
    expect(PaymentGatewayFactory.create({ ...config, keySecret: '' }).name).toBe('demo');
    expect(PaymentGatewayFactory.create({ keyId: '', keySecret: '', webhookSecret: '' }).name).toBe('demo');
  });
});

describe('RazorpayGateway', () => {
  it('creates a provider order for the exact amount in paise', async () => {
    const client = fakeClient();
    const gateway = new RazorpayGateway(config, client);
    const session = await gateway.createPayment({ orderId: 'o1', orderNumber: 'SF-ABC123', amount: 209_900 });
    expect(session).toEqual({ provider: 'razorpay', gatewayOrderId: 'order_rzp_1', amount: 209_900, currency: 'INR' });
    expect(client.orders.create).toHaveBeenCalledWith(expect.objectContaining({ amount: 209_900, currency: 'INR', receipt: 'SF-ABC123' }));
  });

  it('verifies checkout signatures over "order_id|payment_id"', () => {
    const gateway = new RazorpayGateway(config, fakeClient());
    const signature = hmacSha256Hex(config.keySecret, 'order_rzp_1|pay_1');
    expect(gateway.verifyPayment({ gatewayOrderId: 'order_rzp_1', paymentId: 'pay_1', signature })).toBe(true);
    expect(gateway.verifyPayment({ gatewayOrderId: 'order_rzp_1', paymentId: 'pay_2', signature })).toBe(false);
  });

  it('verifies webhooks with the webhook secret, not the key secret', () => {
    const gateway = new RazorpayGateway(config, fakeClient());
    const body = Buffer.from('{"event":"payment.captured"}');
    expect(gateway.verifyWebhook(body, hmacSha256Hex(config.webhookSecret, body))).toBe(true);
    expect(gateway.verifyWebhook(body, hmacSha256Hex(config.keySecret, body))).toBe(false);
  });

  it('maps refund responses and classifies 4xx rejections as permanent', async () => {
    const ok = new RazorpayGateway(config, fakeClient({ refund: async () => ({ id: 'rfnd_9', status: 'processed' }) }));
    await expect(ok.refund({ paymentId: 'pay_1', amount: 100, orderId: 'o1', orderNumber: 'SF-1', refundId: 'r1' })).resolves.toEqual({
      refundId: 'rfnd_9',
      status: 'processed',
    });

    const rejected = new RazorpayGateway(
      config,
      fakeClient({
        refund: async () => {
          throw Object.assign(new Error('bad'), { statusCode: 400, error: { description: 'The refund amount exceeds the payment' } });
        },
      }),
    );
    await expect(
      rejected.refund({ paymentId: 'pay_1', amount: 100, orderId: 'o1', orderNumber: 'SF-1', refundId: 'r1' }),
    ).rejects.toThrowError(new PermanentGatewayError('The refund amount exceeds the payment'));

    const outage = new RazorpayGateway(
      config,
      fakeClient({
        refund: async () => {
          throw Object.assign(new Error('gateway timeout'), { statusCode: 504 });
        },
      }),
    );
    await expect(
      outage.refund({ paymentId: 'pay_1', amount: 100, orderId: 'o1', orderNumber: 'SF-1', refundId: 'r1' }),
    ).rejects.not.toBeInstanceOf(PermanentGatewayError);
  });
});

describe('DemoGateway', () => {
  it('settles refunds synchronously and never accepts client-side payment signatures', async () => {
    const gateway = new DemoGateway('hook-secret');
    expect(gateway.publicConfig()).toEqual({ mode: 'demo', keyId: null });
    expect(gateway.verifyPayment()).toBe(false);
    await expect(
      gateway.refund({ paymentId: 'demo_pay_1', amount: 100, orderId: 'o1', orderNumber: 'SF-1', refundId: 'r1' }),
    ).resolves.toEqual({
      refundId: 'demo_rfnd_r1',
      status: 'processed',
    });
    const body = Buffer.from('{}');
    expect(gateway.verifyWebhook(body, hmacSha256Hex('hook-secret', body))).toBe(true);
  });
});
