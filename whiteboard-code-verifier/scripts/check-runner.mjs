import assert from 'node:assert/strict';
import { sandboxHealth, runSandbox } from '../server/sandbox.mjs';
import { lessons } from '../src/lessons.js';
import { readFile } from 'node:fs/promises';

const state = await sandboxHealth();
if (!state.available) throw new Error(state.message);
for (const lesson of lessons) {
  const result = await runSandbox({ source: lesson.source, stdin: lesson.stdin });
  const expected = lesson.expectedStatus;
  assert.equal(result.status, expected, JSON.stringify(result));
  if (lesson.expectedStdout !== undefined) assert.equal(result.stdout, lesson.expectedStdout);
  else assert.ok(result.diagnostics.some((item) => item.line > 0));
  console.log(`${lesson.title}: ${result.status} (${result.durationMs} ms)`);
}

// These checks exercise the container's actual sanitizer and resource limits.
const checks = [
  {
    title: 'All library APIs, wraparound, growth, and cleanup', status: 'success',
    source: await readFile(new URL('../tests/fixtures/library_checks.c', import.meta.url), 'utf8'),
  },
  ...[
    ['linked_list.h', 'LinkedList x; list_init(&x);', 'list_pop_front(&x)'],
    ['queue.h', 'Queue x; queue_init(&x);', 'queue_pop(&x)'],
    ['search.h', '', 'binary_search(NULL, 1, 4)'],
  ].map(([header, setup, operation]) => ({
    title: `${header} contract maps to board line 3`, status: 'runtime_error', line: 3,
    source: `#include <${header}>\nint main(void) { ${setup}\n    ${operation};\n}`,
  })),
  {
    title: 'Empty input delivers EOF', status: 'success',
    source: '#include <stdio.h>\nint main(void) { int n; return scanf("%d", &n) == EOF ? 0 : 1; }',
  },
  {
    title: 'Infinite loop is stopped', status: 'timeout',
    source: 'int main(void) { for (;;) {} }',
  },
  {
    title: 'Program output is bounded', status: 'output_limit',
    source: '#include <stdio.h>\nint main(void) { for (int n = 0; n < 100000; n++) puts("output"); }',
  },
  {
    title: 'Leak detection stays enabled', status: 'runtime_error',
    source: '#include <stdlib.h>\nint main(void) { void *p = malloc(64); if (!p) return 1; *(char *)p = 1; p = NULL; return 0; }',
    stderr: /detected memory leaks/,
  },
];
for (const check of checks) {
  const result = await runSandbox({ source: check.source, stdin: '' });
  assert.equal(result.status, check.status, JSON.stringify(result));
  assert.ok(result.durationMs < 16_000, JSON.stringify(result));
  assert.ok(Buffer.byteLength(result.stdout) <= 16_384, 'Program output exceeded its limit');
  if (check.stderr) assert.match(result.stderr, check.stderr);
  if (check.line) assert.ok(result.diagnostics.some((item) => item.kind === 'contract' && item.line === check.line));
  console.log(`${check.title}: ${result.status} (${result.durationMs} ms)`);
}
