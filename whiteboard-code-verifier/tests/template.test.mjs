import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TEMPLATE, composeSource, hasMain, sanitizeTemplate, validCustomLine, wrapParts } from '../src/template.js';

test('wraps a snippet in the template, indenting it and keeping blank lines', () => {
  const template = { headers: ['#include <stdio.h>', '#include <math.h>'], globals: ['#define N 3'], functions: [] };
  const { source, wrapped } = composeSource('int i = N;\n\nprintf("%d\\n", i);', template, true);
  assert.equal(wrapped, true);
  assert.equal(source, [
    '#include <stdio.h>', '#include <math.h>', '', '#define N 3', '',
    'int main(void) {', '    int i = N;', '', '    printf("%d\\n", i);', '    return 0;', '}',
  ].join('\n'));
});

test('leaves the board text alone when the mode is off, empty, or already declares main', () => {
  assert.deepEqual(composeSource('puts("x");', DEFAULT_TEMPLATE, false), { source: 'puts("x");', wrapped: false, skipped: false });
  assert.deepEqual(composeSource('  \n', DEFAULT_TEMPLATE, true), { source: '  \n', wrapped: false, skipped: false });
  const full = 'int main(void) { return 0; }';
  assert.deepEqual(composeSource(full, DEFAULT_TEMPLATE, true), { source: full, wrapped: false, skipped: true });
  assert.equal(hasMain('int mainly = 1;'), false);
});

test('reports the program in three parts so the builder can mark the snippet', () => {
  const parts = wrapParts('x();', DEFAULT_TEMPLATE);
  assert.equal(parts.before, '#include <stdio.h>\n\nint main(void) {');
  assert.equal(parts.body, '    x();');
  assert.equal(parts.after, '    return 0;\n}');
});

test('sanitizes stored templates and validates custom lines', () => {
  assert.deepEqual(sanitizeTemplate({ headers: ['#include <stdio.h>', 5, '  '], globals: 'no', functions: null }),
    { headers: ['#include <stdio.h>'], globals: [], functions: [] });
  assert.equal(sanitizeTemplate({ headers: Array.from({ length: 40 }, (_, i) => `#include <h${i}.h>`) }).headers.length, 20);
  assert.equal(validCustomLine('headers', '#include <math.h>'), true);
  assert.equal(validCustomLine('headers', '#include "secret.h"'), false);
  assert.equal(validCustomLine('headers', '#include </etc/passwd>'), false);
  assert.equal(validCustomLine('globals', 'int counter = 0;'), true);
  assert.equal(validCustomLine('globals', '   '), false);
});
