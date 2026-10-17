import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { lessons } from '../../src/lessons.js';
import { libraries } from '../../src/libraries.js';

test('fills the viewport, resizes the dock with mouse and keyboard, and focuses the board', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Verify & run' })).toBeEnabled();
  const canvas = page.locator('.canvas-container');
  const before = await canvas.boundingBox();
  expect(before.x).toBeGreaterThan(60);
  expect(before.x).toBeLessThan(100);
  expect(before.width).toBeGreaterThan(1300);
  expect(before.height).toBeGreaterThan(380);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  const divider = page.getByRole('separator', { name: 'Resize code and results panel' });
  const handle = await divider.boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, handle.y - 120, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await canvas.boundingBox()).height).toBeLessThan(before.height - 90);
  await divider.focus();
  await page.keyboard.press('Home');
  await expect(divider).toHaveAttribute('aria-valuenow', '160');
  await page.getByRole('button', { name: 'Hide panel', exact: true }).click();
  await expect(page.getByRole('complementary')).toBeHidden();
  await expect.poll(async () => (await canvas.boundingBox()).height).toBeGreaterThan(before.height + 100);
  await page.screenshot({ path: testInfo.outputPath('focused-board.png') });
  await page.getByRole('button', { name: 'Show panel', exact: true }).click();
  await expect(page.getByLabel(/CODE THAT RUNS/)).toHaveValue(lessons[0].source);
  expect(errors).toEqual([]);
});

test('initial code bounds contain every rendered glyph after the local font loads', async ({ page }, testInfo) => {
  await page.goto('/');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const download = await downloadPromise;
  const path = testInfo.outputPath('initial-text-metrics.excalidraw');
  await download.saveAs(path);
  const scene = JSON.parse(await readFile(path, 'utf8'));
  const code = scene.elements.find((element) => element.id === 'lesson-code');
  const measured = await page.evaluate(({ text, fontSize }) => {
    const context = document.createElement('canvas').getContext('2d');
    context.font = `${fontSize}px Cascadia`;
    return Math.max(...text.split('\n').map((line) => context.measureText(line).width));
  }, code);
  expect(code.width).toBeGreaterThanOrEqual(measured - 1);
});

test('resizes writing frames and keeps a long program input contained', async ({ page }, testInfo) => {
  await page.goto('/');
  // Resizing needs the canvas API, which is ready once Verify & run is enabled.
  await expect(page.getByRole('button', { name: 'Verify & run' })).toBeEnabled();
  await page.getByLabel('Frame width', { exact: true }).fill('1200');
  await page.getByLabel('Frame height', { exact: true }).fill('900');
  await page.getByRole('button', { name: 'Apply size', exact: true }).click();
  await expect(page.getByLabel('Frame width', { exact: true })).toHaveValue('1200');
  await page.getByRole('button', { name: '+ More room', exact: true }).click();
  await expect(page.getByLabel('Frame height', { exact: true })).toHaveValue('1350');
  const stdin = `3 5\n${Array.from({ length: 149 }, (_, i) => `// input line ${i + 2}`).join('\n')}`;
  await page.getByLabel('STANDARD INPUT · BLUE INK').fill(stdin);
  await expect(page.getByLabel('STANDARD INPUT · BLUE INK')).toHaveValue(stdin);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const download = await downloadPromise;
  const path = testInfo.outputPath('large-frame.excalidraw');
  await download.saveAs(path);
  const scene = JSON.parse(await readFile(path, 'utf8'));
  const frame = scene.elements.find((element) => element.type === 'frame');
  const code = scene.elements.find((element) => element.id === 'lesson-code');
  const input = scene.elements.find((element) => element.strokeColor === '#1971c2');
  expect(frame.height).toBeGreaterThan(3000);
  expect(code.frameId).toBe(frame.id);
  expect(input.frameId).toBe(frame.id);
  expect(input.y).toBeGreaterThan(code.y + code.height);
  expect(input.y + input.height).toBeLessThan(frame.y + frame.height);
  await page.getByLabel('Frame height', { exact: true }).fill('240');
  await page.getByRole('button', { name: 'Apply size', exact: true }).click();
  expect(Number(await page.getByLabel('Frame height', { exact: true }).inputValue())).toBeGreaterThan(3000);
  await page.getByRole('button', { name: 'Fit frame', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('resizable-workspace.png') });
  await page.getByRole('button', { name: 'Verify & run' }).click();
  await expect(page.locator('.result-status')).toContainText('Program completed');
});

test('enters and exits browser fullscreen without losing the board', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
  await expect(page.getByLabel(/CODE THAT RUNS/)).toHaveValue(lessons[0].source);
});

test('browses curated headers and loads their examples onto the board', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Libraries', exact: true }).click();
  for (const library of libraries) {
    await page.getByLabel('CURATED C LIBRARIES').selectOption(library.file);
    await expect(page.locator('.library-source')).toContainText('#ifndef');
    await expect(page.locator('.library-panel h3')).toHaveText(library.title);
    const expected = await readFile(new URL(`../../runner/lib/${library.file}`, import.meta.url), 'utf8');
    await expect(page.locator('.library-source')).toHaveText(expected);
  }
  await page.getByRole('button', { name: 'Load example on board', exact: true }).click();
  await expect(page.getByLabel(/CODE THAT RUNS/)).toHaveValue(lessons.find((lesson) => lesson.id === 'search').source);
});
