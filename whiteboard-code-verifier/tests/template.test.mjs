import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_TEMPLATE, HEADER_CHOICES, PRESETS, checkStructure, composeSource, sanitizeTemplate, templateBlock, validCustomLine, wrapParts } from '../src/template.js';

test('the default template and every preset hold only headers and declarations, never an entry point', () => {
  for (const template of [DEFAULT_TEMPLATE, ...PRESETS.map((preset) => preset.template)]) {
    const block = templateBlock(template);
    assert.doesNotMatch(block, /\bmain\s*\(/);
    assert.doesNotMatch(block, /return 0;/);
  }
  assert.equal(templateBlock(DEFAULT_TEMPLATE), '#include <stdio.h>');
});

test('snippet mode shows the template above the snippet without wrapping it in main()', () => {
  const template = { headers: ['#include <stdio.h>', '#include <stack.h>'], globals: ['#define N 3'], functions: [] };
  const { source, wrapped } = composeSource('Stack s;\nstack_init(&s);', template, true);
  assert.equal(wrapped, true);
  assert.equal(source, '#include <stdio.h>\n#include <stack.h>\n\n#define N 3\n\nStack s;\nstack_init(&s);');
  assert.deepEqual(wrapParts('x();\n', template), { before: '#include <stdio.h>\n#include <stack.h>\n\n#define N 3', body: 'x();', after: '' });
  assert.deepEqual(composeSource('puts("x");', template, false), { source: 'puts("x");', wrapped: false, skipped: false });
});

test('every header choice is allowed by the runner', async () => {
  const runner = await readFile(new URL('../runner/runner.py', import.meta.url), 'utf8');
  const allowed = new Set([...runner.match(/ALLOWED_HEADERS = \{([\s\S]*?)\}/)[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]));
  for (const line of HEADER_CHOICES) {
    const header = line.match(/<([^>]+)>/)[1];
    assert.ok(allowed.has(header), `${header} must be allowed by the runner`);
  }
});

test('the structure check accepts reordering and an added entry point, and rejects any repair', () => {
  const snippet = 'int square(int x) { return x * x; }\nprintf("%d\\n", square(4));';
  assert.deepEqual(checkStructure(snippet, 'int square(int x) {\n    return x * x;\n}\n'.concat('printf("%d\\n", square(4));')), { ok: true, entryAdded: false });
  assert.deepEqual(checkStructure(snippet, 'int square(int x) { return x * x; }\nint main() {\n    printf("%d\\n", square(4));\n    return 0;\n}'), { ok: true, entryAdded: true });
  assert.deepEqual(checkStructure(snippet, 'int square(int x) { return x * x; }\nint main(void) {\n    printf("%d\\n", square(4));\n}'), { ok: true, entryAdded: true });
  const broken = 'int x = 1\nprintf("%d", x)';
  assert.equal(checkStructure(broken, 'int main() {\n    int x = 1;\n    printf("%d", x);\n    return 0;\n}').ok, false);
  assert.equal(checkStructure(broken, 'int main() {\n    int x = 1\n    printf("%d", x)\n    return 0;\n}').ok, true);
  assert.equal(checkStructure('for (i = 0; i < n; i++) x++;', 'for (i = 0; i <= n; i++) x++;').ok, false);
  assert.equal(checkStructure('a(); b();', 'a();').ok, false);
  assert.equal(checkStructure('a();', '#include <stdio.h>\na();').ok, false);
});

test('sanitizes stored templates and validates custom lines', () => {
  assert.deepEqual(sanitizeTemplate({ headers: ['#include <stdio.h>', 5, '  '], globals: 'no', functions: null }),
    { headers: ['#include <stdio.h>'], globals: [], functions: [] });
  assert.equal(validCustomLine('headers', '#include <math.h>'), true);
  assert.equal(validCustomLine('headers', '#include <vector>'), true);
  assert.equal(validCustomLine('headers', '#include "secret.h"'), false);
  assert.equal(validCustomLine('globals', 'int counter = 0;'), true);
});
