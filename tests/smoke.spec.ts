import { expect, test } from '@playwright/test';

test('home renders hero and featured products', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('hero-shop-button')).toBeVisible();
  await expect(page.getByTestId('featured-grid')).toBeVisible({ timeout: 20_000 });
});

test('catalog filters by category', async ({ page }) => {
  await page.goto('/products?category=Men');
  await expect(page.getByTestId('products-grid')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('products-count')).toBeVisible();
});

test('customer can log in and reach orders', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('login-fill-customer').click();
  await page.getByTestId('login-submit-button').click();
  await page.waitForURL('**/');
  await page.goto('/orders');
  await expect(page.getByTestId('orders-page')).toBeVisible({ timeout: 20_000 });
});

test('admin dashboard is role-gated and renders aggregations', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('login-fill-admin').click();
  await page.getByTestId('login-submit-button').click();
  await page.waitForURL('**/admin');
  await expect(page.getByTestId('revenue-chart')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('funnel-widget')).toBeVisible();
});
