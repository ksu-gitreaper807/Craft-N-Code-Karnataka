import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const LIFETIME = 8 * 60 * 60;
const host = req => req.headers['x-forwarded-host'] ?? req.headers.host ?? '';
const secure = req => req.headers['x-forwarded-proto'] === 'https' || Boolean(req.socket?.encrypted);
const cookieName = req => secure(req) ? '__Host-boardroom-session' : 'boardroom-session';
const signature = (req, token, payload) => createHmac('sha256', token).update(`boardroom-session-v1\0${host(req)}\0${payload}`).digest('hex');
export const tokenMatches = (presented, expected) => typeof presented === 'string' && Boolean(expected) &&
  timingSafeEqual(createHash('sha256').update(presented).digest(), createHash('sha256').update(expected).digest());

export function hasSession(req, token, now = Date.now()) {
  if (!token) return false;
  const values = (req.headers.cookie ?? '').split(';').map(value => value.trim())
    .filter(value => value.startsWith(`${cookieName(req)}=`));
  if (values.length !== 1) return false;
  const value = values[0].slice(cookieName(req).length + 1);
  const match = /^(\d{10,12})\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(value);
  if (!match) return false;
  const expires = Number(match[1]);
  const seconds = Math.floor(now / 1000);
  if (expires <= seconds || expires > seconds + LIFETIME) return false;
  const expected = signature(req, token, `${match[1]}.${match[2]}`);
  return timingSafeEqual(Buffer.from(match[3], 'hex'), Buffer.from(expected, 'hex'));
}

export function hasBearerToken(req, token) {
  return tokenMatches(/^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1], token);
}

export function authenticated(req, token, now = Date.now()) {
  return hasSession(req, token, now) || hasBearerToken(req, token);
}

export function trustedSessionOrigin(req, allowedOrigin) {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = req.headers.origin;
  return !origin || origin === `${secure(req) ? 'https' : 'http'}://${host(req)}` || origin === allowedOrigin;
}

export function sessionOperation(req, body, { token, now = Date.now(), allowedOrigin } = {}) {
  if (!trustedSessionOrigin(req, allowedOrigin)) return { status: 403, body: { error: 'Sign in from the Boardroom site.' } };
  if (!token) return { status: 503, body: { error: 'Set BOARDROOM_API_TOKEN on the API host, then redeploy or restart it.' } };
  if (req.method === 'GET') return { status: 200, body: { authenticated: hasSession(req, token, now) } };
  const attributes = `Path=/; HttpOnly; SameSite=Strict${secure(req) ? '; Secure' : ''}`;
  if (req.method === 'DELETE') return { status: 200, cookie: `${cookieName(req)}=; ${attributes}; Max-Age=0`, body: { authenticated: false } };
  if (req.method !== 'POST') return { status: 405, body: { error: 'Method not allowed.' } };
  if (!tokenMatches(body?.token, token)) return { status: 401, body: { error: 'The access token is invalid.' } };
  const payload = `${Math.floor(now / 1000) + LIFETIME}.${randomBytes(16).toString('hex')}`;
  return { status: 200, cookie: `${cookieName(req)}=${payload}.${signature(req, token, payload)}; ${attributes}; Max-Age=${LIFETIME}`,
    body: { authenticated: true, expiresIn: LIFETIME } };
}
