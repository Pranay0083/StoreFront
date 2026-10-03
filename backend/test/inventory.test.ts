import { Types } from 'mongoose';
import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { ProductModel as Product } from '../src/modules/catalog/product.model';
import { InventoryMovementModel as Movement } from '../src/modules/inventory/inventory-movement.model';
import { InsufficientStockError } from '../src/modules/inventory/inventory.service';
import { recordOpeningBalances } from '../src/modules/inventory/opening-balances';
import { StockReservationModel as Reservation } from '../src/modules/inventory/stock-reservation.model';
import { createProduct, createUser } from './helpers/factories';
import { API, bearer, useTestApp } from './helpers/app';

const t = useTestApp();

const inventory = () => t.container.services.inventory;
const tx = () => t.container.tx;
const stockOf = async (productId: unknown, size: string) =>
  (await Product.findById(productId).lean())!.sizes.find(s => s.size === size)!.stock;
const inFuture = () => new Date(Date.now() + 15 * 60_000);

async function productWithBaseline(overrides: Record<string, unknown> = {}) {
  const product = await createProduct(overrides);
  await recordOpeningBalances(mongoose.connection.db!);
  return product;
}

describe('inventory reservations', () => {
  it('reserves all lines or none', async () => {
    const product = await productWithBaseline();
    const orderId = String(new Types.ObjectId());
    const items = [
      { productId: String(product._id), size: 'M', qty: 3, title: product.title },
      { productId: String(product._id), size: 'L', qty: 5, title: product.title },
    ];

    const err = await tx()
      .run(s => inventory().reserve(orderId, items, inFuture(), 'test', s))
      .catch(e => e);
    expect(err).toBeInstanceOf(InsufficientStockError);
    expect(err.message).toBe(`Only 2 left of ${product.title} (L)`);
    expect(await stockOf(product._id, 'M')).toBe(10);
    expect(await Reservation.countDocuments()).toBe(0);
    expect(await Movement.countDocuments({ type: 'RESERVE' })).toBe(0);
  });

  it('moves stock through reserve → commit → restock and keeps the ledger balanced', async () => {
    const product = await productWithBaseline();
    const orderId = String(new Types.ObjectId());
    const items = [{ productId: String(product._id), size: 'M', qty: 4, title: product.title }];

    await tx().run(s => inventory().reserve(orderId, items, inFuture(), 'user:1', s));
    expect(await stockOf(product._id, 'M')).toBe(6);

    expect(await tx().run(s => inventory().commit(orderId, 'system:pay', s))).toBe(true);
    expect(await tx().run(s => inventory().commit(orderId, 'system:pay', s))).toBe(false);
    expect(await tx().run(s => inventory().release(orderId, 'system', 'too late', s))).toBe(false);
    expect(await stockOf(product._id, 'M')).toBe(6);

    expect(await tx().run(s => inventory().restockSale(orderId, 'RETURN', 'system:refund', 'Refunded', s))).toBe(true);
    expect(await tx().run(s => inventory().restockSale(orderId, 'RETURN', 'system:refund', 'Refunded', s))).toBe(false);
    expect(await stockOf(product._id, 'M')).toBe(10);

    const types = (await inventory().movementsFor({ orderId })).map(m => [m.type, m.delta]).reverse();
    expect(types).toEqual([
      ['RESERVE', -4],
      ['SALE', 0],
      ['RETURN', 4],
    ]);
    expect(await inventory().reconcile()).toMatchObject({ ok: true, mismatches: [] });
  });

  it('releases an unpaid reservation exactly once', async () => {
    const product = await productWithBaseline();
    const orderId = String(new Types.ObjectId());
    await tx().run(s =>
      inventory().reserve(orderId, [{ productId: String(product._id), size: 'L', qty: 2, title: product.title }], inFuture(), 'u', s),
    );
    expect(await stockOf(product._id, 'L')).toBe(0);

    const results = await Promise.all([1, 2, 3].map(() => tx().run(s => inventory().release(orderId, 'system:expiry', 'Expired', s))));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await stockOf(product._id, 'L')).toBe(2);
    expect(await inventory().reconcile()).toMatchObject({ ok: true });
  });

  it('lists only active reservations that have expired', async () => {
    const product = await productWithBaseline();
    const expired = String(new Types.ObjectId());
    const live = String(new Types.ObjectId());
    const line = [{ productId: String(product._id), size: 'M', qty: 1, title: product.title }];
    await tx().run(s => inventory().reserve(expired, line, new Date(Date.now() - 1_000), 'u', s));
    await tx().run(s => inventory().reserve(live, line, inFuture(), 'u', s));
    expect(await inventory().expiredReservations(new Date())).toEqual([expired]);
  });
});

describe('inventory ledger', () => {
  it('records admin product creation and stock edits as ledger movements', async () => {
    const admin = await createUser({ role: 'admin' });
    const created = await t
      .http()
      .post(`${API}/products`)
      .set(bearer(admin.token))
      .send({
        title: 'Linen Shirt',
        category: 'Men',
        price: 250_000,
        images: ['https://images.unsplash.com/photo-1'],
        sizes: [{ size: 'M', stock: 5 }],
      })
      .expect(201);
    const id = created.body._id;

    await t
      .http()
      .put(`${API}/products/${id}`)
      .set(bearer(admin.token))
      .send({
        sizes: [
          { size: 'M', stock: 3 },
          { size: 'L', stock: 4 },
        ],
      })
      .expect(200);

    const movements = (await inventory().movementsFor({ productId: id })).reverse();
    expect(movements.map(m => [m.type, m.size, m.delta, m.note])).toEqual([
      ['RESTOCK', 'M', 5, 'Opening stock'],
      ['ADJUST', 'M', -2, 'Manual stock edit'],
      ['ADJUST', 'L', 4, 'Size added'],
    ]);
    expect(movements.every(m => m.actor === `admin:${admin.id}`)).toBe(true);

    const report = await t.http().get(`${API}/admin/inventory/reconcile`).set(bearer(admin.token)).expect(200);
    expect(report.body).toEqual({ ok: true, variantsChecked: 2, mismatches: [] });
  });

  it('detects stock changed outside the ledger', async () => {
    const product = await productWithBaseline();
    await Product.updateOne({ _id: product._id, 'sizes.size': 'M' }, { $inc: { 'sizes.$.stock': -3 } });
    const report = await inventory().reconcile();
    expect(report.ok).toBe(false);
    expect(report.mismatches).toEqual([{ productId: String(product._id), title: product.title, size: 'M', stock: 7, ledger: 10 }]);
  });

  it('backfills opening balances idempotently', async () => {
    await createProduct();
    expect((await inventory().reconcile()).ok).toBe(false);
    expect(await recordOpeningBalances(mongoose.connection.db!)).toBe(2);
    expect(await recordOpeningBalances(mongoose.connection.db!)).toBe(0);
    expect((await inventory().reconcile()).ok).toBe(true);
  });

  it('restricts ledger endpoints to admins', async () => {
    const customer = await createUser();
    await t.http().get(`${API}/admin/inventory/reconcile`).set(bearer(customer.token)).expect(403);
    await t
      .http()
      .get(`${API}/admin/inventory/movements?productId=nope`)
      .set(bearer((await createUser({ role: 'admin' })).token))
      .expect(400);
  });
});
