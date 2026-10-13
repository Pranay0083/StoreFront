import {
  ORDER_STATUSES,
  REFUND_STATES,
  type Address,
  type LineDiscount,
  type OrderPricing,
  type OrderStatus,
  type RefundState,
} from '@storefront/contracts';
import mongoose, { Schema, type HydratedDocument, type Types } from 'mongoose';

export interface OrderItemRecord {
  productId: Types.ObjectId;
  title: string;
  image?: string;
  price: number;
  size: string;
  qty: number;
  slug?: string;
  markdownPerUnit?: number;
  discounts?: LineDiscount[];
  lineTotal?: number;
}

export interface StatusEventRecord {
  from: OrderStatus | null;
  to: OrderStatus;
  by: string;
  note: string;
  at: Date;
}

export interface OrderPaymentRecord {
  provider: string;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  status: string;
  capturedAt?: Date;
}

export interface OrderRefundRecord {
  status: RefundState;
  amount: number;
  reason: string;
  requestedBy: string;
  requestedAt: Date;
  previousStatus: OrderStatus;
  gatewayRefundId?: string;
  completedAt?: Date;
  failureReason?: string;
}

export interface OrderRecord {
  _id: Types.ObjectId;
  orderNumber: string;
  userId: Types.ObjectId;
  items: OrderItemRecord[];
  address: Address;
  subtotal: number;
  shipping: number;
  discount: number;
  couponCode?: string;
  total: number;
  pricing?: OrderPricing;
  status: OrderStatus;
  statusHistory: StatusEventRecord[];
  payment: OrderPaymentRecord;
  refund?: OrderRefundRecord;
  paidAt?: Date;
  deliveredAt?: Date;
  reservedUntil?: Date;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export type OrderDocument = HydratedDocument<OrderRecord>;

const orderSchema = new Schema<OrderRecord>(
  {
    orderNumber: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    items: [
      {
        productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
        title: { type: String, required: true },
        image: String,
        price: { type: Number, required: true },
        size: { type: String, required: true },
        qty: { type: Number, required: true },
        slug: String,
        markdownPerUnit: { type: Number, default: 0 },
        discounts: [{ _id: false, promotionId: { type: String, required: true }, amount: { type: Number, required: true } }],
        lineTotal: { type: Number, required: true },
      },
    ],
    address: { name: String, line1: String, city: String, state: String, pincode: String, phone: String },
    subtotal: { type: Number, required: true },
    shipping: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    couponCode: String,
    total: { type: Number, required: true },
    pricing: {
      type: new Schema(
        {
          quoteId: String,
          codes: { type: [String], default: [] },
          applied: { type: [Schema.Types.Mixed], default: [] },
          stages: { type: Schema.Types.Mixed, required: true },
          optimizer: { type: Schema.Types.Mixed, required: true },
          explanations: { type: [String], default: [] },
        },
        { _id: false, minimize: false },
      ),
      required: false,
    },
    status: { type: String, enum: ORDER_STATUSES, default: 'created', required: true },
    statusHistory: [
      {
        from: { type: String, default: null },
        to: { type: String, required: true },
        by: { type: String, required: true },
        note: { type: String, default: '' },
        at: { type: Date, required: true },
      },
    ],
    payment: {
      provider: { type: String, default: 'demo' },
      razorpayOrderId: String,
      razorpayPaymentId: String,
      status: { type: String, default: 'pending' },
      capturedAt: Date,
    },
    refund: {
      type: new Schema(
        {
          status: { type: String, enum: REFUND_STATES, required: true },
          amount: { type: Number, required: true },
          reason: { type: String, required: true },
          requestedBy: { type: String, required: true },
          requestedAt: { type: Date, required: true },
          previousStatus: { type: String, enum: ORDER_STATUSES, required: true },
          gatewayRefundId: String,
          completedAt: Date,
          failureReason: String,
        },
        { _id: false },
      ),
      required: false,
    },
    paidAt: Date,
    deliveredAt: Date,
    reservedUntil: Date,
    version: { type: Number, default: 0, required: true },
  },
  { timestamps: true },
);

orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ 'payment.razorpayOrderId': 1 });
orderSchema.index({ 'payment.razorpayPaymentId': 1 }, { sparse: true });
orderSchema.index({ 'refund.gatewayRefundId': 1 }, { sparse: true });

export const OrderModel = mongoose.model<OrderRecord>('Order', orderSchema);
