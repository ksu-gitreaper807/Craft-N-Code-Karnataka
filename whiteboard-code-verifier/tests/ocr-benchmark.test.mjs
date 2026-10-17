import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreTranscript, summarizeScores } from '../scripts/ocr-benchmark-metrics.mjs';

test('counts character, line, and critical punctuation errors in literal OCR text', () => {
  const score = scoreTranscript('int main() {\n  a == b;\n}', 'int main() {\n  a = b\n}');
  assert.equal(score.exact, false);
  assert.equal(score.lines, 3);
  assert.equal(score.exactLines, 2);
  assert.ok(score.characterErrors >= 2);
  assert.equal(score.criticalErrors, 2);
  const total = summarizeScores([score, scoreTranscript('x;', 'x;')]);
  assert.equal(total.samples, 2);
  assert.equal(total.exactSamples, 1);
  assert.equal(total.characterErrorRate, total.characterErrors / total.characters);
});
