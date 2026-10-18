export function sendJson(res, status, value) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.statusCode = status;
  res.end(JSON.stringify(value));
}

export function authorize(req, res) {
  const origin = req.headers.origin;
  const host = req.headers['x-forwarded-host'] ?? req.headers.host;
  if (origin && origin !== `https://${host}` && origin !== `http://${host}`) {
    sendJson(res, 403, { error: 'Use this site to access the API.' });
    return false;
  }
  if (req.headers['sec-fetch-site'] === 'cross-site') {
    sendJson(res, 403, { error: 'Use this site to access the API.' });
    return false;
  }
  return true;
}

export function jsonBody(req, maxBytes) {
  if (!req.headers['content-type']?.startsWith('application/json')) {
    throw Object.assign(new Error('Use application/json.'), { status: 415 });
  }
  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { throw Object.assign(new Error('Send valid JSON.'), { status: 400 }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw Object.assign(new Error('Send a JSON object.'), { status: 400 });
  }
  if (Buffer.byteLength(JSON.stringify(body)) > maxBytes) {
    throw Object.assign(new Error('Request is too large.'), { status: 413 });
  }
  return body;
}

export function apiError(res, error) {
  sendJson(res, error.status ?? 502, {
    error: error instanceof SyntaxError ? 'Send valid JSON.' : error.message,
    ...(error.code ? { code: error.code } : {}),
    ...(error.ocrDiagnostic || error.diagnostic ? { diagnostic: error.ocrDiagnostic ?? error.diagnostic } : {}),
  });
}
