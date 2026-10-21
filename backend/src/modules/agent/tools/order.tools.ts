import { formatINR } from '@storefront/contracts';
import { z } from 'zod';
import type { UserRepository } from '../../auth/user.repository';
import type { OrderRecord } from '../../orders/order.model';
import type { OrderRepository } from '../../orders/order.repository';
import { AgentTool, type ToolContext, type ToolResult } from './agent-tool';

export const orderSummary = (o: OrderRecord) => ({
  orderNumber: o.orderNumber,
  status: o.status,
  total: formatINR(o.total),
  placedAt: o.createdAt,
  items: o.items.map(i => ({ title: i.title, slug: i.slug, size: i.size, qty: i.qty, price: formatINR(i.price) })),
  timeline: o.statusHistory.map(h => ({ to: h.to, at: h.at, note: h.note })),
});

const StatusSchema = z.object({
  orderNumber: z.string().max(40).optional().describe('Order number like SF-1234'),
  email: z.string().max(200).optional().describe('Account email; only needed when the customer is not signed in'),
});

export class GetOrderStatusTool extends AgentTool<typeof StatusSchema> {
  readonly name = 'get_order_status';
  readonly title = 'Get order status';
  readonly description =
    'Look up the status and timeline of an order. Signed-in customers need only the order number (or none for their latest order); guests need the order number and the account email.';
  readonly schema = StatusSchema;

  constructor(
    private readonly orders: OrderRepository,
    private readonly users: UserRepository,
  ) {
    super();
  }

  async execute(args: z.infer<typeof StatusSchema>, ctx: ToolContext): Promise<ToolResult> {
    if (ctx.user) {
      const order = args.orderNumber
        ? await this.orders.findByNumberForUser(args.orderNumber, ctx.user.id)
        : await this.orders.latestForUser(ctx.user.id);
      if (!order) return { error: args.orderNumber ? 'No order found matching those details.' : 'No orders found for your account.' };
      return { order: orderSummary(order) };
    }
    if (!args.orderNumber || !args.email) return { error: 'orderNumber and email are required to look up an order.' };
    const user = await this.users.findByEmail(args.email);
    const order = user ? await this.orders.findByNumberForUser(args.orderNumber, String(user._id)) : null;
    if (!order) return { error: 'No order found matching that order number and email.' };
    return { order: orderSummary(order) };
  }
}

export class GetMyOrdersTool extends AgentTool<z.ZodObject<Record<string, never>>> {
  readonly name = 'get_my_orders';
  readonly title = 'My recent orders';
  readonly description = "List the signed-in customer's 5 most recent orders with statuses.";
  readonly schema = z.object({});
  override readonly access = 'customer' as const;
  override readonly channels = ['widget'] as const;

  constructor(private readonly orders: OrderRepository) {
    super();
  }

  async execute(_args: unknown, ctx: ToolContext): Promise<ToolResult> {
    const orders = await this.orders.listForUser(ctx.user!.id, 5);
    return { count: orders.length, orders: orders.map(orderSummary) };
  }
}
