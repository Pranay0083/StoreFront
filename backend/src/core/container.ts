import type { Router } from 'express';
import { AuthController } from '../modules/auth/auth.controller';
import { AuthGuards } from '../modules/auth/auth.guards';
import { authRoutes } from '../modules/auth/auth.routes';
import { AuthService } from '../modules/auth/auth.service';
import { LoginAttemptRepository } from '../modules/auth/login-attempt.repository';
import { TokenService } from '../modules/auth/token.service';
import { UserRepository } from '../modules/auth/user.repository';
import { CatalogController } from '../modules/catalog/catalog.controller';
import { catalogRoutes } from '../modules/catalog/catalog.routes';
import { CatalogService } from '../modules/catalog/catalog.service';
import { ProductRepository } from '../modules/catalog/product.repository';
import { ReviewRepository } from '../modules/reviews/review.repository';
import { ReviewsController } from '../modules/reviews/reviews.controller';
import { reviewsRoutes } from '../modules/reviews/reviews.routes';
import { ReviewsService } from '../modules/reviews/reviews.service';
import { CartController } from '../modules/cart/cart.controller';
import { CartRepository } from '../modules/cart/cart.repository';
import { cartRoutes } from '../modules/cart/cart.routes';
import { CartService } from '../modules/cart/cart.service';
import { CouponRepository } from '../modules/coupons/coupon.repository';
import { CouponsController } from '../modules/coupons/coupons.controller';
import { adminCouponsRoutes, couponsRoutes } from '../modules/coupons/coupons.routes';
import { CouponService } from '../modules/coupons/coupons.service';
import { OrderRepository } from '../modules/orders/order.repository';
import { OrdersController } from '../modules/orders/orders.controller';
import { ordersRoutes } from '../modules/orders/orders.routes';
import { OrdersService } from '../modules/orders/orders.service';
import { PaymentsController } from '../modules/payments/payments.controller';
import { paymentsRoutes } from '../modules/payments/payments.routes';
import { PaymentsService } from '../modules/payments/payments.service';
import { WebhookEventRepository } from '../modules/payments/webhook-event.repository';
import type { Env } from './config/env';
import { createRateLimiters } from './http/rate-limit';

/** Composition root: the only place where concrete classes are instantiated and wired together. */
export function buildContainer(env: Env) {
  const limiters = createRateLimiters(env);

  const repositories = {
    users: new UserRepository(),
    loginAttempts: new LoginAttemptRepository(),
    products: new ProductRepository(),
    reviews: new ReviewRepository(),
    carts: new CartRepository(),
    coupons: new CouponRepository(),
    orders: new OrderRepository(),
    webhookEvents: new WebhookEventRepository(),
  };

  const tokens = new TokenService(env.JWT_SECRET);
  const cart = new CartService(repositories.carts);
  const coupons = new CouponService(repositories.coupons);
  const orders = new OrdersService(repositories.orders, repositories.products, coupons, cart);
  const services = {
    tokens,
    auth: new AuthService(repositories.users, repositories.loginAttempts, tokens),
    catalog: new CatalogService(repositories.products),
    reviews: new ReviewsService(repositories.reviews, repositories.products),
    cart,
    coupons,
    orders,
    payments: new PaymentsService(
      { keyId: env.RAZORPAY_KEY_ID, keySecret: env.RAZORPAY_KEY_SECRET, webhookSecret: env.RAZORPAY_WEBHOOK_SECRET },
      orders,
      repositories.webhookEvents,
    ),
  };

  const guards = new AuthGuards(services.auth);

  const controllers = {
    auth: new AuthController(services.auth),
    catalog: new CatalogController(services.catalog),
    reviews: new ReviewsController(services.reviews),
    cart: new CartController(services.cart),
    coupons: new CouponsController(services.coupons),
    orders: new OrdersController(services.orders),
    payments: new PaymentsController(services.payments),
  };

  const routes: Array<[path: string, router: Router]> = [
    ['/auth', authRoutes(controllers.auth, guards, limiters)],
    ['/products', catalogRoutes(controllers.catalog, guards)],
    ['/reviews', reviewsRoutes(controllers.reviews, guards)],
    ['/cart', cartRoutes(controllers.cart, guards)],
    ['/coupons', couponsRoutes(controllers.coupons, guards)],
    ['/admin/coupons', adminCouponsRoutes(controllers.coupons, guards)],
    ['/orders', ordersRoutes(controllers.orders, guards)],
    ['/payments', paymentsRoutes(controllers.payments, guards)],
  ];

  return { env, limiters, repositories, services, guards, controllers, routes };
}

export type Container = ReturnType<typeof buildContainer>;
