import { test, expect } from '@playwright/test';

test('runs multiple inputs and accepts an expected runtime issue', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Source & input' }).click();
  await page.getByLabel(/CONFIRMED SOURCE/).fill('#include <stdio.h>\nint main(void) { int x; if (scanf("%d", &x) != 1) return 1; printf("%d\\n", x * 2); return 0; }');
  await page.getByRole('tab', { name: 'Cases' }).click();
  await page.locator('#case-name-1').fill('Five doubles');
  await page.locator('#case-input-1').fill('5\n');
  await page.locator('.case-check input').first().check();
  await page.locator('#case-output-1').fill('10\n');
  await page.getByRole('button', { name: 'Add case' }).click();
  await page.locator('#case-name-2').fill('Invalid input');
  await page.locator('#case-input-2').fill('oops\n');
  await page.locator('#case-status-2').selectOption('runtime_error');
  await page.getByRole('button', { name: 'Run 2 cases' }).click();
  await expect(page.locator('.case-results li')).toHaveCount(2);
  await expect(page.locator('.case-results li.passed')).toHaveCount(2);
  await expect(page.locator('.case-results')).toContainText('Five doubles');
  await expect(page.locator('.case-results')).toContainText('Invalid input');
  await page.getByRole('tab', { name: 'Source & input' }).click();
  await page.getByLabel(/CONFIRMED SOURCE/).fill('int main(void) { return 0; }');
  await page.getByRole('tab', { name: 'Cases' }).click();
  await expect(page.getByText('The board changed. Run these cases again')).toBeVisible();
});
