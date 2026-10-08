import type { mongo } from 'mongoose';

/**
 * Brings the ledger in line with the stock counters by appending one ADJUST "opening balance"
 * movement per variant whose counter is not explained by existing movements. Idempotent.
 */
export async function recordOpeningBalances(db: mongo.Db, actor = 'system:opening-balance'): Promise<number> {
  const balances = await db
    .collection('inventorymovements')
    .aggregate<{ _id: { productId: mongo.ObjectId; size: string }; balance: number }>([
      { $group: { _id: { productId: '$productId', size: '$size' }, balance: { $sum: '$delta' } } },
    ])
    .toArray();
  const ledger = new Map(balances.map(b => [`${b._id.productId}:${b._id.size}`, b.balance]));

  const now = new Date();
  const movements = [];
  const products = db.collection<{ _id: mongo.ObjectId; sizes?: Array<{ size: string; stock: number }> }>('products');
  for await (const product of products.find({}, { projection: { sizes: 1 } })) {
    for (const variant of product.sizes ?? []) {
      const delta = variant.stock - (ledger.get(`${product._id}:${variant.size}`) ?? 0);
      if (delta === 0) continue;
      movements.push({
        productId: product._id,
        size: variant.size,
        type: 'ADJUST',
        qty: Math.abs(delta),
        delta,
        actor,
        note: 'Opening balance',
        createdAt: now,
      });
    }
  }
  if (movements.length) await db.collection('inventorymovements').insertMany(movements);
  return movements.length;
}
