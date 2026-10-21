import { CUSTOMER_CANCELLABLE_STATUSES, formatINR } from '@storefront/contracts';
import { z } from 'zod';
import type { CatalogService } from '../../catalog/catalog.service';
import type { OrderRepository } from '../../orders/order.repository';
import type { PendingActionService } from '../actions/pending-action.service';
import { AgentTool, type ToolContext, type ToolResult } from './agent-tool';

const AWAITING = 'Awaiting the customer: a confirmation card is shown in the chat. Do not say it is done; ask them to confirm.';

/** Base for write tools: widget-only, signed-in only, and every call becomes a pending action. */
abstract class ConfirmableTool<S extends z.ZodObject<z.ZodRawShape>> extends AgentTool<S> {
  override readonly access = 'customer' as const;
  override readonly channels = ['widget'] as const;
  override readonly requiresConfirmation = true;
}

const AddSchema = z.object({
  slug: z.string().min(1).max(120).describe('Product slug'),
  size: z.string().min(1).max(20).describe('Size exactly as listed for the product'),
  qty: z.number().int().min(1).max(10).default(1),
});

export class AddToCartTool extends ConfirmableTool<typeof AddSchema> {
  readonly name = 'add_to_cart';
  readonly title = 'Add to bag';
  readonly description =
    "Propose adding a product to the signed-in customer's bag. The customer must confirm it in the chat before anything changes.";
  readonly schema = AddSchema;

  constructor(
    private readonly catalog: CatalogService,
    private readonly actions: PendingActionService,
  ) {
    super();
  }

  async execute(args: z.infer<typeof AddSchema>, ctx: ToolContext): Promise<ToolResult> {
    const product = await this.catalog.findBySlug(args.slug);
    if (!product) return { error: `No product found with slug "${args.slug}"` };
    const variant = product.sizes.find(s => s.size.toLowerCase() === args.size.toLowerCase());
    if (!variant) return { error: `Size ${args.size} is not offered. Available: ${product.sizes.map(s => s.size).join(', ')}` };
    if (variant.stock < args.qty) return { error: `Only ${variant.stock} left in size ${variant.size}` };
    const pendingAction = await this.actions.propose({
      type: 'add_to_cart',
      user: ctx.user!,
      sessionId: ctx.sessionId,
      summary: `Add ${args.qty} × ${product.title} (size ${variant.size}, ${formatINR(product.price)} each) to your bag`,
      payload: { productId: String(product._id), slug: product.slug, title: product.title, size: variant.size, qty: args.qty },
    });
    return { status: 'awaiting_confirmation', pendingAction, note: AWAITING };
  }
}

const CancelSchema = z.object({
  orderNumber: z.string().min(1).max(40).describe('Order number like SF-1234'),
  reason: z.string().max(300).optional(),
});

export class CancelOrderTool extends ConfirmableTool<typeof CancelSchema> {
  readonly name = 'cancel_order';
  readonly title = 'Cancel order';
  readonly description =
    "Propose cancelling one of the signed-in customer's orders that has not shipped yet. The customer must confirm it in the chat.";
  readonly schema = CancelSchema;

  constructor(
    private readonly orders: OrderRepository,
    private readonly actions: PendingActionService,
  ) {
    super();
  }

  async execute(args: z.infer<typeof CancelSchema>, ctx: ToolContext): Promise<ToolResult> {
    const order = await this.orders.findByNumberForUser(args.orderNumber, ctx.user!.id);
    if (!order) return { error: 'No order with that number on this account.' };
    if (!CUSTOMER_CANCELLABLE_STATUSES.includes(order.status))
      return { error: `Order ${order.orderNumber} is ${order.status} and can no longer be cancelled.` };
    const refundNote = order.status === 'created' ? '' : `, refunding ${formatINR(order.total)}`;
    const pendingAction = await this.actions.propose({
      type: 'cancel_order',
      user: ctx.user!,
      sessionId: ctx.sessionId,
      summary: `Cancel order ${order.orderNumber}${refundNote}`,
      payload: { orderId: String(order._id), orderNumber: order.orderNumber, reason: args.reason },
    });
    return { status: 'awaiting_confirmation', pendingAction, note: AWAITING };
  }
}

const RefundSchema = z.object({
  orderNumber: z.string().min(1).max(40).describe('Order number like SF-1234'),
  reason: z.string().min(3).max(300).describe("The customer's reason, in their words"),
  items: z
    .array(z.object({ slug: z.string().min(1).max(120), size: z.string().min(1).max(20), qty: z.number().int().min(1).max(20) }))
    .max(20)
    .optional()
    .describe('Specific items to return; omit to refund the whole order'),
});

export class RequestRefundTool extends ConfirmableTool<typeof RefundSchema> {
  readonly name = 'request_refund';
  readonly title = 'Request refund';
  readonly description =
    'Propose a refund for a delivered order (whole order or specific items) within the return window. The customer must confirm it in the chat.';
  readonly schema = RefundSchema;

  constructor(
    private readonly orders: OrderRepository,
    private readonly actions: PendingActionService,
  ) {
    super();
  }

  async execute(args: z.infer<typeof RefundSchema>, ctx: ToolContext): Promise<ToolResult> {
    const order = await this.orders.findByNumberForUser(args.orderNumber, ctx.user!.id);
    if (!order) return { error: 'No order with that number on this account.' };
    if (!['delivered', 'partially_refunded'].includes(order.status)) {
      return {
        error: `Order ${order.orderNumber} is ${order.status}. Refunds can be requested after delivery; unshipped orders can be cancelled instead.`,
      };
    }
    const lines = [];
    for (const it of args.items ?? []) {
      const line = order.items.find(i => i.slug === it.slug && i.size.toLowerCase() === it.size.toLowerCase());
      if (!line) return { error: `${it.slug} (size ${it.size}) is not part of order ${order.orderNumber}` };
      lines.push({ productId: String(line.productId), size: line.size, qty: it.qty });
    }
    const what = lines.length
      ? `${lines.reduce((n, l) => n + l.qty, 0)} item(s) from order ${order.orderNumber}`
      : `order ${order.orderNumber}`;
    const pendingAction = await this.actions.propose({
      type: 'request_refund',
      user: ctx.user!,
      sessionId: ctx.sessionId,
      summary: `Request a refund for ${what}`,
      payload: { orderId: String(order._id), orderNumber: order.orderNumber, reason: args.reason, ...(lines.length ? { lines } : {}) },
    });
    return { status: 'awaiting_confirmation', pendingAction, note: AWAITING };
  }
}
