import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import client from 'prom-client';
import type { CacheObserver } from '../cache/cache';
import type { EventBus } from '../events/event-bus';
import type { OutboxStore } from '../events/outbox.store';
import type { JobObserver } from '../queue/job-runner';
import type { JobQueue } from '../queue/job-queue';
import type { CircuitBreaker, CircuitState } from '../resilience/circuit-breaker';

const CIRCUIT_VALUE: Record<CircuitState, number> = { closed: 0, half_open: 1, open: 2 };

/** Port the pricing module reports through, so it needs no knowledge of Prometheus. */
export interface PricingMetrics {
  observeQuote(report: { strategy: string; nodesExplored: number }, durationMs: number): void;
}

/** Port the agent module reports model calls through. */
export interface AgentMetrics {
  observeLlmCall(call: {
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    latencyMs: number;
    outcome: 'ok' | 'error' | 'refusal';
  }): void;
}

/**
 * One registry per process (API or worker), scraped at /metrics. Business counters are fed by
 * domain-event subscriptions, so they count facts exactly once per event rather than per request.
 */
export class Metrics implements PricingMetrics, AgentMetrics {
  readonly registry = new client.Registry();
  private readonly queues: JobQueue[] = [];
  private readonly circuits: CircuitBreaker[] = [];
  private outbox?: OutboxStore;

  readonly httpDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request latency by route template',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });
  readonly orders = new client.Counter({
    name: 'storefront_orders_total',
    help: 'Order lifecycle events',
    labelNames: ['event'],
    registers: [this.registry],
  });
  readonly payments = new client.Counter({
    name: 'storefront_payments_captured_total',
    help: 'Captured payments by provider',
    labelNames: ['provider'],
    registers: [this.registry],
  });
  readonly revenue = new client.Counter({
    name: 'storefront_payments_captured_paise_total',
    help: 'Captured payment value in paise',
    labelNames: ['provider'],
    registers: [this.registry],
  });
  readonly refunds = new client.Counter({
    name: 'storefront_refunds_total',
    help: 'Refund outcomes',
    labelNames: ['outcome'],
    registers: [this.registry],
  });
  readonly jobs = new client.Counter({
    name: 'storefront_jobs_total',
    help: 'Job executions by outcome',
    labelNames: ['job', 'outcome'],
    registers: [this.registry],
  });
  readonly jobDuration = new client.Histogram({
    name: 'storefront_job_duration_seconds',
    help: 'Successful job run time',
    labelNames: ['job'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 5, 15, 60],
    registers: [this.registry],
  });
  readonly cache = new client.Counter({
    name: 'storefront_cache_requests_total',
    help: 'Cache lookups by result; hit ratio = hit / (hit + miss)',
    labelNames: ['cache', 'result'],
    registers: [this.registry],
  });
  readonly pricingDuration = new client.Histogram({
    name: 'storefront_pricing_duration_seconds',
    help: 'Time to price a cart, by optimizer strategy',
    labelNames: ['strategy'],
    buckets: [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25],
    registers: [this.registry],
  });
  readonly agentLlmCalls = new client.Counter({
    name: 'storefront_agent_llm_calls_total',
    help: 'Model calls made by the shopping assistant',
    labelNames: ['provider', 'model', 'outcome'],
    registers: [this.registry],
  });
  readonly agentTokens = new client.Counter({
    name: 'storefront_agent_tokens_total',
    help: 'Tokens consumed by the shopping assistant',
    labelNames: ['provider', 'model', 'direction'],
    registers: [this.registry],
  });
  readonly agentCost = new client.Counter({
    name: 'storefront_agent_cost_usd_total',
    help: 'Estimated model spend of the shopping assistant in USD',
    labelNames: ['provider', 'model'],
    registers: [this.registry],
  });
  readonly agentLatency = new client.Histogram({
    name: 'storefront_agent_llm_latency_seconds',
    help: 'Latency of shopping assistant model calls',
    labelNames: ['provider'],
    buckets: [0.25, 0.5, 1, 2, 4, 8, 16, 32],
    registers: [this.registry],
  });
  readonly pricingNodes = new client.Histogram({
    name: 'storefront_pricing_optimizer_nodes',
    help: 'Branch-and-bound nodes explored per quote',
    buckets: [1, 10, 100, 1_000, 10_000, 50_000],
    registers: [this.registry],
  });

  constructor(options: { defaultMetrics?: boolean } = {}) {
    if (options.defaultMetrics ?? true) client.collectDefaultMetrics({ register: this.registry });
    const queues = this.queues;
    const circuits = this.circuits;
    const outbox = () => this.outbox;
    new client.Gauge({
      name: 'storefront_queue_jobs',
      help: 'Jobs per queue and state',
      labelNames: ['queue', 'state'],
      registers: [this.registry],
      async collect() {
        this.reset();
        for (const queue of queues) {
          for (const c of await queue.counts().catch(() => [])) {
            for (const state of ['waiting', 'active', 'delayed', 'failed'] as const) this.set({ queue: c.queue, state }, c[state]);
          }
        }
      },
    });
    new client.Gauge({
      name: 'storefront_outbox_events',
      help: 'Outbox events by status',
      labelNames: ['status'],
      registers: [this.registry],
      async collect() {
        this.reset();
        const counts: Record<string, number> =
          (await outbox()
            ?.countByStatus()
            .catch(() => ({}))) ?? {};
        for (const [status, n] of Object.entries(counts)) this.set({ status }, n);
      },
    });
    new client.Gauge({
      name: 'storefront_circuit_breaker_state',
      help: 'Circuit breaker state (0 closed, 1 half-open, 2 open)',
      labelNames: ['circuit'],
      registers: [this.registry],
      collect() {
        for (const breaker of circuits) this.set({ circuit: breaker.name }, CIRCUIT_VALUE[breaker.state]);
      },
    });
  }

  trackQueue(queue: JobQueue): this {
    this.queues.push(queue);
    return this;
  }

  trackOutbox(outbox: OutboxStore): this {
    this.outbox = outbox;
    return this;
  }

  trackCircuit(breaker: CircuitBreaker): this {
    this.circuits.push(breaker);
    return this;
  }

  cacheObserver(): CacheObserver {
    return { hit: name => this.cache.inc({ cache: name, result: 'hit' }), miss: name => this.cache.inc({ cache: name, result: 'miss' }) };
  }

  jobObserver(): JobObserver {
    return {
      onCompleted: (job, ms) => {
        this.jobs.inc({ job, outcome: 'completed' });
        this.jobDuration.observe({ job }, ms / 1000);
      },
      onFailed: (job, final) => this.jobs.inc({ job, outcome: final ? 'dead_lettered' : 'retried' }),
    };
  }

  observeLlmCall(call: Parameters<AgentMetrics['observeLlmCall']>[0]): void {
    const { provider, model } = call;
    this.agentLlmCalls.inc({ provider, model, outcome: call.outcome });
    if (call.inputTokens) this.agentTokens.inc({ provider, model, direction: 'input' }, call.inputTokens);
    if (call.outputTokens) this.agentTokens.inc({ provider, model, direction: 'output' }, call.outputTokens);
    if (call.costUsd) this.agentCost.inc({ provider, model }, call.costUsd);
    this.agentLatency.observe({ provider }, call.latencyMs / 1000);
  }

  observeQuote(report: { strategy: string; nodesExplored: number }, durationMs: number): void {
    this.pricingDuration.observe({ strategy: report.strategy }, durationMs / 1000);
    this.pricingNodes.observe(report.nodesExplored);
  }

  /** Subscriptions with stable ids, so each event is counted once even when delivery is retried. */
  registerEventCounters(bus: EventBus): void {
    bus.subscribe('OrderPlaced', 'metrics.order-placed', async () => void this.orders.inc({ event: 'placed' }));
    bus.subscribe('OrderPaid', 'metrics.order-paid', async e => {
      this.orders.inc({ event: 'paid' });
      this.payments.inc({ provider: e.payload.provider });
      this.revenue.inc({ provider: e.payload.provider }, e.payload.total);
    });
    bus.subscribe('OrderCancelled', 'metrics.order-cancelled', async () => void this.orders.inc({ event: 'cancelled' }));
    bus.subscribe('OrderShipped', 'metrics.order-shipped', async () => void this.orders.inc({ event: 'shipped' }));
    bus.subscribe('OrderDelivered', 'metrics.order-delivered', async () => void this.orders.inc({ event: 'delivered' }));
    bus.subscribe('RefundCompleted', 'metrics.refund-completed', async () => void this.refunds.inc({ outcome: 'completed' }));
    bus.subscribe('RefundFailed', 'metrics.refund-failed', async () => void this.refunds.inc({ outcome: 'failed' }));
  }

  /** Labels by route template (`/api/v1/products/:slug`), never the raw URL, to bound cardinality. */
  httpMiddleware(): RequestHandler {
    return (req: Request, res: Response, next: NextFunction) => {
      const end = this.httpDuration.startTimer();
      res.on('finish', () => end({ method: req.method, route: routeTemplate(req, res), status: String(res.statusCode) }));
      next();
    };
  }

  async render(): Promise<{ contentType: string; body: string }> {
    return { contentType: this.registry.contentType, body: await this.registry.metrics() };
  }
}

/** Remembers where a router is mounted: once a request errors out of a router, req.baseUrl is gone. */
export const routePrefix =
  (prefix: string): RequestHandler =>
  (_req, res, next) => {
    res.locals.routePrefix = prefix;
    next();
  };

function routeTemplate(req: Request, res: Response): string {
  const prefix = res.locals.routePrefix as string | undefined;
  const path = req.route?.path === undefined ? undefined : String(req.route.path);
  if (prefix) return path === undefined ? `${prefix}/*` : path === '/' ? prefix : `${prefix}${path}`;
  return path === undefined ? 'unmatched' : `${req.baseUrl}${path}`;
}

const sameSecret = (a: string, b: string) => {
  const [x, y] = [Buffer.from(a), Buffer.from(b)];
  return x.length === y.length && timingSafeEqual(x, y);
};

const PRIVATE_ADDRESS = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|::ffff:127\.|::ffff:10\.|::ffff:192\.168\.|fc|fd)/;

/**
 * With METRICS_TOKEN set, scrapes need `Authorization: Bearer <token>`. Without it, only direct
 * connections from private networks are allowed (proxied requests carry X-Forwarded-For and are refused).
 */
export function metricsHandler(metrics: Metrics, token?: string): RequestHandler {
  return async (req, res) => {
    const authorized = token
      ? sameSecret(req.header('authorization') ?? '', `Bearer ${token}`)
      : !req.header('x-forwarded-for') && PRIVATE_ADDRESS.test(req.socket.remoteAddress ?? '');
    if (!authorized) {
      res.status(403).json({ error: 'Metrics are not public' });
      return;
    }
    const { contentType, body } = await metrics.render();
    res.setHeader('Content-Type', contentType);
    res.send(body);
  };
}
