import { z } from 'zod';

export { ReviewInputSchema } from '@storefront/contracts';

export const ProductIdParamsSchema = z.object({ productId: z.string().min(1) });
