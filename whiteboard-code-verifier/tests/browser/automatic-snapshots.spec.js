import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { boardFile, importBoard, openPanel } from './helpers.js';

const archive = fileURLToPath(new URL('../../test-results/lesson-snapshots/', import.meta.url));
const success = { status: 'success', stdout: '8\n', stderr: '', compilerOutput: '', diagnostics: [], notes: [], exitCode: 0 };
const savedResponse = page => page.waitForResponse(response => response.url().endsWith('/api/snapshots') && response.request().method() === 'POST');
const savedFile = (snapshot, name) => readFile(join(archive, snapshot.id, name), 'utf8');

async function prepare(page, language = 'c', gemini = false) {
  await page.route('**/api/health*', route => route.fulfill({ json: {
    runner: { available: true }, ocr: { available: gemini }, snapshots: { available: true },
  } }));
  await page.goto('/');
  const original = language === 'c' ? 'int main(void) { return 0; }' : 'print(0)';
  const file = boardFile({ code: original, stdin: '3 5\n\n', language });
  const board = JSON.parse(file.buffer);
  board.elements.push({ id: 'outside-note', type: 'text', x: 1400, y: 900, width: 350, height: 30,
    fontSize: 20, strokeColor: '#7048e8', text: 'Outside the selected code region' });
  board.elements.push({ id: 'second-frame', type: 'frame', x: 1300, y: 700, width: 500, height: 500, name: 'Another diagram' });
  file.buffer = Buffer.from(JSON.stringify(board));
  await importBoard(page, file);
  await openPanel(page);
  return original;
}

for (const language of ['c', 'python']) {
  test(`${language} automatically commits the complete canvas and actual editor source, including compile errors`, async ({ page }) => {
    const actual = language === 'c' ? 'int main(void) { broken; }' : 'print(8)';
    const result = language === 'c' ? { ...success, status: 'compile_error', stdout: '', compilerOutput: 'broken undeclared' } : success;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/api/run', async route => {
      expect(route.request().postDataJSON().source).toBe(actual);
      await gate;
      await route.fulfill({ json: result });
    });
    const original = await prepare(page, language);
    await page.getByLabel(/CODE THAT RUNS/).fill(actual);
    const sent = page.waitForRequest('**/api/run');
    const saved = savedResponse(page);
    await page.getByRole('button', { name: 'Verify & run', exact: true }).click();
    await sent;
    // Changes made while execution is pending must not replace the submitted board.
    const area = await page.locator('.canvas-container').boundingBox();
    await page.mouse.click(area.x + area.width * .8, area.y + area.height * .8);
    await page.keyboard.press('v');
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Delete');
    release();
    const response = await saved;
    expect(response.status()).toBe(201);
    const snapshot = await response.json();
    const scene = JSON.parse(await savedFile(snapshot, 'board.excalidraw'));
    expect(scene.elements.find(el => el.id === 'outside-note').text).toBe('Outside the selected code region');
    expect(scene.elements.some(el => el.id === 'second-frame')).toBe(true);
    expect(scene.elements.find(el => el.id === 'code').text).toBe(original);
    expect(scene.verifier.execution.result.status).toBe(result.status);
    expect(await savedFile(snapshot, language === 'c' ? 'board.cpp' : 'board.py')).toBe(actual);
    expect(await savedFile(snapshot, 'input.txt')).toBe('3 5\n\n');
    expect(JSON.parse(await savedFile(snapshot, 'result.json')).result.status).toBe(result.status);
    await expect(page.getByLabel('Automatic snapshot status')).toContainText(snapshot.commit.slice(0, 8));
    await expect(page.getByRole('tab', { name: 'Output', exact: true })).toHaveAttribute('aria-selected', 'true');
  });
}

test('an Algorithm-mode run archives generated code while preserving the original complete drawing', async ({ page }) => {
  const corrected = '#include <stdio.h>\nint main(void) { puts("8"); return 0; }';
  await page.route('**/api/pseudocode', route => route.fulfill({ json: {
    source: corrected, explanation: 'Completed the code.', issues: [], level: 3, provider: 'test-fixture', model: 'fixture-only',
  } }));
  await page.route('**/api/run', route => route.fulfill({ json: success }));
  const original = await prepare(page, 'c', true);
  const slider = page.getByRole('slider', { name: 'Code mode' });
  await slider.focus(); await slider.press('Home'); await slider.press('ArrowRight'); await slider.press('ArrowRight');
  const saved = savedResponse(page);
  await page.getByRole('button', { name: 'Generate & run', exact: true }).click();
  const snapshot = await (await saved).json();
  expect(await savedFile(snapshot, 'board.cpp')).toBe(corrected);
  const scene = JSON.parse(await savedFile(snapshot, 'board.excalidraw'));
  expect(scene.elements.find(el => el.id === 'code').text).toBe(original);
  expect(scene.elements.some(el => el.id === 'outside-note')).toBe(true);
  expect(scene.verifier.execution.level).toBe(3);
  await expect(page.locator('.terminal pre')).toHaveText('8\n');
});

test('each input case commits a separate full-board snapshot with its own stdin and result', async ({ page }) => {
  await page.route('**/api/run', route => route.fulfill({ json: { ...success, stdout: route.request().postDataJSON().stdin } }));
  await prepare(page);
  await page.getByRole('tab', { name: 'Cases', exact: true }).click();
  await page.locator('#case-input-1').fill('first\n');
  await page.getByRole('button', { name: 'Add case' }).click();
  await page.locator('#case-input-2').fill('second\n\n');
  const snapshots = [];
  const responses = [];
  page.on('response', response => {
    if (response.url().endsWith('/api/snapshots') && response.request().method() === 'POST') responses.push(response.json().then(value => snapshots.push(value)));
  });
  await page.getByRole('button', { name: 'Run 2 cases', exact: true }).click();
  await expect(page.locator('.case-results li')).toHaveCount(2);
  // Results are progressive; wait for the last snapshot as well as the last run.
  await expect(page.getByRole('button', { name: 'Run 2 cases', exact: true })).toBeEnabled();
  await Promise.all(responses);
  expect(snapshots).toHaveLength(2);
  expect(snapshots[0].id).not.toBe(snapshots[1].id);
  for (const [index, input] of ['first\n', 'second\n\n'].entries()) {
    expect(await savedFile(snapshots[index], 'input.txt')).toBe(input);
    const scene = JSON.parse(await savedFile(snapshots[index], 'board.excalidraw'));
    expect(scene.verifier.execution.kind).toBe('case');
    expect(scene.elements.some(el => el.id === 'outside-note')).toBe(true);
  }
});

test('archive failure is visible without hiding or changing the completed run result', async ({ page }) => {
  await page.route('**/api/run', route => route.fulfill({ json: success }));
  await page.route('**/api/snapshots', route => route.fulfill({ status: 503, json: { error: 'Archive temporarily offline.' } }));
  await prepare(page);
  await page.getByRole('button', { name: 'Verify & run', exact: true }).click();
  await expect(page.locator('.terminal pre')).toHaveText('8\n');
  await expect(page.getByLabel('Automatic snapshot status')).toContainText('Automatic snapshot failed: Archive temporarily offline.');
  await expect(page.getByRole('button', { name: 'Verify & run', exact: true })).toBeEnabled();
});
