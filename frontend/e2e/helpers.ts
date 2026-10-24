import { expect, request, type Page } from '@playwright/test';

export const API = process.env.E2E_API_URL ?? 'http://127.0.0.1:4801';
export const CUSTOMER = { email: 'customer@storefront.dev', password: 'Customer@123' };
export const ADMIN = { email: 'admin@storefront.dev', password: 'Admin@12345' };

export async function signIn(page: Page, who: { email: string; password: string }, next?: string) {
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : '/login');
  await page.getByTestId('login-email-input').fill(who.email);
  await page.getByTestId('login-password-input').fill(who.password);
  await page.getByTestId('login-submit-button').click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** A staff API session outside the browser, for driving the order lifecycle from the back office. */
export async function adminApi() {
  const ctx = await request.newContext({ baseURL: `${API}/api/v1/` });
  const res = await ctx.post('auth/login', { data: ADMIN });
  expect(res.ok()).toBeTruthy();
  const { csrfToken } = (await res.json()) as { csrfToken: string };
  return {
    transition: async (orderId: string, to: string) => {
      const r = await ctx.post('admin/orders/bulk-transition', { data: { ids: [orderId], to }, headers: { 'X-CSRF-Token': csrfToken } });
      expect(r.ok()).toBeTruthy();
      expect(((await r.json()) as { updated: number }).updated).toBe(1);
    },
    dispose: () => ctx.dispose(),
  };
}

export async function fillAddress(page: Page) {
  await page.getByTestId('checkout-name-input').fill('Demo Customer');
  await page.getByTestId('checkout-address-input').fill('12 MG Road, Indiranagar');
  await page.getByTestId('checkout-city-input').fill('Bengaluru');
  await page.getByTestId('checkout-state-input').fill('Karnataka');
  await page.getByTestId('checkout-pincode-input').fill('560038');
  await page.getByTestId('checkout-phone-input').fill('9876543210');
}
