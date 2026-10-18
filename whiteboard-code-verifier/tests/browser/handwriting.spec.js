import { selectWritingRegion } from './board-helpers.js';
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { lessons } from '../../src/lessons.js';
import { boardFile, importBoard } from './helpers.js';

// The provider is explicitly stubbed here. These tests verify capture/review and
// real Docker execution, not the accuracy of a live handwriting recognition model.
const fixtureLine = (text, index, extra = {}) => ({
  text, box: [50 + index * 150, 50, 140 + index * 150, 950], uncertain: false, alternatives: [], ...extra,
});

async function configureProviderFixture(page) {
  await page.route('**/api/pseudocode', (route) => route.fulfill({ json: {
    source: route.request().postDataJSON().source, level: 1, explanation: 'Provider fixture.', issues: [],
    provider: 'test-fixture', model: 'fixture-only', durationMs: 1,
  } }));
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

test('a hosting timeout page becomes an OCR timeout with unknown quota and never executes code', async ({ page }) => {
  let runs = 0;
  page.on('request', request => { if (request.url().endsWith('/api/run')) runs++; });
  await page.route('**/api/health', route => route.fulfill({ json: {
    runner: { available: false }, ocr: { available: true, provider: 'test-fixture', model: 'fixture-only' },
  } }));
  await page.route('**/api/ocr', route => route.fulfill({ status: 504, contentType: 'text/html',
    body: '<html><h1>FUNCTION_INVOCATION_TIMEOUT</h1></html>' }));
  const file = boardFile({ code: 'int main(void) { return 0; }' });
  const board = JSON.parse(file.buffer.toString());
  board.elements.push({ id: 'test-ink', type: 'freedraw', frameId: 'frame', x: 60, y: 80, width: 40, height: 20,
    strokeColor: '#1e1e1e', points: [[0, 0], [40, 20]] });
  file.buffer = Buffer.from(JSON.stringify(board));
  await page.goto('/');
  await importBoard(page, file);
  await page.getByRole('button', { name: 'Read & review handwriting' }).click();
  await expect(page.locator('.handwriting-panel')).toContainText('Handwriting recognition timed out at the hosting service (HTTP 504)');
  await expect(page.locator('.handwriting-panel')).toContainText('Gemini token/quota status is unknown');
  await expect(page.locator('.handwriting-panel')).not.toContainText('JSON.parse');
  expect(runs).toBe(0);
});

test('text-only OCR keeps review, literal mistakes and editor diagnostics without invented canvas locations', async ({ page }) => {
  await configureProviderFixture(page);
  let runs = 0;
  page.on('request', request => { if (request.url().endsWith('/api/run')) runs++; });
  await page.route('**/api/ocr', route => route.fulfill({ json: {
    provider: 'test-fixture', model: 'compact-fixture', durationMs: 1, requiresConfirmation: true,
    code: ['int main(void) {', '    return 0', '}'].map((text, index) => ({ text, uncertain: index === 1, box: null, alternatives: [] })), stdin: [],
  } }));
  await page.goto('/');
  await selectWritingRegion(page);
  await drawStroke(page);
  await page.getByRole('button', { name: 'Read & review handwriting', exact: true }).click();
  await expect(page.getByLabel('Code line 2', { exact: true })).toHaveValue('    return 0');
  await expect(page.locator('.ocr-preview svg')).toHaveCount(0);
  await expect(page.locator('.handwriting-panel')).toContainText('text-only recognition does not provide line locations');
  expect(runs).toBe(0);
  await expect(page.getByRole('button', { name: 'Use confirmed code', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: 'I checked the code and input against the handwriting.' }).check();
  await page.getByRole('button', { name: 'Use confirmed code', exact: true }).click();
  await page.getByRole('button', { name: 'Verify & run', exact: true }).click();
  await expect(page.locator('.result-status')).toContainText('Check the syntax');
  await expect(page.locator('.diagnostic').first()).toContainText('expected');
  await expect(page.getByLabel('Automatic snapshot status')).toContainText('Full-board snapshot saved');
  expect(runs).toBe(1);
});

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
  await page.getByLabel('Demo lesson').selectOption('sum');
  await page.getByRole('button', { name: '+ Blank canvas' }).click();
  await selectWritingRegion(page);
  await expect(page.getByLabel('PROGRAM FRAME', { exact: true })).toContainText('Selected program');
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
  await expect(page.getByLabel(/CODE THAT RUNS/)).toHaveValue('#include <stdio.h>\n\nint main(void) {\n    puts("handwritten");\n    return 0;\n}');
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
  await page.getByLabel('Demo lesson').selectOption('sum');
  await page.getByRole('button', { name: 'Pen: input', exact: true }).click();
  await drawStroke(page);
  await page.getByRole('button', { name: 'Read & review handwriting' }).click();
  await expect(page.getByLabel('Input line 1', { exact: true })).toHaveValue('3 5');
  expect(capture.stdin).toMatch(/^data:image\/png;base64,/);
  expect(capture.code).toBeUndefined();
  await page.getByRole('checkbox', { name: 'I checked the code and input against the handwriting.' }).check();
  await page.getByRole('button', { name: 'Use confirmed code' }).click();
  await expect(page.getByLabel(/CODE THAT RUNS/)).toHaveValue(lessons[0].source);
  await page.getByRole('button', { name: 'Verify & run' }).click();
  await expect(page.locator('.terminal pre')).toHaveText('3 + 5 = 8\n');
});

test('shows a provider failure without executing unreviewed code', async ({ page }) => {
  await configureProviderFixture(page);
  let runs = 0;
  page.on('request', (request) => { if (request.url().endsWith('/api/run')) runs += 1; });
  await page.route('**/api/ocr', (route) => route.fulfill({ status: 502, json: { error: 'Gemini rejected the API key or model access. (HTTP 403)' } }));
  await page.goto('/');
  await page.getByLabel('Demo lesson').selectOption('sum');
  await page.getByRole('button', { name: '+ Blank canvas' }).click();
  await selectWritingRegion(page);
  await drawStroke(page);
  await page.getByRole('button', { name: 'Read & review handwriting' }).click();
  await expect(page.getByRole('alert')).toContainText('HTTP 403');
  await expect(page.getByRole('button', { name: 'Use confirmed code' })).toHaveCount(0);
  expect(runs).toBe(0);
});

for (const scenario of [
  { status: 429, quotaStatus: 'token_limit_reached', error: 'Gemini reports a token quota limit was reached. (HTTP 429)' },
  { status: 504, quotaStatus: 'unknown', error: 'Gemini OCR timed out. Token/quota exhaustion is unconfirmed.' },
]) {
  test(`shows Gemini ${scenario.quotaStatus} diagnostics without executing code`, async ({ page }) => {
    await configureProviderFixture(page);
    let runs = 0;
    page.on('request', (request) => { if (request.url().endsWith('/api/run')) runs += 1; });
    await page.route('**/api/ocr', (route) => route.fulfill({ status: scenario.status, json: {
      error: scenario.error,
      diagnostic: { provider: 'gemini', quotaStatus: scenario.quotaStatus, httpStatus: scenario.status === 429 ? 429 : null },
    } }));
    await page.goto('/');
  await page.getByLabel('Demo lesson').selectOption('sum');
    await page.getByRole('button', { name: '+ Blank canvas' }).click();
  await selectWritingRegion(page);
    await drawStroke(page);
    await page.getByRole('button', { name: 'Read & review handwriting' }).click();
    await expect(page.getByRole('alert')).toHaveText(scenario.error);
    await page.getByText('Gemini OCR diagnostics', { exact: true }).click();
    await expect(page.locator('.handwriting-panel .raw-output pre')).toContainText(scenario.quotaStatus);
    await expect(page.getByRole('link', { name: 'Check Gemini usage and limits in AI Studio' })).toHaveAttribute('href', 'https://aistudio.google.com/usage');
    expect(runs).toBe(0);
  });
}

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
  await page.getByLabel('Demo lesson').selectOption('sum');
  await page.getByRole('button', { name: '+ Blank canvas' }).click();
  await selectWritingRegion(page);
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
  await page.getByLabel('Demo lesson').selectOption('sum');
  await page.getByRole('button', { name: '+ Blank canvas' }).click();
  await selectWritingRegion(page);
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


test('only reduces handwriting captures above the 1800-pixel longest-side limit', async ({ page }) => {
  await page.route('**/api/health', route => route.fulfill({ json: {
    runner: { available: false }, ocr: { available: true },
  } }));
  let capture;
  await page.route('**/api/ocr', route => {
    capture = route.request().postDataJSON();
    return route.fulfill({ json: { code: [], stdin: [] } });
  });
  await page.goto('/');
  for (const [width, height] of [[400, 100], [1768, 100], [2200, 100], [100, 2200]]) {
    const file = boardFile({ code: '' });
    const board = JSON.parse(file.buffer.toString());
    board.elements.push({ id: 'sizing-ink', type: 'freedraw', frameId: 'frame', x: 40, y: 40,
      width, height, strokeColor: '#1e1e1e', points: [[0, 0], [width, height]] });
    file.buffer = Buffer.from(JSON.stringify(board));
    await importBoard(page, file);
    const response = page.waitForResponse('**/api/ocr');
    await page.getByRole('button', { name: 'Read & review handwriting', exact: true }).click();
    await response;
    const png = Buffer.from(capture.code.split(',')[1], 'base64');
    const actualWidth = png.readUInt32BE(16);
    const actualHeight = png.readUInt32BE(20);
    const scale = Math.min(1, 1800 / Math.max(width + 32, height + 32));
    expect(actualWidth).toBe(Math.ceil((width + 32) * scale));
    expect(actualHeight).toBe(Math.ceil((height + 32) * scale));
    expect(Math.max(actualWidth, actualHeight)).toBeLessThanOrEqual(1800);
  }
});


test('confirmed arrow drawings invoke list_from_arrows and run real linked nodes', async ({ page }) => {
  await configureProviderFixture(page);
  let runs = 0;
  page.on('request', request => { if (request.url().endsWith('/api/run')) runs++; });
  await page.route('**/api/ocr', route => route.fulfill({ json: {
    provider: 'test-fixture', model: 'drawing-fixture', requiresConfirmation: true,
    code: [fixtureLine('1->3->4->5', 0, { box: null })], stdin: [],
  } }));
  const file = boardFile({ code: '1   3   4   5' });
  const board = JSON.parse(file.buffer.toString());
  board.elements.push({ id: 'list-arrow', type: 'arrow', frameId: 'frame', x: 80, y: 80,
    width: 200, height: 0, strokeColor: '#1e1e1e', points: [[0, 0], [200, 0]], startArrowhead: null, endArrowhead: 'arrow' });
  file.buffer = Buffer.from(JSON.stringify(board));
  await page.goto('/');
  await importBoard(page, file);
  await page.getByRole('button', { name: 'Read & review handwriting', exact: true }).click();
  await expect(page.getByLabel('Code line 1', { exact: true })).toHaveValue('1->3->4->5');
  expect(runs).toBe(0);
  await page.getByRole('checkbox', { name: 'I checked the code and input against the handwriting.' }).check();
  await page.getByRole('button', { name: 'Use confirmed code', exact: true }).click();
  await expect(page.getByLabel(/CODE THAT RUNS/)).toHaveValue(/list_from_arrows\(&list, "1->3->4->5"\)/);
  await page.getByRole('button', { name: 'Verify & run', exact: true }).click();
  await expect(page.locator('.result-status')).toContainText('Program completed');
  await expect(page.locator('.terminal pre')).toHaveText('1->3->4->5\n');
  await expect(page.getByLabel('Automatic snapshot status')).toContainText('Full-board snapshot saved');
  expect(runs).toBe(1);
});

function inputScanBoard({ codeInk = true, source = lessons[0].source } = {}) {
  const file = boardFile({ code: source });
  const board = JSON.parse(file.buffer.toString());
  for (const [id, color, y] of [
    ...(codeInk ? [['black-scan-stroke', '#1e1e1e', 100]] : []),
    ['blue-scan-stroke', '#1971c2', 480],
  ]) board.elements.push({ id, type: 'freedraw', frameId: 'frame', x: 60, y, width: 40, height: 20,
    strokeColor: color, points: [[0, 0], [40, 20]] });
  file.buffer = Buffer.from(JSON.stringify(board));
  return file;
}

test('independent input scans preserve reviewed code, run new input and persist separate cases', async ({ page }, testInfo) => {
  await configureProviderFixture(page);
  const captures = [];
  const runs = [];
  page.on('request', request => { if (request.url().endsWith('/api/run')) runs.push(request.postDataJSON()); });
  await page.route('**/api/ocr', async route => {
    const payload = route.request().postDataJSON(); captures.push(payload);
    await route.fulfill({ json: { provider: 'test-fixture', model: 'fixture-only', durationMs: 1,
      code: (payload.code ? lessons[0].source.split('\n') : ['DO NOT REPLACE REVIEWED CODE']).map(text => ({ text, box: null, uncertain: false, alternatives: [] })),
      stdin: [fixtureLine(payload.code ? '3 5' : captures.length === 2 ? '8 9' : '11 12', 0)],
    } });
  });
  await page.goto('/');
  await importBoard(page, inputScanBoard());
  await page.getByRole('button', { name: 'Read & review handwriting', exact: true }).click();
  await page.getByRole('checkbox', { name: 'I checked the code and input against the handwriting.' }).check();
  await page.getByRole('button', { name: 'Use confirmed code', exact: true }).click();
  await page.getByRole('button', { name: 'Verify & run', exact: true }).click();
  await expect(page.locator('.terminal pre')).toHaveText('3 + 5 = 8\n');
  await expect(page.getByLabel('Automatic snapshot status')).toContainText('Full-board snapshot saved');

  await page.getByRole('button', { name: 'Pen: input', exact: true }).click();
  await drawStroke(page);
  await expect(page.getByLabel(/CODE THAT RUNS/)).toHaveValue(lessons[0].source);
  await page.getByRole('button', { name: 'Scan input', exact: true }).click();
  await expect(page.getByLabel('Input line 1', { exact: true })).toHaveValue('8 9');
  await expect(page.getByLabel('Code line 1', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('input-scan-review.png'), fullPage: true });
  expect(captures[1].code).toBeUndefined();
  expect(captures[1].stdin).toMatch(/^data:image\/png;base64,/);
  expect(runs).toHaveLength(1);
  await expect(page.getByRole('button', { name: 'Use input for next run', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: 'I checked the input against the handwriting.' }).check();
  await page.getByLabel('Input line 1', { exact: true }).fill('8 10');
  await expect(page.getByRole('button', { name: 'Use input for next run', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: 'I checked the input against the handwriting.' }).check();
  await page.getByRole('button', { name: 'Use input for next run', exact: true }).click();
  await expect(page.getByLabel('STANDARD INPUT · BLUE INK', { exact: true })).toHaveValue('8 10');
  await page.getByRole('button', { name: 'Verify & run', exact: true }).click();
  await expect(page.locator('.terminal pre')).toHaveText('8 + 10 = 18\n');
  await expect(page.getByLabel('Automatic snapshot status')).toContainText('Full-board snapshot saved');
  expect(runs[1].source).toBe(lessons[0].source);
  expect(runs[1].stdin).toBe('8 10');

  await page.getByRole('button', { name: 'Scan input', exact: true }).click();
  await expect(page.getByLabel('Input line 1', { exact: true })).toHaveValue('11 12');
  await page.getByRole('button', { name: 'Insert stdin line after 1', exact: true }).click();
  await page.getByRole('checkbox', { name: 'I checked the input against the handwriting.' }).check();
  await page.getByRole('button', { name: 'Save input as test case', exact: true }).click();
  await expect(page.locator('.test-cases textarea').first()).toHaveValue('11 12\n');
  await page.getByRole('button', { name: 'Scan input', exact: true }).click();
  await expect(page.getByLabel('Input line 1', { exact: true })).toHaveValue('11 12');
  await page.getByLabel('Input line 1', { exact: true }).fill('20 30');
  await page.getByRole('checkbox', { name: 'I checked the input against the handwriting.' }).check();
  await page.getByRole('button', { name: 'Save input as test case', exact: true }).click();
  await expect(page.locator('.test-cases textarea')).toHaveCount(2);
  await page.getByRole('button', { name: 'Run 2 cases', exact: true }).click();
  await expect(page.locator('.case-results')).toContainText('11 + 12 = 23');
  await expect(page.locator('.case-results')).toContainText('20 + 30 = 50');
  await expect(page.getByRole('button', { name: 'Run 2 cases', exact: true })).toBeEnabled();
  expect(runs).toHaveLength(4);
  await page.getByRole('button', { name: 'Pen: code', exact: true }).click();
  await drawStroke(page, 35);
  await page.getByRole('button', { name: 'Scan input', exact: true }).click();
  await expect(page.getByLabel('Input line 1', { exact: true })).toHaveValue('11 12');
  await page.getByRole('checkbox', { name: 'I checked the input against the handwriting.' }).check();
  await expect(page.getByRole('button', { name: 'Use input for next run', exact: true })).toBeDisabled();
  expect(runs).toHaveLength(4);
  await page.reload();
  await page.getByRole('button', { name: 'Show panel', exact: true }).click();
  await page.getByRole('tab', { name: 'Cases', exact: true }).click();
  await expect(page.locator('.test-cases textarea').nth(0)).toHaveValue('11 12\n');
  await expect(page.locator('.test-cases textarea').nth(1)).toHaveValue('20 30');
});

test('input-only scans can load cases before code review without confirming black code', async ({ page }) => {
  await configureProviderFixture(page);
  let runs = 0;
  page.on('request', request => { if (request.url().endsWith('/api/run')) runs++; });
  await page.route('**/api/ocr', route => route.fulfill({ json: { provider: 'test-fixture', model: 'fixture-only', durationMs: 1,
    code: [], stdin: [fixtureLine('5 7', 0)] } }));
  await page.goto('/');
  await importBoard(page, inputScanBoard());
  // Open the panel without using the run button (which performs a full read).
  await page.getByRole('button', { name: 'Show panel', exact: true }).click();
  await page.getByRole('button', { name: 'Scan input', exact: true }).click();
  await expect(page.getByLabel('Input line 1', { exact: true })).toHaveValue('5 7');
  await page.getByRole('checkbox', { name: 'I checked the input against the handwriting.' }).check();
  await expect(page.getByRole('button', { name: 'Use input for next run', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Save input as test case', exact: true }).click();
  await expect(page.locator('.test-cases textarea').first()).toHaveValue('5 7');
  await expect(page.getByRole('button', { name: 'Run 1 case', exact: true })).toBeDisabled();
  expect(runs).toBe(0);
});

test('new strokes invalidate an input scan and a full case suite rejects an extra scan', async ({ page }) => {
  await configureProviderFixture(page);
  await page.route('**/api/ocr', route => route.fulfill({ json: { provider: 'test-fixture', model: 'fixture-only', durationMs: 1,
    code: [], stdin: [fixtureLine('6 7', 0)] } }));
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('boardroom-test-cases:c', JSON.stringify({ version: 1, language: 'c',
    cases: Array.from({ length: 20 }, (_, i) => ({ name: `Keep ${i}`, stdin: String(i), expectedStatus: 'success', checkOutput: false, expectedOutput: '', comparison: 'exact' })),
  })));
  await page.reload();
  await importBoard(page, inputScanBoard({ codeInk: false }));
  await page.getByRole('button', { name: 'Show panel', exact: true }).click();
  await page.getByRole('button', { name: 'Scan input', exact: true }).click();
  await expect(page.getByLabel('Input line 1', { exact: true })).toHaveValue('6 7');
  await page.getByRole('checkbox', { name: 'I checked the input against the handwriting.' }).check();
  await page.getByRole('button', { name: 'Pen: input', exact: true }).click();
  await drawStroke(page);
  await expect(page.getByRole('button', { name: 'Use input for next run', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save input as test case', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Scan input again', exact: true }).click();
  await expect(page.getByLabel('Input line 1', { exact: true })).toBeEnabled();
  await page.getByRole('checkbox', { name: 'I checked the input against the handwriting.' }).check();
  await page.getByRole('button', { name: 'Save input as test case', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('already has 20 cases');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('boardroom-test-cases:c')).cases.length)).toBe(20);
  await page.getByRole('button', { name: 'Use input for next run', exact: true }).click();
  await expect(page.getByLabel('STANDARD INPUT · BLUE INK', { exact: true })).toHaveValue('6 7');
});


test('scanned cases use the prepared C++ program in the latest snippet flow', async ({ page }) => {
  await configureProviderFixture(page);
  const source = 'int a, b;\nscanf("%d %d", &a, &b);\nprintf("%d\\n", a + b);';
  const runs = [];
  page.on('request', request => { if (request.url().endsWith('/api/run')) runs.push(request.postDataJSON()); });
  await page.route('**/api/ocr', route => route.fulfill({ json: { provider: 'test-fixture', model: 'fixture-only', durationMs: 1,
    code: [], stdin: [fixtureLine('7 8', 0)] } }));
  await page.route('**/api/pseudocode', route => {
    const body = route.request().postDataJSON();
    expect(body.structure).toBe(true);
    return route.fulfill({ json: { source: `int main() {\n${body.source}\nreturn 0;\n}`, explanation: 'Organized fixture.', issues: [],
      level: 2, structure: true, provider: 'test-fixture', model: 'fixture-only', durationMs: 1 } });
  });
  await page.goto('/');
  await importBoard(page, inputScanBoard({ codeInk: false, source }));
  await page.getByRole('button', { name: 'Show panel', exact: true }).click();
  const slider = page.getByRole('slider', { name: 'Code mode' });
  await slider.focus(); await slider.press('Home'); await slider.press('ArrowRight');
  await page.getByRole('button', { name: 'Scan input', exact: true }).click();
  await expect(page.getByLabel('Input line 1', { exact: true })).toHaveValue('7 8');
  await page.getByRole('checkbox', { name: 'I checked the input against the handwriting.' }).check();
  await page.getByRole('button', { name: 'Save input as test case', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Run 1 case', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Verify & run', exact: true }).click();
  await expect(page.locator('.terminal pre')).toHaveText('15\n');
  await page.getByRole('tab', { name: 'Cases', exact: true }).click();
  await page.getByRole('button', { name: 'Run 1 case', exact: true }).click();
  await expect(page.locator('.case-results')).toContainText('15');
  await expect(page.getByRole('button', { name: 'Run 1 case', exact: true })).toBeEnabled();
  expect(runs).toHaveLength(2);
  expect(runs[1].source).toBe(runs[0].source);
  expect(runs[1].stdin).toBe('7 8');
  expect(runs[1].source).toContain('int main()');
});
