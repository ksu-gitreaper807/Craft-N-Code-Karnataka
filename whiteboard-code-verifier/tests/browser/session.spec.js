import { createServer } from 'node:http';
import { test, expect } from '@playwright/test';
import { createHandler } from '../../server/index.mjs';

test('real cookie authentication protects the API, survives reload, and signs out', async ({ browser }) => {
  const token = 'private-cookie-integration-fixture';
  const server = createServer(createHandler({ apiToken: token,
    health: async () => ({ available: true }), ocrHealth: () => ({ available: false }),
  }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    expect((await context.request.get(origin + '/api/health')).status()).toBe(401);
    await page.goto(origin);
    await page.getByLabel('API ACCESS TOKEN').fill(token);
    await page.getByRole('button', { name: 'Connect API' }).click();
    await expect(page.getByText('Runner ready')).toBeVisible();
    expect((await context.request.get(origin + '/api/health')).status()).toBe(200);
    const cookies = await context.cookies();
    expect(cookies.find(cookie => cookie.name === 'boardroom-session')).toMatchObject({ httpOnly: true, sameSite: 'Strict' });
    expect(await page.evaluate(() => document.cookie)).not.toContain('boardroom-session');
    expect(await page.evaluate(() => JSON.stringify(sessionStorage))).not.toContain(token);
    await page.reload();
    await expect(page.getByText('Runner ready')).toBeVisible();
    await page.getByLabel('Demo lesson').selectOption('sum');
    await context.clearCookies();
    await page.getByRole('button', { name: 'Verify & run', exact: true }).click();
    await expect(page.getByLabel('API ACCESS TOKEN')).toBeVisible();
    await page.getByLabel('API ACCESS TOKEN').fill(token);
    await page.getByRole('button', { name: 'Connect API' }).click();
    await expect(page.getByText('Runner ready')).toBeVisible();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByLabel('API ACCESS TOKEN')).toBeVisible();
    expect((await context.request.get(origin + '/api/health')).status()).toBe(401);
    expect((await context.cookies()).some(cookie => cookie.name === 'boardroom-session')).toBe(false);
  } finally { await context.close(); await new Promise(resolve => server.close(resolve)); }
});
