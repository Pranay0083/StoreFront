import { describe, expect, it, vi } from 'vitest';
import { CircuitOpenError } from '../../../core/resilience/circuit-breaker';
import { PermanentGatewayError } from './payment-gateway';
import { RazorpayGateway, type RazorpayClient } from './razorpay.gateway';
import { gatewayBreaker, ResilientPaymentGateway } from './resilient.gateway';

const config = { keyId: 'rzp_test_key', keySecret: 'key-secret', webhookSecret: 'hook-secret' };
const request = { orderId: 'o1', orderNumber: 'SF-1', amount: 10_000 };
const refundRequest = { paymentId: 'pay_1', amount: 10_000, orderId: 'o1', orderNumber: 'SF-1' };
const retry = { retries: 2, baseDelayMs: 0, maxDelayMs: 0, sleep: () => Promise.resolve() };

const httpError = (statusCode: number) => Object.assign(new Error(`http ${statusCode}`), { statusCode, error: { description: 'nope' } });
const connError = () => Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });

function gateway(client: Partial<RazorpayClient['orders'] & RazorpayClient['payments']>) {
  const raw: RazorpayClient = {
    orders: { create: vi.fn(client.create ?? (async () => ({ id: 'order_rzp_1', amount: 10_000 }))) },
    payments: { refund: vi.fn(client.refund ?? (async () => ({ id: 'rfnd_1', status: 'processed' }))) },
  };
  const resilient = new ResilientPaymentGateway(new RazorpayGateway(config, raw), gatewayBreaker('razorpay'), retry);
  return { raw, resilient };
}

describe('ResilientPaymentGateway', () => {
  it('retries order creation through transient provider failures', async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(httpError(503))
      .mockRejectedValueOnce(connError())
      .mockResolvedValue({ id: 'ord', amount: 10_000 });
    const { resilient } = gateway({ create });
    expect(await resilient.createPayment(request)).toMatchObject({ gatewayOrderId: 'ord' });
    expect(create).toHaveBeenCalledTimes(3);
  });

  it('does not retry a rejected request', async () => {
    const create = vi.fn().mockRejectedValue(httpError(400));
    const { resilient } = gateway({ create });
    await expect(resilient.createPayment(request)).rejects.toThrow('http 400');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('retries refunds only when the request never reached the provider', async () => {
    const refund = vi.fn().mockRejectedValueOnce(connError()).mockRejectedValueOnce(httpError(502));
    const { resilient } = gateway({ refund });
    await expect(resilient.refund(refundRequest)).rejects.toThrow('http 502');
    expect(refund).toHaveBeenCalledTimes(2);
  });

  it('keeps permanent refund rejections from tripping the breaker', async () => {
    const { resilient } = gateway({ refund: vi.fn().mockRejectedValue(httpError(400)) });
    for (let i = 0; i < 8; i++) await expect(resilient.refund(refundRequest)).rejects.toBeInstanceOf(PermanentGatewayError);
    expect(resilient.breaker.state).toBe('closed');
  });

  it('fails fast with 503 once the provider is down', async () => {
    const create = vi.fn().mockRejectedValue(httpError(503));
    const { resilient } = gateway({ create });
    await expect(resilient.createPayment(request)).rejects.toThrow();
    await expect(resilient.createPayment(request)).rejects.toThrow();
    const calls = create.mock.calls.length;
    const err = await resilient.createPayment(request).catch(e => e);
    expect(err).toBeInstanceOf(CircuitOpenError);
    expect(err.status).toBe(503);
    expect(create.mock.calls.length).toBe(calls);
  });

  it('passes signature checks straight through', () => {
    const { resilient } = gateway({});
    expect(resilient.name).toBe('razorpay');
    expect(resilient.verifyWebhook(Buffer.from('x'), 'bad')).toBe(false);
    expect(resilient.publicConfig()).toEqual({ mode: 'razorpay', keyId: 'rzp_test_key' });
  });
});
