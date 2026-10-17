import { describe, expect, it } from 'vitest';
import { parseRow } from './import-row';

const base = {
  title: 'Linen Shirt',
  category: 'Men',
  price: '2499.50',
  images: 'https://images.unsplash.com/a | https://images.unsplash.com/b',
  sizes: 'S:4|M:10',
};

describe('parseRow', () => {
  it('converts rupees to paise and splits images and sizes', () => {
    const parsed = parseRow({ ...base, compare_at_price: '2999', featured: 'yes' });
    expect(parsed).toEqual({
      ok: true,
      product: {
        title: 'Linen Shirt',
        category: 'Men',
        description: '',
        price: 249_950,
        compareAtPrice: 299_900,
        images: ['https://images.unsplash.com/a', 'https://images.unsplash.com/b'],
        sizes: [
          { size: 'S', stock: 4 },
          { size: 'M', stock: 10 },
        ],
        featured: true,
      },
    });
  });

  it('treats blank optional cells as absent', () => {
    const parsed = parseRow({ ...base, slug: '', compare_at_price: '', featured: '' });
    expect(parsed.ok && parsed.product).toMatchObject({ featured: false });
    expect(parsed.ok && 'compareAtPrice' in parsed.product && parsed.product.compareAtPrice).toBeFalsy();
  });

  it('reports every problem in a row', () => {
    const parsed = parseRow({ title: '', category: 'Men', price: '12,00', images: 'not-a-url', sizes: 'M-3|M:2' });
    expect(parsed.ok).toBe(false);
    const errors = parsed.ok ? [] : parsed.errors.join(' | ');
    expect(errors).toMatch(/title is required/);
    expect(errors).toMatch(/price must be a rupee amount/);
    expect(errors).toMatch(/"M-3" is not SIZE:STOCK/);
  });

  it('rejects duplicate sizes and invalid image URLs', () => {
    expect(parseRow({ ...base, sizes: 'M:1|M:2' })).toMatchObject({ ok: false, errors: [expect.stringMatching(/must not repeat/)] });
    expect(parseRow({ ...base, images: 'ftp//x' })).toMatchObject({ ok: false });
  });
});
