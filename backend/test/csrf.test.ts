import { describe, expect, it } from 'vitest';
import { CookiePolicy } from '../src/core/http/cookies';
import { createUser } from './helpers/factories';
import { API, bearer, useTestApp } from './helpers/app';
import { cookieFrom, fetchCsrf, setCookieHeader } from './helpers/cookies';

const t = useTestApp();

async function cookieSession() {
  const { password, user } = await createUser({ email: `csrf-${Date.now()}-${Math.random()}@test.dev` });
  const res = await t.http().post(`${API}/auth/login`).send({ email: user.email, password }).expect(200);
  return {
    access: cookieFrom(res, 'access_token')!,
    csrfCookie: cookieFrom(res, 'csrf_token')!,
    csrfToken: res.body.csrfToken as string,
  };
}

const cart = { items: [] };

describe('CSRF protection', () => {
  it('rejects cookie-authenticated writes without a matching token', async () => {
    const s = await cookieSession();
    const missing = await t.http().put(`${API}/cart`).set('Cookie', s.access).send(cart).expect(403);
    expect(missing.body.code).toBe('CSRF_INVALID');

    await t
      .http()
      .put(`${API}/cart`)
      .set({ Cookie: `${s.access}; ${s.csrfCookie}`, 'X-CSRF-Token': 'not-the-token' })
      .send(cart)
      .expect(403);

    const forged = 'attacker.chosen';
    await t
      .http()
      .put(`${API}/cart`)
      .set({ Cookie: `${s.access}; csrf_token=${forged}`, 'X-CSRF-Token': forged })
      .send(cart)
      .expect(403);
  });

  it('accepts writes that echo the issued token', async () => {
    const s = await cookieSession();
    expect(s.csrfCookie).toBe(`csrf_token=${s.csrfToken}`);
    await t
      .http()
      .put(`${API}/cart`)
      .set({ Cookie: `${s.access}; ${s.csrfCookie}`, 'X-CSRF-Token': s.csrfToken })
      .send(cart)
      .expect(200);
  });

  it('does not apply to reads, Bearer clients, anonymous requests or exempt endpoints', async () => {
    const s = await cookieSession();
    await t.http().get(`${API}/cart`).set('Cookie', s.access).expect(200);

    const user = await createUser();
    await t.http().put(`${API}/cart`).set(bearer(user.token)).set('Cookie', s.access).send(cart).expect(200);

    await t.http().post(`${API}/auth/login`).send({ email: 'nobody@test.dev', password: 'x' }).expect(401);

    const webhook = await t.http().post(`${API}/payments/webhook`).set('Cookie', s.access).send({});
    expect(webhook.status).not.toBe(403);
  });

  it('reuses a valid token and rotates it when the session changes', async () => {
    const first = await fetchCsrf(t);
    const again = await t.http().get(`${API}/auth/csrf`).set('Cookie', first.cookie).expect(200);
    expect(again.body.csrfToken).toBe(first.token);

    const { password, user } = await createUser();
    const login = await t.http().post(`${API}/auth/login`).set('Cookie', first.cookie).send({ email: user.email, password }).expect(200);
    expect(login.body.csrfToken).not.toBe(first.token);
  });
});

describe('cookie policy', () => {
  it('scopes and flags auth cookies', async () => {
    const { password, user } = await createUser();
    const res = await t.http().post(`${API}/auth/login`).send({ email: user.email, password }).expect(200);
    const access = setCookieHeader(res, 'access_token')!;
    const refresh = setCookieHeader(res, 'refresh_token')!;
    const csrf = setCookieHeader(res, 'csrf_token')!;
    expect(access).toMatch(/HttpOnly/);
    expect(access).toMatch(/SameSite=Lax/);
    expect(refresh).toMatch(/Path=\/api\/v1\/auth/);
    expect(refresh).toMatch(/HttpOnly/);
    expect(csrf).not.toMatch(/HttpOnly/);
  });

  it('defaults to SameSite=None; Secure in production and honours overrides', () => {
    expect(new CookiePolicy({ NODE_ENV: 'production' }).base).toMatchObject({ sameSite: 'none', secure: true });
    expect(new CookiePolicy({ NODE_ENV: 'development' }).base).toMatchObject({ sameSite: 'lax', secure: false });
    expect(new CookiePolicy({ NODE_ENV: 'production', COOKIE_SAMESITE: 'strict', COOKIE_DOMAIN: 'shop.dev' }).base).toMatchObject({
      sameSite: 'strict',
      secure: true,
      domain: 'shop.dev',
    });
  });
});
