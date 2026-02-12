export interface User {
  id: string;
  email: string;
  name: string;
  role: 'customer' | 'admin';
}

export interface SizeVariant {
  size: string;
  stock: number;
}

export interface Product {
  _id: string;
  title: string;
  slug: string;
  description: string;
  category: string;
  price: number;
  compareAtPrice?: number;
  images: string[];
  sizes: SizeVariant[];
  featured: boolean;
  rating: number;
  numReviews: number;
}

export interface CartItem {
  productId: string;
  title: string;
  image: string;
  price: number;
  size: string;
  qty: number;
  slug: string;
}

export type OrderStatus = 'created' | 'paid' | 'packed' | 'shipped' | 'delivered' | 'cancelled' | 'refunded';

export interface StatusEvent {
  from: string | null;
  to: OrderStatus;
  by: string;
  note: string;
  at: string;
}

export interface Order {
  _id: string;
  orderNumber: string;
  userId: string;
  items: CartItem[];
  address: { name: string; line1: string; city: string; state: string; pincode: string; phone: string };
  subtotal: number;
  shipping: number;
  discount: number;
  couponCode?: string;
  total: number;
  status: OrderStatus;
  statusHistory: StatusEvent[];
  payment: { provider: string; razorpayOrderId?: string; razorpayPaymentId?: string; status: string };
  createdAt: string;
}

export interface Coupon {
  _id: string;
  code: string;
  type: 'percent' | 'flat';
  value: number;
  minSubtotal: number;
  maxDiscount?: number;
  usageLimit?: number;
  usedCount: number;
  active: boolean;
  expiresAt?: string;
  createdAt: string;
}

export interface Review {
  _id: string;
  userName: string;
  rating: number;
  comment: string;
  createdAt: string;
}
