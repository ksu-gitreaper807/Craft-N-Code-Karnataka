import { boardFile, importBoard, openPanel } from './helpers.js';
import { selectWritingRegion } from './board-helpers.js';
import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

const corrected = '#include <stdio.h>\nint main(void) { puts("5"); return 0; }';
const response = { source: corrected, explanation: 'Completed a short C demonstration.', issues: [{ line: 1, message: 'Added main and missing semicolons.' }], provider: 'gemini', model: 'test-fixture', durationMs: 1 };
const compiled = { status: 'success', stdout: '5\n', stderr: '', compilerOutput: '', diagnostics: [], notes: [], durationMs: 1, exitCode: 0 };
const failedCompile = { ...compiled, status: 'compile_error', stdout: '', compilerOutput: 'board.c:1: error: O undeclared',
  diagnostics: [{ line: 1, column: 1, severity: 'error', kind: 'compiler', message: 'O undeclared' }] };

async function prepare(page, { gemini = true } = {}) {
  await page.route('**/api/health*', (route) => route.fulfill({ json: { runner: { available: true }, ocr: { available: gemini, message: 'Set GEMINI_API_KEY on the API host.' } } }));
  await page.goto('/');
  await page.getByLabel('Demo lesson').selectOption('sum');
  await openPanel(page);
}

// Snippet mode asks Gemini to organize the code first; this stub wraps loose lines in main() and changes nothing else.
const organize = (body) => ({ source: `int main() {\n${body.source}\nreturn 0;\n}`, explanation: 'Wrapped the statements in main().', issues: [],
  level: 2, structure: true, provider: 'gemini', model: 'test-fixture', durationMs: 1 });

async function mode(page, number) {
  const slider = page.getByRole('slider', { name: 'Code mode' });
  await slider.focus();
  await slider.press('Home');
  for (let i = 1; i < number; i++) await slider.press('ArrowRight');
}

test('Full program never calls Gemini, Snippet asks Gemini only to organize before compiling, and success offers no fix', async ({ page }) => {
  const runs = [], calls = [];
  await page.route('**/api/pseudocode', (route) => { const body = route.request().postDataJSON(); calls.push(body); return route.fulfill({ json: body.structure ? organize(body) : { ...response, level: 1 } }); });
  await page.route('**/api/run', (route) => { runs.push(route.request().postDataJSON()); return route.fulfill({ json: compiled }); });
  await prepare(page);
  await page.getByLabel(/CODE THAT RUNS/).fill('int main(void) { return 0; }');
  await mode(page, 1);
  await expect(page.locator('.mode-text')).toContainText('Full program');
  await page.getByRole('button', { name: 'Verify & run', exact: true }).click();
  await expect(page.locator('.terminal pre')).toHaveText('5\n');
  await expect(page.getByRole('button', { name: 'Ask Gemini to fix' })).toHaveCount(0);
  await page.getByRole('button', { name: /Edited by hand/ }).click();
  await page.getByLabel(/CODE THAT RUNS/).fill('puts("snippet");');
  await mode(page, 2);
  await expect(page.locator('.mode-text')).toContainText('Snippet');
  await expect(page.getByRole('button', { name: 'Edit template' })).toBeVisible();
  await page.getByRole('button', { name: 'Verify & run', exact: true }).click();
  await expect(page.locator('.terminal pre')).toHaveText('5\n');
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ source: 'puts("snippet");', level: 2, structure: true, templateContext: '' });
  expect(runs.map((run) => run.source)).toEqual(['int main(void) { return 0; }', 'int main() {\nputs("snippet");\nreturn 0;\n}']);
  await expect(page.getByLabel('Organized C++', { exact: true })).toContainText('int main()');
});

test('Algorithm mode asks Gemini, runs the generated code, and keeps the board and editor', async ({ page }) => {
  const runs = [], calls = [];
  await page.route('**/api/pseudocode', (route) => { calls.push(route.request().postDataJSON()); return route.fulfill({ json: { ...response, level: 3 } }); });
  await page.route('**/api/run', (route) => { runs.push(route.request().postDataJSON()); return route.fulfill({ json: compiled }); });
  await prepare(page);
  const original = 'Start at 3. Add 1 twice. Print the total.';
  await page.getByLabel(/CODE THAT RUNS/).fill(original);
  await page.getByLabel('STANDARD INPUT · BLUE INK').fill('7\n\n');
  await mode(page, 3);
  expect(calls).toHaveLength(0);
  await page.getByRole('button', { name: 'Generate & run', exact: true }).click();
  await expect(page.getByLabel('Generated C++', { exact: true })).toHaveText(corrected);
  await expect(page.locator('.terminal pre')).toHaveText('5\n');
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ source: original, level: 3 });
  expect(runs).toEqual([{ source: corrected, stdin: '7\n\n' }]);
  await expect(page.getByLabel(/CODE THAT RUNS/)).toHaveValue(original);
  await expect(page.locator('.run-button')).toBeEnabled();
  await mode(page, 1);
  await expect(page.locator('.stale-notice')).toBeVisible();
});

for (const number of [1, 2, 3]) {
  test(`mode ${number}: an error offers "Ask Gemini to fix", which runs the corrected version without changing the editor`, async ({ page }) => {
    const runs = [], calls = [];
    await page.route('**/api/pseudocode', (route) => {
      const body = route.request().postDataJSON();
      calls.push(body);
      return route.fulfill({ json: body.structure ? { ...organize(body), source: body.source } : { ...response, level: body.level } });
    });
    await page.route('**/api/run', (route) => {
      runs.push(route.request().postDataJSON());
      // The first program fails; the corrected program from the fix succeeds.
      return route.fulfill({ json: runs.length === 1 || (number === 3 && runs.length === 1) ? failedCompile : compiled });
    });
    await prepare(page);
    const original = number === 3 ? 'Print five.' : 'int main(void) { return O; }';
    await page.getByLabel(/CODE THAT RUNS/).fill(original);
    await mode(page, number);
    await page.getByRole('button', { name: number === 3 ? 'Generate & run' : 'Verify & run', exact: true }).click();
    await expect(page.locator('.result-status')).toContainText('Check the syntax');
    expect(calls).toHaveLength(number === 1 ? 0 : 1);
    const fix = page.getByRole('button', { name: 'Ask Gemini to fix' });
    await expect(fix).toBeEnabled();
    await fix.click();
    await expect(page.getByLabel('Fixed C++', { exact: true })).toHaveText(corrected);
    await expect(page.locator('.terminal pre')).toHaveText('5\n');
    const fixCall = calls.at(-1);
    expect(fixCall.level).toBe(1);
    expect(fixCall.compilerOutput).toContain('O undeclared');
    expect(fixCall.source).toBe(number === 3 ? corrected : runs[0].source);
    expect(runs.at(-1).source).toBe(corrected);
    await expect(page.getByLabel(/CODE THAT RUNS/)).toHaveValue(original);
    await page.getByRole('button', { name: 'Use this fix in the editor' }).click();
    await expect(page.getByLabel(/CODE THAT RUNS/)).toHaveValue(corrected);
  });
}

test('the fix button is disabled when Gemini is not configured', async ({ page }) => {
  await page.route('**/api/run', (route) => route.fulfill({ json: failedCompile }));
  await prepare(page, { gemini: false });
  await page.getByRole('button', { name: 'Verify & run', exact: true }).click();
  await expect(page.locator('.result-status')).toContainText('Check the syntax');
  await expect(page.getByRole('button', { name: 'Ask Gemini to fix' })).toBeDisabled();
});

test('a pending generation is not compiled after the board changes', async ({ page }) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let runs = 0;
  await page.route('**/api/pseudocode', async (route) => { await gate; await route.fulfill({ json: { ...response, level: 3 } }); });
  await page.route('**/api/run', (route) => { runs++; return route.fulfill({ json: compiled }); });
  await prepare(page);
  await page.getByLabel(/CODE THAT RUNS/).fill('Print 5.');
  await mode(page, 3);
  const sent = page.waitForRequest('**/api/pseudocode');
  await page.getByRole('button', { name: 'Generate & run', exact: true }).click();
  await sent;
  // Delete the selected frame with Excalidraw keyboard selection while the request is pending.
  const area = await page.locator('.canvas-container').boundingBox();
  await page.mouse.click(area.x + area.width * .8, area.y + area.height * .8);
  await page.keyboard.press('v');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  release();
  await expect(page.getByRole('alert')).toContainText('board changed');
  expect(runs).toBe(0);
});

test('Gemini quota failures do not compile an algorithm draft', async ({ page }) => {
  let runs = 0;
  await page.route('**/api/pseudocode', (route) => route.fulfill({ status: 429, json: {
    error: 'Gemini reached a token quota.', diagnostic: { quotaStatus: 'token_limit_reached' },
  } }));
  await page.route('**/api/run', (route) => { runs++; return route.fulfill({ json: compiled }); });
  await prepare(page);
  await mode(page, 3);
  await page.getByRole('button', { name: 'Generate & run', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('token quota');
  expect(runs).toBe(0);
  await page.getByText('Gemini assistance diagnostics', { exact: true }).click();
  await expect(page.locator('.raw-output pre')).toContainText('token_limit_reached');
});

test('a handwritten algorithm requires confirmation before Gemini generates and compiles it', async ({ page }, testInfo) => {
  const original = 'Print five.';
  let assists = 0, runs = 0;
  await page.route('**/api/health', (route) => route.fulfill({ json: { runner: { available: true }, ocr: { available: true } } }));
  await page.route('**/api/ocr', (route) => route.fulfill({ json: { provider: 'test-fixture', model: 'fixture-only', durationMs: 1,
    requiresConfirmation: true, stdin: [], code: [{ text: original, box: [10, 10, 900, 900], uncertain: false, alternatives: [] }] } }));
  await page.route('**/api/pseudocode', (route) => {
    assists++;
    expect(route.request().postDataJSON().source).toBe(original);
    expect(route.request().postDataJSON().level).toBe(3);
    return route.fulfill({ json: { ...response, level: 3 } });
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
  await mode(page, 3);
  await page.getByRole('button', { name: 'Read & review handwriting', exact: true }).click();
  await expect(page.getByLabel('Code line 1', { exact: true })).toHaveValue(original);
  expect(assists).toBe(0);
  expect(runs).toBe(0);
  await page.getByRole('checkbox', { name: 'I checked the code and input against the handwriting.' }).check();
  await page.getByRole('button', { name: 'Use confirmed code', exact: true }).click();
  expect(assists).toBe(0);
  await page.getByRole('button', { name: 'Generate & run', exact: true }).click();
  await expect(page.locator('.terminal pre')).toHaveText('5\n');
  await expect(page.getByLabel('Generated C++', { exact: true })).toHaveText(corrected);
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


test('template mode offers an optional scope fix after real C++ compilation fails', async ({ page }) => {
  const snippet = 'template<typename T>\nT twice(T value) { return value + value; }\nstruct Result { int value; };\nclass Printer { public: static void show(int value) { printf("%d\\n", value); } };\nResult result{twice(3)};\nPrinter::show(result.value);';
  const fixed = '#include <stdio.h>\ntemplate<typename T>\nT twice(T value) { return value + value; }\nstruct Result { int value; };\nclass Printer { public: static void show(int value) { printf("%d\\n", value); } };\nint main() { Result result{twice(3)}; Printer::show(result.value); }';
  const requests = [];
  await page.route('**/api/pseudocode', route => {
    const body = route.request().postDataJSON();
    requests.push(body);
    if (body.structure) return route.fulfill({ json: organize(body) });
    return route.fulfill({ json: { ...response, source: fixed, level: 1,
      explanation: 'Moved the function template and declarations to namespace scope, keeping the calls in main.' } });
  });
  await prepare(page);
  await importBoard(page, boardFile({ code: snippet, stdin: '2\n' }));
  await mode(page, 2);
  const wrapped = await page.getByLabel(/CODE THAT RUNS/).inputValue();
  expect(wrapped).not.toContain('int main');
  await page.getByRole('button', { name: 'Verify & run', exact: true }).click();
  await expect(page.locator('.result-status')).toContainText('Check the syntax');
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ source: snippet, structure: true, templateContext: '#include <stdio.h>' });
  const organized = `#include <stdio.h>\n\nint main() {\n${snippet}\nreturn 0;\n}\n`;
  await expect(page.locator('.fix-callout')).toContainText('correct scope');
  await page.getByRole('button', { name: 'Ask Gemini to fix', exact: true }).click();
  await expect(page.locator('.result-status')).toContainText('Program completed');
  await expect(page.locator('.terminal pre')).toHaveText('6\n');
  expect(requests).toHaveLength(2);
  expect(requests[1]).toMatchObject({ source: organized, stdin: '2\n', level: 1, templateMode: true });
  expect(requests[1].compilerOutput).toContain('block scope');
  await expect(page.getByLabel('Fixed C++', { exact: true })).toHaveText(fixed);
  await expect(page.getByLabel(/CODE THAT RUNS/)).toHaveValue(wrapped);
  await page.getByRole('button', { name: 'Use this fix in the editor' }).click();
  await expect(page.getByLabel(/CODE THAT RUNS/)).toHaveValue(fixed);
});

test('template runtime failures keep the ordinary optional fix without scope-repair context', async ({ page }) => {
  const calls = [];
  let runs = 0;
  await page.route('**/api/run', route => route.fulfill({ json: ++runs === 1 ? {
    ...compiled, status: 'runtime_error', stdout: '', stderr: 'division by zero',
  } : compiled }));
  await page.route('**/api/pseudocode', route => {
    const body = route.request().postDataJSON();
    calls.push(body);
    return route.fulfill({ json: body.structure ? { ...organize(body), source: body.source } : { ...response, level: 1 } });
  });
  await prepare(page);
  await mode(page, 2);
  await page.getByRole('button', { name: 'Verify & run', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Ask Gemini to fix' })).toBeEnabled();
  await expect(page.locator('.fix-callout')).not.toContainText('Template compile failed');
  await page.getByRole('button', { name: 'Ask Gemini to fix' }).click();
  await expect(page.locator('.terminal pre')).toHaveText('5\n');
  expect(calls[0].structure).toBe(true);
  expect(calls[1].compilerOutput).toContain('division by zero');
  expect(calls[1].templateMode).toBeUndefined();
});
