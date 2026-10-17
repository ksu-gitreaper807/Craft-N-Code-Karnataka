import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, extname, resolve, sep } from 'node:path';
import { sandboxHealth, runSandbox } from './sandbox.mjs';
import { loadOcrEnvironment, ocrConfiguration, recognizeHandwriting, OCR_BODY_LIMIT } from './ocr.mjs';
import { libraries } from '../src/libraries.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'dist');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.png': 'image/png', '.json': 'application/json',
};

function send(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function requestBody(req, limit = 65_536) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > limit) throw Object.assign(new Error(`Request exceeds ${limit === 65_536 ? '64 KiB' : '4 MiB'}.`), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString()); }
  catch { throw Object.assign(new Error('Send a valid JSON object.'), { status: 400 }); }
}

export function validatePayload(body) {
  if (!body || typeof body.source !== 'string' || !body.source.trim()) return 'Write some C code before running.';
  if (Buffer.byteLength(body.source) > 32_768 || body.source.includes('\0')) return 'Source must be at most 32 KiB without NUL characters.';
  if (body.stdin !== undefined && (typeof body.stdin !== 'string' || Buffer.byteLength(body.stdin) > 8192 || body.stdin.includes('\0'))) {
    return 'Input must be text of at most 8 KiB without NUL characters.';
  }
  return null;
}

export function createHandler({ run = runSandbox, health = sandboxHealth, now = Date.now,
  recognize = recognizeHandwriting, ocrHealth = ocrConfiguration } = {}) {
  let active = 0;
  let activeOcr = 0;
  let rate = { start: 0, count: 0 };
  let ocrRate = { start: 0, count: 0 };
  return async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    const port = req.socket.localPort;
    const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
    if (!allowedHosts.includes(req.headers.host)) return send(res, 403, { error: 'Use the local server address.' });
    if (req.headers.origin && ![
      ...allowedHosts.map((host) => `http://${host}`),
      'http://127.0.0.1:5173', 'http://localhost:5173',
    ].includes(req.headers.origin)) return send(res, 403, { error: 'This origin cannot access the local runner.' });

    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch { return send(res, 400, { error: 'Invalid URL.' }); }
    try {
      if (pathname === '/api/health' && req.method === 'GET') {
        return send(res, 200, { service: 'whiteboard-code-verifier', runner: await health(), ocr: ocrHealth() });
      }
      if (req.method === 'GET' && libraries.some((library) => pathname === `/api/library/${library.file}`)) {
        const header = await readFile(resolve(ROOT, 'runner/lib', pathname.slice('/api/library/'.length)));
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end(header);
      }
      if (pathname === '/api/ocr' && req.method === 'POST') {
        if (!req.headers['content-type']?.startsWith('application/json')) return send(res, 415, { error: 'Use application/json.' });
        if (activeOcr >= 1) return send(res, 429, { error: 'A handwriting request is already running. Try again shortly.' });
        if (now() - ocrRate.start >= 60_000) ocrRate = { start: now(), count: 0 };
        if (ocrRate.count >= 6) return send(res, 429, { error: 'Handwriting request limit reached. Try again in a minute.' });
        activeOcr += 1;
        ocrRate.count += 1;
        try { return send(res, 200, await recognize(await requestBody(req, OCR_BODY_LIMIT))); }
        finally { activeOcr -= 1; }
      }
      if (pathname === '/api/run' && req.method === 'POST') {
        if (!req.headers['content-type']?.startsWith('application/json')) return send(res, 415, { error: 'Use application/json.' });
        if (active >= 2) return send(res, 429, { error: 'Both runners are busy. Try again shortly.' });
        if (now() - rate.start >= 60_000) rate = { start: now(), count: 0 };
        if (rate.count >= 20) return send(res, 429, { error: 'Run limit reached. Try again in a minute.' });
        // Reserve before awaiting input, so concurrent uploads cannot bypass the cap.
        active += 1;
        rate.count += 1;
        try {
          const body = await requestBody(req);
          const invalid = validatePayload(body);
          if (invalid) return send(res, 400, { error: invalid });
          const state = await health();
          if (!state.available) return send(res, 503, { error: state.message, code: 'runner_unavailable' });
          return send(res, 200, await run({ source: body.source, stdin: body.stdin ?? '' }));
        } finally { active -= 1; }
      }
      if (pathname.startsWith('/api/')) return send(res, 404, { error: 'API endpoint not found.' });
      if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, { error: 'Method not allowed.' });
      let path = resolve(DIST, `.${pathname}`);
      if (path !== DIST && !path.startsWith(DIST + sep)) return send(res, 404, { error: 'Not found.' });
      if (path === DIST) path = resolve(DIST, 'index.html');
      try { if (!(await stat(path)).isFile()) throw new Error('Not a file'); }
      catch {
        if (extname(path)) return send(res, 404, { error: 'Not found.' });
        path = resolve(DIST, 'index.html');
      }
      const content = await readFile(path);
      res.writeHead(200, { 'Content-Type': MIME[extname(path)] ?? 'application/octet-stream' });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (res.headersSent) return res.end();
      send(res, error.status ?? (error.code === 'ENOENT' ? 404 : 502), {
        error: error.code === 'ENOENT' ? 'Frontend not built. Run npm run build or use npm run dev.' : error.message,
        ...(error.code?.startsWith('ocr_') || error.code === 'invalid_ocr_response' || error.code === 'invalid_ocr_request' ? { code: error.code } : {}),
        ...(error.ocrDiagnostic ? { diagnostic: error.ocrDiagnostic } : {}),
      });
    }
  };
}

export function createApp(options) {
  return createServer(createHandler(options));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  loadOcrEnvironment();
  const port = Number(process.env.PORT ?? 8787);
  const server = createApp();
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.listen(port, '127.0.0.1', () => console.log(`Boardroom API: http://127.0.0.1:${port}`));
  server.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
}
