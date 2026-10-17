import { authorize, jsonBody, apiError, sendJson } from '../server/hosted-api.mjs';
import { recognizeHandwriting, OCR_BODY_LIMIT } from '../server/ocr.mjs';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed.' });
  if (!authorize(req, res)) return;
  try {
    sendJson(res, 200, await recognizeHandwriting(jsonBody(req, OCR_BODY_LIMIT)));
  } catch (error) { apiError(res, error); }
}
