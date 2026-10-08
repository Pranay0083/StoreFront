import type { Request, Response } from 'express';
import type { Req } from '../../core/http/types';
import type { InventoryService } from './inventory.service';

export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  reconcile = async (_req: Request, res: Response) => {
    res.json(await this.inventory.reconcile());
  };

  movements = async (req: Req<unknown, { productId?: string; orderId?: string; limit: number }>, res: Response) => {
    const { limit, ...filter } = req.query;
    res.json(await this.inventory.movementsFor(filter, limit));
  };
}
