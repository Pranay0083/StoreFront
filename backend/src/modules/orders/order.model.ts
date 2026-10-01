import { ORDER_STATUSES, type Address, type OrderStatus } from '@storefront/contracts';
import mongoose, { Schema, type HydratedDocument, type Types } from 'mongoose';

export interface OrderItemRecord {
  productId: Types.ObjectId;
  title: string;
  image?: string;
  price: number;
  size: string;
  qty: number;
  slug?: string;
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
  status: OrderStatus;
  statusHistory: StatusEventRecord[];
  payment: OrderPaymentRecord;
  paidAt?: Date;
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
      },
    ],
    address: { name: String, line1: String, city: String, state: String, pincode: String, phone: String },
    subtotal: { type: Number, required: true },
    shipping: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    couponCode: String,
    total: { type: Number, required: true },
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
    },
    paidAt: Date,
  },
  { timestamps: true },
);

orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ 'payment.razorpayOrderId': 1 });

export const OrderModel = mongoose.model<OrderRecord>('Order', orderSchema);
