import assert from 'node:assert/strict';
import { sandboxHealth, runSandbox } from '../server/sandbox.mjs';
import { lessons } from '../src/lessons.js';

const state = await sandboxHealth();
if (!state.available) throw new Error(state.message);
for (const lesson of lessons) {
  const result = await runSandbox({ source: lesson.source, stdin: lesson.stdin });
  const expected = lesson.id === 'sum' ? 'success' : 'runtime_error';
  assert.equal(result.status, expected, JSON.stringify(result));
  if (lesson.id === 'sum') assert.equal(result.stdout, '3 + 5 = 8\n');
  else assert.ok(result.diagnostics.some((item) => item.line > 0));
  console.log(`${lesson.title}: ${result.status} (${result.durationMs} ms)`);
}

// These checks exercise the container's actual sanitizer and resource limits.
const checks = [
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
  console.log(`${check.title}: ${result.status} (${result.durationMs} ms)`);
}
