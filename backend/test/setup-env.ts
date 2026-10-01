import { randomUUID } from 'node:crypto';
import { inject } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.MONGO_URL = inject('mongoUri');
process.env.DB_NAME = `test_${randomUUID().slice(0, 8)}`;
process.env.JWT_SECRET = 'test-secret-value';
process.env.RAZORPAY_KEY_ID = '';
process.env.RAZORPAY_KEY_SECRET = '';
process.env.RAZORPAY_WEBHOOK_SECRET = 'test-webhook-secret';
process.env.GROQ_API_KEY = '';
