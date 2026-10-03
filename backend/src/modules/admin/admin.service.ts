import { ADMIN_ORDER_ACTIONS, REVENUE_STATUSES, type OrderStatus } from '@storefront/contracts';
import { logger } from '../../core/logger';
import type { UserRepository } from '../auth/user.repository';
import type { CartRepository } from '../cart/cart.repository';
import type { ProductRepository } from '../catalog/product.repository';
import type { ConversationRepository } from '../agent/conversation.repository';
import type { OrderRepository } from '../orders/order.repository';
import type { OrdersService } from '../orders/orders.service';

const DAY_MS = 86_400_000;
const ORDERS_PAGE_SIZE = 20;

export class AdminService {
  constructor(
    private readonly orders: OrderRepository,
    private readonly ordersService: OrdersService,
    private readonly users: UserRepository,
    private readonly carts: CartRepository,
    private readonly products: ProductRepository,
    private readonly conversations: ConversationRepository,
  ) {}

  async stats() {
    const [summary, totalOrders, customers, pendingOrders] = await Promise.all([
      this.orders.revenueSummary(),
      this.orders.count(),
      this.users.countByRole('customer'),
      this.orders.count({ status: { $in: ['paid', 'packed'] } }),
    ]);
    return {
      revenue: summary.revenue,
      paidOrders: summary.orders,
      avgOrderValue: Math.round(summary.avg),
      totalOrders,
      customers,
      pendingOrders,
    };
  }

  revenueByDay(days: number) {
    return this.orders.revenueByDay(new Date(Date.now() - days * DAY_MS));
  }

  async funnel() {
    const [carts, counts] = await Promise.all([this.carts.countNonEmpty(), this.orders.countByStatus()]);
    const placed = Object.values(counts).reduce((a, b) => a + b, 0);
    const paid = REVENUE_STATUSES.reduce((a, s) => a + (counts[s] ?? 0), 0) + (counts.refund_requested ?? 0) + (counts.refunded ?? 0);
    return [
      { stage: 'Active carts', count: carts + placed },
      { stage: 'Orders placed', count: placed },
      { stage: 'Orders paid', count: paid },
      { stage: 'Delivered', count: counts.delivered ?? 0 },
    ];
  }

  topProducts() {
    return this.orders.topProducts(6);
  }

  lowStock(threshold: number) {
    return this.products.lowStock(threshold);
  }

  async listOrders(status: OrderStatus | undefined, page: number) {
    const { orders, total } = await this.orders.page({ status }, page, ORDERS_PAGE_SIZE);
    return { orders, total, page, pages: Math.ceil(total / ORDERS_PAGE_SIZE), transitions: ADMIN_ORDER_ACTIONS };
  }

  async bulkTransition(ids: string[], to: OrderStatus, adminId: string) {
    const results = { updated: 0, rejected: [] as { id: string; reason: string }[] };
    for (const id of ids) {
      const order = await this.orders.findById(id);
      if (!order) {
        results.rejected.push({ id, reason: 'Not found' });
        continue;
      }
      try {
        await this.ordersService.transition(id, to, `admin:${adminId}`, 'Bulk action');
        results.updated++;
      } catch (e) {
        results.rejected.push({ id: order.orderNumber, reason: (e as Error).message });
      }
    }
    logger.info({ adminId, updated: results.updated, rejected: results.rejected.length }, 'Bulk order transition executed');
    return results;
  }

  async listConversations() {
    const convos = await this.conversations.recent(100);
    return convos.map(c => {
      const visible = c.messages.filter(m => m.role !== 'tool');
      const lastUser = [...visible].reverse().find(m => m.role === 'user');
      return {
        _id: c._id,
        sessionId: c.sessionId,
        userName: c.userName || null,
        userEmail: c.userEmail || null,
        channel: c.channel,
        messageCount: visible.length,
        toolCallCount: c.messages.length - visible.length,
        preview: (lastUser?.content || '').slice(0, 120),
        messages: c.messages,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      };
    });
  }
}
