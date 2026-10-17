import express from 'express';
import supertest from 'supertest';
import { describe, expect, it } from 'vitest';
import { HealthMonitor, type ReadinessCheck } from '../src/core/observability/health';
import { useTestApp } from './helpers/app';

const t = useTestApp();

const check = (name: string, result: boolean | 'hang' | 'throw', critical = true): ReadinessCheck => ({
  name,
  critical,
  check: () =>
    result === 'hang' ? new Promise(() => undefined) : result === 'throw' ? Promise.reject(new Error('down')) : Promise.resolve(result),
});

const probe = (monitor: HealthMonitor) => supertest(express().use(monitor.routes()));

describe('health and readiness', () => {
  it('reports liveness and readiness of the real dependencies', async () => {
    const live = await t.http().get('/health').expect(200);
    expect(live.body).toMatchObject({ status: 'ok', uptimeSeconds: expect.any(Number) });
    const ready = await t.http().get('/ready').expect(200);
    expect(ready.body).toEqual({ status: 'ready', checks: { mongodb: 'ok', queue: 'ok' } });
  });

  it('goes unavailable when a critical dependency fails, times out or throws', async () => {
    for (const failure of [false, 'hang', 'throw'] as const) {
      const res = await probe(new HealthMonitor([check('mongodb', true), check('redis', failure)], 50))
        .get('/ready')
        .expect(503);
      expect(res.body.status).toBe('unavailable');
      expect(res.body.checks.redis).toBe(failure === 'hang' ? 'timeout' : 'fail');
    }
  });

  it('stays in rotation but degraded when only an optional dependency is down', async () => {
    const res = await probe(new HealthMonitor([check('mongodb', true), check('search', false, false)]))
      .get('/ready')
      .expect(200);
    expect(res.body).toEqual({ status: 'degraded', checks: { mongodb: 'ok', search: 'fail' } });
  });

  it('reports draining during shutdown so load balancers stop sending traffic, while staying live', async () => {
    const monitor = new HealthMonitor([check('mongodb', true)]);
    monitor.markDraining();
    expect((await probe(monitor).get('/ready').expect(503)).body.status).toBe('draining');
    await probe(monitor).get('/health').expect(200);
  });
});
