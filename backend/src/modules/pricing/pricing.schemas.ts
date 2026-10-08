import { PROMOTION_STATUSES } from '@storefront/contracts';
import { z } from 'zod';

export { PricingQuoteRequestSchema, PromotionInputSchema, PromotionSimulationSchema, PromotionUpdateSchema } from '@storefront/contracts';

export const ObjectIdParamsSchema = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id') });

export const PromotionListQuerySchema = z.object({ status: z.enum(PROMOTION_STATUSES).optional().catch(undefined) });
