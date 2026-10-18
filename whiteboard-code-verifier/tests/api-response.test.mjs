import test from 'node:test';
import assert from 'node:assert/strict';
import { readApiJson } from '../src/api-response.js';

function response(body, status, path = '/api/ocr') {
  const result = new Response(body, { status });
  Object.defineProperty(result, 'url', { value: `https://board-of-c.vercel.app${path}` });
  return result;
}

test('API parsing preserves structured success and provider quota errors', async () => {
  for (const [status, data] of [[200, { code: [], stdin: [] }], [429, {
    error: 'Token limit reached', diagnostic: { quotaStatus: 'token_limit_reached' },
  }]]) assert.deepEqual(await readApiJson(response(JSON.stringify(data), status)), data);
});

test('hosting HTML and text timeouts produce actionable errors without claiming token exhaustion', async () => {
  for (const body of ['<!doctype html><h1>private gateway details</h1>', 'FUNCTION_INVOCATION_TIMEOUT']) {
    await assert.rejects(readApiJson(response(body, 504)), (error) => {
      assert.match(error.message, /Handwriting recognition timed out/);
      assert.match(error.message, /HTTP 504/);
      assert.match(error.message, /quota status is unknown/);
      assert.deepEqual(error.diagnostic, { provider: 'gemini', reason: 'host_timeout', httpStatus: 504, quotaStatus: 'unknown' });
      assert.ok(!error.message.includes(body));
      return true;
    });
  }
});

test('non-JSON snapshots, oversized uploads, and invalid success shapes do not leak parse errors or response bodies', async () => {
  await assert.rejects(readApiJson(response('<html>not an API</html>', 502, '/api/snapshots')), /HTTP 502, \/api\/snapshots/);
  await assert.rejects(readApiJson(response('upload limit', 413)), /too large.*HTTP 413/);
  for (const body of ['', 'null', '[]', '"text"']) await assert.rejects(readApiJson(response(body, 200)), /non-JSON response/);
});

test('response-body cancellation remains a timeout rather than becoming a JSON error', async () => {
  const aborted = { text: async () => { throw new DOMException('cancelled', 'AbortError'); } };
  await assert.rejects(readApiJson(aborted), { name: 'AbortError' });
});
