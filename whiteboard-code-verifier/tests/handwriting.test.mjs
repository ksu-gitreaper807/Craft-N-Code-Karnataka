import test from 'node:test';
import assert from 'node:assert/strict';
import { handwritingChannels, inkFingerprint, mappedLine, makeReviewDraft, reviewedProgram } from '../src/handwriting.js';
import { diagnosticBoxes } from '../src/board.js';

const stroke = { id: 'ink', type: 'freedraw', x: 10, y: 20, width: 50, height: 20,
  angle: 0, points: [[0, 0], [20, 10]], strokeColor: '#1e1e1e', frameId: 'frame' };

test('recognizes channel-specific handwriting and ignores annotations, overlays and other frames', () => {
  assert.deepEqual(handwritingChannels([stroke], 'frame'), { code: true, stdin: false });
  const ignored = [
    { ...stroke, strokeColor: '#e03131' }, { ...stroke, isDeleted: true },
    { ...stroke, customData: { verifierOverlay: true } }, { ...stroke, frameId: 'elsewhere' },
  ];
  assert.deepEqual(handwritingChannels(ignored, 'frame'), { code: false, stdin: false });
});

test('invalidates recognition on ink edits, movement, color changes and input changes', () => {
  const original = inkFingerprint([stroke], 'frame');
  for (const change of [{ x: 30 }, { points: [[0, 0], [25, 10]] }, { strokeColor: '#1971c2' }, { opacity: 25 }]) {
    assert.notEqual(inkFingerprint([{ ...stroke, ...change }], 'frame'), original);
  }
  assert.equal(inkFingerprint([stroke, { ...stroke, id: 'annotation', strokeColor: '#e03131' }], 'frame'), original);
});

test('projects provider coordinates into board geometry for diagnostic highlights', () => {
  const location = mappedLine([100, 200, 200, 800], { x: 50, y: 70, width: 1000, height: 500 }, ['ink']);
  assert.equal(location.x, 250);
  assert.equal(location.y, 120);
  assert.equal(location.width, 600);
  assert.equal(location.height, 50);
  const boxes = diagnosticBoxes([{ line: 1, severity: 'error' }], [location]);
  assert.equal(boxes[0].x, 242);
  assert.equal(boxes[0].y, 118);
});

test('merges OCR only for handwritten channels and preserves confirmed line maps after edits', () => {
  const typed = { source: 'int main(void) {\n\n}', stdin: '3 5\n', lineMap: [{ x: 10 }, { x: 10 }, { x: 10 }] };
  const recognition = { code: [{ text: 'int main(void) {}', box: [10, 20, 80, 900], uncertain: true, alternatives: [] }], stdin: [] };
  const draft = makeReviewDraft(recognition, { code: { bounds: { x: 0, y: 0, width: 500, height: 200 }, elementIds: ['ink'] } }, typed, 'fingerprint', 'frame');
  assert.equal(draft.stdin.map((line) => line.text).join('\n'), typed.stdin);
  draft.code[0].text = 'int main(void) { return 0; }';
  draft.code.unshift({ text: '', location: null });
  const reviewed = reviewedProgram(draft);
  assert.equal(reviewed.source, '\nint main(void) { return 0; }');
  assert.equal(reviewed.lineMap[0], null);
  assert.equal(reviewed.lineMap[1].elementId, 'ink');
  assert.equal(diagnosticBoxes([{ line: 1 }], reviewed.lineMap).length, 0);
});


test('captures diagram arrows and invalidates review when an arrow direction or binding changes', () => {
  const arrow = { ...stroke, type: 'arrow', startArrowhead: null, endArrowhead: 'arrow' };
  assert.deepEqual(handwritingChannels([arrow], 'frame'), { code: true, stdin: false });
  const original = inkFingerprint([arrow], 'frame');
  for (const change of [{ startArrowhead: 'arrow', endArrowhead: null }, { startBinding: { elementId: 'node', focus: 0, gap: 1 } }]) {
    assert.notEqual(inkFingerprint([{ ...arrow, ...change }], 'frame'), original);
  }
});


test('code-only review fingerprint survives blue input edits but rejects code edits', () => {
  const input = { ...stroke, id: 'input', strokeColor: '#1971c2' };
  const original = [stroke, input];
  const changedInput = [stroke, { ...input, points: [[0, 0], [30, 30]] }];
  assert.equal(inkFingerprint(original, 'frame', ['code']), inkFingerprint(changedInput, 'frame', ['code']));
  assert.notEqual(inkFingerprint(original, 'frame'), inkFingerprint(changedInput, 'frame'));
  assert.notEqual(inkFingerprint(original, 'frame', ['code']), inkFingerprint([{ ...stroke, x: 99 }, input], 'frame', ['code']));
  assert.notEqual(inkFingerprint(original, 'frame', ['code']), inkFingerprint(original, 'other-frame', ['code']));
});
