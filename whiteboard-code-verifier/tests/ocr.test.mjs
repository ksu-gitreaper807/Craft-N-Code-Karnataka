import test from 'node:test';
import assert from 'node:assert/strict';
import { ocrConfiguration, recognizeHandwriting, validateOcrImages, validateTranscription } from '../server/ocr.mjs';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHoQAAAAASUVORK5CYII=';
const line = (text, extra = {}) => ({ text, box: [10, 20, 80, 900], uncertain: false, alternatives: [], ...extra });
const env = { GEMINI_API_KEY: 'unit-test-key', OCR_MODEL: 'test-model' };

test('OCR configuration never exposes the key and rejects missing credentials', async () => {
  assert.equal(ocrConfiguration({}).available, false);
  assert.equal(JSON.stringify(ocrConfiguration(env)).includes(env.GEMINI_API_KEY), false);
  await assert.rejects(recognizeHandwriting({ code: PNG }, { env: {} }), (error) => error.status === 503 && error.code === 'ocr_not_configured');
});

test('accepts bounded PNG captures and rejects URLs, wrong images, and huge dimensions', () => {
  assert.ok(validateOcrImages({ code: PNG }).code);
  for (const body of [null, {}, { code: 'https://example.com/board.png' }, { code: 'data:image/jpeg;base64,AAAA' }, { code: 'data:image/png;base64,AAAA' }]) {
    assert.throws(() => validateOcrImages(body));
  }
  const bytes = Buffer.from(PNG.split(',')[1], 'base64');
  bytes.writeUInt32BE(2049, 16);
  assert.throws(() => validateOcrImages({ code: `data:image/png;base64,${bytes.toString('base64')}` }), /2048/);
});

test('preserves blank lines, indentation and ambiguous readings without repairing code', () => {
  const value = { code: [line('int main(void) {'), line(''), line('    scanf("%d", x);', { uncertain: true, alternatives: ['    scanf("%d", &x);'] }), line('}')], stdin: [] };
  const parsed = validateTranscription(value, { code: 'image' });
  assert.equal(parsed.code.map((item) => item.text).join('\n'), 'int main(void) {\n\n    scanf("%d", x);\n}');
  assert.equal(parsed.code[2].uncertain, true);
  assert.equal(parsed.code[2].alternatives.length, 1);
});

test('rejects malformed geometry, multiline entries, and unbounded responses', () => {
  for (const item of [line('a\nb'), line('x', { box: [10, 20, 2, 30] }), line('x', { box: [-1, 0, 20, 30] }), line('x', { uncertain: 0.9 })]) {
    assert.throws(() => validateTranscription({ code: [item], stdin: [] }, { code: 'image' }));
  }
  assert.throws(() => validateTranscription({ code: Array.from({ length: 20 }, () => line('x'.repeat(2048))), stdin: [] }, { code: 'image' }), /limit/);
  assert.throws(() => validateTranscription({ code: Array.from({ length: 251 }, () => line('x')), stdin: [] }, { code: 'image' }), /line list/);
  assert.throws(() => validateTranscription({ code: [], stdin: Array.from({ length: 101 }, () => line('x')) }, { stdin: 'image' }), /line list/);
});

test('uses the documented Gemini image/schema request and validates the structured response', async () => {
  let sent;
  const result = await recognizeHandwriting({ code: PNG }, { env, fetchImpl: async (url, options) => {
    sent = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ status: 'completed', steps: [
      { type: 'thought', content: [{ type: 'text', text: 'not the transcription' }] },
      { type: 'model_output', content: [{ type: 'text', text: JSON.stringify({ code: [line('int main(void) {}')], stdin: [] }) }] },
    ] }));
  } });
  assert.equal(sent.url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
  assert.equal(sent.options.headers['x-goog-api-key'], env.GEMINI_API_KEY);
  assert.equal(sent.body.store, false);
  assert.equal(sent.body.response_format.mime_type, 'application/json');
  assert.equal(sent.body.response_format.schema.properties.code.maxItems, undefined);
  assert.equal(sent.body.response_format.schema.properties.stdin.maxItems, undefined);
  assert.equal(sent.body.input.filter((part) => part.type === 'image').length, 1);
  assert.match(sent.body.input[0].text, /Never insert/);
  assert.equal(result.code[0].text, 'int main(void) {}');
  assert.equal(result.requiresConfirmation, true);
  assert.equal(result.provider, 'gemini');
});

test('surfaces provider failures without leaking keys or provider response bodies', async () => {
  await assert.rejects(recognizeHandwriting({ code: PNG }, { env, fetchImpl: async () => new Response(`secret ${env.GEMINI_API_KEY}`, { status: 403 }) }), (error) => {
    assert.equal(error.status, 502);
    assert.match(error.message, /HTTP 403/);
    assert.ok(!error.message.includes(env.GEMINI_API_KEY));
    return true;
  });
  await assert.rejects(recognizeHandwriting({ code: PNG }, { env, fetchImpl: async () => { throw new DOMException('timed out', 'TimeoutError'); } }), (error) => error.status === 504);
  await assert.rejects(recognizeHandwriting({ code: PNG }, { env, fetchImpl: async () => new Response(JSON.stringify({ status: 'completed', steps: [] })) }), (error) => error.code === 'invalid_ocr_response');
});
