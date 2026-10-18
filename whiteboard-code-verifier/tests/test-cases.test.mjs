import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyCase, MAX_CASES, validateSuite, compareOutput, suiteKey } from '../src/test-cases.js';

test('suite import validates language, bounds and all fields before replacing cases', () => {
  const suite = { version: 1, language: 'c', cases: [{ ...emptyCase(99), stdin: '2\n', expectedOutput: '4\n' }] };
  assert.equal(validateSuite(suite)[0].id, 1);
  assert.throws(() => validateSuite(suite, 'python'), /Python suite/);
  assert.throws(() => validateSuite({ ...suite, cases: [] }), /1–20/);
  assert.throws(() => validateSuite({ ...suite, cases: Array(MAX_CASES + 1).fill(emptyCase(1)) }), /1–20/);
  for (const fields of [{ stdin: '\0' }, { stdin: 'é'.repeat(4097) }, { expectedOutput: 'x'.repeat(16385) },
    { expectedStatus: 'invented' }, { comparison: 'fuzzy' }, { checkOutput: 'true' }, { name: 'a'.repeat(61) }]) {
    assert.throws(() => validateSuite({ ...suite, cases: [{ ...suite.cases[0], ...fields }] }), /invalid fields/);
  }
  assert.notEqual(suiteKey('c'), suiteKey('python'));
});

test('output comparison keeps exact newlines by default and makes relaxed modes explicit', () => {
  assert.deepEqual(compareOutput('hello\n', 'hello'), { matched: false, line: 1, column: 6, expected: '"\\n"', actual: 'EOF' });
  assert.equal(compareOutput('1  2\n', '1 2\n').matched, false);
  assert.equal(compareOutput('1  2\n', '1 2', 'trim').matched, false);
  assert.equal(compareOutput('1 2\n', ' 1 2 ', 'trim').matched, true);
  assert.equal(compareOutput('1\n\n2', '1   2', 'whitespace').matched, true);
  assert.equal(compareOutput('a\nb', 'a\nc').line, 2);
});
