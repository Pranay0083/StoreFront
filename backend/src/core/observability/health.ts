import { Router } from 'express';
import mongoose from 'mongoose';

export interface ReadinessCheck {
  name: string;
  /** A failing critical check takes the instance out of rotation; others only mark it degraded. */
  critical: boolean;
  check(): Promise<boolean>;
}

export type CheckStatus = 'ok' | 'fail' | 'timeout';

export interface Readiness {
  status: 'ready' | 'degraded' | 'unavailable' | 'draining';
  checks: Record<string, CheckStatus>;
}

const withTimeout = (p: Promise<boolean>, ms: number): Promise<CheckStatus> =>
  Promise.race([
    p.then(ok => (ok ? 'ok' : 'fail') as CheckStatus).catch(() => 'fail' as const),
    new Promise<CheckStatus>(resolve => setTimeout(() => resolve('timeout'), ms).unref()),
  ]);

/**
 * Liveness answers "is the process running" (never touches dependencies, so a slow database can't
 * get healthy pods restarted). Readiness answers "should this instance get traffic": dependencies
 * reachable and not shutting down.
 */
export class HealthMonitor {
  private draining = false;
  private readonly startedAt = Date.now();

  constructor(
    private readonly checks: ReadinessCheck[],
    private readonly timeoutMs = 2_000,
  ) {}

  markDraining(): void {
    this.draining = true;
  }

  liveness() {
    return { status: 'ok' as const, uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000) };
  }

  async readiness(): Promise<Readiness> {
    const results = await Promise.all(this.checks.map(async c => [c, await withTimeout(c.check(), this.timeoutMs)] as const));
    const checks = Object.fromEntries(results.map(([c, s]) => [c.name, s]));
    if (this.draining) return { status: 'draining', checks };
    if (results.some(([c, s]) => c.critical && s !== 'ok')) return { status: 'unavailable', checks };
    return { status: results.some(([, s]) => s !== 'ok') ? 'degraded' : 'ready', checks };
  }

  routes(): Router {
    const router = Router();
    router.get('/health', (_req, res) => void res.json(this.liveness()));
    router.get('/ready', async (_req, res) => {
      const readiness = await this.readiness();
      res.status(readiness.status === 'ready' || readiness.status === 'degraded' ? 200 : 503).json(readiness);
    });
    return router;
  }
}

export const mongoCheck: ReadinessCheck = {
  name: 'mongodb',
  critical: true,
  async check() {
    if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) return false;
    await mongoose.connection.db.admin().ping();
    return true;
  },
};
