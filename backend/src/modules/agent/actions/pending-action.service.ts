import { ConflictError, ForbiddenError, NotFoundError } from '../../../core/errors';
import type { AuthUser } from '../../../core/http/types';
import { logger } from '../../../core/logger';
import type { CartService } from '../../cart/cart.service';
import type { OrdersService } from '../../orders/orders.service';
import type { ConversationRepository } from '../conversation.repository';
import {
  PendingActionModel,
  toView,
  type ActionPayload,
  type ActionType,
  type AddToCartPayload,
  type OrderActionPayload,
  type PendingActionRecord,
  type PendingActionView,
} from './pending-action.model';

const PURGE_AFTER_MS = 30 * 24 * 3600_000;

export interface ProposeInput {
  type: ActionType;
  user: AuthUser;
  sessionId?: string;
  summary: string;
  payload: ActionPayload;
}

type Executor = (payload: never, user: AuthUser) => Promise<Record<string, unknown>>;

/**
 * Human-in-the-loop gate for agent write tools: the agent can only propose; the signed-in owner
 * confirms through an authenticated, CSRF-protected request, and execution goes through the
 * same services the rest of the API uses.
 */
export class PendingActionService {
  private readonly executors: Record<ActionType, Executor>;

  constructor(
    private readonly cart: CartService,
    private readonly orders: OrdersService,
    private readonly conversations: ConversationRepository,
    private readonly ttlMs: number,
  ) {
    this.executors = {
      add_to_cart: ((p: AddToCartPayload, user: AuthUser) => this.addToCart(p, user)) as Executor,
      cancel_order: ((p: OrderActionPayload, user: AuthUser) => this.cancelOrder(p, user)) as Executor,
      request_refund: ((p: OrderActionPayload, user: AuthUser) => this.requestRefund(p, user)) as Executor,
    };
  }

  async propose(input: ProposeInput): Promise<PendingActionView> {
    const now = Date.now();
    await PendingActionModel.updateMany(
      { userId: input.user.id, sessionId: input.sessionId, type: input.type, status: 'pending' },
      { $set: { status: 'expired', resolvedAt: new Date() } },
    );
    const record = await PendingActionModel.create({
      type: input.type,
      userId: input.user.id,
      sessionId: input.sessionId,
      summary: input.summary,
      payload: input.payload,
      expiresAt: new Date(now + this.ttlMs),
      purgeAt: new Date(now + this.ttlMs + PURGE_AFTER_MS),
    });
    return toView(record.toObject());
  }

  async listForSession(sessionId: string, userId: string): Promise<PendingActionView[]> {
    const rows = await PendingActionModel.find({ sessionId, userId }).sort({ createdAt: 1 }).lean<PendingActionRecord[]>();
    return rows.map(toView);
  }

  async confirm(id: string, user: AuthUser): Promise<PendingActionView> {
    const claimed = await PendingActionModel.findOneAndUpdate(
      { _id: id, userId: user.id, status: 'pending', expiresAt: { $gt: new Date() } },
      { $set: { status: 'executing' } },
      { new: true },
    ).lean<PendingActionRecord>();
    if (!claimed) throw await this.rejection(id, user);

    let update: Partial<PendingActionRecord>;
    try {
      const result = await this.executors[claimed.type](claimed.payload as never, user);
      update = { status: 'completed', result };
    } catch (err) {
      logger.warn({ err, actionId: id, type: claimed.type }, 'Confirmed agent action failed');
      update = { status: 'failed', error: (err as Error).message };
    }
    const done = await PendingActionModel.findByIdAndUpdate(
      id,
      { $set: { ...update, resolvedAt: new Date() } },
      { new: true },
    ).lean<PendingActionRecord>();
    await this.conversations.updateActionStatus(id, done!.status);
    return toView(done!);
  }

  async decline(id: string, user: AuthUser): Promise<PendingActionView> {
    const declined = await PendingActionModel.findOneAndUpdate(
      { _id: id, userId: user.id, status: 'pending' },
      { $set: { status: 'declined', resolvedAt: new Date() } },
      { new: true },
    ).lean<PendingActionRecord>();
    if (!declined) throw await this.rejection(id, user);
    await this.conversations.updateActionStatus(id, 'declined');
    return toView(declined);
  }

  private async rejection(id: string, user: AuthUser) {
    const existing = await PendingActionModel.findById(id).lean<PendingActionRecord>();
    if (!existing) return new NotFoundError('Action not found');
    if (String(existing.userId) !== user.id) return new ForbiddenError();
    const view = toView(existing);
    return new ConflictError(
      view.status === 'expired' ? 'This request has expired, please ask again' : `This request is already ${view.status}`,
    );
  }

  private async addToCart(p: AddToCartPayload, user: AuthUser) {
    const current = await this.cart.getItems(user.id);
    const items = await this.cart.replaceItems(user.id, [
      ...current.map(i => ({ productId: i.productId, size: i.size, qty: i.qty })),
      { productId: p.productId, size: p.size, qty: p.qty },
    ]);
    const item = items.find(i => i.productId === p.productId && i.size === p.size);
    return { item: item ? { ...item, qty: p.qty } : null, cartCount: items.reduce((n, i) => n + i.qty, 0) };
  }

  private async cancelOrder(p: OrderActionPayload, user: AuthUser) {
    const order = await this.orders.cancel(p.orderId, user);
    return { orderNumber: p.orderNumber, status: order.status };
  }

  private async requestRefund(p: OrderActionPayload, user: AuthUser) {
    const order = await this.orders.requestRefund(p.orderId, user, {
      reason: p.reason ?? 'Requested via shopping assistant',
      lines: p.lines,
    });
    return { orderNumber: p.orderNumber, status: order.status };
  }
}
