import { authorize, jsonBody, apiError, sendJson } from '../server/hosted-api.mjs';
import { runHostedProgram } from '../server/hosted-runner.mjs';

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed.' });
  if (!authorize(req, res)) return;
  try { sendJson(res, 200, await runHostedProgram(jsonBody(req, 65_536))); }
  catch (error) { apiError(res, error); }
}
