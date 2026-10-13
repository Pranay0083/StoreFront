import { z } from 'zod';
import type { Paise } from './money';
import { PAYMENT_METHODS, type AppliedPromotion, type LineDiscount, type OptimizerReport } from './pricing';

export const ORDER_STATUSES = ['created', 'paid', 'packed', 'shipped', 'delivered', 'cancelled', 'refund_requested', 'refunded'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Full lifecycle. `cancelled` is reserved for orders that were never paid; any paid order leaves
 * through the refund saga (`refund_requested` → `refunded`), whose compensation path returns the
 * order to the status it had before the refund was requested.
 */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  created: ['paid', 'cancelled'],
  paid: ['packed', 'refund_requested'],
  packed: ['shipped', 'refund_requested'],
  shipped: ['delivered'],
  delivered: ['refund_requested'],
  cancelled: ['refund_requested'],
  refund_requested: ['refunded', 'paid', 'packed', 'delivered', 'cancelled'],
  refunded: [],
};

export const canTransition = (from: OrderStatus, to: OrderStatus): boolean => ORDER_TRANSITIONS[from].includes(to);

/** Transitions an operator may trigger by hand; payment and refund settlement are driven by the gateway. */
export const ADMIN_ORDER_ACTIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  created: ['cancelled'],
  paid: ['packed', 'refund_requested'],
  packed: ['shipped', 'refund_requested'],
  shipped: ['delivered'],
  delivered: ['refund_requested'],
  cancelled: [],
  refund_requested: [],
  refunded: [],
};

/** Statuses from which a customer may cancel; paid orders are cancelled by refunding them. */
export const CUSTOMER_CANCELLABLE_STATUSES: readonly OrderStatus[] = ['created', 'paid', 'packed'];

export const REFUND_WINDOW_DAYS = 7;

export const REVENUE_STATUSES: readonly OrderStatus[] = ['paid', 'packed', 'shipped', 'delivered'];

export const RefundRequestSchema = z
  .object({
    reason: z.string().trim().min(3, 'Please tell us why you want a refund').max(500, 'Reason is too long'),
  })
  .strict();
export type RefundRequestInput = z.infer<typeof RefundRequestSchema>;

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
    codes: z.array(z.string().trim().toUpperCase().min(1).max(30)).max(3, 'At most 3 promo codes per order').default([]),
    quoteId: z.string().uuid('quoteId must be a quote id from /pricing/quote').optional(),
    paymentMethod: z.enum(PAYMENT_METHODS).optional(),
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
  /** List price per unit at the time of purchase. */
  price: Paise;
  size: string;
  qty: number;
  slug: string;
  markdownPerUnit: Paise;
  /** Every promotion's share of this line, allocated to the paisa. */
  discounts: LineDiscount[];
  /** What the customer paid for this line, excluding shipping. */
  lineTotal: Paise;
}

export interface OrderPricingStages {
  listSubtotal: Paise;
  markdownTotal: Paise;
  bundleDiscount: Paise;
  cartDiscount: Paise;
  codeDiscount: Paise;
  shipping: Paise;
  shippingDiscount: Paise;
  total: Paise;
  totalSavings: Paise;
}

/** How the order was priced: the promotion versions applied and what each pricing stage contributed. */
export interface OrderPricing {
  quoteId?: string;
  codes: string[];
  applied: AppliedPromotion[];
  stages: OrderPricingStages;
  optimizer: OptimizerReport;
  explanations: string[];
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
  capturedAt?: string;
}

export const REFUND_STATES = ['requested', 'processing', 'pending', 'processed', 'failed'] as const;
export type RefundState = (typeof REFUND_STATES)[number];

export interface OrderRefund {
  status: RefundState;
  amount: Paise;
  reason: string;
  requestedBy: string;
  requestedAt: string;
  previousStatus: OrderStatus;
  gatewayRefundId?: string;
  completedAt?: string;
  failureReason?: string;
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
  /** Only on orders placed before promotions replaced coupons. */
  couponCode?: string;
  total: Paise;
  pricing?: OrderPricing;
  status: OrderStatus;
  statusHistory: StatusEvent[];
  payment: OrderPayment;
  refund?: OrderRefund;
  paidAt?: string;
  deliveredAt?: string;
  reservedUntil?: string;
  createdAt: string;
}
