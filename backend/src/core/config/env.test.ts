import { describe, expect, it } from 'vitest';
import { ConfigError, loadEnv } from './env';

const base = { MONGO_URL: 'mongodb://localhost:27017' };
const ACCESS = 'a'.repeat(32);
const REFRESH = 'r'.repeat(32);

describe('loadEnv', () => {
  it('uses explicit, distinct access and refresh secrets', () => {
    const env = loadEnv({ ...base, JWT_ACCESS_SECRET: ACCESS, JWT_REFRESH_SECRET: REFRESH });
    expect(env.JWT_ACCESS_SECRET).toBe(ACCESS);
    expect(env.JWT_REFRESH_SECRET).toBe(REFRESH);
    expect(env.JWT_SECRETS_DERIVED).toBe(false);
    expect(env.CSRF_SECRET).toHaveLength(64);
    expect(env.CSRF_SECRET).not.toBe(ACCESS);
  });

  it('derives independent keys from the legacy JWT_SECRET', () => {
    const env = loadEnv({ ...base, JWT_SECRET: 'legacy-secret' });
    expect(env.JWT_SECRETS_DERIVED).toBe(true);
    expect(env.JWT_ACCESS_SECRET).not.toBe(env.JWT_REFRESH_SECRET);
    expect(env.JWT_ACCESS_SECRET).not.toContain('legacy-secret');
    expect(loadEnv({ ...base, JWT_SECRET: 'legacy-secret' }).JWT_ACCESS_SECRET).toBe(env.JWT_ACCESS_SECRET);
  });

  it('fails fast on missing, short or reused secrets', () => {
    expect(() => loadEnv(base)).toThrow(ConfigError);
    expect(() => loadEnv({ ...base, JWT_ACCESS_SECRET: 'short', JWT_REFRESH_SECRET: REFRESH })).toThrow(/at least 32/);
    expect(() => loadEnv({ ...base, JWT_ACCESS_SECRET: ACCESS, JWT_REFRESH_SECRET: ACCESS })).toThrow(/must differ/);
  });

  it('parses cookie, CORS and proxy settings', () => {
    const env = loadEnv({
      ...base,
      JWT_SECRET: 'legacy-secret',
      CORS_ORIGINS: 'https://shop.example.com, https://admin.example.com',
      TRUST_PROXY: '1',
      COOKIE_SAMESITE: 'lax',
      RATE_LIMIT_ENABLED: 'false',
    });
    expect(env.CORS_ORIGINS).toEqual(['https://shop.example.com', 'https://admin.example.com']);
    expect(env.TRUST_PROXY).toBe(1);
    expect(env.RATE_LIMIT_ENABLED).toBe(false);
    expect(() => loadEnv({ ...base, JWT_SECRET: 'legacy-secret', COOKIE_SAMESITE: 'none', COOKIE_SECURE: 'false' })).toThrow(/Secure/);
  });
});
