import { authorize, sendJson } from '../server/hosted-api.mjs';
import { ocrConfiguration } from '../server/ocr.mjs';
import { hostedRunnerHealth } from '../server/hosted-runner.mjs';
import { validLanguage } from '../src/languages.js';
import { githubSnapshotConfiguration } from '../server/github-snapshots.mjs';

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed.' });
  if (!authorize(req, res)) return;
  const language = new URL(req.url ?? '/', 'https://localhost').searchParams.get('language') ?? 'c';
  if (!validLanguage(language)) return sendJson(res, 400, { error: 'Choose C++ or Python.' });
  sendJson(res, 200, {
    service: 'whiteboard-code-verifier', access: 'public',
    runner: await hostedRunnerHealth({ language }),
    ocr: ocrConfiguration(),
    snapshots: githubSnapshotConfiguration(),
  });
}
