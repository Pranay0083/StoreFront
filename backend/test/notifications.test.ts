import mongoose from 'mongoose';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { CartModel as Cart } from '../src/modules/cart/cart.model';
import { recordOpeningBalances } from '../src/modules/inventory/opening-balances';
import type { ConsoleEmailProvider, ConsoleMessagingProvider, EmailProvider } from '../src/modules/notifications/channels';
import { NotificationLogModel, NotificationLogRepository } from '../src/modules/notifications/notification-log';
import { NotificationService } from '../src/modules/notifications/notification.service';
import { ADDRESS, createProduct, createUser } from './helpers/factories';
import { API, bearer, useTestApp } from './helpers/app';

const t = useTestApp();
const email = () => t.container.services.emailProvider as ConsoleEmailProvider;
const sms = () => t.container.services.messagingProviders.find(p => p.channel === 'sms') as ConsoleMessagingProvider;
const inbox = (to: string) => email().sent.filter(m => m.to === to);

async function paidOrder() {
  const buyer = await createUser({ name: 'Asha Verma' });
  const product = await createProduct({ title: 'Oxford Shirt' });
  await recordOpeningBalances(mongoose.connection.db!);
  const { body: order } = await t
    .http()
    .post(`${API}/orders`)
    .set(bearer(buyer.token))
    .send({ address: ADDRESS, items: [{ productId: String(product._id), size: 'M', qty: 2 }] })
    .expect(201);
  await t.http().post(`${API}/payments/demo-confirm`).set(bearer(buyer.token)).send({ orderId: order._id }).expect(200);
  return { buyer, order };
}

describe('order notifications', () => {
  it('e-mails an order confirmation once the payment is captured, exactly once', async () => {
    const { buyer, order } = await paidOrder();
    await t.settle();

    const [mail] = inbox(buyer.user.email);
    expect(inbox(buyer.user.email)).toHaveLength(1);
    expect(mail.subject).toBe(`Order ${order.orderNumber} confirmed`);
    expect(mail.text).toContain('Oxford Shirt (M) × 2');
    expect(mail.html).toContain(`/orders/${order._id}`);
    expect(await NotificationLogModel.findById(`order-confirmation:${order._id}:email`).lean()).toMatchObject({
      status: 'sent',
      provider: 'console',
      attempts: 1,
    });

    const replay = await t.container.services.notifications.deliver({
      key: `order-confirmation:${order._id}`,
      template: 'orderConfirmation',
      data: { name: 'x', orderNumber: order.orderNumber, total: 1, items: [], orderUrl: 'u' },
      to: { email: buyer.user.email },
    });
    expect(replay).toEqual([{ channel: 'email', status: 'skipped' }]);
    expect(inbox(buyer.user.email)).toHaveLength(1);
  });

  it('notifies by e-mail and SMS when the order ships, and by e-mail on delivery', async () => {
    const { buyer, order } = await paidOrder();
    const admin = await createUser({ role: 'admin' });
    for (const to of ['packed', 'shipped', 'delivered']) {
      await t
        .http()
        .post(`${API}/admin/orders/bulk-transition`)
        .set(bearer(admin.token))
        .send({ ids: [order._id], to })
        .expect(200);
    }
    await t.settle();

    expect(inbox(buyer.user.email).map(m => m.subject)).toEqual([
      `Order ${order.orderNumber} confirmed`,
      `Order ${order.orderNumber} is on its way`,
      `Order ${order.orderNumber} was delivered`,
    ]);
    expect(
      sms()
        .sent.filter(m => m.to === ADDRESS.phone)
        .map(m => m.body),
    ).toEqual([expect.stringContaining(`order ${order.orderNumber} has shipped`)]);
  });
});

describe('NotificationService delivery guarantees', () => {
  it('records a failed attempt and sends exactly once when the retry succeeds', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('smtp timeout')).mockResolvedValue({ provider: 'flaky' });
    const flaky: EmailProvider = { name: 'flaky', send };
    const service = new NotificationService(flaky, [], new NotificationLogRepository(), 'from@test.dev', pino({ level: 'silent' }));
    const request = {
      key: 'refund-completed:o1',
      template: 'refundCompleted' as const,
      data: { name: 'A', orderNumber: 'SF-9', amount: 10_000, orderUrl: 'u' },
      to: { email: 'r@test.dev' },
    };

    await expect(service.deliver(request)).rejects.toThrow('smtp timeout');
    expect(await NotificationLogModel.findById('refund-completed:o1:email').lean()).toMatchObject({
      status: 'failed',
      lastError: 'smtp timeout',
    });
    expect(await service.deliver(request)).toEqual([{ channel: 'email', status: 'sent' }]);
    expect(await service.deliver(request)).toEqual([{ channel: 'email', status: 'skipped' }]);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('skips channels without a recipient or provider', async () => {
    const service = t.container.services.notifications;
    const out = await service.deliver({
      key: 'k1',
      template: 'orderDelivered',
      data: { name: 'A', orderNumber: 'SF-1', orderUrl: 'u' },
      to: { email: 'x@test.dev' },
      channels: ['email', 'sms'],
    });
    expect(out).toEqual([
      { channel: 'email', status: 'sent' },
      { channel: 'sms', status: 'unavailable' },
    ]);
  });
});

describe('abandoned-cart reminders', () => {
  const HOUR = 3_600_000;

  async function idleCart(hoursAgo: number) {
    const shopper = await createUser({ name: 'Kabir Rao' });
    const product = await createProduct({ title: 'Linen Overshirt', slug: `linen-overshirt-${hoursAgo}` });
    const cart = await Cart.create({ userId: shopper.user._id, items: [{ productId: product._id, size: 'L', qty: 1 }] });
    const at = new Date(Date.now() - hoursAgo * HOUR);
    await Cart.collection.updateOne({ _id: cart._id }, { $set: { updatedAt: at } });
    return { shopper, cart, product };
  }

  it('reminds once per cart version, skipping fresh and stale carts', async () => {
    const { shopper, cart } = await idleCart(8);
    const fresh = await idleCart(1);
    const stale = await idleCart(24 * 10);
    const reminder = t.container.services.abandonedCarts;

    expect(await reminder.scan()).toBe(1);
    await t.settle();
    expect(await reminder.scan()).toBe(1);
    await t.settle();

    const mails = inbox(shopper.user.email);
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toBe('You left something in your bag');
    expect(mails[0].text).toContain('Linen Overshirt (L) × 1');
    expect(inbox(fresh.shopper.user.email)).toHaveLength(0);
    expect(inbox(stale.shopper.user.email)).toHaveLength(0);

    await Cart.collection.updateOne({ _id: cart._id }, { $set: { 'items.0.qty': 2, updatedAt: new Date(Date.now() - 7 * HOUR) } });
    await reminder.scan();
    await t.settle();
    expect(inbox(shopper.user.email)).toHaveLength(2);
  });
});
