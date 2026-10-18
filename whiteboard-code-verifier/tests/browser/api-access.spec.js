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

test('cookie sign-in survives reload without storing or sending the API token', async ({ page, context }) => {
  let loggedIn = false;
  const seen = [];
  await page.addInitScript(() => sessionStorage.setItem('boardroom-api-token', 'obsolete-token'));
  await page.route('**/api/session', async route => {
    const request = route.request();
    if (request.method() === 'DELETE') {
      loggedIn = false;
      return route.fulfill({ headers: { 'Set-Cookie': 'boardroom-session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' }, json: { authenticated: false } });
    }
    expect(request.postDataJSON()).toEqual({ token: 'private-test-token' });
    expect(request.headers().authorization).toBeUndefined();
    loggedIn = true;
    return route.fulfill({ headers: { 'Set-Cookie': 'boardroom-session=test-signed-cookie; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800' }, json: { authenticated: true } });
  });
  await page.route('**/api/health', async route => {
    const headers = await route.request().allHeaders(); seen.push(headers);
    if (!loggedIn || !headers.cookie?.includes('boardroom-session=')) return route.fulfill({ status: 401, json: { error: 'Sign in.' } });
    return route.fulfill({ json: { session: { authenticated: true }, runner: { available: true }, ocr: { available: false } } });
  });
  await page.goto('/');
  await expect(page.getByLabel('API ACCESS TOKEN')).toBeVisible();
  await page.getByLabel('API ACCESS TOKEN').fill('private-test-token');
  await page.getByRole('button', { name: 'Connect API' }).click();
  await expect(page.getByText('Runner ready')).toBeVisible();
  const cookies = await context.cookies();
  expect(cookies.find(item => item.name === 'boardroom-session')).toMatchObject({ httpOnly: true, sameSite: 'Strict' });
  expect(await page.evaluate(() => document.cookie)).not.toContain('boardroom-session');
  expect(await page.evaluate(() => sessionStorage.getItem('boardroom-api-token'))).toBeNull();
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('private-test-token');
  await page.reload();
  await expect(page.getByText('Runner ready')).toBeVisible();
  await openPanel(page);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByLabel('API ACCESS TOKEN')).toBeVisible();
  expect(seen.every(headers => !headers.authorization)).toBe(true);
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
