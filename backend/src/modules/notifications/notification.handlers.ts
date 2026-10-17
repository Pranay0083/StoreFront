import type { EventBus } from '../../core/events/event-bus';
import type { UserRepository } from '../auth/user.repository';
import type { OrderRecord } from '../orders/order.model';
import type { OrderRepository } from '../orders/order.repository';
import type { NotificationDispatcher } from './notification.service';

export interface NotificationHandlerDeps {
  users: UserRepository;
  orders: OrderRepository;
  dispatcher: NotificationDispatcher;
  frontendUrl: string;
}

/** Observers that turn order lifecycle events into queued customer notifications. */
export function registerNotificationHandlers(bus: EventBus, deps: NotificationHandlerDeps): void {
  const orderUrl = (id: string) => `${deps.frontendUrl}/orders/${id}`;

  async function recipient(orderId: string): Promise<{ order: OrderRecord; name: string; email: string } | null> {
    const order = await deps.orders.findById(orderId);
    if (!order) return null;
    const user = await deps.users.findById(String(order.userId));
    return user?.email ? { order, name: user.name, email: user.email } : null;
  }

  bus.subscribe('OrderPaid', 'notifications.order-confirmation', async event => {
    const r = await recipient(event.payload.orderId);
    if (!r) return;
    await deps.dispatcher.notify({
      key: `order-confirmation:${event.payload.orderId}`,
      template: 'orderConfirmation',
      data: {
        name: r.name,
        orderNumber: r.order.orderNumber,
        total: r.order.total,
        items: r.order.items.map(i => ({ title: i.title, qty: i.qty, size: i.size })),
        orderUrl: orderUrl(event.payload.orderId),
      },
      to: { email: r.email },
    });
  });

  bus.subscribe('OrderShipped', 'notifications.order-shipped', async event => {
    const r = await recipient(event.payload.orderId);
    if (!r) return;
    await deps.dispatcher.notify({
      key: `order-shipped:${event.payload.orderId}`,
      template: 'orderShipped',
      data: {
        name: r.name,
        orderNumber: r.order.orderNumber,
        orderUrl: orderUrl(event.payload.orderId),
        ...(event.payload.note && { note: event.payload.note }),
      },
      to: { email: r.email, ...(r.order.address?.phone && { phone: r.order.address.phone }) },
      channels: ['email', 'sms'],
    });
  });

  bus.subscribe('OrderDelivered', 'notifications.order-delivered', async event => {
    const r = await recipient(event.payload.orderId);
    if (!r) return;
    await deps.dispatcher.notify({
      key: `order-delivered:${event.payload.orderId}`,
      template: 'orderDelivered',
      data: { name: r.name, orderNumber: r.order.orderNumber, orderUrl: orderUrl(event.payload.orderId) },
      to: { email: r.email },
    });
  });

  bus.subscribe('RefundCompleted', 'notifications.refund-completed', async event => {
    const r = await recipient(event.payload.orderId);
    if (!r) return;
    await deps.dispatcher.notify({
      key: `refund-completed:${event.payload.orderId}`,
      template: 'refundCompleted',
      data: { name: r.name, orderNumber: r.order.orderNumber, amount: event.payload.amount, orderUrl: orderUrl(event.payload.orderId) },
      to: { email: r.email },
    });
  });
}
