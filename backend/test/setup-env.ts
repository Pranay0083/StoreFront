import { randomUUID } from 'node:crypto';
import { inject } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.MONGO_URL = inject('mongoUri');
process.env.DB_NAME = `test_${randomUUID().slice(0, 8)}`;
process.env.JWT_ACCESS_SECRET = 'test-access-secret-0123456789abcdef';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-0123456789abcdef';
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.RAZORPAY_KEY_ID = '';
process.env.RAZORPAY_KEY_SECRET = '';
process.env.RAZORPAY_WEBHOOK_SECRET = 'test-webhook-secret';
process.env.GROQ_API_KEY = '';
