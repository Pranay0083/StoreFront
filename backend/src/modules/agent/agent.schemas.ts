import { z } from 'zod';

export const ChatSchema = z
  .object({
    sessionId: z
      .string({ required_error: 'Session ID is required' })
      .min(8, 'Session ID must be at least 8 characters')
      .max(80, 'Session ID is too long'),
    message: z
      .string({ required_error: 'Message is required' })
      .min(1, 'Message cannot be empty')
      .max(2000, 'Message cannot exceed 2000 characters'),
    context: z
      .object({
        path: z.string().max(200).optional(),
        cart: z
          .array(z.object({ title: z.string(), size: z.string(), qty: z.number(), price: z.number() }))
          .max(30)
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type ChatBody = z.infer<typeof ChatSchema>;

export const HistoryQuerySchema = z.object({ sessionId: z.string().optional().default('') });
