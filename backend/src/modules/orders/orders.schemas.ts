import { z } from 'zod';

export { BulkTransitionSchema, CreateOrderSchema, RefundRequestSchema } from '@storefront/contracts';

export const OrderIdParamsSchema = z.object({ id: z.string().min(1) });
