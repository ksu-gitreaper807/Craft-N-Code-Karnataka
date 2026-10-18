import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { lessons } from '../../src/lessons.js';
import { libraries } from '../../src/libraries.js';
import { boardFile, importBoard, openPanel } from './helpers.js';

test('keeps the board clean, opens the code panel on demand, and resizes it with mouse and keyboard', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('Demo lesson').selectOption('sum');
  await expect(page.getByRole('button', { name: 'Verify & run' })).toBeEnabled();
  const canvas = page.locator('.canvas-container');
  const before = await canvas.boundingBox();
  // Layout B: the board spans the window width, and nothing floats over it until a pen is chosen.
  expect(before.x).toBe(0);
  expect(before.width).toBe(1440);
  expect(before.height).toBeGreaterThan(700);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  await expect(page.getByRole('complementary')).toBeHidden();
  await expect(page.locator('.shapes-section')).toBeHidden();
  await expect(page.locator('.main-menu-trigger')).toBeHidden();
  await expect(page.locator('.draw-toolbar')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('clean-board.png') });
  await page.getByRole('button', { name: 'Pen: code', exact: true }).click();
  const drawBar = page.getByRole('toolbar', { name: 'Drawing tools' });
  await expect(drawBar).toBeVisible();
  await expect(page.locator('.shapes-section')).toBeHidden();
  const order = await drawBar.locator(':scope > .draw-group .draw-tool, :scope > .draw-group > .shapes-menu > .draw-tool').evaluateAll((items) => items.map((item) => item.getAttribute('aria-label')));
  expect(order).toEqual(['Pen', 'Eraser', 'Hand', 'Select', 'Lock tool', 'Text', 'Shapes', 'Laser', 'Image']);
  await drawBar.getByRole('button', { name: 'Shapes' }).click();
  await expect(page.getByRole('group', { name: 'Shapes' }).getByRole('button')).toHaveText(['Rectangle', 'Diamond', 'Ellipse', 'Arrow', 'Line']);
  await page.getByRole('group', { name: 'Shapes' }).getByRole('button', { name: 'Ellipse' }).click();
  await expect(drawBar.getByRole('button', { name: 'Shapes' })).toHaveAttribute('aria-pressed', 'true');
  await drawBar.getByRole('button', { name: 'Laser' }).click();
  await expect(drawBar.getByRole('button', { name: 'Laser' })).toHaveAttribute('aria-pressed', 'true');
  await expect(drawBar.getByRole('group', { name: 'Stroke thickness' }).getByRole('button')).toHaveCount(5);
  await page.getByRole('button', { name: 'Close drawing tools' }).click();
  await expect(page.locator('.draw-toolbar')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show panel', exact: true }).click();
  await expect(page.getByRole('complementary')).toBeVisible();
  const withPanel = await canvas.boundingBox();
  // Toolbar text and font rounding can shift its border by a couple of pixels.
  expect(Math.abs(withPanel.height - before.height)).toBeLessThanOrEqual(4);
  expect(withPanel.width).toBeLessThan(before.width - 300);
  const divider = page.getByRole('separator', { name: 'Resize code and results panel' });
  const handle = await divider.boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 100);
  await page.mouse.down();
  await page.mouse.move(handle.x - 220, handle.y + 100, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await canvas.boundingBox()).width).toBeLessThan(withPanel.width - 180);
  await divider.focus();
  await page.keyboard.press('Home');
  await expect(divider).toHaveAttribute('aria-valuenow', '320');
  await page.getByRole('button', { name: 'Hide panel', exact: true }).click();
  await expect(page.getByRole('complementary')).toBeHidden();
  await expect.poll(async () => (await canvas.boundingBox()).width).toBe(1440);
  await page.getByRole('button', { name: 'Show panel', exact: true }).click();
  await expect(page.getByLabel(/CODE THAT RUNS/)).toHaveValue(lessons[0].source);
  expect(errors).toEqual([]);
});

test('initial code bounds contain every rendered glyph after the local font loads', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByLabel('Demo lesson').selectOption('sum');
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
  await page.getByLabel('Demo lesson').selectOption('sum');
  await expect(page.getByRole('button', { name: 'Verify & run' })).toBeEnabled();
  await openPanel(page);
  await page.locator('.frame-size summary').click();
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
  await page.getByLabel('Demo lesson').selectOption('sum');
  await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
  await openPanel(page);
  await expect(page.getByLabel(/CODE THAT RUNS/)).toHaveValue(lessons[0].source);
});

test('browses curated headers and loads their examples onto the board', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Demo lesson').selectOption('sum');
  await openPanel(page);
  await page.getByRole('tab', { name: 'Libraries', exact: true }).click();
  for (const library of libraries) {
    await page.getByLabel('C++ LIBRARIES').selectOption(library.file);
    await expect(page.locator('.library-source')).toContainText('#ifndef');
    await expect(page.locator('.library-panel h3')).toHaveText(library.title);
    const expected = await readFile(new URL(`../../runner/lib/${library.file}`, import.meta.url), 'utf8');
    await expect(page.locator('.library-source')).toHaveText(expected);
  }
  await page.getByRole('button', { name: 'Load example on board', exact: true }).click();
  await expect(page.getByLabel(/CODE THAT RUNS/)).toHaveValue(lessons.find((lesson) => lesson.id === 'search').source);
});

test('keeps handwriting action above the panel toggle without clipping', async ({ page }, testInfo) => {
  await page.route('**/api/health', route => route.fulfill({ json: {
    runner: { available: false }, ocr: { available: true },
  } }));
  await page.goto('/');
  const file = boardFile({ code: 'int main(void) { return 0; }' });
  const board = JSON.parse(file.buffer.toString());
  board.elements.push({ id: 'layout-ink', type: 'freedraw', frameId: 'frame', x: 60, y: 80,
    width: 40, height: 20, strokeColor: '#1e1e1e', points: [[0, 0], [40, 20]] });
  file.buffer = Buffer.from(JSON.stringify(board));
  await importBoard(page, file);
  await openPanel(page);
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    if (width > 800) {
      await page.getByRole('separator', { name: 'Resize code and results panel' }).focus();
      await page.keyboard.press('End');
    }
    const action = page.getByRole('button', { name: 'Read & review handwriting', exact: true });
    await expect(action).toBeEnabled();
    const run = await action.boundingBox();
    await expect(page.getByRole('button', { name: 'Hide panel', exact: true }).locator('.tool-label')).toBeVisible();
    const toggle = await page.getByRole('button', { name: 'Hide panel', exact: true }).boundingBox();
    const pane = await page.locator('.board-pane').boundingBox();
    expect(run.y + run.height).toBeLessThanOrEqual(toggle.y);
    expect(run.x).toBeGreaterThanOrEqual(pane.x);
    expect(run.x + run.width).toBeLessThanOrEqual(pane.x + pane.width);
    expect(run.y + run.height).toBeLessThanOrEqual(pane.y + pane.height);
    await expect(action).toBeInViewport({ ratio: 1 });
    expect(run.width).toBeLessThanOrEqual(160);
    const overflow = await page.locator('.toolstrip').evaluate(el =>
      [el, el.querySelector('.toolstrip-controls')].some(item => item.scrollWidth > item.clientWidth));
    expect(overflow).toBe(false);
    await page.screenshot({ path: testInfo.outputPath(`handwriting-actions-${width}.png`) });
  }
});

test('dark mode switches the app and board and is remembered after a reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.excalidraw.theme--dark')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', 'light');
});

test('stroke thickness has five sizes and the chosen one stays selected', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Pen: code', exact: true }).click();
  const widths = page.getByRole('group', { name: 'Stroke thickness' });
  await expect(widths.getByRole('button')).toHaveCount(5);
  await widths.getByRole('button', { name: 'Stroke 10' }).click();
  await expect(widths.getByRole('button', { name: 'Stroke 10' })).toHaveAttribute('aria-pressed', 'true');
  await expect(widths.getByRole('button', { name: 'Stroke 2' })).toHaveAttribute('aria-pressed', 'false');
});
