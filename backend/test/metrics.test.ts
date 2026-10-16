import express from 'express';
import mongoose from 'mongoose';
import supertest from 'supertest';
import { describe, expect, it } from 'vitest';
import { Metrics, metricsHandler } from '../src/core/observability/metrics';
import { recordOpeningBalances } from '../src/modules/inventory/opening-balances';
import { ADDRESS, createProduct, createUser } from './helpers/factories';
import { API, bearer, useTestApp } from './helpers/app';

const t = useTestApp();
const scrape = async () => (await t.http().get('/metrics').expect(200)).text;
const sample = (text: string, metric: string, labels: string) =>
  Number(
    text
      .split('\n')
      .find(l => l.startsWith(`${metric}{`) && l.includes(labels))
      ?.split(' ')
      .at(-1) ?? NaN,
  );

describe('Prometheus metrics', () => {
  it('exposes HTTP latency by route template, not raw URL', async () => {
    const product = await createProduct({ title: 'Metric Tee' });
    await t.http().get(`${API}/products/${product.slug}`).expect(200);
    await t.http().get(`${API}/products/does-not-exist`).expect(404);
    const text = await scrape();
    expect(text).toContain('http_request_duration_seconds_count{method="GET",route="/api/v1/products/:slug",status="200"} 1');
    expect(text).toContain('route="/api/v1/products/:slug",status="404"');
    expect(text).not.toContain(product.slug);
  });

  it('counts business events once per event and reports cache, queue, outbox and breaker state', async () => {
    const buyer = await createUser();
    const product = await createProduct({ title: 'Counted Tee', price: 100_000 });
    await recordOpeningBalances(mongoose.connection.db!);
    const { body: order } = await t
      .http()
      .post(`${API}/orders`)
      .set(bearer(buyer.token))
      .send({ address: ADDRESS, items: [{ productId: String(product._id), size: 'M', qty: 2 }] })
      .expect(201);
    await t.http().post(`${API}/payments/demo-confirm`).set(bearer(buyer.token)).send({ orderId: order._id }).expect(200);
    await t.settle();
    await t.http().get(`${API}/products/${product.slug}`);
    await t.http().get(`${API}/products/${product.slug}`);

    const text = await scrape();
    expect(sample(text, 'storefront_orders_total', 'event="placed"')).toBeGreaterThanOrEqual(1);
    expect(sample(text, 'storefront_orders_total', 'event="paid"')).toBeGreaterThanOrEqual(1);
    expect(sample(text, 'storefront_payments_captured_paise_total', 'provider="demo"')).toBeGreaterThanOrEqual(209_900);
    expect(sample(text, 'storefront_cache_requests_total', 'result="hit"')).toBeGreaterThanOrEqual(1);
    expect(sample(text, 'storefront_outbox_events', 'status="done"')).toBeGreaterThanOrEqual(2);
    expect(text).toContain('storefront_queue_jobs{queue="notifications",state="waiting"}');
    expect(sample(text, 'storefront_circuit_breaker_state', 'circuit="payment-gateway:demo"')).toBe(0);
  });

  it('times pricing runs by optimizer strategy', async () => {
    const product = await createProduct({ title: 'Priced Tee' });
    await t
      .http()
      .post(`${API}/pricing/quote`)
      .send({ items: [{ productId: String(product._id), size: 'M', qty: 1 }] })
      .expect(200);
    expect(await scrape()).toMatch(/storefront_pricing_duration_seconds_count\{strategy="[a-z-]+"\} \d+/);
  });

  it('refuses proxied scrapes and enforces the token when one is configured', async () => {
    await t.http().get('/metrics').set('X-Forwarded-For', '203.0.113.9').expect(403);

    const app = express().get('/metrics', metricsHandler(new Metrics({ defaultMetrics: false }), 'scrape-token-0123456789'));
    await supertest(app).get('/metrics').expect(403);
    await supertest(app).get('/metrics').set('Authorization', 'Bearer wrong').expect(403);
    const ok = await supertest(app).get('/metrics').set('Authorization', 'Bearer scrape-token-0123456789').expect(200);
    expect(ok.headers['content-type']).toContain('text/plain');
  });
});
