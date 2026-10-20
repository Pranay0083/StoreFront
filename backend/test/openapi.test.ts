import { describe, expect, it } from 'vitest';
import { API, useTestApp } from './helpers/app';

const t = useTestApp();

type Operation = {
  operationId: string;
  security?: unknown[];
  requestBody?: { content: Record<string, unknown> };
  parameters?: Array<{ name: string; in: string }>;
  'x-permissions'?: string[];
  responses: Record<string, { content?: Record<string, unknown> }>;
};

describe('OpenAPI', () => {
  it('describes every mounted route with schemas, parameters and security', async () => {
    const res = await t.http().get(`${API}/openapi.json`).expect(200);
    const spec = res.body as { openapi: string; paths: Record<string, Record<string, Operation>>; components: Record<string, unknown> };
    expect(spec.openapi).toBe('3.1.0');

    const expected = t.container.routes
      .filter(([mount]) => mount !== '/openapi.json' && mount !== '/docs')
      .flatMap(([mount, router]) =>
        (router as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> }).stack
          .filter(l => l.route)
          .flatMap(l =>
            Object.keys(l.route!.methods)
              .filter(m => m !== '_all' && m !== 'options')
              .map(m => `${m} ${`${mount}${l.route!.path === '/' ? '' : l.route!.path}`.replace(/:(\w+)/g, '{$1}') || '/'}`),
          ),
      );
    const documented = Object.entries(spec.paths).flatMap(([path, ops]) => Object.keys(ops).map(m => `${m} ${path}`));
    expect(documented.sort()).toEqual([...new Set(expected)].sort());
    const operations = Object.values(spec.paths).flatMap(p => Object.values(p));
    expect(new Set(operations.map(o => o.operationId)).size).toBe(operations.length);

    const createOrder = spec.paths['/orders'].post;
    expect(createOrder.requestBody!.content['application/json']).toBeTruthy();
    expect(createOrder.security).toEqual([{ bearerAuth: [] }, { cookieAuth: [] }]);

    const recs = spec.paths['/products/{id}/recommendations'].get;
    expect(recs.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'id', in: 'path' }),
        expect.objectContaining({ name: 'limit', in: 'query' }),
      ]),
    );
    expect(recs.security).toEqual([]);

    expect(spec.paths['/admin/flags'].post['x-permissions']).toEqual(['experiments:manage']);
    expect(spec.paths['/admin/imports'].post.requestBody!.content['multipart/form-data']).toBeTruthy();
    expect(spec.paths['/realtime/stream'].get.responses['2XX'].content!['text/event-stream']).toBeTruthy();
    expect(spec.paths['/pricing/quote'].post.security).toContainEqual({});
  });

  it('serves interactive docs with a CSP that allows only same-origin assets', async () => {
    await t.http().get(`${API}/docs`).expect(301).expect('location', `${API}/docs/`);
    const page = await t.http().get(`${API}/docs/`).expect(200);
    expect(page.text).toMatch(/swagger-ui/i);
    expect(page.headers['content-security-policy']).toMatch(/script-src 'self'/);
    const init = await t.http().get(`${API}/docs/swagger-ui-init.js`).expect(200);
    expect(init.text).toContain(`${API}/openapi.json`);
  });
});
