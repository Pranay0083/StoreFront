/**
 * Serialises work per key within this process. Callers holding several keys register on all of
 * them at once and wait for every earlier holder, so overlapping key sets cannot deadlock.
 * Used to queue checkouts for the same hot SKU in memory instead of letting them abort each other
 * in MongoDB; across processes the transaction retry backoff still applies.
 */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(keys: readonly string[], work: () => Promise<T>): Promise<T> {
    const ordered = [...new Set(keys)];
    let release!: () => void;
    const held = new Promise<void>(resolve => (release = resolve));
    const previous = ordered.map(key => this.tails.get(key));
    for (const key of ordered) this.tails.set(key, held);
    await Promise.all(previous);
    try {
      return await work();
    } finally {
      release();
      for (const key of ordered) if (this.tails.get(key) === held) this.tails.delete(key);
    }
  }

  get activeKeys(): number {
    return this.tails.size;
  }
}
