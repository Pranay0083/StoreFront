import { describe, expect, it } from 'vitest';
import { AuthSessionModel } from '../src/modules/auth/session.model';
import { createUser } from './helpers/factories';
import { API, bearer, useTestApp } from './helpers/app';
import { cookieFrom } from './helpers/cookies';

const t = useTestApp();

async function signIn(email: string, password: string) {
  const res = await t.http().post(`${API}/auth/login`).send({ email, password }).expect(200);
  return { token: res.body.token as string, refresh: cookieFrom(res, 'refresh_token')! };
}

const refresh = (cookie: string) => t.http().post(`${API}/auth/refresh`).set('Cookie', cookie);

describe('refresh token rotation', () => {
  it('rotates the refresh token on every use and stores only fingerprints', async () => {
    const { password } = await createUser({ email: 'rot@test.dev' });
    const first = await signIn('rot@test.dev', password);

    const res = await refresh(first.refresh).expect(200);
    const second = cookieFrom(res, 'refresh_token')!;
    expect(second).toBeDefined();
    expect(second).not.toBe(first.refresh);
    await refresh(second).expect(200);

    const [family] = await AuthSessionModel.find().lean();
    expect(family.currentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(family)).not.toContain(second.split('=')[1]);
  });

  it('revokes the whole family when a rotated token is replayed', async () => {
    const { password } = await createUser({ email: 'thief@test.dev' });
    const stolen = (await signIn('thief@test.dev', password)).refresh;
    const legit = cookieFrom(await refresh(stolen).expect(200), 'refresh_token')!;
    await AuthSessionModel.updateMany({}, { $set: { rotatedAt: new Date(Date.now() - 60_000) } });

    await refresh(stolen).expect(401);
    const [family] = await AuthSessionModel.find().lean();
    expect(family.revokedReason).toBe('reuse_detected');
    await refresh(legit).expect(401);
  });

  it('tolerates a concurrent replay inside the grace window without revoking', async () => {
    const { password } = await createUser({ email: 'tabs@test.dev' });
    const original = (await signIn('tabs@test.dev', password)).refresh;
    const next = cookieFrom(await refresh(original).expect(200), 'refresh_token')!;

    await refresh(original).expect(401);
    expect((await AuthSessionModel.findOne().lean())!.revokedAt).toBeUndefined();
    await refresh(next).expect(200);
  });

  it('rejects refresh tokens whose family is unknown or signed with the access key', async () => {
    const user = await createUser();
    await refresh(`refresh_token=${user.token}`).expect(401);
    await refresh('refresh_token=garbage').expect(401);
  });
});

describe('logout', () => {
  it('revokes the current family', async () => {
    const { password } = await createUser({ email: 'bye@test.dev' });
    const session = await signIn('bye@test.dev', password);
    const res = await t.http().post(`${API}/auth/logout`).set('Cookie', session.refresh).expect(200);
    expect(cookieFrom(res, 'refresh_token')).toBe('refresh_token=');
    await refresh(session.refresh).expect(401);
    expect((await AuthSessionModel.findOne().lean())!.revokedReason).toBe('logout');
  });

  it('logout-all revokes every family and outstanding access tokens', async () => {
    const { password } = await createUser({ email: 'all@test.dev' });
    const laptop = await signIn('all@test.dev', password);
    const phone = await signIn('all@test.dev', password);

    const res = await t.http().post(`${API}/auth/logout-all`).set(bearer(laptop.token)).expect(200);
    expect(res.body.revoked).toBe(2);
    await refresh(laptop.refresh).expect(401);
    await refresh(phone.refresh).expect(401);
    await t.http().get(`${API}/auth/me`).set(bearer(phone.token)).expect(401);

    const again = await signIn('all@test.dev', password);
    await t.http().get(`${API}/auth/me`).set(bearer(again.token)).expect(200);
  });
});

describe('session management', () => {
  it('lists active sessions and lets the owner revoke one', async () => {
    const { password } = await createUser({ email: 'devices@test.dev' });
    const laptop = await signIn('devices@test.dev', password);
    const phone = await signIn('devices@test.dev', password);

    const list = await t.http().get(`${API}/auth/sessions`).set(bearer(laptop.token)).set('Cookie', laptop.refresh).expect(200);
    expect(list.body.sessions).toHaveLength(2);
    const other = list.body.sessions.find((s: { current: boolean }) => !s.current);
    expect(list.body.sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1);

    await t.http().delete(`${API}/auth/sessions/${other.id}`).set(bearer(laptop.token)).expect(200);
    await refresh(phone.refresh).expect(401);
    await refresh(laptop.refresh).expect(200);

    const stranger = await createUser();
    await t.http().delete(`${API}/auth/sessions/${other.id}`).set(bearer(stranger.token)).expect(404);
  });
});
