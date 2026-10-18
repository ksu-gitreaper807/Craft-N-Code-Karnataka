import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { loadOcrEnvironment, recognizeHandwriting } from '../server/ocr.mjs';
import { scoreTranscript, summarizeScores } from './ocr-benchmark-metrics.mjs';

const manifestPath = process.argv[2];
if (!manifestPath) {
  console.error('Usage: npm run benchmark:ocr -- /path/to/private/manifest.json');
  process.exitCode = 1;
} else {
  try {
    loadOcrEnvironment();
    const absolute = resolve(manifestPath);
    const samples = JSON.parse(await readFile(absolute, 'utf8'));
    if (!Array.isArray(samples) || !samples.length || samples.length > 100) throw new Error('Manifest needs 1–100 samples.');
    const scores = [];
    let correctionSeconds = 0;
    let timedCorrections = 0;
    for (const [index, sample] of samples.entries()) {
      if (!sample || typeof sample.id !== 'string' || !/^[\w-]{1,60}$/.test(sample.id) ||
          typeof sample.codeText !== 'string' || typeof sample.codeImage !== 'string' || !sample.codeImage.trim() ||
          (sample.stdinText != null && typeof sample.stdinText !== 'string') ||
          (sample.stdinImage != null && (typeof sample.stdinImage !== 'string' || !sample.stdinImage.trim())) ||
          (sample.stdinImage == null) !== (sample.stdinText == null) ||
          (sample.language != null && !['c', 'python'].includes(sample.language))) {
        throw new Error(`Sample ${index + 1} needs id, codeImage, and codeText; stdinImage/stdinText are optional.`);
      }
      const body = { language: sample.language ?? 'c' };
      for (const channel of ['code', 'stdin']) {
        const path = sample[`${channel}Image`];
        if (path) body[channel] = `data:image/png;base64,${(await readFile(resolve(dirname(absolute), path))).toString('base64')}`;
      }
      let usage;
      const result = await recognizeHandwriting(body, { logger: (entry) => {
        if (entry.event === 'success') usage = entry.usage;
      } });
      const expected = [sample.codeText, sample.stdinText ?? ''];
      const actual = [result.code.map((line) => line.text).join('\n'), result.stdin.map((line) => line.text).join('\n')];
      const channelScores = expected.map((text, channel) => scoreTranscript(text, actual[channel]));
      const score = summarizeScores(channelScores);
      scores.push(...channelScores);
      if (Number.isFinite(sample.correctionSeconds) && sample.correctionSeconds >= 0) {
        correctionSeconds += sample.correctionSeconds; timedCorrections++;
      }
      console.log(JSON.stringify({ id: sample.id, characterErrorRate: score.characterErrorRate,
        exactLineRate: score.exactLineRate, criticalSymbolErrorRate: score.criticalSymbolErrorRate,
        uncertainLines: [...result.code, ...result.stdin].filter((line) => line.uncertain).length,
        durationMs: result.durationMs, usage }));
    }
    const overall = { ...summarizeScores(scores), samples: samples.length };
    console.log(JSON.stringify({ overall, correctionTime: timedCorrections ?
      { samples: timedCorrections, meanSeconds: correctionSeconds / timedCorrections } : null }, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
