import { describe, expect, it } from 'vitest';
import { ProductModel } from '../src/modules/catalog/product.model';
import { InventoryMovementModel } from '../src/modules/inventory/inventory-movement.model';
import { createProduct, createUser } from './helpers/factories';
import { API, bearer, useTestApp } from './helpers/app';

const t = useTestApp();

const HEADER = 'title,slug,category,description,price,compare_at_price,images,sizes,featured';
const IMG = 'https://images.unsplash.com/photo-import';

function upload(token: string, csv: string, filename = 'products.csv') {
  return t.http().post(`${API}/admin/imports`).set(bearer(token)).attach('file', Buffer.from(csv), { filename, contentType: 'text/csv' });
}

describe('CSV product import', () => {
  it('creates and updates products, adjusting stock through the ledger, and reports row errors', async () => {
    const manager = await createUser({ role: 'catalog_manager' });
    const existing = await createProduct({ title: 'Existing Tee', slug: 'existing-tee', sizes: [{ size: 'M', stock: 3 }] });
    const csv = [
      HEADER,
      `Imported Shirt,,Men,"Soft, breathable",1499,1999,${IMG},S:2|M:5,true`,
      `Existing Tee,existing-tee,Men,,899,,${IMG},M:12,`,
      `,broken,Men,,abc,,${IMG},M:1,`,
    ].join('\n');

    const res = await upload(manager.token, csv).expect(202);
    expect(res.body).toMatchObject({ duplicate: false, import: { status: 'queued', filename: 'products.csv' } });
    await t.settle();

    const status = await t.http().get(`${API}/admin/imports/${res.body.import.id}`).set(bearer(manager.token)).expect(200);
    expect(status.body).toMatchObject({ status: 'completed_with_errors', rows: 3, created: 1, updated: 1, failed: 1, progress: 1 });
    expect(status.body.errors[0]).toMatchObject({ row: 4, slug: 'broken' });

    const created = await ProductModel.findOne({ slug: 'imported-shirt' }).lean();
    expect(created).toMatchObject({ price: 149_900, compareAtPrice: 199_900, featured: true, description: 'Soft, breathable' });
    const updated = await ProductModel.findById(existing._id).lean();
    expect(updated).toMatchObject({ price: 89_900, sizes: [expect.objectContaining({ size: 'M', stock: 12 })] });
    expect(await InventoryMovementModel.countDocuments({ productId: existing._id, type: 'ADJUST' })).toBe(1);

    const report = await t.http().get(`${API}/admin/imports/${res.body.import.id}/errors.csv`).set(bearer(manager.token)).expect(200);
    expect(report.headers['content-type']).toMatch(/text\/csv/);
    expect(report.text.split('\n')[0]).toBe('row,slug,error');
    expect(report.text).toMatch(/^4,broken,/m);
  });

  it('is idempotent per file content', async () => {
    const manager = await createUser({ role: 'catalog_manager' });
    const csv = `${HEADER}\nOnce Only,,Men,,999,,${IMG},M:1,\n`;
    const first = await upload(manager.token, csv).expect(202);
    const again = await upload(manager.token, csv, 'renamed.csv').expect(200);
    expect(again.body).toMatchObject({ duplicate: true, import: { id: first.body.import.id } });
    await t.settle();
    expect(await ProductModel.countDocuments({ slug: 'once-only' })).toBe(1);
  });

  it('fails the import when required columns are missing', async () => {
    const manager = await createUser({ role: 'catalog_manager' });
    const res = await upload(manager.token, 'title,price\nX,10\n').expect(202);
    await t.settle();
    const status = await t.http().get(`${API}/admin/imports/${res.body.import.id}`).set(bearer(manager.token)).expect(200);
    expect(status.body).toMatchObject({ status: 'failed' });
    expect(status.body.failure).toMatch(/Missing required columns: category, images, sizes/);
  });

  it('validates the upload and requires catalog:write', async () => {
    const manager = await createUser({ role: 'catalog_manager' });
    await t.http().post(`${API}/admin/imports`).set(bearer(manager.token)).send({}).expect(400);
    await upload(manager.token, 'x', 'products.xlsx').expect(400);
    await upload(manager.token, '').expect(400);
    const support = await createUser({ role: 'support' });
    await upload(support.token, `${HEADER}\n`).expect(403);
  });
});
