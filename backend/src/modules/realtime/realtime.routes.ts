import type { OrderStatus, Permission } from '@storefront/contracts';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { ForbiddenError } from '../../core/errors';
import type { EventBus } from '../../core/events/event-bus';
import { handler } from '../../core/http/handler';
import type { AuthedReq } from '../../core/http/types';
import { validate } from '../../core/http/validate';
import type { AuthGuards } from '../auth/auth.guards';
import type { RealtimeHub } from './realtime.hub';

export const STREAMS = ['orders', 'admin-orders', 'stock'] as const;
export type StreamName = (typeof STREAMS)[number];

const STREAM_PERMISSIONS: Record<StreamName, Permission | null> = {
  orders: null,
  'admin-orders': 'orders:read',
  stock: 'catalog:write',
};

export const userOrdersChannel = (userId: string) => `orders:user:${userId}`;
export const ADMIN_ORDERS_CHANNEL = 'admin:orders';
export const STOCK_CHANNEL = 'admin:stock';

const StreamQuerySchema = z.object({
  channels: z
    .string()
    .default('orders')
    .transform(v => [...new Set(v.split(',').map(s => s.trim()))])
    .pipe(z.array(z.enum(STREAMS)).min(1)),
  lastEventId: z.string().max(40).optional(),
});
type StreamQuery = z.infer<typeof StreamQuerySchema>;

export class RealtimeController {
  constructor(private readonly hub: RealtimeHub) {}

  stream = async (req: AuthedReq<unknown, StreamQuery>, res: Response) => {
    const channels = req.query.channels.map(name => {
      const permission = STREAM_PERMISSIONS[name];
      if (permission && !req.user.permissions.includes(permission)) throw new ForbiddenError(`Missing permission: ${permission}`);
      if (name === 'orders') return userOrdersChannel(req.user.id);
      return name === 'admin-orders' ? ADMIN_ORDERS_CHANNEL : STOCK_CHANNEL;
    });
    await this.hub.listen();

    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    const lastEventId = (req as Request).header('last-event-id') ?? req.query.lastEventId;
    const detach = this.hub.attach({ write: chunk => res.write(chunk), end: () => res.end() }, channels, lastEventId);
    req.on('close', detach);
  };
}

export function realtimeRoutes(controller: RealtimeController, guards: AuthGuards): Router {
  const router = Router();
  router.get('/stream', guards.requireAuth, validate({ query: StreamQuerySchema }), handler(controller.stream));
  return router;
}

/** Translates committed domain events into realtime messages for the order and stock channels. */
export function registerRealtimeHandlers(eventBus: EventBus, hub: RealtimeHub): void {
  const status = async (p: { orderId: string; orderNumber: string; userId: string }, to: OrderStatus) => {
    const data = { orderId: p.orderId, orderNumber: p.orderNumber, status: to };
    await Promise.all([
      hub.publish(userOrdersChannel(p.userId), 'order.status', data),
      hub.publish(ADMIN_ORDERS_CHANNEL, 'order.status', data),
    ]);
  };
  eventBus
    .subscribe('OrderPlaced', 'realtime.order-placed', async ({ payload: p }) => {
      await hub.publish(ADMIN_ORDERS_CHANNEL, 'order.placed', { orderId: p.orderId, orderNumber: p.orderNumber, total: p.total });
      await hub.publish(userOrdersChannel(p.userId), 'order.status', { orderId: p.orderId, orderNumber: p.orderNumber, status: 'created' });
    })
    .subscribe('OrderPaid', 'realtime.order-paid', async ({ payload: p }) => {
      await hub.publish(ADMIN_ORDERS_CHANNEL, 'order.paid', { orderId: p.orderId, orderNumber: p.orderNumber, total: p.total });
      await status(p, 'paid');
    })
    .subscribe('OrderShipped', 'realtime.order-shipped', async ({ payload }) => status(payload, 'shipped'))
    .subscribe('OrderDelivered', 'realtime.order-delivered', async ({ payload }) => status(payload, 'delivered'))
    .subscribe('OrderCancelled', 'realtime.order-cancelled', async ({ payload }) => status(payload, 'cancelled'))
    .subscribe('RefundRequested', 'realtime.refund-requested', async ({ payload }) => status(payload, 'refund_requested'))
    .subscribe('RefundCompleted', 'realtime.refund-completed', async ({ payload }) =>
      status(payload, payload.fullyRefunded ? 'refunded' : 'partially_refunded'),
    )
    .subscribe('RefundFailed', 'realtime.refund-failed', async ({ payload }) => status(payload, payload.restoredStatus))
    .subscribe('StockLow', 'realtime.stock-low', async ({ payload }) => hub.publish(STOCK_CHANNEL, 'stock.low', payload));
}
