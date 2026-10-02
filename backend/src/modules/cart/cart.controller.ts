import type { UpdateCartInput } from '@storefront/contracts';
import type { Response } from 'express';
import type { AuthedReq } from '../../core/http/types';
import type { CartService } from './cart.service';

export class CartController {
  constructor(private readonly cart: CartService) {}

  get = async (req: AuthedReq, res: Response) => {
    res.json({ items: await this.cart.getItems(req.user.id) });
  };

  replace = async (req: AuthedReq<UpdateCartInput>, res: Response) => {
    await this.cart.replaceItems(req.user.id, req.body.items);
    res.json({ ok: true });
  };
}
