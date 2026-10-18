// Paid, bounded experiment; no key, image contents or transcripts are logged.
import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { loadEnvFile } from 'node:process';
import { OCR_PROMPT, OCR_SCHEMA, ocrConfiguration } from '../server/ocr.mjs';
import { parseApiKeys, providerFailure } from '../server/gemini-response.mjs';
import { scoreTranscript, summarizeScores } from './ocr-benchmark-metrics.mjs';

const [envPath, manifestPath = 'tests/fixtures/ocr/manifest.json', output = '/tmp/boardroom-image-benchmark.json', selectedProfiles] = process.argv.slice(2);
if (!envPath) throw new Error('Usage: node scripts/benchmark-ocr-images.mjs /path/to/.env [manifest.json] [results.json] [png1800,png900,...]');
loadEnvFile(resolve(envPath));
const key = parseApiKeys()[0];
if (!key) throw new Error('No Gemini key configured.');
const manifest = JSON.parse(await readFile(resolve(manifestPath), 'utf8'));
if (!Array.isArray(manifest) || !manifest.length || manifest.length > 10) throw new Error('Use 1–10 samples.');
const profiles = [
  { edge: 1800, mime: 'image/png' },
  { edge: 900, mime: 'image/png' },
  { edge: 1200, mime: 'image/webp', quality: 0.85 },
  { edge: 600, mime: 'image/png' },
  { edge: 1200, mime: 'image/png' },
].filter(profile => !selectedProfiles || selectedProfiles.split(',').includes(`${profile.mime.split('/')[1]}${profile.edge}`));
if (!profiles.length) throw new Error('Unknown profiles; choose png1800,png1200,png900,png600,webp1200.');
const browser = await chromium.launch({ headless: true });
const records = [];
try {
 const page = await browser.newPage();
 for (const profile of profiles) {
  for (const sample of manifest) {
   const input = [{ type: 'text', text: `${OCR_PROMPT}\nThe selected language is ${sample.language === 'python' ? 'Python 3' : 'C++17'}. Preserve indentation and blank lines exactly. Never repair colons, indentation, declarations, or punctuation.` }];
   const captures = [];
   for (const channel of ['code', 'stdin']) {
    if (!sample[`${channel}Image`]) continue;
    const bytes = await readFile(resolve(dirname(resolve(manifestPath)), sample[`${channel}Image`]));
    const capture = await page.evaluate(async ({ source, profile }) => {
      const image = new Image(); image.src = source; await image.decode();
      const scale = profile.edge / Math.max(image.width, image.height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return { dataUrl: canvas.toDataURL(profile.mime, profile.quality), width: canvas.width, height: canvas.height };
    }, { source: `data:image/png;base64,${bytes.toString('base64')}`, profile });
    const [header, data] = capture.dataUrl.split(',');
    const mime = header.slice(5, header.indexOf(';'));
    captures.push({ channel, width: capture.width, height: capture.height, bytes: Buffer.byteLength(data, 'base64'), mime });
    input.push({ type: 'text', text: channel === 'code' ? 'CODE image follows:' : 'STDIN image follows:' },
      { type: 'image', data, mime_type: mime });
   }
   const start = Date.now();
   const record = { sample: sample.id, profile, captures };
   let stop = false;
   try {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, signal: AbortSignal.timeout(50_000),
      body: JSON.stringify({ model: ocrConfiguration().model, input, store: false,
        generation_config: { temperature: 0, thinking_level: 'low', max_output_tokens: 12_000 },
        response_format: { type: 'text', mime_type: 'application/json', schema: OCR_SCHEMA } }),
    });
    record.httpStatus = response.status;
    if (!response.ok) {
      const details = await response.json().catch(() => null);
      record.diagnostic = providerFailure(response, details);
      stop = [401, 403, 429, 503].includes(response.status);
      throw new Error(`Provider HTTP ${response.status}`);
    }
    const result = await response.json();
    const text = result.steps?.filter(step => step.type === 'model_output').at(-1)?.content?.filter(part => part.type === 'text').map(part => part.text).join('');
    const transcript = JSON.parse(text);
    record.score = summarizeScores(['code', 'stdin'].map(channel => scoreTranscript(sample[`${channel}Text`] ?? '', transcript[channel].map(line => line.text).join('\n'))));
    record.usage = result.usage;
    record.status = 'success';
   } catch (error) { record.status = 'failure'; record.reason = ['AbortError', 'TimeoutError'].includes(error.name) ? 'timeout' : record.httpStatus ? `Provider HTTP ${record.httpStatus}` : 'Invalid response or network failure'; }
   record.durationMs = Date.now() - start;
   records.push(record);
   await writeFile(output, JSON.stringify({ model: ocrConfiguration().model, groundTruth: 'Provided manifest; independently check against the image before interpreting accuracy.', records }, null, 2) + '\n');
   console.log(JSON.stringify(record));
   if (stop) process.exitCode = 1;
   if (stop) break;
  }
  if (process.exitCode) break;
 }
} finally { await browser.close(); }
