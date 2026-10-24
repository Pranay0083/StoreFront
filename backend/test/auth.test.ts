import { describe, expect, it } from 'vitest';
import { createUser } from './helpers/factories';
import { fetchCsrf } from './helpers/cookies';
import { API, bearer, useTestApp } from './helpers/app';

const t = useTestApp();

const cookieValue = (setCookie: string[] | string | undefined, name: string) => {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return list.find(c => c.startsWith(`${name}=`))?.split(';')[0];
};

describe('auth', () => {
  it('registers a user and issues auth cookies', async () => {
    const res = await t
      .http()
      .post(`${API}/auth/register`)
      .send({ name: 'Asha', email: 'Asha@Example.com', password: 'secret123' })
      .expect(201);
    expect(res.body.user).toMatchObject({ email: 'asha@example.com', name: 'Asha', role: 'customer' });
    expect(res.body.token).toBeTypeOf('string');
    expect(cookieValue(res.headers['set-cookie'], 'access_token')).toBeDefined();
    expect(cookieValue(res.headers['set-cookie'], 'refresh_token')).toBeDefined();

    await t.http().post(`${API}/auth/register`).send({ name: 'Asha', email: 'asha@example.com', password: 'secret123' }).expect(409);
  });

  it('rejects invalid registration payloads', async () => {
    const res = await t.http().post(`${API}/auth/register`).send({ name: 'A', email: 'nope', password: '1' }).expect(400);
    expect(res.body.details.map((d: { path: string }) => d.path).sort()).toEqual(['email', 'name', 'password']);
  });

  it('logs in with valid credentials and resolves the current user', async () => {
    const { user, password } = await createUser({ email: 'kabir@test.dev' });
    const res = await t.http().post(`${API}/auth/login`).send({ email: 'kabir@test.dev', password }).expect(200);
    expect(res.body.user.id).toBe(String(user._id));

    const me = await t.http().get(`${API}/auth/me`).set(bearer(res.body.token)).expect(200);
    expect(me.body.user.email).toBe('kabir@test.dev');
    await t.http().get(`${API}/auth/me`).expect(401);
  });

  it('reports guests from /auth/session without an error status', async () => {
    const { password } = await createUser({ email: 'ananya@test.dev' });
    expect((await t.http().get(`${API}/auth/session`).expect(200)).body).toEqual({ user: null });
    const res = await t.http().post(`${API}/auth/login`).send({ email: 'ananya@test.dev', password }).expect(200);
    const session = await t.http().get(`${API}/auth/session`).set(bearer(res.body.token)).expect(200);
    expect(session.body.user.email).toBe('ananya@test.dev');
  });

  it('throttles the account after repeated failed attempts', async () => {
    const { password } = await createUser({ email: 'meera@test.dev' });
    for (let i = 0; i < 3; i++) {
      await t.http().post(`${API}/auth/login`).send({ email: 'meera@test.dev', password: 'wrong-password' }).expect(401);
    }
    const throttled = await t.http().post(`${API}/auth/login`).send({ email: 'meera@test.dev', password }).expect(429);
    expect(throttled.body.error).toMatch(/Too many failed attempts/);
  });

  it('refreshes the session from the refresh cookie', async () => {
    const reg = await t
      .http()
      .post(`${API}/auth/register`)
      .send({ name: 'Ravi', email: 'ravi@test.dev', password: 'secret123' })
      .expect(201);
    const refreshCookie = cookieValue(reg.headers['set-cookie'], 'refresh_token')!;
    const csrf = await fetchCsrf(t);
    const res = await t
      .http()
      .post(`${API}/auth/refresh`)
      .set({ Cookie: `${refreshCookie}; ${csrf.cookie}`, 'X-CSRF-Token': csrf.token })
      .expect(200);
    expect(res.body.user.email).toBe('ravi@test.dev');
    await t.http().post(`${API}/auth/refresh`).expect(401);
  });
});
