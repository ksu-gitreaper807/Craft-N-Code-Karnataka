import test from 'node:test';
import assert from 'node:assert/strict';
import health from '../api/health.js';
import session from '../api/session.js';
import ocr from '../api/ocr.js';
import pseudocode from '../api/pseudocode.js';

async function call(handler, { method = 'GET', body, token = 'test-secret', origin = 'https://board-of-c.vercel.app' } = {}) {
  const req = { method, body, headers: { host: 'board-of-c.vercel.app', origin,
    authorization: `Bearer ${token}`, 'content-type': 'application/json' } };
  let data;
  const res = { statusCode: 200, setHeader() {}, end(value) { data = JSON.parse(value); } };
  await handler(req, res);
  return { status: res.statusCode, data };
}

test('hosted health is public and reports independent OCR/runner readiness', async () => {
  const previous = { token: process.env.BOARDROOM_API_TOKEN, gemini: process.env.GEMINI_API_KEY };
  try {
    process.env.BOARDROOM_API_TOKEN = 'test-secret';
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    assert.equal((await call(health, { token: 'wrong' })).status, 200);
    delete process.env.BOARDROOM_API_TOKEN;
    assert.equal((await call(health)).status, 200);
    assert.equal((await call(health, { origin: 'https://foreign.example' })).status, 403);
    const response = await call(health);
    assert.equal(response.status, 200);
    assert.equal(response.data.runner.available, false);
    assert.equal(response.data.ocr.available, true);
    assert.equal(JSON.stringify(response.data).includes('test-gemini-key'), false);
  } finally {
    if (previous.token === undefined) delete process.env.BOARDROOM_API_TOKEN;
    else process.env.BOARDROOM_API_TOKEN = previous.token;
    if (previous.gemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previous.gemini;
  }
});

test('hosted OCR rejects malformed images without contacting Gemini', async () => {
  const previous = process.env.BOARDROOM_API_TOKEN;
  try {
    process.env.BOARDROOM_API_TOKEN = 'test-secret';
    const response = await call(ocr, { method: 'POST', body: { code: 'not-an-image' } });
    assert.equal(response.status, 400);
    assert.match(response.data.error, /PNG images/);
  } finally {
    if (previous === undefined) delete process.env.BOARDROOM_API_TOKEN;
    else process.env.BOARDROOM_API_TOKEN = previous;
  }
});

test('hosted pseudocode is public and rejects invalid levels without contacting Gemini', async () => {
  const previous = process.env.BOARDROOM_API_TOKEN;
  try {
    process.env.BOARDROOM_API_TOKEN = 'test-secret';
    assert.equal((await call(pseudocode, { method: 'POST', token: 'wrong', body: { source: 'print 5', level: 4 } })).status, 400);
    assert.equal((await call(pseudocode, { method: 'POST', body: { source: 'print 5', level: 4 } })).status, 400);
    assert.equal((await call(pseudocode)).status, 405);
  } finally {
    if (previous === undefined) delete process.env.BOARDROOM_API_TOKEN;
    else process.env.BOARDROOM_API_TOKEN = previous;
  }
});


test('legacy session routes report public access and never require a credential', async () => {
  for (const method of ['GET', 'POST', 'DELETE']) {
    const result = await call(session, { method, token: '' });
    assert.equal(result.status, 200);
    assert.deepEqual(result.data, { access: 'public', authenticated: false });
  }
  assert.equal((await call(session, { method: 'PUT' })).status, 405);
  assert.equal((await call(session, { origin: 'https://foreign.example' })).status, 403);
});
