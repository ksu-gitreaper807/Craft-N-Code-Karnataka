import test from 'node:test';
import assert from 'node:assert/strict';
import { extractProgram, diagnosticBoxes, programSignature, INPUT_COLOR } from '../src/board.js';

function text(id, content, y, extra = {}) {
  return { id, type: 'text', text: content, x: 20, y, fontSize: 20, lineHeight: 1.5,
    width: 200, strokeColor: '#1e1e1e', frameId: 'f', ...extra };
}

test('extracts raw lines in board order, including blank and trailing lines', () => {
  const program = extractProgram([
    text('second', 'return 0;\n}', 160),
    text('first', 'int main(void) {\n\n', 10),
    text('input', '3 5\n', 220, { strokeColor: INPUT_COLOR }),
    text('annotation', 'not C', 100, { strokeColor: '#e03131' }),
    text('other-frame', 'wrong program', 0, { frameId: 'other' }),
    text('deleted', 'old code', 0, { isDeleted: true }),
    text('overlay', 'generated', 0, { customData: { verifierOverlay: true } }),
  ], 'f');
  assert.equal(program.source, 'int main(void) {\n\n\nreturn 0;\n}');
  assert.equal(program.stdin, '3 5\n');
  assert.equal(program.lineMap.length, 5);
  assert.deepEqual(program.codeIds, ['first', 'second']);
  assert.equal(program.lineMap[3].elementId, 'second');
  assert.equal(program.lineMap[2].y, 70);
});

test('maps diagnostics once per line and skips impossible or rotated lines', () => {
  const { lineMap } = extractProgram([text('code', 'one\ntwo', 50)], 'f');
  const boxes = diagnosticBoxes([
    { line: 2, severity: 'error' }, { line: 2, severity: 'error' }, { line: 80 },
  ], lineMap);
  assert.equal(boxes.length, 1);
  assert.equal(boxes[0].y, 78);
  assert.equal(boxes[0].locked, true);
  assert.equal(boxes[0].customData.verifierOverlay, true);
  assert.equal(diagnosticBoxes([{ line: 1 }], [{ ...lineMap[0], rotated: true }]).length, 0);
});

test('no input means EOF and geometry/source changes invalidate a result', () => {
  const first = extractProgram([text('code', 'int a;', 50)], 'f');
  const moved = extractProgram([text('code', 'int a;', 80)], 'f');
  assert.equal(first.stdin, '');
  assert.notEqual(programSignature(first, 'f'), programSignature(moved, 'f'));
  assert.notEqual(programSignature(first, 'f'), programSignature(first, 'another-frame'));
});
