import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { lessons } from '../../src/lessons.js';

test('loads the canvas, edits source, and roundtrips a downloaded board', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Boardroom home' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Verify & run' })).toBeEnabled();
  await expect(page.locator('.excalidraw canvas').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Source & input' }).click();
  const source = page.getByLabel(/CONFIRMED SOURCE/);
  await expect(source).toHaveValue(lessons[0].source);
  const edited = lessons[0].source.replace('a + b', 'a * b');
  await source.fill(edited);
  await expect(source).toHaveValue(edited);
  await page.getByLabel('STANDARD INPUT · BLUE INK').fill('4 6\n');
  await expect(page.getByLabel('STANDARD INPUT · BLUE INK')).toHaveValue('4 6\n');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const download = await downloadPromise;
  const path = testInfo.outputPath('roundtrip.excalidraw');
  await download.saveAs(path);
  const scene = JSON.parse(await readFile(path, 'utf8'));
  expect(scene.elements.some((el) => el.type === 'text' && el.text === edited)).toBe(true);
  expect(scene.elements.some((el) => el.type === 'frame')).toBe(true);
  await page.getByLabel('Demo lesson').selectOption('stack');
  await expect(source).toHaveValue(lessons[2].source);
  await page.locator('input[type=file]').setInputFiles(path);
  await expect(source).toHaveValue(edited);
  await expect(page.getByLabel('STANDARD INPUT · BLUE INK')).toHaveValue('4 6\n');
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('workspace.png'), fullPage: true });
});

test('fits a phone viewport without page-level horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Verify & run' })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('tab', { name: 'Source & input' }).click();
  await expect(page.getByLabel(/CONFIRMED SOURCE/)).toHaveValue(lessons[0].source);
});

test.describe('real Docker execution', () => {
  test.beforeEach(async ({ request }) => {
    const response = await request.get('/api/health');
    const { runner } = await response.json();
    expect(runner.available, runner.message).toBe(true);
  });

  for (const lesson of lessons) {
    test(`${lesson.title}: canvas to real program result`, async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('button', { name: 'Verify & run' })).toBeEnabled();
      await page.getByLabel('Demo lesson').selectOption(lesson.id);
      const responsePromise = page.waitForResponse((response) => response.url().endsWith('/api/run'));
      await page.getByRole('button', { name: 'Verify & run' }).click();
      const response = await responsePromise;
      expect(response.status()).toBe(200);
      const result = await response.json();
      expect(result.status).toBe(lesson.expectedStatus);
      if (lesson.expectedStdout !== undefined) await expect(page.locator('.terminal pre')).toHaveText(lesson.expectedStdout);
      else await expect(page.locator('.diagnostic').first()).toBeVisible();
      if (lesson.id === 'memory') {
        await expect(page.getByRole('figure', { name: 'Memory addresses printed by the program' })).toBeVisible();
        await expect(page.locator('.memory-location > code')).toHaveCount(2);
      }
      await expect(page.getByRole('alert')).toHaveCount(0);
    });
  }

  test('highlights a compiler error and marks edited results stale', async ({ page }, testInfo) => {
    await page.goto('/');
    await page.getByRole('tab', { name: 'Source & input' }).click();
    await page.getByLabel(/CONFIRMED SOURCE/).fill('int main(void) {\n    unknown_symbol;\n}\n');
    await page.getByRole('button', { name: 'Verify & run' }).click();
    await expect(page.locator('.result-status')).toContainText('Check the syntax');
    await expect(page.locator('.diagnostic').first()).toContainText('L2');
    await page.screenshot({ path: testInfo.outputPath('compiler-diagnostic.png'), fullPage: true });
    await page.getByRole('tab', { name: 'Source & input' }).click();
    await page.getByLabel(/CONFIRMED SOURCE/).fill('int main(void) { return 0; }');
    await page.getByRole('tab', { name: 'Output', exact: true }).click();
    await expect(page.locator('.stale-notice')).toBeVisible();
    await expect(page.locator('.diagnostic').first()).toBeDisabled();
  });
});
