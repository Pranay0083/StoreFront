import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { migrations } from '../src/db/migrations';
import { Migrator } from '../src/db/migrator';
import { createProduct } from './helpers/factories';
import { useTestApp } from './helpers/app';

const t = useTestApp();

describe('migrations', () => {
  it('apply cleanly on top of model-created indexes and baseline the inventory ledger', async () => {
    await createProduct();
    const db = mongoose.connection.db!;
    await db.collection('migrations').deleteMany({});

    const applied = await new Migrator(db, migrations).up();
    expect(applied).toEqual(expect.arrayContaining(['010-inventory-ledger', '011-order-consistency-indexes']));
    expect(await t.container.services.inventory.reconcile()).toMatchObject({ ok: true, variantsChecked: 2 });

    const ttl = (await db.collection('idempotencykeys').indexes()).find(i => i.key.createdAt === 1);
    expect(ttl?.expireAfterSeconds).toBe(86_400);
  });
});
