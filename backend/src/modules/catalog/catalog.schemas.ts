import { ProductInputSchema } from '@storefront/contracts';
import { z } from 'zod';

export { ProductInputSchema, ProductListQuerySchema } from '@storefront/contracts';

export const ProductUpdateSchema = ProductInputSchema.partial();

export const SlugParamsSchema = z.object({ slug: z.string().min(1) });
