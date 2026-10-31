import { expect, test, type Page } from '@playwright/test';
import { ADMIN, signIn } from './helpers';

/** Reloads until the page shows the offer: the API revalidates the `offers` tag a few seconds after the change. */
async function reloadUntilVisible(page: Page, path: string, locate: (page: Page) => ReturnType<Page['locator']>) {
  await page.goto(path);
  await expect(async () => {
    await page.reload();
    await expect(locate(page)).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000, intervals: [1_000, 2_000, 3_000] });
}

test('a set created in the back office is advertised on /offers and the home page, at the saving the bag gives', async ({
  page,
  browser,
}) => {
  const name = `Knit and canvas ${Date.now().toString(36)}`;

  await signIn(page, ADMIN);
  await page.goto('/admin/promotions');
  await page.getByTestId('promotion-new').click();
  const editor = page.getByTestId('promotion-editor');
  await editor.getByTestId('promotion-name').fill(name);
  await editor.getByLabel('Status').selectOption('active');
  await editor.getByLabel('Action type').selectOption('fixedBundle');

  const slugs = editor.getByLabel('Product slugs');
  await slugs.first().fill('merino-crewneck-sweater');
  await slugs.first().blur();
  await editor.getByRole('button', { name: 'Component' }).click();
  await slugs.nth(1).fill('canvas-high-tops');
  await slugs.nth(1).blur();
  const categories = editor.getByLabel('Categories (comma-separated)');
  await categories.nth(1).fill('');
  await categories.nth(1).blur();
  await editor.getByLabel('Bundle price (₹)').fill('999');
  await expect(editor.getByTestId('promotion-show-on-storefront')).toBeChecked();
  await editor.getByTestId('promotion-save').click();
  await expect(page.getByText(`Created ${name}`)).toBeVisible();

  // A shopper in a fresh session: no redeploy, only the API's revalidation of the `offers` tag.
  const shopper = await (await browser.newContext()).newPage();
  const onOffers = (p: Page) => p.locator('article[data-testid^="offer-"]', { hasText: name });
  await reloadUntilVisible(shopper, '/offers', onOffers);
  const offer = onOffers(shopper);
  const saving = (await offer.getByTestId(/^offer-saving-/).innerText()).trim();
  const total = (await offer.getByTestId(/^offer-total-/).innerText()).trim();
  expect(saving).toMatch(/^₹[\d,]+$/);

  await reloadUntilVisible(shopper, '/', p => p.getByTestId('home-offers').getByText(name).first());
  await expect(shopper.getByTestId('home-offers')).toContainText(saving);

  await shopper.goto('/offers');
  await onOffers(shopper).getByRole('button', { name: 'Add the set to bag' }).click();
  await expect(shopper.getByTestId('nav-cart-count')).toHaveText('2');
  await shopper.goto('/cart');
  await expect(shopper.getByTestId('cart-line-price-merino-crewneck-sweater')).toContainText(name);
  await expect(shopper.getByTestId('summary-savings')).toContainText(saving);
  await expect(shopper.getByTestId('summary-total')).toContainText(total);
});
