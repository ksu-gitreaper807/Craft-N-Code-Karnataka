import { createServer } from 'node:http';
import { test, expect } from '@playwright/test';
import { createHandler } from '../../server/index.mjs';

test('public Boardroom works without cookies, login, or browser-stored tokens', async ({ browser }) => {
  let runs = 0;
  const server = createServer(createHandler({ apiToken: 'obsolete-config',
    health: async () => ({ available: true }), ocrHealth: () => ({ available: false }),
    run: async () => { runs++; return { status: 'success', stdout: '8\n', stderr: '', compilerOutput: '', diagnostics: [], notes: [], durationMs: 1, exitCode: 0 }; },
    snapshots: { save: async () => ({ id: 'fixture', commit: '12345678', title: 'Fixture' }) },
  }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await context.addCookies([{ name: 'boardroom-session', value: 'obsolete-cookie', url: origin, httpOnly: true }]);
    await page.addInitScript(() => sessionStorage.setItem('boardroom-api-token', 'obsolete-token'));
    const requests = [];
    page.on('request', request => { if (request.url().includes('/api/')) requests.push(request); });
    expect((await context.request.get(origin + '/api/health')).status()).toBe(200);
    await page.goto(origin);
    await expect(page.getByText('Runner ready')).toBeVisible();
    await page.getByLabel('Demo lesson').selectOption('sum');
    await page.getByRole('button', { name: 'Verify & run', exact: true }).click();
    await expect(page.locator('.terminal pre')).toHaveText('8\n');
    expect(runs).toBe(1);
    await expect(page.getByLabel('API ACCESS TOKEN')).toHaveCount(0);
    expect(await page.evaluate(() => sessionStorage.getItem('boardroom-api-token'))).toBeNull();
    for (const request of requests) {
      const headers = await request.allHeaders();
      expect(headers.authorization).toBeUndefined(); expect(headers.cookie).toBeUndefined();
    }
    await page.reload();
    await expect(page.getByText('Runner ready')).toBeVisible();
  } finally { await context.close(); await new Promise(resolve => server.close(resolve)); }
});
