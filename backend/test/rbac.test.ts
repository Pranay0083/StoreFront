import { ROLES, type Role } from '@storefront/contracts';
import { describe, expect, it } from 'vitest';
import { createUser } from './helpers/factories';
import { API, bearer, useTestApp } from './helpers/app';

const t = useTestApp();

const PRODUCT = {
  title: 'RBAC Tee',
  category: 'Men',
  price: 99_900,
  images: ['https://images.unsplash.com/photo-rbac'],
  sizes: [{ size: 'M', stock: 3 }],
};

const ENDPOINTS: Array<{ name: string; allowed: Role[]; call: (token: string) => Promise<{ status: number }> }> = [
  {
    name: 'GET /admin/stats',
    allowed: ['support', 'fulfillment', 'catalog_manager', 'admin'],
    call: tk => t.http().get(`${API}/admin/stats`).set(bearer(tk)),
  },
  {
    name: 'GET /admin/orders',
    allowed: ['support', 'fulfillment', 'admin'],
    call: tk => t.http().get(`${API}/admin/orders`).set(bearer(tk)),
  },
  {
    name: 'POST /admin/orders/bulk-transition',
    allowed: ['fulfillment', 'admin'],
    call: tk =>
      t
        .http()
        .post(`${API}/admin/orders/bulk-transition`)
        .set(bearer(tk))
        .send({ ids: ['64b7f0c2a1b2c3d4e5f60718'], to: 'packed' }),
  },
  {
    name: 'GET /admin/conversations',
    allowed: ['support', 'admin'],
    call: tk => t.http().get(`${API}/admin/conversations`).set(bearer(tk)),
  },
  { name: 'GET /admin/coupons', allowed: ['catalog_manager', 'admin'], call: tk => t.http().get(`${API}/admin/coupons`).set(bearer(tk)) },
  {
    name: 'POST /products',
    allowed: ['catalog_manager', 'admin'],
    call: tk =>
      t
        .http()
        .post(`${API}/products`)
        .set(bearer(tk))
        .send({ ...PRODUCT, slug: `rbac-${Math.random().toString(36).slice(2)}` }),
  },
];

describe('permission matrix', () => {
  for (const endpoint of ENDPOINTS) {
    it(`${endpoint.name} is limited to ${endpoint.allowed.join(', ')}`, async () => {
      for (const role of ROLES) {
        const { token } = await createUser({ role });
        const { status } = await endpoint.call(token);
        if (endpoint.allowed.includes(role)) expect(status, `${role} should be allowed`).toBeLessThan(400);
        else expect(status, `${role} should be forbidden`).toBe(403);
      }
    });
  }

  it('rejects anonymous callers with 401 before checking permissions', async () => {
    await t.http().get(`${API}/admin/stats`).expect(401);
    await t.http().post(`${API}/products`).send(PRODUCT).expect(401);
  });

  it('exposes the caller permissions on /auth/me', async () => {
    const { token } = await createUser({ role: 'fulfillment' });
    const me = await t.http().get(`${API}/auth/me`).set(bearer(token)).expect(200);
    expect(me.body.user).toMatchObject({ role: 'fulfillment', permissions: ['dashboard:read', 'orders:read', 'orders:manage'] });
  });

  it('names the missing permission', async () => {
    const { token } = await createUser({ role: 'support' });
    const res = await t.http().get(`${API}/admin/coupons`).set(bearer(token)).expect(403);
    expect(res.body.error).toBe('Missing permission: promotions:write');
  });
});
