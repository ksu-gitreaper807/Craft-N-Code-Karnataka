import { openPanel } from './helpers.js';
import { test, expect } from '@playwright/test';

test('runs multiple inputs and accepts an expected runtime issue', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Demo lesson').selectOption('sum');
  await openPanel(page);
  await page.getByLabel(/CODE THAT RUNS/).fill('#include <stdio.h>\nint main(void) { int x; if (scanf("%d", &x) != 1) return 1; printf("%d\\n", x * 2); return 0; }');
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
  await expect(page.locator('.case-results li')).toHaveCount(2, { timeout: 30_000 });
  await expect(page.locator('.case-results li.passed')).toHaveCount(2);
  await expect(page.locator('.case-results')).toContainText('Five doubles');
  await expect(page.locator('.case-results')).toContainText('Invalid input');
  await openPanel(page);
  await page.getByLabel(/CODE THAT RUNS/).fill('int main(void) { return 0; }');
  await page.getByRole('tab', { name: 'Cases' }).click();
  await expect(page.getByText('The board changed. Run these cases again')).toBeVisible();
});

test('persists and round-trips suites, rejects invalid imports without losing cases', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Demo lesson').selectOption('sum');
  await openPanel(page);
  await page.getByRole('tab', { name: 'Cases', exact: true }).click();
  await page.locator('#case-name-1').fill('Saved edge case');
  await page.locator('#case-input-1').fill('-1\n');
  await page.reload();
  await openPanel(page);
  await page.getByRole('tab', { name: 'Cases', exact: true }).click();
  await expect(page.locator('#case-name-1')).toHaveValue('Saved edge case');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export suite' }).click();
  const download = await downloaded;
  const stream = await download.createReadStream();
  const chunks = []; for await (const chunk of stream) chunks.push(chunk);
  const suite = Buffer.concat(chunks);
  expect(JSON.parse(suite).cases[0].stdin).toBe('-1\n');
  await page.getByLabel('Import test suite file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"version":1,"language":"python","cases":[]}') });
  await expect(page.getByRole('alert')).toContainText('Could not import suite');
  await expect(page.locator('#case-name-1')).toHaveValue('Saved edge case');
  await page.locator('#case-name-1').fill('Changed');
  await page.getByLabel('Import test suite file').setInputFiles({ name: 'suite.json', mimeType: 'application/json', buffer: suite });
  await expect(page.locator('#case-name-1')).toHaveValue('Saved edge case');
});

test('shows exact newline differences and supports explicit relaxed comparisons', async ({ page }) => {
  await page.route('**/api/run', route => route.fulfill({ json: {
    status: 'success', stdout: '10\n', stderr: '', compilerOutput: '', diagnostics: [], durationMs: 2,
  } }));
  await page.goto('/');
  await page.getByLabel('Demo lesson').selectOption('sum');
  await openPanel(page);
  await page.getByRole('tab', { name: 'Cases', exact: true }).click();
  await page.locator('.case-check input').first().check();
  await page.locator('#case-output-1').fill('10');
  await page.getByRole('button', { name: 'Run 1 case', exact: true }).click();
  await expect(page.locator('.case-results')).toContainText('expected EOF');
  await expect(page.getByLabel('Actual stdout')).toHaveText('"10\\n"');
  await page.locator('#case-comparison-1').selectOption('trim');
  await page.getByRole('button', { name: 'Run 1 case', exact: true }).click();
  await expect(page.locator('.case-results li.passed')).toHaveCount(1);
});

test('stops a case run without submitting remaining cases', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/run', async route => {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 500));
    await route.fulfill({ json: { status: 'success', stdout: '', stderr: '', compilerOutput: '', diagnostics: [] } }).catch(() => {});
  });
  await page.goto('/');
  await page.getByLabel('Demo lesson').selectOption('sum');
  await openPanel(page);
  await page.getByRole('tab', { name: 'Cases', exact: true }).click();
  await page.getByRole('button', { name: 'Add case' }).click();
  const started = page.waitForRequest('**/api/run');
  await page.getByRole('button', { name: 'Run 2 cases', exact: true }).click();
  await started;
  await page.getByRole('button', { name: 'Stop cases' }).click();
  await expect(page.getByRole('alert')).toContainText('stopped');
  await expect(page.getByRole('button', { name: 'Run 2 cases', exact: true })).toBeEnabled();
  expect(calls).toBe(1);
});

test('C++ STL examples load from Libraries and execute through g++', async ({ page }) => {
  await page.goto('/');
  await openPanel(page);
  await page.getByRole('tab', { name: 'Libraries', exact: true }).click();
  await page.getByLabel('C++ LIBRARIES').selectOption('algorithm');
  await expect(page.locator('.library-source')).toContainText('std::lower_bound');
  await expect(page.locator('.library-panel')).toContainText('return iterators');
  await page.getByRole('button', { name: 'Load example on board', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'C++', exact: true })).toBeChecked();
  await expect(page.getByLabel(/CODE THAT RUNS/)).toHaveValue(/std::lower_bound/);
  await page.getByRole('button', { name: 'Verify & run', exact: true }).click();
  await expect(page.locator('.result-status')).toContainText('Program completed');
  await expect(page.locator('.terminal pre')).toHaveText('Found: 1\nRange: 2 5\n');
});

test('keeps C++ and Python suite definitions separate when toggling languages', async ({ page }) => {
  await page.goto('/');
  await openPanel(page);
  await page.getByRole('tab', { name: 'Cases', exact: true }).click();
  await page.locator('#case-name-1').fill('C++ boundary');
  await page.getByRole('radio', { name: 'Python', exact: true }).check();
  await page.getByRole('tab', { name: 'Cases', exact: true }).click();
  await expect(page.locator('#case-name-1')).toHaveValue('Case 1');
  await page.locator('#case-name-1').fill('Python boundary');
  await page.getByRole('radio', { name: 'C++', exact: true }).check();
  await page.getByRole('tab', { name: 'Cases', exact: true }).click();
  await expect(page.locator('#case-name-1')).toHaveValue('C++ boundary');
});
