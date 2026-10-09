import { describe, expect, it } from 'vitest';
import { AuditLogModel } from '../src/modules/admin/audit-log.model';
import { createUser } from './helpers/factories';
import { API, bearer, useTestApp } from './helpers/app';

const t = useTestApp();

describe('admin user management', () => {
  it('lists and filters users for user managers only', async () => {
    const admin = await createUser({ role: 'admin', email: 'boss@test.dev' });
    await createUser({ email: 'asha@test.dev', name: 'Asha Verma' });
    await createUser({ email: 'kabir@test.dev', role: 'support' });

    const all = await t.http().get(`${API}/admin/users`).set(bearer(admin.token)).expect(200);
    expect(all.body).toMatchObject({ total: 3, page: 1, pages: 1 });

    const search = await t.http().get(`${API}/admin/users?q=verma`).set(bearer(admin.token)).expect(200);
    expect(search.body.users.map((u: { email: string }) => u.email)).toEqual(['asha@test.dev']);
    expect(search.body.users[0]).not.toHaveProperty('passwordHash');

    const staff = await t.http().get(`${API}/admin/users?role=support`).set(bearer(admin.token)).expect(200);
    expect(staff.body.users.map((u: { email: string }) => u.email)).toEqual(['kabir@test.dev']);

    const support = await createUser({ role: 'support' });
    await t.http().get(`${API}/admin/users`).set(bearer(support.token)).expect(403);
  });

  it('changes roles with immediate effect and an audited diff', async () => {
    const admin = await createUser({ role: 'admin' });
    const member = await createUser({ email: 'new-hire@test.dev' });
    await t.http().get(`${API}/admin/orders`).set(bearer(member.token)).expect(403);

    const res = await t
      .http()
      .patch(`${API}/admin/users/${member.id}/role`)
      .set(bearer(admin.token))
      .send({ role: 'fulfillment' })
      .expect(200);
    expect(res.body.user).toMatchObject({ id: member.id, role: 'fulfillment' });
    await t.http().get(`${API}/admin/orders`).set(bearer(member.token)).expect(200);

    for (let i = 0; i < 50 && !(await AuditLogModel.exists({})); i++) await new Promise(r => setTimeout(r, 20));
    const entry = await AuditLogModel.findOne().lean();
    expect(entry).toMatchObject({
      permissions: ['users:manage'],
      targets: [member.id],
      changes: { role: { from: 'customer', to: 'fulfillment' }, email: 'new-hire@test.dev' },
    });
  });

  it('guards against self-demotion and bad input', async () => {
    const admin = await createUser({ role: 'admin' });
    const self = await t
      .http()
      .patch(`${API}/admin/users/${admin.id}/role`)
      .set(bearer(admin.token))
      .send({ role: 'customer' })
      .expect(409);
    expect(self.body.error).toMatch(/your own role/);
    await t.http().patch(`${API}/admin/users/${admin.id}/role`).set(bearer(admin.token)).send({ role: 'superuser' }).expect(400);
    await t.http().patch(`${API}/admin/users/64b7f0c2a1b2c3d4e5f60718/role`).set(bearer(admin.token)).send({ role: 'support' }).expect(404);
    await t.http().patch(`${API}/admin/users/not-an-id/role`).set(bearer(admin.token)).send({ role: 'support' }).expect(400);
  });
});
