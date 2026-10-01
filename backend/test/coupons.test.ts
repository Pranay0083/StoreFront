import { describe, expect, it } from 'vitest';
import { createCoupon, createUser } from './helpers/factories';
import { API, bearer, useTestApp } from './helpers/app';

const t = useTestApp();

async function validate(code: string, subtotal: number) {
  const { token } = await createUser();
  return t.http().post(`${API}/coupons/validate`).set(bearer(token)).send({ code, subtotal });
}

describe('coupon math', () => {
  it('applies a percentage discount capped at maxDiscount', async () => {
    await createCoupon();
    expect((await validate('welcome10', 2000)).body.discount).toBe(200);
    expect((await validate('WELCOME10', 9000)).body.discount).toBe(500);
  });

  it('applies flat discounts but never more than the subtotal', async () => {
    await createCoupon({ code: 'FLAT500', type: 'flat', value: 500, minSubtotal: 0, maxDiscount: undefined });
    expect((await validate('FLAT500', 3000)).body.discount).toBe(500);
    expect((await validate('FLAT500', 300)).body.discount).toBe(300);
  });

  it('enforces minimum subtotal, expiry, activity and usage limits', async () => {
    await createCoupon();
    await createCoupon({ code: 'OLD', expiresAt: new Date(Date.now() - 1000), minSubtotal: 0 });
    await createCoupon({ code: 'OFF', active: false, minSubtotal: 0 });
    await createCoupon({ code: 'USED', usageLimit: 1, usedCount: 1, minSubtotal: 0 });

    expect((await validate('WELCOME10', 500)).status).toBe(400);
    expect((await validate('OLD', 2000)).body.error).toMatch(/expired/);
    expect((await validate('OFF', 2000)).body.error).toMatch(/Invalid coupon/);
    expect((await validate('USED', 2000)).body.error).toMatch(/fully redeemed/);
    expect((await validate('NOPE', 2000)).status).toBe(400);
  });
});
