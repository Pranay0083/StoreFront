import { describe, expect, it, vi } from 'vitest';
import { UnrecoverableJobError } from '../../core/queue/job-queue';
import type { ProductRecord } from '../catalog/product.model';
import { StorefrontRevalidator } from './storefront-revalidator';

const logger = { debug: vi.fn(), warn: vi.fn() };
const products = {
  findById: vi.fn(async (id: string) => (id === 'p1' ? ({ slug: 'oxford-shirt' } as ProductRecord) : null)),
};

function revalidator(status = 200) {
  const http = vi.fn(async () => new Response('{}', { status }));
  const r = new StorefrontRevalidator({ url: 'http://web/api/revalidate', secret: 'x'.repeat(16) }, products, logger, http);
  return { r, http };
}

describe('StorefrontRevalidator', () => {
  it('maps product ids to listing, id and slug tags', async () => {
    const { r } = revalidator();
    expect(await r.tagsFor(['p1', 'gone', 'p1'])).toEqual(['product-id:gone', 'product-id:p1', 'product:oxford-shirt', 'products']);
  });

  it('posts the tags with the shared secret', async () => {
    const { r, http } = revalidator();
    await r.revalidate(['products']);
    const [url, init] = http.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://web/api/revalidate');
    expect((init.headers as Record<string, string>)['x-revalidate-secret']).toBe('x'.repeat(16));
    expect(JSON.parse(init.body as string)).toEqual({ tags: ['products'] });
  });

  it('does not retry when the storefront rejects the secret', async () => {
    await expect(revalidator(401).r.revalidate(['products'])).rejects.toBeInstanceOf(UnrecoverableJobError);
    await expect(revalidator(503).r.revalidate(['products'])).rejects.not.toBeInstanceOf(UnrecoverableJobError);
  });
});
