import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createHandler, validatePayload } from '../server/index.mjs';
import { libraries } from '../src/libraries.js';
import { readFile } from 'node:fs/promises';

async function start(t, dependencies = {}) {
  const handler = createHandler(dependencies);
  // Exercise the actual request handler using Node streams, without needing a listening socket.
  return async (path, options = {}) => {
    const req = Readable.from(options.body ? [Buffer.from(options.body)] : []);
    req.method = options.method ?? 'GET';
    req.url = path;
    req.socket = { localPort: 8787 };
    req.headers = { host: '127.0.0.1:8787' };
    for (const [name, value] of Object.entries(options.headers ?? {})) req.headers[name.toLowerCase()] = value;
    let status = 200;
    let body = '';
    const headers = {};
    const res = {
      headersSent: false,
      setHeader(name, value) { headers[name.toLowerCase()] = value; },
      writeHead(code) { status = code; this.headersSent = true; },
      end(value) { body = value?.toString() ?? ''; },
    };
    await handler(req, res);
    return { status, headers, json: async () => JSON.parse(body), text: async () => body };
  };
}

function post(base, payload, options = {}) {
  return base('/api/run', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...options.headers },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
}

test('pseudocode API preserves payload, authenticates, bounds uploads and never executes a program', async (t) => {
  let received;
  const base = await start(t, { apiToken: 'test-private-token',
    run: async () => { throw new Error('Must not run during Gemini preparation'); },
    assist: async (body) => { received = body; return { source: 'int main(void) {}', level: body.level }; } });
  const body = JSON.stringify({ source: 'print 5', stdin: '1\n', level: 3 });
  const invoke = (extra = {}) => base('/api/pseudocode', { method: 'POST', body,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-private-token' }, ...extra });
  assert.equal((await invoke({ headers: { 'Content-Type': 'application/json' } })).status, 200);
  const response = await invoke();
  assert.equal(response.status, 200);
  assert.deepEqual(received, JSON.parse(body));
  assert.equal((await invoke({ body: 'x'.repeat(65_537) })).status, 413);
  assert.equal((await invoke({ headers: { Authorization: 'Bearer test-private-token', Origin: 'https://foreign.example' } })).status, 403);
});

test('rejects invalid and oversized code/input before entering the runner', () => {
  assert.ok(validatePayload(null));
  assert.ok(validatePayload({ source: ' ' }));
  assert.ok(validatePayload({ source: 'x'.repeat(32_769) }));
  assert.ok(validatePayload({ source: 'int main(){}', stdin: 1 }));
  assert.ok(validatePayload({ source: 'int main(){}', stdin: 'x'.repeat(8193) }));
  assert.equal(validatePayload({ source: 'int main(void) {}', stdin: '' }), null);
});

test('returns a truthful unavailable state and never executes when isolation is absent', async (t) => {
  let calls = 0;
  const base = await start(t, {
    health: async () => ({ available: false, message: 'Docker unavailable' }),
    run: async () => { calls += 1; },
  });
  const health = await (await base('/api/health')).json();
  assert.equal(health.runner.available, false);
  const response = await post(base, { source: 'int main(void) {}' });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'runner_unavailable');
  assert.equal(calls, 0);
});

test('preserves source/stdin bytes, filters extra fields, and returns runner evidence', async (t) => {
  let received;
  const evidence = { status: 'success', stdout: '8\n', diagnostics: [], notes: [], exitCode: 0 };
  const base = await start(t, {
    health: async () => ({ available: true }),
    run: async (body) => { received = body; return evidence; },
  });
  const response = await post(base, { source: 'int main(void) {\n\n}\n', stdin: '3 5\n', flags: '-unsafe' });
  assert.equal(response.status, 200);
  assert.deepEqual(received, { source: 'int main(void) {\n\n}\n', stdin: '3 5\n' });
  assert.deepEqual(await response.json(), evidence);
});

test('rejects malformed JSON, wrong content type, oversized bodies, and foreign origins', async (t) => {
  const base = await start(t, { health: async () => ({ available: true }) });
  assert.equal((await post(base, '{')).status, 400);
  assert.equal((await post(base, '{}', { headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await post(base, { source: 'x'.repeat(66_000) })).status, 413);
  assert.equal((await post(base, { source: 'x' }, { headers: { Origin: 'https://unrelated.example' } })).status, 403);
  assert.equal((await base('/api/health', { headers: { Host: 'unrelated.example' } })).status, 403);
});

test('hosted API is public while preserving configured origin and host checks', async (t) => {
  const base = await start(t, { appOrigin: 'https://board-of-c.vercel.app', apiHost: 'api.example.com',
    apiToken: 'private-test-token', health: async () => ({ available: true }),
    ocrHealth: () => ({ available: true }) });
  const hosted = { Host: 'api.example.com', Origin: 'https://board-of-c.vercel.app' };
  const preflight = await base('/api/health', { method: 'OPTIONS', headers: { ...hosted,
    'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'Authorization' } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers['access-control-allow-origin'], hosted.Origin);
  assert.match(preflight.headers['access-control-allow-headers'], /Authorization/);
  assert.equal((await base('/api/health', { headers: hosted })).status, 200);
  assert.equal((await base('/api/health', { headers: { ...hosted, Authorization: 'Bearer wrong' } })).status, 200);
  const authorized = await base('/api/health', { headers: { ...hosted, Authorization: 'Bearer private-test-token' } });
  assert.equal(authorized.status, 200);
  assert.equal(authorized.headers['access-control-allow-origin'], hosted.Origin);
  assert.equal((await base('/api/health', { headers: { ...hosted, Origin: 'https://untrusted.example', Authorization: 'Bearer private-test-token' } })).status, 403);
  assert.equal((await base('/api/health', { headers: { ...hosted, Host: 'untrusted.example', Authorization: 'Bearer private-test-token' } })).status, 403);
  assert.doesNotThrow(() => createHandler({ appOrigin: hosted.Origin }));
});

test('caps concurrent runs, then releases slots after a failed runner', async (t) => {
  const releases = [];
  const base = await start(t, {
    health: async () => ({ available: true }),
    run: () => new Promise((resolve, reject) => releases.push({ resolve, reject })),
  });
  const first = post(base, { source: 'int a;' });
  const second = post(base, { source: 'int b;' });
  for (let count = 0; releases.length < 2 && count < 100; count++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(releases.length, 2);
  assert.equal((await post(base, { source: 'int c;' })).status, 429);
  releases[0].reject(new Error('Runner stopped'));
  releases[1].resolve({ status: 'success' });
  assert.equal((await first).status, 502);
  assert.equal((await second).status, 200);
});

test('enforces the rate window and serves the actual library', async (t) => {
  let time = 100_000;
  const base = await start(t, {
    health: async () => ({ available: true }), now: () => time,
    run: async () => ({ status: 'success' }),
  });
  for (let i = 0; i < 20; i++) assert.equal((await post(base, { source: 'int a;' })).status, 200);
  assert.equal((await post(base, { source: 'int a;' })).status, 429);
  time += 60_000;
  assert.equal((await post(base, { source: 'int a;' })).status, 200);
  const library = await base('/api/library/stack.h');
  assert.equal(library.status, 200);
  assert.match(await library.text(), /#define stack_pop\(s\)/);
});

test('OCR endpoint is separate from execution and releases its slot after provider failures', async (t) => {
  let runs = 0;
  let calls = 0;
  const base = await start(t, {
    run: async () => { runs += 1; },
    recognize: async (body) => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error('OCR unavailable'), { status: 503, code: 'ocr_not_configured' });
      assert.equal(body.code, 'test capture');
      return { code: [], stdin: [], requiresConfirmation: true };
    },
  });
  const options = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'test capture' }) };
  const first = await base('/api/ocr', options);
  assert.equal(first.status, 503);
  assert.equal((await first.json()).code, 'ocr_not_configured');
  assert.equal((await base('/api/ocr', options)).status, 200);
  assert.equal(runs, 0);
});

test('serves every curated header exactly and rejects unknown or internal library paths', async (t) => {
  const base = await start(t);
  for (const library of libraries) {
    const response = await base(`/api/library/${library.file}`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), await readFile(new URL(`../runner/lib/${library.file}`, import.meta.url), 'utf8'));
  }
  for (const file of ['board_contract.h', 'unknown.h', '../server/index.mjs']) {
    assert.equal((await base(`/api/library/${file}`)).status, 404);
  }
});

test('OCR payload cap is independent of source cap and foreign origins are rejected', async (t) => {
  const base = await start(t, { recognize: async () => ({ code: [], stdin: [] }) });
  const options = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'x'.repeat(100_000) }) };
  assert.equal((await base('/api/ocr', options)).status, 200);
  assert.equal((await base('/api/ocr', { ...options, body: 'x'.repeat(4 * 1024 * 1024 + 1) })).status, 413);
  assert.equal((await base('/api/ocr', { ...options, headers: { ...options.headers, Origin: 'https://unrelated.example' } })).status, 403);
});

test('returns safe Gemini quota diagnostics to the browser', async (t) => {
  const diagnostic = { provider: 'gemini', httpStatus: 429, quotaStatus: 'token_limit_reached', retryAfterSeconds: 12 };
  const base = await start(t, { recognize: async () => {
    throw Object.assign(new Error('Gemini reports a token quota limit was reached.'), {
      status: 429, code: 'ocr_provider_error', ocrDiagnostic: diagnostic,
    });
  } });
  const response = await base('/api/ocr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 429);
  assert.deepEqual((await response.json()).diagnostic, diagnostic);
});

test('snapshot API saves and reads history independently of code execution', async (t) => {
  let runs = 0;
  let saved;
  let retries = 0;
  const entry = { id: '2026-10-17/12-00-00-lesson-12345678', commit: 'abc123', title: 'Lesson' };
  const base = await start(t, { run: async () => { runs++; }, snapshots: {
    save: async (body) => { saved = body; return entry; }, list: async () => [entry],
    read: async (id) => { assert.equal(id, entry.id); return { type: 'excalidraw' }; },
    libraries: async (id) => { assert.equal(id, entry.id); return { legacy: false, headers: [{ file: 'queue.h', changed: false }] }; },
    syncStatus: async () => ({ state: 'pending', remoteConfigured: true, branch: 'boardroom-lessons' }),
    retrySync: async () => { retries++; },
  } });
  const response = await base('/api/snapshots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scene: { type: 'excalidraw' } }) });
  assert.equal(response.status, 201);
  assert.equal(saved.scene.type, 'excalidraw');
  assert.deepEqual((await (await base('/api/snapshots')).json()).snapshots, [entry]);
  assert.equal((await (await base(`/api/snapshots/${encodeURIComponent(entry.id)}`)).json()).scene.type, 'excalidraw');
  assert.equal((await (await base(`/api/snapshots/${encodeURIComponent(entry.id)}/libraries`)).json()).headers[0].file, 'queue.h');
  assert.equal((await (await base('/api/snapshots/sync')).json()).state, 'pending');
  assert.equal((await base('/api/snapshots/sync', { method: 'POST' })).status, 202);
  assert.equal(retries, 1);
  assert.equal((await base('/api/snapshots/sync', { method: 'POST', headers: { Origin: 'https://foreign.example' } })).status, 403);
  assert.equal((await base('/api/snapshots', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
  assert.equal((await base('/api/snapshots', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://foreign.example' }, body: '{}' })).status, 403);
  assert.equal((await base('/api/snapshots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(4 * 1024 * 1024 + 1) })).status, 413);
  assert.equal(runs, 0);
});

test('Python API passes the selected language through readiness and execution, and rejects unknown languages', async (t) => {
  let received, selected;
  const base = await start(t, { health: async (language) => { selected = language; return { available: true }; },
    run: async (payload) => { received = payload; return { status: 'success', stdout: '5\n' }; } });
  assert.equal((await base('/api/health?language=python')).status, 200);
  assert.equal(selected, 'python');
  assert.equal((await post(base, { source: 'print(5)\n', stdin: '', language: 'python' })).status, 200);
  assert.deepEqual(received, { source: 'print(5)\n', stdin: '', language: 'python' });
  assert.equal((await post(base, { source: 'x', language: 'javascript' })).status, 400);
  assert.equal((await base('/api/health?language=javascript')).status, 400);
});

test('public local APIs ignore old token configuration and retain origin checks', async t => {
  const base = await start(t, { apiToken: 'obsolete-token', health: async () => ({ available: true }) });
  assert.equal((await base('/api/health')).status, 200);
  assert.equal((await (await base('/api/health')).json()).access, 'public');
  assert.equal((await base('/api/health', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  const legacy = await base('/api/session');
  assert.equal(legacy.status, 200);
  assert.equal((await legacy.json()).access, 'public');
  assert.ok(legacy.headers['set-cookie'].every(value => value.includes('Max-Age=0')));
});
