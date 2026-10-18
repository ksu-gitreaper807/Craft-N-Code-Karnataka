import { selectWritingRegion } from './board-helpers.js';
import { test, expect } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { boardFile, importBoard, openPanel } from './helpers.js';

const archive = fileURLToPath(new URL('../../test-results/lesson-snapshots/', import.meta.url));

test('unconfigured hosted history explains the missing GitHub setup and disables saving', async ({ page }) => {
  await page.route('**/api/health', (route) => route.fulfill({ json: {
    runner: { available: false }, ocr: { available: false },
    snapshots: { available: false, message: 'Configure SNAPSHOT_GITHUB_TOKEN in Vercel, then redeploy.' },
  } }));
  await page.goto('/');
  await page.getByLabel('Demo lesson').selectOption('sum');
  await openPanel(page);
  await page.getByRole('tab', { name: 'History', exact: true }).click();
  await expect(page.getByLabel('Code, verification controls and results')).toContainText('Configure SNAPSHOT_GITHUB_TOKEN');
  await expect(page.getByRole('button', { name: 'Save lesson snapshot', exact: true })).toBeDisabled();
});

test('compares a committed teaching header with the current version without opening the board', async ({ page }) => {
  await page.goto('/');
  await importBoard(page, boardFile({ code: '#include <queue.h>\nint main(void) { Queue q; queue_init(&q); queue_free(&q); return 0; }' }));
  const savedResponse = page.waitForResponse((response) => response.url().endsWith('/api/snapshots') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save lesson snapshot' }).click();
  const saved = await (await savedResponse).json();
  const entry = page.locator('.snapshot-history li').filter({ hasText: saved.id });
  await entry.getByRole('button', { name: 'Compare saved libraries' }).click();
  await expect(page.getByLabel('Saved library comparison')).toContainText('queue.h');
  await page.locator('#saved-library-select').selectOption('queue.h');
  await expect(page.getByLabel('Saved library comparison')).toContainText('matches the saved lesson');
  await expect(page.locator('.library-comparison pre')).toHaveCount(2);
  expect(await page.locator('.library-comparison pre').first().textContent()).toBe(await page.locator('.library-comparison pre').last().textContent());
});

test('saves literal lesson files with real Git history and reopens the saved board without running code', async ({ page }) => {
  let runs = 0;
  page.on('request', (request) => { if (request.url().endsWith('/api/run')) runs++; });
  await page.goto('/');
  const source = '#include <stdio.h>\n\nint main(void) {\n    unknown_symbol;\n}\n';
  // The editor holds the code that runs; the board text is what a snapshot saves.
  await importBoard(page, boardFile({ code: source }));
  await openPanel(page);
  await page.getByLabel('STANDARD INPUT · BLUE INK').fill('3 5\n\n');
  const responsePromise = page.waitForResponse((response) => response.url().endsWith('/api/snapshots') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save lesson snapshot', exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const saved = await response.json();
  expect(saved.commit).toMatch(/^[a-f0-9]{40,64}$/);
  expect(saved.id).toMatch(/^\d{4}-\d{2}-\d{2}\//);
  expect((await readdir(join(archive, saved.id))).sort()).toEqual(['.dockerignore', 'Dockerfile', 'board.cpp', 'board.excalidraw', 'build.sh', 'input.txt', 'lib.lock', 'replay.py', 'runner.py']);
  expect(await readFile(join(archive, saved.id, 'board.cpp'), 'utf8')).toBe(source);
  expect(await readFile(join(archive, saved.id, 'input.txt'), 'utf8')).toBe('3 5\n\n');
  const scene = JSON.parse(await readFile(join(archive, saved.id, 'board.excalidraw'), 'utf8'));
  expect(scene.elements.some((element) => element.text === source)).toBe(true);
  await expect(page.getByRole('tab', { name: 'History', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.snapshot-history')).toContainText(saved.commit.slice(0, 8));
  await expect(page.locator('.snapshot-history [role=status]')).toContainText('saved on this machine');
  // Saving again while already viewing history refreshes it and never overwrites.
  const nextResponse = page.waitForResponse((item) => item.url().endsWith('/api/snapshots') && item.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save lesson snapshot', exact: true }).click();
  const next = await (await nextResponse).json();
  expect(next.id).not.toBe(saved.id);
  await expect(page.locator('.snapshot-history')).toContainText(next.commit.slice(0, 8));
  await page.getByLabel('Demo lesson').selectOption('queue');
  await openPanel(page);
  await page.getByRole('tab', { name: 'History', exact: true }).click();
  const entry = page.locator('.snapshot-history li').filter({ hasText: saved.id });
  await entry.getByRole('button', { name: 'Open saved board' }).click();
  await expect(page.getByLabel(/CODE THAT RUNS/)).toHaveValue(source);
  await expect(page.getByLabel('STANDARD INPUT · BLUE INK')).toHaveValue('3 5\n\n');
  expect(runs).toBe(0);
});

test('blocks unconfirmed or changed ink and saves teacher-corrected C without replacing strokes', async ({ page }) => {
  let runs = 0;
  page.on('request', (request) => { if (request.url().endsWith('/api/run')) runs++; });
  await page.route('**/api/health', (route) => route.fulfill({ json: {
    runner: { available: false, message: 'Runner intentionally unavailable in this snapshot test.' },
    ocr: { available: true, provider: 'test-fixture', model: 'fixture-only' },
  } }));
  await page.route('**/api/ocr', (route) => route.fulfill({ json: {
    provider: 'test-fixture', model: 'fixture-only', durationMs: 1, requiresConfirmation: true, stdin: [],
    code: ['int main(void) {', '    return O;', '}'].map((text, index) => ({
      text, box: [50 + index * 200, 50, 150 + index * 200, 950], uncertain: index === 1, alternatives: [],
    })),
  } }));
  await page.goto('/');
  await page.getByLabel('Demo lesson').selectOption('sum');
  await page.getByRole('button', { name: '+ Blank canvas' }).click();
  await selectWritingRegion(page);
  const area = await page.locator('.canvas-container').boundingBox();
  async function draw(offset = 0) {
    const x = area.x + area.width * .4 + offset, y = area.y + area.height * .45 + offset;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + 30, y - 20, { steps: 5 }); await page.mouse.up();
  }
  await draw();
  await expect(page.getByRole('button', { name: 'Save lesson snapshot', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Read & review handwriting' }).click();
  await page.getByLabel('Code line 2', { exact: true }).fill('    return 0;');
  await page.getByRole('checkbox', { name: 'I checked the code and input against the handwriting.' }).check();
  await page.getByRole('button', { name: 'Use confirmed code' }).click();
  const responsePromise = page.waitForResponse((response) => response.url().endsWith('/api/snapshots') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save lesson snapshot', exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const saved = await response.json();
  expect(await readFile(join(archive, saved.id, 'board.cpp'), 'utf8')).toBe('int main(void) {\n    return 0;\n}');
  expect(await readFile(join(archive, saved.id, 'input.txt'), 'utf8')).toBe('');
  const scene = JSON.parse(await readFile(join(archive, saved.id, 'board.excalidraw'), 'utf8'));
  expect(scene.elements.some((element) => element.type === 'freedraw')).toBe(true);
  expect(scene.verifier.ocr.reviewed.code[1]).toBe('    return 0;');
  await page.getByRole('button', { name: 'Pen: code', exact: true }).click();
  await draw(50);
  await expect(page.getByRole('button', { name: 'Save lesson snapshot', exact: true })).toBeDisabled();
  await openPanel(page);
  await page.getByRole('tab', { name: 'History', exact: true }).click();
  await page.locator('.snapshot-history li').filter({ hasText: saved.id }).getByRole('button', { name: 'Open saved board' }).click();
  await expect(page.getByRole('tab', { name: 'Handwriting', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Save lesson snapshot', exact: true })).toBeDisabled();
  expect(runs).toBe(0);
});
