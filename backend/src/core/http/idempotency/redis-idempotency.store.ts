import type { Redis } from '../../redis';
import { IDEMPOTENCY_TTL_SECONDS, type IdempotencyRecord } from './idempotency.model';
import type { BeginResult, IdempotencyStorage } from './idempotency.store';

interface StoredRecord {
  requestHash: string;
  status: IdempotencyRecord['status'];
  responseStatus?: number;
  responseBody?: unknown;
  lockedAt: number;
  createdAt: number;
}

/**
 * Atomically claims a key: creates it when absent, or takes over an in-flight claim whose lock went
 * stale (same request body only). Returns {1} when acquired, {0, raw} with the existing record otherwise.
 * Only in-progress records are re-encoded here, so stored response bodies never pass through cjson.
 */
const BEGIN = `
local current = redis.call('GET', KEYS[1])
local now = tonumber(ARGV[2])
if not current then
  redis.call('SET', KEYS[1], ARGV[5], 'PX', ARGV[4])
  return {1}
end
local record = cjson.decode(current)
if record.status == 'in_progress' and record.requestHash == ARGV[1] and (now - record.lockedAt) > tonumber(ARGV[3]) then
  record.lockedAt = now
  redis.call('SET', KEYS[1], cjson.encode(record), 'KEEPTTL')
  return {1}
end
return {0, current}
`;

const RELEASE = `
local current = redis.call('GET', KEYS[1])
if current and cjson.decode(current).status == 'in_progress' then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export class RedisIdempotencyStore implements IdempotencyStorage {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'idempotency:',
    private readonly lockTimeoutMs = 60_000,
    private readonly ttlSeconds = IDEMPOTENCY_TTL_SECONDS,
  ) {}

  async begin(id: string, requestHash: string, now = new Date()): Promise<BeginResult> {
    const fresh: StoredRecord = { requestHash, status: 'in_progress', lockedAt: now.getTime(), createdAt: now.getTime() };
    const result = (await this.redis.eval(
      BEGIN,
      1,
      this.prefix + id,
      requestHash,
      String(now.getTime()),
      String(this.lockTimeoutMs),
      String(this.ttlSeconds * 1000),
      JSON.stringify(fresh),
    )) as [number, string?];
    if (result[0] === 1) return { acquired: true };
    const stored = JSON.parse(result[1]!) as StoredRecord;
    return {
      acquired: false,
      existing: {
        _id: id,
        requestHash: stored.requestHash,
        status: stored.status,
        ...(stored.responseStatus !== undefined && { responseStatus: stored.responseStatus }),
        ...(stored.responseBody !== undefined && { responseBody: stored.responseBody }),
        lockedAt: new Date(stored.lockedAt),
        createdAt: new Date(stored.createdAt),
      },
    };
  }

  /** Only the request that holds the claim calls this, so read-modify-write is safe. */
  async complete(id: string, responseStatus: number, responseBody: unknown): Promise<void> {
    const key = this.prefix + id;
    const raw = await this.redis.get(key);
    if (!raw) return;
    const record = JSON.parse(raw) as StoredRecord;
    await this.redis.set(key, JSON.stringify({ ...record, status: 'completed', responseStatus, responseBody }), 'KEEPTTL');
  }

  async release(id: string): Promise<void> {
    await this.redis.eval(RELEASE, 1, this.prefix + id);
  }
}
