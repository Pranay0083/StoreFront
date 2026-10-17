import { describe, expect, it } from 'vitest';
import { domainEvent } from '../src/core/events/domain-events';
import { OutboxModel } from '../src/core/events/outbox.model';
import type { MemoryJobQueue } from '../src/core/queue/memory-job-queue';
import { AuditLogModel } from '../src/modules/admin/audit-log.model';
import { createUser } from './helpers/factories';
import { API, bearer, useTestApp } from './helpers/app';
import { waitFor } from './helpers/wait';

const t = useTestApp();
const queue = () => t.container.jobs as MemoryJobQueue;

let failNext = true;
let succeeded = 0;

async function deadLetterAJob() {
  if (!queue().definition('test.flaky')) {
    queue().register<{ n: number }>({
      name: 'test.flaky',
      queue: 'maintenance',
      attempts: 1,
      handler: async () => {
        if (failNext) throw new Error('downstream unavailable');
        succeeded++;
      },
    });
  }
  failNext = true;
  await queue().enqueue('test.flaky', { n: 7 });
  await queue().drain();
}

describe('admin job operations', () => {
  it('is limited to staff with jobs:manage', async () => {
    for (const role of ['customer', 'support', 'catalog_manager', 'fulfillment'] as const) {
      const { token } = await createUser({ role });
      await t.http().get(`${API}/admin/jobs`).set(bearer(token)).expect(403);
    }
    const admin = await createUser({ role: 'admin' });
    const res = await t.http().get(`${API}/admin/jobs`).set(bearer(admin.token)).expect(200);
    expect(res.body).toMatchObject({ backend: 'memory', deadLetters: { jobs: 0, events: 0 } });
    expect(res.body.queues.map((q: { queue: string }) => q.queue)).toEqual(['events', 'payments', 'notifications', 'maintenance']);
  });

  it('lists a dead-lettered job and retries it with a fresh attempt budget', async () => {
    const admin = await createUser({ role: 'admin' });
    await deadLetterAJob();

    const { body } = await t.http().get(`${API}/admin/jobs/dead-letters`).set(bearer(admin.token)).expect(200);
    expect(body.items).toEqual([
      expect.objectContaining({
        source: 'job',
        name: 'test.flaky',
        queue: 'maintenance',
        error: 'downstream unavailable',
        attempts: 1,
        data: { n: 7 },
      }),
    ]);

    failNext = false;
    await t.http().post(`${API}/admin/jobs/dead-letters/job/${body.items[0].id}/retry`).set(bearer(admin.token)).expect(200);
    await queue().drain();
    expect(succeeded).toBe(1);
    expect((await t.http().get(`${API}/admin/jobs/dead-letters`).set(bearer(admin.token))).body.items).toEqual([]);
    await waitFor(async () => (await AuditLogModel.countDocuments({ permissions: 'jobs:manage', method: 'POST' })) === 1);
  });

  it('discards a dead-lettered job and 404s on unknown ids', async () => {
    const admin = await createUser({ role: 'admin' });
    await deadLetterAJob();
    const { body } = await t.http().get(`${API}/admin/jobs/dead-letters?source=job`).set(bearer(admin.token));
    await t.http().delete(`${API}/admin/jobs/dead-letters/job/${body.items[0].id}`).set(bearer(admin.token)).expect(200);
    await t.http().delete(`${API}/admin/jobs/dead-letters/job/${body.items[0].id}`).set(bearer(admin.token)).expect(404);
    await t.http().post(`${API}/admin/jobs/dead-letters/job/not-an-id/retry`).set(bearer(admin.token)).expect(404);
  });

  it('revives an outbox event the relay gave up on', async () => {
    const admin = await createUser({ role: 'admin' });
    const event = domainEvent('StockLow', 'p1', { productId: 'p1', size: 'M', stock: 0, threshold: 5 });
    await OutboxModel.create({
      _id: event.id,
      name: event.name,
      aggregateId: event.aggregateId,
      payload: event.payload,
      occurredAt: event.occurredAt,
      status: 'dead',
      attempts: 8,
      nextAttemptAt: event.occurredAt,
      lastError: 'inventory.alert-low-stock: boom',
      processedAt: new Date(),
    });

    const { body } = await t.http().get(`${API}/admin/jobs/dead-letters?source=event`).set(bearer(admin.token)).expect(200);
    expect(body.items).toEqual([expect.objectContaining({ source: 'event', id: event.id, name: 'StockLow', attempts: 8 })]);

    await t.http().post(`${API}/admin/jobs/dead-letters/event/${event.id}/retry`).set(bearer(admin.token)).expect(200);
    expect(await OutboxModel.findById(event.id).lean()).toMatchObject({ status: 'pending', attempts: 0 });
    await t.settle();
    expect((await OutboxModel.findById(event.id).lean())!.status).toBe('done');
  });
});
