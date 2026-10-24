import { describe, expect, it } from 'vitest';
import { KeyedMutex } from './keyed-mutex';

const tick = (ms = 2) => new Promise(r => setTimeout(r, ms));

function tracker() {
  const active = new Map<string, number>();
  const peak = new Map<string, number>();
  return {
    peak,
    async hold(keys: string[], ms = 2) {
      for (const k of keys) {
        active.set(k, (active.get(k) ?? 0) + 1);
        peak.set(k, Math.max(peak.get(k) ?? 0, active.get(k)!));
      }
      await tick(ms);
      for (const k of keys) active.set(k, active.get(k)! - 1);
    },
  };
}

describe('KeyedMutex', () => {
  it('runs work for the same key one at a time, in arrival order', async () => {
    const mutex = new KeyedMutex();
    const order: number[] = [];
    const t = tracker();
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        mutex.run(['sku:M'], async () => {
          await t.hold(['sku:M']);
          order.push(i);
        }),
      ),
    );
    expect(t.peak.get('sku:M')).toBe(1);
    expect(order).toEqual([...Array(20).keys()]);
    expect(mutex.activeKeys).toBe(0);
  });

  it('lets different keys proceed in parallel', async () => {
    const mutex = new KeyedMutex();
    let concurrent = 0;
    let peak = 0;
    await Promise.all(
      ['a', 'b', 'c', 'd'].map(k =>
        mutex.run([k], async () => {
          peak = Math.max(peak, ++concurrent);
          await tick(5);
          concurrent--;
        }),
      ),
    );
    expect(peak).toBe(4);
  });

  it('does not deadlock on overlapping multi-key requests and keeps each key exclusive', async () => {
    const mutex = new KeyedMutex();
    const t = tracker();
    const sets = [['a', 'b'], ['b', 'a'], ['b', 'c'], ['c', 'a'], ['a'], ['c', 'b', 'a']];
    await Promise.all(Array.from({ length: 30 }, (_, i) => mutex.run(sets[i % sets.length], () => t.hold(sets[i % sets.length], 1))));
    expect([...t.peak.values()].every(v => v === 1)).toBe(true);
    expect(mutex.activeKeys).toBe(0);
  });

  it('releases the key when work throws', async () => {
    const mutex = new KeyedMutex();
    await expect(mutex.run(['k'], async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(mutex.run(['k'], async () => 'next')).resolves.toBe('next');
    expect(mutex.activeKeys).toBe(0);
  });
});
