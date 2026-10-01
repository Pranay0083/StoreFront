import type { Request, Response } from 'express';
import type { AuthedReq } from '../../core/http/types';
import type { PaymentsService, VerifyPaymentInput, WebhookInput } from './payments.service';

export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  config = (_req: Request, res: Response) => {
    res.json(this.payments.publicConfig());
  };

  create = async (req: AuthedReq<{ orderId: string }>, res: Response) => {
    res.json(await this.payments.createPayment(req.body.orderId, req.user));
  };

  verify = async (req: AuthedReq<VerifyPaymentInput>, res: Response) => {
    res.json(await this.payments.verify(req.body, req.user));
  };

  demoConfirm = async (req: AuthedReq<{ orderId: string }>, res: Response) => {
    res.json(await this.payments.demoConfirm(req.body.orderId, req.user));
  };

  webhook = async (req: Request, res: Response) => {
    const result = await this.payments.handleWebhook({
      rawBody: req.rawBody,
      signature: req.header('x-razorpay-signature'),
      eventId: req.header('x-razorpay-event-id'),
      payload: (req.body ?? {}) as WebhookInput['payload'],
    });
    res.json(result);
  };
}
