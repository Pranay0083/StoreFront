import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().default(4001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  MONGO_URL: z.string({ required_error: 'MONGO_URL is required' }).min(1, 'MONGO_URL is required'),
  DB_NAME: z.string().min(1).default('storefront'),
  JWT_SECRET: z.string({ required_error: 'JWT_SECRET is required' }).min(8, 'JWT_SECRET must be at least 8 characters'),
  ADMIN_EMAIL: z.string().email().default('admin@storefront.dev'),
  ADMIN_PASSWORD: z.string().min(8, 'ADMIN_PASSWORD must be at least 8 characters').optional(),
  FRONTEND_URL: z.string().url().default('http://localhost:3000'),
  RAZORPAY_KEY_ID: z.string().default(''),
  RAZORPAY_KEY_SECRET: z.string().default(''),
  RAZORPAY_WEBHOOK_SECRET: z.string().default(''),
  GROQ_API_KEY: z.string().default(''),
  GROQ_MODEL: z.string().default('openai/gpt-oss-120b'),
  SEED_DEMO_DATA: z
    .enum(['true', 'false'])
    .default('true')
    .transform(v => v === 'true'),
});

export type Env = z.infer<typeof EnvSchema>;

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

