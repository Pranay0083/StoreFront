import { describe, expect, it } from 'vitest';
import { AuditLogModel } from '../src/modules/admin/audit-log.model';
import { redact, targetsOf } from '../src/modules/admin/audit-trail';
import { createProduct, createUser } from './helpers/factories';
import { API, bearer, useTestApp } from './helpers/app';

const t = useTestApp();

const PRODUCT = {
  title: 'Audit Tee',
  category: 'Men',
  price: 99_900,
  images: ['https://images.unsplash.com/photo-audit'],
  sizes: [{ size: 'M', stock: 3 }],
};

/** Entries are written after the response finishes, so poll briefly. */
async function entries(min = 1) {
  for (let i = 0; i < 50; i++) {
    const rows = await AuditLogModel.find().sort({ _id: 1 }).lean();
    if (rows.length >= min) return rows;
    await new Promise(r => setTimeout(r, 20));
  }
  return AuditLogModel.find().sort({ _id: 1 }).lean();
}

describe('audit trail', () => {
  it('records who changed what through permission-guarded routes', async () => {
    const manager = await createUser({ role: 'catalog_manager', email: 'cm@test.dev' });
    const created = await t.http().post(`${API}/products`).set(bearer(manager.token)).send(PRODUCT).expect(201);
    await t.http().put(`${API}/products/${created.body._id}`).set(bearer(manager.token)).send({ price: 89_900 }).expect(200);

    const [create, update] = await entries(2);
    expect(create).toMatchObject({
      actorEmail: 'cm@test.dev',
      actorRole: 'catalog_manager',
      permissions: ['catalog:write'],
      method: 'POST',
      path: `${API}/products`,
      status: 201,
      targets: [created.body._id],
    });
    expect(update).toMatchObject({
      method: 'PUT',
      status: 200,
      targets: [created.body._id],
      changes: { price: 89_900 },
      summary: `PUT ${API}/products/${created.body._id} → 200 (price)`,
    });
  });

  it('records rejected admin writes but not reads, denied requests or customer activity', async () => {
    const admin = await createUser({ role: 'admin' });
    const support = await createUser({ role: 'support' });
    const customer = await createUser();

    await t.http().get(`${API}/admin/stats`).set(bearer(admin.token)).expect(200);
    await t.http().post(`${API}/products`).set(bearer(support.token)).send(PRODUCT).expect(403);
    await t.http().put(`${API}/cart`).set(bearer(customer.token)).send({ items: [] }).expect(200);
    await t.http().post(`${API}/products`).set(bearer(admin.token)).send({ title: 'x' }).expect(400);

    const rows = await entries(1);
    await new Promise(r => setTimeout(r, 50));
    expect(await AuditLogModel.countDocuments()).toBe(1);
    expect(rows[0]).toMatchObject({ actorRole: 'admin', status: 400 });
  });

  it('records bulk targets', async () => {
    const admin = await createUser({ role: 'admin' });
    const ids = ['64b7f0c2a1b2c3d4e5f60718', '64b7f0c2a1b2c3d4e5f60719'];
    await t.http().post(`${API}/admin/orders/bulk-transition`).set(bearer(admin.token)).send({ ids, to: 'packed' }).expect(200);
    const [row] = await entries();
    expect(row.targets).toEqual(ids);
    expect(row.permissions).toEqual(['orders:manage']);
  });

  it('serves a filterable, cursor-paginated log to auditors only', async () => {
    const admin = await createUser({ role: 'admin' });
    const product = await createProduct();
    for (const price of [10_000, 20_000, 30_000]) {
      await t.http().put(`${API}/products/${product._id}`).set(bearer(admin.token)).send({ price }).expect(200);
    }
    await entries(3);

    const support = await createUser({ role: 'support' });
    await t.http().get(`${API}/admin/audit-log`).set(bearer(support.token)).expect(403);

    const first = await t.http().get(`${API}/admin/audit-log?limit=2&target=${product._id}`).set(bearer(admin.token)).expect(200);
    expect(first.body.entries.map((e: { changes: { price: number } }) => e.changes.price)).toEqual([30_000, 20_000]);
    expect(first.body.entries[0].actor).toEqual({ id: admin.id, email: admin.user.email, role: 'admin' });
    const second = await t
      .http()
      .get(`${API}/admin/audit-log?limit=2&before=${first.body.nextCursor}`)
      .set(bearer(admin.token))
      .expect(200);
    expect(second.body.entries.map((e: { changes: { price: number } }) => e.changes.price)).toEqual([10_000]);
    expect(second.body.nextCursor).toBeNull();

    const byOther = await t.http().get(`${API}/admin/audit-log?actorId=${support.id}`).set(bearer(admin.token)).expect(200);
    expect(byOther.body.entries).toEqual([]);
  });
});

describe('audit helpers', () => {
  it('masks secrets and truncates large values', () => {
    const out = redact({ password: 'hunter2', nested: { apiToken: 'x', ok: 1 }, long: 'a'.repeat(500), list: Array(25).fill(1) }) as Record<
      string,
      unknown
    >;
    expect(out.password).toBe('[redacted]');
    expect(out.nested).toEqual({ apiToken: '[redacted]', ok: 1 });
    expect((out.long as string).length).toBe(201);
    expect((out.list as unknown[]).at(-1)).toBe('…5 more');
  });

  it('derives targets from the path, bulk ids or the created resource', () => {
    expect(targetsOf('/api/v1/products/64b7f0c2a1b2c3d4e5f60718', {}, {})).toEqual(['64b7f0c2a1b2c3d4e5f60718']);
    expect(targetsOf('/api/v1/admin/orders/bulk-transition', { ids: ['a', 'b'] }, {})).toEqual(['a', 'b']);
    expect(targetsOf('/api/v1/products', {}, { _id: 'new-id' })).toEqual(['new-id']);
  });
});
