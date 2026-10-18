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

test('an unconfigured Vercel Function shows the missing setting', async ({ page }) => {
  await page.route('**/api/health', (route) => route.fulfill({ status: 503,
    json: { error: 'Set BOARDROOM_API_TOKEN in the Vercel project settings and redeploy.' } }));
  await page.goto('/');
  await page.getByLabel('Demo lesson').selectOption('sum');
  await expect(page.locator('.inspector > .runner-notice span')).toContainText('Set BOARDROOM_API_TOKEN');
});

test('a hosted API access token is entered at runtime and sent on reconnect', async ({ page }) => {
  await page.route('**/api/health', (route) => {
    if (route.request().headers().authorization !== 'Bearer private-test-token') {
      return route.fulfill({ status: 401, json: { error: 'A valid Boardroom API token is required.' } });
    }
    return route.fulfill({ json: { runner: { available: true }, ocr: { available: false, message: 'No Gemini key.' } } });
  });
  await page.goto('/');
  await page.getByLabel('Demo lesson').selectOption('sum');
  await expect(page.getByLabel('API ACCESS TOKEN')).toBeVisible();
  await page.getByLabel('API ACCESS TOKEN').fill('private-test-token');
  await page.getByRole('button', { name: 'Connect API' }).click();
  await expect(page.getByText('Runner ready')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Verify & run' })).toBeEnabled();
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
