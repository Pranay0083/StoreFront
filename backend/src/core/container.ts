import { REFUND_WINDOW_DAYS } from '@storefront/contracts';
import type { Router } from 'express';
import { AdminController } from '../modules/admin/admin.controller';
import { adminRoutes } from '../modules/admin/admin.routes';
import { AdminUsersService } from '../modules/admin/admin-users.service';
import { AdminService } from '../modules/admin/admin.service';
import { AuditLogRepository } from '../modules/admin/audit-log.repository';
import { auditTrail } from '../modules/admin/audit-trail';
import { AuditService } from '../modules/admin/audit.service';
import { StaffController } from '../modules/admin/staff.controller';
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
import { CachingCatalog } from '../modules/catalog/caching-catalog';
import { CatalogService } from '../modules/catalog/catalog.service';
import {
  adminExperimentsRoutes,
  adminFlagsRoutes,
  ExperimentsController,
  experimentsRoutes,
  registerExperimentHandlers,
} from '../modules/experiments/experiments.routes';
import { ExperimentsService } from '../modules/experiments/experiments.service';
import { createSearchProvider } from '../modules/search/search.factory';
import { SearchService } from '../modules/search/search.service';
import { ProductRepository } from '../modules/catalog/product.repository';
import { McpController } from '../modules/mcp/mcp.controller';
import { AbandonedCartReminder } from '../modules/notifications/abandoned-cart';
import { ConsoleMessagingProvider } from '../modules/notifications/channels';
import { NotificationLogRepository } from '../modules/notifications/notification-log';
import { registerNotificationHandlers } from '../modules/notifications/notification.handlers';
import { NotificationDispatcher, NotificationService } from '../modules/notifications/notification.service';
import { createEmailProvider } from '../modules/notifications/providers';
import { JobsController, jobsAdminRoutes } from '../modules/operations/jobs.routes';
import { JobsAdminService } from '../modules/operations/jobs.service';
import { mcpRoutes } from '../modules/mcp/mcp.routes';
import { OrderRepository } from '../modules/orders/order.repository';
import { OrdersController } from '../modules/orders/orders.controller';
import { ordersRoutes } from '../modules/orders/orders.routes';
import { OrdersService } from '../modules/orders/orders.service';
import { QueuedReservationScheduler } from '../modules/orders/reservation-jobs';
import type { ReservationExpiryScheduler } from '../modules/orders/reservation-sweeper';
import { PaymentsController } from '../modules/payments/payments.controller';
import { registerInventoryHandlers } from '../modules/inventory/inventory.handlers';
import { InventoryController } from '../modules/inventory/inventory.controller';
import { InventoryMovementRepository, StockReservationRepository } from '../modules/inventory/inventory.repository';
import { inventoryRoutes } from '../modules/inventory/inventory.routes';
import { InventoryService } from '../modules/inventory/inventory.service';
import { PaymentGatewayFactory } from '../modules/payments/gateways/payment-gateway.factory';
import { gatewayBreaker, ResilientPaymentGateway } from '../modules/payments/gateways/resilient.gateway';
import { paymentsRoutes } from '../modules/payments/payments.routes';
import { RefundSaga } from '../modules/payments/refund.saga';
import { PaymentsService } from '../modules/payments/payments.service';
import { WebhookEventRepository } from '../modules/payments/webhook-event.repository';
import { DeliveredOrderPurchaseVerifier } from '../modules/reviews/purchase-verifier';
import { ReviewRepository } from '../modules/reviews/review.repository';
import { ReviewsController } from '../modules/reviews/reviews.controller';
import { reviewsRoutes } from '../modules/reviews/reviews.routes';
import { ReviewsService } from '../modules/reviews/reviews.service';
import { BroadcastingPromotionCache } from '../modules/pricing/broadcasting-promotion.cache';
import { PricingController, PromotionsController } from '../modules/pricing/pricing.controller';
import { MongoCustomerHistory, MongoPricingCatalog } from '../modules/pricing/pricing.ports';
import { registerPricingHandlers } from '../modules/pricing/pricing.handlers';
import { adminPromotionsRoutes, pricingRoutes } from '../modules/pricing/pricing.routes';
import { PromotionRedemptionRepository } from '../modules/pricing/promotion-redemption.model';
import { InstrumentedPricingService } from '../modules/pricing/instrumented-pricing.service';
import { PromotionRepository } from '../modules/pricing/promotion.repository';
import { PromotionsService } from '../modules/pricing/promotions.service';
import { QuoteRepository } from '../modules/pricing/quote.model';
import type { Env } from './config/env';
import { CookiePolicy } from './http/cookies';
import { CsrfProtection } from './http/csrf';
import { idempotent } from './http/idempotency/idempotency.middleware';
import { createRateLimiters } from './http/rate-limit';
import { memoryInfrastructure, type Infrastructure } from './infrastructure';
import { TransactionRunner } from './persistence/transaction';
import { EventBus } from './events/event-bus';
import { PollingOutboxRelay, type OutboxRelay } from './events/outbox-relay';
import { QueueOutboxRelay } from './events/queue-outbox-relay';
import { OutboxStore } from './events/outbox.store';
import { logger } from './logger';
import { HealthMonitor, mongoCheck } from './observability/health';
import { Metrics } from './observability/metrics';

/** Composition root: the only place where concrete classes are instantiated and wired together. */
export function buildContainer(env: Env, infra: Infrastructure = memoryInfrastructure(), metrics = new Metrics()) {
  const limiters = createRateLimiters(env, infra.rateLimitStores);
  const jobs = infra.queue;
  const cookies = new CookiePolicy(env);
  const csrf = new CsrfProtection(env.CSRF_SECRET, cookies, ['/payments/webhook', '/mcp']);

  const repositories = {
    users: new UserRepository(),
    loginAttempts: new LoginAttemptRepository(),
    authSessions: new AuthSessionRepository(),
    products: new ProductRepository(),
    reviews: new ReviewRepository(),
    carts: new CartRepository(),
    orders: new OrderRepository(),
    webhookEvents: new WebhookEventRepository(),
    conversations: new ConversationRepository(),
    inventoryMovements: new InventoryMovementRepository(),
    stockReservations: new StockReservationRepository(),
    auditLogs: new AuditLogRepository(),
    promotions: new PromotionRepository(),
    quotes: new QuoteRepository(),
    promotionRedemptions: new PromotionRedemptionRepository(),
  };

  const tx = new TransactionRunner();
  const outbox = new OutboxStore();
  const eventBus = new EventBus();
  const relay: OutboxRelay =
    infra.kind === 'redis'
      ? new QueueOutboxRelay(outbox, eventBus, jobs, infra.pubsub, logger, { pollIntervalMs: env.OUTBOX_POLL_INTERVAL_MS })
      : new PollingOutboxRelay(outbox, eventBus, logger, { pollIntervalMs: env.OUTBOX_POLL_INTERVAL_MS });

  const tokens = new TokenService({ access: env.JWT_ACCESS_SECRET, refresh: env.JWT_REFRESH_SECRET });
  const inventory = new InventoryService(repositories.products, repositories.inventoryMovements, repositories.stockReservations);
  const search = new SearchService(createSearchProvider(env), repositories.products);
  search.registerIndexing(eventBus, jobs, repositories.orders);
  const catalog = new CatalogService(repositories.products, inventory, tx, outbox, search);
  const cachedCatalog = new CachingCatalog(catalog, infra.cache, env.CATALOG_CACHE_TTL_SECONDS, metrics.cacheObserver());
  cachedCatalog.registerInvalidation(eventBus);
  const cart = new CartService(repositories.carts, repositories.products);
  const promotionCache = new BroadcastingPromotionCache(repositories.promotions, infra.pubsub, logger);
  const pricing = new InstrumentedPricingService(
    new MongoPricingCatalog(),
    new MongoCustomerHistory(),
    promotionCache,
    repositories.promotions,
    repositories.quotes,
    repositories.promotionRedemptions,
  ).withMetrics(metrics);
  const orders = new OrdersService(repositories.orders, pricing, cart, inventory, outbox, relay, tx, {
    reservationTtlMs: env.RESERVATION_TTL_MINUTES * 60_000,
    refundWindowDays: REFUND_WINDOW_DAYS,
  });
  const agentTools = new AgentTools(catalog, repositories.orders, repositories.users);
  const rawGateway = PaymentGatewayFactory.create({
    keyId: env.RAZORPAY_KEY_ID,
    keySecret: env.RAZORPAY_KEY_SECRET,
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
  });
  const paymentGateway = new ResilientPaymentGateway(rawGateway, gatewayBreaker(`payment-gateway:${rawGateway.name}`));
  metrics.trackQueue(jobs).trackOutbox(outbox).trackCircuit(paymentGateway.breaker).registerEventCounters(eventBus);

  registerInventoryHandlers(eventBus, { products: repositories.products, outbox, logger, lowStockThreshold: env.LOW_STOCK_THRESHOLD });
  registerPricingHandlers(eventBus, { pricing, tx });
  const refunds = new RefundSaga(orders, inventory, paymentGateway, logger);
  refunds.register(eventBus);
  const experiments = new ExperimentsService(infra.cache, 30, metrics.cacheObserver());
  registerExperimentHandlers(eventBus, experiments);

  const reservationScheduler = new QueuedReservationScheduler(orders, repositories.orders, jobs, logger, {
    ttlMs: env.RESERVATION_TTL_MINUTES * 60_000,
    sweepIntervalMs: env.RESERVATION_SWEEP_INTERVAL_MS,
  });
  reservationScheduler.register(eventBus);
  const reservationSweeper: ReservationExpiryScheduler = reservationScheduler;

  const emailProvider = createEmailProvider(env, logger);
  const messagingProviders = [new ConsoleMessagingProvider('sms', logger), new ConsoleMessagingProvider('whatsapp', logger)];
  const notifications = new NotificationService(emailProvider, messagingProviders, new NotificationLogRepository(), env.EMAIL_FROM, logger);
  const notificationDispatcher = new NotificationDispatcher(jobs);
  notificationDispatcher.register(notifications);
  registerNotificationHandlers(eventBus, {
    users: repositories.users,
    orders: repositories.orders,
    dispatcher: notificationDispatcher,
    frontendUrl: env.FRONTEND_URL,
  });
  const abandonedCarts = new AbandonedCartReminder(
    repositories.carts,
    repositories.users,
    repositories.products,
    notificationDispatcher,
    logger,
    {
      idleHours: env.ABANDONED_CART_HOURS,
      scanIntervalMs: env.ABANDONED_CART_SCAN_INTERVAL_MS,
      frontendUrl: env.FRONTEND_URL,
    },
  );
  abandonedCarts.register(jobs);
  /** Everything that consumes work: the outbox relay, queue workers and periodic sweeps. */
  const background = {
    async start() {
      relay.start();
      reservationSweeper.start();
      abandonedCarts.start(jobs);
      await jobs.start();
    },
    async stop() {
      await reservationSweeper.stop();
      await relay.stop();
      await jobs.stop();
    },
  };

  const audit = new AuditService(repositories.auditLogs);

  const services = {
    tokens,
    audit,
    adminUsers: new AdminUsersService(repositories.users),
    auth: new AuthService(repositories.users, new LoginThrottle(repositories.loginAttempts), repositories.authSessions, tokens),
    catalog,
    cachedCatalog,
    search,
    inventory,
    reviews: new ReviewsService(repositories.reviews, repositories.products, new DeliveredOrderPurchaseVerifier()),
    cart,
    orders,
    refunds,
    payments: new PaymentsService(paymentGateway, orders, repositories.webhookEvents, refunds, jobs),
    outbox,
    relay,
    reservationSweeper,
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
    promotionCache,
    pricing,
    promotions: new PromotionsService(repositories.promotions, promotionCache, pricing),
    jobsAdmin: new JobsAdminService(jobs, infra.deadLetters, outbox, relay),
    emailProvider,
    messagingProviders,
    notifications,
    notificationDispatcher,
    abandonedCarts,
    experiments,
  };

  const guards = new AuthGuards(services.auth);
  const idempotency = idempotent(infra.idempotency);

  const controllers = {
    auth: new AuthController(services.auth, cookies, csrf),
    catalog: new CatalogController(services.cachedCatalog, services.search),
    reviews: new ReviewsController(services.reviews),
    cart: new CartController(services.cart),
    orders: new OrdersController(services.orders),
    payments: new PaymentsController(services.payments),
    agent: new AgentController(services.agent),
    mcp: new McpController(services.agentTools),
    admin: new AdminController(services.admin),
    inventory: new InventoryController(services.inventory),
    staff: new StaffController(services.audit, services.adminUsers),
    pricing: new PricingController(services.pricing),
    promotions: new PromotionsController(services.promotions),
    jobs: new JobsController(services.jobsAdmin),
    experiments: new ExperimentsController(services.experiments),
  };

  const routes: Array<[path: string, router: Router]> = [
    ['/auth', authRoutes(controllers.auth, guards)],
    ['/products', catalogRoutes(controllers.catalog, guards)],
    ['/reviews', reviewsRoutes(controllers.reviews, guards)],
    ['/cart', cartRoutes(controllers.cart, guards)],
    ['/orders', ordersRoutes(controllers.orders, guards, idempotency)],
    ['/payments', paymentsRoutes(controllers.payments, guards, idempotency)],
    ['/agent', agentRoutes(controllers.agent, guards)],
    ['/mcp', mcpRoutes(controllers.mcp)],
    ['/pricing', pricingRoutes(controllers.pricing, guards)],
    ['/experiments', experimentsRoutes(controllers.experiments, guards)],
    ['/admin/inventory', inventoryRoutes(controllers.inventory, guards)],
    ['/admin/promotions', adminPromotionsRoutes(controllers.promotions, guards)],
    ['/admin/jobs', jobsAdminRoutes(controllers.jobs, guards)],
    ['/admin/flags', adminFlagsRoutes(controllers.experiments, guards)],
    ['/admin/experiments', adminExperimentsRoutes(controllers.experiments, guards)],
    ['/admin', adminRoutes(controllers.admin, controllers.staff, guards)],
  ];

  const http = { auditTrail: auditTrail(audit) };
  const health = new HealthMonitor([
    mongoCheck,
    ...(infra.kind === 'redis' ? [{ name: 'redis', critical: true, check: () => infra.ping() }] : []),
    { name: 'queue', critical: true, check: () => jobs.ping() },
    ...(search.provider.requiresIndexing ? [{ name: 'search', critical: false, check: () => search.provider.ping() }] : []),
  ]);

  return {
    env,
    infra,
    jobs,
    metrics,
    health,
    limiters,
    cookies,
    csrf,
    http,
    tx,
    eventBus,
    background,
    repositories,
    services,
    guards,
    controllers,
    routes,
  };
}

export type Container = ReturnType<typeof buildContainer>;
