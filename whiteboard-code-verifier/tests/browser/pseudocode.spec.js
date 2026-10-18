import { openPanel } from './helpers.js';
import { selectWritingRegion } from './board-helpers.js';
import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

const corrected = '#include <stdio.h>\nint main(void) { puts("5"); return 0; }';
const response = { source: corrected, explanation: 'Completed a short C demonstration.', issues: [{ line: 1, message: 'Added main and missing semicolons.' }], provider: 'gemini', model: 'test-fixture', durationMs: 1 };
const compiled = { status: 'success', stdout: '5\n', stderr: '', compilerOutput: '', diagnostics: [], notes: [], durationMs: 1, exitCode: 0 };

async function prepare(page) {
  await page.route('**/api/health', (route) => route.fulfill({ json: { runner: { available: true }, ocr: { available: true } } }));
  await page.goto('/');
  await page.getByLabel('Demo lesson').selectOption('sum');
  await openPanel(page);
}

async function level(page, number) {
  const slider = page.getByRole('slider', { name: 'Pseudocode level' });
  await slider.focus();
  await slider.press('Home');
  for (let i = 1; i < number; i++) await slider.press('ArrowRight');
}

for (const number of [1, 2, 3]) {
  test(`level ${number} uses Gemini and compiles the appropriate source without overwriting the board`, async ({ page }) => {
    const originals = { 1: 'int main(void) { return O; }', 2: 'int total = 5\nprintf("%d\\n", total)', 3: 'Start at 3. Add 1 twice. Print the total.' };
    const runs = [], calls = [];
    await page.route('**/api/pseudocode', (route) => {
      calls.push(route.request().postDataJSON());
      return route.fulfill({ json: { ...response, level: number } });
    });
    await page.route('**/api/run', (route) => {
      runs.push(route.request().postDataJSON());
      return route.fulfill({ json: number === 1 ? { ...compiled, status: 'compile_error', stdout: '', compilerOutput: 'board.c:1: error: O undeclared' } : compiled });
    });
    await prepare(page);
    await page.getByLabel(/CODE THAT RUNS/).fill(originals[number]);
    await page.getByLabel('STANDARD INPUT · BLUE INK').fill('7\n\n');
    await level(page, number);
    expect(calls).toHaveLength(0);
    expect(runs).toHaveLength(0);
    await page.getByRole('button', { name: number === 1 ? 'Verify & run' : number === 2 ? 'Correct & run' : 'Generate & run', exact: true }).click();
    await expect(page.getByLabel(number === 1 ? 'Suggested C' : 'Generated C', { exact: true })).toHaveText(corrected);
    await expect(page.locator('.run-button')).toBeEnabled();
    expect(calls).toHaveLength(1);
    expect(calls[0].source).toBe(originals[number]);
    expect(calls[0].level).toBe(number);
    expect(runs).toEqual([{ source: number === 1 ? originals[number] : corrected, stdin: '7\n\n' }]);
    if (number === 1) expect(calls[0].compilerOutput).toContain('O undeclared');
    else await expect(page.locator('.terminal pre')).toHaveText('5\n');
    await openPanel(page);
    await expect(page.getByLabel(/CODE THAT RUNS/)).toHaveValue(originals[number]);
    if (number > 1) {
      await level(page, 1);
      await page.getByRole('tab', { name: 'Output', exact: true }).click();
      await expect(page.locator('.stale-notice')).toBeVisible();
    }
  });
}

test('a pending generation is not compiled after the board changes', async ({ page }) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let runs = 0;
  await page.route('**/api/pseudocode', async (route) => { await gate; await route.fulfill({ json: { ...response, level: 3 } }); });
  await page.route('**/api/run', (route) => { runs++; return route.fulfill({ json: compiled }); });
  await prepare(page);
  await page.getByLabel(/CODE THAT RUNS/).fill('Print 5.');
  await level(page, 3);
  const sent = page.waitForRequest('**/api/pseudocode');
  await page.getByRole('button', { name: 'Generate & run', exact: true }).click();
  await sent;
  // Canvas edits remain possible while the request is running. Import an edited
  // scene through Excalidraw's own keyboard deletion to invalidate the selection.
  // Delete the selected frame with Excalidraw keyboard selection.
  const area = await page.locator('.canvas-container').boundingBox();
  await page.mouse.click(area.x + area.width * .8, area.y + area.height * .8);
  await page.keyboard.press('v');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  release();
  await expect(page.getByRole('alert')).toContainText('board changed');
  expect(runs).toBe(0);
});

test('Gemini quota failures do not compile a level two or three draft', async ({ page }) => {
  let runs = 0;
  await page.route('**/api/pseudocode', (route) => route.fulfill({ status: 429, json: {
    error: 'Gemini reached a token quota.', diagnostic: { quotaStatus: 'token_limit_reached' },
  } }));
  await page.route('**/api/run', (route) => { runs++; return route.fulfill({ json: compiled }); });
  await prepare(page);
  await level(page, 2);
  await page.getByRole('button', { name: 'Correct & run', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('token quota');
  expect(runs).toBe(0);
  await page.getByText('Gemini assistance diagnostics', { exact: true }).click();
  await expect(page.locator('.raw-output pre')).toContainText('token_limit_reached');
});

for (const [number, original] of [[2, 'printf("%d", 5)'], [3, 'Print five.']]) {
test(`handwritten level ${number} source requires confirmation before Gemini repairs or generates and compiles it`, async ({ page }, testInfo) => {
  let assists = 0, runs = 0;
  await page.route('**/api/health', (route) => route.fulfill({ json: { runner: { available: true }, ocr: { available: true } } }));
  await page.route('**/api/ocr', (route) => route.fulfill({ json: { provider: 'test-fixture', model: 'fixture-only', durationMs: 1,
    requiresConfirmation: true, stdin: [], code: [{ text: original, box: [10, 10, 900, 900], uncertain: false, alternatives: [] }] } }));
  await page.route('**/api/pseudocode', (route) => {
    assists++;
    expect(route.request().postDataJSON().source).toBe(original);
    expect(route.request().postDataJSON().level).toBe(number);
    return route.fulfill({ json: { ...response, level: number } });
  });
  await page.route('**/api/run', (route) => {
    runs++;
    expect(route.request().postDataJSON().source).toBe(corrected);
    return route.fulfill({ json: compiled });
  });
  await page.goto('/');
  await selectWritingRegion(page);
  const area = await page.locator('.canvas-container').boundingBox();
  await page.mouse.move(area.x + area.width * .4, area.y + area.height * .45);
  await page.mouse.down();
  await page.mouse.move(area.x + area.width * .4 + 30, area.y + area.height * .45 + 10, { steps: 5 });
  await page.mouse.up();
  await level(page, number);
  await page.getByRole('button', { name: 'Read & review handwriting', exact: true }).click();
  await expect(page.getByLabel('Code line 1', { exact: true })).toHaveValue(original);
  expect(assists).toBe(0);
  expect(runs).toBe(0);
  await page.getByRole('checkbox', { name: 'I checked the code and input against the handwriting.' }).check();
  await page.getByRole('button', { name: 'Use confirmed code', exact: true }).click();
  expect(assists).toBe(0);
  await page.getByRole('button', { name: number === 2 ? 'Correct & run' : 'Generate & run', exact: true }).click();
  await expect(page.locator('.terminal pre')).toHaveText('5\n');
  await expect(page.getByLabel('Generated C', { exact: true })).toHaveText(corrected);
  await expect(page.getByRole('button', { name: 'Use this C on board', exact: true })).toHaveCount(0);
  expect(assists).toBe(1);
  expect(runs).toBe(1);
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const file = await downloaded;
  const path = testInfo.outputPath('algorithm.excalidraw');
  await file.saveAs(path);
  const saved = JSON.parse(await readFile(path, 'utf8'));
  expect(saved.elements.some((item) => item.type === 'freedraw')).toBe(true);
  expect(saved.verifier.ocr.reviewed.code).toEqual([original]);
  expect(saved.verifier.result.source).toBe(corrected);
});

}

test('level one retains the actual compiler result when Gemini fails', async ({ page }) => {
  await page.route('**/api/pseudocode', (route) => route.fulfill({ status: 429, json: { error: 'Gemini quota reached.' } }));
  await page.route('**/api/run', (route) => route.fulfill({ json: compiled }));
  await prepare(page);
  await page.getByRole('button', { name: 'Verify & run', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('original compiler result is shown');
  await expect(page.locator('.terminal pre')).toHaveText('5\n');
});
