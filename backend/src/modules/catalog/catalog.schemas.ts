import { ProductInputSchema } from '@storefront/contracts';
import { z } from 'zod';

export { ProductInputSchema, ProductListQuerySchema } from '@storefront/contracts';

export const ProductUpdateSchema = ProductInputSchema.partial();

export const SlugParamsSchema = z.object({ slug: z.string().min(1) });

export const SuggestQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
  limit: z.coerce.number().int().positive().max(10).catch(6).default(6),
});
