import mongoose, { Schema } from 'mongoose';
import { ORDER_STATUSES } from '../types';

const orderSchema = new Schema({
  orderNumber: { type: String, required: true, unique: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  items: [{
    productId: { type: Schema.Types.ObjectId, ref: 'Product' },
    title: String, image: String, price: Number, size: String, qty: Number, slug: String,
  }],
  address: { name: String, line1: String, city: String, state: String, pincode: String, phone: String },
  subtotal: Number,
  shipping: Number,
  discount: { type: Number, default: 0 },
  couponCode: String,
  total: Number,
  status: { type: String, enum: ORDER_STATUSES, default: 'created' },
  statusHistory: [{ from: String, to: String, by: String, note: String, at: Date }],
  payment: {
    provider: { type: String, default: 'demo' },
    razorpayOrderId: String,
    razorpayPaymentId: String,
    status: { type: String, default: 'pending' },
  },
  paidAt: Date,
}, { timestamps: true });

orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ 'payment.razorpayOrderId': 1 });

export const Order = mongoose.model('Order', orderSchema);
