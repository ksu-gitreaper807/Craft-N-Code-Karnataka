import { sendJson, jsonBody, apiError } from '../server/hosted-api.mjs';
import { sessionOperation } from '../server/session-auth.mjs';

export default function handler(req, res) {
  try {
    const body = req.method === 'POST' ? jsonBody(req, 1024) : null;
    const result = sessionOperation(req, body, { token: process.env.BOARDROOM_API_TOKEN?.trim() });
    if (result.cookie) res.setHeader('Set-Cookie', result.cookie);
    sendJson(res, result.status, result.body);
  } catch (error) { apiError(res, error); }
}
