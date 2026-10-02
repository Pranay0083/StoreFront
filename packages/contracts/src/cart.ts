import { z } from 'zod';
import { PaiseSchema, type Paise } from './money';

export const CartItemSchema = z.object({
  productId: z.string({ required_error: 'Product ID is required' }),
  title: z.string({ required_error: 'Product title is required' }),
  image: z.string({ required_error: 'Product image is required' }),
  price: PaiseSchema,
  size: z.string({ required_error: 'Size is required' }),
  qty: z
    .number({ required_error: 'Quantity is required' })
    .int('Quantity must be a whole number')
    .min(1, 'Quantity must be at least 1')
    .max(20, 'Quantity cannot exceed 20 per item'),
  slug: z.string({ required_error: 'Product slug is required' }),
});

export const UpdateCartSchema = z
  .object({
    items: z.array(CartItemSchema).max(50, 'Cart cannot exceed 50 distinct items'),
  })
  .strict();
export type UpdateCartInput = z.infer<typeof UpdateCartSchema>;

export interface CartItem {
  productId: string;
  title: string;
  image: string;
  price: Paise;
  size: string;
  qty: number;
  slug: string;
}
