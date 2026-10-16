import type { BulkTransitionInput, OrderStatus, RefundRequestInput } from '@storefront/contracts';
import type { Request, Response } from 'express';
import type { AuthedReq, IdParams, Req } from '../../core/http/types';
import type { AdminService } from './admin.service';

export class AdminController {
  constructor(private readonly admin: AdminService) {}

  stats = async (_req: Request, res: Response) => {
    res.json(await this.admin.stats());
  };

  revenueByDay = async (req: Req<unknown, { days: number }>, res: Response) => {
    res.json(await this.admin.revenueByDay(req.query.days));
  };

  funnel = async (_req: Request, res: Response) => {
    res.json(await this.admin.funnel());
  };

  topProducts = async (_req: Request, res: Response) => {
    res.json(await this.admin.topProducts());
  };

  lowStock = async (req: Req<unknown, { threshold: number }>, res: Response) => {
    res.json(await this.admin.lowStock(req.query.threshold));
  };

  orders = async (req: Req<unknown, { status?: OrderStatus; page: number }>, res: Response) => {
    res.json(await this.admin.listOrders(req.query.status, req.query.page));
  };

  bulkTransition = async (req: AuthedReq<BulkTransitionInput>, res: Response) => {
    res.json(await this.admin.bulkTransition(req.body.ids, req.body.to, req.user.id));
  };

  refundOrder = async (req: AuthedReq<RefundRequestInput, unknown, IdParams>, res: Response) => {
    const order = await this.admin.refundOrder(req.params.id, req.body, req.user.id);
    res.locals.audit = {
      targets: [order.id],
      changes: { refund: order.openRefund ? { amount: order.openRefund.amount, lines: order.openRefund.lines } : null },
    };
    res.json(order);
  };

  conversations = async (_req: Request, res: Response) => {
    res.json(await this.admin.listConversations());
  };
}
