import {
  CHECKOUT_HOLD_MINUTES,
  FREE_SHIPPING_THRESHOLD,
  POLICY_SLUGS,
  REFUND_WINDOW_DAYS,
  SHIPPING_FEE,
  formatINR,
  getPolicy,
} from '@storefront/contracts';
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../core/config/env';
import { STORE_INFO } from './store-info';
import { GetStoreInfoTool } from './tools/store.tools';

describe('store info for the assistant', () => {
  it('keeps the fields agent tools and prompts rely on, all as non-empty text', () => {
    for (const key of [
      'name',
      'tagline',
      'currency',
      'shipping',
      'payments',
      'returns',
      'cancellations',
      'offers',
      'sizes',
      'support',
    ] as const) {
      expect(typeof STORE_INFO[key]).toBe('string');
      expect(STORE_INFO[key].length).toBeGreaterThan(0);
    }
  });

  it('is derived from the store policies the website shows', () => {
    expect(STORE_INFO.shipping).toBe(getPolicy('shipping')!.keyPoints.join(' '));
    expect(STORE_INFO.returns).toBe(getPolicy('returns')!.keyPoints.join(' '));
    expect(STORE_INFO.policyPages.map(p => p.path).sort()).toEqual(POLICY_SLUGS.map(s => `/policies/${s}`).sort());
  });

  it('quotes amounts exactly as formatINR prints them, so price graders can match them', () => {
    expect(STORE_INFO.shipping).toContain(formatINR(FREE_SHIPPING_THRESHOLD));
    expect(STORE_INFO.shipping).toContain(formatINR(SHIPPING_FEE));
    expect(STORE_INFO.returns).toContain(`${REFUND_WINDOW_DAYS} days`);
    expect(STORE_INFO.cancellations).toMatch(/before it ships/);
  });

  it('states the checkout hold the API actually uses by default', () => {
    const env = loadEnv({ MONGO_URL: 'mongodb://unused', JWT_SECRET: 'test-secret-0123456789' });
    expect(env.RESERVATION_TTL_MINUTES).toBe(CHECKOUT_HOLD_MINUTES);
    expect(STORE_INFO.payments).toContain(`${CHECKOUT_HOLD_MINUTES} minutes`);
  });

  it('is what get_store_info returns', async () => {
    expect(await new GetStoreInfoTool().execute()).toEqual(STORE_INFO);
  });
});
