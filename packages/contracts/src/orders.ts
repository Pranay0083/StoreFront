import { z } from 'zod';
import type { Paise } from './money';

export const ORDER_STATUSES = ['created', 'paid', 'packed', 'shipped', 'delivered', 'cancelled', 'refunded'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  created: ['paid', 'cancelled'],
  paid: ['packed', 'cancelled', 'refunded'],
  packed: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: ['refunded'],
  cancelled: ['refunded'],
  refunded: [],
};

export const canTransition = (from: OrderStatus, to: OrderStatus): boolean => ORDER_TRANSITIONS[from].includes(to);

export const REVENUE_STATUSES: readonly OrderStatus[] = ['paid', 'packed', 'shipped', 'delivered'];

export const AddressSchema = z
  .object({
    name: z.string({ required_error: 'Recipient name is required' }).min(2, 'Name must be at least 2 characters'),
    line1: z.string({ required_error: 'Address line 1 is required' }).min(4, 'Address line 1 must be at least 4 characters'),
    city: z.string({ required_error: 'City is required' }).min(2, 'City must be at least 2 characters'),
    state: z.string({ required_error: 'State is required' }).min(2, 'State must be at least 2 characters'),
    pincode: z.string({ required_error: 'Pincode is required' }).regex(/^\d{6}$/, 'Pincode must be exactly 6 digits'),
    phone: z.string({ required_error: 'Phone number is required' }).regex(/^\d{10}$/, 'Phone number must be exactly 10 digits'),
  })
  .strict();
export type Address = z.infer<typeof AddressSchema>;

export const CreateOrderSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            productId: z.string({ required_error: 'Product ID is required' }),
            size: z.string({ required_error: 'Size is required' }),
            qty: z
              .number({ required_error: 'Quantity is required' })
              .int('Quantity must be a whole number')
              .min(1, 'Quantity must be at least 1')
              .max(20, 'Quantity cannot exceed 20 per item'),
          })
          .strict(),
      )
      .min(1, 'Order must contain at least one item')
      .max(50, 'Order cannot exceed 50 distinct items'),
    couponCode: z.string().max(30).optional(),
    address: AddressSchema,
  })
  .strict();
export type CreateOrderInput = z.infer<typeof CreateOrderSchema>;

export const BulkTransitionSchema = z
  .object({
    ids: z.array(z.string()).min(1, 'At least one order ID is required').max(100, 'Cannot process more than 100 orders at once'),
    to: z.enum(ORDER_STATUSES, { required_error: 'Target status is required', invalid_type_error: 'Invalid order status' }),
  })
  .strict();
export type BulkTransitionInput = z.infer<typeof BulkTransitionSchema>;

export interface OrderItem {
  productId: string;
  title: string;
  image: string;
  price: Paise;
  size: string;
  qty: number;
  slug: string;
}

export interface StatusEvent {
  from: OrderStatus | null;
  to: OrderStatus;
  by: string;
  note: string;
  at: string;
}

export interface OrderPayment {
  provider: string;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  status: string;
}

export interface Order {
  _id: string;
  orderNumber: string;
  userId: string;
  items: OrderItem[];
  address: Address;
  subtotal: Paise;
  shipping: Paise;
  discount: Paise;
  couponCode?: string;
  total: Paise;
  status: OrderStatus;
  statusHistory: StatusEvent[];
  payment: OrderPayment;
  paidAt?: string;
  createdAt: string;
}
