import test from 'node:test';
import assert from 'node:assert/strict';
import { linkedListDrawing, composeBoardSource } from '../src/linked-list-drawing.js';
import { DEFAULT_TEMPLATE } from '../src/template.js';

test('recognizes only complete integer-chain drawings without guessing missing or branched links', () => {
  assert.equal(linkedListDrawing('1->3->4->5'), '1->3->4->5');
  assert.equal(linkedListDrawing(' -2 → 0 -> +4 -> -2\n'), '-2->0->4->-2');
  for (const text of ['1', '1 3 4 5', '1->', '1->3; puts("x");', 'a->next', '1->2\n1->3', '1->2147483648', '1->-2147483649']) assert.equal(linkedListDrawing(text), null);
});

test('drawing programs invoke the library constructor and preserve language and algorithm modes', () => {
  const source = '1->3->4->5';
  const full = composeBoardSource(source, DEFAULT_TEMPLATE, false);
  assert.equal(full.drawing, source);
  assert.match(full.source, /list_from_arrows\(&list, "1->3->4->5"\)/);
  assert.match(full.source, /list_free\(&list\)/);
  assert.equal(composeBoardSource(source, DEFAULT_TEMPLATE, true).source, full.source);
  assert.equal(composeBoardSource(source, DEFAULT_TEMPLATE, false, 'python').source, source);
  assert.equal(composeBoardSource(source, DEFAULT_TEMPLATE, false, 'c', true).source, source);
});
