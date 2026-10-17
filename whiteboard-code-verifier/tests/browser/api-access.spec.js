import { test, expect } from '@playwright/test';

test('a static frontend explains the missing API and keeps board editing available', async ({ page }) => {
  await page.route('**/api/health', (route) => route.fulfill({ status: 404, body: '<html>Not found</html>', contentType: 'text/html' }));
  await page.goto('/');
  await expect(page.locator('.inspector > .runner-notice span')).toContainText('Boardroom API is offline.');
  await expect(page.getByRole('button', { name: 'Verify & run' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save lesson snapshot' })).toBeDisabled();
  await page.getByRole('tab', { name: 'Source & input' }).click();
  await page.getByLabel(/CONFIRMED SOURCE/).fill('int main(void) { return 0; }');
  await expect(page.getByLabel(/CONFIRMED SOURCE/)).toHaveValue('int main(void) { return 0; }');
  await page.getByRole('tab', { name: 'Handwriting' }).click();
  await expect(page.getByRole('button', { name: 'Read handwriting' })).toBeDisabled();
});

test('a hosted API access token is entered at runtime and sent on reconnect', async ({ page }) => {
  await page.route('**/api/health', (route) => {
    if (route.request().headers().authorization !== 'Bearer private-test-token') {
      return route.fulfill({ status: 401, json: { error: 'A valid Boardroom API token is required.' } });
    }
    return route.fulfill({ json: { runner: { available: true }, ocr: { available: false, message: 'No Gemini key.' } } });
  });
  await page.goto('/');
  await expect(page.getByLabel('API ACCESS TOKEN')).toBeVisible();
  await page.getByLabel('API ACCESS TOKEN').fill('private-test-token');
  await page.getByRole('button', { name: 'Connect API' }).click();
  await expect(page.getByText('Runner ready')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Verify & run' })).toBeEnabled();
});
