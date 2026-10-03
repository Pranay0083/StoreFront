import { z } from 'zod';

export { LoginSchema, RegisterSchema } from '@storefront/contracts';

export const SessionIdParamsSchema = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid session id') });
