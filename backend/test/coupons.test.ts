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
    expect((await validate('welcome10', 200_000)).body.discount).toBe(20_000);
    expect((await validate('WELCOME10', 900_000)).body.discount).toBe(50_000);
  });

  it('applies flat discounts but never more than the subtotal', async () => {
    await createCoupon({ code: 'FLAT500', type: 'flat', value: 50_000, minSubtotal: 0, maxDiscount: undefined });
    expect((await validate('FLAT500', 300_000)).body.discount).toBe(50_000);
    expect((await validate('FLAT500', 30_000)).body.discount).toBe(30_000);
  });

  it('enforces minimum subtotal, expiry, activity and usage limits', async () => {
    await createCoupon();
    await createCoupon({ code: 'OLD', expiresAt: new Date(Date.now() - 1000), minSubtotal: 0 });
    await createCoupon({ code: 'OFF', active: false, minSubtotal: 0 });
    await createCoupon({ code: 'USED', usageLimit: 1, usedCount: 1, minSubtotal: 0 });

    const tooSmall = await validate('WELCOME10', 50_000);
    expect(tooSmall.status).toBe(400);
    expect(tooSmall.body.error).toBe('Minimum order of ₹1,000 required for WELCOME10');
    expect((await validate('OLD', 200_000)).body.error).toMatch(/expired/);
    expect((await validate('OFF', 200_000)).body.error).toMatch(/Invalid coupon/);
    expect((await validate('USED', 200_000)).body.error).toMatch(/fully redeemed/);
    expect((await validate('NOPE', 200_000)).status).toBe(400);
  });
});

describe('admin coupon management', () => {
  it('lets admins create, update, list and delete coupons', async () => {
    const admin = await createUser({ role: 'admin' });
    const customer = await createUser();
    const body = { code: ' summer20 ', type: 'percent', value: 20, minSubtotal: 0 };

    await t.http().post(`${API}/admin/coupons`).set(bearer(customer.token)).send(body).expect(403);
    const created = await t.http().post(`${API}/admin/coupons`).set(bearer(admin.token)).send(body).expect(201);
    expect(created.body).toMatchObject({ code: 'SUMMER20', type: 'percent', value: 20, usedCount: 0, active: true });
    await t.http().post(`${API}/admin/coupons`).set(bearer(admin.token)).send(body).expect(409);
    await t.http().post(`${API}/admin/coupons`).set(bearer(admin.token)).send({ ...body, code: 'HUGE', value: 150 }).expect(400);

    const updated = await t.http().put(`${API}/admin/coupons/${created.body._id}`).set(bearer(admin.token)).send({ active: false }).expect(200);
    expect(updated.body.active).toBe(false);

    const list = await t.http().get(`${API}/admin/coupons`).set(bearer(admin.token)).expect(200);
    expect(list.body).toHaveLength(1);

    await t.http().delete(`${API}/admin/coupons/${created.body._id}`).set(bearer(admin.token)).expect(200);
    await t.http().delete(`${API}/admin/coupons/${created.body._id}`).set(bearer(admin.token)).expect(404);
  });
});
