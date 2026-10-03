import bcrypt from 'bcryptjs';
import { describe, expect, it, vi } from 'vitest';
import { LoginAttemptModel } from '../src/modules/auth/login-attempt.model';
import { backoffMs, LOGIN_THROTTLE_POLICIES } from '../src/modules/auth/login-throttle';
import { createUser } from './helpers/factories';
import { API, useTestApp } from './helpers/app';

process.env.TRUST_PROXY = '1';
const t = useTestApp();

const login = (email: string, password: string, ip = '203.0.113.10') =>
  t.http().post(`${API}/auth/login`).set('X-Forwarded-For', ip).send({ email, password });

const fail = async (email: string, times: number, ip?: string) => {
  for (let i = 0; i < times; i++) expect([401, 429]).toContain((await login(email, 'wrong-password', ip)).status);
};

describe('backoffMs', () => {
  it('grows exponentially after the free attempts and is capped', () => {
    const [ipEmail] = LOGIN_THROTTLE_POLICIES;
    expect([2, 3, 4, 5, 6].map(n => backoffMs(n, ipEmail))).toEqual([0, 1_000, 2_000, 4_000, 8_000]);
    expect(backoffMs(50, ipEmail)).toBe(ipEmail.maxDelayMs);
  });
});

describe('login throttling', () => {
  it('slows repeated failures from one IP with a Retry-After hint', async () => {
    const { password } = await createUser({ email: 'meera@test.dev' });
    await fail('meera@test.dev', 3);
    const res = await login('meera@test.dev', password).expect(429);
    expect(res.headers['retry-after']).toBe('1');
    expect(res.body.code).toBe('TOO_MANY_REQUESTS');
  });

  it('does not lock the real owner out from another network', async () => {
    const { password } = await createUser({ email: 'owner@test.dev' });
    await fail('owner@test.dev', 6, '198.51.100.7');
    await login('owner@test.dev', password, '198.51.100.7').expect(429);
    await login('owner@test.dev', password, '203.0.113.99').expect(200);
  });

  it('lets the user in once the backoff has elapsed and resets the counter', async () => {
    const { password } = await createUser({ email: 'patient@test.dev' });
    await fail('patient@test.dev', 4);
    await login('patient@test.dev', password).expect(429);
    await LoginAttemptModel.updateMany({}, { $set: { lastFailureAt: new Date(Date.now() - 60_000) } });
    await login('patient@test.dev', password).expect(200);
    expect(await LoginAttemptModel.exists({ identifier: 'ip:203.0.113.10|email:patient@test.dev' })).toBeNull();
  });

  it('throttles an account under attack from many IPs', async () => {
    const { password } = await createUser({ email: 'target@test.dev' });
    for (let i = 0; i < 10; i++) await fail('target@test.dev', 1, `192.0.2.${i}`);
    await login('target@test.dev', password, '192.0.2.200').expect(429);
  });

  it('spends a bcrypt compare on unknown emails and gives the same answer', async () => {
    const spy = vi.spyOn(bcrypt, 'compare');
    const unknown = await login('ghost@test.dev', 'whatever').expect(401);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();

    await createUser({ email: 'real@test.dev' });
    const known = await login('real@test.dev', 'whatever', '203.0.113.11').expect(401);
    expect(unknown.body).toEqual(known.body);
  });
});
