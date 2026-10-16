import type { CreateOrderInput, RefundRequestInput } from '@storefront/contracts';
import type { Response } from 'express';
import type { AuthedReq, IdParams } from '../../core/http/types';
import type { OrdersService } from './orders.service';

export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  create = async (req: AuthedReq<CreateOrderInput>, res: Response) => {
    res.status(201).json(await this.orders.create(req.body, req.user));
  };

  listMine = async (req: AuthedReq, res: Response) => {
    res.json(await this.orders.listForUser(req.user.id));
  };

  getById = async (req: AuthedReq<unknown, unknown, IdParams>, res: Response) => {
    res.json(await this.orders.getVisibleTo(req.params.id, req.user));
  };

  cancel = async (req: AuthedReq<unknown, unknown, IdParams>, res: Response) => {
    res.json(await this.orders.cancel(req.params.id, req.user));
  };

  requestRefund = async (req: AuthedReq<RefundRequestInput, unknown, IdParams>, res: Response) => {
    res.json(await this.orders.requestRefund(req.params.id, req.user, req.body));
  };
}
