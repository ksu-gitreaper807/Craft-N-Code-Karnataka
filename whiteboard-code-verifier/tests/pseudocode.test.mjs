import test from 'node:test';
import assert from 'node:assert/strict';
import { preparePseudocode } from '../src/pseudocode.js';

test('levels progressively finish statements, wrap snippets, and translate shorthand', () => {
  const original = 'let total = 3\nrepeat 2 times\nset total to total + 1\nend repeat\nprint total';
  const one = preparePseudocode(original, 1);
  const two = preparePseudocode(original, 2);
  const three = preparePseudocode(original, 3);
  assert.equal(original, 'let total = 3\nrepeat 2 times\nset total to total + 1\nend repeat\nprint total');
  assert.equal(one.source, original);
  assert.match(one.issues.map((item) => item.message).join(' '), /main function/);
  assert.match(two.source, /int main\(void\)/);
  assert.match(two.source, /let total = 3/);
  assert.match(three.source, /int total = 3;/);
  assert.match(three.source, /for \(int boardroom_repeat_1/);
  assert.match(three.source, /printf\("%d\\n", \(int\)\(total\)\);/);
  assert.match(three.source, /#include <stdio.h>/);
  assert.equal(three.issues.length, 1);
  assert.match(three.issues[0].message, /Assumed integer output/);
});

test('snippets gain a C entry point and stdio while complete C stays intact', () => {
  const snippet = 'int count = 2\nprintf("%d\\n", count)';
  assert.equal(preparePseudocode(snippet, 1).source, 'int count = 2;\nprintf("%d\\n", count);');
  const wrapped = preparePseudocode(snippet, 2).source;
  assert.match(wrapped, /^#include <stdio.h>\n\nint main\(void\) \{/);
  assert.match(wrapped, /int count = 2;/);
  const complete = '#include <stdio.h>\nint main(void) {\n    puts("hi");\n    return 0;\n}';
  assert.equal(preparePseudocode(complete, 3).source, complete);
});

test('common conditionals and input shorthand are proposed with explicit assumptions', () => {
  const proposal = preparePseudocode('read n\nif n > 0 then\nprint "positive"\notherwise\nprint n\nend if', 3);
  assert.match(proposal.source, /int n; if \(scanf\("%d", &n\) != 1\) return 1;/);
  assert.match(proposal.source, /if \(n > 0\) \{/);
  assert.match(proposal.source, /\} else \{/);
  assert.match(proposal.source, /puts\("positive"\);/);
  assert.equal(proposal.issues.length, 2);
  const unfinished = preparePseudocode('move robot forward', 3);
  assert.equal(unfinished.source.includes('move robot forward'), true);
  assert.match(unfinished.issues[0].message, /kept as written/);
  assert.equal(preparePseudocode('print "hello";\nprint 4;', 3).source.includes('puts("hello");'), true);
  assert.equal(preparePseudocode('print 4;', 3).source.includes('(int)(4)'), true);
  const selfReference = preparePseudocode('set x to x + 1', 3);
  assert.match(selfReference.issues[0].message, /Declare x/);
  assert.match(selfReference.source, /set x to x \+ 1/);
  assert.throws(() => preparePseudocode('x', 4), /level/);
  const missingValue = preparePseudocode('int total =', 1);
  assert.equal(missingValue.source, 'int total =');
  assert.match(missingValue.issues[0].message, /kept as written/);
  const spaced = preparePseudocode('\n#include <stdio.h>\nputs("hi")', 2);
  assert.match(spaced.source, /^#include <stdio.h>\n/);
  assert.match(spaced.source, /puts\("hi"\);/);
});

test('level three handles while loops and counters but keeps undeclared changes visible', () => {
  const prepared = preparePseudocode('let x = 0\nwhile x < 3 do\nincrement x\nend while\ndecrement x', 3);
  assert.match(prepared.source, /while \(x < 3\) \{/);
  assert.match(prepared.source, /x\+\+;/);
  assert.match(prepared.source, /x--;/);
  assert.equal(prepared.issues.length, 0);
  const unknown = preparePseudocode('increment missing', 3);
  assert.match(unknown.source, /increment missing/);
  assert.match(unknown.issues[0].message, /Declare missing/);
});
