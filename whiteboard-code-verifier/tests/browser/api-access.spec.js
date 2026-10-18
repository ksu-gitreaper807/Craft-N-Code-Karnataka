import { openPanel } from './helpers.js';
import { test, expect } from '@playwright/test';

test('a static frontend explains the missing API and keeps board editing available', async ({ page }) => {
  await page.route('**/api/health', (route) => route.fulfill({ status: 404, body: '<html>Not found</html>', contentType: 'text/html' }));
  await page.goto('/');
  await page.getByLabel('Demo lesson').selectOption('sum');
  await expect(page.locator('.inspector > .runner-notice span')).toContainText('Boardroom API endpoint is missing.');
  await expect(page.getByRole('button', { name: 'Verify & run' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save lesson snapshot' })).toBeDisabled();
  await openPanel(page);
  await page.getByLabel(/CODE THAT RUNS/).fill('int main(void) { return 0; }');
  await expect(page.getByLabel(/CODE THAT RUNS/)).toHaveValue('int main(void) { return 0; }');
  await page.getByRole('tab', { name: 'Handwriting' }).click();
  await expect(page.getByRole('button', { name: 'Read handwriting' })).toBeDisabled();
});

test('public API health enables running without login controls or credentials', async ({ page }) => {
  const seen = [];
  await page.route('**/api/health', async route => {
    seen.push(await route.request().allHeaders());
    return route.fulfill({ json: { access: 'public', runner: { available: true }, ocr: { available: false } } });
  });
  await page.goto('/');
  await page.getByLabel('Demo lesson').selectOption('sum');
  await expect(page.getByText('Runner ready')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Verify & run' })).toBeEnabled();
  await openPanel(page);
  await expect(page.getByLabel('API ACCESS TOKEN')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Connect API' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toHaveCount(0);
  expect(seen.every(headers => !headers.authorization && !headers.cookie)).toBe(true);
});

test('a serverless API keeps C and handwriting available while explaining history storage', async ({ page }) => {
  await page.route('**/api/health', (route) => route.fulfill({ json: {
    runner: { available: true, engine: 'wandbox' }, ocr: { available: true, provider: 'gemini' },
    snapshots: { available: false },
  } }));
  await page.goto('/');
  await page.getByLabel('Demo lesson').selectOption('sum');
  await expect(page.getByText('Runner ready')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save lesson snapshot' })).toBeDisabled();
  await openPanel(page);
  await page.getByRole('tab', { name: 'History' }).click();
  await expect(page.getByText('Lesson history is unavailable.', { exact: false })).toBeVisible();
  await page.getByRole('tab', { name: 'Libraries' }).click();
  await expect(page.locator('pre').filter({ hasText: 'stack_init' }).first()).toBeVisible();
});
