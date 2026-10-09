import type { NextFunction, Request, RequestHandler, Response } from 'express';
import rateLimit, { type Store } from 'express-rate-limit';
import type { Env } from '../config/env';
import { TooManyRequestsError } from '../errors';

/** Supplies the counter store for a policy; `undefined` means the per-process memory store. */
export type RateLimitStoreFactory = (policy: string) => Store | undefined;

export const memoryStores: RateLimitStoreFactory = () => undefined;

type Matcher = (req: Pick<Request, 'method' | 'path'>) => boolean;

export interface RateLimitPolicy {
  windowMs: number;
  limit: number;
  message: string;
  /** Routes the policy applies to, matched against paths relative to the API prefix. Omitted = every route. */
  matches?: Matcher;
}

const MINUTE = 60_000;
const route =
  (method: string, ...patterns: RegExp[]): Matcher =>
  req =>
    req.method === method && patterns.some(p => p.test(req.path));

/**
 * Policies stack: a request counts against the global budget and every specific policy it matches.
 * Limits are per client IP (honouring TRUST_PROXY).
 */
export const RATE_LIMIT_POLICIES = {
  global: {
    windowMs: MINUTE,
    limit: 300,
    message: 'Too many requests, please slow down',
  },
  auth: {
    windowMs: 15 * MINUTE,
    limit: 20,
    matches: route('POST', /^\/auth\/(login|register)\/?$/),
    message: 'Too many sign-in attempts from this network, please try again later',
  },
  session: {
    windowMs: 15 * MINUTE,
    limit: 60,
    matches: route('POST', /^\/auth\/(refresh|logout|logout-all)\/?$/),
    message: 'Too many session requests, please try again later',
  },
  checkout: {
    windowMs: 10 * MINUTE,
    limit: 30,
    matches: route(
      'POST',
      /^\/orders\/?$/,
      /^\/orders\/[^/]+\/cancel\/?$/,
      /^\/payments\/(create|verify|demo-confirm)\/?$/,
      /^\/coupons\/validate\/?$/,
    ),
    message: 'Too many checkout attempts, please wait a few minutes',
  },
  agentChat: {
    windowMs: MINUTE,
    limit: 15,
    matches: route('POST', /^\/agent\/chat\/?$/),
    message: 'The shopping assistant is getting a lot of messages from you, please wait a moment',
  },
  catalogRead: {
    windowMs: MINUTE,
    limit: 120,
    matches: route('GET', /^\/products(\/|$)/, /^\/reviews\/product\//),
    message: 'Too many catalog requests, please slow down',
  },
  mcp: {
    windowMs: MINUTE,
    limit: 60,
    matches: req => /^\/mcp(\/|$)/.test(req.path),
    message: 'Too many MCP requests',
  },
} satisfies Record<string, RateLimitPolicy>;

export type RateLimitPolicyName = keyof typeof RATE_LIMIT_POLICIES;

/** Server-to-server callers that retry on their own schedule and authenticate by signature. */
const UNLIMITED: Matcher = req => req.method === 'POST' && /^\/payments\/webhook\/?$/.test(req.path);

export function createRateLimiters(
  env: Pick<Env, 'RATE_LIMIT_ENABLED'>,
  stores: RateLimitStoreFactory = memoryStores,
  policies: Record<string, RateLimitPolicy> = RATE_LIMIT_POLICIES,
) {
  const build = (name: string, policy: RateLimitPolicy) =>
    rateLimit({
      windowMs: policy.windowMs,
      limit: policy.limit,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      identifier: name,
      store: stores(name),
      skip: req => !env.RATE_LIMIT_ENABLED || UNLIMITED(req),
      handler: (_req, _res, next) => next(new TooManyRequestsError(policy.message)),
    });

  const limiters = Object.entries(policies).map(([name, policy]) => ({ name, policy, handler: build(name, policy) }));

  /** Runs every limiter whose policy matches the request, in declaration order. */
  const middleware: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
    const applicable = limiters.filter(l => !l.policy.matches || l.policy.matches(req));
    let i = 0;
    const step = (err?: unknown) => {
      if (err) return next(err);
      const limiter = applicable[i++];
      if (!limiter) return next();
      void limiter.handler(req, res, step);
    };
    step();
  };

  return { middleware, policies: Object.fromEntries(limiters.map(l => [l.name, l.handler])) };
}

export type RateLimiters = ReturnType<typeof createRateLimiters>;
