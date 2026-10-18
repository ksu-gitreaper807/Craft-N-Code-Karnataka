import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionOperation, hasSession, authenticated } from '../server/session-auth.mjs';
import { authorize } from '../server/hosted-api.mjs';
import session from '../api/session.js';

const token = 'test-private-classroom-secret';
const now = 1_800_000_000_000;
const request = (method = 'POST', headers = {}) => ({ method, headers: {
  host: 'board.example', origin: 'https://board.example', 'x-forwarded-proto': 'https', ...headers,
} });
const login = () => sessionOperation(request(), { token }, { token, now });

test('session cookies are signed, host-bound, expiring and keep the API token private', () => {
  const result = login();
  assert.equal(result.status, 200);
  assert.match(result.cookie, /^__Host-boardroom-session=/);
  for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', 'Max-Age=28800']) assert.ok(result.cookie.includes(attribute));
  assert.ok(!result.cookie.includes(token));
  assert.ok(!JSON.stringify(result.body).includes(token));
  const cookie = result.cookie.split(';')[0];
  const req = request('GET', { cookie });
  assert.equal(hasSession(req, token, now), true);
  assert.equal(authenticated(req, token, now), true);
  assert.equal(hasSession(req, token, now + 28_800_000), false);
  assert.equal(hasSession(req, 'rotated-token', now), false);
  assert.equal(hasSession(request('GET', { cookie, host: 'other.example' }), token, now), false);
  assert.equal(hasSession(request('GET', { cookie: cookie + '; ' + cookie }), token, now), false);
  assert.equal(hasSession(request('GET', { cookie: cookie.slice(0, -1) + (cookie.endsWith('a') ? 'b' : 'a') }), token, now), false);
});

test('session endpoints reject invalid login and CSRF, clear cookies, and retain bearer support', () => {
  assert.equal(sessionOperation(request(), { token: 'wrong' }, { token, now }).status, 401);
  assert.equal(sessionOperation(request('POST', { origin: 'https://evil.example' }), { token }, { token, now }).status, 403);
  assert.equal(sessionOperation(request('POST', { 'sec-fetch-site': 'cross-site' }), { token }, { token, now }).status, 403);
  assert.equal(sessionOperation(request(), { token }, { now }).status, 503);
  assert.equal(sessionOperation(request('PUT'), {}, { token, now }).status, 405);
  assert.match(sessionOperation(request('DELETE'), null, { token, now }).cookie, /Max-Age=0/);
  assert.equal(authenticated(request('GET', { authorization: `Bearer ${token}` }), token, now), true);
  assert.equal(authenticated(request('GET'), token, now), false);
  const req = request('GET', { cookie: login().cookie.split(';')[0] });
  // Authorize against a live-clock cookie, through the real serverless guard.
  req.headers.cookie = sessionOperation(request(), { token }, { token }).cookie.split(';')[0];
  const res = { setHeader() {}, end() {} };
  assert.equal(authorize(req, res, { BOARDROOM_API_TOKEN: token }), true);
  assert.equal(authorize({ ...req, headers: { ...req.headers, 'sec-fetch-site': 'cross-site' } }, res, { BOARDROOM_API_TOKEN: token }), false);
});

test('Vercel session handler parses JSON, bounds bodies, and emits secure cookies without credentials', () => {
  const previous = process.env.BOARDROOM_API_TOKEN;
  process.env.BOARDROOM_API_TOKEN = token;
  try {
    const call = (body, headers = {}) => {
      const req = { ...request('POST', { 'content-type': 'application/json', ...headers }), body };
      let value; const responseHeaders = {};
      const res = { statusCode: 200, setHeader(k,v) { responseHeaders[k] = v; }, end(raw) { value = JSON.parse(raw); } };
      session(req, res); return { status: res.statusCode, headers: responseHeaders, value };
    };
    const result = call(JSON.stringify({ token }));
    assert.equal(result.status, 200);
    assert.match(result.headers['Set-Cookie'], /HttpOnly/);
    assert.equal(result.headers['Cache-Control'], 'no-store');
    assert.ok(!JSON.stringify(result).includes(token));
    assert.equal(call('{').status, 400);
    assert.equal(call({ token: 'x'.repeat(1025) }).status, 413);
    assert.equal(call({ token }, { 'content-type': 'text/plain' }).status, 415);
  } finally {
    if (previous === undefined) delete process.env.BOARDROOM_API_TOKEN;
    else process.env.BOARDROOM_API_TOKEN = previous;
  }
});
