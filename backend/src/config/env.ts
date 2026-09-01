import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const dir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(dir, '../.env') });

/**
 * Strongly typed configuration object mapping environment variables with defaults.
 */
export const env = {
  PORT: parseInt(process.env.PORT || '4001', 10),
  MONGO_URL: process.env.MONGO_URL!,
  DB_NAME: process.env.DB_NAME!,
  JWT_SECRET: process.env.JWT_SECRET!,
  ADMIN_EMAIL: process.env.ADMIN_EMAIL || 'admin@storefront.dev',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'Admin@123',
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3000',
  RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID || '',
  RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET || '',
  RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET || '',
  GROQ_API_KEY: process.env.GROQ_API_KEY || '',
  GROQ_MODEL: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
};

/**
 * Determines whether to use live Razorpay integration or mock demo mode.
 */
export const paymentsMode = (): 'razorpay' | 'demo' =>
  env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET ? 'razorpay' : 'demo';
