import { randomInt } from 'node:crypto';

export const generateOrderNumber = (now = Date.now()) => `SF-${now.toString(36).toUpperCase()}${randomInt(100, 1000)}`;
