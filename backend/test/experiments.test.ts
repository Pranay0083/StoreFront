import { describe, expect, it } from 'vitest';
import { ExperimentAssignmentModel } from '../src/modules/experiments/experiments.model';
import { ADDRESS, createProduct, createUser } from './helpers/factories';
import { API, bearer, useTestApp } from './helpers/app';

const t = useTestApp();

const EXPERIMENT = {
  key: 'checkout-near-miss',
  name: 'Near-miss suggestions at checkout',
  status: 'running',
  variants: [
    { key: 'shown', weight: 50 },
    { key: 'hidden', weight: 50 },
  ],
  minSamplePerVariant: 10,
};

const adminToken = async () => (await createUser({ role: 'admin' })).token;

describe('feature flags', () => {
  it('evaluates flags with audience targeting and sees changes immediately', async () => {
    const tk = await adminToken();
    await t
      .http()
      .post(`${API}/admin/flags`)
      .set(bearer(tk))
      .send({ key: 'new-nav', enabled: true, audience: { segments: ['signedIn'] } })
      .expect(201);
    const guest = await t.http().get(`${API}/experiments/evaluate`).query({ anonymousId: 'anon-12345678' }).expect(200);
    expect(guest.body.flags['new-nav']).toBe(false);
    const customer = await createUser();
    const signedIn = await t.http().get(`${API}/experiments/evaluate`).set(bearer(customer.token)).expect(200);
    expect(signedIn.body.flags['new-nav']).toBe(true);

    await t.http().put(`${API}/admin/flags/new-nav`).set(bearer(tk)).send({ enabled: false }).expect(200);
    const after = await t.http().get(`${API}/experiments/evaluate`).set(bearer(customer.token)).expect(200);
    expect(after.body.flags['new-nav']).toBe(false);
  });

  it('hands guests a subject id to persist', async () => {
    const res = await t.http().get(`${API}/experiments/evaluate`).expect(200);
    expect(res.body.subjectId).toMatch(/^anon_[a-f0-9]{32}$/);
  });

  it('requires experiments:manage for administration', async () => {
    const support = await createUser({ role: 'support' });
    await t.http().get(`${API}/admin/flags`).set(bearer(support.token)).expect(403);
    await t.http().get(`${API}/admin/experiments`).set(bearer(support.token)).expect(403);
  });
});

describe('experiments', () => {
  it('assigns stickily, survives login and locks weights once started', async () => {
    const tk = await adminToken();
    await t.http().post(`${API}/admin/experiments`).set(bearer(tk)).send(EXPERIMENT).expect(201);
    const anonymousId = 'visitor-abcdef12';
    const first = await t.http().get(`${API}/experiments/evaluate`).query({ anonymousId }).expect(200);
    const variant = first.body.experiments['checkout-near-miss'];
    expect(['shown', 'hidden']).toContain(variant);
    for (let i = 0; i < 3; i++) {
      const again = await t.http().get(`${API}/experiments/evaluate`).query({ anonymousId }).expect(200);
      expect(again.body.experiments['checkout-near-miss']).toBe(variant);
    }
    const buyer = await createUser();
    const loggedIn = await t.http().get(`${API}/experiments/evaluate`).set(bearer(buyer.token)).query({ anonymousId }).expect(200);
    expect(loggedIn.body.experiments['checkout-near-miss']).toBe(variant);
    const otherDevice = await t.http().get(`${API}/experiments/evaluate`).set(bearer(buyer.token)).expect(200);
    expect(otherDevice.body.experiments['checkout-near-miss']).toBe(variant);
    expect(await ExperimentAssignmentModel.countDocuments({ experimentKey: 'checkout-near-miss' })).toBe(1);

    await t
      .http()
      .put(`${API}/admin/experiments/checkout-near-miss`)
      .set(bearer(tk))
      .send({
        variants: [
          { key: 'shown', weight: 90 },
          { key: 'hidden', weight: 10 },
        ],
      })
      .expect(409);
  });

  it('attributes paid orders to exposed subjects once and reports results', async () => {
    const tk = await adminToken();
    await t.http().post(`${API}/admin/experiments`).set(bearer(tk)).send(EXPERIMENT).expect(201);
    const product = await createProduct({ price: 100_000 });

    const buyer = await createUser();
    const anonymousId = 'buyer-device-0001';
    const evaluation = await t.http().get(`${API}/experiments/evaluate`).set(bearer(buyer.token)).query({ anonymousId }).expect(200);
    const variant = evaluation.body.experiments['checkout-near-miss'];
    const exposure = await t
      .http()
      .post(`${API}/experiments/exposures`)
      .set(bearer(buyer.token))
      .send({ experiment: 'checkout-near-miss', anonymousId })
      .expect(200);
    expect(exposure.body.recorded).toBe(true);

    const unexposed = await createUser();
    await t.http().get(`${API}/experiments/evaluate`).set(bearer(unexposed.token)).expect(200);

    for (const who of [buyer, unexposed]) {
      const order = (
        await t
          .http()
          .post(`${API}/orders`)
          .set(bearer(who.token))
          .send({ address: ADDRESS, items: [{ productId: String(product._id), size: 'M', qty: 1 }] })
          .expect(201)
      ).body;
      await t.http().post(`${API}/payments/create`).set(bearer(who.token)).send({ orderId: order._id }).expect(200);
      await t.http().post(`${API}/payments/demo-confirm`).set(bearer(who.token)).send({ orderId: order._id }).expect(200);
    }
    await t.settle();

    const res = await t.http().get(`${API}/admin/experiments/checkout-near-miss/results`).set(bearer(tk)).expect(200);
    const row = res.body.variants.find((r: { variant: string }) => r.variant === variant);
    expect(row).toMatchObject({ visitors: 1, conversions: 1, conversionRate: 1 });
    expect(row.revenue).toBeGreaterThan(0);
    expect(row.revenuePerVisitor).toBe(row.revenue);
    expect(res.body.variants.reduce((s: number, r: { conversions: number }) => s + r.conversions, 0)).toBe(1);
    expect(res.body.warnings[0]).toMatch(/minimum sample/);
    expect(res.body.comparisons).toHaveLength(1);
    expect(res.body.comparisons[0].significant).toBe(false);
  });

  it('enforces the lifecycle and validates weights', async () => {
    const tk = await adminToken();
    await t
      .http()
      .post(`${API}/admin/experiments`)
      .set(bearer(tk))
      .send({ ...EXPERIMENT, status: 'draft' })
      .expect(201);
    await t.http().put(`${API}/admin/experiments/checkout-near-miss`).set(bearer(tk)).send({ status: 'completed' }).expect(409);
    const started = await t
      .http()
      .put(`${API}/admin/experiments/checkout-near-miss`)
      .set(bearer(tk))
      .send({ status: 'running' })
      .expect(200);
    expect(started.body.startedAt).toBeTruthy();
    await t.http().delete(`${API}/admin/experiments/checkout-near-miss`).set(bearer(tk)).expect(409);
    await t
      .http()
      .post(`${API}/admin/experiments`)
      .set(bearer(tk))
      .send({
        ...EXPERIMENT,
        key: 'bad-weights',
        variants: [
          { key: 'a', weight: 60 },
          { key: 'b', weight: 60 },
        ],
      })
      .expect(400);
  });
});
