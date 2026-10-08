import { TooManyRequestsError } from '../../core/errors';
import { logger } from '../../core/logger';
import type { LoginAttemptRepository } from './login-attempt.repository';

export interface ThrottlePolicy {
  scope: 'ip_email' | 'email';
  /** Failures allowed before any delay applies. */
  freeAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

/**
 * Per IP+email keeps a single attacker slow without letting them lock the real owner out from
 * another network; the looser per-email policy slows credential stuffing spread across many IPs.
 */
export const LOGIN_THROTTLE_POLICIES: readonly ThrottlePolicy[] = [
  { scope: 'ip_email', freeAttempts: 3, baseDelayMs: 1_000, maxDelayMs: 15 * 60_000 },
  { scope: 'email', freeAttempts: 10, baseDelayMs: 2_000, maxDelayMs: 15 * 60_000 },
];

export const backoffMs = (failures: number, p: ThrottlePolicy) =>
  failures < p.freeAttempts ? 0 : Math.min(p.maxDelayMs, p.baseDelayMs * 2 ** (failures - p.freeAttempts));

export class LoginThrottle {
  constructor(
    private readonly attempts: LoginAttemptRepository,
    private readonly policies: readonly ThrottlePolicy[] = LOGIN_THROTTLE_POLICIES,
  ) {}

  private key(policy: ThrottlePolicy, ip: string, email: string) {
    return policy.scope === 'email' ? `email:${email}` : `ip:${ip}|email:${email}`;
  }

  async assertAllowed(ip: string, email: string, now = new Date()): Promise<void> {
    const keys = this.policies.map(p => this.key(p, ip, email));
    const records = new Map((await this.attempts.findMany(keys)).map(r => [r.key, r]));
    let waitMs = 0;
    for (const [i, policy] of this.policies.entries()) {
      const record = records.get(keys[i]);
      if (!record) continue;
      const until = record.lastFailureAt.getTime() + backoffMs(record.failures, policy);
      waitMs = Math.max(waitMs, until - now.getTime());
    }
    if (waitMs > 0) {
      const seconds = Math.ceil(waitMs / 1000);
      logger.warn({ email, ip, retryAfter: seconds }, 'Login throttled');
      throw new TooManyRequestsError(`Too many failed attempts. Try again in ${seconds} second${seconds === 1 ? '' : 's'}.`, seconds);
    }
  }

  async recordFailure(ip: string, email: string, now = new Date()): Promise<void> {
    await Promise.all(this.policies.map(p => this.attempts.recordFailure(this.key(p, ip, email), now)));
  }

  async recordSuccess(ip: string, email: string): Promise<void> {
    const local = this.policies.find(p => p.scope === 'ip_email');
    if (local) await this.attempts.clear(this.key(local, ip, email));
  }
}
