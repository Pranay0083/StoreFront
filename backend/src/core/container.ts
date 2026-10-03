import type { Router } from 'express';
import { AdminController } from '../modules/admin/admin.controller';
import { adminRoutes } from '../modules/admin/admin.routes';
import { AdminService } from '../modules/admin/admin.service';
import { AgentController } from '../modules/agent/agent.controller';
import { agentRoutes } from '../modules/agent/agent.routes';
import { AgentService } from '../modules/agent/agent.service';
import { AgentTools } from '../modules/agent/agent.tools';
import { ConversationRepository } from '../modules/agent/conversation.repository';
import { AuthController } from '../modules/auth/auth.controller';
import { AuthGuards } from '../modules/auth/auth.guards';
import { authRoutes } from '../modules/auth/auth.routes';
import { AuthService } from '../modules/auth/auth.service';
import { LoginAttemptRepository } from '../modules/auth/login-attempt.repository';
import { LoginThrottle } from '../modules/auth/login-throttle';
import { AuthSessionRepository } from '../modules/auth/session.repository';
import { TokenService } from '../modules/auth/token.service';
import { UserRepository } from '../modules/auth/user.repository';
import { CartController } from '../modules/cart/cart.controller';
import { CartRepository } from '../modules/cart/cart.repository';
import { cartRoutes } from '../modules/cart/cart.routes';
import { CartService } from '../modules/cart/cart.service';
import { CatalogController } from '../modules/catalog/catalog.controller';
import { catalogRoutes } from '../modules/catalog/catalog.routes';
import { CatalogService } from '../modules/catalog/catalog.service';
import { ProductRepository } from '../modules/catalog/product.repository';
import { CouponRepository } from '../modules/coupons/coupon.repository';
import { CouponsController } from '../modules/coupons/coupons.controller';
import { adminCouponsRoutes, couponsRoutes } from '../modules/coupons/coupons.routes';
import { CouponService } from '../modules/coupons/coupons.service';
import { McpController } from '../modules/mcp/mcp.controller';
import { mcpRoutes } from '../modules/mcp/mcp.routes';
import { OrderRepository } from '../modules/orders/order.repository';
import { OrdersController } from '../modules/orders/orders.controller';
import { ordersRoutes } from '../modules/orders/orders.routes';
import { OrdersService } from '../modules/orders/orders.service';
import { PaymentsController } from '../modules/payments/payments.controller';
import { paymentsRoutes } from '../modules/payments/payments.routes';
import { PaymentsService } from '../modules/payments/payments.service';
import { WebhookEventRepository } from '../modules/payments/webhook-event.repository';
import { ReviewRepository } from '../modules/reviews/review.repository';
import { ReviewsController } from '../modules/reviews/reviews.controller';
import { reviewsRoutes } from '../modules/reviews/reviews.routes';
import { ReviewsService } from '../modules/reviews/reviews.service';
import type { Env } from './config/env';
import { createRateLimiters } from './http/rate-limit';

/** Composition root: the only place where concrete classes are instantiated and wired together. */
export function buildContainer(env: Env) {
  const limiters = createRateLimiters(env);

  const repositories = {
    users: new UserRepository(),
    loginAttempts: new LoginAttemptRepository(),
    authSessions: new AuthSessionRepository(),
    products: new ProductRepository(),
    reviews: new ReviewRepository(),
    carts: new CartRepository(),
    coupons: new CouponRepository(),
    orders: new OrderRepository(),
    webhookEvents: new WebhookEventRepository(),
    conversations: new ConversationRepository(),
  };

  const tokens = new TokenService({ access: env.JWT_ACCESS_SECRET, refresh: env.JWT_REFRESH_SECRET });
  const catalog = new CatalogService(repositories.products);
  const cart = new CartService(repositories.carts);
  const coupons = new CouponService(repositories.coupons);
  const orders = new OrdersService(repositories.orders, repositories.products, coupons, cart);
  const agentTools = new AgentTools(catalog, repositories.orders, repositories.users);

  const services = {
    tokens,
    auth: new AuthService(repositories.users, new LoginThrottle(repositories.loginAttempts), repositories.authSessions, tokens),
    catalog,
    reviews: new ReviewsService(repositories.reviews, repositories.products),
    cart,
    coupons,
    orders,
    payments: new PaymentsService(
      { keyId: env.RAZORPAY_KEY_ID, keySecret: env.RAZORPAY_KEY_SECRET, webhookSecret: env.RAZORPAY_WEBHOOK_SECRET },
      orders,
      repositories.webhookEvents,
    ),
    agentTools,
    agent: new AgentService({ apiKey: env.GROQ_API_KEY, model: env.GROQ_MODEL }, agentTools, repositories.conversations),
    admin: new AdminService(
      repositories.orders,
      orders,
      repositories.users,
      repositories.carts,
      repositories.products,
      repositories.conversations,
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
    agent: new AgentController(services.agent),
    mcp: new McpController(services.agentTools),
    admin: new AdminController(services.admin),
  };

  const routes: Array<[path: string, router: Router]> = [
    ['/auth', authRoutes(controllers.auth, guards, limiters)],
    ['/products', catalogRoutes(controllers.catalog, guards)],
    ['/reviews', reviewsRoutes(controllers.reviews, guards)],
    ['/cart', cartRoutes(controllers.cart, guards)],
    ['/coupons', couponsRoutes(controllers.coupons, guards)],
    ['/orders', ordersRoutes(controllers.orders, guards)],
    ['/payments', paymentsRoutes(controllers.payments, guards)],
    ['/agent', agentRoutes(controllers.agent, guards)],
    ['/mcp', mcpRoutes(controllers.mcp)],
    ['/admin/coupons', adminCouponsRoutes(controllers.coupons, guards)],
    ['/admin', adminRoutes(controllers.admin, guards)],
  ];

  return { env, limiters, repositories, services, guards, controllers, routes };
}

export type Container = ReturnType<typeof buildContainer>;
