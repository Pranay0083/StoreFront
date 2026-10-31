import { expect, test } from '@playwright/test';
import { ADMIN, API, CUSTOMER, signIn } from './helpers';

test('login and logout, with cookie-authenticated writes requiring the CSRF token', async ({ page }) => {
  await signIn(page, CUSTOMER);
  await page.getByTestId('nav-account-button').click();
  await expect(page.getByTestId('nav-account-name')).toContainText('Demo Customer');

  const withoutToken = await page.evaluate(async api => {
    const res = await fetch(`${api}/api/v1/cart`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [] }),
    });
    return { status: res.status, body: await res.json() };
  }, API);
  expect(withoutToken.status).toBe(403);
  expect(withoutToken.body.code).toBe('CSRF_INVALID');

  await page.getByTestId('nav-logout-button').click();
  // The menu animates out and Radix blocks pointer events until it has gone; a person would wait too.
  await expect(page.getByRole('menu')).toBeHidden();
  await page.getByTestId('nav-account-button').click();
  await expect(page.getByTestId('nav-login-link')).toBeVisible();
  const me = await page.evaluate(async api => (await fetch(`${api}/api/v1/auth/me`, { credentials: 'include' })).status, API);
  expect(me).toBe(401);
});

test('admin simulates a cart and sees which promotions win', async ({ page }) => {
  await signIn(page, ADMIN);
  await expect(page).toHaveURL(/\/admin/);
  await page.goto('/admin/promotions/simulator');
  const simulator = page.getByTestId('promotion-simulator');

  for (const [query, title] of [
    ['Oxford', 'Oxford Cotton Shirt'],
    ['Selvedge', 'Selvedge Denim Jeans'],
  ]) {
    await simulator.getByPlaceholder('Search products to add').fill(query);
    await simulator.getByRole('button', { name: 'Search' }).click();
    await simulator.getByRole('button', { name: `Add ${title}` }).click();
  }
  await page.getByTestId('simulate-run').click();
  await expect(page.getByTestId('simulator-applied')).toContainText('Weekend Uniform');
});

test.skip('agent widget streams a reply and asks before adding to the bag', () => {
  // The API has no scripted LLM provider wired to env yet (the eval suite injects one in-process),
  // so a browser test would need a real Groq/Anthropic key.
});
