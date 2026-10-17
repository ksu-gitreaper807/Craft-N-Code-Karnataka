import { authorize, sendJson } from '../server/hosted-api.mjs';
import { ocrConfiguration } from '../server/ocr.mjs';
import { hostedRunnerHealth } from '../server/hosted-runner.mjs';

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed.' });
  if (!authorize(req, res)) return;
  sendJson(res, 200, {
    service: 'whiteboard-code-verifier',
    runner: await hostedRunnerHealth(),
    ocr: ocrConfiguration(),
    snapshots: { available: false, message: 'Hosted lesson history requires persistent storage.' },
  });
}
