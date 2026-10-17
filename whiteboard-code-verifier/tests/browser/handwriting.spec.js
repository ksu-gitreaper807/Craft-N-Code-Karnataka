import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { lessons } from '../../src/lessons.js';

// The provider is explicitly stubbed here. These tests verify capture/review and
// real Docker execution, not the accuracy of a live handwriting recognition model.
const fixtureLine = (text, index, extra = {}) => ({
  text, box: [50 + index * 150, 50, 140 + index * 150, 950], uncertain: false, alternatives: [], ...extra,
});

async function configureProviderFixture(page) {
  const response = await page.request.get('/api/health');
  const data = await response.json();
  expect(data.runner.available, data.runner.message).toBe(true);
  await page.route('**/api/health', (route) => route.fulfill({ json: {
    ...data, ocr: { available: true, provider: 'test-fixture', model: 'fixture-only' },
  } }));
}

async function drawStroke(page, offset = 0) {
  const area = await page.locator('.canvas-container').boundingBox();
  const x = area.x + area.width * 0.4 + offset;
  const y = area.y + area.height * 0.45 + offset;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 25, y - 20, { steps: 5 });
  await page.mouse.move(x + 50, y + 5, { steps: 5 });
  await page.mouse.up();
}

test('captures pen ink, requires edited teacher confirmation, then runs the confirmed C in Docker', async ({ page }, testInfo) => {
  await configureProviderFixture(page);
  let capture;
  let runRequests = 0;
  page.on('request', (request) => { if (request.url().endsWith('/api/run')) runRequests += 1; });
  await page.route('**/api/ocr', async (route) => {
    capture = route.request().postDataJSON();
    await route.fulfill({ json: {
      provider: 'test-fixture', model: 'fixture-only', durationMs: 1, requiresConfirmation: true,
      code: ['#include <stdio.h>', 'int main(void) {', '    puts("handwritten");', '    return O;', '}'].map((text, index) =>
        fixtureLine(text, index, index === 3 ? { uncertain: true, alternatives: ['    return 0;'] } : {})),
      stdin: [],
    } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '+ New handwritten board' }).click();
  await expect(page.getByLabel('PROGRAM FRAME')).toContainText('Handwritten program');
  await drawStroke(page);
  await expect(page.getByRole('button', { name: 'Read & review handwriting' })).toBeEnabled();
  await page.getByRole('button', { name: 'Read & review handwriting' }).click();
  await expect(page.getByLabel('Code line 4', { exact: true })).toHaveValue('    return O;');
  expect(capture.code).toMatch(/^data:image\/png;base64,/);
  expect(capture.stdin).toBeUndefined();
  await expect(page.getByAltText('Captured code handwriting')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use confirmed code' })).toBeDisabled();
  expect(runRequests).toBe(0);
  await page.getByLabel('Code line 4', { exact: true }).fill('    return 0;');
  await page.getByRole('button', { name: 'Insert code line after 1', exact: true }).click();
  await expect(page.getByLabel('Code line 2', { exact: true })).toHaveValue('');
  await page.screenshot({ path: testInfo.outputPath('handwriting-review-fixture.png'), fullPage: true });
  await page.getByRole('checkbox', { name: 'I checked the code and input against the handwriting.' }).check();
  await page.getByRole('button', { name: 'Use confirmed code' }).click();
  expect(runRequests).toBe(0);
  await expect(page.getByLabel(/CONFIRMED SOURCE/)).toHaveValue('#include <stdio.h>\n\nint main(void) {\n    puts("handwritten");\n    return 0;\n}');
  await page.getByRole('button', { name: 'Verify & run' }).click();
  await expect(page.locator('.terminal pre')).toHaveText('handwritten\n');
  expect(runRequests).toBe(1);
  await page.getByRole('button', { name: 'Pen: code', exact: true }).click();
  await drawStroke(page, 50);
  await expect(page.getByRole('button', { name: 'Read & review handwriting' })).toBeEnabled();
  await expect(page.getByText('The board changed. Run again to update these results.')).toBeVisible();
  await page.getByRole('tab', { name: 'Handwriting', exact: true }).click();
  await expect(page.getByText('The ink changed. Read the frame again before confirming.')).toBeVisible();
});

test('captures blue handwriting separately while preserving exact typed code', async ({ page }) => {
  await configureProviderFixture(page);
  let capture;
  await page.route('**/api/ocr', async (route) => {
    capture = route.request().postDataJSON();
    await route.fulfill({ json: { provider: 'test-fixture', model: 'fixture-only', durationMs: 1,
      requiresConfirmation: true, code: [], stdin: [fixtureLine('3 5', 0)] } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Pen: input', exact: true }).click();
  await drawStroke(page);
  await page.getByRole('button', { name: 'Read & review handwriting' }).click();
  await expect(page.getByLabel('Input line 1', { exact: true })).toHaveValue('3 5');
  expect(capture.stdin).toMatch(/^data:image\/png;base64,/);
  expect(capture.code).toBeUndefined();
  await page.getByRole('checkbox', { name: 'I checked the code and input against the handwriting.' }).check();
  await page.getByRole('button', { name: 'Use confirmed code' }).click();
  await expect(page.getByLabel(/CONFIRMED SOURCE/)).toHaveValue(lessons[0].source);
  await page.getByRole('button', { name: 'Verify & run' }).click();
  await expect(page.locator('.terminal pre')).toHaveText('3 + 5 = 8\n');
});

test('shows a provider failure without executing unreviewed code', async ({ page }) => {
  await configureProviderFixture(page);
  let runs = 0;
  page.on('request', (request) => { if (request.url().endsWith('/api/run')) runs += 1; });
  await page.route('**/api/ocr', (route) => route.fulfill({ status: 502, json: { error: 'Gemini rejected the API key or model access. (HTTP 403)' } }));
  await page.goto('/');
  await page.getByRole('button', { name: '+ New handwritten board' }).click();
  await drawStroke(page);
  await page.getByRole('button', { name: 'Read & review handwriting' }).click();
  await expect(page.getByRole('alert')).toContainText('HTTP 403');
  await expect(page.getByRole('button', { name: 'Use confirmed code' })).toHaveCount(0);
  expect(runs).toBe(0);
});

test('ink changed during recognition cannot be confirmed or executed', async ({ page }) => {
  await configureProviderFixture(page);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route('**/api/ocr', async (route) => {
    await gate;
    await route.fulfill({ json: { provider: 'test-fixture', model: 'fixture-only', durationMs: 1,
      code: [fixtureLine('int main(void) { return 0; }', 0)], stdin: [], requiresConfirmation: true } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '+ New handwritten board' }).click();
  await drawStroke(page);
  const requestPromise = page.waitForRequest('**/api/ocr');
  await page.getByRole('button', { name: 'Read & review handwriting' }).click();
  await requestPromise;
  await drawStroke(page, 50);
  release();
  await expect(page.getByLabel('Code line 1', { exact: true })).toBeVisible();
  await expect(page.getByText('The ink changed. Read the frame again before confirming.')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'I checked the code and input against the handwriting.' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Use confirmed code' })).toBeDisabled();
});

test('confirmed OCR compiler errors map to the ink and downloads retain the reviewed provenance', async ({ page }, testInfo) => {
  await configureProviderFixture(page);
  await page.route('**/api/ocr', (route) => route.fulfill({ json: {
    provider: 'test-fixture', model: 'fixture-only', durationMs: 1, requiresConfirmation: true,
    code: ['int main(void) {', '    return missing_value;', '}'].map((text, index) => fixtureLine(text, index)), stdin: [],
  } }));
  await page.goto('/');
  await page.getByRole('button', { name: '+ New handwritten board' }).click();
  await drawStroke(page);
  await page.getByRole('button', { name: 'Read & review handwriting' }).click();
  await expect(page.getByLabel('Code line 2', { exact: true })).toHaveValue('    return missing_value;');
  await page.getByRole('checkbox', { name: 'I checked the code and input against the handwriting.' }).check();
  await page.getByRole('button', { name: 'Use confirmed code' }).click();
  await page.getByRole('button', { name: 'Verify & run' }).click();
  await expect(page.locator('.result-status')).toContainText('Check the syntax');
  await expect(page.locator('.diagnostic').first()).toContainText('L2');
  await page.locator('.diagnostic').first().click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const download = await downloadPromise;
  const path = testInfo.outputPath('reviewed-handwriting.excalidraw');
  await download.saveAs(path);
  const scene = JSON.parse(await readFile(path, 'utf8'));
  expect(scene.verifier.ocr.raw.provider).toBe('test-fixture');
  expect(scene.verifier.ocr.fingerprint).toBeTruthy();
  expect(scene.verifier.ocr.program.lineMap[1].approximate).toBe(true);
  expect(scene.verifier.ocr.reviewed.code[1]).toBe('    return missing_value;');
  expect(scene.verifier.result.diagnostics[0].line).toBe(2);
  expect(scene.elements.filter((el) => el.frameId === scene.verifier.frameId).every((el) => el.type === 'freedraw')).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('handwriting-diagnostic-fixture.png'), fullPage: true });
});
