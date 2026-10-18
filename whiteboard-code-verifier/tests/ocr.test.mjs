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
  const logs = [];
  const result = await recognizeHandwriting({ code: PNG }, { env, logger: (entry) => logs.push(entry), fetchImpl: async (url, options) => {
    sent = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ status: 'completed', usage: {
      total_input_tokens: 1100, total_output_tokens: 200, total_thought_tokens: 300,
      total_tokens: 1600, unexpected: env.GEMINI_API_KEY,
    }, steps: [
      { type: 'thought', content: [{ type: 'text', text: 'not the transcription' }] },
      { type: 'model_output', content: [{ type: 'text', text: JSON.stringify({ code: [line('int main(void) {}')], stdin: [] }) }] },
    ] }));
  } });
  assert.equal(sent.url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
  assert.equal(sent.options.headers['x-goog-api-key'], env.GEMINI_API_KEY);
  assert.equal(sent.body.store, false);
  assert.equal(sent.body.generation_config.thinking_level, 'low');
  assert.equal(sent.body.response_format.mime_type, 'application/json');
  assert.equal(sent.body.response_format.schema.properties.code.maxItems, undefined);
  assert.equal(sent.body.response_format.schema.properties.stdin.maxItems, undefined);
  assert.equal(sent.body.input.filter((part) => part.type === 'image').length, 1);
  assert.deepEqual(sent.body.response_format.schema.properties.code.items.required, ['text', 'uncertain']);
  assert.equal(sent.body.response_format.schema.properties.code.items.properties.box, undefined);
  assert.equal(sent.body.response_format.schema.properties.code.items.properties.alternatives, undefined);
  assert.match(sent.body.input[0].text, /Never fix code or insert/);
  assert.equal(result.code[0].text, 'int main(void) {}');
  assert.equal(result.requiresConfirmation, true);
  assert.equal(result.provider, 'gemini');
  assert.deepEqual(logs[0].usage, { total_input_tokens: 1100, total_output_tokens: 200, total_thought_tokens: 300, total_tokens: 1600 });
  assert.equal(logs[0].event, 'success');
  assert.equal(logs[0].quotaStatus, 'not_reported');
  assert.ok(!JSON.stringify(logs).includes(env.GEMINI_API_KEY));
});

test('compact OCR keeps intentional errors, indentation, blank lines and ambiguity without inventing locations', async () => {
  const texts = ['if value != 0', '    print("O;\\n")', '', '    total = value & 1'];
  const result = await recognizeHandwriting({ code: PNG, language: 'python' }, { env, logger: () => {}, fetchImpl: async () =>
    new Response(JSON.stringify({ status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text',
      text: JSON.stringify({ code: texts.map((text, index) => ({ text, uncertain: index === 1 })), stdin: [] }) }] }] })),
  });
  assert.deepEqual(result.code.map(line => line.text), texts);
  assert.equal(result.code[1].uncertain, true);
  assert.ok(result.code.every(line => line.box === null && line.alternatives.length === 0));
  assert.equal(result.requiresConfirmation, true);
  for (const line of [{ text: 'x' }, { text: 'x\ny', uncertain: false }, { text: 'x', uncertain: 'maybe' }]) {
    assert.throws(() => validateTranscription({ code: [line], stdin: [] }, { code: 'image' }, { compact: true }), /invalid text/);
  }
  assert.throws(() => validateTranscription({ code: Array.from({ length: 251 }, () => ({ text: 'x', uncertain: false })), stdin: [] },
    { code: 'image' }, { compact: true }), /line list/);
});

test('distinguishes token quotas, general limits, and depleted credits without exposing provider payloads', async () => {
  const scenarios = [
    { status: 429, code: 'resource_exhausted', metric: 'generate_content_free_tier_input_token_count',
      expected: 'token_limit_reached', message: /token quota limit/, retry: '5s' },
    { status: 429, code: 'RESOURCE_EXHAUSTED', metric: 'generate_content_free_tier_requests',
      expected: 'quota_or_rate_limit_reached', message: /does not confirm token exhaustion/, retry: '2s' },
    { status: 402, code: 'FAILED_PRECONDITION', expected: 'credits_exhausted', message: /depleted billing credits/ },
  ];
  for (const scenario of scenarios) {
    const logs = [];
    const details = [
      { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaMetric: scenario.metric }] },
      { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: scenario.retry },
    ];
    const fetchImpl = async () => new Response(JSON.stringify({ error: {
      code: scenario.code, message: `private provider message ${env.GEMINI_API_KEY}`, details,
    } }), { status: scenario.status });
    await assert.rejects(recognizeHandwriting({ code: PNG }, { env, fetchImpl, logger: (entry) => logs.push(entry) }), (error) => {
      assert.equal(error.ocrDiagnostic.quotaStatus, scenario.expected);
      assert.equal(error.ocrDiagnostic.httpStatus, scenario.status);
      assert.equal(error.ocrDiagnostic.providerStatus, scenario.code.toUpperCase());
      if (scenario.retry) assert.equal(error.ocrDiagnostic.retryAfterSeconds, Number.parseInt(scenario.retry));
      assert.match(error.message, scenario.message);
      assert.ok(!JSON.stringify({ message: error.message, logs, diagnostic: error.ocrDiagnostic }).includes(env.GEMINI_API_KEY));
      return true;
    });
    assert.equal(logs[0].event, 'failure');
  }
});

test('timeouts before headers and during the body leave quota status unknown', async () => {
  const timeout = () => new DOMException(`private ${env.GEMINI_API_KEY}`, 'TimeoutError');
  const fetches = [
    async () => { throw timeout(); },
    async () => new Response(new ReadableStream({ start(controller) { controller.error(timeout()); } })),
  ];
  for (const [index, fetchImpl] of fetches.entries()) {
    const logs = [];
    await assert.rejects(recognizeHandwriting({ code: PNG }, { env, fetchImpl, logger: (entry) => logs.push(entry) }), (error) => {
      assert.equal(error.status, 504);
      assert.equal(error.ocrDiagnostic.reason, 'timeout');
      assert.equal(error.ocrDiagnostic.quotaStatus, 'unknown');
      assert.equal(error.ocrDiagnostic.httpStatus, index ? 200 : null);
      assert.match(error.message, /exhaustion is unconfirmed/);
      assert.ok(!error.message.includes(env.GEMINI_API_KEY));
      return true;
    });
    assert.equal(logs[0].quotaStatus, 'unknown');
  }
});

test('OCR cancels a stalled provider before the 60-second hosting deadline and returns safe timeout diagnostics', async (t) => {
  t.mock.method(AbortSignal, 'timeout', (milliseconds) => {
    assert.ok(milliseconds <= 50_000, 'leave at least ten seconds for the hosted JSON error response');
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('provider stalled', 'TimeoutError')), 1);
    return controller.signal;
  });
  await assert.rejects(recognizeHandwriting({ code: PNG }, { env, logger: () => {},
    fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
  }), (error) => error.status === 504 && error.ocrDiagnostic.reason === 'timeout' && error.ocrDiagnostic.quotaStatus === 'unknown');
});

test('keeps HTTP 429 evidence when error bodies are malformed or oversized and honors Retry-After', async () => {
  for (const payload of ['not JSON', 'x'.repeat(17 * 1024)]) {
    await assert.rejects(recognizeHandwriting({ code: PNG }, { env, logger: () => {}, fetchImpl: async () =>
      new Response(payload, { status: 429, headers: { 'Retry-After': '12' } }) }), (error) => {
      assert.equal(error.status, 429);
      assert.equal(error.ocrDiagnostic.quotaStatus, 'quota_or_rate_limit_reached');
      assert.equal(error.ocrDiagnostic.retryAfterSeconds, 12);
      assert.match(error.message, /Retry after 12 seconds/);
      return true;
    });
  }
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

test('Python OCR preserves indentation and passes explicit language context without repairing', async () => {
  const result = await recognizeHandwriting({ code: PNG, language: 'python' }, { env, logger: () => {}, fetchImpl: async (_url, options) => {
    const prompt = JSON.parse(options.body).input[0].text;
    assert.match(prompt, /selected language is Python 3/);
    assert.match(prompt, /Preserve indentation/);
    return new Response(JSON.stringify({ status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify({ code: [line('if True'), line('    print(5)')], stdin: [] }) }] }] }));
  } });
  assert.equal(result.language, 'python');
  assert.deepEqual(result.code.map((entry) => entry.text), ['if True', '    print(5)']);
  assert.throws(() => validateOcrImages({ code: PNG, language: 'javascript' }), /C\+\+ or Python/);
});
