import type { CartResponse, UpdateCartInput } from '@storefront/contracts';
import type { Response } from 'express';
import type { AuthedReq, Req } from '../../core/http/types';
import { CartService } from './cart.service';

export class CartController {
  constructor(private readonly cart: CartService) {}

  get = async (req: AuthedReq, res: Response) => {
    const body: CartResponse = { items: await this.cart.getItems(req.user.id) };
    res.json(body);
  };

  replace = async (req: AuthedReq<UpdateCartInput>, res: Response) => {
    const body: CartResponse = { items: await this.cart.replaceItems(req.user.id, req.body.items) };
    res.json(body);
  };

  /** Prices a guest's locally stored cart without persisting it. */
  hydrate = async (req: Req<UpdateCartInput>, res: Response) => {
    const body: CartResponse = { items: await this.cart.hydrate(CartService.normalize(req.body.items)) };
    res.json(body);
  };
}
