import { test, expect } from '@playwright/test';
import { boardFile, importBoard, openPanel } from './helpers.js';

// Snippet mode: Gemini organizes the code before every compile, never repairs it, and failures never compile anything.
const compiled = { status: 'success', stdout: 'ok\n', stderr: '', compilerOutput: '', diagnostics: [], notes: [], durationMs: 1, exitCode: 0 };
const proposal = (source) => ({ source, explanation: 'Organized.', issues: [], level: 2, structure: true, provider: 'test', model: 'fixture', durationMs: 1 });

async function snippetBoard(page, code, { gemini = true } = {}) {
  await page.route('**/api/health*', (route) => route.fulfill({ json: { runner: { available: true }, ocr: { available: gemini, message: 'Set GEMINI_API_KEY on the API host.' } } }));
  await page.goto('/');
  await importBoard(page, boardFile({ code }));
  await openPanel(page);
  const slider = page.getByRole('slider', { name: 'Code mode' });
  await slider.focus(); await slider.press('Home'); await slider.press('ArrowRight');
}

test('the default snippet template has headers only: no main(), return 0; or closing brace', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('boardroom.template'));
  await snippetBoard(page, 'puts("hi");');
  await expect(page.getByLabel(/CODE THAT RUNS/)).toHaveValue('#include <stdio.h>\n\nputs("hi");');
  await page.getByRole('button', { name: 'Edit template' }).click();
  const preview = page.getByRole('dialog').getByLabel('Full program preview');
  await expect(preview).toContainText('#include <stdio.h>');
  await expect(preview).not.toContainText('int main');
  await expect(preview).not.toContainText('return 0;');
  for (const preset of ['Stack', 'Queue', 'Linked list', 'Arrays & strings', 'Data structures', 'C++ STL']) {
    await page.getByRole('dialog').getByRole('button', { name: preset, exact: true }).click();
    await expect(preview).not.toContainText('int main');
  }
  await page.getByRole('dialog').getByRole('button', { name: 'Linked list', exact: true }).click();
  await expect(preview).toContainText('#include <linked_list.h>');
});

test('Gemini runs before the compiler on every attempt, and the organized program is what compiles', async ({ page }) => {
  const order = [];
  await page.route('**/api/pseudocode', (route) => {
    const body = route.request().postDataJSON();
    order.push(`gemini:${body.structure}`);
    return route.fulfill({ json: proposal(`int helper() { return 1; }\nint main() {\n${body.source.replace('\nint helper() { return 1; }', '')}\nreturn 0;\n}`) });
  });
  const runs = [];
  await page.route('**/api/run', (route) => { order.push('run'); runs.push(route.request().postDataJSON().source); return route.fulfill({ json: runs.length === 1 ? { ...compiled, status: 'compile_error', stdout: '' } : compiled }); });
  await snippetBoard(page, 'printf("%d", helper());\nint helper() { return 1; }');
  await page.getByRole('button', { name: 'Verify & run', exact: true }).click();
  await expect(page.locator('.result-status')).toContainText('Check the syntax');
  await page.getByRole('button', { name: 'Verify & run', exact: true }).click();
  await expect(page.locator('.result-status')).toContainText('Program completed');
  expect(order).toEqual(['gemini:true', 'run', 'gemini:true', 'run']);
  expect(runs[1]).toBe('#include <stdio.h>\n\nint helper() { return 1; }\nint main() {\nprintf("%d", helper());\nreturn 0;\n}\n');
});

for (const [name, reply, expected] of [
  ['an HTTP error', { status: 429, json: { error: 'Gemini reached a quota or rate limit. (HTTP 429)' } }, 'quota or rate limit'],
  ['an empty response', { json: proposal('') }, 'empty structure'],
  ['malformed JSON', { body: 'not json', contentType: 'text/plain' }, 'nothing was compiled'],
  ['a "fixed" semicolon', { json: proposal('int main() {\nint x = 1;\nreturn 0;\n}') }, 'Gemini added code'],
  ['dropped code', { json: proposal('int main() {\nreturn 0;\n}') }, 'Gemini removed'],
]) {
  test(`${name} from the structure step compiles nothing and keeps the teacher's code`, async ({ page }) => {
    let runs = 0;
    await page.route('**/api/pseudocode', (route) => route.fulfill(reply));
    await page.route('**/api/run', (route) => { runs++; return route.fulfill({ json: compiled }); });
    await snippetBoard(page, 'int x = 1');
    const before = await page.getByLabel(/CODE THAT RUNS/).inputValue();
    await page.getByRole('button', { name: 'Verify & run', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(new RegExp(expected, 'i'));
    expect(runs).toBe(0);
    await expect(page.getByLabel(/CODE THAT RUNS/)).toHaveValue(before);
    await expect(page.locator('.result-status')).toHaveCount(0);
  });
}

test('a structure timeout compiles nothing', async ({ page }) => {
  let runs = 0;
  await page.route('**/api/pseudocode', (route) => route.fulfill({ status: 504, json: { error: 'Gemini assistance timed out. Token/quota exhaustion is unconfirmed.' } }));
  await page.route('**/api/run', (route) => { runs++; return route.fulfill({ json: compiled }); });
  await snippetBoard(page, 'puts("x");');
  await page.getByRole('button', { name: 'Verify & run', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('timed out');
  expect(runs).toBe(0);
});

test('without Gemini configured, Snippet mode cannot run and says why', async ({ page }) => {
  await snippetBoard(page, 'puts("x");', { gemini: false });
  await expect(page.getByRole('button', { name: 'Verify & run', exact: true })).toBeDisabled();
  await expect(page.locator('.inspector .runner-notice').first()).toContainText('Gemini is required in Snippet mode');
});

test('Full program mode and Python snippets never use the structure step', async ({ page }) => {
  const calls = [];
  await page.route('**/api/pseudocode', (route) => { calls.push(route.request().postDataJSON()); return route.fulfill({ json: proposal('x') }); });
  await page.route('**/api/run', (route) => route.fulfill({ json: compiled }));
  await snippetBoard(page, 'int main() { return 0; }');
  const slider = page.getByRole('slider', { name: 'Code mode' });
  await slider.focus(); await slider.press('Home');
  await page.getByRole('button', { name: 'Verify & run', exact: true }).click();
  await expect(page.locator('.result-status')).toContainText('Program completed');
  await page.getByRole('radio', { name: 'Python', exact: true }).check();
  await slider.focus(); await slider.press('ArrowRight');
  await page.getByRole('button', { name: 'Verify & run', exact: true }).click();
  await expect(page.locator('.result-status')).toContainText('Program completed');
  expect(calls).toHaveLength(0);
});

test('the favicon is linked and served', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.svg');
  const response = await request.get('/favicon.svg');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('image/svg+xml');
  expect(await response.text()).toContain('M8 21 4-4 4 4M8 8h8M8 12h5'.replace('M8 21', 'm8 21'));
});
