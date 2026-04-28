import { test, expect } from '@playwright/test';

test('admin can login', async ({ page }) => {
  await page.goto('/login');

  await page.getByRole('textbox', { name: 'E-mail' }).fill(process.env.E2E_ADMIN_EMAIL ?? '');
  await page.getByRole('textbox', { name: 'Password' }).fill(process.env.E2E_ADMIN_PASSWORD ?? '');

  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.locator('body')).toBeVisible();
});