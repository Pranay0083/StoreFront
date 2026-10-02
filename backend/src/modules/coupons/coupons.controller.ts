import type { CouponInput, CouponUpdate, CouponValidation, ValidateCouponInput } from '@storefront/contracts';
import type { Request, Response } from 'express';
import type { AuthedReq, IdParams } from '../../core/http/types';
import type { CouponService } from './coupons.service';

export class CouponsController {
  constructor(private readonly coupons: CouponService) {}

  validate = async (req: AuthedReq<ValidateCouponInput>, res: Response) => {
    const { coupon, discount } = await this.coupons.quote(req.body.code, req.body.subtotal);
    const body: CouponValidation = { code: coupon.code, type: coupon.type, value: coupon.value, discount };
    res.json(body);
  };

  list = async (_req: Request, res: Response) => {
    res.json(await this.coupons.list());
  };

  create = async (req: AuthedReq<CouponInput>, res: Response) => {
    res.status(201).json(await this.coupons.create(req.body, req.user.id));
  };

  update = async (req: AuthedReq<CouponUpdate, unknown, IdParams>, res: Response) => {
    res.json(await this.coupons.update(req.params.id, req.body, req.user.id));
  };

  remove = async (req: AuthedReq<unknown, unknown, IdParams>, res: Response) => {
    await this.coupons.delete(req.params.id, req.user.id);
    res.json({ ok: true });
  };
}
