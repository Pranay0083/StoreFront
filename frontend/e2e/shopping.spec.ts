import { expect, test } from '@playwright/test';
import { CUSTOMER, adminApi, fillAddress, signIn } from './helpers';

test('bundle offer → optimizer discount in the bag → demo pay → live order updates', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('home-page').getByTestId('featured-grid')).toBeVisible();

  await page.goto('/products?category=Men');
  await page.getByTestId('products-page').getByTestId('product-card-oxford-cotton-shirt').click();
  await expect(page.getByTestId('product-title')).toHaveText('Oxford Cotton Shirt');

  const bundle = page.locator('[data-testid^="bundle-offer-"]', { hasText: 'Weekend Uniform' });
  await expect(bundle).toBeVisible();
  await expect(bundle.getByTestId('bundle-savings')).toContainText('Save');
  await bundle.getByRole('button', { name: 'Add the set to bag' }).click();
  await expect(page.getByTestId('nav-cart-count')).toHaveText('2');

  await page.goto('/cart');
  const summary = page.getByTestId('price-summary');
  await expect(summary).toContainText('Bundle offers');
  await expect(page.getByTestId('summary-savings')).toContainText('You save');
  await expect(page.getByTestId('cart-line-price-oxford-cotton-shirt')).toContainText('Weekend Uniform');

  await signIn(page, CUSTOMER, '/checkout');
  await expect(page).toHaveURL(/\/checkout/);
  await fillAddress(page);
  await expect(page.getByTestId('price-summary')).toContainText('Bundle offers');
  const pay = page.getByTestId('checkout-pay-button');
  await expect(pay).toBeEnabled();
  await pay.click();

  await expect(page).toHaveURL(/\/orders\/[a-f\d]{24}/);
  const orderId = page.url().match(/orders\/([a-f\d]{24})/)![1];
  await expect(page.getByTestId('order-detail-status')).toHaveText(/paid/i);
  await expect(page.getByTestId('order-detail-offers')).toContainText('Weekend Uniform');
  await expect(page.getByTestId('order-live-indicator')).toBeVisible();

  const admin = await adminApi();
  try {
    // Packing has no customer-facing event; shipping is pushed to the open page over SSE, no reload.
    await admin.transition(orderId, 'packed');
    await admin.transition(orderId, 'shipped');
    await expect(page.getByTestId('order-detail-status')).toHaveText(/shipped/i);
  } finally {
    await admin.dispose();
  }
});

test('an unknown promo code is rejected and blocks payment', async ({ page }) => {
  await signIn(page, CUSTOMER);
  await page.goto('/products/full-grain-leather-belt');
  const firstSize = page.locator('[data-testid^="product-size-"]:not([disabled])').first();
  if (await firstSize.isVisible()) await firstSize.click();
  await page.getByTestId('product-add-to-cart').click();

  await page.goto('/checkout');
  await fillAddress(page);
  await page.getByTestId('promo-code-input').fill('NOTAREALCODE');
  await page.getByTestId('promo-code-apply-button').click();
  await expect(page.getByTestId('promo-code-NOTAREALCODE')).toContainText('—');

  await page.getByTestId('checkout-pay-button').click();
  await expect(page.getByText('Remove the promo codes that cannot be applied first')).toBeVisible();
  await expect(page).toHaveURL(/\/checkout/);
});
