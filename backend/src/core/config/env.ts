import { hkdfSync } from 'node:crypto';
import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform(v => v === 'true');
const secret = (name: string) => z.string().min(32, `${name} must be at least 32 characters`);

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().positive().default(4001),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    MONGO_URL: z.string({ required_error: 'MONGO_URL is required' }).min(1, 'MONGO_URL is required'),
    DB_NAME: z.string().min(1).default('storefront'),
    JWT_ACCESS_SECRET: secret('JWT_ACCESS_SECRET').optional(),
    JWT_REFRESH_SECRET: secret('JWT_REFRESH_SECRET').optional(),
    JWT_SECRET: z.string().min(8, 'JWT_SECRET must be at least 8 characters').optional(),
    CSRF_SECRET: secret('CSRF_SECRET').optional(),
    COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).optional(),
    COOKIE_SECURE: bool.optional(),
    COOKIE_DOMAIN: z.string().min(1).optional(),
    CORS_ORIGINS: z
      .string()
      .transform(v =>
        v
          .split(',')
          .map(s => s.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.string().url('CORS_ORIGINS must be a comma-separated list of URLs')))
      .optional(),
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    RATE_LIMIT_ENABLED: bool.default('true'),
    ADMIN_EMAIL: z.string().email().default('admin@storefront.dev'),
    ADMIN_PASSWORD: z.string().min(8, 'ADMIN_PASSWORD must be at least 8 characters').optional(),
    FRONTEND_URL: z.string().url().default('http://localhost:3000'),
    RAZORPAY_KEY_ID: z.string().default(''),
    RAZORPAY_KEY_SECRET: z.string().default(''),
    RAZORPAY_WEBHOOK_SECRET: z.string().default(''),
    GROQ_API_KEY: z.string().default(''),
    GROQ_MODEL: z.string().default('openai/gpt-oss-120b'),
    RESERVATION_TTL_MINUTES: z.coerce.number().positive().default(15),
    RESERVATION_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(300_000),
    OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1_000),
    LOW_STOCK_THRESHOLD: z.coerce.number().int().nonnegative().default(5),
    REDIS_URL: z.string().url('REDIS_URL must be a redis:// or rediss:// URL').optional(),
    QUEUE_PREFIX: z.string().min(1).default('storefront'),
    JOBS_IN_PROCESS: z.enum(['auto', 'true', 'false']).default('auto'),
    WORKER_PORT: z.coerce.number().int().positive().default(4002),
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
    MEILI_URL: z.string().url('MEILI_URL must be the Meilisearch base URL').optional(),
    MEILI_API_KEY: z.string().min(1).optional(),
    MEILI_INDEX: z.string().min(1).default('storefront_products'),
    CATALOG_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(60),
    EMAIL_FROM: z.string().min(3).default('STOREFRONT <orders@storefront.dev>'),
    SMTP_URL: z.string().url('SMTP_URL must look like smtp://user:pass@host:587').optional(),
    RESEND_API_KEY: z.string().min(1).optional(),
    ABANDONED_CART_HOURS: z.coerce.number().positive().default(6),
    ABANDONED_CART_SCAN_INTERVAL_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(30 * 60_000),
    SEED_DEMO_DATA: bool.default('true'),
  })
  .superRefine((env, ctx) => {
    const explicit = env.JWT_ACCESS_SECRET && env.JWT_REFRESH_SECRET;
    if (!explicit && !env.JWT_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_ACCESS_SECRET'],
        message: 'Set JWT_ACCESS_SECRET and JWT_REFRESH_SECRET (or the legacy JWT_SECRET)',
      });
    }
    if (env.JWT_ACCESS_SECRET && env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['JWT_REFRESH_SECRET'], message: 'JWT_REFRESH_SECRET must differ from JWT_ACCESS_SECRET' });
    }
    if (env.COOKIE_SAMESITE === 'none' && env.COOKIE_SECURE === false) {
      ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'SameSite=None cookies must be Secure' });
    }
  })
  .transform(env => {
    const derive = (label: string) => Buffer.from(hkdfSync('sha256', env.JWT_SECRET!, '', `storefront:${label}`, 32)).toString('hex');
    const legacy = !(env.JWT_ACCESS_SECRET && env.JWT_REFRESH_SECRET);
    const accessSecret = legacy ? derive('access') : env.JWT_ACCESS_SECRET!;
    return {
      ...env,
      JWT_ACCESS_SECRET: accessSecret,
      JWT_REFRESH_SECRET: legacy ? derive('refresh') : env.JWT_REFRESH_SECRET!,
      CSRF_SECRET: env.CSRF_SECRET ?? Buffer.from(hkdfSync('sha256', accessSecret, '', 'storefront:csrf', 32)).toString('hex'),
      JWT_SECRETS_DERIVED: legacy,
    };
  });

export type Env = z.output<typeof EnvSchema>;

export class ConfigError extends Error {}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ''));
  const result = EnvSchema.safeParse(cleaned);
  if (!result.success) {
    const issues = result.error.issues.map(i => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new ConfigError(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
