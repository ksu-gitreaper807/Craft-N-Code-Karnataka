import { authorize, sendJson } from '../server/hosted-api.mjs';

// Compatibility endpoint for clients upgrading from cookie authentication.
export default function handler(req, res) {
  if (!authorize(req, res)) return;
  if (!['GET', 'POST', 'DELETE'].includes(req.method)) return sendJson(res, 405, { error: 'Method not allowed.' });
  res.setHeader('Set-Cookie', [
    '__Host-boardroom-session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0',
    'boardroom-session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0',
  ]);
  sendJson(res, 200, { access: 'public', authenticated: false });
}
