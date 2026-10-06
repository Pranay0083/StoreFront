import { describe, expect, it } from 'vitest';
import { allowedOrigins } from '../src/core/http/security';
import { API, useTestApp } from './helpers/app';

const t = useTestApp();

describe('security headers', () => {
  it('locks down the JSON API responses', async () => {
    const res = await t.http().get(`${API}/`).expect(200);
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['cross-origin-resource-policy']).toBe('same-site');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('CORS', () => {
  it('allows credentialed requests only from the allow-list', async () => {
    const ok = await t.http().get(`${API}/`).set('Origin', 'http://localhost:3000').expect(200);
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(ok.headers['access-control-allow-credentials']).toBe('true');

    const evil = await t.http().get(`${API}/`).set('Origin', 'https://evil.example').expect(200);
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('permits the CSRF and idempotency headers in preflight', async () => {
    const res = await t
      .http()
      .options(`${API}/cart`)
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'PUT')
      .set('Access-Control-Request-Headers', 'content-type,x-csrf-token')
      .expect(204);
    expect(res.headers['access-control-allow-headers']).toMatch(/X-CSRF-Token/);
    expect(res.headers['access-control-allow-headers']).toMatch(/Idempotency-Key/);
    expect(res.headers['access-control-max-age']).toBe('600');
  });

  it('leaves MCP to its own open policy', async () => {
    const res = await t
      .http()
      .options(`${API}/mcp`)
      .set('Origin', 'https://some-agent.example')
      .set('Access-Control-Request-Method', 'POST')
      .expect(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('derives the allow-list from the environment', () => {
    expect(allowedOrigins({ NODE_ENV: 'production', FRONTEND_URL: 'https://shop.dev' })).toEqual(['https://shop.dev']);
    expect(allowedOrigins({ NODE_ENV: 'development', FRONTEND_URL: 'https://shop.dev' })).toContain('http://localhost:3000');
    expect(allowedOrigins({ NODE_ENV: 'production', FRONTEND_URL: 'https://shop.dev', CORS_ORIGINS: ['https://a.dev'] })).toEqual([
      'https://a.dev',
    ]);
  });
});
