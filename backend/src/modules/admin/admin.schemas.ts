import { ORDER_STATUSES } from '@storefront/contracts';
import { z } from 'zod';

export { BulkTransitionSchema } from '@storefront/contracts';

export const RevenueQuerySchema = z.object({
  days: z.coerce
    .number()
    .int()
    .positive()
    .catch(30)
    .transform(d => Math.min(90, d)),
});

export const LowStockQuerySchema = z.object({
  threshold: z.coerce.number().positive().catch(5),
});

export const AdminOrdersQuerySchema = z.object({
  status: z.enum(ORDER_STATUSES).optional().catch(undefined),
  page: z.coerce
    .number()
    .int()
    .catch(1)
    .transform(n => Math.max(1, n)),
});
