import mongoose, { Schema } from 'mongoose';

const userSchema = new Schema({
  email: { type: String, required: true, unique: true, lowercase: true },
  passwordHash: { type: String, required: true },
  name: { type: String, required: true },
  role: { type: String, enum: ['customer', 'admin'], default: 'customer' },
}, { timestamps: true });

const productSchema = new Schema({
  title: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  description: { type: String, default: '' },
  category: { type: String, required: true },
  price: { type: Number, required: true },
  compareAtPrice: { type: Number },
  images: { type: [String], default: [] },
  sizes: [{ size: String, stock: Number }],
  featured: { type: Boolean, default: false },
  rating: { type: Number, default: 0 },
  numReviews: { type: Number, default: 0 },
}, { timestamps: true });
productSchema.index({ category: 1, price: 1 });
productSchema.index({ title: 'text', description: 'text' });

const cartSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', unique: true, required: true },
  items: [{
    productId: { type: Schema.Types.ObjectId, ref: 'Product' },
    title: String, image: String, price: Number, size: String, qty: Number, slug: String,
  }],
}, { timestamps: true });

export const ORDER_STATUSES = ['created', 'paid', 'packed', 'shipped', 'delivered', 'cancelled', 'refunded'] as const;
export type OrderStatus = typeof ORDER_STATUSES[number];

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

const reviewSchema = new Schema({
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  userName: String,
  rating: { type: Number, min: 1, max: 5, required: true },
  comment: { type: String, default: '' },
}, { timestamps: true });
reviewSchema.index({ productId: 1, userId: 1 }, { unique: true });

const webhookEventSchema = new Schema({
  eventId: { type: String, required: true, unique: true },
  event: String,
  processedAt: { type: Date, default: Date.now },
});

const couponSchema = new Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  type: { type: String, enum: ['percent', 'flat'], required: true },
  value: { type: Number, required: true },
  minSubtotal: { type: Number, default: 0 },
  maxDiscount: { type: Number },
  usageLimit: { type: Number },
  usedCount: { type: Number, default: 0 },
  active: { type: Boolean, default: true },
  expiresAt: Date,
}, { timestamps: true });

const passwordResetTokenSchema = new Schema({
  token: { type: String, required: true, unique: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  expiresAt: { type: Date, required: true },
  used: { type: Boolean, default: false },
});
passwordResetTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const loginAttemptSchema = new Schema({
  identifier: { type: String, required: true, index: true },
  count: { type: Number, default: 0 },
  lockedUntil: Date,
}, { timestamps: true });

export const User = mongoose.model('User', userSchema);
export const Product = mongoose.model('Product', productSchema);
export const Cart = mongoose.model('Cart', cartSchema);
export const Order = mongoose.model('Order', orderSchema);
export const Review = mongoose.model('Review', reviewSchema);
export const WebhookEvent = mongoose.model('WebhookEvent', webhookEventSchema);
export const LoginAttempt = mongoose.model('LoginAttempt', loginAttemptSchema);
export const Coupon = mongoose.model('Coupon', couponSchema);
export const PasswordResetToken = mongoose.model('PasswordResetToken', passwordResetTokenSchema);
