import { authorize, jsonBody, apiError, sendJson } from '../server/hosted-api.mjs';
import { assistPseudocode, PSEUDOCODE_BODY_LIMIT } from '../server/pseudocode.mjs';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed.' });
  if (!authorize(req, res)) return;
  try { sendJson(res, 200, await assistPseudocode(jsonBody(req, PSEUDOCODE_BODY_LIMIT))); }
  catch (error) { apiError(res, error); }
}
