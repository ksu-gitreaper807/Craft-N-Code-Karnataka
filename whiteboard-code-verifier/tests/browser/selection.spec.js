import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

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
