import { describe, expect, it } from 'vitest';
import { PromotionRepository } from '../src/modules/pricing/promotion.repository';
import { useTestApp } from './helpers/app';

useTestApp();
const repo = new PromotionRepository();

const input = {
  name: 'Any 3 shirts',
  description: '',
  status: 'active' as const,
  activation: 'auto' as const,
  priority: 100,
  exclusive: false,
  action: { type: 'mixAndMatch' as const, selector: { categories: ['Men'] }, quantity: 3, price: 499_900 },
};

describe('PromotionRepository', () => {
  it('stores an immutable snapshot for every version', async () => {
    const created = await repo.create(input, 'user:admin');
    expect(created.version).toBe(1);
    const updated = await repo.update(String(created._id), { name: 'Any 3 shirts & tops', priority: 150 }, 'user:admin');
    expect(updated).toMatchObject({ version: 2, name: 'Any 3 shirts & tops', priority: 150 });

    const versions = await repo.versions(String(created._id));
    expect(versions.map(v => v.version)).toEqual([2, 1]);
    expect(versions[1].snapshot).toMatchObject({ name: 'Any 3 shirts', priority: 100, version: 1 });
    expect(versions[0].snapshot).toMatchObject({ name: 'Any 3 shirts & tops', version: 2 });
  });

  it('rejects updates based on a stale version', async () => {
    const created = await repo.create(input, 'user:admin');
    const id = String(created._id);
    expect(await repo.update(id, { priority: 1 }, 'user:a', 1)).not.toBeNull();
    expect(await repo.update(id, { priority: 2 }, 'user:b', 1)).toBeNull();
    expect((await repo.findById(id))?.priority).toBe(1);
  });

  it('redeems atomically up to the usage limit', async () => {
    const created = await repo.create({ ...input, usageLimit: 2 }, 'user:admin');
    const id = String(created._id);
    const results = await Promise.all(Array.from({ length: 5 }, () => repo.tryRedeem(id)));
    expect(results.filter(Boolean)).toHaveLength(2);
    expect((await repo.findById(id))?.usedCount).toBe(2);
    await repo.releaseRedemption(id);
    expect((await repo.findById(id))?.usedCount).toBe(1);
  });

  it('enforces unique codes but allows many code-less promotions', async () => {
    await repo.create(input, 'user:admin');
    await repo.create(input, 'user:admin');
    await repo.create({ ...input, activation: 'code', code: 'WELCOME10' }, 'user:admin');
    await expect(repo.create({ ...input, activation: 'code', code: 'WELCOME10' }, 'user:admin')).rejects.toThrow(/duplicate key/);
    expect(await repo.codeTaken('WELCOME10')).toBe(true);
  });
});
