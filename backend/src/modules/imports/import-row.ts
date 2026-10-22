import { ProductInputSchema, rupeesToPaise, type ProductInput } from '@storefront/contracts';
import { z } from 'zod';

export const IMPORT_COLUMNS = [
  'title',
  'slug',
  'category',
  'description',
  'price',
  'compare_at_price',
  'images',
  'sizes',
  'featured',
] as const;

const rupees = (field: string) =>
  z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, `${field} must be a rupee amount like 1499 or 1499.50`)
    .transform(v => rupeesToPaise(Number(v)));

const sizes = z
  .string()
  .min(1, 'sizes is required, e.g. S:4|M:10')
  .transform((v, ctx) =>
    v.split('|').map(part => {
      const [size, stock] = part.split(':').map(s => s.trim());
      if (!size || !/^\d+$/.test(stock ?? '')) {
        ctx.addIssue({ code: 'custom', message: `"${part}" is not SIZE:STOCK` });
        return { size: size ?? '', stock: 0 };
      }
      return { size, stock: Number(stock) };
    }),
  )
  .refine(list => new Set(list.map(s => s.size)).size === list.length, 'sizes must not repeat');

/** One CSV row: rupee prices, `|`-separated image URLs and `SIZE:STOCK|SIZE:STOCK` stock levels. */
export const CsvRowSchema = z
  .object({
    title: z.string().min(1, 'title is required'),
    slug: z.string().optional(),
    category: z.string().min(1, 'category is required'),
    description: z.string().optional(),
    price: rupees('price'),
    compare_at_price: rupees('compare_at_price').optional(),
    images: z
      .string()
      .min(1, 'images is required')
      .transform(v =>
        v
          .split('|')
          .map(s => s.trim())
          .filter(Boolean),
      ),
    sizes,
    featured: z
      .enum(['true', 'false', 'yes', 'no', '1', '0', ''])
      .optional()
      .transform(v => v === 'true' || v === 'yes' || v === '1'),
  })
  .transform(row => {
    const empty = (v?: string) => (v === undefined || v === '' ? undefined : v);
    return {
      title: row.title,
      slug: empty(row.slug),
      category: row.category,
      description: row.description ?? '',
      price: row.price,
      compareAtPrice: row.compare_at_price,
      images: row.images,
      sizes: row.sizes,
      featured: row.featured,
    };
  })
  .pipe(ProductInputSchema);

export type ParsedRow = { ok: true; product: ProductInput } | { ok: false; errors: string[] };

export function parseRow(raw: Record<string, string>): ParsedRow {
  const cleaned = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]));
  if (cleaned.compare_at_price === '') delete cleaned.compare_at_price;
  const result = CsvRowSchema.safeParse(cleaned);
  if (result.success) return { ok: true, product: result.data };
  return { ok: false, errors: result.error.issues.map(i => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)) };
}
