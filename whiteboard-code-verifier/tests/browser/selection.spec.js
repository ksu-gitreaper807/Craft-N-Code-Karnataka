import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { boardFile, importBoard, openPanel } from './helpers.js';

test('starts blank and selects code plus input drawn anywhere, leaving outside writing unselected', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Select code and input', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Verify & run', exact: true })).toBeDisabled();
  async function scene(name) {
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const file = await downloaded;
    const path = testInfo.outputPath(name);
    await file.saveAs(path);
    return JSON.parse(await readFile(path, 'utf8'));
  }
  expect((await scene('blank.excalidraw')).elements).toEqual([]);
  const area = await page.locator('.canvas-container').boundingBox();
  async function stroke(x, y) {
    await page.mouse.move(area.x + area.width * x, area.y + area.height * y);
    await page.mouse.down();
    await page.mouse.move(area.x + area.width * x + 25, area.y + area.height * y - 12, { steps: 6 });
    await page.mouse.up();
  }
  await page.getByRole('button', { name: 'Pen: code', exact: true }).click();
  await stroke(.3, .5);
  await stroke(.82, .6);
  await page.getByRole('button', { name: 'Pen: input', exact: true }).click();
  await stroke(.3, .65);
  await page.getByRole('button', { name: 'Select code and input', exact: true }).click();
  await page.mouse.move(area.x + area.width * .2, area.y + area.height * .4);
  await page.mouse.down();
  await page.mouse.move(area.x + area.width * .55, area.y + area.height * .75, { steps: 10 });
  await page.mouse.up();
  const selected = await scene('region.excalidraw');
  const frames = selected.elements.filter((item) => item.type === 'frame');
  expect(frames).toHaveLength(1);
  expect(selected.verifier.frameId).toBe(frames[0].id);
  const inside = selected.elements.filter((item) => item.frameId === frames[0].id);
  expect(inside).toHaveLength(2);
  expect(inside.map((item) => item.strokeColor).sort()).toEqual(['#1971c2', '#1e1e1e']);
  expect(selected.elements.filter((item) => item.type === 'freedraw' && !item.frameId)).toHaveLength(1);
});

test('imports a canvas without a predefined frame and keeps mobile actions accessible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('input[type=file][accept=".excalidraw,.json"]').setInputFiles({ name: 'blank.excalidraw', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ type: 'excalidraw', elements: [] })) });
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Select code and input', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});


test('numbers program regions and keeps the chosen box highlighted through zoom and panel resizing', async ({ page }, testInfo) => {
  const file = boardFile({ code: 'int main() { return 1; }' });
  const scene = JSON.parse(file.buffer.toString());
  scene.elements.push({ ...scene.elements[0], id: 'second-code', frameId: 'second-frame', x: 1840, text: 'int main() { return 2; }' },
    { id: 'second-frame', type: 'frame', name: 'Selected program', x: 1800, y: 0, width: 650, height: 600 });
  file.buffer = Buffer.from(JSON.stringify(scene));
  await page.goto('/');
  await importBoard(page, file);
  const picker = page.getByLabel('PROGRAM FRAME', { exact: true });
  await expect(picker.locator('option')).toHaveText(['Selected program #1', 'Selected program #2']);
  await expect(page.locator('.program-region[data-selected="true"]')).toHaveAttribute('data-program-region', 'frame');
  await openPanel(page);
  await picker.selectOption('second-frame');
  const selected = page.locator('.program-region[data-selected="true"]');
  await expect(selected).toHaveCount(1);
  await expect(selected).toHaveAttribute('data-program-region', 'second-frame');
  await expect(selected.locator('.program-region-label')).toHaveText('Selected program #2');
  await expect(page.getByLabel(/CODE THAT RUNS/)).toHaveValue('int main() { return 2; }');
  await expect.poll(async () => {
    const box = await selected.boundingBox();
    const canvas = await page.locator('.program-canvas').boundingBox();
    return box.x >= canvas.x && box.y >= canvas.y && box.x + box.width <= canvas.x + canvas.width && box.y + box.height <= canvas.y + canvas.height;
  }).toBe(true);
  const before = await selected.boundingBox();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect.poll(async () => (await selected.boundingBox()).width).toBeGreaterThan(before.width);
  expect(await selected.evaluate(el => getComputedStyle(el).pointerEvents)).toBe('none');
  await page.getByRole('button', { name: 'Pen: code', exact: true }).click();
  await page.getByRole('toolbar', { name: 'Drawing tools' }).getByRole('button', { name: 'Hand', exact: true }).click();
  const beforePan = await selected.boundingBox();
  const surface = await page.locator('.program-canvas').boundingBox();
  await page.mouse.move(surface.x + surface.width / 2, surface.y + surface.height / 2);
  await page.mouse.down();
  await page.mouse.move(surface.x + surface.width / 2 + 50, surface.y + surface.height / 2 + 30, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await selected.boundingBox()).x).toBeGreaterThan(beforePan.x + 25);
  await page.getByRole('button', { name: 'Close drawing tools', exact: true }).click();
  await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: testInfo.outputPath('numbered-program-selection.png'), fullPage: true });
  await picker.selectOption('frame');
  await expect(selected).toHaveAttribute('data-program-region', 'frame');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const downloaded = await download;
  const exported = JSON.parse(await readFile(await downloaded.path(), 'utf8'));
  expect(exported.elements).toHaveLength(4);
  expect(exported.elements.filter(el => el.type === 'frame').map(el => el.name)).toEqual(['Imported program', 'Selected program']);
  expect(exported.verifier.frameId).toBe('frame');
});
