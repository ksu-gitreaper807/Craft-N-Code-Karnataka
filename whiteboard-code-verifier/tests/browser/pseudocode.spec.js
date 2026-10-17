import { test, expect } from '@playwright/test';

test('reviews progressive pseudocode conversion before executing the accepted C', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Source & input' }).click();
  const source = page.getByLabel(/CONFIRMED SOURCE/);
  const original = 'let total = 3\nrepeat 2 times\nset total to total + 1\nend repeat\nprint total';
  await source.fill(original);
  await page.getByLabel('CORRECTION LEVEL').selectOption('1');
  await page.getByRole('button', { name: 'Prepare pseudocode' }).click();
  await expect(page.getByLabel('PROPOSED C')).toHaveValue(original);
  await expect(page.getByRole('button', { name: 'Verify & run' })).toHaveCount(0);
  await page.getByLabel('CORRECTION LEVEL').selectOption('2');
  await page.getByRole('button', { name: 'Prepare pseudocode' }).click();
  await expect(page.getByLabel('PROPOSED C')).toContainText('int main(void)');
  await expect(source).toHaveValue(original);
  await page.getByLabel('CORRECTION LEVEL').selectOption('3');
  await page.getByRole('button', { name: 'Prepare pseudocode' }).click();
  await expect(page.getByLabel('PROPOSED C')).toContainText('boardroom_repeat_1');
  await expect(page.locator('.pseudocode-issues')).toContainText('Assumed integer output');
  await page.getByRole('button', { name: 'Use prepared code' }).click();
  await expect(source).toContainText('printf("%d\\n", (int)(total));');
  const responsePromise = page.waitForResponse((response) => response.url().endsWith('/api/run'));
  await page.getByRole('button', { name: 'Verify & run' }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  expect((await response.json()).status).toBe('success');
  await expect(page.locator('.terminal pre')).toHaveText('5\n');
});

test('a changed board invalidates a pending pseudocode draft', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Source & input' }).click();
  const source = page.getByLabel(/CONFIRMED SOURCE/);
  await source.fill('int x = 2');
  await page.getByRole('button', { name: 'Prepare pseudocode' }).click();
  await expect(page.getByLabel('PROPOSED C')).toHaveValue('int x = 2;');
  await source.fill('int x = 4');
  await expect(page.getByLabel('PROPOSED C')).toHaveCount(0);
  await expect(source).toHaveValue('int x = 4');
});
