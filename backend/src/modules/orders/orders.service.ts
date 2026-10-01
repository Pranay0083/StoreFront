import type { CreateOrderInput, OrderStatus } from '@storefront/contracts';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../core/errors';
import type { AuthUser } from '../../core/http/types';
import { logger } from '../../core/logger';
import type { CartService } from '../cart/cart.service';
import type { ProductRepository } from '../catalog/product.repository';
import type { CouponService } from '../coupons/coupons.service';
import { generateOrderNumber } from './order-number';
import { OrderStateMachine } from './order-state-machine';
import type { OrderDocument, OrderRecord } from './order.model';
import type { OrderRepository } from './order.repository';

const FREE_SHIPPING_ABOVE = 2999;
const SHIPPING_FEE = 99;

export interface PaymentInfo {
  razorpayPaymentId?: string;
}

export class OrdersService {
  constructor(
    private readonly orders: OrderRepository,
    private readonly products: ProductRepository,
    private readonly coupons: CouponService,
    private readonly cart: CartService,
  ) {}

  async create(input: CreateOrderInput, user: AuthUser): Promise<OrderDocument> {
    const items = [];
    for (const line of input.items) {
      const product = await this.products.findById(line.productId);
      if (!product) throw new BadRequestError(`Product not found: ${line.productId}`);
      const variant = product.sizes.find(s => s.size === line.size);
      if (!variant) throw new BadRequestError(`Size ${line.size} not available for ${product.title}`);
      if (variant.stock < line.qty) {
        logger.warn({ productId: line.productId, requested: line.qty, available: variant.stock }, 'Insufficient stock during checkout');
        throw new ConflictError(`Only ${variant.stock} left of ${product.title} (${line.size})`);
      }
      items.push({
        productId: product._id,
        title: product.title,
        image: product.images[0],
        price: product.price,
        size: line.size,
        qty: line.qty,
        slug: product.slug,
      });
    }

    const subtotal = items.reduce((sum, i) => sum + i.price * i.qty, 0);
    let discount = 0;
    let couponCode: string | undefined;
    if (input.couponCode) {
      const quote = await this.coupons.quote(input.couponCode, subtotal);
      discount = quote.discount;
      couponCode = quote.coupon.code;
    }
    const shipping = subtotal >= FREE_SHIPPING_ABOVE ? 0 : SHIPPING_FEE;

    const order = await this.orders.create({
      orderNumber: generateOrderNumber(),
      userId: user.id,
      items,
      address: input.address,
      subtotal,
      shipping,
      discount,
      couponCode,
      total: subtotal - discount + shipping,
      status: 'created',
      statusHistory: [{ from: null, to: 'created', by: `user:${user.id}`, note: 'Order placed', at: new Date() }],
    });
    await this.cart.clear(user.id);
    logger.info({ orderId: order._id, orderNumber: order.orderNumber, userId: user.id, total: order.total }, 'Order created');
    return order;
  }

  listForUser(userId: string): Promise<OrderRecord[]> {
    return this.orders.listForUser(userId);
  }

  async getVisibleTo(id: string, user: AuthUser): Promise<OrderRecord> {
    const order = await this.orders.findById(id);
    if (!order) throw new NotFoundError('Order not found');
    if (String(order.userId) !== user.id && user.role !== 'admin') throw new ForbiddenError();
    return order;
  }

  async getOwnedDocument(id: string, userId: string): Promise<OrderDocument> {
    const order = await this.orders.findDocumentById(id);
    if (!order) throw new NotFoundError('Order not found');
    if (String(order.userId) !== userId) throw new ForbiddenError();
    return order;
  }

  findByRazorpayOrderId(razorpayOrderId: string): Promise<OrderDocument | null> {
    return this.orders.findDocumentByRazorpayOrderId(razorpayOrderId);
  }

  async cancel(id: string, user: AuthUser): Promise<OrderDocument> {
    const order = await this.getOwnedDocument(id, user.id);
    OrderStateMachine.apply(order, 'cancelled', `user:${user.id}`, 'Cancelled by customer');
    await this.orders.save(order);
    logger.info({ orderId: order._id, userId: user.id }, 'Order cancelled by customer');
    return order;
  }

  async transition(id: string, to: OrderStatus, by: string, note = ''): Promise<OrderDocument> {
    const order = await this.orders.findDocumentById(id);
    if (!order) throw new NotFoundError('Order not found');
    OrderStateMachine.apply(order, to, by, note);
    return this.orders.save(order);
  }

  /**
   * Marks an order as paid, decrementing stock and recording coupon usage.
   * Idempotent: a repeated confirmation of an already-paid order is a no-op.
   */
  async markPaid(order: OrderDocument, by: string, payment: PaymentInfo): Promise<{ order: OrderDocument; alreadyProcessed: boolean }> {
    if (order.status !== 'created') return { order, alreadyProcessed: true };
    order.set('payment.status', 'captured');
    if (payment.razorpayPaymentId) order.set('payment.razorpayPaymentId', payment.razorpayPaymentId);
    OrderStateMachine.apply(order, 'paid', by, 'Payment captured');
    await this.orders.save(order);
    for (const item of order.items) {
      await this.products.adjustStock(String(item.productId), item.size, -item.qty);
    }
    if (order.couponCode) await this.coupons.recordRedemption(order.couponCode);
    return { order, alreadyProcessed: false };
  }
}
