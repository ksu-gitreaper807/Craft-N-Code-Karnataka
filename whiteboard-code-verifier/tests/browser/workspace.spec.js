import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { lessons } from '../../src/lessons.js';
import { boardFile, importBoard, openPanel } from './helpers.js';

test('loads the canvas, edits code and input, and roundtrips a downloaded board', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('Demo lesson').selectOption('sum');
  await expect(page.getByRole('link', { name: 'Boardroom home' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Verify & run' })).toBeEnabled();
  await expect(page.locator('.excalidraw canvas').first()).toBeVisible();
  await openPanel(page);
  const source = page.getByLabel(/CODE THAT RUNS/);
  await expect(source).toHaveValue(lessons[0].source);
  const edited = lessons[0].source.replace('a + b', 'a * b');
  await source.fill(edited);
  await expect(source).toHaveValue(edited);
  await expect(page.getByRole('button', { name: /Edited by hand/ })).toBeVisible();
  await page.getByLabel('STANDARD INPUT · BLUE INK').fill('4 6\n');
  await expect(page.getByLabel('STANDARD INPUT · BLUE INK')).toHaveValue('4 6\n');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const download = await downloadPromise;
  const path = testInfo.outputPath('roundtrip.excalidraw');
  await download.saveAs(path);
  const scene = JSON.parse(await readFile(path, 'utf8'));
  // The editor holds the version that runs; the teacher's board text is never rewritten by it.
  expect(scene.elements.some((el) => el.type === 'text' && el.text === lessons[0].source)).toBe(true);
  expect(scene.elements.some((el) => el.type === 'text' && el.text === edited)).toBe(false);
  expect(scene.elements.some((el) => el.type === 'frame')).toBe(true);
  await page.getByLabel('Demo lesson').selectOption('stack');
  await expect(source).toHaveValue(lessons[2].source);
  await page.locator('input[type=file][accept=".excalidraw,.json"]').setInputFiles(path);
  await expect(source).toHaveValue(lessons[0].source);
  await expect(page.getByLabel('STANDARD INPUT · BLUE INK')).toHaveValue('4 6\n');
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('workspace.png'), fullPage: true });
});

test('fits a phone viewport without page-level horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByLabel('Demo lesson').selectOption('sum');
  await expect(page.getByRole('button', { name: 'Verify & run' })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await openPanel(page);
  await expect(page.getByLabel(/CODE THAT RUNS/)).toHaveValue(lessons[0].source);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
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
      await page.getByLabel('Demo lesson').selectOption('sum');
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

  test('underlines the compiler error in the code that ran and marks edits stale', async ({ page }, testInfo) => {
    await page.goto('/');
    await page.getByLabel('Demo lesson').selectOption('sum');
    await openPanel(page);
    await page.getByLabel(/CODE THAT RUNS/).fill('int main(void) {\n    unknown_symbol;\n}\n');
    await page.getByRole('button', { name: 'Verify & run' }).click();
    await expect(page.locator('.result-status')).toContainText('Check the syntax');
    await expect(page.locator('.diagnostic').first()).toContainText('L2');
    await expect(page.locator('.squiggle')).toHaveCount(1);
    await expect(page.locator('.code-gutter .mark-error')).toHaveText('2');
    await page.screenshot({ path: testInfo.outputPath('compiler-diagnostic.png'), fullPage: true });
    await page.locator('.diagnostic').first().click();
    await page.getByLabel(/CODE THAT RUNS/).fill('int main(void) { return 0; }');
    await expect(page.locator('.stale-notice')).toBeVisible();
    await expect(page.locator('.diagnostic').first()).toBeDisabled();
    await expect(page.locator('.squiggle')).toHaveCount(0);
  });

  test('snippet mode shows the template without main(), lets Gemini organize the snippet on every run, and compiles that result', async ({ page }, testInfo) => {
    const structureCalls = [];
    await page.route('**/api/pseudocode', (route) => {
      const body = route.request().postDataJSON();
      structureCalls.push(body);
      return route.fulfill({ json: { source: `int main() {\n${body.source}\nreturn 0;\n}`, explanation: 'Wrapped the statements in main().', issues: [], level: 2, structure: true, provider: 'test', model: 'fixture', durationMs: 1 } });
    });
    await page.route('**/api/health*', (route) => route.fulfill({ json: { runner: { available: true }, ocr: { available: true }, snapshots: { available: true } } }));
    await page.goto('/');
    await importBoard(page, boardFile({ code: 'printf("%d\\n", 7);' }));
    await openPanel(page);
    await expect(page.getByLabel(/CODE THAT RUNS/)).toHaveValue('printf("%d\\n", 7);');
    const slider = page.getByRole('slider', { name: 'Code mode' });
    await slider.focus(); await slider.press('Home'); await slider.press('ArrowRight');
    await page.getByRole('button', { name: 'Edit template' }).click();
    const dialog = page.getByRole('dialog', { name: 'Snippet mode: build your template' });
    await expect(dialog).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('snippet-builder.png') });
    await dialog.getByRole('button', { name: '#include <math.h>' }).click();
    await expect(dialog.getByLabel('Full program preview')).toContainText('#include <math.h>');
    await expect(dialog.getByLabel('Full program preview')).not.toContainText('int main');
    await dialog.getByRole('button', { name: 'Use this template' }).click();
    await expect(dialog).toBeHidden();
    const shown = '#include <stdio.h>\n#include <math.h>\n\nprintf("%d\\n", 7);';
    await expect(page.getByLabel(/CODE THAT RUNS/)).toHaveValue(shown);
    await page.getByRole('button', { name: 'Verify & run' }).click();
    await expect(page.locator('.terminal pre')).toHaveText('7\n');
    expect(structureCalls).toHaveLength(1);
    expect(structureCalls[0]).toMatchObject({ source: 'printf("%d\\n", 7);', structure: true, level: 2, templateContext: '#include <stdio.h>\n#include <math.h>' });
    await expect(page.getByLabel('Organized C++', { exact: true })).toHaveText('#include <stdio.h>\n#include <math.h>\n\nint main() {\nprintf("%d\\n", 7);\nreturn 0;\n}\n');
    // A syntax error is organized but never repaired, and every retry goes through Gemini again before compiling.
    await page.getByLabel(/CODE THAT RUNS/).fill(shown.replace('printf', 'int broken = 1\nprintf'));
    for (const attempt of [2, 3]) {
      await page.getByRole('button', { name: 'Verify & run' }).click();
      await expect(page.locator('.result-status')).toContainText('Check the syntax');
      expect(structureCalls).toHaveLength(attempt);
      expect(structureCalls.at(-1).source).toContain('int broken = 1\nprintf');
    }
    await expect(page.locator('.diagnostic').first()).toContainText(/L[56]/);
    // Turning the mode off gives back the board text exactly as written.
    await expect(page.locator('.run-button')).toBeEnabled();
    await page.getByRole('button', { name: /Edited by hand/ }).click();
    await slider.focus(); await slider.press('Home');
    await expect(page.getByLabel(/CODE THAT RUNS/)).toHaveValue('printf("%d\\n", 7);');
  });

  test('whole page frames all ink in one step', async ({ page }) => {
    await page.goto('/');
    const code = 'int main(void) { return 0; }';
    await importBoard(page, boardFile({ code }));
    await page.getByRole('button', { name: 'Transcribe whole page' }).click();
    await expect(page.getByLabel('PROGRAM FRAME', { exact: true })).toContainText('Selected program #1');
    await openPanel(page);
    await expect(page.getByLabel(/CODE THAT RUNS/)).toHaveValue(code);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
});
