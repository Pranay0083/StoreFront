import { z } from 'zod';
import type { Paise } from './money';

export const MAX_CART_LINES = 50;
export const MAX_LINE_QTY = 20;

/** What the client may tell the server about a cart: references only, never prices or titles. */
export const CartLineSchema = z.object({
  productId: z.string({ required_error: 'Product ID is required' }).regex(/^[a-f\d]{24}$/i, 'Invalid product ID'),
  size: z.string({ required_error: 'Size is required' }).min(1, 'Size is required').max(20, 'Size is too long'),
  qty: z
    .number({ required_error: 'Quantity is required' })
    .int('Quantity must be a whole number')
    .min(1, 'Quantity must be at least 1')
    .max(MAX_LINE_QTY, `Quantity cannot exceed ${MAX_LINE_QTY} per item`),
});
export type CartLine = z.infer<typeof CartLineSchema>;

export const UpdateCartSchema = z
  .object({
    items: z.array(CartLineSchema).max(MAX_CART_LINES, `Cart cannot exceed ${MAX_CART_LINES} distinct items`),
  })
  .strict();
export type UpdateCartInput = z.infer<typeof UpdateCartSchema>;

/** A cart line with catalog data filled in by the server (or a local snapshot until it is). */
export interface CartItem extends CartLine {
  title: string;
  image: string;
  price: Paise;
  slug: string;
  /** Units currently in stock for this size, as last reported by the server. */
  stock?: number;
  available?: boolean;
}

export interface CartResponse {
  items: CartItem[];
}

export const toCartLine = ({ productId, size, qty }: CartLine): CartLine => ({ productId, size, qty });
